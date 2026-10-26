import { FPS, type Input } from '../../../domain/sim/engine';
import { INPUT_NAME, type ReplayResult, type SimResult } from '../../../domain/sim/team';
import type { VideoRotation } from '../../rotationReader';
import { big, spText } from './text';

/** The pauses after which the boss's bar was full again (a phase change), by their start, from the recording's bars. */
export function phaseChanges(boss: [number, number, number][], pauses: [number, number][]): number[] {
  return pauses.filter(([a]) => {
    const i = boss.findIndex(([t]) => t >= a);
    const before = boss[(i < 0 ? boss.length : i) - 1];
    const after = boss[i];
    return !!before && !!after && after[1] > before[1] + 0.3;
  }).map(([a]) => a);
}

/** Where each press falls in the fight, one row per team position. */
/** What a timeline shows: a sim's result, or a recording's own reading, on the fight's clock (frames). */
export interface Track {
  seconds: number;
  main: number;
  presses: { frame: number; slot: number; input: Input }[];
  strikes: { frame: number; slot: number; finisher: boolean }[];
  staggers: { frame: number; end: number }[];
  /** Each ultimate form's stretch (Yvonne's), its attacks the ultimate's damage. */
  forms?: { slot: number; frame: number; end: number }[];
  mechanics: { frame: number; label: string }[];
  away: [number, number][];
  guard: [number, number][];
  /** Damage dealt each second of the fight. */
  dps: number[];
  /** Each press's and Final Strike's damage (in the order of `presses` and `strikes`), where known. */
  pressDmg?: (number | undefined)[];
  strikeDmg?: (number | undefined)[];
  /** Each press's and Final Strike's SP change (a battle skill's cost negative), where known. */
  pressSp?: (number | undefined)[];
  strikeSp?: (number | undefined)[];
  /** The SP bar just after each press and strike. */
  pressSpAfter?: (number | undefined)[];
  strikeSpAfter?: (number | undefined)[];
}

/** A sim result as a track: its damage each second from its own track. */
export function simTrack(r: SimResult): Track {
  const dps: number[] = [];
  let last = 0;
  for (const [t, dealt] of r.track ?? []) {
    const k = Math.floor(t);
    while (dps.length <= k) dps.push(0);
    dps[k] += dealt - last;
    last = dealt;
  }
  return { seconds: r.seconds, main: r.main, presses: r.presses, strikes: r.strikes ?? [], staggers: r.staggers ?? [], ...(r.forms ? { forms: r.forms } : {}), mechanics: r.mechanics ?? [], away: r.away ?? [], guard: [], dps };
}

/**
 * An ultimate press's form, if it has one: the first that starts after it and before that operator's next ultimate
 * (after its cut-in, or two: one shared with another ultimate waits for both).
 */
export const formOf = (r: Pick<Track, 'forms' | 'presses'>, p: { frame: number; slot: number; input?: Input }) => {
  if (p.input !== 'ultimate' || !r.forms) return undefined;
  const next = r.presses.find((q) => q.slot === p.slot && q.input === 'ultimate' && q.frame > p.frame)?.frame ?? Infinity;
  return r.forms.find((f) => f.slot === p.slot && f.frame >= p.frame - FPS && f.frame < next);
};

/** A form's length for the transcript and hover text ("10.0 s"). */
export const formLength = (f: { frame: number; end: number } | undefined) => (f ? `${((f.end - f.frame) / FPS).toFixed(1)} s` : '');

/**
 * A recording as a track, 1:1 with the video: its presses, Final Strikes and interrupts as read, the boss Staggered
 * where its meter went yellow, its Stagger node where the meter passed half, and its damage each second from its
 * HP bar (the game's own rolls, crits and all), on the fight's clock (the stopwatch's pauses taken out).
 */
export function recordingTrack(reading: VideoRotation, seconds: number, phaseHp: number | undefined, nodes: number[] = [], nodeMechanic?: string): Track {
  const pauses = reading.pauses ?? [];
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  const f = (t: number) => Math.round(clock(t) * FPS);
  const presses: Track['presses'] = [];
  const strikes: Track['strikes'] = [];
  const mechanics: Track['mechanics'] = [];
  const who = new Map<number, number>();
  const pressSp: (number | undefined)[] = [];
  const strikeSp: (number | undefined)[] = [];
  const pressSpAfter: (number | undefined)[] = [];
  const strikeSpAfter: (number | undefined)[] = [];
  // An action that moved no SP (a combo, an ultimate): the bar as read at it, so every action has one.
  const bar = reading.sp ?? [];
  const barAt = (t: number) => bar.filter(([u]) => u <= t + 0.1).at(-1)?.[1];
  for (const x of reading.steps) {
    if (x.input === 'strike' || x.input === 'finisher') {
      strikes.push({ frame: f(x.t), slot: x.slot, finisher: x.input === 'finisher' });
      strikeSp.push(x.sp);
      strikeSpAfter.push(x.spAfter);
      who.set(x.slot, (who.get(x.slot) ?? 0) + 1);
    } else {
      presses.push({ frame: f(x.t), slot: x.slot, input: x.input });
      pressSp.push(x.sp);
      pressSpAfter.push(x.spAfter ?? (x.sp === undefined || x.sp === 0 ? barAt(x.t) : undefined));
    }
    if (x.interrupt) mechanics.push({ frame: f(x.t) + FPS, label: 'Interrupted' });
  }
  // The boss's node mechanic (Alleikhreos's Foundite Weapon) where its effect shows: each stretch it took no Stagger,
  // as the parser measured them from its meter.
  if (nodeMechanic) for (const [a] of reading.guard ?? []) mechanics.push({ frame: f(a), label: nodeMechanic });
  const main = [...who.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const staggers: Track['staggers'] = [];
  const dps: number[] = [];
  let lastHp = 1;
  let lastT = -Infinity;
  let open: Track['staggers'][number] | null = null;
  let under = true;
  for (const [t, hp, meter] of reading.boss ?? []) {
    if (pauses.some(([a, b]) => t >= a && t < b)) continue;
    const c = clock(t);
    if (meter < 0) {
      if (!open) staggers.push((open = { frame: Math.round(c * FPS), end: Math.round(c * FPS) }));
      open.end = Math.round(c * FPS);
    } else open = null;
    // The meter reaching the boss's Stagger node (its entry's `nodes`: the Skydrummer has none).
    const node = nodes[0];
    if (node !== undefined) {
      if (meter >= node && under) mechanics.push({ frame: Math.round(c * FPS), label: 'Stagger node' });
      if (meter >= 0 && meter < node) under = true;
      if (meter >= node) under = false;
    }
    // A new phase refills the bar; otherwise what it lost is damage.
    if (phaseHp) {
      if (t - lastT > 2 && hp > lastHp + 0.3) lastHp = 1;
      const k = Math.min(Math.floor(c), Math.max(0, seconds - 1));
      while (dps.length <= k) dps.push(0);
      dps[k] += Math.max(0, lastHp - hp) * phaseHp;
      lastHp = Math.min(lastHp, hp);
    }
    lastT = t;
  }
  return { seconds, main, presses, strikes, staggers, mechanics, away: (reading.away ?? []).map(([a, b]) => [clock(a), clock(b)] as [number, number]).map(([a, b]) => [a * FPS, b * FPS] as [number, number]), guard: (reading.guard ?? []).map(([a, b]) => [clock(a) * FPS, clock(b) * FPS] as [number, number]), dps, ...(pressSp.some((x) => x !== undefined) ? { pressSp, strikeSp, pressSpAfter, strikeSpAfter } : {}) };
}

/** The lanes of a track: each operator's presses and Final Strikes, the damage each second, the enemy's stretches. */
/** An action's SP change for its hover text (" · −100 SP"), or nothing. */
export function spOf<T>(sp: (number | undefined)[] | undefined, list: T[], item: T): string {
  const d = sp?.[list.indexOf(item)];
  return d === undefined ? '' : ` · ${spText(d)}`;
}

/** An action's damage for its hover text (" · 12,345 damage"), or nothing. */
export function dmgOf<T>(dmg: (number | undefined)[] | undefined, list: T[], item: T): string {
  const d = dmg?.[list.indexOf(item)];
  return d ? ` · ${big(d)} damage` : '';
}

/** Each longer timeline (simLong) and the result it extends: the player keeps its place switching views. */
export const baseOf = new WeakMap<SimResult, SimResult>();
const longOf = new WeakMap<SimResult, SimResult>();

/**
 * A run's result with the sim's fight after the recording's end (ReplayResult.runOn) added, to the sim's clear: the Sim
 * view's timeline, so a slower sim plays on past the recording. The same object each time for one result.
 */
export function simLong(shown: SimResult, replayed: ReplayResult | undefined): SimResult {
  const on = replayed?.runOn;
  if (!on || replayed!.clear === undefined || replayed!.clear <= shown.seconds) return shown;
  const known = longOf.get(shown);
  if (known) return known;
  const long = {
    ...shown,
    seconds: replayed!.clear,
    presses: [...shown.presses, ...on.presses],
    strikes: [...(shown.strikes ?? []), ...on.strikes],
    staggers: [...(shown.staggers ?? []).map((x, k, all) => (k === all.length - 1 && on.lastEnd !== undefined ? { ...x, end: Math.max(x.end, on.lastEnd) } : x)), ...on.staggers],
    track: [...(replayed!.track ?? []), ...on.track],
    spTrack: [...(replayed!.spTrack ?? []), ...on.sp],
    freezes: [...(replayed!.freezes ?? []), ...(on.freezes ?? [])],
    staggerLeft: [...(replayed!.staggerLeft ?? []), ...(on.staggerLeft ?? [])],
  } as ReplayResult;
  longOf.set(shown, long);
  baseOf.set(long, shown);
  return long;
}

/**
 * A sim track run on to a longer timeline: its presses, strikes and Staggers after the recording's, damage each second,
 * and each action's damage and SP, the recording's (fitted) then the run on's (the sim's own, `ReplayResult.runOn`).
 */
export function withRunOn(track: Track, long: SimResult): Track {
  const more = simTrack(long);
  const on = (long as ReplayResult).runOn;
  const n = track.presses.length;
  const m = track.strikes.length;
  const join = (mine: (number | undefined)[] | undefined, len: number, theirs: number[] | undefined) =>
    mine || theirs ? [...Array.from({ length: len }, (_, i) => mine?.[i]), ...(theirs ?? [])] : undefined;
  return {
    ...more,
    pressDmg: join(track.pressDmg, n, on?.pressDmg),
    strikeDmg: join(track.strikeDmg, m, on?.strikeDmg),
    pressSp: join(track.pressSp, n, on?.pressSp),
    strikeSp: join(track.strikeSp, m, on?.strikeSp),
    pressSpAfter: join(track.pressSpAfter, n, on?.pressSpAfter),
    strikeSpAfter: join(track.strikeSpAfter, m, on?.strikeSpAfter),
  };
}

/** The presses, with the controlled operator's Final Strikes and Finishers between them (how long to keep attacking). */
export function steps(r: Track): { frame: number; slot: number; label: string; strike: boolean; dmg?: number; sp?: number; spAfter?: number; length?: string }[] {
  const out = [
    ...r.presses.flatMap((p, i) => (p.input === 'swap' ? [] : [{ frame: p.frame, slot: p.slot, label: INPUT_NAME[p.input], strike: false, dmg: r.pressDmg?.[i], sp: r.pressSp?.[i], spAfter: r.pressSpAfter?.[i], length: formLength(formOf(r, p)) }])),
    ...r.strikes.map((s, i) => ({ frame: s.frame, slot: s.slot, label: s.finisher ? 'Finisher' : 'Final Strike', strike: true, dmg: r.strikeDmg?.[i], sp: r.strikeSp?.[i], spAfter: r.strikeSpAfter?.[i] })),
    ...r.staggers.map((s) => ({ frame: s.frame, slot: -1, label: 'Staggered', strike: true })),
    ...r.mechanics.map((m) => ({ frame: m.frame, slot: -1, label: m.label, strike: true })),
    ...r.away.map(([a]) => ({ frame: a, slot: -1, label: 'Invulnerable', strike: true })),
  ];
  return out.sort((a, b) => a.frame - b.frame);
}
