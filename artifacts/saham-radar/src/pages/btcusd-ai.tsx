import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bitcoin, Brain, TrendingUp, TrendingDown, Minus, Zap, BookOpen,
  BarChart2, MessageSquare, Activity, ChevronRight, RefreshCw,
  Target, AlertTriangle, CheckCircle, Clock, Flame, StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getMemberToken, getAdminToken } from "@/lib/auth";

// ─── API helpers ───────────────────────────────────────────────────────────────
const BASE = "/api/btcusd";

async function apiGet<T>(path: string): Promise<T> {
  const token = getMemberToken() ?? getAdminToken() ?? "";
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function adminPost(path: string, body?: unknown): Promise<unknown> {
  const token = getAdminToken() ?? "";
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface LivePrice { price: number; bid: number; ask: number; change: number | null; changePct: number | null; }
interface BrainEntry { id: number; category: string; title: string; content: string; confidence: number; createdAt: string; sourceQuestion?: string | null; }
interface BrainStats { totalBrainEntries: number; activeBrainEntries: number; totalQuestionsAsked: number; totalPredictions: number; correctPredictions: number; verifiedPredictions: number; }
interface Prediction { id: number; direction: string; targetPrice: number | null; stopLoss: number | null; confidence: number; reasoning: string; priceAtPrediction: number; predictedAt: string; verifyAt: string | null; isCorrect: boolean | null; status: string; }
interface QuestionLog { id: number; question: string; answer: string | null; quality: number | null; askedAt: string; savedToBrain: boolean; }
interface ExtremeMode { active: boolean; target: number; progress: number; insights: number; cycles: number; startedAt: string | null; percentDone: number; stopRequested: boolean; speedQph: number; etaMs: number | null; dataMode: "live" | "historical"; }
interface EngineStatus { running: boolean; lastCycleAt: string | null; totalCycles: number; totalInsights: number; isLearning: boolean; marketOpen: boolean; extremeMode: ExtremeMode; }

type Tab = "overview" | "brain" | "predictions" | "questions" | "chat" | "extreme";

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) { return n >= 1000 ? `$${(n / 1000).toFixed(2)}k` : `$${n.toFixed(2)}`; }
function fmtBtc(n: number) { return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function pct(n: number | null) { if (n == null) return "–"; const s = n >= 0 ? "+" : ""; return `${s}${n.toFixed(2)}%`; }
function fmtDate(d: string) { return new Date(d).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function BtcusdAi() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const { toast } = useToast();
  const qc = useQueryClient();

  const priceQ = useQuery({ queryKey: ["btc-price"], queryFn: () => apiGet<LivePrice>("/live-price"), refetchInterval: 3000 });
  const statusQ = useQuery({ queryKey: ["btc-status"], queryFn: () => apiGet<EngineStatus>("/engine-status"), refetchInterval: 5000 });
  const statsQ = useQuery({ queryKey: ["btc-stats"], queryFn: () => apiGet<BrainStats>("/brain/stats"), refetchInterval: 20000 });

  const price = priceQ.data;
  const status = statusQ.data;
  const em = status?.extremeMode;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "brain", label: `Brain (${statsQ.data?.activeBrainEntries ?? 0})`, icon: <Brain className="w-3.5 h-3.5" /> },
    { id: "predictions", label: "Prediksi", icon: <Target className="w-3.5 h-3.5" /> },
    { id: "questions", label: "Q&A", icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: "chat", label: "Chat AI", icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: "extreme", label: "Mode Ekstrem", icon: <Flame className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shadow-[0_0_16px_rgba(249,115,22,0.2)]">
              <Bitcoin className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">BTCUSD AI</h1>
              <p className="text-xs text-muted-foreground">Bitcoin trading intelligence · 24/7</p>
            </div>
          </div>
        </div>

        {/* Live price card */}
        <div className="flex items-center gap-4 bg-card border border-border/50 rounded-2xl px-5 py-3">
          {priceQ.isLoading ? (
            <div className="text-muted-foreground text-sm">Memuat harga...</div>
          ) : price ? (
            <>
              <div>
                <div className="text-2xl font-bold text-foreground tracking-tight">
                  {fmtBtc(price.price)}
                </div>
                <div className={`text-xs font-medium ${(price.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pct(price.changePct)} hari ini
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Bid: {fmtBtc(price.bid)}</div>
                <div>Ask: {fmtBtc(price.ask)}</div>
              </div>
            </>
          ) : (
            <div className="text-red-400 text-sm">Gagal ambil harga</div>
          )}
          {/* Engine pill */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${status?.running ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status?.running ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
            {status?.running ? "Brain Aktif" : "Brain Mati"}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Insights", value: statsQ.data?.activeBrainEntries ?? 0, color: "text-orange-400" },
          { label: "Q&A Total", value: statsQ.data?.totalQuestionsAsked ?? 0, color: "text-blue-400" },
          { label: "Prediksi", value: statsQ.data?.totalPredictions ?? 0, color: "text-purple-400" },
          { label: "Akurasi", value: statsQ.data?.verifiedPredictions ? `${Math.round((statsQ.data.correctPredictions / statsQ.data.verifiedPredictions) * 100)}%` : "–", color: "text-emerald-400" },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border/40 rounded-xl px-4 py-3">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map(t => (
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
      {activeTab === "overview" && <OverviewTab status={status} price={price} />}
      {activeTab === "brain" && <BrainTab />}
      {activeTab === "predictions" && <PredictionsTab />}
      {activeTab === "questions" && <QuestionsTab />}
      {activeTab === "chat" && <ChatTab />}
      {activeTab === "extreme" && <ExtremeTab em={em} onRefresh={() => void qc.invalidateQueries({ queryKey: ["btc-status"] })} toast={toast} />}
    </div>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ status, price }: { status: EngineStatus | undefined; price: LivePrice | undefined }) {
  const brainQ = useQuery({ queryKey: ["btc-brain-top"], queryFn: () => apiGet<BrainEntry[]>("/brain"), select: d => d.slice(0, 5) });
  const predsQ = useQuery({ queryKey: ["btc-preds-latest"], queryFn: () => apiGet<Prediction[]>("/predictions"), select: d => d.slice(0, 3) });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Engine info */}
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Activity className="w-4 h-4 text-orange-400" />Status Engine</h3>
        <div className="space-y-2 text-sm">
          <Row label="Status" value={<span className={status?.running ? "text-emerald-400" : "text-red-400"}>{status?.running ? "Berjalan" : "Mati"}</span>} />
          <Row label="Market BTC" value={<span className="text-emerald-400">● Buka 24/7</span>} />
          <Row label="Total Siklus" value={status?.totalCycles ?? 0} />
          <Row label="Total Insights" value={status?.totalInsights ?? 0} />
          <Row label="Siklus Terakhir" value={status?.lastCycleAt ? fmtDate(status.lastCycleAt) : "–"} />
          <Row label="Harga BTC" value={price ? fmtBtc(price.price) : "–"} />
        </div>
      </div>

      {/* Latest prediction */}
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Target className="w-4 h-4 text-orange-400" />Prediksi Terbaru</h3>
        {predsQ.data?.map(p => (
          <div key={p.id} className="p-3 bg-muted/20 rounded-xl border border-border/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={`flex items-center gap-1 text-sm font-semibold ${p.direction === "up" ? "text-emerald-400" : p.direction === "down" ? "text-red-400" : "text-yellow-400"}`}>
                {p.direction === "up" ? <TrendingUp className="w-3.5 h-3.5" /> : p.direction === "down" ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                {p.direction.toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground">{Math.round(p.confidence * 100)}% conf</span>
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

      {/* Top insights */}
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-3 lg:col-span-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><Brain className="w-4 h-4 text-orange-400" />Top Insights Otak AI</h3>
        <div className="space-y-2">
          {brainQ.data?.map(b => (
            <div key={b.id} className="p-3 bg-muted/20 rounded-xl border border-border/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-orange-400/80 capitalize">{b.category.replace("_", " ")}</span>
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

// ─── Brain tab ─────────────────────────────────────────────────────────────────
function BrainTab() {
  const brainQ = useQuery({ queryKey: ["btc-brain"], queryFn: () => apiGet<BrainEntry[]>("/brain") });
  const [expanded, setExpanded] = useState<number | null>(null);

  const categoryColor: Record<string, string> = {
    teknikal: "text-blue-400", onchain: "text-orange-400", makro: "text-purple-400",
    psikologi: "text-yellow-400", manajemen_risiko: "text-red-400", crypto_ekosistem: "text-emerald-400", umum: "text-muted-foreground",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{brainQ.data?.length ?? 0} insights aktif di otak AI Bitcoin</p>
      </div>
      {brainQ.data?.map(b => (
        <div key={b.id} className="bg-card border border-border/40 rounded-xl p-4 cursor-pointer hover:border-orange-500/20 transition-colors" onClick={() => setExpanded(expanded === b.id ? null : b.id)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-medium capitalize ${categoryColor[b.category] ?? "text-muted-foreground"}`}>{b.category.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground">{Math.round(b.confidence * 100)}% conf</span>
              </div>
              <p className="text-sm font-medium text-foreground">{b.title}</p>
              {expanded === b.id ? (
                <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap leading-relaxed">{b.content}</p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{b.content}</p>
              )}
            </div>
            <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded === b.id ? "rotate-90" : ""}`} />
          </div>
        </div>
      ))}
      {!brainQ.data?.length && (
        <div className="text-center py-16 text-muted-foreground">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Otak BTC AI masih kosong. Tunggu beberapa siklus belajar.</p>
        </div>
      )}
    </div>
  );
}

// ─── Predictions tab ───────────────────────────────────────────────────────────
function PredictionsTab() {
  const predsQ = useQuery({ queryKey: ["btc-preds"], queryFn: () => apiGet<Prediction[]>("/predictions") });

  return (
    <div className="space-y-3">
      {predsQ.data?.map(p => (
        <div key={p.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 font-semibold text-sm ${p.direction === "up" ? "text-emerald-400" : p.direction === "down" ? "text-red-400" : "text-yellow-400"}`}>
                {p.direction === "up" ? <TrendingUp className="w-4 h-4" /> : p.direction === "down" ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                {p.direction.toUpperCase()}
              </span>
              <span className="text-xs bg-muted/50 px-2 py-0.5 rounded-md text-muted-foreground">{Math.round(p.confidence * 100)}%</span>
              {p.isCorrect === true && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" />Benar</span>}
              {p.isCorrect === false && <span className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Salah</span>}
              {p.status === "pending" && <span className="text-xs text-yellow-400/70 flex items-center gap-1"><Clock className="w-3 h-3" />Pending</span>}
            </div>
            <span className="text-xs text-muted-foreground">{fmtDate(p.predictedAt)}</span>
          </div>
          <p className="text-xs text-muted-foreground">{p.reasoning?.slice(0, 200)}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span>Entry: {fmtBtc(p.priceAtPrediction)}</span>
            {p.targetPrice && <span className="text-emerald-400">Target: {fmtBtc(p.targetPrice)}</span>}
            {p.stopLoss && <span className="text-red-400">SL: {fmtBtc(p.stopLoss)}</span>}
          </div>
        </div>
      ))}
      {!predsQ.data?.length && (
        <div className="text-center py-16 text-muted-foreground">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Belum ada prediksi BTC.</p>
        </div>
      )}
    </div>
  );
}

// ─── Questions tab ─────────────────────────────────────────────────────────────
function QuestionsTab() {
  const qQ = useQuery({ queryKey: ["btc-questions"], queryFn: () => apiGet<QuestionLog[]>("/questions?limit=30") });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{qQ.data?.length ?? 0} pertanyaan terakhir dikirim ke DeepSeek R1</p>
      {qQ.data?.map(q => (
        <div key={q.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${q.savedToBrain ? "text-orange-400" : "text-muted-foreground"}`}>
              {q.savedToBrain ? "✓ Disimpan ke brain" : "Tidak disimpan"}
            </span>
            <span className="text-xs text-muted-foreground">
              {q.quality != null ? `Kualitas: ${Math.round(q.quality * 100)}%` : ""} · {fmtDate(q.askedAt)}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground/90">{q.question}</p>
          {q.answer && <p className="text-xs text-muted-foreground line-clamp-3">{q.answer}</p>}
        </div>
      ))}
      {!qQ.data?.length && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>Belum ada pertanyaan yang dikirim ke AI.</p>
        </div>
      )}
    </div>
  );
}

// ─── Chat tab ──────────────────────────────────────────────────────────────────
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
    } catch (e) {
      setMessages(m => [...m, { role: "ai", text: "Gagal terhubung ke AI." }]);
    } finally { setLoading(false); }
  }

  return (
    <div className="bg-card border border-border/40 rounded-2xl flex flex-col" style={{ height: "60vh" }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Bitcoin className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm">Tanya BTC AI Trader tentang apapun seputar Bitcoin</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-orange-500/20 text-foreground" : "bg-muted/40 text-foreground/90"}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
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
          <Zap className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Extreme mode tab ──────────────────────────────────────────────────────────
function ExtremeTab({ em, onRefresh, toast }: { em: ExtremeMode | undefined; onRefresh: () => void; toast: ReturnType<typeof useToast>["toast"] }) {
  const [target, setTarget] = useState(100);
  const [qpc, setQpc] = useState(10);

  const startMut = useMutation({
    mutationFn: () => adminPost("/engine/extreme/start", { target, questionsPerCycle: qpc }),
    onSuccess: () => { toast({ title: "Mode Ekstrem BTC dimulai!" }); onRefresh(); },
  });
  const stopMut = useMutation({
    mutationFn: () => adminPost("/engine/extreme/stop"),
    onSuccess: () => { toast({ title: "Permintaan berhenti dikirim" }); onRefresh(); },
  });

  const isActive = em?.active ?? false;

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border/40 rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Flame className="w-4 h-4 text-orange-400" />Mode Belajar Ekstrem BTC</h3>
          {isActive && <span className="flex items-center gap-1.5 text-xs text-orange-400 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />BERJALAN</span>}
        </div>

        {isActive && em ? (
          <div className="space-y-3">
            {/* Progress */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                <span>{em.progress}/{em.target} pertanyaan ({em.percentDone}%)</span>
                <span>{em.insights} insights tersimpan</span>
              </div>
              <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full bg-orange-500 rounded-full transition-all duration-500" style={{ width: `${em.percentDone}%` }} />
              </div>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <StatCell label="Pertanyaan" value={em.progress} />
              <StatCell label="Insights" value={em.insights} />
              <StatCell label="Siklus" value={em.cycles} />
              <StatCell label="Kecepatan" value={em.speedQph ? `${em.speedQph}/jam` : "–"} />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Sumber data:</span>
              {em.dataMode === "live" ? (
                <span className="flex items-center gap-1 text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live market</span>
              ) : (
                <span className="flex items-center gap-1 text-blue-400"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />Data historis</span>
              )}
            </div>
            {em.etaMs && <div className="text-xs text-muted-foreground">ETA: {Math.round(em.etaMs / 60000)} menit lagi</div>}
            <Button onClick={() => stopMut.mutate()} disabled={stopMut.isPending || em.stopRequested} variant="destructive" size="sm" className="w-full gap-2">
              <StopCircle className="w-4 h-4" />{em.stopRequested ? "Menghentikan..." : "Hentikan Sesi"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Mode ekstrem BTC menggunakan DeepSeek R1 untuk menghasilkan dan menjawab ratusan pertanyaan trading Bitcoin secara otomatis.
              BTC berjalan 24/7 — bisa dijalankan kapan saja.
            </p>
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
                <label className="text-xs text-muted-foreground mb-1.5 block">Pertanyaan/siklus (3–20)</label>
                <input type="number" value={qpc} onChange={e => setQpc(Math.max(3, Math.min(20, parseInt(e.target.value) || 10)))} min={3} max={20} className="w-full bg-muted/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>
            <Button onClick={() => startMut.mutate()} disabled={startMut.isPending} className="w-full gap-2 bg-orange-500/80 hover:bg-orange-500 text-white">
              <Flame className="w-4 h-4" />Mulai Mode Ekstrem BTC
            </Button>
          </div>
        )}
      </div>

      <div className="bg-card border border-border/40 rounded-2xl p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground/70">Tentang Mode Ekstrem BTC</p>
        <p>• DeepSeek R1 <em>generate</em> pertanyaan crypto yang unik, lalu <em>menjawabnya</em> — pool tak terbatas</p>
        <p>• Topik: halving cycle, on-chain metrics, DeFi, korelasi Nasdaq, psikologi crypto, dll</p>
        <p>• BTC 24/7 — tidak ada downtime saat weekend seperti gold</p>
        <p>• Jawaban berkualitas ≥65% otomatis disimpan ke otak AI</p>
      </div>
    </div>
  );
}

// ─── Reusable components ───────────────────────────────────────────────────────
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/20 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground/80">{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-muted/20 rounded-lg p-2.5 text-center">
      <div className="text-sm font-bold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
