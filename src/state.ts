import { withoutRetiredPlaces } from './domain/artMeta';
import { withStorageItems } from './domain/storage';
import { analyze, type Analysis } from './domain/analyze';
import { mergeHistories, parseTimestamp } from './domain/parse';
import { guessServer, type Schedule, type Server } from './domain/schedule';
import type { BannerDb, PullHistory } from './domain/types';
import * as store from './store';
import { sanitizeSettings } from './settingsSanitize';

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

/**
 * What a change touched: Google Drive sync uploads after the player's own
 * changes. Change listeners hear it before the redraw, so the header already
 * shows the sync it queued.
 */
export type Change = 'history' | 'historyCleared' | 'settings' | store.ImageSlot | 'art' | 'everything';
const changeListeners = new Set<(c: Change) => void>();
export const onChange = (fn: (c: Change) => void): void => void changeListeners.add(fn);
const changed = (c: Change) => changeListeners.forEach((fn) => fn(c));

/** Operator art changed (pages/art.ts): redraw, and (unless sync brought it) let sync upload it. */
export function artChanged(fromSync = false): void {
  if (!fromSync) changed('art');
  emit();
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
  return restoreCopy(copy);
}

/** Replaces the pulls with `copy` (from version history here or in Google Drive), saving the current pulls first. */
export async function restoreCopy(copy: PullHistory): Promise<{ chars: number; weaps: number; savedCurrent: boolean }> {
  await ensureHistoryRead();
  const savedCurrent = await snapshot('Before restoring an older copy');
  await store.saveHistory(copy);
  state.history = copy;
  recompute();
  changed('history');
  emit();
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
    historyUnread = false;
  } catch (e) {
    historyUnread = true;
    console.warn('Could not read saved history', e);
  }
  // Imports before the seqId fix could add a seqId-less copy of pulls already saved: drop them once.
  if (state.history) {
    const fixed = mergeHistories(state.history, { characters: [], weapons: [] }).history;
    if (shapeOf(fixed) !== shapeOf(state.history)) {
      await snapshot('Before removing duplicate pulls');
      await store.saveHistory(fixed);
      state.history = fixed;
      changed('history');
    }
  }
  recompute();
}

/** Record counts and how many carry a seqId: tells whether a merge repaired or filled anything. */
const shapeOf = (h: PullHistory): string =>
  [h.characters, h.weapons].map((list) => `${list.length}/${list.filter((r) => r.seqId != null && r.seqId !== '').length}`).join(',');

/** True while the saved pulls couldn't be read (store.ts openDb gave up): what's shown isn't what's saved. */
let historyUnread = false;

/**
 * Before anything writes the pulls: if they couldn't be read at start, read them now, so a write
 * never replaces saved pulls the page never saw. Throws when they still can't be read.
 */
async function ensureHistoryRead(): Promise<void> {
  if (!historyUnread) return;
  try {
    state.history = await store.loadHistory();
  } catch (e) {
    throw new Error("Your saved pulls couldn't be opened, so nothing was changed. Reload the page and try again.", { cause: e });
  }
  historyUnread = false;
  recompute();
  emit();
}

/** Merges an imported file onto saved history. Returns how many new pulls it added. */
export async function importHistory(incoming: PullHistory, reason = 'Before import'): Promise<{ char: number; weap: number }> {
  await ensureHistoryRead();
  const base = state.history ?? { characters: [], weapons: [] };
  const { history, added } = mergeHistories(base, incoming);
  // A merge that adds nothing can still drop old duplicates or fill in seqIds: sync that too.
  const altered = added.char || added.weap || shapeOf(history) !== shapeOf(base);
  if (altered) await snapshot(reason);
  await store.saveHistory(history);
  state.history = history;
  recompute();
  if (altered) changed('history');
  emit();
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
  // Patches can come from a backup or Drive: sanitized like everything loaded (settingsSanitize.ts).
  state.settings = withStorageItems(withoutRetiredPlaces(sanitizeSettings({ ...state.settings, ...patch })));
  store.saveSettings(state.settings);
  changed('settings');
  emit();
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
  changed(slot);
  emit();
}

export async function loadImages(): Promise<void> {
  for (const slot of ['avatar', 'header'] as const) {
    const blob = await store.loadImage(slot);
    if (blob) state.images[slot] = URL.createObjectURL(blob);
  }
  emit();
}

/**
 * Deletes the imported pull history only; name, picture and settings are kept.
 * Throws, deleting nothing, when there are pulls and no version history copy
 * of them could be saved: deleting them then couldn't be undone.
 */
export async function clearHistory(reason = 'Before deleting pull history'): Promise<void> {
  await ensureHistoryRead();
  const h = state.history;
  if (!(await snapshot(reason)) && h && (h.characters.length || h.weapons.length))
    throw new Error("Your pulls weren't deleted: a version history copy of them couldn't be saved first, so it couldn't be undone. Try again, or download a backup first.");
  await store.clearHistory();
  state.history = null;
  recompute();
  changed('historyCleared');
  emit();
}

/** Deletes everything this site saved in the browser and resets the page to its empty state. */
export async function clearEverything(): Promise<void> {
  await store.clearAll();
  state.history = null;
  state.snapshots = [];
  state.images = {};
  state.settings = store.loadSettings();
  recompute();
  changed('everything');
  emit();
}
