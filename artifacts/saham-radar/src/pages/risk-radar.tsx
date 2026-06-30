import { useGetRiskRadar } from "@workspace/api-client-react";
import { formatRupiah, formatPercent } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";

export default function RiskRadar() {
  const { data, isLoading } = useGetRiskRadar({ limit: 50 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-negative flex items-center gap-2">
          <AlertTriangle className="w-8 h-8" /> Risk Radar
        </h1>
        <p className="text-muted-foreground mt-1">
          Daftar saham dengan profil risiko tinggi. Hati-hati dengan volatilitas, likuiditas rendah, atau fundamental yang memburuk.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead className="text-right">Harga</TableHead>
              <TableHead className="text-right">% Chg</TableHead>
              <TableHead className="text-right">Risk Score</TableHead>
              <TableHead>Risk Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                </TableRow>
              ))
            ) : data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                  Tidak ada data saham berisiko tinggi saat ini.
                </TableCell>
              </TableRow>
            ) : (
              data?.map(stock => (
                <TableRow key={stock.ticker} className="hover:bg-muted/30">
                  <TableCell>
                    <Link href={`/saham/${stock.ticker}`} className="font-bold font-mono text-primary hover:underline">
                      {stock.ticker}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatRupiah(stock.currentPrice)}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-sm ${stock.priceChangePct >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {stock.priceChangePct > 0 ? '+' : ''}{formatPercent(stock.priceChangePct)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="font-mono text-negative font-bold">{stock.riskScore}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {stock.riskFlags.map((flag, i) => (
                        <Badge key={i} variant="outline" className="bg-negative/10 text-negative border-negative/30 text-[10px] uppercase">
                          {flag}
                        </Badge>
                      ))}
                    </div>
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
