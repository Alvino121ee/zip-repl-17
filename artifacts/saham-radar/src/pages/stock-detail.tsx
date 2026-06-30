import { useRoute } from "wouter";
import { 
  useGetStock, 
  useGetStockPrices, 
  useGetStockTechnicals,
  useGetAiReport,
  useGenerateAiReport,
  getGetAiReportQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatRupiah, formatPercent, formatLargeNumber, getLabelColor } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Zap, AlertTriangle, ChevronRight, Activity, TrendingDown, TrendingUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function StockDetail() {
  const [, params] = useRoute("/saham/:ticker");
  const ticker = params?.ticker || "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stock, isLoading: loadingStock } = useGetStock(ticker);
  const { data: prices, isLoading: loadingPrices } = useGetStockPrices(ticker);
  const { data: technicals, isLoading: loadingTech } = useGetStockTechnicals(ticker);
  const { data: report, isLoading: loadingReport } = useGetAiReport(ticker);
  
  const generateReport = useGenerateAiReport();

  const handleGenerateReport = () => {
    generateReport.mutate({ ticker }, {
      onSuccess: (newReport) => {
        queryClient.setQueryData(getGetAiReportQueryKey(ticker), newReport);
        toast({ title: "AI Report Generated", description: "Laporan analisis terbaru berhasil dibuat." });
      },
      onError: () => {
        toast({ title: "Gagal", description: "Gagal membuat laporan AI.", variant: "destructive" });
      }
    });
  };

  if (loadingStock && !stock) {
    return <div className="p-8 space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }

  if (!stock) return <div>Stock not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-bold font-mono tracking-tight">{stock.ticker}</h1>
            <Badge className={getLabelColor(stock.label)} variant="outline">{stock.label}</Badge>
          </div>
          <p className="text-lg text-muted-foreground mt-1">{stock.name} • {stock.sector}</p>
        </div>
        <div className="text-left md:text-right">
          <div className="text-4xl font-bold font-mono">{formatRupiah(stock.currentPrice)}</div>
          <div className={`text-lg font-mono font-medium ${stock.priceChangePct >= 0 ? 'text-positive' : 'text-negative'}`}>
            {stock.priceChange > 0 ? '+' : ''}{formatRupiah(stock.priceChange)} ({formatPercent(stock.priceChangePct)})
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pergerakan Harga</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPrices ? <Skeleton className="h-72 w-full" /> : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={prices} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(val) => new Date(val).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' })}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      domain={['auto', 'auto']} 
                      tickFormatter={(val) => val.toLocaleString('id-ID')}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      width={60}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      formatter={(val: number) => formatRupiah(val)}
                      labelFormatter={(label) => new Date(label).toLocaleDateString('id-ID')}
                    />
                    <Area type="monotone" dataKey="close" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorPrice)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Scores */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-primary" /> AI Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center mb-6">
              <div className="text-5xl font-mono font-bold">{stock.totalScore}</div>
              <div className="text-sm text-muted-foreground">Total Score</div>
            </div>
            <ScoreRow label="Trend" score={stock.trendScore ?? 0} />
            <ScoreRow label="Momentum" score={stock.momentumScore ?? 0} />
            <ScoreRow label="Volume" score={stock.volumeScore ?? 0} />
            <ScoreRow label="Fundamental" score={stock.fundamentalScore ?? 0} />
            <ScoreRow label="Valuation" score={stock.valuationScore ?? 0} />
            <ScoreRow label="Risk" score={stock.riskScore ?? 0} reverse />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Technicals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Analisis Teknikal</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTech ? <Skeleton className="h-40 w-full" /> : (
              <div className="grid grid-cols-2 gap-4">
                <TechItem label="RSI (14)" value={technicals?.rsi14?.toFixed(2)} />
                <TechItem label="MA20" value={technicals?.ma20 ? formatRupiah(technicals.ma20) : '-'} />
                <TechItem label="MA50" value={technicals?.ma50 ? formatRupiah(technicals.ma50) : '-'} />
                <TechItem label="MA200" value={technicals?.ma200 ? formatRupiah(technicals.ma200) : '-'} />
                <TechItem label="Support" value={technicals?.supportLevel ? formatRupiah(technicals.supportLevel) : '-'} />
                <TechItem label="Resistance" value={technicals?.resistanceLevel ? formatRupiah(technicals.resistanceLevel) : '-'} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fundamentals */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Fundamental Ringkas</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingStock ? <Skeleton className="h-40 w-full" /> : (
              <div className="grid grid-cols-2 gap-4">
                <TechItem label="P/E Ratio" value={stock.fundamentals?.pe?.toFixed(2) ?? '-'} />
                <TechItem label="P/B Ratio" value={stock.fundamentals?.pb?.toFixed(2) ?? '-'} />
                <TechItem label="ROE" value={stock.fundamentals?.roe ? formatPercent(stock.fundamentals.roe) : '-'} />
                <TechItem label="EPS" value={stock.fundamentals?.eps?.toFixed(2) ?? '-'} />
                <TechItem label="Market Cap" value={stock.marketCap ? formatLargeNumber(stock.marketCap) : '-'} />
                <TechItem label="Volume / Avg" value={`${formatLargeNumber(stock.volume)} / ${stock.avgVolume ? formatLargeNumber(stock.avgVolume) : '-'}`} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Report */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> AI Analyst Report
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleGenerateReport} 
            disabled={generateReport.isPending}
          >
            {generateReport.isPending ? "Generating..." : "Generate New Report"}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingReport ? <Skeleton className="h-32 w-full" /> : !report ? (
            <p className="text-muted-foreground">Belum ada laporan AI untuk saham ini. Klik generate.</p>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <h4 className="font-semibold text-lg">Summary</h4>
                <p className="text-muted-foreground leading-relaxed">{report.summary}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-positive/10 border border-positive/20 p-4 rounded-lg space-y-2">
                  <h4 className="font-bold text-positive flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Bullish Scenario</h4>
                  <p className="text-sm text-foreground/80">{report.bullishScenario}</p>
                </div>
                <div className="bg-negative/10 border border-negative/20 p-4 rounded-lg space-y-2">
                  <h4 className="font-bold text-negative flex items-center gap-2"><TrendingDown className="w-4 h-4"/> Bearish Scenario</h4>
                  <p className="text-sm text-foreground/80">{report.bearishScenario}</p>
                </div>
              </div>
              <div className="bg-card p-4 rounded-lg border border-border space-y-2">
                <h4 className="font-bold text-warning flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-500"/> Risk Analysis</h4>
                <p className="text-sm text-muted-foreground">{report.riskAnalysis}</p>
              </div>
              <div className="pt-4 border-t border-border">
                <h4 className="font-semibold mb-2">Conclusion</h4>
                <p className="text-foreground">{report.conclusion}</p>
                <div className="mt-4 text-xs text-muted-foreground text-right">
                  Generated at: {new Date(report.generatedAt).toLocaleString('id-ID')}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreRow({ label, score, reverse = false }: { label: string, score: number, reverse?: boolean }) {
  // If reverse, high score is bad (red), low is good (green)
  let color = "bg-primary";
  if (reverse) {
    if (score > 70) color = "bg-negative";
    else if (score > 40) color = "bg-amber-500";
    else color = "bg-positive";
  } else {
    if (score > 70) color = "bg-positive";
    else if (score > 40) color = "bg-amber-500";
    else color = "bg-negative";
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono">{score}</span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

function TechItem({ label, value }: { label: string, value: string | undefined }) {
  return (
    <div className="p-3 bg-muted/30 rounded border border-border/50">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
