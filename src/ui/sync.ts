import { compareHistories, mergeHistories, missingPulls } from '../domain/parse';
import * as drive from '../drive';
import { artChanged, clearHistory, importHistory, onChange, setImage, state, updateSettings } from '../state';
import { allArtKeys, artBlob, blobToDataUrl, dataUrlToBlob, deleteArt, loadSyncMeta, putArt, saveSyncMeta, type ChangeTimes } from '../store';
import { forgetLoadedArt } from './pages/art';
import { toast } from './common';
import { askSamePlayer } from './dialog';
import { buildBackup, type Backup } from './io';

/**
 * Optional Google Drive sync. The Drive copy is one full backup (ui/io.ts
 * Backup) in the app's hidden appDataFolder. A sync downloads it if another
 * device changed it, merges it into this browser, then uploads the result:
 * - pulls are merged like an import (mergeHistories), with the same
 *   same-player check (compareHistories) and dialog;
 * - settings and each picture are taken whole from whichever side changed
 *   them last (`changed` times; a tie goes to Drive, so a fresh device picks
 *   up the saved name and picture);
 * - Drive's file version is checked again right before uploading, so a
 *   newer copy from another device is merged in rather than overwritten;
 * - operator art isn't in that file: each picture is a file of its own,
 *   named by its key (syncArt), so the backup stays small and a picture is
 *   uploaded once, then downloaded only by devices without it.
 */

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'reconnect' | 'paused' | 'error';

let meta = loadSyncMeta();
let status: SyncStatus = !meta.on ? 'off' : drive.currentToken() ? 'idle' : 'reconnect';
let errorText = '';

const listeners = new Set<() => void>();
export const onSyncStatus = (fn: () => void): void => void listeners.add(fn);

function setStatus(s: SyncStatus, error = ''): void {
  if (s === status && error === errorText) return;
  status = s;
  errorText = error;
  listeners.forEach((fn) => fn());
}

const save = () => saveSyncMeta(meta);

export interface SyncView {
  status: SyncStatus;
  email?: string;
  lastSynced?: number;
  error: string;
}
export const syncView = (): SyncView => ({ status, email: meta.email, lastSynced: meta.lastSynced, error: errorText });
/** Signed in, but this visit needs a click before it can reach Drive. */
export const syncNeedsClick = (): boolean => drive.driveConfigured() && meta.on && (status === 'reconnect' || status === 'paused');
/** Sync is set up here (the header shows its button). */
export const syncShown = (): boolean => drive.driveConfigured() && meta.on;

// ---------------------------------------------------------------------------
// Merging the Drive copy into this browser
// ---------------------------------------------------------------------------

/** Set while Drive's data is written locally, so those writes don't count as the player's changes. */
let applying = false;

const imageDataUrl = async (slot: 'avatar' | 'header'): Promise<string | undefined> => {
  const url = state.images[slot];
  return url ? blobToDataUrl(await fetch(url).then((r) => r.blob())) : undefined;
};

/** Brings Drive's changes into this browser. False if the player cancelled over a different-looking history. */
async function applyRemote(remote: Backup): Promise<boolean> {
  applying = true;
  try {
    const h = remote.history;
    if (h && (h.characters.length || h.weapons.length)) {
      const match = compareHistories(state.history, h);
      let replace = false;
      if (match.verdict === 'different' || match.verdict === 'noOverlap') {
        const choice = await askSamePlayer(match, 'Your Google Drive copy', "Use Drive's pulls");
        if (choice === 'cancel') return false;
        replace = choice === 'replace';
      }
      if (replace) await clearHistory("Before using Drive's pulls");
      const { added } = mergeHistories(state.history ?? { characters: [], weapons: [] }, h);
      if (replace || added.char || added.weap) await importHistory(h, 'Before syncing from Google Drive');
    }

    const theirs: ChangeTimes = { settings: 0, avatar: 0, header: 0, ...remote.changed };
    if (remote.settings && theirs.settings >= meta.changed.settings) {
      const next = { ...state.settings, ...remote.settings };
      if (JSON.stringify(next) !== JSON.stringify(state.settings)) updateSettings(remote.settings);
      meta.changed.settings = theirs.settings;
    }
    for (const slot of ['avatar', 'header'] as const) {
      const img = remote.images?.[slot]?.startsWith('data:image/') ? remote.images[slot] : undefined;
      // A removed picture only wins if it was removed later than this one was set.
      if (img ? theirs[slot] < meta.changed[slot] : theirs[slot] <= meta.changed[slot]) continue;
      if (img !== (await imageDataUrl(slot))) await setImage(slot, img ? await dataUrlToBlob(img) : null);
      meta.changed[slot] = theirs[slot];
    }
    save();
    return true;
  } finally {
    applying = false;
  }
}

function parseRemote(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The copy in Google Drive is damaged. Sign out and back in to replace it.');
  }
  if (!data || typeof data !== 'object' || (data as Backup).app !== 'itjustlogs')
    throw new Error("The file in Google Drive isn't an ItJustLogs backup.");
  return data as Backup;
}

/** Hash of a backup without its timestamp, to tell whether anything changed. */
async function hashOf(b: Backup): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...b, exportedAt: '' }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function syncWith(token: string): Promise<void> {
  if (!meta.email) {
    meta.email = await drive.whoAmI(token);
    save();
  }
  let file = meta.fileId
    ? await drive.fileInfo(token, meta.fileId).catch((e) => {
        if (e instanceof drive.DriveNotFound) return null;
        throw e;
      })
    : null;
  file ??= await drive.findFile(token);

  for (let attempt = 0; attempt < 3; attempt++) {
    // Always read Drive's copy and merge its pulls in before uploading, even
    // when no other device changed it: that also brings back any pulls this
    // browser lost. The Drive copy's pulls can only ever grow.
    let remoteHash: string | undefined;
    let remote: Backup | null = null;
    if (file) {
      remote = parseRemote(await drive.download(token, file.id));
      remoteHash = await hashOf(remote);
      if (!(await applyRemote(remote))) {
        meta.paused = true;
        save();
        return;
      }
    }
    const local: Backup = { ...(await buildBackup()), changed: { ...meta.changed } };
    const hash = await hashOf(local);
    if (file && hash !== remoteHash) {
      // Guardrail: never upload a copy that's missing any pull Drive has.
      const lost = missingPulls(remote?.history, local.history);
      if (lost)
        throw new Error(
          `Sync stopped: uploading would have removed ${lost} pulls from your Google Drive copy, so nothing was uploaded. Your Drive copy is unchanged.`,
        );
      // Did another device upload while we were merging? Then merge that first.
      const now = await drive.fileInfo(token, file.id);
      if (now.version !== file.version) {
        file = now;
        continue;
      }
    }
    if (!file || hash !== remoteHash) {
      const body = JSON.stringify(local);
      file = file ? await drive.updateFile(token, file.id, body) : await drive.createFile(token, body);
    }
    meta = { ...meta, fileId: file.id, version: file.version, hash, lastSynced: Date.now(), paused: false };
    save();
    await syncArt(token);
    return;
  }
  throw new Error('Another device kept changing the Drive copy. Try Sync now again in a moment.');
}

/**
 * Operator art, after the backup file (so settings, with the list of removed
 * pictures, are already merged): pictures removed anywhere are removed in
 * Drive and here; Drive's pictures this browser lacks are downloaded; this
 * browser's that Drive lacks are uploaded.
 */
async function syncArt(token: string): Promise<void> {
  const remote = await drive.listArt(token);
  const removed = new Set(state.settings.deletedArt ?? []);
  const local = new Set(await allArtKeys());
  const inDrive = new Set(remote.map((f) => f.name));
  let changedHere = false;
  for (const f of remote) {
    if (removed.has(f.name)) await drive.deleteFile(token, f.id);
    else if (!local.has(f.name)) {
      await putArt(f.name, await drive.downloadArt(token, f.id));
      changedHere = true;
    }
  }
  for (const key of local) {
    if (removed.has(key)) {
      await deleteArt(key);
      changedHere = true;
    } else if (!inDrive.has(key)) {
      const blob = await artBlob(key);
      if (blob) await drive.uploadArt(token, key, blob);
    }
  }
  if (changedHere) {
    forgetLoadedArt();
    artChanged(true);
  }
}

// ---------------------------------------------------------------------------
// Running syncs
// ---------------------------------------------------------------------------

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * One sync at a time; a request during one runs once more afterwards.
 * `interactive`: started by a click, so it may open Google's sign-in window
 * (this must happen before the first await) and reports errors as toasts.
 */
async function runSync(interactive: boolean): Promise<void> {
  if (!meta.on) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      let token = drive.currentToken();
      if (!token) {
        if (!interactive) return setStatus('reconnect');
        token = await drive.requestToken({ email: meta.email });
      }
      setStatus('syncing');
      await syncWith(token);
      setStatus(meta.paused ? 'paused' : 'idle');
    } catch (e) {
      const message = (e as Error).message;
      const auth = e instanceof drive.DriveAuthError;
      setStatus(auth ? 'reconnect' : 'error', auth && !interactive ? '' : message);
      if (interactive) toast(message, 'error');
      else console.warn('Google Drive sync failed', e);
    } finally {
      running = null;
    }
  })();
  await running;
  if (again) {
    again = false;
    await runSync(false);
  }
}

function schedule(delay = 2000): void {
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(false), delay);
}

/** Sync now (also reconnects after the hour-long sign-in runs out, and resumes after a Cancel). Call from a click. */
export function syncNow(): Promise<void> {
  meta.paused = false;
  return runSync(true);
}

/** Call from a click: opens Google's sign-in window. */
export async function signIn(): Promise<void> {
  try {
    const token = await drive.requestToken({ chooseAccount: true });
    const email = await drive.whoAmI(token);
    // A different account has its own Drive copy: start tracking afresh.
    meta = { on: true, email, changed: meta.changed };
    save();
    await runSync(true);
    if (status === 'idle') toast(`Synced with Google Drive (${email}).`);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** Whether this browser is signed in to Drive sync (even if it needs a click to reconnect). */
export const syncIsOn = (): boolean => meta.on;

export function signOut(quiet = false): void {
  drive.revoke();
  clearTimeout(timer);
  meta = { on: false, changed: meta.changed };
  save();
  setStatus('off');
  if (!quiet) toast('Signed out of Google Drive. The copy there stays, and so does everything in this browser.');
}

/** Loads Google's sign-in script ahead of a click, so the sign-in window opens straight from it. */
export const preloadSync = (): void => void drive.loadGis().catch(() => undefined);

/** Wires sync into the app. Does nothing (and never contacts Google) unless the site has a client ID and the player turns it on. */
export function installSync(): void {
  if (!drive.driveConfigured()) return;
  onChange((c) => {
    if (applying) return;
    if (c === 'everything') {
      // Delete everything also signs this browser out; the Drive copy stays.
      drive.revoke();
      clearTimeout(timer);
      meta = loadSyncMeta();
      return setStatus('off');
    }
    if (c === 'settings' || c === 'avatar' || c === 'header') meta.changed[c] = Date.now();
    save();
    if (meta.on && !meta.paused) schedule();
  });
  // Coming back to the tab: pick up what other devices synced meanwhile.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !meta.on || meta.paused || !drive.currentToken()) return;
    if (Date.now() - (meta.lastSynced ?? 0) > 60_000) schedule(0);
  });
  if (!meta.on) return;
  preloadSync();
  if (meta.paused) setStatus('paused');
  else if (drive.currentToken()) schedule(0);
}
