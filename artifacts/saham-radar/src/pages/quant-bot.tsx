/**
 * Quant Bot — Halaman trading otomatis
 * 3 otak independen: Technical | Fundamental | Macro
 * v2: +history prediksi, +akurasi chart, +BTC simetris, +filter dewan,
 *     +countdown refresh, +salin sinyal, +notif perubahan sinyal, +weight adjuster
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Minus, Brain, Zap, Activity,
  RefreshCw, ChevronRight, Target, DollarSign, Shield,
  Newspaper, BarChart2, LineChart, Globe, BookOpen,
  CheckCircle2, XCircle, Clock, Loader2, Settings,
  AlertTriangle, Eye, ChevronDown, ChevronUp, Bot,
  Layers, Lock, Unlock, ArrowUpRight, ArrowDownRight,
  Copy, Check, SlidersHorizontal, Timer, Filter, TrendingUp as TrendUp,
  KeyRound, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartTooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface BrainSignal {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string[];
  insights: number;
}
interface QuantStatus {
  isActive: boolean;
  lastUpdateAt: string | null;
  cycleCount: number;
  technical: (BrainSignal & { keySetup: string }) | null;
  fundamental: (BrainSignal & { fundamentalBias: string; keyDriver: string }) | null;
  macro: (BrainSignal & { macroRegime: string; geopoliticalRisk: string; fedBias: string; psychologyNarrative: string }) | null;
  ensemble: {
    signal: "BUY" | "SELL" | "HOLD";
    direction: "up" | "down" | "neutral";
    confidence: number;
    votes: { technical: string; fundamental: string; macro: string };
    weights: { technical: number; fundamental: number; macro: number };
    consensus: "strong" | "moderate" | "weak" | "split";
  } | null;
  prediction: {
    entryPrice: number; tp1: number; tp2: number; sl: number;
    lotSize: number; riskAmount: number; riskReward: number;
  } | null;
  psychology: {
    score: number; label: string; narrative: string;
    keyEmotions: string[]; crowdBehavior: string;
    institutionalBias: string; tradingImplication: string;
  } | null;
  news: Array<{ headline: string; sentiment: string; impactLevel: string; aiAnalysis: string; publishedAt: string | null }>;
  capital: { accountBalance: number; riskPercent: number; leverage: number };
}

interface LiveTicker {
  price: number | null; bid: number | null; ask: number | null;
  change: number | null; changePct: number | null; timestamp: number | null;
  stale: boolean; error: string | null; source: string;
}
interface LivePrices { xauusd: LiveTicker; btcusd: LiveTicker; updatedAt: string }

interface BrainPrediction {
  id: number; brainType: "technical" | "fundamental" | "macro"; symbol: string;
  predictedAt: string; direction: "up" | "down"; signal: "BUY" | "SELL";
  confidence: number; entryPrice: number; tp: number; sl: number; pips: number;
  reasoning: string | null; isVerified: boolean; isCorrect: boolean | null;
  actualPrice: number | null; verifiedAt: string | null;
}
interface BrainPredictionStats { total: number; correct: number; wrong: number; open: number }
interface BrainPredictionsResponse {
  technical: { latest: BrainPrediction | null; stats: BrainPredictionStats };
  fundamental: { latest: BrainPrediction | null; stats: BrainPredictionStats };
  macro: { latest: BrainPrediction | null; stats: BrainPredictionStats };
}

interface BtcQuantStatus {
  isActive: boolean; lastUpdateAt: string | null; cycleCount: number;
  technical: (BrainSignal & { keySetup: string }) | null;
  fundamental: (BrainSignal & { fundamentalBias: string; keyDriver: string; halvingPhase: string; fearGreedScore: number | null }) | null;
  macro: (BrainSignal & { macroRegime: string; correlationBias: string; psychologyNarrative: string }) | null;
  ensemble: {
    signal: "BUY" | "SELL" | "HOLD"; direction: "up" | "down" | "neutral";
    confidence: number; votes: { technical: string; fundamental: string; macro: string };
    weights: { technical: number; fundamental: number; macro: number };
    consensus: "strong" | "moderate" | "weak" | "split";
  } | null;
  prediction: {
    entryPrice: number; tp: number; sl: number; tpDistance: number;
    slDistance: number; riskReward: number; constraintApplied: boolean;
  } | null;
  context: {
    fearGreedIndex: number | null; fundingRate: number | null;
    halvingPhase: string | null; session: string;
  };
}

interface BtcBrainPrediction {
  id: number; brainType: "technical" | "fundamental" | "macro";
  predictedAt: string; direction: "up" | "down"; signal: "BUY" | "SELL";
  confidence: number; entryPrice: number; tp: number; sl: number;
  fixedDistance: number; reasoning: string | null; isVerified: boolean; isCorrect: boolean | null;
}

interface BtcBrainStats {
  scalping_constraint: { max_tp_sl_usd: number; fixed_brain_distance_usd: number };
  technical: { cycles: number; lastSignal: string | null; insights: { count: number; avgConfidence: number } };
  fundamental: { cycles: number; lastSignal: string | null; halvingPhase: string | null; fearGreedScore: number | null; insights: { count: number; avgConfidence: number } };
  macro: { cycles: number; lastSignal: string | null; macroRegime: string | null; insights: { count: number; avgConfidence: number } };
  accuracy: Array<{ brain_type: string; verified: string; correct: string }>;
}

interface CouncilMember { name: string; role: string; vote: "BUY" | "SELL" | "HOLD"; confidence: number; opinion: string }
interface CouncilDebate {
  debatedAt: string; cycleNumber: number; price: number | null;
  members: CouncilMember[];
  buyVotes: number; sellVotes: number; holdVotes: number;
  leaderName: string; leaderTitle: string;
  leaderDecision: "BUY" | "SELL" | "HOLD"; leaderConfidence: number; leaderReasoning: string;
}
interface CouncilResponse { current: CouncilDebate | null; history: unknown[] }

// ─── API helpers ───────────────────────────────────────────────────────────────
const API = "/api/quant";
const BTC_API = "/api/btcusd/quant";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "API error");
  return data.data;
}

async function btcApiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BTC_API}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Sanitasi nilai extraInfo — buang pesan error internal yang bocor ke UI */
function sanitizeVal(val: string | null | undefined, maxLen = 25): string {
  if (!val) return "—";
  if (val.startsWith("[") || val.toLowerCase().includes("api key") || val.toLowerCase().includes("error")) return "—";
  return val.length > maxLen ? val.substring(0, maxLen) + "…" : val;
}

/** Deteksi apakah API key belum diset dari status brain */
function detectApiKeyMissing(status: QuantStatus | BtcQuantStatus | undefined): boolean {
  if (!status) return false;
  const f = (status as QuantStatus).fundamental;
  if (!f) return false;
  const bias = (f as { fundamentalBias?: string }).fundamentalBias ?? "";
  return bias.startsWith("[") || bias.toLowerCase().includes("api key");
}

const signalColor = (s: string) =>
  s === "BUY" ? "text-emerald-400" : s === "SELL" ? "text-red-400" : "text-yellow-400";
const signalBg = (s: string) =>
  s === "BUY" ? "bg-emerald-500/10 border-emerald-500/30" : s === "SELL" ? "bg-red-500/10 border-red-500/30" : "bg-yellow-500/10 border-yellow-500/30";
const signalBadge = (s: string) =>
  s === "BUY" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" :
  s === "SELL" ? "bg-red-500/20 text-red-400 border-red-500/40" :
  "bg-yellow-500/20 text-yellow-400 border-yellow-500/40";
const consensusBadge = (c: string) =>
  c === "strong" ? "bg-emerald-500/20 text-emerald-300" :
  c === "moderate" ? "bg-blue-500/20 text-blue-300" :
  c === "split" ? "bg-orange-500/20 text-orange-300" :
  "bg-zinc-500/20 text-zinc-400";
const psychColor = (score: number) =>
  score > 0.5 ? "text-orange-400" : score > 0.2 ? "text-yellow-400" :
  score > -0.2 ? "text-zinc-300" : score > -0.5 ? "text-blue-400" : "text-blue-600";
const psychBg = (score: number) =>
  score > 0.5 ? "from-orange-500/20 to-red-500/10" : score > 0.2 ? "from-yellow-500/20 to-orange-500/10" :
  score > -0.2 ? "from-zinc-700/30 to-zinc-800/20" : score > -0.5 ? "from-blue-500/20 to-indigo-500/10" :
  "from-blue-700/30 to-purple-500/10";
const sentimentEmoji = (s: string) =>
  s === "very_bullish" ? "🚀" : s === "bullish" ? "📈" : s === "bearish" ? "📉" : s === "very_bearish" ? "🩸" : "➡️";

// ─── ConfBar ───────────────────────────────────────────────────────────────────
function ConfBar({ value, signal }: { value: number; signal: string }) {
  const pct = Math.round(value * 100);
  const col = signal === "BUY" ? "bg-emerald-500" : signal === "SELL" ? "bg-red-500" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-white/5 rounded-full h-1.5 overflow-hidden">
        <div className={`${col} h-full rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-zinc-400 tabular-nums w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── #4 Countdown Refresh ──────────────────────────────────────────────────────
function RefreshCountdown({ intervalMs, lastUpdate }: { intervalMs: number; lastUpdate: number | null }) {
  const [remaining, setRemaining] = useState<number>(intervalMs / 1000);

  useEffect(() => {
    if (!lastUpdate) return;
    const tick = () => {
      const elapsed = (Date.now() - lastUpdate) / 1000;
      const rem = Math.max(0, Math.round(intervalMs / 1000 - elapsed));
      setRemaining(rem);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastUpdate, intervalMs]);

  return (
    <div className="flex items-center gap-1 text-xs text-zinc-600">
      <Timer className="w-3 h-3" />
      <span>Update {remaining}s</span>
    </div>
  );
}

// ─── #5 API Key Missing Banner ─────────────────────────────────────────────────
function ApiKeyBanner({ asset }: { asset: "xauusd" | "btc" }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
      <KeyRound className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-sm text-amber-300 font-semibold">AI Brain belum aktif — API Key belum dikonfigurasi</p>
        <p className="text-xs text-zinc-400 mt-0.5">
          {asset === "xauusd" ? "XAUUSD" : "BTC"} Brain Engine memerlukan DeepSeek atau OpenAI API key untuk mulai belajar dan menghasilkan prediksi.
        </p>
      </div>
      <Link href="/admin/settings">
        <Button size="sm" variant="outline" className="h-7 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0">
          Set API Key →
        </Button>
      </Link>
    </div>
  );
}

// ─── #10 Copy Button ───────────────────────────────────────────────────────────
function CopyBtn({ text, label = "" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} title="Salin sinyal" className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {label && <span>{copied ? "Tersalin!" : label}</span>}
    </button>
  );
}

// ─── LiveTickerPill ────────────────────────────────────────────────────────────
function LiveTickerPill({ label, ticker }: { label: string; ticker?: LiveTicker }) {
  const up = (ticker?.change ?? 0) >= 0;
  return (
    <div className="flex flex-col items-end leading-tight">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${ticker && !ticker.stale ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
        <span className="text-[10px] text-zinc-500 font-medium">{label}</span>
        <span className="text-sm font-bold text-white tabular-nums">
          {ticker?.price != null ? ticker.price.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
        </span>
      </div>
      {ticker?.changePct != null && (
        <span className={`text-[10px] font-medium ${up ? "text-emerald-400" : "text-red-400"}`}>
          {up ? "▲" : "▼"} {Math.abs(ticker.changePct).toFixed(2)}%
        </span>
      )}
    </div>
  );
}

// ─── BrainPredictionBox (+#10 copy) ──────────────────────────────────────────
function BrainPredictionBox({ prediction, stats }: { prediction: BrainPrediction | null; stats?: BrainPredictionStats }) {
  if (!prediction) {
    return (
      <div className="border border-white/10 rounded-lg p-2.5 text-center text-xs text-zinc-600">
        Belum ada prediksi mandiri — menunggu sinyal BUY/SELL
      </div>
    );
  }
  const up = prediction.direction === "up";
  const copyText = `${prediction.signal} ${prediction.symbol ?? "XAUUSD"} | Entry: ${prediction.entryPrice.toFixed(2)} | TP: ${prediction.tp.toFixed(2)} | SL: ${prediction.sl.toFixed(2)} | Pips: ${prediction.pips}`;
  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-white/5">
        <span className="text-[10px] text-zinc-500 font-medium">Prediksi Mandiri</span>
        <div className="flex items-center gap-2">
          {prediction.isVerified ? (
            prediction.isCorrect ? (
              <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">✓ Benar</Badge>
            ) : (
              <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">✗ Salah</Badge>
            )
          ) : (
            <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30">● Open</Badge>
          )}
          <CopyBtn text={copyText} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-0 divide-x divide-white/5 text-center">
        <div className="px-2 py-1.5">
          <div className="text-[10px] text-zinc-500">Entry</div>
          <div className="text-xs font-mono text-white">${prediction.entryPrice.toFixed(2)}</div>
        </div>
        <div className="px-2 py-1.5">
          <div className="text-[10px] text-zinc-500">TP</div>
          <div className="text-xs font-mono text-emerald-400">${prediction.tp.toFixed(2)}</div>
        </div>
        <div className="px-2 py-1.5">
          <div className="text-[10px] text-zinc-500">SL</div>
          <div className="text-xs font-mono text-red-400">${prediction.sl.toFixed(2)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5 py-1 border-t border-white/5 text-[10px] text-zinc-500">
        <span>{up ? "▲ BUY" : "▼ SELL"} · {prediction.pips} pips</span>
        {stats && (
          <span>
            <span className="text-emerald-400">{stats.correct}✓</span>
            {" / "}
            <span className="text-red-400">{stats.wrong}✗</span>
            {" / "}
            <span className="text-blue-400">{stats.open} open</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── BrainCard (+#1 sanitize extraInfo) ───────────────────────────────────────
function BrainCard({
  type, icon: Icon, title, subtitle, signal, confidence, reasoning, extraInfo, insights, loading, prediction, predictionStats,
}: {
  type: "technical" | "fundamental" | "macro";
  icon: React.ElementType; title: string; subtitle: string;
  signal: string; confidence: number; reasoning: string[];
  extraInfo: { label: string; value: string }[];
  insights: number; loading?: boolean;
  prediction?: BrainPrediction | null; predictionStats?: BrainPredictionStats;
}) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = type === "technical" ? "border-blue-500/20" : type === "fundamental" ? "border-violet-500/20" : "border-amber-500/20";
  const accentColor = type === "technical" ? "text-blue-400" : type === "fundamental" ? "text-violet-400" : "text-amber-400";
  const iconBg = type === "technical" ? "bg-blue-500/10" : type === "fundamental" ? "bg-violet-500/10" : "bg-amber-500/10";

  // #1 Sanitasi nilai extraInfo sebelum render
  const cleanExtraInfo = extraInfo.map(info => ({ label: info.label, value: sanitizeVal(info.value) }));

  return (
    <Card className={`border ${borderColor} bg-zinc-900/60 backdrop-blur`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`${iconBg} p-2 rounded-lg`}>
              <Icon className={`w-4 h-4 ${accentColor}`} />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-white">{title}</CardTitle>
              <p className="text-xs text-zinc-500">{subtitle}</p>
            </div>
          </div>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          ) : (
            <Badge className={`text-xs font-bold px-2.5 py-0.5 border ${signalBadge(signal)}`}>{signal}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ConfBar value={confidence} signal={signal} />
        <BrainPredictionBox prediction={prediction ?? null} stats={predictionStats} />
        <div className="flex flex-wrap gap-1.5">
          {cleanExtraInfo.map((info) => (
            <span key={info.label} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-zinc-400">
              <span className="text-zinc-500">{info.label}:</span> <span className="text-zinc-300">{info.value}</span>
            </span>
          ))}
          <span className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-zinc-400">
            <span className="text-zinc-500">Insights:</span> <span className={accentColor}>{insights}</span>
          </span>
        </div>
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <Brain className="w-3 h-3" />
            Reasoning
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1.5">
              {reasoning.slice(0, 4).map((r, i) => (
                <li key={i} className="flex gap-2 text-xs text-zinc-400 leading-relaxed">
                  <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-zinc-600" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── #9 Ensemble Panel + weight adjuster + #10 copy ───────────────────────────
function EnsemblePanel({ ensemble }: { ensemble: NonNullable<QuantStatus["ensemble"]> }) {
  const { toast } = useToast();
  const adminToken = getAdminToken();
  const [showWeights, setShowWeights] = useState(false);
  const [wTech, setWTech] = useState(Math.round(ensemble.weights.technical * 100));
  const [wFund, setWFund] = useState(Math.round(ensemble.weights.fundamental * 100));
  const [wMacro, setWMacro] = useState(Math.round(ensemble.weights.macro * 100));
  const [saving, setSaving] = useState(false);

  const total = wTech + wFund + wMacro;
  const techN = wTech / total; const fundN = wFund / total; const macroN = wMacro / total;

  async function saveWeights() {
    setSaving(true);
    try {
      const res = await fetch("/api/quant/weights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ technical: techN, fundamental: fundN, macro: macroN }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast({ title: "Bobot disimpan", description: `Tech ${Math.round(techN*100)}% · Fund ${Math.round(fundN*100)}% · Macro ${Math.round(macroN*100)}%` });
    } catch (e) {
      toast({ title: "Gagal simpan", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const displaySignal = ensemble.signal;
  const displayConf   = ensemble.confidence;

  const brains = [
    { key: "technical", label: "Technical", weight: techN, vote: ensemble.votes.technical, icon: BarChart2, color: "blue" as const },
    { key: "fundamental", label: "Fundamental", weight: fundN, vote: ensemble.votes.fundamental, icon: LineChart, color: "violet" as const },
    { key: "macro", label: "Macro", weight: macroN, vote: ensemble.votes.macro, icon: Globe, color: "amber" as const },
  ];

  const copyText = `Ensemble ${displaySignal} | Confidence: ${Math.round(displayConf * 100)}% | ${ensemble.consensus} consensus\nTechnical: ${ensemble.votes.technical} | Fundamental: ${ensemble.votes.fundamental} | Macro: ${ensemble.votes.macro}`;

  return (
    <Card className="border border-white/10 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Ensemble Vote</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`text-xs ${consensusBadge(ensemble.consensus)}`}>{ensemble.consensus} consensus</Badge>
            <Badge className={`text-sm font-bold px-3 py-1 border ${signalBadge(displaySignal)}`}>
              {displaySignal === "BUY" ? "▲ " : displaySignal === "SELL" ? "▼ " : "— "}{displaySignal}
            </Badge>
            <CopyBtn text={copyText} />
            <button
              onClick={() => setShowWeights(!showWeights)}
              title="Sesuaikan bobot"
              className={`p-1 rounded transition-colors ${showWeights ? "text-amber-400" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3 mb-4">
          {brains.map((b) => {
            const colMap = { blue: "border-blue-500/30 text-blue-400", violet: "border-violet-500/30 text-violet-400", amber: "border-amber-500/30 text-amber-400" };
            return (
              <div key={b.key} className={`rounded-lg border ${colMap[b.color]} bg-white/5 p-3 text-center`}>
                <b.icon className={`w-4 h-4 mx-auto mb-1 ${colMap[b.color].split(" ")[1]}`} />
                <div className="text-xs text-zinc-500 mb-1">{b.label}</div>
                <div className={`text-sm font-bold ${signalColor(b.vote)}`}>{b.vote}</div>
                <div className="text-xs text-zinc-600 mt-1">weight {Math.round(b.weight * 100)}%</div>
              </div>
            );
          })}
        </div>

        {/* #9 Weight adjuster — real, tersimpan ke backend */}
        {showWeights && (
          <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10 space-y-2">
            <p className="text-xs text-zinc-300 font-semibold flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3" /> Bobot Ensemble
            </p>
            {[
              { label: "Technical", val: wTech, set: setWTech, color: "accent-blue-500" },
              { label: "Fundamental", val: wFund, set: setWFund, color: "accent-violet-500" },
              { label: "Macro", val: wMacro, set: setWMacro, color: "accent-amber-500" },
            ].map(({ label, val, set, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 w-20 shrink-0">{label}</span>
                <input
                  type="range" min={5} max={70} value={val}
                  onChange={e => set(Number(e.target.value))}
                  className={`flex-1 h-1.5 ${color}`}
                />
                <span className="text-xs text-zinc-300 w-8 text-right tabular-nums">{Math.round((val / total) * 100)}%</span>
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={saveWeights} disabled={saving}
                className="h-6 text-[10px] px-3 bg-white/10 hover:bg-white/20 text-white border-none">
                {saving ? "Menyimpan…" : "Simpan Bobot"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-zinc-500">Ensemble Confidence</span>
          <span className={`text-sm font-bold ${signalColor(displaySignal)}`}>{Math.round(displayConf * 100)}%</span>
        </div>
        <div className="bg-white/5 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${displaySignal === "BUY" ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : displaySignal === "SELL" ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-gradient-to-r from-yellow-600 to-yellow-400"}`}
            style={{ width: `${Math.round(displayConf * 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Psychology Panel ──────────────────────────────────────────────────────────
function PsychologyPanel({ psychology, macroNarrative }: {
  psychology: NonNullable<QuantStatus["psychology"]>; macroNarrative?: string;
}) {
  const [showMacro, setShowMacro] = useState(false);
  const scorePct = Math.round(((psychology.score + 1) / 2) * 100);
  return (
    <Card className={`border border-white/10 bg-gradient-to-br ${psychBg(psychology.score)} backdrop-blur`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Psikologi Pasar</CardTitle>
          </div>
          <span className={`text-sm font-bold ${psychColor(psychology.score)}`}>{psychology.label}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Extreme Fear</span><span>Neutral</span><span>Extreme Greed</span>
          </div>
          <div className="relative bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-500 h-2 rounded-full">
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-zinc-800 transition-all duration-700" style={{ left: `calc(${scorePct}% - 6px)` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {psychology.keyEmotions.map((e) => (
            <Badge key={e} variant="outline" className="text-xs border-white/10 text-zinc-300">{e}</Badge>
          ))}
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed border-l-2 border-white/10 pl-3">{psychology.narrative}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-black/20 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Unlock className="w-3 h-3" /> Retail Crowd</div>
            <p className="text-xs text-zinc-300 leading-relaxed">{psychology.crowdBehavior}</p>
          </div>
          <div className="bg-black/20 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Smart Money</div>
            <p className="text-xs text-zinc-300 leading-relaxed">{psychology.institutionalBias}</p>
          </div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <div className="text-xs text-amber-400 font-semibold mb-1">💡 Implikasi Trading</div>
          <p className="text-xs text-zinc-300">{psychology.tradingImplication}</p>
        </div>
        {macroNarrative && (
          <div>
            <button onClick={() => setShowMacro(!showMacro)} className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
              <Globe className="w-3 h-3" /> Narasi Makro
              {showMacro ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showMacro && <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{macroNarrative}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── #2 BTC Psychology Panel ───────────────────────────────────────────────────
function BtcPsychologyPanel({ context, macro }: {
  context: BtcQuantStatus["context"];
  macro: BtcQuantStatus["macro"];
}) {
  const fg = context.fearGreedIndex;
  const fgLabel = fg !== null
    ? fg < 25 ? "Extreme Fear 😱" : fg < 45 ? "Fear 😨" : fg < 55 ? "Neutral 😐" : fg < 75 ? "Greed 😏" : "Extreme Greed 🤑"
    : "—";
  const fgColor = fg !== null
    ? fg < 25 ? "text-blue-400" : fg < 45 ? "text-blue-300" : fg < 55 ? "text-zinc-300" : fg < 75 ? "text-yellow-400" : "text-orange-400"
    : "text-zinc-500";

  const fr = context.fundingRate;
  const frColor = fr !== null ? (fr > 0.05 ? "text-red-400" : fr < -0.02 ? "text-emerald-400" : "text-zinc-300") : "text-zinc-500";
  const frLabel = fr !== null ? (fr > 0.05 ? "Overheated Long 🔥" : fr < -0.02 ? "Short Squeeze Risk 📉" : "Netral") : "—";

  return (
    <Card className="border border-white/10 bg-gradient-to-br from-orange-500/10 to-zinc-900/60 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-orange-400" />
            <CardTitle className="text-sm font-semibold text-white">Sentimen BTC</CardTitle>
          </div>
          <span className={`text-sm font-bold ${fgColor}`}>{fgLabel}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Fear & Greed gauge */}
        {fg !== null && (
          <div>
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Extreme Fear</span><span>Neutral</span><span>Extreme Greed</span>
            </div>
            <div className="relative bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-500 h-2 rounded-full">
              <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-zinc-800 transition-all duration-700" style={{ left: `calc(${fg}% - 6px)` }} />
            </div>
            <div className={`text-right text-xs font-bold mt-1 tabular-nums ${fgColor}`}>{fg}/100</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {/* Funding Rate */}
          <div className="bg-black/20 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Funding Rate</div>
            <div className={`text-sm font-bold tabular-nums ${frColor}`}>
              {fr !== null ? `${(fr * 100).toFixed(4)}%` : "—"}
            </div>
            <div className={`text-[10px] mt-0.5 ${frColor}`}>{frLabel}</div>
          </div>
          {/* Halving Phase */}
          <div className="bg-black/20 rounded-lg p-3">
            <div className="text-xs text-zinc-500 mb-1">Fase Halving</div>
            <div className="text-sm font-bold text-orange-300 capitalize">
              {context.halvingPhase?.replace(/_/g, " ") ?? "—"}
            </div>
            <div className="text-[10px] text-zinc-600 mt-0.5">Siklus 4 tahun BTC</div>
          </div>
        </div>

        {/* Macro narrative */}
        {macro?.psychologyNarrative && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
            <div className="text-xs text-orange-400 font-semibold mb-1">🧠 Narasi Makro BTC</div>
            <p className="text-xs text-zinc-300 leading-relaxed">{macro.psychologyNarrative}</p>
          </div>
        )}

        {/* Sesi */}
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-zinc-500" />
          <span className="text-xs text-zinc-500">Sesi aktif:</span>
          <span className="text-xs text-zinc-300 capitalize font-medium">{context.session?.replace(/_/g, " ") ?? "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── #3 Capital Panel + better HOLD state ─────────────────────────────────────
function CapitalPanel({ capital, prediction }: {
  capital: QuantStatus["capital"]; prediction: QuantStatus["prediction"];
}) {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState(String(capital.accountBalance));
  const [risk, setRisk] = useState(String(capital.riskPercent));
  const [leverage, setLeverage] = useState(String(capital.leverage));
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => apiFetch("/capital", {
      method: "POST",
      body: JSON.stringify({ accountBalance: Number(balance), riskPercent: Number(risk), leverage: Number(leverage) }),
    }),
    onSuccess: () => { toast({ title: "Modal tersimpan ✓" }); setEditing(false); qc.invalidateQueries({ queryKey: ["quant-status"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const riskAmount = (capital.accountBalance * capital.riskPercent) / 100;

  return (
    <Card className="border border-white/10 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Manajemen Modal</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)} className="h-7 px-2 text-xs">
            <Settings className="w-3 h-3 mr-1" /> {editing ? "Tutup" : "Edit"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-zinc-400">Balance Akun (USD)</Label>
              <Input value={balance} onChange={(e) => setBalance(e.target.value)} className="mt-1 h-8 text-sm bg-zinc-800 border-white/10" placeholder="1000" />
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Risk per Trade (%)</Label>
              <Input value={risk} onChange={(e) => setRisk(e.target.value)} className="mt-1 h-8 text-sm bg-zinc-800 border-white/10" placeholder="1.0" />
              <p className="text-xs text-zinc-600 mt-1">0.1% – 10% dari balance</p>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Leverage (1:X)</Label>
              <Input value={leverage} onChange={(e) => setLeverage(e.target.value)} className="mt-1 h-8 text-sm bg-zinc-800 border-white/10" placeholder="100" />
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm" className="w-full h-8 bg-amber-500 hover:bg-amber-600 text-black font-semibold">
              {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan Modal"}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Balance", value: `$${capital.accountBalance.toLocaleString()}` },
              { label: "Risk/Trade", value: `${capital.riskPercent}%` },
              { label: "Leverage", value: `1:${capital.leverage}` },
            ].map((item) => (
              <div key={item.label} className="bg-white/5 rounded-lg p-2.5 text-center">
                <div className="text-xs text-zinc-500">{item.label}</div>
                <div className="text-sm font-bold text-white mt-0.5">{item.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* #3 Position sizing — state HOLD yang jelas */}
        {!editing && (
          prediction ? (
            <div className="border border-white/10 rounded-lg overflow-hidden">
              <div className="bg-white/5 px-3 py-2 text-xs text-zinc-400 font-medium flex items-center justify-between">
                <span>Kalkulasi Posisi (Sinyal Aktif)</span>
                <CopyBtn text={`Entry: $${prediction.entryPrice.toFixed(2)} | TP1: $${prediction.tp1.toFixed(2)} | TP2: $${prediction.tp2.toFixed(2)} | SL: $${prediction.sl.toFixed(2)} | Lot: ${prediction.lotSize} | RR: 1:${prediction.riskReward.toFixed(1)}`} label="Salin" />
              </div>
              <div className="grid grid-cols-2 gap-0 divide-y divide-white/5">
                {[
                  { label: "Entry", value: `$${prediction.entryPrice.toFixed(2)}` },
                  { label: "Lot Size", value: `${prediction.lotSize} lot`, accent: true },
                  { label: "TP1", value: `$${prediction.tp1.toFixed(2)}`, green: true },
                  { label: "Risk (USD)", value: `$${prediction.riskAmount}`, red: true },
                  { label: "TP2", value: `$${prediction.tp2.toFixed(2)}`, green: true },
                  { label: "Risk:Reward", value: `1 : ${prediction.riskReward.toFixed(1)}`, accent: true },
                  { label: "SL", value: `$${prediction.sl.toFixed(2)}`, red: true },
                  { label: "Risk %", value: `${capital.riskPercent}%` },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between px-3 py-1.5">
                    <span className="text-xs text-zinc-500">{row.label}</span>
                    <span className={`text-xs font-mono font-medium ${(row as { green?: boolean }).green ? "text-emerald-400" : (row as { red?: boolean }).red ? "text-red-400" : (row as { accent?: boolean }).accent ? "text-amber-400" : "text-white"}`}>
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="border border-white/5 rounded-lg p-3 text-center">
              <Minus className="w-4 h-4 text-zinc-600 mx-auto mb-1" />
              <p className="text-xs text-zinc-600">Tidak ada posisi aktif</p>
              <p className="text-[10px] text-zinc-700 mt-0.5">Sinyal HOLD — bot menunggu konfirmasi arah</p>
              <p className="text-[10px] text-zinc-700 mt-1">
                Risk per trade: <span className="text-zinc-500">${riskAmount.toFixed(2)}</span>
              </p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

// ─── News Panel ────────────────────────────────────────────────────────────────
function NewsPanel({ news, apiProvider }: { news: QuantStatus["news"]; apiProvider?: string }) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("finnhub");
  const [showSetup, setShowSetup] = useState(false);
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => apiFetch("/news-api-key", { method: "POST", body: JSON.stringify({ apiKey, provider }) }),
    onSuccess: () => { toast({ title: `News API (${provider}) tersimpan ✓` }); setShowSetup(false); qc.invalidateQueries({ queryKey: ["quant-status"] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Card className="border border-white/10 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Live News</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs border-white/10 text-zinc-400">{apiProvider ?? "rss_fallback"}</Badge>
            <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={() => setShowSetup(!showSetup)}>
              <Settings className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showSetup && (
          <div className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-3 space-y-2 mb-3">
            <p className="text-xs text-amber-400 font-semibold">💰 Setup Premium News API</p>
            <p className="text-xs text-zinc-400">Rekomendasi: <strong>Finnhub</strong> (gratis), <strong>Polygon</strong> (cepat)</p>
            <div className="flex gap-2">
              <select value={provider} onChange={(e) => setProvider(e.target.value)} className="text-xs bg-zinc-800 border border-white/10 rounded px-2 py-1 text-white flex-shrink-0">
                <option value="finnhub">Finnhub (Free)</option>
                <option value="polygon">Polygon.io (Premium)</option>
              </select>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key..." className="text-xs h-7 bg-zinc-800 border-white/10" />
              <Button onClick={() => saveMutation.mutate()} disabled={!apiKey || saveMutation.isPending} size="sm" className="h-7 px-3 bg-amber-500 text-black text-xs">
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Simpan"}
              </Button>
            </div>
          </div>
        )}
        {news.length === 0 ? (
          <div className="text-center py-6 text-zinc-600 text-sm">Belum ada berita tersedia</div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {news.map((item, i) => (
              <div key={i} className="border border-white/5 rounded-lg p-2.5 bg-white/3 hover:bg-white/5 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs text-zinc-300 leading-snug font-medium">{item.headline}</p>
                  <span className="text-base shrink-0">{sentimentEmoji(item.sentiment)}</span>
                </div>
                {item.aiAnalysis && <p className="text-xs text-zinc-500 leading-relaxed">{item.aiAnalysis}</p>}
                <div className="flex items-center gap-2 mt-1.5">
                  {item.impactLevel === "high" && <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">HIGH IMPACT</Badge>}
                  <span className="text-[10px] text-zinc-600">
                    {item.publishedAt ? new Date(item.publishedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── BTC Scalping Prediction Panel ────────────────────────────────────────────
function BtcScalpingPanel({ prediction, context, ensemble }: {
  prediction: BtcQuantStatus["prediction"]; context: BtcQuantStatus["context"]; ensemble: BtcQuantStatus["ensemble"] | null;
}) {
  const copyText = prediction && ensemble?.signal !== "HOLD"
    ? `BTC ${ensemble?.signal} | Entry: $${prediction.entryPrice.toLocaleString()} | TP: $${prediction.tp.toLocaleString()} (+$${prediction.tpDistance.toFixed(0)}) | SL: $${prediction.sl.toLocaleString()} (-$${prediction.slDistance.toFixed(0)}) | RR: 1:${prediction.riskReward.toFixed(2)}`
    : "";
  return (
    <Card className="border border-orange-500/20 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-orange-400" />
            <CardTitle className="text-sm font-semibold text-white">Prediksi Scalping</CardTitle>
            <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30">MAX $1.000</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 capitalize">{context.session?.replace("_", " ")}</span>
            {copyText && <CopyBtn text={copyText} />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {prediction && ensemble?.signal !== "HOLD" ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
                <div className="text-[10px] text-zinc-500 mb-0.5">Entry</div>
                <div className="text-sm font-mono font-bold text-white">${prediction.entryPrice.toLocaleString()}</div>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-2.5 border border-emerald-500/20">
                <div className="text-[10px] text-zinc-500 mb-0.5">TP (+${prediction.tpDistance.toFixed(0)})</div>
                <div className="text-sm font-mono font-bold text-emerald-400">${prediction.tp.toLocaleString()}</div>
              </div>
              <div className="bg-red-500/10 rounded-lg p-2.5 border border-red-500/20">
                <div className="text-[10px] text-zinc-500 mb-0.5">SL (-${prediction.slDistance.toFixed(0)})</div>
                <div className="text-sm font-mono font-bold text-red-400">${prediction.sl.toLocaleString()}</div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-zinc-500">Risk:Reward</span>
              <span className="text-amber-400 font-semibold">1 : {prediction.riskReward.toFixed(2)}</span>
              {prediction.constraintApplied && (
                <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30">⚠ Cap aktif</Badge>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-4 text-zinc-600 text-xs">
            {ensemble?.signal === "HOLD" ? "Sinyal HOLD — tidak ada prediksi scalping" : "Menunggu sinyal pertama..."}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5">
            <div className="text-[10px] text-zinc-500 mb-1">Fear & Greed</div>
            {context.fearGreedIndex !== null ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-500 h-1.5 rounded-full relative">
                    <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full border border-zinc-800" style={{ left: `calc(${context.fearGreedIndex}% - 5px)` }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums text-zinc-300">{context.fearGreedIndex}</span>
                </div>
              </>
            ) : <div className="text-xs text-zinc-600">N/A</div>}
          </div>
          <div className="bg-white/5 rounded-lg p-2.5 border border-white/5 space-y-1.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Halving</span>
              <span className="text-orange-300 font-medium capitalize">{context.halvingPhase?.replace(/_/g, " ") ?? "—"}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-zinc-500">Funding</span>
              <span className={`font-mono font-medium ${(context.fundingRate ?? 0) > 0.05 ? "text-red-400" : (context.fundingRate ?? 0) < -0.02 ? "text-emerald-400" : "text-zinc-300"}`}>
                {context.fundingRate !== null ? `${(context.fundingRate * 100).toFixed(4)}%` : "—"}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── #7 Brain Accuracy Chart ───────────────────────────────────────────────────
function BrainAccuracyChart({
  technical, fundamental, macro, asset,
}: {
  technical: BrainPredictionStats; fundamental: BrainPredictionStats; macro: BrainPredictionStats; asset: "xauusd" | "btc";
}) {
  const data = [
    { name: "Technical", correct: technical.correct, wrong: technical.wrong, open: technical.open, total: technical.total },
    { name: "Fundamental", correct: fundamental.correct, wrong: fundamental.wrong, open: fundamental.open, total: fundamental.total },
    { name: "Macro", correct: macro.correct, wrong: macro.wrong, open: macro.open, total: macro.total },
  ];

  const totalVerified = data.reduce((s, d) => s + d.correct + d.wrong, 0);
  if (totalVerified === 0) {
    return (
      <Card className="border border-white/10 bg-zinc-900/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Akurasi per Brain</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6 text-zinc-600 text-sm">
            Belum ada prediksi yang terverifikasi
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border border-white/10 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Akurasi per Brain</CardTitle>
          </div>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Benar</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" /> Salah</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500 inline-block" /> Open</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={data} barSize={20} barGap={2}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#71717a" }} axisLine={false} tickLine={false} width={20} />
            <RechartTooltip
              contentStyle={{ background: "#18181b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
              formatter={(val, name) => [val, name === "correct" ? "Benar" : name === "wrong" ? "Salah" : "Open"]}
            />
            <Bar dataKey="correct" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="wrong" fill="#ef4444" radius={[3, 3, 0, 0]} />
            <Bar dataKey="open" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {/* Win rate summary */}
        <div className="grid grid-cols-3 gap-2 mt-3">
          {data.map((d) => {
            const verified = d.correct + d.wrong;
            const wr = verified > 0 ? Math.round((d.correct / verified) * 100) : null;
            return (
              <div key={d.name} className="bg-white/5 rounded-lg p-2 text-center">
                <div className="text-[10px] text-zinc-500">{d.name}</div>
                <div className={`text-sm font-bold ${wr !== null ? (wr >= 60 ? "text-emerald-400" : wr >= 45 ? "text-yellow-400" : "text-red-400") : "text-zinc-600"}`}>
                  {wr !== null ? `${wr}%` : "—"}
                </div>
                <div className="text-[10px] text-zinc-600">{verified > 0 ? `${verified} verified` : "belum ada"}</div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── #6 Prediction History Table ───────────────────────────────────────────────
function PredictionHistoryPanel({ asset }: { asset: "xauusd" | "btc" }) {
  const [selectedBrain, setSelectedBrain] = useState<"technical" | "fundamental" | "macro">("technical");

  const { data: history, isLoading } = useQuery<BrainPrediction[]>({
    queryKey: ["brain-pred-history", asset, selectedBrain],
    queryFn: async () => {
      if (asset === "xauusd") {
        const res = await fetch(`/api/quant/brain-predictions/${selectedBrain}/history?limit=20`);
        const json = await res.json();
        return json.data ?? [];
      } else {
        // BTC: gunakan endpoint brain-predictions umum, filter per brain
        const rows: BtcBrainPrediction[] = await btcApiFetch("/brain-predictions");
        return rows
          .filter(r => r.brainType === selectedBrain)
          .map(r => ({ ...r, pips: r.fixedDistance, symbol: "BTCUSD", actualPrice: null, verifiedAt: null }));
      }
    },
    refetchInterval: 30_000,
  });

  const brains = ["technical", "fundamental", "macro"] as const;
  const brainColor = { technical: "text-blue-400 border-blue-500/30 bg-blue-500/10", fundamental: "text-violet-400 border-violet-500/30 bg-violet-500/10", macro: "text-amber-400 border-amber-500/30 bg-amber-500/10" };

  return (
    <Card className="border border-white/10 bg-zinc-900/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-zinc-400" />
            <CardTitle className="text-sm font-semibold text-white">Riwayat Prediksi</CardTitle>
          </div>
          <div className="flex gap-1">
            {brains.map((b) => (
              <button
                key={b}
                onClick={() => setSelectedBrain(b)}
                className={`text-[10px] px-2 py-1 rounded border font-semibold capitalize transition-all ${selectedBrain === b ? brainColor[b] : "text-zinc-500 border-white/10 hover:text-zinc-300"}`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
        ) : !history || history.length === 0 ? (
          <div className="text-center py-6 text-zinc-600 text-sm">Belum ada riwayat prediksi untuk brain ini</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-600 border-b border-white/5">
                  <th className="text-left py-1.5 pr-2">Waktu</th>
                  <th className="text-left py-1.5 pr-2">Sinyal</th>
                  <th className="text-right py-1.5 pr-2">Entry</th>
                  <th className="text-right py-1.5 pr-2">TP</th>
                  <th className="text-right py-1.5">SL</th>
                  <th className="text-center py-1.5 pl-2">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 15).map((p) => (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="py-1.5 pr-2 text-zinc-500 tabular-nums whitespace-nowrap">
                      {new Date(p.predictedAt).toLocaleString("id-ID", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className={`font-semibold ${p.signal === "BUY" ? "text-emerald-400" : "text-red-400"}`}>
                        {p.signal === "BUY" ? "▲" : "▼"} {p.signal}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono text-zinc-300">{p.entryPrice.toFixed(asset === "btc" ? 0 : 2)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-emerald-400">{p.tp.toFixed(asset === "btc" ? 0 : 2)}</td>
                    <td className="py-1.5 text-right font-mono text-red-400">{p.sl.toFixed(asset === "btc" ? 0 : 2)}</td>
                    <td className="py-1.5 pl-2 text-center">
                      {p.isVerified ? (
                        p.isCorrect ? (
                          <span className="text-emerald-400 font-bold">✓</span>
                        ) : (
                          <span className="text-red-400 font-bold">✗</span>
                        )
                      ) : (
                        <span className="text-blue-400">●</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Debate Watcher — panel kanan, SSE dari rapat otomatis ────────────────────
type WatchStage = "idle" | "collecting" | "calling_ai" | "revealing" | "done" | "error";
interface WatchMember  { name: string; role: string; vote: "BUY"|"SELL"|"HOLD"; confidence: number; opinion: string }
interface WatchContext { price: number; tech: { signal: string; confidence: number }; fund: { signal: string; confidence: number }; macro: { signal: string; confidence: number } }
interface WatchLeader  { name: string; title: string; decision: "BUY"|"SELL"|"HOLD"; confidence: number; reasoning: string; buyVotes: number; sellVotes: number; holdVotes: number }

function DebateWatcher({ onClose }: { onClose: () => void }) {
  const [stage, setStage]       = useState<WatchStage>("idle");
  const [cycle, setCycle]       = useState<number|null>(null);
  const [stageMsg, setStageMsg] = useState("Menunggu rapat berikutnya dimulai…");
  const [context, setContext]   = useState<WatchContext|null>(null);
  const [members, setMembers]   = useState<WatchMember[]>([]);
  const [leader, setLeader]     = useState<WatchLeader|null>(null);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [members.length]);

  useEffect(() => {
    const es = new EventSource("/api/quant/committee/stream");
    es.onopen  = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string);
        if (ev.type === "ping") return;
        if (ev.type === "connected") {
          if (ev.isRunning) { setStage("collecting"); setStageMsg("Rapat sedang berlangsung…"); }
          return;
        }
        if (ev.type === "stage") {
          setStage(ev.stage as WatchStage);
          setStageMsg(ev.message || "");
          if (ev.cycle) setCycle(ev.cycle as number);
          if (ev.stage === "collecting") { setContext(null); setMembers([]); setLeader(null); }
        }
        if (ev.type === "context") setContext(ev.data as WatchContext);
        if (ev.type === "member")  setMembers(m => [...m, ev.data as WatchMember]);
        if (ev.type === "leader")  setLeader(ev.data as WatchLeader);
        if (ev.type === "done")    { setStage("done"); if (ev.cycle) setCycle(ev.cycle as number); }
        if (ev.type === "error")   { setStage("error"); setStageMsg((ev.message as string) || "Error"); }
      } catch { /* skip */ }
    };
    return () => es.close();
  }, []);

  const buyC  = members.filter(m => m.vote === "BUY").length;
  const sellC = members.filter(m => m.vote === "SELL").length;
  const holdC = members.filter(m => m.vote === "HOLD").length;
  const tot   = members.length || 1;

  const active = stage !== "idle" && stage !== "done" && stage !== "error";

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex">
      <div className="absolute inset-0 -left-[100vw] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm sm:max-w-md h-full bg-zinc-950 border-l border-amber-500/20 shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🏛️</span>
            <div>
              <div className="text-sm font-bold text-white flex items-center gap-2">
                Rapat Live — Dewan Emas
                {cycle && <span className="text-[10px] font-normal text-zinc-500">#{cycle}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-zinc-600"} ${connected && active ? "animate-pulse" : ""}`} />
                <span className="text-[10px] text-zinc-500">
                  {!connected ? "Menghubungkan…" : active ? "Sedang rapat" : stage === "done" ? "Rapat selesai" : "Menunggu rapat"}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">

          {/* Idle */}
          {stage === "idle" && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <div className="w-14 h-14 rounded-full border border-amber-500/20 bg-amber-500/5 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-400/40" />
              </div>
              <div>
                <p className="text-sm text-zinc-400 font-medium">Menunggu rapat berikutnya</p>
                <p className="text-xs text-zinc-600 mt-1">Rapat dewan berlangsung otomatis setiap 10 menit</p>
              </div>
            </div>
          )}

          {/* Stage bar */}
          {active && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300">{stageMsg}</span>
            </div>
          )}

          {/* Context */}
          {context && (
            <div className="border border-white/8 rounded-xl p-3 bg-white/3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Data Rapat</span>
                <span className="text-sm font-mono font-bold text-white">${context.price.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center">
                {([
                  { label: "Tech",   signal: context.tech.signal,  conf: context.tech.confidence  },
                  { label: "Fund",   signal: context.fund.signal,  conf: context.fund.confidence  },
                  { label: "Macro",  signal: context.macro.signal, conf: context.macro.confidence },
                ] as const).map(b => (
                  <div key={b.label} className="bg-white/3 rounded px-1 py-1.5">
                    <div className="text-[9px] text-zinc-500 mb-0.5">{b.label}</div>
                    <div className={`text-xs font-bold ${signalColor(b.signal)}`}>{b.signal}</div>
                    <div className="text-[9px] text-zinc-600">{Math.round(b.conf * 100)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live tally */}
          {members.length > 0 && (
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-zinc-500">{members.length}/15 anggota</span>
                <span className="flex gap-2">
                  <span className="text-emerald-400">▲{buyC}</span>
                  <span className="text-yellow-400">—{holdC}</span>
                  <span className="text-red-400">▼{sellC}</span>
                </span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-white/5">
                {buyC  > 0 && <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${(buyC/tot)*100}%`  }} />}
                {holdC > 0 && <div className="bg-yellow-500 transition-all duration-500" style={{ width: `${(holdC/tot)*100}%` }} />}
                {sellC > 0 && <div className="bg-red-500   transition-all duration-500" style={{ width: `${(sellC/tot)*100}%` }} />}
              </div>
            </div>
          )}

          {/* Member cards */}
          {members.map((m, i) => (
            <div
              key={m.name}
              className="border border-white/5 rounded-lg p-2.5 bg-white/2 flex items-start gap-2.5"
              style={{ animation: `watcher-slide 0.3s ease both` }}
            >
              <div className="shrink-0 w-5 h-5 rounded-full bg-zinc-800/80 flex items-center justify-center text-[9px] text-zinc-500 font-mono">{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-zinc-200">{m.name}</span>
                    <span className="text-[10px] text-zinc-600 ml-1">{m.role}</span>
                  </div>
                  <Badge className={`text-[10px] shrink-0 border px-1.5 ${signalBadge(m.vote)}`}>{m.vote}</Badge>
                </div>
                <p className="text-xs text-zinc-400 leading-snug">{m.opinion}</p>
                <div className="mt-1.5"><ConfBar value={m.confidence} signal={m.vote} /></div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />

          {/* Leader */}
          {leader && (
            <div className="border border-amber-500/30 rounded-xl bg-amber-500/8 p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔨</span>
                  <div>
                    <div className="text-xs font-bold text-white">{leader.title}</div>
                    <div className="text-[10px] text-zinc-500">{leader.name}</div>
                  </div>
                </div>
                <Badge className={`text-sm font-black border px-3 py-1 ${signalBadge(leader.decision)}`}>{leader.decision}</Badge>
              </div>
              <ConfBar value={leader.confidence} signal={leader.decision} />
              <p className="text-xs text-zinc-200 leading-relaxed border-l-2 border-amber-500/40 pl-3 italic">"{leader.reasoning}"</p>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-400 font-semibold">▲ BUY {leader.buyVotes}</span>
                <span className="text-yellow-400">— HOLD {leader.holdVotes}</span>
                <span className="text-red-400 font-semibold">▼ SELL {leader.sellVotes}</span>
              </div>
            </div>
          )}

          {/* Done */}
          {stage === "done" && (
            <div className="text-center py-4 space-y-1">
              <div className="text-emerald-400 text-sm font-semibold">✓ Rapat selesai</div>
              <div className="text-xs text-zinc-600">Hasil disimpan. Rapat berikutnya ~10 menit.</div>
            </div>
          )}

          {/* Error */}
          {stage === "error" && (
            <div className="border border-red-500/30 rounded-lg bg-red-500/10 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <p className="text-xs text-red-300">{stageMsg}</p>
            </div>
          )}
        </div>

        <style>{`
          @keyframes watcher-slide {
            from { opacity: 0; transform: translateX(12px); }
            to   { opacity: 1; transform: translateX(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

// ─── #11 #12 Council Panel + countdown + filter ────────────────────────────────
function CouncilPanel({ debate, accent, meetingIntervalMin }: {
  debate: CouncilDebate | null; accent: "amber" | "orange"; meetingIntervalMin: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [voteFilter, setVoteFilter] = useState<"ALL" | "BUY" | "SELL" | "HOLD">("ALL");
  const [nextMeetingIn, setNextMeetingIn] = useState<string | null>(null);
  const [showWatcher, setShowWatcher] = useState(false);

  // #11 Countdown rapat berikutnya
  useEffect(() => {
    if (!debate?.debatedAt) return;
    const tick = () => {
      const debatedMs = new Date(debate.debatedAt).getTime();
      const nextMs = debatedMs + meetingIntervalMin * 60 * 1000;
      const rem = Math.max(0, Math.round((nextMs - Date.now()) / 1000));
      const m = Math.floor(rem / 60);
      const s = rem % 60;
      setNextMeetingIn(rem > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : "segera...");
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [debate?.debatedAt, meetingIntervalMin]);

  const accentText = accent === "amber" ? "text-amber-400" : "text-orange-400";
  const accentBorder = accent === "amber" ? "border-amber-500/20" : "border-orange-500/20";
  const accentBg = accent === "amber" ? "bg-amber-500/10" : "bg-orange-500/10";

  if (!debate) {
    return (
      <>
        <Card className={`border ${accentBorder} bg-zinc-900/60`}>
          <CardContent className="flex flex-col items-center justify-center min-h-48 gap-3">
            <div className="text-center text-zinc-600">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
              <p className="text-sm">Dewan sedang menggelar rapat pertama...</p>
            </div>
            {accent === "amber" && (
              <button
                onClick={() => setShowWatcher(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-amber-500/40 text-amber-400 hover:bg-amber-500/15 transition-all"
              >
                <Eye className="w-3.5 h-3.5" /> Tonton Rapat
              </button>
            )}
          </CardContent>
        </Card>
        {showWatcher && <DebateWatcher onClose={() => setShowWatcher(false)} />}
      </>
    );
  }

  const totalVotes = debate.buyVotes + debate.sellVotes + debate.holdVotes;
  const pct = (n: number) => (totalVotes > 0 ? Math.round((n / totalVotes) * 100) : 0);

  // #12 Filter anggota berdasarkan vote
  const filteredMembers = voteFilter === "ALL"
    ? debate.members
    : debate.members.filter(m => m.vote === voteFilter);
  const visibleMembers = expanded ? filteredMembers : filteredMembers.slice(0, 6);

  return (
    <>
    <Card className={`border ${accentBorder} bg-zinc-900/60`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className={`w-4 h-4 ${accentText}`} />
            <CardTitle className="text-sm font-semibold text-white">Dewan Analis</CardTitle>
            <Badge variant="outline" className="text-[10px] border-white/10 text-zinc-500">
              {debate.members.length + 1} anggota
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {nextMeetingIn && (
              <div className="flex items-center gap-1 text-[10px] text-zinc-600">
                <Timer className="w-3 h-3" />
                <span>Rapat berikutnya: {nextMeetingIn}</span>
              </div>
            )}
            <span className="text-xs text-zinc-600">Rapat #{debate.cycleNumber}</span>
            {accent === "amber" && (
              <button
                onClick={() => setShowWatcher(true)}
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-full border border-amber-500/40 text-amber-400 hover:bg-amber-500/15 transition-all"
              >
                <Eye className="w-3 h-3" /> Tonton
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Voting bar */}
        <div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-white/5">
            {debate.buyVotes > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${pct(debate.buyVotes)}%` }} />}
            {debate.holdVotes > 0 && <div className="bg-yellow-500 h-full" style={{ width: `${pct(debate.holdVotes)}%` }} />}
            {debate.sellVotes > 0 && <div className="bg-red-500 h-full" style={{ width: `${pct(debate.sellVotes)}%` }} />}
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-zinc-500">
            <span className="text-emerald-400">▲ BUY {debate.buyVotes} ({pct(debate.buyVotes)}%)</span>
            <span className="text-yellow-400">— HOLD {debate.holdVotes}</span>
            <span className="text-red-400">▼ SELL {debate.sellVotes} ({pct(debate.sellVotes)}%)</span>
          </div>
        </div>

        {/* Leader decision */}
        <div className={`${accentBg} border ${accentBorder} rounded-lg p-3`}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">🏛️</span>
              <span className="text-xs font-semibold text-white">{debate.leaderTitle}</span>
              <span className="text-xs text-zinc-500">— {debate.leaderName}</span>
            </div>
            <Badge className={`text-xs font-bold px-2 py-0.5 border ${signalBadge(debate.leaderDecision)}`}>
              {debate.leaderDecision}
            </Badge>
          </div>
          <ConfBar value={debate.leaderConfidence} signal={debate.leaderDecision} />
          <p className="text-xs text-zinc-300 leading-relaxed mt-2 border-l-2 border-white/10 pl-2.5">
            {debate.leaderReasoning}
          </p>
        </div>

        {/* #12 Filter + member opinions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500 flex items-center gap-1"><Filter className="w-3 h-3" /> Filter anggota</span>
            <div className="flex gap-1">
              {(["ALL", "BUY", "SELL", "HOLD"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setVoteFilter(f)}
                  className={`text-[10px] px-2 py-0.5 rounded border font-semibold transition-all ${
                    voteFilter === f
                      ? f === "BUY" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                        : f === "SELL" ? "bg-red-500/20 text-red-400 border-red-500/40"
                        : f === "HOLD" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                        : "bg-white/10 text-white border-white/20"
                      : "text-zinc-600 border-white/5 hover:text-zinc-400"
                  }`}
                >
                  {f === "ALL" ? `Semua (${debate.members.length})` : `${f} (${debate.members.filter(m => m.vote === f).length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visibleMembers.map((m) => (
              <div key={m.name} className="border border-white/5 rounded-lg p-2.5 bg-white/3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <div className="text-xs font-medium text-zinc-200">{m.name}</div>
                    <div className="text-[10px] text-zinc-500">{m.role}</div>
                  </div>
                  <Badge className={`text-[10px] shrink-0 border ${signalBadge(m.vote)}`}>{m.vote}</Badge>
                </div>
                <p className="text-xs text-zinc-400 leading-snug">{m.opinion}</p>
              </div>
            ))}
          </div>
          {filteredMembers.length > 6 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-2 mx-auto"
            >
              {expanded ? "Sembunyikan" : `Lihat semua ${filteredMembers.length} pendapat`}
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
          {filteredMembers.length === 0 && voteFilter !== "ALL" && (
            <div className="text-center py-4 text-zinc-600 text-xs">Tidak ada anggota dengan vote {voteFilter}</div>
          )}
        </div>
      </CardContent>
    </Card>
    {showWatcher && accent === "amber" && (
      <DebateWatcher onClose={() => setShowWatcher(false)} />
    )}
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function QuantBotPage() {
  const { toast } = useToast();
  const [activeAsset, setActiveAsset] = useState<"xauusd" | "btc">("xauusd");

  // ── XAUUSD queries ──────────────────────────────────────────────────────────
  const { data: status, isLoading, isError, refetch, dataUpdatedAt } = useQuery<QuantStatus>({
    queryKey: ["quant-status"],
    queryFn: () => apiFetch<QuantStatus>("/status"),
    refetchInterval: activeAsset === "xauusd" ? 30_000 : false,
    retry: 2,
  });

  const { data: newsData } = useQuery<{ news: QuantStatus["news"]; newsApiProvider: string }>({
    queryKey: ["quant-news"],
    queryFn: () => apiFetch("/news"),
    refetchInterval: activeAsset === "xauusd" ? 5 * 60_000 : false,
  });

  const { data: live } = useQuery<LivePrices>({
    queryKey: ["quant-live-prices"],
    queryFn: () => apiFetch<LivePrices>("/live-prices"),
    refetchInterval: 1_000, retry: false,
  });

  const { data: brainPredictions } = useQuery<BrainPredictionsResponse>({
    queryKey: ["quant-brain-predictions"],
    queryFn: () => apiFetch<BrainPredictionsResponse>("/brain-predictions"),
    refetchInterval: activeAsset === "xauusd" ? 15_000 : false,
    retry: false,
  });

  // ── BTC queries ─────────────────────────────────────────────────────────────
  const { data: btcStatus, isLoading: btcLoading, refetch: btcRefetch } = useQuery<BtcQuantStatus>({
    queryKey: ["btc-quant-status"],
    queryFn: () => btcApiFetch<BtcQuantStatus>("/status"),
    refetchInterval: activeAsset === "btc" ? 15_000 : false,
    retry: 2,
  });

  const { data: btcBrainStats } = useQuery<BtcBrainStats>({
    queryKey: ["btc-quant-brain-stats"],
    queryFn: () => btcApiFetch<BtcBrainStats>("/brain-stats"),
    refetchInterval: activeAsset === "btc" ? 30_000 : false,
    retry: false,
  });

  const { data: btcBrainPredictions } = useQuery<BtcBrainPrediction[]>({
    queryKey: ["btc-quant-brain-predictions"],
    queryFn: () => btcApiFetch<BtcBrainPrediction[]>("/brain-predictions"),
    refetchInterval: activeAsset === "btc" ? 15_000 : false,
    retry: false,
  });

  // ── Dewan (Council) queries ─────────────────────────────────────────────────
  const { data: goldCouncil } = useQuery<CouncilResponse>({
    queryKey: ["quant-committee"],
    queryFn: () => apiFetch<CouncilResponse>("/committee"),
    refetchInterval: activeAsset === "xauusd" ? 30_000 : false,
    retry: false,
  });

  const { data: btcCouncil } = useQuery<CouncilResponse>({
    queryKey: ["btc-quant-committee"],
    queryFn: () => btcApiFetch<CouncilResponse>("/committee"),
    refetchInterval: activeAsset === "btc" ? 30_000 : false,
    retry: false,
  });

  // #8 Deteksi perubahan sinyal & toast notifikasi
  const prevSignalRef = useRef<string | null>(null);
  useEffect(() => {
    const currentSignal = activeAsset === "xauusd"
      ? status?.ensemble?.signal ?? null
      : btcStatus?.ensemble?.signal ?? null;
    if (currentSignal && prevSignalRef.current && prevSignalRef.current !== currentSignal) {
      const emoji = currentSignal === "BUY" ? "🟢" : currentSignal === "SELL" ? "🔴" : "🟡";
      toast({
        title: `${emoji} Sinyal berubah: ${currentSignal}`,
        description: `${activeAsset === "xauusd" ? "XAU/USD" : "BTC/USD"} ensemble signal berganti dari ${prevSignalRef.current} → ${currentSignal}`,
        duration: 6000,
      });
    }
    prevSignalRef.current = currentSignal;
  }, [status?.ensemble?.signal, btcStatus?.ensemble?.signal, activeAsset]);

  const lastUpdate = dataUpdatedAt || null;
  const ensemble = status?.ensemble;
  const isActive = status?.isActive ?? false;
  const activeEnsemble = activeAsset === "xauusd" ? ensemble : btcStatus?.ensemble ?? null;
  const activeLoading = activeAsset === "xauusd" ? isLoading : btcLoading;
  const handleRefresh = () => activeAsset === "xauusd" ? refetch() : btcRefetch();

  // #5 Deteksi API key missing
  const xauApiKeyMissing = detectApiKeyMissing(status);
  const btcApiKeyMissing = !btcStatus?.isActive && btcStatus?.technical?.insights === 0 && btcStatus?.fundamental?.insights === 0;

  if (isError) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-zinc-400 text-sm">Gagal memuat Quant Bot</p>
          <Button onClick={() => refetch()} variant="outline" size="sm">Coba Lagi</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── Header ── */}
      <div className="sticky top-0 z-40 border-b border-white/10 backdrop-blur-xl bg-zinc-950/90">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm">← Admin</Link>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2">
              <div className="bg-amber-500/10 p-1.5 rounded-lg">
                <Bot className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white">Quant Bot</h1>
                <p className="text-xs text-zinc-500">3-Brain Autonomous Trader</p>
              </div>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center bg-zinc-900 border border-white/10 rounded-lg p-0.5 gap-0.5">
              <button
                onClick={() => setActiveAsset("xauusd")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${activeAsset === "xauusd" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "text-zinc-500 hover:text-zinc-300"}`}
              >⚡ XAU/USD</button>
              <button
                onClick={() => setActiveAsset("btc")}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${activeAsset === "btc" ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "text-zinc-500 hover:text-zinc-300"}`}
              >₿ BTC/USD</button>
            </div>

            {(activeAsset === "xauusd" ? isActive : btcStatus?.isActive) && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs animate-pulse">● AKTIF</Badge>
            )}

            <div className="hidden md:flex items-center gap-3 pl-3 ml-1 border-l border-white/10">
              <LiveTickerPill label="XAU/USD" ticker={live?.xauusd} />
              <LiveTickerPill label="BTC/USD" ticker={live?.btcusd} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {activeEnsemble && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${signalBg(activeEnsemble.signal)}`}>
                {activeEnsemble.signal === "BUY" ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> :
                 activeEnsemble.signal === "SELL" ? <ArrowDownRight className="w-4 h-4 text-red-400" /> :
                 <Minus className="w-4 h-4 text-yellow-400" />}
                <span className={`text-sm font-bold ${signalColor(activeEnsemble.signal)}`}>{activeEnsemble.signal}</span>
                <span className="text-xs text-zinc-500">{Math.round(activeEnsemble.confidence * 100)}%</span>
              </div>
            )}
            {/* #4 Countdown */}
            {lastUpdate && <RefreshCountdown intervalMs={activeAsset === "xauusd" ? 30_000 : 15_000} lastUpdate={lastUpdate} />}
            <Button onClick={handleRefresh} disabled={activeLoading} variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-white">
              <RefreshCw className={`w-3.5 h-3.5 ${activeLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Mobile ticker */}
        <div className="flex md:hidden items-center justify-around gap-3 px-4 py-2 border-t border-white/5 bg-zinc-950/60">
          <LiveTickerPill label="XAU/USD" ticker={live?.xauusd} />
          <LiveTickerPill label="BTC/USD" ticker={live?.btcusd} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ════════ XAUUSD TAB ════════ */}
        {activeAsset === "xauusd" && (
          <>
            {/* #5 API Key Banner */}
            {status && xauApiKeyMissing && <ApiKeyBanner asset="xauusd" />}

            {/* Loading skeleton */}
            {isLoading && !status && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-zinc-900/50 rounded-xl border border-white/5 animate-pulse" />)}
              </div>
            )}

            {/* 3 Brain Cards */}
            {status && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <BrainCard
                  type="technical" icon={BarChart2} title="Technical Brain" subtitle="Price action & indicators"
                  signal={status.technical?.signal ?? "HOLD"} confidence={status.technical?.confidence ?? 0}
                  reasoning={status.technical?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
                  extraInfo={[{ label: "Setup", value: status.technical?.keySetup ?? "—" }]}
                  insights={status.technical?.insights ?? 0} loading={isLoading}
                  prediction={brainPredictions?.technical.latest} predictionStats={brainPredictions?.technical.stats}
                />
                <BrainCard
                  type="fundamental" icon={LineChart} title="Fundamental Brain" subtitle="Rates, COT & macro drivers"
                  signal={status.fundamental?.signal ?? "HOLD"} confidence={status.fundamental?.confidence ?? 0}
                  reasoning={status.fundamental?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
                  extraInfo={[
                    { label: "Bias", value: status.fundamental?.fundamentalBias ?? "—" },
                    { label: "Driver", value: status.fundamental?.keyDriver ?? "—" },
                  ]}
                  insights={status.fundamental?.insights ?? 0} loading={isLoading}
                  prediction={brainPredictions?.fundamental.latest} predictionStats={brainPredictions?.fundamental.stats}
                />
                <BrainCard
                  type="macro" icon={Globe} title="Macro Brain" subtitle="DXY, yields & geopolitics"
                  signal={status.macro?.signal ?? "HOLD"} confidence={status.macro?.confidence ?? 0}
                  reasoning={status.macro?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
                  extraInfo={[
                    { label: "Regime", value: status.macro?.macroRegime ?? "—" },
                    { label: "Fed", value: status.macro?.fedBias ?? "—" },
                    { label: "Geo Risk", value: status.macro?.geopoliticalRisk ?? "—" },
                  ]}
                  insights={status.macro?.insights ?? 0} loading={isLoading}
                  prediction={brainPredictions?.macro.latest} predictionStats={brainPredictions?.macro.stats}
                />
              </div>
            )}

            {/* Ensemble + Capital */}
            {status?.ensemble && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <EnsemblePanel ensemble={status.ensemble} />
                <CapitalPanel capital={status.capital} prediction={status.prediction} />
              </div>
            )}

            {/* Dewan Emas */}
            {status && <CouncilPanel debate={goldCouncil?.current ?? null} accent="amber" meetingIntervalMin={10} />}

            {/* Psychology + News */}
            {status && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {status.psychology ? (
                  <PsychologyPanel psychology={status.psychology} macroNarrative={status.macro?.psychologyNarrative} />
                ) : (
                  <Card className="border border-white/10 bg-zinc-900/60 flex items-center justify-center min-h-48">
                    <div className="text-center text-zinc-600">
                      <Eye className="w-6 h-6 mx-auto mb-2" />
                      <p className="text-sm">Analisis psikologi dalam proses...</p>
                    </div>
                  </Card>
                )}
                <NewsPanel news={newsData?.news ?? status.news ?? []} apiProvider={newsData?.newsApiProvider} />
              </div>
            )}

            {/* #7 Accuracy Chart + #6 History */}
            {brainPredictions && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BrainAccuracyChart
                  technical={brainPredictions.technical.stats}
                  fundamental={brainPredictions.fundamental.stats}
                  macro={brainPredictions.macro.stats}
                  asset="xauusd"
                />
                <PredictionHistoryPanel asset="xauusd" />
              </div>
            )}

            {/* Stats footer */}
            {status && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Siklus Total", value: status.cycleCount, icon: Activity },
                  { label: "Technical Insights", value: status.technical?.insights ?? 0, icon: BarChart2 },
                  { label: "Fundamental Insights", value: status.fundamental?.insights ?? 0, icon: BookOpen },
                  { label: "Macro Insights", value: status.macro?.insights ?? 0, icon: Globe },
                ].map((stat) => (
                  <Card key={stat.label} className="border border-white/5 bg-zinc-900/40">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">{stat.label}</span>
                        <stat.icon className="w-3.5 h-3.5 text-zinc-600" />
                      </div>
                      <div className="text-2xl font-bold text-white mt-1">{stat.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {status && !status.isActive && (
              <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-6 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
                <h3 className="text-white font-semibold mb-1">Quant Bot Sedang Inisialisasi</h3>
                <p className="text-sm text-zinc-400">3 brain engine sedang memulai siklus belajar pertama. Akan aktif dalam ~1-2 menit.</p>
                <p className="text-xs text-zinc-600 mt-2">Pastikan DeepSeek API key sudah diset di <Link href="/admin/settings" className="text-amber-400 underline">Pengaturan</Link></p>
              </div>
            )}
          </>
        )}

        {/* ════════ BTC TAB ════════ */}
        {activeAsset === "btc" && (
          <>
            {/* #5 API Key Banner for BTC */}
            {btcApiKeyMissing && <ApiKeyBanner asset="btc" />}

            {/* Scalping constraint banner */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-xl text-sm">
              <Zap className="w-4 h-4 text-orange-400 shrink-0" />
              <span className="text-orange-300 font-medium">Scalping Mode Aktif</span>
              <span className="text-zinc-400 text-xs">TP/SL maksimal <strong className="text-orange-400">$1.000</strong> dari entry — scalping constraint otomatis</span>
              <Badge className="ml-auto text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30 shrink-0">Ensemble 40/30/30</Badge>
            </div>

            {/* Loading skeleton */}
            {btcLoading && !btcStatus && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-zinc-900/50 rounded-xl border border-white/5 animate-pulse" />)}
              </div>
            )}

            {/* 3 Brain Cards BTC */}
            {btcStatus && (() => {
              const techPred = btcBrainPredictions?.find(p => p.brainType === "technical") ?? null;
              const fundPred = btcBrainPredictions?.find(p => p.brainType === "fundamental") ?? null;
              const macroPred = btcBrainPredictions?.find(p => p.brainType === "macro") ?? null;
              const getStats = (brainKey: string): BrainPredictionStats => {
                const row = btcBrainStats?.accuracy?.find(a => a.brain_type === brainKey);
                const verified = Number(row?.verified ?? 0);
                const correct = Number(row?.correct ?? 0);
                const open = (btcBrainStats?.[brainKey as "technical" | "fundamental" | "macro"]?.insights?.count ?? 0) > 0 ? 1 : 0;
                return { total: verified, correct, wrong: verified - correct, open };
              };
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <BrainCard
                    type="technical" icon={BarChart2} title="BTC Technical Brain" subtitle="RSI, EMA, BB squeeze & funding rate"
                    signal={btcStatus.technical?.signal ?? "HOLD"} confidence={btcStatus.technical?.confidence ?? 0}
                    reasoning={btcStatus.technical?.reasoning ?? ["Menunggu siklus pertama..."]}
                    extraInfo={[{ label: "Setup", value: btcStatus.technical?.keySetup ?? "—" }]}
                    insights={btcStatus.technical?.insights ?? 0} loading={btcLoading}
                    prediction={techPred ? { ...techPred, pips: techPred.fixedDistance, symbol: "BTCUSD" } : null}
                    predictionStats={getStats("technical")}
                  />
                  <BrainCard
                    type="fundamental" icon={LineChart} title="BTC Fundamental Brain" subtitle="Halving, Fear & Greed, ETF flows"
                    signal={btcStatus.fundamental?.signal ?? "HOLD"} confidence={btcStatus.fundamental?.confidence ?? 0}
                    reasoning={btcStatus.fundamental?.reasoning ?? ["Menunggu siklus pertama..."]}
                    extraInfo={[
                      { label: "Bias", value: btcStatus.fundamental?.fundamentalBias ?? "—" },
                      { label: "Halving", value: btcStatus.fundamental?.halvingPhase?.replace(/_/g, " ") ?? "—" },
                      { label: "F&G", value: btcStatus.fundamental?.fearGreedScore != null ? String(btcStatus.fundamental.fearGreedScore) : "—" },
                    ]}
                    insights={btcStatus.fundamental?.insights ?? 0} loading={btcLoading}
                    prediction={fundPred ? { ...fundPred, pips: fundPred.fixedDistance, symbol: "BTCUSD" } : null}
                    predictionStats={getStats("fundamental")}
                  />
                  <BrainCard
                    type="macro" icon={Globe} title="BTC Macro Brain" subtitle="Risk regime, Nasdaq & DXY correlation"
                    signal={btcStatus.macro?.signal ?? "HOLD"} confidence={btcStatus.macro?.confidence ?? 0}
                    reasoning={btcStatus.macro?.reasoning ?? ["Menunggu siklus pertama..."]}
                    extraInfo={[
                      { label: "Regime", value: btcStatus.macro?.macroRegime ?? "—" },
                      { label: "Corr Bias", value: btcStatus.macro?.correlationBias ?? "—" },
                    ]}
                    insights={btcStatus.macro?.insights ?? 0} loading={btcLoading}
                    prediction={macroPred ? { ...macroPred, pips: macroPred.fixedDistance, symbol: "BTCUSD" } : null}
                    predictionStats={getStats("macro")}
                  />
                </div>
              );
            })()}

            {/* Ensemble + Scalping Panel */}
            {btcStatus?.ensemble && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <EnsemblePanel ensemble={btcStatus.ensemble} />
                <BtcScalpingPanel prediction={btcStatus.prediction} context={btcStatus.context} ensemble={btcStatus.ensemble} />
              </div>
            )}

            {/* Dewan BTC */}
            {btcStatus && <CouncilPanel debate={btcCouncil?.current ?? null} accent="orange" meetingIntervalMin={8} />}

            {/* #2 BTC Psychology + News — simetris dengan XAUUSD */}
            {btcStatus && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <BtcPsychologyPanel context={btcStatus.context} macro={btcStatus.macro} />
                {/* BTC menggunakan news endpoint XAUUSD sebagai fallback — hanya tampilkan berita gold/macro */}
                <NewsPanel news={newsData?.news ?? []} apiProvider={newsData?.newsApiProvider ?? "rss_fallback"} />
              </div>
            )}

            {/* #2 BTC Capital — panel manajemen modal */}
            {btcStatus?.ensemble && status && (
              <CapitalPanel capital={status.capital} prediction={null} />
            )}

            {/* #7 Accuracy Chart + #6 History untuk BTC */}
            {btcBrainStats && btcBrainPredictions && (() => {
              const getStatsForChart = (brainKey: string): BrainPredictionStats => {
                const row = btcBrainStats.accuracy?.find(a => a.brain_type === brainKey);
                const verified = Number(row?.verified ?? 0);
                const correct = Number(row?.correct ?? 0);
                return { total: verified, correct, wrong: verified - correct, open: 0 };
              };
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <BrainAccuracyChart
                    technical={getStatsForChart("technical")}
                    fundamental={getStatsForChart("fundamental")}
                    macro={getStatsForChart("macro")}
                    asset="btc"
                  />
                  <PredictionHistoryPanel asset="btc" />
                </div>
              );
            })()}

            {/* Stats footer BTC */}
            {btcStatus && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Siklus Orchestrator", value: btcStatus.cycleCount, icon: Activity },
                  { label: "Technical Insights", value: btcBrainStats?.technical?.insights?.count ?? btcStatus.technical?.insights ?? 0, icon: BarChart2 },
                  { label: "Fundamental Insights", value: btcBrainStats?.fundamental?.insights?.count ?? btcStatus.fundamental?.insights ?? 0, icon: BookOpen },
                  { label: "Macro Insights", value: btcBrainStats?.macro?.insights?.count ?? btcStatus.macro?.insights ?? 0, icon: Globe },
                ].map((stat) => (
                  <Card key={stat.label} className="border border-white/5 bg-zinc-900/40">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">{stat.label}</span>
                        <stat.icon className="w-3.5 h-3.5 text-zinc-600" />
                      </div>
                      <div className="text-2xl font-bold text-white mt-1">{stat.value}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {btcStatus && !btcStatus.isActive && (
              <div className="border border-orange-500/20 bg-orange-500/5 rounded-xl p-6 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-orange-400 mx-auto mb-3" />
                <h3 className="text-white font-semibold mb-1">BTC Quant Bot Sedang Inisialisasi</h3>
                <p className="text-sm text-zinc-400">3 brain BTC sedang memulai siklus belajar pertama (~2 menit).</p>
              </div>
            )}

            {!btcStatus && !btcLoading && (
              <div className="border border-white/10 bg-zinc-900/40 rounded-xl p-8 text-center">
                <Bot className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-500 text-sm">Menunggu data BTC Quant Bot...</p>
                <Button onClick={() => btcRefetch()} variant="outline" size="sm" className="mt-3">
                  <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                </Button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
