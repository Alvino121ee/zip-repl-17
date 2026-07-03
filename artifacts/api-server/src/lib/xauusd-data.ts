/**
 * XAUUSD (Gold/USD) real-time data fetcher + technical indicator calculator
 *
 * Data sources:
 *  - Live price  → TradingView Scanner API (primary) / Swissquote fallback
 *  - OHLCV candles → TradingView History API (UDF format)
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

const TV_HEADERS = {
  ...BROWSER_HEADERS,
  "Origin":  "https://www.tradingview.com",
  "Referer": "https://www.tradingview.com/",
};

// ─── Live price (TradingView Scanner API, fallback ke Swissquote) ──────────────

export interface XauusdLivePrice {
  price: number;   // mid-price
  bid: number;
  ask: number;
  change: number | null;   // vs session open
  changePct: number | null;
  timestamp: number;
}

interface TvScannerResponse {
  data: Array<{ s: string; d: (number | null)[] }>;
}

/**
 * Fetch live XAUUSD price from TradingView Scanner API.
 * Columns: close, open, high, low, change_abs, change (%)
 */
async function fetchLivePriceFromTradingView(): Promise<XauusdLivePrice> {
  const url = "https://scanner.tradingview.com/global/scan";
  const body = {
    symbols: { tickers: ["OANDA:XAUUSD"], query: { types: [] } },
    columns: ["close", "open", "high", "low", "change_abs", "change"],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { ...TV_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`TradingView Scanner HTTP ${res.status}`);

  const json = (await res.json()) as TvScannerResponse;
  if (!json.data?.length) throw new Error("TradingView Scanner: no data");

  const [close, , , , changeAbs, changePct] = json.data[0].d;
  if (close == null) throw new Error("TradingView Scanner: close is null");

  const SPREAD = 0.30; // typical XAUUSD spread ~$0.30
  const bid = parseFloat((close - SPREAD / 2).toFixed(2));
  const ask = parseFloat((close + SPREAD / 2).toFixed(2));

  return {
    price: parseFloat(close.toFixed(2)),
    bid,
    ask,
    change:    changeAbs != null ? parseFloat(changeAbs.toFixed(2)) : null,
    changePct: changePct != null ? parseFloat(changePct.toFixed(3)) : null,
    timestamp: Date.now(),
  };
}

/**
 * Fallback: fetch XAUUSD bid/ask from Swissquote public forex feed.
 */
async function fetchLivePriceFromSwissquote(): Promise<XauusdLivePrice> {
  const url =
    "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD";

  const res = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Swissquote feed HTTP ${res.status}`);

  const json = (await res.json()) as Array<{
    spreadProfilePrices?: Array<{ spreadProfile: string; bid: number; ask: number }>;
  }>;

  let bid: number | null = null;
  let ask: number | null = null;
  for (const platform of json) {
    const profiles = platform.spreadProfilePrices ?? [];
    const prime = profiles.find((p) => p.spreadProfile === "prime") ?? profiles[0];
    if (prime && bid == null) { bid = prime.bid; ask = prime.ask; }
  }
  if (bid == null || ask == null) throw new Error("Swissquote: no bid/ask data");

  const mid = parseFloat(((bid + ask) / 2).toFixed(2));
  return {
    price: mid,
    bid:  parseFloat(bid.toFixed(2)),
    ask:  parseFloat(ask.toFixed(2)),
    change: null,
    changePct: null,
    timestamp: Date.now(),
  };
}

/**
 * Fetch latest XAUUSD live price.
 * Primary: TradingView Scanner (real-time, change % included).
 * Fallback: Swissquote (real bid/ask, no change %).
 */
export async function fetchXauusdLivePrice(): Promise<XauusdLivePrice> {
  try {
    return await fetchLivePriceFromTradingView();
  } catch (err) {
    console.warn("[xauusd-data] TradingView Scanner failed, fallback Swissquote:", (err as Error).message);
    return fetchLivePriceFromSwissquote();
  }
}

// ─── TradingView Scanner — indicator columns ────────────────────────────────────

// TradingView symbol mapping
const TV_SYMBOL_MAP = {
  xauusd: "OANDA:XAUUSD",
  dxy:    "TVC:DXY",
  us10y:  "TVC:US10Y",
} as const;

// TradingView interval mapping (Scanner uses minutes or special strings)
const TV_INTERVAL_MAP: Record<string, string> = {
  "1h":  "60",
  "4h":  "240",
  "1d":  "1D",
};

// Ordered column list — index must stay in sync with destructuring below
const TV_INDICATOR_COLUMNS = [
  "close", "open", "high", "low", "volume",   // 0-4
  "change", "change_abs",                       // 5-6
  "RSI",                                        // 7  — RSI 14
  "RSI[1]",                                     // 8  — previous RSI
  "EMA10",                                      // 9  — closest to EMA9
  "EMA20",                                      // 10 — closest to EMA21
  "EMA50",                                      // 11
  "EMA200",                                     // 12
  "MACD.macd",                                  // 13
  "MACD.signal",                                // 14
  "MACD.macd[1]",                               // 15 — prev MACD line (cross detect)
  "MACD.signal[1]",                             // 16 — prev MACD signal
  "BB.upper",                                   // 17
  "BB.lower",                                   // 18
  "BB.basis",                                   // 19 — BB middle
  "ATR",                                        // 20 — ATR 14
  "Pivot.M.Classic.S1",                         // 21 — monthly support
  "Pivot.M.Classic.R1",                         // 22 — monthly resistance
] as const;

/**
 * Query TradingView Scanner for pre-computed technical indicators.
 * Interval: "60" = 1h, "240" = 4h, "1D" = daily.
 * Returns raw column array in TV_INDICATOR_COLUMNS order.
 */
async function queryTvScanner(
  tvSymbol: string,
  interval: string,
  columns: readonly string[]
): Promise<(number | null)[]> {
  const url = `https://scanner.tradingview.com/global/scan?interval=${interval}`;
  const body = {
    symbols: { tickers: [tvSymbol], query: { types: [] } },
    columns: [...columns],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { ...TV_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TradingView Scanner ${tvSymbol}@${interval} HTTP ${res.status}`);

  const json = (await res.json()) as TvScannerResponse;
  if (!json.data?.length) throw new Error(`TradingView Scanner: no data for ${tvSymbol}`);

  const row = json.data[0].d;
  if (!Array.isArray(row)) throw new Error(`TradingView Scanner: unexpected payload shape for ${tvSymbol}`);
  // Validate each element is number, null, or undefined (coerce undefined → null)
  return row.map((v) => (v === null || v === undefined ? null : typeof v === "number" ? v : null));
}

/**
 * Convert raw TradingView Scanner columns to XauusdIndicators.
 * Column order must match TV_INDICATOR_COLUMNS.
 */
function buildIndicatorsFromScanner(d: (number | null)[]): XauusdIndicators | null {
  const close = d[0];
  if (close == null) return null;

  const open   = d[1] ?? close;
  const high   = d[2] ?? close;
  const low    = d[3] ?? close;
  const volume = d[4] ?? 0;

  const price  = parseFloat(close.toFixed(2));

  const rsi14: number | null = d[7] != null ? parseFloat(d[7].toFixed(2)) : null;

  const ema9:   number | null = d[9]  != null ? parseFloat(d[9].toFixed(2))  : null; // EMA10
  const ema21:  number | null = d[10] != null ? parseFloat(d[10].toFixed(2)) : null; // EMA20
  const ema50:  number | null = d[11] != null ? parseFloat(d[11].toFixed(2)) : null;
  const ema200: number | null = d[12] != null ? parseFloat(d[12].toFixed(2)) : null;

  const macdLine:   number | null = d[13] != null ? parseFloat(d[13].toFixed(4)) : null;
  const macdSignal: number | null = d[14] != null ? parseFloat(d[14].toFixed(4)) : null;
  const macdHistogram = macdLine != null && macdSignal != null
    ? parseFloat((macdLine - macdSignal).toFixed(4)) : null;

  const macdLinePrev   = d[15];
  const macdSignalPrev = d[16];
  const prevHisto = macdLinePrev != null && macdSignalPrev != null
    ? macdLinePrev - macdSignalPrev : null;

  let macdSignalType: XauusdIndicators["macdSignalType"] = "neutral";
  if (prevHisto != null && macdHistogram != null) {
    if (prevHisto < 0 && macdHistogram > 0) macdSignalType = "bullish_cross";
    else if (prevHisto > 0 && macdHistogram < 0) macdSignalType = "bearish_cross";
  }

  const bbUpper:  number | null = d[17] != null ? parseFloat(d[17].toFixed(2)) : null;
  const bbLower:  number | null = d[18] != null ? parseFloat(d[18].toFixed(2)) : null;
  const bbMiddle: number | null = d[19] != null ? parseFloat(d[19].toFixed(2)) : null;
  const bbWidth = bbUpper != null && bbLower != null && bbMiddle != null && bbMiddle !== 0
    ? parseFloat(((bbUpper - bbLower) / bbMiddle * 100).toFixed(3)) : null;

  const atr14: number | null = d[20] != null ? parseFloat(d[20].toFixed(4)) : null;

  const supportLevel:    number | null = d[21] != null ? parseFloat(d[21].toFixed(2)) : null;
  const resistanceLevel: number | null = d[22] != null ? parseFloat(d[22].toFixed(2)) : null;

  // Derived signals
  const rsiSignal: XauusdIndicators["rsiSignal"] =
    rsi14 == null ? "neutral" : rsi14 >= 70 ? "overbought" : rsi14 <= 30 ? "oversold" : "neutral";

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
  if (macdHistogram != null && macdHistogram > 0) trendScore += 1;
  else if (macdHistogram != null && macdHistogram < 0) trendScore -= 1;
  const trend: XauusdIndicators["trend"] =
    trendScore > 1 ? "bullish" : trendScore < -1 ? "bearish" : "sideways";

  return {
    price,
    open:   parseFloat(open.toFixed(2)),
    high:   parseFloat(high.toFixed(2)),
    low:    parseFloat(low.toFixed(2)),
    volume,
    rsi14, ema9, ema21, ema50, ema200,
    macdLine, macdSignal, macdHistogram,
    bbUpper, bbMiddle, bbLower, bbWidth, atr14,
    trend, rsiSignal, macdSignalType, emaAlignment,
    supportLevel, resistanceLevel,
  };
}

/**
 * Fetch XAUUSD technical indicators from TradingView Scanner.
 * Replaces the old fetchXauusdCandles + calculateIndicators pattern.
 * interval: "1h" | "4h" | "1d"
 */
export async function fetchXauusdIndicators(
  interval: "1h" | "4h" | "1d" = "1h"
): Promise<XauusdIndicators | null> {
  const tvInterval = TV_INTERVAL_MAP[interval];
  const d = await queryTvScanner(TV_SYMBOL_MAP.xauusd, tvInterval, TV_INDICATOR_COLUMNS);
  return buildIndicatorsFromScanner(d);
}

// ─── Multi-timeframe analysis (TradingView Scanner × 3 intervals) ─────────────

export interface TimeframeAnalysis {
  timeframe: "1h" | "4h" | "1d";
  label: string;
  indicators: XauusdIndicators | null;
}

export async function getMultiTimeframeAnalysis(): Promise<TimeframeAnalysis[]> {
  const [h1, h4, d1] = await Promise.all([
    queryTvScanner(TV_SYMBOL_MAP.xauusd, TV_INTERVAL_MAP["1h"], TV_INDICATOR_COLUMNS).catch(() => null),
    queryTvScanner(TV_SYMBOL_MAP.xauusd, TV_INTERVAL_MAP["4h"], TV_INDICATOR_COLUMNS).catch(() => null),
    queryTvScanner(TV_SYMBOL_MAP.xauusd, TV_INTERVAL_MAP["1d"], TV_INDICATOR_COLUMNS).catch(() => null),
  ]);
  return [
    { timeframe: "1h",  label: "1 Jam",   indicators: h1 ? buildIndicatorsFromScanner(h1) : null },
    { timeframe: "4h",  label: "4 Jam",   indicators: h4 ? buildIndicatorsFromScanner(h4) : null },
    { timeframe: "1d",  label: "Harian",  indicators: d1 ? buildIndicatorsFromScanner(d1) : null },
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

// ─── Correlation analysis (DXY + US10Y via TradingView Scanner) ───────────────

export interface CorrelationFactor {
  name: string;
  ticker: string;
  price: number | null;
  changePct: number | null;
  correlation: number | null;   // null — Scanner gives current snapshot, not time-series
  interpretation: string;
}

export interface CorrelationAnalysis {
  gold: { price: number; changePct: number | null };
  dxy: CorrelationFactor;
  us10y: CorrelationFactor;
  computedAt: string;
}

const CORR_COLUMNS = ["close", "change"] as const;

async function fetchCorrelationFactor(
  name: string,
  ticker: string,
  tvSymbol: string,
  goldChangePct: number | null
): Promise<CorrelationFactor> {
  try {
    const d = await queryTvScanner(tvSymbol, TV_INTERVAL_MAP["1d"], CORR_COLUMNS);
    const price     = d[0] != null ? parseFloat(d[0].toFixed(3)) : null;
    const changePct = d[1] != null ? parseFloat(d[1].toFixed(3)) : null;

    // Rule-based interpretation (DXY historically inversely correlated with gold)
    let interpretation: string;
    if (price == null) {
      interpretation = "Data tidak tersedia";
    } else if (tvSymbol === "TVC:DXY") {
      if (changePct != null && goldChangePct != null) {
        const sameDir = (changePct > 0) === (goldChangePct > 0);
        interpretation = sameDir
          ? `DXY dan gold bergerak searah hari ini — pola tidak biasa (biasanya berkebalikan).`
          : `DXY naik sementara gold turun (atau sebaliknya) — pola korelasi negatif normal.`;
      } else {
        interpretation = "DXY biasanya berkorelasi negatif dengan gold: dollar kuat → gold tertekan.";
      }
    } else {
      if (changePct != null && goldChangePct != null) {
        const sameDir = (changePct > 0) === (goldChangePct > 0);
        interpretation = sameDir
          ? `Yield AS dan gold naik bersama — pasar risk-off dominan atau tekanan inflasi tinggi.`
          : `Yield AS dan gold bergerak berlawanan — pola normal saat rate hike cycle.`;
      } else {
        interpretation = "Yield AS yang naik cenderung menekan gold (meningkatkan opportunity cost).";
      }
    }

    return { name, ticker, price, changePct, correlation: null, interpretation };
  } catch {
    return { name, ticker, price: null, changePct: null, correlation: null, interpretation: "Data tidak tersedia" };
  }
}

export async function getCorrelationAnalysis(): Promise<CorrelationAnalysis> {
  // Get gold current price + daily change
  const goldLive = await fetchLivePriceFromTradingView().catch(() => fetchLivePriceFromSwissquote());
  const goldChangePct = goldLive.changePct;

  const [dxy, us10y] = await Promise.all([
    fetchCorrelationFactor("DXY (Dollar Index)", "TVC:DXY", "TVC:DXY", goldChangePct),
    fetchCorrelationFactor("US 10-Year Treasury Yield", "TVC:US10Y", "TVC:US10Y", goldChangePct),
  ]);

  return {
    gold: { price: goldLive.price, changePct: goldChangePct },
    dxy,
    us10y,
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
