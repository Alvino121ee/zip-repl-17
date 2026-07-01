import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAgents,
  chatWithAgent,
  getAgentMemory,
  clearAgentMemory,
  updateAgentConfig,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Trash2, Settings, Plus, Minus, ChevronDown, ChevronUp,
  Bot, Cpu, Loader2, RotateCcw, BookOpen, FlaskConical
} from "lucide-react";

// ─── Session ID (per browser tab) ────────────────────────────────────────────
function getSessionId() {
  let sid = sessionStorage.getItem("agent-session-id");
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("agent-session-id", sid);
  }
  return sid;
}

const SESSION_ID = getSessionId();

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface AgentConfig {
  agentId: string;
  name: string;
  description: string;
  avatar: string;
  color: string;
  systemPrompt: string;
  trainingExamples: Array<{ input: string; output: string }>;
  isActive: boolean;
  updatedAt: string;
}

// ─── Chat Panel per Agent ─────────────────────────────────────────────────────
function AgentChatPanel({ agent }: { agent: AgentConfig }) {
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [isLoadedFromMemory, setIsLoadedFromMemory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Load memory on first render
  const { data: memory, isLoading: loadingMemory } = useQuery({
    queryKey: ["agent-memory", agent.agentId, SESSION_ID],
    queryFn: () => getAgentMemory(agent.agentId, { sessionId: SESSION_ID } as Parameters<typeof getAgentMemory>[1]),
  });

  useEffect(() => {
    if (memory && !isLoadedFromMemory) {
      setLocalMessages(memory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        createdAt: m.createdAt,
      })));
      setIsLoadedFromMemory(true);
    }
  }, [memory, isLoadedFromMemory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      chatWithAgent(agent.agentId, { message, sessionId: SESSION_ID }),
    onSuccess: (data) => {
      setLocalMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    },
    onError: () => {
      toast({ title: "Gagal", description: "Agent tidak dapat merespons.", variant: "destructive" });
      setLocalMessages((prev) => prev.slice(0, -1)); // remove optimistic user msg
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearAgentMemory(agent.agentId, { sessionId: SESSION_ID }),
    onSuccess: () => {
      setLocalMessages([]);
      setIsLoadedFromMemory(false);
      qc.invalidateQueries({ queryKey: ["agent-memory", agent.agentId] });
      toast({ title: "Memori Dihapus", description: `Riwayat percakapan ${agent.name} dihapus.` });
    },
  });

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || chatMutation.isPending) return;
    setInput("");
    setLocalMessages((prev) => [...prev, { role: "user", content: msg }]);
    chatMutation.mutate(msg);
  }, [input, chatMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ backgroundColor: agent.color + "22", border: `1px solid ${agent.color}44` }}
          >
            {agent.avatar}
          </div>
          <div>
            <div className="font-semibold text-sm">{agent.name}</div>
            <div className="text-xs text-muted-foreground">
              {localMessages.length > 0
                ? `${Math.floor(localMessages.length / 2)} percakapan dalam sesi ini`
                : "Belum ada percakapan"}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending || localMessages.length === 0}
          className="text-muted-foreground hover:text-destructive"
        >
          <RotateCcw className="w-4 h-4 mr-1" /> Reset
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingMemory && (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loadingMemory && localMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="text-4xl">{agent.avatar}</div>
            <div>
              <p className="font-medium text-sm">{agent.name} siap membantu</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">{agent.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-xs mt-2">
              {agent.trainingExamples.slice(0, 2).map((ex, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(ex.input);
                  }}
                  className="text-left text-xs p-2 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground"
                >
                  💬 {ex.input}
                </button>
              ))}
            </div>
          </div>
        )}

        {localMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                style={{ backgroundColor: agent.color + "22" }}
              >
                {agent.avatar}
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex gap-3 justify-start">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
              style={{ backgroundColor: agent.color + "22" }}
            >
              {agent.avatar}
            </div>
            <div className="bg-muted rounded-xl px-4 py-3 flex gap-1 items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Tanya ${agent.name}... (Enter untuk kirim)`}
            className="min-h-[44px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={chatMutation.isPending || !input.trim()}
            size="icon"
            style={{ backgroundColor: agent.color }}
            className="flex-shrink-0 hover:opacity-90"
          >
            {chatMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Training Panel ───────────────────────────────────────────────────────────
function TrainingPanel({ agent, onSaved }: { agent: AgentConfig; onSaved: () => void }) {
  const [systemPrompt, setSystemPrompt] = useState(agent.systemPrompt);
  const [examples, setExamples] = useState(agent.trainingExamples);
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: () =>
      updateAgentConfig(agent.agentId, {
        systemPrompt,
        trainingExamples: examples,
      }),
    onSuccess: () => {
      toast({ title: "Tersimpan", description: `Otak ${agent.name} berhasil diperbarui!` });
      onSaved();
    },
    onError: () => {
      toast({ title: "Gagal", description: "Tidak dapat menyimpan konfigurasi.", variant: "destructive" });
    },
  });

  const addExample = () =>
    setExamples((prev) => [...prev, { input: "", output: "" }]);

  const removeExample = (i: number) =>
    setExamples((prev) => prev.filter((_, idx) => idx !== i));

  const updateExample = (i: number, field: "input" | "output", value: string) =>
    setExamples((prev) =>
      prev.map((ex, idx) => (idx === i ? { ...ex, [field]: value } : ex))
    );

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="w-4 h-4 text-primary" />
          Tabel Pelatihan & System Prompt
          <Badge variant="secondary">{examples.length} contoh</Badge>
        </div>
        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {isExpanded && (
        <div className="p-4 border-t border-border space-y-6">
          {/* System Prompt */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <Cpu className="w-4 h-4 text-muted-foreground" />
              System Prompt (Kepribadian & Keahlian Agent)
            </label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={10}
              className="font-mono text-xs"
              placeholder="Definisikan kepribadian, keahlian, dan cara menjawab agent..."
            />
            <p className="text-xs text-muted-foreground">
              System prompt mendefinisikan "otak" agent — spesialisasi, gaya komunikasi, dan aturan analisis.
            </p>
          </div>

          {/* Training Examples */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-muted-foreground" />
                Contoh Pelatihan (Few-Shot Examples)
              </label>
              <Button variant="outline" size="sm" onClick={addExample}>
                <Plus className="w-3 h-3 mr-1" /> Tambah Contoh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Contoh Q&A ini diajarkan ke agent sebagai "memori jangka panjang" — agent akan menjawab serupa dengan contoh yang diberikan.
            </p>

            <div className="space-y-4">
              {examples.map((ex, i) => (
                <div key={i} className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Contoh #{i + 1}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeExample(i)}
                      className="text-destructive hover:text-destructive h-7"
                    >
                      <Minus className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">👤 Pertanyaan User:</label>
                      <Input
                        value={ex.input}
                        onChange={(e) => updateExample(i, "input", e.target.value)}
                        placeholder="Contoh pertanyaan yang mungkin ditanya user..."
                        className="text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">🤖 Jawaban Ideal Agent:</label>
                      <Textarea
                        value={ex.output}
                        onChange={(e) => updateExample(i, "output", e.target.value)}
                        placeholder="Contoh jawaban yang diharapkan dari agent..."
                        rows={4}
                        className="text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="w-full"
          >
            {updateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Menyimpan...</>
            ) : (
              <><Settings className="w-4 h-4 mr-2" /> Simpan & Update Otak Agent</>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────
function AgentCard({ agent }: { agent: AgentConfig }) {
  const qc = useQueryClient();

  return (
    <Card className="overflow-hidden border-border">
      {/* Agent Header */}
      <CardHeader className="pb-3" style={{ borderBottom: `2px solid ${agent.color}33` }}>
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
            style={{ backgroundColor: agent.color + "22", border: `2px solid ${agent.color}44` }}
          >
            {agent.avatar}
          </div>
          <div>
            <CardTitle className="text-base">{agent.name}</CardTitle>
            <CardDescription className="text-xs mt-0.5">{agent.description}</CardDescription>
          </div>
          <Badge
            className="ml-auto text-xs"
            style={{ backgroundColor: agent.color + "22", color: agent.color, borderColor: agent.color + "44" }}
          >
            {agent.agentId === "fundamental" ? "Fundamental" : agent.agentId === "technical" ? "Teknikal" : "Screening"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Chat */}
        <AgentChatPanel agent={agent} />

        {/* Training Panel */}
        <div className="p-4 border-t border-border bg-muted/10">
          <TrainingPanel
            agent={agent}
            onSaved={() => qc.invalidateQueries({ queryKey: ["agents"] })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: () => listAgents(),
  });

  const agentList = agents as AgentConfig[] | undefined;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary" />
          AI Agent Specialists
        </h1>
        <p className="text-muted-foreground mt-1">
          3 AI Agent dari 1 DeepSeek API — masing-masing punya spesialisasi, kepribadian, dan memori percakapan sendiri.
          Setiap agent dilatih dengan contoh Q&A khusus domain BEI.
        </p>
      </div>

      {/* Agent Info Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { icon: "📊", title: "Professor Funda", sub: "Analisis fundamental, valuasi, laporan keuangan" },
          { icon: "📈", title: "Trader Tekno", sub: "Price action, RSI, moving averages, support/resistance" },
          { icon: "🎯", title: "Screener Radar", sub: "Seleksi saham terbaik, ranking, sektor analysis" },
        ].map((a) => (
          <div key={a.title} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
            <span className="text-2xl">{a.icon}</span>
            <div>
              <div className="text-sm font-medium">{a.title}</div>
              <div className="text-xs text-muted-foreground">{a.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Agents Grid */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {agentList?.map((agent) => (
            <AgentCard key={agent.agentId} agent={agent} />
          ))}
        </div>
      )}

      {/* How It Works */}
      <Card className="bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            Cara Kerja Sistem Agent
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: "1", title: "System Prompt", desc: "Mendefinisikan kepribadian dan spesialisasi unik tiap agent" },
            { step: "2", title: "Few-Shot Training", desc: "Contoh Q&A diajarkan langsung ke context window DeepSeek" },
            { step: "3", title: "Context Data", desc: "Data pasar BEI realtime diinjeksi otomatis sebelum menjawab" },
            { step: "4", title: "Memori Sesi", desc: "Riwayat percakapan disimpan per sesi — agent ingat konteks sebelumnya" },
          ].map((s) => (
            <div key={s.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                {s.step}
              </div>
              <div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
