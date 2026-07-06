/**
 * Real-time indicator cache for Mentor Mode.
 *
 * Calls TradingView Scanner every 30 seconds and keeps the result in memory.
 * This gives Mentor Mode fresh indicators (vs 5-minute DB snapshot) without
 * hammering TradingView on every client request.
 *
 * Pattern mirrors xauusd-live-price.ts.
 */

import { fetchXauusdIndicators, type XauusdIndicators } from "./xauusd-data.js";

const REFRESH_INTERVAL_MS = 30_000;   // 30 seconds
const STALE_THRESHOLD_MS  = 90_000;   // mark stale after 1.5 minutes without update

let latestIndicators: XauusdIndicators | null = null;
let lastFetchedAt: number | null = null;
let lastError: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    const data = await fetchXauusdIndicators("1h");
    if (data) {
      latestIndicators = data;
      lastFetchedAt = Date.now();
      lastError = null;
    }
  } catch (err) {
    lastError = String(err);
    // keep serving last known good indicators on failure
  } finally {
    inFlight = false;
  }
}

export function startMentorIndicatorsTicker(): void {
  if (timer) return;
  void tick(); // fetch immediately on start
  timer = setInterval(() => void tick(), REFRESH_INTERVAL_MS);
}

export function stopMentorIndicatorsTicker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export interface MentorIndicatorsSnapshot {
  indicators: XauusdIndicators | null;
  fetchedAt: number | null;
  ageMs: number | null;
  stale: boolean;
  error: string | null;
}

export function getLatestMentorIndicators(): MentorIndicatorsSnapshot {
  const ageMs = lastFetchedAt ? Date.now() - lastFetchedAt : null;
  return {
    indicators: latestIndicators,
    fetchedAt:  lastFetchedAt,
    ageMs,
    stale: ageMs === null || ageMs > STALE_THRESHOLD_MS,
    error: lastError,
  };
}
