import type { Kind } from '../domain/types';
import { clearEverything, setImage, state, subscribe, updateSettings } from '../state';
import type { Settings, ThemePref } from '../store';
import { installTooltips } from './charts';
import { installImageFallback, toast } from './common';
import { fallbackBannerHtml, renderBanners, renderOverviews } from './dashboard';
import { EXPORTER_SOURCE } from './guide';
import { buildViewModel, type ViewModel } from './model';
import { handlePlannerInput, plannerOutput, renderPlanner } from './planner';
import { exportSelected, importText, renderAbout, renderSettings, SETTINGS_SLIDERS, sliderLabel } from './settings';
import { patchView, renderDistribution, renderKpis, renderPatchCards, renderWeekly, SORT_LABEL } from './stats';
import { applySummaryDefault, checkSummaryOverflow, renderSummary, toggleSummaryExpand, triggerSummaryAnimation } from './summary';

/**
 * The page controller: eftracker's ui-tabs.js / main.js behaviour (sliding
 * tab switches, expandable banner boxes, filters, luck drawers, ambient tint)
 * driven by app state instead of globals.
 */

type Tab = 'char' | 'weap' | 'planner' | 'stats' | 'settings' | 'about';
const SECTION_ORDER: Tab[] = ['char', 'weap', 'planner', 'stats', 'settings', 'about'];
const DATA_TABS: Tab[] = ['char', 'weap', 'planner', 'stats'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let currentTab: Tab = 'settings';
let isAnimating = false;
const visited = new Set<Tab>();
const animatedDashboards = new Set<Kind>();
let vm: ViewModel | null = null;
let lastHistory: unknown = undefined;
let lastDb: unknown = undefined;
let lastSettings: Settings = { ...state.settings };

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderData(): void {
  const a = state.analysis;
  DATA_TABS.forEach((t) => ($(`tab-${t}`).style.display = a ? 'flex' : 'none'));
  $('overviewStats').style.display = a ? 'flex' : 'none';
  if (!a) {
    vm = null;
    return;
  }
  vm = buildViewModel(a);
  $('uniqueCharCount').textContent = String(a.char.uniqueItems);
  $('uniqueWeapCount').textContent = String(a.weap.uniqueItems);
  const overviews = renderOverviews(a);
  for (const k of ['char', 'weap'] as const) {
    $(`${k}OverviewDashboard`).innerHTML = overviews[k];
    $(`summary-${k}-container`).innerHTML = renderSummary(k, vm);
    $(`${k}BannerGrid`).innerHTML = renderBanners(k, vm);
  }
  document.querySelectorAll<HTMLElement>('.banner-box.warm-tint').forEach((b) => {
    b.style.setProperty('--banner-ambient', 'rgba(255, 152, 0, 0.16)');
    b.classList.add('has-tint');
  });
  document.querySelectorAll<HTMLElement>('.pull-list-container').forEach(updateBlockHeaders);
  $('plannerContent').innerHTML = renderPlanner(a);
  renderStats();
  initScrollReveal();
  setTimeout(checkSummaryOverflow, 500);
}

function renderStats(): void {
  const a = state.analysis;
  if (!a) return;
  $('patchStatsKpiDashboard').innerHTML = renderKpis(a);
  $('patchStatsDistributionCard').innerHTML = renderDistribution(a);
  $('weeklyCard').innerHTML = renderWeekly(a);
  $('patchCardsContainer').innerHTML = renderPatchCards(a);
  (['all', 'char', 'weap'] as const).forEach((f) => $(`patch-filter-${f}`).classList.toggle('active', f === patchView.filter));
  $('patch-sort-btn').textContent = SORT_LABEL[patchView.sort];
  initScrollReveal();
}

function renderSettingsTab(): void {
  $('settingsContent').innerHTML = renderSettings();
}

function resolvedTheme(t: ThemePref): 'light' | 'dark' {
  return t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
}

function applyAppearance(): void {
  const s = state.settings;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(s.theme);
  root.style.setProperty('--banner-blur', `${s.bannerBlur}px`);
  root.style.setProperty('--banner-pos-y', `${s.bannerPos}%`);
  document.body.classList.toggle('show-timestamps', s.showTimestamps);
  const hero = document.querySelector<HTMLElement>('.hero-banner')!;
  hero.style.backgroundImage = `url('${state.images.header ?? './banner.png'}')`;
  $<HTMLImageElement>('display-avatar').src = state.images.avatar ?? './profile.png';
  const nameEl = $('display-username');
  if (document.activeElement !== nameEl) nameEl.textContent = s.displayName || 'ItJustLogs';
}

/** Re-render only what changed since the last state emit. */
function refresh(): void {
  const prev = lastSettings;
  const s = state.settings;
  applyAppearance();
  if (state.history !== lastHistory || state.db !== lastDb) {
    lastHistory = state.history;
    lastDb = state.db;
    renderData();
    renderSettingsTab();
    if (!state.analysis && DATA_TABS.includes(currentTab)) showTabInstant('settings');
    else updateTabSlider(currentTab);
  } else if (vm && (prev.summaryBannerLimit !== s.summaryBannerLimit || prev.summaryMaxRows !== s.summaryMaxRows)) {
    for (const k of ['char', 'weap'] as const) $(`summary-${k}-container`).innerHTML = renderSummary(k, vm);
    setTimeout(checkSummaryOverflow, 50);
  }
  if (prev.summaryExpandedByDefault !== s.summaryExpandedByDefault) applySummaryDefault(s.summaryExpandedByDefault);
  if (prev.showTimestamps !== s.showTimestamps) {
    setTimeout(() => document.querySelectorAll<HTMLElement>('.pull-list-container').forEach(checkExpandButtonVisibility), 320);
  }
  if (prev.theme !== s.theme || prev.showTimestamps !== s.showTimestamps || prev.summaryExpandedByDefault !== s.summaryExpandedByDefault) {
    renderSettingsTab();
  }
  lastSettings = { ...s };
}

// ---------------------------------------------------------------------------
// Tabs (slide animation)
// ---------------------------------------------------------------------------

function updateTabSlider(tab: Tab): void {
  const btn = $(`tab-${tab}`);
  const slider = $('tabSlider');
  SECTION_ORDER.forEach((t) => $(`tab-${t}`).classList.toggle('active-tab', t === tab));
  if (!btn || btn.offsetParent === null) return;
  slider.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
  slider.style.width = `${btn.offsetWidth}px`;
  slider.style.height = `${btn.offsetHeight}px`;
}

function onShown(tab: Tab): void {
  if (tab === 'char' || tab === 'weap') {
    triggerSummaryAnimation(tab);
    checkSummaryOverflow();
    document.querySelectorAll<HTMLElement>(`#${tab}BannerGrid .pull-list-container`).forEach(updateBlockHeaders);
    if (!animatedDashboards.has(tab)) {
      const dash = $(`${tab}OverviewDashboard`);
      dash.classList.add('initial-animate');
      animatedDashboards.add(tab);
      setTimeout(() => dash.classList.remove('initial-animate'), 3000);
    }
  }
}

function firstVisit(sec: HTMLElement, tab: Tab): void {
  if (visited.has(tab)) {
    sec.classList.remove('first-visit');
    return;
  }
  visited.add(tab);
  sec.classList.add('first-visit');
  setTimeout(() => sec.classList.remove('first-visit'), 1500);
}

function showTabInstant(tab: Tab): void {
  SECTION_ORDER.forEach((t) => ($(`${t}-section`).style.display = t === tab ? 'block' : 'none'));
  currentTab = tab;
  firstVisit($(`${tab}-section`), tab);
  updateTabSlider(tab);
  onShown(tab);
  setTimeout(() => $(`${tab}-section`).querySelectorAll<HTMLElement>('.pull-list-container').forEach(checkExpandButtonVisibility), 50);
}

function switchTab(tab: Tab): void {
  if (isAnimating || tab === currentTab) return;
  if (!state.analysis && DATA_TABS.includes(tab)) return;
  isAnimating = true;
  updateTabSlider(tab);
  const oldTab = currentTab;
  const right = SECTION_ORDER.indexOf(tab) > SECTION_ORDER.indexOf(oldTab);
  currentTab = tab;
  const curr = $(`${oldTab}-section`);
  const next = $(`${tab}-section`);
  if (oldTab === 'char' || oldTab === 'weap') {
    $(`summary-${oldTab}-container`).classList.remove('initial-animate');
    $(`${oldTab}OverviewDashboard`).classList.remove('initial-animate');
  }
  curr.classList.remove('first-visit');
  firstVisit(next, tab);

  next.style.display = 'block';
  next.style.transition = 'none';
  next.style.transform = `translateX(${right ? '40px' : '-40px'})`;
  next.style.opacity = '0';
  next.style.zIndex = '3';
  curr.style.zIndex = '1';
  void next.offsetWidth;
  onShown(tab);

  const ease = 'cubic-bezier(0.25, 1, 0.5, 1)';
  curr.style.transition = next.style.transition = `transform 0.4s ${ease}, opacity 0.4s ${ease}`;
  curr.style.transform = `translateX(${right ? '-40px' : '40px'})`;
  curr.style.opacity = '0';
  next.style.transform = 'translateX(0)';
  next.style.opacity = '1';

  setTimeout(() => {
    Object.assign(curr.style, { display: 'none', transform: '', opacity: '', transition: '', zIndex: '' });
    Object.assign(next.style, { transition: '', zIndex: '' });
    isAnimating = false;
    if (tab === 'char' || tab === 'weap') checkSummaryOverflow();
    next.querySelectorAll<HTMLElement>('.pull-list-container').forEach(checkExpandButtonVisibility);
  }, 400);
}

// ---------------------------------------------------------------------------
// Banner boxes: expand, filters, luck drawers, ambient tint
// ---------------------------------------------------------------------------

function checkExpandButtonVisibility(container: HTMLElement): void {
  const box = container.parentElement!;
  const btn = box.querySelector<HTMLElement>('.banner-expand-area');
  if (!btn || container.offsetParent === null) return;
  const wasExpanded = box.classList.contains('expanded');
  box.classList.remove('expanded');
  const original = box.style.height;
  box.style.height = '600px';
  // Rows use content-visibility:auto, so off-screen ones report a 44px placeholder; measure them for real.
  container.classList.add('measuring');
  const overflow = container.scrollHeight > container.clientHeight + 2;
  container.classList.remove('measuring');
  if (overflow) {
    btn.style.display = 'flex';
    if (wasExpanded) {
      box.classList.add('expanded');
      box.style.height = original || 'auto';
    } else box.style.height = '';
  } else {
    btn.style.display = 'none';
    btn.textContent = '▼ EXPAND ▼';
    btn.classList.remove('active');
    box.style.height = '';
  }
}

function toggleExpand(btn: HTMLElement): void {
  const box = btn.closest<HTMLElement>('.banner-box')!;
  const expanding = !box.classList.contains('expanded');
  btn.textContent = expanding ? '▲ COLLAPSE ▲' : '▼ EXPAND ▼';
  btn.classList.toggle('active', expanding);
  if (expanding) {
    const start = box.offsetHeight;
    box.style.transition = 'none';
    box.style.height = 'auto';
    box.classList.add('expanded');
    const end = box.offsetHeight;
    box.style.height = `${start}px`;
    void box.offsetHeight;
    box.style.transition = '';
    box.style.height = `${end}px`;
    setTimeout(() => {
      if (btn.classList.contains('active')) box.style.height = 'auto';
    }, 400);
  } else {
    box.style.height = `${box.offsetHeight}px`;
    void box.offsetHeight;
    box.style.height = '600px';
    setTimeout(() => {
      if (!btn.classList.contains('active')) {
        box.classList.remove('expanded');
        box.style.height = '';
      }
    }, 400);
  }
}

function toggleLuckDrawer(item: HTMLElement): void {
  item.classList.toggle('expanded');
  const container = item.closest<HTMLElement>('.pull-list-container');
  if (!container) return;
  if (item.classList.contains('expanded')) setTimeout(() => container.scrollTo({ top: item.offsetTop - 15, behavior: 'smooth' }), 310);
  checkExpandButtonVisibility(container);
  setTimeout(() => checkExpandButtonVisibility(container), 320);
}

function updateBlockHeaders(container: HTMLElement): void {
  const filterBox = document.getElementById(`filters-${container.id.replace('list-', '')}`);
  if (!filterBox) return;
  const on = (f: string) => !!filterBox.querySelector(`.filter-btn.active[data-filter="${f}"]`);
  const f = { six: on('6'), five: on('5'), four: on('4'), ru: on('RU') };
  let header: HTMLElement | null = null;
  let headerHasItems = false;
  let visible = 0;
  for (const node of Array.from(container.querySelector('.pull-list')!.children) as HTMLElement[]) {
    if (node.classList.contains('pull-block-header')) {
      if (header) header.style.display = headerHasItems ? 'inline-block' : 'none';
      header = node;
      headerHasItems = false;
    } else {
      const c = node.classList;
      const show =
        (f.six && c.contains('rarity-6-item')) ||
        (f.five && c.contains('rarity-5-item')) ||
        (f.four && ['rarity-4-item', 'rarity-3-item', 'rarity-2-item', 'rarity-1-item'].some((r) => c.contains(r))) ||
        (f.ru && c.contains('is-rate-up-item'));
      node.style.display = show ? 'flex' : 'none';
      if (show) {
        headerHasItems = true;
        visible++;
      }
    }
  }
  if (header) header.style.display = headerHasItems ? 'inline-block' : 'none';
  const empty = container.querySelector<HTMLElement>('.empty-filter-msg');
  if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
  checkExpandButtonVisibility(container);
}

/** Average the banner art down to one saturated colour for the card's glow. */
function applyAmbientTint(bannerId: string, img: HTMLImageElement): void {
  const banner = document.getElementById(bannerId);
  if (!banner) return;
  setTimeout(() => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 10;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 10, 10);
      const d = ctx.getImageData(0, 0, 10, 10).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
      const n = d.length / 4;
      [r, g, b] = [r / n, g / n, b / n];
      const avg = (r + g + b) / 3;
      const sat = (v: number) => Math.min(255, Math.max(0, Math.floor(avg + (v - avg) * 2.2)));
      [r, g, b] = [sat(r), sat(g), sat(b)];
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      if (brightness < 100) {
        const boost = 100 / (brightness || 1);
        [r, g, b] = [r, g, b].map((v) => Math.min(255, Math.floor(v * boost)));
      }
      banner.style.setProperty('--banner-tint', `rgb(${r}, ${g}, ${b})`);
    } catch {
      banner.style.setProperty('--banner-tint', 'rgba(255, 255, 255, 0.1)');
    }
    banner.classList.add('has-tint');
  }, 100);
}

const reveal = new IntersectionObserver(
  (entries) =>
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        reveal.unobserve(e.target);
      }
    }),
  { threshold: 0.1 },
);
const initScrollReveal = () => document.querySelectorAll('.reveal-on-scroll:not(.visible)').forEach((el) => reveal.observe(el));

// ---------------------------------------------------------------------------
// Import: file picker, drag & drop anywhere, paste anywhere
// ---------------------------------------------------------------------------

async function runImport(text: string, source: string): Promise<void> {
  try {
    await importText(text, source);
    if (state.analysis && !DATA_TABS.includes(currentTab)) switchTab('char');
  } catch (e) {
    toast((e as Error).message, 'error');
  }
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
    } else if (text) toast('That doesn’t look like pull history. Run the exporter first, then paste.', 'error');
  });
  $('fileInput').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await runImport(await file.text(), file.name);
  });
}

// ---------------------------------------------------------------------------
// Delegated events
// ---------------------------------------------------------------------------

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const THEMES: ThemePref[] = ['dark', 'light', 'system'];

async function onClick(e: MouseEvent): Promise<void> {
  const target = e.target as HTMLElement;
  const tabBtn = target.closest<HTMLElement>('[data-tab]');
  if (tabBtn) return switchTab(tabBtn.dataset.tab as Tab);
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'filter': {
      el.classList.toggle('active');
      const box = el.closest('.banner-box')!;
      updateBlockHeaders(box.querySelector<HTMLElement>('.pull-list-container')!);
      return;
    }
    case 'expand':
      return toggleExpand(el);
    case 'luck':
      return toggleLuckDrawer(el);
    case 'summary':
      return toggleSummaryExpand(el);
    case 'patch-filter':
      patchView.filter = el.dataset.filter as typeof patchView.filter;
      return renderStats();
    case 'patch-sort': {
      const modes = Object.keys(SORT_LABEL) as (keyof typeof SORT_LABEL)[];
      patchView.sort = modes[(modes.indexOf(patchView.sort) + 1) % modes.length];
      return renderStats();
    }
    case 'patch-jump': {
      const card = document.getElementById(`patch-card-${el.dataset.key}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.style.boxShadow = '0 0 20px rgba(255, 250, 0, 0.4)';
      setTimeout(() => (card.style.boxShadow = ''), 1600);
      return;
    }
    case 'import':
      return $('fileInput').click();
    case 'clear-all':
      if (confirm('Remove all saved pulls, settings and images from this browser? Export a backup first if you want to keep them.')) {
        await clearEverything();
      }
      return;
    case 'copy-script':
      try {
        await navigator.clipboard.writeText(EXPORTER_SOURCE);
        toast('Script copied. Paste it into Windows PowerShell.');
      } catch {
        toast('Could not copy automatically. Select the script text and copy it.', 'error');
      }
      return;
    case 'cycle-theme':
      return updateSettings({ theme: THEMES[(THEMES.indexOf(state.settings.theme) + 1) % THEMES.length] });
    case 'toggle-setting': {
      const key = el.dataset.key as 'showTimestamps' | 'summaryExpandedByDefault';
      return updateSettings({ [key]: !state.settings[key] });
    }
    case 'reset-images':
      await setImage('avatar', null);
      await setImage('header', null);
      renderSettingsTab();
      return;
    case 'export':
      return exportSelected($('settingsContent'));
  }
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  const key = el.dataset.setting as keyof Settings | undefined;
  if (key && SETTINGS_SLIDERS.has(key)) {
    const v = Number(el.value);
    const label = document.querySelector(`[data-val="${key}"]`);
    if (label) label.textContent = sliderLabel(key, v);
    if (key === 'bannerBlur') document.documentElement.style.setProperty('--banner-blur', `${v}px`);
    if (key === 'bannerPos') document.documentElement.style.setProperty('--banner-pos-y', `${v}%`);
    if (key === 'summaryMaxRows' || key === 'summaryBannerLimit' || e.type === 'change') updateSettings({ [key]: v });
    return;
  }
  if (el.dataset.plan && state.analysis) {
    const what = handlePlannerInput(el, state.analysis);
    if (what === 'all') $('plannerContent').innerHTML = renderPlanner(state.analysis);
    else if (what === 'output') $('plannerOutput').innerHTML = plannerOutput();
  }
}

async function onChange(e: Event): Promise<void> {
  const el = e.target as HTMLInputElement;
  if (el.dataset.setting) return onInput(e);
  if (el.dataset.plan) {
    // Number inputs already updated on 'input'; selects and checkboxes only fire 'change'.
    if (el.tagName === 'SELECT' || el.type === 'checkbox') onInput(e);
    return;
  }
  const slot = el.dataset.image as 'avatar' | 'header' | undefined;
  if (slot && el.files?.[0]) {
    const file = el.files[0];
    el.value = '';
    if (!file.type.startsWith('image/')) return toast('That file is not an image.', 'error');
    if (file.size > MAX_IMAGE_BYTES) return toast('Please choose an image under 8 MB.', 'error');
    await setImage(slot, file);
    renderSettingsTab();
  }
}

function installEvents(): void {
  document.addEventListener('click', (e) => void onClick(e));
  document.addEventListener('input', (e) => {
    // Selects and checkboxes are handled on 'change' only, so they don't fire twice.
    const t = e.target as HTMLElement;
    if (t.tagName === 'SELECT' || (t as HTMLInputElement).type === 'checkbox') return;
    onInput(e);
  });
  document.addEventListener('change', (e) => void onChange(e));

  const nameEl = $('display-username');
  nameEl.addEventListener('blur', () => updateSettings({ displayName: (nameEl.textContent ?? '').trim().slice(0, 40) }));
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    }
  });

  // Banner art: tint the card from the image, or swap in the fallback showcase if it can't load.
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (img instanceof HTMLImageElement && img.dataset.tint) applyAmbientTint(img.dataset.tint, img);
    },
    true,
  );
  document.addEventListener('img-missing', (e) => {
    const img = e.target as HTMLImageElement;
    if (!img.hasAttribute('data-banner-art')) return;
    const id = img.dataset.tint!;
    const hero = img.closest('.banner-hero');
    const tpl = document.querySelector<HTMLTemplateElement>(`template[data-fallback-for="${id}"]`);
    if (hero && tpl) hero.replaceWith(tpl.content.cloneNode(true));
    else if (hero && vm) {
      const v = [...vm.char, ...vm.weap].find((x) => x.domId === id);
      if (v) hero.outerHTML = fallbackBannerHtml(v);
    }
  });

  let resizeTimer = 0;
  addEventListener('resize', () => {
    updateTabSlider(currentTab);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(checkSummaryOverflow, 100);
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);
}

export function mount(): void {
  installImageFallback();
  installTooltips();
  installImport();
  installEvents();
  $('aboutContent').innerHTML = renderAbout();
  subscribe(refresh);
  refresh();
  showTabInstant(state.analysis ? 'char' : 'settings');
  // Row heights change once the web fonts arrive; re-measure which banner boxes overflow.
  const recheck = () => {
    document.querySelectorAll<HTMLElement>('.pull-list-container').forEach(checkExpandButtonVisibility);
    checkSummaryOverflow();
    updateTabSlider(currentTab);
  };
  void document.fonts.ready.then(recheck);
  addEventListener('load', recheck, { once: true });
}
