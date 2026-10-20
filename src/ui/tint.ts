/**
 * Ambient banner tint, ported from the original tracker: shrink the banner art
 * to 10×10, average it, boost saturation and lift dark results, and use that
 * colour for a soft glow behind the card. Arsenal cards take the rate-up
 * weapon's main colour instead (`weaponTint`). Results are cached by image
 * URL so re-renders paint the glow immediately.
 */
import { whenNear } from './near';

/** Shown until the art has loaded (or if the colour can't be read). */
export const DEFAULT_TINT = 'rgba(255, 255, 255, 0.1)';

const cache = new Map<string, string>();

export const tintFor = (url: string): string => cache.get(url) ?? DEFAULT_TINT;

const clamp = (v: number) => Math.min(255, Math.max(0, Math.floor(v)));

/** Lift dark colours so the glow is still visible. */
function lift(r: number, g: number, b: number): string {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  if (brightness < 100) {
    const boost = 100 / (brightness || 1);
    r = Math.min(255, Math.floor(r * boost));
    g = Math.min(255, Math.floor(g * boost));
    b = Math.min(255, Math.floor(b * boost));
  }
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * An icon's main colour. A weapon is mostly grey metal on a transparent
 * background, so average only the dominant hue among its coloured pixels
 * (Umbra's purple, a gold trim...); an operator's portrait does the same with
 * skin left out (`skipSkin`), so their hair or outfit sets it (Laevatain's
 * red, Camille's teal). Falls back to the plain average for colourless icons.
 */
function weaponColour(img: HTMLImageElement, skipSkin = false): string {
  const N = 24;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, N, N);
  const data = ctx.getImageData(0, 0, N, N).data;
  const BINS = 24;
  const bins = Array.from({ length: BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let all = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3] / 255];
    if (a < 0.5) continue;
    all = { w: all.w + 1, r: all.r + r, g: all.g + g, b: all.b + b };
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    if (sat < 0.25 || max < 40) continue; // grey metal and shadows
    const d = max - min;
    const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    if (skipSkin && hue > 0.1 && hue < 0.45 && sat < 0.55 && max > 150) continue; // light, soft orange: skin
    const bin = bins[Math.floor((hue / 6) * BINS) % BINS];
    const w = sat * (max / 255);
    bin.w += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
  }
  // Let neighbouring hue bins vote together so a hue split across a boundary still wins.
  const score = (i: number) => bins[(i + BINS - 1) % BINS].w + bins[i].w * 2 + bins[(i + 1) % BINS].w;
  let best = 0;
  for (let i = 1; i < BINS; i++) if (score(i) > score(best)) best = i;
  const top = bins[best];
  if (top.w < 0.5) {
    if (!all.w) return DEFAULT_TINT;
    return lift(all.r / all.w, all.g / all.w, all.b / all.w);
  }
  let [r, g, b] = [top.r / top.w, top.g / top.w, top.b / top.w];
  const avg = (r + g + b) / 3;
  [r, g, b] = [r, g, b].map((v) => clamp(avg + (v - avg) * 1.4));
  return lift(r, g, b);
}

const pending = new Set<string>();

/** Rate-up portraits in the 6★ strip take their banner card's colour (`data-six-tint`). */
function paintSix(url: string, tint: string): void {
  if (tint === DEFAULT_TINT) return; // keep the 6★ gold outline
  for (const el of document.querySelectorAll<HTMLElement>('[data-six-tint]')) {
    if (el.dataset.sixTint === url) el.style.setProperty('--six-tint', tint);
  }
}

/** The cached colour for a 6★ strip outline, if it's known yet (else the gold stays). */
export const sixTintFor = (url: string): string | null => {
  const t = cache.get(url);
  return t && t !== DEFAULT_TINT ? t : null;
};

/**
 * Works out the strip's banner colours itself: the cards further down lazy-load
 * their art, so the strip can't wait for them. Same maths as the cards: the
 * weapon's or operator's main colour (`data-six-tint-kind` weap / op), else
 * the art's average.
 */
export function tintSixStrip(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-six-tint]')) {
    const url = el.dataset.sixTint!;
    if (cache.has(url) || pending.has(url)) continue;
    const kind = el.dataset.sixTintKind;
    pending.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let tint = DEFAULT_TINT;
      try {
        tint = kind === 'weap' || kind === 'op' ? weaponColour(img, kind === 'op') : extract(img);
      } catch {
        // not CORS-clean: keep the gold outline
      }
      cache.set(url, tint);
      pending.delete(url);
      paintSix(url, tint);
    };
    img.onerror = () => {
      pending.delete(url);
      cache.set(url, DEFAULT_TINT);
    };
    img.src = url;
  }
}

/**
 * The operator and weapon pages' hero glow (`data-hero-tint`: the item's
 * icon; `data-hero-tint-skin` for operators, skin left out): the same colour
 * as its banner card, from the same cache.
 */
export function tintHeroes(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-hero-tint]')) {
    const url = el.dataset.heroTint!;
    const known = cache.get(url);
    if (known) {
      el.style.setProperty('--banner-tint', known);
      continue;
    }
    if (pending.has(url)) continue;
    pending.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let tint = DEFAULT_TINT;
      try {
        tint = weaponColour(img, el.hasAttribute('data-hero-tint-skin'));
      } catch {
        // not CORS-clean: keep the faint default glow
      }
      cache.set(url, tint);
      pending.delete(url);
      paintSix(url, tint);
      for (const e of document.querySelectorAll<HTMLElement>('[data-hero-tint]')) {
        if (e.dataset.heroTint === url) e.style.setProperty('--banner-tint', tint);
      }
    };
    img.onerror = () => {
      pending.delete(url);
      cache.set(url, DEFAULT_TINT);
    };
    img.src = url;
  }
}

/**
 * Tints each card that has one rate-up from that item's icon
 * (`data-tint-item`): the weapon for Arsenal, the operator (skin left out,
 * `data-tint-skin`) for Headhunting. The icon is loaded off-page, for each
 * card as it nears the screen; call after each render.
 */
export function tintWeaponCards(): void {
  for (const card of document.querySelectorAll<HTMLElement>('.banner[data-tint-item]')) whenNear(card, () => tintCard(card));
}

function tintCard(card: HTMLElement): void {
  const url = card.dataset.tintItem!;
  const skipSkin = card.hasAttribute('data-tint-skin');
  const known = cache.get(url);
  if (known) {
    card.style.setProperty('--banner-tint', known);
    return;
  }
  if (pending.has(url)) return;
  pending.add(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    let tint = DEFAULT_TINT;
    try {
      tint = weaponColour(img, skipSkin);
    } catch {
      // not CORS-clean: keep the default glow
    }
    cache.set(url, tint);
    pending.delete(url);
    paintSix(url, tint);
    for (const c of document.querySelectorAll<HTMLElement>('.banner[data-tint-item]')) {
      if (c.dataset.tintItem === url) c.style.setProperty('--banner-tint', tint);
    }
  };
  img.onerror = () => {
    pending.delete(url);
    cache.set(url, DEFAULT_TINT);
  };
  img.src = url;
}

function extract(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 10;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 10, 10);
  const data = ctx.getImageData(0, 0, 10, 10).data; // throws if the image isn't CORS-clean

  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = data.length / 4;
  r = Math.floor(r / n);
  g = Math.floor(g / n);
  b = Math.floor(b / n);

  // Boost saturation so the glow reads as a colour, not grey.
  const avg = (r + g + b) / 3;
  const sat = 2.2;
  r = clamp(avg + (r - avg) * sat);
  g = clamp(avg + (g - avg) * sat);
  b = clamp(avg + (b - avg) * sat);

  return lift(r, g, b);
}

/** Listens for banner art loading anywhere on the page and tints its card. */
export function installTint(): void {
  document.addEventListener(
    'load',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-tint')) return;
      const card = img.closest<HTMLElement>('.banner');
      if (!card) return;
      let tint = cache.get(img.src);
      if (!tint) {
        try {
          tint = extract(img);
        } catch {
          tint = DEFAULT_TINT;
        }
        cache.set(img.src, tint);
        // Also cache under the original URL so the next render finds it even after a CDN fallback.
        const original = card.dataset.art;
        if (original) {
          cache.set(original, tint);
          paintSix(original, tint);
        }
      }
      card.style.setProperty('--banner-tint', tint);
    },
    true, // 'load' doesn't bubble
  );
}

/**
 * Ambient light from a picture, as YouTube's ambient mode does: the average
 * colour along each of its four edges (`data-ambient-src`, set as --amb-t,
 * --amb-r, --amb-b, --amb-l), so each side of the glow matches the side of
 * the picture it spills from. Cached by URL; call after each render.
 */
const edgeCache = new Map<string, string[]>();
const edgePending = new Set<string>();
const AMBIENT_VARS = ['--amb-t', '--amb-r', '--amb-b', '--amb-l'];

function edgeColours(img: HTMLImageElement): string[] {
  const N = 16;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  /** The average of the pixels a strip two pixels deep along one edge. */
  const avg = (pick: (x: number, y: number) => boolean) => {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        if (!pick(x, y) || d[i + 3] < 128) continue;
        n++;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
      }
    // The edge's own colour, dark ones included (no lift): a dark picture glows dark.
    return n ? `rgb(${clamp(r / n)}, ${clamp(g / n)}, ${clamp(b / n)})` : 'transparent';
  };
  return [avg((_, y) => y < 2), avg((x) => x >= N - 2), avg((_, y) => y >= N - 2), avg((x) => x < 2)];
}

export function tintAmbients(): void {
  paintCardAmbients();
  const paint = (url: string, colours: string[]) => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-ambient-src]'))
      if (el.dataset.ambientSrc === url) AMBIENT_VARS.forEach((v, i) => el.style.setProperty(v, colours[i]));
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-ambient-src]')) {
    const url = el.dataset.ambientSrc!;
    const known = edgeCache.get(url);
    if (known) {
      paint(url, known);
      continue;
    }
    if (edgePending.has(url)) continue;
    edgePending.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let colours = AMBIENT_VARS.map(() => 'transparent');
      try {
        colours = edgeColours(img);
      } catch {
        // not CORS-clean: keep the faint default
      }
      edgeCache.set(url, colours);
      edgePending.delete(url);
      paint(url, colours);
    };
    img.onerror = () => edgePending.delete(url);
    img.src = url;
  }
}

/**
 * Ambient light around a whole card (`data-card-ambient` on a box the size of
 * the card): its border in SEGMENTS pieces a side, each glowing in the colour
 * of what the card shows at that point of its edge: the picture where it
 * reaches the edge (the part of it on screen, after object-fit: cover), the
 * card's own background everywhere else. So a banner glows from the top and
 * fades to the card's dark down the sides and below.
 */
const SEGMENTS = 8;
const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();

function loaded(url: string): HTMLImageElement | null {
  const known = images.get(url);
  if (known && known !== 'loading') return known === 'failed' ? null : known;
  if (!known) {
    images.set(url, 'loading');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      images.set(url, img);
      paintCardAmbients();
    };
    img.onerror = () => images.set(url, 'failed');
    img.src = url;
  }
  return null;
}

/** The colour of a picture shown with object-fit: cover in a `bw`×`bh` box, at (x, y) in that box, read from a small copy. */
function coverSampler(img: HTMLImageElement, bw: number, bh: number): ((x: number, y: number) => string) | null {
  const N = 24;
  const scale = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
  const sw = bw / scale;
  const sh = bh / scale;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  try {
    g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    return (x, y) => {
      const px = Math.min(N - 1, Math.max(0, Math.floor((x / bw) * N)));
      const py = Math.min(N - 1, Math.max(0, Math.floor((y / bh) * N)));
      const i = (py * N + px) * 4;
      return d[i + 3] < 128 ? '' : `rgb(${d[i]}, ${d[i + 1]}, ${d[i + 2]})`;
    };
  } catch {
    return null; // not CORS-clean
  }
}

/**
 * How much of the picture shows through the Background style's vignette at
 * (x, y) in a w×h card (styles.css `.style-background .char-card-art::after`,
 * keep these in step): each layer covers it with the card's colour by its
 * alpha there.
 */
function vignetteKeep(x: number, y: number, w: number, h: number): number {
  const lerp = (t: number, stops: [number, number][]) => {
    for (let i = 1; i < stops.length; i++) {
      const [t0, a0] = stops[i - 1];
      const [t1, a1] = stops[i];
      if (t <= t1) return a0 + ((a1 - a0) * Math.max(0, t - t0)) / (t1 - t0);
    }
    return stops[stops.length - 1][1];
  };
  const bottom = lerp((h - y) / h, [[0, 0.9], [0.5, 0.6], [0.8, 0], [1, 0]]);
  const left = lerp(x / w, [[0, 0.55], [0.6, 0], [1, 0]]);
  const r = Math.hypot((x / w - 0.55) / 1.1, (y / h - 0.25) / 0.85);
  const edge = lerp(r, [[0, 0], [0.45, 0], [1, 0.7], [9, 0.7]]);
  return (1 - bottom) * (1 - left) * (1 - edge);
}

/** `rgb(...)` mixed toward `base` (also `rgb(...)`), keeping `keep` of it. */
function mixRgb(c: string, base: string, keep: number): string {
  const a = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  const b = base.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
  return `rgb(${[0, 1, 2].map((i) => Math.round(a[i] * keep + b[i] * (1 - keep))).join(', ')})`;
}

export function paintCardAmbients(): void {
  for (const box of document.querySelectorAll<HTMLElement>('[data-card-ambient]')) {
    // Outside the card (beside it in its wrap) or inside it.
    const card = box.closest<HTMLElement>('.char-card') ?? box.parentElement?.querySelector<HTMLElement>('.char-card');
    const pic = card?.querySelector<HTMLImageElement>('.char-card-art img');
    if (!card) continue;
    const cr = card.getBoundingClientRect();
    if (!cr.width || !cr.height) continue;
    const base = getComputedStyle(card).backgroundColor;
    const img = pic && box.dataset.cardAmbient ? loaded(box.dataset.cardAmbient) : null;
    const pr = pic?.getBoundingClientRect();
    const sample = img && pr ? coverSampler(img, pr.width, pr.height) : null;
    const vignetted = card.classList.contains('style-background') && !card.classList.contains('picture-only');
    /** What the card shows at (x, y) on its edge (card coordinates). */
    const at = (x: number, y: number): string => {
      if (sample && pr) {
        const px = x + cr.left - pr.left;
        const py = y + cr.top - pr.top;
        if (px >= 0 && py >= 0 && px <= pr.width && py <= pr.height) {
          const c = sample(Math.min(px, pr.width - 1), Math.min(py, pr.height - 1));
          // As a background, the picture is seen through its vignette.
          if (c) return vignetted ? mixRgb(c, base, vignetteKeep(x, y, cr.width, cr.height)) : c;
        }
      }
      return base;
    };
    const glows: string[] = [];
    const seg = (side: 't' | 'r' | 'b' | 'l', i: number) => {
      const f = (i + 0.5) / SEGMENTS;
      const [x, y] = side === 't' ? [f * cr.width, 1] : side === 'b' ? [f * cr.width, cr.height - 1] : side === 'l' ? [1, f * cr.height] : [cr.width - 1, f * cr.height];
      const pos =
        side === 't' || side === 'b'
          ? `left:${(i / SEGMENTS) * 100}%;width:${100 / SEGMENTS}%;${side === 't' ? 'top' : 'bottom'}:0;height:2px`
          : `top:${(i / SEGMENTS) * 100}%;height:${100 / SEGMENTS}%;${side === 'l' ? 'left' : 'right'}:0;width:2px`;
      glows.push(`<i style="${pos};--c:${at(x, y)}"></i>`);
    };
    for (const side of ['t', 'r', 'b', 'l'] as const) for (let i = 0; i < SEGMENTS; i++) seg(side, i);
    const html = glows.join('');
    if (box.innerHTML !== html) box.innerHTML = html;
  }
}
