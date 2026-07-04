import { Router } from "express";
import { db } from "@workspace/db";
import {
  btcusdSnapshotsTable, btcusdBrainTable, btcusdQuestionsLogTable,
  btcusdPredictionsTable, btcusdLearningLogTable,
} from "@workspace/db/schema";
import { desc, eq, sql, and } from "drizzle-orm";
import { fetchBtcusdLivePrice } from "../lib/btcusd-data.js";
import {
  getBtcEngineStatus, runBtcLearningCycle,
  startBtcExtremeLearningMode, stopBtcExtremeLearningMode,
} from "../lib/btcusd-brain-engine.js";

type Req = import("express").Request;
type Res = import("express").Response;
type Next = import("express").NextFunction;

function requireAdmin(req: Req, res: Res, next: Next) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) { if (process.env.NODE_ENV !== "production") return next(); return res.status(403).json({ error: "Forbidden" }); }
  const token = ((req.headers.authorization as string) ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secret) return res.status(403).json({ error: "Forbidden — admin login diperlukan" });
  return next();
}

async function requireMember(req: Req, res: Res, next: Next) {
  const token = ((req.headers.authorization as string) ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Login diperlukan" });
  const secret = process.env.SESSION_SECRET;
  if (secret && token === secret) return next();
  try {
    const { getMemberPassword } = await import("../lib/xauusd-settings.js");
    const pwd = await getMemberPassword();
    if (pwd && token === pwd) return next();
  } catch { /**/ }
  return res.status(401).json({ error: "Akses member diperlukan" });
}

export const btcusdRouter = Router();

// ─── Live price ───────────────────────────────────────────────────────────────
btcusdRouter.get("/live-price", async (_req, res) => {
  try {
    const price = await fetchBtcusdLivePrice();
    res.json(price);
  } catch (err) {
    res.status(503).json({ error: "BTC price unavailable", detail: String(err) });
  }
});

// ─── Latest snapshot ──────────────────────────────────────────────────────────
btcusdRouter.get("/snapshot", async (_req, res) => {
  try {
    const [snap] = await db.select().from(btcusdSnapshotsTable)
      .orderBy(desc(btcusdSnapshotsTable.snapshotAt)).limit(1);
    if (!snap) return res.status(404).json({ error: "No snapshot yet" });
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Brain entries ────────────────────────────────────────────────────────────
btcusdRouter.get("/brain", async (_req, res) => {
  try {
    const rows = await db.select().from(btcusdBrainTable)
      .where(eq(btcusdBrainTable.isActive, true))
      .orderBy(desc(btcusdBrainTable.confidence))
      .limit(50);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

btcusdRouter.get("/brain/stats", async (_req, res) => {
  try {
    const [total] = await db.select({ count: sql<number>`count(*)` }).from(btcusdBrainTable);
    const [active] = await db.select({ count: sql<number>`count(*)` }).from(btcusdBrainTable).where(eq(btcusdBrainTable.isActive, true));
    const [qTotal] = await db.select({ count: sql<number>`count(*)` }).from(btcusdQuestionsLogTable);
    const [predTotal] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable);
    const [correctPreds] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable)
      .where(and(eq(btcusdPredictionsTable.isCorrect, true), eq(btcusdPredictionsTable.status, "verified")));
    const [verifiedPreds] = await db.select({ count: sql<number>`count(*)` }).from(btcusdPredictionsTable)
      .where(eq(btcusdPredictionsTable.status, "verified"));
    res.json({
      totalBrainEntries: Number(total?.count ?? 0),
      activeBrainEntries: Number(active?.count ?? 0),
      totalQuestionsAsked: Number(qTotal?.count ?? 0),
      totalPredictions: Number(predTotal?.count ?? 0),
      correctPredictions: Number(correctPreds?.count ?? 0),
      verifiedPredictions: Number(verifiedPreds?.count ?? 0),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Questions log ────────────────────────────────────────────────────────────
btcusdRouter.get("/questions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query["limit"] as string ?? "30"), 100);
    const rows = await db.select().from(btcusdQuestionsLogTable)
      .orderBy(desc(btcusdQuestionsLogTable.askedAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Predictions ──────────────────────────────────────────────────────────────
btcusdRouter.get("/predictions", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query["limit"] as string ?? "20"), 50);
    const rows = await db.select().from(btcusdPredictionsTable)
      .orderBy(desc(btcusdPredictionsTable.predictedAt)).limit(limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Learning log ─────────────────────────────────────────────────────────────
btcusdRouter.get("/learning-log", async (_req, res) => {
  try {
    const rows = await db.select().from(btcusdLearningLogTable)
      .orderBy(desc(btcusdLearningLogTable.cycleAt)).limit(20);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── Engine status ────────────────────────────────────────────────────────────
btcusdRouter.get("/engine-status", (_req, res) => {
  res.json(getBtcEngineStatus());
});

// ─── Trigger manual learning cycle (admin) ────────────────────────────────────
btcusdRouter.post("/learn-now", requireAdmin, (_req, res) => {
  runBtcLearningCycle().catch(console.error);
  res.json({ ok: true, message: "BTC learning cycle triggered." });
});

// ─── Extreme mode (admin) ────────────────────────────────────────────────────
btcusdRouter.post("/engine/extreme/start", requireAdmin, (req, res) => {
  const target = Math.max(10, Math.min(parseInt(req.body?.target ?? "100"), 10_000));
  const qpc = Math.max(3, Math.min(parseInt(req.body?.questionsPerCycle ?? "10"), 20));
  const result = startBtcExtremeLearningMode(target, qpc);
  res.json(result);
});

btcusdRouter.post("/engine/extreme/stop", requireAdmin, (_req, res) => {
  const result = stopBtcExtremeLearningMode();
  res.json(result);
});

// ─── Chat (member) ────────────────────────────────────────────────────────────
btcusdRouter.post("/chat", requireMember, async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message?.trim()) return res.status(400).json({ error: "Message required" });

    const brainRows = await db.select({ content: btcusdBrainTable.content, category: btcusdBrainTable.category })
      .from(btcusdBrainTable).where(eq(btcusdBrainTable.isActive, true))
      .orderBy(desc(btcusdBrainTable.confidence)).limit(10);
    const brainCtx = brainRows.map(r => `[${r.category}] ${r.content.slice(0, 300)}`).join("\n---\n");

    const { getDeepseekApiKey } = await import("../lib/xauusd-settings.js");
    const apiKey = await getDeepseekApiKey();
    if (!apiKey) return res.status(503).json({ error: "DeepSeek API key belum diset." });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-reasoner",
          max_tokens: 1000,
          messages: [
            { role: "system", content: `Kamu adalah expert trader Bitcoin dengan pengalaman 10 tahun. Otak AI kamu berisi pengetahuan ini:\n${brainCtx}\n\nJawab pertanyaan user berdasarkan kondisi pasar terkini dan pengetahuan di atas. Bahasa Indonesia.` },
            { role: "user", content: message },
          ],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
      const json = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      res.json({ reply: json.choices[0]?.message?.content?.trim() ?? "" });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
