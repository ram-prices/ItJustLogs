import highsLoader from 'highs';
import { beforeAll, describe, expect, it } from 'vitest';
import { lpFormat, type Solver } from './lp';
import { areaCapacity, areaNodes, plan, type AicData, type PlanInput } from './aic';

// A rig gives an ore every 3 s (20 a minute); a furnace turns 1 ore into 1 ingot in 2 s (30 a minute);
// a mixer needs 1 ingot and 1 water (a fluid only the site that pumps it has) for 1 alloy in 2 s.
const data: AicData = {
  source: '',
  note: '',
  fetched: '',
  thermalBank: 'bank',
  items: {
    ore: { name: 'Ore', phase: 'solid', depot: ['north', 'south'], transfer: ['north', 'south'] },
    ingot: { name: 'Ingot', phase: 'solid', depot: ['north', 'south'], transfer: ['north', 'south'] },
    water: { name: 'Water', phase: 'liquid', depot: [] },
    alloy: { name: 'Alloy', phase: 'solid', depot: ['north', 'south'] },
    fuel: { name: 'Fuel', phase: 'solid', depot: ['north', 'south'] },
  },
  machines: {
    rig: { name: 'Rig', power: 5, capacity: 2, size: [3, 3] },
    furnace: { name: 'Furnace', power: 10, capacity: 2, size: [3, 3] },
    pump: { name: 'Pump', power: 10, capacity: 2, size: [3, 3] },
    mixer: { name: 'Mixer', power: 50, capacity: 2, size: [5, 5] },
    press: { name: 'Press', power: 0, capacity: 2, size: [3, 3] },
    bank: { name: 'Bank', power: 0, capacity: 2, size: [2, 2] },
  },
  recipes: [
    { id: 'rig:ore', machine: 'rig', seconds: 3, in: [], out: [['ore', 1]], source: 'node' },
    { id: 'smelt', machine: 'furnace', seconds: 2, in: [['ore', 1]], out: [['ingot', 1]] },
    { id: 'pump:water', machine: 'pump', seconds: 1, mode: 'liquid', in: [], out: [['water', 1]], source: 'water' },
    { id: 'mix', machine: 'mixer', seconds: 2, mode: 'liquid', in: [['ingot', 1], ['water', 1]], out: [['alloy', 1]] },
    { id: 'press', machine: 'press', seconds: 6, in: [['ore', 1]], out: [['fuel', 1]] },
  ],
  fuels: { fuel: { power: 100, seconds: 30 } },
  regions: [
    { id: 'north', name: 'North', power: 50, levels: 2, areas: [{ id: 'n1', name: 'N1', capacity: [10, 20], nodes: [['ore', 0, 0], ['ore', 5, 5], ['gas', 9, 9]] }, { id: 'n2', name: 'N2', capacity: [10, 20] }], transfer: { perHour: [0, 600], routes: 1, lossless: 2 } },
    { id: 'south', name: 'South', power: 50, modes: ['normal'], levels: 1, areas: [{ id: 's1', name: 'S1', capacity: [40] }] },
  ],
};

let solver: Solver;
beforeAll(async () => {
  solver = await highsLoader();
});

const calc = (perMin: number, extra: Partial<PlanInput> = {}): PlanInput => ({
  sites: [],
  targets: [{ item: 'ingot', perMin, region: '' }],
  objective: 'capacity',
  whole: true,
  power: false,
  fuels: [],
  ...extra,
});
const count = (p: ReturnType<typeof plan>, recipe: string, site?: number) =>
  p.steps.filter((s) => s.recipe === recipe && (site == null || s.site === site)).reduce((n, s) => n + s.count, 0);

describe('AIC planner', () => {
  it('writes models HiGHS reads', () => {
    const text = lpFormat(2, [1, 0.5], [{ coef: new Map([[0, 1], [1, -2]]), op: '>=', rhs: 3 }], [1]);
    expect(text).toBe('Minimize\n obj:\n  + 1 x0\n  + 0.5 x1\nSubject To\n c0:\n  + 1 x0\n  - 2 x1\n  >= 3\nGeneral\n x1\nEnd');
  });

  it('works out a chain as a calculator', () => {
    // 45 ingots a minute: 1.5 furnaces' work and 2.25 rigs' → 2 furnaces and 3 rigs.
    const p = plan(data, calc(45), solver);
    expect(p.status).toBe('optimal');
    expect(p.exact).toBe(true);
    expect(count(p, 'smelt')).toBe(2);
    expect(count(p, 'rig:ore')).toBe(3);
    expect(p.steps.find((s) => s.recipe === 'rig:ore')!.busy).toBeCloseTo(2.25);
    expect(p.imports).toEqual([]);
    // Fractions of facilities: just the rates.
    const f = plan(data, calc(45, { whole: false }), solver);
    expect(count(f, 'smelt')).toBeCloseTo(1.5);
    expect(count(f, 'rig:ore')).toBeCloseTo(2.25);
  });

  it('shares depot items across a region but keeps fluids at their site', () => {
    // North's N1 has no ore nodes and room for 2 facilities; N2 has the ore. Alloy needs water at the mixer's site.
    const p = plan(
      data,
      {
        sites: [
          { area: 'n1', region: 'north', capacity: 4, nodes: { ore: 0 } },
          { area: 'n2', region: 'north', capacity: 20, nodes: { water: 0 } },
        ],
        targets: [{ item: 'alloy', perMin: 30, region: 'north' }],
        objective: 'capacity',
        whole: true,
        power: false,
        fuels: [],
      },
      solver,
    );
    expect(count(p, 'rig:ore', 1)).toBe(2); // 30 ore a minute, all from N2
    expect(count(p, 'rig:ore', 0)).toBe(0);
    // The mixer and its pump together at N1, the only site with water; the furnace at N2.
    expect(count(p, 'mix', 0)).toBe(1);
    expect(count(p, 'pump:water', 0)).toBe(1);
    expect(count(p, 'smelt', 1)).toBe(1);
    expect(p.capacity.map((c) => c.used)).toEqual([4, 6]);
  });

  it('keeps each region within its power, burning fuel for more', () => {
    // 60 ingots: 2 furnaces (20) and 3 rigs (15) fit the PAC's 50; 90 ingots need 30 + 25 = 55 (+ the press's rigs).
    const input = (perMin: number): PlanInput => ({
      sites: [{ area: 'n1', region: 'north', capacity: null, nodes: {} }],
      targets: [{ item: 'ingot', perMin, region: 'north' }],
      objective: 'capacity',
      whole: true,
      power: true,
      fuels: ['fuel'],
    });
    expect(plan(data, input(60), solver).steps.some((s) => s.recipe === null)).toBe(false);
    const p = plan(data, input(90), solver);
    const bank = p.steps.find((s) => s.recipe === null)!;
    expect(bank.fuel).toBe('fuel');
    expect(p.power[0].used).toBeLessThanOrEqual(p.power[0].base + p.power[0].made + 1e-6);
  });

  it('brings in what the sites cannot make, and sends depot items by Regional Transfer', () => {
    // South has no ore nodes: its ingots come from North, at most 600 an hour (10 a minute).
    const p = plan(
      data,
      {
        sites: [
          { area: 'n1', region: 'north', capacity: null, nodes: {} },
          { area: 's1', region: 'south', capacity: null, nodes: { ore: 0 } },
        ],
        targets: [{ item: 'ingot', perMin: 15, region: 'south' }],
        objective: 'capacity',
        whole: true,
        power: false,
        fuels: [],
        transfer: { from: 'north', to: 'south', perHour: 600 },
      },
      solver,
    );
    expect(p.transfers.reduce((n, t) => n + t.perMin, 0)).toBeCloseTo(10);
    expect(p.imports.map((x) => [x.item, Math.round(x.perMin)])).toEqual([['ingot', 5]]);
  });

  it("builds only what a region's facility modes allow", () => {
    // South allows no fluids: no pump, no mixer; its alloy comes from outside.
    const p = plan(data, { sites: [{ area: 's1', region: 'south', capacity: null, nodes: {} }], targets: [{ item: 'alloy', perMin: 30, region: 'south' }], objective: 'capacity', whole: true, power: false, fuels: [] }, solver);
    expect(p.steps.some((s) => s.recipe === 'pump:water' || s.recipe === 'mix')).toBe(false);
    expect(p.imports.map((x) => x.item)).toEqual(['alloy']);
  });

  it('reads an area’s Protocol Capacity by Regional Development level', () => {
    expect(areaCapacity(data.regions[0], 'n1', 2)).toBe(20);
    expect(areaCapacity(data.regions[0], 'n1', 9)).toBe(20);
    expect(areaCapacity(data.regions[0], 'zz', 1)).toBe(0);
  });

  it('counts an area’s nodes by item', () => {
    expect(areaNodes(data.regions[0], 'n1')).toEqual({ ore: 2, gas: 1 });
    expect(areaNodes(data.regions[0], 'n2')).toEqual({});
  });
});
