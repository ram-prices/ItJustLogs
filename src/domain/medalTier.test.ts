import { describe, expect, it } from 'vitest';
import samples from './medalTier.fixtures.json';
import { lookOf, tierOf } from './medalTier';

// 34×34 squares of medal pictures cut from real Medal Album screenshots.
const look = (k: keyof typeof samples) => lookOf(new Uint8ClampedArray(Uint8Array.from(atob(samples[k]), (c) => c.charCodeAt(0))));
const reforge = { reforge: true, trim: false };
const trim = { reforge: false, trim: true };

describe('medal looks', () => {
  it('tells the Reforging tiers apart: dark, silver, gold', () => {
    expect(tierOf(look('dark'), reforge)).toEqual({ tier: 1 });
    expect(tierOf(look('silver'), reforge)).toEqual({ tier: 2 });
    expect(tierOf(look('gold'), reforge)).toEqual({ tier: 3 });
  });

  it('sees a Trimmed medal, pale or vivid, and an untrimmed one', () => {
    expect(tierOf(look('trimmed-pale'), trim)).toEqual({ trim: true });
    expect(tierOf(look('trimmed-vivid'), trim)).toEqual({ trim: true });
    expect(tierOf(look('dark'), trim)).toEqual({ trim: false });
    expect(tierOf(look('gold-plain'), trim)).toEqual({ trim: false });
  });
});
