import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockPricesTable,
  stockFundamentalsTable,
  stockScoresTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { UploadCsvBody, RecalculateScoresBody } from "@workspace/api-zod";
import { calculateScores } from "../lib/scoring";
import { logger } from "../lib/logger";
import { fetchAllPriceHistories } from "../lib/yahoo-finance";

const router = Router();

function parseCsvRows(csvText: string): Record<string, string>[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"/, "").replace(/"$/, ""));
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"/, "").replace(/"$/, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? "";
    });
    return row;
  });
}

// ── POST /admin/upload-csv ───────────────────────────────────────────────────

router.post("/upload-csv", async (req, res) => {
  try {
    const { csvData, dataType } = UploadCsvBody.parse(req.body);
    const rows = parseCsvRows(String(csvData));

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    if (dataType === "stocks") {
      for (const row of rows) {
        try {
          const existing = await db.select().from(stocksTable).where(eq(stocksTable.ticker, row.ticker.toUpperCase())).limit(1);
          if (existing[0]) {
            await db.update(stocksTable).set({
              name: row.name || existing[0].name,
              sector: row.sector || existing[0].sector,
              description: row.description || existing[0].description,
            }).where(eq(stocksTable.ticker, row.ticker.toUpperCase()));
            updated++;
          } else {
            await db.insert(stocksTable).values({
              ticker: row.ticker.toUpperCase(),
              name: row.name,
              sector: row.sector,
              description: row.description,
            });
            inserted++;
          }
        } catch (e) {
          errors.push(`Row ${row.ticker}: ${String(e)}`);
        }
      }
    } else if (dataType === "prices") {
      for (const row of rows) {
        try {
          await db.insert(stockPricesTable).values({
            ticker: row.ticker.toUpperCase(),
            date: row.date,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: parseInt(row.volume, 10),
          }).onConflictDoNothing();
          inserted++;
        } catch (e) {
          errors.push(`Row ${row.ticker}/${row.date}: ${String(e)}`);
        }
      }
    } else if (dataType === "fundamentals") {
      for (const row of rows) {
        try {
          const existing = await db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, row.ticker.toUpperCase())).limit(1);
          const data = {
            ticker: row.ticker.toUpperCase(),
            pe: row.pe || null,
            pb: row.pb || null,
            roe: row.roe || null,
            roa: row.roa || null,
            eps: row.eps || null,
            revenue: row.revenue || null,
            netIncome: row.net_income || null,
            debtEquity: row.debt_equity || null,
            currentRatio: row.current_ratio || null,
            dividendYield: row.dividend_yield || null,
            beta: row.beta || null,
            freeCashFlow: row.free_cash_flow || null,
            marketCap: row.market_cap || null,
          };
          if (existing[0]) {
            await db.update(stockFundamentalsTable).set(data).where(eq(stockFundamentalsTable.ticker, row.ticker.toUpperCase()));
            updated++;
          } else {
            await db.insert(stockFundamentalsTable).values(data);
            inserted++;
          }
        } catch (e) {
          errors.push(`Row ${row.ticker}: ${String(e)}`);
        }
      }
    }

    res.json({
      success: errors.length === 0,
      rowsProcessed: rows.length,
      rowsInserted: inserted,
      rowsUpdated: updated,
      errors,
    });
  } catch (err) {
    req.log.error({ err }, "uploadCsv error");
    res.status(500).json({ error: "Gagal memproses CSV" });
  }
});

// ── POST /admin/recalculate-scores ──────────────────────────────────────────

router.post("/recalculate-scores", async (req, res) => {
  try {
    const { tickers } = RecalculateScoresBody.parse(req.body);

    let stocks;
    if (tickers && tickers.length > 0) {
      stocks = await db.select().from(stocksTable).where(eq(stocksTable.isActive, true));
      stocks = stocks.filter((s) => tickers.includes(s.ticker));
    } else {
      stocks = await db.select().from(stocksTable).where(eq(stocksTable.isActive, true));
    }

    let processed = 0;
    const errors: string[] = [];

    for (const stock of stocks) {
      try {
        const [prices, fund] = await Promise.all([
          db.select().from(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker)),
          db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, stock.ticker)).limit(1),
        ]);

        if (prices.length === 0) continue;

        const priceData = prices.map((p) => ({
          date: p.date,
          open: parseFloat(p.open),
          high: parseFloat(p.high),
          low: parseFloat(p.low),
          close: parseFloat(p.close),
          volume: Number(p.volume),
        }));

        const f = fund[0];
        const fundamentalData = f ? {
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
          marketCap: f.marketCap ? parseFloat(f.marketCap) : null,
        } : {};

        const scoreResult = calculateScores(priceData, fundamentalData);

        const existing = await db.select().from(stockScoresTable).where(eq(stockScoresTable.ticker, stock.ticker)).limit(1);
        const updateData = {
          ticker: stock.ticker,
          currentPrice: String(scoreResult.currentPrice),
          priceChange: String(scoreResult.priceChange),
          priceChangePct: String(scoreResult.priceChangePct),
          volume: scoreResult.volume,
          avgVolume: scoreResult.avgVolume,
          trendScore: String(scoreResult.trendScore),
          momentumScore: String(scoreResult.momentumScore),
          volumeScore: String(scoreResult.volumeScore),
          liquidityScore: String(scoreResult.liquidityScore),
          fundamentalScore: String(scoreResult.fundamentalScore),
          valuationScore: String(scoreResult.valuationScore),
          riskScore: String(scoreResult.riskScore),
          totalScore: String(scoreResult.totalScore),
          label: scoreResult.label,
          ma20: scoreResult.ma20 ? String(scoreResult.ma20) : null,
          ma50: scoreResult.ma50 ? String(scoreResult.ma50) : null,
          ma200: scoreResult.ma200 ? String(scoreResult.ma200) : null,
          rsi14: scoreResult.rsi14 ? String(scoreResult.rsi14) : null,
          supportLevel: scoreResult.supportLevel ? String(scoreResult.supportLevel) : null,
          resistanceLevel: scoreResult.resistanceLevel ? String(scoreResult.resistanceLevel) : null,
        };

        if (existing[0]) {
          await db.update(stockScoresTable).set(updateData).where(eq(stockScoresTable.ticker, stock.ticker));
        } else {
          await db.insert(stockScoresTable).values(updateData);
        }

        processed++;
      } catch (e) {
        errors.push(`${stock.ticker}: ${String(e)}`);
        logger.warn({ err: e, ticker: stock.ticker }, "Recalculate score gagal untuk saham");
      }
    }

    res.json({ success: errors.length === 0, processed, errors });
  } catch (err) {
    req.log.error({ err }, "recalculateScores error");
    res.status(500).json({ error: "Gagal menghitung ulang skor" });
  }
});

// ── POST /admin/sync-realtime ─────────────────────────────────────────────────
// Sinkronisasi harga realtime dari Yahoo Finance untuk semua saham aktif

let syncInProgress = false;
let lastSyncResult: {
  startedAt: string;
  finishedAt: string;
  updated: number;
  skipped: number;
  errors: string[];
} | null = null;

router.get("/sync-status", (_req, res) => {
  res.json({
    inProgress: syncInProgress,
    lastSync: lastSyncResult,
  });
});

router.post("/sync-realtime", async (req, res) => {
  if (syncInProgress) {
    res.status(409).json({ error: "Sync sedang berjalan, tunggu sebentar" });
    return;
  }

  syncInProgress = true;
  const startedAt = new Date().toISOString();
  req.log.info("sync-realtime: memulai sinkronisasi Yahoo Finance");

  res.json({ message: "Sync dimulai, proses berjalan di background" });

  const stocks = await db.select().from(stocksTable).where(eq(stocksTable.isActive, true));
  const tickers = stocks.map((s) => s.ticker);

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    const priceMap = await fetchAllPriceHistories(tickers, (done, total, ticker) => {
      logger.info({ done, total, ticker }, "sync-realtime: progress");
    });

    for (const stock of stocks) {
      const rows = priceMap.get(stock.ticker) ?? [];
      if (rows.length === 0) {
        skipped++;
        logger.warn({ ticker: stock.ticker }, "sync-realtime: tidak ada data, skip");
        continue;
      }

      try {
        await db.delete(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker));
        await db.insert(stockPricesTable).values(
          rows.map((r) => ({
            ticker: stock.ticker,
            date: r.date,
            open: String(r.open),
            high: String(r.high),
            low: String(r.low),
            close: String(r.close),
            volume: r.volume,
          }))
        );

        const [prices, fund] = await Promise.all([
          db.select().from(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker)),
          db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, stock.ticker)).limit(1),
        ]);

        const priceData = prices.map((p) => ({
          date: p.date,
          open: parseFloat(p.open),
          high: parseFloat(p.high),
          low: parseFloat(p.low),
          close: parseFloat(p.close),
          volume: Number(p.volume),
        }));

        const f = fund[0];
        const fundamentalData = f ? {
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
          marketCap: f.marketCap ? parseFloat(f.marketCap) : null,
        } : {};

        const scoreResult = calculateScores(priceData, fundamentalData);

        const scoreData = {
          ticker: stock.ticker,
          currentPrice: String(scoreResult.currentPrice),
          priceChange: String(scoreResult.priceChange),
          priceChangePct: String(scoreResult.priceChangePct),
          volume: scoreResult.volume,
          avgVolume: scoreResult.avgVolume,
          trendScore: String(scoreResult.trendScore),
          momentumScore: String(scoreResult.momentumScore),
          volumeScore: String(scoreResult.volumeScore),
          liquidityScore: String(scoreResult.liquidityScore),
          fundamentalScore: String(scoreResult.fundamentalScore),
          valuationScore: String(scoreResult.valuationScore),
          riskScore: String(scoreResult.riskScore),
          totalScore: String(scoreResult.totalScore),
          label: scoreResult.label,
          ma20: scoreResult.ma20 ? String(scoreResult.ma20) : null,
          ma50: scoreResult.ma50 ? String(scoreResult.ma50) : null,
          ma200: scoreResult.ma200 ? String(scoreResult.ma200) : null,
          rsi14: scoreResult.rsi14 ? String(scoreResult.rsi14) : null,
          supportLevel: scoreResult.supportLevel ? String(scoreResult.supportLevel) : null,
          resistanceLevel: scoreResult.resistanceLevel ? String(scoreResult.resistanceLevel) : null,
        };

        const existing = await db.select().from(stockScoresTable).where(eq(stockScoresTable.ticker, stock.ticker)).limit(1);
        if (existing[0]) {
          await db.update(stockScoresTable).set(scoreData).where(eq(stockScoresTable.ticker, stock.ticker));
        } else {
          await db.insert(stockScoresTable).values(scoreData);
        }

        updated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${stock.ticker}: ${msg}`);
        logger.error({ err, ticker: stock.ticker }, "sync-realtime: gagal update saham");
      }
    }
  } catch (err) {
    logger.error({ err }, "sync-realtime: fatal error");
    errors.push(String(err));
  } finally {
    syncInProgress = false;
    lastSyncResult = {
      startedAt,
      finishedAt: new Date().toISOString(),
      updated,
      skipped,
      errors,
    };
    logger.info({ updated, skipped, errorCount: errors.length }, "sync-realtime: selesai");
  }
});

export default router;
