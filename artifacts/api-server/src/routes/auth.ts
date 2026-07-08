/**
 * Auth routes
 *   POST /auth/login              — admin (password) atau member (email+password)
 *   POST /auth/register           — daftar member baru dengan email+password
 *   POST /auth/verify-email       — verifikasi kode 6-digit
 *   POST /auth/resend-verification — kirim ulang kode
 *   POST /auth/logout             — hapus session token member
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import {
  findMemberByEmail,
  createMember,
  setVerificationCode,
  markEmailVerified,
  createSessionToken,
  findMemberBySessionToken,
  generateVerificationCode,
  clearSessionToken,
} from "../lib/members-db.js";
import { sendVerificationEmail } from "../lib/email-resend.js";

const router = Router();

// ─── Rate limiters ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 menit
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak percobaan login. Coba lagi dalam 15 menit." },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." },
});

const resendLimiter = rateLimit({
  windowMs: 60_000, // 1 menit per IP
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Tunggu 1 menit sebelum meminta kode ulang." },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 jam
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam 1 jam." },
});

// ─── POST /auth/login ─────────────────────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { role, password, email } = req.body as {
    role?: string; password?: string; email?: string;
  };

  if (!password || typeof password !== "string" || password.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "Password diperlukan" });
  }

  // ── Admin login ──────────────────────────────────────────────────────────────
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

  // ── Member login — email + password ─────────────────────────────────────────
  if (role === "member") {
    if (!email || typeof email !== "string") {
      return res.status(400).json({ ok: false, error: "Email diperlukan" });
    }

    const member = await findMemberByEmail(email.trim());
    if (!member) {
      return res.status(401).json({ ok: false, error: "Email atau password salah" });
    }
    if (!member.emailVerified) {
      return res.status(401).json({ ok: false, error: "Email belum diverifikasi. Cek kotak masuk email Anda.", code: "EMAIL_NOT_VERIFIED" });
    }
    const valid = await bcrypt.compare(password, member.passwordHash);
    if (!valid) {
      return res.status(401).json({ ok: false, error: "Email atau password salah" });
    }
    const token = await createSessionToken(member.id);
    return res.json({ ok: true, role: "member", token, email: member.email, memberId: member.id });
  }

  return res.status(400).json({ ok: false, error: "Role tidak valid. Gunakan 'admin' atau 'member'" });
});

// ─── POST /auth/register ──────────────────────────────────────────────────────
router.post("/register", registerLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || typeof email !== "string" || !/^[^\s@]+@gmail\.com$/i.test(email.trim())) {
    return res.status(400).json({ ok: false, error: "Hanya email @gmail.com yang diperbolehkan" });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ ok: false, error: "Password minimal 8 karakter" });
  }

  const existing = await findMemberByEmail(email.trim());
  if (existing) {
    if (existing.emailVerified) {
      return res.status(409).json({ ok: false, error: "Email sudah terdaftar. Silakan login." });
    }
    // Akun sudah ada tapi belum diverifikasi — kirim ulang kode
    const code = generateVerificationCode();
    await setVerificationCode(existing.id, code);
    try {
      await sendVerificationEmail(existing.email, code);
    } catch (err) {
      return res.status(500).json({ ok: false, error: `Gagal kirim email verifikasi: ${String(err)}` });
    }
    return res.json({ ok: true, requiresVerification: true, email: existing.email, memberId: existing.id });
  }

  const hash = await bcrypt.hash(password, 12);
  const member = await createMember(email.trim(), hash);

  const code = generateVerificationCode();
  await setVerificationCode(member.id, code);
  try {
    await sendVerificationEmail(member.email, code);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Gagal kirim email verifikasi: ${String(err)}` });
  }

  return res.status(201).json({ ok: true, requiresVerification: true, email: member.email, memberId: member.id });
});

// ─── POST /auth/verify-email ──────────────────────────────────────────────────
router.post("/verify-email", otpLimiter, async (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string };

  if (!email || !code) {
    return res.status(400).json({ ok: false, error: "Email dan kode diperlukan" });
  }

  const member = await findMemberByEmail(email.trim());
  if (!member) {
    return res.status(404).json({ ok: false, error: "Akun tidak ditemukan" });
  }
  if (member.emailVerified) {
    return res.status(400).json({ ok: false, error: "Email sudah terverifikasi sebelumnya" });
  }
  if (!member.verificationCode || member.verificationCode !== code.trim()) {
    return res.status(400).json({ ok: false, error: "Kode verifikasi salah" });
  }
  if (member.verificationExpiry && member.verificationExpiry < new Date()) {
    return res.status(400).json({ ok: false, error: "Kode verifikasi sudah kedaluwarsa. Minta kode baru." });
  }

  await markEmailVerified(member.id);
  const token = await createSessionToken(member.id);
  return res.json({ ok: true, message: "Email berhasil diverifikasi!", token, email: member.email, memberId: member.id });
});

// ─── POST /auth/resend-verification ──────────────────────────────────────────
router.post("/resend-verification", resendLimiter, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ ok: false, error: "Email diperlukan" });

  const member = await findMemberByEmail(email.trim());
  if (!member) return res.status(404).json({ ok: false, error: "Akun tidak ditemukan" });
  if (member.emailVerified) return res.status(400).json({ ok: false, error: "Email sudah terverifikasi" });

  const code = generateVerificationCode();
  await setVerificationCode(member.id, code);
  try {
    await sendVerificationEmail(member.email, code);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Gagal kirim email: ${String(err)}` });
  }
  return res.json({ ok: true, message: "Kode verifikasi baru telah dikirim" });
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const auth = (req.headers.authorization as string) ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token) {
    const member = await findMemberBySessionToken(token).catch(() => null);
    if (member) await clearSessionToken(member.id).catch(() => {});
  }
  return res.json({ ok: true });
});

export default router;
export { findMemberBySessionToken };
