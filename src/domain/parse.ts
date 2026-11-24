import type { Kind, Pull, PullHistory, RawRecord } from './types';

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const truthy = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === '1';

/**
 * Rewards handed out by a banner are listed alongside the pulls but aren't
 * pulls: `gift_intel_book` (Headhunting Dossier), `gift_operator_token`
 * (Tokens), `gift_weapon` (Arsenal rate-up copies) and `gift_weapon_box`
 * (Selectors). Anything else `gift_*` is treated the same way.
 */
export function isGift(r: RawRecord): boolean {
  return typeof r.kind === 'string' && r.kind.startsWith('gift_');
}

export function parseTimestamp(v: unknown): number {
  const s = str(v).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return s.length <= 10 ? n * 1000 : n;
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? 0 : d;
}

const recordTs = (r: RawRecord): number => parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp);
const hasSeq = (r: RawRecord): boolean => str(r.seqId).trim() !== '';

/**
 * Time + item of a record. Not unique: every pull of a ten-pull shares one
 * time, so two identical 4★ in one ten-pull have the same group key. seqId is
 * left out on purpose, since some exporters omit it.
 */
function groupKey(r: RawRecord, kind: Kind): string {
  const item = str(kind === 'char' ? r.charId : r.weaponId) || str(r.itemId) || str(r.kind);
  return `${recordTs(r)}|${item}`;
}

/**
 * Identity of each record in a list: time + item + occurrence. The n-th record
 * (0-based, in list order) with a given time + item gets `ts|item|n`.
 */
export function recordKeys(list: RawRecord[], kind: Kind): string[] {
  const seen = new Map<string, number>();
  return list.map((r) => {
    const g = groupKey(r, kind);
    const n = seen.get(g) ?? 0;
    seen.set(g, n + 1);
    return `${g}|${n}`;
  });
}

/**
 * Repairs histories that hold the same pulls twice, once with seqIds and once
 * without (an old merge of a seqId-less export onto a seqId'd history). In a
 * time + item group that has records with a seqId, the ones without are dropped:
 * the seqId'd export is authoritative for that group.
 */
export function dropShadowedDuplicates(list: RawRecord[], kind: Kind): RawRecord[] {
  const withSeq = new Set<string>();
  for (const r of list) if (hasSeq(r)) withSeq.add(groupKey(r, kind));
  if (!withSeq.size) return list;
  const out = list.filter((r) => hasSeq(r) || !withSeq.has(groupKey(r, kind)));
  return out.length === list.length ? list : out;
}

/** `key` is unique per pull: seqId when the record has one, else its occurrence key. */
export function normalize(r: RawRecord, kind: Kind, occurrence?: string): Pull {
  const itemId = str(kind === 'char' ? r.charId : r.weaponId) || str(r.itemId);
  const name =
    str(kind === 'char' ? r.charName : r.weaponName) || str(r.nameText) || str(r.name) || itemId || 'Unknown';
  return {
    key: hasSeq(r) ? `${str(r.seqId)}|${groupKey(r, kind)}` : `|${occurrence ?? groupKey(r, kind)}`,
    kind,
    seq: Number(r.seqId) || 0,
    ts: recordTs(r),
    poolId: str(r.poolId).trim() || 'unknown',
    poolName: str(r.poolName).trim(),
    itemId,
    name,
    rarity: Number(r.rarity) || 0,
    isFree: truthy(r.isFree),
    isNew: truthy(r.isNew),
  };
}

/**
 * Oldest-first comparison of two records tagged with their list position. Ties
 * on time go by seq; when either lacks one (a ten-pull from an exporter without
 * seqIds), by position reversed, since stored and exported lists are newest first.
 */
const oldestFirst = <T extends { ts: number; seq: number }>(a: { v: T; i: number }, b: { v: T; i: number }): number =>
  a.v.ts - b.v.ts || (a.v.seq && b.v.seq ? a.v.seq - b.v.seq : b.i - a.i);

function sortOldestFirst<T extends { ts: number; seq: number }>(list: T[]): T[] {
  return list
    .map((v, i) => ({ v, i }))
    .sort(oldestFirst)
    .map((x) => x.v);
}

/** Oldest first. The API returns newest first, but don't rely on input order beyond ties. */
export function chronological(pulls: Pull[]): Pull[] {
  return sortOldestFirst(pulls);
}

/** A banner reward the export lists (Token, Arsenal rate-up copy, Dossier, Selector). */
export interface Gift {
  kind: Kind;
  /** The record's own kind: gift_operator_token, gift_weapon, ... */
  gift: string;
  poolId: string;
  ts: number;
  seq: number;
  /** "Si's Token", "Jade Vessel", "Headhunting Dossier"... */
  name: string;
}

/** Every reward record in the export, oldest first. Only newer banners list them. */
export function giftsOf(history: PullHistory): Gift[] {
  const out: Gift[] = [];
  for (const [kind, records] of [['char', history.characters], ['weap', history.weapons]] as const) {
    const gifts: Gift[] = [];
    for (const r of records) {
      if (!isGift(r)) continue;
      gifts.push({ kind, gift: str(r.kind), poolId: str(r.poolId).trim(), ts: recordTs(r), seq: Number(r.seqId) || 0, name: str(r.nameText) || str(r.name) });
    }
    out.push(...sortOldestFirst(gifts));
  }
  // Each kind is already in order; this only interleaves the two (stable).
  return out.sort((a, b) => a.ts - b.ts);
}

export function toPulls(history: PullHistory): { char: Pull[]; weap: Pull[] } {
  const list = (records: RawRecord[], kind: Kind) => {
    const pulls = records.filter((r) => !isGift(r));
    const keys = recordKeys(pulls, kind);
    return chronological(pulls.map((r, i) => normalize(r, kind, keys[i])));
  };
  return { char: list(history.characters, 'char'), weap: list(history.weapons, 'weap') };
}

/**
 * Accepts every shape people may have on disk: the exporter/eftracker
 * `{characters, weapons}` file, eftracker's settings-wrapped backup, or a bare
 * array of records (kind inferred per record). Throws on anything else.
 */
export function parseHistoryJson(text: string): PullHistory {
  let data: unknown = JSON.parse(text);
  if (data && typeof data === 'object' && 'efTrackerData' in data) {
    const inner = (data as { efTrackerData: unknown }).efTrackerData;
    data = typeof inner === 'string' ? JSON.parse(inner) : inner;
  }
  if (Array.isArray(data)) {
    const records = data.filter((r): r is RawRecord => !!r && typeof r === 'object');
    return {
      characters: records.filter((r) => 'charId' in r),
      weapons: records.filter((r) => 'weaponId' in r),
    };
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const characters = Array.isArray(d.characters) ? (d.characters as RawRecord[]) : null;
    const weapons = Array.isArray(d.weapons) ? (d.weapons as RawRecord[]) : null;
    if (characters || weapons) return { characters: characters ?? [], weapons: weapons ?? [] };
  }
  throw new Error('This file does not look like a pull history export (expected "characters" and "weapons" lists).');
}

export interface MergeResult {
  history: PullHistory;
  added: { char: number; weap: number };
}

/**
 * How many pulls in `from` are missing from `to` (banner rewards ignored), per
 * time + item: max(0, count in `from` − count in `to`). Both sides are repaired
 * with dropShadowedDuplicates first, so a copy holding old duplicates doesn't
 * block an upload forever. Drive sync refuses to upload when this is above 0:
 * the Drive copy's pulls may only ever grow.
 */
export function missingPulls(from: PullHistory | null | undefined, to: PullHistory | null | undefined): number {
  if (!from) return 0;
  let missing = 0;
  for (const [kind, a, b] of [
    ['char', from.characters, to?.characters ?? []],
    ['weap', from.weapons, to?.weapons ?? []],
  ] as [Kind, RawRecord[], RawRecord[]][]) {
    const count = (list: RawRecord[]) => {
      const m = new Map<string, number>();
      for (const r of dropShadowedDuplicates(list, kind)) {
        if (isGift(r)) continue;
        const g = groupKey(r, kind);
        m.set(g, (m.get(g) ?? 0) + 1);
      }
      return m;
    };
    const have = count(b);
    for (const [g, n] of count(a)) missing += Math.max(0, n - (have.get(g) ?? 0));
  }
  return missing;
}

/**
 * Union of two histories. The game only serves a limited window of history, so
 * merging each new export onto what's saved keeps older pulls forever.
 *
 * Records are matched on time + item + occurrence (see recordKeys), never on
 * seqId: per time + item group the result holds max(base, incoming) records,
 * all of the base's plus the incoming extras. An incoming record with a seqId
 * replaces its seqId-less match, so seqIds fill in. Duplicates left by older
 * merges are dropped (dropShadowedDuplicates). `added` counts incoming records
 * kept; repairs don't count.
 */
export function mergeHistories(base: PullHistory, incoming: PullHistory): MergeResult {
  const mergeList = (a: RawRecord[], b: RawRecord[], kind: Kind) => {
    const merged = [...dropShadowedDuplicates(a, kind)];
    const fromIncoming = new Set<RawRecord>();
    const at = new Map<string, number>();
    recordKeys(merged, kind).forEach((k, i) => at.set(k, i));
    const inc = dropShadowedDuplicates(b, kind);
    recordKeys(inc, kind).forEach((k, i) => {
      const r = inc[i];
      const j = at.get(k);
      if (j === undefined) {
        merged.push(r);
        fromIncoming.add(r);
      } else if (!hasSeq(merged[j]) && hasSeq(r)) {
        merged[j] = r;
      }
    });
    const kept = dropShadowedDuplicates(merged, kind);
    // Newest first, stable: same-time records without seqIds keep their order.
    const sorted = kept
      .map((r, i) => ({ r, i, ts: recordTs(r), seq: Number(r.seqId) || 0 }))
      .sort((x, y) => y.ts - x.ts || (x.seq && y.seq ? y.seq - x.seq : x.i - y.i))
      .map((x) => x.r);
    return { merged: sorted, added: kept.filter((r) => fromIncoming.has(r)).length };
  };
  const c = mergeList(base.characters, incoming.characters, 'char');
  const w = mergeList(base.weapons, incoming.weapons, 'weap');
  return { history: { characters: c.merged, weapons: w.merged }, added: { char: c.added, weap: w.added } };
}

// ---------------------------------------------------------------------------
// Is this the same player?
// ---------------------------------------------------------------------------

export interface HistoryMatch {
  /** same: the overlap agrees; different: it doesn't; noOverlap: no shared period to compare; empty: nothing saved yet. */
  verdict: 'same' | 'different' | 'noOverlap' | 'empty';
  /** Incoming pulls in the saved history's time span that are also saved... */
  shared: number;
  /** ...and those that aren't. */
  foreign: number;
}

/** Below this share of matching pulls in the shared period, a file is treated as another player's. */
export const SAME_PLAYER_SHARE = 0.9;

/**
 * Checks that an import comes from the same account as the saved history: two
 * exports of one account contain the very same pulls wherever their periods
 * overlap. Matches on time + item only, since some exporters omit seqId.
 */
export function compareHistories(saved: PullHistory | null, incoming: PullHistory): HistoryMatch {
  let shared = 0;
  let foreign = 0;
  let savedCount = 0;
  for (const [kind, a, b] of [
    ['char', saved?.characters ?? [], incoming.characters],
    ['weap', saved?.weapons ?? [], incoming.weapons],
  ] as [Kind, RawRecord[], RawRecord[]][]) {
    const pulls = a.filter((r) => !isGift(r));
    savedCount += pulls.length;
    if (!pulls.length) continue;
    const key = (r: RawRecord) => {
      const item = str(kind === 'char' ? r.charId : r.weaponId) || str(r.itemId) || str(r.nameText) || str(r.kind);
      return `${parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp)}|${item}`;
    };
    const times = pulls.map((r) => parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp));
    const from = Math.min(...times);
    const to = Math.max(...times);
    const known = new Set(pulls.map(key));
    for (const r of b) {
      if (isGift(r)) continue;
      const t = parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp);
      if (t < from || t > to) continue;
      if (known.has(key(r))) shared++;
      else foreign++;
    }
  }
  if (!savedCount) return { verdict: 'empty', shared, foreign };
  const inRange = shared + foreign;
  if (!inRange) return { verdict: 'noOverlap', shared, foreign };
  return { verdict: shared / inRange >= SAME_PLAYER_SHARE ? 'same' : 'different', shared, foreign };
}
