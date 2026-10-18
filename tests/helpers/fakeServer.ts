import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeServerOptions {
  /** mutate the bytes served for a file (corruption / truncation) */
  tamper?: Record<string, (b: Buffer) => Buffer>;
  /** throw a network error when this file is requested */
  failOn?: string;
  /** called for each request, after the check above */
  onRequest?: (name: string) => void;
}

/** A fetch() stand-in that serves a dataset directory and records which files were requested. */
export function fakeServer(dir: string, opts: FakeServerOptions = {}) {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = url.split('?')[0];
    const name = pathname.split('/').pop() as string;
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    requests.push(name);
    opts.onRequest?.(name);
    if (opts.failOn === name) throw new TypeError('Failed to fetch (simulated network loss)');
    let buf: Buffer;
    try { buf = readFileSync(join(dir, name)); } catch { return new Response('not found', { status: 404 }); }
    if (opts.tamper?.[name]) buf = opts.tamper[name](buf);
    return new Response(new Uint8Array(buf), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requests, baseUrl: '/data/test' };
}

/** Copy a dataset dir and rewrite selected files + the manifest (sha256, bytes, dataVersion). */
export function makeVariant(srcDir: string, mutate: Record<string, (b: Buffer) => Buffer>): string {
  const out = mkdtempSync(join(tmpdir(), 'dmaps-variant-'));
  cpSync(srcDir, out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  for (const f of manifest.files) {
    if (!mutate[f.name]) continue;
    const buf = mutate[f.name](readFileSync(join(out, f.name)));
    writeFileSync(join(out, f.name), buf);
    f.bytes = buf.length;
    f.sha256 = createHash('sha256').update(buf).digest('hex');
  }
  manifest.dataVersion = createHash('sha256').update(manifest.files.map((f: { sha256: string }) => f.sha256).join('')).digest('hex').slice(0, 12);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
  return out;
}

export const listFiles = (dir: string) => readdirSync(dir).sort();
