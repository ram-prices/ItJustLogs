import { describe, expect, it } from 'vitest';
import { mergeSims, type SavedSim } from './store';

const sim = (at: number, extra: Partial<SavedSim> = {}): SavedSim => ({ key: '{"video":true}', at, result: { n: at }, names: [], ids: [], ...extra });

describe('backup runs', () => {
  it('round trips through JSON into empty storage', () => {
    const runs = [sim(1, { edited: 5, name: 'a' }), sim(2, { fav: true })];
    const back = JSON.parse(JSON.stringify({ app: 'itjustlogs', version: 1, sims: runs })).sims;
    expect(mergeSims([], back)).toEqual(runs);
  });
  it('keeps the later edit for a run present on both sides', () => {
    const local = [sim(1, { edited: 10, name: 'local' }), sim(3)];
    const merged = mergeSims(local, [sim(1, { edited: 20, name: 'backup' }), sim(2), sim(3, { edited: 0, name: 'older' })]);
    expect(merged.map((e) => e.at)).toEqual([1, 2, 3]);
    expect(merged[0].name).toBe('backup');
    expect(merged[2].name).toBeUndefined();
    expect(mergeSims(local, [sim(1, { edited: 5, name: 'old' })])[0].name).toBe('local');
  });
  it('an old backup without sims changes nothing', () => {
    const local = [sim(1)];
    expect(mergeSims(local, [])).toEqual(local);
  });
});
