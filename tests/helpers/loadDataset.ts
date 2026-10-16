import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGraph, type WayInfo } from '../../src/routing/graph';
import { parseTurns } from '../../src/routing/turns';

export interface Manifest {
  id: string;
  dataVersion: string;
  bbox: [number, number, number, number];
  limitations: string[];
  stats: { nodes: number; edges: number; places: number; restrictionRelationsSeen: number; turnRestrictions?: { pairs: number; relationsApplied: number } };
  files: { name: string; bytes: number; sha256: string }[];
}

export const MONACO_DIR = join(import.meta.dirname, '..', '..', 'public', 'data', 'monaco');

/** Loads a built dataset from disk and verifies every file against the manifest hashes. */
export function loadDataset(dir = MONACO_DIR) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  const files = new Map<string, Buffer>();
  for (const f of manifest.files) {
    const buf = readFileSync(join(dir, f.name));
    const sha = createHash('sha256').update(buf).digest('hex');
    if (buf.length !== f.bytes || sha !== f.sha256) throw new Error(`dataset file ${f.name} fails integrity check`);
    files.set(f.name, buf);
  }
  const graphBuf = files.get('graph.bin') as Buffer;
  const ab = graphBuf.buffer.slice(graphBuf.byteOffset, graphBuf.byteOffset + graphBuf.byteLength) as ArrayBuffer;
  const ways = JSON.parse((files.get('ways.json') as Buffer).toString('utf8')) as WayInfo[];
  const places = JSON.parse((files.get('places.json') as Buffer).toString('utf8')) as Place[];
  const graph = parseGraph(ab, ways);
  const t = files.get('turns.bin');
  const turns = t ? parseTurns(t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength) as ArrayBuffer, graph) : undefined;
  return { manifest, graph, ways, places, graphBuffer: ab, turns };
}

export interface Place {
  i: number;
  n: string;
  k: 'poi' | 'street' | 'area' | 'address';
  c: string;
  la: number;
  lo: number;
  a?: string;
  em?: 'yes' | 'no';
}
