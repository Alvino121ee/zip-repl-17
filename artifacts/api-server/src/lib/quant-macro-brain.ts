/**
 * Quant Bot — Macro Brain
 * Learns from: DXY correlations, US10Y dynamics, geopolitical risk,
 * risk-on/risk-off regime, Fed policy cycle, global macro flows.
 * Runs every 6 minutes.
 */

import { db } from "@workspace/db";
import {
  quantMacroBrainTable,
  quantLearningLogTable,
  xauusdMacroSnapshotsTable,
  xauusdSnapshotsTable,
} from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchXauusdIndicators } from "./xauusd-data.js";
import { generateBrainPrediction, verifyBrainPredictions, reinforceQuantBrain, isNewHourlyCandle } from "./quant-brain-predictions.js";

export interface MacroBrainSignal {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "up" | "down" | "neutral";
  confidence: number;
  reasoning: string[];
  macroRegime: string; // 'risk_on'|'risk_off'|'stagflation'|'goldilocks'|'recession_fear'
  geopoliticalRisk: "low" | "medium" | "high" | "extreme";
  fedBias: "hawkish" | "neutral" | "dovish";
  psychologyNarrative: string; // rich paragraph about market psychology
  updatedAt: Date;
  cycleCount: number;
  totalInsights: number;
}

let cycleCount = 0;
let isRunning = false;
let lastSignal: MacroBrainSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 6 * 60 * 1000;

async function askDeepSeek(system: string, user: string, timeoutMs = 35000): Promise<string> {
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
        max_tokens: 600,
        temperature: 0.2,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "[no response]";
  } catch {
    return "[timeout]";
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `Kamu adalah Macro Brain untuk XAUUSD (Gold) — spesialis geopolitik, makroekonomi global, dan psikologi pasar.
Fokusmu:
1. REGIME MAKRO: apakah pasar dalam risk-on, risk-off, stagflasi, goldilocks, atau resesi?
2. DXY DYNAMICS: bukan hanya level, tapi mengapa DXY bergerak — dan apakah korelasi DXY-Gold saat ini normal atau breakdown?
3. GEOPOLITICAL RISK PREMIUM: berapa banyak "fear premium" yang sedang di-price oleh gold?
4. FED CYCLE: dovish pivot vs hawkish stance — market pricing berapa kali rate cut?
5. PSIKOLOGI PASAR: apa yang sedang dirasakan dan dipikirkan para trader dan investor sekarang? FOMO? Panic? Skeptis? Hopeful?
6. SMART MONEY vs RETAIL: apa yang dilakukan institusi vs retail berbeda?

Tulis dalam Bahasa Indonesia yang lugas dan mendalam. Sertakan narasi psikologi pasar yang kaya dan detail.`;

function buildMacroQuestions(dxy: number | null, us10y: number | null, price: number, trend: string | null): string[] {
  const dxyStr = dxy ? dxy.toFixed(2) : "N/A";
  const yieldStr = us10y ? `${us10y.toFixed(2)}%` : "N/A";

  return [
    `XAUUSD di $${price.toFixed(0)}, DXY=${dxyStr}, US10Y=${yieldStr}. Analisis REGIME MAKRO saat ini secara komprehensif: apakah kita di risk-on, risk-off, atau transisi? Apa yang mendorong pergerakan dan bagaimana posisi gold dalam regime ini? Berapa besar "safe haven premium" yang sedang di-price?`,
    `Korelasi DXY-Gold historis adalah -0.8 hingga -0.9. Dengan DXY saat ini ${dxyStr} dan gold $${price.toFixed(0)}: apakah korelasi ini sedang normal atau terjadi "correlation breakdown"? Jika breakdown, apa penyebabnya (geopolitik? Central bank buying yang mengabaikan USD?)? Apa implikasinya untuk trading gold?`,
    `Dari perspektif psikologi pasar saat ini untuk XAUUSD: (1) Apa yang sedang dirasakan para trader retail — FOMO beli di high, atau takut short? (2) Apa yang kemungkinan dilakukan hedge fund dan institutional? (3) Siapa yang "terjebak" di posisi salah saat ini? Berikan narasi psikologi pasar yang detail dan actionable.`,
    `Fed policy cycle saat ini: pasar sedang pricing dovish pivot atau hawkish stance? Bagaimana ini mempengaruhi real yield dan gold? Apa yang bisa menjadi "policy surprise" — hot CPI, strong NFP, atau Fed hawkish statement — yang bisa merusak bull case untuk gold?`,
    `Geopolitical risk premium dalam gold saat ini: berapa persen dari harga gold ($${price.toFixed(0)}) yang merupakan risk premium? Apa event geopolitik yang sedang dan berpotensi meningkatkan atau menurunkan premium ini? Jika tensi geopolitik mereda, berapa besar koreksi yang bisa terjadi?`,
  ];
}

async function saveInsight(category: string, title: string, content: string, confidence: number, sourceQuestion: string, tags: string) {
  if (content.includes("API key belum diset") || content.length < 30) return;
  const existing = await db.select({ id: quantMacroBrainTable.id }).from(quantMacroBrainTable)
    .where(eq(quantMacroBrainTable.sourceQuestion, sourceQuestion)).limit(1);
  if (existing.length) return;
  await db.insert(quantMacroBrainTable).values({ category, title, content, confidence, sourceQuestion, marketConditionTags: tags });
}

async function applyForgetCurve() {
  await db.execute(sql`UPDATE quant_macro_brain SET decay_weight = decay_weight * 0.95,
      updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '72 hours'`);
  await db.execute(sql`UPDATE quant_macro_brain SET is_active = false WHERE decay_weight < 0.2`);
}

export async function getMacroSignal(): Promise<MacroBrainSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 120_000) return lastSignal;

  const [macro, snap] = await Promise.all([
    db.select().from(xauusdMacroSnapshotsTable).orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt)).limit(1),
    db.select().from(xauusdSnapshotsTable).orderBy(desc(xauusdSnapshotsTable.snapshotAt)).limit(1),
  ]);

  const dxy = macro[0]?.dxy ?? null;
  const us10y = macro[0]?.us10y ?? null;
  const price = snap[0]?.price ?? 2000;
  const trend = snap[0]?.trend ?? "sideways";
  const atr = snap[0]?.atr14 ?? 10;

  const brainEntries = await db.select({ content: quantMacroBrainTable.content })
    .from(quantMacroBrainTable).where(eq(quantMacroBrainTable.isActive, true))
    .orderBy(desc(quantMacroBrainTable.confidence)).limit(5);
  const brainContext = brainEntries.map((e) => `• ${e.content.substring(0, 200)}`).join("\n");

  const totalInsights = await db.select({ count: sql<number>`count(*)` })
    .from(quantMacroBrainTable).where(eq(quantMacroBrainTable.isActive, true));

  const userPrompt = `DATA MAKRO SAAT INI:
- Gold: $${price.toFixed(2)} | Trend: ${trend} | ATR (volatility): $${atr.toFixed(2)}
- DXY: ${dxy?.toFixed(2) ?? "N/A"} | US10Y: ${us10y?.toFixed(2) ?? "N/A"}%
- Real Yield est.: ${us10y ? (us10y - 2.5).toFixed(2) : "N/A"}%

PENGETAHUAN MAKRO DARI BRAIN:
${brainContext || "Belum ada pengetahuan tersimpan"}

Berikan analisis makro komprehensif dalam format JSON:
{
  "signal": "BUY|SELL|HOLD",
  "confidence": 0.0-1.0,
  "reasoning": ["alasan makro 1", "alasan 2", "alasan 3"],
  "macroRegime": "risk_on|risk_off|stagflation|goldilocks|recession_fear|transitional",
  "geopoliticalRisk": "low|medium|high|extreme",
  "fedBias": "hawkish|neutral|dovish",
  "psychologyNarrative": "Paragraf 3-4 kalimat tentang psikologi pasar saat ini — apa yang dirasakan trader, siapa yang FOMO, siapa yang panik, bagaimana emosi pasar mempengaruhi gold. Tuliskan dengan vivid dan detail."
}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, userPrompt, 30000);

  let parsed: {
    signal: string; confidence: number; reasoning: string[]; macroRegime: string;
    geopoliticalRisk: string; fedBias: string; psychologyNarrative: string;
  } = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer],
    macroRegime: "transitional", geopoliticalRisk: "medium", fedBias: "neutral",
    psychologyNarrative: answer.substring(0, 300),
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
    macroRegime: parsed.macroRegime ?? "transitional",
    geopoliticalRisk: (["low","medium","high","extreme"].includes(parsed.geopoliticalRisk) ? parsed.geopoliticalRisk : "medium") as MacroBrainSignal["geopoliticalRisk"],
    fedBias: (["hawkish","neutral","dovish"].includes(parsed.fedBias) ? parsed.fedBias : "neutral") as MacroBrainSignal["fedBias"],
    psychologyNarrative: parsed.psychologyNarrative ?? answer.substring(0, 300),
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
    const [macro, snap] = await Promise.all([
      db.select().from(xauusdMacroSnapshotsTable).orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt)).limit(1),
      fetchXauusdIndicators("1d").catch(() => null),
    ]);
    const dxy = macro[0]?.dxy ?? null;
    const us10y = macro[0]?.us10y ?? null;
    const price = snap?.price ?? 2000;
    const trend = snap?.trend ?? "sideways";

    const questions = buildMacroQuestions(dxy, us10y, price, trend);
    let insightsSaved = 0;

    for (const question of questions.slice(0, 2)) {
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        const tags = [
          dxy ? (dxy > 104 ? "dxy_bull" : dxy < 101 ? "dxy_bear" : "dxy_neutral") : null,
          us10y ? (us10y > 4.5 ? "yield_elevated" : us10y < 4.0 ? "yield_falling" : "yield_stable") : null,
        ].filter(Boolean).join(",");

        await saveInsight(
          "macro_analysis",
          `Macro Insight [DXY=${dxy?.toFixed(1) ?? "?"}, Y=${us10y?.toFixed(2) ?? "?"}%]: ${question.substring(0, 70)}`,
          answer, 0.65, question, tags
        );
        insightsSaved++;
      }
    }

    if (cycleCount % 8 === 0) await applyForgetCurve();
    const signal = await getMacroSignal();

    // Fix #2/#3/#4: verifikasi multi-bar, reinforcement, candle-aligned prediction
    const verifyResult = await verifyBrainPredictions(
      "macro", price, snap?.high, snap?.low,
      snap?.prevHigh, snap?.prevLow  // Fix #4: multi-bar
    ).catch(() => ({ verified: 0, correct: 0, wrong: 0 }));
    if (verifyResult.correct > 0) await reinforceQuantBrain("macro", true).catch(() => {});
    if (verifyResult.wrong > 0)   await reinforceQuantBrain("macro", false).catch(() => {});
    // Buat prediksi — cooldown 30 menit diatur di dalam generateBrainPrediction
    await generateBrainPrediction({
      brainType: "macro",
      signal: signal.signal,
      confidence: signal.confidence,
      entryPrice: price,
      reasoning: signal.macroRegime,
    }).catch(() => null);

    await db.insert(quantLearningLogTable).values({
      brainType: "macro",
      cycleNumber: cycleCount,
      questionsAsked: questions.length,
      insightsSaved,
      predictionsChecked: verifyResult.verified,
      wrongPredictions: verifyResult.wrong,
      currentPrice: price,
      durationMs: Date.now() - start,
    });
    console.log(`[Quant Macro Brain] Cycle #${cycleCount}: insights=${insightsSaved} verified=${verifyResult.verified}(✓${verifyResult.correct}/✗${verifyResult.wrong}) (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[Quant Macro Brain] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startMacroBrain() {
  console.log("[Quant Macro Brain] 🌍 Started — learning every 6 minutes.");
  runLearningCycle();
  cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
}

export function stopMacroBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getMacroBrainStats() {
  return { cycleCount, lastSignal };
}
