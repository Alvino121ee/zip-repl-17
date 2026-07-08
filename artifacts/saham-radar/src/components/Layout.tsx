import { useState } from "react";
import { Link, useLocation } from "wouter";
import { TrendingUp, Settings, Menu, X, Zap, Lock, Bitcoin } from "lucide-react";
import { isAdmin } from "@/lib/auth";

// Layout hanya digunakan untuk halaman admin
const navItems = [
  { href: "/admin", label: "XAUUSD AI", sublabel: "Gold trading AI & analisis", icon: TrendingUp, role: "admin" as const },
  { href: "/admin/btc", label: "BTCUSD AI", sublabel: "Bitcoin trading AI & analisis", icon: Bitcoin, role: "admin" as const },
  { href: "/admin/settings", label: "Pengaturan", sublabel: "Konfigurasi sistem", icon: Settings, role: "admin" as const },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* ── Sidebar (desktop) ───────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border/50 bg-sidebar sticky top-0 h-screen">
        <SidebarContent location={location} />
      </aside>

      {/* ── Mobile header + drawer ────────────────────────── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 flex items-center justify-between px-4 h-14 border-b border-border/50 bg-sidebar/95 backdrop-blur">
        <Brand />
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-white/5 transition-colors"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed top-14 left-0 bottom-0 z-50 w-60 border-r border-border/50 bg-sidebar flex flex-col">
            <SidebarContent location={location} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* ── Main content ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-dvh md:min-h-screen">
        <main className="flex-1 mt-14 md:mt-0 p-4 md:p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
        <footer className="border-t border-border/40 px-6 py-3 text-center text-xs text-muted-foreground/60">
          GoldRadar AI · Analisis berbasis algoritma, bukan rekomendasi trading · Gunakan dengan bijak
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)]">
        <Zap className="w-4 h-4 text-primary" />
      </div>
      <div className="leading-none">
        <span className="text-base font-bold tracking-tight text-foreground">GoldRadar</span>
        <span className="text-base font-bold tracking-tight text-primary">.ai</span>
      </div>
    </div>
  );
}

function SidebarContent({
  location,
  onNavigate,
}: {
  location: string;
  onNavigate?: () => void;
}) {
  const adminAuthed = isAdmin();

  return (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-border/40">
        <Brand />
        <p className="mt-1.5 text-[10px] font-medium tracking-widest uppercase text-muted-foreground/60 pl-0.5">
          Admin Panel
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const locked = !adminAuthed;

          return (
            <Link
              key={item.href}
              href={locked
                ? `/login/admin?redirect=${item.href}`
                : item.href}
              onClick={onNavigate}
              className={`
                group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 cursor-pointer
                ${isActive
                  ? "bg-primary/15 border border-primary/25 shadow-[0_0_16px_rgba(245,158,11,0.12)]"
                  : "hover:bg-white/5 border border-transparent"
                }
              `}
            >
              <div
                className={`
                  w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200
                  ${isActive
                    ? "bg-primary/20 border border-primary/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]"
                    : "bg-white/5 border border-white/10 group-hover:bg-primary/10 group-hover:border-primary/20"
                  }
                `}
              >
                <item.icon
                  className={`w-4 h-4 transition-colors ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-primary/80"}`}
                />
              </div>
              <div className="leading-none min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold truncate transition-colors ${isActive ? "text-primary" : "text-foreground/80 group-hover:text-foreground"}`}
                >
                  {item.label}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">{item.sublabel}</p>
              </div>
              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                {locked && (
                  <Lock className="w-3 h-3 text-muted-foreground/40" />
                )}
                {isActive && !locked && (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
                )}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Live indicator */}
      <div className="px-4 py-4 border-t border-border/40">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-xs text-emerald-400/80 font-medium">Brain Engine Aktif</span>
        </div>
      </div>
    </>
  );
}
