/**
 * AI Analyst menggunakan DeepSeek API (OpenAI-compatible)
 * Set DEEPSEEK_API_KEY di Secrets untuk mengaktifkan analisis AI.
 * Jika key tidak ada, sistem tetap jalan dengan analisis berbasis aturan.
 */

export interface StockAnalysisInput {
  ticker: string;
  name: string;
  sector: string;
  currentPrice: number;
  priceChangePct: number;
  totalScore: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  riskScore: number;
  fundamentalScore: number;
  label: string;
  ma20?: number | null;
  ma50?: number | null;
  rsi14?: number | null;
  pe?: number | null;
  pb?: number | null;
  roe?: number | null;
  dividendYield?: number | null;
  recentNews?: string[];
}

export interface StockAnalysisResult {
  ticker: string;
  recommendation: "BELI" | "TAHAN" | "JUAL";
  confidence: number;
  insight: string;
  reasoning: string;
  bullish: string;
  bearish: string;
  aiPowered: boolean;
}

function ruleBasedAnalysis(input: StockAnalysisInput): StockAnalysisResult {
  const { totalScore, trendScore, momentumScore, riskScore, priceChangePct, label } = input;

  let recommendation: "BELI" | "TAHAN" | "JUAL";
  let confidence: number;

  if (totalScore >= 70 && trendScore >= 65 && riskScore <= 50) {
    recommendation = "BELI";
    confidence = Math.min(85, Math.round(totalScore));
  } else if (totalScore <= 40 || label === "Avoid") {
    recommendation = "JUAL";
    confidence = Math.min(80, Math.round(100 - totalScore));
  } else {
    recommendation = "TAHAN";
    confidence = 60;
  }

  const insight = `${input.name} (${input.ticker}) mendapat skor algoritmik ${totalScore.toFixed(1)}/100 dengan label "${label}". ` +
    `Harga saat ini Rp ${input.currentPrice.toLocaleString("id-ID")} (${priceChangePct >= 0 ? "+" : ""}${(priceChangePct * 100).toFixed(2)}% hari ini). ` +
    `RSI14: ${input.rsi14 ? input.rsi14.toFixed(1) : "N/A"}, MA20: ${input.ma20 ? "Rp " + input.ma20.toLocaleString("id-ID") : "N/A"}.`;

  const bullish = trendScore >= 60
    ? `Tren harga masih positif (tren skor ${trendScore.toFixed(0)}), momentum ${momentumScore.toFixed(0)}.`
    : `Potensi pemulihan jika volume meningkat.`;

  const bearish = riskScore >= 55
    ? `Risiko relatif tinggi (risk skor ${riskScore.toFixed(0)}), waspadai volatilitas.`
    : `Tekanan jual jika IHSG melemah.`;

  const reasoning = `Skor total ${totalScore.toFixed(1)}: tren=${trendScore.toFixed(0)}, momentum=${momentumScore.toFixed(0)}, volume=${input.volumeScore.toFixed(0)}, risiko=${riskScore.toFixed(0)}.`;

  return { ticker: input.ticker, recommendation, confidence, insight, reasoning, bullish, bearish, aiPowered: false };
}

async function deepseekAnalysis(input: StockAnalysisInput): Promise<StockAnalysisResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return ruleBasedAnalysis(input);

  const newsSection = input.recentNews && input.recentNews.length > 0
    ? `\nBerita terkini:\n${input.recentNews.slice(0, 3).map(n => `- ${n}`).join("\n")}`
    : "";

  const prompt = `Kamu adalah analis saham BEI (Bursa Efek Indonesia) berpengalaman. Analisis saham berikut dan berikan rekomendasi investasi dalam Bahasa Indonesia.

SAHAM: ${input.ticker} - ${input.name}
Sektor: ${input.sector}
Harga: Rp ${input.currentPrice.toLocaleString("id-ID")} (${input.priceChangePct >= 0 ? "+" : ""}${(input.priceChangePct * 100).toFixed(2)}% hari ini)

SKOR TEKNIKAL (skala 0-100):
- Total Score: ${input.totalScore.toFixed(1)} | Label: ${input.label}
- Tren: ${input.trendScore.toFixed(1)} | Momentum: ${input.momentumScore.toFixed(1)}
- Volume: ${input.volumeScore.toFixed(1)} | Risiko: ${input.riskScore.toFixed(1)}
- RSI14: ${input.rsi14?.toFixed(1) ?? "N/A"} | MA20: ${input.ma20 ? "Rp " + input.ma20.toLocaleString("id-ID") : "N/A"}

FUNDAMENTAL:
- P/E: ${input.pe?.toFixed(1) ?? "N/A"} | P/B: ${input.pb?.toFixed(1) ?? "N/A"}
- ROE: ${input.roe ? (input.roe * 100).toFixed(1) + "%" : "N/A"}
- Dividen Yield: ${input.dividendYield ? (input.dividendYield * 100).toFixed(1) + "%" : "N/A"}
${newsSection}

Berikan analisis dalam format JSON persis seperti ini:
{
  "recommendation": "BELI" atau "TAHAN" atau "JUAL",
  "confidence": angka 0-100,
  "insight": "1 paragraf ringkasan analisis 2-3 kalimat",
  "reasoning": "alasan utama rekomendasi, 1-2 kalimat",
  "bullish": "skenario positif 1 kalimat",
  "bearish": "risiko utama 1 kalimat"
}`;

  try {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.warn(`[deepseek] HTTP ${res.status} untuk ${input.ticker}`);
      return ruleBasedAnalysis(input);
    }

    const data = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<StockAnalysisResult>;

    return {
      ticker: input.ticker,
      recommendation: (parsed.recommendation as StockAnalysisResult["recommendation"]) ?? "TAHAN",
      confidence: parsed.confidence ?? 60,
      insight: parsed.insight ?? "",
      reasoning: parsed.reasoning ?? "",
      bullish: parsed.bullish ?? "",
      bearish: parsed.bearish ?? "",
      aiPowered: true,
    };
  } catch (err) {
    console.warn(`[deepseek] Error untuk ${input.ticker}:`, err);
    return ruleBasedAnalysis(input);
  }
}

export async function analyzeStock(input: StockAnalysisInput): Promise<StockAnalysisResult> {
  return deepseekAnalysis(input);
}

export function isAiEnabled(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}
