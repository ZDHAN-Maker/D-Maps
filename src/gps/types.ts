/**
 * One position report. Never fabricated: if there is no real or simulated fix, there is no Fix.
 * Structurally identical to `Fix` in src/navigation/tracker.ts (kept separate so gps/ does not depend on navigation/).
 */
export interface Fix {
  lat: number;
  lon: number;
  /** horizontal accuracy radius in metres, when the source reports it */
  accuracyM?: number;
  /** degrees clockwise from north, when known (null/undefined = unknown, never "north") */
  heading?: number | null;
  speedMps?: number | null;
  /** ms since epoch */
  timestamp: number;
}

export type GpsErrorCode =
  | 'unsupported'          // no Geolocation API
  | 'insecure_context'     // page is not HTTPS / localhost
  | 'permission_denied'
  | 'position_unavailable' // e.g. laptop without GNSS and offline: no Wi-Fi/IP lookup possible
  | 'timeout';

export class GpsError extends Error {
  constructor(readonly code: GpsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'GpsError';
  }
}

export interface GpsHandlers {
  onFix(fix: Fix): void;
  onError(error: GpsError): void;
}

export interface GpsProvider {
  /** 'simulated' positions are generated, never the user's real position: the UI must say so */
  readonly kind: 'device' | 'simulated';
  start(handlers: GpsHandlers): void;
  stop(): void;
}

/** A fix older than this is shown as "not updating" instead of as the current position. */
export const STALE_FIX_MS = 10_000;
/** Above this accuracy radius the signal is called weak. */
export const POOR_ACCURACY_M = 50;

export const isStale = (fix: Fix | null, now: number, thresholdMs = STALE_FIX_MS): boolean =>
  fix === null || now - fix.timestamp > thresholdMs;

export const isPoor = (fix: Fix): boolean => fix.accuracyM !== undefined && fix.accuracyM > POOR_ACCURACY_M;
