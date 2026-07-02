/**
 * XAUUSD AI — Gold Trading AI yang belajar mandiri
 * Real-time indicators + autonomous brain + chat + learning log + news
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  TrendingUp, TrendingDown, Minus, Brain, BookOpen,
  MessageSquare, Newspaper, Activity, Zap, RefreshCw,
  Send, Play, ChevronDown, ChevronUp, Target, History,
  CheckCircle2, XCircle, Clock, Loader2
} from "lucide-react";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL;

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}api/xauusd${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}api/xauusd${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Snapshot {
  price: number; open: number; high: number; low: number; volume: number;
  rsi14: number | null; ema9: number | null; ema21: number | null;
  ema50: number | null; ema200: number | null;
  macdLine: number | null; macdSignal: number | null; macdHistogram: number | null;
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null; bbWidth: number | null;
  atr14: number | null; trend: string; rsiSignal: string;
  macdSignalType: string; emaAlignment: string;
  supportLevel: number | null; resistanceLevel: number | null;
  lastSnapshotAt: string | null; lastSavedPrice: number | null;
}

interface BrainEntry {
  id: number; category: string; title: string; content: string;
  confidence: number; createdAt: string; sourceQuestion: string | null;
  marketConditionTags: string | null;
}

interface BrainStats {
  totalInsights: number; byCategory: Record<string, number>;
  totalQuestionsAsked: number; totalPredictions: number;
  verifiedPredictions: number; correctPredictions: number;
  predictionAccuracy: number | null;
}

interface QuestionLog {
  id: number; question: string; answer: string | null; quality: number | null;
  savedToBrain: boolean; askedAt: string; answeredAt: string | null;
}

interface Prediction {
  id: number; direction: string; targetPrice: number | null; confidence: number;
  reasoning: string; priceAtPrediction: number; predictedAt: string;
  actualPrice: number | null; isCorrect: boolean | null;
  status: string; revisionNote: string | null;
}

interface NewsItem {
  id: number; title: string; summary: string | null; url: string | null;
  source: string | null; sentiment: string | null; aiAnalysis: string | null;
  publishedAt: string | null; fetchedAt: string;
}

interface LearningLog {
  id: number; cycleAt: string; priceAtCycle: number | null;
  questionsAsked: number; insightsSaved: number;
  wrongPredictions: number; spikeDetected: boolean; summary: string | null;
  durationMs: number | null;
}

interface EngineStatus {
  running: boolean; lastCycleAt: string | null;
  totalCycles: number; totalInsights: number; isLearning: boolean;
}

// ─── Session ID ───────────────────────────────────────────────────────────────
function getSessionId() {
  let sid = sessionStorage.getItem("xauusd-session-id");
  if (!sid) {
    sid = "xau-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("xauusd-session-id", sid);
  }
  return sid;
}
const SESSION_ID = getSessionId();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rsiColor(v: number | null) {
  if (!v) return "text-slate-400";
  if (v >= 70) return "text-red-400";
  if (v <= 30) return "text-emerald-400";
  return "text-amber-400";
}
function trendIcon(t: string) {
  if (t === "bullish") return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (t === "bearish") return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-amber-400" />;
}
function trendBadge(t: string) {
  const cls = t === "bullish" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    : t === "bearish" ? "bg-red-500/20 text-red-300 border-red-500/30"
      : "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return <Badge className={`${cls} border text-xs`}>{t.toUpperCase()}</Badge>;
}
function sentimentColor(s: string | null) {
  if (s === "bullish") return "text-emerald-400";
  if (s === "bearish") return "text-red-400";
  return "text-amber-400";
}
function categoryColor(c: string) {
  const map: Record<string, string> = {
    trading_rule: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    pattern: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    insight: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    lesson: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    news_impact: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };
  return map[c] ?? "bg-slate-500/20 text-slate-300";
}
function fmt(n: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}
function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// ─── Indicator Card ───────────────────────────────────────────────────────────
function IndicatorGrid({ s }: { s: Snapshot }) {
  const items = [
    { label: "RSI 14", value: fmt(s.rsi14, 1), sub: s.rsiSignal, color: rsiColor(s.rsi14) },
    { label: "EMA 9", value: `$${fmt(s.ema9)}`, sub: "", color: "text-blue-300" },
    { label: "EMA 21", value: `$${fmt(s.ema21)}`, sub: "", color: "text-blue-300" },
    { label: "EMA 50", value: `$${fmt(s.ema50)}`, sub: "", color: "text-indigo-300" },
    { label: "EMA 200", value: `$${fmt(s.ema200)}`, sub: "", color: "text-violet-300" },
    { label: "MACD Line", value: fmt(s.macdLine, 3), sub: s.macdSignalType, color: (s.macdHistogram ?? 0) > 0 ? "text-emerald-400" : "text-red-400" },
    { label: "MACD Signal", value: fmt(s.macdSignal, 3), sub: "", color: "text-slate-300" },
    { label: "MACD Hist", value: fmt(s.macdHistogram, 3), sub: "", color: (s.macdHistogram ?? 0) > 0 ? "text-emerald-400" : "text-red-400" },
    { label: "BB Upper", value: `$${fmt(s.bbUpper)}`, sub: "", color: "text-slate-300" },
    { label: "BB Middle", value: `$${fmt(s.bbMiddle)}`, sub: "", color: "text-slate-300" },
    { label: "BB Lower", value: `$${fmt(s.bbLower)}`, sub: "", color: "text-slate-300" },
    { label: "BB Width", value: `${fmt(s.bbWidth, 2)}%`, sub: "", color: "text-amber-300" },
    { label: "ATR 14", value: fmt(s.atr14, 2), sub: "volatilitas", color: "text-orange-300" },
    { label: "Support", value: `$${fmt(s.supportLevel)}`, sub: "100 candle", color: "text-emerald-400" },
    { label: "Resistance", value: `$${fmt(s.resistanceLevel)}`, sub: "100 candle", color: "text-red-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {items.map((item) => (
        <div key={item.label} className="bg-card/50 rounded-lg p-2 border border-border/50 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
          <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
          {item.sub && <p className="text-[10px] text-muted-foreground capitalize">{item.sub.replace(/_/g, " ")}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Brain Panel ──────────────────────────────────────────────────────────────
function BrainPanel({ stats, entries }: { stats: BrainStats | undefined; entries: BrainEntry[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const categories = ["all", "trading_rule", "pattern", "insight", "lesson", "news_impact"];
  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Insight", value: stats.totalInsights, color: "text-cyan-400" },
            { label: "Pertanyaan", value: stats.totalQuestionsAsked, color: "text-purple-400" },
            { label: "Prediksi Diverifikasi", value: stats.verifiedPredictions, color: "text-blue-400" },
            { label: "Akurasi Prediksi", value: stats.predictionAccuracy != null ? `${stats.predictionAccuracy}%` : "—", color: stats.predictionAccuracy != null && stats.predictionAccuracy >= 50 ? "text-emerald-400" : "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card/50 rounded-lg p-3 border border-border/50 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-2 py-1 rounded text-xs border transition-colors ${filter === c ? "bg-amber-500/30 border-amber-500/50 text-amber-300" : "border-border/50 text-muted-foreground hover:border-amber-500/30"}`}
          >
            {c === "all" ? "Semua" : c.replace(/_/g, " ")}
            {c !== "all" && stats?.byCategory[c] ? ` (${stats.byCategory[c]})` : ""}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Otak AI belum ada insight untuk kategori ini.</p>
          <p className="text-xs mt-1">Klik "Mulai Belajar Sekarang" untuk memulai siklus pembelajaran.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.map((e) => (
            <div key={e.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
              <button
                className="w-full flex items-start gap-3 p-3 text-left hover:bg-card/60 transition-colors"
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`${categoryColor(e.category)} border text-[10px]`}>{e.category.replace(/_/g, " ")}</Badge>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
                    <span className="text-[10px] text-amber-400">⭐ {(e.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-2">{e.title}</p>
                </div>
                {expanded === e.id ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
              </button>
              {expanded === e.id && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="bg-background/50 rounded p-3 text-sm text-foreground/90 whitespace-pre-wrap">{e.content}</div>
                  {e.sourceQuestion && (
                    <p className="text-[11px] text-muted-foreground italic">📚 "{e.sourceQuestion.slice(0, 100)}{e.sourceQuestion.length > 100 ? "..." : ""}"</p>
                  )}
                  {e.marketConditionTags && (
                    <div className="flex flex-wrap gap-1">
                      {e.marketConditionTags.split(",").map((tag) => (
                        <span key={tag} className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
interface ChatMsg { role: "user" | "assistant"; content: string }

function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      apiPost<{ reply: string; aiPowered: boolean }>("/chat", { message: msg, sessionId: SESSION_ID }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (err) => {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    },
  });

  const send = () => {
    const msg = input.trim();
    if (!msg || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    setInput("");
    sendMutation.mutate(msg);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMutation.isPending]);

  const QUICK = [
    "Analisis kondisi XAUUSD saat ini", "RSI sudah overbought, apa yang harus dilakukan?",
    "Berikan setup trading untuk hari ini", "Kapan waktu terbaik buy gold?",
  ];

  return (
    <div className="flex flex-col h-[520px]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-4xl mb-3">🥇</div>
            <p className="text-sm text-muted-foreground">Tanya Gold AI Trader tentang apapun seputar XAUUSD</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="text-xs px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors text-left"
                >
                  💬 {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-amber-500/20 text-amber-100 border border-amber-500/30" : "bg-card/60 text-foreground border border-border/50"}`}>
                {m.role === "assistant" && <span className="text-xs text-amber-400 block mb-1">🥇 Gold AI Trader</span>}
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-card/60 border border-border/50 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-xs text-muted-foreground">Gold AI sedang berpikir...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Tanya Gold AI... (Enter untuk kirim)"
          className="flex-1 bg-background/50 border border-border/50 rounded-lg px-3 py-2 text-sm resize-none h-[70px] focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
        <Button
          onClick={send}
          disabled={!input.trim() || sendMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-black self-end"
          size="sm"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Learning Log ─────────────────────────────────────────────────────────────
function LearningLogPanel({ logs }: { logs: LearningLog[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Belum ada siklus pembelajaran yang tercatat.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
      {logs.map((log) => (
        <div key={log.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-center gap-3 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === log.id ? null : log.id)}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.spikeDetected ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">{timeAgo(log.cycleAt)}</span>
                {log.spikeDetected && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 border text-[10px]">⚡ SPIKE</Badge>}
                <span className="text-[11px] text-cyan-400">+{log.insightsSaved} insight</span>
                <span className="text-[11px] text-purple-400">{log.questionsAsked} pertanyaan</span>
                {log.priceAtCycle && <span className="text-[11px] text-amber-400">${log.priceAtCycle.toFixed(2)}</span>}
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{log.durationMs ? `${(log.durationMs / 1000).toFixed(0)}s` : ""}</span>
            {expanded === log.id ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {expanded === log.id && log.summary && (
            <div className="px-3 pb-3">
              <p className="text-xs text-muted-foreground bg-background/50 rounded p-2">{log.summary}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Prediction Tracker ───────────────────────────────────────────────────────
function PredictionPanel({ preds }: { preds: Prediction[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (preds.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Belum ada prediksi yang dibuat oleh AI.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
      {preds.map((p) => (
        <div key={p.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-center gap-3 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === p.id ? null : p.id)}
          >
            {/* Status icon */}
            {p.status === "pending" && <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />}
            {p.isCorrect === true && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
            {p.isCorrect === false && <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`border text-[10px] ${p.direction === "up" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : p.direction === "down" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                  {p.direction === "up" ? "▲ NAIK" : p.direction === "down" ? "▼ TURUN" : "↔ SIDEWAYS"}
                </Badge>
                <span className="text-xs text-muted-foreground">dari ${p.priceAtPrediction.toFixed(2)}</span>
                <span className="text-[11px] text-amber-400">{(p.confidence * 100).toFixed(0)}% confidence</span>
                <Badge className={`text-[10px] border ${p.status === "pending" ? "bg-slate-500/20 text-slate-300 border-slate-500/30" : p.status === "verified" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-orange-500/20 text-orange-300 border-orange-500/30"}`}>
                  {p.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(p.predictedAt)}</p>
            </div>
            {expanded === p.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {expanded === p.id && (
            <div className="px-3 pb-3 space-y-2">
              <div className="bg-background/50 rounded p-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Alasan Prediksi:</p>
                <p className="text-sm">{p.reasoning}</p>
              </div>
              {p.actualPrice && (
                <div className="bg-background/50 rounded p-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Hasil Aktual:</p>
                  <p className="text-sm">Harga aktual: <span className="text-amber-400 font-bold">${p.actualPrice.toFixed(2)}</span> — {p.isCorrect ? <span className="text-emerald-400">✓ Benar</span> : <span className="text-red-400">✗ Salah</span>}</p>
                </div>
              )}
              {p.revisionNote && (
                <div className="bg-orange-500/10 rounded p-2 border border-orange-500/20">
                  <p className="text-xs font-medium text-orange-400 mb-1">📚 Self-Critique AI:</p>
                  <p className="text-sm text-foreground/80">{p.revisionNote}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Questions Log ────────────────────────────────────────────────────────────
function QuestionsPanel({ questions }: { questions: QuestionLog[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (questions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>Belum ada pertanyaan yang dikirim ke DeepSeek.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
      {questions.slice(0, 20).map((q) => (
        <div key={q.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-start gap-2 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === q.id ? null : q.id)}
          >
            <span className="text-sm">{q.savedToBrain ? "🧠" : "❓"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground line-clamp-2">{q.question}</p>
              <div className="flex gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">{timeAgo(q.askedAt)}</span>
                {q.quality != null && <span className={`text-[10px] ${q.quality >= 0.6 ? "text-emerald-400" : "text-muted-foreground"}`}>kualitas: {(q.quality * 100).toFixed(0)}%</span>}
              </div>
            </div>
            {expanded === q.id ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
          </button>
          {expanded === q.id && q.answer && (
            <div className="px-3 pb-3">
              <div className="bg-background/50 rounded p-2 text-xs text-foreground/80 whitespace-pre-wrap max-h-48 overflow-y-auto">{q.answer}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── News Panel ───────────────────────────────────────────────────────────────
function NewsPanel({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <Newspaper className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>Belum ada berita XAUUSD yang tersimpan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
      {news.map((n) => (
        <div key={n.id} className="bg-card/40 rounded-lg border border-border/50 p-3">
          <div className="flex items-start gap-2">
            <span className={`text-lg flex-shrink-0 ${n.sentiment === "bullish" ? "🟢" : n.sentiment === "bearish" ? "🔴" : "🟡"}`}>
              {n.sentiment === "bullish" ? "📈" : n.sentiment === "bearish" ? "📉" : "📰"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {n.sentiment && (
                  <Badge className={`text-[10px] border ${n.sentiment === "bullish" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : n.sentiment === "bearish" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                    {n.sentiment}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">{n.source}</span>
                <span className="text-[10px] text-muted-foreground">{n.publishedAt ? timeAgo(n.publishedAt) : timeAgo(n.fetchedAt)}</span>
              </div>
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-amber-400 transition-colors line-clamp-2">
                  {n.title}
                </a>
              ) : (
                <p className="text-sm font-medium line-clamp-2">{n.title}</p>
              )}
              {n.aiAnalysis && (
                <p className="text-xs text-muted-foreground mt-1.5 italic">🤖 {n.aiAnalysis}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = "indicators" | "brain" | "chat" | "predictions" | "questions" | "news" | "log";

export default function XauusdAi() {
  const [activeTab, setActiveTab] = useState<Tab>("indicators");
  const { toast } = useToast();
  const qc = useQueryClient();

  const snapshotQ = useQuery({
    queryKey: ["xauusd-snapshot"],
    queryFn: () => apiGet<Snapshot>("/snapshot"),
    refetchInterval: 60_000,
  });

  const brainQ = useQuery({
    queryKey: ["xauusd-brain"],
    queryFn: () => apiGet<BrainEntry[]>("/brain?limit=80"),
  });

  const statsQ = useQuery({
    queryKey: ["xauusd-brain-stats"],
    queryFn: () => apiGet<BrainStats>("/brain/stats"),
    refetchInterval: 30_000,
  });

  const predictionsQ = useQuery({
    queryKey: ["xauusd-predictions"],
    queryFn: () => apiGet<Prediction[]>("/predictions?limit=20"),
    refetchInterval: 60_000,
  });

  const questionsQ = useQuery({
    queryKey: ["xauusd-questions"],
    queryFn: () => apiGet<QuestionLog[]>("/questions?limit=30"),
    refetchInterval: 60_000,
  });

  const newsQ = useQuery({
    queryKey: ["xauusd-news"],
    queryFn: () => apiGet<NewsItem[]>("/news?limit=20"),
    refetchInterval: 5 * 60_000,
  });

  const logQ = useQuery({
    queryKey: ["xauusd-log"],
    queryFn: () => apiGet<LearningLog[]>("/learning-log?limit=30"),
    refetchInterval: 30_000,
  });

  const engineQ = useQuery({
    queryKey: ["xauusd-engine"],
    queryFn: () => apiGet<EngineStatus>("/engine-status"),
    refetchInterval: 15_000,
  });

  const learnNowMutation = useMutation({
    mutationFn: () => apiPost("/learn-now"),
    onSuccess: () => {
      toast({ title: "✅ Siklus Pembelajaran Selesai", description: "AI telah menyelesaikan 1 siklus belajar." });
      void qc.invalidateQueries({ queryKey: ["xauusd-brain"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-brain-stats"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-questions"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-log"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-predictions"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const s = snapshotQ.data;
  const engine = engineQ.data;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "indicators", label: "Indikator Live", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "brain", label: `Otak AI (${statsQ.data?.totalInsights ?? 0})`, icon: <Brain className="w-3.5 h-3.5" /> },
    { id: "chat", label: "Chat", icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: "predictions", label: `Prediksi (${predictionsQ.data?.length ?? 0})`, icon: <Target className="w-3.5 h-3.5" /> },
    { id: "questions", label: `Pertanyaan (${statsQ.data?.totalQuestionsAsked ?? 0})`, icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: "news", label: "Berita", icon: <Newspaper className="w-3.5 h-3.5" /> },
    { id: "log", label: `Log Belajar (${logQ.data?.length ?? 0})`, icon: <History className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-2xl">🥇</div>
            <div>
              <h1 className="text-2xl font-bold text-white">Gold AI Trader</h1>
              <p className="text-sm text-muted-foreground">AI XAUUSD yang belajar mandiri 24/7 • Powered by DeepSeek</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Engine status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${engine?.running ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${engine?.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {engine?.running ? `Belajar aktif • ${engine.totalCycles} siklus` : "Engine berhenti"}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => learnNowMutation.mutate()}
            disabled={learnNowMutation.isPending}
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          >
            {learnNowMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Belajar...</>
              : <><Zap className="w-3.5 h-3.5 mr-1.5" />Mulai Belajar Sekarang</>
            }
          </Button>
        </div>
      </div>

      {/* Price + signals bar */}
      {s ? (
        <Card className="border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-amber-600/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">XAUUSD / Harga Gold</p>
                <p className="text-4xl font-bold text-amber-400">${s.price.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">H: ${s.high.toFixed(2)} | L: ${s.low.toFixed(2)}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  {trendIcon(s.trend)}
                  {trendBadge(s.trend)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">EMA:</span>
                  <Badge className={`text-xs border ${s.emaAlignment === "bullish_stack" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : s.emaAlignment === "bearish_stack" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
                    {s.emaAlignment.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">RSI:</span>
                  <span className={`text-sm font-bold ${rsiColor(s.rsi14)}`}>{fmt(s.rsi14, 1)}</span>
                  <Badge className="text-xs border bg-slate-500/20 text-slate-300 border-slate-500/30">{s.rsiSignal}</Badge>
                </div>
                {s.macdSignalType !== "neutral" && (
                  <Badge className={`text-xs border ${s.macdSignalType === "bullish_cross" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>
                    MACD {s.macdSignalType.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>

              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">Support / Resistance</p>
                <p className="text-sm"><span className="text-emerald-400">${fmt(s.supportLevel)}</span> / <span className="text-red-400">${fmt(s.resistanceLevel)}</span></p>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6 px-2" onClick={() => void snapshotQ.refetch()}>
                  <RefreshCw className="w-3 h-3 mr-1" />Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-amber-500/20">
          <CardContent className="p-6 text-center">
            {snapshotQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Mengambil data XAUUSD dari Yahoo Finance...</span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <p>Gagal mengambil data XAUUSD.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void snapshotQ.refetch()}>Coba Lagi</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Latest AI prediction banner */}
      {predictionsQ.data && predictionsQ.data[0] && predictionsQ.data[0].status === "pending" && (
        <Card className={`border ${predictionsQ.data[0].direction === "up" ? "border-emerald-500/30 bg-emerald-500/5" : predictionsQ.data[0].direction === "down" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="text-3xl">{predictionsQ.data[0].direction === "up" ? "🚀" : predictionsQ.data[0].direction === "down" ? "📉" : "↔️"}</div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Prediksi AI Terakhir (4 jam ke depan)</p>
              <p className="font-bold">
                <span className={predictionsQ.data[0].direction === "up" ? "text-emerald-400" : predictionsQ.data[0].direction === "down" ? "text-red-400" : "text-amber-400"}>
                  {predictionsQ.data[0].direction === "up" ? "▲ NAIK" : predictionsQ.data[0].direction === "down" ? "▼ TURUN" : "↔ SIDEWAYS"}
                </span>
                {predictionsQ.data[0].targetPrice && <span className="text-muted-foreground text-sm ml-2">target ${predictionsQ.data[0].targetPrice.toFixed(2)}</span>}
                <span className="text-amber-400 text-sm ml-2">• {(predictionsQ.data[0].confidence * 100).toFixed(0)}% confidence</span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{predictionsQ.data[0].reasoning}</p>
            </div>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 border text-xs">PENDING VERIFIKASI</Badge>
          </CardContent>
        </Card>
      )}

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-1 border-b border-border/50 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === tab.id ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-muted-foreground hover:text-foreground hover:bg-card/60 border border-transparent"}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <Card className="border border-border/50">
        <CardContent className="p-4 sm:p-6">
          {activeTab === "indicators" && s && <IndicatorGrid s={s} />}
          {activeTab === "indicators" && !s && (
            <div className="text-center py-8 text-muted-foreground">
              {snapshotQ.isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "Tidak ada data indikator."}
            </div>
          )}

          {activeTab === "brain" && (
            <BrainPanel stats={statsQ.data} entries={brainQ.data ?? []} />
          )}

          {activeTab === "chat" && <ChatPanel />}

          {activeTab === "predictions" && <PredictionPanel preds={predictionsQ.data ?? []} />}

          {activeTab === "questions" && <QuestionsPanel questions={questionsQ.data ?? []} />}

          {activeTab === "news" && <NewsPanel news={newsQ.data ?? []} />}

          {activeTab === "log" && <LearningLogPanel logs={logQ.data ?? []} />}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="border border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-amber-400" />
            Cara Kerja Gold AI (Autonomous Learning)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { step: "1", title: "Pantau Pasar", desc: "Fetch XAUUSD realtime dari Yahoo Finance + hitung RSI, EMA, MACD, BB, ATR setiap 15 menit", color: "text-amber-400" },
              { step: "2", title: "Deteksi Spike", desc: "Jika harga bergerak >0.3% dalam 1 siklus, AI generate 5 pertanyaan ekstra untuk belajar dari spike", color: "text-orange-400" },
              { step: "3", title: "Belajar dari DeepSeek", desc: "Generate pertanyaan unik (tidak pernah sama) → kirim ke DeepSeek → simpan jawaban terbaik ke 'otak AI'", color: "text-purple-400" },
              { step: "4", title: "Revisi Diri Sendiri", desc: "Setelah 4 jam, cek apakah prediksi benar. Jika salah → AI menulis self-critique dan menyimpannya sebagai pelajaran", color: "text-cyan-400" },
            ].map((item) => (
              <div key={item.step} className="bg-card/40 rounded-lg p-3 border border-border/50">
                <div className={`text-lg font-bold ${item.color} mb-1`}>{item.step}</div>
                <p className="text-xs font-semibold text-foreground mb-1">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
