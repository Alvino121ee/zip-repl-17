import { Router } from "express";
import { db } from "@workspace/db";
import {
  stocksTable,
  stockScoresTable,
  stockFundamentalsTable,
  aiInsightsTable,
  newsArticlesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { analyzeStock, isAiEnabled } from "../lib/deepseek-analyst";
import { fetchNewsForTicker, fetchAllNews } from "../lib/news-collector";
import { logger } from "../lib/logger";

const router = Router();

// ── GET /ai/status ─────────────────────────────────────────────────────────
router.get("/status", (_req, res) => {
  res.json({ aiEnabled: isAiEnabled(), provider: isAiEnabled() ? "DeepSeek" : "Rule-based" });
});

// ── GET /ai/insights/:ticker ──────────────────────────────────────────────────
router.get("/insights/:ticker", async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  try {
    // Cek cache
    const cached = await db
      .select()
      .from(aiInsightsTable)
      .where(eq(aiInsightsTable.ticker, ticker))
      .limit(1);

    const cacheAgeHours = cached[0]
      ? (Date.now() - cached[0].generatedAt.getTime()) / 3_600_000
      : Infinity;

    if (cached[0] && cacheAgeHours < 4) {
      res.json(mapInsight(cached[0]));
      return;
    }

    // Fetch data saham
    const [stockRows, scoreRows, fundRows] = await Promise.all([
      db.select().from(stocksTable).where(eq(stocksTable.ticker, ticker)).limit(1),
      db.select().from(stockScoresTable).where(eq(stockScoresTable.ticker, ticker)).limit(1),
      db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, ticker)).limit(1),
    ]);

    if (!stockRows[0] || !scoreRows[0]) {
      res.status(404).json({ error: "Saham tidak ditemukan" });
      return;
    }

    const stock = stockRows[0];
    const score = scoreRows[0];
    const fund = fundRows[0];
    const news = await fetchNewsForTicker(ticker, 5);

    const result = await analyzeStock({
      ticker,
      name: stock.name,
      sector: stock.sector,
      currentPrice: parseFloat(score.currentPrice),
      priceChangePct: parseFloat(score.priceChangePct),
      totalScore: parseFloat(score.totalScore),
      trendScore: parseFloat(score.trendScore),
      momentumScore: parseFloat(score.momentumScore),
      volumeScore: parseFloat(score.volumeScore),
      riskScore: parseFloat(score.riskScore),
      fundamentalScore: parseFloat(score.fundamentalScore),
      label: score.label,
      ma20: score.ma20 ? parseFloat(score.ma20) : null,
      ma50: score.ma50 ? parseFloat(score.ma50) : null,
      rsi14: score.rsi14 ? parseFloat(score.rsi14) : null,
      pe: fund?.pe ? parseFloat(fund.pe) : null,
      pb: fund?.pb ? parseFloat(fund.pb) : null,
      roe: fund?.roe ? parseFloat(fund.roe) : null,
      dividendYield: fund?.dividendYield ? parseFloat(fund.dividendYield) : null,
      recentNews: news.map(n => n.title),
    });

    // Simpan ke cache
    await db
      .insert(aiInsightsTable)
      .values({
        ticker: result.ticker,
        recommendation: result.recommendation,
        confidence: result.confidence,
        insight: result.insight,
        reasoning: result.reasoning,
        bullish: result.bullish,
        bearish: result.bearish,
      })
      .onConflictDoUpdate({
        target: aiInsightsTable.ticker,
        set: {
          recommendation: result.recommendation,
          confidence: result.confidence,
          insight: result.insight,
          reasoning: result.reasoning,
          bullish: result.bullish,
          bearish: result.bearish,
          generatedAt: new Date(),
        },
      });

    res.json({ ...result, aiPowered: isAiEnabled() });
  } catch (err) {
    req.log.error({ err, ticker }, "ai insight error");
    res.status(500).json({ error: "Gagal menganalisis saham" });
  }
});

// ── GET /ai/top-insights ──────────────────────────────────────────────────────
// Ambil insight untuk semua saham dengan score tertinggi
router.get("/top-insights", async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? "10")), 20);

    const top = await db
      .select({
        ticker: stocksTable.ticker,
        name: stocksTable.name,
        sector: stocksTable.sector,
        totalScore: stockScoresTable.totalScore,
        currentPrice: stockScoresTable.currentPrice,
        priceChangePct: stockScoresTable.priceChangePct,
        label: stockScoresTable.label,
      })
      .from(stocksTable)
      .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
      .where(eq(stocksTable.isActive, true))
      .orderBy(desc(stockScoresTable.totalScore))
      .limit(limit);

    // Cached insights
    const insights = await db
      .select()
      .from(aiInsightsTable)
      .where(
        eq(aiInsightsTable.ticker, top[0]?.ticker ?? "")
      );
    const insightMap = new Map(insights.map(i => [i.ticker, i]));

    res.json(top.map(s => ({
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      totalScore: parseFloat(s.totalScore),
      currentPrice: parseFloat(s.currentPrice),
      priceChangePct: parseFloat(s.priceChangePct),
      label: s.label,
      insight: insightMap.get(s.ticker) ? mapInsight(insightMap.get(s.ticker)!) : null,
    })));
  } catch (err) {
    req.log.error({ err }, "top insights error");
    res.status(500).json({ error: "Gagal memuat top insights" });
  }
});

// ── POST /ai/chat ─────────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
  const { message, ticker } = req.body as { message?: string; ticker?: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "Pesan tidak boleh kosong" });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.json({
      reply: "AI chat belum aktif. Tambahkan DEEPSEEK_API_KEY di Secrets untuk mengaktifkan fitur ini.",
      aiPowered: false,
    });
    return;
  }

  try {
    // Kumpulkan konteks pasar
    const [topStocks, newsArticles] = await Promise.all([
      db
        .select({
          ticker: stocksTable.ticker,
          name: stocksTable.name,
          totalScore: stockScoresTable.totalScore,
          currentPrice: stockScoresTable.currentPrice,
          priceChangePct: stockScoresTable.priceChangePct,
          label: stockScoresTable.label,
        })
        .from(stocksTable)
        .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
        .orderBy(desc(stockScoresTable.totalScore))
        .limit(10),
      fetchAllNews(10),
    ]);

    const marketCtx = topStocks.map(s =>
      `${s.ticker} (${s.name}): Rp ${parseFloat(s.currentPrice).toLocaleString("id-ID")} | Skor: ${parseFloat(s.totalScore).toFixed(1)} | ${s.label}`
    ).join("\n");

    const newsCtx = newsArticles.slice(0, 5).map(n => `- ${n.title}`).join("\n");

    const systemPrompt = `Kamu adalah AI Analis Saham BEI (Bursa Efek Indonesia) yang bernama SahamRadar AI. Kamu ahli dalam analisis teknikal, fundamental, dan berita pasar Indonesia. Selalu jawab dalam Bahasa Indonesia yang mudah dipahami.

KONTEKS PASAR SAAT INI (Top 10 Saham berdasarkan Skor AI):
${marketCtx}

BERITA TERKINI:
${newsCtx}

Berikan analisis yang actionable, jelas, dan berimbang. Selalu ingatkan bahwa ini bukan saran investasi resmi.`;

    const chatRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!chatRes.ok) {
      throw new Error(`DeepSeek HTTP ${chatRes.status}`);
    }

    const data = await chatRes.json() as { choices: Array<{ message: { content: string } }> };
    const reply = data.choices?.[0]?.message?.content ?? "Maaf, tidak dapat memproses pertanyaan.";

    res.json({ reply, aiPowered: true });
  } catch (err) {
    logger.error({ err }, "ai chat error");
    res.status(500).json({ error: "Gagal memproses pertanyaan AI" });
  }
});

function mapInsight(i: typeof aiInsightsTable.$inferSelect) {
  return {
    ticker: i.ticker,
    recommendation: i.recommendation,
    confidence: i.confidence,
    insight: i.insight,
    reasoning: i.reasoning,
    bullish: i.bullish,
    bearish: i.bearish,
    generatedAt: i.generatedAt.toISOString(),
  };
}

export default router;
