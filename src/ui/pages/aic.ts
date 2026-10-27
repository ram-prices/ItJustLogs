import { areaCapacity, areaNodes, makeable, type AicData, type AicSettings, type AicRegion, type Objective, type Plan, type PlanInput, type PlanStep, type Site } from '../../domain/aic';
import { state, updateSettings } from '../../state';
import { toast } from '../common';
import { badge, icon, itemName, pageHeader, toggleGroup } from '../components';
import { html, type Html } from '../html';
import { tip, tipNote } from '../charts';
import { subTabs } from './collections';
import { wikiFile } from './info';

/**
 * AIC planner (/aic): what to build, how many and where, for the items the
 * player wants each minute, from the game's own recipes (ef-assets
 * aic/planner.json; domain/aic.ts). Calculator: one place, no limits.
 * Multi-site: the areas picked in each region, each within its Protocol
 * Capacity (by Regional Development level) and ore nodes, sharing the
 * region's depot and power. Plans are solved in a worker (ui/aicWorker.ts)
 * as soon as anything changes; the page shows the last one meanwhile.
 */

type View = 'Calculator' | 'Multi-site';
const VIEWS: View[] = ['Calculator', 'Multi-site'];
const OBJECTIVES: [Objective, string][] = [
  ['capacity', 'Least Protocol Capacity'],
  ['power', 'Least power'],
  ['machines', 'Fewest facilities'],
];
/** Seconds to search for whole numbers; "Search longer" gives it this much more. */
const SECONDS = 4;
const LONGER = 30;

const settings = (): AicSettings => state.settings.aic ?? {};
const save = (patch: Partial<AicSettings>) => updateSettings({ aic: { ...settings(), ...patch } });

/** Items a node gives (ores, gases, Clean Water from a pump) that a region can collect, in the data's order. */
const nodeItems = (data: AicData, modes?: string[]) => [
  ...new Set(data.recipes.filter((r) => r.source && (!modes || !r.mode || modes.includes(r.mode))).map((r) => r.out[0][0])),
];

/** A site's node limits: the area's real ore and gas nodes, unless the player set their own (Clean Water: no limit unless set). */
function siteNodes(data: AicData, region: AicRegion, area: string, own: Record<string, number> = {}): Record<string, number> {
  const real = areaNodes(region, area);
  const limits: Record<string, number> = {};
  for (const item of nodeItems(data, region.modes)) if (item !== WATER) limits[item] = real[item] ?? 0;
  return { ...limits, ...own };
}
const WATER = 'item_liquid_water';

/** The plan asked for, from the page's settings. */
function inputOf(data: AicData, s: AicSettings, view: View, seconds: number): PlanInput {
  const levels = s.levels ?? {};
  const sites: Site[] =
    view === 'Calculator'
      ? []
      : data.regions.flatMap((r) =>
          r.areas
            .filter((a) => s.sites?.[a.id])
            .map((a) => ({
              area: a.id,
              region: r.id,
              capacity: s.sites![a.id].capacity ?? areaCapacity(r, a.id, levels[r.id] ?? 1),
              nodes: siteNodes(data, r, a.id, s.sites![a.id].nodes),
            })),
        );
  const regions = [...new Set(sites.map((x) => x.region))];
  const valley = data.regions.find((r) => r.transfer);
  const level = valley ? (levels[valley.id] ?? 1) : 0;
  const perHour = valley?.transfer ? (s.transfer ?? valley.transfer.perHour[level - 1] ?? 0) : 0;
  const to = data.regions.find((r) => r.id !== valley?.id);
  return {
    sites,
    targets: (s.targets ?? []).map((t) => ({ ...t, region: regions.includes(t.region) ? t.region : (regions[0] ?? '') })),
    objective: s.objective ?? 'capacity',
    whole: !s.fractions,
    power: s.power ?? true,
    fuels: s.fuels ?? Object.keys(data.fuels),
    ...(valley && to && perHour > 0 ? { transfer: { from: valley.id, to: to.id, perHour } } : {}),
    seconds,
  };
}

// The worker and the plan it last gave.
let worker: Worker | null = null;
let asked = '';
let busy = false;
let result: { key: string; plan: Plan; ms: number } | null = null;
let failed = '';
let seq = 0;
let searchLonger = '';
let view: View = 'Calculator';

function solve(data: AicData, input: PlanInput, key: string, redraw: () => void): void {
  if (key === asked) return;
  asked = key;
  failed = '';
  if (!input.targets.some((t) => t.perMin > 0)) {
    result = null;
    busy = false;
    return;
  }
  // A search still going for an older ask: start over.
  if (busy && worker) {
    worker.terminate();
    worker = null;
  }
  worker ??= new Worker(new URL('../aicWorker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  busy = true;
  worker.onmessage = (e: MessageEvent<{ id: number; plan?: Plan; ms?: number; error?: string }>) => {
    if (e.data.id !== id) return;
    busy = false;
    if (e.data.plan) result = { key, plan: e.data.plan, ms: e.data.ms ?? 0 };
    else failed = e.data.error ?? 'The solver stopped.';
    redraw();
  };
  worker.postMessage({ id, data, input });
}

/** The page's clicks (app.ts passes them on, then redraws). True if it was one of theirs. */
export function aicAction(action: string, el: HTMLElement): boolean {
  const v = el.dataset.value ?? '';
  const s = settings();
  if (action === 'aic-view') {
    view = v as View;
    save({ view: view === 'Calculator' ? 'calc' : 'sites' });
  } else if (action === 'aic-objective') save({ objective: v as Objective });
  else if (action === 'aic-remove') save({ targets: (s.targets ?? []).filter((_, i) => i !== Number(v)) });
  else if (action === 'aic-longer') searchLonger = asked;
  else return false;
  return true;
}

let itemIds: Map<string, string> | null = null;
const idOfName = (data: AicData, name: string) => {
  itemIds ??= new Map(makeable(data).map((id) => [data.items[id].name.toLowerCase(), id]));
  return itemIds.get(name.trim().toLowerCase());
};

/** The page's inputs, saved on change (app.ts). True if it was one of theirs. */
export function aicChange(el: HTMLInputElement): boolean {
  const f = el.dataset.aic;
  if (!f || !loaded) return false;
  const data = loaded;
  const s = settings();
  const targets = [...(s.targets ?? [])];
  const i = Number(el.dataset.i);
  const num = (x: string) => (x.trim() === '' ? undefined : Math.max(0, Number(x)) || 0);
  if (f === 'add' || f === 'item') {
    if (!el.value.trim()) return true;
    const id = idOfName(data, el.value);
    if (!id) {
      toast('Nothing in the AIC makes that. Pick a name from the list.', 'error');
      el.value = f === 'item' ? data.items[targets[i].item].name : '';
      return true;
    }
    if (f === 'add') targets.push({ item: id, perMin: 10, region: '' });
    else targets[i] = { ...targets[i], item: id };
    save({ targets });
  } else if (f === 'rate') {
    targets[i] = { ...targets[i], perMin: num(el.value) ?? 0 };
    save({ targets });
  } else if (f === 'region') {
    targets[i] = { ...targets[i], region: el.value };
    save({ targets });
  } else if (f === 'fractions') save({ fractions: el.checked || undefined });
  else if (f === 'power') save({ power: el.checked ? undefined : false });
  else if (f === 'level') save({ levels: { ...s.levels, [el.dataset.region!]: Number(el.value) } });
  else if (f === 'site') {
    const sites = { ...s.sites };
    if (el.checked) sites[el.dataset.area!] = {};
    else delete sites[el.dataset.area!];
    save({ sites });
  } else if (f === 'capacity' || f === 'node') {
    const area = el.dataset.area!;
    const site = { ...s.sites?.[area] };
    const n = num(el.value);
    if (f === 'capacity') {
      if (n == null) delete site.capacity;
      else site.capacity = n;
    } else {
      const nodes = { ...site.nodes };
      if (n == null) delete nodes[el.dataset.item!];
      else nodes[el.dataset.item!] = Math.floor(n);
      site.nodes = nodes;
    }
    save({ sites: { ...s.sites, [area]: site } });
  } else if (f === 'fuel') {
    const all = Object.keys(data.fuels);
    const on = new Set(s.fuels ?? all);
    if (el.checked) on.add(el.dataset.item!);
    else on.delete(el.dataset.item!);
    save({ fuels: all.filter((x) => on.has(x)) });
  } else if (f === 'transfer') save({ transfer: num(el.value) });
  else return false;
  return true;
}

let loaded: AicData | null = null;

const fmt = (n: number, digits = 1) => {
  const r = Number(n.toFixed(digits));
  return r.toLocaleString(undefined, { maximumFractionDigits: digits });
};
const flows = (data: AicData, list: [string, number][]) =>
  list.length ? list.map(([id, n], i) => html`${i ? ' + ' : ''}<span class="aic-flow"><span class="num">${fmt(n)}</span> ${itemName(data.items[id]?.name ?? id)}</span>`) : html`<span class="secondary">nothing</span>`;

/** Steps in making order: what a step uses comes from the steps above it (as far as loops allow). */
function ordered(steps: PlanStep[]): PlanStep[] {
  const level = new Map<PlanStep, number>(steps.map((s) => [s, 0]));
  for (let pass = 0; pass < steps.length; pass++) {
    let moved = false;
    for (const s of steps) {
      const from = steps.filter((p) => p !== s && p.out.some(([o]) => s.in.some(([i]) => i === o)));
      const l = Math.max(0, ...from.map((p) => level.get(p)! + 1));
      if (l > level.get(s)! && l < steps.length) {
        level.set(s, l);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return [...steps].sort((a, b) => level.get(a)! - level.get(b)! || a.machine.localeCompare(b.machine));
}

function stepsTable(data: AicData, steps: PlanStep[], whole: boolean): Html {
  return html`<div class="table-wrap"><table class="table aic-steps">
    <thead><tr><th>Facility</th><th class="num">Count</th><th>Makes, each minute</th><th class="num">Busy</th></tr></thead>
    <tbody>
      ${ordered(steps).map(
        (s) => html`<tr>
          <td>${data.machines[s.machine]?.name ?? s.machine}</td>
          <td class="num">${whole ? fmt(s.count, 0) : fmt(s.count, 2)}</td>
          <td class="aic-recipe">${s.recipe ? html`${s.in.length ? html`${flows(data, s.in)} → ` : ''}${flows(data, s.out)}` : html`Burns ${flows(data, s.in)} for ${fmt(-s.power, 0)} power`}</td>
          <td class="num secondary">${s.count > 0 ? `${Math.round((s.busy / s.count) * 100)}%` : ''}</td>
        </tr>`,
      )}
    </tbody>
  </table></div>`;
}

function results(data: AicData, input: PlanInput, key: string): Html {
  if (!input.targets.some((t) => t.perMin > 0)) return html`<p class="copy-14 secondary">Add an item to see what to build.</p>`;
  if (failed) return html`<p class="copy-14 error-text">${failed}</p>`;
  const r = result;
  if (!r) return html`<p class="copy-14 secondary">${icon('hourglass_empty')} Working it out…</p>`;
  const p = r.plan;
  const stale = r.key !== key;
  if (p.status !== 'optimal') return html`<p class="copy-14 secondary">No plan fits these limits.</p>`;
  const used = p.steps.reduce((n, s) => n + s.count, 0);
  const capacity = p.steps.reduce((n, s) => n + s.capacity, 0);
  const power = p.power.reduce((n, x) => n + x.used, 0);
  const proof = p.exact
    ? badge('Proved best', 'green')
    : html`${badge(`Within ${Math.max(1, Math.ceil((p.gap ?? 0) * 100))}% of the best`, 'amber')}
        ${busy || key.endsWith('+') ? '' : html`<button type="button" class="btn tertiary sm" data-action="aic-longer">${icon('search')}Search longer</button>`}`;
  const calc = input.sites.length === 0;
  const siteName = (i: number) => {
    const s = input.sites[i];
    return data.regions.flatMap((g) => g.areas).find((a) => a.id === s.area)?.name ?? s.area;
  };
  const regionName = (id: string) => data.regions.find((g) => g.id === id)?.name ?? id;
  const where = (pool: string) => (pool.startsWith('r:') ? regionName(pool.slice(2)) : pool.startsWith('s:') ? siteName(Number(pool.slice(2))) : '');
  const list = (rows: { item: string; perMin: number; pool: string }[]) =>
    html`<ul class="aic-list copy-14">${rows.map((x) => html`<li><span class="num">${fmt(x.perMin)}</span> ${itemName(data.items[x.item]?.name ?? x.item)}${calc ? '' : html` <span class="secondary">· ${where(x.pool)}</span>`}</li>`)}</ul>`;
  return html`<div class="aic-results${stale || busy ? ' stale' : ''}">
    <div class="aic-summary">
      <div><span class="label-12 secondary">Facilities</span><b class="num">${fmt(used, input.whole ? 0 : 1)}</b></div>
      <div><span class="label-12 secondary">Protocol Capacity</span><b class="num">${fmt(capacity, input.whole ? 0 : 1)}</b></div>
      <div><span class="label-12 secondary">Power</span><b class="num">${fmt(power, 0)}</b></div>
      <div class="aic-proof">${busy ? html`<span class="copy-13 secondary">${icon('hourglass_empty')} Solving…</span>` : input.whole ? proof : ''}</div>
    </div>
    ${p.imports.length ? html`<section class="aic-section"><h3 class="heading-14">Not made here</h3>${list(p.imports)}</section>` : ''}
    ${calc
      ? stepsTable(data, p.steps, input.whole)
      : input.sites.map((site, i) => {
          const steps = p.steps.filter((s) => s.site === i);
          const cap = p.capacity[i];
          return html`<section class="aic-section">
            <h3 class="heading-14">${siteName(i)} <span class="label-12 secondary">${regionName(site.region)} · Protocol Capacity ${fmt(cap?.used ?? 0, 0)}${cap?.max != null ? ` / ${cap.max}` : ''}</span></h3>
            ${steps.length ? stepsTable(data, steps, input.whole) : html`<p class="copy-13 secondary">Nothing to build here.</p>`}
          </section>`;
        })}
    ${!calc && input.power
      ? html`<section class="aic-section"><h3 class="heading-14">Power</h3>
          <ul class="aic-list copy-14">${p.power.map((x) => html`<li>${regionName(x.region)}: <span class="num">${fmt(x.used, 0)}</span> used of <span class="num">${fmt(x.base + x.made, 0)}</span> (PAC ${x.base}${x.made ? `, Thermal Banks ${fmt(x.made, 0)}` : ''})</li>`)}</ul></section>`
      : ''}
    ${p.transfers.length
      ? html`<section class="aic-section"><h3 class="heading-14">Regional Transfer</h3>
          <ul class="aic-list copy-14">${p.transfers.map((x) => html`<li><span class="num">${fmt(x.perMin * 60, 0)}</span> ${itemName(data.items[x.item].name)} an hour</li>`)}</ul></section>`
      : ''}
    ${p.leftover.length ? html`<section class="aic-section"><h3 class="heading-14">Left over</h3>${list(p.leftover)}</section>` : ''}
  </div>`;
}

function targetsCard(data: AicData, s: AicSettings, input: PlanInput): Html {
  const regions = [...new Set(input.sites.map((x) => x.region))];
  return html`<section class="card"><div class="card-body aic-card">
    <h2 class="heading-16">Make each minute</h2>
    ${(s.targets ?? []).map(
      (t, i) => html`<div class="aic-target">
        <input class="input aic-item" list="aic-items" data-aic="item" data-i="${i}" value="${data.items[t.item]?.name ?? ''}" autocomplete="off" spellcheck="false" aria-label="Item" />
        <input class="input aic-rate" type="number" min="0" step="any" data-aic="rate" data-i="${i}" value="${t.perMin}" aria-label="Each minute" />
        ${regions.length > 1
          ? html`<select class="input aic-region" data-aic="region" data-i="${i}" aria-label="Into the depot of">
              ${regions.map((g) => html`<option value="${g}" ${input.targets[i]?.region === g ? 'selected' : ''}>${data.regions.find((x) => x.id === g)?.name ?? g}</option>`)}
            </select>`
          : ''}
        <button type="button" class="btn tertiary sm icon-btn" data-action="aic-remove" data-value="${i}" title="Remove" aria-label="Remove">${icon('close')}</button>
      </div>`,
    )}
    <input class="input aic-item" list="aic-items" data-aic="add" placeholder="Add an item" autocomplete="off" spellcheck="false" aria-label="Add an item" />
    <datalist id="aic-items">${makeable(data).map((id) => html`<option value="${data.items[id].name}"></option>`)}</datalist>
    <div class="aic-options">
      ${toggleGroup('aic-objective', OBJECTIVES, s.objective ?? 'capacity')}
      <label class="aic-check copy-14"><input type="checkbox" class="switch" data-aic="fractions" ${!!s.fractions ? 'checked' : ''} />Fractions of facilities</label>
    </div>
  </div></section>`;
}

function sitesCards(data: AicData, s: AicSettings, input: PlanInput): Html {
  const levels = s.levels ?? {};
  const valley = data.regions.find((r) => r.transfer);
  return html`${data.regions.map((r) => {
      const level = levels[r.id] ?? 1;
      const nodes = nodeItems(data, r.modes);
      return html`<section class="card"><div class="card-body aic-card">
        <div class="aic-region-head">
          <h2 class="heading-16">${r.name}</h2>
          <label class="aic-check copy-14">Regional Development
            <select class="input aic-level" data-aic="level" data-region="${r.id}">${Array.from({ length: r.levels }, (_, i) => html`<option value="${i + 1}" ${level === i + 1 ? 'selected' : ''}>${i + 1}</option>`)}</select>
          </label>
        </div>
        <div class="table-wrap"><table class="table aic-sites">
          <thead><tr><th>Area</th><th class="num">Protocol Capacity</th>${nodes.map((n) => html`<th class="num" data-tip="${tip(`${data.items[n].name} nodes`, [tipNote(n === WATER ? 'Blank: no limit.' : 'Blank: the area’s own.')])}">${data.items[n].name}</th>`)}</tr></thead>
          <tbody>${r.areas.map((a) => {
            const site = s.sites?.[a.id];
            return html`<tr class="${site ? '' : 'off'}">
              <td><label class="aic-check"><input type="checkbox" class="check" data-aic="site" data-area="${a.id}" ${!!site ? 'checked' : ''} />${a.name}</label></td>
              <td class="num">${site
                ? html`<input class="input aic-num" type="number" min="0" data-aic="capacity" data-area="${a.id}" value="${site.capacity ?? ''}" placeholder="${areaCapacity(r, a.id, level)}" aria-label="Protocol Capacity" />`
                : html`<span class="secondary">${areaCapacity(r, a.id, level)}</span>`}</td>
              ${nodes.map((n) =>
                html`<td class="num">${site ? html`<input class="input aic-num" type="number" min="0" data-aic="node" data-area="${a.id}" data-item="${n}" value="${site.nodes?.[n] ?? ''}" placeholder="${n === WATER ? 'any' : (areaNodes(r, a.id)[n] ?? 0)}" aria-label="${data.items[n].name} nodes" />` : ''}</td>`,
              )}
            </tr>`;
          })}</tbody>
        </table></div>
      </div></section>`;
    })}
    <section class="card"><div class="card-body aic-card">
      <h2 class="heading-16">Power and transfer</h2>
      <label class="aic-check copy-14"><input type="checkbox" class="switch" data-aic="power" ${input.power ? 'checked' : ''} />Keep each region within its power</label>
      ${input.power
        ? html`<div class="aic-fuels copy-14"><span class="secondary">Thermal Banks may burn</span>${Object.keys(data.fuels).map(
            (f) => html`<label class="aic-check"><input type="checkbox" class="check" data-aic="fuel" data-item="${f}" ${input.fuels.includes(f) ? 'checked' : ''} />${itemName(data.items[f]?.name ?? f)}</label>`,
          )}</div>`
        : ''}
      ${valley?.transfer
        ? (levels[valley.id] ?? 1) >= valley.transfer.perHour.findIndex((n) => n > 0) + 1
          ? html`<label class="aic-check copy-14">Regional Transfer from ${valley.name}
              <input class="input aic-num" type="number" min="0" data-aic="transfer" value="${s.transfer ?? ''}" placeholder="${valley.transfer.perHour[(levels[valley.id] ?? 1) - 1]}" />items an hour</label>`
          : html`<p class="copy-13 secondary">Regional Transfer opens at ${valley.name} Regional Development ${valley.transfer.perHour.findIndex((n) => n > 0) + 1}.</p>`
        : ''}
    </div></section>`;
}

export function aicPage(redraw: () => void): Html {
  const file = wikiFile<AicData>('planner.json', redraw, 'aic');
  const s = settings();
  view = s.view === 'sites' ? 'Multi-site' : 'Calculator';
  const header = pageHeader('AIC planner', 'What to build for the items you want, from the game’s own recipes.');
  if (!file.data)
    return html`${header}<main class="container fade-in"><p class="copy-14 secondary">${file.failed ? 'Couldn’t load the recipes. Try again later.' : 'Loading recipes…'}</p></main>`;
  const data = (loaded = file.data);
  const base = inputOf(data, s, view, SECONDS);
  const key = JSON.stringify(base);
  const input = searchLonger === key ? { ...base, seconds: LONGER } : base;
  solve(data, input, searchLonger === key ? `${key}+` : key, redraw);
  const shownKey = searchLonger === key ? `${key}+` : key;
  return html`<main class="container fade-in">
      <div class="collection-layout">
        ${header}
        ${subTabs('aic-view', VIEWS, view, (v) => (v === 'Multi-site' ? String(Object.keys(s.sites ?? {}).length || '') : ''))}
        <div class="min0 collection-panes aic-panes">
          ${targetsCard(data, s, input)}
          ${view === 'Multi-site' ? sitesCards(data, s, input) : ''}
          ${results(data, input, shownKey)}
        </div>
      </div>
      <p class="copy-13 secondary aic-credit">Game data © Gryphline / Hypergryph. Solved in this browser with HiGHS.</p>
    </main>`;
}
