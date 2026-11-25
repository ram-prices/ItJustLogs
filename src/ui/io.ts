import { compareHistories, parseHistoryJson, type HistoryMatch } from '../domain/parse';
import type { PullHistory } from '../domain/types';
import { artChanged, clearHistory, importHistory, setImage, state, updateSettings } from '../state';
import { allArtKeys, artBlob, avatarEditFromJson, avatarEditToJson, blobToDataUrl, dataUrlToBlob, listSims, loadAvatarEdit, putArt, restoreSims, saveAvatarEdit, type AvatarEditJson, type ChangeTimes, type SavedSim, type Settings } from '../store';
import { toast } from './common';
import { html, render } from './html';
import { forgetLoadedArt } from './pages/art';

/** Import (any supported file) and backup export. */

/** A full backup. The Google Drive copy (ui/sync.ts) is one too, with change times. */
export interface Backup {
  app: 'itjustlogs';
  version: 1;
  exportedAt: string;
  history?: PullHistory | null;
  settings?: Settings;
  images?: Partial<Record<'avatar' | 'header', string>>;
  /**
   * The player's operator art (pages/art.ts), by key, as data URLs. Only in
   * downloaded backups: the Drive copy leaves it out, since sync keeps each
   * picture as a file of its own.
   */
  art?: Record<string, string>;
  /** The profile picture's original and framing (Edit picture); downloaded backups only, like `art`. */
  avatarEdit?: AvatarEditJson;
  /**
   * Rotations results, simulator and parsed runs (store.ts `SavedSim`). Only in
   * downloaded backups: Drive carries parsed runs as files of their own.
   */
  sims?: SavedSim[];
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

/**
 * Everything saved in this browser: pulls, settings and pictures (as data
 * URLs). `art`: also the operator art (downloaded backups; not the Drive copy).
 */
export async function buildBackup(opts: { art?: boolean } = {}): Promise<Backup> {
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
  if (opts.art) {
    const edit = state.images.avatar ? await loadAvatarEdit() : undefined;
    if (edit) backup.avatarEdit = await avatarEditToJson(edit);
    backup.sims = await listSims();
    backup.art = {};
    for (const key of await allArtKeys()) {
      const blob = await artBlob(key);
      if (blob) backup.art[key] = await blobToDataUrl(blob);
    }
  }
  return backup;
}

export async function exportBackup(): Promise<void> {
  download(`itjustlogs_backup_${stamp()}.json`, JSON.stringify(await buildBackup({ art: true })));
}

/** A backup's operator art: the pictures this browser doesn't have (and wasn't told were removed). Returns how many. */
async function restoreArt(art: Record<string, string> | undefined): Promise<number> {
  if (!art) return 0;
  const have = new Set(await allArtKeys());
  const removed = new Set(state.settings.deletedArt ?? []);
  let added = 0;
  for (const [key, url] of Object.entries(art)) {
    if (!key.startsWith('art:') || !url.startsWith('data:image/') || have.has(key) || removed.has(key)) continue;
    await putArt(key, await dataUrlToBlob(url));
    added++;
  }
  if (added) {
    forgetLoadedArt();
    artChanged();
  }
  return added;
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

/**
 * Checks (or, on Replace, clears) the saved pulls before an import. Returns
 * the same-player verdict in check mode, null otherwise, or false when the
 * import must stop (the saved pulls couldn't be cleared; a toast said why).
 */
async function guard(incoming: PullHistory, mode: ImportMode, text: string, source: string): Promise<HistoryMatch['verdict'] | null | false> {
  if (mode === 'replace') {
    try {
      await clearHistory();
    } catch (e) {
      // No version history copy could be saved: nothing was deleted or imported.
      toast((e as Error).message, 'error');
      return false;
    }
    return null;
  }
  if (mode === 'merge') return null;
  const match = compareHistories(state.history, incoming);
  if (match.verdict === 'different' || match.verdict === 'noOverlap') throw new ImportMismatch(match, text, source);
  return match.verdict;
}

const hasPulls = (h: PullHistory | null | undefined): h is PullHistory => !!h && (h.characters?.length > 0 || h.weapons?.length > 0);

/**
 * A backup's settings without the deletion lists (`deletedArt`, `deletedRuns`):
 * sync deletes whatever those name, in Drive and on every device, so an old or
 * someone else's backup must never bring its own. This browser's stay.
 */
function importableSettings(s: unknown): Partial<Settings> | null {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out = { ...(s as Partial<Settings>) };
  delete out.deletedArt;
  delete out.deletedRuns;
  return out;
}

/**
 * A backup with no pulls, or from what may be another player: ask before its
 * settings, name and pictures replace this browser's. In-page, like
 * dialog.ts, since some browsers block confirm().
 */
function askUseBackupSettings(source: string, why: string): Promise<boolean> {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 class="heading-20" id="dialog-title">Use this backup's settings?</h2>
      <p class="copy-14">${source}: ${why} Using its settings replaces your name, profile and header pictures and every setting saved here.</p>
      <div class="dialog-actions">
        <button class="btn secondary sm" data-choice="keep">Keep mine</button>
        <button class="btn primary sm" data-choice="use">Use the backup's</button>
      </div>
    </div>`,
  );
  return new Promise((resolve) => {
    const close = (use: boolean) => {
      backdrop.remove();
      resolve(use);
    };
    backdrop.addEventListener('click', (ev) => {
      const choice = (ev.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
      if (ev.target === backdrop || choice === 'keep') close(false);
      else if (choice === 'use') close(true);
    });
    backdrop.addEventListener('keydown', (ev) => ev.key === 'Escape' && close(false));
    document.body.append(backdrop);
    backdrop.querySelector<HTMLElement>('[data-choice="keep"]')!.focus();
  });
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
    // Its settings, name and pictures replace this browser's only when its pulls are this player's
    // (or the player chose to replace theirs with them); otherwise the player is asked first.
    let why: string | null = null;
    if (hasPulls(b.history)) {
      const verdict = await guard(b.history, mode, text, source);
      if (verdict === false) return;
      await importHistory(b.history);
      if (mode === 'merge') why = "Its pulls didn't look like the ones saved here, so it may be another player's backup.";
    } else {
      why = "It has no pulls, so there's no way to tell whether it's from this player.";
    }
    const settings = importableSettings(b.settings);
    const images = (['avatar', 'header'] as const).filter((slot) => b.images?.[slot]?.startsWith('data:image/'));
    const changes = images.length > 0 || (!!settings && JSON.stringify({ ...state.settings, ...settings }) !== JSON.stringify(state.settings));
    const useProfile = changes && (why === null || (await askUseBackupSettings(source, why)));
    if (useProfile) {
      if (settings) updateSettings(settings);
      for (const slot of images) await setImage(slot, await dataUrlToBlob(b.images![slot]!));
      if (b.avatarEdit?.source?.startsWith('data:image/') && images.includes('avatar')) await saveAvatarEdit(await avatarEditFromJson(b.avatarEdit));
    }
    const sims = Array.isArray(b.sims) ? await restoreSims(b.sims) : 0;
    const art = await restoreArt(b.art);
    const extra = [
      sims ? `${sims} saved ${sims === 1 ? 'run' : 'runs'}` : '',
      art ? `${art} operator ${art === 1 ? 'picture' : 'pictures'}` : '',
    ].filter(Boolean);
    const kept = changes && !useProfile ? ' Your settings, name and pictures were kept.' : '';
    toast((extra.length ? `Export imported, with ${extra.join(' and ')}.` : 'Export imported.') + kept);
    return;
  }
  const incoming = parseHistoryJson(text);
  if ((await guard(incoming, mode, text, source)) === false) return;
  const added = await importHistory(incoming);
  const total = added.char + added.weap;
  toast(total ? `Imported ${added.char} operator and ${added.weap} arsenal pulls.` : 'Nothing new — everything in that file was already saved.');
}
