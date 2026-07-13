//+------------------------------------------------------------------+
//|                                               pujya-ea4.mq5      |
//|                              Pujya EA 4 — GoldRadar.ai           |
//|  Mode: Stack tanpa TP/SL individual                              |
//|  Setiap sinyal baru (BUY/SELL) → buka LIMIT order baru          |
//|  Fitur: Auto ON, Maks Posisi, Basket TP                          |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property version   "4.00"
#property description "Pujya EA 4 - Stack LIMIT order | Auto ON | Maks Posisi | Basket TP"

#include <Trade\Trade.mqh>

#define POLL_INTERVAL_SEC 3

//--- Input Parameters
input group "=== Koneksi API ==="
input string InpApiUrl   = "";   // URL API (dari halaman admin)
input string InpEaApiKey = "";   // EA API Key (dari halaman admin)

input group "=== Trading ==="
input double InpLotSize            = 0.01;  // Lot per order
input bool   InpAutoTrade          = true;  // true = eksekusi otomatis
input int    InpMagicNumber        = 404040;// Magic number unik Pujya EA 4
input bool   InpReverseMode        = false; // Balik sinyal (BUY↔SELL)
input int    InpCooldownSec        = 0;     // Cooldown antar order (detik), 0 = tidak ada batas
input double InpPriceChangeTrigger = 0.5;  // Buka order baru jika harga sinyal bergeser >= nilai ini ($), 0 = matikan

input group "=== Maks Posisi ==="
input int    InpMaxPositions = 5;   // Maks total posisi + pending (0 = tidak ada batas)

input group "=== Basket TP ==="
input double InpBasketTP    = 50.0; // Basket TP: tutup semua jika floating P/L >= $X (0 = nonaktif)
input bool   InpBasketReset = true; // Setelah Basket TP kena, izinkan stack baru mulai lagi

input group "=== Tampilan ==="
input bool InpShowPanel = true;

//--- Panel label names
#define LBL_BG      "PE4_BG"
#define LBL_TITLE   "PE4_TITLE"
#define LBL_STATUS  "PE4_STATUS"
#define LBL_CMD     "PE4_CMD"
#define LBL_STACK   "PE4_STACK"
#define LBL_PNL     "PE4_PNL"
#define LBL_BASKET  "PE4_BASKET"
#define LBL_CONF    "PE4_CONF"
#define LBL_LAST    "PE4_LAST"
#define LBL_TIME    "PE4_TIME"

//--- Global state
CTrade   g_trade;
datetime g_lastPoll     = 0;
datetime g_lastOrderAt  = 0;

string   g_rawCmd        = "HOLD";
string   g_lastExec      = "HOLD";
double   g_lastExecPrice = 0;
double   g_price         = 0;
double   g_conf          = 0;

int      g_totalOrders  = 0;
bool     g_basketHit    = false;   // Basket TP baru saja kena (untuk log sekali)

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(30);

   g_totalOrders = CountOwnPositions() + CountOwnPendingOrders();

   if(InpShowPanel) CreatePanel();

   Print("=== Pujya EA 4 aktif ===");
   Print("URL          : ", InpApiUrl);
   Print("Magic#       : ", InpMagicNumber);
   Print("Lot          : ", DoubleToString(InpLotSize, 2));
   Print("AutoTrade    : ", InpAutoTrade ? "ON" : "OFF");
   Print("Reverse      : ", InpReverseMode ? "ON" : "OFF");
   Print("Cooldown     : ", InpCooldownSec > 0 ? IntegerToString(InpCooldownSec) + "s" : "TIDAK ADA");
   Print("PriceTrigger : ", InpPriceChangeTrigger > 0 ? "$" + DoubleToString(InpPriceChangeTrigger, 2) : "MATI");
   Print("MaksPos      : ", InpMaxPositions > 0 ? IntegerToString(InpMaxPositions) : "TIDAK ADA");
   Print("BasketTP     : ", InpBasketTP > 0 ? "$" + DoubleToString(InpBasketTP, 2) : "NONAKTIF");
   Print("Posisi ada   : ", g_totalOrders);

   FetchAndProcess();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(InpShowPanel) DeletePanel();
   Print("Pujya EA 4 dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(InpShowPanel) UpdatePanelPnl();

   // --- Cek Basket TP setiap tick ---
   CheckBasketTP();

   if(TimeCurrent() - g_lastPoll < POLL_INTERVAL_SEC) return;
   g_lastPoll = TimeCurrent();

   PushAccountData();
   FetchAndProcess();
}

//+------------------------------------------------------------------+
//  BASKET TP — tutup semua posisi jika total floating P&L >= target
//+------------------------------------------------------------------+
void CheckBasketTP()
{
   if(InpBasketTP <= 0) return;
   if(CountOwnPositions() == 0) return;

   double pnl = CalcFloatingPnl();
   if(pnl >= InpBasketTP)
   {
      Print("=== [Pujya EA 4] 🎯 BASKET TP KENA! Floating=$", DoubleToString(pnl, 2),
            " >= Target=$", DoubleToString(InpBasketTP, 2), " — Tutup semua posisi.");
      CloseAllOwn();
      g_basketHit = true;

      if(InpBasketReset)
      {
         // Reset state agar bisa stack lagi dari nol setelah basket kena
         g_lastExec      = "HOLD";
         g_lastExecPrice = 0;
         g_lastOrderAt   = 0;
         Print("[Pujya EA 4] Reset state — siap mulai stack baru.");
      }

      if(InpShowPanel)
      {
         SetLabelText(LBL_BASKET,
            "🎯 BASKET TP HIT! +$" + DoubleToString(pnl, 2) +
            " | Target $" + DoubleToString(InpBasketTP, 2),
            clrGold);
         ChartRedraw();
      }
   }
}

//+------------------------------------------------------------------+
//  Tutup semua posisi terbuka & hapus semua pending order milik EA ini
//+------------------------------------------------------------------+
void CloseAllOwn()
{
   // Tutup posisi terbuka
   for(int idx = PositionsTotal() - 1; idx >= 0; idx--)
   {
      ulong ticket = PositionGetTicket(idx);
      if(!PositionSelectByTicket(ticket))                 continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol())  continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(!g_trade.PositionClose(ticket))
         Print("[Pujya EA 4] ⚠ Gagal tutup posisi #", ticket, ": ", g_trade.ResultComment());
   }
   // Hapus pending order
   for(int idx = OrdersTotal() - 1; idx >= 0; idx--)
   {
      ulong ticket = OrderGetTicket(idx);
      if(!OrderSelect(ticket))                            continue;
      if(OrderGetString(ORDER_SYMBOL) != Symbol())        continue;
      if((int)OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;
      if(!g_trade.OrderDelete(ticket))
         Print("[Pujya EA 4] ⚠ Gagal hapus pending #", ticket, ": ", g_trade.ResultComment());
   }
   Print("[Pujya EA 4] Semua posisi/pending ditutup. Sisa Open=",
         CountOwnPositions(), " Pending=", CountOwnPendingOrders());
}

//+------------------------------------------------------------------+
int CountOwnPositions()
{
   int count = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      count++;
   }
   return count;
}

//+------------------------------------------------------------------+
int CountOwnPendingOrders()
{
   int count = 0;
   for(int i = 0; i < OrdersTotal(); i++)
   {
      ulong t = OrderGetTicket(i);
      if(!OrderSelect(t)) continue;
      if(OrderGetString(ORDER_SYMBOL) != Symbol()) continue;
      if((int)OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;
      count++;
   }
   return count;
}

//+------------------------------------------------------------------+
double CalcFloatingPnl()
{
   double pnl = 0;
   for(int i = 0; i < PositionsTotal(); i++)
   {
      ulong t = PositionGetTicket(i);
      if(!PositionSelectByTicket(t)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      pnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   return pnl;
}

//+------------------------------------------------------------------+
//  Buka LIMIT order baru (dengan cek maks posisi)
//+------------------------------------------------------------------+
bool OpenPendingOrder(string cmd)
{
   if(g_price <= 0)
   {
      Print("[Pujya EA 4] ❌ Harga sinyal tidak valid ($", DoubleToString(g_price, 2), ") — dibatalkan.");
      return false;
   }

   // --- CEK MAKS POSISI ---
   if(InpMaxPositions > 0)
   {
      int total = CountOwnPositions() + CountOwnPendingOrders();
      if(total >= InpMaxPositions)
      {
         Print("[Pujya EA 4] 🚫 Maks posisi tercapai (", total, "/", InpMaxPositions,
               ") — order baru diblokir.");
         return false;
      }
   }

   int    digits  = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double limitPx = NormalizeDouble(g_price, digits);
   string comment = "PE4-" + cmd + "-" + IntegerToString((int)TimeCurrent());
   bool   ok;

   if(cmd == "BUY")
      ok = g_trade.BuyLimit(InpLotSize, limitPx, Symbol(), 0, 0, ORDER_TIME_GTC, 0, comment);
   else
      ok = g_trade.SellLimit(InpLotSize, limitPx, Symbol(), 0, 0, ORDER_TIME_GTC, 0, comment);

   if(ok)
   {
      g_totalOrders++;
      g_lastOrderAt   = TimeCurrent();
      g_lastExecPrice = g_price;
      g_basketHit     = false;  // reset flag basket setelah order baru masuk
      Print("[Pujya EA 4] ✅ ", cmd, " LIMIT @$", DoubleToString(limitPx, digits),
            " lot=", DoubleToString(InpLotSize, 2),
            " | Open: ", CountOwnPositions(),
            " | Pending: ", CountOwnPendingOrders(),
            " | Maks: ", InpMaxPositions > 0 ? IntegerToString(InpMaxPositions) : "∞");
   }
   else
   {
      Print("[Pujya EA 4] ❌ GAGAL: retcode=", g_trade.ResultRetcode(),
            " | ", g_trade.ResultComment(),
            " | harga=$", DoubleToString(limitPx, digits));
   }
   return ok;
}

//+------------------------------------------------------------------+
void FetchAndProcess()
{
   string url = InpApiUrl + "/api/xauusd/ea-signal"
              + "?key=" + InpEaApiKey
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
         ? "Tambahkan URL di: Tools > Options > Expert Advisors > Allow WebRequest"
         : "Koneksi gagal (err=" + IntegerToString(err) + ")";
      Print("[ERROR] ", msg);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "❌ " + msg, clrRed);
      return;
   }
   if(code != 200)
   {
      string errBody = CharArrayToString(recvBuf);
      Print("[ERROR] HTTP ", code, ": ", errBody);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "HTTP " + IntegerToString(code), clrRed);
      return;
   }

   //--- Parse: CMD|PRICE|TP1|TP2|TP3|SL|ENTRY_LOW|ENTRY_HIGH|CONFIDENCE
   string resp = CharArrayToString(recvBuf);
   StringTrimRight(resp);
   StringTrimLeft(resp);

   string parts[];
   int numParts = StringSplit(resp, '|', parts);

   if(numParts < 2)
   {
      Print("[ERROR] Respons tidak valid: ", resp);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "Respons tidak valid", clrRed);
      return;
   }

   g_rawCmd = parts[0];
   g_price  = StringToDouble(parts[1]);
   g_conf   = (numParts >= 9) ? StringToDouble(parts[8]) : 0;

   // Terapkan reverse mode
   string cmd = g_rawCmd;
   if(InpReverseMode)
   {
      if(cmd == "BUY")       cmd = "SELL";
      else if(cmd == "SELL") cmd = "BUY";
   }

   Print("[Sinyal] ", g_rawCmd,
         (InpReverseMode && cmd != g_rawCmd ? " → " + cmd + " (REVERSE)" : ""),
         " | $", DoubleToString(g_price, 2),
         " | Conf=", DoubleToString(g_conf * 100, 0), "%",
         " | Open=", CountOwnPositions(),
         " | Pending=", CountOwnPendingOrders());

   if(InpShowPanel) UpdatePanel(cmd);
   if(!InpAutoTrade) return;

   // HOLD → biarkan posisi yang ada
   if(cmd == "HOLD") return;

   // Cek perubahan arah dan harga
   bool dirChanged  = (cmd != g_lastExec);
   bool priceChanged = false;
   if(InpPriceChangeTrigger > 0 && g_lastExecPrice > 0 && g_price > 0)
      priceChanged = (MathAbs(g_price - g_lastExecPrice) >= InpPriceChangeTrigger);

   if(!dirChanged && !priceChanged)
      return;

   // Cek cooldown
   if(InpCooldownSec > 0 && g_lastOrderAt > 0)
   {
      int elapsed = (int)(TimeCurrent() - g_lastOrderAt);
      if(elapsed < InpCooldownSec)
      {
         Print("[Pujya EA 4] ⏳ Cooldown: ", elapsed, "s / ", InpCooldownSec, "s — ditunda.",
               " (trigger: ", dirChanged ? "arah baru" : "harga bergeser $" + DoubleToString(MathAbs(g_price - g_lastExecPrice), 2), ")");
         return;
      }
   }

   if(dirChanged)
   {
      Print("[Pujya EA 4] 🔀 Arah berubah: ", g_lastExec, " → ", cmd,
            " @$", DoubleToString(g_price, 2), " — tutup semua lama.");
      CloseAllOwn();
   }
   else
      Print("[Pujya EA 4] 🔄 Harga bergeser: $", DoubleToString(g_lastExecPrice, 2),
            " → $", DoubleToString(g_price, 2),
            " (selisih $", DoubleToString(MathAbs(g_price - g_lastExecPrice), 2), ") — stack baru");

   bool executed = OpenPendingOrder(cmd);
   if(executed) g_lastExec = cmd;
}

//+------------------------------------------------------------------+
void PushAccountData()
{
   if(StringLen(InpApiUrl) == 0 || StringLen(InpEaApiKey) == 0) return;

   string url = InpApiUrl + "/api/xauusd/ea-account?key=" + InpEaApiKey;

   string posJson  = "[";
   double totalPnl = 0.0;
   int    total    = PositionsTotal();
   bool   first    = true;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if((int)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      double             pnl   = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      totalPnl                += pnl;
      ENUM_POSITION_TYPE pt    = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string             ptype = (pt == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      if(!first) posJson += ",";
      first = false;
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
              + ",\"openTime\":\""   + TimeToString((datetime)PositionGetInteger(POSITION_TIME), TIME_DATE|TIME_MINUTES) + "\""
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
   int    len = StringLen(body);
   ArrayResize(postBuf, len);
   StringToCharArray(body, postBuf, 0, len);
   WebRequest("POST", url, "Content-Type: application/json\r\n", 3000, postBuf, resBuf, resHeaders);
}

//+------------------------------------------------------------------+
//                         PANEL
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = 10, y = 25, w = 300, h = 205;
   if(ObjectFind(0, LBL_BG) >= 0) DeletePanel();

   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE,   x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE,   y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE,        w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE,        h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR,      C'10,12,20');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR, C'180,80,220');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER,       CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK,         false);
   ObjectSetInteger(0, LBL_BG, OBJPROP_SELECTABLE,   false);

   MakeLabel(LBL_TITLE,  x+8, y+6,   "PUJYA EA 4  —  Stack + Basket TP",  C'180,80,220', 9);
   MakeLabel(LBL_STATUS, x+8, y+22,  "Menghubungkan...",                    clrGray,       8);
   MakeLabel(LBL_CMD,    x+8, y+40,  "---",                                 clrGray,      18);
   MakeLabel(LBL_STACK,  x+8, y+75,  "Open: 0  Pending: 0  (dipasang: 0)", clrSilver,     8);
   MakeLabel(LBL_PNL,    x+8, y+89,  "Floating P/L: $0.00",                clrSilver,     8);
   MakeLabel(LBL_BASKET, x+8, y+103, "Basket TP: menunggu...",              clrGray,       8);
   MakeLabel(LBL_CONF,   x+8, y+117, "Conf: --- | Auto: ON",               clrSilver,     8);
   MakeLabel(LBL_LAST,   x+8, y+131, "Eksekusi terakhir: ---",             clrGray,       8);
   MakeLabel(LBL_TIME,   x+8, y+183, "---",                                 C'90,40,120',  7);

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
void UpdatePanelPnl()
{
   if(!InpShowPanel) return;
   int    openCnt    = CountOwnPositions();
   int    pendingCnt = CountOwnPendingOrders();
   double pnl        = CalcFloatingPnl();
   int    totalSlot  = openCnt + pendingCnt;

   // Baris stack
   string maxStr = InpMaxPositions > 0 ? IntegerToString(InpMaxPositions) : "∞";
   color  stackClr = (InpMaxPositions > 0 && totalSlot >= InpMaxPositions) ? clrOrange : clrSilver;
   SetLabelText(LBL_STACK,
      "Open: " + IntegerToString(openCnt) +
      "  Pending: " + IntegerToString(pendingCnt) +
      "  Maks: " + maxStr +
      "  (total: " + IntegerToString(g_totalOrders) + ")",
      stackClr);

   // Baris P&L
   SetLabelText(LBL_PNL,
      "Floating P/L: " + (pnl >= 0 ? "+$" : "-$") + DoubleToString(MathAbs(pnl), 2),
      pnl >= 0 ? clrLime : clrRed);

   // Baris Basket TP
   if(InpBasketTP > 0 && openCnt > 0)
   {
      double pct = (InpBasketTP > 0) ? (pnl / InpBasketTP * 100.0) : 0;
      string basketStr = "Basket TP: " +
         (pnl >= 0 ? "+" : "") + "$" + DoubleToString(pnl, 2) +
         " / $" + DoubleToString(InpBasketTP, 2) +
         " (" + DoubleToString(pct, 0) + "%)";
      color basketClr = (pnl >= InpBasketTP * 0.8) ? clrYellow : clrSilver;
      if(pnl >= InpBasketTP) basketClr = clrGold;
      SetLabelText(LBL_BASKET, basketStr, basketClr);
   }
   else if(InpBasketTP > 0)
   {
      SetLabelText(LBL_BASKET,
         "Basket TP: $" + DoubleToString(InpBasketTP, 2) + " | tidak ada posisi",
         clrGray);
   }
   else
   {
      SetLabelText(LBL_BASKET, "Basket TP: nonaktif", clrGray);
   }

   ChartRedraw();
}

//+------------------------------------------------------------------+
void UpdatePanel(string cmd)
{
   color  cmdColor;
   string cmdText;
   if(cmd == "BUY")       { cmdColor = clrLime;   cmdText = "BUY  (NAIK) ↑"; }
   else if(cmd == "SELL") { cmdColor = clrTomato; cmdText = "SELL (TURUN) ↓"; }
   else                   { cmdColor = clrGray;   cmdText = "HOLD (TUNGGU)"; }

   string maxStr = InpMaxPositions > 0 ? " | Maks:" + IntegerToString(InpMaxPositions) : "";

   SetLabelText(LBL_STATUS,
      "✅ Terhubung | poll " + IntegerToString(POLL_INTERVAL_SEC) + "s | " + Symbol() + maxStr,
      clrLime);
   SetLabelText(LBL_CMD,
      cmdText + "  $" + DoubleToString(g_price, 2),
      cmdColor);
   SetLabelText(LBL_CONF,
      "Conf: " + DoubleToString(g_conf * 100, 0) + "% | Auto: " + (InpAutoTrade ? "ON ✅" : "OFF"),
      InpAutoTrade ? clrLime : clrGray);
   string lastInfo = "---";
   if(g_lastExec != "HOLD" && g_lastOrderAt > 0)
      lastInfo = g_lastExec
               + " | $" + DoubleToString(g_lastExecPrice, 2)
               + " @" + TimeToString(g_lastOrderAt, TIME_MINUTES|TIME_SECONDS);
   SetLabelText(LBL_LAST, "Eksekusi: " + lastInfo, clrSilver);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   SetLabelText(LBL_TIME,
      StringFormat("Update: %02d:%02d:%02d | Pujya EA 4 v4.0", dt.hour, dt.min, dt.sec),
      C'90,40,120');

   UpdatePanelPnl();
   ChartRedraw();
}

//+------------------------------------------------------------------+
void DeletePanel()
{
   string labels[] = {
      LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD,
      LBL_STACK, LBL_PNL, LBL_BASKET, LBL_CONF, LBL_LAST, LBL_TIME
   };
   for(int i = 0; i < ArraySize(labels); i++)
      ObjectDelete(0, labels[i]);
   ChartRedraw();
}
//+------------------------------------------------------------------+
