/**
 * BTC Quant Bot — Per-Brain Standalone Predictions
 * Setiap brain (Technical, Fundamental, Macro) membuat prediksinya SENDIRI
 * dengan jarak TETAP $500 (adil & sama untuk ketiganya).
 *
 * Scalping constraint: TP/SL TIDAK BOLEH lebih dari $1.000 dari harga entry.
 * Fixed distance $500 sudah dalam batas aman scalping.
 */

import { db } from "@workspace/db";
import {
  btcQuantBrainPredictionsTable,
} from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type BtcBrainType = "technical" | "fundamental" | "macro";

// Fixed fair distance untuk per-brain accuracy comparison: $500 per side
// Ini dalam batas scalping constraint ($500 < $1000 max)
export const BTC_FIXED_DISTANCE = 500; // USD

export interface BtcBrainPredictionRecord {
  id: number;
  brainType: BtcBrainType;
  predictedAt: Date;
  direction: "up" | "down";
  signal: "BUY" | "SELL";
  confidence: number;
  entryPrice: number;
  tp: number;
  sl: number;
  fixedDistance: number;
  reasoning: string | null;
  isVerified: boolean;
  isCorrect: boolean | null;
  actualPrice: number | null;
  verifiedAt: Date | null;
}

/**
 * Verifikasi prediksi lama brain yang belum diverifikasi.
 * Menggunakan high/low bar terkini untuk mendeteksi apakah TP atau SL tersentuh.
 * Jika keduanya tersentuh dalam bar yang sama → SL diprioritaskan (konservatif).
 */
export async function verifyBtcBrainPredictions(
  brainType: BtcBrainType,
  currentPrice: number,
  currentHigh?: number,
  currentLow?: number
): Promise<number> {
  const high = currentHigh ?? currentPrice;
  const low = currentLow ?? currentPrice;

  const pending = await db
    .select()
    .from(btcQuantBrainPredictionsTable)
    .where(
      and(
        eq(btcQuantBrainPredictionsTable.brainType, brainType),
        eq(btcQuantBrainPredictionsTable.isVerified, false)
      )
    )
    .orderBy(desc(btcQuantBrainPredictionsTable.predictedAt))
    .limit(20);

  const EXPIRE_MS = 4 * 60 * 60 * 1000; // 4 jam — cukup untuk timeframe 5m BTC

  let verified = 0;
  for (const pred of pending) {
    // ── Expiry: prediksi > 4 jam yang tidak tersentuh → inconclusive ─────────
    const age = Date.now() - new Date(pred.predictedAt).getTime();
    if (age > EXPIRE_MS) {
      const result = await db
        .update(btcQuantBrainPredictionsTable)
        .set({
          isVerified: true,
          isCorrect: null,
          actualPrice: currentPrice,
          verifiedAt: new Date(),
        })
        .where(
          and(
            eq(btcQuantBrainPredictionsTable.id, pred.id),
            eq(btcQuantBrainPredictionsTable.isVerified, false) // atomic guard
          )
        );
      if (result.rowCount) verified++;
      continue;
    }

    const tpHit = pred.direction === "up" ? high >= pred.tp : low <= pred.tp;
    const slHit = pred.direction === "up" ? low <= pred.sl : high >= pred.sl;

    if (tpHit || slHit) {
      const isCorrect = slHit ? false : tpHit; // SL takes priority
      const result = await db
        .update(btcQuantBrainPredictionsTable)
        .set({
          isVerified: true,
          isCorrect,
          actualPrice: currentPrice,
          verifiedAt: new Date(),
        })
        .where(
          and(
            eq(btcQuantBrainPredictionsTable.id, pred.id),
            eq(btcQuantBrainPredictionsTable.isVerified, false) // atomic guard
          )
        );
      if (result.rowCount) verified++;
    }
  }
  return verified;
}

/**
 * Generate prediksi standalone untuk satu brain.
 * TP/SL selalu tepat $BTC_FIXED_DISTANCE dari entry — adil dan konsisten.
 */
export async function generateBtcBrainPrediction(params: {
  brainType: BtcBrainType;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  entryPrice: number;
  reasoning: string;
}): Promise<void> {
  const { brainType, signal, confidence, entryPrice, reasoning } = params;

  // Skip jika sinyal HOLD atau confidence terlalu rendah
  if (signal === "HOLD" || confidence < 0.5) return;

  // Cek apakah sudah ada prediksi aktif yang belum diverifikasi dalam 5 menit terakhir
  const recent = await db
    .select({ id: btcQuantBrainPredictionsTable.id })
    .from(btcQuantBrainPredictionsTable)
    .where(
      and(
        eq(btcQuantBrainPredictionsTable.brainType, brainType),
        eq(btcQuantBrainPredictionsTable.isVerified, false)
      )
    )
    .limit(1);

  if (recent.length > 0) return; // Masih ada prediksi aktif, skip

  const direction = signal === "BUY" ? "up" : "down";
  const tp = direction === "up"
    ? entryPrice + BTC_FIXED_DISTANCE
    : entryPrice - BTC_FIXED_DISTANCE;
  const sl = direction === "up"
    ? entryPrice - BTC_FIXED_DISTANCE
    : entryPrice + BTC_FIXED_DISTANCE;

  await db.insert(btcQuantBrainPredictionsTable).values({
    brainType,
    direction,
    signal,
    confidence,
    entryPrice,
    tp,
    sl,
    fixedDistance: BTC_FIXED_DISTANCE,
    reasoning,
  });
}

/**
 * Ambil statistik akurasi per-brain: total, correct, wrong, open.
 * Expired predictions (isVerified=true, isCorrect=null) dihitung sebagai wrong
 * (konservatif — TP tidak tercapai dalam window waktu yang wajar).
 */
export async function getBtcBrainAccuracyStats(): Promise<
  Record<BtcBrainType, { total: number; correct: number; wrong: number; open: number }>
> {
  const rows = await db
    .select({
      brainType: btcQuantBrainPredictionsTable.brainType,
      isVerified: btcQuantBrainPredictionsTable.isVerified,
      isCorrect: btcQuantBrainPredictionsTable.isCorrect,
    })
    .from(btcQuantBrainPredictionsTable);

  const stats: Record<string, { total: number; correct: number; wrong: number; open: number }> = {};

  for (const r of rows) {
    const key = r.brainType as BtcBrainType;
    if (!stats[key]) stats[key] = { total: 0, correct: 0, wrong: 0, open: 0 };
    stats[key].total++;
    if (!r.isVerified) {
      stats[key].open++;
    } else if (r.isCorrect === true) {
      stats[key].correct++;
    } else {
      // isCorrect === false OR null (expired/inconclusive) → wrong
      stats[key].wrong++;
    }
  }

  return stats as Record<BtcBrainType, { total: number; correct: number; wrong: number; open: number }>;
}
