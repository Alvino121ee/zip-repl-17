/**
 * Home / Landing Page — halaman publik yang menjelaskan GoldRadar.ai
 * Berisi: hero, fitur, info akses member, tombol login
 */
import { Link } from "wouter";
import {
  Zap, Brain, TrendingUp, Clock, Lock, BarChart2,
  MessageSquare, ChevronRight, Shield, Target, Cpu, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const FEATURES = [
  {
    icon: Brain,
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    title: "AI Belajar Mandiri 24/7",
    desc: "Brain Engine kami terus belajar dari setiap pergerakan harga gold. Semakin lama berjalan, semakin cerdas prediksinya.",
  },
  {
    icon: Target,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    title: "Prediksi Real-Time",
    desc: "AI menganalisis RSI, EMA, MACD, Bollinger Bands, dan pola pasar untuk menghasilkan prediksi arah XAUUSD secara otomatis.",
  },
  {
    icon: MessageSquare,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    title: "Chat AI Expert",
    desc: "Tanya apapun seputar gold, teknikal analisis, atau strategi trading langsung ke AI kami yang terlatih khusus XAUUSD.",
  },
  {
    icon: BarChart2,
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
    title: "Multi-Timeframe Analysis",
    desc: "Analisis lengkap dari M1 hingga D1. Lihat konfluensi sinyal dari berbagai timeframe sekaligus untuk keputusan lebih akurat.",
  },
  {
    icon: Cpu,
    color: "text-orange-400",
    bg: "bg-orange-500/10 border-orange-500/20",
    title: "Autonomous Learning Engine",
    desc: "Setiap 5–15 menit, AI mereview prediksi sebelumnya, menulis self-critique jika salah, dan menyimpannya sebagai pelajaran baru.",
  },
  {
    icon: Shield,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10 border-cyan-500/20",
    title: "Data TradingView Live",
    desc: "Harga XAUUSD diambil langsung dari TradingView (OANDA) — sama seperti yang tampil di platform broker Anda.",
  },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Pantau Pasar", desc: "Fetch harga XAUUSD realtime, hitung semua indikator teknikal setiap siklus", color: "text-amber-400" },
  { step: "2", title: "Generate Prediksi", desc: "AI menganalisis kondisi pasar dan membuat prediksi arah dengan confidence score", color: "text-orange-400" },
  { step: "3", title: "Belajar & Koreksi", desc: "Setelah interval waktu, AI verifikasi prediksi dan tulis self-critique jika salah", color: "text-purple-400" },
  { step: "4", title: "Makin Cerdas", desc: "Setiap siklus menambah insight baru ke 'otak AI' — akurasi terus meningkat seiring waktu", color: "text-cyan-400" },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="leading-none">
              <span className="text-base font-bold tracking-tight text-foreground">GoldRadar</span>
              <span className="text-base font-bold tracking-tight text-primary">.ai</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Link href="/login?role=admin">
              <button className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5">
                Admin
              </button>
            </Link>
            <Link href="/login?role=member&redirect=/member">
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-black font-semibold text-xs gap-1.5">
                <Lock className="w-3 h-3" />
                Login Member
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="relative flex-1 flex flex-col items-center justify-center text-center px-4 py-20 sm:py-28 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/8 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-amber-600/5 rounded-full blur-[80px]" />
        </div>

        <div className="relative max-w-3xl mx-auto">
          <Badge
            variant="outline"
            className="mb-6 border-amber-500/30 bg-amber-500/8 text-amber-400 text-xs font-medium px-3 py-1 gap-1.5"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            AI Brain Engine Aktif · Belajar Setiap Siklus
          </Badge>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight mb-5 leading-[1.1]">
            <span className="text-foreground">Trading Gold</span>
            <br />
            <span className="text-primary drop-shadow-[0_0_30px_rgba(245,158,11,0.4)]">
              lebih cerdas dengan AI
            </span>
          </h1>

          <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            GoldRadar.ai adalah platform AI trading XAUUSD yang belajar mandiri 24/7.
            Prediksi arah pasar, analisis multi-timeframe, dan chat dengan AI expert gold
            — semua dalam satu platform.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/login?role=member&redirect=/member">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-black font-bold text-base px-8 h-12 gap-2 shadow-[0_0_24px_rgba(245,158,11,0.3)] hover:shadow-[0_0_32px_rgba(245,158,11,0.45)] transition-shadow"
              >
                <Lock className="w-4 h-4" />
                Login Member
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>

          <p className="text-xs text-muted-foreground/50 mt-4">
            Akses eksklusif untuk member terdaftar · Diperlukan password member
          </p>
        </div>

        {/* Stats strip */}
        <div className="relative max-w-2xl mx-auto mt-16 grid grid-cols-3 gap-4 w-full">
          {[
            { label: "Belajar Otomatis", value: "24/7", sub: "tanpa henti" },
            { label: "Analisis Teknikal", value: "10+", sub: "indikator live" },
            { label: "Prediksi AI", value: "Auto", sub: "self-correcting" },
          ].map((s) => (
            <div key={s.label} className="bg-card/40 border border-border/40 rounded-xl p-4 text-center">
              <p className="text-2xl font-extrabold text-primary tabular-nums">{s.value}</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{s.label}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Fitur Platform</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              Semua yang dibutuhkan trader gold
            </h2>
            <p className="text-muted-foreground text-sm mt-3 max-w-lg mx-auto">
              Dari prediksi AI real-time hingga chat expert — GoldRadar.ai hadir sebagai asisten trading emas terpercaya.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group bg-card/40 hover:bg-card/70 border border-border/50 hover:border-border/80 rounded-2xl p-5 transition-all duration-200"
              >
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-4 ${f.bg}`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 border-t border-border/40 bg-card/20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Cara Kerja</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground">
              AI yang belajar dari pengalaman sendiri
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="bg-card/50 border border-border/50 rounded-xl p-4 relative">
                <div className={`text-3xl font-extrabold ${item.color} mb-3 opacity-60`}>{item.step}</div>
                <h3 className="text-sm font-bold text-foreground mb-1.5">{item.title}</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing / Access ────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 border-t border-border/40">
        <div className="max-w-lg mx-auto text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Akses Member</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-4">
            Eksklusif untuk member terdaftar
          </h2>
          <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
            GoldRadar.ai adalah platform berbayar. Akses ke fitur AI chat dan analisis mendalam
            hanya tersedia untuk member yang telah terdaftar.
          </p>

          <div className="bg-card/50 border border-primary/20 rounded-2xl p-6 shadow-[0_0_40px_rgba(245,158,11,0.08)]">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="text-base font-bold text-foreground">Akses Member</span>
            </div>

            <ul className="text-sm text-left space-y-2.5 mb-6">
              {[
                "Chat langsung dengan Gold AI Expert",
                "Analisis kondisi pasar real-time",
                "Setup trading harian",
                "Tanya apapun seputar XAUUSD",
                "Didukung AI yang terus belajar",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-muted-foreground">
                  <div className="w-4 h-4 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>

            <Link href="/login?role=member&redirect=/member">
              <Button className="w-full bg-primary hover:bg-primary/90 text-black font-bold gap-2 h-11 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                <Lock className="w-4 h-4" />
                Login Sekarang
              </Button>
            </Link>
            <p className="text-[10px] text-muted-foreground/50 mt-3">
              Hubungi admin untuk mendapatkan akses member
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/40 py-6 px-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Zap className="w-3 h-3 text-primary" />
          </div>
          <span className="text-sm font-bold">
            GoldRadar<span className="text-primary">.ai</span>
          </span>
        </div>
        <p className="text-xs text-muted-foreground/50">
          Analisis berbasis algoritma AI — bukan rekomendasi investasi. Selalu gunakan manajemen risiko yang baik.
        </p>
        <div className="flex items-center justify-center gap-4 mt-3">
          <Link href="/login?role=member&redirect=/member">
            <span className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer">Login Member</span>
          </Link>
          <span className="text-muted-foreground/20">·</span>
          <Link href="/login?role=admin">
            <span className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer">Admin</span>
          </Link>
        </div>
      </footer>
    </div>
  );
}
