import { useState } from "react";
import { useCompareStocks } from "@workspace/api-client-react";
import { formatRupiah, formatPercent, getLabelColor, formatLargeNumber } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip as RechartsTooltip } from "recharts";
import { X, GitCompare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Compare() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const { toast } = useToast();
  
  const compareMutation = useCompareStocks();

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const t = inputValue.trim().toUpperCase();
    if (!t) return;
    if (tickers.includes(t)) {
      toast({ description: "Saham sudah ada di daftar komparasi." });
      return;
    }
    if (tickers.length >= 5) {
      toast({ description: "Maksimal 5 saham untuk komparasi.", variant: "destructive" });
      return;
    }
    setTickers([...tickers, t]);
    setInputValue("");
  };

  const handleRemove = (ticker: string) => {
    setTickers(tickers.filter(t => t !== ticker));
  };

  const handleCompare = () => {
    if (tickers.length < 2) {
      toast({ description: "Pilih minimal 2 saham.", variant: "destructive" });
      return;
    }
    compareMutation.mutate({ data: { tickers } });
  };

  const results = compareMutation.data;

  // Prepare Radar Chart Data
  const radarData = [
    { subject: 'Trend', fullMark: 100 },
    { subject: 'Momentum', fullMark: 100 },
    { subject: 'Volume', fullMark: 100 },
    { subject: 'Fundamental', fullMark: 100 },
    { subject: 'Valuation', fullMark: 100 },
  ];

  const processedRadarData = radarData.map(item => {
    const row: any = { subject: item.subject };
    results?.forEach(stock => {
      row[stock.ticker] = stock[`${item.subject.toLowerCase()}Score` as keyof typeof stock] || 0;
    });
    return row;
  });

  const colors = ['#14b8a6', '#f43f5e', '#f59e0b', '#3b82f6', '#8b5cf6'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compare Stocks</h1>
        <p className="text-muted-foreground mt-1">Bandingkan metrik dan AI score hingga 5 saham.</p>
      </div>

      <Card className="bg-card">
        <CardContent className="p-6">
          <form onSubmit={handleAdd} className="flex gap-2 max-w-lg mb-4">
            <Input 
              placeholder="Masukkan kode saham (misal: BBCA) lalu enter" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="font-mono uppercase"
            />
            <Button type="submit" variant="secondary">Tambah</Button>
          </form>

          <div className="flex flex-wrap gap-2 mb-6">
            {tickers.map(ticker => (
              <Badge key={ticker} variant="secondary" className="px-3 py-1 text-sm font-mono flex items-center gap-2">
                {ticker}
                <button type="button" onClick={() => handleRemove(ticker)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
            {tickers.length === 0 && <span className="text-sm text-muted-foreground">Belum ada saham dipilih.</span>}
          </div>

          <Button 
            onClick={handleCompare} 
            disabled={tickers.length < 2 || compareMutation.isPending}
            className="w-full md:w-auto"
          >
            {compareMutation.isPending ? "Membandingkan..." : <><GitCompare className="w-4 h-4 mr-2" /> Bandingkan Sekarang</>}
          </Button>
        </CardContent>
      </Card>

      {results && results.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4">
          <Card className="xl:col-span-1 border-border">
            <CardContent className="p-6 h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={processedRadarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <RechartsTooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }} />
                  <Legend />
                  {results.map((stock, i) => (
                    <Radar 
                      key={stock.ticker}
                      name={stock.ticker} 
                      dataKey={stock.ticker} 
                      stroke={colors[i]} 
                      fill={colors[i]} 
                      fillOpacity={0.3} 
                    />
                  ))}
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2 overflow-x-auto border-border">
            <table className="w-full text-sm text-left">
              <thead className="text-xs uppercase bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Metrik</th>
                  {results.map(stock => (
                    <th key={stock.ticker} className="px-6 py-3 font-mono font-bold text-foreground text-base">
                      {stock.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 font-medium">Harga</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4 font-mono">{formatRupiah(stock.currentPrice)}</td>
                  ))}
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 font-medium">% Perubahan</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className={`px-6 py-4 font-mono ${stock.priceChangePct >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {stock.priceChangePct > 0 ? '+' : ''}{formatPercent(stock.priceChangePct)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 font-medium">Label AI</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4">
                      <Badge className={getLabelColor(stock.label)} variant="outline">{stock.label}</Badge>
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/50 bg-muted/10">
                  <td className="px-6 py-4 font-bold text-primary">Total Score</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4 font-mono font-bold text-lg text-primary">{stock.totalScore}</td>
                  ))}
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 font-medium">Market Cap</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4 font-mono text-muted-foreground">
                      {stock.marketCap ? formatLargeNumber(stock.marketCap) : '-'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-border/50">
                  <td className="px-6 py-4 font-medium">P/E Ratio</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4 font-mono text-muted-foreground">
                      {stock.fundamentals?.pe?.toFixed(2) ?? '-'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-6 py-4 font-medium">ROE</td>
                  {results.map(stock => (
                    <td key={stock.ticker} className="px-6 py-4 font-mono text-muted-foreground">
                      {stock.fundamentals?.roe ? formatPercent(stock.fundamentals.roe) : '-'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
