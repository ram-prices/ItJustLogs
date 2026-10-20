import type { Bonus } from './loadout';
import type { WikiOperator, WikiSkill } from './wiki';

/**
 * How Potentials and the player's loadout change an operator's combat
 * skills, for the skill tables:
 * - Potentials that improve a skill in one of the game's fixed phrasings:
 *   "Ultimate Energy cost -15%", "Length of cooldown -2s", "DMG Multiplier
 *   is increased to 1.3 times the original" (applied to that skill's
 *   matching row). Other improvements (radius, shields, extra SP...) aren't
 *   numbers in the table and stay as the Potential's text.
 * - Skill DMG bonuses from gear, sets and the weapon (Battle Skill DMG
 *   Bonus, All Skill DMG, a set's "Skill DMG +24%"...), as a DMG bonus row.
 */

/** One change to a skill value: times `value` (mult), plus `value` (add). */
export interface ValueMod {
  from: string;
  kind: 'mult' | 'add';
  value: number;
}

/** The game's skill type names as Potentials write them. */
const TYPE_WORDS: Record<string, string> = {
  'basic attack': 'Basic Attack',
  'battle skill': 'Battle Skill',
  'combo skill': 'Combo Skill',
  ultimate: 'Ultimate',
};

const plain = (s: string) => s.replace(/⟦[^|⟧]*\|([^⟧]*)⟧/g, '$1');

/**
 * Value changes per skill (by `${type}:${name}`) and row label, from the
 * Potentials up to `potential` (none when null).
 */
export function potentialSkillMods(o: Pick<WikiOperator, 'potentials' | 'skills'>, potential: number | null): Map<string, Map<string, ValueMod[]>> {
  const out = new Map<string, Map<string, ValueMod[]>>();
  if (potential == null) return out;
  for (const p of o.potentials) {
    if (p.rank > potential) continue;
    const text = plain(p.description);
    const head = text.match(/^(Basic attack|Battle skill|Combo skill|Ultimate)\s+(.+?)\s+improved:/i);
    if (!head) continue;
    const type = TYPE_WORDS[head[1].toLowerCase()];
    // The skills it means: that type, named in the Potential (both sets for operators with two).
    const skills = o.skills.filter((s) => s.type === type && head[2].includes(s.name));
    if (!skills.length) continue;
    const from = `P${p.rank}: ${p.name}`;
    // Each rule picks the rows it changes and how (the row's first value tells a % row from a plain one).
    const rules: { rows: (label: string) => boolean; mod: (sample: string) => ValueMod }[] = [];
    const rule = (rows: (label: string) => boolean, mod: (sample: string) => ValueMod) => rules.push({ rows, mod });
    const handled = /Ultimate Energy cost|Length of cooldown|DMG Multiplier/i;

    const cost = text.match(/Ultimate Energy cost\s*-\s*(\d+(?:\.\d+)?)%/i);
    if (cost) rule((l) => /^Ultimate Energy Cost$/i.test(l), () => ({ from, kind: 'mult', value: 1 - Number(cost[1]) / 100 }));
    const cd = text.match(/Length of cooldown\s*-\s*(\d+(?:\.\d+)?)s/i);
    if (cd) rule((l) => /^Cooldown$/i.test(l), () => ({ from, kind: 'add', value: -Number(cd[1]) }));
    // "DMG Multiplier is increased to 1.3 times": every DMG multiplier row of the skill (Base, Explosion...).
    const dmg = text.match(/(?:^|[.:;]\s*)DMG Multiplier is increased to (\d+(?:\.\d+)?) times the original/i);
    if (dmg) rule((l) => /DMG Multiplier$/i.test(l), () => ({ from, kind: 'mult', value: Number(dmg[1]) }));
    // "DMG Multiplier of Gloompurge Arcana (ultimate sequence 2) is increased to 1.3 times": that part's rows.
    for (const m of text.matchAll(/DMG Multiplier of ([A-Za-z][\w' -]*?)\s*(?:\([^)]*\))?\s+is increased to (\d+(?:\.\d+)?) times the original/gi)) {
      const part = new RegExp(`^${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*DMG Multiplier$`, 'i');
      rule((l) => part.test(l), () => ({ from, kind: 'mult', value: Number(m[2]) }));
    }

    // The rest, sentence by sentence, matched to rows by their words: "Electrification duration +75%"
    // (Electrify Duration), "Shield duration +3s", "Duration of the Solidification applied by the skill
    // is increased by 2s", "<thing> is increased to 1.33 times the original".
    const body = text.slice(text.indexOf('improved:') + 'improved:'.length);
    for (let sentence of body.split(/\n|(?<=[.;])\s+/)) {
      sentence = sentence.replace(/^[^:]{1,40}:\s+(?=[A-Z])/, '').replace(/[.;]\s*$/, '').trim();
      if (!sentence || handled.test(sentence)) continue;
      let phrase: string | null = null;
      let value = 0;
      let unit = '';
      let times = false;
      let m: RegExpMatchArray | null;
      if ((m = sentence.match(/^Duration of (?:the )?(.+?) applied by the skills? is increased by (\d+(?:\.\d+)?)(%|s)$/i))) [phrase, value, unit] = [`${m[1]} duration`, Number(m[2]), m[3]];
      else if ((m = sentence.match(/^(?:the )?(.+?) (?:is|are) (?:increased|multiplied) to (\d+(?:\.\d+)?) times(?: the original)?$/i))) [phrase, value, times] = [m[1], Number(m[2]), true];
      else if ((m = sentence.match(/^(?:the )?([A-Za-z][A-Za-z' -]{1,40}?)\s*\+\s*(\d+(?:\.\d+)?)(%|s)?$/i))) [phrase, value, unit] = [m[1], Number(m[2]), m[3] ?? ''];
      if (!phrase) continue;
      const words = phrase;
      rule(
        (l) => wordsMatch(words, l),
        (sample) =>
          times
            ? { from, kind: 'mult', value }
            : unit === '%' && !sample.trim().endsWith('%')
              ? { from, kind: 'mult', value: 1 + value / 100 }
              : { from, kind: 'add', value },
      );
    }

    // Operators with two skill sets list the same skill twice: change it once.
    const seen = new Set<string>();
    for (const s of skills) {
      const key = `${s.type}:${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const byLabel = out.get(key) ?? new Map<string, ValueMod[]>();
      // Every row of the skill, in either of its sets; each row takes each change once.
      const rows = new Map(o.skills.filter((x) => x.type === s.type && x.name === s.name).flatMap((x) => x.values.map((v) => [v.label, v.ranks[0] ?? ''] as const)));
      for (const [label, sample] of rows) {
        for (const r of rules) if (r.rows(label)) byLabel.set(label, [...(byLabel.get(label) ?? []), r.mod(sample)]);
      }
      if (byLabel.size) out.set(key, byLabel);
    }
  }
  return out;
}

/** Words that say nothing about which row a Potential means. */
const FILLER = new Set(['the', 'of', 'a', 'an', 'by', 'skill', "skill's", 'skills', 'applied', 'on', 'enemy', 'to', 'effect', 'effects']);
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z']+/)
    .filter((w) => w && !FILLER.has(w));

/**
 * Whether a Potential's phrase names a row: each of its words matches a word
 * of the label, allowing for word forms (Electrification / Electrify: a
 * shared start of at least 6 letters, or the whole shorter word).
 */
export function wordsMatch(phrase: string, label: string): boolean {
  const want = wordsOf(phrase);
  const have = wordsOf(label);
  if (!want.length) return false;
  const same = (a: string, b: string) => {
    if (a === b) return true;
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n >= Math.min(6, a.length, b.length) && n >= 4;
  };
  // "Physical Susceptibility +5%" is the stat, not how long it lasts.
  if (have.includes('duration') && !want.includes('duration')) return false;
  return want.every((w) => have.some((h) => same(w, h)));
}

/** Which skill types each DMG bonus stat covers ("Skill DMG" is every skill, not basic attacks). */
const DMG_BONUS: Record<string, string[]> = {
  'basic attack dmg bonus': ['Basic Attack'],
  'battle skill dmg bonus': ['Battle Skill'],
  'combo skill dmg bonus': ['Combo Skill'],
  'ultimate dmg bonus': ['Ultimate'],
  'all skill dmg': ['Battle Skill', 'Combo Skill', 'Ultimate'],
  'skill dmg': ['Battle Skill', 'Combo Skill', 'Ultimate'],
};

/** The DMG bonus (%) a skill gets from the player's bonuses (gear, sets, weapon), with its sources. */
export function skillDmgBonus(skill: Pick<WikiSkill, 'type'>, bonuses: Map<string, Bonus> | null): { pct: number; sources: { from: string; pct: number }[] } | null {
  let pct = 0;
  const sources: { from: string; pct: number }[] = [];
  for (const [stat, b] of bonuses ?? []) {
    if (!DMG_BONUS[stat.toLowerCase()]?.includes(skill.type) || !b.pct) continue;
    pct += b.pct;
    for (const s of b.sources) if (s.pct) sources.push({ from: `${s.from} (${stat})`, pct: s.pct });
  }
  return pct ? { pct, sources } : null;
}

/** A shown skill value ("142%", "18", "7.5") with changes applied, or null if it isn't a number. */
export function applyMods(shown: string, mods: ValueMod[]): string | null {
  const m = shown.trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  let n = Number(m[1]);
  for (const mod of mods) n = mod.kind === 'mult' ? n * mod.value : n + mod.value;
  return `${Math.round(n * 100) / 100}${m[2]}`;
}

/** Whether a change helps: lower costs and cooldowns, higher everything else. */
export const isGain = (label: string, mods: ValueMod[]): boolean => {
  const lowerIsBetter = /cost|cooldown/i.test(label);
  const up = mods.reduce((n, m) => (m.kind === 'mult' ? n * m.value : n), 1) > 1 || mods.some((m) => m.kind === 'add' && m.value > 0);
  return lowerIsBetter ? !up : up;
};
