//+------------------------------------------------------------------+
//|  GoldRadar_QuantBot.mq5                                          |
//|  Expert Advisor — XAUUSD Quant Bot Signal Executor               |
//|  Terhubung ke API GoldRadar (bukan Mentor Mode)                  |
//|  Pilih brain: Technical / Fundamental / Macro / Ensemble         |
//|  Market Order langsung saat sinyal muncul, SL/TP dari sinyal     |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property link      "https://goldradar.ai"
#property version   "2.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>

//────────────────────────────────────────────────────────────────────
//  INPUT PARAMETERS
//────────────────────────────────────────────────────────────────────

// ── Koneksi ke Server ──────────────────────────────────────────────
input string   ServerURL    = "https://YOUR-REPLIT-URL.repl.co"; // URL server GoldRadar (tanpa slash akhir)
input string   EAApiKey     = "";                                  // EA API Key (generate di Admin → EA Key)

// ── Sumber Sinyal ──────────────────────────────────────────────────
enum BRAIN_SOURCE {
   BRAIN_ENSEMBLE   = 0, // Ensemble (gabungan 3 brain, bobot tertimbang) ← RECOMMENDED
   BRAIN_TECHNICAL  = 1, // Technical Brain saja (RSI, MACD, EMA, SMC)
   BRAIN_FUNDAMENTAL= 2, // Fundamental Brain saja (DXY, Yield, COT, TIPS)
   BRAIN_MACRO      = 3, // Macro Brain saja (Geopolitik, Fed, Bank Sentral)
};
input BRAIN_SOURCE BrainSource = BRAIN_ENSEMBLE; // Brain yang dipakai untuk sinyal

// ── Eksekusi Order ────────────────────────────────────────────────
input double   LotSize         = 0.01;  // Lot size (0.01 = micro lot)
input int      MagicNumber     = 20250713; // Magic number EA ini
input int      Slippage        = 30;    // Max slippage (points)
input bool     CloseOnHold     = true;  // Tutup posisi saat sinyal jadi HOLD
input bool     CloseOnReverse  = true;  // Tutup posisi lama saat sinyal berbalik arah
input double   MinConfidence   = 0.45;  // Minimum confidence (0.0-1.0) untuk eksekusi
input bool     OneTradeOnly    = true;  // Hanya 1 posisi aktif sekaligus

// ── Polling & Timing ──────────────────────────────────────────────
input int      PollSeconds     = 30;    // Interval polling API (detik, min 10)
input int      HttpTimeoutMs   = 15000; // Timeout HTTP request (ms)

// ── Logging ───────────────────────────────────────────────────────
input bool     VerboseLog      = true;  // Log detail di Journal MT5

//────────────────────────────────────────────────────────────────────
//  GLOBAL STATE
//────────────────────────────────────────────────────────────────────
CTrade         _trade;
CSymbolInfo    _sym;

string         _lastCommand  = "HOLD";  // Sinyal terakhir yang dieksekusi
long           _lastSignalId = -1;      // ID sinyal terakhir dari DB
double         _lastTP       = 0;
double         _lastSL       = 0;
datetime       _lastPollTime = 0;
int            _pollInterval = 30;
bool           _isReady      = false;

string         _brainName    = "ensemble";
string         _endpoint     = "";

//────────────────────────────────────────────────────────────────────
//  INIT
//────────────────────────────────────────────────────────────────────
int OnInit()
{
   if(ServerURL == "" || ServerURL == "https://YOUR-REPLIT-URL.repl.co") {
      Alert("[GoldRadar] ERROR: Isi ServerURL dengan URL server GoldRadar kamu!");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(EAApiKey == "") {
      Alert("[GoldRadar] ERROR: Isi EAApiKey! Generate key di Admin → EA Key.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(LotSize <= 0 || LotSize > 100) {
      Alert("[GoldRadar] ERROR: LotSize tidak valid (0.01 - 100)");
      return INIT_PARAMETERS_INCORRECT;
   }

   // Pilih nama brain
   switch(BrainSource) {
      case BRAIN_TECHNICAL:   _brainName = "technical";   break;
      case BRAIN_FUNDAMENTAL: _brainName = "fundamental"; break;
      case BRAIN_MACRO:       _brainName = "macro";       break;
      default:                _brainName = "ensemble";    break;
   }

   // Build endpoint URL
   string baseUrl = ServerURL;
   // Hapus trailing slash jika ada
   while(StringLen(baseUrl) > 0 && StringGetCharacter(baseUrl, StringLen(baseUrl)-1) == '/')
      baseUrl = StringSubstr(baseUrl, 0, StringLen(baseUrl)-1);
   _endpoint = baseUrl + "/api/quant/ea-signal?brain=" + _brainName + "&format=plain&key=" + EAApiKey;

   // Setup CTrade
   _trade.SetExpertMagicNumber(MagicNumber);
   _trade.SetDeviationInPoints(Slippage);
   _trade.SetTypeFilling(ORDER_FILLING_FOK);

   // Symbol info
   if(!_sym.Name(Symbol())) {
      Print("[GoldRadar] WARNING: Gagal inisialisasi SymbolInfo untuk ", Symbol());
   }
   _sym.RefreshRates();

   _pollInterval = MathMax(10, PollSeconds);
   _isReady      = true;

   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
   Print("[GoldRadar] ✅ EA Inisialisasi Berhasil");
   Print("[GoldRadar] Brain    : ", _brainName);
   Print("[GoldRadar] Symbol   : ", Symbol());
   Print("[GoldRadar] Lot Size : ", LotSize);
   Print("[GoldRadar] Magic    : ", MagicNumber);
   Print("[GoldRadar] Poll     : ", _pollInterval, " detik");
   Print("[GoldRadar] Min Conf : ", MinConfidence);
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   // Poll pertama langsung setelah 3 detik
   EventSetTimer(3);
   return INIT_SUCCEEDED;
}

//────────────────────────────────────────────────────────────────────
//  DEINIT
//────────────────────────────────────────────────────────────────────
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("[GoldRadar] EA dihentikan. Reason: ", reason);
}

//────────────────────────────────────────────────────────────────────
//  TIMER — polling utama
//────────────────────────────────────────────────────────────────────
void OnTimer()
{
   if(!_isReady) return;

   datetime now = TimeCurrent();
   if(now - _lastPollTime < _pollInterval) return;
   _lastPollTime = now;

   // Reset timer ke interval normal setelah poll pertama
   EventSetTimer(_pollInterval);

   PollAndExecute();
}

//────────────────────────────────────────────────────────────────────
//  TICK — update symbol info saja, eksekusi dari OnTimer
//────────────────────────────────────────────────────────────────────
void OnTick()
{
   _sym.RefreshRates();
}

//────────────────────────────────────────────────────────────────────
//  POLL API & EKSEKUSI SINYAL
//────────────────────────────────────────────────────────────────────
void PollAndExecute()
{
   if(VerboseLog)
      Print("[GoldRadar] 📡 Polling: ", _endpoint);

   // ── HTTP GET ke API ────────────────────────────────────────────
   char   postData[];
   char   responseData[];
   string responseHeaders;
   string headers = "Content-Type: application/json\r\nUser-Agent: GoldRadar-EA/2.0\r\n";

   int httpResult = WebRequest(
      "GET",
      _endpoint,
      headers,
      HttpTimeoutMs,
      postData,
      responseData,
      responseHeaders
   );

   if(httpResult == -1) {
      int err = GetLastError();
      Print("[GoldRadar] ❌ WebRequest gagal. Error: ", err,
            " — Pastikan URL benar dan MT5 diizinkan akses URL ini di Tools → Options → Expert Advisors.");
      return;
   }

   if(httpResult != 200) {
      string body = CharArrayToString(responseData);
      Print("[GoldRadar] ⚠️ HTTP ", httpResult, " dari server. Response: ", StringSubstr(body, 0, 200));
      return;
   }

   // ── Parse plain format: COMMAND|ENTRY|TP|SL|CONFIDENCE|SIGNAL_ID ──
   string raw = CharArrayToString(responseData);
   raw = StringTrimRight(StringTrimLeft(raw));

   if(VerboseLog)
      Print("[GoldRadar] 📥 Response: ", raw);

   string parts[];
   int partCount = StringSplit(raw, '|', parts);

   if(partCount < 6) {
      Print("[GoldRadar] ⚠️ Format response tidak valid: ", raw);
      return;
   }

   string command    = parts[0];   // BUY | SELL | HOLD
   double entryPrice = StringToDouble(parts[1]);
   double tp         = StringToDouble(parts[2]);
   double sl         = StringToDouble(parts[3]);
   double confidence = StringToDouble(parts[4]);
   long   signalId   = StringToInteger(parts[5]);

   // ── Validasi nilai ─────────────────────────────────────────────
   if(command != "BUY" && command != "SELL" && command != "HOLD") {
      Print("[GoldRadar] ⚠️ Command tidak dikenal: ", command);
      return;
   }

   // ── Cek apakah sinyal baru ─────────────────────────────────────
   // Sinyal baru = SIGNAL_ID berubah (ID DB berbeda = prediksi baru dibuat)
   bool isNewSignal = (signalId != _lastSignalId);

   if(!isNewSignal) {
      if(VerboseLog)
         Print("[GoldRadar] ℹ️ Sinyal sama (ID ", signalId, " ", command, ") — tidak ada aksi.");
      return;
   }

   Print("[GoldRadar] 🆕 SINYAL BARU │ Brain:", _brainName,
         " │ ", command,
         " │ Entry:", DoubleToString(entryPrice, 2),
         " │ TP:", DoubleToString(tp, 2),
         " │ SL:", DoubleToString(sl, 2),
         " │ Conf:", DoubleToString(confidence * 100, 1), "%",
         " │ ID:", signalId);

   // ── Cek minimum confidence ─────────────────────────────────────
   if(command != "HOLD" && confidence < MinConfidence) {
      Print("[GoldRadar] 🚫 Confidence ", DoubleToString(confidence * 100, 1), "% < minimum ",
            DoubleToString(MinConfidence * 100, 1), "% — sinyal diabaikan.");
      _lastSignalId = signalId; // Update ID tetapi jangan eksekusi
      _lastCommand  = command;
      return;
   }

   // ── Proses sinyal ─────────────────────────────────────────────
   if(command == "HOLD") {
      _lastSignalId = signalId;
      _lastCommand  = "HOLD";
      if(CloseOnHold) {
         Print("[GoldRadar] 🔄 Sinyal HOLD — menutup semua posisi EA ini.");
         CloseAllPositions("HOLD signal dari " + _brainName + " brain");
      } else {
         Print("[GoldRadar] ℹ️ Sinyal HOLD — posisi dibiarkan (CloseOnHold=false).");
      }
      return;
   }

   // BUY atau SELL
   bool hasBuy  = CountPositions(POSITION_TYPE_BUY)  > 0;
   bool hasSell = CountPositions(POSITION_TYPE_SELL) > 0;

   // Tutup posisi berlawanan jika CloseOnReverse=true
   if(command == "BUY" && hasSell && CloseOnReverse) {
      Print("[GoldRadar] 🔄 Sinyal BUY — menutup posisi SELL yang ada.");
      CloseAllPositions("Reverse BUY dari " + _brainName);
      hasSell = false;
   }
   if(command == "SELL" && hasBuy && CloseOnReverse) {
      Print("[GoldRadar] 🔄 Sinyal SELL — menutup posisi BUY yang ada.");
      CloseAllPositions("Reverse SELL dari " + _brainName);
      hasBuy = false;
   }

   // Cek one-trade-only
   if(OneTradeOnly) {
      bool alreadyInTrade = (command == "BUY" && hasBuy) || (command == "SELL" && hasSell);
      if(alreadyInTrade) {
         Print("[GoldRadar] ℹ️ Sudah ada posisi ", command, " aktif — tidak buka yang baru (OneTradeOnly=true).");
         _lastSignalId = signalId;
         _lastCommand  = command;
         return;
      }
   }

   // ── Sesuaikan TP/SL ke digits broker ──────────────────────────
   _sym.RefreshRates();
   int digits = (int)_sym.Digits();

   double askPrice = _sym.Ask();
   double bidPrice = _sym.Bid();

   // Gunakan harga pasar saat ini (market order), bukan entryPrice dari sinyal
   // (entryPrice dari sinyal adalah harga saat AI buat prediksi, sudah bergeser)
   double execPrice = (command == "BUY") ? askPrice : bidPrice;

   // Normalisasi TP dan SL ke digits broker
   tp = NormalizeDouble(tp, digits);
   sl = NormalizeDouble(sl, digits);

   // Validasi TP/SL minimum distance
   long   stopLevelPts = _sym.StopsLevel();
   double stopLevelPrice = stopLevelPts * _sym.Point();
   double minTPDist = stopLevelPrice + _sym.Spread() * _sym.Point() * 2;

   bool tpValid = false, slValid = false;

   if(command == "BUY") {
      tpValid = (tp > execPrice + minTPDist);
      slValid = (sl < execPrice - minTPDist);
   } else {
      tpValid = (tp < execPrice - minTPDist);
      slValid = (sl > execPrice + minTPDist);
   }

   if(!tpValid || !slValid) {
      Print("[GoldRadar] ⚠️ TP/SL terlalu dekat dengan harga pasar saat ini!");
      Print("  Harga eksekusi : ", DoubleToString(execPrice, digits));
      Print("  TP dari sinyal : ", DoubleToString(tp, digits), tpValid ? " ✓" : " ✗ (terlalu dekat)");
      Print("  SL dari sinyal : ", DoubleToString(sl, digits), slValid ? " ✓" : " ✗ (terlalu dekat)");
      Print("  Min distance   : ", DoubleToString(minTPDist, digits));
      Print("[GoldRadar] 🚫 Order dibatalkan — tunggu sinyal berikutnya.");
      // Tetap update ID agar tidak loop terus di sinyal yang sama
      _lastSignalId = signalId;
      _lastCommand  = command;
      return;
   }

   // ── Eksekusi Market Order ──────────────────────────────────────
   string comment = "GR_" + _brainName + "_" + IntegerToString(signalId);

   bool orderSent = false;
   if(command == "BUY") {
      orderSent = _trade.Buy(LotSize, Symbol(), 0, sl, tp, comment);
   } else {
      orderSent = _trade.Sell(LotSize, Symbol(), 0, sl, tp, comment);
   }

   if(!orderSent) {
      int tradeErr = (int)_trade.ResultRetcode();
      Print("[GoldRadar] ❌ Order GAGAL! Retcode: ", tradeErr,
            " (", _trade.ResultRetcodeDescription(), ")");
      Print("[GoldRadar]    Lot=", LotSize, " SL=", sl, " TP=", tp);
      return;
   }

   // ── Sukses! ────────────────────────────────────────────────────
   ulong ticket = _trade.ResultOrder();
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
   Print("[GoldRadar] ✅ ORDER BERHASIL!");
   Print("  Ticket    : #", ticket);
   Print("  Command   : ", command);
   Print("  Brain     : ", _brainName);
   Print("  Signal ID : ", signalId);
   Print("  Lot       : ", LotSize);
   Print("  Exec Price: ", DoubleToString(_trade.ResultPrice(), digits));
   Print("  TP        : ", DoubleToString(tp, digits));
   Print("  SL        : ", DoubleToString(sl, digits));
   Print("  Confidence: ", DoubleToString(confidence * 100, 1), "%");
   Print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

   _lastSignalId = signalId;
   _lastCommand  = command;
   _lastTP       = tp;
   _lastSL       = sl;
}

//────────────────────────────────────────────────────────────────────
//  HELPER — Hitung posisi EA aktif berdasarkan magic number
//────────────────────────────────────────────────────────────────────
int CountPositions(ENUM_POSITION_TYPE posType)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == posType) count++;
   }
   return count;
}

//────────────────────────────────────────────────────────────────────
//  HELPER — Tutup semua posisi EA di symbol ini
//────────────────────────────────────────────────────────────────────
void CloseAllPositions(string reason = "")
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      bool closed = _trade.PositionClose(ticket, Slippage);
      if(closed) {
         Print("[GoldRadar] 🔒 Posisi #", ticket, " ditutup",
               (reason != "" ? " — " + reason : ""),
               " | PnL: ", DoubleToString(PositionGetDouble(POSITION_PROFIT), 2), " USD");
      } else {
         Print("[GoldRadar] ⚠️ Gagal tutup posisi #", ticket, " Error: ", _trade.ResultRetcode());
      }
   }
}
//+------------------------------------------------------------------+
