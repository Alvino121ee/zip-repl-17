/**
 * Admin / System page — status engine XAUUSD Brain
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Brain, Cpu, Clock, Key, Phone, Zap, CheckCircle2, XCircle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SystemStatus {
  ok: boolean;
  engine: {
    running: boolean;
    cycleCount: number;
    lastCycleAt: string | null;
    nextCycleIn: number | null;
  };
  settings: {
    hasDeepseekKey: boolean;
    deepseekKeySource: "database" | "environment" | "none";
    predictionTimeframeMinutes: number;
    whatsapp: { number: string; enabled: boolean };
  };
  livePrice: {
    price: number | null;
    change: number | null;
    changePct: number | null;
    timestamp: number | null;
    stale: boolean;
    error: string | null;
  } | null;
  serverTime: string;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ok ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" : "bg-red-500/10 border-red-500/25 text-red-400"}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </div>
  );
}

export default function AdminPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<SystemStatus>({
    queryKey: ["admin-system"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system");
      if (!res.ok) throw new Error("Gagal memuat status sistem");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Cpu className="w-6 h-6 text-primary" />
            System Status
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Status engine XAUUSD Brain dan konfigurasi sistem
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2 border-border/50 hover:border-primary/40 hover:text-primary"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
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
            <p className="text-red-400 text-sm">⚠ Gagal memuat status: {String(error)}</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <div className="space-y-4">
          {/* Live Price */}
          {data.livePrice && data.livePrice.price !== null && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium text-foreground/80">XAUUSD Live Price</span>
                    {data.livePrice.stale && (
                      <span className="text-[10px] text-amber-400/80 border border-amber-400/30 rounded px-1.5 py-0.5">stale</span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary tabular-nums">
                      ${data.livePrice.price.toFixed(2)}
                    </p>
                    {data.livePrice.changePct !== null && (
                      <p className={`text-xs font-medium tabular-nums ${data.livePrice.changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {data.livePrice.changePct >= 0 ? "+" : ""}{data.livePrice.changePct.toFixed(2)}%
                      </p>
                    )}
                    {data.livePrice.timestamp && (
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {new Date(data.livePrice.timestamp).toLocaleTimeString("id-ID")}
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
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="w-5 h-5 text-violet-400" />
                Brain Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge ok={data.engine.running} label={data.engine.running ? "Running" : "Stopped"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total Siklus Belajar</span>
                <span className="text-sm font-semibold text-foreground tabular-nums">{data.engine.cycleCount}</span>
              </div>
              {data.engine.lastCycleAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Siklus Terakhir</span>
                  <span className="text-sm text-foreground/70">
                    {new Date(data.engine.lastCycleAt).toLocaleString("id-ID")}
                  </span>
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

          {/* AI Config */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Key className="w-5 h-5 text-amber-400" />
                Konfigurasi AI
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">DeepSeek API Key</span>
                <StatusBadge ok={data.settings.hasDeepseekKey} label={data.settings.hasDeepseekKey ? `Tersedia (${data.settings.deepseekKeySource})` : "Belum diset"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Timeframe Prediksi</span>
                <Badge variant="outline" className="border-border/50 text-foreground/70">
                  {data.settings.predictionTimeframeMinutes} menit
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* WhatsApp */}
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="w-5 h-5 text-green-400" />
                Notifikasi WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <StatusBadge ok={data.settings.whatsapp.enabled} label={data.settings.whatsapp.enabled ? "Aktif" : "Nonaktif"} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Nomor Tujuan</span>
                <span className="text-sm text-foreground/70 font-mono">
                  {data.settings.whatsapp.number || "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* System Time */}
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

          <p className="text-xs text-muted-foreground/50 text-center pb-2">
            Untuk mengubah pengaturan AI (API key, timeframe, WhatsApp), buka tab{" "}
            <strong className="text-primary/70">Settings</strong> di halaman Gold AI.
          </p>
        </div>
      )}
    </div>
  );
}
