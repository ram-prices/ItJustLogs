import { describe, expect, it } from 'vitest';
import file from '../data/findings.snapshot.json';
import { candidates, chain, collectedCounts, findingIndex, tilesFrom, type FindingName, type ReadWord } from './findingReader';

const list = findingIndex((file as { findings: FindingName[] }).findings);
const nameAt = (i: number) => list[i]?.name;

/** Words for one grid row: each tile's name as separate words, tiles 220px apart. */
function row(names: string[], y: number): ReadWord[] {
  return names.flatMap((name, col) => {
    let x = 20 + col * 220;
    return name.split(' ').map((w) => {
      const word = { text: w, x0: x, x1: x + w.length * 9, y0: y, y1: y + 20 };
      x = word.x1 + 8;
      return word;
    });
  });
}

describe('finding reader', () => {
  it('splits a grid row into tile names and spots the cut ones', () => {
    const tiles = tilesFrom(row(['Record: Used B...', 'Old Photograph', 'Memo: Business…'], 300));
    expect(tiles.map((t) => [t.text, t.cut])).toEqual([
      ['Record: Used B', true],
      ['Old Photograph', false],
      ['Memo: Business', true],
    ]);
  });

  it('settles look-alike names by the grid order (E-Files, as the game shows them)', () => {
    // From an E-Files screenshot: three "Agent Data: Ha..." in a row, around an "Ale...".
    const words = [
      ...row(['Record: Used B...', 'Record: Hartma...', 'Agent Data: Ha...', 'Agent Data: Ha...', 'Agent Data: Ale...', 'Agent Data: Ha...'], 380),
      ...row(['Agent File: Hans', 'Agent File: Hart...', 'Agent File: Alek...', 'Old Photograph', "Jeremy's Handy...", 'Memo: Business...'], 620),
    ];
    const { picks, unread } = chain(tilesFrom(words), list);
    expect(picks.map(nameAt)).toEqual([
      'Record: Used Bolts',
      "Record: Hartmann's Work ID",
      'Agent Data: Hartmann (1)',
      'Agent Data: Hartmann (2)',
      'Agent Data: Aleksandr (1)',
      'Agent Data: Hans (1)',
      'Agent File: Hans',
      'Agent File: Hartmann',
      'Agent File: Aleksandr',
      'Old Photograph',
      "Jeremy's Handyterm",
      'Memo: Business Traveler',
    ]);
    expect(unread).toEqual([]);
  });

  it('splits names run together by "~~" or a cut, and copes with lost spaces', () => {
    // As read from a Manuscripts screenshot: one "line" holding three tiles.
    const words = [
      { text: 'Memo:', x0: 20, x1: 70, y0: 300, y1: 320 },
      { text: 'Hardwar...', x0: 78, x1: 170, y0: 300, y1: 320 },
      { text: '~~', x0: 180, x1: 196, y0: 300, y1: 320 },
      { text: 'Originium', x0: 206, x1: 290, y0: 300, y1: 320 },
      { text: 'BPPC...', x0: 298, x1: 360, y0: 300, y1: 320 },
      { text: 'Will', x0: 380, x1: 410, y0: 300, y1: 320 },
      { text: 'LeftonaTr…', x0: 418, x1: 520, y0: 300, y1: 320 },
    ];
    const tiles = tilesFrom(words);
    expect(tiles.map((t) => t.text)).toEqual(['Memo: Hardwar', 'Originium BPPC', 'Will LeftonaTr']);
    expect(candidates(tiles[2], list).map(nameAt)).toEqual(['Will Left on a Trash Bin']);
  });

  it("leaves out a name that fits nowhere in order (one the wiki doesn't list yet)", () => {
    const words = row(['Old Photograph', 'Some Brand New Fin...', 'Memo: Business...'], 300);
    const { picks, unread } = chain(tilesFrom(words), list);
    expect(picks.map((p) => (p < 0 ? null : nameAt(p)))).toEqual(['Old Photograph', null, 'Memo: Business Traveler']);
    expect(unread.map((t) => t.text)).toEqual(['Some Brand New Fin']);
  });

  it('reads the side menu counts', () => {
    expect(
      collectedCounts([
        { text: 'Manuscripts', y: 200 },
        { text: 'Collected 279', y: 230 },
        { text: 'E-Files', y: 300 },
        { text: 'Collected 87', y: 330 },
      ]),
    ).toEqual({ Manuscripts: 279, 'E-Files': 87 });
  });
});
