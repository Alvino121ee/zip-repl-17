import { Router } from "express";
import { db } from "@workspace/db";
import {
  watchlistsTable,
  stocksTable,
  stockScoresTable,
  stockFundamentalsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { AddToWatchlistBody, RemoveFromWatchlistParams, GetWatchlistQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const parsed = GetWatchlistQueryParams.parse(req.query);
    const userId = parsed.userId ?? "guest";

    const items = await db
      .select({
        id: watchlistsTable.id,
        userId: watchlistsTable.userId,
        ticker: watchlistsTable.ticker,
        addedAt: watchlistsTable.addedAt,
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
        marketCap: stockFundamentalsTable.marketCap,
      })
      .from(watchlistsTable)
      .innerJoin(stocksTable, eq(stocksTable.ticker, watchlistsTable.ticker))
      .innerJoin(stockScoresTable, eq(stockScoresTable.ticker, watchlistsTable.ticker))
      .leftJoin(stockFundamentalsTable, eq(stockFundamentalsTable.ticker, watchlistsTable.ticker))
      .where(eq(watchlistsTable.userId, String(userId)));

    res.json(
      items.map((item) => ({
        id: item.id,
        userId: item.userId,
        ticker: item.ticker,
        addedAt: item.addedAt.toISOString(),
        stock: {
          id: 0,
          ticker: item.ticker,
          name: item.name,
          sector: item.sector,
          currentPrice: parseFloat(item.currentPrice),
          priceChange: parseFloat(item.priceChange),
          priceChangePct: parseFloat(item.priceChangePct),
          volume: Number(item.volume),
          avgVolume: item.avgVolume ? Number(item.avgVolume) : null,
          marketCap: item.marketCap ? parseFloat(item.marketCap) : null,
          trendScore: parseFloat(item.trendScore),
          momentumScore: parseFloat(item.momentumScore),
          volumeScore: parseFloat(item.volumeScore),
          liquidityScore: parseFloat(item.liquidityScore),
          fundamentalScore: parseFloat(item.fundamentalScore),
          valuationScore: parseFloat(item.valuationScore),
          riskScore: parseFloat(item.riskScore),
          totalScore: parseFloat(item.totalScore),
          label: item.label,
          updatedAt: item.updatedAt.toISOString(),
        },
      }))
    );
  } catch (err) {
    req.log.error({ err }, "getWatchlist error");
    res.status(500).json({ error: "Gagal memuat watchlist" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = AddToWatchlistBody.parse(req.body);
    const { userId, ticker } = body;

    // Check if already exists
    const existing = await db
      .select()
      .from(watchlistsTable)
      .where(and(eq(watchlistsTable.userId, String(userId)), eq(watchlistsTable.ticker, String(ticker).toUpperCase())))
      .limit(1);

    if (existing[0]) {
      res.status(400).json({ error: "Saham sudah ada di watchlist" });
      return;
    }

    const [inserted] = await db
      .insert(watchlistsTable)
      .values({ userId: String(userId), ticker: String(ticker).toUpperCase() })
      .returning();

    res.status(201).json({
      id: inserted.id,
      userId: inserted.userId,
      ticker: inserted.ticker,
      addedAt: inserted.addedAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "addToWatchlist error");
    res.status(500).json({ error: "Gagal menambah ke watchlist" });
  }
});

router.delete("/:ticker", async (req, res) => {
  try {
    const { ticker } = RemoveFromWatchlistParams.parse(req.params);
    const { userId = "guest" } = req.query;

    await db
      .delete(watchlistsTable)
      .where(
        and(
          eq(watchlistsTable.userId, String(userId)),
          eq(watchlistsTable.ticker, String(ticker).toUpperCase())
        )
      );

    res.json({ success: true, message: "Dihapus dari watchlist" });
  } catch (err) {
    req.log.error({ err }, "removeFromWatchlist error");
    res.status(500).json({ error: "Gagal menghapus dari watchlist" });
  }
});

export default router;
