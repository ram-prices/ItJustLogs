import { beforeAll, describe, expect, it } from 'vitest';
import { FPS } from './engine';
import {
  actions,
  allButLast,
  DAMAGE_TYPE,
  finding,
  first,
  inflictOn,
  last,
  nthHit,
  type OperatorRules,
  potentials,
  Probe,
  type Rule,
  rules as r,
  SCRIPT,
  Sources,
  type Step,
  TEAM_USP,
  TEAM_USP_SOURCE,
  textNums,
  runTables,
  type TraceHit,
} from './testkit';

/**
 * Per-operator rule tests, batch 2: every operator batch 1 (rules.test.ts) didn't cover, and the rows batch 1 left out
 * for its own eight. Same harness (testkit.ts) and the same rules: every row names its source; `footage` marks a rule
 * the engine takes from the recordings; `finding` marks a gap waiting on the owner, run as an expected failure (it turns
 * red once the engine matches the data: then drop it). A failure is a finding, never a reason to change the expectation.
 *
 * Each section keeps its helpers to itself (its own block), so names can't clash between sections.
 */

// ---------------------------------------------------------------------------
// Endministrator (both), Perlica, Chen Qianyu, Wulfgard, Arclight, Ember
// ---------------------------------------------------------------------------

const SLICE_A: OperatorRules[] = (() => {
  // Batch 2, slice A: Endministrator (both), Perlica, Chen Qianyu, Wulfgard, Arclight, Ember.

  /** A press's skill hits only (no Arts Burst, Physical Status or Combustion ticks). */
  const skillOnly = (h: TraceHit[]) => h.filter((x) => x.kind === 'skill');
  /** The numbers marked in a talent's last level (wiki/operators.json talents). */
  const talent = (d: Sources, name: string): number[] => {
    const t = (d.wiki as any).talents.find((x: { name: string }) => x.name === name);
    if (!t) throw new Error(`${d.wiki.name}: no talent ${name}`);
    return [...(t.levels.at(-1).description as string).matchAll(/⟦(?:num|stagger)\|([^⟧]+)⟧/g)].map((m) => {
      const s = m[1].replace(/^\+/, '');
      return s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s);
    });
  };
  /** A talent's number in its combat bundle's talents (<id>_<key>: attachBuff blackboard or skillBbModifier). */
  const talentBB = (d: Sources, key: string, bb: string): number => {
    for (const t of d.bundle.talents[`${d.id}_${key}`]) {
      const v = t.attachBuff?.blackboard?.find((x: { key: string }) => x.key === bb)?.value;
      if (v != null) return Number(v);
      if (t.skillBbModifier?.bbKey === bb) return Number(t.skillBbModifier.floatValue);
    }
    throw new Error(`${d.id}: no ${key} ${bb}`);
  };
  /** An Arts Reaction forced on the enemy just before a press (as ForceSpellStatusAction does). */
  const react = (element: string) => (p: Probe) =>
    (p.w as any).forceReaction(p.w.enemy, element, 1, {
      owner: p.op,
      source: p.op,
      target: p.w.enemy,
      bb: new Map(),
      groups: new Map(),
      skillId: 'test',
    });
  /** Vulnerability on the enemy just before a press. */
  const vulnerable = (p: Probe) => (p.w as any).addBuff(p.w.enemy, 'buff_physical_no_guard', p.op, new Map());
  /** A buff's duration (s) a press gave, at a rank (rule.buff reads the wiki at 12 only). */
  const buffAt = (
    input: 'battle' | 'combo' | 'ultimate',
    id: RegExp,
    on: string,
    type: string,
    label: string,
    o: { setup?: string; factor?: (d: Sources) => number; ranks?: number[] } = {},
  ): Rule => ({
    what: `${type} "${label}" on ${on}${o.setup ? ` (${o.setup})` : ''}`,
    source: `wiki/operators.json ${type} "${label}"`,
    setup: o.setup,
    ranks: o.ranks ?? [1, 12],
    // Durations land on whole frames.
    tol: 1 / 30 + 1e-6,
    sim: (p) => {
      const b = p.buffOf(p.nth(input), id, on);
      return b ? b.frames / 30 : 'none';
    },
    data: (d, rank) => d.value(type, label, rank) * (o.factor?.(d) ?? 1),
  });
  /** A press's SP at both ranks. */
  const spAt = (input: 'battle' | 'combo', type: string, label: string, o: { setup?: string; plus?: (d: Sources) => number } = {}): Rule => ({
    what: `${type} "${label}"${o.setup ? ` (${o.setup})` : ''}`,
    source: `wiki/operators.json ${type} "${label}"`,
    setup: o.setup,
    ranks: [1, 12],
    sim: (p) => p.sum(p.sp, p.nth(input)),
    data: (d, rank) => d.value(type, label, rank) + (o.plus?.(d) ?? 0),
  });
  /** Stagger a press dealt at both ranks (rule.stagger reads rank 12). */
  const staggerAt = (input: 'battle' | 'combo' | 'ultimate', type: string, labels: string[], o: { skill?: RegExp; setup?: string } = {}): Rule => ({
    what: `${type} ${labels.map((l) => `"${l}"`).join(' + ')}${o.setup ? ` (${o.setup})` : ''}`,
    source: `wiki/operators.json ${type} ${labels.join(', ')}`,
    setup: o.setup,
    ranks: [1, 12],
    sim: (p) => p.sum(p.poise, p.nth(input), (e) => !o.skill || o.skill.test(e.skill ?? '')),
    data: (d, rank) => labels.reduce((n, l) => n + d.value(type, l, rank), 0),
  });

  // ---------------------------------------------------------------------------

  /** Endministrator: both ids share one kit (same skill table, buffs and talents). */
  const endministrator = (id: string): OperatorRules => ({
    id,
    name: `Endministrator (${id.endsWith('m') ? 'm' : 'f'})`,
    setups: {
      // Her combo seals the enemy in Originium Crystals; her ultimate within the seal shatters them.
      sealed: {
        script: [
          { input: 'combo', wait: 1 },
          { input: 'ultimate', wait: 3 },
        ],
      },
      // Her battle skill (Vulnerability) on the sealed enemy.
      sealedBattle: {
        script: [
          { input: 'combo', wait: 1 },
          { input: 'battle', wait: 3 },
        ],
      },
      P1: {
        potential: 1,
        script: [
          { input: 'combo', wait: 1 },
          { input: 'ultimate', wait: 3 },
        ],
      },
      P3: {
        potential: 3,
        script: [
          { input: 'combo', wait: 1 },
          { input: 'ultimate', wait: 3 },
        ],
      },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      buffAt('combo', /^buff_common_originum_frozen$/, 'enemy', 'Combo Skill', 'Seal Duration (s)'),
      r.free('combo'),
      r.mult('ultimate', 'DMG Multiplier', { pick: first }),
      r.mult('ultimate', 'Bonus DMG Multiplier', {
        setup: 'sealed',
        pick: (h) => h.slice(1),
        what: 'Ultimate "Bonus DMG Multiplier" on a sealed enemy (the 2nd hit)',
      }),
      r.stagger('ultimate', 'Stagger'),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Consuming the crystals: her ultimate's IgniteAction (EndminUlt) on buff_common_originum_frozen, whose
      // igniteEventAction deals the shatter and gives the talent's ATK and P3's Ultimate Energy; Vulnerability's buff
      // ignites it too (NoGuard), and so does a Physical Status (PhysicalStatus).
      {
        what: 'Talent "Essence Disintegration": ATK buff (s) after her ultimate consumes the crystals',
        source: 'wiki/operators.json talents "Essence Disintegration" (15s), combat/ops buffs.buff_common_originum_frozen OnBuffFinish → talent_1_tirgger',
        setup: 'sealed',
        sim: (p) => {
          const b = p.buffOf(p.nth('ultimate'), /talent_1_tirgger$/, 'self');
          return b ? b.frames / 30 : 'none';
        },
        data: () => 15,
      },
      {
        what: 'Combo Skill "Crystal Shattering DMG Multiplier" (battle skill’s Vulnerability on the sealed enemy)',
        source: 'wiki/operators.json Combo Skill "Crystal Shattering DMG Multiplier" (patch combo_skill atk_scale_trigger)',
        setup: 'sealedBattle',
        ranks: [12],
        tol: 0.011,
        sim: (p) => p.scaleOf(p.nth('battle')) - p.scaleOf(p.nth('battle'), /normal_skill$/),
        data: (d) => d.value('Combo Skill', 'Crystal Shattering DMG Multiplier'),
      },
      ...finding(
        {
          what: 'Ultimate SP at P1 (50 returned on consuming the crystals)',
          source: 'wiki/operators.json Potential 1 text',
          setup: 'P1',
          sim: (p) => p.sum(p.sp, p.nth('ultimate')),
          data: (d) => d.potential(1)[0],
        },
        'data: 50 SP when the crystals are consumed; sim 0. Her P1 buff (buff_chr_0003_endminf_potential1) carries atb_return 50, but no skill or buff in the data reads it (the crystal’s ignition handles the talent, P2 and P3 only): the game’s code gives it. Left open.',
      ),
      {
        what: 'Ultimate Ultimate Energy at P3 (15 on consuming the crystals)',
        source: 'wiki/operators.json Potential 3 text',
        setup: 'P3',
        sim: (p) => p.sum(p.energy, p.nth('ultimate'), (e) => e.who === p.id),
        data: (d) => d.potential(3)[0],
      },
      // P2: half the talent's ATK to teammates (needs the talent, above). P5: no data (the wiki shows ???).
      r.dealt('ultimate', 'P4', (d) => d.potential(4)[1], { pick: first, what: 'Ultimate DMG Dealt at P4 (× 1.2)' }),
    ],
  });

  const PERLICA: OperatorRules = {
    id: 'chr_0004_pelica',
    name: 'Perlica',
    setups: {
      // Talent Cycle Protocol: her combo on a Vulnerable enemy chains once more.
      vulnerable: { script: [{ input: 'combo', wait: 6, before: vulnerable }] },
      ...potentials(1, 2, 3, 4),
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.inflicts('battle', 1, 'wiki/operators.json Battle Skill description: "Electric Infliction"'),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      // Electrification's Arts DMG Taken (buff_common_pulse_pulse_conduct_triggered_do).
      buffAt('combo', /pulse_pulse_conduct_triggered_do$/, 'enemy', 'Combo Skill', 'Electrify Duration (s)'),
      r.free('combo'),
      ...finding(
        {
          what: 'Talent "Cycle Protocol": her combo on a Vulnerable enemy chains once more (hits)',
          source: 'wiki/operators.json talents "Cycle Protocol" ("chains 1 more time"), combat/ops talents talent_2_2 (combo_skill talent2 = 1), skills combo_skill_projhit',
          setup: 'vulnerable',
          sim: (p) => skillOnly(p.hitsOf(p.nth('combo'))).length,
          data: () => 2,
        },
        'data: on a Vulnerable enemy (tag 1075718177, buff_physical_no_guard) combo_skill_projhit launches the projectile once more when talent2 > 0; sim: 1 hit. The talent sets talent2 on combo_skill, but the check runs in combo_skill_projhit, whose own blackboard keeps 0 — or the bounce needs a second enemy (FindTarget). Likely data right (one more hit); unsure whether a lone enemy takes the bounce.',
      ),
      r.mult('ultimate', 'DMG Multiplier'),
      r.stagger('ultimate', 'Stagger'),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      buffAt('combo', /pulse_pulse_conduct_triggered_do$/, 'enemy', 'Combo Skill', 'Electrify Duration (s)', {
        setup: 'P1',
        ranks: [12],
        factor: (d) => 1 + d.potential(1)[0],
      }),
      r.ultCost({ setup: 'P2', potential: 2 }),
      {
        what: 'ATK buff (s) at P3 after applying Electrification',
        source: 'combat/ops talents potential_3 attachBuff atk_duration',
        setup: 'P3',
        sim: (p) => {
          const b = p.buffOf(p.nth('combo'), /potential_3_atkup$/, 'self');
          return b ? b.frames / 30 : 'none';
        },
        data: (d) => talentBB(d, 'potential_3', 'atk_duration'),
      },
      // P4 (Electrification's Arts DMG Taken × 1.33) shows only in a teammate's Arts damage; P5 is Critical Rate.
    ],
  };

  const CHEN: OperatorRules = {
    id: 'chr_0005_chen',
    name: 'Chen Qianyu',
    setups: potentials(3, 4, 5),
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier', { pick: skillOnly }),
      r.stagger('battle', 'Stagger', { skill: /normal_skill/ }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier', { pick: skillOnly }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'Slash Multiplier', {
        pick: (h) => skillOnly(h).slice(0, -1),
        per: (p) => skillOnly(p.hitsOf(p.nth('ultimate'))).length - 1,
        what: 'Ultimate "Slash Multiplier" per slash',
      }),
      {
        what: 'Ultimate slashes (7 sequences: 6 slashes and the final strike)',
        source: 'wiki/operators.json Ultimate description "A 7-sequence slash attack"',
        sim: (p) => skillOnly(p.hitsOf(p.nth('ultimate'))).length,
        data: () => 7,
      },
      r.mult('ultimate', 'Final Strike DMG Multiplier', { pick: (h) => skillOnly(h).slice(-1) }),
      staggerAt('ultimate', 'Ultimate', ['First Strike Stagger', 'Final Strike Stagger']),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Talent Slashing Edge: ATK +8% for 10 s on a skill hit, up to 5 stacks.
      {
        what: 'Talent "Slashing Edge" duration (s)',
        source: 'combat/ops talents talent_1_2 attachBuff duration (wiki: "for 10s")',
        sim: (p) => {
          const b = p.buffOf(p.nth('battle'), /chen_talent_0/, 'self');
          return b ? b.frames / 30 : 'none';
        },
        data: (d) => talentBB(d, 'talent_1_2', 'duration'),
      },
      {
        what: 'Talent "Slashing Edge" stacks after the ultimate (at most 5)',
        source: 'combat/ops talents talent_1_2 attachBuff max_stack (wiki: "can reach 5 stacks")',
        sim: (p) => Math.max(...p.buffs.filter((b) => /chen_talent_0/.test(b.id)).map((b) => b.stacks)),
        data: (d) => talentBB(d, 'talent_1_2', 'max_stack'),
      },
      // P1 needs an enemy below half HP (the dummy never is); P2 is attributes.
      r.mult('battle', 'DMG Multiplier', { pick: skillOnly, setup: 'P3', ranks: [12], factor: (d) => d.potential(3)[0] }),
      r.mult('combo', 'DMG Multiplier', { pick: skillOnly, setup: 'P3', ranks: [12], factor: (d) => d.potential(3)[0] }),
      r.mult('ultimate', 'Final Strike DMG Multiplier', {
        pick: (h) => skillOnly(h).slice(-1),
        setup: 'P3',
        ranks: [12],
        factor: (d) => d.potential(3)[0],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.cooldown('combo', {
        setup: 'P5',
        ranks: [12],
        adjust: (d) => d.potential(5)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 5 text',
      }),
    ],
  };

  /** Wulfgard's ultimate (it forces Combustion), then his battle skill consumes it. */
  const WULF_COMBUSTION: Step[] = [
    { input: 'ultimate', wait: 3 },
    { input: 'battle', wait: 4 },
  ];
  /** His combo on cooldown, his ultimate, then the combo again. */
  const WULF_RESET: Step[] = [
    { input: 'combo', wait: 4 },
    { input: 'ultimate', wait: 3 },
    { input: 'combo', wait: 2 },
  ];
  const WULFGARD: OperatorRules = {
    id: 'chr_0006_wolfgd',
    name: 'Wulfgard',
    setups: {
      combustion: { script: WULF_COMBUSTION },
      reset: { script: WULF_RESET },
      P2: { potential: 2, script: WULF_COMBUSTION },
      P4: { potential: 4 },
      P5: { potential: 5, script: WULF_RESET },
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier', { pick: skillOnly }),
      // Three shots of poise_first_bullet 1.67: the wiki's 5 is the total rounded.
      { ...r.stagger('battle', 'Stagger'), tol: 0.011 },
      r.inflicts('battle', 1, 'wiki/operators.json Battle Skill description: "The final shot also applies Heat Infliction"'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('battle', 'Additional ATK DMG Multiplier', { setup: 'combustion', skill: /plus_projhit/ }),
      r.stagger('battle', 'Additional ATK Stagger', { setup: 'combustion', skill: /plus_projhit/ }),
      r.inflicts('battle', 0, 'wiki/operators.json Battle Skill description: on Combustion "do not apply Heat Infliction"', { setup: 'combustion' }),
      {
        what: 'Talent "Code of Restraint": SP returned on consuming Combustion',
        source: 'wiki/operators.json talents "Code of Restraint"',
        setup: 'combustion',
        sim: (p) => p.sum(p.sp, p.nth('battle')),
        data: (d) => talent(d, 'Code of Restraint')[0],
      },
      {
        what: 'Talent "Code of Restraint" SP at P2 (+10)',
        source: 'wiki/operators.json talents "Code of Restraint", Potential 2 text',
        setup: 'P2',
        sim: (p) => p.sum(p.sp, p.nth('battle')),
        data: (d) => talent(d, 'Code of Restraint')[0] + d.potential(2)[0],
      },
      r.mult('combo', 'DMG Multiplier', { pick: skillOnly }),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.inflicts('combo', 1, 'wiki/operators.json Combo Skill description: "Heat Infliction"'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'DMG Multiplier per SEQ', {
        skill: /ultimate_skill/,
        per: (p) => p.hitsOf(p.nth('ultimate'), /ultimate_skill/).length,
        what: 'Ultimate "DMG Multiplier per SEQ" per hit',
      }),
      {
        what: 'Ultimate hits (5)',
        source: 'wiki/operators.json Ultimate description "dealing 5 hits"',
        sim: (p) => p.hitsOf(p.nth('ultimate'), /ultimate_skill/).length,
        data: () => 5,
      },
      r.stagger('ultimate', 'Stagger'),
      {
        what: 'Ultimate forcibly applies Combustion',
        source: 'wiki/operators.json Ultimate description "forcibly applying Combustion"',
        sim: (p) => !!p.buffOf(p.nth('ultimate'), /burning_status$/, 'enemy'),
        data: () => true,
      },
      {
        what: 'Talent "Scorching Fangs" duration (s) on applying Combustion',
        source: 'wiki/operators.json talents "Scorching Fangs" ("for 10s"), combat/ops talents talent_1_2 duration',
        sim: (p) => {
          const b = p.buffOf(p.nth('ultimate'), /talent_0_effectbuff$/, 'self');
          return b ? b.frames / 30 : 'none';
        },
        data: (d) => talentBB(d, 'talent_1_2', 'duration'),
      },
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      {
        what: 'Combo Skill still on cooldown after his ultimate at P0',
        source: 'combat/ops patch combo_skill cooldown (19 s)',
        setup: 'reset',
        sim: (p) => p.presses[p.nth('combo', 1)].ok,
        data: () => false,
      },
      // P1 is attributes; P3 (Scorching Fangs to the team) needs teammates' damage.
      r.ultCost({ setup: 'P4', potential: 4 }),
      {
        what: 'P5: his ultimate resets the combo’s cooldown (combo castable right after)',
        source: 'wiki/operators.json Potential 5 text, combat/ops skills ultimate_skill SetSkillCdAtOnce (functionType Set, value 0, ComboSkill)',
        setup: 'P5',
        sim: (p) => p.presses[p.nth('combo', 1)].ok,
        data: () => true,
      },
    ],
  };

  /** Arclight on an enemy with Electrification: her battle skill consumes it. */
  const ARC_ELECTRIFIED: Step[] = [{ input: 'battle', wait: 4, before: react('Pulse') }];
  /**
   * Arcane beside her: before every ops bundle carried the common reaction buffs (2026-10-29), Arclight's lacked the
   * Electrification ones her skills force; the rows with a teammate stay, beside the ones alone.
   */
  const ARC_MATE = ['chr_0032_lizhiyan'];
  const ARCLIGHT: OperatorRules = {
    id: 'chr_0007_ikut',
    name: 'Arclight',
    setups: {
      electrified: { team: ARC_MATE, script: ARC_ELECTRIFIED },
      // Her ultimate (Electric Infliction, then Electrification), with and without the buffs from a teammate's bundle.
      ultMate: { team: ARC_MATE, script: [{ input: 'ultimate', wait: 4 }] },
      P1: { potential: 1, team: ARC_MATE, script: ARC_ELECTRIFIED },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      // Her skills deal Physical DMG but the additional attack and her ultimate (wiki element: Electric).
      {
        what: 'battle skill and combo hits are Physical, the ultimate Electric',
        source: 'wiki/operators.json Battle Skill, Combo Skill and Ultimate descriptions',
        sim: (p) => ['battle', 'combo', 'ultimate'].map((i) => [...new Set(skillOnly(p.hitsOf(i as any)).map((h) => h.type))]),
        data: () => [['Physical'], ['Physical'], ['Pulse']],
      },
      r.spCost(),
      r.mult('battle', 'SEQ 1 DMG Multiplier', { pick: first }),
      r.mult('battle', 'SEQ 2 DMG Multiplier', { pick: nthHit(1) }),
      r.stagger('battle', 'SEQ 2 Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('battle', 'Additional ATK DMG Multiplier', {
        setup: 'electrified',
        pick: (h) => skillOnly(h).filter((x) => x.type === 'Pulse'),
        what: 'Battle Skill "Additional ATK DMG Multiplier" (the Electric hit, on Electrification)',
      }),
      ...finding(
        {
          what: 'Battle Skill on Electrification: two slashes + the additional attack, nothing more',
          source: 'wiki/operators.json Battle Skill "SEQ 1/2 DMG Multiplier", "Additional ATK DMG Multiplier"',
          setup: 'electrified',
          ranks: [12],
          tol: 0.016,
          sim: (p) => skillOnly(p.hitsOf(p.nth('battle'))).reduce((n, h) => n + h.scale, 0),
          data: (d) =>
            d.value('Battle Skill', 'SEQ 1 DMG Multiplier') +
            d.value('Battle Skill', 'SEQ 2 DMG Multiplier') +
            d.value('Battle Skill', 'Additional ATK DMG Multiplier'),
        },
        'data (wiki): 1.01 + 1.01 + 4.05 = 6.07; sim 7.08: the electrified branch (normal_skill frame 136) has a DamageAction of atk_scale (1.01, Physical) beside the atk_scale2 one, and the sim deals both. The skill also sets SpawnThird when Electrification is on, so this may be a real third slash the wiki doesn’t list: unsure, worth a recording check.',
      ),
      {
        ...r.stagger('battle', 'Additional ATK Stagger', {
          setup: 'electrified',
          data: (d) => d.value('Battle Skill', 'SEQ 2 Stagger') + d.value('Battle Skill', 'Additional ATK Stagger'),
        }),
        what: 'Battle Skill "SEQ 2 Stagger" + "Additional ATK Stagger" on Electrification',
      },
      { ...spAt('battle', 'Battle Skill', 'SP Recovery', { setup: 'electrified' }), what: 'Battle Skill "SP Recovery" on Electrification' },
      {
        ...spAt('battle', 'Battle Skill', 'SP Recovery', { setup: 'P1', plus: (d) => d.potential(1)[0] }),
        ranks: [12],
        what: 'Battle Skill "SP Recovery" on Electrification at P1 (+10)',
      },
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      spAt('combo', 'Combo Skill', 'SP Recovery'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'SEQ 1 DMG Multiplier', { pick: (h) => skillOnly(h).slice(0, 1) }),
      r.mult('ultimate', 'SEQ 2 DMG Multiplier', { pick: (h) => skillOnly(h).slice(1, 2) }),
      staggerAt('ultimate', 'Ultimate', ['SEQ 1 Stagger', 'SEQ 2 Stagger']),
      r.inflicts('ultimate', 1, 'wiki/operators.json Ultimate description: "apply Electric Infliction"'),
      {
        what: 'Ultimate: its second hit consumes the Electric Infliction and forces Electrification (a teammate’s bundle has the buffs)',
        source: 'combat/ops skills ultimate_skill_abentity frame 63: CheckTagMatch Electric Infliction → ForceSpellStatusAction',
        setup: 'ultMate',
        sim: (p) => p.buffs.some((b) => b.press === p.nth('ultimate') && /pulse_cryst_triggered$/.test(b.id) && b.on === 'enemy'),
        data: () => true,
      },
      {
        what: 'Ultimate: its second hit consumes the Electric Infliction and forces Electrification (alone)',
        source: 'combat/ops skills ultimate_skill_abentity frame 63: ForEach → IfElse(CheckTagMatch Electric Infliction 2123008650) → SaveBuffStackNumByTag, ForceSpellStatusAction',
        sim: (p) => p.buffs.some((b) => b.press === p.nth('ultimate') && /pulse_cryst_triggered$/.test(b.id) && b.on === 'enemy'),
        data: () => true,
      },
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // P2 is attributes; P3 and P5 (Wildland Trekker) need 3 (2) additional attacks and a teammate's damage.
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  const EMBER: OperatorRules = {
    id: 'chr_0009_azrila',
    name: 'Ember',
    setups: potentials(4),
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      // Her basic attacks and combo deal Physical DMG, her battle skill and ultimate Heat (wiki element: Heat).
      {
        what: 'battle skill and ultimate hits are Heat, the combo Physical',
        source: 'wiki/operators.json Battle Skill, Combo Skill and Ultimate descriptions',
        sim: (p) => ['battle', 'combo', 'ultimate'].map((i) => [...new Set(skillOnly(p.hitsOf(i as any)).map((h) => h.type))]),
        data: () => [['Fire'], ['Physical'], ['Fire']],
      },
      r.spCost(),
      r.mult('battle', 'DMG Multiplier', { pick: skillOnly }),
      r.stagger('battle', 'Stagger', { skill: /normal_skill/ }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone',
        data: (d) => TEAM_USP(d),
      }),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier', { pick: skillOnly }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill/ }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'DMG Multiplier'),
      r.stagger('ultimate', 'Stagger'),
      r.buff('ultimate', /ultimateshield$/, 'self', 'Shield Duration (s)'),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // The heal, Protection and shield amounts need a team taking damage; P1 (Protection), P2 (attributes), P3
      // (heal) and P5 (shield × 1.2, ATK while shielded) likewise.
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  return [endministrator('chr_0002_endminm'), endministrator('chr_0003_endminf'), PERLICA, CHEN, WULFGARD, ARCLIGHT, EMBER];
})();

// ---------------------------------------------------------------------------
// Xaihi, Avywenna, Gilberta, Snowshine, Lifeng, Laevatain
// ---------------------------------------------------------------------------

const SLICE_B: OperatorRules[] = (() => {
  // Batch 2, slice B: Xaihi, Avywenna, Gilberta, Snowshine, Lifeng, Laevatain.

  const WIKI = 'wiki/operators.json';
  /** The skill's own hits (not a physical status's or an Arts reaction's). */
  const own = (h: TraceHit[]) => h.filter((x) => x.kind === 'skill');
  const ownThen = (f: (h: TraceHit[]) => TraceHit[]) => (h: TraceHit[]) => f(own(h));
  /** The wiki's element word for the basic attack (its text's first DMG term) → the data's damage type. */
  const TERM: Record<string, string> = { phys: 'Physical', cryo: 'Cryst', heat: 'Fire', elec: 'Pulse', nature: 'Natural' };
  /** Basic attack hits are of the type the basic attack's text names; skill hits of the operator's element. */
  const elements = (): Rule[] => [
    {
      what: 'basic attack hits are of the type its text names',
      source: `${WIKI} Basic Attack description (first ⟦…|… DMG⟧)`,
      sim: (p) => [...new Set(p.hits.filter((h) => h.operator === p.id && h.skillKind === 'basic' && h.kind === 'skill').map((h) => h.type))],
      data: (d) => [TERM[/⟦(\w+)\|[^⟧]*DMG⟧/.exec(d.wiki.skills.find((s) => s.type === 'Basic Attack')!.description)![1]]],
    },
    {
      what: 'battle skill, combo and ultimate hits are of the operator’s element',
      source: `${WIKI} element`,
      sim: (p) => [
        ...new Set(p.hits.filter((h) => h.operator === p.id && h.kind === 'skill' && h.skillKind !== 'basic').map((h) => h.type)),
      ],
      data: (d) => [DAMAGE_TYPE[d.wiki.element]],
    },
  ];
  /** A wiki Stagger value at ranks 1 and 12 (rows that differ by rank). */
  const staggerAt = (input: 'battle' | 'combo' | 'ultimate', label: string, type: string, o: { skill?: RegExp; setup?: string } = {}): Rule => ({
    what: `${type} "${label}"`,
    source: `${WIKI} ${type} "${label}"`,
    ranks: [1, 12],
    setup: o.setup,
    sim: (p) => p.sum(p.poise, p.nth(input), (e) => !o.skill || o.skill.test(e.skill ?? '')),
    data: (d, rank) => d.value(type, label, rank),
  });
  /** The ratio a skill assigns buff_common_obtain_ultimate_sp (its CreateBuffAction's assignItems), else 1. */
  const uspRatio = (d: Sources, skill: string): number => {
    const s = JSON.stringify(d.skill(skill));
    const i = s.indexOf('"buffId":"buff_common_obtain_ultimate_sp"');
    const m = /"targetKey":"ratio"[^}]*"numericValue":"?([\d.]+)/.exec(s.slice(i, i + 600));
    return m ? Number(m[1]) : 1;
  };
  /** A talent's (or Potential's) value from combat/ops talents (attachBuff/attachSkill blackboard). */
  const talentValue = (d: Sources, talent: string, key: string): number => {
    for (const t of d.bundle.talents[`${d.id}_${talent}`] ?? [])
      for (const bb of [t.attachBuff?.blackboard ?? [], t.attachSkill?.blackboard ?? []])
        for (const x of bb) if (x.key === key) return Number(x.value);
    throw new Error(`${d.id}: no ${talent} ${key}`);
  };
  /** The live Amp (EnhancedAction) of a kind on an entity at the probe's end. */
  const ampOf = (e: { amp?: { kind: string; rate: number }[] }, kind: RegExp) =>
    Math.max(0, ...(e.amp ?? []).filter((x) => kind.test(x.kind)).map((x) => x.rate));
  const vulnOf = (e: { vulnerable?: { kind: string; rate: number }[] }, kind: RegExp) =>
    Math.max(0, ...(e.vulnerable ?? []).filter((x) => kind.test(x.kind)).map((x) => x.rate));
  /** The battle skill's SP cost when some SP comes back the moment it's cast (Snowshine): cost + that return. */
  const spCostReturned = (): Rule => ({
    what: 'Battle Skill SP cost (with what returns at once)',
    source: `${WIKI} Battle Skill "SP Cost"`,
    sim: (p) => {
      const i = p.nth('battle');
      return p.presses[i].cost + p.sum(p.sp, i, (e) => e.at === 0);
    },
    data: (d) => d.value('Battle Skill', 'SP Cost'),
  });

  // ---------------------------------------------------------------------------

  const XAIHI: OperatorRules = {
    id: 'chr_0011_seraph',
    name: 'Xaihi',
    setups: {
      // Her Auxiliary Crystal, then two Final Strikes (two treatments: the operator is at Max HP, so each grants Arts Amp),
      // attacks as soon as they may so both strikes land within the crystal's 20 s (its onfield check at frame 600).
      crystal: {
        script: [{ input: 'battle', wait: 1 }, ...Array.from({ length: 10 }, (): Step => ({ input: 'attack', wait: 1 })), { input: 'attack', wait: 2 }],
      },
      crystalP1: {
        potential: 1,
        script: [
          { input: 'battle', wait: 2 },
          { input: 'chain', wait: 2 },
        ],
      },
      ...potentials(2, 5),
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      ...elements(),
      r.spCost(),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.buff('battle', /seraph_normal_skill_heal$/, 'self', 'Auxiliary Crystal Duration (s)'),
      r.free('battle'),
      {
        what: 'Battle Skill: the Auxiliary Crystal treats on 2 Final Strikes',
        source: `${WIKI} Battle Skill description "can trigger 2 times"; combat/ops buffs.buff_chr_0011_seraph_combo_count maxStackCnt`,
        setup: 'crystal',
        sim: (p) => p.buffs.filter((b) => /seraph_mainchr_heal$/.test(b.id)).length,
        data: (d) => d.bundle.buffs.buff_chr_0011_seraph_combo_count.stackingSettings.maxStackCnt,
      },
      {
        what: 'Battle Skill "Arts Amp Duration (s)" (treatment at Max HP)',
        source: `${WIKI} Battle Skill "Arts Amp Duration (s)"`,
        setup: 'crystal',
        sim: (p) => {
          const b = p.buffs.find((x) => /potential_1_atkup$/.test(x.id));
          return b ? b.frames / 30 : 'none';
        },
        data: (d) => d.value('Battle Skill', 'Arts Amp Duration (s)'),
      },
      {
        what: 'Battle Skill "Arts Amp" (treatment at Max HP)',
        source: `${WIKI} Battle Skill "Arts Amp"`,
        setup: 'crystal',
        ranks: [1, 12],
        sim: (p) => ampOf(p.op, /Spell/),
        data: (d, rank) => d.value('Battle Skill', 'Arts Amp', rank),
      },
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.inflicts('combo', 1, `${WIKI} Combo Skill description: "deal Cryo DMG and Cryo Infliction"`),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.buff('ultimate', /seraph_atk_buff$/, 'self', 'Duration (s)'),
      {
        what: 'Ultimate Cryo and Nature Amp (base + INT × per INT, the INT part at most "MAX Amp from INT")',
        source: `${WIKI} Ultimate "Base Cryo Amp", "Amp Increase per Intellect", "MAX Amp from INT"; buffs.buff_chr_0011_seraph_atk_buff (StoreAttributeValue Wisd)`,
        ranks: [1, 12],
        sim: (p) => [ampOf(p.op, /^Crystal$/), ampOf(p.op, /^Natural$/)],
        data: (d, rank, p) => {
          const wisd = (p.w as any).stat(p.op, 'Wisd');
          const v =
            d.value('Ultimate', 'Base Cryo Amp', rank) +
            Math.min(wisd * d.value('Ultimate', 'Amp Increase per Intellect', rank), d.value('Ultimate', 'MAX Amp from INT', rank));
          return [v, v];
        },
        tol: 1e-6,
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Potentials. P3 (the combo chains to 1 more enemy) needs a second enemy; P4 is attributes.
      {
        what: 'Battle Skill "Arts Amp" at P1 (+5%)',
        source: `${WIKI} Battle Skill "Arts Amp", Potential 1 text`,
        setup: 'crystalP1',
        sim: (p) => ampOf(p.op, /Spell/),
        data: (d) => d.value('Battle Skill', 'Arts Amp') + d.potential(1)[0],
      },
      r.ultCost({ setup: 'P2', potential: 2 }),
      // At P5 her INT includes P4's +15, so the Amp is worked out from her INT, then × 1.1.
      {
        what: 'Ultimate Cryo Amp at P5 (× 1.1)',
        source: `${WIKI} Ultimate "Base Cryo Amp", "Amp Increase per Intellect", "MAX Amp from INT", Potential 5 text`,
        setup: 'P5',
        sim: (p) => ampOf(p.op, /^Crystal$/),
        data: (d, _r, p) =>
          (d.value('Ultimate', 'Base Cryo Amp') +
            Math.min(
              (p.w as any).stat(p.op, 'Wisd') * d.value('Ultimate', 'Amp Increase per Intellect'),
              d.value('Ultimate', 'MAX Amp from INT'),
            )) *
          d.potential(5)[0],
      },
    ],
  };

  // ---------------------------------------------------------------------------

  /** Her combo's Thunderlance and her ultimate's Thunderlance EX on the field, then her battle skill pulls them back. */
  const LANCES = [
    { input: 'combo' as const, wait: 3 },
    { input: 'ultimate' as const, wait: 3 },
    { input: 'battle' as const, wait: 4 },
  ];
  const AVYWENNA: OperatorRules = {
    id: 'chr_0012_avywen',
    name: 'Avywenna',
    setups: {
      lances: { script: LANCES },
      // Only the combo's lances.
      comboLances: {
        script: [
          { input: 'combo', wait: 3 },
          { input: 'battle', wait: 4 },
        ],
      },
      P1: { potential: 1 },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      ...elements(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier', { skill: /normal_skill$/ }),
      r.stagger('battle', 'Stagger', { skill: /normal_skill$/ }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (no lances: usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.free('battle'),
      // The battle skill's ForEachActions find ComboLances and UltiLances (OwnerSpawnedEntityFinder + TagValidator): each
      // lance comes back once, as its own kind.
      ...finding(
        r.mult('battle', 'Thunderlance EX DMG Multiplier', {
          setup: 'lances',
          skill: /ultimate_skill_lance_back/,
          what: 'Battle Skill: the Thunderlance EX comes back once ("Thunderlance EX DMG Multiplier")',
        }),
        'data 4.32 (one EX lance back), sim 8.64: OwnerSpawnedEntityFinder ignores the TagValidator (tagId 1447025331), so ComboLances and UltiLances both find every lance and each lance flies back twice (once as each kind). Left open (2026-10-29): no skill or buff gives a lance that tag (the entities’ own definitions aren’t in the dump), so the engine can’t tell the two kinds apart. Data right.',
        [1, 12],
      ),
      ...finding(
        {
          what: 'Battle Skill "Thunderlance EX Stagger" (one EX lance back)',
          source: `${WIKI} Battle Skill "Thunderlance EX Stagger"`,
          setup: 'lances',
          sim: (p) => p.sum(p.poise, p.nth('battle'), (e) => /ultimate_skill_lance_back/.test(e.skill ?? '')),
          data: (d) => d.value('Battle Skill', 'Thunderlance EX Stagger'),
        },
        'data 10, sim 20 (each lance back twice: TagValidator ignored). Data right.',
      ),
      // The combo throws 3 Thunderlances (LaunchProjectile to the merged lance_land_pos1-3): 3 come back.
      ...finding(
        r.mult('battle', 'Thunderlance DMG Multiplier', {
          setup: 'comboLances',
          skill: /combo_skill_lance_back/,
          factor: () => 3,
          what: 'Battle Skill: the combo’s 3 Thunderlances come back (3 × "Thunderlance DMG Multiplier")',
        }),
        'data 3 × 1.68 = 5.04 (wiki: the combo "throws 3 Thunderlances"; combo_skill LaunchProjectile to the merged target group lance_land_pos1-3), sim 1.68: one projectile per launch, so one lance on the field. Left open (2026-10-29): the three spots are FixedPointFinder groups, which have no positions here; giving each a spot at the enemy (as random points are) throws the three lances but also gives Arcane’s 4th basic attack (fixed spots too) 1.2 against the wiki’s 0.8. Data right.',
        [1, 12],
      ),
      ...finding(
        {
          what: 'Battle Skill Ultimate Energy with the combo’s lances (talent Expedited Delivery: 4 per lance hit, 3 lances, + usp_everyone)',
          source: `${WIKI} talents "Expedited Delivery" (Elite 2: 4), Combo Skill text "throws 3 Thunderlances"; ${TEAM_USP_SOURCE}`,
          setup: 'comboLances',
          sim: (p) => p.sum(p.energy, p.nth('battle'), (e) => e.who === p.id),
          data: (d) => 3 * 4 + TEAM_USP(d),
        },
        'data 18.5 (3 lances back × 4 + 6.5), sim 14.5 (the one lance flies back twice: 2 × 4 + 6.5). Data right.',
      ),
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      // The combo's hit gives talent0_usp per enemy hit (ForEachAction): Expedited Delivery's 4 at Elite 2, the wiki's 0 own.
      r.energy('combo', 'Ultimate Energy Gain', {
        what: 'Combo Skill Ultimate Energy (0 + Expedited Delivery’s 4, one enemy)',
        source: `${WIKI} Combo Skill "Ultimate Energy Gain" + talents "Expedited Delivery" (Elite 2)`,
        data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') + 4,
      }),
      r.kind('combo', /combo_skill$/),
      r.free('combo'),
      r.mult('ultimate', 'DMG Multiplier'),
      staggerAt('ultimate', 'Stagger', 'Ultimate'),
      {
        what: 'Ultimate Electric Susceptibility (talent Tactful Approach, Elite 3: 10% for 10 s)',
        source: `${WIKI} talents "Tactful Approach" (Elite 3)`,
        sim: (p) => {
          const b = p.buffOf(p.nth('ultimate'), /ultimate_skill_debuff$/, 'enemy');
          return [vulnOf(p.w.enemy, /Pulse/), b ? b.frames / 30 : 'none'];
        },
        data: (d) => {
          const t = (d.wiki as any).talents.find((x: any) => x.name === 'Tactful Approach').levels.at(-1).description;
          return [Number(/⟦num\|(\d+)%⟧/.exec(t)![1]) / 100, Number(/⟦num\|(\d+)⟧s/.exec(t)![1])];
        },
      },
      r.energy('ultimate', 'Ultimate Energy Cost', {
        what: 'Ultimate Ultimate Energy (Expedited Delivery’s 4 for the thrown EX lance)',
        source: `${WIKI} talents "Expedited Delivery" (Elite 2)`,
        data: () => 4,
      }),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Potentials. P2 (+20 s lance duration) outlasts the probe; P3 is attributes and Electric DMG; P5 needs Electric
      // Susceptibility before the lances return (the ultimate's own debuff is there in `lances`, but the lances double).
      r.energy('combo', 'Ultimate Energy Gain', {
        setup: 'P1',
        what: 'Combo Skill Ultimate Energy at P1 (Expedited Delivery +2)',
        source: `${WIKI} talents "Expedited Delivery" (Elite 2), Potential 1 text`,
        data: (d) => 4 + d.potential(1)[0],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  // ---------------------------------------------------------------------------

  /** Messenger's Song (talent_1_2): Ultimate Gain Efficiency for the team's guards, casters and supporters (she is a caster). */
  const SONG = (d: Sources) => talentValue(d, 'talent_1_2', 'add');
  const GILBERTA: OperatorRules = {
    id: 'chr_0013_aglina',
    name: 'Gilberta',
    setups: {
      // The ultimate on a clean enemy (no Vulnerability): its Arts Susceptibility is the base.
      ult: { script: [{ input: 'ultimate', wait: 8 }] },
      P3: { potential: 3 },
      P4: { potential: 4 },
      P5: { potential: 5 },
    },
    rules: [
      ...r.chain(4),
      // Her Final Strike's three projectile hits each return a share of atb 16 (5.3344 each: × 3 = 16.0032).
      ...r.finalStrike().map((x) => ({ ...x, tol: 0.005 })),
      ...elements(),
      r.spCost(),
      // Gravity pull: the channel's ticks (atk_scale_pull 0.55 each, display_atk_scale_pull 2.19); then the implosion.
      r.mult('battle', 'Gravity Pull DMG Multiplier', { pick: ownThen(allButLast) }),
      r.mult('battle', 'Explosion DMG Multiplier', { pick: ownThen(last) }),
      r.stagger('battle', 'Explosion Stagger'),
      r.inflicts('battle', 1, `${WIKI} Battle Skill description: "implodes to deal Nature DMG and Nature Infliction"`),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone × Messenger’s Song)',
        source: `${TEAM_USP_SOURCE}; combat/ops talents talent_1_2 add`,
        data: (d) => TEAM_USP(d) * (1 + SONG(d)),
      }),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier', { pick: own }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill/ }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain', {
        what: 'Combo Skill Ultimate Energy (× Messenger’s Song)',
        source: `${WIKI} Combo Skill "Ultimate Energy Gain"; combat/ops talents talent_1_2 add`,
        data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') * (1 + SONG(d)),
      }),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'DMG Multiplier', { pick: own }),
      r.stagger('ultimate', 'Stagger'),
      r.inflicts('ultimate', 1, `${WIKI} Ultimate description: "applies Nature Infliction"`, { setup: 'ult' }),
      {
        what: 'Ultimate "Base Arts Susceptibility" (no Vulnerability)',
        source: `${WIKI} Ultimate "Base Arts Susceptibility"`,
        setup: 'ult',
        ranks: [1, 12],
        sim: (p) => vulnOf(p.w.enemy, /Spell/),
        data: (d, rank) => d.value('Ultimate', 'Base Arts Susceptibility', rank),
      },
      // The field's buff never ends of itself: it lasts while her ultimate's entity (5 s) keeps its aura up.
      {
        ...r.buff('ultimate', /aglina_ultimate_skill$/, 'enemy', 'Field Duration (s)'),
        sim: (p) => {
          const b = p.buffOf(p.nth('ultimate'), /aglina_ultimate_skill$/, 'enemy');
          return b ? (b.lasted ?? b.frames) / FPS : 'none';
        },
        tol: 0.1,
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Potentials. P1 (radius) and P2 (Vulnerability stacks, needs more) not expressible here.
      r.energy('combo', 'Ultimate Energy Gain', {
        setup: 'P3',
        what: 'Combo Skill Ultimate Energy at P3 (Messenger’s Song +5%)',
        source: `${WIKI} Combo Skill "Ultimate Energy Gain"; talents talent_1_2 add, potential_3 skillBbModifier; Potential 3 text`,
        data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') * (1 + SONG(d) + d.potential(3)[0]),
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.cooldown('combo', {
        setup: 'P5',
        ranks: [12],
        adjust: (d) => d.potential(5)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 5 text',
      }),
      r.mult('combo', 'DMG Multiplier', { setup: 'P5', ranks: [12], pick: own, factor: (d) => d.potential(5)[1] }),
    ],
  };

  // ---------------------------------------------------------------------------

  const SNOWSHINE: OperatorRules = {
    id: 'chr_0014_aurora',
    name: 'Snowshine',
    setups: {
      team: { team: ['chr_0032_lizhiyan'] },
      P3: { potential: 3 },
    },
    rules: [
      ...r.chain(3),
      ...r.finalStrike(),
      ...elements(),
      spCostReturned(),
      r.spReturn('battle', 'SP Return'),
      // Her battle skill creates buff_common_obtain_ultimate_sp with ratio 0.5.
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone × her ratio)',
        source: `${TEAM_USP_SOURCE}; combat/ops skills normal_skill CreateBuffAction assignItems ratio`,
        data: (d) => TEAM_USP(d) * uspRatio(d, 'normal_skill'),
      }),
      r.energy('battle', 'SP Cost', {
        setup: 'team',
        who: 'chr_0032_lizhiyan',
        what: 'Battle Skill Ultimate Energy for a teammate (usp_everyone × her ratio)',
        source: `${TEAM_USP_SOURCE}; combat/ops skills normal_skill CreateBuffAction assignItems ratio`,
        data: (d) => TEAM_USP(d) * uspRatio(d, 'normal_skill'),
      }),
      r.free('battle'),
      // The retaliation (DMG, Stagger, Cryo, P5's SP) needs an enemy that attacks: not in the harness.
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.free('combo'),
      r.mult('ultimate', 'Explosion DMG Multiplier', { skill: /ultimate_skill$/ }),
      r.mult('ultimate', 'DMG Over Time Multiplier', {
        skill: /ultimate_skill_dmg/,
        per: (p) => p.hitsOf(p.nth('ultimate'), /ultimate_skill_dmg/).length,
        what: 'Ultimate "DMG Over Time Multiplier" per tick',
      }),
      {
        what: 'Ultimate Snow Zone ticks ("Duration (s)" / "DMG Over Time Interval (s)")',
        source: `${WIKI} Ultimate "Duration (s)", "DMG Over Time Interval (s)"`,
        sim: (p) => p.hitsOf(p.nth('ultimate'), /ultimate_skill_dmg/).length,
        data: (d) => d.value('Ultimate', 'Duration (s)') / d.value('Ultimate', 'DMG Over Time Interval (s)'),
      },
      {
        what: 'Ultimate "DMG Over Time Interval (s)"',
        source: `${WIKI} Ultimate "DMG Over Time Interval (s)"`,
        sim: (p) => {
          const f = p.hitsOf(p.nth('ultimate'), /ultimate_skill_dmg/).map((h) => h.frame);
          return (f[1] - f[0]) / 30;
        },
        data: (d) => d.value('Ultimate', 'DMG Over Time Interval (s)'),
      },
      r.buff('ultimate', /aurora_ultimate_skill_dmg$/, 'enemy', 'Duration (s)'),
      staggerAt('ultimate', 'Stagger', 'Ultimate'),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Potentials: P1 (no Infliction on the team), P2 (radius), P4 (attributes), P5 (retaliation) not expressible.
      {
        what: 'Ultimate Solidification at P3 (+2 s)',
        source: `${WIKI} Potential 3 text`,
        setup: 'P3',
        sim: (p, base) => {
          const f = (x: Probe) => x.buffs.find((b) => b.press === x.nth('ultimate') && b.id === 'buff_common_frozen')?.frames ?? NaN;
          return (f(p) - f(base)) / 30;
        },
        data: (d) => d.potential(3)[0],
      },
    ],
  };

  // ---------------------------------------------------------------------------

  /** The Final Strike's SP and Stagger, from the last step pressed (Lifeng's chain is attack1-3 and attack5). */
  const finalStrikeOfLast = (): Rule[] => [
    {
      what: 'Final Strike SP',
      source: 'combat/ops patch <the last step’s skill> values.atb',
      sim: (p) => p.sum(p.sp, p.nth('attack', p.chain - 1)),
      data: (d, _r, p) => d.patch(p.presses[p.nth('attack', p.chain - 1)].skill).values.atb,
    },
    r.finalStrike()[1],
  ];
  const LIFENG: OperatorRules = {
    id: 'chr_0015_lifeng',
    name: 'Lifeng',
    setups: {
      // The ultimate with no Link (no combo before it).
      noLink: {
        script: [
          { input: 'battle', wait: 6 },
          { input: 'ultimate', wait: 8 },
        ],
      },
      P1: { potential: 1 },
      P4: { potential: 4 },
      // P5's buff ticks 15 s after it starts (waitFirstTriggerInterval), readying the next Subduer of Evil hit.
      P5: {
        potential: 5,
        script: [
          { input: 'battle', wait: 16 },
          { input: 'ultimate', wait: 8 },
        ],
      },
    },
    rules: [
      ...r.chain(4),
      ...finalStrikeOfLast(),
      ...elements(),
      r.spCost(),
      r.mult('battle', 'SEQ 1 DMG Multiplier', { pick: ownThen(nthHit(0)) }),
      r.mult('battle', 'SEQ 2 DMG Multiplier', { pick: ownThen(nthHit(1)) }),
      r.mult('battle', 'SEQ 3 DMG Multiplier', { pick: ownThen(nthHit(2)) }),
      r.stagger('battle', 'SEQ 3 Stagger', { skill: /normal_skill/ }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.buff('battle', /lifeng_purify$/, 'enemy', 'Physical Susceptibility Duration (s)'),
      {
        what: 'Battle Skill "Physical Susceptibility" (no Vulnerability before)',
        source: `${WIKI} Battle Skill "Physical Susceptibility"`,
        ranks: [1, 12],
        sim: (p) => vulnOf(p.w.enemy, /Physical/),
        data: (d, rank) => d.value('Battle Skill', 'Physical Susceptibility', rank),
      },
      r.free('battle'),
      r.mult('combo', 'SEQ 1 DMG Multiplier', { pick: ownThen(nthHit(0)) }),
      r.mult('combo', 'SEQ 2 DMG Multiplier', { pick: ownThen(nthHit(1)) }),
      r.stagger('combo', 'SEQ 2 Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      // The ultimate's own hits (its entity's): Subduer of Evil's hit on each Knock Down is the talent's.
      r.mult('ultimate', 'SEQ 1 DMG Multiplier', { skill: /ultimate_skill/, pick: ownThen(nthHit(0)) }),
      r.mult('ultimate', 'SEQ 2 DMG Multiplier', { skill: /ultimate_skill/, pick: ownThen(nthHit(1)) }),
      r.stagger('ultimate', 'SEQ 1-2 Stagger', {
        setup: 'noLink',
        skill: /abentity/,
        data: (d) => d.value('Ultimate', 'SEQ 1 Stagger') + d.value('Ultimate', 'SEQ 2 Stagger'),
      }),
      // The default script's combo grants a Link (ComboAction) the ultimate consumes: its entity's third hit
      // (ultimate_skill_abentity frame 121, atk_scale3) runs when EntityBB_isCombo is 1, which the game's code sets.
      ...finding(
        r.mult('ultimate', 'Additional ATK DMG Multiplier', {
          skill: /ultimate_skill/,
          pick: ownThen(nthHit(2)),
          what: 'Ultimate "Additional ATK DMG Multiplier" when it consumes a Link',
        }),
        'data 6.0 (wiki; patch atk_scale3), sim 0: the engine consumes the Link (its DMG multiplier) but never sets EntityBB_isCombo, so ultimate_skill_abentity skips its third hit. Left open (2026-10-29): her passive sets isCombo when buff_common_affixes_skillimbue_atk is added, the game’s Link buff (its damageModifier is the Link’s bonus, imbue_scale set by the game’s code); the engine gives the Link’s bonus itself from the wiki (`linked`), so this needs Link rebuilt on that buff. Data right.',
        [1, 12],
      ),
      // Subduer of Evil (talent_2_2: atk_scale_talent2 1): each Knock Down applied deals 100% ATK (OnBeforeOutputKnockDown).
      {
        what: 'Talent Subduer of Evil: 100% ATK per Knock Down (the ultimate’s two)',
        source: 'combat/ops talents talent_2_2 atk_scale_talent2; skills ultimate_skill_abentity KnockDownAction',
        sim: (p) => p.scaleOf(p.nth('ultimate'), /talent/),
        data: (d) => actions(d.skill('ultimate_skill_abentity'), 'KnockDownAction').length * talentValue(d, 'talent_2_2', 'atk_scale_talent2'),
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      {
        what: 'P5: after 15 s, the next Subduer of Evil hit deals 250% more (the ultimate’s first Knock Down)',
        source: 'wiki/operators.json Potential 5 text; combat/ops talents potential_5 atk_scale_potential5, talent_2_2 atk_scale_talent2',
        setup: 'P5',
        sim: (p) => Math.max(0, ...p.hitsOf(p.nth('ultimate'), /talent/).map((h) => h.scale)),
        data: (d) => talentValue(d, 'talent_2_2', 'atk_scale_talent2') + talentValue(d, 'potential_5', 'atk_scale_potential5'),
      },
      // Potentials: P2, P3 attributes/ATK per attribute; P5 rides on the talent above.
      {
        what: 'Battle Skill "Physical Susceptibility" at P1 (+5%)',
        source: `${WIKI} Battle Skill "Physical Susceptibility", Potential 1 text`,
        setup: 'P1',
        sim: (p) => vulnOf(p.w.enemy, /Physical/),
        data: (d) => d.value('Battle Skill', 'Physical Susceptibility') + d.potential(1)[0],
      },
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  // ---------------------------------------------------------------------------

  /** Four Melting Flame stacks (buff_chr_0016_laevat_energy) before a press. */
  const flames = (n: number) => (p: Probe) => {
    for (let i = 0; i < n; i++) (p.w as any).addBuff(p.op, 'buff_chr_0016_laevat_energy', p.op, new Map());
  };
  const LAEVATAIN: OperatorRules = {
    id: 'chr_0016_laevat',
    name: 'Laevatain',
    setups: {
      // Four Melting Flame: the battle skill's additional attack.
      flames: { script: [{ input: 'battle', wait: 6, before: flames(4) }] },
      flamesP1: { potential: 1, script: [{ input: 'battle', wait: 6, before: flames(4) }] },
      // Her ultimate's form: its basic attack chain, then a battle skill during it.
      form: {
        script: [
          { input: 'ultimate', wait: 0.5 },
          { input: 'chain', wait: 1 },
          { input: 'battle', wait: 3 },
        ],
      },
      formP5: {
        potential: 5,
        script: [
          { input: 'ultimate', wait: 0.5 },
          { input: 'chain', wait: 1 },
        ],
      },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      ...elements(),
      r.spCost(),
      r.mult('battle', 'Base Explosion DMG Multiplier', { pick: ownThen(first) }),
      r.mult('battle', 'DMG Over Time Multiplier per SEQ', {
        pick: ownThen((h) => h.slice(1)),
        per: (p) => own(p.hitsOf(p.nth('battle'))).length - 1,
        what: 'Battle Skill "DMG Over Time Multiplier per SEQ" per hit',
      }),
      r.stagger('battle', 'Base Explosion Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      // Without 4 Melting Flame her battle skill jumps (JumpToAction with no condition, frame 37) to its end.
      {
        what: 'Battle Skill: can act again (frames; its unconditional JumpToAction, no Melting Flame)',
        source: 'combat/ops skills normal_skill JumpToAction with no buff condition',
        sim: (p) => p.presses[p.nth('battle')].free ?? NaN,
        data: (d) =>
          Math.min(
            ...actions(d.skill('normal_skill'), 'JumpToAction')
              .filter((a) => !JSON.stringify(a.data).includes('buffId'))
              .map((a) => a.frame),
          ),
      },
      r.mult('battle', 'Additional ATK DMG Multiplier', {
        setup: 'flames',
        skill: /normal_skill$/,
        what: 'Battle Skill on 4 Melting Flame: "Additional ATK DMG Multiplier"',
      }),
      {
        what: 'Battle Skill on 4 Melting Flame: Stagger (base explosion + additional attack)',
        source: `${WIKI} Battle Skill "Base Explosion Stagger", "Additional ATK Stagger"`,
        setup: 'flames',
        sim: (p) => p.sum(p.poise, p.nth('battle'), (e) => /normal_skill/.test(e.skill ?? '')),
        data: (d) => d.value('Battle Skill', 'Base Explosion Stagger') + d.value('Battle Skill', 'Additional ATK Stagger'),
      },
      r.energy('battle', 'Additional ATK Ultimate Energy Gain', {
        setup: 'flames',
        what: 'Battle Skill on 4 Melting Flame: Ultimate Energy (additional attack + usp_everyone)',
        data: (d) => d.value('Battle Skill', 'Additional ATK Ultimate Energy Gain') + TEAM_USP(d),
      }),
      {
        what: 'Battle Skill on 4 Melting Flame: Combustion "Combustion Duration (s)"',
        source: `${WIKI} Battle Skill "Combustion Duration (s)"`,
        setup: 'flames',
        sim: (p) => {
          const b = p.buffs.find((x) => x.press === p.nth('battle') && x.on === 'enemy' && /fire_fire_burning_triggered$/.test(x.id));
          return b ? b.frames / 30 : 'none';
        },
        data: (d) => d.value('Battle Skill', 'Combustion Duration (s)'),
      },
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain when Hitting 1 Enemy'),
      {
        what: 'Combo Skill gives 1 Melting Flame',
        source: `${WIKI} Combo Skill description "gains 1 stack of Melting Flame"`,
        sim: (p) => {
          const b = p.buffs.filter((x) => x.press === p.nth('combo') && /laevat_energy$/.test(x.id));
          const before = p.buffs.filter((x) => x.press < p.nth('combo') && /laevat_energy$/.test(x.id)).at(-1)?.stacks ?? 0;
          return (b.at(-1)?.stacks ?? 0) - before;
        },
        data: () => 1,
      },
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.buff('ultimate', /laevat_ult_end$/, 'self', 'Duration (s)'),
      r.mult('attack', 'Enhanced BATK SEQ 1 Multiplier', { type: 'Ultimate', setup: 'form', k: 0 }),
      r.mult('attack', 'Enhanced BATK SEQ 2 Multiplier', { type: 'Ultimate', setup: 'form', k: 1 }),
      r.mult('attack', 'Enhanced BATK SEQ 3 Multiplier', { type: 'Ultimate', setup: 'form', k: 2 }),
      r.mult('attack', 'Enhanced BATK SEQ 4 Multiplier', { type: 'Ultimate', setup: 'form', k: 3 }),
      {
        what: 'Ultimate: the enhanced chain is 4 steps',
        source: `${WIKI} Ultimate "Enhanced BATK SEQ 1-4 Multiplier"`,
        setup: 'form',
        sim: (p) => p.presses.filter((x) => x.input === 'attack').length,
        data: (d) => d.wiki.skills.find((s) => s.type === 'Ultimate')!.values.filter((v) => /^Enhanced BATK SEQ \d+ Multiplier$/.test(v.label)).length,
      },
      {
        what: 'Ultimate: enhanced BATK SEQ 3 applies Heat Infliction',
        source: `${WIKI} Ultimate description "BATK sequence 3 also applies Heat Infliction"`,
        setup: 'form',
        sim: (p) => p.sum(p.inflictions, p.nth('attack', 2)),
        data: () => 1,
      },
      r.mult('battle', 'During Ultimate: BATK SEQ 1 Multiplier', {
        setup: 'form',
        pick: ownThen(first),
        what: 'Battle Skill during the ultimate: first hit ("During Ultimate: BATK SEQ 1 Multiplier")',
      }),
      r.mult('battle', 'During Ultimate: BATK SEQ 2 Multiplier', {
        setup: 'form',
        pick: ownThen(nthHit(1)),
        what: 'Battle Skill during the ultimate: second hit ("During Ultimate: BATK SEQ 2 Multiplier")',
      }),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Potentials: P2 attributes and Basic Attack DMG; P3 Combustion DMG and duration (P3 setup not built: Combustion's
      // duration row above shows whether it's read); P5's kill extension needs kills.
      r.mult('battle', 'Additional ATK DMG Multiplier', {
        setup: 'flamesP1',
        ranks: [12],
        skill: /normal_skill$/,
        factor: (d) => d.potential(1)[0],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
      {
        ...r.mult('attack', 'Enhanced BATK SEQ 1 Multiplier', { type: 'Ultimate', setup: 'formP5', k: 0, factor: (d) => d.potential(5)[0] }),
        ranks: [12],
      },
    ],
  };

  return [XAIHI, AVYWENNA, GILBERTA, SNOWSHINE, LIFENG, LAEVATAIN];
})();

// ---------------------------------------------------------------------------
// Da Pan, Akekuri, Catcher, Estella, Fluorite, Antal
// ---------------------------------------------------------------------------

const SLICE_C: OperatorRules[] = (() => {
  // Batch 2, slice C: Da Pan, Akekuri, Catcher, Estella, Fluorite, Antal.

  const WIKI = 'wiki/operators.json';
  const BOTH = [1, 12];
  const TYPE: Record<string, string> = {
    attack: 'Basic Attack',
    battle: 'Battle Skill',
    combo: 'Combo Skill',
    ultimate: 'Ultimate',
  };
  /** A skill's own hits (not the Physical Status or Arts reaction it sets off). */
  const own = (h: TraceHit[]) => h.filter((x) => x.kind === 'skill');
  /** The numbers in a talent's text at its last level (wiki talents). */
  const talent = (d: Sources, name: string): number[] => {
    const t = (d.wiki as any).talents.find((x: any) => x.name === name);
    return textNums(t.levels.at(-1).description);
  };
  const talentText = (d: Sources, name: string): string =>
    (d.wiki as any).talents.find((x: any) => x.name === name).levels.at(-1).description;
  /** The ratio a skill assigns to the team's Ultimate Energy buff (its CreateBuffAction's assignItems; 1 if none). */
  const teamRatio = (d: Sources, skill: string): number => {
    const s = JSON.stringify(d.skill(skill));
    const i = s.indexOf('"buffId":"buff_common_obtain_ultimate_sp"');
    const m = s.slice(i, i + 400).match(/"targetKey":"ratio"[^}]*"numericValue":"?([\d.]+)/);
    return m ? Number(m[1]) : 1;
  };
  /** The element a skill's wiki text says it deals (its first ⟦phys|…⟧, ⟦cryo|…⟧… marker), as the data names it. */
  const SAYS: Record<string, string> = { phys: 'Physical', cryo: 'Cryst', heat: 'Fire', elec: 'Pulse', nature: 'Natural' };
  const elementRow = (input: 'attack' | 'battle' | 'combo' | 'ultimate'): Rule => ({
    what: `${TYPE[input]} hits are of the element its text names`,
    source: `${WIKI} ${TYPE[input]} description (its first element marker)`,
    sim: (p) => [...new Set(own(p.hitsOf(input === 'attack' ? 'attack' : p.nth(input))).map((h) => h.type))],
    data: (d) => [SAYS[d.wiki.skills.find((s) => s.type === TYPE[input])!.description.match(/⟦(phys|cryo|heat|elec|nature)\|/)![1]]],
  });
  /** Each input's hits of the element its text names (operators whose basic attack and skills differ). */
  const elements = (inputs: ('attack' | 'battle' | 'combo' | 'ultimate')[] = ['attack', 'battle', 'combo', 'ultimate']): Rule[] =>
    inputs.map(elementRow);
  /**
   * A press's whole cooldown once its skill has done its part (a talent or Potential that cuts it after the press): the
   * cooldown left at the end plus the time since the press (no cut-in after it).
   */
  const cooldownAfter = (p: Probe, input: 'combo' | 'ultimate') => {
    const pr = p.presses[p.nth(input)];
    return ((p.w.readyAt.get(pr.skill) ?? 0) - p.w.clockNow + (p.w.frame - pr.frame)) / FPS;
  };
  /** The elements a press inflicted. */
  const inflicted = (p: Probe, press: number) => p.inflictions.filter((e) => e.press === press).map((e) => e.skill);
  /** A Potential's AddBuff blackboard value (combat/ops talents <id>_potential_<n>). */
  const potentialBb = (d: Sources, n: number, key: string): number =>
    Number(
      d.bundle.talents[`${d.id}_potential_${n}`]
        .find((t: any) => t.modifyType === 'AddBuff')
        .attachBuff.blackboard.find((b: any) => b.key === key).value,
    );

  const DA_PAN: OperatorRules = {
    id: 'chr_0018_dapan',
    name: 'Da Pan',
    setups: {
      // His ultimate gives Prep Ingredients; his combo then hits with it.
      prep: {
        script: [
          { input: 'ultimate', wait: 6 },
          { input: 'combo', wait: 6 },
        ],
      },
      P2: { potential: 2 },
      ...potentials(4, 5),
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      // Two hits: atk_scale_pre 0.41 + atk_scale 2.59 (display_atk_scale 3).
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      // The Crush it forces is a Physical Status hit of its own.
      r.mult('combo', 'DMG Multiplier', { pick: own }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill/ }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      // A 6-sequence flurry (atk_scale_loop each), then the slam (atk_scale_end).
      {
        what: 'Ultimate flurry hits (its text: "6-sequence")',
        source: `${WIKI} Ultimate description`,
        sim: (p) => allButLast(own(p.hitsOf(p.nth('ultimate')))).length,
        data: (d) => Number(d.wiki.skills.find((s) => s.type === 'Ultimate')!.description.match(/(\d+)-sequence/)![1]),
      },
      r.mult('ultimate', 'Aerial Flurry DMG Multiplier', {
        pick: (h) => allButLast(own(h)),
        per: (p) => allButLast(own(p.hitsOf(p.nth('ultimate')))).length,
        what: 'Ultimate "Aerial Flurry DMG Multiplier" per hit',
      }),
      r.mult('ultimate', 'Ultimate DMG Multiplier', { pick: (h) => last(own(h)) }),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Talent Salty or Mild: the slam gives Prep Ingredients for 20 s; a combo hit with it cuts the combo's cooldown 40%.
      r.buff('ultimate', /talent_1_preparation$/, 'self', 'Prep Ingredients', {
        what: 'Talent Salty or Mild: Prep Ingredients on the ultimate (s)',
        source: `${WIKI} talents "Salty or Mild" text`,
        data: (d) => Number(talentText(d, 'Salty or Mild').match(/for (\d+)s/)![1]),
      }),
      // buff talent_1_cd_reduce: OnOutputDamage, SetSkillCdAtOnce Reduce isPercentage cd_reduce: the cooldown left at the
      // combo's hit, cut by 40% (the game's code says whether "percentage" is of what's left or of the whole: what's left
      // here, which the data's "at once, on the hit" reads as).
      {
        what: 'Talent Salty or Mild: combo with Prep Ingredients, cooldown left at its hit −40% (s)',
        source: `combat/ops patch combo_skill cooldown, buffs talent_1_cd_reduce SetSkillCdAtOnce, ${WIKI} talents "Salty or Mild" ⟦num⟧`,
        setup: 'prep',
        sim: (p) => cooldownAfter(p, 'combo'),
        data: (d, _r, p) => {
          const t = own(p.hitsOf(p.nth('combo')))[0].at / FPS;
          return t + (d.patch('combo_skill').cooldown - t) * (1 - talent(d, 'Salty or Mild')[0]);
        },
        tol: 1 / FPS,
      },
      // P1 needs a defeated enemy; P3 is attributes and Physical DMG (stats).
      r.buff('ultimate', /talent_1_preparation$/, 'self', 'Prep Ingredients', {
        setup: 'P2',
        what: 'Prep Ingredients at P2 (s)',
        source: `${WIKI} talents "Salty or Mild" text + Potential 2 text`,
        data: (d) => Number(talentText(d, 'Salty or Mild').match(/for (\d+)s/)![1]) + d.potential(2)[0],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
      {
        what: 'Battle Skill Vulnerability stacks at P5 (one enemy: +1)',
        source: `${WIKI} Potential 5 text (1 stack the Lift gives, 1 more)`,
        setup: 'P5',
        sim: (p) => Math.max(0, ...p.buffs.filter((b) => b.press === p.nth('battle') && /physical_no_guard$/.test(b.id)).map((b) => b.stacks)),
        data: () => 2,
      },
    ],
  };

  const AKEKURI: OperatorRules = {
    id: 'chr_0019_karin',
    name: 'Akekuri',
    setups: potentials(1, 4),
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      // Her basic attack and combo are Physical, her battle skill Heat (her ultimate deals no damage).
      ...elements(['attack', 'battle', 'combo']),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.inflicts('battle', 1, `${WIKI} Battle Skill description: "applies Heat Infliction"`),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier per SEQ', {
        per: (p) => p.hitsOf(p.nth('combo')).length,
        what: 'Combo Skill "DMG Multiplier per SEQ" (each of 2)',
      }),
      r.stagger('combo', 'Stagger per SEQ', { data: (d) => 2 * d.value('Combo Skill', 'Stagger per SEQ') }),
      // Talent Cheer of Victory: SP Recovery + Intellect × sub_ratio / rate, at most max_ratio (the combo's blackboard).
      {
        what: 'Combo Skill "SP Recovery per SEQ" × 2, with Cheer of Victory (Intellect)',
        source: `${WIKI} Combo Skill "SP Recovery per SEQ"; combat/ops talents talent_1_2 sub_ratio, max_ratio, rate`,
        ranks: BOTH,
        sim: (p) => p.sum(p.sp, p.nth('combo')),
        data: (d, rank, p) => {
          const bb = Object.fromEntries(
            d.bundle.talents[`${d.id}_talent_1_2`].map((t: any) => [t.skillBbModifier.bbKey, Number(t.skillBbModifier.floatValue)]),
          );
          const bonus = Math.min(bb.max_ratio, (p.w.stat(p.op, 'Wisd') * bb.sub_ratio) / bb.rate);
          return 2 * d.value('Combo Skill', 'SP Recovery per SEQ', rank) * (1 + bonus);
        },
        tol: 1e-3,
      },
      r.energy('combo', 'Ultimate Energy Gain'),
      r.cooldown('combo'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      // Three Rallying Flares: atb_1 + atb_2 + atb_3 (atb_display).
      { ...r.spReturn('ultimate', 'SP Recovery'), ranks: BOTH, data: (d, rank) => d.value('Ultimate', 'SP Recovery', rank) },
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      {
        what: 'P1: ATK buff after recovering SP with skills (s)',
        source: 'combat/ops talents potential_1 AddBuff blackboard duration',
        setup: 'P1',
        sim: (p) => {
          const b = p.buffOf(p.nth('combo'), /potential_1_1$/, 'self');
          return b ? b.frames / FPS : 'none';
        },
        data: (d) => potentialBb(d, 1, 'duration'),
      },
      // P2 is attributes; P3's team ATK and P5's Link linger need the Link buff's own end (not checked here).
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  const CATCHER: OperatorRules = {
    id: 'chr_0020_meurs',
    name: 'Catcher',
    setups: {
      team: { team: ['chr_0032_lizhiyan'] },
      ...potentials(3, 4),
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      // His battle skill returns its SP the frame it's cast: the cost is what it took before that.
      {
        what: 'Battle Skill SP cost',
        source: `${WIKI} Battle Skill "SP Cost"`,
        sim: (p) => {
          const i = p.nth('battle');
          return p.presses[i].cost + p.sum(p.sp, i, (e) => e.at === 0);
        },
        data: (d) => d.value('Battle Skill', 'SP Cost'),
      },
      r.spReturn('battle', 'SP Return'),
      // The shield's retaliation bash ("DMG Multiplier", "Stagger") needs an enemy attack: the dummy never attacks.
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone × the ratio his skill assigns)',
        source: `${TEAM_USP_SOURCE} × combat/ops skills normal_skill CreateBuffAction ratio`,
        data: (d) => TEAM_USP(d) * teamRatio(d, 'normal_skill'),
      }),
      r.energy('battle', 'SP Cost', {
        setup: 'team',
        who: 'chr_0032_lizhiyan',
        what: 'Battle Skill Ultimate Energy for a teammate (usp_everyone × ratio)',
        source: `${TEAM_USP_SOURCE} × combat/ops skills normal_skill CreateBuffAction ratio`,
        data: (d) => TEAM_USP(d) * teamRatio(d, 'normal_skill'),
      }),
      // Not attacked, his stance jumps at 45 (JumpToAction, destFrame 255) to its end, past its MarkCanInterrupt (129): free at
      // exclusiveFrame 285, 30 frames after the jump (the engine's jump rule; a recording would still confirm it).
      {
        what: 'Battle Skill: can act again, not attacked (frames)',
        source: 'combat/ops skills normal_skill JumpToAction (45 → destFrame) and exclusiveFrame',
        sim: (p) => p.presses[p.nth('battle')].free ?? NaN,
        data: (d) => {
          const s = d.skill('normal_skill');
          const jump = actions(s, 'JumpToAction')[0];
          return jump.frame + s.exclusiveFrame - Number(jump.data.destFrame);
        },
      },
      r.mult('combo', 'SEQ 1 DMG Multiplier', { pick: first }),
      r.mult('combo', 'SEQ 2 DMG Multiplier', { pick: nthHit(1) }),
      r.stagger('combo', 'Stagger'),
      r.buff('combo', /combo_skill_shield$/, 'self', 'Shield Duration (s)'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('ultimate', 'SEQ 1 DMG Multiplier', { skill: /ultimate_skill$/, pick: first }),
      r.mult('ultimate', 'SEQ 2 DMG Multiplier', { skill: /ultimate_skill$/, pick: nthHit(1) }),
      r.mult('ultimate', 'SEQ 3 DMG Multiplier', { skill: /ultimate_skill$/, pick: nthHit(2) }),
      r.stagger('ultimate', 'SEQ 1-3 Stagger', {
        data: (d) =>
          d.value('Ultimate', 'SEQ 1 Stagger') + d.value('Ultimate', 'SEQ 2 Stagger') + d.value('Ultimate', 'SEQ 3 Stagger'),
      }),
      r.buff('ultimate', /ult_weak$/, 'enemy', 'Weakness Duration (s)'),
      r.kind('ultimate', /ultimate_skill$/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // Talent Comprehensive Mindset: the final hit's shockwaves.
      {
        what: 'Talent Comprehensive Mindset: shockwaves',
        source: `${WIKI} talents "Comprehensive Mindset" text`,
        sim: (p) => p.hitsOf(p.nth('ultimate'), /talent_shockwave/).length,
        data: (d) => Number(talentText(d, 'Comprehensive Mindset').match(/creates (\d+) shockwave/)![1]),
      },
      {
        what: 'Talent Comprehensive Mindset: each shockwave’s multiplier',
        source: `${WIKI} talents "Comprehensive Mindset" text`,
        sim: (p) => p.scaleOf(p.nth('ultimate'), /talent_shockwave/) / p.hitsOf(p.nth('ultimate'), /talent_shockwave/).length,
        data: (d) => Number(talentText(d, 'Comprehensive Mindset').match(/(\d+)% ATK/)![1]) / 100,
      },
      // P1's strike is [300 + DEF×5] flat; P2 attributes; P5 needs the shield hit.
      r.buff('combo', /combo_skill_shield$/, 'self', 'Shield Duration (s)', {
        setup: 'P3',
        what: 'Combo Skill shield at P3 (s)',
        source: `${WIKI} Combo Skill "Shield Duration (s)" + Potential 3 text`,
        data: (d) => d.value('Combo Skill', 'Shield Duration (s)') + d.potential(3)[0],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  // Solidification: Nature, then her battle skill's Cryo. The reaction's buff (buff_common_cryst_cryst_frozen_triggered)
  // is only in the bundles of operators that name it (Yvonne's, Fluorite's): Yvonne rides along.
  const SOLID = [
    { input: 'battle' as const, wait: 2, before: inflictOn('Natural', 1) },
    { input: 'combo' as const, wait: 6 },
  ];
  const ESTELLA: OperatorRules = {
    id: 'chr_0021_whiten',
    name: 'Estella',
    setups: {
      solid: { team: ['chr_0017_yvonne'], script: SOLID },
      soloSolid: { script: SOLID },
      solidP1: { potential: 1, team: ['chr_0017_yvonne'], script: SOLID },
      solidP5: { potential: 5, team: ['chr_0017_yvonne'], script: SOLID },
      ...potentials(2, 3),
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      // Physical basic attack, combo and ultimate; Cryo battle skill.
      ...elements(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.inflicts('battle', 1, `${WIKI} Battle Skill description: "apply Cryo Infliction"`),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier Against Non-Solidified Enemies', { pick: own }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill/ }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      r.mult('combo', 'DMG Multiplier Against Solidified Enemies', { setup: 'solid', skill: /combo_skill$/, pick: own }),
      r.buff('combo', /combo_skill_physical_vulnerable$/, 'enemy', 'Physical Susceptibility Duration', { setup: 'solid' }),
      {
        what: 'Combo Skill "Physical Susceptibility Multiplier" (Solidified)',
        source: `${WIKI} Combo Skill "Physical Susceptibility Multiplier"`,
        setup: 'solid',
        sim: (p) => Math.max(0, ...(p.w.enemy.vulnerable ?? []).filter((v) => v.kind === 'Physical').map((v) => v.rate)),
        data: (d) => d.value('Combo Skill', 'Physical Susceptibility Multiplier'),
      },
      // Every ops bundle carries the reaction buffs the game's code applies (ef-assets combat-bundle.mjs CODE_BUFFS).
      r.mult('combo', 'DMG Multiplier Against Solidified Enemies', {
        setup: 'soloSolid',
        skill: /combo_skill$/,
        pick: own,
        ranks: [12],
        what: 'Combo Skill on Solidified, Estella alone (no Yvonne/Fluorite bundle)',
      }),
      r.mult('ultimate', 'DMG Multiplier'),
      r.stagger('ultimate', 'Stagger'),
      {
        what: 'Ultimate "Stagger" [rank 1]',
        source: `${WIKI} Ultimate "Stagger"`,
        ranks: [1],
        sim: (p) => p.sum(p.poise, p.nth('ultimate')),
        data: (d) => d.value('Ultimate', 'Stagger', 1),
      },
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      r.buff('combo', /combo_skill_physical_vulnerable$/, 'enemy', 'Physical Susceptibility Duration', {
        setup: 'solidP1',
        what: 'Physical Susceptibility at P1 (s)',
        source: `${WIKI} Combo Skill "Physical Susceptibility Duration" + Potential 1 text`,
        data: (d) => d.value('Combo Skill', 'Physical Susceptibility Duration') + d.potential(1)[0],
      }),
      r.ultCost({ setup: 'P2', potential: 2 }),
      // One enemy: the first hit is the only one.
      r.dealt('battle', 'P3', (d) => 1 + d.potential(3)[1], { what: 'Battle Skill DMG Dealt at P3 (first enemy hit, × 1.4)' }),
      r.energy('battle', 'SP Cost', {
        setup: 'solidP5',
        what: 'Battle Skill Ultimate Energy at P5, applying Solidification (+5, +6.5)',
        source: `${WIKI} Potential 5 text + ${TEAM_USP_SOURCE}`,
        data: (d) => d.potential(5)[0] + TEAM_USP(d),
      }),
      // P4 is attributes.
    ],
  };

  const FLUORITE: OperatorRules = {
    id: 'chr_0022_bounda',
    name: 'Fluorite',
    setups: {
      // Two Cryo stacks, and the trigger with them: her combo applies one more of it.
      cryo: {
        script: [
          {
            input: 'combo',
            wait: 3,
            before: (p) => {
              inflictOn('Cryst', 2)(p);
              p.w.triggerCombo(0, { element: 'Cryst', stacks: 2 });
            },
          },
        ],
      },
      // P5: her battle skill's Nature Infliction after her combo cuts its cooldown by 1 s.
      P5: {
        potential: 5,
        script: [
          { input: 'combo', wait: 2 },
          { input: 'battle', wait: 6 },
        ],
      },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier', { pick: own }),
      r.stagger('battle', 'Stagger'),
      r.inflicts('battle', 1, `${WIKI} Battle Skill description: "deals Nature DMG and Nature Infliction"`),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      {
        what: 'Combo Skill on 2 Cryo applies one more Cryo',
        source: `${WIKI} Combo Skill description; combat/ops skills combo_skill SwitchAction on EntityBB_combo_index → SpellInfliction Cryst/Natural`,
        setup: 'cryo',
        sim: (p) => inflicted(p, p.nth('combo')),
        data: () => ['Cryst'],
      },
      r.mult('ultimate', 'SEQ 1 DMG Multiplier', { pick: first }),
      r.mult('ultimate', 'SEQ 2 DMG Multiplier', { pick: nthHit(1) }),
      r.mult('ultimate', 'SEQ 3 DMG Multiplier', { pick: nthHit(2) }),
      r.mult('ultimate', 'SEQ 4 DMG Multiplier', { pick: nthHit(3) }),
      r.stagger('ultimate', 'Stagger'),
      r.kind('ultimate', /ultimate_skill/),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // P1 attributes, P2 a chance, P3 Slow: not checked.
      r.ultCost({ setup: 'P4', potential: 4 }),
      {
        what: 'P5: a Nature Infliction cuts the combo’s cooldown (s)',
        source: `combat/ops patch combo_skill cooldown − ${WIKI} Potential 5 text`,
        setup: 'P5',
        sim: (p) => cooldownAfter(p, 'combo'),
        data: (d) => d.patch('combo_skill').cooldown - d.potential(5)[0],
        tol: 1 / FPS,
      },
    ],
  };

  const ANTAL: OperatorRules = {
    id: 'chr_0023_antal',
    name: 'Antal',
    setups: {
      // Two Cryo stacks and a trigger with them: his combo applies one more.
      cryo: {
        script: [
          { input: 'battle', wait: 2 },
          {
            input: 'combo',
            wait: 3,
            before: (p) => {
              inflictOn('Cryst', 2)(p);
              p.w.triggerCombo(0, { element: 'Cryst', stacks: 2 });
            },
          },
        ],
      },
      P1: { potential: 1 },
      P2: { potential: 2 },
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      // Focus: normal_skill's CreateBuffAction puts buff_normal_skill on its owner (him); its Susceptibility is the enemy's.
      r.buff('battle', /antal_normal_skill$/, '', 'Duration (s)', { what: 'Battle Skill Focus "Duration (s)"' }),
      ...(['Electric', 'Heat'] as const).flatMap((el): Rule[] =>
        finding({
          what: `Battle Skill "${el} Susceptibility" on the enemy`,
          source: `${WIKI} Battle Skill "${el} Susceptibility"`,
          ranks: BOTH,
          sim: (p) =>
            Math.max(0, ...(p.w.enemy.vulnerable ?? []).filter((v) => v.kind === (el === 'Electric' ? 'Pulse' : 'Fire')).map((v) => v.rate)),
          data: (d, rank) => d.value('Battle Skill', `${el} Susceptibility`, rank),
        }, 'data 10% (5% at rank 1), sim 0 (his combo after it hits with susceptibility 1): normal_skill puts buff_normal_skill on its Owner, which creates buff_tageffect (its VulnerableAction) on its Source; the engine resolves both to Antal, so Focus and its Susceptibility never reach the enemy. The game must resolve Owner there to the hit enemy. Left open (2026-10-29): the skill’s CreateBuffAction has buffSource InputTarget (the hit enemy), and the Focus then puts its Susceptibility on its Source; but taking buffSource as the buff’s source makes the enemy the attacker of other buffs made that way (Yvonne’s battle-skill projectile: Skydrummer −199k, Xaihi’s heal), so the data seems to keep a buff’s source (for its targets) apart from its creator (its damage), which the engine has as one: a redesign. Data (wiki) right.', BOTH),
      ),
      r.kind('battle', /normal_skill/),
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier', { pick: own }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill/ }),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.kind('combo', /combo_skill/),
      r.free('combo'),
      {
        what: 'Combo Skill on 2 Cryo applies one more Cryo',
        source: `${WIKI} Combo Skill description; combat/ops skills combo_skill SwitchAction on EntityBB_combo_index → SpellInfliction Fire/Cryst/Pulse/Natural`,
        setup: 'cryo',
        sim: (p) => inflicted(p, p.nth('combo')),
        data: () => ['Cryst'],
      },
      r.buff('ultimate', /utimate_skill$/, 'self', 'Duration (s)'),
      ...(['Electric', 'Heat'] as const).map(
        (el): Rule => ({
          what: `Ultimate "${el} Amp"`,
          source: `${WIKI} Ultimate "${el} Amp"`,
          ranks: BOTH,
          sim: (p) => Math.max(0, ...(p.op.amp ?? []).filter((v) => v.kind === (el === 'Electric' ? 'Pulse' : 'Fire')).map((v) => v.rate)),
          data: (d, rank) => d.value('Ultimate', `${el} Amp`, rank),
        }),
      ),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      {
        what: 'Ultimate "Electric Amp" at P1 (× 1.1)',
        source: `${WIKI} Ultimate "Electric Amp" × Potential 1 text`,
        setup: 'P1',
        sim: (p) => Math.max(0, ...(p.op.amp ?? []).filter((v) => v.kind === 'Pulse').map((v) => v.rate)),
        data: (d) => d.value('Ultimate', 'Electric Amp') * d.potential(1)[0],
      },
      r.ultCost({ setup: 'P2', potential: 2 }),
      // P3 needs a defeated enemy; P4 attributes; P5 needs 20 s of Focus on the target (not in the default script).
    ],
  };

  return [DA_PAN, AKEKURI, CATCHER, ESTELLA, FLUORITE, ANTAL];
})();

// ---------------------------------------------------------------------------
// Alesh, Ardelia, Rossi, Pogranichnik, Mi Fu, Camille, Purrchena
// ---------------------------------------------------------------------------

const SLICE_D: OperatorRules[] = (() => {
  // Batch 2, slice D: Alesh, Ardelia, Rossi, Pogranichnik, Mi Fu, Camille, Purrchena.

  const WIKI = 'wiki/operators.json';
  const BOTH = [1, 12];
  const sec = (f: number) => f / 30;

  /** Vulnerability stacks on the enemy just before a press (the engine's buff_physical_no_guard). */
  const vulOn = (n: number) => (p: Probe) => {
    for (let i = 0; i < n; i++)
      p.w.addBuff(p.w.enemy, 'buff_physical_no_guard', p.op, new Map([['duration', -1], ['skip_handle_cryst_break', 1]]));
  };

  /** The wiki's damage marker in a skill's text → the combat data's damage type. */
  const MARK: Record<string, string> = { phys: 'Physical', cryo: 'Cryst', heat: 'Fire', elec: 'Pulse', nature: 'Natural' };
  /**
   * A press's own hits are of the element its skill's text names (its first damage marker, or the i-th): for operators
   * whose skills deal more than one element.
   */
  const elementOf = (input: 'attack' | 'battle' | 'combo' | 'ultimate', o: { setup?: string; i?: number; skill?: RegExp; k?: number } = {}): Rule => {
    const type = { attack: 'Basic Attack', battle: 'Battle Skill', combo: 'Combo Skill', ultimate: 'Ultimate' }[input];
    return {
      what: `${type} hits are of the element its text names${o.setup ? ` (${o.setup})` : ''}`,
      source: `${WIKI} ${type} description damage marker`,
      setup: o.setup,
      sim: (p) => [
        ...new Set(
          (input === 'attack' ? p.hitsOf('attack', o.skill) : p.hitsOf(p.nth(input, o.k), o.skill))
            .filter((h) => h.kind === 'skill')
            .map((h) => h.type),
        ),
      ],
      data: (d) => {
        const text = d.wiki.skills.find((s) => s.type === type)!.description;
        const m = [...text.matchAll(/⟦(phys|cryo|heat|elec|nature)\|/g)].map((x) => MARK[x[1]]);
        return [m[o.i ?? 0]];
      },
    };
  };

  /**
   * "Can act again" when the skill's timeline jumps (JumpToAction): freeFrame along the jumps the press took (the
   * probe records them), which skip what lies between.
   */
  const freeJumping = (input: 'battle' | 'combo' | 'ultimate', _jumps: number[], note: string): Rule => ({
    ...r.free(input),
    source: `combat/ops skills MarkCanInterrupt, else exclusiveFrame, along JumpToAction ${note}`,
  });

  /**
   * "Can act again" after a JumpToAction past the skill's MarkCanInterrupt: the mark is skipped, so exclusiveFrame
   * holds the controlled operator on the jumped timeline (or a later mark frees them). Before 2026-10-29 the engine
   * freed them at the jump (Last Rite's off-field cast, which still does: no one is held off-field).
   */
  const freeAtJump = (input: 'battle' | 'combo' | 'ultimate', jump: number, note: string): Rule => ({
    ...r.free(input),
    source: `combat/ops skills JumpToAction at ${jump} ${note}, past MarkCanInterrupt: exclusiveFrame on the jumped timeline`,
  });

  /** A value at a rank, as a rule's data (spReturn and others read only rank 12). */
  const at = (type: string, label: string) => (d: Sources, rank: number) => d.value(type, label, rank);

  /** Susceptibility on the enemy now (VulnerableAction effects), by kind. */
  const susceptibility = (p: Probe, kind: string) =>
    Math.max(0, ...(p.w.enemy.vulnerable ?? []).filter((x) => x.kind === kind && x.until > p.w.frame).map((x) => x.rate));

  const ALESH: OperatorRules = {
    id: 'chr_0024_deepfin',
    name: 'Alesh',
    setups: {
      cryo1: { script: [{ input: 'battle', wait: 4, before: inflictOn('Cryst', 1) }] },
      cryo4: { script: [{ input: 'battle', wait: 4, before: inflictOn('Cryst', 4) }] },
      P1: { potential: 1, script: [{ input: 'battle', wait: 4, before: inflictOn('Cryst', 4) }] },
      ...potentials(4),
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      elementOf('attack'),
      elementOf('battle'),
      elementOf('combo'),
      elementOf('ultimate'),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.free('battle'),
      ...[1, 4].map(
        (n): Rule => ({
          what: `Battle Skill SP on ${n} Cryo consumed`,
          source: `${WIKI} Battle Skill "SP Recovery by Consuming ${n} Infliction Stack${n > 1 ? 's' : ''}"`,
          setup: `cryo${n}`,
          ranks: BOTH,
          sim: (p) => p.sum(p.sp, p.nth('battle')),
          data: at('Battle Skill', `SP Recovery by Consuming ${n} Infliction Stack${n > 1 ? 's' : ''}`),
        }),
      ),
      {
        what: 'Battle Skill consumes every Cryo stack',
        source: `${WIKI} Battle Skill description ("consumes all of the target's Cryo Infliction stacks")`,
        setup: 'cryo4',
        sim: (p) => p.w.enemy.bb.get('inflict_Cryst') ?? 0,
        data: () => 0,
      },
      // A Rare Fin is a 10% roll ("Rare Fin Chance"); the sim's roll, unseeded here, gave the plain catch.
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      { ...r.spReturn('combo', 'SP Recovery'), ranks: BOTH, data: at('Combo Skill', 'SP Recovery') },
      // The plain catch jumps 64 → 120 (no Rare Fin).
      freeJumping('combo', [64], '64 → 120 (the plain catch)'),
      r.kind('combo', /combo_skill/),
      r.mult('ultimate', 'Ultimate DMG Multiplier'),
      r.stagger('ultimate', 'Stagger'),
      { ...r.spReturn('ultimate', 'Base SP Recovery'), ranks: BOTH, data: at('Ultimate', 'Base SP Recovery') },
      r.inflicts('ultimate', 1, `${WIKI} Ultimate description: "apply Cryo Infliction"`),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // P1: +10 SP on the battle skill's recovery.
      r.spReturn('battle', 'SP Recovery by Consuming 4 Infliction Stacks', {
        setup: 'P1',
        data: (d) => d.value('Battle Skill', 'SP Recovery by Consuming 4 Infliction Stacks') + d.potential(1)[0],
      }),
      // P2 stats; P3 needs a Rare Fin (a 10% roll); P5 needs a target under 50% HP (the dummy has no HP).
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  /** Ardelia's ultimate: the Dolly hits (one per 0.3 s on one enemy). */
  const dollies = (p: Probe) => p.hitsOf(p.nth('ultimate'), /ultimate_skill_sheep_projhit/);
  const corroded: Step[] = [
    { input: 'combo', wait: 4 },
    { input: 'battle', wait: 4 },
  ];

  const ARDELIA: OperatorRules = {
    id: 'chr_0025_ardelia',
    name: 'Ardelia',
    setups: {
      // Her combo's Corrosion for her battle skill to consume.
      corroded: { script: corroded },
      P1: { potential: 1, script: corroded },
      P3: { potential: 3 },
      P4: { potential: 4 },
      P5: { potential: 5 },
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      // Its dash jumps 25 → 32 once it reaches the target.
      freeJumping('battle', [25], '25 → 32 (the dash reaches the target)'),
      r.buff('battle', /normal_skill_vulnerable$/, 'enemy', 'Susceptibility Duration (s)', { setup: 'corroded' }),
      ...['Physical', 'Spell'].map(
        (kind): Rule => ({
          what: `Battle Skill on Corrosion: ${kind === 'Spell' ? 'Arts' : kind} Susceptibility`,
          source: `${WIKI} Battle Skill "Susceptibility"`,
          setup: 'corroded',
          ranks: BOTH,
          sim: (p) => susceptibility(p, kind),
          data: at('Battle Skill', 'Susceptibility'),
        }),
      ),
      {
        what: 'Battle Skill consumes the Corrosion',
        source: `${WIKI} Battle Skill description ("consume the Corrosion")`,
        setup: 'corroded',
        sim: (p) => p.w.enemy.buffs.some((b) => /natural_corrupt/.test(b.id)),
        data: () => false,
      },
      r.mult('combo', 'DMG Multiplier', { skill: /combo_skill_projhit/ }),
      r.mult('combo', 'Explosion DMG Multiplier', { skill: /combo_skill_bomb/ }),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.buff('combo', /natural_corrupt_do$/, 'enemy', 'Corrode Duration (s)'),
      r.free('combo'),
      r.kind('combo', /combo_skill/),
      r.mult('ultimate', 'DMG Multiplier', {
        skill: /sheep_projhit/,
        per: (p) => dollies(p).length,
        what: 'Ultimate "DMG Multiplier" per Dolly hit',
      }),
      {
        what: 'Ultimate "Stagger" per Dolly hit',
        source: `${WIKI} Ultimate "Stagger"`,
        ranks: BOTH,
        sim: (p) => p.sum(p.poise, p.nth('ultimate')) / dollies(p).length,
        data: at('Ultimate', 'Stagger'),
      },
      {
        what: 'Ultimate: one Dolly hit on an enemy per interval (s)',
        source: `combat/ops patch ultimate_skill values.interval, ${WIKI} Ultimate description ("1 damaging hit every 0.3s")`,
        sim: (p) => {
          const h = dollies(p);
          return Math.min(...h.slice(1).map((x, i) => sec(x.frame - h[i].frame)));
        },
        data: (d) => d.patch('ultimate_skill').values.interval,
        tol: 1 / 30,
      },
      // The channel (ChannelingAction 81–201) jumps to its end at 171 (JumpToAction, potential3_duration < 1): 90 frames,
      // the wiki's 3 s; at most one hit per 0.3 s on the one dummy.
      {
        what: 'Ultimate: Dolly hits on one enemy within "Duration (s)" (duration / interval)',
        source: `${WIKI} Ultimate "Duration (s)", combat/ops patch ultimate_skill values.interval, skills ultimate_skill JumpToAction`,
        sim: (p) => dollies(p).length,
        data: (d) => d.value('Ultimate', 'Duration (s)') / d.patch('ultimate_skill').values.interval,
        tol: 1,
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      freeJumping('ultimate', [171], '171 → 201 (potential3_duration < 1), plus the cut-in'),
      // P1: Susceptibility +8%.
      ...['Physical', 'Spell'].map(
        (kind): Rule => ({
          what: `Battle Skill on Corrosion at P1: ${kind === 'Spell' ? 'Arts' : kind} Susceptibility (+8%)`,
          source: `${WIKI} Battle Skill "Susceptibility", Potential 1 text`,
          setup: 'P1',
          sim: (p) => susceptibility(p, kind),
          data: (d) => d.value('Battle Skill', 'Susceptibility') + d.potential(1)[0],
        }),
      ),
      // P2: healing (a teammate's HP). P3: the channel runs to 201 (+1 s).
      {
        what: 'Ultimate at P3: Dolly hits within "Duration (s)" + 1 s',
        source: `${WIKI} Ultimate "Duration (s)", Potential 3 text, combat/ops patch ultimate_skill values.interval`,
        setup: 'P3',
        sim: (p) => dollies(p).length,
        data: (d) => (d.value('Ultimate', 'Duration (s)') + d.potential(3)[0]) / d.patch('ultimate_skill').values.interval,
        tol: 1,
      },
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.cooldown('combo', {
        setup: 'P5',
        ranks: [12],
        adjust: (d) => d.potential(5)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 5 text',
      }),
      r.mult('combo', 'Explosion DMG Multiplier', {
        skill: /combo_skill_bomb/,
        setup: 'P5',
        ranks: [12],
        factor: (d) => d.potential(5)[1],
      }),
      r.buff('combo', /natural_corrupt_do$/, 'enemy', 'Corrode Duration (s)', {
        setup: 'P5',
        what: 'Combo Skill "Corrode Duration (s)" at P5 (+4 s)',
        data: (d) => d.value('Combo Skill', 'Corrode Duration (s)') + d.potential(5)[2],
      }),
    ],
  };

  const ROSSI: OperatorRules = {
    id: 'chr_0028_wulfa',
    name: 'Rossi',
    setups: {
      // One Vulnerability for her battle skill's Wolven Ambrage; 2 Heat stacks for each combo sequence.
      base: {
        script: SCRIPT.flatMap((s): Step[] =>
          s.input === 'battle'
            ? [{ ...s, before: vulOn(1) }]
            : s.input === 'combo'
              ? [
                  { ...s, wait: 3, before: inflictOn('Fire', 2) },
                  { input: 'combo', wait: 6, before: inflictOn('Fire', 2) },
                ]
              : [s],
        ),
      },
      // Both sequences on 2 Heat, nothing after.
      seq2: {
        script: [
          { input: 'combo', wait: 3, before: inflictOn('Fire', 2) },
          { input: 'combo', wait: 6, before: inflictOn('Fire', 2) },
        ],
      },
      P1: { potential: 1 },
      P4: { potential: 4 },
      P5: { potential: 5 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      elementOf('attack'),
      // Crimson Shadow is Physical, the Wolven Ambrage Heat (the text's 1st and 2nd markers).
      elementOf('battle', { skill: /normal_skill$/ }),
      elementOf('battle', { skill: /normal_skill_projhit/, i: 1 }),
      elementOf('ultimate'),
      r.spCost(),
      r.mult('battle', 'SEQ 1 DMG Multiplier', { skill: /normal_skill$/, pick: (h) => h.filter((x) => x.kind === 'skill') }),
      r.stagger('battle', 'SEQ 1 Stagger', { skill: /normal_skill$/ }),
      r.mult('battle', 'SEQ 2 DMG Multiplier', {
        skill: /normal_skill_projhit/,
        what: 'Battle Skill "SEQ 2 DMG Multiplier" (Wolven Ambrage, on Vulnerability)',
      }),
      r.stagger('battle', 'SEQ 2 Stagger', { skill: /normal_skill_projhit/ }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      // On Vulnerability the dash jumps 37 → 215 for the Wolven Ambrage.
      freeAtJump('battle', 37, '→ 215 (on Vulnerability)'),
      // COMBO SEQUENCE 1 (combo_2_skill): two channel hits and buff_combo_2_damage's ticks.
      ...finding(
        r.mult('combo', 'SEQ 1 DMG Multiplier', { skill: /combo_2/ }),
        'data 1.5 (patch combo_2_skill atk_scale, wiki 150%), sim 2.1 (rank 1: 0.67, sim 0.94): two ChannelingAction hits of 0.525 and buff_combo_2_damage ticking 7 times 0.15 (the damagewait assigns it trigger_times 3); data likely right',
        [1, 12],
      ),
      r.energy('combo', 'SEQ 1 Ultimate Energy Gain'),
      r.cooldown('combo'),
      r.free('combo'),
      r.kind('combo', /combo_2_skill/),
      // COMBO SEQUENCE 2 (combo_3_skill) on 2 Heat stacks: base + 2 × per stack.
      r.mult('combo', 'SEQ 2 DMG Multiplier', {
        k: 1,
        skill: /combo_3_skill/,
        ranks: [12],
        what: 'Combo Skill SEQ 2 on 2 Heat (base + 2 × "Bonus DMG Multiplier per Infliction Stack")',
        factor: (d) =>
          1 +
          (2 * d.value('Combo Skill', 'Bonus DMG Multiplier per Infliction Stack')) /
            d.value('Combo Skill', 'SEQ 2 DMG Multiplier'),
      }),
      {
        what: 'Combo Skill "SEQ 2 Stagger"',
        source: `${WIKI} Combo Skill "SEQ 2 Stagger"`,
        sim: (p) => p.sum(p.poise, p.nth('combo', 1), (e) => /combo_3/.test(e.skill ?? '')),
        data: (d) => d.value('Combo Skill', 'SEQ 2 Stagger'),
      },
      {
        what: 'Combo Skill SEQ 2 "Buff Duration (s)" (Critical Rate)',
        source: `${WIKI} Combo Skill "Buff Duration (s)"`,
        sim: (p) => sec(p.buffOf(p.nth('combo', 1), /combo_criticalrate$/, 'self')?.frames ?? NaN),
        data: (d) => d.value('Combo Skill', 'Buff Duration (s)'),
      },
      {
        what: 'Combo Skill SEQ 2 consumes every Arts Infliction stack',
        source: `${WIKI} Combo Skill description ("consumes all Arts Infliction stacks")`,
        setup: 'seq2',
        sim: (p) => p.w.enemy.bb.get('inflict_Fire') ?? 0,
        data: () => 0,
      },
      r.mult('ultimate', 'Stab Attack Total DMG Multiplier', { pick: (h) => h.slice(0, -2) }),
      r.mult('ultimate', 'SEQ 1 Slash DMG Multiplier', { pick: (h) => h.slice(-2, -1) }),
      r.mult('ultimate', 'SEQ 2 Slash DMG Multiplier', { pick: last }),
      r.stagger('ultimate', 'Stagger'),
      r.inflicts('ultimate', 1, `${WIKI} Ultimate description: "applies Heat Infliction"`),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // P1: battle skill and combo × 1.15.
      r.mult('battle', 'SEQ 1 DMG Multiplier', {
        skill: /normal_skill$/,
        setup: 'P1',
        ranks: [12],
        factor: (d) => d.potential(1)[0],
      }),
      // P2 stats; P3 the talent's Seething Blood (a condition on HP).
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.mult('ultimate', 'SEQ 2 Slash DMG Multiplier', {
        pick: last,
        setup: 'P5',
        ranks: [12],
        factor: (d) => d.potential(5)[0],
      }),
    ],
  };

  /** Pogranichnik's ultimate, then a Breach on 2 Vulnerability five times: each a Physical Status. */
  const oath: Step[] = [
    { input: 'ultimate', wait: 2 },
    ...Array.from({ length: 5 }, (): Step => ({ input: 'battle', wait: 4, before: vulOn(2) })),
  ];

  const POGRANICHNIK: OperatorRules = {
    id: 'chr_0029_pograni',
    name: 'Pogranichnik',
    setups: {
      vul1: { script: [{ input: 'battle', wait: 4, before: vulOn(1) }] },
      vul4: { script: [{ input: 'battle', wait: 4, before: vulOn(4) }] },
      // A Breach consuming 4 Vulnerability, then the combo: three slashes, the third enhanced.
      combo4: {
        script: [
          { input: 'battle', wait: 2, before: vulOn(4) },
          { input: 'combo', wait: 6 },
        ],
      },
      oath: { script: oath },
      ...potentials(4, 5),
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'SEQ 1 DMG Multiplier', { pick: first }),
      r.mult('battle', 'SEQ 2 DMG Multiplier', { pick: nthHit(1) }),
      r.stagger('battle', 'SEQ 1 + SEQ 2 Stagger', {
        data: (d) => d.value('Battle Skill', 'SEQ 1 Stagger') + d.value('Battle Skill', 'SEQ 2 Stagger'),
      }),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.free('battle'),
      ...[1, 4].map(
        (n): Rule => ({
          what: `Battle Skill SP on ${n} Vulnerability consumed`,
          source: `${WIKI} Battle Skill "SP Recovery by Consuming ${n} Vulnerability Stack${n > 1 ? 's' : ''}"`,
          setup: `vul${n}`,
          ranks: BOTH,
          sim: (p) => p.sum(p.sp, p.nth('battle')),
          data: at('Battle Skill', `SP Recovery by Consuming ${n} Vulnerability Stack${n > 1 ? 's' : ''}`),
        }),
      ),
      // The default script's Breach consumes nothing: one slash.
      r.mult('combo', 'SEQ 1 DMG Multiplier'),
      r.stagger('combo', 'SEQ 1 Stagger'),
      { ...r.spReturn('combo', 'SEQ 1 SP Recovery'), ranks: BOTH, data: at('Combo Skill', 'SEQ 1 SP Recovery') },
      r.energy('combo', 'Ultimate Energy Gain'),
      r.cooldown('combo'),
      r.kind('combo', /combo_skill/),
      // One slash: the timeline jumps 0 → 600 (EntityBB_noguard_count ≤ 1), past every MarkCanInterrupt.
      freeAtJump('combo', 0, '→ 600 (one slash)'),
      {
        what: 'Combo Skill after 4 Vulnerability consumed: SEQ 1 + SEQ 2 + Enhanced SEQ 3',
        source: `${WIKI} Combo Skill "SEQ 1/2 DMG Multiplier", "Enhanced SEQ 3 DMG Multiplier", description ("up to 3, based on the Vulnerability stacks consumed")`,
        setup: 'combo4',
        sim: (p) => p.scaleOf(p.nth('combo')),
        data: (d) =>
          d.value('Combo Skill', 'SEQ 1 DMG Multiplier') +
          d.value('Combo Skill', 'SEQ 2 DMG Multiplier') +
          d.value('Combo Skill', 'Enhanced SEQ 3 DMG Multiplier'),
        tol: 0.02,
      },
      {
        what: 'Combo Skill SP after 4 Vulnerability consumed (SEQ 1 + SEQ 2 + Enhanced SEQ 3)',
        source: `${WIKI} Combo Skill "SEQ 1/2 SP Recovery", "Enhanced SEQ 3 SP Recovery"`,
        setup: 'combo4',
        sim: (p) => p.sum(p.sp, p.nth('combo')),
        data: (d) =>
          d.value('Combo Skill', 'SEQ 1 SP Recovery') +
          d.value('Combo Skill', 'SEQ 2 SP Recovery') +
          d.value('Combo Skill', 'Enhanced SEQ 3 SP Recovery'),
      },
      r.mult('ultimate', 'Advance DMG Multiplier'),
      r.stagger('ultimate', 'Advance Stagger'),
      {
        what: 'Ultimate Steel Oath points and "Steel Oath Duration"',
        source: `${WIKI} Ultimate "Steel Oath Duration", description ("5 points of Steel Oath")`,
        sim: (p) => {
          const b = p.buffs.filter((x) => x.press === p.nth('ultimate') && /ultimate_skill_count$/.test(x.id));
          return [Math.max(...b.map((x) => x.stacks)), sec(b[0]?.frames ?? NaN)];
        },
        data: (d) => [
          textNums(d.wiki.skills.find((s) => s.type === 'Ultimate')!.description.replace(/(\d+) points/, '⟦num|$1⟧'))[0],
          d.value('Ultimate', 'Steel Oath Duration'),
        ],
      },
      {
        what: 'Ultimate: 5 Physical Statuses (Breach) spend Steel Oath: 4 Harass + the Decisive Assault',
        source: `${WIKI} Ultimate "Harass DMG Multiplier", "Decisive Assault DMG Multiplier", description`,
        setup: 'oath',
        sim: (p) =>
          p.hits
            .filter((h) => h.press > p.nth('ultimate') && h.operator === p.id && h.kind === 'skill' && !/normal_skill/.test(h.skill))
            .reduce((n, h) => n + h.scale, 0),
        data: (d) => 4 * d.value('Ultimate', 'Harass DMG Multiplier') + d.value('Ultimate', 'Decisive Assault DMG Multiplier'),
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      // P1 needs 2 enemies; P2 stats; P3 the talent's Fervent Morale.
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.cooldown('combo', {
        setup: 'P5',
        ranks: [12],
        adjust: (d) => d.potential(5)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 5 text',
      }),
      r.spReturn('combo', 'SEQ 1 SP Recovery', {
        setup: 'P5',
        data: (d) => d.value('Combo Skill', 'SEQ 1 SP Recovery') * d.potential(5)[1],
      }),
    ],
  };

  /** Mi Fu's three moves: Cloudtrapper, Trail and Mangle on 4 Vulnerability (its Crush), World Splitter. */
  const moves: Step[] = [
    { input: 'battle', wait: 1 },
    { input: 'battle', wait: 3, before: vulOn(4) },
    { input: 'battle', wait: 4 },
  ];

  const MI_FU: OperatorRules = {
    id: 'chr_0031_mifu',
    name: 'Mi Fu',
    setups: {
      moves: { script: moves },
      P1: { potential: 1 },
      P4: { potential: 4 },
      P5: { potential: 5, script: [...moves, { input: 'ultimate', wait: 6 }] },
    },
    rules: [
      ...r.chain(4),
      ...r.finalStrike(),
      r.element(),
      // Cloudtrapper costs 100 and returns 50 as it's cast.
      {
        what: 'Battle Skill Cloudtrapper: SP Cost less the 50 it returns on cast',
        source: `${WIKI} Battle Skill "SP Cost", description ⟦num⟧ (returns 50)`,
        sim: (p) => p.presses[p.nth('battle')].cost,
        data: (d) => d.value('Battle Skill', 'SP Cost') - d.described('Battle Skill', 'num', 1),
      },
      {
        what: 'Battle Skill Trail and Mangle / World Splitter SP cost',
        source: `${WIKI} Battle Skill description ⟦num⟧ (costs 50 each)`,
        setup: 'moves',
        sim: (p) => [p.presses[1].cost, p.presses[2].cost],
        data: (d) => [d.described('Battle Skill', 'num', 2), d.described('Battle Skill', 'num', 3)],
      },
      {
        what: 'Battle Skill: the three moves in order',
        source: 'combat/ops base.skillGroups.normal',
        setup: 'moves',
        sim: (p) => p.presses.map((x) => x.skill),
        data: (d) => d.bundle.base.skillGroups.normal,
      },
      r.mult('battle', 'Cloudtrapper DMG Multiplier'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone, at 50 SP net)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.mult('battle', 'Trail and Mangle DMG Multiplier', {
        setup: 'moves',
        k: 1,
        pick: (h) => h.filter((x) => x.kind === 'skill'),
      }),
      r.stagger('battle', 'Trail and Mangle Stagger', { setup: 'moves', k: 1 }),
      r.stagger('battle', 'World Splitter Stagger', { setup: 'moves', k: 2 }),
      // World Splitter's atk_scale_runtime is atk_scale × yuanshi_multi × crushmulti (its Crush scaling): not the wiki's
      // 600% alone, so only its Stagger and kind are checked.
      {
        what: 'Battle Skill World Splitter hits are not Battle Skill DMG (Crush DMG)',
        source: `${WIKI} Battle Skill description ("this DMG is not treated as Battle Skill DMG, but as Crush DMG")`,
        setup: 'moves',
        sim: (p) => p.hitsOf(2).some((h) => h.skillKind === 'normal'),
        data: () => false,
      },
      // Cloudtrapper's chain catches the target: 7 → 105 (inside an IfElse at 4).
      freeAtJump('battle', 7, '→ 105 (the chain caught a target)'),
      r.mult('combo', 'DMG Multiplier'),
      r.stagger('combo', 'Stagger'),
      r.cooldown('combo'),
      r.energy('combo', 'Ultimate Energy Gain'),
      r.buff('combo', /vulnerablephysic_comboskill$/, 'enemy', 'Physical Susceptibility Duration (s)'),
      {
        what: 'Combo Skill "Physical Susceptibility"',
        source: `${WIKI} Combo Skill "Physical Susceptibility"`,
        sim: (p) => susceptibility(p, 'Physical'),
        data: (d) => d.value('Combo Skill', 'Physical Susceptibility'),
      },
      {
        what: 'Combo Skill: the next battle skill is Trail and Mangle',
        source: `${WIKI} Combo Skill description, combat/ops buffs normalskill_2`,
        sim: (p) => p.buffs.some((b) => b.press === p.nth('combo') && /normalskill_2$/.test(b.id)),
        data: () => true,
      },
      r.free('combo'),
      r.kind('combo', /combo_skill/),
      r.mult('ultimate', 'DMG Multiplier', { pick: (h) => h.filter((x) => x.kind === 'skill') }),
      r.stagger('ultimate', 'Stagger', { skill: /ultimate/ }),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      r.cooldown('combo', {
        setup: 'P1',
        ranks: [12],
        adjust: (d) => d.potential(1)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 1 text',
      }),
      {
        what: 'Combo Skill "Physical Susceptibility" at P1 (+5%)',
        source: `${WIKI} Combo Skill "Physical Susceptibility", Potential 1 text`,
        setup: 'P1',
        sim: (p) => susceptibility(p, 'Physical'),
        data: (d) => d.value('Combo Skill', 'Physical Susceptibility') + d.potential(1)[1],
      },
      r.buff('combo', /vulnerablephysic_comboskill$/, 'enemy', 'Physical Susceptibility Duration (s)', {
        setup: 'P1',
        what: 'Combo Skill "Physical Susceptibility Duration (s)" at P1 (+4 s)',
        data: (d) => d.value('Combo Skill', 'Physical Susceptibility Duration (s)') + d.potential(1)[2],
      }),
      // P2 stats; P3 the talent's shield.
      r.ultCost({ setup: 'P4', potential: 4 }),
      r.mult('battle', 'Cloudtrapper DMG Multiplier', {
        setup: 'P5',
        ranks: [12],
        factor: (d) => d.potential(5)[0],
      }),
      r.mult('battle', 'Trail and Mangle DMG Multiplier', {
        setup: 'P5',
        k: 1,
        ranks: [12],
        pick: (h) => h.filter((x) => x.kind === 'skill'),
        factor: (d) => d.potential(5)[0],
      }),
      {
        what: 'Ultimate Stagger at P5 (+5)',
        source: `${WIKI} Ultimate "Stagger", Potential 5 text`,
        setup: 'P5',
        sim: (p) => p.sum(p.poise, p.nth('ultimate'), (e) => /ultimate/.test(e.skill ?? '')),
        data: (d) => d.value('Ultimate', 'Stagger') + d.potential(5)[1],
      },
    ],
  };

  /** Camille's battle skill's Vesperwings, then her combo on them; her ultimate, then Hunter Pursuit. */
  const bats: Step[] = [
    { input: 'battle', wait: 2 },
    { input: 'combo', wait: 8 },
  ];
  const pursuit: Step[] = [
    { input: 'ultimate', wait: 6 },
    { input: 'battle', wait: 6 },
  ];

  const CAMILLE: OperatorRules = {
    id: 'chr_0033_camille',
    name: 'Camille',
    setups: {
      bats: { script: bats },
      pursuit: { script: pursuit },
      P1: { potential: 1, script: bats },
      P3: { potential: 3 },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(5),
      ...r.finalStrike(),
      r.element(),
      r.spCost(),
      r.mult('battle', 'DMG Multiplier'),
      r.stagger('battle', 'Stagger'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.inflicts('battle', 1, `${WIKI} Battle Skill description: "apply Heat Infliction"`),
      {
        what: 'Battle Skill "Heat Susceptibility" while the Vesperwings hover',
        source: `${WIKI} Battle Skill "Heat Susceptibility"`,
        ranks: BOTH,
        setup: 'bats',
        sim: (p) => susceptibility(p, 'Fire'),
        data: at('Battle Skill', 'Heat Susceptibility'),
      },
      r.free('battle'),
      r.mult('combo', 'DMG Multiplier', { skill: /combo_skill$/ }),
      r.stagger('combo', 'Stagger', { skill: /combo_skill$/ }),
      { ...r.spReturn('combo', 'SP Recovery'), ranks: BOTH, data: at('Combo Skill', 'SP Recovery') },
      r.energy('combo', 'Ultimate Energy Gain'),
      r.cooldown('combo'),
      r.free('combo'),
      r.kind('combo', /combo_skill$/),
      ...finding(
        {
          what: 'Combo Skill on hovering Vesperwings sets off their explosion',
          source: `${WIKI} Battle Skill "Explosion DMG Multiplier" (combat/ops patch normal_skill bat_atk_scale)`,
          setup: 'bats',
          sim: (p) => p.scaleOf(p.nth('combo'), /normal_skill|delay_damage/),
          data: (d) => d.value('Battle Skill', 'Explosion DMG Multiplier'),
        },
        'data 1.0, sim 0: no explosion; it comes from the Vesperwings entity’s passive skill (passive_normal_skill_ability_entity adds buff_normal_skill_delay_damage), which doesn’t run in the sim. Left open (2026-10-29): nothing in the data gives the entity (abilityentity_chr_0033_camille_normal_skill) that passive, only its name does, and it is the only such passive in combat/; data right',
      ),
      r.mult('ultimate', 'DMG Multiplier', { pick: (h) => h.filter((x) => x.kind === 'skill') }),
      r.stagger('ultimate', 'Stagger'),
      { ...r.spReturn('ultimate', 'SP Recovery'), ranks: BOTH, data: at('Ultimate', 'SP Recovery') },
      r.inflicts('ultimate', 1, `${WIKI} Ultimate description: "applies Heat Infliction"`),
      r.buff('ultimate', /ult_henshin_state$/, 'self', 'Hunter Pursuit State Duration (s)'),
      r.ultCost(),
      r.cooldown('ultimate'),
      r.free('ultimate'),
      {
        what: 'Hunter Pursuit: the battle skill during the ultimate’s state',
        source: 'combat/ops buffs ult_henshin_state ChangeSkillAction',
        setup: 'pursuit',
        sim: (p) => p.presses[p.nth('battle')].skill,
        data: (d) => `${d.id}_normal_skill_2`,
      },
      r.mult('battle', 'Hunter Pursuit DMG Multiplier', { type: 'Combo Skill', setup: 'pursuit', ranks: [12] }),
      r.spReturn('battle', 'Hunter Pursuit SP Recovery', {
        setup: 'pursuit',
        data: (d) => d.value('Combo Skill', 'Hunter Pursuit SP Recovery'),
      }),
      {
        what: 'Battle Skill "Heat Susceptibility" at P1 (+5%)',
        source: `${WIKI} Battle Skill "Heat Susceptibility", Potential 1 text`,
        setup: 'P1',
        sim: (p) => susceptibility(p, 'Fire'),
        data: (d) => d.value('Battle Skill', 'Heat Susceptibility') + d.potential(1)[1],
      },
      // P2 stats.
      r.cooldown('combo', {
        setup: 'P3',
        ranks: [12],
        adjust: (d) => d.potential(3)[0],
        source: 'combat/ops patch combo_skill cooldown, Potential 3 text',
      }),
      r.mult('combo', 'DMG Multiplier', {
        skill: /combo_skill$/,
        setup: 'P3',
        ranks: [12],
        factor: (d) => d.potential(3)[1],
      }),
      r.spReturn('combo', 'SP Recovery', {
        setup: 'P3',
        data: (d) => d.value('Combo Skill', 'SP Recovery') * d.potential(3)[2],
      }),
      r.ultCost({ setup: 'P4', potential: 4 }),
      // P5: the talent's Heat DMG per stack (a talent's stacks).
    ],
  };

  /** Purrchena's shield, then (still in its window) the headbutt. */
  const headbutt: Step[] = [
    { input: 'battle', wait: 8 },
    { input: 'battle', wait: 4 },
    { input: 'combo', wait: 6 },
  ];

  const PURRCHENA: OperatorRules = {
    id: 'chr_0038_purrche',
    name: 'Purrchena',
    setups: {
      headbutt: { script: headbutt },
      P4: { potential: 4 },
    },
    rules: [
      ...r.chain(3),
      ...r.finalStrike(),
      elementOf('attack'),
      elementOf('battle', { setup: 'headbutt', k: 1 }),
      elementOf('ultimate'),
      {
        what: 'Battle Skill SP Cost less the "SP Return" on cast',
        source: `${WIKI} Battle Skill "SP Cost", "SP Return"`,
        sim: (p) => p.presses[p.nth('battle')].cost,
        data: (d) => d.value('Battle Skill', 'SP Cost') - d.value('Battle Skill', 'SP Return'),
      },
      r.spReturn('battle', 'SP Return'),
      r.energy('battle', 'SP Cost', {
        what: 'Battle Skill Ultimate Energy (usp_everyone)',
        source: TEAM_USP_SOURCE,
        data: (d) => TEAM_USP(d),
      }),
      r.buff('battle', /aura_block$/, 'self', 'Shield Up Duration (s)'),
      // With nothing to block, she lowers her shield after Shield Up Duration; buff_block_end (2 s) plays her out.
      ...finding(
        {
          what: 'Battle Skill: can act again after "Shield Up Duration (s)" and buff_block_end, nothing blocked (s)',
          source: `${WIKI} Battle Skill "Shield Up Duration (s)", combat/ops buffs block_end duration`,
          sim: (p) => sec(p.presses[p.nth('battle')].free ?? NaN),
          data: (d) =>
            d.value('Battle Skill', 'Shield Up Duration (s)') + Number(d.bundle.buffs[`buff_${d.id}_block_end`].duration.value),
          tol: 0.2,
        },
        'my reading: data 5 s (3 s shield + block_end 2 s), sim 7.4 s (221 frames): the skill is an event-driven loop (CastSkill at 49, listeners to frame 1492) the sim plays as a timeline; check against footage',
      ),
      {
        what: 'Battle Skill becomes LEAVE MY FRIENDS ALONE! after casting',
        source: 'combat/ops buffs block_change_skill, base.skillGroups.normal[1]',
        setup: 'headbutt',
        sim: (p) => p.presses[1].skill,
        data: (d) => d.bundle.base.skillGroups.normal[1],
      },
      r.mult('battle', 'Headbutt DMG Multiplier', { setup: 'headbutt', k: 1 }),
      r.stagger('battle', 'Headbutt Stagger', { setup: 'headbutt', k: 1 }),
      {
        ...r.inflicts('battle', 1, `${WIKI} Battle Skill description: "apply Nature Infliction" (the headbutt)`, {
          setup: 'headbutt',
        }),
        sim: (p) => p.sum(p.inflictions, p.nth('battle', 1)),
      },
      // The Giftbox's item is a roll (Bomb, Handicraft, Yummy Dessert): only what every box does is checked.
      r.energy('combo', 'Ultimate Energy Gain', { setup: 'headbutt' }),
      r.cooldown('combo', { setup: 'headbutt' }),
      r.mult('ultimate', 'Bomb: DMG Multiplier', {
        skill: /bomb_projhit/,
        per: (p) => p.hitsOf(p.nth('ultimate'), /bomb_projhit/).length,
        what: 'Ultimate "Bomb: DMG Multiplier" per Bomb',
      }),
      {
        what: 'Ultimate "Bomb: Stagger" per Bomb',
        source: `${WIKI} Ultimate "Bomb: Stagger"`,
        sim: (p) =>
          p.sum(p.poise, p.nth('ultimate'), (e) => /bomb/.test(e.skill ?? '')) /
          p.hitsOf(p.nth('ultimate'), /bomb_projhit/).length,
        data: (d) => d.value('Ultimate', 'Bomb: Stagger'),
      },
      r.mult('ultimate', 'Handicraft: DMG Multiplier', { skill: /blackhole/, ranks: [12] }),
      {
        what: 'Ultimate: 3 Prezzies (Bombs and Handicraft)',
        source: `${WIKI} Ultimate description ("opens 3 Big Feline's Prezzies")`,
        sim: (p) =>
          p.hitsOf(p.nth('ultimate'), /bomb_projhit/).length +
          // A Handicraft's pull-in dots and its end hit, the biggest: one end hit each.
          ((h) => h.filter((x) => x.scale === Math.max(...h.map((y) => y.scale))).length)(p.hitsOf(p.nth('ultimate'), /abilityrange_blackhole$/)),
        data: () => 3,
      },
      r.ultCost(),
      r.cooldown('ultimate'),
      freeJumping('ultimate', [67], '67 → 135 (0 → 68 with a box held: the same 68 frames), plus the cut-in'),
      // P1 and P5 change Ambassador's Special (a roll); P2 stats; P3 the combo's item.
      r.ultCost({ setup: 'P4', potential: 4 }),
    ],
  };

  return [ALESH, ARDELIA, ROSSI, POGRANICHNIK, MI_FU, CAMILLE, PURRCHENA];
})();

// ---------------------------------------------------------------------------
// batch 1 operators: what batch 1 left out (stack-dependent combos, Electrification and Sunderblades, Yvonne's Additional ATK, talents with conditions)
// ---------------------------------------------------------------------------

const GAPS: OperatorRules[] = (() => {
  /** A combo made ready by an infliction's stacks consumed (what the combo's trigger saw: Si's "highest stacks"). */
  const triggered = (element: string, stacks: number) => (p: Probe) => p.w.triggerCombo(0, { element, stacks });
  /** The numbers in a talent's last level (wiki/operators.json talents, by name). */
  const talent = (d: Sources, name: string): number[] =>
    textNums((d.wiki as any).talents.find((t: { name: string }) => t.name === name).levels.at(-1).description);
  /** A press's damage per ATK with crit taken out (each hit's amount / (ATK × its crit factor)). */
  const dealtNoCrit = (p: Probe, press: number) =>
    p.w.hits
      .filter((h) => h.operator === p.id && h.frame >= p.presses[press].frame && h.frame < (p.presses[press + 1]?.frame ?? Infinity))
      .reduce((n, h) => n + h.amount / ((h.parts?.atk ?? 1) * (h.parts?.crit ?? 1)), 0);
  /** The highest Amp of a kind on the operator now (EnhancedAction). */
  const ampOf = (p: Probe, kind?: string) =>
    Math.max(0, ...(p.op.amp ?? []).filter((x) => !kind || x.kind === kind).map((x) => x.rate));
  /** Frames until an input could be pressed again (kept on the probe by `measure`). */
  const measure = (input: 'combo' | 'battle', key: string) => (p: Probe) => {
    const w = p.w;
    let n = 0;
    while (!w.can(0, input) && n < 60 * FPS) {
      w.tick();
      n++;
    }
    (p as any)[key] = n;
  };

  const SI: OperatorRules = {
    id: 'chr_0036_jsspsi',
    name: 'Si (batch 2: stacks, talents)',
    setups: {
      // Her combo made ready by 3 Cryo stacks consumed.
      stacks3: { script: [{ input: 'combo', wait: 6, before: triggered('Cryst', 3) }] },
      stacks4: { script: [{ input: 'combo', wait: 6, before: triggered('Cryst', 4) }] },
      P5stacks3: { potential: 5, script: [{ input: 'combo', wait: 6, before: triggered('Cryst', 3) }] },
      // Proxy's Patronage: her ultimate takes 20 s off Team Position 01's combo cooldown (alone, hers).
      patronage: {
        script: [
          { input: 'combo', wait: 1 },
          { input: 'ultimate', wait: 2 },
          { input: 'combo', wait: 2 },
        ],
      },
      P3: { potential: 3 },
      P1: { potential: 1 },
    },
    rules: [
      {
        ...r.mult('combo', 'Multiplier Increase per Stack Consumed or Absorbed', {
          setup: 'stacks3',
          what: 'Combo Skill on 3 Cryo stacks consumed (DMG Multiplier + 3 × per stack)',
        }),
        data: (d, rank) =>
          d.value('Combo Skill', 'DMG Multiplier', rank) +
          3 * d.value('Combo Skill', 'Multiplier Increase per Stack Consumed or Absorbed', rank),
      },
      {
        ...r.mult('combo', 'Multiplier Increase per Stack Consumed or Absorbed', {
          setup: 'stacks4',
          ranks: [12],
          what: 'Combo Skill on 4 Cryo stacks consumed (DMG Multiplier + 4 × per stack)',
        }),
        data: (d, rank) =>
          d.value('Combo Skill', 'DMG Multiplier', rank) +
          4 * d.value('Combo Skill', 'Multiplier Increase per Stack Consumed or Absorbed', rank),
      },
      // P5: one more stack counted, then × 1.15.
      {
        ...r.mult('combo', 'Multiplier Increase per Stack Consumed or Absorbed', {
          setup: 'P5stacks3',
          ranks: [12],
          what: 'Combo Skill at P5 on 3 Cryo stacks ((DMG Multiplier + 4 × per stack) × 1.15)',
        }),
        source: 'wiki/operators.json Combo Skill values, Potential 5 text',
        data: (d, rank) =>
          (d.value('Combo Skill', 'DMG Multiplier', rank) +
            4 * d.value('Combo Skill', 'Multiplier Increase per Stack Consumed or Absorbed', rank)) *
          d.potential(5)[1],
      },
      // The stacks change the damage only: Ultimate Energy stays her 10 + the team's usp_everyone.
      r.energy('combo', 'Ultimate Energy Gain', {
        setup: 'stacks4',
        what: 'Combo Skill Ultimate Energy on 4 stacks (unchanged: 10 + usp_everyone)',
        source: `wiki/operators.json Combo Skill "Ultimate Energy Gain" + ${TEAM_USP_SOURCE}`,
        data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') + TEAM_USP(d),
      }),
      r.buff('ultimate', /_ult_effect_1$/, 'self', 'Amp Duration (s)'),
      {
        what: 'Ultimate "Amp" at P3 (× 1.2)',
        source: 'wiki/operators.json Ultimate "Amp", Potential 3 text',
        setup: 'P3',
        sim: (p) => ampOf(p),
        data: (d) => d.value('Ultimate', 'Amp') * d.potential(3)[1],
      },
      r.buff('battle', /normal_skill_hitstop$/, 'enemy', 'Immobilization Duration (s)', {
        what: 'Battle Skill "Immobilization Duration (s)" on the enemy',
      }),
      r.buff('battle', /normal_skill_hitstop$/, 'enemy', 'Immobilization Duration (s)', {
        setup: 'P1',
        what: 'Battle Skill Immobilization at P1 (+50%)',
        source: 'wiki/operators.json Battle Skill "Immobilization Duration (s)", Potential 1 text',
        data: (d) => d.value('Battle Skill', 'Immobilization Duration (s)') * (1 + d.potential(1)[0]),
      }),
      {
        what: 'talent Proxy’s Patronage: her combo is ready again right after her ultimate (cooldown − 20 s)',
        source: 'wiki/operators.json talents "Proxy\'s Patronage", combat/ops patch combo_skill cooldown',
        setup: 'patronage',
        sim: (p) => p.presses[2].ok,
        // 1 s + the ultimate's 2 s since the combo: ready if its cooldown less the talent's 20 s is past.
        data: (d) => d.patch('combo_skill').cooldown - talent(d, "Proxy's Patronage")[0] <= 3,
      },
    ],
  };

  /** Zhuang Fangyi's combo on 2 Electric stacks: it consumes them and forces Electrification for her battle skill. */
  const ZF_ELECTRO = [
    { input: 'combo' as const, wait: 3, before: inflictOn('Pulse', 2) },
    { input: 'battle' as const, wait: 6 },
  ];

  const strikes = (p: Probe, k = 0) => p.hitsOf(p.nth('battle', k), /sword_triggerd|normal_skill_ult_abilityrange/).length;

  const ZHUANG_FANGYI: OperatorRules = {
    id: 'chr_0030_zhuangfy',
    name: 'Zhuang Fangyi (batch 2: Electrification, Sunderblades, form)',
    setups: {
      electro: { script: ZF_ELECTRO },
      // Force of Nature: the Electric Amp right after one battle skill (one Thunder Strike).
      amp: { script: [{ input: 'battle', wait: 1.5 }] },
      P3: { potential: 3, script: ZF_ELECTRO },
      // In her ultimate: the first battle skill (free, 3 Sunderblades), a combo, then how long until the next.
      form: {
        script: [
          { input: 'ultimate', wait: 0.5 },
          { input: 'battle', wait: 4 },
          { input: 'combo', wait: 0 },
          { input: 'attack', wait: 0, before: measure('combo', 'comboReady') },
        ],
      },
    },
    rules: [
      r.energy('combo', 'Additional Ultimate Energy per Infliction Stack', {
        setup: 'electro',
        what: 'Combo Skill Ultimate Energy on 2 Electric stacks (gain + 2 × per stack)',
        data: (d) =>
          d.value('Combo Skill', 'Ultimate Energy Gain') +
          2 * d.value('Combo Skill', 'Additional Ultimate Energy per Infliction Stack'),
      }),
      {
        what: 'Combo Skill on Electric Infliction forces Electrification',
        source: 'wiki/operators.json Combo Skill description ("forcibly apply Electrification")',
        setup: 'electro',
        sim: (p) => p.buffs.some((b) => b.press === p.nth('combo') && /pulse_conduct_triggered_do$/.test(b.id)),
        data: () => true,
      },
      // The combo's Electrification is at the stacks it consumed (combo_skill saves the stack count into the buff it
      // creates): consuming it makes level + 1 Sunderblades.
      {
        what: 'Battle Skill on Electrification II: 3 Sunderblades (Status Level consumed + 1)',
        source: 'wiki/operators.json Battle Skill description, combat/ops skills combo_skill (stacks saved into its buff)',
        setup: 'electro',
        sim: (p) => strikes(p),
        data: () => 2 + 1,
      },
      {
        ...r.mult('battle', 'Bonus DMG Multiplier per Status Level of Electrification Consumed', {
          setup: 'electro',
          what: 'Battle Skill on Electrification II: 2 strikes + the final (× final_rate), each base + 2 × per level',
        }),
        data: (d, rank) =>
          (2 + d.patch('normal_skill', rank).values.final_rate) *
          (d.value('Battle Skill', 'Thunder Strike DMG Multiplier', rank) +
            2 * d.value('Battle Skill', 'Bonus DMG Multiplier per Status Level of Electrification Consumed', rank)),
        tol: 0.02,
      },
      // Held while her three Sunderblades go out (the jump at 16–116 waits for EntityBB_SwordNum 0), then exclusiveFrame.
      {
        ...r.free('battle', { setup: 'electro' }),
        what: 'Battle Skill on Electrification II: can act again (frames), held until its Sunderblades are out',
      },
      r.energy('battle', 'Bonus Ultimate Energy per Thunder Strike', {
        setup: 'electro',
        what: 'Battle Skill Ultimate Energy on Electrification II (3 strikes × 6, + 6.5)',
        data: (d) => 3 * d.value('Battle Skill', 'Bonus Ultimate Energy per Thunder Strike') + TEAM_USP(d),
      }),
      r.spReturn('battle', 'SP returned at P3 after consuming Electrification', {
        setup: 'P3',
        data: (d) => d.potential(3)[0],
      }),
      {
        what: 'talent Force of Nature: Electric Amp after one battle skill (18% + 2% for its one Thunder Strike)',
        source: 'wiki/operators.json talents "Force of Nature"',
        setup: 'amp',
        sim: (p) => ampOf(p, 'Pulse'),
        data: (d) => talent(d, 'Force of Nature')[0] + talent(d, 'Force of Nature')[2],
      },
      r.buff('battle', /_talent1_base$/, 'self', 'Force of Nature duration', {
        source: 'wiki/operators.json talents "Force of Nature"',
        what: 'talent Force of Nature: Electric Amp duration (s)',
        data: (d) => talent(d, 'Force of Nature')[1],
      }),
      // Her ultimate's form.
      {
        what: 'In her ultimate: the first battle skill makes 3 Sunderblades with no Electrification',
        source: 'wiki/operators.json Ultimate description',
        setup: 'form',
        sim: (p) => strikes(p),
        data: () => 3,
      },
      {
        ...r.mult('battle', 'During Ultimate: Thunder Strike DMG Multiplier', {
          setup: 'form',
          what: 'In her ultimate: battle skill, 2 strikes + the final (× final_rate)',
        }),
        data: (d, rank) =>
          (2 + d.patch('normal_skill_ult', rank).values.final_rate) *
          d.value('Battle Skill', 'During Ultimate: Thunder Strike DMG Multiplier', rank),
        tol: 0.02,
      },
      r.mult('combo', 'During Ultimate: DMG Multiplier', { setup: 'form', type: 'Combo Skill' }),
      // ult_skill_free: AtbCostAddition −100 on her first battle skill in the ultimate.
      {
        what: 'In her ultimate: the first battle skill costs no SP',
        source: 'wiki/operators.json Ultimate description; combat/ops buffs ult_skill_free AtbCostAddition −100',
        setup: 'form',
        sim: (p) => p.presses[p.nth('battle')].cost,
        data: () => 0,
      },
      // ult_base: ComboSkillCooldownRecoveryScalar × combo_cd_rate (4): the combo recovers 4 times as fast.
      {
        what: 'In her ultimate: the combo is ready again after a quarter of its cooldown (s)',
        source: 'combat/ops patch ultimate_skill combo_cd_rate, buffs ult_base ComboSkillCooldownRecoveryScalar',
        setup: 'form',
        tol: 0.2,
        sim: (p) => (p as any).comboReady / FPS,
        data: (d, _r, p) =>
          d.patch(p.presses[p.nth('combo')].skill).cooldown / d.patch('ultimate_skill').values.combo_cd_rate,
      },
    ],
  };

  const YVONNE: OperatorRules = {
    id: 'chr_0017_yvonne',
    name: 'Yvonne (batch 2: Additional ATK, talent)',
    setups: {
      // Her ultimate, a battle skill on 2 Cryo stacks in it (Solidification), then its attacks to the closing Final
      // Strike: the enemy is Solidified at the end.
      solid: {
        script: [
          { input: 'ultimate', attacks: 6, wait: 0 },
          { input: 'battle', attacks: 30, wait: 3, before: inflictOn('Cryst', 2) },
        ],
      },
      // Barrage of Technology: after her bomb Solidifies, the next basic attack is a Final Strike, DMG Dealt +50%.
      barrage: {
        script: [
          { input: 'battle', wait: 2, before: inflictOn('Cryst', 2) },
          { input: 'attack', wait: 2 },
        ],
      },
    },
    rules: [
      r.mult('attack', 'Additional ATK DMG Multiplier', {
        type: 'Ultimate',
        setup: 'solid',
        at: (p) => p.pressOf(/ult_attack_end$/),
        what: 'Ultimate closing Final Strike on a Solidified enemy (enhanced + Additional ATK)',
        factor: (d) =>
          1 + d.value('Ultimate', 'Enhanced Final Strike DMG Multiplier') / d.value('Ultimate', 'Additional ATK DMG Multiplier'),
        ranks: [12],
      }),
      {
        what: 'talent Barrage of Technology: the basic attack after Solidification is the Final Strike',
        source: 'wiki/operators.json talents "Barrage of Technology"; combat/ops skills attack5',
        setup: 'barrage',
        sim: (p) => p.presses[p.nth('attack')].skill,
        data: (d) => `${d.id}_attack${d.chain}`,
      },
      // talent_1_valid_up (CreateBuffAttachingSkill on OnBeforeCastSkill of attack5): DamageScaleProcessor dmg_up 0.5.
      {
        what: 'talent Barrage of Technology: that Final Strike’s DMG Dealt (× 1.5; crit aside)',
        source: 'wiki/operators.json talents "Barrage of Technology"; combat/ops buffs talent_1_valid_up dmg_up',
        setup: 'barrage',
        tol: 1e-6,
        sim: (p, base) => dealtNoCrit(p, p.nth('attack')) / dealtNoCrit(base, base.nth('attack', base.chain - 1)),
        data: (d) => 1 + talent(d, 'Barrage of Technology')[0],
      },
    ],
  };

  const LAST_RITE: OperatorRules = {
    id: 'chr_0026_lastrite',
    name: 'Last Rite (batch 2: talent)',
    setups: {
      hypothermia: { script: [{ input: 'combo', wait: 5, before: inflictOn('Cryst', 3) }] },
    },
    rules: [
      {
        what: 'talent Hypothermia: Cryo Susceptibility after her combo consumes 3 stacks (3 × 4%)',
        source: 'wiki/operators.json talents "Hypothermia"',
        setup: 'hypothermia',
        sim: (p) => Math.max(0, ...(p.w.enemy.vulnerable ?? []).filter((x) => x.kind === 'Crystal').map((x) => x.rate)),
        data: (d) => 3 * talent(d, 'Hypothermia')[0],
      },
    ],
  };

  const LIINO: OperatorRules = {
    id: 'chr_0035_liino',
    name: 'Liino (batch 2: talent)',
    setups: {
      boost: {
        script: [
          { input: 'combo', wait: 3 },
          { input: 'battle', wait: 3 },
        ],
      },
    },
    rules: [
      // combo_skill (talent_b) creates global_buff_liino_combo_atb_return (CreateGlobalBuffAction): global buffs aren't in
      // the combat bundle and the engine has no such action.
      ...finding(
        {
          ...r.spReturn('battle', 'Starry Boost', { setup: 'boost', data: (d) => talent(d, 'Starry Boost of 1st Magnitude')[1] }),
          what: 'talent Starry Boost of 1st Magnitude: her battle skill after her combo returns 10 SP',
          source: 'wiki/operators.json talents "Starry Boost of 1st Magnitude"; combat/ops skills combo_skill CreateGlobalBuffAction',
        },
        'data 10 SP, sim 0: combo_skill creates global_buff_liino_combo_atb_return (CreateGlobalBuffAction), which ef-assets doesn’t bundle and the engine doesn’t run. Data right.',
      ),
    ],
  };

  return [SI, ZHUANG_FANGYI, YVONNE, LAST_RITE, LIINO];
})();

runTables([...SLICE_A, ...SLICE_B, ...SLICE_C, ...SLICE_D, ...GAPS], { describe, beforeAll, it, expect });
