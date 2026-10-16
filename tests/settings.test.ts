import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore, applyTheme, parseSettings, type KeyValueStorage } from '../src/settings/store';
import {
  MAX_DESTINATIONS, MAX_QUERIES, clearHistory, getHistory, pushDestination, pushQuery, recordDestination, recordQuery, subscribeHistory,
} from '../src/search/history';
import { DeviceGps } from '../src/gps';
import { kvSet, resetDbForTests } from '../src/storage/db';

class MemStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('settings', () => {
  it('uses defaults for empty, corrupt, or wrong-typed stored data', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ theme: 'neon', keepAwake: 'yes', highAccuracy: false })))
      .toEqual({ ...DEFAULT_SETTINGS, highAccuracy: false });
  });

  it('persists changes and notifies subscribers; a new store reads them back', () => {
    const mem = new MemStorage();
    const s = new SettingsStore(mem);
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.set({ theme: 'dark', keepAwake: false });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.get()).toMatchObject({ theme: 'dark', keepAwake: false });
    expect(JSON.parse(mem.data.get(SETTINGS_KEY) as string).theme).toBe('dark');
    expect(new SettingsStore(mem).get().theme).toBe('dark');
    off();
    s.set({ theme: 'light' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid values instead of storing them', () => {
    const s = new SettingsStore(new MemStorage());
    s.set({ theme: 'neon' as never });
    expect(s.get().theme).toBe('system');
  });

  it('keeps working in memory when storage throws (blocked storage / private mode)', () => {
    const broken: KeyValueStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    const s = new SettingsStore(broken);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    s.set({ theme: 'dark' });
    expect(s.get().theme).toBe('dark');
    expect(new SettingsStore(null).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('applyTheme sets an override for light/dark and removes it for system', () => {
    const root = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement;
    applyTheme('dark', root);
    expect(root.dataset.theme).toBe('dark');
    applyTheme('system', root);
    expect('theme' in root.dataset).toBe(false);
  });
});

describe('history helpers', () => {
  it('puts the newest first, de-duplicates case-insensitively, and caps the list', () => {
    expect(pushQuery(['casino', 'hotel'], 'Hotel')).toEqual(['Hotel', 'casino']);
    expect(pushQuery([], '  rumah   sakit ')).toEqual(['rumah sakit']);
    expect(pushQuery(['a b'], 'x')).toEqual(['a b']); // too short to be useful
    const many = Array.from({ length: MAX_QUERIES + 5 }, (_, i) => `q${i}`).reduce((l, q) => pushQuery(l, q), [] as string[]);
    expect(many).toHaveLength(MAX_QUERIES);
    expect(many[0]).toBe(`q${MAX_QUERIES + 4}`);
  });

  it('de-duplicates destinations by label and position', () => {
    const d = { label: 'Balmoral', lat: 43.7, lon: 7.4, at: 1 };
    const l = pushDestination(pushDestination([], d), { ...d, at: 2 });
    expect(l).toEqual([{ ...d, at: 2 }]);
    expect(pushDestination(l, { label: 'Balmoral', lat: 43.8, lon: 7.4, at: 3 })).toHaveLength(2);
    const lots = Array.from({ length: MAX_DESTINATIONS + 3 }, (_, i) => ({ label: `P${i}`, lat: i, lon: i, at: i }))
      .reduce((acc, p) => pushDestination(acc, p), [] as ReturnType<typeof pushDestination>);
    expect(lots).toHaveLength(MAX_DESTINATIONS);
  });
});

describe('history persistence (IndexedDB, local only)', () => {
  beforeEach(async () => { await resetDbForTests(); });

  it('records, reads back, and clears', async () => {
    expect(await getHistory()).toEqual({ queries: [], destinations: [] });
    await recordQuery('casino');
    await recordQuery('balmoral');
    await recordDestination({ label: 'Balmoral', lat: 43.737776, lon: 7.423681 }, 42);
    const h = await getHistory();
    expect(h.queries).toEqual(['balmoral', 'casino']);
    expect(h.destinations).toEqual([{ label: 'Balmoral', lat: 43.737776, lon: 7.423681, at: 42 }]);
    expect(await clearHistory()).toEqual({ queries: [], destinations: [] });
    expect(await getHistory()).toEqual({ queries: [], destinations: [] });
  });

  it('keeps both updates when they happen at the same time (UI records a query and a destination together)', async () => {
    await Promise.all([
      recordQuery('balmoral'),
      recordDestination({ label: 'Balmoral', lat: 43.737776, lon: 7.423681 }, 7),
    ]);
    const h = await getHistory();
    expect(h.queries).toEqual(['balmoral']);
    expect(h.destinations).toHaveLength(1);
  });

  it('a clear is not undone by a write that was already in flight', async () => {
    const pending = recordQuery('casino');
    const cleared = clearHistory();
    await Promise.all([pending, cleared]);
    expect(await getHistory()).toEqual({ queries: [], destinations: [] });
  });

  it('notifies subscribers after a record and after a clear, and stops after unsubscribe', async () => {
    let n = 0;
    const off = subscribeHistory(() => { n++; });
    await recordQuery('casino');
    await clearHistory();
    expect(n).toBe(2);
    off();
    await recordQuery('balmoral');
    expect(n).toBe(2);
  });

  it('survives a corrupt stored value', async () => {
    await kvSet('history', { queries: [1, 'ok'], destinations: [{ label: 'x' }, { label: 'y', lat: 1, lon: 2, at: 3 }] });
    expect(await getHistory()).toEqual({ queries: ['ok'], destinations: [{ label: 'y', lat: 1, lon: 2, at: 3 }] });
  });
});

describe('GPS accuracy preference reaches the Geolocation API', () => {
  it.each([true, false])('highAccuracy=%s', (hi) => {
    const seen: PositionOptions[] = [];
    const geo = {
      watchPosition: (_o: unknown, _e: unknown, opts?: PositionOptions) => { seen.push(opts as PositionOptions); return 1; },
      clearWatch() {}, getCurrentPosition() {},
    };
    new DeviceGps(geo, true, hi).start({ onFix() {}, onError() {} });
    expect(seen[0].enableHighAccuracy).toBe(hi);
  });
});
