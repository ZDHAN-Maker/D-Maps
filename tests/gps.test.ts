import { describe, expect, it } from 'vitest';
import {
  DeviceGps, GpsError, SimulatedGps, isPoor, routeFixes, isStale, mapGeoError, toFix, STALE_FIX_MS,
  type Fix, type GeoApi, type GeoErr, type GeoPosition,
} from '../src/gps';
import { haversineM } from '../src/routing/geo';

const pos = (over: Partial<GeoPosition['coords']> = {}, timestamp = 1000): GeoPosition => ({
  coords: { latitude: -1.6, longitude: 103.6, accuracy: 8, heading: 90, speed: 5, ...over }, timestamp,
});

function fakeGeo() {
  let ok: ((p: GeoPosition) => void) | null = null;
  let err: ((e: GeoErr) => void) | null = null;
  const cleared: number[] = [];
  const api: GeoApi = {
    watchPosition: (o, e) => { ok = o; err = e; return 7; },
    clearWatch: (id) => { cleared.push(id); },
    getCurrentPosition: (o, e) => { ok = o; err = e; },
  };
  return { api, emit: (p: GeoPosition) => ok?.(p), fail: (e: GeoErr) => err?.(e), cleared };
}

describe('toFix / mapGeoError', () => {
  it('converts a position and treats NaN/null heading as unknown (not north)', () => {
    expect(toFix(pos())).toEqual({ lat: -1.6, lon: 103.6, accuracyM: 8, heading: 90, speedMps: 5, timestamp: 1000 });
    expect(toFix(pos({ heading: NaN })).heading).toBeNull();
    expect(toFix(pos({ heading: null, speed: null })).speedMps).toBeNull();
    expect(toFix(pos({ heading: -90 })).heading).toBe(270);
  });
  it('maps browser error codes', () => {
    expect(mapGeoError({ code: 1 }).code).toBe('permission_denied');
    expect(mapGeoError({ code: 2 }).code).toBe('position_unavailable');
    expect(mapGeoError({ code: 3 }).code).toBe('timeout');
    expect(mapGeoError({ code: 99 }).code).toBe('position_unavailable');
  });
});

describe('DeviceGps', () => {
  it('forwards fixes and errors, and stops the watch', () => {
    const g = fakeGeo();
    const fixes: Fix[] = [];
    const errors: GpsError[] = [];
    const gps = new DeviceGps(g.api, true);
    gps.start({ onFix: (f) => fixes.push(f), onError: (e) => errors.push(e) });
    g.emit(pos());
    g.fail({ code: 3 });
    expect(fixes).toHaveLength(1);
    expect(errors.map((e) => e.code)).toEqual(['timeout']);
    gps.stop();
    expect(g.cleared).toEqual([7]);
  });

  it('reports unsupported and insecure contexts instead of silently doing nothing', () => {
    const errs: string[] = [];
    new DeviceGps(undefined, true).start({ onFix: () => {}, onError: (e) => errs.push(e.code) });
    new DeviceGps(fakeGeo().api, false).start({ onFix: () => {}, onError: (e) => errs.push(e.code) });
    expect(errs).toEqual(['unsupported', 'insecure_context']);
  });

  it('getOnce resolves with a fix or rejects with a typed error', async () => {
    const ok = fakeGeo();
    const p = new DeviceGps(ok.api, true).getOnce();
    ok.emit(pos());
    expect((await p).lat).toBe(-1.6);

    const denied = fakeGeo();
    const q = new DeviceGps(denied.api, true).getOnce();
    denied.fail({ code: 1 });
    await expect(q).rejects.toMatchObject({ code: 'permission_denied' });
    await expect(new DeviceGps(undefined, true).getOnce()).rejects.toMatchObject({ code: 'unsupported' });
  });
});

describe('staleness and accuracy', () => {
  const f: Fix = { lat: 0, lon: 0, accuracyM: 10, heading: null, speedMps: null, timestamp: 100_000 };
  it('flags old or missing fixes as stale', () => {
    expect(isStale(null, 0)).toBe(true);
    expect(isStale(f, f.timestamp + STALE_FIX_MS)).toBe(false);
    expect(isStale(f, f.timestamp + STALE_FIX_MS + 1)).toBe(true);
  });
  it('calls >50 m accuracy poor', () => {
    expect(isPoor(f)).toBe(false);
    expect(isPoor({ ...f, accuracyM: 80 })).toBe(true);
    expect(isPoor({ ...f, accuracyM: undefined })).toBe(false);
  });
});

describe('SimulatedGps', () => {
  const path: [number, number][] = [[0, 0], [0, 0.001], [0.001, 0.001]]; // ~111 m east, then ~111 m north
  it('walks the path at the set speed, ends exactly on the last point, then stops', () => {
    let clock = 0;
    const gps = new SimulatedGps(path, { speedMps: 50, intervalMs: 1000, now: () => (clock += 1000) });
    const fixes: Fix[] = [];
    gps.start({ onFix: (x) => fixes.push(x), onError: () => { throw new Error('no errors expected'); } });
    for (let i = 0; i < 10_000 && !gps.done; i++) gps.tick();
    gps.stop();
    expect(fixes[0]).toMatchObject({ lat: 0, lon: 0 });
    expect(fixes[fixes.length - 1].lat).toBeCloseTo(0.001, 9);
    expect(fixes[fixes.length - 1].lon).toBeCloseTo(0.001, 9);
    // spacing between consecutive fixes is at most speed * interval (50 m)
    for (let i = 1; i < fixes.length; i++) {
      expect(haversineM(fixes[i - 1].lat, fixes[i - 1].lon, fixes[i].lat, fixes[i].lon)).toBeLessThanOrEqual(50.5);
    }
    // timestamps increase and heading follows the segment (east = ~90, then north = ~0)
    expect(fixes.every((x, i) => i === 0 || x.timestamp > fixes[i - 1].timestamp)).toBe(true);
    expect(fixes[0].heading).toBeCloseTo(90, 0);
    const lastHeading = fixes[fixes.length - 1].heading as number;
    expect(Math.min(lastHeading, 360 - lastHeading)).toBeLessThan(1);
    expect(gps.tick()).toBeNull(); // nothing after the end
    gps.start({ onFix: () => {}, onError: () => {} });
    expect(gps.done).toBe(false); // start() begins a fresh run
    gps.stop();
    expect(gps.done).toBe(true);
  });
  it('rejects a path that cannot define a direction', () => {
    expect(() => new SimulatedGps([[0, 0]])).toThrow();
  });
});

describe('routeFixes', () => {
  const path: [number, number][] = [[0, 0], [0, 0.002]]; // ~222 m east
  it('is deterministic for a seed, ends exactly on the path end, and bounds the noise', () => {
    const a = routeFixes(path, { speedMps: 10, noiseM: 6, seed: 3 });
    const b = routeFixes(path, { speedMps: 10, noiseM: 6, seed: 3 });
    const c = routeFixes(path, { speedMps: 10, noiseM: 6, seed: 4 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBe(Math.ceil(a.length)); // sanity: finite list
    expect(a[a.length - 1]).toMatchObject({ lat: 0, lon: 0.002 });
    for (const f of a.slice(0, -1)) {
      expect(Math.abs(f.lat * 111_194.9)).toBeLessThanOrEqual(6.01);
    }
  });
  it('spaces fixes by speed * interval and timestamps them one interval apart', () => {
    const f = routeFixes(path, { speedMps: 20, intervalS: 2, startTime: 5000 });
    expect(f[1].timestamp - f[0].timestamp).toBe(2000);
    expect(haversineM(f[0].lat, f[0].lon, f[1].lat, f[1].lon)).toBeCloseTo(40, 0);
    expect(f[0].timestamp).toBe(5000);
  });
  it('a path shorter than one step still yields start and end fixes', () => {
    expect(routeFixes([[0, 0], [0, 0.00001]], { speedMps: 10 })).toHaveLength(2);
  });
});
