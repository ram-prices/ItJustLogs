import { parseHistoryJson } from '../domain/parse';
import type { PullHistory } from '../domain/types';
import { importHistory, setImage, state, updateSettings } from '../state';
import { blobToDataUrl, dataUrlToBlob, type Settings } from '../store';
import { toast } from './common';

/** Import (any supported file) and backup export. */

interface Backup {
  app: 'itjustlogs';
  version: 1;
  exportedAt: string;
  history?: PullHistory | null;
  settings?: Settings;
  images?: Partial<Record<'avatar' | 'header', string>>;
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

export async function exportBackup(): Promise<void> {
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
  download(`itjustlogs_backup_${stamp()}.json`, JSON.stringify(backup));
}

/** Imports an ItJustLogs backup or any pull-history export (exporter, eftracker, track.py). */
export async function importText(text: string, source: string): Promise<void> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON.`);
  }
  if (data && typeof data === 'object' && (data as Backup).app === 'itjustlogs') {
    const b = data as Backup;
    if (b.history) await importHistory(b.history);
    if (b.settings) updateSettings(b.settings);
    for (const slot of ['avatar', 'header'] as const) {
      const img = b.images?.[slot];
      if (img?.startsWith('data:image/')) await setImage(slot, await dataUrlToBlob(img));
    }
    toast('Backup restored.');
    return;
  }
  const added = await importHistory(parseHistoryJson(text));
  const total = added.char + added.weap;
  toast(total ? `Imported ${added.char} operator and ${added.weap} arsenal pulls.` : 'Nothing new — everything in that file was already saved.');
}
