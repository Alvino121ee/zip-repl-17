/**
 * Halaman Pricing — daftar VIP plans, pilih, bayar
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, Zap, Crown, Star, Loader2, ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMemberToken } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface VipPlan {
  id:          number;
  slug:        string;
  name:        string;
  description: string;
  price:       number;
  durationDays:number;
  features:    string[];
  sortOrder:   number;
}

const PLAN_ICONS: Record<number, React.ComponentType<{ className?: string }>> = {};

function PlanIcon({ index, className }: { index: number; className?: string }) {
  const icons = [Star, Crown, Zap];
  const Icon = icons[index % icons.length];
  return <Icon className={className} />;
}

function formatRupiah(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function PricingPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const memberToken = getMemberToken();

  const { data, isLoading } = useQuery<{ ok: boolean; plans: VipPlan[] }>({
    queryKey: ["pricing-plans"],
    queryFn: () => fetch("/api/payment/plans").then(r => r.json()),
  });

  const { data: myPlan } = useQuery<{ ok: boolean; plan: string; planName: string; planExpiresAt: string | null; isVip: boolean }>({
    queryKey: ["my-plan"],
    queryFn: () => fetch("/api/payment/my-plan", {
      headers: { Authorization: `Bearer ${memberToken}` },
    }).then(r => r.json()),
    enabled: !!memberToken,
  });

  const createMut = useMutation({
    mutationFn: async (planSlug: string) => {
      if (!memberToken) throw new Error("LOGIN_REQUIRED");
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ planSlug }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Gagal membuat transaksi");
      return data;
    },
    onSuccess: (data) => {
      navigate(`/payment/${data.orderId}`);
    },
    onError: (err: Error) => {
      if (err.message === "LOGIN_REQUIRED") {
        toast({ title: "Login Diperlukan", description: "Silakan login atau daftar terlebih dahulu", variant: "destructive" });
        navigate("/login/member?redirect=/pricing");
        return;
      }
      toast({ title: "Gagal", description: err.message, variant: "destructive" });
    },
  });

  const plans = data?.plans ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border/30 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="font-semibold">Paket VIP</span>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 text-amber-400 px-3 py-1.5 rounded-full text-sm font-medium mb-4">
            <Crown className="w-4 h-4" /> Upgrade ke VIP
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Akses Sinyal AI Penuh</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Dapatkan prediksi XAUUSD real-time dengan entry, TP, dan SL yang dipelajari oleh AI setiap 5 menit.
          </p>
          {myPlan?.isVip && (
            <div className="mt-4 inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 px-4 py-2 rounded-full text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Plan aktif: <strong>{myPlan.planName}</strong>
              {myPlan.planExpiresAt && (
                <span className="text-emerald-300/70">
                  · Berakhir {new Date(myPlan.planExpiresAt).toLocaleDateString("id-ID")}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Plans Grid */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Crown className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>Belum ada paket VIP. Hubungi admin untuk informasi lebih lanjut.</p>
          </div>
        ) : (
          <div className={`grid gap-6 ${plans.length === 1 ? "max-w-sm mx-auto" : plans.length === 2 ? "md:grid-cols-2 max-w-2xl mx-auto" : "md:grid-cols-3"}`}>
            {plans.map((plan, i) => {
              const isPopular = i === Math.floor(plans.length / 2) && plans.length > 1;
              return (
                <Card
                  key={plan.id}
                  className={`relative flex flex-col border ${isPopular ? "border-amber-500/50 bg-amber-500/5" : "border-border/50"}`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-amber-500 text-amber-950 hover:bg-amber-500">TERPOPULER</Badge>
                    </div>
                  )}
                  <CardHeader className="pb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${isPopular ? "bg-amber-500/20 text-amber-400" : "bg-primary/10 text-primary"}`}>
                      <PlanIcon index={i} className="w-5 h-5" />
                    </div>
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    )}
                    <div className="mt-2">
                      <span className="text-3xl font-bold">{formatRupiah(plan.price)}</span>
                      <span className="text-muted-foreground text-sm"> / {plan.durationDays} hari</span>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-4">
                    {/* Features */}
                    <ul className="space-y-2 flex-1">
                      {(plan.features as string[]).map((f, fi) => (
                        <li key={fi} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                      {(plan.features as string[]).length === 0 && (
                        <li className="text-sm text-muted-foreground">Akses penuh semua fitur VIP</li>
                      )}
                    </ul>
                    <Button
                      className={`w-full mt-2 ${isPopular ? "bg-amber-500 hover:bg-amber-600 text-amber-950" : ""}`}
                      disabled={createMut.isPending}
                      onClick={() => createMut.mutate(plan.slug)}
                    >
                      {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Bayar Sekarang"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Guarantee */}
        <div className="mt-12 flex flex-wrap justify-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Pembayaran aman via QRIS
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Aktif otomatis setelah bayar
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            AI belajar setiap 5 menit
          </div>
        </div>
      </div>
    </div>
  );
}
