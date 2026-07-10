/**
 * Quant Bot — Technical Brain
 * Learns from price action, indicators (EMA, RSI, MACD, BB, ATR, candlesticks).
 * Runs every 3 minutes, uses DeepSeek for every question — never naive/rule-only.
 */

import { db } from "@workspace/db";
import {
  quantTechnicalBrainTable,
  quantLearningLogTable,
  xauusdSnapshotsTable,
} from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchXauusdIndicators } from "./xauusd-data.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TechnicalBrainSignal {
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
let lastSignal: TechnicalBrainSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 3 * 60 * 1000; // 3 min

// ─── DeepSeek caller ──────────────────────────────────────────────────────────
async function askDeepSeek(
  systemPrompt: string,
  userMessage: string,
  timeoutMs = 30000
): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) return "[DeepSeek API key belum diset — atur di Admin → Pengaturan]";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "[no response]";
  } catch {
    return "[DeepSeek timeout atau error]";
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `Kamu adalah Technical Brain untuk trading XAUUSD (Gold).
Tugasmu: analisis MENDALAM dari perspektif teknikal murni.
- Fokus pada: price action, EMA stack, RSI divergence, MACD momentum, Bollinger Band squeeze/expansion, ATR volatility, candlestick patterns, support/resistance
- Tulis dalam Bahasa Indonesia, ringkas dan actionable
- Selalu berikan probabilitas (misal "70% kemungkinan breakout bullish")
- Jika tidak ada setup yang jelas, katakan "WAIT — tidak ada edge teknikal saat ini"
- Panjang jawaban maksimal 4 kalimat`;

// ─── Question generators — domain-specific technical questions ────────────────
function buildQuestions(snap: {
  price: number; rsi14: number | null; ema9: number | null; ema21: number | null;
  ema50: number | null; ema200: number | null; macdLine: number | null;
  macdHistogram: number | null; bbUpper: number | null; bbLower: number | null;
  bbWidth: number | null; atr14: number | null; trend: string | null;
  emaAlignment: string | null; rsiSignal: string | null;
}): string[] {
  const p = snap.price;
  const rsi = snap.rsi14 ?? 50;
  const ema50 = snap.ema50;
  const ema200 = snap.ema200;
  const bbW = snap.bbWidth;
  const atr = snap.atr14 ?? 10;
  const macdH = snap.macdHistogram ?? 0;
  const trend = snap.trend ?? "sideways";

  return [
    `XAUUSD harga $${p.toFixed(2)}, RSI=${rsi.toFixed(1)} (${snap.rsiSignal ?? "neutral"}), EMA alignment=${snap.emaAlignment ?? "mixed"}, MACD histogram=${macdH.toFixed(3)}. Apakah momentum teknikal sedang membangun atau melemah? Berikan analisis candlestick dan probabilitas arah 1 jam ke depan.`,
    ema50 && ema200
      ? `Price $${p.toFixed(2)} vs EMA50=$${ema50.toFixed(2)}, EMA200=$${ema200.toFixed(2)}. ${p > ema200 ? "Price DI ATAS" : "Price DI BAWAH"} EMA200. Apakah ini struktur yang mendukung continuation atau potensi reversal? Apa level kritis yang harus diperhatikan trader teknikal?`
      : `XAUUSD trend saat ini: ${trend}. Dari perspektif struktur market (higher highs/lower lows), apakah tren masih valid? Kapan kita tahu tren sudah berubah?`,
    bbW !== null
      ? `Bollinger Band width XAUUSD saat ini ${(bbW * 100).toFixed(1)}% dari harga (ATR=$${atr.toFixed(2)}). ${bbW < 0.015 ? "Band SANGAT SEMPIT — squeeze zone" : bbW > 0.03 ? "Band LEBAR — volatilitas tinggi" : "Band normal"}. Apa yang biasanya terjadi setelah kondisi BB seperti ini pada gold? Apakah ini setup breakout?`
      : `ATR XAUUSD saat ini $${atr.toFixed(2)}. Apakah volatilitas ini normal, tinggi, atau rendah untuk gold? Bagaimana implikasinya untuk penentuan stop loss dan target profit?`,
    `Dengan kondisi teknikal XAUUSD sekarang (price=$${p.toFixed(2)}, trend=${trend}, RSI=${rsi.toFixed(0)}), apa setup teknikal terbaik: apakah kita menunggu pullback ke EMA, breakout konfirmasi, atau tidak ada setup valid? Berikan level entry ideal dan invalidasi.`,
  ];
}

// ─── Save insight to brain ────────────────────────────────────────────────────
async function saveInsight(
  category: string,
  title: string,
  content: string,
  confidence: number,
  sourceQuestion: string,
  tags: string
) {
  if (content.includes("API key belum diset") || content.length < 30) return;

  // Dedup: skip if same source question already saved
  const existing = await db
    .select({ id: quantTechnicalBrainTable.id })
    .from(quantTechnicalBrainTable)
    .where(eq(quantTechnicalBrainTable.sourceQuestion, sourceQuestion))
    .limit(1);
  if (existing.length) return;

  await db.insert(quantTechnicalBrainTable).values({
    category,
    title,
    content,
    confidence,
    sourceQuestion,
    marketConditionTags: tags,
  });
}

// ─── Apply forget curve (decay old entries) ───────────────────────────────────
async function applyForgetCurve() {
  await db.execute(
    sql`UPDATE quant_technical_brain SET decay_weight = decay_weight * 0.97,
        updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '24 hours'`
  );
  await db.execute(
    sql`UPDATE quant_technical_brain SET is_active = false WHERE decay_weight < 0.3`
  );
}

// ─── Generate signal from brain + current indicators ─────────────────────────
export async function getTechnicalSignal(): Promise<TechnicalBrainSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 60_000) return lastSignal;

  const snap = await db
    .select()
    .from(xauusdSnapshotsTable)
    .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
    .limit(1);

  if (!snap.length) {
    return {
      signal: "HOLD", direction: "neutral", confidence: 0.3,
      reasoning: ["Tidak ada data snapshot tersedia"], keySetup: "Menunggu data",
      updatedAt: new Date(), cycleCount, totalInsights: 0,
    };
  }

  const s = snap[0]!;
  const brainEntries = await db
    .select({ content: quantTechnicalBrainTable.content, confidence: quantTechnicalBrainTable.confidence })
    .from(quantTechnicalBrainTable)
    .where(eq(quantTechnicalBrainTable.isActive, true))
    .orderBy(desc(quantTechnicalBrainTable.confidence))
    .limit(5);

  const brainContext = brainEntries.map((e) => `• ${e.content}`).join("\n");
  const totalInsights = await db
    .select({ count: sql<number>`count(*)` })
    .from(quantTechnicalBrainTable)
    .where(eq(quantTechnicalBrainTable.isActive, true));

  const prompt = `Kamu adalah Technical Brain XAUUSD. Berdasarkan data berikut, berikan sinyal trading:

INDIKATOR SAAT INI:
- Price: $${s.price.toFixed(2)}
- RSI14: ${s.rsi14?.toFixed(1) ?? "N/A"} (${s.rsiSignal ?? "neutral"})
- EMA9/21/50/200: ${s.ema9?.toFixed(0) ?? "N/A"} / ${s.ema21?.toFixed(0) ?? "N/A"} / ${s.ema50?.toFixed(0) ?? "N/A"} / ${s.ema200?.toFixed(0) ?? "N/A"}
- MACD: line=${s.macdLine?.toFixed(3) ?? "N/A"}, hist=${s.macdHistogram?.toFixed(3) ?? "N/A"}
- BB: upper=${s.bbUpper?.toFixed(0) ?? "N/A"}, lower=${s.bbLower?.toFixed(0) ?? "N/A"}, width=${((s.bbWidth ?? 0.02) * 100).toFixed(1)}%
- ATR14: ${s.atr14?.toFixed(2) ?? "N/A"}
- Trend: ${s.trend ?? "N/A"}, EMA Alignment: ${s.emaAlignment ?? "N/A"}

PENGETAHUAN DARI BRAIN (top patterns):
${brainContext || "Belum ada pengetahuan tersimpan"}

Berikan respons JSON:
{"signal":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":["alasan1","alasan2","alasan3"],"keySetup":"deskripsi setup 1 kalimat"}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, prompt, 25000);

  let parsed: { signal: string; confidence: number; reasoning: string[]; keySetup: string } = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer], keySetup: "Analisis teknikal",
  };
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) parsed = { ...parsed, ...JSON.parse(match[0]) };
  } catch {/* use raw answer */}

  const sig = (["BUY", "SELL", "HOLD"].includes(parsed.signal) ? parsed.signal : "HOLD") as "BUY" | "SELL" | "HOLD";
  const direction: "up" | "down" | "neutral" = sig === "BUY" ? "up" : sig === "SELL" ? "down" : "neutral";

  lastSignal = {
    signal: sig,
    direction,
    confidence: Math.min(0.95, Math.max(0.1, parsed.confidence)),
    reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [answer],
    keySetup: parsed.keySetup ?? "Technical analysis",
    updatedAt: new Date(),
    cycleCount,
    totalInsights: Number(totalInsights[0]?.count ?? 0),
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
    const indicators = await fetchXauusdIndicators("1h").catch(() => null);
    if (!indicators) return;

    const snap = {
      price: indicators.price,
      rsi14: indicators.rsi14 ?? null,
      ema9: indicators.ema9 ?? null,
      ema21: indicators.ema21 ?? null,
      ema50: indicators.ema50 ?? null,
      ema200: indicators.ema200 ?? null,
      macdLine: indicators.macdLine ?? null,
      macdHistogram: indicators.macdHistogram ?? null,
      bbUpper: indicators.bbUpper ?? null,
      bbLower: indicators.bbLower ?? null,
      bbWidth: indicators.bbWidth ?? null,
      atr14: indicators.atr14 ?? null,
      trend: indicators.trend ?? null,
      emaAlignment: indicators.emaAlignment ?? null,
      rsiSignal: indicators.rsiSignal ?? null,
    };

    const questions = buildQuestions(snap);
    let insightsSaved = 0;

    for (const question of questions.slice(0, 3)) {
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        const qualityScore = answer.match(/\d+%/g)?.length ?? 0;
        const confidence = qualityScore > 0 ? 0.65 + qualityScore * 0.05 : 0.55;

        const tags = [
          snap.rsiSignal ? `rsi_${snap.rsiSignal}` : null,
          snap.emaAlignment ? `ema_${snap.emaAlignment}` : null,
          snap.trend ? `trend_${snap.trend}` : null,
        ].filter(Boolean).join(",");

        await saveInsight(
          "technical_analysis",
          `Technical Insight: ${question.substring(0, 80)}`,
          answer,
          Math.min(0.9, confidence),
          question,
          tags
        );
        insightsSaved++;
      }
    }

    // Apply forget curve every 10 cycles
    if (cycleCount % 10 === 0) await applyForgetCurve();

    // Refresh signal
    await getTechnicalSignal();

    await db.insert(quantLearningLogTable).values({
      brainType: "technical",
      cycleNumber: cycleCount,
      questionsAsked: questions.length,
      insightsSaved,
      currentPrice: snap.price,
      durationMs: Date.now() - start,
    });

    console.log(`[Quant Technical Brain] Cycle #${cycleCount}: insights=${insightsSaved} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[Quant Technical Brain] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startTechnicalBrain() {
  console.log("[Quant Technical Brain] 🔬 Started — learning every 3 minutes.");
  runLearningCycle();
  cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
}

export function stopTechnicalBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getTechnicalBrainStats() {
  return { cycleCount, lastSignal };
}
