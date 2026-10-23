import { describe, expect, it } from 'vitest';
import { chapterAct, storySlugs, type StoryIndex } from './story';

const mission = (name: string) => ({ name, lines: 1, scenes: 1 });
const ix: StoryIndex = {
  attribution: { source: '', url: '', dumper: '', fetched: '', note: '' },
  groups: [
    {
      title: 'Main story',
      sections: [
        { title: 'Chapter 1 · Valley IV', missions: ['e0m0', 'e0m2'] },
        { title: 'Chapter 1 · Valley IV · I · The Broken Lands', missions: ['e1m1', 'e1m2', 'e1m3'] },
        { title: 'Chapter 2 · Wuling · IV · Tales of Old', missions: ['e8m1'] },
      ],
    },
    { title: 'Events', sections: [{ title: '', missions: ['a1m2'] }] },
  ],
  missions: {
    e0m0: mission('Process: Cold Start'),
    e0m2: mission('Process: Awakening'),
    e1m1: mission('Break the Siege'),
    e1m2: mission('Valley Reboot'),
    e1m3: mission('Rally and Unite'),
    e8m1: mission('Like Fire and Ice'),
    a1m2: mission('Catch-Up Training'),
  },
};

describe('story slugs', () => {
  it('reads chapter and act from a section title', () => {
    expect(chapterAct('Chapter 1 · Valley IV')).toEqual([1, 0]);
    expect(chapterAct('Chapter 1 · Valley IV · III · Path of Ascension')).toEqual([1, 3]);
    expect(chapterAct('Chapter 2 · Wuling · VII · Ruins in the Miasma')).toEqual([2, 7]);
    expect(chapterAct('Others · Base Revisited')).toBeNull();
  });

  it('numbers main-story missions chapter-act-position, other groups by letter and position', () => {
    const { byId } = storySlugs(ix);
    expect(byId.get('e0m2')).toBe('1-0-2');
    expect(byId.get('e1m3')).toBe('1-1-3');
    expect(byId.get('e8m1')).toBe('2-4-1');
    expect(byId.get('a1m2')).toBe('e-1');
  });

  it('still opens a numbered mission by its old name', () => {
    expect(storySlugs(ix).bySlug.get('rally-and-unite')).toBe('e1m3');
    expect(storySlugs(ix).bySlug.get('1-1-3')).toBe('e1m3');
    expect(storySlugs(ix).bySlug.get('catch-up-training')).toBe('a1m2');
  });
});
