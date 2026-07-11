/**
 * Dewan Emas (Gold Council) — Tim debat XAUUSD
 * 15 analis spesialis + 1 Gubernur (leader) yang mengambil keputusan akhir,
 * seperti kabinet sebuah negara. Setiap siklus, anggota dewan berdebat dan
 * memberi pendapat berdasarkan sinyal riil dari 3 brain (Technical/Fundamental/Macro),
 * lalu Gubernur mensintesis semua pendapat menjadi keputusan final.
 */

import { db } from "@workspace/db";
import { quantCommitteeDebatesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { getTechnicalSignal } from "./quant-technical-brain.js";
import { getFundamentalSignal } from "./quant-fundamental-brain.js";
import { getMacroSignal } from "./quant-macro-brain.js";
import { fetchXauusdIndicators } from "./xauusd-data.js";

// ─── Roster — 15 anggota Dewan Emas ────────────────────────────────────────────
export const GOLD_COUNCIL_MEMBERS = [
  { name: "Arya Wicaksono", role: "Kepala Analis Teknikal" },
  { name: "Ratna Kusuma", role: "Analis Elliott Wave & Fibonacci" },
  { name: "Dimas Prasetyo", role: "Analis Price Action & Order Flow" },
  { name: "Prof. Hartono Widjaja", role: "Ekonom Senior (Fed Watcher)" },
  { name: "Sari Handayani", role: "Analis DXY & Yield Curve" },
  { name: "Gunawan Santoso", role: "Analis Geopolitik & Safe Haven" },
  { name: "Melati Putri", role: "Spesialis COT Report" },
  { name: "Reza Firmansyah", role: "Analis Sentimen Ritel" },
  { name: "Bayu Aditya", role: "Trader Kontrarian" },
  { name: "Dewi Lestari", role: "Manajer Risiko" },
  { name: "Fajar Nugraha", role: "Analis Musiman & Historical Pattern" },
  { name: "Intan Permata", role: "Spesialis Korelasi Ekuitas & Bond" },
  { name: "Yusuf Ibrahim", role: "Analis Berita & Kalender Ekonomi" },
  { name: "Dr. Wibowo Santoso", role: "Kepala Riset Kuantitatif" },
  { name: "Anggun Kartika", role: "Analis Bank Sentral Global" },
] as const;

export const GOLD_COUNCIL_LEADER = { name: "Bambang Setiawan", title: "Gubernur Dewan Emas" };

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
const CYCLE_MS = 10 * 60 * 1000; // 10 min — 1 rapat dewan penuh per siklus

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
        temperature: 0.55, // sedikit lebih tinggi agar pendapat antar anggota bervariasi
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

const SYSTEM_PROMPT = `Kamu adalah fasilitator rapat "Dewan Emas" — komite trading XAUUSD (Gold) yang terdiri dari 15 analis spesialis dengan keahlian berbeda-beda, dipimpin oleh 1 Gubernur yang mengambil keputusan akhir (seperti kabinet sebuah negara).

ATURAN PENTING:
- Setiap anggota HARUS memberi pendapat sesuai keahliannya masing-masing, berdasarkan data yang diberikan — JANGAN membuat semua anggota berpendapat sama.
- Wajar jika ada perdebatan: beberapa anggota boleh BUY, sebagian SELL, sebagian HOLD, sesuai sudut pandang keahlian mereka.
- Gubernur mendengarkan semua pendapat lalu mengambil keputusan akhir yang mempertimbangkan mayoritas dan kualitas argumen (bukan sekadar voting mentah).
- Tulis dalam Bahasa Indonesia, tiap pendapat anggota MAKSIMAL 1 kalimat pendek dan spesifik (bukan generik).
- Balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.`;

function buildUserPrompt(
  price: number,
  tech: { signal: string; confidence: number; keySetup: string },
  fund: { signal: string; confidence: number; keyDriver: string },
  macro: { signal: string; confidence: number; macroRegime: string; geopoliticalRisk: string },
): string {
  const roster = GOLD_COUNCIL_MEMBERS.map((m, i) => `${i + 1}. ${m.name} — ${m.role}`).join("\n");
  return `DATA RAPAT DEWAN EMAS SAAT INI:
- Harga XAUUSD: $${price.toFixed(2)}
- Technical Brain: ${tech.signal} (confidence ${(tech.confidence * 100).toFixed(0)}%) — setup: ${tech.keySetup}
- Fundamental Brain: ${fund.signal} (confidence ${(fund.confidence * 100).toFixed(0)}%) — driver: ${fund.keyDriver}
- Macro Brain: ${macro.signal} (confidence ${(macro.confidence * 100).toFixed(0)}%) — regime: ${macro.macroRegime}, risiko geopolitik: ${macro.geopoliticalRisk}

DAFTAR HADIR (15 anggota dewan, urutan HARUS sama persis di jawabanmu):
${roster}

Buat pendapat untuk masing-masing dari 15 anggota di atas SESUAI URUTAN, lalu keputusan akhir dari Gubernur (Bambang Setiawan). Balas JSON dengan format persis:
{
  "members": [
    {"vote":"BUY|SELL|HOLD","confidence":0.0-1.0,"opinion":"pendapat 1 kalimat sesuai keahlian anggota ke-1"},
    ... (harus ada tepat 15 entri, urutan sesuai daftar hadir)
  ],
  "leaderDecision": "BUY|SELL|HOLD",
  "leaderConfidence": 0.0-1.0,
  "leaderReasoning": "2-3 kalimat sebagai Gubernur: sintesis pendapat dewan, sebutkan siapa yang argumennya paling kuat, dan keputusan akhir untuk trader"
}`;
}

// ─── Jalankan satu siklus rapat dewan ──────────────────────────────────────────
async function runCouncilCycle() {
  if (isRunning) return;
  isRunning = true;
  cycleCount++;
  const start = Date.now();

  try {
    const [tech, fund, macro, indicators] = await Promise.all([
      getTechnicalSignal().catch(() => null),
      getFundamentalSignal().catch(() => null),
      getMacroSignal().catch(() => null),
      fetchXauusdIndicators("1h").catch(() => null),
    ]);

    if (!tech || !fund || !macro || !indicators) return;

    const price = indicators.price;
    const raw = await askDeepSeek(SYSTEM_PROMPT, buildUserPrompt(price, tech, fund, macro));

    let parsed: {
      members?: { vote?: string; confidence?: number; opinion?: string }[];
      leaderDecision?: string;
      leaderConfidence?: number;
      leaderReasoning?: string;
    } = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      /* fall through to fallback below */
    }

    const members: CouncilMemberOpinion[] = GOLD_COUNCIL_MEMBERS.map((m, i) => {
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

    const buyVotes = members.filter((m) => m.vote === "BUY").length;
    const sellVotes = members.filter((m) => m.vote === "SELL").length;
    const holdVotes = members.filter((m) => m.vote === "HOLD").length;

    const majority = buyVotes >= sellVotes && buyVotes >= holdVotes ? "BUY" : sellVotes >= holdVotes ? "SELL" : "HOLD";
    const leaderDecision = parsed.leaderDecision ? asVote(parsed.leaderDecision) : majority;
    const leaderConfidence = clamp01(parsed.leaderConfidence, 0.5);
    const leaderReasoning =
      parsed.leaderReasoning?.trim() ||
      `Berdasarkan hasil voting dewan (BUY:${buyVotes} SELL:${sellVotes} HOLD:${holdVotes}), saya memutuskan ${leaderDecision} untuk XAUUSD saat ini.`;

    const debate: CouncilDebate = {
      debatedAt: new Date(),
      cycleNumber: cycleCount,
      price,
      members,
      buyVotes,
      sellVotes,
      holdVotes,
      leaderName: GOLD_COUNCIL_LEADER.name,
      leaderTitle: GOLD_COUNCIL_LEADER.title,
      leaderDecision,
      leaderConfidence,
      leaderReasoning,
    };

    lastDebate = debate;

    await db.insert(quantCommitteeDebatesTable).values({
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
      `[Dewan Emas] Rapat #${cycleCount}: BUY=${buyVotes} SELL=${sellVotes} HOLD=${holdVotes} → Gubernur: ${leaderDecision} (${Date.now() - start}ms)`
    );
  } catch (err) {
    console.error("[Dewan Emas] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

export function startGoldCouncil() {
  console.log("[Dewan Emas] 🏛️ Started — rapat dewan setiap 10 menit (15 analis + 1 Gubernur).");
  setTimeout(() => runCouncilCycle(), 25_000); // beri waktu 3 brain init dulu
  timer = setInterval(runCouncilCycle, CYCLE_MS);
}

export function stopGoldCouncil() {
  if (timer) clearInterval(timer);
}

export function getGoldCouncilDebate(): CouncilDebate | null {
  return lastDebate;
}

export async function getRecentGoldCouncilDebates(limit = 10) {
  return db.select().from(quantCommitteeDebatesTable).orderBy(desc(quantCommitteeDebatesTable.debatedAt)).limit(limit);
}

// ─── Live Debate Streaming ──────────────────────────────────────────────────────
// Dipanggil dari SSE endpoint; setiap langkah debat dikirim via callback `send`.
export async function runLiveCouncilDebate(
  send: (event: object) => void,
  timeoutMs = 60_000,
): Promise<void> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) {
    send({ type: "error", message: "API key belum dikonfigurasi. Tambahkan DeepSeek/OpenAI API key di halaman Admin → Settings." });
    return;
  }

  send({ type: "stage", stage: "collecting", message: "Mengumpulkan data dari 3 AI Brain…" });

  const [tech, fund, macro, indicators] = await Promise.all([
    getTechnicalSignal().catch(() => null),
    getFundamentalSignal().catch(() => null),
    getMacroSignal().catch(() => null),
    fetchXauusdIndicators("1h").catch(() => null),
  ]);

  if (!tech || !fund || !macro || !indicators) {
    send({ type: "error", message: "Data brain belum tersedia — tunggu beberapa detik lagi lalu coba kembali." });
    return;
  }

  const price = indicators.price;
  send({
    type: "context",
    data: {
      price,
      tech:  { signal: tech.signal,  confidence: tech.confidence,  keySetup: tech.keySetup },
      fund:  { signal: fund.signal,  confidence: fund.confidence,  keyDriver: fund.keyDriver },
      macro: { signal: macro.signal, confidence: macro.confidence, macroRegime: macro.macroRegime, geopoliticalRisk: macro.geopoliticalRisk },
    },
  });

  send({ type: "stage", stage: "calling_ai", message: "Menghubungi DeepSeek AI — Dewan sedang berdebat…" });

  // ── Stream dari DeepSeek ────────────────────────────────────────────────────
  const userPrompt = buildUserPrompt(price, tech, fund, macro);
  const ctrl = new AbortController();
  const tOut = setTimeout(() => ctrl.abort(), timeoutMs);
  let fullText = "";

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: userPrompt },
        ],
        max_tokens: 2800,
        temperature: 0.65,
        stream: true,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok || !res.body) {
      send({ type: "error", message: `DeepSeek API error: HTTP ${res.status}` });
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";          // simpan baris tidak lengkap

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const token: string = parsed?.choices?.[0]?.delta?.content ?? "";
          if (token) {
            fullText += token;
            send({ type: "token", text: token });
          }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    send({ type: "error", message: `Streaming terputus: ${(err as Error).message}` });
    return;
  } finally {
    clearTimeout(tOut);
  }

  // ── Parse hasil JSON ────────────────────────────────────────────────────────
  send({ type: "stage", stage: "parsing", message: "Menyusun hasil perdebatan…" });

  let parsedResult: {
    members?: { vote?: string; confidence?: number; opinion?: string }[];
    leaderDecision?: string;
    leaderConfidence?: number;
    leaderReasoning?: string;
  } = {};

  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (match) parsedResult = JSON.parse(match[0]);
  } catch { /* fallback below */ }

  const members: CouncilMemberOpinion[] = GOLD_COUNCIL_MEMBERS.map((m, i) => {
    const item = parsedResult.members?.[i];
    const vote = item ? asVote(item.vote) : (tech.signal === fund.signal ? asVote(tech.signal) : "HOLD");
    return {
      name: m.name,
      role: m.role,
      vote,
      confidence: clamp01(item?.confidence),
      opinion: item?.opinion?.trim() || `Belum ada pendapat baru dari ${m.role.toLowerCase()}.`,
    };
  });

  // Kirim tiap anggota satu per satu dengan jeda kecil
  for (let i = 0; i < members.length; i++) {
    await new Promise<void>((r) => setTimeout(r, 180));
    send({ type: "member", index: i, data: members[i] });
  }

  const buyVotes  = members.filter((m) => m.vote === "BUY").length;
  const sellVotes = members.filter((m) => m.vote === "SELL").length;
  const holdVotes = members.filter((m) => m.vote === "HOLD").length;
  const majority  = buyVotes >= sellVotes && buyVotes >= holdVotes ? "BUY" : sellVotes >= holdVotes ? "SELL" : "HOLD";
  const leaderDecision   = parsedResult.leaderDecision ? asVote(parsedResult.leaderDecision) : majority;
  const leaderConfidence = clamp01(parsedResult.leaderConfidence, 0.5);
  const leaderReasoning  = parsedResult.leaderReasoning?.trim() ||
    `Berdasarkan hasil voting dewan (BUY:${buyVotes} SELL:${sellVotes} HOLD:${holdVotes}), saya memutuskan ${leaderDecision} untuk XAUUSD saat ini.`;

  await new Promise<void>((r) => setTimeout(r, 400));
  send({
    type: "leader",
    data: {
      name: GOLD_COUNCIL_LEADER.name,
      title: GOLD_COUNCIL_LEADER.title,
      decision: leaderDecision,
      confidence: leaderConfidence,
      reasoning: leaderReasoning,
      buyVotes,
      sellVotes,
      holdVotes,
    },
  });

  send({ type: "done" });

  // ── Simpan ke DB & perbarui lastDebate ────────────────────────────────────
  const debate: CouncilDebate = {
    debatedAt: new Date(),
    cycleNumber: ++cycleCount,
    price,
    members,
    buyVotes,
    sellVotes,
    holdVotes,
    leaderName:       GOLD_COUNCIL_LEADER.name,
    leaderTitle:      GOLD_COUNCIL_LEADER.title,
    leaderDecision,
    leaderConfidence,
    leaderReasoning,
  };
  lastDebate = debate;

  await db.insert(quantCommitteeDebatesTable).values({
    cycleNumber:        debate.cycleNumber,
    price,
    ensembleSignal:     `T:${tech.signal}/F:${fund.signal}/M:${macro.signal}`,
    ensembleConfidence: (tech.confidence + fund.confidence + macro.confidence) / 3,
    members:            members as unknown as Record<string, unknown>,
    buyVotes,
    sellVotes,
    holdVotes,
    leaderName:         debate.leaderName,
    leaderTitle:        debate.leaderTitle,
    leaderDecision,
    leaderConfidence,
    leaderReasoning,
    durationMs:         0,
  }).catch(() => {});
}
