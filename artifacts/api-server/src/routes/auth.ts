/**
 * Auth routes — login untuk admin dan member
 * POST /auth/login  { role: "admin"|"member", password }
 * POST /auth/logout (hapus sesi di client, server stateless)
 */
import { Router } from "express";
import { getMemberPassword } from "../lib/xauusd-settings.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { role, password } = req.body as { role?: string; password?: string };

  if (!password || typeof password !== "string" || password.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "Password diperlukan" });
  }

  if (role === "admin") {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Admin belum dikonfigurasi — SESSION_SECRET tidak diset" });
    }
    if (password !== secret) {
      return res.status(401).json({ ok: false, error: "Password admin salah" });
    }
    return res.json({ ok: true, role: "admin", token: secret });
  }

  if (role === "member") {
    const memberPwd = await getMemberPassword();
    if (!memberPwd) {
      return res.status(401).json({ ok: false, error: "Akses member belum dikonfigurasi — hubungi admin" });
    }
    if (password !== memberPwd) {
      return res.status(401).json({ ok: false, error: "Password member salah" });
    }
    return res.json({ ok: true, role: "member", token: memberPwd });
  }

  return res.status(400).json({ ok: false, error: "Role tidak valid. Gunakan 'admin' atau 'member'" });
});

export default router;
