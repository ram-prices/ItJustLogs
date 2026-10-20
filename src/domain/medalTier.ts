/**
 * Which look a medal has on screen, for the medals that change it:
 * Reforgeable ones go dark grey (base) → silver (Reforged II) → gold
 * (Reforged III); trimmable ones turn holographic (pale with a spread of
 * colours, or vivid) when Trimmed. The medal reader samples a square of the
 * picture beside each title and settles the look by these colour rules,
 * measured on real Medal Album screenshots (medalTier.test.ts). Plain
 * rules, no AI.
 */

export interface Look {
  /** Mean saturation and brightness (0–1). */
  s: number;
  v: number;
  /** Of the coloured pixels, the share that's gold (hue 25–65°). */
  gold: number;
  /** Spread of hue among faintly coloured pixels (degrees): a holographic sheen. */
  spread: number;
  /**
   * How many of twelve hue bands hold at least 5% of the coloured pixels. A
   * holographic medal shows a rainbow (4+); a plain silver or white one, even
   * tinted, stays in one or two.
   */
  bands: number;
}

/** Colour statistics of a square of RGBA pixels. */
export function lookOf(rgba: Uint8ClampedArray): Look {
  let s = 0;
  let v = 0;
  let n = 0;
  let coloured = 0;
  let gold = 0;
  const faint: number[] = [];
  const band = new Array<number>(12).fill(0);
  let tinted = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    let hue = 0;
    if (max !== min) {
      if (max === r) hue = ((g - b) / (max - min)) % 6;
      else if (max === g) hue = (b - r) / (max - min) + 2;
      else hue = (r - g) / (max - min) + 4;
      hue = (hue * 60 + 360) % 360;
    }
    s += sat;
    v += max;
    n++;
    if (sat > 0.25 && max > 0.3) {
      coloured++;
      if (hue >= 25 && hue <= 65) gold++;
    }
    if (sat > 0.08 && max > 0.5) faint.push(hue);
    if (sat > 0.12 && max > 0.45) {
      band[Math.floor(hue / 30) % 12]++;
      tinted++;
    }
  }
  const bands = band.filter((c) => c >= Math.max(2, tinted * 0.05)).length;
  const mean = faint.reduce((a, h) => a + h, 0) / (faint.length || 1);
  const spread = faint.length > n * 0.05 ? Math.sqrt(faint.reduce((a, h) => a + (h - mean) ** 2, 0) / faint.length) : 0;
  return { s: s / (n || 1), v: v / (n || 1), gold: coloured ? gold / coloured : 0, spread, bands };
}

export type TierLook = { tier: 1 | 2 | 3 } | { trim: boolean };

/**
 * The look, for a medal that can be reforged or trimmed; null when the
 * square doesn't look like a medal at all (a background, a frame mid-scroll).
 */
export function tierOf(look: Look, can: { reforge: boolean; trim: boolean }): TierLook | null {
  // The list's light background, not a picture.
  if (look.v > 0.88 && look.s < 0.05) return null;
  if (can.reforge) {
    if (look.s > 0.3 && look.gold > 0.6) return { tier: 3 };
    if (look.v < 0.5 && look.s < 0.2) return { tier: 1 };
    if (look.s < 0.2) return { tier: 2 };
    return null;
  }
  if (can.trim) {
    // Holographic: pale with a rainbow (many hue bands, widely spread), or much more vivid than a
    // medal's gold. Some base medals are pale silver-white themselves: a tint alone isn't a sheen.
    if ((look.v > 0.55 && look.s < 0.3 && look.bands >= 4 && look.spread > 40) || look.s > 0.65) return { trim: true };
    return { trim: false };
  }
  return null;
}
