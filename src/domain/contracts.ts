/**
 * Contingency Contract: the game's seasonal challenge. Each season is one
 * stage played with a chosen set of Test Criteria, each worth 1–3 points, from
 * ef-assets cc/. The selection rules and the share code follow the game's
 * ContingencyContractUtils.lua, so a code made here pastes into the game.
 */
import { timeOn, type Server, type ServerTimes } from './schedule.ts';

export interface Season {
  /** Slug: /contracts/<id>. */
  id: string;
  activityId: string;
  gameId: string;
  name: string;
  shortName: string;
  fullName: string;
  desc: string;
  currency: { name: string; icon: string };
  start: ServerTimes;
  /** The second batch of criteria opens: phase 2. */
  batch2: ServerTimes | null;
  /** Combat ends; the shop stays open until shopClose. */
  end: ServerTimes;
  shopClose: ServerTimes;
  art: string;
  banner: string;
  criteria: number;
  complete: boolean;
}

export interface SeasonIndex {
  attribution?: { text: string; url: string; license: string; fetched: string };
  seasons: Season[];
}

export interface Criterion {
  id: number;
  col: number;
  row: number;
  points: number;
  numeral: string;
  /** null until the game or the wiki has it. */
  name: string | null;
  desc: string | null;
  descSource: 'game' | 'wiki' | null;
  icon: string;
  /** Group id: at most one criterion of a group. */
  conflict: string | null;
  /** The key this criterion gives: a Key Criterion. */
  key: string | null;
  /** Keys it needs, each from another selected criterion. */
  locks: string[];
  /** Needs this total cleared first. */
  unlockTotal: number;
  /** 2: opens with the season's second batch. */
  unlockPhase: number;
  firstClear: number;
}

export interface WaveEnemy {
  id: string;
  count: number;
}

export interface Enemy {
  name: string;
  level: number;
  /** The base value: the fight's is hp × (1 + hpBonus). */
  hp: number;
  atk: number;
  /** 0.3 is +30%. */
  hpBonus: number;
  abilities?: string[];
  portrait?: string;
}

export interface Reward {
  item: string;
  /** null where the game doesn't show one. */
  count: number | null;
  icon: string;
}

export interface Mission {
  id: string;
  group: string;
  name: string | null;
  desc: string;
  reward: Reward[];
  opens: ServerTimes | null;
}

export interface ShopItem {
  id: string;
  item: string;
  count: number;
  price: number;
  /** 0: no limit. */
  limit: number;
  icon: string;
}

export interface SeasonFile {
  id: string;
  attribution?: { text: string; url: string; license: string };
  /** Plain text: the event's rules, enemy notes, stage rules. */
  rules: string;
  feature: string;
  stageRules: string;
  recommendLv: number;
  maxTotal: number;
  /** The highest legal total once each phase is open. */
  maxTotalByPhase: Record<string, number>;
  /** Seconds, or null when the stage's limit isn't known. */
  timer: number | null;
  grid: { cols: number; rows: number };
  keys: Record<string, { color: string; keyLabel: string; lockLabel: string }>;
  criteria: Criterion[];
  waves: { variant: number; wave: number; enemies: WaveEnemy[] }[];
  /** Wave files; `note` is a reading of what differs. */
  variants: { id: number; note: string | null; inferred: boolean }[];
  enemies: Record<string, Enemy>;
  missions: Mission[];
  shop: ShopItem[];
  medal: { name: string; desc: string; howTo: string; needs: number; icon: string; plate: string | null; plateIcon: string | null };
  rewards: Reward[];
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type SeasonStatus = 'upcoming' | 'live' | 'shop' | 'ended';

export const STATUS_LABEL: Record<SeasonStatus, string> = { upcoming: 'Upcoming', live: 'Live', shop: 'Shop only', ended: 'Ended' };

export function seasonStatus(s: Season, now: number, server: Server): SeasonStatus {
  if (now < timeOn(s.start, server)!) return 'upcoming';
  if (now < timeOn(s.end, server)!) return 'live';
  return now < timeOn(s.shopClose, server)! ? 'shop' : 'ended';
}

/** The next date that matters: the season's four, in order, the first still ahead. */
export function nextDate(s: Season, now: number, server: Server): { label: string; at: number } | null {
  const dates: [string, ServerTimes | null][] = [
    ['Opens', s.start],
    ['New criteria', s.batch2],
    ['Combat ends', s.end],
    ['Shop closes', s.shopClose],
  ];
  for (const [label, t] of dates) {
    const at = timeOn(t, server);
    if (at != null && now < at) return { label, at };
  }
  return null;
}

/** 2 once the second batch is open. A season without one is in phase 1 until it ends. */
export function phaseOf(s: Season, now: number, server: Server): number {
  const at = timeOn(s.batch2, server);
  return (at != null && now >= at) || now >= timeOn(s.end, server)! ? 2 : 1;
}

/** Newest first, with the season the page leads with on top: the running one, else the next, else the newest. */
export function seasonsInOrder(list: Season[], now: number, server: Server): Season[] {
  const newest = [...list].sort((a, b) => timeOn(b.start, server)! - timeOn(a.start, server)!);
  const open = newest.find((s) => ['live', 'shop'].includes(seasonStatus(s, now, server)));
  const coming = newest.filter((s) => seasonStatus(s, now, server) === 'upcoming').at(-1);
  const lead = open ?? coming ?? newest[0];
  return lead ? [lead, ...newest.filter((s) => s !== lead)] : [];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A season's rules as written: "- Heading -" over "· line" (or "- line", in the stage notes). */
export function rulesSections(text: string): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^- (.+) -$/);
    if (head || !out.length) out.push({ title: head?.[1] ?? '', lines: [] });
    if (!head) out.at(-1)!.lines.push(line.replace(/^[·-]\s*/, ''));
  }
  return out;
}

/** A mission's title and text: its name, or the one its description opens with ("Stress Adaptation: Beat..."), else the description. */
export function missionText(m: Mission): { title: string; text: string } {
  const named = m.desc.match(/^([^:\n]+): ([\s\S]*)$/);
  if (!named) return { title: m.name ?? m.desc, text: m.name ? m.desc : '' };
  return m.name && m.name !== named[1] ? { title: m.name, text: m.desc } : { title: named[1], text: named[2] };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * What the player picked, kept per season. `best` stands in for the game's
 * best cleared total, which the site can't know: the highest total this
 * selection has reached, so unlock totals open as the selection grows and stay
 * open, as they do in the game.
 */
export interface Selection {
  ids: number[];
  best: number;
}

export const EMPTY_SELECTION: Selection = { ids: [], best: 0 };

export type Block = { why: 'phase' } | { why: 'total'; needs: number } | { why: 'key'; keys: string[] };

export const totalOf = (criteria: Criterion[], ids: Iterable<number>): number => {
  const picked = new Set(ids);
  return criteria.reduce((sum, c) => sum + (picked.has(c.id) ? c.points : 0), 0);
};

/** The keys `c` needs that no other picked criterion gives. */
function missingKeys(c: Criterion, criteria: Criterion[], picked: Set<number>): string[] {
  return c.locks.filter((lock) => !criteria.some((o) => o.id !== c.id && o.key === lock && picked.has(o.id)));
}

/** What the rest of a group leaves when `c` takes its place. */
const withoutGroup = (c: Criterion, criteria: Criterion[], picked: Set<number>): Set<number> =>
  new Set([...picked].filter((id) => !c.conflict || id === c.id || criteria.find((o) => o.id === id)?.conflict !== c.conflict));

/** Why `c` can't be picked now, or null when it can. Picking replaces the rest of its conflict group. */
export function blockOf(c: Criterion, criteria: Criterion[], sel: Selection, phase: number): Block | null {
  if (c.unlockPhase > phase) return { why: 'phase' };
  if (c.unlockTotal > sel.best) return { why: 'total', needs: c.unlockTotal };
  const keys = missingKeys(c, criteria, withoutGroup(c, criteria, new Set(sel.ids)));
  return keys.length ? { why: 'key', keys } : null;
}

/** Drops criteria whose key went away, and those that needed them. */
function settle(criteria: Criterion[], picked: Set<number>): Set<number> {
  const left = new Set(picked);
  for (let dropped = true; dropped; ) {
    dropped = false;
    for (const c of criteria)
      if (left.has(c.id) && missingKeys(c, criteria, left).length) {
        left.delete(c.id);
        dropped = true;
      }
  }
  return left;
}

/** The selection after tapping `c`: off if picked, on if allowed (replacing its group), else unchanged. */
export function toggle(c: Criterion, criteria: Criterion[], sel: Selection, phase: number): Selection {
  const on = sel.ids.includes(c.id);
  if (!on && blockOf(c, criteria, sel, phase)) return sel;
  const picked = new Set(sel.ids);
  const next = on ? picked : withoutGroup(c, criteria, picked);
  if (on) next.delete(c.id);
  else next.add(c.id);
  const left = settle(criteria, next);
  const ids = criteria.filter((x) => left.has(x.id)).map((x) => x.id);
  return { ids, best: Math.max(sel.best, totalOf(criteria, ids)) };
}

/** Whether a set of criteria could be picked together. Unlock totals depend on the player, as they do for the game's codes. */
export function isLegal(criteria: Criterion[], ids: number[], phase: number): boolean {
  const picked = new Set(ids);
  const groups = new Set<string>();
  for (const c of criteria) {
    if (!picked.has(c.id)) continue;
    if (c.unlockPhase > phase || missingKeys(c, criteria, picked).length) return false;
    if (c.conflict) {
      if (groups.has(c.conflict)) return false;
      groups.add(c.conflict);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Share code (ContingencyContractUtils.lua GenShareCode, AnalyzeShareCode)
// ---------------------------------------------------------------------------

/** No I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Rows on the board: a column is one octal digit. */
const ROWS = 3;

const codeLength = (cols: number): number => Math.ceil((cols * ROWS) / 5);

/** One octal digit per column, column 1 lowest, a bit per row, as a fixed-length base 32 number. */
export function encodeShareCode(criteria: Criterion[], ids: Iterable<number>, cols: number): string {
  const picked = new Set(ids);
  let value = 0n;
  for (const c of criteria) if (picked.has(c.id)) value |= 1n << BigInt((c.col - 1) * ROWS + c.row - 1);
  let code = '';
  for (; value > 0n; value >>= 5n) code = ALPHABET[Number(value & 31n)] + code;
  return code.padStart(codeLength(cols), '0');
}

/** The criteria a code names, or null when it isn't a legal code for this season. Takes the game's chat text too ("...<CODE>..."). */
export function decodeShareCode(text: string, criteria: Criterion[], cols: number, phase: number): number[] | null {
  const wrapped = text.match(/<([^<>]*)>/);
  const code = (wrapped ? wrapped[1] : text).trim().toUpperCase();
  if (code.length !== codeLength(cols)) return null;
  let value = 0n;
  for (const ch of code) {
    const digit = ALPHABET.indexOf(ch);
    if (digit < 0) return null;
    value = value * 32n + BigInt(digit);
  }
  const ids: number[] = [];
  for (let bit = 0; value > 0n; bit++, value >>= 1n) {
    if (!(value & 1n)) continue;
    const col = Math.floor(bit / ROWS) + 1;
    const cell = criteria.find((c) => c.col === col && c.row === (bit % ROWS) + 1);
    if (!cell) return null;
    ids.push(cell.id);
  }
  return isLegal(criteria, ids, phase) ? ids : null;
}
