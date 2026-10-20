import { itemIconUrl } from '../domain/banners';
import type { Kind } from '../domain/types';
import { html, raw, type Html } from './html';
import { tintFor } from './tint';

/** Small Geist-style building blocks shared by every page. */

/** A Material Symbols icon; `filled` uses the font's FILL axis for a solid glyph. */
export const icon = (name: string, filled = false): Html =>
  html`<span class="icon${filled ? ' filled' : ''}" aria-hidden="true">${name}</span>`;

/**
 * The game's essence icon (a ball with two rings cut out of it), drawn in the text colour;
 * it stands for Maxed Essence. Labelled for screen readers and on hover.
 */
export const essenceIcon = (label = 'Maxed Essence'): Html =>
  html`<svg class="essence-icon" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="${label}"><title>${label}</title>${raw(
    `<path fill-rule="evenodd" d="M1 12A11 11 0 1 0 23 12A11 11 0 1 0 1 12ZM11.14 3.01A6.81 4.13 44.4 1 0 20.88 12.55A6.81 4.13 44.4 1 0 11.14 3.01ZM11.86 5.44A4.59 2.24 44.4 1 0 18.42 11.87A4.59 2.24 44.4 1 0 11.86 5.44ZM8.32 18.93A3.68 1.91 0 1 0 15.68 18.93A3.68 1.91 0 1 0 8.32 18.93ZM9.81 18.44A2.19 0.82 0 1 0 14.19 18.44A2.19 0.82 0 1 0 9.81 18.44Z"/>`,
  )}</svg>`;

export type BadgeTone = 'gray' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'blue' | 'outline';
export const badge = (text: string | Html, tone: BadgeTone = 'gray', large = false): Html =>
  html`<span class="badge ${tone === 'gray' ? '' : tone}${large ? ' lg' : ''}">${text}</span>`;

export interface MetricOpts {
  label: string;
  value: string | number | Html;
  sub?: string | Html;
  aside?: Html;
  /** 0–1 progress bar under the value. */
  progress?: number;
  progressColor?: string;
  valueColor?: string;
}

export function metric(o: MetricOpts): Html {
  return html`<div class="metric">
    <div class="metric-label"><span>${o.label}</span>${o.aside ?? ''}</div>
    <div class="metric-value" ${o.valueColor ? raw(`style="color:${o.valueColor}"`) : ''}>${o.value}</div>
    ${o.sub ? html`<div class="metric-sub">${o.sub}</div>` : ''}
    ${o.progress !== undefined
      ? html`<div class="progress"><i style="width:${Math.max(0, Math.min(1, o.progress)) * 100}%;${o.progressColor ? `background:${o.progressColor}` : ''}"></i></div>`
      : ''}
  </div>`;
}

/** `plain` is the borderless page-level stat row; the default is a bordered panel. */
export const metrics = (items: Html[], variant: '' | 'plain' = ''): Html =>
  html`<div class="metrics${variant ? ` ${variant}` : ''}">${items}</div>`;

export function itemImg(kind: Kind, itemId: string, cls = 'item-icon'): Html {
  const src = itemIconUrl(kind, itemId);
  if (!src) return html`<span class="${cls}"></span>`;
  return html`<img class="${cls}${kind === 'weap' ? ' weapon' : ''}" src="${src}" alt="" loading="lazy" decoding="async" data-fallback />`;
}

/**
 * The soft colour glow behind an operator or weapon page's header: the item's
 * main colour, like its banner card's (tint.ts tintHeroes fills it in).
 */
export function heroGlow(kind: Kind, itemId: string): Html {
  const src = itemIconUrl(kind, itemId);
  if (!src) return html``;
  return html`<div class="wiki-hero-glow" data-hero-tint="${src}" ${raw(kind === 'char' ? 'data-hero-tint-skin' : '')} style="--banner-tint:${tintFor(src)}" aria-hidden="true"></div>`;
}

export const RARITY_COLOR: Record<number, string> = { 6: 'var(--r6)', 5: 'var(--r5)', 4: 'var(--r4)', 3: 'var(--r3)' };
export const rarity = (r: number): Html =>
  html`<span class="rarity"><span class="dot" style="background:${RARITY_COLOR[r] ?? 'var(--muted)'}"></span>${r}★</span>`;

/** Status colour for a pity-like value: calm until it gets close to the cap. */
export function heat(value: number, max: number): string {
  const r = value / max;
  return r >= 0.8 ? 'var(--red)' : r >= 0.5 ? 'var(--amber)' : 'var(--green)';
}

export function toggleGroup(name: string, options: [string, string][], current: string): Html {
  return html`<div class="toggle" role="group">
    ${options.map(
      ([value, label]) =>
        html`<button type="button" data-action="${name}" data-value="${value}" aria-pressed="${String(value === current)}">${label}</button>`,
    )}
  </div>`;
}

export const pageHeader = (title: string, description?: string | Html, actions?: Html, crumbs?: Html): Html =>
  html`<div class="page-header"><div class="container page-header-inner">
    <div class="min0">
      ${crumbs ?? ''}
      <h1 class="heading-32">${title}</h1>
      ${description ? html`<p class="copy-16">${description}</p>` : ''}
    </div>
    ${actions ? html`<div class="row">${actions}</div>` : ''}
  </div></div>`;

/**
 * Tab icons. Operators is the official Endfield site's own nav icon
 * (endfield.gryphline.com). Arsenal is traced from the in-game Arsenal medal
 * artwork (full-colour version: public/icons/arsenal.svg).
 */
export const TAB_ICON: Record<string, Html> = {
  operators: raw('<svg class="tab-icon" viewBox="0 0 44 49" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="M43.057,48.470 L37.334,48.470 L6.667,48.470 L0.942,48.470 L0.942,40.719 L0.942,15.502 L0.941,15.502 L0.941,6.304 L0.942,6.304 L0.942,6.301 L6.667,6.301 L6.667,6.304 L9.743,6.304 L9.743,10.903 L34.526,10.903 L34.526,6.304 L37.334,6.304 L37.334,6.301 L43.058,6.301 L43.058,48.470 L43.057,48.470 ZM37.334,15.502 L6.667,15.502 L6.667,40.719 L10.448,40.719 L10.448,35.267 C10.448,32.112 12.951,29.554 16.037,29.554 L27.963,29.554 C31.049,29.554 33.551,32.112 33.551,35.267 L33.551,40.719 L37.334,40.719 L37.334,15.502 ZM22.000,27.793 C19.155,27.793 16.848,25.434 16.848,22.526 C16.848,19.617 19.155,17.259 22.000,17.259 C24.845,17.259 27.152,19.617 27.152,22.526 C27.152,25.434 24.845,27.793 22.000,27.793 ZM9.743,0.506 L34.526,0.506 L34.526,6.304 L9.743,6.304 L9.743,0.506 Z"/></svg>'),
  arsenal: raw(
    // traced from the in-game Arsenal medal; same shape as public/icons/arsenal.svg, one colour
    '<svg class="tab-icon" viewBox="0 0 89.90 89.90" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M77.81 2.37 L89.90 14.46 L88.34 16.03 L82.22 16.03 L69.37 28.87 L69.37 30.71 L75.34 30.71 L80.79 36.17 L68.54 48.42 L50.15 30.03 ZM11.96 2.71 L87.62 78.37 L78.81 87.18 L62.84 71.21 L58.09 71.21 L45.09 58.21 L30.65 72.65 L28.22 70.21 L10.90 87.53 L2.53 79.15 L2.53 77.84 L25.46 54.90 L21.59 51.03 L24.00 48.62 L21.25 48.62 L9.06 36.43 L14.90 30.59 L20.50 30.59 L20.50 28.99 L6.90 15.40 L3.46 15.40 L2.09 16.77 L0.00 14.68 Z"/></svg>',
  ),
  // Material Symbols, filled to match the solid shapes above.
  home: raw('<span class="tab-icon icon filled" aria-hidden="true">home</span>'),
  stats: raw('<span class="tab-icon icon filled" aria-hidden="true">bar_chart</span>'),
  settings: raw('<span class="tab-icon icon filled" aria-hidden="true">settings</span>'),
};

/**
 * The ItJustLogs mark: a cut log, after Endfield's Wood material icon. Solid in
 * the text colour, with the ring band and bark marks knocked out in the
 * background colour, so it follows the theme.
 * public/favicon.svg is the same log on a dark tile; keep the two in sync.
 */
const FG = 'currentColor';
const BG = 'var(--background-100)';
export const LOGO = raw(
  '<svg class="logo-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    // trunk, with a short branch stub angled up on the left
    `<path d="M5 6.5v12c0 1.66 3.13 3 7 3s7-1.34 7-3v-12z" fill="${FG}"/>` +
    `<rect x="1.6" y="11.6" width="5" height="2.4" rx="1.2" transform="rotate(-24 6 13)" fill="${FG}"/>` +
    // cut face: one ring band around a solid heart
    `<ellipse cx="12" cy="6.5" rx="7" ry="3" fill="${FG}"/>` +
    `<ellipse cx="12" cy="6.5" rx="5.4" ry="1.9" fill="${BG}"/>` +
    `<ellipse cx="12" cy="6.5" rx="2.4" ry="0.85" fill="${FG}"/>` +
    // bark: two straight grooves on the left, one curving crack on the right
    `<path d="M7.6 10.8v4.6M10 12.6v6M15.5 11.6c-.9 1.5.7 2.6-.1 4.4" stroke="${BG}" stroke-width="1" stroke-linecap="round"/>` +
    '</svg>',
);
