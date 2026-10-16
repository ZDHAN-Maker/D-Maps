import { describe, expect, it } from 'vitest';
import { Router } from '../src/routing/astar';
import { loadDataset } from './helpers/loadDataset';

// Real OSM turn-restriction relations (Monaco extract). NOT Indonesian data.
const ds = loadDataset();
const g = ds.graph;
const turns = ds.turns;

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Monaco turn restrictions', () => {
  it('turns.bin is part of the dataset and matches the manifest', () => {
    expect(turns).toBeDefined();
    expect(turns!.size).toBe(ds.manifest.stats.turnRestrictions!.pairs);
    expect(turns!.size).toBeGreaterThan(0);
    expect(ds.manifest.stats.turnRestrictions!.relationsApplied).toBeGreaterThan(0);
    expect(ds.manifest.limitations.join(' ')).toMatch(/via-way and conditional turn-restriction/);
  });

  it('no random route uses a forbidden turn', () => {
    const router = new Router(g, turns);
    const rnd = mulberry32(7);
    const routable: number[] = [];
    for (let i = 0; i < g.nodeCount; i++) if (g.first[i + 1] > g.first[i]) routable.push(i);
    let routed = 0;
    for (let k = 0; k < 400; k++) {
      const a = routable[Math.floor(rnd() * routable.length)], b = routable[Math.floor(rnd() * routable.length)];
      const p = router.route(a, b);
      if (!p) continue;
      routed++;
      for (let i = 1; i < p.edges.length; i++) {
        expect(turns!.forbidsPair(p.edges[i - 1], p.edges[i]), `route ${a}->${b} uses a forbidden turn at step ${i}`).toBe(false);
      }
    }
    expect(routed).toBeGreaterThan(300);
  });

  it('the restrictions actually change routes: the unrestricted router takes forbidden turns the restricted one avoids', () => {
    const free = new Router(g);
    const restricted = new Router(g, turns);
    let violatedWithout = 0, violatedWith = 0, longer = 0;
    for (const [a, b] of turns!.pairs()) {
      const from = g.source[a], to = g.target[b];
      const p0 = free.route(from, to), p1 = restricted.route(from, to);
      if (!p0) continue;
      if (p0.edges.some((e, i) => i > 0 && p0.edges[i - 1] === a && e === b)) violatedWithout++;
      if (p1 && p1.edges.some((e, i) => i > 0 && p1.edges[i - 1] === a && e === b)) violatedWith++;
      if (p1 && p1.distanceM > p0.distanceM + 0.5) longer++;
    }
    expect(violatedWithout, 'at least one forbidden turn is the shortest option without restrictions').toBeGreaterThan(0);
    expect(violatedWith).toBe(0);
    expect(longer).toBeGreaterThan(0); // a restriction costs something (a detour)
  });
});
