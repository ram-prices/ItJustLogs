import { beforeAll, describe, expect, it } from 'vitest';
import { COMBO_TRIGGERS } from './engine';
import { actions, finding, nthHit, type OperatorRules, potentials, type Probe, type Rule, rules as r, type Step, Sources, TEAM_USP, TEAM_USP_SOURCE, runTables } from './testkit';

/**
 * Per-operator rule tests, batch 3: operators new in 1.7 (Kay). Same harness and rules as batches 1 and 2 (testkit.ts):
 * every row names its source and asserts against the data, never the sim's own output; `finding` marks a gap waiting on
 * the owner, run as an expected failure.
 */

// ---------------------------------------------------------------------------
// Kay (chr_0040_sweetpie), and her signature weapon Sweet Deal (wpn_lance_0017)
// ---------------------------------------------------------------------------

const KAY: OperatorRules = (() => {
  const ID = 'chr_0040_sweetpie';
  const WIKI = 'wiki/operators.json';
  /** The numbers marked in a talent's last level (wiki/operators.json talents). */
  const talent = (d: Sources, name: string): number[] => {
    const t = (d.wiki as any).talents.find((x: { name: string }) => x.name === name);
    return [...(t.levels.at(-1).description as string).matchAll(/⟦num\|([^⟧]+)⟧/g)].map((m) => {
      const s = m[1].replace(/^\+/, '');
      return s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s);
    });
  };
  /** A talent level's attached-skill blackboard value (combat/ops talents <id>_<key>). */
  const talentBB = (d: Sources, key: string, bb: string): number =>
    Number(d.bundle.talents[`${ID}_${key}`].flatMap((t: any) => t.attachSkill?.blackboard ?? []).find((x: { key: string }) => x.key === bb).value);
  const BASH = /_normal_skill$/;
  const THROW = /_combo_skill_projhit/;
  const ULT = /_ultimate_skill$/;
  /** Hot Edgy Naives: buff_chr_0040_sweetpie_weapon_recycle_buff's stacks (what the bash's SaveBuffStackNumAdvanced reads). */
  const NAIVES = /_weapon_recycle_buff$/;
  const WEAPONS = 'buff_chr_0040_sweetpie_weapon_count';
  /** n combos (each throws a Weapon, salvaged at once: +1 Hot Edgy Naives), then the bash. */
  const thrown = (n: number): Step[] => [...Array.from({ length: n }, () => ({ input: 'combo' as const, wait: 7.5 })), { input: 'battle', wait: 6 }];
  /** The enemy Staggers on the next Final Strike (17) and every one after: its meter is 15 here. */
  const fragile = (p: Probe) => {
    (p.w as any).foe.poise = 15;
  };
  /** Three chains: Staggers at ~8.7 s, ~10 s later, then ~20 s after that. */
  const STAGGERS: Step[] = [
    { input: 'chain', wait: 2, before: fragile },
    { input: 'chain', wait: 10 },
    { input: 'chain', wait: 2 },
  ];
  /** A live buff's blackboard value on Kay at the probe's end. */
  const bbOf = (p: Probe, id: string, key: string) => p.op.buffs.find((b) => b.id === id)?.bb.get(key) ?? 'none';
  const SALVAGE_NOTE = 'no positions: a dropped Weapon or Picnic Snack is touched by the controlled operator as soon as its entity\'s aura starts (frame 9)';

  const rules: Rule[] = [
    // Basic attack. SEQ 3 throws one lance (one projectile hit of atk_scale); the wiki's 28%/60% is display_atk_scale,
    // 4 × atk_scale.
    ...r.chain(5).flatMap((x, i) =>
      i === 2
        ? finding(
            x,
            'data: wiki SEQ 3 = patch attack3 display_atk_scale (0.28 / 0.60) = 4 × atk_scale; the timeline launches one projectile (attack2_projhit, atk_scale 0.07 / 0.15) and the projectile’s own hit count isn’t in the readable data (no projectile table). Sim 1 hit. Needs a recording.',
            [1, 12],
          )
        : [x],
    ),
    ...r.finalStrike(),
    {
      what: 'basic attacks deal Physical DMG, her skills Nature DMG',
      source: `${WIKI} Basic Attack description ("Physical DMG"), skills' descriptions ("Nature DMG")`,
      sim: (p) => [...new Set(p.hits.filter((h) => h.operator === ID && h.kind === 'skill' && !/^buff_/.test(h.skill)).map((h) => `${h.skillKind === 'basic' ? 'basic' : 'skill'}:${h.type}`))].sort(),
      data: () => ['basic:Physical', 'skill:Natural'],
    },

    // Battle skill "Really Heavy Bash".
    r.spCost(),
    r.mult('battle', 'DMG Multiplier', { skill: BASH, what: 'Battle Skill "DMG Multiplier" with no Hot Edgy Naives (atk_scale_1 + atk_scale)' }),
    r.stagger('battle', 'Stagger'),
    r.inflicts('battle', 1, `${WIKI} Battle Skill description: "applies Nature Infliction"`),
    r.energy('battle', 'SP Cost', { what: 'Battle Skill Ultimate Energy (usp_everyone)', source: TEAM_USP_SOURCE, data: (d) => TEAM_USP(d) }),
    {
      what: 'Battle Skill returns no SP',
      source: 'combat/ops skills normal_skill: no Atb ObtainCostAction',
      sim: (p) => p.sum(p.sp, p.nth('battle')),
      data: () => 0,
    },
    r.kind('battle', BASH),
    r.free('battle'),
    {
      what: 'Battle Skill on 1 Hot Edgy Naives: "DMG Multiplier" + 1 × "Bonus DMG Multiplier per Hot Edgy Naives"',
      source: `${WIKI} Battle Skill "DMG Multiplier", "Bonus DMG Multiplier per Hot Edgy Naives"; combat/ops normal_skill atk_scale + buff_stack × atk_scale_per_weapon`,
      setup: 'naives1',
      ranks: [1, 12],
      tol: 0.011,
      sim: (p) => p.scaleOf(p.nth('battle'), BASH),
      data: (d, rank) => d.value('Battle Skill', 'DMG Multiplier', rank) + d.value('Battle Skill', 'Bonus DMG Multiplier per Hot Edgy Naives', rank),
    },
    {
      what: 'Battle Skill on 3 Hot Edgy Naives (four combos: the stacks cap at 3)',
      source: `${WIKI} Battle Skill description ("> 3 ... same as 3 stacks"); combat/ops buffs weapon_recycle_buff maxStackCnt 3`,
      setup: 'naives3',
      ranks: [1, 12],
      tol: 0.011,
      sim: (p) => p.scaleOf(p.nth('battle'), BASH),
      data: (d, rank) => d.value('Battle Skill', 'DMG Multiplier', rank) + 3 * d.value('Battle Skill', 'Bonus DMG Multiplier per Hot Edgy Naives', rank),
    },
    {
      what: 'Battle Skill consumes all Hot Edgy Naives',
      source: `${WIKI} Battle Skill description ("consumes all Hot Edgy Naives stacks"); combat/ops normal_skill FinishBuffAdvanced weapon_recycle_buff finishAll`,
      setup: 'naives3',
      sim: (p) => p.op.buffs.some((b) => NAIVES.test(b.id)),
      data: () => false,
    },
    {
      what: 'Battle Skill on 3 Hot Edgy Naives forcibly applies Combustion, "Combustion Duration (s)"',
      source: `${WIKI} Battle Skill "Combustion Duration (s)"; combat/ops normal_skill buff_common_fire_fire_burning_triggered duration_burning`,
      setup: 'naives3',
      tol: 1 / 30 + 1e-6,
      sim: (p) => {
        const b = p.buffOf(p.nth('battle'), /^buff_common_fire_fire_burning_triggered$/, 'enemy');
        return b ? b.frames / 30 : 'none';
      },
      data: (d) => d.value('Battle Skill', 'Combustion Duration (s)'),
    },
    {
      what: 'Battle Skill on 1 Hot Edgy Naives applies no Combustion',
      source: `${WIKI} Battle Skill description ("If Kay consumes 3 ... Combustion")`,
      setup: 'naives1',
      sim: (p) => !!p.buffOf(p.nth('battle'), /burning/, 'enemy'),
      data: () => false,
    },

    // Combo skill "Really Kwik Smash": one Weapon thrown (the variant by distance; no positions: the nearest, 414).
    r.mult('combo', 'DMG Multiplier', { skill: THROW }),
    r.stagger('combo', 'Stagger', { skill: THROW }),
    r.cooldown('combo'),
    r.energy('combo', 'Ultimate Energy Gain', { filter: (e) => e.value > 0 }),
    {
      what: 'Combo Skill "SP Recovery" (the Weapon hitting)',
      source: `${WIKI} Combo Skill "SP Recovery"; combat/ops combo_skill_projhit ObtainCostAction Atb bb:atb`,
      ranks: [1, 12],
      sim: (p) => p.sum(p.sp, p.nth('combo')),
      data: (d, rank) => d.value('Combo Skill', 'SP Recovery', rank),
    },
    {
      what: 'Combo Skill forcibly applies a Nature Burst',
      source: `${WIKI} Combo Skill description; combat/ops combo_skill_projhit CreateBuffAction buff_common_natural_natural_triggered`,
      sim: (p) => !!p.buffOf(p.nth('combo'), /^buff_common_natural_natural_triggered$/, 'enemy'),
      data: () => true,
    },
    r.kind('combo', THROW),
    r.free('combo'),
    {
      what: `Combo Skill's Weapon drops and is salvaged: +1 Hot Edgy Naives, still 3 Weapons (${SALVAGE_NOTE})`,
      source: `${WIKI} talents "Bottomless Arsenal" ("Kay starts with 3 Weapons"; "Salvaging a Weapon grants Kay 1 stack"); combat/ops passive_default buffs (3 × weapon_count), combo_skill_weapon_leave_abilityrange`,
      sim: (p) => [p.buffOf(p.nth('combo'), NAIVES, 'self')?.stacks ?? 0, p.op.buffs.find((b) => b.id === WEAPONS)?.stacks ?? 0],
      data: (d) => [1, d.bundle.skills[`${ID}_passive_default`].buffs.filter((b: { buffId: string }) => b.buffId === WEAPONS).length],
    },
    {
      what: 'Talent "Bottomless Arsenal": a salvage gives the team Arts DMG Dealt, its duration (s)',
      source: `${WIKI} talents "Bottomless Arsenal" (last level: 15s)`,
      tol: 1 / 30 + 1e-6,
      sim: (p) => {
        const b = p.buffOf(p.nth('combo'), /_combo_skill_atk_up$/, 'self');
        return b ? b.frames / 30 : 'none';
      },
      data: (d) => talent(d, 'Bottomless Arsenal')[2],
    },
    {
      what: 'Talent "Bottomless Arsenal": Arts DMG Dealt per salvage (atk_up)',
      source: `${WIKI} talents "Bottomless Arsenal" (last level: +1.5%)`,
      setup: 'salvage',
      sim: (p) => bbOf(p, 'buff_chr_0040_sweetpie_combo_skill_atk_up', 'atk_up'),
      data: (d) => talent(d, 'Bottomless Arsenal')[0],
    },
    {
      what: 'Talent "Bottomless Arsenal" reaches the team',
      source: `${WIKI} talents "Bottomless Arsenal" ("grants the entire team")`,
      setup: 'team',
      sim: (p) => !!p.buffOf(p.nth('combo'), /_combo_skill_atk_up$/, 'chr_0032_lizhiyan'),
      data: () => true,
    },
    {
      what: 'Combo trigger: ≥ 1 Weapon and Nature Infliction applied or Arts Burst dealt (Nature, Cryo, a Burst, Nature with no Weapon)',
      source: `${WIKI} Combo Skill "COMBO TRIGGER" text (the game checks it in code: COMBO_TRIGGERS)`,
      sim: (p) => {
        const f = COMBO_TRIGGERS[ID];
        const w = p.w;
        const enemy = w.enemy;
        const out = [
          f({ kind: 'inflict', element: 'Natural', stacks: 1, target: enemy }, w, p.op),
          f({ kind: 'inflict', element: 'Cryst', stacks: 1, target: enemy }, w, p.op),
          f({ kind: 'burst', of: 'Fire', target: enemy }, w, p.op),
        ];
        const weapons = p.op.buffs.find((b) => b.id === WEAPONS)!;
        const had = weapons.stacks;
        weapons.stacks = 0;
        out.push(f({ kind: 'inflict', element: 'Natural', stacks: 1, target: enemy }, w, p.op));
        weapons.stacks = had;
        return out;
      },
      data: () => [true, false, true, false],
    },

    // Ultimate "Really Sweet Combi-Bonker!".
    r.mult('ultimate', 'SEQ 1 DMG Multiplier', { skill: ULT, pick: nthHit(0) }),
    r.mult('ultimate', 'SEQ 2 DMG Multiplier', { skill: ULT, pick: nthHit(1) }),
    r.mult('ultimate', 'SEQ 3 DMG Multiplier', { skill: ULT, pick: nthHit(2) }),
    r.stagger('ultimate', 'Stagger'),
    r.inflicts('ultimate', 1, `${WIKI} Ultimate description: "applies Nature Infliction"`),
    r.kind('ultimate', ULT),
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    {
      what: 'Ultimate "SP Recovery" (the explosion)',
      source: `${WIKI} Ultimate "SP Recovery"; combat/ops ultimate_skill frame 138 ObtainCostAction Atb bb:atb`,
      ranks: [1, 12],
      sim: (p) => p.sp.find((e) => e.press === p.nth('ultimate'))?.value ?? 0,
      data: (d, rank) => d.value('Ultimate', 'SP Recovery', rank),
    },
    {
      what: `Ultimate's Picnic Snacks: "SP Recovery per Picnic Snack" × the snacks thrown (${SALVAGE_NOTE})`,
      source: `${WIKI} Ultimate "SP Recovery per Picnic Snack"; combat/ops ultimate_skill LaunchProjectile (one per snack), ult_skill_weapon_leave_abilityrange ObtainCostAction bb:atb_food`,
      ranks: [1, 12],
      sim: (p) => p.sum(p.sp, p.nth('ultimate')) - (p.sp.find((e) => e.press === p.nth('ultimate'))?.value ?? 0),
      data: (d, rank) => d.value('Ultimate', 'SP Recovery per Picnic Snack', rank) * actions(d.skill('ultimate_skill'), 'LaunchProjectile').filter((a) => /_ult_weapon/.test(a.data.projectileId)).length,
    },

    // Talent "Have a Waffle!": a Stagger drops a Picnic Waffle (a Picnic Snack's SP), once every 20 s.
    {
      what: `Talent "Have a Waffle!": a Stagger drops a Picnic Waffle: Final Strike SP + a Picnic Snack's (${SALVAGE_NOTE})`,
      source: `${WIKI} talents "Have a Waffle!", Ultimate "SP Recovery per Picnic Snack"; combat/ops passive_talent2 (skill group ultimate) patch atb_food`,
      setup: 'staggers',
      sim: (p) => p.sum(p.sp, p.nth('attack', 4)),
      data: (d) => Number(d.patch('attack5').values.atb) + Number(d.patch('passive_talent2').values.atb_food),
    },
    {
      what: 'Talent "Have a Waffle!": no Waffle from a Stagger within its cooldown (~10 s later)',
      source: `${WIKI} talents "Have a Waffle!" ("once every 20s"); combat/ops talents talent_2_2 attachSkill cd`,
      setup: 'staggers',
      sim: (p) => p.sum(p.sp, p.nth('attack', 9)),
      data: (d) => Number(d.patch('attack5').values.atb),
    },
    {
      what: 'Talent "Have a Waffle!": a Waffle again from a Stagger past its cooldown',
      source: `${WIKI} talents "Have a Waffle!" ("once every 20s"); combat/ops talents talent_2_2 attachSkill cd`,
      setup: 'staggers',
      sim: (p) => p.sum(p.sp, p.nth('attack', 14)),
      data: (d) => Number(d.patch('attack5').values.atb) + Number(d.patch('passive_talent2').values.atb_food),
    },
    {
      what: 'Talent "Have a Waffle!": the script\'s Staggers fall inside and past its cooldown (s) as those rows assume',
      source: 'combat/ops talents talent_2_2 attachSkill blackboard cd (Elite 3; wiki "once every 20s")',
      setup: 'staggers',
      // The gaps from the first Stagger (its Final Strike) to the second and third, against the data's cooldown.
      sim: (p) => {
        const at = (k: number) => p.presses[p.nth('attack', k)].frame / 30;
        return [at(9) - at(4), at(14) - at(4)].map((g) => Math.sign(Math.round(g)));
      },
      data: (d, _r, p) => {
        const cd = talentBB(d, 'talent_2_2', 'cd');
        const at = (k: number) => p.presses[p.nth('attack', k)].frame / 30;
        return [at(9) - at(4) < cd ? 1 : -1, at(14) - at(4) >= cd ? 1 : -1];
      },
    },

    // Potentials.
    {
      what: 'P1: 1 Hot Edgy Naives on entering battle (the bash first thing: + 1 × the bonus)',
      source: `${WIKI} Potential 1 text; combat/ops talents potential_1 buff start_fight_buff (OnEnterFight → weapon_recycle_buff)`,
      setup: 'P1bash',
      ranks: [12],
      tol: 0.011,
      sim: (p) => p.scaleOf(p.nth('battle'), BASH),
      data: (d) => d.value('Battle Skill', 'DMG Multiplier') + d.value('Battle Skill', 'Bonus DMG Multiplier per Hot Edgy Naives'),
    },
    {
      what: 'P1: "Bottomless Arsenal" Arts DMG Dealt + 2%',
      source: `${WIKI} talents "Bottomless Arsenal", Potential 1 text`,
      setup: 'P1salvage',
      sim: (p) => bbOf(p, 'buff_chr_0040_sweetpie_combo_skill_atk_up', 'atk_up'),
      data: (d) => talent(d, 'Bottomless Arsenal')[0] + d.potential(1)[0],
      tol: 1e-9,
    },
    {
      what: 'P1: "Bottomless Arsenal" duration + 10 s',
      source: `${WIKI} talents "Bottomless Arsenal", Potential 1 text`,
      setup: 'P1',
      tol: 1 / 30 + 1e-6,
      sim: (p) => {
        const b = p.buffOf(p.nth('combo'), /_combo_skill_atk_up$/, 'self');
        return b ? b.frames / 30 : 'none';
      },
      data: (d) => talent(d, 'Bottomless Arsenal')[2] + d.potential(1)[2],
    },
    {
      what: 'P2: Strength + 20, Nature DMG Dealt + 10%',
      source: `${WIKI} Potential 2 text; combat/ops talents potential_2 ModifyAttr Str, NaturalDamageIncrease`,
      setup: 'P2',
      sim: (p, base) => [(p.op.attr.Str ?? 0) - (base.op.attr.Str ?? 0), Math.round(((p.op.attr.NaturalDamageIncrease ?? 0) - (base.op.attr.NaturalDamageIncrease ?? 0)) * 1e6) / 1e6],
      data: (d) => d.potential(2),
    },
    {
      what: 'P3: Battle Skill on 3 Hot Edgy Naives, the bonus per stack × 1.2',
      source: `${WIKI} Battle Skill "DMG Multiplier", "Bonus DMG Multiplier per Hot Edgy Naives", Potential 3 text`,
      setup: 'P3naives3',
      tol: 0.011,
      sim: (p) => p.scaleOf(p.nth('battle'), BASH),
      data: (d) => d.value('Battle Skill', 'DMG Multiplier') + 3 * d.value('Battle Skill', 'Bonus DMG Multiplier per Hot Edgy Naives') * d.potential(3)[0],
    },
    r.mult('ultimate', 'SEQ 1 DMG Multiplier', { setup: 'P3', ranks: [12], skill: ULT, pick: nthHit(0), factor: (d) => d.potential(3)[1] }),
    r.mult('ultimate', 'SEQ 2 DMG Multiplier', { setup: 'P3', ranks: [12], skill: ULT, pick: nthHit(1), factor: (d) => d.potential(3)[1] }),
    r.mult('ultimate', 'SEQ 3 DMG Multiplier', { setup: 'P3', ranks: [12], skill: ULT, pick: nthHit(2), factor: (d) => d.potential(3)[1] }),
    r.ultCost({ setup: 'P4', potential: 4 }),
    r.cooldown('combo', { setup: 'P5', ranks: [12], adjust: (d) => d.potential(5)[0], source: `combat/ops patch combo_skill cooldown, ${WIKI} Potential 5 text` }),
    r.mult('combo', 'DMG Multiplier', { setup: 'P5', ranks: [12], skill: THROW, factor: (d) => d.potential(5)[1] }),
    {
      what: 'P5: Combo Skill "SP Recovery" × 1.3',
      source: `${WIKI} Combo Skill "SP Recovery", Potential 5 text; combat/ops talents potential_5 ChangeSkillBlackboard atb Multiply`,
      setup: 'P5',
      tol: 1e-9,
      sim: (p) => p.sum(p.sp, p.nth('combo')),
      data: (d) => d.value('Combo Skill', 'SP Recovery') * d.potential(5)[2],
    },

    // Sweet Deal (wpn_lance_0017): "After the wielder's skill recovers SP, the entire team gains ATK +x% for 30 s (3
    // stacks)"; "After the wielder's skill applies an Arts Burst, the entire team gains Arts DMG Dealt +x% for 15 s".
    {
      what: 'Sweet Deal: the combo’s SP gives the team ATK (s)',
      source: 'combat/weapons wpn_lance_0017 sk_wpn_lance_0017 OnObtainAtb (Gain, Skill), patch duration; wiki weapons text "for 30.00s"',
      setup: 'sweetDeal',
      tol: 1 / 30 + 1e-6,
      sim: (p) => {
        const b = p.buffOf(p.nth('combo'), /^buff_wpn_lance_0017_atkup$/, 'self');
        return b ? b.frames / 30 : 'none';
      },
      data: () => 30,
    },
    ...finding(
      {
        what: 'Sweet Deal: a Final Strike’s SP gives no ATK (it isn’t a skill’s)',
        source: 'combat/weapons wpn_lance_0017 sk_wpn_lance_0017 CheckObtainAtbType obtainTypeList ["Skill"]; combat/ops attack5 ObtainCostAction atbSourceType NormalAttack',
        setup: 'sweetDeal',
        sim: (p) => (p.buffOf(p.nth('attack', 4), /^buff_wpn_lance_0017_atkup$/, 'self') ? 'ATK' : 'none'),
        data: () => 'none',
      },
      'data: only SP gained from a skill (atbSourceType Skill) triggers it; sim: the engine marks every ObtainCostAction as Skill (World.lastAtb), so Final Strikes (atbSourceType NormalAttack) trigger it too. Generic: CheckObtainAtbType "Skill" is also in Akekuri, Pogranichnik, wpn_lance_0015/0018, wpn_sword_0012/0016/0019 and a gear set; fixing it may move replays. Waiting on the owner.',
    ),
    ...finding(
      {
        what: 'Sweet Deal: the combo’s forced Nature Burst gives the team Arts DMG Dealt',
        source: `${WIKI} Combo Skill ("forcibly applies a Nature Burst"); wiki weapons text ("After the wielder's skill applies an Arts Burst"); sk_wpn_lance_0017 OnCharBeforeOutputSpellBurst`,
        setup: 'sweetDeal',
        sim: (p) => !!p.buffOf(p.nth('combo'), /^buff_wpn_lance_0017_spellup$/, 'self'),
        data: () => true,
      },
      'sim: OnCharBeforeOutputSpellBurst is raised only for a Burst from stacking an infliction (engine `inflict`), not for one forced with CreateBuffAction buff_common_natural_natural_triggered. Whether the game raises it then is unclear from the data (the event is the game code’s); the wiki text suggests yes. Waiting on the owner (or a recording).',
    ),
  ];

  return {
    id: ID,
    name: 'Kay',
    setups: {
      naives1: { script: thrown(1) },
      naives3: { script: thrown(4) },
      salvage: { script: [{ input: 'combo', wait: 2 }] },
      team: { team: ['chr_0032_lizhiyan'] },
      staggers: { script: STAGGERS },
      P1: { potential: 1 },
      P1bash: { potential: 1, script: [{ input: 'battle', wait: 6 }] },
      P1salvage: { potential: 1, script: [{ input: 'combo', wait: 2 }] },
      ...potentials(2, 3, 4, 5),
      P3naives3: { potential: 3, script: thrown(4) },
      sweetDeal: { weapon: 'wpn_lance_0017' },
    },
    rules,
  };
})();

runTables([KAY], { describe, beforeAll, it, expect });
