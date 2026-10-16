import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceGps, SimulatedGps, isStale, type Fix, type GpsError } from '../gps';
import { ScreenWakeLock } from '../gps/wakeLock';
import { NavigationController, type LocalRouter, type NavEvent, type NavState, type TripSummary } from '../navigation';
import type { LatLon, RouteErrorCode, RouteResult } from '../routing';
import { settingsStore } from '../settings/store';

export interface NavUi {
  phase: 'idle' | 'active' | 'summary';
  simulated: boolean;
  /** the route being followed (replaced after a reroute) */
  route: RouteResult | null;
  state: NavState | null;
  fix: Fix | null;
  gpsError: GpsError | null;
  rerouting: boolean;
  /** true briefly after a successful reroute so the UI can say so */
  justRerouted: boolean;
  rerouteFailed: RouteErrorCode | null;
  summary: TripSummary | null;
  /** latest fix is old: the marker must not be presented as the current position */
  stale: boolean;
}

const IDLE: NavUi = {
  phase: 'idle', simulated: false, route: null, state: null, fix: null, gpsError: null,
  rerouting: false, justRerouted: false, rerouteFailed: null, summary: null, stale: false,
};

export type NavMode = { kind: 'device' } | { kind: 'simulated'; speedMultiplier: number };

/** Owns one NavigationController at a time and mirrors its events into React state. */
export function useNavigation(router: LocalRouter | null) {
  const [ui, setUi] = useState<NavUi>(IDLE);
  const ctl = useRef<NavigationController | null>(null);
  const lastFix = useRef<Fix | null>(null);
  const wake = useRef(new ScreenWakeLock());
  const notice = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    ctl.current?.stop();
    ctl.current = null;
    void wake.current.disable();
    if (notice.current) clearTimeout(notice.current);
  }, []);

  const onEvent = useCallback((e: NavEvent) => {
    switch (e.type) {
      case 'state':
        lastFix.current = e.fix;
        setUi((u) => ({ ...u, state: e.state, fix: e.fix, route: e.route, gpsError: null, stale: false, rerouting: false }));
        break;
      case 'rerouting':
        setUi((u) => ({ ...u, rerouting: true, rerouteFailed: null }));
        break;
      case 'rerouted':
        setUi((u) => ({ ...u, route: e.route, rerouting: false, justRerouted: true, rerouteFailed: null }));
        if (notice.current) clearTimeout(notice.current);
        notice.current = setTimeout(() => setUi((u) => ({ ...u, justRerouted: false })), 4000);
        break;
      case 'reroute_failed':
        setUi((u) => ({ ...u, rerouting: false, rerouteFailed: e.code }));
        break;
      case 'gps_error':
        setUi((u) => ({ ...u, gpsError: e.error }));
        break;
      case 'arrived':
        void wake.current.disable();
        setUi((u) => ({ ...u, phase: 'summary', summary: e.summary, rerouting: false }));
        break;
    }
  }, []);

  const start = useCallback((route: RouteResult, destination: LatLon, mode: NavMode) => {
    if (!router) return;
    teardown();
    lastFix.current = null;
    const gps = mode.kind === 'simulated'
      // Faster simulation = proportionally higher speed AND proportionally shorter interval, so the spacing
      // between fixes stays ~12 m (shortening the interval alone would only shrink the steps).
      ? new SimulatedGps(route.geometry, { speedMps: 12 * mode.speedMultiplier, intervalMs: 1000 / mode.speedMultiplier })
      : new DeviceGps(undefined, undefined, settingsStore.get().highAccuracy);
    const c = new NavigationController({ route, destination, router, gps, onEvent });
    ctl.current = c;
    setUi({ ...IDLE, phase: 'active', simulated: mode.kind === 'simulated', route });
    if (settingsStore.get().keepAwake) void wake.current.enable();
    c.start();
  }, [router, onEvent, teardown]);

  /** User ends navigation early: shows a summary that says it was NOT completed. */
  const stop = useCallback(() => {
    const s = ctl.current?.stop();
    ctl.current = null;
    void wake.current.disable();
    setUi((u) => (u.phase === 'active' && s ? { ...u, phase: 'summary', summary: s, rerouting: false } : u));
  }, []);

  const dismissSummary = useCallback(() => setUi(IDLE), []);

  // "stale" is a function of time, not of events: re-check while navigating.
  useEffect(() => {
    if (ui.phase !== 'active') return;
    const id = setInterval(() => {
      const stale = isStale(lastFix.current, Date.now());
      setUi((u) => (u.stale === stale || !lastFix.current ? u : { ...u, stale }));
    }, 2000);
    return () => clearInterval(id);
  }, [ui.phase]);

  useEffect(() => () => teardown(), [teardown]);

  return { ui, start, stop, dismissSummary };
}
