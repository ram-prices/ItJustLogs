/**
 * Art that Potentials unlock: the pictures the game gives each operator at
 * P1, P3 and P5 (ef-assets operators/potential/, its scripts/potential-art.py).
 * The operator page's banner shows the highest one the player owns unless they
 * picked another (`settings.potentialArt`).
 */

/** ef-assets operators/potential/index.json: operator id → Potential → files. */
export type PotentialArtIndex = Record<string, Record<string, string[]>>;

/** A pick: 'auto' (the highest owned), 'base' (no Potential art), or a picture's key ("p3", "p1-ex01"). */
export type ArtChoice = string;

export interface PotentialPicture {
  /** "p3", or "p1-ex01" for a second picture at one Potential. */
  key: string;
  level: number;
  file: string;
}

/** An operator's pictures, lowest Potential first. */
export function potentialPictures(index: PotentialArtIndex | null, opId: string): PotentialPicture[] {
  const levels = index?.[opId];
  if (!levels) return [];
  return Object.entries(levels)
    .flatMap(([n, files]) => files.map((file) => ({ key: file.slice(opId.length + 1).replace(/\.webp$/, ''), level: Number(n), file })))
    .sort((a, b) => a.level - b.level);
}

/** The highest Potential's (first) picture the player has reached; null below P1 or without art. */
export function autoPicture(list: PotentialPicture[], potential: number): PotentialPicture | null {
  let best: PotentialPicture | null = null;
  for (const p of list) if (p.level <= potential && (!best || p.level > best.level)) best = p;
  return best;
}

/** What the banner shows for a choice: a picture, or null for the base art. A picture that's gone counts as Auto. */
export function chosenPicture(list: PotentialPicture[], choice: ArtChoice, potential: number): PotentialPicture | null {
  if (choice === 'base') return null;
  return list.find((p) => p.key === choice) ?? autoPicture(list, potential);
}

/** The player's choice for an operator; old settings without one are Auto. */
export const artChoiceOf = (settings: { potentialArt?: Record<string, ArtChoice> }, opId: string): ArtChoice =>
  settings.potentialArt?.[opId] ?? 'auto';

/** The settings map after picking: Auto is the default, so it's dropped. */
export function withArtChoice(map: Record<string, ArtChoice> | undefined, opId: string, choice: ArtChoice): Record<string, ArtChoice> {
  const next = { ...map };
  if (choice === 'auto') delete next[opId];
  else next[opId] = choice;
  return next;
}
