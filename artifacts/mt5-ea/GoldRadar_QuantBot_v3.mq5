//+------------------------------------------------------------------+
//|  GoldRadar_QuantBot_v3.mq5                                       |
//|  Expert Advisor — XAUUSD Quant Bot Pro (3-Brain + Council)       |
//|  Fitur baru v3:                                                   |
//|    • Risk-based lot sizing (% balance per SL distance)           |
//|    • Partial close 50% di TP1, SL geser ke breakeven             |
//|    • Trailing stop ATR-based setelah TP1                         |
//|    • Filter sesi trading (London / New York)                     |
//|    • Filter spread maksimum                                       |
//|    • Konfirmasi minimum brain (≥ N brain setuju)                 |
//|    • Dashboard on-chart (sinyal, confidence, PnL, votes)         |
//|  Endpoint: GET /api/quant/ea-signal?brain=ensemble&format=json   |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property link      "https://goldradar.ai"
#property version   "3.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>

//════════════════════════════════════════════════════════════════════
//  INPUT PARAMETERS
//════════════════════════════════════════════════════════════════════

// ── Koneksi Server ─────────────────────────────────────────────────
input group "=== KONEKSI SERVER ==="
input string   ServerURL       = "https://YOUR-REPLIT-URL.repl.co"; // URL server GoldRadar (tanpa slash akhir)
input string   EAApiKey        = "";                                  // EA API Key (generate di Admin → EA Key)

// ── Sumber Sinyal ──────────────────────────────────────────────────
input group "=== SUMBER SINYAL ==="
enum BRAIN_SOURCE {
   BRAIN_ENSEMBLE    = 0, // Ensemble (gabungan 3 brain, bobot tertimbang) ← RECOMMENDED
   BRAIN_TECHNICAL   = 1, // Technical Brain saja
   BRAIN_FUNDAMENTAL = 2, // Fundamental Brain saja
   BRAIN_MACRO       = 3, // Macro Brain saja
};
input BRAIN_SOURCE BrainSource      = BRAIN_ENSEMBLE; // Brain sinyal
input double       MinConfidence    = 0.50;           // Min confidence untuk eksekusi (0.0–1.0)
input int          MinBrainsAgree   = 2;              // Min brain setuju (hanya berlaku untuk Ensemble, 1–3)

// ── Manajemen Risiko ──────────────────────────────────────────────
input group "=== MANAJEMEN RISIKO ==="
input bool     UseRiskPercent   = true;   // true = lot otomatis dari % balance; false = lot tetap
input double   RiskPercent      = 1.0;    // Risiko per trade (% balance) — aktif jika UseRiskPercent=true
input double   FixedLotSize     = 0.01;   // Lot tetap — aktif jika UseRiskPercent=false
input double   MaxLotSize       = 5.0;    // Batas atas lot (safeguard)
input double   MinLotSize       = 0.01;   // Batas bawah lot

// ── Partial Close & Trailing ──────────────────────────────────────
input group "=== PARTIAL CLOSE & TRAILING ==="
input bool     EnablePartialClose = true;  // Partial close 50% saat TP1 tercapai
input double   PartialClosePct    = 50.0;  // Persentase volume yang ditutup saat TP1 (%)
input bool     MoveSlToBreakeven  = true;  // Geser SL ke harga masuk setelah partial close
input bool     EnableTrailing     = true;  // Trailing stop ATR-based setelah TP1
input int      TrailingAtrPeriod  = 14;    // Periode ATR untuk trailing (bar H1)
input double   TrailingAtrMult    = 1.5;   // Multiplier ATR untuk jarak trailing

// ── Filter Sesi ───────────────────────────────────────────────────
input group "=== FILTER SESI ==="
input bool     EnableSessionFilter = true;  // Aktifkan filter sesi trading
input bool     TradeLondon         = true;  // Boleh masuk saat Sesi London (07:00–16:00 GMT)
input bool     TradeNewYork        = true;  // Boleh masuk saat Sesi New York (13:00–21:00 GMT)
input bool     TradeAsia           = false; // Boleh masuk saat Sesi Asia (00:00–08:00 GMT)

// ── Filter Spread ─────────────────────────────────────────────────
input group "=== FILTER SPREAD ==="
input bool     EnableSpreadFilter  = true;  // Aktifkan filter spread
input double   MaxSpreadPips       = 5.0;   // Spread maksimum yang diizinkan (pip)

// ── Eksekusi Order ────────────────────────────────────────────────
input group "=== EKSEKUSI ORDER ==="
input int      MagicNumber      = 20250713; // Magic number EA ini
input int      Slippage         = 30;       // Max slippage (points)
input bool     CloseOnHold      = true;     // Tutup posisi saat sinyal jadi HOLD
input bool     CloseOnReverse   = true;     // Tutup posisi lama saat sinyal berbalik
input bool     OneTradeOnly     = true;     // Hanya 1 posisi aktif sekaligus

// ── Polling & Timing ──────────────────────────────────────────────
input group "=== POLLING & TIMING ==="
input int      PollSeconds      = 30;    // Interval polling API (detik, min 10)
input int      HttpTimeoutMs    = 15000; // Timeout HTTP request (ms)

// ── Tampilan ──────────────────────────────────────────────────────
input group "=== TAMPILAN DASHBOARD ==="
input bool     ShowDashboard    = true;  // Tampilkan dashboard on-chart
input color    DashColor        = clrWhiteSmoke; // Warna teks dashboard
input color    BuyColor         = C'0,200,100';  // Warna BUY
input color    SellColor        = C'220,60,60';  // Warna SELL
input color    HoldColor        = clrGray;        // Warna HOLD
input bool     VerboseLog       = true;           // Log detail di Journal

//════════════════════════════════════════════════════════════════════
//  GLOBAL STATE
//════════════════════════════════════════════════════════════════════
CTrade      _trade;
CSymbolInfo _sym;

string   _lastCommand    = "HOLD";
long     _lastSignalId   = -1;
double   _lastEntry      = 0;
double   _lastTP1        = 0;
double   _lastTP2        = 0;
double   _lastSL         = 0;
double   _lastConf       = 0;
bool     _partialDone    = false;  // Sudah partial close untuk posisi ini?
datetime _lastPollTime   = 0;
int      _pollInterval   = 30;
bool     _isReady        = false;
string   _brainName      = "ensemble";
string   _endpoint       = "";
int      _atrHandle      = INVALID_HANDLE;

// Dashboard label names
string LBL_PREFIX = "GR3_";

//════════════════════════════════════════════════════════════════════
//  INIT
//════════════════════════════════════════════════════════════════════
int OnInit()
{
   if(StringFind(ServerURL, "YOUR-REPLIT-URL") >= 0) {
      Alert("[GoldRadar v3] ERROR: Isi ServerURL dengan URL server GoldRadar kamu!");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(EAApiKey == "") {
      Alert("[GoldRadar v3] ERROR: Isi EAApiKey! Generate key di Admin → EA Key.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(MinConfidence < 0 || MinConfidence > 1) {
      Alert("[GoldRadar v3] ERROR: MinConfidence harus antara 0.0 dan 1.0");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(MinBrainsAgree < 1 || MinBrainsAgree > 3) {
      Alert("[GoldRadar v3] ERROR: MinBrainsAgree harus 1, 2, atau 3");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(RiskPercent <= 0 || RiskPercent > 20) {
      Alert("[GoldRadar v3] ERROR: RiskPercent harus 0.1–20%");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(PartialClosePct <= 0 || PartialClosePct >= 100) {
      Alert("[GoldRadar v3] ERROR: PartialClosePct harus antara 1–99");
      return INIT_PARAMETERS_INCORRECT;
   }

   // Pilih brain name
   switch(BrainSource) {
      case BRAIN_TECHNICAL:    _brainName = "technical";    break;
      case BRAIN_FUNDAMENTAL:  _brainName = "fundamental";  break;
      case BRAIN_MACRO:        _brainName = "macro";        break;
      default:                 _brainName = "ensemble";     break;
   }

   // Build endpoint (format=json untuk mendapat semua field termasuk brain votes + tp2)
   string baseUrl = ServerURL;
   if(StringRight(baseUrl, 1) == "/")
      baseUrl = StringSubstr(baseUrl, 0, StringLen(baseUrl) - 1);
   _endpoint = baseUrl + "/api/quant/ea-signal?brain=" + _brainName
               + "&format=json&key=" + EAApiKey;

   // Setup ATR handle (H1 chart)
   _atrHandle = iATR(Symbol(), PERIOD_H1, TrailingAtrPeriod);
   if(_atrHandle == INVALID_HANDLE && EnableTrailing) {
      Print("[GoldRadar v3] ⚠️ Gagal buat ATR handle — trailing dinonaktifkan");
   }

   // Trade setup
   _trade.SetExpertMagicNumber(MagicNumber);
   _trade.SetDeviationInPoints(Slippage);
   _trade.SetTypeFilling(ORDER_FILLING_IOC);
   _trade.LogLevel(LOG_LEVEL_ERRORS);

   _sym.Name(Symbol());
   _sym.RefreshRates();

   _pollInterval = MathMax(10, PollSeconds);

   // Init dashboard
   if(ShowDashboard) CreateDashboard();

   Print("╔══════════════════════════════════════════════╗");
   Print("║   GoldRadar.ai — QuantBot Pro v3.00          ║");
   Print("╠══════════════════════════════════════════════╣");
   Print("║ Brain      : ", _brainName);
   Print("║ Risk       : ", (UseRiskPercent ? DoubleToString(RiskPercent, 1) + "% balance" : DoubleToString(FixedLotSize, 2) + " lot tetap"));
   Print("║ Min Conf   : ", DoubleToString(MinConfidence * 100, 0), "%");
   Print("║ Min Brains : ", MinBrainsAgree);
   Print("║ Partial    : ", (EnablePartialClose ? DoubleToString(PartialClosePct, 0) + "% di TP1" : "Nonaktif"));
   Print("║ Trailing   : ", (EnableTrailing ? "ATR(" + IntegerToString(TrailingAtrPeriod) + ") x " + DoubleToString(TrailingAtrMult, 1) : "Nonaktif"));
   Print("║ Session    : ", BuildSessionString());
   Print("║ Spread Max : ", (EnableSpreadFilter ? DoubleToString(MaxSpreadPips, 1) + " pips" : "Nonaktif"));
   Print("╚══════════════════════════════════════════════╝");

   EventSetTimer(_pollInterval);
   _isReady = true;
   return INIT_SUCCEEDED;
}

//════════════════════════════════════════════════════════════════════
//  DEINIT
//════════════════════════════════════════════════════════════════════
void OnDeinit(const int reason)
{
   EventKillTimer();
   if(_atrHandle != INVALID_HANDLE) IndicatorRelease(_atrHandle);
   DeleteDashboard();
   Print("[GoldRadar v3] EA dinonaktifkan. Alasan: ", reason);
}

//════════════════════════════════════════════════════════════════════
//  TIMER — logika utama
//════════════════════════════════════════════════════════════════════
void OnTimer()
{
   if(!_isReady) return;

   _sym.RefreshRates();

   // ── Trailing stop untuk posisi yang sudah partial close ────────
   if(EnableTrailing && _partialDone)
      ManageTrailing();

   // ── Cek TP1 partial close untuk posisi aktif ──────────────────
   if(EnablePartialClose && !_partialDone)
      CheckPartialClose();

   // ── Poll API ──────────────────────────────────────────────────
   datetime now = TimeCurrent();
   if(now - _lastPollTime < _pollInterval) {
      if(ShowDashboard) UpdateDashboard("", "", 0, "", "", "");
      return;
   }
   _lastPollTime = now;

   if(VerboseLog)
      Print("[GoldRadar v3] 📡 Polling: ", _endpoint);

   string response = "";
   int code = MakeHttpGet(_endpoint, response);
   if(code != 200) {
      Print("[GoldRadar v3] ⚠️ HTTP ", code, " — retry berikutnya dalam ", _pollInterval, "s");
      if(ShowDashboard) UpdateDashboard("HTTP " + IntegerToString(code), "ERR", 0, "-", "-", "-");
      return;
   }

   ProcessSignal(response);
}

//════════════════════════════════════════════════════════════════════
//  TICK — update harga real-time di dashboard
//════════════════════════════════════════════════════════════════════
void OnTick()
{
   if(!_isReady || !ShowDashboard) return;
   _sym.RefreshRates();
   // Hitung PnL floating
   double pnl = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      pnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   UpdatePnlLabel(pnl);
}

//════════════════════════════════════════════════════════════════════
//  PROSES SINYAL dari JSON response API
//════════════════════════════════════════════════════════════════════
void ProcessSignal(const string &json)
{
   // Parse field dari JSON (manual parsing ringan tanpa library)
   string command  = ParseJsonString(json, "command");
   string brainKey = ParseJsonString(json, "brain");
   long   signalId = (long)ParseJsonLong(json, "signalId");
   double entry    = ParseJsonDouble(json, "entryPrice");
   double tp1      = ParseJsonDouble(json, "tp");
   double tp2      = ParseJsonDouble(json, "tp2");
   double sl       = ParseJsonDouble(json, "sl");
   double conf     = ParseJsonDouble(json, "confidence");
   string techVote = ParseJsonString(json, "technicalVote");
   string fundVote = ParseJsonString(json, "fundamentalVote");
   string macroVote= ParseJsonString(json, "macroVote");
   string regime   = ParseJsonString(json, "regime");
   string session  = ParseJsonString(json, "session");

   if(command == "") {
      Print("[GoldRadar v3] ⚠️ Gagal parse JSON response");
      return;
   }

   // Update dashboard
   if(ShowDashboard)
      UpdateDashboard(command, brainKey, conf, techVote, fundVote, macroVote);

   if(VerboseLog)
      Print("[GoldRadar v3] Sinyal: ", command, " | Conf: ",
            DoubleToString(conf * 100, 1), "% | ID: ", signalId,
            " | TP1: ", DoubleToString(tp1, _sym.Digits()),
            " | TP2: ", DoubleToString(tp2, _sym.Digits()),
            " | SL: ", DoubleToString(sl, _sym.Digits()),
            " | Votes: T=", techVote, " F=", fundVote, " M=", macroVote);

   // ── Sinyal sama, ID belum berubah → hanya update dashboard ───
   if(signalId == _lastSignalId && command == _lastCommand) return;

   // ── HOLD: tutup posisi jika diaktifkan ────────────────────────
   if(command == "HOLD") {
      _lastCommand = "HOLD";
      _lastSignalId = signalId;
      if(CloseOnHold && HasOpenPosition()) {
         Print("[GoldRadar v3] 🔄 HOLD — menutup posisi aktif");
         CloseAllPositions("HOLD signal");
      }
      return;
   }

   // ── Validasi confidence ───────────────────────────────────────
   if(conf < MinConfidence) {
      Print("[GoldRadar v3] ⚡ Sinyal ", command, " diabaikan — confidence ",
            DoubleToString(conf * 100, 1), "% < min ", DoubleToString(MinConfidence * 100, 0), "%");
      _lastSignalId = signalId;
      return;
   }

   // ── Validasi minimum brain (hanya untuk ensemble) ─────────────
   if(_brainName == "ensemble" && MinBrainsAgree > 1) {
      int agree = 0;
      if(techVote  == command) agree++;
      if(fundVote  == command) agree++;
      if(macroVote == command) agree++;
      if(agree < MinBrainsAgree) {
         Print("[GoldRadar v3] ⚡ Sinyal ", command, " diabaikan — hanya ", agree,
               "/3 brain setuju (min ", MinBrainsAgree, ")");
         _lastSignalId = signalId;
         return;
      }
   }

   // ── Filter sesi ───────────────────────────────────────────────
   if(EnableSessionFilter && !IsAllowedSession()) {
      Print("[GoldRadar v3] ⏰ Sesi tidak diizinkan — lewati sinyal ", command);
      _lastSignalId = signalId;
      return;
   }

   // ── Filter spread ─────────────────────────────────────────────
   if(EnableSpreadFilter) {
      double spreadPips = GetCurrentSpreadPips();
      if(spreadPips > MaxSpreadPips) {
         Print("[GoldRadar v3] 📊 Spread ", DoubleToString(spreadPips, 1),
               " pip terlalu lebar (max ", DoubleToString(MaxSpreadPips, 1), " pip) — lewati");
         _lastSignalId = signalId;
         return;
      }
   }

   // ── Tutup posisi berlawanan ───────────────────────────────────
   if(CloseOnReverse && HasOpenPosition()) {
      ENUM_POSITION_TYPE posType = GetOpenPositionType();
      bool isReverse = (command == "BUY"  && posType == POSITION_TYPE_SELL) ||
                       (command == "SELL" && posType == POSITION_TYPE_BUY);
      if(isReverse) {
         Print("[GoldRadar v3] 🔄 Reverse signal — tutup posisi ", (posType == POSITION_TYPE_BUY ? "BUY" : "SELL"));
         CloseAllPositions("Reverse ke " + command);
      }
   }

   // ── Jika OneTradeOnly dan masih ada posisi → skip ─────────────
   if(OneTradeOnly && HasOpenPosition()) {
      if(VerboseLog)
         Print("[GoldRadar v3] ℹ️ Posisi masih aktif, OneTradeOnly=true — skip entry baru");
      _lastSignalId = signalId;
      _lastCommand  = command;
      return;
   }

   // ── Validasi level SL/TP ──────────────────────────────────────
   if(sl == 0 || tp1 == 0) {
      Print("[GoldRadar v3] ⚠️ SL atau TP1 = 0 dari API — sinyal dilewati");
      _lastSignalId = signalId;
      return;
   }

   // ── Hitung lot ────────────────────────────────────────────────
   double lot = CalcLotSize(command, entry, sl);
   if(lot <= 0) {
      Print("[GoldRadar v3] ⚠️ Lot tidak valid (", lot, ") — sinyal dilewati");
      _lastSignalId = signalId;
      return;
   }

   // ── Eksekusi order ────────────────────────────────────────────
   ExecuteOrder(command, lot, tp1, sl, signalId, conf);

   // Update state
   _lastSignalId  = signalId;
   _lastCommand   = command;
   _lastEntry     = entry;
   _lastTP1       = tp1;
   _lastTP2       = (tp2 > 0 ? tp2 : 0);
   _lastSL        = sl;
   _lastConf      = conf;
   _partialDone   = false;
}

//════════════════════════════════════════════════════════════════════
//  EKSEKUSI ORDER
//════════════════════════════════════════════════════════════════════
void ExecuteOrder(const string command, const double lot,
                  const double tp, const double sl,
                  const long signalId, const double confidence)
{
   _sym.RefreshRates();
   int    digits  = (int)_sym.Digits();
   double askPrice = _sym.Ask();
   double bidPrice = _sym.Bid();
   double normTp   = NormalizeDouble(tp, digits);
   double normSl   = NormalizeDouble(sl, digits);

   string comment = "GR3_" + _brainName + "_" + IntegerToString((int)signalId);
   bool   ok      = false;

   if(command == "BUY") {
      ok = _trade.Buy(lot, Symbol(), askPrice, normSl, normTp, comment);
   } else if(command == "SELL") {
      ok = _trade.Sell(lot, Symbol(), bidPrice, normSl, normTp, comment);
   }

   if(!ok) {
      Print("[GoldRadar v3] ❌ Order gagal! Retcode: ", _trade.ResultRetcode(),
            " — ", _trade.ResultRetcodeDescription());
      return;
   }

   Print("┌─────────────────────────────────────────────────┐");
   Print("│  GoldRadar v3 ✅ ORDER MASUK                    │");
   Print("├─────────────────────────────────────────────────┤");
   Print("│  Signal   : ", command, " | ID: ", signalId);
   Print("│  Lot      : ", DoubleToString(lot, 2));
   Print("│  Masuk    : ", DoubleToString(_trade.ResultPrice(), digits));
   Print("│  TP1      : ", DoubleToString(normTp, digits));
   Print("│  TP2      : ", (_lastTP2 > 0 ? DoubleToString(_lastTP2, digits) : "N/A"));
   Print("│  SL       : ", DoubleToString(normSl, digits));
   Print("│  Conf     : ", DoubleToString(confidence * 100, 1), "%");
   Print("│  Brain    : ", _brainName);
   Print("└─────────────────────────────────────────────────┘");
}

//════════════════════════════════════════════════════════════════════
//  PARTIAL CLOSE — cek apakah TP1 sudah tercapai
//════════════════════════════════════════════════════════════════════
void CheckPartialClose()
{
   if(!EnablePartialClose) return;
   if(_lastTP1 <= 0) return;

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double curPrice = (posType == POSITION_TYPE_BUY) ? _sym.Bid() : _sym.Ask();
      bool   tp1Hit   = (posType == POSITION_TYPE_BUY  && curPrice >= _lastTP1) ||
                        (posType == POSITION_TYPE_SELL && curPrice <= _lastTP1);

      if(!tp1Hit) continue;

      // Partial close
      double volTotal = PositionGetDouble(POSITION_VOLUME);
      double volClose = NormalizeDouble(volTotal * PartialClosePct / 100.0,
                                       (int)SymbolInfoInteger(Symbol(), SYMBOL_VOLUME_STEP_DIGITS));
      volClose = MathMax(volClose, SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_MIN));
      volClose = MathMin(volClose, volTotal);

      bool closed = _trade.PositionClosePartial(ticket, volClose, Slippage);
      if(closed) {
         Print("[GoldRadar v3] 🎯 TP1 HIT! Partial close ", DoubleToString(PartialClosePct, 0),
               "% (", DoubleToString(volClose, 2), " lot) @ ", DoubleToString(curPrice, _sym.Digits()));

         // Geser SL ke breakeven
         if(MoveSlToBreakeven && _lastEntry > 0) {
            double beSlPrice = NormalizeDouble(_lastEntry, _sym.Digits());
            // Tambah buffer 1 pip supaya tidak kena BE tepat di harga masuk
            double pipSize = _sym.Point() * 10;
            if(posType == POSITION_TYPE_BUY)
               beSlPrice += pipSize;
            else
               beSlPrice -= pipSize;

            // Cek SL baru lebih baik dari SL lama
            bool slImproved = (posType == POSITION_TYPE_BUY  && beSlPrice > _lastSL) ||
                              (posType == POSITION_TYPE_SELL && beSlPrice < _lastSL);
            if(slImproved) {
               double curTp = PositionGetDouble(POSITION_TP);
               // Set TP ke TP2 jika ada, pertahankan jika tidak
               double newTp = (_lastTP2 > 0) ? NormalizeDouble(_lastTP2, _sym.Digits()) : curTp;
               bool modified = _trade.PositionModify(ticket, beSlPrice, newTp);
               if(modified) {
                  Print("[GoldRadar v3] 🔒 SL geser ke breakeven: ", DoubleToString(beSlPrice, _sym.Digits()),
                        " | TP update ke TP2: ", DoubleToString(newTp, _sym.Digits()));
                  _lastSL = beSlPrice;
               }
            }
         }
         _partialDone = true;
      } else {
         Print("[GoldRadar v3] ⚠️ Partial close gagal — retcode: ", _trade.ResultRetcode());
      }
   }
}

//════════════════════════════════════════════════════════════════════
//  TRAILING STOP — ATR-based (aktif setelah partial close)
//════════════════════════════════════════════════════════════════════
void ManageTrailing()
{
   if(!EnableTrailing || _atrHandle == INVALID_HANDLE) return;

   double atrBuf[];
   if(CopyBuffer(_atrHandle, 0, 0, 1, atrBuf) < 1) return;
   double atrDist = atrBuf[0] * TrailingAtrMult;

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;

      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double curSl  = PositionGetDouble(POSITION_SL);
      double curTp  = PositionGetDouble(POSITION_TP);
      double newSl  = 0;

      if(posType == POSITION_TYPE_BUY) {
         newSl = NormalizeDouble(_sym.Bid() - atrDist, _sym.Digits());
         if(newSl <= curSl) continue; // Hanya naikkan SL
      } else {
         newSl = NormalizeDouble(_sym.Ask() + atrDist, _sym.Digits());
         if(newSl >= curSl || curSl == 0) continue; // Hanya turunkan SL
      }

      bool modified = _trade.PositionModify(ticket, newSl, curTp);
      if(modified && VerboseLog)
         Print("[GoldRadar v3] 🔄 Trailing SL → ", DoubleToString(newSl, _sym.Digits()),
               " (ATR dist: ", DoubleToString(atrDist, _sym.Digits()), ")");
   }
}

//════════════════════════════════════════════════════════════════════
//  HELPER — Hitung lot dari % risiko
//════════════════════════════════════════════════════════════════════
double CalcLotSize(const string command, const double entry, const double sl)
{
   if(!UseRiskPercent) {
      double lot = NormalizeDouble(FixedLotSize, 2);
      return MathMax(MinLotSize, MathMin(MaxLotSize, lot));
   }

   double balance     = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmt     = balance * RiskPercent / 100.0;
   double slPoints    = MathAbs(entry - sl) / _sym.Point();
   if(slPoints < 1) {
      Print("[GoldRadar v3] ⚠️ SL distance terlalu kecil (", slPoints, " points) — pakai lot minimum");
      return MinLotSize;
   }
   double tickValue   = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_VALUE);
   double tickSize    = SymbolInfoDouble(Symbol(), SYMBOL_TRADE_TICK_SIZE);
   double lotStep     = SymbolInfoDouble(Symbol(), SYMBOL_VOLUME_STEP);
   if(tickSize == 0 || tickValue == 0) return MinLotSize;

   double slValue1Lot = (slPoints * _sym.Point() / tickSize) * tickValue;
   if(slValue1Lot == 0) return MinLotSize;

   double rawLot = riskAmt / slValue1Lot;
   rawLot = MathFloor(rawLot / lotStep) * lotStep;
   rawLot = NormalizeDouble(rawLot, 2);
   rawLot = MathMax(MinLotSize, MathMin(MaxLotSize, rawLot));

   if(VerboseLog)
      Print("[GoldRadar v3] 💰 Lot calc: balance=", DoubleToString(balance, 2),
            " risk=", DoubleToString(riskAmt, 2), " slPts=", DoubleToString(slPoints, 1),
            " slVal1Lot=", DoubleToString(slValue1Lot, 4),
            " → lot=", DoubleToString(rawLot, 2));
   return rawLot;
}

//════════════════════════════════════════════════════════════════════
//  HELPER — Filter Sesi
//════════════════════════════════════════════════════════════════════
bool IsAllowedSession()
{
   datetime now  = TimeGMT();
   MqlDateTime dt;
   TimeToStruct(now, dt);
   int h = dt.hour;

   bool london  = (h >= 7  && h < 16);
   bool newyork = (h >= 13 && h < 21);
   bool asia    = (h >= 0  && h < 8) || h == 23;

   if(TradeLondon  && london)  return true;
   if(TradeNewYork && newyork) return true;
   if(TradeAsia    && asia)    return true;
   return false;
}

string BuildSessionString()
{
   string s = "";
   if(TradeLondon)  s += "London ";
   if(TradeNewYork) s += "NewYork ";
   if(TradeAsia)    s += "Asia";
   if(s == "")      s = "Semua (filter mati)";
   return s;
}

//════════════════════════════════════════════════════════════════════
//  HELPER — Spread dalam pips
//════════════════════════════════════════════════════════════════════
double GetCurrentSpreadPips()
{
   _sym.RefreshRates();
   double spread = _sym.Ask() - _sym.Bid();
   double pipSize = _sym.Point() * 10;
   return spread / pipSize;
}

//════════════════════════════════════════════════════════════════════
//  HELPER — Cek / hitung posisi terbuka
//════════════════════════════════════════════════════════════════════
bool HasOpenPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      return true;
   }
   return false;
}

ENUM_POSITION_TYPE GetOpenPositionType()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      return (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   }
   return (ENUM_POSITION_TYPE)-1;
}

void CloseAllPositions(const string reason = "")
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      double pnl = PositionGetDouble(POSITION_PROFIT);
      bool closed = _trade.PositionClose(ticket, Slippage);
      if(closed)
         Print("[GoldRadar v3] 🔒 Tutup posisi #", ticket,
               (reason != "" ? " — " + reason : ""),
               " | PnL: ", DoubleToString(pnl, 2), " USD");
      else
         Print("[GoldRadar v3] ⚠️ Gagal tutup #", ticket, " — ", _trade.ResultRetcode());
   }
   _partialDone = false;
}

//════════════════════════════════════════════════════════════════════
//  HTTP GET (WebRequest)
//════════════════════════════════════════════════════════════════════
int MakeHttpGet(const string url, string &response)
{
   uchar data[], result[];
   string headers = "Accept: application/json\r\n";
   int code = WebRequest("GET", url, headers, HttpTimeoutMs, data, result, headers);
   if(code == -1) {
      int err = GetLastError();
      Print("[GoldRadar v3] WebRequest error: ", err,
            " — Pastikan URL sudah di-whitelist di Tools → Options → EA → WebRequest");
      return -1;
   }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
}

//════════════════════════════════════════════════════════════════════
//  JSON PARSING — fungsi-fungsi minimalis
//════════════════════════════════════════════════════════════════════
string ParseJsonString(const string &json, const string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   int start = pos + StringLen(search);
   int end   = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

double ParseJsonDouble(const string &json, const string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return 0;
   int start = pos + StringLen(search);
   // skip null
   if(StringSubstr(json, start, 4) == "null") return 0;
   string val = "";
   for(int i = start; i < MathMin(start + 30, StringLen(json)); i++) {
      ushort c = StringGetCharacter(json, i);
      if(c == ',' || c == '}' || c == ']') break;
      val += ShortToString(c);
   }
   return StringToDouble(val);
}

long ParseJsonLong(const string &json, const string key)
{
   return (long)ParseJsonDouble(json, key);
}

//════════════════════════════════════════════════════════════════════
//  DASHBOARD ON-CHART
//════════════════════════════════════════════════════════════════════
void CreateDashboard()
{
   string labels[] = {
      "bg", "title", "brain_lbl", "cmd", "conf_lbl", "conf",
      "tv_lbl", "tv", "fv_lbl", "fv", "mv_lbl", "mv",
      "sl_lbl", "sl", "tp1_lbl", "tp1", "tp2_lbl", "tp2",
      "pnl_lbl", "pnl", "spread_lbl", "spread", "time_lbl", "time"
   };
   for(int i = 0; i < ArraySize(labels); i++) {
      string name = LBL_PREFIX + labels[i];
      ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, 12);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, 80 + i * 18);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 9);
      ObjectSetString(0,  name, OBJPROP_FONT, "Consolas");
      ObjectSetInteger(0, name, OBJPROP_COLOR, DashColor);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   }
   // Title
   ObjectSetString(0,  LBL_PREFIX + "title",     OBJPROP_TEXT, "▣ GoldRadar.ai QuantBot v3");
   ObjectSetInteger(0, LBL_PREFIX + "title",     OBJPROP_FONTSIZE, 10);
   ObjectSetInteger(0, LBL_PREFIX + "title",     OBJPROP_COLOR, clrGold);
   ObjectSetInteger(0, LBL_PREFIX + "title",     OBJPROP_YDISTANCE, 82);

   // Static labels
   SetLabelText("brain_lbl",  "Brain    : " + _brainName);
   SetLabelText("cmd",        "Signal   : --");
   SetLabelText("conf_lbl",   "Conf     : --");
   SetLabelText("tv_lbl",     "Tech     : --");
   SetLabelText("fv_lbl",     "Fund     : --");
   SetLabelText("mv_lbl",     "Macro    : --");
   SetLabelText("sl_lbl",     "SL       : --");
   SetLabelText("tp1_lbl",    "TP1      : --");
   SetLabelText("tp2_lbl",    "TP2      : --");
   SetLabelText("pnl_lbl",    "PnL      : --");
   SetLabelText("spread_lbl", "Spread   : --");
   SetLabelText("time_lbl",   "Poll     : --");

   ChartRedraw(0);
}

void UpdateDashboard(const string cmd, const string brain,
                     const double conf,
                     const string tv, const string fv, const string mv)
{
   if(!ShowDashboard) return;

   color cmdColor = (cmd == "BUY" ? BuyColor : (cmd == "SELL" ? SellColor : HoldColor));
   SetLabelText("cmd", "Signal   : " + (cmd == "" ? _lastCommand : cmd));
   ObjectSetInteger(0, LBL_PREFIX + "cmd", OBJPROP_COLOR, cmdColor);

   if(conf > 0)
      SetLabelText("conf_lbl", "Conf     : " + DoubleToString(conf * 100, 1) + "%");

   color tvColor = (tv == "BUY" ? BuyColor : (tv == "SELL" ? SellColor : HoldColor));
   color fvColor = (fv == "BUY" ? BuyColor : (fv == "SELL" ? SellColor : HoldColor));
   color mvColor = (mv == "BUY" ? BuyColor : (mv == "SELL" ? SellColor : HoldColor));

   if(tv != "") { SetLabelText("tv_lbl", "Tech     : " + tv); ObjectSetInteger(0, LBL_PREFIX + "tv_lbl", OBJPROP_COLOR, tvColor); }
   if(fv != "") { SetLabelText("fv_lbl", "Fund     : " + fv); ObjectSetInteger(0, LBL_PREFIX + "fv_lbl", OBJPROP_COLOR, fvColor); }
   if(mv != "") { SetLabelText("mv_lbl", "Macro    : " + mv); ObjectSetInteger(0, LBL_PREFIX + "mv_lbl", OBJPROP_COLOR, mvColor); }

   if(_lastSL  > 0) SetLabelText("sl_lbl",  "SL       : " + DoubleToString(_lastSL, _sym.Digits()));
   if(_lastTP1 > 0) SetLabelText("tp1_lbl", "TP1      : " + DoubleToString(_lastTP1, _sym.Digits()));
   if(_lastTP2 > 0) SetLabelText("tp2_lbl", "TP2      : " + DoubleToString(_lastTP2, _sym.Digits()));

   double sp = GetCurrentSpreadPips();
   color spColor = (sp > MaxSpreadPips && EnableSpreadFilter ? clrOrangeRed : DashColor);
   SetLabelText("spread_lbl", "Spread   : " + DoubleToString(sp, 1) + " pip");
   ObjectSetInteger(0, LBL_PREFIX + "spread_lbl", OBJPROP_COLOR, spColor);

   SetLabelText("time_lbl", "Poll     : " + TimeToString(TimeCurrent(), TIME_MINUTES | TIME_SECONDS));

   ChartRedraw(0);
}

void UpdatePnlLabel(const double pnl)
{
   color pnlColor = (pnl >= 0 ? BuyColor : SellColor);
   SetLabelText("pnl_lbl", "PnL      : " + (pnl >= 0 ? "+" : "") + DoubleToString(pnl, 2) + " USD");
   ObjectSetInteger(0, LBL_PREFIX + "pnl_lbl", OBJPROP_COLOR, pnlColor);
   ChartRedraw(0);
}

void SetLabelText(const string key, const string text)
{
   ObjectSetString(0, LBL_PREFIX + key, OBJPROP_TEXT, text);
}

void DeleteDashboard()
{
   ObjectsDeleteAll(0, LBL_PREFIX);
   ChartRedraw(0);
}
//+------------------------------------------------------------------+
