import { logger } from "./logger";

export interface StockContext {
  ticker: string;
  name: string;
  sector: string;
  currentPrice: number;
  priceChangePct: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  liquidityScore: number;
  fundamentalScore: number;
  valuationScore: number;
  riskScore: number;
  totalScore: number;
  label: string;
  ma20?: number | null;
  ma50?: number | null;
  ma200?: number | null;
  rsi14?: number | null;
  supportLevel?: number | null;
  resistanceLevel?: number | null;
  pe?: number | null;
  pb?: number | null;
  roe?: number | null;
  debtEquity?: number | null;
  eps?: number | null;
  dividendYield?: number | null;
  beta?: number | null;
}

export interface AiReportContent {
  summary: string;
  riskAnalysis: string;
  bullishScenario: string;
  bearishScenario: string;
  conclusion: string;
}

function fmt(n: number | null | undefined, dec = 2): string {
  if (n == null) return "tidak tersedia";
  return n.toFixed(dec);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "tidak tersedia";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/**
 * Generate AI report menggunakan OpenAI/API dari environment.
 * Jika AI API tidak tersedia, gunakan template berbasis data.
 */
export async function generateAiReport(ctx: StockContext): Promise<AiReportContent> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;

  if (apiKey) {
    try {
      return await generateWithAI(ctx, apiKey);
    } catch (err) {
      logger.warn({ err, ticker: ctx.ticker }, "AI API gagal, fallback ke template");
    }
  }

  return generateFromTemplate(ctx);
}

async function generateWithAI(ctx: StockContext, apiKey: string): Promise<AiReportContent> {
  const baseUrl = process.env.AI_API_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  const prompt = buildPrompt(ctx);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `Kamu adalah analis data saham Indonesia yang objektif. 
Tugasmu hanya menjelaskan data dan scoring yang ada — BUKAN memberi rekomendasi investasi.
DILARANG: janji profit, kata "pasti naik/turun", ajakan beli/jual, rekomendasi spesifik.
Gunakan bahasa Indonesia yang jelas dan profesional. Format output: JSON dengan field summary, riskAnalysis, bullishScenario, bearishScenario, conclusion.
Setiap field cukup 2-4 paragraf padat.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const content = JSON.parse(data.choices[0].message.content) as AiReportContent;
  return content;
}

function buildPrompt(ctx: StockContext): string {
  return `Buat laporan analisis data untuk saham ${ctx.ticker} (${ctx.name}) di sektor ${ctx.sector}.

DATA TEKNIKAL:
- Harga saat ini: Rp ${ctx.currentPrice.toLocaleString("id-ID")} (${fmtPct(ctx.priceChangePct)} hari ini)
- MA20: ${fmt(ctx.ma20)} | MA50: ${fmt(ctx.ma50)} | MA200: ${fmt(ctx.ma200)}
- RSI14: ${fmt(ctx.rsi14)} | Support: ${fmt(ctx.supportLevel)} | Resistance: ${fmt(ctx.resistanceLevel)}

SCORING SAHAM (0-100):
- Trend: ${fmt(ctx.trendScore)} | Momentum: ${fmt(ctx.momentumScore)} | Volume: ${fmt(ctx.volumeScore)}
- Likuiditas: ${fmt(ctx.liquidityScore)} | Fundamental: ${fmt(ctx.fundamentalScore)}
- Valuasi: ${fmt(ctx.valuationScore)} | Risiko: ${fmt(ctx.riskScore)}
- TOTAL SCORE: ${fmt(ctx.totalScore)} → Label: ${ctx.label}

DATA FUNDAMENTAL:
- PE Ratio: ${fmt(ctx.pe)} | PB Ratio: ${fmt(ctx.pb)} | ROE: ${fmtPct(ctx.roe != null ? ctx.roe * 100 : null)}
- EPS: ${fmt(ctx.eps)} | Debt/Equity: ${fmt(ctx.debtEquity)} | Dividend Yield: ${fmtPct(ctx.dividendYield != null ? ctx.dividendYield * 100 : null)}
- Beta: ${fmt(ctx.beta)}

Buat analisis data objektif (BUKAN rekomendasi) dalam format JSON:
{
  "summary": "Ringkasan kondisi teknikal dan fundamental berdasarkan data di atas",
  "riskAnalysis": "Analisis faktor risiko berdasarkan data scoring dan fundamental",
  "bullishScenario": "Skenario positif jika indikator teknikal dan fundamental terkonfirmasi",
  "bearishScenario": "Skenario negatif jika kondisi memburuk berdasarkan data",
  "conclusion": "Kesimpulan objektif tentang posisi saham ini berdasarkan data"
}`;
}

function generateFromTemplate(ctx: StockContext): AiReportContent {
  const pricePos =
    ctx.ma20 && ctx.currentPrice > ctx.ma20
      ? "di atas MA20"
      : ctx.ma20
        ? "di bawah MA20"
        : "tidak dapat dibandingkan dengan MA20";

  const maPos =
    ctx.ma50 && ctx.ma200
      ? ctx.ma50 > ctx.ma200
        ? "MA50 berada di atas MA200 (golden cross area)"
        : "MA50 berada di bawah MA200 (death cross area)"
      : "";

  const rsiStr =
    ctx.rsi14 != null
      ? ctx.rsi14 > 70
        ? `RSI ${ctx.rsi14.toFixed(1)} menunjukkan kondisi overbought`
        : ctx.rsi14 < 30
          ? `RSI ${ctx.rsi14.toFixed(1)} menunjukkan kondisi oversold`
          : `RSI ${ctx.rsi14.toFixed(1)} berada di zona netral`
      : "";

  const trendStr =
    ctx.trendScore >= 70 ? "tren kuat ke atas" :
    ctx.trendScore >= 50 ? "tren moderat" :
    "tren melemah";

  const fundStr =
    ctx.fundamentalScore >= 70 ? "fundamental solid" :
    ctx.fundamentalScore >= 50 ? "fundamental cukup baik" :
    "fundamental perlu diperhatikan";

  const riskStr =
    ctx.riskScore >= 70 ? "tingkat risiko tinggi" :
    ctx.riskScore >= 50 ? "tingkat risiko moderat" :
    "profil risiko relatif terkendali";

  const summary =
    `${ctx.name} (${ctx.ticker}) saat ini diperdagangkan di Rp ${ctx.currentPrice.toLocaleString("id-ID")} ` +
    `dengan pergerakan ${fmtPct(ctx.priceChangePct)} pada sesi terakhir. Harga berada ${pricePos}. ` +
    (maPos ? `${maPos}. ` : "") +
    (rsiStr ? `${rsiStr}. ` : "") +
    `Total score algoritmik mencapai ${ctx.totalScore.toFixed(1)} dari 100, ` +
    `menempatkan saham ini dalam kategori "${ctx.label}". ` +
    `Berdasarkan data, saham ini menunjukkan ${trendStr} dengan ${fundStr}.`;

  const riskAnalysis =
    `Analisis risiko ${ctx.ticker} menunjukkan ${riskStr} dengan risk score ${ctx.riskScore.toFixed(1)}. ` +
    (ctx.debtEquity != null ? `Rasio utang terhadap ekuitas tercatat di ${ctx.debtEquity.toFixed(2)}, ` +
    (ctx.debtEquity > 2 ? "yang tergolong tinggi dan berpotensi membebani keuangan perusahaan. " :
    ctx.debtEquity > 1 ? "yang perlu dipantau perkembangannya. " :
    "yang tergolong sehat. ") : "") +
    (ctx.beta != null ? `Beta saham sebesar ${ctx.beta.toFixed(2)} menunjukkan ` +
    (ctx.beta > 1.2 ? "volatilitas lebih tinggi dari pasar secara keseluruhan. " :
    ctx.beta < 0.8 ? "volatilitas lebih rendah dari pasar. " :
    "volatilitas sejalan dengan pasar. ") : "") +
    `Investor perlu mempertimbangkan kondisi likuiditas (score: ${ctx.liquidityScore.toFixed(1)}) ` +
    `sebelum mengambil posisi besar pada saham ini.`;

  const bullishScenario =
    `Skenario positif ${ctx.ticker} dapat terjadi jika: ` +
    (ctx.resistanceLevel != null ? `harga berhasil menembus level resistance di sekitar Rp ${ctx.resistanceLevel.toLocaleString("id-ID")} ` +
    `dengan volume yang memadai, ` : "") +
    `momentum teknikal (score: ${ctx.momentumScore.toFixed(1)}) terus menguat, ` +
    `dan kondisi fundamental perusahaan terus menunjukkan perbaikan. ` +
    (ctx.roe != null ? `ROE saat ini ${(ctx.roe * 100).toFixed(1)}% ` +
    (ctx.roe >= 0.15 ? "yang tergolong baik menjadi penopang valuasi. " :
    "yang masih dapat ditingkatkan. ") : "") +
    `Skenario ini bersifat ilustratif berdasarkan data historis dan tidak menjamin pergerakan harga ke depan.`;

  const bearishScenario =
    `Skenario negatif dapat terjadi jika ` +
    (ctx.supportLevel != null ? `harga gagal bertahan di atas support Rp ${ctx.supportLevel.toLocaleString("id-ID")}, ` : "") +
    `volume penjualan meningkat signifikan, ` +
    `atau terjadi perubahan kondisi fundamental perusahaan yang merugikan. ` +
    `Dengan risk score ${ctx.riskScore.toFixed(1)}, ` +
    (ctx.riskScore >= 60 ? "probabilitas tekanan jual cukup perlu diwaspadai. " :
    "profil risiko masih dapat dikelola. ") +
    `Faktor eksternal seperti kondisi makroekonomi Indonesia dan sentimen pasar global ` +
    `juga dapat mempengaruhi pergerakan harga saham ini.`;

  const conclusion =
    `Berdasarkan analisis data algoritmik, ${ctx.ticker} memperoleh total score ${ctx.totalScore.toFixed(1)}/100 ` +
    `dengan kategori "${ctx.label}". Kekuatan utama tercermin dari skor ` +
    [
      ctx.trendScore >= 65 ? `tren (${ctx.trendScore.toFixed(1)})` : null,
      ctx.fundamentalScore >= 65 ? `fundamental (${ctx.fundamentalScore.toFixed(1)})` : null,
      ctx.valuationScore >= 65 ? `valuasi (${ctx.valuationScore.toFixed(1)})` : null,
    ].filter(Boolean).join(", ") || "yang masih perlu ditingkatkan" +
    ". " +
    `Perlu diingat bahwa scoring ini bersifat algoritmik berdasarkan data historis dan tidak mencerminkan kondisi masa depan. ` +
    `Setiap keputusan investasi harus didasarkan pada riset mendalam dan pertimbangan risiko pribadi masing-masing investor.`;

  return { summary, riskAnalysis, bullishScenario, bearishScenario, conclusion };
}
