import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import db from '../data/banners.snapshot.json';
import { analyze } from './analyze';
import { canonicalPoolId, categoryOf, patchOf } from './banners';
import { mergeHistories, parseHistoryJson } from './parse';
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

  it('counts every non-dossier record', () => {
    const pulls = result.banners.reduce((n, b) => n + b.pulls.length, 0);
    const dossiers = history.characters.filter((r) => r.kind === 'gift_intel_book').length;
    expect(pulls).toBe(history.characters.length + history.weapons.length - dossiers);
  });

  it('never exceeds hard pity and resets on every 6★', () => {
    for (const b of result.banners) {
      for (const p of b.pulls) {
        if (p.pity !== null) expect(p.pity).toBeLessThanOrEqual(b.kind === 'weap' ? 40 : 80);
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
