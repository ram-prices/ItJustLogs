/**
 * Finding a rotation: which buttons to press, when, for the most damage.
 *
 * A fight is played by a priority list (the first of the list's inputs that
 * can be done is pressed; otherwise the controlled operator attacks), and
 * the list is searched for the best order. Then the presses it made are
 * improved one at a time: each is swapped for another input that could be
 * done at that moment, or held back a little, and the fight replayed with the
 * list taking over after it; a change that deals more damage is kept.
 *
 * Fights replay from the start each time (the engine is deterministic).
 *
 * `beam` searches press by press instead: at each moment something other than
 * a basic attack can be pressed, it tries each of those and holding back, plays
 * each on to the end with the priority list, and keeps the best few ways so far
 * (from copies of the fight, World.clone). Pure logic.
 *
 * With the dummy's HP set (Team.hp) a fight ends when it's defeated, and the
 * fastest to defeat it is the best; within the time limit (`seconds`) a fight
 * that doesn't is judged by its damage, below any that does.
 */
import { FPS, World, type Bundle, type Enemy, type Form, type Hit, type Input, type Stagger, type Stats, type Strike } from './engine';

export interface Team {
  bundles: Bundle[];
  stats: Stats[];
  /** Each operator's Potential. */
  potentials: number[];
  settings: Record<string, { values: number[]; kind?: string }>;
  enemy?: Enemy;
  /** SP at the start (the game's default otherwise). */
  startSp?: number;
  /** The share of the fight the enemy can be hit (1 unless set). */
  uptime?: number;
  /** The dummy's HP: the fight ends when it's defeated, and the fastest is the best. */
  hp?: number;
  /** What the team was made from (team.ts TeamSpec), so another thread can make it again from its own data. */
  spec?: unknown;
  /** What the style allows (default: everything). */
  rules?: Rules;
  /** Who's controlled at the start (team slot), the only one the search tries; unset: it tries each. */
  main?: number;
}

/** What a style allows: swapping who's controlled, animation cancels. */
export interface Rules {
  swaps: boolean;
  cancels: boolean;
}

/** A fight's start: the team, who's controlled, SP, and what the style allows. */
function worldOf(team: Team, main: number): World {
  const w = new World(team.bundles, team.stats, team.enemy ?? {}, team.settings);
  w.start(team.potentials);
  w.controlled = main;
  if (team.startSp != null) w.sp = team.startSp;
  if (team.uptime != null) w.uptime = team.uptime;
  if (team.rules) {
    w.swaps = team.rules.swaps;
    w.cancels = team.rules.cancels;
  }
  return w;
}

/** A press the player makes (basic attacks fill the time between). */
export interface Press {
  /** Fight time (frames; an ultimate's stopped time isn't counted). */
  frame: number;
  slot: number;
  input: Input;
  /** Every frame counted, stopped time too (the press right after an ultimate's has the same `frame`). */
  at?: number;
}

/** Frames since the start, stopped time too. */
const clock = (w: World) => w.frame + w.frozenFrames;

/** An input, or holding back (only basic attacks) until a frame. */
export type Step = Press | { frame: number; wait: number };

export interface Policy {
  /** Inputs by priority: the first that can be done is pressed. With `cycle`, battle skills in turn. */
  order: [number, Input][];
  /** Who's controlled at the start. */
  main: number;
  /**
   * A fixed order (Basic): combos as they come up, ultimates when charged, and the battle skills in `order` in turn,
   * over and over (one that can't be done at all now is skipped).
   */
  cycle?: boolean;
}

export interface Fight {
  total: number;
  /** Fight time in seconds (an ultimate's stopped time isn't counted). */
  seconds: number;
  presses: Press[];
  byOperator: Record<string, number>;
  hits: Hit[];
  /** Game actions the engine doesn't simulate yet, and how often they came up (accuracy gaps). */
  unknown: [string, number][];
  /** Who was controlled at the start (team slot). */
  main: number;
  /** With an HP goal: the dummy was defeated (at `seconds`). */
  killed?: boolean;
  /** The controlled operator's Final Strikes and Finishers. */
  strikes?: Strike[];
  /** When the enemy was Staggered. */
  staggers?: Stagger[];
  /** The enemy's mechanics (World.mechanics). */
  mechanics?: { frame: number; label: string }[];
  /** When the enemy couldn't be hit (World.away). */
  away?: [number, number][];
  /** Ultimate forms (World.forms). */
  forms?: Form[];
}

/** Above any damage: a defeat scores this less its time. */
const KILLED = 1e15;

/** Whether a fight has defeated the dummy. */
const defeated = (team: Team, w: World) => !!team.hp && w.dealt >= team.hp;

/** How good a fight is: with an HP goal, defeating the dummy sooner; otherwise (and short of that) its damage. */
export function scoreOf(f: Fight): number {
  return f.killed ? KILLED - f.seconds : f.total;
}

/**
 * Plays a fight: `script` first (presses at their frames, holds), then the
 * policy from `from` on. `watch` sees the world at the start of every frame.
 */
export function play(team: Team, policy: Policy, seconds: number, script: Step[] = [], from = 0, watch?: (w: World) => void): Fight {
  const w = worldOf(team, policy.main);
  const presses: Press[] = [];
  const end = Math.round(seconds * FPS);
  let next = 0;
  let holdUntil = -1;
  // The cycle's next battle skill.
  let turn = 0;
  const tryPress = (slot: number, input: Input) => {
    if (!w.press(slot, input)) return false;
    presses.push({ frame: w.frame, slot, input, at: clock(w) });
    return true;
  };
  while (w.frame < end && !defeated(team, w)) {
    watch?.(w);
    let pressed = false;
    if (w.frame < from) {
      const due = (x: Step) => ('at' in x && x.at != null ? x.at === clock(w) : x.frame === w.frame);
      while (next < script.length && due(script[next])) {
        const s = script[next++];
        if ('wait' in s) holdUntil = s.wait;
        else if (w.press(s.slot, s.input)) {
          presses.push({ frame: w.frame, slot: s.slot, input: s.input, at: clock(w) });
          pressed = true;
        }
      }
    } else if (w.frame >= holdUntil && policy.cycle) {
      const n = team.bundles.length;
      for (const input of ['combo', 'ultimate'] as Input[]) for (let s = 0; s < n && !pressed; s++) pressed = tryPress(s, input);
      const len = policy.order.length;
      for (let k = 0; k < len && !w.can(policy.order[turn % len][0], 'battle', true); k++) turn++;
      if (!pressed && len && tryPress(policy.order[turn % len][0], 'battle')) {
        pressed = true;
        turn++;
      }
    } else if (w.frame >= holdUntil) {
      for (const [slot, input] of policy.order) if ((pressed = tryPress(slot, input))) break;
    }
    if (!pressed) w.press(w.controlled, 'attack');
    w.tick();
  }
  const killed = defeated(team, w);
  const last = killed ? w.frame : end;
  const byOperator: Record<string, number> = {};
  let total = 0;
  for (const h of w.hits) {
    if (h.frame > last) continue;
    byOperator[h.operator] = (byOperator[h.operator] ?? 0) + h.amount;
    total += h.amount;
  }
  return {
    total,
    seconds: killed ? w.frame / FPS : seconds,
    presses,
    byOperator,
    hits: w.hits.filter((h) => h.frame <= last),
    unknown: [...w.unknown.entries()].sort((a, b) => b[1] - a[1]),
    main: policy.main,
    ...(team.hp ? { killed } : {}),
    strikes: w.strikes.filter((s) => s.frame <= last),
    staggers: w.staggers.filter((s) => s.frame <= last).map((s) => ({ ...s, end: Math.min(s.end, last) })),
    mechanics: w.mechanics.filter((m) => m.frame <= last),
    forms: w.forms.filter((x) => x.frame <= last).map((x) => ({ ...x, end: Math.min(x.end, last) })),
  };
}

/** Every input the player could press now, other than attacking. */
function options(team: Team, policy: Policy, script: Step[], upTo: Step): Press[] {
  // Replays to the step's moment and asks the world what can be done there.
  const w = worldOf(team, policy.main);
  const byClock = (x: Step) => 'at' in x && x.at != null;
  const before = () => (byClock(upTo) ? clock(w) < (upTo as Press).at! : w.frame < upTo.frame);
  const due = (x: Step) => (byClock(x) ? (x as Press).at === clock(w) : x.frame === w.frame);
  let next = 0;
  while (before()) {
    let pressed = false;
    while (next < script.length && due(script[next])) {
      const s = script[next++];
      if (!('wait' in s) && w.press(s.slot, s.input)) pressed = true;
    }
    if (!pressed) w.press(w.controlled, 'attack');
    w.tick();
  }
  const out: Press[] = [];
  for (let slot = 0; slot < team.bundles.length; slot++)
    for (const input of ['ultimate', 'combo', 'battle', 'swap'] as Input[]) if (w.can(slot, input)) out.push({ frame: w.frame, slot, input, at: clock(w) });
  return out;
}

// ---------------------------------------------------------------------------
// Runners: who plays the fights a search asks for
// ---------------------------------------------------------------------------

/** A fight to play: as `play` does. */
export interface PlayTask {
  team: Team;
  policy: Policy;
  seconds: number;
  script?: Step[];
  from?: number;
}

/**
 * A press-by-press way to carry on from: its presses up to its moment (`clock`) and what it keeps back. A runner that
 * has its fight (`world`) carries on from that; one that doesn't (another thread) replays the presses: the engine is
 * deterministic, so it's the same fight.
 */
export interface WayRef {
  key: string;
  presses: Press[];
  clock: number;
  holds: Hold[];
  world?: World;
}

/** A way's next step: one choice from its moment, played on to the next moment and judged. */
export interface ChildTask {
  team: Team;
  policy: Policy;
  end: number;
  gap: number;
  /** The best fight's presses (later passes): followed after this step. */
  guide?: Press[];
  waits: number[];
  holds: boolean;
  parent: WayRef;
  choice: Choice;
  /** Its key (unique in the search). */
  key: string;
}

export interface ChildResult {
  /** False: the choice couldn't be done (it isn't a way). */
  ok: boolean;
  key: string;
  presses: Press[];
  holds: Hold[];
  clock: number;
  done: boolean;
  /** The fight played on from here with the list (and guide): its score. */
  value: number;
  /** That fight's presses. */
  judged: Press[];
  /** What can be chosen at its next moment. */
  choices: Choice[];
  world?: World;
}

/**
 * Plays the fights a search asks for. The local runner plays them one by one; a pool plays a batch on several threads
 * (ui/simPool.ts). Either way the search takes the results in the same order, so it finds the same rotation.
 */
export interface Runner {
  /** How many fights it plays at once (1: one by one). */
  width: number;
  plays(tasks: PlayTask[]): Promise<Fight[]>;
  children(tasks: ChildTask[]): Promise<ChildResult[]>;
}

export const localRunner: Runner = {
  width: 1,
  plays: async (tasks) => tasks.map((t) => play(t.team, t.policy, t.seconds, t.script, t.from)),
  children: async (tasks) => tasks.map((t) => childOf(t, t.parent.world ?? replayWay(t.team, t.policy, t.parent))),
};

/** A way's fight rebuilt from its presses (for a runner that doesn't have it). */
export function replayWay(team: Team, policy: Policy, ref: WayRef): World {
  const w = worldOf(team, policy.main);
  let next = 0;
  while (clock(w) < ref.clock) {
    let pressed = false;
    while (next < ref.presses.length && (ref.presses[next].at ?? ref.presses[next].frame) === clock(w)) {
      const p = ref.presses[next++];
      if (w.press(p.slot, p.input)) pressed = true;
    }
    if (!pressed) w.press(w.controlled, 'attack');
    w.tick();
  }
  return w;
}

/** One step of the beam: the choice from the parent's fight, on to the next moment, judged by playing on. */
export function childOf(t: ChildTask, parent: World): ChildResult {
  const w = parent.clone();
  const presses = t.parent.presses.slice();
  // Holds that have run out are dropped.
  const holds = t.parent.holds.filter((h) => w.frame < h.until);
  const fail: ChildResult = { ok: false, key: t.key, presses, holds, clock: 0, done: true, value: -1, judged: [], choices: [] };
  const c = t.choice;
  if ('hold' in c) holds.push(c.hold);
  else if ('wait' in c) {
    for (let k = 0; k < c.wait && w.frame < t.end && !defeated(t.team, w); k++) {
      w.press(w.controlled, 'attack');
      w.tick();
    }
  } else {
    if (!w.press(c.slot, c.input)) return fail;
    presses.push({ frame: w.frame, slot: c.slot, input: c.input, at: clock(w) });
    w.tick();
  }
  const way: Way = { w, presses, holds, value: 0, done: false };
  toChoice(t.team, way, t.end, t.gap);
  // Judged on a copy, played on to the end.
  const judge = w.clone();
  const judged = presses.slice();
  playOn(t.team, judge, t.policy, t.end, judged, t.gap, t.guide, holds);
  return {
    ok: true,
    key: t.key,
    presses,
    holds,
    clock: clock(w),
    done: way.done,
    value: valueOf(t.team, judge, t.end),
    judged,
    choices: way.done ? [] : choicesOf(w, holds, t.waits, t.holds),
    world: w,
  };
}

/** What can be chosen at a moment: each input that can be pressed, waiting, and (with holds) keeping one back. */
function choicesOf(w: World, holds: Hold[], waits: number[], withHolds: boolean): Choice[] {
  const now = inputsNow(w, holds);
  const out: Choice[] = [...now, ...waits.map((wait) => ({ frame: w.frame, wait }))];
  if (withHolds) for (const hold of holdsNow(w, now, holds)) out.push({ hold });
  return out;
}

// ---------------------------------------------------------------------------
// The priority list, then press by press
// ---------------------------------------------------------------------------

export interface SearchOptions {
  seconds?: number;
  /** Stop after this many fights played. */
  budget?: number;
  /** Called after each improvement. */
  progress?: (best: Fight, played: number) => void;
  /** Then improve it press by press (default true); off: the priority list's own fight, with the whole budget for the list. */
  pressByPress?: boolean;
}

/**
 * The best rotation found: a priority order, then press-by-press improvements. With a runner of several threads,
 * fights are played in batches; a batch that runs past a kept change is played again from it, so the result is what
 * one thread finds.
 */
export async function search(team: Team, opts: SearchOptions = {}, runner: Runner = localRunner): Promise<{ fight: Fight; policy: Policy }> {
  const seconds = opts.seconds ?? 60;
  const budget = opts.budget ?? 600;
  const listBudget = opts.pressByPress === false ? budget : budget / 2;
  let played = 0;
  const n = team.bundles.length;
  const all: [number, Input][] = [];
  for (const input of ['ultimate', 'combo', 'battle'] as Input[]) for (let s = 0; s < n; s++) all.push([s, input]);
  const batch = Math.max(1, runner.width * 2);

  // 1. Priority order and who's controlled. Starts: the plain order with each operator controlled, then random
  //    orders (seeded, so a search always plays the same); the best few are improved by swapping two entries while
  //    that helps. A single start can settle on a list that never builds to something (an ultimate that needs its
  //    energy built first).
  let best: { fight: Fight; policy: Policy } | null = null;
  const consider = (fight: Fight, policy: Policy) => {
    if (!best || scoreOf(fight) > scoreOf(best.fight)) {
      best = { fight, policy };
      opts.progress?.(fight, played);
    }
  };
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const startBudget = Math.min(Math.max(n, Math.round(listBudget * 0.4)), Math.ceil(listBudget));
  const policies: Policy[] = [];
  // With one operator controlled, one plain start does.
  const plain = team.main == null ? n : 1;
  for (let k = 0; k < startBudget; k++) {
    const order = all.map((x) => [...x] as [number, Input]);
    if (k >= plain)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    const main = k < n ? k : Math.floor(rnd() * n);
    policies.push({ order, main: team.main ?? main });
  }
  const fights = await runner.plays(policies.map((policy) => ({ team, policy, seconds })));
  const starts = policies.map((policy, k) => {
    played++;
    consider(fights[k], policy);
    return { fight: fights[k], policy };
  });
  starts.sort((a, b) => scoreOf(b.fight) - scoreOf(a.fight));
  const climbs = starts.slice(0, CLIMBS);
  for (let c = 0; c < climbs.length; c++) {
    let { fight, policy } = climbs[c];
    const stop = played + Math.floor((listBudget - played) / (climbs.length - c));
    for (let improved = true; improved && played < stop; ) {
      improved = false;
      const pairs: [number, number][] = [];
      for (let i = 0; i < policy.order.length; i++) for (let j = i + 1; j < policy.order.length; j++) pairs.push([i, j]);
      let at = 0;
      while (at < pairs.length && played < stop) {
        // Each swap of the list as it now stands; after a kept one, the rest are tried on the new list.
        const tries = pairs.slice(at, at + Math.min(batch, stop - played)).map(([i, j]) => {
          const order = policy.order.slice();
          [order[i], order[j]] = [order[j], order[i]];
          return { order, main: policy.main };
        });
        const got = await runner.plays(tries.map((p) => ({ team, policy: p, seconds })));
        let used = tries.length;
        for (let k = 0; k < tries.length; k++) {
          played++;
          if (scoreOf(got[k]) > scoreOf(fight) + 1e-6) {
            policy = tries[k];
            fight = got[k];
            improved = true;
            used = k + 1;
            break;
          }
        }
        at += used;
      }
    }
    consider(fight, policy);
  }

  if (opts.pressByPress === false) return best!;
  // 2. Press by press: another input at that moment, or holding back 0.5 / 1 / 2 s; the policy carries on after.
  let { fight, policy } = best!;
  let script: Step[] = fight.presses.map((p) => ({ ...p }));
  for (let k = 0; k < script.length && played < budget; k++) {
    const at = script[k].frame;
    const prefix = script.slice(0, k);
    const tries: Step[][] = [];
    for (const o of options(team, policy, prefix, script[k])) {
      const cur = script[k];
      if ('slot' in cur && cur.slot === o.slot && cur.input === o.input) continue;
      tries.push([...prefix, o]);
    }
    played++;
    for (const hold of [0.5, 1, 2]) tries.push([...prefix, { frame: at, wait: at + Math.round(hold * FPS) }]);
    // The changed step is played, then the policy goes on from the frame after it.
    const take = tries.slice(0, Math.max(0, budget - played));
    const got = await runner.plays(take.map((t) => ({ team, policy, seconds, script: t, from: at + 1 })));
    for (let i = 0; i < take.length && played < budget; i++) {
      played++;
      const f = got[i];
      if (scoreOf(f) > scoreOf(fight) + 1e-6) {
        fight = f;
        // Keep the change; what follows is what the policy did after it.
        script = [...take[i].slice(0, k + 1), ...f.presses.filter((p) => p.frame > at)];
        opts.progress?.(fight, played);
      }
    }
  }
  return { fight, policy };
}

/** Priority lists the list search improves (the best of its starts). */
const CLIMBS = 3;

/**
 * The best fixed order (Basic style, Policy.cycle): who's controlled and the battle skills in turn. Starts: each
 * operator controlled with the team's order, then random orders (an operator can come up twice and another not at
 * all); the best few are improved by swapping two places or putting another operator in one, while that helps.
 */
export async function searchCycle(team: Team, opts: SearchOptions = {}, runner: Runner = localRunner): Promise<{ fight: Fight; policy: Policy }> {
  const seconds = opts.seconds ?? 60;
  const budget = opts.budget ?? 600;
  const n = team.bundles.length;
  const batch = Math.max(1, runner.width * 2);
  let played = 0;
  let best: { fight: Fight; policy: Policy } | null = null;
  const consider = (fight: Fight, policy: Policy) => {
    if (!best || scoreOf(fight) > scoreOf(best.fight)) {
      best = { fight, policy };
      opts.progress?.(fight, played);
    }
  };
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const of = (slots: number[], main: number): Policy => ({ order: slots.map((s) => [s, 'battle'] as [number, Input]), main, cycle: true });
  const policies: Policy[] = [];
  const starts = Math.min(Math.max(n, Math.round(budget * 0.4)), budget);
  const plain = team.main == null ? n : 1;
  for (let k = 0; k < starts; k++) {
    const slots = Array.from({ length: n }, (_, i) => i);
    if (k >= plain) {
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      if (k % 3 === 0) slots[Math.floor(rnd() * n)] = Math.floor(rnd() * n);
    }
    const main = k < n ? k : Math.floor(rnd() * n);
    policies.push(of(slots, team.main ?? main));
  }
  const fights = await runner.plays(policies.map((policy) => ({ team, policy, seconds })));
  const tried = policies.map((policy, k) => {
    played++;
    consider(fights[k], policy);
    return { fight: fights[k], policy };
  });
  tried.sort((a, b) => scoreOf(b.fight) - scoreOf(a.fight));
  const climbs = tried.slice(0, CLIMBS);
  for (let c = 0; c < climbs.length; c++) {
    let { fight, policy } = climbs[c];
    const stop = played + Math.floor((budget - played) / (climbs.length - c));
    for (let improved = true; improved && played < stop; ) {
      improved = false;
      const slots = policy.order.map(([s]) => s);
      const moves: Policy[] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (slots[i] !== slots[j]) moves.push(of(slots.map((s, k) => (k === i ? slots[j] : k === j ? slots[i] : s)), policy.main));
      for (let i = 0; i < n; i++) for (let s = 0; s < n; s++) if (s !== slots[i]) moves.push(of(slots.map((x, k) => (k === i ? s : x)), policy.main));
      if (team.main == null) for (let m = 0; m < n; m++) if (m !== policy.main) moves.push(of(slots, m));
      let at = 0;
      while (at < moves.length && played < stop && !improved) {
        const tries = moves.slice(at, at + Math.min(batch, stop - played));
        const got = await runner.plays(tries.map((p) => ({ team, policy: p, seconds })));
        for (let k = 0; k < tries.length; k++) {
          played++;
          if (scoreOf(got[k]) > scoreOf(fight) + 1e-6) {
            policy = tries[k];
            fight = got[k];
            improved = true;
            break;
          }
        }
        at += tries.length;
      }
    }
    consider(fight, policy);
  }
  return best!;
}

/** How late (frames) a guide's press may come before it's dropped. */
const LATE = 3 * FPS;

/**
 * Keeping an input back (slot -1: every operator's) until a frame, or sooner when something happens: the enemy
 * is Staggered, or another operator casts an ultimate. Nothing presses it meanwhile, not even the list.
 */
export interface Hold {
  slot: number;
  input: Input;
  from: number;
  until: number;
  release?: 'stagger' | 'ult';
}

/** What can be done at a moment: press an input, hold back (basic attacks only) for some frames, or keep an input back. */
export type Choice = Press | { frame: number; wait: number } | { hold: Hold };

/** Whether an input is kept back now. */
function held(w: World, holds: Hold[], slot: number, input: Input): boolean {
  for (const h of holds) {
    if ((h.slot !== slot && h.slot !== -1) || h.input !== input || w.frame >= h.until) continue;
    if (h.release === 'stagger' && w.staggered(w.enemy)) continue;
    if (h.release === 'ult' && ultSince(w, h)) continue;
    return true;
  }
  return false;
}

/** Whether another operator has cast an ultimate since a hold began. */
function ultSince(w: World, h: Hold): boolean {
  for (let i = w.log.length - 1; i >= 0 && w.log[i].frame >= h.from; i--) if (w.log[i].input === 'ultimate' && w.log[i].op !== h.slot) return true;
  return false;
}

export interface BeamOptions {
  seconds?: number;
  /** How many ways to keep at each step. */
  width?: number;
  /** Holding back: for how long (seconds) each try waits. */
  waits?: number[];
  /** Easier play: at least this long (seconds) between presses. */
  minGap?: number;
  /**
   * Also try keeping ultimates, combos and battle skills back for a while or until Stagger / another ultimate.
   * Off by default: at the same budget a wider beam does better (they add many more ways to try).
   */
  holds?: boolean;
  /** Stop after this many fights played to the end. */
  budget?: number;
  /** The priority list fights are played on with (default: search's). */
  policy?: Policy;
  /**
   * Passes: the first plays each way on with the priority list; each later one plays it on following the best
   * fight found so far (its presses from that moment), so a change is judged against the best play after it.
   */
  passes?: number;
  progress?: (best: Fight, played: number) => void;
}

interface Way {
  w: World;
  presses: Press[];
  holds: Hold[];
  /** Total of the fight played on from here with the priority list. */
  value: number;
  done: boolean;
}

/** A fight played to its end: defeating the dummy sooner (HP goal), else its total up to the end frame. */
function valueOf(team: Team, w: World, end: number): number {
  if (defeated(team, w)) return KILLED - w.frame / FPS;
  let n = 0;
  for (const h of w.hits) if (h.frame <= end) n += h.amount;
  return n;
}

/**
 * Plays on from where `w` is to the end (changes `w`), adding its presses: a guide's presses from now on
 * first (each as soon as it can be done, dropped if it can't within LATE frames), then the priority list.
 */
function playOn(team: Team, w: World, policy: Policy, end: number, presses: Press[], gap: number, guide?: Press[], holds: Hold[] = []): void {
  let last = presses.length ? presses[presses.length - 1].frame : -Infinity;
  const pending = (guide ?? []).filter((p) => (p.at ?? p.frame) >= clock(w));
  while (w.frame < end && !defeated(team, w)) {
    let pressed = false;
    while (pending.length && (pending[0].at ?? pending[0].frame) <= clock(w) - LATE) pending.shift();
    if (pending.length) {
      const p = pending[0];
      if ((p.at ?? p.frame) <= clock(w) && w.frame - last >= gap && !held(w, holds, p.slot, p.input) && w.press(p.slot, p.input)) {
        presses.push({ frame: w.frame, slot: p.slot, input: p.input, at: clock(w) });
        last = w.frame;
        pressed = true;
        pending.shift();
      }
    } else if (w.frame - last >= gap)
      for (const [slot, input] of policy.order)
        if (!held(w, holds, slot, input) && w.press(slot, input)) {
          presses.push({ frame: w.frame, slot, input, at: clock(w) });
          last = w.frame;
          pressed = true;
          break;
        }
    if (!pressed) w.press(w.controlled, 'attack');
    w.tick();
  }
}

/** Inputs other than attacking that could be pressed now (and aren't kept back). */
function inputsNow(w: World, holds: Hold[] = []): Press[] {
  const out: Press[] = [];
  for (let slot = 0; slot < w.team.length; slot++)
    for (const input of ['ultimate', 'combo', 'battle', 'swap'] as Input[]) if (w.can(slot, input) && !held(w, holds, slot, input)) out.push({ frame: w.frame, slot, input });
  return out;
}

/** Ways to keep back what could be pressed now: ultimates (a while, or until Stagger / another ultimate), combos, battle skills. */
function holdsNow(w: World, now: Press[], holds: Hold[]): Hold[] {
  const out: Hold[] = [];
  const f = w.frame;
  const s = (x: number) => Math.round(x * FPS);
  for (const p of now) {
    if (p.input === 'ultimate')
      out.push(
        { slot: p.slot, input: 'ultimate', from: f, until: f + s(3) },
        { slot: p.slot, input: 'ultimate', from: f, until: f + s(8) },
        { slot: p.slot, input: 'ultimate', from: f, until: f + s(15), release: 'stagger' },
        { slot: p.slot, input: 'ultimate', from: f, until: f + s(15), release: 'ult' },
      );
    if (p.input === 'combo') out.push({ slot: p.slot, input: 'combo', from: f, until: f + s(2) });
  }
  if (now.some((p) => p.input === 'battle') && !holds.some((h) => h.slot === -1 && f < h.until)) out.push({ slot: -1, input: 'battle', from: f, until: f + s(2) });
  return out;
}

/** Basic attacks until something else can be pressed (or the fight ends). */
function toChoice(team: Team, way: Way, end: number, gap: number): void {
  const last = way.presses.length ? way.presses[way.presses.length - 1].frame : -Infinity;
  while (way.w.frame < end && !defeated(team, way.w)) {
    if (way.w.frame - last >= gap && inputsNow(way.w, way.holds).length) return;
    way.w.press(way.w.controlled, 'attack');
    way.w.tick();
  }
  way.done = true;
}

/** A way the beam keeps: its reference (to carry on from), its value, whether it's over, what it can choose next. */
interface Node {
  ref: WayRef;
  value: number;
  done: boolean;
  choices: Choice[];
}

/**
 * Beam search over presses. Each way is played on to the end with the priority
 * list to judge it, so the best fight found is never worse than the list alone.
 * Each step's ways are played as one batch (on several threads with a pool).
 */
export async function beam(team: Team, opts: BeamOptions = {}, runner: Runner = localRunner): Promise<{ fight: Fight; policy: Policy }> {
  const seconds = opts.seconds ?? 60;
  const end = Math.round(seconds * FPS);
  const gap = Math.round((opts.minGap ?? 0) * FPS);
  const width = opts.width ?? 4;
  const waits = (opts.waits ?? [0.5]).map((x) => Math.max(1, Math.round(x * FPS)));
  const budget = opts.budget ?? 2000;
  const policy = opts.policy ?? (await search(team, { seconds, budget: 300 }, runner)).policy;
  let played = 0;
  let best: { value: number; presses: Press[] } = { value: -1, presses: [] };
  let guide: Press[] | undefined;

  const better = (value: number, presses: Press[]) => {
    if (value > best.value) {
      best = { value, presses };
      opts.progress?.(fightOf(team, policy, seconds, presses), played);
    }
  };

  for (let pass = 0; pass < (opts.passes ?? 1) && played < budget; pass++) {
    if (pass > 0) guide = best.presses;
    const w0 = worldOf(team, policy.main);
    const root: Way = { w: w0, presses: [], holds: [], value: 0, done: false };
    toChoice(team, root, end, gap);
    const judge = w0.clone();
    const judged: Press[] = [];
    playOn(team, judge, policy, end, judged, gap, guide);
    played++;
    better(valueOf(team, judge, end), judged);
    const before = best.value;
    const node: Node = {
      ref: { key: `${pass}`, presses: [], clock: clock(w0), holds: [], world: w0 },
      value: valueOf(team, judge, end),
      done: root.done,
      choices: root.done ? [] : choicesOf(w0, [], waits, !!opts.holds),
    };
    await beamPass(node);
    // Nothing better found: another pass would play the same.
    if (pass > 0 && best.value <= before) break;
  }
  return { fight: fightOf(team, policy, seconds, best.presses), policy };

  async function beamPass(root: Node): Promise<void> {
    let ways = [root];
    while (ways.some((x) => !x.done) && played < budget) {
      const next: Node[] = ways.filter((x) => x.done);
      const tasks: ChildTask[] = [];
      for (const way of ways) {
        if (way.done) continue;
        way.choices.forEach((choice, i) => tasks.push({ team, policy, end, gap, guide, waits, holds: !!opts.holds, parent: way.ref, choice, key: `${way.ref.key}.${i}` }));
      }
      // A step's ways as one batch; taken in order, up to the budget (a choice that can't be done isn't a way).
      const results = await runner.children(tasks);
      for (const r of results) {
        if (played >= budget) break;
        if (!r.ok) continue;
        played++;
        better(r.value, r.judged);
        next.push({ ref: { key: r.key, presses: r.presses, clock: r.clock, holds: r.holds, world: r.world }, value: r.value, done: r.done, choices: r.choices });
      }
      // The best few; finished ways stay while they're among them.
      next.sort((a, b) => b.value - a.value);
      ways = next.slice(0, width);
    }
  }
}

/** A fight replayed from its presses (the list fills in nothing: the presses are the whole of it). */
export function fightOf(team: Team, policy: Policy, seconds: number, presses: Press[], watch?: (w: World) => void): Fight {
  return play(team, { ...policy, order: [] }, seconds, presses, Math.round(seconds * FPS) + 1, watch);
}
