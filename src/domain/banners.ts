import type { BannerDb, BannerDbEntry, Category, Kind } from './types.ts';

export const EF_ASSETS = 'https://raw.githubusercontent.com/ram-prices/ef-assets/main';
export const EF_ASSETS_CDN = 'https://cdn.jsdelivr.net/gh/ram-prices/ef-assets@main';

/** The game spells weapon pools "weponbox_" for limited issues but "weaponbox_" for constant ones. */
export function canonicalPoolId(poolId: string): string {
  return poolId.trim().toLowerCase().replace(/^weaponbox_(?!constant)/, 'weponbox_');
}

export interface BannerInfo {
  rateUpIds: string[];
  rateUpNames: string[];
}

/**
 * Banner names, rate-ups and patch mapping come from ef-assets' banners.json.
 * Fix wrong or missing data there rather than special-casing it here.
 */
export function lookupBanner(db: BannerDb, poolId: string): BannerInfo | null {
  const id = canonicalPoolId(poolId);
  let entry: BannerDbEntry | undefined = db[id] ?? db[id.replace(/^weponbox_/, 'weaponbox_')];
  // Joint operations reuse one rate-up roster that ef-assets lists once; fall back to the latest joint entry.
  if (!entry && id.startsWith('joint_')) {
    const jointKeys = Object.keys(db).filter((k) => k.startsWith('joint_')).sort();
    entry = db[jointKeys[jointKeys.length - 1]];
  }
  if (!entry) return null;
  const names = entry.rateupName ?? [];
  return { rateUpIds: entry.rateUpIds ?? [], rateUpNames: Array.isArray(names) ? names : [names] };
}

export function categoryOf(kind: Kind, poolId: string): Category {
  const id = canonicalPoolId(poolId);
  if (kind === 'weap') return id.includes('constant') ? 'constant' : 'limited';
  if (id === 'beginner') return 'newHorizons';
  if (id === 'standard') return 'basic';
  if (id.startsWith('joint_')) return 'joint';
  return 'chartered';
}

export const CATEGORY_LABEL: Record<Category, string> = {
  chartered: 'Chartered Headhunting',
  joint: 'Joint Headhunting',
  basic: 'Basic Headhunting',
  newHorizons: 'New Horizons',
  limited: 'Arsenal Issue',
  constant: 'Constant Issue',
};

export interface PatchRef {
  key: string;
  major: number;
  minor: number;
}

export const PERMANENT_PATCH: PatchRef = { key: 'Permanent', major: -1, minor: -1 };

/** Pool ids encode their patch: special_1_4_2 → 1.4, weponbox_1_0_1 → 1.0. Constant/standard pools have none. */
export function patchOf(poolId: string): PatchRef {
  const m = canonicalPoolId(poolId).match(/_(\d+)_(\d+)(?:_\d+)?$/);
  if (!m || poolId.includes('constant')) return PERMANENT_PATCH;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return { key: `${major}.${minor}`, major, minor };
}

export function comparePatches(a: PatchRef, b: PatchRef): number {
  const aPerm = a.major === -1;
  const bPerm = b.major === -1;
  if (aPerm !== bPerm) return aPerm ? 1 : -1;
  return a.major - b.major || a.minor - b.minor;
}

export function isRateUpItem(info: BannerInfo | null, itemId: string, name: string): boolean {
  if (!info) return false;
  const id = itemId.toLowerCase();
  if (id && info.rateUpIds.some((r) => r.toLowerCase() === id)) return true;
  const n = name.trim().toLowerCase();
  return !!n && info.rateUpNames.some((r) => r.trim().toLowerCase() === n);
}

// ---------------------------------------------------------------------------
// Asset URLs
// ---------------------------------------------------------------------------

export function itemIconUrl(kind: Kind, itemId: string): string {
  if (!itemId) return '';
  // ef-assets stores Typhoeus' portrait under the game's other id for him.
  const id = itemId === 'chr_0034_typhoeus' ? 'chr_0034_typhoea' : itemId;
  return `${EF_ASSETS}/${kind === 'char' ? 'operators' : 'arsenals'}/${id}.webp`;
}

/** A gear piece's icon (ef-assets gear/, from scripts/gear-icons.py). */
export const gearIconUrl = (gearId: string): string => `${EF_ASSETS}/gear/${gearId}.webp`;

export function bannerArtUrl(poolId: string): string | null {
  const id = canonicalPoolId(poolId);
  // Constant Issues have ef-assets art (rebuilt from the weapon render); other constant pools don't.
  if (id.includes('constant') && !id.startsWith('weaponbox_constant_')) return null;
  return `${EF_ASSETS}/banners/${id.startsWith('joint_') ? 'joint_1_2_2' : id}.webp`;
}

/** raw.githubusercontent → jsDelivr, used once when an asset fails to load. */
export function cdnFallback(url: string): string | null {
  return url.startsWith(EF_ASSETS) ? EF_ASSETS_CDN + url.slice(EF_ASSETS.length) : null;
}
