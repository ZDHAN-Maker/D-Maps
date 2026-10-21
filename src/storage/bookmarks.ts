export interface Bookmark {
  id: string;
  name: string;
  lat: number;
  lon: number;
  createdAt: number;
}

const STORAGE_KEY = 'dmaps_bookmarks_v1';

export function getBookmarks(): Bookmark[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBookmark(name: string, lat: number, lon: number): Bookmark {
  const bookmarks = getBookmarks();
  const trimmed = name.trim();
  const newBm: Bookmark = {
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed || 'Lokasi Tersimpan',
    lat,
    lon,
    createdAt: Date.now(),
  };
  bookmarks.unshift(newBm);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  } catch (err) {
    console.error('Failed to save bookmark:', err);
  }
  return newBm;
}

export function removeBookmark(id: string): Bookmark[] {
  const updated = getBookmarks().filter((b) => b.id !== id);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to remove bookmark:', err);
  }
  return updated;
}

