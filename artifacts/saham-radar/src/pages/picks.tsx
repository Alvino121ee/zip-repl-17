import { useState } from "react";
import {
  useGetTodayPicks,
  useGetPicksHistory,
  useGetPicksReport,
  useGeneratePicks,
} from "@workspace/api-client-react";
import type { DailyPick, PicksSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { formatRupiah, formatPercent, getLabelColor } from "@/lib/format";
import { Target, TrendingUp, TrendingDown, Wallet, Trophy, RefreshCw, CalendarDays } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

function ProfitText({ value, suffix = "" }: { value: number | null | undefined; suffix?: string }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  const positive = value >= 0;
  return (
    <span className={`font-mono font-semibold ${positive ? "text-positive" : "text-negative"}`}>
      {positive ? "+" : ""}
      {suffix === "Rp" ? formatRupiah(value) : formatPercent(value)}
    </span>
  );
}

function PicksTable({ picks }: { picks: DailyPick[] }) {
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Saham</TableHead>
            <TableHead>Skor & Label</TableHead>
            <TableHead className="text-right">Harga Masuk</TableHead>
            <TableHead className="text-right">Harga Saat Ini/Keluar</TableHead>
            <TableHead className="text-right">Profit</TableHead>
            <TableHead className="text-right">Status</TableHead>
            <TableHead>Alasan AI</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {picks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                Tidak ada pick untuk tanggal ini.
              </TableCell>
            </TableRow>
          ) : (
            picks.map((p) => (
              <TableRow key={p.id} className="hover:bg-muted/30 align-top">
                <TableCell className="font-mono text-muted-foreground">{p.rank}</TableCell>
                <TableCell>
                  <Link href={`/saham/${p.ticker}`} className="font-bold font-mono text-primary hover:underline">
                    {p.ticker}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.name}</div>
                </TableCell>
                <TableCell>
                  <div className="font-mono font-semibold">{p.totalScoreAtPick.toFixed(1)}</div>
                  <Badge className={`text-[10px] mt-1 ${getLabelColor(p.labelAtPick)}`}>{p.labelAtPick}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{formatRupiah(p.entryPrice)}</TableCell>
                <TableCell className="text-right font-mono">
                  {p.exitPrice != null ? formatRupiah(p.exitPrice) : <span className="text-muted-foreground">Terbuka</span>}
                </TableCell>
                <TableCell className="text-right">
                  <ProfitText value={p.profitAmount} suffix="Rp" />
                  <div className="text-xs">
                    <ProfitText value={p.profitPct} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className={p.status === "closed" ? "bg-muted" : "bg-primary/10 text-primary border-primary/30"}>
                    {p.status === "closed" ? "Closed" : "Open"}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs text-xs text-muted-foreground">{p.reason ?? "-"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SummaryCards({ summary }: { summary: PicksSummary | undefined }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Profit</span>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <ProfitText value={summary?.totalProfitAmount} suffix="Rp" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Rata-rata Profit</span>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="mt-2">
            <ProfitText value={summary?.avgProfitPct} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Win Rate</span>
            <Trophy className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="mt-2 font-mono font-semibold text-lg">{summary?.winRate != null ? `${summary.winRate.toFixed(0)}%` : "-"}</div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Pick</span>
            <Target className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="mt-2 font-mono font-semibold text-lg">
            {summary?.totalPicks ?? "-"}
            <span className="text-xs text-muted-foreground font-normal ml-1">
              ({summary?.closedPicks ?? 0} closed, {summary?.openPicks ?? 0} open)
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Picks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { data: today, isLoading: loadingToday } = useGetTodayPicks();
  const { data: history, isLoading: loadingHistory } = useGetPicksHistory({ limit: 30 });
  const { data: report, isLoading: loadingReport } = useGetPicksReport(selectedDate ?? "", {
    query: { enabled: !!selectedDate, queryKey: ["picks-report", selectedDate] },
  });
  const generatePicks = useGeneratePicks();

  const handleRegenerate = () => {
    generatePicks.mutate({}, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ title: "Berhasil", description: "Picks harian sudah diperbarui." });
      },
      onError: () => {
        toast({ title: "Gagal", description: "Tidak bisa generate picks.", variant: "destructive" });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Target className="w-8 h-8 text-primary" /> Daily Picks AI
          </h1>
          <p className="text-muted-foreground mt-1">
            Saham pilihan AI dengan potensi kenaikan tertinggi hari ini, beserta simulasi profit harian.
          </p>
        </div>
        <Button onClick={handleRegenerate} disabled={generatePicks.isPending} variant="outline" className="gap-2">
          <RefreshCw className={`w-4 h-4 ${generatePicks.isPending ? "animate-spin" : ""}`} />
          Refresh Picks
        </Button>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <CalendarDays className="w-5 h-5" /> Picks Hari Ini {today ? `(${today.date})` : ""}
        </h2>
        {loadingToday ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="space-y-4">
            <SummaryCards summary={today?.summary} />
            <PicksTable picks={today?.picks ?? []} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Riwayat Profit Harian</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <>
              <div className="mb-4 text-sm text-muted-foreground">
                Total profit kumulatif (semua pick yang sudah closed):{" "}
                <ProfitText value={history?.cumulativeProfitAmount} suffix="Rp" />
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-right">Total Pick</TableHead>
                      <TableHead className="text-right">Win Rate</TableHead>
                      <TableHead className="text-right">Avg Profit %</TableHead>
                      <TableHead className="text-right">Total Profit</TableHead>
                      <TableHead className="text-right">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(history?.days.length ?? 0) === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                          Belum ada riwayat picks.
                        </TableCell>
                      </TableRow>
                    ) : (
                      history!.days.map((day) => (
                        <TableRow key={day.date} className="hover:bg-muted/30">
                          <TableCell className="font-mono">{day.date}</TableCell>
                          <TableCell className="text-right font-mono">
                            {day.totalPicks} <span className="text-xs text-muted-foreground">({day.closedPicks} closed)</span>
                          </TableCell>
                          <TableCell className="text-right font-mono">{day.winRate.toFixed(0)}%</TableCell>
                          <TableCell className="text-right">
                            <ProfitText value={day.avgProfitPct} />
                          </TableCell>
                          <TableCell className="text-right">
                            <ProfitText value={day.totalProfitAmount} suffix="Rp" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedDate(day.date)}>
                              Lihat Laporan
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {selectedDate && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Laporan Detail — {selectedDate}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDate(null)}>
              Tutup
            </Button>
          </CardHeader>
          <CardContent>
            {loadingReport ? (
              <Skeleton className="h-64 w-full" />
            ) : !report ? (
              <div className="text-center py-10 text-muted-foreground">Tidak ada laporan untuk tanggal ini.</div>
            ) : (
              <div className="space-y-4">
                <SummaryCards summary={report.summary} />
                <PicksTable picks={report.picks} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
