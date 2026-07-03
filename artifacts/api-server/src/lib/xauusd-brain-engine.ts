/**
 * XAUUSD Autonomous Learning Brain Engine
 *
 * Runs a non-stop background learning loop:
 *  1. Fetch XAUUSD realtime data + calculate all indicators
 *  2. Save market snapshot to DB
 *  3. Detect spikes — record extra info when spike occurs
 *  4. Generate unique study questions based on market conditions
 *  5. Query DeepSeek for each question — never repeats same question
 *  6. Score answers and save good ones to "brain" (xauusd_brain table)
 *  7. Make a directional prediction for next period
 *  8. Verify previous predictions — self-critique when wrong
 *  9. Fetch & analyze latest XAUUSD news
 * 10. Log the full cycle to xauusd_learning_log
 */

import crypto from "crypto";
import { db } from "@workspace/db";
import {
  xauusdSnapshotsTable,
  xauusdBrainTable,
  xauusdQuestionsLogTable,
  xauusdPredictionsTable,
  xauusdNewsTable,
  xauusdLearningLogTable,
} from "@workspace/db/schema";
import { eq, and, lt, isNull, desc, sql } from "drizzle-orm";
import {
  fetchXauusdIndicators,
  fetchXauusdNews,
  getMultiTimeframeAnalysis,
  summarizeTimeframeConfluence,
  getCorrelationAnalysis,
  type XauusdIndicators,
} from "./xauusd-data.js";
import { getDeepseekApiKey, getPredictionTimeframeMinutes } from "./xauusd-settings.js";
import { notifyNewPrediction } from "./xauusd-whatsapp.js";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const LEARN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const SPIKE_THRESHOLD = 0.003; // 0.3% price change = spike
const DEEPSEEK_TIMEOUT_MS = 45_000; // 45s timeout per DeepSeek call

let learningTimer: ReturnType<typeof setInterval> | null = null;
// Shared global lock — prevents concurrent execution from both interval and /learn-now
let isLearning = false;
let lastCycleAt: Date | null = null;
let totalCycles = 0;
let totalInsights = 0;

// ─── DeepSeek query ────────────────────────────────────────────────────────────

async function queryDeepSeek(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) {
    return "[AI tidak aktif — DeepSeek API key belum diset. Atur di halaman Pengaturan.]";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`DeepSeek HTTP ${res.status}: ${err}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return json.choices[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Question generator ────────────────────────────────────────────────────────

const QUESTION_TEMPLATES = [
  // RSI-based
  (i: XauusdIndicators) =>
    `Dengan RSI XAUUSD saat ini di ${i.rsi14?.toFixed(1)} dan harga $${i.price}, apa probabilitas reversal dalam 4 jam ke depan dan bagaimana trader profesional biasanya merespons kondisi RSI ini?`,
  (i: XauusdIndicators) =>
    `RSI XAUUSD ${i.rsi14?.toFixed(1)} dengan EMA9 $${i.ema9} dan EMA21 $${i.ema21}. Apa sinyal trading yang paling valid dari kombinasi indikator ini menurut analisis teknikal gold trading?`,
  // EMA-based
  (i: XauusdIndicators) =>
    `EMA9 XAUUSD (${i.ema9}) vs EMA21 (${i.ema21}) vs EMA50 (${i.ema50}) — alignment saat ini adalah ${i.emaAlignment}. Jelaskan implikasi momentum jangka menengah dan strategi entry/exit optimal.`,
  (i: XauusdIndicators) =>
    `Harga XAUUSD $${i.price} sedang ${i.price > (i.ema200 ?? 0) ? "di atas" : "di bawah"} EMA200 ($${i.ema200}). Apa makna jangka panjang dari posisi ini dan kapan reversal biasanya terjadi pada kasus serupa?`,
  // MACD-based
  (i: XauusdIndicators) =>
    `MACD XAUUSD: line=${i.macdLine?.toFixed(3)}, signal=${i.macdSignal?.toFixed(3)}, histogram=${i.macdHistogram?.toFixed(3)}. Signal type: ${i.macdSignalType}. Bagaimana interpretasi divergensi MACD vs price action di gold market?`,
  // Bollinger Bands
  (i: XauusdIndicators) =>
    `Bollinger Bands XAUUSD: upper=$${i.bbUpper?.toFixed(2)}, middle=$${i.bbMiddle?.toFixed(2)}, lower=$${i.bbLower?.toFixed(2)}, width=${i.bbWidth?.toFixed(2)}%. Harga saat ini $${i.price}. Apa strategi squeeze breakout yang paling efektif untuk XAUUSD?`,
  // Support/Resistance
  (i: XauusdIndicators) =>
    `XAUUSD mendekati resistance $${i.resistanceLevel?.toFixed(2)} dengan support di $${i.supportLevel?.toFixed(2)}. RSI ${i.rsi14?.toFixed(1)}, ATR ${i.atr14?.toFixed(2)}. Berapa risk:reward ratio optimal untuk setup ini?`,
  // Trend-based
  (i: XauusdIndicators) =>
    `Trend XAUUSD saat ini: ${i.trend}, dengan EMA alignment ${i.emaAlignment}. Faktor makro apa (DXY, yield treasury, inflasi) yang paling berpengaruh pada gold saat trend ${i.trend} seperti ini?`,
  // ATR volatility
  (i: XauusdIndicators) =>
    `ATR14 XAUUSD saat ini ${i.atr14?.toFixed(2)} (${((i.atr14 ?? 0) / i.price * 100).toFixed(3)}% dari harga). Ini termasuk volatilitas tinggi atau rendah historisnya? Bagaimana pengaruhnya pada ukuran posisi optimal?`,
  // Spike analysis
  (i: XauusdIndicators) =>
    `Sebutkan 5 pola teknikal paling reliabel di XAUUSD/Gold yang memiliki win rate di atas 65%. Untuk setiap pola, jelaskan kondisi RSI (${i.rsi14?.toFixed(1)} saat ini) dan EMA yang mendukungnya.`,
  // Multi-timeframe
  (i: XauusdIndicators) =>
    `Apa strategi multi-timeframe analysis terbaik untuk trading XAUUSD dengan modal kecil? Saat ini: H1 RSI=${i.rsi14?.toFixed(1)}, trend=${i.trend}. Timeframe mana yang paling kritis untuk entry?`,
  // News impact
  () =>
    `Jelaskan hubungan antara data NFP (Non-Farm Payroll) Amerika, kebijakan Fed, dan pergerakan harga gold/XAUUSD. Berapa basis poin pergerakan rata-rata XAUUSD setelah rilis NFP?`,
  // Session timing
  () =>
    `Di jam berapa (WIB/GMT) volatilitas XAUUSD paling tinggi dan paling rendah? Bagaimana strategi trading yang berbeda untuk London session vs New York session vs Asian session?`,
  // Psychology
  () =>
    `Apa kesalahan psikologi trading paling umum yang dilakukan retail trader di XAUUSD? Bagaimana cara mendeteksi dan menghindarinya menggunakan indikator teknikal?`,
  // Risk management
  (i: XauusdIndicators) =>
    `Dengan ATR XAUUSD ${i.atr14?.toFixed(2)}, di mana sebaiknya stoploss dan takeprofit ditempatkan untuk trade buy/sell? Jelaskan metode ATR-based position sizing untuk gold.`,
];

function generateQuestionHash(question: string): string {
  return crypto.createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
}

function getRandomQuestions(
  indicators: XauusdIndicators,
  count: number
): Array<{ question: string; hash: string }> {
  // Shuffle templates
  const shuffled = [...QUESTION_TEMPLATES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map((template) => {
    const question = template(indicators);
    return { question, hash: generateQuestionHash(question) };
  });
}

async function filterNewQuestions(
  candidates: Array<{ question: string; hash: string }>
): Promise<Array<{ question: string; hash: string }>> {
  const existingHashes = await db
    .select({ hash: xauusdQuestionsLogTable.questionHash })
    .from(xauusdQuestionsLogTable);
  const existingSet = new Set(existingHashes.map((r: { hash: string }) => r.hash));
  return candidates.filter((c) => !existingSet.has(c.hash));
}

// ─── Answer quality scorer ─────────────────────────────────────────────────────

function scoreAnswer(question: string, answer: string): number {
  if (!answer || answer.length < 100) return 0;

  let score = 0.5;
  const lc = answer.toLowerCase();

  // Length bonus
  if (answer.length > 500) score += 0.1;
  if (answer.length > 1000) score += 0.1;

  // Technical specificity
  const technicalTerms = [
    "rsi", "ema", "macd", "support", "resistance", "entry", "exit",
    "stop loss", "take profit", "risk", "ratio", "win rate", "setup",
    "breakout", "breakdown", "divergence", "momentum", "trend",
    "session", "volatility", "atr", "bollinger",
  ];
  const matchedTerms = technicalTerms.filter((t) => lc.includes(t));
  score += Math.min(0.25, matchedTerms.length * 0.02);

  // Numbers and specific data
  const numbers = answer.match(/\d+\.?\d*/g) ?? [];
  if (numbers.length > 5) score += 0.05;

  // Penalize vague answers
  const vague = ["itu tergantung", "sangat bervariasi", "tidak bisa dipastikan"];
  if (vague.some((v) => lc.includes(v))) score -= 0.1;

  return Math.min(1, Math.max(0, score));
}

// ─── Brain updater ─────────────────────────────────────────────────────────────

function extractBrainCategory(
  question: string
): "trading_rule" | "pattern" | "insight" | "lesson" | "news_impact" {
  const lc = question.toLowerCase();
  if (lc.includes("news") || lc.includes("nfp") || lc.includes("fed") || lc.includes("makro"))
    return "news_impact";
  if (lc.includes("pola") || lc.includes("pattern") || lc.includes("breakout"))
    return "pattern";
  if (lc.includes("strategi") || lc.includes("entry") || lc.includes("exit") || lc.includes("stop"))
    return "trading_rule";
  if (lc.includes("psikologi") || lc.includes("kesalahan") || lc.includes("manajemen"))
    return "lesson";
  return "insight";
}

function extractTitle(question: string, answer: string): string {
  // First sentence of answer, or first 80 chars of question
  const firstSentence = answer.split(/[.!?\n]/)[0];
  if (firstSentence && firstSentence.length > 20 && firstSentence.length < 120) {
    return firstSentence.trim();
  }
  return question.slice(0, 80).trim() + (question.length > 80 ? "..." : "");
}

function extractMarketTags(indicators: XauusdIndicators): string {
  const tags: string[] = [];
  if (indicators.rsiSignal === "overbought") tags.push("rsi_overbought");
  if (indicators.rsiSignal === "oversold") tags.push("rsi_oversold");
  if (indicators.emaAlignment === "bullish_stack") tags.push("ema_bullish");
  if (indicators.emaAlignment === "bearish_stack") tags.push("ema_bearish");
  if (indicators.macdSignalType !== "neutral") tags.push(`macd_${indicators.macdSignalType}`);
  tags.push(`trend_${indicators.trend}`);
  return tags.join(",");
}

// ─── Rule-based prediction fallback (ATR + support/resistance based) ──────────
// Used when the AI call is unavailable or returns unparseable output, so the
// entry range / stop loss are always derived from real technical analysis
// rather than being invented arbitrarily.

interface RuleBasedPrediction {
  direction: "up" | "down" | "sideways";
  targetPrice: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  confidence: number;
  reasoning: string;
}

function computeRuleBasedPrediction(indicators: XauusdIndicators): RuleBasedPrediction {
  const price = indicators.price;
  const atr = indicators.atr14 ?? price * 0.003; // fallback ~0.3% if ATR unavailable

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

  // Entry zone = a small pullback band around current price (0.15–0.4 ATR),
  // anchored toward support (for longs) or resistance (for shorts).
  const pullback = atr * 0.3;
  let entryLow: number;
  let entryHigh: number;
  let stopLoss: number;
  let targetPrice: number;

  const support = indicators.supportLevel ?? price - atr * 2;
  const resistance = indicators.resistanceLevel ?? price + atr * 2;

  if (direction === "up") {
    entryLow = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback * 0.3).toFixed(2));
    stopLoss = parseFloat(
      Math.min(support - atr * 0.3, price - atr * 1.5).toFixed(2)
    );
    targetPrice = parseFloat((price + atr * 2.5).toFixed(2));
  } else if (direction === "down") {
    entryLow = parseFloat((price - pullback * 0.3).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    stopLoss = parseFloat(
      Math.max(resistance + atr * 0.3, price + atr * 1.5).toFixed(2)
    );
    targetPrice = parseFloat((price - atr * 2.5).toFixed(2));
  } else {
    entryLow = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    stopLoss = parseFloat((price - atr * 1.5).toFixed(2));
    targetPrice = parseFloat(price.toFixed(2));
  }

  const reasoning = `Analisis rule-based: trend=${indicators.trend}, EMA alignment=${indicators.emaAlignment}, RSI=${indicators.rsi14?.toFixed(1) ?? "-"} (${indicators.rsiSignal}), MACD=${indicators.macdSignalType}. ATR14=${atr.toFixed(2)} dipakai untuk menentukan rentang entry dan stop loss di sekitar support $${indicators.supportLevel} / resistance $${indicators.resistanceLevel}.`;

  return { direction, targetPrice, entryLow, entryHigh, stopLoss, confidence, reasoning };
}

// ─── Prediction maker ──────────────────────────────────────────────────────────

async function makePrediction(indicators: XauusdIndicators): Promise<void> {
  const timeframeMinutes = await getPredictionTimeframeMinutes();
  const timeframeLabel = `${timeframeMinutes}m`;

  // Gather multi-timeframe confluence + DXY/yield correlation context so the
  // AI's prediction accounts for higher-timeframe trend and macro factors,
  // not just the 1H indicators. Both are best-effort — if either external
  // fetch fails, the prediction still proceeds using only 1H indicators.
  let mtfContext = "";
  try {
    const mtf = await getMultiTimeframeAnalysis();
    const confluence = summarizeTimeframeConfluence(mtf);
    mtfContext = `\n\n=== ANALISIS MULTI-TIMEFRAME ===\n${mtf
      .map((t) => `${t.label}: trend=${t.indicators?.trend ?? "n/a"}, RSI=${t.indicators?.rsi14?.toFixed(1) ?? "n/a"}, EMA alignment=${t.indicators?.emaAlignment ?? "n/a"}`)
      .join("\n")}\nKesimpulan confluence: ${confluence.agreement} (${confluence.bullishCount} timeframe bullish, ${confluence.bearishCount} bearish)`;
  } catch (err) {
    console.error("[XAUUSD Brain] Multi-timeframe context error:", err);
  }

  let correlationContext = "";
  try {
    const corr = await getCorrelationAnalysis();
    correlationContext = `\n\n=== KORELASI MAKRO (DXY & US10Y) ===\nDXY: $${corr.dxy.price ?? "n/a"} (${corr.dxy.changePct != null ? (corr.dxy.changePct > 0 ? "+" : "") + corr.dxy.changePct.toFixed(2) + "%" : "n/a"}), korelasi vs gold=${corr.dxy.correlation ?? "n/a"}\nUS 10Y Yield: ${corr.us10y.price ?? "n/a"}% (${corr.us10y.changePct != null ? (corr.us10y.changePct > 0 ? "+" : "") + corr.us10y.changePct.toFixed(2) + "%" : "n/a"}), korelasi vs gold=${corr.us10y.correlation ?? "n/a"}`;
  } catch (err) {
    console.error("[XAUUSD Brain] Correlation context error:", err);
  }

  const systemPrompt = `Kamu adalah AI trading system untuk XAUUSD. 
Buat prediksi arah harga untuk ${timeframeMinutes} menit ke depan berdasarkan indikator teknikal 1H, konfirmasi dari analisis multi-timeframe (1H/4H/Harian), dan faktor korelasi makro (DXY, US 10-Year Treasury Yield).
Selain arah, tentukan juga rentang harga entry (entryLow-entryHigh) yang ideal untuk masuk posisi, dan level stop loss (stopLoss) untuk membatasi kerugian.
Jawab SELALU dalam format JSON:
{
  "direction": "up" | "down" | "sideways",
  "targetPrice": <harga target dalam USD>,
  "entryLow": <batas bawah rentang harga entry dalam USD>,
  "entryHigh": <batas atas rentang harga entry dalam USD>,
  "stopLoss": <harga stop loss dalam USD>,
  "confidence": <0.0-1.0>,
  "reasoning": "<2-3 kalimat alasan, sebutkan jika multi-timeframe atau DXY/yield mendukung atau bertentangan dengan sinyal 1H>"
}`;

  const userMsg = `Indikator XAUUSD saat ini:
Harga: $${indicators.price}
RSI14: ${indicators.rsi14} (${indicators.rsiSignal})
EMA9: ${indicators.ema9}, EMA21: ${indicators.ema21}, EMA50: ${indicators.ema50}, EMA200: ${indicators.ema200}
MACD: line=${indicators.macdLine}, signal=${indicators.macdSignal}, hist=${indicators.macdHistogram} (${indicators.macdSignalType})
BB: upper=${indicators.bbUpper}, mid=${indicators.bbMiddle}, lower=${indicators.bbLower}, width=${indicators.bbWidth}%
ATR14: ${indicators.atr14}
Trend: ${indicators.trend}, EMA Alignment: ${indicators.emaAlignment}${mtfContext}${correlationContext}
Support: $${indicators.supportLevel}, Resistance: $${indicators.resistanceLevel}

Buat prediksi ${timeframeMinutes} menit ke depan dalam format JSON, termasuk entryLow, entryHigh, dan stopLoss.`;

  // Always compute the rule-based prediction first (real technical analysis
  // from ATR/support/resistance/EMA/RSI/MACD) — this is the source of truth
  // for entry range + stop loss when the AI is unavailable or unparseable,
  // and also used to sanity-check the AI's numbers.
  const ruleBased = computeRuleBasedPrediction(indicators);

  let pred: {
    direction: string;
    targetPrice: number;
    entryLow?: number;
    entryHigh?: number;
    stopLoss?: number;
    confidence: number;
    reasoning: string;
  } = ruleBased;
  let aiPowered = false;

  try {
    const raw = await queryDeepSeek(systemPrompt, userMsg, 400);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        direction: string;
        targetPrice: number;
        entryLow?: number;
        entryHigh?: number;
        stopLoss?: number;
        confidence: number;
        reasoning: string;
      };
      // Only trust the AI response if it actually supplied numeric entry/SL
      // levels — otherwise fall back to the rule-based analysis so we never
      // save arbitrary/missing numbers.
      if (
        typeof parsed.entryLow === "number" &&
        typeof parsed.entryHigh === "number" &&
        typeof parsed.stopLoss === "number" &&
        typeof parsed.targetPrice === "number"
      ) {
        pred = parsed;
        aiPowered = true;
      }
    }
  } catch (err) {
    console.error("[XAUUSD Brain] AI prediction parse error, using rule-based fallback:", err);
  }

  try {
    const verifyAt = new Date(Date.now() + timeframeMinutes * 60 * 1000);

    const direction = pred.direction ?? ruleBased.direction;
    const targetPrice = pred.targetPrice ?? ruleBased.targetPrice;
    const entryLow = pred.entryLow ?? ruleBased.entryLow;
    const entryHigh = pred.entryHigh ?? ruleBased.entryHigh;
    const stopLoss = pred.stopLoss ?? ruleBased.stopLoss;
    const confidence = Math.min(1, Math.max(0, pred.confidence ?? ruleBased.confidence));
    const reasoning = aiPowered
      ? (pred.reasoning ?? ruleBased.reasoning)
      : `${ruleBased.reasoning} (AI tidak tersedia — dihitung dari analisis teknikal)`;

    await db.insert(xauusdPredictionsTable).values({
      timeframe: timeframeLabel,
      direction,
      targetPrice,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      indicatorsAtPrediction: indicators as unknown as Record<string, unknown>,
      verifyAt,
      status: "pending",
    });

    // Fire-and-forget WhatsApp alert — no-ops if not configured/enabled.
    void notifyNewPrediction({
      direction,
      targetPrice,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      timeframe: timeframeLabel,
    });
  } catch (err) {
    console.error("[XAUUSD Brain] Prediction save error:", err);
  }
}

// ─── Prediction verifier ───────────────────────────────────────────────────────

async function verifyOldPredictions(currentPrice: number): Promise<{ checked: number; wrong: number }> {
  const now = new Date();
  const pending = await db
    .select()
    .from(xauusdPredictionsTable)
    .where(
      and(
        eq(xauusdPredictionsTable.status, "pending"),
        lt(xauusdPredictionsTable.verifyAt, now)
      )
    )
    .limit(5);

  if (pending.length === 0) return { checked: 0, wrong: 0 };

  let wrongCount = 0;

  for (const pred of pending) {
    const priceDiff = currentPrice - pred.priceAtPrediction;
    const pricePct = priceDiff / pred.priceAtPrediction;

    const actualDirection =
      pricePct > 0.002 ? "up" : pricePct < -0.002 ? "down" : "sideways";
    const isCorrect = actualDirection === pred.direction;

    if (!isCorrect) {
      wrongCount++;
      // Self-critique: ask DeepSeek why the prediction was wrong
      const sysPr = `Kamu adalah AI trading coach untuk XAUUSD. Analisis mengapa prediksi salah dan berikan pelajaran spesifik.`;
      const msg = `Prediksi saya ${pred.direction} dari $${pred.priceAtPrediction} dengan alasan: "${pred.reasoning}"
Kenyataannya: harga bergerak ${actualDirection} ke $${currentPrice.toFixed(2)} (${pricePct > 0 ? "+" : ""}${(pricePct * 100).toFixed(3)}%).
Tulis 2-3 kalimat pelajaran spesifik yang harus diingat untuk menghindari kesalahan prediksi serupa di masa depan.`;

      let critique: string | null = null;
      try {
        const raw = await queryDeepSeek(sysPr, msg, 300);
        if (raw && raw.length > 50) {
          critique = raw;
          // Save as lesson in brain
          await db.insert(xauusdBrainTable).values({
            category: "lesson",
            title: `Revisi: Prediksi ${pred.direction} salah pada ${pred.priceAtPrediction.toFixed(2)}`,
            content: critique,
            confidence: 0.8,
            sourceQuestion: `Why was ${pred.direction} prediction from ${pred.priceAtPrediction} wrong?`,
            marketConditionTags: pred.reasoning?.slice(0, 100) ?? "",
          });
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Self-critique error:", err);
      }
      // Always mark prediction as resolved — never leave stuck in pending
      await db
        .update(xauusdPredictionsTable)
        .set({
          actualPrice: currentPrice,
          actualDirection,
          isCorrect,
          priceDiff,
          revisedAt: critique ? new Date() : null,
          revisionNote: critique,
          status: critique ? "revised" : "verified",
        })
        .where(eq(xauusdPredictionsTable.id, pred.id));
    } else {
      await db
        .update(xauusdPredictionsTable)
        .set({
          actualPrice: currentPrice,
          actualDirection,
          isCorrect,
          priceDiff,
          status: "verified",
        })
        .where(eq(xauusdPredictionsTable.id, pred.id));
    }
  }

  return { checked: pending.length, wrong: wrongCount };
}

// ─── News analyzer ────────────────────────────────────────────────────────────

async function analyzeAndSaveNews(): Promise<void> {
  try {
    const newsItems = await fetchXauusdNews();
    if (newsItems.length === 0) return;

    const sysPr = `Kamu adalah analis berita gold/XAUUSD. Untuk setiap berita, tentukan sentiment (bullish/bearish/neutral) dan berikan analisis singkat dampaknya pada harga gold.`;
    const hasKey = !!(await getDeepseekApiKey());

    for (const item of newsItems.slice(0, 5)) {
      // Only analyze first 5 to save API calls
      let sentiment: string = "neutral";
      let aiAnalysis: string | null = null;

      if (hasKey) {
        try {
          const raw = await queryDeepSeek(
            sysPr,
            `Judul: "${item.title}"\nRingkasan: "${item.summary}"\n\nJawab format JSON: {"sentiment":"bullish"|"bearish"|"neutral","analysis":"<1-2 kalimat dampak pada XAUUSD>"}`,
            200
          );
          const jm = raw.match(/\{[\s\S]*\}/);
          if (jm) {
            const parsed = JSON.parse(jm[0]) as {
              sentiment: string;
              analysis: string;
            };
            sentiment = parsed.sentiment ?? "neutral";
            aiAnalysis = parsed.analysis ?? null;
          }
        } catch {
          // skip if analysis fails
        }
      }

      // Upsert by title (avoid duplicates)
      await db
        .insert(xauusdNewsTable)
        .values({
          title: item.title,
          summary: item.summary,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
          sentiment,
          aiAnalysis,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error("[XAUUSD Brain] News error:", err);
  }
}

// ─── Main learning cycle ───────────────────────────────────────────────────────

export async function runLearningCycle(): Promise<{
  success: boolean;
  summary: string;
  questionsAsked: number;
  insightsSaved: number;
}> {
  // Global lock — prevent overlap between interval cycles and manual /learn-now trigger
  if (isLearning) {
    return { success: false, summary: "Cycle already in progress, skipping.", questionsAsked: 0, insightsSaved: 0 };
  }
  isLearning = true;

  const cycleStart = Date.now();
  let questionsAsked = 0;
  let insightsSaved = 0;
  let wrongPredictions = 0;
  let predictionsChecked = 0;
  let spikeDetected = false;
  let currentPrice = 0;

  try {
    console.log("[XAUUSD Brain] Starting learning cycle...");

    // 1. Fetch indicators from TradingView Scanner
    const indicators = await fetchXauusdIndicators("1h");
    if (!indicators) {
      return { success: false, summary: "TradingView Scanner returned no data", questionsAsked: 0, insightsSaved: 0 };
    }
    currentPrice = indicators.price;

    // 2. Detect spike (compare with last snapshot)
    const lastSnap = await db
      .select({ price: xauusdSnapshotsTable.price })
      .from(xauusdSnapshotsTable)
      .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
      .limit(1);

    let priceChange: number | null = null;
    if (lastSnap.length > 0) {
      priceChange = (indicators.price - lastSnap[0].price) / lastSnap[0].price;
      spikeDetected = Math.abs(priceChange) >= SPIKE_THRESHOLD;
    }

    // 3. Save snapshot
    await db.insert(xauusdSnapshotsTable).values({
      price: indicators.price,
      open: indicators.open,
      high: indicators.high,
      low: indicators.low,
      volume: indicators.volume,
      priceChange: priceChange ? parseFloat((priceChange * 100).toFixed(4)) : null,
      isSpike: spikeDetected,
      rsi14: indicators.rsi14,
      ema9: indicators.ema9,
      ema21: indicators.ema21,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      macdLine: indicators.macdLine,
      macdSignal: indicators.macdSignal,
      macdHistogram: indicators.macdHistogram,
      bbUpper: indicators.bbUpper,
      bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower,
      bbWidth: indicators.bbWidth,
      atr14: indicators.atr14,
      trend: indicators.trend,
      rsiSignal: indicators.rsiSignal,
      macdSignalType: indicators.macdSignalType,
      emaAlignment: indicators.emaAlignment,
      supportLevel: indicators.supportLevel,
      resistanceLevel: indicators.resistanceLevel,
    });

    // 4. Generate & ask unique questions (3 per cycle, 5 on spike)
    const questionCount = spikeDetected ? 5 : 3;
    const candidates = getRandomQuestions(indicators, questionCount + 4); // extras for filtering
    const newQuestions = await filterNewQuestions(candidates);
    const toAsk = newQuestions.slice(0, questionCount);

    for (const { question, hash } of toAsk) {
      questionsAsked++;
      const sysPr = `Kamu adalah expert trader XAUUSD/Gold dengan pengalaman 20 tahun. 
Berikan jawaban SANGAT SPESIFIK, dengan angka konkret, strategi actionable, dan pelajaran yang bisa langsung diaplikasikan.
Gunakan Bahasa Indonesia. Hindari jawaban generik.`;

      try {
        // Insert question placeholder
        const [inserted] = await db
          .insert(xauusdQuestionsLogTable)
          .values({
            question,
            questionHash: hash,
            marketContext: indicators as unknown as Record<string, unknown>,
          })
          .returning({ id: xauusdQuestionsLogTable.id });

        const answer = await queryDeepSeek(sysPr, question, 900);
        const quality = scoreAnswer(question, answer);

        await db
          .update(xauusdQuestionsLogTable)
          .set({
            answer,
            quality,
            answeredAt: new Date(),
            savedToBrain: quality >= 0.6,
          })
          .where(eq(xauusdQuestionsLogTable.id, inserted.id));

        // 5. Save good answers to brain
        if (quality >= 0.6 && answer.length > 100) {
          await db.insert(xauusdBrainTable).values({
            category: extractBrainCategory(question),
            title: extractTitle(question, answer),
            content: answer,
            confidence: quality,
            sourceQuestion: question,
            marketConditionTags: extractMarketTags(indicators),
          });
          insightsSaved++;
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Q&A error:", err);
      }
    }

    // 6. Verify old predictions & self-revise
    const verifyResult = await verifyOldPredictions(indicators.price);
    predictionsChecked = verifyResult.checked;
    wrongPredictions = verifyResult.wrong;

    // 7. Make new prediction (every cycle)
    await makePrediction(indicators);

    // 8. Fetch & analyze news (every 3rd cycle to save API calls)
    if (totalCycles % 3 === 0) {
      await analyzeAndSaveNews();
    }

    // 9. Save learning log
    const durationMs = Date.now() - cycleStart;
    const summary = `Cycle #${totalCycles + 1}: price=${currentPrice}, ${spikeDetected ? "⚡SPIKE " : ""}questions=${questionsAsked}, insights=${insightsSaved}, checked=${predictionsChecked}, wrong=${wrongPredictions}`;

    await db.insert(xauusdLearningLogTable).values({
      priceAtCycle: currentPrice,
      questionsAsked,
      insightsSaved,
      predictionsChecked,
      wrongPredictions,
      spikeDetected,
      summary,
      durationMs,
    });

    totalCycles++;
    totalInsights += insightsSaved;
    lastCycleAt = new Date();
    console.log(`[XAUUSD Brain] ${summary} (${durationMs}ms)`);

    return { success: true, summary, questionsAsked, insightsSaved };
  } catch (err) {
    console.error("[XAUUSD Brain] Cycle error:", err);
    return {
      success: false,
      summary: String(err),
      questionsAsked,
      insightsSaved,
    };
  } finally {
    // Always release the lock so next cycle can run
    isLearning = false;
  }
}

// ─── Start / Stop engine ───────────────────────────────────────────────────────

export function startXauusdBrainEngine(): void {
  if (learningTimer) return; // already running

  console.log("[XAUUSD Brain] Engine started. Learning cycle every 15 minutes.");

  // Run first cycle immediately (non-blocking); runLearningCycle owns the lock
  runLearningCycle().catch((err) =>
    console.error("[XAUUSD Brain] Initial cycle error:", err)
  );

  // Interval just triggers the cycle; the lock inside runLearningCycle prevents overlap
  learningTimer = setInterval(() => {
    runLearningCycle().catch((err) =>
      console.error("[XAUUSD Brain] Interval cycle error:", err)
    );
  }, LEARN_INTERVAL_MS);
}

export function stopXauusdBrainEngine(): void {
  if (learningTimer) {
    clearInterval(learningTimer);
    learningTimer = null;
    console.log("[XAUUSD Brain] Engine stopped.");
  }
}

export function getEngineStatus(): {
  running: boolean;
  lastCycleAt: Date | null;
  totalCycles: number;
  totalInsights: number;
  isLearning: boolean;
} {
  return {
    running: learningTimer !== null,
    lastCycleAt,
    totalCycles,
    totalInsights,
    isLearning,
  };
}
