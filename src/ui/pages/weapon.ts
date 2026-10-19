import type { Analysis } from '../../domain/analyze';
import { MAX_POTENTIAL, type Owned } from '../../domain/owned';
import type { WikiAttribution, WikiWeapon, WikiWeaponFile, WikiWeaponSkill } from '../../domain/wiki';
import { badge, icon, itemImg, rarity } from '../components';
import { fmtInt, html, type Html } from '../html';
import { credit, crumbs, external, infoHref, kindNav, loadingOrFailed, ownedOf, ownedSection, ownedTag, pips, potentialLevel, rankSlider, rich, sliderRank, statusPage, wikiFile } from './info';

/**
 * Weapon info pages (/arsenal/info and /arsenal/info/<wpn id>): base ATK,
 * skills with their values at each rank, Potential and tuning costs from the
 * wiki data, plus the player's copies. CC BY-SA 4.0: every page credits
 * endfield.wiki.gg.
 */

const MAX_RANK = 9;

/** Link to a weapon's info page (or the list of all of them). */
export const weaponInfoHref = (id?: string): string => infoHref('weap', id);

// ---------------------------------------------------------------------------
// Index: every weapon
// ---------------------------------------------------------------------------

const TYPES = ['Sword', 'Great Sword', 'Polearm', 'Handcannon', 'Arts Unit'];

function indexPage(f: WikiWeaponFile, owned: Map<string, Owned> | null): Html {
  const all = Object.entries(f.weapons);
  const types = [...new Set([...TYPES.filter((t) => all.some(([, w]) => w.type === t)), ...all.map(([, w]) => w.type)])];
  const have = owned ? all.filter(([id]) => owned.get(id)?.copies).length : 0;
  return html`<div class="page-header"><div class="container page-header-inner"><div class="min0">
      ${crumbs('weap')}
      <h1 class="heading-32">Weapon info</h1>
      <p class="copy-16">Base ATK, skills and Potential for every weapon${owned ? html`. You have ${have} of ${all.length}` : ''}.</p>
    </div><div class="row">${kindNav('weap', 'info')}</div></div></div>
    <main class="container fade-in">
      ${types.map((type) => {
        const list = all.filter(([, w]) => w.type === type).sort(([, a], [, b]) => b.rarity - a.rarity || a.name.localeCompare(b.name));
        return html`<section class="section wiki-type">
          <div class="section-head"><h2 class="heading-20">${type}</h2><span class="label-13 secondary">${list.length}</span></div>
          <div class="wiki-grid">
            ${list.map(([id, w]) => {
              const mine = owned?.get(id);
              return html`<a class="wiki-tile card${owned && !mine?.copies ? ' unowned' : ''}" href="${weaponInfoHref(id)}">
                ${itemImg('weap', id, 'wiki-tile-portrait')}
                <span class="wiki-tile-text min0">
                  <span class="wiki-tile-name ellipsis">${w.name}</span>
                  <span class="label-12 secondary">${rarity(w.rarity)} · ${w.skills[w.skills.length - 1]?.tag ?? w.type}</span>
                </span>
                ${ownedTag(mine)}
              </a>`;
            })}
          </div>
        </section>`;
      })}
      ${credit(f.attribution)}
    </main>`;
}

// ---------------------------------------------------------------------------
// One weapon
// ---------------------------------------------------------------------------

function hero(id: string, w: WikiWeapon, owned: Owned | undefined): Html {
  return html`<section class="wiki-hero weapon">
    ${itemImg('weap', id, 'wiki-hero-bg')}
    <div class="container wiki-hero-inner">
      ${itemImg('weap', id, 'wiki-hero-portrait')}
      <div class="min0 wiki-hero-text">
        ${crumbs('weap', w.name)}
        <div class="wiki-stars" style="color:var(--r${w.rarity})" aria-label="${w.rarity} star">${'★'.repeat(w.rarity)}</div>
        <h1 class="heading-32">${w.name}</h1>
        <div class="wiki-facts">
          <span class="wiki-fact"><span class="wiki-fact-label">Type</span>${w.type}</span>
          ${w.stats?.baseAtk.at(-1) != null ? html`<span class="wiki-fact"><span class="wiki-fact-label">Base ATK</span><span class="num">${w.stats.baseAtk.at(-1)}</span></span>` : ''}
          ${w.source ? html`<span class="wiki-fact"><span class="wiki-fact-label">Source</span>${w.source}</span>` : ''}
          ${owned?.copies ? html`<span class="wiki-fact"><span class="wiki-fact-label">Your Potential</span><span class="wiki-fact-pot">${potentialLevel(owned)}${pips(owned.potential)}</span></span>` : ''}
        </div>
        ${w.skills.length ? html`<div class="wiki-tags">${w.skills.map((s) => badge(s.tag ?? s.name, 'outline'))}</div>` : ''}
      </div>
      <a class="btn secondary sm wiki-hero-link" href="${w.page}" target="_blank" rel="noopener">${icon('open_in_new')}<span class="hide-sm">Wiki page</span></a>
    </div>
  </section>`;
}

function statsSection(w: WikiWeapon): Html {
  const s = w.stats;
  if (!s) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Base ATK</h2></div>
    <div class="card">
      <div class="table-wrap">
        <table class="table wiki-stats">
          <thead><tr><th></th>${s.levels.map((l) => html`<th class="num">Lv ${l}</th>`)}</tr></thead>
          <tbody><tr><td><span class="wiki-stat-name">Base ATK</span></td>${s.baseAtk.map((v) => html`<td class="num">${v ?? '–'}</td>`)}</tr></tbody>
        </table>
      </div>
    </div>
  </section>`;
}

/**
 * The last skill is the one Potential raises: each copy adds 1 to its base
 * rank and its rank limit (1–4 at P0, up to 6–9 at P5). The first two rise
 * with tuning instead.
 */
function skillCard(s: WikiWeaponSkill, rank: number, isLast: boolean, owned: Owned | undefined): Html {
  const p = owned?.copies ? owned.potential : null;
  return html`<article class="card wiki-skill">
    <div class="wiki-skill-head">
      <span class="wiki-skill-type">${isLast ? 'Weapon skill · Potential' : `Weapon skill${s.tag ? ` · ${s.tag}` : ''}`}</span>
      <h3 class="heading-16">${s.name}</h3>
    </div>
    <p class="copy-14 wiki-text">${s.text ? rich(s.text, s.values, rank) : html`<span class="secondary">No description on the wiki yet.</span>`}</p>
    ${isLast
      ? html`<p class="copy-13 secondary wiki-note">
          Ranks 1–4 at P0; each Potential adds one, up to ${1 + MAX_POTENTIAL}–${MAX_RANK} at P${MAX_POTENTIAL}.
          ${p !== null ? html`<span class="wiki-em">Yours: P${p}, ranks ${1 + p}–${4 + p}.</span>` : ''}
        </p>`
      : ''}
  </article>`;
}

function skillsSection(w: WikiWeapon, owned: Owned | undefined): Html {
  if (!w.skills.length) return html``;
  const rank = sliderRank('weap', MAX_RANK);
  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Skills</h2>
      ${rankSlider('weap', MAX_RANK)}
    </div>
    <div class="wiki-skills">${w.skills.map((s, i) => skillCard(s, rank, i === w.skills.length - 1 && w.skills.length > 1, owned))}</div>
  </section>`;
}

function potentialSection(w: WikiWeapon, owned: Owned | undefined, imported: boolean): Html {
  if (!w.potential) return html``;
  const copies = owned?.copies ?? 0;
  const p = owned?.potential ?? -1;
  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Potential</h2>
      ${imported ? html`<span class="label-13 secondary">${!copies ? 'Not owned yet' : p >= MAX_POTENTIAL ? 'Yours is maxed' : `Yours: P${p} of P${MAX_POTENTIAL}`}</span>` : ''}
    </div>
    <div class="card card-body wiki-weapon-pot">
      ${pips(p)}
      <p class="copy-14 wiki-text">${rich(w.potential)} Each duplicate raises Potential by one, to P${MAX_POTENTIAL}.</p>
    </div>
  </section>`;
}

function tuningSection(w: WikiWeapon): Html {
  if (!w.tuning.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Tuning</h2></div>
    <ol class="card wiki-list">
      ${w.tuning.map(
        (t) => html`<li>
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

function detailPage(id: string, w: WikiWeapon, attribution: WikiAttribution, a: Analysis | null): Html {
  const owned = ownedOf(a, 'weap')?.get(id);
  return html`${hero(id, w, owned)}
    <main class="container fade-in wiki-page">
      ${ownedSection('weap', w.name, a, owned)}
      ${statsSection(w)}
      ${skillsSection(w, owned)}
      ${potentialSection(w, owned, !!a)}
      ${tuningSection(w)}
      ${aboutSection(w)}
      ${credit(attribution, w.page)}
    </main>`;
}

let file: WikiWeaponFile | null = null;

/** /arsenal/info[/<wpn id>]; `redraw` runs once the data has loaded. */
export function weaponInfoPage(id: string | undefined, a: Analysis | null, redraw: () => void): Html {
  const f = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  file = f.data;
  if (!file) return loadingOrFailed('weap', 'Weapon info', f.failed);
  if (!id) return indexPage(file, ownedOf(a, 'weap'));
  const w = file.weapons[id];
  if (!w) return statusPage('weap', 'Weapon info', html`There's no wiki data for this weapon yet. <a href="${weaponInfoHref()}">See all weapons</a>. ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')} may have it.`);
  return detailPage(id, w, file.attribution, a);
}

export function weaponInfoTitle(id: string | undefined): string {
  const w = id && file?.weapons[id];
  return w ? w.name : 'Weapon info';
}
