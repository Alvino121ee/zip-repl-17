//+------------------------------------------------------------------+
//|                                        SahamRadarMentorEA.mq5   |
//|                         Saham Radar - Mentor Mode Expert Advisor |
//|                                                                  |
//| Polling sinyal & push data akun setiap 2 detik                  |
//| (sinkron dengan Mentor Mode widget di dashboard)                 |
//+------------------------------------------------------------------+
#property copyright "Saham Radar"
#property version   "2.20"
#property description "Mentor Mode EA - Saham Radar AI Trading"

#include <Trade\Trade.mqh>

//--- Input Parameters
input group "=== Koneksi API ==="
input string InpApiUrl      = "https://8ae1aa97-4c85-4df7-a5c8-a0a0d4f6f453-00-112mi78mouw69.pike.replit.dev";
input string InpEaApiKey    = "sr_ea_79c5d01e86372a5dcf112d0b9ddfdd78ea851deb7400277c";
input string InpSensitivity = "normal"; // aggressive / normal / conservative

input group "=== Trading ==="
input double InpLotSize     = 0.01;
input bool   InpAutoTrade   = false;
input int    InpMagicNumber = 202607;

input group "=== Tampilan ==="
input bool   InpShowPanel   = true;

//--- Constants
#define POLL_INTERVAL_SEC 2

//--- Label names
#define LBL_BG     "SR_BG"
#define LBL_TITLE  "SR_TITLE"
#define LBL_STATUS "SR_STATUS"
#define LBL_CMD    "SR_CMD"
#define LBL_PRICE  "SR_PRICE"
#define LBL_TPSL   "SR_TPSL"
#define LBL_CONF   "SR_CONF"
#define LBL_SEP    "SR_SEP"
#define LBL_BAL    "SR_BAL"
#define LBL_EQ     "SR_EQ"
#define LBL_PNL    "SR_PNL"
#define LBL_POS    "SR_POS"
#define LBL_TIME   "SR_TIME"

//--- Global variables
CTrade   g_trade;
datetime g_lastPoll    = 0;
string   g_lastCommand = "HOLD";

double   g_price = 0;
double   g_tp    = 0;
double   g_sl    = 0;
double   g_conf  = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpEaApiKey == "")
   {
      Alert("Saham Radar EA: EaApiKey kosong!");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(20);

   if(InpShowPanel) CreatePanel();

   Print("Saham Radar Mentor EA v2.20 aktif - polling ", POLL_INTERVAL_SEC, "s");
   Print("URL: ", InpApiUrl);

   FetchAndProcess();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(InpShowPanel) DeletePanel();
   Print("Saham Radar Mentor EA dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(TimeCurrent() - g_lastPoll < POLL_INTERVAL_SEC) return;
   g_lastPoll = TimeCurrent();
   PushAccountData();
   FetchAndProcess();
}

//+------------------------------------------------------------------+
// Helper: konversi string ke uchar array (tanpa null terminator)
void StringToUcharArray(const string text, uchar &buf[])
{
   int len = StringLen(text);
   ArrayResize(buf, len);
   StringToCharArray(text, buf, 0, len);
}

//+------------------------------------------------------------------+
void PushAccountData()
{
   string url = InpApiUrl + "/api/xauusd/ea-account?key=" + InpEaApiKey;

   //--- Build positions JSON
   string posJson  = "[";
   double totalPnl = 0.0;
   int    total    = PositionsTotal();

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;

      double              pnl   = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      totalPnl                 += pnl;
      ENUM_POSITION_TYPE  pt    = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string              ptype = (pt == POSITION_TYPE_BUY) ? "BUY" : "SELL";

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

   //--- Build JSON body
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

   // WebRequest 7-param: (method, url, headers, timeout, data[], result[], result_headers)
   uchar  postBuf[];
   uchar  resBuf[];
   string resHeaders = "";
   StringToUcharArray(body, postBuf);
   WebRequest("POST", url, "Content-Type: application/json\r\n", 3000, postBuf, resBuf, resHeaders);
   //--- Ignore result - push is best-effort
}

//+------------------------------------------------------------------+
void FetchAndProcess()
{
   string url = InpApiUrl + "/api/xauusd/ea-signal"
              + "?key="         + InpEaApiKey
              + "&sensitivity=" + InpSensitivity
              + "&format=plain";

   // WebRequest 7-param: (method, url, headers, timeout, data[], result[], result_headers)
   uchar  sendBuf[];   // empty for GET
   uchar  recvBuf[];
   string resHeaders = "";

   ResetLastError();
   int code = WebRequest("GET", url, "Accept: text/plain\r\n", 3000, sendBuf, recvBuf, resHeaders);

   if(code == -1)
   {
      int err = GetLastError();
      string msg;
      if(err == 5203)
         msg = "Tambahkan URL di: Tools > Options > Expert Advisors > Allow WebRequest";
      else
         msg = "Koneksi error: " + IntegerToString(err);
      Print("ERROR: ", msg);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "ERROR " + IntegerToString(err), clrRed);
      return;
   }

   if(code != 200)
   {
      string body = CharArrayToString(recvBuf);
      Print("API error HTTP ", code, ": ", body);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "HTTP " + IntegerToString(code), clrRed);
      return;
   }

   //--- Parse response: COMMAND|PRICE|TP|SL|CONFIDENCE
   string resp = CharArrayToString(recvBuf);
   StringTrimRight(resp);
   StringTrimLeft(resp);

   string parts[];
   if(StringSplit(resp, '|', parts) < 5)
   {
      Print("Respons tidak valid: ", resp);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "Respons tidak valid", clrRed);
      return;
   }

   string cmd = parts[0];
   g_price    = StringToDouble(parts[1]);
   g_tp       = StringToDouble(parts[2]);
   g_sl       = StringToDouble(parts[3]);
   g_conf     = StringToDouble(parts[4]);

   Print("Sinyal: ", cmd,
         " | Harga: ", DoubleToString(g_price, 2),
         " | TP: ",    DoubleToString(g_tp, 2),
         " | SL: ",    DoubleToString(g_sl, 2),
         " | Conf: ",  DoubleToString(g_conf * 100, 0), "%");

   if(InpShowPanel) UpdatePanel(cmd);

   //--- Auto trading
   if(InpAutoTrade)
   {
      string prevCmd = g_lastCommand;
      g_lastCommand  = cmd;

      if(cmd != prevCmd || !HasPosition(-1))
      {
         if(cmd == "BUY")
         {
            CloseByType(POSITION_TYPE_SELL);
            if(!HasPosition(POSITION_TYPE_BUY))
               OpenOrder(ORDER_TYPE_BUY);
         }
         else if(cmd == "SELL")
         {
            CloseByType(POSITION_TYPE_BUY);
            if(!HasPosition(POSITION_TYPE_SELL))
               OpenOrder(ORDER_TYPE_SELL);
         }
         else // HOLD
         {
            CloseByType(-1);
         }
      }
   }
   else
   {
      g_lastCommand = cmd;
   }
}

//+------------------------------------------------------------------+
void OpenOrder(ENUM_ORDER_TYPE type)
{
   double price  = (type == ORDER_TYPE_BUY)
                 ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
                 : SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double tpNorm = NormalizeDouble(g_tp, _Digits);
   double slNorm = NormalizeDouble(g_sl, _Digits);
   string cmt    = "SahamRadar " + DoubleToString(g_conf * 100, 0) + "%";

   bool ok;
   if(type == ORDER_TYPE_BUY)
      ok = g_trade.Buy(InpLotSize, Symbol(), price, slNorm, tpNorm, cmt);
   else
      ok = g_trade.Sell(InpLotSize, Symbol(), price, slNorm, tpNorm, cmt);

   if(ok)
      Print("Order OK: ", EnumToString(type), " tiket=", g_trade.ResultOrder());
   else
      Print("Order GAGAL: retcode=", g_trade.ResultRetcode(), " ", g_trade.ResultComment());
}

//+------------------------------------------------------------------+
bool HasPosition(int typeFilter)
{
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))          continue;
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
   }
}

//+------------------------------------------------------------------+
//--- Panel functions
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = 10, y = 25, w = 280, h = 195;

   if(ObjectFind(0, LBL_BG) >= 0) DeletePanel();

   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE,    x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE,    y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE,         w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE,         h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR,       C'15,15,25');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR,  C'60,60,90');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER,        CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK,          false);
   ObjectSetInteger(0, LBL_BG, OBJPROP_SELECTABLE,    false);

   MakeLabel(LBL_TITLE,  x+8, y+6,   "SAHAM RADAR MENTOR",   clrWhite,   9);
   MakeLabel(LBL_STATUS, x+8, y+22,  "Menghubungkan...",      clrGray,    8);
   MakeLabel(LBL_CMD,    x+8, y+44,  "---",                   clrGray,   18);
   MakeLabel(LBL_PRICE,  x+8, y+72,  "Harga: ---",            clrSilver,  8);
   MakeLabel(LBL_TPSL,   x+8, y+86,  "TP: --- | SL: ---",    clrSilver,  8);
   MakeLabel(LBL_CONF,   x+8, y+100, "Conf: ---",             clrSilver,  8);
   MakeLabel(LBL_SEP,    x+8, y+114, "------------------------", C'55,55,80', 7);
   MakeLabel(LBL_BAL,    x+8, y+126, "Balance: ---",          clrSilver,  8);
   MakeLabel(LBL_EQ,     x+8, y+140, "Equity:  ---",          clrSilver,  8);
   MakeLabel(LBL_PNL,    x+8, y+154, "PnL:     ---",          clrSilver,  8);
   MakeLabel(LBL_POS,    x+8, y+168, "Posisi:  ---",          clrSilver,  8);
   MakeLabel(LBL_TIME,   x+8, y+182, "---",                   C'55,55,80', 7);

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

   if(cmd == "BUY")        { cmdColor = clrLime;  cmdText = "BUY  (NAIK)";  }
   else if(cmd == "SELL")  { cmdColor = clrRed;   cmdText = "SELL (TURUN)"; }
   else                    { cmdColor = clrGray;  cmdText = "HOLD (TUNGGU)";}

   SetLabelText(LBL_CMD,    cmdText,  cmdColor);
   SetLabelText(LBL_STATUS, "Terhubung (2s)", clrLime);
   SetLabelText(LBL_PRICE,  "Harga: " + DoubleToString(g_price, 2), clrSilver);
   SetLabelText(LBL_TPSL,
      "TP: " + DoubleToString(g_tp, 2) + " | SL: " + DoubleToString(g_sl, 2),
      clrSilver);
   SetLabelText(LBL_CONF,
      "Conf: " + DoubleToString(g_conf * 100, 0) + "% | Auto=" + (InpAutoTrade ? "ON" : "OFF"),
      clrSilver);

   //--- Account info (langsung baca dari MT5 lokal)
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

   SetLabelText(LBL_BAL, "Balance: " + DoubleToString(balance,  2) + " USD", clrSilver);
   SetLabelText(LBL_EQ,  "Equity:  " + DoubleToString(equity,   2) + " USD", clrSilver);
   SetLabelText(LBL_PNL, "PnL:     " + pnlSign + DoubleToString(totalPnl, 2) + " USD", pnlClr);
   SetLabelText(LBL_POS, "Posisi:  " + IntegerToString(openPos) + " terbuka", clrSilver);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   SetLabelText(LBL_TIME,
      StringFormat("Update: %02d:%02d:%02d", dt.hour, dt.min, dt.sec),
      C'55,55,80');

   ChartRedraw();
}

//+------------------------------------------------------------------+
void DeletePanel()
{
   string labels[] = {
      LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD,
      LBL_PRICE, LBL_TPSL, LBL_CONF, LBL_SEP,
      LBL_BAL, LBL_EQ, LBL_PNL, LBL_POS, LBL_TIME
   };
   for(int i = 0; i < ArraySize(labels); i++)
      ObjectDelete(0, labels[i]);
   ChartRedraw();
}
//+------------------------------------------------------------------+
