/**
 * The game's medals (Path of Glory, shown as Achievements) and Findings
 * (Intel Archives, shown as Archive): types for the snapshots that
 * scripts/wiki-collections.mjs takes from endfield.wiki.gg, and the
 * player's progress, which lives in settings (synced like the rest).
 */
import type { WikiAttribution } from './wiki';

export interface Medal {
  /** Slug of its name ("awaken"); stable while the wiki keeps the name. */
  id: string;
  /** As the game shows it, quotes included: "Awaken". */
  name: string;
  /** Chapter, Technical, Regional, Progression, Construction, Social, Event, Wondrous. */
  category: string;
  /** The game's sub-list (Main Mission, AIC Factory...), if the category has them. */
  group: string | null;
  desc: string;
  cond: string;
  secret?: string;
  /** Reforging II and III: each tier's description and condition. */
  reforge: { desc: string; cond: string }[];
  /** Trimming condition (a holographic look), if the medal can be trimmed. */
  trim?: string;
  /** When it stopped being obtainable (time-limited events). */
  end?: string;
  images: { base?: string; r2?: string; r3?: string; trim?: string };
}

export interface MedalFile {
  attribution: WikiAttribution;
  medals: Medal[];
}

export interface Finding {
  id: string;
  name: string;
  /** Manuscripts, E-Files or Peculiars (Findings), Audio Records, Nexus Files or Intel Gathering. */
  category: string;
  /** Its place in the wiki's list, which follows the game's own order. */
  order: number;
  type?: string;
  region?: string;
  area?: string;
  parts?: number;
  text?: string;
  /** Nexus Files: what unlocks it ("Chapter I Process II: Paving the Way"). */
  unlock?: string;
  /** The archive's thumbnail, and a larger picture from its page. */
  icon?: string;
  image?: string;
}

export interface FindingFile {
  attribution: WikiAttribution;
  findings: Finding[];
}

/** A medal the player has: when (as the game shows it, YYYY-MM-DD), its Reforging tier and whether it's trimmed. */
export interface MedalProgress {
  at?: string;
  tier?: 2 | 3;
  trim?: boolean;
}

/** The game's order of medal categories. */
export const MEDAL_CATEGORIES = ['Chapter', 'Technical', 'Regional', 'Progression', 'Construction', 'Social', 'Event', 'Wondrous'];
/** The game's order of Findings categories (Intel Archives). */
export const FINDING_CATEGORIES = ['Manuscripts', 'E-Files', 'Peculiars'];
/** Every Archive tab: Findings' categories, then the rest of Intel Archives. */
export const ARCHIVE_CATEGORIES = [...FINDING_CATEGORIES, 'Audio Records', 'Nexus Files', 'Intel Gathering'];

/** The picture for a medal as the player has it: its Reforged or Trimmed look, else the base one. */
export function medalImage(m: Medal, p: MedalProgress | undefined): string | undefined {
  if (p?.trim && m.images.trim) return m.images.trim;
  if (p?.tier === 3 && m.images.r3) return m.images.r3;
  if (p?.tier && p.tier >= 2 && m.images.r2) return m.images.r2;
  return m.images.base;
}
