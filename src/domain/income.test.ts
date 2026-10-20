import { describe, expect, it } from 'vitest';
import type { EventRewardsFile } from './eventRewards';
import { dailyResets, patchIncome, patchWindows, ticketsFromPulls, weeklyResets, type IncomeFile } from './income';
import type { Schedule } from './schedule';

const at = (americas: string, asia: string) => ({ americas, asia });
const attribution = { source: '', url: '', license: '', licenseUrl: '', note: '', fetched: '' };

// Launch on a Wednesday evening (Americas), 1.1 three weeks later.
const schedule: Schedule = {
  versions: [
    { name: 'Launch', release: at('2026-01-21T22:00:00-05:00', '2026-01-22T11:00:00+08:00'), maintenance: null, posts: [] },
    { name: 'Second', release: at('2026-02-11T23:00:00-05:00', '2026-02-12T12:00:00+08:00'), maintenance: null, posts: [] },
    { name: 'Future', release: at('2026-12-01T23:00:00-05:00', '2026-12-02T12:00:00+08:00'), maintenance: null, posts: [] },
  ],
  banners: [],
  events: [
    { id: 1, name: 'Sign-in', type: '', version: 'Second', start: at('2026-02-11T23:00:00-05:00', '2026-02-12T12:00:00+08:00'), end: null, details: null, post: '' },
    // No version: counted by when it starts.
    { id: 2, name: 'Story', type: '', version: null, start: at('2026-01-25T04:00:00-05:00', '2026-01-25T04:00:00+08:00'), end: null, details: null, post: '' },
    { id: 3, name: 'Not on the wiki', type: '', version: 'Second', start: at('2026-02-13T04:00:00-05:00', '2026-02-13T04:00:00+08:00'), end: null, details: null, post: '' },
  ],
} as Schedule;

const events: EventRewardsFile = {
  attribution,
  fetched: '',
  events: {
    1: { name: 'Sign-in', page: '', url: '', totals: { 'Sign-in HH Permit': 5, Oroberyl: 1000 }, groups: [] },
    2: { name: 'Story', page: '', url: '', partial: true, totals: { Oroberyl: 500, 'Arsenal Ticket': 990 }, groups: [] },
  },
};

const income: IncomeFile = {
  attribution,
  fetched: '',
  daily: { url: '', rewards: { Oroberyl: 200 } },
  weekly: { url: '', rewards: { Oroberyl: 500, 'Arsenal Ticket': 100 } },
  passes: [
    { name: 'One', version: 'Zeroth', start: '2026-01-22T03:00:00Z', end: null, url: '', rewards: { Oroberyl: 600 } },
    { name: 'Two', version: 'Second', start: '2026-02-12T04:00:00Z', end: null, url: '', rewards: { Oroberyl: 600, 'Basic HH Permit': 2 } },
  ],
};

const NOW = Date.parse('2026-02-20T12:00:00Z');

describe('free income per patch', () => {
  it('counts resets at 04:00 server time', () => {
    // Americas (UTC-5): 04:00 there is 09:00 UTC.
    expect(dailyResets(Date.parse('2026-02-01T08:59:00Z'), Date.parse('2026-02-01T09:00:00Z'), 'americas')).toBe(1);
    expect(dailyResets(Date.parse('2026-02-01T09:00:00Z'), Date.parse('2026-02-02T08:59:00Z'), 'americas')).toBe(0);
    // Asia (UTC+8): 04:00 there is 20:00 UTC the day before.
    expect(dailyResets(Date.parse('2026-02-01T19:59:00Z'), Date.parse('2026-02-01T20:00:00Z'), 'asia')).toBe(1);
    // Monday 2026-02-02 04:00 Americas; Sunday night doesn't count.
    expect(weeklyResets(Date.parse('2026-01-28T12:00:00Z'), Date.parse('2026-02-02T08:59:00Z'), 'americas')).toBe(0);
    expect(weeklyResets(Date.parse('2026-01-28T12:00:00Z'), Date.parse('2026-02-02T09:00:00Z'), 'americas')).toBe(1);
  });

  it('spans each released version until the next one, the current one until now', () => {
    const w = patchWindows(schedule, 'americas', NOW);
    expect(w.map((x) => [x.key, x.version, x.ongoing])).toEqual([
      ['1.0', 'Launch', false],
      ['1.1', 'Second', true],
    ]);
    expect(w[1].end).toBe(NOW);
  });

  it('adds events, dailies, weeklies and the pass into pulls', () => {
    const [launch, second] = patchIncome(schedule, 'americas', NOW, events, income);
    const by = (p: typeof launch) => Object.fromEntries(p.lines.map((l) => [l.source, l]));

    // Launch: 2026-01-21 22:00 to 2026-02-11 23:00 (Americas): 21 resets + launch day, 3 Mondays + launch week.
    expect(by(launch).daily.count).toBe(22);
    expect(by(launch).weekly.count).toBe(4);
    expect(by(launch).events.events!.map((e) => e.name)).toEqual(['Story']);
    expect(by(launch).pass.name).toBe('One');
    expect(launch.partial).toBe(true);
    // 22×200 + 4×500 + 500 + 600 Oroberyl = 7,500 → 15 pulls; 400 + 990 tickets → 1,390 / 1,980 Issues × 10.
    expect(launch.headhunting).toBe(15);
    expect(launch.arsenal).toBeCloseTo((1390 / 1980) * 10);

    // Second: an event missing from the wiki file still counts (as partial).
    const ev = by(second).events;
    expect(ev.events!.map((e) => [e.name, e.pulls, e.partial])).toEqual([
      ['Sign-in', 7, false],
      ['Not on the wiki', 0, true],
    ]);
    expect(by(second).pass.totals['Basic HH Permit']).toBe(2);
    expect(by(second).daily.count).toBe(9); // Feb 12 04:00 … Feb 20 04:00
  });

  it('works without the wiki files', () => {
    expect(patchIncome(schedule, 'asia', NOW, null, null).every((p) => p.lines.length === 0 && p.headhunting === 0)).toBe(true);
  });

  it('gives Arsenal Tickets back for Headhunting results only', () => {
    expect(ticketsFromPulls([{ kind: 'char', rarity: 6 }, { kind: 'char', rarity: 5 }, { kind: 'char', rarity: 4 }, { kind: 'weap', rarity: 6 }])).toBe(2220);
  });
});
