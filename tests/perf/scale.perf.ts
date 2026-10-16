/**
 * SYNTHETIC scale benchmark for the A* router (NOT a pass/fail test, NOT real Indonesian data).
 * Run:  npm run perf:scale      (override sizes: DMAPS_SCALE_SIDES=500,1000,2000)
 *
 * It builds a hierarchical grid road network (local 30 km/h, arterial 50, expressway 80; 3% of
 * segments removed) directly as the typed arrays the router uses, then measures end-to-end
 * RoutingEngine.route() (snap + A* + instructions) for several route lengths.
 *
 * What it can tell us: how query time, nodes expanded and memory grow with graph size for plain A*
 * with this heuristic. What it cannot: real road-network shape (real graphs have far fewer edges per
 * node and different hierarchy), real island sizes, or phone performance. Treat results as a
 * scaling curve, never as a prediction for a specific island.
 */
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { it } from 'vitest';
import { RoutingEngine, haversineM, type Graph } from '../../src/routing';

const LAT0 = -1.6, LON0 = 103.6, STEP = 0.0009; // ~100 m cells near the equator

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const r1 = (n: number) => Math.round(n * 10) / 10;

const keep = (a: number, b: number) => {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let h = Math.imul(lo, 0x9e3779b1) ^ Math.imul(hi, 0x85ebca6b);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) % 100 >= 3;
};
const speedOf = (line: number) => (line % 50 === 0 ? 80 : line % 10 === 0 ? 50 : 30);

function buildGrid(side: number): Graph {
  const W = side, n = W * W;
  const lat = new Int32Array(n), lon = new Int32Array(n);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    lat[y * W + x] = Math.round((LAT0 + y * STEP) * 1e7);
    lon[y * W + x] = Math.round((LON0 + x * STEP) * 1e7);
  }
  const hDm = Math.round(haversineM(LAT0, LON0, LAT0, LON0 + STEP) * 10);
  const vDm = Math.round(haversineM(LAT0, LON0, LAT0 + STEP, LON0) * 10);

  const first = new Uint32Array(n + 1);
  const present = (id: number, x: number, y: number, k: number): number => {
    // k: 0 west, 1 east, 2 south, 3 north -> neighbour id or -1
    if (k === 0) return x > 0 && keep(id, id - 1) ? id - 1 : -1;
    if (k === 1) return x < W - 1 && keep(id, id + 1) ? id + 1 : -1;
    if (k === 2) return y > 0 && keep(id, id - W) ? id - W : -1;
    return y < W - 1 && keep(id, id + W) ? id + W : -1;
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const id = y * W + x;
    let c = 0;
    for (let k = 0; k < 4; k++) if (present(id, x, y, k) >= 0) c++;
    first[id + 1] = first[id] + c;
  }
  const m = first[n];
  const target = new Uint32Array(m), lenDm = new Uint32Array(m), way = new Uint32Array(m);
  const speed = new Uint8Array(m), source = new Uint32Array(m);
  let e = 0;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const id = y * W + x;
    for (let k = 0; k < 4; k++) {
      const nb = present(id, x, y, k);
      if (nb < 0) continue;
      target[e] = nb; source[e] = id;
      lenDm[e] = k < 2 ? hDm : vDm;
      speed[e] = speedOf(k < 2 ? y : x);
      e++;
    }
  }
  return {
    nodeCount: n, edgeCount: m, lat, lon, first, target, lenDm, way, speed,
    cls: new Uint8Array(m), flags: new Uint8Array(m), source, ways: [[null, null]], maxSpeedKmh: 80,
  };
}

/** exact byte size graph.bin would have for this graph (mirrors parseGraph's layout check) */
const graphBinBytes = (n: number, e: number) => 32 + 8 * n + 4 * (n + 1) + 12 * e + 3 * (e + ((4 - (e % 4)) % 4));

it('measures plain-A* scaling on synthetic road grids', () => {
  const sides = (process.env.DMAPS_SCALE_SIDES ?? '500,1000,2000').split(',').map(Number);
  const targetsKm = [2, 10, 30, 80];
  const perBucket = 12;
  const results = [];

  for (const side of sides) {
    const ab0 = process.memoryUsage().arrayBuffers;
    let t = performance.now();
    const g = buildGrid(side);
    const buildMs = performance.now() - t;
    t = performance.now();
    const engine = new RoutingEngine(g);
    const engineInitMs = performance.now() - t;
    const memMB = (process.memoryUsage().arrayBuffers - ab0) / 1e6;

    const rnd = mulberry32(7 + side);
    const buckets = [];
    for (const km of targetsKm) {
      const cells = (km * 1000) / 100;
      if (side - 2 * (Math.ceil(cells) + 2) < 1) continue; // route length does not fit in this grid
      const ms: number[] = [], expanded: number[] = [], routedKm: number[] = [];
      let noRoute = 0, tried = 0;
      while (ms.length + noRoute < perBucket && tried++ < perBucket * 20) {
        const margin = Math.ceil(cells) + 2;
        if (side - 2 * margin < 1) break;
        const sx = margin + Math.floor(rnd() * (side - 2 * margin));
        const sy = margin + Math.floor(rnd() * (side - 2 * margin));
        const th = rnd() * 2 * Math.PI;
        const tx = Math.round(sx + cells * Math.cos(th)), ty = Math.round(sy + cells * Math.sin(th));
        if (tx < 0 || ty < 0 || tx >= side || ty >= side) continue;
        const res = engine.route(
          { lat: LAT0 + sy * STEP, lon: LON0 + sx * STEP }, { lat: LAT0 + ty * STEP, lon: LON0 + tx * STEP });
        if (!res.ok) { noRoute++; continue; }
        ms.push(res.stats.computeMs); expanded.push(res.stats.expandedNodes); routedKm.push(res.distanceM / 1000);
      }
      if (ms.length === 0) continue;
      buckets.push({
        targetKm: km, queries: ms.length, noRoute,
        routedKmMedian: r1(pct(routedKm, 50)),
        ms: { p50: r1(pct(ms, 50)), p95: r1(pct(ms, 95)), max: r1(Math.max(...ms)) },
        expandedNodes: { p50: pct(expanded, 50), p95: pct(expanded, 95) },
        expandedShareOfGraphPct: r1((100 * pct(expanded, 50)) / g.nodeCount),
      });
    }
    results.push({
      side, nodes: g.nodeCount, edges: g.edgeCount,
      graphBinMB: r1(graphBinBytes(g.nodeCount, g.edgeCount) / 1e6),
      routerArrayBuffersMB: r1(memMB), buildMs: Math.round(buildMs), engineInitMs: Math.round(engineInitMs), buckets,
    });
    console.log(`side ${side}: ${g.nodeCount} nodes, ${g.edgeCount} edges, arrays ${r1(memMB)} MB`);
  }

  const report = {
    note: 'SYNTHETIC hierarchical grid (4 edges/node; real road graphs have ~1.75 in Monaco). Node on a cloud VM. Not real data, not a phone.',
    node: process.version, cpu: cpus()[0]?.model, cores: cpus().length,
    network: 'local 30 km/h, every 10th line 50, every 50th line 80; 3% of segments removed; heuristic max speed 80 km/h',
    results,
  };
  const out = join(import.meta.dirname, '..', '..', 'docs', 'measurements');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'perf-synthetic-scale.json'), JSON.stringify(report, null, 2) + '\n');
}, 1_800_000);
