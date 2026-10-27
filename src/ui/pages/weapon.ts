import type { Analysis } from '../../domain/analyze';
import { MAX_POTENTIAL, type Owned } from '../../domain/owned';
import type { PreviewWeapon, WikiAttribution, WikiPreviewFile, WikiWeapon, WikiWeaponFile, WikiWeaponSkill } from '../../domain/wiki';
import { badge, essenceIcon, heroGlow, icon, itemImg, pageHeader, baseNotches, essenceNotches, stars, tileArt, trait, withStars } from '../components';
import { fmtInt, html, type Html } from '../html';
import { essenceTag, weaponBuildOf, wieldersSection, type WeaponBuild } from './loadout';
import { grooveSlots, skillStat, weaponBounds } from '../../domain/loadout';
import { searchBox } from './search';
import { sortBar, sortGroups } from './sorting';
import { accordion, copyLinkButton, credit, crumbs, databaseTabs, external, infoHref, previewPage, previewsOf, loadingOrFailed, ownedOf, ownedSection, ownedTag, rateUpCard, rich, statusPage, wikiFile } from './info';

/**
 * Weapon info pages (/database/arsenals and /database/arsenals/<name>): base ATK,
 * skills with their values at each rank, Potential and tuning costs from the
 * wiki data, plus the player's copies. CC BY-SA 4.0: every page credits
 * endfield.wiki.gg.
 */

/** Link to a weapon's info page (or the list of all of them). */
export const weaponInfoHref = (id?: string): string => infoHref('weap', id);

// ---------------------------------------------------------------------------
// Index: every weapon
// ---------------------------------------------------------------------------


function indexPage(f: WikiWeaponFile, owned: Map<string, Owned> | null): Html {
  const all = Object.entries(f.weapons);
  const have = owned ? all.filter(([id]) => owned.get(id)?.copies).length : 0;
  // Weapons the wiki doesn't have yet (the version guide's): in the list like the rest, tagged Unreleased.
  const soon = Object.entries(previews?.weapons ?? {}).filter(([id]) => !f.weapons[id]);
  type Row = { id: string; w?: WikiWeapon; name: string; rarity: number; type: string | null; source?: string | null };
  const rows: Row[] = [
    ...all.map(([id, w]) => ({ id, w, name: w.name, rarity: w.rarity, type: w.type, source: w.source })),
    ...soon.map(([id, p]) => ({ id, name: p.name, rarity: p.rarity, type: p.type })),
  ];
  const groups = sortGroups('weap', rows, (r) => ({ rarity: r.rarity, name: r.name, owned: owned?.get(r.id), weapon: r.type, source: r.source, unreleased: !r.w }));
  return html`<main class="container fade-in">${databaseTabs(
      'weap',
      pageHeader('Arsenals', owned ? `${have}/${all.length}` : `${all.length} weapons`),
      html`<div class="section-head wiki-sort-head">${searchBox('weap')}${sortBar('weap')}</div>
      ${groups.map((g) => {
        return html`<section class="section wiki-type">
          <div class="section-head"><h2 class="heading-20">${g.label ? withStars(g.label) : 'All weapons'}</h2><span class="label-13 secondary wiki-count">${g.items.length}</span></div>
          <div class="wiki-grid">
            ${g.items.map(({ id, w, name, rarity: r, type }) => {
              const mine = owned?.get(id);
              return html`<a class="wiki-tile card${owned && (!w || !mine?.copies) ? ' unowned' : ''}" href="${weaponInfoHref(id)}">
                ${tileArt('weap', id, r)}
                <span class="wiki-tile-text min0">
                  <span class="wiki-tile-name ellipsis">${name}</span>
                  <span class="label-12 secondary">${w ? (w.skills[w.skills.length - 1]?.tag ?? w.type) : (type ?? 'Weapon')}${w && mine?.copies && essenceTag(id, w, mine.potential) ? html` · ${essenceTag(id, w, mine.potential)}` : ''}</span>
                </span>
                ${w ? ownedTag(mine) : badge('Unreleased', 'amber')}
              </a>`;
            })}
          </div>
        </section>`;
      })}
      <p class="copy-14 secondary list-search-empty" hidden>No weapons match your search.</p>`,
    )}
      ${credit(f.attribution)}
    </main>`;
}

// ---------------------------------------------------------------------------
// One weapon
// ---------------------------------------------------------------------------

function hero(id: string, w: WikiWeapon): Html {
  return html`<section class="wiki-hero weapon">
    ${heroGlow('weap', id)}
    <div class="container wiki-hero-inner">
      ${itemImg('weap', id, 'wiki-hero-portrait')}
      <div class="min0 wiki-hero-text">
        ${crumbs('weap', w.name)}
        <div class="wiki-stars" style="color:var(--r${w.rarity})" aria-label="${w.rarity} star">${stars(w.rarity)}</div>
        <h1 class="heading-32">${w.name}</h1>
        <div class="wiki-facts">
          <span class="wiki-fact"><span class="wiki-fact-label">Type</span>${trait('weapon-types', w.type)}</span>
          ${w.stats?.baseAtk.at(-1) != null ? html`<span class="wiki-fact"><span class="wiki-fact-label">Base ATK</span><span class="num">${w.stats.baseAtk.at(-1)}</span></span>` : ''}
          ${w.source ? html`<span class="wiki-fact"><span class="wiki-fact-label">Source</span>${w.source}</span>` : ''}
        </div>
        ${w.skills.length ? html`<div class="wiki-tags">${w.skills.map((s) => badge(s.tag ?? s.name, 'outline'))}</div>` : ''}
      </div>
      <div class="row wiki-hero-link">
        ${copyLinkButton(id)}
        <a class="btn secondary sm" href="${w.page}" target="_blank" rel="noopener">${icon('open_in_new')}<span class="hide-sm">Wiki page</span></a>
      </div>
    </div>
  </section>`;
}

/** Base ATK at Lv 90, with every level's value one click away. */
function statsSection(w: WikiWeapon): Html {
  const s = w.stats;
  if (!s) return html``;
  let at = s.levels.indexOf(90);
  if (at < 0) at = s.levels.length - 1;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Base ATK</h2><span class="label-13 secondary">Lv ${s.levels[at] ?? 90}</span></div>
    <div class="card wiki-accs">
      <dl class="wiki-attrs">
        <div class="main"><dt><span class="wiki-stat-name">Base ATK</span></dt><dd class="num">${s.baseAtk[at] ?? '–'}</dd></div>
      </dl>
      ${s.levels.length > 1
        ? accordion(
            'stats-levels',
            html`<span class="wiki-acc-name secondary">Every level</span>`,
            html`<div class="table-wrap">
              <table class="table wiki-stats">
                <thead><tr><th></th>${s.levels.map((l) => html`<th class="num">Lv ${l}</th>`)}</tr></thead>
                <tbody><tr><td><span class="wiki-stat-name">Base ATK</span></td>${s.baseAtk.map((v) => html`<td class="num">${v ?? '–'}</td>`)}</tr></tbody>
              </table>
            </div>`,
          )
        : ''}
    </div>
  </section>`;
}

/** The stat a skill's text opens with ("Treatment Efficiency ⟦num|+{0}%⟧."), taken off to leave its effect. */
const LEADING_STAT = /^[A-Za-z][A-Za-z &.'-]*?\s*⟦num\|\+\{0\}%?⟧[.,]?\s*/;

/** What a skill gives at a level, as its row shows it ("+100"; the own skill's with its stat named). */
function statText(s: WikiWeaponSkill, level: number, isLast: boolean): string {
  const st = skillStat(s, level);
  if (!st) return '';
  const amount = `+${st.pct ? `${st.value}%` : st.value.toLocaleString()}`;
  return isLast ? `${st.stat} ${amount}` : amount;
}

/**
 * One skill as a row: its name, its two groove groups and rank ("7/9"), and at the far right the stat it gives at that
 * rank (the game's value, `skillStat`: "+100" on a stat skill, whose name says the stat; "Treatment Efficiency +18%"
 * on the weapon's own). The own skill's effect, its text past that stat at its rank, always shows under its name.
 */
function skillRow(id: string, i: number, s: WikiWeaponSkill, isLast: boolean, b: WeaponBuild, slots: ReturnType<typeof grooveSlots>[number], ownLit: number): Html {
  const level = b.levels[i];
  const [lo, hi] = b.bounds[i];
  const effect = isLast && s.text ? s.text.replace(LEADING_STAT, '').trim() : '';
  return html`<div class="wpn-skill">
    <div class="wpn-skill-head">
      <span class="wiki-acc-name min0">${s.name}</span>
      <span class="skill-grooves">${baseNotches(slots.own, ownLit, slots.potential, lo - ownLit)}${essenceNotches(id, i, s.name, b.essence[i], slots.essence, hi - lo)}<span class="skill-level num">${level}<span class="tertiary">/${hi}</span></span></span>
      <span class="wpn-skill-stat num">${statText(s, level, isLast)}</span>
    </div>
    ${effect ? html`<p class="copy-13 secondary wiki-text wpn-skill-effect">${rich(effect, s.values, level)}</p>` : ''}
  </div>`;
}

/**
 * The skills, with the player's tuning, Potential and essence for this weapon (the source every loadout holding it
 * reads). Each row (`skillRow`): its name, then its 9 levels as two groove groups (`grooveSlots`): what tuning (white)
 * and Potential (purple) give, then the essence's (yellow; each a button: a click etches up to it), its rank of the
 * highest it can reach ("7/9") and its stat at the far right. Maxed Essence puts every skill's essence at its most.
 */
function skillsSection(id: string, w: WikiWeapon, owned: Owned | undefined, redraw: () => void): Html {
  if (!w.skills.length) return html``;
  const p = owned?.copies ? owned.potential : null;
  const b = weaponBuildOf(id, w, p, redraw);
  const slots = grooveSlots(w, b.tuning);
  const ownLit = weaponBounds(w, 0, b.tuning, b.stage).map((x) => x[0]);
  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Skills</h2>
      <button type="button" class="attr-toggle" data-action="weapon-essence" data-wpn="${id}" aria-pressed="${String(b.maxed)}"
        title="${b.maxed ? 'Maxed Essence: every skill at the highest rank it can reach. Press to set the essence you have' : 'Every skill at the highest rank it can reach (Maxed Essence)'}">${essenceIcon()}Maxed Essence</button>
    </div>
    <div class="card wiki-accs">${w.skills.map((s, i) => skillRow(id, i, s, i === w.skills.length - 1 && w.skills.length > 1, b, slots[i], ownLit[i]))}</div>
  </section>`;
}

const potentialText = (w: WikiWeapon): Html =>
  html`<div class="card card-body"><p class="copy-14 wiki-text">${rich(w.potential ?? '')} Each duplicate raises Potential by one, to P${MAX_POTENTIAL}.</p></div>`;

/** What Potential does, as a section of its own when the player has no copy (else it's in Pull history). */
function potentialSection(w: WikiWeapon, owned: Owned | undefined): Html {
  if (!w.potential || owned?.copies) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Potential</h2></div>
    ${potentialText(w)}
  </section>`;
}

/**
 * The tunings and their costs. Each is a button: a click tunes the weapon up to it (or, on its stage, back one), which
 * every loadout holding it reads; the ones done are lit, and the level it reaches shows in the head.
 */
function tuningSection(id: string, w: WikiWeapon, owned: Owned | undefined, redraw: () => void): Html {
  if (!w.tuning.length) return html``;
  const b = weaponBuildOf(id, w, owned?.copies ? owned.potential : null, redraw);
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Tuning</h2><span class="label-13 secondary num">Lv ${b.level}</span></div>
    <ol class="card wiki-list wiki-tunings">
      ${w.tuning.map(
        (t, k) => html`<li class="${k < b.stage ? 'done' : ''}" data-action="weapon-tuning" data-wpn="${id}" data-value="${k + 1}" role="button" tabindex="0" aria-pressed="${String(k < b.stage)}" title="${k < b.stage ? 'Tuned' : 'Not tuned'}">
          <span class="wiki-pot">${t.stage}</span>
          <div class="min0 wiki-costs">${t.cost.map((c) => html`<span><span class="wiki-em">${c.item}</span> <span class="num secondary">×${fmtInt(c.count)}</span></span>`)}</div>
        </li>`,
      )}
    </ol>
  </section>`;
}

function aboutSection(w: WikiWeapon): Html {
  // The first line is the same boilerplate on every weapon.
  const lore = w.description.slice(1).filter(Boolean);
  if (!lore.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">About</h2></div>
    <div class="card card-body"><p class="copy-14 secondary wiki-text">${lore.map((d, i) => html`${i ? html`<br /><br />` : ''}${rich(d)}`)}</p></div>
  </section>`;
}

function detailPage(id: string, w: WikiWeapon, attribution: WikiAttribution, a: Analysis | null, redraw: () => void): Html {
  const owned = ownedOf(a, 'weap')?.get(id);
  return html`${hero(id, w)}
    <main class="container fade-in wiki-page">
      ${ownedSection('weap', w.name, a, owned, w.potential ? potentialText(w) : undefined)}
      ${wieldersSection(id, redraw)}
      <div class="wiki-cols">
        <div class="wiki-col">${statsSection(w)}${potentialSection(w, owned)}</div>
        <div class="wiki-col">${skillsSection(id, w, owned, redraw)}</div>
      </div>
      ${tuningSection(id, w, owned, redraw)}
      ${aboutSection(w)}
      ${credit(attribution, w.page)}
    </main>`;
}

let file: WikiWeaponFile | null = null;
let previews: WikiPreviewFile | null = null;

/** An unreleased weapon: what the version guide shows (type, traits, banner). */
function weaponPreview(id: string, p: PreviewWeapon, attribution: WikiPreviewFile['attribution']): Html {
  const about = html`${p.traits.length
      ? html`<section class="section"><div class="section-head"><h2 class="heading-20">Traits</h2></div>
          <div class="card"><div class="card-body"><div class="wiki-tags">${p.traits.map((t) => badge(t, 'outline'))}</div></div></div></section>`
      : ''}
    ${p.banner.name ? html`<section class="section"><div class="section-head"><h2 class="heading-20">Banner</h2></div>
      ${rateUpCard(p.banner)}</section>` : ''}`;
  return previewPage('weap', id, p, [['Type', p.type]], [], about, attribution);
}

/** /database/arsenals[/<name>]; `redraw` runs once the data has loaded. */
export function weaponInfoPage(id: string | undefined, a: Analysis | null, redraw: () => void): Html {
  const f = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  file = f.data;
  previews = previewsOf(redraw);
  if (!file) return loadingOrFailed('weap', 'Arsenals', f.failed);
  if (!id) return indexPage(file, ownedOf(a, 'weap'));
  const w = file.weapons[id];
  // Not on the wiki yet: the version guide's preview, if it has one.
  const p = !w ? previews?.weapons[id] : undefined;
  if (p && previews) return weaponPreview(id, p, previews.attribution);
  if (!w) return statusPage('weap', 'Arsenals', html`There's no wiki data for this weapon yet. <a href="${weaponInfoHref()}">See all weapons</a>. ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')} may have it.`);
  return detailPage(id, w, file.attribution, a, redraw);
}

export function weaponInfoTitle(id: string | undefined): string {
  const w = id && (file?.weapons[id] ?? previews?.weapons[id]);
  return w ? w.name : 'Arsenals';
}
