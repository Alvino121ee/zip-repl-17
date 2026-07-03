/**
 * Login page — untuk admin dan member
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Zap, Lock, Eye, EyeOff, Loader2, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setAdminToken, setMemberToken } from "@/lib/auth";

type Role = "member" | "admin";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const defaultRole: Role = (params.get("role") as Role) ?? "member";
  const redirect = params.get("redirect") ?? "";

  const [role, setRole] = useState<Role>(defaultRole);
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
        body: JSON.stringify({ role, password }),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Login gagal");
        return;
      }
      if (role === "admin") setAdminToken(data.token!);
      else setMemberToken(data.token!);

      const target = redirect || (role === "admin" ? "/admin" : "/member");
      navigate(target);
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
          {/* Role switcher */}
          <div className="flex rounded-xl overflow-hidden border border-border/50 mb-6 p-1 gap-1 bg-background/40">
            {(["member", "admin"] as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => { setRole(r); setError(""); setPassword(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  role === r
                    ? "bg-primary/20 text-primary border border-primary/30 shadow-[0_0_10px_rgba(245,158,11,0.15)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                {r === "member" ? <Users className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                {r === "member" ? "Member" : "Admin"}
              </button>
            ))}
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground text-center mb-5">
            {role === "member"
              ? "Login untuk mengakses chat AI dan fitur member"
              : "Login untuk mengakses pengaturan dan panel admin"}
          </p>

          {/* Password input */}
          <div className="relative mb-4">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/60" />
            <Input
              type={showPwd ? "text" : "password"}
              placeholder={role === "member" ? "Password member" : "Password admin"}
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

          {/* Error */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400 text-center">
              {error}
            </div>
          )}

          {/* Submit */}
          <Button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            className="w-full bg-primary hover:bg-primary/90 text-black font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : `Masuk sebagai ${role === "member" ? "Member" : "Admin"}`}
          </Button>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          GoldRadar.ai · Platform AI Trading XAUUSD
        </p>
      </div>
    </div>
  );
}
