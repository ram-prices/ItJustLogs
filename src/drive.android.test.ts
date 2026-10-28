import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AndroidBridge } from './drive';

// The Android app's bridge stands in for Google Identity Services.
function bridge(reply: () => Promise<{ access_token: string; expires_in: number }>) {
  return {
    getDriveToken: vi.fn((_: { interactive: boolean; email?: string }) => reply()),
    clearDriveToken: vi.fn(),
    signOut: vi.fn(),
  } satisfies AndroidBridge;
}

function stub(b?: AndroidBridge) {
  const saved = new Map<string, string>();
  vi.stubGlobal('window', { IJLAndroid: b });
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
    removeItem: (k: string) => void saved.delete(k),
  });
}

const load = () => import('./drive');

describe('Drive tokens in the Android app', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('takes the token from the bridge instead of Google Identity Services', async () => {
    const b = bridge(async () => ({ access_token: 'tok', expires_in: 900 }));
    stub(b);
    const drive = await load();
    expect(drive.driveConfigured()).toBe(true);
    expect(drive.refreshesSilently()).toBe(true);
    expect(await drive.requestToken({ email: 'a@b.c' })).toBe('tok');
    expect(b.getDriveToken).toHaveBeenCalledWith({ interactive: true, email: 'a@b.c' });
    expect(drive.currentToken()).toBe('tok');
  });

  it('first sign-in lets Google pick the account', async () => {
    const b = bridge(async () => ({ access_token: 'tok', expires_in: 900 }));
    stub(b);
    await (await load()).requestToken({ chooseAccount: true, email: 'a@b.c' });
    expect(b.getDriveToken).toHaveBeenCalledWith({ interactive: true, email: undefined });
  });

  it('silent: no screen, null when the app needs a sign-in', async () => {
    const b = bridge(async () => {
      throw new Error('Sign in to Google Drive again.');
    });
    stub(b);
    const drive = await load();
    expect(await drive.silentToken('a@b.c')).toBeNull();
    expect(b.getDriveToken).toHaveBeenCalledWith({ interactive: false, email: 'a@b.c' });
    await expect(drive.requestToken()).rejects.toBeInstanceOf(drive.DriveAuthError);
  });

  it('sign-out goes to the app', async () => {
    const b = bridge(async () => ({ access_token: 'tok', expires_in: 900 }));
    stub(b);
    const drive = await load();
    await drive.requestToken();
    drive.revoke('a@b.c');
    expect(b.signOut).toHaveBeenCalledWith('a@b.c');
    expect(drive.currentToken()).toBeNull();
  });

  it('a browser without the bridge is unchanged', async () => {
    stub();
    const drive = await load();
    expect(drive.refreshesSilently()).toBe(false);
    expect(await drive.silentToken()).toBeNull();
  });
});
