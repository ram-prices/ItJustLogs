import { describe, expect, it } from 'vitest';
import { artChoiceOf, autoPicture, chosenPicture, potentialPictures, withArtChoice, type PotentialArtIndex } from './potentialArt';

const index: PotentialArtIndex = {
  chr_0004_pelica: {
    '1': ['chr_0004_pelica-p1.webp', 'chr_0004_pelica-p1-ex01.webp'],
    '3': ['chr_0004_pelica-p3.webp'],
    '5': ['chr_0004_pelica-p5.webp'],
  },
  focus: { 'chr_0004_pelica-p3.webp': [0.33, 0.3] },
};
const list = potentialPictures(index, 'chr_0004_pelica');

describe('potential art', () => {
  it('lists pictures with their keys, lowest Potential first', () => {
    expect(list.map((p) => p.key)).toEqual(['p1', 'p1-ex01', 'p3', 'p5']);
    expect(potentialPictures(index, 'chr_0037_minghe')).toEqual([]);
    expect(potentialPictures(null, 'chr_0004_pelica')).toEqual([]);
  });

  it('takes each picture’s focus point in %, the centre without one', () => {
    expect(list.find((p) => p.key === 'p3')?.focus).toEqual([33, 30]);
    expect(list.find((p) => p.key === 'p5')?.focus).toEqual([50, 50]);
    expect(potentialPictures(index, 'focus')).toEqual([]);
  });

  it('auto shows the highest Potential owned', () => {
    expect(autoPicture(list, -1)).toBeNull();
    expect(autoPicture(list, 0)).toBeNull();
    expect(autoPicture(list, 1)?.key).toBe('p1');
    expect(autoPicture(list, 2)?.key).toBe('p1');
    expect(autoPicture(list, 4)?.key).toBe('p3');
    expect(autoPicture(list, 5)?.key).toBe('p5');
  });

  it('a pick wins, locked or not; base shows none; a missing pick falls back to auto', () => {
    expect(chosenPicture(list, 'auto', 3)?.key).toBe('p3');
    expect(chosenPicture(list, 'p5', 0)?.key).toBe('p5');
    expect(chosenPicture(list, 'base', 5)).toBeNull();
    expect(chosenPicture(list, 'p9', 3)?.key).toBe('p3');
  });

  it('old settings without the map load as Auto; Auto is not stored', () => {
    expect(artChoiceOf({}, 'chr_0004_pelica')).toBe('auto');
    expect(artChoiceOf({ potentialArt: { chr_0004_pelica: 'p5' } }, 'chr_0004_pelica')).toBe('p5');
    const map = withArtChoice(undefined, 'chr_0004_pelica', 'p5');
    expect(map).toEqual({ chr_0004_pelica: 'p5' });
    expect(withArtChoice(map, 'chr_0004_pelica', 'auto')).toEqual({});
  });
});
