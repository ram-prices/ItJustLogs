/**
 * Essences: what infuses a weapon's skills. Each has up to three stats with
 * levels ("Agility +1, Arts DMG +4, Detonate +1"); it raises the weapon
 * skills whose stat it carries, and a weapon wants all of its (two or
 * three) skill stats on one essence. The Essences page lists the player's
 * essences (read from the game by ui/essenceReader.ts) and which weapons
 * each fits. Pure logic, no DOM.
 */

/** One essence stat and its level. */
export type EssenceStat = [stat: string, level: number];

/**
 * The player's essences, kept in settings: each kind (its stats, as
 * essenceKey writes them) and how many they have. Identical essences fit
 * the same weapons, so kinds are what matter; counts are as read.
 */
export type EssenceStash = Record<string, number>;

/** The game's stat names, by the slot they fill on weapons (from the wiki's essence list and weapon skills). */
export const ESSENCE_STATS = {
  attribute: ['Strength', 'Agility', 'Intellect', 'Will', 'Main Attribute'],
  secondary: ['ATK', 'HP', 'Physical DMG', 'Heat DMG', 'Electric DMG', 'Cryo DMG', 'Nature DMG', 'Critical Rate', 'Arts Intensity', 'ULT Efficiency', 'Arts DMG', 'Treatment Efficiency'],
  skill: ['Assault', 'Suppression', 'Pursuit', 'Crusher', 'Inspiring', 'Combative', 'Brutality', 'Infliction', 'Medicant', 'Fracture', 'Detonate', 'Twilight', 'Flow', 'Efficacy'],
};
export const ALL_STATS = [...ESSENCE_STATS.attribute, ...ESSENCE_STATS.secondary, ...ESSENCE_STATS.skill];

/** Other names the game or wiki use for the same stat. */
export const STAT_ALIASES: Record<string, string> = {
  Attack: 'ATK',
  'Crit Rate': 'Critical Rate',
  'Ultimate Gain': 'ULT Efficiency',
  'Ultimate Gain Efficiency': 'ULT Efficiency',
  'Ult Efficiency': 'ULT Efficiency',
  'Originium Arts': 'Arts Intensity',
};

/** An essence's stats as one stable key: "Agility+1|Arts DMG+4|Detonate+1", in the game's slot order. */
export function essenceKey(stats: EssenceStat[]): string {
  const rank = (s: string) => {
    const i = ALL_STATS.indexOf(s);
    return i < 0 ? 999 : i;
  };
  return [...stats]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([s, l]) => `${s}+${l}`)
    .join('|');
}

export function parseEssenceKey(key: string): EssenceStat[] {
  return key
    .split('|')
    .filter(Boolean)
    .map((p) => {
      const at = p.lastIndexOf('+');
      return [p.slice(0, at), Number(p.slice(at + 1))] as EssenceStat;
    });
}

/** How an essence fits a weapon that wants `wants` (its skills' stats): which it covers, and their levels. */
export interface Fit {
  /** How many of the weapon's stats the essence carries. */
  hits: number;
  /** All of them. */
  full: boolean;
  /** The levels it adds on the stats it carries (more is better). */
  levels: number;
}

export function fitOf(stats: EssenceStat[], wants: string[]): Fit {
  let hits = 0;
  let levels = 0;
  for (const w of wants) {
    const s = stats.find(([n]) => n === w);
    if (s) {
      hits++;
      levels += s[1];
    }
  }
  return { hits, full: wants.length > 0 && hits === wants.length, levels };
}

/** Best first: more of the weapon's stats, then higher levels on them. */
export const byFit = (a: Fit, b: Fit): number => b.hits - a.hits || b.levels - a.levels;
