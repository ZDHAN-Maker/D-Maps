import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutingEngine, parseGraph, type WayInfo } from '../src/routing';
import {
  IntegrityError, ManifestError, StorageQuotaError, getDataset, installDataset, listDatasets,
  readDatasetFile, readDatasetJson, removeDataset, validateManifest, verifyDataset,
} from '../src/storage';
import { getDb, resetDbForTests } from '../src/storage/db';
import { fakeServer, makeVariant } from './helpers/fakeServer';
import { MONACO_DIR } from './helpers/loadDataset';

const files = JSON.parse(readFileSync(join(MONACO_DIR, 'manifest.json'), 'utf8')).files as { name: string; bytes: number }[];
const dataFileCount = files.length;

beforeEach(async () => { await resetDbForTests(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('install', () => {
  it('installs a verified dataset, reports progress, and serves it back for routing — all from IndexedDB', async () => {
    const srv = fakeServer(MONACO_DIR);
    let last = 0;
    const rec = await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: async () => ({ quota: 1e9, usage: 0 }),
      onProgress: (p) => { expect(p.bytesDone).toBeGreaterThanOrEqual(last); last = p.bytesDone; } });
    expect(rec.status).toBe('complete');
    expect(last).toBe(rec.totalBytes);
    expect(srv.requests).toEqual(['manifest.json', ...files.map((f) => f.name)]);

    // From here on ANY network call fails the test: reading + routing must work from IndexedDB alone.
    vi.stubGlobal('fetch', () => { throw new Error('network access attempted while offline'); });
    const graph = parseGraph(await readDatasetFile('monaco', 'graph.bin'), await readDatasetJson<WayInfo[]>('monaco', 'ways.json'));
    const engine = new RoutingEngine(graph, { bbox: rec.manifest.bbox });
    const r = engine.route({ lat: 43.73926, lon: 7.428548 }, { lat: 43.720623, lon: 7.394386 });
    expect(r.ok).toBe(true);
  });

  it('is a no-op (manifest check only) when already up to date', async () => {
    const srv = fakeServer(MONACO_DIR);
    const opts = { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: async () => ({ quota: 1e9, usage: 0 }) };
    await installDataset(opts);
    srv.requests.length = 0;
    const again = await installDataset(opts);
    expect(again.status).toBe('complete');
    expect(srv.requests).toEqual(['manifest.json']);
  });
});

describe('failure handling', () => {
  const est = async () => ({ quota: 1e9, usage: 0 });

  it('recovers from an interrupted download by fetching only what is missing', async () => {
    const broken = fakeServer(MONACO_DIR, { failOn: 'places.json' });
    await expect(installDataset({ baseUrl: broken.baseUrl, fetchImpl: broken.fetchImpl, estimate: est })).rejects.toThrow(/Failed to fetch/);
    const partial = (await getDataset('monaco'))!;
    expect(partial.status).toBe('failed');
    expect(partial.filesDone.length).toBeGreaterThan(0);
    expect(partial.filesDone.length).toBeLessThan(dataFileCount);
    await expect(readDatasetFile('monaco', 'graph.bin')).rejects.toThrow(/not installed/); // never usable while incomplete

    const healthy = fakeServer(MONACO_DIR);
    const rec = await installDataset({ baseUrl: healthy.baseUrl, fetchImpl: healthy.fetchImpl, estimate: est });
    expect(rec.status).toBe('complete');
    // already-verified files were not downloaded again
    expect(healthy.requests.length).toBe(1 + dataFileCount - partial.filesDone.length);
  });

  it('keeps an aborted download resumable (status stays "installing", not "failed")', async () => {
    const ac = new AbortController();
    const srv = fakeServer(MONACO_DIR, { onRequest: (n) => { if (n === 'ways.json') ac.abort(); } });
    await expect(installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est, signal: ac.signal })).rejects.toThrow();
    expect((await getDataset('monaco'))!.status).toBe('installing');
  });

  it('rejects a tampered file and never marks the dataset complete', async () => {
    const srv = fakeServer(MONACO_DIR, { tamper: { 'places.json': (b) => Buffer.concat([b.subarray(0, b.length - 1), Buffer.from('X')]) } });
    await expect(installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est })).rejects.toBeInstanceOf(IntegrityError);
    expect((await getDataset('monaco'))!.status).toBe('failed');
    const db = await getDb();
    // the corrupt file was not stored, so the dataset cannot be complete
    const stored = new Set((await db.getAllKeys('blobs')).map((k) => k.split('/')[1]));
    const placesSha = (await getDataset('monaco'))!.manifest.files.find((f) => f.name === 'places.json')!.sha256;
    expect(stored.has(placesSha)).toBe(false);
  });

  it('rejects a truncated file', async () => {
    const srv = fakeServer(MONACO_DIR, { tamper: { 'graph.bin': (b) => b.subarray(0, b.length - 100) } });
    await expect(installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est })).rejects.toThrow(/expected \d+ bytes/);
  });

  it('rejects a file longer than the manifest says, without buffering the excess', async () => {
    const srv = fakeServer(MONACO_DIR, { tamper: { 'graph.bin': (b) => Buffer.concat([b, Buffer.alloc(4096, 1)]) } });
    await expect(installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }))
      .rejects.toThrow(/expected \d+ bytes, received more/);
    expect((await getDataset('monaco'))!.status).toBe('failed');
  });

  it('refuses to start when storage is insufficient, before downloading any data file', async () => {
    const srv = fakeServer(MONACO_DIR);
    await expect(installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: async () => ({ quota: 1_000_000, usage: 200_000 }) }))
      .rejects.toBeInstanceOf(StorageQuotaError);
    expect(srv.requests).toEqual(['manifest.json']);
    expect(await getDataset('monaco')).toBeUndefined();
  });

  it('proceeds when the browser cannot estimate storage (unknown quota)', async () => {
    const srv = fakeServer(MONACO_DIR);
    const rec = await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: async () => ({}) });
    expect(rec.status).toBe('complete');
  });

  it('reports data that disappeared from storage instead of returning garbage', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const db = await getDb();
    const keys = await db.getAllKeys('blobs');
    await db.delete('blobs', keys[0]);
    const results = await verifyDataset('monaco');
    expect(results.filter((r) => !r.ok).map((r) => r.reason)).toEqual(['missing']);
  });

  it('verify detects silent corruption of stored data', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const db = await getDb();
    const key = (await db.getAllKeys('blobs'))[0];
    const blob = (await db.get('blobs', key))!;
    const copy = blob.data.slice(0);
    new Uint8Array(copy)[0] ^= 0xff;
    await db.put('blobs', { ...blob, data: copy });
    const results = await verifyDataset('monaco');
    expect(results.some((r) => !r.ok && r.reason === 'checksum')).toBe(true);
  });
});

describe('updates and removal', () => {
  const est = async () => ({ quota: 1e9, usage: 0 });

  it('downloads only the changed file when a new dataset version is published', async () => {
    const v1 = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: v1.baseUrl, fetchImpl: v1.fetchImpl, estimate: est });
    const v1rec = (await getDataset('monaco'))!;
    const oldPlaces = v1rec.manifest.files.find((f) => f.name === 'places.json')!.sha256;

    const v2dir = makeVariant(MONACO_DIR, { 'places.json': (b) => Buffer.from(b.toString('utf8').replace(/^\[/, '[{"i":999999,"n":"Tempat Baru","k":"poi","c":"shop","la":43.73,"lo":7.42},')) });
    const v2 = fakeServer(v2dir);
    const rec = await installDataset({ baseUrl: v2.baseUrl, fetchImpl: v2.fetchImpl, estimate: est });
    expect(v2.requests).toEqual(['manifest.json', 'places.json']);
    expect(rec.status).toBe('complete');
    expect(rec.dataVersion).not.toBe(v1rec.dataVersion);
    expect(JSON.stringify(await readDatasetJson('monaco', 'places.json'))).toContain('Tempat Baru');
    // the superseded places blob was cleaned up
    expect((await (await getDb()).getAllKeys('blobs')).some((k) => k.endsWith(oldPlaces))).toBe(false);
  });

  it('keeps the previous version usable while a newer one fails to download', async () => {
    const v1 = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: v1.baseUrl, fetchImpl: v1.fetchImpl, estimate: est });
    const v2dir = makeVariant(MONACO_DIR, { 'places.json': (b) => Buffer.concat([b, Buffer.from(' ')]) });
    const bad = fakeServer(v2dir, { failOn: 'places.json' });
    await expect(installDataset({ baseUrl: bad.baseUrl, fetchImpl: bad.fetchImpl, estimate: est })).rejects.toThrow();
    const still = (await getDataset('monaco'))!;
    expect(still.status).toBe('complete');
    expect((await readDatasetFile('monaco', 'graph.bin')).byteLength).toBeGreaterThan(0);
  });

  it('removes a dataset and all its stored blobs', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    await removeDataset('monaco');
    expect(await listDatasets()).toEqual([]);
    expect(await (await getDb()).getAllKeys('blobs')).toEqual([]);
  });
});

describe('manifest validation', () => {
  const good = JSON.parse(readFileSync(join(MONACO_DIR, 'manifest.json'), 'utf8'));
  const withFile = (name: string) => ({ ...good, files: [{ ...good.files[0], name }] });

  it('accepts the real manifest', () => { expect(validateManifest(good).id).toBe('monaco'); });
  it.each(['../etc/passwd', 'a/b.bin', '/abs', '..', '.hidden', 'x'.repeat(80)])('rejects unsafe file name %s', (n) => {
    expect(() => validateManifest(withFile(n))).toThrow(ManifestError);
  });
  it('rejects missing attribution (ODbL requires it)', () => {
    expect(() => validateManifest({ ...good, attribution: '' })).toThrow(/attribution/);
  });
  it('rejects unknown format versions and malformed hashes', () => {
    expect(() => validateManifest({ ...good, formatVersion: 99 })).toThrow(/format/);
    expect(() => validateManifest({ ...good, files: [{ ...good.files[0], sha256: 'xyz' }] })).toThrow(/sha256/);
    expect(() => validateManifest({ ...good, id: '../x' })).toThrow(/id/);
    expect(() => validateManifest(null)).toThrow(ManifestError);
  });
});

describe('progress reporting', () => {
  it('names each file as soon as it is requested, before any of its bytes arrive', async () => {
    await resetDbForTests();
    const srv = fakeServer(MONACO_DIR);
    const events: { file: string; bytesDone: number }[] = [];
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: async () => ({ quota: 1e9, usage: 0 }),
      onProgress: (p) => events.push({ file: p.file, bytesDone: p.bytesDone }) });
    // first event for each file is the announcement, and files appear in manifest order
    const firstSeen = events.filter((e, i) => events.findIndex((x) => x.file === e.file) === i).map((e) => e.file);
    expect(firstSeen).toEqual(['graph.bin', 'ways.json', 'places.json', 'features.json', 'turns.bin']);
    expect(events[0]).toEqual({ file: 'graph.bin', bytesDone: 0 });
  });
});
