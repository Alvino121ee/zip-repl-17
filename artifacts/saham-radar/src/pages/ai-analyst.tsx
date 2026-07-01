import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Send,
  Newspaper,
  TrendingUp,
  RefreshCw,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Minus,
  Zap,
  Clock,
  Tag,
} from "lucide-react";

interface NewsArticle {
  title: string;
  link: string;
  summary?: string;
  source: string;
  publishedAt: string;
  tickers: string[];
}

interface AiInsight {
  ticker: string;
  recommendation: "BELI" | "TAHAN" | "JUAL";
  confidence: number;
  insight: string;
  reasoning: string;
  bullish: string;
  bearish: string;
  aiPowered?: boolean;
  generatedAt?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const BASE = import.meta.env.BASE_URL;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}api${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} mnt lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

function RecommendationBadge({ rec }: { rec: string }) {
  if (rec === "BELI") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
      <ChevronUp size={12} /> BELI
    </span>
  );
  if (rec === "JUAL") return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
      <ChevronDown size={12} /> JUAL
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
      <Minus size={12} /> TAHAN
    </span>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/40 transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-gray-100 line-clamp-2 group-hover:text-blue-300 transition-colors leading-snug">
          {article.title}
        </h3>
        <ExternalLink size={12} className="text-gray-500 flex-shrink-0 mt-0.5" />
      </div>
      {article.summary && (
        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{article.summary}</p>
      )}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Clock size={10} /> {timeAgo(article.publishedAt)}
        </span>
        <span className="text-xs text-blue-400">{article.source}</span>
        {article.tickers.slice(0, 3).map(t => (
          <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
            {t}
          </span>
        ))}
      </div>
    </a>
  );
}

function InsightCard({ insight }: { insight: AiInsight }) {
  const [open, setOpen] = useState(false);
  const confColor =
    insight.confidence >= 70 ? "text-emerald-400" :
    insight.confidence >= 50 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-indigo-500/40 transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-white text-sm">{insight.ticker}</span>
          <RecommendationBadge rec={insight.recommendation} />
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${confColor}`}>{insight.confidence}%</span>
          <button onClick={() => setOpen(x => !x)} className="text-gray-400 hover:text-white transition-colors">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-gray-300 leading-relaxed">{insight.insight}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-medium mb-0.5">🟢 Bullish</p>
              <p className="text-xs text-gray-300">{insight.bullish}</p>
            </div>
            <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
              <p className="text-xs text-red-400 font-medium mb-0.5">🔴 Bearish</p>
              <p className="text-xs text-gray-300">{insight.bearish}</p>
            </div>
          </div>
          {insight.generatedAt && (
            <p className="text-xs text-gray-500">Dianalisis {timeAgo(insight.generatedAt)}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AiAnalystPage() {
  const [activeTicker, setActiveTicker] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "Halo! Saya SahamRadar AI. Tanya saya tentang saham BEI, kondisi pasar, atau strategi investasi. Contoh: \"Bagaimana analisis BBCA hari ini?\" atau \"Saham sektor apa yang prospektif sekarang?\"" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: aiStatus } = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => fetchJson<{ aiEnabled: boolean; provider: string }>("/ai/status"),
  });

  const { data: news, isLoading: newsLoading, refetch: refetchNews } = useQuery({
    queryKey: ["news-live"],
    queryFn: () => fetchJson<NewsArticle[]>("/news/live?limit=30"),
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: tickerNews, isLoading: tickerNewsLoading } = useQuery({
    queryKey: ["news-ticker", activeTicker],
    queryFn: () => fetchJson<NewsArticle[]>(`/news/stock/${activeTicker}`),
    enabled: !!activeTicker,
  });

  const { data: tickerInsight, isLoading: insightLoading } = useQuery({
    queryKey: ["ai-insight", activeTicker],
    queryFn: () => fetchJson<AiInsight>(`/ai/insights/${activeTicker}`),
    enabled: !!activeTicker,
    staleTime: 4 * 60 * 60 * 1000,
  });

  const chatMutation = useMutation({
    mutationFn: (msg: string) =>
      postJson<{ reply: string; aiPowered: boolean }>("/ai/chat", { message: msg, ticker: activeTicker }),
    onSuccess: (data) => {
      setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: () => {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Maaf, terjadi kesalahan. Coba lagi." }]);
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || chatMutation.isPending) return;
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  const marketNews = news ?? [];
  const filteredNews = activeTicker ? (tickerNews ?? []) : marketNews;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-gray-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot size={20} className="text-indigo-400" />
            <h1 className="text-lg font-semibold text-white">AI Analyst</h1>
            {aiStatus && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${aiStatus.aiEnabled ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"}`}>
                {aiStatus.aiEnabled ? <><Zap size={10} className="inline mr-1" />{aiStatus.provider}</> : "Mode Aturan"}
              </span>
            )}
          </div>
          <button
            onClick={() => refetchNews()}
            className="text-xs flex items-center gap-1 text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
          >
            <RefreshCw size={12} /> Refresh Berita
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* LEFT: News + Insights */}
        <div className="space-y-4">
          {/* Ticker filter */}
          <div className="flex items-center gap-2">
            <Tag size={14} className="text-gray-400" />
            <span className="text-sm text-gray-400">Filter ticker:</span>
            <input
              type="text"
              placeholder="Contoh: BBCA"
              value={activeTicker}
              onChange={e => setActiveTicker(e.target.value.toUpperCase())}
              className="bg-white/5 border border-white/20 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-28 font-mono"
              maxLength={6}
            />
            {activeTicker && (
              <button onClick={() => setActiveTicker("")} className="text-xs text-gray-500 hover:text-white">✕ hapus</button>
            )}
          </div>

          {/* AI Insight for selected ticker */}
          {activeTicker && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-indigo-400" />
                <span className="text-sm font-medium text-gray-300">Analisis AI: {activeTicker}</span>
              </div>
              {insightLoading ? (
                <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-center text-sm text-gray-400">
                  <RefreshCw size={14} className="animate-spin inline mr-2" />
                  Menganalisis saham...
                </div>
              ) : tickerInsight ? (
                <InsightCard insight={tickerInsight} />
              ) : null}
            </div>
          )}

          {/* News feed */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Newspaper size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-gray-300">
                {activeTicker ? `Berita ${activeTicker}` : "Berita Pasar Terkini"}
              </span>
              {newsLoading || tickerNewsLoading ? (
                <RefreshCw size={12} className="animate-spin text-gray-500" />
              ) : (
                <span className="text-xs text-gray-500">{filteredNews.length} artikel</span>
              )}
            </div>

            {filteredNews.length === 0 && !newsLoading && !tickerNewsLoading ? (
              <div className="p-6 text-center rounded-lg bg-white/5 border border-white/10">
                <Newspaper size={24} className="text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-400">
                  {activeTicker
                    ? `Tidak ada berita terkait ${activeTicker} saat ini.`
                    : "Tidak ada berita tersedia."}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredNews.map((a, i) => (
                  <NewsCard key={`${a.link}-${i}`} article={a} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: AI Chat */}
        <div className="flex flex-col h-[calc(100vh-120px)] sticky top-[60px]">
          <div className="flex items-center gap-2 mb-3">
            <Bot size={14} className="text-indigo-400" />
            <span className="text-sm font-medium text-gray-300">Chat dengan AI Analyst</span>
          </div>

          {!aiStatus?.aiEnabled && (
            <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
              <p className="text-xs text-yellow-400 font-medium">⚠️ Mode Terbatas</p>
              <p className="text-xs text-gray-400 mt-1">
                Tambahkan <code className="text-yellow-300">DEEPSEEK_API_KEY</code> di Secrets untuk mengaktifkan AI Chat penuh.
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600/80 text-white rounded-br-none"
                      : "bg-white/5 text-gray-200 border border-white/10 rounded-bl-none"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-white/5 border border-white/10 rounded-xl rounded-bl-none px-3 py-2">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Suggested questions */}
          <div className="mt-3 flex gap-2 flex-wrap">
            {[
              "Saham apa yang bagus hari ini?",
              "Analisis BBCA",
              "Sektor apa yang prospektif?",
              "Kondisi IHSG sekarang?",
            ].map(q => (
              <button
                key={q}
                onClick={() => { setChatInput(q); }}
                className="text-xs px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tanya tentang saham BEI..."
              rows={2}
              className="flex-1 bg-white/5 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
            />
            <button
              onClick={handleSendChat}
              disabled={!chatInput.trim() || chatMutation.isPending}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors flex-shrink-0"
            >
              <Send size={16} />
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-1 text-center">Bukan saran investasi resmi</p>
        </div>
      </div>
    </div>
  );
}
