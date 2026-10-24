import snapshot from './data/banners.snapshot.json';
import scheduleSnapshot from './data/schedule.snapshot.json';
import { EF_ASSETS, EF_ASSETS_CDN } from './domain/banners';
import type { PaidIncome } from './domain/income';
import type { Loadout } from './domain/loadout';
import type { ExtraCopy } from './domain/owned';
import type { Schedule, Server } from './domain/schedule';
import type { BannerDb, PullHistory } from './domain/types';

/**
 * Everything lives in this browser. Pull history and images go in IndexedDB,
 * which has room for far more than localStorage's ~5 MB. That budget is shared
 * by every site on ram-prices.github.io, including the old eftracker, which may
 * already have filled it. Only small settings and the banner cache use
 * localStorage, because the theme has to be readable synchronously at startup.
 */
const KEYS = {
  history: 'ijl.history',
  settings: 'ijl.settings',
  bannerDb: 'ijl.bannerDb',
  schedule: 'ijl.schedule',
  sync: 'ijl.sync',
  tabViews: 'ijl.tabViews',
} as const;

export type ThemePref = 'system' | 'light' | 'dark';

/** How far an "above the circle" profile picture reaches left and right of its circle, in circle widths. */
export interface AvatarBox {
  l: number;
  r: number;
}

/** One of Home's widgets (ui/pages/homeWidgets.ts): what it is, its width out of 12, and its own settings. */
export interface HomeWidget {
  id: string;
  type: string;
  size: 4 | 6 | 8 | 12;
  /** Stacked under the widget before it, in its column (as wide as the column's top widget). */
  under?: boolean;
  /** Where in its row a narrower widget sits (a column: where its top widget does); left starts a new row. Unset: right after the one before it. */
  align?: 'left' | 'center' | 'right';
  /** The grid column (1–12) a widget was dropped at, in a row's empty room; it beats `align`. */
  col?: number;
  /** Starts a new row: a widget placed out of a column keeps its height on the page. */
  newRow?: boolean;
  /** Empty space (always full width): its height in px. */
  height?: number;
  /** The widget's title hidden (a Character card hides its basic information instead, `hideBasic`). */
  hideTitle?: boolean;
  /** Character card: the operator, the picture (an art key, 'full' for their banner art; unset = portrait), which facts show. */
  op?: string;
  pic?: string;
  facts?: string[];
  /**
   * Character card: ambient glow in the picture's edge colours, from the picture's edges
   * (true / 'picture'), or around the whole card with the card solid inside ('card'); no
   * outline (the glow spreads past it).
   */
  ambient?: boolean | 'picture' | 'card';
  bare?: boolean;
  /** Character card: a drop shadow under it (not with an ambient glow). */
  shadow?: boolean;
  /** Character card: no basic information (title, name, rarity, class, note); with nothing else shown, the picture alone. */
  hideBasic?: boolean;
  /** Character card: the picture as a round profile picture, a banner across the top, or the background (unset: profile picture for the portrait, else banner). */
  artStyle?: 'avatar' | 'banner' | 'background';
  /** Banners open now: how many of each kind's newest show (unset: all; 0: none). */
  char?: number;
  weap?: number;
  /** Banners open now: false hides re-runs (RE-Factor banners). */
  reruns?: boolean;
  /** Character card and note: a title; the card's note, the note's text. */
  title?: string;
  note?: string;
  text?: string;
}

export interface Settings {
  theme: ThemePref;
  /** Home plays its game clip (ui/videoBackground.ts) and pictures move with the mouse (ui/parallax.ts); off: the clip's first frame, still pictures. Unset = on. */
  motion?: boolean;
  /** Home's game clip: an id from ef-assets backgrounds/index.json, or 'none'. Unset: one of the defaults at random. */
  homeClip?: string;
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
  /** Game server whose times the schedule shows; unset = guessed from the time zone. */
  server?: Server;
  /** Operators/Arsenal list every banner that has opened, not just the ones pulled on. */
  showAllBanners?: boolean;
  /** Paid income Stats → By patch adds to each patch's free pulls (paid pass tiers, Monthly Pass). */
  paidIncome?: PaidIncome[];
  /**
   * Copies from outside pulls (story operators, event gifts); counted on the
   * info pages, never added to the pull history. Unset = DEFAULT_EXTRAS.
   */
  extras?: ExtraCopy[];
  /**
   * Each weapon's skill ranks as the player built them (their essence), set
   * on the weapon's page. A weapon not listed has no essence (3, 3 and
   * 1 + Potential, see weaponBaseRanks), unless it's in `maxEssence`.
   */
  weaponRanks?: Record<string, number[]>;
  /** Weapons the player marked Maxed Essence: every skill at the highest rank it can reach (9; 4 + Potential for the last). */
  maxEssence?: string[];
  /** Operator art the player removed (keys), so sync removes it on their other devices and in Drive too. */
  deletedArt?: string[];
  /** Where each operator picture shows (by its key); unset = the banner. See ui/pages/art.ts. */
  artPlaces?: Record<string, string[]>;
  /** The operator and weapon lists' sort order (ui/pages/sorting.ts), when changed. */
  infoSort?: Partial<Record<'char' | 'weap', { key: 'rarity' | 'name' | 'acquired' | 'potential' | 'owned' | 'released' | 'element' | 'weapon' | 'class'; desc: boolean; off?: boolean }[]>>;
  /** Medals the player has (Achievements page), by medal id: when, Reforging tier, Trimmed. */
  medals?: Record<string, import('./domain/collections').MedalProgress>;
  /** Findings the player has collected (Archive page), by id. */
  findings?: string[];
  /** The player's essences (Essences page), each kind (domain/essences.ts essenceKey) and how many. */
  essences?: Record<string, number>;
  /** When they were last read from the game. */
  essencesRead?: number;
  /** The AIC planner's items, sites and options (ui/pages/aic.ts). */
  aic?: import('./domain/aic').AicSettings;
  /** The Rotations page's team and options (ui/pages/rotations.ts). */
  sim?: import('./domain/sim/team').SimSettings;
  /** A banner picture's focus (x, y in %), when moved from where it starts. */
  artPos?: Record<string, [number, number]>;
  /** What each operator has equipped (weapon and gear), by operator id. */
  loadouts?: Record<string, Loadout>;
  /** The profile picture rises above its circle (its top half isn't cropped), for cut-out pictures: cat ears. */
  avatarPop?: boolean;
  /** How far that picture reaches beside its circle on each side, in circle widths (cropper.ts). */
  avatarBox?: AvatarBox;
  /** Home's widgets in order; unset = the schedule (homeWidgets.ts DEFAULT_HOME). */
  home?: HomeWidget[];
  /**
   * Home on a phone: the same widgets, in its own order (widget ids; ones not
   * listed follow in the wide layout's reading order) and with its own hidden
   * ones. Unset: the wide layout's order, nothing hidden.
   */
  homePhone?: { order: string[]; hidden?: string[] };
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

/**
 * Which view the Database and Pulls tabs open: the path of the one the
 * player was last on. This browser only (not synced: it's where they left
 * off, not a setting).
 */
export type Section = 'database' | 'pulls';
export const loadTabViews = (): Partial<Record<Section, string>> => readJson(KEYS.tabViews) ?? {};
export function saveTabView(tab: Section, path: string): void {
  const all = loadTabViews();
  if (all[tab] !== path) writeJson(KEYS.tabViews, { ...all, [tab]: path });
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

/** What changed when (ms), so Google Drive sync can tell which copy is newer. 0 = never changed here. */
export interface ChangeTimes {
  settings: number;
  avatar: number;
  header: number;
}

/** Google Drive sync bookkeeping. The access token itself is never stored here. */
export interface SyncMeta {
  /** Signed in: sync after each change. */
  on: boolean;
  email?: string;
  /** The Drive file and the version of it this browser last read or wrote. */
  fileId?: string;
  version?: string;
  /** Hash of what this browser last uploaded, to skip unchanged uploads. */
  hash?: string;
  lastSynced?: number;
  /** Drive's copy looked like another player's and the player chose Cancel: wait for Sync now. */
  paused?: boolean;
  /** When the latest change not yet in Drive was made (none: everything here is synced). */
  pending?: number;
  /** Version history copies in Drive (from any device), newest first; `fileId` to download one. */
  driveSnapshots?: (SnapshotInfo & { fileId: string })[];
  changed: ChangeTimes;
}

export const loadSyncMeta = (): SyncMeta => {
  const saved = readJson<Partial<SyncMeta>>(KEYS.sync);
  return { on: false, ...saved, changed: { settings: 0, avatar: 0, header: 0, ...saved?.changed } };
};
export const saveSyncMeta = (m: SyncMeta): void => writeJson(KEYS.sync, m);

// ---------------------------------------------------------------------------
// Version history: copies of the pulls taken before each change that could lose
// any (import, delete, replace, restore, a merge from Google Drive). Kept in
// the "data" store as "snapshot:<id>", with a small index under "snapshots".
// Delete pull history keeps them (so it can be undone); Delete everything
// clears them with the rest.
// ---------------------------------------------------------------------------

export interface SnapshotInfo {
  id: string;
  /** When the copy was taken (just before the change). */
  at: number;
  /** What was about to happen, e.g. "Before import". */
  reason: string;
  chars: number;
  weaps: number;
  /** Newest pull in the copy (ms), to skip saving the same pulls twice in a row. */
  newest: number;
}

/** How many copies to keep; the oldest go first. */
export const MAX_SNAPSHOTS = 15;
/** How many Google Drive keeps (shared by every device that syncs); the oldest go first. */
export const MAX_DRIVE_SNAPSHOTS = 30;

export const listSnapshots = (): Promise<SnapshotInfo[]> =>
  idb<SnapshotInfo[] | undefined>('data', 'readonly', (s) => s.get('snapshots')).then((l) => l ?? []).catch(() => []);

export const loadSnapshot = (id: string): Promise<PullHistory | undefined> =>
  idb<PullHistory | undefined>('data', 'readonly', (s) => s.get(`snapshot:${id}`));

/** Saves a copy and trims to MAX_SNAPSHOTS. Returns the new list, newest first. */
export async function saveSnapshot(info: SnapshotInfo, history: PullHistory): Promise<SnapshotInfo[]> {
  const list = [info, ...(await listSnapshots())];
  const keep = list.slice(0, MAX_SNAPSHOTS);
  const drop = list.slice(MAX_SNAPSHOTS);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('data', 'readwrite');
    const s = t.objectStore('data');
    s.put(history, `snapshot:${info.id}`);
    for (const d of drop) s.delete(`snapshot:${d.id}`);
    s.put(keep, 'snapshots');
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error);
  });
  return keep;
}

/** A Rotations result, saved under the request that made it (team, builds, style, search, goal); this browser only. */
export interface SavedSim<R = unknown> {
  key: string;
  /** When it was found (ms). */
  at: number;
  result: R;
  names: string[];
  ids: string[];
  /** Kept on top of History and never trimmed. */
  fav?: boolean;
  /** The player's own name for it, and a note. */
  name?: string;
  note?: string;
  /** A parsed run's reading (its presses), so its transcript can be edited and played again. */
  video?: unknown;
}
/** How many Rotations results to keep (each run, for a team's history); the oldest go first, favorites never. */
const MAX_SIMS = 100;

export const listSims = <R>(): Promise<SavedSim<R>[]> =>
  idb<SavedSim<R>[] | undefined>('data', 'readonly', (s) => s.get('sims')).then((l) => l ?? []).catch(() => []);

/** Saves a result after the others (the newest for a request is the one shown) and trims to MAX_SIMS. */
export async function saveSim<R>(entry: SavedSim<R>): Promise<void> {
  const list = await listSims<R>();
  list.push(entry);
  for (let i = 0; list.length > MAX_SIMS && i < list.length; ) if (list[i].fav) i++;
    else list.splice(i, 1);
  await idb('data', 'readwrite', (s) => s.put(list, 'sims'));
}

/** Changes a saved result (by its time): favorite, name, note; a parsed run's edited transcript and its new result. */
export async function updateSim(at: number, change: Partial<Pick<SavedSim, 'fav' | 'name' | 'note' | 'key' | 'result' | 'video'>>): Promise<void> {
  const list = await listSims();
  const x = list.find((e) => e.at === at);
  if (!x) return;
  Object.assign(x, change);
  await idb('data', 'readwrite', (s) => s.put(list, 'sims'));
}

/** Deletes a saved result (by its time). */
export async function deleteSim(at: number): Promise<void> {
  const list = await listSims();
  await idb('data', 'readwrite', (s) => s.put(list.filter((e) => e.at !== at), 'sims'));
}

/** The last gameplay video's reading (Rotations), so it can be played again without reading the video again. */
export const loadSimVideo = <V>(): Promise<V | undefined> => idb<V | undefined>('data', 'readonly', (s) => s.get('simVideo')).catch(() => undefined);
export const saveSimVideo = (v: unknown): Promise<void> => idb<unknown>('data', 'readwrite', (s) => s.put(v, 'simVideo')).then(() => undefined, () => undefined);

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
export const refreshBannerDb = (): Promise<BannerDb | null> => refreshFile<BannerDb>('banners.json', KEYS.bannerDb);

/** The banner schedule (ef-assets schedule.json, built from the official news feed). */
export function cachedSchedule(): Schedule {
  return readJson<Schedule>(KEYS.schedule) ?? (scheduleSnapshot as Schedule);
}

export const refreshSchedule = (): Promise<Schedule | null> => refreshFile<Schedule>('schedule.json', KEYS.schedule);

/** Fetches an ef-assets file and caches it; resolves null if offline or unchanged. */
async function refreshFile<T>(file: string, key: string): Promise<T | null> {
  for (const base of [EF_ASSETS, EF_ASSETS_CDN]) {
    try {
      const res = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(6000), cache: 'no-cache' });
      if (!res.ok) continue;
      const data = (await res.json()) as T;
      const before = localStorage.getItem(key);
      const after = JSON.stringify(data);
      if (before === after) return null;
      try {
        localStorage.setItem(key, after);
      } catch {
        /* cache is optional; the bundled snapshot covers offline use */
      }
      return data;
    } catch {
      /* try the next mirror */
    }
  }
  return null;
}

/**
 * Wiki data (ef-assets wiki/*.json, from endfield.wiki.gg). Too big for
 * localStorage, so it's fetched when a wiki page opens and left to the
 * browser's HTTP cache; a failed fetch is retried on the next visit.
 */
const wikiFiles = new Map<string, Promise<unknown>>();

export function loadWikiFile<T>(file: string, dir = 'wiki'): Promise<T> {
  const key = `${dir}/${file}`;
  let p = wikiFiles.get(key) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      for (const base of [EF_ASSETS, EF_ASSETS_CDN]) {
        try {
          const res = await fetch(`${base}/${key}`, { signal: AbortSignal.timeout(10000) });
          if (res.ok) return (await res.json()) as T;
        } catch {
          /* try the next mirror */
        }
      }
      wikiFiles.delete(key);
      throw new Error(`Couldn't load ${key}`);
    })();
    wikiFiles.set(key, p);
  }
  return p;
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

/**
 * The profile picture as uploaded (at most 1024px), with how it was framed
 * and what was painted outside its circle (cropper.ts), so Edit picture
 * starts from there. Synced as a Drive file of its own (ui/sync.ts) and in
 * downloaded backups. `at`: when it was saved; the newer copy wins.
 */
export interface AvatarEdit {
  at?: number;
  source: Blob;
  zoom: number;
  cx: number;
  cy: number;
  mask?: Blob;
}
const AVATAR_EDIT = 'avatar:edit';
export const loadAvatarEdit = (): Promise<AvatarEdit | undefined> =>
  idb<AvatarEdit | undefined>('images', 'readonly', (s) => s.get(AVATAR_EDIT)).catch(() => undefined);
export const saveAvatarEdit = (edit: AvatarEdit): Promise<void> => idb('images', 'readwrite', (s) => s.put(edit, AVATAR_EDIT));
export const deleteAvatarEdit = (): Promise<void> => idb<void>('images', 'readwrite', (s) => s.delete(AVATAR_EDIT)).catch(() => undefined);

/**
 * Profile pictures the player saved, newest first, so they can go back to
 * one (Settings → Personalization): each as shown, how it shows, and what
 * Edit picture needs. `current`: the one in use. This browser only.
 */
export interface SavedAvatar {
  id: string;
  at: number;
  blob: Blob;
  pop: boolean;
  box?: AvatarBox;
  edit?: AvatarEdit;
}
export const MAX_SAVED_AVATARS = 12;
const AVATAR_HISTORY = 'avatar:history';
export const loadAvatarHistory = (): Promise<{ list: SavedAvatar[]; current?: string }> =>
  idb<{ list: SavedAvatar[]; current?: string } | undefined>('images', 'readonly', (s) => s.get(AVATAR_HISTORY))
    .then((h) => h ?? { list: [] })
    .catch(() => ({ list: [] }));
export const saveAvatarHistory = (h: { list: SavedAvatar[]; current?: string }): Promise<void> =>
  idb('images', 'readwrite', (s) => s.put({ list: h.list.slice(0, MAX_SAVED_AVATARS), current: h.current }, AVATAR_HISTORY));

/** An AvatarEdit as JSON (data URLs), for Drive and backups. */
export interface AvatarEditJson {
  at: number;
  zoom: number;
  cx: number;
  cy: number;
  source: string;
  mask?: string;
}
export const avatarEditToJson = async (e: AvatarEdit): Promise<AvatarEditJson> => ({
  at: e.at ?? 0,
  zoom: e.zoom,
  cx: e.cx,
  cy: e.cy,
  source: await blobToDataUrl(e.source),
  ...(e.mask ? { mask: await blobToDataUrl(e.mask) } : {}),
});
export const avatarEditFromJson = async (j: AvatarEditJson): Promise<AvatarEdit> => ({
  at: j.at,
  zoom: j.zoom,
  cx: j.cx,
  cy: j.cy,
  source: await dataUrlToBlob(j.source),
  ...(j.mask ? { mask: await dataUrlToBlob(j.mask) } : {}),
});

/**
 * Art the player added to an operator's page (uploaded, or downloaded from a
 * link), in the same IndexedDB store as the profile pictures, keyed
 * `art:<operator id>:<id>`. Drive sync copies each picture to its own file
 * (ui/sync.ts); it isn't in the backup file. "Delete everything" clears it.
 */
const artRange = (opId: string) => IDBKeyRange.bound(`art:${opId}:`, `art:${opId}:\uffff`);
export async function loadArt(opId: string): Promise<{ key: string; blob: Blob }[]> {
  try {
    const keys = await idb<IDBValidKey[]>('images', 'readonly', (s) => s.getAllKeys(artRange(opId)));
    const blobs = await idb<Blob[]>('images', 'readonly', (s) => s.getAll(artRange(opId)));
    return keys.map((k, i) => ({ key: String(k), blob: blobs[i] })).filter((x) => x.blob);
  } catch {
    return [];
  }
}
export async function saveArt(opId: string, blob: Blob): Promise<string> {
  const key = `art:${opId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await idb('images', 'readwrite', (s) => s.put(blob, key));
  return key;
}
export const deleteArt = (key: string): Promise<void> => idb<void>('images', 'readwrite', (s) => s.delete(key)).catch(() => undefined);
/** Every operator's art, by key (for sync). */
export const allArtKeys = (): Promise<string[]> =>
  idb<IDBValidKey[]>('images', 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound('art:', 'art:\uffff')))
    .then((keys) => keys.map(String))
    .catch(() => []);
export const artBlob = (key: string): Promise<Blob | undefined> => idb<Blob | undefined>('images', 'readonly', (s) => s.get(key)).catch(() => undefined);
/** Stores a picture under a key it already has (one synced from another device). */
export const putArt = (key: string, blob: Blob): Promise<void> => idb('images', 'readwrite', (s) => s.put(blob, key));

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const dataUrlToBlob = (url: string): Promise<Blob> => fetch(url).then((r) => r.blob());
