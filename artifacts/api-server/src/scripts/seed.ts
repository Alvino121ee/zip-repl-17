/**
 * Seed data 20 saham BEI untuk SahamRadar AI
 * Jalankan: npx tsx src/scripts/seed.ts
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

const STOCKS = [
  { ticker: "BBCA", name: "Bank Central Asia Tbk", sector: "Perbankan", description: "Bank swasta terbesar di Indonesia dengan jaringan ATM dan layanan digital terlengkap." },
  { ticker: "BBRI", name: "Bank Rakyat Indonesia Tbk", sector: "Perbankan", description: "Bank BUMN terbesar dengan fokus UMKM dan layanan di seluruh pelosok Indonesia." },
  { ticker: "BMRI", name: "Bank Mandiri Tbk", sector: "Perbankan", description: "Bank BUMN terbesar berdasarkan aset dengan layanan korporasi dan retail." },
  { ticker: "TLKM", name: "Telkom Indonesia Tbk", sector: "Telekomunikasi", description: "Perusahaan telekomunikasi BUMN terbesar di Indonesia." },
  { ticker: "ASII", name: "Astra International Tbk", sector: "Otomotif & Manufaktur", description: "Konglomerat terbesar dengan bisnis otomotif, keuangan, pertambangan, agribisnis." },
  { ticker: "UNVR", name: "Unilever Indonesia Tbk", sector: "Konsumer", description: "Produsen FMCG terkemuka dengan merek-merek ternama seperti Pepsodent, Rinso, Dove." },
  { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk", sector: "Konsumer", description: "Produsen makanan dan minuman terbesar dengan merek Indomie, Chitato, dll." },
  { ticker: "INDF", name: "Indofood Sukses Makmur Tbk", sector: "Konsumer", description: "Perusahaan induk Indofood dengan portofolio bisnis pangan terintegrasi." },
  { ticker: "ADRO", name: "Adaro Energy Indonesia Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara terbesar kedua di Indonesia dengan tambang di Kalimantan." },
  { ticker: "ITMG", name: "Indo Tambangraya Megah Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan pertambangan batu bara dengan operasi di Kalimantan." },
  { ticker: "ANTM", name: "Aneka Tambang Tbk", sector: "Pertambangan Mineral", description: "BUMN pertambangan dengan komoditas emas, nikel, dan bauksit." },
  { ticker: "MDKA", name: "Merdeka Copper Gold Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan tembaga dan emas yang sedang berkembang pesat." },
  { ticker: "BRPT", name: "Barito Pacific Tbk", sector: "Petrokimia", description: "Perusahaan petrokimia dengan kapasitas produksi besar untuk ekspor." },
  { ticker: "TPIA", name: "Chandra Asri Pacific Tbk", sector: "Petrokimia", description: "Produsen petrokimia terbesar di Indonesia, bagian dari Barito Pacific." },
  { ticker: "GOTO", name: "GoTo Gojek Tokopedia Tbk", sector: "Teknologi", description: "Ekosistem digital terbesar Indonesia mencakup Gojek, Tokopedia, dan GoFinancial." },
  { ticker: "BUKA", name: "Bukalapak.com Tbk", sector: "Teknologi", description: "Platform e-commerce dengan fokus pada warung dan mitra UMKM di seluruh Indonesia." },
  { ticker: "EXCL", name: "XL Axiata Tbk", sector: "Telekomunikasi", description: "Operator telekomunikasi terbesar ketiga di Indonesia." },
  { ticker: "ISAT", name: "Indosat Tbk", sector: "Telekomunikasi", description: "Operator telekomunikasi Indosat Ooredoo Hutchison setelah merger." },
  { ticker: "KLBF", name: "Kalbe Farma Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi terbesar di Indonesia dengan produk OTC dan resep dokter." },
  { ticker: "CPIN", name: "Charoen Pokphand Indonesia Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan agribisnis terintegrasi dengan fokus pakan ternak dan ayam." },
];

const FUNDAMENTALS: Record<string, {
  pe?: number; pb?: number; roe?: number; roa?: number; eps?: number;
  revenue?: number; netIncome?: number; debtEquity?: number; currentRatio?: number;
  dividendYield?: number; beta?: number; freeCashFlow?: number; marketCap?: number;
}> = {
  BBCA: { pe: 24.5, pb: 4.2, roe: 0.197, roa: 0.031, eps: 1105, revenue: 115e12, netIncome: 44e12, debtEquity: 0.18, currentRatio: 1.8, dividendYield: 0.015, beta: 0.72, freeCashFlow: 35e12, marketCap: 1080e12 },
  BBRI: { pe: 14.2, pb: 2.1, roe: 0.163, roa: 0.025, eps: 482, revenue: 189e12, netIncome: 60e12, debtEquity: 0.22, currentRatio: 1.6, dividendYield: 0.035, beta: 0.88, freeCashFlow: 45e12, marketCap: 740e12 },
  BMRI: { pe: 12.8, pb: 1.9, roe: 0.153, roa: 0.021, eps: 583, revenue: 168e12, netIncome: 55e12, debtEquity: 0.19, currentRatio: 1.7, dividendYield: 0.032, beta: 0.91, freeCashFlow: 42e12, marketCap: 685e12 },
  TLKM: { pe: 16.3, pb: 2.8, roe: 0.175, roa: 0.082, eps: 249, revenue: 149e12, netIncome: 24e12, debtEquity: 0.61, currentRatio: 1.2, dividendYield: 0.042, beta: 0.65, freeCashFlow: 18e12, marketCap: 390e12 },
  ASII: { pe: 11.5, pb: 1.4, roe: 0.127, roa: 0.068, eps: 580, revenue: 338e12, netIncome: 34e12, debtEquity: 0.48, currentRatio: 1.45, dividendYield: 0.038, beta: 0.95, freeCashFlow: 22e12, marketCap: 390e12 },
  UNVR: { pe: 25.8, pb: 18.5, roe: 0.485, roa: 0.315, eps: 380, revenue: 42e12, netIncome: 7.2e12, debtEquity: 1.35, currentRatio: 0.78, dividendYield: 0.068, beta: 0.52, freeCashFlow: 6.8e12, marketCap: 190e12 },
  ICBP: { pe: 18.7, pb: 3.1, roe: 0.168, roa: 0.092, eps: 450, revenue: 68e12, netIncome: 7.8e12, debtEquity: 0.52, currentRatio: 2.1, dividendYield: 0.025, beta: 0.61, freeCashFlow: 5.5e12, marketCap: 148e12 },
  INDF: { pe: 8.4, pb: 1.1, roe: 0.138, roa: 0.065, eps: 875, revenue: 108e12, netIncome: 7.6e12, debtEquity: 0.68, currentRatio: 1.85, dividendYield: 0.048, beta: 0.72, freeCashFlow: 5.2e12, marketCap: 63e12 },
  ADRO: { pe: 7.2, pb: 1.8, roe: 0.282, roa: 0.185, eps: 1850, revenue: 75e12, netIncome: 28e12, debtEquity: 0.28, currentRatio: 2.8, dividendYield: 0.092, beta: 1.25, freeCashFlow: 25e12, marketCap: 198e12 },
  ITMG: { pe: 6.8, pb: 2.2, roe: 0.345, roa: 0.228, eps: 12500, revenue: 25e12, netIncome: 8.8e12, debtEquity: 0.15, currentRatio: 3.2, dividendYield: 0.115, beta: 1.35, freeCashFlow: 7.8e12, marketCap: 35e12 },
  ANTM: { pe: 22.4, pb: 2.6, roe: 0.118, roa: 0.078, eps: 148, revenue: 48e12, netIncome: 3.5e12, debtEquity: 0.42, currentRatio: 1.95, dividendYield: 0.022, beta: 1.42, freeCashFlow: 2.8e12, marketCap: 78e12 },
  MDKA: { pe: 85.2, pb: 8.8, roe: 0.065, roa: 0.042, eps: 32, revenue: 22e12, netIncome: 1.2e12, debtEquity: 0.95, currentRatio: 1.35, dividendYield: 0, beta: 1.85, freeCashFlow: -0.8e12, marketCap: 102e12 },
  BRPT: { pe: 18.5, pb: 1.2, roe: 0.062, roa: 0.028, eps: 78, revenue: 82e12, netIncome: 2.8e12, debtEquity: 1.45, currentRatio: 1.15, dividendYield: 0.008, beta: 1.38, freeCashFlow: 1.5e12, marketCap: 52e12 },
  TPIA: { pe: 35.8, pb: 3.2, roe: 0.082, roa: 0.048, eps: 265, revenue: 42e12, netIncome: 2.5e12, debtEquity: 0.78, currentRatio: 1.62, dividendYield: 0.005, beta: 1.52, freeCashFlow: 1.2e12, marketCap: 90e12 },
  GOTO: { pb: 1.8, roe: -0.092, roa: -0.042, eps: -18, revenue: 8.5e12, netIncome: -4.2e12, debtEquity: 0.38, currentRatio: 2.85, dividendYield: 0, beta: 2.15, freeCashFlow: -5.5e12, marketCap: 85e12 },
  BUKA: { pb: 0.8, roe: -0.115, roa: -0.068, eps: -12, revenue: 4.2e12, netIncome: -2.8e12, debtEquity: 0.22, currentRatio: 3.5, dividendYield: 0, beta: 2.45, freeCashFlow: -3.2e12, marketCap: 25e12 },
  EXCL: { pe: 28.5, pb: 1.8, roe: 0.062, roa: 0.028, eps: 85, revenue: 32e12, netIncome: 1.2e12, debtEquity: 1.25, currentRatio: 0.82, dividendYield: 0.012, beta: 0.85, freeCashFlow: 0.8e12, marketCap: 34e12 },
  ISAT: { pe: 32.4, pb: 2.1, roe: 0.045, roa: 0.018, eps: 125, revenue: 58e12, netIncome: 1.8e12, debtEquity: 1.85, currentRatio: 0.72, dividendYield: 0.008, beta: 0.92, freeCashFlow: 0.5e12, marketCap: 59e12 },
  KLBF: { pe: 22.8, pb: 3.8, roe: 0.168, roa: 0.135, eps: 62, revenue: 31e12, netIncome: 3.5e12, debtEquity: 0.18, currentRatio: 4.2, dividendYield: 0.028, beta: 0.58, freeCashFlow: 2.8e12, marketCap: 80e12 },
  CPIN: { pe: 19.5, pb: 3.5, roe: 0.185, roa: 0.112, eps: 195, revenue: 68e12, netIncome: 4.8e12, debtEquity: 0.32, currentRatio: 2.25, dividendYield: 0.022, beta: 0.78, freeCashFlow: 3.5e12, marketCap: 94e12 },
};

// Harga dasar (aproksimasi harga pasar)
const BASE_PRICES: Record<string, number> = {
  BBCA: 10225, BBRI: 5850, BMRI: 7750, TLKM: 3680, ASII: 6850,
  UNVR: 2850, ICBP: 12150, INDF: 7125, ADRO: 2650, ITMG: 32400,
  ANTM: 1895, MDKA: 3120, BRPT: 1285, TPIA: 9350, GOTO: 78,
  BUKA: 155, EXCL: 2280, ISAT: 4020, KLBF: 1740, CPIN: 4420,
};

// Seed prices: generate 250 hari data historis realistis (simulasi)
function generatePriceHistory(ticker: string, basePrice: number): {
  ticker: string; date: string; open: string; high: string; low: string; close: string; volume: number;
}[] {
  const prices = [];
  let price = basePrice * 0.75; // mulai dari 75% harga saat ini 250 hari lalu

  // Volume base berdasarkan market cap / harga saham
  const fund = FUNDAMENTALS[ticker];
  const marketCap = fund?.marketCap ?? 1e14;
  const baseVolume = Math.round(marketCap / basePrice / 365 * 2);

  const today = new Date();
  for (let i = 249; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    // Skip weekend
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const dateStr = date.toISOString().slice(0, 10);

    // Trend naik gradual ke harga saat ini + random walk
    const trendFactor = 1 + (0.25 / 249); // naik 25% dalam 250 hari
    const randomFactor = 1 + (Math.random() - 0.48) * 0.032; // random ±3.2%
    const sectorShock = Math.random() < 0.03 ? (Math.random() - 0.5) * 0.05 : 0; // occasional shock

    price = price * trendFactor * randomFactor + price * sectorShock;
    price = Math.max(price, basePrice * 0.4);
    price = Math.min(price, basePrice * 1.3);

    const open = Math.round(price * (1 + (Math.random() - 0.5) * 0.005) / 25) * 25;
    const high = Math.round(Math.max(open, price * (1 + Math.random() * 0.012)) / 25) * 25;
    const low = Math.round(Math.min(open, price * (1 - Math.random() * 0.012)) / 25) * 25;
    const close = Math.round(price / 25) * 25;

    const volume = Math.round(baseVolume * (0.5 + Math.random() * 1.5));

    prices.push({ ticker, date: dateStr, open: String(open), high: String(high), low: String(low), close: String(close), volume });
  }

  return prices;
}

async function main() {
  console.log("🌱 Memulai seed data SahamRadar AI...\n");

  // 1. Insert stocks
  console.log("📈 Inserting stocks...");
  for (const stock of STOCKS) {
    await db.insert(stocksTable).values(stock).onConflictDoNothing();
  }
  console.log(`  ✓ ${STOCKS.length} saham berhasil dimasukkan`);

  // 2. Insert fundamentals
  console.log("📊 Inserting fundamentals...");
  for (const [ticker, fund] of Object.entries(FUNDAMENTALS)) {
    await db.insert(stockFundamentalsTable).values({
      ticker,
      pe: fund.pe ? String(fund.pe) : null,
      pb: fund.pb ? String(fund.pb) : null,
      roe: fund.roe != null ? String(fund.roe) : null,
      roa: fund.roa != null ? String(fund.roa) : null,
      eps: fund.eps ? String(fund.eps) : null,
      revenue: fund.revenue ? String(fund.revenue) : null,
      netIncome: fund.netIncome ? String(fund.netIncome) : null,
      debtEquity: fund.debtEquity ? String(fund.debtEquity) : null,
      currentRatio: fund.currentRatio ? String(fund.currentRatio) : null,
      dividendYield: fund.dividendYield != null ? String(fund.dividendYield) : null,
      beta: fund.beta ? String(fund.beta) : null,
      freeCashFlow: fund.freeCashFlow ? String(fund.freeCashFlow) : null,
      marketCap: fund.marketCap ? String(fund.marketCap) : null,
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${Object.keys(FUNDAMENTALS).length} fundamental data berhasil dimasukkan`);

  // 3. Insert price history
  console.log("💹 Inserting price history (250 hari per saham)...");
  let totalPrices = 0;
  for (const stock of STOCKS) {
    const basePrice = BASE_PRICES[stock.ticker] ?? 1000;
    const priceData = generatePriceHistory(stock.ticker, basePrice);

    // Delete existing prices first to avoid conflicts
    await db.delete(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker));

    // Batch insert
    if (priceData.length > 0) {
      await db.insert(stockPricesTable).values(priceData);
      totalPrices += priceData.length;
    }
  }
  console.log(`  ✓ ${totalPrices} data harga berhasil dimasukkan`);

  // 4. Calculate and insert scores
  console.log("🎯 Menghitung scoring untuk setiap saham...");
  let scoredCount = 0;
  for (const stock of STOCKS) {
    try {
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

      const score = calculateScores(priceData, fundamentalData);

      await db.insert(stockScoresTable).values({
        ticker: stock.ticker,
        currentPrice: String(score.currentPrice),
        priceChange: String(score.priceChange),
        priceChangePct: String(score.priceChangePct),
        volume: score.volume,
        avgVolume: score.avgVolume,
        trendScore: String(score.trendScore),
        momentumScore: String(score.momentumScore),
        volumeScore: String(score.volumeScore),
        liquidityScore: String(score.liquidityScore),
        fundamentalScore: String(score.fundamentalScore),
        valuationScore: String(score.valuationScore),
        riskScore: String(score.riskScore),
        totalScore: String(score.totalScore),
        label: score.label,
        ma20: score.ma20 ? String(score.ma20) : null,
        ma50: score.ma50 ? String(score.ma50) : null,
        ma200: score.ma200 ? String(score.ma200) : null,
        rsi14: score.rsi14 ? String(score.rsi14) : null,
        supportLevel: score.supportLevel ? String(score.supportLevel) : null,
        resistanceLevel: score.resistanceLevel ? String(score.resistanceLevel) : null,
      }).onConflictDoNothing();

      console.log(`  ✓ ${stock.ticker}: Score=${score.totalScore} Label="${score.label}"`);
      scoredCount++;
    } catch (err) {
      console.error(`  ✗ ${stock.ticker}: ${String(err)}`);
    }
  }

  console.log(`\n✅ Seed selesai!`);
  console.log(`   Saham: ${STOCKS.length}`);
  console.log(`   Harga: ${totalPrices}`);
  console.log(`   Scored: ${scoredCount}/${STOCKS.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed gagal:", err);
  process.exit(1);
});
