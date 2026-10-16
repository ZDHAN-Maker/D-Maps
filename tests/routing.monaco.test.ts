import { beforeAll, describe, expect, it } from 'vitest';
import { RoutingEngine, FLAG_ONEWAY, FLAG_DESTINATION, haversineM, latOf, lonOf, type RouteResult } from '../src/routing';
import { DESTINATION_PENALTY } from '../src/routing/astar';
import { loadDataset } from './helpers/loadDataset';

// Real OpenStreetMap data (Monaco test extract). Validates the engine against real-world
// topology: one-ways, roundabouts, ramps, access restrictions.  NOT Indonesian data.
const ds = loadDataset();
const g = ds.graph;
let engine: RoutingEngine;

// deterministic PRNG so failures are reproducible
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeAll(() => {
  engine = new RoutingEngine(g, { bbox: ds.manifest.bbox });
});

describe('dataset integrity', () => {
  it('matches manifest counts and declares known limitations', () => {
    expect(g.nodeCount).toBe(ds.manifest.stats.nodes);
    expect(g.edgeCount).toBe(ds.manifest.stats.edges);
    expect(ds.manifest.limitations.join(' ')).toMatch(/turn-restriction/);
    expect(ds.manifest.stats.restrictionRelationsSeen).toBeGreaterThan(0);
  });

  it('rejects a corrupted graph file', async () => {
    const { parseGraph } = await import('../src/routing/graph');
    const bad = ds.graphBuffer.slice(0, ds.graphBuffer.byteLength - 8);
    expect(() => parseGraph(bad, ds.ways)).toThrow(/size mismatch/);
    const wrongMagic = ds.graphBuffer.slice(0);
    new Uint8Array(wrongMagic)[0] = 0x58;
    expect(() => parseGraph(wrongMagic, ds.ways)).toThrow(/magic/);
  });

  it('never has a reverse edge on the same way for one-way edges', () => {
    let oneWayEdges = 0;
    for (let e = 0; e < g.edgeCount; e++) {
      if (!(g.flags[e] & FLAG_ONEWAY)) continue;
      oneWayEdges++;
      const a = g.source[e], b = g.target[e];
      for (let r = g.first[b]; r < g.first[b + 1]; r++) {
        if (g.target[r] === a && g.way[r] === g.way[e]) {
          throw new Error(`one-way edge ${a}->${b} (way ${g.way[e]}) has a reverse edge`);
        }
      }
    }
    expect(oneWayEdges).toBeGreaterThan(1000); // Monaco is full of one-way streets
  });
});

describe('A* correctness against a reference Dijkstra', () => {
  function dijkstraCost(src: number, dst: number): number {
    const dist = new Float64Array(g.nodeCount).fill(Infinity);
    const done = new Uint8Array(g.nodeCount);
    dist[src] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < g.nodeCount; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === dst) break;
      done[u] = 1;
      for (let e = g.first[u]; e < g.first[u + 1]; e++) {
        let c = g.lenDm[e] / 10 / (g.speed[e] / 3.6);
        if (g.flags[e] & FLAG_DESTINATION) c *= DESTINATION_PENALTY;
        if (dist[u] + c < dist[g.target[e]]) dist[g.target[e]] = dist[u] + c;
      }
    }
    return dist[dst];
  }

  it('finds optimal-cost paths on 25 random node pairs', async () => {
    const { Router } = await import('../src/routing/astar');
    const router = new Router(g);
    const rnd = mulberry32(42);
    let checked = 0;
    for (let i = 0; i < 80 && checked < 25; i++) {
      const a = Math.floor(rnd() * g.nodeCount), b = Math.floor(rnd() * g.nodeCount);
      const ref = dijkstraCost(a, b);
      const got = router.route(a, b);
      if (!Number.isFinite(ref)) { expect(got).toBeNull(); continue; }
      expect(got).not.toBeNull();
      expect(got!.cost).toBeCloseTo(ref, 6);
      checked++;
    }
    expect(checked).toBe(25);
  }, 60_000);
});

describe('real-world routes', () => {
  const casino = { lat: 43.73926, lon: 7.428548 };          // Casino de Monte Carlo
  const capDail = { lat: 43.720623, lon: 7.394386 };        // Gare de Cap d'Ail

  it('routes between two known places with plausible figures', () => {
    const r = engine.route(casino, capDail) as RouteResult;
    expect(r.ok).toBe(true);
    const straight = haversineM(casino.lat, casino.lon, capDail.lat, capDail.lon);
    expect(r.distanceM).toBeGreaterThanOrEqual(straight);
    expect(r.distanceM).toBeLessThan(straight * 3);
    expect(r.durationS).toBeGreaterThan(30);
    expect(r.durationS).toBeLessThan(3600);
    expect(r.snapped.from.offsetM).toBeLessThan(100);
    expect(r.steps[0].type).toBe('depart');
    expect(r.steps.at(-1)!.type).toBe('arrive');
    expect(r.steps.reduce((s, x) => s + x.distanceM, 0)).toBeCloseTo(r.distanceM, 1);
  });

  it('is asymmetric in the presence of one-way streets and still valid both ways', () => {
    const ab = engine.route(casino, capDail) as RouteResult;
    const ba = engine.route(capDail, casino) as RouteResult;
    expect(ab.ok && ba.ok).toBe(true);
    expect(ab.distanceM).not.toBeCloseTo(ba.distanceM, 0);
  });

  it('is deterministic', () => {
    const a = engine.route(casino, capDail) as RouteResult;
    const b = engine.route(casino, capDail) as RouteResult;
    expect(b.geometry).toEqual(a.geometry);
    expect(b.steps).toEqual(a.steps);
  });

  it('refuses points in the sea / outside the data rather than inventing a route', () => {
    expect(engine.route({ lat: 43.5, lon: 7.4 }, casino)).toEqual({ ok: false, code: 'OUTSIDE_DATASET' });
    // inside the bbox but in open water, far from any road
    const sea = engine.route({ lat: 43.7149, lon: 7.4900 }, casino);
    expect(sea.ok).toBe(false);
  });

  it('keeps step invariants over 300 random routes (incl. roundabouts and ramps)', () => {
    const rnd = mulberry32(7);
    const seen: Record<string, number> = {};
    let totalSteps = 0;
    let routes = 0, msTotal = 0, msMax = 0, endedInRoundabout = 0;
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rnd() * g.nodeCount), b = Math.floor(rnd() * g.nodeCount);
      const r = engine.route({ lat: latOf(g, a), lon: lonOf(g, a) }, { lat: latOf(g, b), lon: lonOf(g, b) });
      if (!r.ok) continue;
      routes++;
      totalSteps += r.steps.length;
      msTotal += r.stats.computeMs; msMax = Math.max(msMax, r.stats.computeMs);
      expect(r.steps[0].type).toBe('depart');
      expect(r.steps.at(-1)!.type).toBe('arrive');
      expect(r.steps.reduce((s, x) => s + x.distanceM, 0)).toBeCloseTo(r.distanceM, 1);
      let prevIdx = -1;
      r.steps.forEach((s, k) => {
        seen[s.type] = (seen[s.type] ?? 0) + 1;
        expect(s.distanceM).toBeGreaterThanOrEqual(0);
        expect(s.geometryIndex).toBeGreaterThanOrEqual(prevIdx);
        prevIdx = s.geometryIndex;
        if (s.type === 'roundabout') {
          if (s.exit === undefined) {
            // only allowed when the route ends on the ring
            expect(r.steps[k + 1].type).toBe('arrive');
            endedInRoundabout++;
          } else {
            expect(s.exit).toBeGreaterThanOrEqual(1);
            expect(s.exit).toBeLessThanOrEqual(8);
            expect(r.steps[k + 1].type).toBe('exit_roundabout');
          }
        }
        if (s.type === 'turn') expect(['left', 'right', 'sharp_left', 'sharp_right']).toContain(s.modifier);
      });
    }
    expect(routes).toBeGreaterThan(150);
    // measured, not asserted as a benchmark: logged for docs/performance.md
    console.log(`[perf] monaco routes=${routes} stepsPerRoute=${(totalSteps / routes).toFixed(1)} endedInRoundabout=${endedInRoundabout} meanMs=${(msTotal / routes).toFixed(2)} maxMs=${msMax.toFixed(2)} stepTypes=${JSON.stringify(seen)}`);
    expect(seen.roundabout ?? 0).toBeGreaterThan(0);   // the data really exercises roundabouts
    expect(seen.turn ?? 0).toBeGreaterThan(0);
  }, 120_000);
});
