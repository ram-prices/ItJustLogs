import { describe, expect, it } from 'vitest';
import file from '../data/medals.snapshot.json';
import { matchName, nameIndex, readDate, readFrame, settle, type ReadLine } from './medalReader';

// Lines as Tesseract.js read them from a real Medal Album recording (2560×1440).
const medals = (file as { medals: { id: string; name: string }[] }).medals;
const names = nameIndex(medals);
const today = new Date('2026-10-20');
const line = (text: string, y = 100): ReadLine => ({ text, y });
const idOf = (name: string) => medals.find((m) => m.name === name)!.id;

describe('medal reader', () => {
  it('reads titles past the pill noise and the medal picture marks', () => {
    const got = readFrame(
      [
        line('- "Awaken" [~] NSTC 2026-01-21', 100),
        line('i "Core ex Machina" @ INSTI 2026-01-21', 200),
        line('“ "The Fist Misses" [~ IESE] 2026-01-22', 300),
        line('You have returned to Talos-II.', 130),
      ],
      names,
      today,
    );
    expect(got).toEqual([
      { id: idOf('"Awaken"'), date: '2026-01-21', score: 1 },
      { id: idOf('"Core ex Machina"'), date: '2026-01-21', score: 1 },
      { id: idOf('"The Fist Misses"'), date: '2026-01-22', score: 1 },
    ]);
  });

  it('tells numbered medals apart, with numerals read as l or 1', () => {
    expect(matchName('Wuling Stock Redistributor Il', names)?.id).toBe(idOf('Wuling Stock Redistributor Ⅱ'));
    expect(matchName('Wuling Factory Pioneer lll', names)?.id).toBe(idOf('Wuling Factory Pioneer Ⅲ'));
    expect(matchName('Wuling Stock Redistributor', names)?.id).toBe(idOf('Wuling Stock Redistributor'));
  });

  it('only believes real dates', () => {
    expect(readDate('2020-06-14', today)).toBeNull();
    expect(readDate('2026-13-02', today)).toBeNull();
    expect(readDate('2027-01-01', today)).toBeNull();
    expect(readDate('2026 - 06 - 14', today)).toBe('2026-06-14');
  });

  it('settles each date by the frames that agree, and flags the doubtful', () => {
    const id = idOf('"The Final Lord I Served"');
    const r = settle(
      [
        { id, date: '2026-04-18', score: 1 },
        { id, date: '2026-04-18', score: 1 },
        { id, date: '2026-04-13', score: 1 },
        { id: idOf('"Awaken"'), date: null, score: 1 },
      ],
      medals,
    );
    expect(r[0]).toMatchObject({ date: '2026-04-18', seen: 3, votes: 2, others: ['2026-04-13'], unsure: false });
    expect(r[1]).toMatchObject({ date: null, unsure: false });
  });
});
