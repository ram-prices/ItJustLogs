import { describe, expect, it } from 'vitest';
import { BLIGHTSHADE, BLIGHTSHADE_HP, enemyById, enemySeen, knownEnemy } from './team';

describe('YSTF Captain Blightshade (Glaiver File: Yinglung)', () => {
  it("has the template's stats and the spawner's buffs", () => {
    expect(BLIGHTSHADE).toMatchObject({ def: 100, resist: { Physical: 20, Pulse: 35 }, poise: 320 + 20, staggerSeconds: 9, finisherSp: 50, finisherMul: 1.5, nodes: [0.5], interrupt: { stagger: 20 }, food: false, prep: true });
    // The template's HP at Lv 60/75/90 × (1 + 4.5).
    expect(BLIGHTSHADE_HP).toEqual({ normal: Math.round(222_753 * 5.5), hard: Math.round(457_648 * 5.5), brutal: Math.round(825_447 * 5.5) });
  });

  it("carries the stage's SP: 700 at the start and at most, regeneration and every gain halved", () => {
    expect(BLIGHTSHADE.sp).toEqual({ start: 700, max: 700, regen: 8 * 0.5, gain: 0.5 });
  });

  it('is picked by id and by the boss bar', () => {
    expect(enemyById('blightshade').enemy.phaseHp).toBe(BLIGHTSHADE_HP.brutal);
    expect(enemyById('blightshade-normal').hp).toBe(BLIGHTSHADE_HP.normal);
    expect(enemySeen('YSTF Captain Blightshade')?.id).toBe('blightshade');
  });
});

describe('saved enemies', () => {
  it('a run saved before its stage SP rules changed replays with the current ones', () => {
    const now = enemyById('blightshade').enemy;
    const saved = { ...now, sp: { start: 700, max: 700, regen: 4 } };
    expect(knownEnemy(saved)?.enemy.sp?.gain).toBe(0.5);
    expect(knownEnemy({ ...now, def: 50 })).toBeUndefined();
  });
});
