import { describe, expect, it } from 'vitest';
import { addedArt, linkArtOf, removedArt, sourceSite, withoutRetiredPlaces } from './artMeta';

describe('art sources', () => {
  it('a saved picture keeps its link; an upload has none', () => {
    expect(addedArt({}, 'art:a:1', { source: 'https://x.com/u/status/5' })).toEqual({ artSources: { 'art:a:1': 'https://x.com/u/status/5' } });
    expect(addedArt({ artSources: { 'art:a:0': 'https://e.com/p.png' } }, 'art:a:1', {})).toEqual({});
  });
  it('a video starts in the slideshow', () => {
    expect(addedArt({}, 'art:a:1', { source: 's', places: [] }).artPlaces).toEqual({ 'art:a:1': [] });
  });
  it('a link only is listed for its operator', () => {
    const s = { ...addedArt({}, 'art:a:1', { source: 'https://x.com/u/status/5', linkOnly: true }) };
    expect(linkArtOf(s, 'a')).toEqual([{ key: 'art:a:1', url: 'https://x.com/u/status/5' }]);
    expect(linkArtOf(s, 'b')).toEqual([]);
    expect(linkArtOf({ ...s, deletedArt: ['art:a:1'] }, 'a')).toEqual([]);
  });
  it('removing forgets everything about it and leaves a tombstone', () => {
    const s = { artPlaces: { k: ['banner'], j: ['slideshow'] }, artPos: { k: [1, 2] as [number, number] }, artSources: { k: 'https://x.com/u/status/5', j: 'u' }, artLinks: ['k'] };
    expect(removedArt(s, 'k')).toEqual({ deletedArt: ['k'], artPlaces: { j: ['slideshow'] }, artPos: {}, artSources: { j: 'u' }, artLinks: [] });
  });
  it('old pictures without a source still remove cleanly', () => {
    expect(removedArt({ artPlaces: { k: ['banner'] } }, 'k')).toEqual({ deletedArt: ['k'], artPlaces: {}, artPos: {}, artSources: {}, artLinks: [] });
  });
  it('names the site', () => {
    expect(sourceSite('https://www.pixiv.net/artworks/1')).toBe('pixiv.net');
    expect(sourceSite('https://x.com/u/status/5')).toBe('x.com');
    expect(sourceSite('nope')).toBe('');
  });

  it('old settings with art in retired places (background, picture, slideshow) load with the banner only', () => {
    const old = { theme: 'dark', artPlaces: { k: ['banner', 'background'], j: ['portrait', 'slideshow'], m: ['banner'] } };
    expect(withoutRetiredPlaces(old)).toEqual({ theme: 'dark', artPlaces: { k: ['banner'], j: [], m: ['banner'] } });
    const clean = { artPlaces: { k: ['banner'], v: [] } };
    expect(withoutRetiredPlaces(clean)).toBe(clean);
    expect(withoutRetiredPlaces({})).toEqual({});
  });
});
