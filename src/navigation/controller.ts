import { haversineM } from '../routing/geo';
import type { LatLon, RouteError, RouteErrorCode, RouteResult } from '../routing';
import type { Fix, GpsError, GpsProvider } from '../gps';
import { NavigationSession, type NavOptions, type NavState } from './tracker';

export interface TripSummary {
  /** true only if the arrival condition was actually met (not merely "navigation was stopped") */
  arrived: boolean;
  /** length of the originally planned route */
  plannedDistanceM: number;
  /** sum of distances between consecutive fixes: approximate, includes GPS noise */
  drivenDistanceM: number;
  elapsedS: number;
  reroutes: number;
}

export type NavEvent =
  | { type: 'state'; state: NavState; fix: Fix; route: RouteResult }
  | { type: 'rerouting'; fix: Fix }
  | { type: 'rerouted'; route: RouteResult; count: number }
  | { type: 'reroute_failed'; code: RouteErrorCode }
  | { type: 'arrived'; summary: TripSummary }
  | { type: 'gps_error'; error: GpsError };

/** Anything that can compute a route from local data (the RoutingEngine). Never a remote service. */
export interface LocalRouter {
  route(from: LatLon, to: LatLon): RouteResult | RouteError;
}

export interface ControllerOptions {
  route: RouteResult;
  destination: LatLon;
  router: LocalRouter;
  gps: GpsProvider;
  onEvent: (e: NavEvent) => void;
  /** minimum time between reroute attempts, measured on fix timestamps (default 5 s) */
  minRerouteIntervalMs?: number;
  session?: Partial<NavOptions>;
}

/**
 * Wires a position source to route following. Leaving the route triggers an *offline* reroute from
 * the current fix to the same destination; if the downloaded data cannot produce one, it says so
 * (`reroute_failed`) and keeps the old route visible rather than inventing a path.
 */
export class NavigationController {
  private session: NavigationSession;
  private route: RouteResult;
  private reroutes = 0;
  private lastRerouteAt = Number.NEGATIVE_INFINITY;
  private first: Fix | null = null;
  private prev: Fix | null = null;
  private driven = 0;
  private done = false;
  private wasArrived = false;
  private readonly plannedM: number;
  private readonly minGap: number;

  constructor(private readonly o: ControllerOptions) {
    this.route = o.route;
    this.plannedM = o.route.distanceM;
    this.session = new NavigationSession(o.route, o.session);
    this.minGap = o.minRerouteIntervalMs ?? 5000;
  }

  get currentRoute(): RouteResult { return this.route; }

  start(): void {
    this.o.gps.start({ onFix: (f) => this.ingest(f), onError: (e) => this.o.onEvent({ type: 'gps_error', error: e }) });
  }

  /** Feed one fix (called by the GPS provider; public so tests and replays can drive it directly). */
  ingest(fix: Fix): void {
    if (this.done) return;
    this.first ??= fix;
    if (this.prev) {
      const d = haversineM(this.prev.lat, this.prev.lon, fix.lat, fix.lon);
      if (d >= 2) this.driven += d; // below ~2 m is stationary jitter, not driving
    }
    this.prev = fix;

    const state = this.session.update(fix);
    this.o.onEvent({ type: 'state', state, fix, route: this.route });

    if (state.status === 'arrived') {
      this.finish(true);
      return;
    }
    if (state.status === 'off_route' && fix.timestamp - this.lastRerouteAt >= this.minGap) {
      this.lastRerouteAt = fix.timestamp;
      this.o.onEvent({ type: 'rerouting', fix });
      const res = this.o.router.route(fix, this.o.destination);
      if (res.ok) {
        this.route = res;
        this.session = new NavigationSession(res, this.o.session);
        this.reroutes++;
        this.o.onEvent({ type: 'rerouted', route: res, count: this.reroutes });
        this.o.onEvent({ type: 'state', state: this.session.update(fix), fix, route: this.route });
      } else {
        this.o.onEvent({ type: 'reroute_failed', code: res.code });
      }
    }
  }

  private summary(arrived: boolean): TripSummary {
    const elapsedMs = this.first && this.prev ? this.prev.timestamp - this.first.timestamp : 0;
    return { arrived, plannedDistanceM: this.plannedM, drivenDistanceM: this.driven, elapsedS: Math.max(0, elapsedMs / 1000), reroutes: this.reroutes };
  }

  private finish(arrived: boolean): TripSummary {
    const s = this.summary(arrived);
    if (!this.done) {
      this.done = true;
      this.wasArrived = arrived;
      this.o.gps.stop();
      if (arrived) this.o.onEvent({ type: 'arrived', summary: s });
    }
    return s;
  }

  /** User ends navigation. Returns the summary; `arrived` is false unless arrival really happened. */
  stop(): TripSummary {
    return this.done ? this.summary(this.wasArrived) : this.finish(false);
  }
}
