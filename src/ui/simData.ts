/**
 * The combat data a fight needs (ef-assets combat/: each operator's and
 * weapon's file, gear, status settings), fetched the first time it's needed
 * and kept while the worker lives. Shared by the search worker and the pool's
 * fight workers (each fetches its own copy; the browser's cache serves the
 * repeats).
 */
import { EF_ASSETS, EF_ASSETS_CDN } from '../domain/banners';
import type { GearData, WeaponData } from '../domain/sim/build';
import type { SimData, SimRequest } from '../domain/sim/team';

const files = new Map<string, Promise<unknown>>();

/** A combat file, from raw GitHub first, then jsDelivr. */
function get<T>(path: string): Promise<T> {
  let p = files.get(path) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      for (const base of [EF_ASSETS, EF_ASSETS_CDN]) {
        try {
          const res = await fetch(`${base}/combat/${path}`);
          if (res.ok) return (await res.json()) as T;
        } catch {
          /* the other mirror */
        }
      }
      files.delete(path);
      throw new Error(`Couldn't load combat/${path}`);
    })();
    files.set(path, p);
  }
  return p;
}

export async function dataFor(req: SimRequest): Promise<SimData> {
  const ops = [...new Set(req.builds.map((b) => b.op))];
  // The builds' weapons, and every one Optimal gear may choose from.
  const weapons = [...new Set([...req.builds.flatMap((b) => (b.weapon?.id ? [b.weapon.id] : [])), ...(req.optimize?.weapons.flat() ?? [])])];
  const [opFiles, weaponFiles, gear, settings] = await Promise.all([
    Promise.all(ops.map((id) => get<SimData['ops'][string]>(`ops/${id}.json`))),
    Promise.all(weapons.map((id) => get<WeaponData>(`weapons/${id}.json`))),
    get<GearData>('gear.json'),
    get<{ settings: SimData['settings'] }>('settings.json'),
  ]);
  return {
    ops: Object.fromEntries(ops.map((id, i) => [id, opFiles[i]])),
    weapons: Object.fromEntries(weapons.map((id, i) => [id, weaponFiles[i]])),
    gear,
    settings: settings.settings,
  };
}
