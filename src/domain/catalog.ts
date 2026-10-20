import { canonicalPoolId } from './banners';
import { isWeaponBanner, statusOf, timeOn, type Schedule, type Server } from './schedule';
import type { BannerDb, Kind } from './types';

/**
 * Every banner that has opened, from ef-assets' banners.json (known pool ids)
 * and schedule.json (dates, art, and banners whose pool id isn't known yet),
 * for "show all banners": the ones the player has no pulls on.
 */

export interface CatalogBanner {
  poolId: string | null;
  kind: Kind;
  name: string;
  rateUpIds: string[];
  rateUpNames: string[];
  /** The announcement's cover art, if the schedule has it. */
  art: string | null;
  /** Opening and closing time on the player's server (ms), if scheduled. */
  start: number | null;
  end: number | null;
}

const isWeaponPool = (poolId: string) => /^wea?ponbox_/.test(poolId);

/** When each pool opened on `server`, from the schedule. */
export function poolStarts(schedule: Schedule, server: Server): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of schedule.banners) {
    const t = timeOn(s.start, server);
    if (s.poolId && t != null) out.set(canonicalPoolId(s.poolId), t);
  }
  return out;
}

/**
 * Whether a pulled-on banner is over: its scheduled window has closed (matched
 * by pool id, else by name, since some scheduled banners have no pool id yet),
 * or it's New Horizons and its one 6★ has dropped. Basic and other unscheduled
 * pools never end.
 */
export function bannerEnded(schedule: Schedule, server: Server, now = Date.now()): (b: { poolId: string; name: string; category: string; pity: { done?: boolean } }) => boolean {
  const byPool = new Map<string, Schedule['banners'][number]>();
  const byName = new Map<string, Schedule['banners'][number]>();
  for (const s of schedule.banners) {
    if (s.poolId) byPool.set(canonicalPoolId(s.poolId), s);
    byName.set(s.name.trim().toLowerCase(), s);
  }
  return (b) => {
    if (b.category === 'newHorizons') return !!b.pity.done;
    const s = byPool.get(canonicalPoolId(b.poolId)) ?? byName.get(b.name.trim().toLowerCase());
    return !!s && statusOf(s, now, server) === 'ended';
  };
}

/**
 * Banners of `kind` that have opened and that `pulled` (the player's banners,
 * by pool id and name) doesn't include. Newest first; unscheduled pools
 * (Basic, New Horizons, constant Issues) last.
 */
export function unpulledBanners(
  kind: Kind,
  pulled: { poolId: string; name: string }[],
  db: BannerDb,
  schedule: Schedule,
  server: Server,
  now = Date.now(),
): CatalogBanner[] {
  const seenPools = new Set(pulled.map((b) => canonicalPoolId(b.poolId)));
  const seenNames = new Set(pulled.map((b) => b.name.trim().toLowerCase()));
  const scheduled = schedule.banners.filter((s) => isWeaponBanner(s.kind) === (kind === 'weap'));
  const byPool = new Map(scheduled.filter((s) => s.poolId).map((s) => [canonicalPoolId(s.poolId!), s]));
  const out: CatalogBanner[] = [];
  const add = (b: CatalogBanner) => {
    if (b.poolId) seenPools.add(b.poolId);
    seenNames.add(b.name.trim().toLowerCase());
    out.push(b);
  };

  for (const [rawId, entry] of Object.entries(db)) {
    const poolId = canonicalPoolId(rawId);
    if (isWeaponPool(poolId) !== (kind === 'weap') || seenPools.has(poolId)) continue;
    const s = byPool.get(poolId);
    if (s && statusOf(s, now, server) === 'upcoming') continue;
    const names = entry.rateupName ?? [];
    add({
      poolId,
      kind,
      name: entry.name || s?.name || poolId,
      rateUpIds: entry.rateUpIds ?? [],
      rateUpNames: Array.isArray(names) ? names : [names],
      art: s?.art ?? null,
      start: s ? timeOn(s.start, server) : null,
      end: s ? timeOn(s.end, server) : null,
    });
  }

  // Scheduled banners the banner list doesn't have (no pool id yet, or a new pool).
  for (const s of scheduled) {
    const poolId = s.poolId ? canonicalPoolId(s.poolId) : null;
    if (statusOf(s, now, server) === 'upcoming') continue;
    if ((poolId && seenPools.has(poolId)) || seenNames.has(s.name.trim().toLowerCase())) continue;
    add({ poolId, kind, name: s.name, rateUpIds: [], rateUpNames: s.rateUps, art: s.art, start: timeOn(s.start, server), end: timeOn(s.end, server) });
  }

  return out.sort((a, b) => (b.start ?? -Infinity) - (a.start ?? -Infinity));
}
