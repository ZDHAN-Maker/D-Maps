import { haversineM } from '../routing/geo';
import type { RouteResult, Step } from '../routing';

/** One position report. `timestamp` is epoch ms. Never invented: it always comes from a GeoSource. */
export interface Fix {
  lat: number;
  lon: number;
  accuracyM?: number;
  /** degrees clockwise from north, when the device reports it */
  heading?: number | null;
  speedMps?: number | null;
  timestamp: number;
}

export type NavStatus = 'on_route' | 'off_route' | 'arrived';

export interface NavState {
  status: NavStatus;
  /** metres travelled along the route (never decreases while on route) */
  alongM: number;
  /** straight-line distance from the fix to the route, metres */
  offRouteM: number;
  totalM: number;
  remainingM: number;
  remainingS: number;
  /** index of the maneuver most recently passed */
  stepIndex: number;
  /** the maneuver the driver should prepare for; null only once arrived */
  nextStep: Step | null;
  distanceToManeuverM: number;
  /** the fix projected onto the route, [lat, lon] */
  snapped: [number, number];
}

export interface NavOptions {
  /** off-route threshold floor, metres */
  offRouteMinM: number;
  /** consecutive off-route fixes needed before reporting off_route (GPS blips must not trigger reroutes) */
  offRouteFixes: number;
  /** a fix this close (metres) to the end of the route counts as arrival */
  arriveM: number;
  /** how far ahead of the last known position the normal search looks, metres */
  lookAheadM: number;
}

const DEFAULTS: NavOptions = { offRouteMinM: 25, offRouteFixes: 3, arriveM: 20, lookAheadM: 1500 };
const M_PER_DEG = 111_194.9;

interface Projection { seg: number; t: number; distM: number; alongM: number; point: [number, number] }

/**
 * Follows a computed route from a stream of position fixes. Pure logic (no DOM, no timers) so it can be
 * driven by real GPS, a simulator, or tests. It never changes the route: when the driver leaves it, it
 * reports `off_route` and the caller decides to recalculate (offline, from the current fix).
 */
export class NavigationSession {
  readonly cum: number[] = [0];
  readonly totalM: number;
  private readonly stepStart: number[];
  private readonly opt: NavOptions;
  private seg = 0;
  private along = 0;
  private offStreak = 0;
  private arrived = false;

  constructor(readonly route: Pick<RouteResult, 'geometry' | 'steps'>, opts: Partial<NavOptions> = {}) {
    this.opt = { ...DEFAULTS, ...opts };
    const g = route.geometry;
    for (let i = 1; i < g.length; i++) this.cum.push(this.cum[i - 1] + haversineM(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
    this.totalM = this.cum[this.cum.length - 1] ?? 0;
    this.stepStart = route.steps.map((s) => this.cum[Math.min(s.geometryIndex, this.cum.length - 1)] ?? 0);
  }

  private project(lat: number, lon: number, from: number, to: number): Projection | null {
    const g = this.route.geometry;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let best: Projection | null = null;
    for (let i = Math.max(0, from); i < Math.min(to, g.length - 1); i++) {
      const [aLat, aLon] = g[i];
      const [bLat, bLon] = g[i + 1];
      const ax = 0, ay = 0;
      const bx = (bLon - aLon) * cosLat * M_PER_DEG, by = (bLat - aLat) * M_PER_DEG;
      const px = (lon - aLon) * cosLat * M_PER_DEG, py = (lat - aLat) * M_PER_DEG;
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
      const dx = px - t * bx, dy = py - t * by;
      const distM = Math.hypot(dx, dy);
      if (!best || distM < best.distM) {
        best = {
          seg: i, t, distM,
          alongM: this.cum[i] + t * (this.cum[i + 1] - this.cum[i]),
          point: [aLat + t * (bLat - aLat), aLon + t * (bLon - aLon)],
        };
      }
    }
    return best;
  }

  update(fix: Fix): NavState {
    const g = this.route.geometry;
    const steps = this.route.steps;
    const threshold = Math.max(this.opt.offRouteMinM, Math.min(100, (fix.accuracyM ?? 0) * 2));
    const end = g[g.length - 1];

    // 1) Normal case: search a window just behind/ahead of where we were (prevents jumping to another
    //    part of a route that doubles back near itself).
    let hi = this.seg;
    while (hi < g.length - 1 && this.cum[hi] - this.along < this.opt.lookAheadM) hi++;
    let proj = this.project(fix.lat, fix.lon, this.seg - 2, hi + 1);
    // 2) Not near the window: look at the whole route to tell "far off" from "GPS jumped ahead".
    let nearestM = proj?.distM ?? Infinity;
    if (!proj || proj.distM > threshold) {
      const whole = this.project(fix.lat, fix.lon, 0, g.length);
      if (whole) {
        nearestM = Math.min(nearestM, whole.distM);
        // accept a jump elsewhere on the route only if it is genuinely on the route
        if (whole.distM <= threshold) proj = whole;
        else proj ??= whole;
      }
    }

    const offRouteM = nearestM !== Infinity ? nearestM : (end ? haversineM(fix.lat, fix.lon, end[0], end[1]) : Infinity);
    const onRoute = proj !== null && offRouteM <= threshold;

    if (onRoute && proj) {
      this.offStreak = 0;
      this.seg = proj.seg;
      this.along = Math.max(this.along, proj.alongM); // progress never goes backwards because of GPS noise
    } else {
      this.offStreak++;
    }

    const remainingM = Math.max(0, this.totalM - this.along);
    const toEnd = end ? haversineM(fix.lat, fix.lon, end[0], end[1]) : Infinity;
    if (!this.arrived && onRoute && remainingM <= this.opt.arriveM && toEnd <= Math.max(30, fix.accuracyM ?? 0)) this.arrived = true;
    if (!this.arrived && steps.length <= 1 && toEnd <= Math.max(this.opt.arriveM, fix.accuracyM ?? 0)) this.arrived = true;

    let stepIndex = 0;
    for (let i = 0; i < steps.length; i++) if (this.stepStart[i] <= this.along + 0.5) stepIndex = i;
    const lastIdx = steps.length - 1;
    if (this.arrived) stepIndex = lastIdx;
    const nextStep = this.arrived || stepIndex >= lastIdx ? null : steps[stepIndex + 1];
    const distanceToManeuverM = this.arrived ? 0 : Math.max(0, (this.stepStart[stepIndex + 1] ?? this.totalM) - this.along);

    let remainingS = 0;
    if (!this.arrived) {
      const cur = steps[stepIndex];
      if (cur && cur.distanceM > 0) {
        const done = Math.min(1, Math.max(0, (this.along - this.stepStart[stepIndex]) / cur.distanceM));
        remainingS += cur.durationS * (1 - done);
      }
      for (let i = stepIndex + 1; i <= lastIdx; i++) remainingS += steps[i].durationS;
    }

    const status: NavStatus = this.arrived ? 'arrived' : this.offStreak >= this.opt.offRouteFixes ? 'off_route' : 'on_route';
    return {
      status, alongM: this.arrived ? this.totalM : this.along, offRouteM, totalM: this.totalM,
      remainingM: this.arrived ? 0 : remainingM, remainingS, stepIndex, nextStep, distanceToManeuverM,
      snapped: proj?.point ?? (g[0] ?? [fix.lat, fix.lon]),
    };
  }
}
