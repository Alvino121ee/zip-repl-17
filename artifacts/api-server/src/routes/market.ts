import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockScoresTable,
} from "@workspace/db";
import { eq, sql, desc, asc } from "drizzle-orm";

const router = Router();

// ── GET /market/summary ──────────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  try {
    const rows = await db
      .select({
        priceChangePct: stockScoresTable.priceChangePct,
        totalScore: stockScoresTable.totalScore,
        label: stockScoresTable.label,
      })
      .from(stockScoresTable)
      .innerJoin(stocksTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .where(eq(stocksTable.isActive, true));

    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let strongWatchlist = 0;
    let watchlist = 0;
    let neutral = 0;
    let risky = 0;
    let avoid = 0;
    let totalScoreSum = 0;

    for (const r of rows) {
      const pct = parseFloat(r.priceChangePct);
      if (pct > 0.01) advancers++;
      else if (pct < -0.01) decliners++;
      else unchanged++;

      totalScoreSum += parseFloat(r.totalScore);

      switch (r.label) {
        case "Strong Watchlist": strongWatchlist++; break;
        case "Watchlist": watchlist++; break;
        case "Neutral": neutral++; break;
        case "Risky": risky++; break;
        case "Avoid": avoid++; break;
      }
    }

    const avgScore = rows.length > 0 ? totalScoreSum / rows.length : 0;
    const sentiment =
      avgScore >= 65 ? "Bullish" :
      avgScore >= 55 ? "Mixed Bullish" :
      avgScore >= 45 ? "Netral" :
      avgScore >= 35 ? "Mixed Bearish" : "Bearish";

    res.json({
      totalStocks: rows.length,
      advancers,
      decliners,
      unchanged,
      avgTotalScore: Math.round(avgScore * 100) / 100,
      strongWatchlistCount: strongWatchlist,
      watchlistCount: watchlist,
      neutralCount: neutral,
      riskyCount: risky,
      avoidCount: avoid,
      marketSentiment: sentiment,
    });
  } catch (err) {
    req.log.error({ err }, "getMarketSummary error");
    res.status(500).json({ error: "Gagal memuat ringkasan pasar" });
  }
});

// ── GET /market/top-movers ───────────────────────────────────────────────────

router.get("/top-movers", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: stocksTable.id,
        ticker: stocksTable.ticker,
        name: stocksTable.name,
        sector: stocksTable.sector,
        currentPrice: stockScoresTable.currentPrice,
        priceChange: stockScoresTable.priceChange,
        priceChangePct: stockScoresTable.priceChangePct,
        volume: stockScoresTable.volume,
        avgVolume: stockScoresTable.avgVolume,
        trendScore: stockScoresTable.trendScore,
        momentumScore: stockScoresTable.momentumScore,
        volumeScore: stockScoresTable.volumeScore,
        liquidityScore: stockScoresTable.liquidityScore,
        fundamentalScore: stockScoresTable.fundamentalScore,
        valuationScore: stockScoresTable.valuationScore,
        riskScore: stockScoresTable.riskScore,
        totalScore: stockScoresTable.totalScore,
        label: stockScoresTable.label,
        updatedAt: stockScoresTable.updatedAt,
      })
      .from(stocksTable)
      .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .where(eq(stocksTable.isActive, true));

    const mapped = rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      currentPrice: parseFloat(r.currentPrice),
      priceChange: parseFloat(r.priceChange),
      priceChangePct: parseFloat(r.priceChangePct),
      volume: Number(r.volume),
      avgVolume: r.avgVolume ? Number(r.avgVolume) : null,
      trendScore: parseFloat(r.trendScore),
      momentumScore: parseFloat(r.momentumScore),
      volumeScore: parseFloat(r.volumeScore),
      liquidityScore: parseFloat(r.liquidityScore),
      fundamentalScore: parseFloat(r.fundamentalScore),
      valuationScore: parseFloat(r.valuationScore),
      riskScore: parseFloat(r.riskScore),
      totalScore: parseFloat(r.totalScore),
      label: r.label,
      updatedAt: r.updatedAt.toISOString(),
    }));

    const sorted = [...mapped].sort((a, b) => b.priceChangePct - a.priceChangePct);
    const gainers = sorted.slice(0, 5);
    const losers = sorted.slice(-5).reverse();

    res.json({ gainers, losers });
  } catch (err) {
    req.log.error({ err }, "getTopMovers error");
    res.status(500).json({ error: "Gagal memuat top movers" });
  }
});

// ── GET /market/sector-performance ──────────────────────────────────────────

router.get("/sector-performance", async (req, res) => {
  try {
    const rows = await db
      .select({
        sector: stocksTable.sector,
        totalScore: stockScoresTable.totalScore,
        priceChangePct: stockScoresTable.priceChangePct,
      })
      .from(stocksTable)
      .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .where(eq(stocksTable.isActive, true));

    const sectors: Record<string, { scores: number[]; changes: number[] }> = {};
    for (const r of rows) {
      if (!sectors[r.sector]) sectors[r.sector] = { scores: [], changes: [] };
      sectors[r.sector].scores.push(parseFloat(r.totalScore));
      sectors[r.sector].changes.push(parseFloat(r.priceChangePct));
    }

    const result = Object.entries(sectors).map(([sector, data]) => ({
      sector,
      stockCount: data.scores.length,
      avgScore: Math.round((data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 100) / 100,
      avgChange: Math.round((data.changes.reduce((a, b) => a + b, 0) / data.changes.length) * 10000) / 10000,
    }));

    result.sort((a, b) => b.avgScore - a.avgScore);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getSectorPerformance error");
    res.status(500).json({ error: "Gagal memuat performa sektor" });
  }
});

// ── GET /market/label-distribution ──────────────────────────────────────────

router.get("/label-distribution", async (req, res) => {
  try {
    const rows = await db
      .select({ label: stockScoresTable.label, count: sql<number>`count(*)` })
      .from(stockScoresTable)
      .innerJoin(stocksTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .where(eq(stocksTable.isActive, true))
      .groupBy(stockScoresTable.label);

    const order = ["Strong Watchlist", "Watchlist", "Neutral", "Risky", "Avoid"];
    const result = rows
      .map((r) => ({ label: r.label, count: Number(r.count) }))
      .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getLabelDistribution error");
    res.status(500).json({ error: "Gagal memuat distribusi label" });
  }
});

export default router;
