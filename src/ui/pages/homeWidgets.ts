import type { Analysis } from '../../domain/analyze';
import { extrasOf, ownedItems } from '../../domain/owned';
import type { Kind } from '../../domain/types';
import type { WikiOperatorFile, WikiWeaponFile } from '../../domain/wiki';
import { state, updateSettings } from '../../state';
import type { HomeWidget } from '../../store';
import { bannerArtUrl } from '../../domain/banners';
import { badge, heroGlow, icon, itemImg, metric, metrics } from '../components';
import { fmtDate, fmtInt, html, raw, render, type Html } from '../html';
import { artOf, openArtManager } from './art';
import { archiveProgress } from './collections';
import { infoHref, wikiFile } from './info';
import { loadoutStrip, weaponDetail } from './loadout';
import { cardStats } from './operator';
import { sixStrip } from './kind';
import { earnedPerWeek } from './stats';

/**
 * Home as widgets: the player picks which show, in what order and how wide
 * (settings `home`, so it syncs). Each widget shows something the other tabs
 * already have: the schedule's sections, the player's pity and pulls, Stats,
 * collection progress, a note, or a card of a favourite operator. Without a
 * saved layout Home is the schedule as it always was (DEFAULT_HOME).
 */

/** The schedule's sections, drawn by home.ts. */
export interface ScheduleParts {
  /** The banners open now: Headhunting's and Arsenal's newest `char` and `weap` (undefined: all), re-runs or not. */
  banners: (char?: number, weap?: number, reruns?: boolean) => Html | null;
  events: Html | null;
  upcoming: Html | null;
  timeline: Html | null;
}

interface Ctx {
  parts: ScheduleParts;
  a: Analysis | null;
  redraw: () => void;
}

export type WidgetSize = 4 | 6 | 8 | 12;
/** Where a narrower widget sits in its row: left (starting a new row), centre or right; none picked: right after the one before it. */
const PLACES: ['left' | 'center' | 'right', string, string][] = [
  ['left', 'align_horizontal_left', 'Left'],
  ['center', 'align_horizontal_center', 'Centre'],
  ['right', 'align_horizontal_right', 'Right'],
];

const SIZES: [WidgetSize, string][] = [
  [4, '⅓'],
  [6, '½'],
  [8, '⅔'],
  [12, 'Full'],
];

/** Facts a character card can show. */
const FACTS: [string, string][] = [
  ['potential', 'Potential'],
  ['first', 'First obtained'],
  ['spent', 'Pulls on their banners'],
  ['weaponDetail', 'Weapon details'],
  ['gear', 'Gear'],
  ['stats', 'Stats'],
];

/** An operator's full art: the text-free art of their newest rate-up banner (ef-assets banners/). */
function fullArtOf(op: string): string | null {
  const pools = Object.entries(state.db)
    .filter(([id, e]) => !id.startsWith('weponbox') && (e.rateUpIds ?? []).includes(op))
    .map(([id]) => id)
    .sort()
    .reverse();
  for (const id of pools) {
    const url = bannerArtUrl(id);
    if (url) return url;
  }
  return null;
}

interface WidgetDef {
  label: string;
  about: string;
  size: WidgetSize;
  /** Shows the player's pulls: a hint to import until they do. */
  pulls?: boolean;
  /** Has its own settings (the pencil in edit mode). */
  editable?: boolean;
  /** Its content, or null when there's nothing to show right now. */
  render: (w: HomeWidget, c: Ctx) => Html | null;
}

const WIDGETS: Record<string, WidgetDef> = {
  banners: {
    label: 'Current Banners',
    about: 'The banners open now, with your pity on each. Pick which kinds and how many.',
    size: 12,
    editable: true,
    render: (w, c) => c.parts.banners(w.char, w.weap, w.reruns !== false),
  },
  events: { label: 'Current events', about: 'Events running now.', size: 12, render: (_, c) => c.parts.events },
  upcoming: { label: 'Upcoming', about: 'Banners and events coming next.', size: 12, render: (_, c) => c.parts.upcoming },
  timeline: { label: 'Timeline', about: 'Versions, banners and events on a timeline.', size: 12, render: (_, c) => c.parts.timeline },
  pity: { label: 'Pity', about: 'Your 6★ pity and rate-up guarantees right now.', size: 6, pulls: true, render: (_, c) => pityWidget(c.a!) },
  sixes: { label: '6★ history', about: 'Every 6★ operator you pulled, newest first.', size: 12, pulls: true, render: (_, c) => sixStrip('char', c.a!) },
  latest: { label: 'Latest pulls', about: 'Your last 10 pulls of 5★ and up.', size: 6, pulls: true, render: (_, c) => latestWidget(c.a!) },
  stats: { label: 'Stats', about: 'Pulls spent and what you earn each week.', size: 12, pulls: true, render: (_, c) => statsWidget(c.a!, c.redraw) },
  progress: { label: 'Collection', about: 'Operators and arsenals owned, Achievements, Archive and Essences.', size: 6, render: (_, c) => progressWidget(c) },
  character: { label: 'Character card', about: 'A card of an operator you pick: picture, title, note and the facts you choose.', size: 4, editable: true, render: (w, c) => characterWidget(w, c) },
  note: { label: 'Note', about: 'Your own text.', size: 4, editable: true, render: (w) => noteWidget(w) },
  spacer: {
    label: 'Empty space',
    about: 'Blank room across the page between widgets. Drag its bottom edge to make it taller or shorter.',
    size: 12,
    render: (w) => html`<div class="widget-spacer" style="height:${w.height ?? SPACER_HEIGHT}px"></div>`,
  },
};

/** An empty space's height until it's dragged; the least it can be. */
const SPACER_HEIGHT = 120;
const SPACER_MIN = 16;

const DEFAULT_HOME: HomeWidget[] = [
  { id: 'banners', type: 'banners', size: 12 },
  { id: 'events', type: 'events', size: 12 },
  { id: 'upcoming', type: 'upcoming', size: 12 },
  { id: 'timeline', type: 'timeline', size: 12 },
];

const layout = (): HomeWidget[] =>
  (state.settings.home ?? DEFAULT_HOME)
    .filter((w) => WIDGETS[w.type])
    // An empty space is always full width, never in a column or placed.
    .map((w) => (w.type === 'spacer' ? { ...w, size: 12 as const, under: undefined, align: undefined, col: undefined } : w));
/** Saves the layout; a widget that can't stack (first, or under a full-width one) is unmarked. */
const save = (next: HomeWidget[]) => updateSettings({ home: columns(next).flatMap((col) => col.map((w, i) => (i === 0 && w.under ? { ...w, under: undefined } : w))) });
const newId = (type: string) => `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Edit mode (kept while the app is open), and the layout as it was when it began (for Cancel). */
let editing = false;
let before: HomeWidget[] | undefined;
let beforePhone: { order: string[]; hidden?: string[] } | undefined;

/** A phone-width screen: Home is one column there, with its own order and hidden widgets. */
const PHONE = '(max-width: 640px)';
const isPhone = () => matchMedia(PHONE).matches;

/**
 * Home's widgets for a phone: its own order first, then any it doesn't list
 * (new ones, or before it was ever customized) in the wide layout's reading
 * order (row by row, left to right, a column's widgets top to bottom).
 */
function phoneLayout(): { list: HomeWidget[]; hidden: Set<string> } {
  const cols = columns(layout());
  const places = gridPlaces(cols.map((c) => c[0]));
  const reading = cols
    .map((c, i) => ({ c, at: places[i] }))
    .sort((p, q) => p.at.row - q.at.row || p.at.start - q.at.start)
    .flatMap((x) => x.c);
  const phone = state.settings.homePhone;
  const byId = new Map(reading.map((w) => [w.id, w]));
  const listed = (phone?.order ?? []).filter((id) => byId.has(id));
  const list = [...listed.map((id) => byId.get(id)!), ...reading.filter((w) => !listed.includes(w.id))];
  return { list, hidden: new Set(phone?.hidden ?? []) };
}
const savePhone = (order: string[], hidden: Set<string>) => updateSettings({ homePhone: { order, ...(hidden.size ? { hidden: [...hidden] } : {}) } });
let redrawNow: () => void = () => {};

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/** The layout as columns: each widget with the ones stacked under it (full-width widgets stand alone). */
function columns(list: HomeWidget[]): HomeWidget[][] {
  const out: HomeWidget[][] = [];
  for (const w of list) {
    if (w.under && out.length && out[out.length - 1][0].size !== 12) out[out.length - 1].push(w);
    else out.push([w]);
  }
  return out;
}

/**
 * Where each grid item (a widget or a column, by its top widget) goes on a
 * wide screen: rows filled in order, each item at its column (`col`, where it
 * was dropped) or place (left, middle or right of the row) if that part of
 * the row is free, else after the last one; left, a row break (`newRow`) or
 * no room starts the next row.
 */
function gridPlaces(heads: HomeWidget[]): { row: number; start: number }[] {
  let row = 1;
  let used = new Set<number>();
  let next = 1;
  const free = (start: number, n: number) => start >= 1 && start + n <= 13 && [...Array(n).keys()].every((k) => !used.has(start + k));
  const newRow = () => {
    row++;
    used = new Set();
    next = 1;
  };
  return heads.map((h) => {
    const n = h.size;
    const at = () =>
      h.col ? Math.min(h.col, 13 - n) : h.align === 'left' ? 1 : h.align === 'center' ? Math.floor((12 - n) / 2) + 1 : h.align === 'right' ? 13 - n : next;
    if (used.size && (h.newRow || h.align === 'left' || !free(at(), n))) newRow();
    const start = at();
    for (let k = 0; k < n; k++) used.add(start + k);
    next = Math.max(next, start + n);
    return { row, start };
  });
}

/** Empty room in the grid where a dragged widget would land: its row's place, column and width, and the outline's box. */
interface Room {
  grid: HTMLElement;
  /** The last widget (by id) of the row it joins; null: the very end. */
  after: string | null;
  /** Below every row: a row of its own. */
  newRow: boolean;
  start: number;
  size: WidgetSize;
  box: { left: number; top: number; width: number; height: number };
}

/**
 * The empty room at a point while dragging (wide screens only): the run of
 * free columns in the row there, the widget at its widest that fits (no wider
 * than it is now) centred on the point. Below every row: a new row.
 */
function roomAt(x: number, y: number, dragged: HTMLElement): Room | null {
  const grid = document.querySelector<HTMLElement>('.home-grid.editing');
  if (!grid || !matchMedia('(min-width: 901px)').matches) return null;
  const g = grid.getBoundingClientRect();
  if (x < g.left || x > g.right || y < g.top) return null;
  const colW = (g.width + 16) / 12;
  const items = [...grid.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('.widget, .widget-col') && el !== dragged);
  const rows = new Map<number, HTMLElement[]>();
  for (const el of items) {
    const row = Number(el.style.getPropertyValue('--row'));
    rows.set(row, [...(rows.get(row) ?? []), el]);
  }
  let row: HTMLElement[] = [];
  let band: { top: number; bottom: number } | null = null;
  for (const els of rows.values()) {
    const top = Math.min(...els.map((el) => el.getBoundingClientRect().top));
    const bottom = Math.max(...els.map((el) => el.getBoundingClientRect().bottom));
    if (y >= top && y <= bottom) {
      row = els;
      band = { top, bottom };
    }
  }
  const last = Math.max(0, ...items.map((el) => el.getBoundingClientRect().bottom));
  const below = !band && y > last;
  if (!band && !below) return null;
  const used = new Set<number>();
  for (const el of row) {
    const start = Number(el.style.getPropertyValue('--start'));
    const span = Number(el.style.getPropertyValue('--span'));
    for (let k = 0; k < span; k++) used.add(start + k);
  }
  const c = Math.min(12, Math.max(1, Math.floor((x - g.left) / colW) + 1));
  if (used.has(c)) return null;
  let lo = c;
  while (lo > 1 && !used.has(lo - 1)) lo--;
  let hi = c;
  while (hi < 12 && !used.has(hi + 1)) hi++;
  const now = Number(dragged.dataset.size) as WidgetSize;
  const size = ([12, 8, 6, 4] as WidgetSize[]).find((n) => n <= Math.min(hi - lo + 1, now)) ?? null;
  if (!size) return null;
  const start = Math.min(Math.max(c - Math.floor(size / 2), lo), hi - size + 1);
  const ids = (below ? items : row).flatMap((el) => idsOf(el)).filter((id) => id !== dragged.dataset.widget);
  const top = band ? band.top : last + 40;
  return {
    grid,
    after: ids.length ? ids[ids.length - 1] : null,
    newRow: below,
    start,
    size,
    box: { left: (start - 1) * colW, top: top - g.top, width: size * colW - 16, height: band ? Math.max(80, band.bottom - band.top) : 120 },
  };
}

/** The grid items (widgets and columns) in the row, as shown now, where widget `id`'s column sits. */
function rowOf(id: string): HTMLElement[] {
  const el = document.querySelector<HTMLElement>(`.home-grid [data-widget="${CSS.escape(id)}"]`);
  const item = el?.parentElement?.classList.contains('widget-col') ? el.parentElement : el;
  if (!item?.parentElement) return [];
  return [...item.parentElement.children].filter((x): x is HTMLElement => x instanceof HTMLElement && !x.classList.contains('row-break') && Math.abs(x.offsetTop - item.offsetTop) < 2);
}
/** The ids of a grid item's widgets, top first. */
const idsOf = (item: HTMLElement): string[] => (item.dataset.widget ? [item.dataset.widget] : [...item.querySelectorAll<HTMLElement>('[data-widget]')].map((x) => x.dataset.widget!));

/** The last widget (by id) in that row. */
function rowEndOf(id: string): string {
  const row = rowOf(id);
  return row.length ? idsOf(row[row.length - 1]).pop() ?? id : id;
}

/**
 * The places the widgets in that row are at now (by their top widget's id),
 * for those that sit exactly at its left, middle or right: placing one widget
 * pins the others there, so they don't slide along after it.
 */
function rowPlaces(id: string, leftOnly = false): Map<string, 'left' | 'center' | 'right'> {
  const places = new Map<string, 'left' | 'center' | 'right'>();
  const row = rowOf(id);
  const grid = row[0]?.parentElement?.getBoundingClientRect();
  if (!grid) return places;
  const col = (grid.width + 16) / 12;
  const own = row.find((x) => idsOf(x).includes(id))?.getBoundingClientRect().left ?? Infinity;
  for (const item of row) {
    const r = item.getBoundingClientRect();
    if (leftOnly && r.left >= own) continue;
    const start = Math.round((r.left - grid.left) / col) + 1;
    const span = Math.round((r.width + 16) / col);
    const at = start === 1 ? 'left' : start === Math.floor((12 - span) / 2) + 1 ? 'center' : start + span === 13 ? 'right' : null;
    if (at) places.set(idsOf(item)[0], at);
  }
  return places;
}

/**
 * Gives widget `id` its own width or place (`patch`), touching no other
 * widget; null when it already has it (`same`, asked of its column's top).
 * Each widget keeps its height on the page: one from inside a column leaves
 * it and starts a row below it; a column's top widget stays on top, and the
 * rest of its column moves to a row below. What moves down goes after the
 * last widget of the row on screen, and the widgets in that row are pinned
 * where they are, so nothing beside it slides along (for a new width, only
 * those to its left: the ones to its right shift over if it grows).
 */
function separate(id: string, patch: Partial<HomeWidget>, same: (head: HomeWidget) => boolean): HomeWidget[] | null {
  const pinned = rowPlaces(id, 'size' in patch);
  const list = layout().map((w) => (!w.align && pinned.has(w.id) ? { ...w, align: pinned.get(w.id) } : w));
  const col = columns(list).find((x) => x.some((w) => w.id === id)) ?? [];
  if (!col.length || same(col[0])) return null;
  if (col.length === 1) return list.map((w) => (w.id === id ? { ...w, ...patch } : w));
  const head = col[0];
  const start = list.indexOf(head);
  const rowLast = rowEndOf(id);
  const i = list.findIndex((x) => x.id === id);
  if (i === start) {
    const rest = list.splice(start + 1, col.length - 1);
    rest[0] = { ...rest[0], under: undefined, size: head.size, align: head.align, col: head.col, newRow: true };
    list[start] = { ...head, ...patch };
    const at = list.findIndex((x) => x.id === rowLast);
    list.splice((at < 0 ? start : at) + 1, 0, ...rest);
  } else {
    // The row's last widget comes at or after this one; once this is taken out, insert right after it.
    const found = list.findIndex((x) => x.id === rowLast);
    const at = found < i ? list.indexOf(col[col.length - 1]) : found;
    const [w] = list.splice(i, 1);
    list.splice(at, 0, { ...w, under: undefined, size: head.size, align: head.align, col: head.col, newRow: true, ...patch });
  }
  return list;
}

/** Takes widget `i` out of the list; the one stacked under it, if any, takes its place at the column's top. */
function detach(list: HomeWidget[], i: number): HomeWidget {
  const [w] = list.splice(i, 1);
  if (!w.under && list[i]?.under) list[i] = { ...list[i], under: undefined, size: w.size, align: w.align, col: w.col, newRow: w.newRow };
  return w;
}

export function widgetGrid(parts: ScheduleParts, a: Analysis | null, redraw: () => void): Html {
  redrawNow = redraw;
  const c: Ctx = { parts, a, redraw };
  const bodyOf = (w: HomeWidget): Html | null =>
    WIDGETS[w.type].pulls && !a ? html`<p class="copy-14 secondary widget-empty">Import your pulls to see this.</p>` : WIDGETS[w.type].render(w, c);
  // A column's widgets take its top widget's width and place; a lone one is itself the grid's item,
  // at the row and column `gridPlaces` gives it.
  const place = (head: HomeWidget, at: { row: number; start: number }) =>
    raw(`data-size="${head.size}" style="--span:${head.size};--row:${at.row};--start:${at.start}"`);
  const cell = (w: HomeWidget, body: Html | null, head: HomeWidget, at: { row: number; start: number } | null): Html =>
    html`<section class="widget${w.hideTitle ? ' no-title' : ''}" data-widget="${w.id}" data-type="${w.type}" ${at ? place(head, at) : raw(`data-size="${head.size}"`)}>
      ${editing ? toolbar({ ...w, size: head.size, align: head.align }, WIDGETS[w.type]) : ''}
      <div class="widget-body">${body ?? html`<p class="copy-14 secondary widget-empty">Nothing to show right now.</p>`}</div>
      ${editing && w.type === 'spacer' ? html`<span class="spacer-edge" title="Drag to make it taller or shorter"></span>` : ''}
    </section>`;
  if (isPhone()) {
    // One column in the phone's own order; hidden widgets show (faded) only while customizing.
    const { list, hidden } = phoneLayout();
    const cells = list
      .filter((w) => editing || !hidden.has(w.id))
      .map((w) => ({ w, body: bodyOf(w) }))
      .filter((x) => x.body || editing)
      .map(
        ({ w, body }) => html`<section class="widget${w.hideTitle ? ' no-title' : ''}${hidden.has(w.id) ? ' phone-hidden' : ''}" data-widget="${w.id}" data-type="${w.type}" data-size="12">
          ${editing ? phoneToolbar(w, WIDGETS[w.type], hidden.has(w.id)) : ''}
          <div class="widget-body">${body ?? html`<p class="copy-14 secondary widget-empty">Nothing to show right now.</p>`}</div>
        </section>`,
      );
    return html`${tools()}<div class="home-grid phone${editing ? ' editing' : ''}">${cells}</div>`;
  }
  const items = columns(layout())
    .map((col) => ({ head: col[0], shown: col.map((w) => ({ w, body: bodyOf(w) })).filter((x) => x.body || editing) }))
    .filter((x) => x.shown.length);
  const places = gridPlaces(items.map((x) => x.head));
  const cells = items.map(({ head, shown }, i) =>
    shown.length === 1
      ? cell(shown[0].w, shown[0].body, head, places[i])
      : html`<div class="widget-col" ${place(head, places[i])}>${shown.map((x) => cell(x.w, x.body, head, null))}</div>`,
  );
  return html`${tools()}<div class="home-grid${editing ? ' editing' : ''}">${cells}</div>`;
}

/** Customize, or while customizing: add, reset, cancel, done. */
function tools(): Html {
  return html`<div class="home-tools">
    ${editing
      ? html`<button type="button" class="btn secondary sm" data-home="add">${icon('add')}Add widget</button>
          <button type="button" class="btn tertiary sm" data-home="reset">Reset</button>
          <button type="button" class="btn secondary sm" data-home="cancel" title="Undo every change since Customize">Cancel</button>
          <button type="button" class="btn primary sm" data-home="done">${icon('check')}Done</button>`
      : html`<button type="button" class="btn tertiary sm" data-home="edit">${icon('tune')}Customize</button>`}
  </div>`;
}

/** On a phone a widget can only be moved (by its handle), edited, and hidden or shown there. */
function phoneToolbar(w: HomeWidget, def: WidgetDef, hidden: boolean): Html {
  return html`<div class="widget-bar">
    <span class="widget-grip" title="Drag to move">${icon('drag_indicator')}</span>
    <span class="widget-label label-12">${def.label}</span>
    ${def.editable ? html`<button type="button" class="btn tertiary sm icon-only" data-home="config" data-id="${w.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>` : ''}
    <button type="button" class="btn tertiary sm icon-only" data-home="phone-hide" data-id="${w.id}" title="${hidden ? 'Show on phones' : 'Hide on phones'}" aria-label="${hidden ? 'Show on phones' : 'Hide on phones'}">${icon(hidden ? 'visibility_off' : 'visibility')}</button>
  </div>`;
}

/** Shows or hides the widget's title (a Character card's basic information). */
function titleToggle(w: HomeWidget): Html {
  const shown = w.type === 'character' ? !w.hideBasic : !w.hideTitle;
  const what = w.type === 'character' ? 'basic information' : 'title';
  return html`<span class="toggle widget-sizes"><button type="button" data-home="title" data-id="${w.id}" aria-pressed="${String(shown)}" title="${shown ? 'Hide' : 'Show'} the ${what}">${w.type === 'character' ? 'Info' : 'Title'}</button></span>`;
}

function toolbar(w: HomeWidget, def: WidgetDef): Html {
  return html`<div class="widget-bar">
    <span class="widget-grip" title="Drag to move">${icon('drag_indicator')}</span>
    <span class="widget-label label-12">${def.label}</span>
    ${w.type === 'spacer'
      ? ''
      : html`${titleToggle(w)}
          <span class="toggle widget-sizes" role="group" aria-label="Width">
            ${SIZES.map(([n, label]) => html`<button type="button" data-home="size" data-id="${w.id}" data-value="${n}" aria-pressed="${String(w.size === n)}" title="Width ${label}">${label}</button>`)}
          </span>`}
    ${w.size < 12
      ? html`<span class="toggle widget-sizes widget-aligns" role="group" aria-label="Place in row">
          ${PLACES.map(([value, name, label]) => html`<button type="button" data-home="align" data-id="${w.id}" data-value="${value}" aria-pressed="${String(w.align === value)}" title="${label}" aria-label="${label}">${icon(name)}</button>`)}
        </span>`
      : ''}
    ${def.editable ? html`<button type="button" class="btn tertiary sm icon-only" data-home="config" data-id="${w.id}" title="Edit" aria-label="Edit">${icon('edit')}</button>` : ''}
    <button type="button" class="btn tertiary sm icon-only" data-home="remove" data-id="${w.id}" title="Remove" aria-label="Remove">${icon('close')}</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

const heading = (text: string, aside?: Html | string) =>
  html`<div class="section-head"><h2 class="heading-20">${text}</h2>${aside ? html`<span class="label-13 secondary">${aside}</span>` : ''}</div>`;

function pityWidget(a: Analysis): Html | null {
  const latest = (kind: Kind, category: string) => a.banners.find((b) => b.kind === kind && b.category === category && b.isLatest);
  const items: Html[] = [];
  const char = latest('char', 'chartered');
  if (char) {
    items.push(metric({ label: 'Chartered 6★ pity', value: html`${char.pity.value}<span class="metric-of">/${char.pity.max}</span>`, progress: char.pity.value / char.pity.max, sub: char.name }));
    if (char.guarantee && !char.guarantee.done)
      items.push(metric({ label: 'Rate-up guarantee', value: html`${char.guarantee.value}<span class="metric-of">/${char.guarantee.max}</span>`, progress: char.guarantee.value / char.guarantee.max, sub: char.name }));
  }
  const weap = latest('weap', 'limited');
  if (weap) items.push(metric({ label: 'Arsenal pity (sets)', value: html`${weap.pity.value}<span class="metric-of">/${weap.pity.max}</span>`, progress: weap.pity.value / weap.pity.max, sub: weap.name }));
  const basic = latest('char', 'basic');
  if (basic) items.push(metric({ label: 'Basic 6★ pity', value: html`${basic.pity.value}<span class="metric-of">/${basic.pity.max}</span>`, progress: basic.pity.value / basic.pity.max }));
  return items.length ? html`${heading('Pity')}${metrics(items)}` : null;
}

function latestWidget(a: Analysis): Html | null {
  const pulls = a.banners
    .flatMap((b) => b.pulls.map((p) => ({ p, banner: b.name })))
    .filter(({ p }) => p.rarity >= 5)
    .sort((x, y) => y.p.ts - x.p.ts)
    .slice(0, 10);
  if (!pulls.length) return null;
  return html`${heading('Latest pulls', '5★ and up')}
    <div class="card widget-list">
      ${pulls.map(
        ({ p, banner }) => html`<a class="widget-row" href="${infoHref(p.kind, p.itemId)}">
          ${itemImg(p.kind, p.itemId)}
          <span class="min0"><span class="widget-row-name r${p.rarity} ellipsis">${p.name}</span><span class="label-12 secondary ellipsis">${banner}</span></span>
          <span class="label-12 tertiary">${fmtDate(p.ts)}</span>
        </a>`,
      )}
    </div>`;
}

function statsWidget(a: Analysis, redraw: () => void): Html {
  const per = earnedPerWeek(a, redraw);
  return html`${heading('Stats')}
    ${metrics([
      metric({ label: 'Operator pulls', value: fmtInt(a.char.pulls), sub: `${a.char.sixStars} × 6★` }),
      metric({ label: 'Arsenal pulls', value: fmtInt(a.weap.pulls), sub: `${a.weap.sixStars} × 6★` }),
      metric({ label: 'Chartered permits earned', value: per.char, sub: 'per week' }),
      metric({ label: 'Arsenal Issues earned', value: per.issues, sub: 'per week' }),
    ])}`;
}

function progressWidget(c: Ctx): Html {
  const ops = wikiFile<WikiOperatorFile>('operators.json', c.redraw).data;
  const weps = wikiFile<WikiWeaponFile>('weapons.json', c.redraw).data;
  const extras = extrasOf(state.settings);
  const owned = (kind: Kind, ids: string[] | null) => {
    if (!ids) return null;
    const mine = ownedItems(c.a, kind, extras);
    return [ids.filter((id) => mine.get(id)?.copies).length, ids.length] as const;
  };
  const p = archiveProgress(c.redraw);
  const essences = Object.values(state.settings.essences ?? {}).reduce((n, x) => n + x, 0);
  const row = (label: string, href: string, v: readonly [number, number] | null) =>
    metric({ label, value: v ? html`${fmtInt(v[0])}<span class="metric-of">/${fmtInt(v[1])}</span>` : '…', progress: v && v[1] ? v[0] / v[1] : undefined, aside: html`<a class="label-12" href="${href}">Open</a>` });
  return html`${heading('Collection')}
    ${metrics([
      row('Operators', infoHref('char'), owned('char', ops ? Object.keys(ops.operators) : null)),
      row('Arsenals', infoHref('weap'), owned('weap', weps ? Object.keys(weps.weapons) : null)),
      row('Achievements', '/achievements', p.medals),
      row('Archive', '/archives', p.archive),
      metric({ label: 'Essences', value: fmtInt(essences), aside: html`<a class="label-12" href="/essences">Open</a>` }),
    ])}`;
}

function noteWidget(w: HomeWidget): Html {
  const text = w.text?.trim();
  return html`<div class="card widget-card widget-note">
    ${w.title ? html`<h2 class="heading-16">${w.title}</h2>` : ''}
    ${text ? text.split(/\n{2,}/).map((p) => html`<p class="copy-14">${p.split('\n').flatMap((l, i) => (i ? [html`<br />`, l] : [l]))}</p>`) : html`<p class="copy-14 secondary">Empty note. Customize → the pencil to write it.</p>`}
  </div>`;
}

function characterWidget(w: HomeWidget, c: Ctx): Html {
  const ops = wikiFile<WikiOperatorFile>('operators.json', c.redraw).data;
  if (!w.op) return html`<div class="card widget-card widget-empty"><p class="copy-14 secondary">Pick an operator: Customize → the pencil.</p></div>`;
  const o = ops?.operators[w.op];
  const name = o?.name ?? '…';
  const full = w.pic === 'full' ? fullArtOf(w.op) : null;
  const art = w.pic && !full ? artOf(w.op, c.redraw).find((x) => x.id === w.pic) : undefined;
  const mine = c.a ? ownedItems(c.a, 'char', extrasOf(state.settings)).get(w.op) : undefined;
  const facts = w.facts ?? ['potential', 'first'];
  const chips: Html[] = [];
  // Potential sits beside the name.
  const potential = facts.includes('potential') && mine?.copies ? badge(`P${Math.max(mine.potential, 0)}`, 'purple') : '';
  if (facts.includes('first') && mine?.acquisitions[0]) chips.push(html`<span class="char-fact">Since <b>${fmtDate(mine.acquisitions[0].ts)}</b></span>`);
  if (facts.includes('spent') && c.a) {
    const spent = c.a.banners.filter((b) => b.kind === 'char' && b.info?.rateUpIds.includes(w.op!)).reduce((n, b) => n + b.paidPulls, 0);
    chips.push(html`<span class="char-fact"><b>${fmtInt(spent)}</b> pulls on their banners</span>`);
  }
  // As many stats as the card's width has room for.
  const stats = facts.includes('stats') ? cardStats(w.op, c.a, c.redraw, w.size <= 4 ? 6 : w.size <= 6 ? 8 : 12) : null;
  const gear = facts.includes('gear') ? loadoutStrip(w.op, c.redraw, !facts.includes('weaponDetail')) : null;
  const weapon = facts.includes('weaponDetail') ? weaponDetail(w.op, c.a, c.redraw) : null;
  const style = w.artStyle ?? (full || art ? 'banner' : 'avatar');
  const src = full ?? art?.src;
  const picture = html`<span class="char-card-art">${src ? html`<img src="${src}" alt="" decoding="async" />` : itemImg('char', w.op, 'char-card-portrait')}</span>`;
  // Ambient: with a picture, glows of the colours along its edges, each from its side (as
  // YouTube's ambient mode does, tint.ts tintAmbients); else a glow of the portrait's colour. Inside the card
  // while it has its outline, past it without.
  // Around the card: the card solid inside, the glow outside it sampled from the whole card's
  // border, piece by piece (tint.ts paintCardAmbients): the picture where it reaches the edge,
  // the card's dark elsewhere.
  const around = w.ambient === 'card';
  const glow = !w.ambient
    ? ''
    : around
      ? html`<span class="char-ambient-card" data-card-ambient="${src ?? ''}" aria-hidden="true"></span>`
      : src && style === 'background'
        ? // The picture is the whole card: sample the card's border as it shows (vignette and all).
          html`<span class="char-ambient-card" data-card-ambient="${src}" aria-hidden="true"></span>`
        : src
        ? html`<span class="char-ambient ${style}" data-ambient-src="${src}" aria-hidden="true"></span>`
        : heroGlow('char', w.op);
  // Outside the card: without its outline, around it, or round a background picture (it would cover a glow inside).
  const outside = w.bare || around || (!!src && style === 'background');
  // Basic information: the title, name (with Potential), rarity and class, and the note.
  const basic = !w.hideBasic;
  const pictureOnly = !basic && !chips.length && !stats?.length && !weapon && !gear;
  return html`<div class="char-card-wrap${w.bare ? ' bare' : ''}${around ? ' around' : ''}${w.shadow && !w.ambient ? ' shadowed' : ''}">
    ${outside ? glow : ''}
    <a class="card char-card style-${style}${pictureOnly ? ' picture-only' : ''}" href="${infoHref('char', w.op)}" title="${basic ? '' : name}">
      ${outside ? '' : glow}
      ${style === 'avatar' && basic ? '' : picture}
      ${pictureOnly
        ? ''
        : html`<span class="char-card-text min0">
        ${basic
          ? html`<span class="char-card-head">
              ${style === 'avatar' ? picture : ''}
              <span class="char-card-names min0">
                ${w.title ? html`<span class="label-12 secondary char-card-title">${w.title}</span>` : ''}
                <span class="heading-20 char-card-name">${name}${potential ? html` ${potential}` : ''}</span>
                ${o ? html`<span class="label-12 secondary">${'★'.repeat(o.rarity)} · ${[o.class, o.element].filter(Boolean).join(' · ')}</span>` : ''}
              </span>
            </span>`
          : ''}
        ${basic && w.note ? html`<span class="copy-14 char-card-note">${w.note}</span>` : ''}
        ${chips.length ? html`<span class="char-facts">${chips}</span>` : ''}
        ${stats?.length ? html`<span class="char-stats">${stats.map(([k, v]) => html`<span><span class="label-12 secondary">${k}</span><b class="num">${v}</b></span>`)}</span>` : ''}
        ${weapon ? html`<span class="char-section">${weapon}</span>` : ''}
        ${gear ? html`<span class="char-section">${gear}</span>` : ''}
      </span>`}
    </a>
  </div>`;
}

// ---------------------------------------------------------------------------
// Editing: buttons, dialogs, drag and drop
// ---------------------------------------------------------------------------

function update(id: string, patch: Partial<HomeWidget>): void {
  save(layout().map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

/** A dialog over the page; `body` re-renders on `refresh`; submitting it calls `onSubmit`, then closes it. */
function dialog(title: string, body: (refresh: () => void, close: () => void) => Html, onSubmit?: (form: HTMLFormElement) => void): void {
  document.querySelector('.home-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  const close = () => backdrop.remove();
  const draw = () =>
    render(
      backdrop,
      html`<form class="card dialog home-dialog" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="home-dialog-head"><h2 class="heading-20">${title}</h2><button type="button" class="btn tertiary sm icon-only" data-close aria-label="Close">${icon('close')}</button></div>
        ${body(draw, close)}
      </form>`,
    );
  draw();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  backdrop.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit?.(e.target as HTMLFormElement);
    close();
  });
  document.body.append(backdrop);
}

function addDialog(): void {
  dialog('Add a widget', (_, close) => {
    const picked = (type: string) => () => {
      const w: HomeWidget = { id: newId(type), type, size: WIDGETS[type].size };
      save([...layout(), w]);
      close();
      if (WIDGETS[type].editable) configDialog(w.id);
    };
    queueMicrotask(() =>
      document.querySelectorAll<HTMLButtonElement>('.home-dialog [data-add]').forEach((b) => (b.onclick = picked(b.dataset.add!))),
    );
    return html`<div class="widget-picker">
      ${Object.entries(WIDGETS).map(
        ([type, d]) => html`<button type="button" class="widget-pick" data-add="${type}"><b>${d.label}</b><span class="copy-13 secondary">${d.about}</span></button>`,
      )}
    </div>`;
  });
}

function configDialog(id: string): void {
  const w = layout().find((x) => x.id === id);
  if (!w) return;
  if (w.type === 'banners') {
    // How many of each kind: all, the newest few, or none.
    const counts: [string, string][] = [['', 'All'], ['1', 'Newest'], ['2', 'Newest 2'], ['3', 'Newest 3'], ['0', 'None']];
    const pick = (name: string, label: string, value: number | undefined) =>
      html`<label class="field"><span class="label-13">${label}</span>
        <select class="input" name="${name}">${counts.map(([v, text]) => html`<option value="${v}" ${raw(String(value ?? '') === v ? 'selected' : '')}>${text}</option>`)}</select>
      </label>`;
    const num = (f: HTMLFormElement, name: string) => {
      const v = (f.elements.namedItem(name) as HTMLSelectElement).value;
      return v === '' ? undefined : Number(v);
    };
    dialog(
      'Current Banners',
      () => html`${pick('char', 'Headhunting banners', w.char)}${pick('weap', 'Arsenal Issues', w.weap)}
        <label class="char-fact-pick"><input type="checkbox" class="check" name="reruns" ${raw(w.reruns !== false ? 'checked' : '')} />Re-runs (RE-Factor banners)</label>
        <div class="dialog-actions"><button type="button" class="btn secondary sm" data-close>Cancel</button><button class="btn primary sm">Save</button></div>`,
      (f) => update(id, { char: num(f, 'char'), weap: num(f, 'weap'), reruns: (f.elements.namedItem('reruns') as HTMLInputElement).checked ? undefined : false }),
    );
    return;
  }
  if (w.type === 'note') {
    dialog(
      'Note',
      () => html`<label class="field"><span class="label-13">Title</span><input class="input" name="title" value="${w.title ?? ''}" /></label>
        <label class="field"><span class="label-13">Text</span><textarea class="input" name="text" rows="6">${w.text ?? ''}</textarea></label>
        <div class="dialog-actions"><button type="button" class="btn secondary sm" data-close>Cancel</button><button class="btn primary sm">Save</button></div>`,
      (f) => update(id, { title: (f.elements.namedItem('title') as HTMLInputElement).value.trim() || undefined, text: (f.elements.namedItem('text') as HTMLTextAreaElement).value }),
    );
    return;
  }
  // Character card: the operator, its picture, a title and note, and which facts show.
  const draft: HomeWidget = { ...w, facts: w.facts ?? ['potential', 'first'] };
  dialog(
    'Character card',
    (refresh) => {
      const ops = wikiFile<WikiOperatorFile>('operators.json', refresh).data;
      const mine = ownedItems(state.analysis, 'char', extrasOf(state.settings));
      const list = Object.entries(ops?.operators ?? {}).sort(
        ([ia, x], [ib, y]) => Number(!!mine.get(ib)?.copies) - Number(!!mine.get(ia)?.copies) || y.rarity - x.rarity || x.name.localeCompare(y.name),
      );
      const art = draft.op ? artOf(draft.op, refresh) : [];
      queueMicrotask(() => {
        const form = document.querySelector<HTMLFormElement>('.home-dialog');
        if (!form) return;
        form.querySelector<HTMLSelectElement>('[name=op]')!.onchange = (e) => {
          draft.op = (e.target as HTMLSelectElement).value || undefined;
          draft.pic = undefined;
          keep(form);
          refresh();
        };
        form.querySelectorAll<HTMLInputElement>('[name=pic]').forEach((r) => (r.onchange = () => (draft.pic = r.value || undefined)));
        // A drop shadow only without an ambient glow.
        const shadow = form.querySelector<HTMLInputElement>('[name=shadow]')!;
        form.querySelector<HTMLSelectElement>('[name=ambient]')!.onchange = (e) => {
          shadow.disabled = !!(e.target as HTMLSelectElement).value;
          if (shadow.disabled) shadow.checked = false;
        };
        form.querySelector<HTMLButtonElement>('[data-art]')?.addEventListener('click', () => {
          keep(form);
          openArtManager(draft.op!, ops?.operators[draft.op!]?.name ?? '', refresh);
        });
      });
      return html`<label class="field"><span class="label-13">Operator</span>
          <select class="input" name="op">
            <option value="">Pick one…</option>
            ${list.map(([id, o]) => html`<option value="${id}" ${raw(id === draft.op ? 'selected' : '')}>${o.name}${mine.get(id)?.copies ? '' : ' (not owned)'}</option>`)}
          </select>
        </label>
        ${draft.op
          ? html`<div class="field"><span class="label-13">Picture</span>
              <div class="char-pics">
                <label class="char-pic" title="Portrait"><input type="radio" name="pic" value="" ${raw(!draft.pic ? 'checked' : '')} />${itemImg('char', draft.op, 'char-pic-img')}</label>
                ${fullArtOf(draft.op) ? html`<label class="char-pic" title="Full art"><input type="radio" name="pic" value="full" ${raw(draft.pic === 'full' ? 'checked' : '')} /><img class="char-pic-img wide" src="${fullArtOf(draft.op)}" alt="" /></label>` : ''}
                ${art.map((x) => html`<label class="char-pic"><input type="radio" name="pic" value="${x.id}" ${raw(draft.pic === x.id ? 'checked' : '')} /><img class="char-pic-img" src="${x.src}" alt="" /></label>`)}
                <button type="button" class="btn secondary sm" data-art>${icon('add')}Add pictures</button>
              </div>
            </div>`
          : ''}
        <label class="field"><span class="label-13">Show the picture as</span>
          <select class="input" name="artStyle">
            ${(
              [
                ['avatar', 'Profile picture'],
                ['banner', 'Banner'],
                ['background', 'Background'],
              ] as const
            ).map(([v, t]) => html`<option value="${v}" ${raw((draft.artStyle ?? (draft.pic ? 'banner' : 'avatar')) === v ? 'selected' : '')}>${t}</option>`)}
          </select>
        </label>
        <label class="field"><span class="label-13">Ambient glow</span>
          <select class="input" name="ambient">
            ${(
              [
                ['', 'Off'],
                ['picture', 'From the picture'],
                ['card', 'Around the card'],
              ] as const
            ).map(([v, t]) => html`<option value="${v}" ${raw((draft.ambient === true ? 'picture' : (draft.ambient || '')) === v ? 'selected' : '')}>${t}</option>`)}
          </select>
        </label>
        <fieldset class="field char-fact-picks"><span class="label-13">Look</span>
          <label class="char-fact-pick"><input type="checkbox" class="check" name="bare" ${raw(draft.bare ? 'checked' : '')} />No outline</label>
          <label class="char-fact-pick" title="Not with an ambient glow"><input type="checkbox" class="check" name="shadow" ${raw(draft.shadow && !draft.ambient ? 'checked' : '')} ${raw(draft.ambient ? 'disabled' : '')} />Drop shadow</label>
        </fieldset>
        <label class="field"><span class="label-13">Title</span><input class="input" name="title" placeholder="Main DPS, Favourite..." value="${draft.title ?? ''}" /></label>
        <label class="field"><span class="label-13">Note</span><textarea class="input" name="note" rows="3">${draft.note ?? ''}</textarea></label>
        <fieldset class="field char-fact-picks"><span class="label-13">Show</span>
          <label class="char-fact-pick"><input type="checkbox" class="check" name="basic" ${raw(draft.hideBasic ? '' : 'checked')} />Basic information</label>
          ${FACTS.map(([k, label]) => html`<label class="char-fact-pick"><input type="checkbox" class="check" name="facts" value="${k}" ${raw(draft.facts!.includes(k) ? 'checked' : '')} />${label}</label>`)}
        </fieldset>
        <div class="dialog-actions"><button type="button" class="btn secondary sm" data-close>Cancel</button><button class="btn primary sm">Save</button></div>`;
    },
    (f) => {
      keep(f);
      update(id, { op: draft.op, pic: draft.pic, title: draft.title, note: draft.note, facts: draft.facts, ambient: draft.ambient, bare: draft.bare, shadow: draft.ambient ? undefined : draft.shadow, hideBasic: draft.hideBasic, artStyle: draft.artStyle });
    },
  );
  /** What's typed so far, so a re-render (new operator, new pictures) keeps it. */
  function keep(f: HTMLFormElement) {
    draft.title = (f.elements.namedItem('title') as HTMLInputElement).value.trim() || undefined;
    draft.note = (f.elements.namedItem('note') as HTMLTextAreaElement).value.trim() || undefined;
    draft.facts = [...f.querySelectorAll<HTMLInputElement>('[name=facts]:checked')].map((x) => x.value);
    draft.ambient = ((f.elements.namedItem('ambient') as HTMLSelectElement).value || undefined) as HomeWidget['ambient'];
    draft.bare = (f.elements.namedItem('bare') as HTMLInputElement).checked || undefined;
    draft.shadow = (f.elements.namedItem('shadow') as HTMLInputElement).checked || undefined;
    draft.hideBasic = !(f.elements.namedItem('basic') as HTMLInputElement).checked || undefined;
    draft.artStyle = ((f.elements.namedItem('artStyle') as HTMLSelectElement | null)?.value as HomeWidget['artStyle']) || draft.artStyle;
  }
}

/** Clicks on Home's edit controls, and dragging widgets to reorder them. Installed once (app.ts). */
export function installHomeWidgets(): void {
  addEventListener('resize', fitBannerCards);
  // Crossing into or out of phone width switches between the two layouts.
  matchMedia(PHONE).addEventListener('change', () => redrawNow());
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-home]');
    if (!el) return;
    const id = el.dataset.id ?? '';
    switch (el.dataset.home) {
      case 'edit':
        editing = true;
        before = state.settings.home && structuredClone(state.settings.home);
        beforePhone = state.settings.homePhone && structuredClone(state.settings.homePhone);
        return redrawNow();
      case 'done':
        editing = false;
        return redrawNow();
      case 'cancel':
        editing = false;
        if (JSON.stringify([state.settings.home, state.settings.homePhone]) !== JSON.stringify([before, beforePhone])) updateSettings({ home: before, homePhone: beforePhone });
        else redrawNow();
        return;
      case 'phone-hide': {
        const { list, hidden } = phoneLayout();
        if (hidden.has(id)) hidden.delete(id);
        else hidden.add(id);
        return savePhone(list.map((w) => w.id), hidden);
      }
      case 'reset':
        // On a phone: the phone's order and hidden widgets only.
        if (isPhone())
          return dialog(
            'Reset Home on phones?',
            () => html`<p class="copy-14">Phones go back to the order of the wide layout, with every widget shown.</p>
              <div class="dialog-actions"><button type="button" class="btn secondary sm" data-close>Cancel</button><button class="btn error sm">Reset</button></div>`,
            () => updateSettings({ homePhone: undefined }),
          );
        return dialog(
          'Reset Home?',
          () => html`<p class="copy-14">Home goes back to the schedule, and your widgets are removed.</p>
            <div class="dialog-actions"><button type="button" class="btn secondary sm" data-close>Cancel</button><button class="btn error sm">Reset</button></div>`,
          () => updateSettings({ home: undefined }),
        );
      case 'add':
        return addDialog();
      case 'align': {
        const align = el.dataset.value as 'left' | 'center' | 'right';
        const list = separate(id, { align, col: undefined }, (head) => head.align === align && !head.col);
        return list && save(list);
      }
      case 'size': {
        const size = Number(el.dataset.value) as WidgetSize;
        const list = separate(id, { size }, (head) => head.size === size);
        return list && save(list);
      }
      case 'title': {
        const w = layout().find((x) => x.id === id);
        if (!w) return;
        return w.type === 'character' ? update(id, { hideBasic: !w.hideBasic || undefined }) : update(id, { hideTitle: !w.hideTitle || undefined });
      }
      case 'config':
        return configDialog(id);
      case 'remove': {
        const list = layout();
        detach(list, list.findIndex((w) => w.id === id));
        return save(list);
      }
    }
  });

  // Dragging a widget to move it, with pointer events so it works with a finger too: by its
  // handle on a touch screen (elsewhere the page scrolls), from anywhere on it with a mouse.
  let dragged: HTMLElement | null = null;
  type Where = 'before' | 'after' | 'above' | 'below';
  let target: { el: HTMLElement; where: Where } | null = null;
  let room: Room | null = null;
  const DROPS = ['drop-before', 'drop-after', 'drop-above', 'drop-below'];
  const clear = () => {
    document.querySelectorAll(DROPS.map((x) => `.widget.${x}`).join()).forEach((x) => x.classList.remove(...DROPS));
    document.querySelector('.drop-ghost')?.remove();
  };
  /**
   * The widget under a point and where the dragged one goes: full width, before
   * or after it by its half; narrower, stacked above or below it in its column
   * near its top or bottom, else beside its column by its left or right half.
   */
  const over = (x: number, y: number): { el: HTMLElement; where: Where } | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.home-grid.editing .widget');
    if (!el || el === dragged) return null;
    const r = el.getBoundingClientRect();
    if (el.dataset.size === '12' || dragged?.dataset.type === 'spacer' || isPhone()) return { el, where: y > r.top + r.height / 2 ? 'after' : 'before' };
    const edge = Math.min(120, r.height * 0.3);
    if (y < r.top + edge) return { el, where: 'above' };
    if (y > r.bottom - edge) return { el, where: 'below' };
    return { el, where: x > r.left + r.width / 2 ? 'after' : 'before' };
  };
  // An empty space's bottom edge: drag up or down for its height.
  let sizing: { id: string; space: HTMLElement; y: number; h: number } | null = null;
  document.addEventListener(
    'pointerdown',
    (e) => {
      const edge = (e.target as HTMLElement).closest<HTMLElement>('.home-grid.editing .spacer-edge');
      if (!edge || e.button !== 0) return;
      const el = edge.closest<HTMLElement>('.widget')!;
      const space = el.querySelector<HTMLElement>('.widget-spacer')!;
      e.preventDefault();
      e.stopPropagation();
      sizing = { id: el.dataset.widget!, space, y: e.clientY, h: space.getBoundingClientRect().height };
    },
    true,
  );
  const heightOf = (e: PointerEvent) => (sizing ? Math.max(SPACER_MIN, Math.round(sizing.h + e.clientY - sizing.y)) : 0);
  document.addEventListener('pointermove', (e) => {
    if (sizing) sizing.space.style.height = `${heightOf(e)}px`;
  });
  document.addEventListener('pointerup', (e) => {
    if (!sizing) return;
    const id = sizing.id;
    const height = heightOf(e);
    sizing = null;
    update(id, { height });
  });

  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.home-grid.editing .widget');
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('.widget-grip')) return;
    e.preventDefault();
    dragged = el;
    el.classList.add('dragging');
  });
  document.addEventListener('pointermove', (e) => {
    if (!dragged) return;
    clear();
    target = over(e.clientX, e.clientY);
    target?.el.classList.add(`drop-${target.where}`);
    // Not over a widget: empty room in a row, outlined where the widget would land.
    room = target ? null : roomAt(e.clientX, e.clientY, dragged);
    if (room) {
      const ghost = document.createElement('div');
      ghost.className = 'drop-ghost';
      Object.assign(ghost.style, { left: `${room.box.left}px`, top: `${room.box.top}px`, width: `${room.box.width}px`, height: `${room.box.height}px` });
      room.grid.append(ghost);
    }
    // Near the screen's top or bottom edge, scroll to reach widgets out of view.
    if (e.clientY < 60) scrollBy(0, -12);
    else if (e.clientY > innerHeight - 60) scrollBy(0, 12);
  });
  const end = () => {
    if (!dragged) return;
    const id = dragged.dataset.widget;
    dragged.classList.remove('dragging');
    clear();
    const t = target;
    const r = room;
    dragged = null;
    target = null;
    room = null;
    if (r) {
      // Into empty room: at that column, as wide as fits (never wider than it was), after that row's widgets.
      const list = layout();
      const w = detach(list, list.findIndex((x) => x.id === id));
      const at = r.after ? list.findIndex((x) => x.id === r.after) : list.length - 1;
      list.splice(at + 1, 0, { ...w, under: undefined, align: undefined, newRow: r.newRow || undefined, col: r.start, size: r.size });
      return save(list);
    }
    if (!t) return;
    if (isPhone()) {
      // A phone only reorders its own list.
      const { list, hidden } = phoneLayout();
      const order = list.map((w) => w.id).filter((x) => x !== id);
      order.splice(order.indexOf(t.el.dataset.widget!) + (t.where === 'after' ? 1 : 0), 0, id!);
      return savePhone(order, hidden);
    }
    const list = layout();
    const w = detach(list, list.findIndex((x) => x.id === id));
    const at = list.findIndex((x) => x.id === t.el.dataset.widget);
    // The target's column: its top widget and its last.
    let top = at;
    while (top > 0 && list[top].under) top--;
    let last = at;
    while (list[last + 1]?.under) last++;
    const size = list[top].size;
    const moved = { ...w, newRow: undefined };
    if (t.where === 'below') list.splice(at + 1, 0, { ...moved, under: true, size });
    else if (t.where === 'above') {
      const head = at === top;
      if (head) list[at] = { ...list[at], under: true };
      list.splice(at, 0, { ...moved, under: head ? undefined : true, size, align: head ? list[at].align : w.align, newRow: head ? list[at].newRow : undefined });
    } else list.splice(t.where === 'before' ? top : last + 1, 0, { ...moved, under: undefined, col: undefined });
    save(list);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => {
    target = null;
    end();
  });
}

/**
 * A Character card keeps its height when switched between Banner and
 * Background: each banner card is measured as a Background (its text over the
 * picture, in 60% of the width), and its banner made as tall as that leaves.
 * After each render (app.ts) and on resize.
 */
export function fitBannerCards(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.char-card.style-banner')) {
    const art = card.querySelector<HTMLElement>('.char-card-art');
    if (!art) continue;
    art.style.height = '';
    art.style.aspectRatio = '';
    card.classList.replace('style-banner', 'style-background');
    const target = card.offsetHeight;
    card.classList.replace('style-background', 'style-banner');
    const height = Math.max(80, art.offsetHeight + target - card.offsetHeight);
    art.style.aspectRatio = 'auto';
    art.style.height = `${height}px`;
    const glow = card.closest('.char-card-wrap')?.querySelector<HTMLElement>('.char-ambient.banner');
    if (glow) {
      glow.style.aspectRatio = 'auto';
      glow.style.height = `${height}px`;
    }
  }
}
