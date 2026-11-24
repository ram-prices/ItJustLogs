import { describe, expect, it } from 'vitest';
import { categoryOf, cdnUrl, EF_ASSETS, EF_ASSETS_CDN, itemIconUrl, lookupBanner, mirrorUrl, operatorFullUrl } from './banners';
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

const CDN = 'https://cdn.jsdelivr.net/gh/ram-prices/ef-assets';

describe('ef-assets on jsDelivr', () => {
  it('keeps every picture on a branch under its 50 MB limit, never on main', () => {
    expect(itemIconUrl('char', 'chr_0016_laevat')).toBe(`${CDN}@cdn/operators/chr_0016_laevat.webp`);
    expect(operatorFullUrl('chr_0016_laevat')).toBe(`${CDN}@cdn-full/operators/full/chr_0016_laevat.webp`);
    expect(cdnUrl(`${EF_ASSETS}/events/a.webp`)).toBe(`${EF_ASSETS_CDN}/events/a.webp`);
    expect(cdnUrl(`${EF_ASSETS}/operators/full/a.webp`)).toBe(`${CDN}@cdn-full/operators/full/a.webp`);
    expect(cdnUrl(`${EF_ASSETS}/operators/potential/a.webp`)).toBe(`${CDN}@cdn-potential/operators/potential/a.webp`);
  });

  it('mirrors a picture back to raw GitHub from any branch', () => {
    for (const path of ['operators/a.webp', 'operators/full/a.webp', 'operators/potential/a.webp', 'icons/index.json']) {
      const raw = `${EF_ASSETS}/${path}`;
      expect(mirrorUrl(mirrorUrl(raw)!)).toBe(raw);
    }
    expect(mirrorUrl(`${CDN}@main/icons/a.png`)).toBe(`${EF_ASSETS}/icons/a.png`);
  });

  it('leaves the data folders on main, which the picture branches lack', () => {
    for (const path of ['banners.json', 'schedule.json', 'wiki/operators.json', 'combat/skills.json', 'story/search.json']) {
      expect(mirrorUrl(`${EF_ASSETS}/${path}`)).toBe(`${CDN}@main/${path}`);
    }
  });

  it('passes other URLs through', () => {
    expect(mirrorUrl('https://example.com/a.webp')).toBeNull();
    expect(cdnUrl('https://example.com/a.webp')).toBe('https://example.com/a.webp');
  });
});
