import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallJob, componentStatus, getDataset, installDataset, removeDataset, storageSummary, type JobSnapshot } from '../src/storage';
import { getDb, resetDbForTests } from '../src/storage/db';
import { fakeServer, makeVariant } from './helpers/fakeServer';
import { MONACO_DIR } from './helpers/loadDataset';

const est = async () => ({ quota: 1e9, usage: 0 });
const states = (log: JobSnapshot[]) => log.map((s) => s.state);

beforeEach(async () => { await resetDbForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('componentStatus', () => {
  it('reports every component missing when nothing is installed', async () => {
    const s = await componentStatus('monaco');
    expect(s.map((c) => [c.component, c.state])).toEqual([['rendering', 'missing'], ['routing', 'missing'], ['search', 'missing']]);
  });

  it('reports each component separately once installed, with real byte counts', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const s = await componentStatus('monaco');
    expect(s.every((c) => c.state === 'installed')).toBe(true);
    expect(s.find((c) => c.component === 'routing')?.files.map((f) => f.name)).toEqual(['graph.bin', 'ways.json', 'turns.bin']);
    expect(s.reduce((n, c) => n + c.bytes, 0)).toBe((await getDataset('monaco'))?.totalBytes);
  });

  it('flags a component partial when one of its files was evicted, others stay installed', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const rec = await getDataset('monaco');
    const ways = rec!.manifest.files.find((f) => f.name === 'ways.json')!;
    await (await getDb()).delete('blobs', `monaco/${ways.sha256}`);
    const s = await componentStatus('monaco');
    expect(s.find((c) => c.component === 'routing')?.state).toBe('partial');
    expect(s.find((c) => c.component === 'search')?.state).toBe('installed');
  });
});

describe('storageSummary', () => {
  it('sums stored bytes per dataset and passes the browser estimate through', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const sum = await storageSummary(async () => ({ quota: 5e9, usage: 3e6 }));
    expect(sum.quota).toBe(5e9);
    expect(sum.usage).toBe(3e6);
    expect(sum.datasetBytes.monaco).toBe((await getDataset('monaco'))?.totalBytes);
  });
  it('copes with a browser that cannot estimate', async () => {
    const sum = await storageSummary(async () => ({}));
    expect(sum.quota).toBeUndefined();
    expect(sum.datasetBytes).toEqual({});
  });
});

describe('InstallJob', () => {
  it('downloads to completion and reports progress', async () => {
    const srv = fakeServer(MONACO_DIR);
    const log: JobSnapshot[] = [];
    const job = new InstallJob('monaco', { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }, (s) => log.push(s));
    await job.start();
    expect(job.snapshot.state).toBe('done');
    expect(states(log)[0]).toBe('running');
    const last = log.filter((s) => s.state === 'running').at(-1)!;
    expect(last.bytesDone).toBe(last.bytesTotal);
    expect((await getDataset('monaco'))?.status).toBe('complete');
  });

  it('pause keeps verified files; resume downloads only what is missing', async () => {
    const ref: { job?: InstallJob } = {}; // the server hook needs the job, which needs the server
    let paused = false; // pause only the first time places.json is requested, not again on resume
    const srv = fakeServer(MONACO_DIR, { onRequest: (name) => { if (name === 'places.json' && !paused) { paused = true; void ref.job?.pause(); } } });
    const log: JobSnapshot[] = [];
    const job = ref.job = new InstallJob('monaco', { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }, (s) => log.push(s));
    await job.start();
    expect(job.snapshot.state).toBe('paused');
    const part = await getDataset('monaco');
    expect(part?.status).toBe('installing');
    expect(part?.filesDone.length).toBe(2); // graph.bin + ways.json were fully verified before the pause

    srv.requests.length = 0;
    await job.start();
    expect(job.snapshot.state).toBe('done');
    expect(srv.requests).toEqual(['manifest.json', 'places.json', 'features.json', 'turns.bin']); // nothing re-downloaded
    expect((await getDataset('monaco'))?.status).toBe('complete');
  });

  it('cancel removes everything that was stored', async () => {
    const ref: { job?: InstallJob } = {};
    const srv = fakeServer(MONACO_DIR, { onRequest: (name) => { if (name === 'features.json') void ref.job?.cancel(); } });
    const job = ref.job = new InstallJob('monaco', { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }, () => {});
    await job.start();
    await vi.waitFor(() => expect(job.snapshot.state).toBe('cancelled'));
    expect(await getDataset('monaco')).toBeUndefined();
    expect((await componentStatus('monaco')).every((c) => c.state === 'missing')).toBe(true);
    const blobs = await (await getDb()).getAllKeys('blobs');
    expect(blobs).toEqual([]);
  });

  it('a network failure marks the job failed, keeps finished files, and retry continues', async () => {
    const srv = fakeServer(MONACO_DIR, { failOn: 'features.json' });
    const job = new InstallJob('monaco', { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }, () => {});
    await job.start();
    expect(job.snapshot).toMatchObject({ state: 'failed', error: 'network' });

    const healthy = fakeServer(MONACO_DIR);
    const retry = new InstallJob('monaco', { baseUrl: healthy.baseUrl, fetchImpl: healthy.fetchImpl, estimate: est }, () => {});
    await retry.start();
    expect(retry.snapshot.state).toBe('done');
    expect(healthy.requests).toEqual(['manifest.json', 'features.json', 'turns.bin']); // only what was missing
  });

  it('classifies corruption and quota problems', async () => {
    const bad = fakeServer(MONACO_DIR, { tamper: { 'graph.bin': (b) => { const c = Buffer.from(b); c[50] ^= 1; return c; } } });
    const corrupt = new InstallJob('monaco', { baseUrl: bad.baseUrl, fetchImpl: bad.fetchImpl, estimate: est }, () => {});
    await corrupt.start();
    expect(corrupt.snapshot).toMatchObject({ state: 'failed', error: 'integrity' });
    await removeDataset('monaco');

    const ok = fakeServer(MONACO_DIR);
    const tiny = new InstallJob('monaco', { baseUrl: ok.baseUrl, fetchImpl: ok.fetchImpl, estimate: async () => ({ quota: 1000, usage: 0 }) }, () => {});
    await tiny.start();
    expect(tiny.snapshot).toMatchObject({ state: 'failed', error: 'quota' });
  });

  it('start() while running does not start a second download', async () => {
    const srv = fakeServer(MONACO_DIR);
    const job = new InstallJob('monaco', { baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est }, () => {});
    const a = job.start();
    const b = job.start();
    await Promise.all([a, b]);
    expect(srv.requests.filter((n) => n === 'manifest.json')).toHaveLength(1);
  });

  it('a newer data version downloads only changed files and keeps the old one usable meanwhile', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const v2dir = makeVariant(MONACO_DIR, { 'places.json': (b) => Buffer.concat([b.subarray(0, b.length - 1), Buffer.from(' ]')]) });
    const v2 = fakeServer(v2dir);
    const job = new InstallJob('monaco', { baseUrl: v2.baseUrl, fetchImpl: v2.fetchImpl, estimate: est }, () => {});
    await job.start();
    expect(v2.requests).toEqual(['manifest.json', 'places.json']);
    expect(job.snapshot.state).toBe('done');
  });
});
