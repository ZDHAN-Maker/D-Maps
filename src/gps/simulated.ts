import { walkPath, type PathWalker } from './fixes';
import type { Fix, GpsHandlers, GpsProvider } from './types';

export interface SimulatedGpsOptions {
  /** travel speed along the path, m/s (default ~36 km/h) */
  speedMps?: number;
  /** time between fixes, ms */
  intervalMs?: number;
  /** reported accuracy radius, metres */
  accuracyM?: number;
  /** clock for fix timestamps; injectable for deterministic tests */
  now?: () => number;
}

/**
 * Replays a path as if a vehicle were driving it, live (timer) or by hand (`tick()`). Used for trying
 * navigation on a desktop without GPS. It is NOT the user's position and the UI labels it as a simulation.
 */
export class SimulatedGps implements GpsProvider {
  readonly kind = 'simulated' as const;
  private readonly walker: PathWalker;
  private travelled = 0;
  private handlers: GpsHandlers | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finished = false;
  private readonly speed: number;
  private readonly interval: number;
  private readonly accuracy: number;
  private readonly now: () => number;

  constructor(path: [number, number][], opts: SimulatedGpsOptions = {}) {
    this.walker = walkPath(path);
    this.speed = opts.speedMps ?? 10;
    this.interval = opts.intervalMs ?? 1000;
    this.accuracy = opts.accuracyM ?? 5;
    this.now = opts.now ?? Date.now;
  }

  get totalM(): number { return this.walker.totalM; }
  get done(): boolean { return this.finished; }

  /** Emit the fix for the current position, then advance by speed * interval. */
  tick(): Fix | null {
    if (this.finished || !this.handlers) return null;
    const p = this.walker.at(this.travelled);
    const fix: Fix = { lat: p.lat, lon: p.lon, accuracyM: this.accuracy, heading: p.heading, speedMps: this.speed, timestamp: this.now() };
    this.handlers.onFix(fix);
    if (this.travelled >= this.walker.totalM) { this.finished = true; this.clearTimer(); return fix; }
    this.travelled += this.speed * (this.interval / 1000);
    return fix;
  }

  start(h: GpsHandlers): void {
    this.handlers = h;
    this.finished = false;
    this.travelled = 0;
    this.tick();
    if (!this.finished) this.timer = setInterval(() => this.tick(), this.interval);
  }

  private clearTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** After stop() no more fixes will ever arrive, so `done` is true until start() is called again. */
  stop(): void { this.clearTimer(); this.handlers = null; this.finished = true; }
}
