import { useGetWatchlist, useRemoveFromWatchlist } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah, formatPercent, getLabelColor } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Watchlist() {
  // Using guest for demo purposes as requested
  const userId = "guest";
  const { data: watchlist, isLoading } = useGetWatchlist({ userId });
  const removeFromWatchlist = useRemoveFromWatchlist();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRemove = (ticker: string) => {
    removeFromWatchlist.mutate({ ticker, params: { userId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
        toast({ title: "Dihapus", description: `${ticker} dihapus dari watchlist.` });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Watchlist</h1>
        <p className="text-muted-foreground mt-1">Pantau saham-saham pilihan Anda.</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : watchlist?.length === 0 ? (
        <div className="text-center p-12 bg-card border border-border rounded-lg">
          <p className="text-muted-foreground">Watchlist kosong. Tambahkan saham dari Screener.</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/screener">Ke Screener</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {watchlist?.map(item => {
            const stock = item.stock;
            if (!stock) return null;
            
            return (
              <Card key={item.id} className="group overflow-hidden border-border bg-card">
                <CardContent className="p-0">
                  <div className="p-4 border-b border-border bg-muted/20 flex justify-between items-start">
                    <div>
                      <Link href={`/saham/${stock.ticker}`} className="text-xl font-bold font-mono text-primary hover:underline">
                        {stock.ticker}
                      </Link>
                      <div className="text-xs text-muted-foreground truncate w-40">{stock.name}</div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRemove(stock.ticker)}
                    >
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Harga</div>
                      <div className="font-mono font-medium">{formatRupiah(stock.currentPrice)}</div>
                      <div className={`text-xs font-mono ${stock.priceChangePct >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {stock.priceChangePct > 0 ? '+' : ''}{formatPercent(stock.priceChangePct)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">AI Score</div>
                      <div className="font-mono font-bold text-xl">{stock.totalScore}</div>
                      <Badge className={getLabelColor(stock.label)} variant="outline">{stock.label}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
