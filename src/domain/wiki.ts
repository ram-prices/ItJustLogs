/**
 * Operator and weapon data from the community wiki (endfield.wiki.gg),
 * snapshotted into ef-assets wiki/*.json by its scripts/update-wiki.mjs.
 * CC BY-SA 4.0: wherever it's shown, credit the wiki (see `attribution`).
 *
 * Text fields use a small markup instead of HTML so they can be escaped:
 * `**bold**`, `⟦class|text⟧` highlights and `\n` line breaks.
 */

export interface WikiAttribution {
  source: string;
  url: string;
  license: string;
  licenseUrl: string;
  note: string;
  fetched: string;
}

export interface WikiCost {
  item: string;
  count: number;
}

export interface WikiSkill {
  name: string;
  type: string;
  /** Skill set this belongs to, for operators that switch sets (Arcane's stances). */
  variant?: string;
  description: string;
  info?: string;
  /** One row per stat, `ranks` holds ranks 1–12 as shown ("142%", "7.5"). */
  values: { label: string; ranks: string[] }[];
}

export interface WikiOperator {
  name: string;
  rarity: number;
  class: string;
  element: string;
  weapon: string;
  faction: string | null;
  race: string | null;
  gender: string | null;
  birthday: string | null;
  tags: string[];
  mainAttribute: string | null;
  secondaryAttribute: string | null;
  headhunting: string | null;
  quote: string | null;
  profile: string | null;
  expertise: string[];
  hobbies: string[];
  gift: string | null;
  stats: {
    levels: { level: number; promotion: number }[];
    hp: number[] | null;
    atk: number[] | null;
    strength: number[] | null;
    agility: number[] | null;
    intellect: number[] | null;
    will: number[] | null;
    critRate: number | null;
    attackSpeed: number | null;
    range: string | null;
  } | null;
  potentials: { rank: number; name: string; description: string }[];
  promotions: { stage: number; cost: WikiCost[] }[];
  skills: WikiSkill[];
  talents: { name: string; levels: { requires: string; description: string }[] }[];
  baseSkills: { name: string; facility: string; levels: { grade: string; requires: string; description: string }[] }[];
  page: string;
}

export interface WikiOperatorFile {
  attribution: WikiAttribution;
  operators: Record<string, WikiOperator>;
}

/** Game ids the wiki files under another id. */
export const WIKI_ALIASES: Record<string, string> = { chr_0034_typhoeus: 'chr_0034_typhoea' };

export const wikiId = (itemId: string): string => WIKI_ALIASES[itemId] ?? itemId;

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'mark'; cls: string; text: string }
  | { kind: 'break' };

const TOKEN = /\*\*(.+?)\*\*|⟦(\w+)\|([^⟧]*)⟧|\n/g;

/** Splits wiki markup into plain segments; never produces HTML. */
export function parseMarkup(s: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1].replace(/⟦\w+\|([^⟧]*)⟧/g, '$1') });
    else if (m[2] !== undefined) out.push({ kind: 'mark', cls: m[2], text: m[3] });
    else out.push({ kind: 'break' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

/** Skills grouped by `variant`, in the wiki's order (one group with no name for most operators). */
export function skillSets(skills: WikiSkill[]): { variant: string | null; skills: WikiSkill[] }[] {
  const sets: { variant: string | null; skills: WikiSkill[] }[] = [];
  for (const s of skills) {
    const v = s.variant ?? null;
    const set = sets.find((x) => x.variant === v);
    if (set) set.skills.push(s);
    else sets.push({ variant: v, skills: [s] });
  }
  return sets;
}

export interface WikiWeaponSkill {
  name: string;
  tag: string | null;
  /** Markup with {0}, {1}... standing for `values[0]`, `values[1]`... at the current rank. */
  text: string | null;
  /** One column per placeholder, ranks 1–9. */
  values: number[][];
}

export interface WikiWeapon {
  name: string;
  rarity: number;
  type: string;
  source: string | null;
  description: string[];
  stats: { levels: number[]; baseAtk: (number | null)[] } | null;
  potential: string | null;
  tuning: { stage: number; cost: WikiCost[] }[];
  skills: WikiWeaponSkill[];
  page: string;
}

export interface WikiWeaponFile {
  attribution: WikiAttribution;
  weapons: Record<string, WikiWeapon>;
}

/** "ATK +{0}%" → ['ATK +', 0, '%']: text pieces and placeholder indexes. */
export function splitPlaceholders(s: string): (string | number)[] {
  return s.split(/\{(\d+)\}/).map((part, i) => (i % 2 ? Number(part) : part)).filter((p) => p !== '');
}

/** Weapon skill numbers as the game shows them: 12.00 → 12, 5.56 → 5.56. */
export const fmtSkillValue = (v: number | undefined): string => (v === undefined ? '–' : String(Math.round(v * 100) / 100));
