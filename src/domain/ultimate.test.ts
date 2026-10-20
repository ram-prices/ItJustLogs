import { describe, expect, it } from 'vitest';
import { requiredGain, rotationEnergy, ultimateEnergy } from './ultimate';
import type { WikiOperator } from './wiki';

const skill = (type: string, name: string, values: [string, string][], description = '') => ({
  type,
  name,
  description,
  values: values.map(([label, v]) => ({ label, ranks: [v] })),
});

const op = (skills: ReturnType<typeof skill>[], potentials: WikiOperator['potentials'] = []) =>
  ({ name: 'X', skills, potentials, talents: [] }) as unknown as WikiOperator;

const arcane = op(
  [
    skill('Battle Skill', 'Jadecrushing Grid', [['SP Cost', '100']]),
    skill('Combo Skill', 'Yinglung Stance IV', [['Cooldown', '18'], ['SP Return', '30'], ['Ultimate Energy Gain', '10']]),
    skill('Ultimate', 'Gloompurge', [['Ultimate Energy Cost', '100']]),
  ],
  [{ rank: 4, name: 'Mind of Refined Steel', description: 'Ultimate ⟦key|Gloompurge⟧ improved: Ultimate Energy cost ⟦num|-15%⟧.' }],
);

describe('ultimate breakpoints', () => {
  it('reads the cost and combo gain, and Potential cost cuts', () => {
    expect(ultimateEnergy(arcane, 0)).toMatchObject({ cost: 100, comboGain: 10, teamEnergy: true });
    expect(ultimateEnergy(arcane, 4)?.cost).toBe(85);
  });

  it("matches the guides: Arcane's 46.4% weapon line covers 6 battle skills + 3 combos, not 6 + 2", () => {
    const u = ultimateEnergy(arcane, 0)!;
    expect(rotationEnergy(u, 6, 3)).toBe(69);
    expect(requiredGain(u, 6, 3)).toBeCloseTo(44.9, 1);
    expect(requiredGain(u, 6, 2)).toBeCloseTo(69.5, 1);
    expect(requiredGain(u, 12, 3)).toBe(0);
  });

  it('knows Last Rite gets nothing from teammates, and lists hit-dependent gains', () => {
    const lastRite = op([
      skill('Battle Skill', 'Esoteric Legacy', [['Ultimate Energy Gain', '16']]),
      skill('Combo Skill', 'Winter Requiem', [['Base Ultimate Energy Gain', '40'], ['Additional Ultimate Energy Gain per Infliction Stack', '15']]),
      skill('Ultimate', 'Vigil Services', [['Ultimate Energy Cost', '240']], '⟦muted|Last Rite can only gain Ultimate Energy from her own battle skills and combo skills.⟧'),
    ]);
    const u = ultimateEnergy(lastRite, null)!;
    expect(u.teamEnergy).toBe(false);
    expect(u.comboGain).toBe(40);
    expect(rotationEnergy(u, 6, 2)).toBe(80);
    expect(u.extras).toHaveLength(2);
  });

  it('adds up combos that grant energy per sequence', () => {
    const rossi = op([
      skill('Combo Skill', 'Ambush', [['SEQ 1 Ultimate Energy Gain', '10'], ['SEQ 2 Ultimate Energy Gain', '10']]),
      skill('Ultimate', 'Ambuscade', [['Ultimate Energy Cost', '110']]),
    ]);
    expect(ultimateEnergy(rossi, null)?.comboGain).toBe(20);
  });
});
