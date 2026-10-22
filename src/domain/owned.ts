import { setOf, WEAPON_SET, type Analysis, type AnalyzedPull, type BannerSummary } from './analyze';
import { canonicalPoolId } from './banners';
import type { Kind } from './types';
import { wikiId } from './wiki';

/**
 * What the player owns of each operator or weapon, as far as the imported pull
 * history shows: every pull of it (free pulls included: they still give the
 * item) plus banner reward copies (Chartered Tokens, Arsenal Issue rate-up
 * copies). Selectors are left out: the history doesn't say what was picked.
 * Operators and weapons both turn duplicates into Potential, 0 to 5, so the
 * 6th copy maxes it and anything after is spare.
 *
 * Reward copies come from the export's own reward records (`gift_operator_token`,
 * `gift_weapon`) where it lists them, which newer banners do. Older banners'
 * rewards aren't in the export, so those are estimated from the pull count
 * (analyze.ts' reward schedule) and marked `estimated`.
 *
 * Extra copies are the ones no export can show: story operators everyone has
 * (Endministrator, Chen Qianyu, Perlica) and event gifts. The player lists
 * them in Settings; they live in settings (so backups and Drive sync carry
 * them), never in the pull history, which stays exactly what was imported.
 */

/** Copies of something the player got outside of pulls and banner rewards. */
export interface ExtraCopy {
  /** Wiki/ef-assets id: chr_... or wpn_... */
  id: string;
  copies: number;
  /** Where they came from: "Story", "Purry Big Feline! RAWR!" */
  note: string;
}

/** Everyone has these from the story, at least at P0. Used until the player edits the list. */
export const DEFAULT_EXTRAS: ExtraCopy[] = [
  { id: 'chr_0003_endminf', copies: 1, note: 'Story' },
  { id: 'chr_0005_chen', copies: 1, note: 'Story' },
  { id: 'chr_0004_pelica', copies: 1, note: 'Story' },
];

/** Ready-made extras the Settings card offers. */
export const EXTRA_PRESETS: { key: string; label: string; extras: ExtraCopy[] }[] = [
  { key: 'story', label: 'Story operators', extras: DEFAULT_EXTRAS },
  {
    key: 'purrchena',
    label: 'Purry Big Feline! RAWR! (Purrchena and Dessert Moment, maxed)',
    extras: [
      { id: 'chr_0038_purrche', copies: 6, note: 'Purry Big Feline! RAWR!' },
      { id: 'wpn_sword_0023', copies: 6, note: 'Purry Big Feline! RAWR!' },
    ],
  },
  {
    key: 'awakening',
    label: 'Awakening Sign-In (Ardelia and Dreams of the Starry Beach)',
    extras: [
      { id: 'chr_0025_ardelia', copies: 1, note: 'Awakening Sign-In' },
      { id: 'wpn_funnel_0013', copies: 1, note: 'Awakening Sign-In' },
    ],
  },
  {
    key: 'tribute',
    label: 'Tribute of Companionship Sign-In (Farsight)',
    extras: [{ id: 'wpn_sword_0026', copies: 1, note: 'Tribute of Companionship' }],
  },
];

/** The note on Protocol Pass weapons (Settings → Extra copies' quick add, built from the wiki's sources). */
export const PROTOCOL_PASS = 'Protocol Pass';
/** The note on the 3★ weapons (quick add: every one the wiki lists, maxed). */
export const THREE_STAR_WEAPONS = '3★ weapons';

export const extraKind = (id: string): Kind => (id.startsWith('wpn_') ? 'weap' : 'char');

/**
 * The two Endministrators (the player picks one at the start). They're one
 * operator: copies of either count for both, and the player keeps one of them
 * in their extras.
 */
export const ENDMINISTRATORS = ['chr_0003_endminf', 'chr_0002_endminm'];
export const isEndministrator = (id: string): boolean => ENDMINISTRATORS.includes(id);

/** The Endministrator the player's extras name, if any. */
export const endministratorOf = (extras: ExtraCopy[]): string | null => extras.find((x) => isEndministrator(x.id))?.id ?? null;

/** The player's extras: their list, or the story operators until they've edited it. */
export const extrasOf = (settings: { extras?: ExtraCopy[] }): ExtraCopy[] => settings.extras ?? DEFAULT_EXTRAS;

export const MAX_POTENTIAL = 5;
/** Copies that reach max Potential. */
export const MAX_COPIES = MAX_POTENTIAL + 1;

/** One copy coming in: a pull, or a reward earned on a banner. */
export interface Acquisition {
  ts: number;
  /** Sort key within the same timestamp (a reward lands just after the pull that earned it). */
  seq: number;
  poolId: string;
  bannerName: string;
  /** The pull itself; for an estimated reward, the pull that earned it (if it's in the history). */
  pull: AnalyzedPull | null;
  /** Set for rewards: "Token", "Rate-up copy". */
  reward: string | null;
  /** A reward worked out from the pull count, for banners whose rewards the export doesn't list. */
  estimated?: boolean;
  /** An extra copy from Settings (story, event gift): no date, `bannerName` holds its note. */
  extra?: boolean;
  /** 1 for the first copy, 2 for the second... */
  copy: number;
}

export interface Owned {
  /** Every copy, oldest first. */
  acquisitions: Acquisition[];
  /** Pulls + reward copies. */
  copies: number;
  /** Of which pulled (the rest are rewards and extras). */
  pulled: number;
  /** Of which extra copies from Settings. */
  extra: number;
  /** Potential those copies reach (copies − 1, at most 5); −1 if none. */
  potential: number;
  /** Copies beyond what max Potential uses. */
  spare: number;
  /** The copy that maxed Potential (the 6th), if any. */
  maxed: Acquisition | null;
  /** Joint Selectors earned on banners where this was one of the rate-ups (may or may not have gone to it). */
  selectors: number;
}

const empty = (): Owned => ({ acquisitions: [], copies: 0, pulled: 0, extra: 0, potential: -1, spare: 0, maxed: null, selectors: 0 });

/** Reward records that are a copy of something. */
const COPY_GIFT: Record<Kind, string> = { char: 'gift_operator_token', weap: 'gift_weapon' };
const REWARD_LABEL: Record<Kind, string> = { char: 'Token', weap: 'Rate-up copy' };

type NewAcquisition = Omit<Acquisition, 'copy'>;

/** Rate-up copies a banner's reward schedule says it paid out, each dated by the pull that earned it. */
function estimatedRewards(b: BannerSummary): NewAcquisition[] {
  const r = b.rewards;
  if (!r?.copies) return [];
  const weap = b.kind === 'weap';
  return r
    .milestones(weap ? setOf(b.paidPulls) : b.paidPulls)
    .filter((m) => m.copy)
    .map((m) => {
      // Arsenal rewards land on finishing a set: its 10th pull.
      const at = weap ? m.at * WEAPON_SET : m.at;
      const pull = b.pulls.find((p) => p.bannerPull === at) ?? null;
      return {
        ts: pull?.ts ?? b.lastTs,
        seq: (pull?.seq ?? Number.MAX_SAFE_INTEGER - 1) + 0.5,
        poolId: b.poolId,
        bannerName: b.name,
        pull,
        reward: REWARD_LABEL[b.kind],
        estimated: true,
      };
    });
}

/**
 * Ownership of every item of `kind`, keyed by wiki/ef-assets id (see `wikiId`).
 * `a` null: no import yet, so only the extras count.
 */
export function ownedItems(a: Analysis | null, kind: Kind, extras: ExtraCopy[] = []): Map<string, Owned> {
  const out = new Map<string, Owned>();
  const get = (id: string) => {
    const key = wikiId(id);
    let o = out.get(key);
    if (!o) {
      o = empty();
      // Both Endministrators share one record, so either page shows the same copies.
      for (const k of isEndministrator(key) ? ENDMINISTRATORS : [key]) out.set(k, o);
    }
    return o;
  };

  // Names → ids from every pull, to place a reward record ("Si's Token", "Jade Vessel").
  const idByName = new Map<string, string>();
  for (const b of a?.banners ?? []) if (b.kind === kind) for (const p of b.pulls) if (p.itemId) idByName.set(p.name.trim().toLowerCase(), p.itemId);
  // Pools whose rewards the export lists (any reward record at all).
  const gifts = (a?.gifts ?? []).filter((g) => g.kind === kind);
  const listed = new Set(gifts.map((g) => canonicalPoolId(g.poolId)));
  const banners = new Map((a?.banners ?? []).filter((b) => b.kind === kind).map((b) => [b.poolId, b]));

  // Extras come first: story operators are there from the start, and event
  // gifts have no date to place them by.
  extras.forEach((x, i) => {
    if (extraKind(x.id) !== kind) return;
    for (let n = 0; n < Math.max(0, Math.floor(x.copies)); n++) {
      get(x.id).acquisitions.push({ ts: 0, seq: i * 100 + n - 1e9, poolId: '', bannerName: x.note || 'Extra copy', pull: null, reward: null, extra: true, copy: 0 });
    }
  });

  for (const b of banners.values()) {
    for (const p of b.pulls) {
      if (p.itemId) get(p.itemId).acquisitions.push({ ts: p.ts, seq: p.seq, poolId: b.poolId, bannerName: b.name, pull: p, reward: null, copy: 0 });
    }
    const ids = b.info?.rateUpIds ?? [];
    // Estimated reward copies, only where the export is silent and the banner has one rate-up to give.
    if (!listed.has(b.poolId) && ids.length === 1) for (const acq of estimatedRewards(b)) get(ids[0]).acquisitions.push({ ...acq, copy: 0 });
    // Joint Selectors pick one of the banner's rate-ups (Arsenal Selectors pick
    // from the non-rate-up weapons, so they're no one's in particular).
    const r = b.rewards;
    if (r?.label === 'Selector' && ids.length > 1 && r.earned) for (const id of ids) get(id).selectors += r.earned;
  }

  for (const g of gifts) {
    if (g.gift !== COPY_GIFT[kind]) continue;
    const poolId = canonicalPoolId(g.poolId);
    const b = banners.get(poolId);
    const name = g.name.replace(/[’']s Token$/i, '').trim().toLowerCase();
    const ids = b?.info?.rateUpIds ?? [];
    const id = idByName.get(name) ?? (ids.length === 1 ? ids[0] : undefined);
    if (!id) continue;
    get(id).acquisitions.push({ ts: g.ts, seq: g.seq, poolId, bannerName: b?.name ?? g.poolId, pull: null, reward: REWARD_LABEL[kind], copy: 0 });
  }

  for (const o of new Set(out.values())) {
    o.acquisitions.sort((x, y) => x.ts - y.ts || x.seq - y.seq);
    o.acquisitions.forEach((acq, i) => (acq.copy = i + 1));
    o.copies = o.acquisitions.length;
    o.pulled = o.acquisitions.filter((x) => !x.reward && !x.extra).length;
    o.extra = o.acquisitions.filter((x) => x.extra).length;
    o.potential = o.copies ? Math.min(o.copies - 1, MAX_POTENTIAL) : -1;
    o.spare = Math.max(0, o.copies - MAX_COPIES);
    o.maxed = o.acquisitions[MAX_COPIES - 1] ?? null;
  }
  return out;
}
