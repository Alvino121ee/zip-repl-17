/**
 * Internal helper — expose getValue/setValue from xauusd-settings
 * agar pakasir.ts bisa import tanpa circular dependency
 */
import { db } from "@workspace/db";
import { xauusdSettingsTable } from "@workspace/db/schema";

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5_000;

async function loadCache(): Promise<Map<string, string>> {
  if (cache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return cache;
  const rows = await db.select().from(xauusdSettingsTable);
  cache = new Map(rows.map((r) => [r.key, r.value]));
  cacheLoadedAt = Date.now();
  return cache;
}

export async function getValue(key: string): Promise<string | null> {
  try {
    const map = await loadCache();
    return map.get(key) ?? null;
  } catch { return null; }
}

export async function setValue(key: string, value: string): Promise<void> {
  await db
    .insert(xauusdSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: xauusdSettingsTable.key, set: { value, updatedAt: new Date() } });
  cache = null;
}
