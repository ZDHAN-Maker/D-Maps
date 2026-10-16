import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { TurnsFormatError } from '../src/routing';
import { loadRegion } from '../src/regions/load';
import { installDataset, readDatasetFile } from '../src/storage';
import { resetDbForTests } from '../src/storage/db';
import { fakeServer } from './helpers/fakeServer';
import { MONACO_DIR } from './helpers/loadDataset';

const est = async () => ({ quota: 1e9, usage: 0 });
beforeEach(async () => { await resetDbForTests(); });

/** Copy Monaco and rewrite its manifest (dataVersion recomputed from the file hashes, like the pipeline does). */
function variant(edit: (files: { name: string; bytes: number; sha256: string }[], dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'dmaps-load-'));
  cpSync(MONACO_DIR, dir, { recursive: true });
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  edit(m.files, dir);
  m.dataVersion = createHash('sha256').update(m.files.map((f: { sha256: string }) => f.sha256).join('')).digest('hex').slice(0, 12);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  return dir;
}

describe('loadRegion and turns.bin', () => {
  it('loads the shipped dataset with its turn restrictions', async () => {
    const srv = fakeServer(MONACO_DIR);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    const { runtime } = await loadRegion('monaco');
    expect(runtime.engine).toBeDefined();
    expect((await readDatasetFile('monaco', 'turns.bin')).byteLength).toBeGreaterThan(16);
  });

  it('a dataset built before turns.bin existed (not listed in its manifest) still loads and routes', async () => {
    const dir = variant((files, d) => {
      files.splice(files.findIndex((f) => f.name === 'turns.bin'), 1);
      rmSync(join(d, 'turns.bin'));
    });
    const srv = fakeServer(dir);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    expect(srv.requests).not.toContain('turns.bin');
    const { runtime } = await loadRegion('monaco');
    const res = runtime.engine.route({ lat: 43.7392, lon: 7.4285 }, { lat: 43.7378, lon: 7.4237 });
    expect(res.ok || res.code === 'NO_ROUTE').toBe(true);
  });

  it('a corrupt turns.bin (valid checksum, invalid content) fails loudly instead of silently dropping restrictions', async () => {
    const dir = variant((files, d) => {
      const bad = Buffer.from('DMTN\u0001\u0000\u0000\u0000\u0005\u0000\u0000\u0000\u0000\u0000\u0000\u0000', 'latin1'); // claims 5 pairs, has 0
      writeFileSync(join(d, 'turns.bin'), bad);
      const f = files.find((x) => x.name === 'turns.bin')!;
      f.bytes = bad.length;
      f.sha256 = createHash('sha256').update(bad).digest('hex');
    });
    const srv = fakeServer(dir);
    await installDataset({ baseUrl: srv.baseUrl, fetchImpl: srv.fetchImpl, estimate: est });
    await expect(loadRegion('monaco')).rejects.toBeInstanceOf(TurnsFormatError);
  });
});
