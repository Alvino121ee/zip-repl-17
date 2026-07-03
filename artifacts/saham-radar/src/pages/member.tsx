/**
 * Member Area — ChatGPT-style interface untuk member
 * Fitur: Chat AI full-screen, akses prediksi, market status
 */
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Send, Loader2, Zap, LogOut, TrendingUp, TrendingDown, Minus,
  MessageSquare, Plus, Brain, Target, BarChart2, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMemberToken, getAdminToken, clearMemberToken, clearAdminToken, authFetch } from "@/lib/auth";

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
interface LivePrice { price: number | null; change: number | null; changePct: number | null }
interface Prediction { id: number; direction: string; confidence: number; targetPrice: number; status: string }

const BASE = "/api/xauusd/";
const SESSION_ID = `member-${Math.random().toString(36).slice(2)}`;

const QUICK_PROMPTS = [
  "📊 Analisis kondisi XAUUSD sekarang",
  "📈 Kapan waktu terbaik untuk buy gold?",
  "📉 Apa yang harus dilakukan saat RSI overbought?",
  "🎯 Berikan setup trading untuk hari ini",
  "⚡ Apakah ada sinyal breakout saat ini?",
  "💡 Jelaskan situasi EMA saat ini",
];

function getToken() {
  return getAdminToken() ?? getMemberToken();
}

export default function MemberPage() {
  const [, navigate] = useLocation();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [chatKey, setChatKey] = useState(0); // reset chat
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Redirect ke login jika tidak ada token
  const token = getToken();
  useEffect(() => {
    if (!token) navigate("/login?role=member&redirect=/member");
  }, [token, navigate]);

  // Live price
  const livePriceQ = useQuery<LivePrice>({
    queryKey: ["member-live-price"],
    queryFn: async () => {
      const r = await fetch(`${BASE}live-price`);
      return r.json();
    },
    refetchInterval: 10_000,
    enabled: !!token,
  });

  // Latest predictions (read-only, public)
  const predsQ = useQuery<Prediction[]>({
    queryKey: ["member-predictions"],
    queryFn: async () => {
      const r = await fetch(`${BASE}predictions?limit=3`);
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    refetchInterval: 30_000,
    enabled: !!token,
  });

  // Chat mutation
  const sendMutation = useMutation({
    mutationFn: async (msg: string) => {
      const r = await authFetch(`${BASE}chat`, {
        method: "POST",
        body: JSON.stringify({ message: msg, sessionId: SESSION_ID }),
      }, getToken());
      if (!r.ok) {
        if (r.status === 401) {
          clearMemberToken();
          clearAdminToken();
          navigate("/login?role=member&redirect=/member");
          throw new Error("Sesi berakhir, silakan login kembali");
        }
        throw new Error(`HTTP ${r.status}`);
      }
      return r.json() as Promise<{ reply: string; aiPowered: boolean }>;
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, ts: Date.now() }]);
    },
    onError: (err) => {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `⚠️ ${String(err)}`,
        ts: Date.now(),
      }]);
    },
  });

  const send = (msg?: string) => {
    const text = (msg ?? input).trim();
    if (!text || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    setInput("");
    sendMutation.mutate(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const newChat = () => {
    setMessages([]);
    setInput("");
    setChatKey((k) => k + 1);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleLogout = () => {
    clearMemberToken();
    clearAdminToken();
    navigate("/login?role=member");
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMutation.isPending]);

  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  const lp = livePriceQ.data;
  const priceUp = (lp?.changePct ?? 0) >= 0;

  if (!token) return null;

  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border/50 bg-sidebar">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="leading-none">
              <span className="text-base font-bold tracking-tight text-foreground">GoldRadar</span>
              <span className="text-base font-bold tracking-tight text-primary">.ai</span>
            </div>
          </div>
          <div className="mt-1.5">
            <span className="text-[10px] font-medium tracking-widest uppercase text-muted-foreground/60">
              Member Area
            </span>
          </div>
        </div>

        {/* New Chat */}
        <div className="px-3 py-3">
          <Button
            onClick={newChat}
            variant="outline"
            className="w-full gap-2 border-border/50 hover:border-primary/40 hover:text-primary text-sm"
          >
            <Plus className="w-4 h-4" />
            Chat Baru
          </Button>
        </div>

        {/* Live price */}
        {lp?.price && (
          <div className="px-3 mb-3">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider font-medium">XAUUSD Live</span>
              </div>
              <p className="text-xl font-bold text-primary tabular-nums">${lp.price.toFixed(2)}</p>
              {lp.changePct != null && (
                <p className={`text-xs font-medium tabular-nums flex items-center gap-1 mt-0.5 ${priceUp ? "text-emerald-400" : "text-red-400"}`}>
                  {priceUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {priceUp ? "+" : ""}{lp.changePct.toFixed(2)}%
                </p>
              )}
            </div>
          </div>
        )}

        {/* Predictions */}
        {predsQ.data && predsQ.data.length > 0 && (
          <div className="px-3 mb-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium mb-2 px-1">
              Prediksi AI Terbaru
            </p>
            <div className="space-y-1.5">
              {predsQ.data.slice(0, 3).map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card/40 border border-border/40">
                  <Target className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-semibold ${p.direction === "up" ? "text-emerald-400" : "text-red-400"}`}>
                      {p.direction === "up" ? "▲ BUY" : "▼ SELL"}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 ml-1.5">{(p.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                    p.status === "verified" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                    : p.status === "pending" ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                    : "text-muted-foreground border-border/30"
                  }`}>
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick prompts */}
        <div className="px-3 flex-1 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium mb-2 px-1">
            Pertanyaan Cepat
          </p>
          <div className="space-y-1">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                onClick={() => send(q.replace(/^[^\s]+ /, ""))}
                disabled={sendMutation.isPending}
                className="w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 px-2.5 py-2 rounded-lg transition-colors disabled:opacity-50 truncate"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-border/40 space-y-1.5">
          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            Lihat Dashboard
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/5 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-border/50 bg-sidebar/95 backdrop-blur shrink-0">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Gold AI Chat</span>
          </div>
          <div className="flex items-center gap-2">
            {lp?.price && (
              <span className="text-xs font-mono text-primary">${lp.price.toFixed(2)}</span>
            )}
            <button onClick={newChat} className="p-1.5 rounded-lg hover:bg-white/5">
              <Plus className="w-4 h-4 text-muted-foreground" />
            </button>
            <button onClick={handleLogout} className="p-1.5 rounded-lg hover:bg-white/5">
              <LogOut className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6" key={chatKey}>
          {messages.length === 0 ? (
            /* Empty state */
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

              {sendMutation.isPending && (
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

              {messages.length > 0 && !sendMutation.isPending && (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={newChat}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-3 py-1.5 rounded-full border border-border/30 hover:border-border/50"
                  >
                    <Trash2 className="w-3 h-3" />
                    Hapus percakapan
                  </button>
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
              disabled={!input.trim() || sendMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-black shrink-0 h-12 w-12 p-0 rounded-xl"
            >
              {sendMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </Button>
          </div>
          <p className="text-center text-[10px] text-muted-foreground/30 mt-2">
            GoldRadar AI · Bukan rekomendasi investasi
          </p>
        </div>
      </div>
    </div>
  );
}
