/**
 * SahamRadar AI - Scoring Engine
 * 
 * Bobot scoring:
 * - Trend Score:       20%
 * - Momentum Score:    15%
 * - Volume Score:      15%
 * - Liquidity Score:   10%
 * - Fundamental Score: 20%
 * - Valuation Score:   10%
 * - Risk Score (inv):  10%
 */

export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FundamentalData {
  pe?: number | null;
  pb?: number | null;
  roe?: number | null;
  roa?: number | null;
  eps?: number | null;
  revenue?: number | null;
  netIncome?: number | null;
  debtEquity?: number | null;
  currentRatio?: number | null;
  dividendYield?: number | null;
  beta?: number | null;
  freeCashFlow?: number | null;
  marketCap?: number | null;
}

export interface ScoreResult {
  currentPrice: number;
  priceChange: number;
  priceChangePct: number;
  volume: number;
  avgVolume: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  liquidityScore: number;
  fundamentalScore: number;
  valuationScore: number;
  riskScore: number;
  totalScore: number;
  label: string;
  ma20: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  supportLevel: number | null;
  resistanceLevel: number | null;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function calcMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const diff = recent[i] - recent[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function getLabel(totalScore: number): string {
  if (totalScore >= 80) return "Strong Watchlist";
  if (totalScore >= 65) return "Watchlist";
  if (totalScore >= 50) return "Neutral";
  if (totalScore >= 35) return "Risky";
  return "Avoid";
}

export function calculateScores(
  prices: PriceData[],
  fundamentals: FundamentalData
): ScoreResult {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map((p) => p.close);
  const volumes = sorted.map((p) => p.volume);

  const currentPrice = closes[closes.length - 1] ?? 0;
  const prevPrice = closes[closes.length - 2] ?? currentPrice;
  const priceChange = currentPrice - prevPrice;
  const priceChangePct = prevPrice !== 0 ? (priceChange / prevPrice) * 100 : 0;
  const currentVolume = volumes[volumes.length - 1] ?? 0;

  const ma20 = calcMA(closes, 20);
  const ma50 = calcMA(closes, 50);
  const ma200 = calcMA(closes, 200);
  const rsi14 = calcRSI(closes, 14);

  // Support = min harga 20 hari terakhir
  const recent20 = closes.slice(-20);
  const supportLevel = recent20.length > 0 ? Math.min(...recent20) : null;
  const resistanceLevel = recent20.length > 0 ? Math.max(...recent20) : null;

  // Avg volume 20 hari
  const vol20 = volumes.slice(-20);
  const avgVolume = vol20.length > 0 ? vol20.reduce((a, b) => a + b, 0) / vol20.length : currentVolume;

  // ── Trend Score (0-100) ──────────────────────────────────────────────────
  let trendScore = 50;
  {
    let pts = 0;
    let maxPts = 0;
    if (ma20 !== null) {
      maxPts += 40;
      if (currentPrice > ma20) pts += 40;
    }
    if (ma50 !== null) {
      maxPts += 35;
      if (currentPrice > ma50) pts += 35;
    }
    if (ma200 !== null) {
      maxPts += 25;
      if (currentPrice > ma200) pts += 25;
    }
    if (maxPts > 0) {
      trendScore = (pts / maxPts) * 100;
      // Bonus/penalty berdasarkan slope MA20
      if (ma20 !== null && closes.length >= 25) {
        const ma20Earlier = calcMA(closes.slice(0, -5), 20);
        if (ma20Earlier !== null) {
          const slope = (ma20 - ma20Earlier) / ma20Earlier;
          trendScore = clamp(trendScore + slope * 200);
        }
      }
    }
  }

  // ── Momentum Score (0-100) ──────────────────────────────────────────────
  let momentumScore = 50;
  {
    // RSI-based: RSI 40-60 neutral, <30 oversold (bullish potential), >70 overbought
    if (rsi14 !== null) {
      if (rsi14 >= 50 && rsi14 <= 70) momentumScore = 65 + (rsi14 - 50) * 1.5;
      else if (rsi14 > 70) momentumScore = 90 - (rsi14 - 70) * 2; // overbought → berkurang
      else if (rsi14 >= 30) momentumScore = 40 + (rsi14 - 30) * 1.25;
      else momentumScore = 30 + rsi14; // oversold
    }
    // Rate of change 5 hari
    if (closes.length >= 6) {
      const roc5 = (closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6] * 100;
      momentumScore = clamp(momentumScore + roc5 * 3);
    }
  }

  // ── Volume Score (0-100) ─────────────────────────────────────────────────
  let volumeScore = 50;
  {
    if (avgVolume > 0) {
      const volRatio = currentVolume / avgVolume;
      // Volume 2x avg = bagus, <0.5x = lesu
      if (volRatio >= 2) volumeScore = clamp(70 + (volRatio - 2) * 10);
      else if (volRatio >= 1) volumeScore = 50 + (volRatio - 1) * 20;
      else volumeScore = clamp(volRatio * 50);
    }
  }

  // ── Liquidity Score (0-100) ──────────────────────────────────────────────
  let liquidityScore = 50;
  {
    // Nilai transaksi harian dalam miliar (Rp)
    const dailyValue = (currentVolume * currentPrice) / 1e9;
    if (dailyValue >= 100) liquidityScore = 90;
    else if (dailyValue >= 50) liquidityScore = 80;
    else if (dailyValue >= 20) liquidityScore = 70;
    else if (dailyValue >= 10) liquidityScore = 60;
    else if (dailyValue >= 5) liquidityScore = 50;
    else if (dailyValue >= 1) liquidityScore = 35;
    else liquidityScore = 15;
  }

  // ── Fundamental Score (0-100) ────────────────────────────────────────────
  let fundamentalScore = 50;
  {
    let pts = 0;
    let weight = 0;
    const f = fundamentals;

    if (f.roe != null) {
      weight += 30;
      pts += f.roe >= 0.20 ? 30 : f.roe >= 0.15 ? 25 : f.roe >= 0.10 ? 18 : f.roe >= 0.05 ? 10 : 5;
    }
    if (f.roa != null) {
      weight += 20;
      pts += f.roa >= 0.10 ? 20 : f.roa >= 0.07 ? 15 : f.roa >= 0.05 ? 12 : f.roa >= 0.02 ? 8 : 3;
    }
    if (f.currentRatio != null) {
      weight += 20;
      pts += f.currentRatio >= 2 ? 20 : f.currentRatio >= 1.5 ? 16 : f.currentRatio >= 1 ? 10 : 3;
    }
    if (f.debtEquity != null) {
      weight += 15;
      pts += f.debtEquity <= 0.3 ? 15 : f.debtEquity <= 0.6 ? 12 : f.debtEquity <= 1 ? 9 : f.debtEquity <= 2 ? 5 : 2;
    }
    if (f.eps != null) {
      weight += 15;
      pts += f.eps > 0 ? 12 : 0;
      if (f.eps > 500) pts += 3;
    }
    fundamentalScore = weight > 0 ? (pts / weight) * 100 : 50;
  }

  // ── Valuation Score (0-100) ──────────────────────────────────────────────
  let valuationScore = 50;
  {
    const f = fundamentals;
    let pts = 0;
    let weight = 0;

    if (f.pe != null && f.pe > 0) {
      weight += 50;
      // PE rendah lebih baik (batas BEI: PE < 15 murah, > 30 mahal)
      pts += f.pe <= 10 ? 50 : f.pe <= 15 ? 40 : f.pe <= 20 ? 30 : f.pe <= 30 ? 18 : 5;
    }
    if (f.pb != null && f.pb > 0) {
      weight += 30;
      pts += f.pb <= 1 ? 30 : f.pb <= 2 ? 22 : f.pb <= 3 ? 15 : f.pb <= 5 ? 8 : 3;
    }
    if (f.dividendYield != null) {
      weight += 20;
      pts += f.dividendYield >= 0.05 ? 20 : f.dividendYield >= 0.03 ? 15 : f.dividendYield >= 0.01 ? 10 : 5;
    }
    valuationScore = weight > 0 ? (pts / weight) * 100 : 50;
  }

  // ── Risk Score (0-100, tinggi = berisiko tinggi) ──────────────────────────
  let riskScore = 50;
  {
    let risk = 50;
    const f = fundamentals;

    // Volatilitas harga (std dev 20 hari)
    if (closes.length >= 20) {
      const r20 = closes.slice(-20);
      const returns = r20.slice(1).map((c, i) => (c - r20[i]) / r20[i]);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.map((r) => (r - mean) ** 2).reduce((a, b) => a + b, 0) / returns.length;
      const stdDev = Math.sqrt(variance) * Math.sqrt(252); // annualized
      if (stdDev > 0.8) risk += 30;
      else if (stdDev > 0.5) risk += 20;
      else if (stdDev > 0.3) risk += 10;
      else risk -= 10;
    }

    // Beta
    if (f.beta != null) {
      if (f.beta > 1.5) risk += 20;
      else if (f.beta > 1.2) risk += 10;
      else if (f.beta < 0.8) risk -= 10;
    }

    // Debt/equity tinggi = risiko
    if (f.debtEquity != null) {
      if (f.debtEquity > 3) risk += 15;
      else if (f.debtEquity > 2) risk += 8;
      else if (f.debtEquity < 0.5) risk -= 5;
    }

    // Current ratio rendah = risiko likuiditas
    if (f.currentRatio != null) {
      if (f.currentRatio < 1) risk += 15;
      else if (f.currentRatio < 1.5) risk += 5;
    }

    riskScore = clamp(risk);
  }

  // ── Total Score dengan bobot ──────────────────────────────────────────────
  const riskInverse = 100 - riskScore; // risk score dibalik (rendah = bagus)
  const totalScore = clamp(
    trendScore * 0.20 +
    momentumScore * 0.15 +
    volumeScore * 0.15 +
    liquidityScore * 0.10 +
    fundamentalScore * 0.20 +
    valuationScore * 0.10 +
    riskInverse * 0.10
  );

  const label = getLabel(totalScore);

  return {
    currentPrice,
    priceChange,
    priceChangePct,
    volume: currentVolume,
    avgVolume: Math.round(avgVolume),
    trendScore: Math.round(trendScore * 100) / 100,
    momentumScore: Math.round(momentumScore * 100) / 100,
    volumeScore: Math.round(volumeScore * 100) / 100,
    liquidityScore: Math.round(liquidityScore * 100) / 100,
    fundamentalScore: Math.round(fundamentalScore * 100) / 100,
    valuationScore: Math.round(valuationScore * 100) / 100,
    riskScore: Math.round(riskScore * 100) / 100,
    totalScore: Math.round(totalScore * 100) / 100,
    label,
    ma20,
    ma50,
    ma200,
    rsi14: rsi14 !== null ? Math.round(rsi14 * 100) / 100 : null,
    supportLevel,
    resistanceLevel,
  };
}
