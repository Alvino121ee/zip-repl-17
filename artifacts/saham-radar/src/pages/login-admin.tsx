/**
 * Login Admin — halaman khusus login admin (terpisah dari member)
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Eye, EyeOff, Loader2, ShieldCheck, Settings, Activity, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setAdminToken } from "@/lib/auth";
import AuthShell from "@/components/AuthShell";

export default function LoginAdminPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect") ?? "/admin";

  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", password }),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Login gagal");
        return;
      }
      setAdminToken(data.token!);
      navigate(redirect);
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      side={{
        eyebrow: "Admin Console",
        title: (
          <>
            Kendalikan penuh{" "}
            <span className="text-primary drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]">
              Brain Engine GoldRadar
            </span>
          </>
        ),
        description:
          "Akses panel kontrol untuk memantau performa AI, mengelola member, mengatur konfigurasi sistem, dan mengawasi seluruh operasional platform.",
        accentClassName:
          "bg-[radial-gradient(ellipse_at_top_left,_rgba(139,92,246,0.10),_transparent_60%)]",
        bullets: [
          { icon: <Activity className="w-3.5 h-3.5 text-primary" />, label: "Monitoring performa AI real-time" },
          { icon: <Settings className="w-3.5 h-3.5 text-primary" />, label: "Konfigurasi sistem & API key" },
          { icon: <KeyRound className="w-3.5 h-3.5 text-primary" />, label: "Manajemen member & akses" },
        ],
      }}
    >
      <div className="mb-6">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-border/50 flex items-center justify-center mb-4">
          <ShieldCheck className="w-5 h-5 text-primary" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-1.5">Admin Console</h2>
        <p className="text-sm text-muted-foreground">Akses terbatas untuk administrator sistem</p>
      </div>

      <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
        <div className="relative mb-4">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            type={showPwd ? "text" : "password"}
            placeholder="Password admin"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="pl-10 pr-10 bg-background/50 border-border/50 focus:border-primary/50"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400 text-center">
            {error}
          </div>
        )}

        <Button
          onClick={handleLogin}
          disabled={loading || !password.trim()}
          className="w-full bg-primary hover:bg-primary/90 text-black font-semibold"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Masuk sebagai Admin"}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground/50 mt-6">
        Anda member?{" "}
        <button
          type="button"
          onClick={() => navigate("/login/member")}
          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Masuk ke area member
        </button>
      </p>
    </AuthShell>
  );
}
