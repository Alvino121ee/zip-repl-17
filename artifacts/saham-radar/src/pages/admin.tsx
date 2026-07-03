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
  Activity, Brain, Cpu, Clock, Key, Phone, Zap, CheckCircle2,
  XCircle, RefreshCw, LogOut, ShieldCheck, Users, KeyRound,
  Target, Bell, Loader2, Eye, EyeOff,
} from "lucide-react";
import { getAdminToken, clearAdminToken, authFetch } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SystemStatus {
  ok: boolean;
  engine: { running: boolean; cycleCount: number; lastCycleAt: string | null; nextCycleIn: number | null };
  settings: {
    hasDeepseekKey: boolean;
    deepseekKeySource: "database" | "environment" | "none";
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
    refetchInterval: 20_000,
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

          {/* Brain Engine */}
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
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge ok={data.engine.running} label={data.engine.running ? "Running" : "Stopped"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Siklus Belajar</span>
                <span className="text-sm font-semibold tabular-nums">{data.engine.cycleCount}</span>
              </div>
              {data.engine.lastCycleAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Siklus Terakhir</span>
                  <span className="text-sm text-foreground/70">{new Date(data.engine.lastCycleAt).toLocaleString("id-ID")}</span>
                </div>
              )}
              {data.engine.nextCycleIn != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Siklus Berikutnya</span>
                  <span className="text-sm text-foreground/70 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {Math.round(data.engine.nextCycleIn / 60)} menit lagi
                  </span>
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
