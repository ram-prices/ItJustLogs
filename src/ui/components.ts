import { EF_ASSETS, EF_ASSETS_CDN, issueLayerUrls, itemIconUrl, mirrorUrl } from '../domain/banners';
import type { Kind } from '../domain/types';
import { html, raw, type Html } from './html';
import { tintFor } from './tint';

/**
 * An Arsenal Issue's banner art in its layers, so the weapon and ornaments
 * can move apart from the backdrop (ui/parallax.ts). Until a banner's layers
 * exist, its flat art (`flat`) takes their place (common.ts). Null for other banners.
 */
export function issueArt(poolId: string, flat: string): Html | null {
  const l = issueLayerUrls(poolId);
  if (!l) return null;
  const layer = (cls: string, src: string) =>
    html`<img class="${cls}" src="${src}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" data-fallback />`;
  return html`<span class="issue-art" data-flat="${flat}">${layer('issue-back', l.back)}<span class="issue-float">${layer('issue-weapon', l.weapon)}</span>${layer('issue-front', l.front)}</span>`;
}

/** Small Geist-style building blocks shared by every page. */

/** A Material Symbols icon; `filled` uses the font's FILL axis for a solid glyph. */
export const icon = (name: string, filled = false): Html =>
  html`<span class="icon${filled ? ' filled' : ''}" aria-hidden="true">${name}</span>`;

/**
 * The game's essence icon (a ball with two rings cut out of it), drawn in the text colour;
 * it stands for Maxed Essence. Labelled for screen readers and on hover.
 */
/** The essence picture's outline (a ball with two rings cut out), in a 24×24 box. */
const ESSENCE_PATH = 'M1 12A11 11 0 1 0 23 12A11 11 0 1 0 1 12ZM11.14 3.01A6.81 4.13 44.4 1 0 20.88 12.55A6.81 4.13 44.4 1 0 11.14 3.01ZM11.86 5.44A4.59 2.24 44.4 1 0 18.42 11.87A4.59 2.24 44.4 1 0 11.86 5.44ZM8.32 18.93A3.68 1.91 0 1 0 15.68 18.93A3.68 1.91 0 1 0 8.32 18.93ZM9.81 18.44A2.19 0.82 0 1 0 14.19 18.44A2.19 0.82 0 1 0 9.81 18.44Z';

export const essenceIcon = (label = 'Maxed Essence'): Html =>
  html`<svg class="essence-icon" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="${label}"><title>${label}</title>${raw(
    `<path fill-rule="evenodd" d="${ESSENCE_PATH}"/>`,
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

/**
 * The game's rarity emblem (endfield.wiki.gg's Star.svg) for the ★ of a
 * rarity: drawn in the text's colour, its three tones as shades of it.
 */
export const STAR_SVG = '<svg class="rarity-star" viewBox="0 0 24 24" aria-hidden="true"><path class="t1" d="m5.845 17.424 6.369-3.667L9.605 9.25.87 14.28zm17.249.69-6.37-3.678-2.608 4.519 8.736 5.043zM20.417 0 15.2 2.686v7.07h5.217z"/><path class="t2" d="m8.298 16.03 3.765-2.174-2.609-4.518-1.957 1.13s2.051 4.325.8 5.562m12.343.668-3.765-2.174-2.61 4.518 1.959 1.13s2.72-3.939 4.416-3.474m-.224-9.202S15.49 7.266 15.2 5.41v4.348h5.217z"/><path d="m13.922 9.77-.136-6.147L9.42 6.145l.008 6.622c.29 2.125-1.28 3.35-1.28 3.35l4.519-2.61c1.53-1.238 1.256-3.737 1.256-3.737m3.887 3.639 5.391 2.957v-5.044l-5.74-3.304c-2.141-.655-2.26-2.783-2.26-2.783v5.217c.15 2.103 2.609 2.957 2.609 2.957m-5.4 1.547-5.257 3.191 4.368 2.522 5.731-3.318c1.695-1.314 3.54-.567 3.54-.567l-4.518-2.608c-1.839-.707-3.865.78-3.865.78"/></svg>';
export const stars = (n: number): Html => raw(STAR_SVG.repeat(n));

/** The game's gear slot mark (endfield.wiki.gg's Armor/Glove/Kit Gear Icon), in the text's colour. */
export const slotIcon = (type: 'Armor' | 'Gloves' | 'Kit' | string): Html =>
  html`<span class="slot-icon ${type.toLowerCase()}" aria-hidden="true"></span>`;

/** The game's Artifice level mark (endfield.wiki.gg's Artifice_<n>_icon.svg): a gear and three bars. */
const ARTIFICE_GEAR = 'm25.33,3.96H8.44L0,18.59l8.44,14.63h16.89l8.45-14.63-4.22-7.31-4.23-7.32Zm-8.44,20.41c-3.19,0-5.78-2.59-5.78-5.78s2.59-5.78,5.78-5.78,5.78,2.59,5.78,5.78-2.59,5.78-5.78,5.78Zm25.69-13.09h-13.02L36.07,0l6.51,11.28Z';
const ARTIFICE_LIT = 'm39.33,5.64l-9.77,5.64h13.02l-3.25-5.64Zm-9.77,5.64l-7.66,4.43c.49.85.77,1.83.77,2.88,0,3.19-2.59,5.78-5.78,5.78-2.14,0-4.01-1.16-5-2.89l-7.66,4.43,4.21,7.31h16.89l8.45-14.63-4.22-7.31Z';
const ARTIFICE_BARS: [number, string][] = [
  [27.43, 'translate(-3.84 45.5) rotate(-60)'],
  [38.71, 'translate(1.79 55.26) rotate(-60)'],
  [49.98, 'translate(7.43 65.03) rotate(-60)'],
];
/** Artifice level 0–3 as the game draws it: the first `level` bars lit, and all of it at the top. */
export const artificeIcon = (level: number): Html => {
  const on = (lit: boolean) => (lit ? ' class="on"' : '');
  const full = level >= ARTIFICE_BARS.length;
  return html`<svg class="artifice-icon" viewBox="0 0 66.83 35.25" role="img" aria-label="Artifice ${level}"><title>Artifice ${level}</title>${raw(
    `<path${on(full)} d="${ARTIFICE_GEAR}"/>${level > 0 && !full ? `<path class="on" d="${ARTIFICE_LIT}"/>` : ''}` +
      ARTIFICE_BARS.map(([x, t], i) => `<rect${on(i < level)} x="${x}" y="22.54" width="20.1" height="7.08" rx="3.54" transform="${t}"/>`).join(''),
  )}</svg>`;
};
/** Text with each ★ drawn as the game's rarity emblem ("6★ history"). */
export const withStars = (text: string): Html => html`${text.split('★').map((part, i) => html`${i ? raw(STAR_SVG) : ''}${part}`)}`;

export function metric(o: MetricOpts): Html {
  return html`<div class="metric">
    <div class="metric-label"><span>${withStars(o.label)}</span>${o.aside ?? ''}</div>
    <div class="metric-value" ${o.valueColor ? raw(`style="color:${o.valueColor}"`) : ''}>${o.value}</div>
    ${o.sub ? html`<div class="metric-sub">${typeof o.sub === 'string' ? withStars(o.sub) : o.sub}</div>` : ''}
    ${o.progress !== undefined
      ? html`<div class="progress"><i style="width:${Math.max(0, Math.min(1, o.progress)) * 100}%;${o.progressColor ? `background:${o.progressColor}` : ''}"></i></div>`
      : ''}
  </div>`;
}

/**
 * The game's icons for items, elements, classes and weapon types: ef-assets
 * icons/index.json (its scripts/item-icons.py, from endfield.wiki.gg), kind →
 * name → file. Loaded once at start (app.ts); until it arrives, or for a name
 * it lacks, names show without an icon.
 */
export type IconKind = 'items' | 'elements' | 'classes' | 'weapon-types' | 'potential';
/** ef-assets icons/index.json: kind → name → file, plus `colors`, each banner HH Permit's main colour. */
let icons: Partial<Record<IconKind | 'colors', Record<string, string>>> | null = null;
export function loadIcons(redraw: () => void): void {
  const url = `${EF_ASSETS}/icons/index.json`;
  fetch(url)
    .then((r) => (r.ok ? r : fetch(mirrorUrl(url)!)))
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      icons = data;
      redraw();
    })
    .catch(() => {});
}
/** A name's icon URL, if ef-assets has one (a plural "...Permits" finds "...Permit"). */
export function iconOf(kind: IconKind, name: string): string | null {
  const files = icons?.[kind];
  const file = files?.[name] ?? files?.[name.replace(/s$/, '')];
  return file ? `${EF_ASSETS_CDN}/icons/${file}` : null;
}

/** A banner HH Permit's main colour (from its icon), if ef-assets has one. */
export function colorOf(name: string): string | null {
  const colors = icons?.colors;
  return colors?.[name] ?? colors?.[name.replace(/s$/, '')] ?? null;
}

/** An item's name with its game icon; Oroberyl also in its colour: "[icon] Oroberyl". */
export function itemName(name: string): Html {
  if (/^oroberyls?$/i.test(name)) return html`<span class="oroberyl"><img class="oroberyl-icon" src="/icons/oroberyl.webp" alt="" />${name}</span>`;
  const src = iconOf('items', name);
  return src ? html`<span class="item-label"><img class="item-icon" src="${src}" alt="" loading="lazy" decoding="async" />${name}</span>` : html`${name}`;
}

/** An element, class or weapon type with its game icon. */
/**
 * An element's icon in the element's own colour (the wk-* text colours):
 * the icons are white glyphs, drawn as a mask. Nothing until icons load.
 */
export function elementIcon(name: string): Html {
  const src = iconOf('elements', name);
  return src ? html`<span class="trait-icon trait-mask wk-${name.toLowerCase().replace(/\W/g, '')}" style="--icon:url('${src}')" aria-hidden="true"></span>` : html``;
}

/** A weapon type's game icon (Sword, Polearm...) in the text's colour; nothing until icons load. */
export function weaponTypeIcon(type: string): Html {
  const src = iconOf('weapon-types', type);
  return src ? html`<span class="slot-icon trait-mask" style="--icon:url('${src}')" aria-hidden="true"></span>` : html``;
}

export function trait(kind: Exclude<IconKind, 'items'>, name: string): Html {
  const src = iconOf(kind, name);
  if (!src) return html`${name}`;
  if (kind === 'elements') return html`<span class="trait">${elementIcon(name)}${name}</span>`;
  return html`<span class="trait"><img class="trait-icon" src="${src}" alt="" loading="lazy" decoding="async" />${name}</span>`;
}

/**
 * The player's profile picture in its circle (`lg`: Settings' bigger one).
 * A picture framed to show beyond its circle (`box`: how far it reaches
 * left and right, in circle widths) sits on the circle's bottom; with `pop`
 * what it has outside the circle shows (room is made only on the sides it
 * reaches), else it's cut to the circle.
 */
export const avatar = (src: string | undefined, pop: boolean, lg = false, box?: { l: number; r: number }): Html => {
  const size = lg ? ' lg' : '';
  if (!src) return html`<span class="avatar${size}"></span>`;
  if (!box) return html`<img class="avatar${size}" src="${src}" alt="" />`;
  return html`<span class="avatar framed${pop ? ' pop' : ''}${size}" style="--l:${box.l};--r:${box.r}"><img src="${src}" alt="" /></span>`;
};

/** `plain` is the borderless page-level stat row; the default is a bordered panel. */
export const metrics = (items: Html[], variant: '' | 'plain' = ''): Html =>
  html`<div class="metrics${variant ? ` ${variant}` : ''}">${items}</div>`;

export function itemImg(kind: Kind, itemId: string, cls = 'item-icon'): Html {
  const src = itemIconUrl(kind, itemId);
  if (!src) return html`<span class="${cls}"></span>`;
  return html`<img class="${cls}${kind === 'weap' ? ' weapon' : ''}" src="${src}" alt="" loading="lazy" decoding="async" data-fallback />`;
}

/** Marks a page that plays a video background (ui/videoBackground.ts): Home. */
export const backgroundSource = (): Html => html`<i class="bg-source" hidden></i>`;

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
/**
 * A picture with its rarity on it, as the game shows it: a band of the
 * rarity's colour along the bottom, glowing up behind the art. Used wherever
 * an operator, weapon or gear piece is listed, instead of writing "6★".
 */
export const rarityArt = (img: Html, r: number, cls = ''): Html =>
  html`<span class="rarity-art r${r}${cls ? ` ${cls}` : ''}" role="img" aria-label="${r}★" title="${r}★">${img}</span>`;

/** A Database list tile's picture with its rarity on it. */
export const tileArt = (kind: Kind, id: string, r: number): Html => rarityArt(itemImg(kind, id, 'wiki-tile-portrait'), r, 'wiki-tile-art');

export const rarity = (r: number): Html =>
  html`<span class="rarity"><span class="dot" style="background:${RARITY_COLOR[r] ?? 'var(--muted)'}"></span>${r}${stars(1)}</span>`;

/** Status colour for a pity-like value: calm until it gets close to the cap. */
export function heat(value: number, max: number): string {
  const r = value / max;
  return r >= 0.8 ? 'var(--red)' : r >= 0.5 ? 'var(--amber)' : 'var(--green)';
}

export function toggleGroup(name: string, options: [string, string][], current: string): Html {
  return html`<div class="toggle" role="group">
    ${options.map(
      ([value, label]) =>
        html`<button type="button" data-action="${name}" data-value="${value}" aria-pressed="${String(value === current)}">${withStars(label)}</button>`,
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
  database: raw('<span class="tab-icon icon filled" aria-hidden="true">menu_book</span>'),
  pulls: raw('<span class="tab-icon icon filled" aria-hidden="true">inventory_2</span>'),
  story: raw('<span class="tab-icon icon filled" aria-hidden="true">auto_stories</span>'),
  stats: raw('<span class="tab-icon icon filled" aria-hidden="true">bar_chart</span>'),
  essences: raw(`<svg class="tab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="${ESSENCE_PATH}"/></svg>`),
  aic: raw('<span class="tab-icon icon filled" aria-hidden="true">factory</span>'),
  achievements: raw('<span class="tab-icon icon filled" aria-hidden="true">military_tech</span>'),
  archives: raw('<span class="tab-icon icon filled" aria-hidden="true">auto_stories</span>'),
  settings: raw('<span class="tab-icon icon filled" aria-hidden="true">settings</span>'),
};

/**
 * The ItJustLogs mark: a cut log, after Endfield's Wood material icon. Solid in
 * the text colour, with the ring band and bark marks knocked out in the
 * background colour, so it follows the theme.
 * public/favicon.svg is the same log, its lines cut out, dark or light with the
 * browser's theme; keep the two in sync.
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
