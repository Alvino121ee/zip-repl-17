//+------------------------------------------------------------------+
//|                                    radargold-layer.mq5            |
//|                Radar Gold LAYER EA — GoldRadar.ai                |
//|  Fitur: Grid 10 Layer (1 Market + 9 Limit), SL Bersama,          |
//|         Trailing Stop per Layer, Re-entry Otomatis per Layer     |
//+------------------------------------------------------------------+
#property copyright "GoldRadar.ai"
#property version   "1.00"
#property description "Radar Gold Layer EA - 10 Layer Grid DCA + Trailing + Re-entry per Layer"

#include <Trade\Trade.mqh>

#define MAX_LAYERS 10
#define POLL_INTERVAL_SEC 2

//--- Input Parameters
input group "=== Koneksi API ==="
input string InpApiUrl      = "";   // Isi dengan URL API dari halaman admin
input string InpEaApiKey    = "";   // Isi dengan EA API Key dari halaman admin
input string InpSensitivity = "aggressive"; // super_aggressive|aggressive|normal|conservative|ai_utama
                                             // ai_utama = sinyal dari total % 4 agen ensemble (Teknikal/AI Rule/Macro/Sentimen), SL memakai skala mode "aggressive"

input group "=== Trading ==="
input double InpLotSize     = 0.01;    // Lot per layer (sama untuk semua layer) — dipakai jika Martingale OFF
input bool   InpAutoTrade   = false;
input int    InpMagicNumber = 202608;
input bool   InpReverseMode = false;   // true = balik sinyal (BUY->SELL, SELL->BUY)

input group "=== Martingale (naik lot setelah menang, reset setelah kalah) ==="
input bool   InpMartingaleEnable = false;   // ON = pakai g_currentLot bertingkat, bukan InpLotSize tetap
input double InpMartingaleBaseLot = 0.01;   // Lot awal / lot setelah kalah
input double InpMartingaleStep    = 0.01;   // Kenaikan lot setiap kali sesi P1 menang (TP/trailing profit)

input group "=== Layer Grid (DCA melawan arah) ==="
input int    InpLayerCount    = 10;    // Jumlah layer aktif (1 Market + sisanya Limit), maks 10
input double InpLayerGapUSD   = 1.0;   // Jarak antar layer ($) — BUY: limit di bawah, SELL: limit di atas
input double InpTpDistanceUSD = 3.0;   // Jarak TP dari harga entry MASING-MASING layer ($)

input group "=== Entry Filter (P1) ==="
input double InpEntryToleranceUSD = 1.0;  // P1 hanya entry market jika |harga sekarang - harga sinyal AI| <= toleransi ($)

input group "=== Trailing Stop (berlaku per layer, dari harga entry masing-masing) ==="
input bool   InpTrailEnable      = true;
input double InpTrailActivateUSD = 2.0;  // Profit minimal ($) sebelum trailing aktif
input double InpTrailDistanceUSD = 1.0;  // Jarak trailing dari harga saat ini ($)

input group "=== Re-entry per Layer ==="
input bool   InpReentryEnable = true;    // Jika layer close via trailing/manual, pasang ulang LIMIT re-entry di harga entry-nya

input group "=== Tampilan ==="
input bool   InpShowPanel = true;

//--- Label names
#define LBL_BG       "RGL_BG"
#define LBL_TITLE    "RGL_TITLE"
#define LBL_STATUS   "RGL_STATUS"
#define LBL_CMD      "RGL_CMD"
#define LBL_SESSION  "RGL_SESSION"
#define LBL_LAYERS   "RGL_LAYERS"
#define LBL_PNL      "RGL_PNL"
#define LBL_CONF     "RGL_CONF"
#define LBL_TIME     "RGL_TIME"

//--- Global state
CTrade   g_trade;
datetime g_lastPoll    = 0;
string   g_rawCommand  = "HOLD";
double   g_price       = 0;
double   g_sl          = 0;
double   g_conf        = 0;

bool     g_sessionActive    = false;
string   g_sessionDirection = "HOLD";   // BUY | SELL
double   g_sessionSL        = 0;

double   g_currentLot       = 0;   // lot aktif martingale (P1 & seluruh layer sesi berjalan)

enum LayerState { LAYER_NONE, LAYER_PENDING, LAYER_OPEN, LAYER_DONE };

double     g_layerEntry[MAX_LAYERS + 1];  // index 1..10 — harga entry tetap per layer
double     g_layerTP[MAX_LAYERS + 1];
ulong      g_layerPosId[MAX_LAYERS + 1];   // menyimpan POSITION_IDENTIFIER (bukan ticket) — untuk cocokkan DEAL_POSITION_ID di riwayat
LayerState g_layerState[MAX_LAYERS + 1];

//+------------------------------------------------------------------+
int OnInit()
{
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(20);

   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      g_layerState[i] = LAYER_NONE;
      g_layerPosId[i] = 0;
   }

   g_currentLot = InpMartingaleEnable ? InpMartingaleBaseLot : InpLotSize;

   RestoreSessionFromExisting();

   if(InpShowPanel) CreatePanel();

   Print("=== Radar Gold LAYER EA v1.0 aktif ===");
   Print("URL        : ", InpApiUrl);
   Print("Magic#     : ", InpMagicNumber);
   Print("Layers     : ", InpLayerCount, " | Gap: $", InpLayerGapUSD, " | TP dist: $", InpTpDistanceUSD);
   Print("Trailing   : ", InpTrailEnable ? "ON — aktif >$" + DoubleToString(InpTrailActivateUSD,2) + ", jarak $" + DoubleToString(InpTrailDistanceUSD,2) : "OFF");
   Print("Re-entry   : ", InpReentryEnable ? "ON (per layer)" : "OFF");
   Print("Martingale : ", InpMartingaleEnable ? "ON — base=" + DoubleToString(InpMartingaleBaseLot,2) + " step=" + DoubleToString(InpMartingaleStep,2) + " | lot saat ini=" + DoubleToString(g_currentLot,2) : "OFF");
   Print("EntryToler : $", DoubleToString(InpEntryToleranceUSD, 2), " (P1 hanya market entry jika harga dalam toleransi dari sinyal AI)");

   FetchAndProcess();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(InpShowPanel) DeletePanel();
   Print("Radar Gold LAYER EA v1.0 dihentikan.");
}

//+------------------------------------------------------------------+
void OnTick()
{
   CheckSessionInvalidation();
   CheckLayerTransitions();
   if(InpTrailEnable) ManageLayerTrailing();

   if(TimeCurrent() - g_lastPoll < POLL_INTERVAL_SEC) return;
   g_lastPoll = TimeCurrent();

   PushAccountData();
   FetchAndProcess();
}

//+------------------------------------------------------------------+
// Tag unik per layer, lebar tetap (L01..L10) supaya tidak ada tabrakan substring
string GetLayerTag(int i)
{
   return "RGL-L" + (i < 10 ? "0" + IntegerToString(i) : IntegerToString(i));
}

//+------------------------------------------------------------------+
ulong FindLayerPosition(int i)
{
   string tag = GetLayerTag(i);
   for(int idx = 0; idx < PositionsTotal(); idx++)
   {
      ulong ticket = PositionGetTicket(idx);
      if(!PositionSelectByTicket(ticket))                 continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol())  continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(PositionGetString(POSITION_COMMENT) == tag) return ticket;
   }
   return 0;
}

//+------------------------------------------------------------------+
ulong FindLayerPendingOrder(int i)
{
   string tag = GetLayerTag(i);
   for(int idx = 0; idx < OrdersTotal(); idx++)
   {
      ulong ticket = OrderGetTicket(idx);
      if(!OrderSelect(ticket))                        continue;
      if(OrderGetString(ORDER_SYMBOL) != Symbol())     continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;
      if(OrderGetString(ORDER_COMMENT) == tag) return ticket;
   }
   return 0;
}

//+------------------------------------------------------------------+
// Cari alasan penutupan posisi via riwayat deal berdasarkan Position ID
// (lebih andal daripada comment — beberapa broker menimpa comment saat SL/TP kena)
int GetLastCloseReasonByPosId(ulong posId, double &closePrice)
{
   HistorySelect(TimeCurrent() - 172800, TimeCurrent() + 60); // 48 jam terakhir
   int total = HistoryDealsTotal();
   for(int idx = total - 1; idx >= 0; idx--)
   {
      ulong dealTicket = HistoryDealGetTicket(idx);
      if(dealTicket == 0) continue;
      if(HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID) != posId) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
      return (int)HistoryDealGetInteger(dealTicket, DEAL_REASON);
   }
   closePrice = 0;
   return -1;
}

//+------------------------------------------------------------------+
// Deteksi sesi grid yang sudah berjalan (mis. EA baru saja di-restart)
void RestoreSessionFromExisting()
{
   bool   found = false;
   string dir   = "HOLD";
   double sl    = 0;
   int    digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);

   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      ulong posT = FindLayerPosition(i);
      ulong ordT = FindLayerPendingOrder(i);

      if(posT != 0 && PositionSelectByTicket(posT))
      {
         g_layerState[i] = LAYER_OPEN;
         g_layerPosId[i] = (ulong)PositionGetInteger(POSITION_IDENTIFIER); // simpan identifier, bukan ticket
         g_layerEntry[i] = PositionGetDouble(POSITION_PRICE_OPEN);
         g_layerTP[i]    = PositionGetDouble(POSITION_TP);
         sl  = PositionGetDouble(POSITION_SL);
         dir = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
         found = true;
      }
      else if(ordT != 0 && OrderSelect(ordT))
      {
         g_layerState[i] = LAYER_PENDING;
         g_layerEntry[i] = OrderGetDouble(ORDER_PRICE_OPEN);
         g_layerTP[i]    = OrderGetDouble(ORDER_TP);
         sl  = OrderGetDouble(ORDER_SL);
         ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
         dir = (ot == ORDER_TYPE_BUY_LIMIT) ? "BUY" : "SELL";
         found = true;
      }
   }

   if(found)
   {
      g_sessionActive    = true;
      g_sessionDirection = dir;
      g_sessionSL        = NormalizeDouble(sl, digits);
      Print("[Layer] Sesi lama terdeteksi & dipulihkan: ", dir, " | SL bersama=", DoubleToString(g_sessionSL, 2));
   }
}

//+------------------------------------------------------------------+
// SL global kena (harga tembus level SL bersama) → tutup semua & batalkan sisa limit
void CheckSessionInvalidation()
{
   if(!g_sessionActive) return;

   double bid = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask = SymbolInfoDouble(Symbol(), SYMBOL_ASK);
   bool   hit = false;

   if(g_sessionDirection == "BUY"  && bid <= g_sessionSL) hit = true;
   if(g_sessionDirection == "SELL" && ask >= g_sessionSL) hit = true;

   if(hit)
   {
      Print("[Layer] ⛔ SL GLOBAL KENA @", DoubleToString(g_sessionSL, 2),
            " — tutup semua posisi & batalkan sisa limit order. Sesi berakhir (tidak ada re-entry).");
      ApplyMartingaleResult(g_sessionDirection, g_layerEntry[1], g_sessionSL);
      CloseEntireSession();
      g_sessionActive    = false;
      g_sessionDirection = "HOLD";
      if(InpShowPanel) SetLabelText(LBL_SESSION, "Sesi berakhir (SL global kena)", clrRed);
   }
}

//+------------------------------------------------------------------+
// Tutup semua posisi terbuka dan batalkan semua limit order layer 2..N
// Dipanggil saat P1 (layer 1) close untuk membersihkan seluruh grid
void CloseAndCancelNonP1Layers()
{
   // Tutup posisi yang sudah open (L2-L10)
   for(int k = 2; k <= MAX_LAYERS; k++)
   {
      if(g_layerState[k] == LAYER_OPEN)
      {
         ulong posT = FindLayerPosition(k);
         if(posT != 0) g_trade.PositionClose(posT);
         g_layerState[k] = LAYER_NONE;
         g_layerPosId[k] = 0;
      }
   }
   // Batalkan limit order yang masih pending (L2-L10)
   for(int k = 2; k <= MAX_LAYERS; k++)
   {
      if(g_layerState[k] == LAYER_PENDING)
      {
         ulong ordT = FindLayerPendingOrder(k);
         if(ordT != 0) g_trade.OrderDelete(ordT);
         g_layerState[k] = LAYER_NONE;
      }
   }
}

//+------------------------------------------------------------------+
// Martingale: naik lot InpMartingaleStep jika menang (closePrice untung dari entry P1),
// reset ke InpMartingaleBaseLot jika kalah/rugi.
void ApplyMartingaleResult(string dir, double entryPrice, double closePrice)
{
   if(!InpMartingaleEnable) return;

   bool win = (dir == "BUY") ? (closePrice > entryPrice) : (closePrice < entryPrice);
   double oldLot = g_currentLot;

   if(win)
      g_currentLot = NormalizeDouble(g_currentLot + InpMartingaleStep, 2);
   else
      g_currentLot = InpMartingaleBaseLot;

   Print("[Martingale] ", win ? "MENANG ✅" : "KALAH ❌",
         " (entry=", DoubleToString(entryPrice, 2), " close=", DoubleToString(closePrice, 2),
         ") — lot ", DoubleToString(oldLot, 2), " → ", DoubleToString(g_currentLot, 2));
}

//+------------------------------------------------------------------+
// Helper terpusat: tangani penutupan P1 (bukan SL global)
// → tutup/batalkan semua P2-P10 → reset sesi → ambil sinyal baru
// Jika InpReentryEnable=false, sesi hanya direset tanpa FetchAndProcess.
void HandleP1Close(string closeDesc, double closePrice)
{
   Print("[Layer 1] ", closeDesc, " @", DoubleToString(closePrice, 2),
         " — tutup/batalkan P2-P10 & ", InpReentryEnable ? "refresh sinyal baru." : "reset sesi (re-entry OFF).");
   ApplyMartingaleResult(g_sessionDirection, g_layerEntry[1], closePrice);
   g_layerState[1]    = LAYER_NONE;
   g_layerPosId[1]    = 0;
   CloseAndCancelNonP1Layers();
   g_sessionActive    = false;
   g_sessionDirection = "HOLD";
   g_sessionSL        = 0;
   if(InpShowPanel) SetLabelText(LBL_SESSION, "Sesi berakhir — menunggu sinyal baru", clrGray);
   if(InpReentryEnable) FetchAndProcess(); // ambil sinyal baru, bisa langsung buka sesi baru
}

//+------------------------------------------------------------------+
// Cek transisi status tiap layer (limit terisi, posisi tertutup dsb)
// ATURAN RE-ENTRY: hanya Layer 1 (P1/entry utama) yang boleh re-entry.
//                 Layer 2-10 (P2-P10/limit grid) TIDAK re-entry.
// ATURAN P1 CLOSE: saat P1 close (bukan SL global), hapus semua limit
//                  P2-P10 dan refresh sinyal untuk sesi baru.
void CheckLayerTransitions()
{
   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      if(g_layerState[i] == LAYER_NONE || g_layerState[i] == LAYER_DONE) continue;

      ulong posTicket   = FindLayerPosition(i);
      bool  hasPos      = (posTicket != 0);
      bool  hasPending  = (FindLayerPendingOrder(i) != 0);

      if(g_layerState[i] == LAYER_PENDING && hasPos)
      {
         g_layerState[i] = LAYER_OPEN;
         // Simpan POSITION_IDENTIFIER agar cocok dengan DEAL_POSITION_ID di riwayat deal
         if(PositionSelectByTicket(posTicket))
            g_layerPosId[i] = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
         Print("[Layer ", i, "] Limit terisi → posisi terbuka @", DoubleToString(g_layerEntry[i], 2));
      }
      else if(g_layerState[i] == LAYER_OPEN)
      {
         if(hasPos)
         {
            // Refresh identifier — stabil selama posisi masih ada
            if(PositionSelectByTicket(posTicket))
               g_layerPosId[i] = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
         }
         else
         {
            // Posisi baru saja tertutup
            if(!g_sessionActive) continue; // sesi sudah invalid (ditangani CheckSessionInvalidation)

            double closePrice = 0;
            int reason = GetLastCloseReasonByPosId(g_layerPosId[i], closePrice);

            if(reason == DEAL_REASON_SL)
            {
               // Bedakan: SL global (closePrice ≈ g_sessionSL) vs trailing per-layer
               // Toleransi $0.50 untuk XAUUSD — cukup besar untuk spread tapi tidak bias
               double slTolerance = 0.50;
               if(closePrice > 0 && MathAbs(closePrice - g_sessionSL) <= slTolerance)
               {
                  // SL global terkonfirmasi via history → akhiri seluruh sesi, tidak ada re-entry
                  Print("[Layer ", i, "] ⛔ SL GLOBAL terkonfirmasi via history @",
                        DoubleToString(closePrice, 2), " — akhiri sesi.");
                  CloseEntireSession();
                  g_sessionActive    = false;
                  g_sessionDirection = "HOLD";
                  if(InpShowPanel) SetLabelText(LBL_SESSION, "Sesi berakhir (SL global kena)", clrRed);
                  break; // CloseEntireSession() sudah reset semua state, hentikan loop
               }
               else
               {
                  // Trailing stop per-layer kena
                  if(i == 1)
                  {
                     HandleP1Close("⚡ P1 trailing stop kena", closePrice);
                     break;
                  }
                  else
                  {
                     // P2-P10 kena trailing — re-entry hanya jika P1 masih open/floating
                     bool p1StillOpen = (g_layerState[1] == LAYER_OPEN && FindLayerPosition(1) != 0);
                     if(InpReentryEnable && p1StillOpen)
                     {
                        Print("[Layer ", i, "] Trailing stop kena @", DoubleToString(closePrice, 2),
                              " — P1 masih open, re-entry LIMIT @", DoubleToString(g_layerEntry[i], 2));
                        PlaceLayerLimit(i, g_sessionDirection, g_layerEntry[i], g_layerTP[i]);
                     }
                     else
                     {
                        g_layerState[i] = LAYER_DONE;
                        Print("[Layer ", i, "] Trailing stop kena @", DoubleToString(closePrice, 2),
                              " — P1 sudah close atau re-entry OFF, layer selesai.");
                     }
                  }
               }
            }
            else if(reason == DEAL_REASON_TP)
            {
               if(i == 1)
               {
                  HandleP1Close("✅ P1 TP tercapai", closePrice);
                  break;
               }
               else
               {
                  // P2-P10 TP — re-entry hanya jika P1 masih open/floating
                  bool p1StillOpen = (g_layerState[1] == LAYER_OPEN && FindLayerPosition(1) != 0);
                  if(InpReentryEnable && p1StillOpen)
                  {
                     Print("[Layer ", i, "] ✅ TP tercapai @", DoubleToString(closePrice, 2),
                           " — P1 masih open, re-entry LIMIT @", DoubleToString(g_layerEntry[i], 2));
                     PlaceLayerLimit(i, g_sessionDirection, g_layerEntry[i], g_layerTP[i]);
                  }
                  else
                  {
                     g_layerState[i] = LAYER_DONE;
                     Print("[Layer ", i, "] ✅ TP tercapai @", DoubleToString(closePrice, 2),
                           " — P1 sudah close atau re-entry OFF, layer selesai.");
                  }
               }
            }
            else if(reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT)
            {
               if(i == 1)
               {
                  HandleP1Close("🖐 P1 ditutup manual/expert", closePrice);
                  break;
               }
               else
               {
                  // P2-P10 ditutup manual — re-entry hanya jika P1 masih open/floating
                  bool p1StillOpen = (g_layerState[1] == LAYER_OPEN && FindLayerPosition(1) != 0);
                  if(InpReentryEnable && p1StillOpen)
                  {
                     Print("[Layer ", i, "] Manual close @", DoubleToString(closePrice, 2),
                           " — P1 masih open, re-entry LIMIT @", DoubleToString(g_layerEntry[i], 2));
                     PlaceLayerLimit(i, g_sessionDirection, g_layerEntry[i], g_layerTP[i]);
                  }
                  else
                  {
                     g_layerState[i] = LAYER_DONE;
                     Print("[Layer ", i, "] Manual close @", DoubleToString(closePrice, 2),
                           " — P1 sudah close atau re-entry OFF, layer selesai.");
                  }
               }
            }
            else
            {
               // Alasan tidak diketahui (stopout, margin call, sistem, dll)
               if(i == 1)
               {
                  HandleP1Close("❓ P1 closed alasan tidak dikenal (reason=" + IntegerToString(reason) + ")", closePrice);
                  break;
               }
               else
               {
                  // P2-P10 alasan tidak dikenal — JANGAN re-entry, risiko tidak terkontrol
                  g_layerState[i] = LAYER_DONE;
                  Print("[Layer ", i, "] Closed via alasan tidak dikenal (reason=", reason,
                        ") @", DoubleToString(closePrice, 2), " — layer selesai, tidak re-entry.");
               }
            }
         }
      }
      else if(g_layerState[i] == LAYER_PENDING && !hasPending && !hasPos)
      {
         // Order pending hilang — bisa karena SL global sudah fire, atau dihapus manual
         if(!g_sessionActive)
         {
            // Sesi sudah berakhir — tandai selesai
            g_layerState[i] = LAYER_NONE;
            continue;
         }
         // P2-P10 pending hilang (terhapus manual, dll) → selesai, TIDAK pasang ulang
         g_layerState[i] = LAYER_DONE;
         Print("[Layer ", i, "] Order pending hilang — layer selesai (P2-P10 tidak re-entry).");
      }
   }
}

//+------------------------------------------------------------------+
// Trailing stop per layer — berbasis harga open masing-masing posisi
void ManageLayerTrailing()
{
   int    digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);
   double point  = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
   double bid    = SymbolInfoDouble(Symbol(), SYMBOL_BID);
   double ask    = SymbolInfoDouble(Symbol(), SYMBOL_ASK);

   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      if(g_layerState[i] != LAYER_OPEN) continue;
      ulong ticket = FindLayerPosition(i);
      if(ticket == 0 || !PositionSelectByTicket(ticket)) continue;

      ENUM_POSITION_TYPE pt        = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      double             openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double             curSL     = PositionGetDouble(POSITION_SL);
      double             curTP     = PositionGetDouble(POSITION_TP);

      if(pt == POSITION_TYPE_BUY)
      {
         double profit = bid - openPrice;
         if(profit < InpTrailActivateUSD) continue;
         double newSL = NormalizeDouble(bid - InpTrailDistanceUSD, digits);
         if(newSL > curSL + point)
         {
            if(g_trade.PositionModify(ticket, newSL, curTP))
               Print("[Trail L", i, "] BUY #", ticket, " SL: ", DoubleToString(curSL, digits), "→", DoubleToString(newSL, digits));
         }
      }
      else if(pt == POSITION_TYPE_SELL)
      {
         double profit = openPrice - ask;
         if(profit < InpTrailActivateUSD) continue;
         double newSL = NormalizeDouble(ask + InpTrailDistanceUSD, digits);
         if(curSL == 0 || newSL < curSL - point)
         {
            if(g_trade.PositionModify(ticket, newSL, curTP))
               Print("[Trail L", i, "] SELL #", ticket, " SL: ", DoubleToString(curSL, digits), "→", DoubleToString(newSL, digits));
         }
      }
   }
}

//+------------------------------------------------------------------+
void OpenLayerMarket(int i, string cmd, double entry, double tp)
{
   string tag = GetLayerTag(i);
   bool   ok;
   double lot = InpMartingaleEnable ? g_currentLot : InpLotSize;

   if(cmd == "BUY")
      ok = g_trade.Buy(lot, Symbol(), 0, g_sessionSL, tp, tag);
   else
      ok = g_trade.Sell(lot, Symbol(), 0, g_sessionSL, tp, tag);

   if(ok)
   {
      g_layerState[i] = LAYER_OPEN;
      ulong posTicket = FindLayerPosition(i);
      if(posTicket != 0 && PositionSelectByTicket(posTicket))
         g_layerPosId[i] = (ulong)PositionGetInteger(POSITION_IDENTIFIER); // simpan identifier untuk history lookup
      Print("[Layer ", i, "] MARKET ", cmd, " OK | entry~", DoubleToString(entry, 2),
            " | TP=", DoubleToString(tp, 2), " | SL=", DoubleToString(g_sessionSL, 2));
   }
   else
   {
      g_layerState[i] = LAYER_NONE;
      Print("[Layer ", i, "] MARKET GAGAL | retcode=", g_trade.ResultRetcode(), " | ", g_trade.ResultComment());
   }
}

//+------------------------------------------------------------------+
void PlaceLayerLimit(int i, string cmd, double entry, double tp)
{
   string tag = GetLayerTag(i);
   bool   ok;
   double lot = InpMartingaleEnable ? g_currentLot : InpLotSize;

   if(cmd == "BUY")
      ok = g_trade.BuyLimit(lot, entry, Symbol(), g_sessionSL, tp, ORDER_TIME_GTC, 0, tag);
   else
      ok = g_trade.SellLimit(lot, entry, Symbol(), g_sessionSL, tp, ORDER_TIME_GTC, 0, tag);

   if(ok)
   {
      g_layerState[i] = LAYER_PENDING;
      Print("[Layer ", i, "] LIMIT ", cmd, " dipasang @", DoubleToString(entry, 2), " | TP=", DoubleToString(tp, 2));
   }
   else
   {
      g_layerState[i] = LAYER_NONE;
      Print("[Layer ", i, "] LIMIT GAGAL | retcode=", g_trade.ResultRetcode(), " | ", g_trade.ResultComment());
   }
}

//+------------------------------------------------------------------+
// Mulai sesi grid baru: layer 1 = market, layer 2..N = limit melawan arah, jarak $1 antar layer
void StartNewSession(string cmd)
{
   if(g_sl <= 0)
   {
      Print("[Layer] Sinyal tidak punya SL valid — sesi baru DIBATALKAN.");
      return;
   }

   double price  = (cmd == "BUY") ? SymbolInfoDouble(Symbol(), SYMBOL_ASK) : SymbolInfoDouble(Symbol(), SYMBOL_BID);
   int    dir    = (cmd == "BUY") ? 1 : -1;
   int    digits = (int)SymbolInfoInteger(Symbol(), SYMBOL_DIGITS);

   // Filter entry P1: harga sekarang harus dalam toleransi $InpEntryToleranceUSD dari harga sinyal AI (g_price)
   if(g_price > 0)
   {
      double priceDiff = MathAbs(price - g_price);
      if(priceDiff > InpEntryToleranceUSD)
      {
         Print("[Layer] ⏳ P1 DITAHAN — harga sekarang $", DoubleToString(price, 2),
               " beda $", DoubleToString(priceDiff, 2), " dari harga sinyal AI $", DoubleToString(g_price, 2),
               " (toleransi $", DoubleToString(InpEntryToleranceUSD, 2), "). Menunggu harga mendekat.");
         return;
      }
   }

   // Tetapkan SL sesi dulu — dipakai di dalam OpenLayerMarket/PlaceLayerLimit
   g_sessionSL = NormalizeDouble(g_sl, digits);

   // ── Validasi minimum stop level broker ──────────────────────────────────────
   // Broker menolak order jika SL terlalu dekat ke harga entry.
   // SYMBOL_TRADE_STOPS_LEVEL = jarak minimum dalam points. Kita tambah spread supaya aman.
   {
      long   stopsLvPts  = SymbolInfoInteger(Symbol(), SYMBOL_TRADE_STOPS_LEVEL);
      double point       = SymbolInfoDouble(Symbol(), SYMBOL_POINT);
      double spread      = SymbolInfoDouble(Symbol(), SYMBOL_ASK) - SymbolInfoDouble(Symbol(), SYMBOL_BID);
      double minDistUSD  = (stopsLvPts + 2) * point + spread; // +2 point buffer
      double actualDist  = MathAbs(price - g_sessionSL);

      if(actualDist < minDistUSD)
      {
         double adjusted = (cmd == "BUY")
            ? NormalizeDouble(price - minDistUSD, digits)
            : NormalizeDouble(price + minDistUSD, digits);
         Print("[Layer] ⚠ SL dari sinyal terlalu dekat ($", DoubleToString(actualDist, 2),
               ") — disesuaikan ke $", DoubleToString(adjusted, 2),
               " (min broker: $", DoubleToString(minDistUSD, 2), ")");
         g_sessionSL = adjusted;
      }
   }

   int layers = (int)MathMax(1, MathMin(MAX_LAYERS, InpLayerCount));
   double slDist = MathAbs(price - g_sessionSL);
   if(slDist < (layers - 1) * InpLayerGapUSD)
      Print("[Layer] ⚠ Jarak SL ($", DoubleToString(slDist,2), ") lebih pendek dari lebar grid ($",
            DoubleToString((layers-1)*InpLayerGapUSD,2), ") — sebagian layer terluar mungkin belum sempat terisi sebelum SL kena.");

   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      if(i > layers) { g_layerState[i] = LAYER_NONE; continue; }

      double entry = NormalizeDouble(price - dir * (i - 1) * InpLayerGapUSD, digits);
      double tp    = NormalizeDouble(entry + dir * InpTpDistanceUSD, digits);
      g_layerEntry[i] = entry;
      g_layerTP[i]    = tp;

      if(i == 1)
         OpenLayerMarket(i, cmd, entry, tp);
      else
         PlaceLayerLimit(i, cmd, entry, tp);
   }

   // Aktifkan sesi HANYA jika layer 1 berhasil dibuka — cegah sesi "hantu" tanpa posisi aktif
   if(g_layerState[1] == LAYER_OPEN)
   {
      g_sessionActive    = true;
      g_sessionDirection = cmd;
      Print("[Layer] === Sesi baru AKTIF: ", cmd, " | Harga=$", DoubleToString(price, 2),
            " | SL bersama=$", DoubleToString(g_sessionSL, 2),
            " | Layers=", layers, " | Total lot maks=", DoubleToString(layers * InpLotSize, 2), " ===");
   }
   else
   {
      // Layer 1 gagal (ditolak broker) — batalkan semua pending layer yang sempat dipasang
      Print("[Layer] ⛔ Layer 1 GAGAL dibuka — sesi dibatalkan, batalkan pending layers.");
      for(int k = 2; k <= layers; k++)
      {
         if(g_layerState[k] == LAYER_PENDING)
         {
            ulong ordT = FindLayerPendingOrder(k);
            if(ordT != 0) g_trade.OrderDelete(ordT);
            g_layerState[k] = LAYER_NONE;
         }
      }
      g_sessionSL = 0;
   }
}

//+------------------------------------------------------------------+
// Tutup semua posisi & hapus semua pending order milik EA ini (semua layer)
void CloseEntireSession()
{
   for(int idx = PositionsTotal() - 1; idx >= 0; idx--)
   {
      ulong ticket = PositionGetTicket(idx);
      if(!PositionSelectByTicket(ticket))                 continue;
      if(PositionGetString(POSITION_SYMBOL) != Symbol())  continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      g_trade.PositionClose(ticket);
   }
   for(int idx = OrdersTotal() - 1; idx >= 0; idx--)
   {
      ulong ticket = OrderGetTicket(idx);
      if(!OrderSelect(ticket))                        continue;
      if(OrderGetString(ORDER_SYMBOL) != Symbol())     continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;
      g_trade.OrderDelete(ticket);
   }
   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      g_layerState[i] = LAYER_NONE;
      g_layerPosId[i] = 0;
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
   bool useAiUtama = (InpSensitivity == "ai_utama");

   string url = InpApiUrl + "/api/xauusd/ea-signal"
              + "?key=" + InpEaApiKey
              + (useAiUtama
                    // Mode AI Utama: arah dari total % 4 agen ensemble, SL/TP tetap
                    // pakai skala sensitivity "aggressive" (default server: SL=0.80*ATR*0.45)
                    ? "&mode=ai_utama&sensitivity=aggressive"
                    : "&sensitivity=" + InpSensitivity)
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

   if(numParts >= 6)
   {
      g_rawCommand = parts[0];
      g_price      = StringToDouble(parts[1]);
      g_sl         = StringToDouble(parts[5]);
      g_conf       = (numParts >= 9) ? StringToDouble(parts[8]) : 0;
   }
   else
   {
      Print("[ERROR] Respons tidak valid: ", resp);
      if(InpShowPanel) SetLabelText(LBL_STATUS, "Respons tidak valid", clrRed);
      return;
   }

   //--- Terapkan Reverse Mode (balik sinyal, hitung ulang SL berbasis jarak SL asli)
   string cmd = g_rawCommand;
   if(InpReverseMode)
   {
      if(cmd == "BUY")       cmd = "SELL";
      else if(cmd == "SELL") cmd = "BUY";

      if(cmd == "BUY" || cmd == "SELL")
      {
         double slDist = (g_price > 0 && g_sl > 0) ? MathAbs(g_price - g_sl) : 5.0;
         g_sl = (cmd == "BUY")
            ? NormalizeDouble(g_price - slDist, _Digits)
            : NormalizeDouble(g_price + slDist, _Digits);
      }
   }

   Print("[Sinyal] ", g_rawCommand,
         (InpReverseMode ? " -> " + cmd + " (REVERSE)" : ""),
         " | $", DoubleToString(g_price, 2),
         " | SL=", DoubleToString(g_sl, 2),
         " | Conf=", DoubleToString(g_conf * 100, 0), "%");

   if(InpShowPanel) UpdatePanel(cmd);

   if(!InpAutoTrade) return;

   //--- HOLD → tutup sesi grid jika sedang aktif
   if(cmd == "HOLD")
   {
      if(g_sessionActive)
      {
         Print("[Layer] Sinyal HOLD — tutup sesi grid.");
         CloseEntireSession();
         g_sessionActive    = false;
         g_sessionDirection = "HOLD";
      }
      return;
   }

   //--- Belum ada sesi → mulai baru
   if(!g_sessionActive)
   {
      StartNewSession(cmd);
      // Update panel sekarang supaya user langsung lihat status sesi (bukan menunggu poll berikutnya)
      if(InpShowPanel) UpdatePanel(cmd);
      return;
   }

   //--- Sinyal berbalik arah → tutup sesi lama, buka sesi baru
   if(g_sessionDirection != cmd)
   {
      Print("[Layer] Sinyal berbalik arah (", g_sessionDirection, " → ", cmd, ") — tutup sesi lama, buka baru.");
      CloseEntireSession();
      g_sessionActive = false;
      StartNewSession(cmd);
      return;
   }

   //--- Sinyal sama & sesi masih jalan → tidak ada aksi, grid dikelola di OnTick
}

//+------------------------------------------------------------------+
void StringToUcharArray(const string text, uchar &buf[])
{
   int len = StringLen(text);
   ArrayResize(buf, len);
   StringToCharArray(text, buf, 0, len);
}

//+------------------------------------------------------------------+
void CountLayerStates(int &open_, int &pending_, int &done_)
{
   open_ = 0; pending_ = 0; done_ = 0;
   for(int i = 1; i <= MAX_LAYERS; i++)
   {
      if(g_layerState[i] == LAYER_OPEN)         open_++;
      else if(g_layerState[i] == LAYER_PENDING) pending_++;
      else if(g_layerState[i] == LAYER_DONE)    done_++;
   }
}

//+------------------------------------------------------------------+
//                         PANEL FUNCTIONS
//+------------------------------------------------------------------+
void CreatePanel()
{
   int x = 10, y = 25, w = 300, h = 175;
   if(ObjectFind(0, LBL_BG) >= 0) DeletePanel();

   ObjectCreate(0, LBL_BG, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XDISTANCE,   x);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YDISTANCE,   y);
   ObjectSetInteger(0, LBL_BG, OBJPROP_XSIZE,        w);
   ObjectSetInteger(0, LBL_BG, OBJPROP_YSIZE,        h);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BGCOLOR,      C'12,14,22');
   ObjectSetInteger(0, LBL_BG, OBJPROP_BORDER_COLOR, C'0,150,180');
   ObjectSetInteger(0, LBL_BG, OBJPROP_CORNER,       CORNER_LEFT_UPPER);
   ObjectSetInteger(0, LBL_BG, OBJPROP_BACK,         false);
   ObjectSetInteger(0, LBL_BG, OBJPROP_SELECTABLE,   false);

   MakeLabel(LBL_TITLE,   x+8, y+6,   "RADAR GOLD LAYER  v1.0",       C'0,180,210', 9);
   MakeLabel(LBL_STATUS,  x+8, y+22,  "Menghubungkan...",              clrGray,      8);
   MakeLabel(LBL_CMD,     x+8, y+42,  "---",                           clrGray,     18);
   MakeLabel(LBL_SESSION, x+8, y+72,  "Sesi: tidak aktif",             clrGray,      8);
   MakeLabel(LBL_LAYERS,  x+8, y+86,  "Menunggu sinyal...",            clrSilver,    8);
   MakeLabel(LBL_PNL,     x+8, y+100, "Floating P/L: $0.00",           clrSilver,    8);
   MakeLabel(LBL_CONF,    x+8, y+114, "Conf: --- | Auto: OFF",         clrSilver,    8);
   MakeLabel(LBL_TIME,    x+8, y+140, "---",                           C'0,90,105',  7);

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
   if(cmd == "BUY")       { cmdColor = clrLime; cmdText = "BUY  (NAIK)"; }
   else if(cmd == "SELL") { cmdColor = clrRed;  cmdText = "SELL (TURUN)"; }
   else                   { cmdColor = clrGray; cmdText = "HOLD (TUNGGU)"; }

   SetLabelText(LBL_STATUS, "Terhubung | polling " + IntegerToString(POLL_INTERVAL_SEC) + "s", clrLime);
   SetLabelText(LBL_CMD,    cmdText + "  $" + DoubleToString(g_price, 2), cmdColor);
   SetLabelText(LBL_CONF,
      "Conf: " + DoubleToString(g_conf * 100, 0) + "% | Auto: " + (InpAutoTrade ? "ON" : "OFF"),
      InpAutoTrade ? clrLime : clrGray);

   if(g_sessionActive)
   {
      int o, p, d;
      CountLayerStates(o, p, d);
      SetLabelText(LBL_SESSION,
         "Sesi " + g_sessionDirection + " | SL bersama: $" + DoubleToString(g_sessionSL, 2),
         clrOrange);
      SetLabelText(LBL_LAYERS,
         "Layer → Open:" + IntegerToString(o) + "  Pending:" + IntegerToString(p) + "  Done:" + IntegerToString(d),
         clrSilver);

      double pnl = 0;
      for(int idx = 0; idx < PositionsTotal(); idx++)
      {
         ulong t = PositionGetTicket(idx);
         if(!PositionSelectByTicket(t))                 continue;
         if(PositionGetString(POSITION_SYMBOL) != Symbol()) continue;
         if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
         pnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      }
      SetLabelText(LBL_PNL, "Floating P/L: $" + DoubleToString(pnl, 2), pnl >= 0 ? clrLime : clrRed);
   }
   else
   {
      SetLabelText(LBL_SESSION, "Sesi: tidak aktif", clrGray);
      SetLabelText(LBL_LAYERS,  "Menunggu sinyal baru...", clrGray);
      SetLabelText(LBL_PNL,     "Floating P/L: $0.00", clrGray);
   }

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   SetLabelText(LBL_TIME,
      StringFormat("Update: %02d:%02d:%02d | RadarGoldLayer v1", dt.hour, dt.min, dt.sec),
      C'0,90,105');

   ChartRedraw();
}

//+------------------------------------------------------------------+
void DeletePanel()
{
   string labels[] = {
      LBL_BG, LBL_TITLE, LBL_STATUS, LBL_CMD, LBL_SESSION,
      LBL_LAYERS, LBL_PNL, LBL_CONF, LBL_TIME
   };
   for(int i = 0; i < ArraySize(labels); i++)
      ObjectDelete(0, labels[i]);
   ChartRedraw();
}
//+------------------------------------------------------------------+
