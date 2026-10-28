/**
 * What's kept about each operator picture besides the file (ui/pages/art.ts):
 * where it shows, its banner focus, the link it came from, and whether it's a
 * link only. All of it lives in settings, keyed by the picture's IndexedDB
 * key, so it syncs and goes in backups with the rest. Pictures saved before
 * sources were kept simply have none.
 */

export interface ArtMeta {
  artPlaces?: Record<string, string[]>;
  artPos?: Record<string, [number, number]>;
  artSources?: Record<string, string>;
  artLinks?: string[];
  deletedArt?: string[];
}

/**
 * Settings with the banner as art's only place. Art used to go in other places
 * too (page background, character picture, slideshow), since dropped: old
 * saves and synced settings that still have them load as if they were never
 * set, and the next save leaves them out. Returns `s` itself when there's
 * nothing to drop.
 */
export function withoutRetiredPlaces<T extends ArtMeta>(s: T): T {
  const places = s.artPlaces;
  if (!places || Object.values(places).every((p) => p.every((x) => x === 'banner'))) return s;
  const artPlaces = Object.fromEntries(Object.entries(places).map(([k, p]) => [k, p.filter((x) => x === 'banner')]));
  return { ...s, artPlaces };
}

/** The settings change for a newly saved picture (or link only): its source and, if given, where it shows. */
export function addedArt(s: ArtMeta, key: string, opts: { source?: string; places?: string[]; linkOnly?: boolean }): ArtMeta {
  const out: ArtMeta = {};
  if (opts.source) out.artSources = { ...s.artSources, [key]: opts.source };
  if (opts.places) out.artPlaces = { ...s.artPlaces, [key]: opts.places };
  if (opts.linkOnly) out.artLinks = [...(s.artLinks ?? []), key];
  return out;
}

/** The settings change for a removed picture: everything about it gone, and a tombstone so sync removes it elsewhere. */
export function removedArt(s: ArtMeta, key: string): ArtMeta {
  const { [key]: _p, ...artPlaces } = s.artPlaces ?? {};
  const { [key]: _x, ...artPos } = s.artPos ?? {};
  const { [key]: _s, ...artSources } = s.artSources ?? {};
  return {
    deletedArt: [...(s.deletedArt ?? []), key],
    artPlaces,
    artPos,
    artSources,
    artLinks: (s.artLinks ?? []).filter((k) => k !== key),
  };
}

/** Link-only art for one operator: its keys and links, minus any removed. */
export function linkArtOf(s: ArtMeta, opId: string): { key: string; url: string }[] {
  const removed = new Set(s.deletedArt ?? []);
  return (s.artLinks ?? []).filter((k) => k.startsWith(`art:${opId}:`) && !removed.has(k) && s.artSources?.[k]).map((key) => ({ key, url: s.artSources![key] }));
}

/** A short name for a source link: its site, without "www." ("x.com"). */
export function sourceSite(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
