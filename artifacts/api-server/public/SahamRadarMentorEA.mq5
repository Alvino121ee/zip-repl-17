//+------------------------------------------------------------------+
//|                                        SahamRadarMentorEA.mq5   |
//|                          Saham Radar — Mentor Mode Expert Advisor|
//|                                                                  |
//| Cara pakai:                                                      |
//| 1. Isi ApiUrl dengan URL Replit kamu (misal: https://xxx.repl.co)|
//| 2. Isi EaApiKey dengan kunci EA dari halaman Admin               |
//| 3. Di MT5: Tools > Options > Expert Advisors >                   |
//|    centang "Allow WebRequest for listed URLs"                    |
//|    → tambahkan URL API kamu                                      |
//| 4. Pasang EA di chart XAUUSD                                     |
//+------------------------------------------------------------------+
#property copyright "Saham Radar"
#property version   "1.10"
#property description "Mentor Mode EA — terhubung ke sinyal XAUUSD Saham Radar"
#property strict

#include <Trade\Trade.mqh>

//─── Input Parameters ─────────────────────────────────────────────────────────
input group "=== Koneksi API ==="
input string   InpApiUrl      = "https://YOUR-REPL-URL.replit.app"; // URL API (tanpa /api di belakang)
input string   InpEaApiKey    = "";                                  // EA API Key (dari Admin Panel)
input string   InpSensitivity = "normal";                           // Sensitivitas: aggressive/normal/conservative

input group "=== Trading ==="
input double   InpLotSize     = 0.01;   // Ukuran lot
input bool     InpAutoTrade   = false;  // Aktifkan auto-trading
input int      InpMagicNumber = 202607; // Magic number

input group "=== Pengaturan ==="
input int      InpPollSeconds = 30;     // Interval polling (detik)
input bool     InpShowPanel   = true;   // Tampilkan panel di chart

//─── Global State ─────────────────────────────────────────────────────────────
CTrade   trade;
datetime g_lastPoll    = 0;
string   g_lastCommand = "HOLD";
double   g_lastPrice   = 0;
double   g_lastTp      = 0;
double   g_lastSl      = 0;
double   g_lastConf    = 0;
string   g_lastSource  = "";
datetime g_lastUpdate  = 0;
bool     g_connected   = false;
int      g_errCount    = 0;

//─── Labels ───────────────────────────────────────────────────────────────────
#define LBL_CMD    "SR_CMD"
#define LBL_PRICE  "SR_PRICE"
#define LBL_TPSL   "SR_TPSL"
#define LBL_CONF   "SR_CONF"
#define LBL_STATUS "SR_STATUS"
#define LBL_TIME   "SR_TIME"
#define LBL_TITLE  "SR_TITLE"
#define LBL_BG     "SR_BG"

//+------------------------------------------------------------------+
int OnInit() {
   if (InpApiUrl == "https://YOUR-REPL-URL.replit.app" || InpEaApiKey == "") {
      Alert("❌ Saham Radar EA: Isi ApiUrl dan EaApiKey di input parameter!");
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);

   CreatePanel();
   UpdatePanelStatus("Menghubungkan...", clrGray);

   Print("✅ Saham Radar Mentor EA v1.10 aktif");
   Print("   URL  : ", InpApiUrl);
   Print("   Mode : AutoTrade=", InpAutoTrade, " | Lot=", InpLotSize, " | Sensitivity=", InpSensitivity);

   // Fetch langsung saat start
   FetchAndProcess();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   DeletePanel();
   Print("Saham Radar Mentor EA dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick() {
   if (TimeCurrent() - g_lastPoll < InpPollSeconds) return;
   g_lastPoll = TimeCurrent();
   FetchAndProcess();
}

//+------------------------------------------------------------------+
void FetchAndProcess() {
   string url     = InpApiUrl + "/api/xauusd/ea-signal"
                    + "?key="         + InpEaApiKey
                    + "&sensitivity=" + InpSensitivity
                    + "&format=plain";
   char   post[];
   char   result[];
   string respHeaders;

   ResetLastError();
   int code = WebRequest("GET", url, "Accept: text/plain\r\n", "", 5000, post, 0, result, respHeaders);

   if (code == -1) {
      g_errCount++;
      g_connected = false;
      int err = GetLastError();
      string msg = (err == 5203)
         ? "URL belum diizinkan. Tambahkan di Tools > Options > Expert Advisors > Allow WebRequest"
         : "WebRequest error " + IntegerToString(err);
      Print("❌ ", msg);
      UpdatePanelStatus("❌ " + msg, clrRed);
      return;
   }
   if (code != 200) {
      g_errCount++;
      g_connected = false;
      string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      Print("❌ API error HTTP ", code, ": ", body);
      UpdatePanelStatus("❌ HTTP " + IntegerToString(code), clrRed);
      return;
   }

   g_errCount  = 0;
   g_connected = true;
   g_lastPoll  = TimeCurrent();
   g_lastUpdate = TimeCurrent();

   string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   StringTrimRight(resp);
   StringTrimLeft(resp);

   // Format: COMMAND|PRICE|TP|SL|CONFIDENCE
   string parts[];
   int n = StringSplit(resp, '|', parts);
   if (n < 5) {
      Print("❌ Format respons tidak valid: '", resp, "'");
      UpdatePanelStatus("❌ Respons tidak valid", clrRed);
      return;
   }

   string cmd = parts[0];
   double px   = StringToDouble(parts[1]);
   double tp   = StringToDouble(parts[2]);
   double sl   = StringToDouble(parts[3]);
   double conf = StringToDouble(parts[4]);

   // Simpan command sebelumnya sebelum di-overwrite
   string prevCommand = g_lastCommand;

   g_lastCommand = cmd;
   g_lastPrice   = px;
   g_lastTp      = tp;
   g_lastSl      = sl;
   g_lastConf    = conf;

   Print("📡 Sinyal: ", cmd,
         " | Harga: ",   DoubleToString(px,  2),
         " | TP: ",      DoubleToString(tp,  2),
         " | SL: ",      DoubleToString(sl,  2),
         " | Conf: ",    DoubleToString(conf*100, 0), "%");

   UpdatePanelSignal(cmd, px, tp, sl, conf);

   if (!InpAutoTrade) return;
   // Jika sinyal sama dengan sebelumnya DAN posisi sudah terbuka, skip
   if (cmd == prevCommand && PositionExistsForSymbol()) return;

   if (cmd == "BUY") {
      ClosePositionsByType(POSITION_TYPE_SELL);
      if (!PositionExistsForSymbol(POSITION_TYPE_BUY))
         OpenPosition(ORDER_TYPE_BUY, tp, sl, conf);
   } else if (cmd == "SELL") {
      ClosePositionsByType(POSITION_TYPE_BUY);
      if (!PositionExistsForSymbol(POSITION_TYPE_SELL))
         OpenPosition(ORDER_TYPE_SELL, tp, sl, conf);
   } else { // HOLD
      ClosePositionsByType(-1);
   }
}

//+------------------------------------------------------------------+
void OpenPosition(ENUM_ORDER_TYPE type, double tp, double sl, double conf) {
   double price = (type == ORDER_TYPE_BUY)
      ? SymbolInfoDouble(Symbol(), SYMBOL_ASK)
      : SymbolInfoDouble(Symbol(), SYMBOL_BID);

   string comment = "SahamRadar " + DoubleToString(conf*100, 0) + "% " + InpSensitivity;
   bool ok = (type == ORDER_TYPE_BUY)
      ? trade.Buy(InpLotSize, Symbol(), price, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), comment)
      : trade.Sell(InpLotSize, Symbol(), price, NormalizeDouble(sl, _Digits), NormalizeDouble(tp, _Digits), comment);

   if (ok) Print("✅ Order dibuka: ", EnumToString(type), " | Tiket: ", trade.ResultOrder());
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
   if (!InpShowPanel) return;
   int x = 10, y = 25, w = 270, h = 135;

   // Background
   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR, C'20,20,30');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR, C'60,60,80');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK, false);

   CreateLabel(LBL_TITLE,  x+8, y+8,  "🎓 SAHAM RADAR MENTOR",  clrWhite,    9);
   CreateLabel(LBL_STATUS, x+8, y+26, "Menghubungkan...",         clrGray,     8);
   CreateLabel(LBL_CMD,    x+8, y+50, "—",                        clrGray,    18);
   CreateLabel(LBL_PRICE,  x+8, y+78, "Harga: —",                 clrSilver,   8);
   CreateLabel(LBL_TPSL,   x+8, y+92, "TP: — | SL: —",           clrSilver,   8);
   CreateLabel(LBL_CONF,   x+8, y+106,"Confidence: —",            clrSilver,   8);
   CreateLabel(LBL_TIME,   x+8, y+120,"Update: —",                C'80,80,80', 7);

   ChartRedraw();
}

void CreateLabel(string name, int x, int y, string text, color clr, int sz) {
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, sz);
   ObjectSetString(0, name, OBJPROP_FONT, "Segoe UI");
}

void UpdatePanelStatus(string msg, color clr) {
   if (!InpShowPanel) return;
   ObjectSetString(0, LBL_STATUS, OBJPROP_TEXT, msg);
   ObjectSetInteger(0, LBL_STATUS, OBJPROP_COLOR, clr);
   ChartRedraw();
}

void UpdatePanelSignal(string cmd, double px, double tp, double sl, double conf) {
   if (!InpShowPanel) return;

   color cmdColor = (cmd == "BUY") ? clrLime : (cmd == "SELL") ? clrRed : clrGray;
   string emoji   = (cmd == "BUY") ? "▲ BUY" : (cmd == "SELL") ? "▼ SELL" : "— HOLD";

   ObjectSetString(0,  LBL_CMD,    OBJPROP_TEXT,  emoji);
   ObjectSetInteger(0, LBL_CMD,    OBJPROP_COLOR, cmdColor);
   ObjectSetString(0,  LBL_PRICE,  OBJPROP_TEXT,  "Harga: " + DoubleToString(px, 2));
   ObjectSetString(0,  LBL_TPSL,   OBJPROP_TEXT,  "TP: " + DoubleToString(tp, 2) + " | SL: " + DoubleToString(sl, 2));
   ObjectSetString(0,  LBL_CONF,   OBJPROP_TEXT,  "Confidence: " + DoubleToString(conf*100, 0) + "%");
   ObjectSetString(0,  LBL_STATUS, OBJPROP_TEXT,  "✅ Terhubung");
   ObjectSetInteger(0, LBL_STATUS, OBJPROP_COLOR, clrGreen);

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   string ts = StringFormat("%02d:%02d:%02d", dt.hour, dt.min, dt.sec);
   ObjectSetString(0, LBL_TIME, OBJPROP_TEXT, "Update: " + ts);

   ChartRedraw();
}

void DeletePanel() {
   string labels[] = { LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD, LBL_PRICE, LBL_TPSL, LBL_CONF, LBL_TIME };
   for (int i = 0; i < ArraySize(labels); i++) ObjectDelete(0, labels[i]);
   ChartRedraw();
}
