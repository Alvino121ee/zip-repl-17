#!/usr/bin/env bash
# ============================================================================
# Saham Radar — Skrip Menjalankan Aplikasi (Linux/macOS)
#
# Cukup jalankan file ini (./start.sh). Skrip ini akan otomatis:
#   1. Mengecek Node.js & pnpm terpasang
#   2. Menginstall semua dependency yang dibutuhkan
#   3. Membuat file .env jika belum ada (Anda tinggal isi DATABASE_URL, dll)
#   4. Menjalankan API Server (port 8080) dan Web App (port 19024) sekaligus
#
# Setelah berjalan, buka http://localhost:19024 di browser.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")"

echo "=============================================="
echo "  Saham Radar - Menyiapkan & Menjalankan App"
echo "=============================================="
echo ""

# 1. Cek Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js belum terpasang. Silakan install Node.js versi 20+ dari https://nodejs.org lalu jalankan skrip ini lagi."
  exit 1
fi
echo "[OK] Node.js terdeteksi: $(node -v)"

# 2. Cek / install pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[INFO] pnpm belum terpasang, menginstall pnpm..."
  npm install -g pnpm
fi
echo "[OK] pnpm terdeteksi: $(pnpm -v)"

# 3. Buat .env jika belum ada
if [ ! -f ".env" ]; then
  echo "[INFO] File .env belum ada, membuat template .env..."
  cat > .env <<'EOF'
# Isi konfigurasi berikut sesuai kebutuhan Anda.

# Wajib: koneksi database PostgreSQL
DATABASE_URL=

# Opsional: DeepSeek API key untuk fitur AI (bisa juga diatur lewat halaman Pengaturan di website)
DEEPSEEK_API_KEY=
EOF
  echo "[PENTING] Silakan buka file .env dan isi DATABASE_URL sebelum menjalankan aplikasi."
fi

# Load .env agar variabelnya tersedia untuk proses di bawah
set -a
# shellcheck disable=SC1091
[ -f ".env" ] && source .env
set +a

if [ -z "${DATABASE_URL:-}" ]; then
  echo ""
  echo "[ERROR] DATABASE_URL belum diisi di file .env."
  echo "        Silakan isi terlebih dahulu, lalu jalankan skrip ini lagi."
  exit 1
fi

# 4. Install dependency
echo ""
echo "[INFO] Menginstall dependency (pnpm install)..."
pnpm install

echo ""
echo "=============================================="
echo "  Menjalankan Aplikasi"
echo "=============================================="

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
echo "Buka http://localhost:19024 di browser Anda."
echo "Tekan Ctrl+C untuk menghentikan semua layanan."

wait $API_PID $WEB_PID
