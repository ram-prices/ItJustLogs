/**
 * An operator's build for the simulator: level, weapon (level, Potential,
 * skill levels) and gear (each piece's Artifice per stat), turned into the
 * fight's Stats and the passive skills the weapon and gear sets add, from
 * ef-assets combat/ops/<operator>.json (base), combat/weapons/<id>.json and
 * combat/gear.json. Pure logic.
 */
import type { Bundle, Data, Mod, Stats } from './engine';

export interface WeaponData {
  weapon: string;
  /** Two attribute skills, then the weapon's own. */
  skillList: string[];
  /** Each skill's level cap at full promotion. */
  maxSkillLevels: number[];
  /** Levels each Potential (1–5) adds to each skill. */
  potentialLevels: number[][];
  baseAtk: Record<string, number>;
  skills: Record<string, Data>;
  buffs: Record<string, Data>;
  patch: Bundle['patch'];
}

export interface GearData {
  items: Record<string, { suit: string | null; part: number | string; level: number; stats: { attr: string; how: string; values: number[] }[] }>;
  /** Each set's effects by pieces worn. */
  sets: Record<string, { pieces: number; skill: string; level: number }[]>;
  skills: Record<string, Data>;
  buffs: Record<string, Data>;
  patch: Bundle['patch'];
}

/** The base attributes ef-assets keeps per operator. */
export interface Base {
  main: string;
  sub: string;
  levels: Record<string, Record<string, number>>;
  /** Attribute talents ("Forged": Strength +10/+15/+15/+20), each with the promotion it needs. */
  nodes?: { stage: number; attrs: { attr: string; value: number }[] }[];
  /** Each talent level's promotion (CharGrowthTable); a level not listed isn't obtainable. */
  talentStages?: Record<string, number>;
}

export interface Build {
  level?: number;
  /** Promotions (0–4); attribute talents need them. */
  promotion?: number;
  weapon?: { id: string; level?: number; potential?: number; skillLevels?: number[] };
  /**
   * Gear pieces by item id, with each stat's Artifice level (0–3, the stats in the game's order; gear.json's DEF row
   * before them takes none). One number: every stat at that level (requests and runs from before per-stat Artifice).
   */
  gear?: { id: string; artifice?: number | number[] }[];
}

/** One stat's Artifice level from a build's `artifice` (a list per stat, or one number for all). */
export const statArtifice = (artifice: number | number[] | undefined, stat: number): number =>
  (Array.isArray(artifice) ? artifice[stat] : artifice) ?? 0;

/** The operator's bundle with its weapon's and sets' skills, and its Stats. */
export function equip(op: Bundle & { base?: Base }, build: Build, weapon?: WeaponData, gear?: GearData): { bundle: Bundle; stats: Stats } {
  const level = build.level ?? 90;
  const base = op.base;
  const row = base?.levels[level] ?? {};
  const attributes: Record<string, number> = { ...row };
  for (const node of base?.nodes ?? []) if (node.stage <= (build.promotion ?? 4)) for (const a of node.attrs) attributes[a.attr] = (attributes[a.attr] ?? 0) + a.value;
  const mods: Mod[] = [];
  const passives: string[] = [];
  const levels: Record<string, number> = {};
  const merged: Bundle = { ...op, skills: { ...op.skills }, buffs: { ...op.buffs }, patch: { ...op.patch } };
  // Only the talent levels its promotion has unlocked (World.start takes the highest of those); bundles from before
  // talentStages keep every level.
  const stages = base?.talentStages;
  if (stages && merged.talents)
    merged.talents = Object.fromEntries(Object.entries(merged.talents).filter(([id]) => !/_talent_\d+_\d+$/.test(id) || (stages[id] ?? Infinity) <= (build.promotion ?? 4)));
  const add = (from: { skills: Record<string, Data>; buffs: Record<string, Data>; patch: Bundle['patch'] }) => {
    Object.assign(merged.skills, from.skills);
    Object.assign(merged.buffs, from.buffs);
    Object.assign(merged.patch, from.patch);
  };

  if (weapon && build.weapon) {
    const w = build.weapon;
    attributes.Atk = (attributes.Atk ?? 0) + (weapon.baseAtk[w.level ?? 90] ?? 0);
    const extra = w.potential ? (weapon.potentialLevels[w.potential - 1] ?? []) : [];
    weapon.skillList.forEach((id, i) => {
      // Unless given, every skill at its cap (full essences), plus what the Potential adds.
      levels[id] = (w.skillLevels?.[i] ?? weapon.maxSkillLevels[i] ?? 1) + (extra[i] ?? 0);
      passives.push(id);
    });
    add(weapon);
  }

  if (gear) {
    const worn = new Map<string, number>();
    for (const g of build.gear ?? []) {
      const item = gear.items[g.id];
      if (!item) continue;
      if (item.suit) worn.set(item.suit, (worn.get(item.suit) ?? 0) + 1);
      // DEF (the same at every level) comes first; the stats after it are the game's three, each artificed on its own.
      let k = 0;
      for (const st of item.stats) {
        const attributeType = st.attr === 'Main' ? (base?.main ?? '') : st.attr === 'Sub' ? (base?.sub ?? '') : st.attr;
        const level = st.attr === 'Def' ? 0 : statArtifice(g.artifice, k++);
        mods.push({ attributeType, formulaItem: st.how, value: st.values[Math.max(0, Math.min(st.values.length - 1, level))] ?? 0 });
      }
    }
    for (const [suit, n] of worn)
      for (const effect of gear.sets[suit] ?? [])
        if (n >= effect.pieces) {
          passives.push(effect.skill);
          levels[effect.skill] = effect.level;
        }
    add(gear);
  }

  merged.passives = [...(op.passives ?? []), ...passives];
  merged.levels = { ...op.levels, ...levels };
  return { bundle: merged, stats: { level, main: base?.main ?? 'Str', sub: base?.sub ?? 'Agi', attributes, mods } };
}
