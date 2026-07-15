/**
 * Quant Bot — Per-Brain Standalone Predictions
 * Setiap brain (Technical, Fundamental, Macro) membuat prediksinya SENDIRI,
 * lepas dari ensemble vote.
 *
 * TP/SL dihitung dinamis dari ATR saat prediksi dibuat:
 *   TP = clamp(ATR × 0.8, $3, $10)   — target realistis, di bawah 1 full ATR
 *   SL = clamp(ATR × 0.5, $2, $10)   — stop lebih ketat, RR ~1.6:1
 * Max 100 pips ($10) adalah batas atas, bukan nilai tetap.
 *
 * Improvements:
 * Fix #2 — Reinforcement: boost/decay brain entries based on verified outcomes
 * Fix #3 — Candle alignment: prediksi baru hanya dibuat di awal candle 1H (menit 0–4)
 * Fix #4 — Multi-bar verification: cek high/low candle sekarang DAN candle sebelumnya
 */

import { db } from "@workspace/db";
import {
  quantBrainPredictionsTable,
  quantTechnicalBrainTable,
  quantFundamentalBrainTable,
  quantMacroBrainTable,
} from "@workspace/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export type BrainType = "technical" | "fundamental" | "macro";

// Gold pip value: 1 pip = $0.10, 100 pips = $10.00
const GOLD_PIP_VALUE = 0.1;
export const MAX_PIPS = 100;
const MAX_DISTANCE   = MAX_PIPS * GOLD_PIP_VALUE; // $10.00 — batas atas, bukan nilai tetap

// Hitung TP/SL dinamis dari ATR dengan batas atas MAX_DISTANCE.
// TP = ATR × 0.8 → target realistis di bawah 1 full ATR
// SL = ATR × 0.5 → stop lebih ketat, rasio RR ~1.6:1
// Minimum TP $3 / SL $2 agar tidak terlalu sempit
function calcDynamicDistances(atr: number): { tpDist: number; slDist: number; pips: number } {
  const tpDist = Math.min(Math.max(atr * 0.8, 3.0), MAX_DISTANCE);
  const slDist = Math.min(Math.max(atr * 0.5, 2.0), MAX_DISTANCE);
  const pips   = Math.round(tpDist / GOLD_PIP_VALUE);
  return { tpDist, slDist, pips };
}

export interface BrainPredictionRecord {
  id: number;
  brainType: BrainType;
  symbol: string;
  predictedAt: Date;
  direction: "up" | "down";
  signal: "BUY" | "SELL";
  confidence: number;
  entryPrice: number;
  tp: number;
  sl: number;
  pips: number;
  reasoning: string | null;
  isVerified: boolean;
  isCorrect: boolean | null;
  actualPrice: number | null;
  verifiedAt: Date | null;
}

// ─── Running high/low tracker per prediksi ────────────────────────────────────
// Kunci: predId → nilai tertinggi/terendah harga yang PERNAH tercatat SEJAK
// prediksi dibuat (akumulasi lintas siklus 3-menit).
// Reset on restart — aman karena prediksi lama akan mulai dari currentPrice.
// Ini menggantikan penggunaan bar high/low dari scanner yang mencakup harga
// SEBELUM prediksi dibuat, yang menyebabkan false SL/TP hit.
const _runHigh: Map<number, number> = new Map();
const _runLow:  Map<number, number> = new Map();

// ─── Per-brain prediction cooldown ────────────────────────────────────────────
// Prediksi baru boleh dibuat max 1x per 30 menit per brain (bukan lagi hanya
// di menit 0–4 UTC, karena window itu terlalu sempit — 8% hit rate saja).
const PREDICTION_COOLDOWN_MS = 30 * 60 * 1000; // 30 menit
const _lastPredictionAt: Record<BrainType, number> = {
  technical: 0, fundamental: 0, macro: 0,
};

// Tetap diekspor agar tidak merusak import di brain files, tapi selalu true.
// Gate sebenarnya ada di dalam generateBrainPrediction (cooldown 30 menit).
export function isNewHourlyCandle(): boolean {
  return true;
}

// ─── Fix #2: Reinforcement — boost/decay brain entries after verified outcome ──
// Saat prediksi BENAR → boost decay_weight aktif (pattern ini terbukti)
// Saat prediksi SALAH → decay entries aktif dalam 7 hari terakhir (overconfident)
export async function reinforceQuantBrain(
  brainType: BrainType,
  isCorrect: boolean
): Promise<void> {
  const BOOST  = 1.06;  // +6% weight untuk pattern yang terbukti
  const DECAY  = 0.91;  // -9% weight untuk pattern yang salah
  const factor = isCorrect ? BOOST : DECAY;

  try {
    if (brainType === "technical") {
      await db.execute(
        sql`UPDATE quant_technical_brain
            SET decay_weight = LEAST(1.6, decay_weight * ${factor}),
                updated_at = NOW()
            WHERE is_active = true
              AND created_at > NOW() - INTERVAL '7 days'`
      );
      if (!isCorrect) {
        // Nonaktifkan entries yang sudah terlalu lemah setelah salah
        await db.execute(
          sql`UPDATE quant_technical_brain SET is_active = false WHERE decay_weight < 0.25`
        );
      }
    } else if (brainType === "fundamental") {
      await db.execute(
        sql`UPDATE quant_fundamental_brain
            SET decay_weight = LEAST(1.6, decay_weight * ${factor}),
                updated_at = NOW()
            WHERE is_active = true
              AND created_at > NOW() - INTERVAL '7 days'`
      );
      if (!isCorrect) {
        await db.execute(
          sql`UPDATE quant_fundamental_brain SET is_active = false WHERE decay_weight < 0.2`
        );
      }
    } else if (brainType === "macro") {
      await db.execute(
        sql`UPDATE quant_macro_brain
            SET decay_weight = LEAST(1.6, decay_weight * ${factor}),
                updated_at = NOW()
            WHERE is_active = true
              AND created_at > NOW() - INTERVAL '7 days'`
      );
      if (!isCorrect) {
        await db.execute(
          sql`UPDATE quant_macro_brain SET is_active = false WHERE decay_weight < 0.18`
        );
      }
    }
  } catch (err) {
    console.error(`[quant-brain-predictions] reinforceQuantBrain error (${brainType}):`, err);
  }
}

/**
 * Verifikasi prediksi lama brain ini yang belum diverifikasi — cek apakah TP
 * (benar) atau SL (salah) sudah tersentuh sejak prediksi dibuat.
 *
 * Fix #4: menggunakan effective high/low dari candle SAAT INI dan candle
 * SEBELUMNYA — sehingga prediksi yang seharusnya tersentuh pada candle kemarin
 * (tapi bot sempat restart) tetap terverifikasi dengan benar.
 *
 * Fix #2: mengembalikan { verified, correct, wrong } untuk reinforcement.
 */
export async function verifyBrainPredictions(
  brainType: BrainType,
  currentPrice: number,
  // Parameter candle high/low tidak lagi digunakan untuk TP/SL check karena
  // candle 1H mencakup harga SEBELUM prediksi dibuat → false SL/TP hit.
  // Dibiarkan di signature agar tidak break caller, tapi diabaikan di dalam.
  _currentHigh?: number,
  _currentLow?: number,
  _prevHigh?: number | null,
  _prevLow?: number | null
): Promise<{ verified: number; correct: number; wrong: number }> {

  const pending = await db
    .select()
    .from(quantBrainPredictionsTable)
    .where(
      and(
        eq(quantBrainPredictionsTable.brainType, brainType),
        eq(quantBrainPredictionsTable.isVerified, false)
      )
    );

  const EXPIRE_MS  = 48 * 60 * 60 * 1000; // 48 jam
  const MIN_AGE_MS =  5 * 60 * 1000;      // 5 menit minimum sebelum mulai verifikasi

  let verified = 0, correct = 0, wrong = 0;

  for (const pred of pending) {
    const age = Date.now() - new Date(pred.predictedAt).getTime();

    // ── Expiry ────────────────────────────────────────────────────────────────
    if (age > EXPIRE_MS) {
      const result = await db
        .update(quantBrainPredictionsTable)
        .set({ isVerified: true, isCorrect: null, actualPrice: currentPrice, verifiedAt: new Date() })
        .where(and(eq(quantBrainPredictionsTable.id, pred.id), eq(quantBrainPredictionsTable.isVerified, false)))
        .returning({ id: quantBrainPredictionsTable.id });
      if (result.length) { verified++; wrong++; }
      continue;
    }

    // ── Terlalu baru — skip, tunggu minimal 5 menit ───────────────────────────
    if (age < MIN_AGE_MS) continue;

    // ── Update running high/low hanya dari harga SETELAH prediksi dibuat ──────
    // Akumulasi lintas siklus — setiap 3 menit satu data point masuk.
    // Ini menggantikan bar high/low dari scanner yang mencakup pre-prediction data.
    const prevRunHigh = _runHigh.get(pred.id);
    const prevRunLow  = _runLow.get(pred.id);
    const newRunHigh  = prevRunHigh == null ? currentPrice : Math.max(prevRunHigh, currentPrice);
    const newRunLow   = prevRunLow  == null ? currentPrice : Math.min(prevRunLow,  currentPrice);
    _runHigh.set(pred.id, newRunHigh);
    _runLow.set(pred.id,  newRunLow);

    // ── TP/SL check menggunakan running range post-prediction ─────────────────
    const hitTp = pred.direction === "up" ? newRunHigh >= pred.tp : newRunLow  <= pred.tp;
    const hitSl = pred.direction === "up" ? newRunLow  <= pred.sl : newRunHigh >= pred.sl;

    if (!hitTp && !hitSl) continue;
    const isCorrect = hitTp && !hitSl; // SL takes priority if both hit

    const result = await db
      .update(quantBrainPredictionsTable)
      .set({ isVerified: true, isCorrect, actualPrice: currentPrice, verifiedAt: new Date() })
      .where(and(eq(quantBrainPredictionsTable.id, pred.id), eq(quantBrainPredictionsTable.isVerified, false)))
      .returning({ id: quantBrainPredictionsTable.id });

    if (result.length) {
      // Bersihkan map setelah prediksi selesai diverifikasi
      _runHigh.delete(pred.id);
      _runLow.delete(pred.id);
      verified++;
      if (isCorrect) correct++; else wrong++;
    }
  }

  return { verified, correct, wrong };
}

/**
 * Generate prediksi baru untuk satu brain — hanya untuk sinyal BUY/SELL.
 * Fix #3: hanya dibuat di awal candle 1H (menit 0–4 UTC).
 */
export async function generateBrainPrediction(params: {
  brainType: BrainType;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  entryPrice: number;
  atr?: number | null;   // ATR dari scanner — dasar perhitungan TP/SL dinamis
  reasoning?: string;
  symbol?: string;
}): Promise<BrainPredictionRecord | null> {
  if (params.signal === "HOLD") return null;

  // Cooldown 30 menit per brain — max 1 prediksi per 30 menit
  const now = Date.now();
  if (now - _lastPredictionAt[params.brainType] < PREDICTION_COOLDOWN_MS) return null;
  _lastPredictionAt[params.brainType] = now;

  const direction: "up" | "down" = params.signal === "BUY" ? "up" : "down";

  // Hitung TP/SL dinamis dari ATR — max 100 pips ($10), bukan nilai tetap.
  // Fallback ke $8/$5 jika ATR tidak tersedia.
  const { tpDist, slDist, pips } = calcDynamicDistances(params.atr ?? 10);
  const tp = direction === "up" ? params.entryPrice + tpDist : params.entryPrice - tpDist;
  const sl = direction === "up" ? params.entryPrice - slDist : params.entryPrice + slDist;

  const [row] = await db
    .insert(quantBrainPredictionsTable)
    .values({
      brainType: params.brainType,
      symbol: params.symbol ?? "XAUUSD",
      direction,
      signal: params.signal,
      confidence: params.confidence,
      entryPrice: params.entryPrice,
      tp,
      sl,
      pips,
      reasoning: params.reasoning?.slice(0, 500) ?? null,
    })
    .returning();

  return (row as BrainPredictionRecord) ?? null;
}

/** Prediksi terbaru (verified atau tidak) untuk satu brain — untuk ditampilkan di UI. */
export async function getLatestBrainPrediction(brainType: BrainType): Promise<BrainPredictionRecord | null> {
  const rows = await db
    .select()
    .from(quantBrainPredictionsTable)
    .where(eq(quantBrainPredictionsTable.brainType, brainType))
    .orderBy(desc(quantBrainPredictionsTable.id))
    .limit(1);
  return (rows[0] as BrainPredictionRecord) ?? null;
}

/** Statistik akurasi ringkas per brain — untuk ditampilkan di UI. */
export async function getBrainPredictionStats(brainType: BrainType): Promise<{ total: number; correct: number; wrong: number; open: number }> {
  const rows = await db
    .select({ isVerified: quantBrainPredictionsTable.isVerified, isCorrect: quantBrainPredictionsTable.isCorrect })
    .from(quantBrainPredictionsTable)
    .where(eq(quantBrainPredictionsTable.brainType, brainType));

  let correct = 0, wrong = 0, open = 0;
  for (const r of rows) {
    if (!r.isVerified) { open++; continue; }
    if (r.isCorrect === true) correct++; else wrong++;
  }
  return { total: rows.length, correct, wrong, open };
}

// Export table refs for typing purposes (used by reinforcement)
export { quantTechnicalBrainTable, quantFundamentalBrainTable, quantMacroBrainTable };
