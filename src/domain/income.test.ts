import { describe, expect, it } from 'vitest';
import type { EventRewardsFile } from './eventRewards';
import { dailyResets, patchIncome, patchWindows, ticketsFromPulls, weeklyResets, type IncomeFile } from './income';
import { hasDailyRewards, type Schedule, type ScheduleEvent } from './schedule';

const at = (americas: string, asia: string) => ({ americas, asia });
const attribution = { source: '', url: '', license: '', licenseUrl: '', note: '', fetched: '' };

// Launch on a Wednesday evening (Americas), 1.1 three weeks later. The next
// version isn't announced: 1.1's last event ends at its update (Mar 4).
const schedule: Schedule = {
  versions: [
    { name: 'Launch', release: at('2026-01-21T22:00:00-05:00', '2026-01-22T11:00:00+08:00'), maintenance: null, posts: [] },
    { name: 'Second', release: at('2026-02-11T23:00:00-05:00', '2026-02-12T12:00:00+08:00'), maintenance: null, posts: [] },
  ],
  banners: [
    { name: 'Rate-up', kind: 'chartered', rateUps: [], poolId: null, version: 'Second', start: null, end: null, availability: null, art: null, posts: [] },
    { name: 'Weapons', kind: 'issue', rateUps: [], poolId: null, version: 'Second', start: null, end: null, availability: null, art: null, posts: [] },
  ],
  events: [
    {
      id: 1,
      name: 'Sign-in',
      type: '',
      version: 'Second',
      start: at('2026-02-11T23:00:00-05:00', '2026-02-12T12:00:00+08:00'),
      end: at('2026-03-04T17:00:00-05:00', '2026-03-04T17:00:00+08:00'),
      details: null,
      post: '',
    },
    // No version: counted by when it starts.
    { id: 2, name: 'Story', type: '', version: null, start: at('2026-01-25T04:00:00-05:00', '2026-01-25T04:00:00+08:00'), end: null, details: null, post: '' },
    { id: 3, name: 'Not on the wiki', type: '', version: 'Second', start: at('2026-02-13T04:00:00-05:00', '2026-02-13T04:00:00+08:00'), end: null, details: null, post: '' },
    // Starts after NOW: still counted, the current version being projected to its end.
    { id: 4, name: 'Later', type: '', version: 'Second', start: at('2026-02-25T12:00:00-05:00', '2026-02-25T12:00:00+08:00'), end: null, details: null, post: '' },
  ],
} as Schedule;

const events: EventRewardsFile = {
  attribution,
  fetched: '',
  events: {
    1: { name: 'Sign-in', page: '', url: '', totals: { 'Sign-in HH Permit': 5, Oroberyl: 1000 }, groups: [] },
    2: { name: 'Story', page: '', url: '', partial: true, totals: { Oroberyl: 500, 'Arsenal Ticket': 990 }, groups: [] },
    4: { name: 'Later', page: '', url: '', totals: { Oroberyl: 300 }, groups: [] },
  },
  extra: {
    // Announced mid-version: counted for the version it starts in.
    'Mid Sign-In': {
      name: 'Mid Sign-In',
      type: 'Sign-In',
      page: 'Mid Sign-In',
      url: 'https://wiki/Mid',
      start: { asia: '2026-02-20T04:00:00Z', americas: '2026-02-20T17:00:00Z' },
      totals: { Oroberyl: 500, 'Basic HH Permit': 2 },
      groups: [],
    },
  },
};

const income: IncomeFile = {
  attribution,
  fetched: '',
  daily: { url: '', rewards: { Oroberyl: 200 } },
  weekly: { url: '', rewards: { Oroberyl: 500, 'Arsenal Ticket': 100 } },
  passes: [
    { name: 'One', version: 'Zeroth', start: '2026-01-22T03:00:00Z', end: null, url: '', rewards: { Oroberyl: 600 } },
    {
      name: 'Two',
      version: 'Second',
      start: '2026-02-12T04:00:00Z',
      end: null,
      url: '',
      rewards: { Oroberyl: 600, 'Basic HH Permit': 2 },
      originium: { Origeometry: 32, 'Basic HH Permit': 4 },
      customized: { Origeometry: 16, 'Arsenal Ticket': 2400 },
    },
  ],
  passTiers: { url: '', originium: { cost: { Origeometry: 29 } }, customized: { price: '$9.99', onPurchase: { Origeometry: 20 } } },
  monthly: { url: '', price: '$4.99', days: 30, onPurchase: { Origeometry: 12 }, daily: { Oroberyl: 200 } },
  compensation: { source: '', versions: { Second: { url: '', rows: [{ label: 'Bug Fix Compensation', rewards: { Oroberyl: 900 } }] } } },
  quests: {
    source: '',
    caps: {},
    versions: {
      Launch: [{ name: 'Prologue', type: 'Main Mission', url: '', rewards: { Origeometry: 4 }, how: 'story' }],
      Second: [
        { name: 'Chapter', type: 'Main Mission', url: '', rewards: { Origeometry: 2 }, how: 'story' },
        { name: 'Side', type: 'Side Mission', url: '', rewards: { Oroberyl: 200 }, how: 'listed' },
      ],
    },
  },
  exploration: {
    source: '',
    crateOroberyl: {},
    mix: {},
    perCrate: 40,
    sources: [],
    versions: {
      Launch: [{ area: 'Old Area', url: '', crates: 10, aurylene: 0, chests: 12, rewards: { Oroberyl: 300 } }],
      Second: [{ area: 'New Area', url: '', crates: 25, aurylene: 10 }],
    },
    outposts: { Second: [{ outpost: 'New Outpost', url: '', rewards: { Oroberyl: 320 } }] },
    aurylene: { url: '', versions: { Launch: { rewards: { Origeometry: 4 } }, Second: { rewards: { Origeometry: 2 }, partial: "Wuling's table ends at 190" } } },
  },
  extras: {
    livestream: { label: '', note: '', sources: [], perVersion: { Oroberyl: 1000 }, fromVersion: 1, confirmed: [] },
    survey: { label: '', note: '', sources: [], perVersion: { Oroberyl: 300 }, fromVersion: 0 },
    combatDrills: { label: '', note: '', sources: [], perBanner: { Oroberyl: 100 }, kinds: ['chartered'] },
  },
  modes: {
    source: '',
    versions: {
      Second: [
        { name: 'Echoes of War', from: 'notes', url: '', rewards: { Oroberyl: 600 } },
        { name: 'Delver of the Cryptic', from: 'notes', url: '', rewards: {}, partial: true },
      ],
    },
  },
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

  it('spans each released version until the next one, projecting the current one', () => {
    const w = patchWindows(schedule, 'americas', NOW);
    expect(w.map((x) => [x.key, x.version, x.ongoing, x.projected])).toEqual([
      ['1.0', 'Launch', false, false],
      ['1.1', 'Second', true, true],
    ]);
    // Not announced: the version's last banner or event end.
    expect(w[1].end).toBe(Date.parse('2026-03-04T22:00:00Z'));
    // Announced: the next version's release.
    const next = { ...schedule, versions: [...schedule.versions, { name: 'Third', release: at('2026-03-01T23:00:00-05:00', '2026-03-02T12:00:00+08:00'), maintenance: null, posts: [] }] };
    expect(patchWindows(next, 'americas', NOW)[1].end).toBe(Date.parse('2026-03-02T04:00:00Z'));
    // Neither: until now.
    const bare = { ...schedule, events: [] };
    expect(patchWindows(bare, 'americas', NOW)[1]).toMatchObject({ end: NOW, ongoing: true, projected: false });
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
    // 22×200 + 4×500 + 500 + 600 Oroberyl + 4 Origeometry from quests (300) = 7,800, plus 4 Origeometry from
    // Aurylene (300), the survey (300) and the old area's 12 chests as the game lists them (300) = 8,700 → 17.4 pulls.
    // No livestream at launch. 400 + 990 tickets → 1,390 / 1,980 Issues × 10.
    expect(by(launch).quests.count).toBe(1);
    expect(by(launch).livestream).toBeUndefined();
    expect(by(launch).crates).toMatchObject({ count: 12, totals: { Oroberyl: 300 }, estimate: false });
    expect(launch.headhunting).toBeCloseTo((7800 + 300 + 300 + 300) / 500);
    expect(launch.arsenal).toBeCloseTo((1390 / 1980) * 10);

    // Second: an event missing from the wiki file still counts (as partial); so does one not started yet.
    const ev = by(second).events;
    expect(ev.events!.map((e) => [e.name, e.pulls, e.partial])).toEqual([
      ['Sign-in', 7, false],
      ['Not on the wiki', 0, true],
      ['Later', 0.6, false],
      ['Mid Sign-In', 1, false],
    ]);
    expect(ev.events!.at(-1)!.url).toBe('https://wiki/Mid');
    // One new Chartered banner: its Combat Drills (Issues don't count).
    expect(by(second).combatDrills).toMatchObject({ count: 1, totals: { Oroberyl: 100 } });
    expect(by(second).pass.totals['Basic HH Permit']).toBe(2);
    expect(by(second).daily.count).toBe(21); // Feb 12 04:00 … Mar 4 04:00
    expect(by(second).weekly.count).toBe(3); // Feb 16, 23, Mar 2
    expect(by(second).compensation.totals).toEqual({ Oroberyl: 900 });
    // Quests count for the version that released them.
    expect(by(second).quests.quests!.map((q) => q.name)).toEqual(['Chapter', 'Side']);
    expect(by(second).quests.totals).toEqual({ Origeometry: 2, Oroberyl: 200 });
    // The new area's 25 crates at ~40 Oroberyl each, marked as an estimate.
    expect(by(second).crates).toMatchObject({ count: 25, totals: { Oroberyl: 1000 }, estimate: true });
    // Its modes (one named without amounts: partial) and its new outpost.
    expect(by(second).modes).toMatchObject({ count: 2, totals: { Oroberyl: 600 }, partial: true });
    expect(by(second).outposts.totals).toEqual({ Oroberyl: 320 });
    // Aurylene past the end of the wiki's table: partial, saying why; a livestream not confirmed for this version: an estimate.
    expect(by(second).aurylene).toMatchObject({ totals: { Origeometry: 2 }, partial: true, note: "Wuling's table ends at 190" });
    expect(by(second).livestream).toMatchObject({ totals: { Oroberyl: 1000 }, estimate: true });
    // 1,300 events + 4,200 daily + 1,500 weekly + 600 pass + 900 compensation + 200 + 150 quests + 1,000 crates
    // + 600 modes + 320 outpost + 150 Aurylene + 1,000 livestream + 300 survey + 500 mid-version sign-in
    // + 100 Combat Drills = 12,820 Oroberyl, plus 5 Sign-in permits; Basic HH Permits apart.
    expect(second.headhunting).toBeCloseTo(12820 / 500 + 5);
    expect(second.basic).toBe(4); // the pass's 2 and the mid-version sign-in's 2
  });

  it('adds the paid pass tiers and the Monthly Pass only when asked', () => {
    const free = patchIncome(schedule, 'americas', NOW, events, income)[1];
    const paid = patchIncome(schedule, 'americas', NOW, events, income, ['originium', 'customized', 'monthly'])[1];
    const by = Object.fromEntries(paid.lines.map((l) => [l.source, l]));
    expect(free.lines.some((l) => l.paid)).toBe(false);
    // Originium Supply: 32 Origeometry back for the 29 it costs, and 4 permits.
    expect(by.originium.totals).toEqual({ Origeometry: 3, 'Basic HH Permit': 4 });
    // Protocol Customized: its 16 Origeometry plus 20 on purchase, and 2,400 Arsenal Tickets.
    expect(by.customized.totals).toEqual({ Origeometry: 36, 'Arsenal Ticket': 2400 });
    // Monthly Pass: 21 days × 200 Oroberyl, and 21/30 of a purchase's 12 Origeometry.
    expect(by.monthly.count).toBe(21);
    expect(by.monthly.totals.Oroberyl).toBe(4200);
    expect(by.monthly.totals.Origeometry).toBeCloseTo(8.4);
    // (3 + 36 + 8.4) Origeometry × 75 + 4,200 Oroberyl = 7,755 Oroberyl → 15.51 pulls; the 4 Basic HH Permits apart.
    expect(paid.headhunting - free.headhunting).toBeCloseTo(15.51);
    expect(paid.basic - free.basic).toBe(4);
    expect(paid.arsenal - free.arsenal).toBeCloseTo((2400 / 1980) * 10);
    // Only the parts asked for.
    expect(patchIncome(schedule, 'americas', NOW, events, income, ['monthly'])[1].lines.filter((l) => l.paid).map((l) => l.source)).toEqual(['monthly']);
  });

  it('estimates what the wiki names without amounts from others of its kind', () => {
    const withMore: EventRewardsFile = {
      ...events,
      events: {
        ...events.events,
        // Two narratives with amounts (600, 600) and one without (partial, nothing listed).
        3: { name: 'Not on the wiki', page: '', url: '', partial: true, totals: {}, groups: [] },
      },
      extra: {
        ...events.extra,
        'Story A': { name: 'Story A', type: 'Narrative', page: '', url: '', start: { asia: '2026-01-25T00:00:00Z', americas: '2026-01-25T00:00:00Z' }, totals: { Oroberyl: 600 }, groups: [] },
        'Story B': { name: 'Story B', type: 'Narrative', page: '', url: '', start: { asia: '2026-01-26T00:00:00Z', americas: '2026-01-26T00:00:00Z' }, totals: { Oroberyl: 600 }, groups: [] },
      },
    };
    const narrative = { ...schedule, events: schedule.events!.map((e) => (e.id === 3 ? { ...e, type: 'Narrative Event' } : e)) };
    const withModes: IncomeFile = {
      ...income,
      modes: {
        source: '',
        versions: {
          Launch: [{ name: 'Delver of the Cryptic', from: 'notes', url: '', rewards: { Oroberyl: 1200 } }],
          Second: [{ name: 'Delver of the Cryptic', from: 'notes', url: '', rewards: {}, partial: true }],
        },
      },
    };
    const second = patchIncome(narrative, 'americas', NOW, withMore, withModes)[1];
    const by = Object.fromEntries(second.lines.map((l) => [l.source, l]));
    expect(by.events.events!.find((e) => e.name === 'Not on the wiki')).toMatchObject({ pulls: 1.2, partial: false, estimated: true });
    expect(by.events.estimate).toBe(true);
    expect(by.modes.modes![0]).toMatchObject({ rewards: { Oroberyl: 1200 }, estimated: true });
  });

  it('adds one-time rewards by section, and the Credit Store every day', () => {
    const more: IncomeFile = {
      ...income,
      shops: { aic: { url: '', price: 175, perBanner: 0, kinds: [], versions: {} }, bond: { url: '', price: 25, duplicate: {} }, credit: { url: 'c', perDay: { Oroberyl: 12.5, 'Arsenal Ticket': 10 } } },
      oneTime: {
        source: '',
        versions: {
          Launch: [
            { name: 'Simulations', section: 'modes', url: '', rewards: { Oroberyl: 1570 }, count: 36 },
            { name: 'Regional Development: Wuling', section: 'exploration', url: '', rewards: { Oroberyl: 1000, 'Basic HH Permit': 5 }, count: 5, estimate: true },
            { name: 'Launch codes', section: 'mailbox', url: '', rewards: { Oroberyl: 2150 }, count: 3 },
          ],
        },
      },
    };
    const [launch, second] = patchIncome(schedule, 'americas', NOW, null, more);
    const once = launch.lines.filter((l) => l.source === 'oneTime');
    expect(once.map((l) => [l.section, l.count, l.totals.Oroberyl, !!l.estimate])).toEqual([
      ['modes', 36, 1570, false],
      ['exploration', 5, 1000, true],
      ['mailbox', 3, 2150, false],
    ]);
    expect(second.lines.some((l) => l.source === 'oneTime')).toBe(false);
    // 22 days at launch: 275 Oroberyl and 220 Arsenal Tickets.
    expect(launch.lines.find((l) => l.source === 'creditStore')).toMatchObject({ count: 22, totals: { Oroberyl: 275, 'Arsenal Ticket': 220 }, estimate: true });
  });

  it("leaves out limited-time rewards that ended before the player's first pull", () => {
    const since = Date.parse('2026-02-15T12:00:00Z');
    const ended = { ...schedule, events: schedule.events!.map((e) => (e.id === 2 ? { ...e, end: at('2026-02-01T04:00:00-05:00', '2026-02-01T04:00:00+08:00') } : e)) } as Schedule;
    const more: IncomeFile = {
      ...income,
      oneTime: {
        source: '',
        versions: {
          Launch: [
            { name: 'Mail', section: 'mailbox', url: '', rewards: { Oroberyl: 4920 }, count: 1, until: '2026-02-01T00:00:00Z' },
            { name: 'Simulations', section: 'modes', url: '', rewards: { Oroberyl: 1570 }, count: 36 },
          ],
        },
      },
    };
    const [launch, second] = patchIncome(ended, 'americas', NOW, events, more, [], since);
    const sources = launch.lines.map((l) => l.source);
    // Launch ended before the first pull: no dailies, weeklies, ended events or expired mail; permanent rewards stay.
    expect(sources).not.toContain('daily');
    expect(sources).not.toContain('weekly');
    expect(sources).not.toContain('events');
    expect(launch.lines.find((l) => l.source === 'oneTime')!.oneTime!.map((x) => x.name)).toEqual(['Simulations']);
    expect(sources).toContain('quests');
    // Second: days from the first pull (its day counts), and it begins then for the player.
    const daily = second.lines.find((l) => l.source === 'daily')!;
    expect(daily.count).toBe(dailyResets(since, second.end, 'americas') + 1);
    expect(second.start).toBe(since);
    expect(second.lines.some((l) => l.source === 'compensation')).toBe(true);
  });

  it('works without the wiki files', () => {
    expect(patchIncome(schedule, 'asia', NOW, null, null).every((p) => p.lines.length === 0 && p.headhunting === 0)).toBe(true);
  });

  it('gives Arsenal Tickets back for Headhunting results only', () => {
    expect(ticketsFromPulls([{ kind: 'char', rarity: 6 }, { kind: 'char', rarity: 5 }, { kind: 'char', rarity: 4 }, { kind: 'weap', rarity: 6 }])).toBe(2220);
  });
});

describe('daily rewards', () => {
  const ev = (type: string, details: string | null, name = 'X'): ScheduleEvent => ({ name, type, details, version: null, start: null, end: null, post: '' });
  it('tags sign-ins, daily logins and daily missions', () => {
    expect(hasDailyRewards(ev('Sign-In Event', null))).toBe(true);
    expect(hasDailyRewards(ev('Tribute Event', 'Log in every day during the event to receive [Oroberyl]×200'))).toBe(true);
    expect(hasDailyRewards(ev('Limited-Time Event', 'During the event, complete specified missions every day to claim rewards'))).toBe(true);
    expect(hasDailyRewards(ev('Narrative Event', 'Complete event missions to earn [Oroberyl]'))).toBe(false);
  });
  it('takes a detail-less event from another of its name', () => {
    const daily = ev('Limited-Time Event', 'complete specified missions every day', 'Sanity Supply');
    const bare = ev('Limited-Time Event', null, 'Sanity Supply');
    expect(hasDailyRewards(bare, { versions: [], banners: [], events: [daily, bare] } as unknown as Schedule)).toBe(true);
    expect(hasDailyRewards(bare)).toBe(false);
  });
});
