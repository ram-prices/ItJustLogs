import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import db from '../data/banners.snapshot.json';
import { analyze } from './analyze';
import { canonicalPoolId, categoryOf, isIssuePool, issueLayerUrls, patchOf } from './banners';
import { compareHistories, dropShadowedDuplicates, mergeHistories, missingPulls, parseHistoryJson } from './parse';
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
import { discordText, endOrGuess, guessServer, headhuntingRow, packLanes, statusOf, timeOn, UNKNOWN_END_DAYS, type Schedule, type ScheduleBanner } from './schedule';
import type { BannerDb, PullHistory } from './types';
import { fmtSkillValue, parseMarkup, skillSets, splitPlaceholders, wikiId } from './wiki';
import { endministratorOf, extrasOf, ownedItems } from './owned';
import { unpulledBanners } from './catalog';
import type { Analysis } from './analyze';

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
  it('makes RE-Factor reruns Chartered (Headhunting) and Arsenal Issues (weapons)', () => {
    expect(categoryOf('char', 'rerun_chr_aglina')).toBe('chartered');
    expect(categoryOf('char', 'Rerun_Chr_Tangtang')).toBe('chartered');
    expect(categoryOf('weap', 'rerun_wpn_aglina')).toBe('limited');
    expect(isIssuePool('rerun_wpn_aglina')).toBe(true);
  });
  it('recognises both weponbox_ and weaponbox_ Issue pools', () => {
    for (const id of ['weponbox_1_2_2', 'weaponbox_1_2_2', 'rerun_wpn_x']) {
      expect(isIssuePool(id)).toBe(true);
      expect(issueLayerUrls(id)?.weapon).toMatch(/banners\/layers\/(weponbox_1_2_2|rerun_wpn_x)\.webp$/);
      expect(categoryOf('weap', id)).toBe('limited');
      expect(patchOf(id).key).toBe(id.startsWith('rerun') ? 'Permanent' : '1.2');
    }
    for (const id of ['weaponbox_constant_1', 'special_1_2_1']) expect(isIssuePool(id)).toBe(false);
  });
  it('takes a rerun pool’s patch from its schedule entry (start date → version)', () => {
    const at = (t: string) => ({ americas: t, asia: t });
    const schedule = {
      versions: [
        { name: 'Launch', release: at('2026-01-22T03:00:00Z'), maintenance: null, posts: [] },
        { name: 'Second', release: at('2026-03-12T04:00:00Z'), maintenance: null, posts: [] },
        { name: 'Third', release: at('2026-04-17T04:00:00Z'), maintenance: null, posts: [] },
      ],
      banners: [
        { name: 'Rerun', kind: 'refactor', rateUps: [], poolId: 'rerun_chr_aglina', version: null, start: at('2026-03-30T17:00:00Z'), end: null, availability: null, art: null, posts: [] },
        { name: 'Rerun Issue', kind: 'refactorIssue', rateUps: [], poolId: 'rerun_wpn_aglina', version: null, start: at('2026-04-20T17:00:00Z'), end: null, availability: null, art: null, posts: [] },
      ],
    } as Schedule;
    expect(patchOf('rerun_chr_aglina', schedule)).toEqual({ key: '1.1', major: 1, minor: 1 });
    expect(patchOf('rerun_wpn_aglina', schedule).key).toBe('1.2');
    // Without a schedule entry, or without the schedule: as before.
    expect(patchOf('rerun_chr_yvonne', schedule).key).toBe('Permanent');
    expect(patchOf('rerun_chr_aglina').key).toBe('Permanent');
    // Pools with a version in the id and standing pools ignore the schedule.
    expect(patchOf('special_1_4_2', schedule).key).toBe('1.4');
    expect(patchOf('standard', schedule).key).toBe('Permanent');
    // analyze passes it through.
    const pulls = { characters: [{ seqId: '1', gachaTs: '1774890000000', charId: 'chr_x', charName: 'X', rarity: 4, poolId: 'rerun_chr_aglina' }], weapons: [] } as unknown as PullHistory;
    expect(analyze(pulls, bannerDb, schedule).banners[0].patch.key).toBe('1.1');
    expect(analyze(pulls, bannerDb).banners[0].patch.key).toBe('Permanent');
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

  it('a RE-Factor Issue (rerun_wpn_) counts in sets with its own pity and the 8th-set guarantee', () => {
    const rerunDb: BannerDb = { ...bannerDb, rerun_wpn_test: { name: 'Rerun Issue', rateUpIds: ['wpn_lance_0014'] } };
    const weapons = [
      // 25 pulls on a regular Issue first: weapon pity stays per banner.
      ...Array.from({ length: 25 }, (_, i) => ({ ...weap(i + 1), poolId: 'weponbox_1_4_1' })),
      ...Array.from({ length: 80 }, (_, i) => ({ ...weap(100 + i + 1, i === 74 ? 6 : 4, i === 74 ? 'wpn_lance_0014' : 'wpn_filler'), poolId: 'rerun_wpn_test' })),
    ];
    const b = analyze({ characters: [], weapons } as unknown as PullHistory, rerunDb).banners.find((x) => x.poolId === 'rerun_wpn_test')!;
    expect(b).toMatchObject({ category: 'limited', paidPulls: 80, pity: { value: 0, max: 4 } });
    // Pity in sets from this banner's own first set, not carried over from weponbox_1_4_1's 3 sets.
    expect(b.pulls[9].pity).toBe(1);
    const six = b.pulls.find((p) => p.rarity === 6)!;
    expect(six).toMatchObject({ pity: 8, outcome: 'guaranteed' });
    expect(b.guarantee).toMatchObject({ value: 8, max: 8, done: true });
    // No estimated Issue rewards for a rerun: only the export's gift records count (owned.ts).
    expect(b.rewards).toBeNull();
  });

  it('Constant Issues have the 8th-set guarantee too', () => {
    // Constant Issue 1: its rate-up is Khravengger (wpn_claym_0013); a player's first one came on pull 80.
    const weapons = Array.from({ length: 80 }, (_, i) => ({
      seqId: String(i + 1),
      gachaTs: String(1_000_000 + i + 1),
      weaponId: i === 79 ? 'wpn_claym_0013' : 'wpn_filler',
      weaponName: i === 79 ? 'Khravengger' : 'wpn_filler',
      rarity: i === 79 ? 6 : 4,
      poolId: 'weaponbox_constant_1',
    }));
    const b = analyze({ characters: [], weapons } as unknown as PullHistory, bannerDb).banners.find((x) => x.poolId === 'weaponbox_constant_1')!;
    expect(b.pulls.find((p) => p.rarity === 6)!.outcome).toBe('guaranteed');
    expect(b.guarantee).toMatchObject({ value: 8, max: 8, done: true });
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

  it('puts the Chartered banner first in the Headhunting row', () => {
    const b = (name: string, kind: ScheduleBanner['kind']): ScheduleBanner => ({ ...banner(null, null), name, kind });
    const names = (list: ScheduleBanner[]) => list.map((x) => x.name);
    // Opening order: the re-run and the special opened before the Chartered banner, or after it.
    const live = [b('rerun', 'refactor'), b('special', 'special'), b('new', 'chartered'), b('rerun2', 'refactor')];
    expect(names(headhuntingRow(live))).toEqual(['new', 'rerun', 'rerun2', 'special']);
    expect(names(headhuntingRow(live, 1))).toEqual(['new']);
    expect(names(headhuntingRow(live, 2))).toEqual(['new', 'rerun2']);
    expect(headhuntingRow(live, 0)).toEqual([]);
    expect(names(headhuntingRow([b('old', 'chartered'), b('rerun', 'refactor')], 1))).toEqual(['old']);
    expect(names(headhuntingRow([b('a', 'chartered'), b('z', 'chartered'), b('rerun', 'refactor')], 2))).toEqual(['a', 'z']);
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
    // Banners that have a pool line up with banners.json, looked up as the site does (lookupBanner:
    // the game spells weapon pools both weponbox_ and weaponbox_).
    const entryOf = (id: string) => {
      const c = canonicalPoolId(id);
      return bannerDb[c] ?? bannerDb[c.replace(/^weponbox_/, 'weaponbox_')];
    };
    for (const b of schedule.banners.filter((x) => x.poolId)) expect(entryOf(b.poolId!)?.name?.toLowerCase(), b.name).toBe(b.name.toLowerCase());
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

  it('merging a seqId-less copy of a seqId history adds nothing', () => {
    const noSeq = { characters: mine.characters.map((r) => ({ ...r, seqId: undefined })), weapons: [] } as unknown as PullHistory;
    const { history, added } = mergeHistories(mine, noSeq);
    expect(added.char).toBe(0);
    expect(history.characters).toHaveLength(30);
    expect(history.characters.every((r) => r.seqId)).toBe(true);
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

describe('exports without seqIds', () => {
  const T = String(Date.UTC(2026, 1, 1));
  // One ten-pull, oldest first: pull 3 is a 6★, pulls 5 and 8 are the same 4★.
  const tenPull = (withSeq: boolean) =>
    Array.from({ length: 10 }, (_, i) => ({
      seqId: withSeq ? String(i + 1) : undefined,
      gachaTs: T,
      charId: i === 2 ? 'chr_six' : i === 4 || i === 7 ? 'chr_twin' : `chr_${i}`,
      rarity: i === 2 ? 6 : 4,
      poolId: 'standard',
    })).reverse(); // stored and exported newest first
  const hist = (characters: object[]) => ({ characters, weapons: [] }) as unknown as PullHistory;
  const empty = hist([]);

  it('keeps repeated pulls inside one ten-pull', () => {
    const first = mergeHistories(empty, hist(tenPull(false)));
    expect(first.added.char).toBe(10);
    expect(first.history.characters.filter((r) => r.charId === 'chr_twin')).toHaveLength(2);
    const again = mergeHistories(first.history, hist(tenPull(false)));
    expect(again.added.char).toBe(0);
    expect(again.history.characters.filter((r) => r.charId === 'chr_twin')).toHaveLength(2);
  });

  it('fills in seqIds from an export that has them', () => {
    const { history, added } = mergeHistories(hist(tenPull(false)), hist(tenPull(true)));
    expect(added.char).toBe(0);
    expect(history.characters).toHaveLength(10);
    expect(history.characters.every((r) => r.seqId)).toBe(true);
  });

  it('repairs a history holding the same pulls with and without seqIds', () => {
    const broken = [...tenPull(true), ...tenPull(false)];
    expect(dropShadowedDuplicates(broken, 'char')).toHaveLength(10);
    const { history, added } = mergeHistories(hist(broken), empty);
    expect(added.char).toBe(0);
    expect(history.characters).toHaveLength(10);
    expect(history.characters.every((r) => r.seqId)).toBe(true);
  });

  it('missingPulls matches on time + item + occurrence', () => {
    expect(missingPulls(hist(tenPull(false)), hist(tenPull(true)))).toBe(0);
    expect(missingPulls(hist(tenPull(true)), hist(tenPull(false)))).toBe(0);
    expect(missingPulls(hist(tenPull(true)), hist(tenPull(false).slice(1)))).toBe(1);
    // A twin lost: one of the two identical records is missing.
    expect(missingPulls(hist(tenPull(true)), hist(tenPull(false).filter((r, i) => !(r.charId === 'chr_twin' && i < 5))))).toBe(1);
    // A Drive copy holding old duplicates doesn't block uploads.
    expect(missingPulls(hist([...tenPull(true), ...tenPull(false)]), hist(tenPull(true)))).toBe(0);
  });

  it('processes a seqId-less ten-pull oldest first', () => {
    const b = analyze(hist(tenPull(false)), bannerDb).banners.find((x) => x.poolId === 'standard')!;
    expect(b.pulls.map((p) => p.itemId)).toEqual(['chr_0', 'chr_1', 'chr_six', 'chr_3', 'chr_twin', 'chr_5', 'chr_6', 'chr_twin', 'chr_8', 'chr_9']);
    expect(b.pulls[2].pity).toBe(3);
    expect(b.pulls.map((p) => p.pity)).toEqual([1, 2, 3, 1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(b.pulls.map((p) => p.key)).size).toBe(10);
  });
});

describe('wiki markup', () => {
  it('splits bold, highlights and line breaks without producing HTML', () => {
    expect(parseMarkup('**SKILL:**\nDeals ⟦heat|Heat DMG⟧ <b>x</b>')).toEqual([
      { kind: 'bold', text: 'SKILL:' },
      { kind: 'break' },
      { kind: 'text', text: 'Deals ' },
      { kind: 'mark', cls: 'heat', text: 'Heat DMG' },
      { kind: 'text', text: ' <b>x</b>' },
    ]);
  });

  it('maps the game id the wiki files under another name', () => {
    expect(wikiId('chr_0034_typhoeus')).toBe('chr_0034_typhoea');
    expect(wikiId('chr_0019_karin')).toBe('chr_0019_karin');
  });

  it('groups skill sets by variant in order', () => {
    const s = (name: string, variant?: string) => ({ name, type: '', variant, description: '', values: [] });
    expect(skillSets([s('a', 'INT'), s('b', 'INT'), s('a', 'WILL')]).map((x) => [x.variant, x.skills.length])).toEqual([['INT', 2], ['WILL', 1]]);
    expect(skillSets([s('a'), s('b')])).toHaveLength(1);
  });
});

describe('owned copies and potential', () => {
  const pull = (itemId: string, ts: number, bannerPull: number | null = ts) => ({ itemId, name: itemId, seq: ts, ts, bannerPull, kind: 'char' }) as never;
  const banner = (over: object) => ({ kind: 'char', poolId: 'p', name: 'B', pulls: [], paidPulls: 0, lastTs: 0, rewards: null, info: null, ...over });
  /** A reward track paying copies at `at` (pulls, or sets for weapons). */
  const track = (label: string, earned: number, at: number[], copy = true) => ({
    label,
    earned,
    copies: copy ? at.length : 0,
    milestones: (upTo: number) => at.filter((x) => x <= upTo).map((x) => ({ at: x, name: label, copy })),
  });

  it('counts pulls and reward copies in order, capping Potential at 5', () => {
    const a = {
      banners: [
        banner({ pulls: [pull('chr_a', 1), pull('chr_b', 2), pull('chr_a', 3)] }),
        // The Token comes with the 240th pull (ts 240), after the copy pulled at ts 100.
        banner({ poolId: 'q', name: 'Q', paidPulls: 240, pulls: [pull('chr_a', 100), pull('chr_x', 240)], info: { rateUpIds: ['chr_a'], rateUpNames: [] }, rewards: track('Token', 1, [240]) }),
        banner({ kind: 'weap', pulls: [pull('wpn_x', 5)] }),
      ],
    } as unknown as Analysis;
    const o = ownedItems(a, 'char').get('chr_a')!;
    expect(o).toMatchObject({ copies: 4, pulled: 3, potential: 3, spare: 0, maxed: null });
    expect(o.acquisitions.map((x) => [x.ts, x.copy, x.reward])).toEqual([
      [1, 1, null],
      [3, 2, null],
      [100, 3, null],
      [240, 4, 'Token'],
    ]);
    expect(ownedItems(a, 'char').has('wpn_x')).toBe(false);
  });

  it('dates the copy that maxed Potential, and counts the rest as spare', () => {
    const a = { banners: [banner({ pulls: Array.from({ length: 8 }, (_, i) => pull('chr_c', i + 1)) })] } as unknown as Analysis;
    const o = ownedItems(a, 'char').get('chr_c')!;
    expect(o).toMatchObject({ copies: 8, potential: 5, spare: 2 });
    expect(o.maxed).toMatchObject({ ts: 6, copy: 6 });
  });

  it("dates Arsenal reward copies by the set that earned them and doesn't guess Selectors", () => {
    const a = {
      banners: [
        banner({ info: { rateUpIds: ['chr_a', 'chr_b'], rateUpNames: [] }, rewards: track('Selector', 2, [120, 240]) }),
        banner({ kind: 'weap', paidPulls: 180, pulls: [pull('wpn_y', 180)], info: { rateUpIds: ['wpn_x'], rateUpNames: [] }, rewards: track('Issue rewards', 2, [18]) }),
      ],
    } as unknown as Analysis;
    expect(ownedItems(a, 'char').get('chr_a')).toMatchObject({ copies: 0, potential: -1, selectors: 2 });
    expect(ownedItems(a, 'weap').get('wpn_x')!.acquisitions[0]).toMatchObject({ ts: 180, reward: 'Rate-up copy', copy: 1 });
  });  it("uses the export's own reward records over the estimate", () => {
    const gift = (kind: string, gift: string, poolId: string, ts: number, name: string) => ({ kind, gift, poolId, ts, seq: ts, name });
    const a = {
      banners: [
        // 130 pulls: the schedule says no Token yet, but the export lists one.
        banner({ poolId: 'special_1_4_1', name: 'Arc', paidPulls: 130, pulls: [pull('chr_arc', 10)], info: { rateUpIds: ['chr_arc'], rateUpNames: [] }, rewards: track('Token', 0, []) }),
        // No reward records for this older pool: estimated from the schedule.
        banner({ poolId: 'special_1_1_1', name: 'Old', paidPulls: 240, pulls: [pull('chr_x', 240)], info: { rateUpIds: ['chr_old'], rateUpNames: [] }, rewards: track('Token', 1, [240]) }),
        banner({ kind: 'weap', poolId: 'weponbox_1_4_1', name: 'Issue', paidPulls: 240, pulls: [pull('wpn_j', 5)], info: { rateUpIds: ['wpn_j'], rateUpNames: [] }, rewards: track('Issue rewards', 2, [18]) }),
      ],
      gifts: [
        gift('char', 'gift_intel_book', 'special_1_4_1', 50, 'Headhunting Dossier'),
        gift('char', 'gift_operator_token', 'special_1_4_1', 130, "Arcane's Token"),
        gift('weap', 'gift_weapon', 'weaponbox_1_4_1', 100, 'Jade'),
        gift('weap', 'gift_weapon_box', 'weaponbox_1_4_1', 150, 'Arms OC'),
        gift('weap', 'gift_weapon', 'weaponbox_1_4_1', 200, 'Jade'),
      ],
    } as unknown as Analysis;
    const chars = ownedItems(a, 'char');
    expect(chars.get('chr_arc')!.acquisitions.map((x) => [x.ts, x.reward, !!x.estimated])).toEqual([[10, null, false], [130, 'Token', false]]);
    expect(chars.get('chr_old')!.acquisitions.map((x) => [x.ts, x.reward, x.estimated])).toEqual([[240, 'Token', true]]);
    // Two listed copies on the Issue (the schedule alone would say one).
    expect(ownedItems(a, 'weap').get('wpn_j')).toMatchObject({ copies: 3, pulled: 1, potential: 2 });
  });

  it('counts extra copies first, apart from pulls, and only for their own kind', () => {
    const a = { banners: [banner({ pulls: [pull('chr_a', 5)] })] } as unknown as Analysis;
    const extras = [
      { id: 'chr_a', copies: 2, note: 'Story' },
      { id: 'wpn_e', copies: 6, note: 'Event' },
    ];
    const o = ownedItems(a, 'char', extras).get('chr_a')!;
    expect(o).toMatchObject({ copies: 3, pulled: 1, extra: 2, potential: 2 });
    expect(o.acquisitions.map((x) => [x.copy, !!x.extra, x.bannerName])).toEqual([
      [1, true, 'Story'],
      [2, true, 'Story'],
      [3, false, 'B'],
    ]);
    expect(ownedItems(a, 'char', extras).has('wpn_e')).toBe(false);
    // Without an import the extras still count: a maxed event weapon.
    expect(ownedItems(null, 'weap', extras).get('wpn_e')).toMatchObject({ copies: 6, pulled: 0, extra: 6, potential: 5, spare: 0 });
  });

  it('counts both Endministrators as one operator', () => {
    const extras = [{ id: 'chr_0002_endminm', copies: 2, note: 'Story' }];
    const owned = ownedItems(null, 'char', extras);
    expect(owned.get('chr_0002_endminm')).toMatchObject({ copies: 2, potential: 1 });
    // The female page shows the same record, not a second count.
    expect(owned.get('chr_0003_endminf')).toBe(owned.get('chr_0002_endminm'));
    expect(endministratorOf(extras)).toBe('chr_0002_endminm');
    expect(endministratorOf([{ id: 'chr_x', copies: 1, note: '' }])).toBeNull();
  });

  it('starts everyone with the story operators until the list is edited', () => {
    expect(extrasOf({}).map((x) => x.id)).toEqual(['chr_0003_endminf', 'chr_0005_chen', 'chr_0004_pelica']);
    expect(extrasOf({ extras: [] })).toEqual([]);
  });
});


describe('weapon skill placeholders', () => {
  it('splits text around {n}', () => {
    expect(splitPlaceholders('ATK +{0}% and {1}')).toEqual(['ATK +', 0, '% and ', 1]);
    expect(fmtSkillValue(12)).toBe('12');
    expect(fmtSkillValue(5.556)).toBe('5.56');
  });
});

describe('all banners catalog', () => {
  const t = (iso: string) => ({ americas: iso, asia: iso });
  const sched = (name: string, kind: string, poolId: string | null, start: string, rateUps: string[] = []) =>
    ({ name, kind, rateUps, poolId, version: null, start: t(start), end: null, availability: null, art: null, posts: [] });
  const schedule = {
    banners: [
      sched('Old', 'chartered', 'special_1_0_1', '2026-01-01T00:00:00Z', ['A']),
      sched('Skipped', 'chartered', 'special_1_1_1', '2026-02-01T00:00:00Z', ['B']),
      sched('No pool yet', 'special', null, '2026-03-01T00:00:00Z', ['C']),
      sched('Future', 'chartered', 'special_9_9_9', '2099-01-01T00:00:00Z'),
      sched('An Issue', 'issue', 'weponbox_1_1_1', '2026-02-01T00:00:00Z'),
    ],
  } as unknown as Schedule;
  const db = {
    standard: { name: 'Basic Headhunting' },
    special_1_0_1: { name: 'Old', rateUpIds: ['chr_a'], rateupName: ['A'] },
    special_1_1_1: { name: 'Skipped', rateUpIds: ['chr_b'], rateupName: ['B'] },
    special_9_9_9: { name: 'Future' },
    weaponbox_1_1_1: { name: 'An Issue' },
  } as BannerDb;

  it('lists opened banners the player has no pulls on, newest first', () => {
    const now = Date.parse('2026-06-01T00:00:00Z');
    const got = unpulledBanners('char', [{ poolId: 'special_1_0_1', name: 'Old' }], db, schedule, 'americas', now);
    expect(got.map((b) => [b.name, b.poolId])).toEqual([
      ['No pool yet', null],
      ['Skipped', 'special_1_1_1'],
      ['Basic Headhunting', 'standard'],
    ]);
    expect(unpulledBanners('weap', [], db, schedule, 'americas', now).map((b) => b.poolId)).toEqual(['weponbox_1_1_1']);
  });
});

describe('luck tiers', () => {
  it('rates by how many players with as many tries would do better or worse', async () => {
    const { luckTier } = await import('./analyze');
    expect(luckTier(6 / 22, 0.25, 22)).toBe('average'); // 27% of 25/75s: about what's expected
    expect(luckTier(8 / 22, 0.25, 22)).toBe('lucky');
    expect(luckTier(9 / 22, 0.25, 22)).toBe('very-lucky');
    expect(luckTier(3 / 22, 0.25, 22)).toBe('unlucky');
    expect(luckTier(2 / 30, 0.25, 30)).toBe('very-unlucky');
    expect(luckTier(6 / 10, 0.5, 10)).toBe('average'); // 60% of ten 50/50s: too few to say
    expect(luckTier(12 / 20, 0.5, 20)).toBe('lucky');
    expect(luckTier(14 / 20, 0.5, 20)).toBe('very-lucky');
    expect(luckTier(0.53, 0.5, 1000)).toBe('average'); // many tries, but only 6% better
  });
});

describe('character pity scopes and the Chartered guarantee', () => {
  // Pulls in the order given, one second apart.
  type Spec = [poolId: string, charId?: string, rarity?: number, extra?: object];
  const history = (specs: Spec[]) =>
    ({
      characters: specs.map(([poolId, charId = 'chr_filler', rarity = 4, extra = {}], i) => ({
        seqId: String(i + 1),
        gachaTs: String(1_700_000_000_000 + i * 1000),
        charId,
        charName: charId,
        rarity,
        poolId,
        ...extra,
      })),
      weapons: [],
    }) as unknown as PullHistory;
  const fill = (poolId: string, n: number): Spec[] => Array.from({ length: n }, () => [poolId] as Spec);
  const bannerOf = (a: Analysis, poolId: string) => a.banners.find((b) => b.poolId === poolId)!;

  it('shares 6★ pity across Chartered banners, while Joint and Basic count on their own', () => {
    const a = analyze(
      history([
        ...fill('special_1_0_1', 50),
        ...fill('joint_1_2_2', 10),
        ...fill('standard', 10),
        ...fill('special_1_0_2', 29),
        ['special_1_0_2', 'chr_off', 6],
      ]),
      bannerDb,
    );
    const next = bannerOf(a, 'special_1_0_2');
    expect(next.startPity).toBe(50);
    expect(next.pulls.find((p) => p.rarity === 6)!.pity).toBe(80);
    expect(next.pity.value).toBe(0);
    expect(bannerOf(a, 'special_1_0_1').pity.value).toBe(50);
    expect(bannerOf(a, 'joint_1_2_2')).toMatchObject({ startPity: 0, pity: { value: 10 } });
    expect(bannerOf(a, 'standard')).toMatchObject({ startPity: 0, pity: { value: 10 } });
  });

  it("gives a pool that isn't a known Chartered one its own pity", () => {
    const a = analyze(
      history([
        ...fill('special_1_0_1', 40),
        ...fill('unknown', 5),
        ['mystery_9_9_1', 'chr_x', 4, { poolName: 'Mystery Pool' }],
        ...fill('mystery_9_9_1', 3),
        ...fill('special_1_0_2', 1),
      ]),
      bannerDb,
    );
    const unknown = bannerOf(a, 'unknown');
    expect(unknown).toMatchObject({ category: 'other', name: 'Other headhunting', startPity: 0, pity: { value: 5 }, rewards: null, guarantee: null });
    // Each 'other' pool counts on its own, and keeps its own name when it has one.
    expect(bannerOf(a, 'mystery_9_9_1')).toMatchObject({ category: 'other', name: 'Mystery Pool', startPity: 0, pity: { value: 4 }, rewards: null });
    // The Chartered count went on from 40, untouched by the unknown pool.
    expect(bannerOf(a, 'special_1_0_2')).toMatchObject({ startPity: 40, pity: { value: 41 } });
  });

  // RE-Factor reruns: the owner's ruling is that they share Chartered pity; their 120 guarantee is their own.
  const rerunDb: BannerDb = { ...bannerDb, rerun_chr_aglina: { name: 'Aglina rerun', rateUpIds: ['chr_aglina'] } };

  it('a RE-Factor rerun shares the Chartered 6★ pity count', () => {
    const a = analyze(history([...fill('special_1_6_1', 30), ...fill('rerun_chr_aglina', 9), ['rerun_chr_aglina', 'chr_off', 6], ...fill('special_1_6_1', 5)]), rerunDb);
    const rerun = bannerOf(a, 'rerun_chr_aglina');
    expect(rerun).toMatchObject({ category: 'chartered', startPity: 30 });
    expect(rerun.pulls.find((p) => p.rarity === 6)!.pity).toBe(40);
    // Back on the Chartered banner, the count started over at the rerun's 6★.
    expect(bannerOf(a, 'special_1_6_1').pity.value).toBe(5);
  });

  it('a rerun has its own 120 guarantee and no estimated Token track', () => {
    // The 80 pulls on special_1_6_1 don't count toward the rerun's guarantee.
    const a = analyze(
      history([
        ...fill('special_1_6_1', 79),
        ['special_1_6_1', 'chr_off', 6],
        ...fill('rerun_chr_aglina', 69),
        ['rerun_chr_aglina', 'chr_off', 6],
        ...fill('rerun_chr_aglina', 49),
        ['rerun_chr_aglina', 'chr_aglina', 6],
        ...fill('rerun_chr_aglina', 130),
      ]),
      rerunDb,
    );
    const rerun = bannerOf(a, 'rerun_chr_aglina');
    expect(rerun.pulls.find((p) => p.itemId === 'chr_aglina')!.outcome).toBe('guaranteed');
    expect(rerun.guarantee).toMatchObject({ value: 120, max: 120, done: true });
    expect(rerun.paidPulls).toBe(250);
    expect(rerun.rewards).toBeNull();
  });

  it('a rate-up on pull 120 after a lost 6★ is guaranteed; a second one on the banner is won', () => {
    const a = analyze(
      history([
        ...fill('special_1_0_1', 69),
        ['special_1_0_1', 'chr_off', 6],
        ...fill('special_1_0_1', 49),
        ['special_1_0_1', 'chr_0016_laevat', 6],
        ...fill('special_1_0_1', 29),
        ['special_1_0_1', 'chr_0016_laevat', 6],
      ]),
      bannerDb,
    );
    const b = bannerOf(a, 'special_1_0_1');
    expect(b.pulls.filter((p) => p.rarity === 6).map((p) => [p.bannerPull, p.outcome])).toEqual([
      [70, 'lost'],
      [120, 'guaranteed'],
      [150, 'won'],
    ]);
    expect(b.guarantee).toMatchObject({ value: 120, done: true });
  });

  it('a free 6★ between paid pulls leaves pity running', () => {
    const a = analyze(history([...fill('special_1_0_1', 20), ['special_1_0_1', 'chr_free', 6, { isFree: true }], ...fill('special_1_0_1', 10)]), bannerDb);
    const b = bannerOf(a, 'special_1_0_1');
    expect(b.pulls.filter((p) => !p.isFree).map((p) => p.pity).slice(18)).toEqual([19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(b.pity.value).toBe(30);
    expect(b).toMatchObject({ paidPulls: 30, freePulls: 1 });
  });

  it('a free rate-up 6★ is a copy, but leaves pity and the 120 guarantee alone', () => {
    const a = analyze(
      history([
        ...fill('special_1_0_1', 20),
        ['special_1_0_1', 'chr_0016_laevat', 6, { isFree: true }],
        ...fill('special_1_0_1', 99),
        ['special_1_0_1', 'chr_0016_laevat', 6],
      ]),
      bannerDb,
    );
    const b = bannerOf(a, 'special_1_0_1');
    const sixes = b.pulls.filter((p) => p.rarity === 6);
    expect(sixes.map((p) => [p.bannerPull, p.pity, p.outcome, p.copy])).toEqual([
      [null, null, undefined, 1],
      [120, 120, 'guaranteed', 2],
    ]);
    // Pity ran straight through the free one: 20 before it, 21 right after.
    expect(b.pulls.filter((p) => !p.isFree).map((p) => p.pity).slice(19, 21)).toEqual([20, 21]);
    expect(b.rateUpCopies).toBe(2);
    expect(b.guarantee).toMatchObject({ value: 120, done: true });
    expect(a.char).toMatchObject({ sixStars: 1, won: 0, guaranteed: 1 });
  });

  it("a free rate-up copy doesn't change the next paid rate-up's luck", () => {
    const paid = ['special_1_0_1', 'chr_0016_laevat', 6] as const;
    const withFree = bannerOf(analyze(history([...fill('special_1_0_1', 20), ['special_1_0_1', 'chr_0016_laevat', 6, { isFree: true }], ...fill('special_1_0_1', 29), [...paid]]), bannerDb), 'special_1_0_1');
    const without = bannerOf(analyze(history([...fill('special_1_0_1', 49), [...paid]]), bannerDb), 'special_1_0_1');
    const a = withFree.pulls.find((p) => p.rarity === 6 && !p.isFree)!;
    const b = without.pulls.find((p) => p.rarity === 6)!;
    expect(a).toMatchObject({ bannerPull: 50, copy: 2, paidCopy: 1 });
    expect(b).toMatchObject({ bannerPull: 50, copy: 1, paidCopy: 1 });
    expect(a.luck).toBeGreaterThan(0);
    expect(a.luck).toBe(b.luck);
  });

  it('a free rate-up 6★ leaves the guarantee meter open', () => {
    const a = analyze(history([...fill('special_1_0_1', 30), ['special_1_0_1', 'chr_0016_laevat', 6, { isFree: true }]]), bannerDb);
    const b = bannerOf(a, 'special_1_0_1');
    expect(b.guarantee).toMatchObject({ value: 30, max: 120, done: false });
    expect(b.pity.value).toBe(30);
    expect(b.rateUpCopies).toBe(1);
  });
});

describe('same-player check at the 90% line', () => {
  const pull = (day: number, charId: string) => ({ seqId: String(day), gachaTs: String(Date.UTC(2026, 0, day)), charId, rarity: 4, poolId: 'standard' });
  const saved = { characters: Array.from({ length: 10 }, (_, i) => pull(i + 1, `chr_${i}`)), weapons: [] } as unknown as PullHistory;
  const changed = (n: number) => ({ characters: saved.characters.map((r, i) => (i < n ? { ...r, charId: 'chr_other' } : r)), weapons: [] }) as unknown as PullHistory;

  it('9 of 10 matching is the same player; 8 of 10 is not', () => {
    expect(compareHistories(saved, changed(1))).toMatchObject({ verdict: 'same', shared: 9, foreign: 1 });
    expect(compareHistories(saved, changed(2))).toMatchObject({ verdict: 'different', shared: 8, foreign: 2 });
  });
});

describe('banners with an unannounced end, on both servers', () => {
  const DAY = 86_400_000;
  const open: ScheduleBanner = {
    name: 'Open',
    kind: 'chartered',
    rateUps: [],
    poolId: null,
    version: null,
    // The same local opening, 13 hours apart.
    start: { americas: '2026-10-14T12:00:00-05:00', asia: '2026-10-14T12:00:00+08:00' },
    end: null,
    availability: null,
    art: null,
    posts: [],
  };

  it('guesses the end a few weeks after each server opens, and keeps it live for a while', () => {
    for (const server of ['americas', 'asia'] as const) {
      const start = timeOn(open.start, server)!;
      expect(endOrGuess(open, server)).toBe(start + UNKNOWN_END_DAYS * DAY);
      expect(statusOf(open, start - 1, server)).toBe('upcoming');
      expect(statusOf(open, start, server)).toBe('live');
      expect(statusOf(open, start + 119 * DAY, server)).toBe('live');
      expect(statusOf(open, start + 120 * DAY, server)).toBe('ended');
    }
    // Between the two openings it's live in Asia and not yet in the Americas.
    const between = timeOn(open.start, 'asia')! + DAY / 4;
    expect(statusOf(open, between, 'asia')).toBe('live');
    expect(statusOf(open, between, 'americas')).toBe('upcoming');
    expect(endOrGuess({ ...open, start: null }, 'asia')).toBeNull();
  });
});

describe('owned copies: listed rewards against the estimate', () => {
  const pull = (itemId: string, ts: number) => ({ itemId, name: itemId, seq: ts, ts, bannerPull: ts, kind: 'char' }) as never;
  const token = (at: number[]) => ({ label: 'Token', earned: at.length, copies: at.length, milestones: (upTo: number) => at.filter((x) => x <= upTo).map((x) => ({ at: x, name: 'Token', copy: true })) });
  const banner = (poolId: string, rateUp: string) => ({
    kind: 'char',
    poolId,
    name: poolId,
    paidPulls: 240,
    lastTs: 240,
    pulls: [pull('chr_filler', 240)],
    info: { rateUpIds: [rateUp], rateUpNames: [] },
    rewards: token([240]),
  });

  it("a 1.4+ banner's listed Token isn't counted again as an estimate; an older banner's is estimated", () => {
    const a = {
      banners: [banner('special_1_4_1', 'chr_new'), banner('special_1_1_1', 'chr_old')],
      gifts: [{ kind: 'char', gift: 'gift_operator_token', poolId: 'special_1_4_1', ts: 240, seq: 240.5, name: "chr_new's Token" }],
    } as unknown as Analysis;
    const owned = ownedItems(a, 'char');
    expect(owned.get('chr_new')!.acquisitions.map((x) => [x.ts, x.reward, !!x.estimated])).toEqual([[240, 'Token', false]]);
    expect(owned.get('chr_old')!.acquisitions.map((x) => [x.ts, x.reward, !!x.estimated])).toEqual([[240, 'Token', true]]);
  });
});
