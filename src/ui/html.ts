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

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const fmtInt = (n: number): string => n.toLocaleString();
export const fmtPct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;

export function fmtDate(ts: number, withTime = false): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}
