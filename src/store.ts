import snapshot from './data/banners.snapshot.json';
import { EF_ASSETS, EF_ASSETS_CDN } from './domain/banners';
import type { BannerDb, PullHistory } from './domain/types';

/**
 * Everything lives in this browser. Pull history and settings go in
 * localStorage (small, synchronous at startup); images go in IndexedDB, which
 * stores binary files without localStorage's ~5 MB cap.
 */
const KEYS = { history: 'ijl.history', settings: 'ijl.settings', bannerDb: 'ijl.bannerDb' } as const;

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  displayName: string;
  showTimestamps: boolean;
}

const DEFAULT_SETTINGS: Settings = { theme: 'system', displayName: '', showTimestamps: false };

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Could not save ${key}`, e);
    throw new Error('Your browser refused to save data (storage full or disabled).');
  }
}

export const loadHistory = (): PullHistory | null => readJson<PullHistory>(KEYS.history);
export const saveHistory = (h: PullHistory): void => writeJson(KEYS.history, h);

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEYS.settings) });
export const saveSettings = (s: Settings): void => writeJson(KEYS.settings, s);

export function clearAll(): Promise<void> {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  return Promise.all([deleteImage('avatar'), deleteImage('header')]).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Banner database (ef-assets), cached so the site works offline after one visit
// ---------------------------------------------------------------------------

export function cachedBannerDb(): BannerDb {
  return readJson<BannerDb>(KEYS.bannerDb) ?? (snapshot as BannerDb);
}

/** Fetches the live banners.json; resolves null if offline or unchanged. */
export async function refreshBannerDb(): Promise<BannerDb | null> {
  for (const base of [EF_ASSETS, EF_ASSETS_CDN]) {
    try {
      const res = await fetch(`${base}/banners.json`, { signal: AbortSignal.timeout(6000), cache: 'no-cache' });
      if (!res.ok) continue;
      const db = (await res.json()) as BannerDb;
      const before = localStorage.getItem(KEYS.bannerDb);
      const after = JSON.stringify(db);
      if (before === after) return null;
      localStorage.setItem(KEYS.bannerDb, after);
      return db;
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Images (IndexedDB)
// ---------------------------------------------------------------------------

export type ImageSlot = 'avatar' | 'header';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('itjustlogs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('images');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction('images', mode).objectStore('images'));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const loadImage = (slot: ImageSlot): Promise<Blob | undefined> =>
  tx<Blob | undefined>('readonly', (s) => s.get(slot)).catch(() => undefined);
export const saveImage = (slot: ImageSlot, blob: Blob): Promise<void> => tx('readwrite', (s) => s.put(blob, slot));
export const deleteImage = (slot: ImageSlot): Promise<void> =>
  tx<void>('readwrite', (s) => s.delete(slot)).catch(() => undefined);

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const dataUrlToBlob = (url: string): Promise<Blob> => fetch(url).then((r) => r.blob());
