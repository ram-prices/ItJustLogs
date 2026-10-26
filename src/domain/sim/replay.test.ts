import { describe, expect, it } from 'vitest';
import { World, type Bundle, type Stats } from './engine';
import { chainFrames } from './team';

// One operator whose basic attack chain is a single attack, its Final Strike landing on frame 60 of it.
const T = 'Beyond.Gameplay.Core';
const bundle: Bundle = {
  operator: 'chr_test',
  skills: {
    chr_test_attack1: {
      skillId: 'chr_test_attack1',
      durationFrame: 75,
      actionGroupData: {
        timelineActions: [
          {
            _startFrame: 60,
            _endFrame: 61,
            _sequenceActionData: {
              actionData: [
                {
                  $type: `${T}.DamageAction+DamageActionData, Gameplay.Beyond`,
                  attacker: 'ActionSource',
                  targetSettings: { targetSource: 'Target' },
                  damageUnits: [{ damageType: 'Physical', damageDecorateMask: 2097152, atkScale: { value: 1 } }],
                },
              ],
            },
          },
        ],
      },
    },
  },
  buffs: {},
  patch: {},
};
const stats: Stats = { level: 90, main: 'Str', sub: 'Agi', attributes: { Atk: 1000, CriticalRate: 0 } };

describe('replay: Final Strike timing', () => {
  it('measures a chain from its first press to its Final Strike', () => {
    expect(chainFrames(new World([bundle], [stats]), 0)).toBe(60);
  });

  it('under Haste a chain lands sooner (Tangtang\'s combo buff on Yvonne), so the replay starts it later', () => {
    const w = new World([bundle], [stats]);
    const plain = chainFrames(w, 0);
    const hasted = chainFrames(w, 0, 0.25);
    expect(plain).toBe(60);
    expect(hasted).toBe(48);
  });
});

// A combo skill whose banner slows time (the game's TimeDilationAction, layer Global, curve "ComboSkill"), and one cut
// short by a RESETto1 at frame 9 (Arcane's).
const dilation = (startFrame: number, curveKey: string, duration: number) => ({
  _startFrame: startFrame,
  _endFrame: startFrame + 1,
  _sequenceActionData: { actionData: [{ $type: `${T}.TimeDilationAction+Data, Gameplay.Beyond`, layer: 'Global', useCurveKey: true, curveKey, duration: { value: duration } }] },
});
const comboBundle = (reset: boolean): Bundle => ({
  ...bundle,
  skills: {
    ...bundle.skills,
    chr_test_combo_skill: {
      skillId: 'chr_test_combo_skill',
      durationFrame: 60,
      actionGroupData: { timelineActions: [dilation(0, 'ComboSkill', 0.6), ...(reset ? [dilation(9, 'RESETto1', 0.033)] : [])] },
    },
  },
});

describe('stage SP and combo banners', () => {
  it('Glaiver File halves every SP gain, not only regeneration (get_atb_reduce -0.5)', () => {
    const w = new World([bundle], [stats], { sp: { start: 100, max: 700, regen: 4, gain: 0.5 } });
    w.obtain('Atb', 30, w.team[0]);
    expect(w.sp).toBe(115);
    w.obtain('Atb', -100, w.team[0]);
    expect(w.sp).toBe(15);
    const plain = new World([bundle], [stats]);
    const before = plain.sp;
    plain.obtain('Atb', 30, plain.team[0]);
    expect(plain.sp - before).toBe(30);
  });

  it("a combo's banner holds SP regeneration for the time its slow motion loses (0.6 s at a sixth: 15 frames)", () => {
    const w = new World([comboBundle(false)], [stats], { sp: { start: 0, max: 300, regen: 30 } });
    w.strictCombos = false;
    expect(w.press(0, 'combo')).toBe(true);
    for (let i = 0; i < 30; i++) w.tick();
    // 30 frames at 1 SP a frame, 15 of them held.
    expect(Math.round(w.sp)).toBe(15);
  });

  it('a RESETto1 later in the skill ends the slow motion early (Arcane: 9 frames, 8 lost)', () => {
    const w = new World([comboBundle(true)], [stats], { sp: { start: 0, max: 300, regen: 30 } });
    w.strictCombos = false;
    expect(w.press(0, 'combo')).toBe(true);
    for (let i = 0; i < 30; i++) w.tick();
    expect(Math.round(w.sp)).toBe(22);
  });
});

// A battle skill like Last Rite's: cast off-field it jumps from frame 0 to 300, past its MarkCanInterrupt at 51; its
// exclusiveFrame (373) is on the other path.
const lockBundle = (jump: boolean): Bundle => ({
  ...bundle,
  operator: 'chr_lock',
  skills: {
    chr_lock_attack1: { ...bundle.skills.chr_test_attack1, skillId: 'chr_lock_attack1' },
    chr_lock_normal_skill: {
      skillId: 'chr_lock_normal_skill',
      durationFrame: 429,
      exclusiveFrame: 373,
      actionGroupData: {
        timelineActions: [
          ...(jump ? [{ _startFrame: 0, _endFrame: 2, _sequenceActionData: { actionData: [{ $type: `${T}.JumpToAction+Data, Gameplay.Beyond`, destFrame: 300, conditionAction: { actionData: [] } }] } }] : []),
          { _startFrame: 51, _endFrame: 52, _sequenceActionData: { actionData: [{ $type: `${T}.MarkCanInterrupt+Data, Gameplay.Beyond` }] } },
        ],
      },
    },
  },
});

describe('swaps and skill holds', () => {
  it('a skill that jumps past its MarkCanInterrupt no longer holds its operator: a swap to Last Rite 0.75 s into her off-field cast', () => {
    const w = new World([bundle, lockBundle(true)], [stats, stats]);
    w.swaps = true;
    expect(w.press(1, 'battle')).toBe(true);
    for (let i = 0; i < 23; i++) w.tick();
    expect(w.can(1, 'swap')).toBe(true);
  });

  it('without the jump the mark still holds it until frame 51', () => {
    const w = new World([bundle, lockBundle(false)], [stats, stats]);
    w.swaps = true;
    expect(w.press(1, 'battle')).toBe(true);
    for (let i = 0; i < 23; i++) w.tick();
    expect(w.can(1, 'swap')).toBe(false);
  });

  it('a press holds its operator for the replay to its MarkCanInterrupt, not its exclusiveFrame', () => {
    const w = new World([bundle, lockBundle(true)], [stats, stats]);
    expect(w.holdOf(1, 'battle')).toBe(51);
  });
});

describe("an operator's own tag", () => {
  // Last Rite's skills mark their Ultimate Energy with 264623624 and her passive lets only that through; her Perfusion
  // checks the striker for it (CheckTagMatch on its owner) to make phantom_main instead of the teammates' phantom.
  const own: Bundle = {
    ...bundle,
    operator: 'chr_own',
    skills: {
      chr_own_attack1: { ...bundle.skills.chr_test_attack1, skillId: 'chr_own_attack1' },
      chr_own_normal_skill: { skillId: 'chr_own_normal_skill', actionGroupData: { timelineActions: [{ _startFrame: 0, _endFrame: 1, _sequenceActionData: { actionData: [{ $type: `${T}.ObtainCostAction+Data, Gameplay.Beyond`, useUspRecoverTag: true, uspRecoverTag: { tagId: 264623624 } }] } }] } },
    },
    buffs: { buff_chr_own_passive: { id: 'buff_chr_own_passive', buffEventAction: [{ actions: [{ actionData: [{ $type: `${T}.RefrainObtainUsp+Data, Gameplay.Beyond`, refrainObtainUspTags: { predefinedTag: [{ tagId: 264623624 }, { tagId: 7 }] } }] }] }] } },
  };

  it('is the tag her own energy gains carry that her passive lets through', () => {
    const w = new World([bundle, own], [stats, stats]);
    expect(w.ownTags(w.team[1])).toEqual([264623624]);
    expect(w.ownTags(w.team[0])).toEqual([]);
  });
});

describe('search filters', () => {
  it('ExcludeOwnerValidator leaves out the ability\'s owner (Eternal Xiranite: "other teammates")', () => {
    const w = new World([bundle, { ...bundle, operator: 'chr_two' }, { ...bundle, operator: 'chr_three' }], [stats, stats, stats]);
    const spec = {
      targetSource: 'InstantSearch',
      selectorData: { finderData: { $type: `${T}.Selector+CharacterTeamFinder+Data, Gameplay.Beyond` }, validatorData: [{ $type: `${T}.Selector+ExcludeOwnerValidator+Data, Gameplay.Beyond` }] },
    };
    const owner = w.team[2];
    const got = w.targets(spec, { owner, source: owner, target: null, bb: new Map(), groups: new Map(), skillId: '' } as never);
    expect(got.map((e) => e.slot)).toEqual([0, 1]);
  });
});

describe('ultimate cut-ins', () => {
  it("stop the caster's own summons but not another operator's (Si's Ink Lung counts on through Arcane's cut-in)", () => {
    const ult: Bundle = {
      ...bundle,
      skills: {
        ...bundle.skills,
        chr_test_ultimate_skill: {
          skillId: 'chr_test_ultimate_skill',
          durationFrame: 60,
          actionGroupData: { timelineActions: [{ _startFrame: 0, _endFrame: 30, _sequenceActionData: { actionData: [{ $type: `${T}.UltimateTimeAction+Data, Gameplay.Beyond`, timeScale: 0 }] } }] },
        },
      },
    };
    const w = new World([ult, { ...bundle, operator: 'chr_two' }], [stats, stats]);
    w.strictUltimates = false;
    // A summon of each operator, each running a long skill.
    const summon = (of: number) => ({ ...w.team[of], id: `summon${of}`, slot: -1, owner: w.team[of], buffs: [], bb: new Map(), mods: [], listeners: [] });
    const mine = summon(0);
    const theirs = summon(1);
    const runs = [mine, theirs].map((e) => w.cast('chr_test_attack1', e as never, e as never, w.enemy)!);
    const at = runs.map((r) => w.frame - r.start);
    expect(w.press(0, 'ultimate')).toBe(true);
    for (let i = 0; i < 10; i++) w.tick();
    expect(w.frame - runs[0].start - at[0]).toBeLessThan(3);
    expect(w.frame - runs[1].start - at[1]).toBeGreaterThanOrEqual(9);
  });
});

describe('Finishers', () => {
  // The test operator with a power attack (landing on frame 20) and two buffs that map its next basic attack: a
  // talent's (Yvonne's after her bomb) and an ultimate's closing attack.
  const hit = (frame: number) => ({ _startFrame: frame, _endFrame: frame + 1, _sequenceActionData: { actionData: [bundle.skills.chr_test_attack1.actionGroupData.timelineActions[0]._sequenceActionData.actionData[0]] } });
  const mapping = (skillId: string) => ({ lifeType: 'Limited', duration: { value: 15 }, buffEventAction: [{ buffEvent: 'DuringBuffEnable', actions: [{ actionData: [{ $type: `${T}.ComboCacheAction+Data, Gameplay.Beyond`, mappingDataList: [{ cmdType: 'Attack', skillId }] }] }] }] });
  const fin: Bundle = {
    ...bundle,
    skills: {
      ...bundle.skills,
      chr_test_power_attack: { skillId: 'chr_test_power_attack', durationFrame: 45, actionGroupData: { timelineActions: [hit(20)] } },
      chr_test_attack5: { skillId: 'chr_test_attack5', durationFrame: 30, actionGroupData: { timelineActions: [hit(10)] } },
      chr_test_ult_attack_end: { skillId: 'chr_test_ult_attack_end', durationFrame: 30, actionGroupData: { timelineActions: [hit(10)] } },
    },
    buffs: { buff_talent: { id: 'buff_talent', ...mapping('chr_test_attack5') }, buff_ult_end: { id: 'buff_ult_end', ...mapping('chr_test_ult_attack_end') } },
  };
  const staggered = (buff: string) => {
    const w = new World([fin], [stats]);
    w.addBuff(w.team[0], buff, w.team[0], new Map());
    w.enemy.bb.set('staggeredUntil', w.frame + 300);
    w.enemy.bb.set('finisherReady', 1);
    return w;
  };
  const firstStrike = (w: World) => {
    expect(w.press(0, 'attack')).toBe(true);
    for (let i = 0; i < 30 && !w.strikes.length; i++) w.tick();
    return w.strikes[0];
  };

  it("comes before a talent's waiting attack, which stays for after it (Skydrummer video: Finisher 137.3, Final Strike 139.0)", () => {
    const w = staggered('buff_talent');
    expect(firstStrike(w)?.finisher).toBe(true);
    expect(w.strikeWaiting(0)).toBe(true);
  });

  it("gives way to an ultimate's closing attack (Alleikhreos video: no Finisher in Yvonne's ultimate)", () => {
    expect(firstStrike(staggered('buff_ult_end'))?.finisher).toBe(false);
  });

  it('is never made while the replay holds it (World.finishers: the video shows none)', () => {
    const w = staggered('buff_talent');
    w.finishers = false;
    expect(firstStrike(w)?.finisher).toBe(false);
  });
});
