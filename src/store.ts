import snapshot from './data/banners.snapshot.json';
import { EF_ASSETS, EF_ASSETS_CDN } from './domain/banners';
import type { BannerDb, PullHistory } from './domain/types';

/**
 * Everything lives in this browser. Pull history and images go in IndexedDB,
 * which has room for far more than localStorage's ~5 MB. That budget is shared
 * by every site on ram-prices.github.io, including the old eftracker, which may
 * already have filled it. Only small settings and the banner cache use
 * localStorage, because the theme has to be readable synchronously at startup.
 */
const KEYS = { history: 'ijl.history', settings: 'ijl.settings', bannerDb: 'ijl.bannerDb' } as const;

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePref;
  displayName: string;
  showTimestamps: boolean;
  /** Rows the 6★ summary strip may grow to when expanded. */
  summaryMaxRows: number;
  /** Only show 6★s from the last N banners in the summary strip (50+ = all). */
  summaryBannerLimit: number;
  summaryExpandedByDefault: boolean;
  /** Header image backdrop blur in px. */
  bannerBlur: number;
  /** Header image vertical position in %. */
  bannerPos: number;
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  displayName: '',
  showTimestamps: false,
  summaryMaxRows: 3,
  summaryBannerLimit: 50,
  summaryExpandedByDefault: false,
  bannerBlur: 12,
  bannerPos: 50,
};

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

/** Best effort: a full localStorage must not break the app over a theme preference. */
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Could not save ${key} to localStorage`, e);
  }
}

export async function loadHistory(): Promise<PullHistory | null> {
  const saved = await idb<PullHistory | undefined>('data', 'readonly', (s) => s.get('history'));
  if (saved) return saved;
  // Earlier builds kept history in localStorage; move it over once.
  const legacy = readJson<PullHistory>(KEYS.history);
  if (legacy) {
    await saveHistory(legacy);
    localStorage.removeItem(KEYS.history);
  }
  return legacy;
}

export async function saveHistory(h: PullHistory): Promise<void> {
  try {
    await idb('data', 'readwrite', (s) => s.put(h, 'history'));
  } catch (e) {
    console.warn('Could not save pull history', e);
    throw new Error(
      'Your browser refused to save your pull history. Private browsing or blocked site data can cause this.',
    );
  }
}

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEYS.settings) });
export const saveSettings = (s: Settings): void => writeJson(KEYS.settings, s);

/** Removes only the saved pull history; settings and images stay. */
export async function clearHistory(): Promise<void> {
  localStorage.removeItem(KEYS.history);
  await idb('data', 'readwrite', (s) => s.delete('history'));
}

export async function clearAll(): Promise<void> {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  await Promise.all([idb('data', 'readwrite', (s) => s.clear()), idb('images', 'readwrite', (s) => s.clear())]);
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
      try {
        localStorage.setItem(KEYS.bannerDb, after);
      } catch {
        /* cache is optional; the bundled snapshot covers offline use */
      }
      return db;
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// IndexedDB: "data" holds pull history, "images" holds avatar/header blobs
// ---------------------------------------------------------------------------

export type ImageSlot = 'avatar' | 'header';
type StoreName = 'data' | 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('itjustlogs', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['images', 'data'] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function idb<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    // Resolve on commit so a write is durable before callers move on.
    t.oncomplete = () => resolve(req.result as T);
    t.onerror = t.onabort = () => reject(t.error ?? req.error);
  });
}

export const loadImage = (slot: ImageSlot): Promise<Blob | undefined> =>
  idb<Blob | undefined>('images', 'readonly', (s) => s.get(slot)).catch(() => undefined);
export const saveImage = (slot: ImageSlot, blob: Blob): Promise<void> =>
  idb('images', 'readwrite', (s) => s.put(blob, slot));
export const deleteImage = (slot: ImageSlot): Promise<void> =>
  idb<void>('images', 'readwrite', (s) => s.delete(slot)).catch(() => undefined);

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const dataUrlToBlob = (url: string): Promise<Blob> => fetch(url).then((r) => r.blob());
