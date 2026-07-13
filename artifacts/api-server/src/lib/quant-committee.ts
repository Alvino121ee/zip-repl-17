/**
 * Dewan Emas (Gold Council) — Komite Debat XAUUSD
 *
 * Struktur (seperti negara cerdas):
 *   21 analis spesialis dalam 4 divisi + 1 Gubernur yang memegang hak veto
 *
 *   Divisi I   — Teknikal          (7 analis, bobot 35%)
 *   Divisi II  — Makroekonomi      (7 analis, bobot 30%)
 *   Divisi III — Sentimen & Psikologi (4 analis, bobot 20%)
 *   Divisi IV  — Manajemen Risiko & Kuantitatif (3 analis, bobot 15%)
 *
 * Mekanisme Sidang 2 Babak:
 *   BABAK 1 — Semua 21 analis memberi pendapat & vote individual
 *   BABAK 2 — 4 Kepala Divisi berdebat lintas divisi, Gubernur memutuskan + tulis surat keputusan
 */

import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { quantCommitteeDebatesTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { getDeepseekApiKey } from "./xauusd-settings.js";
import { getTechnicalSignal } from "./quant-technical-brain.js";
import { getFundamentalSignal } from "./quant-fundamental-brain.js";
import { getMacroSignal } from "./quant-macro-brain.js";
import { fetchXauusdIndicators } from "./xauusd-data.js";

// ─── Live broadcast — SSE clients subscribe ke ini ──────────────────────────────
export const councilEvents = new EventEmitter();
councilEvents.setMaxListeners(200);
export function getIsCouncilRunning() { return isRunning; }

// ─── Tipe Divisi ────────────────────────────────────────────────────────────────
export type CouncilDivision = "teknikal" | "makro" | "sentimen" | "risiko";

export interface CouncilMember {
  name: string;
  role: string;
  division: CouncilDivision;
  isHead?: boolean; // Kepala divisi — berbicara di Babak 2
}

// ─── Roster 21 Analis ──────────────────────────────────────────────────────────
export const GOLD_COUNCIL_MEMBERS: CouncilMember[] = [
  // ── DIVISI I: TEKNIKAL (35%) ────────────────────────────────────────────────
  { name: "Arya Wicaksono",    role: "Kepala Divisi Teknikal — Trend & Timeframe Alignment",     division: "teknikal", isHead: true  },
  { name: "Ratna Kusuma",      role: "Analis Elliott Wave & Fibonacci",                           division: "teknikal" },
  { name: "Dimas Prasetyo",    role: "Analis Price Action & Order Flow",                          division: "teknikal" },
  { name: "Galih Permana",     role: "Spesialis Smart Money Concepts — Order Block & FVG",        division: "teknikal" },
  { name: "Tiara Nusa",        role: "Analis Indikator & Oscillator — RSI, MACD, Stochastic",    division: "teknikal" },
  { name: "Bima Sakti",        role: "Analis Support, Resistance & ATR — Level Kritis & Volatilitas", division: "teknikal" },
  { name: "Fajar Nugraha",     role: "Analis Musiman & Historical Pattern — Seasonality Gold",    division: "teknikal" },

  // ── DIVISI II: MAKROEKONOMI (30%) ────────────────────────────────────────────
  { name: "Prof. Hartono Widjaja", role: "Kepala Divisi Makro & Fed Watcher — FOMC & Rate Policy",  division: "makro", isHead: true },
  { name: "Sari Handayani",    role: "Analis DXY & Yield Curve — Real Yield & TIPS",             division: "makro" },
  { name: "Gunawan Santoso",   role: "Analis Geopolitik & Safe Haven — Konflik & Flight-to-Safety", division: "makro" },
  { name: "Anggun Kartika",    role: "Analis Bank Sentral Global — ECB, BoJ, PBoC, Cadangan Emas",  division: "makro" },
  { name: "Intan Permata",     role: "Spesialis Korelasi Ekuitas & Bond — Risk-On/Off, S&P500",  division: "makro" },
  { name: "Melati Putri",      role: "Spesialis COT Report — Positioning Net Long/Short Institutional", division: "makro" },
  { name: "Yusuf Ibrahim",     role: "Analis Berita & Kalender Ekonomi — Event Impact & Timing", division: "makro" },

  // ── DIVISI III: SENTIMEN & PSIKOLOGI (20%) ───────────────────────────────────
  { name: "Reza Firmansyah",   role: "Kepala Divisi Sentimen — Ritel & Fear/Greed Index",        division: "sentimen", isHead: true },
  { name: "Bayu Aditya",       role: "Trader Kontrarian — Selalu berargumen berlawanan konsensus (devil's advocate)", division: "sentimen" },
  { name: "Nadira Wulan",      role: "Analis Psikologi Market & Crowd Behavior — FOMO & Kepanikan",  division: "sentimen" },
  { name: "Kevin Sirait",      role: "Analis Social Sentiment & News Sentiment — Narasi Publik vs Harga", division: "sentimen" },

  // ── DIVISI IV: RISIKO & KUANTITATIF (15%) ───────────────────────────────────
  { name: "Dr. Wibowo Santoso", role: "Kepala Divisi Kuantitatif — Probabilitas & Win Rate Historis", division: "risiko", isHead: true },
  { name: "Dewi Lestari",      role: "Manajer Risiko — Risk/Reward, Max Drawdown & Edge Validasi", division: "risiko" },
  { name: "Prasetya Budi",     role: "Analis Eksekusi & Position Sizing — Lot Optimal & Timing Entry", division: "risiko" },
] as const;

export const GOLD_COUNCIL_LEADER = {
  name: "Bambang Setiawan",
  title: "Gubernur Dewan Emas",
};

// Bobot per divisi
const DIVISION_WEIGHTS: Record<CouncilDivision, number> = {
  teknikal:  0.35,
  makro:     0.30,
  sentimen:  0.20,
  risiko:    0.15,
};

// ─── Interface ──────────────────────────────────────────────────────────────────
export interface CouncilMemberOpinion {
  name: string;
  role: string;
  division: CouncilDivision;
  vote: "BUY" | "SELL" | "HOLD";
  confidence: number;
  opinion: string;
}

export interface DivisionResult {
  division: CouncilDivision;
  buyVotes: number;
  sellVotes: number;
  holdVotes: number;
  signal: "BUY" | "SELL" | "HOLD";
  headName: string;
  headOpinion: string; // Presentasi kepala divisi di Babak 2
}

export interface CouncilDebate {
  debatedAt: Date;
  cycleNumber: number;
  price: number | null;
  members: CouncilMemberOpinion[];
  divisionResults: DivisionResult[];
  buyVotes: number;
  sellVotes: number;
  holdVotes: number;
  weightedSignal: "BUY" | "SELL" | "HOLD";
  weightedScore: number;
  crossDebateSummary: string;
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
const CYCLE_MS = 10 * 60 * 1000;

// ─── Helpers ────────────────────────────────────────────────────────────────────
function clamp01(n: unknown, fallback = 0.5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(0.95, Math.max(0.1, v));
}

function asVote(v: unknown): "BUY" | "SELL" | "HOLD" {
  const s = String(v ?? "").toUpperCase().trim();
  return s === "BUY" || s === "SELL" || s === "HOLD" ? s : "HOLD";
}

function divisionMajority(members: CouncilMemberOpinion[], div: CouncilDivision): "BUY" | "SELL" | "HOLD" {
  const m = members.filter((x) => x.division === div);
  const b = m.filter((x) => x.vote === "BUY").length;
  const s = m.filter((x) => x.vote === "SELL").length;
  const h = m.filter((x) => x.vote === "HOLD").length;
  return b >= s && b >= h ? "BUY" : s >= h ? "SELL" : "HOLD";
}

function computeWeightedScore(divResults: DivisionResult[]): { score: number; signal: "BUY" | "SELL" | "HOLD" } {
  let score = 0;
  for (const d of divResults) {
    const w = DIVISION_WEIGHTS[d.division];
    const total = d.buyVotes + d.sellVotes + d.holdVotes;
    if (total === 0) continue;
    const divScore = (d.buyVotes - d.sellVotes) / total;
    score += divScore * w;
  }
  const signal: "BUY" | "SELL" | "HOLD" = score > 0.08 ? "BUY" : score < -0.08 ? "SELL" : "HOLD";
  return { score, signal };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── DeepSeek caller ────────────────────────────────────────────────────────────
async function askDeepSeek(system: string, user: string, maxTokens = 2800, timeoutMs = 55000): Promise<string> {
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
        max_tokens: maxTokens,
        temperature: 0.6,
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  } catch { return ""; }
  finally { clearTimeout(t); }
}

// ─── System Prompt ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT_ROUND1 = `Kamu adalah fasilitator sidang "Dewan Emas" — komite trading XAUUSD yang terdiri dari 21 analis spesialis dalam 4 divisi, dipimpin oleh 1 Gubernur.

ATURAN BABAK 1:
- Setiap anggota memberi pendapat 1 kalimat SINGKAT & SPESIFIK sesuai keahliannya — berdasarkan data yang diberikan.
- Wajib ada perbedaan pendapat antar anggota — terutama Bayu Aditya (Kontrarian) HARUS berbeda dari mayoritas.
- Jangan generik. Sebut angka, level, atau kondisi spesifik.
- Balas HANYA JSON valid, tanpa teks lain di luar JSON.`;

const SYSTEM_PROMPT_ROUND2 = `Kamu adalah Gubernur Dewan Emas yang memfasilitasi debat lintas divisi dan mengambil keputusan final trading XAUUSD.

ATURAN BABAK 2:
- Kepala tiap divisi menyampaikan rangkuman pendapat divisinya.
- Gubernur mempertimbangkan bobot: Teknikal(35%) Makro(30%) Sentimen(20%) Risiko(15%).
- Gubernur BOLEH menggunakan hak veto jika ada risiko ekstrim yang diabaikan mayoritas.
- Surat Keputusan Gubernur HARUS menyebut nama kepala divisi yang argumennya paling kuat.
- Balas HANYA JSON valid, tanpa teks lain di luar JSON.`;

// ─── Babak 1 Prompt — 21 analis voting ──────────────────────────────────────────
function buildRound1Prompt(
  price: number,
  tech: { signal: string; confidence: number; keySetup: string },
  fund: { signal: string; confidence: number; keyDriver: string },
  macro: { signal: string; confidence: number; macroRegime: string; geopoliticalRisk: string },
): string {
  const roster = GOLD_COUNCIL_MEMBERS
    .map((m, i) => `${i + 1}. [${m.division.toUpperCase()}] ${m.name}${m.isHead ? " ★" : ""} — ${m.role}`)
    .join("\n");

  return `DATA SIDANG DEWAN EMAS — BABAK 1:
- Harga XAUUSD: $${price.toFixed(2)}
- Technical Brain: ${tech.signal} (${(tech.confidence * 100).toFixed(0)}%) → ${tech.keySetup}
- Fundamental Brain: ${fund.signal} (${(fund.confidence * 100).toFixed(0)}%) → ${fund.keyDriver}
- Macro Brain: ${macro.signal} (${(macro.confidence * 100).toFixed(0)}%) → ${macro.macroRegime} | geopolitik: ${macro.geopoliticalRisk}

DAFTAR 21 ANGGOTA DEWAN (★ = Kepala Divisi):
${roster}

Format JSON yang harus dikembalikan (TEPAT 21 entri, urutan HARUS sama persis):
{
  "members": [
    {"vote":"BUY|SELL|HOLD","confidence":0.0-1.0,"opinion":"1 kalimat spesifik sesuai keahlian"},
    ... (21 entri total)
  ]
}`;
}

// ─── Babak 2 Prompt — Kepala Divisi debat, Gubernur memutuskan ──────────────────
function buildRound2Prompt(
  price: number,
  divResults: DivisionResult[],
  weightedSignal: "BUY" | "SELL" | "HOLD",
  weightedScore: number,
): string {
  const divSummary = divResults.map((d) => {
    const total = d.buyVotes + d.sellVotes + d.holdVotes;
    return `• [${d.division.toUpperCase()}] ${d.headName}: Vote internal ${d.buyVotes}BUY/${d.sellVotes}SELL/${d.holdVotes}HOLD → ${d.signal}. "${d.headOpinion}"`;
  }).join("\n");

  return `DATA SIDANG DEWAN EMAS — BABAK 2 (DEBAT LINTAS DIVISI):
- Harga XAUUSD: $${price.toFixed(2)}
- Weighted Score dari 4 divisi: ${(weightedScore * 100).toFixed(1)} (positif=BUY, negatif=SELL)
- Sinyal tertimbang sementara: ${weightedSignal}

PRESENTASI KEPALA DIVISI:
${divSummary}

Bobot divisi: Teknikal 35%, Makro 30%, Sentimen 20%, Risiko 15%.

Gubernur harus:
1. Tulis 1-2 kalimat ringkasan perdebatan lintas divisi (siapa yang berseberangan dan mengapa)
2. Ambil keputusan final (boleh veto jika ada risiko besar yang diabaikan)
3. Tulis surat keputusan 2-3 kalimat: sebut kepala divisi yang paling kuat argumennya

Format JSON:
{
  "crossDebate": "1-2 kalimat perdebatan lintas divisi yang menarik",
  "leaderDecision": "BUY|SELL|HOLD",
  "leaderConfidence": 0.0-1.0,
  "leaderReasoning": "2-3 kalimat surat keputusan Gubernur Bambang Setiawan"
}`;
}

// ─── Parse Babak 1 ───────────────────────────────────────────────────────────────
function parseRound1(
  raw: string,
  tech: { signal: string },
  fund: { signal: string },
): CouncilMemberOpinion[] {
  let parsed: { members?: { vote?: string; confidence?: number; opinion?: string }[] } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch { /* fallback */ }

  return GOLD_COUNCIL_MEMBERS.map((m, i) => {
    const item = parsed.members?.[i];
    const fallbackVote = tech.signal === fund.signal ? asVote(tech.signal) : "HOLD";
    return {
      name: m.name,
      role: m.role,
      division: m.division,
      vote: item ? asVote(item.vote) : fallbackVote,
      confidence: clamp01(item?.confidence),
      opinion: item?.opinion?.trim() || `Data tersedia, menunggu update sinyal dari ${m.role.split("—")[0].trim().toLowerCase()}.`,
    };
  });
}

// ─── Hitung hasil per divisi ─────────────────────────────────────────────────────
function buildDivisionResults(members: CouncilMemberOpinion[]): DivisionResult[] {
  const divisions: CouncilDivision[] = ["teknikal", "makro", "sentimen", "risiko"];
  return divisions.map((div) => {
    const divMembers = members.filter((m) => m.division === div);
    const buyVotes  = divMembers.filter((m) => m.vote === "BUY").length;
    const sellVotes = divMembers.filter((m) => m.vote === "SELL").length;
    const holdVotes = divMembers.filter((m) => m.vote === "HOLD").length;
    const signal = divisionMajority(members, div);
    const head = divMembers.find((m) => GOLD_COUNCIL_MEMBERS.find((c) => c.name === m.name)?.isHead);
    return {
      division: div,
      buyVotes, sellVotes, holdVotes, signal,
      headName: head?.name ?? divMembers[0]?.name ?? "?",
      headOpinion: head?.opinion ?? divMembers[0]?.opinion ?? "Belum ada pendapat.",
    };
  });
}

// ─── Broadcast helper ────────────────────────────────────────────────────────────
function broadcast(ev: object) { councilEvents.emit("data", ev); }

// ─── Siklus rapat dewan (background timer) ──────────────────────────────────────
async function runCouncilCycle() {
  if (isRunning) return;
  isRunning = true;
  cycleCount++;
  const start = Date.now();

  try {
    broadcast({ type: "stage", stage: "collecting", cycle: cycleCount,
      message: "Mengumpulkan data dari 3 AI Brain…" });

    const [tech, fund, macro, indicators] = await Promise.all([
      getTechnicalSignal().catch(() => null),
      getFundamentalSignal().catch(() => null),
      getMacroSignal().catch(() => null),
      fetchXauusdIndicators("1h").catch(() => null),
    ]);

    if (!tech || !fund || !macro || !indicators) {
      broadcast({ type: "error", message: "Data brain belum tersedia — rapat ditunda." });
      return;
    }

    const price = indicators.price;
    broadcast({ type: "context", data: { price, tech, fund, macro } });

    // ── BABAK 1: 21 analis vote ────────────────────────────────────────────────
    broadcast({ type: "stage", stage: "round1", cycle: cycleCount,
      message: "BABAK 1 — 21 analis menyampaikan pendapat individual…" });

    const raw1 = await askDeepSeek(SYSTEM_PROMPT_ROUND1, buildRound1Prompt(price, tech, fund, macro), 2800);
    const members = parseRound1(raw1, tech, fund);

    // Reveal satu per satu
    for (let i = 0; i < members.length; i++) {
      await delay(180);
      broadcast({ type: "member", index: i, data: members[i] });
    }

    const divisionResults = buildDivisionResults(members);
    const { score: weightedScore, signal: weightedSignal } = computeWeightedScore(divisionResults);

    broadcast({ type: "round1_done", divisionResults, weightedSignal, weightedScore,
      buyVotes: members.filter((m) => m.vote === "BUY").length,
      sellVotes: members.filter((m) => m.vote === "SELL").length,
      holdVotes: members.filter((m) => m.vote === "HOLD").length,
      message: "BABAK 1 selesai — Kepala Divisi mempersiapkan presentasi lintas divisi…" });

    // ── BABAK 2: Kepala Divisi debat, Gubernur memutuskan ─────────────────────
    await delay(800);
    broadcast({ type: "stage", stage: "round2", cycle: cycleCount,
      message: "BABAK 2 — Debat lintas divisi, Gubernur mengambil keputusan akhir…" });

    const raw2 = await askDeepSeek(SYSTEM_PROMPT_ROUND2,
      buildRound2Prompt(price, divisionResults, weightedSignal, weightedScore), 800);

    let parsed2: { crossDebate?: string; leaderDecision?: string; leaderConfidence?: number; leaderReasoning?: string } = {};
    try {
      const match = raw2.match(/\{[\s\S]*\}/);
      if (match) parsed2 = JSON.parse(match[0]);
    } catch { /* fallback */ }

    const buyVotes  = members.filter((m) => m.vote === "BUY").length;
    const sellVotes = members.filter((m) => m.vote === "SELL").length;
    const holdVotes = members.filter((m) => m.vote === "HOLD").length;
    const leaderDecision   = parsed2.leaderDecision ? asVote(parsed2.leaderDecision) : weightedSignal;
    const leaderConfidence = clamp01(parsed2.leaderConfidence, 0.55);
    const crossDebateSummary = parsed2.crossDebate?.trim() ||
      `Keempat kepala divisi sepakat pada sinyal ${weightedSignal} berdasarkan bobot tertimbang.`;
    const leaderReasoning = parsed2.leaderReasoning?.trim() ||
      `Berdasarkan weighted score ${(weightedScore * 100).toFixed(1)} dari 4 divisi, Gubernur memutuskan ${leaderDecision}.`;

    await delay(500);
    broadcast({
      type: "leader",
      data: {
        name: GOLD_COUNCIL_LEADER.name, title: GOLD_COUNCIL_LEADER.title,
        decision: leaderDecision, confidence: leaderConfidence,
        reasoning: leaderReasoning, crossDebateSummary,
        buyVotes, sellVotes, holdVotes,
        weightedSignal, weightedScore,
      },
    });
    broadcast({ type: "done", cycle: cycleCount });

    const debate: CouncilDebate = {
      debatedAt: new Date(), cycleNumber: cycleCount, price, members, divisionResults,
      buyVotes, sellVotes, holdVotes, weightedSignal, weightedScore, crossDebateSummary,
      leaderName: GOLD_COUNCIL_LEADER.name, leaderTitle: GOLD_COUNCIL_LEADER.title,
      leaderDecision, leaderConfidence, leaderReasoning,
    };
    lastDebate = debate;

    await db.insert(quantCommitteeDebatesTable).values({
      cycleNumber: cycleCount, price,
      ensembleSignal: `T:${tech.signal}/F:${fund.signal}/M:${macro.signal}`,
      ensembleConfidence: (tech.confidence + fund.confidence + macro.confidence) / 3,
      members: members as unknown as Record<string, unknown>,
      buyVotes, sellVotes, holdVotes,
      leaderName: debate.leaderName, leaderTitle: debate.leaderTitle,
      leaderDecision, leaderConfidence, leaderReasoning,
      durationMs: Date.now() - start,
    }).catch(() => {});

    console.log(
      `[Dewan Emas] Rapat #${cycleCount} selesai: 21 analis | weighted=${weightedSignal}(${(weightedScore*100).toFixed(1)}) → Gubernur: ${leaderDecision} (${Date.now() - start}ms)`
    );
  } catch (err) {
    broadcast({ type: "error", message: `Rapat error: ${err instanceof Error ? err.message : String(err)}` });
    console.error("[Dewan Emas] Cycle error:", err instanceof Error ? err.message : err);
  } finally {
    isRunning = false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────────
export function startGoldCouncil() {
  console.log("[Dewan Emas] 🏛️ Started — 21 analis (4 divisi) + Gubernur | rapat 2 babak setiap 10 menit.");
  setTimeout(() => runCouncilCycle(), 25_000);
  timer = setInterval(runCouncilCycle, CYCLE_MS);
}

export function stopGoldCouncil() {
  if (timer) clearInterval(timer);
}

export function getGoldCouncilDebate(): CouncilDebate | null {
  return lastDebate;
}

export async function getRecentGoldCouncilDebates(limit = 10) {
  return db.select().from(quantCommitteeDebatesTable)
    .orderBy(desc(quantCommitteeDebatesTable.debatedAt)).limit(limit);
}

// ─── Live Debate (SSE endpoint dipanggil dari frontend) ──────────────────────────
export async function runLiveCouncilDebate(
  send: (event: object) => void,
  timeoutMs = 90_000,
): Promise<void> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) {
    send({ type: "error", message: "API key belum dikonfigurasi. Tambahkan DeepSeek API key di halaman Admin → Settings." });
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
    send({ type: "error", message: "Data brain belum tersedia — tunggu beberapa detik lalu coba kembali." });
    return;
  }

  const price = indicators.price;
  send({
    type: "context",
    data: {
      price,
      tech:  { signal: tech.signal,  confidence: tech.confidence,  keySetup: tech.keySetup },
      fund:  { signal: fund.signal,  confidence: fund.confidence,  keyDriver: fund.keyDriver },
      macro: { signal: macro.signal, confidence: macro.confidence,
               macroRegime: macro.macroRegime, geopoliticalRisk: macro.geopoliticalRisk },
    },
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // BABAK 1 — 21 analis vote (streaming)
  // ══════════════════════════════════════════════════════════════════════════════
  send({ type: "stage", stage: "round1", message: "BABAK 1 — 21 analis menyampaikan pendapat individual…" });

  const ctrl1 = new AbortController();
  const t1 = setTimeout(() => ctrl1.abort(), Math.floor(timeoutMs * 0.6));
  let fullText1 = "";

  try {
    const res1 = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT_ROUND1 },
          { role: "user",   content: buildRound1Prompt(price, tech, fund, macro) },
        ],
        max_tokens: 2800, temperature: 0.6, stream: true,
      }),
      signal: ctrl1.signal,
    });

    if (!res1.ok || !res1.body) { send({ type: "error", message: `DeepSeek error: HTTP ${res1.status}` }); return; }

    const reader1  = res1.body.getReader();
    const decoder1 = new TextDecoder();
    let buf1 = "";
    while (true) {
      const { done, value } = await reader1.read();
      if (done) break;
      buf1 += decoder1.decode(value, { stream: true });
      const lines = buf1.split("\n");
      buf1 = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const token: string = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content ?? "";
          if (token) { fullText1 += token; send({ type: "token", round: 1, text: token }); }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    send({ type: "error", message: `Streaming Babak 1 terputus: ${(err as Error).message}` }); return;
  } finally { clearTimeout(t1); }

  // Parse & reveal anggota satu per satu
  send({ type: "stage", stage: "revealing", message: "Anggota dewan menyampaikan pendapat satu per satu…" });
  const members = parseRound1(fullText1, tech, fund);
  for (let i = 0; i < members.length; i++) {
    await new Promise<void>((r) => setTimeout(r, 160));
    send({ type: "member", index: i, data: members[i] });
  }

  const divisionResults = buildDivisionResults(members);
  const { score: weightedScore, signal: weightedSignal } = computeWeightedScore(divisionResults);
  const buyVotes  = members.filter((m) => m.vote === "BUY").length;
  const sellVotes = members.filter((m) => m.vote === "SELL").length;
  const holdVotes = members.filter((m) => m.vote === "HOLD").length;

  send({
    type: "round1_done", divisionResults, weightedSignal, weightedScore,
    buyVotes, sellVotes, holdVotes,
    message: "BABAK 1 selesai — Kepala Divisi memasuki ruang debat lintas divisi…",
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // BABAK 2 — Kepala Divisi debat + Gubernur memutuskan (streaming)
  // ══════════════════════════════════════════════════════════════════════════════
  await new Promise<void>((r) => setTimeout(r, 600));
  send({ type: "stage", stage: "round2", message: "BABAK 2 — Debat lintas divisi sedang berlangsung, Gubernur mempertimbangkan…" });

  const ctrl2 = new AbortController();
  const t2 = setTimeout(() => ctrl2.abort(), Math.floor(timeoutMs * 0.4));
  let fullText2 = "";

  try {
    const res2 = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT_ROUND2 },
          { role: "user",   content: buildRound2Prompt(price, divisionResults, weightedSignal, weightedScore) },
        ],
        max_tokens: 800, temperature: 0.5, stream: true,
      }),
      signal: ctrl2.signal,
    });

    if (!res2.ok || !res2.body) { send({ type: "error", message: `DeepSeek error Babak 2: HTTP ${res2.status}` }); return; }

    const reader2  = res2.body.getReader();
    const decoder2 = new TextDecoder();
    let buf2 = "";
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      buf2 += decoder2.decode(value, { stream: true });
      const lines = buf2.split("\n");
      buf2 = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        try {
          const token: string = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content ?? "";
          if (token) { fullText2 += token; send({ type: "token", round: 2, text: token }); }
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    send({ type: "error", message: `Streaming Babak 2 terputus: ${(err as Error).message}` }); return;
  } finally { clearTimeout(t2); }

  // Parse keputusan Gubernur
  let parsed2: { crossDebate?: string; leaderDecision?: string; leaderConfidence?: number; leaderReasoning?: string } = {};
  try {
    const match = fullText2.match(/\{[\s\S]*\}/);
    if (match) parsed2 = JSON.parse(match[0]);
  } catch { /* fallback */ }

  const leaderDecision   = parsed2.leaderDecision ? asVote(parsed2.leaderDecision) : weightedSignal;
  const leaderConfidence = clamp01(parsed2.leaderConfidence, 0.55);
  const crossDebateSummary = parsed2.crossDebate?.trim() ||
    `Keempat divisi berdebat — weighted score ${(weightedScore * 100).toFixed(1)} mengarah ${weightedSignal}.`;
  const leaderReasoning = parsed2.leaderReasoning?.trim() ||
    `Gubernur memutuskan ${leaderDecision} berdasarkan analisis tertimbang 4 divisi (score: ${(weightedScore * 100).toFixed(1)}).`;

  await new Promise<void>((r) => setTimeout(r, 400));
  send({
    type: "leader",
    data: {
      name: GOLD_COUNCIL_LEADER.name, title: GOLD_COUNCIL_LEADER.title,
      decision: leaderDecision, confidence: leaderConfidence,
      reasoning: leaderReasoning, crossDebateSummary,
      buyVotes, sellVotes, holdVotes, weightedSignal, weightedScore,
    },
  });

  send({ type: "done" });

  // ── Simpan ke DB ─────────────────────────────────────────────────────────────
  const debate: CouncilDebate = {
    debatedAt: new Date(), cycleNumber: ++cycleCount, price, members, divisionResults,
    buyVotes, sellVotes, holdVotes, weightedSignal, weightedScore, crossDebateSummary,
    leaderName: GOLD_COUNCIL_LEADER.name, leaderTitle: GOLD_COUNCIL_LEADER.title,
    leaderDecision, leaderConfidence, leaderReasoning,
  };
  lastDebate = debate;

  await db.insert(quantCommitteeDebatesTable).values({
    cycleNumber: debate.cycleNumber, price,
    ensembleSignal: `T:${tech.signal}/F:${fund.signal}/M:${macro.signal}`,
    ensembleConfidence: (tech.confidence + fund.confidence + macro.confidence) / 3,
    members: members as unknown as Record<string, unknown>,
    buyVotes, sellVotes, holdVotes,
    leaderName: debate.leaderName, leaderTitle: debate.leaderTitle,
    leaderDecision, leaderConfidence, leaderReasoning, durationMs: 0,
  }).catch(() => {});
}
