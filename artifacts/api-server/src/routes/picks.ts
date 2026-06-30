import { Router } from "express";
import { db } from "@workspace/db";
import { stocksTable, dailyPicksTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { GetPicksHistoryQueryParams, GetPicksReportParams } from "@workspace/api-zod";
import { generateDailyPicks, todayStr } from "../lib/picks";
import { logger } from "../lib/logger";

const router = Router();

function mapPick(p: typeof dailyPicksTable.$inferSelect, name?: string, sector?: string) {
  return {
    id: p.id,
    pickDate: p.pickDate,
    ticker: p.ticker,
    name: name ?? p.ticker,
    sector: sector ?? "",
    rank: p.rank,
    entryPrice: parseFloat(p.entryPrice),
    exitPrice: p.exitPrice != null ? parseFloat(p.exitPrice) : null,
    investmentAmount: parseFloat(p.investmentAmount),
    profitAmount: p.profitAmount != null ? parseFloat(p.profitAmount) : null,
    profitPct: p.profitPct != null ? parseFloat(p.profitPct) : null,
    status: p.status,
    totalScoreAtPick: parseFloat(p.totalScoreAtPick),
    trendScoreAtPick: p.trendScoreAtPick != null ? parseFloat(p.trendScoreAtPick) : null,
    momentumScoreAtPick: p.momentumScoreAtPick != null ? parseFloat(p.momentumScoreAtPick) : null,
    volumeScoreAtPick: p.volumeScoreAtPick != null ? parseFloat(p.volumeScoreAtPick) : null,
    riskScoreAtPick: p.riskScoreAtPick != null ? parseFloat(p.riskScoreAtPick) : null,
    labelAtPick: p.labelAtPick,
    reason: p.reason,
    closedAt: p.closedAt ? p.closedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

async function withStockMeta(picks: (typeof dailyPicksTable.$inferSelect)[]) {
  if (picks.length === 0) return [];
  const tickers = [...new Set(picks.map((p) => p.ticker))];
  const stocks = await db.select().from(stocksTable);
  const byTicker = new Map(stocks.map((s) => [s.ticker, s]));
  return picks.map((p) => {
    const s = byTicker.get(p.ticker);
    return mapPick(p, s?.name, s?.sector);
  });
}

function aggregate(picks: (typeof dailyPicksTable.$inferSelect)[]) {
  const closed = picks.filter((p) => p.status === "closed");
  const totalProfitAmount = closed.reduce((sum, p) => sum + (p.profitAmount != null ? parseFloat(p.profitAmount) : 0), 0);
  const avgProfitPct = closed.length > 0
    ? closed.reduce((sum, p) => sum + (p.profitPct != null ? parseFloat(p.profitPct) : 0), 0) / closed.length
    : 0;
  const winners = closed.filter((p) => (p.profitPct != null ? parseFloat(p.profitPct) : 0) > 0);
  const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;

  return {
    totalPicks: picks.length,
    closedPicks: closed.length,
    openPicks: picks.length - closed.length,
    totalProfitAmount: Math.round(totalProfitAmount * 100) / 100,
    avgProfitPct: Math.round(avgProfitPct * 10000) / 10000,
    winRate: Math.round(winRate * 100) / 100,
    winners: winners.length,
  };
}

// ── POST /picks/generate ──────────────────────────────────────────────────────

router.post("/generate", async (req, res) => {
  try {
    const date = typeof req.body?.date === "string" && req.body.date ? req.body.date : todayStr();
    const result = await generateDailyPicks(date);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "generateDailyPicks error");
    res.status(500).json({ error: "Gagal generate picks harian" });
  }
});

// ── GET /picks/today ───────────────────────────────────────────────────────

router.get("/today", async (req, res) => {
  try {
    const date = todayStr();
    let picks = await db.select().from(dailyPicksTable).where(eq(dailyPicksTable.pickDate, date));

    if (picks.length === 0) {
      await generateDailyPicks(date);
      picks = await db.select().from(dailyPicksTable).where(eq(dailyPicksTable.pickDate, date));
    }

    const mapped = await withStockMeta(picks.sort((a, b) => a.rank - b.rank));
    res.json({ date, picks: mapped, summary: aggregate(picks) });
  } catch (err) {
    req.log.error({ err }, "getTodayPicks error");
    res.status(500).json({ error: "Gagal memuat picks hari ini" });
  }
});

// ── GET /picks/history ───────────────────────────────────────────────────────

router.get("/history", async (req, res) => {
  try {
    const query = GetPicksHistoryQueryParams.parse(req.query);
    const limit = query.limit ?? 30;

    const allPicks = await db.select().from(dailyPicksTable);
    const byDate = new Map<string, (typeof dailyPicksTable.$inferSelect)[]>();
    for (const p of allPicks) {
      if (!byDate.has(p.pickDate)) byDate.set(p.pickDate, []);
      byDate.get(p.pickDate)!.push(p);
    }

    const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a)).slice(0, limit);
    const result = dates.map((date) => {
      const picks = byDate.get(date)!;
      const agg = aggregate(picks);
      return { date, ...agg };
    });

    const allClosed = allPicks.filter((p) => p.status === "closed");
    const cumulativeProfitAmount = allClosed.reduce((s, p) => s + (p.profitAmount != null ? parseFloat(p.profitAmount) : 0), 0);

    res.json({
      days: result,
      cumulativeProfitAmount: Math.round(cumulativeProfitAmount * 100) / 100,
      totalDays: byDate.size,
    });
  } catch (err) {
    req.log.error({ err }, "getPicksHistory error");
    res.status(500).json({ error: "Gagal memuat riwayat picks" });
  }
});

// ── GET /picks/report/:date ──────────────────────────────────────────────────

router.get("/report/:date", async (req, res) => {
  try {
    const { date } = GetPicksReportParams.parse(req.params);
    const picks = await db
      .select()
      .from(dailyPicksTable)
      .where(eq(dailyPicksTable.pickDate, date));

    if (picks.length === 0) {
      res.status(404).json({ error: "Tidak ada laporan untuk tanggal ini" });
      return;
    }

    const mapped = await withStockMeta(picks.sort((a, b) => a.rank - b.rank));
    res.json({ date, picks: mapped, summary: aggregate(picks) });
  } catch (err) {
    req.log.error({ err }, "getPicksReport error");
    res.status(500).json({ error: "Gagal memuat laporan harian" });
  }
});

export default router;
