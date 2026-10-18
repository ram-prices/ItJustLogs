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

export type CharCategory = 'chartered' | 'joint' | 'basic' | 'newHorizons';
export type WeapCategory = 'limited' | 'constant';
export type Category = CharCategory | WeapCategory;

/** How a 6★ pull on a rate-up banner resolved. */
export type Outcome = 'won' | 'lost' | 'guaranteed';

export interface BannerDbEntry {
  name?: string;
  rateUpIds?: string[];
  rateupName?: string[] | string;
  type?: string;
}
export type BannerDb = Record<string, BannerDbEntry>;
