/**
 * Minimal safe templating: `html` escapes every interpolated value unless it is
 * itself an Html fragment. Pull data comes from user files, so nothing is
 * inserted raw by accident.
 */
export class Html {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

type Value = Html | string | number | boolean | null | undefined | Value[];

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function stringify(v: Value): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(stringify).join('');
  return escape(String(v));
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += stringify(values[i]) + strings[i + 1];
  return new Html(out);
}

/** Trusted markup only (constants, generated SVG paths). */
export const raw = (s: string): Html => new Html(s);

export function render(el: Element, content: Html): void {
  el.innerHTML = content.value;
}

/**
 * The focused element inside `scope`, told apart in a way that survives the
 * scope being re-rendered (innerHTML): ways to find it again, most specific
 * first (id; data-action + data-value; its data-* and name; href; its path
 * from `scope`), each with its place among that way's matches, and the caret
 * of a text field. Null when nothing in `scope` has focus.
 */
export interface FocusMark {
  ways: [selector: string, index: number][];
  start: number | null;
  end: number | null;
}

/** data-* that change with what's shown, not which element it is. */
const VOLATILE_DATA = new Set(['data-tip', 'data-cv-watch', 'data-route-focus']);
const attrSel = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;

function pathFrom(scope: Element, el: Element): string | null {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== scope; e = e.parentElement) {
    const parent: Element | null = e.parentElement;
    if (!parent) return null;
    parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(e) + 1})`);
  }
  return parts.length ? `:scope > ${parts.join(' > ')}` : null;
}

export function focusMark(scope: Element): FocusMark | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !scope.contains(el) || el === scope) return null;
  const tag = el.tagName.toLowerCase();
  const sels: string[] = [];
  if (el.id) sels.push(`#${CSS.escape(el.id)}`);
  const { action, value } = el.dataset;
  if (action) sels.push(tag + attrSel('data-action', action) + (value != null ? attrSel('data-value', value) : ''));
  const data = [...el.attributes].filter((a) => (a.name.startsWith('data-') && !VOLATILE_DATA.has(a.name)) || a.name === 'name');
  if (data.length) sels.push(tag + data.map((a) => attrSel(a.name, a.value)).join(''));
  const href = el.getAttribute('href');
  if (href) sels.push(tag + attrSel('href', href));
  const path = pathFrom(scope, el);
  if (path) sels.push(path);
  const ways = [...new Set(sels)].map((s): [string, number] => [s, [...scope.querySelectorAll(s)].indexOf(el)]);
  const text = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
  let start: number | null = null;
  let end: number | null = null;
  try {
    if (text) ({ selectionStart: start, selectionEnd: end } = el);
  } catch {
    /* inputs without a caret (number, date) */
  }
  return { ways, start, end };
}

/** Focuses the element `mark` names in the re-rendered `scope`, caret and all, without scrolling. True if found. */
export function restoreFocus(scope: Element, mark: FocusMark | null): boolean {
  if (!mark) return false;
  for (const [sel, index] of mark.ways) {
    let found: Element[];
    try {
      found = [...scope.querySelectorAll(sel)];
    } catch {
      continue;
    }
    const el = found[Math.min(Math.max(index, 0), found.length - 1)];
    if (!(el instanceof HTMLElement)) continue;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (mark.start != null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try {
        el.setSelectionRange(mark.start, mark.end ?? mark.start);
      } catch {
        /* the field changed type */
      }
    }
    if (document.activeElement === el) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmtInt = (n: number): string => n.toLocaleString();

export function fmtDate(ts: number, withTime = false): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}
