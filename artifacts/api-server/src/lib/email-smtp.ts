/**
 * Email via SMTP — kirim kode verifikasi ke member baru.
 * Konfigurasi SMTP disimpan di DB (bisa diset dari halaman admin).
 */
import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/** Kirim kode verifikasi 6 digit ke email member */
export async function sendVerificationEmail(
  to: string,
  code: string,
  smtpCfg: SmtpConfig,
): Promise<void> {
  if (!smtpCfg.host || !smtpCfg.user || !smtpCfg.pass) {
    throw new Error("SMTP belum dikonfigurasi — masukkan pengaturan SMTP di panel admin");
  }

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port || 587,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  });

  const fromLabel = smtpCfg.from || smtpCfg.user;

  await transporter.sendMail({
    from: `"GoldRadar.ai" <${fromLabel}>`,
    to,
    subject: "Kode Verifikasi GoldRadar.ai",
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;padding:32px;background:#1a1a2e;border-radius:16px;border:1px solid #2a2a3e;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:22px;font-weight:700;color:#fff;">GoldRadar</span><span style="font-size:22px;font-weight:700;color:#f59e0b;">.ai</span>
    </div>
    <h2 style="color:#f1f1f1;font-size:18px;margin:0 0 8px;">Verifikasi Email Anda</h2>
    <p style="color:#9ca3af;font-size:14px;margin:0 0 24px;">Masukkan kode berikut untuk menyelesaikan pendaftaran akun member Anda:</p>
    <div style="background:#0f0f1a;border:2px solid #f59e0b33;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
      <div style="font-size:40px;font-weight:700;letter-spacing:12px;color:#f59e0b;">${code}</div>
    </div>
    <p style="color:#6b7280;font-size:12px;margin:0;">Kode berlaku <strong style="color:#9ca3af;">15 menit</strong>. Abaikan email ini jika Anda tidak mendaftar di GoldRadar.ai.</p>
  </div>
</body>
</html>`,
  });
}

/** Test koneksi SMTP — lempar error jika gagal */
export async function testSmtpConnection(smtpCfg: SmtpConfig): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port || 587,
    secure: smtpCfg.port === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
  });
  await transporter.verify();
}
