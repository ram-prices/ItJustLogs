import type { WikiGear, WikiGearSet, WikiOperator, WikiWeapon } from './wiki';

/**
 * What the player has equipped on an operator: a weapon and four gear
 * pieces (Armor, Gloves and two Kits), by game id. Kept in settings
 * (`loadouts`, keyed by operator id), so it's in backups and Drive sync.
 */
export interface Loadout {
  weapon?: string;
  armor?: string;
  gloves?: string;
  kit1?: string;
  kit2?: string;
  /**
   * Each gear piece's Artifice per stat ([0–3, 0–3, 0–3], the stats in the piece's order), when not all at their
   * highest. Saves from before per-stat Artifice hold one number for all three (`artificeLevels` reads both).
   */
  artifice?: Partial<Record<GearSlot, number | number[]>>;
}

export type GearSlot = 'armor' | 'gloves' | 'kit1' | 'kit2';
export type LoadoutSlot = 'weapon' | GearSlot;

/** The gear slots in the game's order, with the gear type each one takes. */
export const GEAR_SLOTS: { slot: GearSlot; type: string; label: string }[] = [
  { slot: 'armor', type: 'Armor', label: 'Armor' },
  { slot: 'gloves', type: 'Gloves', label: 'Gloves' },
  { slot: 'kit1', type: 'Kit', label: 'Kit' },
  { slot: 'kit2', type: 'Kit', label: 'Kit' },
];

export const isLoadoutSlot = (s: string): s is LoadoutSlot => s === 'weapon' || GEAR_SLOTS.some((g) => g.slot === s);

/** Pieces of one set it takes for the set effect. */
export const SET_PIECES = 3;

/** How many equipped pieces belong to each gear set. */
export function setCounts(l: Loadout, items: Record<string, WikiGear>): Map<string, number> {
  const out = new Map<string, number>();
  for (const { slot } of GEAR_SLOTS) {
    const set = l[slot] ? items[l[slot]!]?.set : null;
    if (set) out.set(set, (out.get(set) ?? 0) + 1);
  }
  return out;
}

/** `l` with `slot` set to `id` (or emptied); undefined when nothing is left equipped. */
export function withSlot(l: Loadout | undefined, slot: LoadoutSlot, id: string | null): Loadout | undefined {
  const next: Loadout = { ...l };
  if (id) next[slot] = id;
  else delete next[slot];
  // A new piece starts at its highest Artifice level again.
  if (slot !== 'weapon' && next.artifice?.[slot] != null) {
    const { [slot]: _, ...rest } = next.artifice;
    if (Object.keys(rest).length) next.artifice = rest;
    else delete next.artifice;
  }
  return Object.keys(next).length ? next : undefined;
}

/** `l` with one stat's Artifice level set on a gear slot (null: the whole piece back to the highest). */
export function withArtifice(l: Loadout | undefined, slot: GearSlot, g: WikiGear, stat: number, level: number | null): Loadout | undefined {
  const next: Loadout = { ...l, artifice: { ...l?.artifice } };
  const tops = artificeTops(g);
  const levels = artificeOf(l ?? {}, slot, g);
  if (level != null && stat >= 0 && stat < levels.length) levels[stat] = Math.max(0, Math.min(tops[stat], Math.floor(level)));
  if (level == null || levels.every((x, i) => x === tops[i])) delete next.artifice![slot];
  else next.artifice![slot] = levels;
  if (!Object.keys(next.artifice!).length) delete next.artifice;
  return Object.keys(next).length ? next : undefined;
}

/** The game's highest Artifice level for one stat (EquipConst maxAttrEnhanceLevel). */
export const ARTIFICE_MAX = 3;

/**
 * Artifice per stat from what a save holds: a list (per stat), one number (saves from before per-stat Artifice, which
 * counted every stat at that level), or nothing (`fallback`: each stat's own highest). Each is kept to 0–`tops[i]`.
 */
export function artificeLevels(saved: number | number[] | undefined | null, tops: number[], fallback = tops): number[] {
  return tops.map((top, i) => {
    const v = Array.isArray(saved) ? saved[i] : saved;
    return Math.max(0, Math.min(top, Math.floor(v ?? fallback[i] ?? 0)));
  });
}

/** Each stat's highest Artifice level (0 for a piece that can't be artificed). */
export const artificeTops = (g: Pick<WikiGear, 'stats'>): number[] => g.stats.map((s) => Math.max(0, Math.min(ARTIFICE_MAX, s.values.length - 1)));

/**
 * The piece's own Artifice mark, as the game's EquipEnhanceNode draws it: empty with nothing artificed, half once any
 * stat is, full when every stat is at 3 (its total reaches stats × 3). Null for a piece that can't be artificed.
 */
export function artificeState(levels: number[], tops: number[]): 'empty' | 'half' | 'full' | null {
  if (!tops.some((t) => t > 0)) return null;
  const total = levels.reduce((a, b) => a + b, 0);
  return total <= 0 ? 'empty' : total >= tops.length * ARTIFICE_MAX ? 'full' : 'half';
}

/**
 * Weapon skill bounds from ef-assets combat/weapon-tuning.json (its scripts/weapon-tuning.mjs): tuning templates
 * (WeaponBreakThroughTemplateTable), Potential templates (WeaponTalentTemplateTable) and each weapon's two.
 */
export interface WeaponTuningFile {
  templates: Record<string, { levels: number[]; bounds: [number, number][][] }>;
  potentials: Record<string, [number, number][][]>;
  weapons: Record<string, { tuning: string; potential: string; maxLevel: number }>;
}

/** One weapon's tuning: what its skills' levels can be at each stage and Potential. */
export interface WeaponTuning {
  /** The weapon level each stage is tuned at (stage 0, untuned: 1; then 20, 40, 60, 80). */
  levels: number[];
  maxLevel: number;
  /** Per stage, each skill's [lowest, highest] level at P0: the lowest with no essence, the highest essence reaches. */
  bounds: [number, number][][];
  /** Per Potential (P1 first), what it adds to each skill's [lowest, highest]. */
  potential: [number, number][][];
}

export const tuningOf = (f: WeaponTuningFile | null | undefined, wpnId: string): WeaponTuning | undefined => {
  const e = f?.weapons[wpnId];
  const t = e ? f!.templates[e.tuning] : undefined;
  return e && t ? { levels: t.levels, maxLevel: e.maxLevel, bounds: t.bounds, potential: f!.potentials[e.potential] ?? [] } : undefined;
};

/** Tuning stages: 0 (untuned) to 4 (tuned at levels 20, 40, 60 and 80). Saves from before tuning count as 4. */
export const TUNING_MAX = 4;

/** The highest level a weapon reaches at a tuning stage: the next stage's level, after the last its maxLv. */
export const tuningMaxLevel = (t: WeaponTuning | undefined, stage: number): number =>
  t ? (t.levels[stage + 1] ?? t.maxLevel) : ([20, 40, 60, 80][stage] ?? 90);

/** The weapon's own skill (the last of two or three), the one Potential raises; the others are its stat skills. */
const isOwnSkill = (w: Pick<WikiWeapon, 'skills'>, i: number): boolean => i === w.skills.length - 1 && w.skills.length > 1;

/** The most levels an essence adds to each skill (GemPresetTable term levels): 6 to a stat skill, 3 to the weapon's own. */
export const essenceMax = (w: Pick<WikiWeapon, 'skills'>): number[] => w.skills.map((_, i) => (isOwnSkill(w, i) ? ESSENCE_SKILL_MAX : ESSENCE_STAT_MAX));
const ESSENCE_STAT_MAX = 6;
const ESSENCE_SKILL_MAX = 3;

/**
 * Each skill's [lowest, highest] level at a tuning stage and Potential: the stage's bounds plus the Potential's (on
 * the weapon's own skill both move up one per Potential). Without the table (not loaded yet) as fully tuned: the stat
 * skills 3–9, the own skill (1–4) + Potential.
 */
export function weaponBounds(w: Pick<WikiWeapon, 'skills'>, potential: number | null, t?: WeaponTuning, stage = TUNING_MAX): [number, number][] {
  const p = Math.max(0, Math.floor(potential ?? 0));
  if (!t) return w.skills.map((_, i) => (isOwnSkill(w, i) ? [Math.min(WEAPON_SKILL_RANK, 1 + p), Math.min(WEAPON_SKILL_RANK, POTENTIAL_SKILL_BASE_CAP + p)] : [3, WEAPON_SKILL_RANK]));
  const row = t.bounds[Math.max(0, Math.min(t.bounds.length - 1, Math.floor(stage)))] ?? [];
  const extra = p ? (t.potential[Math.min(p, t.potential.length) - 1] ?? []) : [];
  return w.skills.map((_, i) => {
    const [lo, hi] = row[i] ?? [1, 1];
    const [a, b] = extra[i] ?? [0, 0];
    return [lo + a, hi + b];
  });
}

/** A skill's level: its lowest plus the essence's level for it, up to its highest. */
export const skillLevel = ([lo, hi]: [number, number], essence: number): number => Math.max(lo, Math.min(hi, lo + Math.max(0, Math.floor(essence))));

/** Each skill's level from its bounds (weaponBounds) and the essence's level per skill. */
export const weaponSkillLevels = (bounds: [number, number][], essence: number[]): number[] => bounds.map((b, i) => skillLevel(b, essence[i] ?? 0));

/** The essence levels (each 0 to essenceMax) that give these skill levels at these bounds: saves that held ranks. */
export const essenceFromRanks = (ranks: number[], bounds: [number, number][], max: number[]): number[] =>
  bounds.map(([lo], i) => Math.max(0, Math.min(max[i] ?? 0, Math.floor((ranks[i] ?? lo) - lo))));

/** A weapon's skill ranks with no essence: each skill's lowest level (weaponBounds). */
export const weaponBaseRanks = (w: Pick<WikiWeapon, 'skills'>, potential: number | null, t?: WeaponTuning, stage?: number): number[] =>
  weaponBounds(w, potential, t, stage).map((b) => b[0]);

/** The highest rank each of a weapon's skills can reach (weaponBounds). */
export const weaponRankCaps = (w: Pick<WikiWeapon, 'skills'>, potential: number | null, t?: WeaponTuning, stage?: number): number[] =>
  weaponBounds(w, potential, t, stage).map((b) => b[1]);

/** The Artifice level each of a slot's stats counts at: as set, else each stat's highest. */
export const artificeOf = (l: Loadout, slot: GearSlot, g: WikiGear): number[] => artificeLevels(l.artifice?.[slot], artificeTops(g));

/** Operators (ids) with this weapon equipped. */
export const wieldersOf = (loadouts: Record<string, Loadout> | undefined, weaponId: string): string[] =>
  Object.entries(loadouts ?? {})
    .filter(([, l]) => l.weapon === weaponId)
    .map(([id]) => id);

// ---------------------------------------------------------------------------
// Bonuses: what talents, Potentials, the weapon and gear add to attributes
// ---------------------------------------------------------------------------

/** One stat's bonus: flat amount, percent (in %), and where each part comes from. */
export interface Bonus {
  flat: number;
  pct: number;
  sources: { from: string; flat: number; pct: number }[];
}

/** A weapon skill's highest level (fully tuned, or the own skill at P5). */
export const WEAPON_SKILL_RANK = 9;
const POTENTIAL_SKILL_BASE_CAP = 4;

/** The operator fields the bonuses read. */
type BonusOperator = Pick<WikiOperator, 'mainAttribute' | 'secondaryAttribute' | 'talents' | 'potentials'>;

const ATTRIBUTES = ['Strength', 'Agility', 'Intellect', 'Will'];
/** Wiki markup (⟦num|+15⟧) as plain text. */
const plain = (s: string) => s.replace(/⟦[^|⟧]*\|([^⟧]*)⟧/g, '$1');

/**
 * "Intellect and Will +15, Arts Intensity +16." → its stat bonuses. Pieces
 * that aren't a plain bonus ("DMG Dealt +20% to enemies below 50% HP") are
 * left out.
 */
export function statBonuses(text: string): { stats: string[]; value: number; pct: boolean }[] {
  const out: { stats: string[]; value: number; pct: boolean }[] = [];
  for (const piece of plain(text).split('\n')[0].split(/,\s*/)) {
    const m = piece.trim().match(/^(?:Operator\s+)?([A-Za-z][A-Za-z &.'-]*?)\s*\+\s*(\d+(?:\.\d+)?)(%?)\.?$/);
    if (!m) continue;
    const stats = /^all attributes$/i.test(m[1]) ? ATTRIBUTES : m[1].split(/\s+and\s+/);
    out.push({ stats, value: Number(m[2]), pct: !!m[3] });
  }
  return out;
}

/**
 * Bonuses by stat name, as the Attributes card names them (HP, ATK, DEF,
 * Strength..., Critical rate; anything else keeps the game's name):
 *
 * - talents' attribute stages ("Operator Intellect +10"), all of them, as an
 *   operator at Lv 90 (Elite 4) has every stage;
 * - Potentials up to `potential` (the player's copies; none without them);
 * - the weapon's base ATK at `level` (the card's level) and the plain stat
 *   part of each skill ("Intellect +{0}", "Secondary attribute +{0}%") at
 *   its rank: as set, else the highest it can reach at its tuning stage and
 *   Potential (weaponBounds); base ATK at the weapon's `level` when given;
 * - each gear piece's DEF and stats at its Artifice level (the highest
 *   unless set; values under 1 are fractions, so percents), and the stat
 *   part of 3-piece set effects ("Wearer's HP +1000").
 *
 * "Main/Secondary Attribute" go to the operator's own.
 */
export function operatorBonuses(
  op: BonusOperator,
  opts: {
    potential?: number | null;
    loadout?: Loadout | null;
    /**
     * `ranks`: each skill's rank as set (missing: the highest it can reach, see weaponBounds), at tuning `stage` of
     * `tuning` (unset: fully tuned); `level`: the weapon's level for its base ATK (else the operator's).
     */
    weapon?: { w: WikiWeapon; potential: number | null; ranks?: (number | null | undefined)[]; tuning?: WeaponTuning; stage?: number; level?: number } | null;
    items?: Record<string, WikiGear>;
    sets?: Record<string, WikiGearSet>;
    level?: number;
  } = {},
): Map<string, Bonus> {
  const { potential = null, loadout: l = null, weapon = null, items = {}, sets = {}, level = 90 } = opts;
  const out = new Map<string, Bonus>();
  const name = (stat: string): string | null => {
    const s = stat.trim().toLowerCase();
    if (s === 'main attribute') return op.mainAttribute;
    if (s === 'secondary attribute') return op.secondaryAttribute;
    if (s === 'attack' || s === 'atk') return 'ATK';
    if (s === 'hp' || s === 'max hp') return 'HP';
    if (s === 'def' || s === 'defense') return 'DEF';
    if (s === 'critical rate') return 'Critical rate';
    return stat.trim().replace(/^\w/, (c) => c.toUpperCase());
  };
  const add = (stat: string, from: string, flat: number, pct: number) => {
    const key = name(stat);
    if (!key || (!flat && !pct)) return;
    const b = out.get(key) ?? { flat: 0, pct: 0, sources: [] };
    b.flat += flat;
    b.pct += pct;
    b.sources.push({ from, flat, pct });
    out.set(key, b);
  };

  for (const t of op.talents) {
    t.levels.forEach((lv, i) => {
      for (const b of statBonuses(lv.description)) {
        if (!/^Operator\s/.test(lv.description)) continue;
        for (const st of b.stats) add(st, `Talent: ${t.name}${t.levels.length > 1 ? ` ${i + 1}` : ''}`, b.pct ? 0 : b.value, b.pct ? b.value : 0);
      }
    });
  }
  for (const p of op.potentials) {
    if (potential == null || p.rank > potential) continue;
    for (const b of statBonuses(p.description)) {
      for (const st of b.stats) add(st, `P${p.rank}: ${p.name}`, b.pct ? 0 : b.value, b.pct ? b.value : 0);
    }
  }

  if (weapon) {
    const { w, potential: wp, ranks } = weapon;
    const caps = weaponRankCaps(w, wp, weapon.tuning, weapon.stage);
    const s = w.stats;
    if (s) {
      let at = s.levels.indexOf(weapon.level ?? level);
      if (at < 0) at = s.levels.length - 1;
      const atk = s.baseAtk[at];
      if (atk != null) add('ATK', `${w.name} (base ATK)`, atk, 0);
    }
    w.skills.forEach((sk, i) => {
      // The stat a skill always gives: its text opens with "Stat +{0}" or "+{0}%".
      const m = sk.text?.match(/^([A-Za-z][A-Za-z &.'-]*?)\s*⟦num\|\+\{0\}(%?)⟧/);
      if (!m) return;
      const rank = Math.min(ranks?.[i] ?? caps[i], caps[i]);
      const v = sk.values[0]?.[Math.min(rank, sk.values[0].length) - 1];
      if (v == null) return;
      add(m[1], `${w.name}: ${sk.name} (rank ${rank})`, m[2] ? 0 : v, m[2] ? v : 0);
    });
  }

  for (const { slot } of GEAR_SLOTS) {
    const g = l?.[slot] ? items[l[slot]!] : undefined;
    if (!g) continue;
    if (g.defense) add('DEF', g.name, g.defense, 0);
    const lv = artificeOf(l!, slot, g);
    const from = lv.some((x) => x) ? `${g.name} (Artifice ${lv.join('/')})` : g.name;
    for (const [i, st] of g.stats.entries()) {
      const v = st.values[Math.min(lv[i], st.values.length - 1)];
      if (v == null) continue;
      if (v < 1) add(st.stat, from, 0, Math.round(v * 1000) / 10);
      else add(st.stat, from, v, 0);
    }
  }
  if (l) {
    for (const [name, n] of setCounts(l, items)) {
      const set = sets[name];
      if (n < SET_PIECES || !set) continue;
      const line = set.effect.split('\n')[0].replace(/^\d+-piece set effect:\s*/i, '').replace(/\bWearer's\s+/gi, '');
      for (const b of statBonuses(line)) {
        for (const st of b.stats) add(st, `${name} set (${SET_PIECES} pieces)`, b.pct ? 0 : b.value, b.pct ? b.value : 0);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Totals, as the game's Attributes & Stats screen works them out
// ---------------------------------------------------------------------------

/** ATK % per point of the main and the secondary attribute (the game's "Attribute Bonuses"). */
export const MAIN_ATTRIBUTE_ATK = 0.5;
export const SECONDARY_ATTRIBUTE_ATK = 0.2;

/** A stat with its bonus: (base + flat) × (1 + %). */
export const statTotal = (base: number, b?: Bonus): number => (base + (b?.flat ?? 0)) * (1 + (b?.pct ?? 0) / 100);

/**
 * ATK the way the game's breakdown shows it: Base ATK (operator + weapon,
 * the weapon being a flat bonus) times the ATK % bonuses is the Basic
 * Total, then the Attribute Bonuses multiply that: 0.5% per point of the
 * main attribute and 0.2% per point of the secondary (both totals).
 * Arcane: (312 + 505) × 1.256 = 1026, × (1 + 430 × 0.5% + 765 × 0.2%) = 4802.
 */
export function atkTotal(operatorAtk: number, atk: Bonus | undefined, main: number, secondary: number) {
  const base = operatorAtk + (atk?.flat ?? 0);
  const basic = base * (1 + (atk?.pct ?? 0) / 100);
  const fromMain = main * MAIN_ATTRIBUTE_ATK;
  const fromSecondary = secondary * SECONDARY_ATTRIBUTE_ATK;
  return { base, basic, fromMain, fromSecondary, total: basic * (1 + (fromMain + fromSecondary) / 100) };
}

/** HP per point of Strength (the game's "HP from STR"). */
export const HP_PER_STRENGTH = 5;
/** Treatment Received Bonus (%) per point of Will. */
export const TREATMENT_PER_WILL = 0.1;

/**
 * HP the way the game's breakdown shows it: Base HP (operator HP + 5 per
 * point of Strength) plus Others (flat HP from gear and the like), with HP %
 * bonuses on top. Arcane: 5495 + 91 × 5 + 1000 = 6950.
 */
export function hpTotal(operatorHp: number, hp: Bonus | undefined, strength: number) {
  const fromStrength = strength * HP_PER_STRENGTH;
  const base = operatorHp + fromStrength;
  const others = hp?.flat ?? 0;
  return { base, fromStrength, others, total: (base + others) * (1 + (hp?.pct ?? 0) / 100) };
}

/** Final DMG Reduction (%) from DEF: DEF / (DEF + 100). 140 DEF → 58.3%. */
export const defReduction = (def: number): number => (def / (def + 100)) * 100;
