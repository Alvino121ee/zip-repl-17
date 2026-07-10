/**
 * BTC Quant Bot — Macro Brain
 * Spesialisasi: regime global, korelasi makro, dan faktor eksternal yang
 * mempengaruhi BTC secara tidak langsung.
 *
 * Fokus analisis:
 * - Risk-on / Risk-off: BTC berkorelasi positif dengan risk assets (Nasdaq)
 * - DXY: dolar kuat → tekanan pada BTC (seperti gold, tapi lebih volatile)
 * - ETH correlation: ETH/BTC ratio menunjukkan appetite altcoin vs BTC dominance
 * - Nasdaq correlation: BTCUSD dan QQQ punya korelasi 0.6-0.8 di market stress
 * - Global liquidity: M2 money supply, Fed balance sheet → driver jangka panjang
 * - Crypto market dominance: BTC.D naik = BTC outperform altcoin (risk-off crypto)
 *
 * Cycle: 5 menit
 */

import { db } from "@workspace/db";
import { btcQuantMacroBrainTable, btcQuantLearningLogTable } from "@workspace/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchBtcusdIndicators, getBtcCorrelationAnalysis } from "./btcusd-data.js";
import {
  generateBtcBrainPrediction,
  verifyBtcBrainPredictions,
} from "./btc-quant-brain-predictions.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BtcMacroSignal {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "up" | "down" | "neutral";
  confidence: number;
  reasoning: string[];
  macroRegime: string; // 'risk_on'|'risk_off'|'crypto_winter'|'bull_euphoria'|'stagflation'
  correlationBias: string; // insight dari korelasi Nasdaq/ETH/DXY
  psychologyNarrative: string;
  updatedAt: Date;
  cycleCount: number;
  totalInsights: number;
}

// ─── State ────────────────────────────────────────────────────────────────────
let cycleCount = 0;
let isRunning = false;
let lastSignal: BtcMacroSignal | null = null;
let cycleTimer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 5 * 60 * 1000; // 5 menit

// ─── DeepSeek caller ──────────────────────────────────────────────────────────
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
  } catch { return "[timeout]"; }
  finally { clearTimeout(timer); }
}

const SYSTEM_PROMPT = `Kamu adalah Macro Brain untuk trading BTCUSD — spesialis korelasi makro dan regime global.

Perbedaan kritis BTC vs gold dalam konteks makro:
1. BTC = "risk asset" bukan "safe haven" — saat risk-off, BTC TURUN bersama Nasdaq, bukan naik seperti gold
2. BTC sensitif terhadap likuiditas global: QE/dovish Fed = BTC bullish, QT/hawkish Fed = BTC bearish
3. Korelasi Nasdaq-BTC: pada tekanan pasar, korelasi bisa mencapai 0.85 (sangat tinggi)
4. ETH/BTC ratio: ETH outperform → appetite risk altcoin tinggi → pasar crypto bullish
5. BTC Dominance naik → uang mengalir KE BTC dari altcoin (tidak selalu bullish harga, bisa defensive)
6. DXY kuat → headwind untuk BTC, tapi korelasi tidak sekuat dengan gold

Regime yang harus kamu identifikasi:
- risk_on: Nasdaq naik, DXY lemah, BTC naik bersama tech stocks
- risk_off: Nasdaq turun, DXY kuat, BTC ikut turun (BUKAN safe haven)
- crypto_winter: BTC turun struktural, likuiditas crypto mengering
- bull_euphoria: BTC outperform semua aset, FOMO, retail masuk
- stagflation: inflasi tinggi, growth lemah — ambigu untuk BTC

Tulis dalam Bahasa Indonesia. Selalu jelaskan MENGAPA korelasi terjadi, bukan hanya deskripsi level.
Kontekskan dengan scalping: "dalam kondisi risk-off hari ini, bias scalping BTC adalah..."`;

// ─── Question builders ────────────────────────────────────────────────────────
function buildMacroQuestions(params: {
  price: number;
  correlation: { ethChange?: number; nasdaqChange?: number; dxyLevel?: number } | null;
  atr14: number | null;
}): string[] {
  const { price, correlation, atr14 } = params;
  const ethChg = correlation?.ethChange;
  const nsdqChg = correlation?.nasdaqChange;
  const dxy = correlation?.dxyLevel;

  return [
    `BTC saat ini $${price.toLocaleString()}. Nasdaq hari ini ${nsdqChg !== undefined ? `${nsdqChg > 0 ? "+" : ""}${nsdqChg.toFixed(2)}%` : "data N/A"}, DXY ${dxy ? dxy.toFixed(2) : "N/A"}. Apakah pasar sedang dalam regime risk-on atau risk-off? Bagaimana ini mempengaruhi bias directional BTC untuk scalping hari ini? Berikan probabilitas konkret.`,

    `ETH hari ini ${ethChg !== undefined ? `${ethChg > 0 ? "+" : ""}${ethChg.toFixed(2)}%` : "N/A"} vs BTC. ${ethChg !== undefined ? (ethChg > 2 ? "ETH outperform kuat — appetite altcoin tinggi, crypto market bullish" : ethChg < -2 ? "ETH underperform — risk aversion, uang ke BTC atau keluar crypto" : "ETH dan BTC bergerak searah") : ""}. Apa implikasi ETH/BTC ratio saat ini untuk scalping BTC dalam 2-4 jam ke depan? Apakah ini menunjukkan kekuatan atau kelemahan pasar crypto secara keseluruhan?`,

    dxy
      ? `DXY saat ini ${dxy.toFixed(2)}. Korelasi DXY-BTC biasanya negatif (DXY naik → BTC tertekan), tapi korelasi ini bisa breakdown. Apakah korelasi DXY-BTC saat ini normal atau anomali? Apa yang sedang didrive oleh DXY (Fed policy, safe haven demand, atau risk-off)? Bagaimana ini mempengaruhi scalping BTC?`
      : `BTC $${price.toLocaleString()} dengan ATR $${(atr14 ?? 500).toFixed(0)}. Dari perspektif makro, apakah volatilitas ini mencerminkan kondisi normal atau ada event makro yang sedang dipricing? Apa regime makro yang paling tepat menggambarkan BTC saat ini?`,

    `Dalam konteks makro global saat ini, apa yang paling mungkin dilakukan oleh "smart money" crypto (hedge fund, prop trader, institusi) dalam 24 jam ke depan? Apakah mereka akan menambah long, short, atau mengurangi eksposur? Bagaimana ini harus mempengaruhi bias scalping hari ini?`,
  ];
}

// ─── Save insight ─────────────────────────────────────────────────────────────
async function saveInsight(
  category: string, title: string, content: string,
  confidence: number, sourceQuestion: string, tags: string
) {
  if (content.includes("API key belum diset") || content.length < 30) return;
  const existing = await db
    .select({ id: btcQuantMacroBrainTable.id })
    .from(btcQuantMacroBrainTable)
    .where(eq(btcQuantMacroBrainTable.sourceQuestion, sourceQuestion))
    .limit(1);
  if (existing.length) return;
  await db.insert(btcQuantMacroBrainTable).values({
    category, title, content, confidence, sourceQuestion, marketConditionTags: tags,
  });
}

// ─── Forget curve ─────────────────────────────────────────────────────────────
async function applyForgetCurve() {
  await db.execute(
    sql`UPDATE btc_quant_macro_brain SET decay_weight = decay_weight * 0.96,
        updated_at = NOW() WHERE is_active = true AND created_at < NOW() - INTERVAL '24 hours'`
  );
  await db.execute(
    sql`UPDATE btc_quant_macro_brain SET is_active = false WHERE decay_weight < 0.3`
  );
}

// ─── Get current signal ───────────────────────────────────────────────────────
export async function getBtcMacroSignal(): Promise<BtcMacroSignal> {
  if (lastSignal && Date.now() - lastSignal.updatedAt.getTime() < 60_000) return lastSignal;

  const [indicators, correlationData] = await Promise.allSettled([
    fetchBtcusdIndicators("60"),
    getBtcCorrelationAnalysis(),
  ]);

  const price = indicators.status === "fulfilled" ? indicators.value.price : 60000;
  const corr = correlationData.status === "fulfilled" ? correlationData.value : null;

  const brainEntries = await db
    .select({ content: btcQuantMacroBrainTable.content, confidence: btcQuantMacroBrainTable.confidence })
    .from(btcQuantMacroBrainTable)
    .where(eq(btcQuantMacroBrainTable.isActive, true))
    .orderBy(desc(btcQuantMacroBrainTable.confidence))
    .limit(5);

  const totalInsightsRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(btcQuantMacroBrainTable)
    .where(eq(btcQuantMacroBrainTable.isActive, true));

  const brainContext = brainEntries.map((e) => `• ${e.content}`).join("\n");

  const prompt = `BTC Macro Brain — berikan sinyal berdasarkan kondisi makro:

DATA MAKRO BTC:
- Harga BTC: $${price.toLocaleString()}
- ETH change: ${(corr as { ethChange?: number } | null)?.ethChange?.toFixed(2) ?? "N/A"}%
- Nasdaq: ${(corr as { nasdaqChange?: number } | null)?.nasdaqChange?.toFixed(2) ?? "N/A"}%
- DXY: ${(corr as { dxyLevel?: number } | null)?.dxyLevel?.toFixed(2) ?? "N/A"}

PENGETAHUAN MACRO BRAIN:
${brainContext || "Belum ada pengetahuan makro tersimpan"}

Berikan respons JSON:
{"signal":"BUY|SELL|HOLD","confidence":0.0-1.0,"reasoning":["alasan1","alasan2","alasan3"],"macroRegime":"risk_on|risk_off|crypto_winter|bull_euphoria|stagflation","correlationBias":"summary korelasi dalam 1 kalimat","psychologyNarrative":"narasi psikologi pasar BTC 3 kalimat"}`;

  const answer = await askDeepSeek(SYSTEM_PROMPT, prompt, 30000);

  let parsed: { signal: string; confidence: number; reasoning: string[]; macroRegime: string; correlationBias: string; psychologyNarrative: string } = {
    signal: "HOLD", confidence: 0.4, reasoning: [answer],
    macroRegime: "risk_on", correlationBias: "Korelasi normal",
    psychologyNarrative: answer.substring(0, 300),
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
    macroRegime: parsed.macroRegime ?? "risk_on",
    correlationBias: parsed.correlationBias ?? "Normal correlation",
    psychologyNarrative: parsed.psychologyNarrative ?? answer.substring(0, 300),
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
    const [indicators, correlationData] = await Promise.allSettled([
      fetchBtcusdIndicators("60"),
      getBtcCorrelationAnalysis(),
    ]);

    const price = indicators.status === "fulfilled" ? indicators.value.price : null;
    if (!price) return;

    const corr = correlationData.status === "fulfilled" ? correlationData.value : null;
    const atr14 = indicators.status === "fulfilled" ? indicators.value.atr14 : null;

    const questions = buildMacroQuestions({
      price,
      correlation: corr as { ethChange?: number; nasdaqChange?: number; dxyLevel?: number } | null,
      atr14,
    });
    let insightsSaved = 0;

    for (const question of questions.slice(0, 3)) {
      const answer = await askDeepSeek(SYSTEM_PROMPT, question);
      if (!answer.includes("API key") && answer.length > 40) {
        const qualityScore = answer.match(/\d+%/g)?.length ?? 0;
        const confidence = qualityScore > 0 ? 0.65 + qualityScore * 0.05 : 0.55;
        const nsdqChg = (corr as { nasdaqChange?: number } | null)?.nasdaqChange ?? 0;
        const tags = [
          nsdqChg > 0 ? "nasdaq_up" : "nasdaq_down",
        ].join(",");

        await saveInsight(
          "btc_macro",
          `BTC Macro: ${question.substring(0, 80)}`,
          answer, Math.min(0.9, confidence), question, tags
        );
        insightsSaved++;
      }
    }

    if (cycleCount % 12 === 0) await applyForgetCurve();

    const signal = await getBtcMacroSignal();
    const indValue = indicators.status === "fulfilled" ? indicators.value : null;
    await verifyBtcBrainPredictions("macro", price, indValue?.high, indValue?.low).catch(() => 0);
    await generateBtcBrainPrediction({
      brainType: "macro", signal: signal.signal,
      confidence: signal.confidence, entryPrice: price,
      reasoning: signal.correlationBias,
    }).catch(() => null);

    await db.insert(btcQuantLearningLogTable).values({
      brainType: "macro", cycleNumber: cycleCount,
      questionsAsked: questions.length, insightsSaved,
      currentPrice: price, durationMs: Date.now() - start,
    });

    console.log(`[BTC Macro Brain] Cycle #${cycleCount}: insights=${insightsSaved} regime=${signal.macroRegime} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error("[BTC Macro Brain] Error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startBtcMacroBrain() {
  console.log("[BTC Macro Brain] 🌍 Started — learning every 5 minutes.");
  // Delay 30 detik agar tidak bentrok dengan technical brain (start bersamaan)
  setTimeout(() => {
    runLearningCycle();
    cycleTimer = setInterval(runLearningCycle, CYCLE_MS);
  }, 30_000);
}

export function stopBtcMacroBrain() {
  if (cycleTimer) clearInterval(cycleTimer);
}

export function getBtcMacroBrainStats() {
  return { cycleCount, lastSignal };
}
