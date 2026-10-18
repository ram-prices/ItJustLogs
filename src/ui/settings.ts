import { parseHistoryJson } from '../domain/parse';
import type { PullHistory } from '../domain/types';
import { importHistory, setImage, state, updateSettings } from '../state';
import { blobToDataUrl, dataUrlToBlob, type Settings, type ThemePref } from '../store';
import { toast } from './common';
import { escape as esc } from './html';
import { EXPORTER_SOURCE } from './guide';

/** Settings and About tabs in eftracker's markup, plus theme and the exporter guide. */

const THEME_LABEL: Record<ThemePref, string> = { dark: 'DARK', light: 'LIGHT', system: 'SYSTEM' };
const onOff = (on: boolean) => `class="filter-btn${on ? ' active' : ''}"`;
const divider = 'border-top: 1px solid var(--divider); padding-top: 15px;';

export function renderSettings(): string {
  const s = state.settings;
  const hasData = !!state.history && state.history.characters.length + state.history.weapons.length > 0;
  return `
    <h2>DATA MANAGEMENT</h2>
    <div class="about-card" style="display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
        <button class="filter-btn active${hasData ? ' data-loaded' : ''}" data-action="import" style="padding: 10px 20px; font-size: 12px;">${hasData ? 'DATA LOADED &#10003; · LOAD MORE' : 'LOAD .JSON FILE'}</button>
        ${hasData ? `<button class="filter-btn" data-action="clear-all" style="padding: 10px 20px; border-color: var(--color-red); color: var(--color-red); font-size: 12px;">CLEAR SAVED DATA</button>` : ''}
      </div>
      <p class="card-note">You can also drop a file anywhere on the page or press <kbd>Ctrl</kbd>+<kbd>V</kbd>. Every import is merged into your saved history, so older pulls the game no longer shows are kept.</p>
    </div>

    <h2>GET YOUR DATA</h2>
    <div class="about-card">
      <h3>PowerShell Exporter</h3>
      <p>1. Open <span class="about-highlight">Headhunting → History</span> in-game once, so the history link is fresh.</p>
      <p>2. Open <span class="about-highlight">Windows PowerShell</span> (no administrator needed), paste the script below with a right-click, and press <kbd>Enter</kbd> if it shows <code>&gt;&gt;</code>.</p>
      <p>3. When it says <span class="about-highlight-green">Done</span>, come back here and press <kbd>Ctrl</kbd>+<kbd>V</kbd>. The file is also saved to your Desktop.</p>
      <p>The script only reads the game's web cache and talks to <span class="about-highlight-green">ef-webview.gryphline.com</span>, Gryphline's own history server. It needs no admin rights, changes no settings and downloads nothing else. The full script is below so you can read all of it first.</p>
      <div class="code-block">
        <button class="filter-btn" data-action="copy-script">COPY SCRIPT</button>
        <pre><code>${esc(EXPORTER_SOURCE)}</code></pre>
      </div>
    </div>

    <h2>DISPLAY PREFERENCES</h2>
    <div class="about-card" style="display: flex; flex-direction: column; gap: 15px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 15px;">
        <div><h3 style="margin-bottom: 5px;">THEME</h3><p class="card-note">Dark is the classic look. Light is easier on the eyes in daylight.</p></div>
        <button class="filter-btn active" data-action="cycle-theme" style="padding: 10px 20px; font-size: 12px; min-width: 96px;">${THEME_LABEL[s.theme]}</button>
      </div>
      <div style="${divider} display: flex; justify-content: space-between; align-items: center; gap: 15px;">
        <div><h3 style="margin-bottom: 5px;">ALWAYS SHOW TIMESTAMPS</h3><p class="card-note">Locks the pull entries to an expanded state to permanently display pull times without hovering.</p></div>
        <button ${onOff(s.showTimestamps)} data-action="toggle-setting" data-key="showTimestamps" style="padding: 10px 20px; font-size: 12px;">${s.showTimestamps ? 'ON' : 'OFF'}</button>
      </div>
      <div style="${divider} display: flex; justify-content: space-between; align-items: center; gap: 15px;">
        <div><h3 style="margin-bottom: 5px;">EXPAND SUMMARIES BY DEFAULT</h3><p class="card-note">Keeps the Operator and Arsenal summary boxes expanded on load.</p></div>
        <button ${onOff(s.summaryExpandedByDefault)} data-action="toggle-setting" data-key="summaryExpandedByDefault" style="padding: 10px 20px; font-size: 12px;">${s.summaryExpandedByDefault ? 'ON' : 'OFF'}</button>
      </div>
      <div style="${divider}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><h3 style="margin: 0;">MAX SUMMARY ROWS</h3><span class="slider-val" data-val="summaryMaxRows">${s.summaryMaxRows}</span></div>
        <input type="range" min="1" max="5" step="1" value="${s.summaryMaxRows}" data-setting="summaryMaxRows" class="slider">
      </div>
      <div style="${divider}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><h3 style="margin: 0;">CONSIDERED RECENT BANNERS</h3><span class="slider-val" data-val="summaryBannerLimit">${s.summaryBannerLimit >= 50 ? 'ALL' : s.summaryBannerLimit}</span></div>
        <input type="range" min="1" max="50" step="1" value="${Math.min(50, s.summaryBannerLimit)}" data-setting="summaryBannerLimit" class="slider">
        <p class="card-note" style="margin-top: 5px; font-size: 11px;">Limits the summary to only show 6★ items from the last N banners.</p>
      </div>
    </div>

    <h2>BANNER CUSTOMIZATION</h2>
    <div class="about-card" style="display: flex; flex-direction: column; gap: 20px;">
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><h3 style="margin: 0;">ACRYLIC BLUR STRENGTH</h3><span class="slider-val" data-val="bannerBlur">${s.bannerBlur}px</span></div>
        <input type="range" min="0" max="40" step="1" value="${s.bannerBlur}" data-setting="bannerBlur" class="slider">
      </div>
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><h3 style="margin: 0;">IMAGE VERTICAL POSITION</h3><span class="slider-val" data-val="bannerPos">${s.bannerPos}%</span></div>
        <input type="range" min="0" max="100" step="1" value="${s.bannerPos}" data-setting="bannerPos" class="slider">
      </div>
    </div>

    <h2>PROFILE &amp; BANNER IMAGES</h2>
    <div class="about-card" style="display: flex; flex-direction: column; gap: 20px;">
      <div>
        <h3 style="margin-bottom: 10px;">UPLOAD AVATAR</h3>
        <label class="filter-btn file-btn">SELECT AVATAR IMAGE<input type="file" accept="image/*" data-image="avatar" hidden></label>
      </div>
      <div>
        <h3 style="margin-bottom: 10px;">UPLOAD BANNER</h3>
        <label class="filter-btn file-btn">SELECT BANNER IMAGE<input type="file" accept="image/*" data-image="header" hidden></label>
      </div>
      <button class="filter-btn" data-action="reset-images" style="width: 100%; padding: 12px; border-color: var(--rarity-5); color: var(--rarity-5);">RESET TO DEFAULT IMAGES</button>
    </div>

    <h2>DATA EXPORT</h2>
    <div class="about-card" style="display: flex; flex-direction: column; gap: 15px;">
      <p class="card-note">Select which data you want to export from this browser.</p>
      <div class="export-list">${exportList()}</div>
      <button class="filter-btn export-btn" data-action="export">EXPORT SELECTED DATA (.JSON)</button>
    </div>`;
}

function exportList(): string {
  const items: [string, string][] = [];
  if (state.history) items.push(['data', 'PULL HISTORY DATA']);
  items.push(['settings', 'APP SETTINGS (THEME, BLUR, POS, NAME, ETC)']);
  if (state.images.avatar) items.push(['avatar', 'PROFILE AVATAR IMAGE']);
  if (state.images.header) items.push(['banner', 'HERO BANNER IMAGE']);
  return items
    .map(
      ([id, label]) => `<div style="display: flex; align-items: center; gap: 10px; padding: 4px 0;">
        <input type="checkbox" id="export-${id}" data-export="${id}" checked style="accent-color: var(--accent-blue);">
        <label for="export-${id}" style="font-size: 12px; cursor: pointer;">${label}</label>
      </div>`,
    )
    .join('');
}

export function renderAbout(): string {
  return `
    <h2>HOW IT WORKS</h2>
    <div class="about-card">
      <h3>Data Extraction</h3>
      <p>This tracker processes your Endfield pull history locally, entirely within your own browser. Load your pull history as a <span class="about-highlight">.json file</span> from the <span class="about-highlight-green">Settings</span> tab, drop it anywhere on the page, or paste it with Ctrl+V.</p>
      <p>For security and privacy reasons, <span class="about-highlight-green">this site never asks for your token or gacha URL</span>. The PowerShell exporter in Settings runs on your own PC, talks only to Gryphline's official server, and hands the result to this page. Its full source is shown before you run it.</p>
      <p>Each import is merged into what this browser already has, so pulls older than the game's history window are kept. Download a backup from Settings now and then.</p>
    </div>

    <h2>DISCLAIMERS</h2>
    <div class="about-card">
      <h3>Project Integrity</h3>
      <p>ItJustLogs is a rebuild of the <span class="about-highlight">"vibe-coded"</span> EF Tracker, made with AI coding tools.</p>
      <p>You can view the source code and repository here: <a href="https://github.com/ram-prices/ItJustLogs" target="_blank" rel="noopener" style="color: var(--accent-blue); text-decoration: none; font-weight: bold;">https://github.com/ram-prices/ItJustLogs</a>.</p>
      <p>Use this tool at your own discretion. Because no data is ever sent to a server, your imported history remains private to your device.</p>
    </div>
    <div class="about-card">
      <h3>Asset Copyright</h3>
      <p>Arknights: Endfield, its characters, weapons, and all associated visual assets are the sole property and copyright of <span class="about-highlight-green">Gryphline / Hypergryph</span>.</p>
      <p>This tracker is a non-commercial, fan-made project created for the community and claims no ownership over the game's intellectual property or graphical assets.</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

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

export async function exportSelected(root: HTMLElement): Promise<void> {
  const picked = new Set([...root.querySelectorAll<HTMLInputElement>('[data-export]:checked')].map((c) => c.dataset.export!));
  if (!picked.size) return toast('Select at least one item to export.', 'error');
  if (picked.size === 1 && picked.has('data') && state.history) {
    download(`endfield_pulls_${stamp()}.json`, JSON.stringify(state.history, null, 2));
    return;
  }
  const backup: Backup = { app: 'itjustlogs', version: 1, exportedAt: new Date().toISOString(), images: {} };
  if (picked.has('data')) backup.history = state.history;
  if (picked.has('settings')) backup.settings = state.settings;
  for (const [id, slot] of [['avatar', 'avatar'], ['banner', 'header']] as const) {
    const url = state.images[slot];
    if (picked.has(id) && url) backup.images![slot] = await blobToDataUrl(await fetch(url).then((r) => r.blob()));
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
  toast(total ? `Added ${added.char} operator and ${added.weap} arsenal pulls.` : 'Everything in that file was already saved — nothing new to add.');
}

export const SETTINGS_SLIDERS = new Set<keyof Settings>(['summaryMaxRows', 'summaryBannerLimit', 'bannerBlur', 'bannerPos']);

export function sliderLabel(key: keyof Settings, v: number): string {
  if (key === 'summaryBannerLimit') return v >= 50 ? 'ALL' : String(v);
  if (key === 'bannerBlur') return `${v}px`;
  if (key === 'bannerPos') return `${v}%`;
  return String(v);
}
