/**
 * Halaman Payment — tampilkan QRIS + polling status otomatis
 */
import { useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, Clock, Loader2, ArrowLeft,
  ExternalLink, Copy, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMemberToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import QRCode from "qrcode";
import { useEffect as useEffectCanvas, useRef as useRefCanvas } from "react";

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

interface PaymentStatus {
  ok:     boolean;
  status: "pending" | "completed" | "expired" | "failed";
  payment: {
    orderId:    string;
    amount:     number;
    planName:   string;
    qrString:   string;
    paymentUrl: string;
    expiresAt:  string;
    status:     string;
  };
}

function QRCanvas({ qrString }: { qrString: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !qrString) return;
    QRCode.toCanvas(canvasRef.current, qrString, { width: 240, margin: 2 }, (err) => {
      if (err) console.error("QR error:", err);
    });
  }, [qrString]);
  return <canvas ref={canvasRef} className="rounded-lg mx-auto" />;
}

export default function PaymentPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId ?? "";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const memberToken = getMemberToken();
  const redirectedRef = useRef(false);

  const { data, isLoading, refetch } = useQuery<PaymentStatus>({
    queryKey: ["payment-status", orderId],
    queryFn: () => fetch(`/api/payment/status/${orderId}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    }).then(r => r.json()),
    enabled: !!memberToken && !!orderId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s === "completed" || s === "expired" || s === "failed") return false;
      return 5000; // poll tiap 5 detik
    },
  });

  useEffect(() => {
    if (data?.status === "completed" && !redirectedRef.current) {
      redirectedRef.current = true;
      toast({ title: "✅ Pembayaran Berhasil!", description: "Akun VIP Anda telah aktif." });
      setTimeout(() => navigate("/member"), 2000);
    }
  }, [data?.status]);

  const payment = data?.payment;
  const status  = data?.status ?? "pending";

  if (!memberToken) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Silakan login terlebih dahulu.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/pricing")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold">Pembayaran</span>
      </div>

      <div className="max-w-md mx-auto px-4 py-10">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !payment ? (
          <div className="text-center py-16 text-muted-foreground">
            <XCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>Transaksi tidak ditemukan.</p>
          </div>
        ) : status === "completed" ? (
          <div className="text-center py-16">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-emerald-400" />
            <h2 className="text-2xl font-bold mb-2">Pembayaran Berhasil!</h2>
            <p className="text-muted-foreground mb-6">Akun VIP <strong>{payment.planName}</strong> Anda sudah aktif.</p>
            <Button onClick={() => navigate("/member")}>Masuk ke Area Member</Button>
          </div>
        ) : status === "expired" || status === "failed" ? (
          <div className="text-center py-16">
            <XCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
            <h2 className="text-2xl font-bold mb-2">Transaksi Kedaluwarsa</h2>
            <p className="text-muted-foreground mb-6">Silakan buat transaksi baru untuk melanjutkan.</p>
            <Button onClick={() => navigate("/pricing")}>Coba Lagi</Button>
          </div>
        ) : (
          /* pending */
          <div className="space-y-6">
            {/* Status banner */}
            <div className="flex items-center justify-center gap-2 bg-amber-500/10 border border-amber-500/25 text-amber-400 rounded-lg px-4 py-3">
              <Clock className="w-4 h-4 animate-pulse" />
              <span className="text-sm font-medium">Menunggu pembayaran · Auto-refresh setiap 5 detik</span>
            </div>

            <Card className="border-border/50">
              <CardContent className="pt-6 space-y-4">
                {/* Order info */}
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">Paket</p>
                  <p className="text-lg font-bold">{payment.planName}</p>
                  <p className="text-2xl font-bold text-amber-400">{formatRupiah(payment.amount)}</p>
                </div>

                <div className="border-t border-border/30 pt-4">
                  {/* QR Code */}
                  {payment.qrString ? (
                    <div className="text-center space-y-3">
                      <p className="text-sm text-muted-foreground font-medium">Scan QRIS untuk membayar</p>
                      <QRCanvas qrString={payment.qrString} />
                      <p className="text-xs text-muted-foreground">
                        GoPay · OVO · DANA · ShopeePay · LinkAja · dan lainnya
                      </p>
                    </div>
                  ) : (
                    <div className="text-center text-muted-foreground text-sm py-4">
                      QR tidak tersedia. Gunakan link pembayaran di bawah.
                    </div>
                  )}
                </div>

                {/* Payment URL */}
                {payment.paymentUrl && (
                  <a
                    href={payment.paymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full border border-border/50 rounded-lg px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Buka Halaman Pembayaran
                  </a>
                )}

                {/* Order ID */}
                <div className="flex items-center justify-between bg-muted/20 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Order ID</p>
                    <p className="text-xs font-mono">{payment.orderId}</p>
                  </div>
                  <button
                    onClick={() => { navigator.clipboard.writeText(payment.orderId); toast({ title: "Disalin!" }); }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expiry */}
                <p className="text-xs text-center text-muted-foreground">
                  Kedaluwarsa: {new Date(payment.expiresAt).toLocaleString("id-ID")}
                </p>

                <Button variant="outline" size="sm" className="w-full" onClick={() => refetch()}>
                  <RefreshCw className="w-3.5 h-3.5 mr-2" /> Cek Status Manual
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
