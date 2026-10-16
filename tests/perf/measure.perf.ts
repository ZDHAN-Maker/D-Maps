/**
 * Performance measurement (NOT a pass/fail test). Run with:  npm run perf
 * Prints real timings for the dataset in public/data/monaco and writes them to
 * docs/measurements/perf-monaco.json.  Numbers describe THIS machine and THIS dataset only;
 * they say nothing about Indonesian regions or mobile devices until run there.
 */
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
import { RoutingEngine, haversineM, latOf, lonOf } from '../../src/routing';
import { SearchIndex } from '../../src/search';
import { MONACO_DIR, loadDataset } from '../helpers/loadDataset';

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r2 = (n: number) => Math.round(n * 100) / 100;

it('measures load, search and route timings', () => {
  const heap0 = process.memoryUsage();
  let t = performance.now();
  const ds = loadDataset(MONACO_DIR); // includes SHA-256 verification of all files + graph parse
  const loadMs = performance.now() - t;

  t = performance.now();
  const engine = new RoutingEngine(ds.graph, { bbox: ds.manifest.bbox, turns: ds.turns });
  const engineInitMs = performance.now() - t;

  t = performance.now();
  const index = new SearchIndex(ds.places);
  const indexBuildMs = performance.now() - t;
  const heap1 = process.memoryUsage();

  // Route queries between random routable nodes (seeded => reproducible).
  const rnd = mulberry32(2026);
  const g = ds.graph;
  const connected: number[] = [];
  for (let i = 0; i < g.nodeCount; i++) if (g.first[i + 1] > g.first[i]) connected.push(i);
  const rows: { km: number; ms: number; expanded: number; ok: boolean }[] = [];
  for (let k = 0; k < 300; k++) {
    const a = connected[Math.floor(rnd() * connected.length)];
    const b = connected[Math.floor(rnd() * connected.length)];
    const from = { lat: latOf(g, a), lon: lonOf(g, a) };
    const to = { lat: latOf(g, b), lon: lonOf(g, b) };
    const res = engine.route(from, to);
    rows.push(res.ok
      ? { km: res.distanceM / 1000, ms: res.stats.computeMs, expanded: res.stats.expandedNodes, ok: true }
      : { km: haversineM(from.lat, from.lon, to.lat, to.lon) / 1000, ms: 0, expanded: 0, ok: false });
  }
  const okRows = rows.filter((r) => r.ok);

  const queries = ['casino', 'pharmacie', 'bd des moulins', 'rs', 'hotel', 'monte', 'jalan', 'zzzz'];
  const searchMs: number[] = [];
  for (let rep = 0; rep < 50; rep++) {
    for (const q of queries) {
      const s = performance.now();
      index.search(q, { near: { lat: 43.7384, lon: 7.4246 }, limit: 20 });
      searchMs.push(performance.now() - s);
    }
  }

  const report = {
    note: 'Node on a cloud VM; synthetic random node pairs; NOT a mobile or Indonesian measurement',
    node: process.version, cpu: cpus()[0]?.model, cores: cpus().length,
    dataset: { id: ds.manifest.id, dataVersion: ds.manifest.dataVersion, nodes: g.nodeCount, edges: g.edgeCount, places: ds.places.length, forbiddenTurnPairs: ds.turns?.size ?? 0, restrictedEdges: ds.turns?.restrictedCount ?? 0 },
    loadAndVerifyMs: r2(loadMs), engineInitMs: r2(engineInitMs), searchIndexBuildMs: r2(indexBuildMs),
    heapUsedDeltaMB: r2((heap1.heapUsed - heap0.heapUsed) / 1e6),
    arrayBuffersDeltaMB: r2((heap1.arrayBuffers - heap0.arrayBuffers) / 1e6),
    route: {
      queries: rows.length, routed: okRows.length, noRoute: rows.length - okRows.length,
      routeKm: { median: r2(pct(okRows.map((r) => r.km), 50)), max: r2(Math.max(...okRows.map((r) => r.km))) },
      computeMs: { p50: r2(pct(okRows.map((r) => r.ms), 50)), p95: r2(pct(okRows.map((r) => r.ms), 95)), max: r2(Math.max(...okRows.map((r) => r.ms))) },
      expandedNodes: { p50: pct(okRows.map((r) => r.expanded), 50), p95: pct(okRows.map((r) => r.expanded), 95) },
    },
    search: { queries: searchMs.length, p50Ms: r2(pct(searchMs, 50)), p95Ms: r2(pct(searchMs, 95)), maxMs: r2(Math.max(...searchMs)) },
  };
  const out = join(import.meta.dirname, '..', '..', 'docs', 'measurements');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'perf-monaco.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
});
