import type { WikiOperator } from './wiki';

/**
 * Ultimate energy, for "how much Ultimate Gain Efficiency do I need?"
 * Rules (endfield.wiki.gg, Ultimate Energy): every battle skill cast gives
 * the whole team 6.5 energy per 100 SP spent (SP a skill returned doesn't
 * count); combo skills give only their caster energy, 10 for most; Ultimate
 * Gain Efficiency multiplies what's gained. A rotation here is the battle
 * skills (anyone's) and the operator's own combo skills between two of
 * their ultimates.
 */

/** Energy each battle skill (100 SP) gives every teammate. */
export const TEAM_ENERGY_PER_BATTLE_SKILL = 6.5;

export interface UltimateEnergy {
  /** Energy the ultimate costs, after Potential cuts. */
  cost: number;
  /** The cost before them, when a Potential cuts it. */
  baseCost: number;
  /** Energy each of the operator's own combo skills gives them. */
  comboGain: number;
  /** Whether teammates' battle skills give this operator energy (not for Last Rite). */
  teamEnergy: boolean;
  /** Energy sources the table doesn't count (hit- or stack-dependent), as "Skill: label +n". */
  extras: string[];
}

const plain = (s: string) => s.replace(/⟦[^|⟧]*\|([^⟧]*)⟧/g, '$1');
const num = (s: string | undefined) => (s == null ? NaN : parseFloat(s.replace(/[^\d.-]/g, '')));
/** A skill value at its top rank. */
const top = (v: { ranks: string[] }) => num(v.ranks[v.ranks.length - 1]);

/** Combo-skill gains that make up one cast: the plain one, a base one, each sequence's, or the 1-enemy one. */
const COMBO_GAIN = /^(?:(?:Base|SEQ \d+) )?Ultimate Energy Gain(?: when Hitting 1 Enemy)?$/;

/** The operator's ultimate energy numbers at Potential `potential` (none counted when null). */
export function ultimateEnergy(o: WikiOperator, potential: number | null): UltimateEnergy | null {
  // Operators with two skill sets (Arcane) list each skill twice; the numbers match, so take the first.
  const first = (type: string) => o.skills.find((s) => s.type === type);
  const ult = first('Ultimate');
  const costValue = ult?.values.find((v) => v.label === 'Ultimate Energy Cost');
  const baseCost = costValue ? top(costValue) : NaN;
  if (!Number.isFinite(baseCost) || baseCost <= 0) return null;

  let cut = 0;
  for (const p of o.potentials) {
    if (potential == null || p.rank > potential) continue;
    const m = plain(p.description).match(/Ultimate Energy cost\s*-\s*(\d+(?:\.\d+)?)%/i);
    if (m) cut += Number(m[1]);
  }

  const combo = first('Combo Skill');
  const extras: string[] = [];
  let comboGain = 0;
  for (const v of combo?.values ?? []) {
    if (!/Ultimate Energy/i.test(v.label)) continue;
    const n = top(v);
    if (!Number.isFinite(n)) continue;
    if (COMBO_GAIN.test(v.label)) comboGain += n;
    else if (!/when Hitting [23]/.test(v.label)) extras.push(`${combo!.name}: ${v.label} +${n}`);
  }
  for (const s of o.skills.filter((x) => x.type === 'Battle Skill').slice(0, 1)) {
    for (const v of s.values) {
      if (!/Ultimate Energy/i.test(v.label)) continue;
      const n = top(v);
      if (Number.isFinite(n)) extras.push(`${s.name}: ${v.label} +${n}`);
    }
  }
  // Talents and Potentials that grant energy on their own triggers.
  for (const t of o.talents) {
    const d = plain(t.levels[t.levels.length - 1]?.description ?? '');
    if (/gains? \d+(?:\.\d+)? Ultimate Energy/i.test(d)) extras.push(`${t.name} (talent)`);
  }
  const text = [...o.skills.map((s) => s.description), ...o.talents.flatMap((t) => t.levels.map((l) => l.description))].map(plain).join('\n');
  const teamEnergy = !/can only gain Ultimate Energy from (?:her|his|their) own/i.test(text);

  return { cost: baseCost * (1 - cut / 100), baseCost, comboGain, teamEnergy, extras };
}

/** Energy a rotation of `battleSkills` battle skills and `combos` own combo skills gives, before Ultimate Gain Efficiency. */
export const rotationEnergy = (u: UltimateEnergy, battleSkills: number, combos: number): number =>
  (u.teamEnergy ? battleSkills * TEAM_ENERGY_PER_BATTLE_SKILL : 0) + combos * u.comboGain;

/**
 * Ultimate Gain Efficiency bonus (in %, on top of the base 100%) needed for
 * that rotation to fill the ultimate: cost ÷ energy − 1. 0 when it already
 * does; Infinity when the rotation gives no energy.
 */
export function requiredGain(u: UltimateEnergy, battleSkills: number, combos: number): number {
  const e = rotationEnergy(u, battleSkills, combos);
  if (e <= 0) return Infinity;
  return Math.max(0, (u.cost / e - 1) * 100);
}
