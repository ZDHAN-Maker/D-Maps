import { bearingDeg, haversineM } from '../routing/geo';
import type { Fix } from './types';

export interface PathWalker {
  readonly totalM: number;
  /** position and heading after travelling `distanceM` along the path (clamped to the path) */
  at(distanceM: number): { lat: number; lon: number; heading: number | null };
}

/** Cumulative-length interpolation along a [lat, lon] polyline. */
export function walkPath(path: [number, number][]): PathWalker {
  if (path.length < 2) throw new Error('a path needs at least two points');
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  }
  const totalM = cum[cum.length - 1];
  return {
    totalM,
    at(distanceM: number) {
      const d = Math.min(Math.max(0, distanceM), totalM);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const [la0, lo0] = path[i - 1];
      const [la1, lo1] = path[i];
      const seg = cum[i] - cum[i - 1];
      const t = seg > 0 ? (d - cum[i - 1]) / seg : 0;
      return { lat: la0 + (la1 - la0) * t, lon: lo0 + (lo1 - lo0) * t, heading: seg > 0 ? bearingDeg(la0, lo0, la1, lo1) : null };
    },
  };
}

export interface RouteFixOptions {
  speedMps?: number;
  intervalS?: number;
  /** each axis is perturbed by a uniform value in [-noiseM, +noiseM] metres */
  noiseM?: number;
  /** accuracy radius reported on every fix, metres */
  accuracyM?: number;
  /** PRNG seed, so noisy runs are reproducible */
  seed?: number;
  /** timestamp of the first fix, ms */
  startTime?: number;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG = 111_194.9;

/**
 * Deterministic fixes for driving a polyline at constant speed (tests, demos, simulation). The last fix is
 * always the exact end of the path, without noise, so a replayed trip can actually arrive.
 */
export function routeFixes(path: [number, number][], opts: RouteFixOptions = {}): Fix[] {
  const speed = opts.speedMps ?? 10;
  const interval = opts.intervalS ?? 1;
  const noise = opts.noiseM ?? 0;
  const accuracy = opts.accuracyM ?? 5;
  const start = opts.startTime ?? 1_700_000_000_000;
  const rnd = mulberry32(opts.seed ?? 1);
  const walker = walkPath(path);
  const fixes: Fix[] = [];
  const stepM = speed * interval;
  let k = 0;
  for (let d = 0; ; d += stepM, k++) {
    const last = d >= walker.totalM;
    const p = walker.at(last ? walker.totalM : d);
    const n = last ? 0 : noise;
    const dn = n ? (rnd() * 2 - 1) * n : 0;
    const de = n ? (rnd() * 2 - 1) * n : 0;
    fixes.push({
      lat: p.lat + dn / M_PER_DEG,
      lon: p.lon + de / (M_PER_DEG * Math.cos((p.lat * Math.PI) / 180)),
      accuracyM: accuracy,
      heading: p.heading,
      speedMps: speed,
      timestamp: start + k * interval * 1000,
    });
    if (last) break;
  }
  return fixes;
}
