import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

/**
 * Local database, encrypted with SQLCipher. The key is random per install and lives in
 * the Keychain / Keystore, so a copied database file is unreadable. Translation history
 * and the dictionary cache stay on this phone and are never uploaded.
 */

const KEY_NAME = 'translator.db.key';
const SECURE = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function databaseKey(): Promise<string> {
  let key = await SecureStore.getItemAsync(KEY_NAME, SECURE);
  if (!key) {
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
];

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('translator.db');
  // The key must be the first statement on a SQLCipher connection. Hex keys skip PBKDF2.
  await db.execAsync(`PRAGMA key = "x'${await databaseKey()}'"`);
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
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= open().catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
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

export async function addHistory(item: Omit<HistoryItem, 'id' | 'created_at'>): Promise<void> {
  const db = await getDb();
  const last = await db.getFirstAsync<{ input: string; target: string }>('SELECT input, target FROM history ORDER BY id DESC LIMIT 1');
  if (last && last.input === item.input && last.target === item.target) return;
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

export async function clearHistory(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM history; VACUUM;');
}

/* ------------------------------------------------------------------ dictionary cache */

export async function getCachedEntry<T>(word: string, lang: string, ui: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM dictionary WHERE word = ? AND lang = ? AND ui = ?', word, lang, ui);
  return row ? (JSON.parse(row.data) as T) : null;
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
