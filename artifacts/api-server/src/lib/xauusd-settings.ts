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
const KEY_XAUUSD_BRAIN_ENABLED = "xauusd_brain_enabled";
const KEY_BTCUSD_BRAIN_ENABLED = "btcusd_brain_enabled";
const KEY_AI_API_KEY = "ai_api_key";
const KEY_AI_API_BASE_URL = "ai_api_base_url";
const KEY_AI_MODEL = "ai_model";

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

// ─── Brain engine enable/disable ──────────────────────────────────────────────

export async function isXauusdBrainEnabled(): Promise<boolean> {
  const v = await getValue(KEY_XAUUSD_BRAIN_ENABLED);
  return v !== "false"; // default: enabled
}

export async function setXauusdBrainEnabled(enabled: boolean): Promise<void> {
  await setValue(KEY_XAUUSD_BRAIN_ENABLED, enabled ? "true" : "false");
}

export async function isBtcusdBrainEnabled(): Promise<boolean> {
  const v = await getValue(KEY_BTCUSD_BRAIN_ENABLED);
  return v !== "false"; // default: enabled
}

export async function setBtcusdBrainEnabled(enabled: boolean): Promise<void> {
  await setValue(KEY_BTCUSD_BRAIN_ENABLED, enabled ? "true" : "false");
}

// ─── AI API Key (OpenAI / OpenAI-compatible) ──────────────────────────────────

/** Update atau hapus satu baris di file .env workspace root — atomic (temp + rename) */
async function writeEnvFileLine(envKey: string, value: string): Promise<void> {
  const { readFile, writeFile, rename } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const envPath = "/home/runner/workspace/.env";
  const tmpPath = envPath + ".tmp";

  const content = existsSync(envPath) ? await readFile(envPath, "utf-8") : "";
  const lines = content.split("\n");
  const prefix = envKey + "=";
  const idx = lines.findIndex((l) => l.startsWith(prefix));

  if (value) {
    const needsQuote = /[ #$"'`\\]/.test(value);
    const escaped = needsQuote ? '"' + value.replace(/"/g, '\\"') + '"' : value;
    if (idx >= 0) {
      lines[idx] = envKey + "=" + escaped;
    } else {
      lines.push(envKey + "=" + escaped);
    }
  } else {
    if (idx >= 0) lines.splice(idx, 1);
  }

  const result = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  await writeFile(tmpPath, result ? result + "\n" : "", "utf-8");
  await rename(tmpPath, envPath);
}

export async function getAiApiKey(): Promise<string> {
  const fromDb = await getValue(KEY_AI_API_KEY);
  if (fromDb?.trim()) return fromDb.trim();
  return process.env.OPENAI_API_KEY ?? process.env.AI_API_KEY ?? "";
}

export async function setAiApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  await setValue(KEY_AI_API_KEY, trimmed);
  process.env.AI_API_KEY = trimmed;
  await writeEnvFileLine("AI_API_KEY", trimmed);
}

export async function clearAiApiKey(): Promise<void> {
  await db.delete(xauusdSettingsTable).where(eq(xauusdSettingsTable.key, KEY_AI_API_KEY));
  cache = null;
  process.env.AI_API_KEY = "";
  await writeEnvFileLine("AI_API_KEY", "");
}

export async function getAiApiBaseUrl(): Promise<string> {
  const fromDb = await getValue(KEY_AI_API_BASE_URL);
  if (fromDb?.trim()) return fromDb.trim();
  return process.env.AI_API_BASE_URL ?? "";
}

export async function setAiApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  await setValue(KEY_AI_API_BASE_URL, trimmed);
  process.env.AI_API_BASE_URL = trimmed;
  await writeEnvFileLine("AI_API_BASE_URL", trimmed);
}

export async function getAiModel(): Promise<string> {
  const fromDb = await getValue(KEY_AI_MODEL);
  if (fromDb?.trim()) return fromDb.trim();
  return process.env.AI_MODEL ?? "";
}

export async function setAiModel(model: string): Promise<void> {
  const trimmed = model.trim();
  await setValue(KEY_AI_MODEL, trimmed);
  process.env.AI_MODEL = trimmed;
  await writeEnvFileLine("AI_MODEL", trimmed);
}

/** Muat AI key dari DB ke process.env — dipanggil saat server startup */
export async function loadAiEnvFromDb(): Promise<void> {
  try {
    const [key, baseUrl, model] = await Promise.all([
      getValue(KEY_AI_API_KEY),
      getValue(KEY_AI_API_BASE_URL),
      getValue(KEY_AI_MODEL),
    ]);
    if (key?.trim()) process.env.AI_API_KEY = key.trim();
    if (baseUrl?.trim()) process.env.AI_API_BASE_URL = baseUrl.trim();
    if (model?.trim()) process.env.AI_MODEL = model.trim();
  } catch (err) {
    console.error("[xauusd-settings] loadAiEnvFromDb error:", err);
  }
}

export async function getSettingsSummary(): Promise<{
  hasDeepseekKey: boolean;
  deepseekKeySource: "database" | "environment" | "none";
  hasAiKey: boolean;
  aiKeySource: "database" | "environment" | "none";
  aiBaseUrl: string;
  aiModel: string;
  predictionTimeframeMinutes: PredictionTimeframeMinutes;
  whatsapp: {
    number: string;
    enabled: boolean;
  };
  validTimeframes: readonly number[];
}> {
  const [fromDbDeepseek, fromDbAiKey, fromDbBaseUrl, fromDbModel] = await Promise.all([
    getValue(KEY_DEEPSEEK),
    getValue(KEY_AI_API_KEY),
    getValue(KEY_AI_API_BASE_URL),
    getValue(KEY_AI_MODEL),
  ]);

  const hasDbDeepseek = !!fromDbDeepseek?.trim();
  const hasEnvDeepseek = !!process.env.DEEPSEEK_API_KEY;
  const hasDbAiKey = !!fromDbAiKey?.trim();
  const hasEnvAiKey = !!(process.env.OPENAI_API_KEY || process.env.AI_API_KEY);

  return {
    hasDeepseekKey: hasDbDeepseek || hasEnvDeepseek,
    deepseekKeySource: hasDbDeepseek ? "database" : hasEnvDeepseek ? "environment" : "none",
    hasAiKey: hasDbAiKey || hasEnvAiKey,
    aiKeySource: hasDbAiKey ? "database" : hasEnvAiKey ? "environment" : "none",
    aiBaseUrl: fromDbBaseUrl?.trim() || process.env.AI_API_BASE_URL || "",
    aiModel: fromDbModel?.trim() || process.env.AI_MODEL || "",
    predictionTimeframeMinutes: await getPredictionTimeframeMinutes(),
    whatsapp: {
      number: await getWhatsappNumber(),
      enabled: await isWhatsappEnabled(),
    },
    validTimeframes: VALID_TIMEFRAMES,
  };
}
