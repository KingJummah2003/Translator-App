import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

/**
 * Local database, encrypted with SQLCipher. The key is random per install and lives in
 * the Keychain / Keystore, so a copied database file is unreadable. Translation history
 * and the dictionary cache stay on this phone and are never uploaded.
 */

const DB_NAME = 'translator.db';
const KEY_NAME = 'translator.db.key';
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let wasReset = false;

async function databaseKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME, SECURE);
  if (!key || !/^[0-9a-f]{64}$/.test(key)) {
    const bytes = Crypto.getRandomBytes(32);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(KEY_NAME, key, SECURE);
  }
  return key;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
   CREATE TABLE history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     source TEXT NOT NULL, target TEXT NOT NULL,
     input TEXT NOT NULL, output TEXT NOT NULL,
     engine TEXT NOT NULL, created_at INTEGER NOT NULL
   );
   CREATE INDEX history_time ON history (created_at DESC);
   CREATE TABLE dictionary (
     word TEXT NOT NULL, lang TEXT NOT NULL, ui TEXT NOT NULL,
     data TEXT NOT NULL, fetched_at INTEGER NOT NULL,
     PRIMARY KEY (word, lang, ui)
   );`,
  // The word sheet now caches under ui = 'v3:<lang>'; older rows (no dialect data) are never read.
  `DELETE FROM dictionary WHERE ui NOT LIKE 'v3:%';`,
];

/**
 * True for errors that mean the file can never be read with the key we hold: the key and
 * file got out of sync (an iCloud/Google restore brings the file back but not the
 * this-device-only key, or the Keystore was reset), or the file is damaged.
 */
export function isUnreadableDatabaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not a database|NOTADB|file is encrypted|malformed|SQLITE_CORRUPT|code:? ?(26|11)\b/i.test(message);
}

async function openKeyed(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // The key must be the first statement on a SQLCipher connection. Hex keys skip PBKDF2.
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  return db;
}

/**
 * Deletes the database and its WAL side files. A stale WAL would otherwise be replayed into
 * the new file. The main file is removed by hand too if expo-sqlite refused.
 */
async function deleteDatabaseFiles(path: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(DB_NAME).catch(() => {});
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      const file = new File(`file://${encodeURI(path + suffix)}`);
      if (file.exists) file.delete();
    } catch {
      // Not there, or already gone.
    }
  }
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    // Same connection on purpose: an "exclusive" transaction opens a second connection that
    // would not have the encryption key.
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]!);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}

/** Opens, checks and migrates the database; never leaves a half-open connection behind. */
async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await databaseKey();
  let db = await openKeyed(key);
  try {
    // The first real read is where a wrong key or a damaged file shows up.
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
  } catch (err) {
    const path = db.databasePath;
    // expo-sqlite caches open connections by path: close this one so a retry starts clean.
    await db.closeAsync().catch(() => {});
    if (!isUnreadableDatabaseError(err)) throw err;
    // Only local history, settings and the dictionary cache are lost; the app keeps working.
    await deleteDatabaseFiles(path);
    wasReset = true;
    db = await openKeyed(key);
  }
  try {
    await migrate(db);
  } catch (err) {
    await db.closeAsync().catch(() => {});
    throw err;
  }
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

/** True when the local database could not be read at launch and was recreated empty. */
export function wasDatabaseReset(): boolean {
  return wasReset;
}

/* ------------------------------------------------------------------ key-value */

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

/* ------------------------------------------------------------------ history */

export interface HistoryItem {
  id: number;
  source: string;
  target: string;
  input: string;
  output: string;
  engine: 'offline' | 'cloud';
  created_at: number;
}

const HISTORY_LIMIT = 500;
/** How long a newer version of the same phrase replaces the last entry instead of adding one. */
const REVISE_WINDOW_MS = 2 * 60_000;

export async function addHistory(
  item: Omit<HistoryItem, 'id' | 'created_at'>,
  opts: { revise?: boolean } = {},
): Promise<void> {
  if (!item.input.trim() || !item.output.trim() || item.source === item.target) return;
  const db = await getDb();
  const last = await db.getFirstAsync<Pick<HistoryItem, 'id' | 'source' | 'target' | 'input' | 'engine' | 'created_at'>>(
    'SELECT id, source, target, input, engine, created_at FROM history ORDER BY id DESC LIMIT 1',
  );
  const replaceLast = (id: number) =>
    db.runAsync(
      'UPDATE history SET source = ?, input = ?, output = ?, engine = ?, created_at = ? WHERE id = ?',
      item.source,
      item.input,
      item.output,
      item.engine,
      Date.now(),
      id,
    );
  if (last && last.target === item.target) {
    if (last.input === item.input) {
      // The same phrase again. "Better quality" after an on-device result keeps the cloud one.
      if (item.engine === 'cloud' && last.engine !== 'cloud') await replaceLast(last.id);
      return;
    }
    // While typing, "Where is" then "Where is the pharmacy?" is one phrase being written.
    const sameSource = last.source === item.source || last.source === 'auto' || item.source === 'auto';
    const continues = item.input.startsWith(last.input) || last.input.startsWith(item.input);
    if (opts.revise && sameSource && continues && Date.now() - last.created_at < REVISE_WINDOW_MS) {
      await replaceLast(last.id);
      return;
    }
  }
  await db.runAsync(
    'INSERT INTO history (source, target, input, output, engine, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    item.source,
    item.target,
    item.input,
    item.output,
    item.engine,
    Date.now(),
  );
  await db.runAsync(`DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ${HISTORY_LIMIT})`);
}

export async function listHistory(limit = 50): Promise<HistoryItem[]> {
  const db = await getDb();
  return db.getAllAsync<HistoryItem>('SELECT * FROM history ORDER BY id DESC LIMIT ?', limit);
}

export async function deleteHistoryItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM history WHERE id = ?', id);
}

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM history; VACUUM;');
}

/* ------------------------------------------------------------------ dictionary cache */

export async function getCachedEntry<T>(word: string, lang: string, ui: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM dictionary WHERE word = ? AND lang = ? AND ui = ?', word, lang, ui);
  if (!row) return null;
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return null;
  }
}

export async function cacheEntry(word: string, lang: string, ui: string, data: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO dictionary (word, lang, ui, data, fetched_at) VALUES (?, ?, ?, ?, ?)',
    word,
    lang,
    ui,
    JSON.stringify(data),
    Date.now(),
  );
}

/** Wipes everything stored locally (used on account deletion). */
export async function wipeLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM history; DELETE FROM dictionary; DELETE FROM kv; VACUUM;');
}
