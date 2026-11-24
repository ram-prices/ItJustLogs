import { describe, expect, it } from 'vitest';
import { sanitizeSettings, webUrl } from './settingsSanitize';
import type { Settings } from './store';

/** A realistic saved settings object: Home customized, storage box links and notes, old-style picture sources. */
const VALID: Settings = {
  theme: 'dark',
  displayName: 'Endmin',
  showTimestamps: true,
  summaryMaxRows: 3,
  summaryBannerLimit: 50,
  summaryExpandedByDefault: false,
  bannerBlur: 12,
  bannerPos: 40,
  server: 'asia' as Settings['server'],
  homeClip: 'none',
  showAic: true,
  home: [
    { id: 'banners', type: 'banners', size: 12, char: 2, weap: 1, reruns: false },
    { id: 'pity-lx3k2abc', type: 'pity', size: 6, align: 'left' },
    { id: 'latest-lx3k2abd', type: 'latest', size: 6, under: true },
    { id: 'character-lx3k9zz1', type: 'character', size: 4, col: 9, newRow: true, op: 'chr_0016_laevat', pic: 'art:chr_0016_laevat:lx3k9zz10a1b', facts: ['potential', 'first', 'gear'], ambient: 'card', bare: true, artStyle: 'background', title: 'Main', note: 'My <b>favourite</b>' },
    { id: 'note-lx3kaaaa', type: 'note', size: 8, align: 'center', hideTitle: true, title: 'Plan', text: 'Save for 1.5\n\nThen pull' },
    { id: 'spacer-lx3kbbbb', type: 'spacer', size: 12, height: 64 },
  ],
  homePhone: { order: ['banners', 'note-lx3kaaaa'], hidden: ['pity-lx3k2abc'] },
  artSources: { 'art:chr_0005_chen:lx1a2b3c4d5e': 'https://x.com/someone/status/1' },
  storeItems: {
    'art:chr_0005_chen:lx1a2b3c9f9f': { kind: 'link', url: 'https://www.pixiv.net/artworks/1', title: 'Chen' },
    'art:chr_0005_chen:lx1a2b3d0000': { kind: 'note', text: 'A note' },
    'art:chr_0005_chen:lx1a2b3d1111': { kind: 'file', name: 'chen.png', size: 12345 },
  },
  artPos: { 'art:chr_0005_chen:lx1a2b3c4d5e': [50, 20] },
  maxEssence: ['wpn_0001'],
};

const homeOf = (home: unknown[]) => sanitizeSettings({ home } as Partial<Settings>).home;

describe('sanitizeSettings', () => {
  it('leaves valid settings unchanged', () => {
    const copy = structuredClone(VALID);
    expect(sanitizeSettings(copy)).toEqual(VALID);
  });

  it('defaults a malicious widget size to full width', () => {
    const [w] = homeOf([{ id: 'pity', type: 'pity', size: '4" autofocus onfocus="alert(1)' }])!;
    expect(w).toEqual({ id: 'pity', type: 'pity', size: 12 });
  });

  it('drops non-integer or out-of-range columns and odd shapes', () => {
    const [w] = homeOf([{ id: 'pity', type: 'pity', size: 6, col: '1;x', align: 'top', under: 'yes', height: 'tall', facts: 'potential' }])!;
    expect(w).toEqual({ id: 'pity', type: 'pity', size: 6 });
    expect(homeOf([{ id: 'p', type: 'pity', size: 6, col: 2.5 }])![0].col).toBeUndefined();
    expect(homeOf([{ id: 'p', type: 'pity', size: 6, col: 13 }])![0].col).toBeUndefined();
  });

  it('drops widgets with a bad id', () => {
    expect(homeOf([{ id: 'x" onmouseover="alert(1)', type: 'note', size: 4 }, { id: 42, type: 'note', size: 4 }, { type: 'note', size: 4 }])).toEqual([]);
  });

  it('drops widgets of an unknown type', () => {
    expect(homeOf([{ id: 'evil', type: '__proto__', size: 4 }, { id: 'evil2', type: 'iframe', size: 4 }, 'note', null])).toEqual([]);
  });

  it('drops an operator or picture key that is not an id', () => {
    const [w] = homeOf([{ id: 'c', type: 'character', size: 4, op: '../../x"><script>', pic: 'full' }])!;
    expect(w).toEqual({ id: 'c', type: 'character', size: 4, pic: 'full' });
  });

  it('drops javascript: and other non-web links', () => {
    const s = sanitizeSettings({
      artSources: { a: 'javascript:alert(1)', b: 'https://example.com/a', c: 'data:text/html,<script>alert(1)</script>', d: 42 },
      storeItems: {
        k1: { kind: 'link', url: 'javascript:alert(document.domain)' },
        k2: { kind: 'link', url: ' JAVASCRIPT:alert(1)' },
        k3: { kind: 'link', url: 'http://example.com' },
        k4: { kind: 'script', src: 'x' },
        k5: { kind: 'note', text: 5 },
      },
    } as unknown as Partial<Settings>);
    expect(s.artSources).toEqual({ b: 'https://example.com/a' });
    expect(s.storeItems).toEqual({ k3: { kind: 'link', url: 'http://example.com' } });
  });

  it('drops a home or homePhone that is not the right shape', () => {
    const s = sanitizeSettings({ home: 'banners', homePhone: { order: 'x' } } as unknown as Partial<Settings>);
    expect('home' in s).toBe(false);
    expect('homePhone' in s).toBe(false);
  });
});

describe('webUrl', () => {
  it('accepts http(s) only', () => {
    expect(webUrl('https://a.b/c')).toBe('https://a.b/c');
    expect(webUrl('javascript:alert(1)')).toBeNull();
    expect(webUrl('not a url')).toBeNull();
  });
});
