/**
 * BTCUSD Autonomous Learning Brain Engine
 * BTC is 24/7 — engine runs continuously without market-hour checks.
 * When XAUUSD market is open → both engines run.
 * When XAUUSD market is closed → only this BTC engine runs.
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
import { eq, desc, sql, lt } from "drizzle-orm";
import { fetchBtcusdIndicators, fetchBtcusdLivePrice, type BtcusdIndicators } from "./btcusd-data.js";
import { getDeepseekApiKey } from "./xauusd-settings.js";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_TIMEOUT_MS = 120_000;
const LEARN_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const SPIKE_THRESHOLD = 0.01; // 1% — BTC is more volatile than gold
const QUALITY_THRESHOLD = 0.65;

// ─── Engine state ──────────────────────────────────────────────────────────────
let learningTimer: ReturnType<typeof setInterval> | null = null;
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
async function queryDeepSeek(systemPrompt: string, userMessage: string, maxTokens = 800): Promise<string> {
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
        model: "deepseek-reasoner",
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string; reasoning_content?: string } }> };
    return json.choices[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Hashing ───────────────────────────────────────────────────────────────────
function hashQuestion(q: string): string {
  return crypto.createHash("sha256").update(q.trim().toLowerCase()).digest("hex");
}

// ─── Score answer quality (0.0–1.0) ───────────────────────────────────────────
function scoreAnswer(question: string, answer: string): number {
  let score = 0.5;
  if (answer.length > 300) score += 0.1;
  if (answer.length > 600) score += 0.1;
  const hasNumbers = /\d+\.?\d*%?/.test(answer);
  if (hasNumbers) score += 0.1;
  const actionWords = ["entry", "stop", "target", "support", "resistance", "buy", "sell", "beli", "jual", "level", "harga", "strategi", "risiko"];
  const hits = actionWords.filter(w => answer.toLowerCase().includes(w)).length;
  score += Math.min(hits * 0.02, 0.1);
  if (answer.includes("?") && answer.split("?").length > 2) score -= 0.05;
  if (answer.length < 100) score = Math.min(score, 0.4);
  return Math.min(Math.max(score, 0), 1);
}

// ─── Extract brain category ────────────────────────────────────────────────────
function extractCategory(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("rsi") || q.includes("macd") || q.includes("ema") || q.includes("bollinger")) return "teknikal";
  if (q.includes("halving") || q.includes("blockchain") || q.includes("on-chain") || q.includes("hash rate")) return "onchain";
  if (q.includes("makro") || q.includes("federal") || q.includes("inflasi") || q.includes("dolar") || q.includes("nasdaq")) return "makro";
  if (q.includes("psikologi") || q.includes("fear") || q.includes("greed") || q.includes("sentiment")) return "psikologi";
  if (q.includes("stoploss") || q.includes("risk") || q.includes("position") || q.includes("lot")) return "manajemen_risiko";
  if (q.includes("defi") || q.includes("altcoin") || q.includes("eth") || q.includes("dominance")) return "crypto_ekosistem";
  return "umum";
}

function extractTitle(question: string, answer: string): string {
  const firstSentence = answer.split(/[.!?\n]/)[0]?.trim() ?? "";
  return firstSentence.length > 10 && firstSentence.length < 120
    ? firstSentence
    : question.slice(0, 100);
}

function extractTags(i: BtcusdIndicators): string {
  const tags: string[] = [];
  if (i.rsiSignal === "overbought") tags.push("rsi_overbought");
  if (i.rsiSignal === "oversold") tags.push("rsi_oversold");
  if (i.trend === "bullish") tags.push("trend_bullish");
  if (i.trend === "bearish") tags.push("trend_bearish");
  if (i.macdSignalType !== "neutral") tags.push(`macd_${i.macdSignalType}`);
  if (i.emaAlignment !== "mixed") tags.push(`ema_${i.emaAlignment}`);
  return tags.join(",");
}

// ─── Generate questions via DeepSeek ──────────────────────────────────────────
async function generateQuestionsWithDeepSeek(
  indicators: BtcusdIndicators,
  count: number,
  spikeDetected: boolean,
  sessionCache: Set<string>
): Promise<Array<{ question: string; hash: string }>> {
  const ctx = [
    `Harga BTC/USD  : $${indicators.price.toLocaleString()}`,
    `RSI14          : ${indicators.rsi14?.toFixed(1) ?? "N/A"} (${indicators.rsiSignal})`,
    `Trend          : ${indicators.trend}`,
    `EMA Alignment  : ${indicators.emaAlignment}`,
    `EMA9/21/50/200 : ${indicators.ema9?.toFixed(0) ?? "N/A"} / ${indicators.ema21?.toFixed(0) ?? "N/A"} / ${indicators.ema50?.toFixed(0) ?? "N/A"} / ${indicators.ema200?.toFixed(0) ?? "N/A"}`,
    `MACD           : ${indicators.macdSignalType} (hist ${indicators.macdHistogram?.toFixed(0) ?? "N/A"})`,
    `ATR14          : $${indicators.atr14?.toFixed(0) ?? "N/A"}`,
    `BB Width       : ${indicators.bbWidth?.toFixed(2) ?? "N/A"}%`,
    `Support        : $${indicators.supportLevel?.toFixed(0) ?? "N/A"}`,
    `Resistance     : $${indicators.resistanceLevel?.toFixed(0) ?? "N/A"}`,
    spikeDetected ? "⚡ SPIKE TERDETEKSI: BTC bergerak cepat >1%" : null,
  ].filter(Boolean).join("\n");

  const prompt = `Kondisi pasar BTC/USD saat ini:\n${ctx}\n\n` +
    `Buat ${count} pertanyaan studi trading BITCOIN yang SPESIFIK, UNIK, dan BERVARIASI topiknya. ` +
    `Topik harus mencakup: analisis teknikal, halving cycle, on-chain metrics, korelasi DXY/Nasdaq/emas, ` +
    `manajemen risiko crypto, psikologi trading, DeFi & altcoin dominance, institutional adoption, dll. ` +
    `Format: satu pertanyaan per baris, awali dengan nomor (1. 2. 3. dst). ` +
    `Gunakan Bahasa Indonesia. Sertakan angka spesifik dari data di atas.`;

  const raw = await queryDeepSeek(
    "Kamu adalah expert trader dan analis Bitcoin/Crypto dengan pengalaman 10 tahun. Tugasmu merancang kurikulum belajar trading BTC yang mendalam dan actionable.",
    prompt,
    600
  );

  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
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
    supportLevel: r.supportLevel ?? null, resistanceLevel: r.resistanceLevel ?? null,
  };
}

// ─── Core learning cycle ───────────────────────────────────────────────────────
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
      const [last] = await db.select({ price: btcusdSnapshotsTable.price })
        .from(btcusdSnapshotsTable).orderBy(desc(btcusdSnapshotsTable.snapshotAt)).limit(1);
      if (last) spikeDetected = Math.abs((indicators.price - last.price) / last.price) >= SPIKE_THRESHOLD;
    } catch { /* non-fatal */ }

    // 3. Save snapshot
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

    // 4. Generate & ask questions (3 per normal cycle)
    const SYS = `Kamu adalah expert trader Bitcoin dengan pengalaman 10 tahun. Berikan jawaban SANGAT SPESIFIK dengan angka konkret, strategi actionable. Bahasa Indonesia.`;
    const sessionCache = new Set<string>();
    const questions = await generateQuestionsWithDeepSeek(indicators, 5, spikeDetected, sessionCache).catch(() => []);

    for (const { question, hash } of questions.slice(0, 3)) {
      try {
        sessionCache.add(hash);
        const inserted = await db.insert(btcusdQuestionsLogTable).values({
          question, questionHash: hash, marketContext: indicators as unknown as Record<string, unknown>,
        }).onConflictDoNothing().returning({ id: btcusdQuestionsLogTable.id });
        if (!inserted.length) continue;

        const answer = await queryDeepSeek(SYS, question, 800);
        const quality = scoreAnswer(question, answer);
        await db.update(btcusdQuestionsLogTable)
          .set({ answer, quality, answeredAt: new Date(), savedToBrain: quality >= QUALITY_THRESHOLD })
          .where(eq(btcusdQuestionsLogTable.id, inserted[0].id));
        questionsAsked++;

        if (quality >= QUALITY_THRESHOLD && answer.length > 100) {
          await db.insert(btcusdBrainTable).values({
            category: extractCategory(question), title: extractTitle(question, answer),
            content: answer, confidence: quality, sourceQuestion: question,
            marketConditionTags: extractTags(indicators),
          });
          insightsSaved++;
          totalInsights++;
        }
      } catch { /* non-fatal, skip question */ }
    }

    // 5. Make prediction
    try {
      const brainRows = await db.select({ content: btcusdBrainTable.content })
        .from(btcusdBrainTable)
        .where(eq(btcusdBrainTable.isActive, true))
        .orderBy(desc(btcusdBrainTable.confidence))
        .limit(5);
      const brainContext = brainRows.map(r => r.content.slice(0, 200)).join("\n---\n");
      const predPrompt = `Harga BTC $${indicators.price} | RSI ${indicators.rsi14?.toFixed(1)} | Trend ${indicators.trend} | EMA ${indicators.emaAlignment} | MACD ${indicators.macdSignalType}\n\nKonteks otak AI:\n${brainContext}\n\nBuat prediksi BTC untuk 4 jam ke depan. Format:\nDIRECTION: up/down/sideways\nTARGET: harga target\nSTOP_LOSS: harga SL\nCONFIDENCE: 0.0-1.0\nREASONING: alasan singkat 2-3 kalimat`;
      const predRaw = await queryDeepSeek("Kamu adalah AI predictor BTC/USD.", predPrompt, 400);
      const dir = predRaw.match(/DIRECTION:\s*(up|down|sideways)/i)?.[1]?.toLowerCase() as "up" | "down" | "sideways" | undefined;
      const target = parseFloat(predRaw.match(/TARGET:\s*\$?([\d,]+)/)?.[1]?.replace(",", "") ?? "0");
      const sl = parseFloat(predRaw.match(/STOP_LOSS:\s*\$?([\d,]+)/)?.[1]?.replace(",", "") ?? "0");
      const conf = parseFloat(predRaw.match(/CONFIDENCE:\s*([\d.]+)/)?.[1] ?? "0.5");
      const reasoning = predRaw.match(/REASONING:\s*(.+)/s)?.[1]?.trim() ?? predRaw.slice(0, 200);
      if (dir && target > 0) {
        await db.insert(btcusdPredictionsTable).values({
          timeframe: "4h", direction: dir, targetPrice: target, stopLoss: sl > 0 ? sl : null,
          confidence: Math.min(Math.max(conf, 0), 1), reasoning, priceAtPrediction: indicators.price,
          indicatorsAtPrediction: indicators as unknown as Record<string, unknown>,
          verifyAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
        });
      }
    } catch { /* prediction non-fatal */ }

    // 6. Verify old predictions
    try {
      const pending = await db.select().from(btcusdPredictionsTable)
        .where(sql`${btcusdPredictionsTable.status} = 'pending' AND ${btcusdPredictionsTable.verifyAt} <= NOW()`)
        .limit(3);
      for (const pred of pending) {
        const actualDir = indicators.price > pred.priceAtPrediction ? "up" : indicators.price < pred.priceAtPrediction ? "down" : "sideways";
        const isCorrect = actualDir === pred.direction;
        await db.update(btcusdPredictionsTable)
          .set({ actualPrice: indicators.price, actualDirection: actualDir, isCorrect, priceDiff: indicators.price - pred.priceAtPrediction, status: "verified" })
          .where(eq(btcusdPredictionsTable.id, pred.id));
      }
    } catch { /* non-fatal */ }

    // 7. Forget curve (decay old brain entries weekly)
    if (totalCycles % 50 === 0) {
      try {
        await db.update(btcusdBrainTable).set({
          decayWeight: sql`${btcusdBrainTable.decayWeight} * 0.95`,
          isActive: sql`${btcusdBrainTable.decayWeight} * 0.95 > 0.1`,
        }).where(lt(btcusdBrainTable.decayWeight, 0.5));
      } catch { /* non-fatal */ }
    }

    totalCycles++;
    lastCycleAt = new Date();
    console.log(`[BTC Brain] Cycle #${totalCycles}: price=$${indicators.price}, q=${questionsAsked}, ins=${insightsSaved} (${Date.now() - cycleStart}ms)`);

    await db.insert(btcusdLearningLogTable).values({
      priceAtCycle: indicators.price, questionsAsked, insightsSaved,
      spikeDetected, summary: `Siklus #${totalCycles}: +${insightsSaved} insights`,
      durationMs: Date.now() - cycleStart,
    }).catch(() => {});

  } finally {
    isLearning = false;
  }
}

// ─── Extreme mode ──────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
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

    const spikeDetected = false;
    const remaining = target - extremeProgress;
    const count = Math.min(qpc, remaining);
    let toAsk: Array<{ question: string; hash: string }> = [];

    try {
      toAsk = (await generateQuestionsWithDeepSeek(indicators, count + 3, spikeDetected, extremeHashCache!)).slice(0, count);
      if (toAsk.length) console.log(`[BTC Extreme] 🤖 DeepSeek generate ${toAsk.length} pertanyaan`);
    } catch (e) { console.warn("[BTC Extreme] Generate gagal:", String(e)); }

    if (!toAsk.length) { if (await sleepOrAbort(30_000)) break; extremeCycleCount++; continue; }

    for (const { question, hash } of toAsk) {
      if (extremeAbort || extremeProgress >= target) break;
      try {
        extremeHashCache!.add(hash);
        const inserted = await db.insert(btcusdQuestionsLogTable)
          .values({ question, questionHash: hash, marketContext: indicators as unknown as Record<string, unknown> })
          .onConflictDoNothing().returning({ id: btcusdQuestionsLogTable.id });
        if (!inserted.length) { console.log("[BTC Extreme] ⏭ Skip duplikat"); continue; }

        const answer = await queryDeepSeek(SYS, question, 1_000);
        const quality = scoreAnswer(question, answer);
        await db.update(btcusdQuestionsLogTable)
          .set({ answer, quality, answeredAt: new Date(), savedToBrain: quality >= QUALITY_THRESHOLD })
          .where(eq(btcusdQuestionsLogTable.id, inserted[0].id));

        if (quality >= QUALITY_THRESHOLD && answer.length > 100) {
          await db.insert(btcusdBrainTable).values({
            category: extractCategory(question), title: extractTitle(question, answer),
            content: answer, confidence: quality, sourceQuestion: question,
            marketConditionTags: extractTags(indicators),
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
          console.log(`[BTC Extreme] 📊 ${extremeProgress}/${target} (${Math.round(extremeProgress/target*100)}%) — Insights: ${extremeInsightsTotal}`);
        }
        if (extremeProgress >= target || extremeAbort) break;

        const pause = 15_000 + Math.random() * 15_000;
        console.log(`[BTC Extreme] ⏱ Jeda ${(pause/1000).toFixed(0)}s → ke-${extremeProgress+1}/${target}`);
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
    // BTC is always "open" (24/7)
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

// ─── Engine start/stop ─────────────────────────────────────────────────────────
export function startBtcBrainEngine(): void {
  if (learningTimer) return;
  console.log("[BTC Brain] Engine started. Learning cycle every 5 minutes.");
  learningTimer = setInterval(() => { runBtcLearningCycle().catch(console.error); }, LEARN_INTERVAL_MS);
  // Run once immediately
  runBtcLearningCycle().catch(console.error);
}

export function stopBtcBrainEngine(): void {
  if (learningTimer) { clearInterval(learningTimer); learningTimer = null; }
  console.log("[BTC Brain] Engine stopped.");
}
