#!/usr/bin/env bash
# Menjalankan seluruh layanan proyek (API Server + Web App Saham Radar) sekaligus.
# Gunakan ini jika ingin menjalankan semuanya dari satu perintah terminal.
# Di dalam Replit, kedua layanan ini sudah otomatis berjalan lewat Workflows
# ("API Server" dan "Start application") — script ini untuk kebutuhan manual/CLI.

set -euo pipefail

cd "$(dirname "$0")"

cleanup() {
  echo ""
  echo "Menghentikan semua layanan..."
  jobs -p | xargs -r kill 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Menjalankan API Server di port 8080..."
PORT=8080 pnpm --filter @workspace/api-server run dev &
API_PID=$!

echo "==> Menjalankan Web App (Saham Radar) di port 19024..."
PORT=19024 BASE_PATH=/ pnpm --filter @workspace/saham-radar run dev &
WEB_PID=$!

echo ""
echo "Semua layanan berjalan:"
echo "  - API Server        : http://localhost:8080"
echo "  - Saham Radar Web   : http://localhost:19024"
echo ""
echo "Tekan Ctrl+C untuk menghentikan semua layanan."

wait $API_PID $WEB_PID
