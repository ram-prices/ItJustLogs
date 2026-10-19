import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import db from '../data/banners.snapshot.json';
import { analyze } from './analyze';
import { canonicalPoolId, categoryOf, patchOf } from './banners';
import { compareHistories, mergeHistories, missingPulls, parseHistoryJson } from './parse';
import { weeklyTimeline, patchStats } from './patches';
import {
  CHARTERED,
  WEAPON,
  cdfAt,
  expectedSixStarRate,
  kthCopyPmf,
  pullsForChance,
  rateUpPmf,
} from './pity';
import scheduleSnapshot from '../data/schedule.snapshot.json';
import { discordText, guessServer, packLanes, statusOf, timeOn, type Schedule, type ScheduleBanner } from './schedule';
import type { BannerDb, PullHistory } from './types';

const bannerDb = db as BannerDb;
const total = (pmf: Float64Array) => pmf.reduce((a, b) => a + b, 0);

describe('pity math', () => {
  it('matches the known long-run 6★ rates', () => {
    expect(1 / expectedSixStarRate(CHARTERED)).toBeCloseTo(54.3, 0);
    expect(expectedSixStarRate(WEAPON) * 100).toBeCloseTo(4.97, 1);
  });

  it('forces the rate-up on the guarantee pull', () => {
    const pmf = rateUpPmf(CHARTERED, { guaranteeAt: 120 });
    expect(cdfAt(pmf, 120)).toBeCloseTo(1, 12);
    expect(pmf[121]).toBe(0);
  });

  it('handles starting pity right below hard pity (eftracker produced an all-zero PMF at hard pity)', () => {
    const pmf = rateUpPmf(CHARTERED, { startPity: 79 });
    expect(pmf[1]).toBeCloseTo(0.5, 12);
    expect(total(pmf)).toBeCloseTo(1, 6);
    // Values ≥ hard pity are clamped rather than silently producing zeros.
    expect(total(rateUpPmf(CHARTERED, { startPity: 80 }))).toBeCloseTo(1, 6);
  });

  it('banked pity only ever helps', () => {
    const fresh = rateUpPmf(CHARTERED, { guaranteeAt: 120 });
    const banked = rateUpPmf(CHARTERED, { guaranteeAt: 120, startPity: 60 });
    for (const n of [10, 30, 60, 100]) expect(cdfAt(banked, n)).toBeGreaterThan(cdfAt(fresh, n));
  });

  it('later copies take longer', () => {
    const one = kthCopyPmf(WEAPON, 1, { guaranteeAt: 80 });
    const two = kthCopyPmf(WEAPON, 2, { guaranteeAt: 80 });
    expect(cdfAt(two, 80)).toBeLessThan(cdfAt(one, 80));
    expect(pullsForChance(one, 1)).toBeLessThanOrEqual(80);
  });
});

describe('banner ids', () => {
  it('normalizes the game’s weponbox spelling', () => {
    expect(canonicalPoolId('WeaponBox_1_0_1')).toBe('weponbox_1_0_1');
    expect(canonicalPoolId('weaponbox_constant_1')).toBe('weaponbox_constant_1');
  });
  it('maps pools to categories and patches', () => {
    expect(categoryOf('char', 'special_1_4_2')).toBe('chartered');
    expect(categoryOf('char', 'joint_1_2_2')).toBe('joint');
    expect(categoryOf('weap', 'weaponbox_constant_2')).toBe('constant');
    expect(patchOf('special_1_4_2').key).toBe('1.4');
    expect(patchOf('weaponbox_constant_2').key).toBe('Permanent');
    expect(patchOf('standard').key).toBe('Permanent');
  });
});

describe('import + merge', () => {
  const a = { seqId: '2', gachaTs: '2000', charId: 'chr_a', rarity: 4, poolId: 'standard' };
  const b = { seqId: '1', gachaTs: '1000', charId: 'chr_b', rarity: 4, poolId: 'standard' };
  const c = { seqId: '3', gachaTs: '3000', charId: 'chr_c', rarity: 6, poolId: 'standard' };

  it('accepts eftracker backups and bare arrays', () => {
    expect(parseHistoryJson(JSON.stringify({ efTrackerData: JSON.stringify({ characters: [a], weapons: [] }) })).characters).toHaveLength(1);
    expect(parseHistoryJson(JSON.stringify([a, { weaponId: 'w', seqId: '1' }])).weapons).toHaveLength(1);
    expect(() => parseHistoryJson('{"foo":1}')).toThrow();
  });

  it('dedupes overlapping exports and keeps newest first', () => {
    const { history, added } = mergeHistories(
      { characters: [a, b], weapons: [] },
      { characters: [c, a], weapons: [] },
    );
    expect(added.char).toBe(1);
    expect(history.characters.map((r) => r.seqId)).toEqual(['3', '2', '1']);
  });
});

describe('Arsenal sets of 10', () => {
  // Bedazzled Issue: rate-up is wpn_lance_0014. Everything else here is filler.
  const weap = (n: number, rarity = 4, weaponId = 'wpn_filler') => ({
    seqId: String(n),
    gachaTs: String(1_000_000 + n),
    weaponId,
    weaponName: weaponId,
    rarity,
    poolId: 'weponbox_1_4_2',
  });
  const run = (count: number, sixes: Record<number, string>) => {
    const weapons = Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      return sixes[n] ? weap(n, 6, sixes[n]) : weap(n);
    });
    const a = analyze({ characters: [], weapons } as unknown as PullHistory, bannerDb);
    return a.banners.find((b) => b.poolId === 'weponbox_1_4_2')!;
  };

  it('rewards (rate-up copies, Selectors) are not pulls', () => {
    const gift = (n: number, kind: string) => ({ seqId: String(n), gachaTs: String(1_000_000 + n), kind, nameText: 'Reward', poolId: 'weponbox_1_4_2' });
    const weapons = [...Array.from({ length: 180 }, (_, i) => weap(i + 1)), gift(181, 'gift_weapon_box'), gift(182, 'gift_weapon')];
    const b = analyze({ characters: [], weapons } as unknown as PullHistory, bannerDb).banners.find((x) => x.poolId === 'weponbox_1_4_2')!;
    expect(b.pulls).toHaveLength(180);
    expect(b.paidPulls).toBe(180);
  });

  it('a 6★ on pull 28 lands in set 3, so the guarantee is at 3/8', () => {
    const b = run(30, { 28: 'wpn_offbanner' });
    const six = b.pulls.find((p) => p.rarity === 6)!;
    expect(six.pity).toBe(3);
    expect(b.pity).toMatchObject({ value: 0, max: 4 });
    expect(b.guarantee).toMatchObject({ value: 3, max: 8, done: false });
    expect(b.rewards).toMatchObject({ progress: 3, goal: 10, nextReward: 'Selector' });
  });

  it('pity counts whole sets after the set with the last 6★', () => {
    const b = run(60, { 28: 'wpn_offbanner' });
    expect(b.pity.value).toBe(3); // sets 4, 5, 6
    expect(b.guarantee!.value).toBe(6);
    const later = run(40, { 28: 'wpn_offbanner', 35: 'wpn_offbanner2' });
    expect(later.pulls.filter((p) => p.rarity === 6).map((p) => p.pity)).toEqual([3, 1]);
  });

  it('two 6★ in the same set share that set’s pity', () => {
    const b = run(30, { 21: 'wpn_offbanner', 28: 'wpn_offbanner2' });
    expect(b.pulls.filter((p) => p.rarity === 6).map((p) => p.pity)).toEqual([3, 3]);
  });

  it('the guarantee is the 8th set', () => {
    const b = run(80, { 75: 'wpn_lance_0014' });
    const six = b.pulls.find((p) => p.rarity === 6)!;
    expect(six.outcome).toBe('guaranteed');
    expect(b.guarantee).toMatchObject({ value: 8, done: true });
  });

  it('rewards: Selector at set 10, then every 8 sets alternating rate-up copy and Selector', () => {
    expect(run(90, {}).rewards).toMatchObject({ earned: 0, progress: 9, goal: 10, nextReward: 'Selector', copies: 0 });
    expect(run(100, {}).rewards).toMatchObject({ earned: 1, progress: 0, goal: 8, nextReward: 'Rate-up copy', copies: 0 });
    expect(run(180, {}).rewards).toMatchObject({ earned: 2, progress: 0, goal: 8, nextReward: 'Selector', copies: 1 });
    expect(run(250, {}).rewards).toMatchObject({ earned: 2, progress: 7, goal: 8, nextReward: 'Selector', copies: 1 });
    expect(run(340, {}).rewards).toMatchObject({ earned: 4, copies: 2, nextReward: 'Selector' });
    const points = run(100, {}).rewards!.milestones(42).map((m) => `${m.at}:${m.name}`);
    expect(points).toEqual(['10:Selector', '18:Rate-up copy', '26:Selector', '34:Rate-up copy', '42:Selector']);
  });
});

const FIXTURE = new URL('../../fixtures/pull_history.json', import.meta.url);

// fixtures/ is gitignored personal data, so CI won't have it. The describe body runs even
// when skipped, so the file is only read in beforeAll.
describe.runIf(existsSync(FIXTURE))('real pull history fixture', () => {
  let history: PullHistory;
  let result: ReturnType<typeof analyze>;
  beforeAll(() => {
    history = parseHistoryJson(readFileSync(FIXTURE, 'utf8'));
    result = analyze(history, bannerDb);
  });

  it('counts every record except banner rewards (gift_*)', () => {
    const pulls = result.banners.reduce((n, b) => n + b.pulls.length, 0);
    const gifts = [...history.characters, ...history.weapons].filter((r) => String(r.kind ?? '').startsWith('gift_')).length;
    expect(pulls).toBe(history.characters.length + history.weapons.length - gifts);
  });

  it('never exceeds hard pity and resets on every 6★', () => {
    for (const b of result.banners) {
      for (const p of b.pulls) {
        // Arsenal pity is counted in sets of 10, out of 4.
        if (p.pity !== null) expect(p.pity).toBeLessThanOrEqual(b.kind === 'weap' ? 4 : 80);
      }
    }
  });

  it('classifies every paid 6★ on a rate-up banner', () => {
    for (const s of result.sixStars) {
      const banner = result.banners.find((b) => b.poolId === s.poolId && b.kind === s.kind)!;
      if (!s.isFree && banner.info && banner.category !== 'joint') expect(s.outcome).toBeDefined();
      if (s.outcome === 'won') expect(s.luck).toBeGreaterThan(0);
    }
  });

  it('builds patch and timeline views that account for every paid pull', () => {
    const patches = patchStats(result, bannerDb);
    const fromPatches = patches.reduce((n, p) => n + p.charPulls + p.weapPulls, 0);
    expect(fromPatches).toBe(result.char.pulls + result.weap.pulls);
    const weeks = weeklyTimeline(result);
    expect(weeks.reduce((n, w) => n + w.char + w.weap, 0)).toBe(fromPatches);
  });

  it('prints a summary for eyeballing', () => {
    const rows = result.sixStars.map(
      (s) =>
        `${s.kind} ${s.bannerName.padEnd(34)} #${String(s.bannerPull ?? 'free').padEnd(4)} pity ${String(s.pity ?? '-').padEnd(3)} ${s.name.padEnd(28)} ${s.outcome ?? ''} ${s.luck !== undefined ? (s.luck * 100).toFixed(1) + '%' : ''}`,
    );
    console.log(rows.join('\n'));
    console.log(JSON.stringify({ char: result.char, weap: result.weap }, null, 1));
    console.log(
      result.banners
        .filter((b) => b.isLatest)
        .map((b) => `${b.name}: pity ${b.pity.value}/${b.pity.max} guarantee ${b.guarantee?.value ?? '-'}`)
        .join('\n'),
    );
  });
});

describe('banner schedule', () => {
  const schedule = scheduleSnapshot as Schedule;
  const banner = (start: string | null, end: string | null): ScheduleBanner => ({
    name: 'Test',
    kind: 'chartered',
    rateUps: [],
    poolId: null,
    version: null,
    start: start ? { americas: start, asia: start } : null,
    end: end ? { americas: end, asia: end } : null,
    availability: null,
    art: null,
    posts: [],
  });
  const t = (s: string) => Date.parse(s);

  it('knows when a banner is open', () => {
    const b = banner('2026-10-14T23:00:00-05:00', '2026-11-05T11:59:00-05:00');
    expect(statusOf(b, t('2026-10-01T00:00:00Z'), 'americas')).toBe('upcoming');
    expect(statusOf(b, t('2026-10-20T00:00:00Z'), 'americas')).toBe('live');
    expect(statusOf(b, t('2026-11-06T00:00:00Z'), 'americas')).toBe('ended');
    // An unannounced end keeps a banner open for a while, not forever.
    const open = banner('2026-10-14T23:00:00-05:00', null);
    expect(statusOf(open, t('2026-11-20T00:00:00Z'), 'americas')).toBe('live');
    expect(statusOf(open, t('2027-03-01T00:00:00Z'), 'americas')).toBe('ended');
    expect(statusOf(banner(null, null), t('2026-10-20T00:00:00Z'), 'americas')).toBe('upcoming');
  });

  it("writes Discord timestamps for the reader's own time zone", () => {
    const b = banner('2026-10-29T12:00:00-05:00', '2026-11-19T04:00:00-05:00');
    const open = Date.parse('2026-10-29T17:00:00Z') / 1000;
    const close = Date.parse('2026-11-19T09:00:00Z') / 1000;
    expect(discordText(b, 'Challenge Event', 'americas')).toBe(
      [`**Test** · Challenge Event`, `Opens <t:${open}:F> (<t:${open}:R>)`, `Ends <t:${close}:F> (<t:${close}:R>)`, `-# Americas / Europe server`].join('\n'),
    );
    expect(discordText(b, 'Chartered Headhunting', 'americas', ['Si'])).toContain(
      ['Rate-up: Si', `Opens <t:${open}:F> (<t:${open}:R>)`, `Ends <t:${close}:F> (<t:${close}:R>)`].join('\n'),
    );
  });

  it('packs overlapping banners into separate lanes', () => {
    expect(packLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, { start: 16, end: 30 }])).toEqual([0, 1, 0, 1]);
  });

  it('guesses the server from the time zone', () => {
    expect(guessServer(-240)).toBe('americas'); // UTC-4
    expect(guessServer(60)).toBe('americas'); // UTC+1 (Europe)
    expect(guessServer(480)).toBe('asia'); // UTC+8
  });

  it('has the same dated opening 13 hours apart on the two servers', () => {
    const rejuv = schedule.banners.find((b) => b.name === 'Ancestral Spring Flows Anew')!;
    expect(timeOn(rejuv.start, 'americas')! - timeOn(rejuv.start, 'asia')!).toBe(13 * 3_600_000);
  });

  it('ships a complete bundled schedule', () => {
    expect(schedule.versions[0].name).toBe('Launch');
    for (const b of schedule.banners) {
      expect(b.start, b.name).not.toBeNull();
      if (b.end) expect(timeOn(b.end, 'americas')!, b.name).toBeGreaterThan(timeOn(b.start, 'americas')!);
    }
    // Banners from the news feed that have a pool line up with banners.json.
    for (const b of schedule.banners.filter((x) => x.poolId)) expect(bannerDb[b.poolId!]?.name?.toLowerCase(), b.name).toBe(b.name.toLowerCase());
  });
});

describe('Google Drive guardrail: the Drive copy only gains pulls', () => {
  const pull = (n: number) => ({ seqId: String(n), gachaTs: String(Date.UTC(2026, 0, n)), charId: `chr_${n % 4}`, rarity: 4, poolId: 'standard' });
  const hist = (ns: number[]) => ({ characters: ns.map(pull), weapons: [] }) as unknown as PullHistory;

  it('counts pulls an upload would drop', () => {
    expect(missingPulls(hist([1, 2, 3]), hist([1, 2, 3, 4]))).toBe(0);
    expect(missingPulls(hist([1, 2, 3]), hist([1]))).toBe(2);
    expect(missingPulls(hist([1, 2]), null)).toBe(2);
    expect(missingPulls(null, hist([1]))).toBe(0);
  });

  it('ignores banner rewards, which are not pulls', () => {
    const drive = hist([1]);
    drive.characters.push({ kind: 'gift_operator_token', seqId: '99', gachaTs: '1', nameText: 'Token' } as never);
    expect(missingPulls(drive, hist([1]))).toBe(0);
  });

  it('merging Drive in first never leaves a Drive pull out, whatever this browser lost', () => {
    const drive = hist([1, 2, 3, 4, 5]);
    for (const local of [hist([]), hist([2]), hist([1, 3, 5]), hist([6, 7]), hist([1, 2, 3, 4, 5, 6])]) {
      const upload = mergeHistories(local, drive).history;
      expect(missingPulls(drive, upload)).toBe(0);
    }
  });
});

describe('same-player check on import', () => {
  const pull = (n: number, charId: string, day = n) => ({ seqId: String(n), gachaTs: String(Date.UTC(2026, 0, day)), charId, charName: charId, rarity: 4, poolId: 'standard' });
  const mine = { characters: Array.from({ length: 30 }, (_, i) => pull(i + 1, `chr_${i % 7}`)), weapons: [] } as unknown as PullHistory;

  it('accepts a later export of the same account', () => {
    // Overlaps days 20-30 and adds days 31-40.
    const later = { characters: Array.from({ length: 21 }, (_, i) => pull(i + 20, `chr_${(i + 19) % 7}`)), weapons: [] } as unknown as PullHistory;
    expect(compareHistories(mine, later)).toMatchObject({ verdict: 'same', foreign: 0 });
  });

  it('ignores missing seqIds (older exporters)', () => {
    const noSeq = { characters: mine.characters.map((r) => ({ ...r, seqId: undefined })), weapons: [] } as unknown as PullHistory;
    expect(compareHistories(mine, noSeq).verdict).toBe('same');
  });

  it("flags someone else's pulls from the same period", () => {
    const friend = { characters: Array.from({ length: 30 }, (_, i) => pull(i + 1, `chr_${(i + 3) % 5}x`)), weapons: [] } as unknown as PullHistory;
    expect(compareHistories(mine, friend).verdict).toBe('different');
  });

  it("can't tell when the periods don't overlap, and doesn't ask when nothing is saved", () => {
    const later = { characters: [pull(100, 'chr_1', 60)], weapons: [] } as unknown as PullHistory;
    expect(compareHistories(mine, later).verdict).toBe('noOverlap');
    expect(compareHistories(null, later).verdict).toBe('empty');
  });
});
