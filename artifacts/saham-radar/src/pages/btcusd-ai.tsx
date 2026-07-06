/**
 * BTCUSD AI — Bitcoin Trading Intelligence
 * Full feature parity dengan XAUUSD AI:
 * chart, multi-timeframe, correlation, brain, chat, predictions,
 * win-rate, backtest, learning log, questions, settings, extreme mode
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Bitcoin, Brain, TrendingUp, TrendingDown, Minus, Zap, BookOpen,
  BarChart2, MessageSquare, Activity, ChevronRight, ChevronDown, ChevronUp,
  RefreshCw, Target, AlertTriangle, CheckCircle, CheckCircle2, XCircle,
  Clock, Flame, StopCircle, History, Trophy, Layers, Link2, Settings,
  KeyRound, Loader2, Send,
} from "lucide-react";
import { getMemberToken, getAdminToken } from "@/lib/auth";

// ─── TradingView BTC widget ──────────────────────────────────────────────────
const TV_SYMBOL = "BINANCE:BTCUSDT";

function TradingViewTicker() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({ symbol: TV_SYMBOL, width: "100%", colorTheme: "dark", isTransparent: true, locale: "id" });
    el.appendChild(script);
    return () => { el.innerHTML = ""; };
  }, []);
  return <div className="tradingview-widget-container" ref={containerRef} />;
}

function TradingViewAdvancedChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: TV_SYMBOL, interval: "60", width: "100%", height: "500",
      theme: "dark", style: "1", locale: "id", allow_symbol_change: false,
      calendar: false, support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
    return () => { el.innerHTML = ""; };
  }, []);
  return <div className="tradingview-widget-container" ref={containerRef} style={{ height: 500 }} />;
}

// ─── API helpers ─────────────────────────────────────────────────────────────
const BASE = "/api/btcusd";

async function apiGet<T>(path: string): Promise<T> {
  const token = getMemberToken() ?? getAdminToken() ?? "";
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const token = getMemberToken() ?? getAdminToken() ?? "";
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface LivePrice { price: number; bid: number; ask: number; change: number | null; changePct: number | null; }
interface BrainEntry { id: number; category: string; title: string; content: string; confidence: number; createdAt: string; sourceQuestion?: string | null; }
interface BrainStats {
  totalInsights: number; byCategory: Record<string, number>;
  activeBrainEntries: number; totalQuestionsAsked: number; totalPredictions: number;
  correctPredictions: number; verifiedPredictions: number; predictionAccuracy: number | null;
}
interface Prediction {
  id: number; direction: string; targetPrice: number | null; stopLoss: number | null;
  confidence: number; reasoning: string; priceAtPrediction: number; predictedAt: string;
  verifyAt: string | null; isCorrect: boolean | null; status: string;
  indicatorsAtPrediction: Record<string, unknown> | null;
}
interface QuestionLog { id: number; question: string; answer: string | null; quality: number | null; askedAt: string; savedToBrain: boolean; }
interface LearningLog { id: number; cycleAt: string; priceAtCycle: number | null; questionsAsked: number; insightsSaved: number; spikeDetected: boolean; summary: string | null; durationMs: number | null; }
interface ExtremeMode { active: boolean; target: number; progress: number; insights: number; cycles: number; startedAt: string | null; percentDone: number; stopRequested: boolean; speedQph: number; etaMs: number | null; dataMode: "live" | "historical"; currentStatus: "idle" | "fetching_data" | "generating" | "answering"; currentQuestion: string | null; selectedCategories: string[]; }
interface EngineStatus { running: boolean; lastCycleAt: string | null; totalCycles: number; totalInsights: number; isLearning: boolean; marketOpen: boolean; extremeMode: ExtremeMode; }
interface CalibrationBucket { label: string; min: number; max: number; sampleCount: number; actualWinRate: number | null; }
interface CalibrationResult { calibration: CalibrationBucket[]; totalVerified: number; }
interface FeatureItem { indicator: string; value: string; sampleCount: number; winRate: number; lift: number; }
interface FeatureImportanceResult { features: FeatureItem[]; sampleCount: number; overallWinRate: number | null; minRequired: number; }
interface BtcSettings { hasDeepseekKey: boolean; deepseekKeySource: "database" | "environment" | "none"; validTimeframes: number[]; }
interface BacktestResult {
  rules: { rsiBuy: number; rsiSell: number; requireEmaBullish: boolean; direction: string; maxHoldPeriods: number };
  totalTrades: number; wins: number; losses: number; winRate: number;
  profitFactor: number; maxDrawdown: number; avgWin: number; avgLoss: number;
  totalReturn: number; finalCapital: number; equity: number[];
  trades: Array<{ entryPrice: number; exitPrice: number; direction: string; pnlPct: number; win: boolean; holdPeriods: number; entryAt: string }>;
  dataPoints: number; error?: string;
}
interface BtcCorrelationFactor { key: string; name: string; price: number | null; changePct: number | null; interpretation: string; }
interface BtcCorrelationResponse { btcPrice: number; factors: BtcCorrelationFactor[]; computedAt: string; }
interface TimeframeData { timeframe: string; label: string; indicators: { price: number; rsi14: number | null; trend: string; emaAlignment: string; macdSignalType: string; supportLevel: number | null; resistanceLevel: number | null; } | null; error: string | null; }
interface MultiTimeframeResponse { timeframes: TimeframeData[]; confluence: { agreement: string; bullishCount: number; bearishCount: number; sidewaysCount: number; total: number; }; }

type Tab = "chart" | "overview" | "brain" | "chat" | "predictions" | "ondemand" | "questions" | "log" | "winrate" | "backtest" | "multitimeframe" | "correlation" | "settings" | "extreme";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtBtc(n: number | null | undefined) {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtNum(n: number | null | undefined, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}
function pct(n: number | null) { if (n == null) return "–"; const s = n >= 0 ? "+" : ""; return `${s}${n.toFixed(2)}%`; }
function fmtDate(d: string) { return new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}
function rsiColor(v: number | null) {
  if (v == null) return "text-muted-foreground";
  if (v > 70) return "text-red-400";
  if (v < 30) return "text-emerald-400";
  return "text-foreground";
}
function trendBadge(t: string) {
  if (t === "bullish") return <span className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-medium">Bullish ▲</span>;
  if (t === "bearish") return <span className="text-xs px-2 py-0.5 rounded-md bg-red-500/15 text-red-400 font-medium">Bearish ▼</span>;
  return <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 font-medium">Sideways ↔</span>;
}

const CATEGORY_COLOR: Record<string, string> = {
  teknikal: "text-blue-400",
  onchain: "text-orange-400",
  makro: "text-purple-400",
  psikologi: "text-yellow-400",
  manajemen_risiko: "text-red-400",
  crypto_ekosistem: "text-emerald-400",
  umum: "text-muted-foreground",
};

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BtcusdAi() {
  const [activeTab, setActiveTab] = useState<Tab>("chart");
  const { toast } = useToast();
  const qc = useQueryClient();

  const priceQ = useQuery({ queryKey: ["btc-price"], queryFn: () => apiGet<LivePrice>("/live-price"), refetchInterval: 2000 });
  const statusQ = useQuery({ queryKey: ["btc-status"], queryFn: () => apiGet<EngineStatus>("/engine-status"), refetchInterval: 10000 });
  const statsQ = useQuery({ queryKey: ["btc-stats"], queryFn: () => apiGet<BrainStats>("/brain/stats"), refetchInterval: 20000 });
  const snapshotQ = useQuery({ queryKey: ["btc-snapshot"], queryFn: () => apiGet<Record<string, unknown>>("/snapshot"), refetchInterval: 60000 });
  const brainQ = useQuery({ queryKey: ["btc-brain"], queryFn: () => apiGet<BrainEntry[]>("/brain?limit=80") });
  const predsQ = useQuery({ queryKey: ["btc-preds"], queryFn: () => apiGet<Prediction[]>("/predictions?limit=50"), refetchInterval: 60000 });
  const questionsQ = useQuery({ queryKey: ["btc-questions"], queryFn: () => apiGet<QuestionLog[]>("/questions?limit=30"), refetchInterval: 60000 });
  const logQ = useQuery({ queryKey: ["btc-log"], queryFn: () => apiGet<LearningLog[]>("/learning-log?limit=30"), refetchInterval: 30000 });
  const multiTfQ = useQuery({ queryKey: ["btc-multitf"], queryFn: () => apiGet<MultiTimeframeResponse>("/multi-timeframe"), refetchInterval: 60000 });
  const corrQ = useQuery({ queryKey: ["btc-corr"], queryFn: () => apiGet<BtcCorrelationResponse>("/correlation"), refetchInterval: 60000 });
  const settingsQ = useQuery({ queryKey: ["btc-settings"], queryFn: () => apiGet<BtcSettings>("/settings"), refetchInterval: 30000 });

  const price = priceQ.data;
  const status = statusQ.data;
  const em = status?.extremeMode;

  const learnNowM = useMutation({
    mutationFn: () => apiPost("/learn-now"),
    onSuccess: () => {
      toast({ title: "✅ Siklus Pembelajaran Selesai", description: "AI menyelesaikan 1 siklus belajar." });
      void qc.invalidateQueries({ queryKey: ["btc-brain"] });
      void qc.invalidateQueries({ queryKey: ["btc-stats"] });
      void qc.invalidateQueries({ queryKey: ["btc-questions"] });
      void qc.invalidateQueries({ queryKey: ["btc-log"] });
      void qc.invalidateQueries({ queryKey: ["btc-preds"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const saveKeyM = useMutation({
    mutationFn: (apiKey: string) => apiPost("/settings/deepseek-key", { apiKey }),
    onSuccess: () => {
      toast({ title: "✅ API Key Disimpan" });
      void qc.invalidateQueries({ queryKey: ["btc-settings"] });
    },
  });

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chart", label: "Chart TradingView", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "overview", label: "Indikator Live", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "multitimeframe", label: "Multi-Timeframe", icon: <Layers className="w-3.5 h-3.5" /> },
    { id: "correlation", label: "Korelasi Makro", icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: "brain", label: `Otak AI (${statsQ.data?.activeBrainEntries ?? 0})`, icon: <Brain className="w-3.5 h-3.5" /> },
    { id: "chat", label: "Chat AI", icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: "predictions", label: `Prediksi (${statsQ.data?.totalPredictions ?? 0})`, icon: <Target className="w-3.5 h-3.5" /> },
    { id: "ondemand", label: "Prediksi On-Demand", icon: <Zap className="w-3.5 h-3.5" /> },
    { id: "questions", label: `Q&A (${statsQ.data?.totalQuestionsAsked ?? 0})`, icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: "log", label: `Log Belajar`, icon: <History className="w-3.5 h-3.5" /> },
    { id: "winrate", label: "Win Rate", icon: <Trophy className="w-3.5 h-3.5" /> },
    { id: "backtest", label: "Backtest", icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { id: "settings", label: "Pengaturan", icon: <Settings className="w-3.5 h-3.5" /> },
    { id: "extreme", label: "Mode Ekstrem", icon: <Flame className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shadow-[0_0_16px_rgba(249,115,22,0.2)]">
            <Bitcoin className="w-6 h-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">BTC AI Trader</h1>
            <p className="text-xs text-muted-foreground">Bitcoin Intelligence · 24/7 · Powered by DeepSeek</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Engine pill */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${status?.running ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${status?.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {status?.running ? `Brain aktif · ${status.totalCycles} siklus` : "Brain berhenti"}
          </div>

          <Button
            variant="outline" size="sm"
            onClick={() => learnNowM.mutate()}
            disabled={learnNowM.isPending}
            className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
          >
            {learnNowM.isPending
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Belajar...</>
              : <><Zap className="w-3.5 h-3.5 mr-1.5" />Belajar Sekarang</>}
          </Button>
        </div>
      </div>

      {/* Live ticker from TradingView */}
      <Card className="border border-orange-500/20 bg-gradient-to-r from-orange-500/5 to-orange-600/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">BTCUSD / Harga Bitcoin (TradingView · Binance)</p>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE
            </span>
          </div>
          <TradingViewTicker />
        </CardContent>
      </Card>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Insights Otak", value: statsQ.data?.activeBrainEntries ?? 0, color: "text-orange-400" },
          { label: "Q&A Total", value: statsQ.data?.totalQuestionsAsked ?? 0, color: "text-blue-400" },
          { label: "Prediksi", value: statsQ.data?.totalPredictions ?? 0, color: "text-purple-400" },
          {
            label: "Akurasi",
            value: statsQ.data?.predictionAccuracy != null ? `${statsQ.data.predictionAccuracy}%` : "—",
            color: "text-emerald-400",
          },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/40 rounded-xl px-4 py-3">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${activeTab === t.id ? "bg-orange-500/15 border border-orange-500/25 text-orange-400" : "bg-muted/30 border border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "chart" && (
        <div className="bg-card border border-border/40 rounded-2xl overflow-hidden">
          <TradingViewAdvancedChart />
        </div>
      )}
      {activeTab === "overview" && <OverviewTab snapshot={snapshotQ.data} status={status} price={price} />}
      {activeTab === "multitimeframe" && <MultiTimeframeTab data={multiTfQ.data} isLoading={multiTfQ.isLoading} />}
      {activeTab === "correlation" && <CorrelationTab data={corrQ.data} isLoading={corrQ.isLoading} />}
      {activeTab === "brain" && <BrainTab entries={brainQ.data ?? []} stats={statsQ.data} />}
      {activeTab === "chat" && <ChatTab />}
      {activeTab === "predictions" && <PredictionsTab preds={predsQ.data ?? []} />}
      {activeTab === "ondemand" && <div className="bg-card border border-border/40 rounded-2xl p-5"><OnDemandPredictionTab /></div>}
      {activeTab === "questions" && <QuestionsTab questions={questionsQ.data ?? []} />}
      {activeTab === "log" && <LearningLogTab logs={logQ.data ?? []} />}
      {activeTab === "winrate" && <WinrateTab preds={predsQ.data ?? []} />}
      {activeTab === "backtest" && <BacktestTab />}
      {activeTab === "settings" && (
        <SettingsTab
          settings={settingsQ.data}
          onSaveKey={(k) => saveKeyM.mutate(k)}
          savingKey={saveKeyM.isPending}
          toast={toast}
          qc={qc}
        />
      )}
      {activeTab === "extreme" && (
        <ExtremeTab em={em} onRefresh={() => void qc.invalidateQueries({ queryKey: ["btc-status"] })} toast={toast} />
      )}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ snapshot, status, price }: { snapshot: Record<string, unknown> | undefined; status: EngineStatus | undefined; price: LivePrice | undefined }) {
  const brainQ = useQuery({ queryKey: ["btc-brain-top"], queryFn: () => apiGet<BrainEntry[]>("/brain?limit=5"), select: d => d.slice(0, 5) });
  const predsQ = useQuery({ queryKey: ["btc-preds-latest"], queryFn: () => apiGet<Prediction[]>("/predictions?limit=3"), select: d => d.slice(0, 3) });

  const s = snapshot as Record<string, number | string | null> | undefined;

  return (
    <div className="space-y-5">
      {/* Indicator grid */}
      {s && (
        <div className="bg-card border border-border/40 rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />Indikator Teknikal Live</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
            {[
              { label: "Harga", value: fmtBtc(s.price as number) },
              { label: "RSI14", value: fmtNum(s.rsi14 as number, 1), colorClass: rsiColor(s.rsi14 as number) },
              { label: "EMA9", value: fmtBtc(s.ema9 as number) },
              { label: "EMA21", value: fmtBtc(s.ema21 as number) },
              { label: "EMA50", value: fmtBtc(s.ema50 as number) },
              { label: "EMA200", value: fmtBtc(s.ema200 as number) },
              { label: "MACD", value: String(s.macdSignalType ?? "—").replace(/_/g, " ") },
              { label: "EMA Alignment", value: String(s.emaAlignment ?? "—").replace(/_/g, " ") },
              { label: "BB Upper", value: fmtBtc(s.bbUpper as number) },
              { label: "BB Lower", value: fmtBtc(s.bbLower as number) },
              { label: "ATR14", value: fmtBtc(s.atr14 as number) },
              { label: "Support", value: fmtBtc(s.supportLevel as number) },
              { label: "Resistance", value: fmtBtc(s.resistanceLevel as number) },
              { label: "Trend", value: String(s.trend ?? "—") },
            ].map(item => (
              <div key={item.label} className="bg-muted/20 rounded-lg p-2.5 border border-border/30">
                <div className="text-muted-foreground mb-0.5">{item.label}</div>
                <div className={`font-semibold ${item.colorClass ?? "text-foreground/90"}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Engine info */}
        <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />Status Engine</h3>
          <div className="space-y-1.5 text-sm">
            {[
              ["Status", <span className={status?.running ? "text-emerald-400" : "text-red-400"}>{status?.running ? "Berjalan" : "Mati"}</span>],
              ["Market BTC", <span className="text-emerald-400">● Buka 24/7</span>],
              ["Total Siklus", status?.totalCycles ?? 0],
              ["Total Insights", status?.totalInsights ?? 0],
              ["Sedang Belajar", status?.isLearning ? <span className="text-orange-400 animate-pulse">YA</span> : "Tidak"],
              ["Siklus Terakhir", status?.lastCycleAt ? timeAgo(status.lastCycleAt) : "—"],
              ["Harga BTC", price ? fmtBtc(price.price) : "—"],
            ].map(([label, value], i) => (
              <div key={i} className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-foreground/80">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Latest predictions */}
        <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-orange-400" />Prediksi Terbaru</h3>
          {predsQ.data?.map(p => (
            <div key={p.id} className="p-3 bg-muted/20 rounded-xl border border-border/30 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={`flex items-center gap-1 text-sm font-semibold ${p.direction === "up" ? "text-emerald-400" : p.direction === "down" ? "text-red-400" : "text-yellow-400"}`}>
                  {p.direction === "up" ? <TrendingUp className="w-3.5 h-3.5" /> : p.direction === "down" ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                  {p.direction.toUpperCase()}
                </span>
                <div className="flex items-center gap-2">
                  {p.isCorrect === true && <span className="text-xs text-emerald-400 flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />Benar</span>}
                  {p.isCorrect === false && <span className="text-xs text-red-400 flex items-center gap-0.5"><AlertTriangle className="w-3 h-3" />Salah</span>}
                  <span className="text-xs text-muted-foreground">{Math.round(p.confidence * 100)}%</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{p.reasoning}</p>
              <div className="flex gap-3 text-xs">
                {p.targetPrice && <span className="text-emerald-400">Target: {fmtBtc(p.targetPrice)}</span>}
                {p.stopLoss && <span className="text-red-400">SL: {fmtBtc(p.stopLoss)}</span>}
              </div>
            </div>
          ))}
          {!predsQ.data?.length && <p className="text-sm text-muted-foreground">Belum ada prediksi.</p>}
        </div>
      </div>

      {/* Top insights */}
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-orange-400" />Top Insights Otak AI</h3>
        <div className="space-y-2">
          {brainQ.data?.map(b => (
            <div key={b.id} className="p-3 bg-muted/20 rounded-xl border border-border/30">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium capitalize ${CATEGORY_COLOR[b.category] ?? "text-muted-foreground"}`}>{b.category.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">{Math.round(b.confidence * 100)}%</span>
              </div>
              <p className="text-xs font-medium text-foreground/90">{b.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.content}</p>
            </div>
          ))}
          {!brainQ.data?.length && <p className="text-sm text-muted-foreground">AI belum belajar. Jalankan learning cycle.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Multi-Timeframe Tab ───────────────────────────────────────────────────────
function MultiTimeframeTab({ data, isLoading }: { data: MultiTimeframeResponse | undefined; isLoading: boolean }) {
  if (isLoading && !data) return <div className="text-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  if (!data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Gagal memuat data multi-timeframe.</p>
    </div>
  );

  const confluenceColor = data.confluence.agreement.toLowerCase().includes("bullish")
    ? "text-emerald-400" : data.confluence.agreement.toLowerCase().includes("bearish")
    ? "text-red-400" : "text-amber-400";

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Membandingkan tren, RSI, dan struktur EMA di tiga timeframe (1 Jam, 4 Jam, Harian) untuk melihat apakah sinyal saling mendukung (confluence).
      </p>
      <div className="rounded-lg p-4 border border-orange-500/30 bg-orange-500/5 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Kesimpulan Confluence</p>
        <p className={`text-2xl font-bold ${confluenceColor}`}>{data.confluence.agreement}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {data.confluence.bullishCount} bullish · {data.confluence.bearishCount} bearish · {data.confluence.sidewaysCount} sideways
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {data.timeframes.map(tf => (
          <div key={tf.timeframe} className="bg-card/40 rounded-lg border border-border/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">{tf.label} ({tf.timeframe})</h4>
              {tf.indicators && trendBadge(tf.indicators.trend)}
            </div>
            {tf.indicators ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Harga</span><span className="font-medium">{fmtBtc(tf.indicators.price)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RSI14</span><span className={`font-medium ${rsiColor(tf.indicators.rsi14)}`}>{fmtNum(tf.indicators.rsi14, 1)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">EMA Alignment</span><span className="font-medium">{tf.indicators.emaAlignment.replace(/_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">MACD</span><span className="font-medium">{tf.indicators.macdSignalType.replace(/_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Support</span><span className="font-medium text-emerald-400">{fmtBtc(tf.indicators.supportLevel)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Resistance</span><span className="font-medium text-red-400">{fmtBtc(tf.indicators.resistanceLevel)}</span></div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{tf.error ?? "Data tidak tersedia."}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Correlation Tab ──────────────────────────────────────────────────────────
function CorrelationTab({ data, isLoading }: { data: BtcCorrelationResponse | undefined; isLoading: boolean }) {
  if (isLoading && !data) return <div className="text-center py-16 text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  if (!data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Link2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Gagal memuat data korelasi.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        AI mempertimbangkan pergerakan DXY (Dollar Index), Nasdaq (QQQ), dan ETH sebagai faktor makro yang berpengaruh pada harga Bitcoin.
        Harga BTC saat ini: <span className="text-orange-400 font-medium">{fmtBtc(data.btcPrice)}</span>
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {data.factors.map(f => (
          <div key={f.key} className="bg-card/40 rounded-lg border border-border/50 p-4">
            <h4 className="text-sm font-semibold mb-3">{f.name}</h4>
            <div className="space-y-2 mb-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Harga</span>
                <span className="font-medium">{f.price != null ? f.price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Perubahan</span>
                <span className={`font-medium ${(f.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {f.changePct != null ? `${f.changePct >= 0 ? "+" : ""}${f.changePct.toFixed(2)}%` : "—"}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed italic">{f.interpretation}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground text-right">Dihitung: {new Date(data.computedAt).toLocaleString("id-ID")}</p>
    </div>
  );
}

// ─── Brain Tab ────────────────────────────────────────────────────────────────
function BrainTab({ entries, stats }: { entries: BrainEntry[]; stats: BrainStats | undefined }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const featureQ = useQuery({
    queryKey: ["btc-feature-importance"],
    queryFn: () => apiGet<FeatureImportanceResult>("/feature-importance"),
    staleTime: 5 * 60_000,
  });

  const byCategory = stats?.byCategory ?? {};

  return (
    <div className="space-y-6">
      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(byCategory).map(([cat, count]) => (
            <div key={cat} className="bg-card/40 border border-border/40 rounded-lg px-3 py-2 text-xs">
              <span className={`font-medium capitalize ${CATEGORY_COLOR[cat] ?? "text-muted-foreground"}`}>{cat.replace(/_/g, " ")}</span>
              <span className="ml-1.5 text-muted-foreground">({count})</span>
            </div>
          ))}
        </div>
      )}

      {/* Feature importance */}
      {featureQ.data && featureQ.data.sampleCount >= featureQ.data.minRequired && featureQ.data.features.length > 0 && (
        <div className="bg-card border border-border/40 rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">🏆 Feature Importance — Indikator Paling Prediktif</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Win rate keseluruhan: <span className="font-medium text-foreground">{featureQ.data.overallWinRate?.toFixed(1) ?? "—"}%</span> dari {featureQ.data.sampleCount} prediksi terverifikasi.
          </p>
          <div className="space-y-1.5">
            {featureQ.data.features.slice(0, 10).map(f => (
              <div key={`${f.indicator}-${f.value}`} className="flex items-center gap-3 text-xs">
                <span className="w-28 text-muted-foreground shrink-0 truncate">{f.indicator}</span>
                <span className="w-24 truncate">{f.value.replace(/_/g, " ")}</span>
                <div className="flex-1 bg-muted/30 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${(f.lift ?? 0) >= 0 ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${Math.min(100, Math.abs(f.lift ?? 0) * 2)}%` }} />
                </div>
                <span className={`w-14 text-right font-medium ${(f.lift ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>{(f.lift ?? 0) >= 0 ? "+" : ""}{(f.lift ?? 0).toFixed(1)}%</span>
                <span className="w-10 text-right text-muted-foreground">{f.winRate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brain entries */}
      <div>
        <p className="text-sm text-muted-foreground mb-3">{entries.length} insights aktif di otak AI Bitcoin</p>
        <div className="space-y-2">
          {entries.map(b => (
            <div key={b.id} className="bg-card border border-border/40 rounded-xl p-4 cursor-pointer hover:border-orange-500/20 transition-colors" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium capitalize ${CATEGORY_COLOR[b.category] ?? "text-muted-foreground"}`}>{b.category.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{Math.round(b.confidence * 100)}% conf</span>
                  </div>
                  <p className="text-sm font-medium text-foreground">{b.title}</p>
                  {expanded === b.id
                    ? <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{b.content}</p>
                    : <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.content}</p>}
                </div>
                <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded === b.id ? "rotate-90" : ""}`} />
              </div>
            </div>
          ))}
          {!entries.length && (
            <div className="text-center py-16 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>Otak BTC AI masih kosong. Tunggu beberapa siklus belajar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Chat Tab ─────────────────────────────────────────────────────────────────
function ChatTab() {
  const [messages, setMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(m => [...m, { role: "user", text: userMsg }]);
    setLoading(true);
    try {
      const token = getMemberToken() ?? getAdminToken() ?? "";
      const res = await fetch(`${BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      setMessages(m => [...m, { role: "ai", text: data.reply ?? data.error ?? "Error" }]);
    } catch {
      setMessages(m => [...m, { role: "ai", text: "Gagal terhubung ke AI." }]);
    } finally { setLoading(false); }
  }

  const suggestions = [
    "Analisis kondisi BTC saat ini, apakah bagus untuk beli?",
    "Jelaskan dampak halving BTC terhadap harga jangka panjang",
    "Bagaimana membaca RSI dan EMA untuk entry BTC yang optimal?",
  ];

  return (
    <div className="bg-card border border-border/40 rounded-2xl flex flex-col" style={{ height: "65vh" }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-4">
            <div className="text-center py-8 text-muted-foreground">
              <Bitcoin className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Tanya BTC AI Expert tentang Bitcoin, crypto, dan strategi trading</p>
            </div>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setInput(s); }} className="w-full text-left text-xs px-3 py-2 bg-muted/20 border border-border/30 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-orange-500/20 text-foreground" : "bg-muted/40 text-foreground/90"}`}>
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted/40 rounded-2xl px-4 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> DeepSeek R1 sedang berpikir...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="border-t border-border/40 p-3 flex gap-2">
        <textarea
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Tanya BTC AI... (Enter kirim, Shift+Enter baris baru)"
          className="flex-1 bg-muted/30 border border-border/50 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-orange-500/40"
          rows={2}
        />
        <Button onClick={() => void send()} disabled={loading || !input.trim()} className="bg-orange-500/80 hover:bg-orange-500 text-white self-end">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── On-Demand Prediction Tab (BTC) ───────────────────────────────────────────
interface OnDemandResult {
  direction: "up" | "down" | "sideways";
  targetPrice: number;
  tp2?: number | null;
  tp3?: number | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  stopLoss?: number | null;
  confidence: number;
  reasoning: string;
  mode: "normal" | "technical" | "fundamental";
  priceAtPrediction: number;
  generatedAt: string;
  aiPowered: boolean;
}

type PredictState = { status: "idle" | "loading" | "done" | "error"; data: OnDemandResult | null; error: string | null };

const BTC_PRED_MODES = [
  { id: "normal" as const, label: "Normal", icon: "🤖", accent: "orange" },
  { id: "technical" as const, label: "Teknikal", icon: "📊", accent: "blue" },
  { id: "fundamental" as const, label: "Fundamental", icon: "🌐", accent: "purple" },
];

function OnDemandPredictionTab() {
  const [activeMode, setActiveMode] = useState<"normal" | "technical" | "fundamental">("normal");
  const [states, setStates] = useState<Record<string, PredictState>>({
    normal:      { status: "idle", data: null, error: null },
    technical:   { status: "idle", data: null, error: null },
    fundamental: { status: "idle", data: null, error: null },
  });

  const fetchMode = async (mode: "normal" | "technical" | "fundamental") => {
    setStates(s => ({ ...s, [mode]: { status: "loading", data: null, error: null } }));
    try {
      const result = await apiPost<OnDemandResult>("/predict", { mode });
      setStates(s => ({ ...s, [mode]: { status: "done", data: result, error: null } }));
    } catch (e) {
      setStates(s => ({ ...s, [mode]: { status: "error", data: null, error: String(e) } }));
    }
  };

  // auto-generate all 3 on mount
  useEffect(() => {
    fetchMode("normal");
    fetchMode("technical");
    fetchMode("fundamental");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirLabel = (d: string) => d === "up" ? "▲ NAIK" : d === "down" ? "▼ TURUN" : "↔ SIDEWAYS";
  const dirCls = (d: string) =>
    d === "up" ? "text-emerald-400" : d === "down" ? "text-red-400" : "text-yellow-400";
  const borderCls = (d: string) =>
    d === "up" ? "border-emerald-500/40 bg-emerald-500/5"
    : d === "down" ? "border-red-500/40 bg-red-500/5"
    : "border-yellow-500/40 bg-yellow-500/5";
  const badgeCls = (d: string) =>
    d === "up" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
    : d === "down" ? "border-red-500/40 text-red-400 bg-red-500/10"
    : "border-yellow-500/40 text-yellow-400 bg-yellow-500/10";

  const accentTabCls: Record<string, string> = {
    orange: "border-orange-500 text-orange-400 bg-orange-500/10",
    blue:   "border-blue-500 text-blue-400 bg-blue-500/10",
    purple: "border-purple-500 text-purple-400 bg-purple-500/10",
  };
  const accentTabInactive: Record<string, string> = {
    orange: "hover:text-orange-400/70",
    blue:   "hover:text-blue-400/70",
    purple: "hover:text-purple-400/70",
  };

  const current = states[activeMode];
  const m = BTC_PRED_MODES.find(x => x.id === activeMode)!;
  const loadingCount = Object.values(states).filter(s => s.status === "loading").length;
  const doneCount    = Object.values(states).filter(s => s.status === "done").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Prediksi On-Demand BTC/USD</p>
          <p className="text-xs text-muted-foreground">
            {loadingCount > 0
              ? `Menganalisis ${loadingCount} prediksi...`
              : doneCount === 3
              ? "Semua prediksi selesai · Pilih tab untuk lihat detail"
              : "Prediksi AI realtime — tidak disimpan ke database"}
          </p>
        </div>
        <button
          onClick={() => { fetchMode("normal"); fetchMode("technical"); fetchMode("fundamental"); }}
          disabled={loadingCount > 0}
          className="flex items-center gap-1.5 h-7 px-3 text-xs border border-border/40 rounded-lg bg-card/50 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loadingCount > 0 ? "animate-spin" : ""}`} />
          Refresh Semua
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border border-border/40 rounded-xl p-1 bg-card/30">
        {BTC_PRED_MODES.map((pm) => {
          const s = states[pm.id];
          const isActive = activeMode === pm.id;
          return (
            <button
              key={pm.id}
              onClick={() => setActiveMode(pm.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? accentTabCls[pm.accent]
                  : `text-muted-foreground border border-transparent ${accentTabInactive[pm.accent]}`
              }`}
            >
              <span>{pm.icon}</span>
              <span>{pm.label}</span>
              {s.status === "loading" && <RefreshCw className="w-3 h-3 animate-spin" />}
              {s.status === "done" && s.data && (
                <span className={`text-[9px] font-bold ${dirCls(s.data.direction)}`}>
                  {s.data.direction === "up" ? "▲" : s.data.direction === "down" ? "▼" : "↔"}
                </span>
              )}
              {s.status === "error" && <span className="text-red-400 text-[10px]">!</span>}
            </button>
          );
        })}
      </div>

      {/* Content area */}
      {current.status === "loading" && (
        <div className="rounded-xl border border-border/30 bg-card/30 p-10 flex flex-col items-center gap-3">
          <RefreshCw className="w-7 h-7 animate-spin text-orange-400" />
          <p className="text-sm text-muted-foreground">AI sedang menganalisis mode <span className="font-medium text-foreground">{m.label}</span>…</p>
        </div>
      )}

      {current.status === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
          <p className="text-sm text-red-400 font-medium">⚠️ Gagal memuat prediksi {m.label}</p>
          <p className="text-xs text-red-400/70">{current.error}</p>
          <button
            onClick={() => fetchMode(m.id)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-border/40 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" />Coba Lagi
          </button>
        </div>
      )}

      {current.status === "done" && current.data && (() => {
        const r = current.data;
        return (
          <div className={`rounded-xl border-2 p-5 space-y-4 ${borderCls(r.direction)}`}>
            {/* Header */}
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-2xl font-bold ${dirCls(r.direction)}`}>{dirLabel(r.direction)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badgeCls(r.direction)}`}>
                    {(r.confidence * 100).toFixed(0)}% confidence
                  </span>
                  {r.aiPowered
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400">🤖 AI</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/10 border border-slate-500/20 text-slate-400">📏 Rule</span>
                  }
                </div>
                <p className="text-xs text-muted-foreground">@ ${r.priceAtPrediction.toLocaleString()} · {new Date(r.generatedAt).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>

            {/* Trade levels */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              {r.entryLow != null && r.entryHigh != null && (
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5">
                  <p className="text-blue-400/70 mb-0.5">Entry Zone</p>
                  <p className="font-semibold text-blue-300">${r.entryLow.toLocaleString()} – ${r.entryHigh.toLocaleString()}</p>
                </div>
              )}
              {r.stopLoss != null && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5">
                  <p className="text-red-400/70 mb-0.5">Stop Loss</p>
                  <p className="font-semibold text-red-300">${r.stopLoss.toLocaleString()}</p>
                </div>
              )}
              {r.targetPrice != null && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                  <p className="text-emerald-400/70 mb-0.5">TP1</p>
                  <p className="font-semibold text-emerald-300">${r.targetPrice.toLocaleString()}</p>
                </div>
              )}
              {r.tp2 != null && r.tp2 !== r.targetPrice && (
                <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/15 p-2.5">
                  <p className="text-emerald-400/60 mb-0.5">TP2</p>
                  <p className="font-semibold text-emerald-300/70">${r.tp2.toLocaleString()}</p>
                </div>
              )}
              {r.tp3 != null && r.tp3 !== r.targetPrice && (
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-2.5">
                  <p className="text-emerald-400/50 mb-0.5">TP3</p>
                  <p className="font-semibold text-emerald-300/50">${r.tp3.toLocaleString()}</p>
                </div>
              )}
            </div>

            {/* Reasoning */}
            <div className="rounded-lg bg-card/50 border border-border/30 p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Alasan Prediksi</p>
              <p className="text-xs text-foreground/80 leading-relaxed">{r.reasoning}</p>
            </div>

            <p className="text-[10px] text-muted-foreground/60 text-center">
              ⚠️ Bukan saran keuangan. Selalu gunakan manajemen risiko.
            </p>
          </div>
        );
      })()}

      {current.status === "idle" && (
        <div className="rounded-xl border border-border/30 bg-card/30 p-8 text-center text-sm text-muted-foreground">
          Prediksi belum dimuat.
        </div>
      )}
    </div>
  );
}

// ─── Predictions Tab ──────────────────────────────────────────────────────────
function PredictionsTab({ preds }: { preds: Prediction[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{preds.length} prediksi terbaru · BTC 4H</p>
      {preds.map(p => (
        <div key={p.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-2 cursor-pointer hover:border-orange-500/20 transition-colors" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 font-semibold text-sm ${p.direction === "up" ? "text-emerald-400" : p.direction === "down" ? "text-red-400" : "text-yellow-400"}`}>
                {p.direction === "up" ? <TrendingUp className="w-4 h-4" /> : p.direction === "down" ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                {p.direction.toUpperCase()}
              </span>
              <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-md text-muted-foreground">{Math.round(p.confidence * 100)}%</span>
              {p.isCorrect === true && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Benar</span>}
              {p.isCorrect === false && <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3" />Salah</span>}
              {p.status === "pending" && <span className="text-xs text-yellow-400/70 flex items-center gap-1"><Clock className="w-3 h-3" />Pending</span>}
            </div>
            <span className="text-xs text-muted-foreground">{fmtDate(p.predictedAt)}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{p.reasoning?.slice(0, 200)}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span>Entry: {fmtBtc(p.priceAtPrediction)}</span>
            {p.targetPrice && <span className="text-emerald-400">Target: {fmtBtc(p.targetPrice)}</span>}
            {p.stopLoss && <span className="text-red-400">SL: {fmtBtc(p.stopLoss)}</span>}
          </div>
          {expanded === p.id && p.reasoning && (
            <p className="text-xs text-muted-foreground border-t border-border/30 pt-2 whitespace-pre-wrap">{p.reasoning}</p>
          )}
        </div>
      ))}
      {!preds.length && (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Belum ada prediksi BTC.</p>
        </div>
      )}
    </div>
  );
}

// ─── Questions Tab ────────────────────────────────────────────────────────────
function QuestionsTab({ questions }: { questions: QuestionLog[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{questions.length} pertanyaan terakhir dikirim ke DeepSeek R1</p>
      {questions.map(q => (
        <div key={q.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${q.savedToBrain ? "text-orange-400" : "text-muted-foreground"}`}>
              {q.savedToBrain ? "✓ Disimpan ke brain" : "Tidak disimpan"}
            </span>
            <span className="text-xs text-muted-foreground">
              {q.quality != null ? `${Math.round(q.quality * 100)}%` : ""} · {fmtDate(q.askedAt)}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground/90">{q.question}</p>
          {q.answer && <p className="text-xs text-muted-foreground line-clamp-3">{q.answer}</p>}
        </div>
      ))}
      {!questions.length && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Belum ada pertanyaan yang dikirim ke AI.</p>
        </div>
      )}
    </div>
  );
}

// ─── Learning Log Tab ─────────────────────────────────────────────────────────
function LearningLogTab({ logs }: { logs: LearningLog[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{logs.length} siklus belajar terakhir</p>
      {logs.map(l => (
        <div key={l.id} className="bg-card border border-border/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {l.spikeDetected && <span className="text-xs text-orange-400 font-medium">⚡ Spike</span>}
              <span className="text-xs text-muted-foreground">{fmtDate(l.cycleAt)}</span>
            </div>
            <span className="text-xs text-muted-foreground">{l.durationMs ? `${(l.durationMs / 1000).toFixed(1)}s` : "—"}</span>
          </div>
          <div className="flex gap-4 text-xs">
            <span>Harga: <span className="text-foreground font-medium">{fmtBtc(l.priceAtCycle)}</span></span>
            <span>Q: <span className="text-blue-400 font-medium">{l.questionsAsked}</span></span>
            <span>Insights: <span className="text-orange-400 font-medium">{l.insightsSaved}</span></span>
          </div>
          {l.summary && <p className="text-xs text-muted-foreground mt-1">{l.summary}</p>}
        </div>
      ))}
      {!logs.length && (
        <div className="text-center py-16 text-muted-foreground">
          <History className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Belum ada siklus belajar yang tercatat.</p>
        </div>
      )}
    </div>
  );
}

// ─── Win Rate Tab ─────────────────────────────────────────────────────────────
function WinrateTab({ preds }: { preds: Prediction[] }) {
  const calibQ = useQuery({
    queryKey: ["btc-confidence-calibration"],
    queryFn: () => apiGet<CalibrationResult>("/confidence-calibration"),
    staleTime: 5 * 60_000,
  });

  const verified = preds.filter(p => p.status === "verified");
  const correct = verified.filter(p => p.isCorrect === true);
  const wrong = verified.filter(p => p.isCorrect === false);
  const totalWinRate = verified.length > 0 ? Math.round(correct.length / verified.length * 100) : null;

  const byDir = (dir: string) => {
    const v = verified.filter(p => p.direction === dir);
    const c = v.filter(p => p.isCorrect === true).length;
    return { total: v.length, correct: c, pct: v.length > 0 ? Math.round(c / v.length * 100) : null };
  };
  const up = byDir("up"); const down = byDir("down"); const side = byDir("sideways");

  // Streak
  let streak = 0, streakType: "win" | "loss" | null = null;
  for (const p of verified) {
    if (streakType === null) { streakType = p.isCorrect ? "win" : "loss"; streak = 1; }
    else if ((p.isCorrect && streakType === "win") || (!p.isCorrect && streakType === "loss")) streak++;
    else break;
  }

  if (verified.length === 0) return (
    <div className="text-center py-16 text-muted-foreground">
      <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Belum ada prediksi terverifikasi.</p>
      <p className="text-xs mt-1">AI perlu membuat prediksi dan menunggu 4 jam untuk verifikasi.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Win Rate BTC</p>
        {totalWinRate !== null ? (
          <p className={`text-7xl font-black ${totalWinRate >= 60 ? "text-emerald-400" : totalWinRate >= 40 ? "text-amber-400" : "text-red-400"}`}>{totalWinRate}%</p>
        ) : <p className="text-4xl font-bold text-muted-foreground">—</p>}
        <p className="text-sm text-muted-foreground mt-1">{correct.length} benar dari {verified.length} prediksi terverifikasi</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Menang ✓", value: correct.length, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
          { label: "Kalah ✗", value: wrong.length, color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
          { label: "Pending ⏳", value: preds.filter(p => p.status === "pending").length, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
        ].map(s => (
          <div key={s.label} className={`rounded-lg p-3 border text-center ${s.bg}`}>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {streakType && streak > 1 && (
        <div className={`rounded-lg p-3 border text-center ${streakType === "win" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
          <p className="text-sm font-medium">
            {streakType === "win" ? "🔥" : "❄️"} Streak: <span className={`font-bold ${streakType === "win" ? "text-emerald-400" : "text-red-400"}`}>{streak} {streakType === "win" ? "kemenangan" : "kekalahan"} berturut-turut</span>
          </p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Win Rate per Arah</p>
        <div className="space-y-3">
          {[
            { label: "▲ UP (Bullish)", data: up, color: "bg-emerald-500" },
            { label: "▼ DOWN (Bearish)", data: down, color: "bg-red-500" },
            { label: "↔ SIDEWAYS", data: side, color: "bg-amber-500" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <p className="text-xs w-36 text-muted-foreground shrink-0">{item.label}</p>
              <div className="flex-1 bg-muted/30 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full transition-all ${item.color}`} style={{ width: `${item.data.pct ?? 0}%` }} />
              </div>
              <p className="text-xs w-24 text-right text-foreground shrink-0">
                {item.data.pct !== null ? `${item.data.pct}% (${item.data.correct}/${item.data.total})` : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence calibration */}
      {calibQ.data && calibQ.data.totalVerified >= 3 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Kalibrasi Confidence Dinamis</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left text-[10px] text-muted-foreground font-normal p-1.5">Bucket</th>
                  <th className="text-right text-[10px] text-muted-foreground font-normal p-1.5">Sampel</th>
                  <th className="text-right text-[10px] text-muted-foreground font-normal p-1.5">Actual WR</th>
                </tr>
              </thead>
              <tbody>
                {calibQ.data.calibration.map(b => (
                  <tr key={b.label} className="border-b border-border/10">
                    <td className="p-1.5 text-muted-foreground">{b.label}</td>
                    <td className="p-1.5 text-right">{b.sampleCount}</td>
                    <td className={`p-1.5 text-right font-medium ${b.actualWinRate == null ? "text-muted-foreground" : b.actualWinRate >= 60 ? "text-emerald-400" : b.actualWinRate >= 40 ? "text-amber-400" : "text-red-400"}`}>
                      {b.actualWinRate != null ? `${b.actualWinRate}%` : b.sampleCount < 3 ? "terlalu sedikit" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Backtest Tab ─────────────────────────────────────────────────────────────
function BacktestTab() {
  const [rsiBuy, setRsiBuy] = useState(35);
  const [rsiSell, setRsiSell] = useState(65);
  const [requireEma, setRequireEma] = useState(false);
  const [direction, setDirection] = useState<"long" | "short" | "both">("long");
  const [maxHold, setMaxHold] = useState(10);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await apiPost<BacktestResult>("/backtest", { rsiBuy, rsiSell, requireEmaBullish: requireEma, direction, maxHoldPeriods: maxHold });
      setResult(r);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart2 className="w-3.5 h-3.5 text-orange-400" />Custom Rule Backtest — BTC</h3>
        <p className="text-xs text-muted-foreground">Uji strategi RSI + EMA pada data historis snapshot BTC yang tersimpan.</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="text-muted-foreground block mb-1">RSI Buy ≤</label>
            <input type="number" value={rsiBuy} onChange={e => setRsiBuy(Number(e.target.value))} min={10} max={50} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-muted-foreground block mb-1">RSI Sell ≥</label>
            <input type="number" value={rsiSell} onChange={e => setRsiSell(Number(e.target.value))} min={50} max={90} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-muted-foreground block mb-1">Max Hold Periods</label>
            <input type="number" value={maxHold} onChange={e => setMaxHold(Number(e.target.value))} min={1} max={50} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="text-muted-foreground block mb-1">Arah Trading</label>
            <div className="flex gap-1">
              {(["long", "short", "both"] as const).map(d => (
                <button key={d} onClick={() => setDirection(d)} className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${direction === d ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}>{d}</button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <input type="checkbox" id="require-ema" checked={requireEma} onChange={e => setRequireEma(e.target.checked)} className="w-4 h-4 accent-orange-500" />
            <label htmlFor="require-ema" className="text-xs text-muted-foreground cursor-pointer">Butuh EMA Stack</label>
          </div>
        </div>

        <button onClick={() => void run()} disabled={loading} className="w-full py-2 rounded-xl text-sm font-medium bg-orange-500/80 hover:bg-orange-500 text-white transition-colors disabled:opacity-60">
          {loading ? "Memproses..." : "Jalankan Backtest"}
        </button>
      </div>

      {result && !result.error && (
        <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold">Hasil Backtest BTC</h3>
          <p className="text-xs text-muted-foreground">{result.dataPoints} data snapshot · {result.totalTrades} trade</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              { label: "Win Rate", value: `${result.winRate}%`, color: result.winRate >= 50 ? "text-emerald-400" : "text-red-400" },
              { label: "Profit Factor", value: result.profitFactor, color: result.profitFactor >= 1.5 ? "text-emerald-400" : "text-amber-400" },
              { label: "Max Drawdown", value: `${result.maxDrawdown}%`, color: "text-red-400" },
              { label: "Total Return", value: `${result.totalReturn}%`, color: result.totalReturn >= 0 ? "text-emerald-400" : "text-red-400" },
              { label: "Wins", value: result.wins, color: "text-emerald-400" },
              { label: "Losses", value: result.losses, color: "text-red-400" },
              { label: "Avg Win %", value: `${result.avgWin}%`, color: "text-emerald-400" },
              { label: "Avg Loss %", value: `${result.avgLoss}%`, color: "text-red-400" },
            ].map(s => (
              <div key={s.label} className="bg-muted/20 rounded-lg p-2.5 border border-border/30">
                <div className="text-muted-foreground mb-0.5">{s.label}</div>
                <div className={`font-semibold ${s.color}`}>{s.value}</div>
              </div>
            ))}
          </div>

          {result.equity.length > 2 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Kurva Equity (modal awal $10,000)</p>
              <div className="h-20 flex items-end gap-0.5">
                {result.equity.filter((_, i, arr) => i % Math.ceil(arr.length / 60) === 0).map((v, i) => {
                  const min = Math.min(...result.equity), max = Math.max(...result.equity);
                  const h = max === min ? 50 : ((v - min) / (max - min)) * 100;
                  return <div key={i} className={`flex-1 rounded-t-sm ${v >= 10000 ? "bg-emerald-500/60" : "bg-red-500/60"}`} style={{ height: `${h}%`, minHeight: 2 }} />;
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>Start: $10,000</span>
                <span className={result.finalCapital >= 10000 ? "text-emerald-400" : "text-red-400"}>End: ${result.finalCapital.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {result?.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">{result.error}</div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({ settings, onSaveKey, savingKey, toast, qc }: {
  settings: BtcSettings | undefined;
  onSaveKey: (key: string) => void;
  savingKey: boolean;
  toast: ReturnType<typeof useToast>["toast"];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [apiKeyInput, setApiKeyInput] = useState("");

  const clearKeyM = useMutation({
    mutationFn: () => apiPost("/settings/deepseek-key", { apiKey: "" }),
    onSuccess: () => {
      toast({ title: "Key Dihapus" });
      void qc.invalidateQueries({ queryKey: ["btc-settings"] });
    },
  });

  return (
    <div className="space-y-6 max-w-xl">
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold">DeepSeek API Key</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Atur API key DeepSeek langsung dari website — disimpan aman di database. Key yang sama digunakan untuk XAUUSD dan BTCUSD.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <Badge className={`text-[10px] border ${settings?.hasDeepseekKey ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>
            {settings?.hasDeepseekKey
              ? `Aktif (sumber: ${settings.deepseekKeySource === "database" ? "website" : "secrets"})`
              : "Belum diset — otak AI tidak aktif"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-xxxxxxxxxxxxxxxx"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => { onSaveKey(apiKeyInput); setApiKeyInput(""); }}
            disabled={savingKey || apiKeyInput.trim().length === 0}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {savingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
          </Button>
        </div>
        {settings?.deepseekKeySource === "database" && (
          <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300" onClick={() => clearKeyM.mutate()} disabled={clearKeyM.isPending}>
            Hapus key dari website
          </Button>
        )}
      </div>

      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />Info Engine BTC</h3>
        <p className="text-xs text-muted-foreground">
          Engine BTC berjalan 24/7 (tidak ada market hours). Siklus belajar otomatis setiap 5 menit — membuat pertanyaan, mendapat jawaban dari DeepSeek R1, dan menyimpan insights berkualitas ke otak AI.
        </p>
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Prediksi dibuat setiap siklus untuk timeframe 4H</p>
          <p>• Verifikasi prediksi otomatis setelah 4 jam</p>
          <p>• Forget curve: insight lama di-decay setiap 50 siklus</p>
          <p>• Threshold kualitas: ≥65% untuk masuk ke otak AI</p>
        </div>
      </div>
    </div>
  );
}

// ─── Extreme Mode Tab ─────────────────────────────────────────────────────────
const ALL_CATEGORIES = [
  { id: "teknikal",         label: "Teknikal",        color: "blue" },
  { id: "psikologi",        label: "Psikologi",       color: "purple" },
  { id: "makro",            label: "Makro",           color: "yellow" },
  { id: "trading_rule",     label: "Trading Rule",    color: "green" },
  { id: "derivatif",        label: "Derivatif",       color: "red" },
  { id: "crypto_ekosistem", label: "Crypto Ekosistem",color: "cyan" },
  { id: "onchain",          label: "On-Chain",        color: "emerald" },
  { id: "pattern",          label: "Pattern",         color: "orange" },
  { id: "insight",          label: "Insight",         color: "pink" },
] as const;

const STATUS_CONFIG = {
  idle:         { label: "Menunggu",          color: "text-muted-foreground", dot: "bg-muted-foreground", pulse: false },
  fetching_data:{ label: "Ambil data market", color: "text-blue-400",         dot: "bg-blue-400",         pulse: true  },
  generating:   { label: "Membuat pertanyaan",color: "text-amber-400",        dot: "bg-amber-400",        pulse: true  },
  answering:    { label: "Menjawab",          color: "text-emerald-400",      dot: "bg-emerald-400",      pulse: true  },
} as const;

function ExtremeTab({ em, onRefresh, toast }: { em: ExtremeMode | undefined; onRefresh: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [target, setTarget] = useState(100);
  const [qpc, setQpc] = useState(15);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);

  const toggleCat = (id: string) =>
    setSelectedCats(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
  const selectAll = () => setSelectedCats(ALL_CATEGORIES.map(c => c.id));
  const clearAll = () => setSelectedCats([]);

  const startM = useMutation({
    mutationFn: () => apiPost("/engine/extreme/start", { target, questionsPerCycle: qpc, selectedCategories: selectedCats }),
    onSuccess: () => { toast({ title: "🔥 Mode Ekstrem BTC dimulai!" }); onRefresh(); },
  });
  const stopM = useMutation({
    mutationFn: () => apiPost("/engine/extreme/stop"),
    onSuccess: () => { toast({ title: "Permintaan berhenti dikirim" }); onRefresh(); },
  });

  const isActive = em?.active ?? false;
  const statusCfg = STATUS_CONFIG[em?.currentStatus ?? "idle"];

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-orange-400" />Mode Belajar Ekstrem BTC</h3>
          {isActive && (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${statusCfg.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot} ${statusCfg.pulse ? "animate-pulse" : ""}`} />
              {statusCfg.label}
            </span>
          )}
        </div>

        {isActive && em ? (
          <div className="space-y-3">
            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>{em.progress}/{em.target} pertanyaan ({em.percentDone}%)</span>
                <span>{em.insights} insights tersimpan</span>
              </div>
              <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-orange-500 rounded-full transition-all duration-500" style={{ width: `${em.percentDone}%` }} />
              </div>
            </div>

            {/* Status aktif saat ini */}
            <div className={`rounded-xl p-3 border text-xs space-y-1.5 ${
              em.currentStatus === "generating" ? "bg-amber-500/5 border-amber-500/20" :
              em.currentStatus === "answering"   ? "bg-emerald-500/5 border-emerald-500/20" :
              em.currentStatus === "fetching_data"? "bg-blue-500/5 border-blue-500/20" :
              "bg-muted/10 border-border/20"
            }`}>
              <div className={`flex items-center gap-2 font-medium ${statusCfg.color}`}>
                {em.currentStatus === "fetching_data" && <Activity className="w-3.5 h-3.5" />}
                {em.currentStatus === "generating"    && <Brain className="w-3.5 h-3.5" />}
                {em.currentStatus === "answering"     && <MessageSquare className="w-3.5 h-3.5" />}
                {em.currentStatus === "idle"          && <Clock className="w-3.5 h-3.5" />}
                {statusCfg.label}
              </div>
              {em.currentQuestion && em.currentStatus === "answering" && (
                <p className="text-muted-foreground leading-relaxed line-clamp-2 pl-5">
                  {em.currentQuestion}
                </p>
              )}
            </div>

            {/* Statistik */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {[
                { label: "Pertanyaan", value: em.progress },
                { label: "Insights", value: em.insights },
                { label: "Siklus", value: em.cycles },
                { label: "Kecepatan", value: em.speedQph ? `${em.speedQph}/jam` : "—" },
              ].map(s => (
                <div key={s.label} className="bg-muted/20 rounded-lg p-2 text-center border border-border/30">
                  <div className="font-bold text-orange-400">{s.value}</div>
                  <div className="text-muted-foreground text-[10px] mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Kategori aktif */}
            {em.selectedCategories?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <span className="text-muted-foreground">Kategori:</span>
                {em.selectedCategories.map(c => (
                  <span key={c} className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/25">
                    {ALL_CATEGORIES.find(x => x.id === c)?.label ?? c}
                  </span>
                ))}
              </div>
            )}

            {/* Sumber data + ETA */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sumber data:</span>
              {em.dataMode === "live"
                ? <span className="flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live market</span>
                : <span className="flex items-center gap-1 text-blue-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />Data historis</span>}
            </div>
            {em.etaMs != null && <div className="text-xs text-muted-foreground">ETA: ~{Math.round(em.etaMs / 60000)} menit lagi</div>}

            <Button onClick={() => stopM.mutate()} disabled={stopM.isPending || em.stopRequested} variant="destructive" size="sm" className="w-full gap-2">
              <StopCircle className="w-4 h-4" />{em.stopRequested ? "Menghentikan..." : "Hentikan Sesi"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Mode ekstrem menggunakan DeepSeek untuk menghasilkan dan menjawab ratusan pertanyaan trading Bitcoin <strong className="text-orange-400">tanpa jeda</strong> — setelah jawab langsung tanya lagi. BTC 24/7, bisa dijalankan kapan saja.
            </p>

            {/* Pilihan kategori */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Kategori pertanyaan</label>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors">Pilih semua</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:text-foreground/70 transition-colors">Reset</button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CATEGORIES.map(cat => {
                  const active = selectedCats.includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      onClick={() => toggleCat(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                        active
                          ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                          : "bg-muted/20 text-muted-foreground border-border/30 hover:bg-muted/40"
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {selectedCats.length === 0 ? "Tidak ada yang dipilih = semua kategori dicampur otomatis" : `${selectedCats.length} kategori dipilih — pertanyaan akan difokuskan pada topik ini`}
              </p>
            </div>

            {/* Target & QPC */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Target pertanyaan</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[50, 100, 250, 500].map(n => (
                    <button key={n} onClick={() => setTarget(n)} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${target === n ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}>{n}</button>
                  ))}
                </div>
                <input type="number" value={target} onChange={e => setTarget(Math.max(10, parseInt(e.target.value) || 10))} min={10} max={10000} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Pertanyaan/batch (3–20)</label>
                <input type="number" value={qpc} onChange={e => setQpc(Math.max(3, Math.min(20, parseInt(e.target.value) || 15)))} min={3} max={20} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>

            <Button onClick={() => startM.mutate()} disabled={startM.isPending} className="w-full gap-2 bg-orange-500/80 hover:bg-orange-500 text-white">
              <Flame className="w-4 h-4" />Mulai Mode Ekstrem BTC
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card border border-border/40 rounded-2xl p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground/70">Tentang Mode Ekstrem BTC</p>
        <p>• <strong className="text-foreground/60">Tanpa jeda</strong> — setelah menjawab, langsung generate pertanyaan berikutnya</p>
        <p>• <strong className="text-foreground/60">Pipeline</strong> — batch berikutnya di-generate saat batch ini sedang dijawab</p>
        <p>• <strong className="text-foreground/60">Dedup ketat</strong> — pertanyaan dari sesi sebelumnya tidak akan terulang</p>
        <p>• Jawaban berkualitas ≥65% otomatis disimpan ke otak AI</p>
        <p>• Circuit breaker: berhenti otomatis jika 5 error berturut-turut</p>
        <p>• Rate limit: jeda 60 detik otomatis jika DeepSeek throttle</p>
      </div>
    </div>
  );
}
