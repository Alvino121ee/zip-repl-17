/**
 * Pakasir Payment Gateway — lightweight client tanpa SDK eksternal
 * Docs: https://pakasir.com/p/docs
 */

import { getValue, setValue } from "./xauusd-settings-internal.js";

const PAKASIR_BASE = "https://app.pakasir.com";
const KEY_PROJECT  = "pakasir_project";
const KEY_API_KEY  = "pakasir_api_key";

export async function getPakasirConfig(): Promise<{ project: string; apiKey: string }> {
  const [project, apiKey] = await Promise.all([
    getValue(KEY_PROJECT),
    getValue(KEY_API_KEY),
  ]);
  return {
    project:  project  ?? process.env.PAKASIR_PROJECT  ?? "",
    apiKey:   apiKey   ?? process.env.PAKASIR_API_KEY  ?? "",
  };
}

export async function setPakasirConfig(project: string, apiKey: string): Promise<void> {
  await Promise.all([
    setValue(KEY_PROJECT, project.trim()),
    setValue(KEY_API_KEY, apiKey.trim()),
  ]);
}

export interface PakasirCreateResult {
  orderId:      string;
  qrString:     string;
  paymentUrl:   string;
  expiredAt:    string;
}

/** Buat transaksi QRIS + payment URL via Pakasir */
export async function createPakasirPayment(
  orderId: string,
  amount: number
): Promise<PakasirCreateResult> {
  const { project, apiKey } = await getPakasirConfig();
  if (!project || !apiKey) throw new Error("Pakasir belum dikonfigurasi. Atur project & API key di Admin → Pengaturan VIP.");

  // 1. Buat transaksi — pakai endpoint payment URL (redirect + QR)
  const res = await fetch(`${PAKASIR_BASE}/api/transaction/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, api_key: apiKey, order_id: orderId, amount }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Pakasir error ${res.status}: ${body}`);
  }

  const data = await res.json() as {
    qr_string?: string;
    expired_at?: string;
    payment_number?: string;
    error?: string;
  };

  if (data.error) throw new Error(`Pakasir: ${data.error}`);

  // 2. Build payment URL (tidak perlu API call terpisah — construct langsung)
  const paymentUrl = `${PAKASIR_BASE}/pay/${project}?order_id=${orderId}&amount=${amount}`;

  return {
    orderId,
    qrString:   data.qr_string ?? "",
    paymentUrl,
    expiredAt:  data.expired_at ?? new Date(Date.now() + 24 * 3600_000).toISOString(),
  };
}

export interface PakasirStatusResult {
  status: "pending" | "completed" | "expired" | "failed";
  paymentMethod?: string;
  completedAt?: string;
}

/** Cek status transaksi */
export async function checkPakasirStatus(
  orderId: string,
  amount: number
): Promise<PakasirStatusResult> {
  const { project, apiKey } = await getPakasirConfig();
  if (!project || !apiKey) throw new Error("Pakasir belum dikonfigurasi.");

  const res = await fetch(`${PAKASIR_BASE}/api/transaction/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, api_key: apiKey, order_id: orderId, amount }),
  });

  if (!res.ok) throw new Error(`Pakasir status error: ${res.status}`);
  const data = await res.json() as {
    status?: string;
    payment_method?: string;
    completed_at?: string;
  };

  const rawStatus = (data.status ?? "pending").toLowerCase();
  const status: PakasirStatusResult["status"] =
    rawStatus === "completed" ? "completed" :
    rawStatus === "expired"   ? "expired" :
    rawStatus === "failed"    ? "failed" : "pending";

  return { status, paymentMethod: data.payment_method, completedAt: data.completed_at };
}

export interface PakasirWebhookPayload {
  amount:         number;
  order_id:       string;
  project:        string;
  status:         string;
  payment_method: string;
  completed_at:   string;
}

/** Validasi webhook dari Pakasir — cek project slug cocok */
export async function validatePakasirWebhook(payload: PakasirWebhookPayload): Promise<boolean> {
  const { project } = await getPakasirConfig();
  if (!project) return true; // belum dikonfigurasi, lewati saja
  return payload.project === project;
}
