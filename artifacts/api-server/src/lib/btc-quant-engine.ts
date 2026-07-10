/**
 * BTC Quant Bot Engine — Orchestrator
 * Menggabungkan sinyal dari 3 brain (Technical 40%, Fundamental 30%, Macro 30%).
 *
 * ⚠️ SCALPING CONSTRAINT (WAJIB):
 * TP dan SL TIDAK BOLEH lebih dari $1.000 dari harga entry BTC.
 * Jika ATR menghasilkan jarak > $1.000, hard-cap ke $1.000.
 *
 * Confidence gate: minimum 60% untuk menyimpan prediksi ensemble.
 * Cycle: 3 menit (lebih cepat dari XAUUSD karena BTC scalping).
 */

import { db } from "@workspace/db";
import {
  btcQuantBotPredictionsTable,
} from "@workspace/db/schema";
import { desc, eq } from "drizzle-orm";
import { getBtcTechnicalSignal } from "./btc-quant-technical-brain.js";
import { getBtcFundamentalSignal } from "./btc-quant-fundamental-brain.js";
import { getBtcMacroSignal } from "./btc-quant-macro-brain.js";
import { fetchBtcusdIndicators, fetchFearGreedIndex, fetchBtcFundingRate, getBtcHalvingContext } from "./btcusd-data.js";

// ─── Scalping constraint ───────────────────────────────────────────────────────
const MAX_TP_SL_DISTANCE = 1000; // USD — hard cap untuk scalping BTC
const MIN_CONFIDENCE = 0.60;     // minimum ensemble confidence untuk save prediksi

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BtcQuantBotStatus {
  isActive: boolean;
  lastUpdateAt: Date | null;
  cycleCount: number;
  technical: {
    signal: string; confidence: number; reasoning: string[];
    keySetup: string; insights: number;
  } | null;
  fundamental: {
    signal: string; confidence: number; reasoning: string[];
    fundamentalBias: string; keyDriver: string;
    halvingPhase: string; fearGreedScore: number | null; insights: number;
  } | null;
  macro: {
    signal: string; confidence: number; reasoning: string[];
    macroRegime: string; correlationBias: string;
    psychologyNarrative: string; insights: number;
  } | null;
  ensemble: {
    signal: "BUY" | "SELL" | "HOLD";
    direction: "up" | "down" | "neutral";
    confidence: number;
    votes: { technical: string; fundamental: string; macro: string };
    weights: { technical: number; fundamental: number; macro: number };
    consensus: "strong" | "moderate" | "weak" | "split";
  } | null;
  prediction: {
    entryPrice: number;
    tp: number;
    sl: number;
    tpDistance: number;
    slDistance: number;
    riskReward: number;
    constraintApplied: boolean; // true jika hard-cap $1000 aktif
  } | null;
  context: {
    fearGreedIndex: number | null;
    fundingRate: number | null;
    halvingPhase: string | null;
    session: string;
  };
}

let status: BtcQuantBotStatus = {
  isActive: false, lastUpdateAt: null, cycleCount: 0,
  technical: null, fundamental: null, macro: null,
  ensemble: null, prediction: null,
  context: { fearGreedIndex: null, fundingRate: null, halvingPhase: null, session: "unknown" },
};

// ─── Ensemble voting (Technical 40% / Fundamental 30% / Macro 30%) ─────────────
function computeEnsemble(
  techSig: string, techConf: number,
  fundSig: string, fundConf: number,
  macroSig: string, macroConf: number
): BtcQuantBotStatus["ensemble"] {
  // BTC scalping: technical paling dominan (40%) karena reaksi cepat diperlukan
  const WEIGHTS = { technical: 0.40, fundamental: 0.30, macro: 0.30 };

  const scoreSignal = (s: string, c: number) => {
    if (s === "BUY") return c;
    if (s === "SELL") return -c;
    return 0;
  };

  const weightedScore =
    scoreSignal(techSig, techConf) * WEIGHTS.technical +
    scoreSignal(fundSig, fundConf) * WEIGHTS.fundamental +
    scoreSignal(macroSig, macroConf) * WEIGHTS.macro;

  const avgConf =
    techConf * WEIGHTS.technical +
    fundConf * WEIGHTS.fundamental +
    macroConf * WEIGHTS.macro;

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
    confidence: Math.min(0.95, Math.max(0.15, avgConf * (
      consensus === "strong" ? 1.1 :
      consensus === "moderate" ? 1.0 : 0.85
    ))),
    votes: { technical: techSig, fundamental: fundSig, macro: macroSig },
    weights: WEIGHTS,
    consensus,
  };
}

// ─── TP/SL computation dengan hard-cap $1000 ─────────────────────────────────
function computeScalpingTPSL(
  price: number,
  atr: number,
  signal: "BUY" | "SELL" | "HOLD",
  consensus: "strong" | "moderate" | "weak" | "split"
): {
  tp: number; sl: number; tpDistance: number; slDistance: number;
  riskReward: number; constraintApplied: boolean;
} {
  if (signal === "HOLD") {
    return { tp: price, sl: price, tpDistance: 0, slDistance: 0, riskReward: 0, constraintApplied: false };
  }

  // ATR multiplier: strong = 2.0x TP, 1.2x SL; moderate = 1.5x TP, 1.0x SL
  const tpMult = consensus === "strong" ? 2.0 : consensus === "moderate" ? 1.5 : 1.2;
  const slMult = consensus === "strong" ? 1.2 : consensus === "moderate" ? 1.0 : 0.8;

  let rawTpDist = atr * tpMult;
  let rawSlDist = atr * slMult;
  let constraintApplied = false;

  // ⚠️ Hard-cap scalping: max $1000 dari entry
  if (rawTpDist > MAX_TP_SL_DISTANCE) {
    rawTpDist = MAX_TP_SL_DISTANCE;
    constraintApplied = true;
  }
  if (rawSlDist > MAX_TP_SL_DISTANCE) {
    rawSlDist = MAX_TP_SL_DISTANCE;
    constraintApplied = true;
  }

  // Minimum jarak: 100 USD (agar ada ruang gerak)
  rawTpDist = Math.max(100, rawTpDist);
  rawSlDist = Math.max(80, rawSlDist);

  const tp = signal === "BUY" ? price + rawTpDist : price - rawTpDist;
  const sl = signal === "BUY" ? price - rawSlDist : price + rawSlDist;
  const riskReward = rawSlDist > 0 ? rawTpDist / rawSlDist : 1;

  return {
    tp: Math.round(tp * 100) / 100,
    sl: Math.round(sl * 100) / 100,
    tpDistance: Math.round(rawTpDist * 100) / 100,
    slDistance: Math.round(rawSlDist * 100) / 100,
    riskReward: Math.round(riskReward * 100) / 100,
    constraintApplied,
  };
}

// ─── Session detector ─────────────────────────────────────────────────────────
function detectSession(): string {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 5) return "asia";
  if (hour >= 5 && hour < 8) return "asia_london_overlap";
  if (hour >= 8 && hour < 12) return "london";
  if (hour >= 12 && hour < 16) return "ny_overlap";
  if (hour >= 16 && hour < 21) return "ny";
  return "late_ny";
}

// ─── Main orchestration cycle ─────────────────────────────────────────────────
async function runOrchestrationCycle() {
  status.cycleCount++;
  const cycleNum = status.cycleCount;

  try {
    // 1. Ambil sinyal dari 3 brain + data konteks secara paralel
    // getBtcHalvingContext adalah synchronous — tidak perlu await
    const halvingCtxSync = (() => { try { return getBtcHalvingContext(); } catch { return null; } })();

    const [techSignal, fundSignal, macroSignal, indicators, fearGreed, fundingData] =
      await Promise.all([
        getBtcTechnicalSignal().catch((e) => { console.error("[BTC Quant] Tech error:", e.message); return null; }),
        getBtcFundamentalSignal().catch((e) => { console.error("[BTC Quant] Fund error:", e.message); return null; }),
        getBtcMacroSignal().catch((e) => { console.error("[BTC Quant] Macro error:", e.message); return null; }),
        fetchBtcusdIndicators("5").catch(() => null),
        fetchFearGreedIndex().catch(() => null),
        fetchBtcFundingRate().catch(() => null),
      ]);
    const halvingCtx = halvingCtxSync;

    if (!techSignal || !fundSignal || !macroSignal) {
      console.log(`[BTC Quant Orchestrator] Cycle #${cycleNum}: brain signals belum siap, skip`);
      return;
    }

    const price = indicators?.price ?? 60000;
    const atr = indicators?.atr14 ?? 800; // BTC ATR default $800
    const fg = (fearGreed as { value?: number } | null)?.value ?? null;
    const fr = (fundingData as { rate?: number } | null)?.rate ?? null;
    const halvingPhase = (halvingCtx as { phase?: string } | null)?.phase ?? null;
    const session = detectSession();

    // 2. Compute ensemble
    const ensemble = computeEnsemble(
      techSignal.signal, techSignal.confidence,
      fundSignal.signal, fundSignal.confidence,
      macroSignal.signal, macroSignal.confidence,
    );

    // 3. Compute TP/SL dengan scalping constraint $1000
    const tpsl = computeScalpingTPSL(price, atr, ensemble.signal, ensemble.consensus);

    if (tpsl.constraintApplied) {
      console.log(`[BTC Quant Orchestrator] ⚠️ Scalping cap aktif — TP/SL dikrop ke max $${MAX_TP_SL_DISTANCE} dari $${price.toFixed(0)}`);
    }

    // 4. Update status (selalu update, bahkan HOLD)
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
        keyDriver: fundSignal.keyDriver, halvingPhase: fundSignal.halvingPhase,
        fearGreedScore: fundSignal.fearGreedScore, insights: fundSignal.totalInsights,
      },
      macro: {
        signal: macroSignal.signal, confidence: macroSignal.confidence,
        reasoning: macroSignal.reasoning, macroRegime: macroSignal.macroRegime,
        correlationBias: macroSignal.correlationBias,
        psychologyNarrative: macroSignal.psychologyNarrative,
        insights: macroSignal.totalInsights,
      },
      ensemble,
      prediction: ensemble.signal !== "HOLD"
        ? {
            entryPrice: price,
            tp: tpsl.tp,
            sl: tpsl.sl,
            tpDistance: tpsl.tpDistance,
            slDistance: tpsl.slDistance,
            riskReward: tpsl.riskReward,
            constraintApplied: tpsl.constraintApplied,
          }
        : null,
      context: { fearGreedIndex: fg, fundingRate: fr, halvingPhase, session },
    };

    // 5. Simpan ke DB hanya jika confidence >= 60% dan sinyal bukan HOLD
    if (ensemble.signal !== "HOLD" && ensemble.confidence >= MIN_CONFIDENCE) {
      await db.insert(btcQuantBotPredictionsTable).values({
        timeframe: "5m",
        direction: ensemble.direction,
        signal: ensemble.signal,
        confidence: ensemble.confidence,
        entryPrice: price,
        tp: tpsl.tp,
        sl: tpsl.sl,
        tpDistance: tpsl.tpDistance,
        slDistance: tpsl.slDistance,
        riskReward: tpsl.riskReward,
        technicalSignal: techSignal.signal,
        technicalConfidence: techSignal.confidence,
        technicalReasoning: techSignal.reasoning.join(" | "),
        fundamentalSignal: fundSignal.signal,
        fundamentalConfidence: fundSignal.confidence,
        fundamentalReasoning: fundSignal.reasoning.join(" | "),
        macroSignal: macroSignal.signal,
        macroConfidence: macroSignal.confidence,
        macroReasoning: macroSignal.reasoning.join(" | "),
        regime: macroSignal.macroRegime,
        session,
        fearGreedIndex: fg,
        fundingRate: fr,
        halvingPhase,
        psychologyScore: null,
      }).catch(() => {});
    }

    console.log(
      `[BTC Quant Orchestrator] 🎯 Cycle #${cycleNum}: ` +
      `${ensemble.signal} (${ensemble.consensus}, conf=${(ensemble.confidence * 100).toFixed(0)}%) ` +
      `| votes: tech=${techSignal.signal} fund=${fundSignal.signal} macro=${macroSignal.signal} ` +
      `| TP=$${tpsl.tpDistance.toFixed(0)} SL=$${tpsl.slDistance.toFixed(0)}${tpsl.constraintApplied ? " [CAP]" : ""}`
    );
  } catch (err) {
    console.error("[BTC Quant Orchestrator] Error:", err instanceof Error ? err.message : err);
  }
}

// ─── Verifikasi prediksi lama (setiap cycle) ──────────────────────────────────
async function verifyOldPredictions(currentPrice: number, currentHigh: number, currentLow: number) {
  const pending = await db
    .select()
    .from(btcQuantBotPredictionsTable)
    .where(eq(btcQuantBotPredictionsTable.isVerified, false))
    .orderBy(desc(btcQuantBotPredictionsTable.predictedAt))
    .limit(10);

  for (const pred of pending) {
    const tpHit = pred.direction === "up" ? currentHigh >= pred.tp : currentLow <= pred.tp;
    const slHit = pred.direction === "up" ? currentLow <= pred.sl : currentHigh >= pred.sl;
    if (tpHit || slHit) {
      await db.update(btcQuantBotPredictionsTable).set({
        isVerified: true,
        isCorrect: slHit ? false : tpHit,
        actualPrice: currentPrice,
        verifiedAt: new Date(),
      }).where(eq(btcQuantBotPredictionsTable.id, pred.id)).catch(() => {});
    }
  }
}

let orchTimer: ReturnType<typeof setInterval> | null = null;

export function startBtcQuantEngine() {
  console.log("[BTC Quant Orchestrator] 🤖 Started — orchestrating every 3 minutes (scalping mode).");
  console.log(`[BTC Quant Orchestrator] ⚠️ Scalping constraint aktif: TP/SL max $${MAX_TP_SL_DISTANCE} dari entry.`);
  // Wait 15s setelah brains start agar ada sinyal awal
  setTimeout(() => runOrchestrationCycle(), 15_000);
  orchTimer = setInterval(async () => {
    const ind = await fetchBtcusdIndicators("5").catch(() => null);
    if (ind) await verifyOldPredictions(ind.price, ind.high, ind.low).catch(() => {});
    await runOrchestrationCycle();
  }, 3 * 60 * 1000);
}

export function stopBtcQuantEngine() {
  if (orchTimer) clearInterval(orchTimer);
}

export function getBtcQuantStatus(): BtcQuantBotStatus {
  return status;
}

export async function getBtcQuantRecentPredictions(limit = 20) {
  return db.select().from(btcQuantBotPredictionsTable)
    .orderBy(desc(btcQuantBotPredictionsTable.predictedAt))
    .limit(limit);
}
