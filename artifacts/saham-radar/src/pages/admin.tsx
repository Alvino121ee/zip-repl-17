/**
 * Admin / System page — hanya bisa diakses admin yang sudah login
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity, Brain, Clock, Key, Phone, Zap, CheckCircle2,
  XCircle, RefreshCw, LogOut, ShieldCheck, Users, KeyRound,
  Target, Bell, Loader2, Eye, EyeOff, Flame, StopCircle,
  BarChart2, TrendingUp, Power, Bitcoin,
} from "lucide-react";
import { getAdminToken, clearAdminToken, authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ExtremeMode {
  active: boolean;
  target: number;
  progress: number;
  insights: number;
  cycles: number;
  startedAt: string | null;
  percentDone: number;
  stopRequested: boolean;
  speedQph: number;
  etaMs: number | null;
  dataMode: "live" | "historical";
}

interface BtcEngineStatus {
  running: boolean;
  totalCycles: number;
  lastCycleAt: string | null;
}

interface SystemStatus {
  ok: boolean;
  engine: {
    running: boolean;
    totalCycles: number;
    lastCycleAt: string | null;
    totalInsights: number;
    isLearning: boolean;
    extremeMode: ExtremeMode;
  };
  btcEngine: BtcEngineStatus | null;
  engineEnabled: { xauusd: boolean; btc: boolean };
  settings: {
    hasDeepseekKey: boolean;
    deepseekKeySource: "database" | "environment" | "none";
    hasAiKey: boolean;
    aiKeySource: "database" | "environment" | "none";
    aiBaseUrl: string;
    aiModel: string;
    predictionTimeframeMinutes: number;
    whatsapp: { number: string; enabled: boolean };
    validTimeframes?: number[];
  };
  livePrice: { price: number | null; change: number | null; changePct: number | null; timestamp: number | null; stale: boolean; error: string | null } | null;
  serverTime: string;
  member: { hasPassword: boolean };
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ok ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </div>
  );
}

function adminFetch(path: string, opts?: RequestInit) {
  return authFetch(path, opts ?? {}, getAdminToken());
}

async function adminPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await adminFetch(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function SettingsPanel({ data, onRefetch }: { data: SystemStatus; onRefetch: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiBaseUrlInput, setAiBaseUrlInput] = useState(data.settings.aiBaseUrl ?? "");
  const [aiModelInput, setAiModelInput] = useState(data.settings.aiModel ?? "");
  const [waNumber, setWaNumber] = useState(data.settings.whatsapp.number ?? "");
  const [waEnabled, setWaEnabled] = useState(data.settings.whatsapp.enabled ?? false);
  const [memberPwd, setMemberPwd] = useState("");
  const [showMemberPwd, setShowMemberPwd] = useState(false);

  useEffect(() => {
    setWaNumber(data.settings.whatsapp.number ?? "");
    setWaEnabled(data.settings.whatsapp.enabled ?? false);
  }, [data.settings.whatsapp.number, data.settings.whatsapp.enabled]);

  const saveKeyMut = useMutation({
    mutationFn: (key: string) => adminPost("/api/xauusd/settings/deepseek-key", { apiKey: key }),
    onSuccess: () => { toast({ title: "✅ API Key Disimpan" }); onRefetch(); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const clearKeyMut = useMutation({
    mutationFn: () => adminPost("/api/xauusd/settings/deepseek-key", { apiKey: "" }),
    onSuccess: () => { toast({ title: "Key Dihapus" }); onRefetch(); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const saveAiKeyMut = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {
        baseUrl: aiBaseUrlInput,
        model: aiModelInput,
      };
      if (aiKeyInput.trim().length > 0) payload.apiKey = aiKeyInput;
      return adminPost("/api/admin/settings/ai-key", payload);
    },
    onSuccess: () => {
      const msg = aiKeyInput.trim().length > 0
        ? "API key + konfigurasi tersimpan ke database & file .env"
        : "Konfigurasi (base URL/model) disimpan";
      toast({ title: "✅ Pengaturan AI Disimpan", description: msg });
      setAiKeyInput("");
      onRefetch();
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const clearAiKeyMut = useMutation({
    mutationFn: () => adminPost("/api/admin/settings/ai-key", { apiKey: "" }),
    onSuccess: () => { toast({ title: "AI Key Dihapus" }); onRefetch(); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  // Apakah ada perubahan yang bisa disimpan (key baru, atau base URL/model berubah)
  const aiConfigChanged =
    aiKeyInput.trim().length > 0 ||
    aiBaseUrlInput !== (data.settings.aiBaseUrl ?? "") ||
    aiModelInput !== (data.settings.aiModel ?? "");

  const saveTimeframeMut = useMutation({
    mutationFn: (minutes: number) => adminPost("/api/xauusd/settings/timeframe", { minutes }),
    onSuccess: () => { toast({ title: "✅ Interval Diperbarui" }); onRefetch(); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const saveWhatsappMut = useMutation({
    mutationFn: ({ number, enabled }: { number: string; enabled: boolean }) =>
      adminPost("/api/xauusd/settings/whatsapp", { number, enabled }),
    onSuccess: () => { toast({ title: "✅ Pengaturan WhatsApp Disimpan" }); onRefetch(); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const testWhatsappMut = useMutation({
    mutationFn: () => adminPost<{ success: boolean; error?: string }>("/api/xauusd/settings/whatsapp/test"),
    onSuccess: (r: { success: boolean; error?: string }) => {
      if (r.success) toast({ title: "✅ Pesan Tes Terkirim" });
      else toast({ title: "Gagal", description: r.error, variant: "destructive" });
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const saveMemberPwdMut = useMutation({
    mutationFn: (pwd: string) => adminPost("/api/admin/member-password", { password: pwd }),
    onSuccess: () => { toast({ title: "✅ Password Member Disimpan" }); setMemberPwd(""); void qc.invalidateQueries({ queryKey: ["admin-system"] }); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const clearMemberPwdMut = useMutation({
    mutationFn: () => adminPost("/api/admin/member-password", { password: "" }),
    onSuccess: () => { toast({ title: "Akses Member Dinonaktifkan" }); void qc.invalidateQueries({ queryKey: ["admin-system"] }); },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const validTimeframes = data.settings.validTimeframes ?? [15, 30];

  return (
    <div className="space-y-5">
      {/* Member Password */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5 text-blue-400" />
            Akses Member
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status Password Member</span>
            <StatusBadge ok={data.member.hasPassword} label={data.member.hasPassword ? "Aktif" : "Belum diset"} />
          </div>
          <p className="text-xs text-muted-foreground">
            Set password untuk akses halaman member (/member). Member hanya bisa menggunakan fitur Chat AI.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showMemberPwd ? "text" : "password"}
                placeholder="Password baru untuk member..."
                value={memberPwd}
                onChange={(e) => setMemberPwd(e.target.value)}
                className="pr-10"
              />
              <button type="button" onClick={() => setShowMemberPwd((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
                {showMemberPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              size="sm"
              onClick={() => saveMemberPwdMut.mutate(memberPwd)}
              disabled={saveMemberPwdMut.isPending || memberPwd.trim().length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saveMemberPwdMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
            </Button>
          </div>
          {data.member.hasPassword && (
            <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300" onClick={() => clearMemberPwdMut.mutate()} disabled={clearMemberPwdMut.isPending}>
              Nonaktifkan akses member
            </Button>
          )}
        </CardContent>
      </Card>

      {/* DeepSeek API Key */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="w-5 h-5 text-amber-400" />
            DeepSeek API Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <StatusBadge ok={data.settings.hasDeepseekKey} label={data.settings.hasDeepseekKey ? `Aktif (${data.settings.deepseekKeySource})` : "Belum diset"} />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="pr-10"
              />
              <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button size="sm" onClick={() => saveKeyMut.mutate(apiKeyInput)} disabled={saveKeyMut.isPending || apiKeyInput.trim().length === 0} className="bg-amber-500 hover:bg-amber-600 text-black">
              {saveKeyMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
            </Button>
          </div>
          {data.settings.deepseekKeySource === "database" && (
            <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300" onClick={() => clearKeyMut.mutate()} disabled={clearKeyMut.isPending}>
              Hapus key dari database
            </Button>
          )}
        </CardContent>
      </Card>

      {/* OpenAI / General AI API Key */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="w-5 h-5 text-violet-400" />
            OpenAI / AI API Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Untuk laporan analisis AI. Mendukung OpenAI atau provider OpenAI-compatible (Groq, Together, dll). Disimpan ke database dan file <code className="bg-muted px-1 rounded text-[11px]">.env</code>.
          </p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <StatusBadge ok={data.settings.hasAiKey} label={data.settings.hasAiKey ? `Aktif (${data.settings.aiKeySource})` : "Belum diset"} />
          </div>
          {/* API Key */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showAiKey ? "text" : "password"}
                placeholder="sk-xxxxxxxxxxxxxxxx"
                value={aiKeyInput}
                onChange={(e) => setAiKeyInput(e.target.value)}
                className="pr-10"
              />
              <button type="button" onClick={() => setShowAiKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
                {showAiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button
              size="sm"
              onClick={() => saveAiKeyMut.mutate()}
              disabled={saveAiKeyMut.isPending || !aiConfigChanged}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saveAiKeyMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
            </Button>
          </div>
          {/* Base URL (opsional) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Base URL <span className="text-muted-foreground/50">(opsional — default: api.openai.com)</span></label>
            <Input
              type="text"
              placeholder="https://api.openai.com/v1"
              value={aiBaseUrlInput}
              onChange={(e) => setAiBaseUrlInput(e.target.value)}
              className="text-sm"
            />
          </div>
          {/* Model (opsional) */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Model <span className="text-muted-foreground/50">(opsional — default: gpt-4o-mini)</span></label>
            <Input
              type="text"
              placeholder="gpt-4o-mini"
              value={aiModelInput}
              onChange={(e) => setAiModelInput(e.target.value)}
              className="text-sm"
            />
          </div>
          {data.settings.aiKeySource === "database" && (
            <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-300" onClick={() => clearAiKeyMut.mutate()} disabled={clearAiKeyMut.isPending}>
              Hapus key dari database
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Timeframe */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="w-5 h-5 text-amber-400" />
            Interval Prediksi
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {validTimeframes.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={data.settings.predictionTimeframeMinutes === m ? "default" : "outline"}
                className={data.settings.predictionTimeframeMinutes === m ? "bg-amber-500 hover:bg-amber-600 text-black" : ""}
                onClick={() => saveTimeframeMut.mutate(m)}
                disabled={saveTimeframeMut.isPending}
              >
                {m} menit
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="w-5 h-5 text-green-400" />
            Notifikasi WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-muted-foreground" />
            <Input
              type="tel"
              placeholder="cth: 6281234567890 (tanpa +)"
              value={waNumber}
              onChange={(e) => setWaNumber(e.target.value)}
              className="flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="wa-enabled" checked={waEnabled} onChange={(e) => setWaEnabled(e.target.checked)} className="w-4 h-4 accent-amber-500" />
            <label htmlFor="wa-enabled" className="text-xs cursor-pointer">Aktifkan notifikasi WhatsApp</label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => saveWhatsappMut.mutate({ number: waNumber, enabled: waEnabled })} disabled={saveWhatsappMut.isPending || waNumber.trim().length === 0} className="bg-amber-500 hover:bg-amber-600 text-black">
              {saveWhatsappMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => testWhatsappMut.mutate()} disabled={testWhatsappMut.isPending || !data.settings.whatsapp.number}>
              {testWhatsappMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Kirim Tes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Engine Toggle Card ───────────────────────────────────────────────────────
function EngineToggleCard({ data, onRefetch }: { data: SystemStatus; onRefetch: () => void }) {
  const { toast } = useToast();

  const xauusdEnabled = data.engineEnabled?.xauusd ?? true;
  const btcEnabled = data.engineEnabled?.btc ?? true;

  const toggleXauusd = useMutation({
    mutationFn: (enabled: boolean) => adminPost("/api/xauusd/engine/toggle", { enabled }),
    onSuccess: (_r, enabled) => {
      toast({ title: enabled ? "✅ XAUUSD Brain dinyalakan" : "⛔ XAUUSD Brain dimatikan" });
      onRefetch();
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const toggleBtc = useMutation({
    mutationFn: (enabled: boolean) => adminPost("/api/btcusd/engine/toggle", { enabled }),
    onSuccess: (_r, enabled) => {
      toast({ title: enabled ? "✅ BTC Brain dinyalakan" : "⛔ BTC Brain dimatikan" });
      onRefetch();
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  function ToggleRow({
    label,
    icon,
    color,
    enabled,
    running,
    cycles,
    lastCycle,
    isPending,
    onToggle,
  }: {
    label: string;
    icon: React.ReactNode;
    color: string;
    enabled: boolean;
    running: boolean;
    cycles?: number;
    lastCycle?: string | null;
    isPending: boolean;
    onToggle: (v: boolean) => void;
  }) {
    return (
      <div className={`rounded-xl border p-4 transition-colors ${enabled ? "border-border/50 bg-background" : "border-border/30 bg-muted/20"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-lg ${enabled ? `bg-${color}-500/10` : "bg-muted/30"}`}>
              <span className={enabled ? `text-${color}-400` : "text-muted-foreground/40"}>
                {icon}
              </span>
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-semibold truncate ${enabled ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                {running ? (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    Berjalan{cycles !== undefined ? ` · ${cycles} siklus` : ""}
                  </span>
                ) : enabled ? "Berhenti sementara" : "Dinonaktifkan"}
                {lastCycle && (
                  <> · {new Date(lastCycle).toLocaleTimeString("id-ID")}</>
                )}
              </p>
            </div>
          </div>

          {/* Toggle switch */}
          <button
            type="button"
            disabled={isPending}
            onClick={() => onToggle(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${enabled ? "bg-emerald-500" : "bg-muted"}`}
            aria-pressed={enabled}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ${enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Power className="w-5 h-5 text-emerald-400" />
          Kontrol Brain Engine
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Nyala/matikan setiap brain engine secara independen. Pengaturan ini disimpan permanen — tetap aktif setelah server restart.
        </p>
        <ToggleRow
          label="XAUUSD Brain (Gold)"
          icon={<Zap className="w-4 h-4" />}
          color="amber"
          enabled={xauusdEnabled}
          running={data.engine.running}
          cycles={data.engine.totalCycles}
          lastCycle={data.engine.lastCycleAt}
          isPending={toggleXauusd.isPending}
          onToggle={(v) => toggleXauusd.mutate(v)}
        />
        <ToggleRow
          label="BTC Brain (Bitcoin)"
          icon={<Bitcoin className="w-4 h-4" />}
          color="orange"
          enabled={btcEnabled}
          running={data.btcEngine?.running ?? false}
          cycles={data.btcEngine?.totalCycles}
          lastCycle={data.btcEngine?.lastCycleAt}
          isPending={toggleBtc.isPending}
          onToggle={(v) => toggleBtc.mutate(v)}
        />
      </CardContent>
    </Card>
  );
}

// ─── Extreme Learning Mode Panel ──────────────────────────────────────────────

function formatEta(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} menit`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}j ${m}m` : `${h} jam`;
}

const TARGET_PRESETS = [50, 100, 250, 500, 1000];

function ExtremeModePanel({ data, onRefetch }: { data: SystemStatus; onRefetch: () => void }) {
  const { toast } = useToast();
  const em = data.engine.extremeMode;
  const [target, setTarget] = useState(100);
  const [questionsPerCycle, setQuestionsPerCycle] = useState(10);

  const startMut = useMutation({
    mutationFn: () => adminPost("/api/xauusd/engine/extreme/start", { target, questionsPerCycle }),
    onSuccess: () => {
      toast({ title: "🔥 Mode Ekstrem Dimulai", description: `Target: ${target} pertanyaan` });
      onRefetch();
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const stopMut = useMutation({
    mutationFn: () => adminPost("/api/xauusd/engine/extreme/stop"),
    onSuccess: () => {
      toast({ title: "⛔ Permintaan Berhenti Dikirim", description: "Menunggu pertanyaan selesai…" });
      onRefetch();
    },
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  const isStopping = em.active && em.stopRequested;
  const qualityRate = em.progress > 0 ? Math.round((em.insights / em.progress) * 100) : null;

  return (
    <Card className={`border-2 transition-colors ${em.active ? (isStopping ? "border-red-500/40 bg-red-500/5" : "border-orange-500/50 bg-orange-500/5") : "border-border/50"}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Flame className={`w-5 h-5 ${em.active ? (isStopping ? "text-red-400" : "text-orange-400 animate-pulse") : "text-muted-foreground"}`} />
            Mode Belajar Ekstrem
          </span>
          {em.active && (
            isStopping ? (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                MENGHENTIKAN…
              </span>
            ) : (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse">
                AKTIF
              </span>
            )
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status saat aktif */}
        {em.active ? (
          <div className="space-y-3">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Progress</span>
                <span className={`font-semibold tabular-nums ${isStopping ? "text-red-400" : "text-orange-400"}`}>
                  {em.progress} / {em.target} pertanyaan ({em.percentDone}%)
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all duration-700 ${isStopping ? "bg-gradient-to-r from-red-600 to-red-400" : "bg-gradient-to-r from-orange-500 to-amber-400"}`}
                  style={{ width: `${em.percentDone}%` }}
                />
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2">
              <div className="text-center rounded-lg bg-muted/40 py-2 px-1">
                <p className="text-base font-bold tabular-nums text-orange-400">{em.progress}</p>
                <p className="text-[10px] text-muted-foreground">Dijawab</p>
              </div>
              <div className="text-center rounded-lg bg-muted/40 py-2 px-1">
                <p className="text-base font-bold tabular-nums text-emerald-400">{em.insights}</p>
                <p className="text-[10px] text-muted-foreground">Insights</p>
              </div>
              <div className="text-center rounded-lg bg-muted/40 py-2 px-1">
                <p className="text-base font-bold tabular-nums text-violet-400">{em.cycles}</p>
                <p className="text-[10px] text-muted-foreground">Siklus</p>
              </div>
              <div className="text-center rounded-lg bg-muted/40 py-2 px-1">
                <p className={`text-base font-bold tabular-nums ${qualityRate !== null && qualityRate >= 60 ? "text-emerald-400" : "text-amber-400"}`}>
                  {qualityRate !== null ? `${qualityRate}%` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">Kualitas</p>
              </div>
            </div>

            {/* ETA & speed row */}
            <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
              {em.speedQph > 0 && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Kecepatan</span>
                  <span className="font-medium text-foreground/70 tabular-nums">{em.speedQph} pertanyaan/jam</span>
                </div>
              )}
              {em.etaMs !== null && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Estimasi selesai</span>
                  <span className="font-medium text-orange-400/90 tabular-nums">~{formatEta(em.etaMs)}</span>
                </div>
              )}
                  <div className="flex items-center justify-between">
                <span>Sumber data</span>
                {em.dataMode === "live" ? (
                  <span className="flex items-center gap-1 font-medium text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    Live market
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-medium text-blue-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                    Data historis
                  </span>
                )}
              </div>
              {em.startedAt && (
                <div className="flex items-center justify-between">
                  <span>Mulai</span>
                  <span className="font-medium text-foreground/60">{new Date(em.startedAt).toLocaleString("id-ID")}</span>
                </div>
              )}
            </div>

            <Button
              className={`w-full gap-2 border-0 text-white ${isStopping ? "bg-red-800/60 cursor-not-allowed" : "bg-red-600/80 hover:bg-red-600"}`}
              size="sm"
              onClick={() => stopMut.mutate()}
              disabled={stopMut.isPending || isStopping}
            >
              {isStopping
                ? <><Loader2 className="w-4 h-4 animate-spin" />Menghentikan…</>
                : <><StopCircle className="w-4 h-4" />Hentikan Mode Ekstrem</>}
            </Button>

            {!isStopping && (
              <p className="text-[11px] text-muted-foreground/70 text-center">
                Akan berhenti setelah pertanyaan yang sedang berjalan selesai dijawab
              </p>
            )}
          </div>
        ) : (
          /* Konfigurasi saat tidak aktif */
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Belajar non-stop sampai target tercapai. Jeda 15–30 detik antar pertanyaan, pool otomatis diperluas ke timeframe 4h/1d saat 1h habis. Circuit breaker dengan retry otomatis (3×) jika AI gagal merespons.
            </p>

            {/* Preset buttons */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Target className="w-3 h-3" /> Preset Target</p>
              <div className="flex gap-1.5 flex-wrap">
                {TARGET_PRESETS.map(p => (
                  <button
                    key={p}
                    onClick={() => setTarget(p)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${target === p ? "bg-orange-500/20 border-orange-500/50 text-orange-400 font-semibold" : "border-border/50 text-muted-foreground hover:border-orange-500/30 hover:text-orange-400/80"}`}
                  >
                    {p >= 1000 ? `${p / 1000}k` : p}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" /> Target Pertanyaan
                </label>
                <input
                  type="number"
                  min={10}
                  max={10000}
                  value={target}
                  onChange={(e) => setTarget(Math.max(10, Math.min(10000, parseInt(e.target.value) || 100)))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <BarChart2 className="w-3 h-3" /> Pertanyaan/Siklus
                </label>
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={questionsPerCycle}
                  onChange={(e) => setQuestionsPerCycle(Math.max(3, Math.min(20, parseInt(e.target.value) || 10)))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>

            <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
              <div className="flex items-center justify-between">
                <span>Estimasi waktu</span>
                <span className="tabular-nums font-medium text-foreground/70">
                  ~{Math.round(target * ((15 + 30) / 2 + 45) / 60)} menit
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Jeda antar pertanyaan</span>
                <span className="font-medium text-foreground/70">15–30 detik acak</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Quality threshold</span>
                <span className="font-medium text-emerald-400">≥ 0.65 (ketat)</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pool expansion</span>
                <span className="font-medium text-blue-400">1h → 4h → 1d otomatis</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Circuit breaker</span>
                <span className="font-medium text-amber-400">5 min backoff × 3 retry</span>
              </div>
            </div>

            <Button
              className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-black font-semibold"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending || !data.settings.hasDeepseekKey}
            >
              {startMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Flame className="w-4 h-4" />}
              Mulai Mode Ekstrem ({target} Pertanyaan)
            </Button>

            {!data.settings.hasDeepseekKey && (
              <p className="text-xs text-amber-400 text-center flex items-center justify-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                Set DeepSeek API Key dulu agar mode ekstrem bisa berjalan
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const token = getAdminToken();

  // Redirect ke login jika belum auth
  useEffect(() => {
    if (!token) navigate("/login?role=admin&redirect=/admin");
  }, [token, navigate]);

  const { data, isLoading, error, refetch, isFetching } = useQuery<SystemStatus>({
    queryKey: ["admin-system"],
    queryFn: async () => {
      const res = await adminFetch("/api/admin/system");
      if (res.status === 403 || res.status === 401) {
        clearAdminToken();
        navigate("/login?role=admin&redirect=/admin");
        throw new Error("Sesi admin berakhir");
      }
      if (!res.ok) throw new Error("Gagal memuat status sistem");
      return res.json();
    },
    enabled: !!token,
    // Refresh 3s saat extreme mode aktif agar progress bar, ETA, dan kecepatan update real-time
    refetchInterval: (q) => (q.state.data?.engine?.extremeMode?.active ? 3_000 : 20_000),
  });

  const handleLogout = () => {
    clearAdminToken();
    navigate("/login?role=admin");
  };

  const learnNowMut = useMutation({
    mutationFn: () => adminPost("/api/xauusd/learn-now"),
    onSuccess: () => toast({ title: "✅ Siklus Belajar Selesai" }),
    onError: (e) => toast({ title: "Error", description: String(e), variant: "destructive" }),
  });

  if (!token) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Status sistem dan konfigurasi XAUUSD Brain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2 border-border/50 hover:border-primary/40 hover:text-primary">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2 text-muted-foreground hover:text-red-400">
            <LogOut className="w-3.5 h-3.5" />
            Logout
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span>Memuat status sistem...</span>
        </div>
      )}

      {error && (
        <Card className="border-red-500/25 bg-red-500/5">
          <CardContent className="pt-6">
            <p className="text-red-400 text-sm">⚠ {String(error)}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="space-y-4">
          {/* Live Price */}
          {data.livePrice?.price != null && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-foreground/80">XAUUSD Live Price</span>
                    {data.livePrice.stale && <span className="text-[10px] text-amber-400/80 border border-amber-400/30 rounded px-1.5 py-0.5">stale</span>}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary tabular-nums">${data.livePrice.price.toFixed(2)}</p>
                    {data.livePrice.changePct != null && (
                      <p className={`text-xs font-medium tabular-nums ${data.livePrice.changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {data.livePrice.changePct >= 0 ? "+" : ""}{data.livePrice.changePct.toFixed(2)}%
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Engine Toggle */}
          <EngineToggleCard data={data} onRefetch={() => refetch()} />

          {/* Brain Engine Stats */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <span className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-violet-400" />
                  Brain Engine
                </span>
                <Button size="sm" variant="outline" onClick={() => learnNowMut.mutate()} disabled={learnNowMut.isPending} className="text-xs h-7">
                  {learnNowMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "⚡ Belajar Sekarang"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status XAUUSD</span>
                <StatusBadge ok={data.engine.running} label={data.engine.running ? "Running" : "Stopped"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Siklus Belajar</span>
                <span className="text-sm font-semibold tabular-nums">{data.engine.totalCycles}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Insights</span>
                <span className="text-sm font-semibold tabular-nums text-emerald-400">{data.engine.totalInsights}</span>
              </div>
              {data.engine.lastCycleAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Siklus Terakhir (Gold)</span>
                  <span className="text-sm text-foreground/70">{new Date(data.engine.lastCycleAt).toLocaleString("id-ID")}</span>
                </div>
              )}
              {data.btcEngine?.lastCycleAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Siklus Terakhir (BTC)</span>
                  <span className="text-sm text-foreground/70">{new Date(data.btcEngine.lastCycleAt).toLocaleString("id-ID")}</span>
                </div>
              )}
              {data.engine.isLearning && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sedang belajar...
                </div>
              )}
            </CardContent>
          </Card>

          {/* Member status */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="w-5 h-5 text-blue-400" />
                Status Akses
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Admin</span>
                <StatusBadge ok={true} label="Aktif (SESSION_SECRET)" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Member</span>
                <StatusBadge ok={data.member.hasPassword} label={data.member.hasPassword ? "Password diset" : "Belum dikonfigurasi"} />
              </div>
            </CardContent>
          </Card>

          {/* Server Time */}
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="w-4 h-4" />
                  Server Time
                </div>
                <span className="text-sm text-foreground/70 tabular-nums">
                  {new Date(data.serverTime).toLocaleString("id-ID")}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Extreme Learning Mode */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Flame className="w-5 h-5 text-orange-400" />
              <h2 className="text-lg font-semibold">Mode Belajar Ekstrem</h2>
            </div>
            <ExtremeModePanel data={data} onRefetch={() => refetch()} />
          </div>

          {/* Settings */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Key className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold">Pengaturan Sistem</h2>
            </div>
            <SettingsPanel data={data} onRefetch={() => refetch()} />
          </div>
        </div>
      )}
    </div>
  );
}
