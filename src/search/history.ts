import { kvDelete, kvGet, kvSet } from '../storage/db';

export interface RecentDestination { label: string; lat: number; lon: number; at: number }
export interface History { queries: string[]; destinations: RecentDestination[] }

export const MAX_QUERIES = 12;
export const MAX_DESTINATIONS = 8;
const KEY = 'history';
const EMPTY: History = { queries: [], destinations: [] };

/** Newest first, case-insensitive de-duplication, capped. Queries shorter than 2 characters are noise. */
export function pushQuery(list: string[], query: string, max = MAX_QUERIES): string[] {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < 2) return list;
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max);
}

export function pushDestination(list: RecentDestination[], d: RecentDestination, max = MAX_DESTINATIONS): RecentDestination[] {
  const same = (x: RecentDestination) => x.label === d.label && Math.abs(x.lat - d.lat) < 1e-5 && Math.abs(x.lon - d.lon) < 1e-5;
  return [d, ...list.filter((x) => !same(x))].slice(0, max);
}

function sanitize(v: unknown): History {
  const h = v as Partial<History> | null;
  const queries = Array.isArray(h?.queries) ? h.queries.filter((q): q is string => typeof q === 'string').slice(0, MAX_QUERIES) : [];
  const destinations = Array.isArray(h?.destinations)
    ? h.destinations.filter((d): d is RecentDestination => typeof d?.label === 'string' && Number.isFinite(d.lat) && Number.isFinite(d.lon) && Number.isFinite(d.at)).slice(0, MAX_DESTINATIONS)
    : [];
  return { queries, destinations };
}

/** Stored only on this device (IndexedDB). Never sent anywhere. All calls are best-effort: history must never break search. */
export async function getHistory(): Promise<History> {
  try { return sanitize(await kvGet<History>(KEY)); } catch { return EMPTY; }
}
/**
 * Every write goes through one queue. Read-modify-write on a single key is not atomic, so two
 * overlapping calls (the UI records a query and a destination on the same tap) would otherwise
 * both read the old value and the second write would silently drop the first.
 */
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

const listeners = new Set<() => void>();
/** Notifies after every change (record or clear), so every screen showing history stays in sync with storage. */
export function subscribeHistory(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
const notify = () => listeners.forEach((l) => { try { l(); } catch { /* a bad listener must not break history */ } });

const update = (fn: (h: History) => History): Promise<History> => enqueue(async () => {
  const next = fn(await getHistory());
  try { await kvSet(KEY, next); } catch { /* ignore */ }
  notify();
  return next;
});
export const recordQuery = (q: string) => update((h) => ({ ...h, queries: pushQuery(h.queries, q) }));
export const recordDestination = (d: Omit<RecentDestination, 'at'>, now = Date.now()) =>
  update((h) => ({ ...h, destinations: pushDestination(h.destinations, { ...d, at: now }) }));
export const clearHistory = (): Promise<History> => enqueue(async () => {
  try { await kvDelete(KEY); } catch { /* ignore */ }
  notify();
  return EMPTY;
});
