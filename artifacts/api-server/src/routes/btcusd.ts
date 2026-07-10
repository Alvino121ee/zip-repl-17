/**
 * BTCUSD AI routes — realtime data, brain, learning log, predictions, chat
 * Feature parity dengan XAUUSD: multi-timeframe, correlation, confidence-calibration,
 * feature-importance, snapshots, backtest, engine start/stop
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  btcusdSnapshotsTable, btcusdBrainTable, btcusdQuestionsLogTable,
  btcusdPredictionsTable, btcusdLearningLogTable,
} from "@workspace/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";
import {
  fetchBtcusdLivePrice,
  fetchBtcusdIndicators,
  getMultiBtcTimeframeAnalysis,
  summarizeBtcTimeframeConfluence,
  getBtcCorrelationAnalysis,
} from "../lib/btcusd-data.js";
import { getLatestBtcusdLivePrice } from "../lib/btcusd-live-price.js";
import {
  getBtcEngineStatus, runBtcLearningCycle,
  startBtcExtremeLearningMode, stopBtcExtremeLearningMode,
  startBtcBrainEngine, stopBtcBrainEngine,
  generateBtcOnDemandPrediction,
} from "../lib/btcusd-brain-engine.js";
import {
  getBtcQuantStatus,
  getBtcQuantRecentPredictions,
} from "../lib/btc-quant-engine.js";
import { getBtcTechnicalBrainStats } from "../lib/btc-quant-technical-brain.js";
import { getBtcFundamentalBrainStats } from "../lib/btc-quant-fundamental-brain.js";
import { getBtcMacroBrainStats } from "../lib/btc-quant-macro-brain.js";
import { db } from "@workspace/db";
import {
  btcQuantBrainPredictionsTable,
  btcQuantTechnicalBrainTable,
  btcQuantFundamentalBrainTable,
  btcQuantMacroBrainTable,
} from "@workspace/db/schema";
import { sql as drizzleSql, eq as drizzleEq } from "drizzle-orm";

type Req = import("express").Request;
type Res = import("express").Response;
type Next = import("express").NextFunction;

function requireAdmin(req: Req, res: Res, next: Next) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) { if (process.env.NODE_ENV !== "production") return next(); return res.status(403).json({ error: "Forbidden" }); }
  const token = ((req.headers.authorization as string) ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secret) return res.status(403).json({ error: "Forbidden — admin login diperlukan" });
  return next();
}

async function requireMember(req: Req, res: Res, next: Next) {
  const token = ((req.headers.authorization as string) ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Login diperlukan" });
  // Hanya session token member (email+password) yang berlaku — admin tidak boleh akses member
  try {
    const { findMemberBySessionToken } = await import("../lib/members-db.js");
    const member = await findMemberBySessionToken(token);
    if (member?.emailVerified) return next();
  } catch { /**/ }
  return res.status(401).json({ error: "Akses member diperlukan" });
}

export const btcusdRouter = Router();

// ─── Live price — cached 1s realtime ticker (bukan hit API tiap request) ─────
btcusdRouter.get("/live-price", (_req, res) => {
  res.json(getLatestBtcusdLivePrice());
});

// ─── Latest snapshot (current indicators) ────────────────────────────────────
btcusdRouter.get("/snapshot", async (_req, res) => {
  try {
    // Try live data first, fall back to DB
    try {
      const live = await fetchBtcusdIndicators("1h");
      const [last] = await db.select().from(btcusdSnapshotsTable)
        .orderBy(desc(btcusdSnapshotsTable.snapshotAt)).limit(1);
      return res.json({ ...live, lastSnapshotAt: last?.snapshotAt ?? null, lastSavedPrice: last?.price ?? null });
    } catch { /**/ }
    const [snap] = await db.select().from(btcusdSnapshotsTable)
      .orderBy(desc(btcusdSnapshotsTable.snapshotAt)).limit(1);
    if (!snap) return res.status(404).json({ error: "No snapshot yet" });
    return res.json(snap);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Snapshots history ────────────────────────────────────────────────────────
btcusdRouter.get("/snapshots", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10));
  const spikesOnly = req.query.spikesOnly === "true";
  try {
    const rows = await db.select().from(btcusdSnapshotsTable)
      .where(spikesOnly ? eq(btcusdSnapshotsTable.isSpike, true) : undefined)
      .orderBy(desc(btcusdSnapshotsTable.snapshotAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Multi-timeframe analysis ─────────────────────────────────────────────────
btcusdRouter.get("/multi-timeframe", async (_req, res) => {
  try {
    const analyses = await getMultiBtcTimeframeAnalysis();
    const confluence = summarizeBtcTimeframeConfluence(analyses);
    res.json({ timeframes: analyses, confluence });
  } catch (err) {
    console.error("[BTCUSD] /multi-timeframe error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Correlation analysis (DXY / Nasdaq / ETH) ───────────────────────────────
btcusdRouter.get("/correlation", async (_req, res) => {
  try {
    const data = await getBtcCorrelationAnalysis();
    res.json(data);
  } catch (err) {
    console.error("[BTCUSD] /correlation error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Confidence calibration ───────────────────────────────────────────────────
btcusdRouter.get("/confidence-calibration", async (_req, res) => {
  try {
    const preds = await db
      .select({ confidence: btcusdPredictionsTable.confidence, isCorrect: btcusdPredictionsTable.isCorrect })
      .from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"));

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

    res.json({ calibration, totalVerified: preds.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Feature importance ───────────────────────────────────────────────────────
btcusdRouter.get("/feature-importance", async (_req, res) => {
  try {
    const preds = await db
      .select({ indicatorsAtPrediction: btcusdPredictionsTable.indicatorsAtPrediction, isCorrect: btcusdPredictionsTable.isCorrect })
      .from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"))
      .orderBy(desc(btcusdPredictionsTable.predictedAt))
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

// ─── Brain entries ────────────────────────────────────────────────────────────
btcusdRouter.get("/brain", async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));
    const category = req.query.category as string | undefined;
    const rows = await db.select().from(btcusdBrainTable)
      .where(category
        ? and(eq(btcusdBrainTable.isActive, true), eq(btcusdBrainTable.category, category))
        : eq(btcusdBrainTable.isActive, true))
      .orderBy(desc(btcusdBrainTable.confidence), desc(btcusdBrainTable.createdAt))
      .limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Brain stats ──────────────────────────────────────────────────────────────
btcusdRouter.get("/brain/stats", async (_req, res) => {
  try {
    const all = await db
      .select({ category: btcusdBrainTable.category })
      .from(btcusdBrainTable)
      .where(eq(btcusdBrainTable.isActive, true));

    const byCategory: Record<string, number> = {};
    for (const row of all) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    }

    const [qTotal] = await db.select({ count: sql<number>`count(*)` }).from(btcusdQuestionsLogTable);
    const [predTotal] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable);
    const [correctPreds] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable)
      .where(and(eq(btcusdPredictionsTable.isCorrect, true), eq(btcusdPredictionsTable.status, "verified")));
    const [verifiedPreds] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"));

    const verified = Number(verifiedPreds?.count ?? 0);
    const correct = Number(correctPreds?.count ?? 0);

    res.json({
      totalInsights: all.length,
      byCategory,
      totalBrainEntries: all.length,
      activeBrainEntries: all.length,
      totalQuestionsAsked: Number(qTotal?.count ?? 0),
      totalPredictions: Number(predTotal?.count ?? 0),
      correctPredictions: correct,
      verifiedPredictions: verified,
      predictionAccuracy: verified > 0 ? Math.round(correct / verified * 100) : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Delete brain entry (admin) ───────────────────────────────────────────────
btcusdRouter.delete("/brain/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db.update(btcusdBrainTable).set({ isActive: false }).where(eq(btcusdBrainTable.id, id));
  return res.json({ ok: true });
});

// ─── Questions log ────────────────────────────────────────────────────────────
btcusdRouter.get("/questions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10), 100);
    const rows = await db.select().from(btcusdQuestionsLogTable)
      .orderBy(desc(btcusdQuestionsLogTable.askedAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /btcusd/predict — on-demand prediction (mode: normal|technical|fundamental) ─
btcusdRouter.post("/predict", requireMember, async (req, res) => {
  const { mode } = req.body as { mode?: string };
  if (!mode || !["normal", "technical", "fundamental"].includes(mode)) {
    return res.status(400).json({ error: "mode harus salah satu dari: normal, technical, fundamental" });
  }
  try {
    const result = await generateBtcOnDemandPrediction(mode as "normal" | "technical" | "fundamental");
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: "Gagal menghasilkan prediksi. Coba lagi." });
  }
});

// ─── Predictions ──────────────────────────────────────────────────────────────
btcusdRouter.get("/predictions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 200);
    const rows = await db.select().from(btcusdPredictionsTable)
      .orderBy(desc(btcusdPredictionsTable.predictedAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Learning log ─────────────────────────────────────────────────────────────
btcusdRouter.get("/learning-log", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "30"), 10), 100);
    const rows = await db.select().from(btcusdLearningLogTable)
      .orderBy(desc(btcusdLearningLogTable.cycleAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Engine status ────────────────────────────────────────────────────────────
btcusdRouter.get("/engine-status", (_req, res) => {
  res.json(getBtcEngineStatus());
});

// ─── Engine start / stop (admin) ─────────────────────────────────────────────
btcusdRouter.post("/engine/start", requireAdmin, (_req, res) => {
  startBtcBrainEngine();
  res.json({ ok: true, status: getBtcEngineStatus() });
});

btcusdRouter.post("/engine/stop", requireAdmin, (_req, res) => {
  stopBtcBrainEngine();
  res.json({ ok: true, status: getBtcEngineStatus() });
});

// ─── Toggle engine enabled (persists across restarts) ────────────────────────
btcusdRouter.post("/engine/toggle", requireAdmin, async (req, res) => {
  const { enabled } = req.body as { enabled: boolean };
  if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled harus boolean" });
  try {
    const { setBtcusdBrainEnabled } = await import("../lib/xauusd-settings.js");
    await setBtcusdBrainEnabled(enabled);
    if (enabled) {
      startBtcBrainEngine();
    } else {
      stopBtcBrainEngine();
    }
    return res.json({ ok: true, enabled, status: getBtcEngineStatus() });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Trigger manual learning cycle (admin) — sync ────────────────────────────
btcusdRouter.post("/learn-now", requireAdmin, async (_req, res) => {
  try {
    await runBtcLearningCycle();
    res.json({ ok: true, message: "BTC learning cycle selesai." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Extreme mode (admin) ────────────────────────────────────────────────────
btcusdRouter.post("/engine/extreme/start", requireAdmin, (req, res) => {
  const { target, questionsPerCycle, selectedCategories } = req.body as { target?: number; questionsPerCycle?: number; selectedCategories?: string[] };
  if (typeof target !== "number" || !Number.isInteger(target) || target < 1 || target > 10_000) {
    return res.status(400).json({ error: "target harus bilangan bulat antara 1 hingga 10.000" });
  }
  if (questionsPerCycle !== undefined && (typeof questionsPerCycle !== "number" || !Number.isInteger(questionsPerCycle) || questionsPerCycle < 3 || questionsPerCycle > 20)) {
    return res.status(400).json({ error: "questionsPerCycle harus bilangan bulat antara 3 hingga 20" });
  }
  const qpc = questionsPerCycle ?? 15;
  const cats = Array.isArray(selectedCategories) ? selectedCategories : [];
  const result = startBtcExtremeLearningMode(target, qpc, cats);
  return res.json({ ...result, status: getBtcEngineStatus() });
});

btcusdRouter.post("/engine/extreme/stop", requireAdmin, (_req, res) => {
  const result = stopBtcExtremeLearningMode();
  res.json({ ...result, status: getBtcEngineStatus() });
});

// ─── Backtest — RSI + EMA rule backtest against historical BTC snapshots ──────
btcusdRouter.post("/backtest", async (req, res) => {
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
        snapshotAt: btcusdSnapshotsTable.snapshotAt,
        price: btcusdSnapshotsTable.price,
        rsi14: btcusdSnapshotsTable.rsi14,
        emaAlignment: btcusdSnapshotsTable.emaAlignment,
      })
      .from(btcusdSnapshotsTable)
      .orderBy(btcusdSnapshotsTable.snapshotAt)
      .limit(2000);

    if (snaps.length < 10) {
      return res.json({ error: "Tidak cukup data snapshot BTC (minimal 10).", totalTrades: 0, equity: [], trades: [], dataPoints: snaps.length });
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
    console.error("[BTCUSD] /backtest error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Settings — shared dengan XAUUSD (DeepSeek key, dll) ─────────────────────
btcusdRouter.get("/settings", async (_req, res) => {
  try {
    const { getSettingsSummary, VALID_TIMEFRAMES } = await import("../lib/xauusd-settings.js");
    const summary = await getSettingsSummary();
    res.json({ ...summary, validTimeframes: VALID_TIMEFRAMES });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

btcusdRouter.post("/settings/deepseek-key", requireAdmin, async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  try {
    const { setDeepseekApiKey, clearDeepseekApiKey } = await import("../lib/xauusd-settings.js");
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

// ─── Chat (member) ────────────────────────────────────────────────────────────
btcusdRouter.post("/chat", requireMember, async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message?.trim()) return res.status(400).json({ error: "Message required" });

    // Gather context in parallel
    const [brainRows, recentPreds, liveData] = await Promise.allSettled([
      db.select({ content: btcusdBrainTable.content, category: btcusdBrainTable.category, title: btcusdBrainTable.title })
        .from(btcusdBrainTable).where(eq(btcusdBrainTable.isActive, true))
        .orderBy(desc(btcusdBrainTable.confidence)).limit(8),
      db.select({
        direction: btcusdPredictionsTable.direction,
        confidence: btcusdPredictionsTable.confidence,
        targetPrice: btcusdPredictionsTable.targetPrice,
        stopLoss: btcusdPredictionsTable.stopLoss,
        reasoning: btcusdPredictionsTable.reasoning,
        predictedAt: btcusdPredictionsTable.predictedAt,
      }).from(btcusdPredictionsTable).orderBy(desc(btcusdPredictionsTable.predictedAt)).limit(3),
      fetchBtcusdLivePrice(),
    ]);

    const brain = brainRows.status === "fulfilled" ? brainRows.value : [];
    const preds = recentPreds.status === "fulfilled" ? recentPreds.value : [];
    const live = liveData.status === "fulfilled" ? liveData.value : null;

    const brainCtx = brain.map(r => `[${r.category}] ${r.title}: ${r.content.slice(0, 250)}`).join("\n---\n");
    const predCtx = preds.map(p => `${p.direction.toUpperCase()} (conf ${Math.round(p.confidence * 100)}%) target $${p.targetPrice ?? "?"} — ${p.reasoning?.slice(0, 100)}`).join("\n");
    const priceCtx = live ? `Harga BTC saat ini: $${live.price.toLocaleString()} (${live.changePct != null ? (live.changePct >= 0 ? "+" : "") + live.changePct.toFixed(2) + "%" : "n/a"} hari ini)` : "";

    const systemPrompt = `Kamu adalah expert trader Bitcoin dengan pengalaman 10 tahun dan deep knowledge on-chain analytics, halving cycles, crypto makro.\n\n${priceCtx}\n\nOtak AI BTC:\n${brainCtx || "(masih kosong)"}\n\nPrediksi terbaru:\n${predCtx || "(belum ada prediksi)"}\n\nJawab pertanyaan user berdasarkan data di atas. Bahasa Indonesia. Berikan analisis konkret, bukan generik.`;

    const { getDeepseekApiKey } = await import("../lib/xauusd-settings.js");
    const apiKey = await getDeepseekApiKey();
    if (!apiKey) return res.status(503).json({ error: "DeepSeek API key belum diset. Atur di halaman Pengaturan." });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-reasoner",
          max_tokens: 1200,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
      const json = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      return res.json({ reply: json.choices[0]?.message?.content?.trim() ?? "" });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── BTC Quant Bot (3 independent brains — scalping, TP/SL max $1000) ─────────

// Status lengkap semua brain + ensemble signal
btcusdRouter.get("/quant/status", (_req, res) => {
  res.json(getBtcQuantStatus());
});

// Prediksi ensemble terbaru
btcusdRouter.get("/quant/predictions", async (_req, res) => {
  try {
    const predictions = await getBtcQuantRecentPredictions(20);
    res.json(predictions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Statistik per-brain: insights & akurasi
btcusdRouter.get("/quant/brain-stats", async (_req, res) => {
  try {
    const [techStats, fundStats, macroStats, techCount, fundCount, macroCount, brainAccuracy] = await Promise.all([
      getBtcTechnicalBrainStats(),
      getBtcFundamentalBrainStats(),
      getBtcMacroBrainStats(),
      db.select({ count: drizzleSql<number>`count(*)`, avgConf: drizzleSql<number>`avg(confidence)` })
        .from(btcQuantTechnicalBrainTable).where(drizzleEq(btcQuantTechnicalBrainTable.isActive, true)),
      db.select({ count: drizzleSql<number>`count(*)`, avgConf: drizzleSql<number>`avg(confidence)` })
        .from(btcQuantFundamentalBrainTable).where(drizzleEq(btcQuantFundamentalBrainTable.isActive, true)),
      db.select({ count: drizzleSql<number>`count(*)`, avgConf: drizzleSql<number>`avg(confidence)` })
        .from(btcQuantMacroBrainTable).where(drizzleEq(btcQuantMacroBrainTable.isActive, true)),
      db.execute(
        drizzleSql`SELECT brain_type,
          COUNT(*) FILTER (WHERE is_verified = true) as verified,
          COUNT(*) FILTER (WHERE is_verified = true AND is_correct = true) as correct
          FROM btc_quant_brain_predictions GROUP BY brain_type`
      ),
    ]);
    res.json({
      scalping_constraint: { max_tp_sl_usd: 1000, fixed_brain_distance_usd: 500 },
      technical: {
        cycles: techStats.cycleCount,
        lastSignal: techStats.lastSignal?.signal ?? null,
        insights: { count: Number(techCount[0]?.count ?? 0), avgConfidence: Number(techCount[0]?.avgConf ?? 0) },
      },
      fundamental: {
        cycles: fundStats.cycleCount,
        lastSignal: fundStats.lastSignal?.signal ?? null,
        halvingPhase: fundStats.lastSignal?.halvingPhase ?? null,
        fearGreedScore: fundStats.lastSignal?.fearGreedScore ?? null,
        insights: { count: Number(fundCount[0]?.count ?? 0), avgConfidence: Number(fundCount[0]?.avgConf ?? 0) },
      },
      macro: {
        cycles: macroStats.cycleCount,
        lastSignal: macroStats.lastSignal?.signal ?? null,
        macroRegime: macroStats.lastSignal?.macroRegime ?? null,
        insights: { count: Number(macroCount[0]?.count ?? 0), avgConfidence: Number(macroCount[0]?.avgConf ?? 0) },
      },
      accuracy: brainAccuracy.rows,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Per-brain standalone predictions (tracking akurasi tiap brain secara adil)
btcusdRouter.get("/quant/brain-predictions", async (_req, res) => {
  try {
    const rows = await db.select().from(btcQuantBrainPredictionsTable)
      .orderBy(btcQuantBrainPredictionsTable.predictedAt)
      .limit(30);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
