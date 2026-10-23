import { nameSlug } from './wiki';

/**
 * The game's story text: ef-assets story/ (its scripts/story.mjs, from the
 * EndfieldData community dump). index.json lists every mission with
 * dialogue, grouped and ordered as the wiki's mission pages list them; each
 * mission's lines are in its own file, fetched when its page opens.
 */

export interface StoryAttribution {
  source: string;
  url: string;
  dumper: string;
  fetched: string;
  note: string;
}

export interface StorySection {
  title: string;
  /** Not in the wiki's index yet: possibly unreleased, so spoilers. */
  unlisted?: boolean;
  missions: string[];
}

export interface StoryGroup {
  title: string;
  sections: StorySection[];
}

export interface StoryMissionInfo {
  name: string;
  lines: number;
  scenes: number;
  /** Some lines have no English text yet. */
  partial?: boolean;
}

export interface StoryIndex {
  attribution: StoryAttribution;
  groups: StoryGroup[];
  missions: Record<string, StoryMissionInfo>;
  /** Each event's own missions, by the event's English name (the game's activity table). */
  activities?: Record<string, string[]>;
}

export interface StoryLine {
  /** Who says it; none for narration. */
  who?: string;
  /** The speaker's operator id, when they're one (their portrait). */
  actor?: string;
  text: string;
  /** The wording for the male Endministrator, where it differs. */
  textM?: string;
}

export interface StoryScene {
  id: string;
  /** The game's own summary of the scene. */
  summary?: string;
  lines: StoryLine[];
  /** The replies the player can pick in the scene, by choice. */
  options?: string[][];
  /** The order the scene plays in, from the game's dialogue tree (where it's known). */
  flow?: StoryFlow;
}

/**
 * A scene in play order: a number is a line (its index in `lines`);
 * { r } a choice, each reply with the lines it leads to; "back" a return to
 * the last choice; "end" the end of the conversation (in a branch); { v }
 * the ways the scene can go, `w` naming each (a
 * condition: "Once … is done" / "Before that"); an empty way adds nothing.
 */
export type StoryFlow = (number | 'back' | 'end' | { r: [string, StoryFlow][] } | { v: StoryFlow[]; w?: string[] })[];

/** The lines a flow shows, by index. */
export function flowLines(flow: StoryFlow, into = new Set<number>()): Set<number> {
  for (const x of flow) {
    if (typeof x === 'number') into.add(x);
    else if (typeof x === 'string') continue;
    else if ('r' in x) for (const [, then] of x.r) flowLines(then, into);
    else for (const v of x.v) flowLines(v, into);
  }
  return into;
}

export interface StoryMission {
  id: string;
  name: string;
  partial?: boolean;
  scenes: StoryScene[];
}

/** story/search.json: every line as plain text ("Who: text"), by mission, then scene. */
export type StorySearch = Record<string, string[][]>;

/** A line's place on its mission's page (the id of its row: scene and line, from 0). */
export const lineAnchor = (scene: number, line: number): string => `l-${scene}-${line}`;

/** A group's or section's place on the Story list (its row's id): s-<group>[-<section>]. */
export const sectionAnchor = (group: string, section = ''): string => `s-${nameSlug([group, section].filter(Boolean).join(' '))}`;

/** Every mission in reading order: the index's groups and sections as listed. */
export const storyOrder = (ix: StoryIndex): string[] => ix.groups.flatMap((g) => g.sections.flatMap((s) => s.missions));

const slugCache = new WeakMap<StoryIndex, { bySlug: Map<string, string>; byId: Map<string, string> }>();

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
const fromRoman = (s: string): number => [...s].reduce((n, ch, i) => n + (ROMAN[ch] < (ROMAN[s[i + 1]] ?? 0) ? -ROMAN[ch] : ROMAN[ch]), 0);

/**
 * A main-story section's chapter and act from its title ("Chapter 1 · Valley
 * IV · III · Path of Ascension" → 1, 3; "Chapter 1 · Valley IV", the
 * prologue → 1, 0); null for other sections.
 */
export function chapterAct(title: string): [number, number] | null {
  const parts = title.split(' · ');
  const ch = /^Chapter (\d+)$/.exec(parts[0] ?? '');
  if (!ch) return null;
  const act = parts[2] && /^[IVXLC]+$/.test(parts[2]) ? fromRoman(parts[2]) : 0;
  return [Number(ch[1]), act];
}

/** Each other group's letter in its missions' paths. */
const GROUP_LETTERS: Record<string, string> = { 'Side missions': 's', Events: 'e', 'Outposts and development': 'o', 'Other missions': 'm' };

/**
 * Each mission's page path's last part (/story/<slug>), numbered as the list
 * shows them: main story chapter-act-position (Rally and Unite: 1-1-3; the
 * prologue is act 0); side missions s-section-position (s-9-3); events,
 * outposts and other missions e-, o-, m-position. Missions in none of those
 * (the main story's unlisted ones) go by name, with the id added when a name
 * is shared. `bySlug` also knows every mission's name, so old links still
 * open them.
 */
export function storySlugs(ix: StoryIndex): { bySlug: Map<string, string>; byId: Map<string, string> } {
  let c = slugCache.get(ix);
  if (c) return c;
  const order = storyOrder(ix);
  const base = (id: string) => nameSlug(ix.missions[id].name) || id;
  const count = new Map<string, number>();
  for (const id of order) count.set(base(id), (count.get(base(id)) ?? 0) + 1);
  const named = (id: string) => ((count.get(base(id)) ?? 0) > 1 ? `${base(id)}-${id}` : base(id));
  const numbered = new Map<string, string>();
  for (const g of ix.groups) {
    const letter = GROUP_LETTERS[g.title];
    g.sections.forEach((s, si) => {
      const at = chapterAct(s.title);
      if (at) s.missions.forEach((id, i) => numbered.set(id, `${at[0]}-${at[1]}-${i + 1}`));
      // Other groups: their letter, the section's place (when there are several), the mission's.
      else if (letter) s.missions.forEach((id, i) => numbered.set(id, g.sections.length > 1 ? `${letter}-${si + 1}-${i + 1}` : `${letter}-${i + 1}`));
    });
  }
  c = { bySlug: new Map(), byId: new Map() };
  for (const id of order) {
    const slug = numbered.get(id) ?? named(id);
    c.bySlug.set(slug, id);
    c.byId.set(id, slug);
  }
  // Earlier name links to numbered missions.
  for (const [id] of numbered) if (!c.bySlug.has(named(id))) c.bySlug.set(named(id), id);
  slugCache.set(ix, c);
  return c;
}
