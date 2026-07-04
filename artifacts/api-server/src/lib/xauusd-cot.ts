/**
 * COT (Commitment of Traders) — Gold Futures positioning dari CFTC.
 *
 * Data diperbarui setiap Jumat (mencerminkan posisi Selasa sebelumnya).
 * Non-commercial (speculative) net position = proxy "smart money" arah gold.
 *
 * Source: CFTC Socrata API — Legacy Futures Only COT report.
 */

export interface CotReport {
  reportDate: string;         // "YYYY-MM-DD"
  specLong: number;           // Non-commercial long contracts
  specShort: number;          // Non-commercial short contracts
  specNet: number;            // specLong - specShort
  specNetChange: number | null; // vs laporan sebelumnya
  commNet: number;            // Commercial (hedger) net position
  sentiment: "strongly_bullish" | "bullish" | "neutral" | "bearish" | "strongly_bearish";
  interpretation: string;
}

export interface CotAnalysis {
  latest: CotReport | null;
  fetchedAt: string;
}

// ─── Cache 4 jam (data mingguan, tidak perlu sering re-fetch) ─────────────────
let _cache: CotAnalysis | null = null;
let _cacheAt = 0;
const CACHE_TTL = 4 * 60 * 60 * 1_000;

interface CftcRow {
  report_date_as_yyyy_mm_dd?: string;
  noncomm_positions_long_all?: string;
  noncomm_positions_short_all?: string;
  comm_positions_long_all?: string;
  comm_positions_short_all?: string;
  [key: string]: string | undefined;
}

async function fetchFromCftc(): Promise<CotReport | null> {
  // CFTC Socrata — Legacy Futures Only (dataset jun7-2qch)
  // Gold = "GOLD - COMMODITY EXCHANGE INC." in market_and_exchange_names
  const params = new URLSearchParams({
    "$order": "report_date_as_yyyy_mm_dd DESC",
    "$limit": "2",
    "$where": "market_and_exchange_names like '%GOLD%' AND cftc_market_code='COMEX'",
  });

  const url = `https://publicreporting.cftc.gov/resource/jun7-2qch.json?${params}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`CFTC API HTTP ${res.status}`);

  const rows = (await res.json()) as CftcRow[];
  if (!rows || rows.length === 0) throw new Error("CFTC: data kosong");

  const latest = rows[0];
  const prev = rows[1] ?? null;

  const specLong = parseInt(latest.noncomm_positions_long_all ?? "0", 10) || 0;
  const specShort = parseInt(latest.noncomm_positions_short_all ?? "0", 10) || 0;
  const commLong = parseInt(latest.comm_positions_long_all ?? "0", 10) || 0;
  const commShort = parseInt(latest.comm_positions_short_all ?? "0", 10) || 0;

  const specNet = specLong - specShort;
  const commNet = commLong - commShort;

  let specNetChange: number | null = null;
  if (prev) {
    const prevLong = parseInt(prev.noncomm_positions_long_all ?? "0", 10) || 0;
    const prevShort = parseInt(prev.noncomm_positions_short_all ?? "0", 10) || 0;
    specNetChange = specNet - (prevLong - prevShort);
  }

  // Interpret positioning
  // specNet positif = spekulan lebih banyak long = bullish bias
  // specNet negatif = spekulan lebih banyak short = bearish bias
  // Ekstrem di kedua arah bisa jadi sinyal kontarian (reversal warning)
  const netK = specNet / 1_000;

  let sentiment: CotReport["sentiment"];
  let interpretation: string;

  if (netK > 180) {
    sentiment = "strongly_bullish";
    interpretation = `Spekulan sangat net long (${netK.toFixed(0)}K kontrak) — smart money heavily positioned bullish. Namun posisi ekstrem ini juga merupakan risiko reversal jika ada pemicu jual (over-leveraged longs).`;
  } else if (netK > 60) {
    sentiment = "bullish";
    interpretation = `Spekulan net long (${netK.toFixed(0)}K kontrak). Hedge funds dan large speculators condong bullish — mendukung bias beli di gold.`;
  } else if (netK > -20) {
    sentiment = "neutral";
    interpretation = `Posisi spekulan balanced (${netK.toFixed(0)}K kontrak). Tidak ada bias kuat dari institutional positioning — pasar dalam fase ketidakpastian.`;
  } else if (netK > -80) {
    sentiment = "bearish";
    interpretation = `Spekulan net short (${netK.toFixed(0)}K kontrak). Smart money condong bearish — tekanan jual dari institutional positioning.`;
  } else {
    sentiment = "strongly_bearish";
    interpretation = `Spekulan sangat net short (${netK.toFixed(0)}K kontrak) — tekanan bearish besar. Bisa juga sinyal kontarian (short squeeze potential) jika sentimen berubah.`;
  }

  if (specNetChange !== null) {
    const chgK = specNetChange / 1_000;
    const dir = chgK >= 0 ? "bertambah" : "berkurang";
    interpretation += ` Minggu ini posisi spekulan ${dir} ${Math.abs(chgK).toFixed(0)}K kontrak dari pekan lalu.`;
  }

  return {
    reportDate: latest.report_date_as_yyyy_mm_dd ?? "unknown",
    specLong,
    specShort,
    specNet,
    specNetChange,
    commNet,
    sentiment,
    interpretation,
  };
}

export async function getCotAnalysis(): Promise<CotAnalysis> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

  try {
    const report = await fetchFromCftc();
    const result: CotAnalysis = { latest: report, fetchedAt: new Date().toISOString() };
    _cache = result;
    _cacheAt = now;
    return result;
  } catch (err) {
    console.warn("[COT] Gagal fetch CFTC data:", (err as Error).message);
    // Return stale cache or null
    if (_cache) return { ..._cache, fetchedAt: new Date().toISOString() };
    return { latest: null, fetchedAt: new Date().toISOString() };
  }
}
