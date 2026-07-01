import { Router } from "express";
import { db } from "@workspace/db";
import {
  agentConfigsTable,
  agentMemoriesTable,
  stocksTable,
  stockScoresTable,
  stockFundamentalsTable,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { chatWithAgent, ensureAgentsExist } from "../lib/agent-engine";
import { logger } from "../lib/logger";

const router = Router();

// Seed agents on first request
let seeded = false;
router.use(async (_req, _res, next) => {
  if (!seeded) {
    try {
      await ensureAgentsExist();
      seeded = true;
    } catch (err) {
      logger.warn({ err }, "Gagal seed agents");
    }
  }
  next();
});

// ── GET /agents ───────────────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const agents = await db
    .select()
    .from(agentConfigsTable)
    .where(eq(agentConfigsTable.isActive, true))
    .orderBy(asc(agentConfigsTable.id));

  res.json(agents.map(mapAgent));
});

// ── GET /agents/:agentId ──────────────────────────────────────────────────────
router.get("/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const [agent] = await db
    .select()
    .from(agentConfigsTable)
    .where(eq(agentConfigsTable.agentId, agentId))
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: "Agent tidak ditemukan" });
    return;
  }
  res.json(mapAgent(agent));
});

// ── POST /agents/:agentId/chat ────────────────────────────────────────────────
router.post("/:agentId/chat", async (req, res) => {
  const { agentId } = req.params;
  const { message, sessionId } = req.body as { message?: string; sessionId?: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "Pesan tidak boleh kosong" });
    return;
  }

  if (!sessionId) {
    res.status(400).json({ error: "sessionId wajib diisi" });
    return;
  }
  const sid = sessionId;

  try {
    // Build context data berdasarkan agent type
    let contextData: string | undefined;

    if (agentId === "fundamental") {
      // Inject top 10 saham dengan data fundamental
      const stocks = await db
        .select({
          ticker: stocksTable.ticker,
          name: stocksTable.name,
          sector: stocksTable.sector,
          totalScore: stockScoresTable.totalScore,
          label: stockScoresTable.label,
          pe: stockFundamentalsTable.pe,
          pb: stockFundamentalsTable.pb,
          roe: stockFundamentalsTable.roe,
          debtEquity: stockFundamentalsTable.debtEquity,
          dividendYield: stockFundamentalsTable.dividendYield,
          currentPrice: stockScoresTable.currentPrice,
        })
        .from(stocksTable)
        .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
        .leftJoin(stockFundamentalsTable, eq(stocksTable.ticker, stockFundamentalsTable.ticker))
        .where(eq(stocksTable.isActive, true))
        .orderBy(desc(stockScoresTable.totalScore))
        .limit(10);

      contextData = stocks.map(s =>
        `${s.ticker} (${s.name}, ${s.sector}): Harga Rp ${parseFloat(s.currentPrice).toLocaleString("id-ID")} | Skor: ${parseFloat(s.totalScore).toFixed(1)} | P/E: ${s.pe ? parseFloat(s.pe).toFixed(1) : "N/A"} | P/B: ${s.pb ? parseFloat(s.pb).toFixed(1) : "N/A"} | ROE: ${s.roe ? (parseFloat(s.roe) * 100).toFixed(1) + "%" : "N/A"} | D/E: ${s.debtEquity ? parseFloat(s.debtEquity).toFixed(2) : "N/A"} | Yield: ${s.dividendYield ? (parseFloat(s.dividendYield) * 100).toFixed(1) + "%" : "N/A"}`
      ).join("\n");

    } else if (agentId === "technical") {
      // Inject top 10 saham dengan data teknikal
      const stocks = await db
        .select({
          ticker: stocksTable.ticker,
          name: stocksTable.name,
          totalScore: stockScoresTable.totalScore,
          trendScore: stockScoresTable.trendScore,
          momentumScore: stockScoresTable.momentumScore,
          riskScore: stockScoresTable.riskScore,
          rsi14: stockScoresTable.rsi14,
          ma20: stockScoresTable.ma20,
          ma50: stockScoresTable.ma50,
          ma200: stockScoresTable.ma200,
          currentPrice: stockScoresTable.currentPrice,
          priceChangePct: stockScoresTable.priceChangePct,
          supportLevel: stockScoresTable.supportLevel,
          resistanceLevel: stockScoresTable.resistanceLevel,
          label: stockScoresTable.label,
        })
        .from(stocksTable)
        .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
        .where(eq(stocksTable.isActive, true))
        .orderBy(desc(stockScoresTable.totalScore))
        .limit(10);

      contextData = stocks.map(s =>
        `${s.ticker} (${s.name}): Rp ${parseFloat(s.currentPrice).toLocaleString("id-ID")} (${parseFloat(s.priceChangePct) >= 0 ? "+" : ""}${(parseFloat(s.priceChangePct) * 100).toFixed(2)}%) | Skor: ${parseFloat(s.totalScore).toFixed(1)} | Tren: ${parseFloat(s.trendScore).toFixed(0)} | RSI: ${s.rsi14 ? parseFloat(s.rsi14).toFixed(1) : "N/A"} | MA20: ${s.ma20 ? "Rp " + parseFloat(s.ma20).toLocaleString("id-ID") : "N/A"} | Support: ${s.supportLevel ? "Rp " + parseFloat(s.supportLevel).toLocaleString("id-ID") : "N/A"} | Resistance: ${s.resistanceLevel ? "Rp " + parseFloat(s.resistanceLevel).toLocaleString("id-ID") : "N/A"}`
      ).join("\n");

    } else if (agentId === "screening") {
      // Inject top 20 saham sorted by total score
      const stocks = await db
        .select({
          ticker: stocksTable.ticker,
          name: stocksTable.name,
          sector: stocksTable.sector,
          totalScore: stockScoresTable.totalScore,
          label: stockScoresTable.label,
          currentPrice: stockScoresTable.currentPrice,
          priceChangePct: stockScoresTable.priceChangePct,
          trendScore: stockScoresTable.trendScore,
          momentumScore: stockScoresTable.momentumScore,
          riskScore: stockScoresTable.riskScore,
        })
        .from(stocksTable)
        .innerJoin(stockScoresTable, eq(stocksTable.ticker, stockScoresTable.ticker))
        .where(eq(stocksTable.isActive, true))
        .orderBy(desc(stockScoresTable.totalScore))
        .limit(20);

      contextData = "TOP 20 SAHAM SKOR AI TERTINGGI:\n" + stocks.map((s, i) =>
        `${i + 1}. ${s.ticker} (${s.name}, ${s.sector}): Rp ${parseFloat(s.currentPrice).toLocaleString("id-ID")} | ${parseFloat(s.priceChangePct) >= 0 ? "+" : ""}${(parseFloat(s.priceChangePct) * 100).toFixed(2)}% | Skor: ${parseFloat(s.totalScore).toFixed(1)} | ${s.label}`
      ).join("\n");
    }

    const result = await chatWithAgent(agentId, sid, message.trim(), contextData);
    res.json({ ...result, agentId, sessionId: sid });
  } catch (err) {
    req.log.error({ err, agentId }, "agent chat error");
    res.status(500).json({ error: "Gagal memproses pertanyaan" });
  }
});

// ── GET /agents/:agentId/memory ───────────────────────────────────────────────
router.get("/:agentId/memory", async (req, res) => {
  const { agentId } = req.params;
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId) {
    res.json([]); // Return empty if no session yet
    return;
  }

  const memories = await db
    .select()
    .from(agentMemoriesTable)
    .where(
      and(
        eq(agentMemoriesTable.agentId, agentId),
        eq(agentMemoriesTable.sessionId, sessionId)
      )
    )
    .orderBy(asc(agentMemoriesTable.createdAt));

  res.json(
    memories.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

// ── DELETE /agents/:agentId/memory ────────────────────────────────────────────
router.delete("/:agentId/memory", async (req, res) => {
  const { agentId } = req.params;
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId wajib diisi" });
    return;
  }

  await db
    .delete(agentMemoriesTable)
    .where(
      and(
        eq(agentMemoriesTable.agentId, agentId),
        eq(agentMemoriesTable.sessionId, sessionId)
      )
    );

  res.json({ success: true, message: "Memori dihapus" });
});

// ── PUT /agents/:agentId/config ───────────────────────────────────────────────
router.put("/:agentId/config", async (req, res) => {
  const { agentId } = req.params;
  const { systemPrompt, trainingExamples, name, description } = req.body as {
    systemPrompt?: string;
    trainingExamples?: Array<{ input: string; output: string }>;
    name?: string;
    description?: string;
  };

  const [agent] = await db
    .select()
    .from(agentConfigsTable)
    .where(eq(agentConfigsTable.agentId, agentId))
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: "Agent tidak ditemukan" });
    return;
  }

  await db
    .update(agentConfigsTable)
    .set({
      ...(systemPrompt !== undefined && { systemPrompt }),
      ...(trainingExamples !== undefined && { trainingExamples: JSON.stringify(trainingExamples) }),
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
    })
    .where(eq(agentConfigsTable.agentId, agentId));

  const [updated] = await db
    .select()
    .from(agentConfigsTable)
    .where(eq(agentConfigsTable.agentId, agentId))
    .limit(1);

  res.json(mapAgent(updated));
});

function mapAgent(a: typeof agentConfigsTable.$inferSelect) {
  let examples: Array<{ input: string; output: string }> = [];
  try {
    examples = JSON.parse(a.trainingExamples);
  } catch {
    examples = [];
  }
  return {
    agentId: a.agentId,
    name: a.name,
    description: a.description,
    avatar: a.avatar,
    color: a.color,
    systemPrompt: a.systemPrompt,
    trainingExamples: examples,
    isActive: a.isActive,
    updatedAt: a.updatedAt.toISOString(),
  };
}

export default router;
