import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockScoresTable,
  stockFundamentalsTable,
  aiReportsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CompareStocksBody } from "@workspace/api-zod";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { tickers } = CompareStocksBody.parse(req.body);

    const results = await Promise.all(
      tickers.map(async (ticker) => {
        const upperTicker = ticker.toUpperCase();
        const [stock, score, fund, aiReports] = await Promise.all([
          db.select().from(stocksTable).where(eq(stocksTable.ticker, upperTicker)).limit(1),
          db.select().from(stockScoresTable).where(eq(stockScoresTable.ticker, upperTicker)).limit(1),
          db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, upperTicker)).limit(1),
          db.select().from(aiReportsTable).where(eq(aiReportsTable.ticker, upperTicker)).orderBy(desc(aiReportsTable.generatedAt)).limit(1),
        ]);

        if (!stock[0] || !score[0]) return null;

        const s = score[0];
        const f = fund[0];
        const cp = parseFloat(s.currentPrice);

        return {
          id: stock[0].id,
          ticker: stock[0].ticker,
          name: stock[0].name,
          sector: stock[0].sector,
          description: stock[0].description,
          currentPrice: cp,
          priceChange: parseFloat(s.priceChange),
          priceChangePct: parseFloat(s.priceChangePct),
          volume: Number(s.volume),
          avgVolume: s.avgVolume ? Number(s.avgVolume) : null,
          marketCap: f?.marketCap ? parseFloat(f.marketCap) : null,
          trendScore: parseFloat(s.trendScore),
          momentumScore: parseFloat(s.momentumScore),
          volumeScore: parseFloat(s.volumeScore),
          liquidityScore: parseFloat(s.liquidityScore),
          fundamentalScore: parseFloat(s.fundamentalScore),
          valuationScore: parseFloat(s.valuationScore),
          riskScore: parseFloat(s.riskScore),
          totalScore: parseFloat(s.totalScore),
          label: s.label,
          fundamentals: f ? {
            pe: f.pe ? parseFloat(f.pe) : null,
            pb: f.pb ? parseFloat(f.pb) : null,
            roe: f.roe ? parseFloat(f.roe) : null,
            roa: f.roa ? parseFloat(f.roa) : null,
            eps: f.eps ? parseFloat(f.eps) : null,
            revenue: f.revenue ? parseFloat(f.revenue) : null,
            netIncome: f.netIncome ? parseFloat(f.netIncome) : null,
            debtEquity: f.debtEquity ? parseFloat(f.debtEquity) : null,
            currentRatio: f.currentRatio ? parseFloat(f.currentRatio) : null,
            dividendYield: f.dividendYield ? parseFloat(f.dividendYield) : null,
            beta: f.beta ? parseFloat(f.beta) : null,
            freeCashFlow: f.freeCashFlow ? parseFloat(f.freeCashFlow) : null,
          } : null,
          technicals: {
            ma20: s.ma20 ? parseFloat(s.ma20) : null,
            ma50: s.ma50 ? parseFloat(s.ma50) : null,
            ma200: s.ma200 ? parseFloat(s.ma200) : null,
            rsi14: s.rsi14 ? parseFloat(s.rsi14) : null,
            supportLevel: s.supportLevel ? parseFloat(s.supportLevel) : null,
            resistanceLevel: s.resistanceLevel ? parseFloat(s.resistanceLevel) : null,
            avgVolume20: s.avgVolume ? Number(s.avgVolume) : null,
            priceVsMa20: s.ma20 ? ((cp - parseFloat(s.ma20)) / parseFloat(s.ma20)) * 100 : null,
            priceVsMa50: s.ma50 ? ((cp - parseFloat(s.ma50)) / parseFloat(s.ma50)) * 100 : null,
            priceVsMa200: s.ma200 ? ((cp - parseFloat(s.ma200)) / parseFloat(s.ma200)) * 100 : null,
          },
          latestAiReport: aiReports[0] ? {
            summary: aiReports[0].summary,
            riskAnalysis: aiReports[0].riskAnalysis,
            bullishScenario: aiReports[0].bullishScenario,
            bearishScenario: aiReports[0].bearishScenario,
            conclusion: aiReports[0].conclusion,
            generatedAt: aiReports[0].generatedAt.toISOString(),
          } : null,
        };
      })
    );

    const validResults = results.filter((r) => r !== null);
    res.json(validResults);
  } catch (err) {
    req.log.error({ err }, "compareStocks error");
    res.status(500).json({ error: "Gagal membandingkan saham" });
  }
});

export default router;
