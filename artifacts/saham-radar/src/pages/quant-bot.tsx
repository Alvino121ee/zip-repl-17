/**
 * Quant Bot — Halaman trading otomatis serius
 * 3 otak independen: Technical | Fundamental | Macro
 * Masing-masing belajar sendiri via DeepSeek, tidak digabung.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Minus, Brain, Zap, Activity,
  RefreshCw, ChevronRight, Target, DollarSign, Shield,
  Newspaper, BarChart2, LineChart, Globe, BookOpen,
  CheckCircle2, XCircle, Clock, Loader2, Settings,
  AlertTriangle, Eye, ChevronDown, ChevronUp, Bot,
  Layers, Lock, Unlock, ArrowUpRight, ArrowDownRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getAdminToken } from "@/lib/auth";

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
  price: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePct: number | null;
  timestamp: number | null;
  stale: boolean;
  error: string | null;
  source: string;
}
interface LivePrices {
  xauusd: LiveTicker;
  btcusd: LiveTicker;
  updatedAt: string;
}

// ─── API helpers ───────────────────────────────────────────────────────────────
const API = "/api/quant";
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "API error");
  return data.data;
}

// ─── Colour helpers ────────────────────────────────────────────────────────────
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

// ─── Confidence bar ────────────────────────────────────────────────────────────
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

// ─── Brain Card ────────────────────────────────────────────────────────────────
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

function BrainCard({
  type, icon: Icon, title, subtitle, signal, confidence, reasoning, extraInfo, insights, loading,
}: {
  type: "technical" | "fundamental" | "macro";
  icon: React.ElementType;
  title: string;
  subtitle: string;
  signal: string;
  confidence: number;
  reasoning: string[];
  extraInfo: { label: string; value: string }[];
  insights: number;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = type === "technical" ? "border-blue-500/20" : type === "fundamental" ? "border-violet-500/20" : "border-amber-500/20";
  const accentColor = type === "technical" ? "text-blue-400" : type === "fundamental" ? "text-violet-400" : "text-amber-400";
  const iconBg = type === "technical" ? "bg-blue-500/10" : type === "fundamental" ? "bg-violet-500/10" : "bg-amber-500/10";

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

        {/* Extra info pills */}
        <div className="flex flex-wrap gap-1.5">
          {extraInfo.map((info) => (
            <span key={info.label} className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-zinc-400">
              <span className="text-zinc-500">{info.label}:</span> <span className="text-zinc-300">{info.value}</span>
            </span>
          ))}
          <span className="text-xs bg-white/5 border border-white/10 rounded px-2 py-0.5 text-zinc-400">
            <span className="text-zinc-500">Insights:</span> <span className={accentColor}>{insights}</span>
          </span>
        </div>

        {/* Reasoning */}
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

// ─── Ensemble Visualizer ───────────────────────────────────────────────────────
function EnsemblePanel({ ensemble }: { ensemble: NonNullable<QuantStatus["ensemble"]> }) {
  const brains = [
    { key: "technical", label: "Technical", weight: ensemble.weights.technical, vote: ensemble.votes.technical, icon: BarChart2, color: "blue" },
    { key: "fundamental", label: "Fundamental", weight: ensemble.weights.fundamental, vote: ensemble.votes.fundamental, icon: LineChart, color: "violet" },
    { key: "macro", label: "Macro", weight: ensemble.weights.macro, vote: ensemble.votes.macro, icon: Globe, color: "amber" },
  ] as const;

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
            <Badge className={`text-sm font-bold px-3 py-1 border ${signalBadge(ensemble.signal)}`}>
              {ensemble.signal === "BUY" ? "▲ " : ensemble.signal === "SELL" ? "▼ " : "— "}
              {ensemble.signal}
            </Badge>
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
        {/* Confidence bar */}
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-zinc-500">Ensemble Confidence</span>
          <span className={`text-sm font-bold ${signalColor(ensemble.signal)}`}>{Math.round(ensemble.confidence * 100)}%</span>
        </div>
        <div className="bg-white/5 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${ensemble.signal === "BUY" ? "bg-gradient-to-r from-emerald-600 to-emerald-400" : ensemble.signal === "SELL" ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-gradient-to-r from-yellow-600 to-yellow-400"}`}
            style={{ width: `${Math.round(ensemble.confidence * 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Psychology Panel ──────────────────────────────────────────────────────────
function PsychologyPanel({ psychology, macroNarrative }: {
  psychology: NonNullable<QuantStatus["psychology"]>;
  macroNarrative?: string;
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
        {/* Fear/Greed bar */}
        <div>
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>Extreme Fear</span><span>Neutral</span><span>Extreme Greed</span>
          </div>
          <div className="relative bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-500 h-2 rounded-full">
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-zinc-800 transition-all duration-700"
              style={{ left: `calc(${scorePct}% - 6px)` }}
            />
          </div>
        </div>

        {/* Key emotions */}
        <div className="flex flex-wrap gap-1.5">
          {psychology.keyEmotions.map((e) => (
            <Badge key={e} variant="outline" className="text-xs border-white/10 text-zinc-300">{e}</Badge>
          ))}
        </div>

        {/* Narrative */}
        <p className="text-sm text-zinc-300 leading-relaxed border-l-2 border-white/10 pl-3">
          {psychology.narrative}
        </p>

        {/* Crowd vs Smart Money */}
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

        {/* Trading implication */}
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
          <div className="text-xs text-amber-400 font-semibold mb-1">💡 Implikasi Trading</div>
          <p className="text-xs text-zinc-300">{psychology.tradingImplication}</p>
        </div>

        {/* Macro narrative toggle */}
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

// ─── Capital Panel ─────────────────────────────────────────────────────────────
function CapitalPanel({
  capital, prediction,
}: {
  capital: QuantStatus["capital"];
  prediction: QuantStatus["prediction"];
}) {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState(String(capital.accountBalance));
  const [risk, setRisk] = useState(String(capital.riskPercent));
  const [leverage, setLeverage] = useState(String(capital.leverage));
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch("/capital", {
        method: "POST",
        body: JSON.stringify({ accountBalance: Number(balance), riskPercent: Number(risk), leverage: Number(leverage) }),
      }),
    onSuccess: () => {
      toast({ title: "Modal tersimpan ✓" });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["quant-status"] });
    },
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

        {/* Position sizing */}
        {prediction && !editing && (
          <div className="border border-white/10 rounded-lg overflow-hidden">
            <div className="bg-white/5 px-3 py-2 text-xs text-zinc-400 font-medium">Kalkulasi Posisi (Sinyal Aktif)</div>
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
                  <span className={`text-xs font-mono font-medium ${row.green ? "text-emerald-400" : row.red ? "text-red-400" : row.accent ? "text-amber-400" : "text-white"}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
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
    mutationFn: () =>
      apiFetch("/news-api-key", { method: "POST", body: JSON.stringify({ apiKey, provider }) }),
    onSuccess: () => {
      toast({ title: `News API (${provider}) tersimpan ✓` });
      setShowSetup(false);
      qc.invalidateQueries({ queryKey: ["quant-status"] });
    },
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
            <Badge variant="outline" className="text-xs border-white/10 text-zinc-400">
              {apiProvider ?? "rss_fallback"}
            </Badge>
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
            <p className="text-xs text-zinc-400">Rekomendasi: <strong>Finnhub</strong> (gratis), <strong>Polygon</strong> (cepat), <strong>Benzinga</strong> (Bloomberg-like)</p>
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

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function QuantBotPage() {
  const { toast } = useToast();

  const { data: status, isLoading, isError, refetch, dataUpdatedAt } = useQuery<QuantStatus>({
    queryKey: ["quant-status"],
    queryFn: () => apiFetch<QuantStatus>("/status"),
    refetchInterval: 30_000,
    retry: 2,
  });

  const { data: newsData } = useQuery<{ news: QuantStatus["news"]; newsApiProvider: string }>({
    queryKey: ["quant-news"],
    queryFn: () => apiFetch("/news"),
    refetchInterval: 5 * 60_000,
  });

  // Data harga real-time XAUUSD & BTCUSD — dikumpulkan tiap 1 detik
  const { data: live } = useQuery<LivePrices>({
    queryKey: ["quant-live-prices"],
    queryFn: () => apiFetch<LivePrices>("/live-prices"),
    refetchInterval: 1_000,
    retry: false,
  });

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

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

  const ensemble = status?.ensemble;
  const isActive = status?.isActive ?? false;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* ── Header ── */}
      <div className={`sticky top-0 z-40 border-b border-white/10 backdrop-blur-xl bg-zinc-950/90`}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm">
              ← Admin
            </Link>
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
            {isActive && (
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs animate-pulse">
                ● AKTIF
              </Badge>
            )}

            {/* Ticker harga real-time XAUUSD & BTCUSD — update tiap 1 detik */}
            <div className="hidden md:flex items-center gap-3 pl-3 ml-1 border-l border-white/10">
              <LiveTickerPill label="XAU/USD" ticker={live?.xauusd} />
              <LiveTickerPill label="BTC/USD" ticker={live?.btcusd} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Ensemble signal pill */}
            {ensemble && (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${signalBg(ensemble.signal)}`}>
                {ensemble.signal === "BUY" ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> :
                 ensemble.signal === "SELL" ? <ArrowDownRight className="w-4 h-4 text-red-400" /> :
                 <Minus className="w-4 h-4 text-yellow-400" />}
                <span className={`text-sm font-bold ${signalColor(ensemble.signal)}`}>{ensemble.signal}</span>
                <span className="text-xs text-zinc-500">{Math.round(ensemble.confidence * 100)}%</span>
              </div>
            )}

            {lastUpdate && (
              <span className="text-xs text-zinc-600 hidden sm:block">
                {lastUpdate.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}

            <Button
              onClick={() => refetch()}
              disabled={isLoading}
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Ticker mobile — full width di layar kecil */}
        <div className="flex md:hidden items-center justify-around gap-3 px-4 py-2 border-t border-white/5 bg-zinc-950/60">
          <LiveTickerPill label="XAU/USD" ticker={live?.xauusd} />
          <LiveTickerPill label="BTC/USD" ticker={live?.btcusd} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Loading skeleton */}
        {isLoading && !status && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-zinc-900/50 rounded-xl border border-white/5 animate-pulse" />
            ))}
          </div>
        )}

        {/* ── 3 Brain Cards ── */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BrainCard
              type="technical"
              icon={BarChart2}
              title="Technical Brain"
              subtitle="Price action & indicators"
              signal={status.technical?.signal ?? "HOLD"}
              confidence={status.technical?.confidence ?? 0}
              reasoning={status.technical?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
              extraInfo={[
                { label: "Setup", value: status.technical?.keySetup?.substring(0, 25) ?? "—" },
              ]}
              insights={status.technical?.insights ?? 0}
              loading={isLoading}
            />
            <BrainCard
              type="fundamental"
              icon={LineChart}
              title="Fundamental Brain"
              subtitle="Rates, COT & macro drivers"
              signal={status.fundamental?.signal ?? "HOLD"}
              confidence={status.fundamental?.confidence ?? 0}
              reasoning={status.fundamental?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
              extraInfo={[
                { label: "Bias", value: status.fundamental?.fundamentalBias?.substring(0, 25) ?? "—" },
                { label: "Driver", value: status.fundamental?.keyDriver?.substring(0, 20) ?? "—" },
              ]}
              insights={status.fundamental?.insights ?? 0}
              loading={isLoading}
            />
            <BrainCard
              type="macro"
              icon={Globe}
              title="Macro Brain"
              subtitle="DXY, yields & geopolitics"
              signal={status.macro?.signal ?? "HOLD"}
              confidence={status.macro?.confidence ?? 0}
              reasoning={status.macro?.reasoning ?? ["Menunggu siklus belajar pertama..."]}
              extraInfo={[
                { label: "Regime", value: status.macro?.macroRegime ?? "—" },
                { label: "Fed", value: status.macro?.fedBias ?? "—" },
                { label: "Geo Risk", value: status.macro?.geopoliticalRisk ?? "—" },
              ]}
              insights={status.macro?.insights ?? 0}
              loading={isLoading}
            />
          </div>
        )}

        {/* ── Ensemble + Capital ── */}
        {status?.ensemble && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <EnsemblePanel ensemble={status.ensemble} />
            <CapitalPanel capital={status.capital} prediction={status.prediction} />
          </div>
        )}

        {/* ── Psychology + News ── */}
        {status && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {status.psychology ? (
              <PsychologyPanel
                psychology={status.psychology}
                macroNarrative={status.macro?.psychologyNarrative}
              />
            ) : (
              <Card className="border border-white/10 bg-zinc-900/60 flex items-center justify-center min-h-48">
                <div className="text-center text-zinc-600">
                  <Eye className="w-6 h-6 mx-auto mb-2" />
                  <p className="text-sm">Analisis psikologi dalam proses...</p>
                </div>
              </Card>
            )}

            <NewsPanel
              news={newsData?.news ?? status.news ?? []}
              apiProvider={newsData?.newsApiProvider}
            />
          </div>
        )}

        {/* ── Stats footer ── */}
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

        {/* ── Quant not active yet ── */}
        {status && !status.isActive && (
          <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-amber-400 mx-auto mb-3" />
            <h3 className="text-white font-semibold mb-1">Quant Bot Sedang Inisialisasi</h3>
            <p className="text-sm text-zinc-400">3 brain engine sedang memulai siklus belajar pertama. Akan aktif dalam ~1-2 menit.</p>
            <p className="text-xs text-zinc-600 mt-2">Pastikan DeepSeek API key sudah diset di <Link href="/admin/settings" className="text-amber-400 underline">Pengaturan</Link></p>
          </div>
        )}
      </div>
    </div>
  );
}
