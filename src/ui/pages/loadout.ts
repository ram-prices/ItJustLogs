import type { Analysis } from '../../domain/analyze';
import { gearIconUrl } from '../../domain/banners';
import { GEAR_SLOTS, SET_PIECES, artificeOf, artificeState, artificeTops, atkTotal, hpTotal, isLoadoutSlot, withArtifice, type GearSlot, operatorBonuses, setCounts, weaponBaseRanks, weaponRankCaps, wieldersOf, withSlot, type Bonus, type Loadout, type LoadoutSlot } from '../../domain/loadout';
import type { WikiGear, WikiGearFile, WikiOperator, WikiOperatorFile, WikiWeapon, WikiWeaponFile } from '../../domain/wiki';
import { state, updateSettings } from '../../state';
import { artificeIcon, badge, essenceIcon, gearArtificeIcon, icon, itemImg, rarityArt, slotIcon, tileArt, weaponTypeIcon } from '../components';
import { html, raw, render, type Html } from '../html';
import { infoHref, ownedOf, rich, wikiFile } from './info';

/**
 * Loadouts: the weapon and gear the player has on each operator, picked on
 * the operator's page and saved in settings (so backups and Drive sync carry
 * them). Weapon pages list the operators using that weapon.
 */

const gearImg = (id: string, cls = 'item-icon'): Html =>
  html`<img class="${cls} gear" src="${gearIconUrl(id)}" alt="" loading="lazy" decoding="async" data-fallback />`;

const loadoutOf = (opId: string): Loadout | undefined => state.settings.loadouts?.[opId];

function save(opId: string, slot: LoadoutSlot, id: string | null): void {
  const all = { ...state.settings.loadouts };
  const next = withSlot(all[opId], slot, id);
  if (next) all[opId] = next;
  else delete all[opId];
  updateSettings({ loadouts: all });
}

/**
 * The gear stats as one short line: "Strength +87 · Ultimate Gain Efficiency +12.3%".
 * The wiki data gives percentages as fractions (0.123 = 12.3%) and flat stats as
 * numbers from 1 up, the same rule operatorBonuses counts them by.
 */
function statLine(g: WikiGear): string {
  return g.stats
    .map((s) => {
      const v = s.values[0];
      const shown = v == null ? '' : v < 1 ? `+${Math.round(v * 1000) / 10}%` : `+${v.toLocaleString()}`;
      return `${s.stat} ${shown}`.trim();
    })
    .join(' · ');
}

/** One slot: a button that opens the picker, plus a link to a weapon's page. */
function slotTile(
  opId: string,
  slot: LoadoutSlot,
  label: string,
  filled: { img: Html; name: string; sub: Html | string; href?: string; extra?: Html } | null,
  mark?: Html,
): Html {
  return html`<div class="loadout-slot${filled ? '' : ' vacant'}${filled?.extra ? ' has-extra' : ''}">
    <button type="button" class="loadout-pick" data-action="loadout-pick" data-op="${opId}" data-slot="${slot}" aria-label="${filled ? `${label}: ${filled.name}. Change` : `Choose ${label.toLowerCase()}`}">
      <span class="loadout-icon">${filled ? filled.img : (mark ?? icon('add'))}</span>
      <span class="loadout-text min0">
        <span class="loadout-label">${mark ?? ''}${label}</span>
        <span class="loadout-name ellipsis">${filled ? filled.name : 'Empty'}</span>
        ${filled ? html`<span class="loadout-sub ellipsis">${filled.sub}</span>` : ''}
      </span>
    </button>
    ${filled?.href ? html`<a class="loadout-link" href="${filled.href}" aria-label="${filled.name} info" title="${filled.name} info">${icon('link')}</a>` : ''}
    ${filled?.extra ?? ''}
  </div>`;
}

/**
 * Whether this weapon has Maxed Essence (off by default): marked so, or
 * with every skill set to the highest rank it can reach (`caps`).
 */
export const isMaxEssence = (wpnId: string, caps?: number[]): boolean => {
  if (state.settings.maxEssence?.includes(wpnId)) return true;
  const r = weaponRanksOf(wpnId);
  return !!(r && caps?.length && caps.every((c, i) => (r[i] ?? 0) >= c));
};

/** The skill ranks the player set on the weapon's page (none: no essence, weaponBaseRanks). */
export const weaponRanksOf = (wpnId: string): number[] | undefined => state.settings.weaponRanks?.[wpnId];

/** The ranks a weapon's skills count at: unset (each at its cap) when maxed, else the player's or no essence. */
export const weaponRanksFor = (wpnId: string, w: WikiWeapon, potential: number | null): number[] | undefined =>
  isMaxEssence(wpnId, weaponRankCaps(w, potential)) ? undefined : (weaponRanksOf(wpnId) ?? weaponBaseRanks(w, potential));

/**
 * Maxed Essence on or off. Ranks set while it was off are kept for when it's
 * off again, except ranks already at `caps` (they'd keep it maxed): turning
 * it off then goes back to no essence.
 */
export function setMaxEssence(wpnId: string, on: boolean, caps: number[] = []): void {
  const list = (state.settings.maxEssence ?? []).filter((id) => id !== wpnId);
  const ranks = { ...state.settings.weaponRanks };
  if (!on && isMaxEssence(wpnId, caps) && !state.settings.maxEssence?.includes(wpnId)) delete ranks[wpnId];
  updateSettings({ maxEssence: on ? [...list, wpnId] : list.length ? list : undefined, weaponRanks: Object.keys(ranks).length ? ranks : undefined });
}

const sameRanks = (a: number[], b: number[]) => a.length === b.length && a.every((r, i) => r === b[i]);

/**
 * One weapon skill's rank as the player built it (`base`: the ranks without
 * essence, where it starts if none are set yet). Ranks back at `base` are
 * forgotten: that's the default.
 */
export function setWeaponRank(wpnId: string, i: number, rank: number, base: number[]): void {
  const next = [...(weaponRanksOf(wpnId) ?? base)];
  next[i] = Math.max(1, Math.floor(rank));
  const all = { ...state.settings.weaponRanks, [wpnId]: next };
  if (sameRanks(next, base)) delete all[wpnId];
  updateSettings({ weaponRanks: Object.keys(all).length ? all : undefined });
}

/**
 * How the player built a weapon: the green essence icon for Maxed Essence,
 * "Ranks 5 · 9 · 4" if they set ranks, else (no essence, the default) nothing.
 */
export const essenceTag = (wpnId: string, w?: WikiWeapon, potential: number | null = null): Html | null => {
  if (isMaxEssence(wpnId, w ? weaponRankCaps(w, potential) : undefined)) return html`<span class="essence-max">${essenceIcon()}</span>`;
  const r = weaponRanksOf(wpnId);
  if (r && w && sameRanks(r, weaponBaseRanks(w, potential))) return null;
  return r ? html`<span class="essence-part">Ranks ${r.join(' · ')}</span>` : null;
};

/** A gear stat's value as the game writes it: "+32", fractions as percents ("+41.4%"). */
export const gearValue = (v: number | undefined): string => (v == null ? '' : v < 1 ? `+${Math.round(v * 1000) / 10}%` : `+${v.toLocaleString()}`);

/**
 * A gear piece's stats as the game lists them: each one's Artifice mark (`mark`: the mark, or a control over it; none
 * on a stat that can't be artificed), its name and its value, "+32 » +38" once artificed (base, then what it counts at).
 */
export function gearStats(g: WikiGear, levels: number[], mark: (i: number, level: number) => Html): Html {
  const tops = artificeTops(g);
  return html`<div class="gear-stats">${g.stats.map((s, i) => {
    const lv = levels[i] ?? 0;
    return html`<div class="gear-stat">${tops[i] ? mark(i, lv) : ''}<span class="min0 ellipsis">${s.stat}</span><span class="gear-stat-val num">${gearValue(s.values[0])}${lv ? html`<span class="gear-stat-art"> » ${gearValue(s.values[lv])}</span>` : ''}</span></div>`;
  })}</div>`;
}

/** A gear slot's stats, each with its Artifice level picker (the mark, a select over it), and the piece's own mark. */
function artificePicker(opId: string, slot: GearSlot, l: Loadout, g: WikiGear): Html {
  const tops = artificeTops(g);
  const levels = artificeOf(l, slot, g);
  const mark = artificeState(levels, tops);
  return html`${mark ? html`<span class="loadout-artifice">${gearArtificeIcon(mark)}</span>` : ''}${gearStats(
    g,
    levels,
    (i, at) => html`<span class="gear-art-pick" title="Artifice ${at}">${artificeIcon(at)}<select data-artifice-op="${opId}" data-artifice-slot="${slot}" data-artifice-stat="${i}" aria-label="${g.stats[i].stat} Artifice level">
      ${Array.from({ length: tops[i] + 1 }, (_, k) => html`<option value="${k}" ${raw(k === at ? 'selected' : '')}>Artifice ${k}</option>`)}
    </select></span>`,
  )}`;
}

/** Sets one stat's Artifice level on a gear slot (null: the whole piece back to the highest). */
export function setArtifice(opId: string, slot: string, stat: number, level: number | null): void {
  const id = state.settings.loadouts?.[opId]?.[slot as GearSlot];
  const g = id ? wikiFile<WikiGearFile>('gear.json', () => {}).data?.gear.items[id] : undefined;
  if (!GEAR_SLOTS.some((x) => x.slot === slot) || !g) return;
  const all = { ...state.settings.loadouts };
  const next = withArtifice(all[opId], slot as GearSlot, g, stat, level);
  if (next) all[opId] = next;
  else delete all[opId];
  updateSettings({ loadouts: all });
}

/** The Loadout section of an operator's page. */
export function loadoutSection(opId: string, a: Analysis | null, redraw: () => void, weaponType?: string): Html {
  const weps = wikiFile<WikiWeaponFile>('weapons.json', redraw).data;
  const gear = wikiFile<WikiGearFile>('gear.json', redraw).data;
  const l = loadoutOf(opId) ?? {};
  const ownedWeps = ownedOf(a, 'weap');

  const w = l.weapon ? weps?.weapons[l.weapon] : undefined;
  const wp = l.weapon && ownedWeps?.get(l.weapon)?.copies ? ownedWeps.get(l.weapon)!.potential : null;
  const tag = l.weapon ? essenceTag(l.weapon, w, wp) : null;
  const weaponTile = slotTile(
    opId,
    'weapon',
    'Weapon',
    l.weapon
      ? {
          img: w ? rarityArt(itemImg('weap', l.weapon), w.rarity) : itemImg('weap', l.weapon),
          name: w?.name ?? l.weapon,
          sub: html`${[ownedWeps?.get(l.weapon)?.copies ? `P${ownedWeps.get(l.weapon)!.potential}` : '', tag ?? ''].filter(Boolean).map((x, i) => html`${i ? ' · ' : ''}${x}`)}`,
          href: infoHref('weap', l.weapon),
        }
      : null,
    weaponType ? weaponTypeIcon(weaponType) : undefined,
  );
  const gearTiles = GEAR_SLOTS.map(({ slot, type, label }) => {
    const id = l[slot];
    const g = id ? gear?.gear.items[id] : undefined;
    return slotTile(opId, slot, label, id ? { img: g ? rarityArt(gearImg(id), g.rarity) : gearImg(id), name: g?.name ?? id, sub: g?.set ?? (g ? `Lv ${g.level}` : ''), extra: g ? artificePicker(opId, slot, l, g) : undefined } : null, slotIcon(type));
  });

  // Set effects that are on (3 pieces of one set).
  const sets = gear ? [...setCounts(l, gear.gear.items)] : [];
  const active = sets.filter(([, n]) => n >= SET_PIECES).map(([name]) => gear!.gear.sets[name]).filter(Boolean);
  const partial = sets.filter(([, n]) => n < SET_PIECES);

  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Loadout</h2>
    </div>
    <div class="card loadout">
      <div class="loadout-slots">${weaponTile}${gearTiles}</div>
      ${active.length || partial.length
        ? html`<div class="loadout-sets">
            ${active.map(
              (s) => html`<div class="loadout-set on">
                <span class="loadout-set-head">${badge(`${SET_PIECES}/${SET_PIECES}`, 'green')}<b>${s.name}</b></span>
                <p class="copy-13 secondary wiki-text">${rich(s.effect)}</p>
              </div>`,
            )}
            ${partial.map(
              ([name, n]) => html`<div class="loadout-set"><span class="loadout-set-head">${badge(`${n}/${SET_PIECES}`, 'outline')}<b>${name}</b></span></div>`,
            )}
          </div>`
        : ''}
    </div>
  </section>`;
}

/** On a weapon's page: the operators the player has given it to. */
export function wieldersSection(weaponId: string, redraw: () => void): Html {
  const ids = wieldersOf(state.settings.loadouts, weaponId);
  if (!ids.length) return html``;
  const ops = wikiFile<WikiOperatorFile>('operators.json', redraw).data;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Equipped on</h2><span class="label-13 secondary">From your loadouts</span></div>
    <div class="wiki-grid">
      ${ids.map((id) => {
        const o = ops?.operators[id];
        // Each opens that operator's page, marked with the link icon the loadout slots use.
        return html`<a class="wiki-tile card wielder" href="${infoHref('char', id)}" title="${o?.name ?? id} info">
          ${o ? tileArt('char', id, o.rarity) : itemImg('char', id, 'wiki-tile-portrait')}
          <span class="wiki-tile-text min0"><span class="wiki-tile-name ellipsis">${o?.name ?? id}</span></span>
          <span class="wielder-link" aria-hidden="true">${icon('link')}</span>
        </a>`;
      })}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

interface Option {
  id: string;
  name: string;
  img: Html;
  rarity: number;
  meta: Html | string;
  /** Lowercased text the search box matches. */
  search: string;
  /** Sorts first (owned weapons). */
  first: boolean;
}

function weaponOptions(o: WikiOperator, weps: WikiWeaponFile, a: Analysis | null): Option[] {
  const owned = ownedOf(a, 'weap');
  return Object.entries(weps.weapons)
    .filter(([, w]) => w.type === o.weapon)
    .map(([id, w]: [string, WikiWeapon]) => {
      const mine = owned?.get(id);
      const tag = w.skills[w.skills.length - 1]?.tag;
      return {
        id,
        name: w.name,
        img: itemImg('weap', id),
        rarity: w.rarity,
        meta: html`${[tag, mine?.copies ? html`<span class="wiki-em">P${mine.potential}</span>` : owned ? html`<span class="tertiary">Not owned</span>` : ''].filter(Boolean).map((x, i) => html`${i ? ' · ' : ''}${x}`)}`,
        search: `${w.name} ${tag ?? ''}`.toLowerCase(),
        first: !!mine?.copies,
      };
    });
}

function gearOptions(type: string, gear: WikiGearFile): Option[] {
  return Object.entries(gear.gear.items)
    .filter(([, g]) => g.type === type)
    .map(([id, g]) => ({
      id,
      name: g.name,
      img: gearImg(id),
      rarity: g.rarity,
      meta: html`${[g.level ? `Lv ${g.level}` : '', g.set ?? ''].filter(Boolean).join(' · ')}<br /><span class="tertiary">${statLine(g)}</span>`,
      search: `${g.name} ${g.set ?? ''} ${g.stats.map((s) => s.stat).join(' ')}`.toLowerCase(),
      first: false,
    }));
}

/**
 * Pick what goes in a slot. Resolves the chosen id, null to empty the slot,
 * or undefined if cancelled.
 */
function pick(title: string, options: Option[], current: string | undefined): Promise<string | null | undefined> {
  options.sort((x, y) => Number(y.first) - Number(x.first) || y.rarity - x.rarity || x.name.localeCompare(y.name));
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog picker-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <h2 class="heading-20" id="picker-title">${title}</h2>
      <label class="picker-search">${icon('search')}<input type="search" placeholder="Search by name, set or stat" aria-label="Search" /></label>
      <div class="picker-list" role="listbox" aria-label="${title}">
        ${options.map(
          (o) => html`<button type="button" class="picker-option${o.id === current ? ' current' : ''}" role="option" aria-selected="${String(o.id === current)}" data-pick="${o.id}" data-search="${o.search}">
            ${o.rarity ? rarityArt(o.img, o.rarity) : o.img}
            <span class="min0"><span class="picker-name ellipsis">${o.name}</span><span class="picker-meta">${o.meta}</span></span>
            ${o.id === current ? icon('check') : ''}
          </button>`,
        )}
        <p class="picker-none copy-13 secondary" hidden>Nothing matches.</p>
      </div>
      <div class="dialog-actions">
        ${current ? html`<button class="btn secondary sm picker-clear" data-choice="clear">Empty this slot</button>` : ''}
        <button class="btn secondary sm" data-choice="cancel">Cancel</button>
      </div>
    </div>`,
  );
  document.body.append(backdrop);
  const input = backdrop.querySelector<HTMLInputElement>('input')!;
  const rows = [...backdrop.querySelectorAll<HTMLElement>('[data-pick]')];
  const none = backdrop.querySelector<HTMLElement>('.picker-none')!;
  input.addEventListener('input', () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const r of rows) {
      const hit = words.every((w) => r.dataset.search!.includes(w));
      r.hidden = !hit;
      if (hit) shown++;
    }
    none.hidden = shown > 0;
  });
  return new Promise((resolve) => {
    const close = (v: string | null | undefined) => {
      backdrop.remove();
      resolve(v);
    };
    backdrop.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === backdrop) return close(undefined);
      const choice = t.closest<HTMLElement>('[data-choice]')?.dataset.choice;
      if (choice === 'cancel') return close(undefined);
      if (choice === 'clear') return close(null);
      const id = t.closest<HTMLElement>('[data-pick]')?.dataset.pick;
      if (id) close(id);
    });
    backdrop.addEventListener('keydown', (e) => e.key === 'Escape' && close(undefined));
    (backdrop.querySelector<HTMLElement>('.picker-option.current') ?? input).focus();
    backdrop.querySelector('.picker-option.current')?.scrollIntoView({ block: 'center' });
  });
}

/** The click on a slot (data-action="loadout-pick"): pick, then save. */
export async function pickLoadoutSlot(opId: string, slot: string, a: Analysis | null, redraw: () => void): Promise<void> {
  if (!isLoadoutSlot(slot)) return;
  const ops = wikiFile<WikiOperatorFile>('operators.json', redraw).data;
  const o = ops?.operators[opId];
  if (!o) return;
  const current = loadoutOf(opId)?.[slot];
  let chosen: string | null | undefined;
  if (slot === 'weapon') {
    const weps = wikiFile<WikiWeaponFile>('weapons.json', redraw).data;
    if (!weps) return;
    chosen = await pick(`${o.weapon} for ${o.name}`, weaponOptions(o, weps, a), current);
  } else {
    const gear = wikiFile<WikiGearFile>('gear.json', redraw).data;
    const g = GEAR_SLOTS.find((s) => s.slot === slot)!;
    if (!gear) return;
    chosen = await pick(`${g.label} for ${o.name}`, gearOptions(g.type, gear), current);
  }
  if (chosen === undefined || chosen === (current ?? null)) return;
  save(opId, slot, chosen);
}

/**
 * What talents, the player's Potential and their loadout add to this
 * operator's attributes, by stat (see operatorBonuses). The loadout part
 * joins once the weapon and gear data have loaded.
 */
export function bonusesFor(opId: string, o: WikiOperator, a: Analysis | null, redraw: () => void): Map<string, Bonus> {
  const me = ownedOf(a, 'char')?.get(opId);
  const potential = me?.copies ? me.potential : null;
  const l = loadoutOf(opId);
  const weps = l ? wikiFile<WikiWeaponFile>('weapons.json', redraw).data : null;
  const gear = l ? wikiFile<WikiGearFile>('gear.json', redraw).data : null;
  const w = l?.weapon ? weps?.weapons[l.weapon] : undefined;
  const mine = l?.weapon ? ownedOf(a, 'weap')?.get(l.weapon) : undefined;
  return operatorBonuses(o, {
    potential,
    loadout: weps && gear ? l : null,
    weapon: w ? { w, potential: mine?.copies ? mine.potential : null, ranks: weaponRanksFor(l!.weapon!, w, mine?.copies ? mine.potential : null) } : null,
    items: gear?.gear.items,
    sets: gear?.gear.sets,
  });
}

const fmtFlat = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString();
const fmtPct = (n: number) => `${Math.round(n * 10) / 10}%`;

/** "+87 +14.7%" after a value, with where each part comes from on hover. */
export function bonusChip(b: Bonus | undefined): Html {
  if (!b) return html``;
  const parts = [b.flat ? `+${fmtFlat(b.flat)}` : '', b.pct ? `+${fmtPct(b.pct)}` : ''].filter(Boolean).join(' ');
  const why = b.sources.map((s) => `${s.from}: ${[s.flat ? `+${fmtFlat(s.flat)}` : '', s.pct ? `+${fmtPct(s.pct)}` : ''].filter(Boolean).join(' ')}`).join('\n');
  return html`<span class="attr-bonus" title="${why}">${parts}</span>`;
}

/** The Attributes card shows totals; the Breakdown toggle splits them into base + bonuses. Kept across redraws. */
let split = false;
export const toggleBonusSplit = (): void => void (split = !split);
/** Whether Breakdown is on (also splits the combat skill tables). */
export const isSplit = (): boolean => split;

/**
 * A stat with the loadout added: the total, or (split) the base value then
 * what the loadout adds. Totals are (base + flat) × (1 + %); `additive`
 * stats (Critical rate, in %) just add the percent.
 */
export function withBonus(base: number, b: Bonus | undefined, fmt: (n: number) => string = (n) => fmtFlat(Math.trunc(n)), additive = false): Html {
  if (!b) return html`${fmt(base)}`;
  if (split) return html`${fmt(base)}${bonusChip(b)}`;
  const total = additive ? base + b.pct : (base + b.flat) * (1 + b.pct / 100);
  return html`<span class="attr-total" title="${`${fmt(base)} base, plus talents, Potentials and your loadout. Press Breakdown to see the parts.`}">${fmt(total)}</span>`;
}

/** A stat only the loadout gives (no base value): its amount, or "+amount" when split. */
export function loadoutOnly(b: Bonus): Html {
  if (split) return bonusChip(b);
  return html`<span class="attr-total">${[b.flat ? fmtFlat(b.flat) : '', b.pct ? fmtPct(b.pct) : ''].filter(Boolean).join(' + ')}</span>`;
}

/** The Attributes card's Breakdown toggle. */
export const splitToggle = (): Html =>
  html`<button type="button" class="attr-toggle" data-action="attr-split" aria-pressed="${String(split)}" title="${split ? 'Show totals' : 'Split each total into base and bonuses (talents, Potentials, loadout)'}">Breakdown</button>`;

/**
 * The ATK row: the total the game shows (see atkTotal), or (split) the
 * operator's ATK then what the loadout adds and what the attributes add.
 * Hover for the game's breakdown.
 */
export function atkValue(operatorAtk: number, b: Bonus | undefined, t: ReturnType<typeof atkTotal>, main: string | null, secondary: string | null): Html {
  const r = (n: number) => Math.round(n).toLocaleString();
  const attrs = t.fromMain + t.fromSecondary;
  const why = [
    `Base ATK ${r(t.base)} (operator ${r(operatorAtk)}${b?.flat ? ` + weapon ${r(b.flat)}` : ''})`,
    b?.pct ? `ATK bonus +${r(t.basic - t.base)} (+${fmtPct(b.pct)})` : '',
    `Basic total ${r(t.basic)}`,
    `Attribute bonuses +${fmtPct(attrs)} (${[main ? `${main} +${fmtPct(t.fromMain)}` : '', secondary ? `${secondary} +${fmtPct(t.fromSecondary)}` : ''].filter(Boolean).join(', ')})`,
  ]
    .filter(Boolean)
    .join('\n');
  if (split) return html`${r(operatorAtk)}${bonusChip(b)}<span class="attr-bonus" title="${why}">+${fmtPct(attrs)} attributes</span>`;
  return html`<span class="attr-total" title="${why}">${r(t.total)}</span>`;
}

/** The HP row: the game's total (see hpTotal), or (split) operator HP then what's added. Hover for the breakdown. */
export function hpValue(operatorHp: number, b: Bonus | undefined, t: ReturnType<typeof hpTotal>): Html {
  const r = (n: number) => Math.round(n).toLocaleString();
  const why = [
    `Base HP ${r(t.base)} (operator ${r(operatorHp)} + ${r(t.fromStrength)} from Strength)`,
    t.others ? `Others +${r(t.others)}` : '',
    b?.pct ? `HP bonus +${fmtPct(b.pct)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (split) return html`${r(operatorHp)}<span class="attr-bonus" title="${why}">+${r(t.fromStrength)} Strength</span>${bonusChip(b)}`;
  return html`<span class="attr-total" title="${why}">${r(t.total)}</span>`;
}

/**
 * Home's Character card: the weapon (unless `weapon` is false: the card
 * shows it in detail already) and gear, small (names on hover), and the
 * sets that are on. Null with nothing to show.
 */
export function loadoutStrip(opId: string, redraw: () => void, weapon = true): Html | null {
  const l = loadoutOf(opId);
  if (!l || (!(weapon && l.weapon) && !GEAR_SLOTS.some(({ slot }) => l[slot]))) return null;
  const weps = wikiFile<WikiWeaponFile>('weapons.json', redraw).data;
  const gear = wikiFile<WikiGearFile>('gear.json', redraw).data;
  const piece = (img: Html, name: string | undefined) => html`<span class="card-gear" title="${name ?? ''}">${img}</span>`;
  const sets = gear ? [...setCounts(l, gear.gear.items)].filter(([, n]) => n >= SET_PIECES).map(([name]) => name) : [];
  return html`<span class="card-gears">
      ${weapon && l.weapon ? piece(itemImg('weap', l.weapon, 'card-gear-img'), weps?.weapons[l.weapon]?.name) : ''}
      ${GEAR_SLOTS.map(({ slot }) => (l[slot] ? piece(gearImg(l[slot]!, 'card-gear-img'), gear?.gear.items[l[slot]!]?.name) : ''))}
    </span>
    ${sets.length ? html`<span class="char-facts">${sets.map((n) => badge(`${n} ${SET_PIECES}/${SET_PIECES}`, 'green'))}</span>` : ''}`;
}

/** Short names for the card's weapon skills ("ULT Efficiency" → "Ult EFF"). */
const shortSkill = (name: string): string => (/^(ult(imate)?( gain)? efficiency)$/i.test(name.trim()) ? 'Ult EFF' : name);

/** Home's Character card: the equipped weapon in detail: rarity, Potential, base ATK, essence and each skill's rank. */
export function weaponDetail(opId: string, a: Analysis | null, redraw: () => void): Html | null {
  const id = loadoutOf(opId)?.weapon;
  if (!id) return null;
  const w = wikiFile<WikiWeaponFile>('weapons.json', redraw).data?.weapons[id];
  const mine = ownedOf(a, 'weap')?.get(id);
  const p = mine?.copies ? mine.potential : null;
  const atk = w?.stats?.baseAtk.filter((x): x is number => x != null).at(-1);
  const ranks = w ? (weaponRanksFor(id, w, p) ?? weaponRankCaps(w, p)) : undefined;
  const tag = essenceTag(id, w, p);
  return html`<span class="card-weapon">
      ${w ? rarityArt(itemImg('weap', id, 'card-weapon-img'), w.rarity) : itemImg('weap', id, 'card-weapon-img')}
      <span class="min0">
        <span class="card-weapon-name">${w?.name ?? id}</span>
        <span class="label-12 secondary">${[p != null ? `P${p}` : '', atk ? `ATK ${atk}` : '', tag ?? ''].filter(Boolean).map((x, i) => html`${i ? ' · ' : ''}${x}`)}</span>
      </span>
    </span>
    ${w?.skills.length
      ? html`<span class="char-facts">${w.skills.map((s, i) => html`<span class="char-fact">${shortSkill(s.tag ?? s.name)}${ranks?.[i] ? html` <b>Rank ${ranks[i]}</b>` : ''}</span>`)}</span>`
      : ''}`;
}
