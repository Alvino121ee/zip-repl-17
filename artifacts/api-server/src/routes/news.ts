import { Router } from "express";
import { db } from "@workspace/db";
import { newsArticlesTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { fetchAllNews, fetchNewsForTicker } from "../lib/news-collector";
import { logger } from "../lib/logger";

const router = Router();

// ── POST /news/sync ───────────────────────────────────────────────────────────
router.post("/sync", async (req, res) => {
  try {
    const articles = await fetchAllNews(100);
    let inserted = 0;

    for (const a of articles) {
      try {
        await db
          .insert(newsArticlesTable)
          .values({
            title: a.title,
            link: a.link,
            summary: a.summary,
            source: a.source,
            publishedAt: a.publishedAt,
            tickers: a.tickers,
          })
          .onConflictDoNothing();
        inserted++;
      } catch {
        // skip duplicates
      }
    }

    res.json({ fetched: articles.length, inserted });
  } catch (err) {
    req.log.error({ err }, "news sync error");
    res.status(500).json({ error: "Gagal sync berita" });
  }
});

// ── GET /news/feed ────────────────────────────────────────────────────────────
router.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "30")), 100);

    // Coba ambil dari DB dulu (cache), jika kosong fetch live
    const cached = await db
      .select()
      .from(newsArticlesTable)
      .orderBy(desc(newsArticlesTable.publishedAt))
      .limit(limit);

    if (cached.length > 0) {
      res.json(cached.map(mapArticle));
      return;
    }

    // Tidak ada cache — fetch live
    const live = await fetchAllNews(limit);
    res.json(live.map(a => ({
      id: 0,
      title: a.title,
      link: a.link,
      summary: a.summary,
      source: a.source,
      publishedAt: a.publishedAt.toISOString(),
      tickers: a.tickers,
    })));
  } catch (err) {
    req.log.error({ err }, "news feed error");
    res.status(500).json({ error: "Gagal memuat berita" });
  }
});

// ── GET /news/live ────────────────────────────────────────────────────────────
// Selalu fetch langsung dari RSS (tidak pakai cache DB)
router.get("/live", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 100);
    const ticker = req.query.ticker as string | undefined;

    const articles = ticker
      ? await fetchNewsForTicker(ticker.toUpperCase(), limit)
      : await fetchAllNews(limit);

    res.json(articles.map(a => ({
      title: a.title,
      link: a.link,
      summary: a.summary,
      source: a.source,
      publishedAt: a.publishedAt.toISOString(),
      tickers: a.tickers,
    })));
  } catch (err) {
    req.log.error({ err }, "news live error");
    res.status(500).json({ error: "Gagal memuat berita live" });
  }
});

// ── GET /news/stock/:ticker ───────────────────────────────────────────────────
router.get("/stock/:ticker", async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const articles = await fetchNewsForTicker(ticker, 20);
    res.json(articles.map(a => ({
      title: a.title,
      link: a.link,
      summary: a.summary,
      source: a.source,
      publishedAt: a.publishedAt.toISOString(),
      tickers: a.tickers,
    })));
  } catch (err) {
    req.log.error({ err }, "news stock error");
    res.status(500).json({ error: "Gagal memuat berita saham" });
  }
});

function mapArticle(a: typeof newsArticlesTable.$inferSelect) {
  return {
    id: a.id,
    title: a.title,
    link: a.link,
    summary: a.summary ?? "",
    source: a.source,
    publishedAt: a.publishedAt.toISOString(),
    tickers: a.tickers ?? [],
  };
}

export default router;
