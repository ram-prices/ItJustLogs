/**
 * The Rotations page's side of the simulator: what the player sets (team in
 * order of position, Potentials, fight options), the build of each operator
 * the page works out from their loadout, and `runSim`, which equips the team
 * from ef-assets combat data and searches for the best button order (the
 * page's worker calls it). Pure logic.
 */
import { equip, type Base, type Build, type GearData, type WeaponData } from './build';
import { optimizeBuilds, type Optimize } from './gearSearch';
import { ELEMENTS, FPS, INFLICTION_NAME, World, buffShown, effectsShown, kindOf, type Bundle, type Enemy, type Input, type Mod, type Stagger, type Strike } from './engine';
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
  /** Parser: the food each operator ate (operator id → FOODS id); a video can't show it. */
  videoFood?: Record<string, string>;
  /** The operator controlled the whole fight (operator id); unset: the search picks. */
  controlled?: string;
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
  /** Operator level (90 unless set); its promotion follows from it (`promotionOf`). */
  level?: number;
  /** Skill ranks (1–12, 12 unless set): basic attack, battle skill, combo, ultimate. */
  ranks?: { basic?: number; normal?: number; combo?: number; ultimate?: number };
  weapon?: { id: string; potential: number; skillLevels?: number[]; level?: number };
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
  /** Who's controlled the whole fight (team slot); unset: the search picks, and Advanced may swap. */
  main?: number;
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
  /**
   * The fight as the boss's bars would show it: seconds on the fight's clock, damage dealt so far, its Stagger meter
   * (World.meterNow; -2 unknown: a search's fight keeps only when it was Staggered, -1).
   */
  track?: [number, number, number][];
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
  mechanics?: { frame: number; label: string }[];
  /** When the enemy couldn't be hit (a recording's `away` stretches), frames on the fight's clock. */
  away?: [number, number][];
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
 * Stagger meter with a node at half, 11 s Staggered, Finishers ×1.75 and 100 SP. Not simulated: its attacks, and the
 * time it can't be hit (a recording's Invulnerable stretches stand in).
 */
export const ALLEIKHREOS: Enemy = {
  // Crisis Calamity, the Re-Crisis-style stage: food allowed and every ultimate full at the start (the owner's
  // account; their recording had Jakub's Legacy on all four and Arcane's ultimate at 0:08.8).
  food: true,
  fullUltimate: true,
  def: 100,
  resist: { Physical: 20, Fire: 20, Pulse: 20, Cryst: 20, Natural: 20 },
  poise: 320,
  staggerSeconds: 11,
  finisherSp: 100,
  finisherMul: 1.75,
  nodes: [0.5],
  nodeBuff: 'buff_common_mini_poise_break',
  // The owner's video (both phases): no Stagger from the Foundite Weapon; it falls about 6 s after the node, and from
  // about 2.5 s after the node, for 6 s, his meter takes none.
  interrupt: { stagger: 20 },
  nodeMechanic: 'Foundite Weapon',
  nodeMechanicAt: 6,
  nodeGuard: { after: 2.5, seconds: 6 },
  phaseHp: 2_476_341,
};
/** Each phase's HP (Lv 90; the second starts at full when the first runs out), so both. */
export const ALLEIKHREOS_HP = 2_476_341 * 2;

/**
 * Skydrummer in Echoes of War's "Howling of Undying Beasts" (eny_0082_hsbear_race007: DungeonTable
 * indie_battletower007, _s, _ex), from EnemyAttributeTemplateTable and the endfield.wiki.gg page: DEF 100, a 320
 * Stagger meter with no node, 9 s Staggered, Finishers ×1.5 and 50 SP, one phase. The stage's own rules: Resistance 50
 * to every element but Ether (the template's; the game text says "gains 50 Resistance against all elements"), no
 * Enraged state, the level by difficulty (Normal 60, Hard 75, Brutal 90: the HP below), only HP tacticals. Its roar
 * (skill08) interrupted in its weakness window gives buff_common_interrupted_face_to_attacker, poise_value 20. Its guard stance
 * is short (see SKYDRUMMER.guard's note).
 * Stage rules as endfield.wiki.gg/wiki/Howling_of_Undying_Beasts lists them (Brutal: no Enraged state, 50 Resistance to all
 * elements on entering battle, better stats, HP Treatment tacticals only; the bonus goal is a clear within 3 minutes).
 */
export const SKYDRUMMER: Enemy = {
  // Echoes of War: no food (only HP Treatment tacticals and consumables), a start button before the fight.
  food: false,
  prep: true,
  def: 100,
  resist: { Physical: 50, Fire: 50, Pulse: 50, Cryst: 50, Natural: 50 },
  poise: 320,
  staggerSeconds: 9,
  finisherSp: 50,
  finisherMul: 1.5,
  nodes: [],
  interrupt: { stagger: 20 },
  // Its guard stance, skill06 (cast below 85%, 55% and 25% HP: ratio_maxhp01..03; buff_eny_0082_hsbear_skill06:
  // ratio_damagetaken -0.9, ratio_def -0.3, its meter healed by a tenth every 0.25 s, default duration 25 s), isn't
  // simulated: at the recording's real HP scale no stretch of the fight shows a tenth of the damage, and 1:45-2:25 of
  // it matches the sim with no stance, so the stance must end with its next skill (finishWithNextSkillIfNotInherited).
  // Enemy.guard is there for an enemy whose stance lasts.
};
/**
 * Each difficulty's HP: the template's at its level (60/75/90) × 3.6. The stage's spawners
 * (SpawnerConfig sc_indie_tower001_43000010047/48/49) give it buff_dung_maxhp_01 at birth with ratio 2.6, a MaxHp
 * Multiplier (+260%); the owner's Brutal recording agrees (its first Finisher, 296,434, took 7.7% of the bar).
 */
export const SKYDRUMMER_HP = { brutal: 3_962_146, hard: 2_196_709, normal: 1_069_218 };

/** The enemies a fight can be against: the name shown, its numbers, its HP for an HP goal, and how a video names it. */
/**
 * The enemies the sim has; `icon` is the game's template id, its picture ef-assets icons/enemies/<icon>.webp, and `face`
 * where its face is in that picture (x, y as shares of it) and how far to zoom in on it.
 */
export const ENEMIES: { id: string; name: string; enemy: Enemy; hp: number; seen: RegExp; icon: string; face: [number, number, number] }[] = [
  { id: 'dummy', name: 'Training dummy', enemy: DUMMY, hp: DEFAULT_HP, seen: /dummy/i, icon: 'eny_0051_rodin', face: [0.45, 0.28, 2.5] },
  { id: 'alleikhreos', name: 'Alleikhreos (Crisis Calamity)', enemy: ALLEIKHREOS, hp: ALLEIKHREOS_HP, seen: /alleikhreos/i, icon: 'eny_0125_fdcentur', face: [0.42, 0.4, 2.6] },
  // One phase: its HP as phaseHp, so a recording's bar and the Parser's fit know the boss's size.
  { id: 'skydrummer', name: 'Skydrummer (Echoes of War, Brutal)', enemy: { ...SKYDRUMMER, phaseHp: SKYDRUMMER_HP.brutal }, hp: SKYDRUMMER_HP.brutal, seen: /skydrummer/i, icon: 'eny_0082_hsbear', face: [0.21, 0.52, 2.4] },
  { id: 'skydrummer-hard', name: 'Skydrummer (Echoes of War, Hard)', enemy: { ...SKYDRUMMER, phaseHp: SKYDRUMMER_HP.hard }, hp: SKYDRUMMER_HP.hard, seen: /skydrummer.*hard/i, icon: 'eny_0082_hsbear', face: [0.21, 0.52, 2.4] },
  { id: 'skydrummer-normal', name: 'Skydrummer (Echoes of War, Normal)', enemy: { ...SKYDRUMMER, phaseHp: SKYDRUMMER_HP.normal }, hp: SKYDRUMMER_HP.normal, seen: /skydrummer.*normal/i, icon: 'eny_0082_hsbear', face: [0.21, 0.52, 2.4] },
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
export const INPUT_NAME: Record<Input, string> = { attack: 'Basic attack', battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', swap: 'Swap in', dive: 'Dive attack' };

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
  main?: number;
}

/** A fight's team from what it's made of and the combat data. */
export function teamFromSpec(spec: TeamSpec, data: SimData): Team {
  const built = spec.builds.map((b, i) => {
    const build: Build = { level: b.level, promotion: promotionOf(b), weapon: b.weapon && { id: b.weapon.id, level: b.weapon.level, potential: b.weapon.potential, skillLevels: b.weapon.skillLevels }, gear: b.gear };
    const r = equip(data.ops[b.op], build, b.weapon ? data.weapons[b.weapon.id] : undefined, data.gear);
    // Its skill ranks: each of the operator's skills by kind (kindOf), its sub-skills with it. Only its own: a bundle
    // can carry other operators' skills (Tangtang's has Yvonne's attacks), and skill levels are one map for the team.
    // By name, not number: the data misnumbers some (chr_032_lizhiyan_combo_skill_abilityentity_seal).
    if (b.ranks) {
      const levels = { ...(r.bundle.levels ?? {}) };
      const own = `_${b.op.replace(/^chr_\d+_/, '')}_`;
      for (const id of Object.keys(r.bundle.skills).filter((x) => x.includes(own))) {
        const rank = b.ranks[rankKind(id, r.bundle) as keyof NonNullable<SimBuild['ranks']>];
        if (rank) levels[id] = rank;
      }
      r.bundle = { ...r.bundle, levels };
    }
    const extra = spec.extra?.[i];
    // Food only where the stage allows it (Enemy.food).
    const food = b.food && spec.enemy?.food !== false ? FOODS[b.food]?.mod : undefined;
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
    ...(spec.main != null ? { main: spec.main } : {}),
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
      // An operator picked to be controlled stays so: no swaps.
      rules: req.main != null ? { ...STYLE_RULES[styleOf(req.style)], swaps: false } : STYLE_RULES[styleOf(req.style)],
      ...(req.main != null ? { main: req.main } : {}),
      ...(req.enemy ? { enemy: req.enemy } : {}),
      ...(req.uptime != null && req.uptime < 1 ? { uptime: req.uptime } : {}),
    },
    data,
  );

/** Searches for the best button order; `progress` hears of each better fight. A pool runner plays fights on several threads. */
export async function runSim(req: SimRequest, data: SimData, progress?: (p: SimProgress) => void, runner: Runner = localRunner): Promise<SimResult> {
  const start = Date.now();
  if (req.optimize) {
    // From the player's loadouts (when given), from nothing, and with each operator's signature weapon (kept while
    // gear is chosen: a weapon's worth can depend on a rotation built around it, which one fixed rotation doesn't
    // show): the search improves on where it starts, so each is tried and the best kept.
    const opt = req.optimize;
    const bare = req.builds.map((b) => ({ ...b, gear: [] }));
    const starts: { builds: SimBuild[]; opt: typeof opt }[] = [
      ...(req.builds.some((b) => b.gear.length) ? [{ builds: req.builds, opt }] : []),
      { builds: bare, opt },
    ];
    const sig = req.builds.map((b, i) => (opt.signatures?.[b.op] && opt.weapons[i].includes(opt.signatures[b.op]) ? opt.signatures[b.op] : undefined));
    if (sig.some(Boolean))
      starts.push({
        builds: bare.map((b, i) => (sig[i] ? { ...b, weapon: { id: sig[i]!, potential: b.weapon?.potential ?? 0 } } : b)),
        opt: { ...opt, weapons: opt.weapons.map((w, i) => (sig[i] ? [sig[i]!] : w)) },
      });
    let done = 0;
    const found: SimBuild[][] = [];
    for (const { builds, opt } of starts) {
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
    const judge = async (builds: SimBuild[]) => scoreOf((await search(teamOf({ ...req, builds }, data), { seconds: req.seconds, budget: 120, pressByPress: false }, runner)).fight);
    const scores: number[] = [];
    for (const builds of found) scores.push(await judge(builds));
    req = { ...req, builds: found[scores.indexOf(Math.max(...scores))] };
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
/** A fight's damage over time every quarter second, and whether it was Staggered (its meter isn't kept). */
function trackOf(f: Fight): [number, number, number][] {
  const hits = f.hits.slice().sort((a, b) => a.frame - b.frame);
  const out: [number, number, number][] = [];
  let dealt = 0;
  let i = 0;
  for (let t = 0; t <= f.seconds + 1e-9; t += 0.25) {
    while (i < hits.length && hits[i].frame / FPS <= t) dealt += hits[i++].amount;
    out.push([t, Math.round(dealt), (f.staggers ?? []).some((s) => t * FPS >= s.frame && t * FPS < s.end) ? -1 : -2]);
  }
  return out;
}

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
    mechanics: f.mechanics,
    ...(f.away?.length ? { away: f.away } : {}),
    track: trackOf(f),
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
  input: 'battle' | 'combo' | 'ultimate' | 'strike' | 'finisher' | 'dive';
  /** It interrupted the enemy's attack (Enemy.interrupt). */
  interrupt?: boolean;
  /** A battle skill: the SP it gave back in the recording (what it reached: Tangtang's Whirlpools, 20 each). */
  back?: number;
}

/**
 * Battle skills that give SP back for each of the operator's summons they reach: the SP for 1, 2... of them (the
 * skill table's atb_return tiers), so a recording's SP back says how many were in reach (the sim has no positions;
 * the boss moves away from a Whirlpool).
 */
const SP_BACK_REACH: Record<string, number[]> = {
  chr_0027_tangtang: [20, 40],
};

/**
 * A battle skill's SP gained as the game gives it: a recording's reading (the bar's rise less regeneration, a point
 * or two off) to the nearest amount the skill can give (SP_BACK_REACH: Tangtang 20 a Whirlpool), 0 if none was in
 * reach. Without an operator, any operator's amounts.
 */
export function spGained(back: number | undefined, op?: string): number | undefined {
  if (back === undefined) return undefined;
  const tiers = op ? SP_BACK_REACH[op] : [...new Set(Object.values(SP_BACK_REACH).flat())].sort((a, b) => a - b);
  if (!tiers?.length) return back;
  const reach = tiers.filter((sp) => back >= sp - 6).length;
  return reach ? tiers[reach - 1] : 0;
}

/** A video's rotation played in the sim: the fight, and the presses the sim couldn't make near their time. */
export interface ReplayResult extends SimResult {
  missed: { t: number; slot: number; input: Input | 'strike' }[];
  /**
   * The damage each action made, by second of the fight ([second, damage] pairs, so a recording's fit can scale it as
   * it scales that second), in the order of `presses` and `strikes`: a battle skill, combo or ultimate gets its
   * operator's hits of that kind until their next press of it; a Final Strike or Finisher gets their basic attacks'
   * hits up to it (and its own projectiles just after).
   */
  actionDamage?: { presses: [number, number][][]; strikes: [number, number][][] };
  /**
   * How SP moved with each action, in the order of `presses` and `strikes`: a battle skill's cost (and anything else
   * the press's first frame changed), a Final Strike's or Finisher's gain. The SP bar itself is `spTrack`.
   */
  actionSp?: { presses: number[]; strikes: number[]; pressesAfter?: number[]; strikesAfter?: number[] };
  /** SP (0–300) every 8 frames on the fight's clock: [seconds, SP]. */
  spTrack?: [number, number][];
  /** The buffs the game would show on each operator and the enemy, as stretches on the fight's clock: `BuffSpan`. */
  buffs?: BuffSpan[];
  /** Damage each second of the fight by `<operator>|<source>`, so the recording's own damage can be split the same way. */
  perSecond?: Record<string, number>[];
  /**
   * The sim's clear time (seconds on the fight's clock): when its damage emptied the last phase's HP, within the
   * recording or, short of that, fighting on after its end (`clearOn`). No time limit.
   */
  clear?: number;
  /** The sim's damage by then: `total`, plus what the fight after the recording's end dealt (the last phase's rest). */
  clearTotal?: number;
  /**
   * The sim's fight after the recording's end, to its clear (`clearOn`), on the fight's clock: its presses, Final
   * Strikes, Staggers, its track (as `track`: damage so far, meter) and SP (as `spTrack`). The Sim view's timeline
   * runs on through it.
   */
  runOn?: { presses: Press[]; strikes: Strike[]; staggers: Stagger[]; track: [number, number, number][]; sp: [number, number][]; lastEnd?: number; freezes?: [number, number][] };
  /** Where the fight's clock stood still for a cut-in (seconds on the fight's clock): no Stagger time passed. */
  freezes?: [number, number][];
}

/** A frozen frame (from `t`, seconds) added to a list of spans, joined to the last one where it follows on. */
function addFreeze(list: [number, number][], t: number): void {
  const last = list.at(-1);
  const to = t + 1 / FPS;
  if (last && t - last[1] <= 0.5 / FPS) last[1] = to;
  else list.push([t, to]);
}

/**
 * A buff (or the enemy's elemental infliction) held from `from` to `to` (seconds on the fight's clock) by an operator
 * (`slot`) or the enemy (-1): its id, its status's name if it is one, and its stacks then (a change starts a new one).
 */
export interface BuffSpan {
  slot: number;
  id: string;
  status?: string;
  from: number;
  to: number;
  stacks: number;
  /** An Arts Reaction's level (1–4) in place of stacks. */
  level?: boolean;
}

/** A video's stopwatch: when it stopped and the stretches it stood still (a phase change), seconds into the fight. */
export interface ReplayClock {
  end: number;
  pauses: [number, number][];
  /** Stretches the enemy couldn't be hit (a boss's untouchable move), seconds into the fight: hits then do nothing. */
  away?: [number, number][];
  /** Stretches the enemy took no Stagger (its meter didn't move: Alleikhreos's Foundite Weapon), seconds into the fight. */
  guard?: [number, number][];
  /**
   * Which pauses (their starts, seconds) are phase changes: the boss's bar was full again after them. Without this
   * list, any pause of PHASE_CHANGE seconds or more is one.
   */
  phases?: number[];
}

/** A stopwatch pause at least this long (seconds) is a phase change, not a cut-in hiding the stopwatch. */
const PHASE_CHANGE = 2;
/** How long (seconds) a Final Strike a buff has waiting takes to land. */
const QUICK_STRIKE = 0.5;
/** How late (seconds) a video's press may be made before it counts as missed. */
const REPLAY_SLACK = 2;

/**
 * A gameplay video's rotation played in the sim, so its damage and DPS can be worked out: each press at its time (or
 * as soon after as it can be, within REPLAY_SLACK), the operator who lands each Final Strike or Finisher controlled
 * from the press before it. Combos don't wait for the sim to see their trigger, nor ultimates for their energy (the
 * video shows the game allowed them: a fight can start with them charged); cooldowns and SP still apply. Times and the length are the video's, cut-ins included.
 */
/**
 * An operator's promotion from their level and skill ranks: the lowest stage whose level range and skill-rank cap hold
 * them (CharBreakStageTable: stage 0–4 up to level 20/40/60/80/90, skill ranks up to 1/3/6/9/12). A level at a stage's
 * cap (80) takes the lower stage: promoting and not levelling is rare.
 */
export function promotionOf(b: SimBuild): number {
  const level = b.level ?? 90;
  const rank = Math.max(0, ...Object.values(b.ranks ?? {}).map((x) => x ?? 0));
  const stages: [number, number][] = [[20, 1], [40, 3], [60, 6], [80, 9], [90, 12]];
  const k = stages.findIndex(([maxLevel, maxRank]) => level <= maxLevel && rank <= maxRank);
  return k < 0 ? 4 : k;
}

/**
 * Which skill rank a skill's level follows: its kind (kindOf), or for a passive that levels with a skill, that skill's.
 * Tangtang's passive_0 holds her Waterspout's tick (normalskill_atk_scale01: 0.25 at rank 12, 0.2 at 9) and levels
 * with her battle skill, which its keys name; found against the Skydrummer recording's numbers.
 */
function rankKind(id: string, bundle: Bundle): string {
  const kind = kindOf(id);
  if (kind !== 'other') return kind;
  const keys = Object.keys(bundle.patch[id]?.[0]?.values ?? {});
  const named = { normalskill_: 'normal', comboskill_: 'combo', ultimateskill_: 'ultimate' } as Record<string, string>;
  for (const [prefix, k] of Object.entries(named)) if (keys.some((x) => x.startsWith(prefix))) return k;
  return kind;
}

export function replaySim(req: SimRequest, data: SimData, steps: ReplayStep[], stopwatch?: ReplayClock): ReplayResult {
  const start = Date.now();
  const team = teamOf({ ...req, style: 'advanced', uptime: undefined }, data);
  const w = new World(team.bundles, team.stats, team.enemy ?? {}, team.settings);
  w.start(team.potentials);
  if (team.startSp != null) w.sp = team.startSp;
  w.strictCombos = false;
  w.strictUltimates = false;
  // The player stops attacking now and then (dodging, moving) and goes on with the chain after: an assumption, 2 s.
  w.chainGrace = REPLAY_SLACK * FPS;
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
  // go on only while the sim has landed fewer Final Strikes than the video by then (the player attacks only so much:
  // dodging, moving, waiting), so it never gets ahead of the recording; and always for what the video's SP bar can't
  // show (World.attacksUnseen: an ultimate's own attacks), not counted against it. A Finisher only where the video
  // shows one: a Staggered enemy the player leaves alone (Yvonne's ultimate instead) takes none.
  const todo: { at: number; slot: number; input: Input; interrupt?: boolean; reach?: number }[] = [];
  const finishers = order.filter((x) => x.input === 'finisher').map((x) => Math.round(x.t * FPS));
  // Each Final Strike the video shows: when the sim starts its chain, a chain's length before it plus however long
  // the operator's own battle and combo skills in between hold it (Yvonne's bomb, 1.1 s, mid-chain) and anyone's
  // ultimate cut-ins stop it while the video's clock runs on (Arcane's before 0:23.9 in the owner's video).
  const shown: number[] = [];
  const shownAt: number[] = [];
  let who = w.controlled;
  let prev = 0;
  for (const x of order) {
    const at = Math.round(x.t * FPS);
    if (x.input === 'strike' || x.input === 'finisher') {
      if (x.slot !== who) todo.push({ at: Math.max(prev, at - chain[x.slot] - FPS), slot: x.slot, input: 'swap' });
      who = x.slot;
      if (x.input === 'strike') {
        let from = at - chain[x.slot];
        for (let held = -1, pass = 0; pass < 3 && held !== 0; pass++) {
          held = 0;
          for (const y of order) {
            const yt = Math.round(y.t * FPS);
            if (yt >= at) continue;
            // A cut-in counts for what of it falls after the chain would start.
            if (y.input === 'ultimate') held += Math.max(0, Math.min(w.cutInOf(y.slot), yt + w.cutInOf(y.slot) - from));
            else if (yt >= from && y.slot === x.slot && (y.input === 'battle' || y.input === 'combo')) held += w.holdOf(y.slot, y.input);
          }
          const next = at - chain[x.slot] - held;
          held = from - next;
          from = next;
        }
        shown.push(from);
        shownAt.push(at);
      }
    } else if (x.input === 'dive') {
      // A dive is the controlled operator's: someone else's needs a swap first.
      if (x.slot !== who) todo.push({ at: Math.max(prev, at - FPS), slot: x.slot, input: 'swap' });
      who = x.slot;
      todo.push({ at, slot: x.slot, input: 'dive' });
    } else {
      // A battle skill's SP back: how many of its summons it reached (none, when the recording shows none back).
      const tiers = x.input === 'battle' ? SP_BACK_REACH[w.team[x.slot]?.id ?? ''] : undefined;
      const reach = tiers ? tiers.filter((sp) => (x.back ?? 0) >= sp - 6).length : undefined;
      todo.push({ at, slot: x.slot, input: x.input, ...(x.interrupt ? { interrupt: true } : {}), ...(reach !== undefined ? { reach } : {}) });
    }
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
  w.away = (stopwatch?.away ?? []).map(([a, b]) => [Math.round(a * FPS), Math.round(b * FPS)]);
  w.noStagger = (stopwatch?.guard ?? []).map(([a, b]) => [Math.round(a * FPS), Math.round(b * FPS)]);
  const clockAt: number[] = [];
  const toClock = (frame: number) => game(clockAt[frame] ?? frame + w.frozenFrames);
  let k = 0;
  // A pause is a phase change: the fight goes on with the SP it starts with (the owner's Alleikhreos video: 64 SP
  // before the black screen, 200 after; a refill, assumed: never down).
  let resumed = 0;
  // Strikes the video can't show (attacksUnseen).
  let free = 0;
  const track: [number, number, number][] = [];
  const spTrack: [number, number][] = [];
  // Each action's SP change: a press's over its first frame, a strike's over the frame it landed in.
  const pressSp: number[] = [];
  const strikeSp: number[] = [];
  const pressAfter: number[] = [];
  const strikeAfter: number[] = [];
  let pendingSp: { i: number; before: number } | null = null;
  // The buffs shown on each operator and the enemy, sampled with the bars: stretches still open by key.
  const buffs: BuffSpan[] = [];
  const freezes: [number, number][] = [];
  const holding = new Map<string, BuffSpan>();
  const noteBuffs = (t: number) => {
    const now = new Set<string>();
    const hold = (slot: number, id: string, stacks: number, status?: string, level?: boolean) => {
      const key = `${slot}|${id}`;
      now.add(key);
      const o = holding.get(key);
      // A new stretch each time its stacks change, so the stacks shown are the ones at that moment.
      if (o && o.stacks === stacks) o.to = t;
      else {
        if (o) o.to = t;
        const s: BuffSpan = { slot, id, ...(status ? { status } : {}), from: t, to: t, stacks, ...(level ? { level } : {}) };
        holding.set(key, s);
        buffs.push(s);
      }
    };
    w.team.forEach((e, slot) => {
      for (const b of e.buffs) {
        const s = buffShown(b);
        if (s) hold(slot, s.id, b.stacks, s.status);
      }
    });
    for (const b of w.enemy.buffs) {
      const s = buffShown(b);
      if (s) hold(-1, s.id, s.level ?? b.stacks, s.status, s.level !== undefined);
    }
    for (const x of ELEMENTS) {
      const n = w.enemy.bb.get(`inflict_${x}`) ?? 0;
      if (n > 0) hold(-1, `inflict_${x}`, n, INFLICTION_NAME[x]);
    }
    // Susceptibility, Amp and Haste: effects, not buffs, but the game shows each as an icon too.
    w.team.forEach((e, slot) => {
      for (const x of effectsShown(e, w.frame)) hold(slot, x.id, 1, x.name);
    });
    for (const x of effectsShown(w.enemy, w.frame)) hold(-1, x.id, 1, x.name);
    for (const [key, o] of holding)
      if (!now.has(key)) {
        o.to = t;
        holding.delete(key);
      }
  };
  while (clock() < end) {
    if (clock() % 8 === 0 && !paused(clock())) {
      track.push([Math.round((game(clock()) / FPS) * 100) / 100, Math.round(w.dealt), Math.round(w.meterNow() * 1000) / 1000]);
      spTrack.push([Math.round((game(clock()) / FPS) * 100) / 100, Math.round(w.sp)]);
      noteBuffs(Math.round((game(clock()) / FPS) * 100) / 100);
    }
    clockAt[w.frame] ??= clock();
    while (resumed < pauses.length && clock() >= pauses[resumed][1]) {
      const [from, to] = pauses[resumed];
      const phase = stopwatch?.phases ? stopwatch.phases.some((p) => Math.abs(Math.round(p * FPS) - from) <= 1) : to - from >= PHASE_CHANGE * FPS;
      if (phase) {
        w.sp = Math.max(w.sp, team.startSp ?? START_SP);
        w.newPhase();
      }
      resumed++;
    }
    let pressed = false;
    while (k < todo.length && todo[k].at <= clock()) {
      const p = todo[k];
      if (p.reach !== undefined) w.reachOnly(p.slot, p.reach);
      const spBefore = w.sp;
      if (w.press(p.slot, p.input)) {
        if (p.interrupt) w.interrupt(p.slot);
        presses.push({ frame: game(clock()), slot: p.slot, input: p.input, at: game(clock()) });
        pressSp.push(w.sp - spBefore);
        pressAfter.push(w.sp);
        pendingSp = { i: pressSp.length - 1, before: spBefore };
        pressed = true;
        k++;
      } else if (clock() - p.at > REPLAY_SLACK * FPS) {
        missed.push({ t: game(p.at) / FPS, slot: p.slot, input: p.input });
        k++;
      } else break;
    }
    // An attack a buff has waiting (Yvonne's talent: the Final Strike at once) goes just before the video's.
    const quick = w.strikeWaiting(w.controlled);
    const due = shown.filter((from, k) => (quick ? shownAt[k] - QUICK_STRIKE * FPS : from) <= clock()).length;
    const unseen = w.attacksUnseen(w.controlled);
    // A Finisher only when the video shows one by about now (its SP refill: the parser reads them).
    const finisher = w.finisherWaiting() && w.strikes.filter((x) => x.finisher).length < finishers.filter((at) => at <= clock() + FPS).length;
    if (!pressed && !paused(clock()) && (unseen || finisher || w.strikes.length - free < due)) w.press(w.controlled, 'attack');
    const before = w.strikes.length;
    const stood = paused(clock());
    // While the recording's stopwatch stands still the game's timer does, and no SP regenerates.
    w.holdSp = stood;
    const f0 = w.frame;
    const spTick = w.sp;
    const z0 = w.frozenFrames;
    const c0 = clock();
    w.tick();
    if (w.frozenFrames > z0 && !stood) addFreeze(freezes, game(c0) / FPS);
    // A press's cost can land in the frame after it.
    if (pendingSp) {
      pressSp[pendingSp.i] = Math.round(w.sp - pendingSp.before);
      pressAfter[pendingSp.i] = w.sp;
      pendingSp = null;
    }
    for (let k = before; k < w.strikes.length; k++) {
      strikeSp[k] = Math.round(w.sp - spTick);
      strikeAfter[k] = w.sp;
    }
    // The stopwatch stood still (a cut-in) while the sim ran on: the boss's Staggered time stands still too.
    if (stood) w.holdStagger(w.frame - f0);
    for (const x of w.strikes.slice(before)) if (x.unseen || w.attacksUnseen(x.slot)) free++;
  }
  const { at: clear, runOn } = clearOn(w, team.enemy?.phaseHp ?? team.hp, pauses, clockAt, end, game);
  for (; k < todo.length; k++) missed.push({ t: game(todo[k].at) / FPS, slot: todo[k].slot, input: todo[k].input });
  // A video Final Strike with none of the sim's near it, in fight frames: a cut-in between the two (the video's
  // strike landing as an ultimate stops time) doesn't count.
  const frameAt = (c: number) => {
    const f = clockAt.findIndex((x) => x !== undefined && x >= c);
    return f < 0 ? w.frame : f;
  };
  const landed = w.strikes.map((x) => x.frame);
  for (const x of order.filter((y) => y.input === 'strike' || y.input === 'finisher')) {
    const at = Math.round(x.t * FPS);
    const i = landed.findIndex((f) => Math.abs(f - frameAt(at)) <= REPLAY_SLACK * FPS);
    if (i < 0) missed.push({ t: game(at) / FPS, slot: x.slot, input: 'strike' });
    else landed.splice(i, 1);
  }
  missed.sort((a, b) => a.t - b.t);
  const byOperator: Record<string, number> = {};
  let total = 0;
  // Each phase's HP (Enemy.phaseHp): a phase before the last stops at its floor, the last at none; damage past that
  // is lost, as on the boss's bar.
  const foe = team.enemy ?? {};
  const phaseAt = pauses.filter(([a, b]) => b - a >= PHASE_CHANGE * FPS).map(([a]) => a);
  const dealt = phaseAt.map(() => 0).concat(0);
  const hits = w.hits.map((h) => {
    if (!foe.phaseHp) return { ...h, frame: toClock(h.frame) };
    const phase = phaseAt.filter((a) => (clockAt[h.frame] ?? h.frame) >= a).length;
    const room = foe.phaseHp * (phase < phaseAt.length ? 1 - (foe.phaseFloor ?? 0) : 1) - dealt[phase];
    const amount = Math.max(0, Math.min(h.amount, room));
    dealt[phase] += amount;
    return { ...h, amount, frame: toClock(h.frame) };
  });
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
    mechanics: w.mechanics.map((m) => ({ ...m, frame: toClock(m.frame) })),
    away: w.away.map(([a, b]) => [game(a), game(b)] as [number, number]),
  };
  const actionDamage = damageByAction(hits, f.presses, f.strikes ?? [], req.builds.map((b) => b.op));
  const perSecond: Record<string, number>[] = [];
  for (const h of hits) {
    if (!h.amount) continue;
    const k = Math.max(0, Math.floor(h.frame / FPS));
    while (perSecond.length <= k) perSecond.push({});
    const key = `${h.operator}|${sourceOf(h.skill, h.skillKind)}`;
    perSecond[k][key] = (perSecond[k][key] ?? 0) + h.amount;
  }
  const actionSp = {
    presses: pressSp.map(Math.round),
    strikes: (f.strikes ?? []).map((_, k) => strikeSp[k] ?? 0),
    pressesAfter: pressAfter.map(Math.round),
    strikesAfter: (f.strikes ?? []).map((_, k) => Math.round(strikeAfter[k] ?? 0)),
  };
  const lastHp = team.enemy?.phaseHp ?? team.hp ?? 0;
  const clearTotal = clear !== undefined ? Math.round(total + Math.max(0, lastHp - (foe.phaseHp ? dealt[dealt.length - 1] : total))) : undefined;
  return { ...summary(f, req, start), missed, track, perSecond, actionDamage, actionSp, spTrack, buffs, freezes: freezes.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), ...(clear !== undefined ? { clear, clearTotal } : {}), ...(runOn ? { runOn } : {}) };
}

/**
 * The sim's clear time in a replay (ReplayResult.clear): the hit that empties the last phase's HP (counted from the
 * recording's last phase change), or, if the recording ended first, a copy of the fight going on from there the
 * Basic way (combos and ultimates as they come, battle skills in team order in turn, the controlled operator
 * attacking) until it does. Up to 10 minutes more; the clock runs through cut-ins, as the game timer does.
 */
function clearOn(w: World, hp: number | undefined, pauses: number[][], clockAt: number[], end: number, game: (c: number) => number): { at?: number; runOn?: ReplayResult['runOn'] } {
  if (!hp) return {};
  const last = pauses.filter(([a, b]) => b - a >= PHASE_CHANGE * FPS).at(-1)?.[0] ?? 0;
  const at = (frame: number) => clockAt[frame] ?? frame + w.frozenFrames;
  let base = 0;
  let dealt = 0;
  for (const h of w.hits) {
    if (at(h.frame) < last) base += h.amount;
    else if ((dealt += h.amount) >= hp) return { at: Math.round((game(at(h.frame)) / FPS) * 100) / 100 };
  }
  const c = w.clone();
  c.strictCombos = true;
  c.strictUltimates = true;
  c.away = [];
  c.noStagger = [];
  c.holdSp = false;
  const n = c.team.length;
  let turn = 0;
  const from = c.frame + c.frozenFrames;
  // On the fight's clock: the recording's end, then this copy's frames (its stopped time too, as the game timer runs).
  const fight = (cf: number) => game(end) + cf - from;
  const secs = (cf: number) => Math.round((fight(cf) / FPS) * 100) / 100;
  const clockOf: number[] = [];
  const runOn: NonNullable<ReplayResult['runOn']> = { presses: [], strikes: [], staggers: [], track: [], sp: [], freezes: [] };
  const strikes0 = c.strikes.length;
  const staggers0 = c.staggers.length;
  const press = (slot: number, input: Input) => {
    if (!c.press(slot, input)) return false;
    runOn.presses.push({ frame: fight(c.frame + c.frozenFrames), slot, input, at: fight(c.frame + c.frozenFrames) });
    return true;
  };
  while (c.dealt - base < hp && c.frame + c.frozenFrames - from < 600 * FPS) {
    const cf = c.frame + c.frozenFrames;
    clockOf[c.frame] ??= cf;
    if ((cf - from) % 8 === 0) {
      runOn.track.push([secs(cf), Math.round(c.dealt), Math.round(c.meterNow() * 1000) / 1000]);
      runOn.sp.push([secs(cf), Math.round(c.sp)]);
    }
    let pressed = false;
    for (const input of ['combo', 'ultimate'] as Input[]) for (let s = 0; s < n && !pressed; s++) pressed = press(s, input);
    for (let k = 0; k < n && !pressed && !c.can(turn % n, 'battle', true); k++) turn++;
    if (!pressed && (pressed = press(turn % n, 'battle'))) turn++;
    if (!pressed) c.press(c.controlled, 'attack');
    const z0 = c.frozenFrames;
    c.tick();
    if (c.frozenFrames > z0) addFreeze(runOn.freezes!, fight(cf) / FPS);
  }
  if (c.dealt - base < hp) return {};
  const cf = c.frame + c.frozenFrames;
  runOn.track.push([secs(cf), Math.round(c.dealt), Math.round(c.meterNow() * 1000) / 1000]);
  runOn.sp.push([secs(cf), Math.round(c.sp)]);
  const onClock = (f: number) => fight(clockOf[f] ?? f + c.frozenFrames);
  runOn.strikes = c.strikes.slice(strikes0).map((x) => ({ ...x, frame: onClock(x.frame) }));
  runOn.staggers = c.staggers.slice(staggers0).map((x) => ({ ...x, frame: onClock(x.frame), end: Math.min(cf - from + game(end), onClock(x.end)) }));
  // A Stagger running when the recording ended: where it really ends.
  const open = c.staggers[staggers0 - 1];
  if (open && open.end > (clockOf.findIndex((x) => x !== undefined) || c.frame)) runOn.lastEnd = Math.min(cf - from + game(end), onClock(open.end));
  return { at: secs(cf), runOn };
}

/** Which action each hit belongs to (ReplayResult.actionDamage): by its operator and skill kind, on the fight's clock. */
function damageByAction(
  hits: { frame: number; operator: string; amount: number; skillKind?: string }[],
  presses: { frame: number; slot: number; input: Input }[],
  strikes: { frame: number; slot: number }[],
  ops: string[],
): NonNullable<ReplayResult['actionDamage']> {
  const INPUT: Record<string, Input> = { normal: 'battle', combo: 'combo', ultimate: 'ultimate' };
  const slotOf = new Map(ops.map((op, i) => [op, i]));
  const byPress = presses.map(() => new Map<number, number>());
  const byStrike = strikes.map(() => new Map<number, number>());
  const add = (m: Map<number, number>, frame: number, amount: number) => {
    const s = Math.floor(frame / FPS);
    m.set(s, (m.get(s) ?? 0) + amount);
  };
  const late = Math.round(0.5 * FPS);
  for (const h of hits) {
    const slot = slotOf.get(h.operator);
    if (!h.amount || slot === undefined) continue;
    const input = INPUT[h.skillKind ?? ''];
    if (input) {
      let i = -1;
      for (let k = 0; k < presses.length && presses[k].frame <= h.frame; k++) if (presses[k].slot === slot && presses[k].input === input) i = k;
      if (i >= 0) add(byPress[i], h.frame, h.amount);
    } else if (h.skillKind === 'basic') {
      // Its own Final Strike's projectiles land a moment after it; any other basic hit belongs to the next one.
      let j = strikes.findIndex((s) => s.slot === slot && s.frame <= h.frame && h.frame - s.frame <= late);
      if (j < 0) j = strikes.findIndex((s) => s.slot === slot && s.frame >= h.frame);
      if (j >= 0) add(byStrike[j], h.frame, h.amount);
    }
  }
  const pairs = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([s, d]) => [s, Math.round(d)] as [number, number]);
  return { presses: byPress.map(pairs), strikes: byStrike.map(pairs) };
}
