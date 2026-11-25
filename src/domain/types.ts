/** A record exactly as the game's gacha-history API returns it. Kept verbatim so exports round-trip. */
export type RawRecord = Record<string, unknown>;

/** The export format shared with the PowerShell exporter and the old eftracker site. */
export interface PullHistory {
  characters: RawRecord[];
  weapons: RawRecord[];
}

export type Kind = 'char' | 'weap';

/** A normalized, typed view of one RawRecord. */
export interface Pull {
  key: string;
  kind: Kind;
  seq: number;
  ts: number;
  poolId: string;
  poolName: string;
  itemId: string;
  name: string;
  rarity: number;
  isFree: boolean;
  isNew: boolean;
}

/** 'other': a pool that is none of the known kinds (no pool id in the export, or a kind the game added later). */
type CharCategory = 'chartered' | 'joint' | 'basic' | 'newHorizons' | 'other';
type WeapCategory = 'limited' | 'constant';
export type Category = CharCategory | WeapCategory;

/** How a 6★ pull on a rate-up banner resolved. */
export type Outcome = 'won' | 'lost' | 'guaranteed';

export interface BannerDbEntry {
  name?: string;
  rateUpIds?: string[];
  rateupName?: string[] | string;
  type?: string;
  /** ef-assets has game-screen art for this pool (banners/game/ and its layers), set by its site-art.mjs. */
  gameArt?: boolean;
  /**
   * A fingerprint of that art's three files (site-art.mjs), added to their URLs so a changed picture gets a new
   * address: browsers keep an ef-assets picture a day (a jsDelivr one a week, and in 1.7 they kept an empty operator layer).
   */
  gameArtV?: string;
}
export type BannerDb = Record<string, BannerDbEntry>;
