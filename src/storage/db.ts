import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export type DatasetStatus = 'installing' | 'complete' | 'failed';

export interface DatasetManifest {
  formatVersion: number;
  id: string;
  name: string;
  dataVersion: string;
  bbox: [number, number, number, number];
  attribution: string;
  license: string;
  limitations: string[];
  stats: Record<string, unknown>;
  files: { name: string; bytes: number; sha256: string }[];
}

export interface DatasetRecord {
  id: string;
  name: string;
  dataVersion: string;
  status: DatasetStatus;
  manifest: DatasetManifest;
  /** sha256 of each file already stored and verified (enables file-level resume) */
  filesDone: string[];
  totalBytes: number;
  installedAt?: number;
  error?: string;
}

export interface BlobRecord {
  /** `${datasetId}/${sha256}` — content-addressed so unchanged files are reused across versions */
  key: string;
  data: ArrayBuffer;
  bytes: number;
}

export interface KvRecord { key: string; value: unknown }

interface DMapsDB extends DBSchema {
  datasets: { key: string; value: DatasetRecord };
  blobs: { key: string; value: BlobRecord };
  kv: { key: string; value: KvRecord };
}

export const DB_NAME = 'dmaps';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<DMapsDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<DMapsDB>> {
  dbPromise ??= openDB<DMapsDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Version history: v1 = initial schema. Add `if (oldVersion < 2)` blocks for later migrations
      // so existing users' downloaded datasets survive upgrades.
      db.createObjectStore('datasets', { keyPath: 'id' });
      db.createObjectStore('blobs', { keyPath: 'key' });
      db.createObjectStore('kv', { keyPath: 'key' });
    },
    blocked() { console.warn('D’Maps database upgrade blocked by another open tab'); },
    terminated() { dbPromise = null; },
  });
  return dbPromise;
}

/** Test helper: close and forget the cached connection. */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return ((await (await getDb()).get('kv', key))?.value as T | undefined);
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('kv', { key, value });
}
export async function kvDelete(key: string): Promise<void> {
  await (await getDb()).delete('kv', key);
}
