import { type BlobRecord, type DatasetManifest, type DatasetRecord, getDb } from './db';

export class ManifestError extends Error {
  constructor(message: string) { super(message); this.name = 'ManifestError'; }
}
export class IntegrityError extends Error {
  constructor(public readonly file: string, message: string) { super(message); this.name = 'IntegrityError'; }
}
export class StorageQuotaError extends Error {
  constructor(public readonly neededBytes: number, public readonly availableBytes: number) {
    super(`Not enough storage: need ~${neededBytes} bytes, ~${availableBytes} available`);
    this.name = 'StorageQuotaError';
  }
}
export class DownloadError extends Error {
  constructor(public readonly file: string, message: string) { super(message); this.name = 'DownloadError'; }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
/** safety margin on top of the dataset size: IndexedDB overhead + room for the app itself */
export const QUOTA_MARGIN = 1.25;

export function validateManifest(raw: unknown): DatasetManifest {
  const m = raw as Partial<DatasetManifest> | null;
  if (!m || typeof m !== 'object') throw new ManifestError('manifest is not an object');
  if (m.formatVersion !== 1) throw new ManifestError(`unsupported dataset format ${String(m.formatVersion)}`);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new ManifestError('invalid dataset id');
  if (typeof m.dataVersion !== 'string' || !/^[0-9a-f]{12}$/.test(m.dataVersion)) throw new ManifestError('invalid dataVersion');
  if (typeof m.name !== 'string' || !m.name) throw new ManifestError('missing name');
  if (!Array.isArray(m.bbox) || m.bbox.length !== 4 || m.bbox.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    throw new ManifestError('invalid bbox');
  }
  if (!Array.isArray(m.files) || m.files.length === 0) throw new ManifestError('manifest lists no files');
  const names = new Set<string>();
  for (const f of m.files) {
    if (typeof f?.name !== 'string' || !FILE_RE.test(f.name)) throw new ManifestError(`unsafe file name: ${String(f?.name)}`);
    if (!Number.isInteger(f.bytes) || f.bytes < 0) throw new ManifestError(`invalid size for ${f.name}`);
    if (typeof f.sha256 !== 'string' || !SHA_RE.test(f.sha256)) throw new ManifestError(`invalid sha256 for ${f.name}`);
    if (names.has(f.name)) throw new ManifestError(`duplicate file ${f.name}`);
    names.add(f.name);
  }
  if (typeof m.attribution !== 'string' || !m.attribution) throw new ManifestError('missing attribution (required by ODbL)');
  return m as DatasetManifest;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface StorageEstimate { quota?: number; usage?: number }

export async function estimateStorage(): Promise<StorageEstimate> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch { /* fall through: unknown */ }
  return {};
}

export interface InstallProgress {
  datasetId: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface InstallOptions {
  /** URL prefix that serves manifest.json and the dataset files */
  baseUrl: string;
  signal?: AbortSignal;
  onProgress?: (p: InstallProgress) => void;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
  estimate?: () => Promise<StorageEstimate>;
}

const join = (base: string, name: string) => `${base.replace(/\/+$/, '')}/${name}`;
const blobKey = (id: string, sha: string) => `${id}/${sha}`;

export async function listDatasets(): Promise<DatasetRecord[]> {
  return (await getDb()).getAll('datasets');
}
export async function getDataset(id: string): Promise<DatasetRecord | undefined> {
  return (await getDb()).get('datasets', id);
}

/**
 * Reads a response body into ONE preallocated buffer of the manifest's expected size, so peak memory
 * is ~1x the file (not chunks + a concatenated copy = ~2x). A body longer than expected is rejected as
 * soon as the extra bytes arrive; a shorter one is returned truncated so the caller's size check reports it.
 */
async function readStream(res: Response, expected: number, name: string, onChunk: (n: number) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onChunk(buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(expected);
  let total = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > expected) {
      void reader.cancel().catch(() => undefined);
      console.error(`[readStream overflow] ${name}: expected ${expected} bytes, but got ${total} + ${value.byteLength} bytes`);
      throw new IntegrityError(name, `${name}: expected ${expected} bytes, received more`);
    }
    out.set(value, total);
    total += value.byteLength;
    onChunk(value.byteLength);
  }
  if (total !== expected) {
    console.error(`[readStream short read] ${name}: expected ${expected} bytes, but read stopped at ${total} bytes`);
  }
  return total === expected ? out.buffer : out.buffer.slice(0, total);
}

/**
 * Installs (or resumes / updates) a dataset into IndexedDB.
 *  - verifies size + SHA-256 of every file before it is stored;
 *  - resumable at file granularity (verified files are never re-downloaded);
 *  - content-addressed blobs: files unchanged between versions are reused, not re-fetched;
 *  - the dataset only becomes `complete` after every file is stored, and the previous
 *    version stays usable until then.
 */
export async function installDataset(opts: InstallOptions): Promise<DatasetRecord> {
  const doFetch = opts.fetchImpl ?? fetch;
  const manifestRes = await doFetch(join(opts.baseUrl, 'manifest.json'), { signal: opts.signal, cache: 'no-store' });
  if (!manifestRes.ok) throw new DownloadError('manifest.json', `manifest request failed: HTTP ${manifestRes.status}`);
  const manifest = validateManifest(await manifestRes.json());
  const db = await getDb();
  const id = manifest.id;
  const existing = await db.get('datasets', id);

  if (existing?.status === 'complete' && existing.dataVersion === manifest.dataVersion) return existing;

  // What is genuinely missing? (a file is "present" if its content-addressed blob exists)
  const missing: DatasetManifest['files'] = [];
  for (const f of manifest.files) {
    if (!(await db.getKey('blobs', blobKey(id, f.sha256)))) missing.push(f);
  }
  const needed = missing.reduce((s, f) => s + f.bytes, 0);
  const est = await (opts.estimate ?? estimateStorage)();
  if (est.quota !== undefined && est.usage !== undefined) {
    const available = est.quota - est.usage;
    if (available < needed * QUOTA_MARGIN) throw new StorageQuotaError(Math.ceil(needed * QUOTA_MARGIN), Math.max(0, available));
  }

  const totalBytes = manifest.files.reduce((s, f) => s + f.bytes, 0);
  // Keep serving the old complete version while a newer one downloads.
  const keepOld = existing?.status === 'complete' && existing.dataVersion !== manifest.dataVersion;
  const pending: DatasetRecord = {
    id, name: manifest.name, dataVersion: manifest.dataVersion, status: 'installing', manifest,
    filesDone: manifest.files.filter((f) => !missing.includes(f)).map((f) => f.sha256), totalBytes,
  };
  if (!keepOld) await db.put('datasets', pending);

  let bytesDone = manifest.files.reduce((s, f) => (missing.includes(f) ? s : s + f.bytes), 0);
  try {
    for (const [fileIndex, f] of manifest.files.entries()) {
      if (!missing.includes(f)) continue;
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      // announce the file before its first byte arrives, so the UI never names the previous file
      opts.onProgress?.({ datasetId: id, file: f.name, fileIndex, fileCount: manifest.files.length, bytesDone, bytesTotal: totalBytes });
      // Append a query param so browser extensions (like IDM - Internet Download Manager)
      // do not hijack .bin file fetches and return HTTP 204 No Content with 0 bytes.
      const fileUrl = join(opts.baseUrl, f.name);
      const reqUrl = fileUrl.includes('?') ? `${fileUrl}&dmaps=1` : `${fileUrl}?dmaps=1`;
      const res = await doFetch(reqUrl, { signal: opts.signal, cache: 'no-store' });
      if (!res.ok) throw new DownloadError(f.name, `HTTP ${res.status} for ${f.name}`);
      const before = bytesDone;
      const data = await readStream(res, f.bytes, f.name, (n) => {
        bytesDone += n;
        opts.onProgress?.({ datasetId: id, file: f.name, fileIndex, fileCount: manifest.files.length, bytesDone, bytesTotal: totalBytes });
      }, opts.signal);
      bytesDone = before + f.bytes;
      if (data.byteLength !== f.bytes) {
        console.error(`[IntegrityError] ${f.name} size mismatch: expected ${f.bytes} bytes, received ${data.byteLength} bytes`);
        throw new IntegrityError(f.name, `${f.name}: expected ${f.bytes} bytes, received ${data.byteLength}`);
      }
      const sha = await sha256Hex(data);
      if (sha !== f.sha256) {
        console.error(`[IntegrityError] ${f.name} checksum mismatch: expected ${f.sha256}, got ${sha}`);
        throw new IntegrityError(f.name, `${f.name}: checksum mismatch — file is corrupt or was tampered with`);
      }
      const rec: BlobRecord = { key: blobKey(id, sha), data, bytes: data.byteLength };
      await db.put('blobs', rec);
      pending.filesDone.push(f.sha256);
      if (!keepOld) await db.put('datasets', pending);
    }
  } catch (err) {
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    if (!(err instanceof DOMException && err.name === 'AbortError') && !keepOld) {
      await db.put('datasets', { ...pending, status: 'failed', error: quota ? 'quota' : (err as Error).message });
    }
    if (quota) throw new StorageQuotaError(needed, 0);
    throw err;
  }

  const complete: DatasetRecord = { ...pending, status: 'complete', installedAt: Date.now(), error: undefined };
  const tx = db.transaction(['datasets', 'blobs'], 'readwrite');
  await tx.objectStore('datasets').put(complete);
  // drop blobs of the superseded version that the new manifest no longer references
  const keep = new Set(manifest.files.map((f) => blobKey(id, f.sha256)));
  for (const key of await tx.objectStore('blobs').getAllKeys()) {
    if (key.startsWith(`${id}/`) && !keep.has(key)) await tx.objectStore('blobs').delete(key);
  }
  await tx.done;
  return complete;
}

export async function readDatasetFile(id: string, name: string): Promise<ArrayBuffer> {
  const db = await getDb();
  const rec = await db.get('datasets', id);
  if (!rec || rec.status !== 'complete') throw new Error(`dataset "${id}" is not installed`);
  const f = rec.manifest.files.find((x) => x.name === name);
  if (!f) throw new Error(`dataset "${id}" has no file "${name}"`);
  const blob = await db.get('blobs', blobKey(id, f.sha256));
  if (!blob) throw new IntegrityError(name, `${name} is missing from local storage (it may have been evicted); reinstall the dataset`);
  return blob.data;
}

export async function readDatasetJson<T>(id: string, name: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readDatasetFile(id, name))) as T;
}

export interface VerifyResult { file: string; ok: boolean; reason?: 'missing' | 'size' | 'checksum' }

/** Re-hash everything stored for a dataset (the "Verify" button in the offline map manager). */
export async function verifyDataset(id: string): Promise<VerifyResult[]> {
  const db = await getDb();
  const rec = await db.get('datasets', id);
  if (!rec) throw new Error(`dataset "${id}" is not installed`);
  const out: VerifyResult[] = [];
  for (const f of rec.manifest.files) {
    const blob = await db.get('blobs', blobKey(id, f.sha256));
    if (!blob) { out.push({ file: f.name, ok: false, reason: 'missing' }); continue; }
    if (blob.bytes !== f.bytes || blob.data.byteLength !== f.bytes) { out.push({ file: f.name, ok: false, reason: 'size' }); continue; }
    out.push((await sha256Hex(blob.data)) === f.sha256 ? { file: f.name, ok: true } : { file: f.name, ok: false, reason: 'checksum' });
  }
  return out;
}

export async function removeDataset(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['datasets', 'blobs'], 'readwrite');
  await tx.objectStore('datasets').delete(id);
  for (const key of await tx.objectStore('blobs').getAllKeys()) {
    if (key.startsWith(`${id}/`)) await tx.objectStore('blobs').delete(key);
  }
  await tx.done;
}

/** Ask the browser not to evict our data under storage pressure (best effort; may be denied). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch { return false; }
}
