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
  AlertCircle, X, GripVertical,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Sensitivity = "aggressive" | "normal" | "conservative";
type RawCommand = "BUY" | "SHORT" | "HOLD";
type PositionState = "NONE" | "BUY" | "SHORT";
type DisplayCommand = "BUKA BUY" | "BUKA SHORT" | "CLOSE BUY" | "CLOSE SHORT" | "TUNGGU";

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
  snapshotAgeMs: number | null;
}

interface HistoryEntry {
  command: DisplayCommand;
  price: number;
  time: string;
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

const COOLDOWN_MS = 15_000;

// ─── Component ────────────────────────────────────────────────────────────────

export function MentorModeWidget() {
  // ── Widget UI ──────────────────────────────────────────────────────────────
  const [isActive, setIsActive]       = useState(false);
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

  // ── Cooldown ticker ────────────────────────────────────────────────────────
  // Only counts down from lastActionableTime; goes to 0 and stays there.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => {
      const remaining = Math.max(0, COOLDOWN_MS - (Date.now() - lastActionableTime));
      setCooldownLeft(remaining);
    }, 250);
    return () => clearInterval(id);
  }, [isActive, lastActionableTime]);

  // ── Command resolution — runs on new signal OR position change ────────────
  useEffect(() => {
    if (!isActive || !signal) return;

    const candidate = resolveDisplay(signal.command, positionState);
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
  }, [signal, positionState, isActive, lastActionableTime]);

  // ── Reset when deactivated ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive) {
      setStableCmd("TUNGGU");
      setPositionState("NONE");
      setLastActionableTime(0);
      setCooldownLeft(0);
      prevCmdRef.current = "TUNGGU";
    }
  }, [isActive]);

  // ── Confirm action (immediate — not blocked by cooldown) ───────────────────
  function handleConfirmAction() {
    const cmd = stableCmd;
    // Add to history before changing state
    if (signal?.price) {
      const entry: HistoryEntry = {
        command: cmd,
        price: signal.price,
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
  const style       = commandStyle(stableCmd);
  const cooldownPct = Math.round((cooldownLeft / COOLDOWN_MS) * 100);
  const snapshotOld = (signal?.snapshotAgeMs ?? 0) > 10 * 60 * 1000;

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
        <span className="text-xs font-semibold text-foreground flex-1">Mentor Mode</span>

        <select
          data-nodrag
          value={sensitivity}
          onChange={e => setSensitivity(e.target.value as Sensitivity)}
          className="text-[10px] bg-zinc-800 border border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-300 cursor-pointer focus:outline-none"
        >
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
          {!isActive ? (
            <div className="text-center py-4">
              <p className="text-xs text-zinc-500">Mentor Mode nonaktif</p>
              <p className="text-[10px] text-zinc-600 mt-1">Tekan tombol power untuk mulai</p>
            </div>
          ) : (
            <>
              {/* ── Command display ── */}
              <div className={`rounded-xl border p-3 ${style.bg} flex items-center gap-3`}>
                <div className={style.text}>{style.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xl font-black tracking-wide ${style.text}`}>{stableCmd}</div>
                  {signal?.price && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">
                      Harga: <span className="text-zinc-300 font-mono">{fmt(signal.price)}</span>
                      {" · "}
                      <span className="text-zinc-500">↑{signal.bullishScore} ↓{signal.bearishScore}</span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-zinc-500">Conf.</div>
                  <div className={`text-sm font-bold ${style.text}`}>
                    {signal ? `${Math.round(signal.confidence * 100)}%` : "—"}
                  </div>
                </div>
              </div>

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
              {signal && signal.command !== "HOLD" && (
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
              {signal && signal.reasons.length > 0 && (
                <div>
                  <button
                    data-nodrag
                    onClick={() => setShowReasons(v => !v)}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 mb-1 w-full"
                  >
                    <AlertCircle className="w-3 h-3" />
                    Alasan ({signal.reasons.length})
                    {showReasons
                      ? <ChevronUp className="w-3 h-3 ml-auto" />
                      : <ChevronDown className="w-3 h-3 ml-auto" />}
                  </button>
                  {showReasons && (
                    <ul className="space-y-1">
                      {signal.reasons.slice(0, 5).map((r, i) => (
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
              {snapshotOld && (
                <div className="text-[10px] text-amber-500/80 bg-amber-500/10 rounded-lg px-2 py-1.5 border border-amber-500/20">
                  ⚠ Snapshot &gt;10 mnt — menunggu siklus berikutnya
                </div>
              )}

              {isError && (
                <div className="text-[10px] text-red-400 bg-red-500/10 rounded-lg px-2 py-1.5 border border-red-500/20">
                  Gagal ambil sinyal — periksa koneksi server
                </div>
              )}
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
