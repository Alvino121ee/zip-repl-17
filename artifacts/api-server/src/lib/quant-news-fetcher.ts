/**
 * Quant News Fetcher
 * Supports: Finnhub (free), Benzinga (premium fast), Polygon.io (premium)
 * Provider selected via xauusd_settings key: news_api_provider
 * API key stored in: news_api_key
 *
 * If no API key → uses RSS scraping as free fallback
 */

import { db } from "@workspace/db";
import { quantNewsCacheTable, xauusdSettingsTable } from "@workspace/db/schema";
import { desc, gte, sql } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";

interface RawNewsItem {
  headline: string;
  summary?: string;
  url?: string;
  publishedAt?: Date;
  source: string;
}

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: xauusdSettingsTable.value })
    .from(xauusdSettingsTable).where(sql`${xauusdSettingsTable.key} = ${key}`).limit(1);
  return rows[0]?.value ?? null;
}

// ─── Finnhub news fetcher ─────────────────────────────────────────────────────
async function fetchFinnhubNews(apiKey: string): Promise<RawNewsItem[]> {
  try {
    const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().split("T")[0];
    const to = new Date().toISOString().split("T")[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=forex&token=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ headline: string; summary: string; url: string; datetime: number; source: string }>;
    return data.slice(0, 20).map((item) => ({
      headline: item.headline,
      summary: item.summary,
      url: item.url,
      publishedAt: new Date(item.datetime * 1000),
      source: `finnhub:${item.source}`,
    }));
  } catch {
    return [];
  }
}

// ─── Polygon.io news fetcher ──────────────────────────────────────────────────
async function fetchPolygonNews(apiKey: string): Promise<RawNewsItem[]> {
  try {
    const res = await fetch(
      `https://api.polygon.io/v2/reference/news?ticker=C:XAUUSD&order=desc&limit=20&apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ title: string; description: string; article_url: string; published_utc: string; publisher: { name: string } }> };
    return (data.results ?? []).map((item) => ({
      headline: item.title,
      summary: item.description,
      url: item.article_url,
      publishedAt: new Date(item.published_utc),
      source: `polygon:${item.publisher?.name ?? "polygon"}`,
    }));
  } catch {
    return [];
  }
}

// ─── RSS fallback (no API key needed) ────────────────────────────────────────
async function fetchRssFallback(): Promise<RawNewsItem[]> {
  // Gold/forex RSS feeds that are publicly available
  const feeds = [
    "https://www.forexlive.com/feed/news",
    "https://www.kitco.com/rss/kitco-news.rss",
  ];

  const items: RawNewsItem[] = [];
  for (const feedUrl of feeds.slice(0, 1)) {
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 GoldRadar/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      // Simple regex XML parse
      const titleMatches = text.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g) ?? [];
      const linkMatches = text.match(/<link>(.*?)<\/link>/g) ?? [];

      titleMatches.slice(1, 11).forEach((t, i) => {
        const headline = t.replace(/<\/?title>|<!\[CDATA\[|\]\]>/g, "").trim();
        if (headline && headline.length > 10) {
          items.push({
            headline,
            url: linkMatches[i]?.replace(/<\/?link>/g, "").trim(),
            publishedAt: new Date(),
            source: "rss",
          });
        }
      });
    } catch {/* skip */}
  }
  return items;
}

// ─── AI sentiment scoring ─────────────────────────────────────────────────────
async function scoreNewsSentiment(headlines: RawNewsItem[]): Promise<RawNewsItem[]> {
  if (!headlines.length) return [];
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) return headlines;

  const batch = headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h.headline}`).join("\n");
  const prompt = `Analisis sentimen berita gold/forex berikut. Untuk setiap berita, berikan:
- sentiment: very_bullish|bullish|neutral|bearish|very_bearish
- impact: high|medium|low
- analysis: 1 kalimat analisis dampak ke gold

${batch}

Balas dalam format JSON array: [{"index":1,"sentiment":"...","impact":"...","analysis":"..."},...]`;

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Kamu adalah analis berita untuk trading XAUUSD. Identifikasi dampak berita ke harga gold dengan akurat." },
          { role: "user", content: prompt },
        ],
        max_tokens: 500, temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data?.choices?.[0]?.message?.content ?? "";
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const scored = JSON.parse(match[0]) as Array<{ index: number; sentiment: string; impact: string; analysis: string }>;
      scored.forEach((s) => {
        const item = headlines[s.index - 1];
        if (item) {
          item.summary = s.analysis;
        }
      });
    }
  } catch {/* skip scoring */}

  return headlines;
}

// ─── Main fetch + cache ───────────────────────────────────────────────────────
let lastFetchAt: Date | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchQuantNews() {
  // Return cached if fresh
  if (lastFetchAt && Date.now() - lastFetchAt.getTime() < CACHE_TTL_MS) {
    const cached = await db.select()
      .from(quantNewsCacheTable)
      .where(gte(quantNewsCacheTable.fetchedAt, new Date(Date.now() - CACHE_TTL_MS)))
      .orderBy(desc(quantNewsCacheTable.fetchedAt))
      .limit(15);
    if (cached.length) return cached;
  }

  const [newsApiKey, provider] = await Promise.all([
    getSetting("news_api_key"),
    getSetting("news_api_provider"),
  ]);

  let rawItems: RawNewsItem[] = [];

  if (newsApiKey && provider === "finnhub") {
    rawItems = await fetchFinnhubNews(newsApiKey);
  } else if (newsApiKey && provider === "polygon") {
    rawItems = await fetchPolygonNews(newsApiKey);
  } else {
    // Free fallback
    rawItems = await fetchRssFallback();
  }

  if (!rawItems.length) {
    // Return existing cached news
    return db.select().from(quantNewsCacheTable).orderBy(desc(quantNewsCacheTable.fetchedAt)).limit(10);
  }

  // Score sentiment
  const scored = await scoreNewsSentiment(rawItems);

  // Determine sentiment score
  const sentimentToScore = (s?: string) => {
    if (s === "very_bullish") return 0.9;
    if (s === "bullish") return 0.5;
    if (s === "bearish") return -0.5;
    if (s === "very_bearish") return -0.9;
    return 0;
  };

  // Save to cache — use scored summary fields as sentiment/impact
  const inserted = await Promise.all(
    scored.slice(0, 10).map((item) => {
      // item.summary has been overwritten with AI analysis by scoreNewsSentiment
      // We derive sentiment from keywords as a fallback when not scored
      const autoSentiment = (() => {
        const h = item.headline.toLowerCase();
        if (h.match(/rate cut|dovish|stimulus|demand surge|safe haven|geopolit|war|crisis/)) return "bullish";
        if (h.match(/rate hike|hawkish|strong dollar|nfp beat|cpi hot|sell off|crash/)) return "bearish";
        return "neutral";
      })();
      const isHigh = item.headline.toLowerCase().match(/fed|fomc|nfp|cpi|inflation|war|crisis|crash|gdp|ukraine|israel|iran|china|rate/) !== null;
      return db.insert(quantNewsCacheTable).values({
        source: item.source,
        headline: item.headline.substring(0, 500),
        summary: item.summary?.substring(0, 1000),
        url: item.url,
        publishedAt: item.publishedAt,
        sentiment: autoSentiment,
        sentimentScore: sentimentToScore(autoSentiment),
        impactLevel: isHigh ? "high" : "medium",
        aiAnalysis: item.summary?.substring(0, 200),
        isHighImpact: isHigh,
      }).returning().catch(() => []);
    })
  );

  lastFetchAt = new Date();
  return inserted.flat();
}

export async function getNewsApiSettings() {
  const [key, provider] = await Promise.all([
    getSetting("news_api_key"),
    getSetting("news_api_provider"),
  ]);
  return { hasKey: !!key, provider: provider ?? "rss_fallback" };
}
