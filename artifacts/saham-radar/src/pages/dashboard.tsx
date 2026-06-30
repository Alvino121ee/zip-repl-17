import { 
  useGetMarketSummary, 
  useGetTopMovers, 
  useGetSectorPerformance, 
  useGetLabelDistribution 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah, formatPercent } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetMarketSummary();
  const { data: movers, isLoading: loadingMovers } = useGetTopMovers();
  const { data: sectors, isLoading: loadingSectors } = useGetSectorPerformance();
  const { data: labels, isLoading: loadingLabels } = useGetLabelDistribution();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Market Dashboard</h1>
        <p className="text-muted-foreground mt-1">Ringkasan kondisi pasar BEI hari ini.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard 
          title="Total Stocks" 
          value={summary?.totalStocks} 
          icon={<Activity className="w-4 h-4 text-muted-foreground" />} 
          loading={loadingSummary} 
        />
        <SummaryCard 
          title="Advancers" 
          value={summary?.advancers} 
          icon={<TrendingUp className="w-4 h-4 text-positive" />} 
          loading={loadingSummary} 
          valueClass="text-positive"
        />
        <SummaryCard 
          title="Decliners" 
          value={summary?.decliners} 
          icon={<TrendingDown className="w-4 h-4 text-negative" />} 
          loading={loadingSummary}
          valueClass="text-negative"
        />
        <SummaryCard 
          title="Unchanged" 
          value={summary?.unchanged} 
          icon={<Minus className="w-4 h-4 text-muted-foreground" />} 
          loading={loadingSummary} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Gainers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-positive flex items-center gap-2">
              <TrendingUp className="w-5 h-5" /> Top Gainers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingMovers ? <Skeleton className="h-48 w-full" /> : (
              <div className="space-y-2">
                {movers?.gainers?.slice(0, 5).map(stock => (
                  <div key={stock.ticker} className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <div>
                      <div className="font-bold">{stock.ticker}</div>
                      <div className="text-xs text-muted-foreground truncate w-32">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">{formatRupiah(stock.currentPrice)}</div>
                      <div className="text-xs text-positive">+{formatPercent(stock.priceChangePct)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Losers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-negative flex items-center gap-2">
              <TrendingDown className="w-5 h-5" /> Top Losers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingMovers ? <Skeleton className="h-48 w-full" /> : (
              <div className="space-y-2">
                {movers?.losers?.slice(0, 5).map(stock => (
                  <div key={stock.ticker} className="flex justify-between items-center p-2 rounded bg-muted/50">
                    <div>
                      <div className="font-bold">{stock.ticker}</div>
                      <div className="text-xs text-muted-foreground truncate w-32">{stock.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">{formatRupiah(stock.currentPrice)}</div>
                      <div className="text-xs text-negative">{formatPercent(stock.priceChangePct)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sector Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sector Performance</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSectors ? <Skeleton className="h-64 w-full" /> : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sectors} layout="vertical" margin={{ top: 0, right: 0, left: 40, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="sector" type="category" width={100} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      formatter={(val: number) => formatPercent(val)}
                    />
                    <Bar dataKey="avgChange" radius={[0, 4, 4, 0]}>
                      {sectors?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.avgChange >= 0 ? 'hsl(var(--positive))' : 'hsl(var(--negative))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Label Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">AI Label Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingLabels ? <Skeleton className="h-64 w-full" /> : (
              <div className="space-y-4 mt-4">
                {labels?.map(label => {
                  const pct = summary?.totalStocks ? (label.count / summary.totalStocks) * 100 : 0;
                  return (
                    <div key={label.label} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{label.label}</span>
                        <span className="font-mono text-muted-foreground">{label.count}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full rounded-full" 
                          style={{ 
                            width: `${pct}%`,
                            backgroundColor: getLabelColorHex(label.label)
                          }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, icon, loading, valueClass = "" }: any) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-7 w-20" /> : (
          <div className={`text-2xl font-bold font-mono ${valueClass}`}>
            {value?.toLocaleString('id-ID') ?? '-'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getLabelColorHex(label: string) {
  switch (label) {
    case 'Strong Watchlist': return '#059669'; // emerald-600
    case 'Watchlist': return '#34d399'; // emerald-400
    case 'Neutral': return '#f59e0b'; // amber-500
    case 'Risky': return '#f97316'; // orange-500
    case 'Avoid': return '#dc2626'; // red-600
    default: return '#64748b'; // slate-500
  }
}
