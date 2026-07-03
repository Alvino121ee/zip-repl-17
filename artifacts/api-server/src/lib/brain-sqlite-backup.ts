/**
 * Brain SQLite Backup — dual-write semua data latihan AI ke file .sqlite
 *
 * Cara kerja:
 *  - syncToFile()         : dump PostgreSQL → SQLite (dipanggil otomatis tiap siklus)
 *  - restoreFromFile()    : SQLite → PostgreSQL (restore manual via admin panel)
 *  - autoRestoreIfEmpty() : dipanggil saat startup — jika PG kosong & backup ada, langsung restore
 *
 * File disimpan di: artifacts/api-server/data/goldradar-brain.sqlite
 * (atau BRAIN_BACKUP_PATH env var)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@workspace/db";
import {
  xauusdBrainTable,
  xauusdPredictionsTable,
  xauusdQuestionsLogTable,
  xauusdLearningLogTable,
  xauusdSettingsTable,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import type { SqlJsStatic, Database as SqlJsDb } from "sql.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any; // sql.js Database — pakai any untuk hindari konflik tipe

// ─── Path ke file backup ───────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Dari dist/ atau src/ → naik 2 level ke artifacts/api-server/, lalu ke data/
export const BACKUP_PATH =
  process.env.BRAIN_BACKUP_PATH ??
  path.join(__dirname, "..", "..", "data", "goldradar-brain.sqlite");

// ─── sql.js lazy loader ────────────────────────────────────────────────────────
let _sql: SqlJsStatic | null = null;
async function getSql(): Promise<SqlJsStatic> {
  if (!_sql) {
    const mod = await import("sql.js");
    _sql = await mod.default();
  }
  return _sql;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function ensureDir() {
  const dir = path.dirname(BACKUP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function openDb(SQL: SqlJsStatic): SqlJsDb {
  ensureDir();
  if (fs.existsSync(BACKUP_PATH)) {
    const buf = fs.readFileSync(BACKUP_PATH);
    return new SQL.Database(buf);
  }
  return new SQL.Database();
}

function saveDb(sqlDb: SqlJsDb) {
  ensureDir();
  fs.writeFileSync(BACKUP_PATH, Buffer.from(sqlDb.export()));
}

// ─── Schema SQLite (mirror tabel PostgreSQL) ──────────────────────────────────
function initSchema(sqlDb: SqlJsDb) {
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS xauusd_brain (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_validated TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      source_question TEXT,
      market_condition_tags TEXT,
      decay_weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xauusd_predictions (
      id INTEGER PRIMARY KEY,
      predicted_at TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      direction TEXT NOT NULL,
      target_price REAL,
      entry_low REAL,
      entry_high REAL,
      stop_loss REAL,
      confidence REAL NOT NULL,
      reasoning TEXT NOT NULL,
      price_at_prediction REAL NOT NULL,
      indicators_at_prediction TEXT,
      trading_session TEXT,
      market_regime TEXT,
      cluster_label TEXT,
      price_p10 REAL,
      price_p50 REAL,
      price_p90 REAL,
      verify_at TEXT,
      actual_price REAL,
      actual_direction TEXT,
      is_correct INTEGER,
      price_diff REAL,
      revised_at TEXT,
      revision_note TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS xauusd_questions_log (
      id INTEGER PRIMARY KEY,
      question TEXT NOT NULL,
      question_hash TEXT NOT NULL UNIQUE,
      answer TEXT,
      quality REAL,
      saved_to_brain INTEGER NOT NULL DEFAULT 0,
      market_context TEXT,
      asked_at TEXT NOT NULL,
      answered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS xauusd_learning_log (
      id INTEGER PRIMARY KEY,
      cycle_at TEXT NOT NULL,
      price_at_cycle REAL,
      questions_asked INTEGER NOT NULL DEFAULT 0,
      insights_saved INTEGER NOT NULL DEFAULT 0,
      predictions_checked INTEGER NOT NULL DEFAULT 0,
      wrong_predictions INTEGER NOT NULL DEFAULT 0,
      spike_detected INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      duration_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS xauusd_settings (
      id INTEGER PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_meta (
      id INTEGER PRIMARY KEY DEFAULT 1,
      last_sync_at TEXT,
      brain_count INTEGER DEFAULT 0,
      predictions_count INTEGER DEFAULT 0,
      questions_count INTEGER DEFAULT 0,
      log_count INTEGER DEFAULT 0,
      settings_count INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO backup_meta (id) VALUES (1);
  `);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export interface BackupStats {
  fileExists: boolean;
  fileSizeBytes: number;
  fileSizeMB: string;
  backupPath: string;
  lastSyncAt: string | null;
  brainCount: number;
  predictionsCount: number;
  questionsCount: number;
  logCount: number;
  settingsCount: number;
}

export async function getBackupStats(): Promise<BackupStats> {
  const fileExists = fs.existsSync(BACKUP_PATH);
  const fileSizeBytes = fileExists ? fs.statSync(BACKUP_PATH).size : 0;
  const fileSizeMB = (fileSizeBytes / 1024 / 1024).toFixed(2);

  if (!fileExists) {
    return {
      fileExists, fileSizeBytes, fileSizeMB, backupPath: BACKUP_PATH,
      lastSyncAt: null, brainCount: 0, predictionsCount: 0,
      questionsCount: 0, logCount: 0, settingsCount: 0,
    };
  }

  const SQL = await getSql();
  const sqlDb = openDb(SQL);
  initSchema(sqlDb);

  let lastSyncAt: string | null = null;
  let brainCount = 0, predictionsCount = 0, questionsCount = 0, logCount = 0, settingsCount = 0;

  try {
    const stmt = sqlDb.prepare("SELECT * FROM backup_meta WHERE id = 1");
    if (stmt.step()) {
      const row = stmt.getAsObject();
      lastSyncAt = (row.last_sync_at as string) ?? null;
      brainCount = (row.brain_count as number) ?? 0;
      predictionsCount = (row.predictions_count as number) ?? 0;
      questionsCount = (row.questions_count as number) ?? 0;
      logCount = (row.log_count as number) ?? 0;
      settingsCount = (row.settings_count as number) ?? 0;
    }
    stmt.free();
  } finally {
    sqlDb.close();
  }

  return {
    fileExists, fileSizeBytes, fileSizeMB, backupPath: BACKUP_PATH,
    lastSyncAt, brainCount, predictionsCount, questionsCount, logCount, settingsCount,
  };
}

/**
 * Sync semua data AI dari PostgreSQL → file SQLite.
 * Dipanggil otomatis setiap siklus belajar.
 */
export async function syncToFile(): Promise<{ ok: boolean; message: string }> {
  try {
    const SQL = await getSql();
    const sqlDb = openDb(SQL);
    initSchema(sqlDb);

    // ── 1. xauusd_brain ───────────────────────────────────────────────────────
    const brain = await db.select().from(xauusdBrainTable);
    sqlDb.run("DELETE FROM xauusd_brain");
    const brainStmt = sqlDb.prepare(
      `INSERT INTO xauusd_brain VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const r of brain) {
      brainStmt.run([
        r.id, r.category, r.title, r.content,
        r.confidence, r.usageCount,
        r.lastValidated?.toISOString() ?? null,
        r.isActive ? 1 : 0,
        r.sourceQuestion ?? null, r.marketConditionTags ?? null,
        r.decayWeight,
        r.createdAt.toISOString(), r.updatedAt.toISOString(),
      ]);
    }
    brainStmt.free();

    // ── 2. xauusd_predictions ─────────────────────────────────────────────────
    const preds = await db.select().from(xauusdPredictionsTable);
    sqlDb.run("DELETE FROM xauusd_predictions");
    const predStmt = sqlDb.prepare(
      `INSERT INTO xauusd_predictions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const r of preds) {
      predStmt.run([
        r.id, r.predictedAt.toISOString(), r.timeframe, r.direction,
        r.targetPrice ?? null, r.entryLow ?? null, r.entryHigh ?? null, r.stopLoss ?? null,
        r.confidence, r.reasoning, r.priceAtPrediction,
        r.indicatorsAtPrediction ? JSON.stringify(r.indicatorsAtPrediction) : null,
        r.tradingSession ?? null, r.marketRegime ?? null, r.clusterLabel ?? null,
        r.priceP10 ?? null, r.priceP50 ?? null, r.priceP90 ?? null,
        r.verifyAt?.toISOString() ?? null,
        r.actualPrice ?? null, r.actualDirection ?? null,
        r.isCorrect === null ? null : (r.isCorrect ? 1 : 0),
        r.priceDiff ?? null,
        r.revisedAt?.toISOString() ?? null,
        r.revisionNote ?? null, r.status,
      ]);
    }
    predStmt.free();

    // ── 3. xauusd_questions_log ───────────────────────────────────────────────
    const questions = await db.select().from(xauusdQuestionsLogTable);
    sqlDb.run("DELETE FROM xauusd_questions_log");
    const qStmt = sqlDb.prepare(
      `INSERT OR IGNORE INTO xauusd_questions_log VALUES (?,?,?,?,?,?,?,?,?)`
    );
    for (const r of questions) {
      qStmt.run([
        r.id, r.question, r.questionHash, r.answer ?? null, r.quality ?? null,
        r.savedToBrain ? 1 : 0,
        r.marketContext ? JSON.stringify(r.marketContext) : null,
        r.askedAt.toISOString(),
        r.answeredAt?.toISOString() ?? null,
      ]);
    }
    qStmt.free();

    // ── 4. xauusd_learning_log ────────────────────────────────────────────────
    const logs = await db.select().from(xauusdLearningLogTable);
    sqlDb.run("DELETE FROM xauusd_learning_log");
    const logStmt = sqlDb.prepare(
      `INSERT INTO xauusd_learning_log VALUES (?,?,?,?,?,?,?,?,?,?)`
    );
    for (const r of logs) {
      logStmt.run([
        r.id, r.cycleAt.toISOString(), r.priceAtCycle ?? null,
        r.questionsAsked, r.insightsSaved,
        r.predictionsChecked, r.wrongPredictions,
        r.spikeDetected ? 1 : 0, r.summary ?? null, r.durationMs ?? null,
      ]);
    }
    logStmt.free();

    // ── 5. xauusd_settings ────────────────────────────────────────────────────
    const settings = await db.select().from(xauusdSettingsTable);
    sqlDb.run("DELETE FROM xauusd_settings");
    const sStmt = sqlDb.prepare(
      `INSERT INTO xauusd_settings VALUES (?,?,?,?)`
    );
    for (const r of settings) {
      sStmt.run([r.id, r.key, r.value, r.updatedAt.toISOString()]);
    }
    sStmt.free();

    // ── Update meta ───────────────────────────────────────────────────────────
    sqlDb.run(
      `UPDATE backup_meta SET last_sync_at=?,brain_count=?,predictions_count=?,questions_count=?,log_count=?,settings_count=? WHERE id=1`,
      [
        new Date().toISOString(),
        brain.length, preds.length, questions.length, logs.length, settings.length,
      ]
    );

    saveDb(sqlDb);
    sqlDb.close();

    const msg = `Synced: ${brain.length} brain, ${preds.length} prediksi, ${questions.length} Q&A, ${logs.length} siklus`;
    console.log(`[Brain Backup] ✅ ${msg}`);
    return { ok: true, message: msg };
  } catch (err) {
    console.error("[Brain Backup] ❌ Sync error:", err);
    return { ok: false, message: String(err) };
  }
}

/**
 * Restore semua data AI dari file SQLite → PostgreSQL.
 * Pakai ON CONFLICT DO NOTHING — tidak menimpa data yang sudah ada.
 */
export async function restoreFromFile(): Promise<{
  ok: boolean;
  restored: { brain: number; predictions: number; questions: number; logs: number; settings: number };
  message: string;
}> {
  const empty = { brain: 0, predictions: 0, questions: 0, logs: 0, settings: 0 };
  if (!fs.existsSync(BACKUP_PATH)) {
    return { ok: false, restored: empty, message: `File backup tidak ditemukan: ${BACKUP_PATH}` };
  }

  try {
    const SQL = await getSql();
    const sqlDb = openDb(SQL);

    const readAll = (table: string) => {
      const rows: Record<string, unknown>[] = [];
      const stmt = sqlDb.prepare(`SELECT * FROM ${table}`);
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    };

    // ── brain ─────────────────────────────────────────────────────────────────
    const brainRows = readAll("xauusd_brain");
    let rBrain = 0;
    for (const r of brainRows) {
      await db.insert(xauusdBrainTable).values({
        id: r.id as number,
        category: r.category as string,
        title: r.title as string,
        content: r.content as string,
        confidence: r.confidence as number,
        usageCount: r.usage_count as number,
        lastValidated: r.last_validated ? new Date(r.last_validated as string) : null,
        isActive: r.is_active === 1,
        sourceQuestion: (r.source_question as string) ?? null,
        marketConditionTags: (r.market_condition_tags as string) ?? null,
        decayWeight: r.decay_weight as number,
        createdAt: new Date(r.created_at as string),
        updatedAt: new Date(r.updated_at as string),
      }).onConflictDoNothing();
      rBrain++;
    }

    // ── predictions ───────────────────────────────────────────────────────────
    const predRows = readAll("xauusd_predictions");
    let rPreds = 0;
    for (const r of predRows) {
      await db.insert(xauusdPredictionsTable).values({
        id: r.id as number,
        predictedAt: new Date(r.predicted_at as string),
        timeframe: r.timeframe as string,
        direction: r.direction as string,
        targetPrice: (r.target_price as number) ?? null,
        entryLow: (r.entry_low as number) ?? null,
        entryHigh: (r.entry_high as number) ?? null,
        stopLoss: (r.stop_loss as number) ?? null,
        confidence: r.confidence as number,
        reasoning: r.reasoning as string,
        priceAtPrediction: r.price_at_prediction as number,
        indicatorsAtPrediction: r.indicators_at_prediction
          ? JSON.parse(r.indicators_at_prediction as string)
          : null,
        tradingSession: (r.trading_session as string) ?? null,
        marketRegime: (r.market_regime as string) ?? null,
        clusterLabel: (r.cluster_label as string) ?? null,
        priceP10: (r.price_p10 as number) ?? null,
        priceP50: (r.price_p50 as number) ?? null,
        priceP90: (r.price_p90 as number) ?? null,
        verifyAt: r.verify_at ? new Date(r.verify_at as string) : null,
        actualPrice: (r.actual_price as number) ?? null,
        actualDirection: (r.actual_direction as string) ?? null,
        isCorrect: r.is_correct === null ? null : r.is_correct === 1,
        priceDiff: (r.price_diff as number) ?? null,
        revisedAt: r.revised_at ? new Date(r.revised_at as string) : null,
        revisionNote: (r.revision_note as string) ?? null,
        status: r.status as string,
      }).onConflictDoNothing();
      rPreds++;
    }

    // ── questions ─────────────────────────────────────────────────────────────
    const qRows = readAll("xauusd_questions_log");
    let rQ = 0;
    for (const r of qRows) {
      await db.insert(xauusdQuestionsLogTable).values({
        id: r.id as number,
        question: r.question as string,
        questionHash: r.question_hash as string,
        answer: (r.answer as string) ?? null,
        quality: (r.quality as number) ?? null,
        savedToBrain: r.saved_to_brain === 1,
        marketContext: r.market_context ? JSON.parse(r.market_context as string) : null,
        askedAt: new Date(r.asked_at as string),
        answeredAt: r.answered_at ? new Date(r.answered_at as string) : null,
      }).onConflictDoNothing();
      rQ++;
    }

    // ── learning log ──────────────────────────────────────────────────────────
    const logRows = readAll("xauusd_learning_log");
    let rLogs = 0;
    for (const r of logRows) {
      await db.insert(xauusdLearningLogTable).values({
        id: r.id as number,
        cycleAt: new Date(r.cycle_at as string),
        priceAtCycle: (r.price_at_cycle as number) ?? null,
        questionsAsked: r.questions_asked as number,
        insightsSaved: r.insights_saved as number,
        predictionsChecked: r.predictions_checked as number,
        wrongPredictions: r.wrong_predictions as number,
        spikeDetected: r.spike_detected === 1,
        summary: (r.summary as string) ?? null,
        durationMs: (r.duration_ms as number) ?? null,
      }).onConflictDoNothing();
      rLogs++;
    }

    // ── settings ──────────────────────────────────────────────────────────────
    const sRows = readAll("xauusd_settings");
    let rSettings = 0;
    for (const r of sRows) {
      await db.insert(xauusdSettingsTable).values({
        id: r.id as number,
        key: r.key as string,
        value: r.value as string,
        updatedAt: new Date(r.updated_at as string),
      }).onConflictDoNothing();
      rSettings++;
    }

    sqlDb.close();

    // ── Reset PostgreSQL sequences agar INSERT berikutnya tidak tabrakan PK ──
    // Wajib setelah restore dengan explicit ID dari SQLite backup
    try {
      const seqTables = [
        { seq: "xauusd_brain_id_seq", table: "xauusd_brain" },
        { seq: "xauusd_predictions_id_seq", table: "xauusd_predictions" },
        { seq: "xauusd_questions_log_id_seq", table: "xauusd_questions_log" },
        { seq: "xauusd_learning_log_id_seq", table: "xauusd_learning_log" },
        { seq: "xauusd_settings_id_seq", table: "xauusd_settings" },
      ];
      for (const { seq, table } of seqTables) {
        await db.execute(
          sql.raw(`SELECT setval('${seq}', COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`)
        );
      }
      console.log("[Brain Backup] ✅ Sequences direset ke nilai aman.");
    } catch (seqErr) {
      console.error("[Brain Backup] ⚠️ Gagal reset sequence:", seqErr);
    }

    const msg = `Restore berhasil: ${rBrain} brain, ${rPreds} prediksi, ${rQ} pertanyaan, ${rLogs} siklus, ${rSettings} setting`;
    console.log(`[Brain Backup] ✅ ${msg}`);
    return {
      ok: true,
      restored: { brain: rBrain, predictions: rPreds, questions: rQ, logs: rLogs, settings: rSettings },
      message: msg,
    };
  } catch (err) {
    console.error("[Brain Backup] ❌ Restore error:", err);
    return { ok: false, restored: empty, message: String(err) };
  }
}

/**
 * Dipanggil saat startup engine.
 * Jika PostgreSQL brain kosong DAN file backup ada → auto-restore.
 */
export async function autoRestoreIfEmpty(): Promise<void> {
  try {
    const existing = await db
      .select({ id: xauusdBrainTable.id })
      .from(xauusdBrainTable)
      .limit(1);
    if (existing.length > 0) return; // PostgreSQL sudah ada data
    if (!fs.existsSync(BACKUP_PATH)) return; // Tidak ada backup

    console.log(
      "[Brain Backup] 🔄 PostgreSQL brain kosong — auto-restore dari backup file..."
    );
    const result = await restoreFromFile();
    if (result.ok) {
      console.log(`[Brain Backup] ✅ Auto-restore selesai. ${result.message}`);
    } else {
      console.error(`[Brain Backup] ❌ Auto-restore gagal: ${result.message}`);
    }
  } catch (err) {
    console.error("[Brain Backup] ❌ Auto-restore check error:", err);
  }
}
