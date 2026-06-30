import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockScoresTable,
  stockFundamentalsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { GetRiskRadarQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const parsed = GetRiskRadarQueryParams.parse(req.query);
    const limit = parsed.limit ?? 20;

    const rows = await db
      .select({
        ticker: stocksTable.ticker,
        name: stocksTable.name,
        sector: stocksTable.sector,
        currentPrice: stockScoresTable.currentPrice,
        priceChangePct: stockScoresTable.priceChangePct,
        volume: stockScoresTable.volume,
        avgVolume: stockScoresTable.avgVolume,
        riskScore: stockScoresTable.riskScore,
        totalScore: stockScoresTable.totalScore,
        label: stockScoresTable.label,
        debtEquity: stockFundamentalsTable.debtEquity,
        beta: stockFundamentalsTable.beta,
        currentRatio: stockFundamentalsTable.currentRatio,
        rsi14: stockScoresTable.rsi14,
      })
      .from(stocksTable)
      .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .leftJoin(stockFundamentalsTable, eq(stocksTable.ticker, stockFundamentalsTable.ticker))
      .where(eq(stocksTable.isActive, true))
      .orderBy(desc(stockScoresTable.riskScore))
      .limit(Number(limit));

    const result = rows.map((r) => {
      const riskFlags: string[] = [];
      const de = r.debtEquity ? parseFloat(r.debtEquity) : null;
      const beta = r.beta ? parseFloat(r.beta) : null;
      const cr = r.currentRatio ? parseFloat(r.currentRatio) : null;
      const rsi = r.rsi14 ? parseFloat(r.rsi14) : null;
      const riskScore = parseFloat(r.riskScore);

      if (de && de > 2) riskFlags.push(`Debt/Equity tinggi (${de.toFixed(2)})`);
      if (beta && beta > 1.5) riskFlags.push(`Beta tinggi (${beta.toFixed(2)}) — fluktuatif`);
      if (cr && cr < 1) riskFlags.push(`Likuiditas ketat (Current Ratio ${cr.toFixed(2)})`);
      if (rsi && rsi > 75) riskFlags.push(`Overbought (RSI ${rsi.toFixed(1)})`);
      if (rsi && rsi < 25) riskFlags.push(`Oversold (RSI ${rsi.toFixed(1)})`);
      if (riskScore >= 70) riskFlags.push("Volatilitas harga tinggi");
      if (parseFloat(r.totalScore) < 40) riskFlags.push("Skor total rendah");

      // Hitung volatilitas estimasi dari beta atau risk score
      const volatility = beta ? beta * 0.15 : riskScore / 100 * 0.25;

      return {
        ticker: r.ticker,
        name: r.name,
        sector: r.sector,
        currentPrice: parseFloat(r.currentPrice),
        priceChangePct: parseFloat(r.priceChangePct),
        riskScore: riskScore,
        totalScore: parseFloat(r.totalScore),
        label: r.label,
        riskFlags,
        volume: Number(r.volume),
        volatility: Math.round(volatility * 10000) / 10000,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "getRiskRadar error");
    res.status(500).json({ error: "Gagal memuat risk radar" });
  }
});

export default router;
