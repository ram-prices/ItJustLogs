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

// ---------------------------------------------------------------------------
// Short links: itjustlogs.dev/<operator name>
// ---------------------------------------------------------------------------

/** Top-level paths the app or its files already use; no short link may take one. */
export const RESERVED_PATHS = new Set(['operators', 'arsenal', 'stats', 'settings', 'privacy', 'assets', 'icons', 'info', 'home', '404', 'index', 'banners', 'events']);

/** "Zhuang Fangyi" → "zhuang-fangyi", "Si" → "si". */
export const nameSlug = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents left over by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Operators that share a name. The two Endministrators each get a suffixed
 * link, and the plain one opens the female, the default in Extra copies.
 */
const SHARED_NAME_SLUGS: Record<string, string[]> = {
  chr_0003_endminf: ['endministrator', 'endministrator-female'],
  chr_0002_endminm: ['endministrator-male'],
};

/**
 * Short link → operator id, for every operator: its name as a slug (/si,
 * /chen-qianyu). Names shared by several operators only get the links in
 * SHARED_NAME_SLUGS; names that clash with a page (RESERVED_PATHS) get none.
 */
export function operatorShortLinks(operators: Record<string, { name: string }>): Map<string, string> {
  const byName = new Map<string, string[]>();
  for (const [id, o] of Object.entries(operators)) {
    const slug = nameSlug(o.name);
    if (slug) byName.set(slug, [...(byName.get(slug) ?? []), id]);
  }
  const out = new Map<string, string>();
  for (const [slug, ids] of byName) {
    if (ids.length === 1 && !RESERVED_PATHS.has(slug)) out.set(slug, ids[0]);
  }
  for (const [id, slugs] of Object.entries(SHARED_NAME_SLUGS)) {
    if (operators[id]) for (const s of slugs) out.set(s, id);
  }
  return out;
}

/** What a short link opens. */
export interface ShortTarget {
  kind: 'char' | 'weap';
  id: string;
}

/**
 * Short links for every operator (operatorShortLinks) and weapon
 * (/lunar-calling). An operator keeps a name it shares with a weapon; weapons
 * that share a name, or would take a page path, get none.
 */
export function itemShortLinks(operators: Record<string, { name: string }>, weapons: Record<string, { name: string }>): Map<string, ShortTarget> {
  const out = new Map<string, ShortTarget>();
  for (const [slug, id] of operatorShortLinks(operators)) out.set(slug, { kind: 'char', id });
  const count = new Map<string, number>();
  for (const w of Object.values(weapons)) count.set(nameSlug(w.name), (count.get(nameSlug(w.name)) ?? 0) + 1);
  for (const [id, w] of Object.entries(weapons)) {
    const slug = nameSlug(w.name);
    if (slug && count.get(slug) === 1 && !RESERVED_PATHS.has(slug) && !out.has(slug)) out.set(slug, { kind: 'weap', id });
  }
  return out;
}

/** An item's own short link (the first one that opens it), if it has one. */
export function shortLinkOf(links: Map<string, string | ShortTarget>, id: string): string | null {
  for (const [slug, target] of links) if ((typeof target === 'string' ? target : target.id) === id) return slug;
  return null;
}

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
