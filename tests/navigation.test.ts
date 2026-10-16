import { beforeAll, describe, expect, it } from 'vitest';
import { RoutingEngine, haversineM, type RouteResult, type Step } from '../src/routing';
import { NavigationSession, type Fix, type NavState } from '../src/navigation/tracker';
import { routeFixes } from '../src/gps';
import { loadDataset } from './helpers/loadDataset';

const M_PER_DEG = 111_194.9;
const step = (over: Partial<Step>): Step => ({
  type: 'turn', name: null, ref: null, distanceM: 0, durationS: 0, location: [0, 0], geometryIndex: 0, bearingAfter: 0, ...over,
});

/** Straight 1.1 km east-west route on the equator, a point every ~100 m, with one turn in the middle. */
function syntheticRoute() {
  const geometry: [number, number][] = Array.from({ length: 12 }, (_, i) => [0, (i * 100) / M_PER_DEG]);
  const steps: Step[] = [
    step({ type: 'depart', geometryIndex: 0, distanceM: 600, durationS: 60 }),
    step({ type: 'turn', modifier: 'left', geometryIndex: 6, distanceM: 500, durationS: 50 }),
    step({ type: 'arrive', geometryIndex: 11 }),
  ];
  return { geometry, steps };
}
const at = (alongM: number, northM = 0, accuracyM = 5, t = 0): Fix => ({
  lat: northM / M_PER_DEG, lon: alongM / M_PER_DEG, accuracyM, timestamp: 1_700_000_000_000 + t * 1000,
});

describe('NavigationSession on a synthetic route', () => {
  it('reports progress, the next maneuver, and remaining distance/time', () => {
    const s = new NavigationSession(syntheticRoute());
    const a = s.update(at(0));
    expect(a.status).toBe('on_route');
    expect(a.nextStep?.type).toBe('turn');
    expect(a.distanceToManeuverM).toBeCloseTo(600, -1);
    expect(a.remainingM).toBeCloseTo(1100, -1);
    expect(a.remainingS).toBeCloseTo(110, 0);

    const b = s.update(at(450));
    expect(b.distanceToManeuverM).toBeCloseTo(150, -1);
    expect(b.nextStep?.type).toBe('turn');

    const c = s.update(at(700));
    expect(c.stepIndex).toBe(1);
    expect(c.nextStep?.type).toBe('arrive');
    expect(c.distanceToManeuverM).toBeCloseTo(400, -1);
    expect(c.remainingS).toBeLessThan(b.remainingS);
  });

  it('arrives near the end and stays arrived', () => {
    const s = new NavigationSession(syntheticRoute());
    s.update(at(900));
    expect(s.update(at(1050)).status).toBe('on_route'); // 50 m short: not yet
    const done = s.update(at(1095, 3));
    expect(done.status).toBe('arrived');
    expect(done.remainingM).toBe(0);
    expect(done.nextStep).toBeNull();
    expect(s.update(at(1095, 500)).status).toBe('arrived'); // latched: noise afterwards cannot "un-arrive"
  });

  it('needs several consecutive off-route fixes before asking for a reroute', () => {
    const s = new NavigationSession(syntheticRoute());
    s.update(at(300));
    const states: NavState[] = [at(320, 120), at(330, 120), at(340, 120)].map((f) => s.update(f));
    expect(states.map((x) => x.status)).toEqual(['on_route', 'on_route', 'off_route']);
    expect(states[2].offRouteM).toBeGreaterThan(100);
    // rejoining the route clears the condition
    expect(s.update(at(360, 2)).status).toBe('on_route');
  });

  it('ignores a single GPS blip', () => {
    const s = new NavigationSession(syntheticRoute());
    s.update(at(200));
    s.update(at(210, 300));
    const back = s.update(at(220));
    expect(back.status).toBe('on_route');
    expect(back.alongM).toBeCloseTo(220, -1);
    // an off-route blip must not move the progress marker
    s.update(at(230, 300));
    expect(s.update(at(240)).alongM).toBeCloseTo(240, -1);
  });

  it('widens the off-route tolerance when the GPS accuracy is poor', () => {
    const sharp = new NavigationSession(syntheticRoute());
    const sloppy = new NavigationSession(syntheticRoute());
    const f = (acc: number) => at(300, 45, acc);
    for (let i = 0; i < 3; i++) { sharp.update(f(5)); sloppy.update(f(40)); }
    expect(sharp.update(f(5)).status).toBe('off_route');
    expect(sloppy.update(f(40)).status).toBe('on_route');
  });

  it('never moves progress backwards because of noise', () => {
    const s = new NavigationSession(syntheticRoute());
    s.update(at(500));
    expect(s.update(at(485)).alongM).toBeGreaterThanOrEqual(500);
  });

  it('accepts a real jump forward along the route but not a jump to somewhere else', () => {
    const s = new NavigationSession(syntheticRoute(), { lookAheadM: 300 });
    s.update(at(50));
    expect(s.update(at(800)).alongM).toBeCloseTo(800, -1); // outside the window, but exactly on the route
  });
});

describe('NavigationSession following a real offline route (Monaco)', () => {
  const ds = loadDataset();
  let route: RouteResult;
  beforeAll(() => {
    const engine = new RoutingEngine(ds.graph, { bbox: ds.manifest.bbox });
    const r = engine.route({ lat: 43.73926, lon: 7.428548 }, { lat: 43.737776, lon: 7.423681 });
    if (!r.ok) throw new Error(`fixture route failed: ${r.code}`);
    route = r;
  });

  it('follows noisy GPS from start to arrival without false off-route alarms', () => {
    const fixes = routeFixes(route.geometry, { speedMps: 6, intervalS: 1, noiseM: 6, accuracyM: 8, seed: 7 });
    expect(fixes.length).toBeGreaterThan(20);
    const s = new NavigationSession(route);
    const states = fixes.map((f) => s.update(f));

    expect(states.some((x) => x.status === 'off_route')).toBe(false);
    expect(states[states.length - 1].status).toBe('arrived');
    for (let i = 1; i < states.length; i++) {
      expect(states[i].alongM).toBeGreaterThanOrEqual(states[i - 1].alongM);
      expect(states[i].stepIndex).toBeGreaterThanOrEqual(states[i - 1].stepIndex);
      expect(states[i].remainingM).toBeLessThanOrEqual(states[i - 1].remainingM + 1e-6);
    }
    // the next maneuver advances through the route's own instruction list, in order
    const seen = [...new Set(states.map((x) => x.stepIndex))];
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(route.steps.length - 1);
    const skipped = route.steps.length - seen.length;
    const tooClose = route.steps.filter((_st, i) => i > 0 && route.steps[i - 1].distanceM < 8).length;
    expect(skipped).toBeLessThanOrEqual(tooClose);
  });

  it('starts with remaining distance matching the routed distance', () => {
    const s = new NavigationSession(route);
    const first = s.update({ lat: route.geometry[0][0], lon: route.geometry[0][1], accuracyM: 5, timestamp: 0 });
    expect(Math.abs(first.remainingM - route.distanceM) / route.distanceM).toBeLessThan(0.02);
    expect(first.nextStep).toBe(route.steps[1]);
  });

  it('detects leaving the route toward a different street (far from every route point)', () => {
    const s = new NavigationSession(route);
    const far = { lat: route.geometry[0][0] + 0.004, lon: route.geometry[0][1] + 0.004 }; // ~600 m away
    const fixes = routeFixes([[far.lat, far.lon], [far.lat + 0.0002, far.lon]], { intervalS: 1, speedMps: 8 });
    let last: NavState | null = null;
    for (const f of fixes) last = s.update(f);
    expect(haversineM(far.lat, far.lon, route.geometry[0][0], route.geometry[0][1])).toBeGreaterThan(300);
    expect(last?.status).toBe('off_route');
  });
});
