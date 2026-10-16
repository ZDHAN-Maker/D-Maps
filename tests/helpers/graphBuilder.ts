import { type Graph, type WayInfo } from '../../src/routing/graph';
import { haversineM } from '../../src/routing/geo';

export interface TestEdge {
  from: number;
  to: number;
  way: number;
  speed?: number;
  flags?: number;
  /** add the reverse edge as well (default true) */
  twoWay?: boolean;
}

/** Builds an in-memory Graph from coordinates and edges so routing logic can be tested exactly. */
export function makeGraph(nodes: [number, number][], ways: WayInfo[], edges: TestEdge[]): Graph {
  const directed: { from: number; to: number; way: number; speed: number; flags: number; dm: number }[] = [];
  for (const e of edges) {
    const dm = Math.max(1, Math.round(haversineM(nodes[e.from][0], nodes[e.from][1], nodes[e.to][0], nodes[e.to][1]) * 10));
    const base = { way: e.way, speed: e.speed ?? 30, flags: e.flags ?? 0, dm };
    directed.push({ from: e.from, to: e.to, ...base });
    if (e.twoWay !== false) directed.push({ from: e.to, to: e.from, ...base });
  }
  directed.sort((a, b) => a.from - b.from || a.to - b.to);
  const n = nodes.length;
  const first = new Uint32Array(n + 1);
  for (const d of directed) first[d.from + 1]++;
  for (let i = 0; i < n; i++) first[i + 1] += first[i];
  const m = directed.length;
  return {
    nodeCount: n, edgeCount: m,
    lat: Int32Array.from(nodes, (p) => Math.round(p[0] * 1e7)),
    lon: Int32Array.from(nodes, (p) => Math.round(p[1] * 1e7)),
    first,
    target: Uint32Array.from(directed, (d) => d.to),
    lenDm: Uint32Array.from(directed, (d) => d.dm),
    way: Uint32Array.from(directed, (d) => d.way),
    speed: Uint8Array.from(directed, (d) => d.speed),
    cls: new Uint8Array(m),
    flags: Uint8Array.from(directed, (d) => d.flags),
    source: Uint32Array.from(directed, (d) => d.from),
    ways,
    maxSpeedKmh: Math.max(1, ...directed.map((d) => d.speed)),
  };
}
