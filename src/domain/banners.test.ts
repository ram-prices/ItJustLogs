import { describe, expect, it } from 'vitest';
import { cdnUrl, EF_ASSETS, EF_ASSETS_CDN, itemIconUrl, mirrorUrl, operatorFullUrl } from './banners';

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
