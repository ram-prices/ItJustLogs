import { describe, expect, it } from 'vitest';
import { applyMods, isGain, potentialSkillMods, skillDmgBonus } from './skillmods';
import type { WikiOperator } from './wiki';

const skill = (type: string, name: string, values: [string, string[]][]) => ({ type, name, description: '', values: values.map(([label, ranks]) => ({ label, ranks })) });

const arcane = {
  skills: [
    skill('Combo Skill', 'Yinglung Stance IV', [['Cooldown', ['20', '18']], ['Base DMG Multiplier', ['80%', '100%']], ['Explosion DMG Multiplier', ['100%', '120%']], ['Ultimate Energy Gain', ['10', '10']]]),
    skill('Ultimate', 'Gloompurge', [['Ultimate Energy Cost', ['100', '100']], ['Cluster Strike Total DMG Multiplier', ['300%', '360%']], ['Gloompurge Arcana DMG Multiplier', ['1200%', '1440%']]]),
    // The second skill set lists the ultimate again.
    skill('Ultimate', 'Gloompurge', [['Ultimate Energy Cost', ['100', '100']], ['Gloompurge Arcana DMG Multiplier', ['1200%', '1440%']]]),
    skill('Battle Skill', 'Jadecrushing Grid', [['SP Cost', ['100', '100']]]),
  ],
  potentials: [
    { rank: 1, name: 'Watcher of the Sea', description: 'Combo skill ⟦key|Yinglung Stance IV⟧ improved:\nDMG Multiplier is increased to ⟦num|1.3⟧ times the original.\n⟦key|Array Arcana: INT⟧: Hitting an enemy returns 10 additional SP.' },
    { rank: 2, name: 'Heart of Ice Cold Ferrium', description: 'Intellect and Will ⟦num|+15⟧, Arts Intensity ⟦num|+16⟧.' },
    { rank: 4, name: 'Mind of Refined Steel', description: 'Ultimate ⟦key|Gloompurge⟧ improved: Ultimate Energy cost ⟦num|-15%⟧.' },
    { rank: 5, name: 'Homeward Glance', description: 'Ultimate ⟦key|Gloompurge⟧ improved:\nDMG Multiplier of Gloompurge Arcana (ultimate sequence 2) is increased to ⟦num|1.3⟧ times the original.' },
  ],
} as unknown as WikiOperator;

describe('skill changes from Potentials', () => {
  it('applies the plain phrasings to the right skill and row, up to the Potential', () => {
    expect(potentialSkillMods(arcane, null).size).toBe(0);
    const p1 = potentialSkillMods(arcane, 1);
    expect(p1.get('Combo Skill:Yinglung Stance IV')?.get('Base DMG Multiplier')?.[0]).toMatchObject({ kind: 'mult', value: 1.3 });
    expect(p1.get('Combo Skill:Yinglung Stance IV')?.get('Explosion DMG Multiplier')).toHaveLength(1);
    expect(p1.has('Ultimate:Gloompurge')).toBe(false);
    const p5 = potentialSkillMods(arcane, 5);
    // P4 cuts the cost once (not once per skill set); P5 raises only the Gloompurge Arcana part.
    expect(p5.get('Ultimate:Gloompurge')?.get('Ultimate Energy Cost')).toHaveLength(1);
    expect(p5.get('Ultimate:Gloompurge')?.get('Ultimate Energy Cost')?.[0].value).toBeCloseTo(0.85);
    expect(p5.get('Ultimate:Gloompurge')?.get('Gloompurge Arcana DMG Multiplier')?.[0].value).toBe(1.3);
    expect(p5.get('Ultimate:Gloompurge')?.has('Cluster Strike Total DMG Multiplier')).toBe(false);
  });

  it('reads cooldown cuts', () => {
    const op = {
      skills: [skill('Combo Skill', 'Blade', [['Cooldown', ['15']]])],
      potentials: [{ rank: 3, name: 'Quick', description: 'Combo skill ⟦key|Blade⟧ improved: Length of cooldown ⟦num|-2s⟧.' }],
    } as unknown as WikiOperator;
    expect(potentialSkillMods(op, 5).get('Combo Skill:Blade')?.get('Cooldown')?.[0]).toMatchObject({ kind: 'add', value: -2 });
  });

  it('applies changes to shown values, keeping their units', () => {
    expect(applyMods('100%', [{ from: 'P1', kind: 'mult', value: 1.3 }])).toBe('130%');
    expect(applyMods('100', [{ from: 'P4', kind: 'mult', value: 0.85 }])).toBe('85');
    expect(applyMods('7.5', [{ from: 'P3', kind: 'add', value: -2 }])).toBe('5.5');
    expect(applyMods('Infinite', [{ from: 'P1', kind: 'mult', value: 2 }])).toBeNull();
    expect(isGain('Cooldown', [{ from: 'P3', kind: 'add', value: -2 }])).toBe(true);
    expect(isGain('DMG Multiplier', [{ from: 'P1', kind: 'mult', value: 1.3 }])).toBe(true);
  });
});

describe('skill DMG bonuses', () => {
  const b = (pct: number, from: string) => ({ flat: 0, pct, sources: [{ from, flat: 0, pct }] });
  const bonuses = new Map([
    ['Battle Skill DMG Bonus', b(16.2, 'Gloves')],
    ['Skill DMG', b(24, 'Aburrey set')],
    ['Physical DMG Bonus', b(23, 'Kit')],
  ]);

  it('goes to the skill types each stat covers', () => {
    expect(skillDmgBonus({ type: 'Battle Skill' }, bonuses)?.pct).toBeCloseTo(40.2);
    expect(skillDmgBonus({ type: 'Ultimate' }, bonuses)?.pct).toBe(24);
    expect(skillDmgBonus({ type: 'Basic Attack' }, bonuses)).toBeNull();
  });
});
