import { analyze, type Analysis } from './domain/analyze';
import { mergeHistories, parseTimestamp } from './domain/parse';
import { guessServer, type Schedule, type Server } from './domain/schedule';
import type { BannerDb, PullHistory } from './domain/types';
import * as store from './store';

interface State {
  history: PullHistory | null;
  /** Version history (newest first); see store.ts. */
  snapshots: store.SnapshotInfo[];
  db: BannerDb;
  schedule: Schedule;
  analysis: Analysis | null;
  settings: store.Settings;
  images: Partial<Record<store.ImageSlot, string>>;
}

export const state: State = {
  history: null,
  snapshots: [],
  db: store.cachedBannerDb(),
  schedule: store.cachedSchedule(),
  analysis: null,
  settings: store.loadSettings(),
  images: {},
};

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void): void => void listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

/** What a change touched: Google Drive sync uploads after the player's own changes. */
export type Change = 'history' | 'historyCleared' | 'settings' | store.ImageSlot | 'art' | 'everything';
const changeListeners = new Set<(c: Change) => void>();
export const onChange = (fn: (c: Change) => void): void => void changeListeners.add(fn);
const changed = (c: Change) => changeListeners.forEach((fn) => fn(c));

/** Operator art changed (pages/art.ts): redraw, and (unless sync brought it) let sync upload it. */
export function artChanged(fromSync = false): void {
  emit();
  if (!fromSync) changed('art');
}

/** Newest pull time in a history (ms), 0 if empty. */
function newestPull(h: PullHistory): number {
  let max = 0;
  for (const r of [...h.characters, ...h.weapons]) max = Math.max(max, parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp));
  return max;
}

/**
 * Saves the current pulls to version history before a change. Skips an empty
 * history and a copy identical to the last one. Never blocks the change: a
 * failed copy only logs a warning. True if the current pulls are in version
 * history afterwards (newly saved or already the latest copy).
 */
async function snapshot(reason: string): Promise<boolean> {
  const h = state.history;
  if (!h || !(h.characters.length || h.weapons.length)) return false;
  const info: store.SnapshotInfo = {
    id: `${Date.now()}`,
    at: Date.now(),
    reason,
    chars: h.characters.length,
    weaps: h.weapons.length,
    newest: newestPull(h),
  };
  const last = state.snapshots[0];
  if (last && last.chars === info.chars && last.weaps === info.weaps && last.newest === info.newest) return true;
  try {
    state.snapshots = await store.saveSnapshot(info, h);
    return true;
  } catch (e) {
    console.warn('Could not save a version history copy', e);
    return false;
  }
}

/** Loads the version history list. Call once at startup. */
export async function loadSnapshots(): Promise<void> {
  state.snapshots = await store.listSnapshots();
  emit();
}

/**
 * Replaces the pulls with an older copy from version history. The current
 * pulls are saved to version history first, so a restore can be undone too.
 */
export async function restoreSnapshot(id: string): Promise<{ chars: number; weaps: number; savedCurrent: boolean }> {
  const copy = await store.loadSnapshot(id);
  if (!copy) throw new Error('That copy is no longer in version history.');
  const savedCurrent = await snapshot('Before restoring an older copy');
  await store.saveHistory(copy);
  state.history = copy;
  recompute();
  emit();
  changed('history');
  return { chars: copy.characters.length, weaps: copy.weapons.length, savedCurrent };
}

function recompute(): void {
  const h = state.history;
  state.analysis = h && (h.characters.length || h.weapons.length) ? analyze(h, state.db) : null;
}

/** Loads saved history from IndexedDB. Call once before the first render. */
export async function loadSavedHistory(): Promise<void> {
  try {
    state.history = await store.loadHistory();
  } catch (e) {
    console.warn('Could not read saved history', e);
  }
  recompute();
}

/** Merges an imported file onto saved history. Returns how many new pulls it added. */
export async function importHistory(incoming: PullHistory, reason = 'Before import'): Promise<{ char: number; weap: number }> {
  const base = state.history ?? { characters: [], weapons: [] };
  const { history, added } = mergeHistories(base, incoming);
  if (added.char || added.weap) await snapshot(reason);
  await store.saveHistory(history);
  state.history = history;
  recompute();
  emit();
  if (added.char || added.weap) changed('history');
  return added;
}

export function setBannerDb(db: BannerDb): void {
  state.db = db;
  recompute();
  emit();
}

export function setSchedule(schedule: Schedule): void {
  state.schedule = schedule;
  emit();
}

/** The server whose times to show: the player's choice, else a guess from their time zone. */
export const currentServer = (): Server => state.settings.server ?? guessServer();

export function updateSettings(patch: Partial<store.Settings>): void {
  state.settings = { ...state.settings, ...patch };
  store.saveSettings(state.settings);
  emit();
  changed('settings');
}

export async function setImage(slot: store.ImageSlot, blob: Blob | null): Promise<void> {
  if (state.images[slot]) URL.revokeObjectURL(state.images[slot]!);
  if (blob) {
    await store.saveImage(slot, blob);
    state.images[slot] = URL.createObjectURL(blob);
  } else {
    await store.deleteImage(slot);
    delete state.images[slot];
  }
  emit();
  changed(slot);
}

export async function loadImages(): Promise<void> {
  for (const slot of ['avatar', 'header'] as const) {
    const blob = await store.loadImage(slot);
    if (blob) state.images[slot] = URL.createObjectURL(blob);
  }
  emit();
}

/** Deletes the imported pull history only; name, picture and settings are kept. */
export async function clearHistory(reason = 'Before deleting pull history'): Promise<void> {
  await snapshot(reason);
  await store.clearHistory();
  state.history = null;
  recompute();
  emit();
  changed('historyCleared');
}

/** Deletes everything this site saved in the browser and resets the page to its empty state. */
export async function clearEverything(): Promise<void> {
  await store.clearAll();
  state.history = null;
  state.snapshots = [];
  state.images = {};
  state.settings = store.loadSettings();
  recompute();
  emit();
  changed('everything');
}
