/**
 * SahamRadar AI - Daily Picks Engine
 *
 * Setiap kali dijalankan (manual oleh admin atau terjadwal), engine ini:
 * 1. Menutup ("close") picks dari hari-hari sebelumnya yang masih "open" —
 *    profit/loss dihitung dari harga saat picks dibuat (entryPrice) vs
 *    harga terbaru di database (exitPrice).
 * 2. Jika picks untuk tanggal target belum ada, memilih saham-saham dengan
 *    probabilitas kenaikan tertinggi berdasarkan scoring algoritmik
 *    (trend + momentum + volume tinggi, risiko terkendali) dan mencatatnya
 *    sebagai picks hari itu dengan harga masuk (entryPrice) saat ini.
 */

import { db } from "@workspace/db";
import {
  stocksTable,
  stockScoresTable,
  dailyPicksTable,
} from "@workspace/db";
import { eq, and, lt, desc } from "drizzle-orm";
import { logger } from "./logger";

export const DEFAULT_INVESTMENT_PER_PICK = 10_000_000; // Rp 10 juta per saham (simulasi)
export const DEFAULT_PICKS_PER_DAY = 5;

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CandidateRow {
  ticker: string;
  name: string;
  sector: string;
  currentPrice: string;
  trendScore: string;
  momentumScore: string;
  volumeScore: string;
  riskScore: string;
  totalScore: string;
  label: string;
}

function buildReason(c: CandidateRow): string {
  const trend = parseFloat(c.trendScore);
  const momentum = parseFloat(c.momentumScore);
  const volume = parseFloat(c.volumeScore);
  const risk = parseFloat(c.riskScore);
  const parts: string[] = [];
  if (trend >= 65) parts.push(`tren teknikal kuat (skor ${trend.toFixed(0)})`);
  if (momentum >= 60) parts.push(`momentum positif (skor ${momentum.toFixed(0)})`);
  if (volume >= 60) parts.push(`volume transaksi meningkat (skor ${volume.toFixed(0)})`);
  if (risk <= 45) parts.push(`profil risiko relatif terkendali (skor ${risk.toFixed(0)})`);
  if (parts.length === 0) parts.push(`skor total algoritmik tertinggi (${parseFloat(c.totalScore).toFixed(1)})`);
  return `Terpilih karena ${parts.join(", ")}.`;
}

/**
 * Pilih kandidat saham dengan potensi kenaikan terbaik:
 * filter dulu yang trend & momentum di atas rata-rata serta risiko tidak ekstrem,
 * lalu urutkan berdasarkan total score. Jika kandidat hasil filter kurang dari
 * limit, lengkapi dari sisa saham terbaik berdasarkan total score saja.
 */
async function selectCandidates(limit: number): Promise<CandidateRow[]> {
  const rows = await db
    .select({
      ticker: stocksTable.ticker,
      name: stocksTable.name,
      sector: stocksTable.sector,
      currentPrice: stockScoresTable.currentPrice,
      trendScore: stockScoresTable.trendScore,
      momentumScore: stockScoresTable.momentumScore,
      volumeScore: stockScoresTable.volumeScore,
      riskScore: stockScoresTable.riskScore,
      totalScore: stockScoresTable.totalScore,
      label: stockScoresTable.label,
    })
    .from(stocksTable)
    .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
    .where(eq(stocksTable.isActive, true));

  const sorted = [...rows].sort((a, b) => parseFloat(b.totalScore) - parseFloat(a.totalScore));

  const strong = sorted.filter(
    (r) =>
      parseFloat(r.trendScore) >= 55 &&
      parseFloat(r.momentumScore) >= 50 &&
      parseFloat(r.riskScore) <= 65
  );

  const picked: CandidateRow[] = [];
  const seen = new Set<string>();
  for (const r of [...strong, ...sorted]) {
    if (picked.length >= limit) break;
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    picked.push(r);
  }

  return picked;
}

/**
 * Tutup semua picks yang masih "open" dan tanggalnya sebelum hari ini (benar-benar basi),
 * menggunakan harga terbaru di stock_scores sebagai exitPrice. Picks untuk hari ini
 * (atau tanggal yang akan datang) tidak pernah ditutup otomatis di sini.
 */
async function closeStalePicks(): Promise<number> {
  const today = todayStr();
  const openPicks = await db
    .select()
    .from(dailyPicksTable)
    .where(and(eq(dailyPicksTable.status, "open"), lt(dailyPicksTable.pickDate, today)));

  let closed = 0;
  for (const pick of openPicks) {
    const score = await db
      .select({ currentPrice: stockScoresTable.currentPrice })
      .from(stockScoresTable)
      .where(eq(stockScoresTable.ticker, pick.ticker))
      .limit(1);

    const exitPrice = score[0] ? parseFloat(score[0].currentPrice) : parseFloat(pick.entryPrice);
    const entryPrice = parseFloat(pick.entryPrice);
    const profitPct = entryPrice !== 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
    const investment = parseFloat(pick.investmentAmount);
    const profitAmount = (investment * profitPct) / 100;

    await db
      .update(dailyPicksTable)
      .set({
        status: "closed",
        exitPrice: String(exitPrice),
        profitPct: String(Math.round(profitPct * 10000) / 10000),
        profitAmount: String(Math.round(profitAmount * 100) / 100),
        closedAt: new Date(),
      })
      .where(eq(dailyPicksTable.id, pick.id));
    closed++;
  }

  return closed;
}

export interface GeneratePicksResult {
  date: string;
  alreadyExisted: boolean;
  picksCreated: number;
  picksClosed: number;
}

export async function generateDailyPicks(
  targetDate: string = todayStr(),
  limit: number = DEFAULT_PICKS_PER_DAY
): Promise<GeneratePicksResult> {
  const picksClosed = await closeStalePicks();

  const existing = await db
    .select()
    .from(dailyPicksTable)
    .where(eq(dailyPicksTable.pickDate, targetDate));

  if (existing.length > 0) {
    return { date: targetDate, alreadyExisted: true, picksCreated: 0, picksClosed };
  }

  const candidates = await selectCandidates(limit);

  let rank = 1;
  for (const c of candidates) {
    await db.insert(dailyPicksTable).values({
      pickDate: targetDate,
      ticker: c.ticker,
      rank,
      entryPrice: c.currentPrice,
      investmentAmount: String(DEFAULT_INVESTMENT_PER_PICK),
      status: "open",
      totalScoreAtPick: c.totalScore,
      trendScoreAtPick: c.trendScore,
      momentumScoreAtPick: c.momentumScore,
      volumeScoreAtPick: c.volumeScore,
      riskScoreAtPick: c.riskScore,
      labelAtPick: c.label,
      reason: buildReason(c),
    });
    rank++;
  }

  logger.info({ date: targetDate, picksCreated: candidates.length, picksClosed }, "Daily picks generated");

  return { date: targetDate, alreadyExisted: false, picksCreated: candidates.length, picksClosed };
}
