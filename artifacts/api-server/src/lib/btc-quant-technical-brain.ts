/**
 * BTC Quant Bot — Technical Brain
 * Spesialisasi: price action, RSI, EMA stack, BB squeeze, Volume spike,
 * Funding Rate, dan candlestick patterns khusus BTC.
 *
 * Karakteristik BTC scalping:
 * - Cycle 2 menit (lebih cepat dari XAUUSD karena volatilitas BTC tinggi)
 * - Fokus pada momentum jangka pendek, bukan swing
 * - Funding rate positif/negatif ekstrem = sinyal reversal scalping
 */

import { db } from "@workspace/db";
import { btcQuantTechnicalBrainTable, btcQuantLearningLogTable } from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchBtcusdIndicators, fetchBtcFundingRate } from "./btcusd-data.js";
import {
  generateBtcBrainPrediction,
  verifyBtcBrainPredictions,
} from "./btc-quant-brain-predictions.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BtcTechnicalSignal {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "up" | "down" | "neutral";
  confidence: number;
  reasoning: string[];
  keySetup: string;
  updatedAt: Date;
  cycleCount: number;
  totalInsights: number;
}

// ─── State ────────────────────────────────────────────────────────────────────
let cycleCount = 0;
let isRunning = false;
let lastSignal: BtcTechnicalSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 2 * 60 * 1000; // 2 menit — scalping butuh update cepat

// ─── DeepSeek caller ──────────────────────────────────────────────────────────
async function askDeepSeek(system: string, user: string, timeoutMs = 30000): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) return "[DeepSeek API key belum diset]";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "[no response]";
  } catch { return "[timeout atau error]"; }
  finally { clearTimeout(timer); }
}

const SYSTEM_PROMPT = `Kamu adalah Technical Brain untuk scalping BTCUSD.
Karakteristik BTC yang harus kamu pahami:
- BTC bergerak 2-5% dalam hitungan menit — scalping butuh timing presisi
- Funding rate positif ekstrem (>0.05%) = pasar overleveraged long → risiko short squeeze TAPI juga potensi dump
- BB squeeze pada BTC biasanya diikuti breakout 3-8% dalam 15-30 menit
- Volume spike 2x rata-rata = konfirmasi momentum kuat
- EMA9 crossing EMA21 = sinyal scalping entry paling reliable untuk BTC

Tugasmu: analisis teknikal MURNI untuk scalping BTC (target TP/SL dalam kisaran $200-$1000 dari harga saat ini).
Tulis dalam Bahasa Indonesia. Berikan probabilitas konkret (misal "75% kemungkinan bounce dari EMA21").
Selalu sebutkan: setup entry, level invalidasi, timeframe scalping yang relevan (1m/5m/15m).
Jawaban maksimal 4 kalimat.`;

// ─── Question generators ──────────────────────────────────────────────────────
function buildQuestions(params: {
  price: number; rsi14: number | null; ema9: number | null; ema21: number | null;
  ema50: number | null; bbWidth: number | null; atr14: number | null;
  macdHistogram: number | null; trend: string; fundingRate: number | null;
  emaAlignment: string; rsiSignal: string;
}): string[] {
  const { price, rsi14, ema9, ema21, ema50, bbWidth, atr14, macdHistogram, trend, fundingRate, emaAlignment, rsiSignal } = params;
  const rsi = rsi14 ?? 50;
  const atr = atr14 ?? 500;
  const fr = fundingRate;

  return [
    `BTC harga $${price.toLocaleString()}, RSI=${rsi.toFixed(1)} (${rsiSignal}), EMA alignment=${emaAlignment}, MACD histogram=${(macdHistogram ?? 0).toFixed(0)}. Untuk scalping dalam 15-30 menit ke depan, apakah momentum sedang membangun atau melemah? Setup scalping terbaik saat ini?`,

    ema9 && ema21
      ? `BTC $${price.toLocaleString()} vs EMA9=$${ema9.toFixed(0)}, EMA21=$${ema21.toFixed(0)}, EMA50=$${ema50?.toFixed(0) ?? "N/A"}. ${price > (ema21 ?? price) ? "Price ATAS EMA21" : "Price BAWAH EMA21"} — apakah ini support/resistance kunci untuk scalping? Berikan level entry ideal dan di mana stop loss harus dipasang (maksimal $800 dari entry untuk scalping).`
      : `BTC trend: ${trend}, ATR=$${atr.toFixed(0)} per bar. Untuk scalping, apakah ATR saat ini mendukung target TP $500-$800? Atau terlalu sepi/terlalu volatile untuk scalping?`,

    bbWidth !== null
      ? `BB Width BTC saat ini ${(bbWidth * 100).toFixed(2)}% dari harga. ${bbWidth < 0.01 ? "SQUEEZE EKSTREM — siap breakout" : bbWidth > 0.04 ? "BB sangat lebar — high volatility, hati-hati overextended" : "BB normal"}. Berdasarkan pola historis BTC, ke arah mana breakout lebih mungkin terjadi? Setup scalping pre-breakout vs post-breakout mana yang lebih aman?`
      : `ATR BTC saat ini $${atr.toFixed(0)}. Untuk scalping dengan max SL $800, apakah risiko ini acceptable? Berapa TP ideal (RR minimal 1.5:1) berdasarkan kondisi volatilitas saat ini?`,

    fr !== null
      ? `Funding rate BTC saat ini ${(fr * 100).toFixed(4)}%. ${fr > 0.05 ? "SANGAT TINGGI — longs overtextended, risiko flush" : fr < -0.03 ? "NEGATIF — shorts dominan, potensi short squeeze" : "Normal"}. Bagaimana funding rate ini mempengaruhi probabilitas arah scalping jangka pendek? Apakah ada peluang contrarian?`
      : `BTC dalam kondisi ${trend} dengan RSI ${rsi.toFixed(0)}. Untuk scalping, apakah kondisi ini mendukung trend-following atau counter-trend play? Berikan level konkret untuk entry scalping.`,
  ];
}

// ─── Save insight ─────────────────────────────────────────────────────────────
async function saveInsight(
  category: string, title: string, content: string,
  confidence: number, sourceQuestion: string, tags: string
) {
  if (content.includes("API key belum diset") || content.length < 30) return;
  const existing = await db
    .select({ id: btcQuantTechnicalBrainTable.id })
    .from(btcQuantTechnicalBrainTable)
    .where(eq(btcQuantTechnicalBrainTable.sourceQuestion, sourceQuestion))
    .limit(1);
  if (existing.length) return;
  await db.insert(btcQuantTechnicalBrainTable).values({
    category, title, content, confidence, sourceQuestion, marketConditionTags: tags,
  });
}

// ─── Forget curve ─────────────────────────────────────────────────────────────
async function applyForgetCurve() {
  // BTC decay lebih cepat (0.95) karena market berubah lebih cepat dari gold
  await db.execute(
    sql`UPDATE btc_quant_technical_brain SET decay_weight = decay_weight * 0.95,
        updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '12 hours'`
  );
  await db.execute(
    sql`UPDATE btc_quant_technical_brain SET is_active = false WHERE decay_weight < 0.3`
  );
}

// ─── Get current signal ───────────────────────────────────────────────────────
export async function getBtcTechnicalSignal(): Promise<BtcTechnicalSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 60_000) return lastSignal;

  const indicators = await fetchBtcusdIndicators("5").catch(() => null);
  if (!indicators) {
    return {
      signal: "HOLD", direction: "neutral", confidence: 0.3,
      reasoning: ["Tidak ada data BTC tersedia"], keySetup: "Menunggu data",
      updatedAt: new Date(), cycleCount, totalInsights: 0,
    };
  }

  const brainEntries = await db
    .select({ content: btcQuantTechnicalBrainTable.content, confidence: btcQuantTechnicalBrainTable.confidence })
    .from(btcQuantTechnicalBrainTable)
    .where(eq(btcQuantTechnicalBrainTable.isActive, true))
    .orderBy(desc(btcQuantTechnicalBrainTable.confidence))
    .limit(5);

  const totalInsightsRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(btcQuantTechnicalBrainTable)
    .where(eq(btcQuantTechnicalBrainTable.isActive, true));

  const brainContext = brainEntries.map((e) => `• ${e.content}`).join("\n");

  const prompt = `BTC Technical Brain — berikan sinyal scalping berdasarkan data ini:

INDIKATOR BTC (5M):
- Price: $${indicators.price.toLocaleString()}
- RSI14: ${indicators.rsi14?.toFixed(1) ?? "N/A"} (${indicators.rsiSignal})
- EMA9/21/50/200: ${indicators.ema9?.toFixed(0) ?? "N/A"} / ${indicators.ema21?.toFixed(0) ?? "N/A"} / ${indicators.ema50?.toFixed(0) ?? "N/A"} / ${indicators.ema200?.toFixed(0) ?? "N/A"}
- MACD hist: ${indicators.macdHistogram?.toFixed(0) ?? "N/A"}
- BB Width: ${((indicators.bbWidth ?? 0.02) * 100).toFixed(2)}%
- ATR14: $${indicators.atr14?.toFixed(0) ?? "N/A"}
- Trend: ${indicators.trend}, EMA Stack: ${indicators.emaAlignment}

PENGETAHUAN BRAIN (top patterns BTC):
${brainContext || "Belum ada pengetahuan tersimpan"}

⚠️ SCALPING CONSTRAINT: TP/SL maksimal $1000 dari harga entry.

Berikan respons JSON:
{"signal":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":["alasan1","alasan2","alasan3"],"keySetup":"deskripsi setup scalping 1 kalimat"}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, prompt, 25000);

  let parsed: { signal: string; confidence: number; reasoning: string[]; keySetup: string } = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer], keySetup: "Analisis teknikal BTC",
  };
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) parsed = { ...parsed, ...JSON.parse(match[0]) };
  } catch {/* use raw */}

  const sig = (["BUY", "SELL", "HOLD"].includes(parsed.signal) ? parsed.signal : "HOLD") as "BUY" | "SELL" | "HOLD";
  lastSignal = {
    signal: sig,
    direction: sig === "BUY" ? "up" : sig === "SELL" ? "down" : "neutral",
    confidence: Math.min(0.95, Math.max(0.1, parsed.confidence)),
    reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [answer],
    keySetup: parsed.keySetup ?? "BTC technical setup",
    updatedAt: new Date(),
    cycleCount,
    totalInsights: Number(totalInsightsRow[0]?.count ?? 0),
  };
  return lastSignal;
}

// ─── Learning cycle ───────────────────────────────────────────────────────────
async function runLearningCycle() {
  if (isRunning) return;
  isRunning = true;
  cycleCount++;
  const start = Date.now();

  try {
    const [indicators, fundingData] = await Promise.all([
      fetchBtcusdIndicators("5").catch(() => null),
      fetchBtcFundingRate().catch(() => null),
    ]);
    if (!indicators) return;

    const params = {
      price: indicators.price,
      rsi14: indicators.rsi14 ?? null,
      ema9: indicators.ema9 ?? null,
      ema21: indicators.ema21 ?? null,
      ema50: indicators.ema50 ?? null,
      bbWidth: indicators.bbWidth ?? null,
      atr14: indicators.atr14 ?? null,
      macdHistogram: indicators.macdHistogram ?? null,
      trend: indicators.trend,
      fundingRate: (fundingData as { rate?: number } | null)?.rate ?? null,
      emaAlignment: indicators.emaAlignment,
      rsiSignal: indicators.rsiSignal,
    };

    const questions = buildQuestions(params);
    let insightsSaved = 0;

    for (const question of questions.slice(0, 3)) {
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        const qualityScore = answer.match(/\d+%/g)?.length ?? 0;
        const confidence = qualityScore > 0 ? 0.65 + qualityScore * 0.05 : 0.55;
        const tags = [
          indicators.rsiSignal ? `rsi_${indicators.rsiSignal}` : null,
          indicators.emaAlignment ? `ema_${indicators.emaAlignment}` : null,
          indicators.trend ? `trend_${indicators.trend}` : null,
          params.fundingRate !== null ? `fr_${params.fundingRate > 0 ? "positive" : "negative"}` : null,
        ].filter(Boolean).join(",");

        await saveInsight(
          "btc_technical",
          `BTC Technical: ${question.substring(0, 80)}`,
          answer, Math.min(0.9, confidence), question, tags
        );
        insightsSaved++;
      }
    }

    if (cycleCount % 15 === 0) await applyForgetCurve();

    const signal = await getBtcTechnicalSignal();
    await verifyBtcBrainPredictions("technical", indicators.price, indicators.high, indicators.low).catch(() => 0);
    await generateBtcBrainPrediction({
      brainType: "technical", signal: signal.signal,
      confidence: signal.confidence, entryPrice: indicators.price,
      reasoning: signal.keySetup,
    }).catch(() => null);

    await db.insert(btcQuantLearningLogTable).values({
      brainType: "technical", cycleNumber: cycleCount,
      questionsAsked: questions.length, insightsSaved,
      currentPrice: indicators.price, durationMs: Date.now() - start,
    });

    console.log(`[BTC Technical Brain] Cycle #${cycleCount}: insights=${insightsSaved} price=$${indicators.price.toFixed(0)} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[BTC Technical Brain] Error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startBtcTechnicalBrain() {
  console.log("[BTC Technical Brain] 📊 Started — scalping every 2 minutes.");
  runLearningCycle();
  cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
}

export function stopBtcTechnicalBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getBtcTechnicalBrainStats() {
  return { cycleCount, lastSignal };
}
