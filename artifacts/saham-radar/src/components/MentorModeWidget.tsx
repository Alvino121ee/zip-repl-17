/**
 * MentorModeWidget — Floating draggable trading mentor
 *
 * State machine:
 *  - stableCmd  — the command shown to user; only changes when:
 *      • TUNGGU  : always immediate (no cooldown, never blocks UX)
 *      • actionable (BUKA BUY/SHORT, CLOSE) : respects 15s cooldown
 *  - positionState — tracked by user via Konfirmasi button
 *
 * Cooldown only resets when an ACTIONABLE command is accepted.
 * Going to TUNGGU never triggers or restarts cooldown.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp, TrendingDown, Minus, GraduationCap,
  Power, PowerOff, ChevronDown, ChevronUp, History,
  AlertCircle, X, GripVertical, Wifi, WifiOff, DollarSign,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sensitivity = "super_aggressive" | "aggressive" | "normal" | "conservative";
type RawCommand = "BUY" | "SHORT" | "HOLD";
type PositionState = "NONE" | "BUY" | "SHORT";
type DisplayCommand = "BUKA BUY" | "BUKA SHORT" | "CLOSE BUY" | "CLOSE SHORT" | "TUNGGU";
type SignalMode = "mentor" | "ai_utama";

interface MentorSignal {
  command: RawCommand;
  reasons: string[];
  minTP: number | null;
  minSL: number | null;
  minTPDistance: number | null;
  confidence: number;
  price: number | null;
  bullishScore: number;
  bearishScore: number;
  indicatorsAgeMs: number | null;
  snapshotAgeMs: number | null; // backward-compat alias
  dataSource: "live" | "snapshot";
}

interface HistoryEntry {
  command: DisplayCommand;
  price: number;
  time: string;
}

interface EaPosition {
  ticket: number;
  type: "BUY" | "SELL";
  volume: number;
  symbol: string;
  openPrice: number;
  currentPrice: number;
  tp: number;
  sl: number;
  pnl: number;
}

interface EaAccountData {
  balance: number;
  equity: number;
  freeMargin: number;
  pnl: number;
  positions: EaPosition[];
  accountName: string;
  accountNumber: number;
  broker: string;
  leverage: number;
  currency: string;
  updatedAt: string;
}

interface EaAccountResponse {
  connected: boolean;
  data: EaAccountData | null;
}

interface EnsembleVoteEntry { direction: string; confidence: number; label: string }
interface EnsembleVotes {
  technical: EnsembleVoteEntry;
  macro: EnsembleVoteEntry;
  sentiment: EnsembleVoteEntry;
  ai: EnsembleVoteEntry;
  agreementCount: number;
  finalDirection: "up" | "down";
}

interface MainPrediction {
  id: number;
  direction: string;
  confidence: number;
  timeframe: string;
  indicatorsAtPrediction?: { ensembleVotes?: EnsembleVotes; [key: string]: unknown };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function resolveDisplay(raw: RawCommand, position: PositionState): DisplayCommand {
  if (position === "NONE") {
    if (raw === "BUY")   return "BUKA BUY";
    if (raw === "SHORT") return "BUKA SHORT";
    return "TUNGGU";
  }
  if (position === "BUY")   return raw === "SHORT" ? "CLOSE BUY"   : "TUNGGU";
  /* SHORT */               return raw === "BUY"   ? "CLOSE SHORT" : "TUNGGU";
}

function isActionable(cmd: DisplayCommand): boolean {
  return cmd !== "TUNGGU";
}

function commandStyle(cmd: DisplayCommand) {
  switch (cmd) {
    case "BUKA BUY":
      return { bg: "bg-emerald-500/15 border-emerald-500/40", text: "text-emerald-400", icon: <TrendingUp className="w-7 h-7" /> };
    case "BUKA SHORT":
      return { bg: "bg-red-500/15 border-red-500/40", text: "text-red-400", icon: <TrendingDown className="w-7 h-7" /> };
    case "CLOSE BUY":
    case "CLOSE SHORT":
      return { bg: "bg-amber-500/15 border-amber-500/40", text: "text-amber-400", icon: <X className="w-7 h-7" /> };
    default:
      return { bg: "bg-zinc-800/80 border-zinc-700/50", text: "text-zinc-400", icon: <Minus className="w-7 h-7" /> };
  }
}

function fmt(n: number | null | undefined) {
  return n != null ? n.toFixed(2) : "—";
}

const COOLDOWN_BY_SENSITIVITY: Record<Sensitivity, number> = {
  super_aggressive: 5_000,
  aggressive: 10_000,
  normal: 15_000,
  conservative: 20_000,
};

const AI_UTAMA_LABELS: Record<keyof Pick<EnsembleVotes, "technical" | "ai" | "macro" | "sentiment">, string> = {
  technical: "Teknikal",
  ai: "AI Rule",
  macro: "Macro",
  sentiment: "Sentimen",
};

/**
 * Mode "AI Utama" — beda dari Mentor Mode biasa (yang pakai skor indikator teknikal
 * mentah). Di sini sinyal ditentukan dari akumulasi persentase confidence 4 agen
 * ensemble (Teknikal/AI Rule/Macro/Sentimen): jika total % arah naik > total % arah
 * turun → sinyal NAIK (BUY), sebaliknya SHORT. Seri → HOLD.
 */
function computeAiUtamaVote(ev: EnsembleVotes | undefined): {
  command: RawCommand;
  confidence: number;
  upTotal: number;
  downTotal: number;
  reasons: string[];
} {
  if (!ev) return { command: "HOLD", confidence: 0, upTotal: 0, downTotal: 0, reasons: [] };

  const keys = ["technical", "ai", "macro", "sentiment"] as const;
  let upTotal = 0;
  let downTotal = 0;
  const upParts: string[] = [];
  const downParts: string[] = [];

  for (const key of keys) {
    const v = ev[key];
    const pct = Math.round(v.confidence * 100);
    const label = AI_UTAMA_LABELS[key];
    if (v.direction === "up") {
      upTotal += pct;
      upParts.push(`${label} ${pct}%`);
    } else if (v.direction === "down") {
      downTotal += pct;
      downParts.push(`${label} ${pct}%`);
    }
  }

  const total = upTotal + downTotal;
  const command: RawCommand = upTotal === downTotal ? "HOLD" : upTotal > downTotal ? "BUY" : "SHORT";
  const confidence = total > 0 ? Math.max(upTotal, downTotal) / total : 0;

  const reasons = [
    `Naik: ${upParts.length ? upParts.join(" + ") : "0%"} = ${upTotal}%`,
    `Turun: ${downParts.length ? downParts.join(" + ") : "0%"} = ${downTotal}%`,
    upTotal === downTotal
      ? "Seri — menunggu konfirmasi berikutnya"
      : `${upTotal > downTotal ? "Naik" : "Turun"} dominan (${Math.max(upTotal, downTotal)}% vs ${Math.min(upTotal, downTotal)}%)`,
  ];

  return { command, confidence, upTotal, downTotal, reasons };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MentorModeWidget() {
  // ── Widget UI ──────────────────────────────────────────────────────────────
  const [isActive, setIsActive]       = useState(false);
  const [mode, setMode]               = useState<SignalMode>("mentor");
  const [sensitivity, setSensitivity] = useState<Sensitivity>("normal");
  const [showHistory, setShowHistory] = useState(false);
  const [showReasons, setShowReasons] = useState(true);
  const [minimized, setMinimized]     = useState(false);

  // ── Trading state ──────────────────────────────────────────────────────────
  const [stableCmd, setStableCmd]         = useState<DisplayCommand>("TUNGGU");
  const [positionState, setPositionState] = useState<PositionState>("NONE");
  const [lastActionableTime, setLastActionableTime] = useState(0);
  const [cooldownLeft, setCooldownLeft]   = useState(0);
  const [history, setHistory]             = useState<HistoryEntry[]>([]);
  const prevCmdRef                        = useRef<DisplayCommand>("TUNGGU");

  // ── Draggable ──────────────────────────────────────────────────────────────
  const [pos, setPos]   = useState({ x: 24, y: 120 });
  const dragging        = useRef(false);
  const dragOffset      = useRef({ x: 0, y: 0 });
  const widgetRef       = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const nx = e.clientX - dragOffset.current.x;
    const ny = e.clientY - dragOffset.current.y;
    const maxX = window.innerWidth  - (widgetRef.current?.offsetWidth  ?? 300);
    const maxY = window.innerHeight - (widgetRef.current?.offsetHeight ?? 200);
    setPos({ x: Math.max(0, Math.min(nx, maxX)), y: Math.max(0, Math.min(ny, maxY)) });
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  // ── Data fetch (every 2s when active) ─────────────────────────────────────
  const { data: signal, isError } = useQuery<MentorSignal>({
    queryKey: ["/api/xauusd/mentor-signal", sensitivity],
    queryFn: async () => {
      const res = await fetch(`/api/xauusd/mentor-signal?sensitivity=${sensitivity}`);
      if (!res.ok) throw new Error("Gagal fetch sinyal mentor");
      return res.json() as Promise<MentorSignal>;
    },
    refetchInterval: isActive ? 2000 : false,
    enabled: isActive,
    staleTime: 1500,
  });

  // ── EA account data (setiap 2s, selalu aktif) ──────────────────────────────
  const { data: eaAccount } = useQuery<EaAccountResponse>({
    queryKey: ["/api/xauusd/ea-account"],
    queryFn: async () => {
      const res = await fetch("/api/xauusd/ea-account");
      if (!res.ok) throw new Error("Gagal fetch EA account");
      return res.json() as Promise<EaAccountResponse>;
    },
    refetchInterval: 2000,
    staleTime: 1800,
  });

  const ea = eaAccount?.connected ? eaAccount.data : null;

  // ── Prediksi UTAMA AI — untuk perbandingan "Vs. AI Utama" ─────────────────
  const { data: mainPredictions } = useQuery<MainPrediction[]>({
    queryKey: ["/api/xauusd/predictions", "main"],
    queryFn: async () => {
      const res = await fetch("/api/xauusd/predictions?type=main&limit=1");
      if (!res.ok) throw new Error("Gagal fetch prediksi utama");
      return res.json() as Promise<MainPrediction[]>;
    },
    refetchInterval: isActive ? 30_000 : false,
    enabled: isActive,
    staleTime: 15_000,
  });

  const ev = mainPredictions?.[0]?.indicatorsAtPrediction?.ensembleVotes;
  const mainTimeframe = mainPredictions?.[0]?.timeframe ?? null;

  // ── AI Utama — vote akumulasi persen dari 4 agen ensemble ──────────────────
  const aiUtama = computeAiUtamaVote(ev);
  const activeCommand: RawCommand = mode === "ai_utama" ? aiUtama.command : (signal?.command ?? "HOLD");
  const activeConfidence = mode === "ai_utama" ? aiUtama.confidence : (signal?.confidence ?? 0);
  const activeReasons = mode === "ai_utama" ? aiUtama.reasons : (signal?.reasons ?? []);
  const activeReady = mode === "ai_utama" ? !!ev : !!signal;
  const activePrice = mode === "ai_utama" ? (mainPredictions?.[0]?.indicatorsAtPrediction?.price as number | undefined) ?? null : (signal?.price ?? null);

  // ── Cooldown dinamis berdasarkan sensitivity ───────────────────────────────
  const COOLDOWN_MS = COOLDOWN_BY_SENSITIVITY[sensitivity];

  // ── Cooldown ticker ────────────────────────────────────────────────────────
  // Only counts down from lastActionableTime; goes to 0 and stays there.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastActionableTime));
      setCooldownLeft(remaining);
    }, 250);
    return () => clearInterval(id);
  }, [isActive, lastActionableTime, COOLDOWN_MS]);

  // ── Command resolution — runs on new signal OR position change ────────────
  useEffect(() => {
    if (!isActive || !activeReady) return;

    const candidate = resolveDisplay(activeCommand, positionState);
    if (candidate === prevCmdRef.current) return; // nothing to do

    // TUNGGU is never actionable — allow immediately, no cooldown restart
    if (candidate === "TUNGGU") {
      prevCmdRef.current = "TUNGGU";
      setStableCmd("TUNGGU");
      return;
    }

    // Actionable command — respect cooldown
    const onCooldown = Date.now() - lastActionableTime < COOLDOWN_MS;
    if (onCooldown) return; // blocked; keep showing current stableCmd

    prevCmdRef.current = candidate;
    setStableCmd(candidate);
    setLastActionableTime(Date.now());
  }, [activeCommand, activeReady, positionState, isActive, lastActionableTime]);

  // ── Reset when deactivated or mode switched ────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      setStableCmd("TUNGGU");
      setPositionState("NONE");
      setLastActionableTime(0);
      setCooldownLeft(0);
      prevCmdRef.current = "TUNGGU";
    }
  }, [isActive]);

  useEffect(() => {
    setStableCmd("TUNGGU");
    setLastActionableTime(0);
    setCooldownLeft(0);
    prevCmdRef.current = "TUNGGU";
  }, [mode]);

  // ── Confirm action (immediate — not blocked by cooldown) ───────────────────
  function handleConfirmAction() {
    const cmd = stableCmd;
    // Add to history before changing state
    if (activePrice != null) {
      const entry: HistoryEntry = {
        command: cmd,
        price: activePrice,
        time: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      };
      setHistory(prev => [entry, ...prev].slice(0, 10));
    }
    // Update position — stableCmd will recalculate via effect immediately to TUNGGU
    if (cmd === "BUKA BUY")    setPositionState("BUY");
    else if (cmd === "BUKA SHORT") setPositionState("SHORT");
    else if (cmd === "CLOSE BUY" || cmd === "CLOSE SHORT") setPositionState("NONE");
  }

  // ── Derived display ────────────────────────────────────────────────────────
  const style        = commandStyle(stableCmd);
  const cooldownPct  = Math.round((cooldownLeft / COOLDOWN_MS) * 100);
  const ageMs        = signal?.indicatorsAgeMs ?? signal?.snapshotAgeMs ?? null;
  const isLive       = signal?.dataSource === "live";
  const snapshotOld  = (ageMs ?? 0) > 10 * 60 * 1000;

  const fmtCurrency = (n: number, cur = "USD") =>
    `${n >= 0 ? "+" : ""}${n.toFixed(2)} ${cur}`;

  return (
    <div
      ref={widgetRef}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999, width: 300, userSelect: "none" }}
      className="rounded-2xl border border-border/60 bg-zinc-900/95 backdrop-blur-md shadow-2xl shadow-black/60 overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 border-b border-border/40 cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4 text-zinc-500 shrink-0" />
        <GraduationCap className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">
          {mode === "ai_utama" ? "AI Utama" : "Mentor Mode"}
        </span>
        {isActive && mode === "mentor" && signal && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${
            isLive
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-500 border-amber-500/30"
          }`}>
            {isLive ? "● LIVE" : "● SNAP"}
          </span>
        )}

        {isActive && mainTimeframe && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-zinc-800 text-zinc-400 border-zinc-700">
            {mainTimeframe}
          </span>
        )}

        <select
          data-nodrag
          value={mode === "ai_utama" ? "ai_utama" : sensitivity}
          onChange={e => {
            const v = e.target.value;
            if (v === "ai_utama") {
              setMode("ai_utama");
            } else {
              setMode("mentor");
              setSensitivity(v as Sensitivity);
            }
          }}
          className={`text-[10px] border rounded-md px-1.5 py-0.5 cursor-pointer focus:outline-none ${
            mode === "ai_utama"
              ? "bg-blue-950/60 border-blue-500/50 text-blue-300 font-bold"
              : sensitivity === "super_aggressive"
              ? "bg-red-950/60 border-red-500/50 text-red-300 font-bold"
              : "bg-zinc-800 border-zinc-700 text-zinc-300"
          }`}
        >
          <option value="ai_utama">🤖 AI Utama</option>
          <option value="super_aggressive">⚡ Super Agresif</option>
          <option value="aggressive">Agresif</option>
          <option value="normal">Normal</option>
          <option value="conservative">Konservatif</option>
        </select>

        <button
          data-nodrag
          onClick={() => setMinimized(v => !v)}
          className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded"
        >
          {minimized ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        <button
          data-nodrag
          onClick={() => setIsActive(v => !v)}
          className={`p-1 rounded-lg transition-colors ${
            isActive
              ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
              : "bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          {isActive ? <Power className="w-3.5 h-3.5" /> : <PowerOff className="w-3.5 h-3.5" />}
        </button>
      </div>

      {!minimized && (
        <div className="p-3 space-y-3">
          {mode === "ai_utama" && (
            <p className="text-[9px] text-zinc-500 leading-relaxed -mt-1">
              Sinyal dari total % 4 agen (Teknikal/AI Rule/Macro/Sentimen) — arah dengan jumlah % lebih besar jadi dominan.
            </p>
          )}

          {/* ── Super Agresif warning banner ── */}
          {mode === "mentor" && sensitivity === "super_aggressive" && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-red-400 text-xs font-black">⚡ SCALPING MODE</span>
                <span className="text-[9px] bg-red-500/20 text-red-400 px-1 py-0.5 rounded font-bold border border-red-500/30">HIGH RISK</span>
              </div>
              <p className="text-[9px] text-red-300/70 leading-relaxed">
                Threshold 1 indikator · TP/SL super ketat · Cooldown 5 detik. Hanya untuk scalper berpengalaman.
              </p>
            </div>
          )}

          {!isActive ? (
            <div className="text-center py-4">
              <p className="text-xs text-zinc-500">{mode === "ai_utama" ? "AI Utama" : "Mentor Mode"} nonaktif</p>
              <p className="text-[10px] text-zinc-600 mt-1">Tekan tombol power untuk mulai</p>
            </div>
          ) : (
            <>
              {/* ── Command display ── */}
              <div className={`rounded-xl border p-3 ${style.bg} flex items-center gap-3`}>
                <div className={style.text}>{style.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xl font-black tracking-wide ${style.text}`}>{stableCmd}</div>
                  {mode === "mentor" && signal?.price && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      Harga: <span className="text-zinc-300 font-mono">{fmt(signal.price)}</span>
                      {" · "}
                      <span className="text-zinc-500">↑{signal.bullishScore} ↓{signal.bearishScore}</span>
                    </div>
                  )}
                  {mode === "ai_utama" && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      {activePrice != null && (
                        <>Harga: <span className="text-zinc-300 font-mono">{fmt(activePrice)}</span>{" · "}</>
                      )}
                      <span className="text-zinc-500">↑{aiUtama.upTotal}% ↓{aiUtama.downTotal}%</span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-zinc-500">Conf.</div>
                  <div className={`text-sm font-bold ${style.text}`}>
                    {activeReady ? `${Math.round(activeConfidence * 100)}%` : "—"}
                  </div>
                </div>
              </div>

              {/* ── Vs. AI Utama ── */}
              {ev && (
                <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-zinc-400">Vs. AI Utama</span>
                    <span className={`text-[11px] font-black ${
                      ev.finalDirection === "up" ? "text-emerald-400" : "text-red-400"
                    }`}>
                      Final: {ev.finalDirection === "up" ? "NAIK" : "TURUN"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { key: "technical", label: "Teknikal" },
                      { key: "ai", label: "AI Rule" },
                      { key: "macro", label: "Macro" },
                      { key: "sentiment", label: "Sentimen" },
                    ] as const).map(({ key, label }) => {
                      const v = ev[key];
                      const d = v.direction;
                      const color = d === "up" ? "text-emerald-400" : d === "down" ? "text-red-400" : "text-amber-400";
                      return (
                        <div key={key} className="flex items-center justify-between bg-zinc-900/50 rounded-lg px-2 py-1">
                          <span className="text-[10px] text-zinc-500">{label}</span>
                          <span className={`text-[10px] font-bold ${color}`}>
                            {d === "up" ? "↑" : d === "down" ? "↓" : "↔"} {(v.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Cooldown — HANYA tampil saat benar-benar aktif ── */}
              {cooldownLeft > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                    <span>Cooldown sinyal berikutnya</span>
                    <span>{(cooldownLeft / 1000).toFixed(1)}s</span>
                  </div>
                  <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500/60 rounded-full"
                      style={{ width: `${cooldownPct}%`, transition: "width 0.25s linear" }}
                    />
                  </div>
                </div>
              )}

              {/* ── TP / SL ── */}
              {mode === "mentor" && signal && signal.command !== "HOLD" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-zinc-800/60 rounded-lg p-2 text-center">
                    <div className="text-[10px] text-zinc-500 mb-0.5">TP Minimal</div>
                    <div className="text-xs font-bold text-emerald-400 font-mono">{fmt(signal.minTP)}</div>
                    {signal.minTPDistance && (
                      <div className="text-[9px] text-zinc-600">+{fmt(signal.minTPDistance)}</div>
                    )}
                  </div>
                  <div className="bg-zinc-800/60 rounded-lg p-2 text-center">
                    <div className="text-[10px] text-zinc-500 mb-0.5">SL Minimal</div>
                    <div className="text-xs font-bold text-red-400 font-mono">{fmt(signal.minSL)}</div>
                  </div>
                </div>
              )}

              {/* ── Posisi aktif ── */}
              <div className="flex items-center gap-2">
                <div className={`flex-1 text-[10px] rounded-lg px-2 py-1.5 border text-center font-semibold ${
                  positionState === "BUY"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : positionState === "SHORT"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-zinc-800/60 border-zinc-700/40 text-zinc-500"
                }`}>
                  Posisi: {positionState}
                </div>

                {isActionable(stableCmd) && (
                  <button
                    data-nodrag
                    onClick={handleConfirmAction}
                    className={`text-[10px] px-2 py-1.5 rounded-lg font-semibold transition-colors border ${
                      stableCmd.startsWith("CLOSE")
                        ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border-amber-500/30"
                        : "bg-zinc-700 text-zinc-200 hover:bg-zinc-600 border-zinc-600"
                    }`}
                  >
                    Konfirmasi
                  </button>
                )}
              </div>

              {/* ── Alasan sinyal ── */}
              {activeReasons.length > 0 && (
                <div>
                  <button
                    data-nodrag
                    onClick={() => setShowReasons(v => !v)}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 mb-1 w-full"
                  >
                    <AlertCircle className="w-3 h-3" />
                    Alasan ({activeReasons.length})
                    {showReasons
                      ? <ChevronUp className="w-3 h-3 ml-auto" />
                      : <ChevronDown className="w-3 h-3 ml-auto" />}
                  </button>
                  {showReasons && (
                    <ul className="space-y-1">
                      {activeReasons.slice(0, 5).map((r, i) => (
                        <li key={i} className="text-[10px] text-zinc-400 flex items-start gap-1.5">
                          <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* ── Peringatan data lama ── */}
              {mode === "mentor" && snapshotOld && (
                <div className="text-[10px] text-amber-500/80 bg-amber-500/10 rounded-lg px-2 py-1.5 border border-amber-500/20">
                  ⚠ Snapshot &gt;10 mnt — menunggu siklus berikutnya
                </div>
              )}

              {mode === "mentor" && isError && (
                <div className="text-[10px] text-red-400 bg-red-500/10 rounded-lg px-2 py-1.5 border border-red-500/20">
                  Gagal ambil sinyal — periksa koneksi server
                </div>
              )}

              {mode === "ai_utama" && !ev && (
                <div className="text-[10px] text-amber-500/80 bg-amber-500/10 rounded-lg px-2 py-1.5 border border-amber-500/20">
                  Menunggu prediksi AI Utama pertama dari siklus belajar...
                </div>
              )}

              {/* ── MT5 Account Panel ── */}
              <div className="border-t border-border/30 pt-2">
                {ea ? (
                  <div className="space-y-1.5">
                    {/* Header status */}
                    <div className="flex items-center gap-1.5 text-[9px] text-emerald-400 font-semibold">
                      <Wifi className="w-3 h-3" />
                      MT5 Terhubung · {ea.accountName} #{ea.accountNumber}
                    </div>

                    {/* Balance & Equity */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="bg-zinc-800/50 rounded-lg px-2 py-1.5">
                        <div className="text-[9px] text-zinc-500 mb-0.5">Balance</div>
                        <div className="text-[11px] font-bold text-zinc-200 font-mono">
                          {ea.balance.toFixed(2)} <span className="text-[9px] text-zinc-500">{ea.currency}</span>
                        </div>
                      </div>
                      <div className="bg-zinc-800/50 rounded-lg px-2 py-1.5">
                        <div className="text-[9px] text-zinc-500 mb-0.5">Equity</div>
                        <div className="text-[11px] font-bold text-zinc-200 font-mono">
                          {ea.equity.toFixed(2)} <span className="text-[9px] text-zinc-500">{ea.currency}</span>
                        </div>
                      </div>
                    </div>

                    {/* PnL floating */}
                    <div className={`rounded-lg px-2 py-1.5 border flex items-center gap-2 ${
                      ea.pnl >= 0
                        ? "bg-emerald-500/8 border-emerald-500/20"
                        : "bg-red-500/8 border-red-500/20"
                    }`}>
                      <DollarSign className={`w-3 h-3 shrink-0 ${ea.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`} />
                      <div className="flex-1">
                        <div className="text-[9px] text-zinc-500">Floating PnL</div>
                        <div className={`text-[11px] font-bold font-mono ${ea.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {fmtCurrency(ea.pnl, ea.currency)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-zinc-500">Posisi</div>
                        <div className="text-[11px] font-bold text-zinc-300">{ea.positions.length} terbuka</div>
                      </div>
                    </div>

                    {/* Open positions detail */}
                    {ea.positions.length > 0 && (
                      <div className="space-y-1">
                        {ea.positions.slice(0, 3).map((p) => (
                          <div key={p.ticket} className={`rounded-md px-2 py-1 flex items-center gap-2 text-[9px] border ${
                            p.type === "BUY"
                              ? "bg-emerald-500/5 border-emerald-500/15"
                              : "bg-red-500/5 border-red-500/15"
                          }`}>
                            <span className={`font-bold shrink-0 ${p.type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                              {p.type}
                            </span>
                            <span className="text-zinc-400 flex-1 font-mono">{p.volume} lot @ {p.openPrice.toFixed(2)}</span>
                            <span className={`font-mono font-bold ${p.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.pnl >= 0 ? "+" : ""}{p.pnl.toFixed(2)}
                            </span>
                          </div>
                        ))}
                        {ea.positions.length > 3 && (
                          <div className="text-[9px] text-zinc-600 text-center">
                            +{ea.positions.length - 3} posisi lainnya
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[9px] text-zinc-600">
                    <WifiOff className="w-3 h-3" />
                    MT5 belum terhubung — pasang EA di MetaTrader
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Riwayat ── */}
          {history.length > 0 && (
            <div>
              <button
                data-nodrag
                onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 w-full"
              >
                <History className="w-3 h-3" />
                Riwayat ({history.length})
                {showHistory
                  ? <ChevronUp className="w-3 h-3 ml-auto" />
                  : <ChevronDown className="w-3 h-3 ml-auto" />}
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1 max-h-36 overflow-y-auto pr-0.5">
                  {history.map((h, i) => {
                    const hs = commandStyle(h.command);
                    return (
                      <div key={i} className={`rounded-lg px-2 py-1.5 border ${hs.bg} flex items-center gap-2`}>
                        <span className={`text-[10px] font-bold ${hs.text} w-24 shrink-0`}>{h.command}</span>
                        <span className="text-[10px] text-zinc-500 font-mono flex-1">{h.price.toFixed(2)}</span>
                        <span className="text-[9px] text-zinc-600">{h.time}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
