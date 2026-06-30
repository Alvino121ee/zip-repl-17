import { useState } from "react";
import { useListStocks } from "@workspace/api-client-react";
import { formatRupiah, formatPercent, getLabelColor, formatLargeNumber } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Search } from "lucide-react";

export default function Screener() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  
  // Minimal debouncing for search
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setDebouncedSearch(search);
  };

  const { data, isLoading } = useListStocks({
    limit: 50,
    search: debouncedSearch || undefined,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stock Screener</h1>
        <p className="text-muted-foreground mt-1">Screening saham berdasarkan fundamental, teknikal, dan AI score.</p>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border border-border">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2 max-w-sm">
          <Input 
            placeholder="Cari kode atau nama saham..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="font-mono bg-background"
          />
          <Button type="submit" variant="secondary"><Search className="w-4 h-4" /></Button>
        </form>
        {/* Further filters could go here */}
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead className="text-right">Harga</TableHead>
              <TableHead className="text-right">% Chg</TableHead>
              <TableHead className="text-right">Volume</TableHead>
              <TableHead className="text-right">Total Score</TableHead>
              <TableHead>Label AI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                </TableRow>
              ))
            ) : data?.stocks?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Tidak ada data saham ditemukan.
                </TableCell>
              </TableRow>
            ) : (
              data?.stocks?.map(stock => (
                <TableRow key={stock.ticker} className="hover:bg-muted/30">
                  <TableCell>
                    <Link href={`/saham/${stock.ticker}`} className="font-bold font-mono text-primary hover:underline">
                      {stock.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
                    {stock.name}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatRupiah(stock.currentPrice)}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm ${stock.priceChangePct >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {stock.priceChangePct > 0 ? '+' : ''}{formatPercent(stock.priceChangePct)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {formatLargeNumber(stock.volume)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-bold font-mono">{stock.totalScore}</span>
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, stock.totalScore))}%` }} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getLabelColor(stock.label)} variant="outline">{stock.label}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
