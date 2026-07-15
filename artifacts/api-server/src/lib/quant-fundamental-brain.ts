/**
 * Quant Bot — Fundamental Brain
 * Learns from economic drivers: interest rates, real yields, COT data,
 * gold demand/supply, inflation expectations, USD strength fundamentals.
 * Runs every 8 minutes.
 */

import { db } from "@workspace/db";
import {
  quantFundamentalBrainTable,
  quantLearningLogTable,
  xauusdMacroSnapshotsTable,
} from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchXauusdIndicators, fetchTipsBreakeven5Y } from "./xauusd-data.js";
import { getCotAnalysis } from "./xauusd-cot.js";
import { generateBrainPrediction, verifyBrainPredictions, reinforceQuantBrain, isNewHourlyCandle } from "./quant-brain-predictions.js";

export interface FundamentalBrainSignal {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "up" | "down" | "neutral";
  confidence: number;
  reasoning: string[];
  fundamentalBias: string;
  keyDriver: string;
  updatedAt: Date;
  cycleCount: number;
  totalInsights: number;
}

let cycleCount = 0;
let isRunning = false;
let lastSignal: FundamentalBrainSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 8 * 60 * 1000;

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
  } catch {
    return "[timeout atau error]";
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `Kamu adalah Fundamental Brain untuk trading XAUUSD (Gold).
Spesialisasimu: analisis fundamental yang mempengaruhi harga gold.
Fokus pada:
- Real yield US (US10Y - inflasi ekspektasi): korelasi negatif kuat dengan gold
- DXY (Dollar Index): korelasi negatif dengan gold
- Ekspektasi Fed rate cut/hike dari Fed Funds Futures
- COT (Commitment of Traders): net position commercial vs speculative
- Gold demand fisik: China, India, Central Bank buying
- Supply: produksi tambang, gold ETF flows
- Risk appetite: risk-on (bearish gold) vs risk-off (bullish gold)
Tulis dalam Bahasa Indonesia. Berikan analisis mendalam, bukan hanya deskripsi.
Selalu quantify dampak: "DXY naik 1% -> gold biasanya turun 0.5-1%"`;

function buildFundamentalQuestions(
  dxy: number | null,
  us10y: number | null,
  price: number,
  breakeven5y: number | null,
  cotSummary: string
): string[] {
  const dxyStr = dxy ? `${dxy.toFixed(2)}` : "N/A";
  const yieldStr = us10y ? `${us10y.toFixed(2)}%` : "N/A";
  // Fix #1: real yield menggunakan TIPS 5Y breakeven, bukan nilai statis 2.5%
  const beStr = breakeven5y ? `${breakeven5y.toFixed(2)}%` : "~2.5%";
  const realYield = us10y && breakeven5y ? (us10y - breakeven5y).toFixed(2) : us10y ? (us10y - 2.5).toFixed(2) : "N/A";

  return [
    `DXY saat ini ${dxyStr}, US10Y yield ${yieldStr}, gold price ${price.toFixed(0)}. Berdasarkan korelasi historis DXY-Gold dan Real Yield-Gold, apakah fundamental saat ini mendukung gold NAIK atau TURUN? Seberapa kuat sinyal fundamental ini? Apakah ada divergence antara fundamental dan price action?`,
    // Fix #1: real yield dengan TIPS breakeven dinamis
    `Real yield US = US10Y(${yieldStr}) minus TIPS 5Y breakeven inflasi(${beStr}) = ${realYield}%. Pada level real yield ${realYield}% ini, secara historis gold cenderung bagaimana? Apakah posisi ini attractive untuk investor gold jangka menengah dibanding alternatif seperti TIPS dan bonds?`,
    // Fix #6: COT data langsung di pertanyaan fundamental
    `DATA COT GOLD TERBARU: ${cotSummary}. Analisis: apakah positioning institutional (spekulan net long/short) ini mendukung atau menolak momentum harga gold saat ini ${price.toFixed(0)}? Apakah posisi ekstrem ini merupakan sinyal kontarian (reversal warning) atau konfirmasi tren?`,
    `Dengan harga gold di ${price.toFixed(0)}: (1) Central bank global masih dalam tren beli gold? (2) ETF flows gold (GLD, IAU) sedang inflow atau outflow? (3) Demand fisik Asia (musim pernikahan India, CNY China) bagaimana dampaknya? Berikan bias fundamental keseluruhan dengan mempertimbangkan COT positioning.`,
    `Fed policy saat ini: apakah pasar pricing rate cut atau hike selanjutnya? Bagaimana timeline ini mempengaruhi DXY dan gold untuk 2-4 minggu ke depan? Apa risk terbesar untuk fundamental gold: hot CPI, strong NFP, atau hawkish Fed statement?`,
  ];
}

async function saveInsight(
  category: string, title: string, content: string,
  confidence: number, sourceQuestion: string, tags: string
) {
  if (content.includes("API key belum diset") || content.length < 30) return;
  const existing = await db
    .select({ id: quantFundamentalBrainTable.id })
    .from(quantFundamentalBrainTable)
    .where(eq(quantFundamentalBrainTable.sourceQuestion, sourceQuestion))
    .limit(1);
  if (existing.length) return;

  await db.insert(quantFundamentalBrainTable).values({
    category, title, content, confidence, sourceQuestion, marketConditionTags: tags,
  });
}

async function applyForgetCurve() {
  await db.execute(
    sql`UPDATE quant_fundamental_brain SET decay_weight = decay_weight * 0.96,
        updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '48 hours'`
  );
  await db.execute(
    sql`UPDATE quant_fundamental_brain SET is_active = false WHERE decay_weight < 0.25`
  );
}

export async function getFundamentalSignal(): Promise<FundamentalBrainSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 90_000) return lastSignal;

  const [macro, indicators, breakeven5y, cotData] = await Promise.all([
    db.select().from(xauusdMacroSnapshotsTable).orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt)).limit(1),
    fetchXauusdIndicators("1d").catch(() => null),
    fetchTipsBreakeven5Y().catch(() => null),       // Fix #1
    getCotAnalysis().catch(() => null),              // Fix #6
  ]);

  const dxy = macro[0]?.dxy ?? null;
  const us10y = macro[0]?.us10y ?? null;
  const price = indicators?.price ?? 2000;
  // Fix #1: use TIPS breakeven, fall back to 2.5 if unavailable
  const breakeven = breakeven5y ?? 2.5;
  const realYield = us10y ? (us10y - breakeven).toFixed(2) : "N/A";
  const cotSummary = cotData?.latest
    ? `${cotData.latest.sentiment} (net ${(cotData.latest.specNet / 1000).toFixed(0)}K kontrak, ${cotData.latest.interpretation.substring(0, 120)})`
    : "Data COT belum tersedia";

  const brainEntries = await db
    .select({ content: quantFundamentalBrainTable.content, confidence: quantFundamentalBrainTable.confidence })
    .from(quantFundamentalBrainTable)
    .where(eq(quantFundamentalBrainTable.isActive, true))
    .orderBy(desc(quantFundamentalBrainTable.confidence))
    .limit(5);

  const brainContext = brainEntries.map((e) => `• ${e.content.substring(0, 200)}`).join("\n");
  const totalInsights = await db
    .select({ count: sql<number>`count(*)` })
    .from(quantFundamentalBrainTable)
    .where(eq(quantFundamentalBrainTable.isActive, true));

  const userPrompt = `DATA MAKRO SAAT INI:
- Gold price: ${price.toFixed(2)}
- DXY: ${dxy?.toFixed(2) ?? "N/A"}
- US10Y yield: ${us10y?.toFixed(2) ?? "N/A"}%
- TIPS 5Y Breakeven inflasi: ${breakeven.toFixed(2)}% (Fix #1: dinamis dari FRED)
- Real yield (US10Y - breakeven): ${realYield}%
- COT Gold: ${cotSummary}

PENGETAHUAN FUNDAMENTAL DARI BRAIN:
${brainContext || "Belum ada pengetahuan tersimpan"}

Berikan sinyal fundamental dalam format JSON:
{"signal":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":["alasan fundamental 1","alasan 2","alasan 3"],"fundamentalBias":"1 kalimat bias fundamental","keyDriver":"driver utama saat ini"}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, userPrompt, 25000);

  let parsed = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer],
    fundamentalBias: answer.substring(0, 100), keyDriver: "DXY/Yield correlation",
  };
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) parsed = { ...parsed, ...JSON.parse(match[0]) };
  } catch {/* raw */}

  const sig = (["BUY", "SELL", "HOLD"].includes(parsed.signal) ? parsed.signal : "HOLD") as "BUY" | "SELL" | "HOLD";
  lastSignal = {
    signal: sig,
    direction: sig === "BUY" ? "up" : sig === "SELL" ? "down" : "neutral",
    confidence: Math.min(0.95, Math.max(0.1, parsed.confidence)),
    reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [answer],
    fundamentalBias: parsed.fundamentalBias,
    keyDriver: parsed.keyDriver,
    updatedAt: new Date(),
    cycleCount,
    totalInsights: Number(totalInsights[0]?.count ?? 0),
  };
  return lastSignal;
}

async function runLearningCycle() {
  if (isRunning) return;
  isRunning = true;
  cycleCount++;
  const start = Date.now();
  try {
    // Fix #1 + #6: fetch TIPS breakeven + COT in parallel with market data
    const [macro, indicators, breakeven5y, cotData] = await Promise.all([
      db.select().from(xauusdMacroSnapshotsTable).orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt)).limit(1),
      fetchXauusdIndicators("1d").catch(() => null),
      fetchTipsBreakeven5Y().catch(() => null),
      getCotAnalysis().catch(() => null),
    ]);

    const dxy = macro[0]?.dxy ?? null;
    const us10y = macro[0]?.us10y ?? null;
    const price = indicators?.price ?? 2000;
    const breakeven = breakeven5y ?? 2.5;
    // Fix #6: COT summary for questions
    const cotSummary = cotData?.latest
      ? `${cotData.latest.sentiment} (net ${(cotData.latest.specNet / 1000).toFixed(0)}K, data ${cotData.latest.reportDate})`
      : "belum tersedia";

    const questions = buildFundamentalQuestions(dxy, us10y, price, breakeven, cotSummary);
    let insightsSaved = 0;

    for (const question of questions.slice(0, 3)) { // 3 questions (was 2) — COT adds 1
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        // Fix #1: tag real yield level dengan nilai yang tepat
        const realYield = us10y ? us10y - breakeven : null;
        const tags = [
          dxy ? (dxy > 104 ? "dxy_strong" : dxy < 101 ? "dxy_weak" : "dxy_neutral") : null,
          us10y ? (us10y > 4.5 ? "yield_high" : us10y < 3.5 ? "yield_low" : "yield_neutral") : null,
          realYield !== null ? (realYield > 1.5 ? "real_yield_high" : realYield < 0 ? "real_yield_negative" : "real_yield_neutral") : null,
          // Fix #6: COT tag
          cotData?.latest ? `cot_${cotData.latest.sentiment}` : null,
        ].filter(Boolean).join(",");

        await saveInsight(
          "fundamental_analysis",
          `Fundamental Insight [DXY=${dxy?.toFixed(1) ?? "?"} RealYield=${realYield?.toFixed(2) ?? "?"}%]: ${question.substring(0, 70)}`,
          answer,
          0.65,
          question,
          tags
        );
        insightsSaved++;
      }
    }

    if (cycleCount % 8 === 0) await applyForgetCurve();
    const signal = await getFundamentalSignal();

    // Fix #2/#3/#4: reinforcement + candle alignment + multi-bar verify
    const verifyResult = await verifyBrainPredictions(
      "fundamental", price, indicators?.high, indicators?.low,
      indicators?.prevHigh, indicators?.prevLow  // Fix #4
    ).catch(() => ({ verified: 0, correct: 0, wrong: 0 }));
    if (verifyResult.correct > 0) await reinforceQuantBrain("fundamental", true).catch(() => {});
    if (verifyResult.wrong > 0)   await reinforceQuantBrain("fundamental", false).catch(() => {});
    // Buat prediksi — cooldown 30 menit diatur di dalam generateBrainPrediction
    await generateBrainPrediction({
      brainType: "fundamental",
      signal: signal.signal,
      confidence: signal.confidence,
      entryPrice: price,
      reasoning: signal.fundamentalBias,
    }).catch(() => null);

    await db.insert(quantLearningLogTable).values({
      brainType: "fundamental",
      cycleNumber: cycleCount,
      questionsAsked: questions.length,
      insightsSaved,
      predictionsChecked: verifyResult.verified,
      wrongPredictions: verifyResult.wrong,
      currentPrice: price,
      durationMs: Date.now() - start,
    });
    console.log(`[Quant Fundamental Brain] Cycle #${cycleCount}: insights=${insightsSaved} verified=${verifyResult.verified}(✓${verifyResult.correct}/✗${verifyResult.wrong}) cot=${cotData?.latest?.sentiment ?? "N/A"} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[Quant Fundamental Brain] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startFundamentalBrain() {
  console.log("[Quant Fundamental Brain] 📊 Started — learning every 8 minutes.");
  runLearningCycle();
  cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
}

export function stopFundamentalBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getFundamentalBrainStats() {
  return { cycleCount, lastSignal };
}
