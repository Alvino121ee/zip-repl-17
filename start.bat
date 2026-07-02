@echo off
REM ============================================================================
REM Saham Radar - Skrip Menjalankan Aplikasi (Windows)
REM
REM Cukup double-click file ini. Skrip ini akan otomatis:
REM   1. Mengecek Node.js ^& pnpm terpasang
REM   2. Menginstall semua dependency yang dibutuhkan
REM   3. Membuat file .env jika belum ada (Anda tinggal isi DATABASE_URL, dll)
REM   4. Menjalankan API Server (port 8080) dan Web App (port 19024) sekaligus
REM
REM Setelah berjalan, buka http://localhost:19024 di browser.
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==============================================
echo   Saham Radar - Menyiapkan ^& Menjalankan App
echo ==============================================
echo.

REM 1. Cek Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js belum terpasang.
  echo         Silakan install Node.js versi 20+ dari https://nodejs.org
  echo         lalu jalankan file ini lagi.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js terdeteksi: %%v

REM 2. Cek / install pnpm
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [INFO] pnpm belum terpasang, menginstall pnpm...
  call npm install -g pnpm
)
for /f "delims=" %%v in ('pnpm -v') do echo [OK] pnpm terdeteksi: %%v

REM 3. Buat .env jika belum ada
if not exist ".env" (
  echo [INFO] File .env belum ada, membuat template .env...
  (
    echo # Isi konfigurasi berikut sesuai kebutuhan Anda.
    echo.
    echo # Wajib: koneksi database PostgreSQL
    echo DATABASE_URL=
    echo.
    echo # Opsional: DeepSeek API key untuk fitur AI ^(bisa juga diatur lewat halaman Pengaturan di website^)
    echo DEEPSEEK_API_KEY=
  ) > .env
  echo [PENTING] Silakan buka file .env dan isi DATABASE_URL sebelum menjalankan aplikasi.
)

REM 4. Baca DATABASE_URL dari .env untuk validasi
set "DATABASE_URL="
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="DATABASE_URL" set "DATABASE_URL=%%B"
)

if "%DATABASE_URL%"=="" (
  echo.
  echo [ERROR] DATABASE_URL belum diisi di file .env.
  echo         Silakan isi terlebih dahulu, lalu jalankan file ini lagi.
  pause
  exit /b 1
)

REM 5. Install dependency
echo.
echo [INFO] Menginstall dependency ^(pnpm install^)...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install gagal. Periksa pesan error di atas.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo   Menjalankan Aplikasi
echo ==============================================

REM 6. Jalankan API Server dan Web App di jendela terpisah
start "Saham Radar - API Server" cmd /k "set PORT=8080 && pnpm --filter @workspace/api-server run dev"
start "Saham Radar - Web App" cmd /k "set PORT=19024 && set BASE_PATH=/ && pnpm --filter @workspace/saham-radar run dev"

echo.
echo Semua layanan sedang dijalankan di jendela terpisah:
echo   - API Server        : http://localhost:8080
echo   - Saham Radar Web   : http://localhost:19024
echo.
echo Menunggu server siap, lalu membuka browser...
timeout /t 6 /nobreak >nul
start "" "http://localhost:19024"

echo.
echo Selesai. Tutup jendela ini kapan saja (server tetap berjalan di jendela masing-masing).
pause
