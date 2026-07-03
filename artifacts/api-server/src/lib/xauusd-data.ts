/**
 * XAUUSD (Gold/USD) real-time data fetcher + technical indicator calculator
 *
 * Data sources:
 *  - Live price  → Swissquote public forex feed (no auth, real broker data)
 *  - OHLCV candles → Public market data API (for technical indicators)
 *  - News        → Kitco + Investing.com RSS feeds
 */

export interface XauusdCandle {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface XauusdIndicators {
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  atr14: number | null;
  trend: "bullish" | "bearish" | "sideways";
  rsiSignal: "overbought" | "oversold" | "neutral";
  macdSignalType: "bullish_cross" | "bearish_cross" | "neutral";
  emaAlignment: "bullish_stack" | "bearish_stack" | "mixed";
  supportLevel: number | null;
  resistanceLevel: number | null;
}

// ─── Common headers ────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Live price (Swissquote public forex feed) ─────────────────────────────────

export interface XauusdLivePrice {
  price: number;   // mid-price (bid+ask)/2
  bid: number;
  ask: number;
  change: number | null;   // vs session open
  changePct: number | null;
  timestamp: number;
}

// Track session open price for daily change calculation
let sessionOpenPrice: number | null = null;
let sessionDate: string | null = null;

/**
 * Fetch latest XAUUSD price from Swissquote's public forex data feed.
 * Returns real broker bid/ask data — no auth needed.
 */
export async function fetchXauusdLivePrice(): Promise<XauusdLivePrice> {
  const url =
    "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD";

  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Swissquote feed HTTP ${res.status}`);

  const json = (await res.json()) as Array<{
    spreadProfilePrices?: Array<{ spreadProfile: string; bid: number; ask: number }>;
  }>;

  // Prefer "prime" profile, fall back to first available
  let bid: number | null = null;
  let ask: number | null = null;

  for (const platform of json) {
    const profiles = platform.spreadProfilePrices ?? [];
    const prime = profiles.find((p) => p.spreadProfile === "prime") ?? profiles[0];
    if (prime && bid == null) {
      bid = prime.bid;
      ask = prime.ask;
    }
  }

  if (bid == null || ask == null) throw new Error("Swissquote: no bid/ask data");

  const mid = parseFloat(((bid + ask) / 2).toFixed(2));

  // Reset session open at UTC midnight
  const today = new Date().toISOString().slice(0, 10);
  if (sessionDate !== today) {
    sessionDate = today;
    sessionOpenPrice = mid;
  }
  if (sessionOpenPrice == null) sessionOpenPrice = mid;

  const change = parseFloat((mid - sessionOpenPrice).toFixed(2));
  const changePct = parseFloat(((change / sessionOpenPrice) * 100).toFixed(3));

  return {
    price: mid,
    bid: parseFloat(bid.toFixed(2)),
    ask: parseFloat(ask.toFixed(2)),
    change,
    changePct,
    timestamp: Date.now(),
  };
}

// ─── Historical OHLCV candles ──────────────────────────────────────────────────

// Public market data endpoints for OHLCV candle history (technical indicator calculations)
const CANDLE_API  = "https://query2.finance.yahoo.com";
const CANDLE_API2 = "https://query1.finance.yahoo.com";

async function fetchCandlesForTicker(
  ticker: string,
  interval: "15m" | "1h" | "1d",
  range: string
): Promise<XauusdCandle[]> {
  const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  let res = await fetch(`${CANDLE_API}${path}`, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    res = await fetch(`${CANDLE_API2}${path}`, { headers: BROWSER_HEADERS });
  }
  if (!res.ok) throw new Error(`Market data ${ticker} HTTP ${res.status}`);

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: number[];
            high: number[];
            low: number[];
            close: number[];
            volume: number[];
          }>;
        };
      }>;
      error?: { message: string };
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.message);
  const result = json.chart.result?.[0];
  if (!result) throw new Error(`No candle data for ${ticker}`);

  const { timestamp, indicators } = result;
  const q = indicators.quote[0];
  const candles: XauusdCandle[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null)
      continue;
    candles.push({
      timestamp: timestamp[i] * 1000,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] ?? 0,
    });
  }
  return candles;
}

/** Fetch XAUUSD OHLCV candles for technical indicator calculations */
export async function fetchXauusdCandles(
  interval: "1h" | "1d" = "1h",
  range = "60d"
): Promise<XauusdCandle[]> {
  return fetchCandlesForTicker("GC=F", interval, range);
}

/** Fetch DXY or US10Y candles for correlation analysis */
export async function fetchTickerCandles(
  instrument: "dxy" | "us10y",
  interval: "1h" | "1d" = "1h",
  range = "60d"
): Promise<XauusdCandle[]> {
  const ticker = instrument === "dxy" ? "DX-Y.NYB" : "^TNX";
  return fetchCandlesForTicker(ticker, interval, range);
}

// ─── Technical indicator functions ────────────────────────────────────────────

function calcEma(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcRsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const result: number[] = new Array(closes.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcBollingerBands(closes: number[], period = 20, stdDevMult = 2) {
  const upper = new Array(closes.length).fill(NaN);
  const middle = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + stdDevMult * stdDev;
    lower[i] = mean - stdDevMult * stdDev;
  }
  return { upper, middle, lower };
}

function calcAtr(candles: XauusdCandle[], period = 14): number[] {
  const result = new Array(candles.length).fill(NaN);
  if (candles.length < 2) return result;
  const tr = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hcp = Math.abs(candles[i].high - candles[i - 1].close);
    const lcp = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hcp, lcp));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

function calcSupportResistance(candles: XauusdCandle[], lookback = 100) {
  const recent = candles.slice(-lookback);
  return {
    support: Math.min(...recent.map((c) => c.low)),
    resistance: Math.max(...recent.map((c) => c.high)),
  };
}

// ─── Main indicator calculator ─────────────────────────────────────────────────

export function calculateIndicators(candles: XauusdCandle[]): XauusdIndicators | null {
  if (candles.length < 26) return null;
  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];
  const n = closes.length - 1;

  const ema9arr   = calcEma(closes, 9);
  const ema21arr  = calcEma(closes, 21);
  const ema50arr  = calcEma(closes, 50);
  const ema200arr = calcEma(closes, 200);

  const ema9   = isNaN(ema9arr[n])   ? null : ema9arr[n];
  const ema21  = isNaN(ema21arr[n])  ? null : ema21arr[n];
  const ema50  = isNaN(ema50arr[n])  ? null : ema50arr[n];
  const ema200 = isNaN(ema200arr[n]) ? null : ema200arr[n];

  const rsiArr = calcRsi(closes, 14);
  const rsi14  = isNaN(rsiArr[n]) ? null : parseFloat(rsiArr[n].toFixed(2));

  const ema12arr     = calcEma(closes, 12);
  const ema26arr     = calcEma(closes, 26);
  const macdLineArr  = ema12arr.map((v, i) => (isNaN(v) || isNaN(ema26arr[i]) ? NaN : v - ema26arr[i]));
  const validMacd    = macdLineArr.filter((v) => !isNaN(v));
  const macdSigArr   = calcEma(validMacd, 9);
  const firstValid   = macdLineArr.findIndex((v) => !isNaN(v));
  const macdSigAlign = new Array(candles.length).fill(NaN);
  for (let i = 0; i < macdSigArr.length; i++) macdSigAlign[firstValid + i] = macdSigArr[i];

  const macdLine    = isNaN(macdLineArr[n]) ? null : macdLineArr[n];
  const macdSigVal  = isNaN(macdSigAlign[n]) ? null : macdSigAlign[n];
  const macdHisto   = macdLine != null && macdSigVal != null ? macdLine - macdSigVal : null;

  const bb      = calcBollingerBands(closes, 20, 2);
  const bbUpper = isNaN(bb.upper[n])  ? null : bb.upper[n];
  const bbMiddle= isNaN(bb.middle[n]) ? null : bb.middle[n];
  const bbLower = isNaN(bb.lower[n])  ? null : bb.lower[n];
  const bbWidth =
    bbUpper != null && bbLower != null && bbMiddle != null && bbMiddle !== 0
      ? ((bbUpper - bbLower) / bbMiddle) * 100
      : null;

  const atrArr = calcAtr(candles, 14);
  const atr14  = isNaN(atrArr[n]) ? null : atrArr[n];

  const { support, resistance } = calcSupportResistance(candles, 100);

  const rsiSignal: XauusdIndicators["rsiSignal"] =
    rsi14 == null ? "neutral" : rsi14 >= 70 ? "overbought" : rsi14 <= 30 ? "oversold" : "neutral";

  let macdSignalType: XauusdIndicators["macdSignalType"] = "neutral";
  if (macdHisto != null && n > 0) {
    const prevH =
      !isNaN(macdLineArr[n - 1]) && !isNaN(macdSigAlign[n - 1])
        ? macdLineArr[n - 1] - macdSigAlign[n - 1]
        : null;
    if (prevH != null) {
      if (prevH < 0 && macdHisto > 0) macdSignalType = "bullish_cross";
      else if (prevH > 0 && macdHisto < 0) macdSignalType = "bearish_cross";
    }
  }

  const price = last.close;
  let emaAlignment: XauusdIndicators["emaAlignment"] = "mixed";
  if (ema9 != null && ema21 != null && ema50 != null) {
    if (price > ema9 && ema9 > ema21 && ema21 > ema50) emaAlignment = "bullish_stack";
    else if (price < ema9 && ema9 < ema21 && ema21 < ema50) emaAlignment = "bearish_stack";
  }

  let trendScore = 0;
  if (emaAlignment === "bullish_stack") trendScore += 2;
  else if (emaAlignment === "bearish_stack") trendScore -= 2;
  if (rsiSignal === "overbought") trendScore += 1;
  else if (rsiSignal === "oversold") trendScore -= 1;
  if (macdHisto != null && macdHisto > 0) trendScore += 1;
  else if (macdHisto != null && macdHisto < 0) trendScore -= 1;
  const trend: XauusdIndicators["trend"] =
    trendScore > 1 ? "bullish" : trendScore < -1 ? "bearish" : "sideways";

  return {
    price: parseFloat(price.toFixed(2)),
    open:  parseFloat(last.open.toFixed(2)),
    high:  parseFloat(last.high.toFixed(2)),
    low:   parseFloat(last.low.toFixed(2)),
    volume: last.volume,
    rsi14,
    ema9:   ema9   != null ? parseFloat(ema9.toFixed(2))   : null,
    ema21:  ema21  != null ? parseFloat(ema21.toFixed(2))  : null,
    ema50:  ema50  != null ? parseFloat(ema50.toFixed(2))  : null,
    ema200: ema200 != null ? parseFloat(ema200.toFixed(2)) : null,
    macdLine:      macdLine  != null ? parseFloat(macdLine.toFixed(4))  : null,
    macdSignal:    macdSigVal!= null ? parseFloat(macdSigVal.toFixed(4)): null,
    macdHistogram: macdHisto != null ? parseFloat(macdHisto.toFixed(4)) : null,
    bbUpper:  bbUpper  != null ? parseFloat(bbUpper.toFixed(2))  : null,
    bbMiddle: bbMiddle != null ? parseFloat(bbMiddle.toFixed(2)) : null,
    bbLower:  bbLower  != null ? parseFloat(bbLower.toFixed(2))  : null,
    bbWidth:  bbWidth  != null ? parseFloat(bbWidth.toFixed(3))  : null,
    atr14:    atr14    != null ? parseFloat(atr14.toFixed(4))    : null,
    trend, rsiSignal, macdSignalType, emaAlignment,
    supportLevel:    parseFloat(support.toFixed(2)),
    resistanceLevel: parseFloat(resistance.toFixed(2)),
  };
}

// ─── Multi-timeframe analysis ──────────────────────────────────────────────────

function resampleCandles(candles: XauusdCandle[], groupSize: number): XauusdCandle[] {
  const out: XauusdCandle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length === 0) continue;
    out.push({
      timestamp: group[0].timestamp,
      open:   group[0].open,
      high:   Math.max(...group.map((c) => c.high)),
      low:    Math.min(...group.map((c) => c.low)),
      close:  group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

export interface TimeframeAnalysis {
  timeframe: "1h" | "4h" | "1d";
  label: string;
  indicators: XauusdIndicators | null;
}

export async function getMultiTimeframeAnalysis(): Promise<TimeframeAnalysis[]> {
  const [hourly, daily] = await Promise.all([
    fetchXauusdCandles("1h", "60d"),
    fetchXauusdCandles("1d", "2y"),
  ]);
  const fourHour = resampleCandles(hourly, 4);
  return [
    { timeframe: "1h",  label: "1 Jam",    indicators: calculateIndicators(hourly)   },
    { timeframe: "4h",  label: "4 Jam",    indicators: calculateIndicators(fourHour) },
    { timeframe: "1d",  label: "Harian",   indicators: calculateIndicators(daily)    },
  ];
}

export function summarizeTimeframeConfluence(analyses: TimeframeAnalysis[]) {
  let bullishCount = 0;
  let bearishCount = 0;
  for (const a of analyses) {
    if (!a.indicators) continue;
    if (a.indicators.trend === "bullish") bullishCount++;
    else if (a.indicators.trend === "bearish") bearishCount++;
  }
  let agreement: "strong_bullish" | "strong_bearish" | "mixed" = "mixed";
  if (bullishCount >= 2 && bullishCount > bearishCount) agreement = "strong_bullish";
  else if (bearishCount >= 2 && bearishCount > bullishCount) agreement = "strong_bearish";
  return { agreement, bullishCount, bearishCount };
}

// ─── Correlation analysis (DXY + US10Y) ───────────────────────────────────────

export interface CorrelationFactor {
  name: string;
  ticker: string;
  price: number | null;
  changePct: number | null;
  correlation: number | null;
  interpretation: string;
}

export interface CorrelationAnalysis {
  gold: { price: number; changePct: number | null };
  dxy: CorrelationFactor;
  us10y: CorrelationFactor;
  computedAt: string;
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

export async function getCorrelationAnalysis(): Promise<CorrelationAnalysis> {
  const [goldCandles, dxyCandles, yieldCandles] = await Promise.all([
    fetchXauusdCandles("1h", "60d"),
    fetchTickerCandles("dxy",   "1h", "60d").catch(() => [] as XauusdCandle[]),
    fetchTickerCandles("us10y", "1h", "60d").catch(() => [] as XauusdCandle[]),
  ]);

  if (goldCandles.length === 0) throw new Error("No gold candle data available");

  const goldCloses   = goldCandles.map((c) => c.close);
  const goldLast     = goldCandles[goldCandles.length - 1];
  const goldPrev     = goldCandles[goldCandles.length - 2];
  const goldChangePct = goldPrev
    ? ((goldLast.close - goldPrev.close) / goldPrev.close) * 100
    : null;

  function buildFactor(name: string, ticker: string, candles: XauusdCandle[]): CorrelationFactor {
    if (candles.length < 10) {
      return { name, ticker, price: null, changePct: null, correlation: null, interpretation: "Data tidak tersedia" };
    }
    const closes = candles.map((c) => c.close);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : null;
    const correlation = pearsonCorrelation(goldCloses, closes);
    let interpretation = "Korelasi lemah/tidak signifikan dengan gold saat ini.";
    if (correlation != null) {
      if (correlation <= -0.5)
        interpretation = `Korelasi negatif kuat (${correlation.toFixed(2)}) — saat ${name} naik, gold cenderung turun.`;
      else if (correlation >= 0.5)
        interpretation = `Korelasi positif kuat (${correlation.toFixed(2)}) — ${name} dan gold bergerak searah saat ini.`;
      else
        interpretation = `Korelasi lemah (${correlation.toFixed(2)}) — pergerakan ${name} kurang berpengaruh langsung pada gold.`;
    }
    return {
      name, ticker,
      price:       parseFloat(last.close.toFixed(3)),
      changePct:   changePct != null ? parseFloat(changePct.toFixed(3)) : null,
      correlation: correlation != null ? parseFloat(correlation.toFixed(3)) : null,
      interpretation,
    };
  }

  return {
    gold: {
      price:      parseFloat(goldLast.close.toFixed(2)),
      changePct:  goldChangePct != null ? parseFloat(goldChangePct.toFixed(3)) : null,
    },
    dxy:   buildFactor("DXY (Dollar Index)",           "DX-Y.NYB", dxyCandles),
    us10y: buildFactor("US 10-Year Treasury Yield",    "^TNX",     yieldCandles),
    computedAt: new Date().toISOString(),
  };
}

// ─── News (Kitco + Investing.com RSS) ─────────────────────────────────────────

export interface XauusdNewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: Date;
}

function parseRssItems(xml: string, sourceName: string): XauusdNewsItem[] {
  const items: XauusdNewsItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const title =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ??
      block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const link =
      block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ??
      block.match(/<guid[^>]*>(https?:\/\/[^\s<]+)<\/guid>/i)?.[1] ?? "";
    const desc =
      block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1] ??
      block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "";
    const cleanTitle = title.replace(/<[^>]+>/g, "").trim();
    if (!cleanTitle) continue;
    items.push({
      title:       cleanTitle,
      summary:     desc.replace(/<[^>]+>/g, "").trim().slice(0, 300),
      url:         link.trim(),
      source:      sourceName,
      publishedAt: pubDate ? new Date(pubDate) : new Date(),
    });
  }
  return items;
}

export async function fetchXauusdNews(): Promise<XauusdNewsItem[]> {
  const feeds = [
    { url: "https://www.kitco.com/rss/news.xml",           source: "Kitco News" },
    { url: "https://www.investing.com/rss/news_301.rss",   source: "Investing.com" },
  ];

  const results: XauusdNewsItem[] = [];
  const seen = new Set<string>();

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { ...BROWSER_HEADERS, Accept: "application/rss+xml,application/xml,text/xml,*/*" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const item of parseRssItems(xml, feed.source)) {
        if (seen.has(item.title)) continue;
        seen.add(item.title);
        results.push(item);
      }
    } catch {
      // skip failed feed silently
    }
  }

  return results.slice(0, 12);
}
