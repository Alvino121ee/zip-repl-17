/**
 * Admin routes — system info only (XAUUSD settings live in /xauusd/settings)
 */
import { Router } from "express";
import { getEngineStatus } from "../lib/xauusd-brain-engine.js";
import { getBtcEngineStatus } from "../lib/btcusd-brain-engine.js";
import {
  getSettingsSummary,
  getMemberPassword,
  setMemberPassword,
  clearMemberPassword,
  isXauusdBrainEnabled,
  isBtcusdBrainEnabled,
  setAiApiKey,
  clearAiApiKey,
  setAiApiBaseUrl,
  setAiModel,
  getSmtpSettings,
  setSmtpSettings,
} from "../lib/xauusd-settings.js";
import { getAllMembers, deleteMember } from "../lib/members-db.js";
import { testSmtpConnection } from "../lib/email-smtp.js";
import { getLatestLivePrice } from "../lib/xauusd-live-price.js";
import {
  getBackupStats,
  syncToFile,
  restoreFromFile,
  BACKUP_PATH,
} from "../lib/brain-sqlite-backup.js";
import adminPlansRouter from "./admin-plans.js";

const router = Router();

// ─── requireAdmin guard ────────────────────────────────────────────────────────
function requireAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction
) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Admin operations disabled: SESSION_SECRET not set" });
    }
    return next();
  }
  const auth = (req.headers.authorization as string) ?? (req.query.token as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    return res.status(403).json({ error: "Forbidden — admin login diperlukan" });
  }
  return next();
}

// GET /admin/system — overall system status snapshot (admin only)
router.get("/system", requireAdmin, async (_req, res) => {
  try {
    const [engine, settings, livePrice] = await Promise.all([
      Promise.resolve(getEngineStatus()),
      getSettingsSummary(),
      Promise.resolve(getLatestLivePrice()),
    ]);

    const [memberPwd, xauusdEnabled, btcEnabled] = await Promise.all([
      getMemberPassword(),
      isXauusdBrainEnabled(),
      isBtcusdBrainEnabled(),
    ]);
    res.json({
      ok: true,
      engine,
      btcEngine: getBtcEngineStatus(),
      engineEnabled: { xauusd: xauusdEnabled, btc: btcEnabled },
      settings,
      livePrice,
      serverTime: new Date().toISOString(),
      member: { hasPassword: !!memberPwd },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/member-password — set/clear member access password (admin only)
router.post("/member-password", requireAdmin, async (req, res) => {
  const { password } = req.body as { password?: string };
  try {
    if (!password || password.trim().length === 0) {
      await clearMemberPassword();
      return res.json({ ok: true, cleared: true });
    }
    await setMemberPassword(password);
    return res.json({ ok: true, cleared: false });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /admin/members — daftar semua member terdaftar (admin only)
router.get("/members", requireAdmin, async (_req, res) => {
  try {
    const members = await getAllMembers();
    return res.json({ ok: true, members });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// DELETE /admin/members/:id — hapus member (admin only)
router.delete("/members/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    await deleteMember(id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// GET /admin/settings/smtp — baca konfigurasi SMTP (admin only, sensor password)
router.get("/settings/smtp", requireAdmin, async (_req, res) => {
  try {
    const cfg = await getSmtpSettings();
    return res.json({ ok: true, smtp: { host: cfg.host, port: cfg.port, user: cfg.user, from: cfg.from, hasPass: !!cfg.pass } });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /admin/settings/smtp — simpan konfigurasi SMTP (admin only)
router.post("/settings/smtp", requireAdmin, async (req, res) => {
  const { host, port, user, pass, from } = req.body as {
    host?: string; port?: number; user?: string; pass?: string; from?: string;
  };
  try {
    await setSmtpSettings({ host, port, user, pass, from });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// POST /admin/settings/smtp/test — test koneksi SMTP (admin only)
router.post("/settings/smtp/test", requireAdmin, async (_req, res) => {
  try {
    const cfg = await getSmtpSettings();
    await testSmtpConnection(cfg);
    return res.json({ ok: true, message: "Koneksi SMTP berhasil!" });
  } catch (err) {
    return res.status(400).json({ ok: false, error: String(err) });
  }
});

// POST /admin/settings/ai-key — set/clear general AI API key + base URL + model (admin only)
router.post("/settings/ai-key", requireAdmin, async (req, res) => {
  const { apiKey, baseUrl, model } = req.body as { apiKey?: string; baseUrl?: string; model?: string };
  let clearedKey = false;
  try {
    if (typeof apiKey === "string") {
      if (apiKey.trim().length === 0) {
        await clearAiApiKey();
        clearedKey = true;
      } else {
        await setAiApiKey(apiKey);
      }
    }
    if (typeof baseUrl === "string") {
      await setAiApiBaseUrl(baseUrl);
    }
    if (typeof model === "string") {
      await setAiModel(model);
    }
    return res.json({ ok: true, clearedKey });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── Brain Backup endpoints ────────────────────────────────────────────────────

// GET /admin/brain-backup — status file backup
router.get("/brain-backup", requireAdmin, async (_req, res) => {
  try {
    const stats = await getBackupStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/brain-backup/export — manual dump PostgreSQL → SQLite sekarang
router.post("/brain-backup/export", requireAdmin, async (_req, res) => {
  try {
    const result = await syncToFile();
    const stats = await getBackupStats();
    res.json({ ok: result.ok, message: result.message, stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /admin/brain-backup/import — restore SQLite → PostgreSQL
router.post("/brain-backup/import", requireAdmin, async (_req, res) => {
  try {
    const result = await restoreFromFile();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /admin/brain-backup/download — download file .sqlite langsung
router.get("/brain-backup/download", requireAdmin, async (_req, res) => {
  try {
    const { existsSync } = await import("node:fs");
    if (!existsSync(BACKUP_PATH)) {
      res.status(404).json({ ok: false, error: "File backup belum ada. Jalankan export terlebih dahulu." });
      return;
    }
    res.download(BACKUP_PATH, "goldradar-brain.sqlite");
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ─── VIP Plans, Pakasir, Payment history (admin-plans router) ────────────────
router.use(requireAdmin, adminPlansRouter);

export default router;
