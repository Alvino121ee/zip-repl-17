/**
 * Member Area — ChatGPT-style interface untuk member
 * Sidebar dengan riwayat percakapan + navigasi panel (Chat, Prediksi AI, Sinyal Mentor)
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Send, Loader2, Zap, LogOut, PanelLeftClose, PanelLeft,
  MessageSquare, Plus, Brain, Trash2, TrendingUp, Radar,
  ArrowUpCircle, ArrowDownCircle, MinusCircle, RefreshCw, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMemberToken, getAdminToken, getMemberEmail, clearMemberToken, clearAdminToken, authFetch } from "@/lib/auth";

// ─── Markdown renderer minimalis ─────────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const html = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="bg-amber-500/10 text-amber-300 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^#{1,3} (.+)$/gm, "<strong class=\"text-foreground\">$1</strong>")
    .replace(/^[-•] (.+)$/gm, "<span class=\"block pl-3 before:content-['•'] before:mr-2 before:text-amber-400\">$1</span>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Msg { role: "user" | "assistant"; content: string; ts: number }
interface Conversation { id: string; title: string; messages: Msg[]; updatedAt: number }
type Panel = "chat" | "predict" | "mentor";

const BASE = "/api/xauusd/";
const CONVOS_KEY = "gr_member_conversations";

const QUICK_PROMPTS = [
  "📊 Analisis kondisi XAUUSD sekarang",
  "📈 Kapan waktu terbaik untuk buy gold?",
  "📉 Apa yang harus dilakukan saat RSI overbought?",
  "🎯 Berikan setup trading untuk hari ini",
  "⚡ Apakah ada sinyal breakout saat ini?",
  "💡 Jelaskan situasi EMA saat ini",
];

const PREDICT_MODES: { value: "normal" | "technical" | "fundamental"; label: string; desc: string }[] = [
  { value: "normal", label: "Lengkap", desc: "Teknikal + fundamental + AI" },
  { value: "technical", label: "Teknikal", desc: "RSI, EMA, MACD, S/R" },
  { value: "fundamental", label: "Fundamental", desc: "DXY, US10Y, VIX, berita" },
];

function getToken() {
  return getAdminToken() ?? getMemberToken();
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function saveConversations(convos: Conversation[]) {
  try {
    localStorage.setItem(CONVOS_KEY, JSON.stringify(convos.slice(0, 30)));
  } catch { /* ignore quota errors */ }
}

function makeTitle(firstMsg: string) {
  const clean = firstMsg.trim().slice(0, 40);
  return clean.length < firstMsg.trim().length ? `${clean}…` : clean || "Percakapan baru";
}

export default function MemberPage() {
  const [, navigate] = useLocation();
  const [panel, setPanel] = useState<Panel>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Chat state ───────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string>(() => {
    const existing = loadConversations();
    return existing[0]?.id ?? crypto.randomUUID();
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConvo = conversations.find((c) => c.id === activeId);
  const messages = activeConvo?.messages ?? [];

  const token = getToken();
  const email = getMemberEmail();
  useEffect(() => {
    if (!token) navigate("/login/member?redirect=/member");
  }, [token, navigate]);

  const upsertConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations((prev) => {
      const found = prev.find((c) => c.id === id);
      const base: Conversation = found ?? { id, title: "Percakapan baru", messages: [], updatedAt: Date.now() };
      const updated = updater(base);
      const next = [updated, ...prev.filter((c) => c.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
      saveConversations(next);
      return next;
    });
  }, []);

  const forceReauth = useCallback(() => {
    clearMemberToken();
    clearAdminToken();
    navigate("/login/member?redirect=/member");
  }, [navigate]);

  const sendMutation = useMutation({
    mutationFn: async ({ conversationId, msg }: { conversationId: string; msg: string }) => {
      const r = await authFetch(`${BASE}chat`, {
        method: "POST",
        body: JSON.stringify({ message: msg, sessionId: conversationId }),
      }, getToken());
      if (!r.ok) {
        if (r.status === 401) {
          forceReauth();
          throw new Error("Sesi berakhir, silakan login kembali");
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const data = (await r.json()) as { reply: string; aiPowered: boolean };
      return { conversationId, data };
    },
    onSuccess: ({ conversationId, data }) => {
      upsertConversation(conversationId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "assistant", content: data.reply, ts: Date.now() }],
        updatedAt: Date.now(),
      }));
    },
    onError: (err, variables) => {
      upsertConversation(variables.conversationId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "assistant", content: `⚠️ ${String(err)}`, ts: Date.now() }],
        updatedAt: Date.now(),
      }));
    },
  });

  const send = (msg?: string) => {
    const text = (msg ?? input).trim();
    if (!text || sendMutation.isPending) return;
    const conversationId = activeId;
    const isFirst = messages.length === 0;
    upsertConversation(conversationId, (c) => ({
      ...c,
      title: isFirst ? makeTitle(text) : c.title,
      messages: [...c.messages, { role: "user", content: text, ts: Date.now() }],
      updatedAt: Date.now(),
    }));
    setInput("");
    sendMutation.mutate({ conversationId, msg: text });
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const newChat = () => {
    const id = crypto.randomUUID();
    setActiveId(id);
    setInput("");
    setPanel("chat");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConversations(next);
      if (id === activeId) {
        setActiveId(next[0]?.id ?? crypto.randomUUID());
      }
      return next;
    });
  };

  const handleLogout = () => {
    clearMemberToken();
    clearAdminToken();
    navigate("/login/member");
  };

  const onAuthError = forceReauth;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMutation.isPending]);

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  if (!token) return null;

  const NAV_ITEMS: { key: Panel; label: string; icon: typeof MessageSquare }[] = [
    { key: "chat", label: "Chat AI Expert", icon: MessageSquare },
    { key: "predict", label: "Prediksi AI", icon: Sparkles },
    { key: "mentor", label: "Sinyal Mentor", icon: Radar },
  ];

  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <div className={`${sidebarOpen ? "w-72" : "w-0"} shrink-0 border-r border-border/50 bg-sidebar/60 backdrop-blur flex flex-col overflow-hidden transition-all duration-200`}>
        <div className="p-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 px-1">
            <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="leading-none">
              <span className="text-sm font-bold text-foreground">GoldRadar</span>
              <span className="text-sm font-bold text-primary">.ai</span>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 mb-2 shrink-0">
          <button
            onClick={newChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 text-sm font-medium text-foreground transition-all"
          >
            <Plus className="w-4 h-4 text-primary" />
            Chat Baru
          </button>
        </div>

        {/* Panel nav */}
        <div className="px-3 mb-3 shrink-0 space-y-0.5">
          {NAV_ITEMS.filter((n) => n.key !== "chat").map((item) => (
            <button
              key={item.key}
              onClick={() => setPanel(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                panel === item.key
                  ? "bg-primary/15 text-primary border border-primary/25"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent"
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className="px-3 mb-1.5 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-1">Riwayat Chat</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 space-y-0.5 min-h-0">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground/40 px-1 py-4 text-center">Belum ada percakapan</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveId(c.id); setPanel("chat"); }}
              className={`group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                c.id === activeId && panel === "chat"
                  ? "bg-white/8 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
              <span className="flex-1 truncate">{c.title}</span>
              <span
                role="button"
                onClick={(e) => deleteConversation(c.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/15 hover:text-red-400 transition-all shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>

        {/* Footer: user + logout */}
        <div className="p-3 border-t border-border/40 shrink-0">
          <div className="flex items-center justify-between px-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{email ?? "Member"}</p>
              <p className="text-[10px] text-muted-foreground/50">Akun Member</p>
            </div>
            <button onClick={handleLogout} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors shrink-0" title="Logout">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border/50 bg-sidebar/95 backdrop-blur shrink-0">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors">
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {panel === "chat" && <><MessageSquare className="w-4 h-4 text-primary" /> Gold AI Trader</>}
            {panel === "predict" && <><Sparkles className="w-4 h-4 text-primary" /> Prediksi AI</>}
            {panel === "mentor" && <><Radar className="w-4 h-4 text-primary" /> Sinyal Mentor</>}
          </div>
          <span className="ml-1 text-[10px] text-muted-foreground/50 uppercase tracking-widest font-medium">Member</span>
        </div>

        {panel === "chat" && (
          <ChatPanel
            messages={messages}
            input={input}
            setInput={setInput}
            send={send}
            isPending={sendMutation.isPending}
            bottomRef={bottomRef}
            textareaRef={textareaRef}
            fmtTime={fmtTime}
          />
        )}
        {panel === "predict" && <PredictPanel onAuthError={onAuthError} />}
        {panel === "mentor" && <MentorPanel onAuthError={onAuthError} />}
      </div>
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────
function ChatPanel({
  messages, input, setInput, send, isPending, bottomRef, textareaRef, fmtTime,
}: {
  messages: Msg[];
  input: string;
  setInput: (v: string) => void;
  send: (msg?: string) => void;
  isPending: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fmtTime: (ts: number) => string;
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 shadow-[0_0_32px_rgba(245,158,11,0.15)]">
              <Brain className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Gold AI Trader</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-xs">
              AI trading XAUUSD yang belajar mandiri 24/7. Tanyakan apapun seputar gold, analisis teknikal, atau strategi trading.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q.replace(/^[^\s]+ /, ""))}
                  className="text-left px-4 py-3 rounded-xl border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all text-sm text-muted-foreground hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] ${m.role === "user" ? "order-first" : ""}`}>
                  {m.role === "assistant" && (
                    <p className="text-xs text-muted-foreground/70 mb-1.5 font-medium">Gold AI Trader</p>
                  )}
                  <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary/20 text-amber-100 border border-primary/30 rounded-br-sm"
                      : "bg-card/60 text-foreground border border-border/50 rounded-bl-sm"
                  }`}>
                    {m.role === "assistant"
                      ? <MarkdownText text={m.content} />
                      : <p className="whitespace-pre-wrap">{m.content}</p>
                    }
                  </div>
                  <p className="text-[10px] text-muted-foreground/40 mt-1 px-1">
                    {fmtTime(m.ts)}
                  </p>
                </div>
              </div>
            ))}

            {isPending && (
              <div className="flex gap-3 justify-start">
                <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="bg-card/60 border border-border/50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-muted-foreground">Gold AI sedang menganalisis...</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border/50 bg-background/80 backdrop-blur px-4 py-4 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-3 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Tanya Gold AI... (Enter untuk kirim, Shift+Enter baris baru)"
              rows={1}
              className="w-full bg-card/50 border border-border/50 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 placeholder:text-muted-foreground/40 transition-all min-h-[48px] max-h-[160px]"
              style={{ height: "auto" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 160) + "px";
              }}
            />
          </div>
          <Button
            onClick={() => send()}
            disabled={!input.trim() || isPending}
            className="bg-primary hover:bg-primary/90 text-black shrink-0 h-12 w-12 p-0 rounded-xl"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-center text-[10px] text-muted-foreground/30 mt-2">
          GoldRadar AI · Bukan rekomendasi investasi
        </p>
      </div>
    </>
  );
}

// ─── Prediksi AI panel ────────────────────────────────────────────────────────
interface PredictResult {
  direction: "up" | "down";
  targetPrice: number;
  tp2: number | null;
  tp3: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stopLoss: number | null;
  confidence: number;
  reasoning: string;
  mode: string;
  priceAtPrediction: number;
  generatedAt: string;
  aiPowered: boolean;
}

function PredictPanel({ onAuthError }: { onAuthError: () => void }) {
  const [mode, setMode] = useState<"normal" | "technical" | "fundamental">("normal");
  const [result, setResult] = useState<PredictResult | null>(null);

  const predictMutation = useMutation({
    mutationFn: async () => {
      const r = await authFetch(`${BASE}predict`, { method: "POST", body: JSON.stringify({ mode }) }, getToken());
      if (!r.ok) {
        if (r.status === 401) {
          onAuthError();
          throw new Error("Sesi berakhir, silakan login kembali");
        }
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${r.status}`);
      }
      return r.json() as Promise<PredictResult>;
    },
    onSuccess: (data) => setResult(data),
  });

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 mx-auto shadow-[0_0_28px_rgba(245,158,11,0.15)]">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1.5">Prediksi AI On-Demand</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Minta AI menganalisis XAUUSD saat ini dan menghasilkan prediksi arah dengan target harga dan level risiko.
          </p>
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {PREDICT_MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                mode === m.value
                  ? "border-primary/40 bg-primary/10"
                  : "border-border/50 hover:border-border/80 hover:bg-white/5"
              }`}
            >
              <p className={`text-xs font-semibold ${mode === m.value ? "text-primary" : "text-foreground"}`}>{m.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{m.desc}</p>
            </button>
          ))}
        </div>

        <Button
          onClick={() => predictMutation.mutate()}
          disabled={predictMutation.isPending}
          className="w-full bg-primary hover:bg-primary/90 text-black font-semibold gap-2 h-11 mb-6"
        >
          {predictMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {predictMutation.isPending ? "AI Menganalisis..." : "Buat Prediksi Baru"}
        </Button>

        {predictMutation.isError && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-sm text-red-400 text-center">
            {String((predictMutation.error as Error)?.message ?? "Gagal membuat prediksi")}
          </div>
        )}

        {result && (
          <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-bold ${
                result.direction === "up"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}>
                {result.direction === "up" ? <ArrowUpCircle className="w-4 h-4" /> : <ArrowDownCircle className="w-4 h-4" />}
                {result.direction === "up" ? "NAIK (BUY)" : "TURUN (SELL)"}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Confidence</p>
                <p className="text-lg font-extrabold text-primary tabular-nums">{Math.round(result.confidence * 100)}%</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-background/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Harga Saat Ini</p>
                <p className="text-sm font-bold text-foreground tabular-nums">${fmt(result.priceAtPrediction)}</p>
              </div>
              <div className="bg-background/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Target (TP1)</p>
                <p className="text-sm font-bold text-emerald-400 tabular-nums">${fmt(result.targetPrice)}</p>
              </div>
              <div className="bg-background/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Stop Loss</p>
                <p className="text-sm font-bold text-red-400 tabular-nums">${fmt(result.stopLoss)}</p>
              </div>
            </div>

            {(result.entryLow || result.entryHigh || result.tp2 || result.tp3) && (
              <div className="flex flex-wrap gap-2 mb-5 text-xs">
                {result.entryLow && result.entryHigh && (
                  <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-border/40 text-muted-foreground">
                    Entry: ${fmt(result.entryLow)} – ${fmt(result.entryHigh)}
                  </span>
                )}
                {result.tp2 && <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-border/40 text-muted-foreground">TP2: ${fmt(result.tp2)}</span>}
                {result.tp3 && <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-border/40 text-muted-foreground">TP3: ${fmt(result.tp3)}</span>}
              </div>
            )}

            <div className="border-t border-border/40 pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Analisis AI</p>
              <p className="text-sm text-foreground/90 leading-relaxed">
                <MarkdownText text={result.reasoning} />
              </p>
            </div>

            <p className="text-[10px] text-muted-foreground/40 mt-4 text-center">
              {result.aiPowered ? "🤖 AI-powered analysis" : "📐 Rule-based analysis"} · {new Date(result.generatedAt).toLocaleString("id-ID")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sinyal Mentor panel ──────────────────────────────────────────────────────
interface MentorSignal {
  command: "BUY" | "SHORT" | "HOLD";
  reasons: string[];
  minTP: number | null;
  minSL: number | null;
  confidence: number;
  price: number | null;
  bullishScore: number;
  bearishScore: number;
  dataSource: string;
}

function MentorPanel({ onAuthError }: { onAuthError: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["mentor-signal"],
    queryFn: async () => {
      const r = await authFetch(`${BASE}mentor-signal`, {}, getToken());
      if (!r.ok) {
        if (r.status === 401) {
          onAuthError();
        }
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json() as Promise<MentorSignal>;
    },
    refetchInterval: 30_000,
    retry: (failureCount, err) => !String(err).includes("401") && failureCount < 2,
  });

  const fmt = (v: number | null) => v == null ? "—" : v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const commandStyle = {
    BUY: { bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", icon: ArrowUpCircle },
    SHORT: { bg: "bg-red-500/10 border-red-500/30 text-red-400", icon: ArrowDownCircle },
    HOLD: { bg: "bg-amber-500/10 border-amber-500/30 text-amber-400", icon: MinusCircle },
  } as const;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-foreground mb-1">Sinyal Mentor Mode</h2>
            <p className="text-sm text-muted-foreground">Rekomendasi real-time berdasarkan konfluensi indikator teknikal</p>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg border border-border/50 hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all shrink-0"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {isError && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-sm text-red-400 text-center">
            Gagal memuat sinyal mentor
          </div>
        )}

        {data && (
          <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-base font-extrabold ${commandStyle[data.command].bg}`}>
                {(() => { const Icon = commandStyle[data.command].icon; return <Icon className="w-5 h-5" />; })()}
                {data.command}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Harga Live</p>
                <p className="text-lg font-extrabold text-foreground tabular-nums">${fmt(data.price)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-background/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Target Minimal</p>
                <p className="text-sm font-bold text-emerald-400 tabular-nums">${fmt(data.minTP)}</p>
              </div>
              <div className="bg-background/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wide mb-1">Stop Loss</p>
                <p className="text-sm font-bold text-red-400 tabular-nums">${fmt(data.minSL)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1">
                <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Bullish {data.bullishScore}</span>
                  <span>Bearish {data.bearishScore}</span>
                </div>
                <div className="h-1.5 rounded-full bg-red-500/20 overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-400/70"
                    style={{ width: `${(data.bullishScore / Math.max(1, data.bullishScore + data.bearishScore)) * 100}%` }}
                  />
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground/60">Confidence</p>
                <p className="text-sm font-bold text-primary tabular-nums">{Math.round(data.confidence * 100)}%</p>
              </div>
            </div>

            <div className="border-t border-border/40 pt-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Alasan</p>
              <ul className="space-y-1.5">
                {data.reasons.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                    <TrendingUp className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-[10px] text-muted-foreground/40 mt-4 text-center">
              Sumber data: {data.dataSource === "live" ? "TradingView Live" : "Snapshot terbaru"} · Auto-refresh 30 detik
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
