import type { TierLook } from './medalTier';

/**
 * Reading the game's Medal Album from screenshots or a screen recording:
 * the part after text recognition. The page (ui/medalReader.ts) runs
 * Tesseract.js on each frame and hands its lines here; this matches them
 * to the wiki's medal names and settles each medal's date by a vote across
 * frames. Plain rules, no AI: domain.test.ts pins them with real lines.
 *
 * A medal row reads as one line: its title, the Acquired pill (which
 * Tesseract renders as noise like "[~ IESE]" or "@ ...") and the date. A
 * medal not acquired yet shows its title with no date.
 */

export interface ReadLine {
  text: string;
  /** Vertical middle of the line in the frame, in pixels. */
  y: number;
}

export interface MedalName {
  id: string;
  name: string;
}

/** What one frame showed of one medal. */
export interface Sighting {
  id: string;
  /** YYYY-MM-DD, or null when the row had no (believable) date: not acquired. */
  date: string | null;
  /** How sure the name match is (1: the exact name is in the line). */
  score: number;
  /** Which of the frame's lines it was read from (the page samples its picture: medalTier.ts). */
  line?: number;
  /** Its look in that frame, for medals that can be reforged or trimmed. */
  look?: TierLook | null;
}

export interface ReadMedal {
  id: string;
  name: string;
  /** The date most frames agreed on; null if it was never seen with one. */
  date: string | null;
  /** Frames it was seen in, and how many of them agreed on `date`. */
  seen: number;
  votes: number;
  /** Other dates some frames read (misreads, usually). */
  others: string[];
  score: number;
  /** Worth a look before saving: one sighting, a loose name match, or frames that disagreed. */
  unsure: boolean;
  /** Its Reforging tier or Trimming, as most frames saw it (medals that have them). */
  tier?: 1 | 2 | 3;
  trim?: boolean;
}

/** Lowercase words only, accents and symbols dropped; roman numerals (Ⅱ) become letters (ii). */
export const normName = (s: string): string =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Text recognition often reads roman numerals as l, 1 or |: "Il" → "ii", "lll" → "iii", "lV" → "iv". */
function fixNumeral(words: string[]): string[] {
  const last = words.at(-1);
  if (!last || words.length < 2) return words;
  const n = last.replace(/[l1|]/g, 'i');
  return /^(i{1,3}|iv|v)$/.test(n) ? [...words.slice(0, -1), n] : words;
}

const ROMAN = /^(i{1,3}|iv|v)$/;

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
const similarity = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

const DATE = /(20\d\d)\s*[-–—.]\s*(\d{1,2})\s*[-–—.]\s*(\d{1,2})/;

/** A date as the game shows it, if it's a real one: not before the game came out, not in the future. */
export function readDate(text: string, today = new Date()): string | null {
  const m = text.match(DATE);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2026 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return iso <= today.toISOString().slice(0, 10) ? iso : null;
}

/** Which known medal a line's title part is, and how sure: the longest name found whole in it, else the closest. */
export function matchName(title: string, names: { id: string; n: string }[]): { id: string; score: number } | null {
  const words = fixNumeral(normName(title).split(' ').filter(Boolean));
  const t = words.join(' ');
  if (t.length < 3) return null;
  let best: { id: string; n: string } | null = null;
  for (const m of names) {
    if (m.n.length < 4) continue;
    const at = ` ${t} `.indexOf(` ${m.n} `);
    if (at < 0) continue;
    // "Wuling Stock Redistributor" inside "wuling stock redistributor ii" is the wrong medal: a numeral right after means another one.
    const next = ` ${t} `.slice(at + m.n.length + 2).split(' ')[0];
    if (next && ROMAN.test(next)) continue;
    if (!best || m.n.length > best.n.length) best = m;
  }
  if (best) return { id: best.id, score: 1 };
  let score = 0;
  for (const m of names) {
    const s = similarity(t, m.n);
    if (s > score) {
      score = s;
      best = m;
    }
  }
  return best && score >= 0.8 ? { id: best.id, score } : null;
}

/** The medals one frame shows: each title line, with the date on its row if there is one. */
export function readFrame(lines: ReadLine[], names: { id: string; n: string }[], today = new Date()): Sighting[] {
  const out: Sighting[] = [];
  for (const [i, l] of lines.entries()) {
    // The title is what comes before the pill ("[~ ...]", "@ ...", "Acquired") or the date.
    const title = l.text.split(/\[|@|\{|acquired|20\d\d\s*[-–—.]/i)[0];
    const hit = matchName(title, names);
    if (!hit) continue;
    const date = readDate(l.text, today) ?? lines.filter((o) => o !== l && Math.abs(o.y - l.y) < 12).map((o) => readDate(o.text, today)).find(Boolean) ?? null;
    out.push({ id: hit.id, date, score: hit.score, line: i });
  }
  return out;
}

/** All frames' sightings, settled: each medal's date is the one most frames read. */
export function settle(sightings: Sighting[], medals: MedalName[]): ReadMedal[] {
  const byId = new Map<string, Sighting[]>();
  for (const s of sightings) byId.set(s.id, [...(byId.get(s.id) ?? []), s]);
  const names = new Map(medals.map((m) => [m.id, m.name]));
  return [...byId.entries()].map(([id, ss]) => {
    const counts = new Map<string, number>();
    for (const s of ss) if (s.date) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const score = Math.max(...ss.map((s) => s.score));
    const [date, votes] = ranked[0] ?? [null, 0];
    const tie = ranked.length > 1 && ranked[1][1] === votes;
    // The look most frames saw.
    const looks = new Map<string, number>();
    for (const s of ss) if (s.look) looks.set(JSON.stringify(s.look), (looks.get(JSON.stringify(s.look)) ?? 0) + 1);
    const look = [...looks.entries()].sort((a, b) => b[1] - a[1])[0];
    const seenLook = look ? (JSON.parse(look[0]) as TierLook) : null;
    return {
      ...(seenLook && 'tier' in seenLook ? { tier: seenLook.tier } : {}),
      ...(seenLook && 'trim' in seenLook ? { trim: seenLook.trim } : {}),
      id,
      name: names.get(id) ?? id,
      date,
      seen: ss.length,
      votes,
      others: ranked.slice(1).map(([d]) => d),
      score,
      unsure: score < 1 || tie || (date !== null && votes < 2),
    };
  });
}

/** The names prepared for matching. */
export const nameIndex = (medals: MedalName[]) => medals.map((m) => ({ id: m.id, n: normName(m.name) }));
