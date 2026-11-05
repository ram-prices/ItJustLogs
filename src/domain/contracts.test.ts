import { describe, expect, it } from 'vitest';
import {
  blockOf,
  decodeShareCode,
  EMPTY_SELECTION,
  encodeShareCode,
  isLegal,
  missionText,
  nextDate,
  phaseOf,
  rulesSections,
  seasonsInOrder,
  seasonStatus,
  toggle,
  type Criterion,
  type Mission,
  type Season,
} from './contracts';

const at = (d: string) => ({ asia: `${d}T12:00:00+08:00`, americas: `${d}T12:00:00-05:00` });
const season = (id: string, start: string, batch2: string, end: string, close: string): Season =>
  ({ id, start: at(start), batch2: at(batch2), end: at(end), shopClose: at(close) }) as Season;
const indigo = season('indigo', '2026-11-05', '2026-11-12', '2026-11-25', '2026-12-02');
const old = season('re-ignition', '2026-06-19', '2026-06-26', '2026-07-16', '2026-07-23');
const ms = (t: string) => Date.parse(t);

const cr = (id: number, col: number, row: number, more: Partial<Criterion> = {}): Criterion => ({
  id,
  col,
  row,
  points: 1,
  numeral: 'I',
  name: `c${id}`,
  desc: null,
  descSource: null,
  icon: '',
  conflict: null,
  key: null,
  locks: [],
  unlockTotal: 0,
  unlockPhase: 1,
  firstClear: 15,
  ...more,
});

const board: Criterion[] = [
  cr(1, 1, 1, { conflict: 'a' }),
  cr(2, 1, 2, { conflict: 'a', points: 3 }),
  cr(3, 2, 1, { key: 'k', conflict: 'key' }),
  cr(4, 2, 2, { key: 'j', conflict: 'key' }),
  cr(5, 3, 1, { locks: ['k'], points: 2 }),
  cr(6, 3, 3, { unlockTotal: 3 }),
  cr(7, 4, 2, { unlockPhase: 2 }),
];

describe('season dates', () => {
  it('derives the status on the player server', () => {
    // 11-05 12:00 UTC+8 opened Asia; Americas is 13 hours behind.
    const t = ms('2026-11-05T06:00:00Z');
    expect(seasonStatus(indigo, t, 'asia')).toBe('live');
    expect(seasonStatus(indigo, t, 'americas')).toBe('upcoming');
    expect(seasonStatus(indigo, ms('2026-11-28T00:00:00Z'), 'asia')).toBe('shop');
    expect(seasonStatus(indigo, ms('2026-12-05T00:00:00Z'), 'asia')).toBe('ended');
  });

  it('names the next date that matters', () => {
    expect(nextDate(indigo, ms('2026-11-01T00:00:00Z'), 'asia')?.label).toBe('Opens');
    expect(nextDate(indigo, ms('2026-11-06T00:00:00Z'), 'asia')?.label).toBe('New criteria');
    expect(nextDate(indigo, ms('2026-11-13T00:00:00Z'), 'asia')?.label).toBe('Combat ends');
    expect(nextDate(indigo, ms('2026-11-28T00:00:00Z'), 'asia')?.label).toBe('Shop closes');
    expect(nextDate(indigo, ms('2026-12-05T00:00:00Z'), 'asia')).toBeNull();
    expect(nextDate({ ...indigo, batch2: null }, ms('2026-11-06T00:00:00Z'), 'asia')?.label).toBe('Combat ends');
  });

  it('opens phase 2 with the second batch, and for finished seasons', () => {
    expect(phaseOf(indigo, ms('2026-11-06T00:00:00Z'), 'asia')).toBe(1);
    expect(phaseOf(indigo, ms('2026-11-13T00:00:00Z'), 'asia')).toBe(2);
    expect(phaseOf({ ...old, batch2: null }, ms('2026-11-13T00:00:00Z'), 'asia')).toBe(2);
  });

  it('leads with the running season, else the next, else the newest', () => {
    const next = season('next', '2027-03-01', '2027-03-08', '2027-03-20', '2027-03-27');
    const ids = (t: string) => seasonsInOrder([old, indigo, next], ms(t), 'asia').map((s) => s.id);
    expect(ids('2026-11-06T00:00:00Z')).toEqual(['indigo', 'next', 're-ignition']);
    expect(ids('2026-12-20T00:00:00Z')).toEqual(['next', 'indigo', 're-ignition']);
    expect(ids('2027-06-01T00:00:00Z')).toEqual(['next', 'indigo', 're-ignition']);
  });
});

describe('criteria selection', () => {
  it('keeps one of a conflict group', () => {
    const one = toggle(board[0], board, EMPTY_SELECTION, 2);
    const other = toggle(board[1], board, one, 2);
    expect(other.ids).toEqual([2]);
  });

  it('needs the key, and drops what needed it when the key goes', () => {
    expect(blockOf(board[4], board, EMPTY_SELECTION, 2)).toEqual({ why: 'key', keys: ['k'] });
    const key = toggle(board[2], board, EMPTY_SELECTION, 2);
    const locked = toggle(board[4], board, key, 2);
    expect(locked.ids).toEqual([3, 5]);
    // Off directly, and by the other key taking its group's place.
    expect(toggle(board[2], board, locked, 2).ids).toEqual([]);
    expect(toggle(board[3], board, locked, 2).ids).toEqual([4]);
  });

  it('opens unlock totals as the selection reaches them, and keeps them open', () => {
    expect(blockOf(board[5], board, EMPTY_SELECTION, 2)).toEqual({ why: 'total', needs: 3 });
    const three = toggle(board[1], board, EMPTY_SELECTION, 2);
    expect(three.best).toBe(3);
    const off = toggle(board[1], board, three, 2);
    expect(off).toEqual({ ids: [], best: 3 });
    expect(blockOf(board[5], board, off, 2)).toBeNull();
  });

  it('waits for phase 2', () => {
    expect(blockOf(board[6], board, EMPTY_SELECTION, 1)).toEqual({ why: 'phase' });
    expect(toggle(board[6], board, EMPTY_SELECTION, 1)).toBe(EMPTY_SELECTION);
    expect(toggle(board[6], board, EMPTY_SELECTION, 2).ids).toEqual([7]);
  });

  it('checks a whole set', () => {
    expect(isLegal(board, [1, 2], 2)).toBe(false);
    expect(isLegal(board, [5], 2)).toBe(false);
    expect(isLegal(board, [7], 1)).toBe(false);
    expect(isLegal(board, [3, 5, 7], 2)).toBe(true);
  });
});

describe('text', () => {
  it('splits the rules into their sections', () => {
    expect(rulesSections('- Event Rules -\n· One\n· Two\n\n- End -\n· Three')).toEqual([
      { title: 'Event Rules', lines: ['One', 'Two'] },
      { title: 'End', lines: ['Three'] },
    ]);
    expect(rulesSections('- First note.\n- Second note.')).toEqual([{ title: '', lines: ['First note.', 'Second note.'] }]);
  });

  it('reads a mission title out of its description', () => {
    const m = (name: string | null, desc: string) => ({ name, desc }) as Mission;
    expect(missionText(m('Cycle Mission I', 'Cycle Mission I: Beat a challenge'))).toEqual({ title: 'Cycle Mission I', text: 'Beat a challenge' });
    expect(missionText(m(null, 'Stress Adaptation: Beat a challenge'))).toEqual({ title: 'Stress Adaptation', text: 'Beat a challenge' });
    expect(missionText(m(null, 'Complete 13 Contract Missions'))).toEqual({ title: 'Complete 13 Contract Missions', text: '' });
  });
});

describe('share code', () => {
  it('matches the game: one octal digit per column, column 1 lowest', () => {
    // Column 1 row 1 and column 2 row 2: octal 21 = 17 = "H", padded to ceil(4 × 3 / 5) = 3.
    expect(encodeShareCode(board, [1, 4], 4)).toBe('00H');
    expect(encodeShareCode(board, [], 4)).toBe('000');
    // 15 columns outgrow a float: 45 bits, 9 characters.
    expect(encodeShareCode([cr(9, 15, 3)], [9], 15)).toBe('G00000000');
  });

  it('gives the examples in ef-assets cc/README.md', () => {
    const indigo = [cr(110001, 1, 1), cr(110101, 2, 1), cr(110302, 12, 2, { key: 'k' }), cr(112901, 15, 1, { locks: ['k'] })];
    expect(encodeShareCode(indigo, [110001, 110101], 23)).toBe('00000000000009');
    expect(encodeShareCode(indigo, [110001, 110302, 112901], 23)).toBe('0000040G000001');
    expect(decodeShareCode('<0000040G000001>', indigo, 23, 2)).toEqual(expect.arrayContaining([110001, 110302, 112901]));
    const reIgnition = [cr(102801, 1, 1), cr(102103, 3, 3)];
    expect(encodeShareCode(reIgnition, [102801, 102103], 24)).toBe('000000000000081');
  });

  it('round-trips, in any case and inside the game\'s chat text', () => {
    const ids = [2, 3, 5, 7];
    const code = encodeShareCode(board, ids, 4);
    expect(decodeShareCode(code, board, 4, 2)).toEqual(expect.arrayContaining(ids));
    expect(decodeShareCode(code.toLowerCase(), board, 4, 2)).toHaveLength(4);
    expect(decodeShareCode(`My total is 7: <${code}>`, board, 4, 2)).toHaveLength(4);
  });

  it('does not ask for unlock totals: they depend on the player', () => {
    expect(decodeShareCode(encodeShareCode(board, [6], 4), board, 4, 2)).toEqual([6]);
  });

  it('rejects wrong codes', () => {
    expect(decodeShareCode('', board, 4, 2)).toBeNull();
    expect(decodeShareCode('00', board, 4, 2)).toBeNull();
    // Letters outside the alphabet.
    expect(decodeShareCode('00I', board, 4, 2)).toBeNull();
    // An empty cell: column 2 row 3.
    expect(decodeShareCode('010', board, 4, 2)).toBeNull();
    // Beyond the last column.
    expect(decodeShareCode('ZZZ', board, 4, 2)).toBeNull();
    // A conflict, a missing key, a phase not open yet.
    expect(decodeShareCode(encodeShareCode(board, [1, 2], 4), board, 4, 2)).toBeNull();
    expect(decodeShareCode(encodeShareCode(board, [5], 4), board, 4, 2)).toBeNull();
    expect(decodeShareCode(encodeShareCode(board, [7], 4), board, 4, 1)).toBeNull();
  });
});
