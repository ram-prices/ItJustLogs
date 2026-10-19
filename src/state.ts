import { analyze, type Analysis } from './domain/analyze';
import { mergeHistories } from './domain/parse';
import type { BannerDb, PullHistory } from './domain/types';
import * as store from './store';

interface State {
  history: PullHistory | null;
  db: BannerDb;
  analysis: Analysis | null;
  settings: store.Settings;
  images: Partial<Record<store.ImageSlot, string>>;
}

export const state: State = {
  history: null,
  db: store.cachedBannerDb(),
  analysis: null,
  settings: store.loadSettings(),
  images: {},
};

const listeners = new Set<() => void>();
export const subscribe = (fn: () => void): void => void listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

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
export async function importHistory(incoming: PullHistory): Promise<{ char: number; weap: number }> {
  const base = state.history ?? { characters: [], weapons: [] };
  const { history, added } = mergeHistories(base, incoming);
  await store.saveHistory(history);
  state.history = history;
  recompute();
  emit();
  return added;
}

export function setBannerDb(db: BannerDb): void {
  state.db = db;
  recompute();
  emit();
}

export function updateSettings(patch: Partial<store.Settings>): void {
  state.settings = { ...state.settings, ...patch };
  store.saveSettings(state.settings);
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
  emit();
}

export async function loadImages(): Promise<void> {
  for (const slot of ['avatar', 'header'] as const) {
    const blob = await store.loadImage(slot);
    if (blob) state.images[slot] = URL.createObjectURL(blob);
  }
  emit();
}

/** Deletes the imported pull history only; name, picture and settings are kept. */
export async function clearHistory(): Promise<void> {
  await store.clearHistory();
  state.history = null;
  recompute();
  emit();
}

/** Deletes everything this site saved in the browser and resets the page to its empty state. */
export async function clearEverything(): Promise<void> {
  await store.clearAll();
  state.history = null;
  state.images = {};
  state.settings = store.loadSettings();
  recompute();
  emit();
}
