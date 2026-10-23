/**
 * The Rotations page's side of the simulator: what the player sets (team in
 * order of position, Potentials, fight options), the build of each operator
 * the page works out from their loadout, and `runSim`, which equips the team
 * from ef-assets combat data and searches for the best button order (the
 * page's worker calls it). Pure logic.
 */
import { equip, type Base, type Build, type GearData, type WeaponData } from './build';
import { optimizeBuilds, type Optimize } from './gearSearch';
import { FPS, World, kindOf, type Bundle, type Enemy, type Input, type Mod, type Stagger, type Strike } from './engine';
import { beam, fightOf, localRunner, scoreOf, search, searchCycle, type Fight, type Press, type Rules, type Runner, type Team } from './rotation';

/** One team position: the operator and, when set, Potentials other than the player's own. */
export interface SimMember {
  op: string;
  /** The operator's Potential (unset: the player's copies, else 0). */
  potential?: number;
  /** The weapon's Potential (unset: the player's copies, else 0; Optimal gear: 0). */
  weaponPotential?: number;
  /** Optimal gear: this weapon rather than the best found. */
  weapon?: string;
  /** A food eaten before the fight (FOODS). */
  food?: string;
}

/** Search effort: how many fights the search may play. */
export type Effort = 'quick' | 'normal' | 'thorough';

/**
 * How the rotation is played. Advanced: anything goes (swaps, animation cancels, any timing). Standard: one
 * operator controlled the whole fight, no animation cancels, presses at least half a second apart, in any mix.
 * Basic: one operator controlled; combos as they come up, ultimates when charged, battle skills in one order
 * over and over.
 */
export type Style = 'advanced' | 'standard' | 'basic';
export const STYLES: [Style, string][] = [
  ['basic', 'Basic'],
  ['standard', 'Standard'],
  ['advanced', 'Advanced'],
];
/** A saved style (older names: Optimal, Normal, Simple). */
export const styleOf = (x?: string): Style => (x === 'standard' || x === 'normal' ? 'standard' : x === 'basic' || x === 'simple' ? 'basic' : 'advanced');
/** Seconds at least between presses in each style. */
const STYLE_GAP: Record<Style, number> = { advanced: 0, standard: 0.5, basic: 0 };
/** What each style allows. */
const STYLE_RULES: Record<Style, Rules> = {
  advanced: { swaps: true, cancels: true },
  standard: { swaps: false, cancels: false },
  basic: { swaps: false, cancels: false },
};

/** The page's settings (synced like every setting). */
export interface SimSettings {
  /** In team position order: the first is Team Position 01. */
  team?: SimMember[];
  /** Fight length (time), or the fastest way to defeat a dummy with this much HP (hp, within `limit` seconds). */
  goal?: Goal;
  hp?: number;
  limit?: number;
  seconds?: number;
  /** SP at the start (unset: the game's 200). */
  startSp?: number;
  /** The share of the fight the enemy can be hit, in % (unset: 100). */
  uptime?: number;
  style?: Style;
  effort?: Effort;
  /** Builds from the player's loadouts, or the best weapon and gear the sim finds. */
  builds?: BuildMode;
  /** Threads to search on (unset: all but one). The rotation found is the same; only the time changes. */
  cores?: number;
  /** The enemy fought (ENEMIES id; unset: the training dummy). */
  enemy?: string;
  /** Transcript: the food each operator ate (operator id → FOODS id); a video can't show it. */
  videoFood?: Record<string, string>;
}

export type Goal = 'time' | 'hp';
export const GOALS: [Goal, string][] = [
  ['time', 'Fight length'],
  ['hp', 'Enemy HP'],
];
export const DEFAULT_HP = 5_000_000;
/** The HP goal's time limit unless set (seconds). */
export const DEFAULT_LIMIT = 300;

export type BuildMode = 'mine' | 'optimal';
export const BUILD_MODES: [BuildMode, string][] = [
  ['mine', 'My loadouts'],
  ['optimal', 'Optimal gear'],
];

/** An operator as the fight takes them: from the page's loadout and copies. */
export interface SimBuild {
  op: string;
  potential: number;
  weapon?: { id: string; potential: number; skillLevels?: number[] };
  gear: { id: string; artifice: number }[];
  /** A food eaten before the fight (FOODS). */
  food?: string;
}

/**
 * Foods that buff one operator in a fight, from the game's UseItemTable and their buffs (BuffData). Each lasts 300 s,
 * so the whole fight here (eaten just before it).
 */
export const FOODS: Record<string, { name: string; mod: Mod }> = {
  // item_agrange_1_erhound_1_sp_1_1: buff_common_atk_buff_potion_1, ATK +27% (BaseMultiplier).
  jakub: { name: 'Jakub’s Legacy', mod: { attributeType: 'Atk', formulaItem: 'BaseMultiplier', value: 0.27 } },
};

export interface SimRequest {
  builds: SimBuild[];
  /** The fight's length, or with `hp` the time limit for defeating it. */
  seconds: number;
  /** The dummy's HP: the fastest way to defeat it. */
  hp?: number;
  startSp?: number;
  /** The share of the fight the enemy can be hit (0–1; unset: all of it). */
  uptime?: number;
  style: Style;
  effort: Effort;
  /** Optimal gear: the weapons each member may use; gear is chosen too. */
  optimize?: Optimize;
  /** The enemy (unset: the training dummy). */
  enemy?: Enemy;
}

export interface SimProgress {
  /** Choosing weapons and gear, or the rotation. */
  phase: 'gear' | 'rotation';
  /** Best damage per second so far. */
  dps: number;
  /** Fights played, and how many the search may play. */
  played: number;
  budget: number;
  /** HP goal: the best fight so far defeats the dummy in this many seconds. */
  killedIn?: number;
}

export interface SimResult {
  total: number;
  /** The fight's length, or how long defeating the dummy took. */
  seconds: number;
  /** HP goal: defeated within the limit. */
  killed?: boolean;
  hp?: number;
  /** Team slot controlled at the start. */
  main: number;
  presses: Press[];
  /** The controlled operator's Final Strikes and Finishers (between presses: basic attacks up to them). */
  strikes?: Strike[];
  /** When the enemy was Staggered. */
  staggers?: Stagger[];
  /** Basic style: the battle skills in turn (team slot, input); combos and ultimates as they're ready. */
  order?: [number, Input][];
  byOperator: Record<string, number>;
  /** Damage by operator and source (Battle skill, Cryo Burst...), most first. */
  sources: { op: string; source: string; hits: number; total: number }[];
  unknown: [string, number][];
  /** The builds fought with (Optimal gear: the ones chosen). */
  builds: SimBuild[];
  ms: number;
}

/** The ef-assets combat files a fight needs. */
export interface SimData {
  ops: Record<string, Bundle & { base?: Base }>;
  weapons: Record<string, WeaponData>;
  gear: GearData;
  settings: Record<string, { values: number[]; kind?: string }>;
}

/** The first team checked against a community calculation (Arcane, Last Rite, Si, Xaihi). */
export const CHECKED = ['chr_0032_lizhiyan', 'chr_0026_lastrite', 'chr_0036_jsspsi', 'chr_0011_seraph'];
export const DEFAULT_TEAM: SimMember[] = CHECKED.map((op) => ({ op }));
export const DEFAULT_SECONDS = 60;
/** The game's SP at the start of a fight. */
export const START_SP = 200;

/**
 * The training dummy (Rodin dummy, eny_0051_rodin_dummy): DEF 100, a 280
 * Stagger meter with a stumble at half, Staggered for 12 s, a Finisher gives
 * 100 SP. The meter and time are read from the enemy template's attributes.
 */
export const DUMMY: Enemy = { def: 100, poise: 280, staggerSeconds: 12, finisherSp: 100, nodes: [0.5], nodeBuff: 'buff_common_mini_poise_break' };

/**
 * Alleikhreos, Chiliarch (eny_0125_fdcentur, Crisis Calamity: level 90), from EnemyAttributeTemplateTable and the
 * endfield.wiki.gg page: HP 2,476,341 a phase (two phases), DEF 100, Resistance 20 to every element but Ether, a 320
 * Stagger meter with a node at half, 11 s Staggered, Finishers ×1.75 and 100 SP. Not simulated: its attacks, the
 * Foundite Weapon at the node, and the time it can't be hit (phase change, teleports).
 */
export const ALLEIKHREOS: Enemy = {
  def: 100,
  resist: { Physical: 20, Fire: 20, Pulse: 20, Cryst: 20, Natural: 20 },
  poise: 320,
  staggerSeconds: 11,
  finisherSp: 100,
  finisherMul: 1.75,
  nodes: [0.5],
  nodeBuff: 'buff_common_mini_poise_break',
};
export const ALLEIKHREOS_HP = 2_476_341 * 2;

/** The enemies a fight can be against: the name shown, its numbers, its HP for an HP goal, and how a video names it. */
export const ENEMIES: { id: string; name: string; enemy: Enemy; hp: number; seen: RegExp }[] = [
  { id: 'dummy', name: 'Training dummy', enemy: DUMMY, hp: DEFAULT_HP, seen: /dummy/i },
  { id: 'alleikhreos', name: 'Alleikhreos (Crisis Calamity)', enemy: ALLEIKHREOS, hp: ALLEIKHREOS_HP, seen: /alleikhreos/i },
];
export const enemyById = (id?: string) => ENEMIES.find((e) => e.id === id) ?? ENEMIES[0];
/** The enemy a video's boss bar names, if it's one the sim has. */
export const enemySeen = (name?: string) => (name ? ENEMIES.find((e) => e.seen.test(name)) : undefined);

/** Fights the search plays at each effort: the priority list first, then press by press (rotation.ts beam). */
export const EFFORT: Record<Effort, { list: number; width: number; passes: number; budget: number }> = {
  quick: { list: 80, width: 2, passes: 1, budget: 1200 },
  normal: { list: 200, width: 4, passes: 2, budget: 5000 },
  thorough: { list: 300, width: 4, passes: 3, budget: 12000 },
};

const ELEMENT: Record<string, string> = { cryst: 'Cryo', natural: 'Nature', pulse: 'Electric', fire: 'Heat' };
const REACTION: Record<string, string> = { cryst: 'Solidification', natural: 'Corrosion', pulse: 'Electrification', fire: 'Combustion' };

/** Where a hit's damage comes from, as the player knows it. */
export function sourceOf(skillId: string, skillKind?: string): string {
  const reaction = /^buff_common_(?:try_)?([a-z]+)_([a-z]+)_/.exec(skillId);
  if (reaction && ELEMENT[reaction[1]]) return reaction[1] === reaction[2] && !/frozen/.test(skillId) ? `${ELEMENT[reaction[1]]} Burst` : (REACTION[reaction[1]] ?? 'Reaction');
  if (/^(buff_)?(sk_)?wpn_|equipsuit/.test(skillId)) return 'Weapon and gear';
  if (/_power_attack/.test(skillId)) return 'Finisher';
  // By its id, else by the kind of skill the hit counts as (Zhuang Fangyi's Thunder Strikes come from a buff).
  const named = kindOf(skillId.replace(/^buff_/, ''));
  const kind = named === 'other' && skillKind ? skillKind : named;
  return { basic: 'Basic attacks', normal: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate' }[kind] ?? 'Other';
}

/** An input as the player presses it. */
export const INPUT_NAME: Record<Input, string> = { attack: 'Basic attack', battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', swap: 'Swap in' };

/** What a fight's team is made of; another thread makes the same team from it with its own copy of the data. */
export interface TeamSpec {
  builds: SimBuild[];
  /** A stat added to members (Optimal gear weighs stats this way). */
  extra?: (Mod | null)[];
  startSp?: number;
  hp?: number;
  rules?: Rules;
  enemy?: Enemy;
  uptime?: number;
}

/** A fight's team from what it's made of and the combat data. */
export function teamFromSpec(spec: TeamSpec, data: SimData): Team {
  const built = spec.builds.map((b, i) => {
    const build: Build = { weapon: b.weapon && { id: b.weapon.id, potential: b.weapon.potential, skillLevels: b.weapon.skillLevels }, gear: b.gear };
    const r = equip(data.ops[b.op], build, b.weapon ? data.weapons[b.weapon.id] : undefined, data.gear);
    const extra = spec.extra?.[i];
    const food = b.food ? FOODS[b.food]?.mod : undefined;
    if (extra || food) r.stats = { ...r.stats, mods: [...(r.stats.mods ?? []), ...(extra ? [extra] : []), ...(food ? [food] : [])] };
    return r;
  });
  return {
    bundles: built.map((x) => x.bundle),
    stats: built.map((x) => x.stats),
    potentials: spec.builds.map((b) => b.potential),
    settings: data.settings,
    enemy: spec.enemy ?? DUMMY,
    startSp: spec.startSp,
    ...(spec.uptime != null && spec.uptime < 1 ? { uptime: spec.uptime } : {}),
    hp: spec.hp,
    rules: spec.rules,
    spec,
  };
}

/** The fight's team from the builds and combat data. */
export const teamOf = (req: SimRequest, data: SimData): Team =>
  teamFromSpec(
    {
      builds: req.builds,
      startSp: req.startSp,
      hp: req.hp,
      rules: STYLE_RULES[styleOf(req.style)],
      ...(req.enemy ? { enemy: req.enemy } : {}),
      ...(req.uptime != null && req.uptime < 1 ? { uptime: req.uptime } : {}),
    },
    data,
  );

/** Searches for the best button order; `progress` hears of each better fight. A pool runner plays fights on several threads. */
export async function runSim(req: SimRequest, data: SimData, progress?: (p: SimProgress) => void, runner: Runner = localRunner): Promise<SimResult> {
  const start = Date.now();
  if (req.optimize) {
    // From the player's loadouts (when given) and from nothing: the search improves on where it starts, so both
    // are tried and the better kept.
    const opt = req.optimize;
    const starts = req.builds.some((b) => b.gear.length) ? [req.builds, req.builds.map((b) => ({ ...b, gear: [] }))] : [req.builds];
    let done = 0;
    const found: SimBuild[][] = [];
    for (const builds of starts) {
      let last = 0;
      found.push(
        await optimizeBuilds(
          { ...req, builds },
          opt,
          data,
          (played, budget) => {
            last = played;
            progress?.({ phase: 'gear', dps: 0, played: done + played, budget: budget * starts.length });
          },
          undefined,
          runner,
        ),
      );
      done += last;
    }
    const judge = async (builds: SimBuild[]) => scoreOf((await search(teamOf({ ...req, builds }, data), { seconds: req.seconds, budget: 40, pressByPress: false }, runner)).fight);
    req = { ...req, builds: found.length > 1 && (await judge(found[1])) > (await judge(found[0])) ? found[1] : found[0] };
  }
  const team = teamOf(req, data);
  const e = EFFORT[req.effort];
  const style = styleOf(req.style);
  const simple = style === 'basic';
  const budget = simple ? e.list * 2 : e.list + e.budget;
  // Progress moves with every fight played (a few times a second), not only with a better one: long fights (an HP
  // goal) can go minutes without one.
  let best = 0;
  let done = 0;
  let shown: SimProgress | null = null;
  let shownAt = 0;
  const show = (now = false) => {
    if (!shown || (!now && Date.now() - shownAt < 250)) return;
    shownAt = Date.now();
    progress?.({ ...shown, played: Math.min(budget, done) });
  };
  const tell = (f: Fight) => {
    if (scoreOf(f) <= best) return;
    best = scoreOf(f);
    shown = { phase: 'rotation', dps: f.total / f.seconds, played: done, budget, killedIn: f.killed ? f.seconds : undefined };
    show(true);
  };
  const counted: Runner = {
    width: runner.width,
    plays: async (tasks) => {
      const out = await runner.plays(tasks);
      done += tasks.length;
      show();
      return out;
    },
    children: async (tasks) => {
      const out = await runner.children(tasks);
      done += tasks.length;
      show();
      return out;
    },
  };
  // Basic: the fixed order alone (no press-by-press changes), so its fight is the order's own.
  const list = simple
    ? await searchCycle(team, { seconds: req.seconds, budget: e.list * 2, progress: tell }, counted)
    : await search(team, { seconds: req.seconds, budget: e.list, progress: tell }, counted);
  const minGap = STYLE_GAP[style];
  let found = list.fight;
  if (!simple) {
    const { fight } = await beam(team, { seconds: req.seconds, policy: list.policy, width: e.width, passes: e.passes, budget: e.budget, minGap, progress: tell }, counted);
    // The press-by-press search starts from the list; keep whichever is better (the list's can be, with few fights).
    if (minGap > 0 || scoreOf(fight) >= scoreOf(list.fight)) found = fight;
  }
  // Fights from other threads come without their hits: the one found is played again here, from its presses.
  const f = found.hits.length ? found : fightOf(team, list.policy, req.seconds, found.presses);
  return { ...summary(f, req, start), ...(simple ? { order: list.policy.order } : {}) };
}

/** A fight as the page shows it: totals, damage by operator and by source. */
function summary(f: Fight, req: SimRequest, start: number): SimResult {
  const sources = new Map<string, { op: string; source: string; hits: number; total: number }>();
  for (const h of f.hits) {
    if (!h.amount) continue;
    const source = sourceOf(h.skill, h.skillKind);
    const key = `${h.operator}|${source}`;
    const s = sources.get(key) ?? { op: h.operator, source, hits: 0, total: 0 };
    s.hits++;
    s.total += h.amount;
    sources.set(key, s);
  }
  return {
    total: f.total,
    seconds: f.seconds,
    ...(req.hp ? { killed: !!f.killed, hp: req.hp } : {}),
    main: f.main,
    presses: f.presses,
    strikes: f.strikes,
    staggers: f.staggers,
    byOperator: f.byOperator,
    sources: [...sources.values()].sort((a, b) => b.total - a.total),
    unknown: f.unknown,
    builds: req.builds,
    ms: Date.now() - start,
  };
}

/** A step read from a gameplay video (ui/rotationReader.ts): seconds from the fight's start, whose (team slot), what. */
export interface ReplayStep {
  t: number;
  slot: number;
  input: 'battle' | 'combo' | 'ultimate' | 'strike' | 'finisher';
}

/** A video's rotation played in the sim: the fight, and the presses the sim couldn't make near their time. */
export interface ReplayResult extends SimResult {
  missed: { t: number; slot: number; input: Input | 'strike' }[];
}

/** A video's stopwatch: when it stopped and the stretches it stood still (a phase change), seconds into the fight. */
export interface ReplayClock {
  end: number;
  pauses: [number, number][];
}

/** A stopwatch pause at least this long (seconds) is a phase change, not a cut-in hiding the stopwatch. */
const PHASE_CHANGE = 2;
/** How late (seconds) a video's press may be made before it counts as missed. */
const REPLAY_SLACK = 2;

/**
 * A gameplay video's rotation played in the sim, so its damage and DPS can be worked out: each press at its time (or
 * as soon after as it can be, within REPLAY_SLACK), the operator who lands each Final Strike or Finisher controlled
 * from the press before it. Combos don't wait for the sim to see their trigger, nor ultimates for their energy (the
 * video shows the game allowed them: a fight can start with them charged); cooldowns and SP still apply. Times and the length are the video's, cut-ins included.
 */
export function replaySim(req: SimRequest, data: SimData, steps: ReplayStep[], stopwatch?: ReplayClock): ReplayResult {
  const start = Date.now();
  const team = teamOf({ ...req, style: 'advanced', uptime: undefined }, data);
  const w = new World(team.bundles, team.stats, team.enemy ?? {}, team.settings);
  w.start(team.potentials);
  if (team.startSp != null) w.sp = team.startSp;
  w.strictCombos = false;
  w.strictUltimates = false;
  const order = steps.slice().sort((a, b) => a.t - b.t);
  const firstHit = order.find((x) => x.input === 'strike' || x.input === 'finisher');
  w.controlled = firstHit?.slot ?? 0;
  const clock = () => w.frame + w.frozenFrames;
  // How long each operator's basic attacks take to reach their Final Strike.
  const chain = w.team.map((_, slot) => {
    const c = w.clone();
    c.controlled = slot;
    while (!c.strikes.length && c.frame < 10 * FPS) {
      c.press(slot, 'attack');
      c.tick();
    }
    return c.frame;
  });
  // The presses to make, and a swap before each Final Strike or Finisher by someone not controlled then. Basic attacks
  // go on only while the sim has landed fewer Final Strikes and Finishers than the video by then (the player attacks
  // only so much: dodging, moving, waiting), so it never gets ahead of the recording.
  const todo: { at: number; slot: number; input: Input }[] = [];
  const shown: number[] = [];
  let who = w.controlled;
  let prev = 0;
  for (const x of order) {
    const at = Math.round(x.t * FPS);
    if (x.input === 'strike' || x.input === 'finisher') {
      if (x.slot !== who) todo.push({ at: Math.max(prev, at - chain[x.slot] - FPS), slot: x.slot, input: 'swap' });
      who = x.slot;
      shown.push(at);
    } else todo.push({ at, slot: x.slot, input: x.input });
    prev = at;
  }
  const presses: Press[] = [];
  const missed: ReplayResult['missed'] = [];
  // The video's clock runs through ultimate cut-ins, which the sim's frames skip: the fight ends at the video's end,
  // and every time shown is the video's (each sim frame's clock when it began).
  // With the video's stopwatch: played to when it stopped, nothing attacked while it stood still, and every time and
  // the length (req.seconds) on it, as the game counts the fight.
  const end = Math.round((stopwatch?.end ?? req.seconds) * FPS);
  const pauses = (stopwatch?.pauses ?? []).map(([a, b]) => [Math.round(a * FPS), Math.round(b * FPS)]);
  const paused = (c: number) => pauses.some(([a, b]) => c >= a && c < b);
  const game = (c: number) => c - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, c) - a), 0);
  const clockAt: number[] = [];
  const toClock = (frame: number) => game(clockAt[frame] ?? frame + w.frozenFrames);
  let k = 0;
  // A pause is a phase change: the fight goes on with the SP it starts with (the owner's Alleikhreos video: 64 SP
  // before the black screen, 200 after; a refill, assumed: never down).
  let resumed = 0;
  while (clock() < end) {
    clockAt[w.frame] ??= clock();
    while (resumed < pauses.length && clock() >= pauses[resumed][1]) {
      if (pauses[resumed][1] - pauses[resumed][0] >= PHASE_CHANGE * FPS) w.sp = Math.max(w.sp, team.startSp ?? START_SP);
      resumed++;
    }
    let pressed = false;
    while (k < todo.length && todo[k].at <= clock()) {
      const p = todo[k];
      if (w.press(p.slot, p.input)) {
        presses.push({ frame: game(clock()), slot: p.slot, input: p.input, at: game(clock()) });
        pressed = true;
        k++;
      } else if (clock() - p.at > REPLAY_SLACK * FPS) {
        missed.push({ t: game(p.at) / FPS, slot: p.slot, input: p.input });
        k++;
      } else break;
    }
    const due = shown.filter((at) => at <= clock() + chain[w.controlled]).length;
    if (!pressed && w.strikes.length < due && !paused(clock())) w.press(w.controlled, 'attack');
    w.tick();
  }
  for (; k < todo.length; k++) missed.push({ t: game(todo[k].at) / FPS, slot: todo[k].slot, input: todo[k].input });
  // A video Final Strike with none of the sim's near it.
  const landed = w.strikes.map((x) => toClock(x.frame));
  for (const x of order.filter((y) => y.input === 'strike' || y.input === 'finisher')) {
    const at = game(Math.round(x.t * FPS));
    const i = landed.findIndex((f) => Math.abs(f - at) <= REPLAY_SLACK * FPS);
    if (i < 0) missed.push({ t: at / FPS, slot: x.slot, input: 'strike' });
    else landed.splice(i, 1);
  }
  missed.sort((a, b) => a.t - b.t);
  const byOperator: Record<string, number> = {};
  let total = 0;
  const hits = w.hits.map((h) => ({ ...h, frame: toClock(h.frame) }));
  for (const h of hits) {
    byOperator[h.operator] = (byOperator[h.operator] ?? 0) + h.amount;
    total += h.amount;
  }
  const f: Fight = {
    total,
    seconds: req.seconds,
    presses,
    byOperator,
    hits,
    unknown: [...w.unknown.entries()].sort((a, b) => b[1] - a[1]),
    main: firstHit?.slot ?? 0,
    strikes: w.strikes.map((x) => ({ ...x, frame: toClock(x.frame) })),
    staggers: w.staggers.map((x) => ({ frame: toClock(x.frame), end: Math.min(game(end), toClock(x.end)) })),
  };
  return { ...summary(f, req, start), missed };
}
