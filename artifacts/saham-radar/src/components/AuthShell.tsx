/**
 * AuthShell — layout split-screen profesional untuk halaman login admin & member.
 * Panel kiri: branding/pesan sesuai peran. Panel kanan: form.
 */
import { Link } from "wouter";
import { Zap } from "lucide-react";
import type { ReactNode } from "react";

interface AuthShellProps {
  side: {
    eyebrow: string;
    title: ReactNode;
    description: string;
    accentClassName: string; // tailwind classes for glow/gradient accent
    bullets: { icon: ReactNode; label: string }[];
  };
  children: ReactNode;
}

export default function AuthShell({ side, children }: AuthShellProps) {
  return (
    <div className="min-h-dvh bg-background flex">
      {/* ── Panel kiri: branding ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden border-r border-border/40">
        <div className={`absolute inset-0 pointer-events-none ${side.accentClassName}`} />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer w-fit">
              <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)]">
                <Zap className="w-4 h-4 text-primary" />
              </div>
              <div className="leading-none">
                <span className="text-base font-bold tracking-tight text-foreground">GoldRadar</span>
                <span className="text-base font-bold tracking-tight text-primary">.ai</span>
              </div>
            </div>
          </Link>

          <div className="max-w-md">
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-4">
              {side.eyebrow}
            </p>
            <h1 className="text-3xl xl:text-4xl font-extrabold tracking-tight text-foreground leading-[1.15] mb-4">
              {side.title}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed mb-8">
              {side.description}
            </p>
            <ul className="space-y-3">
              {side.bullets.map((b) => (
                <li key={b.label} className="flex items-center gap-3 text-sm text-foreground/90">
                  <div className="w-7 h-7 rounded-lg bg-white/5 border border-border/50 flex items-center justify-center shrink-0">
                    {b.icon}
                  </div>
                  {b.label}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[11px] text-muted-foreground/40">
            © {new Date().getFullYear()} GoldRadar.ai — Platform AI Trading XAUUSD
          </p>
        </div>
      </div>

      {/* ── Panel kanan: form ────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          {/* Brand mobile only */}
          <Link href="/">
            <div className="flex lg:hidden items-center justify-center gap-2.5 mb-8 cursor-pointer">
              <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_16px_rgba(245,158,11,0.3)]">
                <Zap className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="leading-none">
                <span className="text-xl font-bold tracking-tight text-foreground">GoldRadar</span>
                <span className="text-xl font-bold tracking-tight text-primary">.ai</span>
              </div>
            </div>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
