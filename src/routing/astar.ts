import { FLAG_DESTINATION, type Graph, latOf, lonOf } from './graph';
import { haversineM } from './geo';
import type { TurnRestrictions } from './turns';

export interface PathResult {
  nodes: number[];
  edges: number[];
  /** search cost in seconds, including preference penalties (what A* minimises) */
  cost: number;
  /** real travel time in seconds (no preference penalties) */
  durationS: number;
  distanceM: number;
  /** nodes settled — a cheap performance indicator */
  expanded: number;
}

/** Multiplier applied to access=destination-only roads: usable, but only if worth it. */
export const DESTINATION_PENALTY = 4;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  /** removes the smallest entry and returns its value */
  pop(): number {
    const k = this.keys, v = this.vals;
    const topVal = v[0];
    const key = k.pop() as number;
    const val = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return topVal;
  }
}

/**
 * A* over the CSR graph with a haversine / max-speed heuristic (admissible because every
 * edge cost >= length / maxSpeed). Scratch arrays are reused across queries via generation
 * stamps so a query costs O(settled states), not O(graph size).
 *
 * Search states are graph nodes, plus one extra state per *restricted* incoming edge when turn
 * restrictions are supplied: arriving over such an edge may forbid some outgoing edges, so those
 * arrivals cannot share their node's state. Arrivals over any other edge share it (exactly).
 */
export class Router {
  private readonly cost: Float64Array;
  private readonly prevEdge: Int32Array;
  private readonly prevState: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 0;

  constructor(readonly g: Graph, readonly turns?: TurnRestrictions) {
    const states = g.nodeCount + (turns?.restrictedCount ?? 0);
    this.cost = new Float64Array(states);
    this.prevEdge = new Int32Array(states);
    this.prevState = new Int32Array(states);
    this.stamp = new Uint32Array(states);
    this.closed = new Uint32Array(states);
  }

  route(src: number, dst: number): PathResult | null {
    const g = this.g;
    if (src === dst) return { nodes: [src], edges: [], cost: 0, durationS: 0, distanceM: 0, expanded: 0 };
    const gen = ++this.gen;
    const N = g.nodeCount;
    const turns = this.turns && this.turns.size > 0 ? this.turns : undefined;
    const maxMs = g.maxSpeedKmh / 3.6;
    const dLat = latOf(g, dst), dLon = lonOf(g, dst);
    const h = (n: number) => haversineM(latOf(g, n), lonOf(g, n), dLat, dLon) / maxMs;

    const heap = new MinHeap();
    this.cost[src] = 0; this.stamp[src] = gen; this.prevEdge[src] = -1; this.prevState[src] = -1;
    heap.push(h(src), src);
    let expanded = 0;

    while (heap.size > 0) {
      const s = heap.pop();
      if (this.closed[s] === gen) continue;
      this.closed[s] = gen;
      expanded++;
      const rank = s < N ? -1 : s - N;
      const u = s < N ? s : g.target[(turns as TurnRestrictions).edgeOfRank[rank]];
      if (u === dst) return this.backtrack(s, expanded, this.cost[s]);
      const gu = this.cost[s];
      for (let e = g.first[u]; e < g.first[u + 1]; e++) {
        if (rank >= 0 && (turns as TurnRestrictions).forbids(rank, e)) continue;
        const v = g.target[e];
        const r = turns ? turns.rank(e) : -1;
        const t = r >= 0 ? N + r : v;
        if (this.closed[t] === gen) continue;
        let c = g.lenDm[e] / 10 / (g.speed[e] / 3.6);
        if (g.flags[e] & FLAG_DESTINATION) c *= DESTINATION_PENALTY;
        const nv = gu + c;
        if (this.stamp[t] !== gen || nv < this.cost[t]) {
          this.stamp[t] = gen; this.cost[t] = nv; this.prevEdge[t] = e; this.prevState[t] = s;
          heap.push(nv + h(v), t);
        }
      }
    }
    return null;
  }

  private backtrack(goal: number, expanded: number, cost: number): PathResult {
    const g = this.g;
    const edges: number[] = [];
    for (let s = goal; this.prevEdge[s] !== -1; s = this.prevState[s]) edges.push(this.prevEdge[s]);
    edges.reverse();
    const nodes = [edges.length > 0 ? g.source[edges[0]] : g.source[0]];
    let durationS = 0, distanceM = 0;
    for (const e of edges) {
      nodes.push(g.target[e]);
      const m = g.lenDm[e] / 10;
      distanceM += m;
      durationS += m / (g.speed[e] / 3.6);
    }
    return { nodes, edges, cost, durationS, distanceM, expanded };
  }
}
