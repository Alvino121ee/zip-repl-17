/**
 * Seed data saham BEI (IDX) untuk SahamRadar AI
 * Mencakup ~500+ saham yang terdaftar di IDX
 * Jalankan: cd artifacts/api-server && ../../scripts/node_modules/.bin/tsx src/scripts/seed.ts
 */

import { db } from "@workspace/db";
import {
  stocksTable,
  stockPricesTable,
  stockFundamentalsTable,
  stockScoresTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { calculateScores } from "../lib/scoring";

// ─── DAFTAR LENGKAP SAHAM IDX ────────────────────────────────────────────────
const ALL_STOCKS: { ticker: string; name: string; sector: string; description: string }[] = [
  // === PERBANKAN ===
  { ticker: "BBCA", name: "Bank Central Asia Tbk", sector: "Perbankan", description: "Bank swasta terbesar di Indonesia dengan jaringan ATM dan layanan digital terlengkap." },
  { ticker: "BBRI", name: "Bank Rakyat Indonesia Tbk", sector: "Perbankan", description: "Bank BUMN terbesar dengan fokus UMKM dan layanan di seluruh pelosok Indonesia." },
  { ticker: "BMRI", name: "Bank Mandiri Tbk", sector: "Perbankan", description: "Bank BUMN terbesar berdasarkan aset dengan layanan korporasi dan retail." },
  { ticker: "BBNI", name: "Bank Negara Indonesia Tbk", sector: "Perbankan", description: "Bank BUMN dengan jaringan internasional dan fokus korporasi serta UMKM." },
  { ticker: "BBTN", name: "Bank Tabungan Negara Tbk", sector: "Perbankan", description: "Bank BUMN spesialis pembiayaan perumahan (KPR) terbesar di Indonesia." },
  { ticker: "BNGA", name: "Bank CIMB Niaga Tbk", sector: "Perbankan", description: "Bank swasta terbesar keempat di Indonesia, bagian dari grup CIMB Malaysia." },
  { ticker: "NISP", name: "Bank OCBC NISP Tbk", sector: "Perbankan", description: "Bank swasta dengan layanan perbankan retail dan korporasi, bagian dari OCBC Group." },
  { ticker: "BNII", name: "Bank Maybank Indonesia Tbk", sector: "Perbankan", description: "Bank swasta bagian dari Maybank Malaysia dengan fokus layanan retail dan UMKM." },
  { ticker: "BDMN", name: "Bank Danamon Indonesia Tbk", sector: "Perbankan", description: "Bank swasta dengan fokus segmen ritel, mikro, dan pembiayaan kendaraan." },
  { ticker: "MAYA", name: "Bank Mayapada Internasional Tbk", sector: "Perbankan", description: "Bank swasta nasional dengan fokus segmen komersial dan UMKM." },
  { ticker: "BJTM", name: "Bank Pembangunan Daerah Jawa Timur Tbk", sector: "Perbankan", description: "Bank daerah Jawa Timur dengan fokus layanan masyarakat dan pemerintah daerah." },
  { ticker: "BJBR", name: "Bank Pembangunan Daerah Jabar dan Banten Tbk", sector: "Perbankan", description: "Bank daerah Jawa Barat dan Banten dengan jaringan luas di kedua provinsi." },
  { ticker: "BSIM", name: "Bank Sinarmas Tbk", sector: "Perbankan", description: "Bank swasta bagian dari Sinarmas Group dengan layanan perbankan digital." },
  { ticker: "BCIC", name: "Bank J Trust Indonesia Tbk", sector: "Perbankan", description: "Bank swasta hasil akuisisi J Trust dari Jepang." },
  { ticker: "BACA", name: "Bank Capital Indonesia Tbk", sector: "Perbankan", description: "Bank swasta skala menengah dengan fokus segmen korporasi." },
  { ticker: "BBMD", name: "Bank Mestika Dharma Tbk", sector: "Perbankan", description: "Bank swasta regional Sumatera dengan jaringan di berbagai kota." },
  { ticker: "BABP", name: "Bank MNC Internasional Tbk", sector: "Perbankan", description: "Bank digital MNC Group yang berfokus pada layanan perbankan berbasis teknologi." },
  { ticker: "BINA", name: "Bank Ina Perdana Tbk", sector: "Perbankan", description: "Bank swasta kecil yang beroperasi di segmen retail dan UMKM." },
  { ticker: "BMAS", name: "Bank Maspion Indonesia Tbk", sector: "Perbankan", description: "Bank swasta regional Jawa Timur dengan fokus segmen UMKM." },
  { ticker: "BNBA", name: "Bank Bumi Arta Tbk", sector: "Perbankan", description: "Bank swasta dengan fokus segmen komersial menengah." },
  { ticker: "BTPN", name: "Bank BTPN Tbk", sector: "Perbankan", description: "Bank dengan fokus pensiunan dan UMKM, dikenal dengan Jenius digital banking." },
  { ticker: "BTPS", name: "BTPN Syariah Tbk", sector: "Perbankan", description: "Bank syariah dengan fokus pembiayaan UMKM dan nasabah pra-sejahtera produktif." },
  { ticker: "ARTO", name: "Bank Jago Tbk", sector: "Perbankan", description: "Bank digital yang berkolaborasi erat dengan ekosistem GoTo." },
  { ticker: "BANK", name: "Bank Aladin Syariah Tbk", sector: "Perbankan", description: "Bank digital syariah yang terintegrasi dengan ekosistem e-commerce." },
  { ticker: "AGRO", name: "Bank Raya Indonesia Tbk", sector: "Perbankan", description: "Bank fokus agribisnis dan UMKM, anak usaha BRI." },
  { ticker: "NOBU", name: "Bank Nationalnobu Tbk", sector: "Perbankan", description: "Bank swasta dengan fokus layanan korporasi dan komersial menengah." },
  { ticker: "PNBN", name: "Bank Pan Indonesia Tbk", sector: "Perbankan", description: "Bank swasta nasional dengan layanan korporasi, komersial, dan retail." },
  { ticker: "BBHI", name: "Allo Bank Indonesia Tbk", sector: "Perbankan", description: "Bank digital Chairul Tanjung Group yang terintegrasi dengan aplikasi Allo Bank." },
  { ticker: "BBYB", name: "Bank Neo Commerce Tbk", sector: "Perbankan", description: "Bank digital dengan produk tabungan dan pinjaman berbasis aplikasi." },
  { ticker: "DNAR", name: "Bank Oke Indonesia Tbk", sector: "Perbankan", description: "Bank digital dengan layanan simpanan dan kredit berbasis teknologi." },
  { ticker: "INPC", name: "Bank Artha Graha Internasional Tbk", sector: "Perbankan", description: "Bank swasta dengan fokus layanan segmen korporasi menengah." },
  { ticker: "MCOR", name: "Bank China Construction Bank Indonesia Tbk", sector: "Perbankan", description: "Bank hasil akuisisi China Construction Bank, fokus korporasi." },
  { ticker: "PBBK", name: "Bank Neo Commerce Tbk", sector: "Perbankan", description: "Bank pembangunan daerah dengan fokus segmen retail dan pemerintah." },
  { ticker: "SDRA", name: "Bank Woori Saudara Indonesia 1906 Tbk", sector: "Perbankan", description: "Bank hasil kerjasama Woori Bank Korea dengan fokus segmen korporasi." },
  { ticker: "BVIC", name: "Bank Victoria International Tbk", sector: "Perbankan", description: "Bank swasta dengan fokus segmen korporasi dan komersial." },
  { ticker: "BGTG", name: "Bank Ganesha Tbk", sector: "Perbankan", description: "Bank swasta kecil dengan operasi di beberapa kota besar Indonesia." },
  { ticker: "BSWD", name: "Bank of India Indonesia Tbk", sector: "Perbankan", description: "Bank dengan afiliasi Bank of India yang beroperasi di segmen korporasi." },
  { ticker: "BEKS", name: "Bank Pembangunan Daerah Banten Tbk", sector: "Perbankan", description: "Bank daerah Banten dengan jaringan di provinsi Banten." },
  { ticker: "CHEK", name: "Bank Fama Internasional Tbk", sector: "Perbankan", description: "Bank swasta skala kecil beroperasi di segmen retail." },

  // === KEUANGAN NON-BANK (Multifinance, Asuransi, Sekuritas) ===
  { ticker: "ADMF", name: "Adira Dinamika Multi Finance Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan terbesar untuk kendaraan bermotor, anak usaha Bank Danamon." },
  { ticker: "BFIN", name: "BFI Finance Indonesia Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan kendaraan dan aset produktif terkemuka." },
  { ticker: "MFIN", name: "Mandala Multifinance Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan kendaraan bermotor dengan jaringan luas." },
  { ticker: "CFIN", name: "Clipan Finance Indonesia Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan multifinance dengan fokus kendaraan bermotor dan properti." },
  { ticker: "WOMF", name: "Wahana Ottomitra Multiartha Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan sepeda motor Honda, anak usaha MUFG." },
  { ticker: "HDFA", name: "Radana Bhaskara Finance Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan kendaraan bermotor dan multiguna." },
  { ticker: "IMJS", name: "Indomobil Multi Jasa Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan kendaraan, bagian dari grup Indomobil." },
  { ticker: "TIFA", name: "Tifa Finance Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan pembiayaan multiguna dan kendaraan bermotor." },
  { ticker: "ABDA", name: "Asuransi Bina Dana Arta Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan asuransi umum dengan produk kendaraan, properti, dan jiwa." },
  { ticker: "ASDM", name: "Asuransi Dayin Mitra Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan asuransi umum dengan fokus pada aset industri dan kendaraan." },
  { ticker: "ASMI", name: "Asuransi Kresna Mitra Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan asuransi umum dengan portofolio properti dan kendaraan." },
  { ticker: "ASRM", name: "Asuransi Ramayana Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan asuransi jiwa dengan produk tradisional dan unit-linked." },
  { ticker: "LPGI", name: "Lippo General Insurance Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan asuransi umum bagian dari Lippo Group." },
  { ticker: "MREI", name: "Maskapai Reasuransi Indonesia Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan reasuransi dengan portofolio jiwa dan umum." },
  { ticker: "PNIN", name: "Paninvest Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan induk investasi dengan portofolio keuangan diversifikasi." },
  { ticker: "APIC", name: "Pacific Strategic Financial Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan sekuritas dan investasi dengan fokus pasar modal Indonesia." },
  { ticker: "KREN", name: "Kresna Graha Investama Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan investasi dan sekuritas dengan portofolio saham dan obligasi." },
  { ticker: "TRIM", name: "Trimegah Sekuritas Indonesia Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan sekuritas terkemuka dengan layanan saham, obligasi, dan reksa dana." },
  { ticker: "PANS", name: "Panin Sekuritas Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan sekuritas bagian dari Panin Group." },
  { ticker: "BCAP", name: "MNC Kapital Indonesia Tbk", sector: "Keuangan Non-Bank", description: "Perusahaan induk keuangan MNC Group dengan berbagai anak usaha finansial." },

  // === KONSUMER - MAKANAN & MINUMAN ===
  { ticker: "UNVR", name: "Unilever Indonesia Tbk", sector: "Konsumer", description: "Produsen FMCG terkemuka dengan merek-merek ternama seperti Pepsodent, Rinso, Dove." },
  { ticker: "ICBP", name: "Indofood CBP Sukses Makmur Tbk", sector: "Konsumer", description: "Produsen makanan dan minuman terbesar dengan merek Indomie, Chitato, dll." },
  { ticker: "INDF", name: "Indofood Sukses Makmur Tbk", sector: "Konsumer", description: "Perusahaan induk Indofood dengan portofolio bisnis pangan terintegrasi." },
  { ticker: "MYOR", name: "Mayora Indah Tbk", sector: "Konsumer", description: "Produsen makanan dan minuman dengan merek seperti Kopiko dan Roma." },
  { ticker: "ULTJ", name: "Ultrajaya Milk Industry Tbk", sector: "Konsumer", description: "Produsen susu dan minuman UHT dengan merek Ultra Milk dan Teh Kotak." },
  { ticker: "DLTA", name: "Delta Djakarta Tbk", sector: "Konsumer", description: "Produsen bir dan minuman malt terkemuka di Indonesia." },
  { ticker: "CLEO", name: "Sariguna Primatirta Tbk", sector: "Konsumer", description: "Produsen air mineral CLEO dengan distribusi nasional." },
  { ticker: "ROTI", name: "Nippon Indosari Corpindo Tbk", sector: "Konsumer", description: "Produsen roti Sari Roti dengan jaringan distribusi terluas di Indonesia." },
  { ticker: "KEJU", name: "Mulia Boga Raya Tbk", sector: "Konsumer", description: "Produsen keju Prochiz dan produk susu olahan terkemuka." },
  { ticker: "STTP", name: "Siantar Top Tbk", sector: "Konsumer", description: "Produsen mie instan, kerupuk, dan snack dengan merek Mie Gemez." },
  { ticker: "MLBI", name: "Multi Bintang Indonesia Tbk", sector: "Konsumer", description: "Produsen bir Bintang dan Heineken, anak usaha Heineken International." },
  { ticker: "CEKA", name: "Widodo Makmur Unggas Tbk", sector: "Konsumer", description: "Produsen minyak nabati dan lemak khusus untuk industri makanan." },
  { ticker: "SKLT", name: "Sekar Laut Tbk", sector: "Konsumer", description: "Produsen produk makanan olahan dan sambal sachet." },
  { ticker: "CAMP", name: "Campina Ice Cream Industry Tbk", sector: "Konsumer", description: "Produsen es krim dan produk beku terkemuka di Indonesia." },
  { ticker: "PSDN", name: "Prashida Aneka Niaga Tbk", sector: "Konsumer", description: "Produsen produk makanan dan minuman berbasis susu." },
  { ticker: "GOOD", name: "Garudafood Putra Putri Jaya Tbk", sector: "Konsumer", description: "Produsen snack GarudaFood, permen Gery, dan minuman." },
  { ticker: "ALTO", name: "Tri Banyan Tirta Tbk", sector: "Konsumer", description: "Produsen air mineral Alto dan minuman kemasan." },
  { ticker: "FOOD", name: "Sentra Food Indonesia Tbk", sector: "Konsumer", description: "Produsen makanan beku dan olahan untuk segmen retail dan horeka." },
  { ticker: "DMND", name: "Diamond Food Indonesia Tbk", sector: "Konsumer", description: "Produsen produk makanan Diamond dengan diversifikasi di beberapa kategori." },
  { ticker: "BTEK", name: "Bumi Teknokultura Unggul Tbk", sector: "Konsumer", description: "Perusahaan di bidang industri makanan dan teknologi pengolahan pangan." },
  { ticker: "COCO", name: "Wahana Interfood Nusantara Tbk", sector: "Konsumer", description: "Produsen kakao olahan dan produk coklat untuk industri makanan." },
  { ticker: "FAST", name: "Fast Food Indonesia Tbk", sector: "Konsumer", description: "Operator waralaba KFC Indonesia dengan ratusan gerai di seluruh nusantara." },
  { ticker: "TGKA", name: "Tigaraksa Satria Tbk", sector: "Konsumer", description: "Perusahaan distribusi produk konsumer dengan jaringan nasional." },
  { ticker: "DAVO", name: "Davomas Abadi Tbk", sector: "Konsumer", description: "Produsen produk kakao olahan untuk pasar ekspor." },
  { ticker: "IIKP", name: "Inti Agri Resources Tbk", sector: "Konsumer", description: "Perusahaan yang bergerak di bidang sumber daya pertanian dan perikanan." },
  { ticker: "CINT", name: "Chitose Internasional Tbk", sector: "Konsumer", description: "Produsen furnitur dan peralatan rumah tangga merek Chitose." },
  { ticker: "PCAR", name: "Prima Cakrawala Abadi Tbk", sector: "Konsumer", description: "Perusahaan distribusi dan pemasaran produk konsumer." },
  { ticker: "MGNA", name: "Magna Investama Mandiri Tbk", sector: "Konsumer", description: "Perusahaan investasi dengan portofolio di sektor konsumer." },
  { ticker: "BOBA", name: "Formosa Ingredient Factory Tbk", sector: "Konsumer", description: "Produsen bahan baku minuman boba dan produk tapioka." },
  { ticker: "TBLA", name: "Tunas Baru Lampung Tbk", sector: "Konsumer", description: "Produsen minyak goreng dan produk berbasis kelapa sawit." },
  { ticker: "AISA", name: "FKS Multi Agro Tbk", sector: "Konsumer", description: "Perusahaan agribisnis dengan fokus distribusi pangan dan komoditas." },

  // === ROKOK & TEMBAKAU ===
  { ticker: "GGRM", name: "Gudang Garam Tbk", sector: "Rokok & Tembakau", description: "Produsen rokok kretek terbesar di Indonesia." },
  { ticker: "HMSP", name: "HM Sampoerna Tbk", sector: "Rokok & Tembakau", description: "Produsen rokok terkemuka, bagian dari grup Philip Morris International." },
  { ticker: "RMBA", name: "Bentoel Internasional Investama Tbk", sector: "Rokok & Tembakau", description: "Produsen rokok Bentoel, Dunhill, dan Lucky Strike, anak usaha BAT." },
  { ticker: "WIIM", name: "Wismilak Inti Makmur Tbk", sector: "Rokok & Tembakau", description: "Produsen rokok Wismilak Diplomat dan berbagai merek kretek." },

  // === FARMASI & KESEHATAN ===
  { ticker: "KLBF", name: "Kalbe Farma Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi terbesar di Indonesia dengan produk OTC dan resep dokter." },
  { ticker: "SIDO", name: "Industri Jamu dan Farmasi Sido Muncul Tbk", sector: "Farmasi & Kesehatan", description: "Produsen jamu dan produk kesehatan herbal terbesar di Indonesia." },
  { ticker: "MIKA", name: "Mitra Keluarga Karyasehat Tbk", sector: "Farmasi & Kesehatan", description: "Operator jaringan rumah sakit dengan fokus layanan kelas menengah." },
  { ticker: "SILO", name: "Siloam International Hospitals Tbk", sector: "Farmasi & Kesehatan", description: "Operator jaringan rumah sakit swasta terbesar di Indonesia." },
  { ticker: "TSPC", name: "Tempo Scan Pacific Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi dengan merek populer Bodrex, Hemaviton, dan Neo Rheumacyl." },
  { ticker: "DVLA", name: "Darya-Varia Laboratoria Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi dengan merek Combiphar, Natur-E, dan produk OTC lainnya." },
  { ticker: "MERK", name: "Merck Tbk", sector: "Farmasi & Kesehatan", description: "Anak usaha Merck KGaA Jerman dengan produk farmasi dan bahan kimia." },
  { ticker: "KAEF", name: "Kimia Farma Tbk", sector: "Farmasi & Kesehatan", description: "BUMN farmasi dengan jaringan apotek dan produksi obat generik." },
  { ticker: "INAF", name: "Indofarma Tbk", sector: "Farmasi & Kesehatan", description: "BUMN farmasi dengan fokus produksi obat generik dan alat kesehatan." },
  { ticker: "PYFA", name: "Pyridam Farma Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi dengan produk antibiotik dan suplemen kesehatan." },
  { ticker: "SCPI", name: "Organon Pharma Indonesia Tbk", sector: "Farmasi & Kesehatan", description: "Anak usaha Organon global dengan produk kesehatan perempuan dan biosimilar." },
  { ticker: "HEAL", name: "Medikaloka Hermina Tbk", sector: "Farmasi & Kesehatan", description: "Operator rumah sakit Hermina dengan jaringan terbesar di kelas menengah." },
  { ticker: "PRDL", name: "Prodia Widyahusada Tbk", sector: "Farmasi & Kesehatan", description: "Operator laboratorium klinik Prodia dengan jaringan nasional." },
  { ticker: "DGNS", name: "Diagnos Laboratorium Utama Tbk", sector: "Farmasi & Kesehatan", description: "Operator laboratorium klinik dengan fokus diagnostik dan patologi." },
  { ticker: "BIOS", name: "Bio Farma (Persero) Tbk", sector: "Farmasi & Kesehatan", description: "BUMN produsen vaksin terbesar di Asia Tenggara." },
  { ticker: "IRRA", name: "Itama Ranoraya Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan distribusi alat kesehatan dan produk medis." },
  { ticker: "OMED", name: "Jayamas Medica Industri Tbk", sector: "Farmasi & Kesehatan", description: "Produsen alat kesehatan sekali pakai dan produk medis." },
  { ticker: "PRDA", name: "Prodia Widyahusada Tbk", sector: "Farmasi & Kesehatan", description: "Laboratorium klinik dengan layanan diagnostik komprehensif." },
  { ticker: "SAME", name: "Sarana Meditama Metropolitan Tbk", sector: "Farmasi & Kesehatan", description: "Operator jaringan klinik dan rumah sakit ibu dan anak." },
  { ticker: "PEHA", name: "Phapros Tbk", sector: "Farmasi & Kesehatan", description: "Perusahaan farmasi BUMN dengan fokus obat malaria dan antibiotik." },
  { ticker: "MOLI", name: "Madusari Murni Indah Tbk", sector: "Farmasi & Kesehatan", description: "Produsen alkohol dan bahan baku industri farmasi dan kosmetik." },

  // === RITEL ===
  { ticker: "AMRT", name: "Sumber Alfaria Trijaya Tbk", sector: "Ritel", description: "Operator minimarket Alfamart dengan jaringan toko terbesar di Indonesia." },
  { ticker: "MAPI", name: "Mitra Adiperkasa Tbk", sector: "Ritel", description: "Peritel gaya hidup dengan portofolio brand fashion dan F&B internasional." },
  { ticker: "ACES", name: "Ace Hardware Indonesia Tbk", sector: "Ritel", description: "Peritel perkakas dan perlengkapan rumah tangga terbesar di Indonesia." },
  { ticker: "HERO", name: "Hero Supermarket Tbk", sector: "Ritel", description: "Operator supermarket Hero, Giant, dan IKEA di Indonesia." },
  { ticker: "LPPF", name: "Matahari Department Store Tbk", sector: "Ritel", description: "Operator department store Matahari dengan ratusan gerai di seluruh Indonesia." },
  { ticker: "RANC", name: "Supra Boga Lestari Tbk", sector: "Ritel", description: "Operator supermarket Ranch Market dan Farmers Market." },
  { ticker: "MIDI", name: "Midi Utama Indonesia Tbk", sector: "Ritel", description: "Operator Alfamidi dan Lawson, anak usaha dari Alfamart Group." },
  { ticker: "CSAP", name: "Catur Sentosa Adiprana Tbk", sector: "Ritel", description: "Distributor bahan bangunan dan operator Mitra10 home improvement store." },
  { ticker: "MPPA", name: "Matahari Putra Prima Tbk", sector: "Ritel", description: "Operator hypermarket Hypermart dan FoodMart dengan jaringan nasional." },
  { ticker: "SONA", name: "Sona Topas Tourism Industry Tbk", sector: "Ritel", description: "Perusahaan ritel duty free dan pariwisata di bandara internasional." },
  { ticker: "ERAA", name: "Erajaya Swasembada Tbk", sector: "Ritel", description: "Distributor dan peritel perangkat komunikasi terbesar di Indonesia." },
  { ticker: "RALS", name: "Ramayana Lestari Sentosa Tbk", sector: "Ritel", description: "Operator department store Ramayana dengan jaringan di seluruh Indonesia." },
  { ticker: "ECII", name: "Electronic City Indonesia Tbk", sector: "Ritel", description: "Peritel elektronik premium dengan gerai di kota-kota besar Indonesia." },
  { ticker: "AVIA", name: "Avia Avian Tbk", sector: "Ritel", description: "Produsen cat Avian dengan distribusi di seluruh Indonesia." },
  { ticker: "TKKA", name: "Toko Kecantikan Indonesia Tbk", sector: "Ritel", description: "Peritel produk kecantikan dengan jaringan toko di kota besar." },
  { ticker: "KIOS", name: "Kioson Komersial Indonesia Tbk", sector: "Ritel", description: "Platform digital untuk agen dan toko kelontong di seluruh Indonesia." },
  { ticker: "NFCX", name: "NFC Indonesia Tbk", sector: "Ritel", description: "Perusahaan teknologi retail dan fintech untuk UMKM." },

  // === TEKNOLOGI & DIGITAL ===
  { ticker: "GOTO", name: "GoTo Gojek Tokopedia Tbk", sector: "Teknologi", description: "Ekosistem digital terbesar Indonesia mencakup Gojek, Tokopedia, dan GoFinancial." },
  { ticker: "BUKA", name: "Bukalapak.com Tbk", sector: "Teknologi", description: "Platform e-commerce dengan fokus pada warung dan mitra UMKM di seluruh Indonesia." },
  { ticker: "DCII", name: "DCI Indonesia Tbk", sector: "Teknologi", description: "Operator pusat data (data center) terbesar di Indonesia." },
  { ticker: "WIFI", name: "Solusi Sinergi Digital Tbk", sector: "Teknologi", description: "Penyedia layanan WiFi dan internet untuk area publik dan komersial." },
  { ticker: "MTDL", name: "Metrodata Electronics Tbk", sector: "Teknologi", description: "Distributor teknologi informasi dengan portofolio hardware dan solusi IT." },
  { ticker: "MLPT", name: "Multipolar Technology Tbk", sector: "Teknologi", description: "Penyedia solusi teknologi informasi dan layanan IT untuk korporasi." },
  { ticker: "INET", name: "Indonesian Telecommunications Tbk", sector: "Teknologi", description: "Penyedia layanan internet dan solusi komunikasi untuk bisnis." },
  { ticker: "DOSS", name: "Dosni Roha Tbk", sector: "Teknologi", description: "Perusahaan teknologi informasi dengan fokus sistem integrasi." },
  { ticker: "MCAS", name: "M Cash Integrasi Tbk", sector: "Teknologi", description: "Perusahaan fintech dan distribusi voucher digital." },
  { ticker: "LOKA", name: "Eka Sari Lorena Transport Tbk", sector: "Teknologi", description: "Perusahaan platform logistik dan transport digital." },
  { ticker: "DMMX", name: "Digital Mediatama Maxima Tbk", sector: "Teknologi", description: "Perusahaan digital media dan iklan luar ruang berbasis teknologi." },
  { ticker: "PBID", name: "Panca Budi Idaman Tbk", sector: "Teknologi", description: "Produsen produk plastik dan kemasan berbasis teknologi." },
  { ticker: "EMTK", name: "Elang Mahkota Teknologi Tbk", sector: "Teknologi", description: "Konglomerat media dan teknologi dengan Vidio, SCTV, dan Indosiar." },
  { ticker: "YELO", name: "Yelooo Integra Datanet Tbk", sector: "Teknologi", description: "Penyedia layanan internet dan jaringan untuk korporasi." },
  { ticker: "ATIC", name: "Anabatic Technologies Tbk", sector: "Teknologi", description: "Perusahaan solusi teknologi finansial untuk perbankan dan keuangan." },

  // === TELEKOMUNIKASI ===
  { ticker: "TLKM", name: "Telkom Indonesia Tbk", sector: "Telekomunikasi", description: "Perusahaan telekomunikasi BUMN terbesar di Indonesia." },
  { ticker: "EXCL", name: "XL Axiata Tbk", sector: "Telekomunikasi", description: "Operator telekomunikasi terbesar ketiga di Indonesia." },
  { ticker: "ISAT", name: "Indosat Tbk", sector: "Telekomunikasi", description: "Operator telekomunikasi Indosat Ooredoo Hutchison setelah merger." },
  { ticker: "FREN", name: "Smartfren Telecom Tbk", sector: "Telekomunikasi", description: "Operator 4G berbasis CDMA yang fokus pada segmen data dan internet." },
  { ticker: "SMDR", name: "Samudera Indonesia Tbk", sector: "Telekomunikasi", description: "Perusahaan logistik dan pengiriman dengan armada kapal dan jaringan luas." },
  { ticker: "CENT", name: "Centratama Telekomunikasi Indonesia Tbk", sector: "Telekomunikasi", description: "Penyedia infrastruktur tower telekomunikasi dengan portofolio menara." },
  { ticker: "KOPI", name: "Kopi Kemiri Tbk", sector: "Telekomunikasi", description: "Perusahaan konten digital dan telekomunikasi." },

  // === INFRASTRUKTUR TELEKOMUNIKASI (MENARA) ===
  { ticker: "TOWR", name: "Sarana Menara Nusantara Tbk", sector: "Infrastruktur Telekomunikasi", description: "Penyedia menara telekomunikasi independen terbesar di Indonesia." },
  { ticker: "TBIG", name: "Tower Bersama Infrastructure Tbk", sector: "Infrastruktur Telekomunikasi", description: "Penyedia infrastruktur menara telekomunikasi dengan ribuan menara." },
  { ticker: "MTEL", name: "Dayamitra Telekomunikasi Tbk", sector: "Infrastruktur Telekomunikasi", description: "Mitratel, penyedia menara telekomunikasi terbesar di Indonesia, anak usaha Telkom." },
  { ticker: "SUPR", name: "Solusi Tunas Pratama Tbk", sector: "Infrastruktur Telekomunikasi", description: "Penyedia menara telekomunikasi dengan jaringan di seluruh Indonesia." },

  // === PERTAMBANGAN BATU BARA ===
  { ticker: "ADRO", name: "Adaro Energy Indonesia Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara terbesar kedua di Indonesia dengan tambang di Kalimantan." },
  { ticker: "ITMG", name: "Indo Tambangraya Megah Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan pertambangan batu bara dengan operasi di Kalimantan." },
  { ticker: "PTBA", name: "Bukit Asam Tbk", sector: "Pertambangan Batu Bara", description: "BUMN tambang batu bara dengan operasi utama di Sumatera Selatan." },
  { ticker: "HRUM", name: "Harum Energy Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan tambang batu bara yang juga berekspansi ke nikel." },
  { ticker: "BYAN", name: "Bayan Resources Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara termal dan metalurgi dengan tambang di Kalimantan." },
  { ticker: "DSSA", name: "Dian Swastatika Sentosa Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan energi dengan batu bara, pembangkit listrik, dan logistik." },
  { ticker: "GEMS", name: "Golden Energy Mines Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara termal dengan tambang di Kalimantan Tengah." },
  { ticker: "TOBA", name: "TBS Energi Utama Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan energi dengan batu bara dan pengembangan energi terbarukan." },
  { ticker: "ARII", name: "Atlas Resources Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan pertambangan batu bara dengan operasi di Kalimantan." },
  { ticker: "INDY", name: "Indika Energy Tbk", sector: "Pertambangan Batu Bara", description: "Konglomerat energi dengan batu bara, jasa pertambangan, dan EBT." },
  { ticker: "PTRO", name: "Petrosea Tbk", sector: "Pertambangan Batu Bara", description: "Kontraktor pertambangan dan minyak & gas dengan layanan terintegrasi." },
  { ticker: "DOID", name: "Delta Dunia Makmur Tbk", sector: "Pertambangan Batu Bara", description: "Kontraktor pertambangan batu bara dengan operasi di Indonesia dan Australia." },
  { ticker: "MBAP", name: "Mitrabara Adiperdana Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara kalori tinggi dengan tambang di Kalimantan Utara." },
  { ticker: "MYOH", name: "Samindo Resources Tbk", sector: "Pertambangan Batu Bara", description: "Kontraktor penambangan batu bara dengan kontrak jangka panjang." },
  { ticker: "BSSR", name: "Baramulti Suksessarana Tbk", sector: "Pertambangan Batu Bara", description: "Produsen batu bara termal dengan tambang di Kalimantan Timur." },
  { ticker: "KKGI", name: "Resource Alam Indonesia Tbk", sector: "Pertambangan Batu Bara", description: "Perusahaan pertambangan batu bara dengan operasi di Kalimantan Tengah." },
  { ticker: "BOSS", name: "Borneo Olah Sarana Sukses Tbk", sector: "Pertambangan Batu Bara", description: "Kontraktor pertambangan dan pengelola terminal batu bara." },
  { ticker: "PKPK", name: "Perdana Karya Perkasa Tbk", sector: "Pertambangan Batu Bara", description: "Kontraktor pertambangan batu bara dan jasa logistik pertambangan." },

  // === PERTAMBANGAN MINERAL (NIKEL, EMAS, TEMBAGA) ===
  { ticker: "ANTM", name: "Aneka Tambang Tbk", sector: "Pertambangan Mineral", description: "BUMN pertambangan dengan komoditas emas, nikel, dan bauksit." },
  { ticker: "MDKA", name: "Merdeka Copper Gold Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan tembaga dan emas yang sedang berkembang pesat." },
  { ticker: "INCO", name: "Vale Indonesia Tbk", sector: "Pertambangan Mineral", description: "Produsen nikel matte terbesar di Indonesia, anak usaha Vale Brasil." },
  { ticker: "TINS", name: "Timah Tbk", sector: "Pertambangan Mineral", description: "BUMN produsen dan eksportir timah terbesar di dunia." },
  { ticker: "NICL", name: "Nusantara Nickel Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan nikel laterit dengan smelter di Indonesia." },
  { ticker: "NCKL", name: "Trimegah Bangun Persada Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan nikel dengan fasilitas smelter RKEF." },
  { ticker: "MBMA", name: "MBM Resources Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pengolahan nikel dengan produk nickel pig iron." },
  { ticker: "ADMR", name: "Adaro Minerals Indonesia Tbk", sector: "Pertambangan Mineral", description: "Anak usaha Adaro Group yang fokus pada pertambangan batu bara metalurgi." },
  { ticker: "PSAB", name: "J Resources Asia Pasifik Tbk", sector: "Pertambangan Mineral", description: "Produsen emas dengan operasi di Indonesia dan beberapa negara Asia." },
  { ticker: "CITA", name: "Cita Mineral Investindo Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan bauksit dan nikel di Kalimantan." },
  { ticker: "BRMS", name: "Bumi Resources Minerals Tbk", sector: "Pertambangan Mineral", description: "Anak usaha Bumi Resources yang fokus pada pertambangan emas dan tembaga." },
  { ticker: "SMRU", name: "SMR Utama Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan nikel dengan konsesi di Sulawesi." },
  { ticker: "ZINC", name: "Kapuas Prima Coal Tbk", sector: "Pertambangan Mineral", description: "Perusahaan pertambangan dengan fokus mineral logam dasar." },
  { ticker: "AMMN", name: "Amman Mineral Internasional Tbk", sector: "Pertambangan Mineral", description: "Operator tambang tembaga dan emas terbesar kedua di Indonesia." },
  { ticker: "PGEO", name: "Pertamina Geothermal Energy Tbk", sector: "Pertambangan Mineral", description: "Produsen energi panas bumi terbesar di Indonesia, anak usaha Pertamina." },

  // === ENERGI & MINYAK GAS ===
  { ticker: "PGAS", name: "Perusahaan Gas Negara Tbk", sector: "Energi & Migas", description: "BUMN distribusi dan transmisi gas bumi terbesar di Indonesia." },
  { ticker: "MEDC", name: "Medco Energi Internasional Tbk", sector: "Energi & Migas", description: "Perusahaan energi terintegrasi dengan aset minyak, gas, dan listrik." },
  { ticker: "AKRA", name: "AKR Corporindo Tbk", sector: "Energi & Migas", description: "Distributor bahan kimia dan BBM dengan infrastruktur logistik luas." },
  { ticker: "ELSA", name: "Elnusa Tbk", sector: "Energi & Migas", description: "Perusahaan jasa pertambangan minyak dan gas, anak usaha Pertamina." },
  { ticker: "ENRG", name: "Energi Mega Persada Tbk", sector: "Energi & Migas", description: "Perusahaan eksplorasi dan produksi minyak dan gas di Indonesia." },
  { ticker: "RUIS", name: "Radiant Utama Interinsco Tbk", sector: "Energi & Migas", description: "Perusahaan jasa minyak dan gas dengan layanan teknik dan operasi." },
  { ticker: "BIPI", name: "Astrindo Nusantara Infrastruktur Tbk", sector: "Energi & Migas", description: "Perusahaan infrastruktur energi dengan aset pipa dan terminal." },
  { ticker: "ESSA", name: "Essa Industries Indonesia Tbk", sector: "Energi & Migas", description: "Perusahaan produksi amonia dari gas alam untuk pupuk dan industri." },
  { ticker: "WINS", name: "Wintermar Offshore Marine Tbk", sector: "Energi & Migas", description: "Perusahaan jasa maritim untuk industri minyak dan gas lepas pantai." },
  { ticker: "COGS", name: "Cogindo Daya Bersama Tbk", sector: "Energi & Migas", description: "Penyedia layanan O&M pembangkit listrik dan jaringan energi." },
  { ticker: "RAJA", name: "Rukun Raharja Tbk", sector: "Energi & Migas", description: "Perusahaan distribusi gas dan infrastruktur migas terpadu." },
  { ticker: "KEEN", name: "Kencana Energi Lestari Tbk", sector: "Energi & Migas", description: "Perusahaan energi terbarukan dengan proyek hidro di Indonesia." },
  { ticker: "BREN", name: "Barito Renewables Energy Tbk", sector: "Energi & Migas", description: "Perusahaan energi terbarukan terbesar di Indonesia dari grup Barito Pacific." },
  { ticker: "SUGI", name: "Sugih Energy Tbk", sector: "Energi & Migas", description: "Perusahaan eksplorasi dan produksi minyak dan gas alam." },

  // === PETROKIMIA & KIMIA ===
  { ticker: "BRPT", name: "Barito Pacific Tbk", sector: "Petrokimia", description: "Perusahaan petrokimia dengan kapasitas produksi besar untuk ekspor." },
  { ticker: "TPIA", name: "Chandra Asri Pacific Tbk", sector: "Petrokimia", description: "Produsen petrokimia terbesar di Indonesia, bagian dari Barito Pacific." },
  { ticker: "SRSN", name: "Indo Acidatama Tbk", sector: "Petrokimia", description: "Produsen etanol, asam asetat, dan produk turunan dari fermentasi." },
  { ticker: "LTLS", name: "Lautan Luas Tbk", sector: "Petrokimia", description: "Distributor bahan kimia industri dan laboratorium terbesar di Indonesia." },
  { ticker: "CTBN", name: "Citra Tubindo Tbk", sector: "Petrokimia", description: "Produsen pipa baja khusus untuk industri minyak dan gas." },
  { ticker: "UNIC", name: "Unggul Indah Cahaya Tbk", sector: "Petrokimia", description: "Produsen alkylbenzene linear untuk industri deterjen." },
  { ticker: "INCI", name: "Intanwijaya Internasional Tbk", sector: "Petrokimia", description: "Produsen formaldehida dan bahan baku industri kimia." },
  { ticker: "DPNS", name: "Duta Pertiwi Nusantara Tbk", sector: "Petrokimia", description: "Distributor bahan kimia dan bahan bangunan industrial." },
  { ticker: "ETWA", name: "Eterindo Wahanatama Tbk", sector: "Petrokimia", description: "Produsen biodiesel dan bahan kimia turunan kelapa sawit." },
  { ticker: "EKAD", name: "Ekadharma International Tbk", sector: "Petrokimia", description: "Produsen pita perekat dan produk kemasan plastik." },

  // === SEMEN & BAHAN BANGUNAN ===
  { ticker: "SMGR", name: "Semen Indonesia Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen semen BUMN terbesar di Indonesia." },
  { ticker: "INTP", name: "Indocement Tunggal Prakarsa Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen semen swasta terbesar dengan merek Semen Tiga Roda." },
  { ticker: "SMBR", name: "Semen Baturaja Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen semen BUMN di wilayah Sumatera Selatan." },
  { ticker: "BUDA", name: "Wahana Interfood Nusantara Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen bahan bangunan dan produk konstruksi." },
  { ticker: "WTON", name: "Wijaya Karya Beton Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen beton pracetak terbesar di Indonesia, anak usaha WIKA." },
  { ticker: "MDLN", name: "Modernland Realty Tbk", sector: "Semen & Bahan Bangunan", description: "Pengembang properti dengan produk perumahan dan kawasan komersial." },
  { ticker: "LION", name: "Lion Metal Works Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen produk baja struktural dan furnitur metal." },
  { ticker: "ALMI", name: "Alumindo Light Metal Industry Tbk", sector: "Semen & Bahan Bangunan", description: "Produsen lembaran aluminium untuk industri dan konstruksi." },

  // === INDUSTRI DASAR - BAJA & LOGAM ===
  { ticker: "KRAS", name: "Krakatau Steel Tbk", sector: "Industri Dasar", description: "BUMN produsen baja terbesar di Indonesia dengan pabrik di Cilegon." },
  { ticker: "GDST", name: "Gunawan Dianjaya Steel Tbk", sector: "Industri Dasar", description: "Produsen plat baja untuk industri perkapalan dan konstruksi." },
  { ticker: "PICO", name: "Pelangi Indah Canindo Tbk", sector: "Industri Dasar", description: "Produsen kemasan kaleng baja dan aluminium untuk industri FMCG." },
  { ticker: "ISSP", name: "Steel Pipe Industry of Indonesia Tbk", sector: "Industri Dasar", description: "Produsen pipa baja dengan berbagai ukuran untuk konstruksi dan industri." },
  { ticker: "LMSH", name: "Lionmesh Prima Tbk", sector: "Industri Dasar", description: "Produsen kawat baja dan jaring kawat untuk konstruksi." },
  { ticker: "NIKL", name: "Elnusa Petrofin Tbk", sector: "Industri Dasar", description: "Produsen billet dan produk baja tuang untuk industri." },
  { ticker: "BTON", name: "Betonjaya Manunggal Tbk", sector: "Industri Dasar", description: "Produsen besi beton untuk konstruksi dengan kapasitas besar." },

  // === INDUSTRI DASAR - KERTAS & PULP ===
  { ticker: "INKP", name: "Indah Kiat Pulp & Paper Tbk", sector: "Industri Dasar", description: "Produsen pulp dan kertas terbesar di Asia Tenggara." },
  { ticker: "TKIM", name: "Pabrik Kertas Tjiwi Kimia Tbk", sector: "Industri Dasar", description: "Produsen kertas tulis dan cetak terbesar di Indonesia." },
  { ticker: "FASW", name: "Fajar Surya Wisesa Tbk", sector: "Industri Dasar", description: "Produsen kertas karton dan kemasan industri." },
  { ticker: "ALDO", name: "Alkindo Naratama Tbk", sector: "Industri Dasar", description: "Produsen kertas kraft dan kemasan berbasis daur ulang." },
  { ticker: "SPMA", name: "Suparma Tbk", sector: "Industri Dasar", description: "Produsen kertas tisu dan tissue roll untuk segmen retail." },
  { ticker: "KBRI", name: "Kertas Basuki Rachmat Indonesia Tbk", sector: "Industri Dasar", description: "Produsen kertas industri dengan pabrik di Jawa Timur." },

  // === INDUSTRI DASAR - PLASTIK & KEMASAN ===
  { ticker: "IGAR", name: "Champion Pacific Indonesia Tbk", sector: "Industri Dasar", description: "Produsen kemasan plastik fleksibel untuk industri makanan dan farmasi." },
  { ticker: "TRST", name: "Trias Sentosa Tbk", sector: "Industri Dasar", description: "Produsen film plastik BOPP dan kemasan fleksibel." },
  { ticker: "YPAS", name: "Yanaprima Hastapersada Tbk", sector: "Industri Dasar", description: "Produsen karung plastik dan kemasan woven polipropilena." },
  { ticker: "FPNI", name: "Lotte Chemical Titan Nusantara Tbk", sector: "Industri Dasar", description: "Produsen polietilena untuk industri kemasan dan plastik." },
  { ticker: "APLI", name: "Asiaplast Industries Tbk", sector: "Industri Dasar", description: "Produsen produk plastik PVC dan kemasan industrial." },
  { ticker: "DYNA", name: "Dynaplast Tbk", sector: "Industri Dasar", description: "Produsen kemasan plastik rigid untuk industri FMCG dan farmasi." },
  { ticker: "BRNA", name: "Berlina Tbk", sector: "Industri Dasar", description: "Produsen kemasan plastik botol dan container untuk industri." },
  { ticker: "IMPC", name: "Impack Pratama Industri Tbk", sector: "Industri Dasar", description: "Produsen lembaran plastik PC dan produk bahan bangunan plastik." },
  { ticker: "IPOL", name: "Indopoly Swakarsa Industry Tbk", sector: "Industri Dasar", description: "Produsen film plastik BOPET dan BOPP untuk kemasan." },

  // === INDUSTRI DASAR - TEKSTIL & GARMEN ===
  { ticker: "SRIL", name: "Sri Rejeki Isman Tbk", sector: "Industri Dasar", description: "Produsen tekstil terintegrasi terbesar di Indonesia." },
  { ticker: "TFCO", name: "Tifico Fiber Indonesia Tbk", sector: "Industri Dasar", description: "Produsen serat poliester dan benang tekstil." },
  { ticker: "RICY", name: "Ricky Putra Globalindo Tbk", sector: "Industri Dasar", description: "Produsen pakaian dalam dan kaus kaki merek GT Man." },
  { ticker: "TRIS", name: "Trisula International Tbk", sector: "Industri Dasar", description: "Produsen pakaian formal dan seragam dengan merek Trisula." },
  { ticker: "PBRX", name: "Pan Brothers Tbk", sector: "Industri Dasar", description: "Produsen pakaian ekspor dengan klien merek internasional ternama." },
  { ticker: "SSTM", name: "Sunson Textile Manufacturer Tbk", sector: "Industri Dasar", description: "Produsen kain tenun dan tekstil untuk pasar domestik dan ekspor." },
  { ticker: "HDTX", name: "Panasia Indo Resources Tbk", sector: "Industri Dasar", description: "Produsen benang dan kain tekstil sintetis." },
  { ticker: "MYTX", name: "Asia Pacific Investama Tbk", sector: "Industri Dasar", description: "Perusahaan tekstil dengan operasi spinning dan weaving." },

  // === INDUSTRI DASAR - KARET & KABEL ===
  { ticker: "GJTL", name: "Gajah Tunggal Tbk", sector: "Industri Dasar", description: "Produsen ban terbesar di Indonesia dengan merek GT Radial." },
  { ticker: "MASA", name: "Multistrada Arah Sarana Tbk", sector: "Industri Dasar", description: "Produsen ban Achilles dan Corsa untuk pasar domestik dan ekspor." },
  { ticker: "BRAM", name: "Indo Kordsa Tbk", sector: "Industri Dasar", description: "Produsen tali ban (tire cord) untuk industri ban global." },
  { ticker: "KBLI", name: "KMI Wire and Cable Tbk", sector: "Industri Dasar", description: "Produsen kabel listrik dan telekomunikasi dengan merek KMI." },
  { ticker: "KBLM", name: "Kabelindo Murni Tbk", sector: "Industri Dasar", description: "Produsen kabel listrik untuk instalasi bangunan dan industri." },
  { ticker: "ADMG", name: "Polychem Indonesia Tbk", sector: "Industri Dasar", description: "Produsen benang dan kain poliester untuk industri tekstil." },

  // === OTOMOTIF & KOMPONEN ===
  { ticker: "ASII", name: "Astra International Tbk", sector: "Otomotif & Manufaktur", description: "Konglomerat terbesar dengan bisnis otomotif, keuangan, pertambangan, agribisnis." },
  { ticker: "AUTO", name: "Astra Otoparts Tbk", sector: "Otomotif & Manufaktur", description: "Produsen komponen otomotif terbesar di Indonesia, bagian dari grup Astra." },
  { ticker: "IMAS", name: "Indomobil Sukses Internasional Tbk", sector: "Otomotif & Manufaktur", description: "Distributor dan perakit kendaraan dengan banyak merek otomotif." },
  { ticker: "SMSM", name: "Selamat Sempurna Tbk", sector: "Otomotif & Manufaktur", description: "Produsen filter otomotif Sakura dan produk spare part kendaraan." },
  { ticker: "INDS", name: "Indospring Tbk", sector: "Otomotif & Manufaktur", description: "Produsen pegas (spring) untuk kendaraan komersial dan penumpang." },
  { ticker: "NIPS", name: "Nipress Tbk", sector: "Otomotif & Manufaktur", description: "Produsen baterai kendaraan dengan merek NS40 dan produk aki lainnya." },
  { ticker: "MPMX", name: "Mitra Pinasthika Mustika Tbk", sector: "Otomotif & Manufaktur", description: "Distributor sepeda motor Honda dan produsen komponen otomotif." },
  { ticker: "LPIN", name: "Multi Prima Sejahtera Tbk", sector: "Otomotif & Manufaktur", description: "Produsen komponen otomotif dan mesin industri." },
  { ticker: "BOLT", name: "Garuda Metalindo Tbk", sector: "Otomotif & Manufaktur", description: "Produsen baut dan fastener untuk industri otomotif." },
  { ticker: "PRAS", name: "Prima Alloy Steel Universal Tbk", sector: "Otomotif & Manufaktur", description: "Produsen velg aluminium untuk kendaraan roda empat." },
  { ticker: "UNTR", name: "United Tractors Tbk", sector: "Otomotif & Manufaktur", description: "Distributor alat berat Komatsu dan operator tambang batu bara." },
  { ticker: "HEXA", name: "Hexindo Adiperkasa Tbk", sector: "Otomotif & Manufaktur", description: "Distributor alat berat Hitachi untuk sektor pertambangan dan konstruksi." },

  // === KONSTRUKSI & INFRASTRUKTUR ===
  { ticker: "WIKA", name: "Wijaya Karya Tbk", sector: "Konstruksi & Infrastruktur", description: "BUMN konstruksi dengan proyek infrastruktur nasional skala besar." },
  { ticker: "PTPP", name: "PP (Persero) Tbk", sector: "Konstruksi & Infrastruktur", description: "BUMN konstruksi dengan fokus proyek gedung, jalan, dan energi." },
  { ticker: "ADHI", name: "Adhi Karya (Persero) Tbk", sector: "Konstruksi & Infrastruktur", description: "BUMN konstruksi dengan spesialisasi proyek gedung tinggi dan infrastruktur." },
  { ticker: "WSKT", name: "Waskita Karya (Persero) Tbk", sector: "Konstruksi & Infrastruktur", description: "BUMN konstruksi dengan proyek tol, jembatan, dan infrastruktur besar." },
  { ticker: "JSMR", name: "Jasa Marga Tbk", sector: "Konstruksi & Infrastruktur", description: "BUMN operator jalan tol terbesar di Indonesia." },
  { ticker: "ACST", name: "Acset Indonusa Tbk", sector: "Konstruksi & Infrastruktur", description: "Perusahaan konstruksi dengan spesialisasi pondasi dan struktur bawah tanah." },
  { ticker: "NRCA", name: "Nusa Raya Cipta Tbk", sector: "Konstruksi & Infrastruktur", description: "Perusahaan konstruksi gedung komersial dan industrial." },
  { ticker: "SSIA", name: "Surya Semesta Internusa Tbk", sector: "Konstruksi & Infrastruktur", description: "Perusahaan konstruksi dan kawasan industri dengan proyek di Karawang." },
  { ticker: "TOTL", name: "Total Bangun Persada Tbk", sector: "Konstruksi & Infrastruktur", description: "Perusahaan konstruksi gedung bertingkat tinggi terkemuka." },
  { ticker: "JKON", name: "Jaya Konstruksi Manggala Pratama Tbk", sector: "Konstruksi & Infrastruktur", description: "Perusahaan konstruksi infrastruktur jalan dan jembatan." },
  { ticker: "CASS", name: "Cardig Aero Services Tbk", sector: "Konstruksi & Infrastruktur", description: "Penyedia layanan ground handling dan infrastruktur bandara." },
  { ticker: "BEST", name: "Bekasi Fajar Industrial Estate Tbk", sector: "Konstruksi & Infrastruktur", description: "Pengembang dan pengelola kawasan industri di Bekasi." },
  { ticker: "DMAS", name: "Puradelta Lestari Tbk", sector: "Konstruksi & Infrastruktur", description: "Pengembang kawasan industri Greenland International Industrial Center." },
  { ticker: "GPRA", name: "Perdana Gapuraprima Tbk", sector: "Konstruksi & Infrastruktur", description: "Pengembang perumahan dan properti komersial skala menengah." },
  { ticker: "META", name: "Nusantara Infrastructure Tbk", sector: "Konstruksi & Infrastruktur", description: "Operator jalan tol dan infrastruktur transportasi regional." },

  // === PROPERTI & REAL ESTATE ===
  { ticker: "BSDE", name: "Bumi Serpong Damai Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan terpadu BSD City dan proyek properti skala besar." },
  { ticker: "PWON", name: "Pakuwon Jati Tbk", sector: "Properti & Real Estate", description: "Pengembang superblok dan mal premium di Surabaya dan Jakarta." },
  { ticker: "SMRA", name: "Summarecon Agung Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan terpadu dengan proyek residensial dan komersial." },
  { ticker: "CTRA", name: "Ciputra Development Tbk", sector: "Properti & Real Estate", description: "Pengembang properti dengan portofolio proyek tersebar di banyak kota." },
  { ticker: "ASRI", name: "Alam Sutera Realty Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan hunian Alam Sutera di Tangerang dan sekitarnya." },
  { ticker: "DILD", name: "Intiland Development Tbk", sector: "Properti & Real Estate", description: "Pengembang properti premium dengan proyek di Jakarta dan Surabaya." },
  { ticker: "GMTD", name: "Gowa Makassar Tourism Development Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan terpadu Tanjung Bunga di Makassar." },
  { ticker: "KIJA", name: "Kawasan Industri Jababeka Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan industri Jababeka dengan fasilitas lengkap." },
  { ticker: "LPCK", name: "Lippo Cikarang Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan terpadu Lippo Cikarang dengan hunian dan industri." },
  { ticker: "LPKR", name: "Lippo Karawaci Tbk", sector: "Properti & Real Estate", description: "Pengembang properti terbesar dalam ekosistem Lippo Group." },
  { ticker: "MKPI", name: "Metropolitan Kentjana Tbk", sector: "Properti & Real Estate", description: "Pengelola Pondok Indah Mall dan kawasan hunian premium Jakarta Selatan." },
  { ticker: "MMLP", name: "Mega Manunggal Property Tbk", sector: "Properti & Real Estate", description: "Pengembang dan pengelola gudang logistik modern berbasis REIT." },
  { ticker: "MTLA", name: "Metropolitan Land Tbk", sector: "Properti & Real Estate", description: "Pengembang properti Metropolitan dengan proyek di Bekasi dan Jakarta." },
  { ticker: "PLIN", name: "Plaza Indonesia Realty Tbk", sector: "Properti & Real Estate", description: "Pengelola Plaza Indonesia dan The Grand Hyatt Jakarta." },
  { ticker: "PPRO", name: "PP Properti Tbk", sector: "Properti & Real Estate", description: "Anak usaha PP (Persero) yang fokus pada pengembangan properti residensial." },
  { ticker: "RODA", name: "Pikko Land Development Tbk", sector: "Properti & Real Estate", description: "Pengembang apartemen dan properti komersial di Jakarta." },
  { ticker: "SMDM", name: "Suryamas Dutamakmur Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan golf dan hunian premium." },
  { ticker: "BKSL", name: "Sentul City Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan terpadu Sentul City di Bogor." },
  { ticker: "ELTY", name: "Bakrieland Development Tbk", sector: "Properti & Real Estate", description: "Pengembang properti Bakrie Group dengan berbagai proyek di Indonesia." },
  { ticker: "GWSA", name: "Greenwood Sejahtera Tbk", sector: "Properti & Real Estate", description: "Pengembang perumahan dan properti komersial di wilayah Jabodetabek." },
  { ticker: "PJAA", name: "Pembangunan Jaya Ancol Tbk", sector: "Properti & Real Estate", description: "Pengelola kawasan wisata Ancol dan berbagai properti rekreasi." },
  { ticker: "APLN", name: "Agung Podomoro Land Tbk", sector: "Properti & Real Estate", description: "Pengembang properti besar dengan proyek mal dan superblok di Indonesia." },
  { ticker: "SCBD", name: "Danayasa Arthatama Tbk", sector: "Properti & Real Estate", description: "Pengelola kawasan SCBD (Sudirman Central Business District) Jakarta." },
  { ticker: "JRPT", name: "Jaya Real Property Tbk", sector: "Properti & Real Estate", description: "Pengembang properti dengan proyek di Serpong dan BSD area." },
  { ticker: "HOME", name: "Hotel Mandarine Regency Tbk", sector: "Properti & Real Estate", description: "Pengembang properti residensial dan komersial skala menengah." },
  { ticker: "NIRO", name: "Nirvana Development Tbk", sector: "Properti & Real Estate", description: "Pengembang properti dengan proyek residensial premium." },
  { ticker: "LAKE", name: "Danau Emas Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan hunian dan wisata dengan konsep danau." },
  { ticker: "FMII", name: "Fortune Mate Indonesia Tbk", sector: "Properti & Real Estate", description: "Pengembang properti industri dan kawasan komersial." },
  { ticker: "GAMA", name: "Gading Development Tbk", sector: "Properti & Real Estate", description: "Pengembang properti residensial di wilayah Jabodetabek." },
  { ticker: "COWL", name: "Cowell Development Tbk", sector: "Properti & Real Estate", description: "Pengembang perumahan dan apartemen untuk segmen menengah." },
  { ticker: "MDLN", name: "Modernland Realty Tbk", sector: "Properti & Real Estate", description: "Pengembang kawasan perumahan Modern Hill dan proyek urban." },
  { ticker: "KPIG", name: "MNC Land Tbk", sector: "Properti & Real Estate", description: "Pengembang properti MNC Group dengan proyek resort dan residensial." },
  { ticker: "GRPH", name: "Graphene Tbk", sector: "Properti & Real Estate", description: "Perusahaan properti dengan fokus pengembangan residensial." },
  { ticker: "ROCK", name: "Rockfields Properti Indonesia Tbk", sector: "Properti & Real Estate", description: "Pengembang properti residensial skala menengah." },
  { ticker: "TARA", name: "Sitara Propertindo Tbk", sector: "Properti & Real Estate", description: "Pengembang properti dengan proyek di kawasan strategis." },
  { ticker: "MABA", name: "Marga Abhinaya Abadi Tbk", sector: "Properti & Real Estate", description: "Pengembang dan pengelola properti komersial." },
  { ticker: "BIPP", name: "Bhuwanatala Indah Permai Tbk", sector: "Properti & Real Estate", description: "Pengembang properti residensial dan komersial." },
  { ticker: "RBMS", name: "Ristia Bintang Mahkotasejati Tbk", sector: "Properti & Real Estate", description: "Pengembang properti dengan fokus perumahan kelas menengah." },

  // === PERTANIAN & PERKEBUNAN ===
  { ticker: "AALI", name: "Astra Agro Lestari Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit terbesar di bawah grup Astra." },
  { ticker: "LSIP", name: "PP London Sumatra Indonesia Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan karet dengan lahan luas di Sumatera." },
  { ticker: "CPIN", name: "Charoen Pokphand Indonesia Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan agribisnis terintegrasi dengan fokus pakan ternak dan ayam." },
  { ticker: "JPFA", name: "Japfa Comfeed Indonesia Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan agribisnis terintegrasi pakan ternak, peternakan, dan pangan olahan." },
  { ticker: "TBLA", name: "Tunas Baru Lampung Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan produksi CPO di Lampung." },
  { ticker: "BISI", name: "BISI International Tbk", sector: "Agrikultur & Pangan", description: "Produsen benih jagung hibrida, padi, dan sayuran terkemuka di Indonesia." },
  { ticker: "SSMS", name: "Sawit Sumbermas Sarana Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit di Kalimantan Tengah." },
  { ticker: "SIMP", name: "Salim Ivomas Pratama Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan terintegrasi bagian dari Indofood Agri Resources." },
  { ticker: "SGRO", name: "Sampoerna Agro Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan karet di Sumatera Selatan." },
  { ticker: "TAPG", name: "Triputra Agro Persada Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit di Kalimantan dan Sumatera." },
  { ticker: "PALMA", name: "Provident Agro Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dengan lahan di Sumatera." },
  { ticker: "DSNG", name: "Dharma Satya Nusantara Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan pengolahan kayu." },
  { ticker: "GZCO", name: "Gozco Plantations Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit di Sumatera Selatan dan Kalimantan." },
  { ticker: "ANJT", name: "Austindo Nusantara Jaya Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan sagu dengan standar ESG." },
  { ticker: "UNSP", name: "Bakrie Sumatera Plantations Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dan karet Bakrie Group." },
  { ticker: "BWPT", name: "Eagle High Plantations Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit di Kalimantan." },
  { ticker: "SMAR", name: "Smart Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan dan pengolahan kelapa sawit terintegrasi." },
  { ticker: "MAGP", name: "Multi Agro Gemilang Plantation Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dengan operasi di Kalimantan." },
  { ticker: "GOLL", name: "Golden Plantation Tbk", sector: "Agrikultur & Pangan", description: "Perusahaan perkebunan kelapa sawit dengan lahan di Sumatera." },

  // === TRANSPORTASI & LOGISTIK ===
  { ticker: "BIRD", name: "Blue Bird Tbk", sector: "Transportasi & Logistik", description: "Operator taksi terbesar di Indonesia dengan armada Blue Bird dan Silver Bird." },
  { ticker: "GIAA", name: "Garuda Indonesia Tbk", sector: "Transportasi & Logistik", description: "Maskapai penerbangan nasional Indonesia dengan rute domestik dan internasional." },
  { ticker: "CMPP", name: "Air Asia Indonesia Tbk", sector: "Transportasi & Logistik", description: "Maskapai penerbangan berbiaya rendah dengan jaringan rute Asia Tenggara." },
  { ticker: "ASSA", name: "Adi Sarana Armada Tbk", sector: "Transportasi & Logistik", description: "Penyedia layanan transportasi korporat dan sewa kendaraan." },
  { ticker: "NELY", name: "Pelayaran Nelly Dwi Putri Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran dengan armada kapal untuk berbagai kargo." },
  { ticker: "TMAS", name: "Pelayaran Tempuran Emas Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran kontainer dengan rute antarpulau Indonesia." },
  { ticker: "BULL", name: "Buana Listya Tama Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran tanker kimia dan produk minyak." },
  { ticker: "LEAD", name: "Logindo Samudramakmur Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran yang menyediakan kapal pendukung lepas pantai." },
  { ticker: "SOCI", name: "Soechi Lines Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran tanker dengan armada untuk angkutan CPO dan BBM." },
  { ticker: "BLTA", name: "Berlian Laju Tanker Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran tanker internasional dengan armada besar." },
  { ticker: "CMNP", name: "Citra Marga Nusaphala Persada Tbk", sector: "Transportasi & Logistik", description: "Operator jalan tol dalam kota Jakarta." },
  { ticker: "SMDR", name: "Samudera Indonesia Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran dan logistik terpadu dengan jaringan internasional." },
  { ticker: "MBSS", name: "Mitrabahtera Segara Sejati Tbk", sector: "Transportasi & Logistik", description: "Perusahaan pelayaran tongkang untuk angkutan batu bara." },
  { ticker: "SAFE", name: "Steady Safe Tbk", sector: "Transportasi & Logistik", description: "Perusahaan transportasi darat dengan armada bus dan travel." },

  // === MEDIA & HIBURAN ===
  { ticker: "MNCN", name: "Media Nusantara Citra Tbk", sector: "Media & Hiburan", description: "Grup media dengan jaringan televisi nasional dan konten digital terbesar." },
  { ticker: "SCMA", name: "Surya Citra Media Tbk", sector: "Media & Hiburan", description: "Operator stasiun televisi SCTV dan Indosiar serta platform streaming Vidio." },
  { ticker: "EMTK", name: "Elang Mahkota Teknologi Tbk", sector: "Media & Hiburan", description: "Induk usaha SCTV, Indosiar, dan platform Vidio dengan bisnis media terintegrasi." },
  { ticker: "FILM", name: "MD Pictures Tbk", sector: "Media & Hiburan", description: "Produsen dan distributor film Indonesia terkemuka." },
  { ticker: "PRAY", name: "Tripar Multivision Plus Tbk", sector: "Media & Hiburan", description: "Produsen konten televisi dan film layar lebar." },
  { ticker: "MOBA", name: "Moba Indonesia Tbk", sector: "Media & Hiburan", description: "Perusahaan game mobile dan esports di Indonesia." },
  { ticker: "MSKY", name: "MNC Sky Vision Tbk", sector: "Media & Hiburan", description: "Operator televisi berbayar Indovision dengan berbagai paket channel." },
  { ticker: "VISI", name: "Visi Media Asia Tbk", sector: "Media & Hiburan", description: "Operator televisi antv dan tvOne, bagian dari Bakrie Group." },
  { ticker: "KPIG", name: "MNC Land Tbk", sector: "Media & Hiburan", description: "Perusahaan properti dan pariwisata MNC Group." },

  // === HOTEL & PARIWISATA ===
  { ticker: "BUVA", name: "Bukit Uluwatu Villa Tbk", sector: "Hotel & Pariwisata", description: "Pengelola resort dan villa premium di Bali." },
  { ticker: "PANR", name: "Panorama Sentrawisata Tbk", sector: "Hotel & Pariwisata", description: "Perusahaan pariwisata dengan layanan perjalanan dan pengelolaan hotel." },
  { ticker: "BAYU", name: "Bayu Buana Tbk", sector: "Hotel & Pariwisata", description: "Perusahaan agen perjalanan dan pariwisata terkemuka di Indonesia." },
  { ticker: "HOTL", name: "Saraswati Griya Lestari Tbk", sector: "Hotel & Pariwisata", description: "Pengelola hotel dan properti pariwisata." },
  { ticker: "EAST", name: "Eastparc Hotel Tbk", sector: "Hotel & Pariwisata", description: "Pengelola hotel Eastparc Yogyakarta dengan fasilitas bintang lima." },
  { ticker: "INNA", name: "Hotel Indonesia Natour Tbk", sector: "Hotel & Pariwisata", description: "BUMN pengelola hotel dengan portofolio hotel berbintang di berbagai kota." },
  { ticker: "SHID", name: "Hotel Sahid Jaya International Tbk", sector: "Hotel & Pariwisata", description: "Pengelola jaringan Hotel Sahid di berbagai kota Indonesia." },
];

// ─── SEKTOR-AVERAGE FUNDAMENTALS ─────────────────────────────────────────────
const SECTOR_DEFAULTS: Record<string, { pe?: number; pb?: number; roe?: number; roa?: number; dividendYield?: number; beta?: number; debtEquity?: number; currentRatio?: number }> = {
  "Perbankan":                    { pe: 12,   pb: 1.4,  roe: 0.13,  roa: 0.018, dividendYield: 0.04,  beta: 0.95, debtEquity: 0.22, currentRatio: 1.5  },
  "Keuangan Non-Bank":            { pe: 14,   pb: 1.8,  roe: 0.14,  roa: 0.06,  dividendYield: 0.03,  beta: 1.05, debtEquity: 0.35, currentRatio: 1.8  },
  "Konsumer":                     { pe: 18,   pb: 3.2,  roe: 0.18,  roa: 0.10,  dividendYield: 0.025, beta: 0.70, debtEquity: 0.45, currentRatio: 2.5  },
  "Rokok & Tembakau":             { pe: 11,   pb: 2.5,  roe: 0.22,  roa: 0.15,  dividendYield: 0.07,  beta: 0.58, debtEquity: 0.30, currentRatio: 2.0  },
  "Farmasi & Kesehatan":          { pe: 22,   pb: 3.5,  roe: 0.16,  roa: 0.10,  dividendYield: 0.02,  beta: 0.60, debtEquity: 0.20, currentRatio: 3.0  },
  "Ritel":                        { pe: 18,   pb: 3.0,  roe: 0.18,  roa: 0.08,  dividendYield: 0.02,  beta: 0.82, debtEquity: 0.50, currentRatio: 1.5  },
  "Teknologi":                    { pe: 35,   pb: 3.5,  roe: 0.08,  roa: 0.04,  dividendYield: 0.005, beta: 1.80, debtEquity: 0.30, currentRatio: 2.5  },
  "Telekomunikasi":               { pe: 20,   pb: 2.0,  roe: 0.10,  roa: 0.05,  dividendYield: 0.03,  beta: 0.80, debtEquity: 1.20, currentRatio: 0.90 },
  "Infrastruktur Telekomunikasi": { pe: 20,   pb: 4.0,  roe: 0.22,  roa: 0.08,  dividendYield: 0.035, beta: 0.72, debtEquity: 1.80, currentRatio: 0.90 },
  "Pertambangan Batu Bara":       { pe: 7,    pb: 1.5,  roe: 0.24,  roa: 0.16,  dividendYield: 0.10,  beta: 1.30, debtEquity: 0.25, currentRatio: 2.8  },
  "Pertambangan Mineral":         { pe: 18,   pb: 2.5,  roe: 0.12,  roa: 0.07,  dividendYield: 0.025, beta: 1.50, debtEquity: 0.50, currentRatio: 2.0  },
  "Energi & Migas":               { pe: 10,   pb: 1.2,  roe: 0.13,  roa: 0.07,  dividendYield: 0.05,  beta: 1.20, debtEquity: 0.70, currentRatio: 1.5  },
  "Petrokimia":                   { pe: 20,   pb: 1.8,  roe: 0.08,  roa: 0.04,  dividendYield: 0.01,  beta: 1.35, debtEquity: 1.00, currentRatio: 1.4  },
  "Semen & Bahan Bangunan":       { pe: 16,   pb: 1.2,  roe: 0.08,  roa: 0.04,  dividendYield: 0.03,  beta: 0.95, debtEquity: 0.50, currentRatio: 1.6  },
  "Industri Dasar":               { pe: 12,   pb: 1.0,  roe: 0.09,  roa: 0.05,  dividendYield: 0.02,  beta: 1.10, debtEquity: 0.60, currentRatio: 1.8  },
  "Otomotif & Manufaktur":        { pe: 11,   pb: 1.2,  roe: 0.12,  roa: 0.07,  dividendYield: 0.04,  beta: 0.88, debtEquity: 0.40, currentRatio: 2.0  },
  "Konstruksi & Infrastruktur":   { pe: 10,   pb: 0.7,  roe: 0.06,  roa: 0.02,  dividendYield: 0.015, beta: 1.30, debtEquity: 1.80, currentRatio: 1.2  },
  "Properti & Real Estate":       { pe: 10,   pb: 0.8,  roe: 0.08,  roa: 0.04,  dividendYield: 0.015, beta: 1.10, debtEquity: 0.65, currentRatio: 2.2  },
  "Agrikultur & Pangan":          { pe: 11,   pb: 0.9,  roe: 0.09,  roa: 0.05,  dividendYield: 0.04,  beta: 0.90, debtEquity: 0.35, currentRatio: 2.0  },
  "Transportasi & Logistik":      { pe: 14,   pb: 1.2,  roe: 0.09,  roa: 0.04,  dividendYield: 0.025, beta: 1.05, debtEquity: 0.90, currentRatio: 1.3  },
  "Media & Hiburan":              { pe: 8,    pb: 1.0,  roe: 0.13,  roa: 0.08,  dividendYield: 0.045, beta: 1.10, debtEquity: 0.20, currentRatio: 2.0  },
  "Hotel & Pariwisata":           { pe: 20,   pb: 1.5,  roe: 0.07,  roa: 0.04,  dividendYield: 0.015, beta: 1.05, debtEquity: 0.60, currentRatio: 1.4  },
};

// ─── FUNDAMENTALS PER-TICKER (saham utama) ───────────────────────────────────
const FUNDAMENTALS: Record<string, {
  pe?: number; pb?: number; roe?: number; roa?: number; eps?: number;
  revenue?: number; netIncome?: number; debtEquity?: number; currentRatio?: number;
  dividendYield?: number; beta?: number; freeCashFlow?: number; marketCap?: number;
}> = {
  BBCA: { pe: 24.5, pb: 4.2, roe: 0.197, roa: 0.031, eps: 1105, revenue: 115e12, netIncome: 44e12, debtEquity: 0.18, currentRatio: 1.8, dividendYield: 0.015, beta: 0.72, freeCashFlow: 35e12, marketCap: 1080e12 },
  BBRI: { pe: 14.2, pb: 2.1, roe: 0.163, roa: 0.025, eps: 482, revenue: 189e12, netIncome: 60e12, debtEquity: 0.22, currentRatio: 1.6, dividendYield: 0.035, beta: 0.88, freeCashFlow: 45e12, marketCap: 740e12 },
  BMRI: { pe: 12.8, pb: 1.9, roe: 0.153, roa: 0.021, eps: 583, revenue: 168e12, netIncome: 55e12, debtEquity: 0.19, currentRatio: 1.7, dividendYield: 0.032, beta: 0.91, freeCashFlow: 42e12, marketCap: 685e12 },
  TLKM: { pe: 16.3, pb: 2.8, roe: 0.175, roa: 0.082, eps: 249, revenue: 149e12, netIncome: 24e12, debtEquity: 0.61, currentRatio: 1.2, dividendYield: 0.042, beta: 0.65, freeCashFlow: 18e12, marketCap: 390e12 },
  ASII: { pe: 11.5, pb: 1.4, roe: 0.127, roa: 0.068, eps: 580, revenue: 338e12, netIncome: 34e12, debtEquity: 0.48, currentRatio: 1.45, dividendYield: 0.038, beta: 0.95, freeCashFlow: 22e12, marketCap: 390e12 },
  UNVR: { pe: 25.8, pb: 18.5, roe: 0.485, roa: 0.315, eps: 380, revenue: 42e12, netIncome: 7.2e12, debtEquity: 1.35, currentRatio: 0.78, dividendYield: 0.068, beta: 0.52, freeCashFlow: 6.8e12, marketCap: 190e12 },
  ICBP: { pe: 18.7, pb: 3.1, roe: 0.168, roa: 0.092, eps: 450, revenue: 68e12, netIncome: 7.8e12, debtEquity: 0.52, currentRatio: 2.1, dividendYield: 0.025, beta: 0.61, freeCashFlow: 5.5e12, marketCap: 148e12 },
  INDF: { pe: 8.4, pb: 1.1, roe: 0.138, roa: 0.065, eps: 875, revenue: 108e12, netIncome: 7.6e12, debtEquity: 0.68, currentRatio: 1.85, dividendYield: 0.048, beta: 0.72, freeCashFlow: 5.2e12, marketCap: 63e12 },
  ADRO: { pe: 7.2, pb: 1.8, roe: 0.282, roa: 0.185, eps: 1850, revenue: 75e12, netIncome: 28e12, debtEquity: 0.28, currentRatio: 2.8, dividendYield: 0.092, beta: 1.25, freeCashFlow: 25e12, marketCap: 198e12 },
  ITMG: { pe: 6.8, pb: 2.2, roe: 0.345, roa: 0.228, eps: 12500, revenue: 25e12, netIncome: 8.8e12, debtEquity: 0.15, currentRatio: 3.2, dividendYield: 0.115, beta: 1.35, freeCashFlow: 7.8e12, marketCap: 35e12 },
  ANTM: { pe: 22.4, pb: 2.6, roe: 0.118, roa: 0.078, eps: 148, revenue: 48e12, netIncome: 3.5e12, debtEquity: 0.42, currentRatio: 1.95, dividendYield: 0.022, beta: 1.42, freeCashFlow: 2.8e12, marketCap: 78e12 },
  MDKA: { pe: 85.2, pb: 8.8, roe: 0.065, roa: 0.042, eps: 32, revenue: 22e12, netIncome: 1.2e12, debtEquity: 0.95, currentRatio: 1.35, dividendYield: 0, beta: 1.85, freeCashFlow: -0.8e12, marketCap: 102e12 },
  BRPT: { pe: 18.5, pb: 1.2, roe: 0.062, roa: 0.028, eps: 78, revenue: 82e12, netIncome: 2.8e12, debtEquity: 1.45, currentRatio: 1.15, dividendYield: 0.008, beta: 1.38, freeCashFlow: 1.5e12, marketCap: 52e12 },
  TPIA: { pe: 35.8, pb: 3.2, roe: 0.082, roa: 0.048, eps: 265, revenue: 42e12, netIncome: 2.5e12, debtEquity: 0.78, currentRatio: 1.62, dividendYield: 0.005, beta: 1.52, freeCashFlow: 1.2e12, marketCap: 90e12 },
  GOTO: { pb: 1.8, roe: -0.092, roa: -0.042, eps: -18, revenue: 8.5e12, netIncome: -4.2e12, debtEquity: 0.38, currentRatio: 2.85, dividendYield: 0, beta: 2.15, freeCashFlow: -5.5e12, marketCap: 85e12 },
  BUKA: { pb: 0.8, roe: -0.115, roa: -0.068, eps: -12, revenue: 4.2e12, netIncome: -2.8e12, debtEquity: 0.22, currentRatio: 3.5, dividendYield: 0, beta: 2.45, freeCashFlow: -3.2e12, marketCap: 25e12 },
  EXCL: { pe: 28.5, pb: 1.8, roe: 0.062, roa: 0.028, eps: 85, revenue: 32e12, netIncome: 1.2e12, debtEquity: 1.25, currentRatio: 0.82, dividendYield: 0.012, beta: 0.85, freeCashFlow: 0.8e12, marketCap: 34e12 },
  ISAT: { pe: 32.4, pb: 2.1, roe: 0.045, roa: 0.018, eps: 125, revenue: 58e12, netIncome: 1.8e12, debtEquity: 1.85, currentRatio: 0.72, dividendYield: 0.008, beta: 0.92, freeCashFlow: 0.5e12, marketCap: 59e12 },
  KLBF: { pe: 22.8, pb: 3.8, roe: 0.168, roa: 0.135, eps: 62, revenue: 31e12, netIncome: 3.5e12, debtEquity: 0.18, currentRatio: 4.2, dividendYield: 0.028, beta: 0.58, freeCashFlow: 2.8e12, marketCap: 80e12 },
  CPIN: { pe: 19.5, pb: 3.5, roe: 0.185, roa: 0.112, eps: 195, revenue: 68e12, netIncome: 4.8e12, debtEquity: 0.32, currentRatio: 2.25, dividendYield: 0.022, beta: 0.78, freeCashFlow: 3.5e12, marketCap: 94e12 },
  BBNI: { pe: 9.8, pb: 1.3, roe: 0.135, roa: 0.018, eps: 685, revenue: 78e12, netIncome: 21e12, debtEquity: 0.25, currentRatio: 1.55, dividendYield: 0.045, beta: 0.98, freeCashFlow: 16e12, marketCap: 205e12 },
  BBTN: { pe: 6.5, pb: 0.85, roe: 0.122, roa: 0.012, eps: 425, revenue: 22e12, netIncome: 3.6e12, debtEquity: 0.32, currentRatio: 1.25, dividendYield: 0.038, beta: 1.05, freeCashFlow: 2.1e12, marketCap: 23e12 },
  BTPS: { pe: 11.2, pb: 1.9, roe: 0.198, roa: 0.085, eps: 142, revenue: 5.8e12, netIncome: 1.1e12, debtEquity: 0.12, currentRatio: 1.95, dividendYield: 0.052, beta: 0.68, freeCashFlow: 0.9e12, marketCap: 12e12 },
  ARTO: { pb: 6.8, roe: -0.025, roa: -0.015, eps: -8, revenue: 1.2e12, netIncome: -0.32e12, debtEquity: 0.08, currentRatio: 2.5, dividendYield: 0, beta: 1.95, freeCashFlow: -0.4e12, marketCap: 38e12 },
  SMGR: { pe: 14.5, pb: 0.9, roe: 0.062, roa: 0.032, eps: 320, revenue: 38e12, netIncome: 1.5e12, debtEquity: 0.58, currentRatio: 1.35, dividendYield: 0.025, beta: 1.02, freeCashFlow: 1.8e12, marketCap: 21e12 },
  INTP: { pe: 19.8, pb: 1.8, roe: 0.092, roa: 0.068, eps: 425, revenue: 17e12, netIncome: 1.65e12, debtEquity: 0.15, currentRatio: 3.85, dividendYield: 0.032, beta: 0.85, freeCashFlow: 1.9e12, marketCap: 31e12 },
  GGRM: { pe: 8.2, pb: 0.75, roe: 0.092, roa: 0.058, eps: 2850, revenue: 124e12, netIncome: 4.5e12, debtEquity: 0.42, currentRatio: 1.95, dividendYield: 0.058, beta: 0.62, freeCashFlow: 3.2e12, marketCap: 37e12 },
  HMSP: { pe: 13.8, pb: 4.2, roe: 0.305, roa: 0.225, eps: 65, revenue: 102e12, netIncome: 6.8e12, debtEquity: 0.22, currentRatio: 1.85, dividendYield: 0.085, beta: 0.55, freeCashFlow: 5.5e12, marketCap: 92e12 },
  AMRT: { pe: 32.5, pb: 8.5, roe: 0.275, roa: 0.105, eps: 78, revenue: 112e12, netIncome: 2.8e12, debtEquity: 0.48, currentRatio: 1.15, dividendYield: 0.012, beta: 0.72, freeCashFlow: 3.1e12, marketCap: 91e12 },
  MAPI: { pe: 16.5, pb: 3.5, roe: 0.225, roa: 0.095, eps: 145, revenue: 34e12, netIncome: 2.1e12, debtEquity: 0.65, currentRatio: 1.45, dividendYield: 0.018, beta: 1.12, freeCashFlow: 1.5e12, marketCap: 35e12 },
  ACES: { pe: 18.2, pb: 3.1, roe: 0.172, roa: 0.135, eps: 38, revenue: 8.5e12, netIncome: 0.95e12, debtEquity: 0.05, currentRatio: 4.5, dividendYield: 0.035, beta: 0.78, freeCashFlow: 0.85e12, marketCap: 16e12 },
  BSDE: { pe: 9.5, pb: 0.62, roe: 0.068, roa: 0.038, eps: 105, revenue: 8.2e12, netIncome: 1.5e12, debtEquity: 0.68, currentRatio: 2.85, dividendYield: 0.015, beta: 1.18, freeCashFlow: 0.6e12, marketCap: 21e12 },
  PWON: { pe: 11.2, pb: 1.25, roe: 0.115, roa: 0.072, eps: 38, revenue: 7.5e12, netIncome: 1.8e12, debtEquity: 0.42, currentRatio: 1.95, dividendYield: 0.022, beta: 0.95, freeCashFlow: 1.2e12, marketCap: 35e12 },
  SMRA: { pe: 18.5, pb: 1.45, roe: 0.082, roa: 0.032, eps: 28, revenue: 6.2e12, netIncome: 0.55e12, debtEquity: 0.95, currentRatio: 1.65, dividendYield: 0.008, beta: 1.25, freeCashFlow: 0.35e12, marketCap: 12e12 },
  CTRA: { pe: 10.8, pb: 0.98, roe: 0.092, roa: 0.045, eps: 105, revenue: 9.8e12, netIncome: 1.45e12, debtEquity: 0.55, currentRatio: 2.15, dividendYield: 0.018, beta: 1.05, freeCashFlow: 0.9e12, marketCap: 17e12 },
  WIKA: { pe: -4.2, pb: 0.42, roe: -0.185, roa: -0.042, eps: -75, revenue: 14e12, netIncome: -1.2e12, debtEquity: 2.85, currentRatio: 1.05, dividendYield: 0, beta: 1.65, freeCashFlow: -1.8e12, marketCap: 3.5e12 },
  PTPP: { pe: 8.5, pb: 0.32, roe: 0.045, roa: 0.012, eps: 32, revenue: 16e12, netIncome: 0.42e12, debtEquity: 2.45, currentRatio: 1.18, dividendYield: 0.012, beta: 1.45, freeCashFlow: -0.5e12, marketCap: 3.8e12 },
  JSMR: { pe: 12.5, pb: 1.65, roe: 0.142, roa: 0.038, eps: 285, revenue: 16e12, netIncome: 2.8e12, debtEquity: 1.95, currentRatio: 0.85, dividendYield: 0.022, beta: 0.88, freeCashFlow: 1.5e12, marketCap: 36e12 },
  PGAS: { pe: 7.2, pb: 0.85, roe: 0.118, roa: 0.062, eps: 195, revenue: 42e12, netIncome: 4.8e12, debtEquity: 0.55, currentRatio: 1.55, dividendYield: 0.065, beta: 1.15, freeCashFlow: 4.2e12, marketCap: 34e12 },
  MEDC: { pe: 9.5, pb: 1.45, roe: 0.155, roa: 0.072, eps: 142, revenue: 28e12, netIncome: 3.2e12, debtEquity: 1.25, currentRatio: 1.35, dividendYield: 0.038, beta: 1.32, freeCashFlow: 2.5e12, marketCap: 30e12 },
  AKRA: { pe: 13.8, pb: 2.85, roe: 0.205, roa: 0.105, eps: 105, revenue: 32e12, netIncome: 1.95e12, debtEquity: 0.62, currentRatio: 1.45, dividendYield: 0.048, beta: 0.92, freeCashFlow: 1.4e12, marketCap: 27e12 },
  PTBA: { pe: 6.2, pb: 1.65, roe: 0.265, roa: 0.185, eps: 425, revenue: 38e12, netIncome: 6.5e12, debtEquity: 0.22, currentRatio: 2.65, dividendYield: 0.125, beta: 1.18, freeCashFlow: 5.8e12, marketCap: 27e12 },
  HRUM: { pe: 11.5, pb: 1.85, roe: 0.162, roa: 0.128, eps: 105, revenue: 6.5e12, netIncome: 1.05e12, debtEquity: 0.18, currentRatio: 3.85, dividendYield: 0.072, beta: 1.45, freeCashFlow: 0.85e12, marketCap: 9e12 },
  AUTO: { pe: 8.5, pb: 1.05, roe: 0.125, roa: 0.085, eps: 285, revenue: 18e12, netIncome: 1.45e12, debtEquity: 0.32, currentRatio: 2.15, dividendYield: 0.042, beta: 0.85, freeCashFlow: 1.1e12, marketCap: 11e12 },
  IMAS: { pe: 22.5, pb: 0.85, roe: 0.038, roa: 0.012, eps: 35, revenue: 28e12, netIncome: 0.42e12, debtEquity: 1.85, currentRatio: 1.05, dividendYield: 0, beta: 1.42, freeCashFlow: -0.3e12, marketCap: 5.5e12 },
  MYOR: { pe: 19.5, pb: 4.2, roe: 0.225, roa: 0.135, eps: 132, revenue: 34e12, netIncome: 2.8e12, debtEquity: 0.55, currentRatio: 3.45, dividendYield: 0.022, beta: 0.68, freeCashFlow: 2.1e12, marketCap: 58e12 },
  SIDO: { pe: 17.8, pb: 6.5, roe: 0.365, roa: 0.305, eps: 38, revenue: 4.2e12, netIncome: 1.05e12, debtEquity: 0.05, currentRatio: 4.85, dividendYield: 0.058, beta: 0.55, freeCashFlow: 0.95e12, marketCap: 22e12 },
  ULTJ: { pe: 16.5, pb: 2.85, roe: 0.172, roa: 0.135, eps: 105, revenue: 8.5e12, netIncome: 1.05e12, debtEquity: 0.12, currentRatio: 3.65, dividendYield: 0.025, beta: 0.62, freeCashFlow: 0.75e12, marketCap: 16e12 },
  JPFA: { pe: 7.8, pb: 1.25, roe: 0.165, roa: 0.082, eps: 285, revenue: 52e12, netIncome: 2.5e12, debtEquity: 0.85, currentRatio: 1.65, dividendYield: 0.045, beta: 1.05, freeCashFlow: 1.8e12, marketCap: 19e12 },
  AALI: { pe: 12.5, pb: 0.85, roe: 0.072, roa: 0.045, eps: 685, revenue: 22e12, netIncome: 1.05e12, debtEquity: 0.32, currentRatio: 2.15, dividendYield: 0.038, beta: 0.92, freeCashFlow: 0.95e12, marketCap: 13e12 },
  LSIP: { pe: 9.8, pb: 0.78, roe: 0.082, roa: 0.062, eps: 105, revenue: 5.2e12, netIncome: 0.58e12, debtEquity: 0.08, currentRatio: 3.85, dividendYield: 0.052, beta: 0.85, freeCashFlow: 0.45e12, marketCap: 5.7e12 },
  TOWR: { pe: 16.5, pb: 4.5, roe: 0.285, roa: 0.105, eps: 65, revenue: 12e12, netIncome: 3.5e12, debtEquity: 1.65, currentRatio: 0.95, dividendYield: 0.045, beta: 0.72, freeCashFlow: 2.8e12, marketCap: 58e12 },
  TBIG: { pe: 28.5, pb: 8.5, roe: 0.305, roa: 0.082, eps: 65, revenue: 8.5e12, netIncome: 1.05e12, debtEquity: 2.85, currentRatio: 0.65, dividendYield: 0.025, beta: 0.78, freeCashFlow: 0.85e12, marketCap: 30e12 },
  MTEL: { pe: 22.5, pb: 1.85, roe: 0.082, roa: 0.045, eps: 28, revenue: 7.5e12, netIncome: 1.45e12, debtEquity: 0.45, currentRatio: 1.85, dividendYield: 0.038, beta: 0.65, freeCashFlow: 1.2e12, marketCap: 32e12 },
  MNCN: { pe: 6.5, pb: 0.85, roe: 0.135, roa: 0.092, eps: 145, revenue: 9.5e12, netIncome: 1.45e12, debtEquity: 0.18, currentRatio: 2.65, dividendYield: 0.045, beta: 1.15, freeCashFlow: 1.1e12, marketCap: 9.5e12 },
  SCMA: { pe: 8.2, pb: 1.45, roe: 0.178, roa: 0.122, eps: 38, revenue: 5.8e12, netIncome: 0.85e12, debtEquity: 0.22, currentRatio: 1.95, dividendYield: 0.058, beta: 1.05, freeCashFlow: 0.65e12, marketCap: 7e12 },
  SILO: { pe: 32.5, pb: 4.5, roe: 0.142, roa: 0.085, eps: 105, revenue: 9.5e12, netIncome: 0.95e12, debtEquity: 0.42, currentRatio: 1.35, dividendYield: 0, beta: 0.62, freeCashFlow: 0.55e12, marketCap: 31e12 },
  MIKA: { pe: 38.5, pb: 7.5, roe: 0.195, roa: 0.155, eps: 38, revenue: 4.5e12, netIncome: 0.95e12, debtEquity: 0.05, currentRatio: 4.25, dividendYield: 0.012, beta: 0.55, freeCashFlow: 0.85e12, marketCap: 37e12 },
  BYAN: { pe: 8.5, pb: 5.2, roe: 0.62, roa: 0.38, eps: 38000, revenue: 65e12, netIncome: 15e12, debtEquity: 0.12, currentRatio: 3.5, dividendYield: 0.12, beta: 1.45, freeCashFlow: 14e12, marketCap: 320e12 },
  INCO: { pe: 12, pb: 1.4, roe: 0.12, roa: 0.08, eps: 380, revenue: 18e12, netIncome: 1.8e12, debtEquity: 0.28, currentRatio: 2.8, dividendYield: 0.03, beta: 1.35, freeCashFlow: 1.2e12, marketCap: 22e12 },
  TINS: { pe: 15, pb: 1.2, roe: 0.08, roa: 0.05, eps: 120, revenue: 14e12, netIncome: 0.85e12, debtEquity: 0.45, currentRatio: 2.2, dividendYield: 0.025, beta: 1.5, freeCashFlow: 0.5e12, marketCap: 12e12 },
  NCKL: { pe: 25, pb: 3.5, roe: 0.14, roa: 0.08, eps: 65, revenue: 12e12, netIncome: 1.2e12, debtEquity: 0.55, currentRatio: 1.8, dividendYield: 0.015, beta: 1.65, freeCashFlow: 0.8e12, marketCap: 32e12 },
  AMMN: { pe: 18, pb: 4.2, roe: 0.24, roa: 0.15, eps: 420, revenue: 45e12, netIncome: 8.5e12, debtEquity: 0.35, currentRatio: 2.5, dividendYield: 0.02, beta: 1.55, freeCashFlow: 6.5e12, marketCap: 185e12 },
  BREN: { pe: 35, pb: 6.5, roe: 0.19, roa: 0.10, eps: 55, revenue: 8.5e12, netIncome: 1.6e12, debtEquity: 0.65, currentRatio: 1.5, dividendYield: 0.01, beta: 1.25, freeCashFlow: 1.2e12, marketCap: 95e12 },
  PGEO: { pe: 28, pb: 2.8, roe: 0.10, roa: 0.06, eps: 38, revenue: 5.2e12, netIncome: 0.75e12, debtEquity: 0.80, currentRatio: 1.3, dividendYield: 0.02, beta: 0.85, freeCashFlow: 0.5e12, marketCap: 21e12 },
  UNTR: { pe: 9.5, pb: 1.8, roe: 0.192, roa: 0.105, eps: 4200, revenue: 95e12, netIncome: 14e12, debtEquity: 0.55, currentRatio: 1.85, dividendYield: 0.055, beta: 0.98, freeCashFlow: 10e12, marketCap: 130e12 },
  INKP: { pe: 6.5, pb: 0.85, roe: 0.13, roa: 0.07, eps: 1850, revenue: 85e12, netIncome: 8e12, debtEquity: 0.65, currentRatio: 1.75, dividendYield: 0.04, beta: 1.15, freeCashFlow: 6e12, marketCap: 52e12 },
  TKIM: { pe: 7, pb: 0.9, roe: 0.13, roa: 0.07, eps: 1250, revenue: 55e12, netIncome: 5e12, debtEquity: 0.72, currentRatio: 1.65, dividendYield: 0.035, beta: 1.12, freeCashFlow: 3.5e12, marketCap: 35e12 },
  ESSA: { pe: 12, pb: 2.2, roe: 0.18, roa: 0.10, eps: 165, revenue: 6e12, netIncome: 1.1e12, debtEquity: 0.42, currentRatio: 2.1, dividendYield: 0.05, beta: 1.28, freeCashFlow: 0.8e12, marketCap: 14e12 },
  KRAS: { pb: 0.55, roe: -0.05, roa: -0.02, eps: -85, revenue: 25e12, netIncome: -0.8e12, debtEquity: 1.85, currentRatio: 1.05, dividendYield: 0, beta: 1.55, freeCashFlow: -1.2e12, marketCap: 7e12 },
  GJTL: { pe: 12, pb: 0.85, roe: 0.07, roa: 0.03, eps: 185, revenue: 18e12, netIncome: 0.85e12, debtEquity: 1.45, currentRatio: 1.1, dividendYield: 0.02, beta: 1.25, freeCashFlow: 0.5e12, marketCap: 10e12 },
  BIRD: { pe: 18, pb: 2.5, roe: 0.14, roa: 0.08, eps: 145, revenue: 4.5e12, netIncome: 0.65e12, debtEquity: 0.55, currentRatio: 1.65, dividendYield: 0.03, beta: 0.88, freeCashFlow: 0.45e12, marketCap: 12e12 },
  GIAA: { pb: 0.45, roe: -0.25, roa: -0.08, eps: -145, revenue: 32e12, netIncome: -3.5e12, debtEquity: 5.5, currentRatio: 0.55, dividendYield: 0, beta: 1.75, freeCashFlow: -2.5e12, marketCap: 5e12 },
};

// ─── HARGA DASAR PER TICKER ─────────────────────────────────────────────────
const BASE_PRICES: Record<string, number> = {
  // Big caps
  BBCA:10225, BBRI:5850, BMRI:7750, TLKM:3680, ASII:6850, UNVR:2850,
  ICBP:12150, INDF:7125, ADRO:2650, ITMG:32400, ANTM:1895, MDKA:3120,
  BRPT:1285, TPIA:9350, GOTO:78, BUKA:155, EXCL:2280, ISAT:4020,
  KLBF:1740, CPIN:4420, BBNI:5250, BBTN:1285, BTPS:1820, ARTO:2650,
  SMGR:3680, INTP:8400, GGRM:16000, HMSP:895, AMRT:3120, MAPI:1525,
  ACES:805, BSDE:985, PWON:425, SMRA:555, CTRA:1095, WIKA:320,
  PTPP:272, JSMR:4850, PGAS:1490, MEDC:1265, AKRA:1450, PTBA:2680,
  HRUM:1255, AUTO:2420, IMAS:645, MYOR:2580, SIDO:565, ULTJ:1850,
  JPFA:1380, AALI:6500, LSIP:945, TOWR:750, TBIG:2150, MTEL:685,
  MNCN:685, SCMA:175, SILO:2750, MIKA:2680,
  // Mid caps
  BNGA:1285, NISP:1115, BNII:255, BDMN:2980, MAYA:742, BJTM:645,
  BJBR:1285, BSIM:182, PNBN:1185, BBHI:585, BBYB:142, BTPN:2780,
  BVIC:148, SDRA:695, MCOR:155, NOBU:825, AGRO:388, BINA:152,
  ADMF:9350, BFIN:1425, CFIN:1025, WOMF:388, MFIN:745,
  RMBA:388, WIIM:895,
  TSPC:1850, DVLA:3820, MERK:5250, KAEF:985, INAF:382, PYFA:985,
  HEAL:1285, PRDL:1485, DGNS:385, BIOS:885, IRRA:285, OMED:482,
  SAME:388, PEHA:985,
  HERO:985, LPPF:2980, RANC:625, MIDI:585, CSAP:985, MPPA:232,
  ERAA:482, RALS:525, ECII:382, AVIA:985,
  DCII:38500, WIFI:285, MTDL:485, MLPT:285, INET:252, MCAS:485,
  EMTK:585, ATIC:282,
  FREN:55, CENT:125, SUPR:985,
  BYAN:21500, DSSA:38000, GEMS:4850, TOBA:1085, ARII:148, INDY:1485,
  PTRO:2850, DOID:388, MBAP:8850, MYOH:1485, BSSR:3850, KKGI:385,
  BOSS:285, PKPK:182,
  INCO:3850, TINS:1285, NICL:485, NCKL:875, MBMA:325, ADMR:285,
  BRMS:285, SMRU:145, ZINC:245, AMMN:9850, PGEO:1285, CITA:385,
  ELSA:588, ENRG:145, RUIS:285, BIPI:188, ESSA:985, WINS:195, RAJA:325,
  BREN:9850, KEEN:385,
  SRSN:145, LTLS:985, CTBN:885, UNIC:6850, INCI:945, EKAD:985,
  SMBR:482, WTON:382,
  KRAS:285, GDST:285, ISSP:185, LMSH:985, NIKL:285, ALMI:285, BTON:285,
  INKP:8850, TKIM:9850, FASW:985, ALDO:285, SPMA:185, KBRI:148,
  IGAR:385, TRST:285, YPAS:185, FPNI:185, APLI:145, DYNA:985, IMPC:685,
  SRIL:165, TFCO:245, RICY:285, TRIS:285, PBRX:185, HDTX:145, MYTX:125,
  GJTL:1285, MASA:285, BRAM:3850, KBLI:385, KBLM:285, ADMG:185,
  SMSM:1485, INDS:2850, NIPS:285, MPMX:985, LPIN:285, BOLT:485, PRAS:185,
  UNTR:27500, HEXA:7850,
  ADHI:485, WSKT:185, ACST:485, NRCA:485, SSIA:485, TOTL:985,
  JKON:285, CASS:485, BEST:188, DMAS:188, META:282,
  ASRI:182, DILD:285, KIJA:182, LPCK:985, LPKR:145, MKPI:18500,
  MMLP:445, MTLA:188, PLIN:3850, PPRO:85, RODA:285, SMDM:185,
  BKSL:115, ELTY:55, GWSA:285, PJAA:1385, APLN:115, SCBD:3850, JRPT:985,
  HOME:285, NIRO:145, LAKE:185, FMII:285, GAMA:115, COWL:65, MDLN:185,
  KPIG:182, ROCK:145, TARA:285, MABA:145, BIPP:75, RBMS:285,
  SSMS:1285, SIMP:485, SGRO:1285, TAPG:985, DSNG:985, GZCO:285,
  ANJT:985, UNSP:85, BWPT:115, SMAR:3850, MAGP:185,
  BIRD:1485, GIAA:165, CMPP:85, ASSA:585, NELY:145, TMAS:385,
  BULL:145, LEAD:145, SOCI:285, BLTA:145, SMDR:985,
  EMTK:485, FILM:285, PRAY:285, MOBA:185, MSKY:945, VISI:185,
  BUVA:385, PANR:285, BAYU:985, EAST:785, INNA:485, SHID:285,
  BISI:1385, TBLA:985, PALMA:285, GOLL:185, ESSA:985,
};

// ─── GENERATE HARGA HISTORIS SIMULASI ────────────────────────────────────────
function generatePriceHistory(ticker: string, basePrice: number, sector: string): {
  ticker: string; date: string; open: string; high: string; low: string; close: string; volume: number;
}[] {
  const prices = [];
  let price = basePrice * 0.78;

  // Volatilitas berdasarkan sektor
  const sectorVol: Record<string, number> = {
    "Pertambangan Batu Bara": 0.038, "Pertambangan Mineral": 0.042, "Teknologi": 0.045,
    "Energi & Migas": 0.035, "Properti & Real Estate": 0.032, "Konstruksi & Infrastruktur": 0.040,
    "Transportasi & Logistik": 0.035, "Perbankan": 0.022, "Konsumer": 0.025,
    "Farmasi & Kesehatan": 0.020, "Telekomunikasi": 0.022, "Ritel": 0.028,
  };
  const volatility = sectorVol[sector] ?? 0.030;

  // Volume base
  const marketCap = FUNDAMENTALS[ticker]?.marketCap ?? 5e12;
  const baseVolume = Math.max(100000, Math.round(marketCap / Math.max(basePrice, 100) / 365 * 2));

  const today = new Date();
  for (let i = 249; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const dateStr = date.toISOString().slice(0, 10);
    const trendFactor = 1 + (0.22 / 249);
    const randomFactor = 1 + (Math.random() - 0.48) * volatility;
    const shock = Math.random() < 0.025 ? (Math.random() - 0.5) * 0.04 : 0;

    price = price * trendFactor * randomFactor + price * shock;
    price = Math.max(price, basePrice * 0.35);
    price = Math.min(price, basePrice * 1.4);

    const unit = basePrice >= 5000 ? 50 : basePrice >= 500 ? 25 : basePrice >= 50 ? 5 : 1;
    const open = Math.round(price * (1 + (Math.random() - 0.5) * 0.005) / unit) * unit;
    const high = Math.round(Math.max(open, price * (1 + Math.random() * 0.012)) / unit) * unit;
    const low = Math.round(Math.min(open, price * (1 - Math.random() * 0.012)) / unit) * unit;
    const close = Math.round(price / unit) * unit;
    const volume = Math.round(baseVolume * (0.4 + Math.random() * 1.6));

    prices.push({ ticker, date: dateStr, open: String(open), high: String(high), low: String(low), close: String(close), volume });
  }
  return prices;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🌱 Seed data SahamRadar AI — ${ALL_STOCKS.length} saham IDX\n`);

  // Deduplicate
  const seen = new Set<string>();
  const stocks = ALL_STOCKS.filter(s => {
    if (seen.has(s.ticker)) return false;
    seen.add(s.ticker);
    return true;
  });
  console.log(`📋 Saham unik: ${stocks.length}`);

  // 1. Insert stocks
  console.log("\n📈 Inserting stocks...");
  for (const stock of stocks) {
    await db.insert(stocksTable).values({
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      description: stock.description,
    }).onConflictDoUpdate({
      target: stocksTable.ticker,
      set: { name: stock.name, sector: stock.sector, description: stock.description },
    });
  }
  console.log(`  ✓ ${stocks.length} saham berhasil`);

  // 2. Insert fundamentals (per-ticker atau sector average)
  console.log("\n📊 Inserting fundamentals...");
  let fundCount = 0;
  for (const stock of stocks) {
    const fund = FUNDAMENTALS[stock.ticker];
    const sectorDef = SECTOR_DEFAULTS[stock.sector] ?? {};
    const merged = { ...sectorDef, ...fund };

    await db.insert(stockFundamentalsTable).values({
      ticker: stock.ticker,
      pe: merged.pe ? String(merged.pe) : null,
      pb: merged.pb ? String(merged.pb) : null,
      roe: merged.roe != null ? String(merged.roe) : null,
      roa: merged.roa != null ? String(merged.roa) : null,
      eps: (fund as Record<string, number | undefined>)?.eps ? String((fund as Record<string, number | undefined>).eps) : null,
      debtEquity: merged.debtEquity ? String(merged.debtEquity) : null,
      currentRatio: merged.currentRatio ? String(merged.currentRatio) : null,
      dividendYield: merged.dividendYield != null ? String(merged.dividendYield) : null,
      beta: merged.beta ? String(merged.beta) : null,
      marketCap: (fund as Record<string, number | undefined>)?.marketCap ? String((fund as Record<string, number | undefined>).marketCap) : null,
      revenue: (fund as Record<string, number | undefined>)?.revenue ? String((fund as Record<string, number | undefined>).revenue) : null,
      netIncome: (fund as Record<string, number | undefined>)?.netIncome ? String((fund as Record<string, number | undefined>).netIncome) : null,
      freeCashFlow: (fund as Record<string, number | undefined>)?.freeCashFlow ? String((fund as Record<string, number | undefined>).freeCashFlow) : null,
    }).onConflictDoNothing();
    fundCount++;
  }
  console.log(`  ✓ ${fundCount} fundamental data`);

  // 3. Insert price history
  console.log("\n💹 Inserting price history (250 hari per saham)...");
  let totalPrices = 0;
  for (const stock of stocks) {
    const basePrice = BASE_PRICES[stock.ticker] ?? (
      stock.sector === "Perbankan" ? 2000 :
      stock.sector === "Pertambangan Batu Bara" ? 1500 :
      stock.sector === "Properti & Real Estate" ? 400 :
      stock.sector === "Konstruksi & Infrastruktur" ? 500 :
      stock.sector === "Teknologi" ? 300 :
      500
    );
    const priceData = generatePriceHistory(stock.ticker, basePrice, stock.sector);
    await db.delete(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker));
    if (priceData.length > 0) {
      await db.insert(stockPricesTable).values(priceData);
      totalPrices += priceData.length;
    }
  }
  console.log(`  ✓ ${totalPrices} data harga`);

  // 4. Calculate scores
  console.log("\n🎯 Menghitung scoring...");
  let scoredCount = 0;
  for (const stock of stocks) {
    try {
      const [prices, fund] = await Promise.all([
        db.select().from(stockPricesTable).where(eq(stockPricesTable.ticker, stock.ticker)),
        db.select().from(stockFundamentalsTable).where(eq(stockFundamentalsTable.ticker, stock.ticker)).limit(1),
      ]);

      const priceData = prices.map(p => ({
        date: p.date, open: parseFloat(p.open), high: parseFloat(p.high),
        low: parseFloat(p.low), close: parseFloat(p.close), volume: Number(p.volume),
      }));

      const f = fund[0];
      const fundamentalData = f ? {
        pe: f.pe ? parseFloat(f.pe) : null,
        pb: f.pb ? parseFloat(f.pb) : null,
        roe: f.roe ? parseFloat(f.roe) : null,
        roa: f.roa ? parseFloat(f.roa) : null,
        eps: f.eps ? parseFloat(f.eps) : null,
        revenue: f.revenue ? parseFloat(f.revenue) : null,
        netIncome: f.netIncome ? parseFloat(f.netIncome) : null,
        debtEquity: f.debtEquity ? parseFloat(f.debtEquity) : null,
        currentRatio: f.currentRatio ? parseFloat(f.currentRatio) : null,
        dividendYield: f.dividendYield ? parseFloat(f.dividendYield) : null,
        beta: f.beta ? parseFloat(f.beta) : null,
        freeCashFlow: f.freeCashFlow ? parseFloat(f.freeCashFlow) : null,
        marketCap: f.marketCap ? parseFloat(f.marketCap) : null,
      } : {};

      const score = calculateScores(priceData, fundamentalData);

      await db.insert(stockScoresTable).values({
        ticker: stock.ticker,
        currentPrice: String(score.currentPrice),
        priceChange: String(score.priceChange),
        priceChangePct: String(score.priceChangePct),
        volume: score.volume,
        avgVolume: score.avgVolume,
        trendScore: String(score.trendScore),
        momentumScore: String(score.momentumScore),
        volumeScore: String(score.volumeScore),
        liquidityScore: String(score.liquidityScore),
        fundamentalScore: String(score.fundamentalScore),
        valuationScore: String(score.valuationScore),
        riskScore: String(score.riskScore),
        totalScore: String(score.totalScore),
        label: score.label,
        ma20: score.ma20 ? String(score.ma20) : null,
        ma50: score.ma50 ? String(score.ma50) : null,
        ma200: score.ma200 ? String(score.ma200) : null,
        rsi14: score.rsi14 ? String(score.rsi14) : null,
        supportLevel: score.supportLevel ? String(score.supportLevel) : null,
        resistanceLevel: score.resistanceLevel ? String(score.resistanceLevel) : null,
      }).onConflictDoUpdate({
        target: stockScoresTable.ticker,
        set: {
          currentPrice: String(score.currentPrice),
          totalScore: String(score.totalScore),
          label: score.label,
          trendScore: String(score.trendScore),
          momentumScore: String(score.momentumScore),
        },
      });

      if (scoredCount % 50 === 0) console.log(`  ... ${scoredCount}/${stocks.length} diproses`);
      scoredCount++;
    } catch (err) {
      console.error(`  ✗ ${stock.ticker}: ${String(err)}`);
    }
  }

  console.log(`\n✅ Seed selesai!`);
  console.log(`   Total saham: ${stocks.length}`);
  console.log(`   Total harga: ${totalPrices}`);
  console.log(`   Scored: ${scoredCount}/${stocks.length}`);
  console.log(`\n💡 Jalankan sync harga realtime dari halaman Admin untuk update ke harga Yahoo Finance.`);
  process.exit(0);
}

main().catch(err => {
  console.error("Seed gagal:", err);
  process.exit(1);
});
