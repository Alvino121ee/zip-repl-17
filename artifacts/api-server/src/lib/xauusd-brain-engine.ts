/**
 * XAUUSD Autonomous Learning Brain Engine
 *
 * Runs a non-stop background learning loop:
 *  1. Fetch XAUUSD realtime data + calculate all indicators
 *  2. Save market snapshot to DB
 *  3. Detect spikes — record extra info when spike occurs
 *  4. Generate unique study questions based on market conditions
 *  5. Query DeepSeek for each question — never repeats same question
 *  6. Score answers and save good ones to "brain" (xauusd_brain table)
 *  7. Make a directional prediction for next period
 *  8. Verify previous predictions — self-critique when wrong
 *  9. Fetch & analyze latest XAUUSD news
 * 10. Log the full cycle to xauusd_learning_log
 */

import crypto from "crypto";
import { db } from "@workspace/db";
import { syncToFile, autoRestoreIfEmpty } from "./brain-sqlite-backup.js";
import {
  xauusdSnapshotsTable,
  xauusdBrainTable,
  xauusdQuestionsLogTable,
  xauusdPredictionsTable,
  xauusdNewsTable,
  xauusdLearningLogTable,
  xauusdMacroSnapshotsTable,
} from "@workspace/db/schema";
import { eq, and, lt, isNull, desc, sql, gte, or } from "drizzle-orm";
import {
  fetchXauusdIndicators,
  fetchXauusdNews,
  getMultiTimeframeAnalysis,
  summarizeTimeframeConfluence,
  getCorrelationAnalysis,
  type XauusdIndicators,
} from "./xauusd-data.js";
import { getDeepseekApiKey, getPredictionTimeframeMinutes } from "./xauusd-settings.js";
import { notifyNewPrediction } from "./xauusd-whatsapp.js";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const LEARN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — faster learning
const SPIKE_THRESHOLD = 0.003; // 0.3% price change = spike
const DEEPSEEK_TIMEOUT_MS = 120_000; // 120s timeout — deepseek-reasoner (R1) butuh waktu lebih lama

let learningTimer: ReturnType<typeof setInterval> | null = null;
// Shared global lock — prevents concurrent execution from both interval and /learn-now
let isLearning = false;
let lastCycleAt: Date | null = null;
let totalCycles = 0;
let totalInsights = 0;

// ─── Extreme Mode state ────────────────────────────────────────────────────────
const EXTREME_PAUSE_MIN_MS = 15_000;
const EXTREME_PAUSE_MAX_MS = 30_000;
const EXTREME_QUALITY_THRESHOLD = 0.65; // lebih ketat dari normal (0.6)
const EXTREME_QUESTIONS_PER_CYCLE = 10; // default per siklus
const EXTREME_CIRCUIT_BACKOFF_MS = 5 * 60_000; // 5 menit backoff sebelum retry
const EXTREME_CIRCUIT_MAX_RETRIES = 3; // maks retry setelah circuit breaker

let isExtremeRunning = false;
let extremeTarget = 0;
let extremeProgress = 0;        // total pertanyaan berhasil dijawab
let extremeInsightsTotal = 0;   // total insights disimpan ke brain
let extremeCycleCount = 0;      // siklus dalam sesi ini
let extremeStartedAt: Date | null = null;
let extremeAbort = false;
let extremeStopRequested = false;              // flag UI: user minta berhenti
let extremeHashCache: Set<string> | null = null; // dedup in-memory antar siklus
let extremeProgressHistory: Array<{ ts: number; count: number }> = []; // untuk hitung kecepatan
let extremeLastProgressAt: number | null = null; // timestamp progress terakhir (untuk deteksi stale)
let extremeDataMode: "live" | "historical" = "live"; // mode sumber data saat ini

// ─── DeepSeek query ────────────────────────────────────────────────────────────

async function queryDeepSeek(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 800
): Promise<string> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) {
    return "[AI tidak aktif — DeepSeek API key belum diset. Atur di halaman Pengaturan.]";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`DeepSeek HTTP ${res.status}: ${err}`);
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string } }>;
    };
    // R1 menyimpan jawaban final di content, proses berpikirnya di reasoning_content (diabaikan)
    return json.choices[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Question generator ────────────────────────────────────────────────────────

const QUESTION_TEMPLATES = [
  // ── RSI ──────────────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Dengan RSI XAUUSD saat ini di ${i.rsi14?.toFixed(1)} dan harga ${i.price}, apa probabilitas reversal dalam 4 jam ke depan dan bagaimana trader profesional biasanya merespons kondisi RSI ini?`,
  (i: XauusdIndicators) =>
    `RSI XAUUSD ${i.rsi14?.toFixed(1)} dengan EMA9 ${i.ema9} dan EMA21 ${i.ema21}. Apa sinyal trading yang paling valid dari kombinasi indikator ini? Kapan RSI divergen dari harga dan apa artinya?`,
  (i: XauusdIndicators) =>
    `RSI XAUUSD ${i.rsi14?.toFixed(1)} berada di zona ${i.rsiSignal}. Jelaskan perbedaan antara RSI overbought dalam trend naik kuat vs overbought saat reversal — bagaimana cara membedakannya dengan konfirmasi candlestick?`,
  (i: XauusdIndicators) =>
    `Saat RSI XAUUSD di ${i.rsi14?.toFixed(1)} dan Bollinger Band width ${i.bbWidth?.toFixed(2)}%, apakah ada potensi squeeze breakout? Jelaskan kapan RSI ekstrem + Bollinger squeeze menghasilkan setup terbaik di gold.`,

  // ── EMA / Trend ───────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `EMA9 XAUUSD (${i.ema9}) vs EMA21 (${i.ema21}) vs EMA50 (${i.ema50}) — alignment saat ini ${i.emaAlignment}. Jelaskan strategi "EMA fan" untuk gold dan kapan konfluens EMA paling reliable sebagai sinyal entry.`,
  (i: XauusdIndicators) =>
    `Harga XAUUSD ${i.price} berada ${i.price > (i.ema200 ?? 0) ? "di atas" : "di bawah"} EMA200 (${i.ema200}). Apa bias jangka panjang dari posisi ini? Kapan setup counter-trend trade aman dilakukan jika price jauh dari EMA200?`,
  (i: XauusdIndicators) =>
    `Dengan EMA alignment ${i.emaAlignment} di XAUUSD, apa teknik terbaik untuk entry pullback? Jelaskan 3 level pullback ideal (EMA9, EMA21, EMA50) untuk trade dengan trend yang ada.`,
  (i: XauusdIndicators) =>
    `EMA50 XAUUSD di ${i.ema50} dan EMA200 di ${i.ema200}. Harga ${i.price}. Seberapa jauh harga biasanya bisa jatuh ke EMA50 sebelum bounce saat uptrend? Berikan angka statistik historis jika memungkinkan.`,

  // ── MACD ─────────────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `MACD XAUUSD: line=${i.macdLine?.toFixed(3)}, signal=${i.macdSignal?.toFixed(3)}, histogram=${i.macdHistogram?.toFixed(3)} (${i.macdSignalType}). Bagaimana cara menggunakan MACD histogram untuk mengukur kekuatan momentum gold? Kapan MACD divergence lebih valid dari cross?`,
  (i: XauusdIndicators) =>
    `MACD XAUUSD signal type: ${i.macdSignalType}. Jelaskan perbedaan win rate MACD cross di trending market vs ranging market untuk XAUUSD. Bagaimana mengkonfirmasi dengan volume agar tidak terjebak false signal?`,

  // ── Bollinger Bands ───────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Bollinger Bands XAUUSD: upper=${i.bbUpper?.toFixed(2)}, middle=${i.bbMiddle?.toFixed(2)}, lower=${i.bbLower?.toFixed(2)}, width=${i.bbWidth?.toFixed(2)}%. Harga saat ini ${i.price}. Strategi apa yang paling optimal: mean reversion ke BB middle, atau breakout melewati BB upper/lower?`,
  (i: XauusdIndicators) =>
    `BB width XAUUSD ${i.bbWidth?.toFixed(2)}% menunjukkan ${(i.bbWidth ?? 0) < 2 ? "squeeze (volatilitas rendah)" : "volatilitas normal/tinggi"}. Sebutkan setup breakout terbaik pasca BB squeeze di gold, termasuk volume dan indikator konfirmasi yang dibutuhkan.`,

  // ── Support / Resistance ───────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `XAUUSD: support ${i.supportLevel?.toFixed(2)}, resistance ${i.resistanceLevel?.toFixed(2)}, harga ${i.price}, ATR ${i.atr14?.toFixed(2)}. Hitung risk:reward untuk trade buy dari support menuju resistance. Berapa SL dan TP idealnya berdasarkan ATR?`,
  (i: XauusdIndicators) =>
    `Jarak harga XAUUSD ${i.price} ke resistance ${i.resistanceLevel?.toFixed(2)} adalah ${((i.resistanceLevel ?? i.price) - i.price).toFixed(2)}. Berapa pips yang masih "layak" untuk entry buy, dan kapan setup ini harus dibatalkan karena terlalu dekat dengan resistance?`,
  (i: XauusdIndicators) =>
    `Level support ${i.supportLevel?.toFixed(2)} di XAUUSD. RSI saat ini ${i.rsi14?.toFixed(1)}. Bagaimana cara mengidentifikasi support yang kuat vs support yang lemah? Apa perbedaan antara "test support" dan "breakdown support" dari sisi price action?`,

  // ── ATR & Volatility ───────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `ATR14 XAUUSD ${i.atr14?.toFixed(2)} (${((i.atr14 ?? 0) / i.price * 100).toFixed(3)}% dari harga). Jelaskan secara detail metode ATR-based position sizing: cara menghitung lot size untuk account 10K USD dengan risiko max 2% per trade di harga gold saat ini.`,
  (i: XauusdIndicators) =>
    `Dengan ATR XAUUSD ${i.atr14?.toFixed(2)}, di mana stoploss dan takeprofit ideal untuk: (1) scalping 15-30 menit, (2) swing trading 4-8 jam, (3) positional trade 1-3 hari? Berikan multiplier ATR yang optimal untuk setiap gaya trading.`,

  // ── Multi-timeframe ────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Strategi multi-timeframe untuk XAUUSD: H1 RSI=${i.rsi14?.toFixed(1)}, trend=${i.trend}. Jelaskan metode "Top-Down Analysis" — bagaimana menggunakan Daily timeframe untuk bias, H4 untuk setup, H1 untuk entry, dan 15M untuk timing presisi.`,
  (i: XauusdIndicators) =>
    `Saat trend H1 XAUUSD adalah ${i.trend} dengan EMA alignment ${i.emaAlignment}, bagaimana jika Daily trend berlawanan? Jelaskan cara mengelola konflik timeframe dan kapan sinyal Daily lebih kuat dari H1 untuk gold.`,

  // ── Pola Teknikal ─────────────────────────────────────────────────────────────
  () =>
    `Sebutkan 5 pola candlestick paling reliabel untuk XAUUSD dengan win rate >65%. Untuk setiap pola: kondisi market ideal, volume konfirmasi yang dibutuhkan, dan target minimum yang realistis.`,
  () =>
    `Jelaskan pola "Smart Money Concepts" (SMC) di XAUUSD: apa itu Order Block, Fair Value Gap (FVG), dan Change of Character (ChoCH)? Bagaimana retail trader bisa menggunakannya untuk entry timing yang lebih presisi?`,
  (i: XauusdIndicators) =>
    `Harga XAUUSD saat ini ${i.price} dengan BB middle ${i.bbMiddle?.toFixed(2)}. Jelaskan 3 setup "mean reversion" terbaik di gold — kapan bounce dari EMA atau BB middle paling reliable dan faktor apa yang menentukan strength bounce-nya?`,

  // ── Makro & Fundamental ────────────────────────────────────────────────────────
  () =>
    `Jelaskan mekanisme transmisi kebijakan Fed pada harga gold: dari keputusan FOMC → DXY → real yield → XAUUSD. Berapa basis poin pergerakan rata-rata XAUUSD setelah hawkish vs dovish surprise dari Fed?`,
  () =>
    `Bagaimana DXY mempengaruhi XAUUSD dalam berbagai skenario: (1) DXY naik saat inflasi tinggi, (2) DXY naik karena safe haven flow, (3) DXY turun saat resesi? Apakah korelasi DXY-gold selalu negatif atau ada pengecualian?`,
  () =>
    `Jelaskan pengaruh US Treasury 10-year yield terhadap gold. Mengapa "real yield" (nominal yield - inflasi) lebih penting dari nominal yield? Di level real yield berapa gold biasanya paling bullish/bearish?`,
  () =>
    `NFP (Non-Farm Payroll), CPI, dan FOMC — urutkan 3 event ekonomi ini berdasarkan dampak rata-rata terhadap XAUUSD. Jelaskan strategi trading news: kapan masuk sebelum rilis, saat rilis, atau setelah spike awal reda?`,

  // ── Session & Timing ───────────────────────────────────────────────────────────
  () =>
    `Volatilitas XAUUSD per sesi: Asian (06:00-14:00 WIB), London (15:00-21:00 WIB), New York (20:30-03:00 WIB). Berikan range pip rata-rata per sesi dan strategi terbaik untuk setiap sesi. Sesi overlap London-NY kapan tepatnya?`,
  () =>
    `Bagaimana pola pergerakan XAUUSD pada hari Senin vs Jumat? Apakah ada "Monday effect" atau "Friday effect" yang terukur? Hari apa dalam seminggu yang paling baik untuk open posisi baru di gold?`,

  // ── Psikologi & Risk ──────────────────────────────────────────────────────────
  () =>
    `5 kesalahan terbesar retail trader di XAUUSD: FOMO entry, revenge trading, overleverage, tidak pakai SL, dan averaging loss. Untuk setiap kesalahan, berikan solusi konkret berbasis rule trading yang bisa langsung diterapkan.`,
  () =>
    `Jelaskan konsep "risiko ruin" di trading gold dengan leverage. Jika modal $10.000 dengan risiko 5% per trade, berapa probabilitas kehilangan 50% modal setelah 20 trade berturut-turut yang kalah? Mengapa 1-2% risiko per trade sangat krusial?`,
  (i: XauusdIndicators) =>
    `XAUUSD dengan ATR ${i.atr14?.toFixed(2)} — bagaimana trailing stop yang optimal untuk trade swing: apakah menggunakan ATR trailing, EMA trailing (${i.ema21?.toFixed(2)}), atau persentase tetap? Jelaskan pro dan kontra setiap metode.`,

  // ── Pattern Recognition & Entry ───────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Kondisi saat ini: harga ${i.price}, RSI ${i.rsi14?.toFixed(1)}, MACD hist ${i.macdHistogram?.toFixed(3)}, BB width ${i.bbWidth?.toFixed(2)}%. Berdasarkan kombinasi ini, pola market apa yang paling mungkin terjadi dalam 2-4 jam ke depan? Jelaskan skenario bullish, bearish, dan sideways beserta probabilitasnya.`,
  (i: XauusdIndicators) =>
    `Jelaskan strategi "breakout retest" di XAUUSD: setelah resistance ${i.resistanceLevel?.toFixed(2)} ditembus, kapan dan bagaimana cara entry saat retest? Berapa konfirmasi yang dibutuhkan dan di mana stop loss ditempatkan?`,

  // ── Manajemen Posisi ──────────────────────────────────────────────────────────
  () =>
    `Apa strategi terbaik untuk "scale in" dan "scale out" di XAUUSD? Jelaskan pendekatan pyramiding yang aman — kapan menambah posisi yang profit, berapa ukuran lot tambahan, dan bagaimana mengelola SL keseluruhan?`,
  () =>
    `Dalam kondisi uncertainty tinggi di gold market (misal sebelum FOMC), apakah lebih baik: tutup semua posisi, kurangi ukuran lot 50%, atau pasang hedging? Jelaskan pro-kontra setiap pendekatan dan bagaimana memilihnya.`,

  // ── Korelasi Aset ──────────────────────────────────────────────────────────────
  () =>
    `Jelaskan korelasi antara XAUUSD dengan: (1) XAGUSD (silver), (2) oil (WTI), (3) S&P500, (4) Bitcoin. Kapan korelasi ini breakdown dan mengapa? Bagaimana trader gold menggunakan korelasi ini untuk konfirmasi bias?`,
  () =>
    `Bagaimana cara membaca COT (Commitment of Traders) report untuk gold futures? Apa posisi yang diperhatikan (non-commercial/speculative)? Di level positioning ekstrem berapa biasanya gold reversal terjadi?`,

  // ── Fibonacci ─────────────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Harga XAUUSD ${i.price} antara support ${i.supportLevel?.toFixed(2)} dan resistance ${i.resistanceLevel?.toFixed(2)}. Hitung level Fibonacci retracement (23.6%, 38.2%, 50%, 61.8%, 78.6%) dari swing ini. Level mana yang paling sering jadi magnet harga di gold?`,
  (i: XauusdIndicators) =>
    `Jelaskan konsep Fibonacci Extension untuk target profit di XAUUSD. Jika harga dari ${i.supportLevel?.toFixed(2)} menuju ${i.resistanceLevel?.toFixed(2)}, di mana level 127.2%, 161.8%, dan 261.8% extension berada? Kapan extension 161.8% lebih reliable dari target resistance biasa?`,
  (i: XauusdIndicators) =>
    `ATR XAUUSD ${i.atr14?.toFixed(2)} dan harga ${i.price}. Bagaimana cara menggabungkan Fibonacci retracement dengan zona ATR untuk menemukan entry yang presisi? Jelaskan "Fibonacci ATR combo setup" dengan contoh konkret entry, SL, dan TP.`,

  // ── Pola Candlestick Spesifik ─────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Di harga XAUUSD ${i.price} dengan RSI ${i.rsi14?.toFixed(1)}: jelaskan cara mengidentifikasi dan trading pola Hammer vs Hanging Man di gold. Perbedaan psikologi market di balik kedua pola ini dan di mana menempatkan SL untuk setiap pola.`,
  (i: XauusdIndicators) =>
    `Pola Doji di XAUUSD: ada Dragonfly Doji, Gravestone Doji, dan Long-Legged Doji. Jelaskan kondisi market mana yang membuat setiap Doji lebih valid, terutama saat RSI ${i.rsi14?.toFixed(1)} dan BB width ${i.bbWidth?.toFixed(2)}%. Volume konfirmasi apa yang diperlukan?`,
  () =>
    `Pola Three White Soldiers dan Three Black Crows di gold — kapan valid sebagai sinyal continuation dan kapan menjadi "bull trap" atau "bear trap"? Sebutkan kondisi volume, RSI, dan BB yang membuat pola ini high-probability vs low-probability.`,
  () =>
    `Engulfing pattern (Bullish Engulfing & Bearish Engulfing) di XAUUSD: jelaskan perbedaan "real engulfing" vs false signal. Di mana level paling kuat untuk pola ini — di support/resistance, Fibonacci, atau pivot point? Win rate rata-rata pola ini di gold H1 dan H4?`,
  (i: XauusdIndicators) =>
    `Dengan harga XAUUSD ${i.price} dan BB (upper=${i.bbUpper?.toFixed(2)}, lower=${i.bbLower?.toFixed(2)}): jelaskan pola "Pinbar" atau "Rejection Candle" di batas BB. Kapan pinbar di BB upper/lower menjadi sinyal reversal terpercaya di gold, dan kapan harus diabaikan?`,

  // ── Volume & Order Flow ───────────────────────────────────────────────────────
  () =>
    `Bagaimana cara membaca volume dalam trading XAUUSD? Jelaskan perbedaan "volume climax" (capitulation), "volume dry-up" (no interest), dan "volume expansion" (breakout valid). Di platform apa trader retail bisa melihat volume gold yang paling akurat?`,
  () =>
    `Konsep "Smart Money" vs "Dumb Money" di gold market: bagaimana institusi (central bank, hedge fund) menempatkan posisi berbeda dari retail trader? Apa tanda-tanda institutional accumulation/distribution yang bisa terlihat di chart H4 dan Daily XAUUSD?`,
  (i: XauusdIndicators) =>
    `Jelaskan "liquidity grab" atau "stop hunt" di XAUUSD. Dengan harga ${i.price} dan resistance di ${i.resistanceLevel?.toFixed(2)}: bagaimana mengenali ketika harga "spike" melewati resistance sebentar lalu kembali turun? Bagaimana trader menggunakan ini sebagai entry opportunity?`,
  () =>
    `Apa itu "imbalance zone" atau "Fair Value Gap" (FVG) di XAUUSD dan mengapa harga sering kembali mengisinya? Bagaimana cara mengidentifikasi FVG di chart, dan berapa % kemungkinan harga kembali ke zona ini sebelum melanjutkan trend?`,

  // ── Market Microstructure ─────────────────────────────────────────────────────
  () =>
    `Jelaskan struktur market XAUUSD: siapa yang menjadi market maker di spot gold? Apa itu "bid-ask spread" di gold dan bagaimana spread berubah saat New York open, London open, dan saat data ekonomi penting dirilis? Bagaimana trader retail meminimalkan dampak spread?`,
  (i: XauusdIndicators) =>
    `Dengan ATR XAUUSD ${i.atr14?.toFixed(2)}, jelaskan fenomena "mean reversion" vs "momentum continuation" di gold. Pada kondisi apa (RSI, EMA, trend) mean reversion lebih dominan? Berikan aturan konkret untuk memilih antara dua strategi ini.`,
  () =>
    `Apa itu "pivot point" (PP, R1, R2, S1, S2) di XAUUSD dan bagaimana cara menghitungnya? Seberapa reliable pivot point harian vs mingguan vs bulanan di gold? Strategi trading apa yang paling efektif menggunakan pivot point di XAUUSD?`,

  // ── Pola Grafik Klasik ────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Harga XAUUSD ${i.price}. Jelaskan cara mengidentifikasi dan trading pola Head and Shoulders di gold. Bagaimana mengukur target dari pola ini menggunakan "neckline measurement"? Tingkat keberhasilan pola ini di XAUUSD H4 dan Daily berdasarkan data historis?`,
  () =>
    `Double Top dan Double Bottom di XAUUSD: jelaskan perbedaan "confirmed double top" vs "fake out double top". Faktor apa (volume, RSI divergence, time between tops) yang meningkatkan akurasi setup ini di gold? Di timeframe mana pola ini paling reliable?`,
  () =>
    `Pola "Ascending Triangle", "Descending Triangle", dan "Symmetrical Triangle" di XAUUSD. Jelaskan statistik breakout direction untuk setiap jenis, cara mengukur target harga, dan bagaimana volume mengkonfirmasi breakout yang valid vs false breakout di gold.`,
  (i: XauusdIndicators) =>
    `"Flag" dan "Pennant" adalah pola continuation di XAUUSD. Dengan trend saat ini ${i.trend} dan EMA alignment ${i.emaAlignment}: jelaskan cara mengidentifikasi flag bullish/bearish, cara entry, target (measured move), dan SL yang tepat. Berapa durasi ideal konsolidasi sebelum breakout?`,
  () =>
    `Jelaskan pola "Rising Wedge" dan "Falling Wedge" di XAUUSD — keduanya sering menipu trader. Rising Wedge adalah bearish meskipun harga naik: mengapa? Bagaimana volume dan RSI membantu mengkonfirmasi breakout dari wedge? Berikan contoh setup konkret.`,

  // ── Analisis Makro Lanjutan ───────────────────────────────────────────────────
  () =>
    `Bagaimana quantitative easing (QE) dan quantitative tightening (QT) oleh The Fed mempengaruhi harga gold? Jelaskan mekanisme transmisinya: dari neraca Fed → M2 money supply → DXY → XAUUSD. Di fase QT seperti sekarang, apa bias jangka menengah untuk gold?`,
  () =>
    `Jelaskan "Gold Standard" dan mengapa abandonment-nya (1971, Nixon Shock) masih relevan untuk memahami gold sebagai "monetary metal". Bagaimana de-dollarization trend (China, Russia beli gold) mempengaruhi fundamental permintaan gold jangka panjang?`,
  () =>
    `Central bank gold reserves: negara mana yang paling agresif membeli gold dalam 3 tahun terakhir dan mengapa? Bagaimana data World Gold Council tentang central bank demand mempengaruhi harga gold? Kapan berita pembelian central bank berdampak maksimal pada XAUUSD?`,
  () =>
    `Jelaskan hubungan antara gold dan inflasi: apakah gold selalu "inflation hedge"? Ada periode di mana gold underperform meski inflasi tinggi (1980-2000). Apa yang menentukan kapan gold efektif sebagai hedging inflasi dan kapan tidak?`,
  () =>
    `Dampak geopolitical risk terhadap XAUUSD: jelaskan "geopolitical premium" di harga gold. Bagaimana cara mengukur berapa besar premium ini? Kapan geopolitical event menghasilkan "buy the rumor sell the news" vs dampak sustainedflight to safety di gold?`,

  // ── Timing & Seasonality ──────────────────────────────────────────────────────
  () =>
    `Pola seasonality XAUUSD: bulan apa gold biasanya paling bullish dan paling bearish secara historis? Jelaskan "Indian wedding season", "Chinese New Year demand", dan "harvest season" — bagaimana demand fisik dari Asia mempengaruhi harga spot gold?`,
  () =>
    `"End of quarter" dan "end of year" (window dressing) — bagaimana institutional rebalancing mempengaruhi XAUUSD? Jelaskan mengapa gold sering volatile di akhir Q4 (November-Desember) dan awal Q1 (Januari-Februari). Apakah ada trading edge dari seasonality ini?`,
  (i: XauusdIndicators) =>
    `Jam berapa (UTC) XAUUSD biasanya paling volatile di setiap sesi? Dengan harga saat ini ${i.price} dan ATR ${i.atr14?.toFixed(2)}: berikan panduan jam-jam kritis yang harus diperhatikan trader Indonesia (WIB), termasuk waktu rilis data NFP, CPI, dan FOMC.`,

  // ── Manajemen Risiko Lanjutan ─────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Portfolio allocation untuk gold: berapa % idealnya porsi XAUUSD dalam portfolio trading vs portfolio investasi? Dengan harga gold ${i.price}, bandingkan strategi: (1) buy physical gold, (2) trading spot XAUUSD dengan leverage, (3) gold ETF, (4) gold mining stocks. Pro-kontra setiap approach.`,
  () =>
    `Jelaskan konsep "Kelly Criterion" untuk position sizing di trading gold. Bagaimana cara menghitung optimal bet size berdasarkan win rate dan risk:reward? Mengapa "full Kelly" berbahaya dan "half Kelly" atau "quarter Kelly" lebih aman untuk trader retail?`,
  (i: XauusdIndicators) =>
    `Dengan ATR XAUUSD ${i.atr14?.toFixed(2)}: jelaskan perbedaan antara "fixed stop loss" vs "dynamic stop loss" (ATR-based vs structure-based). Kapan fixed SL lebih baik dan kapan dynamic SL lebih efektif? Berikan rule konkret untuk memilih antara keduanya.`,
  () =>
    `"Drawdown management" di trading gold: berapa maximum drawdown yang masih acceptable? Jelaskan aturan "circuit breaker" — kapan trader harus berhenti trading setelah serangkaian loss? Bagaimana cara "recovery plan" yang sistematis setelah drawdown besar?`,
  () =>
    `Strategi "hedging" di XAUUSD: kapan hedge diperlukan? Jelaskan tiga cara hedging: (1) buka posisi berlawanan di XAUUSD, (2) trading XAGUSD (silver) sebagai correlated hedge, (3) menggunakan opsi gold futures. Kapan hedging cost-effective vs tidak efisien?`,

  // ── Psikologi Trading Lanjutan ────────────────────────────────────────────────
  () =>
    `"Trading journal" untuk XAUUSD: apa saja yang HARUS dicatat setelah setiap trade? Jelaskan format ideal trading journal, cara melakukan "review mingguan", dan bagaimana mengidentifikasi pattern kekalahan dari data journal. Berikan template konkret yang bisa langsung digunakan.`,
  () =>
    `Bagaimana mengatasi "analysis paralysis" di trading gold? Trader sering melihat terlalu banyak indikator dan sinyal bertentangan. Jelaskan metode "simple system" — berapa maksimal indikator yang diperlukan, dan bagaimana membuat keputusan yang decisive dengan informasi terbatas.`,
  () =>
    `"Revenge trading" setelah loss besar di XAUUSD — bagaimana cara mengenalinya dalam diri sendiri dan cara menghentikannya? Jelaskan teknik psikologis konkret: "mandatory cooling off period", "position size reduction rule", dan cara membangun kembali kepercayaan diri setelah losing streak.`,
  () =>
    `Perbedaan mindset "trader" vs "investor" di gold: bagaimana cara seorang intraday scalper vs swing trader vs long-term investor di gold mengelola emosi, ekspektasi, dan evaluasi kinerja secara berbeda? Mindset mana yang paling cocok untuk retail trader Indonesia?`,

  // ── Entry & Exit Tactics ──────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `"Limit order" vs "market order" vs "stop order" di XAUUSD. Dengan spread gold yang bisa 30-50 sen, kapan penggunaan limit order memberikan edge nyata vs risiko miss entry? Jelaskan strategi "order stacking" di zona support ${i.supportLevel?.toFixed(2)} dengan multiple limit orders.`,
  (i: XauusdIndicators) =>
    `Teknik "partial close" atau "scale out" di XAUUSD: jika entry di ${i.price} dengan target ${i.resistanceLevel?.toFixed(2)}, kapan dan berapa persen posisi yang di-close di setiap level? Jelaskan pro-kontra 3 approach: (1) full close di target, (2) 50% close di 50% target, (3) trailing stop ke seluruh posisi.`,
  (i: XauusdIndicators) =>
    `"Break-even" stop loss — kapan dan bagaimana cara memindahkan SL ke break-even di trade XAUUSD? Jika entry di ${i.price}, berapa pip profit yang harus dicapai sebelum memindahkan SL ke entry? Apa risiko "noise shake-out" jika SL dipindahkan terlalu cepat di gold?`,
  () =>
    `Jelaskan perbedaan "discretionary trading" vs "systematic/algorithmic trading" di gold. Apa keunggulan dan kelemahan trader manusia vs trading bot di XAUUSD? Bagaimana retail trader bisa mendapat keunggulan di pasar yang semakin didominasi HFT dan algoritma?`,

  // ── Elliott Wave & Advanced TA ────────────────────────────────────────────────
  () =>
    `Dasar-dasar Elliott Wave Theory untuk XAUUSD: jelaskan struktur 5-wave impulse dan 3-wave corrective. Di gold market, apakah Elliott Wave lebih reliable di timeframe Daily-Weekly atau H1-H4? Berikan contoh bagaimana mengidentifikasi awal Wave 3 (gelombang terkuat) di gold.`,
  () =>
    `"Harmonic patterns" di XAUUSD: Gartley, Butterfly, Bat, dan Crab. Jelaskan cara mengidentifikasi dan mengukur pola Gartley di gold, termasuk rasio Fibonacci yang digunakan. Tingkat keberhasilan harmonic patterns di gold vs forex pairs — mana lebih reliable dan mengapa?`,
  (i: XauusdIndicators) =>
    `"Wyckoff Method" di XAUUSD: jelaskan fase Accumulation, Markup, Distribution, dan Markdown. Dengan BB width ${i.bbWidth?.toFixed(2)}% dan RSI ${i.rsi14?.toFixed(1)}: apakah kondisi saat ini mencerminkan salah satu fase Wyckoff? Bagaimana cara mengidentifikasi "Composite Man" di gold market?`,
  () =>
    `"Market Profile" dan "Volume Profile" di XAUUSD: apa itu POC (Point of Control), Value Area High, dan Value Area Low? Bagaimana cara menggunakan Volume Profile untuk menemukan level-level kunci di gold yang tidak terlihat dari analisis candlestick biasa?`,

  // ── Strategi Khusus ───────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Strategi "range trading" di XAUUSD saat BB width ${i.bbWidth?.toFixed(2)}% sangat rendah: bagaimana cara menentukan range boundary, entry di tepi range, exit di tengah, dan SL di luar range? Kapan range strategy harus dihentikan karena breakout impending?`,
  (i: XauusdIndicators) =>
    `"News scalping" di XAUUSD: strategi entry dalam 1-3 detik setelah rilis data NFP atau CPI. Dengan ATR ${i.atr14?.toFixed(2)} yang berarti range harian ±${i.atr14?.toFixed(0)}, berapa target scalp realistis di event berita? Apa risiko "slippage" dan "spread widening" saat news?`,
  () =>
    `Strategi "carry trade" dan "flight to safety" di gold. Jelaskan kapan gold naik karena "risk-off" (flight to safety) vs naik karena "dollar weakness". Apakah kedua skenario ini memberikan momentum yang berbeda? Bagaimana trader memposisikan diri untuk setiap skenario?`,
  (i: XauusdIndicators) =>
    `Strategi "gap trading" di XAUUSD — gap sering terjadi di open pasar Senin setelah weekend. Dengan ATR ${i.atr14?.toFixed(2)}, berapa gap size yang significant? Apakah gold memiliki tendensi "fill the gap"? Kapan gap menjadi "continuation signal" vs "reversal signal"?`,
  () =>
    `"Correlation trading" XAUUSD-USDJPY: keduanya sering bergerak berlawanan (negatif correlation). Bagaimana trader menggunakan divergence XAUUSD vs USDJPY sebagai sinyal trading gold? Jelaskan strategi konkret dan kapan correlation ini breakdown (misalnya saat risk-off extreme).`,

  // ── Indikator Tambahan ────────────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Stochastic Oscillator di XAUUSD — perbedaan Stochastic vs RSI ${i.rsi14?.toFixed(1)} saat ini. Kapan Stochastic lebih akurat dari RSI di gold? Jelaskan penggunaan "Stochastic divergence" dan bagaimana menggabungkannya dengan level ${i.supportLevel?.toFixed(2)}-${i.resistanceLevel?.toFixed(2)} untuk konfirmasi trade.`,
  (i: XauusdIndicators) =>
    `CCI (Commodity Channel Index) di XAUUSD — indikator yang dirancang khusus untuk commodity seperti gold. Dengan harga ${i.price} dan trend ${i.trend}: bagaimana CCI mengidentifikasi overbought/oversold yang berbeda dari RSI? Kapan CCI memberikan sinyal lebih awal dari MACD atau RSI?`,
  () =>
    `Ichimoku Cloud di XAUUSD: jelaskan Tenkan-sen, Kijun-sen, Senkou Span A/B, dan Chikou Span. Apakah Ichimoku efektif di gold yang bergerak 24 jam? Bagaimana cara menyesuaikan parameter Ichimoku (dari 9-26-52 standar Jepang) untuk pasar gold yang lebih volatil?`,
  (i: XauusdIndicators) =>
    `Parabolic SAR di XAUUSD sebagai trailing stop tool — dengan ATR ${i.atr14?.toFixed(2)} dan trend ${i.trend}: berapa setting AF (Acceleration Factor) yang optimal untuk gold? Kapan Parabolic SAR terlalu "sensitif" (whipsaw banyak) dan kapan terlalu "lambat" untuk gold?`,
  () =>
    `Divergence analysis di XAUUSD: jelaskan perbedaan "regular divergence" (reversal signal) vs "hidden divergence" (continuation signal). Indikator mana yang terbaik untuk divergence di gold — RSI, MACD, atau Stochastic? Berikan 3 contoh konkret setup divergence di XAUUSD.`,

  // ── Gold Mining & ETF ─────────────────────────────────────────────────────────
  () =>
    `Hubungan antara GDX (gold mining ETF) dan XAUUSD spot price. Kapan gold miners "outperform" spot gold (leverage effect) dan kapan "underperform" (company-specific risk)? Bagaimana trader spot XAUUSD menggunakan GDX sebagai leading indicator untuk memprediksikan pergerakan gold?`,
  () =>
    `GLD dan IAU (gold ETF) — bagaimana flow masuk/keluar ETF ini mempengaruhi harga spot XAUUSD? Jelaskan mekanisme "creation/redemption" unit ETF dan mengapa institutional outflow dari GLD bisa menjadi early warning signal untuk penurunan gold.`,

  // ── Risk:Reward & Statistics ──────────────────────────────────────────────────
  (i: XauusdIndicators) =>
    `Berikan analisis statistik trading XAUUSD: jika trader menggunakan risk:reward minimum 1:2 dan win rate 45%, apakah ini profitable jangka panjang? Hitung expected value per trade. Dengan ATR ${i.atr14?.toFixed(2)}, berapa pip SL dan TP untuk mendapat R:R 1:2 yang realistis di gold?`,
  (i: XauusdIndicators) =>
    `"Expectancy" formula dalam trading gold: E = (WinRate × AvgWin) - (LossRate × AvgLoss). Jika average win = ${((i.atr14 ?? 20) * 1.5).toFixed(0)} pip dan average loss = ${i.atr14?.toFixed(0)} pip di XAUUSD, berapa win rate minimum yang diperlukan untuk break-even? Bagaimana cara meningkatkan expectancy secara sistematis?`,
  () =>
    `"Monte Carlo simulation" untuk trading gold: jelaskan cara menggunakannya untuk mengestimasi worst-case drawdown dari sistem trading. Jika win rate 55% dan R:R 1:1.5 di XAUUSD, berapa probabilitas drawdown >20%, >30%, >50% dalam 100 trade ke depan? Apa implikasinya untuk position sizing?`,
] as const;

function generateQuestionHash(question: string): string {
  return crypto.createHash("sha256").update(question.trim().toLowerCase()).digest("hex");
}

/**
 * Pilih pertanyaan berdasarkan kondisi pasar saat ini (market-aware).
 * - RSI ekstrem  → prioritaskan pertanyaan RSI & reversal
 * - Spike        → prioritaskan pertanyaan ATR, volatilitas, & support/resistance
 * - Trend kuat   → prioritaskan pertanyaan EMA & multi-timeframe
 * - MACD signal  → prioritaskan pertanyaan MACD
 * - Bollinger squeeze → prioritaskan pertanyaan BB
 * - Sisanya: pertanyaan makro, psikologi, pola — tetap masuk tapi bobotnya lebih rendah
 */
function getMarketAwareQuestions(
  indicators: XauusdIndicators,
  count: number,
  spikeDetected = false
): Array<{ question: string; hash: string }> {
  // Kelompokkan template berdasarkan topik (indeks ke QUESTION_TEMPLATES)
  const groups = {
    rsi:            [0, 1, 2, 3],
    ema:            [4, 5, 6, 7],
    macd:           [8, 9],
    bb:             [10, 11],
    sr:             [12, 13, 14],
    atr:            [15, 16],
    mtf:            [17, 18],
    pattern:        [19, 20, 21],
    macro:          [22, 23, 24, 25],
    session:        [26, 27],
    psychology:     [28, 29, 30],
    entry:          [31, 32],
    management:     [33, 34],
    correlation:    [35, 36],
  };

  // Hitung bobot berdasarkan kondisi pasar aktif
  const weights: Record<string, number> = {
    rsi:         1,
    ema:         1,
    macd:        1,
    bb:          1,
    sr:          1,
    atr:         1,
    mtf:         1,
    pattern:     1,
    macro:       1,
    session:     1,
    psychology:  1,
    entry:       1,
    management:  1,
    correlation: 1,
  };

  // Helper: ambil nilai terbesar agar bobot tidak saling menimpa saat ada multi-signal
  const boost = (key: string, val: number) => {
    weights[key] = Math.max(weights[key] ?? 1, val);
  };

  // RSI ekstrem → pertanyaan RSI & reversal lebih relevan
  if (indicators.rsiSignal === "overbought" || indicators.rsiSignal === "oversold") {
    boost("rsi", 4); boost("entry", 3); boost("sr", 2);
  }

  // Spike terdeteksi → volatilitas & ATR paling kritis
  if (spikeDetected) {
    boost("atr", 5); boost("sr", 4); boost("bb", 3); boost("psychology", 3);
  }

  // Trend kuat → EMA & multi-timeframe lebih relevan
  if (indicators.emaAlignment === "bullish_stack" || indicators.emaAlignment === "bearish_stack") {
    boost("ema", 4); boost("mtf", 3); boost("entry", 2);
  }

  // MACD sinyal aktif → pertanyaan MACD lebih relevan
  if (indicators.macdSignalType !== "neutral") {
    boost("macd", 4); boost("pattern", 2);
  }

  // BB squeeze → BB question paling relevan
  if ((indicators.bbWidth ?? 99) < 2) {
    boost("bb", 5); boost("atr", 2);
  }

  // Buat pool berbobot: setiap indeks template dimasukkan sebanyak bobotnya
  const pool: number[] = [];
  for (const [group, indices] of Object.entries(groups)) {
    const w = weights[group] ?? 1;
    for (let r = 0; r < w; r++) {
      for (const idx of indices) {
        if (idx < QUESTION_TEMPLATES.length) pool.push(idx);
      }
    }
  }

  // Shuffle pool, ambil unik (tidak duplikat indeks), slice sesuai count
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const seen = new Set<number>();
  const selected: number[] = [];
  for (const idx of shuffled) {
    if (!seen.has(idx)) {
      seen.add(idx);
      selected.push(idx);
      if (selected.length >= count) break;
    }
  }

  return selected.map((idx) => {
    const question = QUESTION_TEMPLATES[idx](indicators);
    return { question, hash: generateQuestionHash(question) };
  });
}

/** Alias untuk backward-compat — pakai versi market-aware */
function getRandomQuestions(
  indicators: XauusdIndicators,
  count: number,
  spikeDetected = false
): Array<{ question: string; hash: string }> {
  return getMarketAwareQuestions(indicators, count, spikeDetected);
}

async function filterNewQuestions(
  candidates: Array<{ question: string; hash: string }>
): Promise<Array<{ question: string; hash: string }>> {
  // Hanya blokir pertanyaan yang ditanya dalam 7 hari terakhir.
  // Pertanyaan lebih lama dari 7 hari boleh ditanya lagi — kondisi pasar
  // sudah cukup berubah sehingga jawaban baru akan berbeda/lebih relevan.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  const recentRows = await db
    .select({ hash: xauusdQuestionsLogTable.questionHash })
    .from(xauusdQuestionsLogTable)
    .where(
      sql`${xauusdQuestionsLogTable.askedAt} >= ${sevenDaysAgo.toISOString()}`
    );
  const recentSet = new Set(recentRows.map((r: { hash: string }) => r.hash));
  return candidates.filter((c) => !recentSet.has(c.hash));
}

// ─── Answer quality scorer ─────────────────────────────────────────────────────

/**
 * Perbaikan #1: scoreAnswer berbasis kualitas — menilai struktur, penalaran
 * kondisional, dan spesifisitas angka; bukan sekadar panjang teks.
 */
function scoreAnswer(question: string, answer: string): number {
  if (!answer || answer.length < 100) return 0;

  let score = 0.5;
  const lc = answer.toLowerCase();

  // ── Panjang (bonus modest, bukan poin utama) ───────────────────────────────
  if (answer.length > 400) score += 0.05;
  if (answer.length > 800) score += 0.05;

  // ── Struktur: poin bernomor / bullet → jawaban terorganisir ───────────────
  const bulletLines = (answer.match(/^\s*[\d\-\*•]/gm) ?? []).length;
  if (bulletLines >= 3) score += 0.08;
  if (bulletLines >= 6) score += 0.04;

  // ── Penalaran kondisional — "jika…maka", skenario if-then ─────────────────
  const conditionals = (lc.match(/\b(jika|apabila|ketika|bila|saat)\b/g) ?? []).length;
  if (conditionals >= 2) score += 0.08;
  if (conditionals >= 4) score += 0.04;

  // ── Angka actionable spesifik (harga, %, pips, ATR, level) ───────────────
  const specificNumbers = answer.match(/\d+\.?\d*\s*(%|pips?|atr|\$)/gi) ?? [];
  score += Math.min(0.10, specificNumbers.length * 0.025);
  const allNumbers = answer.match(/\d+\.?\d*/g) ?? [];
  if (allNumbers.length >= 5) score += 0.04;

  // ── Terminologi teknikal relevan XAUUSD ───────────────────────────────────
  const technicalTerms = [
    "rsi", "ema", "macd", "support", "resistance", "entry", "exit",
    "stop loss", "take profit", "risk", "ratio", "win rate", "setup",
    "breakout", "breakdown", "divergence", "momentum", "trend",
    "session", "volatility", "atr", "bollinger", "fib", "retracement",
    "dxy", "yield", "confluence", "timeframe",
  ];
  const matched = technicalTerms.filter((t) => lc.includes(t)).length;
  score += Math.min(0.12, matched * 0.015);

  // ── Penalti: jawaban samar / tidak menjawab ────────────────────────────────
  const vague = [
    "itu tergantung", "sangat bervariasi", "tidak bisa dipastikan",
    "sulit dikatakan", "tidak ada jawaban pasti",
  ];
  if (vague.some((v) => lc.includes(v))) score -= 0.12;

  // Penalti: terlalu banyak pertanyaan retoris (AI balik bertanya)
  const questionMarks = (answer.match(/\?/g) ?? []).length;
  if (questionMarks > 3) score -= 0.06;

  return Math.min(1, Math.max(0, score));
}

// ─── Brain updater ─────────────────────────────────────────────────────────────

function extractBrainCategory(
  question: string
): "trading_rule" | "pattern" | "insight" | "lesson" | "news_impact" {
  const lc = question.toLowerCase();
  if (lc.includes("news") || lc.includes("nfp") || lc.includes("fed") || lc.includes("makro"))
    return "news_impact";
  if (lc.includes("pola") || lc.includes("pattern") || lc.includes("breakout"))
    return "pattern";
  if (lc.includes("strategi") || lc.includes("entry") || lc.includes("exit") || lc.includes("stop"))
    return "trading_rule";
  if (lc.includes("psikologi") || lc.includes("kesalahan") || lc.includes("manajemen"))
    return "lesson";
  return "insight";
}

function extractTitle(question: string, answer: string): string {
  // First sentence of answer, or first 80 chars of question
  const firstSentence = answer.split(/[.!?\n]/)[0];
  if (firstSentence && firstSentence.length > 20 && firstSentence.length < 120) {
    return firstSentence.trim();
  }
  return question.slice(0, 80).trim() + (question.length > 80 ? "..." : "");
}

function extractMarketTags(indicators: XauusdIndicators): string {
  const tags: string[] = [];
  if (indicators.rsiSignal === "overbought") tags.push("rsi_overbought");
  if (indicators.rsiSignal === "oversold") tags.push("rsi_oversold");
  if (indicators.emaAlignment === "bullish_stack") tags.push("ema_bullish");
  if (indicators.emaAlignment === "bearish_stack") tags.push("ema_bearish");
  if (indicators.macdSignalType !== "neutral") tags.push(`macd_${indicators.macdSignalType}`);
  tags.push(`trend_${indicators.trend}`);
  return tags.join(",");
}

// ─── Rule-based prediction fallback (ATR + support/resistance based) ──────────
// Used when the AI call is unavailable or returns unparseable output, so the
// entry range / stop loss are always derived from real technical analysis
// rather than being invented arbitrarily.

interface RuleBasedPrediction {
  direction: "up" | "down" | "sideways";
  targetPrice: number; // TP1 — target terdekat (S/R pertama)
  tp2: number;         // TP2 — target lanjutan jika momentum sehat
  tp3: number;         // TP3 — target jauh jika trend kuat + volume mendukung
  entryLow: number;
  entryHigh: number;
  stopLoss: number;    // titik invalidasi thesis (swing low/high struktural)
  confidence: number;
  reasoning: string;
}

function computeRuleBasedPrediction(indicators: XauusdIndicators): RuleBasedPrediction {
  const price = indicators.price;
  const atr = indicators.atr14 ?? price * 0.003; // fallback ~0.3% if ATR unavailable

  let direction: "up" | "down" | "sideways" = "sideways";
  let score = 0;
  if (indicators.emaAlignment === "bullish_stack") score += 2;
  else if (indicators.emaAlignment === "bearish_stack") score -= 2;
  if (indicators.rsiSignal === "oversold") score += 1;
  else if (indicators.rsiSignal === "overbought") score -= 1;
  if (indicators.macdSignalType === "bullish_cross") score += 1;
  else if (indicators.macdSignalType === "bearish_cross") score -= 1;
  if (indicators.macdHistogram != null) {
    if (indicators.macdHistogram > 0) score += 0.5;
    else if (indicators.macdHistogram < 0) score -= 0.5;
  }
  if (score >= 1.5) direction = "up";
  else if (score <= -1.5) direction = "down";

  const confidence = Math.min(0.85, 0.45 + Math.abs(score) * 0.12);

  // Entry zone = a small pullback band around current price (0.15–0.4 ATR),
  // anchored toward support (for longs) or resistance (for shorts).
  const pullback = atr * 0.3;
  let entryLow: number;
  let entryHigh: number;
  let stopLoss: number;
  let targetPrice: number;

  const support = indicators.supportLevel ?? price - atr * 2;
  const resistance = indicators.resistanceLevel ?? price + atr * 2;

  // ── SL: di titik struktural invalidasi thesis, bukan angka ATR acak ──────────
  // Long  → SL di bawah support (swing low) — jika kena, thesis long sudah salah
  // Short → SL di atas resistance (swing high) — jika kena, thesis short sudah salah
  // Fallback ke 1.5×ATR hanya jika level S/R tidak tersedia

  // ── TP: multi-level berdasarkan area S/R yang secara teknis wajar jadi reaksi
  // TP1 = target terdekat (S/R pertama)          — konservatif, selalu ada exit
  // TP2 = target lanjutan jika momentum sehat    — S/R berikutnya atau +1.5×ATR dari TP1
  // TP3 = target jauh jika trend kuat + volume   — ekstensi TP1 + 3.5×ATR

  let tp2: number;
  let tp3: number;

  if (direction === "up") {
    entryLow  = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback * 0.3).toFixed(2));
    // SL: jika support tersedia DAN di bawah harga (valid struktural), letakkan di bawahnya; fallback ATR
    const slCandidate = indicators.supportLevel != null
      ? parseFloat((indicators.supportLevel - atr * 0.1).toFixed(2))
      : null;
    stopLoss = (slCandidate != null && slCandidate < price)
      ? slCandidate
      : parseFloat((price - atr * 1.5).toFixed(2));
    // TP1: resistance terdekat di ATAS harga (area reaksi pertama); fallback ATR
    const tp1Candidate = indicators.resistanceLevel != null
      ? parseFloat(indicators.resistanceLevel.toFixed(2))
      : null;
    targetPrice = (tp1Candidate != null && tp1Candidate > price)
      ? tp1Candidate
      : parseFloat((price + atr * 1.5).toFixed(2));
    // TP2/TP3: ektensi ATR dari TP1 (selalu valid karena relatif terhadap TP1)
    tp2 = parseFloat((targetPrice + atr * 1.5).toFixed(2));
    tp3 = parseFloat((targetPrice + atr * 3.5).toFixed(2));
  } else if (direction === "down") {
    entryLow  = parseFloat((price - pullback * 0.3).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    // SL: jika resistance tersedia DAN di atas harga (valid struktural), letakkan di atasnya; fallback ATR
    const slCandidate = indicators.resistanceLevel != null
      ? parseFloat((indicators.resistanceLevel + atr * 0.1).toFixed(2))
      : null;
    stopLoss = (slCandidate != null && slCandidate > price)
      ? slCandidate
      : parseFloat((price + atr * 1.5).toFixed(2));
    // TP1: support terdekat di BAWAH harga (area reaksi pertama); fallback ATR
    const tp1Candidate = indicators.supportLevel != null
      ? parseFloat(indicators.supportLevel.toFixed(2))
      : null;
    targetPrice = (tp1Candidate != null && tp1Candidate < price)
      ? tp1Candidate
      : parseFloat((price - atr * 1.5).toFixed(2));
    // TP2/TP3: ekstensi ATR dari TP1
    tp2 = parseFloat((targetPrice - atr * 1.5).toFixed(2));
    tp3 = parseFloat((targetPrice - atr * 3.5).toFixed(2));
  } else {
    entryLow  = parseFloat((price - pullback).toFixed(2));
    entryHigh = parseFloat((price + pullback).toFixed(2));
    stopLoss  = parseFloat((price - atr * 1.5).toFixed(2));
    targetPrice = parseFloat(price.toFixed(2));
    tp2 = targetPrice;
    tp3 = targetPrice;
  }

  const rr = Math.abs(price - stopLoss) > 0
    ? parseFloat((Math.abs(targetPrice - price) / Math.abs(price - stopLoss)).toFixed(2))
    : 0;
  const slLabel = direction === "up" ? "swing low/support" : "swing high/resistance";
  const reasoning = `Analisis rule-based: trend=${indicators.trend}, EMA alignment=${indicators.emaAlignment}, RSI=${indicators.rsi14?.toFixed(1) ?? "-"} (${indicators.rsiSignal}), MACD=${indicators.macdSignalType}. SL=${stopLoss.toFixed(2)} di ${slLabel} (invalidasi thesis). TP1=${targetPrice.toFixed(2)} / TP2=${tp2.toFixed(2)} / TP3=${tp3.toFixed(2)} dari area S/R. RR ≈ ${rr}.`;

  return { direction, targetPrice, tp2, tp3, entryLow, entryHigh, stopLoss, confidence, reasoning };
}

// ─── Macro vote helper ─────────────────────────────────────────────────────────

/**
 * Perbaikan #2: Macro vote kini mempertimbangkan tren kumulatif 5 hari terakhir
 * DXY/US10Y, bukan hanya perubahan satu hari. Blend 50% single-day + 50% trend.
 */
function computeMacroVote(
  corr: { dxy: { changePct?: number | null }; us10y: { changePct?: number | null } },
  recentMacro?: Array<{ dxyChangePct: number | null; us10yChangePct: number | null }>
): { direction: "up" | "down" | "sideways"; confidence: number } {
  const dxyChange = corr.dxy.changePct ?? 0;
  const yieldChange = corr.us10y.changePct ?? 0;
  // DXY up → bearish gold; DXY down → bullish gold
  // US10Y up → bearish gold; US10Y down → bullish gold
  let score = 0;
  if (dxyChange < -0.1) score += 1;
  else if (dxyChange > 0.1) score -= 1;
  if (yieldChange < -0.02) score += 0.5;
  else if (yieldChange > 0.02) score -= 0.5;

  // Tren kumulatif 5 hari — menangkap sustained move yang lolos dari threshold harian
  if (recentMacro && recentMacro.length >= 3) {
    const dxyCum = recentMacro.reduce((s, r) => s + (r.dxyChangePct ?? 0), 0);
    const yieldCum = recentMacro.reduce((s, r) => s + (r.us10yChangePct ?? 0), 0);
    let trendScore = 0;
    if (dxyCum < -0.3) trendScore += 1;       // DXY turun >0.3% kumulatif → bullish gold
    else if (dxyCum > 0.3) trendScore -= 1;
    if (yieldCum < -0.08) trendScore += 0.5;
    else if (yieldCum > 0.08) trendScore -= 0.5;
    score = score * 0.5 + trendScore * 0.5;   // blend 50/50
  }

  const direction: "up" | "down" | "sideways" = score >= 0.6 ? "up" : score <= -0.6 ? "down" : "sideways";
  const confidence = Math.min(0.72, 0.38 + Math.abs(score) * 0.22);
  return { direction, confidence };
}

// ─── Feature 4: Trading Session Detector ──────────────────────────────────────
// Deteksi sesi trading berdasarkan waktu UTC

export function detectTradingSession(): "asia" | "london" | "new_york" | "overlap_london_ny" {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  // London-NY overlap: 13:00–16:00 UTC
  if (h >= 13 && h < 16) return "overlap_london_ny";
  // New York: 13:00–22:00 UTC
  if (h >= 13 && h < 22) return "new_york";
  // London: 07:00–16:00 UTC
  if (h >= 7 && h < 16) return "london";
  // Asia: 00:00–07:00 + 22:00–24:00 UTC
  return "asia";
}

// ─── Market Hours Detector ─────────────────────────────────────────────────────
// XAUUSD diperdagangkan 24/5 — buka Minggu 22:00 UTC, tutup Jumat 21:00 UTC.
// Jangan buat prediksi saat market tutup (Sabtu + Minggu pagi + Jumat malam).

export function isXauusdMarketOpen(): { open: boolean; reason: string; session: string | null } {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Minggu, 1=Sen, ..., 5=Jumat, 6=Sabtu
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const timeUTC = h + m / 60;

  // Sabtu: selalu tutup
  if (day === 6) {
    return { open: false, reason: "Market tutup (Sabtu)", session: null };
  }
  // Minggu sebelum 22:00 UTC: tutup
  if (day === 0 && timeUTC < 22) {
    const minsLeft = Math.round((22 - timeUTC) * 60);
    return { open: false, reason: `Market buka Minggu 22:00 UTC (${minsLeft} menit lagi)`, session: null };
  }
  // Jumat setelah 21:00 UTC: tutup
  if (day === 5 && timeUTC >= 21) {
    return { open: false, reason: "Market tutup (Jumat setelah 21:00 UTC)", session: null };
  }

  const session = detectTradingSession();
  return { open: true, reason: `Sesi ${session.replace(/_/g, " ").toUpperCase()} aktif`, session };
}

// ─── Feature 5: Market Regime Detector ───────────────────────────────────────
// Klasifikasikan kondisi pasar: Trending / Ranging / Volatile
// menggunakan ATR% dan EMA alignment

export function detectMarketRegime(
  indicators: XauusdIndicators
): "trending_up" | "trending_down" | "ranging" | "volatile" {
  const atr = indicators.atr14 ?? 0;
  const price = indicators.price;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;

  // Volatile: ATR > 0.75% dari harga — pasar bergejolak
  if (atrPct > 0.75) return "volatile";

  // Trending: EMA bullish/bearish stack + ATR moderat
  if (indicators.emaAlignment === "bullish_stack" && indicators.trend === "bullish")
    return "trending_up";
  if (indicators.emaAlignment === "bearish_stack" && indicators.trend === "bearish")
    return "trending_down";

  // Ranging: sinyal mixed, volatilitas rendah
  return "ranging";
}

// ─── Feature 9: Price Distribution P10/P50/P90 ────────────────────────────────
// Hitung estimasi distribusi harga (probabilistik) berdasarkan ATR dan confidence

function computePriceDistribution(
  price: number,
  direction: "up" | "down" | "sideways",
  confidence: number,
  atr: number
): { p10: number; p50: number; p90: number } {
  const a = atr > 0 ? atr : price * 0.003;
  const mult = 0.5 + confidence; // range: 0.5–1.5× ATR

  if (direction === "up") {
    return {
      p10: parseFloat((price + a * 0.2).toFixed(2)),          // minimal move
      p50: parseFloat((price + a * 1.2 * mult).toFixed(2)),   // median target
      p90: parseFloat((price + a * 2.5 * mult).toFixed(2)),   // optimistic
    };
  } else if (direction === "down") {
    return {
      p10: parseFloat((price - a * 2.5 * mult).toFixed(2)),   // optimistic downside
      p50: parseFloat((price - a * 1.2 * mult).toFixed(2)),   // median target
      p90: parseFloat((price - a * 0.2).toFixed(2)),          // minimal move
    };
  } else {
    return {
      p10: parseFloat((price - a * 0.6).toFixed(2)),
      p50: parseFloat(price.toFixed(2)),
      p90: parseFloat((price + a * 0.6).toFixed(2)),
    };
  }
}

// ─── Feature 7: Prediction Cluster Label ──────────────────────────────────────
// Label cluster kondisi pasar berdasarkan RSI + EMA + Trend + MACD

export function computeClusterLabel(indicators: XauusdIndicators): string {
  const rsi = indicators.rsi14 ?? 50;
  const rsiZone = rsi < 35 ? "RSI_OS" : rsi > 65 ? "RSI_OB" : "RSI_N";
  const emaZone = indicators.emaAlignment === "bullish_stack" ? "EMA_Bull"
    : indicators.emaAlignment === "bearish_stack" ? "EMA_Bear"
    : "EMA_Mix";
  const trendZone = indicators.trend === "bullish" ? "T_Up"
    : indicators.trend === "bearish" ? "T_Dn"
    : "T_Sd";
  const macdZone = indicators.macdSignalType === "bullish_cross" ? "MACD_B"
    : indicators.macdSignalType === "bearish_cross" ? "MACD_S"
    : "MACD_N";
  return `${rsiZone}+${emaZone}+${trendZone}+${macdZone}`;
}

// ─── Feature 1 (extended): Sentiment Vote ─────────────────────────────────────
// Agen ke-3 dari ensemble: menghitung arah berdasarkan sentimen berita

/**
 * Perbaikan #5: sentiment vote dengan bobot recency + keyword importance.
 * Berita < 4 jam → bobot 2×; berita high-impact (Fed/NFP/CPI/dll.) → ×1.5.
 * Neutral diabaikan; normalisasi berbasis total bobot bukan jumlah berita.
 */
function computeSentimentVote(
  news: Array<{ sentiment: string | null; title?: string | null; publishedAt?: Date | string | null }>
): { direction: "up" | "down" | "sideways"; confidence: number; label: string } {
  if (news.length === 0)
    return { direction: "sideways", confidence: 0.42, label: "sentiment" };

  const HIGH_IMPACT = [
    "fed", "fomc", "nfp", "cpi", "pce", "war", "sanction", "crisis",
    "central bank", "rate hike", "rate cut", "inflation", "recession",
    "federal reserve", "powell", "geopoliti", "conflict",
  ];
  const now = Date.now();

  let weightedScore = 0;
  let totalWeight = 0;

  for (const n of news) {
    if (!n.sentiment || n.sentiment === "neutral") continue;

    // Bobot recency: makin baru makin berat
    let weight = 1.0;
    if (n.publishedAt) {
      const ageHours = (now - new Date(n.publishedAt).getTime()) / 3_600_000;
      if (ageHours < 4) weight = 2.0;
      else if (ageHours < 12) weight = 1.5;
    }

    // Bobot tambahan untuk berita high-impact
    const titleLower = (n.title ?? "").toLowerCase();
    if (HIGH_IMPACT.some((k) => titleLower.includes(k))) weight *= 1.5;

    weightedScore += (n.sentiment === "bullish" ? 1 : -1) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return { direction: "sideways", confidence: 0.42, label: "sentiment" };

  const score = weightedScore / totalWeight; // normalized −1..+1

  if (score > 0.2) {
    return {
      direction: "up",
      confidence: Math.min(0.72, 0.48 + Math.abs(score) * 0.28),
      label: "sentiment",
    };
  }
  if (score < -0.2) {
    return {
      direction: "down",
      confidence: Math.min(0.72, 0.48 + Math.abs(score) * 0.28),
      label: "sentiment",
    };
  }
  return { direction: "sideways", confidence: 0.42, label: "sentiment" };
}

// ─── Feature 8: Forget Curve — Exponential Decay on Brain Entries ─────────────
// Pattern lama kehilangan bobot secara eksponensial.
// Half-life ≈ 30 hari (lambda ≈ 0.023/day).

async function applyForgetCurve(): Promise<void> {
  const LAMBDA = 0.023; // daily decay rate
  const now = Date.now();

  const entries = await db
    .select({
      id: xauusdBrainTable.id,
      createdAt: xauusdBrainTable.createdAt,
      decayWeight: xauusdBrainTable.decayWeight,
    })
    .from(xauusdBrainTable)
    .where(eq(xauusdBrainTable.isActive, true));

  for (const entry of entries) {
    const ageDays = (now - new Date(entry.createdAt).getTime()) / 86_400_000;
    const newWeight = parseFloat(Math.exp(-LAMBDA * ageDays).toFixed(4));
    const currentWeight = entry.decayWeight ?? 1.0;
    // Only update if change is significant (>1%)
    if (Math.abs(newWeight - currentWeight) > 0.01) {
      await db
        .update(xauusdBrainTable)
        .set({ decayWeight: newWeight, updatedAt: new Date() })
        .where(eq(xauusdBrainTable.id, entry.id));
    }
  }
  console.log(`[XAUUSD Brain] Forget curve applied to ${entries.length} brain entries.`);
}

// ─── Brain retrieval — ambil insights relevan untuk disertakan di prompt prediksi ──
// Prioritas 1: entries dengan market tag yang cocok dengan kondisi saat ini
// Prioritas 2: entries dengan skor tertinggi (decayWeight × confidence)

async function retrieveRelevantBrainEntries(
  currentTags: string,
  session: string,
  regime: string,
  limit = 7
): Promise<string> {
  try {
    // Fetch top entries by weighted relevance score
    const entries = await db
      .select({
        category: xauusdBrainTable.category,
        title: xauusdBrainTable.title,
        content: xauusdBrainTable.content,
        confidence: xauusdBrainTable.confidence,
        decayWeight: xauusdBrainTable.decayWeight,
        marketConditionTags: xauusdBrainTable.marketConditionTags,
      })
      .from(xauusdBrainTable)
      .where(eq(xauusdBrainTable.isActive, true))
      .orderBy(desc(sql`${xauusdBrainTable.decayWeight} * ${xauusdBrainTable.confidence}`))
      .limit(50);

    if (entries.length === 0) return "";

    // Score each entry by tag overlap with current market state
    const tagSet = new Set(currentTags.split(",").filter(Boolean));
    const sessionTag = `session_${session}`;
    const regimeTag = `regime_${regime}`;

    const scored = entries.map((e) => {
      const entryTags = new Set((e.marketConditionTags ?? "").split(",").filter(Boolean));
      let overlap = 0;
      for (const t of tagSet) if (entryTags.has(t)) overlap++;
      // Bonus untuk session/regime yang cocok
      if (entryTags.has(sessionTag)) overlap += 2;
      if (entryTags.has(regimeTag)) overlap += 2;
      const score = (e.decayWeight ?? 1) * (e.confidence ?? 0.5) * (1 + overlap * 0.35);
      return { ...e, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    if (top.length === 0) return "";

    return `\n\n=== MEMORI AI (${top.length} insights relevan dari ${entries.length} yang dipelajari) ===\n` +
      top.map((e, i) => {
        const snippet = (e.content ?? "").slice(0, 220);
        const ellipsis = (e.content ?? "").length > 220 ? "..." : "";
        return `[${i + 1}] [${(e.category ?? "insight").toUpperCase()}] ${e.title}\n    ${snippet}${ellipsis}`;
      }).join("\n");
  } catch (err) {
    console.error("[XAUUSD Brain] Brain retrieval error:", err);
    return "";
  }
}

// ─── Weekend-aware verifyAt helper ─────────────────────────────────────────────
/**
 * Bug fix #3: Dorong `date` melewati window tutup XAUUSD weekend
 * (Jumat 22:00 UTC – Minggu 22:00 UTC) agar prediksi Jumat sore tidak
 * kadaluarsa saat market libur dan dihitung salah secara tidak adil.
 */
function skipXauusdWeekend(date: Date): Date {
  const day = date.getUTCDay();   // 0=Min, 1=Sen, ..., 5=Jum, 6=Sab
  const hour = date.getUTCHours();
  // Jumat setelah 22:00 UTC atau Sabtu penuh → dorong ke Minggu 22:00 UTC
  if ((day === 5 && hour >= 22) || day === 6) {
    const next = new Date(date);
    const daysToSunday = (7 - day) % 7; // 5→2, 6→1
    next.setUTCDate(next.getUTCDate() + daysToSunday);
    next.setUTCHours(22, 0, 0, 0);
    return next;
  }
  // Minggu sebelum 22:00 UTC → dorong ke Minggu 22:00 UTC
  if (day === 0 && hour < 22) {
    const next = new Date(date);
    next.setUTCHours(22, 0, 0, 0);
    return next;
  }
  return date; // market buka, tidak perlu penyesuaian
}

// ─── Prediction maker ──────────────────────────────────────────────────────────

async function makePrediction(
  indicators: XauusdIndicators,
  predType: "training" | "main" = "training"
): Promise<void> {
  // Jangan buat prediksi saat market XAUUSD tutup (weekend / Jumat malam)
  const marketStatus = isXauusdMarketOpen();
  if (!marketStatus.open) {
    if (predType === "main") {
      console.log(`[XAUUSD Brain] Prediksi UTAMA dilewati — ${marketStatus.reason}`);
    }
    return;
  }

  const timeframeLabel = "H1"; // validasi berdasarkan SL/TP, bukan waktu

  // ── Hitung session/regime/cluster lebih awal (tidak perlu async) ──────────
  const tradingSession = detectTradingSession();
  const marketRegime = detectMarketRegime(indicators);
  const clusterLabel = computeClusterLabel(indicators);
  const currentTags = extractMarketTags(indicators);

  // Fetch semua context secara paralel termasuk brain retrieval + segmen win rate
  const [mtfResult, corrResult, winRateResult, newsResult, brainResult, segWinRateResult, macroSnapshotsResult] = await Promise.allSettled([
    getMultiTimeframeAnalysis(),
    getCorrelationAnalysis(),
    // Win rate: last 50 verified predictions (overall)
    db.select({
      direction: xauusdPredictionsTable.direction,
      isCorrect: xauusdPredictionsTable.isCorrect,
    })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"))
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(50),
    // Perbaikan #5: tambah publishedAt + limit 6 untuk recency weighting
    db.select({
      title: xauusdNewsTable.title,
      sentiment: xauusdNewsTable.sentiment,
      aiAnalysis: xauusdNewsTable.aiAnalysis,
      publishedAt: xauusdNewsTable.publishedAt,
    })
      .from(xauusdNewsTable)
      .orderBy(desc(xauusdNewsTable.publishedAt))
      .limit(6),
    // Brain retrieval — insights relevan dari memori AI (Prioritas 1)
    retrieveRelevantBrainEntries(currentTags, tradingSession, marketRegime),
    // Segment win rate — akurasi per sesi × regime (last 200 verified)
    db.select({
      direction: xauusdPredictionsTable.direction,
      isCorrect: xauusdPredictionsTable.isCorrect,
      tradingSession: xauusdPredictionsTable.tradingSession,
      marketRegime: xauusdPredictionsTable.marketRegime,
    })
      .from(xauusdPredictionsTable)
      .where(eq(xauusdPredictionsTable.status, "verified"))
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(200),
    // Perbaikan #2: 5 macro snapshots terakhir untuk tren kumulatif DXY/Yield
    db.select({
      dxyChangePct: xauusdMacroSnapshotsTable.dxyChangePct,
      us10yChangePct: xauusdMacroSnapshotsTable.us10yChangePct,
    })
      .from(xauusdMacroSnapshotsTable)
      .orderBy(desc(xauusdMacroSnapshotsTable.snapshotAt))
      .limit(5),
  ]);

  let mtfContext = "";
  if (mtfResult.status === "fulfilled") {
    try {
      const mtf = mtfResult.value;
      const confluence = summarizeTimeframeConfluence(mtf);
      mtfContext = `\n\n=== ANALISIS MULTI-TIMEFRAME ===\n${mtf
        .map((t) => `${t.label}: trend=${t.indicators?.trend ?? "n/a"}, RSI=${t.indicators?.rsi14?.toFixed(1) ?? "n/a"}, EMA alignment=${t.indicators?.emaAlignment ?? "n/a"}`)
        .join("\n")}\nKesimpulan confluence: ${confluence.agreement} (${confluence.bullishCount} TF bullish, ${confluence.bearishCount} TF bearish)`;
    } catch (err) {
      console.error("[XAUUSD Brain] Multi-timeframe context error:", err);
    }
  }

  let correlationContext = "";
  if (corrResult.status === "fulfilled") {
    const corr = corrResult.value;
    const fmt = (v: number | null, suffix = "") =>
      v != null ? `${v > 0 ? "+" : ""}${v.toFixed(2)}${suffix}` : "n/a";
    correlationContext =
      `\n\n=== KORELASI MAKRO (DXY, US10Y, VIX, Silver) ===` +
      `\nDXY: ${corr.dxy.price ?? "n/a"} (${fmt(corr.dxy.changePct, "%")}) — ${corr.dxy.interpretation}` +
      `\nUS 10Y Yield: ${corr.us10y.price ?? "n/a"}% (${fmt(corr.us10y.changePct, "%")}) — ${corr.us10y.interpretation}` +
      `\nVIX (Fear): ${corr.vix.price ?? "n/a"} (${fmt(corr.vix.changePct, "%")}) — ${corr.vix.interpretation}` +
      `\nSilver: ${corr.silver.price ?? "n/a"} (${fmt(corr.silver.changePct, "%")}) — ${corr.silver.interpretation}`;
  }

  let winRateContext = "";
  if (winRateResult.status === "fulfilled" && winRateResult.value.length > 0) {
    const preds = winRateResult.value;
    const correct = preds.filter((p) => p.isCorrect === true).length;
    const total = preds.length;
    const winRate = ((correct / total) * 100).toFixed(1);
    const byDir = { up: { c: 0, t: 0 }, down: { c: 0, t: 0 }, sideways: { c: 0, t: 0 } };
    for (const p of preds) {
      const d = p.direction as "up" | "down" | "sideways";
      if (byDir[d]) {
        byDir[d].t++;
        if (p.isCorrect) byDir[d].c++;
      }
    }
    winRateContext = `\n\n=== WIN RATE AI (${total} prediksi terakhir) ===\nOverall: ${winRate}% akurat (${correct}/${total})\nBUY: ${byDir.up.t > 0 ? ((byDir.up.c / byDir.up.t) * 100).toFixed(0) : "n/a"}% (${byDir.up.c}/${byDir.up.t}) | SELL: ${byDir.down.t > 0 ? ((byDir.down.c / byDir.down.t) * 100).toFixed(0) : "n/a"}% (${byDir.down.c}/${byDir.down.t}) | SIDEWAYS: ${byDir.sideways.t > 0 ? ((byDir.sideways.c / byDir.sideways.t) * 100).toFixed(0) : "n/a"}% (${byDir.sideways.c}/${byDir.sideways.t})\nGunakan data ini untuk kalibrasi confidence — jika win rate direction tertentu rendah, turunkan confidence.`;

    // ── Deteksi streak kalah — jika 3+ dari 5 terakhir salah, tambah peringatan ──
    const recentPreds = preds.slice(0, 5);
    const recentWrongCount = recentPreds.filter(p => p.isCorrect === false).length;
    if (recentWrongCount >= 3) {
      winRateContext += `\n\n⚠️ STREAK KALAH TERDETEKSI: ${recentWrongCount}/${recentPreds.length} prediksi terakhir SALAH. Kondisi pasar sedang sulit. WAJIB: (1) turunkan confidence 15-20%, (2) preferensikan SIDEWAYS jika sinyal tidak sangat kuat, (3) perlebar entry zone.`;
    }
  }

  let newsContext = "";
  if (newsResult.status === "fulfilled" && newsResult.value.length > 0) {
    const newsList = newsResult.value;
    newsContext = `\n\n=== SENTIMEN BERITA TERBARU (${newsList.length} berita) ===\n${newsList
      .map((n) => `• [${(n.sentiment ?? "neutral").toUpperCase()}] ${n.title}${n.aiAnalysis ? ` — ${n.aiAnalysis}` : ""}`)
      .join("\n")}`;
  }

  // ── Prioritas 1: Brain context — memori AI yang relevan ────────────────────
  const brainContext = brainResult.status === "fulfilled" ? brainResult.value : "";

  // ── Prioritas 3: Segment win rate — akurasi per kondisi pasar saat ini ─────
  let segmentWinRateContext = "";
  if (segWinRateResult.status === "fulfilled" && segWinRateResult.value.length >= 10) {
    const all = segWinRateResult.value;
    const sameSession = all.filter((p) => p.tradingSession === tradingSession);
    const sameRegime = all.filter((p) => p.marketRegime === marketRegime);
    const sameBoth = all.filter((p) => p.tradingSession === tradingSession && p.marketRegime === marketRegime);
    const calcWR = (arr: typeof all) => {
      if (arr.length < 5) return null;
      const correct = arr.filter((p) => p.isCorrect === true).length;
      return { wr: ((correct / arr.length) * 100).toFixed(0), n: arr.length };
    };
    const wrBoth = calcWR(sameBoth);
    const wrSession = calcWR(sameSession);
    const wrRegime = calcWR(sameRegime);
    const parts: string[] = [];
    if (wrBoth) parts.push(`Sesi ${tradingSession} + regime ${marketRegime}: ${wrBoth.wr}% akurat (${wrBoth.n} prediksi)`);
    else {
      if (wrSession) parts.push(`Sesi ${tradingSession}: ${wrSession.wr}% akurat (${wrSession.n} prediksi)`);
      if (wrRegime) parts.push(`Regime ${marketRegime}: ${wrRegime.wr}% akurat (${wrRegime.n} prediksi)`);
    }
    if (parts.length > 0) {
      segmentWinRateContext = `\n\n=== WIN RATE PER KONDISI PASAR SAAT INI ===\n${parts.join("\n")}\nJika win rate segmen <50%, WAJIB turunkan confidence 10-15%.`;
    }
  }

  // ── Sentiment vote dari berita (untuk ensemble + sessionRegimeContext) ─────
  const newsForSentiment = newsResult.status === "fulfilled" ? newsResult.value : [];
  const sentimentVote = computeSentimentVote(newsForSentiment);

  const sessionRegimeContext = `\n\n=== KONTEKS PASAR ===\nSesi Trading: ${tradingSession.toUpperCase()} | Market Regime: ${marketRegime.toUpperCase()} | Cluster: ${clusterLabel}\nSentimen Berita: ${sentimentVote.direction.toUpperCase()} (${(sentimentVote.confidence * 100).toFixed(0)}% confident)`;

  const systemPrompt = `Kamu adalah AI trading system XAUUSD dengan metodologi analisis terstruktur.

URUTAN ANALISIS (wajib diikuti):
1. TREND — cek struktur market: apakah higher high/lower low? EMA alignment? Timeframe mana yang dominan?
2. MOMENTUM — RSI, MACD, histogram. Apakah momentum mendukung atau divergen dari harga?
3. LEVEL — identifikasi support/resistance STRUKTURAL yang valid (swing high/low nyata, bukan angka acak)
4. KONFIRMASI — MTF confluens, DXY/US10Y korelasi, sentimen berita, win rate segmen
5. RISIKO — hitung RR, tentukan SL/TP berdasarkan struktur

ATURAN SL (stop loss = batas salahnya thesis, bukan angka aman acak):
- Long: SL di BAWAH swing low / support struktural — jika kena, berarti thesis long sudah salah
- Short: SL di ATAS swing high / resistance struktural — jika kena, berarti thesis short sudah salah
- SL BUKAN hasil perkalian ATR random; harus ada alasan struktural kenapa harga di level itu invalidasi setup

ATURAN TP (target dari area yang secara teknis wajar jadi tempat reaksi):
- TP1: target TERDEKAT — resistance/support pertama yang valid → selalu ada exit awal
- TP2: target LANJUTAN — S/R berikutnya jika momentum masih sehat
- TP3: target JAUH — ekstensi jika trend kuat dan volume mendukung; konservatif jika setup lemah
- Jika setup lemah (confluence rendah), TP konservatif. Jika market kuat (EMA stack + MACD + volume), TP lebih luas

ATURAN CONFIDENCE:
- >0.75: ≥4 faktor align searah
- 0.55–0.75: 3 faktor align
- <0.55: sinyal mixed → tidak perlu prediksi
- Jika win rate segmen <50%, TURUNKAN confidence 10–15%
- Pertimbangkan memori AI: jika pola ini sebelumnya terbukti salah, sesuaikan

Jawab HANYA dalam format JSON:
{
  "direction": "up" | "down" | "sideways",
  "targetPrice": <TP1 — S/R pertama dalam arah prediksi, USD>,
  "tp2": <TP2 — S/R lanjutan jika momentum sehat, USD>,
  "tp3": <TP3 — S/R jauh jika trend kuat, USD>,
  "entryLow": <batas bawah entry USD, maks ±0.4×ATR dari harga>,
  "entryHigh": <batas atas entry USD>,
  "stopLoss": <SL di level struktural invalidasi thesis, USD>,
  "confidence": <0.0-1.0>,
  "reasoning": "<3-4 kalimat — sebutkan: trend struktur, momentum, level S/R yang dipakai sebagai SL/TP, dan konfirmasi MTF/makro/memori AI>"
}`;

  const userMsg = `=== INDIKATOR 1H XAUUSD ===
Harga: ${indicators.price}
RSI14: ${indicators.rsi14} (${indicators.rsiSignal})
EMA9/21/50/200: ${indicators.ema9} / ${indicators.ema21} / ${indicators.ema50} / ${indicators.ema200}
MACD: line=${indicators.macdLine}, signal=${indicators.macdSignal}, hist=${indicators.macdHistogram} (${indicators.macdSignalType})
BB: upper=${indicators.bbUpper}, mid=${indicators.bbMiddle}, lower=${indicators.bbLower}, width=${indicators.bbWidth}%
ATR14: ${indicators.atr14}
Trend: ${indicators.trend} | EMA Alignment: ${indicators.emaAlignment}
Support: ${indicators.supportLevel} | Resistance: ${indicators.resistanceLevel}${mtfContext}${correlationContext}${winRateContext}${newsContext}${sessionRegimeContext}${segmentWinRateContext}${brainContext}

Buat prediksi arah berikutnya. Jawab JSON saja, tanpa teks lain.`;

  // Always compute the rule-based prediction first (real technical analysis
  // from ATR/support/resistance/EMA/RSI/MACD) — this is the source of truth
  // for entry range + stop loss when the AI is unavailable or unparseable,
  // and also used to sanity-check the AI's numbers.
  const ruleBased = computeRuleBasedPrediction(indicators);

  // (session/regime/cluster dan sentimentVote sudah dihitung lebih awal)

  let pred: {
    direction: string;
    targetPrice: number;
    tp2?: number;
    tp3?: number;
    entryLow?: number;
    entryHigh?: number;
    stopLoss?: number;
    confidence: number;
    reasoning: string;
  } = ruleBased;
  let aiPowered = false;

  try {
    const raw = await queryDeepSeek(systemPrompt, userMsg, 400);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        direction: string;
        targetPrice: number;
        tp2?: number;
        tp3?: number;
        entryLow?: number;
        entryHigh?: number;
        stopLoss?: number;
        confidence: number;
        reasoning: string;
      };
      // Only trust the AI response if it actually supplied numeric entry/SL
      // levels — otherwise fall back to the rule-based analysis so we never
      // save arbitrary/missing numbers.
      if (
        typeof parsed.entryLow === "number" &&
        typeof parsed.entryHigh === "number" &&
        typeof parsed.stopLoss === "number" &&
        typeof parsed.targetPrice === "number"
      ) {
        pred = parsed;
        aiPowered = true;
      }
    }
  } catch (err) {
    console.error("[XAUUSD Brain] AI prediction parse error, using rule-based fallback:", err);
  }

  try {
    // max 24 jam — validasi utama via SL/TP, ini hanya fallback kadaluarsa
    // Bug fix: lewati window weekend XAUUSD (Jumat 22:00 UTC – Minggu 22:00 UTC)
    // agar prediksi Jumat sore tidak kadaluarsa saat market tutup.
    const rawVerifyAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const verifyAt = skipXauusdWeekend(rawVerifyAt);

    const direction = (pred.direction ?? ruleBased.direction) as "up" | "down" | "sideways";
    const targetPrice = pred.targetPrice ?? ruleBased.targetPrice; // TP1
    const tp2 = pred.tp2 ?? ruleBased.tp2;
    const tp3 = pred.tp3 ?? ruleBased.tp3;
    const entryLow = pred.entryLow ?? ruleBased.entryLow;
    const entryHigh = pred.entryHigh ?? ruleBased.entryHigh;
    const stopLoss = pred.stopLoss ?? ruleBased.stopLoss;
    const reasoning = aiPowered
      ? (pred.reasoning ?? ruleBased.reasoning)
      : `${ruleBased.reasoning} (AI tidak tersedia — dihitung dari analisis teknikal)`;

    // ── Ensemble Voting (Feature 1 — 4 agents: technical/macro/sentiment/AI) ──
    const techVote = { direction: ruleBased.direction, confidence: ruleBased.confidence, label: "technical" };
    const recentMacro = macroSnapshotsResult.status === "fulfilled" ? macroSnapshotsResult.value : [];
    const macroVote = corrResult.status === "fulfilled"
      ? { ...computeMacroVote(corrResult.value, recentMacro), label: "macro" }
      : { direction: "sideways" as const, confidence: 0.45, label: "macro" };
    const baseAiConf = Math.min(1, Math.max(0, pred.confidence ?? ruleBased.confidence));
    const aiVote = { direction, confidence: baseAiConf, label: aiPowered ? "ai" : "rule" };
    // Feature 1 (extended): sentimentVote = agen ke-3 (dari data berita, tanpa API call ekstra)
    const sentimentVoteForEnsemble = { ...sentimentVote, label: "sentiment" };

    // Majority vote dari 3 core agents (tech + macro + sentiment) → arah final
    const coreVotes = [techVote.direction, macroVote.direction, sentimentVote.direction];
    const upVotes = coreVotes.filter(d => d === "up").length;
    const downVotes = coreVotes.filter(d => d === "down").length;
    const sideVotes = coreVotes.filter(d => d === "sideways").length;
    const majorityDir = upVotes >= 2 ? "up" : downVotes >= 2 ? "down" : sideVotes >= 2 ? "sideways" : null;
    // Gunakan majority jika jelas (≥2/3); jika tie → AI jadi tiebreaker
    const finalDirection = (majorityDir ?? direction) as "up" | "down" | "sideways";

    const allDirs = [techVote.direction, macroVote.direction, sentimentVote.direction, aiVote.direction];
    const agreementCount = Math.max(
      allDirs.filter(d => d === "up").length,
      allDirs.filter(d => d === "down").length,
      allDirs.filter(d => d === "sideways").length
    );
    // +8% semua setuju, +4% tiga setuju, -6% penuh split
    const agreementBonus = agreementCount === 4 ? 0.08 : agreementCount === 3 ? 0.04 : agreementCount === 1 ? -0.06 : 0;
    const confidence = Math.min(1, Math.max(0, baseAiConf + agreementBonus));

    // ── Confidence Gate: abaikan prediksi dengan sinyal terlalu lemah ────────
    const CONFIDENCE_GATE = 0.55;
    if (confidence < CONFIDENCE_GATE) {
      console.log(`[XAUUSD Brain] Prediksi tidak disimpan — confidence ${(confidence * 100).toFixed(0)}% di bawah threshold ${(CONFIDENCE_GATE * 100).toFixed(0)}%`);
      return;
    }

    // Feature 9: Price Distribution P10/P50/P90 berdasarkan ATR + confidence
    const distribution = computePriceDistribution(
      indicators.price,
      finalDirection,
      confidence,
      indicators.atr14 ?? indicators.price * 0.003
    );

    const ensembleVotes = {
      technical: techVote,
      macro: macroVote,
      sentiment: sentimentVoteForEnsemble,
      ai: aiVote,
      agreementCount,
      agreementBonus: parseFloat(agreementBonus.toFixed(3)),
      finalDirection,
      session: tradingSession,
      regime: marketRegime,
      cluster: clusterLabel,
    };
    // ─────────────────────────────────────────────────────────────────────────

    await db.insert(xauusdPredictionsTable).values({
      timeframe: timeframeLabel,
      predictionType: predType,
      direction: finalDirection,
      targetPrice, // TP1
      tp2,
      tp3,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      indicatorsAtPrediction: { ...(indicators as unknown as Record<string, unknown>), ensembleVotes },
      // Feature 4: Session-Aware
      tradingSession,
      // Feature 5: Market Regime Detector
      marketRegime,
      // Feature 7: Prediction Clustering
      clusterLabel,
      // Feature 9: Price Distribution
      priceP10: distribution.p10,
      priceP50: distribution.p50,
      priceP90: distribution.p90,
      verifyAt,
      status: "pending",
    });

    // Fire-and-forget WhatsApp alert — no-ops if not configured/enabled.
    void notifyNewPrediction({
      direction,
      targetPrice,
      entryLow,
      entryHigh,
      stopLoss,
      confidence,
      reasoning,
      priceAtPrediction: indicators.price,
      timeframe: timeframeLabel,
    });
  } catch (err) {
    console.error("[XAUUSD Brain] Prediction save error:", err);
  }
}

// ─── Prediction verifier ───────────────────────────────────────────────────────

async function verifyOldPredictions(currentPrice: number): Promise<{ checked: number; wrong: number }> {
  const now = new Date();

  // Ambil SEMUA prediksi pending — validasi lewat SL/TP, bukan waktu
  const pending = await db
    .select()
    .from(xauusdPredictionsTable)
    .where(eq(xauusdPredictionsTable.status, "pending"))
    .limit(30);

  if (pending.length === 0) return { checked: 0, wrong: 0 };

  let wrongCount = 0;
  let checkedCount = 0;

  for (const pred of pending) {
    const sl = pred.stopLoss;
    const tp = pred.targetPrice;
    const priceDiff = currentPrice - pred.priceAtPrediction;
    const pricePct = priceDiff / pred.priceAtPrediction;

    let resolved = false;
    let isCorrect: boolean | null = null;
    let resolveReason = "";

    // ── Validasi berdasarkan SL/TP (price-level) ──────────────────────────────
    if (pred.direction === "up") {
      if (tp != null && currentPrice >= tp) {
        resolved = true; isCorrect = true;
        resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≥ $${tp.toFixed(2)})`;
      } else if (sl != null && currentPrice <= sl) {
        resolved = true; isCorrect = false;
        resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≤ $${sl.toFixed(2)})`;
      }
    } else if (pred.direction === "down") {
      if (tp != null && currentPrice <= tp) {
        resolved = true; isCorrect = true;
        resolveReason = `TP tercapai ($${currentPrice.toFixed(2)} ≤ $${tp.toFixed(2)})`;
      } else if (sl != null && currentPrice >= sl) {
        resolved = true; isCorrect = false;
        resolveReason = `SL kena ($${currentPrice.toFixed(2)} ≥ $${sl.toFixed(2)})`;
      }
    } else {
      // Bug fix #1: sideways kini punya jalur BENAR — harga tetap dalam kisaran saat verifyAt
      if (Math.abs(pricePct) > 0.005) {
        // Harga keluar dari kisaran sideways → SALAH (langsung)
        resolved = true; isCorrect = false;
        resolveReason = `Harga bergerak terlalu jauh dari sideways (${(pricePct * 100).toFixed(2)}%)`;
      } else if (pred.verifyAt && now > new Date(pred.verifyAt)) {
        // Waktu habis & harga masih dalam kisaran ±0.5% → BENAR
        resolved = true; isCorrect = true;
        resolveReason = `Sideways valid: harga tetap dalam kisaran (±${(Math.abs(pricePct) * 100).toFixed(2)}%)`;
      }
    }

    // ── Fallback waktu untuk up/down: max 24 jam jika SL/TP belum kena ───────
    if (!resolved && pred.verifyAt && now > new Date(pred.verifyAt)) {
      resolved = true;
      resolveReason = "Kadaluarsa 24 jam tanpa hit SL/TP";
    }

    // SL/TP belum kena, prediksi masih terbuka — lewati
    if (!resolved) continue;

    const actualDirection =
      pricePct > 0.002 ? "up" : pricePct < -0.002 ? "down" : "sideways";
    if (isCorrect === null) isCorrect = actualDirection === pred.direction;

    checkedCount++;
    if (!isCorrect) wrongCount++;

    console.log(`[XAUUSD Brain] Prediksi #${pred.id} ${pred.direction.toUpperCase()} → ${isCorrect ? "✅ BENAR" : "❌ SALAH"} | ${resolveReason}`);

    if (!isCorrect) {
      // Self-critique: ask DeepSeek why the prediction was wrong
      const sysPr = `Kamu adalah AI trading coach untuk XAUUSD. Analisis mengapa prediksi salah dan berikan pelajaran spesifik.`;
      const msg = `Prediksi saya ${pred.direction} dari $${pred.priceAtPrediction} dengan alasan: "${pred.reasoning}"
Kenyataannya: harga bergerak ${actualDirection} ke $${currentPrice.toFixed(2)} (${pricePct > 0 ? "+" : ""}${(pricePct * 100).toFixed(3)}%).
Tulis 2-3 kalimat pelajaran spesifik yang harus diingat untuk menghindari kesalahan prediksi serupa di masa depan.`;

      let critique: string | null = null;
      try {
        const raw = await queryDeepSeek(sysPr, msg, 300);
        if (raw && raw.length > 50) {
          critique = raw;
          // Save as lesson in brain
          await db.insert(xauusdBrainTable).values({
            category: "lesson",
            title: `Revisi: Prediksi ${pred.direction} salah pada ${pred.priceAtPrediction.toFixed(2)}`,
            content: critique,
            confidence: 0.8,
            sourceQuestion: `Why was ${pred.direction} prediction from ${pred.priceAtPrediction} wrong?`,
            marketConditionTags: [
              `dir_${pred.direction}`,
              pred.tradingSession ? `session_${pred.tradingSession}` : null,
              pred.marketRegime ? `regime_${pred.marketRegime}` : null,
            ].filter(Boolean).join(","),
          });
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Self-critique error:", err);
      }

      // ── Prioritas 2: Reinforcement negatif — lemahkan entries dengan arah yang salah ──
      // Bug fix #2: hanya melemahkan insight dari konteks (session + regime) yang sama
      // agar AI tidak melupakan insight bagus dari kondisi pasar yang berbeda.
      try {
        const wrongDirTag = `dir_${pred.direction}`;
        const sessionTag = pred.tradingSession ? `session_${pred.tradingSession}` : null;
        const regimeTag  = pred.marketRegime   ? `regime_${pred.marketRegime}`   : null;

        const negConds = [
          eq(xauusdBrainTable.isActive, true),
          sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + wrongDirTag + "%"}`,
          ...(sessionTag ? [sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + sessionTag + "%"}`] : []),
          ...(regimeTag  ? [sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + regimeTag  + "%"}`] : []),
        ] as Parameters<typeof and>;

        await db.update(xauusdBrainTable)
          .set({
            decayWeight: sql`GREATEST(0.1, ${xauusdBrainTable.decayWeight} * 0.88)`,
            updatedAt: new Date(),
          })
          .where(and(...negConds));

        console.log(`[XAUUSD Brain] ⬇️ Negative reinforcement: ${wrongDirTag}${sessionTag ? " +" + sessionTag : ""}${regimeTag ? " +" + regimeTag : ""} dilemahkan (×0.88)`);
      } catch (err) {
        console.error("[XAUUSD Brain] Negative reinforcement error:", err);
      }

      // Always mark prediction as resolved — never leave stuck in pending
      await db
        .update(xauusdPredictionsTable)
        .set({
          actualPrice: currentPrice,
          actualDirection,
          isCorrect,
          priceDiff,
          revisedAt: critique ? new Date() : null,
          revisionNote: critique,
          status: critique ? "revised" : "verified",
        })
        .where(eq(xauusdPredictionsTable.id, pred.id));
    } else {
      // ── Feature 1: Success Pattern Memory ─────────────────────────────────
      // Save indicator snapshot as a 'pattern' brain entry when prediction is CORRECT
      if (pred.indicatorsAtPrediction) {
        try {
          const ind = pred.indicatorsAtPrediction as Record<string, unknown>;
          const tags = [
            ind.emaAlignment === "bullish_stack" ? "ema_bullish"
              : ind.emaAlignment === "bearish_stack" ? "ema_bearish" : "ema_mixed",
            ind.rsiSignal ? `rsi_${ind.rsiSignal}` : null,
            ind.macdSignalType && ind.macdSignalType !== "neutral"
              ? `macd_${String(ind.macdSignalType)}` : null,
            `dir_${pred.direction}`,
            `trend_${ind.trend ?? "unknown"}`,
            // Tag session + regime agar brain retrieval bonus aktif
            pred.tradingSession ? `session_${pred.tradingSession}` : null,
            pred.marketRegime ? `regime_${pred.marketRegime}` : null,
          ].filter(Boolean).join(",");

          const rsiVal = typeof ind.rsi14 === "number" ? ind.rsi14.toFixed(1) : "-";
          const pnlStr = `${(pricePct * 100).toFixed(3)}%`;

          await db.insert(xauusdBrainTable).values({
            category: "pattern",
            title: `✅ Pola Sukses: ${pred.direction.toUpperCase()} benar di $${pred.priceAtPrediction.toFixed(2)}`,
            content: `Prediksi ${pred.direction.toUpperCase()} BENAR (${pnlStr}). ` +
              `Kondisi saat prediksi — EMA: ${String(ind.emaAlignment ?? "-")}, ` +
              `RSI: ${rsiVal} (${String(ind.rsiSignal ?? "-")}), ` +
              `MACD: ${String(ind.macdSignalType ?? "-")}, ` +
              `Trend: ${String(ind.trend ?? "-")}. ` +
              `Entry $${pred.priceAtPrediction.toFixed(2)} → Actual $${currentPrice.toFixed(2)}. ` +
              `Confidence: ${(pred.confidence * 100).toFixed(0)}%.`,
            confidence: Math.min(0.92, 0.65 + pred.confidence * 0.3),
            sourceQuestion: `SuccessPattern:${pred.direction}:${pred.priceAtPrediction}`,
            marketConditionTags: tags,
          });
        } catch (err) {
          console.error("[XAUUSD Brain] Success pattern save error:", err);
        }
      }

      // ── Prioritas 2: Reinforcement positif — kuatkan brain entries yang relevan ──
      // TP hit (target tercapai) → reward lebih besar (1.22×) vs resolusi lain (1.12×)
      const tpHit = resolveReason.startsWith("TP");
      const boostMultiplier = tpHit ? 1.22 : 1.12;
      try {
        const ind = (pred.indicatorsAtPrediction ?? {}) as Record<string, unknown>;
        const matchTags = [
          ind.emaAlignment === "bullish_stack" ? "ema_bullish"
            : ind.emaAlignment === "bearish_stack" ? "ema_bearish" : "ema_mixed",
          `dir_${pred.direction}`,
          `trend_${String(ind.trend ?? "unknown")}`,
        ].filter(Boolean);
        for (const tag of matchTags) {
          await db.update(xauusdBrainTable)
            .set({
              decayWeight: sql`LEAST(1.0, ${xauusdBrainTable.decayWeight} * ${boostMultiplier})`,
              usageCount: sql`${xauusdBrainTable.usageCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(xauusdBrainTable.isActive, true),
                sql`${xauusdBrainTable.marketConditionTags} ILIKE ${"%" + tag + "%"}`
              )
            );
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Positive reinforcement error:", err);
      }

      await db
        .update(xauusdPredictionsTable)
        .set({
          actualPrice: currentPrice,
          actualDirection,
          isCorrect,
          priceDiff,
          status: "verified",
        })
        .where(eq(xauusdPredictionsTable.id, pred.id));
    }
  }

  return { checked: checkedCount, wrong: wrongCount };
}

// ─── Feature 3: Adaptive Question Generator ────────────────────────────────────
// After 50+ verified predictions, analyze failure conditions and generate
// targeted questions about the indicator combos where AI is weakest.

async function generateAdaptiveQuestion(
  indicators: XauusdIndicators
): Promise<{ question: string; hash: string } | null> {
  try {
    // Get last 100 verified predictions with indicator data
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const verified = await db
      .select({
        direction: xauusdPredictionsTable.direction,
        isCorrect: xauusdPredictionsTable.isCorrect,
        indicatorsAtPrediction: xauusdPredictionsTable.indicatorsAtPrediction,
      })
      .from(xauusdPredictionsTable)
      .where(
        and(
          eq(xauusdPredictionsTable.status, "verified"),
          gte(xauusdPredictionsTable.predictedAt, cutoff)
        )
      )
      .orderBy(desc(xauusdPredictionsTable.predictedAt))
      .limit(100);

    if (verified.length < 50) return null; // not enough data yet

    // Group by (emaAlignment, rsiSignal, macdSignalType) and find worst combo
    const groups: Record<string, { total: number; wrong: number }> = {};
    for (const p of verified) {
      const ind = (p.indicatorsAtPrediction ?? {}) as Record<string, unknown>;
      const key = `${ind.emaAlignment ?? "?"}|${ind.rsiSignal ?? "?"}|${ind.macdSignalType ?? "?"}`;
      if (!groups[key]) groups[key] = { total: 0, wrong: 0 };
      groups[key].total++;
      if (!p.isCorrect) groups[key].wrong++;
    }

    // Find the combo with highest wrong rate (min 3 samples)
    let worstKey = "";
    let worstRate = 0;
    for (const [key, stats] of Object.entries(groups)) {
      if (stats.total >= 3) {
        const rate = stats.wrong / stats.total;
        if (rate > worstRate) { worstRate = rate; worstKey = key; }
      }
    }

    if (!worstKey || worstRate < 0.4) return null; // only generate if >40% failure rate

    const [ema, rsi, macd] = worstKey.split("|");
    const question = `ANALISIS KRITIS untuk XAUUSD: Dalam kondisi EMA alignment "${ema}", RSI signal "${rsi}", dan MACD "${macd}", ` +
      `AI sering membuat prediksi yang SALAH (tingkat kegagalan >40%). ` +
      `Harga saat ini $${indicators.price.toFixed(2)}, RSI ${indicators.rsi14?.toFixed(1)}. ` +
      `Jelaskan mengapa kombinasi indikator ini sering menyesatkan, kondisi tersembunyi apa yang harus dicek lebih dulu, ` +
      `dan strategi konkret untuk meningkatkan akurasi dalam kondisi seperti ini.`;

    return { question, hash: generateQuestionHash(question) };
  } catch {
    return null;
  }
}

// ─── News analyzer ────────────────────────────────────────────────────────────

async function analyzeAndSaveNews(): Promise<void> {
  try {
    const newsItems = await fetchXauusdNews();
    if (newsItems.length === 0) return;

    const sysPr = `Kamu adalah analis berita gold/XAUUSD. Untuk setiap berita, tentukan sentiment (bullish/bearish/neutral) dan berikan analisis singkat dampaknya pada harga gold.`;
    const hasKey = !!(await getDeepseekApiKey());

    for (const item of newsItems.slice(0, 5)) {
      // Only analyze first 5 to save API calls
      let sentiment: string = "neutral";
      let aiAnalysis: string | null = null;

      if (hasKey) {
        try {
          const raw = await queryDeepSeek(
            sysPr,
            `Judul: "${item.title}"\nRingkasan: "${item.summary}"\n\nJawab format JSON: {"sentiment":"bullish"|"bearish"|"neutral","analysis":"<1-2 kalimat dampak pada XAUUSD>"}`,
            200
          );
          const jm = raw.match(/\{[\s\S]*\}/);
          if (jm) {
            const parsed = JSON.parse(jm[0]) as {
              sentiment: string;
              analysis: string;
            };
            sentiment = parsed.sentiment ?? "neutral";
            aiAnalysis = parsed.analysis ?? null;
          }
        } catch {
          // skip if analysis fails
        }
      }

      // Upsert by title (avoid duplicates)
      await db
        .insert(xauusdNewsTable)
        .values({
          title: item.title,
          summary: item.summary,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
          sentiment,
          aiAnalysis,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    console.error("[XAUUSD Brain] News error:", err);
  }
}

// ─── Extreme Learning Mode ─────────────────────────────────────────────────────

/**
 * Ambil satu snapshot historis acak dari DB (90 hari terakhir) dan konversi ke XauusdIndicators.
 * Digunakan saat market tutup agar mesin bisa terus belajar dari skenario pasar masa lalu.
 */
async function getHistoricalIndicators(): Promise<XauusdIndicators | null> {
  // Hanya ambil snapshot 7 hari terakhir agar harga tetap relevan dengan kondisi pasar saat ini.
  // Snapshot lebih tua (harga 2000-an) membuat DeepSeek menjawab dengan konteks yang sudah usang.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
  const rows = await db
    .select()
    .from(xauusdSnapshotsTable)
    .where(sql`${xauusdSnapshotsTable.snapshotAt} >= ${sevenDaysAgo.toISOString()}`)
    .orderBy(sql`RANDOM()`)
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    price: r.price,
    open: r.open ?? r.price,
    high: r.high ?? r.price,
    low: r.low ?? r.price,
    volume: r.volume ?? 0,
    rsi14: r.rsi14 ?? null,
    ema9: r.ema9 ?? null,
    ema21: r.ema21 ?? null,
    ema50: r.ema50 ?? null,
    ema200: r.ema200 ?? null,
    macdLine: r.macdLine ?? null,
    macdSignal: r.macdSignal ?? null,
    macdHistogram: r.macdHistogram ?? null,
    bbUpper: r.bbUpper ?? null,
    bbMiddle: r.bbMiddle ?? null,
    bbLower: r.bbLower ?? null,
    bbWidth: r.bbWidth ?? null,
    atr14: r.atr14 ?? null,
    trend: (r.trend as XauusdIndicators["trend"]) ?? "sideways",
    rsiSignal: (r.rsiSignal as XauusdIndicators["rsiSignal"]) ?? "neutral",
    macdSignalType: (r.macdSignalType as XauusdIndicators["macdSignalType"]) ?? "neutral",
    emaAlignment: (r.emaAlignment as XauusdIndicators["emaAlignment"]) ?? "mixed",
    supportLevel: r.supportLevel ?? null,
    resistanceLevel: r.resistanceLevel ?? null,
  };
}

/**
 * Minta DeepSeek untuk membuat pertanyaan studi unik berdasarkan kondisi pasar saat ini.
 * Mengembalikan array pertanyaan yang sudah di-hash, difilter dari sessionCache.
 */
async function generateQuestionsWithDeepSeek(
  indicators: XauusdIndicators,
  count: number,
  spikeDetected: boolean,
  sessionCache: Set<string>
): Promise<Array<{ question: string; hash: string }>> {
  const apiKey = await getDeepseekApiKey();
  if (!apiKey) throw new Error("DeepSeek API key tidak ada");

  const marketCtx = [
    `Harga XAUUSD   : ${indicators.price}`,
    `RSI14          : ${indicators.rsi14?.toFixed(1) ?? "N/A"} (${indicators.rsiSignal ?? "neutral"})`,
    `Trend          : ${indicators.trend ?? "N/A"}`,
    `EMA Alignment  : ${indicators.emaAlignment ?? "N/A"}`,
    `EMA9/21/50/200 : ${indicators.ema9?.toFixed(2) ?? "N/A"} / ${indicators.ema21?.toFixed(2) ?? "N/A"} / ${indicators.ema50?.toFixed(2) ?? "N/A"} / ${indicators.ema200?.toFixed(2) ?? "N/A"}`,
    `MACD           : ${indicators.macdSignalType ?? "N/A"} (hist ${indicators.macdHistogram?.toFixed(3) ?? "N/A"})`,
    `ATR14          : ${indicators.atr14?.toFixed(2) ?? "N/A"}`,
    `BB             : upper=${indicators.bbUpper?.toFixed(2) ?? "N/A"} middle=${indicators.bbMiddle?.toFixed(2) ?? "N/A"} lower=${indicators.bbLower?.toFixed(2) ?? "N/A"} width=${indicators.bbWidth?.toFixed(2) ?? "N/A"}%`,
    `Support        : ${indicators.supportLevel?.toFixed(2) ?? "N/A"}`,
    `Resistance     : ${indicators.resistanceLevel?.toFixed(2) ?? "N/A"}`,
    spikeDetected ? `⚡ SPIKE TERDETEKSI: harga bergerak cepat` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Kondisi pasar XAUUSD saat ini:\n${marketCtx}\n\n` +
    `Buat ${count} pertanyaan studi trading XAUUSD yang SPESIFIK, UNIK, dan BERVARIASI topiknya. ` +
    `Pertanyaan harus relevan dengan kondisi pasar di atas. ` +
    `Topik boleh mencakup: analisis teknikal, manajemen risiko, psikologi trading, makro ekonomi, ` +
    `timing entry/exit, pola candlestick, korelasi aset, strategi konkret, dll. ` +
    `Format: satu pertanyaan per baris, awali dengan nomor (1. 2. 3. dst). ` +
    `Gunakan Bahasa Indonesia. Sertakan angka spesifik dari data pasar di atas dalam pertanyaan jika relevan.`;

  const raw = await queryDeepSeek(
    "Kamu adalah expert trader XAUUSD/Gold 20 tahun yang bertugas merancang kurikulum belajar trading. Buat pertanyaan yang mendalam dan actionable.",
    prompt,
    600
  );

  // Parse: ambil baris yang diawali angka
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  const questions: Array<{ question: string; hash: string }> = [];
  // batchSeen mencegah duplikat dalam satu response DeepSeek (beda dari sessionCache antar siklus)
  const batchSeen = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^\d+[\.\)]\s*(.+)/);
    if (!m) continue;
    const q = m[1].trim();
    if (q.length < 20) continue;
    const h = generateQuestionHash(q);
    if (sessionCache.has(h)) continue; // sudah tanya di sesi ini
    if (batchSeen.has(h)) continue;    // duplikat dalam batch ini
    batchSeen.add(h);
    questions.push({ question: q, hash: h });
    if (questions.length >= count) break;
  }

  return questions;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Jeda yang bisa diinterupsi oleh extremeAbort.
 * Tidur dalam chunk 1 detik, cek flag setiap chunk.
 * Mengembalikan true jika diinterupsi sebelum waktu habis.
 */
async function sleepOrAbort(ms: number): Promise<boolean> {
  const CHUNK = 1_000;
  let remaining = ms;
  while (remaining > 0) {
    if (extremeAbort) return true;
    await sleep(Math.min(CHUNK, remaining));
    remaining -= CHUNK;
  }
  return extremeAbort;
}

async function runExtremeLearningLoop(target: number, questionsPerCycle: number): Promise<void> {
  const SYS_PR = `Kamu adalah expert trader XAUUSD/Gold dengan pengalaman 20 tahun. 
Berikan jawaban SANGAT SPESIFIK, dengan angka konkret, strategi actionable, dan pelajaran yang bisa langsung diaplikasikan.
Gunakan Bahasa Indonesia. Hindari jawaban generik. Berikan minimal 3 poin actionable per jawaban.`;

  // Circuit breaker — jeda 5 menit lalu coba lagi (maks 3 kali) sebelum benar-benar berhenti
  const MAX_CONSECUTIVE_ERRORS = 5;
  let consecutiveErrors = 0;
  let circuitRetries = 0;

  while (extremeProgress < target && !extremeAbort) {
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      if (circuitRetries >= EXTREME_CIRCUIT_MAX_RETRIES) {
        console.error(
          `[Extreme Mode] 🚨 Circuit breaker final — ${EXTREME_CIRCUIT_MAX_RETRIES} kali retry gagal. ` +
          `Periksa DeepSeek API key dan koneksi. Mode ekstrem dihentikan otomatis.`
        );
        extremeAbort = true;
        break;
      }
      circuitRetries++;
      console.warn(
        `[Extreme Mode] ⚡ Circuit breaker (retry ${circuitRetries}/${EXTREME_CIRCUIT_MAX_RETRIES}) — ` +
        `jeda ${EXTREME_CIRCUIT_BACKOFF_MS / 60_000} menit lalu lanjut...`
      );
      consecutiveErrors = 0;
      if (await sleepOrAbort(EXTREME_CIRCUIT_BACKOFF_MS)) break;
      continue;
    }

    // 1. Ambil data pasar — selalu coba live dulu (TradingView bisa diakses tiap saat,
    //    termasuk weekend). Historis hanya fallback jika live benar-benar gagal.
    let indicators: XauusdIndicators | null = null;
    const marketStatus = isXauusdMarketOpen();

    try {
      indicators = await fetchXauusdIndicators("1h");
      if (indicators) {
        extremeDataMode = "live";
        console.log(`[Extreme Mode] 📡 Live — harga ${indicators.price} (${marketStatus.reason})`);
      }
    } catch (err) {
      console.error("[Extreme Mode] Gagal fetch live indicators:", err);
    }

    if (!indicators) {
      // Live gagal → pakai snapshot historis 7 hari terakhir dari DB (harga tetap relevan)
      try {
        indicators = await getHistoricalIndicators();
        if (indicators) {
          extremeDataMode = "historical";
          console.log(`[Extreme Mode] 📚 Historis — harga ${indicators.price} (fallback: TradingView tidak merespons)`);
        }
      } catch (err) {
        console.error("[Extreme Mode] Gagal ambil data historis:", err);
      }
    }

    if (!indicators) {
      console.warn("[Extreme Mode] Tidak ada data tersedia (live & historis gagal), coba lagi 30s...");
      if (await sleepOrAbort(30_000)) break;
      continue;
    }

    // 2. Detect spike
    let spikeDetected = false;
    try {
      const lastSnap = await db
        .select({ price: xauusdSnapshotsTable.price })
        .from(xauusdSnapshotsTable)
        .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
        .limit(1);
      if (lastSnap.length > 0) {
        const change = Math.abs((indicators.price - lastSnap[0].price) / lastSnap[0].price);
        spikeDetected = change >= SPIKE_THRESHOLD;
      }
    } catch { /* non-fatal */ }

    // 3. Save snapshot (non-blocking)
    db.insert(xauusdSnapshotsTable).values({
      price: indicators.price,
      open: indicators.open,
      high: indicators.high,
      low: indicators.low,
      volume: indicators.volume,
      priceChange: null,
      isSpike: spikeDetected,
      rsi14: indicators.rsi14,
      ema9: indicators.ema9,
      ema21: indicators.ema21,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      macdLine: indicators.macdLine,
      macdSignal: indicators.macdSignal,
      macdHistogram: indicators.macdHistogram,
      bbUpper: indicators.bbUpper,
      bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower,
      bbWidth: indicators.bbWidth,
      atr14: indicators.atr14,
      trend: indicators.trend,
      rsiSignal: indicators.rsiSignal,
      macdSignalType: indicators.macdSignalType,
      emaAlignment: indicators.emaAlignment,
      supportLevel: indicators.supportLevel,
      resistanceLevel: indicators.resistanceLevel,
    }).catch(() => { /* non-fatal */ });

    // 4. Generate pertanyaan via DeepSeek (pool tak terbatas & kontekstual)
    //    Fallback ke template statis jika DeepSeek gagal.
    const remaining = target - extremeProgress;
    const count = Math.min(questionsPerCycle, remaining);
    let toAsk: Array<{ question: string; hash: string }> = [];

    try {
      toAsk = await generateQuestionsWithDeepSeek(indicators, count + 3, spikeDetected, extremeHashCache!);
      toAsk = toAsk.slice(0, count);
      if (toAsk.length > 0) {
        console.log(`[Extreme Mode] 🤖 DeepSeek generate ${toAsk.length} pertanyaan baru`);
      }
    } catch (err) {
      console.warn("[Extreme Mode] ⚠️ Generate pertanyaan via DeepSeek gagal, pakai template:", String(err));
    }

    // Fallback: template statis jika DeepSeek tidak menghasilkan cukup pertanyaan
    if (toAsk.length < count) {
      const need = count - toAsk.length;
      const templateCandidates = getMarketAwareQuestions(indicators, need + 12, spikeDetected)
        .filter(c => !extremeHashCache!.has(c.hash))
        .slice(0, need);
      if (templateCandidates.length > 0) {
        console.log(`[Extreme Mode] 📋 Tambah ${templateCandidates.length} pertanyaan dari template`);
        toAsk = [...toAsk, ...templateCandidates];
      }
    }

    if (toAsk.length === 0) {
      console.warn("[Extreme Mode] ⚠️ Tidak ada pertanyaan baru (DeepSeek & template habis) — coba lagi 30s...");
      if (await sleepOrAbort(30_000)) break;
      extremeCycleCount++;
      continue;
    }

    // 5. Tanya satu per satu — tunggu jawaban, lalu jeda 15-30s
    let cycleInsights = 0;
    let cycleAnswered = 0;
    const cycleStart = Date.now();

    for (const { question, hash } of toAsk) {
      if (extremeAbort || extremeProgress >= target) break;

      try {
        // Tandai hash di in-memory cache segera (sebelum insert) agar siklus berikutnya tidak minta pertanyaan sama
        extremeHashCache!.add(hash);

        // Insert placeholder — onConflictDoNothing agar hash duplikat tidak dihitung sebagai error
        const inserted = await db
          .insert(xauusdQuestionsLogTable)
          .values({
            question,
            questionHash: hash,
            marketContext: indicators as unknown as Record<string, unknown>,
          })
          .onConflictDoNothing()
          .returning({ id: xauusdQuestionsLogTable.id });

        if (inserted.length === 0) {
          // Hash sudah ada di DB (cross-session duplicate) — skip tanpa error
          console.log(`[Extreme Mode] ⏭ Skip pertanyaan duplikat (hash sudah di DB)`);
          continue;
        }

        // Tanya DeepSeek — tunggu jawaban penuh
        const answer = await queryDeepSeek(SYS_PR, question, 1_000);
        const quality = scoreAnswer(question, answer);

        await db
          .update(xauusdQuestionsLogTable)
          .set({ answer, quality, answeredAt: new Date(), savedToBrain: quality >= EXTREME_QUALITY_THRESHOLD })
          .where(eq(xauusdQuestionsLogTable.id, inserted[0].id));

        // Simpan ke brain jika kualitas ≥ 0.65
        if (quality >= EXTREME_QUALITY_THRESHOLD && answer.length > 100) {
          await db.insert(xauusdBrainTable).values({
            category: extractBrainCategory(question),
            title: extractTitle(question, answer),
            content: answer,
            confidence: quality,
            sourceQuestion: question,
            marketConditionTags: extractMarketTags(indicators),
          });
          cycleInsights++;
          extremeInsightsTotal++;
        }

        consecutiveErrors = 0; // reset circuit breaker saat berhasil
        circuitRetries = 0;    // reset retry counter juga
        extremeProgress++;
        cycleAnswered++;

        // Catat ke history untuk perhitungan kecepatan (simpan maks 30 titik)
        const nowTs = Date.now();
        extremeLastProgressAt = nowTs;
        extremeProgressHistory.push({ ts: nowTs, count: extremeProgress });
        if (extremeProgressHistory.length > 30) extremeProgressHistory.shift();

        // Progress report setiap 10 pertanyaan atau saat target tercapai
        if (extremeProgress % 10 === 0 || extremeProgress === target) {
          const pct = Math.round((extremeProgress / target) * 100);
          console.log(
            `[Extreme Mode] 📊 Progress: ${extremeProgress}/${target} (${pct}%) — Insights: ${extremeInsightsTotal} — Siklus: ${extremeCycleCount + 1}`
          );
        }

        if (extremeProgress >= target || extremeAbort) break;

        // Jeda acak 15–30 detik setelah jawaban diterima sebelum pertanyaan berikutnya
        const pause = EXTREME_PAUSE_MIN_MS + Math.random() * (EXTREME_PAUSE_MAX_MS - EXTREME_PAUSE_MIN_MS);
        console.log(`[Extreme Mode] ⏱ Jeda ${(pause / 1000).toFixed(0)}s → pertanyaan ke-${extremeProgress + 1}/${target}`);
        if (await sleepOrAbort(pause)) break;

      } catch (err) {
        consecutiveErrors++;
        console.error(
          `[Extreme Mode] ❌ Pertanyaan gagal (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`,
          String(err)
        );
        extremeHashCache!.delete(hash); // hapus dari cache agar bisa dicoba ulang
        if (await sleepOrAbort(5_000)) break;
      }
    }

    // Simpan log siklus (non-fatal)
    try {
      await db.insert(xauusdLearningLogTable).values({
        priceAtCycle: indicators.price,
        questionsAsked: cycleAnswered,
        insightsSaved: cycleInsights,
        predictionsChecked: 0,
        wrongPredictions: 0,
        spikeDetected,
        summary: `[EKSTREM] Siklus ${extremeCycleCount + 1}: ${extremeProgress}/${target} selesai, +${cycleInsights} insights`,
        durationMs: Date.now() - cycleStart,
      });
    } catch { /* non-fatal */ }

    extremeCycleCount++;
  }

  if (extremeProgress >= target) {
    console.log(
      `[Extreme Mode] 🎯 TARGET TERCAPAI! ${extremeProgress} pertanyaan, ${extremeInsightsTotal} insights dalam ${extremeCycleCount} siklus`
    );
  } else {
    console.log(`[Extreme Mode] ⛔ Dihentikan: ${extremeProgress}/${target} pertanyaan selesai`);
  }
}

/**
 * Mulai mode belajar ekstrem — belajar tanpa berhenti sampai target tercapai.
 * Non-blocking: langsung return, loop berjalan di background.
 */
export function startExtremeLearningMode(
  target: number,
  questionsPerCycle = EXTREME_QUESTIONS_PER_CYCLE
): void {
  if (isExtremeRunning) throw new Error("Mode ekstrem sudah berjalan");
  if (isLearning) throw new Error("Siklus normal sedang berjalan — tunggu selesai lalu coba lagi");
  if (!Number.isInteger(target) || target < 1 || target > 10_000) throw new Error("Target harus bilangan bulat 1–10.000");
  const safeQpc = Math.max(3, Math.min(20, Math.round(questionsPerCycle)));

  isExtremeRunning = true;
  extremeTarget = target;
  extremeProgress = 0;
  extremeInsightsTotal = 0;
  extremeCycleCount = 0;
  extremeStartedAt = new Date();
  extremeAbort = false;
  extremeStopRequested = false;
  extremeProgressHistory = [];
  extremeLastProgressAt = null;
  extremeDataMode = "live";
  extremeHashCache = new Set();

  console.log(`[Extreme Mode] 🚀 Mulai — target: ${target} pertanyaan, ${safeQpc}/siklus`);

  // Hash cache hanya melacak pertanyaan dalam SESI INI (tidak load dari DB).
  // Banyak template bersifat statis (tidak pakai data harga), sehingga hashnya
  // selalu sama di semua sesi — loading DB akan memblokir semua template selamanya.
  // Dedup antar sesi ditangani oleh INSERT dengan ON CONFLICT di DB.
  extremeHashCache = new Set();
  console.log(`[Extreme Mode] 📚 Hash cache sesi baru (kosong) — dedup aktif dalam sesi ini saja`);

  (async () => {
    try {
      await runExtremeLearningLoop(target, safeQpc);
    } catch (err) {
      console.error("[Extreme Mode] Loop error fatal:", err);
    } finally {
      isExtremeRunning = false;
      extremeHashCache = null;
      console.log(`[Extreme Mode] ✅ Sesi berakhir — ${extremeProgress}/${extremeTarget} pertanyaan`);
    }
  })().catch(err => {
    isExtremeRunning = false;
    console.error("[Extreme Mode] Startup error:", err);
  });
}

/** Hentikan mode ekstrem setelah pertanyaan yang sedang berjalan selesai. */
export function stopExtremeLearningMode(): void {
  if (!isExtremeRunning) return;
  extremeAbort = true;
  extremeStopRequested = true;
  console.log("[Extreme Mode] ⛔ Permintaan berhenti diterima — akan berhenti setelah pertanyaan selesai...");
}

// ─── Main learning cycle ───────────────────────────────────────────────────────

export async function runLearningCycle(): Promise<{
  success: boolean;
  summary: string;
  questionsAsked: number;
  insightsSaved: number;
}> {
  // Jangan jalankan siklus normal saat mode ekstrem aktif
  if (isExtremeRunning) {
    return { success: false, summary: "Mode ekstrem sedang berjalan — siklus normal dilewati.", questionsAsked: 0, insightsSaved: 0 };
  }
  // Global lock — prevent overlap between interval cycles and manual /learn-now trigger
  if (isLearning) {
    return { success: false, summary: "Cycle already in progress, skipping.", questionsAsked: 0, insightsSaved: 0 };
  }
  isLearning = true;

  const cycleStart = Date.now();
  let questionsAsked = 0;
  let insightsSaved = 0;
  let wrongPredictions = 0;
  let predictionsChecked = 0;
  let spikeDetected = false;
  let currentPrice = 0;

  try {
    console.log("[XAUUSD Brain] Starting learning cycle...");

    // 1. Fetch indicators from TradingView Scanner
    const indicators = await fetchXauusdIndicators("1h");
    if (!indicators) {
      return { success: false, summary: "TradingView Scanner returned no data", questionsAsked: 0, insightsSaved: 0 };
    }
    currentPrice = indicators.price;

    // 2. Detect spike (compare with last snapshot)
    const lastSnap = await db
      .select({ price: xauusdSnapshotsTable.price })
      .from(xauusdSnapshotsTable)
      .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
      .limit(1);

    let priceChange: number | null = null;
    if (lastSnap.length > 0) {
      priceChange = (indicators.price - lastSnap[0].price) / lastSnap[0].price;
      spikeDetected = Math.abs(priceChange) >= SPIKE_THRESHOLD;
    }

    // 3. Save snapshot
    await db.insert(xauusdSnapshotsTable).values({
      price: indicators.price,
      open: indicators.open,
      high: indicators.high,
      low: indicators.low,
      volume: indicators.volume,
      priceChange: priceChange ? parseFloat((priceChange * 100).toFixed(4)) : null,
      isSpike: spikeDetected,
      rsi14: indicators.rsi14,
      ema9: indicators.ema9,
      ema21: indicators.ema21,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      macdLine: indicators.macdLine,
      macdSignal: indicators.macdSignal,
      macdHistogram: indicators.macdHistogram,
      bbUpper: indicators.bbUpper,
      bbMiddle: indicators.bbMiddle,
      bbLower: indicators.bbLower,
      bbWidth: indicators.bbWidth,
      atr14: indicators.atr14,
      trend: indicators.trend,
      rsiSignal: indicators.rsiSignal,
      macdSignalType: indicators.macdSignalType,
      emaAlignment: indicators.emaAlignment,
      supportLevel: indicators.supportLevel,
      resistanceLevel: indicators.resistanceLevel,
    });

    // 3.5 Save macro snapshot (DXY/US10Y) every 3 cycles — feeds Pearson correlation
    if (totalCycles % 3 === 0) {
      try {
        const corr = await getCorrelationAnalysis();
        if (corr.dxy.price != null || corr.us10y.price != null) {
          await db.insert(xauusdMacroSnapshotsTable).values({
            goldPrice: corr.gold.price ?? indicators.price,
            goldChangePct: corr.gold.changePct,
            dxy: corr.dxy.price,
            dxyChangePct: corr.dxy.changePct,
            us10y: corr.us10y.price,
            us10yChangePct: corr.us10y.changePct,
          });
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Macro snapshot error:", err);
      }
    }

    // 4. Generate & ask unique questions — Perbaikan #3: dynamic gen as primary, static as fallback
    const questionCount = spikeDetected ? 8 : 5;
    let toAsk: Array<{ question: string; hash: string }> = [];

    // Dynamic generation (seperti BTC engine) — adaptif terhadap kondisi pasar real-time
    try {
      const dynamicQs = await generateQuestionsWithDeepSeek(
        indicators, questionCount + 3, spikeDetected, new Set<string>()
      );
      const filtered = await filterNewQuestions(dynamicQs);
      toAsk = filtered.slice(0, questionCount);
      if (toAsk.length > 0) {
        console.log(`[XAUUSD Brain] 🧠 Dynamic questions: ${toAsk.length} pertanyaan dari kondisi pasar saat ini`);
      }
    } catch {
      // Fallback ke static templates jika DeepSeek tidak tersedia / gagal
    }

    // Topup dari static templates jika dynamic tidak cukup
    if (toAsk.length < questionCount) {
      const needed = questionCount - toAsk.length;
      const candidates = getRandomQuestions(indicators, needed + 6, spikeDetected);
      const filtered = await filterNewQuestions(candidates);
      const extra = filtered.filter((q) => !toAsk.some((a) => a.hash === q.hash));
      toAsk.push(...extra.slice(0, needed));
      if (needed > 0) console.log(`[XAUUSD Brain] 📋 Static fallback: ${Math.min(needed, extra.length)} pertanyaan dari template`);
    }

    // ── Feature 3: Adaptive Question Generator ─────────────────────────────
    // Every 3rd cycle, inject a targeted failure-analysis question if 50+ verified preds
    if (totalCycles % 3 === 0) {
      try {
        const adaptiveQ = await generateAdaptiveQuestion(indicators);
        if (adaptiveQ) {
          const isNew = await filterNewQuestions([adaptiveQ]);
          if (isNew.length > 0 && !toAsk.some(q => q.hash === adaptiveQ.hash)) {
            toAsk.unshift(adaptiveQ);
          }
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Adaptive question error:", err);
      }
    }

    for (const { question, hash } of toAsk) {
      questionsAsked++;
      const sysPr = `Kamu adalah expert trader XAUUSD/Gold dengan pengalaman 20 tahun. 
Berikan jawaban SANGAT SPESIFIK, dengan angka konkret, strategi actionable, dan pelajaran yang bisa langsung diaplikasikan.
Gunakan Bahasa Indonesia. Hindari jawaban generik.`;

      try {
        // Insert question placeholder
        const [inserted] = await db
          .insert(xauusdQuestionsLogTable)
          .values({
            question,
            questionHash: hash,
            marketContext: indicators as unknown as Record<string, unknown>,
          })
          .returning({ id: xauusdQuestionsLogTable.id });

        const answer = await queryDeepSeek(sysPr, question, 900);
        const quality = scoreAnswer(question, answer);

        await db
          .update(xauusdQuestionsLogTable)
          .set({
            answer,
            quality,
            answeredAt: new Date(),
            savedToBrain: quality >= 0.6,
          })
          .where(eq(xauusdQuestionsLogTable.id, inserted.id));

        // 5. Save good answers to brain
        if (quality >= 0.6 && answer.length > 100) {
          await db.insert(xauusdBrainTable).values({
            category: extractBrainCategory(question),
            title: extractTitle(question, answer),
            content: answer,
            confidence: quality,
            sourceQuestion: question,
            marketConditionTags: extractMarketTags(indicators),
          });
          insightsSaved++;
        }
      } catch (err) {
        console.error("[XAUUSD Brain] Q&A error:", err);
      }
    }

    // 6. Verify old predictions & self-revise
    const verifyResult = await verifyOldPredictions(indicators.price);
    predictionsChecked = verifyResult.checked;
    wrongPredictions = verifyResult.wrong;

    // 7. Prediksi dua mode:
    //    TRAINING — setiap siklus tanpa batas, untuk melatih AI mencatat pola & akurasi
    //    MAIN (utama) — hanya dibuat saat arah berubah dari main pending saat ini, untuk ditampilkan ke user
    await makePrediction(indicators, "training");

    // Cek apakah perlu buat prediksi UTAMA baru (saat arah berubah / belum ada main pending)
    try {
      const lastMainPending = await db
        .select({ id: xauusdPredictionsTable.id, direction: xauusdPredictionsTable.direction })
        .from(xauusdPredictionsTable)
        .where(
          and(
            eq(xauusdPredictionsTable.predictionType, "main"),
            eq(xauusdPredictionsTable.status, "pending")
          )
        )
        .orderBy(desc(xauusdPredictionsTable.predictedAt))
        .limit(1);

      // Ambil arah dari training prediction yang baru saja dibuat (ambil latest)
      const latestTraining = await db
        .select({ direction: xauusdPredictionsTable.direction })
        .from(xauusdPredictionsTable)
        .where(eq(xauusdPredictionsTable.predictionType, "training"))
        .orderBy(desc(xauusdPredictionsTable.predictedAt))
        .limit(1);

      const latestDir = latestTraining[0]?.direction;
      const mainPendingDir = lastMainPending[0]?.direction;

      // Buat prediksi UTAMA jika: (1) tidak ada main pending, atau (2) arah berubah
      if (latestDir && (!mainPendingDir || latestDir !== mainPendingDir)) {
        const changeReason = !mainPendingDir ? "belum ada prediksi utama" : `arah berubah ${mainPendingDir} → ${latestDir}`;
        console.log(`[XAUUSD Brain] Prediksi UTAMA dibuat — ${changeReason}`);
        await makePrediction(indicators, "main");
      }
    } catch (err) {
      console.error("[XAUUSD Brain] Main prediction check error:", err);
    }

    // 8. Fetch & analyze news (every 3rd cycle to save API calls)
    if (totalCycles % 3 === 0) {
      await analyzeAndSaveNews();
    }

    // Feature 8: Forget Curve — decay lama brain entries setiap 12 siklus
    if (totalCycles % 12 === 0) {
      void applyForgetCurve().catch(err =>
        console.error("[XAUUSD Brain] Forget curve error:", err)
      );
    }

    // 9. Save learning log (non-fatal — log error tapi jangan gagalkan cycle)
    const durationMs = Date.now() - cycleStart;
    const summary = `Cycle #${totalCycles + 1}: price=${currentPrice}, ${spikeDetected ? "⚡SPIKE " : ""}questions=${questionsAsked}, insights=${insightsSaved}, checked=${predictionsChecked}, wrong=${wrongPredictions}`;

    try {
      await db.insert(xauusdLearningLogTable).values({
        priceAtCycle: currentPrice,
        questionsAsked,
        insightsSaved,
        predictionsChecked,
        wrongPredictions,
        spikeDetected,
        summary,
        durationMs,
      });
    } catch (logErr) {
      console.error("[XAUUSD Brain] Learning log insert error (non-fatal):", logErr);
    }

    totalCycles++;
    totalInsights += insightsSaved;
    lastCycleAt = new Date();
    console.log(`[XAUUSD Brain] ${summary} (${durationMs}ms)`);

    // Sync semua data ke file SQLite setiap siklus (non-blocking, tidak ganggu engine)
    syncToFile().catch(err =>
      console.error("[XAUUSD Brain] Brain backup sync error:", err)
    );

    return { success: true, summary, questionsAsked, insightsSaved };
  } catch (err) {
    console.error("[XAUUSD Brain] Cycle error:", err);
    return {
      success: false,
      summary: String(err),
      questionsAsked,
      insightsSaved,
    };
  } finally {
    // Always release the lock so next cycle can run
    isLearning = false;
  }
}

// ─── Start / Stop engine ───────────────────────────────────────────────────────

export function startXauusdBrainEngine(): void {
  if (learningTimer) return; // already running

  console.log("[XAUUSD Brain] Engine started. Learning cycle every 5 minutes.");

  // Auto-restore dari backup SQLite jika PostgreSQL kosong (non-blocking)
  autoRestoreIfEmpty().catch(err =>
    console.error("[XAUUSD Brain] Auto-restore error:", err)
  );

  // Run first cycle immediately (non-blocking); runLearningCycle owns the lock
  runLearningCycle().catch((err) =>
    console.error("[XAUUSD Brain] Initial cycle error:", err)
  );

  // Interval just triggers the cycle; the lock inside runLearningCycle prevents overlap
  learningTimer = setInterval(() => {
    runLearningCycle().catch((err) =>
      console.error("[XAUUSD Brain] Interval cycle error:", err)
    );
  }, LEARN_INTERVAL_MS);
}

export function stopXauusdBrainEngine(): void {
  if (learningTimer) {
    clearInterval(learningTimer);
    learningTimer = null;
    console.log("[XAUUSD Brain] Engine stopped.");
  }
}

export function getEngineStatus(): {
  running: boolean;
  lastCycleAt: Date | null;
  totalCycles: number;
  totalInsights: number;
  isLearning: boolean;
  extremeMode: {
    active: boolean;
    target: number;
    progress: number;
    insights: number;
    cycles: number;
    startedAt: Date | null;
    percentDone: number;
    stopRequested: boolean;
    speedQph: number;
    etaMs: number | null;
    dataMode: "live" | "historical";
  };
} {
  // Hitung kecepatan rolling dari riwayat progress
  // Jika tidak ada progress baru selama 3 menit (stall/backoff), anggap speed = 0
  const SPEED_STALE_MS = 3 * 60_000;
  const isSpeedStale =
    extremeLastProgressAt === null ||
    (isExtremeRunning && Date.now() - extremeLastProgressAt > SPEED_STALE_MS);

  let speedQph = 0;
  if (!isSpeedStale && extremeProgressHistory.length >= 2) {
    const oldest = extremeProgressHistory[0];
    const newest = extremeProgressHistory[extremeProgressHistory.length - 1];
    const deltaCount = newest.count - oldest.count;
    const deltaMs = newest.ts - oldest.ts;
    if (deltaMs > 0 && deltaCount > 0) {
      speedQph = Math.round((deltaCount / deltaMs) * 3_600_000);
    }
  }
  const remaining = extremeTarget - extremeProgress;
  const etaMs: number | null = speedQph > 0 && remaining > 0
    ? Math.round((remaining / speedQph) * 3_600_000)
    : null;

  return {
    running: learningTimer !== null,
    lastCycleAt,
    totalCycles,
    totalInsights,
    isLearning,
    extremeMode: {
      active: isExtremeRunning,
      target: extremeTarget,
      progress: extremeProgress,
      insights: extremeInsightsTotal,
      cycles: extremeCycleCount,
      startedAt: extremeStartedAt,
      percentDone: extremeTarget > 0 ? Math.round((extremeProgress / extremeTarget) * 100) : 0,
      stopRequested: extremeStopRequested,
      speedQph,
      etaMs,
      dataMode: extremeDataMode,
    },
  };
}
