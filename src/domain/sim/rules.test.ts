import { beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  Probe,
  rules as r,
  SCRIPT,
  simData,
  Sources,
  type OperatorRules,
  type Rule,
  type Setup,
  type TraceHit,
  type WikiOp,
} from './testkit';

/**
 * Per-operator rule tests: what the engine does with each operator, pinned to the game data (ef-assets wiki/ and
 * combat/), so an engine change can't quietly break an operator nobody replays. Each operator is a table of rules
 * (testkit.ts `rules`): every row names its source; `footage` marks a documented rule the engine takes from the
 * recordings instead of the data. A failure is a finding for the owner, never a reason to change the expectation.
 *
 * To add an operator: a table below (its id, name, setups and rules) and its entry in OPERATORS.
 */

const first = (h: TraceHit[]) => h.slice(0, 1);
const last = (h: TraceHit[]) => h.slice(-1);
const allButLast = (h: TraceHit[]) => h.slice(0, -1);
const nth = (i: number) => (h: TraceHit[]) => h.slice(i, i + 1);
/**
 * What buff_common_obtain_ultimate_sp gives each operator (every battle skill and Si's combo create it): its blackboard's
 * usp_everyone, whatever SP the skill cost (× a ratio its creator may assign: 1 in this batch).
 */
const TEAM_USP = (d: Sources) =>
  Number(
    d.bundle.buffs.buff_common_obtain_ultimate_sp.blackboard.find((x: { key: string }) => x.key === 'usp_everyone')
      .valueDouble,
  );
const TEAM_USP_SOURCE = 'combat/ops buffs.buff_common_obtain_ultimate_sp blackboard usp_everyone';
/** An Arts Infliction on the enemy just before a press (the data's elements: Cryst, Pulse, Natural, Fire). */
const inflict = (element: string, stacks: number) => (p: Probe) => {
  p.w.enemy.bb.set(`inflict_${element}`, stacks);
  p.w.enemy.bb.set(`inflict_until_${element}`, p.w.frame + 600);
};
const potentials = (...ps: number[]): Record<string, Setup> =>
  Object.fromEntries(ps.map((n) => [`P${n}`, { potential: n }]));

const TANGTANG: OperatorRules = {
  id: 'chr_0027_tangtang',
  name: 'Tangtang',
  setups: {
    // A Whirlpool (her combo) for her battle skill to turn into a Waterspout.
    whirlpool: {
      script: [
        { input: 'combo', wait: 2 },
        { input: 'battle', wait: 6 },
      ],
    },
    ...potentials(1, 3, 4, 5),
  },
  rules: [
    // The 3rd attack: atk_scale_1 0.11 per channel tick (ChannelingAction frames 5-13, every 0.06 s: 5 ticks) and 4
    // projectiles of 0.06, display_atk_scale 0.79.
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'Shooting DMG Multiplier', { skill: /_normal_skill$/ }),
    r.stagger('battle', 'Shot Stagger'),
    r.mult('battle', 'DMG Multiplier (1 Waterspout)', {
      skill: /water_projhit/,
    }),
    r.kind('battle', /water_projhit/),
    r.inflicts('battle', 1, 'wiki/operators.json Battle Skill description: "Applies 1 stack of Cryo Infliction"'),
    r.spReturn('battle', 'SP Return per Whirlpool', { setup: 'whirlpool' }),
    r.free('battle'),
    r.mult('combo', 'DMG Multiplier'),
    r.stagger('combo', 'Stagger'),
    r.cooldown('combo'),
    r.energy('combo', 'Ultimate Energy Gain'),
    r.buff('combo', /tangtang_water$/, 'self', 'Whirlpool Duration (s)'),
    r.free('combo'),
    r.mult('ultimate', 'DMG Over Time Total Multiplier', { pick: allButLast }),
    r.mult('ultimate', 'Rogue Wave DMG Multiplier', { pick: last }),
    r.stagger('ultimate', 'Rogue Wave Stagger'),
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    // Potentials.
    r.mult('combo', 'DMG Multiplier', {
      setup: 'P1',
      ranks: [12],
      factor: (d) => d.potential(1)[0],
    }),
    r.cooldown('combo', {
      setup: 'P1',
      ranks: [12],
      adjust: (d) => d.potential(1)[1],
      source: 'combat/ops patch combo_skill cooldown, Potential 1 text',
    }),
    r.mult('battle', 'Shooting DMG Multiplier', {
      skill: /_normal_skill$/,
      setup: 'P3',
      ranks: [12],
      factor: (d) => d.potential(3)[0],
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
    r.mult('ultimate', 'DMG Over Time Total Multiplier', {
      pick: allButLast,
      setup: 'P5',
      ranks: [12],
      factor: (d) => d.potential(5)[0],
    }),
  ],
};

const SI: OperatorRules = {
  id: 'chr_0036_jsspsi',
  name: 'Si',
  setups: {
    // Arcane beside her, to see what her combo gives the team.
    team: { team: ['chr_0032_lizhiyan'] },
    // Her combo before any battle skill (the team's 6.5 doesn't come from a battle skill's cost).
    comboFirst: { script: [{ input: 'combo', wait: 6 }] },
    ...potentials(3, 4, 5),
  },
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'DMG Multiplier', { skill: /normal_skill_abilityrange/ }),
    r.stagger('battle', 'Stagger', { skill: /normal_skill_abilityrange/ }),
    r.buff('battle', /xianjing_inkhurteffect$/, 'enemy', 'Artful Intent Duration (s)'),
    r.free('battle'),
    // With no Arts Infliction consumed: the whole multiplier, ticks and the last hit.
    r.mult('combo', 'DMG Multiplier'),
    r.stagger('combo', 'Stagger'),
    r.cooldown('combo'),
    // Her combo also creates buff_common_obtain_ultimate_sp (combo_skill's CreateBuffAction, ratio 1): usp_everyone to
    // every operator, so the wiki's 10 is hers alone. The footage agrees (shared notes si-combo-energy.md: Last Rite run
    // 1, yG8o5fgjd0o, combo banner video 11.55 s: Si +17.6, Arcane +8.0, Xaihi +6.2 with their gear's ULT Efficiency,
    // Last Rite 0; run 2, j5zUQYi7r48, agrees).
    r.energy('combo', 'Ultimate Energy Gain', {
      what: 'Combo Skill Ultimate Energy for Si (her 10 + the team’s usp_everyone)',
      source: `wiki/operators.json Combo Skill "Ultimate Energy Gain" + ${TEAM_USP_SOURCE} (combo_skill creates it)`,
      data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') + TEAM_USP(d),
    }),
    r.energy('combo', 'Ultimate Energy Gain', {
      setup: 'team',
      who: 'chr_0032_lizhiyan',
      what: 'Combo Skill Ultimate Energy for a teammate (usp_everyone)',
      source: TEAM_USP_SOURCE,
      data: (d) => TEAM_USP(d),
    }),
    r.energy('combo', 'Ultimate Energy Gain', {
      setup: 'comboFirst',
      what: 'Combo Skill Ultimate Energy with no battle skill before it (fixed, not by SP spent)',
      source: `wiki/operators.json Combo Skill "Ultimate Energy Gain" + ${TEAM_USP_SOURCE}`,
      data: (d) => d.value('Combo Skill', 'Ultimate Energy Gain') + TEAM_USP(d),
    }),
    r.free('combo'),
    r.mult('ultimate', 'DMG Multiplier'),
    r.stagger('ultimate', 'Stagger', { skill: /ultimate/ }),
    {
      what: 'Ultimate "Amp" on herself',
      source: 'wiki/operators.json Ultimate "Amp"',
      sim: (p) => Math.max(0, ...(p.op.amp ?? []).map((x) => x.rate)),
      data: (d) => d.value('Ultimate', 'Amp'),
    },
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    r.mult('ultimate', 'DMG Multiplier', {
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
    // P5 also counts one more infliction stack consumed: + one "Multiplier Increase per Stack", then × 1.15.
    r.mult('combo', 'DMG Multiplier', {
      setup: 'P5',
      ranks: [12],
      what: 'Combo Skill "DMG Multiplier" at P5 (one more stack, × DMG)',
      factor: (d) =>
        ((d.value('Combo Skill', 'DMG Multiplier') +
          d.value('Combo Skill', 'Multiplier Increase per Stack Consumed or Absorbed')) *
          d.potential(5)[1]) /
        d.value('Combo Skill', 'DMG Multiplier'),
    }),
  ],
};

const TYPHOEUS: OperatorRules = {
  id: 'chr_0034_typhoea',
  name: 'Typhoeus',
  setups: {
    // Her combo's field lasts past the default wait.
    base: {
      script: SCRIPT.map((s) => (s.input === 'combo' ? { ...s, wait: 8 } : s)),
    },
    ...potentials(3, 5),
    P4: { potential: 4 },
  },
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'Initial Aerial Shot DMG Multiplier', {
      skill: /normal_skill_attack\d_projhit/,
    }),
    r.free('battle'),
    r.mult('combo', '"Huntress\'s Gaze" Hit DMG', {
      skill: /combo_0\d_projhit/,
    }),
    r.mult('combo', 'Area DMG Over Time', { skill: /persistentdamage/ }),
    r.stagger('combo', 'Stagger'),
    r.cooldown('combo'),
    r.energy('combo', 'Ultimate Energy Gain'),
    r.free('combo'),
    r.mult('ultimate', 'Imbued Arrow Explosion DMG', { pick: first }),
    r.stagger('ultimate', 'Imbued Arrow Stagger'),
    r.ultCost(),
    r.cooldown('ultimate', { source: 'combat/ops patch ultimate_skillfloating cooldown' }),
    // ultimate_skillfloating: exclusiveFrame 105 is past the skill's end (durationFrame 92, its last entry at 100), so
    // she's free at 100, when it ends (freeFrame).
    r.free('ultimate'),
    {
      what: 'her ultimate is her UltimateSkill group’s skill (P4 and P5 change only it)',
      source: 'combat/ops base.skillGroups.ultimate (CharGrowthTable skillGroupMap)',
      sim: (p) => p.skillOf('ultimate'),
      data: (d) => d.bundle.base.skillGroups.ultimate[0],
    },
    r.cooldown('combo', {
      setup: 'P3',
      ranks: [12],
      adjust: (d) => d.potential(3)[0],
      source: 'combat/ops patch combo_skill cooldown, Potential 3 text',
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
    // P5 on the ultimate: DMG Dealt × 1.2 (potential_damge_up) and one more Hunting Arrow (arrow_num_given + 1).
    r.dealt('ultimate', 'P5', (d) => d.potential(5)[1], { pick: first, what: 'Ultimate DMG Dealt at P5 (× 1.2)' }),
    {
      what: 'Ultimate Hunting Arrows given at P5 (+1)',
      source: 'combat/ops patch ultimate_skillfloating values.arrow_num_given, Potential 5 text',
      setup: 'P5',
      sim: (p) => p.buffs.filter((b) => b.press === p.nth('ultimate') && /normal_skill_arrow_num$/.test(b.id)).length,
      data: (d) => d.patch('ultimate_skillfloating').values.arrow_num_given + d.potential(5)[0],
    },
    {
      what: 'Ultimate Hunting Arrows given at P0',
      source: 'combat/ops patch ultimate_skillfloating values.arrow_num_given',
      sim: (p) => p.buffs.filter((b) => b.press === p.nth('ultimate') && /normal_skill_arrow_num$/.test(b.id)).length,
      data: (d) => d.patch('ultimate_skillfloating').values.arrow_num_given,
    },
  ],
};

const LAST_RITE: OperatorRules = {
  id: 'chr_0026_lastrite',
  name: 'Last Rite',
  setups: {
    // Four Cryo stacks for her combo to consume.
    base: {
      script: SCRIPT.map((s) => (s.input === 'combo' ? { ...s, before: inflict('Cryst', 4) } : s)),
    },
    // Her Perfusion, then a chain: the Final Strike sets off a Mirage.
    mirage: {
      script: [
        { input: 'battle', wait: 1 },
        { input: 'chain', wait: 3 },
      ],
    },
    P3: {
      potential: 3,
      script: SCRIPT.map((s) => (s.input === 'combo' ? { ...s, before: inflict('Cryst', 4) } : s)),
    },
    P4: { potential: 4 },
    P5: {
      potential: 5,
      script: [
        { input: 'battle', wait: 1 },
        { input: 'chain', wait: 3 },
      ],
    },
  },
  rules: [
    ...r.chain(4),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.spReturn('battle', 'SP Return'),
    r.energy('battle', 'Ultimate Energy Gain', {
      data: (d) => d.value('Battle Skill', 'Ultimate Energy Gain') + TEAM_USP(d),
      what: 'Battle Skill "Ultimate Energy Gain" (+6.5 every battle skill gives)',
    }),
    r.buff('battle', /lastrite_normal_skill$/, 'self', 'Duration (s)'),
    r.free('battle'),
    r.mult('attack', 'Mirage Additional ATK DMG Multiplier', {
      type: 'Battle Skill',
      setup: 'mirage',
      k: 3,
      skill: /phantom/,
    }),
    r.mult('combo', 'Ice Shard DMG Multiplier', { pick: first }),
    // The slash and its bonus land together: base + 4 Cryo × per stack.
    r.mult('combo', 'Slash Base DMG Multiplier', {
      pick: (h) => h.slice(1),
      what: 'Combo Skill slash on 4 Cryo (base + 4 × "Bonus DMG Multiplier per Infliction Stack")',
      factor: (d) =>
        1 +
        (4 * d.value('Combo Skill', 'Bonus DMG Multiplier per Infliction Stack')) /
          d.value('Combo Skill', 'Slash Base DMG Multiplier'),
      ranks: [12],
    }),
    r.stagger('combo', 'Slash Stagger'),
    r.energy('combo', 'Base Ultimate Energy Gain', {
      data: (d) =>
        d.value('Combo Skill', 'Base Ultimate Energy Gain') +
        4 * d.value('Combo Skill', 'Additional Ultimate Energy Gain per Infliction Stack'),
      what: 'Combo Skill Ultimate Energy (base + 4 Cryo × per stack)',
    }),
    r.cooldown('combo'),
    r.free('combo'),
    r.mult('ultimate', 'SEQ 1 DMG Multiplier', { pick: first }),
    r.mult('ultimate', 'SEQ 2 DMG Multiplier', { pick: nth(1) }),
    r.mult('ultimate', 'SEQ 3 DMG Multiplier', { pick: nth(2) }),
    r.stagger('ultimate', 'SEQ 1-3 Stagger', {
      data: (d) =>
        d.value('Ultimate', 'SEQ 1 Stagger') +
        d.value('Ultimate', 'SEQ 2 Stagger') +
        d.value('Ultimate', 'SEQ 3 Stagger'),
    }),
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    r.mult('combo', 'Ice Shard DMG Multiplier', {
      pick: first,
      setup: 'P3',
      ranks: [12],
      factor: (d) => d.potential(3)[0],
    }),
    r.mult('ultimate', 'SEQ 3 DMG Multiplier', {
      pick: nth(2),
      setup: 'P3',
      ranks: [12],
      factor: (d) => d.potential(3)[0],
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
    r.spReturn('battle', 'SP Return', {
      setup: 'P5',
      data: (d) => d.value('Battle Skill', 'SP Return') + d.potential(5)[0],
    }),
    r.mult('attack', 'Mirage Additional ATK DMG Multiplier', {
      type: 'Battle Skill',
      setup: 'P5',
      ranks: [12],
      k: 3,
      skill: /phantom/,
      factor: (d) => d.potential(5)[1],
    }),
  ],
};

const YVONNE: OperatorRules = {
  id: 'chr_0017_yvonne',
  name: 'Yvonne',
  setups: {
    // Two Cryo stacks for her bomb to freeze with.
    cryo: {
      script: [{ input: 'battle', wait: 4, before: inflict('Cryst', 2) }],
    },
    // Her ultimate's form: its basic attacks, then the closing Final Strike.
    form: { script: [{ input: 'ultimate', attacks: 30, wait: 3 }] },
    // Her ultimate at rank 1, everything else at 12: the form's attacks are the ultimate's values.
    formUlt1: {
      ranks: { ultimate: 1 },
      script: [{ input: 'ultimate', attacks: 30, wait: 3 }],
    },
    P1: { potential: 1 },
    P4: { potential: 4, script: [{ input: 'battle', wait: 4 }] },
  },
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'Base DMG Multiplier'),
    r.stagger('battle', 'Stagger'),
    r.mult('battle', 'Bonus DMG Multiplier per Infliction Stack', {
      setup: 'cryo',
      what: 'Battle Skill on 2 Cryo: base + 2 × per stack + Solidification',
      factor: (d) =>
        (d.value('Battle Skill', 'Base DMG Multiplier') +
          2 * d.value('Battle Skill', 'Bonus DMG Multiplier per Infliction Stack') +
          d.value('Battle Skill', 'DMG Multiplier of Solidification Applied')) /
        d.value('Battle Skill', 'Bonus DMG Multiplier per Infliction Stack'),
      ranks: [12],
    }),
    r.energy('battle', 'Additional Ultimate Energy Gain per Infliction Stack', {
      setup: 'cryo',
      what: 'Battle Skill Ultimate Energy on 2 Cryo (Solidification + 2 × per stack, +6.5)',
      data: (d) =>
        d.value('Battle Skill', 'Ultimate Energy from Solidification Applied') +
        2 * d.value('Battle Skill', 'Additional Ultimate Energy Gain per Infliction Stack') +
        TEAM_USP(d),
    }),
    r.free('battle'),
    r.mult('combo', 'Energy DMG Multiplier', {
      skill: /yvonne_combo_skill$/,
      per: (p) => p.hitsOf(p.nth('combo'), /yvonne_combo_skill$/).length,
    }),
    {
      what: 'Combo Skill "Number of Energy Releases"',
      source: 'wiki/operators.json Combo Skill "Number of Energy Releases"',
      sim: (p) => p.hitsOf(p.nth('combo'), /yvonne_combo_skill$/).length,
      data: (d) => d.value('Combo Skill', 'Number of Energy Releases'),
    },
    r.mult('combo', 'Explosion DMG Multiplier', {
      skill: /combo_skill_finish/,
    }),
    r.stagger('combo', 'Explosion Stagger'),
    r.energy('combo', 'Ultimate Energy Gain', {
      what: 'Combo Skill Ultimate Energy (gain + additional)',
      data: (d) =>
        d.value('Combo Skill', 'Ultimate Energy Gain') + d.value('Combo Skill', 'Additional Ultimate Energy Gain'),
    }),
    r.cooldown('combo'),
    r.free('combo'),
    r.buff('ultimate', /yvonne_ultimate_skill$/, 'self', 'Duration (s)', {
      setup: 'form',
    }),
    r.mult('attack', 'BATK DMG Multiplier', {
      type: 'Ultimate',
      setup: 'form',
      skill: /ult_attack/,
      pick: first,
    }),
    // The form's attacks (<id>_ult_attack#_#) are in her UltimateSkill group: they level with the ultimate.
    {
      ...r.mult('attack', 'BATK DMG Multiplier', {
        type: 'Ultimate',
        setup: 'formUlt1',
        skill: /ult_attack/,
        pick: first,
        what: 'Ultimate "BATK DMG Multiplier" follows the ultimate’s rank (ultimate 1, basic 12)',
      }),
      ranks: [12],
      data: (d) => d.value('Ultimate', 'BATK DMG Multiplier', 1),
    },
    // ult_attack_end is in her UltimateSkill group too.
    r.mult('attack', 'Enhanced Final Strike DMG Multiplier', {
      type: 'Ultimate',
      setup: 'form',
      at: (p) => p.pressOf(/ult_attack_end$/),
    }),
    {
      what: 'Ultimate "Enhanced Final Strike Stagger" (form)',
      source: 'wiki/operators.json Ultimate "Enhanced Final Strike Stagger"',
      setup: 'form',
      sim: (p) => p.sum(p.poise, p.pressOf(/ult_attack_end$/)),
      data: (d) => d.value('Ultimate', 'Enhanced Final Strike Stagger'),
    },
    r.ultCost(),
    r.cooldown('ultimate'),
    {
      what: 'Combo Skill "Number of Energy Releases" at P1',
      source: 'wiki/operators.json Combo Skill "Number of Energy Releases", Potential 1 text',
      setup: 'P1',
      sim: (p) => p.hitsOf(p.nth('combo'), /yvonne_combo_skill$/).length,
      data: (d) => d.value('Combo Skill', 'Number of Energy Releases') + d.potential(1)[1],
    },
    r.energy('combo', 'Ultimate Energy Gain', {
      setup: 'P1',
      what: 'Combo Skill Ultimate Energy at P1 (+ the Potential’s)',
      data: (d) =>
        d.value('Combo Skill', 'Ultimate Energy Gain') +
        d.value('Combo Skill', 'Additional Ultimate Energy Gain') +
        d.potential(1)[2],
    }),
    // One enemy: the explosion hits only it.
    r.spReturn('battle', 'SP returned at P4 (one enemy)', {
      setup: 'P4',
      data: (d) => d.potential(4)[0],
    }),
  ],
};

const LIINO: OperatorRules = {
  id: 'chr_0035_liino',
  name: 'Liino',
  setups: {
    // Arcane beside her, to see what her battle skill gives the team.
    team: { team: ['chr_0032_lizhiyan'] },
    ...potentials(3, 4, 5),
  },
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'First ATK Multiplier', {
      skill: /normal_skill_projhit(_02)?$/,
    }),
    r.stagger('battle', 'Stagger'),
    // Her battle skill costs 25 SP and still gives the team the whole usp_everyone (normal_skill creates the buff).
    r.energy('battle', 'SP Cost', {
      what: 'Battle Skill Ultimate Energy (usp_everyone, at 25 SP)',
      source: TEAM_USP_SOURCE,
      data: (d) => TEAM_USP(d),
    }),
    r.energy('battle', 'SP Cost', {
      setup: 'team',
      who: 'chr_0032_lizhiyan',
      what: 'Battle Skill Ultimate Energy for a teammate (usp_everyone)',
      source: TEAM_USP_SOURCE,
      data: (d) => TEAM_USP(d),
    }),
    r.mult('battle', 'Additional ATK DMG Multiplier', {
      skill: /normal_skill_projhit_hit/,
    }),
    r.buff('battle', /normalskill_music_tag/, 'self', 'Vocalist Stance Duration (s)'),
    r.mult('combo', 'DMG Multiplier', { skill: /combo_skill$/ }),
    r.stagger('combo', 'Stagger'),
    r.cooldown('combo'),
    r.energy('combo', 'Ultimate Energy Gain'),
    r.mult('ultimate', 'Stage Pyrotechnics DMG Multiplier', {
      skill: /ultimate_skill_projhit(_l|_r)?$/,
    }),
    r.mult('ultimate', 'Electrifying Extravaganza DMG Multiplier', {
      skill: /projhit_damage_02/,
    }),
    r.stagger('ultimate', 'Electrifying Extravaganza Stagger'),
    // Each beat launches projectile_..._ultskill_soundwave and ..._soundwave_heal (buff ultskill_music_damage), both
    // casting soundwave_projhit; only the first reaches the enemy.
    r.mult('ultimate', 'DMG Multiplier per Beat', {
      skill: /soundwave/,
      per: (p) => new Set(p.hitsOf(p.nth('ultimate'), /soundwave/).map((h) => h.frame)).size,
    }),
    {
      what: 'Ultimate "Beat Interval (s)"',
      source: 'wiki/operators.json Ultimate "Beat Interval (s)"',
      sim: (p) => {
        const f = [...new Set(p.hitsOf(p.nth('ultimate'), /soundwave/).map((h) => h.frame))];
        return (f[1] - f[0]) / 30;
      },
      data: (d) => d.value('Ultimate', 'Beat Interval (s)'),
    },
    r.buff('ultimate', /ultskill_music_tag/, 'self', 'Cosmovoice Stance Duration (s)'),
    r.ultCost(),
    r.cooldown('ultimate'),
    r.mult('combo', 'DMG Multiplier', {
      skill: /combo_skill$/,
      setup: 'P3',
      ranks: [12],
      factor: (d) => d.potential(3)[1],
    }),
    r.cooldown('combo', {
      setup: 'P3',
      ranks: [12],
      adjust: (d) => d.potential(3)[0],
      source: 'combat/ops patch combo_skill cooldown, Potential 3 text',
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
    r.mult('battle', 'First ATK Multiplier', {
      skill: /normal_skill_projhit(_02)?$/,
      setup: 'P5',
      ranks: [12],
      factor: (d) => d.potential(5)[1],
    }),
  ],
};

const ZHUANG_FANGYI: OperatorRules = {
  id: 'chr_0030_zhuangfy',
  name: 'Zhuang Fangyi',
  setups: {
    // Her ultimate's form: its basic attack chain.
    form: {
      script: [
        { input: 'ultimate', wait: 0.5 },
        { input: 'chain', wait: 2 },
      ],
    },
    formUlt1: {
      ranks: { ultimate: 1 },
      script: [
        { input: 'ultimate', wait: 0.5 },
        { input: 'chain', wait: 2 },
      ],
    },
    ...potentials(1, 4),
  },
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    // One Sunderblade (no Electrification): its one Thunder Strike is the final one, 6 times the DMG (the wiki's text,
    // the skill table's final_rate).
    r.mult('battle', 'Thunder Strike DMG Multiplier', {
      what: 'Battle Skill final Thunder Strike (× final_rate)',
      factor: (d) => d.patch('normal_skill').values.final_rate,
    }),
    r.stagger('battle', 'Total Stagger'),
    // The hold: the timeline waits at 16–116 until her Sunderblades are out (EntityBB_SwordNum 0) or its skillEnd
    // marker, then jumps to 116; exclusiveFrame 135 frees her 19 frames on (freeFrame follows the jump).
    r.free('battle'),
    r.energy('battle', 'Bonus Ultimate Energy per Thunder Strike', {
      what: 'Battle Skill Ultimate Energy (one Thunder Strike, +6.5)',
      data: (d) => d.value('Battle Skill', 'Bonus Ultimate Energy per Thunder Strike') + TEAM_USP(d),
    }),
    r.mult('combo', 'DMG Multiplier'),
    r.stagger('combo', 'Stagger'),
    r.cooldown('combo'),
    r.energy('combo', 'Ultimate Energy Gain'),
    r.free('combo'),
    r.buff('ultimate', /zhuangfy_ult_base$/, 'self', 'Duration (s)'),
    r.mult('attack', 'During Ultimate: BATK SEQ 1 Multiplier', {
      type: 'Ultimate',
      setup: 'form',
      k: 0,
    }),
    r.mult('attack', 'During Ultimate: BATK SEQ 2 Multiplier', {
      type: 'Ultimate',
      setup: 'form',
      k: 1,
    }),
    r.mult('attack', 'During Ultimate: BATK SEQ 3 Multiplier', {
      type: 'Ultimate',
      setup: 'form',
      k: 2,
    }),
    // The form's attacks (<id>_attack#_ult) are in her UltimateSkill group: they level with the ultimate.
    {
      ...r.mult('attack', 'During Ultimate: BATK SEQ 1 Multiplier', {
        type: 'Ultimate',
        setup: 'formUlt1',
        k: 0,
        what: 'Ultimate "During Ultimate: BATK SEQ 1" follows the ultimate’s rank (ultimate 1, basic 12)',
      }),
      ranks: [12],
      data: (d) => d.value('Ultimate', 'During Ultimate: BATK SEQ 1 Multiplier', 1),
    },
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    // P1: × 1.15, and the first cast makes one more Sunderblade: a Thunder Strike, then the final one.
    r.mult('battle', 'Thunder Strike DMG Multiplier', {
      setup: 'P1',
      ranks: [12],
      what: 'Battle Skill at P1: two Sunderblades (one strike + the final), × 1.15',
      factor: (d) => (1 + d.patch('normal_skill').values.final_rate) * d.potential(1)[0],
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
  ],
};

const ARCANE: OperatorRules = {
  id: 'chr_0032_lizhiyan',
  name: 'Arcane',
  setups: potentials(1, 4),
  // With no gear her Intellect is at least her Will: Array Arcana INT (the wiki's first listing, variant 0).
  rules: [
    ...r.chain(5),
    ...r.finalStrike(),
    r.element(),
    r.spCost(),
    r.mult('battle', 'DMG Multiplier'),
    r.stagger('battle', 'Stagger'),
    r.free('battle'),
    r.mult('combo', 'Base DMG Multiplier', { skill: /seal_total/ }),
    r.mult('combo', 'Explosion DMG Multiplier', {
      skill: /abilityentity_end/,
      per: (p) => p.hitsOf(p.nth('combo'), /abilityentity_end/).length,
      what: 'Combo Skill "Explosion DMG Multiplier" per Tactical Double',
    }),
    r.stagger('combo', 'Base Stagger + Explosion Stagger', {
      footage:
        'the four Tactical Doubles exploding together Stagger once (summonPoise: the wiki’s and the owner’s count)',
      data: (d) => d.value('Combo Skill', 'Base Stagger') + d.value('Combo Skill', 'Explosion Stagger'),
    }),
    r.cooldown('combo', {
      adjust: (d) =>
        Number(
          d.bundle.talents[`${d.id}_talent_1_1`].find((t: any) => t.skillParamModifier?.paramType === 'CoolDown')
            .skillParamModifier.paramValue,
        ),
      source: 'combat/ops patch combo_skill cooldown + talents talent_1 CoolDown (Array Arcana: INT)',
    }),
    r.energy('combo', 'Ultimate Energy Gain'),
    r.buff('combo', /combo_skill_seal2$/, 'enemy', 'Imprisonment and Susceptibility Duration (s)'),
    r.free('combo'),
    r.mult('ultimate', 'Gloompurger Array Creation DMG Multiplier', {
      pick: first,
    }),
    r.stagger('ultimate', 'Gloompurger Array Creation Stagger', {
      skill: /ultimate_skill$/,
    }),
    r.buff('ultimate', /ultimate_skill_listener_owner$/, 'self', 'Gloompurger Array Duration (s)'),
    r.ultCost(),
    r.cooldown('ultimate'),
    r.free('ultimate'),
    r.mult('combo', 'Base DMG Multiplier', {
      skill: /seal_total/,
      setup: 'P1',
      ranks: [12],
      factor: (d) => d.potential(1)[0],
    }),
    r.ultCost({ setup: 'P4', potential: 4 }),
  ],
};

const OPERATORS = [ARCANE, TANGTANG, SI, TYPHOEUS, LAST_RITE, YVONNE, LIINO, ZHUANG_FANGYI];

for (const op of OPERATORS)
  describe(op.name, () => {
    let src: Sources;
    const probes = new Map<string, Probe>();
    beforeAll(async () => {
      const mates = [...new Set(Object.values(op.setups ?? {}).flatMap((s) => s.team ?? []))];
      const [data, wiki, bundle] = await Promise.all([
        simData([op.id, ...mates]),
        asset('wiki/operators.json').then((w) => w.operators[op.id] as WikiOp),
        asset(`combat/ops/${op.id}.json`),
      ]);
      src = new Sources(wiki, bundle, op.id);
      const want = new Set(
        op.rules.flatMap((x) => (x.ranks ?? [12]).flatMap((rank) => [`${x.setup ?? 'base'}|${rank}`, `base|${rank}`])),
      );
      for (const key of want) {
        const [name, rank] = key.split('|');
        const setup = { ...(op.setups?.[name] ?? {}), rank: Number(rank) };
        probes.set(key, new Probe(data, op.id, setup).play(setup.script ?? SCRIPT));
      }
    }, 120_000);
    const run = (rule: Rule, rank: number) => () => {
      const p = probes.get(`${rule.setup ?? 'base'}|${rank}`)!;
      const sim = rule.sim(p, probes.get(`base|${rank}`)!);
      const data = rule.data(src, rank, p);
      const tol = typeof rule.tol === 'function' ? rule.tol(p) : (rule.tol ?? 1e-6);
      if (typeof data === 'number' && typeof sim === 'number')
        expect(Math.abs(sim - data), `sim ${sim}, data ${data}`).toBeLessThanOrEqual(tol);
      else expect(sim).toEqual(data);
    };
    for (const rule of op.rules)
      for (const rank of rule.ranks ?? [12])
        (rule.finding ? it.fails : it)(
          `${rule.what}${rule.ranks ? ` [rank ${rank}]` : ''}${rule.footage ? ' [footage]' : ''}${rule.finding ? ' [finding]' : ''}: ${rule.source}`,
          run(rule, rank),
        );
  });
