//+------------------------------------------------------------------+
//|  GoldRadar_QuantBot_v3.mq5                                       |
//|  Expert Advisor - XAUUSD Quant Bot Signal Executor               |
//|  Pilih brain: Technical / Fundamental / Macro / Ensemble         |
//|  Sinyal muncul -> Market Order langsung, SL/TP dari sinyal       |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property link      "https://goldradar.ai"
#property version   "3.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>

//--------------------------------------------------------------------
//  INPUT PARAMETERS
//--------------------------------------------------------------------

// --- KONEKSI SERVER ---
input string   ServerURL     = "https://YOUR-REPLIT-URL.repl.co"; // URL server GoldRadar (tanpa slash akhir)
input string   EAApiKey      = "";                                  // EA API Key (dari Admin -> EA Key)

// --- SUMBER SINYAL ---
enum BRAIN_SOURCE
  {
   BRAIN_ENSEMBLE    = 0, // Ensemble - gabungan 3 brain (RECOMMENDED)
   BRAIN_TECHNICAL   = 1, // Technical Brain - RSI, MACD, EMA, SMC
   BRAIN_FUNDAMENTAL = 2, // Fundamental Brain - DXY, Yield, COT
   BRAIN_MACRO       = 3, // Macro Brain - Fed, Geopolitik, Bank Sentral
  };
input BRAIN_SOURCE BrainSource   = BRAIN_ENSEMBLE; // Brain yang dipakai
input double       MinConfidence = 0.45;           // Min confidence eksekusi (0.0 - 1.0)

// --- EKSEKUSI ORDER ---
input double   LotSize        = 0.01;     // Lot per trade
input int      MagicNumber    = 20250713; // Magic number EA
input int      Slippage       = 30;       // Max slippage (points)
input bool     CloseOnHold    = true;     // Tutup posisi saat sinyal HOLD
input bool     CloseOnReverse = true;     // Tutup posisi lama saat sinyal berbalik
input bool     OneTradeOnly   = true;     // Hanya 1 posisi aktif sekaligus

// --- POLLING ---
input int      PollSeconds    = 30;       // Interval polling API (detik, min 10)
input int      HttpTimeoutMs  = 15000;    // Timeout HTTP (ms)
input bool     VerboseLog     = true;     // Log detail di Journal

//--------------------------------------------------------------------
//  GLOBAL STATE
//--------------------------------------------------------------------
CTrade      _trade;
CSymbolInfo _sym;

string   _lastCommand  = "HOLD";
long     _lastSignalId = -1;
datetime _lastPollTime = 0;
int      _pollInterval = 30;
bool     _isReady      = false;
string   _brainName    = "ensemble";
string   _endpoint     = "";

//--------------------------------------------------------------------
//  INIT
//--------------------------------------------------------------------
int OnInit()
  {
   if(StringFind(ServerURL, "YOUR-REPLIT-URL") >= 0)
     {
      Alert("[GoldRadar] ERROR: Isi ServerURL dengan URL server GoldRadar kamu!");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(EAApiKey == "")
     {
      Alert("[GoldRadar] ERROR: Isi EAApiKey! Generate key di Admin -> EA Key.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(LotSize <= 0.0 || LotSize > 100.0)
     {
      Alert("[GoldRadar] ERROR: LotSize tidak valid (0.01 - 100)");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(MinConfidence < 0.0 || MinConfidence > 1.0)
     {
      Alert("[GoldRadar] ERROR: MinConfidence harus antara 0.0 dan 1.0");
      return INIT_PARAMETERS_INCORRECT;
     }

   // Pilih nama brain
   switch(BrainSource)
     {
      case BRAIN_TECHNICAL:   _brainName = "technical";   break;
      case BRAIN_FUNDAMENTAL: _brainName = "fundamental"; break;
      case BRAIN_MACRO:       _brainName = "macro";       break;
      default:                _brainName = "ensemble";    break;
     }

   // Build endpoint URL (hapus trailing slash jika ada)
   string baseUrl = ServerURL;
   int    baseLen = StringLen(baseUrl);
   if(baseLen > 0 && StringSubstr(baseUrl, baseLen - 1, 1) == "/")
      baseUrl = StringSubstr(baseUrl, 0, baseLen - 1);

   _endpoint = baseUrl + "/api/quant/ea-signal?brain=" + _brainName
               + "&format=plain&key=" + EAApiKey;

   // Trade setup
   _trade.SetExpertMagicNumber(MagicNumber);
   _trade.SetDeviationInPoints(Slippage);
   _trade.SetTypeFilling(ORDER_FILLING_RETURN);

   _sym.Name(Symbol());
   _sym.RefreshRates();

   _pollInterval = MathMax(10, PollSeconds);

   Print("--------------------------------------------");
   Print("  GoldRadar.ai - QuantBot v3.00");
   Print("  Brain    : ", _brainName);
   Print("  Lot      : ", DoubleToString(LotSize, 2));
   Print("  Min Conf : ", DoubleToString(MinConfidence * 100.0, 0), "%");
   Print("  Poll     : ", IntegerToString(_pollInterval), "s");
   Print("--------------------------------------------");

   EventSetTimer(_pollInterval);
   _isReady = true;
   return INIT_SUCCEEDED;
  }

//--------------------------------------------------------------------
//  DEINIT
//--------------------------------------------------------------------
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Print("[GoldRadar] EA dinonaktifkan. reason=", IntegerToString(reason));
  }

//--------------------------------------------------------------------
//  TIMER - logika utama (polling tiap N detik)
//--------------------------------------------------------------------
void OnTimer()
  {
   if(!_isReady) return;

   datetime now = TimeCurrent();
   if((int)(now - _lastPollTime) < _pollInterval) return;
   _lastPollTime = now;

   if(VerboseLog)
      Print("[GoldRadar] Polling brain=", _brainName, " ...");

   string response = "";
   int code = MakeHttpGet(_endpoint, response);
   if(code != 200)
     {
      Print("[GoldRadar] HTTP ", IntegerToString(code), " - retry dalam ", IntegerToString(_pollInterval), "s");
      return;
     }

   ProcessSignal(response);
  }

//--------------------------------------------------------------------
//  TICK - hanya refresh symbol info
//--------------------------------------------------------------------
void OnTick()
  {
   if(_isReady)
      _sym.RefreshRates();
  }

//--------------------------------------------------------------------
//  PROSES SINYAL - format plain: "COMMAND|ENTRY|TP|SL|CONFIDENCE|ID"
//  Contoh: "BUY|3245.50|3265.50|3225.50|0.720|42"
//--------------------------------------------------------------------
void ProcessSignal(string response)
  {
   // Bersihkan karakter newline/carriage return
   StringReplace(response, "\r", "");
   StringReplace(response, "\n", "");

   string parts[];
   ushort sep = '|';
   int count = StringSplit(response, sep, parts);
   if(count < 6)
     {
      Print("[GoldRadar] Response tidak valid: '", response, "'");
      return;
     }

   string command    = parts[0];
   double entry      = StringToDouble(parts[1]);
   double tp         = StringToDouble(parts[2]);
   double sl         = StringToDouble(parts[3]);
   double confidence = StringToDouble(parts[4]);
   long   signalId   = (long)StringToDouble(parts[5]);

   if(VerboseLog)
      Print("[GoldRadar] Sinyal=", command,
            " Entry=", DoubleToString(entry, _sym.Digits()),
            " TP=", DoubleToString(tp, _sym.Digits()),
            " SL=", DoubleToString(sl, _sym.Digits()),
            " Conf=", DoubleToString(confidence * 100.0, 1), "%",
            " ID=", IntegerToString(signalId));

   // Sinyal tidak berubah -> skip
   if(signalId == _lastSignalId && command == _lastCommand) return;

   // HOLD
   if(command == "HOLD")
     {
      _lastCommand  = "HOLD";
      _lastSignalId = signalId;
      if(CloseOnHold && HasOpenPosition())
        {
         Print("[GoldRadar] HOLD - tutup posisi aktif");
         CloseAllPositions("HOLD");
        }
      return;
     }

   // Validasi confidence
   if(confidence < MinConfidence)
     {
      Print("[GoldRadar] Skip - confidence ",
            DoubleToString(confidence * 100.0, 1), "% < min ",
            DoubleToString(MinConfidence * 100.0, 0), "%");
      _lastSignalId = signalId;
      return;
     }

   // Validasi TP / SL
   if(tp == 0.0 || sl == 0.0)
     {
      Print("[GoldRadar] TP atau SL = 0 - sinyal dilewati");
      _lastSignalId = signalId;
      return;
     }

   // Tutup posisi berlawanan
   if(CloseOnReverse && HasOpenPosition())
     {
      bool isBuyOpen  = IsPositionTypeOpen(POSITION_TYPE_BUY);
      bool isSellOpen = IsPositionTypeOpen(POSITION_TYPE_SELL);
      if(command == "BUY"  && isSellOpen) CloseAllPositions("Reverse ke BUY");
      if(command == "SELL" && isBuyOpen)  CloseAllPositions("Reverse ke SELL");
     }

   // OneTradeOnly
   if(OneTradeOnly && HasOpenPosition())
     {
      if(VerboseLog)
         Print("[GoldRadar] Posisi masih aktif, OneTradeOnly=true -> skip entry");
      _lastSignalId = signalId;
      _lastCommand  = command;
      return;
     }

   // Eksekusi order
   ExecuteOrder(command, tp, sl, signalId, confidence);

   _lastSignalId = signalId;
   _lastCommand  = command;
  }

//--------------------------------------------------------------------
//  EKSEKUSI ORDER MARKET
//--------------------------------------------------------------------
void ExecuteOrder(const string command,
                  const double tp,     const double sl,
                  const long signalId, const double confidence)
  {
   _sym.RefreshRates();
   int    digits  = (int)_sym.Digits();
   double normTp  = NormalizeDouble(tp, digits);
   double normSl  = NormalizeDouble(sl, digits);
   string comment = "GR3_" + _brainName + "_" + IntegerToString((int)signalId);
   bool   ok      = false;

   if(command == "BUY")
      ok = _trade.Buy(LotSize, Symbol(), _sym.Ask(), normSl, normTp, comment);
   else if(command == "SELL")
      ok = _trade.Sell(LotSize, Symbol(), _sym.Bid(), normSl, normTp, comment);

   if(!ok)
     {
      Print("[GoldRadar] Order gagal - Retcode: ",
            IntegerToString(_trade.ResultRetcode()), " - ",
            _trade.ResultRetcodeDescription());
      return;
     }

   Print("------------------------------------------");
   Print("  GoldRadar QuantBot v3 - ORDER MASUK");
   Print("  Brain  : ", _brainName);
   Print("  Signal : ", command, " ID=", IntegerToString((int)signalId));
   Print("  Lot    : ", DoubleToString(LotSize, 2));
   Print("  Masuk  : ", DoubleToString(_trade.ResultPrice(), digits));
   Print("  TP     : ", DoubleToString(normTp, digits));
   Print("  SL     : ", DoubleToString(normSl, digits));
   Print("  Conf   : ", DoubleToString(confidence * 100.0, 1), "%");
   Print("------------------------------------------");
  }

//--------------------------------------------------------------------
//  HELPER - Cek apakah ada posisi EA terbuka (any type)
//--------------------------------------------------------------------
bool HasOpenPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
      return true;
     }
   return false;
  }

//--------------------------------------------------------------------
//  HELPER - Cek apakah posisi tipe tertentu sedang terbuka
//--------------------------------------------------------------------
bool IsPositionTypeOpen(const ENUM_POSITION_TYPE posType)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == posType) return true;
     }
   return false;
  }

//--------------------------------------------------------------------
//  HELPER - Tutup semua posisi EA
//--------------------------------------------------------------------
void CloseAllPositions(const string reason = "")
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)MagicNumber) continue;
      double pnl = PositionGetDouble(POSITION_PROFIT);
      if(_trade.PositionClose(ticket, Slippage))
         Print("[GoldRadar] Tutup #", IntegerToString((int)ticket),
               (reason != "" ? " - " + reason : ""),
               " PnL=", DoubleToString(pnl, 2), " USD");
      else
         Print("[GoldRadar] Gagal tutup #", IntegerToString((int)ticket),
               " retcode=", IntegerToString(_trade.ResultRetcode()));
     }
  }

//--------------------------------------------------------------------
//  HTTP GET via WebRequest
//--------------------------------------------------------------------
int MakeHttpGet(const string url, string &response)
  {
   uchar  data[];
   uchar  result[];
   string resHeaders;
   string reqHeaders = "Accept: text/plain\r\n";

   int code = WebRequest("GET", url, reqHeaders, HttpTimeoutMs,
                         data, result, resHeaders);
   if(code == -1)
     {
      Print("[GoldRadar] WebRequest error=", IntegerToString(GetLastError()),
            " - Whitelist URL di: Tools -> Options -> Expert Advisors -> Allow WebRequest");
      return -1;
     }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
  }
//+------------------------------------------------------------------+
