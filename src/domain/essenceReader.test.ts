import { describe, expect, it } from 'vitest';
import { EssenceTally, readEssence, statIn, type ReadText } from './essenceReader';
import { byFit, essenceKey, fitOf, parseEssenceKey } from './essences';

const line = (text: string, x0: number, y0: number): ReadText => ({ text, x0, y0, y1: y0 + 20 });

describe('essence reader', () => {
  it('reads the Valuables panel: each level on the line under its stat', () => {
    // As laid out in Valuables → Essences ("Essence Stats"), with the bars' noise.
    const lines = [
      line('Flawless Essence: Detonate |', 1340, 80),
      line('Essence Stats', 1430, 250),
      line('o Agility', 1350, 278),
      line('Lo +1', 1350, 295),
      line('o Arts DMG', 1350, 320),
      line('JIM +4', 1350, 337),
      line('o Detonate', 1350, 362),
      line('— +1', 1350, 379),
      line('Infuse this into a weapon to improve its skill level.', 1350, 420),
    ];
    expect(readEssence(lines)).toEqual([
      ['Agility', 1],
      ['Arts DMG', 4],
      ['Detonate', 1],
    ]);
  });

  it('reads the Etch Essence card, and skips the stat being etched', () => {
    const lines = [
      line('Flawless Essence: Inspiring', 370, 310),
      line('© Agility /// +3', 370, 410),
      line('© Arts DMG ¢ +1', 370, 440),
      line('© Inspiring ¢ +1', 370, 470),
      line('Main Attribute +1 » +2', 830, 490),
    ];
    expect(readEssence(lines)).toEqual([
      ['Agility', 3],
      ['Arts DMG', 1],
      ['Inspiring', 1],
    ]);
  });

  it('knows stat names past a misread letter, and not the essence title', () => {
    expect(statIn('o Physlcal DMG')).toBe('Physical DMG');
    expect(statIn('Ultimate Gain Efficiency')).toBe('ULT Efficiency');
    expect(statIn('Flawless Essence: Flow')).toBeNull();
  });

  it('counts an essence once its stats hold for two frames', () => {
    const t = new EssenceTally();
    const a = [['Agility', 1], ['Arts DMG', 4], ['Detonate', 1]] as [string, number][];
    const b = [['Will', 2], ['ATK', 3], ['Flow', 1]] as [string, number][];
    t.add(a);
    t.add(a);
    t.add(a);
    t.add([['Will', 2]]); // caught mid-change: one frame only
    t.add(b);
    t.hold();
    t.add(a);
    t.add(a);
    expect(t.order).toEqual([essenceKey(a), essenceKey(b), essenceKey(a)]);
    expect(t.stash.get(essenceKey(a))).toBe(2);
  });

  it('ranks essences for a weapon by its stats they carry, then levels', () => {
    const wants = ['Strength', 'Treatment Efficiency', 'Medicant'];
    const full = fitOf(parseEssenceKey('Strength+2|Treatment Efficiency+3|Medicant+1'), wants);
    const two = fitOf(parseEssenceKey('Strength+6|Treatment Efficiency+6|Flow+3'), wants);
    expect(full).toEqual({ hits: 3, full: true, levels: 6 });
    expect([two, full].sort(byFit)[0]).toBe(full);
  });
});
