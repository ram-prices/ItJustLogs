import {
  CATEGORY_LABEL,
  categoryOf,
  canonicalPoolId,
  isRateUpItem,
  lookupBanner,
  patchOf,
  type BannerInfo,
  type PatchRef,
} from './banners';
import { toPulls } from './parse';
import {
  CHARTERED,
  CHARTERED_GUARANTEE,
  JOINT,
  WEAPON,
  WEAPON_GUARANTEE,
  cdfAt,
  expectedSixStarRate,
  kthCopyPmf,
  type PityProfile,
} from './pity';
import type { BannerDb, Category, Kind, Outcome, Pull, PullHistory } from './types';

export interface AnalyzedPull extends Pull {
  /** nth paid pull on this banner; null for free pulls. */
  bannerPull: number | null;
  /** 6★ pity counter at this pull (pulls since the last 6★, inclusive); null for free pulls. */
  pity: number | null;
  isRateUp: boolean;
  outcome?: Outcome;
  /** Which rate-up copy on this banner this pull was. */
  copy?: number;
  /** P(at least `copy` rate-up copies within `bannerPull` pulls) — how lucky this was. Lower = luckier. */
  luck?: number;
  bannerName: string;
}

export interface RewardTrack {
  label: string;
  /** Pulls made toward the next reward. */
  progress: number;
  /** Pulls needed for the next reward. */
  goal: number;
  earned: number;
  nextReward: string;
}

export interface Meter {
  label: string;
  value: number;
  max: number;
  done?: boolean;
}

export interface BannerSummary {
  poolId: string;
  kind: Kind;
  category: Category;
  name: string;
  patch: PatchRef;
  info: BannerInfo | null;
  pulls: AnalyzedPull[];
  paidPulls: number;
  freePulls: number;
  firstTs: number;
  lastTs: number;
  /** 6★ pity carried in from earlier banners of the same category. */
  startPity: number;
  pity: Meter;
  guarantee: Meter | null;
  rewards: RewardTrack | null;
  rateUpCopies: number;
  /** Most recent banner of its category — its pity is the player's live pity. */
  isLatest: boolean;
}

export interface KindStats {
  pulls: number;
  sixStars: number;
  fiveStars: number;
  freePulls: number;
  won: number;
  lost: number;
  guaranteed: number;
  rate: number;
  expectedRate: number;
  /** Probability of winning a rate-up coin flip on this kind of banner (0.5 or 0.25). */
  expectedWinRate: number;
  uniqueItems: number;
}

export interface Analysis {
  banners: BannerSummary[];
  char: KindStats;
  weap: KindStats;
  /** All 6★ pulls, oldest first. */
  sixStars: AnalyzedPull[];
  firstTs: number;
  lastTs: number;
}

const EXPECTED_CHAR_RATE = expectedSixStarRate(CHARTERED);
const EXPECTED_WEAP_RATE = expectedSixStarRate(WEAPON);

function profileFor(category: Category): PityProfile | null {
  if (category === 'chartered') return CHARTERED;
  if (category === 'joint') return JOINT;
  if (category === 'limited' || category === 'constant') return WEAPON;
  return null;
}

/** 6★ pity is shared by every Chartered banner; other character pools keep their own. Weapons are per banner. */
function pityScope(kind: Kind, category: Category, poolId: string): string {
  if (kind === 'weap' || category === 'joint') return `${kind}:${poolId}`;
  return `${kind}:${category}`;
}

/**
 * Arsenal Issue milestone rewards: a selector box at 100 pulls, then every 80
 * pulls alternating rate-up copy and selector.
 */
function weaponRewards(paid: number): RewardTrack {
  const FIRST = 100;
  const EVERY = 80;
  const earned = paid < FIRST ? 0 : 1 + Math.floor((paid - FIRST) / EVERY);
  const prev = earned === 0 ? 0 : FIRST + (earned - 1) * EVERY;
  const goal = earned === 0 ? FIRST : EVERY;
  return {
    label: 'Issue rewards',
    progress: paid - prev,
    goal,
    earned,
    nextReward: earned % 2 === 0 ? 'Selector' : 'Rate-up copy',
  };
}

export function analyze(history: PullHistory, db: BannerDb): Analysis {
  const { char, weap } = toPulls(history);
  const banners = new Map<string, BannerSummary>();
  const sixStars: AnalyzedPull[] = [];

  for (const [kind, pulls] of [
    ['char', char],
    ['weap', weap],
  ] as const) {
    const pity = new Map<string, number>();
    const wonOnBanner = new Map<string, boolean>();

    for (const p of pulls) {
      const poolId = canonicalPoolId(p.poolId);
      const category = categoryOf(kind, poolId);
      const scope = pityScope(kind, category, poolId);
      let b = banners.get(`${kind}:${poolId}`);
      if (!b) {
        const info = lookupBanner(db, poolId);
        b = {
          poolId,
          kind,
          category,
          name: p.poolName || db[poolId]?.name || CATEGORY_LABEL[category],
          patch: patchOf(poolId),
          info: info && info.rateUpIds.length ? info : null,
          pulls: [],
          paidPulls: 0,
          freePulls: 0,
          firstTs: p.ts,
          lastTs: p.ts,
          startPity: pity.get(scope) ?? 0,
          pity: { label: '6★ pity', value: 0, max: category === 'newHorizons' ? 40 : kind === 'weap' ? 40 : 80 },
          guarantee: null,
          rewards: null,
          rateUpCopies: 0,
          isLatest: false,
        };
        banners.set(`${kind}:${poolId}`, b);
      }
      b.lastTs = p.ts;
      const isRateUp = isRateUpItem(b.info, p.itemId, p.name);
      const ap: AnalyzedPull = { ...p, poolId, bannerPull: null, pity: null, isRateUp, bannerName: b.name };

      if (p.isFree) {
        b.freePulls++;
      } else {
        b.paidPulls++;
        ap.bannerPull = b.paidPulls;
        const current = (pity.get(scope) ?? 0) + 1;
        ap.pity = current;
        pity.set(scope, current);

        if (p.rarity === 6) {
          pity.set(scope, 0);
          const profile = profileFor(category);
          if (b.info && profile) {
            const alreadyWon = wonOnBanner.get(b.poolId) ?? false;
            if (isRateUp) {
              const guaranteed =
                !alreadyWon &&
                ((category === 'chartered' && b.paidPulls >= CHARTERED_GUARANTEE) ||
                  (category === 'limited' && b.paidPulls > WEAPON_GUARANTEE - 10));
              ap.outcome = guaranteed ? 'guaranteed' : 'won';
              ap.copy = ++b.rateUpCopies;
              wonOnBanner.set(b.poolId, true);
              const pmf = copyPmf(b, ap.copy)!;
              // Arsenal pulls come in tens, so judge luck at the end of the ten-pull.
              const at = kind === 'weap' ? Math.ceil(b.paidPulls / 10) * 10 : b.paidPulls;
              ap.luck = cdfAt(pmf, at);
            } else if (category !== 'joint') {
              ap.outcome = 'lost';
            }
          }
        }
      }
      if (p.rarity === 6) sixStars.push(ap);
      b.pulls.push(ap);
    }

    // Final meters per banner.
    const latestByCategory = new Map<string, BannerSummary>();
    for (const b of banners.values()) {
      if (b.kind !== kind) continue;
      // Pity as of this banner's last paid pull.
      const lastPaid = [...b.pulls].reverse().find((x) => x.pity !== null);
      b.pity.value = lastPaid ? (lastPaid.rarity === 6 ? 0 : lastPaid.pity!) : b.startPity;
      if (b.category === 'newHorizons' && b.pulls.some((x) => x.rarity === 6)) b.pity.done = true;

      const won = wonOnBanner.get(b.poolId) ?? false;
      if (b.category === 'chartered' && b.info) {
        b.guarantee = {
          label: 'Rate-up guarantee',
          value: won ? CHARTERED_GUARANTEE : Math.min(b.paidPulls, CHARTERED_GUARANTEE),
          max: CHARTERED_GUARANTEE,
          done: won,
        };
        b.rewards = {
          label: 'Bonus copy',
          progress: b.paidPulls % 240,
          goal: 240,
          earned: Math.floor(b.paidPulls / 240),
          nextReward: 'Rate-up copy',
        };
      } else if (b.category === 'joint') {
        b.rewards = {
          label: 'Selector',
          progress: b.paidPulls % 120,
          goal: 120,
          earned: Math.floor(b.paidPulls / 120),
          nextReward: 'Selector',
        };
      } else if (b.kind === 'weap') {
        if (b.category === 'limited' && b.info) {
          b.guarantee = {
            label: 'Rate-up guarantee',
            value: won ? WEAPON_GUARANTEE : Math.min(b.paidPulls, WEAPON_GUARANTEE),
            max: WEAPON_GUARANTEE,
            done: won,
          };
        }
        b.rewards = weaponRewards(b.paidPulls);
      }
      const prev = latestByCategory.get(b.category);
      if (!prev || b.lastTs >= prev.lastTs) latestByCategory.set(b.category, b);
    }
    for (const b of latestByCategory.values()) b.isLatest = true;
  }

  const list = [...banners.values()].sort((a, b) => a.firstTs - b.firstTs);
  const stats = (kind: Kind, pulls: Pull[]): KindStats => {
    const mine = sixStars.filter((s) => s.kind === kind && !s.isFree);
    const paid = pulls.filter((p) => !p.isFree);
    const s: KindStats = {
      pulls: paid.length,
      sixStars: mine.length,
      fiveStars: paid.filter((p) => p.rarity === 5).length,
      freePulls: pulls.length - paid.length,
      won: mine.filter((x) => x.outcome === 'won').length,
      lost: mine.filter((x) => x.outcome === 'lost').length,
      guaranteed: mine.filter((x) => x.outcome === 'guaranteed').length,
      rate: paid.length ? mine.length / paid.length : 0,
      expectedRate: kind === 'char' ? EXPECTED_CHAR_RATE : EXPECTED_WEAP_RATE,
      expectedWinRate: kind === 'char' ? CHARTERED.rateUp : WEAPON.rateUp,
      uniqueItems: new Set(pulls.map((p) => p.itemId).filter(Boolean)).size,
    };
    return s;
  };

  const all = [...char, ...weap];
  return {
    banners: list,
    char: stats('char', char),
    weap: stats('weap', weap),
    sixStars: sixStars.sort((a, b) => a.ts - b.ts || a.seq - b.seq),
    firstTs: all.length ? Math.min(...all.map((p) => p.ts)) : 0,
    lastTs: all.length ? Math.max(...all.map((p) => p.ts)) : 0,
  };
}

/** The distribution a banner's `copy`-th rate-up was judged against (for drawing its luck curve). */
export function copyPmf(b: BannerSummary, copy: number): Float64Array | null {
  const profile = profileFor(b.category);
  if (!profile) return null;
  return kthCopyPmf(profile, copy, {
    startPity: b.category === 'chartered' ? b.startPity : 0,
    guaranteeAt: b.category === 'chartered' ? CHARTERED_GUARANTEE : b.category === 'limited' ? WEAPON_GUARANTEE : null,
  });
}

/** How a win rate or drop rate compares to what the odds predict. */
export type LuckTier = 'very-lucky' | 'lucky' | 'average' | 'unlucky' | 'very-unlucky';

export function luckTier(actual: number, expected: number): LuckTier {
  const r = expected ? actual / expected : 1;
  if (r >= 1.25) return 'very-lucky';
  if (r > 1.05) return 'lucky';
  if (r >= 0.9) return 'average';
  if (r >= 0.7) return 'unlucky';
  return 'very-unlucky';
}

export const LUCK_LABEL: Record<LuckTier, string> = {
  'very-lucky': 'Very lucky',
  lucky: 'Lucky',
  average: 'Average',
  unlucky: 'Unlucky',
  'very-unlucky': 'Very unlucky',
};
