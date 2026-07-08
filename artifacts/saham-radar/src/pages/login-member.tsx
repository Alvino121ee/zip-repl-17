/**
 * Login Member — halaman khusus login member (terpisah dari admin)
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Lock, Mail, Eye, EyeOff, Loader2, UserPlus, MessageSquare, Brain, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setMemberToken, setMemberEmail } from "@/lib/auth";
import AuthShell from "@/components/AuthShell";

export default function LoginMemberPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    if (!password.trim()) return;
    if (!email.trim()) return setError("Email diperlukan");
    setLoading(true);
    setError("");
    try {
      const body = { role: "member", email: email.trim(), password };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; email?: string | null; error?: string; code?: string };
      if (!res.ok || !data.ok) {
        if (data.code === "EMAIL_NOT_VERIFIED") {
          navigate(`/verify-email?email=${encodeURIComponent(email.trim())}`);
          return;
        }
        setError(data.error ?? "Login gagal");
        return;
      }
      setMemberToken(data.token!);
      if (data.email) setMemberEmail(data.email);
      navigate(redirect || "/member");
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      side={{
        eyebrow: "Area Member",
        title: (
          <>
            Chat langsung dengan{" "}
            <span className="text-primary drop-shadow-[0_0_24px_rgba(245,158,11,0.35)]">
              AI Expert Gold
            </span>
          </>
        ),
        description:
          "Masuk untuk mengakses prediksi AI real-time, analisis multi-timeframe, dan chat langsung dengan AI yang belajar mandiri 24/7 khusus XAUUSD.",
        accentClassName:
          "bg-[radial-gradient(ellipse_at_top_left,_rgba(245,158,11,0.12),_transparent_60%)]",
        bullets: [
          { icon: <MessageSquare className="w-3.5 h-3.5 text-primary" />, label: "Chat AI Expert Gold 24/7" },
          { icon: <Brain className="w-3.5 h-3.5 text-primary" />, label: "Prediksi AI yang terus belajar" },
          { icon: <BarChart2 className="w-3.5 h-3.5 text-primary" />, label: "Analisis multi-timeframe lengkap" },
        ],
      }}
    >
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1.5">Masuk sebagai Member</h2>
        <p className="text-sm text-muted-foreground">Akses chat AI dan fitur member Anda</p>
      </div>

      <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
        {/* Email */}
        <div className="relative mb-3">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            type="email"
            placeholder="Email Anda"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
            autoFocus
          />
        </div>

        {/* Password */}
        <div className="relative mb-4">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
          <Input
            type={showPwd ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            className="pl-10 pr-10 bg-background/50 border-border/50 focus:border-primary/50"
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
          disabled={loading || !password.trim() || !email.trim()}
          className="w-full bg-primary hover:bg-primary/90 text-black font-semibold"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Masuk sebagai Member"}
        </Button>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Belum punya akun?{" "}
          <button
            type="button"
            onClick={() => navigate("/register")}
            className="text-primary hover:text-primary/80 font-medium inline-flex items-center gap-1"
          >
            <UserPlus className="w-3 h-3" />
            Daftar sekarang
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-muted-foreground/50 mt-6">
        Login sebagai admin?{" "}
        <button
          type="button"
          onClick={() => navigate("/login/admin")}
          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Masuk ke Admin Console
        </button>
      </p>
    </AuthShell>
  );
}
