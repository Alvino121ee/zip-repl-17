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
import { syncToFile, autoRestoreIfEmpty } from "./brain-sqlite-backup.js";
import {
  xauusdSnapshotsTable,
  xauusdBrainTable,
  xauusdQuestionsLogTable,
  xauusdPredictionsTable,
  xauusdNewsTable,
  xauusdLearningLogTable,
  xauusdMacroSnapshotsTable,
} from "@workspace/db/schema";
import { eq, and, lt, isNull, desc, sql, gte, or } from "drizzle-orm";
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
const LEARN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — faster learning
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
  // ── RSI ──────────────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Dengan RSI XAUUSD saat ini di ${i.rsi14?.toFixed(1)} dan harga ${i.price}, apa probabilitas reversal dalam 4 jam ke depan dan bagaimana trader profesional biasanya merespons kondisi RSI ini?`,
  (i: XauusdIndicators) =>
    `RSI XAUUSD ${i.rsi14?.toFixed(1)} dengan EMA9 ${i.ema9} dan EMA21 ${i.ema21}. Apa sinyal trading yang paling valid dari kombinasi indikator ini? Kapan RSI divergen dari harga dan apa artinya?`,
  (i: XauusdIndicators) =>
    `RSI XAUUSD ${i.rsi14?.toFixed(1)} berada di zona ${i.rsiSignal}. Jelaskan perbedaan antara RSI overbought dalam trend naik kuat vs overbought saat reversal — bagaimana cara membedakannya dengan konfirmasi candlestick?`,
  (i: XauusdIndicators) =>
    `Saat RSI XAUUSD di ${i.rsi14?.toFixed(1)} dan Bollinger Band width ${i.bbWidth?.toFixed(2)}%, apakah ada potensi squeeze breakout? Jelaskan kapan RSI ekstrem + Bollinger squeeze menghasilkan setup terbaik di gold.`,

  // ── EMA / Trend ───────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `EMA9 XAUUSD (${i.ema9}) vs EMA21 (${i.ema21}) vs EMA50 (${i.ema50}) — alignment saat ini ${i.emaAlignment}. Jelaskan strategi "EMA fan" untuk gold dan kapan konfluens EMA paling reliable sebagai sinyal entry.`,
  (i: XauusdIndicators) =>
    `Harga XAUUSD ${i.price} berada ${i.price > (i.ema200 ?? 0) ? "di atas" : "di bawah"} EMA200 (${i.ema200}). Apa bias jangka panjang dari posisi ini? Kapan setup counter-trend trade aman dilakukan jika price jauh dari EMA200?`,
  (i: XauusdIndicators) =>
    `Dengan EMA alignment ${i.emaAlignment} di XAUUSD, apa teknik terbaik untuk entry pullback? Jelaskan 3 level pullback ideal (EMA9, EMA21, EMA50) untuk trade dengan trend yang ada.`,
  (i: XauusdIndicators) =>
    `EMA50 XAUUSD di ${i.ema50} dan EMA200 di ${i.ema200}. Harga ${i.price}. Seberapa jauh harga biasanya bisa jatuh ke EMA50 sebelum bounce saat uptrend? Berikan angka statistik historis jika memungkinkan.`,

  // ── MACD ─────────────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `MACD XAUUSD: line=${i.macdLine?.toFixed(3)}, signal=${i.macdSignal?.toFixed(3)}, histogram=${i.macdHistogram?.toFixed(3)} (${i.macdSignalType}). Bagaimana cara menggunakan MACD histogram untuk mengukur kekuatan momentum gold? Kapan MACD divergence lebih valid dari cross?`,
  (i: XauusdIndicators) =>
    `MACD XAUUSD signal type: ${i.macdSignalType}. Jelaskan perbedaan win rate MACD cross di trending market vs ranging market untuk XAUUSD. Bagaimana mengkonfirmasi dengan volume agar tidak terjebak false signal?`,

  // ── Bollinger Bands ───────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Bollinger Bands XAUUSD: upper=${i.bbUpper?.toFixed(2)}, middle=${i.bbMiddle?.toFixed(2)}, lower=${i.bbLower?.toFixed(2)}, width=${i.bbWidth?.toFixed(2)}%. Harga saat ini ${i.price}. Strategi apa yang paling optimal: mean reversion ke BB middle, atau breakout melewati BB upper/lower?`,
  (i: XauusdIndicators) =>
    `BB width XAUUSD ${i.bbWidth?.toFixed(2)}% menunjukkan ${(i.bbWidth ?? 0) < 2 ? "squeeze (volatilitas rendah)" : "volatilitas normal/tinggi"}. Sebutkan setup breakout terbaik pasca BB squeeze di gold, termasuk volume dan indikator konfirmasi yang dibutuhkan.`,

  // ── Support / Resistance ───────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `XAUUSD: support ${i.supportLevel?.toFixed(2)}, resistance ${i.resistanceLevel?.toFixed(2)}, harga ${i.price}, ATR ${i.atr14?.toFixed(2)}. Hitung risk:reward untuk trade buy dari support menuju resistance. Berapa SL dan TP idealnya berdasarkan ATR?`,
  (i: XauusdIndicators) =>
    `Jarak harga XAUUSD ${i.price} ke resistance ${i.resistanceLevel?.toFixed(2)} adalah ${((i.resistanceLevel ?? i.price) - i.price).toFixed(2)}. Berapa pips yang masih "layak" untuk entry buy, dan kapan setup ini harus dibatalkan karena terlalu dekat dengan resistance?`,
  (i: XauusdIndicators) =>
    `Level support ${i.supportLevel?.toFixed(2)} di XAUUSD. RSI saat ini ${i.rsi14?.toFixed(1)}. Bagaimana cara mengidentifikasi support yang kuat vs support yang lemah? Apa perbedaan antara "test support" dan "breakdown support" dari sisi price action?`,

  // ── ATR & Volatility ───────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `ATR14 XAUUSD ${i.atr14?.toFixed(2)} (${((i.atr14 ?? 0) / i.price * 100).toFixed(3)}% dari harga). Jelaskan secara detail metode ATR-based position sizing: cara menghitung lot size untuk account 10K USD dengan risiko max 2% per trade di harga gold saat ini.`,
  (i: XauusdIndicators) =>
    `Dengan ATR XAUUSD ${i.atr14?.toFixed(2)}, di mana stoploss dan takeprofit ideal untuk: (1) scalping 15-30 menit, (2) swing trading 4-8 jam, (3) positional trade 1-3 hari? Berikan multiplier ATR yang optimal untuk setiap gaya trading.`,

  // ── Multi-timeframe ────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Strategi multi-timeframe untuk XAUUSD: H1 RSI=${i.rsi14?.toFixed(1)}, trend=${i.trend}. Jelaskan metode "Top-Down Analysis" — bagaimana menggunakan Daily timeframe untuk bias, H4 untuk setup, H1 untuk entry, dan 15M untuk timing presisi.`,
  (i: XauusdIndicators) =>
    `Saat trend H1 XAUUSD adalah ${i.trend} dengan EMA alignment ${i.emaAlignment}, bagaimana jika Daily trend berlawanan? Jelaskan cara mengelola konflik timeframe dan kapan sinyal Daily lebih kuat dari H1 untuk gold.`,

  // ── Pola Teknikal ─────────────────────────────────────────────────────────────
  () =>
    `Sebutkan 5 pola candlestick paling reliabel untuk XAUUSD dengan win rate >65%. Untuk setiap pola: kondisi market ideal, volume konfirmasi yang dibutuhkan, dan target minimum yang realistis.`,
  () =>
    `Jelaskan pola "Smart Money Concepts" (SMC) di XAUUSD: apa itu Order Block, Fair Value Gap (FVG), dan Change of Character (ChoCH)? Bagaimana retail trader bisa menggunakannya untuk entry timing yang lebih presisi?`,
  (i: XauusdIndicators) =>
    `Harga XAUUSD saat ini ${i.price} dengan BB middle ${i.bbMiddle?.toFixed(2)}. Jelaskan 3 setup "mean reversion" terbaik di gold — kapan bounce dari EMA atau BB middle paling reliable dan faktor apa yang menentukan strength bounce-nya?`,

  // ── Makro & Fundamental ────────────────────────────────────────────────────────
  () =>
    `Jelaskan mekanisme transmisi kebijakan Fed pada harga gold: dari keputusan FOMC → DXY → real yield → XAUUSD. Berapa basis poin pergerakan rata-rata XAUUSD setelah hawkish vs dovish surprise dari Fed?`,
  () =>
    `Bagaimana DXY mempengaruhi XAUUSD dalam berbagai skenario: (1) DXY naik saat inflasi tinggi, (2) DXY naik karena safe haven flow, (3) DXY turun saat resesi? Apakah korelasi DXY-gold selalu negatif atau ada pengecualian?`,
  () =>
    `Jelaskan pengaruh US Treasury 10-year yield terhadap gold. Mengapa "real yield" (nominal yield - inflasi) lebih penting dari nominal yield? Di level real yield berapa gold biasanya paling bullish/bearish?`,
  () =>
    `NFP (Non-Farm Payroll), CPI, dan FOMC — urutkan 3 event ekonomi ini berdasarkan dampak rata-rata terhadap XAUUSD. Jelaskan strategi trading news: kapan masuk sebelum rilis, saat rilis, atau setelah spike awal reda?`,

  // ── Session & Timing ───────────────────────────────────────────────────────────
  () =>
    `Volatilitas XAUUSD per sesi: Asian (06:00-14:00 WIB), London (15:00-21:00 WIB), New York (20:30-03:00 WIB). Berikan range pip rata-rata per sesi dan strategi terbaik untuk setiap sesi. Sesi overlap London-NY kapan tepatnya?`,
  () =>
    `Bagaimana pola pergerakan XAUUSD pada hari Senin vs Jumat? Apakah ada "Monday effect" atau "Friday effect" yang terukur? Hari apa dalam seminggu yang paling baik untuk open posisi baru di gold?`,

  // ── Psikologi & Risk ──────────────────────────────────────────────────────────
  () =>
    `5 kesalahan terbesar retail trader di XAUUSD: FOMO entry, revenge trading, overleverage, tidak pakai SL, dan averaging loss. Untuk setiap kesalahan, berikan solusi konkret berbasis rule trading yang bisa langsung diterapkan.`,
  () =>
    `Jelaskan konsep "risiko ruin" di trading gold dengan leverage. Jika modal $10.000 dengan risiko 5% per trade, berapa probabilitas kehilangan 50% modal setelah 20 trade berturut-turut yang kalah? Mengapa 1-2% risiko per trade sangat krusial?`,
  (i: XauusdIndicators) =>
    `XAUUSD dengan ATR ${i.atr14?.toFixed(2)} — bagaimana trailing stop yang optimal untuk trade swing: apakah menggunakan ATR trailing, EMA trailing (${i.ema21?.toFixed(2)}), atau persentase tetap? Jelaskan pro dan kontra setiap metode.`,

  // ── Pattern Recognition & Entry ───────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Kondisi saat ini: harga ${i.price}, RSI ${i.rsi14?.toFixed(1)}, MACD hist ${i.macdHistogram?.toFixed(3)}, BB width ${i.bbWidth?.toFixed(2)}%. Berdasarkan kombinasi ini, pola market apa yang paling mungkin terjadi dalam 2-4 jam ke depan? Jelaskan skenario bullish, bearish, dan sideways beserta probabilitasnya.`,
  (i: XauusdIndicators) =>
    `Jelaskan strategi "breakout retest" di XAUUSD: setelah resistance ${i.resistanceLevel?.toFixed(2)} ditembus, kapan dan bagaimana cara entry saat retest? Berapa konfirmasi yang dibutuhkan dan di mana stop loss ditempatkan?`,

  // ── Manajemen Posisi ──────────────────────────────────────────────────────────
  () =>
    `Apa strategi terbaik untuk "scale in" dan "scale out" di XAUUSD? Jelaskan pendekatan pyramiding yang aman — kapan menambah posisi yang profit, berapa ukuran lot tambahan, dan bagaimana mengelola SL keseluruhan?`,
  () =>
    `Dalam kondisi uncertainty tinggi di gold market (misal sebelum FOMC), apakah lebih baik: tutup semua posisi, kurangi ukuran lot 50%, atau pasang hedging? Jelaskan pro-kontra setiap pendekatan dan bagaimana memilihnya.`,

  // ── Korelasi Aset ──────────────────────────────────────────────────────────────
  () =>
    `Jelaskan korelasi antara XAUUSD dengan: (1) XAGUSD (silver), (2) oil (WTI), (3) S&P500, (4) Bitcoin. Kapan korelasi ini breakdown dan mengapa? Bagaimana trader gold menggunakan korelasi ini untuk konfirmasi bias?`,
  () =>
    `Bagaimana cara membaca COT (Commitment of Traders) report untuk gold futures? Apa posisi yang diperhatikan (non-commercial/speculative)? Di level positioning ekstrem berapa biasanya gold reversal terjadi?`,
] as const;

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

// ─── Macro vote helper ─────────────────────────────────────────────────────────

function computeMacroVote(corr: { dxy: { changePct?: number | null }; us10y: { changePct?: number | null } }): { direction: "up" | "down" | "sideways"; confidence: number } {
  const dxyChange = corr.dxy.changePct ?? 0;
  const yieldChange = corr.us10y.changePct ?? 0;
  // DXY up → bearish gold; DXY down → bullish gold
  // US10Y up → bearish gold; US10Y down → bullish gold
  let score = 0;
  if (dxyChange < -0.1) score += 1;
  else if (dxyChange > 0.1) score -= 1;
  if (yieldChange < -0.02) score += 0.5;
  else if (yieldChange > 0.02) score -= 0.5;
  const direction: "up" | "down" | "sideways" = score >= 0.8 ? "up" : score <= -0.8 ? "down" : "sideways";
  const confidence = Math.min(0.72, 0.38 + Math.abs(score) * 0.22);
  return { direction, confidence };
}

// ─── Feature 4: Trading Session Detector ──────────────────────────────────────
// Deteksi sesi trading berdasarkan waktu UTC

export function detectTradingSession(): "asia" | "london" | "new_york" | "overlap_london_ny" {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  // London-NY overlap: 13:00–16:00 UTC
  if (h >= 13 && h < 16) return "overlap_london_ny";
  // New York: 13:00–22:00 UTC
  if (h >= 13 && h < 22) return "new_york";
  // London: 07:00–16:00 UTC
  if (h >= 7 && h < 16) return "london";
  // Asia: 00:00–07:00 + 22:00–24:00 UTC
  return "asia";
}

// ─── Market Hours Detector ─────────────────────────────────────────────────────
// XAUUSD diperdagangkan 24/5 — buka Minggu 22:00 UTC, tutup Jumat 21:00 UTC.
// Jangan buat prediksi saat market tutup (Sabtu + Minggu pagi + Jumat malam).

export function isXauusdMarketOpen(): { open: boolean; reason: string; session: string | null } {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Minggu, 1=Sen, ..., 5=Jumat, 6=Sabtu
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const timeUTC = h + m / 60;

  // Sabtu: selalu tutup
  if (day === 6) {
    return { open: false, reason: "Market tutup (Sabtu)", session: null };
  }
  // Minggu sebelum 22:00 UTC: tutup
  if (day === 0 && timeUTC < 22) {
    const minsLeft = Math.round((22 - timeUTC) * 60);
    return { open: false, reason: `Market buka Minggu 22:00 UTC (${minsLeft} menit lagi)`, session: null };
  }
  // Jumat setelah 21:00 UTC: tutup
  if (day === 5 && timeUTC >= 21) {
    return { open: false, reason: "Market tutup (Jumat setelah 21:00 UTC)", session: null };
  }

  const session = detectTradingSession();
  return { open: true, reason: `Sesi ${session.replace(/_/g, " ").toUpperCase()} aktif`, session };
}

// ─── Feature 5: Market Regime Detector ───────────────────────────────────────
// Klasifikasikan kondisi pasar: Trending / Ranging / Volatile
// menggunakan ATR% dan EMA alignment

export function detectMarketRegime(
  indicators: XauusdIndicators
): "trending_up" | "trending_down" | "ranging" | "volatile" {
  const atr = indicators.atr14 ?? 0;
  const price = indicators.price;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;

  // Volatile: ATR > 0.75% dari harga — pasar bergejolak
  if (atrPct > 0.75) return "volatile";

  // Trending: EMA bullish/bearish stack + ATR moderat
  if (indicators.emaAlignment === "bullish_stack" && indicators.trend === "bullish")
    return "trending_up";
  if (indicators.emaAlignment === "bearish_stack" && indicators.trend === "bearish")
    return "trending_down";

  // Ranging: sinyal mixed, volatilitas rendah
  return "ranging";
}

// ─── Feature 9: Price Distribution P10/P50/P90 ────────────────────────────────
// Hitung estimasi distribusi harga (probabilistik) berdasarkan ATR dan confidence

function computePriceDistribution(
  price: number,
  direction: "up" | "down" | "sideways",
  confidence: number,
  atr: number
): { p10: number; p50: number; p90: number } {
  const a = atr > 0 ? atr : price * 0.003;
  const mult = 0.5 + confidence; // range: 0.5–1.5× ATR

  if (direction === "up") {
    return {
      p10: parseFloat((price + a * 0.2).toFixed(2)),          // minimal move
      p50: parseFloat((price + a * 1.2 * mult).toFixed(2)),   // median target
      p90: parseFloat((price + a * 2.5 * mult).toFixed(2)),   // optimistic
    };
  } else if (direction === "down") {
    return {
      p10: parseFloat((price - a * 2.5 * mult).toFixed(2)),   // optimistic downside
      p50: parseFloat((price - a * 1.2 * mult).toFixed(2)),   // median target
      p90: parseFloat((price - a * 0.2).toFixed(2)),          // minimal move
    };
  } else {
    return {
      p10: parseFloat((price - a * 0.6).toFixed(2)),
      p50: parseFloat(price.toFixed(2)),
      p90: parseFloat((price + a * 0.6).toFixed(2)),
    };
  }
}

// ─── Feature 7: Prediction Cluster Label ──────────────────────────────────────
// Label cluster kondisi pasar berdasarkan RSI + EMA + Trend + MACD

export function computeClusterLabel(indicators: XauusdIndicators): string {
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
  return `${rsiZone}+${emaZone}+${trendZone}+${macdZone}`;
}

// ─── Feature 1 (extended): Sentiment Vote ─────────────────────────────────────
// Agen ke-3 dari ensemble: menghitung arah berdasarkan sentimen berita

function computeSentimentVote(
  news: Array<{ sentiment: string | null }>
): { direction: "up" | "down" | "sideways"; confidence: number; label: string } {
  if (news.length === 0)
    return { direction: "sideways", confidence: 0.42, label: "sentiment" };

  let score = 0;
  for (const n of news) {
    if (n.sentiment === "bullish") score += 1;
    else if (n.sentiment === "bearish") score -= 1;
  }
  score /= news.length; // normalize −1..+1

  if (score > 0.25) {
    return {
      direction: "up",
      confidence: Math.min(0.70, 0.48 + Math.abs(score) * 0.25),
      label: "sentiment",
    };
  }
  if (score < -0.25) {
    return {
      direction: "down",
      confidence: Math.min(0.70, 0.48 + Math.abs(score) * 0.25),
      label: "sentiment",
    };
  }
  return { direction: "sideways", confidence: 0.42, label: "sentiment" };
}

// ─── Feature 8: Forget Curve — Exponential Decay on Brain Entries ─────────────
// Pattern lama kehilangan bobot secara eksponensial.
// Half-life ≈ 30 hari (lambda ≈ 0.023/day).

async function applyForgetCurve(): Promise<void> {
  const LAMBDA = 0.023; // daily decay rate
  const now = Date.now();

  const entries = await db
    .select({
      id: xauusdBrainTable.id,
      createdAt: xauusdBrainTable.createdAt,
      decayWeight: xauusdBrainTable.decayWeight,
    })
    .from(xauusdBrainTable)
    .where(eq(xauusdBrainTable.isActive, true));

  for (const entry of entries) {
    const ageDays = (now - new Date(entry.createdAt).getTime()) / 86_400_000;
    const newWeight = parseFloat(Math.exp(-LAMBDA * ageDays).toFixed(4));
    const currentWeight = entry.decayWeight ?? 1.0;
    // Only update if change is significant (>1%)
    if (Math.abs(newWeight - currentWeight) > 0.01) {
      await db
        .update(xauusdBrainTable)
        .set({ decayWeight: newWeight, updatedAt: new Date() })
        .where(eq(xauusdBrainTable.id, entry.id));
    }
  }
  console.log(`[XAUUSD Brain] Forget curve applied to ${entries.length} brain entries.`);
}

// ─── Brain retrieval — ambil insights relevan untuk disertakan di prompt prediksi ──
// Prioritas 1: entries dengan market tag yang cocok dengan kondisi saat ini
// Prioritas 2: entries dengan skor tertinggi (decayWeight × confidence)

async function retrieveRelevantBrainEntries(
  currentTags: string,
  session: string,
  regime: string,
  limit = 7
): Promise<string> {
  try {
    // Fetch top entries by weighted relevance score
    const entries = await db
      .select({
        category: xauusdBrainTable.category,
        title: xauusdBrainTable.title,
        content: xauusdBrainTable.content,
        confidence: xauusdBrainTable.confidence,
        decayWeight: xauusdBrainTable.decayWeight,
        marketConditionTags: xauusdBrainTable.marketConditionTags,
      })
      .from(xauusdBrainTable)
      .where(eq(xauusdBrainTable.isActive, true))
      .orderBy(desc(sql`${xauusdBrainTable.decayWeight} * ${xauusdBrainTable.confidence}`))
      .limit(50);

    if (entries.length === 0) return "";

    // Score each entry by tag overlap with current market state
    const tagSet = new Set(currentTags.split(",").filter(Boolean));
    const sessionTag = `session_${session}`;
    const regimeTag = `regime_${regime}`;

    const scored = entries.map((e) => {
      const entryTags = new Set((e.marketConditionTags ?? "").split(",").filter(Boolean));
      let overlap = 0;
      for (const t of tagSet) if (entryTags.has(t)) overlap++;
      // Bonus untuk session/regime yang cocok
      if (entryTags.has(sessionTag)) overlap += 2;
      if (entryTags.has(regimeTag)) overlap += 2;
      const score = (e.decayWeight ?? 1) * (e.confidence ?? 0.5) * (1 + overlap * 0.35);
      return { ...e, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    if (top.length === 0) return "";

    return `\n\n=== MEMORI AI (${top.length} insights relevan dari ${entries.length} yang dipelajari) ===\n` +
      top.map((e, i) => {
        const snippet = (e.content ?? "").slice(0, 220);
        const ellipsis = (e.content ?? "").length > 220 ? "..." : "";
        return `[${i + 1}] [${(e.category ?? "insight").toUpperCase()}] ${e.title}\n    ${snippet}${ellipsis}`;
      }).join("\n");
  } catch (err) {
    console.error("[XAUUSD Brain] Brain retrieval error:", err);
    return "";
  }
}

// ─── Prediction maker ──────────────────────────────────────────────────────────

async function makePrediction(indicators: XauusdIndicators): Promise<void> {
  // Jangan buat prediksi saat market XAUUSD tutup (weekend / Jumat malam)
  const marketStatus = isXauusdMarketOpen();
  if (!marketStatus.open) {
    console.log(`[XAUUSD Brain] Prediksi dilewati — ${marketStatus.reason}`);
    return;
  }

  const timeframeLabel = "H1"; // validasi berdasarkan SL/TP, bukan waktu

  // ── Hitung session/regime/cluster lebih awal (tidak perlu async) ──────────
  const tradingSession = detectTradingSession();
  const marketRegime = detectMarketRegime(indicators);
  const clusterLabel = computeClusterLabel(indicators);
  const currentTags = extractMarketTags(indicators);

  // Fetch semua context secara paralel termasuk brain retrieval + segmen win rate
  const [mtfResult, corrResult, winRateResult, newsResult, brainResult, segWinRateResult] = await Promise.allSettled([
    getMultiTimeframeAnalysis(),
    getCorrelationAnalysis(),
    // Win rate: last 50 verified predictions (overall)
    db.select({
      direction: xauusdPredictionsTable.direction,
      isCorrect: xauusdPredictionsTable.isCorrect,
    })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"))
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(50),
    // Recent news sentiment
    db.select({
      title: xauusdNewsTable.title,
      sentiment: xauusdNewsTable.sentiment,
      aiAnalysis: xauusdNewsTable.aiAnalysis,
    })
      .from(xauusdNewsTable)
      .orderBy(desc(xauusdNewsTable.publishedAt))
      .limit(4),
    // Brain retrieval — insights relevan dari memori AI (Prioritas 1)
    retrieveRelevantBrainEntries(currentTags, tradingSession, marketRegime),
    // Segment win rate — akurasi per sesi × regime (last 200 verified)
    db.select({
      direction: xauusdPredictionsTable.direction,
      isCorrect: xauusdPredictionsTable.isCorrect,
      tradingSession: xauusdPredictionsTable.tradingSession,
      marketRegime: xauusdPredictionsTable.marketRegime,
    })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"))
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(200),
  ]);

  let mtfContext = "";
  if (mtfResult.status === "fulfilled") {
    try {
      const mtf = mtfResult.value;
      const confluence = summarizeTimeframeConfluence(mtf);
      mtfContext = `\n\n=== ANALISIS MULTI-TIMEFRAME ===\n${mtf
        .map((t) => `${t.label}: trend=${t.indicators?.trend ?? "n/a"}, RSI=${t.indicators?.rsi14?.toFixed(1) ?? "n/a"}, EMA alignment=${t.indicators?.emaAlignment ?? "n/a"}`)
        .join("\n")}\nKesimpulan confluence: ${confluence.agreement} (${confluence.bullishCount} TF bullish, ${confluence.bearishCount} TF bearish)`;
    } catch (err) {
      console.error("[XAUUSD Brain] Multi-timeframe context error:", err);
    }
  }

  let correlationContext = "";
  if (corrResult.status === "fulfilled") {
    const corr = corrResult.value;
    const fmt = (v: number | null, suffix = "") =>
      v != null ? `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}` : "n/a";
    correlationContext =
      `\n\n=== KORELASI MAKRO (DXY, US10Y, VIX, Silver) ===` +
      `\nDXY: ${corr.dxy.price ?? "n/a"} (${fmt(corr.dxy.changePct, "%")}) — ${corr.dxy.interpretation}` +
      `\nUS 10Y Yield: ${corr.us10y.price ?? "n/a"}% (${fmt(corr.us10y.changePct, "%")}) — ${corr.us10y.interpretation}` +
      `\nVIX (Fear): ${corr.vix.price ?? "n/a"} (${fmt(corr.vix.changePct, "%")}) — ${corr.vix.interpretation}` +
      `\nSilver: ${corr.silver.price ?? "n/a"} (${fmt(corr.silver.changePct, "%")}) — ${corr.silver.interpretation}`;
  }

  let winRateContext = "";
  if (winRateResult.status === "fulfilled" && winRateResult.value.length > 0) {
    const preds = winRateResult.value;
    const correct = preds.filter((p) => p.isCorrect === true).length;
    const total = preds.length;
    const winRate = ((correct / total) * 100).toFixed(1);
    const byDir = { up: { c: 0, t: 0 }, down: { c: 0, t: 0 }, sideways: { c: 0, t: 0 } };
    for (const p of preds) {
      const d = p.direction as "up" | "down" | "sideways";
      if (byDir[d]) {
        byDir[d].t++;
        if (p.isCorrect) byDir[d].c++;
      }
    }
    winRateContext = `\n\n=== WIN RATE AI (${total} prediksi terakhir) ===\nOverall: ${winRate}% akurat (${correct}/${total})\nBUY: ${byDir.up.t > 0 ? ((byDir.up.c / byDir.up.t) * 100).toFixed(0) : "n/a"}% (${byDir.up.c}/${byDir.up.t}) | SELL: ${byDir.down.t > 0 ? ((byDir.down.c / byDir.down.t) * 100).toFixed(0) : "n/a"}% (${byDir.down.c}/${byDir.down.t}) | SIDEWAYS: ${byDir.sideways.t > 0 ? ((byDir.sideways.c / byDir.sideways.t) * 100).toFixed(0) : "n/a"}% (${byDir.sideways.c}/${byDir.sideways.t})\nGunakan data ini untuk kalibrasi confidence — jika win rate direction tertentu rendah, turunkan confidence.`;
  }

  let newsContext = "";
  if (newsResult.status === "fulfilled" && newsResult.value.length > 0) {
    const newsList = newsResult.value;
    newsContext = `\n\n=== SENTIMEN BERITA TERBARU (${newsList.length} berita) ===\n${newsList
      .map((n) => `• [${(n.sentiment ?? "neutral").toUpperCase()}] ${n.title}${n.aiAnalysis ? ` — ${n.aiAnalysis}` : ""}`)
      .join("\n")}`;
  }

  // ── Prioritas 1: Brain context — memori AI yang relevan ────────────────────
  const brainContext = brainResult.status === "fulfilled" ? brainResult.value : "";

  // ── Prioritas 3: Segment win rate — akurasi per kondisi pasar saat ini ─────
  let segmentWinRateContext = "";
  if (segWinRateResult.status === "fulfilled" && segWinRateResult.value.length >= 10) {
    const all = segWinRateResult.value;
    const sameSession = all.filter((p) => p.tradingSession === tradingSession);
    const sameRegime = all.filter((p) => p.marketRegime === marketRegime);
    const sameBoth = all.filter((p) => p.tradingSession === tradingSession && p.marketRegime === marketRegime);
    const calcWR = (arr: typeof all) => {
      if (arr.length < 5) return null;
      const correct = arr.filter((p) => p.isCorrect === true).length;
      return { wr: ((correct / arr.length) * 100).toFixed(0), n: arr.length };
    };
    const wrBoth = calcWR(sameBoth);
    const wrSession = calcWR(sameSession);
    const wrRegime = calcWR(sameRegime);
    const parts: string[] = [];
    if (wrBoth) parts.push(`Sesi ${tradingSession} + regime ${marketRegime}: ${wrBoth.wr}% akurat (${wrBoth.n} prediksi)`);
    else {
      if (wrSession) parts.push(`Sesi ${tradingSession}: ${wrSession.wr}% akurat (${wrSession.n} prediksi)`);
      if (wrRegime) parts.push(`Regime ${marketRegime}: ${wrRegime.wr}% akurat (${wrRegime.n} prediksi)`);
    }
    if (parts.length > 0) {
      segmentWinRateContext = `\n\n=== WIN RATE PER KONDISI PASAR SAAT INI ===\n${parts.join("\n")}\nJika win rate segmen <50%, WAJIB turunkan confidence 10-15%.`;
    }
  }

  // ── Sentiment vote dari berita (untuk ensemble + sessionRegimeContext) ─────
  const newsForSentiment = newsResult.status === "fulfilled" ? newsResult.value : [];
  const sentimentVote = computeSentimentVote(newsForSentiment);

  const sessionRegimeContext = `\n\n=== KONTEKS PASAR ===\nSesi Trading: ${tradingSession.toUpperCase()} | Market Regime: ${marketRegime.toUpperCase()} | Cluster: ${clusterLabel}\nSentimen Berita: ${sentimentVote.direction.toUpperCase()} (${(sentimentVote.confidence * 100).toFixed(0)}% confident)`;

  const systemPrompt = `Kamu adalah AI trading system untuk XAUUSD dengan kemampuan prediksi multi-faktor.
Buat prediksi arah harga berikutnya (validasi saat TP atau SL tercapai) berdasarkan:
1. Indikator teknikal 1H (RSI, EMA, MACD, BB, ATR)
2. Konfluens multi-timeframe (1H/4H/Harian)
3. Faktor makro (DXY, US 10Y Yield, VIX fear index, Silver korelasi)
4. Sentimen berita terbaru
5. Win rate historis (overall dan per segmen kondisi pasar)
6. Memori AI dari pembelajaran sebelumnya — WAJIB dipertimbangkan sebelum memutuskan

Aturan prediksi:
- Confidence >0.75 hanya jika minimal 4 faktor dari 6 align searah
- Confidence 0.55-0.75 jika 3 faktor align
- Confidence <0.55 jika sinyal mixed atau sideways
- Jika win rate segmen saat ini <50%, WAJIB turunkan confidence 10-15%
- Entry zone HARUS berdasarkan ATR (entryLow/entryHigh maks ±0.4×ATR dari harga sekarang)
- Stop Loss HARUS 1.5×ATR dari entry
- PERHATIKAN memori AI: jika ada pola mirip kondisi saat ini yang sebelumnya terbukti salah, sesuaikan prediksi

Jawab HANYA dalam format JSON:
{
  "direction": "up" | "down" | "sideways",
  "targetPrice": <harga target USD — setidaknya 2×ATR dari entry>,
  "entryLow": <batas bawah entry USD>,
  "entryHigh": <batas atas entry USD>,
  "stopLoss": <harga stop loss USD>,
  "confidence": <0.0-1.0 berdasarkan jumlah faktor yang align>,
  "reasoning": "<3-4 kalimat — sebutkan MTF, DXY/VIX/Silver, news, win rate segmen, dan insight dari memori AI>"
}`;

  const userMsg = `=== INDIKATOR 1H XAUUSD ===
Harga: ${indicators.price}
RSI14: ${indicators.rsi14} (${indicators.rsiSignal})
EMA9/21/50/200: ${indicators.ema9} / ${indicators.ema21} / ${indicators.ema50} / ${indicators.ema200}
MACD: line=${indicators.macdLine}, signal=${indicators.macdSignal}, hist=${indicators.macdHistogram} (${indicators.macdSignalType})
BB: upper=${indicators.bbUpper}, mid=${indicators.bbMiddle}, lower=${indicators.bbLower}, width=${indicators.bbWidth}%
ATR14: ${indicators.atr14}
Trend: ${indicators.trend} | EMA Alignment: ${indicators.emaAlignment}
Support: ${indicators.supportLevel} | Resistance: ${indicators.resistanceLevel}${mtfContext}${correlationContext}${winRateContext}${newsContext}${sessionRegimeContext}${segmentWinRateContext}${brainContext}

Buat prediksi arah berikutnya. Jawab JSON saja, tanpa teks lain.`;

  // Always compute the rule-based prediction first (real technical analysis
  // from ATR/support/resistance/EMA/RSI/MACD) — this is the source of truth
  // for entry range + stop loss when the AI is unavailable or unparseable,
  // and also used to sanity-check the AI's numbers.
  const ruleBased = computeRuleBasedPrediction(indicators);

  // (session/regime/cluster dan sentimentVote sudah dihitung lebih awal)

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
    // max 24 jam — validasi utama via SL/TP, ini hanya fallback kadaluarsa
    const verifyAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const direction = (pred.direction ?? ruleBased.direction) as "up" | "down" | "sideways";
    const targetPrice = pred.targetPrice ?? ruleBased.targetPrice;
    const entryLow = pred.entryLow ?? ruleBased.entryLow;
    const entryHigh = pred.entryHigh ?? ruleBased.entryHigh;
    const stopLoss = pred.stopLoss ?? ruleBased.stopLoss;
    const reasoning = aiPowered
      ? (pred.reasoning ?? ruleBased.reasoning)
      : `${ruleBased.reasoning} (AI tidak tersedia — dihitung dari analisis teknikal)`;

    // ── Ensemble Voting (Feature 1 — 4 agents: technical/macro/sentiment/AI) ──
    const techVote = { direction: ruleBased.direction, confidence: ruleBased.confidence, label: "technical" };
    const macroVote = corrResult.status === "fulfilled"
      ? { ...computeMacroVote(corrResult.value), label: "macro" }
      : { direction: "sideways" as const, confidence: 0.45, label: "macro" };
    const baseAiConf = Math.min(1, Math.max(0, pred.confidence ?? ruleBased.confidence));
    const aiVote = { direction, confidence: baseAiConf, label: aiPowered ? "ai" : "rule" };
    // Feature 1 (extended): sentimentVote = agen ke-3 (dari data berita, tanpa API call ekstra)
    const sentimentVoteForEnsemble = { ...sentimentVote, label: "sentiment" };

    // Majority vote dari 3 core agents (tech + macro + sentiment) → arah final
    const coreVotes = [techVote.direction, macroVote.direction, sentimentVote.direction];
    const upVotes = coreVotes.filter(d => d === "up").length;
    const downVotes = coreVotes.filter(d => d === "down").length;
    const sideVotes = coreVotes.filter(d => d === "sideways").length;
    const majorityDir = upVotes >= 2 ? "up" : downVotes >= 2 ? "down" : sideVotes >= 2 ? "sideways" : null;
    // Gunakan majority jika jelas (≥2/3); jika tie → AI jadi tiebreaker
    const finalDirection = (majorityDir ?? direction) as "up" | "down" | "sideways";

    const allDirs = [techVote.direction, macroVote.direction, sentimentVote.direction, aiVote.direction];
    const agreementCount = Math.max(
      allDirs.filter(d => d === "up").length,
      allDirs.filter(d => d === "down").length,
      allDirs.filter(d => d === "sideways").length
    );
    // +8% semua setuju, +4% tiga setuju, -6% penuh split
    const agreementBonus = agreementCount === 4 ? 0.08 : agreementCount === 3 ? 0.04 : agreementCount === 1 ? -0.06 : 0;
    const confidence = Math.min(1, Math.max(0, baseAiConf + agreementBonus));

    // Feature 9: Price Distribution P10/P50/P90 berdasarkan ATR + confidence
    const distribution = computePriceDistribution(
      indicators.price,
      finalDirection,
      confidence,
      indicators.atr14 ?? indicators.price * 0.003
    );

    const ensembleVotes = {
      technical: techVote,
      macro: macroVote,
      sentiment: sentimentVoteForEnsemble,
      ai: aiVote,
      agreementCount,
      agreementBonus: parseFloat(agreementBonus.toFixed(3)),
      finalDirection,
      session: tradingSession,
      regime: marketRegime,
      cluster: clusterLabel,
    };
    // ─────────────────────────────────────────────────────────────────────────

    await db.insert(xauusdPredictionsTable).values({
      timeframe: timeframeLabel,
      direction: finalDirection,
      targetPrice,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      indicatorsAtPrediction: { ...(indicators as unknown as Record<string, unknown>), ensembleVotes },
      // Feature 4: Session-Aware
      tradingSession,
      // Feature 5: Market Regime Detector
      marketRegime,
      // Feature 7: Prediction Clustering
      clusterLabel,
      // Feature 9: Price Distribution
      priceP10: distribution.p10,
      priceP50: distribution.p50,
      priceP90: distribution.p90,
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

  // Ambil SEMUA prediksi pending — validasi lewat SL/TP, bukan waktu
  const pending = await db
    .select()
    .from(xauusdPredictionsTable)
    .where(eq(xauusdPredictionsTable.status, "pending"))
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

    // ── Validasi berdasarkan SL/TP (price-level) ──────────────────────────────
    if (pred.direction === "up") {
      if (tp != null && currentPrice >= tp) {
        resolved = true; isCorrect = true;
        resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≥ $${tp.toFixed(2)})`;
      } else if (sl != null && currentPrice <= sl) {
        resolved = true; isCorrect = false;
        resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≤ $${sl.toFixed(2)})`;
      }
    } else if (pred.direction === "down") {
      if (tp != null && currentPrice <= tp) {
        resolved = true; isCorrect = true;
        resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≤ $${tp.toFixed(2)})`;
      } else if (sl != null && currentPrice >= sl) {
        resolved = true; isCorrect = false;
        resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≥ $${sl.toFixed(2)})`;
      }
    } else {
      // sideways: SL/TP biasanya tidak tajam — anggap selesai jika harga sudah jauh (>0.5%)
      if (Math.abs(pricePct) > 0.005) {
        resolved = true; isCorrect = false;
        resolveReason = `Harga bergerak terlalu jauh dari sideways (${(pricePct * 100).toFixed(2)}%)`;
      }
    }

    // ── Fallback waktu: max 24 jam jika SL/TP belum kena ─────────────────────
    if (!resolved && pred.verifyAt && now > new Date(pred.verifyAt)) {
      resolved = true;
      resolveReason = "Kadaluarsa 24 jam tanpa hit SL/TP";
    }

    // SL/TP belum kena, prediksi masih terbuka — lewati
    if (!resolved) continue;

    const actualDirection =
      pricePct > 0.002 ? "up" : pricePct < -0.002 ? "down" : "sideways";
    if (isCorrect === null) isCorrect = actualDirection === pred.direction;

    checkedCount++;
    if (!isCorrect) wrongCount++;

    console.log(`[XAUUSD Brain] Prediksi #${pred.id} ${pred.direction.toUpperCase()} → ${isCorrect ? "✅ BENAR" : "❌ SALAH"} | ${resolveReason}`);

    if (!isCorrect) {
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
            marketConditionTags: [
              `dir_${pred.direction}`,
              pred.tradingSession ? `session_${pred.tradingSession}` : null,
              pred.marketRegime ? `regime_${pred.marketRegime}` : null,
            ].filter(Boolean).join(","),
          });
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Self-critique error:", err);
      }

      // ── Prioritas 2: Reinforcement negatif — lemahkan entries dengan arah yang salah ──
      // Prediksi SALAH → turunkan decayWeight entries yang menandai arah yang salah (floor 0.1)
      try {
        const wrongDirTag = `dir_${pred.direction}`; // arah yang salah
        await db.update(xauusdBrainTable)
          .set({
            decayWeight: sql`GREATEST(0.1, ${xauusdBrainTable.decayWeight} * 0.88)`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(xauusdBrainTable.isActive, true),
              sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + wrongDirTag + "%"}`
            )
          );
      } catch (err) {
        console.error("[XAUUSD Brain] Negative reinforcement error:", err);
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
      // ── Feature 1: Success Pattern Memory ─────────────────────────────────
      // Save indicator snapshot as a 'pattern' brain entry when prediction is CORRECT
      if (pred.indicatorsAtPrediction) {
        try {
          const ind = pred.indicatorsAtPrediction as Record<string, unknown>;
          const tags = [
            ind.emaAlignment === "bullish_stack" ? "ema_bullish"
              : ind.emaAlignment === "bearish_stack" ? "ema_bearish" : "ema_mixed",
            ind.rsiSignal ? `rsi_${ind.rsiSignal}` : null,
            ind.macdSignalType && ind.macdSignalType !== "neutral"
              ? `macd_${String(ind.macdSignalType)}` : null,
            `dir_${pred.direction}`,
            `trend_${ind.trend ?? "unknown"}`,
            // Tag session + regime agar brain retrieval bonus aktif
            pred.tradingSession ? `session_${pred.tradingSession}` : null,
            pred.marketRegime ? `regime_${pred.marketRegime}` : null,
          ].filter(Boolean).join(",");

          const rsiVal = typeof ind.rsi14 === "number" ? ind.rsi14.toFixed(1) : "-";
          const pnlStr = `${(pricePct * 100).toFixed(3)}%`;

          await db.insert(xauusdBrainTable).values({
            category: "pattern",
            title: `✅ Pola Sukses: ${pred.direction.toUpperCase()} benar di $${pred.priceAtPrediction.toFixed(2)}`,
            content: `Prediksi ${pred.direction.toUpperCase()} BENAR (${pnlStr}). ` +
              `Kondisi saat prediksi — EMA: ${String(ind.emaAlignment ?? "-")}, ` +
              `RSI: ${rsiVal} (${String(ind.rsiSignal ?? "-")}), ` +
              `MACD: ${String(ind.macdSignalType ?? "-")}, ` +
              `Trend: ${String(ind.trend ?? "-")}. ` +
              `Entry $${pred.priceAtPrediction.toFixed(2)} → Actual $${currentPrice.toFixed(2)}. ` +
              `Confidence: ${(pred.confidence * 100).toFixed(0)}%.`,
            confidence: Math.min(0.92, 0.65 + pred.confidence * 0.3),
            sourceQuestion: `SuccessPattern:${pred.direction}:${pred.priceAtPrediction}`,
            marketConditionTags: tags,
          });
        } catch (err) {
          console.error("[XAUUSD Brain] Success pattern save error:", err);
        }
      }

      // ── Prioritas 2: Reinforcement positif — kuatkan brain entries yang relevan ──
      // Prediksi BENAR → naikkan decayWeight entries dengan tag yang cocok (max 1.0)
      try {
        const ind = (pred.indicatorsAtPrediction ?? {}) as Record<string, unknown>;
        const matchTags = [
          ind.emaAlignment === "bullish_stack" ? "ema_bullish"
            : ind.emaAlignment === "bearish_stack" ? "ema_bearish" : "ema_mixed",
          `dir_${pred.direction}`,
          `trend_${String(ind.trend ?? "unknown")}`,
        ].filter(Boolean);
        for (const tag of matchTags) {
          await db.update(xauusdBrainTable)
            .set({
              decayWeight: sql`LEAST(1.0, ${xauusdBrainTable.decayWeight} * 1.12)`,
              usageCount: sql`${xauusdBrainTable.usageCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(xauusdBrainTable.isActive, true),
                sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + tag + "%"}`
              )
            );
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Positive reinforcement error:", err);
      }

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

  return { checked: checkedCount, wrong: wrongCount };
}

// ─── Feature 3: Adaptive Question Generator ────────────────────────────────────
// After 50+ verified predictions, analyze failure conditions and generate
// targeted questions about the indicator combos where AI is weakest.

async function generateAdaptiveQuestion(
  indicators: XauusdIndicators
): Promise<{ question: string; hash: string } | null> {
  try {
    // Get last 100 verified predictions with indicator data
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const verified = await db
      .select({
        direction: xauusdPredictionsTable.direction,
        isCorrect: xauusdPredictionsTable.isCorrect,
        indicatorsAtPrediction: xauusdPredictionsTable.indicatorsAtPrediction,
      })
      .from(xauusdPredictionsTable)
      .where(
        and(
          eq(xauusdPredictionsTable.status, "verified"),
          gte(xauusdPredictionsTable.predictedAt, cutoff)
        )
      )
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(100);

    if (verified.length < 50) return null; // not enough data yet

    // Group by (emaAlignment, rsiSignal, macdSignalType) and find worst combo
    const groups: Record<string, { total: number; wrong: number }> = {};
    for (const p of verified) {
      const ind = (p.indicatorsAtPrediction ?? {}) as Record<string, unknown>;
      const key = `${ind.emaAlignment ?? "?"}|${ind.rsiSignal ?? "?"}|${ind.macdSignalType ?? "?"}`;
      if (!groups[key]) groups[key] = { total: 0, wrong: 0 };
      groups[key].total++;
      if (!p.isCorrect) groups[key].wrong++;
    }

    // Find the combo with highest wrong rate (min 3 samples)
    let worstKey = "";
    let worstRate = 0;
    for (const [key, stats] of Object.entries(groups)) {
      if (stats.total >= 3) {
        const rate = stats.wrong / stats.total;
        if (rate > worstRate) { worstRate = rate; worstKey = key; }
      }
    }

    if (!worstKey || worstRate < 0.4) return null; // only generate if >40% failure rate

    const [ema, rsi, macd] = worstKey.split("|");
    const question = `ANALISIS KRITIS untuk XAUUSD: Dalam kondisi EMA alignment "${ema}", RSI signal "${rsi}", dan MACD "${macd}", ` +
      `AI sering membuat prediksi yang SALAH (tingkat kegagalan >40%). ` +
      `Harga saat ini $${indicators.price.toFixed(2)}, RSI ${indicators.rsi14?.toFixed(1)}. ` +
      `Jelaskan mengapa kombinasi indikator ini sering menyesatkan, kondisi tersembunyi apa yang harus dicek lebih dulu, ` +
      `dan strategi konkret untuk meningkatkan akurasi dalam kondisi seperti ini.`;

    return { question, hash: generateQuestionHash(question) };
  } catch {
    return null;
  }
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

    // 3.5 Save macro snapshot (DXY/US10Y) every 3 cycles — feeds Pearson correlation
    if (totalCycles % 3 === 0) {
      try {
        const corr = await getCorrelationAnalysis();
        if (corr.dxy.price != null || corr.us10y.price != null) {
          await db.insert(xauusdMacroSnapshotsTable).values({
            goldPrice: corr.gold.price ?? indicators.price,
            goldChangePct: corr.gold.changePct,
            dxy: corr.dxy.price,
            dxyChangePct: corr.dxy.changePct,
            us10y: corr.us10y.price,
            us10yChangePct: corr.us10y.changePct,
          });
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Macro snapshot error:", err);
      }
    }

    // 4. Generate & ask unique questions (5 per cycle, 8 on spike)
    const questionCount = spikeDetected ? 8 : 5;
    const candidates = getRandomQuestions(indicators, questionCount + 6); // extras for filtering
    const newQuestions = await filterNewQuestions(candidates);
    const toAsk = newQuestions.slice(0, questionCount);

    // ── Feature 3: Adaptive Question Generator ─────────────────────────────
    // Every 3rd cycle, inject a targeted failure-analysis question if 50+ verified preds
    if (totalCycles % 3 === 0) {
      try {
        const adaptiveQ = await generateAdaptiveQuestion(indicators);
        if (adaptiveQ) {
          const isNew = await filterNewQuestions([adaptiveQ]);
          if (isNew.length > 0 && !toAsk.some(q => q.hash === adaptiveQ.hash)) {
            toAsk.unshift(adaptiveQ);
          }
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Adaptive question error:", err);
      }
    }

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

    // Feature 8: Forget Curve — decay lama brain entries setiap 12 siklus
    if (totalCycles % 12 === 0) {
      void applyForgetCurve().catch(err =>
        console.error("[XAUUSD Brain] Forget curve error:", err)
      );
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

    // Sync semua data ke file SQLite setiap siklus (non-blocking, tidak ganggu engine)
    syncToFile().catch(err =>
      console.error("[XAUUSD Brain] Brain backup sync error:", err)
    );

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

  console.log("[XAUUSD Brain] Engine started. Learning cycle every 5 minutes.");

  // Auto-restore dari backup SQLite jika PostgreSQL kosong (non-blocking)
  autoRestoreIfEmpty().catch(err =>
    console.error("[XAUUSD Brain] Auto-restore error:", err)
  );

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
