import type { Owned } from '../../domain/owned';
import type { Kind } from '../../domain/types';
import { state, updateSettings } from '../../state';
import { html, render, type Html } from '../html';

/**
 * Ranked sorting for the operator and weapon lists: every sort key in a
 * priority order the player sets in the sort pop-up (drag to reorder, or
 * into Disabled to stop using one), each with its own direction. Ties on
 * one key fall to the next. Saved in settings.
 */

export type SortKey = 'rarity' | 'name' | 'acquired' | 'potential' | 'element' | 'weapon' | 'class';
export interface SortSpec {
  key: SortKey;
  desc: boolean;
  /** Turned off: kept in the bar, but not sorted by. */
  off?: boolean;
}

const LABEL: Record<SortKey, string> = {
  rarity: 'Rarity',
  name: 'A–Z',
  acquired: 'Last acquired',
  potential: 'Potential',
  element: 'Element',
  weapon: 'Weapon',
  class: 'Class',
};

/** The keys each list offers, in their default order (rarity first, then name). */
const KEYS: Record<Kind, SortKey[]> = {
  char: ['rarity', 'name', 'acquired', 'potential', 'element', 'weapon', 'class'],
  weap: ['rarity', 'name', 'acquired', 'potential'],
};
/** Which way each key goes until flipped: highest, newest and best first; names A to Z. */
const DEFAULT_DESC: Record<SortKey, boolean> = { rarity: true, name: false, acquired: true, potential: true, element: false, weapon: false, class: false };

/** The list's sort order: the player's, with any keys it lacks added at the end. */
export function sortSpecs(kind: Kind): SortSpec[] {
  const saved = (state.settings.infoSort?.[kind] ?? []).filter((s) => KEYS[kind].includes(s.key));
  const missing = KEYS[kind].filter((k) => !saved.some((s) => s.key === k)).map((key) => ({ key, desc: DEFAULT_DESC[key] }));
  return [...saved, ...missing];
}

const isDefault = (kind: Kind, specs: SortSpec[]) => specs.every((s, i) => s.key === KEYS[kind][i] && s.desc === DEFAULT_DESC[s.key] && !s.off);

function save(kind: Kind, specs: SortSpec[] | null): void {
  const all = { ...state.settings.infoSort };
  if (specs && !isDefault(kind, specs)) all[kind] = specs;
  else delete all[kind];
  updateSettings({ infoSort: all });
}

/**
 * The sort changes: flip a key's direction (`sort-dir`), turn it off or on
 * (`sort-toggle`), put the keys in a new order (`sort-order`, `key` = keys
 * comma-separated, from a drag), make one first (`sort-front`), or go back
 * to the default (`sort-reset`).
 */
export function sortAction(action: string, kind: Kind, key?: string): void {
  const specs = sortSpecs(kind);
  if (action === 'sort-reset') return save(kind, null);
  if (action === 'sort-order') {
    const order = (key ?? '').split(',');
    return save(kind, [...specs].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
  }
  const i = specs.findIndex((s) => s.key === key);
  if (i < 0) return;
  if (action === 'sort-front') save(kind, [specs[i], ...specs.filter((_, j) => j !== i)]);
  if (action === 'sort-dir') save(kind, specs.map((s, j) => (j === i ? { ...s, desc: !s.desc } : s)));
  if (action === 'sort-toggle') save(kind, specs.map((s, j) => (j === i ? { ...s, off: !s.off || undefined } : s)));
}

/** "Rarity ↓, A–Z ↑" for the sort button: the first two sorts in use. */
function summary(kind: Kind): string {
  const on = sortSpecs(kind).filter((s) => !s.off);
  if (!on.length) return 'Off';
  return on
    .slice(0, 2)
    .map((s) => `${LABEL[s.key]} ${s.desc ? '↓' : '↑'}`)
    .join(', ') + (on.length > 2 ? ' …' : '');
}

/** The list's sort button; it opens the sort pop-up (openSortPopup). */
export function sortBar(kind: Kind): Html {
  return html`<button type="button" class="btn secondary sm sort-open" data-action="sort-open" data-kind="${kind}" aria-haspopup="dialog" title="Change how this list is sorted">
    <span class="icon">sort</span>Sort<span class="sort-summary">${summary(kind)}</span>
  </button>`;
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/**
 * The sort pop-up: the sorts in use, in order, and a Disabled section. Drag
 * a row (by mouse or touch) to reorder it or to move it between the two;
 * its arrow flips its direction. Arrow keys move a focused row, and its
 * Disable/Enable button moves it across. Every change applies at once.
 */
export function openSortPopup(kind: Kind, anchor: HTMLElement): void {
  document.querySelector('.sort-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'card sort-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Sort');
  document.body.append(pop);

  const row = (s: SortSpec, rank: number) => html`<li class="sort-row${s.off ? ' off' : ''}" data-sort-key="${s.key}">
    <span class="icon sort-grip" aria-hidden="true">drag_indicator</span>
    <button type="button" class="sort-name" aria-label="${LABEL[s.key]}, ${s.off ? 'disabled' : `sorted ${ordinal(rank)}`}. Arrow keys move it">
      ${s.off ? '' : html`<span class="sort-rank">${rank}</span>`}${LABEL[s.key]}
    </button>
    ${s.off
      ? ''
      : html`<button type="button" class="sort-dir" data-sort-dir aria-label="${s.desc ? 'Descending' : 'Ascending'}. Flip">${s.desc ? 'High to low ↓' : 'Low to high ↑'}</button>`}
    <button type="button" class="sort-move" data-sort-move title="${s.off ? 'Sort by this again' : 'Stop sorting by this'}">${s.off ? 'Enable' : 'Disable'}</button>
  </li>`;

  const paint = () => {
    const specs = sortSpecs(kind);
    const on = specs.filter((s) => !s.off);
    const off = specs.filter((s) => s.off);
    render(
      pop,
      html`<div class="sort-pop-head">
          <h2 class="heading-16">Sort</h2>
          <button type="button" class="btn tertiary sm" data-sort-reset>Reset</button>
        </div>
        <p class="copy-13 secondary">Drag to reorder: the first sort decides, the next ones break ties. Drag a sort into Disabled to stop using it.</p>
        <ol class="sort-list" data-zone="on">${on.map((s, i) => row(s, i + 1))}${on.length ? '' : html`<li class="sort-empty">Drag a sort here</li>`}</ol>
        <div class="sort-zone-label label-12">Disabled</div>
        <ul class="sort-list" data-zone="off">${off.map((s) => row(s, 0))}${off.length ? '' : html`<li class="sort-empty">Drag a sort here to disable it</li>`}</ul>`,
    );
  };

  /** Reads the rows' order and zones off the pop-up and saves it. */
  const commit = () => {
    const keys = (zone: string) => [...pop.querySelectorAll<HTMLElement>(`.sort-list[data-zone="${zone}"] .sort-row`)].map((r) => r.dataset.sortKey as SortKey);
    const now = sortSpecs(kind);
    const spec = (k: SortKey, off: boolean): SortSpec => ({ ...now.find((s) => s.key === k)!, off: off || undefined });
    save(kind, [...keys('on').map((k) => spec(k, false)), ...keys('off').map((k) => spec(k, true))]);
    paint();
  };

  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const key = t.closest<HTMLElement>('.sort-row')?.dataset.sortKey;
    if (t.closest('[data-sort-reset]')) {
      save(kind, null);
      return paint();
    }
    if (key && t.closest('[data-sort-dir]')) {
      sortAction('sort-dir', kind, key);
      return paint();
    }
    if (key && t.closest('[data-sort-move]')) {
      sortAction('sort-toggle', kind, key);
      return paint();
    }
  });

  // Dragging a row: it follows the pointer between the other rows and into either list.
  let drag: { row: HTMLElement; x: number; y: number; moved: boolean } | null = null;
  pop.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const r = t.closest<HTMLElement>('.sort-row');
    if (!r || t.closest('[data-sort-dir], [data-sort-move]') || e.button !== 0) return;
    drag = { row: r, x: e.clientX, y: e.clientY, moved: false };
    r.setPointerCapture(e.pointerId);
  });
  pop.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    drag.moved = true;
    drag.row.classList.add('dragging');
    for (const list of pop.querySelectorAll<HTMLElement>('.sort-list')) {
      const box = list.getBoundingClientRect();
      if (e.clientY < box.top - 8 || e.clientY > box.bottom + 8 || e.clientX < box.left || e.clientX > box.right) continue;
      list.querySelector('.sort-empty')?.remove();
      const rows = [...list.querySelectorAll<HTMLElement>('.sort-row')].filter((x) => x !== drag!.row);
      const before = rows.find((x) => {
        const b = x.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
      });
      if (before) list.insertBefore(drag.row, before);
      else list.append(drag.row);
      drag.row.classList.toggle('off', list.dataset.zone === 'off');
      break;
    }
  });
  const end = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag.row.classList.remove('dragging');
    drag = null;
    if (moved) commit();
  };
  pop.addEventListener('pointerup', end);
  pop.addEventListener('pointercancel', end);

  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return close();
    const name = (e.target as HTMLElement).closest('.sort-name');
    if (!name || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const r = name.closest<HTMLElement>('.sort-row')!;
    const sib = e.key === 'ArrowUp' ? r.previousElementSibling : r.nextElementSibling;
    if (!sib?.classList.contains('sort-row')) return;
    r.parentElement!.insertBefore(r, e.key === 'ArrowUp' ? sib : sib.nextElementSibling);
    const k = r.dataset.sortKey;
    commit();
    pop.querySelector<HTMLElement>(`.sort-row[data-sort-key="${k}"] .sort-name`)?.focus();
  });

  const close = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
    anchor.focus();
  };
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  };
  document.addEventListener('pointerdown', outside, true);

  paint();
  // Under the button, kept on screen; full width on phones.
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(a.right - w, innerWidth - w - 8))}px`;
  pop.style.top = `${a.bottom + 6}px`;
  pop.querySelector<HTMLElement>('.sort-name')?.focus();
}

/** What a list item offers each key; null sorts last whichever way the key goes. */
export interface SortFacts {
  rarity: number;
  name: string;
  owned?: Owned;
  element?: string | null;
  weapon?: string | null;
  class?: string | null;
}

const lastAcquired = (o: Owned | undefined): number | null => {
  const dated = (o?.acquisitions ?? []).filter((a) => !a.extra && a.ts);
  // Extra copies have no date: owned that way, it still sorts after anything dated.
  return dated.length ? Math.max(...dated.map((a) => a.ts)) : o?.copies ? 0 : null;
};

function value(f: SortFacts, key: SortKey): number | string | null {
  switch (key) {
    case 'rarity':
      return f.rarity;
    case 'name':
      return f.name;
    case 'acquired':
      return lastAcquired(f.owned);
    case 'potential':
      return f.owned?.copies ? f.owned.potential : null;
    default:
      return f[key] ?? null;
  }
}

/** Sorts `items` by the list's order of keys. */
export function sortItems<T>(kind: Kind, items: T[], facts: (t: T) => SortFacts): T[] {
  const specs = sortSpecs(kind).filter((s) => !s.off);
  const withFacts = items.map((t) => ({ t, f: facts(t) }));
  return withFacts
    .sort((a, b) => {
      for (const s of specs) {
        const x = value(a.f, s.key);
        const y = value(b.f, s.key);
        if (x === y) continue;
        if (x == null) return 1;
        if (y == null) return -1;
        const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
        if (c) return s.desc ? -c : c;
      }
      return 0;
    })
    .map((x) => x.t);
}
