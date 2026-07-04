/**
 * XAUUSD AI — Gold Trading AI yang belajar mandiri
 * Real-time indicators + autonomous brain + chat + learning log + news
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp, TrendingDown, Minus, Brain, BookOpen,
  MessageSquare, Newspaper, Activity, Zap, RefreshCw,
  Send, Play, ChevronDown, ChevronUp, Target, History,
  CheckCircle2, XCircle, Clock, Loader2, Settings, KeyRound,
  Calendar, BarChart2, Trophy, Layers, Link2, Phone, Bell
} from "lucide-react";

// ─── TradingView Widgets ────────────────────────────────────────────────────
// Menampilkan harga & chart XAUUSD langsung dari TradingView (feed broker OANDA)
// agar sesuai dengan harga yang dilihat trader di platform broker mereka.
const TV_SYMBOL = "OANDA:XAUUSD";

function TradingViewTicker() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-single-quote.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: TV_SYMBOL,
      width: "100%",
      colorTheme: "dark",
      isTransparent: true,
      locale: "id",
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, []);

  return <div className="tradingview-widget-container" ref={containerRef} />;
}

function TradingViewSymbolInfo() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol: TV_SYMBOL,
      width: "100%",
      locale: "id",
      colorTheme: "dark",
      isTransparent: true,
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, []);

  return <div className="tradingview-widget-container" ref={containerRef} style={{ minHeight: 56 }} />;
}

function TradingViewEconomicCalendar() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      colorTheme: "dark",
      isTransparent: true,
      width: "100%",
      height: "600",
      locale: "id",
      importanceFilter: "-1,0,1",
      currencyFilter: "USD,XAU,EUR,GBP,JPY",
    });
    el.appendChild(script);
    return () => { el.innerHTML = ""; };
  }, []);
  return <div className="tradingview-widget-container" ref={containerRef} style={{ height: 600 }} />;
}

function WinratePanel({ preds }: { preds: Prediction[] }) {
  const calibQ = useQuery({
    queryKey: ["xauusd-confidence-calibration"],
    queryFn: () => apiGet<CalibrationResult>("/confidence-calibration"),
    staleTime: 5 * 60_000,
  });
  const verified = preds.filter(p => p.status === "verified");
  const correct = verified.filter(p => p.isCorrect === true);
  const wrong = verified.filter(p => p.isCorrect === false);

  const byDir = (dir: string) => {
    const v = verified.filter(p => p.direction === dir);
    const c = v.filter(p => p.isCorrect === true).length;
    return { total: v.length, correct: c, pct: v.length > 0 ? Math.round(c / v.length * 100) : null };
  };
  const byConf = (min: number, max: number) => {
    const v = verified.filter(p => p.confidence >= min && p.confidence < max);
    const c = v.filter(p => p.isCorrect === true).length;
    return { total: v.length, correct: c, pct: v.length > 0 ? Math.round(c / v.length * 100) : null };
  };

  let streak = 0;
  let streakType: "win" | "loss" | null = null;
  for (const p of verified) {
    if (streakType === null) { streakType = p.isCorrect ? "win" : "loss"; streak = 1; }
    else if ((p.isCorrect && streakType === "win") || (!p.isCorrect && streakType === "loss")) streak++;
    else break;
  }

  const totalWinRate = verified.length > 0 ? Math.round(correct.length / verified.length * 100) : null;
  const up = byDir("up"); const down = byDir("down"); const side = byDir("sideways");

  if (verified.length === 0) return (
    <div className="text-center py-16 text-muted-foreground">
      <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Belum ada prediksi terverifikasi.</p>
      <p className="text-xs mt-1">AI perlu membuat prediksi dan menunggu verifikasi setelah timeframe berlalu.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total Win Rate</p>
        {totalWinRate !== null ? (
          <p className={`text-7xl font-black ${totalWinRate >= 60 ? "text-emerald-400" : totalWinRate >= 40 ? "text-amber-400" : "text-red-400"}`}>
            {totalWinRate}%
          </p>
        ) : <p className="text-4xl font-bold text-muted-foreground">—</p>}
        <p className="text-sm text-muted-foreground mt-1">{correct.length} benar dari {verified.length} prediksi terverifikasi</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Menang ✓", value: correct.length, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" },
          { label: "Kalah ✗", value: wrong.length, color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" },
          { label: "Pending ⏳", value: preds.filter(p => p.status === "pending").length, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" },
        ].map(s => (
          <div key={s.label} className={`rounded-lg p-3 border text-center ${s.bg}`}>
            <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {streakType && streak > 1 && (
        <div className={`rounded-lg p-3 border text-center ${streakType === "win" ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"}`}>
          <p className="text-sm font-medium">
            {streakType === "win" ? "🔥" : "❄️"} Streak saat ini:{" "}
            <span className={`font-bold ${streakType === "win" ? "text-emerald-400" : "text-red-400"}`}>
              {streak} {streakType === "win" ? "kemenangan" : "kekalahan"} berturut-turut
            </span>
          </p>
        </div>
      )}

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Win Rate per Arah Prediksi</p>
        <div className="space-y-3">
          {[
            { label: "▲ NAIK (Bullish)", data: up, color: "bg-emerald-500" },
            { label: "▼ TURUN (Bearish)", data: down, color: "bg-red-500" },
            { label: "↔ SIDEWAYS", data: side, color: "bg-amber-500" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <p className="text-xs w-36 text-muted-foreground shrink-0">{item.label}</p>
              <div className="flex-1 bg-muted/30 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full transition-all ${item.color}`} style={{ width: `${item.data.pct ?? 0}%` }} />
              </div>
              <p className="text-xs w-24 text-right text-foreground shrink-0">
                {item.data.pct !== null ? `${item.data.pct}% (${item.data.correct}/${item.data.total})` : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Win Rate per Tingkat Kepercayaan AI</p>
        <div className="space-y-3">
          {[
            { label: "Tinggi (>80%)", data: byConf(0.8, 1.01), color: "bg-blue-500" },
            { label: "Sedang (60–80%)", data: byConf(0.6, 0.8), color: "bg-purple-500" },
            { label: "Rendah (<60%)", data: byConf(0, 0.6), color: "bg-slate-500" },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <p className="text-xs w-36 text-muted-foreground shrink-0">{item.label}</p>
              <div className="flex-1 bg-muted/30 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full transition-all ${item.color}`} style={{ width: `${item.data.pct ?? 0}%` }} />
              </div>
              <p className="text-xs w-24 text-right text-foreground shrink-0">
                {item.data.pct !== null ? `${item.data.pct}% (${item.data.correct}/${item.data.total})` : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {verified.length >= 5 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Confusion Matrix Prediksi</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-1">
              <thead>
                <tr>
                  <th className="text-left text-[10px] text-muted-foreground p-1 font-normal">Prediksi ↓ / Aktual →</th>
                  {(["up", "down", "sideways"] as const).map(d => (
                    <th key={d} className="text-center text-[10px] text-muted-foreground p-1 font-medium">
                      {d === "up" ? "▲ NAIK" : d === "down" ? "▼ TURUN" : "↔ SIDE"}
                    </th>
                  ))}
                  <th className="text-center text-[10px] text-muted-foreground p-1 font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {(["up", "down", "sideways"] as const).map((predDir) => {
                  const rowPreds = verified.filter(p => p.direction === predDir);
                  const rowLabel = predDir === "up" ? "▲ NAIK" : predDir === "down" ? "▼ TURUN" : "↔ SIDE";
                  return (
                    <tr key={predDir}>
                      <td className="text-[10px] font-medium text-muted-foreground p-1 whitespace-nowrap">{rowLabel}</td>
                      {(["up", "down", "sideways"] as const).map((actDir) => {
                        const count = rowPreds.filter(p => p.actualDirection === actDir).length;
                        const isDiag = predDir === actDir;
                        const maxInRow = Math.max(...(["up","down","sideways"].map(a => rowPreds.filter(p => p.actualDirection === a).length)), 1);
                        const intensity = Math.max(0.4, count / maxInRow);
                        return (
                          <td key={actDir} className="text-center p-1" title={`Prediksi ${rowLabel}, Aktual ${actDir === "up" ? "NAIK" : actDir === "down" ? "TURUN" : "SIDEWAYS"}: ${count}x`}>
                            <div className={`rounded-md py-1.5 px-2 min-w-[44px] mx-auto font-bold text-sm transition-all
                              ${isDiag
                                ? count > 0 ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-muted/10 text-muted-foreground/30 border border-border/20"
                                : count > 0 ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-muted/10 text-muted-foreground/30 border border-border/20"
                              }`}
                              style={{ opacity: count === 0 ? 0.35 : intensity }}>
                              {count}
                            </div>
                          </td>
                        );
                      })}
                      <td className="text-center p-1 text-[10px] text-muted-foreground font-medium">{rowPreds.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-2">
              Diagonal <span className="text-emerald-400">hijau</span> = prediksi benar. Kotak <span className="text-red-400">merah</span> = meleset. Semakin terang = semakin sering terjadi.
            </p>
          </div>
        </div>
      )}

      {/* ── Dynamic Confidence Calibration (Feature 2) ────────────────────── */}
      {calibQ.data && calibQ.data.totalVerified >= 3 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
            Kalibrasi Confidence Dinamis
            <span className="ml-2 text-[10px] text-muted-foreground/60">({calibQ.data.totalVerified} prediksi terverifikasi)</span>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="text-left text-[10px] text-muted-foreground font-normal p-1.5">Bucket Confidence</th>
                  <th className="text-center text-[10px] text-muted-foreground font-normal p-1.5">Sampel</th>
                  <th className="text-center text-[10px] text-muted-foreground font-normal p-1.5">Win Rate Aktual</th>
                  <th className="text-left text-[10px] text-muted-foreground font-normal p-1.5">Kalibrasi</th>
                </tr>
              </thead>
              <tbody>
                {calibQ.data.calibration.map(b => {
                  const midpoint = (b.min + Math.min(b.max, 1)) / 2;
                  const diff = b.actualWinRate != null ? b.actualWinRate - midpoint * 100 : null;
                  return (
                    <tr key={b.label} className="border-b border-border/20 hover:bg-card/30 transition-colors">
                      <td className="p-1.5 font-medium text-foreground">{b.label}</td>
                      <td className="p-1.5 text-center text-muted-foreground">{b.sampleCount}</td>
                      <td className="p-1.5 text-center">
                        {b.actualWinRate != null
                          ? <span className={b.actualWinRate >= 50 ? "text-emerald-400 font-medium" : "text-red-400 font-medium"}>{b.actualWinRate}%</span>
                          : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="p-1.5">
                        {diff != null
                          ? <span className={`text-[10px] ${Math.abs(diff) < 5 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-amber-400"}`}>
                              {Math.abs(diff) < 5 ? "✓ Terkalibrasi" : diff < 0 ? `▼ Overconfident ${Math.abs(diff).toFixed(0)}%` : `▲ Underconfident ${diff.toFixed(0)}%`}
                            </span>
                          : <span className="text-[10px] text-muted-foreground/50">Data kurang</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-2">
              <strong>Overconfident</strong> = AI bilang 80% tapi aktualnya lebih rendah. <strong>Underconfident</strong> = sebaliknya.
            </p>
          </div>
        </div>
      )}

      {verified.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Riwayat Prediksi Terverifikasi (terbaru)</p>
          <div className="flex flex-wrap gap-1.5">
            {verified.slice(0, 20).map(p => (
              <div
                key={p.id}
                title={`${p.direction === "up" ? "▲ NAIK" : p.direction === "down" ? "▼ TURUN" : "↔"} • ${p.isCorrect ? "Benar" : "Salah"} • ${(p.confidence * 100).toFixed(0)}% confidence`}
                className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold cursor-help ${p.isCorrect ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"}`}
              >
                {p.isCorrect ? "✓" : "✗"}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestPanel({ preds }: { preds: Prediction[] }) {
  const [rsiBuy, setRsiBuy] = useState(35);
  const [rsiSell, setRsiSell] = useState(65);
  const [requireEma, setRequireEma] = useState(false);
  const [btDirection, setBtDirection] = useState<"long" | "short" | "both">("long");
  const [maxHold, setMaxHold] = useState(10);
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btLoading, setBtLoading] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);

  const runCustomBacktest = async () => {
    setBtLoading(true); setBtError(null);
    try {
      const r = await apiPost<BacktestResult>("/backtest", {
        rsiBuy, rsiSell, requireEmaBullish: requireEma,
        direction: btDirection, maxHoldPeriods: maxHold,
      });
      if (r.error) { setBtError(r.error); setBtResult(null); }
      else setBtResult(r);
    } catch (e) { setBtError(String(e)); }
    finally { setBtLoading(false); }
  };

  const verified = preds.filter(p => p.status === "verified" && p.isCorrect !== null);
  const INITIAL_CAPITAL = 10000;
  let capital = INITIAL_CAPITAL;
  let peak = INITIAL_CAPITAL;
  let maxDrawdown = 0;
  let wins = 0, losses = 0, totalProfit = 0, totalLoss = 0;
  const equity: number[] = [INITIAL_CAPITAL];

  const chrono = [...verified].reverse();
  for (const p of chrono) {
    const risk = capital * 0.02;
    let pnl: number;
    if (p.isCorrect) {
      let rr = 2;
      if (p.targetPrice && p.stopLoss && p.priceAtPrediction) {
        const reward = Math.abs(p.targetPrice - p.priceAtPrediction);
        const riskPts = Math.abs(p.priceAtPrediction - p.stopLoss);
        if (riskPts > 0) rr = Math.min(reward / riskPts, 5);
      }
      pnl = risk * rr; wins++; totalProfit += pnl;
    } else {
      pnl = -risk; losses++; totalLoss += Math.abs(pnl);
    }
    capital += pnl;
    if (capital > peak) peak = capital;
    const dd = (peak - capital) / peak * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equity.push(capital);
  }

  const totalReturn = (capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100;
  const winRate = wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : 0;
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 99 : 0;
  const avgWin = wins > 0 ? totalProfit / wins : 0;
  const avgLoss = losses > 0 ? totalLoss / losses : 0;

  const minEq = Math.min(...equity);
  const maxEq = Math.max(...equity);
  const range = maxEq - minEq || 1;

  return (
    <div className="space-y-6">

      {/* ── Custom Rule Backtest (Feature 5) ──────────────────────────────── */}
      <div className="border border-amber-500/20 rounded-lg p-4 space-y-4 bg-amber-500/5">
        <p className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-amber-400" />
          Custom Rule Backtest
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">RSI Beli (entry saat RSI &lt;)</span>
            <input type="number" value={rsiBuy} onChange={e => setRsiBuy(Math.max(10, Math.min(50, +e.target.value)))}
              min={10} max={50} className="w-full bg-background border border-border/60 rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">RSI Jual (exit saat RSI &gt;)</span>
            <input type="number" value={rsiSell} onChange={e => setRsiSell(Math.max(50, Math.min(90, +e.target.value)))}
              min={50} max={90} className="w-full bg-background border border-border/60 rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Arah Trading</span>
            <select value={btDirection} onChange={e => setBtDirection(e.target.value as "long" | "short" | "both")}
              className="w-full bg-background border border-border/60 rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50">
              <option value="long">Long (beli dip)</option>
              <option value="short">Short (jual rally)</option>
              <option value="both">Keduanya</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Max Hold (snapshot)</span>
            <input type="number" value={maxHold} onChange={e => setMaxHold(Math.max(2, Math.min(100, +e.target.value)))}
              min={2} max={100} className="w-full bg-background border border-border/60 rounded-md px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-amber-500/50" />
          </label>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={requireEma} onChange={e => setRequireEma(e.target.checked)} className="w-3.5 h-3.5 rounded accent-amber-500" />
            <span className="text-xs text-muted-foreground">Wajib EMA Bullish Stack (long) / Bearish Stack (short)</span>
          </label>
          <button onClick={() => void runCustomBacktest()} disabled={btLoading}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {btLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {btLoading ? "Memproses..." : "Jalankan Backtest"}
          </button>
        </div>

        {btError && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{btError}</p>}

        {btResult && !btLoading && (
          <div className="space-y-3 pt-3 border-t border-border/30">
            <p className="text-[10px] text-muted-foreground">
              Aturan: RSI beli &lt;{btResult.rules.rsiBuy}, RSI jual &gt;{btResult.rules.rsiSell}, arah {btResult.rules.direction}, max hold {btResult.rules.maxHoldPeriods} snapshot, dari {btResult.dataPoints} data historis
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Win Rate", value: `${btResult.winRate}%`, color: btResult.winRate >= 50 ? "text-emerald-400" : "text-red-400" },
                { label: "Total Trade", value: `${btResult.totalTrades}`, color: "text-foreground" },
                { label: "Profit Factor", value: `${btResult.profitFactor.toFixed(2)}`, color: btResult.profitFactor >= 1 ? "text-emerald-400" : "text-red-400" },
                { label: "Max Drawdown", value: `-${btResult.maxDrawdown}%`, color: "text-red-400" },
              ].map(m => (
                <div key={m.label} className="bg-card/50 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Total Return", value: `${btResult.totalReturn >= 0 ? "+" : ""}${btResult.totalReturn}%`, color: btResult.totalReturn >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Modal Akhir", value: `$${btResult.finalCapital.toLocaleString()}`, color: btResult.finalCapital >= 10000 ? "text-emerald-400" : "text-red-400" },
                { label: "W/L", value: `${btResult.wins}W / ${btResult.losses}L`, color: "text-foreground" },
              ].map(m => (
                <div key={m.label} className="bg-card/50 rounded-lg p-2 text-center border border-border/30">
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>
            {btResult.equity.length > 2 && (
              <div>
                <p className="text-[10px] text-muted-foreground mb-1.5">Kurva Ekuitas</p>
                <div className="bg-card/40 rounded-lg p-3 border border-border/30">
                  <div className="flex items-end gap-px h-16">
                    {btResult.equity.map((e, i) => {
                      const min = Math.min(...btResult.equity); const max = Math.max(...btResult.equity); const rng = max - min || 1;
                      return <div key={i} className={`flex-1 rounded-t min-w-[2px] ${e >= 10000 ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                        style={{ height: `${Math.max(((e - min) / rng) * 100, 2)}%` }} />;
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>$10,000</span><span>${btResult.finalCapital.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Simulasi AI ──────────────────────────────────────────────────── */}
      {verified.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-border/30 rounded-lg">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Simulasi AI memerlukan minimal 1 prediksi terverifikasi.</p>
        </div>
      ) : (
      <>
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
        <p className="text-xs text-amber-300">
          📊 Simulasi AI: Modal awal <strong>$10,000</strong> · Risiko <strong>2% per trade</strong> · Mengikuti setiap sinyal AI terverifikasi · Target aktual jika tersedia, else 2R default
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Return", value: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`, color: totalReturn >= 0 ? "text-emerald-400" : "text-red-400" },
          { label: "Modal Akhir", value: `$${Math.round(capital).toLocaleString()}`, color: capital >= INITIAL_CAPITAL ? "text-emerald-400" : "text-red-400" },
          { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? "text-emerald-400" : "text-red-400" },
          { label: "Profit Factor", value: profitFactor.toFixed(2), color: profitFactor >= 1 ? "text-emerald-400" : "text-red-400" },
        ].map(m => (
          <div key={m.label} className="bg-card/50 rounded-lg p-3 border border-border/50 text-center">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className={`text-xl font-bold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Trade", value: `${wins + losses}` },
          { label: "Max Drawdown", value: `-${maxDrawdown.toFixed(1)}%` },
          { label: "Avg Profit/Trade", value: `$${avgWin.toFixed(0)}` },
          { label: "Avg Loss/Trade", value: `-$${avgLoss.toFixed(0)}` },
        ].map(m => (
          <div key={m.label} className="bg-card/50 rounded-lg p-3 border border-border/50 text-center">
            <p className="text-xs text-muted-foreground">{m.label}</p>
            <p className="text-lg font-bold text-foreground">{m.value}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Kurva Ekuitas</p>
        <div className="bg-card/40 rounded-lg p-4 border border-border/50">
          <div className="flex items-end gap-px h-36">
            {equity.map((e, i) => {
              const h = Math.max(((e - minEq) / range) * 100, 1);
              return (
                <div
                  key={i}
                  title={`Trade ${i}: $${Math.round(e).toLocaleString()}`}
                  className={`flex-1 rounded-t min-w-[3px] ${e >= INITIAL_CAPITAL ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
            <span>Mulai: ${INITIAL_CAPITAL.toLocaleString()}</span>
            <span>Akhir: ${Math.round(capital).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Riwayat Trade Simulasi</p>
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {chrono.map((p, i) => {
            const risk = 200;
            const pnlDisplay = p.isCorrect ? `+$${(risk * 2).toFixed(0)}` : `-$${risk.toFixed(0)}`;
            return (
              <div key={p.id} className="flex items-center gap-3 text-xs py-1.5 px-2 rounded bg-card/30 border border-border/30">
                <span className="text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                <span className={`w-16 font-medium shrink-0 ${p.direction === "up" ? "text-emerald-400" : p.direction === "down" ? "text-red-400" : "text-amber-400"}`}>
                  {p.direction === "up" ? "▲ NAIK" : p.direction === "down" ? "▼ TURUN" : "↔ SIDE"}
                </span>
                <span className="text-muted-foreground flex-1 truncate">{new Date(p.predictedAt).toLocaleDateString("id", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="text-muted-foreground shrink-0">{(p.confidence * 100).toFixed(0)}%</span>
                <span className={`font-bold w-14 text-right shrink-0 ${p.isCorrect ? "text-emerald-400" : "text-red-400"}`}>{pnlDisplay}</span>
                <span className={`shrink-0 ${p.isCorrect ? "text-emerald-400" : "text-red-400"}`}>{p.isCorrect ? "✓" : "✗"}</span>
              </div>
            );
          })}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function TradingViewAdvancedChart() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = `<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>`;
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: TV_SYMBOL,
      interval: "15",
      timezone: "Asia/Jakarta",
      theme: "dark",
      style: "1",
      locale: "id",
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: false,
      support_host: "https://www.tradingview.com",
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, []);

  return <div className="tradingview-widget-container" ref={containerRef} style={{ height: 500, width: "100%" }} />;
}

// ─── API ──────────────────────────────────────────────────────────────────────
import { getAdminToken, clearAdminToken } from "@/lib/auth";

const BASE = import.meta.env.BASE_URL;

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}api/xauusd${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}
async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}api/xauusd${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Snapshot {
  price: number; open: number; high: number; low: number; volume: number;
  rsi14: number | null; ema9: number | null; ema21: number | null;
  ema50: number | null; ema200: number | null;
  macdLine: number | null; macdSignal: number | null; macdHistogram: number | null;
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null; bbWidth: number | null;
  atr14: number | null; trend: string; rsiSignal: string;
  macdSignalType: string; emaAlignment: string;
  supportLevel: number | null; resistanceLevel: number | null;
  lastSnapshotAt: string | null; lastSavedPrice: number | null;
}

interface BrainEntry {
  id: number; category: string; title: string; content: string;
  confidence: number; createdAt: string; sourceQuestion: string | null;
  marketConditionTags: string | null;
}

interface BrainStats {
  totalInsights: number; byCategory: Record<string, number>;
  totalQuestionsAsked: number; totalPredictions: number;
  verifiedPredictions: number; correctPredictions: number;
  predictionAccuracy: number | null;
}

interface BacktestResult {
  rules: { rsiBuy: number; rsiSell: number; requireEmaBullish: boolean; direction: string; maxHoldPeriods: number };
  totalTrades: number; wins: number; losses: number; winRate: number;
  profitFactor: number; maxDrawdown: number; avgWin: number; avgLoss: number;
  totalReturn: number; finalCapital: number; equity: number[];
  trades: Array<{ entryPrice: number; exitPrice: number; direction: string; pnlPct: number; win: boolean; holdPeriods: number; entryAt: string }>;
  dataPoints: number; error?: string;
}

interface QuestionLog {
  id: number; question: string; answer: string | null; quality: number | null;
  savedToBrain: boolean; askedAt: string; answeredAt: string | null;
}

interface EnsembleVoteEntry { direction: string; confidence: number; label: string }
interface EnsembleVotes {
  technical: EnsembleVoteEntry; macro: EnsembleVoteEntry; ai: EnsembleVoteEntry;
  agreementCount: number; agreementBonus: number;
}
interface CalibrationBucket { label: string; min: number; max: number; sampleCount: number; actualWinRate: number | null }
interface CalibrationResult { calibration: CalibrationBucket[]; totalVerified: number }
interface FeatureItem { indicator: string; value: string; sampleCount: number; winRate: number; lift: number }
interface FeatureImportanceResult { features: FeatureItem[]; sampleCount: number; overallWinRate: number | null; minRequired: number }

interface Prediction {
  id: number; direction: string; targetPrice: number | null; confidence: number;
  tp2: number | null; tp3: number | null;
  reasoning: string; priceAtPrediction: number; predictedAt: string;
  actualPrice: number | null; actualDirection: string | null; isCorrect: boolean | null;
  status: string; revisionNote: string | null; timeframe: string;
  predictionType: "training" | "main";
  entryLow: number | null; entryHigh: number | null; stopLoss: number | null;
  indicatorsAtPrediction?: { ensembleVotes?: EnsembleVotes; [key: string]: unknown };
}

interface LivePrice {
  price: number | null; change: number | null; changePct: number | null;
  timestamp: number | null; stale: boolean; error: string | null;
}

interface XauusdSettings {
  hasDeepseekKey: boolean;
  deepseekKeySource: "database" | "environment" | "none";
  predictionTimeframeMinutes: number;
  validTimeframes: number[];
  whatsapp: { number: string; enabled: boolean; configured: boolean };
}

interface TimeframeIndicators {
  price: number; open: number; high: number; low: number; volume: number;
  rsi14: number | null; ema9: number | null; ema21: number | null;
  ema50: number | null; ema200: number | null;
  macdLine: number | null; macdSignal: number | null; macdHistogram: number | null;
  bbUpper: number | null; bbMiddle: number | null; bbLower: number | null; bbWidth: number | null;
  atr14: number | null; trend: string; rsiSignal: string;
  macdSignalType: string; emaAlignment: string;
  supportLevel: number | null; resistanceLevel: number | null;
}

interface TimeframeEntry {
  timeframe: string; label: string; indicators: TimeframeIndicators | null; error?: string;
}

interface MultiTimeframeResponse {
  timeframes: TimeframeEntry[];
  confluence: { agreement: string; bullishCount: number; bearishCount: number; sidewaysCount: number };
}

interface CorrelationFactor {
  name: string; ticker: string; price: number | null; changePct: number | null;
  correlation: number | null; interpretation: string;
}

interface CorrelationResponse {
  gold: { price: number | null; changePct: number | null };
  dxy: CorrelationFactor;
  us10y: CorrelationFactor;
  computedAt: string;
}

interface NewsItem {
  id: number; title: string; summary: string | null; url: string | null;
  source: string | null; sentiment: string | null; aiAnalysis: string | null;
  publishedAt: string | null; fetchedAt: string;
}

interface LearningLog {
  id: number; cycleAt: string; priceAtCycle: number | null;
  questionsAsked: number; insightsSaved: number;
  wrongPredictions: number; spikeDetected: boolean; summary: string | null;
  durationMs: number | null;
}

interface EngineStatus {
  running: boolean; lastCycleAt: string | null;
  totalCycles: number; totalInsights: number; isLearning: boolean;
}

// ─── Session ID ───────────────────────────────────────────────────────────────
function getSessionId() {
  let sid = sessionStorage.getItem("xauusd-session-id");
  if (!sid) {
    sid = "xau-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("xauusd-session-id", sid);
  }
  return sid;
}
const SESSION_ID = getSessionId();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rsiColor(v: number | null) {
  if (!v) return "text-slate-400";
  if (v >= 70) return "text-red-400";
  if (v <= 30) return "text-emerald-400";
  return "text-amber-400";
}
function trendIcon(t: string) {
  if (t === "bullish") return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (t === "bearish") return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-amber-400" />;
}
function trendBadge(t: string) {
  const cls = t === "bullish" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    : t === "bearish" ? "bg-red-500/20 text-red-300 border-red-500/30"
      : "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return <Badge className={`${cls} border text-xs`}>{t.toUpperCase()}</Badge>;
}
function sentimentColor(s: string | null) {
  if (s === "bullish") return "text-emerald-400";
  if (s === "bearish") return "text-red-400";
  return "text-amber-400";
}
function categoryColor(c: string) {
  const map: Record<string, string> = {
    trading_rule: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    pattern: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    insight: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    lesson: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    news_impact: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };
  return map[c] ?? "bg-slate-500/20 text-slate-300";
}
function fmt(n: number | null, dec = 2) {
  if (n == null) return "—";
  return n.toFixed(dec);
}
function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

// ─── Indicator Card ───────────────────────────────────────────────────────────
function IndicatorGrid({ s }: { s: Snapshot }) {
  const items = [
    { label: "RSI 14", value: fmt(s.rsi14, 1), sub: s.rsiSignal, color: rsiColor(s.rsi14) },
    { label: "EMA 9", value: `$${fmt(s.ema9)}`, sub: "", color: "text-blue-300" },
    { label: "EMA 21", value: `$${fmt(s.ema21)}`, sub: "", color: "text-blue-300" },
    { label: "EMA 50", value: `$${fmt(s.ema50)}`, sub: "", color: "text-indigo-300" },
    { label: "EMA 200", value: `$${fmt(s.ema200)}`, sub: "", color: "text-violet-300" },
    { label: "MACD Line", value: fmt(s.macdLine, 3), sub: s.macdSignalType, color: (s.macdHistogram ?? 0) > 0 ? "text-emerald-400" : "text-red-400" },
    { label: "MACD Signal", value: fmt(s.macdSignal, 3), sub: "", color: "text-slate-300" },
    { label: "MACD Hist", value: fmt(s.macdHistogram, 3), sub: "", color: (s.macdHistogram ?? 0) > 0 ? "text-emerald-400" : "text-red-400" },
    { label: "BB Upper", value: `$${fmt(s.bbUpper)}`, sub: "", color: "text-slate-300" },
    { label: "BB Middle", value: `$${fmt(s.bbMiddle)}`, sub: "", color: "text-slate-300" },
    { label: "BB Lower", value: `$${fmt(s.bbLower)}`, sub: "", color: "text-slate-300" },
    { label: "BB Width", value: `${fmt(s.bbWidth, 2)}%`, sub: "", color: "text-amber-300" },
    { label: "ATR 14", value: fmt(s.atr14, 2), sub: "volatilitas", color: "text-orange-300" },
    { label: "Support", value: `$${fmt(s.supportLevel)}`, sub: "100 candle", color: "text-emerald-400" },
    { label: "Resistance", value: `$${fmt(s.resistanceLevel)}`, sub: "100 candle", color: "text-red-400" },
  ];

  return (
    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
      {items.map((item) => (
        <div key={item.label} className="bg-card/50 rounded-lg p-2 border border-border/50 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{item.label}</p>
          <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
          {item.sub && <p className="text-[10px] text-muted-foreground capitalize">{item.sub.replace(/_/g, " ")}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── Brain Panel ──────────────────────────────────────────────────────────────
function BrainPanel({ stats, entries }: { stats: BrainStats | undefined; entries: BrainEntry[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const featureQ = useQuery({
    queryKey: ["xauusd-feature-importance"],
    queryFn: () => apiGet<FeatureImportanceResult>("/feature-importance"),
    staleTime: 5 * 60_000,
  });

  const categories = ["all", "trading_rule", "pattern", "insight", "lesson", "news_impact"];
  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Insight", value: stats.totalInsights, color: "text-cyan-400" },
            { label: "Pertanyaan", value: stats.totalQuestionsAsked, color: "text-purple-400" },
            { label: "Prediksi Diverifikasi", value: stats.verifiedPredictions, color: "text-blue-400" },
            { label: "Akurasi Prediksi", value: stats.predictionAccuracy != null ? `${stats.predictionAccuracy}%` : "—", color: stats.predictionAccuracy != null && stats.predictionAccuracy >= 50 ? "text-emerald-400" : "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="bg-card/50 rounded-lg p-3 border border-border/50 text-center">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-2 py-1 rounded text-xs border transition-colors ${filter === c ? "bg-amber-500/30 border-amber-500/50 text-amber-300" : "border-border/50 text-muted-foreground hover:border-amber-500/30"}`}
          >
            {c === "all" ? "Semua" : c.replace(/_/g, " ")}
            {c !== "all" && stats?.byCategory[c] ? ` (${stats.byCategory[c]})` : ""}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Otak AI belum ada insight untuk kategori ini.</p>
          <p className="text-xs mt-1">Klik "Mulai Belajar Sekarang" untuk memulai siklus pembelajaran.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
          {filtered.map((e) => (
            <div key={e.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
              <button
                className="w-full flex items-start gap-3 p-3 text-left hover:bg-card/60 transition-colors"
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge className={`${categoryColor(e.category)} border text-[10px]`}>{e.category.replace(/_/g, " ")}</Badge>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(e.createdAt)}</span>
                    <span className="text-[10px] text-amber-400">⭐ {(e.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-2">{e.title}</p>
                </div>
                {expanded === e.id ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
              </button>
              {expanded === e.id && (
                <div className="px-3 pb-3 space-y-2">
                  <div className="bg-background/50 rounded p-3 text-sm text-foreground/90 whitespace-pre-wrap">{e.content}</div>
                  {e.sourceQuestion && (
                    <p className="text-[11px] text-muted-foreground italic">📚 "{e.sourceQuestion.slice(0, 100)}{e.sourceQuestion.length > 100 ? "..." : ""}"</p>
                  )}
                  {e.marketConditionTags && (
                    <div className="flex flex-wrap gap-1">
                      {e.marketConditionTags.split(",").map((tag) => (
                        <span key={tag} className="text-[10px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Feature Importance (Feature 3) ─────────────────────────────────── */}
      {featureQ.data && featureQ.data.features.length > 0 && (
        <div className="border-t border-border/30 pt-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
            🏆 Feature Importance — Indikator Paling Prediktif
          </p>
          <p className="text-[10px] text-muted-foreground mb-3">
            Win rate tiap kondisi indikator vs rata-rata keseluruhan ({featureQ.data.overallWinRate}%) · {featureQ.data.sampleCount} prediksi terverifikasi
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {featureQ.data.features.map((f, i) => {
              const isPositive = f.lift >= 0;
              const barPct = Math.min(100, Math.abs(f.lift) / Math.max(...featureQ.data!.features.map(x => Math.abs(x.lift)), 1) * 100);
              const indLabel: Record<string, string> = {
                rsiSignal: "RSI", emaAlignment: "EMA Align", macdSignalType: "MACD", trend: "Trend"
              };
              return (
                <div key={`${f.indicator}-${f.value}`} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-card/30 border border-border/20 hover:bg-card/50 transition-colors">
                  <span className="text-muted-foreground w-4 text-center shrink-0">#{i + 1}</span>
                  <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-1 py-0.5 shrink-0 w-16 text-center">{indLabel[f.indicator] ?? f.indicator}</span>
                  <span className="font-medium text-foreground shrink-0 w-28 truncate" title={f.value}>{f.value.replace(/_/g, " ")}</span>
                  <div className="flex-1 h-1.5 bg-card rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${isPositive ? "bg-emerald-500" : "bg-red-500"}`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-bold w-14 text-right shrink-0 ${f.winRate >= (featureQ.data?.overallWinRate ?? 50) ? "text-emerald-400" : "text-red-400"}`}>
                    {f.winRate}%
                  </span>
                  <span className={`text-[10px] w-14 text-right shrink-0 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                    {isPositive ? "+" : ""}{f.lift.toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">n={f.sampleCount}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Lift = selisih win rate kondisi ini vs baseline. <span className="text-emerald-400">Hijau</span> = kondisi yang meningkatkan akurasi AI.
          </p>
        </div>
      )}
      {featureQ.data && featureQ.data.features.length === 0 && (
        <div className="border-t border-border/30 pt-4 text-center py-4 text-muted-foreground">
          <p className="text-xs">Feature importance memerlukan minimal {featureQ.data.minRequired} prediksi terverifikasi. ({featureQ.data.sampleCount} terkumpul)</p>
        </div>
      )}
    </div>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
interface ChatMsg { role: "user" | "assistant"; content: string; ts: number }

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-0.5 leading-relaxed">
      {lines.map((line, i) => {
        if (line.trim() === "") return <div key={i} className="h-2" />;

        const isBullet = /^[•\-\*]\s/.test(line.trim());
        const isNumbered = /^\d+\.\s/.test(line.trim());

        const renderInline = (raw: string) => {
          const parts = raw.split(/(\*\*[^*]+\*\*)/g);
          return parts.map((part, j) => {
            if (part.startsWith("**") && part.endsWith("**"))
              return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            return <span key={j}>{part}</span>;
          });
        };

        if (isBullet) {
          const content = line.trim().replace(/^[•\-\*]\s/, "");
          return (
            <div key={i} className="flex gap-1.5 items-start">
              <span className="text-amber-400 mt-0.5 shrink-0">•</span>
              <span>{renderInline(content)}</span>
            </div>
          );
        }
        if (isNumbered) {
          const num = line.trim().match(/^(\d+)\.\s/)?.[1];
          const content = line.trim().replace(/^\d+\.\s/, "");
          return (
            <div key={i} className="flex gap-1.5 items-start">
              <span className="text-amber-400 font-bold shrink-0 min-w-[1.2em]">{num}.</span>
              <span>{renderInline(content)}</span>
            </div>
          );
        }
        return <div key={i}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

function ChatPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      apiPost<{ reply: string; aiPowered: boolean }>("/chat", { message: msg, sessionId: SESSION_ID }),
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, ts: Date.now() }]);
    },
    onError: (err) => {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    },
  });

  const send = (msg?: string) => {
    const text = (msg ?? input).trim();
    if (!text || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: text, ts: Date.now() }]);
    setInput("");
    sendMutation.mutate(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMutation.isPending]);

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  };

  const QUICK = [
    "Analisis kondisi XAUUSD saat ini",
    "RSI sudah overbought, apa yang harus dilakukan?",
    "Berikan setup trading untuk hari ini",
    "Kapan waktu terbaik buy gold?",
  ];

  return (
    <div className="flex flex-col h-[560px]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 mb-3">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-4xl mb-3">🥇</div>
            <p className="text-sm text-muted-foreground">Tanya Gold AI Trader tentang apapun seputar XAUUSD</p>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-xs px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors text-left"
                >
                  💬 {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[88%] rounded-xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-amber-500/20 text-amber-100 border border-amber-500/30" : "bg-card/60 text-foreground border border-border/50"}`}>
                  {m.role === "assistant" && (
                    <span className="text-xs text-amber-400 block mb-1.5 font-medium">🥇 Gold AI Trader</span>
                  )}
                  {m.role === "assistant"
                    ? <MarkdownText text={m.content} />
                    : <p className="whitespace-pre-wrap">{m.content}</p>
                  }
                </div>
                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">{fmtTime(m.ts)}</span>
              </div>
            ))}
            {messages.length > 0 && (
              <div className="flex justify-center pt-1">
                <button
                  onClick={() => setMessages([])}
                  className="text-[11px] text-muted-foreground hover:text-red-400 transition-colors px-3 py-1 rounded-full border border-border/30 hover:border-red-400/30"
                >
                  🗑 Hapus percakapan
                </button>
              </div>
            )}
          </>
        )}
        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-card/60 border border-border/50 rounded-xl px-4 py-2.5 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span className="text-xs text-muted-foreground">Gold AI sedang berpikir...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Tanya Gold AI... (Enter kirim, Shift+Enter baris baru)"
          className="flex-1 bg-background/50 border border-border/50 rounded-lg px-3 py-2 text-sm resize-none h-[60px] focus:outline-none focus:ring-1 focus:ring-amber-500/50 placeholder:text-muted-foreground/50"
        />
        <Button
          onClick={() => send()}
          disabled={!input.trim() || sendMutation.isPending}
          className="bg-amber-500 hover:bg-amber-600 text-black shrink-0"
          size="sm"
        >
          {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Learning Log ─────────────────────────────────────────────────────────────
function LearningLogPanel({ logs }: { logs: LearningLog[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Belum ada siklus pembelajaran yang tercatat.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
      {logs.map((log) => (
        <div key={log.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-center gap-3 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === log.id ? null : log.id)}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${log.spikeDetected ? "bg-amber-400 animate-pulse" : "bg-slate-500"}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">{timeAgo(log.cycleAt)}</span>
                {log.spikeDetected && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 border text-[10px]">⚡ SPIKE</Badge>}
                <span className="text-[11px] text-cyan-400">+{log.insightsSaved} insight</span>
                <span className="text-[11px] text-purple-400">{log.questionsAsked} pertanyaan</span>
                {log.priceAtCycle && <span className="text-[11px] text-amber-400">${log.priceAtCycle.toFixed(2)}</span>}
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground">{log.durationMs ? `${(log.durationMs / 1000).toFixed(0)}s` : ""}</span>
            {expanded === log.id ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {expanded === log.id && log.summary && (
            <div className="px-3 pb-3">
              <p className="text-xs text-muted-foreground bg-background/50 rounded p-2">{log.summary}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Prediction Tracker ───────────────────────────────────────────────────────
function PredictionList({ preds }: { preds: Prediction[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (preds.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <Target className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Belum ada prediksi.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
      {preds.map((p) => (
        <div key={p.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-center gap-3 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === p.id ? null : p.id)}
          >
            {/* Status icon */}
            {p.status === "pending" && <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />}
            {p.isCorrect === true && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
            {p.isCorrect === false && <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`border text-[10px] ${p.direction === "up" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : p.direction === "down" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                  {p.direction === "up" ? "▲ NAIK" : p.direction === "down" ? "▼ TURUN" : "↔ SIDEWAYS"}
                </Badge>
                <Badge className="text-[10px] border bg-slate-500/20 text-slate-300 border-slate-500/30">{p.timeframe}</Badge>
                <span className="text-xs text-muted-foreground">dari ${p.priceAtPrediction.toFixed(2)}</span>
                <span className="text-[11px] text-amber-400">{(p.confidence * 100).toFixed(0)}% confidence</span>
                <Badge className={`text-[10px] border ${p.status === "pending" ? "bg-slate-500/20 text-slate-300 border-slate-500/30" : p.status === "verified" ? "bg-blue-500/20 text-blue-300 border-blue-500/30" : "bg-orange-500/20 text-orange-300 border-orange-500/30"}`}>
                  {p.status}
                </Badge>
              </div>
              {(p.entryLow != null || p.entryHigh != null || p.stopLoss != null) && (
                <div className="flex flex-wrap gap-3 mt-1">
                  {p.entryLow != null && p.entryHigh != null && (
                    <span className="text-[11px] text-blue-400">Entry: ${p.entryLow.toFixed(2)} – ${p.entryHigh.toFixed(2)}</span>
                  )}
                  {p.stopLoss != null && (
                    <span className="text-[11px] text-red-400">SL: ${p.stopLoss.toFixed(2)}</span>
                  )}
                  {p.targetPrice != null && (
                    <span className="text-[11px] text-emerald-400">TP1: ${p.targetPrice.toFixed(2)}</span>
                  )}
                  {p.tp2 != null && p.tp2 !== p.targetPrice && (
                    <span className="text-[11px] text-emerald-300/70">TP2: ${p.tp2.toFixed(2)}</span>
                  )}
                  {p.tp3 != null && p.tp3 !== p.targetPrice && (
                    <span className="text-[11px] text-emerald-300/50">TP3: ${p.tp3.toFixed(2)}</span>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(p.predictedAt)}</p>
            </div>
            {expanded === p.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {expanded === p.id && (
            <div className="px-3 pb-3 space-y-2">
              {(p.entryLow != null || p.stopLoss != null) && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-center">
                      <p className="text-[10px] text-blue-400 uppercase tracking-wide mb-0.5">Rentang Entry</p>
                      <p className="text-sm font-semibold">{p.entryLow != null && p.entryHigh != null ? `${p.entryLow.toFixed(2)} – ${p.entryHigh.toFixed(2)}` : "-"}</p>
                    </div>
                    <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-center">
                      <p className="text-[10px] text-red-400 uppercase tracking-wide mb-0.5">Stop Loss</p>
                      <p className="text-xs font-semibold text-red-400">{p.stopLoss != null ? `${p.stopLoss.toFixed(2)}` : "-"}</p>
                      <p className="text-[9px] text-red-400/60 mt-0.5">invalidasi thesis</p>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded p-2 text-center">
                      <p className="text-[10px] text-emerald-400 uppercase tracking-wide mb-0.5">TP1</p>
                      <p className="text-xs font-semibold text-emerald-400">{p.targetPrice != null ? `${p.targetPrice.toFixed(2)}` : "-"}</p>
                      <p className="text-[9px] text-emerald-400/60 mt-0.5">S/R terdekat</p>
                    </div>
                  </div>
                  {(p.tp2 != null || p.tp3 != null) && p.tp2 !== p.targetPrice && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-emerald-500/8 border border-emerald-500/15 rounded p-2 text-center">
                        <p className="text-[10px] text-emerald-300/70 uppercase tracking-wide mb-0.5">TP2 — lanjutan</p>
                        <p className="text-xs font-semibold text-emerald-300/80">{p.tp2 != null ? `${p.tp2.toFixed(2)}` : "-"}</p>
                        <p className="text-[9px] text-muted-foreground/40 mt-0.5">jika momentum sehat</p>
                      </div>
                      <div className="bg-emerald-500/5 border border-emerald-500/10 rounded p-2 text-center">
                        <p className="text-[10px] text-emerald-300/50 uppercase tracking-wide mb-0.5">TP3 — jauh</p>
                        <p className="text-xs font-semibold text-emerald-300/60">{p.tp3 != null ? `${p.tp3.toFixed(2)}` : "-"}</p>
                        <p className="text-[9px] text-muted-foreground/40 mt-0.5">trend kuat + volume</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="bg-background/50 rounded p-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Alasan Prediksi:</p>
                <p className="text-sm">{p.reasoning}</p>
              </div>
              {p.actualPrice && (
                <div className="bg-background/50 rounded p-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Hasil Aktual:</p>
                  <p className="text-sm">Harga aktual: <span className="text-amber-400 font-bold">${p.actualPrice.toFixed(2)}</span> — {p.isCorrect ? <span className="text-emerald-400">✓ Benar</span> : <span className="text-red-400">✗ Salah</span>}</p>
                </div>
              )}
              {p.revisionNote && (
                <div className="bg-orange-500/10 rounded p-2 border border-orange-500/20">
                  <p className="text-xs font-medium text-orange-400 mb-1">📚 Self-Critique AI:</p>
                  <p className="text-sm text-foreground/80">{p.revisionNote}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Questions Log ────────────────────────────────────────────────────────────
function QuestionsPanel({ questions }: { questions: QuestionLog[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (questions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>Belum ada pertanyaan yang dikirim ke DeepSeek.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
      {questions.slice(0, 20).map((q) => (
        <div key={q.id} className="bg-card/40 rounded-lg border border-border/50 overflow-hidden">
          <button
            className="w-full flex items-start gap-2 p-3 text-left hover:bg-card/60 transition-colors"
            onClick={() => setExpanded(expanded === q.id ? null : q.id)}
          >
            <span className="text-sm">{q.savedToBrain ? "🧠" : "❓"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground line-clamp-2">{q.question}</p>
              <div className="flex gap-2 mt-0.5">
                <span className="text-[10px] text-muted-foreground">{timeAgo(q.askedAt)}</span>
                {q.quality != null && <span className={`text-[10px] ${q.quality >= 0.6 ? "text-emerald-400" : "text-muted-foreground"}`}>kualitas: {(q.quality * 100).toFixed(0)}%</span>}
              </div>
            </div>
            {expanded === q.id ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
          </button>
          {expanded === q.id && q.answer && (
            <div className="px-3 pb-3">
              <div className="bg-background/50 rounded p-2 text-xs text-foreground/80 whitespace-pre-wrap max-h-48 overflow-y-auto">{q.answer}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── News Panel ───────────────────────────────────────────────────────────────
function NewsPanel({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <Newspaper className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p>Belum ada berita XAUUSD yang tersimpan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
      {news.map((n) => (
        <div key={n.id} className="bg-card/40 rounded-lg border border-border/50 p-3">
          <div className="flex items-start gap-2">
            <span className={`text-lg flex-shrink-0 ${n.sentiment === "bullish" ? "🟢" : n.sentiment === "bearish" ? "🔴" : "🟡"}`}>
              {n.sentiment === "bullish" ? "📈" : n.sentiment === "bearish" ? "📉" : "📰"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                {n.sentiment && (
                  <Badge className={`text-[10px] border ${n.sentiment === "bullish" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : n.sentiment === "bearish" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"}`}>
                    {n.sentiment}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground">{n.source}</span>
                <span className="text-[10px] text-muted-foreground">{n.publishedAt ? timeAgo(n.publishedAt) : timeAgo(n.fetchedAt)}</span>
              </div>
              {n.url ? (
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-amber-400 transition-colors line-clamp-2">
                  {n.title}
                </a>
              ) : (
                <p className="text-sm font-medium line-clamp-2">{n.title}</p>
              )}
              {n.aiAnalysis && (
                <p className="text-xs text-muted-foreground mt-1.5 italic">🤖 {n.aiAnalysis}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Multi-Timeframe Panel ──────────────────────────────────────────────────
function trendBadgeSmall(trend: string | undefined) {
  const t = trend ?? "sideways";
  const cls = t === "bullish" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    : t === "bearish" ? "bg-red-500/20 text-red-300 border-red-500/30"
    : "bg-slate-500/20 text-slate-300 border-slate-500/30";
  const label = t === "bullish" ? "Bullish" : t === "bearish" ? "Bearish" : "Sideways";
  return <Badge className={`text-[10px] border ${cls}`}>{label}</Badge>;
}

function MultiTimeframePanel({ data, isLoading }: { data: MultiTimeframeResponse | undefined; isLoading: boolean }) {
  if (isLoading && !data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
    </div>
  );
  if (!data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Gagal memuat data multi-timeframe.</p>
    </div>
  );

  const confluenceColor = data.confluence.agreement.toLowerCase().includes("bullish")
    ? "text-emerald-400" : data.confluence.agreement.toLowerCase().includes("bearish")
    ? "text-red-400" : "text-amber-400";

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        Membandingkan tren, RSI, dan struktur EMA di tiga timeframe (1 Jam, 4 Jam, Harian) untuk melihat apakah sinyal saling mendukung (confluence).
      </p>

      <div className="rounded-lg p-4 border border-amber-500/30 bg-amber-500/5 text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Kesimpulan Confluence</p>
        <p className={`text-2xl font-bold ${confluenceColor}`}>{data.confluence.agreement}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {data.confluence.bullishCount} bullish · {data.confluence.bearishCount} bearish · {data.confluence.sidewaysCount} sideways
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {data.timeframes.map((tf) => (
          <div key={tf.timeframe} className="bg-card/40 rounded-lg border border-border/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">{tf.label}</h4>
              {tf.indicators && trendBadgeSmall(tf.indicators.trend)}
            </div>
            {tf.indicators ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Harga</span><span className="font-medium">${fmt(tf.indicators.price)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">RSI14</span><span className={`font-medium ${rsiColor(tf.indicators.rsi14)}`}>{fmt(tf.indicators.rsi14, 1)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">EMA Alignment</span><span className="font-medium">{tf.indicators.emaAlignment.replace(/_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">MACD</span><span className="font-medium">{tf.indicators.macdSignalType.replace(/_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Support</span><span className="font-medium text-emerald-400">${fmt(tf.indicators.supportLevel)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Resistance</span><span className="font-medium text-red-400">${fmt(tf.indicators.resistanceLevel)}</span></div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{tf.error ?? "Data tidak tersedia."}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Correlation Panel ──────────────────────────────────────────────────────
function CorrelationPanel({ data, isLoading }: { data: CorrelationResponse | undefined; isLoading: boolean }) {
  if (isLoading && !data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
    </div>
  );
  if (!data) return (
    <div className="text-center py-16 text-muted-foreground">
      <Link2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>Gagal memuat data korelasi.</p>
    </div>
  );

  const factors = [
    { key: "dxy", data: data.dxy },
    { key: "us10y", data: data.us10y },
  ];

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        AI juga mempertimbangkan pergerakan Dollar Index (DXY) dan yield Obligasi AS 10 Tahun (US10Y) — dua faktor makro yang secara historis berkorelasi dengan harga emas.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {factors.map((f) => {
          const corr = f.data.correlation;
          const strength = corr === null ? "text-muted-foreground"
            : Math.abs(corr) >= 0.6 ? "text-red-400"
            : Math.abs(corr) >= 0.3 ? "text-amber-400"
            : "text-slate-400";
          return (
            <div key={f.key} className="bg-card/40 rounded-lg border border-border/50 p-4">
              <h4 className="text-sm font-semibold mb-2">{f.data.name}</h4>
              <div className="flex items-center gap-4 mb-3">
                <div>
                  <p className="text-xs text-muted-foreground">Harga</p>
                  <p className="text-lg font-bold">{f.data.price != null ? f.data.price.toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Perubahan</p>
                  <p className={`text-sm font-medium ${(f.data.changePct ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {f.data.changePct != null ? `${f.data.changePct > 0 ? "+" : ""}${f.data.changePct.toFixed(2)}%` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Korelasi vs Gold</p>
                  <p className={`text-sm font-bold ${strength}`}>{corr != null ? corr.toFixed(2) : "—"}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground italic">{f.data.interpretation}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground text-right">
        Dihitung: {new Date(data.computedAt).toLocaleString("id-ID")}
      </p>
    </div>
  );
}

// ─── Settings Panel ─────────────────────────────────────────────────────────
function SettingsPanel({
  settings,
  onSaveKey,
  onClearKey,
  onSaveTimeframe,
  savingKey,
  savingTimeframe,
  onSaveWhatsapp,
  savingWhatsapp,
  onTestWhatsapp,
  testingWhatsapp,
}: {
  settings: XauusdSettings | undefined;
  onSaveKey: (key: string) => void;
  onClearKey: () => void;
  onSaveTimeframe: (minutes: number) => void;
  savingKey: boolean;
  savingTimeframe: boolean;
  onSaveWhatsapp: (number: string, enabled: boolean) => void;
  savingWhatsapp: boolean;
  onTestWhatsapp: () => void;
  testingWhatsapp: boolean;
}) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [waNumber, setWaNumber] = useState(settings?.whatsapp.number ?? "");
  const [waEnabled, setWaEnabled] = useState(settings?.whatsapp.enabled ?? false);

  useEffect(() => {
    setWaNumber(settings?.whatsapp.number ?? "");
    setWaEnabled(settings?.whatsapp.enabled ?? false);
  }, [settings?.whatsapp.number, settings?.whatsapp.enabled]);

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">DeepSeek API Key</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Atur API key DeepSeek langsung dari website (disimpan aman di database), tanpa perlu mengubah Secrets.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <Badge
            className={`text-[10px] border ${
              settings?.hasDeepseekKey
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                : "bg-red-500/20 text-red-300 border-red-500/30"
            }`}
          >
            {settings?.hasDeepseekKey
              ? `Aktif (sumber: ${settings.deepseekKeySource === "database" ? "website" : "secrets"})`
              : "Belum diset"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-xxxxxxxxxxxxxxxx"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => onSaveKey(apiKeyInput)}
            disabled={savingKey || apiKeyInput.trim().length === 0}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            {savingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
          </Button>
        </div>
        {settings?.deepseekKeySource === "database" && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-xs text-red-400 hover:text-red-300"
            onClick={onClearKey}
            disabled={savingKey}
          >
            Hapus key dari website
          </Button>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Target className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Interval Prediksi</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Seberapa jauh ke depan AI membuat prediksi harga (dan kapan diverifikasi).
        </p>
        <div className="flex gap-2">
          {(settings?.validTimeframes ?? [15, 30]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={settings?.predictionTimeframeMinutes === m ? "default" : "outline"}
              className={settings?.predictionTimeframeMinutes === m ? "bg-amber-500 hover:bg-amber-600 text-black" : ""}
              onClick={() => onSaveTimeframe(m)}
              disabled={savingTimeframe}
            >
              {m} menit
            </Button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold">Notifikasi WhatsApp</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Dapatkan notifikasi WhatsApp otomatis setiap kali AI membuat prediksi baru.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <Badge
            className={`text-[10px] border ${
              settings?.whatsapp.configured
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border-amber-500/30"
            }`}
          >
            {settings?.whatsapp.configured ? "Server WhatsApp terkonfigurasi" : "Server WhatsApp belum dikonfigurasi (perlu WHATSAPP_ACCESS_TOKEN & WHATSAPP_PHONE_NUMBER_ID)"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Phone className="w-4 h-4 text-muted-foreground" />
          <Input
            type="tel"
            placeholder="cth: 6281234567890 (kode negara tanpa +)"
            value={waNumber}
            onChange={(e) => setWaNumber(e.target.value)}
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            id="wa-enabled"
            checked={waEnabled}
            onChange={(e) => setWaEnabled(e.target.checked)}
            className="w-4 h-4 accent-amber-500"
          />
          <Label htmlFor="wa-enabled" className="text-xs cursor-pointer">Aktifkan notifikasi WhatsApp untuk prediksi baru</Label>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => onSaveWhatsapp(waNumber, waEnabled)}
            disabled={savingWhatsapp || waNumber.trim().length === 0}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            {savingWhatsapp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Simpan"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onTestWhatsapp}
            disabled={testingWhatsapp || !settings?.whatsapp.number}
          >
            {testingWhatsapp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Kirim Pesan Tes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Prediction Panel ─────────────────────────────────────────────────────────
function PredictionPanel({ mainPreds, trainingPreds }: { mainPreds: Prediction[]; trainingPreds: Prediction[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showTraining, setShowTraining] = useState(false);

  const dirLabel = (d: string) =>
    d === "up" ? "▲ NAIK" : d === "down" ? "▼ TURUN" : "↔ SIDEWAYS";
  const dirCls = (d: string) =>
    d === "up" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
      : d === "down" ? "text-red-400 bg-red-500/10 border-red-500/30"
      : "text-amber-400 bg-amber-500/10 border-amber-500/30";
  const statusBadge = (p: Prediction) => {
    if (p.status === "pending") return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">AKTIF</span>;
    if (p.isCorrect === true) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✓ BENAR</span>;
    if (p.isCorrect === false) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">✗ SALAH</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-400 border border-slate-500/30">EXPIRED</span>;
  };

  const PredCard = ({ p }: { p: Prediction }) => {
    const isOpen = expanded === p.id;
    return (
      <div className={`rounded-xl border transition-colors ${p.status === "pending" ? "border-amber-500/30 bg-amber-500/5" : "border-border/40 bg-card/40"}`}>
        <button className="w-full text-left p-4" onClick={() => setExpanded(isOpen ? null : p.id)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-bold px-2 py-0.5 rounded border ${dirCls(p.direction)}`}>{dirLabel(p.direction)}</span>
              {statusBadge(p)}
              <span className="text-xs text-muted-foreground">{(p.confidence * 100).toFixed(0)}% keyakinan</span>
              <span className="text-xs text-muted-foreground">· {p.timeframe}</span>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">{timeAgo(p.predictedAt)}</p>
              <p className="text-xs text-muted-foreground">@ ${p.priceAtPrediction.toFixed(2)}</p>
            </div>
          </div>

          {/* Key levels */}
          <div className="mt-3 space-y-1.5">
            <div className="grid grid-cols-3 gap-2">
              {p.entryLow && p.entryHigh && (
                <div className="text-center rounded-lg bg-muted/40 py-1.5 px-2">
                  <p className="text-[10px] text-muted-foreground">Entry</p>
                  <p className="text-xs font-semibold text-blue-400">${p.entryLow.toFixed(0)}–{p.entryHigh.toFixed(0)}</p>
                </div>
              )}
              {p.stopLoss && (
                <div className="text-center rounded-lg bg-red-500/10 py-1.5 px-2">
                  <p className="text-[10px] text-red-400/70">SL</p>
                  <p className="text-xs font-semibold text-red-400">${p.stopLoss.toFixed(2)}</p>
                </div>
              )}
              {p.targetPrice && (
                <div className="text-center rounded-lg bg-emerald-500/10 py-1.5 px-2">
                  <p className="text-[10px] text-emerald-400/70">TP1</p>
                  <p className="text-xs font-semibold text-emerald-400">${p.targetPrice.toFixed(2)}</p>
                </div>
              )}
            </div>
            {p.tp2 != null && p.tp2 !== p.targetPrice && (
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center rounded-lg bg-muted/20 py-1 px-2">
                  <p className="text-[9px] text-muted-foreground/60">TP2</p>
                  <p className="text-[11px] font-semibold text-emerald-300/70">${p.tp2.toFixed(2)}</p>
                </div>
                {p.tp3 != null && p.tp3 !== p.targetPrice && (
                  <div className="text-center rounded-lg bg-muted/10 py-1 px-2">
                    <p className="text-[9px] text-muted-foreground/50">TP3</p>
                    <p className="text-[11px] font-semibold text-emerald-300/50">${p.tp3.toFixed(2)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Ensemble votes if available */}
          {p.indicatorsAtPrediction?.ensembleVotes && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {Object.entries(p.indicatorsAtPrediction.ensembleVotes as unknown as Record<string, { direction: string; confidence: number; label: string }>)
                .filter(([k]) => k !== "agreementCount" && k !== "agreementBonus")
                .map(([agent, vote]) => (
                  <span key={agent} className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    vote.direction === "up" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : vote.direction === "down" ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  }`}>
                    {agent}: {vote.direction === "up" ? "▲" : vote.direction === "down" ? "▼" : "↔"} {(vote.confidence * 100).toFixed(0)}%
                  </span>
                ))}
            </div>
          )}
        </button>

        {isOpen && (
          <div className="px-4 pb-4 border-t border-border/30 pt-3">
            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{p.reasoning}</p>
            {p.revisionNote && (
              <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-xs text-amber-300">
                📝 Revisi: {p.revisionNote}
              </div>
            )}
            {p.actualPrice && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span>Harga aktual: <span className="font-medium text-foreground">${p.actualPrice.toFixed(2)}</span></span>
                {p.actualDirection && (
                  <span>· Arah aktual: <span className={`font-medium ${p.actualDirection === "up" ? "text-emerald-400" : p.actualDirection === "down" ? "text-red-400" : "text-amber-400"}`}>{dirLabel(p.actualDirection)}</span></span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (mainPreds.length === 0 && trainingPreds.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>Belum ada prediksi yang dibuat.</p>
        <p className="text-xs mt-1">AI akan membuat prediksi otomatis saat siklus belajar berjalan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Main predictions */}
      {mainPreds.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Prediksi Utama</h3>
            <span className="text-xs text-muted-foreground">({mainPreds.filter(p => p.status === "pending").length} aktif)</span>
          </div>
          {mainPreds.map(p => <PredCard key={p.id} p={p} />)}
        </div>
      )}

      {/* Training predictions (collapsible) */}
      {trainingPreds.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowTraining(v => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <History className="w-4 h-4" />
            <span>Prediksi Training ({trainingPreds.length})</span>
            {showTraining ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
          </button>
          {showTraining && (
            <div className="space-y-2">
              {trainingPreds.slice(0, 20).map(p => <PredCard key={p.id} p={p} />)}
              {trainingPreds.length > 20 && (
                <p className="text-center text-xs text-muted-foreground py-2">... dan {trainingPreds.length - 20} prediksi training lainnya</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type Tab = "chart" | "indicators" | "brain" | "chat" | "predictions" | "questions" | "news" | "log" | "settings" | "calendar" | "winrate" | "backtest" | "multitimeframe" | "correlation";

export default function XauusdAi() {
  const [activeTab, setActiveTab] = useState<Tab>("chart");
  const { toast } = useToast();
  const qc = useQueryClient();

  const snapshotQ = useQuery({
    queryKey: ["xauusd-snapshot"],
    queryFn: () => apiGet<Snapshot>("/snapshot"),
    refetchInterval: 60_000,
  });

  const brainQ = useQuery({
    queryKey: ["xauusd-brain"],
    queryFn: () => apiGet<BrainEntry[]>("/brain?limit=80"),
  });

  const statsQ = useQuery({
    queryKey: ["xauusd-brain-stats"],
    queryFn: () => apiGet<BrainStats>("/brain/stats"),
    refetchInterval: 30_000,
  });

  const predictionsQ = useQuery({
    queryKey: ["xauusd-predictions"],
    queryFn: () => apiGet<Prediction[]>("/predictions?limit=30"),
    refetchInterval: 60_000,
  });

  const mainPredictionsQ = useQuery({
    queryKey: ["xauusd-main-predictions"],
    queryFn: () => apiGet<Prediction[]>("/predictions?type=main&limit=10"),
    refetchInterval: 30_000,
  });

  const questionsQ = useQuery({
    queryKey: ["xauusd-questions"],
    queryFn: () => apiGet<QuestionLog[]>("/questions?limit=30"),
    refetchInterval: 60_000,
  });

  const newsQ = useQuery({
    queryKey: ["xauusd-news"],
    queryFn: () => apiGet<NewsItem[]>("/news?limit=20"),
    refetchInterval: 5 * 60_000,
  });

  const logQ = useQuery({
    queryKey: ["xauusd-log"],
    queryFn: () => apiGet<LearningLog[]>("/learning-log?limit=30"),
    refetchInterval: 30_000,
  });

  const engineQ = useQuery({
    queryKey: ["xauusd-engine"],
    queryFn: () => apiGet<EngineStatus>("/engine-status"),
    refetchInterval: 15_000,
  });

  const livePriceQ = useQuery({
    queryKey: ["xauusd-live-price"],
    queryFn: () => apiGet<LivePrice>("/live-price"),
    refetchInterval: 1_000,
  });

  const settingsQ = useQuery({
    queryKey: ["xauusd-settings"],
    queryFn: () => apiGet<XauusdSettings>("/settings"),
    refetchInterval: 30_000,
  });

  const allPredictionsQ = useQuery({
    queryKey: ["xauusd-all-predictions"],
    queryFn: () => apiGet<Prediction[]>("/predictions?limit=500"),
    refetchInterval: 60_000,
  });

  const multiTimeframeQ = useQuery({
    queryKey: ["xauusd-multi-timeframe"],
    queryFn: () => apiGet<MultiTimeframeResponse>("/multi-timeframe"),
    refetchInterval: 60_000,
  });

  const correlationQ = useQuery({
    queryKey: ["xauusd-correlation"],
    queryFn: () => apiGet<CorrelationResponse>("/correlation"),
    refetchInterval: 60_000,
  });

  const learnNowMutation = useMutation({
    mutationFn: () => apiPost("/learn-now"),
    onSuccess: () => {
      toast({ title: "✅ Siklus Pembelajaran Selesai", description: "AI telah menyelesaikan 1 siklus belajar." });
      void qc.invalidateQueries({ queryKey: ["xauusd-brain"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-brain-stats"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-questions"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-log"] });
      void qc.invalidateQueries({ queryKey: ["xauusd-predictions"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const saveKeyMutation = useMutation({
    mutationFn: (apiKey: string) => apiPost("/settings/deepseek-key", { apiKey }),
    onSuccess: () => {
      toast({ title: "✅ API Key Disimpan", description: "DeepSeek API key berhasil disimpan." });
      void qc.invalidateQueries({ queryKey: ["xauusd-settings"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const clearKeyMutation = useMutation({
    mutationFn: () => apiPost("/settings/deepseek-key", { apiKey: "" }),
    onSuccess: () => {
      toast({ title: "Key Dihapus", description: "DeepSeek API key dari website sudah dihapus." });
      void qc.invalidateQueries({ queryKey: ["xauusd-settings"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const saveTimeframeMutation = useMutation({
    mutationFn: (minutes: number) => apiPost("/settings/timeframe", { minutes }),
    onSuccess: () => {
      toast({ title: "✅ Interval Diperbarui", description: "Interval prediksi berhasil diubah." });
      void qc.invalidateQueries({ queryKey: ["xauusd-settings"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const s = snapshotQ.data;
  const engine = engineQ.data;
  const live = livePriceQ.data;

  const saveWhatsappMutation = useMutation({
    mutationFn: ({ number, enabled }: { number: string; enabled: boolean }) =>
      apiPost("/settings/whatsapp", { number, enabled }),
    onSuccess: () => {
      toast({ title: "✅ Pengaturan WhatsApp Disimpan", description: "Nomor WhatsApp tujuan berhasil disimpan." });
      void qc.invalidateQueries({ queryKey: ["xauusd-settings"] });
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const testWhatsappMutation = useMutation({
    mutationFn: () => apiPost<{ success: boolean; error?: string }>("/settings/whatsapp/test"),
    onSuccess: (res) => {
      if (res.success) {
        toast({ title: "✅ Pesan Tes Terkirim", description: "Cek WhatsApp Anda untuk pesan tes." });
      } else {
        toast({ title: "Gagal Mengirim", description: res.error ?? "Gagal mengirim pesan tes.", variant: "destructive" });
      }
    },
    onError: (err) => toast({ title: "Error", description: String(err), variant: "destructive" }),
  });

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "chart", label: "Chart TradingView", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "indicators", label: "Indikator Live", icon: <Activity className="w-3.5 h-3.5" /> },
    { id: "multitimeframe", label: "Multi-Timeframe", icon: <Layers className="w-3.5 h-3.5" /> },
    { id: "correlation", label: "Korelasi", icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: "brain", label: `Otak AI (${statsQ.data?.totalInsights ?? 0})`, icon: <Brain className="w-3.5 h-3.5" /> },
    { id: "chat", label: "Chat", icon: <MessageSquare className="w-3.5 h-3.5" /> },
    { id: "predictions", label: `Prediksi (${mainPredictionsQ.data?.length ?? 0} utama)`, icon: <Target className="w-3.5 h-3.5" /> },
    { id: "questions", label: `Pertanyaan (${statsQ.data?.totalQuestionsAsked ?? 0})`, icon: <BookOpen className="w-3.5 h-3.5" /> },
    { id: "news", label: "Berita", icon: <Newspaper className="w-3.5 h-3.5" /> },
    { id: "log", label: `Log Belajar (${logQ.data?.length ?? 0})`, icon: <History className="w-3.5 h-3.5" /> },
    { id: "calendar", label: "Kalender Ekonomi", icon: <Calendar className="w-3.5 h-3.5" /> },
    { id: "winrate", label: "Win Rate", icon: <Trophy className="w-3.5 h-3.5" /> },
    { id: "backtest", label: "Backtest", icon: <BarChart2 className="w-3.5 h-3.5" /> },
    { id: "settings", label: "Pengaturan", icon: <Settings className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-2xl">🥇</div>
            <div>
              <h1 className="text-2xl font-bold text-white">Gold AI Trader</h1>
              <p className="text-sm text-muted-foreground">AI XAUUSD yang belajar mandiri 24/7 • Powered by DeepSeek</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Engine status */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border ${engine?.running ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-slate-500/10 border-slate-500/30 text-slate-400"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${engine?.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
            {engine?.running ? `Belajar aktif • ${engine.totalCycles} siklus` : "Engine berhenti"}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => learnNowMutation.mutate()}
            disabled={learnNowMutation.isPending}
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          >
            {learnNowMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Belajar...</>
              : <><Zap className="w-3.5 h-3.5 mr-1.5" />Mulai Belajar Sekarang</>
            }
          </Button>
        </div>
      </div>

      {/* TradingView live quote — sesuai harga broker (OANDA:XAUUSD) */}
      <Card className="border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-amber-600/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">XAUUSD / Harga Gold (TradingView, sesuai broker)</p>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />LIVE
            </span>
          </div>
          <TradingViewTicker />
        </CardContent>
      </Card>

      {/* Price + signals bar */}
      {s ? (
        <Card className="border border-amber-500/20 bg-gradient-to-r from-amber-500/5 to-amber-600/5">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex-1 min-w-[260px]">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Harga Live (TradingView · OANDA:XAUUSD)</p>
                <TradingViewSymbolInfo />
                <p className="text-xs text-muted-foreground mt-1">H: ${s.high.toFixed(2)} | L: ${s.low.toFixed(2)}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  {trendIcon(s.trend)}
                  {trendBadge(s.trend)}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">EMA:</span>
                  <Badge className={`text-xs border ${s.emaAlignment === "bullish_stack" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : s.emaAlignment === "bearish_stack" ? "bg-red-500/20 text-red-300 border-red-500/30" : "bg-slate-500/20 text-slate-300 border-slate-500/30"}`}>
                    {s.emaAlignment.replace(/_/g, " ")}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">RSI:</span>
                  <span className={`text-sm font-bold ${rsiColor(s.rsi14)}`}>{fmt(s.rsi14, 1)}</span>
                  <Badge className="text-xs border bg-slate-500/20 text-slate-300 border-slate-500/30">{s.rsiSignal}</Badge>
                </div>
                {s.macdSignalType !== "neutral" && (
                  <Badge className={`text-xs border ${s.macdSignalType === "bullish_cross" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>
                    MACD {s.macdSignalType.replace(/_/g, " ")}
                  </Badge>
                )}
              </div>

              <div className="ml-auto text-right">
                <p className="text-xs text-muted-foreground">Support / Resistance</p>
                <p className="text-sm"><span className="text-emerald-400">${fmt(s.supportLevel)}</span> / <span className="text-red-400">${fmt(s.resistanceLevel)}</span></p>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-6 px-2" onClick={() => void snapshotQ.refetch()}>
                  <RefreshCw className="w-3 h-3 mr-1" />Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-amber-500/20">
          <CardContent className="p-6 text-center">
            {snapshotQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Mengambil data XAUUSD dari pasar global...</span>
              </div>
            ) : (
              <div className="text-muted-foreground">
                <p>Gagal mengambil data XAUUSD.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => void snapshotQ.refetch()}>Coba Lagi</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Latest MAIN AI prediction banner */}
      {mainPredictionsQ.data && mainPredictionsQ.data[0] && mainPredictionsQ.data[0].status === "pending" && (
        <Card className={`border-2 ${mainPredictionsQ.data[0].direction === "up" ? "border-emerald-500/50 bg-emerald-500/5" : mainPredictionsQ.data[0].direction === "down" ? "border-red-500/50 bg-red-500/5" : "border-amber-500/50 bg-amber-500/5"}`}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="text-3xl">{mainPredictionsQ.data[0].direction === "up" ? "🚀" : mainPredictionsQ.data[0].direction === "down" ? "📉" : "↔️"}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-xs text-muted-foreground">Sinyal Utama AI</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">UTAMA</span>
              </div>
              {(() => {
                const mp = mainPredictionsQ.data![0];
                return (
                  <>
                    <p className="font-bold">
                      <span className={mp.direction === "up" ? "text-emerald-400" : mp.direction === "down" ? "text-red-400" : "text-amber-400"}>
                        {mp.direction === "up" ? "▲ NAIK" : mp.direction === "down" ? "▼ TURUN" : "↔ SIDEWAYS"}
                      </span>
                      {mp.targetPrice && <span className="text-muted-foreground text-sm ml-2">target ${mp.targetPrice.toFixed(2)}</span>}
                      <span className="text-amber-400 text-sm ml-2">• {(mp.confidence * 100).toFixed(0)}% confidence</span>
                    </p>
                    {mp.indicatorsAtPrediction?.ensembleVotes && (() => {
                      const ev = mp.indicatorsAtPrediction!.ensembleVotes!;
                      const agentLabels: Record<string, string> = { technical: "📐 Teknikal", macro: "🌐 Makro", ai: "🤖 AI", rule: "📏 Rule" };
                      return (
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          {(["technical", "macro", "ai"] as const).map(key => {
                            const v = ev[key];
                            if (!v) return null;
                            const d = v.direction;
                            return (
                              <span key={key} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium
                                ${d === "up" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : d === "down" ? "text-red-400 border-red-500/30 bg-red-500/10" : "text-amber-400 border-amber-500/30 bg-amber-500/10"}`}>
                                {agentLabels[v.label] ?? v.label}: {d === "up" ? "▲" : d === "down" ? "▼" : "↔"} {(v.confidence * 100).toFixed(0)}%
                              </span>
                            );
                          })}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ev.agreementCount === 3 ? "text-emerald-400" : ev.agreementCount === 2 ? "text-amber-400" : "text-slate-400"}`}>
                            {ev.agreementCount === 3 ? "✓ Semua sepakat" : ev.agreementCount === 2 ? "2/3 sepakat" : "Split vote"}
                          </span>
                        </div>
                      );
                    })()}
                    {(mp.entryLow != null || mp.stopLoss != null) && (
                      <p className="text-xs mt-1 flex flex-wrap gap-3">
                        {mp.entryLow != null && mp.entryHigh != null && (
                          <span className="text-blue-400">Entry: ${mp.entryLow.toFixed(2)} – ${mp.entryHigh.toFixed(2)}</span>
                        )}
                        {mp.stopLoss != null && <span className="text-red-400">SL: ${mp.stopLoss.toFixed(2)}</span>}
                        {mp.targetPrice != null && <span className="text-emerald-400">TP1: ${mp.targetPrice.toFixed(2)}</span>}
                        {mp.tp2 != null && mp.tp2 !== mp.targetPrice && <span className="text-emerald-300/70">TP2: ${mp.tp2.toFixed(2)}</span>}
                        {mp.tp3 != null && mp.tp3 !== mp.targetPrice && <span className="text-emerald-300/50">TP3: ${mp.tp3.toFixed(2)}</span>}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{mp.reasoning}</p>
                  </>
                );
              })()}
            </div>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 border text-xs">PENDING</Badge>
          </CardContent>
        </Card>
      )}

      {/* Tab navigation */}
      <div className="flex flex-wrap gap-1 border-b border-border/50 pb-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeTab === tab.id ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-muted-foreground hover:text-foreground hover:bg-card/60 border border-transparent"}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <Card className="border border-border/50">
        <CardContent className="p-4 sm:p-6">
          {activeTab === "chart" && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Chart TradingView live (simbol {TV_SYMBOL}) — harga sama seperti yang tampil di platform broker.
              </p>
              <TradingViewAdvancedChart />
            </div>
          )}

          {activeTab === "indicators" && s && <IndicatorGrid s={s} />}
          {activeTab === "indicators" && !s && (
            <div className="text-center py-8 text-muted-foreground">
              {snapshotQ.isLoading ? <Loader2 className="w-6 h-6 animate-spin mx-auto" /> : "Tidak ada data indikator."}
            </div>
          )}

          {activeTab === "multitimeframe" && (
            <MultiTimeframePanel data={multiTimeframeQ.data} isLoading={multiTimeframeQ.isLoading} />
          )}

          {activeTab === "correlation" && (
            <CorrelationPanel data={correlationQ.data} isLoading={correlationQ.isLoading} />
          )}

          {activeTab === "brain" && (
            <BrainPanel stats={statsQ.data} entries={brainQ.data ?? []} />
          )}

          {activeTab === "chat" && (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <MessageSquare className="w-8 h-8 text-amber-400" />
              </div>
              <div className="text-center max-w-sm">
                <h3 className="text-base font-semibold text-foreground mb-2">Chat AI tersedia di halaman Member</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Fitur chat Gold AI Trader kini tersedia khusus untuk member. Login sebagai member untuk mengakses percakapan ChatGPT-style dengan AI trading kami.
                </p>
                <a
                  href="/login?role=member&redirect=/member"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-sm transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  Login sebagai Member
                </a>
              </div>
            </div>
          )}

          {activeTab === "predictions" && (
            <PredictionPanel
              mainPreds={mainPredictionsQ.data ?? []}
              trainingPreds={predictionsQ.data?.filter(p => p.predictionType === "training") ?? []}
            />
          )}

          {activeTab === "questions" && <QuestionsPanel questions={questionsQ.data ?? []} />}

          {activeTab === "news" && <NewsPanel news={newsQ.data ?? []} />}

          {activeTab === "log" && <LearningLogPanel logs={logQ.data ?? []} />}

          {activeTab === "calendar" && (
            <div>
              <p className="text-xs text-muted-foreground mb-3">
                Kalender ekonomi global dari TradingView — event berita yang mempengaruhi pergerakan gold (USD, inflasi, NFP, FOMC, dll).
              </p>
              <TradingViewEconomicCalendar />
            </div>
          )}

          {activeTab === "winrate" && (
            <WinratePanel preds={allPredictionsQ.data ?? []} />
          )}

          {activeTab === "backtest" && (
            <BacktestPanel preds={allPredictionsQ.data ?? []} />
          )}

          {activeTab === "settings" && (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Settings className="w-8 h-8 text-amber-400" />
              </div>
              <div className="text-center max-w-sm">
                <h3 className="text-base font-semibold text-foreground mb-2">Pengaturan Sistem</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Kelola API key, interval prediksi, WhatsApp, dan password member dari halaman pengaturan admin.
                </p>
                <a
                  href="/admin/settings"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-sm transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Buka Pengaturan
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="border border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-amber-400" />
            Cara Kerja Gold AI (Autonomous Learning)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { step: "1", title: "Pantau Pasar", desc: "Fetch harga XAUUSD realtime dari Swissquote + hitung RSI, EMA, MACD, BB, ATR setiap 15 menit", color: "text-amber-400" },
              { step: "2", title: "Deteksi Spike", desc: "Jika harga bergerak >0.3% dalam 1 siklus, AI generate 5 pertanyaan ekstra untuk belajar dari spike", color: "text-orange-400" },
              { step: "3", title: "Belajar dari DeepSeek", desc: "Generate pertanyaan unik (tidak pernah sama) → kirim ke DeepSeek → simpan jawaban terbaik ke 'otak AI'", color: "text-purple-400" },
              { step: "4", title: "Revisi Diri Sendiri", desc: `Setelah ${settingsQ.data?.predictionTimeframeMinutes ?? 15} menit, cek apakah prediksi benar. Jika salah → AI menulis self-critique dan menyimpannya sebagai pelajaran`, color: "text-cyan-400" },
            ].map((item) => (
              <div key={item.step} className="bg-card/40 rounded-lg p-3 border border-border/50">
                <div className={`text-lg font-bold ${item.color} mb-1`}>{item.step}</div>
                <p className="text-xs font-semibold text-foreground mb-1">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
