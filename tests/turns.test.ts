import { describe, expect, it } from 'vitest';
import { Router, type PathResult } from '../src/routing/astar';
import { TurnRestrictions, TurnsFormatError, parseTurns, type Graph } from '../src/routing';
import { makeGraph } from './helpers/graphBuilder';

const edgeIdx = (g: Graph, from: number, to: number): number => {
  for (let e = g.first[from]; e < g.first[from + 1]; e++) if (g.target[e] === to) return e;
  throw new Error(`no edge ${from}->${to}`);
};
const cost = (g: Graph, e: number) => g.lenDm[e] / 10 / (g.speed[e] / 3.6);
const nodesOf = (p: PathResult) => p.nodes.join('>');

function turnsFile(g: Graph, pairs: [number, number][], patch?: (dv: DataView) => void): ArrayBuffer {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const buf = new ArrayBuffer(16 + 8 * sorted.length);
  const dv = new DataView(buf);
  'DMTN'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint32(4, 1, true);
  dv.setUint32(8, sorted.length, true);
  sorted.forEach(([a, b], i) => { dv.setUint32(16 + 8 * i, a, true); dv.setUint32(20 + 8 * i, b, true); });
  patch?.(dv);
  void g;
  return buf;
}

/**
 *        N(2) ---- NE(4)
 *         |          |
 *  W(5)-- C(1) ---- E(3)
 *         |
 *        S(0)
 */
const nodes: [number, number][] = [[-0.002, 0], [0, 0], [0.002, 0], [0, 0.002], [0.002, 0.002], [0, -0.002]];
const cross = () => makeGraph(nodes, [['x', null]], [
  { from: 0, to: 1, way: 0 }, { from: 1, to: 2, way: 0 }, { from: 1, to: 3, way: 0 }, { from: 1, to: 5, way: 0 },
  { from: 2, to: 4, way: 0 }, { from: 4, to: 3, way: 0 },
]);

describe('turn restrictions in the router', () => {
  it('without restrictions the direct turn is used', () => {
    const g = cross();
    expect(nodesOf(new Router(g).route(0, 3) as PathResult)).toBe('0>1>3');
  });

  it('no_right_turn: forbids S->C->E and forces the detour around the block', () => {
    const g = cross();
    const t = TurnRestrictions.fromPairs([[edgeIdx(g, 0, 1), edgeIdx(g, 1, 3)]], g.edgeCount);
    expect(nodesOf(new Router(g, t).route(0, 3) as PathResult)).toBe('0>1>2>4>3');
  });

  it('the restriction only applies to the arrival edge it names (arriving from W, the same turn is fine)', () => {
    const g = cross();
    const t = TurnRestrictions.fromPairs([[edgeIdx(g, 0, 1), edgeIdx(g, 1, 3)]], g.edgeCount);
    expect(nodesOf(new Router(g, t).route(5, 3) as PathResult)).toBe('5>1>3');
  });

  it('only_straight_on: every other exit from the junction is forbidden, including the U-turn', () => {
    const g = cross();
    const from = edgeIdx(g, 0, 1);
    const t = TurnRestrictions.fromPairs(
      [edgeIdx(g, 1, 3), edgeIdx(g, 1, 5), edgeIdx(g, 1, 0)].map((e) => [from, e] as [number, number]), g.edgeCount);
    // Legal: continue north, turn around at N(2) and re-enter C from the north (the restriction only names
    // the arrival from S). What is NOT allowed is turning at C straight after arriving from S.
    const toE = new Router(g, t).route(0, 3) as PathResult;
    expect(nodesOf(toE)).toBe('0>1>2>1>3');
    expect(toE.edges.slice(0, 2)).not.toEqual([edgeIdx(g, 0, 1), edgeIdx(g, 1, 3)]);
    expect(nodesOf(new Router(g, t).route(0, 5) as PathResult)).toBe('0>1>2>1>5');
    // ...and without the restriction the direct turn is taken
    expect(nodesOf(new Router(g).route(0, 5) as PathResult)).toBe('0>1>5');
  });

  it('a dead end created by restrictions yields no route instead of an illegal one', () => {
    // S - C - E only, and S->C->E is forbidden
    const g = makeGraph(nodes.slice(0, 4), [['x', null]], [{ from: 0, to: 1, way: 0 }, { from: 1, to: 3, way: 0 }]);
    const t = TurnRestrictions.fromPairs([[edgeIdx(g, 0, 1), edgeIdx(g, 1, 3)]], g.edgeCount);
    expect(new Router(g, t).route(0, 3)).toBeNull();
    expect(new Router(g).route(0, 3)).not.toBeNull();
  });

  it('an empty restriction set behaves exactly like no restrictions', () => {
    const g = cross();
    const a = new Router(g).route(0, 4) as PathResult;
    const b = new Router(g, TurnRestrictions.empty(g.edgeCount)).route(0, 4) as PathResult;
    expect(nodesOf(b)).toBe(nodesOf(a));
    expect(b.cost).toBeCloseTo(a.cost, 9);
  });
});

describe('router agrees with an independent edge-based Dijkstra on random restricted grids', () => {
  function mulberry32(a: number) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Reference: shortest path where the state is the last edge. Returns Infinity if unreachable. */
  function reference(g: Graph, forbid: Set<number>, src: number, dst: number): number {
    const E = g.edgeCount;
    const dist = new Float64Array(E).fill(Infinity);
    const done = new Uint8Array(E);
    for (let e = g.first[src]; e < g.first[src + 1]; e++) dist[e] = cost(g, e);
    for (;;) {
      let a = -1, best = Infinity;
      for (let e = 0; e < E; e++) if (!done[e] && dist[e] < best) { best = dist[e]; a = e; }
      if (a < 0) break;
      done[a] = 1;
      const v = g.target[a];
      for (let b = g.first[v]; b < g.first[v + 1]; b++) {
        if (forbid.has(a * E + b)) continue;
        if (dist[a] + cost(g, b) < dist[b]) dist[b] = dist[a] + cost(g, b);
      }
    }
    let ans = Infinity;
    for (let e = 0; e < E; e++) if (g.target[e] === dst && dist[e] < ans) ans = dist[e];
    return src === dst ? 0 : ans;
  }

  it.each([1, 2, 3, 4])('seed %i: all node pairs, ~25 forbidden turns on a 6x6 grid with some one-way streets', (seed) => {
    const rnd = mulberry32(seed);
    const W = 6;
    const pts: [number, number][] = [];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) pts.push([y * 0.001, x * 0.001]);
    const edges: { from: number; to: number; way: number; twoWay?: boolean; speed?: number }[] = [];
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (x + 1 < W) edges.push({ from: i, to: i + 1, way: 0, twoWay: rnd() > 0.2, speed: 20 + Math.floor(rnd() * 40) });
      if (y + 1 < W) edges.push({ from: i, to: i + W, way: 0, twoWay: rnd() > 0.2, speed: 20 + Math.floor(rnd() * 40) });
    }
    const g = makeGraph(pts, [['x', null]], edges);
    // random forbidden turns between edges that actually meet
    const pairs: [number, number][] = [];
    while (pairs.length < 25) {
      const a = Math.floor(rnd() * g.edgeCount);
      const v = g.target[a];
      const deg = g.first[v + 1] - g.first[v];
      if (deg === 0) continue;
      const b = g.first[v] + Math.floor(rnd() * deg);
      if (!pairs.some((p) => p[0] === a && p[1] === b)) pairs.push([a, b]);
    }
    const turns = TurnRestrictions.fromPairs(pairs, g.edgeCount);
    const forbid = new Set(pairs.map(([a, b]) => a * g.edgeCount + b));
    const router = new Router(g, turns);

    let compared = 0, unreachable = 0;
    for (let s = 0; s < g.nodeCount; s++) for (let d = 0; d < g.nodeCount; d++) {
      const ref = reference(g, forbid, s, d);
      const got = router.route(s, d);
      if (ref === Infinity) {
        expect(got, `${s}->${d} should be unreachable`).toBeNull();
        unreachable++;
        continue;
      }
      expect(got, `${s}->${d} should be reachable`).not.toBeNull();
      const p = got as PathResult;
      expect(p.cost).toBeCloseTo(ref, 6);
      for (let k = 1; k < p.edges.length; k++) {
        expect(forbid.has(p.edges[k - 1] * g.edgeCount + p.edges[k]), `${s}->${d} uses a forbidden turn`).toBe(false);
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(500);
    void unreachable;
  });
});

describe('TurnRestrictions / parseTurns', () => {
  const g = cross();
  const good: [number, number][] = [[edgeIdx(g, 0, 1), edgeIdx(g, 1, 3)], [edgeIdx(g, 0, 1), edgeIdx(g, 1, 5)]];

  it('round-trips a valid file', () => {
    const t = parseTurns(turnsFile(g, good), g);
    expect(t.size).toBe(2);
    expect(t.restrictedCount).toBe(1);
    expect(t.pairs()).toEqual([...good].sort((a, b) => a[1] - b[1]));
    expect(t.forbidsPair(good[0][0], good[0][1])).toBe(true);
    expect(t.forbidsPair(good[0][1], good[0][0])).toBe(false);
  });

  it('rejects bad magic, bad version, wrong size', () => {
    expect(() => parseTurns(turnsFile(g, good, (dv) => dv.setUint8(0, 0x58)), g)).toThrow(/magic/);
    expect(() => parseTurns(turnsFile(g, good, (dv) => dv.setUint32(4, 9, true)), g)).toThrow(/version/);
    expect(() => parseTurns(turnsFile(g, good).slice(0, 20), g)).toThrow(/size mismatch/);
    expect(() => parseTurns(new ArrayBuffer(4), g)).toThrow(TurnsFormatError);
  });

  it('rejects pairs that point outside the graph or whose edges do not meet', () => {
    expect(() => parseTurns(turnsFile(g, [[0, g.edgeCount + 5]]), g)).toThrow(/missing edge/);
    // edge 0->1 followed by an edge that does not start at node 1
    const notAdjacent: [number, number][] = [[edgeIdx(g, 0, 1), edgeIdx(g, 2, 4)]];
    expect(() => parseTurns(turnsFile(g, notAdjacent), g)).toThrow(/do not meet/);
  });

  it('rejects unsorted or duplicate pairs', () => {
    const [a, b] = good;
    expect(() => parseTurns(turnsFile(g, [a, a]), g)).toThrow(/sorted/);
    const reversed = turnsFile(g, [a, b], (dv) => { const x = dv.getUint32(16, true), y = dv.getUint32(20, true); dv.setUint32(16, dv.getUint32(24, true), true); dv.setUint32(20, dv.getUint32(28, true), true); dv.setUint32(24, x, true); dv.setUint32(28, y, true); });
    expect(() => parseTurns(reversed, g)).toThrow(/sorted/);
  });
});
