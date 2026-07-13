/**
 * Dewan BTC (BTC Council) — Tim debat BTC/USD
 * 15 analis spesialis + 1 Presiden (leader) yang mengambil keputusan akhir,
 * seperti kabinet sebuah negara. Setiap siklus, anggota dewan berdebat dan
 * memberi pendapat berdasarkan sinyal riil dari 3 brain BTC (Technical/Fundamental/Macro),
 * lalu Presiden mensintesis semua pendapat menjadi keputusan final.
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { btcQuantCommitteeDebatesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { getBtcTechnicalSignal } from "./btc-quant-technical-brain.js";
import { getBtcFundamentalSignal } from "./btc-quant-fundamental-brain.js";
import { getBtcMacroSignal } from "./btc-quant-macro-brain.js";
import { fetchBtcusdIndicators } from "./btcusd-data.js";

export const btcCouncilEvents = new EventEmitter();
btcCouncilEvents.setMaxListeners(200);
export function getIsBtcCouncilRunning() { return isRunning; }

// ─── Roster — 15 anggota Dewan BTC ─────────────────────────────────────────────
export const BTC_COUNCIL_MEMBERS = [
  { name: "Kevin Halim", role: "Kepala Analis On-Chain" },
  { name: "Clara Susanto", role: "Analis Funding Rate & Open Interest" },
  { name: "Fikri Ramadhan", role: "Spesialis Order Book & Liquidity" },
  { name: "Nadia Ayu", role: "Analis Teknikal (RSI/EMA/BB)" },
  { name: "Teguh Pratama", role: "Analis Siklus Halving" },
  { name: "Vania Kartika", role: "Spesialis Whale Movement & Exchange Flow" },
  { name: "Andre Wijaya", role: "Analis Sentimen Sosial (Fear & Greed)" },
  { name: "Putri Amelia", role: "Analis ETF Flow & Institutional Demand" },
  { name: "Rio Saputra", role: "Ekonom Makro Crypto (Nasdaq/DXY)" },
  { name: "Hendra Gunawan", role: "Trader Derivatives & Perpetual Swap" },
  { name: "Yulia Rahmawati", role: "Manajer Risiko Scalping" },
  { name: "Doni Kurniawan", role: "Analis Mining Economics & Hashrate" },
  { name: "Sinta Marlina", role: "Analis Regulasi Global" },
  { name: "Dr. Fadli Rahman", role: "Kepala Riset Kuantitatif" },
  { name: "Aditya Nugroho", role: "Analis Stablecoin Flow & Liquidity" },
] as const;

export const BTC_COUNCIL_LEADER = { name: "Satrio Mahendra", title: "Presiden Dewan BTC" };

export interface CouncilMemberOpinion {
  name: string;
  role: string;
  vote: "BUY" | "SELL" | "HOLD";
  confidence: number;
  opinion: string;
}

export interface CouncilDebate {
  debatedAt: Date;
  cycleNumber: number;
  price: number | null;
  members: CouncilMemberOpinion[];
  buyVotes: number;
  sellVotes: number;
  holdVotes: number;
  leaderName: string;
  leaderTitle: string;
  leaderDecision: "BUY" | "SELL" | "HOLD";
  leaderConfidence: number;
  leaderReasoning: string;
}

let cycleCount = 0;
let isRunning = false;
let lastDebate: CouncilDebate | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const CYCLE_MS = 8 * 60 * 1000; // 8 min — scalping butuh rapat lebih sering dari gold

function clamp01(n: unknown, fallback = 0.5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(0.95, Math.max(0.1, v));
}

function asVote(v: unknown): "BUY" | "SELL" | "HOLD" {
  return v === "BUY" || v === "SELL" || v === "HOLD" ? v : "HOLD";
}

async function askDeepSeek(system: string, user: string, timeoutMs = 45000): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) return "";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 2400,
        temperature: 0.55,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

const SYSTEM_PROMPT = `Kamu adalah fasilitator rapat "Dewan BTC" — komite trading BTC/USD (scalping) yang terdiri dari 15 analis spesialis dengan keahlian berbeda-beda, dipimpin oleh 1 Presiden yang mengambil keputusan akhir (seperti kabinet sebuah negara).

ATURAN PENTING:
- Setiap anggota HARUS memberi pendapat sesuai keahliannya masing-masing, berdasarkan data yang diberikan — JANGAN membuat semua anggota berpendapat sama.
- Wajar jika ada perdebatan: beberapa anggota boleh BUY, sebagian SELL, sebagian HOLD, sesuai sudut pandang keahlian mereka.
- Presiden mendengarkan semua pendapat lalu mengambil keputusan akhir yang mempertimbangkan mayoritas dan kualitas argumen (bukan sekadar voting mentah). Ingat: BTC ini untuk SCALPING, TP/SL dibatasi maksimal $1000 dari entry.
- Tulis dalam Bahasa Indonesia, tiap pendapat anggota MAKSIMAL 1 kalimat pendek dan spesifik (bukan generik).
- Balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.`;

function buildUserPrompt(
  price: number,
  tech: { signal: string; confidence: number; keySetup: string },
  fund: { signal: string; confidence: number; keyDriver: string },
  macro: { signal: string; confidence: number; macroRegime: string; correlationBias: string },
): string {
  const roster = BTC_COUNCIL_MEMBERS.map((m, i) => `${i + 1}. ${m.name} — ${m.role}`).join("\n");
  return `DATA RAPAT DEWAN BTC SAAT INI:
- Harga BTC/USD: $${price.toLocaleString()}
- Technical Brain: ${tech.signal} (confidence ${(tech.confidence * 100).toFixed(0)}%) — setup: ${tech.keySetup}
- Fundamental Brain: ${fund.signal} (confidence ${(fund.confidence * 100).toFixed(0)}%) — driver: ${fund.keyDriver}
- Macro Brain: ${macro.signal} (confidence ${(macro.confidence * 100).toFixed(0)}%) — regime: ${macro.macroRegime}, korelasi: ${macro.correlationBias}

DAFTAR HADIR (15 anggota dewan, urutan HARUS sama persis di jawabanmu):
${roster}

Buat pendapat untuk masing-masing dari 15 anggota di atas SESUAI URUTAN, lalu keputusan akhir dari Presiden (Satrio Mahendra). Balas JSON dengan format persis:
{
  "members": [
    {"vote":"BUY|SELL|HOLD","confidence":0.0-1.0,"opinion":"pendapat 1 kalimat sesuai keahlian anggota ke-1"},
    ... (harus ada tepat 15 entri, urutan sesuai daftar hadir)
  ],
  "leaderDecision": "BUY|SELL|HOLD",
  "leaderConfidence": 0.0-1.0,
  "leaderReasoning": "2-3 kalimat sebagai Presiden: sintesis pendapat dewan, sebutkan siapa yang argumennya paling kuat, dan keputusan akhir untuk scalper (ingat cap TP/SL $1000)"
}`;
}

const bcast = (ev: object) => btcCouncilEvents.emit("data", ev);
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Jalankan satu siklus rapat dewan ──────────────────────────────────────────
async function runCouncilCycle() {
  if (isRunning) return;
  isRunning = true;
  cycleCount++;
  const start = Date.now();

  try {
    bcast({ type: "stage", stage: "collecting", cycle: cycleCount, message: "Mengumpulkan data dari 3 AI Brain BTC…" });

    const [tech, fund, macro, indicators] = await Promise.all([
      getBtcTechnicalSignal().catch(() => null),
      getBtcFundamentalSignal().catch(() => null),
      getBtcMacroSignal().catch(() => null),
      fetchBtcusdIndicators("5").catch(() => null),
    ]);

    if (!tech || !fund || !macro || !indicators) {
      bcast({ type: "error", message: "Data brain belum tersedia — rapat ditunda." });
      return;
    }

    const price = indicators.price;
    bcast({
      type: "context",
      data: {
        price,
        tech:  { signal: tech.signal,  confidence: tech.confidence  },
        fund:  { signal: fund.signal,  confidence: fund.confidence  },
        macro: { signal: macro.signal, confidence: macro.confidence },
      },
    });
    bcast({ type: "stage", stage: "calling_ai", cycle: cycleCount, message: "Dewan BTC sedang berdebat — AI memproses pendapat 15 analis…" });

    const raw = await askDeepSeek(SYSTEM_PROMPT, buildUserPrompt(price, tech, fund, macro));

    bcast({ type: "stage", stage: "revealing", cycle: cycleCount, message: "Anggota dewan menyampaikan pendapat satu per satu…" });

    let parsed: {
      members?: { vote?: string; confidence?: number; opinion?: string }[];
      leaderDecision?: string;
      leaderConfidence?: number;
      leaderReasoning?: string;
    } = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch { /* fall through */ }

    const members: CouncilMemberOpinion[] = BTC_COUNCIL_MEMBERS.map((m, i) => {
      const item = parsed.members?.[i];
      const vote = item ? asVote(item.vote) : (tech.signal === fund.signal ? asVote(tech.signal) : "HOLD");
      return {
        name: m.name,
        role: m.role,
        vote,
        confidence: clamp01(item?.confidence),
        opinion: item?.opinion?.trim() || `Belum ada pendapat baru dari ${m.role.toLowerCase()} — mengacu sinyal brain terakhir.`,
      };
    });

    for (let i = 0; i < members.length; i++) {
      await delay(220);
      bcast({ type: "member", index: i, data: members[i] });
    }

    const buyVotes = members.filter((m) => m.vote === "BUY").length;
    const sellVotes = members.filter((m) => m.vote === "SELL").length;
    const holdVotes = members.filter((m) => m.vote === "HOLD").length;

    const majority = buyVotes >= sellVotes && buyVotes >= holdVotes ? "BUY" : sellVotes >= holdVotes ? "SELL" : "HOLD";
    const leaderDecision = parsed.leaderDecision ? asVote(parsed.leaderDecision) : majority;
    const leaderConfidence = clamp01(parsed.leaderConfidence, 0.5);
    const leaderReasoning =
      parsed.leaderReasoning?.trim() ||
      `Berdasarkan hasil voting dewan (BUY:${buyVotes} SELL:${sellVotes} HOLD:${holdVotes}), saya memutuskan ${leaderDecision} untuk BTC/USD saat ini (TP/SL dibatasi $1000).`;

    await delay(500);
    bcast({
      type: "leader",
      data: {
        name: BTC_COUNCIL_LEADER.name,
        title: BTC_COUNCIL_LEADER.title,
        decision: leaderDecision,
        confidence: leaderConfidence,
        reasoning: leaderReasoning,
        buyVotes, sellVotes, holdVotes,
      },
    });
    bcast({ type: "done", cycle: cycleCount });

    const debate: CouncilDebate = {
      debatedAt: new Date(),
      cycleNumber: cycleCount,
      price,
      members,
      buyVotes,
      sellVotes,
      holdVotes,
      leaderName: BTC_COUNCIL_LEADER.name,
      leaderTitle: BTC_COUNCIL_LEADER.title,
      leaderDecision,
      leaderConfidence,
      leaderReasoning,
    };

    lastDebate = debate;

    await db.insert(btcQuantCommitteeDebatesTable).values({
      cycleNumber: cycleCount,
      price,
      ensembleSignal: `T:${tech.signal}/F:${fund.signal}/M:${macro.signal}`,
      ensembleConfidence: (tech.confidence + fund.confidence + macro.confidence) / 3,
      members: members as unknown as Record<string, unknown>,
      buyVotes,
      sellVotes,
      holdVotes,
      leaderName: debate.leaderName,
      leaderTitle: debate.leaderTitle,
      leaderDecision,
      leaderConfidence,
      leaderReasoning,
      durationMs: Date.now() - start,
    }).catch(() => {});

    console.log(
      `[Dewan BTC] Rapat #${cycleCount}: BUY=${buyVotes} SELL=${sellVotes} HOLD=${holdVotes} → Presiden: ${leaderDecision} (${Date.now() - start}ms)`
    );
  } catch (err) {
    bcast({ type: "error", message: `Rapat error: ${err instanceof Error ? err.message : String(err)}` });
    console.error("[Dewan BTC] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startBtcCouncil() {
  console.log("[Dewan BTC] 🏛️ Started — rapat dewan setiap 8 menit (15 analis + 1 Presiden).");
  setTimeout(() => runCouncilCycle(), 30_000); // beri waktu 3 brain init dulu
  timer = setInterval(runCouncilCycle, CYCLE_MS);
}

export function stopBtcCouncil() {
  if (timer) clearInterval(timer);
}

export function getBtcCouncilDebate(): CouncilDebate | null {
  return lastDebate;
}

export async function getRecentBtcCouncilDebates(limit = 10) {
  return db.select().from(btcQuantCommitteeDebatesTable).orderBy(desc(btcQuantCommitteeDebatesTable.debatedAt)).limit(limit);
}
