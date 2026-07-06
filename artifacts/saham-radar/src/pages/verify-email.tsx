/**
 * Verify Email page — masukkan kode 6-digit yang dikirim ke email
 */
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Zap, Mail, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setMemberToken, setMemberEmail } from "@/lib/auth";

export default function VerifyEmailPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const emailParam = params.get("email") ?? "";

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const codeString = code.join("");

  const handleDigit = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[idx] = digit;
    setCode(next);
    setError("");
    if (digit && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
    // Auto-submit jika 6 digit terisi
    if (next.every((d) => d !== "") && digit) {
      handleVerify(next.join(""));
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const next = pasted.split("");
      setCode(next);
      setError("");
      inputRefs.current[5]?.focus();
      handleVerify(pasted);
    }
  };

  const handleVerify = async (codeStr?: string) => {
    const finalCode = codeStr ?? codeString;
    if (finalCode.length !== 6) return setError("Masukkan 6 digit kode");
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParam, code: finalCode }),
      });
      const data = (await res.json()) as { ok: boolean; token?: string; email?: string; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Verifikasi gagal");
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }
      setMemberToken(data.token!);
      if (data.email) setMemberEmail(data.email);
      setSuccess(true);
      setTimeout(() => navigate("/member"), 1500);
    } catch {
      setError("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setResendMsg("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParam }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      setResendMsg(data.ok ? "Kode baru sudah dikirim!" : (data.error ?? "Gagal mengirim ulang"));
    } catch {
      setResendMsg("Gagal terhubung ke server");
    } finally {
      setResending(false);
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
        <div className="bg-card/60 border border-border/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm text-center">
          {success ? (
            <div className="py-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
              <p className="text-lg font-semibold text-foreground">Email Terverifikasi!</p>
              <p className="text-sm text-muted-foreground mt-1">Mengalihkan ke halaman member...</p>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-primary" />
              </div>
              <h1 className="text-lg font-semibold mb-1">Cek Email Anda</h1>
              <p className="text-xs text-muted-foreground mb-1">
                Kode verifikasi 6-digit dikirim ke:
              </p>
              <p className="text-sm font-medium text-primary mb-6">{emailParam}</p>

              {/* 6-digit input */}
              <div className="flex gap-2 justify-center mb-5" onPaste={handlePaste}>
                {code.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { inputRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigit(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className={`w-10 h-12 text-center text-xl font-bold rounded-lg border bg-background/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                      digit ? "border-primary/50 text-primary" : "border-border/50 text-foreground"
                    }`}
                  />
                ))}
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Verify button */}
              <Button
                onClick={() => handleVerify()}
                disabled={loading || codeString.length !== 6}
                className="w-full bg-primary hover:bg-primary/90 text-black font-semibold mb-4"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verifikasi"}
              </Button>

              {/* Resend */}
              <div className="flex items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">Tidak menerima kode?</span>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-50"
                >
                  {resending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Kirim ulang
                </button>
              </div>
              {resendMsg && (
                <p className={`text-xs mt-2 ${resendMsg.includes("berhasil") || resendMsg.includes("dikirim") ? "text-emerald-400" : "text-red-400"}`}>
                  {resendMsg}
                </p>
              )}
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          GoldRadar.ai · Platform AI Trading XAUUSD
        </p>
      </div>
    </div>
  );
}
