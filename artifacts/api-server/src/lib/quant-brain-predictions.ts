/**
 * Quant Bot — Per-Brain Standalone Predictions
 * Setiap brain (Technical, Fundamental, Macro) membuat prediksinya SENDIRI,
 * lepas dari ensemble vote — dengan jarak SL/TP yang SAMA & ADIL untuk ketiganya:
 * 100 pips XAUUSD (1 pip gold = $0.10 → 100 pips = $10.00).
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

// Fair, fixed risk distance shared by all 3 brains — 100 pips gold ($0.10/pip).
const GOLD_PIP_VALUE = 0.1;
export const FIXED_PIPS = 100;
const FIXED_DISTANCE = FIXED_PIPS * GOLD_PIP_VALUE; // $10.00

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
  currentHigh?: number,
  currentLow?: number,
  prevHigh?: number | null,   // Fix #4: previous bar high dari scanner
  prevLow?: number | null     // Fix #4: previous bar low dari scanner
): Promise<{ verified: number; correct: number; wrong: number }> {
  const high = currentHigh ?? currentPrice;
  const low  = currentLow  ?? currentPrice;

  // Fix #4: gabungkan current + previous bar untuk effective range
  const effectiveHigh = Math.max(high, prevHigh ?? high);
  const effectiveLow  = Math.min(low,  prevLow  ?? low);

  const pending = await db
    .select()
    .from(quantBrainPredictionsTable)
    .where(
      and(
        eq(quantBrainPredictionsTable.brainType, brainType),
        eq(quantBrainPredictionsTable.isVerified, false)
      )
    );

  const EXPIRE_MS = 48 * 60 * 60 * 1000; // 48 jam — 1h timeframe prediksi gold

  let verified = 0, correct = 0, wrong = 0;

  for (const pred of pending) {
    // ── Expiry ────────────────────────────────────────────────────────────────
    const age = Date.now() - new Date(pred.predictedAt).getTime();
    if (age > EXPIRE_MS) {
      const result = await db
        .update(quantBrainPredictionsTable)
        .set({ isVerified: true, isCorrect: null, actualPrice: currentPrice, verifiedAt: new Date() })
        .where(and(eq(quantBrainPredictionsTable.id, pred.id), eq(quantBrainPredictionsTable.isVerified, false)))
        .returning({ id: quantBrainPredictionsTable.id });
      if (result.length) { verified++; wrong++; } // expired = not a win
      continue;
    }

    // ── TP/SL check (Fix #4: effectiveHigh/Low spans current + prev bar) ──────
    const hitTp = pred.direction === "up" ? effectiveHigh >= pred.tp : effectiveLow <= pred.tp;
    const hitSl = pred.direction === "up" ? effectiveLow <= pred.sl : effectiveHigh >= pred.sl;

    if (!hitTp && !hitSl) continue;
    const isCorrect = hitTp && !hitSl; // SL takes priority if both hit

    const result = await db
      .update(quantBrainPredictionsTable)
      .set({ isVerified: true, isCorrect, actualPrice: currentPrice, verifiedAt: new Date() })
      .where(and(eq(quantBrainPredictionsTable.id, pred.id), eq(quantBrainPredictionsTable.isVerified, false)))
      .returning({ id: quantBrainPredictionsTable.id });

    if (result.length) {
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
  reasoning?: string;
  symbol?: string;
}): Promise<BrainPredictionRecord | null> {
  if (params.signal === "HOLD") return null;

  // Cooldown 30 menit per brain — max 1 prediksi per 30 menit
  const now = Date.now();
  if (now - _lastPredictionAt[params.brainType] < PREDICTION_COOLDOWN_MS) return null;
  _lastPredictionAt[params.brainType] = now;

  const direction: "up" | "down" = params.signal === "BUY" ? "up" : "down";
  const tp = direction === "up" ? params.entryPrice + FIXED_DISTANCE : params.entryPrice - FIXED_DISTANCE;
  const sl = direction === "up" ? params.entryPrice - FIXED_DISTANCE : params.entryPrice + FIXED_DISTANCE;

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
      pips: FIXED_PIPS,
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
