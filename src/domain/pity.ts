/**
 * Probability model for 6★ drops. Each pull has a base 6★ rate that climbs by
 * 5% per pull past soft pity and hits 100% at hard pity. A 6★ is the rate-up
 * with probability `rateUp`; otherwise pity resets and the chase continues.
 */
export interface PityProfile {
  hardPity: number;
  softPityStart: number;
  baseRate: number;
  rateUp: number;
}

export const CHARTERED: PityProfile = { hardPity: 80, softPityStart: 65, baseRate: 0.008, rateUp: 0.5 };
export const JOINT: PityProfile = { ...CHARTERED, rateUp: 1 };
export const WEAPON: PityProfile = { hardPity: 40, softPityStart: 40, baseRate: 0.04, rateUp: 0.25 };

/** Pulls into a Chartered banner that guarantee its rate-up, once per banner. */
export const CHARTERED_GUARANTEE = 120;
/** Pulls into a limited Arsenal Issue that guarantee its rate-up, once per banner. */
export const WEAPON_GUARANTEE = 80;

export const MAX_PULLS = 1500;

export function sixStarChance(p: PityProfile, pity: number): number {
  if (pity >= p.hardPity) return 1;
  const soft = pity > p.softPityStart ? 0.05 * (pity - p.softPityStart) : 0;
  return Math.min(1, p.baseRate + soft);
}

export interface PmfOptions {
  /** 6★ pity already banked before pull 1. Must be < hardPity: pity resets on hit, so hardPity is not a real state. */
  startPity?: number;
  /** Pull number (1-based) on which the rate-up is forced, if any. */
  guaranteeAt?: number | null;
  maxPulls?: number;
}

/** pmf[n] = probability that the first rate-up lands exactly on pull n. */
export function rateUpPmf(p: PityProfile, opts: PmfOptions = {}): Float64Array {
  const maxPulls = opts.maxPulls ?? MAX_PULLS;
  const start = Math.min(Math.max(opts.startPity ?? 0, 0), p.hardPity - 1);
  const guaranteeAt = opts.guaranteeAt ?? null;
  const pmf = new Float64Array(maxPulls + 1);
  let dp = new Float64Array(p.hardPity);
  dp[start] = 1;

  for (let n = 1; n <= maxPulls; n++) {
    const next = new Float64Array(p.hardPity);
    let hit = 0;
    for (let pity = 0; pity < p.hardPity; pity++) {
      const mass = dp[pity];
      if (mass === 0) continue;
      if (n === guaranteeAt) {
        hit += mass;
        continue;
      }
      const p6 = sixStarChance(p, pity + 1);
      hit += mass * p6 * p.rateUp;
      next[0] += mass * p6 * (1 - p.rateUp);
      if (pity + 1 < p.hardPity) next[pity + 1] += mass * (1 - p6);
    }
    pmf[n] = hit;
    dp = next;
  }
  return pmf;
}

/** Distribution of the sum of two independent waits, truncated to the shorter length. */
export function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const len = Math.min(a.length, b.length);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; i + j < len; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

export function cdfAt(pmf: Float64Array, n: number): number {
  let sum = 0;
  for (let i = 0; i <= Math.min(n, pmf.length - 1); i++) sum += pmf[i];
  return Math.min(sum, 1);
}

export function cumulative(pmf: Float64Array): Float64Array {
  const out = new Float64Array(pmf.length);
  let sum = 0;
  for (let i = 0; i < pmf.length; i++) out[i] = sum = Math.min(1, sum + pmf[i]);
  return out;
}

/** Smallest n with P(rate-up within n pulls) ≥ q, or null if never within the horizon. */
export function pullsForChance(pmf: Float64Array, q: number): number | null {
  let sum = 0;
  for (let i = 0; i < pmf.length; i++) {
    sum += pmf[i];
    if (sum >= q - 1e-12) return i;
  }
  return null;
}

/** Long-run 6★ rate per pull, i.e. 1 / E[pulls per 6★]. */
export function expectedSixStarRate(p: PityProfile): number {
  const anySix = rateUpPmf({ ...p, rateUp: 1 }, { maxPulls: p.hardPity });
  let mean = 0;
  anySix.forEach((v, i) => (mean += v * i));
  return 1 / mean;
}

const memo = new Map<string, Float64Array>();

/**
 * PMF of the pull on which the k-th rate-up copy lands. The first copy may start
 * from banked pity and carry the banner guarantee; later copies are fresh waits.
 */
export function kthCopyPmf(p: PityProfile, k: number, first: PmfOptions): Float64Array {
  const key = `${JSON.stringify(p)}|${k}|${first.startPity ?? 0}|${first.guaranteeAt ?? ''}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const result = k <= 1 ? rateUpPmf(p, first) : convolve(kthCopyPmf(p, k - 1, first), rateUpPmf(p));
  memo.set(key, result);
  return result;
}
