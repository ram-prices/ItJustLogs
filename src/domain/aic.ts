/**
 * The AIC planner (ui/pages/aic.ts): which facilities, how many and where,
 * to make the items asked for, from ef-assets aic/planner.json (the game's
 * own tables: recipes, power, Protocol Capacity, Regional Development).
 *
 * With no sites it's a plain calculator: one place, no limits. With sites
 * (areas the player builds in: the PAC's and each Sub-PAC's), items the
 * region's depot holds are shared by all its sites, other items (most
 * liquids and gases) stay at the site that makes them; each region's
 * facilities share its power grid (the PAC's own power plus Thermal Banks);
 * each site keeps within its Protocol Capacity and ore nodes; and one region
 * can send depot items to another by Regional Transfer, so many an hour.
 *
 * Solved as a linear program by HiGHS (domain/lp.ts); with `whole`, facility
 * counts are whole numbers (a mixed-integer program). Anything the sites can't make in
 * time is listed as brought in from outside rather than failing. Pure logic,
 * no DOM.
 */
import { solveModel, type Row, type Solver } from './lp';

export interface AicItem {
  name: string;
  phase: 'solid' | 'liquid' | 'gas';
  /** Regions whose depot holds it. */
  depot: string[];
  /** Regions that can send it by Regional Transfer. */
  transfer?: string[];
}

export interface AicMachine {
  name: string;
  power: number;
  /** Protocol Capacity it takes. */
  capacity: number;
  size: [number, number];
  /** At most this many per region (Forge of the Sky). */
  perRegion?: number;
  /** Only these regions. */
  regions?: string[];
}

export interface AicRecipe {
  id: string;
  machine: string;
  seconds: number;
  /** The facility mode it needs ("normal", "liquid", "gas"...): only regions that allow it. */
  mode?: string;
  in: [string, number][];
  out: [string, number][];
  /** A rig or extractor needs an ore or gas node; a pump, water. */
  source?: 'node' | 'water';
  /** Empties a filled bottle or canister. */
  carrier?: boolean;
}

export interface AicRegion {
  id: string;
  name: string;
  /** The PAC's own power. */
  power: number;
  /** Facility modes allowed here (Valley IV: only "normal", no fluids). Unset: all. */
  modes?: string[];
  levels: number;
  /** Each area's Protocol Capacity at Regional Development level 1, 2, …, and its ore and gas nodes (item, x, z). */
  areas: { id: string; name: string; capacity: number[]; nodes?: [string, number, number][] }[];
  /** Regional Transfer: items an hour by level (0 = locked), and the level from which nothing is lost. */
  transfer?: { perHour: number[]; routes: number; lossless: number };
}

export interface AicData {
  source: string;
  note: string;
  fetched: string;
  thermalBank: string;
  items: Record<string, AicItem>;
  machines: Record<string, AicMachine>;
  recipes: AicRecipe[];
  /** What a Thermal Bank makes from each fuel while it burns, and for how long one lasts. */
  fuels: Record<string, { power: number; seconds: number }>;
  regions: AicRegion[];
}

export interface Site {
  /** Area (level) id. */
  area: string;
  region: string;
  /** Protocol Capacity; null for no limit. */
  capacity: number | null;
  /** Nodes by the item they give (ore, gas, Clean Water for pumps); an item not listed has no limit. */
  nodes: Record<string, number>;
}

export interface Target {
  item: string;
  perMin: number;
  /** The region whose depot gets it (ignored without sites). */
  region: string;
}

export type Objective = 'capacity' | 'power' | 'machines';

export interface PlanInput {
  /** None: a calculator with no limits. */
  sites: Site[];
  targets: Target[];
  objective: Objective;
  /** Whole facilities (else fractions, as a rate calculator gives). */
  whole: boolean;
  /** Keep each region within its power, adding Thermal Banks on the allowed fuels. */
  power: boolean;
  fuels: string[];
  transfer?: { from: string; to: string; perHour: number };
  /** Recipes not to use. */
  exclude?: string[];
  /** How long to search for whole numbers before taking the best found. */
  seconds?: number;
}

/** The planner's page state, kept in settings (so it syncs and exports). */
export interface AicSettings {
  view?: 'calc' | 'sites';
  targets?: Target[];
  objective?: Objective;
  /** Fractions of facilities allowed (a rate calculator's answer). Unset: whole facilities. */
  fractions?: boolean;
  /** Regional Development level by region id. */
  levels?: Record<string, number>;
  /** Areas used as sites, by area id: a Protocol Capacity of the player's own, and ore nodes. */
  sites?: Record<string, { capacity?: number; nodes?: Record<string, number> }>;
  /** Off: power isn't limited. Unset: on. */
  power?: boolean;
  /** Fuels Thermal Banks may burn. Unset: all. */
  fuels?: string[];
  /** Regional Transfer items an hour, if not the level's. */
  transfer?: number;
}

export interface PlanStep {
  /** Index into the sites; 0 for the calculator. */
  site: number;
  /** null: a Thermal Bank burning `fuel`. */
  recipe: string | null;
  fuel?: string;
  machine: string;
  /** Facilities to build. */
  count: number;
  /** Facilities' worth of work they do (count × share of time busy). */
  busy: number;
  /** Per minute, at that work. */
  in: [string, number][];
  out: [string, number][];
  /** Power they use (a Thermal Bank: what it makes, negative). */
  power: number;
  capacity: number;
}

export interface Plan {
  status: 'optimal' | 'infeasible';
  /** Proved best (false: the search for whole numbers stopped at its limit). */
  exact: boolean;
  /** When not proved: at most this share worse than the best possible (from the plan with fractions allowed). */
  gap?: number;
  steps: PlanStep[];
  /** Brought in from outside, per minute: nothing here makes it, or the limits leave it short. */
  imports: { item: string; perMin: number; pool: string }[];
  /** Made beyond what's used, per minute. */
  leftover: { item: string; perMin: number; pool: string }[];
  /** Sent by Regional Transfer, per minute. */
  transfers: { item: string; perMin: number }[];
  power: { region: string; used: number; made: number; base: number }[];
  capacity: { site: number; used: number; max: number | null }[];
}

/** Per minute: what one facility running all the time does with `count` of an item per craft. */
const perMin = (count: number, seconds: number) => (count * 60) / seconds;

/** The recipes able to make an item (not excluded). */
export function makers(data: AicData, item: string, exclude: readonly string[] = []): AicRecipe[] {
  return data.recipes.filter((r) => !exclude.includes(r.id) && r.out.some(([id]) => id === item));
}

/** Items some recipe makes: what the planner can be asked for. */
export function makeable(data: AicData): string[] {
  const out = new Set<string>();
  for (const r of data.recipes) for (const [id] of r.out) out.add(id);
  return [...out].sort((a, b) => data.items[a].name.localeCompare(data.items[b].name));
}

/** Recipes that can play a part in making `items`: their makers, the makers of those makers' inputs, and so on. */
function closure(data: AicData, items: string[], exclude: readonly string[]): AicRecipe[] {
  const need = [...items];
  const seen = new Set(need);
  const out = new Set<AicRecipe>();
  while (need.length) {
    const item = need.pop()!;
    // Emptying a filled bottle only where nothing else makes the fluid.
    const all = makers(data, item, exclude);
    const direct = all.filter((r) => !r.carrier);
    for (const r of direct.length ? direct : all) {
      if (out.has(r)) continue;
      out.add(r);
      for (const [id] of r.in)
        if (!seen.has(id)) {
          seen.add(id);
          need.push(id);
        }
    }
  }
  return [...out];
}

const WEIGHTS: Record<Objective, { capacity: number; power: number; machines: number }> = {
  capacity: { capacity: 1, power: 0.002, machines: 0.01 },
  power: { capacity: 0.01, power: 1, machines: 0.01 },
  machines: { capacity: 0.01, power: 0.002, machines: 1 },
};
/** Per item a minute brought in from outside: only when nothing else will do. */
const IMPORT_COST = 1000;

export function plan(data: AicData, input: PlanInput, solver: Solver): Plan {
  const calc = input.sites.length === 0;
  const sites: Site[] = calc ? [{ area: '', region: '', capacity: null, nodes: {} }] : input.sites;
  const regions = [...new Set(sites.map((s) => s.region))];
  const regionOf = new Map(data.regions.map((r) => [r.id, r]));
  const fuels = input.power && !calc ? input.fuels.filter((f) => data.fuels[f]) : [];
  const recipes = closure(data, [...input.targets.map((t) => t.item), ...fuels], input.exclude ?? []);
  const w = WEIGHTS[input.objective];

  /** Where an item is balanced: its region's depot when that holds it, else the site. */
  const pool = (item: string, s: number) => (calc ? 'all' : data.items[item]?.depot.includes(sites[s].region) ? `r:${sites[s].region}` : `s:${s}`);

  // Variables: per site, each recipe's work (u) and facilities (x); Thermal Banks per fuel; imports; transfers.
  const cost: number[] = [];
  const add = (c: number) => cost.push(c) - 1;
  interface Run {
    site: number;
    recipe: AicRecipe | null;
    fuel?: string;
    machine: string;
    u: number;
    x: number;
  }
  const runs: Run[] = [];
  const machineCost = (m: AicMachine) => w.capacity * m.capacity + w.power * m.power + w.machines;
  for (let s = 0; s < sites.length; s++) {
    const site = sites[s];
    for (const r of recipes) {
      const m = data.machines[r.machine];
      if (!m) continue;
      if (!calc && m.regions && !m.regions.includes(site.region)) continue;
      const modes = regionOf.get(site.region)?.modes;
      if (!calc && r.mode && modes && !modes.includes(r.mode)) continue;
      if (r.source && site.nodes[r.out[0][0]] === 0) continue;
      runs.push({ site: s, recipe: r, machine: r.machine, u: add(1e-4), x: add(machineCost(m)) });
    }
    for (const f of fuels) {
      const m = data.machines[data.thermalBank];
      runs.push({ site: s, recipe: null, fuel: f, machine: data.thermalBank, u: add(1e-4), x: add(machineCost(m)) });
    }
  }

  // Item flows per pool.
  const flows = new Map<string, Map<number, number>>();
  const flow = (item: string, p: string, j: number, a: number) => {
    const key = `${item}|${p}`;
    const row = flows.get(key) ?? new Map<number, number>();
    row.set(j, (row.get(j) ?? 0) + a);
    flows.set(key, row);
  };
  for (const run of runs) {
    if (run.recipe) {
      for (const [id, n] of run.recipe.out) flow(id, pool(id, run.site), run.u, perMin(n, run.recipe.seconds));
      for (const [id, n] of run.recipe.in) flow(id, pool(id, run.site), run.u, -perMin(n, run.recipe.seconds));
    } else flow(run.fuel!, pool(run.fuel!, run.site), run.u, -perMin(1, data.fuels[run.fuel!].seconds));
  }
  const demand = new Map<string, number>();
  for (const t of input.targets) {
    if (!(t.perMin > 0)) continue;
    const s = calc ? 0 : Math.max(0, sites.findIndex((x) => x.region === t.region));
    const key = `${t.item}|${pool(t.item, s)}`;
    demand.set(key, (demand.get(key) ?? 0) + t.perMin);
    if (!flows.has(key)) flows.set(key, new Map());
  }
  // Imports wherever something is used or asked for.
  const imports = new Map<string, number>();
  for (const [key, row] of flows) if ([...row.values()].some((a) => a < 0) || demand.has(key)) imports.set(key, add(IMPORT_COST));
  for (const [key, j] of imports) flows.get(key)!.set(j, 1);

  // Regional Transfer.
  const transfers = new Map<string, number>();
  const tr = input.transfer;
  if (!calc && tr && tr.perHour > 0 && regions.includes(tr.from) && regions.includes(tr.to))
    for (const [id, item] of Object.entries(data.items)) {
      if (!item.transfer?.includes(tr.from) || !item.transfer.includes(tr.to)) continue;
      if (!item.depot.includes(tr.from) || !item.depot.includes(tr.to)) continue;
      const from = `${id}|r:${tr.from}`;
      const to = `${id}|r:${tr.to}`;
      if (!flows.has(from) || !flows.has(to)) continue;
      const j = add(1e-3);
      transfers.set(id, j);
      flows.get(from)!.set(j, -1);
      flows.get(to)!.set(j, 1);
    }

  const rows: Row[] = [];
  const flowRows: [string, Row][] = [];
  for (const [key, coef] of flows) {
    const row: Row = { coef, op: '>=', rhs: demand.get(key) ?? 0 };
    rows.push(row);
    flowRows.push([key, row]);
  }
  for (const run of runs) rows.push({ coef: new Map([[run.x, 1], [run.u, -1]]), op: '>=', rhs: 0 });
  if (transfers.size) rows.push({ coef: new Map([...transfers.values()].map((j) => [j, 1])), op: '<=', rhs: tr!.perHour / 60 });
  for (let s = 0; s < sites.length; s++) {
    const cap = sites[s].capacity;
    if (cap != null) rows.push({ coef: new Map(runs.filter((r) => r.site === s).map((r) => [r.x, data.machines[r.machine].capacity])), op: '<=', rhs: cap });
    for (const [item, n] of Object.entries(sites[s].nodes)) {
      const on = runs.filter((r) => r.site === s && r.recipe?.source && r.recipe.out[0][0] === item);
      if (on.length) rows.push({ coef: new Map(on.map((r) => [r.x, 1])), op: '<=', rhs: n });
    }
  }
  if (!calc) {
    for (const g of regions) {
      const here = runs.filter((r) => sites[r.site].region === g);
      if (input.power) {
        const coef = new Map<number, number>();
        for (const r of here) {
          if (r.recipe) coef.set(r.x, data.machines[r.machine].power);
          else coef.set(r.u, -data.fuels[r.fuel!].power);
        }
        rows.push({ coef, op: '<=', rhs: regionOf.get(g)?.power ?? 0 });
      }
      for (const [id, m] of Object.entries(data.machines)) {
        if (m.perRegion == null) continue;
        const of = here.filter((r) => r.machine === id);
        if (of.length) rows.push({ coef: new Map(of.map((r) => [r.x, 1])), op: '<=', rhs: m.perRegion });
      }
    }
  }

  const n = cost.length;
  const res = solveModel(solver, n, cost, rows, input.whole ? runs.map((r) => r.x) : [], input.seconds);
  const empty: Plan = { status: 'infeasible', exact: res.exact, steps: [], imports: [], leftover: [], transfers: [], power: [], capacity: [] };
  if (res.status !== 'optimal') return empty;
  const x = res.x;
  const tidy = (v: number) => (Math.abs(v) < 1e-7 ? 0 : v);

  const steps: PlanStep[] = [];
  for (const run of runs) {
    const count = input.whole ? Math.round(x[run.x]) : tidy(x[run.u]);
    const busy = tidy(x[run.u]);
    if (count <= 0 && busy <= 0) continue;
    const m = data.machines[run.machine];
    if (run.recipe) {
      const r = run.recipe;
      steps.push({
        site: run.site,
        recipe: r.id,
        machine: run.machine,
        count,
        busy,
        in: r.in.map(([id, k]) => [id, perMin(k, r.seconds) * busy]),
        out: r.out.map(([id, k]) => [id, perMin(k, r.seconds) * busy]),
        power: m.power * count,
        capacity: m.capacity * count,
      });
    } else {
      const f = data.fuels[run.fuel!];
      steps.push({ site: run.site, recipe: null, fuel: run.fuel, machine: run.machine, count, busy, in: [[run.fuel!, perMin(1, f.seconds) * busy]], out: [], power: -f.power * busy, capacity: m.capacity * count });
    }
  }
  const label = (key: string) => key.slice(key.indexOf('|') + 1);
  const importsOut = [...imports]
    .map(([key, j]) => ({ item: key.slice(0, key.indexOf('|')), perMin: tidy(x[j]), pool: label(key) }))
    .filter((v) => v.perMin > 1e-6);
  const leftover = flowRows
    .map(([key, row]) => {
      const made = [...row.coef].reduce((t, [j, a]) => t + a * x[j], 0);
      return { item: key.slice(0, key.indexOf('|')), perMin: made - row.rhs, pool: label(key) };
    })
    .filter((v) => v.perMin > 1e-4);
  const power = (calc ? [''] : regions).map((g) => {
    const here = steps.filter((s) => calc || sites[s.site].region === g);
    return {
      region: g,
      used: here.filter((s) => s.power > 0).reduce((t, s) => t + s.power, 0),
      made: -here.filter((s) => s.power < 0).reduce((t, s) => t + s.power, 0),
      base: calc ? 0 : (regionOf.get(g)?.power ?? 0),
    };
  });
  const capacity = sites.map((s, i) => ({ site: i, used: steps.filter((t) => t.site === i).reduce((n, t) => n + t.capacity, 0), max: s.capacity }));
  // Not proved: how far it can be from the best, by the plan with fractions allowed (never worse than the best).
  let gap: number | undefined;
  if (!res.exact) {
    const bound = solveModel(solver, n, cost, rows, []);
    if (bound.status === 'optimal' && res.value > 0) gap = Math.max(0, (res.value - bound.value) / res.value);
  }
  return {
    status: 'optimal',
    exact: res.exact,
    ...(gap != null ? { gap } : {}),
    steps,
    imports: importsOut,
    leftover,
    transfers: [...transfers].map(([item, j]) => ({ item, perMin: tidy(x[j]) })).filter((t) => t.perMin > 1e-6),
    power,
    capacity,
  };
}

/** How many nodes of each item an area has (ores and gases; pumps need water, which isn't listed). */
export function areaNodes(region: AicRegion, area: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [item] of region.areas.find((a) => a.id === area)?.nodes ?? []) out[item] = (out[item] ?? 0) + 1;
  return out;
}

/** An area's Protocol Capacity at a Regional Development level (1-based, clamped). */
export function areaCapacity(region: AicRegion, area: string, level: number): number {
  const a = region.areas.find((x) => x.id === area);
  if (!a) return 0;
  return a.capacity[Math.min(Math.max(level, 1), a.capacity.length) - 1] ?? 0;
}
