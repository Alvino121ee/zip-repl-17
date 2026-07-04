/**
 * Economic Calendar — upcoming high-impact USD events via ForexFactory public JSON.
 *
 * Gold sangat sensitif terhadap: NFP, CPI, PCE, FOMC, GDP.
 * AI confidence harus dikurangi sebelum rilis event besar ini.
 */

export interface EconomicEvent {
  date: Date;
  currency: string;
  impact: "high" | "medium";
  title: string;
  forecast: string | null;
  previous: string | null;
  hoursUntil: number; // negatif = sudah lewat
}

export interface CalendarAnalysis {
  upcomingHighImpact: EconomicEvent[];
  nextEventHours: number | null;
  confidenceAdjustment: number; // 0 atau negatif
  warningMessage: string | null;
  fetchedAt: string;
}

// ─── Cache (30 menit) ─────────────────────────────────────────────────────────
let _cache: CalendarAnalysis | null = null;
let _cacheAt = 0;
const CACHE_TTL = 30 * 60 * 1_000;

// ─── Fetch raw data ────────────────────────────────────────────────────────────

interface FfEvent {
  date: string;       // ISO-like string: "01-15-2025"
  time: string;       // "8:30am" or ""
  country: string;    // "USD"
  impact: string;     // "High" | "Medium" | "Low"
  title: string;
  forecast: string;
  previous: string;
}

async function fetchForexFactory(): Promise<FfEvent[]> {
  const res = await fetch(
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=1",
    {
      headers: { "User-Agent": "Mozilla/5.0 GoldRadar/1.0" },
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`FF calendar HTTP ${res.status}`);
  return res.json() as Promise<FfEvent[]>;
}

function parseEventDate(dateStr: string, timeStr: string): Date | null {
  try {
    // dateStr format: "2025-01-15T00:00:00-0500" or "01-15-2025"
    // timeStr: "8:30am" | "All Day" | ""
    let base: Date;

    if (dateStr.includes("T")) {
      base = new Date(dateStr);
    } else {
      // "MM-DD-YYYY"
      const parts = dateStr.split("-");
      if (parts.length !== 3) return null;
      const [mm, dd, yyyy] = parts;
      base = new Date(`${yyyy}-${mm}-${dd}T00:00:00-05:00`); // ET default
    }

    if (isNaN(base.getTime())) return null;

    // Try to parse time string
    if (timeStr && timeStr !== "All Day") {
      const m = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = parseInt(m[2], 10);
        const ampm = m[3].toLowerCase();
        if (ampm === "pm" && h !== 12) h += 12;
        if (ampm === "am" && h === 12) h = 0;
        base.setUTCHours(h + 5, min, 0, 0); // ET + 5 = UTC (rough)
      }
    }

    return base;
  } catch {
    return null;
  }
}

export async function getCalendarAnalysis(): Promise<CalendarAnalysis> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL) return _cache;

  try {
    const raw = await fetchForexFactory();
    const nowDate = new Date();
    const events: EconomicEvent[] = [];

    for (const item of raw) {
      if (item.country !== "USD") continue;
      const impact = item.impact === "High" ? "high" : item.impact === "Medium" ? "medium" : null;
      if (!impact) continue;

      const eventDate = parseEventDate(item.date, item.time);
      if (!eventDate) continue;

      const hoursUntil = (eventDate.getTime() - nowDate.getTime()) / 3_600_000;
      // Window: -2h (just passed) to +48h (upcoming)
      if (hoursUntil < -2 || hoursUntil > 48) continue;

      events.push({
        date: eventDate,
        currency: item.country,
        impact,
        title: item.title,
        forecast: item.forecast || null,
        previous: item.previous || null,
        hoursUntil: parseFloat(hoursUntil.toFixed(2)),
      });
    }

    events.sort((a, b) => a.hoursUntil - b.hoursUntil);

    const highImpact = events.filter((e) => e.impact === "high");
    const upcoming = highImpact.filter((e) => e.hoursUntil > 0);
    const recentPast = highImpact.filter((e) => e.hoursUntil >= -2 && e.hoursUntil <= 0);

    let confidenceAdjustment = 0;
    let warningMessage: string | null = null;
    let nextEventHours: number | null = null;

    if (upcoming.length > 0) {
      const next = upcoming[0];
      nextEventHours = next.hoursUntil;

      if (next.hoursUntil < 1) {
        confidenceAdjustment = -0.15;
        warningMessage = `🚨 DANGER: "${next.title}" rilis dalam ${(next.hoursUntil * 60).toFixed(0)} menit! JANGAN buka posisi baru — volatilitas ekstrem.`;
      } else if (next.hoursUntil < 4) {
        confidenceAdjustment = -0.10;
        warningMessage = `⚠️ "${next.title}" dalam ${next.hoursUntil.toFixed(1)} jam. Kurangi ukuran posisi, confidence dipangkas 10%.`;
      } else if (next.hoursUntil < 12) {
        confidenceAdjustment = -0.06;
        warningMessage = `📅 High-impact event "${next.title}" dalam ${next.hoursUntil.toFixed(0)} jam — waspadai volatilitas mendekati rilis.`;
      } else if (next.hoursUntil < 24) {
        confidenceAdjustment = -0.03;
        warningMessage = `📅 "${next.title}" besok (${next.hoursUntil.toFixed(0)}j lagi) — sinyal masih valid, pertahankan stop loss ketat.`;
      }
    }

    // Post-event volatility: 2h setelah rilis besar
    if (recentPast.length > 0) {
      const last = recentPast[recentPast.length - 1];
      const adjustment = -0.08;
      if (adjustment < confidenceAdjustment) confidenceAdjustment = adjustment;
      const minAgo = (Math.abs(last.hoursUntil) * 60).toFixed(0);
      warningMessage = (warningMessage ? warningMessage + " | " : "") +
        `📊 "${last.title}" baru rilis ${minAgo} menit lalu — pasar masih dalam fase volatilitas pasca-berita.`;
    }

    const result: CalendarAnalysis = {
      upcomingHighImpact: highImpact.slice(0, 5),
      nextEventHours,
      confidenceAdjustment,
      warningMessage,
      fetchedAt: new Date().toISOString(),
    };
    _cache = result;
    _cacheAt = now;
    return result;
  } catch (err) {
    console.warn("[Calendar] Gagal fetch:", (err as Error).message);
    const fallback: CalendarAnalysis = {
      upcomingHighImpact: [],
      nextEventHours: null,
      confidenceAdjustment: 0,
      warningMessage: null,
      fetchedAt: new Date().toISOString(),
    };
    _cache = fallback;
    _cacheAt = now;
    return fallback;
  }
}
