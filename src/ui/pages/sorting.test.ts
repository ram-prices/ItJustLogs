import { describe, expect, it } from 'vitest';
import type { Owned } from '../../domain/owned';
import { sortAction, sortItems, sortSpecs } from './sorting';

const owned = (potential: number, ts: number): Owned =>
  ({ copies: potential + 1, potential, acquisitions: [{ ts, extra: false }] }) as unknown as Owned;

const items = [
  { name: 'Chen', rarity: 5, owned: owned(5, 100), element: 'Physical' },
  { name: 'Arcane', rarity: 6, owned: owned(0, 300), element: 'Nature' },
  { name: 'Ardelia', rarity: 6, owned: owned(3, 200), element: 'Nature' },
  { name: 'Ember', rarity: 6, element: 'Heat' },
];
const names = () => sortItems('char', items, (x) => x).map((x) => x.name);

describe('ranked sorting', () => {
  it('defaults to rarity, then A–Z', () => {
    sortAction('sort-reset', 'char');
    expect(sortSpecs('char')[0]).toEqual({ key: 'rarity', desc: true });
    expect(names()).toEqual(['Arcane', 'Ardelia', 'Ember', 'Chen']);
  });

  it('puts a pressed key first, keeping the rest as tie-breakers, and flips it', () => {
    sortAction('sort-front', 'char', 'potential');
    // Potential first; Ember (not owned) last whichever way it goes.
    expect(names()).toEqual(['Chen', 'Ardelia', 'Arcane', 'Ember']);
    sortAction('sort-dir', 'char', 'potential');
    expect(names()).toEqual(['Arcane', 'Ardelia', 'Chen', 'Ember']);
    sortAction('sort-front', 'char', 'acquired');
    expect(names()).toEqual(['Arcane', 'Ardelia', 'Chen', 'Ember']);
    sortAction('sort-front', 'char', 'element');
    expect(names()[0]).toBe('Ember');
    sortAction('sort-reset', 'char');
    expect(names()).toEqual(['Arcane', 'Ardelia', 'Ember', 'Chen']);
  });

  it('takes a dragged order, and skips sorts turned off', () => {
    sortAction('sort-order', 'char', 'potential,rarity,name,acquired,element,weapon,class');
    expect(sortSpecs('char').map((s) => s.key).slice(0, 3)).toEqual(['potential', 'rarity', 'name']);
    expect(names()).toEqual(['Chen', 'Ardelia', 'Arcane', 'Ember']);
    sortAction('sort-toggle', 'char', 'potential');
    expect(sortSpecs('char')[0]).toMatchObject({ key: 'potential', off: true });
    // Potential is off, so rarity leads again.
    expect(names()).toEqual(['Arcane', 'Ardelia', 'Ember', 'Chen']);
    sortAction('sort-toggle', 'char', 'potential');
    expect(names()[0]).toBe('Chen');
    sortAction('sort-reset', 'char');
  });
});
