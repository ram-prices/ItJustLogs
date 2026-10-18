import type { AnalyzedPull, Analysis, BannerSummary } from './analyze';
import { canonicalPoolId, comparePatches, patchOf, type PatchRef } from './banners';
import type { BannerDb } from './types';

export interface PatchBanner {
  poolId: string;
  name: string;
  kind: 'char' | 'weap';
  /** Undefined when the player never pulled on this banner. */
  summary?: BannerSummary;
}

export interface PatchStats {
  patch: PatchRef;
  banners: PatchBanner[];
  charPulls: number;
  weapPulls: number;
  sixStars: AnalyzedPull[];
}

/**
 * Groups banners by game patch. Banners listed in ef-assets but never pulled on
 * are included so skipped banners show up too.
 */
export function patchStats(analysis: Analysis, db: BannerDb): PatchStats[] {
  const byPatch = new Map<string, PatchStats>();
  const get = (patch: PatchRef) => {
    let s = byPatch.get(patch.key);
    if (!s) byPatch.set(patch.key, (s = { patch, banners: [], charPulls: 0, weapPulls: 0, sixStars: [] }));
    return s;
  };

  const seen = new Set<string>();
  for (const b of analysis.banners) {
    const s = get(b.patch);
    seen.add(`${b.kind}:${b.poolId}`);
    s.banners.push({ poolId: b.poolId, name: b.name, kind: b.kind, summary: b });
    if (b.kind === 'char') s.charPulls += b.paidPulls;
    else s.weapPulls += b.paidPulls;
    s.sixStars.push(...b.pulls.filter((p) => p.rarity === 6));
  }

  for (const [rawId, entry] of Object.entries(db)) {
    const poolId = canonicalPoolId(rawId);
    const patch = patchOf(poolId);
    if (patch.major === -1) continue;
    const kind = poolId.startsWith('weponbox_') ? 'weap' : 'char';
    if (seen.has(`${kind}:${poolId}`)) continue;
    // Joint operations share one roster entry; only list joint pools the player actually saw.
    if (poolId.startsWith('joint_')) continue;
    get(patch).banners.push({ poolId, name: entry.name ?? poolId, kind });
  }

  for (const s of byPatch.values()) s.sixStars.sort((a, b) => a.ts - b.ts);
  return [...byPatch.values()].sort((a, b) => comparePatches(a.patch, b.patch));
}

export interface TimelineBucket {
  start: number;
  char: number;
  weap: number;
  sixStars: AnalyzedPull[];
}

const DAY = 86_400_000;

/** Paid pulls per week (Monday-based, local time), with 6★ drops attached to their week. */
export function weeklyTimeline(analysis: Analysis): TimelineBucket[] {
  if (!analysis.firstTs) return [];
  const weekStart = (ts: number) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const first = weekStart(analysis.firstTs);
  const last = weekStart(analysis.lastTs);
  const buckets: TimelineBucket[] = [];
  const index = new Map<number, TimelineBucket>();
  for (let t = first; t <= last; ) {
    const b = { start: t, char: 0, weap: 0, sixStars: [] };
    buckets.push(b);
    index.set(t, b);
    // Step by calendar week so DST changes don't drift the boundary.
    const d = new Date(t + 7 * DAY + 12 * 3_600_000);
    d.setHours(0, 0, 0, 0);
    t = d.getTime();
  }
  for (const banner of analysis.banners) {
    for (const p of banner.pulls) {
      const b = index.get(weekStart(p.ts));
      if (!b) continue;
      if (!p.isFree) b[p.kind]++;
      if (p.rarity === 6) b.sixStars.push(p);
    }
  }
  return buckets;
}
