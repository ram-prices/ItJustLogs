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
