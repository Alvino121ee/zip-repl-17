//+------------------------------------------------------------------+
//|                                           radargoldv2.mq5        |
//|                              Radar Gold v2 EA — GoldRadar.ai     |
//|  Fitur: Trailing Stop, Smart Re-entry, Reverse Mode             |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property version   "3.00"
#property description "Radar Gold v2 EA - Trailing Stop + Smart Re-entry + Reverse Mode"

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== Koneksi API ==="
input string InpApiUrl      = "https://ea0d0248-37e6-4c7c-bf1d-8eea747bc422-00-2km4p49e149wr.pike.replit.dev";
input string InpEaApiKey    = "sr_ea_b53bbea43a85f440ce0cce5b4ab7a799dc2bf7be";
input string InpSensitivity = "aggressive"; // super_aggressive|aggressive|normal|conservative

input group "=== Trading ==="
input double InpLotSize     = 0.01;
input bool   InpAutoTrade   = false;
input int    InpMagicNumber = 202607;
input bool   InpReverseMode = false;   // true = balik sinyal (BUY->SELL, SELL->BUY)

input group "=== Trailing Stop P1 (posisi TP1) ==="
input bool   InpTrailP1      = true;   // Aktifkan trailing untuk P1
input int    InpTrailP1Act   = 30;     // Profit minimal (pips) sebelum trailing P1 aktif
input int    InpTrailP1Dist  = 15;     // Jarak trailing SL P1 dari harga (pips)

input group "=== Trailing Stop P2 (posisi TP2) ==="
input bool   InpTrailP2      = true;   // Aktifkan trailing untuk P2
input int    InpTrailP2Act   = 80;     // Profit minimal (pips) sebelum trailing P2 aktif
input int    InpTrailP2Dist  = 35;     // Jarak trailing SL P2 dari harga (pips)

input group "=== Partial Close (2 Posisi) ==="
input bool   InpPartialClose = false;   // Buka 2 posisi: P1→TP1, P2→TP2
input double InpPartialLot   = 0.05;   // Lot per posisi (total = 2×InpPartialLot)

input group "=== Smart Re-entry ==="
input bool   InpSmartReentry   = true;   // Re-entry jika sinyal sama & harga balik ke zona
input double InpReentryZonePip = 10.0;   // Lebar zona re-entry ±pip dari harga entry asli
input double InpReentryBufPip  = 3.0;    // Buffer toleransi tambahan saat cek harga masuk zona
input int    InpRentryCooldown = 30;     // Detik jeda minimum setelah posisi close sebelum re-entry

input group "=== Tampilan ==="
input bool   InpShowPanel = true;

//--- Constants
#define POLL_INTERVAL_SEC 2

//--- Label names
#define LBL_BG       "RGS_BG"
#define LBL_TITLE    "RGS_TITLE"
#define LBL_STATUS   "RGS_STATUS"
#define LBL_CMD      "RGS_CMD"
#define LBL_MODE     "RGS_MODE"
#define LBL_PRICE    "RGS_PRICE"
#define LBL_TPSL     "RGS_TPSL"
#define LBL_CONF     "RGS_CONF"
#define LBL_TRAIL    "RGS_TRAIL"
#define LBL_REENTRY  "RGS_REENTRY"
#define LBL_SEP      "RGS_SEP"
#define LBL_BAL      "RGS_BAL"
#define LBL_EQ       "RGS_EQ"
#define LBL_PNL      "RGS_PNL"
#define LBL_POS      "RGS_POS"
#define LBL_TIME     "RGS_TIME"

//--- Global state
CTrade   g_trade;
datetime g_lastPoll     = 0;
string   g_lastCommand  = "HOLD";
string   g_rawCommand   = "HOLD";

double   g_price      = 0;
double   g_tp1        = 0;
double   g_tp2        = 0;
double   g_tp3        = 0;
double   g_sl         = 0;
double   g_entryLow   = 0;
double   g_entryHigh  = 0;
double   g_conf       = 0;

//--- Re-entry state
bool     g_waitingReentry     = false;
datetime g_reentryAvailableAt = 0;
string   g_lastEntrySignal    = "HOLD";
double   g_reentryZoneLow     = 0;
double   g_reentryZoneHigh    = 0;
double   g_lastEntryPrice     = 0;
double   g_lastEntryTP        = 0;    // TP1 saat entry → identitas sinyal
double   g_lastEntrySL        = 0;    // SL saat entry  → identitas sinyal
int      g_prevPosCount       = 0;
int      g_prevP1Count        = 0;    // jumlah posisi P1 sebelumnya (partial close)

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(20);
   g_prevPosCount = CountOurPositions();
   g_prevP1Count  = CountPositionsByTag("P1");

   if(InpShowPanel) CreatePanel();

   Print("=== Radar Gold Smart EA v3.0 aktif ===");
   Print("URL        : ", InpApiUrl);
   Print("Magic#     : ", InpMagicNumber);
   Print("Mode       : ", InpReverseMode ? "REVERSE (sinyal dibalik)" : "NORMAL");
   Print("Trail P1   : ", InpTrailP1 ? "ON — aktif >" + IntegerToString(InpTrailP1Act) + " pip, jarak " + IntegerToString(InpTrailP1Dist) + " pip" : "OFF");
   Print("Trail P2   : ", InpTrailP2 ? "ON — aktif >" + IntegerToString(InpTrailP2Act) + " pip, jarak " + IntegerToString(InpTrailP2Dist) + " pip" : "OFF");
   Print("Re-entry   : ", InpSmartReentry ? "ON" : "OFF");

   FetchAndProcess();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(InpShowPanel) DeletePanel();
   Print("Radar Gold Smart EA v3.0 dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(InpTrailP1 || InpTrailP2) ManageTrailingStops();
   if(InpSmartReentry)  CheckPositionsClosed();

   if(TimeCurrent() - g_lastPoll < POLL_INTERVAL_SEC) return;
   g_lastPoll = TimeCurrent();

   PushAccountData();
   FetchAndProcess();
}

//+------------------------------------------------------------------+
int CountOurPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))               continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      count++;
   }
   return count;
}

//+------------------------------------------------------------------+
// Hitung posisi milik EA yang komennya mengandung tag (mis. "P1" atau "P2")
int CountPositionsByTag(string tag)
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))                continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol())  continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(StringFind(PositionGetString(POSITION_COMMENT), tag) >= 0) count++;
   }
   return count;
}

//+------------------------------------------------------------------+
void CheckPositionsClosed()
{
   int curCount = CountOurPositions();
   int curP1    = CountPositionsByTag("P1");

   // Deteksi penutupan: total berkurang ATAU P1 berkurang (saat P2 masih jalan)
   bool anyClose = (curCount < g_prevPosCount);
   bool p1Close  = InpPartialClose && (curP1 < g_prevP1Count);

   if(anyClose || p1Close)
   {
      if(g_lastEntrySignal != "HOLD" && g_lastEntrySignal == g_lastCommand)
      {
         double pointSize = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         double halfZone  = InpReentryZonePip * pointSize * 10.0;
         double basePrice = (g_lastEntryPrice > 0) ? g_lastEntryPrice : g_price;

         g_waitingReentry     = true;
         g_reentryAvailableAt = TimeCurrent() + InpRentryCooldown;
         g_reentryZoneLow     = NormalizeDouble(basePrice - halfZone, _Digits);
         g_reentryZoneHigh    = NormalizeDouble(basePrice + halfZone, _Digits);

         string info = p1Close && !anyClose ? "P1 (TP1 hit), P2 masih jalan" : "posisi ditutup";
         Print("[Re-entry] ", info, ". Cooldown ", InpRentryCooldown, "s, lalu pantau zona ",
               DoubleToString(g_reentryZoneLow, 2), "–", DoubleToString(g_reentryZoneHigh, 2),
               " | Sinyal: ", g_lastEntrySignal);
         if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: COOLDOWN...", clrOrange);
      }
      else
      {
         g_waitingReentry = false;
         if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: OFF (sinyal beda)", clrGray);
      }
   }
   g_prevPosCount = curCount;
   g_prevP1Count  = curP1;
}

//+------------------------------------------------------------------+
void ManageTrailingStops()
{
   double pointSize = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   int    digits    = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double pip       = pointSize * 10.0;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))                continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol())  continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      // Tentukan setting trailing berdasarkan tag posisi (P1 / P2 / normal)
      string comment = PositionGetString(POSITION_COMMENT);
      bool isP2      = (StringFind(comment, "P2") >= 0);
      bool isP1      = !isP2 && (StringFind(comment, "P1") >= 0 || !InpPartialClose);

      // Pilih parameter trailing yang sesuai
      bool   useTrail  = isP2 ? InpTrailP2      : InpTrailP1;
      double trailAct  = isP2 ? InpTrailP2Act * pip : InpTrailP1Act * pip;
      double trailDist = isP2 ? InpTrailP2Dist * pip : InpTrailP1Dist * pip;

      if(!useTrail) continue;

      ENUM_POSITION_TYPE pt        = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double             openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double             curSL     = PositionGetDouble(POSITION_SL);
      double             curTP     = PositionGetDouble(POSITION_TP);
      double             ask       = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
      double             bid       = SymbolInfoDouble(Symbol(), SYMBOL_BID);
      string             tag       = isP2 ? "P2" : (isP1 ? "P1" : "");

      if(pt == POSITION_TYPE_BUY)
      {
         double profit = bid - openPrice;
         if(profit < trailAct) continue;
         double newSL = NormalizeDouble(bid - trailDist, digits);
         if(newSL > curSL + pointSize)
         {
            if(g_trade.PositionModify(ticket, newSL, curTP))
               Print("[Trail-", tag, "] BUY #", ticket,
                     " SL: ", DoubleToString(curSL, digits), "→", DoubleToString(newSL, digits));
         }
      }
      else if(pt == POSITION_TYPE_SELL)
      {
         double profit = openPrice - ask;
         if(profit < trailAct) continue;
         double newSL = NormalizeDouble(ask + trailDist, digits);
         if(curSL == 0 || newSL < curSL - pointSize)
         {
            if(g_trade.PositionModify(ticket, newSL, curTP))
               Print("[Trail-", tag, "] SELL #", ticket,
                     " SL: ", DoubleToString(curSL, digits), "→", DoubleToString(newSL, digits));
         }
      }
   }
}

//+------------------------------------------------------------------+
void PushAccountData()
{
   string url = InpApiUrl + "/api/xauusd/ea-account?key=" + InpEaApiKey;

   string posJson  = "[";
   double totalPnl = 0.0;
   int    total    = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;

      double             pnl   = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      totalPnl                += pnl;
      ENUM_POSITION_TYPE pt    = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string             ptype = (pt == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      if(i > 0) posJson += ",";
      posJson += "{\"ticket\":"      + IntegerToString((long)ticket)
              + ",\"type\":\""       + ptype + "\""
              + ",\"symbol\":\""     + PositionGetString(POSITION_SYMBOL) + "\""
              + ",\"volume\":"       + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2)
              + ",\"openPrice\":"    + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 5)
              + ",\"currentPrice\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), 5)
              + ",\"tp\":"           + DoubleToString(PositionGetDouble(POSITION_TP), 5)
              + ",\"sl\":"           + DoubleToString(PositionGetDouble(POSITION_SL), 5)
              + ",\"pnl\":"          + DoubleToString(pnl, 2)
              + ",\"swap\":"         + DoubleToString(PositionGetDouble(POSITION_SWAP), 2)
              + ",\"openTime\":\""   + TimeToString(PositionGetInteger(POSITION_TIME), TIME_DATE|TIME_MINUTES) + "\""
              + "}";
   }
   posJson += "]";

   string body = "{"
      + "\"balance\":"        + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),    2)
      + ",\"equity\":"        + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),     2)
      + ",\"freeMargin\":"    + DoubleToString(AccountInfoDouble(ACCOUNT_FREEMARGIN), 2)
      + ",\"margin\":"        + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN),     2)
      + ",\"pnl\":"           + DoubleToString(totalPnl, 2)
      + ",\"positions\":"     + posJson
      + ",\"accountName\":\"" + AccountInfoString(ACCOUNT_NAME) + "\""
      + ",\"accountNumber\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
      + ",\"broker\":\""      + AccountInfoString(ACCOUNT_COMPANY) + "\""
      + ",\"leverage\":"      + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE))
      + ",\"currency\":\""    + AccountInfoString(ACCOUNT_CURRENCY) + "\""
      + "}";

   uchar  postBuf[];
   uchar  resBuf[];
   string resHeaders = "";
   StringToUcharArray(body, postBuf);
   WebRequest("POST", url, "Content-Type: application/json\r\n", 3000, postBuf, resBuf, resHeaders);
}

//+------------------------------------------------------------------+
void FetchAndProcess()
{
   string url = InpApiUrl + "/api/xauusd/ea-signal"
              + "?key="         + InpEaApiKey
              + "&sensitivity=" + InpSensitivity
              + "&format=plain2";

   uchar  sendBuf[];
   uchar  recvBuf[];
   string resHeaders = "";

   ResetLastError();
   int code = WebRequest("GET", url, "Accept: text/plain\r\n", 3000, sendBuf, recvBuf, resHeaders);

   if(code == -1)
   {
      int err = GetLastError();
      string msg = (err == 5203)
         ? "Tambahkan URL ke: Tools > Options > Expert Advisors > Allow WebRequest"
         : "Koneksi error: " + IntegerToString(err);
      Print("[ERROR] ", msg);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "ERROR " + IntegerToString(err), clrRed);
      return;
   }
   if(code != 200)
   {
      Print("[ERROR] HTTP ", code, ": ", CharArrayToString(recvBuf));
      if(InpShowPanel) SetLabelText(LBL_STATUS, "HTTP " + IntegerToString(code), clrRed);
      return;
   }

   //--- Parse: CMD|PRICE|TP1|TP2|TP3|SL|ENTRY_LOW|ENTRY_HIGH|CONFIDENCE
   string resp = CharArrayToString(recvBuf);
   StringTrimRight(resp);
   StringTrimLeft(resp);

   string parts[];
   int numParts = StringSplit(resp, '|', parts);

   if(numParts >= 9)
   {
      g_rawCommand = parts[0];
      g_price      = StringToDouble(parts[1]);
      g_tp1        = StringToDouble(parts[2]);
      g_tp2        = StringToDouble(parts[3]);
      g_tp3        = StringToDouble(parts[4]);
      g_sl         = StringToDouble(parts[5]);
      g_entryLow   = StringToDouble(parts[6]);
      g_entryHigh  = StringToDouble(parts[7]);
      g_conf       = StringToDouble(parts[8]);
   }
   else if(numParts >= 5)
   {
      g_rawCommand = parts[0];
      g_price      = StringToDouble(parts[1]);
      g_tp1        = StringToDouble(parts[2]);
      g_tp2        = g_tp1;
      g_tp3        = g_tp1;
      g_sl         = StringToDouble(parts[3]);
      g_conf       = StringToDouble(parts[4]);
      double atrEst = MathAbs(g_tp1 - g_price) / 0.45;
      g_entryLow   = g_price - atrEst * 0.08;
      g_entryHigh  = g_price + atrEst * 0.08;
   }
   else
   {
      Print("[ERROR] Respons tidak valid: ", resp);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "Respons tidak valid", clrRed);
      return;
   }

   //--- Terapkan Reverse Mode (balik sinyal DAN hitung ulang TP/SL untuk arah baru)
   string cmd = g_rawCommand;
   if(InpReverseMode)
   {
      if(cmd == "BUY")       cmd = "SELL";
      else if(cmd == "SELL") cmd = "BUY";

      // Hitung ulang TP/SL untuk arah yang dibalik
      // (nilai dari server dihitung untuk arah ASLI — tidak valid untuk arah terbalik)
      if(cmd == "BUY" || cmd == "SELL")
      {
         int    revDir  = (cmd == "BUY") ? 1 : -1;
         // Back-calculate ATR dari TP1 yang dikirim server (tp1 = price ± atr*0.45)
         double atrEst  = (g_tp1 > 0 && g_price > 0) ? MathAbs(g_tp1 - g_price) / 0.45 : 5.0;
         g_tp1       = NormalizeDouble(g_price + revDir * atrEst * 0.45, _Digits);
         g_tp2       = NormalizeDouble(g_price + revDir * atrEst * 0.80, _Digits);
         g_tp3       = NormalizeDouble(g_price + revDir * atrEst * 1.30, _Digits);
         g_sl        = NormalizeDouble(g_price - revDir * atrEst * 0.30, _Digits);
         g_entryLow  = NormalizeDouble(g_price - atrEst * 0.08, _Digits);
         g_entryHigh = NormalizeDouble(g_price + atrEst * 0.08, _Digits);
      }
   }

   Print("[Sinyal] ", g_rawCommand,
         (InpReverseMode ? " -> " + cmd + " (REVERSE)" : ""),
         " | $", DoubleToString(g_price, 2),
         " | TP1=", DoubleToString(g_tp1, 2),
         " | TP2=", DoubleToString(g_tp2, 2),
         " | SL=",  DoubleToString(g_sl, 2),
         " | Zone=", DoubleToString(g_entryLow, 2), "-", DoubleToString(g_entryHigh, 2),
         " | Conf=", DoubleToString(g_conf * 100, 0), "%");

   if(InpShowPanel) UpdatePanel(cmd);

   if(!InpAutoTrade)
   {
      g_lastCommand = cmd;
      return;
   }

   bool signalChanged = (cmd != g_lastCommand);
   g_lastCommand = cmd;

   //--- HOLD
   if(cmd == "HOLD")
   {
      if(signalChanged)
      {
         Print("[Trade] Sinyal HOLD — tutup semua posisi");
         CloseByType(-1);
         g_waitingReentry  = false;
         g_lastEntrySignal = "HOLD";
         if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: OFF (HOLD)", clrGray);
      }
      return;
   }

   ENUM_ORDER_TYPE    orderType = (cmd == "BUY") ? ORDER_TYPE_BUY  : ORDER_TYPE_SELL;
   ENUM_POSITION_TYPE posType   = (cmd == "BUY") ? POSITION_TYPE_BUY : POSITION_TYPE_SELL;
   ENUM_POSITION_TYPE oppType   = (cmd == "BUY") ? POSITION_TYPE_SELL : POSITION_TYPE_BUY;

   //--- Sinyal berubah: tutup posisi berlawanan, buka langsung
   if(signalChanged)
   {
      Print("[Trade] Sinyal baru: ", cmd, " — tutup lawan & buka baru");
      g_waitingReentry  = false;
      g_lastEntrySignal = cmd;
      if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: RESET (sinyal baru)", clrGray);

      CloseByType((int)oppType);

      if(!HasPosition((int)posType))
      {
         OpenOrder(orderType);
         g_lastEntrySignal = cmd;
         // Zona ±InpReentryZonePip dari harga entry asli (g_lastEntryPrice diset di OpenOrder)
         double pointSize2 = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
         double halfZone2  = InpReentryZonePip * pointSize2 * 10.0;
         g_reentryZoneLow  = NormalizeDouble(g_lastEntryPrice - halfZone2, _Digits);
         g_reentryZoneHigh = NormalizeDouble(g_lastEntryPrice + halfZone2, _Digits);
      }
      return;
   }

   //--- Sinyal sama: cek re-entry
   if(InpSmartReentry && g_waitingReentry && g_lastEntrySignal == cmd)
   {
      double pointSize = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
      double pipSize   = pointSize * 10.0;

      // ── Deteksi sinyal BARU via TP/SL (hanya di non-reverse mode)
      // Di reverse mode TP/SL berubah tiap tick → tidak bisa jadi identitas sinyal
      bool newSignalDetected = false;
      if(!InpReverseMode && g_lastEntryTP > 0 && g_lastEntrySL > 0)
      {
         bool tpChanged = MathAbs(NormalizeDouble(g_tp1, _Digits) - g_lastEntryTP) > pipSize;
         bool slChanged = MathAbs(NormalizeDouble(g_sl,  _Digits) - g_lastEntrySL) > pipSize;
         newSignalDetected = (tpChanged || slChanged);
      }

      if(newSignalDetected)
      {
         Print("[Re-entry] SINYAL BARU terdeteksi (TP/SL berubah) | ",
               "TP: ", DoubleToString(g_lastEntryTP, 2), "→", DoubleToString(g_tp1, 2), " | ",
               "SL: ", DoubleToString(g_lastEntrySL, 2), "→", DoubleToString(g_sl,  2),
               " — batalkan re-entry, masuk fresh");
         g_waitingReentry = false;
         if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: SINYAL BARU — fresh entry", clrAqua);
         // lanjut ke bawah (entry fresh jika belum punya posisi)
      }
      else
      {
         // Sinyal sama persis → cek zona & cooldown, lalu return (jangan masuk entry normal)
         double curPrice = (cmd == "BUY")
            ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
            : SymbolInfoDouble(Symbol(), SYMBOL_BID);
         double bufSize  = InpReentryBufPip * pipSize;

         bool cooldownDone = (TimeCurrent() >= g_reentryAvailableAt);
         bool inZone = (curPrice >= g_reentryZoneLow - bufSize)
                    && (curPrice <= g_reentryZoneHigh + bufSize);

         bool shouldReturn = true;  // default: tetap dalam re-entry mode

         if(!cooldownDone)
         {
            int sisaDetik = (int)(g_reentryAvailableAt - TimeCurrent());
            if(InpShowPanel)
               SetLabelText(LBL_REENTRY,
                  "Re-entry: cooldown " + IntegerToString(sisaDetik) + "s...", clrOrange);
         }
         else if(inZone && CountPositionsByTag("P1") == 0)
         {
            bool p2StillOpen = InpPartialClose && (CountPositionsByTag("P2") > 0);

            if(p2StillOpen)
            {
               // Partial: P1 slot kosong, P2 masih jalan → re-open P1 saja
               Print("[Re-entry] Harga $", DoubleToString(curPrice, 2),
                     " kembali ke zona — masuk ulang ", cmd, " P1 only (P2 masih jalan)");
               OpenOrder(orderType, true);
               g_waitingReentry = false;
               if(InpShowPanel) SetLabelText(LBL_REENTRY, "Re-entry: MASUK P1! P2 jalan", clrLime);
            }
            else
            {
               // Semua posisi sudah habis (atau non-partial) → batalkan re-entry,
               // biarkan fresh entry block di bawah buka P1+P2
               Print("[Re-entry] Semua posisi habis — reset ke fresh entry");
               g_waitingReentry = false;
               shouldReturn = false;  // jangan return, jatuh ke fresh entry block
            }
         }
         else if(!inZone)
         {
            if(InpShowPanel)
               SetLabelText(LBL_REENTRY,
                  "Re-entry: tunggu $" + DoubleToString(g_reentryZoneLow, 2)
                  + "-" + DoubleToString(g_reentryZoneHigh, 2), clrYellow);
         }

         if(shouldReturn) return;
      }
   }

   //--- Entry fresh: sinyal aktif, tidak ada posisi sama sekali
   // (termasuk setelah re-entry dibatalkan karena sinyal baru terdeteksi)
   if(!HasPosition((int)posType))
   {
      OpenOrder(orderType, false);   // false = buka P1+P2 (atau single jika partial off)
      g_lastEntrySignal = cmd;
      double pointSize3 = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
      double halfZone3  = InpReentryZonePip * pointSize3 * 10.0;
      g_reentryZoneLow  = NormalizeDouble(g_lastEntryPrice - halfZone3, _Digits);
      g_reentryZoneHigh = NormalizeDouble(g_lastEntryPrice + halfZone3, _Digits);
   }
}

//+------------------------------------------------------------------+
// reentryP1 = false → buka fresh (P1+P2 jika partial, single jika tidak)
// reentryP1 = true  → buka P1 saja (re-entry, P2 mungkin masih jalan)
void OpenOrder(ENUM_ORDER_TYPE type, bool reentryP1 = false)
{
   double price  = (type == ORDER_TYPE_BUY)
                 ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                 : SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double tp1Norm = NormalizeDouble(g_tp1, _Digits);
   double tp2Norm = NormalizeDouble(g_tp2, _Digits);
   double slNorm  = NormalizeDouble(g_sl,  _Digits);
   string base    = "RGS" + (InpReverseMode ? "-REV" : "") + " " + DoubleToString(g_conf * 100, 0) + "%";

   bool usePartial = InpPartialClose && g_tp2 > 0 && InpPartialLot > 0;

   if(usePartial)
   {
      // ── MODE PARTIAL: buka P1 (→TP1) dan jika bukan re-entry juga P2 (→TP2) ──
      bool okP1;
      if(type == ORDER_TYPE_BUY)
         okP1 = g_trade.Buy (InpPartialLot, Symbol(), price, slNorm, tp1Norm, base + " P1");
      else
         okP1 = g_trade.Sell(InpPartialLot, Symbol(), price, slNorm, tp1Norm, base + " P1");

      if(okP1)
      {
         g_lastEntryPrice = price;
         g_lastEntryTP    = tp1Norm;
         g_lastEntrySL    = slNorm;
         Print("[Order-P1] ", EnumToString(type), " OK | lot=", InpPartialLot,
               " | harga=", DoubleToString(price, _Digits),
               " | TP1=",   DoubleToString(tp1Norm, _Digits),
               " | SL=",    DoubleToString(slNorm,  _Digits));
      }
      else
         Print("[Order-P1] GAGAL | retcode=", g_trade.ResultRetcode(), " | ", g_trade.ResultComment());

      if(!reentryP1)   // P2 hanya dibuka saat fresh entry, bukan saat re-entry P1
      {
         bool okP2;
         if(type == ORDER_TYPE_BUY)
            okP2 = g_trade.Buy (InpPartialLot, Symbol(), price, slNorm, tp2Norm, base + " P2");
         else
            okP2 = g_trade.Sell(InpPartialLot, Symbol(), price, slNorm, tp2Norm, base + " P2");

         if(okP2)
            Print("[Order-P2] ", EnumToString(type), " OK | lot=", InpPartialLot,
                  " | TP2=", DoubleToString(tp2Norm, _Digits));
         else
            Print("[Order-P2] GAGAL | retcode=", g_trade.ResultRetcode(), " | ", g_trade.ResultComment());
      }
   }
   else
   {
      // ── MODE NORMAL: satu posisi full lot ──
      bool ok;
      if(type == ORDER_TYPE_BUY)
         ok = g_trade.Buy (InpLotSize, Symbol(), price, slNorm, tp1Norm, base);
      else
         ok = g_trade.Sell(InpLotSize, Symbol(), price, slNorm, tp1Norm, base);

      if(ok)
      {
         g_lastEntryPrice = price;
         g_lastEntryTP    = tp1Norm;
         g_lastEntrySL    = slNorm;
         Print("[Order] ", EnumToString(type), " OK | tiket=", g_trade.ResultOrder(),
               " | harga=", DoubleToString(price, _Digits),
               " | TP=",    DoubleToString(tp1Norm, _Digits),
               " | SL=",    DoubleToString(slNorm,  _Digits));
      }
      else
         Print("[Order] GAGAL | retcode=", g_trade.ResultRetcode(), " | ", g_trade.ResultComment());
   }
}

//+------------------------------------------------------------------+
bool HasPosition(int typeFilter)
{
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))               continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(typeFilter == -1) return true;
      if((int)PositionGetInteger(POSITION_TYPE) == typeFilter) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
void CloseByType(int typeFilter)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))               continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(typeFilter != -1 && (int)PositionGetInteger(POSITION_TYPE) != typeFilter) continue;
      g_trade.PositionClose(ticket);
      Print("[Close] Posisi #", ticket, " ditutup");
   }
}

//+------------------------------------------------------------------+
void StringToUcharArray(const string text, uchar &buf[])
{
   int len = StringLen(text);
   ArrayResize(buf, len);
   StringToCharArray(text, buf, 0, len);
}

//+------------------------------------------------------------------+
//                         PANEL FUNCTIONS
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = 10, y = 25, w = 300, h = 230;
   if(ObjectFind(0, LBL_BG) >= 0) DeletePanel();

   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE,   x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE,   y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE,        w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE,        h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR,      C'12,14,22');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR, C'180,130,0');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER,       CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK,         false);
   ObjectSetInteger(0, LBL_BG, OBJPROP_SELECTABLE,   false);

   MakeLabel(LBL_TITLE,   x+8, y+6,   "RADAR GOLD SMART  v3.0",     C'220,165,0', 9);
   MakeLabel(LBL_STATUS,  x+8, y+22,  "Menghubungkan...",             clrGray,      8);
   MakeLabel(LBL_CMD,     x+8, y+42,  "---",                          clrGray,     18);
   MakeLabel(LBL_MODE,    x+8, y+72,  "Mode: NORMAL",                 clrSilver,    8);
   MakeLabel(LBL_PRICE,   x+8, y+86,  "Harga: --- | Zone: ---",      clrSilver,    8);
   MakeLabel(LBL_TPSL,    x+8, y+100, "TP1: --- TP2: --- SL: ---",   clrSilver,    8);
   MakeLabel(LBL_CONF,    x+8, y+114, "Conf: --- | Auto: OFF",        clrSilver,    8);
   MakeLabel(LBL_TRAIL,   x+8, y+128, "Trail: OFF",                   clrGray,      8);
   MakeLabel(LBL_REENTRY, x+8, y+142, "Re-entry: OFF",                clrGray,      8);
   MakeLabel(LBL_SEP,     x+8, y+158, "-------------------------------", C'80,65,0', 7);
   MakeLabel(LBL_BAL,     x+8, y+170, "Balance: ---",                 clrSilver,    8);
   MakeLabel(LBL_EQ,      x+8, y+184, "Equity:  ---",                 clrSilver,    8);
   MakeLabel(LBL_PNL,     x+8, y+198, "PnL:     ---",                 clrSilver,    8);
   MakeLabel(LBL_POS,     x+8, y+212, "Posisi: --- | Entry: ---",     clrSilver,    8);
   MakeLabel(LBL_TIME,    x+8, y+222, "---",                          C'80,65,0',   7);

   ChartRedraw();
}

//+------------------------------------------------------------------+
void MakeLabel(string name, int x, int y, string text, color clr, int sz)
{
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER,     CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE,  x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE,  y);
   ObjectSetString( 0, name, OBJPROP_TEXT,       text);
   ObjectSetInteger(0, name, OBJPROP_COLOR,      clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE,   sz);
   ObjectSetString( 0, name, OBJPROP_FONT,       "Arial");
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

//+------------------------------------------------------------------+
void SetLabelText(string name, string text, color clr)
{
   ObjectSetString( 0, name, OBJPROP_TEXT,  text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
}

//+------------------------------------------------------------------+
void UpdatePanel(string cmd)
{
   color  cmdColor;
   string cmdText;
   if(cmd == "BUY")
   {
      cmdColor = clrLime;
      cmdText  = InpReverseMode ? "BUY [REVERSE dari SELL]" : "BUY  (NAIK)";
   }
   else if(cmd == "SELL")
   {
      cmdColor = clrRed;
      cmdText  = InpReverseMode ? "SELL [REVERSE dari BUY]" : "SELL (TURUN)";
   }
   else
   {
      cmdColor = clrGray;
      cmdText  = "HOLD (TUNGGU)";
   }

   SetLabelText(LBL_CMD,    cmdText, cmdColor);
   SetLabelText(LBL_STATUS, "Terhubung | polling " + IntegerToString(POLL_INTERVAL_SEC) + "s", clrLime);
   SetLabelText(LBL_MODE,
      "Mode: " + (InpReverseMode ? "REVERSE" : "NORMAL") + " | Magic#" + IntegerToString(InpMagicNumber),
      InpReverseMode ? clrOrange : C'100,200,255');
   SetLabelText(LBL_PRICE,
      "Harga: $" + DoubleToString(g_price, 2) + " | Zone: " + DoubleToString(g_entryLow, 2) + "-" + DoubleToString(g_entryHigh, 2),
      clrSilver);
   SetLabelText(LBL_TPSL,
      "TP1:" + DoubleToString(g_tp1, 2) + " TP2:" + DoubleToString(g_tp2, 2) + " SL:" + DoubleToString(g_sl, 2),
      clrSilver);
   SetLabelText(LBL_CONF,
      "Conf: " + DoubleToString(g_conf * 100, 0) + "% | Auto: " + (InpAutoTrade ? "ON" : "OFF"),
      InpAutoTrade ? clrLime : clrGray);
   string trailInfo = "";
   if(InpTrailP1) trailInfo += "P1:act" + IntegerToString(InpTrailP1Act) + "p/d" + IntegerToString(InpTrailP1Dist) + "p ";
   if(InpTrailP2) trailInfo += "P2:act" + IntegerToString(InpTrailP2Act) + "p/d" + IntegerToString(InpTrailP2Dist) + "p";
   bool anyTrail = InpTrailP1 || InpTrailP2;
   SetLabelText(LBL_TRAIL,
      anyTrail ? "Trail: " + trailInfo : "Trail: OFF",
      anyTrail ? C'100,200,255' : clrGray);

   if(!g_waitingReentry)
      SetLabelText(LBL_REENTRY,
         "Re-entry: " + (InpSmartReentry ? "Aktif" : "OFF"),
         clrGray);

   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double totalPnl = 0.0;
   int    openPos  = 0;

   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))               continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      totalPnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      openPos++;
   }

   string pnlSign = (totalPnl >= 0) ? "+" : "";
   color  pnlClr  = (totalPnl >= 0) ? clrLime : clrRed;

   SetLabelText(LBL_BAL, "Balance: " + DoubleToString(balance, 2) + " USD", clrSilver);
   SetLabelText(LBL_EQ,  "Equity:  " + DoubleToString(equity,  2) + " USD", clrSilver);
   SetLabelText(LBL_PNL, "PnL:     " + pnlSign + DoubleToString(totalPnl, 2) + " USD", pnlClr);
   SetLabelText(LBL_POS,
      "Posisi: " + IntegerToString(openPos) + " | Entry: " + (g_lastEntryPrice > 0 ? "$" + DoubleToString(g_lastEntryPrice, 2) : "---"),
      clrSilver);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   SetLabelText(LBL_TIME,
      StringFormat("Update: %02d:%02d:%02d | RadarGoldSmart v3", dt.hour, dt.min, dt.sec),
      C'80,65,0');

   ChartRedraw();
}

//+------------------------------------------------------------------+
void DeletePanel()
{
   string labels[] = {
      LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD, LBL_MODE,
      LBL_PRICE, LBL_TPSL, LBL_CONF, LBL_TRAIL, LBL_REENTRY,
      LBL_SEP, LBL_BAL, LBL_EQ, LBL_PNL, LBL_POS, LBL_TIME
   };
   for(int i = 0; i < ArraySize(labels); i++)
      ObjectDelete(0, labels[i]);
   ChartRedraw();
}
//+------------------------------------------------------------------+
