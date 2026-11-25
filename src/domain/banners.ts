import type { Schedule } from './schedule.ts';
import type { BannerDb, BannerDbEntry, Category, Kind } from './types.ts';

/**
 * ef-assets, pictures and data alike: Cloudflare Pages deploys its main branch here on every push
 * (the whole repo at the root, so paths are the repo's). Its `_headers` let browsers keep a picture
 * a day and revalidate JSON every time.
 */
export const EF_ASSETS = 'https://assets.itjustlogs.dev';
/** The same files on GitHub: the fallback when the Pages site fails (mirrorUrl), and the ref-pinned source for tests. */
export const EF_ASSETS_GITHUB = 'https://raw.githubusercontent.com/ram-prices/ef-assets/main';
/** Old ef-assets URLs (jsDelivr branches) that data or saved settings may still hold; assetUrl maps them. */
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/ram-prices/ef-assets@';

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
    // Numerically: joint_1_10_1 is newer than joint_1_9_1.
    const jointKeys = Object.keys(db)
      .filter((k) => k.startsWith('joint_'))
      .sort((a, b) => comparePatches(patchOf(a), patchOf(b)) || poolNumber(a) - poolNumber(b));
    entry = db[jointKeys[jointKeys.length - 1]];
  }
  if (!entry) return null;
  const names = entry.rateupName ?? [];
  return { rateUpIds: entry.rateUpIds ?? [], rateUpNames: Array.isArray(names) ? names : [names] };
}

/** A pool's number within its patch: special_1_4_2 → 2; 0 without one. */
const poolNumber = (poolId: string): number => Number(canonicalPoolId(poolId).match(/_\d+_\d+_(\d+)$/)?.[1] ?? 0);

/**
 * Chartered Headhunting pools: special_<major>_<minor>_<n> (banners.json), and RE-Factor reruns
 * (rerun_chr_<name>), which the game counts as Chartered: they share its 6★ pity. Only these do.
 */
const CHARTERED_POOL = /^(?:special_\d+_\d+(?:_\d+)?|rerun_chr_[a-z0-9_]+)$/;

/** RE-Factor rerun pools: rerun_chr_<name> (Headhunting), rerun_wpn_<name> (Issue). */
export const isRerunPool = (poolId: string): boolean => /^rerun_(?:chr|wpn)_/.test(canonicalPoolId(poolId));

/** Arsenal Issue pools with a rate-up: weponbox_ (the game's spelling), weaponbox_ (a few exports) and rerun_wpn_. */
export const isIssuePool = (poolId: string): boolean => /^(?:wea?ponbox_(?!constant)|rerun_wpn_)/.test(poolId.trim().toLowerCase());

/**
 * A character pool that is none of the known kinds (an exporter that left the
 * pool out, 'unknown', or a pool type the game added later) is 'other': its own
 * pity per pool (analyze.ts pityScope), never Chartered's, and no rewards.
 */
export function categoryOf(kind: Kind, poolId: string): Category {
  const id = canonicalPoolId(poolId);
  if (kind === 'weap') return id.includes('constant') ? 'constant' : 'limited';
  if (id === 'beginner') return 'newHorizons';
  if (id === 'standard') return 'basic';
  if (id.startsWith('joint_')) return 'joint';
  if (CHARTERED_POOL.test(id)) return 'chartered';
  return 'other';
}

export const CATEGORY_LABEL: Record<Category, string> = {
  chartered: 'Chartered Headhunting',
  joint: 'Joint Headhunting',
  basic: 'Basic Headhunting',
  newHorizons: 'New Horizons',
  other: 'Other headhunting',
  limited: 'Arsenal Issue',
  constant: 'Constant Issue',
};

export interface PatchRef {
  key: string;
  major: number;
  minor: number;
}

const PERMANENT_PATCH: PatchRef = { key: 'Permanent', major: -1, minor: -1 };

/**
 * Pool ids encode their patch: special_1_4_2 → 1.4, weponbox_1_0_1 → 1.0. Constant/standard pools have none.
 * A pool id without a version (RE-Factor reruns: rerun_chr_yvonne, rerun_wpn_*) takes it from its
 * `schedule` entry when there is one: the last version released (Americas time) by the banner's start,
 * counted like income.ts (Launch is 1.0, then one minor per release). Without either it's Permanent.
 */
export function patchOf(poolId: string, schedule?: Schedule | null): PatchRef {
  const id = canonicalPoolId(poolId);
  if (id.includes('constant')) return PERMANENT_PATCH;
  const m = id.match(/_(\d+)_(\d+)(?:_\d+)?$/);
  if (!m) return schedule ? schedulePatch(id, schedule) : PERMANENT_PATCH;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return { key: `${major}.${minor}`, major, minor };
}

function schedulePatch(id: string, schedule: Schedule): PatchRef {
  const entry = schedule.banners.find((b) => b.poolId && canonicalPoolId(b.poolId) === id);
  const start = entry?.start ? Date.parse(entry.start.americas) : NaN;
  if (Number.isNaN(start)) return PERMANENT_PATCH;
  const released = schedule.versions.filter((v) => v.release && Date.parse(v.release.americas) <= start);
  return released.length ? { key: `1.${released.length - 1}`, major: 1, minor: released.length - 1 } : PERMANENT_PATCH;
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

/**
 * The operator portraits' version (ef-assets operators/<id>.webp, the game's
 * remote icon from its operator-icons.py since 2): browsers keep a picture
 * a day (ef-assets _headers), so replacing the files only shows everywhere once their URL changes.
 * Bump it whenever existing portraits are replaced.
 */
const PORTRAIT_V = '2';

/** ef-assets stores Typhoeus' pictures under the game's other id for him. */
const pictureId = (id: string): string => (id === 'chr_0034_typhoeus' ? 'chr_0034_typhoea' : id);

/** An operator's square portrait (ef-assets operators/), by the id ef-assets files it under. */
export const operatorIconUrl = (pictureId: string): string => `${EF_ASSETS}/operators/${pictureId}.webp?v=${PORTRAIT_V}`;

export function itemIconUrl(kind: Kind, itemId: string): string {
  if (!itemId) return '';
  return kind === 'char' ? operatorIconUrl(pictureId(itemId)) : `${EF_ASSETS}/arsenals/${itemId}.webp`;
}

/** An operator's card art: the official site's picture (ef-assets operators/bust-3/, from operator-cards.py). */
export const operatorCardUrl = (id: string): string => `${EF_ASSETS}/operators/bust-3/${pictureId(id)}.webp`;

/** An operator's full art: the game's character portrait, the operator in their splash motif on a transparent background (ef-assets operators/full/, from operator-full.py, at the game's own size since cards zoom it). */
export const operatorFullUrl = (id: string): string => `${EF_ASSETS}/operators/full/${pictureId(id)}.webp`;

/** A gear piece's icon (ef-assets gear/, from scripts/gear-icons.py). */
export const gearIconUrl = (gearId: string): string => `${EF_ASSETS}/gear/${gearId}.webp`;

/**
 * Fallback for a banners.json without any `gameArt` flag (an old cached copy):
 * the pools that had game-screen art when the flag was added.
 */
const GAME_ART_FALLBACK = [
  'special_1_0_1', 'special_1_0_2', 'special_1_0_3', 'special_1_1_1', 'special_1_1_2', 'special_1_2_1',
  'special_1_3_1', 'special_1_3_2', 'special_1_4_1', 'special_1_4_2', 'special_1_5_1', 'special_1_6_1', 'special_1_6_2',
  'special_1_7_1', 'rerun_chr_tangtang', 'rerun_chr_yvonne', 'rerun_chr_aglina', 'rerun_chr_wulfa',
];

/**
 * Headhunting pools with art laid out from the game's own banner screen
 * (ef-assets banners/game/, made by its operator-banner.py); the others keep
 * their operator close-up. ef-assets' scripts/site-art.mjs flags them in
 * banners.json (`gameArt: true`) once the picture and both layers are there,
 * and holds back any on its HOLD list. state.ts fills this from the banner db at startup and on
 * every refresh (setGameArtPools).
 */
const GAME_ART = new Map<string, string>(GAME_ART_FALLBACK.map((id) => [id, '']));

/** `?v=<fingerprint>` for a pool's game-screen art files, '' without one. */
const gameArtQuery = (id: string): string => {
  const v = GAME_ART.get(id);
  return v ? `?v=${v}` : '';
};

/** Take the game-screen art pools (and their `gameArtV` fingerprints) from a banner db's `gameArt` flags; a db with none keeps the fallback. */
export function setGameArtPools(db: BannerDb): void {
  const flagged = Object.keys(db).filter((id) => db[id]?.gameArt === true);
  GAME_ART.clear();
  if (!flagged.length) for (const id of GAME_ART_FALLBACK) GAME_ART.set(id, '');
  for (const id of flagged) {
    const v = db[id].gameArtV;
    GAME_ART.set(canonicalPoolId(id), typeof v === 'string' && /^[0-9a-f]{1,16}$/.test(v) ? v : '');
  }
}

export function bannerArtUrl(poolId: string): string | null {
  const id = canonicalPoolId(poolId);
  if (GAME_ART.has(id)) return `${EF_ASSETS}/banners/game/${id}.webp${gameArtQuery(id)}`;
  // Constant Issues have ef-assets art (rebuilt from the weapon render); other constant pools don't.
  if (id.includes('constant') && !id.startsWith('weaponbox_constant_')) return null;
  return `${EF_ASSETS}/banners/${id.startsWith('joint_') ? 'joint_1_2_2' : id}.webp`;
}

/**
 * An Arsenal Issue banner's art as layers (ef-assets banners/layers/, made by
 * its issue-layers.py): the backdrop and dotted rule shared by every Issue,
 * this banner's weapon, and the ornaments over it. Null for other banners.
 */
export function issueLayerUrls(poolId: string): { back: string; weapon: string; front: string } | null {
  const id = canonicalPoolId(poolId);
  // RE-Factor Issues (rerun_wpn_) too: until ef-assets has their layers, the flat art stands in (components.ts issueArt).
  if (!isIssuePool(id) && !id.startsWith('weaponbox_constant_')) return null;
  const at = `${EF_ASSETS}/banners/layers/`;
  return { back: `${at}issue-back.webp`, weapon: `${at}${id}.webp`, front: `${at}issue-front.webp` };
}

/**
 * A game-screen art banner (`gameArt` in banners.json) in two layers (ef-assets banners/game/layers/, from
 * operator-banner.py): the banner without its operator, and the operator on
 * transparency. Stacked they give the flat art. Null for other banners.
 */
export function operatorLayerUrls(poolId: string): { back: string; op: string } | null {
  const id = canonicalPoolId(poolId);
  if (!GAME_ART.has(id)) return null;
  const at = `${EF_ASSETS}/banners/game/layers/${id}`;
  const q = gameArtQuery(id);
  return { back: `${at}-back.webp${q}`, op: `${at}-op.webp${q}` };
}

/**
 * An ef-assets URL on the other host: assets.itjustlogs.dev ↔ raw.githubusercontent. A failed load
 * (`data-fallback` pictures, data fetches) tries it once. Null for any other URL.
 */
export function mirrorUrl(url: string): string | null {
  if (url.startsWith(`${EF_ASSETS}/`)) return EF_ASSETS_GITHUB + url.slice(EF_ASSETS.length);
  if (url.startsWith(`${EF_ASSETS_GITHUB}/`)) return EF_ASSETS + url.slice(EF_ASSETS_GITHUB.length);
  return null;
}

/**
 * An ef-assets URL some data gives (schedule.json and the medal snapshot link raw.githubusercontent;
 * old copies may hold a jsDelivr branch URL) on the site's host. Any other URL is left as it is.
 */
export function assetUrl(url: string): string {
  if (url.startsWith(`${EF_ASSETS_GITHUB}/`)) return EF_ASSETS + url.slice(EF_ASSETS_GITHUB.length);
  if (url.startsWith(JSDELIVR)) {
    const path = url.indexOf('/', JSDELIVR.length);
    return path < 0 ? url : EF_ASSETS + url.slice(path);
  }
  return url;
}

/** Both hosts' URL for each data file, in order: Pages, then GitHub. */
export const dataUrls = (path: string): string[] => [`${EF_ASSETS}/${path}`, `${EF_ASSETS_GITHUB}/${path}`];
