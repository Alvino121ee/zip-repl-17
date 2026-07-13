/**
 * Quant Bot — Per-Brain Standalone Predictions
 * Setiap brain (Technical, Fundamental, Macro) membuat prediksinya SENDIRI,
 * lepas dari ensemble vote — dengan jarak SL/TP yang SAMA & ADIL untuk ketiganya:
 * 100 pips XAUUSD (1 pip gold = $0.10 → 100 pips = $10.00).
 * Setiap cycle brain berjalan, brain juga memverifikasi prediksi lamanya sendiri
 * lalu membuat prediksi baru — sehingga prediksi terus digenerate tanpa henti.
 */

import { db } from "@workspace/db";
import { quantBrainPredictionsTable } from "@workspace/db/schema";
import { and, desc, eq } from "drizzle-orm";

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

/**
 * Verifikasi prediksi lama brain ini yang belum diverifikasi — cek apakah TP
 * (benar) atau SL (salah) sudah tersentuh sejak prediksi dibuat.
 *
 * Menggunakan high/low bar terkini (bukan cuma harga close) — sama seperti
 * konvensi di xauusd-brain-engine.ts — supaya pergerakan intra-bar yang
 * menyentuh TP/SL tidak terlewat. Jika kedua level tersentuh dalam bar yang
 * sama, SL diprioritaskan (asumsi konservatif: risk-first, tidak ada
 * look-ahead intrabar yang pasti urutannya).
 */
export async function verifyBrainPredictions(
  brainType: BrainType,
  currentPrice: number,
  currentHigh?: number,
  currentLow?: number
): Promise<number> {
  const high = currentHigh ?? currentPrice;
  const low = currentLow ?? currentPrice;

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

  let verifiedCount = 0;
  for (const pred of pending) {
    // ── Expiry: prediksi > 48 jam yang tidak tersentuh TP/SL → inconclusive ────
    const age = Date.now() - new Date(pred.predictedAt).getTime();
    if (age > EXPIRE_MS) {
      const result = await db
        .update(quantBrainPredictionsTable)
        .set({
          isVerified: true,
          isCorrect: null,
          actualPrice: currentPrice,
          verifiedAt: new Date(),
        })
        .where(
          and(
            eq(quantBrainPredictionsTable.id, pred.id),
            eq(quantBrainPredictionsTable.isVerified, false)
          )
        )
        .returning({ id: quantBrainPredictionsTable.id });
      if (result.length) verifiedCount++;
      continue;
    }

    const hitTp = pred.direction === "up" ? high >= pred.tp : low <= pred.tp;
    const hitSl = pred.direction === "up" ? low <= pred.sl : high >= pred.sl;

    if (!hitTp && !hitSl) continue; // still open — leave for next cycle
    // Both touched in same bar: SL takes priority (conservative, no ordering info).
    const isCorrect = hitTp && !hitSl;

    // Guard against a concurrent cycle already verifying this row (avoid double-count).
    const result = await db
      .update(quantBrainPredictionsTable)
      .set({
        isVerified: true,
        isCorrect,
        actualPrice: currentPrice,
        verifiedAt: new Date(),
      })
      .where(
        and(
          eq(quantBrainPredictionsTable.id, pred.id),
          eq(quantBrainPredictionsTable.isVerified, false)
        )
      )
      .returning({ id: quantBrainPredictionsTable.id });
    if (result.length) verifiedCount++;
  }
  return verifiedCount;
}

/**
 * Generate prediksi baru untuk satu brain — hanya untuk sinyal BUY/SELL
 * (HOLD tidak punya arah untuk dihitung TP/SL-nya).
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
    if (r.isCorrect) correct++; else wrong++;
  }
  return { total: rows.length, correct, wrong, open };
}
