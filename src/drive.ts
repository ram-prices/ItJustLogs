/**
 * Google Drive, for the optional sync. The only hosts this talks to are
 * Google's: accounts.google.com (Google Identity Services, which signs the
 * player in and hands back an access token) and www.googleapis.com (Drive).
 * The scope is drive.appdata, which only reaches a hidden folder that belongs
 * to this app; it can't see or touch the player's own files.
 *
 * Tokens last an hour and there's no backend to refresh them, so each visit
 * needs one click (Sync now or Sign in) to get a new one; Google skips the
 * consent screen after the first time. The token is kept in sessionStorage
 * so a reload doesn't need another click, and never in localStorage.
 */

export const CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
/** Sync is only offered when the site was built with an OAuth client ID (and on https or localhost: it needs Web Crypto). */
export const driveConfigured = (): boolean => !!CLIENT_ID && isSecureContext;

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'itjustlogs-backup.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'ijl.driveToken';

// --- Google Identity Services: just the parts used here -------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): TokenClient;
      hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: Gis;
  }
}

let gisPromise: Promise<Gis> | null = null;

/** Loads Google's sign-in script. Only called once sync is shown or turned on, so other visits never contact Google. */
export function loadGis(): Promise<Gis> {
  gisPromise ??= new Promise<Gis>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google);
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true });
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in did not load.')));
    s.onerror = () => {
      gisPromise = null;
      s.remove();
      reject(new Error("Couldn't reach Google. Check your connection or any blocker, then try again."));
    };
    document.head.append(s);
  });
  return gisPromise;
}

export class DriveAuthError extends Error {}

let memToken: { token: string; expires: number } | null = null;
let client: TokenClient | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

function settle(fn: (p: NonNullable<typeof pending>) => void): void {
  const p = pending;
  pending = null;
  if (p) fn(p);
}

function tokenClient(gis: Gis): TokenClient {
  client ??= gis.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (r) => {
      if (r.error || !r.access_token) return settle((p) => p.reject(new DriveAuthError(r.error_description || r.error || 'Sign-in failed.')));
      if (!gis.accounts.oauth2.hasGrantedAllScopes(r, SCOPE))
        return settle((p) => p.reject(new DriveAuthError('Allow ItJustLogs to use its own app data in Google Drive, or sync can\'t work.')));
      const expires = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60_000;
      try {
        sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, expires }));
      } catch {
        /* keep it in memory only */
      }
      memToken = { token: r.access_token, expires };
      settle((p) => p.resolve(r.access_token!));
    },
    error_callback: (e) =>
      settle((p) =>
        p.reject(
          new DriveAuthError(
            e.type === 'popup_failed_to_open'
              ? 'The Google sign-in window was blocked. Allow pop-ups for this site and try again.'
              : e.type === 'popup_closed'
                ? 'Sign-in was cancelled.'
                : e.message || 'Sign-in failed.',
          ),
        ),
      ),
  });
  return client;
}

/** A still-valid token from this tab, if any. */
export function currentToken(): string | null {
  if (!memToken) {
    try {
      memToken = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null');
    } catch {
      memToken = null;
    }
  }
  return memToken && memToken.expires > Date.now() ? memToken.token : null;
}

export function forgetToken(): void {
  memToken = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing saved */
  }
}

/**
 * Opens Google's sign-in window. Call it straight from a click: browsers block
 * the window otherwise. `chooseAccount` shows the account picker (first sign-in);
 * otherwise `email` is preselected and the window closes by itself.
 */
export async function requestToken(opts: { chooseAccount?: boolean; email?: string } = {}): Promise<string> {
  const c = tokenClient(window.google?.accounts?.oauth2 ? window.google : await loadGis());
  settle((p) => p.reject(new DriveAuthError('Sign-in was cancelled.')));
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    c.requestAccessToken(opts.chooseAccount ? { prompt: 'select_account' } : { prompt: '', hint: opts.email });
  });
}

/** Signs out: withdraws ItJustLogs' access to Drive. The Drive copy stays. */
export function revoke(): void {
  const t = currentToken();
  forgetToken();
  if (t && window.google) window.google.accounts.oauth2.revoke(t);
}

// --- Drive REST ------------------------------------------------------------

export interface DriveFile {
  id: string;
  /** Goes up on every change to the file, from any device. */
  version: string;
  modifiedTime: string;
}
const FIELDS = 'id,version,modifiedTime';

/** 404: the file is gone (the player deleted the app's hidden data in Drive). */
export class DriveNotFound extends Error {}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  if (res.ok) return res;
  if (res.status === 401) {
    forgetToken();
    throw new DriveAuthError('Your Google sign-in expired.');
  }
  if (res.status === 404) throw new DriveNotFound('Not found in Google Drive.');
  let detail = '';
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* no JSON body */
  }
  throw new Error(`Google Drive said no (${res.status})${detail ? `: ${detail}` : '.'}`);
}

export async function whoAmI(token: string): Promise<string> {
  const r = await call(token, `${API}/about?fields=user(emailAddress)`);
  return ((await r.json()) as { user?: { emailAddress?: string } }).user?.emailAddress ?? '';
}

/** The app's backup file, newest first if two devices once created one at the same time. */
export async function findFile(token: string): Promise<DriveFile | null> {
  const q = encodeURIComponent(`name = '${FILE_NAME}' and trashed = false`);
  const r = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&pageSize=10&fields=files(${FIELDS})`);
  return ((await r.json()) as { files: DriveFile[] }).files[0] ?? null;
}

export const fileInfo = async (token: string, id: string): Promise<DriveFile> =>
  (await call(token, `${API}/files/${id}?fields=${FIELDS}`)).json();

export const download = async (token: string, id: string): Promise<string> =>
  (await call(token, `${API}/files/${id}?alt=media`, { cache: 'no-store' })).text();

export async function createFile(token: string, body: string): Promise<DriveFile> {
  const boundary = `ijl${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  return r.json();
}

export async function updateFile(token: string, id: string, body: string): Promise<DriveFile> {
  const r = await call(token, `${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return r.json();
}

// --- Operator art: one file per picture, named by its IndexedDB key ---------

export interface DriveArt {
  id: string;
  name: string;
}

/** Every operator art file in the app's hidden folder. */
export async function listArt(token: string): Promise<DriveArt[]> {
  const out: DriveArt[] = [];
  const q = encodeURIComponent("name contains 'art:' and trashed = false");
  for (let page: string | undefined = ''; page !== undefined; ) {
    const r = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&pageSize=1000&fields=nextPageToken,files(id,name)${page ? `&pageToken=${page}` : ''}`);
    const body = (await r.json()) as { files: DriveArt[]; nextPageToken?: string };
    out.push(...body.files.filter((f) => f.name.startsWith('art:')));
    page = body.nextPageToken;
  }
  return out;
}

export async function uploadArt(token: string, name: string, blob: Blob): Promise<void> {
  const boundary = `ijl${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: blob.type || 'image/webp' });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${blob.type || 'image/webp'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
}

export const downloadArt = async (token: string, id: string): Promise<Blob> => (await call(token, `${API}/files/${id}?alt=media`)).blob();

/**
 * Version history copies in Drive: one JSON file each, named
 * "snapshot:<id>", with what Version history lists in its appProperties
 * (so listing them downloads none).
 */
export interface DriveSnapshot {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

export async function listSnapshotFiles(token: string): Promise<DriveSnapshot[]> {
  const out: DriveSnapshot[] = [];
  const q = encodeURIComponent("name contains 'snapshot:' and trashed = false");
  for (let page: string | undefined = ''; page !== undefined; ) {
    const r = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,appProperties)${page ? `&pageToken=${page}` : ''}`);
    const body = (await r.json()) as { files: DriveSnapshot[]; nextPageToken?: string };
    out.push(...body.files.filter((f) => f.name.startsWith('snapshot:')));
    page = body.nextPageToken;
  }
  return out;
}

export async function uploadSnapshot(token: string, name: string, props: Record<string, string>, json: string): Promise<void> {
  const boundary = `ijl${crypto.randomUUID()}`;
  const meta = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json', appProperties: props });
  await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`,
  });
}

/** Files named exactly `name` (the profile picture's original: "avatar-edit"), with their appProperties. */
export async function listNamed(token: string, name: string): Promise<DriveSnapshot[]> {
  const q = encodeURIComponent(`name = '${name}' and trashed = false`);
  const r = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&pageSize=100&fields=files(id,name,appProperties)`);
  return ((await r.json()) as { files: DriveSnapshot[] }).files;
}

export const downloadText = async (token: string, id: string): Promise<string> => (await call(token, `${API}/files/${id}?alt=media`)).text();

export const deleteFile = async (token: string, id: string): Promise<void> => {
  await call(token, `${API}/files/${id}`, { method: 'DELETE' }).catch((e) => {
    if (!(e instanceof DriveNotFound)) throw e;
  });
};
