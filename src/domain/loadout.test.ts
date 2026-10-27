import { describe, expect, it } from 'vitest';
import { bannerEnded } from './catalog';
import { artificeLevels, artificeState, artificeTops, atkTotal, defReduction, hpTotal, operatorBonuses, statTotal, TREATMENT_PER_WILL, essenceFromRanks, essenceMax, skillLevel, tuningMaxLevel, tuningOf, weaponBaseRanks, weaponBounds, weaponRankCaps, weaponSkillLevels, setCounts, statBonuses, wieldersOf, withArtifice, withSlot, type Loadout, type WeaponTuningFile } from './loadout';
import { equip, type GearData } from './sim/build';
import type { Schedule } from './schedule';
import type { WikiGear, WikiWeapon } from './wiki';

const piece = (set: string | null): WikiGear => ({
  name: 'x',
  type: 'Armor',
  rarity: 5,
  level: 70,
  artifice: false,
  region: null,
  set,
  defense: null,
  stats: [],
  source: null,
  page: '',
});

describe('loadouts', () => {
  it('sets and empties slots, dropping an empty loadout', () => {
    const l = withSlot(undefined, 'weapon', 'wpn_a');
    expect(l).toEqual({ weapon: 'wpn_a' });
    expect(withSlot(l, 'armor', 'g1')).toEqual({ weapon: 'wpn_a', armor: 'g1' });
    expect(withSlot(l, 'weapon', null)).toBeUndefined();
  });

  it('counts equipped pieces per gear set', () => {
    const items = { a: piece('Æthertech'), b: piece('Æthertech'), c: piece('Æthertech'), d: piece(null) };
    const l: Loadout = { armor: 'a', gloves: 'b', kit1: 'c', kit2: 'd', weapon: 'a' };
    expect([...setCounts(l, items)]).toEqual([['Æthertech', 3]]);
  });

  it('finds the operators using a weapon', () => {
    expect(wieldersOf({ chr_1: { weapon: 'w' }, chr_2: { weapon: 'v' }, chr_3: { weapon: 'w' } }, 'w')).toEqual(['chr_1', 'chr_3']);
    expect(wieldersOf(undefined, 'w')).toEqual([]);
  });
});

describe('loadout bonuses', () => {
  const op = { mainAttribute: 'Intellect', secondaryAttribute: 'Will', talents: [], potentials: [] };
  const weapon: WikiWeapon = {
    name: 'Dreams',
    rarity: 6,
    type: 'Arts Unit',
    source: null,
    description: [],
    stats: { levels: [1, 90], baseAtk: [50, 495] },
    potential: null,
    tuning: [],
    page: '',
    skills: [
      { name: 'Intellect [L]', tag: null, text: 'Intellect ⟦num|+{0}⟧', values: [[20, 36, 52, 68, 84, 100, 116, 132, 156]] },
      { name: 'Treatment [L]', tag: null, text: 'Treatment Efficiency ⟦num|+{0}%⟧.', values: [[1, 2, 3, 4, 5, 6, 7, 8, 9]] },
      { name: 'Infliction', tag: null, text: 'Secondary attribute ⟦num|+{0}%⟧. After the wielder…', values: [[16, 19.2, 22.4, 25.6, 28.8, 32, 35.2, 38.4, 44.8]] },
    ],
  };
  const armor: WikiGear = { ...piece('S'), defense: 56, stats: [{ stat: 'Strength', values: [87, 95] }, { stat: 'Main Attribute', values: [0.1] }] };

  it('adds base ATK, skill stats at their ranks and gear stats', () => {
    const b = operatorBonuses(op, { loadout: { weapon: 'w', armor: 'a' }, weapon: { w: weapon, potential: 2 }, items: { a: armor } });
    expect(b.get('ATK')?.flat).toBe(495);
    expect(b.get('Intellect')).toMatchObject({ flat: 156, pct: 10 });
    expect(b.get('Treatment Efficiency')?.pct).toBe(9);
    // The last skill counts at rank 4 + Potential (P2: rank 6).
    expect(b.get('Will')?.pct).toBe(32);
    // Gear counts at its highest Artifice level unless one is set.
    expect(b.get('Strength')?.flat).toBe(95);
    expect(b.get('DEF')?.flat).toBe(56);
  });

  it('counts weapon skills at the ranks set, never past what they can reach', () => {
    // P0: the last skill tops out at rank 4 (25.6%) even when set to 9.
    const b = operatorBonuses(op, { loadout: { weapon: 'w' }, weapon: { w: weapon, potential: 0, ranks: [5, undefined, 9] } });
    expect(b.get('Intellect')?.flat).toBe(84);
    expect(b.get('Treatment Efficiency')?.pct).toBe(9);
    expect(b.get('Will')?.pct).toBe(25.6);
    expect(weaponRankCaps(weapon, 5)).toEqual([9, 9, 9]);
  });

  it('starts weapons without essence: 3, 3 and 1 + Potential', () => {
    expect(weaponBaseRanks(weapon, null)).toEqual([3, 3, 1]);
    expect(weaponBaseRanks(weapon, 2)).toEqual([3, 3, 3]);
  });

  // ef-assets combat/weapon-tuning.json as the game has it: WeaponBreakThroughTemplateTable weapon_breakthrough_456star_*
  // (every 4–6★ weapon's) and _3star_*, WeaponTalentTemplateTable wpn_potential_456star and _3star.
  const tuningFile: WeaponTuningFile = {
    templates: {
      weapon_breakthrough_456star_B_2: { levels: [1, 20, 40, 60, 80], bounds: [[[1, 3], [1, 3], [1, 4]], [[2, 5], [1, 4], [1, 4]], [[2, 6], [2, 6], [1, 4]], [[3, 8], [2, 7], [1, 4]], [[3, 9], [3, 9], [1, 4]]] },
      weapon_breakthrough_3star_A_1: { levels: [1, 20, 40, 60, 80], bounds: [[[1, 3], [1, 4], [0, 0]], [[2, 5], [1, 4], [0, 0]], [[3, 6], [1, 4], [0, 0]], [[4, 8], [1, 4], [0, 0]], [[5, 9], [1, 4], [0, 0]]] },
    },
    potentials: {
      wpn_potential_456star: [1, 2, 3, 4, 5].map((p) => [[0, 0], [0, 0], [p, p]] as [number, number][]),
      wpn_potential_3star: [1, 2, 3, 4, 5].map((p) => [[0, 0], [p, p], [0, 0]] as [number, number][]),
    },
    weapons: {
      wpn_six: { tuning: 'weapon_breakthrough_456star_B_2', potential: 'wpn_potential_456star', maxLevel: 90 },
      wpn_three: { tuning: 'weapon_breakthrough_3star_A_1', potential: 'wpn_potential_3star', maxLevel: 90 },
    },
  };
  const six = tuningOf(tuningFile, 'wpn_six')!;
  const caps = (stage: number, p = 0) => weaponBounds(weapon, p, six, stage).map((b) => b[1]);

  it('raises the stat skills’ caps at each tuning, as the game’s table has them', () => {
    expect([0, 1, 2, 3, 4].map((s) => caps(s))).toEqual([
      [3, 3, 4],
      // Tuned at 20 (to reach 40): skill 1 from 3 to 5, skill 2 from 3 to 4.
      [5, 4, 4],
      [6, 6, 4],
      [8, 7, 4],
      [9, 9, 4],
    ]);
    expect([0, 1, 2, 3, 4].map((s) => tuningMaxLevel(six, s))).toEqual([20, 40, 60, 80, 90]);
    expect(tuningOf(tuningFile, 'nope')).toBeUndefined();
  });

  it('moves the own skill’s lowest and highest up one per Potential, tuning leaving it alone', () => {
    expect(weaponBounds(weapon, 0, six, 0)[2]).toEqual([1, 4]);
    expect(weaponBounds(weapon, 3, six, 2)[2]).toEqual([4, 7]);
    expect(weaponBounds(weapon, 5, six, 4)[2]).toEqual([6, 9]);
    // Unloaded table: as fully tuned, the same numbers.
    expect(weaponBounds(weapon, 3)).toEqual(weaponBounds(weapon, 3, six, 4));
  });

  it('adds essence levels to each skill’s lowest, up to its cap', () => {
    expect(essenceMax(weapon)).toEqual([6, 6, 3]);
    // Fully tuned: 3 + 6 = 9 on the stat skills, 1 + 3 = 4 (+ Potential) on the own skill.
    expect(weaponSkillLevels(weaponBounds(weapon, 0, six, 4), [6, 6, 3])).toEqual([9, 9, 4]);
    expect(weaponSkillLevels(weaponBounds(weapon, 5, six, 4), [6, 6, 3])).toEqual([9, 9, 9]);
    expect(weaponSkillLevels(weaponBounds(weapon, 0, six, 4), [0, 0, 0])).toEqual([3, 3, 1]);
    // Tuned once: a full essence is held at 5/4; part of one, 2 + 2 = 4, 1 + 2 = 3.
    expect(weaponSkillLevels(weaponBounds(weapon, 0, six, 1), [6, 6, 3])).toEqual([5, 4, 4]);
    expect(weaponSkillLevels(weaponBounds(weapon, 0, six, 1), [2, 2, 0])).toEqual([4, 3, 1]);
    expect(skillLevel([3, 9], 9)).toBe(9);
    // A save that held ranks (fully tuned): rank less the lowest.
    expect(essenceFromRanks([5, 9, 3], weaponBounds(weapon, 2, six, 4), essenceMax(weapon))).toEqual([2, 6, 0]);
  });

  it('reads a 3★ weapon’s two skills the same way (Potential on its second)', () => {
    const w3 = { skills: weapon.skills.slice(0, 2) };
    const three = tuningOf(tuningFile, 'wpn_three')!;
    expect(essenceMax(w3)).toEqual([6, 3]);
    expect(weaponBounds(w3, 0, three, 4)).toEqual([[5, 9], [1, 4]]);
    expect(weaponBounds(w3, 2, three, 0)).toEqual([[1, 3], [3, 6]]);
  });

  it('counts weapon skills and base ATK at the tuning stage', () => {
    const w = { ...weapon, stats: { levels: [1, 20, 40, 60, 80, 90], baseAtk: [50, 100, 200, 300, 400, 495] } };
    const b = operatorBonuses(op, { loadout: { weapon: 'w' }, weapon: { w, potential: 0, tuning: six, stage: 1, level: tuningMaxLevel(six, 1), ranks: [9, 9, 9] } });
    expect(b.get('ATK')?.flat).toBe(200);
    // Rank 5 and 4: the caps tuned once.
    expect(b.get('Intellect')?.flat).toBe(84);
    expect(b.get('Treatment Efficiency')?.pct).toBe(4);
  });

  it('reads stat bonuses out of talent and Potential text', () => {
    expect(statBonuses('Operator Intellect and Will +8.')).toEqual([{ stats: ['Intellect', 'Will'], value: 8, pct: false }]);
    expect(statBonuses('Intellect and Will ⟦num|+15⟧, Arts Intensity ⟦num|+16⟧.')).toEqual([
      { stats: ['Intellect', 'Will'], value: 15, pct: false },
      { stats: ['Arts Intensity'], value: 16, pct: false },
    ]);
    expect(statBonuses('Agility +⟦num|10⟧, Intellect +⟦num|12⟧.').map((b) => b.value)).toEqual([10, 12]);
    expect(statBonuses('Intellect ⟦num|+10⟧, Max HP ⟦num|+8%⟧.')[1]).toEqual({ stats: ['Max HP'], value: 8, pct: true });
    expect(statBonuses('All attributes ⟦num|+10⟧.')[0].stats).toHaveLength(4);
    expect(statBonuses('DMG Dealt ⟦num|+20%⟧ to enemies below 50% HP.')).toEqual([]);
    expect(statBonuses('Combo skill ⟦key|X⟧ improved:\nDMG +10%')).toEqual([]);
  });

  it("adds every talent stage, and Potentials up to the player's", () => {
    const arcane = {
      mainAttribute: 'Intellect',
      secondaryAttribute: 'Will',
      talents: [
        { name: 'Keen Mind/Stalwart', levels: [8, 10, 10, 15].map((n) => ({ requires: `Elite ${n}`, description: `Operator Intellect and Will +${n}.` })) },
        { name: 'Weapon Honing', levels: [{ requires: '', description: 'Corrosion lasts ⟦num|5⟧s longer.' }] },
      ],
      potentials: [
        { rank: 1, name: 'A', description: 'Combo skill improved.' },
        { rank: 2, name: 'B', description: 'Intellect and Will ⟦num|+15⟧, Arts Intensity ⟦num|+16⟧.' },
      ],
    };
    expect(operatorBonuses(arcane).get('Will')?.flat).toBe(43);
    expect(operatorBonuses(arcane, { potential: 1 }).get('Arts Intensity')).toBeUndefined();
    const p2 = operatorBonuses(arcane, { potential: 2 });
    expect(p2.get('Intellect')?.flat).toBe(58);
    expect(p2.get('Arts Intensity')?.flat).toBe(16);
    expect(p2.get('HP')).toBeUndefined();
  });
});

describe('ATK total', () => {
  it("matches the game's breakdown for Arcane", () => {
    const t = atkTotal(312, { flat: 505, pct: 25.6, sources: [] }, 430, 765);
    expect(t.base).toBe(817);
    expect(Math.round(t.basic)).toBe(1026);
    expect(t.fromMain).toBe(215);
    expect(t.fromSecondary).toBe(153);
    expect(Math.round(t.total)).toBe(4802);
  });

  it('works out HP, DEF reduction and treatment received like the game', () => {
    const hp = hpTotal(5495, { flat: 1000, pct: 0, sources: [] }, 91);
    expect(hp.base).toBe(5950);
    expect(hp.total).toBe(6950);
    expect(Math.round(defReduction(140) * 10) / 10).toBe(58.3);
    expect(Math.round(765 * TREATMENT_PER_WILL * 10) / 10).toBe(76.5);
  });
});

describe("Arcane's in-game stats", () => {
  // Her loadout: Type 42 (P0) and four Eternal Xiranite pieces at their top Artifice level.
  const gear = (name: string, type: string, defense: number, stats: [string, number[]][]): WikiGear => ({
    ...piece('Eternal Xiranite'),
    name,
    type,
    defense,
    artifice: true,
    stats: stats.map(([stat, values]) => ({ stat, values })),
  });
  const items = {
    armor: gear('Light Armor', 'Armor', 56, [['Will', [110, 121, 132, 143]], ['Ultimate Gain Efficiency', [0.123, 0.136, 0.148, 0.16]]]),
    hand: gear('Wraps', 'Gloves', 42, [['Will', [65, 71, 78, 84]], ['Intellect', [43, 47, 51, 55]]]),
    slab: gear('Bracing Slab', 'Kit', 21, [['Will', [41, 45, 49, 53]], ['Secondary Attribute', [0.207, 0.228, 0.248, 0.269]]]),
  };
  const sets = { 'Eternal Xiranite': { name: 'Eternal Xiranite', level: 70, region: null, manufacturer: null, page: '', effect: "3-piece set effect: Wearer's HP +1000.\nAfter the wearer applies Amp, teammates gain DMG Dealt +16%." } };
  const type42: WikiWeapon = {
    name: 'Type 42',
    rarity: 6,
    type: 'Arts Unit',
    source: null,
    description: [],
    stats: { levels: [1, 90], baseAtk: [51, 505] },
    potential: null,
    tuning: [],
    page: '',
    skills: [
      { name: 'Intellect [L]', tag: null, text: 'Intellect ⟦num|+{0}⟧', values: [[20, 36, 52, 68, 84, 100, 116, 132, 156]] },
      { name: 'ULT Efficiency [L]', tag: null, text: 'Ultimate Gain Efficiency ⟦num|+{0}%⟧', values: [[5.95, 10.71, 15.48, 20.24, 25, 29.76, 34.52, 39.29, 46.43]] },
      { name: 'Detonate', tag: null, text: 'ATK ⟦num|+{0}%⟧. Wielder…', values: [[16, 19.2, 22.4, 25.6, 28.8, 32, 35.2, 38.4, 44.8]] },
    ],
  };
  const arcane = {
    mainAttribute: 'Intellect',
    secondaryAttribute: 'Will',
    talents: [{ name: 'Keen Mind/Stalwart', levels: [8, 10, 10, 15].map((n) => ({ requires: '', description: `Operator Intellect and Will +${n}.` })) }],
    potentials: [],
  };
  const loadout: Loadout = { weapon: 'w', armor: 'armor', gloves: 'hand', kit1: 'slab', kit2: 'slab' };
  const b = operatorBonuses(arcane, { potential: 0, loadout, weapon: { w: type42, potential: 0 }, items, sets });

  it('matches Intellect 430, Will 765, HP 6950, ATK 4802 and DEF 140', () => {
    const int = statTotal(176.44, b.get('Intellect'));
    const will = statTotal(121.499, b.get('Will'));
    expect(Math.trunc(int)).toBe(430);
    expect(Math.round(will)).toBe(765);
    // Attributes feed HP and ATK as whole numbers: Strength 91.855 → 91 → 455 HP.
    expect(hpTotal(5495, b.get('HP'), Math.floor(statTotal(91.855, b.get('Strength')))).total).toBe(6950);
    expect(Math.round(atkTotal(312, b.get('ATK'), Math.trunc(int), Math.round(will)).total)).toBe(4802);
    expect(b.get('DEF')?.flat).toBe(140);
  });

  it('counts a lower Artifice level when one is set', () => {
    const low = operatorBonuses(arcane, { loadout: { ...loadout, artifice: { gloves: 0 } }, weapon: { w: type42, potential: 0 }, items, sets });
    expect(Math.trunc(statTotal(176.44, low.get('Intellect')))).toBe(418);
  });

  it('counts each stat at its own Artifice level', () => {
    const at = (gloves: number | number[]) => operatorBonuses(arcane, { loadout: { ...loadout, artifice: { gloves } }, weapon: { w: type42, potential: 0 }, items, sets });
    // Wraps: Will 65/71/78/84, Intellect 43/47/51/55. Will kept at 3, Intellect at 0: only Intellect drops (55 → 43).
    const intLow = at([3, 0]);
    expect(Math.trunc(statTotal(176.44, intLow.get('Intellect')))).toBe(418);
    expect(Math.round(statTotal(121.499, intLow.get('Will')))).toBe(765);
    const willLow = at([0, 3]);
    expect(Math.trunc(statTotal(176.44, willLow.get('Intellect')))).toBe(430);
    expect(willLow.get('Will')!.flat).toBe(b.get('Will')!.flat - 19);
    expect(willLow.get('Will')!.sources.find((s) => s.from.startsWith('Wraps'))?.from).toBe('Wraps (Artifice 0/3)');
  });

  it('reads a save from before per-stat Artifice as every stat at that level', () => {
    for (const n of [0, 1, 2, 3]) {
      const old = operatorBonuses(arcane, { loadout: { ...loadout, artifice: { gloves: n } }, items, sets });
      const now = operatorBonuses(arcane, { loadout: { ...loadout, artifice: { gloves: [n, n] } }, items, sets });
      expect(now).toEqual(old);
    }
  });
});

describe('per-stat Artifice', () => {
  const g = (stats: number[][], artifice = true): WikiGear => ({ ...piece(null), artifice, stats: stats.map((values, i) => ({ stat: `S${i}`, values })) });
  const gold = g([[32, 35, 38, 41], [21, 23, 25, 27], [0.414, 0.455, 0.497, 0.538]]);

  it('converts old saves: one number for every stat, nothing for each stat at its highest', () => {
    expect(artificeLevels(2, [3, 3, 3])).toEqual([2, 2, 2]);
    expect(artificeLevels(undefined, [3, 3, 3])).toEqual([3, 3, 3]);
    expect(artificeLevels([3, 0, 1], [3, 3, 3])).toEqual([3, 0, 1]);
    // Kept to each stat's own range; a piece that can't be artificed stays at 0.
    expect(artificeLevels(9, [3, 3, 0])).toEqual([3, 3, 0]);
    expect(artificeLevels([-1, 5], [3, 3])).toEqual([0, 3]);
    expect(artificeTops(g([[10], [5]], false))).toEqual([0, 0]);
  });

  it('marks the piece empty, half or full as the game does', () => {
    const tops = artificeTops(gold);
    expect(artificeState([0, 0, 0], tops)).toBe('empty');
    expect(artificeState([1, 0, 0], tops)).toBe('half');
    expect(artificeState([3, 3, 2], tops)).toBe('half');
    expect(artificeState([3, 3, 3], tops)).toBe('full');
    // Two stats: full at 6 (stats × 3).
    expect(artificeState([3, 3], [3, 3])).toBe('full');
    expect(artificeState([0, 0], [0, 0])).toBeNull();
  });

  it('sets one stat, and drops the entry when every stat is back at its highest', () => {
    const l: Loadout = { kit1: 'k', artifice: { kit1: 2 } };
    expect(withArtifice(l, 'kit1', gold, 1, 0)?.artifice).toEqual({ kit1: [2, 0, 2] });
    expect(withArtifice({ kit1: 'k' }, 'kit1', gold, 0, 1)?.artifice).toEqual({ kit1: [1, 3, 3] });
    expect(withArtifice({ kit1: 'k', artifice: { kit1: [2, 3, 3] } }, 'kit1', gold, 0, 3)).toEqual({ kit1: 'k' });
    expect(withArtifice(l, 'kit1', gold, 0, null)).toEqual({ kit1: 'k' });
  });

  it('gives the sim each stat at its own level, DEF unchanged, and old runs the same stats as before', () => {
    const gear = {
      items: { k: { suit: null, part: 'EDC', level: 70, stats: [{ attr: 'Def', how: 'BaseAddition', values: [21, 21, 21, 21] }, { attr: 'Will', how: 'BaseAddition', values: [32, 35, 38, 41] }, { attr: 'Agi', how: 'BaseAddition', values: [21, 23, 25, 27] }, { attr: 'NormalSkillDamageIncrease', how: 'BaseAddition', values: [0.414, 0.455, 0.497, 0.538] }] } },
      sets: {},
      skills: {},
      buffs: {},
      patch: {},
    } as GearData;
    const op = { skills: {}, buffs: {}, patch: {} } as unknown as Parameters<typeof equip>[0];
    const values = (artifice: number | number[]) => equip(op, { gear: [{ id: 'k', artifice }] }, undefined, gear).stats.mods!.map((m) => m.value);
    expect(values([3, 0, 1])).toEqual([21, 41, 21, 0.455]);
    for (const n of [0, 1, 2, 3]) expect(values(n)).toEqual(values([n, n, n]));
    expect(values(2)).toEqual([21, 38, 25, 0.497]);
  });
});

describe('ended banners', () => {
  const at = (iso: string) => ({ americas: iso, asia: iso });
  const schedule = {
    versions: [],
    banners: [
      { name: 'Old', kind: 'chartered', rateUps: [], poolId: 'special_1_0_1', version: null, start: at('2026-01-01T00:00:00Z'), end: at('2026-02-01T00:00:00Z'), availability: null, art: null, posts: [] },
      { name: 'Unpooled', kind: 'special', rateUps: [], poolId: null, version: null, start: at('2026-01-01T00:00:00Z'), end: at('2026-02-01T00:00:00Z'), availability: null, art: null, posts: [] },
      { name: 'Now', kind: 'chartered', rateUps: [], poolId: 'special_1_1_1', version: null, start: at('2026-03-01T00:00:00Z'), end: at('2026-04-01T00:00:00Z'), availability: null, art: null, posts: [] },
    ],
  } as Schedule;
  const ended = bannerEnded(schedule, 'americas', Date.parse('2026-03-10T00:00:00Z'));
  const b = (poolId: string, name: string, category = 'chartered', done = false) => ({ poolId, name, category, pity: { done } });

  it('goes by the schedule, by pool id or else by name', () => {
    expect(ended(b('special_1_0_1', 'Old'))).toBe(true);
    expect(ended(b('joint_9', 'Unpooled', 'joint'))).toBe(true);
    expect(ended(b('special_1_1_1', 'Now'))).toBe(false);
  });

  it('never ends unscheduled pools; New Horizons ends at its 6★', () => {
    expect(ended(b('standard', 'Basic Headhunting', 'basic'))).toBe(false);
    expect(ended(b('beginner', 'New Horizons', 'newHorizons'))).toBe(false);
    expect(ended(b('beginner', 'New Horizons', 'newHorizons', true))).toBe(true);
  });
});
