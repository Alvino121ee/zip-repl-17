/**
 * Quant Bot Engine — Orchestrator
 * Combines signals from 3 independent brains (Technical 35%, Fundamental 30%, Macro 35%)
 * + capital management, psychology analysis, and psychology narrative.
 */

import { db } from "@workspace/db";
import {
  quantBotPredictionsTable,
  quantPsychologyLogTable,
  xauusdSnapshotsTable,
  xauusdMacroSnapshotsTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { getTechnicalSignal } from "./quant-technical-brain.js";
import { getFundamentalSignal } from "./quant-fundamental-brain.js";
import { getMacroSignal } from "./quant-macro-brain.js";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { fetchQuantNews } from "./quant-news-fetcher.js";
import { fetchXauusdIndicators } from "./xauusd-data.js";
import { getCalendarAnalysis } from "./xauusd-calendar.js";  // Fix #8
import { getGoldCouncilDebate } from "./quant-committee.js"; // Fix #10

// ─── Verification: check if old XAUUSD ensemble predictions hit TP or SL ────────
// Called at the start of every orchestration cycle with current bar high/low.
// Marks isVerified=true, isCorrect based on which level was reached first.
// Guard on UPDATE prevents double-counting in concurrent cycles.
// Also expires predictions older than 48h (1h timeframe) as inconclusive.
async function verifyQuantBotPredictions(
  currentPrice: number,
  currentHigh: number,
  currentLow: number
): Promise<void> {
  const pending = await db
    .select()
    .from(quantBotPredictionsTable)
    .where(eq(quantBotPredictionsTable.isVerified, false))
    .orderBy(desc(quantBotPredictionsTable.predictedAt))
    .limit(20);

  const EXPIRE_MS = 48 * 60 * 60 * 1000; // 48 h — 1h timeframe predictions

  for (const pred of pending) {
    // ── Expiry: mark stale predictions inconclusive (isCorrect = null) ─────────
    const age = Date.now() - new Date(pred.predictedAt).getTime();
    if (age > EXPIRE_MS) {
      await db
        .update(quantBotPredictionsTable)
        .set({
          isVerified: true,
          isCorrect: null,
          actualPrice: currentPrice,
          verifiedAt: new Date(),
          revisionNote: "expired — TP/SL not reached within 48h",
        })
        .where(
          and(
            eq(quantBotPredictionsTable.id, pred.id),
            eq(quantBotPredictionsTable.isVerified, false) // atomic guard
          )
        );
      continue;
    }

    // ── TP/SL check using bar high/low ─────────────────────────────────────────
    // Fix #5: check BOTH tp1 AND tp2; record which target was hit in revisionNote.
    // tp2 is the extended target — hitting tp2 is also a correct prediction.
    const tp1 = pred.tp1;
    const tp2 = pred.tp2;
    const sl = pred.sl;
    if (tp1 == null || sl == null) continue;

    const tp1Hit = pred.direction === "up" ? currentHigh >= tp1 : currentLow <= tp1;
    const tp2Hit = tp2 != null && (pred.direction === "up" ? currentHigh >= tp2 : currentLow <= tp2);
    const slHit  = pred.direction === "up" ? currentLow <= sl : currentHigh >= sl;

    if (!tp1Hit && !tp2Hit && !slHit) continue;
    // SL takes priority if it hits in the same bar (conservative — no intrabar ordering).
    const isCorrect = (tp1Hit || tp2Hit) && !slHit;
    const hitNote   = slHit ? "SL hit" : tp2Hit ? "TP2 hit" : "TP1 hit";

    await db
      .update(quantBotPredictionsTable)
      .set({
        isVerified: true,
        isCorrect,
        actualPrice: currentPrice,
        verifiedAt: new Date(),
        revisionNote: hitNote,
      })
      .where(
        and(
          eq(quantBotPredictionsTable.id, pred.id),
          eq(quantBotPredictionsTable.isVerified, false) // atomic guard vs. concurrent cycles
        )
      );
  }
}

// ─── Capital management state (persisted in DB via settings key) ───────────────
let capitalState = {
  accountBalance: 1000, // USD
  riskPercent: 1.0,     // % of account per trade
  leverage: 100,
  pipValue: 0.1,        // per 0.01 lot per pip
  currency: "USD",
};

export interface QuantBotStatus {
  isActive: boolean;
  lastUpdateAt: Date | null;
  cycleCount: number;
  technical: { signal: string; confidence: number; reasoning: string[]; keySetup: string; insights: number } | null;
  fundamental: { signal: string; confidence: number; reasoning: string[]; fundamentalBias: string; keyDriver: string; insights: number } | null;
  macro: { signal: string; confidence: number; reasoning: string[]; macroRegime: string; geopoliticalRisk: string; fedBias: string; psychologyNarrative: string; insights: number } | null;
  ensemble: {
    signal: "BUY" | "SELL" | "HOLD";
    direction: "up" | "down" | "neutral";
    confidence: number;
    votes: { technical: string; fundamental: string; macro: string };
    weights: { technical: number; fundamental: number; macro: number };
    consensus: "strong" | "moderate" | "weak" | "split";
  } | null;
  prediction: {
    entryPrice: number; tp1: number; tp2: number; sl: number;
    lotSize: number; riskAmount: number; riskReward: number;
  } | null;
  psychology: {
    score: number; label: string; narrative: string;
    keyEmotions: string[]; crowdBehavior: string; institutionalBias: string;
    tradingImplication: string;
  } | null;
  news: Array<{ headline: string; sentiment: string; impactLevel: string; aiAnalysis: string; publishedAt: string | null }>;
  capital: typeof capitalState;
}

let status: QuantBotStatus = {
  isActive: false, lastUpdateAt: null, cycleCount: 0,
  technical: null, fundamental: null, macro: null,
  ensemble: null, prediction: null, psychology: null,
  news: [], capital: capitalState,
};

// ─── DeepSeek caller (for psychology) ────────────────────────────────────────
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
        max_tokens: 700, temperature: 0.3,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "[no response]";
  } catch { return "[timeout]"; }
  finally { clearTimeout(timer); }
}

// ─── Ensemble voting ──────────────────────────────────────────────────────────
let _weights = { technical: 0.35, fundamental: 0.30, macro: 0.35 };

export function setEnsembleWeights(w: { technical: number; fundamental: number; macro: number }) {
  const sum = w.technical + w.fundamental + w.macro;
  if (sum <= 0) return;
  _weights = { technical: w.technical / sum, fundamental: w.fundamental / sum, macro: w.macro / sum };
}

export function getEnsembleWeights() { return { ..._weights }; }

function computeEnsemble(
  techSig: string, techConf: number,
  fundSig: string, fundConf: number,
  macroSig: string, macroConf: number
): QuantBotStatus["ensemble"] {
  const WEIGHTS = _weights;

  const scoreSignal = (s: string, c: number) => {
    if (s === "BUY") return c;
    if (s === "SELL") return -c;
    return 0;
  };

  const weightedScore =
    scoreSignal(techSig, techConf) * WEIGHTS.technical +
    scoreSignal(fundSig, fundConf) * WEIGHTS.fundamental +
    scoreSignal(macroSig, macroConf) * WEIGHTS.macro;

  const avgConf = techConf * WEIGHTS.technical + fundConf * WEIGHTS.fundamental + macroConf * WEIGHTS.macro;

  const votes = [techSig, fundSig, macroSig];
  const buyVotes = votes.filter((v) => v === "BUY").length;
  const sellVotes = votes.filter((v) => v === "SELL").length;

  let signal: "BUY" | "SELL" | "HOLD";
  let consensus: "strong" | "moderate" | "weak" | "split";

  if (buyVotes === 3 || (buyVotes === 2 && weightedScore > 0.2)) {
    signal = "BUY";
    consensus = buyVotes === 3 ? "strong" : "moderate";
  } else if (sellVotes === 3 || (sellVotes === 2 && weightedScore < -0.2)) {
    signal = "SELL";
    consensus = sellVotes === 3 ? "strong" : "moderate";
  } else if (Math.abs(weightedScore) < 0.05) {
    signal = "HOLD";
    consensus = "weak";
  } else {
    signal = weightedScore > 0 ? "BUY" : "SELL";
    consensus = "split";
  }

  return {
    signal,
    direction: signal === "BUY" ? "up" : signal === "SELL" ? "down" : "neutral",
    confidence: Math.min(0.95, Math.max(0.15, avgConf * (consensus === "strong" ? 1.1 : consensus === "moderate" ? 1.0 : 0.85))),
    votes: { technical: techSig, fundamental: fundSig, macro: macroSig },
    weights: WEIGHTS,
    consensus,
  };
}

// ─── Psychology analysis ──────────────────────────────────────────────────────
async function analyzePsychology(
  price: number, rsi: number | null, dxy: number | null,
  atr: number | null, macroNarrative: string, ensemble: NonNullable<QuantBotStatus["ensemble"]>
): Promise<QuantBotStatus["psychology"]> {
  const rsiVal = rsi ?? 50;
  const atrVal = atr ?? 10;
  const volatilityPct = (atrVal / price) * 100;

  // Base psychology score from RSI and ensemble
  let psychScore = 0;
  if (rsiVal > 70) psychScore += 0.4;
  else if (rsiVal > 60) psychScore += 0.2;
  else if (rsiVal < 30) psychScore -= 0.4;
  else if (rsiVal < 40) psychScore -= 0.2;

  if (ensemble.signal === "BUY") psychScore += ensemble.confidence * 0.3;
  else if (ensemble.signal === "SELL") psychScore -= ensemble.confidence * 0.3;
  psychScore = Math.max(-1, Math.min(1, psychScore));

  const label = psychScore > 0.5 ? "Extreme Greed" : psychScore > 0.2 ? "Greed" :
    psychScore > -0.2 ? "Neutral" : psychScore > -0.5 ? "Fear" : "Extreme Fear";

  const prompt = `DATA PASAR:
- Gold: $${price.toFixed(2)} | RSI: ${rsiVal.toFixed(1)} | ATR: $${atrVal.toFixed(2)} (volatility ${volatilityPct.toFixed(1)}%)
- DXY: ${dxy?.toFixed(2) ?? "N/A"}
- Ensemble signal: ${ensemble.signal} (confidence ${(ensemble.confidence * 100).toFixed(0)}%, consensus: ${ensemble.consensus})
- Technical: ${ensemble.votes.technical} | Fundamental: ${ensemble.votes.fundamental} | Macro: ${ensemble.votes.macro}
- Macro narrative: ${macroNarrative.substring(0, 200)}

Analisis psikologi pasar LENGKAP dalam format JSON:
{
  "keyEmotions": ["emosi1","emosi2","emosi3"],
  "crowdBehavior": "Apa yang sedang dilakukan trader retail sekarang — 2 kalimat spesifik",
  "institutionalBias": "Apa yang kemungkinan dilakukan institusi/smart money — 2 kalimat",
  "tradingImplication": "Apa implikasi psikologi ini untuk trading gold sekarang — 1-2 kalimat actionable",
  "narrative": "Paragraf penuh 4-5 kalimat tentang kondisi psikologis pasar gold saat ini. Deskripsikan: apakah ada FOMO, ketakutan, keserakahan, ketidakpastian? Siapa yang panik? Siapa yang confident? Bagaimana emosi ini menciptakan peluang atau risiko?"
}`;

  const answer = await askDeepSeek(
    "Kamu adalah ahli psikologi pasar trading. Analisis kondisi emosional dan perilaku trader XAUUSD saat ini secara mendalam.",
    prompt, 30000
  );

  let parsed = {
    keyEmotions: ["Uncertain"], crowdBehavior: "Retail menunggu konfirmasi",
    institutionalBias: "Smart money akumulasi di dips",
    tradingImplication: "Tunggu konfirmasi sebelum entry",
    narrative: answer.substring(0, 400),
  };
  try {
    const match = answer.match(/\{[\s\S]*\}/);
    if (match) parsed = { ...parsed, ...JSON.parse(match[0]) };
  } catch {/* use raw */}

  // Save to psychology log
  await db.insert(quantPsychologyLogTable).values({
    price, psychologyScore: psychScore,
    fearGreedSignal: label.toLowerCase().replace(" ", "_"),
    overallNarrative: parsed.narrative,
    keyEmotions: Array.isArray(parsed.keyEmotions) ? parsed.keyEmotions.join(",") : parsed.keyEmotions,
    crowdBehavior: parsed.crowdBehavior,
    institutionalBias: parsed.institutionalBias,
    tradingImplication: parsed.tradingImplication,
    rsi14: rsiVal, dxyLevel: dxy ?? null, vixProxy: atrVal,
  }).catch(() => {});

  return {
    score: psychScore, label,
    narrative: parsed.narrative,
    keyEmotions: Array.isArray(parsed.keyEmotions) ? parsed.keyEmotions : [parsed.keyEmotions],
    crowdBehavior: parsed.crowdBehavior,
    institutionalBias: parsed.institutionalBias,
    tradingImplication: parsed.tradingImplication,
  };
}

// ─── Capital management ───────────────────────────────────────────────────────
function computePositionSize(
  price: number, sl: number, capital: typeof capitalState
): { lotSize: number; riskAmount: number } {
  const riskAmount = (capital.accountBalance * capital.riskPercent) / 100;
  const pipRisk = Math.abs(price - sl) * 10; // pips (gold: 1 pip = $0.10 per 0.01 lot)
  const pipValuePerLot = 10; // $10 per pip per standard lot for XAUUSD
  const lotSize = pipRisk > 0 ? riskAmount / (pipRisk * pipValuePerLot) : 0.01;
  return {
    lotSize: Math.max(0.01, Math.min(10, Math.round(lotSize * 100) / 100)),
    riskAmount: Math.round(riskAmount * 100) / 100,
  };
}

// ─── Main orchestration cycle ─────────────────────────────────────────────────
async function runOrchestrationCycle() {
  status.cycleCount++;
  const cycleNum = status.cycleCount;

  try {
    // 0. Verify old ensemble predictions before generating new ones
    const indicators = await fetchXauusdIndicators("1h").catch(() => null);
    if (indicators) {
      await verifyQuantBotPredictions(indicators.price, indicators.high, indicators.low).catch(() => {});
    }

    // 1. Get signals from all 3 brains + market data in parallel
    const [techSignal, fundSignal, macroSignal, snapRows, macroRows, newsItems, calendarData, councilDebate] = await Promise.all([
      getTechnicalSignal().catch((e) => { console.error("[QuantBot] Tech signal error:", e.message); return null; }),
      getFundamentalSignal().catch((e) => { console.error("[QuantBot] Fund signal error:", e.message); return null; }),
      getMacroSignal().catch((e) => { console.error("[QuantBot] Macro signal error:", e.message); return null; }),
      db.select().from(xauusdSnapshotsTable).orderBy(desc(xauusdSnapshotsTable.snapshotAt)).limit(1),
      db.select().from(xauusdMacroSnapshotsTable).orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt)).limit(1),
      fetchQuantNews().catch(() => []),
      getCalendarAnalysis().catch(() => null),                    // Fix #8
      Promise.resolve(getGoldCouncilDebate()).catch(() => null),  // Fix #10 — sync fn, wrap untuk safety
    ]);

    if (!techSignal || !fundSignal || !macroSignal) return;

    const price = snapRows[0]?.price ?? 2000;
    const atr = snapRows[0]?.atr14 ?? 10;
    const rsi = snapRows[0]?.rsi14 ?? 50;
    const dxy = macroRows[0]?.dxy ?? null;
    const session = detectSession();

    // Fix #8: Block prediction entirely if a high-impact event is < 1 hour away
    const nextEventHours = calendarData?.nextEventHours ?? null;
    if (nextEventHours != null && nextEventHours < 1) {
      console.log(`[QuantBot] Fix #8: High-impact event in ${nextEventHours.toFixed(1)}h — skipping prediction cycle to avoid event risk.`);
      return;
    }

    // 2. Compute ensemble
    const ensemble = computeEnsemble(
      techSignal.signal, techSignal.confidence,
      fundSignal.signal, fundSignal.confidence,
      macroSignal.signal, macroSignal.confidence,
    );

    // Fix #7: Session-based confidence penalty (-15%) for low-liquidity sessions
    // Off-hours and Asia sessions produce noisier signals for XAUUSD (USD-denominated).
    let adjustedConfidence = ensemble.confidence;
    const isLowLiquiditySession = session === "off_hours" || session === "asia";
    if (isLowLiquiditySession) {
      adjustedConfidence = Math.max(0.10, adjustedConfidence * 0.85);
      console.log(`[QuantBot] Fix #7: Low-liquidity session (${session}) — confidence reduced ${(ensemble.confidence * 100).toFixed(0)}% → ${(adjustedConfidence * 100).toFixed(0)}%`);
    }

    // Fix #8: Apply calendar confidence adjustment (not blocking) for events 1-4h away
    if (calendarData?.confidenceAdjustment && Math.abs(calendarData.confidenceAdjustment) > 0) {
      const prevConf = adjustedConfidence;
      adjustedConfidence = Math.max(0.10, Math.min(0.95, adjustedConfidence + calendarData.confidenceAdjustment));
      console.log(`[QuantBot] Fix #8: Calendar adj ${calendarData.confidenceAdjustment > 0 ? "+" : ""}${(calendarData.confidenceAdjustment * 100).toFixed(0)}% → conf ${(prevConf * 100).toFixed(0)}% → ${(adjustedConfidence * 100).toFixed(0)}%`);
    }

    // Fix #10: Dewan Emas alignment bonus/penalty
    if (councilDebate?.leaderDecision) {
      const councilDir = councilDebate.leaderDecision.toLowerCase();
      const ensembleDir = ensemble.signal.toLowerCase();
      const agrees = (councilDir.includes("buy") && ensembleDir === "buy") ||
                     (councilDir.includes("sell") && ensembleDir === "sell");
      if (agrees) {
        adjustedConfidence = Math.min(0.95, adjustedConfidence + 0.05);
        console.log(`[QuantBot] Fix #10: Dewan Emas AGREES with ensemble (${ensemble.signal}) → conf +5%`);
      } else if (councilDir.includes("buy") || councilDir.includes("sell")) {
        // Dewan has a clear opposite opinion
        adjustedConfidence = Math.max(0.10, adjustedConfidence - 0.03);
        console.log(`[QuantBot] Fix #10: Dewan Emas DISAGREES with ensemble → conf -3%`);
      }
    }

    // Fix #9: Per-consensus confidence gate — block weak consensus / require higher bar for low-quality signals
    // strong consensus: min 0.45 | moderate: min 0.55 | split: min 0.65 | weak: always block
    const CONSENSUS_MIN: Record<string, number> = { strong: 0.40, moderate: 0.50, split: 0.60, weak: 0.65 };
    const minConf = CONSENSUS_MIN[ensemble.consensus] ?? 0.55;
    if (adjustedConfidence < minConf) {
      console.log(`[QuantBot] Fix #9: Consensus "${ensemble.consensus}" requires conf ≥ ${(minConf * 100).toFixed(0)}% but got ${(adjustedConfidence * 100).toFixed(0)}% — prediction blocked.`);
      return;
    }

    // Apply adjusted confidence back to ensemble object (so prediction stores accurate value)
    ensemble.confidence = adjustedConfidence;

    // 3. Compute TP/SL from ATR
    const atrMult = ensemble.consensus === "strong" ? 2.0 : 1.5;
    const tp1 = ensemble.signal === "BUY" ? price + atr * atrMult : price - atr * atrMult;
    const tp2 = ensemble.signal === "BUY" ? price + atr * atrMult * 1.8 : price - atr * atrMult * 1.8;
    const sl = ensemble.signal === "BUY" ? price - atr * 1.2 : price + atr * 1.2;
    const { lotSize, riskAmount } = computePositionSize(price, sl, capitalState);
    const riskReward = Math.abs(tp1 - price) / Math.abs(sl - price);

    // 4. Psychology analysis
    const psychology = await analyzePsychology(price, rsi, dxy, atr, macroSignal.psychologyNarrative, ensemble);

    // 5. Save prediction to DB (ensemble is guaranteed non-null here)
    if (ensemble.signal !== "HOLD") {
      await db.insert(quantBotPredictionsTable).values({
        timeframe: "1h",
        direction: ensemble.direction,
        signal: ensemble.signal,
        confidence: ensemble.confidence,
        entryPrice: price, tp1, tp2, sl, lotSize, riskAmount,
        technicalSignal: techSignal.signal,
        technicalConfidence: techSignal.confidence,
        technicalReasoning: techSignal.reasoning.join(" | "),
        fundamentalSignal: fundSignal.signal,
        fundamentalConfidence: fundSignal.confidence,
        fundamentalReasoning: fundSignal.reasoning.join(" | "),
        macroSignal: macroSignal.signal,
        macroConfidence: macroSignal.confidence,
        macroReasoning: macroSignal.reasoning.join(" | "),
        marketPsychology: psychology?.narrative ?? null,
        psychologyScore: psychology?.score ?? null,
        regime: macroSignal.macroRegime,
        session,
        capitalSnapshot: capitalState as unknown as Record<string, unknown>,
        revisionNote: [
          isLowLiquiditySession ? `session_penalty(${session})` : null,
          calendarData?.confidenceAdjustment ? `calendar_adj(${calendarData.confidenceAdjustment > 0 ? "+" : ""}${(calendarData.confidenceAdjustment * 100).toFixed(0)}%)` : null,
          councilDebate?.leaderDecision ? `dewan(${councilDebate.leaderDecision.substring(0, 20)})` : null,
        ].filter(Boolean).join(" | ") || null,
      }).catch(() => {});
    }

    // 6. Update status
    status = {
      isActive: true,
      lastUpdateAt: new Date(),
      cycleCount: cycleNum,
      technical: {
        signal: techSignal.signal, confidence: techSignal.confidence,
        reasoning: techSignal.reasoning, keySetup: techSignal.keySetup,
        insights: techSignal.totalInsights,
      },
      fundamental: {
        signal: fundSignal.signal, confidence: fundSignal.confidence,
        reasoning: fundSignal.reasoning, fundamentalBias: fundSignal.fundamentalBias,
        keyDriver: fundSignal.keyDriver, insights: fundSignal.totalInsights,
      },
      macro: {
        signal: macroSignal.signal, confidence: macroSignal.confidence,
        reasoning: macroSignal.reasoning, macroRegime: macroSignal.macroRegime,
        geopoliticalRisk: macroSignal.geopoliticalRisk, fedBias: macroSignal.fedBias,
        psychologyNarrative: macroSignal.psychologyNarrative, insights: macroSignal.totalInsights,
      },
      ensemble,
      prediction: ensemble.signal !== "HOLD"
        ? { entryPrice: price, tp1, tp2, sl, lotSize, riskAmount, riskReward: Math.round(riskReward * 100) / 100 }
        : null,
      psychology,
      news: newsItems.slice(0, 8).map((n) => ({
        headline: n.headline, sentiment: n.sentiment ?? "neutral",
        impactLevel: n.impactLevel ?? "low", aiAnalysis: n.aiAnalysis ?? "",
        publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
      })),
      capital: capitalState,
    };

    const sessionNote = isLowLiquiditySession ? ` [${session} -15%]` : "";
    console.log(`[QuantBot Orchestrator] Cycle #${cycleNum}: ensemble=${ensemble.signal} (${ensemble.consensus}, conf=${(ensemble.confidence*100).toFixed(0)}%${sessionNote})`);
  } catch (err) {
    console.error("[QuantBot Orchestrator] Error:", err instanceof Error ? err.message : err);
  }
}

function detectSession(): string {
  const hour = new Date().getUTCHours();
  if (hour >= 2 && hour < 8) return "asia";
  if (hour >= 8 && hour < 12) return "london";
  if (hour >= 12 && hour < 16) return "ny_overlap";
  if (hour >= 16 && hour < 21) return "ny";
  return "off_hours";
}

let orchTimer: ReturnType<typeof setInterval> | null = null;

export function startQuantBotEngine() {
  console.log("[QuantBot Orchestrator] 🤖 Started — orchestrating every 5 minutes.");
  setTimeout(() => runOrchestrationCycle(), 10_000); // wait 10s for brains to init
  orchTimer = setInterval(runOrchestrationCycle, 5 * 60 * 1000);
}

export function stopQuantBotEngine() {
  if (orchTimer) clearInterval(orchTimer);
}

export function getQuantBotStatus(): QuantBotStatus {
  return status;
}

export function updateCapital(newCapital: Partial<typeof capitalState>) {
  capitalState = { ...capitalState, ...newCapital };
  status.capital = capitalState;
}

export async function getRecentPredictions(limit = 20) {
  return db.select().from(quantBotPredictionsTable)
    .orderBy(desc(quantBotPredictionsTable.predictedAt)).limit(limit);
}

export async function getBrainStats() {
  const [techCount, fundCount, macroCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)`, avgConf: sql<number>`avg(confidence)` })
      .from((await import("@workspace/db/schema")).quantTechnicalBrainTable)
      .where(eq((await import("@workspace/db/schema")).quantTechnicalBrainTable.isActive, true)),
    db.select({ count: sql<number>`count(*)`, avgConf: sql<number>`avg(confidence)` })
      .from((await import("@workspace/db/schema")).quantFundamentalBrainTable)
      .where(eq((await import("@workspace/db/schema")).quantFundamentalBrainTable.isActive, true)),
    db.select({ count: sql<number>`count(*)`, avgConf: sql<number>`avg(confidence)` })
      .from((await import("@workspace/db/schema")).quantMacroBrainTable)
      .where(eq((await import("@workspace/db/schema")).quantMacroBrainTable.isActive, true)),
  ]);
  return {
    technical: { count: Number(techCount[0]?.count ?? 0), avgConfidence: Number(techCount[0]?.avgConf ?? 0) },
    fundamental: { count: Number(fundCount[0]?.count ?? 0), avgConfidence: Number(fundCount[0]?.avgConf ?? 0) },
    macro: { count: Number(macroCount[0]?.count ?? 0), avgConfidence: Number(macroCount[0]?.avgConf ?? 0) },
  };
}
