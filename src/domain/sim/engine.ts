/**
 * A damage simulator that runs the game's own skill and buff logic (ef-assets
 * combat/ops/<operator>.json: the decoded SkillData and BuffData, minus what
 * only shows or sounds), frame by frame at the game's 30 frames a second.
 *
 * Skills are timelines of actions; buffs are durations, stat and damage
 * modifiers and event handlers; both read a blackboard of numbers (the skill
 * table's values for the skill's rank, the buff's own, values handed over).
 * This file runs the actions that change the fight (damage, Stagger,
 * inflictions, SP and Ultimate Energy, buffs, branching, blackboard maths,
 * spawned entities) and skips what doesn't. An action type it doesn't know
 * yet is counted in `World.unknown`, so what isn't simulated shows.
 *
 * One enemy (a training target) and the team; positions and movement aren't
 * simulated. Damage follows endfield.wiki.gg's Damage calculation page.
 * Pure logic, no DOM.
 */

/** Game data, as loosely typed as the files are. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Data = any;

export const FPS = 30;

/**
 * The guard AI's Attacker roles (GroupAIConfig Default_GroupAITargetNotMain, Character): per mode, how many of the
 * three teammates get one and how often it's dealt; each lasts 5 s. How the game picks a mode isn't in the data:
 * the four weigh the same here. Each teammate's share of the time attacking: (3 + 2·5/6 + 2 + 1·5/12) / 4 / 3 ≈ 0.59.
 */
const GUARD_MODES = [
  { count: 3, tick: 3.2 }, // Radical
  { count: 2, tick: 6 }, // Moderate
  { count: 2, tick: 4.2 }, // Steady
  { count: 1, tick: 12 }, // SingleOne
];
const GUARD_LIFE = 5;
export const GUARD_DATA_SHARE = GUARD_MODES.reduce((n, m) => n + m.count * Math.min(1, GUARD_LIFE / m.tick), 0) / GUARD_MODES.length / 3;
/**
 * The share used: two thirds of the data's, fitted to the owner's two recordings by when the boss dies (the
 * stopwatch's end; damage sums can't be compared, a phase's is capped at its HP): at 0.4 the sim kills the
 * Skydrummer at 2:27.4 (the game: 2:27.4) and Alleikhreos at 2:20.6 (2:21), at 0.59 at 2:24.5 and 2:20.1, at 0.2
 * neither in time. Moving, dodging and repositioning take the rest of an Attacker role.
 */
export const GUARD_SHARE = 0.4;
/** The span (s) each teammate's attacking window repeats over: the Moderate mode's tick. */
const GUARD_PERIOD = 6;

export interface Bundle {
  operator: string;
  skills: Record<string, Data>;
  buffs: Record<string, Data>;
  patch: Record<string, { level: number; values: Record<string, number | string>; cooldown: number; cost: number }[]>;
  /** PotentialTalentEffectTable entries: talent levels (<op>_talent_<n>_<level>) and Potentials (<op>_potential_<n>). */
  talents?: Record<string, Data[]>;
  /** SkillConditionTable entries the talents depend on. */
  conditions?: Record<string, Data>;
  /** Attribute numbers as the data's names (41 → Wisd). */
  attributes?: Record<string, string>;
  /** The operator's element (CharacterTable charTypeId: Fire, Pulse, Cryst, Natural, Physical). */
  element?: string;
  /** The operator's class (Guard, Caster, Striker, Vanguard, Defender, Supporter), as the wiki names it. */
  profession?: string;
  /** Names that stand for several attributes (CompositeAttributeTable: AllSkillDamageIncrease → …). */
  composites?: Record<string, string[]>;
  /** Passive skills the build adds (its weapon's skills, its gear sets'), cast when the fight starts. */
  passives?: string[];
  /** Skill levels other than the world's rank (weapon skills). */
  levels?: Record<string, number>;
  /** Casting a skill keeps the basic attack chain where it was (CharacterTable dontInterruptCombo). */
  dontInterruptCombo?: boolean;
}

/** A blackboard that falls back to entities' (for EntityBB_ keys): the first that has the key. */
export class BB extends Map<string, number> {
  fallbacks: Map<string, number>[];
  constructor(...fallbacks: (Map<string, number> | undefined)[]) {
    super();
    this.fallbacks = fallbacks.filter((f): f is Map<string, number> => !!f);
  }
  get(k: string): number | undefined {
    if (super.has(k)) return super.get(k);
    for (const f of this.fallbacks) if (f.has(k)) return f.get(k);
    return undefined;
  }
  has(k: string): boolean {
    return super.has(k) || this.fallbacks.some((f) => f.has(k));
  }
}

/** A lasting change to an attribute (gear stats, passive skills' attribute changes). */
export interface Mod {
  attributeType: string;
  /** BaseAddition, BaseMultiplier... as the data names them. */
  formulaItem: string;
  value: number;
}

/** An operator's numbers for the fight (build.ts works them out from level, weapon and gear). */
export interface Stats {
  level: number;
  /** Its main and secondary attributes (Str, Agi, Wisd, Will). */
  main: string;
  sub: string;
  /** Base attributes by the data's names: Atk is the operator's and the weapon's, CriticalRate 0.05... */
  attributes: Record<string, number>;
  /** Gear stats. */
  mods?: Mod[];
}

export type Side = 'team' | 'enemy';

/** What the player can press: the controlled operator's basic attack, an operator's battle skill, combo or ultimate, or swapping to them. */
/** 'dive': the controlled operator's dive attack (only played back from a recording; the search never presses it). */
export type Input = 'attack' | 'battle' | 'combo' | 'ultimate' | 'swap' | 'dive';

export interface Entity {
  id: string;
  side: Side;
  /** The operator it belongs to (itself for an operator; the spawner for entities). */
  owner: Entity | null;
  /** Team slot 0–3; -1 for the enemy and entities. */
  slot: number;
  stats?: Stats;
  /** Attributes buffs read and change (resistances, Strength...): base values. */
  attr: Record<string, number>;
  /** Lasting attribute changes (gear, passive skills). */
  mods: Mod[];
  /** Passive skills' event handlers (passiveEventActions): weapon, gear set and talent effects. */
  listeners: { id: string; events: Data[]; bb: Map<string, number>; groups: Map<string, Entity[]> }[];
  buffs: Buff[];
  /** Ultimate Energy (operators). */
  energy: number;
  /** Values actions store on the entity (ModifyDynamicBlackboard on a target). */
  bb: Map<string, number>;
  alive: boolean;
  /** A summon's end frame (its spawn's duration, or SetAbilityEntityDuration); none: until something finishes it. */
  until?: number;
  /** Spawned with no skill: only something to hold buffs (Arcane's Cluster Strike mark); no search finds it. */
  marker?: boolean;
  /** Susceptibility on it (VulnerableAction) and Amp it deals with (EnhancedAction): kind (Spell = Arts, or an element), rate, until. */
  vulnerable?: Effect[];
  amp?: Effect[];
  /** Haste (SpeedupAction): its skills and attacks play faster; the highest one counts. */
  haste?: Effect[];
}

/**
 * Susceptibility or Amp (VulnerableAction / EnhancedAction): a child of the buff or skill that applied it,
 * which ends with its parent buff; one from the same parent and kind replaces the last ("cannot stack").
 */
export interface Effect {
  kind: string;
  rate: number;
  until: number;
  key: string;
  parent?: Buff;
  /** Buffs that raise it by `add` each time one is added to its holder (enhancingList: Zhuang Fangyi's Amp, +2% a strike). */
  grow?: { ids: string[]; add: number }[];
}

export interface Buff {
  id: string;
  def: Data;
  owner: Entity;
  source: Entity;
  stacks: number;
  start: number;
  /** Frame it ends; Infinity for unlimited. */
  end: number;
  bb: Map<string, number>;
  nextTrigger: number;
  triggers: number;
  /** Its own timeline (buffs can have one, like skills): actions already started. */
  done: Set<number>;
  /** The blackboard of the skill cast that created it (or that cast's own source). */
  castBB?: Map<string, number>;
  /** The kind of skill whose cast created it (kindOfSkill), for CheckSkillCastId. */
  castKind?: string;
  groups: Map<string, Entity[]>;
  /** Its timer stopped (PauseBuffTime): Laevatain's skills during Twilight don't shorten it. */
  paused?: boolean;
  /** Made by a timeline action with autoFinishByAction: it ends with that action, or with its skill if cut short. */
  byRun?: Run;
  /** Skills it goes on under when its run is cut by casting one of them (inheritSkillIdList: Liino's stance through her combo). */
  inherit?: string[];
  /** Its end before an action's span shortened it (InheritBuffAction gives it a new span from this). */
  ownEnd?: number;
  /** Its attack mapping (ComboCacheAction) has been used: the next basic attack is the chain's again. */
  mapUsed?: boolean;
  /** A "Stack" buff's stacks' own ends, oldest first: each lasts its own time (Lone Barge's two Battle Skill stacks). */
  stackEnds?: number[];
  /** Its DoOnceActions that have run. */
  once?: Set<Data>;
}

/** A skill (or a projectile's or entity's skill) running on someone. */
export interface Run {
  skillId: string;
  skill: Data;
  owner: Entity;
  source: Entity;
  start: number;
  bb: Map<string, number>;
  groups: Map<string, Entity[]>;
  target: Entity | null;
  /** Timeline actions already started. */
  done: Set<number>;
  ended: boolean;
  /** The source cast's blackboard when this cast inherits it. */
  castBB?: Map<string, number>;
  /** Past its MarkCanInterrupt: the operator can act again. */
  canInterrupt?: boolean;
  /** The world frame it was cast at. */
  castAt?: number;
  /** An operator's own press (a skill or basic attack), whose end OnSkillEnd reports. */
  main?: boolean;
  /** Its DoOnceActions that have run. */
  once?: Set<Data>;
  /**
   * Cast by the operator's own press as its next part (Typhoeus's hover: start, then its idle loop): in the game it
   * becomes what the operator is doing, so the operator's next basic attack cuts it.
   */
  follow?: boolean;
  /** A basic attack pressed while attacksUnseen. */
  unseen?: boolean;
  /** A projectile's hit: the skill that launched it (or what launched that). */
  origin?: Run;
  /** Its Final Strike Stagger has been dealt. */
  poised?: boolean;
  /** The EntityBB_ keys its projectiles keep for themselves (projectileKeys). */
  projBB?: Map<string, number>;
}

/** A stretch the enemy was Staggered: from `frame` to `end`. */
export interface Stagger {
  frame: number;
  end: number;
}

/** An ultimate form's stretch: while an operator's basic attacks are its ultimate's (Yvonne's), frames. */
export interface Form {
  slot: number;
  frame: number;
  end: number;
}

/** A Final Strike or Finisher the controlled operator landed. */
export interface Strike {
  frame: number;
  slot: number;
  finisher: boolean;
  /** Made by an attack a recording's SP bar can't show (attacksUnseen when it was pressed). */
  unseen?: boolean;
}

export interface Hit {
  frame: number;
  operator: string;
  skill: string;
  type: string;
  amount: number;
  kind: 'skill' | 'burst' | 'reaction' | 'status';
  /** The kind of skill it counts as (basic, normal, combo, ultimate), from its damage mask or its skill. */
  skillKind?: string;
  /** The formula's parts: ATK × scale × each multiplier. */
  parts?: Record<string, number>;
}

interface Ctx {
  /** OnBeforeOutputBuff: the kind of skill whose cast is giving the buff (CheckSkillCastId). */
  eventCastKind?: string;
  owner: Entity;
  source: Entity;
  target: Entity | null;
  bb: Map<string, number>;
  groups: Map<string, Entity[]>;
  skillId: string;
  /** The blackboard of the skill cast this chain started from (buffs and casts that inherit the source cast's info read it). */
  castBB?: Map<string, number>;
  /** The custom ability event being handled (TriggerCustomAbilityEvent → CheckCustomAbilityEvent). */
  event?: string;
  /** The damage being dealt (for damage-modifier conditions). */
  damage?: { type: string; mask: number; attacker: Entity; defender: Entity; skillKind: string; amount?: number; tags?: number[] };
  /** The damage unit's own tags (damageTags), for the hit it deals. */
  damageTags?: number[];
  /** The skill run the actions belong to (for timeline jumps). */
  run?: Run;
  /** How many frames the timeline entry running them lasts. */
  span?: number;
  /** The skill an event comes from (a cast, or what applies an infliction). */
  origin?: string;
  /** The Arts Infliction an event is about. */
  infliction?: string;
  /** The buff an event is about (OnOutputBuff, OnAddedBuff, OnConsumeBuff). */
  buff?: Buff;
  /** Stacks an OnConsumeBuff event took. */
  consumed?: number;
  /** The Physical Status an OnBefore/AfterOutputPhysicalInfliction event is about (its mask name: Airborne, Crush...). */
  physical?: string;
  /** A cast event (OnBeforeCastSkill, OnAfterSkillApplyCost): `origin` is the skill being cast, not yet running. */
  casting?: boolean;
  /** Why a skill was cut short (OnSkillInterrupted). */
  reason?: string;
  /** The heal an OnOutputHeal / OnReceiveHeal event is about: its tags, and whether it went over Max HP. */
  heal?: { tags: number[]; over: boolean };
  /** The values of a buff being handed out (OnCollectOutputBuffBbValue), which the handler may change. */
  collected?: Map<string, number>;
  /** The buff whose actions these are. */
  self?: Buff;
}

const short = (t: string | undefined) => (t ?? '').split(',')[0].split('.').pop()!.replace(/\+Data$|Data$/, '');

/** Element names the data uses for damage and inflictions. */
export const ELEMENTS = ['Fire', 'Cryst', 'Pulse', 'Natural'] as const;
/** How long an Arts Infliction lasts from its last application (seconds): `inflictUntil`. */
const INFLICTION_SECONDS = 20;

/**
 * Arts Infliction's tags (hashed; inflictions aren't buffs here, so checks for these look at the target's
 * stacks). Each element's infliction buff carries its own (buff_common_energy_shard_attached_<element>):
 * Cryo 1570888476, Heat -1558844517, Nature -1411846745, Electric 2123008650. -193971080 is any of them (Last
 * Rite's Hypothermia: "consumes any Arts Infliction").
 */
const INFLICTION_TAG: Record<string, number> = { Cryst: 1570888476, Fire: -1558844517, Natural: -1411846745, Pulse: 2123008650 };
const ANY_INFLICTION = -193971080;
/** The tag for any Arts Reaction (the game puts it on each reaction's buff; the data lists only the reaction's own). */
const ANY_REACTION = 1474064594;
/** The elements whose Arts Infliction a tag query names. */
const inflictionsIn = (tags: Data[] | undefined): string[] => {
  const ids = (tags ?? []).map((t: Data) => t.tagId);
  return ELEMENTS.filter((x) => ids.includes(ANY_INFLICTION) || ids.includes(INFLICTION_TAG[x]));
};
/** Si's Final Stroke and the Artful Intent record it ends early (see addBuff). */
const INKBOOM = 'buff_chr_0036_jsspsi_xianjing_inkboom_camera';
const ARTFUL_INTENT = 'buff_chr_0036_jsspsi_xianjing_inkhurteffect';
/**
 * Physical statuses (wiki: Vulnerability, Lift, Knock Down, Crush, Breach). The actions that apply them are game code;
 * their numbers are the settings table's (击飞/倒地/猛击/碎甲 rows) and Vulnerability is the game's own buff.
 */
export type PhysicalStatus = 'Lift' | 'KnockDown' | 'Crush' | 'Breach';
const VULNERABLE = 'buff_physical_no_guard';
/** The names CheckPhysicalInflictionType masks use. */
const PHYSICAL_MASK: Record<PhysicalStatus, string> = { Lift: 'Airborne', KnockDown: 'KnockDown', Crush: 'Crush', Breach: 'Fracture' };
/** A status a combo trigger watches for, by its buff's tag: Combustion, Corrosion. */
const STATUS_TAG: Record<number, string> = { [-1110095722]: 'Combustion', [-421286163]: 'Corrosion', 1466867135: 'Electrification', 1535684437: 'Solidification' };
/** An element's infliction as the game names it (HyperlinkTextTable's ba.*onchar terms). */
export const INFLICTION_NAME: Record<(typeof ELEMENTS)[number], string> = { Fire: 'Heat Infliction', Cryst: 'Cryo Infliction', Pulse: 'Electric Infliction', Natural: 'Nature Infliction' };
/** A Susceptibility's or Amp's kind as the game's terms name it (ba.crystvul "Cryo Susceptibility", ba.spellenhance "Arts Amp"). */
export const EFFECT_KIND: Record<string, string> = { Spell: 'Arts', Fire: 'Heat', Cryst: 'Cryo', Crystal: 'Cryo', Pulse: 'Electric', Natural: 'Nature', Physical: 'Physical' };

/** The Susceptibility, Amp and Haste effects on an entity now (as `deal` counts them), each with the game's name. */
export function effectsShown(e: Entity, frame: number): { id: string; name: string }[] {
  const on = (x: Effect) => x.until > frame && (!x.parent || x.parent.owner.buffs.includes(x.parent));
  const out: { id: string; name: string }[] = [];
  // One icon per source, as the game draws them: Xaihi's and Si's ultimates each give the team a Cryo Amp
  // (`amp_Crystal@chr_0011_seraph`, `amp_Crystal@chr_0036_jsspsi`).
  const from = (x: Effect) => /chr_\d+_[a-z]+/.exec(x.key)?.[0] ?? x.key;
  for (const x of e.vulnerable ?? []) if (on(x)) out.push({ id: `vul_${x.kind}@${from(x)}`, name: `${EFFECT_KIND[x.kind] ?? x.kind} Susceptibility` });
  for (const x of e.amp ?? []) if (on(x)) out.push({ id: `amp_${x.kind}@${from(x)}`, name: `${EFFECT_KIND[x.kind] ?? x.kind} Amp` });
  for (const x of e.haste ?? []) if (on(x)) out.push({ id: 'haste', name: 'Haste' });
  return out;
}

/**
 * A buff the game shows in its buff bar (its data has an icon: `hasIcon`), with a status's name where it is one;
 * null for the hidden bookkeeping buffs.
 */
export function buffShown(b: Buff): { id: string; status?: string; level?: number } | null {
  if (b.def.hasIcon !== true && b.def.hasIcon !== 'True') return null;
  const reaction = (b.def.applyTags ?? []).map((t: Data) => STATUS_TAG[t.tagId]).find(Boolean);
  const status = reaction ?? (b.id === VULNERABLE ? 'Vulnerable' : undefined);
  // An Arts Reaction's level (1–4: the stacks it was made from) is its buff's `count`, not its stacks.
  const level = reaction ? Math.max(1, Math.round(b.bb.get('count') ?? 1)) : undefined;
  return { id: b.id, ...(status ? { status } : {}), ...(level ? { level } : {}) };
}
/**
 * Summons by a tag the data never sets (it's on the summon's model in the game), so a tag search would otherwise
 * count every summon the operator has: Zhuang Fangyi's Sunderblades (her battle skill strikes once per blade, up to 9).
 */
const SUMMON_TAGS: Record<number, RegExp> = {
  [-13979809]: /_normal_skill_sword$/,
  // Arcane's Tactical Doubles (his combo's entity): its explosion ends each once.
  [-1480463572]: /^abilityentity_chr_0032_lizhiyan_combo_skill$/,
  // Arcane's ultimate array: its end finishes its own entities, not the Tactical Doubles (the owner's video: a
  // combo's explosion lands after an ultimate cast during its Imprisonment).
  [464088014]: /^abilityentity_chr_0032_lizhiyan_ultimate_skill/,
  // Tangtang's Whirlpools (her combo's), which her battle skill counts and wakes (the owner's video's SP bar: her
  // ultimate leaves none); and the battle skill's own moving Waterspout.
  [45117620]: /^abilityentity_chr_0027_tangtang_comboskill_water$/,
  [77793925]: /^abilityentity_chr_0027_tangtang_normal_skill_move$/,
};
/**
 * Projectiles that are waves spreading from their source (Liino's beats: each teammate hit is healed, the enemy
 * hit takes damage), which the data launches at one target. Assumed: everyone is within range.
 */
const WAVES = /_soundwave(_\d+)?_projhit$/;
/**
 * The talent tables' enums: numbered in older dumps, named in newer ones (PotentialTalentEffectTable, the same
 * numbers each name had).
 */
const ENUMS: Record<string, Record<string, number>> = {
  talent: { AddPassiveSkill: 1, ChangeSkillParam: 2, ChangeSkillBlackboard: 3, ModifyAttr: 4, AddBuff: 5 },
  param: { None: 0, CostValue: 1, CoolDown: 2, CoolDownDisplay: 4 },
  modify: { None: 0, Add: 1, Multiply: 2, Overwrite: 3 },
};
const enumOf = (kind: string, v: unknown): number => (typeof v === 'number' ? v : (ENUMS[kind][String(v)] ?? (Number(v) || 0)));
/** An attribute a talent table names: a number (the bundle's attributes map) or, in newer dumps, the name itself. */
const attrName = (b: Bundle, v: unknown): string | undefined => b.attributes?.[v as string] ?? (typeof v === 'string' && Number.isNaN(Number(v)) ? v : undefined);
/** A gain no RefrainObtainUsp blocks (the caster's own battle skill). */
const REFRAIN_ANY = -1;
/** Seconds over which uptime repeats: so much to hit, then the rest waiting. */
const UPTIME_PERIOD = 10;
/** The game's time scale in a combo banner's slow motion (the recordings: regeneration at about a sixth). */
const COMBO_SLOW = 1 / 6;
/** A Final Strike's damage decorate mask. */
const FINAL_STRIKE = 2097152;
/**
 * A hit's skill kind from its damage decorate mask, where it names one (basic attack 128, battle skill 256, ultimate
 * 512, combo 8192; across every kit's data): Zhuang Fangyi's Thunder Strikes come from a buff but are battle skill
 * damage. Without one, the skill's id decides.
 */
const kindOfMask = (mask: number): string | undefined =>
  mask & 256 ? 'normal' : mask & 8192 ? 'combo' : mask & 512 ? 'ultimate' : mask & 128 ? 'basic' : undefined;
/**
 * The tags of the buffs Susceptibility and Amp are in the game (buff_common_affixes_vulnerable_* and
 * _enhance_*), which effects that watch for them check (Eternal Xiranite: "applies Amp, Protected,
 * Susceptible, or Weakened").
 */
const AFFIX_TAGS: Record<string, number[]> = { VulnerableAction: [-881002460, 1427729990, 1425735059], EnhancedAction: [-1748167886, 191477865], WeakAction: [2029588776] };

/**
 * The enemy: DEF, resistances, and its Stagger (EnemyAttributeTemplateTable:
 * attribute 20 the Stagger meter, 12 how long it stays Staggered, read from
 * how they differ between mobs, elites and bosses; breakingAttackedAtbObtain
 * the SP a Finisher on it gives). No Stagger meter: never Staggered.
 */
export interface Enemy {
  def?: number;
  resist?: Record<string, number>;
  poise?: number;
  staggerSeconds?: number;
  finisherSp?: number;
  /** A Finisher's damage on it (BreakingAttackDamageTakenScalar: the wiki's Finisher ATK Mult); 1 unless set. */
  finisherMul?: number;
  /** Stagger nodes: shares of the meter where it stumbles (poiseKnotPctList), and the buff it gets (poiseKnotBuffList). */
  nodes?: number[];
  nodeBuff?: string;
  /** Stagger added when the meter passes a node (none unless set). */
  nodeStagger?: number;
  /** What the enemy does after a node, as the timeline names it, and how long after (s). */
  nodeMechanic?: string;
  nodeMechanicAt?: number;
  /** After a node, a stretch it takes no Stagger: from `after` seconds past the node, `seconds` long. */
  nodeGuard?: { after: number; seconds: number };
  /**
   * Interrupting one of its attacks in its weakness window (SetWeaknessAction): the Stagger that adds (Alleikhreos's
   * buff_eny_0125_fdcentur_interrupt, poise_value 20). When it can be done is its AI's, so only a recording says.
   */
  interrupt?: { stagger: number };
  /** Each phase's HP, and how low a phase before the last can take it (a share of it). */
  phaseHp?: number;
  phaseFloor?: number;
  /**
   * The stage's rules. `food`: a buff placed on each operator before the fight, allowed unless false (Re-Crisis only,
   * of the game's hard content; healing items used during a fight are another thing). `fullUltimate`: every
   * operator's ultimate full at the start (Re-Crisis). `prep`: the fight waits for a start button, so the team can set
   * up first while SP regenerates (Echoes of War). A stage starts at 200 SP of 300 (START_SP) unless `sp` says otherwise.
   */
  food?: boolean;
  fullUltimate?: boolean;
  prep?: boolean;
  /**
   * A stage's own SP: where it starts, its cap, its regeneration a second and what share of every other SP gain the
   * team gets (`gain`: Final Strikes, Finishers, battle-skill returns; Glaiver File's get_atb_reduce -0.5, "All SP
   * recovery and regeneration -50%": 4 a second and half of each gain). Unset: 200 of 300, 8 a second, gains whole.
   */
  sp?: { start: number; max: number; regen: number; gain?: number };
  /**
   * A guard stance it takes when its HP falls below each share in `below` (needs phaseHp): for `seconds`, damage
   * taken changes by `damageTaken` (-0.9: a tenth), its DEF by `def`, and its Stagger meter heals faster than hits
   * fill it (no Stagger). The Skydrummer's skill06 buff: ratio_damagetaken, ratio_def, ratio_maxpoise healed each 0.25 s.
   */
  guard?: { below: number[]; seconds: number; damageTaken: number; def?: number };
}

export class World {
  frame = 0;
  team: Entity[] = [];
  enemy: Entity;
  entities: Entity[] = [];
  runs: Run[] = [];
  /**
   * A running skill's event listeners (EventListenerAction) while their timeline entry lasts: Tangtang's OLDEN STARE
   * waits for the dive attack's buff (OnOutputBuff) and jumps to the early rogue wave.
   */
  private runListeners: { run: Run; until: number; map: Data[] }[] = [];
  /** The skill launching a projectile, while its hit is cast (Run.origin). */
  private launching?: Run;
  hits: Hit[] = [];
  /** The controlled operator's Final Strikes and Finishers, one per attack (shown in the rotation). */
  strikes: Strike[] = [];
  /** Each time the enemy was Staggered: from, to (frames). */
  staggers: Stagger[] = [];
  /** The enemy's own mechanics as they happen (the Foundite Weapon's blade), for the timeline. */
  mechanics: { frame: number; label: string }[] = [];
  /** Each ultimate form's stretch, to its closing attack (`attacksUnseen`), for the timeline. */
  forms: Form[] = [];
  private formOpen: (number | undefined)[] = [];
  private strikeRun: Run | null = null;
  sp = 200;
  /** Action types met but not simulated, with how often. */
  unknown = new Map<string, number>();
  controlled = 0;
  /** The enemy's rank (Mob, Elite, Boss...), for skills that check it. */
  enemyRank = 'Boss';
  /** SP the last battle skill cost (its Ultimate Energy is worked out from it). */
  private lastBattleCost = 0;
  /** Timed markers: entity → marker id → frame it ends. */
  private markers = new Map<Entity, Map<string, number>>();
  /** Global cooldown timers (internal cooldowns): entity → id → frame it's ready. */
  private cdTimers = new Map<Entity, Map<string, number>>();
  /** Combos that can be cast, by team slot: until when (TriggerComboSkillAction, or the trigger rules). */
  comboReady = new Map<number, number>();
  /** What triggered each ready combo: the infliction and its stacks (the combo's consumed_type / consumed_layer). */
  private comboCause = new Map<number, { element: string; stacks: number }>();
  /** How long a triggered combo stays castable, in seconds (not in the readable data yet). */
  comboWindow = 5;
  /** Combos need their trigger (false: any combo off cooldown can be cast). */
  strictCombos = true;
  /** Ultimates need their energy (false: a video's replay, which shows they were charged). */
  strictUltimates = true;
  /** Finishers can be made (false: a video's replay where the video shows none by then). */
  finishers = true;
  /** Stances are never ended early (Liino's End Stance isn't pressed). */
  keepStances = true;
  /**
   * The share of the fight the enemy can be hit (a boss teleports, changes phase, makes you dodge). The rest comes as
   * a stretch at the end of every UPTIME_PERIOD, when nothing is pressed and no basic attack lands; what's already
   * running goes on (assumed: the game has no such number).
   */
  uptime = 1;
  /**
   * Stretches the enemy is invulnerable (a boss's untouchable move: Alleikhreos's phantoms), in frames of the clock that
   * runs through cut-ins: the team's hits on it do nothing then.
   */
  away: [number, number][] = [];
  /** While a buff is being given: the kind of skill whose cast gives it (castKindOf). */
  private creating?: string;
  /** JumpToActions waiting for their condition while their timeline entry lasts. */
  private jumpWatch: { run: Run; a: Data; ctx: Ctx; until: number }[] = [];
  /** How many of an operator's summons its next skill reaches (World.reachOnly), by team slot. */
  private reach = new Map<number, { n: number; until: number }>();
  /** Presses that interrupt the enemy, by team slot, waiting for their first hit (World.interrupt). */
  private interrupts = new Map<number, { kind: string; until: number }>();
  /** A stretch after a node the enemy takes no Stagger (Enemy.nodeGuard), in frames. */
  private poiseGuard: [number, number] | null = null;
  /** The enemy's guard stance (Enemy.guard): until which frame, and the HP shares that have started one. */
  private guardUntil = -1;
  private guarded: number[] = [];
  /**
   * Stretches the enemy takes no Stagger, in frames of the clock that runs through cut-ins (a recording's, read from
   * its boss's meter); when there are any, they stand in for Enemy.nodeGuard.
   */
  noStagger: [number, number][] = [];
  /** The last summons' hit that Staggered: skill and frame. */
  private summonPoise = '';
  /** Swapping who's controlled (off: one operator the whole fight). */
  swaps = true;
  /** Animation cancels: a press in a skill's AllowNextSkillAction window, before it would otherwise end. */
  cancels = true;
  /**
   * Skills swapped into an operator's slots (ChangeSkillAction): operator → slot → the swap. One that ends
   * (FinishByAction: with the buff that made it; SpecificTime: after its duration) gives the slot back.
   */
  private slots = new Map<Entity, Map<string, { id: string; buff?: Buff; run?: Run; until?: number; back?: string }>>();
  /**
   * Modes an operator is in (SwitchModeAction, while the buff that switched it lasts). In mode "ult" an operator
   * with an <id>_ult_attack1.. chain attacks with it (Laevatain's Twilight): the game's animation states make
   * that switch, which the data doesn't hold.
   */
  private modes = new Map<Entity, { mode: string; buff: Buff }[]>();
  /** Skill rank (1–12) to read the skill table at. */
  rank = 12;
  private foe: Enemy;
  /** Skills read at another level (weapon skills): id → level. */
  private skillLevel = new Map<string, number>();
  private composites: Record<string, string[]> = {};
  private bundles: Bundle[];
  private skillOf = new Map<string, Data>();
  private buffOf = new Map<string, Data>();
  /** Every tag some buff carries (a tag filter on these looks at buffs, not spawned things). */
  private buffTags = new Set<number>();
  private patchOf = new Map<string, Bundle['patch'][string]>();
  /** Talent and Potential changes to skill values: skill id → (key, value, how: 1 add, 2 multiply, 3 set). */
  private skillMods = new Map<string, { key: string; value: number; how: number }[]>();
  /** Talent and Potential changes to skill parameters (cost, cooldown): skill id → list. */
  skillParams = new Map<string, { type: number; how: number; value: number }[]>();

  /** The status and reaction settings table (ef-assets combat/settings.json): name → values per status level. */
  private settings: Record<string, { values: number[]; kind?: string }>;

  constructor(bundles: Bundle[], stats: Stats[], enemy: Enemy = {}, settings: Record<string, { values: number[]; kind?: string }> = {}) {
    this.bundles = bundles;
    this.settings = settings;
    bundles.forEach((b, i) => {
      for (const [k, v] of Object.entries(b.skills)) this.skillOf.set(k, v);
      for (const [k, v] of Object.entries(b.buffs)) {
        this.buffOf.set(k, v);
        for (const t of (v as Data).applyTags ?? []) this.buffTags.add(t.tagId);
      }
      for (const [k, v] of Object.entries(b.patch)) this.patchOf.set(k, v);
      // By team position: operators share skill ids (weapons' attribute skills, gear sets', other operators' skills
      // in a bundle), each at its own level (Arcane's wpn_attr_wisd_high at 5 had set Yvonne's to 5).
      for (const [k, v] of Object.entries(b.levels ?? {})) this.skillLevel.set(`${i}|${k}`, v);
      Object.assign(this.composites, b.composites);
    });
    this.team = bundles.map((b, i) => this.entity(b.operator, 'team', null, i, stats[i]));
    this.enemy = this.entity('enemy', 'enemy', null, -1);
    this.enemy.attr.Def = enemy.def ?? 100;
    for (const e of ELEMENTS) this.enemy.attr[`${e}Resistance`] = enemy.resist?.[e] ?? 0;
    this.enemy.attr.PhysicalResistance = enemy.resist?.Physical ?? 0;
    this.foe = enemy;
    if (enemy.sp) this.sp = enemy.sp.start;
  }

  /** The SP bar's cap. */
  get spMax(): number {
    return this.foe.sp?.max ?? 300;
  }

  private entity(id: string, side: Side, owner: Entity | null, slot: number, stats?: Stats): Entity {
    const e: Entity = { id, side, owner: null, slot, stats, attr: { ...(stats?.attributes ?? {}) }, mods: owner ? [] : [...(stats?.mods ?? [])], listeners: [], buffs: [], energy: 0, bb: new Map(), alive: true };
    e.owner = owner ?? (side === 'team' && slot >= 0 ? e : null);
    return e;
  }

  // -------------------------------------------------------------------------
  // Values and blackboards
  // -------------------------------------------------------------------------

  /** A skill's blackboard at the world's rank: its own defaults, then the skill table's values. */
  skillBlackboard(skillId: string, slot = -1): Map<string, number> {
    const bb = new Map<string, number>();
    const skill = this.skillOf.get(skillId);
    for (const b of skill?.blackboard ?? []) bb.set(b.key, Number(b.valueDouble ?? b.value ?? 0));
    const level = this.patchAt(skillId, slot);
    for (const [k, v] of Object.entries(level?.values ?? {})) if (typeof v === 'number' || !Number.isNaN(Number(v))) bb.set(k, Number(v));
    return bb;
  }

  val(v: Data, bb: Map<string, number>): number {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    // Some fields are written as plain strings ("0.06", "0.7").
    if (typeof v === 'string') return Number(v) || 0;
    if (v.useBlackboardKey) return bb.get(v.blackboardKey) ?? Number(v.value ?? 0);
    return Number(v.value ?? 0);
  }

  // -------------------------------------------------------------------------
  // Targets
  // -------------------------------------------------------------------------

  /** The entities a target spec names. */
  targets(spec: Data, ctx: Ctx): Entity[] {
    if (!spec) return ctx.target ? [ctx.target] : [];
    let list: Entity[];
    switch (spec.targetSource) {
      case 'Owner':
        list = [ctx.owner];
        break;
      case 'Source':
        list = [ctx.source];
        break;
      case 'Context':
        list = ctx.groups.get(spec.targetGroupKey) ?? [];
        break;
      case 'MainCharacter':
        list = [this.team[this.controlled]];
        break;
      // A search done on the spot, with the spec's own finder and filters.
      case 'InstantSearch':
        return this.find({ selectorData: spec.selectorData }, ctx);
      case 'Target':
      default:
        // The current target; its group only when there's none.
        list = ctx.target ? [ctx.target] : spec.targetGroupKey ? (ctx.groups.get(spec.targetGroupKey) ?? []) : [this.enemy];
    }
    // A selector with a finder of its own is a search's (InstantSearch); left on a fixed source it does nothing. Camille's
    // combo heals "Source" with the controlled-operator search's filter on it, and he heals himself off the field too (wiki).
    if (spec.selectorData?.finderData) return list;
    return this.validate(list, spec.selectorData?.validatorData ?? [], ctx);
  }

  /** A search's filters: the controlled operator only; everyone but the ability's owner (Xaihi's set: "other teammates"). */
  private validate(list: Entity[], validators: Data[], ctx: Ctx): Entity[] {
    for (const v of validators) {
      const t = short(v.$type);
      if (t === 'Selector+MainCharacterValidator') list = list.filter((e) => e.side === 'team' && e.slot === this.controlled);
      else if (t === 'Selector+ExcludeOwnerValidator') list = list.filter((e) => e !== ctx.owner && e !== ctx.owner.owner);
    }
    return list;
  }

  /** FindTargetAction's finders: who they find, with no positions to go by. */
  private find(a: Data, ctx: Ctx): Entity[] {
    const finder = a.selectorData?.finderData;
    const t = short(finder?.$type);
    const anti = finder?.factionTarget !== 'Self' && finder?.factionTarget !== 'Friend';
    let list: Entity[];
    // A tag filter: on buff tags (Combustion, Corrosion, an infliction...), the targets that have such a buff or
    // stacks; on other tags, spawned things (Tactical Doubles, crystals...: their tags aren't tracked, they are).
    const tagValidators = (a.selectorData?.validatorData ?? []).filter((v: Data) => /TagValidator/.test(v.$type ?? ''));
    const tags: Data[] = tagValidators.flatMap((v: Data) => v.query?.tags ?? []);
    const onBuffs = tags.length > 0 && tags.every((t) => this.buffTags.has(t.tagId) || inflictionsIn([t]).length > 0);
    const has = (e: Entity) => e.buffs.some((b) => (b.def.applyTags ?? []).some((x: Data) => tags.some((t) => t.tagId === x.tagId))) || inflictionsIn(tags).some((x) => (e.bb.get(`inflict_${x}`) ?? 0) > 0);
    if (tagValidators.length && onBuffs) list = (anti === ((ctx.source.owner ?? ctx.source).side === 'team') ? [this.enemy] : this.team).filter(has);
    // Spawned things' tags aren't tracked: a kit's tag search finds its own operator's summons (Arcane's combo ending
    // its Tactical Doubles must not end Si's Ink Lung or Camille's bats): the source's (a buff's giver: Xaihi's heal on a
    // teammate looks for Xaihi's crystal).
    else if (tagValidators.length) {
      const op = ctx.source.owner ?? ctx.source;
      list = this.entities.filter((e) => e.alive && !e.marker && e.owner === op);
      // A tag known to be one kind of summon's (SUMMON_TAGS) finds only those.
      const kinds = tags.map((x) => SUMMON_TAGS[x.tagId]).filter(Boolean);
      if (kinds.length) list = list.filter((e) => kinds.some((k) => k.test(e.id)));
      // Only so many in reach (a recording said: World.reachOnly), the newest; not a search for this cast's own
      // spawn (SkillCastIdValidator).
      const cap = op.slot >= 0 ? this.reach.get(op.slot) : undefined;
      if (cap && this.frame <= cap.until && !(a.selectorData?.validatorData ?? []).some((v: Data) => /SkillCastIdValidator/.test(v.$type ?? ''))) list = cap.n ? list.slice(-cap.n) : [];
    }
    else if (/CharacterTeamFinder|SquadFinder/.test(t)) list = this.team;
    else if (/OwnerSpawnedEntityFinder/.test(t)) list = this.entities.filter((e) => e.owner === ctx.owner && e.slot < 0 && !e.marker);
    else if (/SourceFinder/.test(t)) list = [ctx.source];
    // Random spots (pointNum of them): with no positions, each is at the enemy (Zhuang Fangyi's Sunderblades land on
    // sword_gene_num spots, one projectile each).
    else if (/RandomPointFinder/.test(t)) list = Array.from({ length: Math.max(0, Math.round(this.val(finder.pointNum ?? { value: 1 }, ctx.bb))) }, () => this.enemy);
    else if (/FixedPointFinder|PointFinder|NavMesh/.test(t)) list = [];
    // Factions are the ability's source's (autoSetTargetFaction): a buff on the enemy from an operator still finds enemies.
    else list = anti === ((ctx.source.owner ?? ctx.source).side === 'team') ? [this.enemy] : this.team;
    return this.validate(list, a.selectorData?.validatorData ?? [], ctx);
  }

  // -------------------------------------------------------------------------
  // Running actions
  // -------------------------------------------------------------------------

  /**
   * Writes a blackboard value. EntityBB_ keys belong to an entity: the one the
   * blackboard already finds the key on, else the running skill's or buff's
   * owner (so a reset written to the entity isn't hidden by a copy here).
   */
  private setBB(ctx: Ctx, key: string, v: number): void {
    const bb = ctx.bb;
    if (!key.startsWith('EntityBB_') || !(bb instanceof BB)) {
      bb.set(key, v);
      return;
    }
    Map.prototype.delete.call(bb, key);
    const local = ctx.run?.origin && projectileKeys(this.bundles).has(key) ? (ctx.run.origin.projBB ??= new Map()) : null;
    (local ?? bb.fallbacks.find((f) => f.has(key)) ?? ctx.owner.bb).set(key, v);
  }

  private note(t: string): void {
    this.unknown.set(t, (this.unknown.get(t) ?? 0) + 1);
  }

  /** Runs a list of actions. A condition in the list is a guard: when it fails, the rest of the list doesn't run. */
  exec(list: Data[] | undefined, ctx: Ctx): void {
    let not = false;
    for (const a of list ?? []) {
      if (!a || a.isEnable === false) continue;
      if (short(a.$type) === 'NotNextCheckAction') {
        not = !not;
        continue;
      }
      if (isCondition(a)) {
        if (this.cond(a, ctx) === not) return;
        not = false;
        continue;
      }
      this.act(a, ctx);
    }
  }

  /** Runs an action block, unless it's only for the controlled operator (or only for the others) and its source isn't. */
  private execBlock(block: Data, ctx: Ctx): void {
    if (!block) return;
    const src = ctx.source.owner ?? ctx.source;
    const main = src.side === 'team' && src.slot === this.controlled;
    if ((block.onlyExecuteWhenSourceIsMainChar && !main) || (block.onlyExecuteWhenSourceIsGuard && main)) return;
    this.exec(block.actionData, ctx);
  }

  /** Whether every condition in a list holds. */
  check(list: Data[] | undefined, ctx: Ctx): boolean {
    // NotNextCheckAction: the next condition must fail instead.
    let not = false;
    for (const c of list ?? []) {
      if (!c || c.isEnable === false) continue;
      if (short(c.$type) === 'NotNextCheckAction') {
        not = !not;
        continue;
      }
      if (this.cond(c, ctx) === not) return false;
      not = false;
    }
    return true;
  }

  private compare(a: number, op: string, b: number): boolean {
    switch (op) {
      case 'GT':
        return a > b;
      case 'GE':
        return a >= b;
      case 'LT':
        return a < b;
      case 'LE':
        return a <= b;
      case 'NotEquals':
      case 'NE':
        return a !== b;
      default:
        return Math.abs(a - b) < 1e-9;
    }
  }

  /** Buffs on an entity matching a buffSettings ({checkType, buffIdList, tagQuery}) or a list of ids. */
  /** A buff id as the data writes it: plain, { buffId }, or a value. */
  private idOf(x: Data): string {
    if (typeof x === 'string') return x;
    if (typeof x?.buffId === 'string') return x.buffId;
    if (typeof x?.value === 'string') return x.value;
    return x?.buffId?.value ?? '';
  }

  /** Whether a buff is one a check names: by id, or by its tags (applyTags) against a tag query. */
  private matchesBuff(b: Buff, settings: Data): boolean {
    if (Array.isArray(settings)) return settings.map((x) => this.idOf(x)).includes(b.id);
    if (settings?.checkType === 'Tag') {
      const q = settings.tagQuery ?? settings.query;
      const want: number[] = (q?.tags ?? []).map((t: Data) => t.tagId);
      const has: number[] = (b.def.applyTags ?? []).map((t: Data) => t.tagId);
      // An Arts Reaction's buff also counts as "any Arts Reaction" (Lone Barge, Twelve Questions, Opus: The Living).
      if (has.some((t) => STATUS_TAG[t])) has.push(ANY_REACTION);
      return q?.queryType === 'HasAll' ? want.every((t) => has.includes(t)) : want.some((t) => has.includes(t));
    }
    return (settings?.buffIdList ?? []).map((x: Data) => this.idOf(x)).includes(b.id);
  }

  private buffsMatching(e: Entity, settings: Data): Buff[] {
    return e.buffs.filter((b) => b !== this.starting && this.matchesBuff(b, settings));
  }
  /** The buff whose OnBuffStart is running (counts leave it out). */
  private starting: Buff | null = null;

  /**
   * Arts Infliction isn't a buff here: a tag check for it counts the target's stacks (each stack counts as a buff
   * too: Last Rite's combo scales with the stacks it finds by BuffCount).
   */
  private inflictionsMatching(e: Entity, settings: Data, _count: boolean): number {
    const q = settings?.tagQuery ?? settings?.query;
    if (settings?.checkType !== 'Tag') return 0;
    return inflictionsIn(q?.tags).reduce((n, x) => n + (e.bb.get(`inflict_${x}`) ?? 0), 0);
  }

  /** A stand-in buff for something the game keeps as a buff and this doesn't (an infliction, a Susceptibility), for events about it. */
  private standIn(id: string, tags: number[], owner: Entity, source: Entity, stacks: number): Buff {
    return { id, def: { applyTags: tags.map((tagId) => ({ tagId })) }, owner, source, stacks, start: this.frame, end: this.frame, bb: new Map(), nextTrigger: Infinity, triggers: 0, done: new Set(), groups: new Map() };
  }

  cond(c: Data, ctx: Ctx): boolean {
    const t = short(c.$type).replace(/^(?!Conditions\.)(Check|Compare)/, 'Conditions.$1');
    switch (t) {
      case 'Conditions.CheckMainCharacterCondition': {
        const who = this.targets(c.checkTarget, ctx)[0] ?? ctx.owner;
        const op = who.owner ?? who;
        return op.side === 'team' && op.slot === this.controlled;
      }
      case 'CompareFloat':
      case 'Conditions.CompareFloat':
        return this.compare(this.val(c.valueA, ctx.bb), c.compare, this.val(c.valueB, ctx.bb));
      case 'Conditions.CheckBuffStackNumAdvanced':
      case 'Conditions.CheckBuffStackNum':
      case 'Conditions.CheckBuffStackNumByTag': {
        const who = this.targets(c.checkTarget, ctx);
        const ids = c.tagQuery ? { checkType: 'Tag', tagQuery: c.tagQuery } : (c.buffSettings ?? c.buffIds?.map((b: Data) => b.buffId) ?? (c.buffId?.buffId ? [c.buffId.buffId] : []));
        // BuffCount is the layers (stacks); BuffIdCount how many different buffs.
        const count = c.buffStackNumType === 'BuffIdCount';
        const n = who.reduce((s, e) => s + this.buffsMatching(e, ids).reduce((k, b) => k + (count ? 1 : b.stacks), 0) + this.inflictionsMatching(e, ids, count), 0);
        return this.compare(n, c.compareType ?? 'GE', this.val(c.value, ctx.bb));
      }
      // The buff an event is about (OnOutputBuff, OnAddedBuff...), by id or tag.
      case 'Conditions.CheckBuffIdInContext':
      case 'Conditions.CheckBuffIdInContextAdvanced':
        return !!ctx.buff && this.matchesBuff(ctx.buff, c);
      // Changes a value of the buff being handed out (an action, though the data files it with the conditions).
      case 'ModifyCollectedBuffBbValue': {
        const m = ctx.collected;
        if (m) {
          const old = m.get(c.blackboardKey) ?? 0;
          m.set(c.blackboardKey, c.useDirectValue ? this.val(c.directValue, ctx.bb) : old * this.val(c.multiplier, ctx.bb) + this.val(c.addition, ctx.bb));
        }
        return true;
      }
      // How many stacks an OnConsumeBuff took (kept in storeKey).
      case 'Conditions.CheckConsumeBuffLayer': {
        const n = ctx.consumed ?? 0;
        if (c.storeKey) ctx.bb.set(c.storeKey, n);
        return this.compare(n, c.compareType ?? 'GE', this.val(c.num, ctx.bb));
      }
      // What the owner is casting now (by kind), before its exclusive frames end if asked.
      case 'Conditions.CheckSkillType': {
        const KINDS: Record<string, string> = { basic: 'Attack', normal: 'NormalSkill', combo: 'ComboSkill', ultimate: 'UltimateSkill' };
        // During a cast event the skill being cast is the one asked about (Lone Barge's buff as the ultimate is cast).
        if (ctx.casting && ctx.origin) return (c.skillTypeList ?? []).includes(KINDS[this.kindOfSkill(ctx.origin)] ?? '');
        const who = this.targets(c.skillOwner, ctx)[0] ?? ctx.owner;
        const op = who.owner ?? who;
        const run = op.slot >= 0 ? this.main[op.slot] : null;
        if (!run || run.ended) return false;
        if (c.mustBeforeExclusiveTime && this.frame - run.start >= (run.skill.exclusiveFrame ?? 0)) return false;
        return (c.skillTypeList ?? []).includes(KINDS[this.kindOfSkill(run.skillId)] ?? '');
      }
      // The same cast, told apart by its kind of skill: Yvonne's bomb's listener takes the Solidification her bomb
      // applies, not her combo's (Barrage of Technology: the battle skill's).
      case 'Conditions.CheckSkillCastId':
        return !ctx.self?.castKind || !ctx.eventCastKind || ctx.self.castKind === ctx.eventCastKind;
      // How many (also kept in storeKey: Zhuang Fangyi counts her Sunderblades this way).
      case 'Conditions.CheckEntityNum': {
        const n = this.targets(c.checkTarget, ctx).filter((e) => !c.excludeDeadEntity || e.alive).length;
        if (c.storeKey) ctx.bb.set(c.storeKey, n);
        return this.compare(n, c.compareType ?? 'GE', Number(c.minNum ?? 1));
      }
      // No positions: everything is in range.
      case 'Conditions.CheckDistanceCondition':
        return c.lessThan !== false;
      case 'Conditions.CheckDamageTypeMask':
        return !ctx.damage || String(c.damageTypeMask).split(/,\s*/).includes(ctx.damage.type);
      case 'Conditions.CheckDamageDecorateMask':
        return !!ctx.damage && (c.checkType === 'HasAll' ? (ctx.damage.mask & c.mask) === c.mask : (ctx.damage.mask & c.mask) !== 0);
      case 'Conditions.CheckSquadInFight':
        return true;
      case 'Conditions.CompareDeckAttr': {
        const who = this.targets(c.target, ctx)[0] ?? ctx.owner;
        const op = who.owner ?? who;
        return this.compare(this.stat(op, c.lhsType) + this.val(c.lhsValue, ctx.bb), c.compare, this.stat(op, c.rhsType) + this.val(c.rhsValue, ctx.bb));
      }
      case 'Conditions.CheckHp':
        return true;
      // No positions or aim: angle checks pass; the training target has no super armour.
      case 'Conditions.CheckTwoDirectionAngle':
      case 'Conditions.CheckSuperArmor':
        return true;
      // Tags aren't tracked; the ones these check are Arts Infliction's.
      // An entity's tags: its buffs' (Camille's hovering Vesperwings...), and Arts Infliction's while it has stacks.
      case 'Conditions.CheckTagMatch': {
        const want: Data[] = c.query?.tags ?? [];
        const has = (e: Entity, t: Data) =>
          e.buffs.some((b) => (b.def.applyTags ?? []).some((x: Data) => x.tagId === t.tagId)) || inflictionsIn([t]).some((x) => (e.bb.get(`inflict_${x}`) ?? 0) > 0) || this.ownTags(e).includes(Number(t.tagId));
        const q = c.query?.queryType ?? 'HasAny';
        const ok = (e: Entity) => (q === 'HasAll' ? want.every((t) => has(e, t)) : q === 'ExceptAny' ? !want.some((t) => has(e, t)) : want.some((t) => has(e, t)));
        return this.targets(c.checkTarget, ctx).some(ok);
      }
      case 'Conditions.CheckHealTag': {
        const want: number[] = (c.query?.tags ?? []).map((t: Data) => t.tagId);
        const has = (id: number) => !!ctx.heal?.tags.includes(id);
        return c.query?.queryType === 'HasAll' ? want.every(has) : want.some(has);
      }
      case 'Conditions.CheckOverHeal':
        return !!ctx.heal?.over;
      // The skill an event is about (OnSkillEnd).
      case 'Conditions.CheckSkillId':
        return (c.skillIdList ?? []).includes(ctx.origin);
      case 'Conditions.CheckSkillInterruptReason':
        return (c.reasonList ?? []).includes(ctx.reason);
      // A summon's time left (none: it stays until finished).
      case 'Conditions.CheckAbilityEntityCurDuration': {
        const e = this.targets(c.abilityEntity, ctx)[0];
        if (!e) return false;
        return this.compare(e.until !== undefined ? (e.until - this.frame) / FPS : Infinity, c.compareType ?? 'GE', this.val(c.value, ctx.bb));
      }
      // The hit's own tags (its damage unit's damageTags: Typhoeus's main arrows).
      case 'Conditions.CheckDamageTag': {
        const has = (t: Data) => !!ctx.damage?.tags?.includes(t.tagId);
        return c.queryType === 'HasAll' ? (c.tags ?? []).every(has) : (c.tags ?? []).some(has);
      }
      // The operator's class (Gilberta's talent: Guard, Supporter or Caster teammates).
      case 'Conditions.CheckProfession': {
        const want = String(c.professionCategories ?? '').split(/,\s*/);
        const who = this.targets(c.checkTarget, ctx);
        return who.length > 0 && who.every((e) => want.includes(this.bundleOf(e.owner ?? e)?.profession ?? ''));
      }
      // An enemy's Poise left before it's Staggered (0 while Staggered).
      case 'Conditions.CheckPoiseValue': {
        const e = this.targets(c.poiseOwner, ctx)[0];
        if (!e || e.side !== 'enemy' || !this.foe.poise) return !!c.returnValueIfDontHavePoise;
        return this.compare(this.staggered(e) ? 0 : this.foe.poise - (e.bb.get('stagger') ?? 0), c.compare ?? 'GE', this.val(c.value, ctx.bb));
      }
      // Nobody moves here: no movement input.
      case 'Conditions.CheckHasMoveInput':
        return false;
      case 'Conditions.CheckTargetInScreen':
        return true;
      // The fight is the training dummy (dungeon_train).
      case 'Conditions.CheckDungeonCategory':
        return (c.dungeonCategoryList ?? []).includes('dungeon_train') === !!c.returnTrueWhenInList;
      case 'Conditions.CheckPhysicalInflictionType':
        return !!ctx.physical && String(c.mask).split(/,\s*/).includes(ctx.physical);
      // Any of several condition lists.
      case 'OrConditionAction':
        return (c.conditionList ?? []).some((l: Data) => this.check(l?.actionData, ctx));
      // Body parts (weak points) aren't modelled: the training dummy has none.
      case 'Conditions.CheckPartTagMatch':
        return false;
      // A chance, played out evenly: true each time the chances added up pass a whole number.
      case 'Probablity': {
        const p = Math.max(0, Math.min(1, this.val(c.prob, ctx.bb)));
        const key = `${ctx.skillId}|${ctx.owner.id}`;
        const before = this.chance.get(key) ?? 0;
        this.chance.set(key, before + p);
        return Math.floor(before + p) > Math.floor(before);
      }
      // How the SP an OnObtainAtb is about came (Gain or Return; from a skill).
      case 'Conditions.CheckObtainAtbType': {
        const how = this.lastAtb;
        if (c.checkObtainMethod && !(c.obtainMethodList ?? []).includes(how.method)) return false;
        if (c.checkObtainType && !(c.obtainTypeList ?? []).includes(how.type)) return false;
        return true;
      }
      case 'Conditions.CheckObjectTypeMatch':
        return this.targets(c.target, ctx).some((e) => (/Enemy/.test(c.objectTypeMask) ? e.side === 'enemy' : e.side === 'team'));
      // No damage is passed on from another target here (Inksoul transfers aren't simulated yet).
      case 'Conditions.CheckDamageTransferredSource':
        return false;
      case 'Conditions.CheckGlobalCDTimerAction':
        return this.targets(c.target, ctx).every((e) => (this.cdTimers.get(e)?.get(c.buffId) ?? -1) <= this.frame);
      // The infliction an event is about, else the target's; of the mask's elements when it names any.
      case 'Conditions.CheckSpellInflictionType': {
        const e = ctx.target ?? this.enemy;
        const el = ctx.infliction ?? ELEMENTS.find((x) => (e.bb.get(`inflict_${x}`) ?? 0) > 0);
        const i = el ? (ELEMENTS as readonly string[]).indexOf(el) : -1;
        if (c.savedKey) ctx.bb.set(c.savedKey, i);
        const mask = String(c.mask ?? '');
        return i >= 0 && (!mask || mask === 'All' || mask.split(/,\s*/).includes(el!));
      }
      // The kind of skill an event comes from (battle skill, combo, ultimate, basic attack).
      case 'Conditions.CheckOriginSkillType': {
        const KINDS: Record<string, string> = { normal: 'NormalSkill', combo: 'ComboSkill', ultimate: 'UltimateSkill', basic: 'NormalAttack' };
        const k = ctx.origin ? this.kindOfSkill(ctx.origin) : (ctx.damage?.skillKind ?? this.kindOfSkill(ctx.skillId));
        // "Attack": any basic attack kind (a plunging/dive attack, a dash attack, a Finisher too).
        return (c.skillTypeList ?? []).includes(KINDS[k] ?? '') || (k === 'basic' && (c.skillTypeList ?? []).includes('Attack'));
      }
      case 'Conditions.CheckDamageType':
        return !ctx.damage || ctx.damage.type === c.damageType;
      // A cooldown: passes when the marker isn't running (gone by: yes; never set: returnTrueIfNotExists). The id can
      // be a blackboard value (Zhuang Fangyi's strike areas share one per swing, so a target is hit by one of them).
      case 'Conditions.CheckTimedMarkerCondition': {
        const id = c.useBlackboardKey ? this.markerId({ useBlackboardKey: true, blackboardKey: c.blackboardKey, value: c.id }, ctx) : String(c.id);
        const who = this.targets(c.checkTarget, ctx);
        if (who.some((e) => (this.markers.get(e)?.get(id) ?? -1) > this.frame)) return false;
        return who.some((e) => this.markers.get(e)?.has(id)) || !!c.returnTrueIfNotExists;
      }
      case 'Conditions.CheckCustomAbilityEvent':
        return ctx.event === eventName(c.eventName);
      case 'Conditions.CheckTargetContains': {
        const parent = this.targets(c.parentTargetSettings, ctx);
        const child = this.targets(c.childTargetSettings, ctx);
        return child.length > 0 && child.every((e) => parent.includes(e));
      }
      case 'Conditions.CheckTargetsEqual': {
        const x = this.targets(c.firstTargetSettings, ctx);
        const y = this.targets(c.secondTargetSettings, ctx);
        return x.length > 0 && x.every((e) => y.includes(e));
      }
      case 'Conditions.CheckEnemyRank': {
        const who = this.targets(c.target, ctx)[0];
        return !!who && who.side === 'enemy' && String(c.enemyRankSet).split(/,\s*/).includes(this.enemyRank);
      }
      default:
        this.note(t);
        return true;
    }
  }

  /** Called with every action run (for checking the simulator against the game). */
  trace?: (frame: number, type: string, owner: string, from: string) => void;

  act(a: Data, ctx: Ctx): void {
    const t = short(a.$type);
    this.trace?.(this.frame, t, ctx.owner.id, ctx.skillId);
    switch (t) {
      case 'IfElseAction+IfElseAction':
        return this.execBlock(this.check(a.conditionAction?.actionData, ctx) ? a.succeedActions : a.failActions, ctx);
      case 'SwitchAction': {
        const v = this.val(a.choice, ctx.bb);
        const hit = (a.options ?? []).find((o: Data) => (typeof o.value === 'object' ? this.val(o.value, ctx.bb) : Number(o.value)) === v);
        return this.execBlock(hit?.actionData ?? a.defaultActions, ctx);
      }
      case 'ForEachAction': {
        for (const e of this.targets(a.target ?? a.targetSettings, ctx)) this.execBlock(a.action, { ...ctx, target: e });
        return;
      }
      // Once per cast or buff, however often its channel ticks (Tangtang's battle skill: its Ultimate Energy once).
      case 'DoOnceAction': {
        const scope = ctx.run ?? ctx.self;
        if (scope) {
          const once = (scope.once ??= new Set());
          if (once.has(a)) return;
          once.add(a);
        }
        return this.execBlock(a.sequenceActionData ?? a.actions ?? a.action, ctx);
      }
      case 'RandomAction':
        return this.execBlock(a.sequenceActionData ?? a.actions ?? a.action, ctx);
      // Hits that tick over a window, at most so many times per target: with one target and no movement, once each.
      case 'ChannelingAction':
      case 'ChannelingActionV2':
      case 'TickIntervalAction':
      case 'AuraAction': {
        const list = (a.actionOnTick ?? a.actionInAura)?.actionData;
        // An aura reaches the whole fight here: allies or enemies (by its filter: relative to its source, or a side
        // named outright, Good = the team: Liino's stance ATK Boost), each given its buffs and actions; not its owner
        // if it excludes it.
        const f = a.targetFilter ?? {};
        const side = (ctx.source.owner ?? ctx.source).side;
        const teamSide = f.autoSetTargetFaction === false && f.targetFactionType ? f.targetFactionType === 'Good' : /Ally|Self|Friend/.test(f.factionTarget ?? '') === (side === 'team');
        const inAura =
          t === 'AuraAction'
            ? (teamSide ? this.team : [this.enemy]).filter((e) => !a.excludeOwner || e !== (ctx.owner.owner ?? ctx.owner))
            : a.targetSettings
              ? this.targets(a.targetSettings, ctx)
              : [ctx.target ?? this.enemy];
        // A channel hits again every (target) interval while its timeline entry lasts, up to its count per target
        // (Si's 4th basic attack: 6 hits, 0.1 s apart; Tangtang's 3rd: every 0.06 s for 8 frames).
        // A TickIntervalAction ticks every tickInterval for its span (Rossi's bleed, Zhuang Fangyi's fields), in a skill
        // or a buff's own timeline.
        const tick = t === 'TickIntervalAction';
        if ((t === 'ChannelingAction' || t === 'ChannelingActionV2' || tick) && (ctx.run || ctx.self) && (ctx.span ?? 0) > 0) {
          const interval = tick ? this.val(a.tickInterval ?? { value: 0 }, ctx.bb) : Math.max(this.val(a.triggerInterval ?? { value: 0 }, ctx.bb), this.val(a.targetTriggerInterval ?? { value: 0 }, ctx.bb));
          const every = Math.max(1, Math.round(interval * FPS));
          const max = tick ? -1 : Math.round(this.val(a.maxCountPerTarget ?? { value: 0 }, ctx.bb));
          // -1: every interval for the whole span (Tangtang's 3rd attack, her waterspouts); 0 or none: once.
          const left = max > 0 ? max - 1 : max < 0 ? Infinity : 0;
          if (left > 0) this.channels.push({ run: ctx.run, buff: ctx.run ? undefined : ctx.self, list, ctx, at: this.frame + every, every, until: this.frame + (ctx.span ?? 0), left, spec: a.targetSettings });
        }
        for (const e of inAura) {
          for (const spec of a.buffInput ?? []) {
            const assigned = new Map<string, number>();
            if (spec.assignBlackboard) for (const it of spec.assignItems ?? []) assigned.set(it.targetKey, it.useDirectValue ? Number(it.numericValue) : (ctx.bb.get(it.inputValueKey) ?? 0));
            // From the action's source (ActionSource), as CreateBuffAction's are: an entity's aura gives its spawner's
            // buffs (Arcane's array marks check the ultimate's listener on him). ActionOwner: from the entity running it
            // (Xaihi's crystal, whose heal checks the crystal for finishball_04 after its second heal).
            if (spec.buffId) this.addBuff(e, spec.buffId, a.buffSource === 'ActionOwner' ? ctx.owner : ctx.source, assigned);
          }
          this.exec(list, { ...ctx, target: e });
        }
        return;
      }
      case 'SaveCollectedBuffBbValue':
        ctx.bb.set(a.storeKey, ctx.collected?.get(a.blackboardKey) ?? 0);
        return;
      case 'StoreAttributeValue': {
        const who = this.targets(a.targetSettings, ctx)[0] ?? ctx.owner;
        const v = this.stat(who, a.attributeType);
        const num = (f: Data, d: number) => (f == null ? d : typeof f === 'object' ? this.val(f, ctx.bb) : Number(f));
        const x = (v * num(a.multiplierValue, 1)) / (num(a.divisorValue, 1) || 1) + num(a.baseValue, 0);
        ctx.bb.set(a.key, a.useFloor ? Math.floor(x) : x);
        return;
      }
      // The continuous search keeps a group of who's in the hitbox; with no positions, the same as one search.
      case 'FindTargetAction+FindTargetAction':
      case 'ContinuousFindTargetAction':
        ctx.groups.set(a.targetGroupKey, this.find(a, ctx));
        return;
      case 'MergeTargetAction': {
        const all = new Set<Entity>();
        for (const spec of a.targets ?? []) for (const e of this.targets(spec, ctx)) all.add(e);
        ctx.groups.set(a.targetGroupKey, [...all]);
        return;
      }
      case 'ConvertToTargetContext':
        return;
      case 'ModifyDynamicBlackboard': {
        // EntityBB_ keys live on an entity (the calculation target), others on the running skill or buff.
        const v = this.val(a.value, ctx.bb);
        const local = ctx.run?.origin && projectileKeys(this.bundles).has(a.key) ? (ctx.run.origin.projBB ??= new Map()) : null;
        const store = local ?? (a.key.startsWith('EntityBB_') ? (this.targets(a.calculationTarget, ctx)[0] ?? ctx.owner).bb : ctx.bb);
        const old = store.get(a.key) ?? 0;
        store.set(a.key, a.operation === 'Add' ? old + v : a.operation === 'Multiply' ? old * v : v);
        return;
      }
      case 'SimpleCalcBBAction': {
        const x = this.val(a.value1, ctx.bb);
        const y = this.val(a.value2, ctx.bb);
        const op = a.operation;
        this.setBB(ctx, a.key, op === 'Add' ? x + y : op === 'Sub' || op === 'Subtract' ? x - y : op === 'Mul' || op === 'Multiply' ? x * y : op === 'Div' || op === 'Divide' ? (y ? x / y : 0) : op === 'Max' ? Math.max(x, y) : op === 'Min' ? Math.min(x, y) : x);
        return;
      }
      case 'GetTargetBuffBBAdvanced': {
        for (const e of this.targets(a.targetSettings, ctx)) {
          const b = this.buffsMatching(e, a.buffSettings)[0];
          if (b && b.bb.has(a.desiredKey)) ctx.bb.set(a.blackboardKey, b.bb.get(a.desiredKey)!);
        }
        return;
      }
      case 'DamageAction+DamageAction':
        return this.damageAction(a, ctx);
      case 'SpellInfliction':
        for (const e of this.targets(a.target, ctx)) this.inflict(e, a.inflictionType, ctx);
        return;
      case 'ObtainCostAction':
        // SP from a skill: gained, or returned (atbGainMethod).
        this.lastAtb = { type: 'Skill', method: a.atbGainMethod ?? 'Gain' };
        return this.obtain(a.costType, this.val(a.costValue, ctx.bb) * this.val(a.coefficient ?? { value: 1 }, ctx.bb), ctx.owner, a.useUspRecoverTag ? Number(a.uspRecoverTag?.tagId) : undefined, !!a.ignoreUspGainScalar);
      // Skill kinds come from ids here ("Hunter Pursuit", chr_0033_camille_combo_skill_2, counts as a combo already).
      case 'ChangeSkillType':
        return;
      // CreateBuffAttachingSkill: the same, tied to the cast (Yvonne's talent DMG bonus, some weapons).
      case 'CreateBuffAttachingSkill':
      case 'CreateBuffAction': {
        const count = Math.max(1, Math.round(this.val(a.count, ctx.bb)));
        for (const e of this.targets(a.targetSettings, ctx))
          for (const spec of a.buffs ?? []) {
            const id = spec.readIdFromBlackboard ? null : spec.buffId;
            if (!id) continue;
            const assigned = new Map<string, number>();
            if (spec.assignBlackboard)
              for (const it of spec.assignItems ?? []) assigned.set(it.targetKey, it.useDirectValue ? Number(it.numericValue) : (ctx.bb.get(it.inputValueKey) ?? 0));
            for (let i = 0; i < count; i++) {
              const was = this.creating;
              this.creating = this.castKindOf(ctx);
              const b = this.addBuff(e, id, ctx.source, assigned, a.inheritSourceSkillCastInfo || a.passTargetGroupsToBuff ? ctx.groups : undefined);
              this.creating = was;
              if (b && a.inheritSourceSkillCastInfo) b.castBB = ctx.castBB ?? ctx.bb;
              if (b) b.castKind ??= this.castKindOf(ctx);
              // autoFinishByAction: made by a timeline action that spans frames, it lasts as long as that action
              // (Laevatain's pause_ult for her skill during Twilight); an instant action's buff keeps its own life.
              if (b && a.autoFinishByAction && ctx.run && (ctx.span ?? 0) > 0) {
                b.byRun = ctx.run;
                b.ownEnd = b.end;
                b.end = Math.min(b.end, this.frame + (ctx.span ?? 0));
                if (a.inheritSkillIdList?.length) b.inherit = a.inheritSkillIdList;
              }
              if (b && a.contextKey) ctx.groups.set(a.contextKey, [e]);
            }
          }
        return;
      }
      case 'FinishBuffAdvanced':
      case 'FinishBuffAction':
      case 'FinishBuffByTag': {
        for (const e of this.targets(a.buffOwner, ctx)) {
          const list = t === 'FinishBuffAction' ? this.buffsMatching(e, a.buffIds.map((b: Data) => b.buffId)) : this.buffsMatching(e, a.buffSettings ?? { checkType: 'Tag', tagQuery: a.tagQuery });
          for (const b of list) {
            const layers = a.finishAll ? b.stacks : Math.round(this.val(a.finishLayerCnt, ctx.bb));
            this.endBuff(b, layers, !!a.isFinishedEarly);
            // An operator's skill ending an enemy's buff early consumes it (Zhuang Fangyi's battle skill consuming
            // Electrification): OnConsumeBuff on both, as for an infliction (Lone Barge listens for it).
            if ((a.isFinishedEarly || a.isAbsorbed) && e.side === 'enemy') {
              const by = (a.finishSource ? (this.targets(a.finishSource, ctx)[0] ?? ctx.owner) : ctx.owner).owner ?? ctx.owner;
              if (by.side === 'team') {
                const extra = { buff: b, consumed: Math.min(layers, b.stacks + layers), origin: ctx.run?.skillId ?? ctx.skillId };
                this.abilityEvent(e, 'OnConsumeBuff', by, undefined, undefined, extra);
                this.abilityEvent(by, 'OnConsumeBuff', e, undefined, undefined, extra);
              }
            }
          }
          // Arts Infliction isn't a buff here: ending it by its tag consumes that element's stacks (Last Rite's combo:
          // Cryo; Laevatain's absorbing, FinishBuffAdvanced: Heat, one stack at a time).
          const els = inflictionsIn(a.tagQuery?.tags ?? a.buffSettings?.tagQuery?.tags);
          if (els.length) {
            const by = a.finishSource ? (this.targets(a.finishSource, ctx)[0] ?? ctx.owner) : ctx.owner;
            for (const el of els) this.consume(e, el, by.owner ?? by, ctx, a.finishAll ? Infinity : Math.round(this.val(a.finishLayerCnt, ctx.bb)));
          }
        }
        return;
      }
      // A projectile's skills: on launch, on hit or on reaching its target, when it ends. Its flight time isn't in
      // the readable data, so it arrives at once.
      case 'LaunchProjectile': {
        const ids = new Set<string>();
        if (a.castSkillOnLaunch && a.skillIdOnLaunch) ids.add(a.skillIdOnLaunch);
        if (a.castSkillOnHit && a.projectileSkillId) ids.add(a.projectileSkillId);
        if (a.castSkillOnReach && a.skillIdOnReach) ids.add(a.skillIdOnReach);
        if (a.castSkillOnFinish && a.skillIdOnFinish) ids.add(a.skillIdOnFinish);
        // One that only acts where it lands (castSkillOnBlock alone: Liino's notes falling on the enemy) lands on its target.
        if (a.castSkillOnBlock && a.skillIdOnBlock && !ids.size) ids.add(a.skillIdOnBlock);
        // Its target; several spots (a point finder's) get a projectile each.
        const list = a.targetSettings ? this.targets(a.targetSettings, ctx) : [];
        // A wave (WAVES) reaches everyone in range: each teammate and the enemy (no positions: all are in range).
        const at = [...ids].some((x) => WAVES.test(x))
          ? [...this.team, this.enemy]
          : list.length > 1 && list.every((x) => x === list[0])
            ? list
            : [list[0] ?? ctx.target ?? this.enemy];
        // The projectile is its source's (projectileSource: Si's ink burst comes from Si, though the buff is on the enemy),
        // carrying the caster's values and the pairs handed to it.
        const from = a.projectileSource ? this.targets(a.projectileSource, ctx)[0] : null;
        const caster = from ? (from.owner ?? from) : ctx.owner;
        const handed = new Map<string, number>(a.assignBlackboard === false ? [] : ctx.bb);
        if (a.assignEntityBlackboard) for (const pr of a.assignPairs ?? []) handed.set(pr.targetKey, pr.useDirectValue ? Number(pr.numericValue) : (ctx.bb.get(pr.inputValueKey) ?? 0));
        for (const target of at)
          for (const id of ids) {
            this.launching = ctx.run ? (ctx.run.origin ?? ctx.run) : undefined;
            this.cast(id, caster, caster, target, handed);
            this.launching = undefined;
          }
        return;
      }
      // An entity with no skill of its own is still made: something to put buffs on (Arcane's array marks a Cluster
      // Strike on one). Spawned by a buff on an enemy, it's the buff source's.
      case 'SpawnAbilityEntity': {
        if (!a.abilityEntitySkillId && !a.abilityEntityId) return;
        const by = ctx.owner.side === 'team' ? ctx.owner : ctx.source;
        const ent = this.entity(a.abilityEntityId ?? a.abilityEntitySkillId, 'team', by.owner ?? by, -1, (by.owner ?? by).stats);
        // What the spawner hands the entity's own blackboard.
        if (a.assignEntityBlackboard) for (const p of a.assignPairs ?? []) ent.bb.set(p.targetKey, p.useDirectValue ? Number(p.numericValue) : (ctx.bb.get(p.inputValueKey) ?? 0));
        const life = this.val(a.duration, ctx.bb);
        if (life > 0) ent.until = this.frame + Math.round(life * FPS);
        if (!a.abilityEntitySkillId) ent.marker = true;
        this.entities.push(ent);
        if (a.saveToContext && a.contextKey) ctx.groups.set(a.contextKey, [ent]);
        this.abilityEvent(ent.owner ?? ent, 'OnAbilityEntitySpawned', ent);
        if (a.abilityEntitySkillId) this.cast(a.abilityEntitySkillId, ent, ctx.owner, ctx.target ?? this.enemy, a.assignBlackboard ? ctx.bb : new Map());
        return;
      }
      case 'CastSkill': {
        // Its id can be plain or a value (from the blackboard's strings, or written in).
        const skillId: string = typeof a.skillId === 'string' ? a.skillId : (a.skillId?.useBlackboardKey ? '' : String(a.skillId?.value ?? ''));
        if (!skillId) return;
        const target = a.target ? (this.targets(a.target, ctx)[0] ?? this.enemy) : (ctx.target ?? this.enemy);
        const from = a.inheritSourceSkillCastId ? (ctx.castBB ?? ctx.bb) : ctx.bb;
        for (const caster of a.caster ? this.targets(a.caster, ctx) : [ctx.owner]) {
          // A buff casting its operator's own battle skill, combo or ultimate: the operator does it now, cutting what
          // it was doing (Liino's stance going on after her combo).
          const slot = ctx.run ? -1 : this.team.indexOf(caster);
          const takes = slot >= 0 && /^Character(Normal|Combo|Ultimate)Skill$/.test(this.skillOf.get(skillId)?.skillSpecification ?? '');
          if (takes && this.main[slot] && !this.main[slot]!.ended) this.endRun(this.main[slot]!, true);
          const run = this.cast(skillId, caster, caster, target, from);
          if (run && a.inheritSourceSkillCastId) run.castBB = from;
          // The operator's current skill (its press, or what that went on to) casting another of its own skills or
          // attacks: the game's one skill at a time, so the new one takes over (Typhoeus's hover: start, Aerial Basic
          // Attacks one after another, idle loop) and the operator's next basic attack cuts it.
          const own = this.team.indexOf(caster);
          const cur = ctx.run;
          if (run && !takes && own >= 0 && cur && !cur.ended && cur.owner === caster && (this.main[own] === cur || cur.follow) && /^Character(NormalAttack|NormalSkill|ComboSkill|UltimateSkill)$/.test(run.skill.skillSpecification ?? '')) {
            run.follow = true;
            if (cur.follow) this.endRun(cur, true);
          }
          if (takes && run) {
            run.main = true;
            this.main[slot] = run;
          }
        }
        return;
      }
      // The settings table at a status level; Damage values scale with the source's level and Arts Intensity (wiki: hidden multiplier).
      case 'ReadSkillSettingData':
        for (const d of a.dataList ?? []) {
          const row = this.settings[d.dataKey];
          if (!row) {
            this.note(`setting ${d.dataKey}`);
            continue;
          }
          const level = Math.min(row.values.length, Math.max(1, Math.round(this.val(d.column, ctx.bb))));
          let v = row.values[level - 1];
          const src = this.targets(d.enhanceAttributeSource, ctx)[0];
          const op = src ? (src.owner ?? src) : null;
          if (row.kind === 'Damage' && op?.stats) v *= this.hidden(op, /击飞|倒地|猛击|碎甲/.test(d.dataKey) ? 392 : 196);
          // Status effects (Breach, Electrification, Corrosion) × (1 + 2·AI / (AI + 300)); Lift and Knock Down Stagger × (1 + AI / 200).
          const ai = op?.stats ? this.stat(op, 'PhysicalAndSpellInflictionEnhance') : 0;
          if (row.kind === 'Debuff') v *= 1 + (2 * ai) / (ai + 300);
          if (row.kind === 'Poise') v *= 1 + ai / 200;
          ctx.bb.set(d.storeKey, v);
        }
        return;
      case 'TriggerSpellBurstEventAction':
      case 'OnSpellAbnormalStartFinish':
      case 'IgniteBuffTextAction':
        return;
      case 'CreateTimedMarker':
        for (const e of this.targets(a.targetSettings, ctx)) {
          const m = this.markers.get(e) ?? new Map<string, number>();
          m.set(this.markerId(a.markerId, ctx), this.frame + Math.round(this.val(a.duration, ctx.bb) * FPS));
          this.markers.set(e, m);
        }
        return;
      case 'TriggerCustomAbilityEvent':
        for (const e of this.targets(a.targets, ctx)) this.abilityEvent(e, 'OnCustomAbilityEvent', ctx.owner, undefined, eventName(a.eventName));
        return;
      // A battle skill's Ultimate Energy for the team: 6.5 per 100 SP spent (wiki), × the buff's ratio.
      case 'ObtainUspInNormalSkill': {
        const amount = ((6.5 * this.lastBattleCost) / 100) * (a.coefficient ? this.val(a.coefficient, ctx.bb) || 1 : 1);
        // The caster's own battle skill gets through its block (assumed: Last Rite gains "from her own battle skills").
        const from = ctx.source.owner ?? ctx.source;
        for (const t of this.team) this.obtain('UltimateSp', amount, t, t === from ? REFRAIN_ANY : undefined);
        return;
      }
      // No Ultimate Energy while the buff (or skill) that says so lasts, but gains tagged with one of its tags (Last
      // Rite: her own skills'; Arcane's ultimate: its array's), and with clearUspOnEnd none left when it ends.
      case 'RefrainObtainUsp':
        for (const e of this.targets(a.targetSettings, ctx)) {
          const op = e.owner ?? e;
          if (this.refrains.some((r) => r.op === op && r.buff === ctx.self && r.run === (ctx.self ? undefined : ctx.run))) continue;
          const tags = ((a.refrainObtainUspTags?.predefinedTag ?? []) as Data[]).map((t) => Number(t.tagId));
          this.refrains.push({ op, buff: ctx.self, run: ctx.self ? undefined : ctx.run, tags, clear: !!a.clearUspOnEnd });
        }
        return;
      case 'FinishOwnerAction':
        for (const e of this.targets(a.owner, ctx)) this.finishEntity(e);
        return;
      // A summon's time left: set (Zhuang Fangyi's swords: 3 s) or checked. Si's Inksoul isn't a summon here (INKBOOM).
      case 'SetAbilityEntityDuration':
        for (const e of this.targets(a.targetSettings, ctx)) {
          if (e.slot >= 0 || e.side !== 'team' || !e.alive) continue;
          const v = Math.round(this.val(a.value, ctx.bb) * FPS);
          e.until = a.operation === 'Add' ? (e.until ?? this.frame) + v : this.frame + v;
        }
        return;
      // One of a group, by its index (Zhuang Fangyi's swords).
      case 'PickTargetAction': {
        const list = this.targets(a.target, ctx);
        const one = list[Math.round(this.val(a.index, ctx.bb))];
        ctx.groups.set(a.contextKey, one ? [one] : []);
        return;
      }
      // The timeline jumps to a frame (skipping what's between) if its conditions hold.
      // Its condition is watched while its timeline entry lasts (Tangtang's Whirlpool waits for her battle skill's
      // wake buff over 50 s, then jumps to its end).
      case 'JumpToAction': {
        const run = ctx.run;
        if (!run) return;
        if (!this.check(a.conditionAction?.actionData, ctx)) {
          if ((ctx.span ?? 0) > 1) this.jumpWatch.push({ run, a, ctx, until: this.frame + (ctx.span ?? 0) });
          return;
        }
        this.jumpTo(run, Number(a.destFrame));
        return;
      }
      case 'MarkCanInterrupt':
        if (ctx.run) ctx.run.canInterrupt = true;
        return;
      case 'SaveBuffStackNum':
      case 'SaveBuffStackNumAdvanced': {
        const settings = a.buffSettings ?? (a.buffId ? [a.buffId] : []);
        const count = a.buffStackNumType === 'BuffIdCount';
        const n = this.targets(a.checkTarget, ctx).reduce((s, e) => s + this.buffsMatching(e, settings).reduce((k, b) => k + (count ? 1 : b.stacks), 0) + this.inflictionsMatching(e, settings, count), 0);
        ctx.bb.set(a.key, n);
        return;
      }
      // HP isn't simulated: an operator's Max HP, an enemy's as good as endless.
      case 'StoreEntityProperty': {
        const e = this.targets(a.targetSettings, ctx)[0];
        const v = e?.side === 'team' ? this.stat(e, 'MaxHp') : 1e9;
        const num = (f: Data, d: number) => (f == null ? d : typeof f === 'object' ? this.val(f, ctx.bb) : Number(f));
        const x = (v * num(a.multiplierValue, 1)) / (num(a.divisorValue, 1) || 1) + num(a.baseValue, 0);
        ctx.bb.set(a.key, a.useFloor ? Math.floor(x) : x);
        return;
      }
      case 'SkillAffixAction':
        return;
      // A Finisher's SP: as much as the enemy gives (breakingAttackedAtbObtain).
      case 'GainBreakingAttackAtb':
        this.obtain('Atb', this.foe.finisherSp ?? 0, ctx.owner);
        return;
      // A buff's time left, or setting it ("Environment": the buff these actions belong to).
      case 'SaveBuffLifeTime':
      case 'SetBuffDurationAction': {
        const list = a.buffSettings?.checkType === 'Environment' ? (ctx.self ? [ctx.self] : []) : this.targets(a.buffOwner ?? a.targetSettings, ctx).flatMap((e) => this.buffsMatching(e, a.buffSettings));
        if (t === 'SaveBuffLifeTime') {
          const b = list[0];
          ctx.bb.set(a.key, b ? (b.end === Infinity ? 1e9 : (b.end - this.frame) / FPS) : 0);
          return;
        }
        const v = this.val(a.value, ctx.bb) * FPS;
        for (const b of list) b.end = a.operationType === 'Add' ? b.end + v : this.frame + Math.round(v);
        return;
      }
      case 'SaveBuffStackNumByTag': {
        // Tags aren't tracked; the ones these count are Arts Infliction's: the target's stacks of those elements.
        const e = this.targets(a.checkTarget, ctx)[0];
        ctx.bb.set(a.key, e ? inflictionsIn(a.tagQuery?.tags).reduce((n, x) => n + (e.bb.get(`inflict_${x}`) ?? 0), 0) : 0);
        return;
      }
      case 'TriggerComboSkillAction':
        for (const e of this.targets(a.owner, ctx)) {
          const op = e.owner ?? e;
          if (op.slot >= 0) this.triggerCombo(op.slot);
        }
        return;
      case 'AddGlobalCDTimer':
        for (const e of this.targets(a.target, ctx)) {
          const m = this.cdTimers.get(e) ?? new Map<string, number>();
          m.set(a.buffId, this.frame + Math.round(this.val(a.cdTime, ctx.bb) * FPS));
          this.cdTimers.set(e, m);
        }
        return;
      case 'SaveDamageContext':
        ctx.bb.set(a.saveTo, ctx.damage?.amount ?? 0);
        return;
      // Consumes a target's stacks of an infliction.
      case 'InverseSpellInfliction':
        for (const e of this.targets(a.target, ctx)) this.consume(e, a.inflictionType, ctx.owner, ctx);
        return;
      // Weakened: the enemy deals less damage (nothing to this fight), but it's announced like Susceptibility.
      case 'WeakAction': {
        const from = (a.source ? this.targets(a.source, ctx)[0] : null) ?? ctx.source;
        const by = from.owner ?? from;
        if (by.side === 'team') for (const e of this.targets(a.target, ctx)) this.abilityEvent(by, 'OnOutputBuff', e, undefined, undefined, { buff: this.standIn(`weak|${ctx.self?.id ?? ctx.skillId}`, AFFIX_TAGS.WeakAction, e, by, 1) });
        return;
      }
      case 'VulnerableAction':
      case 'SpeedupAction':
      case 'EnhancedAction': {
        const until = this.val(a.duration, ctx.bb) < 0 ? Infinity : this.frame + Math.round(this.val(a.duration, ctx.bb) * FPS);
        const kind = a.subType ?? 'Spell';
        const parent = a.asChildBuff ? ctx.self : undefined;
        const key = `${a.overrideChildBuffId ? this.val(a.childBuffId, ctx.bb) || a.childBuffId?.value : ''}|${ctx.self?.id ?? ctx.skillId}|${kind}`;
        for (const e of this.targets(a.target, ctx)) {
          const list = t === 'VulnerableAction' ? (e.vulnerable ??= []) : t === 'SpeedupAction' ? (e.haste ??= []) : (e.amp ??= []);
          const i = list.findIndex((x) => x.key === key);
          const grow = (a.enhancingList ?? [])
            .filter((g: Data) => (g.operationType ?? 'Add') === 'Add')
            .map((g: Data) => ({ ids: g.buffIds ?? [], add: this.val(g.value, ctx.bb) }));
          const effect: Effect = { kind, rate: this.val(a.rate, ctx.bb), until, key, parent, ...(grow.length ? { grow } : {}) };
          if (i >= 0) list[i] = effect;
          else list.push(effect);
          const from = (a.source ? this.targets(a.source, ctx)[0] : null) ?? ctx.source;
          const by = from.owner ?? from;
          if (by.side === 'team' && AFFIX_TAGS[t]) this.abilityEvent(by, 'OnOutputBuff', e, undefined, undefined, { buff: this.standIn(key, AFFIX_TAGS[t], e, by, 1) });
        }
        return;
      }
      case 'ChangeSkillAction': {
        const life = a.lifeTimeType as string;
        // FinishByAction in a skill's timeline: while that entry lasts (Liino's ultimate: End Stance for 15 s).
        const run = life === 'FinishByAction' && !ctx.self && ctx.run && (ctx.span ?? 0) > 0 ? ctx.run : undefined;
        for (const e of this.targets(a.skillSource, ctx)) {
          const op = e.owner ?? e;
          const m = this.slots.get(op) ?? new Map();
          m.set(a.skillSlot, {
            id: a.targetSkillId,
            buff: life === 'FinishByAction' ? ctx.self : undefined,
            run,
            until: run
              ? this.frame + (ctx.span ?? 0)
              : life === 'SpecificTime' || (life === 'FinishByAction' && !ctx.self)
                ? this.frame + Math.round(this.val(a.duration, ctx.bb) * FPS)
                : undefined,
            back: a.specificRevertedSkillId ? a.revertedSkillId : undefined,
          });
          this.slots.set(op, m);
        }
        return;
      }
      // Heals: no HP is tracked (nothing hits back on the training dummy), so everyone is at full HP and every
      // heal is overhealing; what listens for heals (Camille's Bloodfount Revival, healers' weapons) still hears them.
      case 'HealAction': {
        const from = a.healer === 'ActionOwner' ? ctx.owner : ctx.source;
        const healer = from.owner ?? from;
        const heal = { tags: a.useHealTags ? (a.healTags?.predefinedTag ?? []).map((t: Data) => t.tagId) : [], over: true };
        for (const t of this.targets(a.target, ctx)) {
          const who = t.owner ?? t;
          this.abilityEvent(healer, 'OnOutputHeal', who, undefined, undefined, { heal });
          this.abilityEvent(who, 'OnReceiveHeal', healer, undefined, undefined, { heal });
        }
        return;
      }
      // Physical statuses: Lift (AirborneAction), Knock Down, Crush, Breach (FractureAction).
      case 'AirborneAction':
      case 'AirborneAction+AirborneAction':
        for (const e of this.targets(a.target, ctx)) this.physical('Lift', e, ctx, !!a.forceAirborne);
        return;
      case 'KnockDownAction':
        for (const e of this.targets(a.targetSettings, ctx)) this.physical('KnockDown', e, ctx, !!a.forceKnockDown);
        return;
      case 'CrushAction':
        for (const e of this.targets(a.targetSettings, ctx)) this.physical('Crush', e, ctx, false, this.val(a.damageMultiplier ?? { value: 1 }, ctx.bb) || 1);
        return;
      case 'FractureAction':
        for (const e of this.targets(a.targetSettings, ctx)) this.physical('Breach', e, ctx);
        return;
      // Ends the current skill of whoever it names (Ardelia's battle skill ends itself at frame 188 unless her talent jumped past it).
      case 'InterruptCurSkillAction':
        for (const e of this.targets(a.skillOwner, ctx)) {
          if (e.side !== 'team') continue;
          const run = e.slot >= 0 ? this.main[e.slot] : this.runs.find((r) => r.owner === e && !r.ended);
          if (run) this.endRun(run, true);
        }
        return;
      // Movement only: a launch with no Lift (Camille's combo dash), a knock-back of the defeated.
      case 'LaunchUpwardAction':
      case 'BlowOffEnemyAction':
        return;
      // A forced Arts Reaction (wiki: Arts Reaction): no infliction consumed, no initial hit, at Status Level `count` (I by default).
      case 'ForceSpellStatusAction':
        for (const e of this.targets(a.target, ctx)) {
          // It consumes `consumedLayer` stacks of the infliction `consumedType` names first (1–4 as consumed_type:
          // Heat, Cryo, Electric, Nature): Yvonne's bomb takes the Cryo it freezes with.
          const kind = Math.round(this.val(a.consumedType, ctx.bb));
          const layers = Math.round(this.val(a.consumedLayer, ctx.bb));
          if (kind > 0 && layers > 0 && ELEMENTS[kind - 1]) this.consume(e, ELEMENTS[kind - 1], ctx.source.owner ?? ctx.source, ctx, layers);
          this.forceReaction(e, a.spellStatusType, Math.max(1, Math.min(4, Math.round(this.val(a.count, ctx.bb)) || 1)), ctx);
        }
        return;
      // The SP the last gain brought (Pogranichnik).
      case 'SaveAtbObtainValue':
        ctx.bb.set(a.valueKey, this.lastAtbAmount);
        return;
      // A skill takes over a buff already running: it now lasts while this entry does, and goes on to the listed
      // next skills (Liino's Vocalist Stance through her combo and back).
      case 'InheritBuffAction':
        if (!ctx.run) return;
        for (const e of this.targets(a.buffOwner, ctx))
          for (const b of e.buffs)
            if (b.id === a.targetBuffId) {
              if (a.finishByAction && (ctx.span ?? 0) > 0) {
                b.ownEnd ??= b.end;
                b.byRun = ctx.run;
                b.end = Math.min(b.ownEnd, this.frame + (ctx.span ?? 0));
              }
              b.inherit = a.inheritSkillIdList ?? [];
            }
        return;
      // How far into its skill the caster is, in frames (Liino's stance: how long she's sung).
      case 'StoreCurSkillExecuteFrame':
        if (ctx.run) ctx.bb.set(a.blackboardKey, this.frame - ctx.run.start);
        return;
      // Slows, blocks, shields against attacks, movement and interface: the training dummy neither moves nor attacks.
      case 'SlowAction':
      case 'MarkCanDash':
      case 'ReceiveMoveInputAction':
      case 'EventListenerAction':
        if (ctx.run && a.abilityActionMap?.length) this.runListeners.push({ run: ctx.run, until: this.frame + (ctx.span ?? 0), map: a.abilityActionMap });
        return;
      case 'ShelterAction':
      case 'CreateAdditionalBattleShape':
      case 'EnableMoveColliderAction':
      case 'ModifyWeaponMountPoint':
      case 'BreakInteractiveAction':
      case 'ForceHideHeadBarAction':
      case 'BoneAttachAction':
      case 'ShowTyphoeaHudHint':
      case 'TriggerLiinoUIEvent':
      case 'AttackClickListenerAction':
      case 'SkillAIMoveAction':
      case 'AddAIMarkerAction':
        return;
      // Link (Camille's combo, Lifeng): a team buff with its own duration, one per count.
      case 'ComboAction': {
        const until = this.frame + Math.round(this.val(a.duration, ctx.bb) * FPS);
        for (let i = 0; i < Math.max(1, Math.round(this.val(a.count ?? { value: 1 }, ctx.bb))); i++) this.links.push(until);
        return;
      }
      // Stops or restarts the clock of the buff whose event runs it.
      case 'PauseBuffTime':
        if (ctx.self) ctx.self.paused = !!a.isPaused;
        return;
      case 'SwitchModeAction': {
        if (!ctx.self) return;
        const op = ctx.self.owner.owner ?? ctx.self.owner;
        const list = (this.modes.get(op) ?? []).filter((x) => x.buff.owner.buffs.includes(x.buff));
        list.push({ mode: a.modeId, buff: ctx.self });
        this.modes.set(op, list);
        return;
      }
      case 'GetCharBySquadSlot': {
        // Team position (0 = position 01): a value object, like most fields.
        const op = this.team[this.val(a.slotIndex, ctx.bb)];
        ctx.groups.set(a.targetGroupKey, op ? [op] : []);
        return;
      }
      // The element of the operator in a team slot, as the game numbers them (Fire 0, Pulse 1, Cryst 2, Natural 3, Physical 4).
      case 'SaveCharTypeIdToIntBySquadSlot': {
        const op = this.team[this.val(a.slotIndex, ctx.bb)];
        const i = ['Fire', 'Pulse', 'Cryst', 'Natural', 'Physical'].indexOf(op ? (this.bundleOf(op)?.element ?? '') : '');
        ctx.bb.set(a.storeKey, i >= 0 ? i : Number(a.defaultValue ?? -1));
        return;
      }
      // A group, filtered: ExcludeTarget (Ardelia's bomb: the half-damage blast is for the others), a priority filter's
      // count (Tangtang); a body part is its body here.
      case 'TargetPostProcessorAction': {
        let list = this.validate(this.targets(a.target, ctx), a.validatorData ?? [], ctx);
        for (const pp of a.postProcessorData ?? []) {
          const k = short(pp.$type);
          if (k === 'Selector+ExcludeTarget') {
            const out = this.targets(pp.excludedTargetSettings, ctx);
            list = list.filter((e) => !out.includes(e));
          } else if (k === 'Selector+PriorityFilter' && pp.limitMaxNum) list = list.slice(0, Math.max(0, Number(pp.maxNum ?? 1)));
        }
        ctx.groups.set(a.targetGroupKey, list);
        return;
      }
      // Cuts a skill's remaining cooldown (a share of it, or seconds).
      case 'SetSkillCdAtOnce': {
        // The skill by id, or by kind (useSkillType: skillTypeMask ComboSkill...) on each target.
        const KIND: Record<string, Input> = { NormalSkill: 'battle', ComboSkill: 'combo', UltimateSkill: 'ultimate' };
        for (const e of this.targets(a.target, ctx)) {
          const op = e.owner ?? e;
          const id = a.useSkillType ? (KIND[a.skillTypeMask] && op.side === 'team' ? this.skillIdOf(op, KIND[a.skillTypeMask]) : '') : (a.skillId as string);
          if (!id) continue;
          const left = Math.max(0, (this.readyAt.get(id) ?? 0) - this.clockNow);
          const v = this.val(a.value, ctx.bb);
          const cut = a.isPercentage ? left * v : v * FPS;
          if (left > 0 && e.side === 'team') this.readyAt.set(id, this.clockNow + Math.max(0, Math.round(left - (a.functionType === 'Reduce' ? cut : -cut))));
        }
        return;
      }
      case 'RefreshBuffAttrModifierValue':
      case 'ForceTriggerWeakness':
      case 'ForceTargetInFightAction':
      case 'TagQueryListenerAction':
      case 'DispelAction':
      case 'SealAction': {
        const secs = this.val(a.duration, ctx.bb);
        const keys = (a.directCurve?.keys ?? []).map((k: Data) => [Number(k.time), Number(k.value)] as [number, number]);
        if (secs > 0 && keys.length) this.seals.push({ from: this.frame, frames: Math.round(secs * FPS), keys });
        return;
      }
      case 'AddTagAction':
      case 'MarkCanInterrupt':
        return;
      // Presentation, movement and input handling: no effect on damage.
      case 'PlayAnimationAction+PlayAnimationAction':
      // A voice line cut off.
      case 'VoiceInterruptAction+VoiceInterruptAction':
      case 'VoiceInterruptAction':
      case 'PlayAnimationWithStep+PlayAnimationWithStep':
      case 'ComboCacheAction':
      case 'AllowNextSkillAction':
      case 'SetSuperArmorAction':
      case 'InterruptAction':
      case 'CurveEvaluateFloat':
      case 'TemporaryUnlockAction':
      case 'SaveTargetDistanceAction':
      case 'ChannelingCastingAction':
      case 'TogglableAction':
        return;
      // A combo skill's banner: the game slows everyone but its caster (Global, curve "ComboSkill") for the action's
      // duration, cut short by a later RESETto1 in the same skill (Arcane's after 9 frames). The curve isn't in the
      // dump: the recordings show regeneration and the Staggered meter at about a sixth of their rate (COMBO_SLOW),
      // so both stand still for the time lost (`slowLeft`). Inside a cut-in it adds nothing.
      case 'TimeDilationAction': {
        if (a.layer !== 'Global' || a.curveKey !== 'ComboSkill' || !ctx.run || ctx.run.owner.side !== 'team' || this.freeze) return;
        const at = this.frame - ctx.run.start;
        let span = Math.round(this.val(a.duration, ctx.bb) * FPS);
        for (const ta of ctx.run.skill.actionGroupData?.timelineActions ?? [])
          if (ta._startFrame > at && (ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'TimeDilationAction' && d.layer === 'Global' && d.curveKey === 'RESETto1'))
            span = Math.min(span, ta._startFrame - at);
        const left = Math.round(span * (1 - COMBO_SLOW));
        this.slowLeft = Math.max(this.slowLeft, left);
        return;
      }
      // Time stops for everyone but the caster while its timeline entry lasts (the ultimate's cut-in).
      case 'UltimateTimeAction':
        if (ctx.run && Number(a.timeScale ?? 1) === 0 && ctx.span) {
          const next = { owner: ctx.run.owner, from: this.frame, left: ctx.span };
          // A second ultimate in the first's cut-in plays its own after it: the game stays frozen for both (the
          // Skydrummer recording: 3.38 s for Xaihi's and Arcane's, not one cut-in's 1.57).
          if (this.freeze && this.freeze.left > 0 && this.freeze.owner !== next.owner) this.freezeQueue.push(next);
          else this.freeze = next;
        }
        return;
      default:
        this.note(t);
    }
  }

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  cast(skillId: string, owner: Entity, source: Entity, target: Entity | null, inherit?: Map<string, number>): Run | null {
    const skill = this.skillOf.get(skillId);
    if (!skill) {
      this.note(`missing skill ${skillId}`);
      return null;
    }
    // The skill's own defaults, then what its caster hands over, then the skill table's values for it.
    // A projectile's hit reads its launch's own EntityBB_ keys first (projectileKeys).
    const bb = this.launching ? new BB((this.launching.projBB ??= new Map()), owner.bb) : new BB(owner.bb);
    for (const b of skill.blackboard ?? []) bb.set(b.key, Number(b.valueDouble ?? b.value ?? 0));
    for (const [k, v] of inherit ?? []) bb.set(k, v);
    if (this.patchOf.has(skillId)) for (const [k, v] of this.skillBlackboard(skillId, (owner.owner ?? owner).slot)) if (this.patchOf.get(skillId)!.some((l) => k in l.values)) bb.set(k, v);
    for (const m of this.skillMods.get(skillId) ?? []) bb.set(m.key, m.how === 1 ? (bb.get(m.key) ?? 0) + m.value : m.how === 2 ? (bb.get(m.key) ?? 0) * m.value : m.value);
    // The combo's trigger target (and any skill's chosen target): the enemy.
    const run: Run = { skillId, skill, owner, source, start: this.frame, castAt: this.frame, bb, groups: new Map([['smart_target', [target ?? this.enemy]]]), target: target ?? this.enemy, done: new Set(), ended: false, ...(this.launching ? { origin: this.launching } : {}) };
    // Buffs the skill grants while cast (passives keep them), with the skill's values; a passive's attribute changes last.
    // A "ToggleBuff" passive's effect is in toggleBuffs (its buffs list is a leftover: several gear sets name another set's buff there).
    const granted: Data[] = skill.castType === 'Passive' && skill.passiveSkillType === 'ToggleBuff' ? (skill.toggleBuffs ?? []).flatMap((g: Data) => g.buffs ?? []) : (skill.buffs ?? []);
    for (const b of granted) if (b?.buffId) this.addBuff(owner, b.buffId, owner, new Map(bb));
    if (skill.castType === 'Passive') {
      for (const m of skill.cardAttributeModifier?.attributeModifiers ?? []) owner.mods.push({ attributeType: this.attrOf(m, owner), formulaItem: m.formulaItem, value: this.val(m.param, bb) });
      const events = skill.actionGroupData?.passiveEventActions ?? [];
      if (events.length) owner.listeners.push({ id: skillId, events, bb, groups: new Map() });
    }
    // What the owner's cut skill hands to this one goes on under it (inheritSkillIdList).
    for (const b of owner.buffs) if (b.byRun?.ended && b.byRun.owner === owner && b.inherit?.includes(skillId)) b.byRun = run;
    this.runs.push(run);
    this.stepRun(run);
    return run;
  }

  /** A summon (an operator's ability entity) of someone other than `caster`: it runs on through `caster`'s cut-in. */
  private summonOfOther(e: Entity, caster: Entity): boolean {
    return e.side === 'team' && e.slot < 0 && !!e.owner && e.owner !== caster && e.owner.side === 'team';
  }

  /** Whether a run was cast at or after a world frame. */
  private startedSince(run: Run, frame: number): boolean {
    return (run.castAt ?? run.start) >= frame;
  }

  private ctxOf(run: Run): Ctx {
    return { owner: run.owner, source: run.source, target: run.target, bb: run.bb, groups: run.groups, skillId: run.skillId, castBB: run.castBB ?? run.bb, run };
  }

  private stepRun(run: Run): void {
    const list: Data[] = run.skill.actionGroupData?.timelineActions ?? [];
    list.forEach((ta, i) => {
      if (run.ended || run.done.has(i) || ta._startFrame > this.frame - run.start) return;
      run.done.add(i);
      this.execBlock(ta._sequenceActionData, { ...this.ctxOf(run), span: Math.max(0, (ta._endFrame ?? ta._startFrame) - ta._startFrame) });
    });
    const at = this.frame - run.start;
    const length = Math.max(run.skill.durationFrame ?? 0, ...list.map((ta) => ta._startFrame ?? 0));
    if (at >= length) this.endRun(run);
  }

  /** Ends a run; an operator's press reports it (OnSkillEnd; OnSkillInterrupted first when the next press cut it). */
  private endRun(run: Run, cut = false): void {
    if (run.ended) return;
    run.ended = true;
    if (!run.main) return;
    if (cut) this.abilityEvent(run.owner, 'OnSkillInterrupted', run.target, undefined, undefined, { origin: run.skillId, reason: 'CastNextSkill' });
    this.abilityEvent(run.owner, 'OnSkillEnd', run.target, undefined, undefined, { origin: run.skillId });
  }

  // -------------------------------------------------------------------------
  // Buffs
  // -------------------------------------------------------------------------

  addBuff(e: Entity, id: string, source: Entity, assigned: Map<string, number>, groups?: Map<string, Entity[]>): Buff | null {
    const def = this.buffOf.get(id);
    if (!def) {
      this.note(`missing buff ${id}`);
      return null;
    }
    // EntityBB_ keys: the creator's entity first (an ability's values), then the buff's owner.
    const bb = new BB((source.owner ?? source).bb, source.bb, e.bb);
    for (const b of def.blackboard ?? []) bb.set(b.key, Number(b.valueDouble ?? b.value ?? 0));
    for (const m of this.skillMods.get(id) ?? []) bb.set(m.key, m.how === 1 ? (bb.get(m.key) ?? 0) + m.value : m.how === 2 ? (bb.get(m.key) ?? 0) * m.value : m.value);
    for (const [k, v] of assigned) bb.set(k, v);
    const st = def.stackingSettings ?? {};
    const max = st.useMaxStackCntKey ? bb.get(st.maxStackCntKey) ?? st.maxStackCnt : st.maxStackCnt ?? 1;
    const existing = e.buffs.find((b) => b.id === id);
    const duration = this.val(def.duration, bb);
    const end = def.lifeType === 'Infinity' || duration < 0 ? Infinity : this.frame + Math.round(duration * FPS);
    const by = source.owner ?? source;
    // The buff about to be given (a stand-in with its id and tags when it's new: Yvonne's bomb listens for the
    // Solidification it gives).
    const giving = existing ?? this.standIn(id, (def.applyTags ?? []).map((x: Data) => x.tagId), e, source, 1);
    this.abilityEvent(by, 'OnBeforeOutputBuff', e, undefined, undefined, { buff: giving, eventCastKind: this.creating });
    // A one-layer "Stack" buff is replaced by the new one, which starts over (its OnBuffStart runs again).
    if (existing && st.stackingType === 'Stack' && max <= 1) this.endBuff(existing);
    else if (existing && st.stackingType !== 'Unlimited') {
      if (st.stackingType === 'Unique') return existing;
      if (/Refresh/.test(st.stackingType)) existing.end = end;
      const before = existing.stacks;
      if (st.stackingType === 'Stack' || (st.stackingType === 'HighPriorityWithMaxStack' && max > 1)) {
        // Each stack keeps its own time ("duration of each stack is counted separately"); the oldest goes when full
        // (HighPriorityWithMaxStack too: Bedazzling Night Debut's ATK, up to 4 stacks).
        const ends = existing.stackEnds ?? Array<number>(existing.stacks).fill(existing.end);
        ends.push(end);
        ends.sort((x, y) => x - y);
        while (ends.length > max) ends.shift();
        existing.stackEnds = ends;
        existing.stacks = ends.length;
        existing.end = ends[ends.length - 1];
      } else if (/Enhance/.test(st.stackingType)) existing.stacks = Math.min(max, existing.stacks + 1);
      for (const [k, v] of assigned) existing.bb.set(k, v);
      if (existing.stacks !== before) this.buffEvent(existing, 'OnBuffEnhanceChanged');
      this.abilityEvent(by, 'OnOutputBuff', e, undefined, undefined, { buff: existing });
      this.abilityEvent(e, 'OnAddedBuff', by, undefined, undefined, { buff: existing });
      return existing;
    }
    const interval = this.val(def.triggerInterval, bb);
    // Ticks every interval: the first after one interval (waitFirstTriggerInterval) or right away.
    const first = interval > 0 ? this.frame + (def.waitFirstTriggerInterval ? Math.round(interval * FPS) : 0) : Infinity;
    const buff: Buff = { id, def, owner: e, source, stacks: 1, start: this.frame, end, bb, nextTrigger: first, triggers: 0, done: new Set(), groups: new Map(groups ?? []), ...(this.creating ? { castKind: this.creating } : {}) };
    e.buffs.push(buff);
    // While a buff starts, counts of buffs leave it out: its own OnBuffStart sees the ones before it (Laevatain's
    // combo energy: 25 for the first of its buffs, 5 after).
    this.starting = buff;
    // Si's Final Stroke bursts her Inksoul in 2 s (SetAbilityEntityDuration on the Inksoul, which the engine
    // doesn't model), and Artful Intent ends with it: one mark at a time, its recorded damage released then.
    // Keyed on the buff Final Stroke makes on its first frame (its _inkboom comes after its cancel window).
    if (id === INKBOOM) for (const b of this.enemy.buffs) if (b.id === ARTFUL_INTENT) b.end = Math.min(b.end, this.frame + 2 * FPS);
    // Effects on its owner that grow with this buff (enhancingList).
    for (const fx of [...(e.amp ?? []), ...(e.vulnerable ?? []), ...(e.haste ?? [])])
      if (fx.until > this.frame) for (const g of fx.grow ?? []) if (g.ids.includes(id)) fx.rate += g.add;
    this.buffEvent(buff, 'OnBuffStart');
    this.starting = null;
    for (const t of def.applyTags ?? []) if (STATUS_TAG[t.tagId] && e.side === 'enemy') this.comboEvent({ kind: 'status', status: STATUS_TAG[t.tagId], target: e });
    // Its giver may change its values (Arcane's Weapon Honing: Corrosion lasts longer and lowers Resistance
    // further). The buff works them out as it starts, so they're changed after that.
    const was = bb.get('duration');
    this.abilityEvent(by, 'OnCollectOutputBuffBbValue', e, undefined, undefined, { buff, collected: bb });
    if (bb.get('duration') !== was && def.lifeType !== 'Infinity') {
      const d = this.val(def.duration, bb);
      buff.end = d < 0 ? Infinity : buff.start + Math.round(d * FPS);
    }
    // As it's enabled: once (Liino's ATK Boost on each teammate), and what lasts while it is.
    this.buffEvent(buff, 'OnBuffEnable');
    this.buffEvent(buff, 'DuringBuffEnable');
    this.stepBuff(buff);
    this.abilityEvent(by, 'OnOutputBuff', e, undefined, undefined, { buff });
    this.abilityEvent(e, 'OnAddedBuff', by, undefined, undefined, { buff });
    return buff;
  }

  /** Takes layers off a buff; at none it ends, and its owner hears it (OnFinishedBuff; OnBuffEndsEarly when an action ended it early). */
  endBuff(b: Buff, layers = b.stacks, early = false): void {
    b.stacks -= layers;
    if (b.stackEnds) b.stackEnds.splice(0, Math.min(layers, b.stackEnds.length - Math.max(0, b.stacks)));
    if (b.stacks > 0) return;
    const i = b.owner.buffs.indexOf(b);
    if (i < 0) return;
    b.owner.buffs.splice(i, 1);
    this.buffEvent(b, 'OnBuffFinish');
    this.abilityEvent(b.owner, 'OnFinishedBuff', b.source, undefined, undefined, { buff: b });
    if (early) this.abilityEvent(b.owner, 'OnBuffEndsEarly', b.source, undefined, undefined, { buff: b });
    if (early && b.owner.side === 'enemy') for (const t of b.def.applyTags ?? []) if (STATUS_TAG[t.tagId]) this.comboEvent({ kind: 'statusConsumed', status: STATUS_TAG[t.tagId], target: b.owner });
  }

  private buffCtx(b: Buff, target: Entity | null = null): Ctx {
    return { owner: b.owner, source: b.source, target: target ?? (b.owner.side === 'team' ? this.enemy : b.owner), bb: b.bb, groups: b.groups, skillId: b.id, castBB: b.castBB, self: b };
  }

  /** Runs a buff's own timeline up to now. */
  private stepBuff(b: Buff): void {
    const at = this.frame - b.start;
    (b.def.timelineActions ?? []).forEach((ta: Data, i: number) => {
      if (b.done.has(i) || (ta._startFrame ?? 0) > at) return;
      b.done.add(i);
      this.execBlock(ta._sequenceActionData ?? ta, { ...this.buffCtx(b), span: Math.max(0, (ta._endFrame ?? ta._startFrame ?? 0) - (ta._startFrame ?? 0)) });
    });
  }

  private buffEvent(b: Buff, event: string, target: Entity | null = null, damage?: Ctx['damage']): void {
    for (const e of b.def.buffEventAction ?? []) if (e.buffEvent === event) for (const a of e.actions ?? []) this.execBlock(a, { ...this.buffCtx(b, target), damage });
  }

  /** How deep events are nested (an event's actions can raise more). */
  private eventDepth = 0;

  /**
   * Consumes an enemy's stacks of an Arts Infliction (up to `max`): OnConsumeBuff on the enemy and on the
   * operator who consumed them, about the infliction (as a buff with the infliction tags) and how many stacks.
   */
  consume(e: Entity, element: string, by: Entity, ctx: Ctx, max = Infinity): void {
    const have = e.bb.get(`inflict_${element}`) ?? 0;
    const n = Math.min(have, max);
    if (!n) return;
    e.bb.set(`inflict_${element}`, have - n);
    ctx.bb.set('consumed_layer', n);
    const buff = this.standIn(`infliction_${element}`, [INFLICTION_TAG[element], ANY_INFLICTION], e, by, n);
    this.abilityEvent(e, 'OnConsumeBuff', by, undefined, undefined, { buff, consumed: n });
    if (by !== e) this.abilityEvent(by, 'OnConsumeBuff', e, undefined, undefined, { buff, consumed: n });
    this.comboEvent({ kind: 'consume', element, stacks: n });
  }

  /** Ability events on an entity's buffs and passive skills ("OnTakeDamage", "OnBeforeCastSkill", ...). */
  abilityEvent(e: Entity, event: string, target: Entity | null, damage?: Ctx['damage'], name?: string, extra: Partial<Ctx> = {}): void {
    if (this.eventDepth > 8) return;
    this.eventDepth++;
    for (const b of [...e.buffs])
      for (const ev of b.def.abilityEventAction ?? []) if (ev.abilityEvent === event) for (const a of ev.actions ?? []) this.execBlock(a, { ...this.buffCtx(b, target), damage, event: name, ...extra });
    for (const l of e.listeners)
      for (const ev of l.events)
        if (ev.abilityEvent === event)
          for (const a of ev.actions ?? [])
            this.execBlock(a, { owner: e, source: e, target: target ?? (e.side === 'team' ? this.enemy : e), bb: l.bb, groups: l.groups, skillId: l.id, damage, event: name, ...extra });
    // A running skill's listeners hear their side's events, in the skill's own context (so a JumpToAction moves it).
    if (this.runListeners.length) {
      this.runListeners = this.runListeners.filter((l) => !l.run.ended && this.frame <= l.until);
      for (const l of [...this.runListeners])
        if ((l.run.owner.owner ?? l.run.owner).side === (e.owner ?? e).side)
          for (const m of l.map)
            if (m.abilityEvent === event)
              for (const a of m.actions ?? []) this.execBlock(a, { ...this.ctxOf(l.run), target: target ?? this.enemy, damage, event: name, ...extra });
    }
    this.eventDepth--;
  }

  /** Whether a modifier's attribute is `name` (or a composite that includes it). */
  private names(type: string, name: string): boolean {
    return type === name || !!this.composites[type]?.includes(name);
  }

  /** The additions (or multipliers) to an attribute from lasting changes and buffs. */
  private modSum(e: Entity, name: string, multipliers: boolean): number {
    let n = 0;
    for (const m of e.mods) if (this.names(m.attributeType, name) && /Multiplier/.test(m.formulaItem) === multipliers) n += m.value;
    for (const b of e.buffs)
      for (const m of b.def.attributeModifier?.attributeModifiers ?? [])
        if (this.names(this.attrOf(m, e), name) && /Multiplier/.test(m.formulaItem) === multipliers) n += this.val(m.param, b.bb) * b.stacks;
    return n;
  }

  /** The attribute a modifier changes: modifyAttributeType Main / Sub mean the operator's main or secondary attribute. */
  private attrOf(m: Data, e: Entity): string {
    const op = e.owner ?? e;
    if (m.modifyAttributeType === 'Main' && op.stats) return op.stats.main;
    if (m.modifyAttributeType === 'Sub' && op.stats) return op.stats.sub;
    return m.attributeType;
  }

  /** An attribute: base + additions (multipliers apart: `multiplier`). MaxUltimateSp: the ultimate's cost. */
  attribute(e: Entity, name: string): number {
    const base = e.attr[name] ?? (name === 'MaxUltimateSp' && e.side === 'team' ? this.ultCost(e.owner ?? e) : 0);
    return base + this.modSum(e, name, false);
  }

  /** The sum of an attribute's multipliers (0.1 = +10%). */
  multiplier(e: Entity, name: string): number {
    return this.modSum(e, name, true);
  }

  /** A scalar attribute (…Scalar, 1 unless changed): the product of its multipliers' factors. */
  factor(e: Entity, name: string): number {
    let f = 1;
    for (const m of e.mods) if (this.names(m.attributeType, name) && /Multiplier/.test(m.formulaItem)) f *= m.value;
    for (const b of e.buffs)
      for (const m of b.def.attributeModifier?.attributeModifiers ?? [])
        if (this.names(this.attrOf(m, e), name) && /Multiplier/.test(m.formulaItem)) f *= this.val(m.param, b.bb) ** b.stacks;
    return f;
  }

  /** An attribute as it ends up: (base + additions) × (1 + multipliers). */
  stat(e: Entity, name: string): number {
    return this.attribute(e, name) * (1 + this.multiplier(e, name));
  }

  /**
   * ATK (wiki: Damage): (operator + weapon ATK) × (1 + ATK %) + flat ATK,
   * × (1 + 0.5% per point of the main attribute + 0.2% per point of the secondary).
   */
  atk(op: Entity): number {
    const s = op.stats;
    if (!s) return 0;
    const base = op.attr.Atk ?? 0;
    const flat = this.attribute(op, 'Atk') - base;
    return (base * (1 + this.multiplier(op, 'Atk')) + flat) * (1 + 0.005 * this.stat(op, s.main) + 0.002 * this.stat(op, s.sub));
  }

  // -------------------------------------------------------------------------
  // Damage
  // -------------------------------------------------------------------------

  private damageAction(a: Data, ctx: Ctx): void {
    if (this.forcing && /^buff_common_\w+_triggered$/.test(ctx.skillId)) return;
    // "ActionSource": who the action comes from (a skill's caster, a buff's source), as its operator.
    const by = a.attacker === 'ActionOwner' ? ctx.owner : ctx.source;
    const attacker = by.owner ?? by;
    for (const target of this.targets(a.targetSettings, ctx)) {
      // An untouchable enemy (Invulnerable) takes no HP damage and no Stagger, but a hit still lands: its statuses
      // apply and its critical hit counts (the owner's video: Yvonne's bomb into Alleikhreos's phantoms Solidified
      // him and armed her talent).
      const immune = attacker.side === 'team' && target.side === 'enemy' && this.untouchable();
      const pending = attacker.side === 'team' && target.side === 'enemy' ? this.interrupts.get(attacker.slot) : undefined;
      if (pending && this.frame <= pending.until && this.kindOfSkill(ctx.skillId) === pending.kind && this.foe.interrupt) {
        this.interrupts.delete(attacker.slot);
        this.mechanics.push({ frame: this.frame, label: 'Interrupted' });
        this.poise(target, this.foe.interrupt.stagger);
      }
      // Before it lands, an operator's damage action is heard as OnBeforeDamageAction (Tangtang's ultimate catches a
      // dive attack this way: its Attack-type hit with the dive mask, 1024).
      if (attacker.side === 'team' && target.side === 'enemy') {
        const units: Data[] = a.damageUnits ?? [];
        const pre: Ctx['damage'] = { type: units[0]?.damageType ?? 'Physical', mask: units.reduce((m: number, u: Data) => m | (u.damageDecorateMask ?? 0), 0), attacker, defender: target, skillKind: this.kindOfSkill(ctx.skillId) };
        this.abilityEvent(attacker, 'OnBeforeDamageAction', target, pre, undefined, { origin: ctx.skillId });
      }
      for (const u of a.damageUnits ?? []) {
        // Some hits count only from the controlled operator (a Final Strike's Stagger).
        if (u.onlyEnableForMainChar && !(attacker.side === 'team' && attacker.slot === this.controlled)) continue;
        if (u.damageAttributeType === 'Poise') {
          if (immune) continue;
          // Only the controlled operator's basic attacks build Stagger (wiki: "the controlled operator's Final Strike
          // and most skills"): a teammate's chain under the guard AI adds none, whatever its units say.
          if (attacker.side === 'team' && attacker.slot !== this.controlled && this.kindOfSkill(ctx.skillId) === 'basic') continue;
          // A Final Strike's Stagger counts once per strike, however many of its projectiles carry it (Gilberta's
          // fourth attack fires three, each with the full 16: the wiki's 16 per Final Strike).
          const strike = u.onlyEnableForMainChar ? (ctx.run?.origin ?? ctx.run) : undefined;
          if (strike) {
            if (strike.poised) continue;
            strike.poised = true;
          }
          // Summons hitting together Stagger once (Arcane's four Tactical Doubles' explosion: the wiki's 5, and the
          // owner's count). Assumed for every summon: the data gives each double its own.
          if (ctx.owner !== attacker && ctx.owner.slot < 0) {
            const key = `${ctx.skillId}@${this.frame}`;
            if (this.summonPoise === key) continue;
            this.summonPoise = key;
          }
          this.poise(target, this.val(u.poiseCalculation?.value ?? u.atkScale, ctx.bb), attacker);
          continue;
        }
        // A unit's own calculation: ATK × scale (× its share of a multi-hit skill), or a fixed amount.
        const calc = u.simpleCalculation === false ? u.atkCalculation : null;
        // "Fixed" damage is that amount as it is (Si's Artful Intent burst: the damage it recorded).
        if (u.damageType === 'Fixed' && short(calc?.$type) === 'DefiniteValueCalculation') {
          this.dealFixed(attacker, target, this.val(calc.value, ctx.bb), u.damageDecorateMask ?? 0, ctx);
          continue;
        }
        const scale =
          short(calc?.$type) === 'DefiniteValueCalculation'
            ? this.val(calc.value, ctx.bb) / Math.max(1, this.atk(attacker))
            : calc?.atkScale
              ? this.val(calc.atkScale, ctx.bb) * (calc.multiplier != null ? this.val(calc.multiplier, ctx.bb) : 1)
              : this.val(u.atkScale, ctx.bb);
        if (!scale) continue;
        this.deal(attacker, target, u.damageType, scale, u.damageDecorateMask ?? 0, u.damageTags?.length ? { ...ctx, damageTags: u.damageTags.map((x: Data) => x.tagId) } : ctx, 'skill', u.damageProcessors);
        for (const c of u.costDataList ?? []) if (c.costType === 'UltimateSp' && u.gainCost) this.obtain('UltimateSp', c.costValue, attacker);
      }
    }
  }

  /** Whether an enemy is Staggered now. */
  staggered(e: Entity): boolean {
    return (e.bb.get('staggeredUntil') ?? -1) > this.frame;
  }

  /**
   * Time the game's stopwatch stood still while this world ran on (a recording's cut-in the sim has none of): the
   * enemy's Staggered time doesn't pass then (the owner's Skydrummer video: 9 s of stopwatch with a 5 s cut-in inside).
   */
  holdStagger(frames: number): void {
    const e = this.enemy;
    if (frames <= 0 || !this.staggered(e)) return;
    e.bb.set('staggeredUntil', e.bb.get('staggeredUntil')! + frames);
    const last = this.staggers.at(-1);
    if (last) last.end = e.bb.get('staggeredUntil')!;
  }

  /** The enemy is in its guard stance (Enemy.guard). */
  guarding(): boolean {
    return this.frame < this.guardUntil;
  }

  /** After damage: the enemy's HP share just fell below one of its guard stance's thresholds (Enemy.guard). */
  private checkGuard(): void {
    const g = this.foe.guard;
    if (!g || !this.foe.phaseHp) return;
    // One phase assumed: all the damage so far is this phase's.
    const left = 1 - this.dealt / this.foe.phaseHp;
    let starts = false;
    for (const k of g.below)
      if (!this.guarded.includes(k) && left < k) {
        this.guarded.push(k);
        starts = true;
      }
    if (!starts) return;
    this.guardUntil = this.frame + Math.round(g.seconds * FPS);
    this.mechanics.push({ frame: this.frame, label: 'Guard stance' });
  }

  /** Stagger on an enemy: a full meter Staggers it for its time, with a Finisher ready; none adds up meanwhile (wiki: Stagger). */
  private poise(target: Entity, v: number, attacker?: Entity): void {
    if (target.side !== 'enemy' || !this.foe.poise || this.staggered(target)) return;
    // Its guard stance heals its meter faster than hits fill it.
    if (this.guarding()) return;
    if (this.noStagger.length) {
      const c = this.frame + this.frozenFrames;
      if (this.noStagger.some(([a, b]) => c >= a && c < b)) return;
    } else if (this.poiseGuard && this.frame >= this.poiseGuard[0] && this.frame < this.poiseGuard[1]) return;
    // Stagger Efficiency (PoiseEfficiency, 1 unless gear or buffs change it).
    if (attacker?.stats) v *= ((attacker.attr.PoiseEfficiency ?? 1) + this.modSum(attacker, 'PoiseEfficiency', false)) * (1 + this.multiplier(attacker, 'PoiseEfficiency'));
    const was = target.bb.get('stagger') ?? 0;
    let n = was + v;
    // Crossing a node makes it stumble (its node buff, when the data has it).
    for (const k of this.foe.nodes ?? [])
      if (was < k * this.foe.poise && n >= k * this.foe.poise && n < this.foe.poise) {
        if (this.foe.nodeBuff && this.buffOf.has(this.foe.nodeBuff)) this.addBuff(target, this.foe.nodeBuff, attacker ?? target, new Map());
        this.comboEvent({ kind: 'stagger', target });
        if (this.foe.nodeStagger) n += this.foe.nodeStagger;
        // Marked as the Recording view marks it (the meter passing its node).
        this.mechanics.push({ frame: this.frame, label: 'Stagger node' });
        if (this.foe.nodeMechanic) this.mechanics.push({ frame: this.frame + Math.round((this.foe.nodeMechanicAt ?? 0) * FPS), label: this.foe.nodeMechanic });
        const g = this.foe.nodeGuard;
        if (g) this.poiseGuard = [this.frame + Math.round(g.after * FPS), this.frame + Math.round((g.after + g.seconds) * FPS)];
      }
    if (n < this.foe.poise) {
      target.bb.set('stagger', n);
      return;
    }
    target.bb.set('stagger', 0);
    target.bb.set('staggeredUntil', this.frame + Math.round((this.foe.staggerSeconds ?? 0) * FPS));
    this.staggers.push({ frame: this.frame, end: target.bb.get('staggeredUntil')! });
    target.bb.set('finisherReady', 1);
    this.abilityEvent(target, 'OnPoiseZero', null);
    this.comboEvent({ kind: 'stagger', target });
  }

  /** Fixed damage: the amount itself, no multipliers. */
  private dealFixed(attacker: Entity, defender: Entity, amount: number, mask: number, ctx: Ctx): void {
    if (!attacker.stats || !(amount > 0)) return;
    if (defender.side === 'enemy' && this.untouchable()) amount = 0;
    const dmg: Ctx['damage'] = { type: 'Fixed', mask, attacker, defender, skillKind: this.kindOfSkill(ctx.skillId), amount };
    this.hits.push({ frame: this.frame, operator: attacker.id, skill: ctx.skillId, type: 'Fixed', amount, kind: 'skill' });
    this.dealt += amount;
    this.checkGuard();
    this.abilityEvent(attacker, 'OnBeforeOutputDamage', defender, dmg);
    this.abilityEvent(defender, 'OnTakeDamage', attacker, dmg);
  }

  /** Deals ATK × scale of a damage type, through every multiplier group the buffs add to. */
  deal(attacker: Entity, defender: Entity, type: string, scale: number, mask: number, ctx: Ctx, kind: Hit['kind'], processors: Data[] = []): number {
    const s = attacker.stats;
    if (!s) return 0;
    const dmg: Ctx['damage'] = { type, mask, attacker, defender, skillKind: kindOfMask(mask) ?? this.kindOfSkill(ctx.skillId), tags: ctx.damageTags };
    this.abilityEvent(defender, 'OnBeforeTakeDamage', attacker, dmg);
    // Zones by side: the attacker's NormalCalcZone is its DMG bonus, the defender's the Increased DMG Taken group (wiki: Damage).
    const zones = new Map<string, number>();
    const add = (zone: string, v: number) => zones.set(zone, (zones.get(zone) ?? 0) + v);
    let taken = 0;
    // The hit's own attribute changes (InstantModifyAttribute), by side, from the hit and from buffs' damage
    // modifiers: Last Rite's ultimate multiplies the target's Cryo Susceptibility; Combustion's burn can't crit
    // (the attacker's Critical Rate × 0); Laevatain's Melting Flame takes 20 off the target's Heat Resistance.
    const scaled = { Attacker: new Map<string, number>(), Defender: new Map<string, number>() };
    const added = { Attacker: new Map<string, number>(), Defender: new Map<string, number>() };
    const instant = (p: Data, bb: Map<string, number>, times: number) => {
      const side = p.modifyTargetSide as 'Attacker' | 'Defender';
      const name = p.modifier?.attributeType as string;
      if (side !== 'Attacker' && side !== 'Defender') return;
      if (/Multiplier/.test(p.modifier?.formulaItem ?? '')) scaled[side].set(name, (scaled[side].get(name) ?? 1) * this.val(p.modifier.param, bb) ** times);
      else if (p.modifier?.formulaItem === 'BaseAddition') added[side].set(name, (added[side].get(name) ?? 0) + this.val(p.modifier.param, bb) * times);
      else this.note(`InstantModifyAttribute ${side} ${name} ${p.modifier?.formulaItem}`);
    };
    for (const [who, side] of [
      [attacker, 'Attacker'],
      [defender, 'Defender'],
    ] as const)
      for (const b of who.buffs)
        for (const m of b.def.damageModifier ?? []) {
          if (m.enableSide !== side) continue;
          if (!this.check(m.condition?.actionData, { ...this.buffCtx(b), damage: dmg })) continue;
          for (const p of m.damageProcessors ?? []) {
            if (short(p.$type) === 'InstantModifyAttribute') {
              instant(p, b.bb, b.stacks);
              continue;
            }
            const zone = p.zoneName ?? 'NormalCalcZone';
            const v = this.val(p.addition, b.bb) * b.stacks;
            if (zone === 'NormalCalcZone' && (p.side ?? side) === 'Defender') taken += v;
            else add(zone, v);
          }
        }
    // DMG bonuses add up (wiki: the multiplier group): the damage type's, Arts', the skill kind's, bursts' or reactions'.
    const SKILL: Record<string, string> = { basic: 'NormalAttackDamageIncrease', normal: 'NormalSkillDamageIncrease', combo: 'ComboSkillDamageIncrease', ultimate: 'UltimateSkillDamageIncrease' };
    const increases = [`${type}DamageIncrease`, type !== 'Physical' ? 'SpellDamageIncrease' : '', kind === 'skill' ? (SKILL[dmg.skillKind] ?? '') : '', kind === 'burst' ? `${type}BurstDamageIncrease` : '', kind === 'reaction' ? `${type}AbnormalDamageIncrease` : '', this.staggered(defender) ? 'DamageToBrokenUnitIncrease' : ''];
    const bonus = 1 + increases.filter(Boolean).reduce((n, x) => n + this.attribute(attacker, x), 0) + (zones.get('NormalCalcZone') ?? 0);
    for (const p of processors) if (short(p.$type) === 'InstantModifyAttribute') instant(p, ctx.bb, 1);
    // Critical hits as their expected value: base 50% Critical DMG.
    const critRate = Math.min(1, Math.max(0, (this.stat(attacker, 'CriticalRate') + (added.Attacker.get('CriticalRate') ?? 0)) * (scaled.Attacker.get('CriticalRate') ?? 1)));
    const crit = 1 + critRate * (0.5 + this.attribute(attacker, 'CriticalDamageIncrease') + (added.Attacker.get('CriticalDamageIncrease') ?? 0));
    const guard = defender === this.enemy && this.guarding() ? this.foe.guard! : null;
    const def = (this.attribute(defender, 'Def') + (added.Defender.get('Def') ?? 0)) * (1 + (guard?.def ?? 0));
    const defMul = def >= 0 ? 100 / (def + 100) : 2 - 0.99 ** -def;
    const resName = `${type === 'Physical' ? 'Physical' : type}Resistance`;
    const res = this.attribute(defender, resName) + (added.Defender.get(resName) ?? 0);
    const resMul = (100 - res) / 100;
    let other = 1;
    for (const [zone, v] of zones) if (zone !== 'NormalCalcZone') other *= 1 + v;
    // Its guard stance: a ProdCalcZone addition on the defender's side.
    if (guard) other *= 1 + guard.damageTaken;
    // Staggered: 1.3 (wiki: Stagger); a Finisher also takes the enemy's own multiplier (Alleikhreos: 1.75).
    const finisherHit = defender === this.enemy && /_power_?attack/.test(ctx.skillId);
    const staggered = (this.staggered(defender) ? 1.3 : 1) * (finisherHit ? (this.foe.finisherMul ?? 1) : 1);
    // Susceptibility (VulnerableAction, <type>VulnerableDmgIncrease) and Amp (EnhancedAction): "Spell" means every Arts element.
    const arts = type !== 'Physical';
    // Kinds name elements their own way (Crystal = Cryst, Electric = Pulse...).
    const KIND: Record<string, string> = { Crystal: 'Cryst', Electric: 'Pulse', Heat: 'Fire', Nature: 'Natural' };
    const matches = (kind: string) => (KIND[kind] ?? kind) === type || (kind === 'Spell' && arts) || kind === 'All';
    // A child ends with its parent buff.
    const on = (x: Effect) => x.until > this.frame && (!x.parent || x.parent.owner.buffs.includes(x.parent));
    const live = (list: Entity['vulnerable'], only?: string) => (list ?? []).filter((x) => on(x) && (only ? (KIND[x.kind] ?? x.kind) === only : matches(x.kind))).reduce((n, x) => n + x.rate, 0);
    const own = `${type}VulnerableDmgIncrease`;
    // Susceptibility of the damage's own element (it's that attribute in the game), then "Spell" (all Arts).
    const elemental = (live(defender.vulnerable, type) + this.attribute(defender, own)) * (scaled.Defender.get(own) ?? 1);
    const spell = arts ? (defender.vulnerable ?? []).filter((x) => on(x) && x.kind === 'Spell').reduce((n, x) => n + x.rate, 0) + this.attribute(defender, 'SpellVulnerableDmgIncrease') : 0;
    const allKinds = (defender.vulnerable ?? []).filter((x) => on(x) && x.kind === 'All').reduce((n, x) => n + x.rate, 0);
    const susceptibility = 1 + elemental + spell + allKinds;
    const ampMul = 1 + live(attacker.amp);
    const atk = this.atk(attacker);
    // Breach: Physical DMG taken (the Increased DMG Taken group).
    if (type === 'Physical' && (defender.bb.get('breachUntil') ?? 0) > this.frame) taken += defender.bb.get('breach') ?? 0;
    const takenMul = 1 + taken;
    // A Link the cast consumed: its skill's damage (its entities' too) until the operator's next such cast.
    const lk = this.linked.get(attacker);
    const link = lk && lk.kind === dmg.skillKind ? lk.mul : 1;
    const amount = defender.side === 'enemy' && this.untouchable() ? 0 : atk * scale * bonus * crit * other * staggered * susceptibility * ampMul * takenMul * defMul * resMul * link;
    dmg.amount = amount;
    this.hits.push({ frame: this.frame, operator: attacker.id, skill: ctx.skillId, type, amount, kind, skillKind: dmg.skillKind, parts: { atk, scale, bonus, crit, other, staggered, susceptibility, amp: ampMul, taken: takenMul, def: defMul, res: resMul, link } });
    this.dealt += amount;
    this.checkGuard();
    this.abilityEvent(attacker, 'OnBeforeOutputDamage', defender, dmg);
    this.abilityEvent(defender, 'OnTakeDamage', attacker, dmg);
    this.abilityEvent(attacker, 'OnOutputDamage', defender, dmg);
    if (attacker.side === 'team' && defender.side === 'enemy') {
      const finisher = /_power_?attack/.test(ctx.skillId);
      if (attacker.slot === this.controlled && ((mask & FINAL_STRIKE) !== 0 || finisher)) {
        // One strike per attack, however many of its projectiles hit (a Finisher's several). A Finisher counts at its
        // own main hit when its skill has one, where its SP comes too (GainBreakingAttackAtb beside it): Yvonne's
        // projectile lands ~0.67 s earlier, and the recording places her Finisher at the SP gain.
        const strike = ctx.run?.origin ?? ctx.run;
        const early = finisher && !!ctx.run?.origin && ownHit(ctx.run.origin.skill);
        if (early) {
          // Its main hit comes: the strike is recorded then.
        } else if (!strike || strike !== this.strikeRun) this.strikes.push({ frame: this.frame, slot: attacker.slot, finisher, ...(finisher || strike?.unseen || this.main[attacker.slot]?.unseen ? { unseen: true } : {}) });
        if (!early) {
          this.strikeRun = strike ?? null;
          this.comboEvent({ kind: 'finalStrike', finisher, target: defender });
        }
      }
      if (dmg.skillKind === 'combo') this.comboEvent({ kind: 'comboDamage', by: attacker });
      if (kind === 'burst') this.comboEvent({ kind: 'burst', of: type, target: defender });
    }
    // Damage is the expected value; what listens for critical hits hears one each time the attacker's Critical
    // Rates add up past a whole number (evenly, like Probablity), per kind of skill: a weapon that answers battle and
    // combo skills' critical hits (Artzy Tyrannical) hears its share of them, not only what basic attacks leave over.
    const critKey = `${attacker.id}|${dmg.skillKind}`;
    const sum = this.critSum.get(critKey) ?? 0;
    this.critSum.set(critKey, sum + critRate);
    if (Math.floor(sum + critRate) > Math.floor(sum)) {
      this.abilityEvent(attacker, 'OnOutputCriticalDamage', defender, dmg);
      this.abilityEvent(defender, 'OnTakeCriticalDamage', attacker, dmg);
    }
    return amount;
  }

  // -------------------------------------------------------------------------
  // Inflictions, SP, Ultimate Energy
  // -------------------------------------------------------------------------

  /**
   * An Arts Infliction lasts INFLICTION_SECONDS from its last application: another of the same element resets it for
   * every stack (endfield.wiki.gg Arts Infliction; the game's infliction buffs, buff_common_<x>_triggered, carry the
   * same 20 as their duration). Its end, in sim frames (a cut-in stops it, as it stops time).
   */
  private inflictUntil(e: Entity, element: string): void {
    e.bb.set(`inflict_until_${element}`, this.frame + Math.round(INFLICTION_SECONDS * FPS));
  }

  /** Arts Infliction on an enemy: the same element adds a stack (max 4) and bursts; a different one reacts (wiki: Arts Infliction). */
  inflict(e: Entity, element: string, ctx: Ctx): void {
    const cur = ELEMENTS.find((x) => (e.bb.get(`inflict_${x}`) ?? 0) > 0);
    const attacker = ctx.source.owner ?? ctx.source;
    const about = { origin: ctx.skillId, infliction: element };
    this.abilityEvent(attacker, 'OnCharBeforeOutputSpellInfliction', e, undefined, undefined, about);
    this.abilityEvent(e, 'OnEnemyBeforeTakeSpellInfliction', attacker, undefined, undefined, about);
    if (cur === element) this.abilityEvent(attacker, 'OnCharBeforeOutputSpellBurst', e, undefined, undefined, about);
    // As the game does: the same element bursts (buff_common_<x>_<x>_triggered), another reacts
    // (buff_common_try_<applied>_cryst_triggered; Cryo onto another: buff_common_cryst_cryst_frozen_triggered), at the stacks' level.
    const name = (x: string) => x.toLowerCase();
    const n = cur ? (e.bb.get(`inflict_${cur}`) ?? 0) : 0;
    const buffId = !cur ? null : cur === element ? `buff_common_${name(element)}_${name(element)}_triggered` : element === 'Cryst' ? 'buff_common_cryst_cryst_frozen_triggered' : `buff_common_try_${name(element)}_cryst_triggered`;
    if (buffId && this.buffOf.has(buffId)) {
      if (cur === element) {
        e.bb.set(`inflict_${element}`, Math.min(4, n + 1));
        this.inflictUntil(e, element);
      }
      else {
        this.consume(e, cur!, attacker, { ...ctx, bb: new Map() });
        e.bb.set('reaction', (ELEMENTS as readonly string[]).indexOf(element));
        e.bb.set('reactionLevel', n);
      }
      this.addBuff(e, buffId, attacker, new Map([['count', n], ['consumed_layer', n], ['consumed_type', (ELEMENTS as readonly string[]).indexOf(cur!) + 1]]));
      this.abilityEvent(e, 'OnEnemyAfterTakeSpellInfliction', ctx.owner, undefined);
      if (cur === element) this.outputInfliction(e, element, attacker);
      this.comboEvent({ kind: 'inflict', element, stacks: e.bb.get(`inflict_${element}`) ?? 0, target: e });
      return;
    }
    if (!cur || cur === element) {
      const n = e.bb.get(`inflict_${element}`) ?? 0;
      if (n > 0) this.deal(attacker, e, element, 1.6 * this.hidden(attacker, 196), 0, ctx, 'burst');
      e.bb.set(`inflict_${element}`, Math.min(4, n + 1));
      this.inflictUntil(e, element);
    } else {
      // The stacked element sets the reaction's level; the applied one its kind.
      const level = e.bb.get(`inflict_${cur}`) ?? 1;
      this.consume(e, cur, attacker, { ...ctx, bb: new Map() });
      this.deal(attacker, e, element, (0.8 + 0.8 * level) * this.hidden(attacker, 196), 0, ctx, 'reaction');
      e.bb.set('reaction', (ELEMENTS as readonly string[]).indexOf(element));
      e.bb.set('reactionLevel', level);
    }
    this.abilityEvent(e, 'OnEnemyAfterTakeSpellInfliction', ctx.owner, undefined);
    if (!cur || cur === element) this.outputInfliction(e, element, attacker);
    this.comboEvent({ kind: 'inflict', element, stacks: e.bb.get(`inflict_${element}`) ?? 0, target: e });
  }

  /**
   * A Physical Status on an enemy (wiki). Not Vulnerable (and not forced): 1 stack of Vulnerability instead. Lift and
   * Knock Down: 120% ATK Physical DMG, 10 Stagger and 1 more Vulnerability (max 4). Crush and Breach consume every
   * stack for their level: Crush 300-750% ATK; Breach 100-250% ATK and Physical DMG taken +12-24% for 12-30 s.
   * Vulnerability lasts until consumed here, as Arts Infliction does (assumption: its duration is game code).
   */
  physical(status: PhysicalStatus, e: Entity, ctx: Ctx, forced = false, mul = 1): void {
    if (e.side !== 'enemy') return;
    const attacker = ctx.source.owner ?? ctx.source;
    const about = { origin: ctx.skillId, physical: PHYSICAL_MASK[status] };
    this.abilityEvent(attacker, 'OnBeforeOutputPhysicalInfliction', e, undefined, undefined, about);
    const vb = e.buffs.find((b) => b.id === VULNERABLE);
    const v = vb?.stacks ?? 0;
    // Vulnerability's own start would shatter Solidification (buff_physical_handle_cryst_break) unless the game's code
    // says to skip it; it does unless the enemy is Solidified. The shatter happens here, once per status applied.
    const vulnerable = () => this.addBuff(e, VULNERABLE, attacker, new Map([['duration', -1], ['skip_handle_cryst_break', 1]]));
    if (hasStatus(e, 'Solidification') && this.buffOf.has('buff_physical_handle_cryst_break')) this.addBuff(e, 'buff_physical_handle_cryst_break', attacker, new Map());
    const row = (key: string, level: number) => this.settings[key]?.values[Math.max(0, Math.min(3, level - 1))] ?? 0;
    const ai = attacker.stats ? this.stat(attacker, 'PhysicalAndSpellInflictionEnhance') : 0;
    if (!v && !forced) {
      vulnerable();
      this.comboEvent({ kind: 'physical', status: 'Vulnerable', stacks: 1, target: e });
    } else if (status === 'Lift' || status === 'KnockDown') {
      vulnerable();
      this.deal(attacker, e, 'Physical', row(status === 'Lift' ? '击飞伤害' : '倒地伤害', 1) * this.hidden(attacker, 392) * mul, 0, ctx, 'status');
      this.poise(e, row(status === 'Lift' ? '击飞失衡' : '倒地失衡', 1) * (1 + ai / 200), attacker);
      this.comboEvent({ kind: 'physical', status, stacks: e.buffs.find((b) => b.id === VULNERABLE)?.stacks ?? 0, target: e });
    } else {
      const level = Math.max(1, v);
      if (vb) this.endBuff(vb, vb.stacks, true);
      if (status === 'Crush') this.deal(attacker, e, 'Physical', row('猛击伤害', level) * this.hidden(attacker, 392) * mul, 0, ctx, 'status');
      else {
        this.deal(attacker, e, 'Physical', row('碎甲伤害', level) * this.hidden(attacker, 392) * mul, 0, ctx, 'status');
        e.bb.set('breach', row('碎甲物理伤害提高', level) * (1 + (2 * ai) / (ai + 300)));
        e.bb.set('breachUntil', this.frame + Math.round(row('碎甲持续时间', level) * FPS));
      }
      this.comboEvent({ kind: 'physical', status, stacks: level, target: e });
    }
    this.abilityEvent(attacker, 'OnAfterOutputPhysicalInfliction', e, undefined, undefined, about);
  }

  /** A forced Arts Reaction: the reaction's own buffs, as a reaction of `element` at `level` would add them, minus the initial hit. */
  private forceReaction(e: Entity, element: string, level: number, ctx: Ctx): void {
    if (e.side !== 'enemy' || !ELEMENTS.includes(element as (typeof ELEMENTS)[number])) return;
    const attacker = ctx.source.owner ?? ctx.source;
    const name = element.toLowerCase();
    const buffId = element === 'Cryst' ? 'buff_common_cryst_cryst_frozen_triggered' : `buff_common_try_${name}_cryst_triggered`;
    if (!this.buffOf.has(buffId)) return this.note(`missing buff ${buffId}`);
    e.bb.set('reaction', (ELEMENTS as readonly string[]).indexOf(element));
    e.bb.set('reactionLevel', level);
    this.forcing = true;
    const was = this.creating;
    this.creating = this.castKindOf(ctx);
    const b = this.addBuff(e, buffId, attacker, new Map([['count', level], ['consumed_layer', level], ['consumed_type', 0]]));
    if (b) b.castKind ??= this.creating;
    this.creating = was;
    this.forcing = false;
  }

  /** A timed marker's id: as written, or a blackboard value. */
  private markerId(v: Data, ctx: Ctx): string {
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    if (v?.useBlackboardKey) return `#${ctx.bb.get(v.blackboardKey) ?? v.value ?? ''}`;
    return String(v?.value ?? '');
  }

  /** A summon is gone: its timelines stop (Fluorite's explosive explodes once), and it and its owner hear it. */
  private finishEntity(e: Entity): void {
    if (e.slot >= 0 || e.side !== 'team' || !e.alive) return;
    e.alive = false;
    for (const r of this.runs) if (r.owner === e) this.endRun(r);
    this.abilityEvent(e, 'OnAbilityEntitySelfFinished', e);
    if (e.owner) this.abilityEvent(e.owner, 'OnAbilityEntityFinished', e);
  }

  /** OnOutputBuff for an infliction an operator stacked (as the game's infliction buff). */
  private outputInfliction(e: Entity, element: string, by: Entity): void {
    if (by.side === 'team') this.abilityEvent(by, 'OnOutputBuff', e, undefined, undefined, { buff: this.standIn(`infliction_${element}`, [INFLICTION_TAG[element], ANY_INFLICTION], e, by, e.bb.get(`inflict_${element}`) ?? 0) });
  }

  /** Physical statuses, bursts and reactions scale with the operator's level and Arts Intensity (wiki). */
  private hidden(op: Entity, per: number): number {
    const s = op.stats!;
    return (1 + (s.level - 1) / per) * (1 + this.stat(op, 'PhysicalAndSpellInflictionEnhance') / 100);
  }

  obtain(type: string, amount: number, who: Entity, tag?: number, raw = false): void {
    if (!amount) return;
    if (type === 'Atb') {
      if (amount > 0) amount *= this.foe.sp?.gain ?? 1;
      this.lastAtbAmount = amount;
      this.sp = Math.min(this.spMax, this.sp + amount);
      this.abilityEvent(who.owner ?? who, 'OnObtainAtb', null);
    }
    else if (type === 'UltimateSp') {
      const op = who.owner ?? who;
      if (amount > 0 && this.refrained(op, tag)) return;
      // Up to the ultimate's cost: the rest is lost.
      const max = this.ultCost(op);
      // A negative amount takes energy away (-999: all of it, Arcane's ultimate ending); gain bonuses scale only gains,
      // and not those that ignore them (Arcane's array).
      op.energy = Math.max(0, Math.min(max, op.energy + (amount > 0 && !raw ? amount * (1 + this.attribute(op, 'UltimateSpGainScalar')) : amount)));
    }
  }

  // -------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------

  /** Time stopped by an ultimate: only its caster's runs started since go on. */
  freeze: { owner: Entity; from: number; left: number } | null = null;
  /**
   * Frames left of a combo banner's slow motion, in the time it loses: SP doesn't regenerate and the Staggered time
   * stands still (the recordings), while the team acts on (Arcane's Final Strike after Last Rite's combo at 0:23.5 in
   * the Last Rite run kept its time).
   */
  slowLeft = 0;
  /** No SP regeneration this frame: a replay's stopwatch stood still (replaySim), so the game's timer did too. */
  holdSp = false;
  /** Cut-ins waiting for the one playing (ultimates pressed in it). */
  freezeQueue: { owner: Entity; from: number; left: number }[] = [];
  /**
   * Imprisonment (SealAction, Arcane's combo): the enemy's own time scale over each one's span, a curve (its
   * directCurve: 0.3, 0.2 at 5%, rising to 1 at the end). The enemy then loses time: its debuffs, inflictions, Breach
   * and Staggered time wait (buffs run on their owner's time, ignoreOwnerTimeScale false). Found against the
   * Skydrummer recording: Corrosion III lasted 28.15 s, not its 25, and each Stagger ~11.2 s, not 9, with one inside.
   */
  seals: { from: number; frames: number; keys: [number, number][] }[] = [];
  private sealDebt = 0;
  /** Frames passed with time stopped (they don't count as fight time). */
  frozenFrames = 0;

  /** Advances one frame: runs continue, buffs tick and expire, SP regenerates (8 a second). */
  /** The Ultimate Energy an operator's ultimate (as the button has it now) costs. */
  ultCost(op: Entity): number {
    const ult = this.skillIdOf(op, 'ultimate');
    return this.param(ult, 1, this.patchAt(ult, op.slot)?.cost ?? 100);
  }

  /** Whether an operator can't gain Ultimate Energy now (RefrainObtainUsp), a gain with this tag excepted. */
  private refrained(op: Entity, tag?: number): boolean {
    if (tag === REFRAIN_ANY) return false;
    return this.refrains.some((r) => r.op === op && this.refrainOn(r) && !(tag != null && r.tags.includes(tag)));
  }

  private refrainOn(r: (typeof this.refrains)[number]): boolean {
    return r.buff ? r.buff.owner.buffs.includes(r.buff) : r.run ? !r.run.ended : true;
  }

  tick(): void {
    // Arts Inflictions run out.
    for (const x of ELEMENTS) {
      const until = this.enemy.bb.get(`inflict_until_${x}`);
      if (until !== undefined && this.frame >= until && (this.enemy.bb.get(`inflict_${x}`) ?? 0) > 0) this.enemy.bb.set(`inflict_${x}`, 0);
    }
    if (this.refrains.length) {
      // clearUspOnEnd empties the bar once no block is left on that operator (Arcane's ultimate hands one listener on
      // to the next with the bar full: that keeps it).
      const ended = this.refrains.filter((r) => !this.refrainOn(r));
      this.refrains = this.refrains.filter((r) => this.refrainOn(r));
      for (const r of ended) if (r.clear && !this.refrains.some((x) => x.op === r.op)) r.op.energy = 0;
    }
    // A cut-in stops the fight's clock: no SP regenerates, no buff, cooldown or Stagger time passes (the game's SP bar
    // stands still through one: 58 → 61 over 3.4 s, 57 → 60 over 5.0 s; the stage timer runs on, the clock doesn't).
    if (this.freeze && this.freeze.left > 0) {
      const { owner, from } = this.freeze;
      this.freeze.left--;
      this.frozenFrames++;
      // The caster's own casts go on, and so do other operators' summons (the owner's Last Rite recording: Si's Ink
      // Lung, frozen through her own cut-in, counts on through Arcane's, and its combo-cooldown cut lands inside it).
      for (const r of [...this.runs])
        if (!r.ended && ((r.owner === owner && this.startedSince(r, from)) || this.summonOfOther(r.owner, owner))) {
          r.start--;
          this.stepRun(r);
        }
      this.runs = this.runs.filter((r) => !r.ended);
      if (this.freeze.left <= 0) this.freeze = this.freezeQueue.shift() ?? null;
      return;
    }
    this.frame++;
    for (const op of this.team) {
      const open = this.formOpen[op.slot];
      if (open === undefined && !this.modes.get(op)?.length) continue;
      const on = this.attacksUnseen(op.slot);
      if (on && open === undefined) this.formOpen[op.slot] = this.forms.push({ slot: op.slot, frame: this.frame, end: this.frame }) - 1;
      else if (on) this.forms[open!].end = this.frame;
      else this.formOpen[op.slot] = undefined;
    }
    // An Imprisoned enemy's own clock runs slow: each whole frame it loses, its timers wait a frame.
    if (this.seals.length) {
      this.sealDebt += 1 - this.foeScale();
      while (this.sealDebt >= 1) {
        this.sealDebt -= 1;
        this.foeLoseFrame();
      }
    }
    this.guards();
    // Jumps whose condition is watched (JumpToAction over a span).
    if (this.jumpWatch.length) {
      this.jumpWatch = this.jumpWatch.filter((j) => !j.run.ended && this.frame <= j.until);
      for (const j of [...this.jumpWatch])
        if (this.check(j.a.conditionAction?.actionData, j.ctx)) {
          this.jumpWatch = this.jumpWatch.filter((x) => x !== j);
          this.jumpTo(j.run, Number(j.a.destFrame));
        }
    }
    const slowed = this.slowLeft > 0;
    if (slowed) {
      this.slowLeft--;
      this.holdStagger(1);
    }
    if (!this.holdSp && !slowed) this.sp = Math.min(this.spMax, this.sp + (this.foe.sp?.regen ?? 8) / FPS);
    // Summons whose time is up.
    for (const e of this.entities) if (e.alive && e.until !== undefined && e.until <= this.frame) this.finishEntity(e);
    // Channels: their next hits, while their skill runs.
    if (this.channels.length) {
      // Its skill still runs, or its buff is still on.
      const on = (ch: (typeof this.channels)[number]) => (ch.run ? !ch.run.ended : !!ch.buff && ch.buff.owner.buffs.includes(ch.buff));
      for (const ch of this.channels)
        while (on(ch) && ch.left > 0 && ch.at <= this.frame && ch.at < ch.until) {
          for (const e of ch.spec ? this.targets(ch.spec, ch.ctx) : [ch.ctx.target ?? this.enemy]) this.exec(ch.list, { ...ch.ctx, target: e });
          ch.at += ch.every;
          ch.left--;
        }
      this.channels = this.channels.filter((ch) => on(ch) && ch.left > 0 && ch.at < ch.until);
    }
    for (const r of [...this.runs])
      if (!r.ended) {
        // Haste: an operator's own skills and attacks play (1 + Haste) frames a frame.
        if (r.owner.slot >= 0) r.start -= this.hasteOf(r.owner);
        this.stepRun(r);
      }
    this.runs = this.runs.filter((r) => !r.ended);
    for (const e of [...this.team, this.enemy, ...this.entities])
      for (const b of [...e.buffs]) {
        // A paused buff's clock (its end, timeline and ticks) stands still.
        if (b.paused) {
          b.start++;
          if (b.end !== Infinity) b.end++;
          if (b.stackEnds) b.stackEnds = b.stackEnds.map((x) => x + 1);
          if (b.nextTrigger !== Infinity) b.nextTrigger++;
          continue;
        }
        if (b.byRun?.ended) {
          this.endBuff(b, b.stacks);
          continue;
        }
        if (b.nextTrigger <= this.frame) {
          b.triggers++;
          this.buffEvent(b, 'OnBuffTrigger');
          const interval = this.val(b.def.triggerInterval, b.bb);
          const max = this.val(b.def.maxTriggerCnt, b.bb);
          b.nextTrigger = interval > 0 && (max <= 0 || b.triggers < max) ? this.frame + Math.round(interval * FPS) : Infinity;
        }
        this.stepBuff(b);
        // Stacks that have run out go one by one.
        while (b.stackEnds && b.stackEnds.length > 1 && b.stackEnds[0] <= this.frame) {
          b.stackEnds.shift();
          b.stacks--;
          this.buffEvent(b, 'OnBuffEnhanceChanged');
        }
        if (b.end <= this.frame) this.endBuff(b, b.stacks);
      }
  }

  /**
   * Starts the fight: each operator's talents (every talent at its highest
   * level) and Potentials up to `potential[i]` from PotentialTalentEffectTable,
   * then their passive skills.
   */
  start(potential: number[] = []): void {
    const attached = new Set<string>();
    this.team.forEach((op, i) => {
      const b = this.bundleOf(op);
      if (!b?.talents) return;
      const best = new Map<string, { id: string; level: number }>();
      for (const id of Object.keys(b.talents)) {
        const t = /_talent_(\d+)_(\d+)$/.exec(id);
        if (t && (best.get(t[1])?.level ?? 0) < Number(t[2])) best.set(t[1], { id, level: Number(t[2]) });
      }
      const potentials = Object.keys(b.talents).filter((id) => {
        const m = /_potential_(\d+)$/.exec(id);
        return !!m && Number(m[1]) <= (potential[i] ?? 0);
      });
      for (const id of [...[...best.values()].map((x) => x.id), ...potentials])
        for (const entry of b.talents[id]) {
          const d: Data = entry;
          if (!(d.activeCondition ?? []).every((c: string) => this.talentCondition(op, b, c))) continue;
          if (d.attachSkill?.skillId) attached.add(d.attachSkill.skillId);
          switch (enumOf('talent', d.modifyType)) {
            case 1:
              if (d.attachSkill?.skillId) this.cast(d.attachSkill.skillId, op, op, this.enemy, new Map((d.attachSkill.blackboard ?? []).map((x: Data) => [x.key, Number(x.value)])));
              break;
            case 2: {
              const m = d.skillParamModifier;
              this.skillParams.set(m.skillId, [...(this.skillParams.get(m.skillId) ?? []), { type: enumOf('param', m.paramType), how: enumOf('modify', m.modifyType), value: Number(m.paramValue) }]);
              break;
            }
            case 3: {
              const m = d.skillBbModifier;
              this.skillMods.set(m.skillId, [...(this.skillMods.get(m.skillId) ?? []), { key: m.bbKey, value: Number(m.floatValue), how: enumOf('modify', m.modifyType) }]);
              break;
            }
            case 4: {
              const name = attrName(b, d.attrModifier.attrType);
              if (name) op.attr[name] = (op.attr[name] ?? 0) + Number(d.attrModifier.attrValue);
              break;
            }
            case 5: {
              const bb = new Map<string, number>((d.attachBuff.blackboard ?? []).map((x: Data) => [x.key, Number(x.value)]));
              if (d.attachBuff.buffId) this.addBuff(op, d.attachBuff.buffId, op, bb);
              break;
            }
          }
        }
    });
    // Each operator's own passives (not those a talent attaches), then its weapon's and gear sets'.
    for (const op of this.team) {
      const b = this.bundleOf(op);
      for (const [id, s] of Object.entries(b?.skills ?? {}))
        if ((s as Data).castType === 'Passive' && id.startsWith(`${op.id}_`) && !/_talent/.test(id) && !attached.has(id)) this.cast(id, op, op, this.enemy);
      for (const id of b?.passives ?? []) this.cast(id, op, op, this.enemy);
    }
    for (const op of this.team) {
      this.abilityEvent(op, 'OnEnterFight', this.enemy);
      this.abilityEvent(op, 'OnCharDeckAttrChanged', op);
    }
    // A stage that fills every ultimate at the start (Re-Crisis).
    if (this.foe.fullUltimate) for (const op of this.team) op.energy = this.ultCost(op);
  }

  /** A SkillConditionTable condition: an attribute against another (condType 14010). */
  private talentCondition(op: Entity, b: Bundle, id: string): boolean {
    const c = b.conditions?.[id];
    if (!c) return true;
    const l = this.stat(op, attrName(b, c.leftAttrType) ?? '');
    const r = this.stat(op, attrName(b, c.rightAttrType) ?? '');
    // The dump names them: 3 GreaterEqual, 4 LessThan (Arcane: INT ≥ WILL takes the INT path, ties included).
    const how = typeof c.compareOp === 'number' ? ({ 3: 'GreaterEqual', 4: 'LessThan' } as Record<number, string>)[c.compareOp] : c.compareOp;
    return how === 'GreaterEqual' ? l >= r : how === 'LessThan' ? l < r : how === 'Greater' ? l > r : how === 'LessEqual' ? l <= r : l === r;
  }

  // -------------------------------------------------------------------------
  // The player's inputs
  // -------------------------------------------------------------------------

  /** The controlled operator's basic attack chain: the step done, and the window for the next. */
  /**
   * How long (frames) a basic attack chain stays where it was after its next attack's window closes: a dodge
   * interrupts it without breaking it, as a skill does (the owner, and the game's tutorial). There is a limit, but
   * neither the data nor the owner knows it: replays assume 2 s; fights use 0, as they attack as soon as they can.
   */
  chainGrace = 0;
  /** Each operator's basic attack chain; `held` while a skill kept it (dontInterruptCombo): the next attack goes on from it. */
  private chains: ({ id: string; of: string; nextFrom: number; nextTo: number; held?: boolean; run?: Run } | null)[] = [null, null, null, null];
  /**
   * Operators not controlled attacking on their own (the game's guard AI), as an estimate of its averages: a teammate
   * attacks only while it holds an Attacker role (GroupAIConfig Default_GroupAITargetNotMain, Character: 3 tokens,
   * each role 5 s, dealt by mode), so each attacks GUARD_SHARE of the time, in a window of each GUARD_PERIOD (the
   * teammates' windows staggered); before each chain a delay of AIGlobalSetting characterAttackRandomDelay (0–1 s,
   * mean 0.5) and randomStopAttackTime (0–0.5 s, mean 0.25). Their hits deal damage and their own effects; Final
   * Strikes' SP and combo triggers are the controlled operator's only (the data's main-character checks).
   */
  guardAttacks = true;
  guardDelay = 0.75;
  guardShare = GUARD_SHARE;
  private guardNext: number[] = [0, 0, 0, 0];
  /** Each operator's skill or attack running now (a new press cuts it short). */
  private main: (Run | null)[] = [null, null, null, null];
  /** Frame each skill is off cooldown. */
  readyAt = new Map<string, number>();

  /**
   * Frames including ultimate cut-ins, when the world stands still but cooldowns go on: the game's own timer keeps
   * running through them, and the owner's Alleikhreos video has Tangtang's 12 s combo cast again 14 s later across
   * two cut-ins (4.3 s of them).
   */
  get clockNow(): number {
    return this.frame + this.frozenFrames;
  }
  /** What was pressed, when (for showing a rotation). */
  log: { frame: number; op: number; input: Input }[] = [];
  /** Channels still to hit (ChannelingAction over its timeline entry). */
  /** Ultimate Energy blocks (RefrainObtainUsp): whose, while which buff or skill lasts, the tags let through. */
  private refrains: { op: Entity; buff?: Buff; run?: Run; tags: number[]; clear: boolean }[] = [];
  private channels: { run?: Run; buff?: Buff; list: Data[] | undefined; ctx: Ctx; at: number; every: number; until: number; left: number; spec: Data }[] = [];
  /** Each chain's attacks in order (chainSteps). */
  private chainList = new Map<string, string[]>();
  /** Each operator's own skill of a kind (ownSkill). */
  private ownSkills = new Map<string, string>();
  /** The SP the last gain brought (SaveAtbObtainValue). */
  private lastAtbAmount = 0;
  /** While a forced reaction starts: its reaction buff's initial hit doesn't happen. */
  private forcing = false;
  /** The team's Link buffs (ComboAction): the frame each ends. */
  private links: number[] = [];
  /** The Link an operator's last battle skill or ultimate consumed: its damage's multiplier. */
  private linked = new Map<Entity, { kind: string; mul: number }>();
  /** All the damage dealt so far (a dummy with HP is defeated when it reaches it). */
  dealt = 0;
  /** Critical Rate added up per attacker and kind of skill, for critical-hit events. */
  private critSum = new Map<string, number>();
  /** Chances added up per effect (Conditions.Probablity), so they come out evenly. */
  private chance = new Map<string, number>();
  /** How the last SP from an action came (Conditions.CheckObtainAtbType). */
  private lastAtb = { type: 'Skill', method: 'Gain' };
  /**
   * Seconds between swaps. Not in the readable data: an assumption (without one, swapping back and forth lets
   * two operators attack as the controlled one).
   */
  swapCooldown = 1;
  private lastSwap = -Infinity;

  /** A skill's value from the skill table at its level for the operator in `slot` (its build's), else the world's rank. */
  private patchAt(skillId: string, slot = -1): Bundle['patch'][string][number] | undefined {
    const levels = this.patchOf.get(skillId);
    const rank = this.skillLevel.get(`${slot}|${skillId}`) ?? this.rank;
    return levels?.find((l) => l.level === rank) ?? levels?.at(-1);
  }

  /** A skill's cost or cooldown after talents and Potentials (paramType 1: cost; 2: cooldown). */
  private param(skillId: string, type: number, base: number): number {
    let v = base;
    for (const m of this.skillParams.get(skillId) ?? []) if (m.type === type) v = m.how === 2 ? v * m.value : v + m.value;
    return v;
  }

  /**
   * A buff that maps the next basic attack to a skill while it lasts (ComboCacheAction in the buff, as Yvonne's
   * ultimate's end buff does: ult_attack_end, her Final Strike), until that attack is made.
   */
  private attackMapping(op: Entity): { buff: Buff; id: string } | null {
    for (const b of op.buffs) {
      if (b.mapUsed) continue;
      for (const ev of b.def.buffEventAction ?? [])
        if (ev.buffEvent === 'DuringBuffEnable' || ev.buffEvent === 'OnBuffStart')
          for (const a of ev.actions ?? [])
            for (const d of a.actionData ?? [])
              if (short(d.$type) === 'ComboCacheAction')
                for (const m of d.mappingDataList ?? []) if (m.cmdType === 'Attack' && m.skillId && this.skillOf.has(m.skillId)) return { buff: b, id: m.skillId };
    }
    return null;
  }

  /**
   * A dive attack: the controlled operator's plunging attack as it lands (the jump before it isn't played). Its hit
   * carries the dive mask (1024), which Tangtang's ultimate listens for: a dive while OLDEN STARE still evolves calls
   * the stronger rogue wave at once; a dive after it has ended is only a dive.
   */
  private dive(slot: number): void {
    const op = this.team[slot];
    const id = this.skillIdOf(op, 'dive');
    const prev = this.main[slot];
    if (prev) this.endRun(prev, true);
    for (const r of this.runs) if (r.follow && !r.ended && r.owner === op) this.endRun(r, true);
    this.abilityEvent(op, 'OnBeforeCastSkill', this.enemy, undefined, undefined, { origin: id, casting: true });
    this.main[slot] = this.cast(id, op, op, this.enemy);
    if (this.main[slot]) this.main[slot]!.main = true;
    this.chains[slot] = null;
  }

  /**
   * Frames a press would hold its operator before a basic attack may follow, as `busy` holds it: to its skill's
   * MarkCanInterrupt where it has one (Last Rite's battle skill: 51, not its exclusiveFrame 373), else its exclusiveFrame.
   */
  holdOf(slot: number, input: Input): number {
    const skill = this.skillOf.get(this.skillIdOf(this.team[slot], input));
    const mark = (skill?.actionGroupData?.timelineActions ?? []).find((ta: Data) => (ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'MarkCanInterrupt'));
    return mark ? (mark._startFrame ?? 0) : (skill?.exclusiveFrame ?? 0);
  }

  /** Frames an operator's ultimate stops time for everyone else (its cut-in: UltimateTimeAction, time scale 0). */
  cutInOf(slot: number): number {
    for (const ta of this.skillOf.get(this.skillIdOf(this.team[slot], 'ultimate'))?.actionGroupData?.timelineActions ?? [])
      if ((ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'UltimateTimeAction' && Number(d.timeScale ?? 1) === 0)) return (ta._endFrame ?? 0) - (ta._startFrame ?? 0);
    return 0;
  }

  private skillIdOf(op: Entity, input: Input): string {
    if (input === 'dive') return `${op.id}_plunging_attack_end`;
    if (input === 'attack') {
      const mapped = this.attackMapping(op);
      if (mapped) return mapped.id;
      const chain = this.chainOf(op);
      const steps = this.chainSteps(op);
      const c = this.chains[op.slot];
      const i = c && c.of === chain && (c.held || this.frame <= c.nextTo + this.chainGrace) ? steps.indexOf(c.id) : -1;
      return i >= 0 ? this.nextAttack(steps, i) : (steps[0] ?? chain.replace('#', '1'));
    }
    const slot = input === 'battle' ? 'NormalSkill' : input === 'combo' ? 'ComboSkill' : 'UltimateSkill';
    const own = this.ownSkill(op, slot);
    const swap = this.slots.get(op)?.get(slot);
    if (!swap) return own;
    const over = (swap.buff && !swap.buff.owner.buffs.includes(swap.buff)) || swap.run?.ended || (swap.until !== undefined && this.frame >= swap.until);
    return over ? (swap.back ?? own) : swap.id;
  }

  /**
   * An operator's skill of a kind (skillSpecification Character<kind>): <id>_normal_skill / _combo_skill /
   * _ultimate_skill / _power_attack as most are named, else its own of that kind (Mi Fu's _normalskill_1 and
   * _powerattack, Typhoeus's _normal_skill_floating_start): a first step (_1, _start), else the shortest name.
   */
  private ownSkill(op: Entity, kind: string): string {
    const key = `${op.id}|${kind}`;
    const known = this.ownSkills.get(key);
    if (known) return known;
    const usual = `${op.id}_${{ NormalSkill: 'normal_skill', ComboSkill: 'combo_skill', UltimateSkill: 'ultimate_skill', PowerAttack: 'power_attack' }[kind] ?? kind}`;
    let id = usual;
    if (!this.skillOf.has(usual)) {
      const list = [...this.skillOf.entries()].filter(([k, v]) => k.startsWith(`${op.id}_`) && v.skillSpecification === `Character${kind}` && !/projhit|abilityentity|_end$|_loop$/.test(k)).map(([k]) => k);
      id = list.find((k) => /_1$|_start$/.test(k)) ?? list.sort((a, b) => a.length - b.length)[0] ?? usual;
    }
    this.ownSkills.set(key, id);
    return id;
  }

  /**
   * A skill's kind for DMG bonuses and checks: by its name (kindOf), else by its skillSpecification (projectiles
   * named only _projhit or _extra_attack: Laevatain's attack_5_projhit is a basic attack). Names come first: some
   * combo projectiles are filed as normal attacks (Ardelia's bombs).
   */
  kindOfSkill(id: string): string {
    const k = kindOf(id);
    if (k !== 'other') return k;
    const SPEC: Record<string, string> = { CharacterNormalAttack: 'basic', CharacterPowerAttack: 'basic', CharacterPlungingAttack: 'basic', CharacterDashAttack: 'basic', CharacterNormalSkill: 'normal', CharacterComboSkill: 'combo', CharacterUltimateSkill: 'ultimate' };
    return SPEC[this.skillOf.get(id)?.skillSpecification] ?? k;
  }

  /**
   * How an operator's basic attacks are named, # for the step: <id>_attack#, or in an ultimate's mode ("ult",
   * "UltMode") its enhanced ones, <id>_ult_attack# (Laevatain) or <id>_attack#_ult (Zhuang Fangyi). The switch
   * itself is in the game's animation states, not the data.
   */
  private chainOf(op: Entity): string {
    const modes = (this.modes.get(op) ?? []).filter((x) => x.buff.owner.buffs.includes(x.buff)).map((x) => x.mode);
    const ult = modes.some((m) => /^ult(mode)?$/i.test(m));
    // Ultimate forms' chains: _ult_attack1, _attack1_ult, or numbered in parts (Yvonne's _ult_attack1_1, _1_2, _2_1...).
    if (ult) for (const t of [`${op.id}_ult_attack#`, `${op.id}_attack#_ult`, `${op.id}_ult_attack#_1`]) if (this.skillOf.has(t.replace('#', '1'))) return t;
    // Another mode's own chain, <id>_<mode>_attack#: Typhoeus's hover ("floating") makes her Aerial Basic Attacks.
    for (const m of modes) {
      const t = `${op.id}_${m.toLowerCase()}_attack#`;
      if (this.skillOf.has(t.replace('#', '1'))) return t;
    }
    return `${op.id}_attack#`;
  }

  /**
   * Whether an operator's basic attacks now are ones a recording's SP bar can't show: its ultimate's own attacks
   * (Yvonne's give no SP), or one its ultimate has waiting (Yvonne's closing Final Strike, ult_attack_end). Not
   * another attack a buff has waiting: her talent's Final Strike after the bomb is an ordinary one.
   */
  attacksUnseen(slot: number): boolean {
    return /_ult/.test(this.chainOf(this.team[slot])) || /_ult/.test(this.attackMapping(this.team[slot])?.id ?? '');
  }

  /** A new phase: the enemy's Stagger meter starts empty, not Staggered (the owner's video: Alleikhreos's second). */
  newPhase(): void {
    const e = this.enemy;
    e.bb.set('stagger', 0);
    e.bb.set('finisherReady', 0);
    if (this.staggered(e)) {
      e.bb.set('staggeredUntil', this.frame);
      const last = this.staggers.at(-1);
      if (last) last.end = Math.min(last.end, this.frame);
    }
    this.poiseGuard = null;
    this.guardUntil = -1;
    this.guarded = [];
  }

  /**
   * The operator's press just made interrupts the enemy (Enemy.interrupt): its first hit of that kind on it, within
   * 3 s, does (by the operator, not the run: Yvonne's bomb is thrown by a buff).
   */
  interrupt(slot: number): void {
    const run = this.main[slot];
    if (run) this.interrupts.set(slot, { kind: this.kindOfSkill(run.skillId), until: this.frame + 3 * FPS });
  }

  /** The kind of skill a cast is (its press's: a projectile's launcher, a buff's own cast). */
  private castKindOf(ctx: Ctx): string {
    return ctx.self?.castKind ?? this.kindOfSkill(ctx.run?.origin?.skillId ?? ctx.run?.skillId ?? ctx.skillId);
  }

  /** Whether an operator's next basic attack is one a buff has waiting that a recording shows (Yvonne's talent's Final Strike). */
  strikeWaiting(slot: number): boolean {
    return !!this.attackMapping(this.team[slot]) && !this.attacksUnseen(slot);
  }

  /** A run goes on from a frame of its timeline (JumpToAction). */
  private jumpTo(run: Run, dest: number): void {
    run.start = this.frame - dest;
    (run.skill.actionGroupData?.timelineActions ?? []).forEach((ta: Data, i: number) => {
      if ((ta._startFrame ?? 0) >= dest || run.done.has(i)) return;
      run.done.add(i);
      // A jump past the skill's MarkCanInterrupt skips the part it holds the operator for: Last Rite's battle skill
      // cast off-field goes from frame 0 to 300, past its mark at 51, and the recording swaps to her 0.75 s in.
      if ((ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'MarkCanInterrupt')) run.canInterrupt = true;
    });
  }

  /** The enemy's Stagger meter now as a share of it (-1 while Staggered; 0 with no meter). */
  meterNow(): number {
    if (!this.foe.poise) return 0;
    return this.staggered(this.enemy) ? -1 : (this.enemy.bb.get('stagger') ?? 0) / this.foe.poise;
  }

  /**
   * The Staggered meter's fill (0–1) as the game drains it: the Stagger time left over its duration. It stands still
   * through cut-ins and runs slow under Imprisonment, as the Staggered time does. Undefined when not Staggered.
   */
  staggerLeft(): number | undefined {
    if (!this.staggered(this.enemy) || !this.foe.staggerSeconds) return undefined;
    return Math.min(1, (this.enemy.bb.get('staggeredUntil')! - this.frame) / (this.foe.staggerSeconds * FPS));
  }

  /**
   * Only n of the operator's summons are in reach of its next skill (a recording's SP back says: Tangtang's
   * Whirlpools the boss moved away from), for the next 2 s.
   */
  reachOnly(slot: number, n: number): void {
    this.reach.set(slot, { n, until: this.frame + 2 * FPS });
  }

  /** Whether a Finisher waits on the Staggered enemy. */
  finisherWaiting(): boolean {
    return !!this.enemy.bb.get('finisherReady') && this.staggered(this.enemy);
  }

  chainLength(op: Entity): number {
    return this.chainSteps(op).length;
  }

  /**
   * An operator's basic attack chain: from <chain>1, each attack's next by its own ComboCacheAction (the Attack
   * input's mapping), until it comes back round. Lifeng's goes 1, 2, 3, 5; numbered steps when there's no mapping.
   */
  chainSteps(op: Entity): string[] {
    const chain = this.chainOf(op);
    const known = this.chainList.get(chain);
    if (known) return known;
    const steps: string[] = [];
    let id: string | undefined = chain.replace('#', '1');
    while (id && this.skillOf.has(id) && !steps.includes(id)) {
      steps.push(id);
      const after = this.attackAfter(id);
      id = after ?? chain.replace('#', String(steps.length + 1));
    }
    this.chainList.set(chain, steps);
    return steps;
  }

  /**
   * The attack after a chain's step i: what its ComboCacheAction maps the Attack input to (Yvonne's ultimate's last
   * sequence maps to itself and repeats), else the next step, else the first again.
   */
  private nextAttack(steps: string[], i: number): string {
    const mapped = this.attackAfter(steps[i]);
    if (mapped && this.skillOf.has(mapped)) return mapped;
    return steps[i + 1] ?? steps[0];
  }

  /** The attack an attack's ComboCacheAction maps the Attack input to. */
  private attackAfter(id: string): string | undefined {
    for (const ta of this.skillOf.get(id)?.actionGroupData?.timelineActions ?? [])
      for (const d of ta._sequenceActionData?.actionData ?? [])
        if (short(d.$type) === 'ComboCacheAction') for (const m of d.mappingDataList ?? []) if (m.cmdType === 'Attack' && m.skillId) return m.skillId;
    return undefined;
  }

  /**
   * Whether an input can be done now (resources, cooldowns, locks). `loose`: whether it could be once SP is there
   * and the operator is free (an input that can't, like End Stance, is skipped in a fixed order).
   */
  can(slot: number, input: Input, loose = false): boolean {
    const op = this.team[slot];
    if (input === 'swap') {
      if (!this.swaps) return false;
      const cur = this.main[this.controlled];
      // Not to an operator in the middle of a skill (owner's observation); a stance goes on, so it's no bar.
      const theirs = this.main[slot];
      if (this.busy(theirs) && !this.stance(theirs!)) return false;
      return !this.freeze && slot !== this.controlled && (!this.busy(cur) || this.stance(cur!)) && this.frame - this.lastSwap >= Math.round(this.swapCooldown * FPS);
    }
    const id = this.skillIdOf(op, input);
    if (!this.skillOf.has(id)) return false;
    if (this.down()) return false;
    if (input === 'attack' || input === 'dive') {
      if (slot !== this.controlled || this.freeze) return false;
      return this.canAttack(slot);
    }
    // Each operator is held only by its own cast; nothing can be pressed while an ultimate stops time.
    // End Stance isn't pressed: ending Liino's Vocalist Stance early only loses its beats (keepStances).
    if (input === 'battle' && this.keepStances && /_normal_skill_end$/.test(id)) return false;
    if (this.clockNow < (this.readyAt.get(id) ?? 0)) return false;
    if (loose) return true;
    // A busy operator: only what its skill's window lets in (a cancel; a stance's own list always), or an ultimate
    // ending a stance.
    const run = this.main[slot];
    // While an ultimate stops time only another ultimate, and only where a recording shows one (two in one cut-in:
    // the Skydrummer video's Tangtang and Yvonne at 1:07, both dots emptied before the HUD hid).
    if (this.freeze && !(input === 'ultimate' && !this.strictUltimates)) return false;
    if (this.busy(run) && !((this.cancels || this.stance(run!)) && this.allowsNext(run!, id)) && !(input === 'ultimate' && this.stance(run!))) return false;
    const p = this.patchAt(id, slot);
    if (input === 'battle') return this.sp >= this.param(id, 1, p?.cost ?? 100);
    if (input === 'ultimate') return !this.strictUltimates || op.energy >= this.param(id, 1, p?.cost ?? 100) - 1e-6;
    if (input === 'combo' && this.strictCombos) return (this.comboReady.get(slot) ?? -1) >= this.frame;
    return true;
  }

  /** Does an input if it can; true if done. */
  press(slot: number, input: Input): boolean {
    if (!this.can(slot, input)) return false;
    const op = this.team[slot];
    this.log.push({ frame: this.frame, op: slot, input });
    if (input === 'swap') {
      // The operator leaving stays on the field under the AI and finishes what it was doing (no swapping out before
      // its skill's MarkCanInterrupt). The one coming in stops whatever the AI had it doing: its basic attacks start a
      // new chain. Both as the owner sees in game.
      this.controlled = slot;
      this.lastSwap = this.frame;
      this.chains[slot] = null;
      const was = this.main[slot];
      if (was && !was.ended && this.kindOfSkill(was.skillId) === 'basic') this.endRun(was, true);
      return true;
    }
    if (input === 'attack') {
      this.attack(slot);
      return true;
    }
    if (input === 'dive') {
      this.dive(slot);
      return true;
    }
    const id = this.skillIdOf(op, input);
    const p = this.patchAt(id, slot);
    if (input === 'battle') {
      const cost = this.param(id, 1, p?.cost ?? 100);
      this.sp -= cost;
      // Its Ultimate Energy comes from the skill's own buff (ObtainUspInNormalSkill), from this cost.
      this.lastBattleCost = cost;
    }
    // An ultimate spends its cost (Arcane's second cast is free until its window ends).
    if (input === 'ultimate') op.energy = Math.max(0, op.energy - this.ultCost(op));
    if (input === 'combo') this.comboReady.delete(slot);
    // The next battle skill or ultimate consumes every active Link: +30/45/60/75% for a battle skill, +20/30/40/50%
    // for an ultimate (1-4 Links; endfield.wiki.gg Link, game code: not in the data).
    if (input === 'battle' || input === 'ultimate') {
      const n = Math.min(4, this.links.filter((f) => f > this.frame).length);
      this.links = [];
      if (n) this.linked.set(op, { kind: input === 'battle' ? 'normal' : 'ultimate', mul: 1 + (input === 'battle' ? 0.15 : 0.1) * (n + 1) });
      else this.linked.delete(op);
    }
    // Combo cooldowns × ComboSkillCooldownScalar (Qingbo and similar sets: 0.85).
    const cdScale = input === 'combo' ? this.factor(op, 'ComboSkillCooldownScalar') : 1;
    if (input === 'combo' || input === 'ultimate') this.readyAt.set(id, this.clockNow + Math.round(this.param(id, 2, p?.cooldown ?? 0) * cdScale * FPS));
    this.abilityEvent(op, 'OnBeforeCastSkill', this.enemy, undefined, undefined, { origin: id, casting: true });
    // A new press cuts the operator's previous skill or attack short.
    const prev = this.main[slot];
    if (prev) this.endRun(prev, true);
    // A combo knows what triggered it (dynamic consumed_type, numbered Fire 0, Pulse 1, Cryst 2, Natural 3, and consumed_layer).
    const cause = input === 'combo' ? this.comboCause.get(slot) : undefined;
    const handed = cause ? new Map([['consumed_type', ['Fire', 'Pulse', 'Cryst', 'Natural'].indexOf(cause.element)], ['consumed_layer', cause.stacks]]) : undefined;
    if (input === 'combo') this.comboCause.delete(slot);
    // The operator's entity holds them too (EntityBB_consumed_type), for what the combo leaves behind; Si's Ink Lung
    // reads the stacks as EntityBB_combo_count (the game's code sets it: no data does).
    for (const [k, v] of handed ?? []) op.bb.set(`EntityBB_${k}`, v);
    if (cause) op.bb.set('EntityBB_combo_count', cause.stacks);
    const run = this.cast(id, op, op, this.enemy, handed);
    if (run) run.main = true;
    this.main[slot] = run;
    // Its cost is paid (Forgeborn Scathe listens for the ultimate's); the caster is the event's target.
    this.abilityEvent(op, 'OnAfterSkillApplyCost', op, undefined, undefined, { origin: id, casting: true });
    const c = this.chains[slot];
    if (c && this.bundleOf(op)?.dontInterruptCombo) c.held = true;
    else this.chains[slot] = null;
    return true;
  }

  /** An operator's Haste now: the highest one (they don't add up: "HighPriority"). */
  hasteOf(op: Entity): number {
    return Math.max(0, ...this.hastes(op).map((x) => x.rate));
  }

  /** Frames the Haste that counts now (hasteOf) has left: its own time or its buff's, whichever ends first. */
  hasteLeft(op: Entity): number {
    const x = this.hastes(op).reduce<Effect | undefined>((a, y) => (!a || y.rate > a.rate ? y : a), undefined);
    return x ? Math.min(x.until, x.parent?.end ?? Infinity) - this.frame : 0;
  }

  private hastes(op: Entity): Effect[] {
    return (op.haste ?? []).filter((x) => x.until > this.frame && (!x.parent || x.parent.owner.buffs.includes(x.parent)));
  }

  /** Whether an operator can do its next basic attack (not in a skill; its chain's window open, or the chain over). */
  private canAttack(slot: number): boolean {
    if (!this.skillOf.has(this.skillIdOf(this.team[slot], 'attack'))) return false;
    // A skill's AllowNextSkillAction window lets the next basic attack in before it can otherwise be interrupted;
    // not while a buff catches the attack presses (AttackClickListenerAction: Liino's Vocalist Stance).
    const run = this.main[slot];
    if (this.busy(run) && !(this.cancels && this.windowStarted(run!))) return false;
    if (this.team[slot].buffs.some((b) => this.has(b.def, 'AttackClickListenerAction'))) return false;
    const c = this.chains[slot];
    // An attack with no next-attack window that ends itself (InterruptCurSkillAction: Typhoeus's Aerial Basic Attacks)
    // lets the next one in when it ends.
    return !c || c.held || this.frame >= c.nextFrom || this.frame > c.nextTo || (!!c.run && c.run.ended && c.nextFrom - c.run.start >= c.run.skill.durationFrame);
  }

  /** The next step of an operator's basic attack chain; the window for the one after (AllowNextSkillAction). */
  private attack(slot: number): void {
    const op = this.team[slot];
    // The controlled operator's first attack on a Staggered enemy is a Finisher (its power attack), except in an
    // ultimate form or with its closing attack waiting (the owner's video: Yvonne's ultimate on a Staggered
    // Alleikhreos, twice, and no Finisher). Another attack a buff has waiting comes after the Finisher (Skydrummer
    // video: her bomb at 131.6, the Finisher at 137.3, her talent's Final Strike at 139.0).
    const power = this.ownSkill(op, 'PowerAttack');
    const unseen = this.attacksUnseen(slot);
    const waiting = this.attackMapping(op);
    const finisher = this.finishers && slot === this.controlled && !unseen && !!this.enemy.bb.get('finisherReady') && this.staggered(this.enemy) && this.skillOf.has(power);
    const mapped = finisher ? null : waiting;
    if (mapped) mapped.buff.mapUsed = true;
    const id = finisher ? power : (mapped?.id ?? this.skillIdOf(op, 'attack'));
    const skill = this.skillOf.get(id);
    if (finisher) this.enemy.bb.set('finisherReady', 0);
    const prev = this.main[slot];
    if (prev) this.endRun(prev, true);
    for (const r of this.runs) if (r.follow && !r.ended && r.owner === op) this.endRun(r, true);
    this.abilityEvent(op, 'OnBeforeCastSkill', this.enemy, undefined, undefined, { origin: id, casting: true });
    this.main[slot] = this.cast(id, op, op, this.enemy);
    if (this.main[slot]) Object.assign(this.main[slot]!, { main: true, unseen });
    // The next attack's window: AllowNextSkillAction, else a ComboCacheAction taking the Attack input (Typhoeus's
    // fourth Aerial Basic Attack).
    const tas: Data[] = skill.actionGroupData?.timelineActions ?? [];
    // The window for the attack that follows (AllowNextSkillAction's allowedSkillIdList: another window may be for
    // a talent's Final Strike or the ultimate's closing attack and open at once), else any attack's, else any.
    const steps0 = this.chainSteps(op);
    const idx = steps0.indexOf(finisher ? steps0[steps0.length - 1] : id);
    const following = idx >= 0 ? this.nextAttack(steps0, idx) : undefined;
    const allows = (ta: Data): string[][] => (ta._sequenceActionData?.actionData ?? []).filter((d: Data) => /AllowNextSkillAction/.test(d.$type ?? '') && d.isEnable !== false).map((d: Data) => d.allowedSkillIdList ?? []);
    const next =
      (following && tas.find((ta) => allows(ta).some((l) => l.includes(following)))) ??
      tas.find((ta) => allows(ta).some((l) => l.some((x) => steps0.includes(x)))) ??
      tas.find((ta) => allows(ta).length > 0) ??
      tas.find((ta) => (ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'ComboCacheAction' && d.isEnable !== false && (d.mappingDataList ?? []).some((m: Data) => m.cmdType === 'Attack' && m.skillId)));
    const speed = 1 + this.hasteOf(op);
    const from = Math.round((next ? next._startFrame : (skill.exclusiveFrame ?? skill.durationFrame ?? 0)) / speed);
    const to = Math.round((next ? next._endFrame : (skill.exclusiveFrame ?? skill.durationFrame ?? 0)) / speed);
    // A Finisher counts as the chain's last attack.
    const steps = this.chainSteps(op);
    const at = finisher ? steps.at(-1)! : id;
    this.chains[slot] = { id: at, of: this.chainOf(op), nextFrom: this.frame + from, nextTo: this.frame + to, run: this.main[slot] ?? undefined };
    // A guard's delay comes before each new chain; within one it goes on as soon as it may.
    const last = at === steps.at(-1);
    this.guardNext[slot] = this.frame + from + (last ? Math.round(this.guardDelay * FPS) : 0);
  }

  /** Operators not controlled attack when they're free and hold an Attacker role (guardAttacks). */
  private guards(): void {
    if (!this.guardAttacks) return;
    // Only while the controlled operator is attacking or in a skill: teammates follow the player's lead (AIGlobalSetting
    // playerStopAtkTime: the AI stops when the player does; assumed to be at once here, not after its 10 s).
    const lead = this.main[this.controlled];
    if (!lead || lead.ended) return;
    const period = GUARD_PERIOD * FPS;
    let k = 0;
    this.team.forEach((_, slot) => {
      if (slot === this.controlled) return;
      // Each teammate's window in the period, the three spread evenly over it.
      const at = (this.frame + this.frozenFrames + Math.round((k++ * period) / 3)) % period;
      if (at < this.guardShare * period && this.frame >= this.guardNext[slot] && this.canAttack(slot)) this.attack(slot);
    });
  }

  /**
   * A stance: a skill that goes on under the AI (SkillAIMoveAction: Liino's) once its AllowNextSkillAction window
   * opens. It can be swapped out of, and the operator's ultimate cuts it (Cosmovoice Stance replaces Vocalist
   * Stance). Assumed: the data has no rule for either.
   */
  private stance(run: Run): boolean {
    return this.has(run.skill, 'SkillAIMoveAction') && this.allowedNow(run) !== null;
  }

  /** Whether the enemy is in one of its `away` stretches. */
  private untouchable(): boolean {
    const c = this.frame + this.frozenFrames;
    return this.away.some(([a, b]) => c >= a && c < b);
  }

  /** Whether the enemy can't be hit now (uptime): the end of each UPTIME_PERIOD. */
  down(): boolean {
    if (this.uptime >= 1) return false;
    const period = UPTIME_PERIOD * FPS;
    return this.frame % period >= Math.max(0, this.uptime) * period;
  }

  /** Whether a run's first AllowNextSkillAction window has opened. */
  private windowStarted(run: Run): boolean {
    const at = this.frame - run.start;
    return (run.skill.actionGroupData?.timelineActions ?? []).some(
      (ta: Data) => (ta._startFrame ?? 0) <= at && (ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'AllowNextSkillAction'),
    );
  }

  /** Whether a skill or buff definition holds an action of a kind anywhere (cached). */
  private has(def: Data, type: string): boolean {
    let kinds = actionKinds.get(def);
    if (!kinds) actionKinds.set(def, (kinds = new Set((JSON.stringify(def).match(/\.(\w+)(?:\+Data)?, Gameplay\.Beyond/g) ?? []).map((m) => m.slice(1).replace(/(\+Data)?, Gameplay\.Beyond$/, '')))));
    return kinds.has(type);
  }

  /** The skills a run lets in now: its open AllowNextSkillAction windows' lists ('*' for an empty list); null with none open. */
  private allowedNow(run: Run): Set<string> | null {
    const at = this.frame - run.start;
    let out: Set<string> | null = null;
    for (const ta of run.skill.actionGroupData?.timelineActions ?? [])
      if ((ta._startFrame ?? 0) <= at && at <= (ta._endFrame ?? ta._startFrame ?? 0))
        for (const d of ta._sequenceActionData?.actionData ?? [])
          if (short(d.$type) === 'AllowNextSkillAction') {
            out ??= new Set();
            for (const id of d.allowedSkillIdList?.length ? d.allowedSkillIdList : ['*']) out.add(id);
          }
    return out;
  }

  /** Whether a run's open AllowNextSkillAction window lets a skill in. */
  private allowsNext(run: Run, id: string): boolean {
    const ok = this.allowedNow(run);
    return !!ok && (ok.has('*') || ok.has(id));
  }

  /**
   * Whether a run still holds its operator: a skill until its MarkCanInterrupt
   * (where it has one) or its exclusive frames; basic attacks never (their
   * chain windows decide).
   */
  private busy(run: Run | null): boolean {
    // Basic attacks never hold an operator up, but a Finisher does until its window (Yvonne's lands its 8.1× hit at
    // frame 28 and lets the next skill in at 29: an ultimate pressed right after it no longer cuts it off).
    if (!run || run.ended || (this.kindOfSkill(run.skillId) === 'basic' && !/_power_?attack$/.test(run.skillId))) return false;
    const marked = (run.skill.actionGroupData?.timelineActions ?? []).some((ta: Data) => (ta._sequenceActionData?.actionData ?? []).some((d: Data) => short(d.$type) === 'MarkCanInterrupt'));
    return marked ? !run.canInterrupt : this.frame - run.start < (run.skill.exclusiveFrame ?? 0);
  }

  /** A combo becomes castable (if it's off cooldown) for the combo window. */
  triggerCombo(slot: number, cause?: { element: string; stacks: number }): void {
    const id = this.skillIdOf(this.team[slot], 'combo');
    if ((this.readyAt.get(id) ?? 0) > this.clockNow) return;
    this.comboReady.set(slot, this.frame + Math.round(this.comboWindow * FPS));
    // Without an event, the enemy's infliction now.
    const el = cause?.element ?? ELEMENTS.find((x) => (this.enemy.bb.get(`inflict_${x}`) ?? 0) > 0);
    if (!el) return;
    // The most stacks while it's ready (Si's: "the highest stacks of Arts Infliction consumed or absorbed").
    const stacks = cause?.stacks ?? this.enemy.bb.get(`inflict_${el}`) ?? 0;
    const had = this.comboCause.get(slot);
    if (!had || stacks >= had.stacks) this.comboCause.set(slot, { element: el, stacks });
  }

  /** What happened that combo triggers watch for; each operator's rule decides (COMBO_TRIGGERS). */
  comboEvent(ev: ComboEvent): void {
    this.team.forEach((op, slot) => {
      const rule = COMBO_TRIGGERS[op.id];
      if (rule && rule(ev, this, op)) this.triggerCombo(slot, 'element' in ev ? ev : undefined);
    });
  }

  /**
   * A copy of the fight as it stands, to try different presses from here. The game data (bundles, skill and
   * buff definitions, settings, builds) is shared; hits and the input log are copied as lists (they're only
   * added to).
   */
  clone(): World {
    const shared = sharedData(this.bundles, this.settings, this.team);
    const memo = new Map<object, unknown>();
    memo.set(this.hits, this.hits.slice());
    memo.set(this.log, this.log.slice());
    const copy = (o: unknown): unknown => {
      if (o === null || typeof o !== 'object') return o;
      if (shared.has(o)) return o;
      const done = memo.get(o);
      if (done !== undefined) return done;
      if (o instanceof Map) {
        // BB (a Map with fallbacks) is constructed as one, then given copies of its fallbacks.
        const out = o instanceof BB ? new BB() : new Map();
        memo.set(o, out);
        for (const [k, v] of o) out.set(copy(k), copy(v));
        if (o instanceof BB) (out as BB).fallbacks = (o as BB).fallbacks.map((f) => copy(f) as Map<string, number>);
        return out;
      }
      if (o instanceof Set) {
        const out = new Set();
        memo.set(o, out);
        for (const v of o) out.add(copy(v));
        return out;
      }
      if (Array.isArray(o)) {
        const out: unknown[] = [];
        memo.set(o, out);
        for (const v of o) out.push(copy(v));
        return out;
      }
      const out = Object.create(Object.getPrototypeOf(o));
      memo.set(o, out);
      for (const k of Object.keys(o)) out[k] = copy((o as Record<string, unknown>)[k]);
      return out;
    };
    return copy(this) as World;
  }

  /** The enemy's time scale now: the slowest Imprisonment's curve at its progress (linear between keys). */
  private foeScale(): number {
    let scale = 1;
    this.seals = this.seals.filter((x) => this.frame - x.from < x.frames);
    for (const x of this.seals) {
      const p = (this.frame - x.from) / x.frames;
      const k = x.keys;
      let v = k[k.length - 1][1];
      for (let i = 1; i < k.length; i++)
        if (p <= k[i][0]) {
          const [t0, v0] = k[i - 1];
          const [t1, v1] = k[i];
          v = v0 + ((v1 - v0) * (p - t0)) / Math.max(1e-9, t1 - t0);
          break;
        }
      scale = Math.min(scale, Math.max(0, v));
    }
    return scale;
  }

  /** The enemy's own clock loses a frame: its debuffs, inflictions, Breach and Stagger wait one frame longer. */
  private foeLoseFrame(): void {
    const e = this.enemy;
    for (const b of e.buffs) {
      // The Imprisonment's own buffs run on their caster's time.
      if (b.paused || /combo_skill_seal/.test(b.id)) continue;
      b.start++;
      if (b.end !== Infinity) b.end++;
      if (b.stackEnds) b.stackEnds = b.stackEnds.map((x) => x + 1);
      if (b.nextTrigger !== Infinity) b.nextTrigger++;
    }
    for (const k of [...e.bb.keys()]) if (/^inflict_until_|^breachUntil$/.test(k)) e.bb.set(k, e.bb.get(k)! + 1);
    if (this.staggered(e)) {
      e.bb.set('staggeredUntil', e.bb.get('staggeredUntil')! + 1);
      const last = this.staggers.at(-1);
      if (last) last.end = e.bb.get('staggeredUntil')!;
    }
    for (const v of e.vulnerable ?? []) if (v.until !== Infinity) v.until++;
  }

  /** The bundle an operator's skills come from. */
  bundleOf(op: Entity): Bundle | undefined {
    return this.bundles.find((b) => b.operator === op.id);
  }

  /**
   * The gameplay tag an operator carries as herself: the one her own skills mark their Ultimate Energy with
   * (ObtainCostAction uspRecoverTag) that her passive's RefrainObtainUsp lets through. Last Rite's 264623624: her
   * Perfusion makes phantom_main, not the teammates' phantom, when the strike is hers (CheckTagMatch on its owner).
   */
  ownTags(op: Entity): number[] {
    const b = op.side === 'team' && op.slot >= 0 ? this.bundleOf(op) : undefined;
    if (!b) return [];
    const cached = this.ownTagCache.get(op.id);
    if (cached) return cached;
    const gains = new Set<number>();
    const let_through = new Set<number>();
    const walk = (x: unknown, into: (d: Data) => void): void => {
      if (Array.isArray(x)) for (const v of x) walk(v, into);
      else if (x && typeof x === 'object') {
        into(x as Data);
        for (const v of Object.values(x)) walk(v, into);
      }
    };
    for (const [id, sk] of Object.entries(b.skills)) if (id.startsWith(op.id)) walk(sk, (d) => d.useUspRecoverTag && d.uspRecoverTag && gains.add(Number(d.uspRecoverTag.tagId)));
    walk(b.buffs[`buff_${op.id}_passive`], (d) => {
      if (short(d.$type) === 'RefrainObtainUsp') for (const t of d.refrainObtainUspTags?.predefinedTag ?? []) let_through.add(Number(t.tagId));
    });
    const tags = [...gains].filter((t) => let_through.has(t));
    this.ownTagCache.set(op.id, tags);
    return tags;
  }
  private ownTagCache = new Map<string, number[]>();
}

/** Something that happened that a combo trigger can watch for. */
export type ComboEvent =
  | { kind: 'inflict'; element: string; stacks: number; target: Entity }
  | { kind: 'physical'; status: PhysicalStatus | 'Vulnerable'; stacks: number; target: Entity }
  | { kind: 'finalStrike'; finisher: boolean; target: Entity }
  | { kind: 'comboDamage'; by: Entity }
  | { kind: 'stagger'; target: Entity }
  | { kind: 'burst'; of: string; target: Entity }
  | { kind: 'statusConsumed'; status: string; target: Entity }
  | { kind: 'consume'; element: string; stacks: number }
  | { kind: 'status'; status: string; target: Entity };

/**
 * Combo triggers the readable data doesn't hold (the game checks them in its
 * own code), from each skill's "COMBO TRIGGER" text on endfield.wiki.gg.
 * Operators whose data triggers its combo (TriggerComboSkillAction, as
 * Xaihi's does) need no rule here.
 */
/** Whether an enemy has an Arts Reaction (by its buffs' tags). */
const hasStatus = (e: Entity, status: string) => e.buffs.some((b) => (b.def.applyTags ?? []).some((t: Data) => STATUS_TAG[t.tagId] === status));
/** The Arts Reactions (statusConsumed also reports Physical Statuses). */
const ARTS_REACTIONS = ['Combustion', 'Solidification', 'Corrosion', 'Electrification'];
/** An enemy's Vulnerability stacks. */
const vulnerability = (e: Entity) => e.buffs.find((b) => b.id === VULNERABLE)?.stacks ?? 0;

export const COMBO_TRIGGERS: Record<string, (ev: ComboEvent, w: World, op: Entity) => boolean> = {
  // Arcane. INT: Nature Infliction, or 2+ stacks of another Arts Infliction applied; WILL: any Arts Infliction applied.
  chr_0032_lizhiyan: (ev, _w, op) => ev.kind === 'inflict' && ((op.bb.get('EntityBB_wisd_greater_will') ?? 1) < 1 || ev.element === 'Natural' || ev.stacks >= 2),
  // Last Rite: an enemy with 3 or more Cryo Infliction stacks.
  chr_0026_lastrite: (ev) => ev.kind === 'inflict' && ev.element === 'Cryst' && ev.stacks >= 3,
  // Si: an enemy's Cryo or Heat Infliction consumed or absorbed.
  chr_0036_jsspsi: (ev) => ev.kind === 'consume' && (ev.element === 'Cryst' || ev.element === 'Fire') && ev.stacks > 0,
  // Laevatain: an enemy suffers Combustion or Corrosion.
  chr_0016_laevat: (ev) => ev.kind === 'status' && (ev.status === 'Combustion' || ev.status === 'Corrosion'),
  // Camille: an enemy's Heat Infliction consumed or absorbed.
  chr_0033_camille: (ev) => ev.kind === 'consume' && ev.element === 'Fire' && ev.stacks > 0,
  // Endministrator: another operator in the team deals combo skill damage.
  chr_0002_endminm: (ev, _w, op) => ev.kind === 'comboDamage' && ev.by !== op,
  chr_0003_endminf: (ev, _w, op) => ev.kind === 'comboDamage' && ev.by !== op,
  // Perlica: the controlled operator's Final Strike.
  chr_0004_pelica: (ev) => ev.kind === 'finalStrike' && !ev.finisher,
  // Chen Qianyu: an enemy becomes Vulnerable.
  chr_0005_chen: (ev) => ev.kind === 'physical' && ev.status === 'Vulnerable',
  // Wulfgard: an Arts Infliction applied.
  chr_0006_wolfgd: (ev) => ev.kind === 'inflict',
  // Arclight: an enemy suffers Electrification, or its Electrification is consumed.
  chr_0007_ikut: (ev) => (ev.kind === 'status' || ev.kind === 'statusConsumed') && ev.status === 'Electrification',
  // Avywenna: a Final Strike on an enemy with Electric Infliction or Electrification.
  chr_0012_avywen: (ev) => ev.kind === 'finalStrike' && !ev.finisher && ((ev.target.bb.get('inflict_Pulse') ?? 0) > 0 || hasStatus(ev.target, 'Electrification')),
  // Gilberta: an Arts Reaction applied.
  chr_0013_aglina: (ev) => ev.kind === 'status',
  // Lifeng: a Final Strike on an enemy with Physical Susceptibility or Breach.
  chr_0015_lifeng: (ev, w) =>
    ev.kind === 'finalStrike' && !ev.finisher && ((ev.target.vulnerable ?? []).some((x) => x.kind === 'Physical' && x.until > w.frame) || (ev.target.bb.get('breachUntil') ?? 0) > w.frame),
  // Yvonne: a Final Strike on an enemy with Solidification.
  chr_0017_yvonne: (ev) => ev.kind === 'finalStrike' && !ev.finisher && hasStatus(ev.target, 'Solidification'),
  // Da Pan: an enemy reaches 4 Vulnerability stacks.
  chr_0018_dapan: (ev) => ev.kind === 'physical' && vulnerability(ev.target) >= 4,
  // Akekuri: an enemy becomes Staggered or hits a Stagger Node.
  chr_0019_karin: (ev) => ev.kind === 'stagger',
  // Estella: an enemy suffers Solidification.
  chr_0021_whiten: (ev) => ev.kind === 'status' && ev.status === 'Solidification',
  // Fluorite: an enemy with 2 or more Cryo or Nature Infliction stacks.
  chr_0022_bounda: (ev) => ev.kind === 'inflict' && (ev.element === 'Cryst' || ev.element === 'Natural') && ev.stacks >= 2,
  // Antal: an enemy with his Focus (his battle skill's mark) suffers a Physical Status or Arts Infliction.
  chr_0023_antal: (ev) => (ev.kind === 'physical' || ev.kind === 'inflict') && ev.target.buffs.some((b) => b.id === 'buff_chr_0023_antal_normal_skill'),
  // Alesh: an enemy's Arts Reaction (or Originium Crystals: Solidification) consumed.
  chr_0024_deepfin: (ev) => ev.kind === 'statusConsumed',
  // Ardelia: a Final Strike on an enemy with no Vulnerability and no Arts Infliction.
  chr_0025_ardelia: (ev) => ev.kind === 'finalStrike' && !ev.finisher && vulnerability(ev.target) === 0 && ELEMENTS.every((x) => !(ev.target.bb.get(`inflict_${x}`) ?? 0)),
  // Tangtang: Cryo Infliction applied, or Arts Burst damage dealt.
  chr_0027_tangtang: (ev) => (ev.kind === 'inflict' && ev.element === 'Cryst') || ev.kind === 'burst',
  // Pogranichnik: Crush or Breach consumes Vulnerability.
  chr_0029_pograni: (ev) => ev.kind === 'physical' && (ev.status === 'Crush' || ev.status === 'Breach'),
  // Zhuang Fangyi: the controlled operator's Final Strike or Finisher on an enemy with Electric Infliction.
  chr_0030_zhuangfy: (ev) => ev.kind === 'finalStrike' && (ev.target.bb.get('inflict_Pulse') ?? 0) > 0,
  // Mi Fu: an enemy with 3 or more Vulnerability stacks.
  chr_0031_mifu: (ev) => ev.kind === 'physical' && vulnerability(ev.target) >= 3,
  // Ember, Snowshine, Catcher, Purrchena: when the controlled operator is attacked; the training dummy doesn't attack.
  // Liino: while Vocalist Stance is active, an Arts Reaction is consumed or applied.
  chr_0035_liino: (ev, _w, op) =>
    (ev.kind === 'status' || ev.kind === 'statusConsumed') && ARTS_REACTIONS.includes(ev.status) && op.buffs.some((b) => b.id === 'buff_chr_0035_liino_normalskill_music_tag'),
  // Typhoeus (max Signs) isn't modelled yet.
};

/** A custom event's name: written in, or a value (Liino's liino_comboskill_end). */
const eventName = (x: Data): string => (typeof x === 'string' ? x : x?.useBlackboardKey ? '' : String(x?.value ?? ''));

/** The action kinds in each skill or buff definition (World.has). */
const actionKinds = new WeakMap<object, Set<string>>();

/** Everything reachable from the game data and builds, which fights only read (World.clone shares it). */
const sharedCache = new WeakMap<object, WeakSet<object>>();
/**
 * EntityBB_ keys only projectile hits use (no other skill or buff touches them): the projectile's own, so each launch
 * starts afresh (Tangtang's Final Strike gives SP on its first hit only, EntityBB_atk05_cnt; Perlica's combo bounce).
 */
const projectileKeyCache = new WeakMap<Bundle[], Set<string>>();
function projectileKeys(bundles: Bundle[]): Set<string> {
  let keys = projectileKeyCache.get(bundles);
  if (keys) return keys;
  const users = new Map<string, Set<string>>();
  for (const b of bundles)
    for (const [id, d] of [...Object.entries(b.skills), ...Object.entries(b.buffs)])
      for (const m of JSON.stringify(d).matchAll(/"(?:EntityBB_)?(\w+)"/g)) {
        const k = `EntityBB_${m[1]}`;
        if (!users.has(k)) users.set(k, new Set());
        users.get(k)!.add(id);
      }
  keys = new Set();
  for (const b of bundles)
    for (const d of [...Object.values(b.skills), ...Object.values(b.buffs)])
      for (const m of JSON.stringify(d).matchAll(/"key":\s*"(EntityBB_\w+)"/g)) {
        const ids = users.get(m[1]) ?? new Set();
        if ([...ids].every((id) => /projhit/.test(id))) keys.add(m[1]);
      }
  projectileKeyCache.set(bundles, keys);
  return keys;
}

function sharedData(bundles: Bundle[], settings: object, team: Entity[]): WeakSet<object> {
  let set = sharedCache.get(bundles);
  if (set) return set;
  set = new WeakSet<object>();
  const stack: unknown[] = [bundles, settings, ...team.map((t) => t.stats)];
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== 'object' || set.has(o)) continue;
    set.add(o);
    if (o instanceof Map) for (const [k, v] of o) stack.push(k, v);
    else for (const v of Object.values(o)) stack.push(v);
  }
  sharedCache.set(bundles, set);
  return set;
}

/** Whether an action is a condition (the game's Conditions namespace, or a Check/Compare test). */
function isCondition(a: Data): boolean {
  const t = String(a.$type ?? '');
  return /\.Conditions\./.test(t) || /^(Check|Compare)[A-Z]/.test(short(t));
}

/** A skill's kind from its id: basic attacks, battle ("normal") skill, combo, ultimate. */
/** Whether a skill deals damage on its own timeline (not only through what it launches): a Finisher's main hit. */
const ownHit = (skill: Data): boolean =>
  (skill?.actionGroupData?.timelineActions ?? []).some((ta: Data) => (ta._sequenceActionData?.actionData ?? []).some((d: Data) => /\.DamageAction\+/.test(d.$type ?? '')));

export function kindOf(skillId: string): string {
  if (/_ultimate_skill/.test(skillId)) return 'ultimate';
  if (/_combo_skill/.test(skillId)) return 'combo';
  if (/_normal_?skill/.test(skillId)) return 'normal';
  if (/_attack\d|_power_?attack|_dash_attack|_plunging/.test(skillId)) return 'basic';
  return 'other';
}
