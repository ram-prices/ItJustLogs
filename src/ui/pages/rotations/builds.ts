import { artificeOf, artificeState, artificeTops, GEAR_SLOTS, type Loadout } from '../../../domain/loadout';
import { statArtifice } from '../../../domain/sim/build';
import { CHECKED, enemyById, FOODS, type SimBuild, type SimMember } from '../../../domain/sim/team';
import { wikiId } from '../../../domain/wiki';
import { state } from '../../../state';
import { cachedBannerDb } from '../../../store';
import { artificeIcon, badge, essenceIcon, gearArtificeIcon, icon, iconOf, itemImg, slotIcon } from '../../components';
import { html, type Html } from '../../html';
import { infoHref, ownedOf } from '../info';
import { gearStats, weaponRanksFor } from '../loadout';
import { type CombatIndex, page, settings, type Wiki } from './state';

/** The page's fields. True if it was one of theirs. */
/**
 * A parsed run's loadout changed while it's edited (levelsEdit, weaponLine, the Artifice buttons): kept in the draft,
 * played with the transcript (Play edited transcript). Nothing replays or redraws per change.
 */
export function editBuild(k: number, name: string, v: number | undefined): void {
  const nb = page.draft?.builds[k];
  if (!nb) return;
  // The defaults (level 90, rank 12) are left unset; promotion follows from them (promotionOf).
  if (name === 'level') nb.level = v === 90 ? undefined : v;
  else if (name === 'potential') nb.potential = v ?? 0;
  else if (name === 'basic' || name === 'normal' || name === 'combo' || name === 'ultimate') {
    const ranks = { ...(nb.ranks ?? {}), [name]: v };
    if (v === undefined || v === 12) delete ranks[name];
    nb.ranks = Object.keys(ranks).length ? ranks : undefined;
  } else if (nb.weapon && name === 'wlevel') nb.weapon.level = v === 90 ? undefined : v;
  else if (nb.weapon && name === 'wpotential') nb.weapon.potential = v ?? 0;
  else if (/^art\d+:\d$/.test(name)) {
    // One stat's Artifice ("art<piece>:<stat>"): the piece's levels as a list from then on.
    const [k, x] = name.slice(3).split(':').map(Number);
    const g = nb.gear[k];
    if (g) {
      const levels = Array.from({ length: page.wikiNow?.gear[g.id]?.stats.length ?? 3 }, (_, y) => statArtifice(g.artifice, y));
      levels[x] = v ?? 0;
      g.artifice = levels;
    }
  }
  else if (nb.weapon && /^rank\d$/.test(name)) {
    // A skill's rank as shown: its level, plus the weapon's Potential on the last skill. At its cap: maxed (unset).
    const caps = essenceCaps(nb);
    const x = Number(name[4]);
    const level = v === undefined ? caps[x] : Math.max(1, Math.min(caps[x], v - (x === caps.length - 1 ? (nb.weapon.potential ?? 0) : 0)));
    const levels = caps.map((_, y) => nb.weapon!.skillLevels?.[y] ?? null) as (number | null)[];
    levels[x] = level === caps[x] ? null : level;
    nb.weapon.skillLevels = levels.every((y) => y === null) ? undefined : (levels.map((y, z) => y ?? caps[z]) as number[]);
  }
  for (const key of ['level', 'ranks'] as const) if (nb[key] === undefined) delete nb[key];
  if (nb.weapon) for (const key of ['level', 'skillLevels'] as const) if (nb.weapon[key] === undefined) delete nb.weapon[key];
}

const loadoutOf = (op: string): Loadout | undefined => state.settings.loadouts?.[op] ?? Object.entries(state.settings.loadouts ?? {}).find(([id]) => wikiId(id) === op)?.[1];

/** An operator's build from their loadout and copies (the member's Potentials when set), or why there's none. */
export function buildOf(m: SimMember, wiki: Wiki, index: CombatIndex): { build: SimBuild; missing: string[] } {
  const a = state.analysis;
  const owned = ownedOf(a, 'char')?.get(m.op) ?? ownedOf(a, 'char')?.get(Object.keys(state.settings.loadouts ?? {}).find((id) => wikiId(id) === m.op) ?? '');
  const potential = m.potential ?? Math.max(0, owned?.potential ?? 0);
  const l = loadoutOf(m.op) ?? {};
  const missing: string[] = [];
  let weapon: SimBuild['weapon'];
  if (!l.weapon) missing.push('weapon');
  else if (!index.weapons.includes(l.weapon)) missing.push('weapon data');
  else {
    const w = wiki.weapons[l.weapon];
    const mine = ownedOf(a, 'weap')?.get(l.weapon);
    const wp = m.weaponPotential ?? (mine?.copies ? mine.potential : 0);
    weapon = { id: l.weapon, potential: wp, skillLevels: w ? weaponRanksFor(l.weapon, w, wp) : undefined };
  }
  const gear = GEAR_SLOTS.flatMap(({ slot }) => {
    const id = l[slot];
    const g = id ? wiki.gear[id] : undefined;
    return id && g ? [{ id, artifice: artificeOf(l, slot, g) }] : [];
  });
  if (gear.length < GEAR_SLOTS.length) missing.push(`${GEAR_SLOTS.length - gear.length} gear`);
  return { build: { op: m.op, potential, weapon, gear, ...(m.food ? { food: m.food } : {}) }, missing };
}

/** Weapons of the operator's type that have combat data (4★ and up), best rarity first. */
export const weaponsFor = (op: string, wiki: Wiki, index: CombatIndex): string[] =>
  index.weapons
    .filter((id) => wiki.weapons[id]?.type === wiki.ops[op]?.weapon && wiki.weapons[id].rarity >= 4)
    .sort((a, b) => wiki.weapons[b].rarity - wiki.weapons[a].rarity || wiki.weapons[a].name.localeCompare(wiki.weapons[b].name));

/** Optimal gear: the weapon asked for (or none: the best found), Maxed Essence; the loadout's gear as where the search starts. */
export function optimalBuildOf(m: SimMember, mine: SimBuild): SimBuild {
  return { op: m.op, potential: mine.potential, weapon: m.weapon ? { id: m.weapon, potential: m.weaponPotential ?? 0 } : { id: '', potential: m.weaponPotential ?? 0 }, gear: mine.gear, ...(m.food ? { food: m.food } : {}) };
}

/**
 * Each limited operator's signature weapon: the Arsenal Issue that ran with their banner (special_<n> with
 * weponbox_<n>: Winter Hunt's Typhoeus with Deep Cold Issue's Umbra of Frigid Eventide).
 */
export function signatureWeapons(): Record<string, string> {
  const db = cachedBannerDb();
  const out: Record<string, string> = {};
  for (const [pool, b] of Object.entries(db)) {
    if (!pool.startsWith('special_')) continue;
    const weapon = db[`weponbox_${pool.slice('special_'.length)}`]?.rateUpIds?.find((id) => id.startsWith('wpn_'));
    if (weapon) for (const op of b.rateUpIds ?? []) if (op.startsWith('chr_')) out[op] = weapon;
  }
  return out;
}

/** Weapons only Arsenal Issues give: their rate-ups (weponbox_ pools; weaponbox_constant_ is the standard pool). */
export const limitedWeapons = (): string[] =>
  [...new Set(Object.entries(cachedBannerDb()).flatMap(([pool, b]) => (pool.startsWith('weponbox_') ? (b.rateUpIds ?? []).filter((id) => id.startsWith('wpn_')) : [])))].sort();

/**
 * The operators to pick from, one per name: the Endministrator's two appearances (chr_0002_endminm,
 * chr_0003_endminf) are one operator. The one picked or with a loadout stands for the name.
 */
export function pickable(wiki: Wiki, index: CombatIndex, team: SimMember[]): string[] {
  const byName = new Map<string, string>();
  for (const id of index.ops.filter((x) => wiki.ops[x])) {
    const name = wiki.ops[id].name;
    const have = byName.get(name);
    const preferred = (x: string) => team.some((m) => m.op === x) || !!loadoutOf(x);
    if (!have || (!preferred(have) && preferred(id))) byName.set(name, id);
  }
  return [...byName.values()].sort((x, y) => wiki.ops[x].name.localeCompare(wiki.ops[y].name));
}

export function memberCard(m: SimMember, i: number, n: number, wiki: Wiki, index: CombatIndex, build: SimBuild, optimal: boolean, chosen: SimBuild | undefined, team: SimMember[]): Html {
  const o = wiki.ops[m.op];
  const ops = pickable(wiki, index, team);
  // An operator can be in the team once: the others' picks are greyed out here.
  const taken = new Set(team.filter((_, j) => j !== i).map((x) => wiki.ops[x.op]?.name));
  const l = loadoutOf(m.op) ?? {};
  const options = (current: number, field: string) =>
    html`<select class="input sim-p" data-sim="${field}" data-i="${i}" aria-label="Potential">${[0, 1, 2, 3, 4, 5].map((p) => html`<option value="${p}" ${p === current ? 'selected' : ''}>P${p}</option>`)}</select>`;
  return html`<div class="sim-member">
    <div class="sim-member-head">
      <span class="label-12 secondary">Position ${i + 1}</span>
      <span class="sim-move">
        <button type="button" class="btn tertiary sm icon-btn" data-action="sim-up" data-value="${i}" ${i === 0 ? 'disabled' : ''} title="Earlier position" aria-label="Earlier position">${icon('arrow_upward')}</button>
        <button type="button" class="btn tertiary sm icon-btn" data-action="sim-down" data-value="${i}" ${i === n - 1 ? 'disabled' : ''} title="Later position" aria-label="Later position">${icon('arrow_downward')}</button>
      </span>
    </div>
    <div class="sim-op">
      <a class="sim-op-link" href="${infoHref('char', m.op)}" title="${o ? `${o.name}’s page` : ''}" aria-label="${o ? `${o.name}’s page` : 'Operator page'}">${itemImg('char', m.op, 'sim-portrait')}</a>
      <select class="input" data-sim="op" data-i="${i}" aria-label="Operator">${ops.map((id) => html`<option value="${id}" ${id === m.op ? 'selected' : ''} ${taken.has(wiki.ops[id].name) ? 'disabled' : ''}>${wiki.ops[id].name}</option>`)}</select>
    </div>
    <div class="sim-pots">
      <label class="label-12 secondary">Potential ${options(build.potential, 'potential')}</label>
      ${build.weapon ? html`<label class="label-12 secondary">Weapon ${options(build.weapon.potential, 'wpotential')}</label>` : ''}
      ${foodPicker(m.food, enemyById(settings().enemy).enemy.food !== false, html`data-sim="food" data-i="${i}"`)}
    </div>
    ${CHECKED.includes(m.op) ? '' : html`<span class="sim-unchecked">${badge('Not checked yet', 'amber')}</span>`}
    ${optimal
      ? html`<div class="sim-gear copy-13">
          <select class="input" data-sim="weapon" data-i="${i}" aria-label="Weapon">
            <option value="" ${m.weapon ? '' : 'selected'}>Best weapon found</option>
            ${weaponsFor(m.op, wiki, index).map((id) => html`<option value="${id}" ${id === m.weapon ? 'selected' : ''}>${wiki.weapons[id].name}</option>`)}
          </select>
          ${chosen ? buildLines(chosen, wiki) : html`<span class="secondary">Weapon and gear are chosen when it runs: Maxed Essence, gear at its top Artifice.</span>`}`
      : html`<div class="sim-gear copy-13">`}
      ${optimal ? '' : build.weapon ? weaponLine(build.weapon, wiki) : ''}
      ${optimal ? '' : GEAR_SLOTS.map(({ slot, type, label }) => {
        const id = l[slot];
        const g = id ? wiki.gear[id] : undefined;
        return g ? gearLine(id!, artificeOf(l, slot, g), `${m.op}:${slot}`, wiki) : html`<div class="sim-piece secondary">${slotIcon(type)}No ${label.toLowerCase()}</div>`;
      })}
    </div>
  </div>`;
}

/**
 * A weapon as a line like the gear's: its own picture, its name in the text's colour, and its essence: the essence
 * icon in green for Maxed Essence (no skill levels set: each at its cap), dim with its ranks otherwise.
 */
function weaponLine(weapon: NonNullable<SimBuild['weapon']>, wiki: Wiki, edit?: number): Html {
  const w = wiki.weapons[weapon.id];
  const mark = itemImg('weap', weapon.id, 'sim-weapon-mark');
  const b = { weapon } as SimBuild;
  if (edit !== undefined) {
    // While a parsed run is edited: Potential, level and each skill's rank as fields in place, then the icon.
    const caps = essenceCaps(b);
    const ranks = skillRanks(b);
    const maxed = !weapon.skillLevels?.some((x) => x !== null && x !== undefined);
    return html`<div class="sim-piece sim-weapon-line">${mark}<a class="sim-weapon-name min0 ellipsis" href="${infoHref('weap', weapon.id)}" title="${w?.name ?? weapon.id}’s page">${w?.name ?? weapon.id}</a><span class="sim-weapon-end secondary num">P${inl(edit, 'wpotential', weapon.potential, 0, 5, 'Weapon Potential')} Lv ${inl(edit, 'wlevel', weapon.level ?? 90, 1, 90, 'Weapon level')}
      <span>${caps.map((cap, k) => html`${k ? '/' : ''}${inl(edit, `rank${k}`, ranks[k], 1, cap + (k === caps.length - 1 ? (weapon.potential ?? 0) : 0), `Skill ${k + 1} rank`)}`)}</span>${noEssence(b) ? '' : html`<span class="${maxed ? 'essence-max' : 'essence-off'}">${essenceIcon()}</span>`}</span></div>`;
  }
  // At the right: its level when not 90, then its essence: maxed, the icon green; otherwise its skill ranks, then the
  // icon dim (none with no essence).
  const ranks = skillRanks(b).join('/');
  const essence = noEssence(b)
    ? html`<span class="sim-weapon-ranks secondary num" title="Skill ranks">${ranks}</span>`
    : !weapon.skillLevels?.some((x) => x !== null && x !== undefined)
      ? html`<span class="essence-max">${essenceIcon()}</span>`
      : html`<span class="sim-weapon-ranks secondary num" title="Skill ranks">${ranks}</span><span class="essence-off">${essenceIcon(`Not maxed: skill ranks ${ranks}`)}</span>`;
  const level = weapon.level && weapon.level !== 90 ? html`<span class="sim-weapon-ranks secondary num">Lv ${weapon.level}</span>` : '';
  return html`<div class="sim-piece sim-weapon-line">${mark}<a class="sim-weapon-name min0 ellipsis" href="${infoHref('weap', weapon.id)}" title="${w?.name ?? weapon.id}’s page">${w?.name ?? weapon.id}</a><span class="sim-weapon-end">${level}${essence}</span></div>`;
}

/** A number in a parsed run's loadout while it's edited, as a field in place of the text (`runbuild`). */
export function inl(i: number, name: string, value: number | null | undefined, min: number, max: number, label: string): Html {
  return html`<input class="sim-inl num" type="number" min="${min}" max="${max}" value="${value ?? ''}" style="--d:${String(max).length}" data-sim="runbuild" data-i="${i}" data-field="${name}" aria-label="${label}" title="${label}" />`;
}

/** A box's top row while its run is edited (the name gives way): level and the four skill ranks as fields. */
export function levelsEdit(i: number, b: SimBuild): Html {
  const r = b.ranks ?? {};
  const kinds = [['basic', 'Basic attack'], ['normal', 'Battle skill'], ['combo', 'Combo skill'], ['ultimate', 'Ultimate']] as const;
  return html`<span class="label-12 secondary num sim-op-levels">Lv ${inl(i, 'level', b.level ?? 90, 1, 90, 'Level')} · ${kinds.map(([k, label], n) => html`${n ? '/' : ''}${inl(i, k, r[k] ?? 12, 1, 12, `${label} rank`)}`)}</span>`;
}

/** An operator's level and skill ranks when not maxed (90; 12 each), for the top right of their box. */
export function levelsLine(b: SimBuild): string {
  const r = b.ranks ?? {};
  return [
    b.level && b.level !== 90 ? `Lv ${b.level}` : '',
    b.ranks ? (['basic', 'normal', 'combo', 'ultimate'] as const).map((k) => r[k] ?? 12).join('/') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A parsed run's food, a sixth line under the gear's: its item icon and name, or none. While the run is edited a choice
 * in place (`runfood`, kept in the draft). Only where the stage allows food (Enemy.food).
 */
export function foodLine(b: SimBuild, edit?: number): Html {
  const name = b.food ? FOODS[b.food]?.name : undefined;
  const src = name ? iconOf('items', name.replace(/’/g, "'")) : null;
  const mark = src ? html`<img class="sim-food-mark" src="${src}" alt="" />` : html`<span class="sim-food-mark">${icon('restaurant')}</span>`;
  return html`<div class="sim-piece sim-food-line${name ? '' : ' secondary'}">${mark}${edit === undefined
    ? html`<span class="min0 ellipsis">${name ?? 'No food'}</span>`
    : html`<select class="sim-inl-sel" data-sim="runfood" data-i="${edit}" aria-label="Food">
        <option value="" ${b.food ? '' : 'selected'}>No food</option>
        ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === b.food ? 'selected' : ''}>${f.name}</option>`)}
      </select>`}</div>`;
}

/** A food picker (`attrs`: its data-* attributes), or why there's none: the stage allows no food (Enemy.food). */
export function foodPicker(value: string | undefined, allowed: boolean, attrs: Html): Html {
  // A stage without food (its rules show in the review) takes no line.
  if (!allowed) return html``;
  return html`<label class="label-12 secondary">Food <select class="input sim-food" ${attrs} aria-label="Food">
    <option value="" ${value ? '' : 'selected'}>None</option>
    ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === value ? 'selected' : ''}>${f.name}</option>`)}
  </select></label>`;
}

/**
 * A weapon's skill level caps before Potential (the game data's: 9/9/4 for a three-skill weapon, 9/4 for a two-skill
 * one; an essence rank is the level less one, so 0–8/0–8/0–3) and each skill's rank in the sim: its level (the cap unless
 * set) plus, on the last skill, the weapon's Potential (+1 a level, as every weapon's potentialLevels has it).
 */
function essenceCaps(b: SimBuild): number[] {
  const n = (b.weapon && page.wikiNow?.weapons[b.weapon.id]?.skills.length) || 3;
  return n === 2 ? [9, 4] : [9, 9, 4];
}
function skillRanks(b: SimBuild): number[] {
  const caps = essenceCaps(b);
  return caps.map((cap, k) => (b.weapon?.skillLevels?.[k] ?? cap) + (k === caps.length - 1 ? (b.weapon?.potential ?? 0) : 0));
}

/** A weapon with no essence etched: each skill at level 1 (its Potential still adds to them, in build.ts). */
const noEssence = (b: SimBuild): boolean => !!b.weapon?.skillLevels && b.weapon.skillLevels.length === 3 && b.weapon.skillLevels.every((x) => x === 1);

/** A build's weapon and gear, as lines. */
export function buildLines(b: SimBuild, wiki: Wiki, edit?: number): Html {
  return html`${b.weapon?.id ? weaponLine(b.weapon, wiki, edit) : ''}
    ${b.gear.map((g, k) => gearLine(g.id, g.artifice, `${b.op}:${k}`, wiki, edit === undefined ? undefined : `${edit}:${k}`))}`;
}

/** Gear lines opened to their stats, by `data-gear-key`, so they stay open through redraws (and Edit). */
const openGear = new Set<string>();
if (typeof document !== 'undefined')
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      const key = d.dataset?.gearKey;
      if (key) (d.open ? openGear.add(key) : openGear.delete(key));
    },
    true,
  );

/**
 * A gear piece as a line: its slot mark, name and own Artifice mark (empty, half or full: `artificeState`); a click opens
 * its stats under it, each with its Artifice mark and "+base » +artificed" (`gearStats`). While a parsed run is edited
 * (`edit`: "<build>:<piece>") each stat's mark is a button: a click steps it 0 → 3 and round (`sim-art`).
 */
export function gearLine(id: string, artifice: number | number[] | undefined, key: string, wiki: Wiki, edit?: string): Html {
  const g = wiki.gear[id];
  if (!g) return html`<div class="sim-piece secondary">${slotIcon('')}<span class="min0 ellipsis">${id}</span></div>`;
  const tops = artificeTops(g);
  const levels = tops.map((top, i) => Math.min(top, statArtifice(artifice, i)));
  const mark = artificeState(levels, tops);
  return html`<details class="sim-gear-d" data-gear-key="${key}" ${openGear.has(key) ? 'open' : ''}>
    <summary class="sim-piece secondary">${slotIcon(g.type)}<span class="min0 ellipsis">${g.name}</span>${mark ? gearArtificeIcon(mark) : ''}</summary>
    ${gearStats(g, levels, (i, lv) =>
      edit === undefined
        ? artificeIcon(lv)
        : html`<button type="button" class="sim-art-btn" data-action="sim-art" data-value="${edit}:${i}" title="Artifice ${lv}: click to change">${artificeIcon(lv)}</button>`,
    )}
  </details>`;
}
