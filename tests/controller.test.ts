import { beforeAll, describe, expect, it } from 'vitest';
import { RoutingEngine, haversineM, type RouteResult } from '../src/routing';
import { NavigationController, type NavEvent } from '../src/navigation';
import { SimulatedGps, routeFixes, type GpsProvider } from '../src/gps';
import { loadDataset } from './helpers/loadDataset';

const ds = loadDataset();
const CASINO = { lat: 43.73926, lon: 7.428548 };
const BALMORAL = { lat: 43.737776, lon: 7.423681 };
const CAP_ESTEL = { lat: 43.718405, lon: 7.374079 }; // far to the south-west: a detour waypoint

const nullGps: GpsProvider = { kind: 'simulated', start() {}, stop() {} };
let engine: RoutingEngine;
let planned: RouteResult;

beforeAll(() => {
  engine = new RoutingEngine(ds.graph, { bbox: ds.manifest.bbox });
  const r = engine.route(CASINO, BALMORAL);
  if (!r.ok) throw new Error(`fixture route failed: ${r.code}`);
  planned = r;
});

function run(path: [number, number][], opts: { router?: { route: RoutingEngine['route'] }; noiseM?: number } = {}) {
  const events: NavEvent[] = [];
  const ctl = new NavigationController({
    route: planned, destination: BALMORAL, router: (opts.router ?? engine) as RoutingEngine, gps: nullGps, onEvent: (e) => events.push(e),
  });
  for (const f of routeFixes(path, { speedMps: 8, noiseM: opts.noiseM ?? 0, accuracyM: 6, seed: 11 })) ctl.ingest(f);
  return { ctl, events };
}

describe('NavigationController', () => {
  it('follows the planned route to arrival with no reroute and a truthful summary', () => {
    const { events } = run(planned.geometry, { noiseM: 4 });
    expect(events.some((e) => e.type === 'rerouting')).toBe(false);
    const arrived = events.find((e): e is Extract<NavEvent, { type: 'arrived' }> => e.type === 'arrived');
    expect(arrived).toBeDefined();
    const s = arrived!.summary;
    expect(s.arrived).toBe(true);
    expect(s.reroutes).toBe(0);
    expect(s.plannedDistanceM).toBeCloseTo(planned.distanceM, 3);
    expect(s.drivenDistanceM).toBeGreaterThan(planned.distanceM * 0.95);
    expect(s.drivenDistanceM).toBeLessThan(planned.distanceM * 1.25); // noise inflates it a little
    expect(s.elapsedS).toBeGreaterThan(10);
  });

  it('announces each upcoming maneuver in order while following the route', () => {
    const { events } = run(planned.geometry);
    const nexts: number[] = [];
    for (const e of events) {
      if (e.type !== 'state' || !e.state.nextStep) continue;
      const idx = planned.steps.indexOf(e.state.nextStep);
      if (nexts[nexts.length - 1] !== idx) nexts.push(idx);
    }
    expect(nexts[0]).toBe(1);
    expect(nexts[nexts.length - 1]).toBe(planned.steps.length - 1); // finally: "arrive"
    expect([...nexts].sort((a, b) => a - b)).toEqual(nexts);       // never goes back
  });

  it('leaves the route, reroutes offline once, then the driver follows the new route to arrival', () => {
    // drive the first part of the plan, then take a detour toward a far waypoint
    const cut = Math.floor(planned.geometry.length * 0.3);
    const head = planned.geometry.slice(0, cut + 1);
    const mid = { lat: head[cut][0], lon: head[cut][1] };
    const toWaypoint = engine.route(mid, CAP_ESTEL);
    expect(toWaypoint.ok).toBe(true);
    if (!toWaypoint.ok) return;
    const detour = toWaypoint.geometry.slice(0, 60);
    expect(haversineM(detour[detour.length - 1][0], detour[detour.length - 1][1], mid.lat, mid.lon)).toBeGreaterThan(150);

    const events: NavEvent[] = [];
    const ctl = new NavigationController({
      route: planned, destination: BALMORAL, router: engine, gps: nullGps, onEvent: (e) => events.push(e),
    });
    let lastTs = 0;
    for (const f of routeFixes([...head, ...detour], { speedMps: 8, accuracyM: 6, seed: 5 })) {
      ctl.ingest(f);
      lastTs = f.timestamp;
      if (events.some((e) => e.type === 'rerouted')) break; // the driver now obeys the new route
    }
    const reroute = events.find((e) => e.type === 'rerouted') as Extract<NavEvent, { type: 'rerouted' }> | undefined;
    expect(reroute, 'a reroute must happen once the driver is clearly off the route').toBeDefined();
    const newRoute = reroute!.route;
    expect(ctl.currentRoute).toBe(newRoute);
    expect(events.filter((e) => e.type === 'rerouting')).toHaveLength(1);

    // follow the new route from where the reroute started
    for (const f of routeFixes(newRoute.geometry, { speedMps: 8, accuracyM: 6, noiseM: 3, seed: 6, startTime: lastTs + 1000 })) ctl.ingest(f);

    const arrived = events.find((e): e is Extract<NavEvent, { type: 'arrived' }> => e.type === 'arrived');
    expect(arrived?.summary.arrived).toBe(true);
    expect(arrived!.summary.reroutes, 'obeying the new route must not cause another reroute').toBe(1);
  });

  it('keeps recalculating (rate-limited) while the driver keeps ignoring the route', () => {
    const cut = Math.floor(planned.geometry.length * 0.3);
    const head = planned.geometry.slice(0, cut + 1);
    const toWaypoint = engine.route({ lat: head[cut][0], lon: head[cut][1] }, CAP_ESTEL);
    if (!toWaypoint.ok) throw new Error('fixture detour failed');
    const events: NavEvent[] = [];
    const ctl = new NavigationController({
      route: planned, destination: BALMORAL, router: engine, gps: nullGps, onEvent: (e) => events.push(e), minRerouteIntervalMs: 5000,
    });
    const fixes = routeFixes([...head, ...toWaypoint.geometry.slice(0, 60)], { speedMps: 8, accuracyM: 6, seed: 5 });
    for (const f of fixes) ctl.ingest(f);
    const times = events.filter((e): e is Extract<NavEvent, { type: 'rerouting' }> => e.type === 'rerouting').map((e) => e.fix.timestamp);
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5000);
  });

  it('reports reroute_failed (and keeps the old route) when the local data cannot reroute', () => {
    const events: NavEvent[] = [];
    const broken = { route: () => ({ ok: false as const, code: 'NO_ROUTE' as const }) };
    const ctl = new NavigationController({
      route: planned, destination: BALMORAL, router: broken, gps: nullGps, onEvent: (e) => events.push(e),
    });
    const far: [number, number][] = [[43.745, 7.45], [43.7455, 7.45]]; // nowhere near the route
    for (const f of routeFixes(far, { speedMps: 5, accuracyM: 5 })) ctl.ingest(f);
    expect(events.some((e) => e.type === 'reroute_failed')).toBe(true);
    expect(events.some((e) => e.type === 'rerouted')).toBe(false);
    expect(ctl.currentRoute).toBe(planned);
  });

  it('does not hammer the router: attempts are spaced by the minimum interval', () => {
    let calls = 0;
    const counting = { route: () => { calls++; return { ok: false as const, code: 'NO_ROUTE' as const }; } };
    const ctl = new NavigationController({
      route: planned, destination: BALMORAL, router: counting, gps: nullGps, onEvent: () => {}, minRerouteIntervalMs: 5000,
    });
    // 30 s of being lost at 1 Hz
    for (const f of routeFixes([[43.745, 7.45], [43.7459, 7.45]], { speedMps: 3, accuracyM: 5, intervalS: 1 })) ctl.ingest(f);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(Math.ceil(30 / 5) + 1);
  });

  it('stop() before arrival yields arrived=false; a GPS error is forwarded; ingest after stop is ignored', () => {
    const events: NavEvent[] = [];
    let stopped = false;
    const gps: GpsProvider = {
      kind: 'device',
      start: (h) => h.onError(Object.assign(new Error('x'), { name: 'GpsError', code: 'permission_denied' as const })),
      stop: () => { stopped = true; },
    };
    const ctl = new NavigationController({ route: planned, destination: BALMORAL, router: engine, gps, onEvent: (e) => events.push(e) });
    ctl.start();
    expect(events[0]).toMatchObject({ type: 'gps_error' });
    const fixes = routeFixes(planned.geometry, { speedMps: 8 });
    ctl.ingest(fixes[0]);
    const s = ctl.stop();
    expect(s.arrived).toBe(false);
    expect(stopped).toBe(true);
    const n = events.length;
    ctl.ingest(fixes[1]);
    expect(events.length).toBe(n);
  });

  it('works end to end through a SimulatedGps provider', () => {
    const events: NavEvent[] = [];
    let clock = 0;
    const gps = new SimulatedGps(planned.geometry, { speedMps: 12, intervalMs: 1000, now: () => (clock += 1000) });
    const ctl = new NavigationController({ route: planned, destination: BALMORAL, router: engine, gps, onEvent: (e) => events.push(e) });
    ctl.start();
    for (let i = 0; i < 10_000 && !gps.done; i++) gps.tick(); // bounded: a bug must fail, not hang
    expect(gps.done).toBe(true);
    expect(events.some((e) => e.type === 'arrived')).toBe(true);
  });
});
