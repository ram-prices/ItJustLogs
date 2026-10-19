import type { Kind } from '../domain/types';
import type { Server } from '../domain/schedule';
import { clearEverything, clearHistory, currentServer, setImage, state, subscribe, updateSettings } from '../state';
import type { ThemePref } from '../store';
import { installTooltips } from './charts';
import { installImageFallback, toast } from './common';
import { LOGO, TAB_ICON, icon, pageHeader } from './components';
import { EXPORTER_SOURCE } from './guide';
import { html, raw, render, type Html } from './html';
import { askSamePlayer } from './dialog';
import { ImportMismatch, exportBackup, exportHistory, importText, type ImportMode } from './io';
import { homePage, installDiscordMenu, installTimelineLabels, scrollTimelineToNow } from './pages/home';
import { bannerBodyFor, listPage, setAllExpanded, setExpanded, toggleBannerFilter, toggleLuck, toggleSixStrip } from './pages/kind';
import { aboutCard, getDataSteps, setConfirmingDelete, settingsPage } from './pages/settings';
import { statsPage } from './pages/stats';
import { installSync, onSyncStatus, signIn, signOut, syncNeedsClick, syncNow } from './sync';
import { installTint, tintWeaponCards } from './tint';

/**
 * App shell and router. Layout follows the Vercel dashboard: a header with
 * the product mark and a row of underlined tabs, then a page header band and
 * the page body. Routes are hash-based so every banner page has its own URL.
 */

type Page = 'home' | 'operators' | 'arsenal' | 'stats' | 'settings';
const TABS: [Page, string][] = [
  ['home', 'Home'],
  ['operators', 'Operators'],
  ['arsenal', 'Arsenal'],
  ['stats', 'Stats'],
  ['settings', 'Settings'],
];
const DATA_PAGES: Page[] = ['operators', 'arsenal', 'stats'];

interface Route {
  page: Page;
  id?: string;
}

/** Pages are clean paths: / (home), /operators, /arsenal/<poolId>, /stats, /settings. */
function parseRoute(): Route {
  const [page, id] = location.pathname.replace(/^\/+/, '').split('/');
  const p = (TABS.some(([t]) => t === page) ? page : 'home') as Page;
  return { page: p, id: id ? decodeURIComponent(id) : undefined };
}

const root = () => document.getElementById('app')!;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function header(route: Route): Html {
  const has = !!state.analysis;
  const name = state.settings.displayName || 'Endministrator';
  return html`<header class="header"><div class="container">
    <div class="header-top">
      <a class="logo" href="/">${LOGO}<span>ItJustLogs</span></a>
      ${has
        ? html`<span class="crumb-sep">/</span>
            <div class="header-user">
              ${state.images.avatar ? html`<img class="avatar" src="${state.images.avatar}" alt="" />` : html`<span class="avatar"></span>`}
              <span class="label-14 ellipsis">${name}</span>
            </div>`
        : ''}
      <span class="spacer"></span>
      ${syncNeedsClick() ? html`<button class="btn secondary sm" data-action="sync-now" title="Sync with Google Drive">${icon('sync')}<span class="hide-sm">Sync</span></button>` : ''}
      <button class="btn secondary sm" data-action="import">${icon('upload_file')}<span class="hide-sm">Import</span></button>
    </div>
    <nav class="tabs" aria-label="Sections">
      ${TABS.map(([page, label]) => {
        const disabled = !has && DATA_PAGES.includes(page);
        return html`<a class="tab tab-${page}" href="/${page === 'home' ? '' : page}" aria-label="${label}" ${raw(route.page === page ? 'aria-current="page"' : '')} ${raw(disabled ? 'aria-disabled="true" tabindex="-1"' : '')}>${TAB_ICON[page] ?? ''}<span>${label}</span></a>`;
      })}
    </nav>
  </div></header>`;
}

function welcome(): Html {
  return html`
    ${pageHeader('Welcome to ItJustLogs', 'Pity, rate-up luck and patch stats for Arknights: Endfield. Everything runs in your browser.')}
    <main class="container fade-in">
      <div class="card">
        <div class="empty">
          <div class="empty-icon">${icon('inbox')}</div>
          <h2 class="heading-20">Import your pull history</h2>
          <p class="copy-14">Choose an exported file, drop it anywhere on this page, or press <kbd>Ctrl</kbd> <kbd>V</kbd> after running the exporter below.</p>
          <button class="btn primary" data-action="import" style="margin-top:8px">${icon('upload_file')}Import file</button>
        </div>
      </div>
      <div class="section card">
        <div class="card-body">
          <h2 class="heading-20" style="margin-bottom:8px">Get your pull history</h2>
          <p class="copy-14 secondary" style="margin-bottom:20px">Windows PC version of the game. The script only reads the game's web cache and talks to Gryphline's own history server. Read it before you run it.</p>
          ${getDataSteps()}
        </div>
      </div>
      ${aboutCard()}
    </main>`;
}

function page(route: Route): Html {
  const a = state.analysis;
  if (route.page === 'settings') return html`${settingsPage()}<div class="container">${aboutCard()}</div>`;
  if (route.page === 'home') return homePage(state.schedule, currentServer(), a);
  if (!a) return welcome();
  switch (route.page) {
    case 'operators':
    case 'arsenal': {
      const kind: Kind = route.page === 'operators' ? 'char' : 'weap';
      if (route.id && `${route.page}/${route.id}` !== lastKey) setExpanded(`${kind}:${route.id}`, true);
      return listPage(kind, a);
    }
    case 'stats':
      return statsPage(a);
  }
  return welcome();
}

let lastKey = '';

function applyTheme(): void {
  const t = state.settings.theme;
  document.documentElement.dataset.theme =
    t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
}

function draw(): void {
  applyTheme();
  const route = parseRoute();
  // Redraws (data refreshes, settings) rebuild the page; keep the timeline where it was.
  const timelineScroll = document.querySelector('.tl-scroll')?.scrollLeft;
  render(root(), html`${header(route)}${page(route)}`);
  const key = `${route.page}/${route.id ?? ''}`;
  if (key !== lastKey) {
    // /operators/<poolId> opens that banner's section and scrolls to it.
    const target = route.id && document.getElementById(`banner-${route.id}`);
    if (target) target.scrollIntoView({ block: 'start' });
    else scrollTo({ top: 0 });
    if (route.page === 'home') scrollTimelineToNow();
  } else if (timelineScroll != null) {
    const tl = document.querySelector('.tl-scroll');
    if (tl) tl.scrollLeft = timelineScroll;
  }
  lastKey = key;
  markOverflow();
  tintWeaponCards();
  const title = TABS.find(([p]) => p === route.page)?.[1];
  document.title = `${title ? `${title} · ` : ''}ItJustLogs`;
}

// ---------------------------------------------------------------------------
// Banner cards: fixed height with a scrolling list until expanded
// ---------------------------------------------------------------------------

/** Cards whose list fits without scrolling don't need the Expand button. */
function markOverflow(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.banner')) {
    if (card.classList.contains('expanded')) continue;
    const list = card.querySelector<HTMLElement>('.banner-body');
    card.classList.toggle('fits', !!list && list.scrollHeight <= list.clientHeight + 1);
  }
  // The 6★ history only needs Show all when it runs past two rows.
  for (const section of document.querySelectorAll<HTMLElement>('.six-section:not(.open)')) {
    const strip = section.querySelector<HTMLElement>('.six-strip');
    section.classList.toggle('fits', !!strip && strip.scrollHeight <= strip.clientHeight + 1);
  }
}

/** Animates a card between its fixed height and its full height, as the original did. */
function toggleCard(card: HTMLElement): void {
  const opening = !card.classList.contains('expanded');
  setExpanded(card.dataset.pool!, opening);
  const btn = card.querySelector<HTMLElement>('.banner-expand')!;
  btn.setAttribute('aria-expanded', String(opening));
  btn.querySelector('span')!.textContent = opening ? 'Collapse' : 'Expand';

  const from = card.offsetHeight;
  card.style.transition = 'none';
  card.classList.toggle('expanded', opening);
  card.style.height = 'auto';
  const to = card.offsetHeight;
  card.style.height = `${from}px`;
  void card.offsetHeight; // reflow so the transition starts from `from`
  card.style.transition = '';
  card.style.height = `${to}px`;
  card.addEventListener(
    'transitionend',
    () => {
      card.style.height = '';
      if (!opening) card.querySelector('.banner-body')?.scrollTo({ top: 0 });
    },
    { once: true },
  );
  if (!opening && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Import: file picker, drag & drop anywhere, paste anywhere
// ---------------------------------------------------------------------------

async function runImport(text: string, source: string, mode: ImportMode = 'check'): Promise<void> {
  try {
    await importText(text, source, mode);
  } catch (e) {
    if (e instanceof ImportMismatch) void askAboutMismatch(e);
    else toast((e as Error).message, 'error');
  }
}

/** A file that doesn't look like the saved player's history: ask before mixing two players' pulls. */
async function askAboutMismatch(e: ImportMismatch): Promise<void> {
  const choice = await askSamePlayer(e.match, e.source);
  if (choice !== 'cancel') await runImport(e.text, e.source, choice);
}

function installImport(): void {
  let depth = 0;
  const overlay = document.querySelector('.drop-overlay')!;
  addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    overlay.classList.add('on');
  });
  addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      overlay.classList.remove('on');
    }
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('on');
    const file = e.dataTransfer?.files[0];
    if (file) await runImport(await file.text(), file.name);
  });
  addEventListener('paste', async (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    const file = e.clipboardData?.files[0];
    const text = (e.clipboardData?.getData('text') ?? '').trim();
    if (file) await runImport(await file.text(), file.name);
    else if (text.startsWith('{') || text.startsWith('[')) {
      e.preventDefault();
      await runImport(text, 'The pasted text');
    } else if (text) toast("That doesn't look like pull history. Run the exporter first, then paste.", 'error');
  });
  document.getElementById('fileInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await runImport(await file.text(), file.name);
  });
}

/** Centre-crops a picture to a 256px square so the saved copy stays small. */
async function squareAvatar(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Could not read the picture'))), 'image/webp', 0.9));
}

/** Personalization in Settings: profile picture and display name. */
function installProfile(): void {
  document.getElementById('avatarInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await setImage('avatar', await squareAvatar(file));
    } catch {
      toast("That picture couldn't be opened. Try a PNG or JPG.", 'error');
    }
  });
  // Saved on Enter or leaving the field: saving per keystroke would redraw the page under the cursor.
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset?.setting === 'displayName') updateSettings({ displayName: el.value.trim() });
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && el.dataset?.setting === 'displayName') el.blur();
  });
}

// ---------------------------------------------------------------------------
// Delegated events
// ---------------------------------------------------------------------------

/**
 * Links to our own pages switch page in place (history.pushState) instead of
 * reloading. Modified clicks (new tab etc.) are left to the browser.
 */
function navigate(e: MouseEvent): boolean {
  // data-native: a real page outside the app (e.g. /privacy/), loaded normally.
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]:not([data-native])');
  if (!a || a.target || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  e.preventDefault();
  if (a.getAttribute('aria-disabled') === 'true') return true;
  const to = a.getAttribute('href')!;
  if (to !== location.pathname) history.pushState(null, '', to);
  draw();
  return true;
}

async function onClick(e: MouseEvent): Promise<void> {
  if (navigate(e)) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'import':
      return document.getElementById('fileInput')!.click();
    case 'avatar-upload':
      return document.getElementById('avatarInput')!.click();
    case 'avatar-remove':
      return setImage('avatar', null);
    case 'filter': {
      // Re-render just this card's body: a full redraw replays the page fade-in and flickers.
      const card = el.closest<HTMLElement>('[data-pool]');
      const pool = card?.dataset.pool;
      if (!card || !pool || !state.analysis) return;
      toggleBannerFilter(pool, el.dataset.value as '6');
      const body = bannerBodyFor(pool, state.analysis);
      const host = card.querySelector('.banner-body');
      if (body && host) {
        host.classList.add('no-anim');
        render(host, body);
        markOverflow();
      }
      return;
    }
    case 'six-strip': {
      const section = el.closest<HTMLElement>('.six-section');
      if (!section) return;
      const open = toggleSixStrip(section.dataset.kind as Kind);
      section.classList.toggle('open', open);
      el.setAttribute('aria-expanded', String(open));
      el.textContent = open ? 'Show less' : 'Show all';
      return;
    }
    case 'luck': {
      // Open or close the luck drawer under a rate-up pull, in place.
      const open = toggleLuck(el.dataset.key!);
      el.classList.toggle('open', open);
      el.setAttribute('aria-expanded', String(open));
      markOverflow();
      if (open) setTimeout(markOverflow, 320);
      return;
    }
    case 'expand-card': {
      const card = el.closest<HTMLElement>('.banner');
      if (card?.dataset.pool) toggleCard(card);
      return;
    }
    case 'expand-all': {
      const r = parseRoute();
      if (state.analysis) setAllExpanded(r.page === 'arsenal' ? 'weap' : 'char', state.analysis, !!el.dataset.value);
      return draw();
    }
    case 'theme':
      return updateSettings({ theme: el.dataset.value as ThemePref });
    case 'server':
      return updateSettings({ server: el.dataset.value as Server });
    case 'copy-script':
      try {
        await navigator.clipboard.writeText(EXPORTER_SOURCE);
        toast('Script copied. Paste it into Windows PowerShell.');
      } catch {
        toast('Could not copy automatically. Select the script text and copy it.', 'error');
      }
      return;
    case 'export-history':
      return exportHistory();
    case 'sync-signin':
      return signIn();
    case 'sync-now':
      return syncNow();
    case 'sync-signout':
      return signOut();
    case 'export-backup':
      return exportBackup();
    case 'clear-all':
      setConfirmingDelete(el.dataset.value === 'pulls' ? 'pulls' : 'all');
      return draw();
    case 'clear-cancel':
      setConfirmingDelete(null);
      return draw();
    case 'clear-confirm': {
      setConfirmingDelete(null);
      const pullsOnly = el.dataset.value === 'pulls';
      try {
        if (pullsOnly) {
          await clearHistory();
          toast('Pull history deleted. Your name, picture and settings were kept.');
        } else {
          await clearEverything();
          toast('All saved data was deleted from this browser.');
        }
      } catch (err) {
        toast(`Couldn't delete ${pullsOnly ? 'the pull history' : 'everything'}: ${(err as Error).message}`, 'error');
      }
      return;
    }
  }
}

export function mount(): void {
  installImageFallback();
  installTint();
  installTooltips();
  installImport();
  installTimelineLabels();
  installDiscordMenu();
  installProfile();
  installSync();
  document.addEventListener('click', (e) => void onClick(e));
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && el.dataset?.action === 'luck') {
      e.preventDefault();
      el.click();
    }
  });
  addEventListener('resize', markOverflow);
  // Old links and bookmarks used #/page; move them to the clean path. GitHub
  // Pages also redirects /operators to /operators/ (it's a folder there):
  // drop the trailing slash so the address stays clean.
  if (location.hash.startsWith('#/')) history.replaceState(null, '', `/${location.hash.slice(2)}`);
  else if (location.pathname.length > 1 && location.pathname.endsWith('/'))
    history.replaceState(null, '', location.pathname.replace(/\/+$/, '') + location.search);
  addEventListener('popstate', draw);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  subscribe(draw);
  onSyncStatus(draw);
  draw();
}
