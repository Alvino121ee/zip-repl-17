import { useState } from "react";
import { useUploadCsv, useRecalculateScores, CsvUploadInputDataType } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, CheckCircle2, Upload, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
        <p className="text-muted-foreground mt-1">Manajemen data terminal.</p>
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RefreshCw className="w-5 h-5" /> Recalculate AI Scores</CardTitle>
          <CardDescription>Jalankan ini setelah mengunggah data harga atau fundamental baru untuk mengupdate skor dan label AI.</CardDescription>
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
    </div>
  );
}
