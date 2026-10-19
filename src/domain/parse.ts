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

/**
 * Identity of a record for de-duplicating merged imports. seqId is the API's own
 * per-kind sequence number; timestamp + item guard against legacy files without it.
 */
export function recordKey(r: RawRecord, kind: Kind): string {
  const item = str(kind === 'char' ? r.charId : r.weaponId) || str(r.itemId) || str(r.kind);
  return `${str(r.seqId)}|${parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp)}|${item}`;
}

export function normalize(r: RawRecord, kind: Kind): Pull {
  const itemId = str(kind === 'char' ? r.charId : r.weaponId) || str(r.itemId);
  const name =
    str(kind === 'char' ? r.charName : r.weaponName) || str(r.nameText) || str(r.name) || itemId || 'Unknown';
  return {
    key: recordKey(r, kind),
    kind,
    seq: Number(r.seqId) || 0,
    ts: parseTimestamp(r.gachaTs ?? r.ts ?? r.timestamp),
    poolId: str(r.poolId).trim() || 'unknown',
    poolName: str(r.poolName).trim(),
    itemId,
    name,
    rarity: Number(r.rarity) || 0,
    isFree: truthy(r.isFree),
    isNew: truthy(r.isNew),
  };
}

/** Oldest first. The API returns newest first, but don't rely on input order. */
export function chronological(pulls: Pull[]): Pull[] {
  return [...pulls].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

export function toPulls(history: PullHistory): { char: Pull[]; weap: Pull[] } {
  return {
    char: chronological(history.characters.filter((r) => !isGift(r)).map((r) => normalize(r, 'char'))),
    weap: chronological(history.weapons.filter((r) => !isGift(r)).map((r) => normalize(r, 'weap'))),
  };
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
 * Union of two histories. The game only serves a limited window of history, so
 * merging each new export onto what's saved keeps older pulls forever.
 */
/**
 * How many pulls in `from` are missing from `to` (banner rewards ignored).
 * Drive sync refuses to upload when this is above 0: the Drive copy's pulls
 * may only ever grow.
 */
export function missingPulls(from: PullHistory | null | undefined, to: PullHistory | null | undefined): number {
  if (!from) return 0;
  let missing = 0;
  for (const [kind, a, b] of [
    ['char', from.characters, to?.characters ?? []],
    ['weap', from.weapons, to?.weapons ?? []],
  ] as [Kind, RawRecord[], RawRecord[]][]) {
    const have = new Set(b.map((r) => recordKey(r, kind)));
    for (const r of a) if (!isGift(r) && !have.has(recordKey(r, kind))) missing++;
  }
  return missing;
}

export function mergeHistories(base: PullHistory, incoming: PullHistory): MergeResult {
  const mergeList = (a: RawRecord[], b: RawRecord[], kind: Kind) => {
    const seen = new Set(a.map((r) => recordKey(r, kind)));
    const fresh = b.filter((r) => {
      const k = recordKey(r, kind);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const merged = [...a, ...fresh].sort(
      (x, y) =>
        parseTimestamp(y.gachaTs ?? y.ts) - parseTimestamp(x.gachaTs ?? x.ts) ||
        (Number(y.seqId) || 0) - (Number(x.seqId) || 0),
    );
    return { merged, added: fresh.length };
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
