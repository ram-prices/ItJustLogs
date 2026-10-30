import { readFileSync } from 'node:fs';
import { EF_ASSETS } from '../banners';
import { FPS, World, type Input, type Entity, type Enemy } from './engine';
import { teamOf, type SimBuild, type SimData, type SimRequest } from './team';

/**
 * The per-operator rule tests' harness (rules.test.ts): game data in, one operator alone on a dummy, everything the
 * engine did after each press out, and the rules each operator's table is made of. Tests only.
 *
 * Data: ef-assets `combat/` and `wiki/`, from a local clone at EF_ASSETS_DIR (its root) or else fetched from GitHub.
 */

const DIR = process.env.EF_ASSETS_DIR?.replace(/[\\/]?$/, '/');
const cache = new Map<string, Promise<any>>();
export const asset = (path: string): Promise<any> => {
  if (!cache.has(path))
    cache.set(
      path,
      DIR
        ? Promise.resolve(JSON.parse(readFileSync(DIR + path, 'utf8')))
        : fetch(`${EF_ASSETS}/${path}`).then((r) => r.json()),
    );
  return cache.get(path)!;
};

/** The combat data the sim needs for operators alone (no weapons). */
export async function simData(ops: string[]): Promise<SimData> {
  const [gear, settings, ...bundles] = await Promise.all([
    asset('combat/gear.json'),
    asset('combat/settings.json'),
    ...ops.map((op) => asset(`combat/ops/${op}.json`)),
  ]);
  return {
    ops: Object.fromEntries(ops.map((op, i) => [op, bundles[i]])),
    weapons: {},
    gear,
    settings: settings.settings,
  };
}

// ---------------------------------------------------------------------------
// The wiki (ef-assets wiki/operators.json, endfield.wiki.gg, CC BY-SA 4.0)
// ---------------------------------------------------------------------------

export type WikiOp = {
  name: string;
  element: string;
  skills: {
    name: string;
    type: string;
    description: string;
    values: { label: string; ranks: string[] }[];
  }[];
  potentials: { rank: number; description: string }[];
};

/** "180%" → 1.8, "0.018%" → 0.00018, "10" → 10. */
export const num = (s: string): number => (s.trim().endsWith('%') ? Number(s.trim().slice(0, -1)) / 100 : Number(s));

/** The numbers marked in a text, in order: ⟦num|1.2⟧ → 1.2, ⟦num|-15%⟧ → -0.15 (`kind` stagger: ⟦stagger|18⟧). */
export const textNums = (text: string, kind = 'num'): number[] =>
  [...text.matchAll(new RegExp(`⟦${kind}\\|([^⟧]+)⟧`, 'g'))].map((m) => num(m[1].replace(/^\+/, '')));

/** The wiki's element name → the combat data's damage type. */
export const DAMAGE_TYPE: Record<string, string> = {
  Physical: 'Physical',
  Cryo: 'Cryst',
  Heat: 'Fire',
  Electric: 'Pulse',
  Nature: 'Natural',
};

/** What a rule's data side reads: the wiki entry and the combat bundle. */
export class Sources {
  readonly wiki: WikiOp;
  readonly bundle: any;
  readonly id: string;

  constructor(wiki: WikiOp, bundle: any, id: string) {
    this.wiki = wiki;
    this.bundle = bundle;
    this.id = id;
  }

  /**
   * A skill value at a rank (1–12): `type` Basic Attack / Battle Skill / Combo Skill / Ultimate, the label as the wiki
   * writes it. `variant` picks among skills listed twice (Arcane's INT and WILL arrays: 0 and 1); rows of 24 hold a
   * second set of 12 (`set` 1).
   */
  value(type: string, label: string, rank = 12, variant = 0, set = 0): number {
    const row = this.wiki.skills.filter((s) => s.type === type)[variant]?.values.find((v) => v.label === label);
    if (!row) throw new Error(`${this.wiki.name}: no ${type} "${label}"`);
    return num(row.ranks[set * 12 + rank - 1]);
  }

  /** The numbers in a Potential's text, in order. */
  potential(p: number): number[] {
    return textNums(this.wiki.potentials.find((x) => x.rank === p)?.description ?? '');
  }

  /** A number marked in a skill's description (kind: stagger, num). */
  described(type: string, kind = 'stagger', i = 0): number {
    return textNums(this.wiki.skills.find((s) => s.type === type)!.description, kind)[i];
  }

  /** A skill's row in the skill table (SkillPatchTable: cost, cooldown, values) at a level. */
  patch(skill: string, level = 12): { values: Record<string, number>; cooldown: number; cost: number } {
    const rows = this.bundle.patch[skill.startsWith('chr_') ? skill : `${this.id}_${skill}`];
    return rows.find((l: { level: number }) => l.level === level) ?? rows.at(-1);
  }

  skill(id: string): any {
    return this.bundle.skills[id.startsWith('chr_') ? id : `${this.id}_${id}`];
  }

  /** How many steps the basic attack chain has (the wiki's BATK SEQ rows). */
  get chain(): number {
    return this.wiki.skills
      .find((s) => s.type === 'Basic Attack')!
      .values.filter((v) => /^BATK SEQ \d+ Multiplier$/.test(v.label)).length;
  }
}

// ---------------------------------------------------------------------------
// The combat data's skill timelines (the EndfieldData dump's SkillData, as ef-assets combat/ops bundles them)
// ---------------------------------------------------------------------------

const short = (t: string | undefined) =>
  (t ?? '')
    .split(',')[0]
    .split('.')
    .pop()!
    .replace(/\+Data$|\+\w+ActionData$/, '');

/** Every action of a type in a skill's timeline, with its entry's frames. */
export function actions(skill: any, type: string): { frame: number; end: number; data: any }[] {
  const out: { frame: number; end: number; data: any }[] = [];
  for (const ta of skill?.actionGroupData?.timelineActions ?? [])
    for (const d of ta._sequenceActionData?.actionData ?? [])
      if (short(d.$type) === type)
        out.push({
          frame: ta._startFrame ?? 0,
          end: ta._endFrame ?? ta._startFrame ?? 0,
          data: d,
        });
  return out;
}

/**
 * The frame a skill lets its operator act again: its MarkCanInterrupt, else its exclusiveFrame, but never past the
 * skill's end. A skill lasts to the later of its durationFrame and its last timeline entry's start (the engine's
 * stepRun), and a skill that has ended holds no one (`busy`): Typhoeus's ultimate_skillfloating, exclusiveFrame 105,
 * durationFrame 92, its last entry (AllowNextSkillAction) at 100, frees her at 100.
 */
export const freeFrame = (skill: any, jumps: Jump[] = []): number => {
  const marks = actions(skill, 'MarkCanInterrupt').map((m) => m.frame);
  const exclusive = skill?.exclusiveFrame ?? 0;
  const entries: any[] = skill?.actionGroupData?.timelineActions ?? [];
  const length = Math.max(skill?.durationFrame ?? 0, ...entries.map((ta) => ta._startFrame ?? 0));
  // Along the timeline as the skill ran it (its JumpToActions): a jump past a mark skips it, and then exclusiveFrame
  // holds the operator (or a later mark frees them), as an unmarked skill's does.
  let pos = 0;
  let t = 0;
  let pastMark = false;
  for (let i = 0; ; i++) {
    const j = jumps[i];
    const end = j ? j.from : Infinity;
    const free = [
      ...marks.filter((m) => m >= pos && m < end),
      ...(!marks.length || pastMark ? [Math.max(pos, exclusive)] : []),
      Math.max(pos, length),
    ].filter((f) => f < end || !j);
    if (free.length) return t + Math.min(...free) - pos;
    if (marks.some((m) => m >= end && m < j.dest)) pastMark = true;
    t += j.from - pos;
    pos = j.dest;
  }
};

/** A JumpToAction a press's skill took: the timeline frame it left and the one it went on from. */
export interface Jump {
  from: number;
  dest: number;
}

/** An ultimate's cut-in: its UltimateTimeAction with time scale 0, in frames. */
export const cutIn = (skill: any): number => {
  const a = actions(skill, 'UltimateTimeAction').find((x) => Number(x.data.timeScale ?? 1) === 0);
  return a ? a.end - a.frame : 0;
};

// ---------------------------------------------------------------------------
// One operator on a dummy, every press recorded
// ---------------------------------------------------------------------------

/** A step of a probe's script: an input (`chain`: the whole basic attack chain), then a wait in seconds. */
export interface Step {
  input: Input | 'chain';
  wait?: number;
  /** Basic attacks after it, each as soon as it may (an ultimate form's). */
  attacks?: number;
  /** Done just before the press (an infliction the skill consumes). */
  before?: (p: Probe) => void;
}

export interface Setup {
  potential?: number;
  /** Every skill's rank (1–12). */
  rank?: number;
  /** Ranks per kind, over `rank` (an ultimate at another rank than the basic attack). */
  ranks?: SimBuild['ranks'];
  level?: number;
  /** SP before each battle skill (default: full). */
  sp?: number;
  /** Teammates after the operator (ids; no gear, never pressed): what the operator gives the team. */
  team?: string[];
  script?: Step[];
}

/** Battle skill, combo, ultimate, each with time to play out. */
export const SCRIPT: Step[] = [
  { input: 'chain', wait: 2 },
  { input: 'battle', wait: 6 },
  { input: 'combo', wait: 6 },
  { input: 'ultimate', wait: 8 },
];

export interface TraceHit {
  frame: number;
  at: number;
  press: number;
  skill: string;
  type: string;
  scale: number;
  kind: string;
  skillKind?: string;
  operator: string;
  amount: number;
  atk: number;
}
export interface TraceEvent {
  frame: number;
  at: number;
  press: number;
  skill?: string;
  /** Who it went to (Ultimate Energy: the operator's id). */
  who?: string;
  value: number;
}
export interface TraceBuff {
  frame: number;
  at: number;
  press: number;
  id: string;
  on: string;
  stacks: number;
  frames: number;
  /** Frames it lasted, when something ended it before the probe did. */
  lasted?: number;
}

export class Probe {
  w: World;
  op: Entity;
  /**
   * Each press made: its input, the skill it cast, its frame, the SP it cost, its cooldown (frames on the clock that
   * runs through cut-ins) and the frames until the operator could basic attack again (`free`, fight frames). Events'
   * `at` is frames since their press.
   */
  presses: {
    input: Input;
    skill: string;
    frame: number;
    ok: boolean;
    cost: number;
    cooldown: number;
    free?: number;
    /** The JumpToActions its skill took. */
    jumps: Jump[];
  }[] = [];
  hits: TraceHit[] = [];
  poise: TraceEvent[] = [];
  sp: TraceEvent[] = [];
  energy: TraceEvent[] = [];
  buffs: TraceBuff[] = [];
  inflictions: TraceEvent[] = [];
  /** The basic attack chain's length before anything is pressed (an ultimate form has its own). */
  chain: number;
  readonly data: SimData;
  readonly id: string;
  readonly setup: Setup;

  constructor(data: SimData, id: string, setup: Setup = {}) {
    this.data = data;
    this.id = id;
    this.setup = setup;
    const r = setup.rank;
    const build: SimBuild = {
      op: id,
      potential: setup.potential ?? 0,
      gear: [],
      ...(setup.level ? { level: setup.level } : {}),
      ...(r || setup.ranks
        ? {
            ranks: {
              basic: r,
              normal: r,
              combo: r,
              ultimate: r,
              ...setup.ranks,
            },
          }
        : {}),
    };
    // A dummy that never Staggers (each hit's Stagger is recorded instead) and gives no SP back.
    const enemy: Enemy = {
      def: 100,
      poise: 1e9,
      staggerSeconds: 0,
      finisherSp: 0,
    };
    const team = teamOf(
      {
        builds: [build, ...(setup.team ?? []).map((op) => ({ op, potential: 0, gear: [] }))],
        seconds: 60,
        style: 'advanced',
        effort: 'normal',
        enemy,
      } as SimRequest,
      data,
    );
    const w = new World(team.bundles, team.stats, enemy, team.settings);
    w.start(team.potentials);
    w.controlled = 0;
    w.guardAttacks = false;
    w.strictCombos = false;
    // Standard style: no animation cancels, so an operator is free at its skill's MarkCanInterrupt.
    w.cancels = false;
    // A chain waits between attacks (each attack's hits apart) without starting over.
    w.chainGrace = 10 * FPS;
    this.w = w;
    this.op = w.team[0];
    this.chain = w.chainLength(this.op);
    // Listen in on the engine's own steps (instance fields shadow the prototype's methods; private ones too).
    const x = w as any;
    const press = () => this.presses.length - 1;
    const since = () => w.frame - (this.presses.at(-1)?.frame ?? 0);
    const deal = x.deal.bind(w);
    x.deal = (...args: any[]) => {
      const n = w.hits.length;
      const out = deal(...args);
      for (const h of w.hits.slice(n))
        this.hits.push({
          frame: h.frame,
          at: since(),
          press: press(),
          skill: h.skill,
          type: h.type,
          scale: h.parts?.scale ?? 0,
          kind: h.kind,
          skillKind: h.skillKind,
          operator: h.operator,
          amount: h.amount,
          atk: h.parts?.atk ?? 0,
        });
      return out;
    };
    // The skill whose damage action is running, for its Stagger.
    let acting: string | undefined;
    const damageAction = x.damageAction.bind(w);
    x.damageAction = (a: unknown, ctx: { skillId: string }) => {
      const was = acting;
      acting = ctx.skillId;
      try {
        return damageAction(a, ctx);
      } finally {
        acting = was;
      }
    };
    const poise = x.poise.bind(w);
    x.poise = (target: Entity, v: number, attacker?: Entity) => {
      this.poise.push({
        frame: w.frame,
        at: since(),
        press: press(),
        skill: acting,
        value: v,
      });
      return poise(target, v, attacker);
    };
    const obtain = x.obtain.bind(w);
    x.obtain = (type: string, amount: number, who: Entity, ...rest: unknown[]) => {
      if (type === 'Atb')
        this.sp.push({
          frame: w.frame,
          at: since(),
          press: press(),
          value: amount,
        });
      if (type !== 'UltimateSp') return obtain(type, amount, who, ...rest);
      const before = (who.owner ?? who).energy;
      obtain(type, amount, who, ...rest);
      this.energy.push({
        frame: w.frame,
        at: since(),
        press: press(),
        who: (who.owner ?? who).id,
        value: (who.owner ?? who).energy - before,
      });
    };
    const addBuff = x.addBuff.bind(w);
    x.addBuff = (e: Entity, bid: string, source: Entity, ...rest: unknown[]) => {
      const b = addBuff(e, bid, source, ...rest);
      if (b)
        this.buffs.push({
          frame: w.frame,
          at: since(),
          press: press(),
          id: bid,
          on: e === w.enemy ? 'enemy' : e === this.op ? 'self' : e.id,
          stacks: b.stacks,
          frames: b.end - w.frame,
        });
      return b;
    };
    const endBuff = x.endBuff.bind(w);
    x.endBuff = (b: { id: string; owner: Entity; stacks: number }, layers = b.stacks, ...rest: unknown[]) => {
      if (layers >= b.stacks && b.owner.buffs.includes(b as never)) {
        const on = b.owner === w.enemy ? 'enemy' : b.owner === this.op ? 'self' : b.owner.id;
        const t = this.buffs.findLast((x) => x.id === b.id && x.on === on && x.lasted == null);
        if (t) t.lasted = w.frame - t.frame;
      }
      return endBuff(b, layers, ...rest);
    };
    const jumpTo = x.jumpTo.bind(w);
    x.jumpTo = (run: { skillId: string; owner: Entity; start: number }, dest: number) => {
      // The press's own skill (its run may still be starting: a jump on frame 0), on its own timeline.
      const p = this.presses.at(-1);
      if (p && run.skillId === p.skill && run.owner === this.op) p.jumps.push({ from: w.frame - run.start, dest });
      return jumpTo(run, dest);
    };
    const inflict = x.inflict.bind(w);
    x.inflict = (e: Entity, element: string, ...rest: unknown[]) => {
      if (e === w.enemy)
        this.inflictions.push({
          frame: w.frame,
          at: since(),
          press: press(),
          skill: element,
          value: 1,
        });
      return inflict(e, element, ...rest);
    };
  }

  /** The skill an input casts now. */
  skillOf(input: Input): string {
    return (this.w as any).skillIdOf(this.op, input);
  }

  /** Presses an input (an ultimate charged first, a battle skill with full SP unless `sp`); false if refused. */
  press(input: Input): boolean {
    const w = this.w;
    const skill = this.skillOf(input);
    if (input === 'ultimate') this.op.energy = w.ultCost(this.op);
    if (input === 'battle') w.sp = this.setup.sp ?? w.spMax;
    const sp = w.sp;
    const p: Probe['presses'][number] = {
      input,
      skill,
      frame: w.frame,
      ok: false,
      cost: 0,
      cooldown: 0,
      jumps: [],
    };
    this.presses.push(p);
    p.ok = w.press(0, input);
    p.cost = sp - w.sp;
    p.cooldown = (w.readyAt.get(skill) ?? 0) - w.clockNow;
    return p.ok;
  }

  /** Runs the fight on (seconds of fight time; an ultimate's cut-in doesn't count). */
  wait(seconds: number): this {
    const end = this.w.frame + Math.round(seconds * FPS);
    let guard = 0;
    while (this.w.frame < end && guard++ < 100_000) {
      this.w.tick();
      const p = this.presses.at(-1);
      if (p && p.free == null && p.input !== 'attack' && this.w.can(0, 'attack')) p.free = this.w.frame - p.frame;
    }
    return this;
  }

  /** A basic attack as soon as it may come. */
  attack(): this {
    let guard = 0;
    while (!this.w.can(0, 'attack') && guard++ < 10 * FPS) this.w.tick();
    this.press('attack');
    this.w.tick();
    return this;
  }

  play(script: Step[]): this {
    for (const s of script) {
      s.before?.(this);
      if (s.input === 'chain')
        for (let i = this.w.chainLength(this.op); i > 0; i--) {
          this.attack();
          // Each attack's hits apart: the chain waits (chainGrace) and goes on.
          this.wait(2);
        }
      else this.press(s.input);
      for (let i = 0; i < (s.attacks ?? 0); i++) this.attack();
      this.wait(s.wait ?? 6);
    }
    return this;
  }

  /** The index of the first press that cast a skill. */
  pressOf(skill: RegExp): number {
    return this.presses.findIndex((p) => skill.test(p.skill));
  }

  /** The index of an input's k-th press (from the end when negative). */
  nth(input: Input, k = 0): number {
    return (
      this.presses
        .map((p, i) => (p.input === input ? i : -1))
        .filter((i) => i >= 0)
        .at(k) ?? -1
    );
  }

  /** The operator's hits after a press (or every press of an input), optionally of some skills. */
  hitsOf(press: number | Input, skill?: RegExp): TraceHit[] {
    const ok = (i: number) => (typeof press === 'number' ? i === press : this.presses[i]?.input === press);
    return this.hits.filter((h) => ok(h.press) && h.operator === this.id && (!skill || skill.test(h.skill)));
  }

  /** The sum of the hits' multipliers (ATK scales). */
  scaleOf(press: number | Input, skill?: RegExp): number {
    return this.hitsOf(press, skill).reduce((n, h) => n + h.scale, 0);
  }

  /** The sum of a press's events (SP, Ultimate Energy, Stagger). */
  sum(list: TraceEvent[], press: number, filter: (e: TraceEvent) => boolean = () => true): number {
    return list.filter((e) => e.press === press && filter(e)).reduce((n, e) => n + e.value, 0);
  }

  /** The first buff a press gave, by id (a pattern) and holder. */
  buffOf(press: number, id: RegExp, on?: string): TraceBuff | undefined {
    return this.buffs.find((b) => b.press === press && id.test(b.id) && (!on || b.on === on));
  }
}

/** A probe for one operator (its combat data loaded). */
export const probe = async (id: string, setup: Setup = {}): Promise<Probe> => new Probe(await simData([id]), id, setup);

// ---------------------------------------------------------------------------
// Rules: an operator's table rows
// ---------------------------------------------------------------------------

/** A rule: what the sim did (`sim`) against what the game data says (`data`). */
export interface Rule {
  what: string;
  /** Where the data side comes from: file and field. */
  source: string;
  /** A documented rule settled from footage, where the engine deliberately differs from the data (docs/rotations.md). */
  footage?: string;
  /**
   * A known gap between the engine and the data, waiting on the owner (the row runs as an expected failure, so the
   * suite stays green and the row turns red once the engine matches the data: then drop this).
   */
  finding?: string;
  /** A named setup from the operator's table (a script, a Potential), else the default. */
  setup?: string;
  /** Skill ranks to run at (default 12). */
  ranks?: number[];
  /** `base`: the same rank's probe of the default setup, for what a Potential changes. */
  sim: (p: Probe, base: Probe) => unknown;
  data: (d: Sources, rank: number, p: Probe) => unknown;
  /** Allowed difference for numbers. */
  tol?: number | ((p: Probe) => number);
}

export interface OperatorRules {
  id: string;
  name: string;
  /** Named setups (a script, a Potential); `base` is the default script at P0. */
  setups?: Record<string, Setup>;
  rules: Rule[];
}

/**
 * The skill table rounds each hit's multiplier to a whole percent (0.01) and the wiki shows the total rounded, so a
 * total of n hits can be up to half a point per hit off (at least 0.011).
 */
const rounded = (hits: number) => Math.max(0.011, 0.005 * hits + 0.001);
const BOTH = [1, 12];
const sec = (frames: number) => frames / FPS;
const TYPE: Record<string, string> = {
  battle: 'Battle Skill',
  combo: 'Combo Skill',
  ultimate: 'Ultimate',
};
const WIKI = 'wiki/operators.json';
const PATCH = 'combat/ops patch';

/** A rule as a known finding (it.fails) at some ranks, as it is at the others: `...finding(rule, note)` in a table. */
export const finding = (rule: Rule, note: string, ranks = rule.ranks ?? [12]): Rule[] => [
  { ...rule, ranks, finding: note },
  ...(rule.ranks ?? [12]).filter((x) => !ranks.includes(x)).map((x) => ({ ...rule, ranks: [x] })),
];

// ---------------------------------------------------------------------------
// Table helpers and the runner (rules2.test.ts; rules.test.ts keeps its own copies)
// ---------------------------------------------------------------------------

export const first = (h: TraceHit[]) => h.slice(0, 1);
export const last = (h: TraceHit[]) => h.slice(-1);
export const allButLast = (h: TraceHit[]) => h.slice(0, -1);
export const nthHit = (i: number) => (h: TraceHit[]) => h.slice(i, i + 1);
/**
 * What buff_common_obtain_ultimate_sp gives each operator (every battle skill creates it): its blackboard's
 * usp_everyone, whatever SP the skill cost (× the ratio its creator assigns).
 */
export const TEAM_USP = (d: Sources) =>
  Number(
    d.bundle.buffs.buff_common_obtain_ultimate_sp.blackboard.find((x: { key: string }) => x.key === 'usp_everyone')
      .valueDouble,
  );
export const TEAM_USP_SOURCE = 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone';
/** An Arts Infliction on the enemy just before a press (the data's elements: Cryst, Pulse, Natural, Fire). */
export const inflictOn = (element: string, stacks: number) => (p: Probe) => {
  p.w.enemy.bb.set(`inflict_${element}`, stacks);
  p.w.enemy.bb.set(`inflict_until_${element}`, p.w.frame + 600);
};
export const potentials = (...ps: number[]): Record<string, Setup> =>
  Object.fromEntries(ps.map((n) => [`P${n}`, { potential: n }]));

/** One describe per operator: every setup's probe at every rank its rules ask for, then a test per rule and rank. */
export function runTables(operators: OperatorRules[], t: { describe: any; beforeAll: any; it: any; expect: any }) {
  const { describe, beforeAll, it, expect } = t;
  for (const op of operators)
    describe(op.name, () => {
      let src: Sources;
      const probes = new Map<string, Probe>();
      beforeAll(async () => {
        const mates = [...new Set(Object.values(op.setups ?? {}).flatMap((s) => s.team ?? []))];
        const [data, wiki, bundle] = await Promise.all([
          simData([op.id, ...mates]),
          asset('wiki/operators.json').then((w) => w.operators[op.id] as WikiOp),
          asset(`combat/ops/${op.id}.json`),
        ]);
        src = new Sources(wiki, bundle, op.id);
        const want = new Set(
          op.rules.flatMap((x) => (x.ranks ?? [12]).flatMap((rank) => [`${x.setup ?? 'base'}|${rank}`, `base|${rank}`])),
        );
        for (const key of want) {
          const [name, rank] = key.split('|');
          const setup = { ...(op.setups?.[name] ?? {}), rank: Number(rank) };
          probes.set(key, new Probe(data, op.id, setup).play(setup.script ?? SCRIPT));
        }
      }, 120_000);
      const run = (rule: Rule, rank: number) => () => {
        const p = probes.get(`${rule.setup ?? 'base'}|${rank}`)!;
        const sim = rule.sim(p, probes.get(`base|${rank}`)!);
        const data = rule.data(src, rank, p);
        const tol = typeof rule.tol === 'function' ? rule.tol(p) : (rule.tol ?? 1e-6);
        if (typeof data === 'number' && typeof sim === 'number')
          expect(Math.abs(sim - data), `sim ${sim}, data ${data}`).toBeLessThanOrEqual(tol);
        else expect(sim).toEqual(data);
      };
      for (const rule of op.rules)
        for (const rank of rule.ranks ?? [12])
          (rule.finding ? it.fails : it)(
            `${rule.what}${rule.ranks ? ` [rank ${rank}]` : ''}${rule.footage ? ' [footage]' : ''}${rule.finding ? ' [finding]' : ''}: ${rule.source}`,
            run(rule, rank),
          );
    });
}

/** The rule builders: each names its source. */
export const rules = {
  /** A basic attack step's multiplier (all its hits). */
  seq: (n: number): Rule => ({
    what: `basic attack step ${n} multiplier`,
    source: `${WIKI} Basic Attack "BATK SEQ ${n} Multiplier"`,
    ranks: BOTH,
    tol: (p) => rounded(p.hitsOf(p.nth('attack', n - 1)).length),
    sim: (p) => p.scaleOf(p.nth('attack', n - 1)),
    data: (d, r) => d.value('Basic Attack', `BATK SEQ ${n} Multiplier`, r),
  }),
  /** Every basic attack step, the whole chain. */
  chain: (n: number): Rule[] => Array.from({ length: n }, (_, i) => rules.seq(i + 1)),
  /** The Final Strike's SP (the last step's `atb`) and Stagger (the wiki's ⟦stagger⟧ in the basic attack's text). */
  finalStrike: (): Rule[] => [
    {
      what: 'Final Strike SP',
      source: `${PATCH} <id>_attack<last> values.atb`,
      sim: (p) => p.sum(p.sp, p.nth('attack', p.chain - 1)),
      data: (d) => d.patch(`attack${d.chain}`).values.atb,
    },
    {
      what: 'Final Strike Stagger',
      source: `${WIKI} Basic Attack description ⟦stagger⟧`,
      sim: (p) => p.sum(p.poise, p.nth('attack', p.chain - 1)),
      data: (d) => d.described('Basic Attack'),
    },
  ],
  /**
   * Hits of a press against a wiki multiplier (× a Potential's factor); `skill` picks the hits. An Arts Burst or
   * reaction the press sets off (a buff_common_ buff's hit) is the status's damage, not the skill's: left out.
   */
  mult: (
    input: Input,
    label: string,
    o: {
      skill?: RegExp;
      k?: number;
      at?: (p: Probe) => number;
      type?: string;
      variant?: number;
      ranks?: number[];
      setup?: string;
      factor?: (d: Sources) => number;
      pick?: (h: TraceHit[]) => TraceHit[];
      per?: (p: Probe) => number;
      what?: string;
      footage?: string;
    } = {},
  ): Rule => {
    const hits = (p: Probe) =>
      (o.pick ?? ((h) => h))(
        p.hitsOf(o.at?.(p) ?? p.nth(input, o.k), o.skill).filter((h) => o.skill || !/^buff_common_/.test(h.skill)),
      );
    return {
      what: o.what ?? `${o.type ?? TYPE[input] ?? input} "${label}"${o.setup ? ` (${o.setup})` : ''}`,
      source: `${WIKI} ${o.type ?? TYPE[input] ?? 'Basic Attack'} "${label}"`,
      ranks: o.ranks ?? BOTH,
      setup: o.setup,
      footage: o.footage,
      tol: (p) => rounded(hits(p).length),
      sim: (p) => hits(p).reduce((n, h) => n + h.scale, 0) / (o.per?.(p) ?? 1),
      data: (d, r) => d.value(o.type ?? TYPE[input] ?? 'Basic Attack', label, r, o.variant) * (o.factor?.(d) ?? 1),
    };
  },
  /**
   * A "DMG Dealt is increased to x times" Potential: a press's damage per ATK (so attribute Potentials don't count)
   * at that Potential against the default setup's.
   */
  dealt: (
    input: Input,
    setup: string,
    factor: (d: Sources) => number,
    o: {
      skill?: RegExp;
      pick?: (h: TraceHit[]) => TraceHit[];
      what?: string;
    } = {},
  ): Rule => ({
    what: o.what ?? `${TYPE[input]} DMG Dealt at ${setup}`,
    source: `${WIKI} Potential text`,
    setup,
    tol: 1e-6,
    sim: (p, base) => {
      const per = (x: Probe) =>
        (o.pick ?? ((h) => h))(x.hitsOf(x.nth(input), o.skill)).reduce((n, h) => n + h.amount / h.atk, 0);
      return per(p) / per(base);
    },
    data: (d) => factor(d),
  }),
  /** The Stagger a press dealt. */
  stagger: (
    input: Input,
    label: string,
    o: {
      skill?: RegExp;
      k?: number;
      setup?: string;
      footage?: string;
      data?: (d: Sources) => number;
    } = {},
  ): Rule => ({
    what: `${TYPE[input]} "${label}"`,
    source: `${WIKI} ${TYPE[input]} "${label}"`,
    setup: o.setup,
    footage: o.footage,
    sim: (p) => p.sum(p.poise, p.nth(input, o.k), (e) => !o.skill || o.skill.test(e.skill ?? '')),
    data: (d) => o.data?.(d) ?? d.value(TYPE[input], label),
  }),
  /** A combo's or ultimate's cooldown, from the skill table (with talents and Potentials: `adjust`). */
  cooldown: (
    input: 'combo' | 'ultimate',
    o: {
      setup?: string;
      ranks?: number[];
      adjust?: (d: Sources, r: number) => number;
      source?: string;
    } = {},
  ): Rule => ({
    what: `${TYPE[input]} cooldown (s)`,
    source: o.source ?? `${PATCH} cooldown of the ${input === 'combo' ? 'combo' : 'ultimate'} skill pressed`,
    setup: o.setup,
    ranks: o.ranks ?? (input === 'combo' ? BOTH : [12]),
    sim: (p) => sec(p.presses[p.nth(input)].cooldown),
    // The skill pressed: which one an input casts is its own rule (the skill group's first).
    data: (d, r, p) => d.patch(p.presses[p.nth(input)].skill, r).cooldown + (o.adjust?.(d, r) ?? 0),
  }),
  /** The battle skill's SP cost. */
  spCost: (): Rule => ({
    what: 'Battle Skill SP cost',
    source: `${WIKI} Battle Skill "SP Cost"`,
    sim: (p) => p.presses[p.nth('battle')].cost,
    data: (d) => d.value('Battle Skill', 'SP Cost'),
  }),
  /** The ultimate's Ultimate Energy cost (× P4's factor at P4). */
  ultCost: (o: { setup?: string; potential?: number; variant?: number } = {}): Rule => ({
    what: `Ultimate Energy cost${o.potential ? ` at P${o.potential}` : ''}`,
    source: `${WIKI} Ultimate "Ultimate Energy Cost"${o.potential ? `, Potential ${o.potential} text` : ''}`,
    setup: o.setup,
    sim: (p) => p.w.ultCost(p.op),
    data: (d) =>
      d.value('Ultimate', 'Ultimate Energy Cost', 12, o.variant) * (o.potential ? 1 + d.potential(o.potential)[0] : 1),
  }),
  /** Ultimate Energy a press gave (its own events: `filter`). */
  energy: (
    input: Input,
    label: string,
    o: {
      setup?: string;
      filter?: (e: TraceEvent) => boolean;
      data?: (d: Sources) => number;
      what?: string;
      source?: string;
      footage?: string;
      /** Whose gain: the operator's (default) or a teammate's id. */
      who?: string;
    } = {},
  ): Rule => ({
    what: o.what ?? `${TYPE[input]} "${label}"`,
    source: o.source ?? `${WIKI} ${TYPE[input]} "${label}"`,
    setup: o.setup,
    footage: o.footage,
    sim: (p) => p.sum(p.energy, p.nth(input), (e) => e.who === (o.who ?? p.id) && (!o.filter || o.filter(e))),
    data: (d) => o.data?.(d) ?? d.value(TYPE[input], label),
  }),
  /** SP a press returned. */
  spReturn: (input: Input, label: string, o: { setup?: string; data?: (d: Sources) => number } = {}): Rule => ({
    what: `${TYPE[input]} "${label}"`,
    source: `${WIKI} ${TYPE[input]} "${label}"`,
    setup: o.setup,
    sim: (p) => p.sum(p.sp, p.nth(input)),
    data: (d) => o.data?.(d) ?? d.value(TYPE[input], label),
  }),
  /** Every hit of the operator's own skills is of its element. */
  element: (): Rule => ({
    what: 'every hit is of the operator’s element',
    source: `${WIKI} element`,
    sim: (p) => [...new Set(p.hits.filter((h) => h.operator === p.id && h.kind === 'skill').map((h) => h.type))],
    data: (d) => [DAMAGE_TYPE[d.wiki.element]],
  }),
  /** A press's own hits count as its kind of skill (DMG bonuses and checks). */
  kind: (input: 'battle' | 'combo' | 'ultimate', skill: RegExp, o: { setup?: string } = {}): Rule => ({
    what: `${TYPE[input]} hits count as ${TYPE[input]} DMG`,
    source: `combat/ops skills skillSpecification, ${WIKI} ${TYPE[input]} description`,
    setup: o.setup,
    sim: (p) => [...new Set(p.hitsOf(p.nth(input), skill).map((h) => h.skillKind))],
    data: () => [{ battle: 'normal', combo: 'combo', ultimate: 'ultimate' }[input]],
  }),
  /** Frames until the operator can basic attack again: the skill's MarkCanInterrupt (else exclusiveFrame), plus an ultimate's cut-in. */
  free: (input: 'battle' | 'combo' | 'ultimate', o: { setup?: string } = {}): Rule => ({
    what: `${TYPE[input]}: can act again (frames)`,
    source:
      'combat/ops skills MarkCanInterrupt, else exclusiveFrame, at most the skill’s length; UltimateTimeAction for the cut-in',
    setup: o.setup,
    sim: (p) => {
      const pr = p.presses[p.nth(input)];
      return (pr.free ?? NaN) + (input === 'ultimate' ? cutIn(p.data.ops[p.id].skills[pr.skill]) : 0);
    },
    data: (_d, _r, p) => {
      const pr = p.presses[p.nth(input)];
      return freeFrame(p.data.ops[p.id].skills[pr.skill], pr.jumps);
    },
  }),
  /** A buff a press gave: its holder and its duration (s) against a wiki label, or a number from the data. */
  buff: (
    input: Input,
    id: RegExp,
    on: string,
    label: string,
    o: {
      setup?: string;
      k?: number;
      data?: (d: Sources) => number;
      source?: string;
      what?: string;
    } = {},
  ): Rule => ({
    what: o.what ?? `${TYPE[input] ?? input} "${label}" on ${on}`,
    source: o.source ?? `${WIKI} ${TYPE[input]} "${label}"`,
    setup: o.setup,
    sim: (p) => {
      const b = p.buffOf(p.nth(input, o.k), id, on);
      return b ? sec(b.frames) : 'none';
    },
    data: (d) => o.data?.(d) ?? d.value(TYPE[input], label),
  }),
  /** Arts Infliction stacks a press applied. */
  inflicts: (input: Input, stacks: number, source: string, o: { setup?: string } = {}): Rule => ({
    what: `${TYPE[input]} applies ${stacks} Arts Infliction`,
    source,
    setup: o.setup,
    sim: (p) => p.sum(p.inflictions, p.nth(input)),
    data: () => stacks,
  }),
};
