import { GpsError, type Fix, type GpsHandlers, type GpsProvider } from './types';

/** The subset of the Geolocation API we use; injectable so error paths are testable without a browser. */
export interface GeoApi {
  watchPosition(ok: (p: GeoPosition) => void, err: (e: GeoErr) => void, opts?: PositionOptions): number;
  clearWatch(id: number): void;
  getCurrentPosition(ok: (p: GeoPosition) => void, err: (e: GeoErr) => void, opts?: PositionOptions): void;
}
export interface GeoPosition {
  coords: { latitude: number; longitude: number; accuracy: number; heading: number | null; speed: number | null };
  timestamp: number;
}
export interface GeoErr { code: number; message?: string }

const finite = (n: number | null | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

export function toFix(p: GeoPosition): Fix {
  const heading = finite(p.coords.heading);
  return {
    lat: p.coords.latitude,
    lon: p.coords.longitude,
    accuracyM: finite(p.coords.accuracy) ?? undefined,
    // browsers report NaN/null heading when stationary: treat as unknown, never as 0 (north)
    heading: heading === null ? null : ((heading % 360) + 360) % 360,
    speedMps: finite(p.coords.speed),
    timestamp: p.timestamp,
  };
}

/** GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timeout. */
export function mapGeoError(e: GeoErr): GpsError {
  if (e.code === 1) return new GpsError('permission_denied', e.message);
  if (e.code === 3) return new GpsError('timeout', e.message);
  return new GpsError('position_unavailable', e.message);
}

const optionsFor = (highAccuracy: boolean): PositionOptions => ({ enableHighAccuracy: highAccuracy, maximumAge: 1000, timeout: 20_000 });

/**
 * Real device positioning through the browser Geolocation API. On a phone this uses the GNSS chip,
 * which needs no internet. On a laptop without GNSS the browser usually asks an online service, so
 * offline it will report position_unavailable: that is surfaced as an error, never papered over.
 */
export class DeviceGps implements GpsProvider {
  readonly kind = 'device' as const;
  private watchId: number | null = null;

  constructor(
    private readonly geo: GeoApi | undefined = typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
    private readonly secure: boolean = typeof isSecureContext === 'undefined' ? true : isSecureContext,
    private readonly highAccuracy: boolean = true,
  ) {}

  private precheck(): GpsError | null {
    if (!this.geo) return new GpsError('unsupported');
    if (!this.secure) return new GpsError('insecure_context');
    return null;
  }

  start(h: GpsHandlers): void {
    const bad = this.precheck();
    if (bad) { h.onError(bad); return; }
    this.stop();
    this.watchId = (this.geo as GeoApi).watchPosition((p) => h.onFix(toFix(p)), (e) => h.onError(mapGeoError(e)), optionsFor(this.highAccuracy));
  }

  stop(): void {
    if (this.watchId !== null) (this.geo as GeoApi).clearWatch(this.watchId);
    this.watchId = null;
  }

  /** One-shot position (e.g. "use my location as start"). Rejects with a GpsError. */
  getOnce(timeoutMs = 15_000): Promise<Fix> {
    const bad = this.precheck();
    if (bad) return Promise.reject(bad);
    return new Promise((resolve, reject) => {
      (this.geo as GeoApi).getCurrentPosition((p) => resolve(toFix(p)), (e) => reject(mapGeoError(e)),
        { enableHighAccuracy: this.highAccuracy, maximumAge: 5000, timeout: timeoutMs });
    });
  }
}
