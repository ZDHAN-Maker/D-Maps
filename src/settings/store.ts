import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type MapEngine = 'maplibre' | 'leaflet';

export interface Settings {
  theme: ThemePref;
  mapEngine: MapEngine;
  /** keep the screen on while navigating (phones throttle GPS when the screen sleeps) */
  keepAwake: boolean;
  /** start navigation with the map following the vehicle */
  followOnStart: boolean;
  /** GPS high-accuracy mode: better position, more battery */
  highAccuracy: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', mapEngine: 'maplibre', keepAwake: true, followOnStart: true, highAccuracy: true };
export const SETTINGS_KEY = 'dmaps.settings';

type Json = Record<string, unknown>;
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Unknown or wrong-typed fields fall back to defaults, so an old/corrupt blob can never break the app. */
export function parseSettings(raw: string | null): Settings {
  let o: Json = {};
  try { const v = raw ? JSON.parse(raw) : {}; if (v && typeof v === 'object') o = v as Json; } catch { /* corrupt: use defaults */ }
  const d = DEFAULT_SETTINGS;
  return {
    theme: o.theme === 'light' || o.theme === 'dark' || o.theme === 'system' ? o.theme : d.theme,
    mapEngine: o.mapEngine === 'leaflet' || o.mapEngine === 'maplibre' ? o.mapEngine : d.mapEngine,
    keepAwake: typeof o.keepAwake === 'boolean' ? o.keepAwake : d.keepAwake,
    followOnStart: typeof o.followOnStart === 'boolean' ? o.followOnStart : d.followOnStart,
    highAccuracy: typeof o.highAccuracy === 'boolean' ? o.highAccuracy : d.highAccuracy,
  };
}

function browserStorage(): KeyValueStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/**
 * Small preference store. Persists to localStorage when it works; if storage is blocked or throws
 * (private mode, cleared site data) preferences still work for the session, in memory.
 */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {
    let raw: string | null;
    try { raw = storage?.getItem(SETTINGS_KEY) ?? null; } catch { raw = null; }
    this.value = parseSettings(raw);
  }

  get = (): Settings => this.value;

  set(patch: Partial<Settings>): void {
    this.value = parseSettings(JSON.stringify({ ...this.value, ...patch }));
    try { this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.value)); } catch { /* keep in memory */ }
    this.listeners.forEach((l) => l());
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };
}

export const settingsStore = new SettingsStore();

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(settingsStore.subscribe, settingsStore.get);
  return [s, (patch) => settingsStore.set(patch)];
}

/** 'system' removes the override so the OS preference (prefers-color-scheme) decides. */
export function applyTheme(theme: ThemePref, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

/** The theme actually in effect ('system' resolved through the OS preference, and tracking it live). */
export function useEffectiveTheme(): 'light' | 'dark' {
  const [pref] = useSettings();
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [osDark, setOsDark] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (e: MediaQueryListEvent) => setOsDark(e.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return pref.theme === 'system' ? (osDark ? 'dark' : 'light') : pref.theme;
}
