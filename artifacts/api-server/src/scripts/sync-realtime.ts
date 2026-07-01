/**
 * Sync data harga realtime dari Yahoo Finance ke database
 * Jalankan: cd artifacts/api-server && ../../scripts/node_modules/.bin/tsx src/scripts/sync-realtime.ts
 */

import { db } from "@workspace/db";
import {
  stocksTable,
  stockPricesTable,
  stockFundamentalsTable,
  stockScoresTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { calculateScores } from "../lib/scoring";
import { fetchAllPriceHistories } from "../lib/yahoo-finance";

async function main() {
  console.log("🔄 Sync data realtime dari Yahoo Finance...\n");

  const stocks = await db.select().from(stocksTable).where(eq(stocksTable.isActive, true));
  const tickers = stocks.map((s) => s.ticker);
  console.log(`📋 ${tickers.length} saham akan disync`);

  console.log("📡 Mengambil data harga dari Yahoo Finance...");
  const priceMap = await fetchAllPriceHistories(tickers, (done, total, ticker) => {
    process.stdout.write(`\r  [${done}/${total}] ${ticker}        `);
  });
  console.log(`\n  ✓ Selesai mengambil data harga`);

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const stock of stocks) {
    const rows = priceMap.get(stock.ticker) ?? [];
    if (rows.length === 0) {
      console.warn(`  ⚠ Skip ${stock.ticker}: tidak ada data dari Yahoo Finance`);
      skipped++;
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
      console.log(`  ✓ ${stock.ticker}: ${rows.length} hari | harga ${scoreResult.currentPrice.toLocaleString("id-ID")} | skor ${scoreResult.totalScore}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${stock.ticker}: ${msg}`);
      console.error(`  ✗ ${stock.ticker}: ${msg}`);
    }
  }

  console.log(`\n✅ Selesai! Updated: ${updated}, Skipped: ${skipped}, Error: ${errors.length}`);
  if (errors.length > 0) {
    console.log("Errors:", errors);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
