/**
 * XAUUSD AI routes — realtime data, brain, learning log, predictions, news, chat
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  xauusdSnapshotsTable,
  xauusdBrainTable,
  xauusdQuestionsLogTable,
  xauusdPredictionsTable,
  xauusdNewsTable,
  xauusdLearningLogTable,
  xauusdMacroSnapshotsTable,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  fetchXauusdIndicators,
  getMultiTimeframeAnalysis,
  summarizeTimeframeConfluence,
  getCorrelationAnalysis,
} from "../lib/xauusd-data.js";
import {
  runLearningCycle,
  getEngineStatus,
  startXauusdBrainEngine,
  stopXauusdBrainEngine,
  startExtremeLearningMode,
  stopExtremeLearningMode,
  detectTradingSession,
  detectMarketRegime,
  computeClusterLabel,
  isXauusdMarketOpen,
  generateXauusdOnDemandPrediction,
} from "../lib/xauusd-brain-engine.js";
import { chatWithAgent } from "../lib/agent-engine.js";
import { getLatestLivePrice } from "../lib/xauusd-live-price.js";
import { getLatestMentorIndicators } from "../lib/xauusd-mentor-cache.js";
import {
  getSettingsSummary,
  getMemberPassword,
  setDeepseekApiKey,
  clearDeepseekApiKey,
  setPredictionTimeframeMinutes,
  setWhatsappNumber,
  setWhatsappEnabled,
  VALID_TIMEFRAMES,
  isXauusdBrainEnabled,
  setXauusdBrainEnabled,
  validateEaApiKey,
} from "../lib/xauusd-settings.js";
import { sendTestWhatsappMessage } from "../lib/xauusd-whatsapp.js";

export const xauusdRouter = Router();

// ─── In-memory EA account store ───────────────────────────────────────────────
interface EaPosition {
  ticket: number;
  type: "BUY" | "SELL";
  volume: number;
  symbol: string;
  openPrice: number;
  currentPrice: number;
  tp: number;
  sl: number;
  pnl: number;
  swap: number;
  openTime: string;
}
interface EaAccountData {
  balance: number;
  equity: number;
  freeMargin: number;
  margin: number;
  pnl: number;
  positions: EaPosition[];
  accountName: string;
  accountNumber: number;
  broker: string;
  leverage: number;
  currency: string;
  updatedAt: string;
}
let eaAccountStore: EaAccountData | null = null;
let eaAccountUpdatedAt = 0;
const EA_ACCOUNT_STALE_MS = 10_000; // anggap stale setelah 10 detik tidak ada update

// ─── GET /xauusd/live-price — realtime price ticker (polled every 1s) ────────
xauusdRouter.get("/live-price", (_req, res) => {
  return res.json(getLatestLivePrice());
});

// ─── GET /xauusd/snapshot — current price + all indicators ───────────────────
xauusdRouter.get("/snapshot", async (_req, res) => {
  try {
    const indicators = await fetchXauusdIndicators("1h");
    if (!indicators) {
      return res.status(503).json({ error: "TradingView Scanner returned no data" });
    }

    // Also get last saved snapshot for price change comparison
    const lastSnap = await db
      .select()
      .from(xauusdSnapshotsTable)
      .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
      .limit(1);

    return res.json({
      ...indicators,
      lastSnapshotAt: lastSnap[0]?.snapshotAt ?? null,
      lastSavedPrice: lastSnap[0]?.price ?? null,
    });
  } catch (err) {
    console.error("[XAUUSD] /snapshot error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Feature 4/5/7: GET /xauusd/market-regime — live session + regime + cluster
xauusdRouter.get("/market-regime", async (_req, res) => {
  try {
    const indicators = await fetchXauusdIndicators("1h");
    const session = detectTradingSession();
    const regime = indicators ? detectMarketRegime(indicators) : null;
    const cluster = indicators ? computeClusterLabel(indicators) : null;
    return res.json({ session, regime, cluster, price: indicators?.price ?? null });
  } catch (err) {
    console.error("[XAUUSD] /market-regime error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/mentor-signal — fast rule-based signal for Mentor Mode ───────
// Returns BUY / SHORT / HOLD command based on LIVE technical indicators.
// Primary source: in-memory cache refreshed every 30s from TradingView Scanner.
// Fallback: last DB snapshot (if cache not yet ready or TV unreachable).
// Query param: sensitivity = "aggressive" | "normal" | "conservative"
xauusdRouter.get("/mentor-signal", async (req, res) => {
  try {
    const sensitivity = (["super_aggressive", "aggressive", "normal", "conservative"].includes(req.query.sensitivity as string)
      ? req.query.sensitivity
      : "normal") as "super_aggressive" | "aggressive" | "normal" | "conservative";

    const livePrice = getLatestLivePrice();

    // ── Primary: live indicator cache (30s fresh) ─────────────────────────────
    // Use cache only when populated AND not stale (TV reachable within 90s).
    const cached = getLatestMentorIndicators();
    const useLiveCache = cached.indicators !== null && !cached.stale;
    let snap: typeof cached.indicators | null = useLiveCache ? cached.indicators : null;
    let dataSource: "live" | "snapshot" = "live";
    let indicatorsAgeMs: number | null = useLiveCache ? cached.ageMs : null;

    // ── Fallback: DB snapshot when cache empty or TradingView unreachable ─────
    if (!snap) {
      const snapRows = await db
        .select()
        .from(xauusdSnapshotsTable)
        .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
        .limit(1);

      if (!snapRows.length) {
        return res.json({
          command: "HOLD",
          reasons: ["Indikator belum tersedia — tunggu sebentar"],
          minTP: null,
          minSL: null,
          minTPDistance: null,
          confidence: 0,
          price: livePrice?.price ?? null,
          bullishScore: 0,
          bearishScore: 0,
          snapshotAgeMs: null,
          indicatorsAgeMs: null,
          dataSource: "snapshot", // normalized — no "none" in API contract
          sensitivity,
        });
      }

      // Map DB snapshot row → XauusdIndicators shape using all available fields
      const row = snapRows[0];
      const bbW = row.bbUpper != null && row.bbLower != null && row.bbMiddle != null && row.bbMiddle !== 0
        ? parseFloat(((row.bbUpper - row.bbLower) / row.bbMiddle * 100).toFixed(3))
        : null;
      snap = {
        price:          row.price,
        open:           row.price,   // DB snapshot doesn't store open/high/low separately
        high:           row.price,
        low:            row.price,
        volume:         row.volume ?? 0,
        rsi14:          row.rsi14,
        ema9:           row.ema9,
        ema21:          row.ema21,
        ema50:          row.ema50,
        ema200:         row.ema200,
        macdLine:       row.macdLine,
        macdSignal:     row.macdSignal,
        macdHistogram:  row.macdHistogram,
        bbUpper:        row.bbUpper,
        bbMiddle:       row.bbMiddle,
        bbLower:        row.bbLower,
        bbWidth:        bbW,
        atr14:          row.atr14,
        trend:          (row.trend as "bullish" | "bearish" | "sideways") ?? "sideways",
        rsiSignal:      (row.rsiSignal as "overbought" | "oversold" | "neutral") ?? "neutral",
        macdSignalType: (row.macdSignalType as "bullish_cross" | "bearish_cross" | "neutral") ?? "neutral",
        emaAlignment:   (row.emaAlignment as "bullish_stack" | "bearish_stack" | "mixed") ?? "mixed",
        supportLevel:   row.supportLevel,
        resistanceLevel:row.resistanceLevel,
      };
      dataSource = "snapshot";
      indicatorsAgeMs = Date.now() - new Date(row.snapshotAt).getTime();
    }

    // Use live price over indicator price when available (5s fresh vs 30s)
    const price = livePrice?.price ?? snap.price;

    // ── Scoring signals (max 8 checks) ────────────────────────────────────────
    let bullishScore = 0;
    let bearishScore = 0;
    const bullishReasons: string[] = [];
    const bearishReasons: string[] = [];

    // 1. EMA alignment
    if (snap.emaAlignment === "bullish_stack") {
      bullishScore++;
      bullishReasons.push("EMA bullish stack (9>21>50>200)");
    } else if (snap.emaAlignment === "bearish_stack") {
      bearishScore++;
      bearishReasons.push("EMA bearish stack (9<21<50<200)");
    }

    // 2. RSI zone
    if (snap.rsi14 != null) {
      const rsi = snap.rsi14;
      if (rsi <= 30) {
        bullishScore++;
        bullishReasons.push(`RSI ${rsi.toFixed(0)} — oversold, potensi reversal naik`);
      } else if (rsi > 30 && rsi <= 50) {
        bearishScore++;
        bearishReasons.push(`RSI ${rsi.toFixed(0)} — momentum turun`);
      } else if (rsi > 50 && rsi < 70) {
        bullishScore++;
        bullishReasons.push(`RSI ${rsi.toFixed(0)} — momentum naik`);
      } else if (rsi >= 70) {
        bearishScore++;
        bearishReasons.push(`RSI ${rsi.toFixed(0)} — overbought, potensi reversal turun`);
      }
    }

    // 3. MACD signal type
    if (snap.macdSignalType === "bullish_cross") {
      bullishScore++;
      bullishReasons.push("MACD bullish cross");
    } else if (snap.macdSignalType === "bearish_cross") {
      bearishScore++;
      bearishReasons.push("MACD bearish cross");
    }

    // 4. MACD histogram direction
    if (snap.macdHistogram != null) {
      if (snap.macdHistogram > 0) {
        bullishScore++;
        bullishReasons.push(`Histogram MACD positif (+${snap.macdHistogram.toFixed(2)})`);
      } else if (snap.macdHistogram < 0) {
        bearishScore++;
        bearishReasons.push(`Histogram MACD negatif (${snap.macdHistogram.toFixed(2)})`);
      }
    }

    // 5. Price vs EMA50
    if (snap.ema50 != null) {
      if (price > snap.ema50) {
        bullishScore++;
        bullishReasons.push(`Harga di atas EMA50 (${snap.ema50.toFixed(2)})`);
      } else {
        bearishScore++;
        bearishReasons.push(`Harga di bawah EMA50 (${snap.ema50.toFixed(2)})`);
      }
    }

    // 6. Trend (1H)
    if (snap.trend === "bullish") {
      bullishScore++;
      bullishReasons.push("Trend 1H bullish");
    } else if (snap.trend === "bearish") {
      bearishScore++;
      bearishReasons.push("Trend 1H bearish");
    }

    // 7. Bollinger Bands position
    if (snap.bbLower != null && snap.bbUpper != null && snap.bbMiddle != null) {
      if (price < snap.bbLower) {
        bullishScore++;
        bullishReasons.push(`Di bawah BB lower (${snap.bbLower.toFixed(2)}) — potensi reversal naik`);
      } else if (price > snap.bbUpper) {
        bearishScore++;
        bearishReasons.push(`Di atas BB upper (${snap.bbUpper.toFixed(2)}) — potensi reversal turun`);
      } else if (price < snap.bbMiddle) {
        bearishScore += 0.5;
      } else {
        bullishScore += 0.5;
      }
    }

    // 8. Price vs Support/Resistance midpoint
    if (snap.supportLevel != null && snap.resistanceLevel != null) {
      const midSR = (snap.supportLevel + snap.resistanceLevel) / 2;
      if (price > midSR) {
        bullishScore++;
        bullishReasons.push(`Harga di atas S/R midpoint (${midSR.toFixed(2)})`);
      } else {
        bearishScore++;
        bearishReasons.push(`Harga di bawah S/R midpoint (${midSR.toFixed(2)})`);
      }
    }

    // ── Thresholds per sensitivity ────────────────────────────────────────────
    const thresholds = { super_aggressive: 1, aggressive: 2, normal: 3, conservative: 4 };
    const threshold = thresholds[sensitivity];
    const maxPossible = 8.5; // accounting for 0.5 BB mid scores

    // ── Determine command ─────────────────────────────────────────────────────
    let command: "BUY" | "SHORT" | "HOLD";
    let reasons: string[];
    let confidence: number;

    if (bullishScore >= threshold && bullishScore > bearishScore) {
      command = "BUY";
      reasons = bullishReasons;
      confidence = parseFloat(Math.min(0.95, bullishScore / maxPossible).toFixed(2));
    } else if (bearishScore >= threshold && bearishScore > bullishScore) {
      command = "SHORT";
      reasons = bearishReasons;
      confidence = parseFloat(Math.min(0.95, bearishScore / maxPossible).toFixed(2));
    } else {
      command = "HOLD";
      reasons = bullishScore >= bearishScore ? bullishReasons : bearishReasons;
      confidence = parseFloat(Math.min(0.4, (Math.max(bullishScore, bearishScore)) / maxPossible).toFixed(2));
    }

    // ── Minimal TP/SL based on ATR — super_aggressive uses tighter scalping levels ──
    const atr = snap.atr14 ?? 5;
    const tpMultiplier = sensitivity === "super_aggressive" ? 0.20 : 0.45;
    const slMultiplier = sensitivity === "super_aggressive" ? 0.12 : 0.80;
    const minTPDistance = parseFloat((atr * tpMultiplier).toFixed(2));
    const minTP = command === "BUY"
      ? parseFloat((price + minTPDistance).toFixed(2))
      : command === "SHORT"
      ? parseFloat((price - minTPDistance).toFixed(2))
      : null;
    const minSL = command === "BUY"
      ? parseFloat((price - minTPDistance * slMultiplier).toFixed(2))
      : command === "SHORT"
      ? parseFloat((price + minTPDistance * slMultiplier).toFixed(2))
      : null;

    return res.json({
      command,
      reasons,
      minTP,
      minSL,
      minTPDistance,
      confidence,
      price,
      bullishScore: parseFloat(bullishScore.toFixed(1)),
      bearishScore: parseFloat(bearishScore.toFixed(1)),
      sensitivity,
      indicatorsAgeMs,   // ms since last TradingView fetch (30s cycle)
      snapshotAgeMs: indicatorsAgeMs, // kept for frontend backward-compat
      dataSource,        // "live" | "snapshot"
    });
  } catch (err) {
    console.error("[XAUUSD] /mentor-signal error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/multi-timeframe — 1H/4H/Daily trend confluence ──────────────
xauusdRouter.get("/multi-timeframe", async (_req, res) => {
  try {
    const analyses = await getMultiTimeframeAnalysis();
    const confluence = summarizeTimeframeConfluence(analyses);
    return res.json({ timeframes: analyses, confluence });
  } catch (err) {
    console.error("[XAUUSD] /multi-timeframe error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Pearson correlation helper ───────────────────────────────────────────────
function pearsonCorrelation(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 5 || x.length !== y.length) return null;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? null : parseFloat((num / den).toFixed(4));
}

// ─── GET /xauusd/correlation — DXY & US10Y correlation with gold ─────────────
xauusdRouter.get("/correlation", async (_req, res) => {
  try {
    const [analysis, macroRows] = await Promise.all([
      getCorrelationAnalysis(),
      db.select().from(xauusdMacroSnapshotsTable)
        .orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt))
        .limit(150),
    ]);

    // Compute Pearson if ≥50 data points (Feature 2)
    if (macroRows.length >= 50) {
      const dxyPairs = macroRows.filter(r => r.dxy != null).map(r => ({ g: r.goldPrice, d: r.dxy! }));
      const us10yPairs = macroRows.filter(r => r.us10y != null).map(r => ({ g: r.goldPrice, u: r.us10y! }));

      if (dxyPairs.length >= 10) {
        const r = pearsonCorrelation(dxyPairs.map(p => p.g), dxyPairs.map(p => p.d));
        if (r !== null) {
          analysis.dxy.correlation = r;
          const label = r < -0.5 ? "korelasi negatif kuat" : r < -0.2 ? "korelasi negatif lemah" : r < 0.2 ? "hampir tidak berkorelasi" : "korelasi positif (tidak normal)";
          analysis.dxy.interpretation = `Pearson r=${r.toFixed(3)} (${label}, n=${dxyPairs.length}). ` + analysis.dxy.interpretation;
        }
      }
      if (us10yPairs.length >= 10) {
        const r = pearsonCorrelation(us10yPairs.map(p => p.g), us10yPairs.map(p => p.u));
        if (r !== null) {
          analysis.us10y.correlation = r;
          const label = r < -0.5 ? "korelasi negatif kuat" : r < -0.2 ? "korelasi negatif lemah" : r < 0.2 ? "hampir tidak berkorelasi" : "korelasi positif";
          analysis.us10y.interpretation = `Pearson r=${r.toFixed(3)} (${label}, n=${us10yPairs.length}). ` + analysis.us10y.interpretation;
        }
      }
    }

    return res.json({ ...analysis, historyCount: macroRows.length });
  } catch (err) {
    console.error("[XAUUSD] /correlation error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/macro-history — DXY & US10Y historical snapshots ─────────────
xauusdRouter.get("/macro-history", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "100"), 10));
  const rows = await db
    .select()
    .from(xauusdMacroSnapshotsTable)
    .orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/confidence-calibration — bucket win-rate calibration ─────────
xauusdRouter.get("/confidence-calibration", async (_req, res) => {
  try {
    const preds = await db
      .select({ confidence: xauusdPredictionsTable.confidence, isCorrect: xauusdPredictionsTable.isCorrect })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"));

    const bucketEdges = [0.45, 0.55, 0.65, 0.75, 0.85, 1.01];
    const calibration = bucketEdges.slice(0, -1).map((min, i) => {
      const max = bucketEdges[i + 1];
      const inBucket = preds.filter(p => p.confidence >= min && p.confidence < max);
      const wins = inBucket.filter(p => p.isCorrect === true).length;
      return {
        label: `${Math.round(min * 100)}-${Math.round(Math.min(max, 1) * 100)}%`,
        min, max: Math.min(max, 1),
        sampleCount: inBucket.length,
        actualWinRate: inBucket.length >= 3 ? parseFloat((wins / inBucket.length * 100).toFixed(1)) : null,
      };
    });

    return res.json({ calibration, totalVerified: preds.length });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/feature-importance — indicator win-rate analysis ──────────────
xauusdRouter.get("/feature-importance", async (_req, res) => {
  try {
    const preds = await db
      .select({ indicatorsAtPrediction: xauusdPredictionsTable.indicatorsAtPrediction, isCorrect: xauusdPredictionsTable.isCorrect })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"))
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(500);

    if (preds.length < 15) {
      return res.json({ features: [], sampleCount: preds.length, minRequired: 15, overallWinRate: null });
    }

    const totalWins = preds.filter(p => p.isCorrect === true).length;
    const overallWinRate = totalWins / preds.length;

    const indicatorKeys = ["rsiSignal", "emaAlignment", "macdSignalType", "trend"];
    const buckets = new Map<string, { wins: number; total: number }>();

    for (const pred of preds) {
      const ind = (pred.indicatorsAtPrediction ?? {}) as Record<string, unknown>;
      for (const key of indicatorKeys) {
        const val = String(ind[key] ?? "unknown");
        const k = `${key}::${val}`;
        if (!buckets.has(k)) buckets.set(k, { wins: 0, total: 0 });
        const b = buckets.get(k)!;
        b.total++;
        if (pred.isCorrect === true) b.wins++;
      }
    }

    const features = Array.from(buckets.entries())
      .filter(([, b]) => b.total >= 5)
      .map(([key, b]) => {
        const [indicator, value] = key.split("::");
        const winRate = b.wins / b.total;
        return {
          indicator: indicator ?? key,
          value: value ?? "?",
          sampleCount: b.total,
          winRate: parseFloat((winRate * 100).toFixed(1)),
          lift: parseFloat(((winRate / overallWinRate - 1) * 100).toFixed(1)),
        };
      })
      .sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift))
      .slice(0, 16);

    return res.json({ features, sampleCount: preds.length, overallWinRate: parseFloat((overallWinRate * 100).toFixed(1)), minRequired: 15 });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/snapshots — history of saved snapshots ──────────────────────
xauusdRouter.get("/snapshots", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10));
  const spikesOnly = req.query.spikesOnly === "true";

  const rows = await db
    .select()
    .from(xauusdSnapshotsTable)
    .where(spikesOnly ? eq(xauusdSnapshotsTable.isSpike, true) : undefined)
    .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
    .limit(limit);

  return res.json(rows);
});

// ─── GET /xauusd/brain — all stored knowledge ────────────────────────────────
xauusdRouter.get("/brain", async (req, res) => {
  const category = req.query.category as string | undefined;
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));

  const rows = await db
    .select()
    .from(xauusdBrainTable)
    .where(
      category
        ? and(eq(xauusdBrainTable.category, category), eq(xauusdBrainTable.isActive, true))
        : eq(xauusdBrainTable.isActive, true)
    )
    .orderBy(desc(xauusdBrainTable.confidence), desc(xauusdBrainTable.createdAt))
    .limit(limit);

  return res.json(rows);
});

// ─── GET /xauusd/brain/stats — summary stats ─────────────────────────────────
xauusdRouter.get("/brain/stats", async (_req, res) => {
  const all = await db
    .select({
      category: xauusdBrainTable.category,
    })
    .from(xauusdBrainTable)
    .where(eq(xauusdBrainTable.isActive, true));

  const byCategory: Record<string, number> = {};
  for (const row of all) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  }

  const totalQuestions = await db
    .select({ id: xauusdQuestionsLogTable.id })
    .from(xauusdQuestionsLogTable);

  const totalPredictions = await db
    .select({
      isCorrect: xauusdPredictionsTable.isCorrect,
      status: xauusdPredictionsTable.status,
      predictionType: xauusdPredictionsTable.predictionType,
    })
    .from(xauusdPredictionsTable);

  const verifiedPreds = totalPredictions.filter(
    (p: { isCorrect: boolean | null; status: string }) => p.status === "verified" || p.status === "revised"
  );
  const correctPreds = verifiedPreds.filter((p: { isCorrect: boolean | null }) => p.isCorrect === true);
  const accuracy =
    verifiedPreds.length > 0
      ? Math.round((correctPreds.length / verifiedPreds.length) * 100)
      : null;

  // Perbaikan #1: akurasi dipecah per predictionType — "main" adalah prediksi
  // yang benar-benar ditampilkan ke user, sedangkan "training" hanya untuk
  // melatih AI setiap siklus (5 menit) dan jauh lebih noisy. Mencampur
  // keduanya membuat angka akurasi keseluruhan menyesatkan.
  const mainVerified = verifiedPreds.filter((p: { predictionType: string }) => p.predictionType === "main");
  const mainCorrect = mainVerified.filter((p: { isCorrect: boolean | null }) => p.isCorrect === true);
  const mainAccuracy =
    mainVerified.length > 0
      ? Math.round((mainCorrect.length / mainVerified.length) * 100)
      : null;

  const trainingVerified = verifiedPreds.filter((p: { predictionType: string }) => p.predictionType === "training");
  const trainingCorrect = trainingVerified.filter((p: { isCorrect: boolean | null }) => p.isCorrect === true);
  const trainingAccuracy =
    trainingVerified.length > 0
      ? Math.round((trainingCorrect.length / trainingVerified.length) * 100)
      : null;

  return res.json({
    totalInsights: all.length,
    byCategory,
    totalQuestionsAsked: totalQuestions.length,
    totalPredictions: totalPredictions.length,
    verifiedPredictions: verifiedPreds.length,
    correctPredictions: correctPreds.length,
    predictionAccuracy: accuracy,
    // Statistik baru — lebih jujur karena dipisah per jenis prediksi
    mainPredictionAccuracy: mainAccuracy,
    mainPredictionsVerified: mainVerified.length,
    mainPredictionsCorrect: mainCorrect.length,
    trainingPredictionAccuracy: trainingAccuracy,
    trainingPredictionsVerified: trainingVerified.length,
    trainingPredictionsCorrect: trainingCorrect.length,
  });
});

// ─── DELETE /xauusd/brain/:id — deactivate a brain entry (admin only) ────────
xauusdRouter.delete("/brain/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db
    .update(xauusdBrainTable)
    .set({ isActive: false })
    .where(eq(xauusdBrainTable.id, id));
  return res.json({ ok: true });
});

// ─── GET /xauusd/questions — learning questions log ──────────────────────────
xauusdRouter.get("/questions", async (req, res) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "30"), 10));
  const rows = await db
    .select()
    .from(xauusdQuestionsLogTable)
    .orderBy(desc(xauusdQuestionsLogTable.askedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/predictions — prediction history (opsional ?type=main|training) ─
xauusdRouter.get("/predictions", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "20"), 10));
  const typeFilter = req.query.type as string | undefined;
  const rows = await db
    .select()
    .from(xauusdPredictionsTable)
    .where(
      typeFilter === "main" ? eq(xauusdPredictionsTable.predictionType, "main")
        : typeFilter === "training" ? eq(xauusdPredictionsTable.predictionType, "training")
        : undefined
    )
    .orderBy(desc(xauusdPredictionsTable.predictedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/news — latest XAUUSD news ───────────────────────────────────
xauusdRouter.get("/news", async (req, res) => {
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20"), 10));
  const rows = await db
    .select()
    .from(xauusdNewsTable)
    .orderBy(desc(xauusdNewsTable.fetchedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/learning-log — cycle history ────────────────────────────────
xauusdRouter.get("/learning-log", async (req, res) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "30"), 10));
  const rows = await db
    .select()
    .from(xauusdLearningLogTable)
    .orderBy(desc(xauusdLearningLogTable.cycleAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/engine-status — is the brain running? ───────────────────────
xauusdRouter.get("/engine-status", (_req, res) => {
  return res.json(getEngineStatus());
});

// ─── GET /xauusd/market-status — apakah market XAUUSD sedang buka? ──────────
xauusdRouter.get("/market-status", (_req, res) => {
  const status = isXauusdMarketOpen();
  return res.json({
    ...status,
    timestamp: new Date().toISOString(),
  });
});

// ─── Auth guards ──────────────────────────────────────────────────────────────
function requireAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Admin operations disabled: SESSION_SECRET not set" });
    }
    return next();
  }
  const auth = (req.headers.authorization as string) ?? (req.query.token as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    return res.status(403).json({ error: "Forbidden — admin login diperlukan" });
  }
  return next();
}

async function requireMember(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const auth = (req.headers.authorization as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Login diperlukan — silakan login sebagai member atau admin" });

  // Admin token juga berlaku untuk akses member
  const secret = process.env.SESSION_SECRET;
  if (secret && token === secret) return next();

  // Cek member_password lama (backward compat)
  try {
    const memberPwd = await getMemberPassword();
    if (memberPwd && token === memberPwd) return next();
  } catch { /* lanjut */ }

  // Cek session token member baru (email+password)
  try {
    const { findMemberBySessionToken } = await import("../lib/members-db.js");
    const member = await findMemberBySessionToken(token);
    if (member?.emailVerified) return next();
  } catch { /* lanjut */ }

  return res.status(401).json({ error: "Akses member diperlukan — silakan login" });
}

// ─── POST /xauusd/engine/start — manually start engine ───────────────────────
xauusdRouter.post("/engine/start", requireAdmin, (_req, res) => {
  startXauusdBrainEngine();
  return res.json({ ok: true, status: getEngineStatus() });
});

// ─── POST /xauusd/engine/stop — manually stop engine ─────────────────────────
xauusdRouter.post("/engine/stop", requireAdmin, (_req, res) => {
  stopXauusdBrainEngine();
  return res.json({ ok: true, status: getEngineStatus() });
});

// ─── POST /xauusd/engine/toggle — on/off persists across restarts ────────────
xauusdRouter.post("/engine/toggle", requireAdmin, async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled harus boolean" });
  try {
    await setXauusdBrainEnabled(enabled);
    if (enabled) {
      startXauusdBrainEngine();
    } else {
      stopXauusdBrainEngine();
    }
    return res.json({ ok: true, enabled, status: getEngineStatus() });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/learn-now — trigger immediate learning cycle ────────────────
xauusdRouter.post("/learn-now", requireAdmin, async (_req, res) => {
  try {
    const result = await runLearningCycle();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/engine/extreme/start — mulai mode belajar ekstrem ──────────
xauusdRouter.post("/engine/extreme/start", requireAdmin, (req, res) => {
  const { target, questionsPerCycle } = req.body as { target?: number; questionsPerCycle?: number };
  if (typeof target !== "number" || !Number.isInteger(target) || target < 1 || target > 10_000) {
    return res.status(400).json({ error: "target harus bilangan bulat antara 1 hingga 10.000" });
  }
  if (questionsPerCycle !== undefined && (typeof questionsPerCycle !== "number" || !Number.isInteger(questionsPerCycle) || questionsPerCycle < 3 || questionsPerCycle > 20)) {
    return res.status(400).json({ error: "questionsPerCycle harus bilangan bulat antara 3 hingga 20" });
  }
  try {
    startExtremeLearningMode(target, questionsPerCycle);
    return res.json({ ok: true, message: `Mode ekstrem dimulai — target ${target} pertanyaan`, status: getEngineStatus() });
  } catch (err) {
    return res.status(400).json({ error: String(err) });
  }
});

// ─── POST /xauusd/engine/extreme/stop — hentikan mode belajar ekstrem ────────
xauusdRouter.post("/engine/extreme/stop", requireAdmin, (_req, res) => {
  stopExtremeLearningMode();
  return res.json({ ok: true, message: "Permintaan berhenti dikirim", status: getEngineStatus() });
});

// ─── GET /xauusd/settings — current settings summary (no raw key exposed) ────
xauusdRouter.get("/settings", async (_req, res) => {
  try {
    const summary = await getSettingsSummary();
    return res.json({ ...summary, validTimeframes: VALID_TIMEFRAMES });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/settings/deepseek-key — set/clear the DeepSeek API key ─────
xauusdRouter.post("/settings/deepseek-key", requireAdmin, async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  try {
    if (!apiKey || apiKey.trim().length === 0) {
      await clearDeepseekApiKey();
      return res.json({ ok: true, cleared: true });
    }
    await setDeepseekApiKey(apiKey);
    return res.json({ ok: true, cleared: false });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/predict — on-demand prediction (mode: normal|technical|fundamental) ─
xauusdRouter.post("/predict", requireMember, async (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !["normal", "technical", "fundamental"].includes(mode)) {
    return res.status(400).json({ error: "mode harus salah satu dari: normal, technical, fundamental" });
  }
  try {
    const result = await generateXauusdOnDemandPrediction(mode as "normal" | "technical" | "fundamental");
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghasilkan prediksi. Coba lagi." });
  }
});

// ─── POST /xauusd/settings/timeframe — set prediction timeframe (15|30 min) ──
xauusdRouter.post("/settings/timeframe", requireAdmin, async (req, res) => {
  const { minutes } = req.body as { minutes?: number };
  try {
    if (typeof minutes !== "number" || !VALID_TIMEFRAMES.includes(minutes as 15 | 30)) {
      return res.status(400).json({ error: `minutes must be one of ${VALID_TIMEFRAMES.join(", ")}` });
    }
    await setPredictionTimeframeMinutes(minutes);
    return res.json({ ok: true, predictionTimeframeMinutes: minutes });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/settings/whatsapp — set WhatsApp number + enable/disable ───
xauusdRouter.post("/settings/whatsapp", requireAdmin, async (req, res) => {
  const { number, enabled } = req.body as { number?: string; enabled?: boolean };
  try {
    if (typeof number === "string") {
      await setWhatsappNumber(number);
    }
    if (typeof enabled === "boolean") {
      await setWhatsappEnabled(enabled);
    }
    const summary = await getSettingsSummary();
    return res.json({ ok: true, whatsapp: summary.whatsapp });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/settings/whatsapp/test — send a test WhatsApp message ──────
xauusdRouter.post("/settings/whatsapp/test", requireAdmin, async (_req, res) => {
  try {
    const result = await sendTestWhatsappMessage();
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/backtest — custom rule backtest against historical snapshots ─
xauusdRouter.post("/backtest", async (req, res) => {
  const {
    rsiBuy = 35,
    rsiSell = 65,
    requireEmaBullish = false,
    direction = "long",
    maxHoldPeriods = 10,
  } = (req.body ?? {}) as {
    rsiBuy?: number; rsiSell?: number; requireEmaBullish?: boolean;
    direction?: "long" | "short" | "both"; maxHoldPeriods?: number;
  };

  try {
    const snaps = await db
      .select({
        snapshotAt: xauusdSnapshotsTable.snapshotAt,
        price: xauusdSnapshotsTable.price,
        rsi14: xauusdSnapshotsTable.rsi14,
        emaAlignment: xauusdSnapshotsTable.emaAlignment,
      })
      .from(xauusdSnapshotsTable)
      .orderBy(xauusdSnapshotsTable.snapshotAt)
      .limit(2000);

    if (snaps.length < 10) {
      return res.json({ error: "Tidak cukup data snapshot (minimal 10).", totalTrades: 0, equity: [], trades: [], dataPoints: snaps.length });
    }

    interface Trade {
      entryPrice: number; exitPrice: number; direction: string;
      pnlPct: number; win: boolean; holdPeriods: number; entryAt: string;
    }

    const trades: Trade[] = [];
    let inTrade = false;
    let entryIdx = -1;
    let entryDir: "long" | "short" = "long";

    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i];
      if (!s.rsi14) continue;
      if (!inTrade) {
        let doLong = (direction === "long" || direction === "both") && s.rsi14 < rsiBuy;
        let doShort = (direction === "short" || direction === "both") && s.rsi14 > rsiSell;
        if (requireEmaBullish) {
          if (doLong) doLong = s.emaAlignment === "bullish_stack";
          if (doShort) doShort = s.emaAlignment === "bearish_stack";
        }
        if (doLong || doShort) { inTrade = true; entryIdx = i; entryDir = doLong ? "long" : "short"; }
      } else {
        const entry = snaps[entryIdx];
        const holdPeriods = i - entryIdx;
        const exitOnRsi = entryDir === "long" ? s.rsi14 > rsiSell : s.rsi14 < rsiBuy;
        if (exitOnRsi || holdPeriods >= maxHoldPeriods) {
          const pnlPct = entryDir === "long"
            ? (s.price - entry.price) / entry.price * 100
            : (entry.price - s.price) / entry.price * 100;
          trades.push({
            entryPrice: entry.price, exitPrice: s.price, direction: entryDir,
            pnlPct: parseFloat(pnlPct.toFixed(3)), win: pnlPct > 0,
            holdPeriods, entryAt: entry.snapshotAt.toISOString(),
          });
          inTrade = false;
        }
      }
    }

    const wins = trades.filter(t => t.win).length;
    const losses = trades.length - wins;
    const winRate = trades.length > 0 ? Math.round(wins / trades.length * 100) : 0;

    const INITIAL = 10000;
    let capital = INITIAL; let peak = INITIAL; let maxDrawdown = 0;
    const equity: number[] = [INITIAL];
    for (const t of trades) {
      const risk = capital * 0.02;
      const pnl = t.win ? risk * Math.max(0.5, Math.abs(t.pnlPct)) : -risk;
      capital += pnl;
      if (capital > peak) peak = capital;
      const dd = (peak - capital) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
      equity.push(parseFloat(capital.toFixed(2)));
    }

    const grossWin = trades.filter(t => t.win).reduce((s, t) => s + t.pnlPct, 0);
    const grossLoss = trades.filter(t => !t.win).reduce((s, t) => s + Math.abs(t.pnlPct), 0);

    return res.json({
      rules: { rsiBuy, rsiSell, requireEmaBullish, direction, maxHoldPeriods },
      totalTrades: trades.length, wins, losses, winRate,
      profitFactor: grossLoss > 0 ? parseFloat((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? 99 : 0,
      maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
      avgWin: wins > 0 ? parseFloat((grossWin / wins).toFixed(3)) : 0,
      avgLoss: losses > 0 ? parseFloat((grossLoss / losses).toFixed(3)) : 0,
      totalReturn: parseFloat(((capital - INITIAL) / INITIAL * 100).toFixed(2)),
      finalCapital: parseFloat(capital.toFixed(2)),
      equity, trades: trades.slice(-20), dataPoints: snaps.length,
    });
  } catch (err) {
    console.error("[XAUUSD] /backtest error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/chat — chat with the XAUUSD AI agent (member only) ─────────
xauusdRouter.post("/chat", requireMember, async (req, res) => {
  const { message, sessionId } = req.body as {
    message?: string;
    sessionId?: string;
  };

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    // Build rich live context — all queries in parallel
    let contextData = "";
    try {
      const [indRes, insightsRes, predsRes, newsRes] = await Promise.allSettled([
        fetchXauusdIndicators("1h"),
        db.select({ title: xauusdBrainTable.title, content: xauusdBrainTable.content, category: xauusdBrainTable.category })
          .from(xauusdBrainTable)
          .where(eq(xauusdBrainTable.isActive, true))
          .orderBy(desc(xauusdBrainTable.confidence))
          .limit(6),
        db.select({
          direction: xauusdPredictionsTable.direction,
          confidence: xauusdPredictionsTable.confidence,
          targetPrice: xauusdPredictionsTable.targetPrice,
          tp2: xauusdPredictionsTable.tp2,
          tp3: xauusdPredictionsTable.tp3,
          entryLow: xauusdPredictionsTable.entryLow,
          entryHigh: xauusdPredictionsTable.entryHigh,
          stopLoss: xauusdPredictionsTable.stopLoss,
          status: xauusdPredictionsTable.status,
          isCorrect: xauusdPredictionsTable.isCorrect,
          reasoning: xauusdPredictionsTable.reasoning,
          predictedAt: xauusdPredictionsTable.predictedAt,
        })
          .from(xauusdPredictionsTable)
          .orderBy(desc(xauusdPredictionsTable.predictedAt))
          .limit(3),
        db.select({ title: xauusdNewsTable.title, sentiment: xauusdNewsTable.sentiment, aiAnalysis: xauusdNewsTable.aiAnalysis })
          .from(xauusdNewsTable)
          .orderBy(desc(xauusdNewsTable.publishedAt))
          .limit(3),
      ]);

      const ind = indRes.status === "fulfilled" ? indRes.value : null;
      const topInsights = insightsRes.status === "fulfilled" ? insightsRes.value : [];
      const recentPreds = predsRes.status === "fulfilled" ? predsRes.value : [];
      const recentNews = newsRes.status === "fulfilled" ? newsRes.value : [];

      if (ind) {
        // Win rate dari prediksi terverifikasi
        const verified = recentPreds.filter((p) => p.status === "verified" || p.status === "revised");
        const correct = verified.filter((p) => p.isCorrect === true).length;
        const winRateStr = verified.length > 0
          ? `${((correct / verified.length) * 100).toFixed(0)}% (${correct}/${verified.length})`
          : "belum ada data";

        const lastPred = recentPreds[0];

        contextData = `=== DATA LIVE XAUUSD ===
Harga: ${ind.price} | Open: ${ind.open} | H: ${ind.high} | L: ${ind.low}
RSI14: ${ind.rsi14} → ${ind.rsiSignal}
EMA 9/21/50/200: ${ind.ema9} / ${ind.ema21} / ${ind.ema50} / ${ind.ema200}
EMA Alignment: ${ind.emaAlignment}
MACD: line=${ind.macdLine} | signal=${ind.macdSignal} | hist=${ind.macdHistogram} → ${ind.macdSignalType}
Bollinger: Upper=${ind.bbUpper} | Mid=${ind.bbMiddle} | Lower=${ind.bbLower} | Width=${ind.bbWidth}%
ATR14: ${ind.atr14} | Trend: ${ind.trend}
Support: ${ind.supportLevel} | Resistance: ${ind.resistanceLevel}
${lastPred ? `\n=== PREDIKSI AKTIF AI ===
Arah: ${lastPred.direction.toUpperCase()} | Confidence: ${((lastPred.confidence ?? 0) * 100).toFixed(0)}% | Status: ${lastPred.status}
Entry: ${lastPred.entryLow}–${lastPred.entryHigh} | SL: ${lastPred.stopLoss} (invalidasi thesis)
TP1: ${lastPred.targetPrice} | TP2: ${lastPred.tp2 ?? "-"} | TP3: ${lastPred.tp3 ?? "-"}
Alasan: ${lastPred.reasoning?.slice(0, 200) ?? "-"}
Win Rate 3 pred terakhir: ${winRateStr}` : ""}
${recentNews.length > 0 ? `\n=== SENTIMEN BERITA TERBARU ===
${recentNews.map((n) => `• [${(n.sentiment ?? "neutral").toUpperCase()}] ${n.title}${n.aiAnalysis ? ` — ${n.aiAnalysis}` : ""}`).join("\n")}` : ""}
${topInsights.length > 0 ? `\n=== PENGETAHUAN OTAK AI (${topInsights.length} insights teratas) ===
${topInsights.map((ins) => `[${ins.category}] ${ins.title}\n  → ${ins.content.slice(0, 180).replace(/\n/g, " ")}…`).join("\n")}` : ""}`;
      }
    } catch {
      // context injection optional — chat tetap berjalan tanpa konteks
    }

    const reply = await chatWithAgent("xauusd", sessionId, message, contextData);
    return res.json(reply);
  } catch (err) {
    console.error("[XAUUSD] /chat error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/ea-signal — Mentor Mode endpoint for MetaTrader EA ──────────
// Auth: ?key=<ea_api_key> atau header Authorization: Bearer <key>
// Format JSON (default) atau ?format=plain → "COMMAND|PRICE|TP|SL|CONFIDENCE"
// Command: BUY | SELL | HOLD  (SELL = SHORT, disesuaikan untuk MT4/MT5)
xauusdRouter.get("/ea-signal", async (req, res) => {
  try {
    // ── Auth EA key ─────────────────────────────────────────────────────────
    const authHeader = (req.headers.authorization as string | undefined) ?? "";
    const providedKey =
      (req.query.key as string | undefined) ??
      authHeader.replace(/^Bearer\s+/i, "");

    if (!providedKey) {
      return res.status(401).json({ error: "EA API key diperlukan (?key=... atau Authorization: Bearer ...)" });
    }
    const keyValid = await validateEaApiKey(providedKey);
    if (!keyValid) {
      return res.status(403).json({ error: "EA API key tidak valid" });
    }

    // ── Reuse mentor-signal logic ────────────────────────────────────────────
    const sensitivity = (["super_aggressive", "aggressive", "normal", "conservative"].includes(req.query.sensitivity as string)
      ? req.query.sensitivity
      : "normal") as "super_aggressive" | "aggressive" | "normal" | "conservative";

    const livePrice = getLatestLivePrice();
    const price = livePrice?.price ?? null;

    const cached = getLatestMentorIndicators();
    const useLiveCache = cached.indicators !== null && !cached.stale;
    let snap: typeof cached.indicators | null = useLiveCache ? cached.indicators : null;
    let dataSource: "live" | "snapshot" = "live";

    if (!snap) {
      const snapRows = await db.select().from(xauusdSnapshotsTable).orderBy(desc(xauusdSnapshotsTable.snapshotAt)).limit(1);
      if (!snapRows.length) {
        const noDataResp = { command: "HOLD", price, tp: null, sl: null, confidence: 0, dataSource: "snapshot", timestamp: new Date().toISOString(), sensitivity };
        if (req.query.format === "plain") return res.type("text/plain").send(`HOLD|${price ?? 0}|0|0|0`);
        return res.json(noDataResp);
      }
      const row = snapRows[0];
      const bbW = row.bbUpper != null && row.bbLower != null && row.bbMiddle != null && row.bbMiddle !== 0
        ? parseFloat(((row.bbUpper - row.bbLower) / row.bbMiddle * 100).toFixed(3)) : null;
      snap = {
        price: row.price, open: row.price, high: row.price, low: row.price, volume: row.volume ?? 0,
        rsi14: row.rsi14, ema9: row.ema9, ema21: row.ema21, ema50: row.ema50, ema200: row.ema200,
        macdLine: row.macdLine, macdSignal: row.macdSignal, macdHistogram: row.macdHistogram,
        bbUpper: row.bbUpper, bbMiddle: row.bbMiddle, bbLower: row.bbLower, bbWidth: bbW, atr14: row.atr14,
        trend: (row.trend as "bullish" | "bearish" | "sideways") ?? "sideways",
        rsiSignal: (row.rsiSignal as "overbought" | "oversold" | "neutral") ?? "neutral",
        macdSignalType: (row.macdSignalType as "bullish_cross" | "bearish_cross" | "neutral") ?? "neutral",
        emaAlignment: (row.emaAlignment as "bullish_stack" | "bearish_stack" | "mixed") ?? "mixed",
        supportLevel: row.supportLevel, resistanceLevel: row.resistanceLevel,
      };
      dataSource = "snapshot";
    }

    const p = price ?? snap.price ?? 0;
    let bullishScore = 0, bearishScore = 0;
    if (snap.emaAlignment === "bullish_stack") bullishScore++; else if (snap.emaAlignment === "bearish_stack") bearishScore++;
    if (snap.rsi14 != null) {
      if (snap.rsi14 <= 30) bullishScore++; else if (snap.rsi14 <= 50) bearishScore++;
      else if (snap.rsi14 < 70) bullishScore++; else bearishScore++;
    }
    if (snap.macdSignalType === "bullish_cross") bullishScore++; else if (snap.macdSignalType === "bearish_cross") bearishScore++;
    if (snap.macdHistogram != null) { if (snap.macdHistogram > 0) bullishScore++; else if (snap.macdHistogram < 0) bearishScore++; }
    if (snap.ema50 != null) { if (p > snap.ema50) bullishScore++; else bearishScore++; }
    if (snap.trend === "bullish") bullishScore++; else if (snap.trend === "bearish") bearishScore++;
    if (snap.bbLower != null && snap.bbUpper != null && snap.bbMiddle != null) {
      if (p < snap.bbLower) bullishScore++; else if (p > snap.bbUpper) bearishScore++;
      else if (p < snap.bbMiddle) bearishScore += 0.5; else bullishScore += 0.5;
    }
    if (snap.supportLevel != null && snap.resistanceLevel != null) {
      const mid = (snap.supportLevel + snap.resistanceLevel) / 2;
      if (p > mid) bullishScore++; else bearishScore++;
    }

    const thresholds = { super_aggressive: 1, aggressive: 2, normal: 3, conservative: 4 };
    const threshold = thresholds[sensitivity];
    const maxPossible = 8.5;
    let rawCommand: "BUY" | "SELL" | "HOLD";
    let confidence: number;
    if (bullishScore >= threshold && bullishScore > bearishScore) {
      rawCommand = "BUY"; confidence = parseFloat(Math.min(0.95, bullishScore / maxPossible).toFixed(2));
    } else if (bearishScore >= threshold && bearishScore > bullishScore) {
      rawCommand = "SELL"; confidence = parseFloat(Math.min(0.95, bearishScore / maxPossible).toFixed(2)); // SELL = SHORT untuk EA
    } else {
      rawCommand = "HOLD"; confidence = parseFloat(Math.min(0.4, Math.max(bullishScore, bearishScore) / maxPossible).toFixed(2));
    }

    const atr = snap.atr14 ?? 5;
    const eaTpMultiplier = sensitivity === "super_aggressive" ? 0.20 : 0.45;
    const eaSlMultiplier = sensitivity === "super_aggressive" ? 0.12 : 0.80;
    const tpDist = parseFloat((atr * eaTpMultiplier).toFixed(2));
    const slDist = parseFloat((tpDist * eaSlMultiplier).toFixed(2));
    const tp = rawCommand === "BUY" ? parseFloat((p + tpDist).toFixed(2))
      : rawCommand === "SELL" ? parseFloat((p - tpDist).toFixed(2)) : null;
    const sl = rawCommand === "BUY" ? parseFloat((p - slDist).toFixed(2))
      : rawCommand === "SELL" ? parseFloat((p + slDist).toFixed(2)) : null;

    const timestamp = new Date().toISOString();

    if (req.query.format === "plain") {
      // Format: COMMAND|PRICE|TP|SL|CONFIDENCE  — mudah di-parse MQL4/5 StringSplit
      return res.type("text/plain").send(`${rawCommand}|${p.toFixed(2)}|${tp ?? 0}|${sl ?? 0}|${confidence}`);
    }

    return res.json({
      command: rawCommand,
      price: p,
      tp,
      sl,
      tpDistance: tp !== null ? parseFloat(Math.abs(tp - p).toFixed(2)) : null,
      confidence,
      bullishScore: parseFloat(bullishScore.toFixed(1)),
      bearishScore: parseFloat(bearishScore.toFixed(1)),
      sensitivity,
      dataSource,
      timestamp,
    });
  } catch (err) {
    console.error("[XAUUSD] /ea-signal error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/ea-account — EA push data akun MT5 ke server ───────────────
// EA memanggil ini setiap kali poll sinyal (setiap 2 detik)
xauusdRouter.post("/ea-account", async (req, res) => {
  try {
    const authHeader = (req.headers.authorization as string | undefined) ?? "";
    const providedKey =
      (req.query.key as string | undefined) ??
      authHeader.replace(/^Bearer\s+/i, "");

    if (!providedKey) return res.status(401).json({ error: "EA key required" });
    const keyValid = await validateEaApiKey(providedKey);
    if (!keyValid) return res.status(403).json({ error: "Invalid EA key" });

    const body = req.body as Partial<EaAccountData>;
    eaAccountStore = {
      balance:       body.balance       ?? 0,
      equity:        body.equity        ?? 0,
      freeMargin:    body.freeMargin    ?? 0,
      margin:        body.margin        ?? 0,
      pnl:           body.pnl          ?? 0,
      positions:     body.positions     ?? [],
      accountName:   body.accountName   ?? "",
      accountNumber: body.accountNumber ?? 0,
      broker:        body.broker        ?? "",
      leverage:      body.leverage      ?? 0,
      currency:      body.currency      ?? "USD",
      updatedAt:     new Date().toISOString(),
    };
    eaAccountUpdatedAt = Date.now();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/ea-account — frontend fetch data akun MT5 ───────────────────
xauusdRouter.get("/ea-account", async (_req, res) => {
  if (!eaAccountStore || Date.now() - eaAccountUpdatedAt > EA_ACCOUNT_STALE_MS) {
    return res.json({ connected: false, data: null });
  }
  return res.json({ connected: true, data: eaAccountStore });
});
