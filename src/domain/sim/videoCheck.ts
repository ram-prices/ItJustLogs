/**
 * A replay against the video it was read from: where the sim's damage or Stagger first parts from the boss's bars
 * in the video (the parser's `boss` readings), so the player can look there and fix the transcript.
 */

import type { ReplayResult } from './team';

/** Seconds per bin when fitting: wide enough that a hit the sim lands a second early or late stays in its bin. */
const FIT_BIN = 2;

/**
 * The replay with the recording's own damage: each FIT_BIN seconds' damage from the boss's HP bar (the game's rolls,
 * crits and all), split among the sim's hits of those seconds as the sim split them. Stretches the bar wasn't read
 * keep the sim's damage; damage where the sim made no hit goes to the nearest stretch it did, else is
 * `unattributed` (an action the transcript lacks).
 */
export function fitToRecording(r: ReplayResult, boss: [number, number, number][], pauses: [number, number][], phaseHp: number): { result: ReplayResult; unattributed: number; afterKill: number; scaleAt: (second: number) => number } {
  const per = r.perSecond;
  if (!per || !boss.length || !phaseHp) return { result: r, unattributed: 0, afterKill: 0, scaleAt: () => 1 };
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  // The game's damage each second of the fight's clock, phases refilling the bar.
  const game: number[] = [];
  const read: boolean[] = [];
  let last = 1;
  let lastT = -Infinity;
  for (const [t, hp] of boss) {
    if (pauses.some(([a, b]) => t >= a && t < b)) continue;
    if (t - lastT > 2 && hp > last + 0.3) last = 1;
    const k = Math.floor(clock(t));
    while (game.length <= k) {
      game.push(0);
      read.push(false);
    }
    game[k] += Math.max(0, last - hp) * phaseHp;
    read[k] = true;
    last = Math.min(last, hp);
    lastT = t;
  }
  // Per bin: the sim's hits summed, the game's damage, whether the bar was read.
  const bins = Math.ceil(Math.max(per.length, game.length) / FIT_BIN);
  const simBin: Record<string, number>[] = [];
  const gameBin: number[] = [];
  const readBin: boolean[] = [];
  for (let b = 0; b < bins; b++) {
    const sum: Record<string, number> = {};
    let g = 0;
    let rd = false;
    for (let k = b * FIT_BIN; k < (b + 1) * FIT_BIN; k++) {
      for (const [key, v] of Object.entries(per[k] ?? {})) sum[key] = (sum[key] ?? 0) + v;
      g += game[k] ?? 0;
      rd ||= !!read[k];
    }
    simBin.push(sum);
    gameBin.push(g);
    readBin.push(rd);
  }
  // Game damage where the sim hit nothing: to the nearest bin with hits (the one before, else after). Left over: damage
  // after the sim's boss died (it hits nothing more until the fight's end or the next phase), else an action the
  // transcript lacks.
  const want = gameBin.slice();
  let unattributed = 0;
  let afterKill = 0;
  const phaseBins = pauses.map(([a]) => Math.floor(clock(a) / FIT_BIN)).sort((x, y) => x - y);
  const hits = (b: number) => Object.keys(simBin[b] ?? {}).length > 0;
  const quietFrom = (b: number) => {
    const stop = phaseBins.find((p) => p > b) ?? bins;
    for (let x = b; x < stop; x++) if (hits(x)) return false;
    return true;
  };
  for (let b = 0; b < bins; b++) {
    if (!readBin[b] || hits(b) || !want[b]) continue;
    const to = [b - 1, b + 1, b - 2, b + 2].find((x) => x >= 0 && x < bins && readBin[x] && hits(x));
    if (to !== undefined) want[to] += want[b];
    else if (quietFrom(b)) afterKill += want[b];
    else unattributed += want[b];
    want[b] = 0;
  }
  const fitted: Record<string, number>[] = [];
  // Each bin's one factor (every hit in it scaled alike), for scaling one action's damage as the totals are.
  const scales: number[] = [];
  for (let b = 0; b < bins; b++) {
    const sim = simBin[b];
    const simSum = Object.values(sim).reduce((n, v) => n + v, 0);
    if (!readBin[b] || !simSum) {
      fitted.push({ ...sim });
      scales.push(1);
      continue;
    }
    const scale = want[b] / simSum;
    scales.push(scale);
    fitted.push(Object.fromEntries(Object.entries(sim).map(([key, v]) => [key, v * scale])));
  }
  const byOperator: Record<string, number> = {};
  const sources = new Map<string, { op: string; source: string; hits: number; total: number }>();
  const hitsOf = new Map(r.sources.map((x) => [`${x.op}|${x.source}`, x.hits]));
  let total = unattributed + afterKill;
  const track: [number, number, number][] = [];
  let dealt = 0;
  fitted.forEach((bin, k) => {
    for (const [key, v] of Object.entries(bin)) {
      const [op, source] = key.split('|');
      byOperator[op] = (byOperator[op] ?? 0) + v;
      const x = sources.get(key) ?? { op, source, hits: hitsOf.get(key) ?? 0, total: 0 };
      x.total += v;
      sources.set(key, x);
      total += v;
      dealt += v;
    }
    track.push([(k + 1) * FIT_BIN, Math.round(dealt), r.track?.find(([t]) => t >= (k + 1) * FIT_BIN)?.[2] ?? -2]);
  });
  return { result: { ...r, total, byOperator, sources: [...sources.values()].sort((a, b) => b.total - a.total), track }, unattributed, afterKill, scaleAt: (s) => scales[Math.floor(s / FIT_BIN)] ?? 1 };
}

/** A moment the replay stops matching the video. */
export interface Divergence {
  /** Seconds on the fight's clock (pauses taken out, as the run's times). */
  t: number;
  kind: 'damage' | 'stagger' | 'staggered';
  /** Damage: the sim's over the video's, less one (+0.12 = 12% more). Stagger: the sim's meter less the video's, in points. */
  by: number;
  /** What it may be, when the meter's step says (a Final Strike's 17, an interrupt's 20, a skill's 10). */
  hint?: string;
}

/** How far apart counts, and for how long (seconds). */
const DAMAGE_SHARE = 0.1;
const DAMAGE_FLOOR = 0.04;
const DAMAGE_HOLD = 3;
const STAGGER_POINTS = 12;
const STAGGER_HOLD = 2;
const STAGGERED_HOLD = 1.5;
/** At most this many of each kind. */
const MOST = 6;

/**
 * Compares a replay's track (seconds on the fight's clock, damage so far, meter share or -1 Staggered) with the
 * video's boss bars (seconds from the fight's start, HP left, meter share or -1), given the stopwatch's pauses (a
 * phase change: the boss's HP starts over), each phase's HP and the meter's size.
 */
export function compareWithVideo(
  track: [number, number, number][],
  boss: [number, number, number][],
  pauses: [number, number][],
  phaseHp: number,
  poise: number,
): Divergence[] {
  if (!track.length || !boss.length || !phaseHp) return [];
  // Video seconds to the fight's clock, and where each phase begins on it.
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  const phases = pauses.filter(([a, b]) => b - a >= 2).map(([a]) => clock(a));
  const phaseOf = (c: number) => phases.filter((p) => c >= p).length;
  const simAt = (c: number) => {
    let lo = 0;
    let hi = track.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (track[mid][0] <= c) lo = mid;
      else hi = mid - 1;
    }
    return track[lo];
  };
  const startDealt = [0, ...phases.map((p) => simAt(p)[1])];
  const points = boss
    .filter(([t]) => !pauses.some(([a, b]) => t >= a && t < b))
    .map(([t, hp, meter]) => {
      const c = clock(t);
      const k = phaseOf(c);
      const [, dealt, simMeter] = simAt(c);
      return { c, video: (1 - hp) * phaseHp, sim: Math.min(phaseHp, dealt - startDealt[k]), meter, simMeter };
    });

  const out: Divergence[] = [];
  // Damage: apart by DAMAGE_SHARE of the video's (and DAMAGE_FLOOR of the phase's HP) for DAMAGE_HOLD seconds.
  scan(
    points,
    (p) => Math.abs(p.sim - p.video) >= Math.max(DAMAGE_SHARE * p.video, DAMAGE_FLOOR * phaseHp),
    DAMAGE_HOLD,
    (p) => out.push({ t: p.c, kind: 'damage', by: p.video > 0 ? p.sim / p.video - 1 : 1 }),
  );
  // Staggered in one and not the other.
  scan(
    points,
    (p) => (p.meter < 0) !== (p.simMeter < 0),
    STAGGERED_HOLD,
    (p) => out.push({ t: p.c, kind: 'staggered', by: p.simMeter < 0 ? 1 : -1 }),
  );
  // The meters apart by STAGGER_POINTS for STAGGER_HOLD seconds (neither Staggered).
  scan(
    points,
    (p) => p.meter >= 0 && p.simMeter >= 0 && Math.abs(p.simMeter - p.meter) * poise >= STAGGER_POINTS,
    STAGGER_HOLD,
    (p, i) => {
      const by = Math.round((p.simMeter - p.meter) * poise);
      out.push({ t: p.c, kind: 'stagger', by, hint: hintAt(points, i, poise, by) });
    },
  );
  return out.sort((a, b) => a.t - b.t);
}

/** Calls `at` where `apart` starts and holds `hold` seconds, then again only after it has stopped as long. */
function scan<P extends { c: number }>(points: P[], apart: (p: P) => boolean, hold: number, at: (p: P, i: number) => void): void {
  let from = -1;
  let together = -1;
  let armed = true;
  let n = 0;
  for (let i = 0; i < points.length && n < MOST; i++) {
    if (apart(points[i])) {
      together = -1;
      if (from < 0) from = i;
      if (armed && points[i].c - points[from].c >= hold) {
        at(points[from], from);
        n++;
        armed = false;
      }
    } else {
      from = -1;
      if (together < 0) together = i;
      if (!armed && points[i].c - points[together].c >= hold) armed = true;
    }
  }
}

/** The meter's step where they part, as what usually gives it. */
function hintAt(points: { c: number; meter: number; simMeter: number }[], i: number, poise: number, by: number): string | undefined {
  // The biggest one-sided rise within a second before.
  let video = 0;
  let sim = 0;
  for (let k = i; k > 0 && points[i].c - points[k].c <= 1.5; k--) {
    if (points[k].meter >= 0 && points[k - 1].meter >= 0) video = Math.max(video, (points[k].meter - points[k - 1].meter) * poise);
    if (points[k].simMeter >= 0 && points[k - 1].simMeter >= 0) sim = Math.max(sim, (points[k].simMeter - points[k - 1].simMeter) * poise);
  }
  const step = by < 0 ? video - sim : sim - video;
  if (by > 0) return step >= 5 ? 'the boss took no Stagger here?' : undefined;
  // The video's own step, as the nearest of what usually gives it.
  const kinds: [number, string][] = [
    [20, 'an interrupt?'],
    [17, 'a Final Strike the transcript misses?'],
    [10, 'a combo or battle skill the transcript misses?'],
  ];
  const best = kinds.reduce((a, b) => (Math.abs(step - b[0]) < Math.abs(step - a[0]) ? b : a));
  return Math.abs(step - best[0]) <= 3 ? best[1] : undefined;
}
