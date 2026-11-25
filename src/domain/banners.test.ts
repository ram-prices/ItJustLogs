import { describe, expect, it } from 'vitest';
import { assetUrl, bannerArtUrl, categoryOf, dataUrls, EF_ASSETS, EF_ASSETS_GITHUB, itemIconUrl, lookupBanner, mirrorUrl, operatorCardUrl, operatorFullUrl, operatorLayerUrls, setGameArtPools } from './banners';
import { kthCopyPmf, WEAPON } from './pity';
import type { BannerDb } from './types';

describe('pool categories', () => {
  it('makes only special_ pools Chartered', () => {
    expect(categoryOf('char', 'special_1_4_2')).toBe('chartered');
    expect(categoryOf('char', 'Special_1_10_1')).toBe('chartered');
    expect(categoryOf('char', 'standard')).toBe('basic');
    expect(categoryOf('char', 'beginner')).toBe('newHorizons');
    expect(categoryOf('char', 'joint_1_2_2')).toBe('joint');
    // A missing or unrecognised pool is 'other' (its own pity per pool), never Chartered.
    for (const id of ['unknown', 'mystery_1_0_1', 'specialx']) expect(categoryOf('char', id)).toBe('other');
    expect(categoryOf('weap', 'unknown')).toBe('limited');
  });

  it("falls back to the newest joint entry by patch number, not text", () => {
    const db = {
      joint_1_9_1: { name: 'Old', rateUpIds: ['chr_old'] },
      joint_1_10_1: { name: 'New', rateUpIds: ['chr_new'] },
      joint_1_10_2: { name: 'Newer', rateUpIds: ['chr_newer'] },
      joint_1_2_1: { name: 'Oldest', rateUpIds: ['chr_oldest'] },
    } as unknown as BannerDb;
    expect(lookupBanner(db, 'joint_1_11_1')?.rateUpIds).toEqual(['chr_newer']);
    expect(lookupBanner(db, 'joint_1_9_1')?.rateUpIds).toEqual(['chr_old']);
    expect(lookupBanner(db, 'unknown')).toBeNull();
  });
});

describe('copy PMF cache', () => {
  it('keeps PMFs of different lengths apart', () => {
    const short = kthCopyPmf(WEAPON, 1, { guaranteeAt: 80, maxPulls: 50 });
    const long = kthCopyPmf(WEAPON, 1, { guaranteeAt: 80, maxPulls: 200 });
    expect(short.length).toBe(51);
    expect(long.length).toBe(201);
  });
});

const PAGES = 'https://assets.itjustlogs.dev';
const GITHUB = 'https://raw.githubusercontent.com/ram-prices/ef-assets/main';

describe('ef-assets URLs', () => {
  it('loads every picture from the Pages site, with the version tags', () => {
    expect(EF_ASSETS).toBe(PAGES);
    expect(EF_ASSETS_GITHUB).toBe(GITHUB);
    expect(itemIconUrl('char', 'chr_0016_laevat')).toBe(`${PAGES}/operators/chr_0016_laevat.webp?v=2`);
    expect(itemIconUrl('char', 'chr_0034_typhoeus')).toBe(`${PAGES}/operators/chr_0034_typhoea.webp?v=2`);
    expect(itemIconUrl('weap', 'wpn_a')).toBe(`${PAGES}/arsenals/wpn_a.webp`);
    expect(operatorCardUrl('chr_0034_typhoeus')).toBe(`${PAGES}/operators/bust-3/chr_0034_typhoea.webp`);
    expect(operatorFullUrl('chr_0016_laevat')).toBe(`${PAGES}/operators/full/chr_0016_laevat.webp`);
    setGameArtPools({ special_1_7_1: { gameArt: true, gameArtV: 'abc123' } } as unknown as BannerDb);
    expect(bannerArtUrl('special_1_7_1')).toBe(`${PAGES}/banners/game/special_1_7_1.webp?v=abc123`);
    expect(operatorLayerUrls('special_1_7_1')?.op).toBe(`${PAGES}/banners/game/layers/special_1_7_1-op.webp?v=abc123`);
    setGameArtPools({} as BannerDb);
  });

  it('moves the URLs data gives (GitHub, old jsDelivr branches) to the Pages site', () => {
    expect(assetUrl(`${GITHUB}/events/a.webp`)).toBe(`${PAGES}/events/a.webp`);
    expect(assetUrl(`${GITHUB}/collections/medals/a.webp`)).toBe(`${PAGES}/collections/medals/a.webp`);
    expect(assetUrl('https://cdn.jsdelivr.net/gh/ram-prices/ef-assets@cdn-full/operators/full/a.webp')).toBe(`${PAGES}/operators/full/a.webp`);
    expect(assetUrl(`${PAGES}/events/a.webp`)).toBe(`${PAGES}/events/a.webp`);
  });

  it('falls back from the Pages site to GitHub and back, for pictures and data alike', () => {
    for (const path of ['operators/a.webp?v=2', 'operators/full/a.webp', 'banners.json', 'wiki/operators.json', 'combat/skills.json']) {
      expect(mirrorUrl(`${PAGES}/${path}`)).toBe(`${GITHUB}/${path}`);
      expect(mirrorUrl(`${GITHUB}/${path}`)).toBe(`${PAGES}/${path}`);
    }
    expect(dataUrls('schedule.json')).toEqual([`${PAGES}/schedule.json`, `${GITHUB}/schedule.json`]);
  });

  it('passes other URLs through', () => {
    expect(mirrorUrl('https://example.com/a.webp')).toBeNull();
    expect(mirrorUrl('https://assets.itjustlogs.dev.evil.com/a.webp')).toBeNull();
    expect(assetUrl('https://example.com/a.webp')).toBe('https://example.com/a.webp');
  });
});