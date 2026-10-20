/**
 * Reading the game's Intel Archives → Findings grid from screenshots or a
 * screen recording: the part after text recognition (ui/findingReader.ts
 * runs Tesseract.js). The grid shows only the findings collected, in the
 * same order as the wiki's list, with names cut short ("Crew Mate Des…").
 * So each name read is matched by how the real names start, and when that
 * leaves a choice ("Agent Data: Ha…" is three different files) the grid's
 * order settles it: the reading takes the longest run of names that fits
 * the list in order. A name that fits nowhere between its neighbours is a
 * finding the wiki doesn't list yet. Plain rules, no AI.
 */
import { normName } from './medalReader';

export interface ReadWord {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface FindingName {
  id: string;
  name: string;
  category: string;
  order: number;
}

/** One finding name as read off a tile: the visible part, and whether it was cut short. */
export interface Tile {
  text: string;
  cut: boolean;
  x: number;
  y: number;
}

/**
 * Splits a frame's words into tile names: words on one line close together
 * are one name; a gap wider than `gap` (the space between grid columns)
 * starts the next tile.
 */
export function tilesFrom(words: ReadWord[], gap = 24): Tile[] {
  const lines: ReadWord[][] = [];
  for (const w of [...words].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)) {
    const mid = (w.y0 + w.y1) / 2;
    const line = lines.find((l) => Math.abs((l[0].y0 + l[0].y1) / 2 - mid) < (w.y1 - w.y0) * 0.6);
    if (line) line.push(w);
    else lines.push([w]);
  }
  const tiles: Tile[] = [];
  for (const line of lines.sort((a, b) => a[0].y0 - b[0].y0)) {
    line.sort((a, b) => a.x0 - b.x0);
    let cur: ReadWord[] = [];
    const flush = () => {
      if (!cur.length) return;
      const raw = cur.map((w) => w.text).join(' ').trim();
      const cut = /(\.{2,}|…|,,)\s*$/.test(raw);
      tiles.push({ text: raw.replace(/[\s.…,·:;'"“”‘’]+$/, ''), cut, x: cur[0].x0, y: (cur[0].y0 + cur[0].y1) / 2 });
      cur = [];
    };
    for (const w of line) {
      // Marks between tiles ("~~", "=", "|") read as words of their own: they end a name.
      if (!/[a-z0-9]/i.test(w.text)) {
        flush();
        continue;
      }
      if (cur.length && w.x0 - cur[cur.length - 1].x1 > gap) flush();
      cur.push(w);
      // So does the "..." of a name cut short, even when the next tile's name sits close.
      if (/(\.{2,}|…)$/.test(w.text)) flush();
    }
    flush();
  }
  return tiles;
}

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
const close = (a: string, b: string) => lev(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * 0.15));

/**
 * Which findings a tile's name could be: names that start the same way (it
 * was cut short), or the whole name (it fits), allowing a misread letter or
 * two. Positions in `list`.
 */
export function candidates(tile: Tile, list: { n: string }[]): number[] {
  // Compared without spaces: small text often loses them ("Will LeftonaTr…").
  const t = normName(tile.text).replace(/ /g, '');
  if (t.length < 4) return [];
  const out: number[] = [];
  const names = list.map((f) => f.n.replace(/ /g, ''));
  names.forEach((n, i) => {
    if (tile.cut) {
      if (n.startsWith(t) || close(n.slice(0, t.length), t)) out.push(i);
    } else if (n === t || close(n, t)) out.push(i);
  });
  // A name read whole that only matches as a start was likely cut without the dots showing.
  if (!out.length && !tile.cut && t.length >= 8) names.forEach((n, i) => (n.startsWith(t) || close(n.slice(0, t.length), t)) && out.push(i));
  // The wiki sometimes names a finding with more in front ("Fangxing Avenue - Popular Chubby Lungs"
  // for the game's "Popular Chubby Lungs"): a longer read can match inside a name.
  if (!out.length && t.length >= 10) names.forEach((n, i) => n.includes(t) && out.push(i));
  return out;
}

/**
 * The tiles in reading order, matched to the list: the longest chain of
 * tiles whose picks rise through the list (the grid's order). Tiles off the
 * chain are returned as unread: misreads, or findings the wiki lacks.
 */
export function chain(tiles: Tile[], list: { n: string }[]): { picks: number[]; unread: Tile[] } {
  const cands = tiles.map((t) => candidates(t, list));
  // best[i][k]: longest chain ending at tile i with its k-th candidate.
  const best = cands.map((cs) => cs.map(() => ({ len: 1, from: null as [number, number] | null })));
  for (let i = 0; i < tiles.length; i++) {
    cands[i].forEach((c, k) => {
      for (let j = 0; j < i; j++) {
        cands[j].forEach((d, m) => {
          // Strictly later in the list, and not absurdly far (the grid shows a screenful at a time).
          if (d < c && best[j][m].len + 1 > best[i][k].len) best[i][k] = { len: best[j][m].len + 1, from: [j, m] };
        });
      }
    });
  }
  let end: [number, number] | null = null;
  let len = 0;
  best.forEach((bs, i) =>
    bs.forEach((b, k) => {
      // Ties go to the earliest list position, which keeps runs of look-alikes in order.
      if (b.len > len || (b.len === len && end && cands[i][k] < cands[end[0]][end[1]])) {
        len = b.len;
        end = [i, k];
      }
    }),
  );
  const picks = new Array<number>(tiles.length).fill(-1);
  for (let at: [number, number] | null = end; at; at = best[at[0]][at[1]].from) picks[at[0]] = cands[at[0]][at[1]];
  return { picks, unread: tiles.filter((t, i) => picks[i] < 0 && looksLikeName(t)) };
}

/** The screen's own words (title, side menu, the New filter), never a finding. */
const SCREEN = /intel archive|findings|ollected|show new only|uscripts|e fil|eculiars|s ?i?o ?w/;

/**
 * Whether a tile no name matched still looks like a finding's name (to list
 * as "not matched"): mostly letters, a few words or cut short, and not the
 * screen's own labels or the marks around the grid.
 */
function looksLikeName(t: Tile): boolean {
  const n = normName(t.text);
  if (SCREEN.test(n)) return false;
  const letters = n.replace(/[^a-z]/g, '').length;
  // Mostly letters, counting the raw text's dashes and marks ("es srem————" is a border, not a name).
  if (letters < 6 || letters < t.text.replace(/\s/g, '').length * 0.7) return false;
  return t.cut || n.split(' ').filter((w) => w.length > 1).length >= 2;
}

/** The game's "Collected 279" under each category in the side menu, as read. */
export function collectedCounts(lines: { text: string; y: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  lines.forEach((l, i) => {
    const cat = ['Manuscripts', 'E-Files', 'Peculiars'].find((c) => normName(l.text).includes(normName(c)));
    if (!cat) return;
    const below = lines.slice(i, i + 3).find((o) => /collected\s*(\d+)/i.test(o.text));
    const n = below?.text.match(/collected\s*(\d+)/i)?.[1];
    if (n) out[cat] = Number(n);
  });
  return out;
}

/** The list prepared for matching (each category in the game's order). */
export const findingIndex = (list: FindingName[]) => [...list].sort((a, b) => a.order - b.order).map((f) => ({ id: f.id, n: normName(f.name), name: f.name, category: f.category }));
