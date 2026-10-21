import type { Analysis } from '../../domain/analyze';
import { endministratorOf, ENDMINISTRATORS, extrasOf, isEndministrator, type Owned } from '../../domain/owned';
import { state } from '../../state';
import { applyMods, isGain, potentialSkillMods, skillDmgBonus, type ValueMod } from '../../domain/skillmods';
import { requiredGain, rotationEnergy, TEAM_ENERGY_PER_BATTLE_SKILL, ultimateEnergy, type UltimateEnergy } from '../../domain/ultimate';
import { atkTotal, defReduction, hpTotal, statTotal, TREATMENT_PER_WILL, type Bonus } from '../../domain/loadout';
import { canShuffle, currentArt, gallerySection, positionOf } from './art';
import { searchBox } from './search';
import { sortBar, sortGroups } from './sorting';
import { atkValue, bonusesFor, hpValue, isSplit, loadoutOnly, loadoutSection, splitToggle, withBonus } from './loadout';
import { skillSets, wikiId, type PreviewOperator, type WikiAttribution, type WikiOperator, type WikiOperatorFile, type WikiPreviewFile, type WikiSkill } from '../../domain/wiki';
import { badge, heroGlow, icon, itemImg, rarity, trait } from '../components';
import { html, type Html } from '../html';
import { accordion, copyLinkButton, credit, crumbs, databaseTabs, external, infoHref, previewPage, previewsOf, loadingOrFailed, ownedOf, ownedSection, ownedTag, pips, potentialLevel, rankSlider, rateUpCard, rich, sliderRank, statusPage, wikiFile } from './info';

/**
 * Operator info pages (/operators/info and /operators/info/<chr id>): class,
 * element, stats, skills and talents from the community wiki's data, which
 * ef-assets snapshots, plus what the player's pulls say (copies, Potential).
 * Works without an import. The data is CC BY-SA 4.0, so every page credits
 * endfield.wiki.gg.
 */

const MAX_RANK = 12;

/** Link to an operator's info page (or the list of all of them). */
export const operatorInfoHref = (id?: string): string => infoHref('char', id);

// ---------------------------------------------------------------------------
// Index: every operator
// ---------------------------------------------------------------------------

function indexPage(f: WikiOperatorFile, owned: Map<string, Owned> | null): Html {
  // Endministrator is two ids on one wiki page; list each page once.
  const seen = new Set<string>();
  // That one is the player's Endministrator (from their extra copies), or the female by default.
  const endmin = endministratorOf(extrasOf(state.settings)) ?? ENDMINISTRATORS[0];
  const ops = Object.entries(f.operators)
    .filter(([id]) => !isEndministrator(id) || id === endmin)
    .filter(([, o]) => !seen.has(o.page) && !!seen.add(o.page));
  const have = owned ? ops.filter(([id]) => owned.get(id)?.copies).length : 0;
  // Operators the wiki doesn't have yet (the version guide's): in the list like the rest, tagged Unreleased.
  const soon = Object.entries(previews?.operators ?? {}).filter(([id]) => !f.operators[id]);
  type Row = { id: string; name: string; rarity: number; class: string | null; element: string | null; weapon: string | null; soon: boolean };
  const rows: Row[] = [
    ...ops.map(([id, o]) => ({ id, name: o.name, rarity: o.rarity, class: o.class, element: o.element, weapon: o.weapon, soon: false })),
    ...soon.map(([id, p]) => ({ id, name: p.name, rarity: p.rarity, class: p.class, element: p.element, weapon: p.weapon, soon: true })),
  ];
  const groups = sortGroups('char', rows, (r) => ({ rarity: r.rarity, name: r.name, owned: owned?.get(r.id), element: r.element, weapon: r.weapon, class: r.class, unreleased: r.soon }));
  return html`<div class="page-header"><div class="container page-header-inner"><div class="min0">
      <h1 class="heading-32">Operators</h1>
      <p class="copy-16">${owned ? `${have}/${ops.length}` : `${ops.length} operators`}</p>
    </div></div></div>
    <main class="container fade-in">${databaseTabs(
      'char',
      html`<div class="section-head wiki-sort-head">${searchBox('char')}${sortBar('char')}</div>
      ${groups.map(
        (g) => html`<section class="section wiki-type">
          <div class="section-head"><h2 class="heading-20">${g.label || 'All operators'}</h2><span class="label-13 secondary wiki-count">${g.items.length}</span></div>
          <div class="wiki-grid">
            ${g.items.map((r) => {
              const mine = owned?.get(r.id);
              return html`<a class="wiki-tile card${owned && (r.soon || !mine?.copies) ? ' unowned' : ''}" href="${operatorInfoHref(r.id)}">
                ${itemImg('char', r.id, 'wiki-tile-portrait')}
                <span class="wiki-tile-text min0">
                  <span class="wiki-tile-name ellipsis">${r.name}</span>
                  <span class="label-12 secondary">${rarity(r.rarity)}${r.class ? html` · ${trait('classes', r.class)}` : ''}${r.element ? html` · ${trait('elements', r.element)}` : ''}</span>
                </span>
                ${r.soon ? badge('Unreleased', 'amber') : ownedTag(mine)}
              </a>`;
            })}
          </div>
        </section>`,
      )}
      <p class="copy-14 secondary list-search-empty" hidden>No operators match your search.</p>`,
    )}
      ${credit(f.attribution)}
    </main>`;
}

// ---------------------------------------------------------------------------
// One operator
// ---------------------------------------------------------------------------

/**
 * The page's header: the operator's facts over the player's banner art (or a
 * soft glow of their portrait), with the player's character picture in place
 * of the portrait when they picked one (pages/art.ts).
 */
function hero(id: string, o: WikiOperator, owned: Owned | undefined, redraw: () => void, overBackdrop = false): Html {
  const banner = currentArt(id, 'banner', redraw);
  const portrait = currentArt(id, 'portrait', redraw);
  return html`<section class="wiki-hero${banner ? ' has-art' : ''}${overBackdrop ? ' over-backdrop' : ''}">
    ${banner
      ? html`<img class="wiki-hero-art" src="${banner.src}" data-art="${banner.id}" style="object-position:${positionOf(banner.id)[0]}% ${positionOf(banner.id)[1]}%" alt="" decoding="async" />`
      : heroGlow('char', id)}
    <div class="container wiki-hero-inner">
      ${portrait ? html`<img class="wiki-hero-portrait user-art" src="${portrait.src}" alt="" decoding="async" />` : itemImg('char', id, 'wiki-hero-portrait')}
      <div class="min0 wiki-hero-text">
        ${crumbs('char', o.name)}
        <div class="wiki-stars" style="color:var(--r${o.rarity})" aria-label="${o.rarity} star">${'★'.repeat(o.rarity)}</div>
        <h1 class="heading-32">${o.name}</h1>
        <div class="wiki-facts">
          <span class="wiki-fact"><span class="wiki-fact-label">Class</span>${trait('classes', o.class)}</span>
          <span class="wiki-fact"><span class="wiki-fact-label">Element</span><span class="wk wk-${o.element.toLowerCase().replace(/\W/g, '')}">${trait('elements', o.element)}</span></span>
          <span class="wiki-fact"><span class="wiki-fact-label">Weapon</span>${trait('weapon-types', o.weapon)}</span>
          ${o.faction ? html`<span class="wiki-fact"><span class="wiki-fact-label">Faction</span>${o.faction}</span>` : ''}
          ${owned?.copies ? html`<span class="wiki-fact"><span class="wiki-fact-label">Potential</span><span class="wiki-fact-pot">${potentialLevel(owned)}${pips(owned.potential)}</span></span>` : ''}
        </div>
        ${o.tags.length ? html`<div class="wiki-tags">${o.tags.map((t) => badge(t, 'outline'))}</div>` : ''}
      </div>
      <div class="row wiki-hero-link">
        ${canShuffle(id, redraw) ? html`<button type="button" class="btn secondary sm" data-action="art-shuffle" data-op="${id}" title="Pick other pictures for the banner, picture and background">${icon('shuffle')}<span class="hide-sm">Shuffle</span></button>` : ''}
        <button type="button" class="btn secondary sm" data-action="art-manage" data-op="${id}" data-name="${o.name}" title="Add pictures for this page's banner">${icon('image')}<span class="hide-sm">Art</span></button>
        ${copyLinkButton(id)}
        <a class="btn secondary sm" href="${o.page}" target="_blank" rel="noopener">${icon('open_in_new')}<span class="hide-sm">Wiki page</span></a>
      </div>
    </div>
  </section>`;
}

/** Stats every operator starts with (in %), which bonuses add to: the game shows 100% + 89.1% as 189.1%. */
const BASE_PERCENT: Record<string, number> = { 'Ultimate Gain Efficiency': 100 };

const STAT_ROWS: [keyof NonNullable<WikiOperator['stats']>, string][] = [
  ['hp', 'HP'],
  ['atk', 'ATK'],
  ['strength', 'Strength'],
  ['agility', 'Agility'],
  ['intellect', 'Intellect'],
  ['will', 'Will'],
];

/**
 * Attributes at Lv 90 (where nearly everyone's operators sit), with every
 * level's table one click away. `bonuses`: what talents, the player's
 * Potential and loadout add; values show totals (Breakdown splits them), and
 * stats without a base value (DEF, DMG bonuses...) get rows of their own.
 */
function statsSection(o: WikiOperator, bonuses: Map<string, Bonus> | null, potential: number | null): Html {
  const s = o.stats;
  if (!s) return html``;
  const tag = (label: string) =>
    label === o.mainAttribute ? badge('Main', 'purple') : label === o.secondaryAttribute ? badge('Secondary') : '';
  // Lv 90, else the highest level the wiki lists.
  let at = s.levels.findIndex((l) => l.level === 90);
  if (at < 0) at = s.levels.length - 1;
  const rows = STAT_ROWS.filter(([k]) => Array.isArray(s[k]));
  const shown = new Set<string>([...rows.map(([, label]) => label), 'Critical rate', 'DEF', 'Ultimate Gain Efficiency']);
  // Ultimate Gain Efficiency (100% + bonuses) opens the breakpoint table.
  const ugeBonus = bonuses?.get('Ultimate Gain Efficiency');
  const ugeValue = withBonus(100, ugeBonus, (n) => `${Math.round(n * 10) / 10}%`, true);
  const ult = ultimateEnergy(o, potential);
  const def = bonuses?.get('DEF');
  // ATK and HP grow with the attributes' totals (atkTotal, hpTotal), as the
  // whole numbers the game shows: Strength 91.855 gives 91 × 5 HP, not 459.
  const totalOf = (label: string | null) => {
    const k = STAT_ROWS.find(([, l]) => l === label)?.[0];
    return k && Array.isArray(s[k]) ? Math.floor(statTotal((s[k] as number[])[at], bonuses?.get(label!))) : 0;
  };
  const opAtk = s.atk?.[at] ?? 0;
  const opHp = s.hp?.[at] ?? 0;
  const hp = hpTotal(opHp, bonuses?.get('HP'), totalOf('Strength'));
  const treatment = totalOf('Will') * TREATMENT_PER_WILL;
  const atk = atkTotal(opAtk, bonuses?.get('ATK'), totalOf(o.mainAttribute), totalOf(o.secondaryAttribute));
  const others = [...(bonuses ?? [])].filter(([k]) => !shown.has(k)).sort(([x], [y]) => x.localeCompare(y));
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Attributes</h2><span class="row label-13 secondary">Lv ${s.levels[at]?.level ?? 90}${bonuses?.size ? splitToggle() : ''}</span></div>
    <div class="card wiki-accs">
      <dl class="wiki-attrs">
        ${rows.map(
          ([k, label]) => html`<div class="${label === o.mainAttribute ? 'main' : ''}">
            <dt><span class="wiki-stat-name">${label}${tag(label)}</span></dt>
            <dd class="num">${k === 'atk' ? atkValue(opAtk, bonuses?.get('ATK'), atk, o.mainAttribute, o.secondaryAttribute) : k === 'hp' ? hpValue(opHp, bonuses?.get('HP'), hp) : withBonus((s[k] as number[])[at], bonuses?.get(label))}</dd>
          </div>`,
        )}
        <div class="minor"><dt>Critical rate</dt><dd class="num">${s.critRate != null ? withBonus(s.critRate * 100, bonuses?.get('Critical rate'), (n) => `${Math.round(n * 10) / 10}%`, true) : '–'}</dd></div>
        <div class="minor"><dt>Attack speed</dt><dd class="num">${s.attackSpeed ?? '–'}</dd></div>
        <div class="minor"><dt>Range</dt><dd>${s.range ?? '–'}</dd></div>
        ${def ? html`<div class="minor loadout-only"><dt>DEF</dt><dd class="num"><span class="attr-note">${defReduction(def.flat).toFixed(1)}% less DMG taken</span>${loadoutOnly(def)}</dd></div>` : ''}
        ${treatment ? html`<div class="minor"><dt>Treatment received</dt><dd class="num" title="0.1% per point of Will">+${Math.round(treatment * 10) / 10}%</dd></div>` : ''}
        ${others.map(([k, b]) =>
          BASE_PERCENT[k] != null
            ? html`<div class="minor"><dt>${k}</dt><dd class="num">${withBonus(BASE_PERCENT[k], b, (n) => `${Math.round(n * 10) / 10}%`, true)}</dd></div>`
            : html`<div class="minor loadout-only"><dt>${k}</dt><dd class="num">${loadoutOnly(b)}</dd></div>`,
        )}
      </dl>
      ${ult
        ? html`<div class="bp-acc">${accordion(
            'ult-breakpoints',
            html`<span class="wiki-acc-title min0"><span>Ultimate Gain Efficiency</span><span class="bp-hint">Breakpoints</span></span><span class="num bp-value">${ugeValue}</span>`,
            breakpointsTable(o, ult, ugeBonus?.pct ?? 0),
          )}</div>`
        : html`<dl class="wiki-attrs"><div class="minor"><dt>Ultimate Gain Efficiency</dt><dd class="num">${ugeValue}</dd></div></dl>`}
      ${s.levels.length > 1
        ? accordion(
            'stats-levels',
            html`<span class="wiki-acc-name secondary">Every level</span>`,
            html`<div class="table-wrap">
        <table class="table wiki-stats">
          <thead><tr><th></th>${s.levels.map((l) => html`<th class="num">Lv ${l.level}${l.promotion && l.level !== 90 ? html`<span class="wiki-promo" title="Elite ${l.promotion}">E${l.promotion}</span>` : ''}</th>`)}</tr></thead>
          <tbody>
            ${STAT_ROWS.filter(([k]) => Array.isArray(s[k])).map(
              ([k, label]) => html`<tr class="${label === o.mainAttribute ? 'main' : ''}">
                <td><span class="wiki-stat-name">${label}${tag(label)}</span></td>
                ${(s[k] as number[]).map((v) => html`<td class="num">${Math.trunc(v)}</td>`)}
              </tr>`,
            )}
          </tbody>
        </table>
      </div>`,
          )
        : ''}
    </div>
  </section>`;
}

/** The head of a collapsible row: a small type label over the name. */
const rowHead = (type: string | null, name: string): Html =>
  html`<span class="wiki-acc-title min0">${type ? html`<span class="wiki-skill-type">${type}</span>` : ''}<span class="wiki-acc-name">${name}</span></span>`;

/** One combat skill, with its own rank slider (each skill levels on its own; Lv 12 until moved). */
/** A value change as a short chip: ×1.3, −15%, −2s. */
function modChip(label: string, m: ValueMod): string {
  const unit = /cooldown/i.test(label) ? 's' : '';
  if (m.kind === 'add') return `${m.value > 0 ? '+' : '−'}${Math.abs(m.value)}${unit}`;
  return m.value >= 1 ? `×${m.value}` : `−${Math.round((1 - m.value) * 1000) / 10}%`;
}

/**
 * One combat skill, with its own rank slider (each skill levels on its own;
 * Lv 12 until moved). Values a Potential changes show changed, in green
 * (Breakdown shows the original and the change), and gear and set skill
 * DMG bonuses get a row of their own.
 */
function skillRow(key: string, sliderKey: string, s: WikiSkill, mods: Map<string, ValueMod[]> | undefined, dmg: ReturnType<typeof skillDmgBonus>): Html {
  const rank = sliderRank(sliderKey, MAX_RANK);
  const split = isSplit();
  return accordion(
    key,
    html`${rowHead(s.type, s.name)}${s.values.length ? html`<span class="num wiki-acc-rank" title="Rank">${rank}</span>` : ''}`,
    html`<div class="wiki-rank-scope" data-rank-scope>
      ${s.values.length ? rankSlider(sliderKey, MAX_RANK, rank) : ''}
      <p class="copy-14 wiki-text">${rich(s.description)}</p>
      ${s.info ? html`<p class="copy-13 secondary wiki-text">${rich(s.info)}</p>` : ''}
      ${s.values.length
        ? html`<dl class="wiki-values">
            ${s.values.map((v) => {
              const m = mods?.get(v.label);
              const changed = m?.length ? v.ranks.map((r) => applyMods(r, m) ?? r) : null;
              const list = changed && !split ? changed : v.ranks;
              const shown = list[Math.min(rank, list.length) - 1] ?? '–';
              if (!changed) return html`<div><dt>${v.label}</dt><dd class="num" data-ranks="${list.join('|')}">${shown}</dd></div>`;
              const why = m!.map((x) => `${x.from}: ${modChip(v.label, x)}`).join('\n');
              return html`<div><dt>${v.label}</dt><dd class="num">
                <span class="${split ? '' : isGain(v.label, m!) ? 'attr-total' : 'attr-loss'}" data-ranks="${list.join('|')}" title="${why}">${shown}</span>${split
                  ? m!.map((x) => html`<span class="attr-bonus" title="${x.from}">${modChip(v.label, x)}</span>`)
                  : ''}
              </dd></div>`;
            })}
            ${dmg
              ? html`<div><dt>DMG bonus</dt><dd class="num"><span class="attr-total" title="${dmg.sources.map((x) => `${x.from}: +${Math.round(x.pct * 10) / 10}%`).join('\n')}">+${Math.round(dmg.pct * 10) / 10}%</span></dd></div>`
              : ''}
          </dl>`
        : ''}
    </div>`,
  );
}

function skillsSection(id: string, o: WikiOperator, bonuses: Map<string, Bonus> | null, potential: number | null): Html {
  if (!o.skills.length) return html``;
  const mods = potentialSkillMods(o, potential);
  const touched = mods.size > 0 || o.skills.some((s) => skillDmgBonus(s, bonuses));
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Skills</h2>${touched ? html`<span class="row label-13 secondary">${splitToggle()}</span>` : ''}</div>
    ${skillSets(o.skills).map(
      (set, si) => html`${set.variant ? html`<h3 class="wiki-skill-type wiki-variant">${set.variant}</h3>` : ''}
        <div class="card wiki-accs">${set.skills.map((s, i) =>
          skillRow(`skill-${si}-${i}`, `${id}:${si}:${i}`, s, mods.get(`${s.type}:${s.name}`), skillDmgBonus(s, bonuses)),
        )}</div>`,
    )}
  </section>`;
}

/** Potentials, with the ones the player's copies unlock marked. */
function potentialsSection(o: WikiOperator, owned: Owned | undefined, imported: boolean): Html {
  if (!o.potentials.length) return html``;
  const have = owned?.potential ?? -1;
  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Potentials</h2>
    </div>
    <div class="card wiki-accs wiki-pots">
      ${o.potentials.map((p) => {
        const on = p.rank <= have;
        return html`<div class="${imported ? (on ? 'on' : 'off') : ''}">${accordion(
          `pot-${p.rank}`,
          html`<span class="wiki-pot">${on ? icon('check') : `P${p.rank}`}</span>${rowHead(null, p.name)}`,
          html`<p class="copy-14 secondary wiki-text">${rich(p.description)}</p>`,
        )}</div>`;
      })}
    </div>
  </section>`;
}

function talentsSection(o: WikiOperator): Html {
  if (!o.talents.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Talents</h2></div>
    <div class="card wiki-accs">
      ${o.talents.map((t, i) =>
        accordion(
          `talent-${i}`,
          rowHead(null, t.name),
          html`<ul class="wiki-levels">
            ${t.levels.map((l) => html`<li>${l.requires ? html`<span class="wiki-req">${l.requires}</span>` : ''}<span class="copy-14 wiki-text">${rich(l.description)}</span></li>`)}
          </ul>`,
        ),
      )}
    </div>
  </section>`;
}

function baseSkillsSection(o: WikiOperator): Html {
  if (!o.baseSkills.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Base skills</h2></div>
    <div class="card wiki-accs">
      ${o.baseSkills.map((b, i) =>
        accordion(
          `base-${i}`,
          rowHead(b.facility, b.name),
          html`<ul class="wiki-levels">
            ${b.levels.map((l) => html`<li><span class="wiki-req">${[b.name + (l.grade ? ` ${l.grade}` : ''), l.requires].filter(Boolean).join(' · ')}</span><span class="copy-14 wiki-text">${rich(l.description)}</span></li>`)}
          </ul>`,
        ),
      )}
    </div>
  </section>`;
}

function profileSection(o: WikiOperator): Html {
  const facts: [string, string | null][] = [
    ['Race', o.race],
    ['Gender', o.gender],
    ['Birthday', o.birthday],
    ['Expertise', o.expertise.join(', ') || null],
    ['Hobbies', o.hobbies.join(', ') || null],
    ['Favourite gift', o.gift],
  ];
  const shown = facts.filter(([, v]) => v && !/^[■?]+$/.test(v));
  if (!o.profile && !o.quote && !shown.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Profile</h2></div>
    <div class="card card-body wiki-profile">
      ${o.quote ? html`<blockquote class="copy-16 wiki-quote">${o.quote}</blockquote>` : ''}
      ${shown.length ? html`<dl class="wiki-facts-list">${shown.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}
      ${o.profile ? html`<details class="wiki-more"><summary class="label-14">Full profile</summary><p class="copy-14 secondary wiki-text">${rich(o.profile)}</p></details>` : ''}
    </div>
  </section>`;
}

/** Battle skills per rotation the breakpoint table goes through, and own combo skills. */
const BP_BATTLE_SKILLS = [3, 4, 5, 6, 7, 8, 9];
const BP_COMBOS = [1, 2, 3];

/**
 * How much Ultimate Gain Efficiency it takes to have the ultimate ready
 * again after N battle skills (anyone's) and M of the operator's own combo
 * skills (domain/ultimate.ts), with the player's own UGE marking what they
 * already reach. Opens from the Ultimate Gain Efficiency row of Attributes.
 */
function breakpointsTable(o: WikiOperator, u: UltimateEnergy, uge: number): Html {
  const combos = u.comboGain > 0 ? BP_COMBOS : [0];
  const cols = u.teamEnergy ? BP_BATTLE_SKILLS : [0];
  const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
  const cell = (b: number, c: number) => {
    const need = requiredGain(u, b, c);
    if (!Number.isFinite(need)) return html`<td class="num bp-none">–</td>`;
    const met = uge + 1e-9 >= need;
    return html`<td class="num${met ? ' bp-met' : ''}" title="${`${b} battle skills, ${c} combo skills: ${Math.round(rotationEnergy(u, b, c) * 10) / 10} energy; ${need ? `needs +${pct(need)}` : 'enough without any bonus'}`}">${need ? `+${Math.ceil(need)}%` : '0%'}</td>`;
  };
  return html`<div class="table-wrap">
        <table class="table bp-table">
          <thead>
            ${u.teamEnergy ? html`<tr class="bp-group"><th></th><th colspan="${cols.length}">Battle skills per rotation</th></tr>` : ''}
            <tr><th>Combos</th>${cols.map((b) => html`<th class="num">${u.teamEnergy ? b : 'Need'}</th>`)}</tr>
          </thead>
          <tbody>
            ${combos.map((c) => html`<tr><td>${c}</td>${cols.map((b) => cell(b, c))}</tr>`)}
          </tbody>
        </table>
      </div>
      <p class="bp-note copy-13 secondary">
          Ultimate Gain Efficiency needed, on top of 100%, to fill ${o.name}'s ultimate
          (${Math.round(u.cost * 10) / 10} energy${u.cost !== u.baseCost ? `, ${u.baseCost} before Potential` : ''}) in one rotation.
          ${u.teamEnergy ? `Each battle skill, anyone's, gives ${TEAM_ENERGY_PER_BATTLE_SKILL}; ` : `${o.name} gets no energy from teammates' battle skills; `}each of ${o.name}'s combo skills gives ${u.comboGain}.
          Green: your ${pct(100 + uge)} reaches it.
          ${u.extras.length ? html`<br />Not counted (depends on hits or stacks): ${u.extras.join(' · ')}.` : ''}
      </p>`;
}

function detailPage(id: string, o: WikiOperator, attribution: WikiAttribution, a: Analysis | null, redraw: () => void): Html {
  const owned = ownedOf(a, 'char')?.get(id);
  const bonuses = bonusesFor(id, o, a, redraw);
  const backdrop = currentArt(id, 'background', redraw);
  return html`${backdrop ? html`<img class="op-backdrop" src="${backdrop.src}" alt="" decoding="async" />` : ''}
    ${hero(id, o, owned, redraw, !!backdrop)}
    <main class="container fade-in wiki-page${backdrop ? ' has-backdrop' : ''}">
      ${ownedSection('char', o.name, a, owned)}
      <div class="wiki-cols even">
        <div class="wiki-col">${statsSection(o, bonuses, owned?.copies ? owned.potential : null)}</div>
        <div class="wiki-col">${loadoutSection(id, a, redraw)}</div>
      </div>
      <div class="wiki-cols even">
        <div class="wiki-col">${skillsSection(id, o, bonuses, owned?.copies ? owned.potential : null)}</div>
        <div class="wiki-col">${potentialsSection(o, owned, !!a)}</div>
      </div>
      <div class="wiki-cols even">
        <div class="wiki-col">${talentsSection(o)}</div>
        <div class="wiki-col">${baseSkillsSection(o)}</div>
      </div>
      ${gallerySection(id, redraw)}
      ${profileSection(o)}
      ${credit(attribution, o.page)}
    </main>`;
}

let file: WikiOperatorFile | null = null;
let previews: WikiPreviewFile | null = null;

/** An unreleased operator: what the version guide shows (class, element, tags, kit summary, banner). */
function operatorPreview(id: string, p: PreviewOperator, attribution: WikiPreviewFile['attribution']): Html {
  const element = p.element ? html`<span class="wk wk-${p.element.toLowerCase().replace(/\W/g, '')}">${p.element}</span>` : null;
  const about = html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Kit</h2></div>
    <div class="card"><div class="card-body"><p class="copy-14 wiki-text">${p.summary ?? 'The guide has no summary of this kit yet.'}</p></div></div>
  </section>
  ${p.banner.name ? html`<section class="section"><div class="section-head"><h2 class="heading-20">Banner</h2></div>
    ${rateUpCard(p.banner)}</section>` : ''}`;
  return previewPage('char', id, p, [['Class', p.class], ['Element', element], ['Weapon', p.weapon]], p.tags, about, attribution);
}

/** /operators/info[/<chr id>]; `redraw` runs once the data has loaded. */
export function operatorInfoPage(id: string | undefined, a: Analysis | null, redraw: () => void): Html {
  const f = wikiFile<WikiOperatorFile>('operators.json', redraw);
  file = f.data;
  previews = previewsOf(redraw);
  if (!file) return loadingOrFailed('char', 'Operators', f.failed);
  if (!id) return indexPage(file, ownedOf(a, 'char'));
  const o = file.operators[wikiId(id)];
  // Not on the wiki yet: the version guide's preview, if it has one.
  const p = !o ? previews?.operators[id] : undefined;
  if (p && previews) return operatorPreview(id, p, previews.attribution);
  if (!o) return statusPage('char', 'Operators', html`There's no wiki data for this operator yet. <a href="${operatorInfoHref()}">See all operators</a>. ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')} may have it.`);
  return detailPage(wikiId(id), o, file.attribution, a, redraw);
}

/** Tab title for the operator info pages. */
export function operatorInfoTitle(id: string | undefined): string {
  const o = id && (file?.operators[wikiId(id)] ?? previews?.operators[id]);
  return o ? o.name : 'Operators';
}

/**
 * Home's Character card: the operator's main numbers at Lv 90 (else the
 * highest level listed) with their loadout and Potential counted, as the
 * Attributes section shows them: HP, ATK and their two attributes, then the
 * stats their loadout raises most (Critical rate counted among them), up to
 * `max` in all. Null without wiki stats.
 */
export function cardStats(id: string, a: Analysis | null, redraw: () => void, max = 8): [label: string, value: string][] | null {
  const o = wikiFile<WikiOperatorFile>('operators.json', redraw).data?.operators[wikiId(id)];
  const s = o?.stats;
  if (!o || !s) return null;
  let at = s.levels.findIndex((l) => l.level === 90);
  if (at < 0) at = s.levels.length - 1;
  const bonuses = bonusesFor(id, o, a, redraw);
  const totalOf = (label: string | null) => {
    const k = STAT_ROWS.find(([, l]) => l === label)?.[0];
    return k && Array.isArray(s[k]) ? Math.floor(statTotal((s[k] as number[])[at], bonuses.get(label!))) : 0;
  };
  const fmt = (n: number) => Math.round(n).toLocaleString();
  const out: [string, string][] = [];
  if (s.hp) out.push(['HP', fmt(hpTotal(s.hp[at], bonuses.get('HP'), totalOf('Strength')).total)]);
  if (s.atk) out.push(['ATK', fmt(atkTotal(s.atk[at], bonuses.get('ATK'), totalOf(o.mainAttribute), totalOf(o.secondaryAttribute)).total)]);
  for (const label of [o.mainAttribute, o.secondaryAttribute]) if (label && totalOf(label)) out.push([label, fmt(totalOf(label))]);
  // Then the stats the loadout raises most: percentages by how many points they add, flat ones by a tenth of theirs.
  const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
  const shown = new Set(['HP', 'ATK', ...STAT_ROWS.map(([, l]) => l)]);
  /** Short names for the card's small cells. */
  const SHORT: Record<string, string> = { 'Ultimate Gain Efficiency': 'Ult EFF' };
  const extra: { label: string; value: string; weight: number }[] = [...bonuses]
    .filter(([k, b]) => !shown.has(k) && k !== 'Critical rate' && (b.pct || b.flat))
    .map(([k, b]) => ({
      label: SHORT[k] ?? k,
      value: BASE_PERCENT[k] != null ? pct(BASE_PERCENT[k] + b.pct) : b.pct ? `+${pct(b.pct)}` : `+${fmt(b.flat)}`,
      weight: b.pct || b.flat / 10,
    }));
  if (s.critRate != null) {
    const crit = bonuses.get('Critical rate');
    extra.push({ label: 'Crit rate', value: pct(statTotal(s.critRate * 100, crit)), weight: crit?.pct ?? 0 });
  }
  extra.sort((x, y) => y.weight - x.weight);
  for (const x of extra) if (out.length < max) out.push([x.label, x.value]);
  return out;
}
