import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockPricesTable,
  stockFundamentalsTable,
  stockScoresTable,
  aiReportsTable,
} from "@workspace/db";
import { eq, and, gte, lte, ilike, or, desc, asc, sql } from "drizzle-orm";
import {
  ListStocksQueryParams,
  GetStockParams,
  GetStockPricesQueryParams,
} from "@workspace/api-zod";
import { generateAiReport } from "../lib/ai-generator";
import { calculateScores, getLabel } from "../lib/scoring";
import { logger } from "../lib/logger";

const router = Router();

// ── Helper ───────────────────────────────────────────────────────────────────

async function buildStockRow(ticker: string) {
  const [stock, score, fund] = await Promise.all([
    db.select().from(stocksTable).where(eq(stocksTable.ticker, ticker)).limit(1),
    db.select().from(stockScoresTable).where(eq(stockScoresTable.ticker, ticker)).limit(1),
    db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, ticker)).limit(1),
  ]);

  if (!stock[0] || !score[0]) return null;

  const s = score[0];
  const f = fund[0];

  return {
    id: stock[0].id,
    ticker: stock[0].ticker,
    name: stock[0].name,
    sector: stock[0].sector,
    description: stock[0].description,
    currentPrice: parseFloat(s.currentPrice),
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
    updatedAt: s.updatedAt.toISOString(),
    fundamentals: f
      ? {
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
        }
      : null,
    technicals: {
      ma20: s.ma20 ? parseFloat(s.ma20) : null,
      ma50: s.ma50 ? parseFloat(s.ma50) : null,
      ma200: s.ma200 ? parseFloat(s.ma200) : null,
      rsi14: s.rsi14 ? parseFloat(s.rsi14) : null,
      supportLevel: s.supportLevel ? parseFloat(s.supportLevel) : null,
      resistanceLevel: s.resistanceLevel ? parseFloat(s.resistanceLevel) : null,
      avgVolume20: s.avgVolume ? Number(s.avgVolume) : null,
      priceVsMa20: s.ma20 ? ((parseFloat(s.currentPrice) - parseFloat(s.ma20)) / parseFloat(s.ma20)) * 100 : null,
      priceVsMa50: s.ma50 ? ((parseFloat(s.currentPrice) - parseFloat(s.ma50)) / parseFloat(s.ma50)) * 100 : null,
      priceVsMa200: s.ma200 ? ((parseFloat(s.currentPrice) - parseFloat(s.ma200)) / parseFloat(s.ma200)) * 100 : null,
    },
  };
}

// ── GET /stocks ───────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const query = ListStocksQueryParams.parse(req.query);
    const { sector, label, minScore, maxScore, search, sortBy, sortDir, page = 1, limit = 50 } = query;

    // Join stocks + scores
    const baseQuery = db
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
        marketCap: stockFundamentalsTable.marketCap,
      })
      .from(stocksTable)
      .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .leftJoin(stockFundamentalsTable, eq(stocksTable.ticker, stockFundamentalsTable.ticker))
      .where(
        and(
          eq(stocksTable.isActive, true),
          sector ? eq(stocksTable.sector, sector) : undefined,
          label ? eq(stockScoresTable.label, label) : undefined,
          minScore != null ? gte(stockScoresTable.totalScore, String(minScore)) : undefined,
          maxScore != null ? lte(stockScoresTable.totalScore, String(maxScore)) : undefined,
          search
            ? or(
                ilike(stocksTable.ticker, `%${search}%`),
                ilike(stocksTable.name, `%${search}%`)
              )
            : undefined
        )
      );

    const allRows = await baseQuery;

    // Sort
    const sortField = sortBy ?? "totalScore";
    const dir = sortDir === "asc" ? 1 : -1;
    allRows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortField] as string | number | null | undefined;
      const bv = (b as Record<string, unknown>)[sortField] as string | number | null | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const an = typeof av === "string" ? parseFloat(av) : av;
      const bn = typeof bv === "string" ? parseFloat(bv) : bv;
      return (isNaN(Number(an)) || isNaN(Number(bn))) ? String(av).localeCompare(String(bv)) * dir : (Number(an) - Number(bn)) * dir;
    });

    const total = allRows.length;
    const offset = (page - 1) * limit;
    const paged = allRows.slice(offset, offset + limit);

    const stocks = paged.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      currentPrice: parseFloat(r.currentPrice),
      priceChange: parseFloat(r.priceChange),
      priceChangePct: parseFloat(r.priceChangePct),
      volume: Number(r.volume),
      avgVolume: r.avgVolume ? Number(r.avgVolume) : null,
      marketCap: r.marketCap ? parseFloat(r.marketCap) : null,
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

    res.json({ stocks, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "listStocks error");
    res.status(500).json({ error: "Gagal memuat daftar saham" });
  }
});

// ── GET /stocks/:ticker ──────────────────────────────────────────────────────

router.get("/:ticker", async (req, res) => {
  try {
    const { ticker } = GetStockParams.parse(req.params);
    const row = await buildStockRow(ticker.toUpperCase());

    if (!row) {
      res.status(404).json({ error: "Saham tidak ditemukan" });
      return;
    }

    // Get latest AI report
    const aiReports = await db
      .select()
      .from(aiReportsTable)
      .where(eq(aiReportsTable.ticker, ticker.toUpperCase()))
      .orderBy(desc(aiReportsTable.generatedAt))
      .limit(1);

    const latestAiReport = aiReports[0]
      ? {
          summary: aiReports[0].summary,
          riskAnalysis: aiReports[0].riskAnalysis,
          bullishScenario: aiReports[0].bullishScenario,
          bearishScenario: aiReports[0].bearishScenario,
          conclusion: aiReports[0].conclusion,
          generatedAt: aiReports[0].generatedAt.toISOString(),
        }
      : null;

    res.json({ ...row, latestAiReport });
  } catch (err) {
    req.log.error({ err }, "getStock error");
    res.status(500).json({ error: "Gagal memuat detail saham" });
  }
});

// ── GET /stocks/:ticker/prices ───────────────────────────────────────────────

router.get("/:ticker/prices", async (req, res) => {
  try {
    const { ticker } = GetStockParams.parse(req.params);
    const queryParsed = GetStockPricesQueryParams.parse(req.query);
    const period = queryParsed.period ?? "3M";

    const periodDays: Record<string, number> = {
      "1M": 30,
      "3M": 90,
      "6M": 180,
      "1Y": 365,
      "3Y": 1095,
    };
    const days = periodDays[period] ?? 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    const prices = await db
      .select()
      .from(stockPricesTable)
      .where(
        and(
          eq(stockPricesTable.ticker, ticker.toUpperCase()),
          gte(stockPricesTable.date, cutoff)
        )
      )
      .orderBy(asc(stockPricesTable.date));

    res.json(
      prices.map((p) => ({
        date: p.date,
        open: parseFloat(p.open),
        high: parseFloat(p.high),
        low: parseFloat(p.low),
        close: parseFloat(p.close),
        volume: Number(p.volume),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "getStockPrices error");
    res.status(500).json({ error: "Gagal memuat data harga" });
  }
});

// ── GET /stocks/:ticker/technicals ──────────────────────────────────────────

router.get("/:ticker/technicals", async (req, res) => {
  try {
    const { ticker } = GetStockParams.parse(req.params);
    const score = await db
      .select()
      .from(stockScoresTable)
      .where(eq(stockScoresTable.ticker, ticker.toUpperCase()))
      .limit(1);

    if (!score[0]) {
      res.status(404).json({ error: "Data teknikal tidak ditemukan" });
      return;
    }

    const s = score[0];
    const cp = parseFloat(s.currentPrice);
    res.json({
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
    });
  } catch (err) {
    req.log.error({ err }, "getStockTechnicals error");
    res.status(500).json({ error: "Gagal memuat data teknikal" });
  }
});

// ── POST/GET /stocks/:ticker/ai-report ──────────────────────────────────────

router.get("/:ticker/ai-report", async (req, res) => {
  try {
    const { ticker } = GetStockParams.parse(req.params);
    const reports = await db
      .select()
      .from(aiReportsTable)
      .where(eq(aiReportsTable.ticker, ticker.toUpperCase()))
      .orderBy(desc(aiReportsTable.generatedAt))
      .limit(1);

    if (!reports[0]) {
      res.status(404).json({ error: "AI report belum tersedia. Silakan generate terlebih dahulu." });
      return;
    }

    const r = reports[0];
    const ageHours = (Date.now() - r.generatedAt.getTime()) / 3600000;
    res.json({
      id: r.id,
      ticker: r.ticker,
      summary: r.summary,
      riskAnalysis: r.riskAnalysis,
      bullishScenario: r.bullishScenario,
      bearishScenario: r.bearishScenario,
      conclusion: r.conclusion,
      generatedAt: r.generatedAt.toISOString(),
      isStale: ageHours > 24,
    });
  } catch (err) {
    req.log.error({ err }, "getAiReport error");
    res.status(500).json({ error: "Gagal memuat AI report" });
  }
});

router.post("/:ticker/ai-report", async (req, res) => {
  try {
    const { ticker } = GetStockParams.parse(req.params);
    const row = await buildStockRow(ticker.toUpperCase());

    if (!row) {
      res.status(404).json({ error: "Saham tidak ditemukan" });
      return;
    }

    const ctx = {
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      currentPrice: row.currentPrice,
      priceChangePct: row.priceChangePct,
      trendScore: row.trendScore,
      momentumScore: row.momentumScore,
      volumeScore: row.volumeScore,
      liquidityScore: row.liquidityScore,
      fundamentalScore: row.fundamentalScore,
      valuationScore: row.valuationScore,
      riskScore: row.riskScore,
      totalScore: row.totalScore,
      label: row.label,
      ma20: row.technicals.ma20,
      ma50: row.technicals.ma50,
      ma200: row.technicals.ma200,
      rsi14: row.technicals.rsi14,
      supportLevel: row.technicals.supportLevel,
      resistanceLevel: row.technicals.resistanceLevel,
      pe: row.fundamentals?.pe,
      pb: row.fundamentals?.pb,
      roe: row.fundamentals?.roe,
      debtEquity: row.fundamentals?.debtEquity,
      eps: row.fundamentals?.eps,
      dividendYield: row.fundamentals?.dividendYield,
      beta: row.fundamentals?.beta,
    };

    const content = await generateAiReport(ctx);

    const [inserted] = await db
      .insert(aiReportsTable)
      .values({
        ticker: ticker.toUpperCase(),
        summary: content.summary,
        riskAnalysis: content.riskAnalysis,
        bullishScenario: content.bullishScenario,
        bearishScenario: content.bearishScenario,
        conclusion: content.conclusion,
      })
      .returning();

    res.json({
      id: inserted.id,
      ticker: inserted.ticker,
      summary: inserted.summary,
      riskAnalysis: inserted.riskAnalysis,
      bullishScenario: inserted.bullishScenario,
      bearishScenario: inserted.bearishScenario,
      conclusion: inserted.conclusion,
      generatedAt: inserted.generatedAt.toISOString(),
      isStale: false,
    });
  } catch (err) {
    req.log.error({ err }, "generateAiReport error");
    res.status(500).json({ error: "Gagal generate AI report" });
  }
});

export default router;
