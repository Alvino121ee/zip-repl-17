import { useState, useEffect } from "react";
import { useUploadCsv, useRecalculateScores, useSyncRealtime, useGetSyncStatus, CsvUploadInputDataType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Upload, RefreshCw, Wifi, WifiOff, Clock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

function formatTime(isoStr: string) {
  return new Date(isoStr).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function SyncPanel() {
  const { toast } = useToast();
  const syncMutation = useSyncRealtime();
  const { data: status, refetch } = useGetSyncStatus({
    query: { refetchInterval: 5000 }
  });

  const handleSync = () => {
    syncMutation.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Sync Dimulai", description: "Data realtime sedang diambil dari Yahoo Finance. Proses berjalan di background (~2-3 menit)." });
        setTimeout(() => refetch(), 2000);
      },
      onError: (err: any) => {
        toast({ title: "Sync Gagal", description: err.message || "Terjadi kesalahan.", variant: "destructive" });
      }
    });
  };

  const inProgress = status?.inProgress ?? false;
  const last = status?.lastSync;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-primary" />
          Sync Data Realtime (Yahoo Finance)
          {inProgress && (
            <Badge variant="secondary" className="animate-pulse ml-2">Sedang Sync...</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Ambil harga saham terkini langsung dari pasar IDX via Yahoo Finance. Harga, volume, dan skor AI akan diperbarui ke data aktual.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handleSync}
          disabled={syncMutation.isPending || inProgress}
          className="w-full"
          size="lg"
        >
          {inProgress ? (
            <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Sync Sedang Berjalan...</>
          ) : (
            <><Wifi className="w-4 h-4 mr-2" /> Sync Data Realtime Sekarang</>
          )}
        </Button>

        {last && (
          <div className="rounded-lg bg-muted/50 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Hasil Sync Terakhir
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 rounded bg-positive/10 border border-positive/20">
                <div className="text-2xl font-bold text-positive">{last.updated}</div>
                <div className="text-xs text-muted-foreground mt-1">Saham Diperbarui</div>
              </div>
              <div className="text-center p-3 rounded bg-muted border">
                <div className="text-2xl font-bold">{last.skipped}</div>
                <div className="text-xs text-muted-foreground mt-1">Dilewati</div>
              </div>
              <div className="text-center p-3 rounded bg-destructive/10 border border-destructive/20">
                <div className="text-2xl font-bold text-destructive">{last.errors.length}</div>
                <div className="text-xs text-muted-foreground mt-1">Error</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Selesai: {formatTime(last.finishedAt)}
            </div>
            {last.errors.length > 0 && (
              <div className="text-xs text-destructive font-mono bg-destructive/5 rounded p-2 max-h-24 overflow-y-auto">
                {last.errors.slice(0, 5).join('\n')}
              </div>
            )}
          </div>
        )}

        <Alert className="bg-blue-500/10 border-blue-500/20">
          <AlertCircle className="h-4 w-4 text-blue-500" />
          <AlertTitle className="text-blue-500">Informasi</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            Data harga diambil dari Yahoo Finance (IDX: ticker.JK). Proses sync 75 saham membutuhkan sekitar 2-3 menit.
            Fundamental (PE, ROE, dll) tetap menggunakan data yang sudah ada karena tidak berubah harian.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

export default function AdminPanel() {
  const [csvData, setCsvData] = useState("");
  const [dataType, setDataType] = useState<CsvUploadInputDataType>("stocks");
  const { toast } = useToast();

  const uploadCsv = useUploadCsv();
  const recalcScores = useRecalculateScores();

  const handleUpload = () => {
    if (!csvData.trim()) {
      toast({ description: "Data CSV tidak boleh kosong", variant: "destructive" });
      return;
    }

    uploadCsv.mutate({ data: { csvData, dataType } }, {
      onSuccess: (res) => {
        toast({ title: "Upload Berhasil", description: `${res.rowsProcessed} baris diproses.` });
        setCsvData("");
      },
      onError: (err: any) => {
        toast({ title: "Upload Gagal", description: err.message || "Terjadi kesalahan.", variant: "destructive" });
      }
    });
  };

  const handleRecalc = () => {
    recalcScores.mutate({ data: {} }, {
      onSuccess: (res) => {
        toast({ title: "Rekalkulasi Selesai", description: `${res.processed} saham diperbarui.` });
      },
      onError: (err: any) => {
        toast({ title: "Gagal", description: err.message || "Terjadi kesalahan.", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
        <p className="text-muted-foreground mt-1">Manajemen data dan sinkronisasi pasar.</p>
      </div>

      {/* Sync Realtime - Most Important */}
      <SyncPanel />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" /> Recalculate AI Scores</CardTitle>
          <CardDescription>Hitung ulang skor AI dari data harga yang sudah ada di database.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleRecalc} disabled={recalcScores.isPending} variant="secondary" className="w-full">
            {recalcScores.isPending ? "Memproses..." : "Jalankan Algoritma Scoring"}
          </Button>
          
          {recalcScores.data && (
            <Alert className="mt-4 bg-muted/50">
              <CheckCircle2 className="h-4 w-4 text-positive" />
              <AlertTitle>Selesai</AlertTitle>
              <AlertDescription className="text-xs">
                {recalcScores.data.processed} saham berhasil diskor ulang.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> Import Data CSV</CardTitle>
          <CardDescription>Format harus sesuai dengan template sistem. Pastikan header kolom benar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Tipe Data</label>
            <Select value={dataType} onValueChange={(val: any) => setDataType(val)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Pilih tipe data" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stocks">Data Stocks</SelectItem>
                <SelectItem value="prices">Data Prices (OHLCV)</SelectItem>
                <SelectItem value="fundamentals">Data Fundamentals</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Paste CSV Data</label>
            <Textarea 
              className="font-mono text-xs h-64 bg-black/50" 
              placeholder="TICKER,NAME,SECTOR,CURRENT_PRICE..." 
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
            />
          </div>

          <Button onClick={handleUpload} disabled={uploadCsv.isPending} className="w-full">
            {uploadCsv.isPending ? "Mengunggah..." : "Upload CSV"}
          </Button>

          {uploadCsv.data && (
            <Alert className={uploadCsv.data.success ? "bg-positive/10 border-positive/30 text-positive" : "bg-destructive/10 border-destructive/30 text-destructive"}>
              {uploadCsv.data.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              <AlertTitle>{uploadCsv.data.success ? "Berhasil" : "Ada Kesalahan"}</AlertTitle>
              <AlertDescription>
                <ul className="text-xs list-disc pl-4 mt-2">
                  <li>Baris diproses: {uploadCsv.data.rowsProcessed}</li>
                  <li>Baris diinsert: {uploadCsv.data.rowsInserted}</li>
                  <li>Baris diupdate: {uploadCsv.data.rowsUpdated}</li>
                  {uploadCsv.data.errors.length > 0 && (
                    <li className="mt-2 text-destructive font-mono whitespace-pre-wrap">{uploadCsv.data.errors.join('\n')}</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
