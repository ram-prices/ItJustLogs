import type { Kind } from '../../domain/types';
import { icon } from '../components';
import { html, type Html } from '../html';

/**
 * Type-to-search for the operator and weapon lists (and Achievements and
 * Archive: anything marked data-search-item inside a data-search-section,
 * besides .wiki-tile / .wiki-type): typing anywhere on the
 * page shows the search in big letters in the middle of the screen (fading
 * a second after the last key) and hides the tiles whose text (name,
 * rarity, class, element, type...) doesn't contain every word typed.
 * Backspace edits it, Escape clears it. There's no search box: the text
 * lives in a hidden input (so IMEs and Backspace work as usual); filtering
 * happens in place (no redraw), and draw() calls applyListSearch so a
 * redraw keeps it.
 */

const queries: Record<string, string> = {};

/** Lowercase, without accents, so "lifeng" finds "Lifeng" and "eclair" finds "Éclair". */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const LABEL: Record<string, string> = { char: 'Search operators', weap: 'Search weapons' };

/** The hidden input that holds a list's search (typing on the page goes into it); `key` keeps each list's own. */
export function searchBox(key: Kind | string, label = LABEL[key] ?? 'Search'): Html {
  return html`<input class="list-search-input" type="search" data-list-search="${key}" value="${queries[key] ?? ''}" aria-label="${label}: start typing" autocomplete="off" spellcheck="false" tabindex="-1" />`;
}

/**
 * A search field you can see and tap (phones have no keyboard to type
 * anywhere with), filtering the same way; typing anywhere still lands in it.
 */
export function searchField(key: string, placeholder: string): Html {
  return html`<label class="picker-search list-search-field">${icon('search')}<input type="search" data-list-search="${key}" data-shown value="${queries[key] ?? ''}" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off" spellcheck="false" /></label>`;
}

/** Shows only the tiles matching the search, hides sections left empty, and updates their counts. */
export function applyListSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-list-search]');
  if (!input) return;
  const main = input.closest('main');
  if (!main) return;
  const words = fold(input.value).split(/\s+/).filter(Boolean);
  // Pages with category tabs (Achievements, Archive) show every tab's matches while searching.
  main.classList.toggle('searching', words.length > 0);
  let shown = 0;
  for (const section of main.querySelectorAll<HTMLElement>('.wiki-type, [data-search-section]')) {
    let n = 0;
    for (const tile of section.querySelectorAll<HTMLElement>('.wiki-tile, [data-search-item]')) {
      const text = fold(tile.textContent ?? '');
      const hit = words.every((w) => text.includes(w));
      tile.hidden = !hit;
      if (hit) n++;
    }
    section.hidden = n === 0;
    const count = section.querySelector('.wiki-count');
    if (count) count.textContent = String(n);
    shown += n;
  }
  const empty = main.querySelector<HTMLElement>('.list-search-empty');
  if (empty) empty.hidden = !words.length || shown > 0;
}

/** Puts the caret in the hidden search input, at the end, without scrolling to it. */
function focusSearch(input: HTMLInputElement): void {
  input.focus({ preventScroll: true });
  input.setSelectionRange(input.value.length, input.value.length);
}

/** Keeps typing going into the search after a redraw replaced its input (app.ts draw). */
export function refocusListSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-list-search]');
  if (input) focusSearch(input);
}

// The big letters in the middle of the screen.
let overlay: HTMLElement | null = null;
let fade: ReturnType<typeof setTimeout> | undefined;
function showTyped(q: string): void {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'type-search';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.append(overlay);
  }
  clearTimeout(fade);
  overlay.textContent = q;
  overlay.classList.toggle('show', !!q);
  if (q) fade = setTimeout(() => overlay?.classList.remove('show'), 1000);
}

const typing = (el: Element | null) => !!el && (el.matches('input, textarea, select, [contenteditable]') || !!el.closest('[contenteditable]'));

function setQuery(input: HTMLInputElement, q: string): void {
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function installListSearch(): void {
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const key = el.dataset?.listSearch;
    if (!key) return;
    queries[key] = el.value;
    applyListSearch();
    // A field you can see shows the text already.
    if (!el.hasAttribute('data-shown')) showTyped(el.value);
  });
  document.addEventListener('keydown', (e) => {
    const input = document.querySelector<HTMLInputElement>('[data-list-search]');
    if (!input) return;
    if (e.target === input) {
      if (e.key === 'Escape') {
        setQuery(input, '');
        input.blur();
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === 'Tab') input.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target as Element)) return;
    if (document.querySelector('dialog[open], .sort-pop, .ctx-menu')) return;
    // A letter or digit typed anywhere (or Backspace while a search is on) goes into the search; the key lands there.
    const key = e.key.length === 1 && e.key !== ' ';
    if (key || (e.key === 'Backspace' && input.value)) focusSearch(input);
    else if (e.key === 'Escape' && input.value) setQuery(input, '');
  });
}
