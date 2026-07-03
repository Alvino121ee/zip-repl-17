/**
 * XAUUSD app settings — key/value store in DB so the DeepSeek API key and
 * prediction timeframe can be configured from the website instead of only
 * via environment secrets. Falls back to env vars when no DB value is set.
 */

import { db } from "@workspace/db";
import { xauusdSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const KEY_DEEPSEEK = "deepseek_api_key";
const KEY_TIMEFRAME = "prediction_timeframe_minutes";
const KEY_WHATSAPP_NUMBER = "whatsapp_number";
const KEY_WHATSAPP_ENABLED = "whatsapp_enabled";
const KEY_MEMBER_PASSWORD = "member_password";

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5_000;

async function loadCache(): Promise<Map<string, string>> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;
  const rows = await db.select().from(xauusdSettingsTable);
  cache = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
  cacheLoadedAt = Date.now();
  return cache;
}

async function getValue(key: string): Promise<string | null> {
  try {
    const map = await loadCache();
    return map.get(key) ?? null;
  } catch (err) {
    console.error("[xauusd-settings] getValue error:", err);
    return null;
  }
}

async function setValue(key: string, value: string): Promise<void> {
  await db
    .insert(xauusdSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: xauusdSettingsTable.key,
      set: { value, updatedAt: new Date() },
    });
  cache = null; // invalidate cache
}

export async function getDeepseekApiKey(): Promise<string> {
  const fromDb = await getValue(KEY_DEEPSEEK);
  if (fromDb && fromDb.trim().length > 0) return fromDb.trim();
  return process.env.DEEPSEEK_API_KEY ?? "";
}

export async function setDeepseekApiKey(key: string): Promise<void> {
  await setValue(KEY_DEEPSEEK, key.trim());
}

export async function clearDeepseekApiKey(): Promise<void> {
  await db.delete(xauusdSettingsTable).where(eq(xauusdSettingsTable.key, KEY_DEEPSEEK));
  cache = null;
}

export const VALID_TIMEFRAMES = [15, 30] as const;
export type PredictionTimeframeMinutes = (typeof VALID_TIMEFRAMES)[number];

export async function getPredictionTimeframeMinutes(): Promise<PredictionTimeframeMinutes> {
  const fromDb = await getValue(KEY_TIMEFRAME);
  const parsed = fromDb ? parseInt(fromDb, 10) : NaN;
  if (VALID_TIMEFRAMES.includes(parsed as PredictionTimeframeMinutes)) {
    return parsed as PredictionTimeframeMinutes;
  }
  return 15;
}

export async function setPredictionTimeframeMinutes(minutes: number): Promise<void> {
  if (!VALID_TIMEFRAMES.includes(minutes as PredictionTimeframeMinutes)) {
    throw new Error(`Invalid timeframe: ${minutes}. Must be one of ${VALID_TIMEFRAMES.join(", ")}`);
  }
  await setValue(KEY_TIMEFRAME, String(minutes));
}

// ─── WhatsApp notification settings ───────────────────────────────────────────

export async function getWhatsappNumber(): Promise<string> {
  const fromDb = await getValue(KEY_WHATSAPP_NUMBER);
  return fromDb?.trim() ?? "";
}

export async function setWhatsappNumber(number: string): Promise<void> {
  await setValue(KEY_WHATSAPP_NUMBER, number.trim());
}

export function isWhatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function isWhatsappEnabled(): Promise<boolean> {
  const fromDb = await getValue(KEY_WHATSAPP_ENABLED);
  return fromDb === "true";
}

export async function setWhatsappEnabled(enabled: boolean): Promise<void> {
  await setValue(KEY_WHATSAPP_ENABLED, enabled ? "true" : "false");
}

// ─── Member password ──────────────────────────────────────────────────────────
export async function getMemberPassword(): Promise<string | null> {
  const v = await getValue(KEY_MEMBER_PASSWORD);
  return v && v.trim().length > 0 ? v.trim() : null;
}

export async function setMemberPassword(password: string): Promise<void> {
  await setValue(KEY_MEMBER_PASSWORD, password.trim());
}

export async function clearMemberPassword(): Promise<void> {
  await db.delete(xauusdSettingsTable).where(eq(xauusdSettingsTable.key, KEY_MEMBER_PASSWORD));
  cache = null;
}

export async function getSettingsSummary(): Promise<{
  hasDeepseekKey: boolean;
  deepseekKeySource: "database" | "environment" | "none";
  predictionTimeframeMinutes: PredictionTimeframeMinutes;
  whatsapp: {
    number: string;
    enabled: boolean;
  };
}> {
  const fromDb = await getValue(KEY_DEEPSEEK);
  const hasDbKey = !!fromDb && fromDb.trim().length > 0;
  const hasEnvKey = !!process.env.DEEPSEEK_API_KEY;
  return {
    hasDeepseekKey: hasDbKey || hasEnvKey,
    deepseekKeySource: hasDbKey ? "database" : hasEnvKey ? "environment" : "none",
    predictionTimeframeMinutes: await getPredictionTimeframeMinutes(),
    whatsapp: {
      number: await getWhatsappNumber(),
      enabled: await isWhatsappEnabled(),
    },
  };
}
