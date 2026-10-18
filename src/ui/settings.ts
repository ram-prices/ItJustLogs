import { parseHistoryJson } from '../domain/parse';
import type { PullHistory } from '../domain/types';
import { state, updateSettings, setImage, clearEverything, importHistory } from '../state';
import { blobToDataUrl, dataUrlToBlob, type Settings, type ThemePref } from '../store';
import { toast } from './common';
import { fmtInt, html, type Html } from './html';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function settingsView(): Html {
  const s = state.settings;
  const h = state.history;
  const count = h ? h.characters.length + h.weapons.length : 0;
  const theme = (v: ThemePref, label: string) =>
    html`<button data-action="theme" data-value="${v}" aria-pressed="${s.theme === v}">${label}</button>`;

  return html`
    <div class="page-head"><div><h1>Settings</h1><p>Everything is stored in this browser only.</p></div></div>
    <div class="settings">
      <section class="card card-pad">
        <h2>Appearance</h2>
        <div class="setting">
          <div><h4>Theme</h4><p>Follow your system or pick one.</p></div>
          <div class="segmented">${theme('system', 'System')}${theme('light', 'Light')}${theme('dark', 'Dark')}</div>
        </div>
        <div class="setting">
          <div><h4>Always show pull times</h4><p>Otherwise times appear when you hover a pull.</p></div>
          <input class="switch" type="checkbox" data-setting="showTimestamps" ${s.showTimestamps ? 'checked' : ''} aria-label="Always show pull times" />
        </div>
      </section>

      <section class="card card-pad">
        <h2>Profile</h2>
        <div class="setting">
          <div><h4>Display name</h4><p>Shown in the header.</p></div>
          <input class="input" data-setting="displayName" value="${s.displayName}" placeholder="Endministrator" maxlength="40" />
        </div>
        <div class="setting">
          <div><h4>Avatar</h4><p>Square images look best.</p></div>
          <div class="actions">
            <label class="btn">Choose image<input type="file" accept="image/*" data-image="avatar" hidden /></label>
            ${state.images.avatar ? html`<button class="btn" data-action="clear-image" data-slot="avatar">Remove</button>` : ''}
          </div>
        </div>
        <div class="setting">
          <div><h4>Header image</h4><p>A wide image works best, around 1600×300.</p></div>
          <div class="actions">
            <label class="btn">Choose image<input type="file" accept="image/*" data-image="header" hidden /></label>
            ${state.images.header ? html`<button class="btn" data-action="clear-image" data-slot="header">Remove</button>` : ''}
          </div>
        </div>
      </section>

      <section class="card card-pad">
        <h2>Data</h2>
        <div class="setting">
          <div><h4>Pull history</h4><p>${count ? `${fmtInt(count)} records saved in this browser.` : 'Nothing saved yet.'}</p></div>
          <div class="actions">
            <button class="btn" data-action="import">Import file…</button>
            ${count ? html`<button class="btn" data-action="export-history">Download pulls</button>` : ''}
          </div>
        </div>
        <div class="setting">
          <div><h4>Full backup</h4><p>Pulls, settings and images in one file. Import it on another device or browser.</p></div>
          <div class="actions"><button class="btn" data-action="export-backup">Download backup</button></div>
        </div>
        <div class="setting">
          <div><h4>Clear everything</h4><p>Removes pulls, settings and images from this browser.</p></div>
          <button class="btn btn-danger" data-action="clear-all">Clear data</button>
        </div>
      </section>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

interface Backup {
  app: 'itjustlogs';
  version: 1;
  exportedAt: string;
  history: PullHistory | null;
  settings: Settings;
  images: Partial<Record<'avatar' | 'header', string>>;
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
  const images: Backup['images'] = {};
  for (const slot of ['avatar', 'header'] as const) {
    const url = state.images[slot];
    if (url) images[slot] = await blobToDataUrl(await fetch(url).then((r) => r.blob()));
  }
  const backup: Backup = {
    app: 'itjustlogs',
    version: 1,
    exportedAt: new Date().toISOString(),
    history: state.history,
    settings: state.settings,
    images,
  };
  download(`itjustlogs_backup_${stamp()}.json`, JSON.stringify(backup));
}

/** Imports any supported file: an ItJustLogs backup or any pull-history export. */
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
  toast(
    total
      ? `Added ${fmtInt(added.char)} operator and ${fmtInt(added.weap)} arsenal pulls.`
      : 'Everything in that file was already saved — nothing new to add.',
  );
}

export async function handleSettingsAction(action: string, el: HTMLElement): Promise<boolean> {
  switch (action) {
    case 'theme':
      updateSettings({ theme: el.dataset.value as ThemePref });
      return true;
    case 'export-history':
      exportHistory();
      return true;
    case 'export-backup':
      await exportBackup();
      return true;
    case 'clear-image':
      await setImage(el.dataset.slot as 'avatar' | 'header', null);
      return true;
    case 'clear-all':
      if (confirm('Remove all pulls, settings and images from this browser? Download a backup first if you want to keep them.')) {
        await clearEverything();
      }
      return true;
  }
  return false;
}

export async function handleSettingsChange(el: HTMLInputElement): Promise<boolean> {
  const key = el.dataset.setting as keyof Settings | undefined;
  if (key === 'showTimestamps') {
    updateSettings({ showTimestamps: el.checked });
    return true;
  }
  if (key === 'displayName') {
    updateSettings({ displayName: el.value.trim() });
    return true;
  }
  const slot = el.dataset.image as 'avatar' | 'header' | undefined;
  if (slot && el.files?.[0]) {
    const file = el.files[0];
    if (!file.type.startsWith('image/')) toast('That file is not an image.', 'error');
    else if (file.size > MAX_IMAGE_BYTES) toast('Please choose an image under 8 MB.', 'error');
    else await setImage(slot, file);
    el.value = '';
    return true;
  }
  return false;
}
