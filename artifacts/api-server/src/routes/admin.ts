/**
 * Admin routes — system info only (XAUUSD settings live in /xauusd/settings)
 */
import { Router } from "express";
import { getEngineStatus } from "../lib/xauusd-brain-engine.js";
import {
  getSettingsSummary,
  getMemberPassword,
  setMemberPassword,
  clearMemberPassword,
} from "../lib/xauusd-settings.js";
import { getLatestLivePrice } from "../lib/xauusd-live-price.js";

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

    const memberPwd = await getMemberPassword();
    res.json({
      ok: true,
      engine,
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

export default router;
