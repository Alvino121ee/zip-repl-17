/**
 * News collector — ambil berita pasar dari RSS feeds media keuangan Indonesia
 */

export interface NewsArticle {
  title: string;
  link: string;
  summary: string;
  source: string;
  publishedAt: Date;
  tickers: string[];
}

const RSS_SOURCES = [
  { name: "CNBC Indonesia", url: "https://www.cnbcindonesia.com/market/rss" },
  { name: "Detik Finance",  url: "https://finance.detik.com/rss" },
  { name: "CNBC Investasi", url: "https://www.cnbcindonesia.com/investment/rss" },
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/rss+xml, application/xml, text/xml",
};

function extractCdata(str: string): string {
  const m = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1].trim() : str.replace(/<[^>]+>/g, "").trim();
}

function parseDate(str: string): Date {
  try { return new Date(str); } catch { return new Date(); }
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
}

/** Tiker IDX yang dikenal — untuk pencocokan di judul berita */
const KNOWN_TICKERS = [
  "BBCA","BBRI","BMRI","TLKM","ASII","UNVR","ICBP","INDF","ADRO","ITMG",
  "ANTM","MDKA","BRPT","TPIA","GOTO","BUKA","EXCL","ISAT","KLBF","CPIN",
  "BBNI","BBTN","BTPS","ARTO","SMGR","INTP","GGRM","HMSP","AMRT","MAPI",
  "ACES","BSDE","PWON","SMRA","CTRA","WIKA","PTPP","JSMR","PGAS","MEDC",
  "AKRA","PTBA","HRUM","AUTO","IMAS","MYOR","SIDO","ULTJ","JPFA","AALI",
  "LSIP","TOWR","TBIG","MTEL","MNCN","SCMA","SILO","MIKA","PRDL","BACH",
  "BREN","AMMN","ESSA","NICL","DGNS","MAPA","AVIA","DCII","BYAN","TINS",
  "INCO","VALE","ELSA","ERAA","WIFI","MCAS","PMMP","MBMA","NCKL","DSSA",
  "EMTK","KBIG","PGEO","CUAN","BIPI","BOBA","FILM","PRAY","MOLI","KEEN",
];

function extractTickers(text: string): string[] {
  const upper = text.toUpperCase();
  return KNOWN_TICKERS.filter(ticker => {
    const re = new RegExp(`\\b${ticker}\\b`);
    return re.test(upper);
  });
}

async function fetchRss(source: { name: string; url: string }): Promise<NewsArticle[]> {
  try {
    const res = await fetch(source.url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const xml = await res.text();

    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
    const articles: NewsArticle[] = [];

    for (const item of itemMatches) {
      const titleRaw = (item.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? "";
      const linkRaw  = (item.match(/<link>([\s\S]*?)<\/link>/)  ?? [])[1] ?? "";
      const descRaw  = (item.match(/<description>([\s\S]*?)<\/description>/) ?? [])[1] ?? "";
      const pubRaw   = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? "";

      const title = extractCdata(titleRaw);
      const link  = extractCdata(linkRaw).trim();
      const summary = stripHtml(extractCdata(descRaw)).slice(0, 400);
      const publishedAt = parseDate(pubRaw);

      if (!title || !link) continue;

      const tickers = extractTickers(title + " " + summary);

      articles.push({ title, link, summary, source: source.name, publishedAt, tickers });
    }

    return articles;
  } catch {
    return [];
  }
}

export async function fetchAllNews(limit = 100): Promise<NewsArticle[]> {
  const results = await Promise.all(RSS_SOURCES.map(fetchRss));
  const all = results.flat();

  // Urutkan terbaru dulu, hapus duplikat
  const seen = new Set<string>();
  const unique: NewsArticle[] = [];
  for (const a of all.sort((x, y) => y.publishedAt.getTime() - x.publishedAt.getTime())) {
    if (!seen.has(a.link)) {
      seen.add(a.link);
      unique.push(a);
    }
  }

  return unique.slice(0, limit);
}

export async function fetchNewsForTicker(ticker: string, limit = 20): Promise<NewsArticle[]> {
  const all = await fetchAllNews(200);
  return all.filter(a => a.tickers.includes(ticker)).slice(0, limit);
}
