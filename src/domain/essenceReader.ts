/**
 * Reading essences from the game's screens, after text recognition
 * (ui/essenceReader.ts runs Tesseract.js). Two screens show an essence's
 * stats: Valuables → Essences (the selected one's "Essence Stats" panel)
 * and Etch Essence (the material card). Either way the stats are a few
 * known names, each with a "+N" level beside or just below it, stacked in a
 * column: the reader finds those, keeps the column that holds an essence
 * (the largest one), and turns a run of frames into essences: a new one
 * each time the stats change and hold for two frames. Plain rules, no AI.
 */
import { ALL_STATS, STAT_ALIASES, essenceKey, type EssenceStat } from './essences';
import { normName } from './medalReader';

export interface ReadText {
  text: string;
  x0: number;
  x1?: number;
  y0: number;
  y1: number;
}

const NAMES: { n: string; stat: string }[] = [
  ...ALL_STATS.map((s) => ({ n: normName(s), stat: s })),
  ...Object.entries(STAT_ALIASES).map(([a, s]) => ({ n: normName(a), stat: s })),
].sort((a, b) => b.n.length - a.n.length);

function lev(a: string, b: string): number {
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** The stat a line names, if any: a known name as whole words, or one letter off for the longer names. */
export function statIn(text: string): string | null {
  const t = normName(text);
  // The essence's own title ("Flawless Essence: Flow") names a stat but isn't one.
  if (!t || /essence|source|infuse|sample/.test(t)) return null;
  const padded = ` ${t} `;
  for (const { n, stat } of NAMES) if (padded.includes(` ${n} `)) return stat;
  // A misread letter: compare each run of the line's words with each name (a bullet or mark may come first).
  const words = t.split(' ');
  for (const { n, stat } of NAMES) {
    if (n.length < 5) continue;
    const k = n.split(' ').length;
    for (let i = 0; i + k <= words.length; i++) if (lev(words.slice(i, i + k).join(' '), n) <= 1) return stat;
  }
  return null;
}

const LEVEL = /\+\s?([1-6])(?![0-9])/;

/** One essence's stats in a frame's lines (the largest column of stat + level), or null. */
export function readEssence(lines: ReadText[]): EssenceStat[] | null {
  return readEssenceArea(lines)?.stats ?? null;
}

/**
 * The same, with where on the frame they are (the stat lines and their
 * levels' box, padded): the reader then reads just that area, which is
 * much faster than whole frames.
 */
export function readEssenceArea(lines: ReadText[]): { stats: EssenceStat[]; box: { x0: number; y0: number; x1: number; y1: number } } | null {
  if (!lines.length) return null;
  const h = median(lines.map((l) => l.y1 - l.y0)) || 20;
  const found: { stat: string; level: number; x: number; y: number; parts: ReadText[] }[] = [];
  for (const l of lines) {
    // The etch panel's "Main Attribute +1 » +2" is a stat being upgraded, not an essence's list.
    if (/[»>]{1,2}\s*\+/.test(l.text)) continue;
    const stat = statIn(l.text);
    if (!stat) continue;
    const y = (l.y0 + l.y1) / 2;
    // Its level: on the same line, or on the line just below (Valuables puts it under a bar).
    let m = l.text.match(LEVEL);
    let from: ReadText = l;
    if (!m) {
      const below = lines.filter((o) => o !== l && (o.y0 + o.y1) / 2 > y - h * 0.3 && (o.y0 + o.y1) / 2 < y + h * 2.2 && !statIn(o.text));
      const hit = below.find((o) => LEVEL.test(o.text));
      if (hit) {
        m = hit.text.match(LEVEL);
        from = hit;
      }
    }
    if (m) found.push({ stat, level: Number(m[1]), x: l.x0, y, parts: from === l ? [l] : [l, from] });
  }
  if (!found.length) return null;
  // Columns: stats lined up on the left, each within a few lines of the last.
  found.sort((a, b) => a.y - b.y);
  const groups: (typeof found)[] = [];
  for (const f of found) {
    const g = groups.find((g) => Math.abs(g[0].x - f.x) < h * 3 && f.y - g[g.length - 1].y < h * 4);
    if (g) g.push(f);
    else groups.push([f]);
  }
  const best = groups.sort((a, b) => b.length - a.length)[0];
  // No more than three, each stat once.
  const seen = new Set<string>();
  const picked = best.filter((f) => !seen.has(f.stat) && seen.add(f.stat)).slice(0, 3);
  // The area to read from now on: the panel's column around the first stat found, generous enough
  // for all three stats and their levels even when this frame missed some (whole frames read poorly).
  const top = picked[0].parts[0];
  const box = { x0: top.x0 - h * 2, x1: top.x0 + h * 18, y0: top.y0 - h * 5, y1: top.y0 + h * 10 };
  return { stats: picked.map((f) => [f.stat, f.level]), box };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Turns frame readings into essences: a reading counts once it holds for
 * two frames in a row (so a frame caught mid-change doesn't), and each
 * change to a held reading is the next essence. Two identical essences in a
 * row can't be told apart and count once.
 */
export class EssenceTally {
  private last: string | null = null;
  private pending: string | null = null;
  private seen = 0;
  readonly stash = new Map<string, number>();
  /** Essences counted, in order (keys). */
  readonly order: string[] = [];

  /** A frame's reading (null: no essence on screen). `same`: the frame didn't change since the last one. */
  add(stats: EssenceStat[] | null): void {
    const key = stats?.length ? essenceKey(stats) : null;
    if (key === null) {
      this.pending = null;
      this.seen = 0;
      return;
    }
    if (key === this.pending) this.seen++;
    else {
      this.pending = key;
      this.seen = 1;
    }
    if (this.seen >= 2 && key !== this.last) {
      this.last = key;
      this.stash.set(key, (this.stash.get(key) ?? 0) + 1);
      this.order.push(key);
    }
  }

  /** The screen held still (an unchanged frame): the current reading holds one more frame. */
  hold(): void {
    if (this.pending) this.add(essenceFromKey(this.pending));
  }

  get count(): number {
    return this.order.length;
  }
}

const essenceFromKey = (key: string): EssenceStat[] =>
  key.split('|').map((p) => {
    const at = p.lastIndexOf('+');
    return [p.slice(0, at), Number(p.slice(at + 1))];
  });
