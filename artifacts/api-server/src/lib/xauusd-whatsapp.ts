/**
 * WhatsApp notifications for XAUUSD AI predictions.
 *
 * Calls Meta's WhatsApp Cloud API directly (no Replit connector needed) using
 * two secrets configured by the user in a Meta developer/business account:
 *   - WHATSAPP_ACCESS_TOKEN   — permanent/temporary access token for the app
 *   - WHATSAPP_PHONE_NUMBER_ID — the sender phone number ID from Meta
 *
 * The destination number is configured from the website (Settings tab) and
 * stored in xauusd_settings, so it can be changed without redeploying.
 */

import {
  getWhatsappNumber,
  isWhatsappEnabled,
  isWhatsappConfigured,
} from "./xauusd-settings.js";

const GRAPH_API_VERSION = "v21.0";

function normalizeNumber(raw: string): string {
  // WhatsApp Cloud API expects digits only (no +, spaces, dashes), with country code.
  return raw.replace(/[^\d]/g, "");
}

export async function sendWhatsappMessage(
  toNumber: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return { ok: false, error: "WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID belum diset" };
  }

  const to = normalizeNumber(toNumber);
  if (!to) {
    return { ok: false, error: "Nomor WhatsApp tujuan tidak valid" };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      console.error("[XAUUSD WhatsApp] Send failed:", res.status, errText);
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }

    return { ok: true };
  } catch (err) {
    console.error("[XAUUSD WhatsApp] Send error:", err);
    return { ok: false, error: String(err) };
  }
}

export async function sendTestWhatsappMessage(): Promise<{ ok: boolean; error?: string }> {
  const number = await getWhatsappNumber();
  if (!number) return { ok: false, error: "Nomor WhatsApp belum diatur" };
  return sendWhatsappMessage(
    number,
    "🥇 SahamRadar Gold AI: pesan tes berhasil! Notifikasi WhatsApp sudah aktif untuk prediksi baru."
  );
}

interface PredictionForAlert {
  direction: string;
  targetPrice: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  confidence: number;
  reasoning: string;
  priceAtPrediction: number;
  timeframe: string;
}

/**
 * Fires a WhatsApp alert whenever a new AI prediction is generated. Silently
 * no-ops when WhatsApp isn't configured/enabled or no number is set, so this
 * is always safe to call from the learning cycle without extra guards.
 */
export async function notifyNewPrediction(pred: PredictionForAlert): Promise<void> {
  try {
    if (!isWhatsappConfigured()) return;
    const enabled = await isWhatsappEnabled();
    if (!enabled) return;
    const number = await getWhatsappNumber();
    if (!number) return;

    const arrow = pred.direction === "up" ? "🚀 NAIK" : pred.direction === "down" ? "📉 TURUN" : "↔️ SIDEWAYS";
    const lines = [
      `🥇 *Prediksi Baru Gold AI (XAUUSD)*`,
      ``,
      `Arah: ${arrow}`,
      `Harga saat ini: $${pred.priceAtPrediction.toFixed(2)}`,
      pred.targetPrice != null ? `Target: $${pred.targetPrice.toFixed(2)}` : null,
      pred.entryLow != null && pred.entryHigh != null
        ? `Entry: $${pred.entryLow.toFixed(2)} – $${pred.entryHigh.toFixed(2)}`
        : null,
      pred.stopLoss != null ? `Stop Loss: $${pred.stopLoss.toFixed(2)}` : null,
      `Confidence: ${(pred.confidence * 100).toFixed(0)}%`,
      `Timeframe: ${pred.timeframe}`,
      ``,
      `${pred.reasoning}`,
    ].filter(Boolean);

    const result = await sendWhatsappMessage(number, lines.join("\n"));
    if (!result.ok) {
      console.error("[XAUUSD WhatsApp] notifyNewPrediction failed:", result.error);
    }
  } catch (err) {
    console.error("[XAUUSD WhatsApp] notifyNewPrediction error:", err);
  }
}
