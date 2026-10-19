import { compareHistories, parseHistoryJson, type HistoryMatch } from '../domain/parse';
import type { PullHistory } from '../domain/types';
import { clearHistory, importHistory, setImage, state, updateSettings } from '../state';
import { blobToDataUrl, dataUrlToBlob, type ChangeTimes, type Settings } from '../store';
import { toast } from './common';

/** Import (any supported file) and backup export. */

/** A full backup. The Google Drive copy (ui/sync.ts) is one too, with change times. */
export interface Backup {
  app: 'itjustlogs';
  version: 1;
  exportedAt: string;
  history?: PullHistory | null;
  settings?: Settings;
  images?: Partial<Record<'avatar' | 'header', string>>;
  changed?: ChangeTimes;
}

const stamp = () => new Date().toISOString().slice(0, 10);

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportHistory(): void {
  if (state.history) download(`endfield_pulls_${stamp()}.json`, JSON.stringify(state.history, null, 2));
}

/** Everything saved in this browser: pulls, settings and pictures (as data URLs). */
export async function buildBackup(): Promise<Backup> {
  const backup: Backup = {
    app: 'itjustlogs',
    version: 1,
    exportedAt: new Date().toISOString(),
    history: state.history,
    settings: state.settings,
    images: {},
  };
  for (const slot of ['avatar', 'header'] as const) {
    const url = state.images[slot];
    if (url) backup.images![slot] = await blobToDataUrl(await fetch(url).then((r) => r.blob()));
  }
  return backup;
}

export async function exportBackup(): Promise<void> {
  download(`itjustlogs_backup_${stamp()}.json`, JSON.stringify(await buildBackup()));
}

/**
 * Thrown when a file doesn't look like the saved player's history (see
 * compareHistories): the app asks whether to replace, add anyway or cancel,
 * then calls importText again with that choice.
 */
export class ImportMismatch extends Error {
  readonly match: HistoryMatch;
  readonly text: string;
  readonly source: string;
  constructor(match: HistoryMatch, text: string, source: string) {
    super('This history does not match the saved one.');
    this.match = match;
    this.text = text;
    this.source = source;
  }
}

/** check: refuse a different player's file; merge: add it anyway; replace: delete saved pulls first. */
export type ImportMode = 'check' | 'merge' | 'replace';

async function guard(incoming: PullHistory, mode: ImportMode, text: string, source: string): Promise<void> {
  if (mode === 'replace') {
    await clearHistory();
    return;
  }
  if (mode === 'merge') return;
  const match = compareHistories(state.history, incoming);
  if (match.verdict === 'different' || match.verdict === 'noOverlap') throw new ImportMismatch(match, text, source);
}

/** Imports an ItJustLogs backup or any pull-history export (exporter, eftracker, track.py). */
export async function importText(text: string, source: string, mode: ImportMode = 'check'): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  if (data && typeof data === 'object' && (data as Backup).app === 'itjustlogs') {
    const b = data as Backup;
    if (b.history) {
      await guard(b.history, mode, text, source);
      await importHistory(b.history);
    }
    if (b.settings) updateSettings(b.settings);
    for (const slot of ['avatar', 'header'] as const) {
      const img = b.images?.[slot];
      if (img?.startsWith('data:image/')) await setImage(slot, await dataUrlToBlob(img));
    }
    toast('Backup restored.');
    return;
  }
  const incoming = parseHistoryJson(text);
  await guard(incoming, mode, text, source);
  const added = await importHistory(incoming);
  const total = added.char + added.weap;
  toast(total ? `Imported ${added.char} operator and ${added.weap} arsenal pulls.` : 'Nothing new — everything in that file was already saved.');
}
