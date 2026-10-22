import { PAID_INCOME, type PaidIncome } from '../domain/income';
import { endministratorOf, EXTRA_PRESETS, extrasOf, isEndministrator, type ExtraCopy } from '../domain/owned';
import { legacyEventLinks } from '../domain/schedule';
import { RESERVED_PATHS } from '../domain/wiki';
import type { Kind } from '../domain/types';
import type { Server } from '../domain/schedule';
import { clearEverything, clearHistory, currentServer, restoreCopy, restoreSnapshot, setImage, state, subscribe, updateSettings } from '../state';
import { deleteAvatarEdit, loadAvatarEdit, loadAvatarHistory, loadImage, loadTabViews, saveAvatarEdit, saveAvatarHistory, saveTabView, type AvatarBox, type AvatarEdit, type ThemePref } from '../store';
import { installTooltips } from './charts';
import { installImageFallback, toast } from './common';
import { LOGO, TAB_ICON, avatar, icon, loadIcons, pageHeader } from './components';
import { EXPORTER_SOURCE } from './guide';
import { fmtInt, html, raw, render, type Html } from './html';
import { askSamePlayer } from './dialog';
import { ImportMismatch, exportBackup, exportHistory, importText, type ImportMode } from './io';
import { copyText, focusScheduleItem, homePage, installCopyMenu, installTimelineLabels, scrollTimelineToNow } from './pages/home';
import { fitBannerCards, installHomeWidgets } from './pages/homeWidgets';
import { installParallax } from './parallax';
import { syncVideoBackground } from './videoBackground';
import { bannerBodyFor, installCardGlow, resetCardEntrance, listPage, setAllExpanded, setExpanded, toggleBannerFilter, toggleLuck, toggleSixStrip } from './pages/kind';
import { bannerHref, bannerSlugs, infoHref, installWikiControls, loadingOrFailed, previewsLoading, shortLinkMap, slugsOf, statusPage, wikiFile } from './pages/info';
import { canonicalPoolId } from '../domain/banners';
import { withWikiEnds, type EventRewardsFile } from '../domain/eventRewards';
import { operatorInfoPage, operatorInfoTitle } from './pages/operator';
import { installSlideshows, openArtManager, resetArtPick, shuffleArt } from './pages/art';
import { applyListSearch, installListSearch, refocusListSearch } from './pages/search';
import { openSortPopup } from './pages/sorting';
import { achievementsPage, archivesPage, collectionAction, collectionChange, readFindingsFrom, readMedalsFrom } from './pages/collections';
import { essenceAction, essencesPage } from './pages/essences';
import { eventOf, eventPage } from './pages/event';
import { readEssenceFiles, readEssences } from './essenceReader';
import { pickLoadoutSlot, setArtifice, setMaxEssence, setWeaponRank, toggleBonusSplit } from './pages/loadout';
import { weaponInfoPage, weaponInfoTitle } from './pages/weapon';
import { forgetSavedAvatars, getDataSteps, setConfirmingDelete, settingsPage } from './pages/settings';
import { statsPage, togglePatch } from './pages/stats';
import { cropAvatar } from './cropper';
import { downloadDriveSnapshot, installSync, onSyncStatus, signIn, signOut, syncIsOn, syncNeedsClick, syncNow, syncPending, syncQueued, syncShown, syncView } from './sync';
import { whenNear } from './near';
import { installTint, tintAmbients, tintHeroes, tintSixStrip, tintWeaponCards } from './tint';

/**
 * App shell and router. Layout follows the Vercel dashboard: a header with
 * the product mark and a row of underlined tabs, then a page header band and
 * the page body. Routes are hash-based so every banner page has its own URL.
 */

type Page = 'home' | 'operators' | 'arsenal' | 'essences' | 'stats' | 'achievements' | 'archives' | 'settings' | 'event';
/**
 * The header's tabs. Database (every operator and weapon) and Pulls (the
 * player's banners and Stats) hold several pages, picked with side tabs;
 * their pages live under /database and /banner (/database/operators,
 * /banner/arsenal, /banner/stats...).
 */
type Tab = 'home' | 'database' | 'pulls' | 'essences' | 'achievements' | 'archives' | 'settings';
const TABS: [Tab, string][] = [
  ['home', 'Home'],
  ['database', 'Database'],
  ['pulls', 'Pulls'],
  ['essences', 'Essences'],
  ['achievements', 'Achievements'],
  ['archives', 'Archive'],
  ['settings', 'Settings'],
];
/** Paths that are pages of their own. */
const PAGES = new Set<string>(['home', 'operators', 'arsenal', 'essences', 'stats', 'achievements', 'archives', 'settings']);
/** Where Database and Pulls open first: the operator list, the Headhunting banners. */
const SECTION_HOME = { database: '/database/operators', pulls: '/banner/headhunting' } as const;
/** The path each section answers to (/database, /banner). */
const SECTION_PATH = { database: 'database', pulls: 'banner' } as const;
/** A Pulls page's title (document title). */
const PULLS_TITLE: Partial<Record<Page, string>> = { operators: 'Headhunting', arsenal: 'Arsenal Issues', stats: 'Stats' };

/** The header tab a page belongs to. */
function tabOf(route: Route): Tab | null {
  if (route.page === 'operators' || route.page === 'arsenal') return route.info ? 'database' : 'pulls';
  if (route.page === 'stats') return 'pulls';
  return route.page === 'event' ? null : route.page;
}

interface Route {
  page: Page;
  id?: string;
  /** /database/operators[/<name>], /database/arsenals[/<name>]: info from the wiki data; `id` is the operator or weapon. */
  info?: boolean;
  /** /database/operators/<name> before the names are loaded: the page shows Loading. */
  pending?: boolean;
  /** A short link (/si, /lunar-calling): the item's info page once resolved, else why not. */
  short?: string;
  shortState?: 'loading' | 'missing' | 'failed';
  /** /banners/<name>, /event/<id>: Home, scrolled to that banner or event (its link path). */
  focus?: string;
}

/** Top-level paths that aren't pages: operator and weapon short links (/si), resolved once the wiki data loads. */
const isShortLink = (segment: string) => /^[a-z0-9][a-z0-9-]*$/i.test(segment) && !RESERVED_PATHS.has(segment.toLowerCase());

/**
 * Paths from before /database and /banner (/operators/info/<chr id>,
 * /arsenal/<poolId>, /stats, /pulls) as today's, so old links, bookmarks and
 * saved tab views still open. Ids stay ids here; the router swaps them for
 * names once it can.
 */
export function currentPath(path: string): string {
  const [page = '', a, b] = path.replace(/^\/+|\/+$/g, '').split('/');
  const p = page.toLowerCase();
  const tail = (x?: string) => (x ? `/${x}` : '');
  if ((p === 'operators' || p === 'arsenal') && a?.toLowerCase() === 'info') return `/database/${p === 'operators' ? 'operators' : 'arsenals'}${tail(b)}`;
  if (p === 'operators' || p === 'arsenal') return `/banner/${p === 'operators' ? 'headhunting' : 'arsenal'}${tail(a)}`;
  if (p === 'stats') return '/banner/stats';
  if (p === 'pulls') return '/banner';
  return path;
}

/** A Database page's item: its name slug, or (old links, items without one) its id. */
function itemRoute(kind: Kind, segment: string | undefined): Route {
  const page: Page = kind === 'char' ? 'operators' : 'arsenal';
  if (!segment) return { page, info: true };
  const raw = decodeURIComponent(segment);
  const slugs = slugsOf(kind, draw);
  const id = slugs?.bySlug.get(raw.toLowerCase());
  if (id) return { page, info: true, id };
  // Ids have an underscore (chr_0003_endminf); a name slug never does.
  const isId = raw.includes('_');
  if (!isId && (!slugs || previewsLoading()) && !wikiFile(kind === 'char' ? 'operators.json' : 'weapons.json', draw).failed) return { page, info: true, id: raw, pending: true };
  return { page, info: true, id: raw };
}

/** A Pulls banner: its name slug (as Home's /banners/<name> links have it), or its pool id. */
function bannerRoute(kind: Kind, segment: string | undefined): Route {
  const page: Page = kind === 'char' ? 'operators' : 'arsenal';
  if (!segment) return { page };
  const raw = decodeURIComponent(segment);
  const pool = bannerSlugs(state.schedule).bySlug.get(raw.toLowerCase()) ?? canonicalPoolId(raw);
  // The card's own pool id (the export's spelling).
  const id = state.analysis?.banners.find((b) => canonicalPoolId(b.poolId) === pool)?.poolId ?? pool;
  return { page, id };
}

/** Pages are clean paths: / (home), /database/operators[/<name>], /database/arsenals[/<name>], /banner/headhunting[/<banner>], /banner/arsenal[/<banner>], /banner/stats, /banners/<name> (Home at that banner), /event/<id> (that event and its rewards), /settings. */
function parseRoute(): Route {
  const old = currentPath(location.pathname);
  if (old !== location.pathname) history.replaceState(null, '', old + location.search + location.hash);
  // /database and /banner: the page of that section the player was last on.
  const path = location.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  for (const section of ['database', 'pulls'] as const)
    if (path === SECTION_PATH[section]) history.replaceState(null, '', currentPath(loadTabViews()[section] ?? SECTION_HOME[section]));
  const [page, id, sub] = location.pathname.replace(/^\/+/, '').split('/');
  const top = page.toLowerCase();
  if (top === 'database' || top === 'banner') {
    const kind: Kind | null = id === 'operators' || id === 'headhunting' ? 'char' : id === 'arsenals' || id === 'arsenal' ? 'weap' : null;
    const route =
      top === 'banner' && id === 'stats'
        ? ({ page: 'stats' } as Route)
        : kind && (top === 'database') === (id === 'operators' || id === 'arsenals')
          ? top === 'database'
            ? itemRoute(kind, sub)
            : bannerRoute(kind, sub)
          : ({ page: 'home' } as Route);
    // Old ids and odd spellings: show the page's own address (its name).
    if (kind && route.id && !route.pending) {
      const own = top === 'database' ? infoHref(kind, route.id) : bannerHref(kind, route.id);
      if (own !== location.pathname) history.replaceState(null, '', own + location.search + location.hash);
    }
    return route;
  }
  if (page === 'banners' && id) return { page: 'home', focus: `/banners/${id.toLowerCase()}` };
  if (page === 'event' && id) return { page: 'event', id };
  // LEGACY, to be removed with legacyEventLinks: old /events/<name> links go to their /event/<id>.
  if (page === 'events' && id) {
    const old = `/events/${id.toLowerCase()}`;
    const e = [...legacyEventLinks(state.schedule)].find(([, path]) => path === old)?.[0];
    if (e?.id == null) return { page: 'home', focus: old };
    history.replaceState(null, '', `/event/${e.id}`);
    return { page: 'event', id: String(e.id) };
  }
  if (page && !id && !PAGES.has(page) && isShortLink(page)) {
    const short = page.toLowerCase();
    const { map, failed } = shortLinkMap(draw);
    const t = map?.get(short);
    if (t) return { page: t.kind === 'weap' ? 'arsenal' : 'operators', info: true, id: t.id, short };
    return { page: 'home', short, shortState: map ? 'missing' : failed ? 'failed' : 'loading' };
  }
  const p = (PAGES.has(page) ? page : 'home') as Page;
  if ((p === 'operators' || p === 'arsenal') && id === 'info') return { page: p, info: true, id: sub ? decodeURIComponent(sub) : undefined };
  return { page: p, id: id ? decodeURIComponent(id) : undefined };
}

const root = () => document.getElementById('app')!;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The header's right side once pulls are imported: the Google Drive sync
 * button while sync is on, else nothing (Import lives in Settings then).
 */
function syncButton(): Html {
  if (!syncShown()) return html``;
  const { status, lastSynced, error } = syncView();
  // A change starts a sync a moment later: show Syncing straight away rather than Unsynced first.
  const busy = status === 'syncing' || (status === 'idle' && syncQueued());
  const pending = syncPending();
  const when = lastSynced ? ` Last synced ${new Date(lastSynced).toLocaleString()}.` : '';
  const title =
    status === 'reconnect' || status === 'paused'
      ? `${pending ? 'Changes here aren’t in Google Drive yet. ' : ''}Sync with Google Drive (needs a click each visit)`
      : status === 'error'
        ? `Sync failed: ${error}. Click to try again`
        : busy
          ? 'Syncing with Google Drive…'
          : pending
            ? `Changes here are waiting to sync to Google Drive.${when} Click to sync now`
            : lastSynced
              ? `Everything is synced with Google Drive.${when} Click to sync now`
              : 'Sync with Google Drive';
  // Syncing (spinning), waiting changes (cloud with an arrow), all synced (cloud with a tick).
  const [glyph, label] = busy
    ? ['sync', 'Syncing']
    : status === 'error'
      ? ['sync', 'Retry sync']
      : syncNeedsClick()
        ? ['sync', 'Sync']
        : pending
          ? ['cloud_upload', 'Unsynced']
          : ['cloud_done', 'Synced'];
  const look = busy ? ' busy' : status === 'error' ? ' failed' : pending ? ' pending' : syncNeedsClick() ? '' : ' synced';
  return html`<button class="btn ${syncNeedsClick() ? 'primary' : 'secondary'} sm header-sync${look}" data-action="sync-now" title="${title}" aria-label="${title}" ${raw(busy ? 'disabled' : '')}>${icon(glyph)}<span class="hide-sm">${label}</span>${pending && !busy ? html`<span class="sync-dot" aria-hidden="true"></span>` : ''}</button>`;
}

function header(route: Route): Html {
  const has = !!state.analysis;
  const tabViews = loadTabViews();
  const current = tabOf(route);
  const name = state.settings.displayName || 'Endministrator';
  return html`<header class="header"><div class="container">
    <div class="header-top">
      <a class="logo" href="/">${LOGO}<span>ItJustLogs</span></a>
      ${has
        ? html`<span class="crumb-sep">/</span>
            <div class="header-user">
              ${avatar(state.images.avatar, !!state.settings.avatarPop, false, state.settings.avatarBox)}
              <span class="label-14 ellipsis">${name}</span>
            </div>`
        : ''}
      <span class="spacer"></span>
      ${has ? syncButton() : html`<button class="btn secondary sm" data-action="import">${icon('upload_file')}<span class="hide-sm">Import</span></button>`}
    </div>
    <nav class="tabs" aria-label="Sections">
      ${TABS.map(([tab, label]) => {
        // Database and Pulls open the page the player was last on there. Pulls needs an import.
        const href = tab === 'home' ? '/' : tab === 'database' || tab === 'pulls' ? currentPath(tabViews[tab] ?? SECTION_HOME[tab]) : `/${tab}`;
        const disabled = !has && tab === 'pulls';
        return html`<a class="tab tab-${tab}" href="${href}" aria-label="${label}" ${raw(current === tab ? 'aria-current="page"' : '')} ${raw(disabled ? 'aria-disabled="true" tabindex="-1"' : '')}>${TAB_ICON[tab] ?? ''}<span>${label}</span></a>`;
      })}
    </nav>
  </div></header>`;
}

/** The same footer under every page; its margin also keeps the last cards clear of the screen's bottom edge. */
const footer = (): Html => html`<footer class="container site-footer copy-13 tertiary">
  <span>Fan-made with Claude AI, not affiliated with Gryphline or Hypergryph.</span>
  <a href="/privacy/" data-native>Privacy policy</a>
  <a href="https://github.com/ram-prices/ItJustLogs" target="_blank" rel="noopener">Source on GitHub</a>
</footer>`;

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
    </main>`;
}

function page(route: Route): Html {
  const a = state.analysis;
  if (route.page === 'settings') return settingsPage(draw);
  if (route.shortState === 'loading') return statusPage('char', 'Loading…', 'Loading…');
  if (route.shortState) {
    return statusPage(
      'char',
      'Page not found',
      route.shortState === 'failed'
        ? html`Couldn't load the operator and weapon list to open <b>/${route.short}</b>. Check your connection and reload.`
        : html`Nothing lives at <b>/${route.short}</b>. <a href="/">Go home</a>, or browse <a href="${infoHref('char')}">operators</a> and <a href="${infoHref('weap')}">weapons</a>.`,
    );
  }
  if (route.page === 'home') return homePage(withWikiEnds(state.schedule, wikiFile<EventRewardsFile>('events.json', draw).data), currentServer(), a, draw);
  // The game's medals and Findings: wiki data plus what the player ticked off; no import needed.
  if (route.page === 'achievements') return achievementsPage(draw);
  if (route.page === 'archives') return archivesPage(draw);
  if (route.page === 'essences') return essencesPage(draw);
  if (route.page === 'event') return eventPage(route.id, draw);
  // Info pages are game data: they work without an import, and show the player's copies with one.
  if (route.pending) return route.page === 'arsenal' ? loadingOrFailed('weap', 'Arsenals', false) : loadingOrFailed('char', 'Operators', false);
  if (route.info) return route.page === 'arsenal' ? weaponInfoPage(route.id, a, draw) : operatorInfoPage(route.id, a, draw);
  if (!a) return welcome();
  switch (route.page) {
    case 'operators':
    case 'arsenal': {
      const kind: Kind = route.page === 'operators' ? 'char' : 'weap';
      if (route.id && `${route.page}/${route.id}` !== lastKey) setExpanded(`${kind}:${route.id}`, true);
      return listPage(kind, a, { db: state.db, schedule: state.schedule, server: currentServer(), showAll: !!state.settings.showAllBanners });
    }
    case 'stats':
      return statsPage(a, draw);
  }
  return welcome();
}

let lastKey = '';
/** When the current page opened, and how long after it redraws still fade in (its data loading). */
let openedAt = 0;
const SETTLE_MS = 1500;

function applyTheme(): void {
  const t = state.settings.theme;
  document.documentElement.dataset.theme =
    t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  document.documentElement.dataset.motion = state.settings.motion === false ? 'off' : 'on';
}

/**
 * Rows of tabs that scroll sideways on narrow screens: the site's sections
 * and Achievements / Archive categories, with their selected tab.
 */
const TAB_ROWS: [row: string, current: string][] = [
  ['.tabs', '.tab[aria-current="page"]'],
  ['.collection-tabs', '[aria-current="true"]'],
];

/** Each tab row's sideways scroll, before a redraw rebuilds it. */
const tabRowScroll = (): (number | null)[] => TAB_ROWS.map(([row]) => document.querySelector(row)?.scrollLeft ?? null);

/**
 * After a redraw: each tab row back where it was, then scrolled just enough
 * that its selected tab shows (a tab picked off to the right stays in view).
 */
function restoreTabRows(before: (number | null)[]): void {
  TAB_ROWS.forEach(([row, current], i) => {
    const bar = document.querySelector<HTMLElement>(row);
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    if (before[i] != null) bar.scrollLeft = before[i]!;
    const tab = bar.querySelector<HTMLElement>(current);
    if (!tab) return;
    const b = bar.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const pad = 16;
    if (t.left < b.left) bar.scrollLeft -= b.left - t.left + pad;
    else if (t.right > b.right) bar.scrollLeft += t.right - b.right + pad;
  });
}

function draw(): void {
  applyTheme();
  const route = parseRoute();
  // Redraws (data refreshes, settings) rebuild the page; keep the timeline where it was.
  const timelineScroll = document.querySelector('.tl-scroll')?.scrollLeft;
  const key = `${route.page}/${route.info ? 'info/' : ''}${route.id ?? ''}${route.focus ?? ''}`;
  // Remember which page of Database / Pulls the player is on, for their tab next time.
  const section = tabOf(route);
  if (section === 'database' && !route.id) saveTabView('database', infoHref(route.page === 'arsenal' ? 'weap' : 'char'));
  if (section === 'pulls' && !route.id && state.analysis) saveTabView('pulls', route.page === 'stats' ? '/banner/stats' : bannerHref(route.page === 'arsenal' ? 'weap' : 'char'));
  // Banner cards fade in when a page opens, not again on every redraw.
  if (key !== lastKey) {
    resetCardEntrance();
    // Operator pages pick a new random picture each time they open.
    resetArtPick();
    openedAt = Date.now();
  }
  // The page fades in when it opens (and as its data arrives just after);
  // later redraws (a setting changed, Drive sync starting and finishing)
  // swap the page in place instead of flashing it.
  root().classList.toggle('settled', key === lastKey && Date.now() - openedAt > SETTLE_MS);
  // A redraw while the player types a search keeps the box focused.
  const searching = document.activeElement?.matches('[data-list-search]');
  const tabRows = tabRowScroll();
  render(root(), html`${header(route)}${page(route)}${footer()}`);
  restoreTabRows(tabRows);
  if (searching) refocusListSearch();
  if (key !== lastKey) {
    // /banner/headhunting/<banner> opens that banner's card and scrolls to it.
    const target = route.id && !route.info && document.getElementById(`banner-${route.id}`);
    if (target) target.scrollIntoView({ block: 'start' });
    else scrollTo({ top: 0 });
    if (route.page === 'home') scrollTimelineToNow();
    // /banners/<name>, /event/<id>: that item's card, row or timeline bar.
    if (route.focus) focusScheduleItem(route.focus);
  } else {
    if (timelineScroll != null) {
      const tl = document.querySelector('.tl-scroll');
      if (tl) tl.scrollLeft = timelineScroll;
    }
    if (route.focus) focusScheduleItem(route.focus, false);
  }
  lastKey = key;
  applyListSearch();
  markOverflow();
  tintWeaponCards();
  tintSixStrip();
  tintHeroes();
  syncVideoBackground();
  fitBannerCards();
  tintAmbients();
  const title = route.info
    ? route.page === 'arsenal'
      ? weaponInfoTitle(route.id)
      : operatorInfoTitle(route.id)
    : route.page === 'event'
      ? eventOf(route.id)?.name
      : (PULLS_TITLE[route.page] ?? TABS.find(([t]) => t === route.page)?.[1]);
  document.title = `${title ? `${title} · ` : ''}ItJustLogs`;
}

// ---------------------------------------------------------------------------
// Banner cards: fixed height with a scrolling list until expanded
// ---------------------------------------------------------------------------

/** Hides a card's Expand when its list fits without scrolling. */
function measureCard(card: HTMLElement): void {
  if (card.classList.contains('expanded')) return;
  const list = card.querySelector<HTMLElement>('.banner-scroll');
  // Measure with Expand hidden (the list is taller then), so the answer
  // doesn't depend on whether the button was showing.
  card.classList.add('fits');
  card.classList.toggle('fits', !!list && list.scrollHeight <= list.clientHeight + 1);
}

/** Whether an open card's list would fit without scrolling if it were closed. */
function fitsClosed(card: HTMLElement): boolean {
  const list = card.querySelector<HTMLElement>('.banner-scroll');
  card.style.transition = 'none';
  card.classList.replace('expanded', 'fits');
  const fits = !!list && list.scrollHeight <= list.clientHeight + 1;
  card.classList.replace('fits', 'expanded');
  void card.offsetHeight;
  card.style.transition = '';
  return fits;
}

/** Cards whose list fits without scrolling don't need the Expand button. */
function markOverflow(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.banner')) {
    if (card.classList.contains('expanded')) continue;
    // Offscreen cards skip layout (content-visibility), so measure each one
    // as it nears the screen rather than forcing them all now.
    whenNear(card, () => measureCard(card));
    // A card the browser hasn't laid out yet (content-visibility skips it; Firefox further out
    // than "near") measures wrong: measure again once it's drawn.
    if (!card.dataset.cvWatch) {
      card.dataset.cvWatch = '1';
      card.addEventListener('contentvisibilityautostatechange', (e) => {
        if (!(e as Event & { skipped?: boolean }).skipped) measureCard(card);
      });
    }
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
  // Its height in the new state: full when open, the fixed height when closed.
  card.style.height = '';
  const to = card.offsetHeight;
  card.style.height = `${from}px`;
  void card.offsetHeight; // reflow so the transition starts from `from`
  card.style.transition = '';
  card.style.height = `${to}px`;
  // The card's own height, not the button's icon turning (which ends first);
  // a card whose height doesn't change gets no transition, so a timer backs it up.
  let finished = false;
  const done = (e?: TransitionEvent) => {
    if (finished || (e && (e.target !== card || e.propertyName !== 'height'))) return;
    finished = true;
    card.removeEventListener('transitionend', done);
    card.style.height = '';
    if (!opening) {
      card.querySelector('.banner-scroll')?.scrollTo({ top: 0 });
      // Expanded cards aren't measured (markOverflow), so a filter changed
      // while open left Expand stale: measure again now it's collapsed.
      markOverflow();
    }
  };
  card.addEventListener('transitionend', done);
  setTimeout(done, 600);
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
  if (choice === 'cancel') return;
  // Replacing removes pulls, which must never reach Google Drive: sign this
  // browser out first, so the Drive copy stays as it was.
  if (choice === 'replace' && signOutBeforeLosingPulls())
    toast('This browser was signed out of Google Drive so your Drive copy stays as it was.');
  await runImport(e.text, e.source, choice);
}

/** Signs out of Drive sync before a change that removes pulls. True if it was signed in. */
function signOutBeforeLosingPulls(): boolean {
  if (!syncIsOn()) return false;
  signOut(true);
  return true;
}

function installImport(): void {
  let depth = 0;
  const overlay = document.querySelector('.drop-overlay')!;
  // Something dragged from the page itself (the profile picture, a portrait, a widget) isn't a file to import or read.
  let fromPage = false;
  addEventListener('dragstart', () => (fromPage = true));
  addEventListener('dragend', () => (fromPage = false));
  addEventListener('dragenter', (e) => {
    if (fromPage || !e.dataTransfer?.types.includes('Files')) return;
    depth++;
    // On Achievements and Archive a dropped recording or screenshot is read, not imported.
    overlay.classList.toggle('medals', parseRoute().page === 'achievements');
    overlay.classList.toggle('findings', parseRoute().page === 'archives');
    overlay.classList.toggle('essences', parseRoute().page === 'essences');
    overlay.classList.add('on');
  });
  addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      overlay.classList.remove('on');
    }
  });
  addEventListener('dragover', (e) => {
    if (!fromPage) e.preventDefault();
  });
  addEventListener('drop', async (e) => {
    if (fromPage) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('on');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (mediaToReader(files)) return;
    if (files[0]) await runImport(await files[0].text(), files[0].name);
  });
  addEventListener('paste', async (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if (mediaToReader([...(e.clipboardData?.files ?? [])])) return e.preventDefault();
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

/**
 * Videos and pictures pasted or dropped on the page: on Achievements they're
 * read for medals, on Archive for findings (like those pages' Read from
 * video or screenshots buttons); elsewhere they can't be pull history, so
 * say where to take them. True if there were any.
 */
function mediaToReader(files: File[]): boolean {
  const media = files.filter((f) => f.type.startsWith('video/') || f.type.startsWith('image/'));
  if (!media.length) return false;
  const page = parseRoute().page;
  if (page === 'achievements') void readMedalsFrom(media);
  else if (page === 'archives') void readFindingsFrom(media);
  else if (page === 'essences') void readEssenceFiles(media);
  else toast('To read medals, findings or essences from a recording or screenshots, open Achievements, Archive or Essences and paste or drop them there.', 'error');
  return true;
}

/** A framed profile picture, what Edit picture reopens, and a place in the saved pictures. */
async function saveAvatar(done: { blob: Blob; edit: AvatarEdit; box?: AvatarBox }): Promise<void> {
  const at = Date.now();
  const edit = { ...done.edit, at };
  await saveAvatarEdit(edit);
  const id = at.toString(36);
  const history = await loadAvatarHistory();
  await saveAvatarHistory({ list: [{ id, at, blob: done.blob, pop: !!state.settings.avatarPop, box: done.box, edit }, ...history.list], current: id });
  forgetSavedAvatars();
  updateSettings({ avatarBox: done.box });
  await setImage('avatar', done.blob);
}

/** Back to a saved picture: it, how it showed, and its edit. */
async function useSavedAvatar(id: string): Promise<void> {
  const history = await loadAvatarHistory();
  const saved = history.list.find((x) => x.id === id);
  if (!saved) return;
  if (saved.edit) await saveAvatarEdit({ ...saved.edit, at: Date.now() });
  else await deleteAvatarEdit();
  await saveAvatarHistory({ list: [saved, ...history.list.filter((x) => x !== saved)], current: id });
  forgetSavedAvatars();
  updateSettings({ avatarPop: saved.pop, avatarBox: saved.box });
  await setImage('avatar', saved.blob);
}

async function forgetSavedAvatar(id: string): Promise<void> {
  const history = await loadAvatarHistory();
  await saveAvatarHistory({ list: history.list.filter((x) => x.id !== id), current: history.current === id ? undefined : history.current });
  forgetSavedAvatars();
  draw();
}

/** Edit picture: the cropper again, from the upload and its framing (else the picture as it is, on a device that didn't upload it). */
async function editAvatar(): Promise<void> {
  try {
    const edit = await loadAvatarEdit();
    const source = edit?.source ?? (await loadImage('avatar'));
    if (!source) return;
    const done = await cropAvatar(source, !!state.settings.avatarPop, edit, state.settings.displayName);
    if (done) await saveAvatar(done);
  } catch {
    toast("That picture couldn't be opened.", 'error');
  }
}

/** Personalization in Settings: profile picture and display name. */
function installProfile(): void {
  document.getElementById('avatarInput')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      // The player frames it first (cropper.ts); Cancel keeps the old picture.
      const done = await cropAvatar(file, !!state.settings.avatarPop, undefined, state.settings.displayName);
      if (done) await saveAvatar(done);
    } catch {
      toast("That picture couldn't be opened. Try a PNG or JPG.", 'error');
    }
  });
  // Saved on Enter or leaving the field: saving per keystroke would redraw the page under the cursor.
  document.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    // Achievements: a medal's date, Reforging tier or Trimming.
    if (collectionChange(el)) return;
    if (el.dataset?.setting === 'displayName') updateSettings({ displayName: el.value.trim() });
    // Extra copies (Settings): edit one entry's copies or note.
    const editExtra = (i: number, patch: Partial<ExtraCopy>) =>
      updateSettings({ extras: extrasOf(state.settings).map((x, j) => (j === i ? { ...x, ...patch } : x)) });
    if (el.dataset?.extraCopies) editExtra(Number(el.dataset.extraCopies), { copies: Math.max(1, Math.min(99, Math.floor(Number(el.value)) || 1)) });
    if (el.dataset?.extraNote) editExtra(Number(el.dataset.extraNote), { note: el.value.trim() });
    if (el.dataset?.extraId) editExtra(Number(el.dataset.extraId), { id: el.value });
    // Loadout: a gear piece's Artifice level.
    if (el.dataset?.artificeOp) setArtifice(el.dataset.artificeOp, el.dataset.artificeSlot!, Number(el.value));
    // A weapon's page without Maxed Essence: its skill sliders are the player's ranks.
    if (el.dataset?.saveWpn) setWeaponRank(el.dataset.saveWpn, Number(el.dataset.saveIndex), Number(el.value), (el.dataset.saveBase ?? '').split(',').map(Number));
  });
  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLInputElement;
    if (e.key === 'Enter' && (el.dataset?.setting === 'displayName' || el.dataset?.extraNote || el.dataset?.extraCopies)) el.blur();
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

/**
 * Adds extra copies (Settings). An entry for the same item and note gets the
 * copies added to it instead of a second row.
 */
function addExtras(add: ExtraCopy[]): void {
  const list = [...extrasOf(state.settings)];
  for (const x of add) {
    // Only one Endministrator: the other one is a different pick, not more copies.
    const endmin = endministratorOf(list);
    if (isEndministrator(x.id) && endmin && endmin !== x.id) {
      toast('You already have the other Endministrator. Switch it in its row instead.', 'error');
      continue;
    }
    const i = list.findIndex((e) => e.id === x.id && e.note === x.note);
    if (i < 0) list.push({ ...x });
    else list[i] = { ...list[i], copies: Math.min(99, list[i].copies + x.copies) };
  }
  updateSettings({ extras: list });
}

async function onClick(e: MouseEvent): Promise<void> {
  if (navigate(e)) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el) return;
  // Achievements and Archive handle their own buttons.
  if (collectionAction(el.dataset.action ?? '', el) || essenceAction(el.dataset.action ?? '', el)) return draw();
  if (el.dataset.action === 'essence-read') return readEssences();
  switch (el.dataset.action) {
    case 'import':
      return document.getElementById('fileInput')!.click();
    case 'avatar-upload':
      return document.getElementById('avatarInput')!.click();
    case 'avatar-remove':
      void deleteAvatarEdit();
      void loadAvatarHistory().then((h) => saveAvatarHistory({ list: h.list, current: undefined }).then(forgetSavedAvatars));
      return setImage('avatar', null);
    case 'avatar-edit':
      return void editAvatar();
    case 'avatar-use':
      return void useSavedAvatar(el.dataset.value!);
    case 'avatar-forget':
      return void forgetSavedAvatar(el.dataset.value!);
    case 'avatar-shape':
      return updateSettings({ avatarPop: el.dataset.value === 'pop' });
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
        // An open card whose list now fits at its closed height has nothing to Collapse: close it.
        if (card.classList.contains('expanded') && fitsClosed(card)) toggleCard(card);
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
    case 'motion':
      return updateSettings({ motion: el.dataset.value === 'on' ? undefined : false });
    case 'home-clip':
      return updateSettings({ homeClip: el.dataset.value || undefined });
    case 'server':
      return updateSettings({ server: el.dataset.value as Server });
    case 'banner-scope':
      return updateSettings({ showAllBanners: el.dataset.value === 'all' });
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
    case 'copy-link':
      toast((await copyText(el.dataset.value!)) ? 'Link copied.' : "Couldn't copy the link.", 'info');
      break;
    case 'patch-toggle':
      togglePatch(el.dataset.value!);
      draw();
      break;
    case 'paid-income': {
      const v = el.dataset.value as PaidIncome;
      const now = state.settings.paidIncome ?? [];
      return updateSettings({ paidIncome: now.includes(v) ? now.filter((x) => x !== v) : PAID_INCOME.filter((x) => x === v || now.includes(x)) });
    }
    case 'art-manage':
      openArtManager(el.dataset.op!, el.dataset.name!, draw);
      break;
    case 'art-shuffle':
      shuffleArt(el.dataset.op!, draw);
      draw();
      break;
    case 'sort-open':
      openSortPopup(el.dataset.kind as Kind, el);
      break;
    case 'weapon-essence':
      setMaxEssence(el.dataset.wpn!, el.getAttribute('aria-pressed') !== 'true', (el.dataset.caps ?? '').split(',').filter(Boolean).map(Number));
      break;
    case 'attr-split':
      toggleBonusSplit();
      draw();
      break;
    case 'loadout-pick':
      await pickLoadoutSlot(el.dataset.op!, el.dataset.slot!, state.analysis, draw);
      break;
    case 'extra-add': {
      const id = (document.getElementById('extraItem') as HTMLSelectElement | null)?.value;
      if (!id) break;
      const copies = Math.max(1, Math.min(99, Math.floor(Number((document.getElementById('extraCopies') as HTMLInputElement).value)) || 1));
      const note = (document.getElementById('extraNote') as HTMLInputElement).value.trim();
      addExtras([{ id, copies, note }]);
      break;
    }
    case 'extra-preset': {
      const preset = EXTRA_PRESETS.find((p) => p.key === el.dataset.value);
      // Only what's missing: a preset never stacks copies on entries already there.
      const have = extrasOf(state.settings);
      const endmin = endministratorOf(have);
      if (preset) addExtras(preset.extras.filter((x) => !have.some((e) => e.id === x.id && e.note === x.note) && !(isEndministrator(x.id) && endmin)));
      break;
    }
    case 'extra-ids': {
      // `data-copies` (else one) of each listed item (the page leaves out ones already there).
      const ids = (el.dataset.value ?? '').split(',').filter(Boolean);
      const copies = Number(el.dataset.copies) || 1;
      addExtras(ids.map((id) => ({ id, copies, note: el.dataset.note ?? '' })));
      if (ids.length) toast(copies > 1 ? `Added ${ids.length} ${el.dataset.note ?? ''}, ${copies} copies each.` : `Added ${ids.length} ${el.dataset.note ?? ''} ${ids.length === 1 ? 'copy' : 'copies'}.`);
      break;
    }
    case 'extra-remove':
      updateSettings({ extras: extrasOf(state.settings).filter((_, i) => i !== Number(el.dataset.value)) });
      break;
    case 'export-backup':
      return exportBackup();
    case 'restore-snapshot': {
      // Restoring can remove pulls, which must never reach Google Drive.
      const signedOut = signOutBeforeLosingPulls();
      try {
        const { chars, weaps, savedCurrent } = await restoreSnapshot(el.dataset.value!);
        toast(
          `Restored ${fmtInt(chars)} operator and ${fmtInt(weaps)} arsenal records.` +
            (savedCurrent ? ' Your previous pulls were saved to version history.' : '') +
            (signedOut ? ' This browser was signed out of Google Drive; the copy there is untouched.' : ''),
        );
      } catch (err) {
        toast(`Couldn't restore: ${(err as Error).message}`, 'error');
      }
      return;
    }
    case 'restore-drive-snapshot': {
      // Download it while still signed in, then sign out (so the removal never reaches Drive) and restore.
      try {
        const copy = await downloadDriveSnapshot(el.dataset.value!);
        const signedOut = signOutBeforeLosingPulls();
        const { chars, weaps, savedCurrent } = await restoreCopy(copy);
        toast(
          `Restored ${fmtInt(chars)} operator and ${fmtInt(weaps)} arsenal records from Google Drive.` +
            (savedCurrent ? ' Your previous pulls were saved to version history.' : '') +
            (signedOut ? ' This browser was signed out of Google Drive; the copy there is untouched.' : ''),
        );
      } catch (err) {
        toast(`Couldn't restore: ${(err as Error).message}`, 'error');
      }
      return;
    }
    case 'clear-all':
      setConfirmingDelete(el.dataset.value === 'pulls' ? 'pulls' : 'all');
      return draw();
    case 'clear-cancel':
      setConfirmingDelete(null);
      return draw();
    case 'clear-confirm': {
      setConfirmingDelete(null);
      const pullsOnly = el.dataset.value === 'pulls';
      // Deleting never reaches Google Drive: sign this browser out first so
      // nothing syncs, and leave the Drive copy exactly as it was.
      const wasSynced = syncIsOn();
      if (wasSynced) signOut(true);
      const driveNote = wasSynced ? ' This browser was signed out of Google Drive; the copy there is untouched.' : '';
      try {
        if (pullsOnly) {
          await clearHistory();
          toast(`Pull history deleted from this browser. Your name, picture and settings were kept.${driveNote}`);
        } else {
          await clearEverything();
          toast(`All saved data was deleted from this browser.${driveNote}`);
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
  installCardGlow();
  loadIcons(draw);
  installParallax();
  installSlideshows();
  installTooltips();
  installImport();
  installTimelineLabels();
  installCopyMenu();
  installHomeWidgets();
  installWikiControls();
  installListSearch();
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
