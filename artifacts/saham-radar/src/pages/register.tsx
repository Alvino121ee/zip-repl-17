/**
 * Register page — daftar akun member baru dengan email + password
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Zap, Mail, Lock, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async () => {
    setError("");
    if (!email.trim()) return setError("Email diperlukan");
    if (!/^[^\s@]+@gmail\.com$/i.test(email.trim())) return setError("Hanya email @gmail.com yang diperbolehkan");
    if (password.length < 8) return setError("Password minimal 8 karakter");
    if (password !== confirmPwd) return setError("Password dan konfirmasi tidak sama");

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; email?: string; token?: string; memberId?: number };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Pendaftaran gagal");
        return;
      }
      // Berhasil — simpan token dan langsung masuk ke member
      if (data.token) {
        sessionStorage.setItem("gr_member_token", data.token);
        sessionStorage.setItem("gr_member_email", data.email ?? email.trim());
      }
      navigate("/member");
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_16px_rgba(245,158,11,0.3)]">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div className="leading-none">
            <span className="text-2xl font-bold tracking-tight text-foreground">GoldRadar</span>
            <span className="text-2xl font-bold tracking-tight text-primary">.ai</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-1">
            <UserPlus className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">Daftar Member</h1>
          </div>
          <p className="text-xs text-muted-foreground mb-6">
            Buat akun untuk akses fitur member GoldRadar.ai
          </p>

          {/* Email */}
          <div className="relative mb-3">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              type="email"
              placeholder="Email Gmail (contoh@gmail.com)"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
              autoFocus
            />
          </div>

          {/* Password */}
          <div className="relative mb-3">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              type={showPwd ? "text" : "password"}
              placeholder="Password (min. 8 karakter)"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              className="pl-10 pr-10 bg-background/50 border-border/50 focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Confirm Password */}
          <div className="relative mb-4">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              type={showPwd ? "text" : "password"}
              placeholder="Konfirmasi password"
              value={confirmPwd}
              onChange={(e) => { setConfirmPwd(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleRegister()}
              className="pl-10 bg-background/50 border-border/50 focus:border-primary/50"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400 text-center">
              {error}
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleRegister}
            disabled={loading || !email.trim() || !password || !confirmPwd}
            className="w-full bg-primary hover:bg-primary/90 text-black font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Daftar Sekarang"}
          </Button>

          <div className="mt-4 text-center text-xs text-muted-foreground">
            Sudah punya akun?{" "}
            <button
              type="button"
              onClick={() => navigate("/login?role=member")}
              className="text-primary hover:text-primary/80 font-medium"
            >
              Login di sini
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          GoldRadar.ai · Platform AI Trading XAUUSD
        </p>
      </div>
    </div>
  );
}
