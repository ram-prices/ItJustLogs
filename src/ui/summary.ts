import { itemIconUrl } from '../domain/banners';
import type { Kind } from '../domain/types';
import { state } from '../state';
import { escape as esc } from './html';
import type { SummaryItem, ViewModel } from './model';

/**
 * The 6★ summary strip from eftracker's render-summary.js: one row by default,
 * click to expand up to `summaryMaxRows`, with a staged first-reveal animation.
 */

const expandedState: Record<string, boolean> = {};
const row1Animating: Record<Kind, boolean> = { char: false, weap: false };
const pendingExpand: Record<Kind, boolean> = { char: false, weap: false };
const animated = new Set<Kind>();
const ROW1_DONE_MS = 1950;

const containerId = (k: Kind) => `summary-${k}-container`;
const charColor = (p: SummaryItem['pity']) =>
  p === 'FREE' ? 'var(--color-green)' : p === 'TOKEN' ? 'var(--accent-blue)' : p < 40 ? 'var(--color-green)' : p <= 65 ? 'var(--color-yellow)' : 'var(--color-red)';
const weapColor = (p: SummaryItem['pity']) =>
  p === 'FREE' ? 'var(--color-green)' : p === 'TOKEN' ? 'var(--accent-blue)' : p < 4 ? 'var(--color-green)' : p <= 6 ? 'var(--color-yellow)' : 'var(--color-red)';

function iconImg(i: SummaryItem, extraStyle = ''): string {
  const url = itemIconUrl(i.kind, i.id);
  const title = i.name + (i.bannerName === 'Basic Headhunting' ? ' (Basic Headhunting)' : '');
  return url
    ? `<img src="${url}" title="${esc(title)}" class="summary-icon ${i.rarity === 5 ? 'summary-icon-5' : 'summary-icon-6'}" ${extraStyle} loading="lazy" data-fallback alt="">`
    : `<div class="summary-icon summary-icon-6" title="${esc(title)}" style="display:grid;place-items:center;font-family:monospace;color:var(--accent-blue);">✦</div>`;
}

export function renderSummary(kind: Kind, vm: ViewModel): string {
  const limit = state.settings.summaryBannerLimit >= 50 ? Infinity : state.settings.summaryBannerLimit;
  const recent = new Set(vm.timeline[kind].slice(-limit).map((b) => b.summary.poolId));
  const items = [...vm.summary[kind]].reverse().filter((i) => recent.has(i.poolId));
  let html = `<div class="summary-label">${kind === 'char' ? 'OPERATORS' : 'ARSENALS'}</div>`;

  if (kind === 'weap') {
    // Several 6★s inside one ten-pull (0 blocks apart) share one pill.
    const groups: SummaryItem[][] = [];
    let cur: SummaryItem[] = [];
    for (const i of items) {
      cur.push(i);
      if (i.pity !== 0) {
        groups.push(cur);
        cur = [];
      }
    }
    if (cur.length) groups.push(cur);
    for (const g of groups) {
      const main = g[g.length - 1];
      html += `<div class="summary-item summary-char-item">
        <div style="display: flex; gap: 2px; background-color: var(--summary-pill-bg, #141414); border-radius: 12px; overflow: hidden; align-items: center;">${g
          .map((i) => iconImg(i, 'style="background-color: transparent; border-radius: 0;"'))
          .join('')}</div>
        <div class="summary-char-pity"><span class="luck-dot" style="background-color: ${weapColor(main.pity)};"></span>${main.pity}</div>
      </div>`;
    }
  } else {
    for (const i of items) {
      html += `<div class="summary-item summary-char-item" title="${esc(i.name + (i.bannerName === 'Basic Headhunting' ? ' (Basic Headhunting)' : ''))}">
        ${iconImg(i)}
        <div class="summary-char-pity"><span class="luck-dot" style="background-color: ${charColor(i.pity)};"></span>${i.pity}</div>
      </div>`;
    }
  }
  return html;
}

function revealOverflowItems(container: HTMLElement, animate = true): void {
  container.querySelectorAll<HTMLElement>('.summary-item.overflow-item').forEach((item) => {
    item.classList.remove('fade-out');
    if (animate) item.classList.add('reveal-overflow');
    else {
      item.style.transition = 'none';
      item.classList.add('reveal-overflow');
      void item.offsetWidth;
      item.style.transition = '';
    }
  });
}

export function checkSummaryOverflow(): void {
  const maxHeight = `${state.settings.summaryMaxRows * 140}px`;
  for (const kind of ['char', 'weap'] as const) {
    const c = document.getElementById(containerId(kind));
    if (!c || c.offsetParent === null) continue;
    const items = c.querySelectorAll<HTMLElement>('.summary-item');
    const noExpand = () => {
      c.classList.add('no-expand');
      c.classList.remove('expanded');
      c.style.maxHeight = '';
      expandedState[c.id] = false;
    };
    if (items.length <= 1) {
      noExpand();
      continue;
    }
    const firstTop = items[0].offsetTop;
    const overflowing = Math.abs(items[items.length - 1].offsetTop - firstTop) > 10;
    items.forEach((it) => it.classList.toggle('overflow-item', Math.abs(it.offsetTop - firstTop) > 10));
    if (!overflowing) {
      noExpand();
      continue;
    }
    c.classList.remove('no-expand');
    if (state.settings.summaryExpandedByDefault && !(c.id in expandedState)) expandedState[c.id] = true;
    if (expandedState[c.id] && !row1Animating[kind]) {
      c.classList.add('expanded');
      c.style.maxHeight = maxHeight;
      revealOverflowItems(c, !c.querySelector('.summary-item.overflow-item.reveal-overflow'));
    }
  }
}

export function toggleSummaryExpand(el: HTMLElement): void {
  if (el.classList.contains('no-expand')) return;
  const expanding = !el.classList.contains('expanded');
  const kind: Kind = el.id.includes('char') ? 'char' : 'weap';
  expandedState[el.id] = expanding;
  const ease = 'max-height 0.4s cubic-bezier(0.25, 1, 0.5, 1)';

  if (expanding) {
    el.classList.add('manual-expand', 'expanding');
    el.style.overflowY = 'hidden';
    const start = el.offsetHeight;
    el.style.transition = 'none';
    el.style.maxHeight = 'none';
    el.classList.add('expanded');
    const end = el.offsetHeight;
    el.style.maxHeight = `${start}px`;
    void el.offsetHeight;
    el.style.transition = ease;
    el.style.maxHeight = `${end}px`;
    setTimeout(() => {
      if (el.classList.contains('expanded')) {
        el.style.maxHeight = 'none';
        el.classList.remove('expanding');
        el.style.overflowY = '';
      }
    }, 400);
    if (row1Animating[kind]) pendingExpand[kind] = true;
    else revealOverflowItems(el);
    return;
  }

  el.classList.add('collapsing');
  el.classList.remove('manual-expand');
  el.style.overflowY = 'hidden';
  pendingExpand[kind] = false;
  const overflowItems = el.querySelectorAll<HTMLElement>('.summary-item.overflow-item');
  const finish = (target: string) => {
    const start = el.offsetHeight;
    el.style.maxHeight = `${start}px`;
    void el.offsetHeight;
    el.style.transition = ease;
    el.style.maxHeight = target;
    el.classList.remove('expanded');
    setTimeout(() => {
      if (!el.classList.contains('expanded')) {
        el.style.maxHeight = '';
        el.classList.remove('collapsing');
        el.style.overflowY = '';
        el.style.transition = '';
      }
      overflowItems.forEach((i) => i.classList.remove('fade-out'));
    }, 400);
  };
  if (row1Animating[kind]) finish('140px');
  else {
    overflowItems.forEach((i) => {
      i.classList.remove('reveal-overflow');
      i.classList.add('fade-out');
    });
    setTimeout(() => finish(el.matches(':hover') ? '160px' : '140px'), 300);
  }
}

/** First visit to a tab: yellow bar scales in, label flickers, row one fades up. */
export function triggerSummaryAnimation(kind: Kind): void {
  if (animated.has(kind)) return;
  const c = document.getElementById(containerId(kind));
  if (!c) return;
  animated.add(kind);
  row1Animating[kind] = true;
  pendingExpand[kind] = false;
  const byDefault = state.settings.summaryExpandedByDefault;
  if (byDefault) {
    if (!(c.id in expandedState)) expandedState[c.id] = true;
    if (expandedState[c.id]) {
      c.style.transition = 'none';
      c.style.maxHeight = 'none';
      c.classList.add('expanded');
      c.style.maxHeight = `${c.offsetHeight}px`;
      void c.offsetHeight;
    }
  }
  c.classList.add('initial-animate');
  setTimeout(() => {
    row1Animating[kind] = false;
    c.classList.remove('initial-animate');
    if (byDefault && c.classList.contains('expanded')) {
      c.style.maxHeight = 'none';
      c.style.transition = '';
      revealOverflowItems(c);
    }
    if (pendingExpand[kind]) {
      pendingExpand[kind] = false;
      revealOverflowItems(c);
    }
  }, ROW1_DONE_MS);
}

/** Settings toggle: snap both strips open or closed without re-rendering. */
export function applySummaryDefault(on: boolean): void {
  for (const kind of ['char', 'weap'] as const) {
    const c = document.getElementById(containerId(kind));
    if (!c || c.classList.contains('no-expand')) continue;
    expandedState[c.id] = on;
    if (!on) pendingExpand[kind] = false;
    c.classList.toggle('expanded', on);
    c.style.maxHeight = on ? 'none' : '';
    c.style.transition = '';
    c.querySelectorAll<HTMLElement>('.summary-item.overflow-item').forEach((i) => {
      i.style.transition = 'none';
      i.classList.remove('fade-out');
      i.classList.toggle('reveal-overflow', on);
      void i.offsetWidth;
      i.style.transition = '';
    });
  }
}
