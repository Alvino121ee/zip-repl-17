/**
 * Admin routes — VIP Plans & Pakasir settings & payment history
 * Mount di admin.ts dengan: router.use(adminPlansRouter)
 */
import { Router } from "express";
import {
  getAllPlans, createPlan, updatePlan, deletePlan,
} from "../lib/plans-db.js";
import { getAllPayments } from "../lib/payments-db.js";
import { getPakasirConfig, setPakasirConfig } from "../lib/pakasir.js";
import { getAllMembers } from "../lib/members-db.js";
import { setMemberPlanManual } from "../lib/payments-db.js";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// ── VIP Plans ─────────────────────────────────────────────────────────────────

// GET /admin/plans
router.get("/plans", async (_req, res) => {
  try {
    const plans = await getAllPlans();
    return res.json({ ok: true, plans });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/plans
router.post("/plans", async (req, res) => {
  try {
    const { slug, name, description, price, durationDays, features, sortOrder } =
      req.body as {
        slug?: string; name?: string; description?: string; price?: number;
        durationDays?: number; features?: string[]; sortOrder?: number;
      };
    if (!slug || !name || price === undefined) {
      return res.status(400).json({ ok: false, error: "slug, name, dan price wajib diisi" });
    }
    const plan = await createPlan({ slug, name, description, price, durationDays, features, sortOrder });
    return res.status(201).json({ ok: true, plan });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("unique")) return res.status(409).json({ ok: false, error: "Slug sudah digunakan" });
    return res.status(500).json({ ok: false, error: msg });
  }
});

// PUT /admin/plans/:id
router.put("/plans/:id", async (req, res) => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID tidak valid" });
  try {
    const { name, description, price, durationDays, features, isActive, sortOrder } =
      req.body as Partial<{
        name: string; description: string; price: number;
        durationDays: number; features: string[]; isActive: boolean; sortOrder: number;
      }>;
    const plan = await updatePlan(id, { name, description, price, durationDays, features, isActive, sortOrder });
    if (!plan) return res.status(404).json({ ok: false, error: "Plan tidak ditemukan" });
    return res.json({ ok: true, plan });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// DELETE /admin/plans/:id
router.delete("/plans/:id", async (req, res) => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID tidak valid" });
  try {
    await deletePlan(id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Pakasir Settings ─────────────────────────────────────────────────────────

// GET /admin/settings/pakasir
router.get("/settings/pakasir", async (_req, res) => {
  try {
    const cfg = await getPakasirConfig();
    return res.json({ ok: true, project: cfg.project, hasApiKey: !!cfg.apiKey });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/settings/pakasir
router.post("/settings/pakasir", async (req, res) => {
  try {
    const { project, apiKey } = req.body as { project?: string; apiKey?: string };
    if (!project || !apiKey) return res.status(400).json({ ok: false, error: "project dan apiKey wajib" });
    await setPakasirConfig(project, apiKey);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Payment History ──────────────────────────────────────────────────────────

// GET /admin/payments
router.get("/payments", async (_req, res) => {
  try {
    const payments = await getAllPayments();
    return res.json({ ok: true, payments });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Member Plan Override ─────────────────────────────────────────────────────

// GET /admin/members (extended — with plan info)
router.get("/members-vip", async (_req, res) => {
  try {
    const rows = await db.select({
      id:            membersTable.id,
      email:         membersTable.email,
      emailVerified: membersTable.emailVerified,
      plan:          membersTable.plan,
      planName:      membersTable.planName,
      planExpiresAt: membersTable.planExpiresAt,
      createdAt:     membersTable.createdAt,
    }).from(membersTable).orderBy(membersTable.createdAt);
    return res.json({ ok: true, members: rows });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/members/:id/plan — set plan manual
router.post("/members/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID tidak valid" });
  try {
    const { planSlug, planName, durationDays } =
      req.body as { planSlug?: string; planName?: string; durationDays?: number };
    if (!planSlug || !planName) return res.status(400).json({ ok: false, error: "planSlug dan planName wajib" });
    const days = durationDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 3600_000);
    await setMemberPlanManual(id, planSlug, planName, expiresAt);
    return res.json({ ok: true, expiresAt });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// DELETE /admin/members/:id/plan — cabut plan (set ke free)
router.delete("/members/:id/plan", async (req, res) => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) return res.status(400).json({ ok: false, error: "ID tidak valid" });
  try {
    await db.update(membersTable)
      .set({ plan: "free", planName: null, planExpiresAt: null, updatedAt: new Date() })
      .where(eq(membersTable.id, id));
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
