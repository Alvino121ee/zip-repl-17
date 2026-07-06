/**
 * Payment routes — Pakasir integration
 *
 * Public:
 *   GET  /api/payment/plans          — daftar VIP plans aktif
 *
 * Member (require session token):
 *   POST /api/payment/create         — buat invoice baru
 *   GET  /api/payment/status/:orderId — cek status transaksi
 *   GET  /api/payment/my-plan        — info plan member saat ini
 *   GET  /api/payment/history        — riwayat pembayaran member
 *
 * Webhook (no auth — dari Pakasir server):
 *   POST /api/payment/webhook        — notifikasi pembayaran berhasil
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { findMemberBySessionToken } from "../lib/members-db.js";
import {
  getActivePlans, getPlanBySlug,
} from "../lib/plans-db.js";
import {
  createPayment, getPaymentByOrderId, getPaymentsByMember,
  completePayment, expirePayment, grantMemberPlan,
} from "../lib/payments-db.js";
import {
  createPakasirPayment, checkPakasirStatus, validatePakasirWebhook,
  type PakasirWebhookPayload,
} from "../lib/pakasir.js";

const router = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────
async function getMemberFromReq(req: import("express").Request) {
  const auth = (req.headers.authorization as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  return findMemberBySessionToken(token).catch(() => null);
}

function requireMemberMiddleware(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
) {
  getMemberFromReq(req).then((m) => {
    if (!m) return res.status(401).json({ error: "Login diperlukan" });
    (req as any).member = m;
    next();
  }).catch(() => res.status(401).json({ error: "Login diperlukan" }));
}

// ── GET /api/payment/plans ────────────────────────────────────────────────────
router.get("/plans", async (_req, res) => {
  try {
    const plans = await getActivePlans();
    return res.json({ ok: true, plans });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/payment/my-plan ──────────────────────────────────────────────────
router.get("/my-plan", requireMemberMiddleware, async (req, res) => {
  try {
    const member = (req as any).member;
    const now = new Date();
    const isActive = member.plan !== "free" &&
      (!member.planExpiresAt || member.planExpiresAt > now);
    return res.json({
      ok: true,
      plan:         member.plan ?? "free",
      planName:     member.planName ?? "Gratis",
      planExpiresAt:member.planExpiresAt ?? null,
      isVip:        isActive,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/payment/create ──────────────────────────────────────────────────
router.post("/create", requireMemberMiddleware, async (req, res) => {
  try {
    const member = (req as any).member;
    const { planSlug } = req.body as { planSlug?: string };
    if (!planSlug) return res.status(400).json({ ok: false, error: "planSlug diperlukan" });

    const plan = await getPlanBySlug(planSlug);
    if (!plan || !plan.isActive) return res.status(404).json({ ok: false, error: "Plan tidak ditemukan atau tidak aktif" });

    // Buat order ID unik
    const orderId = `GR_${Date.now()}_${member.id}`;

    // Buat transaksi di Pakasir
    const pakasir = await createPakasirPayment(orderId, plan.price);

    // Simpan ke DB
    const payment = await createPayment({
      memberId:   member.id,
      orderId,
      amount:     plan.price,
      planSlug:   plan.slug,
      planName:   plan.name,
      qrString:   pakasir.qrString,
      paymentUrl: pakasir.paymentUrl,
      expiresAt:  new Date(pakasir.expiredAt),
    });

    return res.status(201).json({
      ok: true,
      orderId,
      amount:     plan.price,
      planName:   plan.name,
      qrString:   pakasir.qrString,
      paymentUrl: pakasir.paymentUrl,
      expiredAt:  pakasir.expiredAt,
      paymentId:  payment.id,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/payment/status/:orderId ─────────────────────────────────────────
router.get("/status/:orderId", requireMemberMiddleware, async (req, res) => {
  try {
    const member = (req as any).member;
    const rawOrderId = req.params["orderId"];
    const orderId = Array.isArray(rawOrderId) ? rawOrderId[0] : (rawOrderId ?? "");
    const payment = await getPaymentByOrderId(orderId);
    if (!payment) return res.status(404).json({ ok: false, error: "Transaksi tidak ditemukan" });
    if (payment.memberId !== member.id) return res.status(403).json({ ok: false, error: "Akses ditolak" });

    // Jika sudah selesai, kembalikan dari DB
    if (payment.status !== "pending") {
      return res.json({ ok: true, status: payment.status, payment });
    }

    // Cek ke Pakasir
    const pakasirStatus = await checkPakasirStatus(orderId, payment.amount);

    if (pakasirStatus.status === "completed") {
      const plan = await getPlanBySlug(payment.planSlug);
      const durationDays = plan?.durationDays ?? 30;
      await completePayment(orderId, pakasirStatus.paymentMethod ?? "unknown", new Date(pakasirStatus.completedAt ?? Date.now()));
      await grantMemberPlan(member.id, payment.planSlug, payment.planName, durationDays);
      return res.json({ ok: true, status: "completed", payment });
    }

    if (pakasirStatus.status === "expired" && payment.expiresAt && payment.expiresAt < new Date()) {
      await expirePayment(orderId);
    }

    return res.json({ ok: true, status: pakasirStatus.status, payment });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/payment/history ──────────────────────────────────────────────────
router.get("/history", requireMemberMiddleware, async (req, res) => {
  try {
    const member = (req as any).member;
    const payments = await getPaymentsByMember(member.id);
    return res.json({ ok: true, payments });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── POST /api/payment/webhook — dari Pakasir (tanpa auth) ────────────────────
router.post("/webhook", async (req, res) => {
  try {
    const payload = req.body as PakasirWebhookPayload;

    // 1. Validasi project slug
    const valid = await validatePakasirWebhook(payload);
    if (!valid) {
      console.warn("[Payment] Webhook ditolak — project slug tidak cocok:", payload.project);
      return res.status(400).json({ ok: false, error: "Invalid webhook" });
    }

    if ((payload.status ?? "").toLowerCase() !== "completed") {
      return res.json({ ok: true, message: "Status bukan completed, diabaikan" });
    }

    const payment = await getPaymentByOrderId(payload.order_id);
    if (!payment) {
      console.warn("[Payment] Webhook: order tidak ditemukan:", payload.order_id);
      return res.json({ ok: true, message: "Order tidak dikenal" });
    }

    if (payment.status === "completed") {
      return res.json({ ok: true, message: "Sudah diproses sebelumnya" });
    }

    // 2. Re-verifikasi ke Pakasir API (anti-spoof) — jangan percaya webhook saja
    const verified = await checkPakasirStatus(payload.order_id, payment.amount);
    if (verified.status !== "completed") {
      console.warn(`[Payment] Webhook: re-verifikasi gagal, status Pakasir = ${verified.status}`);
      return res.status(400).json({ ok: false, error: "Pembayaran belum terkonfirmasi oleh Pakasir" });
    }

    // 3. Upgrade member plan
    const plan = await getPlanBySlug(payment.planSlug);
    const durationDays = plan?.durationDays ?? 30;
    await completePayment(payload.order_id, verified.paymentMethod ?? payload.payment_method, new Date(verified.completedAt ?? payload.completed_at));
    await grantMemberPlan(payment.memberId, payment.planSlug, payment.planName, durationDays);

    console.log(`[Payment] ✅ Webhook berhasil: ${payload.order_id} → member #${payment.memberId} dapat plan ${payment.planSlug}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[Payment] Webhook error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
