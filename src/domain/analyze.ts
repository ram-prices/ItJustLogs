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
import { giftsOf, toPulls, type Gift } from './parse';
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

export interface RewardMilestone {
  /** Pull (or Arsenal set) the reward lands on. */
  at: number;
  name: string;
  /** Whether this reward is a copy of the rate-up. */
  copy: boolean;
}

export interface RewardTrack {
  label: string;
  /** Pulls (Arsenal: sets) made toward the next reward. */
  progress: number;
  /** Pulls (Arsenal: sets) between the previous reward and the next one. */
  goal: number;
  /** Rewards already earned. */
  earned: number;
  /** Of those, how many were copies of the rate-up. */
  copies: number;
  nextReward: string;
  /** Every reward point from the first up to `upTo`, in order. */
  milestones(upTo: number): RewardMilestone[];
}

/** A reward every `every` pulls (Chartered Token, Joint Selector). */
function fixedRewards(label: string, every: number, done: number, copy: boolean): RewardTrack {
  const earned = Math.floor(done / every);
  return {
    label,
    progress: done % every,
    goal: every,
    earned,
    copies: copy ? earned : 0,
    nextReward: label,
    milestones: (upTo) => Array.from({ length: Math.floor(upTo / every) }, (_, i) => ({ at: (i + 1) * every, name: label, copy })),
  };
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
  /** Banner rewards the export lists (newer banners only), oldest first. */
  gifts: Gift[];
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
 * Arsenal Issues are pulled in sets of 10, and the game counts each set as one
 * "pull": 6★ pity is out of 4 sets, the rate-up guarantee lands on the 8th set,
 * and rewards start on the 10th (see weaponRewards). Weapon pity, guarantee and rewards are
 * all measured in sets.
 */
export const WEAPON_SET = 10;
export const WEAPON_PITY_SETS = 4;
export const WEAPON_GUARANTEE_SETS = WEAPON_GUARANTEE / WEAPON_SET; // 8
export const setOf = (pull: number) => Math.ceil(pull / WEAPON_SET);

/**
 * Arsenal Issue milestone rewards, in sets: a Selector on the 10th set (it
 * offers weapons other than the rate-up), then every 8 sets alternating a
 * rate-up copy and a Selector: 18 copy, 26 Selector, 34 copy, ...
 * (The 8th-set rate-up guarantee is separate: it's a pull, not a reward.)
 */
const WEAPON_FIRST_REWARD = 10;
const WEAPON_REWARD_EVERY = 8;
const weaponMilestone = (i: number): RewardMilestone => ({
  at: WEAPON_FIRST_REWARD + i * WEAPON_REWARD_EVERY,
  name: i % 2 === 0 ? 'Selector' : 'Rate-up copy',
  copy: i % 2 === 1,
});

function weaponRewards(sets: number): RewardTrack {
  const earned = sets < WEAPON_FIRST_REWARD ? 0 : 1 + Math.floor((sets - WEAPON_FIRST_REWARD) / WEAPON_REWARD_EVERY);
  const prevAt = earned === 0 ? 0 : weaponMilestone(earned - 1).at;
  const next = weaponMilestone(earned);
  return {
    label: 'Issue rewards',
    progress: sets - prevAt,
    goal: next.at - prevAt,
    earned,
    copies: Math.floor(earned / 2),
    nextReward: next.name,
    milestones: (upTo) => {
      const out: RewardMilestone[] = [];
      for (let i = 0; weaponMilestone(i).at <= upTo; i++) out.push(weaponMilestone(i));
      return out;
    },
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
    // Arsenal: the set that held the latest 6★, and the one before it (for a second 6★ in the same set).
    const lastSixSet = new Map<string, number>();
    const prevSixSet = new Map<string, number>();

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
          pity: { label: '6★ pity', value: 0, max: category === 'newHorizons' ? 40 : kind === 'weap' ? WEAPON_PITY_SETS : 80 },
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
        if (kind === 'weap') {
          // Pity in sets since the set that held the last 6★.
          const set = setOf(b.paidPulls);
          const last = lastSixSet.get(scope) ?? 0;
          if (p.rarity === 6) {
            const base = last === set ? (prevSixSet.get(scope) ?? 0) : last;
            ap.pity = set - base;
            if (last !== set) {
              prevSixSet.set(scope, last);
              lastSixSet.set(scope, set);
            }
          } else {
            ap.pity = set - last;
          }
        } else {
          const current = (pity.get(scope) ?? 0) + 1;
          ap.pity = current;
          pity.set(scope, current);
        }

        if (p.rarity === 6) {
          pity.set(scope, 0);
          const profile = profileFor(category);
          if (b.info && profile) {
            const alreadyWon = wonOnBanner.get(b.poolId) ?? false;
            if (isRateUp) {
              const guaranteed =
                !alreadyWon &&
                ((category === 'chartered' && b.paidPulls >= CHARTERED_GUARANTEE) ||
                  // Every Arsenal Issue with a rate-up, Constant Issues too: the 8th set.
                  (kind === 'weap' && b.paidPulls > WEAPON_GUARANTEE - 10));
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
      if (b.kind === 'weap') {
        // Sets completed since the set that held the last 6★.
        const lastSix = [...b.pulls].reverse().find((x) => x.rarity === 6 && x.bannerPull !== null);
        b.pity.value = setOf(b.paidPulls) - (lastSix ? setOf(lastSix.bannerPull!) : 0);
      } else {
        b.pity.value = lastPaid ? (lastPaid.rarity === 6 ? 0 : lastPaid.pity!) : b.startPity;
      }
      if (b.category === 'newHorizons' && b.pulls.some((x) => x.rarity === 6)) b.pity.done = true;

      const won = wonOnBanner.get(b.poolId) ?? false;
      if (b.category === 'chartered' && b.info) {
        b.guarantee = {
          label: 'Rate-up guarantee',
          value: won ? CHARTERED_GUARANTEE : Math.min(b.paidPulls, CHARTERED_GUARANTEE),
          max: CHARTERED_GUARANTEE,
          done: won,
        };
        // Each Token is a copy of the rate-up.
        b.rewards = fixedRewards('Token', 240, b.paidPulls, true);
      } else if (b.category === 'joint') {
        // A Joint Selector picks one of the banner's rate-ups.
        b.rewards = fixedRewards('Selector', 120, b.paidPulls, true);
      } else if (b.kind === 'weap') {
        if (b.info) {
          b.guarantee = {
            label: 'Rate-up guarantee',
            value: won ? WEAPON_GUARANTEE_SETS : Math.min(setOf(b.paidPulls), WEAPON_GUARANTEE_SETS),
            max: WEAPON_GUARANTEE_SETS,
            done: won,
          };
        }
        b.rewards = weaponRewards(setOf(b.paidPulls));
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
    gifts: giftsOf(history),
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
    guaranteeAt: b.category === 'chartered' ? CHARTERED_GUARANTEE : b.kind === 'weap' && b.info ? WEAPON_GUARANTEE : null,
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
