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

/** Every mission in reading order: the index's groups and sections as listed. */
export const storyOrder = (ix: StoryIndex): string[] => ix.groups.flatMap((g) => g.sections.flatMap((s) => s.missions));

const slugCache = new WeakMap<StoryIndex, { bySlug: Map<string, string>; byId: Map<string, string> }>();

/** Each mission's page path's last part (/story/<slug>): its name, with the id added when a name is shared. */
export function storySlugs(ix: StoryIndex): { bySlug: Map<string, string>; byId: Map<string, string> } {
  let c = slugCache.get(ix);
  if (c) return c;
  const order = storyOrder(ix);
  const base = (id: string) => nameSlug(ix.missions[id].name) || id;
  const count = new Map<string, number>();
  for (const id of order) count.set(base(id), (count.get(base(id)) ?? 0) + 1);
  c = { bySlug: new Map(), byId: new Map() };
  for (const id of order) {
    const slug = (count.get(base(id)) ?? 0) > 1 ? `${base(id)}-${id}` : base(id);
    c.bySlug.set(slug, id);
    c.byId.set(id, slug);
  }
  slugCache.set(ix, c);
  return c;
}
