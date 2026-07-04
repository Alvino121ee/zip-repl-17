/**
 * BTCUSD Autonomous Learning Brain Engine — Enhanced v2
 * BTC adalah 24/7 — engine belajar terus-menerus tanpa henti.
 *
 * Improvement v2:
 *  1. Fear & Greed Index — Sentiment Agent nyata (bukan placeholder)
 *  2. Funding Rate (Binance) — ditambahkan ke Macro Vote
 *  3. Volume Spike — masuk ke Cluster Label + konteks
 *  4. Bollinger Band Squeeze — masuk ke Cluster Label
 *  5. Halving Cycle Awareness — konteks siklus 4 tahunan di setiap prompt
 *  6. Reinforcement Diperkuat — negative decay 0.75 (dari 0.88), positive boost +5%
 *  7. Pembelajaran Setiap 2 Menit + Mini-siklus Verifikasi 60 Detik
 *
 * Features lama yang tetap:
 *  8. Ensemble Voting (5 agen: technical + macro + sentiment + AI + funding)
 *  9. Market Regime Detector
 * 10. Trading Session Detector
 * 11. Forget Curve (Exponential Decay, half-life 30 hari)
 * 12. Self-correction + Negative Reinforcement
 * 13. Rule-based Prediction Fallback
 * 14. Confidence Gate (0.55)
 * 15. Price Distribution P10/P50/P90
 * 16. Relevant Brain Retrieval (tag-based scoring × decayWeight × confidence)
 * 17. Multi-timeframe Context (1H / 4H / 1D)
 * 18. Win Rate Context (historis per sesi × regime)
 * 19. Extreme Learning Mode
 */

import crypto from "crypto";
import { db } from "@workspace/db";
import {
  btcusdSnapshotsTable,
  btcusdBrainTable,
  btcusdQuestionsLogTable,
  btcusdPredictionsTable,
  btcusdLearningLogTable,
} from "@workspace/db/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  fetchBtcusdIndicators,
  type BtcusdIndicators,
  getMultiBtcTimeframeAnalysis,
  summarizeBtcTimeframeConfluence,
  getBtcCorrelationAnalysis,
  type BtcCorrelationResponse,
  fetchFearGreedIndex,
  type FearGreedData,
  fetchBtcFundingRate,
  type FundingRateData,
  getBtcHalvingContext,
  type HalvingContext,
} from "./btcusd-data.js";
import { getDeepseekApiKey } from "./xauusd-settings.js";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_TIMEOUT_MS = 120_000;
const LEARN_INTERVAL_MS = 2 * 60 * 1000;   // 2 menit — belajar lebih sering
const VERIFY_INTERVAL_MS = 60 * 1000;       // 1 menit — mini-siklus verifikasi cepat
const SPIKE_THRESHOLD = 0.01;
const QUALITY_THRESHOLD = 0.65;
const CONFIDENCE_GATE = 0.55;

// ─── Engine state ──────────────────────────────────────────────────────────────
let learningTimer: ReturnType<typeof setInterval> | null = null;
let verifyTimer: ReturnType<typeof setInterval> | null = null;
let isLearning = false;
let lastCycleAt: Date | null = null;
let totalCycles = 0;
let totalInsights = 0;

// ─── Extreme mode state ────────────────────────────────────────────────────────
let isExtremeRunning = false;
let extremeTarget = 0;
let extremeProgress = 0;
let extremeInsightsTotal = 0;
let extremeCycleCount = 0;
let extremeStartedAt: Date | null = null;
let extremeAbort = false;
let extremeStopRequested = false;
let extremeHashCache: Set<string> | null = null;
let extremeProgressHistory: Array<{ ts: number; count: number }> = [];
let extremeLastProgressAt: number | null = null;
let extremeDataMode: "live" | "historical" = "live";

// ─── DeepSeek ──────────────────────────────────────────────────────────────────
async function queryDeepSeek(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) return "[AI tidak aktif — API key belum diset.]";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return json.choices[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Hashing ───────────────────────────────────────────────────────────────────
function hashQuestion(q: string): string {
  return crypto.createHash("sha256").update(q.trim().toLowerCase()).digest("hex");
}

// ─── Score answer quality (0.0–1.0) — diperbaiki ──────────────────────────────
function scoreAnswer(question: string, answer: string): number {
  let score = 0.5;

  // Panjang jawaban
  if (answer.length > 300) score += 0.08;
  if (answer.length > 600) score += 0.08;
  if (answer.length > 900) score += 0.04;

  // Ada angka spesifik
  const hasNumbers = /\d+\.?\d*%?/.test(answer);
  if (hasNumbers) score += 0.08;

  // Kata-kata actionable
  const actionWords = [
    "entry", "stop", "target", "support", "resistance",
    "buy", "sell", "beli", "jual", "level", "harga",
    "strategi", "risiko", "konfirmasi", "breakout",
    "funding", "fear", "greed", "halving", "on-chain",
  ];
  const hits = actionWords.filter((w) => answer.toLowerCase().includes(w)).length;
  score += Math.min(hits * 0.025, 0.12);

  // Ada poin bernomor → terstruktur
  const bulletPoints = (answer.match(/^\s*[\d\-\*•]/gm) ?? []).length;
  if (bulletPoints >= 3) score += 0.06;

  // Penalti: terlalu banyak tanda tanya (tidak pasti)
  if (answer.includes("?") && answer.split("?").length > 2) score -= 0.05;

  // Penalti: jawaban terlalu pendek
  if (answer.length < 100) score = Math.min(score, 0.4);

  // Penalti: jawaban samar
  const vague = ["itu tergantung", "sangat bervariasi", "tidak bisa dipastikan", "sulit dikatakan"];
  if (vague.some((v) => answer.toLowerCase().includes(v))) score -= 0.1;

  // Bonus: menyebut angka harga BTC spesifik
  if (/\$\s*[\d,]+/.test(answer)) score += 0.04;

  return Math.min(Math.max(score, 0), 1);
}

// ─── Brain category ────────────────────────────────────────────────────────────
function extractCategory(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("rsi") || q.includes("macd") || q.includes("ema") || q.includes("bollinger")) return "teknikal";
  if (q.includes("halving") || q.includes("blockchain") || q.includes("on-chain") || q.includes("hash rate")) return "onchain";
  if (q.includes("makro") || q.includes("federal") || q.includes("inflasi") || q.includes("dolar") || q.includes("nasdaq")) return "makro";
  if (q.includes("psikologi") || q.includes("fear") || q.includes("greed") || q.includes("sentiment")) return "psikologi";
  if (q.includes("stoploss") || q.includes("risk") || q.includes("position") || q.includes("lot")) return "manajemen_risiko";
  if (q.includes("defi") || q.includes("altcoin") || q.includes("eth") || q.includes("dominance")) return "crypto_ekosistem";
  if (q.includes("news") || q.includes("fed") || q.includes("berita")) return "news_impact";
  if (q.includes("pola") || q.includes("pattern") || q.includes("breakout")) return "pattern";
  if (q.includes("funding") || q.includes("futures") || q.includes("open interest")) return "derivatif";
  if (q.includes("strategi") || q.includes("entry") || q.includes("exit") || q.includes("stop")) return "trading_rule";
  if (q.includes("psikologi") || q.includes("kesalahan") || q.includes("manajemen")) return "lesson";
  return "insight";
}

function extractTitle(question: string, answer: string): string {
  const firstSentence = answer.split(/[.!?\n]/)[0]?.trim() ?? "";
  return firstSentence.length > 10 && firstSentence.length < 120
    ? firstSentence
    : question.slice(0, 100);
}

function extractMarketTags(i: BtcusdIndicators, avgVolume?: number): string {
  const tags: string[] = [];
  if (i.rsiSignal === "overbought") tags.push("rsi_overbought");
  if (i.rsiSignal === "oversold") tags.push("rsi_oversold");
  if (i.emaAlignment === "bullish_stack") tags.push("ema_bullish");
  if (i.emaAlignment === "bearish_stack") tags.push("ema_bearish");
  if (i.macdSignalType !== "neutral") tags.push(`macd_${i.macdSignalType}`);
  tags.push(`trend_${i.trend}`);
  if (i.bbWidth != null && i.bbWidth < 2.0) tags.push("bb_squeeze");
  if (avgVolume && avgVolume > 0 && i.volume > avgVolume * 1.5) tags.push("vol_spike");
  return tags.join(",");
}

// ─── Feature: Market Regime Detector ──────────────────────────────────────────
export function detectBtcMarketRegime(
  indicators: BtcusdIndicators
): "trending_up" | "trending_down" | "ranging" | "volatile" {
  const atr = indicators.atr14 ?? 0;
  const price = indicators.price;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  if (atrPct > 2.0) return "volatile";
  if (indicators.emaAlignment === "bullish_stack" && indicators.trend === "bullish") return "trending_up";
  if (indicators.emaAlignment === "bearish_stack" && indicators.trend === "bearish") return "trending_down";
  return "ranging";
}

// ─── Feature: Trading Session Detector ────────────────────────────────────────
export function detectTradingSession(): "asia" | "london" | "new_york" | "overlap_london_ny" {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 13 && h < 16) return "overlap_london_ny";
  if (h >= 13 && h < 22) return "new_york";
  if (h >= 7 && h < 16) return "london";
  return "asia";
}

// ─── Feature: Cluster Label — diperkaya BB Squeeze + Volume ───────────────────
export function computeBtcClusterLabel(indicators: BtcusdIndicators, avgVolume?: number): string {
  const rsi = indicators.rsi14 ?? 50;
  const rsiZone = rsi < 35 ? "RSI_OS" : rsi > 65 ? "RSI_OB" : "RSI_N";
  const emaZone = indicators.emaAlignment === "bullish_stack" ? "EMA_Bull"
    : indicators.emaAlignment === "bearish_stack" ? "EMA_Bear"
    : "EMA_Mix";
  const trendZone = indicators.trend === "bullish" ? "T_Up"
    : indicators.trend === "bearish" ? "T_Dn"
    : "T_Sd";
  const macdZone = indicators.macdSignalType === "bullish_cross" ? "MACD_B"
    : indicators.macdSignalType === "bearish_cross" ? "MACD_S"
    : "MACD_N";

  // BB Squeeze: lebar < 2% = konsolidasi, breakout akan datang
  const bbSqueeze = (indicators.bbWidth != null && indicators.bbWidth < 2.0) ? "+BB_Sqz" : "";

  // Volume spike: volume 1.5x di atas rata-rata = konfirmasi gerakan
  const volSpike = (avgVolume && avgVolume > 0 && indicators.volume > avgVolume * 1.5) ? "+VOL_H" : "";

  return `${rsiZone}+${emaZone}+${trendZone}+${macdZone}${bbSqueeze}${volSpike}`;
}

// ─── Feature: Rule-based Prediction Fallback ───────────────────────────────────
interface RuleBasedPrediction {
  direction: "up" | "down" | "sideways";
  targetPrice: number; // TP1 — target terdekat (S/R pertama)
  tp2: number;         // TP2 — target lanjutan jika momentum + funding sehat
  tp3: number;         // TP3 — target jauh jika trend kuat + volume mendukung
  entryLow: number;
  entryHigh: number;
  stopLoss: number;    // titik invalidasi thesis (swing low/high struktural)
  confidence: number;
  reasoning: string;
}

function computeRuleBasedPrediction(indicators: BtcusdIndicators): RuleBasedPrediction {
  const price = indicators.price;
  const atr = indicators.atr14 ?? price * 0.02;

  let direction: "up" | "down" | "sideways" = "sideways";
  let score = 0;
  if (indicators.emaAlignment === "bullish_stack") score += 2;
  else if (indicators.emaAlignment === "bearish_stack") score -= 2;
  if (indicators.rsiSignal === "oversold") score += 1;
  else if (indicators.rsiSignal === "overbought") score -= 1;
  if (indicators.macdSignalType === "bullish_cross") score += 1;
  else if (indicators.macdSignalType === "bearish_cross") score -= 1;
  if (indicators.macdHistogram != null) {
    if (indicators.macdHistogram > 0) score += 0.5;
    else if (indicators.macdHistogram < 0) score -= 0.5;
  }
  if (score >= 1.5) direction = "up";
  else if (score <= -1.5) direction = "down";

  const confidence = Math.min(0.85, 0.45 + Math.abs(score) * 0.12);
  const pullback = atr * 0.3;
  const support = indicators.supportLevel ?? price - atr * 2;
  const resistance = indicators.resistanceLevel ?? price + atr * 2;

  // ── SL: di titik struktural invalidasi thesis (swing low/high), bukan ATR acak ──
  // Long  → SL di bawah support (swing low) — jika kena, thesis long sudah salah
  // Short → SL di atas resistance (swing high) — jika kena, thesis short sudah salah

  // ── TP: multi-level berdasarkan area S/R (termasuk konfirmasi funding/OI untuk crypto)
  // TP1 = S/R pertama (target terdekat, konservatif)
  // TP2 = S/R berikutnya jika momentum + funding sehat
  // TP3 = ekstensi jauh jika trend kuat + volume mendukung
  let entryLow: number, entryHigh: number, stopLoss: number, targetPrice: number;
  let tp2: number, tp3: number;

  if (direction === "up") {
    entryLow  = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback * 0.3).toFixed(2));
    // SL: jika support tersedia DAN di bawah harga (valid struktural); fallback ATR
    const slCandidate = indicators.supportLevel != null
      ? parseFloat((indicators.supportLevel - atr * 0.1).toFixed(2))
      : null;
    stopLoss = (slCandidate != null && slCandidate < price)
      ? slCandidate
      : parseFloat((price - atr * 1.5).toFixed(2));
    // TP1: resistance terdekat DI ATAS harga; fallback ATR
    const tp1Candidate = indicators.resistanceLevel != null
      ? parseFloat(indicators.resistanceLevel.toFixed(2))
      : null;
    targetPrice = (tp1Candidate != null && tp1Candidate > price)
      ? tp1Candidate
      : parseFloat((price + atr * 1.5).toFixed(2));
    tp2 = parseFloat((targetPrice + atr * 1.5).toFixed(2));
    tp3 = parseFloat((targetPrice + atr * 3.5).toFixed(2));
  } else if (direction === "down") {
    entryLow  = parseFloat((price - pullback * 0.3).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    // SL: jika resistance tersedia DAN di atas harga (valid struktural); fallback ATR
    const slCandidate = indicators.resistanceLevel != null
      ? parseFloat((indicators.resistanceLevel + atr * 0.1).toFixed(2))
      : null;
    stopLoss = (slCandidate != null && slCandidate > price)
      ? slCandidate
      : parseFloat((price + atr * 1.5).toFixed(2));
    // TP1: support terdekat DI BAWAH harga; fallback ATR
    const tp1Candidate = indicators.supportLevel != null
      ? parseFloat(indicators.supportLevel.toFixed(2))
      : null;
    targetPrice = (tp1Candidate != null && tp1Candidate < price)
      ? tp1Candidate
      : parseFloat((price - atr * 1.5).toFixed(2));
    tp2 = parseFloat((targetPrice - atr * 1.5).toFixed(2));
    tp3 = parseFloat((targetPrice - atr * 3.5).toFixed(2));
  } else {
    entryLow  = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    stopLoss  = parseFloat((price - atr * 1.5).toFixed(2));
    targetPrice = parseFloat(price.toFixed(2));
    tp2 = targetPrice;
    tp3 = targetPrice;
  }

  const rr = Math.abs(price - stopLoss) > 0
    ? parseFloat((Math.abs(targetPrice - price) / Math.abs(price - stopLoss)).toFixed(2))
    : 0;
  const slLabel = direction === "up" ? "swing low/support" : "swing high/resistance";
  const reasoning = `Rule-based: trend=${indicators.trend}, EMA=${indicators.emaAlignment}, RSI=${indicators.rsi14?.toFixed(1) ?? "-"} (${indicators.rsiSignal}), MACD=${indicators.macdSignalType}. SL=${stopLoss.toFixed(0)} di ${slLabel} (invalidasi thesis). TP1=${targetPrice.toFixed(0)} / TP2=${tp2.toFixed(0)} / TP3=${tp3.toFixed(0)} dari area S/R. RR ≈ ${rr}.`;
  return { direction, targetPrice, tp2, tp3, entryLow, entryHigh, stopLoss, confidence, reasoning };
}

// ─── Feature: Macro Vote + Funding Rate ────────────────────────────────────────
// DXY naik → bearish BTC | Nasdaq naik → bullish BTC
// Funding Rate tinggi (> 0.05%) = overleveraged longs → bearish contrarian
// Funding Rate negatif (< -0.02%) = overleveraged shorts → bullish contrarian
function computeBtcMacroVote(
  corr: BtcCorrelationResponse | null,
  funding: FundingRateData | null
): { direction: "up" | "down" | "sideways"; confidence: number; label: string } {
  let score = 0;

  if (corr) {
    const dxy = corr.factors.find((f) => f.key === "dxy");
    const nasdaq = corr.factors.find((f) => f.key === "nasdaq");
    const dxyChange = dxy?.changePct ?? 0;
    const nasdaqChange = nasdaq?.changePct ?? 0;

    if (dxyChange < -0.1) score += 1;
    else if (dxyChange > 0.1) score -= 1;
    if (nasdaqChange > 0.3) score += 1;
    else if (nasdaqChange < -0.3) score -= 1;
  }

  // Funding Rate sebagai contrarian signal
  if (funding) {
    const rate = funding.rate;
    if (rate > 0.0005) score -= 1.5;       // Longs terlalu banyak → potensi reversal turun
    else if (rate > 0.0002) score -= 0.75;
    else if (rate < -0.0002) score += 1.5; // Shorts terlalu banyak → potensi short squeeze
    else if (rate < -0.0001) score += 0.75;
  }

  const direction: "up" | "down" | "sideways" =
    score >= 1 ? "up" : score <= -1 ? "down" : "sideways";
  const confidence = Math.min(0.82, 0.38 + Math.abs(score) * 0.16);
  return { direction, confidence, label: "macro" };
}

// ─── Feature: Sentiment Vote — Fear & Greed Index (CONTRARIAN) ─────────────────
// Extreme Fear (0-25) → pasar oversold → potensi bullish
// Extreme Greed (75-100) → pasar overbought → potensi reversal bearish
function computeBtcSentimentVote(fg: FearGreedData | null): {
  direction: "up" | "down" | "sideways";
  confidence: number;
  label: string;
  fgValue?: number;
  fgClass?: string;
} {
  if (!fg) return { direction: "sideways", confidence: 0.42, label: "sentiment" };

  const v = fg.value;
  if (v <= 15) return { direction: "up", confidence: 0.72, label: "sentiment", fgValue: v, fgClass: fg.classification };
  if (v <= 25) return { direction: "up", confidence: 0.62, label: "sentiment", fgValue: v, fgClass: fg.classification };
  if (v <= 40) return { direction: "up", confidence: 0.52, label: "sentiment", fgValue: v, fgClass: fg.classification };
  if (v >= 85) return { direction: "down", confidence: 0.70, label: "sentiment", fgValue: v, fgClass: fg.classification };
  if (v >= 75) return { direction: "down", confidence: 0.60, label: "sentiment", fgValue: v, fgClass: fg.classification };
  if (v >= 60) return { direction: "down", confidence: 0.50, label: "sentiment", fgValue: v, fgClass: fg.classification };
  return { direction: "sideways", confidence: 0.46, label: "sentiment", fgValue: v, fgClass: fg.classification };
}

// ─── Feature: Forget Curve — Exponential Decay ────────────────────────────────
async function applyForgetCurve(): Promise<void> {
  const LAMBDA = 0.023;
  const now = Date.now();

  const entries = await db
    .select({ id: btcusdBrainTable.id, createdAt: btcusdBrainTable.createdAt, decayWeight: btcusdBrainTable.decayWeight })
    .from(btcusdBrainTable)
    .where(eq(btcusdBrainTable.isActive, true));

  for (const entry of entries) {
    const ageDays = (now - new Date(entry.createdAt).getTime()) / 86_400_000;
    const newWeight = parseFloat(Math.exp(-LAMBDA * ageDays).toFixed(4));
    const currentWeight = entry.decayWeight ?? 1.0;
    if (Math.abs(newWeight - currentWeight) > 0.01) {
      await db.update(btcusdBrainTable)
        .set({ decayWeight: newWeight, updatedAt: new Date() })
        .where(eq(btcusdBrainTable.id, entry.id));
    }
  }
  console.log(`[BTC Brain] Forget curve applied to ${entries.length} brain entries.`);
}

// ─── Feature: Price Distribution P10/P50/P90 ──────────────────────────────────
function computePriceDistribution(
  price: number,
  direction: "up" | "down" | "sideways",
  confidence: number,
  atr: number
): { p10: number; p50: number; p90: number } {
  const a = atr > 0 ? atr : price * 0.02;
  const mult = 0.5 + confidence;

  if (direction === "up") {
    return {
      p10: parseFloat((price + a * 0.2).toFixed(2)),
      p50: parseFloat((price + a * 1.2 * mult).toFixed(2)),
      p90: parseFloat((price + a * 2.5 * mult).toFixed(2)),
    };
  } else if (direction === "down") {
    return {
      p10: parseFloat((price - a * 2.5 * mult).toFixed(2)),
      p50: parseFloat((price - a * 1.2 * mult).toFixed(2)),
      p90: parseFloat((price - a * 0.2).toFixed(2)),
    };
  } else {
    return {
      p10: parseFloat((price - a * 0.6).toFixed(2)),
      p50: parseFloat(price.toFixed(2)),
      p90: parseFloat((price + a * 0.6).toFixed(2)),
    };
  }
}

// ─── Feature: Relevant Brain Retrieval ────────────────────────────────────────
async function retrieveRelevantBrainEntries(
  currentTags: string,
  session: string,
  regime: string,
  limit = 7
): Promise<string> {
  try {
    const entries = await db
      .select({
        category: btcusdBrainTable.category,
        title: btcusdBrainTable.title,
        content: btcusdBrainTable.content,
        confidence: btcusdBrainTable.confidence,
        decayWeight: btcusdBrainTable.decayWeight,
        marketConditionTags: btcusdBrainTable.marketConditionTags,
      })
      .from(btcusdBrainTable)
      .where(eq(btcusdBrainTable.isActive, true))
      .orderBy(desc(sql`${btcusdBrainTable.decayWeight} * ${btcusdBrainTable.confidence}`))
      .limit(60);

    if (entries.length === 0) return "";

    const tagSet = new Set(currentTags.split(",").filter(Boolean));
    const sessionTag = `session_${session}`;
    const regimeTag = `regime_${regime}`;

    const scored = entries.map((e) => {
      const entryTags = new Set((e.marketConditionTags ?? "").split(",").filter(Boolean));
      let overlap = 0;
      for (const t of tagSet) if (entryTags.has(t)) overlap++;
      if (entryTags.has(sessionTag)) overlap += 2;
      if (entryTags.has(regimeTag)) overlap += 2;
      const score = (e.decayWeight ?? 1) * (e.confidence ?? 0.5) * (1 + overlap * 0.35);
      return { ...e, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);
    if (top.length === 0) return "";

    return `\n\n=== MEMORI AI BTC (${top.length} insights relevan dari ${entries.length} yang dipelajari) ===\n` +
      top.map((e, i) => {
        const snippet = (e.content ?? "").slice(0, 220);
        const ellipsis = (e.content ?? "").length > 220 ? "..." : "";
        return `[${i + 1}] [${(e.category ?? "insight").toUpperCase()}] ${e.title}\n    ${snippet}${ellipsis}`;
      }).join("\n");
  } catch (err) {
    console.error("[BTC Brain] Brain retrieval error:", err);
    return "";
  }
}

// ─── Generate questions via DeepSeek — dengan konteks F&G, Funding, Halving ────
async function generateQuestionsWithDeepSeek(
  indicators: BtcusdIndicators,
  count: number,
  spikeDetected: boolean,
  sessionCache: Set<string>,
  fg: FearGreedData | null,
  funding: FundingRateData | null,
  halving: HalvingContext
): Promise<Array<{ question: string; hash: string }>> {
  const fgLine = fg
    ? `Fear & Greed Index: ${fg.value}/100 (${fg.classification})`
    : "Fear & Greed Index: N/A";
  const fundingLine = funding
    ? `Funding Rate: ${(funding.rate * 100).toFixed(4)}% (annualized ${funding.rateAnnualized.toFixed(1)}%/thn)`
    : "Funding Rate: N/A";

  const ctx = [
    `Harga BTC/USD  : $${indicators.price.toLocaleString()}`,
    `RSI14          : ${indicators.rsi14?.toFixed(1) ?? "N/A"} (${indicators.rsiSignal})`,
    `Trend          : ${indicators.trend}`,
    `EMA Alignment  : ${indicators.emaAlignment}`,
    `EMA9/21/50/200 : ${indicators.ema9?.toFixed(0) ?? "N/A"} / ${indicators.ema21?.toFixed(0) ?? "N/A"} / ${indicators.ema50?.toFixed(0) ?? "N/A"} / ${indicators.ema200?.toFixed(0) ?? "N/A"}`,
    `MACD           : ${indicators.macdSignalType} (hist ${indicators.macdHistogram?.toFixed(0) ?? "N/A"})`,
    `ATR14          : $${indicators.atr14?.toFixed(0) ?? "N/A"}`,
    `BB Width       : ${indicators.bbWidth?.toFixed(2) ?? "N/A"}%${(indicators.bbWidth != null && indicators.bbWidth < 2.0) ? " ⚡ BB SQUEEZE" : ""}`,
    `Support        : $${indicators.supportLevel?.toFixed(0) ?? "N/A"}`,
    `Resistance     : $${indicators.resistanceLevel?.toFixed(0) ?? "N/A"}`,
    fgLine,
    fundingLine,
    `Halving Phase  : ${halving.phase} (${halving.daysSinceHalving} hari sejak halving, ${halving.daysToNextHalving} hari ke halving berikutnya)`,
    spikeDetected ? "⚡ SPIKE TERDETEKSI: BTC bergerak cepat >1%" : null,
  ].filter(Boolean).join("\n");

  const prompt =
    `Kondisi pasar BTC/USD saat ini:\n${ctx}\n\n` +
    `Buat ${count} pertanyaan studi trading BITCOIN yang SPESIFIK, UNIK, dan BERVARIASI. ` +
    `Topik mencakup: analisis teknikal (RSI/MACD/BB squeeze), halving cycle, funding rate, ` +
    `Fear & Greed contrarian signals, korelasi DXY/Nasdaq, manajemen risiko, psikologi, ` +
    `DeFi & dominance, on-chain metrics, institutional adoption. ` +
    `Format: satu pertanyaan per baris, awali dengan nomor (1. 2. dst). ` +
    `Gunakan Bahasa Indonesia. Sertakan angka spesifik dari data di atas.`;

  const raw = await queryDeepSeek(
    "Kamu adalah expert trader dan analis Bitcoin/Crypto dengan pengalaman 10 tahun. Tugasmu merancang kurikulum belajar trading BTC yang mendalam dan actionable.",
    prompt,
    700
  );

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const questions: Array<{ question: string; hash: string }> = [];
  const batchSeen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\d+[\.\)]\s*(.+)/);
    if (!m) continue;
    const q = m[1].trim();
    if (q.length < 20) continue;
    const h = hashQuestion(q);
    if (sessionCache.has(h) || batchSeen.has(h)) continue;
    batchSeen.add(h);
    questions.push({ question: q, hash: h });
    if (questions.length >= count) break;
  }
  return questions;
}

// ─── Historical fallback ───────────────────────────────────────────────────────
async function getHistoricalIndicators(): Promise<BtcusdIndicators | null> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  const rows = await db
    .select()
    .from(btcusdSnapshotsTable)
    .where(sql`${btcusdSnapshotsTable.snapshotAt} >= ${sevenDaysAgo.toISOString()}`)
    .orderBy(sql`RANDOM()`)
    .limit(1);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    price: r.price, open: r.open ?? r.price, high: r.high ?? r.price,
    low: r.low ?? r.price, volume: r.volume ?? 0,
    rsi14: r.rsi14 ?? null, ema9: r.ema9 ?? null, ema21: r.ema21 ?? null,
    ema50: r.ema50 ?? null, ema200: r.ema200 ?? null,
    macdLine: r.macdLine ?? null, macdSignal: r.macdSignal ?? null,
    macdHistogram: r.macdHistogram ?? null,
    bbUpper: r.bbUpper ?? null, bbMiddle: r.bbMiddle ?? null,
    bbLower: r.bbLower ?? null, bbWidth: r.bbWidth ?? null,
    atr14: r.atr14 ?? null,
    trend: (r.trend as BtcusdIndicators["trend"]) ?? "sideways",
    rsiSignal: (r.rsiSignal as BtcusdIndicators["rsiSignal"]) ?? "neutral",
    macdSignalType: (r.macdSignalType as BtcusdIndicators["macdSignalType"]) ?? "neutral",
    emaAlignment: (r.emaAlignment as BtcusdIndicators["emaAlignment"]) ?? "mixed",
    supportLevel: r.supportLevel ?? null,
    resistanceLevel: r.resistanceLevel ?? null,
  };
}

// ─── Ambil rata-rata volume dari snapshot terakhir ─────────────────────────────
async function getAvgVolume(limit = 24): Promise<number> {
  try {
    const rows = await db
      .select({ volume: btcusdSnapshotsTable.volume })
      .from(btcusdSnapshotsTable)
      .orderBy(desc(btcusdSnapshotsTable.snapshotAt))
      .limit(limit);
    if (!rows.length) return 0;
    const sum = rows.reduce((s, r) => s + (r.volume ?? 0), 0);
    return sum / rows.length;
  } catch {
    return 0;
  }
}

// ─── Prediction maker — Ensemble Voting 5 agen ────────────────────────────────
async function makePrediction(
  indicators: BtcusdIndicators,
  corrResult: PromiseSettledResult<BtcCorrelationResponse>,
  fg: FearGreedData | null,
  funding: FundingRateData | null,
  halving: HalvingContext,
  avgVolume: number
): Promise<void> {
  const tradingSession = detectTradingSession();
  const marketRegime = detectBtcMarketRegime(indicators);
  const clusterLabel = computeBtcClusterLabel(indicators, avgVolume);
  const currentTags = extractMarketTags(indicators, avgVolume);

  const [mtfResult, winRateResult, brainResult, segWinRateResult] = await Promise.allSettled([
    getMultiBtcTimeframeAnalysis(),
    db.select({ direction: btcusdPredictionsTable.direction, isCorrect: btcusdPredictionsTable.isCorrect })
      .from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"))
      .orderBy(desc(btcusdPredictionsTable.predictedAt))
      .limit(50),
    retrieveRelevantBrainEntries(currentTags, tradingSession, marketRegime),
    db.select({
      direction: btcusdPredictionsTable.direction,
      isCorrect: btcusdPredictionsTable.isCorrect,
      tradingSession: btcusdPredictionsTable.tradingSession,
      marketRegime: btcusdPredictionsTable.marketRegime,
    })
      .from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"))
      .orderBy(desc(btcusdPredictionsTable.predictedAt))
      .limit(200),
  ]);

  // Multi-timeframe context
  let mtfContext = "";
  if (mtfResult.status === "fulfilled") {
    try {
      const mtf = mtfResult.value;
      const confluence = summarizeBtcTimeframeConfluence(mtf);
      mtfContext = `\n\n=== ANALISIS MULTI-TIMEFRAME ===\n${mtf
        .map((t) => `${t.label}: trend=${t.indicators?.trend ?? "n/a"}, RSI=${t.indicators?.rsi14?.toFixed(1) ?? "n/a"}, EMA=${t.indicators?.emaAlignment ?? "n/a"}`)
        .join("\n")}\nKonfluensi: ${confluence.agreement} (${confluence.bullishCount} TF bullish, ${confluence.bearishCount} TF bearish)`;
    } catch { /* non-fatal */ }
  }

  // Win rate context
  let winRateContext = "";
  if (winRateResult.status === "fulfilled" && winRateResult.value.length > 0) {
    const all = winRateResult.value;
    const correct = all.filter((p) => p.isCorrect === true).length;
    const wr = ((correct / all.length) * 100).toFixed(1);
    winRateContext = `\n\n=== WIN RATE HISTORIS ===\nAkurasi keseluruhan: ${wr}% dari ${all.length} prediksi terverifikasi`;
  }

  // Segment win rate
  let segmentWinRateContext = "";
  if (segWinRateResult.status === "fulfilled" && segWinRateResult.value.length > 0) {
    const calcWR = (preds: typeof segWinRateResult.value) => {
      if (!preds.length) return null;
      const c = preds.filter((p) => p.isCorrect === true).length;
      return { wr: ((c / preds.length) * 100).toFixed(1), n: preds.length };
    };
    const all = segWinRateResult.value;
    const sameBoth = all.filter((p) => p.tradingSession === tradingSession && p.marketRegime === marketRegime);
    const sameRegime = all.filter((p) => p.marketRegime === marketRegime);
    const parts: string[] = [];
    const wrBoth = calcWR(sameBoth);
    const wrRegime = calcWR(sameRegime);
    if (wrBoth) parts.push(`Sesi ${tradingSession} + regime ${marketRegime}: ${wrBoth.wr}% akurat (${wrBoth.n} prediksi)`);
    else if (wrRegime) parts.push(`Regime ${marketRegime}: ${wrRegime.wr}% akurat (${wrRegime.n} prediksi)`);
    if (parts.length) segmentWinRateContext = `\n=== WIN RATE SEGMEN ===\n${parts.join("\n")}`;
  }

  // Correlation context
  let correlationContext = "";
  if (corrResult.status === "fulfilled") {
    const c = corrResult.value;
    const fmtF = (v: number | null) => v != null ? `${v > 0 ? "+" : ""}${v.toFixed(2)}%` : "n/a";
    correlationContext = `\n\n=== KORELASI MAKRO BTC ===\n` +
      c.factors.map((f) => `${f.name}: ${fmtF(f.changePct)} — ${f.interpretation.slice(0, 80)}`).join("\n");
  }

  // Fear & Greed context
  const fgContext = fg
    ? `\n\n=== FEAR & GREED INDEX ===\nNilai: ${fg.value}/100 (${fg.classification})\n${fg.value <= 25 ? "⚠️ EXTREME FEAR = contrarian bullish signal" : fg.value >= 75 ? "⚠️ EXTREME GREED = contrarian bearish signal (overbought)" : "Sentimen normal — tidak ada sinyal contrarian ekstrem."}`
    : "";

  // Funding Rate context
  const fundingContext = funding
    ? `\n\n=== FUNDING RATE (BTC Perpetual) ===\nRate: ${(funding.rate * 100).toFixed(4)}%${funding.rate > 0.0005 ? " ⚠️ OVERFUNDED LONGS — potensi reversal turun" : funding.rate < -0.0002 ? " ⚠️ OVERFUNDED SHORTS — potensi short squeeze naik" : " (Normal)"}`
    : "";

  // Halving context
  const halvingContext = `\n\n=== HALVING CYCLE BTC ===\n${halving.phaseDescription}\n${halving.daysSinceHalving} hari sejak halving ke-4 | ${halving.daysToNextHalving} hari ke halving ke-5`;

  // BB Squeeze context
  const bbSqueezeContext = (indicators.bbWidth != null && indicators.bbWidth < 2.0)
    ? `\n\n⚡ BB SQUEEZE TERDETEKSI: Width ${indicators.bbWidth.toFixed(2)}% (< 2%) — pasar konsolidasi, potensi breakout besar.`
    : "";

  const brainContext = brainResult.status === "fulfilled" ? brainResult.value : "";
  const sessionRegimeContext = `\n\n=== KONTEKS PASAR ===\nSesi: ${tradingSession.toUpperCase()} | Regime: ${marketRegime.toUpperCase()} | Cluster: ${clusterLabel}`;

  const ruleBased = computeRuleBasedPrediction(indicators);

  const systemPrompt = `Kamu adalah AI trading system BTC/USD dengan metodologi analisis terstruktur.

URUTAN ANALISIS (wajib diikuti):
1. TREND — struktur market: higher high/lower low? EMA alignment? Apakah timeframe lebih besar konfirmasi?
2. MOMENTUM — RSI, MACD, histogram. Apakah momentum mendukung atau divergen? Cek juga funding rate (overleveraged?)
3. LEVEL — identifikasi support/resistance STRUKTURAL yang valid (swing high/low nyata, bukan ATR acak)
4. KONFIRMASI — MTF confluens, DXY/Nasdaq korelasi, Fear & Greed contrarian, funding rate, halving phase, open interest jika relevan
5. RISIKO — hitung RR, tentukan SL/TP berdasarkan struktur + konfirmasi

ATURAN SL (stop loss = batas salahnya thesis):
- Long: SL di BAWAH swing low / support struktural — jika kena, thesis long sudah invalid
- Short: SL di ATAS swing high / resistance struktural — jika kena, thesis short sudah invalid
- SL bukan angka ATR random; harus ada alasan struktural

ATURAN TP (area yang secara teknis wajar jadi tempat reaksi):
- TP1: target TERDEKAT — S/R pertama yang valid
- TP2: S/R berikutnya jika momentum + funding masih sehat
- TP3: ekstensi jauh jika trend kuat, funding normal, volume mendukung
- Setup lemah → TP konservatif. Market kuat → TP bisa lebih luas tapi tetap di S/R

ATURAN CONFIDENCE:
- >0.75: ≥4 faktor align (teknikal + makro + funding + MTF)
- 0.55–0.75: 3 faktor align
- <0.55: sinyal mixed
- Win rate segmen <50% → turunkan confidence 10–15%
- Pertimbangkan memori AI dan fase halving

Respons HANYA JSON (tanpa teks lain):
{
  "direction": "up" | "down" | "sideways",
  "targetPrice": <TP1 — S/R pertama dalam arah prediksi, USD>,
  "tp2": <TP2 — S/R lanjutan jika momentum sehat, USD>,
  "tp3": <TP3 — ekstensi jauh jika trend kuat, USD>,
  "entryLow": <batas bawah entry USD>,
  "entryHigh": <batas atas entry USD>,
  "stopLoss": <SL di level struktural invalidasi thesis, USD>,
  "confidence": <0.0-1.0>,
  "reasoning": "<3-4 kalimat — sebutkan: trend struktur, momentum+funding, level S/R yang dipakai sebagai SL/TP, dan konfirmasi F&G/halving/MTF>"
}`;
  const userMsg = `Harga BTC ${indicators.price.toLocaleString()} | RSI ${indicators.rsi14?.toFixed(1) ?? "N/A"} (${indicators.rsiSignal}) | Trend ${indicators.trend} | EMA ${indicators.emaAlignment} | MACD ${indicators.macdSignalType}${mtfContext}${correlationContext}${fgContext}${fundingContext}${halvingContext}${bbSqueezeContext}${winRateContext}${segmentWinRateContext}${sessionRegimeContext}${brainContext}

Buat prediksi BTC untuk 4 jam ke depan berdasarkan metodologi di atas. Jawab JSON saja.`;

  let pred: RuleBasedPrediction = ruleBased;
  let aiPowered = false;

  const VALID_DIRECTIONS = new Set(["up", "down", "sideways"]);
  try {
    const raw = await queryDeepSeek(systemPrompt, userMsg, 500);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        direction: string;
        targetPrice: number;
        tp2?: number;
        tp3?: number;
        entryLow?: number;
        entryHigh?: number;
        stopLoss?: number;
        confidence: number;
        reasoning: string;
      };
      const dirValid = typeof parsed.direction === "string" && VALID_DIRECTIONS.has(parsed.direction.toLowerCase());
      if (
        dirValid &&
        typeof parsed.entryLow === "number" &&
        typeof parsed.entryHigh === "number" &&
        typeof parsed.stopLoss === "number" &&
        typeof parsed.targetPrice === "number" &&
        parsed.targetPrice > 0 &&
        parsed.stopLoss > 0
      ) {
        pred = { ...parsed, direction: parsed.direction.toLowerCase() as "up" | "down" | "sideways" } as RuleBasedPrediction;
        aiPowered = true;
      }
    }
  } catch (err) {
    console.error("[BTC Brain] AI prediction parse error, using rule-based:", err);
  }

  try {
    const verifyAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const direction = (pred.direction ?? ruleBased.direction) as "up" | "down" | "sideways";
    const targetPrice = pred.targetPrice ?? ruleBased.targetPrice; // TP1
    const tp2 = pred.tp2 ?? ruleBased.tp2;
    const tp3 = pred.tp3 ?? ruleBased.tp3;
    const entryLow = pred.entryLow ?? ruleBased.entryLow;
    const entryHigh = pred.entryHigh ?? ruleBased.entryHigh;
    const stopLoss = pred.stopLoss ?? ruleBased.stopLoss;
    const reasoning = aiPowered
      ? (pred.reasoning ?? ruleBased.reasoning)
      : `${ruleBased.reasoning} (AI tidak tersedia — dihitung dari analisis teknikal)`;

    // Ensemble Voting — 5 agen
    const techVote = { direction: ruleBased.direction, confidence: ruleBased.confidence, label: "technical" };
    const macroVote = computeBtcMacroVote(corrResult.status === "fulfilled" ? corrResult.value : null, funding);
    const sentimentVote = computeBtcSentimentVote(fg);
    const baseAiConf = Math.min(1, Math.max(0, pred.confidence ?? ruleBased.confidence));
    const aiVote = { direction, confidence: baseAiConf, label: aiPowered ? "ai" : "rule" };

    // Majority vote dari 3 core agen
    const coreVotes = [techVote.direction, macroVote.direction, sentimentVote.direction];
    const upVotes = coreVotes.filter((d) => d === "up").length;
    const downVotes = coreVotes.filter((d) => d === "down").length;
    const sideVotes = coreVotes.filter((d) => d === "sideways").length;
    const majorityDir = upVotes >= 2 ? "up" : downVotes >= 2 ? "down" : sideVotes >= 2 ? "sideways" : null;
    const rawFinal = majorityDir ?? direction;
    const finalDirection: "up" | "down" | "sideways" =
      rawFinal === "up" || rawFinal === "down" || rawFinal === "sideways" ? rawFinal : ruleBased.direction;

    const allDirs = [techVote.direction, macroVote.direction, sentimentVote.direction, aiVote.direction];
    const agreementCount = Math.max(
      allDirs.filter((d) => d === "up").length,
      allDirs.filter((d) => d === "down").length,
      allDirs.filter((d) => d === "sideways").length
    );
    const agreementBonus = agreementCount === 4 ? 0.08 : agreementCount === 3 ? 0.04 : agreementCount === 1 ? -0.06 : 0;
    const confidence = Math.min(1, Math.max(0, baseAiConf + agreementBonus));

    // Confidence Gate
    if (confidence < CONFIDENCE_GATE) {
      console.log(`[BTC Brain] Prediksi tidak disimpan — confidence ${(confidence * 100).toFixed(0)}% di bawah gate ${(CONFIDENCE_GATE * 100).toFixed(0)}%`);
      return;
    }

    const atr = indicators.atr14 ?? indicators.price * 0.02;
    const distribution = computePriceDistribution(indicators.price, finalDirection, confidence, atr);

    const ensembleVotes = {
      technical: techVote,
      macro: macroVote,
      sentiment: { ...sentimentVote },
      ai: aiVote,
      agreementCount,
      agreementBonus: parseFloat(agreementBonus.toFixed(3)),
      finalDirection,
      session: tradingSession,
      regime: marketRegime,
      cluster: clusterLabel,
      fearGreed: fg ? { value: fg.value, classification: fg.classification } : null,
      fundingRate: funding ? funding.rate : null,
      halvingPhase: halving.phase,
    };

    await db.insert(btcusdPredictionsTable).values({
      timeframe: "4H",
      predictionType: "training",
      direction: finalDirection,
      targetPrice, // TP1
      tp2,
      tp3,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      indicatorsAtPrediction: { ...(indicators as unknown as Record<string, unknown>), ensembleVotes },
      tradingSession,
      marketRegime,
      clusterLabel,
      priceP10: distribution.p10,
      priceP50: distribution.p50,
      priceP90: distribution.p90,
      verifyAt,
      status: "pending",
    });
  } catch (err) {
    console.error("[BTC Brain] Prediction save error:", err);
  }
}

// ─── Self-correction + Negative & Positive Reinforcement (diperkuat) ──────────
async function verifyOldPredictions(currentPrice: number): Promise<{ checked: number; wrong: number }> {
  const now = new Date();

  const pending = await db
    .select()
    .from(btcusdPredictionsTable)
    .where(eq(btcusdPredictionsTable.status, "pending"))
    .limit(30);

  if (pending.length === 0) return { checked: 0, wrong: 0 };

  let wrongCount = 0;
  let checkedCount = 0;

  for (const pred of pending) {
    const sl = pred.stopLoss;
    const tp = pred.targetPrice;
    const priceDiff = currentPrice - pred.priceAtPrediction;
    const pricePct = priceDiff / pred.priceAtPrediction;

    let resolved = false;
    let isCorrect: boolean | null = null;
    let resolveReason = "";

    if (pred.direction === "up") {
      if (tp != null && currentPrice >= tp) { resolved = true; isCorrect = true; resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≥ $${tp.toFixed(2)})`; }
      else if (sl != null && currentPrice <= sl) { resolved = true; isCorrect = false; resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≤ $${sl.toFixed(2)})`; }
    } else if (pred.direction === "down") {
      if (tp != null && currentPrice <= tp) { resolved = true; isCorrect = true; resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≤ $${tp.toFixed(2)})`; }
      else if (sl != null && currentPrice >= sl) { resolved = true; isCorrect = false; resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≥ $${sl.toFixed(2)})`; }
    } else {
      if (Math.abs(pricePct) > 0.01) {
        resolved = true; isCorrect = false;
        resolveReason = `Harga bergerak terlalu jauh dari sideways (${(pricePct * 100).toFixed(2)}%)`;
      }
    }

    if (!resolved && pred.verifyAt && now > new Date(pred.verifyAt)) {
      resolved = true;
      resolveReason = "Kadaluarsa 4 jam tanpa hit SL/TP";
    }

    if (!resolved) continue;

    const actualDirection = pricePct > 0.003 ? "up" : pricePct < -0.003 ? "down" : "sideways";
    if (isCorrect === null) isCorrect = actualDirection === pred.direction;

    checkedCount++;
    if (!isCorrect) wrongCount++;

    console.log(`[BTC Brain] Prediksi #${pred.id} ${pred.direction.toUpperCase()} → ${isCorrect ? "✅ BENAR" : "❌ SALAH"} | ${resolveReason}`);

    if (!isCorrect) {
      // Self-critique: tanya DeepSeek kenapa salah
      try {
        const sysPr = `Kamu adalah AI trading coach untuk BTC/USD. Analisis mengapa prediksi salah dan berikan pelajaran spesifik.`;
        const msg = `Prediksi saya ${pred.direction} dari $${pred.priceAtPrediction.toLocaleString()} dengan alasan: "${pred.reasoning}"
Kenyataannya: harga bergerak ${actualDirection} ke $${currentPrice.toFixed(2)} (${pricePct > 0 ? "+" : ""}${(pricePct * 100).toFixed(3)}%).
Tulis 2-3 kalimat pelajaran spesifik yang harus diingat untuk menghindari kesalahan prediksi serupa di masa depan.`;

        const critique = await queryDeepSeek(sysPr, msg, 300);
        if (critique && critique.length > 50) {
          await db.insert(btcusdBrainTable).values({
            category: "lesson",
            title: `Revisi: Prediksi ${pred.direction} salah pada $${pred.priceAtPrediction.toFixed(0)}`,
            content: critique,
            confidence: 0.85,
            sourceQuestion: `Why was ${pred.direction} prediction from $${pred.priceAtPrediction} wrong?`,
            marketConditionTags: [
              `dir_${pred.direction}`,
              pred.tradingSession ? `session_${pred.tradingSession}` : null,
              pred.marketRegime ? `regime_${pred.marketRegime}` : null,
              pred.clusterLabel ? `cluster_${pred.clusterLabel.split("+")[0]}` : null,
            ].filter(Boolean).join(","),
          });
        }
      } catch (err) {
        console.error("[BTC Brain] Self-critique error:", err);
      }

      // Negative reinforcement DIPERKUAT: decay 0.75 (dari 0.88)
      // Melemahkan insight dengan arah + cluster yang sama
      try {
        const wrongDirTag = `dir_${pred.direction}`;
        await db.update(btcusdBrainTable)
          .set({
            decayWeight: sql`GREATEST(0.05, ${btcusdBrainTable.decayWeight} * 0.75)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(btcusdBrainTable.isActive, true),
              sql`${btcusdBrainTable.marketConditionTags} ILIKE ${"%" + wrongDirTag + "%"}`
            )
          );
        console.log(`[BTC Brain] ⬇️ Negative reinforcement: insight dir_${pred.direction} dilemahkan (×0.75)`);
      } catch (err) {
        console.error("[BTC Brain] Negative reinforcement error:", err);
      }
    } else {
      // Positive reinforcement BARU: boost insight yang berkontribusi benar
      try {
        const rightDirTag = `dir_${pred.direction}`;
        const session = pred.tradingSession ? `session_${pred.tradingSession}` : null;
        await db.update(btcusdBrainTable)
          .set({
            decayWeight: sql`LEAST(1.0, ${btcusdBrainTable.decayWeight} * 1.05)`,
            usageCount: sql`${btcusdBrainTable.usageCount} + 1`,
            lastValidated: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(btcusdBrainTable.isActive, true),
              sql`${btcusdBrainTable.marketConditionTags} ILIKE ${"%" + rightDirTag + "%"}`,
              session
                ? sql`${btcusdBrainTable.marketConditionTags} ILIKE ${"%" + session + "%"}`
                : sql`true`
            )
          );
        console.log(`[BTC Brain] ⬆️ Positive reinforcement: insight dir_${pred.direction} diperkuat (×1.05)`);
      } catch (err) {
        console.error("[BTC Brain] Positive reinforcement error:", err);
      }
    }

    await db.update(btcusdPredictionsTable)
      .set({ actualPrice: currentPrice, actualDirection, isCorrect, priceDiff, status: "verified" })
      .where(eq(btcusdPredictionsTable.id, pred.id));
  }

  return { checked: checkedCount, wrong: wrongCount };
}

// ─── Mini-siklus Verifikasi Cepat (60 detik, tanpa AI) ────────────────────────
async function runBtcVerificationCycle(): Promise<void> {
  if (isLearning || isExtremeRunning) return;
  try {
    const [last] = await db
      .select({ price: btcusdSnapshotsTable.price, snapshotAt: btcusdSnapshotsTable.snapshotAt })
      .from(btcusdSnapshotsTable)
      .orderBy(desc(btcusdSnapshotsTable.snapshotAt))
      .limit(1);
    if (!last) return;
    const result = await verifyOldPredictions(last.price);
    if (result.checked > 0) {
      console.log(`[BTC Verify] ⚡ Fast check: ${result.checked} prediksi diverifikasi (${result.wrong} salah)`);
    }
  } catch { /* non-fatal */ }
}

// ─── Core Learning Cycle — belajar setiap 2 menit ─────────────────────────────
export async function runBtcLearningCycle(): Promise<void> {
  if (isLearning || isExtremeRunning) return;
  isLearning = true;
  const cycleStart = Date.now();
  let questionsAsked = 0;
  let insightsSaved = 0;
  let spikeDetected = false;
  let indicators: BtcusdIndicators | null = null;

  try {
    // 1. Fetch live indicators
    try { indicators = await fetchBtcusdIndicators("1h"); } catch { /* try fallback */ }
    if (!indicators) {
      try { indicators = await getHistoricalIndicators(); } catch { /* skip */ }
    }
    if (!indicators) return;

    // 2. Spike detection
    try {
      const [last] = await db
        .select({ price: btcusdSnapshotsTable.price })
        .from(btcusdSnapshotsTable)
        .orderBy(desc(btcusdSnapshotsTable.snapshotAt))
        .limit(1);
      if (last) spikeDetected = Math.abs((indicators.price - last.price) / last.price) >= SPIKE_THRESHOLD;
    } catch { /* non-fatal */ }

    // 3. Ambil data tambahan secara paralel
    const [fgResult, fundingResult, avgVolumeResult] = await Promise.allSettled([
      fetchFearGreedIndex(),
      fetchBtcFundingRate(),
      getAvgVolume(24),
    ]);

    const fg = fgResult.status === "fulfilled" ? fgResult.value : null;
    const funding = fundingResult.status === "fulfilled" ? fundingResult.value : null;
    const avgVolume = avgVolumeResult.status === "fulfilled" ? avgVolumeResult.value : 0;
    const halving = getBtcHalvingContext();

    if (fg) console.log(`[BTC Brain] 😨 Fear & Greed: ${fg.value}/100 (${fg.classification})`);
    if (funding) console.log(`[BTC Brain] 💰 Funding Rate: ${(funding.rate * 100).toFixed(4)}%`);
    console.log(`[BTC Brain] 🪙 Halving: fase ${halving.phase} (${halving.daysSinceHalving} hari sejak halving)`);

    // 4. Save snapshot
    db.insert(btcusdSnapshotsTable).values({
      price: indicators.price, open: indicators.open, high: indicators.high,
      low: indicators.low, volume: indicators.volume, isSpike: spikeDetected,
      rsi14: indicators.rsi14, ema9: indicators.ema9, ema21: indicators.ema21,
      ema50: indicators.ema50, ema200: indicators.ema200,
      macdLine: indicators.macdLine, macdSignal: indicators.macdSignal,
      macdHistogram: indicators.macdHistogram,
      bbUpper: indicators.bbUpper, bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower, bbWidth: indicators.bbWidth,
      atr14: indicators.atr14, trend: indicators.trend,
      supportLevel: indicators.supportLevel, resistanceLevel: indicators.resistanceLevel,
      rsiSignal: indicators.rsiSignal, macdSignalType: indicators.macdSignalType,
      emaAlignment: indicators.emaAlignment,
    }).catch(() => {});

    // 5. Generate & jawab 5 pertanyaan per siklus (dari 3)
    const SYS = `Kamu adalah expert trader Bitcoin dengan pengalaman 10 tahun. Berikan jawaban SANGAT SPESIFIK dengan angka konkret, strategi actionable. Bahasa Indonesia. Minimal 3 poin actionable per jawaban.`;
    const sessionCache = new Set<string>();
    const questions = await generateQuestionsWithDeepSeek(
      indicators, 7, spikeDetected, sessionCache, fg, funding, halving
    ).catch(() => []);

    for (const { question, hash } of questions.slice(0, 5)) {
      try {
        sessionCache.add(hash);
        const inserted = await db
          .insert(btcusdQuestionsLogTable)
          .values({ question, questionHash: hash, marketContext: indicators as unknown as Record<string, unknown> })
          .onConflictDoNothing()
          .returning({ id: btcusdQuestionsLogTable.id });
        if (!inserted.length) continue;

        const answer = await queryDeepSeek(SYS, question, 900);
        const quality = scoreAnswer(question, answer);
        await db.update(btcusdQuestionsLogTable)
          .set({ answer, quality, answeredAt: new Date(), savedToBrain: quality >= QUALITY_THRESHOLD })
          .where(eq(btcusdQuestionsLogTable.id, inserted[0].id));
        questionsAsked++;

        if (quality >= QUALITY_THRESHOLD && answer.length > 100) {
          await db.insert(btcusdBrainTable).values({
            category: extractCategory(question),
            title: extractTitle(question, answer),
            content: answer,
            confidence: quality,
            sourceQuestion: question,
            marketConditionTags: extractMarketTags(indicators, avgVolume),
          });
          insightsSaved++;
          totalInsights++;
        }
      } catch { /* non-fatal */ }
    }

    // 6. Prediksi Ensemble Voting
    try {
      const corrResult = await Promise.allSettled([getBtcCorrelationAnalysis()]);
      await makePrediction(indicators, corrResult[0], fg, funding, halving, avgVolume);
    } catch (err) {
      console.error("[BTC Brain] Prediction error:", err);
    }

    // 7. Verifikasi prediksi lama + self-correction
    let checked = 0; let wrong = 0;
    try {
      const r = await verifyOldPredictions(indicators.price);
      checked = r.checked; wrong = r.wrong;
    } catch { /* non-fatal */ }

    // 8. Forget Curve
    try { await applyForgetCurve(); } catch { /* non-fatal */ }

    totalCycles++;
    lastCycleAt = new Date();
    console.log(`[BTC Brain] Cycle #${totalCycles}: price=$${indicators.price.toFixed(0)}, q=${questionsAsked}, ins=${insightsSaved}, checked=${checked}, wrong=${wrong} (${Date.now() - cycleStart}ms)`);

    await db.insert(btcusdLearningLogTable).values({
      priceAtCycle: indicators.price,
      questionsAsked,
      insightsSaved,
      predictionsChecked: checked,
      wrongPredictions: wrong,
      spikeDetected,
      summary: `Siklus #${totalCycles}: +${insightsSaved} insights, ${checked} prediksi diverifikasi (${wrong} salah). F&G: ${fg ? fg.value : "N/A"}, Funding: ${funding ? (funding.rate * 100).toFixed(4) + "%" : "N/A"}`,
      durationMs: Date.now() - cycleStart,
    }).catch(() => {});

  } finally {
    isLearning = false;
  }
}

// ─── Extreme mode ──────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
async function sleepOrAbort(ms: number): Promise<boolean> {
  const CHUNK = 1_000;
  let rem = ms;
  while (rem > 0) {
    if (extremeAbort) return true;
    await sleep(Math.min(CHUNK, rem));
    rem -= CHUNK;
  }
  return extremeAbort;
}

async function runBtcExtremeLearningLoop(target: number, qpc: number): Promise<void> {
  const SYS = `Kamu adalah expert trader Bitcoin/Crypto dengan pengalaman 10 tahun. Berikan jawaban SANGAT SPESIFIK, angka konkret, strategi actionable. Bahasa Indonesia. Minimal 3 poin actionable per jawaban.`;
  let consecutiveErrors = 0;
  const MAX_ERR = 5;
  const halving = getBtcHalvingContext();

  while (extremeProgress < target && !extremeAbort) {
    if (consecutiveErrors >= MAX_ERR) {
      console.warn("[BTC Extreme] Circuit breaker — jeda 5 menit...");
      consecutiveErrors = 0;
      if (await sleepOrAbort(5 * 60_000)) break;
      continue;
    }

    let indicators: BtcusdIndicators | null = null;
    try {
      indicators = await fetchBtcusdIndicators("1h");
      extremeDataMode = "live";
    } catch {
      try { indicators = await getHistoricalIndicators(); extremeDataMode = "historical"; } catch { /* */ }
    }
    if (!indicators) { if (await sleepOrAbort(30_000)) break; continue; }

    const [fgResult, fundingResult] = await Promise.allSettled([
      fetchFearGreedIndex(),
      fetchBtcFundingRate(),
    ]);
    const fg = fgResult.status === "fulfilled" ? fgResult.value : null;
    const funding = fundingResult.status === "fulfilled" ? fundingResult.value : null;

    const remaining = target - extremeProgress;
    const count = Math.min(qpc, remaining);
    let toAsk: Array<{ question: string; hash: string }> = [];

    try {
      toAsk = (await generateQuestionsWithDeepSeek(indicators, count + 3, false, extremeHashCache!, fg, funding, halving)).slice(0, count);
      if (toAsk.length) console.log(`[BTC Extreme] 🤖 DeepSeek generate ${toAsk.length} pertanyaan`);
    } catch (e) { console.warn("[BTC Extreme] Generate gagal:", String(e)); }

    if (!toAsk.length) { if (await sleepOrAbort(30_000)) break; extremeCycleCount++; continue; }

    for (const { question, hash } of toAsk) {
      if (extremeAbort || extremeProgress >= target) break;
      try {
        extremeHashCache!.add(hash);
        const inserted = await db
          .insert(btcusdQuestionsLogTable)
          .values({ question, questionHash: hash, marketContext: indicators as unknown as Record<string, unknown> })
          .onConflictDoNothing()
          .returning({ id: btcusdQuestionsLogTable.id });
        if (!inserted.length) { console.log("[BTC Extreme] ⏭ Skip duplikat"); continue; }

        const answer = await queryDeepSeek(SYS, question, 1_000);
        const quality = scoreAnswer(question, answer);
        await db.update(btcusdQuestionsLogTable)
          .set({ answer, quality, answeredAt: new Date(), savedToBrain: quality >= QUALITY_THRESHOLD })
          .where(eq(btcusdQuestionsLogTable.id, inserted[0].id));

        if (quality >= QUALITY_THRESHOLD && answer.length > 100) {
          await db.insert(btcusdBrainTable).values({
            category: extractCategory(question),
            title: extractTitle(question, answer),
            content: answer,
            confidence: quality,
            sourceQuestion: question,
            marketConditionTags: extractMarketTags(indicators),
          });
          extremeInsightsTotal++;
        }

        consecutiveErrors = 0;
        extremeProgress++;
        const nowTs = Date.now();
        extremeLastProgressAt = nowTs;
        extremeProgressHistory.push({ ts: nowTs, count: extremeProgress });
        if (extremeProgressHistory.length > 30) extremeProgressHistory.shift();

        if (extremeProgress % 10 === 0 || extremeProgress === target) {
          console.log(`[BTC Extreme] 📊 ${extremeProgress}/${target} (${Math.round((extremeProgress / target) * 100)}%) — Insights: ${extremeInsightsTotal}`);
        }
        if (extremeProgress >= target || extremeAbort) break;

        const pause = 10_000 + Math.random() * 10_000;
        console.log(`[BTC Extreme] ⏱ Jeda ${(pause / 1000).toFixed(0)}s → ke-${extremeProgress + 1}/${target}`);
        if (await sleepOrAbort(pause)) break;
      } catch (err) {
        consecutiveErrors++;
        console.error(`[BTC Extreme] ❌ Error (${consecutiveErrors}/${MAX_ERR}):`, String(err));
        extremeHashCache!.delete(hash);
        if (await sleepOrAbort(5_000)) break;
      }
    }
    extremeCycleCount++;
  }
}

export function startBtcExtremeLearningMode(target: number, questionsPerCycle: number): { ok: boolean; message: string } {
  if (isExtremeRunning) return { ok: false, message: "Mode ekstrem BTC sudah berjalan." };
  const safeQpc = Math.max(3, Math.min(questionsPerCycle, 20));
  isExtremeRunning = true;
  extremeTarget = target;
  extremeProgress = 0;
  extremeInsightsTotal = 0;
  extremeCycleCount = 0;
  extremeStartedAt = new Date();
  extremeAbort = false;
  extremeStopRequested = false;
  extremeProgressHistory = [];
  extremeLastProgressAt = null;
  extremeDataMode = "live";
  extremeHashCache = new Set();
  console.log(`[BTC Extreme] 🚀 Mulai — target: ${target} pertanyaan, ${safeQpc}/siklus`);
  (async () => {
    try { await runBtcExtremeLearningLoop(target, safeQpc); }
    catch (e) { console.error("[BTC Extreme] Loop error:", e); }
    finally {
      isExtremeRunning = false;
      extremeHashCache = null;
      console.log(`[BTC Extreme] ✅ Sesi berakhir — ${extremeProgress}/${extremeTarget} pertanyaan`);
    }
  })();
  return { ok: true, message: `Mode ekstrem BTC dimulai — target ${target} pertanyaan.` };
}

export function stopBtcExtremeLearningMode(): { ok: boolean; message: string } {
  if (!isExtremeRunning) return { ok: false, message: "Tidak ada sesi ekstrem BTC yang aktif." };
  extremeAbort = true;
  extremeStopRequested = true;
  console.log("[BTC Extreme] ⛔ Dihentikan oleh user");
  return { ok: true, message: "Perintah berhenti dikirim." };
}

export function getBtcEngineStatus() {
  const STALE_MS = 3 * 60_000;
  const isSpeedStale = extremeLastProgressAt === null || (isExtremeRunning && Date.now() - extremeLastProgressAt > STALE_MS);
  let speedQph = 0;
  if (!isSpeedStale && extremeProgressHistory.length >= 2) {
    const oldest = extremeProgressHistory[0];
    const newest = extremeProgressHistory[extremeProgressHistory.length - 1];
    const deltaCount = newest.count - oldest.count;
    const deltaMs = newest.ts - oldest.ts;
    if (deltaMs > 0 && deltaCount > 0) speedQph = Math.round((deltaCount / deltaMs) * 3_600_000);
  }
  const remaining = extremeTarget - extremeProgress;
  const etaMs = speedQph > 0 && remaining > 0 ? Math.round((remaining / speedQph) * 3_600_000) : null;

  return {
    running: learningTimer !== null,
    lastCycleAt,
    totalCycles,
    totalInsights,
    isLearning,
    marketOpen: true,
    extremeMode: {
      active: isExtremeRunning,
      target: extremeTarget,
      progress: extremeProgress,
      insights: extremeInsightsTotal,
      cycles: extremeCycleCount,
      startedAt: extremeStartedAt,
      percentDone: extremeTarget > 0 ? Math.round((extremeProgress / extremeTarget) * 100) : 0,
      stopRequested: extremeStopRequested,
      speedQph,
      etaMs,
      dataMode: extremeDataMode,
    },
  };
}

// ─── Engine start/stop — belajar setiap 2 menit + verifikasi setiap 60 detik ───
export function startBtcBrainEngine(): void {
  if (learningTimer) return;
  console.log("[BTC Brain] 🚀 Engine v2 started. Belajar setiap 2 menit + verifikasi setiap 60 detik.");
  console.log("[BTC Brain] Fitur baru: Fear & Greed Index, Funding Rate, Halving Phase, BB Squeeze, Volume Spike, Positive Reinforcement.");

  // Main cycle: setiap 2 menit (full learning + prediction)
  learningTimer = setInterval(() => { runBtcLearningCycle().catch(console.error); }, LEARN_INTERVAL_MS);

  // Mini cycle: setiap 60 detik (hanya verifikasi prediksi, tanpa AI call)
  verifyTimer = setInterval(() => { runBtcVerificationCycle().catch(console.error); }, VERIFY_INTERVAL_MS);

  // Jalankan cycle pertama langsung
  runBtcLearningCycle().catch(console.error);
}

export function stopBtcBrainEngine(): void {
  if (learningTimer) { clearInterval(learningTimer); learningTimer = null; }
  if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
  console.log("[BTC Brain] Engine stopped.");
}
