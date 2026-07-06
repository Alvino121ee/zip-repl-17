//+------------------------------------------------------------------+
//|                                        SahamRadarMentorEA.mq5   |
//|                          Saham Radar — Mentor Mode Expert Advisor|
//|                                                                  |
//| Polling sinyal & push data akun setiap 2 detik                  |
//| (sinkron dengan Mentor Mode widget di dashboard)                 |
//|                                                                  |
//| Cara pakai:                                                      |
//| 1. Isi ApiUrl dengan URL Replit kamu                             |
//| 2. Isi EaApiKey dengan kunci dari Admin Panel                    |
//| 3. MT5: Tools > Options > Expert Advisors >                      |
//|    centang "Allow WebRequest for listed URLs"                    |
//|    → tambahkan URL API kamu                                      |
//| 4. Pasang EA di chart XAUUSD                                     |
//+------------------------------------------------------------------+
#property copyright "Saham Radar"
#property version   "2.00"
#property description "Mentor Mode EA — sinkron 2 detik dengan dashboard Saham Radar"
#property strict

#include <Trade\Trade.mqh>

//─── Input Parameters ─────────────────────────────────────────────────────────
input group "=== Koneksi API ==="
input string   InpApiUrl      = "https://8ae1aa97-4c85-4df7-a5c8-a0a0d4f6f453-00-112mi78mouw69.pike.replit.dev"; // URL API
input string   InpEaApiKey    = "sr_ea_79c5d01e86372a5dcf112d0b9ddfdd78ea851deb7400277c";                        // EA API Key
input string   InpSensitivity = "normal";                           // Sensitivitas: aggressive/normal/conservative

input group "=== Trading ==="
input double   InpLotSize     = 0.01;   // Ukuran lot
input bool     InpAutoTrade   = false;  // Aktifkan auto-trading otomatis
input int      InpMagicNumber = 202607; // Magic number (unik per EA)

input group "=== Tampilan ==="
input bool     InpShowPanel   = true;   // Tampilkan panel sinyal di chart

//─── Konstanta ────────────────────────────────────────────────────────────────
// Polling setiap 2 detik — sinkron dengan Mentor Mode widget
#define POLL_INTERVAL_SEC 2

//─── Global State ─────────────────────────────────────────────────────────────
CTrade   trade;
datetime g_lastPoll    = 0;
string   g_lastCommand = "HOLD";
bool     g_connected   = false;
int      g_errCount    = 0;

// Data panel
double   g_price       = 0;
double   g_tp          = 0;
double   g_sl          = 0;
double   g_conf        = 0;

//─── Label names ──────────────────────────────────────────────────────────────
#define LBL_BG      "SR_BG"
#define LBL_TITLE   "SR_TITLE"
#define LBL_STATUS  "SR_STATUS"
#define LBL_CMD     "SR_CMD"
#define LBL_PRICE   "SR_PRICE"
#define LBL_TPSL    "SR_TPSL"
#define LBL_CONF    "SR_CONF"
#define LBL_SEP     "SR_SEP"
#define LBL_BAL     "SR_BAL"
#define LBL_EQ      "SR_EQ"
#define LBL_PNL     "SR_PNL"
#define LBL_POS     "SR_POS"
#define LBL_TIME    "SR_TIME"

//+------------------------------------------------------------------+
int OnInit() {
   if (InpEaApiKey == "") {
      Alert("❌ Saham Radar EA: EaApiKey kosong — hubungi admin!");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);

   if (InpShowPanel) {
      CreatePanel();
      UpdatePanelStatus("Menghubungkan...", clrGray);
   }

   Print("✅ Saham Radar Mentor EA v2.00 aktif — polling setiap ", POLL_INTERVAL_SEC, " detik");
   Print("   URL  : ", InpApiUrl);
   Print("   Mode : AutoTrade=", InpAutoTrade, " | Lot=", InpLotSize);

   FetchAndProcess(); // poll langsung saat start
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   if (InpShowPanel) DeletePanel();
   Print("Saham Radar Mentor EA dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick() {
   if (TimeCurrent() - g_lastPoll < POLL_INTERVAL_SEC) return;
   g_lastPoll = TimeCurrent();
   PushAccountData(); // push dulu agar dashboard selalu fresh
   FetchAndProcess(); // lalu ambil sinyal
}

//+------------------------------------------------------------------+
// Push data akun MT5 ke server agar tampil di Mentor Mode widget
void PushAccountData() {
   string url = InpApiUrl + "/api/xauusd/ea-account?key=" + InpEaApiKey;

   // Kumpulkan posisi terbuka
   string posJson = "[";
   double totalPnl = 0;
   for (int i = 0; i < PositionsTotal(); i++) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      double pnl   = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      totalPnl    += pnl;
      string ptype = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL";
      if (i > 0) posJson += ",";
      posJson += StringFormat(
         "{\"ticket\":%llu,\"type\":\"%s\",\"symbol\":\"%s\","
         "\"volume\":%.2f,\"openPrice\":%.5f,\"currentPrice\":%.5f,"
         "\"tp\":%.5f,\"sl\":%.5f,\"pnl\":%.2f,\"swap\":%.2f,"
         "\"openTime\":\"%s\"}",
         ticket,
         ptype,
         PositionGetString(POSITION_SYMBOL),
         PositionGetDouble(POSITION_VOLUME),
         PositionGetDouble(POSITION_PRICE_OPEN),
         PositionGetDouble(POSITION_PRICE_CURRENT),
         PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_SL),
         pnl,
         PositionGetDouble(POSITION_SWAP),
         TimeToString(PositionGetInteger(POSITION_TIME), TIME_DATE|TIME_MINUTES)
      );
   }
   posJson += "]";

   string body = StringFormat(
      "{\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,"
      "\"margin\":%.2f,\"pnl\":%.2f,\"positions\":%s,"
      "\"accountName\":\"%s\",\"accountNumber\":%d,"
      "\"broker\":\"%s\",\"leverage\":%d,\"currency\":\"%s\"}",
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_FREEMARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN),
      totalPnl,
      posJson,
      AccountInfoString(ACCOUNT_NAME),
      (int)AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_COMPANY),
      (int)AccountInfoInteger(ACCOUNT_LEVERAGE),
      AccountInfoString(ACCOUNT_CURRENCY)
   );

   char   postData[];
   char   result[];
   string reqHeaders  = "Content-Type: application/json\r\n";
   string respHeaders = "";
   StringToCharArray(body, postData, 0, StringLen(body));

   // 8-parameter version: (method, url, headers, timeout, data, data_size, result, result_headers)
   WebRequest("POST", url, reqHeaders, 3000, postData, ArraySize(postData)-1, result, respHeaders);
   // Ignore error — push adalah best-effort
}

//+------------------------------------------------------------------+
void FetchAndProcess() {
   string url = InpApiUrl + "/api/xauusd/ea-signal"
                + "?key="         + InpEaApiKey
                + "&sensitivity=" + InpSensitivity
                + "&format=plain";

   char   post[];
   char   result[];
   string respHeaders;

   ResetLastError();
   // 8-parameter version: (method, url, headers, timeout, data, data_size, result, result_headers)
   int code = WebRequest("GET", url, "Accept: text/plain\r\n", 3000, post, 0, result, respHeaders);

   if (code == -1) {
      g_errCount++;
      g_connected = false;
      int err = GetLastError();
      string msg = (err == 5203)
         ? "URL belum diizinkan di Tools > Options > Expert Advisors > Allow WebRequest"
         : "WebRequest error " + IntegerToString(err);
      Print("❌ ", msg);
      if (InpShowPanel) UpdatePanelStatus("❌ " + msg, clrRed);
      return;
   }
   if (code != 200) {
      g_errCount++;
      g_connected = false;
      string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      Print("❌ API error HTTP ", code, ": ", body);
      if (InpShowPanel) UpdatePanelStatus("❌ HTTP " + IntegerToString(code), clrRed);
      return;
   }

   g_errCount  = 0;
   g_connected = true;

   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   StringTrimRight(resp);
   StringTrimLeft(resp);

   // Format: COMMAND|PRICE|TP|SL|CONFIDENCE
   string parts[];
   int n = StringSplit(resp, '|', parts);
   if (n < 5) {
      Print("❌ Format respons tidak valid: '", resp, "'");
      if (InpShowPanel) UpdatePanelStatus("❌ Respons tidak valid", clrRed);
      return;
   }

   string cmd  = parts[0];
   g_price     = StringToDouble(parts[1]);
   g_tp        = StringToDouble(parts[2]);
   g_sl        = StringToDouble(parts[3]);
   g_conf      = StringToDouble(parts[4]);

   Print("📡 Sinyal: ", cmd,
         " | Harga: ",   DoubleToString(g_price, 2),
         " | TP: ",      DoubleToString(g_tp,    2),
         " | SL: ",      DoubleToString(g_sl,    2),
         " | Conf: ",    DoubleToString(g_conf*100, 0), "%");

   if (InpShowPanel) UpdatePanelSignal(cmd);

   if (InpAutoTrade) {
      string prevCmd = g_lastCommand;
      g_lastCommand  = cmd;

      if (cmd != prevCmd || !PositionExistsForSymbol()) {
         if (cmd == "BUY") {
            ClosePositionsByType(POSITION_TYPE_SELL);
            if (!PositionExistsForSymbol(POSITION_TYPE_BUY))
               OpenPosition(ORDER_TYPE_BUY, g_tp, g_sl, g_conf);
         } else if (cmd == "SELL") {
            ClosePositionsByType(POSITION_TYPE_BUY);
            if (!PositionExistsForSymbol(POSITION_TYPE_SELL))
               OpenPosition(ORDER_TYPE_SELL, g_tp, g_sl, g_conf);
         } else { // HOLD
            ClosePositionsByType(-1);
         }
      }
   } else {
      g_lastCommand = cmd;
   }
}

//+------------------------------------------------------------------+
void OpenPosition(ENUM_ORDER_TYPE type, double tp, double sl, double conf) {
   double price = (type == ORDER_TYPE_BUY)
      ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
      : SymbolInfoDouble(Symbol(), SYMBOL_BID);

   string comment = "SahamRadar " + DoubleToString(conf*100, 0) + "%";
   bool ok = (type == ORDER_TYPE_BUY)
      ? trade.Buy(InpLotSize,  Symbol(), price, NormalizeDouble(sl,_Digits), NormalizeDouble(tp,_Digits), comment)
      : trade.Sell(InpLotSize, Symbol(), price, NormalizeDouble(sl,_Digits), NormalizeDouble(tp,_Digits), comment);

   if (ok) Print("✅ Order: ", EnumToString(type), " | Tiket: ", trade.ResultOrder());
   else    Print("❌ Order gagal: retcode=", trade.ResultRetcode(), " | ", trade.ResultComment());
}

//+------------------------------------------------------------------+
void ClosePositionsByType(int filterType) {
   for (int i = PositionsTotal()-1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if ((long)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      if (filterType != -1 && (int)pt != filterType) continue;
      trade.PositionClose(ticket);
   }
}

bool PositionExistsForSymbol(int filterType = -1) {
   for (int i = 0; i < PositionsTotal(); i++) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if ((long)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if (filterType != -1 && (int)PositionGetInteger(POSITION_TYPE) != filterType) continue;
      return true;
   }
   return false;
}

//─── Panel helpers ─────────────────────────────────────────────────────────────
void CreatePanel() {
   int x = 10, y = 25, w = 280, h = 190;

   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR, C'15,15,25');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR, C'50,50,75');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK, false);

   CreateLabel(LBL_TITLE,  x+8, y+7,   "🎓 SAHAM RADAR MENTOR",   clrWhite,    9);
   CreateLabel(LBL_STATUS, x+8, y+23,  "Menghubungkan...",          clrGray,     8);
   CreateLabel(LBL_CMD,    x+8, y+45,  "—",                         clrGray,    18);
   CreateLabel(LBL_PRICE,  x+8, y+73,  "Harga: —",                  clrSilver,   8);
   CreateLabel(LBL_TPSL,   x+8, y+87,  "TP: — | SL: —",            clrSilver,   8);
   CreateLabel(LBL_CONF,   x+8, y+101, "Confidence: —",             clrSilver,   8);
   // Separator
   CreateLabel(LBL_SEP,    x+8, y+115, "────────────────────",      C'50,50,75', 7);
   // Akun MT5
   CreateLabel(LBL_BAL,    x+8, y+127, "Balance: —",                clrSilver,   8);
   CreateLabel(LBL_EQ,     x+8, y+141, "Equity:  —",                clrSilver,   8);
   CreateLabel(LBL_PNL,    x+8, y+155, "PnL:     —",                clrSilver,   8);
   CreateLabel(LBL_POS,    x+8, y+169, "Posisi:  —",                clrSilver,   8);
   CreateLabel(LBL_TIME,   x+8, y+181, "—",                         C'60,60,80', 7);

   ChartRedraw();
}

void CreateLabel(string name, int x, int y, string text, color clr, int sz) {
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0,  name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, sz);
   ObjectSetString(0,  name, OBJPROP_FONT, "Segoe UI");
}

void UpdatePanelStatus(string msg, color clr) {
   if (!InpShowPanel) return;
   ObjectSetString(0,  LBL_STATUS, OBJPROP_TEXT,  msg);
   ObjectSetInteger(0, LBL_STATUS, OBJPROP_COLOR, clr);
   ChartRedraw();
}

void UpdatePanelSignal(string cmd) {
   if (!InpShowPanel) return;

   color  cmdColor = (cmd == "BUY") ? clrLime : (cmd == "SELL") ? clrRed : clrGray;
   string emoji    = (cmd == "BUY") ? "▲ BUY" : (cmd == "SELL") ? "▼ SELL" : "— HOLD";

   ObjectSetString(0,  LBL_CMD,    OBJPROP_TEXT,  emoji);
   ObjectSetInteger(0, LBL_CMD,    OBJPROP_COLOR, cmdColor);
   ObjectSetString(0,  LBL_PRICE,  OBJPROP_TEXT,  "Harga: " + DoubleToString(g_price, 2));
   ObjectSetString(0,  LBL_TPSL,   OBJPROP_TEXT,
      "TP: " + DoubleToString(g_tp, 2) + " | SL: " + DoubleToString(g_sl, 2));
   ObjectSetString(0,  LBL_CONF,   OBJPROP_TEXT,
      "Confidence: " + DoubleToString(g_conf*100, 0) + "%");
   ObjectSetString(0,  LBL_STATUS, OBJPROP_TEXT,  "✅ Terhubung (2s)");
   ObjectSetInteger(0, LBL_STATUS, OBJPROP_COLOR, clrGreen);

   // Update data akun real-time dari MT5 lokal
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double totalPnl = 0;
   int    openPos  = 0;
   for (int i = 0; i < PositionsTotal(); i++) {
      ulong ticket = PositionGetTicket(i);
      if (!PositionSelectByTicket(ticket)) continue;
      if (PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
      if ((long)PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      totalPnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      openPos++;
   }

   color pnlColor = (totalPnl >= 0) ? clrLime : clrRed;
   ObjectSetString(0,  LBL_BAL,  OBJPROP_TEXT,  "Balance: " + DoubleToString(balance, 2) + " USD");
   ObjectSetString(0,  LBL_EQ,   OBJPROP_TEXT,  "Equity:  " + DoubleToString(equity,  2) + " USD");
   ObjectSetString(0,  LBL_PNL,  OBJPROP_TEXT,  "PnL:     " + (totalPnl >= 0 ? "+" : "") + DoubleToString(totalPnl, 2) + " USD");
   ObjectSetInteger(0, LBL_PNL,  OBJPROP_COLOR, pnlColor);
   ObjectSetString(0,  LBL_POS,  OBJPROP_TEXT,  "Posisi:  " + IntegerToString(openPos) + " terbuka | Auto=" + (InpAutoTrade ? "ON" : "OFF"));

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string ts = StringFormat("%02d:%02d:%02d", dt.hour, dt.min, dt.sec);
   ObjectSetString(0, LBL_TIME, OBJPROP_TEXT, "Update: " + ts);

   ChartRedraw();
}

void DeletePanel() {
   string labels[] = {
      LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD,
      LBL_PRICE, LBL_TPSL, LBL_CONF, LBL_SEP,
      LBL_BAL, LBL_EQ, LBL_PNL, LBL_POS, LBL_TIME
   };
   for (int i = 0; i < ArraySize(labels); i++) ObjectDelete(0, labels[i]);
   ChartRedraw();
}
