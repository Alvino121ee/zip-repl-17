/**
 * BTC Quant Bot — Fundamental Brain
 * Spesialisasi: driver fundamental unik BTC yang tidak ada di gold.
 *
 * Fokus analisis:
 * - Halving cycle phase (bull_accumulation / bull_euphoria / bear_distribution / bear_capitulation)
 * - Fear & Greed Index (0-100) — indikator sentiment retail paling akurat untuk BTC
 * - Exchange flow: apakah BTC mengalir masuk (bearish) atau keluar (bullish) dari exchange?
 * - Spot BTC ETF net flow: BlackRock IBIT, Fidelity FBTC — driver harga jangka menengah
 * - Miner revenue & capitulation signal
 * - Stablecoin dominance: USDT/USDC naik = risk-off crypto
 *
 * Cycle: 6 menit (fundamental berubah lebih lambat dari teknikal)
 */

import { db } from "@workspace/db";
import { btcQuantFundamentalBrainTable, btcQuantLearningLogTable } from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchBtcusdIndicators, fetchFearGreedIndex, getBtcHalvingContext } from "./btcusd-data.js";
import {
  generateBtcBrainPrediction,
  verifyBtcBrainPredictions,
} from "./btc-quant-brain-predictions.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BtcFundamentalSignal {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "up" | "down" | "neutral";
  confidence: number;
  reasoning: string[];
  fundamentalBias: string; // 'accumulation'|'distribution'|'neutral'|'capitulation'
  keyDriver: string;
  halvingPhase: string;
  fearGreedScore: number | null;
  updatedAt: Date;
  cycleCount: number;
  totalInsights: number;
}

// ─── State ────────────────────────────────────────────────────────────────────
let cycleCount = 0;
let isRunning = false;
let lastSignal: BtcFundamentalSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 6 * 60 * 1000; // 6 menit

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
        max_tokens: 450,
        temperature: 0.25,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "[no response]";
  } catch { return "[timeout atau error]"; }
  finally { clearTimeout(timer); }
}

const SYSTEM_PROMPT = `Kamu adalah Fundamental Brain untuk trading BTCUSD.
Spesialisasimu: driver fundamental KHUSUS crypto yang tidak ada di gold atau saham.

Pengetahuan kritis yang harus kamu terapkan:
1. HALVING CYCLE (4 tahun):
   - Post-halving 0-6 bulan: supply shock → biasanya bullish kuat
   - 6-18 bulan post-halving: euphoria → hati-hati distribusi puncak
   - 18-36 bulan post-halving: bear market → akumulasi smart money
   - Pre-halving: anticipation rally → volatilitas tinggi

2. FEAR & GREED INDEX:
   - 0-25 (Extreme Fear): oportunitas beli, retail panic selling
   - 25-45 (Fear): risk aversion, wait and see
   - 45-55 (Neutral): ambiguous, ikuti teknikal
   - 55-75 (Greed): hati-hati, tapi trend masih bullish
   - 75-100 (Extreme Greed): warning zona distribusi, risiko dump

3. ETF FLOW (Spot BTC ETF):
   - Net inflow besar = institutional buying → bullish
   - Net outflow = institutional exit → bearish

4. EXCHANGE FLOW:
   - BTC keluar exchange (exchange outflow) = holder HODL → bullish
   - BTC masuk exchange (exchange inflow) = siap dijual → bearish

Tulis dalam Bahasa Indonesia. Quantify dampak: "Fear & Greed 20 → probabilitas bounce 65% dalam 48 jam berdasarkan historis".
Selalu kontekskan dengan scalping: meskipun fundamental adalah driver jangka menengah, bagaimana ia mempengaruhi bias scalping hari ini?`;

// ─── Question builders ────────────────────────────────────────────────────────
function buildFundamentalQuestions(params: {
  price: number;
  fearGreedScore: number | null;
  halvingPhase: string;
  daysSinceHalving: number;
}): string[] {
  const { price, fearGreedScore, halvingPhase, daysSinceHalving } = params;
  const fgStr = fearGreedScore !== null ? fearGreedScore.toString() : "N/A";
  const fgLabel = fearGreedScore !== null
    ? fearGreedScore < 25 ? "Extreme Fear" : fearGreedScore < 45 ? "Fear"
    : fearGreedScore < 55 ? "Neutral" : fearGreedScore < 75 ? "Greed" : "Extreme Greed"
    : "Unknown";

  return [
    `Fear & Greed Index BTC saat ini ${fgStr}/100 (${fgLabel}). BTC harga $${price.toLocaleString()}. Berdasarkan data historis, ketika Fear & Greed berada di level ini, apa yang biasanya terjadi pada BTC dalam 24-48 jam ke depan? Apakah ini sinyal contrarian atau trend-following untuk scalping hari ini?`,

    `BTC saat ini berada di fase halving: "${halvingPhase}" (${daysSinceHalving} hari sejak last halving, April 2024). Dalam konteks siklus halving BTC, apakah fase ini historisnya bullish atau bearish? Bagaimana fase halving ini harus mempengaruhi bias directional scalper BTC hari ini?`,

    `Dengan BTC di harga $${price.toLocaleString()} dan Fear & Greed ${fgStr} (${fgLabel}), apakah smart money (institusi, whales) lebih mungkin sedang akumulasi atau distribusi saat ini? Apa sinyal on-chain atau flow yang bisa kita gunakan sebagai konfirmasi? Bagaimana ini mempengaruhi scalping dalam 1-4 jam ke depan?`,

    `Spot BTC ETF (IBIT BlackRock, FBTC Fidelity) telah menjadi driver harga BTC baru sejak Januari 2024. Dengan kondisi pasar BTC saat ini ($${price.toLocaleString()}, ${halvingPhase}), apakah institutional flow via ETF lebih mungkin inflow atau outflow? Apa implikasinya untuk scalping BTC hari ini?`,
  ];
}

// ─── Save insight ─────────────────────────────────────────────────────────────
async function saveInsight(
  category: string, title: string, content: string,
  confidence: number, sourceQuestion: string, tags: string
) {
  if (content.includes("API key belum diset") || content.length < 30) return;
  const existing = await db
    .select({ id: btcQuantFundamentalBrainTable.id })
    .from(btcQuantFundamentalBrainTable)
    .where(eq(btcQuantFundamentalBrainTable.sourceQuestion, sourceQuestion))
    .limit(1);
  if (existing.length) return;
  await db.insert(btcQuantFundamentalBrainTable).values({
    category, title, content, confidence, sourceQuestion, marketConditionTags: tags,
  });
}

// ─── Forget curve ─────────────────────────────────────────────────────────────
async function applyForgetCurve() {
  // Decay lebih lambat untuk fundamental (0.97) — siklus halving bertahan berbulan-bulan
  await db.execute(
    sql`UPDATE btc_quant_fundamental_brain SET decay_weight = decay_weight * 0.97,
        updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '48 hours'`
  );
  await db.execute(
    sql`UPDATE btc_quant_fundamental_brain SET is_active = false WHERE decay_weight < 0.3`
  );
}

// ─── Get current signal ───────────────────────────────────────────────────────
export async function getBtcFundamentalSignal(): Promise<BtcFundamentalSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 60_000) return lastSignal;

  const [indicators, fearGreedData, halvingCtx] = await Promise.allSettled([
    fetchBtcusdIndicators("60"),
    fetchFearGreedIndex(),
    getBtcHalvingContext(),
  ]);

  const price = indicators.status === "fulfilled" ? indicators.value.price : 60000;
  const fg = fearGreedData.status === "fulfilled" ? (fearGreedData.value as { value?: number } | null)?.value ?? null : null;
  const halving = halvingCtx.status === "fulfilled" ? halvingCtx.value : null;

  const brainEntries = await db
    .select({ content: btcQuantFundamentalBrainTable.content, confidence: btcQuantFundamentalBrainTable.confidence })
    .from(btcQuantFundamentalBrainTable)
    .where(eq(btcQuantFundamentalBrainTable.isActive, true))
    .orderBy(desc(btcQuantFundamentalBrainTable.confidence))
    .limit(5);

  const totalInsightsRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(btcQuantFundamentalBrainTable)
    .where(eq(btcQuantFundamentalBrainTable.isActive, true));

  const brainContext = brainEntries.map((e) => `• ${e.content}`).join("\n");
  const halvingPhase = (halving as { phase?: string } | null)?.phase ?? "unknown";

  const prompt = `BTC Fundamental Brain — berikan sinyal berdasarkan:

KONDISI FUNDAMENTAL BTC:
- Harga: $${price.toLocaleString()}
- Fear & Greed Index: ${fg ?? "N/A"}/100
- Halving Phase: ${halvingPhase}
- Hari sejak halving: ${(halving as { daysSinceHalving?: number } | null)?.daysSinceHalving ?? "N/A"} hari

PENGETAHUAN BRAIN (fundamental insights tersimpan):
${brainContext || "Belum ada pengetahuan fundamental tersimpan"}

Berikan respons JSON:
{"signal":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":["alasan1","alasan2"],"fundamentalBias":"accumulation|distribution|neutral|capitulation","keyDriver":"driver fundamental paling dominan saat ini 1 kalimat"}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, prompt, 25000);

  let parsed: { signal: string; confidence: number; reasoning: string[]; fundamentalBias: string; keyDriver: string } = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer],
    fundamentalBias: "neutral", keyDriver: "Fundamental BTC",
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
    fundamentalBias: parsed.fundamentalBias ?? "neutral",
    keyDriver: parsed.keyDriver ?? "Fundamental BTC",
    halvingPhase,
    fearGreedScore: fg,
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
    const [indicators, fearGreedData, halvingCtx] = await Promise.allSettled([
      fetchBtcusdIndicators("60"),
      fetchFearGreedIndex(),
      getBtcHalvingContext(),
    ]);

    const price = indicators.status === "fulfilled" ? indicators.value.price : null;
    if (!price) return;

    const fg = fearGreedData.status === "fulfilled" ? (fearGreedData.value as { value?: number } | null)?.value ?? null : null;
    const halving = halvingCtx.status === "fulfilled" ? halvingCtx.value : null;
    const halvingPhase = (halving as { phase?: string } | null)?.phase ?? "unknown";
    const daysSinceHalving = (halving as { daysSinceHalving?: number } | null)?.daysSinceHalving ?? 0;

    const questions = buildFundamentalQuestions({ price, fearGreedScore: fg, halvingPhase, daysSinceHalving });
    let insightsSaved = 0;

    for (const question of questions.slice(0, 3)) {
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        const qualityScore = answer.match(/\d+%/g)?.length ?? 0;
        const confidence = qualityScore > 0 ? 0.65 + qualityScore * 0.05 : 0.55;
        const tags = [
          fg !== null ? `fg_${fg < 25 ? "extreme_fear" : fg < 45 ? "fear" : fg < 55 ? "neutral" : fg < 75 ? "greed" : "extreme_greed"}` : null,
          `halving_${halvingPhase}`,
        ].filter(Boolean).join(",");

        await saveInsight(
          "btc_fundamental",
          `BTC Fundamental: ${question.substring(0, 80)}`,
          answer, Math.min(0.9, confidence), question, tags
        );
        insightsSaved++;
      }
    }

    if (cycleCount % 10 === 0) await applyForgetCurve();

    const signal = await getBtcFundamentalSignal();

    const indValue = indicators.status === "fulfilled" ? indicators.value : null;
    await verifyBtcBrainPredictions("fundamental", price, indValue?.high, indValue?.low).catch(() => 0);
    await generateBtcBrainPrediction({
      brainType: "fundamental", signal: signal.signal,
      confidence: signal.confidence, entryPrice: price,
      reasoning: signal.keyDriver,
    }).catch(() => null);

    await db.insert(btcQuantLearningLogTable).values({
      brainType: "fundamental", cycleNumber: cycleCount,
      questionsAsked: questions.length, insightsSaved,
      currentPrice: price, durationMs: Date.now() - start,
    });

    console.log(`[BTC Fundamental Brain] Cycle #${cycleCount}: insights=${insightsSaved} FG=${fg ?? "N/A"} halving=${halvingPhase} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[BTC Fundamental Brain] Error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startBtcFundamentalBrain() {
  console.log("[BTC Fundamental Brain] 💡 Started — learning every 6 minutes.");
  runLearningCycle();
  cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
}

export function stopBtcFundamentalBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getBtcFundamentalBrainStats() {
  return { cycleCount, lastSignal };
}
