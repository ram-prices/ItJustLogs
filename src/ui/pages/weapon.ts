import type { Analysis } from '../../domain/analyze';
import { MAX_POTENTIAL, type Owned } from '../../domain/owned';
import type { PreviewWeapon, WikiAttribution, WikiPreviewFile, WikiWeapon, WikiWeaponFile, WikiWeaponSkill } from '../../domain/wiki';
import { badge, icon, itemImg, rarity } from '../components';
import { fmtInt, html, type Html } from '../html';
import { wieldersSection } from './loadout';
import { accordion, copyLinkButton, credit, crumbs, external, infoHref, kindNav, previewPage, previewsOf, loadingOrFailed, ownedOf, ownedSection, ownedTag, pips, potentialLevel, rankSlider, rich, sliderRank, statusPage, wikiFile } from './info';

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
  const soon = Object.entries(previews?.weapons ?? {}).filter(([id]) => !f.weapons[id]);
  return html`<div class="page-header"><div class="container page-header-inner"><div class="min0">
      ${crumbs('weap')}
      <h1 class="heading-32">Weapon info</h1>
      <p class="copy-16">Base ATK, skills and Potential for every weapon${owned ? html`. You have ${have} of ${all.length}` : ''}.</p>
    </div><div class="row">${kindNav('weap', 'info')}</div></div></div>
    <main class="container fade-in">
      ${soon.length
        ? html`<section class="section wiki-type">
            <div class="section-head"><h2 class="heading-20">Coming soon</h2><span class="label-13 secondary">From the version guide</span></div>
            <div class="wiki-grid">
              ${soon.map(([id, p]) => html`<a class="wiki-tile card" href="${weaponInfoHref(id)}">
                ${itemImg('weap', id, 'wiki-tile-portrait')}
                <span class="wiki-tile-text min0">
                  <span class="wiki-tile-name ellipsis">${p.name}</span>
                  <span class="label-12 secondary">${rarity(p.rarity)} · ${p.type ?? 'Weapon'}</span>
                </span>
                ${badge('Soon', 'amber')}
              </a>`)}
            </div>
          </section>`
        : ''}
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
          ${owned?.copies ? html`<span class="wiki-fact"><span class="wiki-fact-label">Potential</span><span class="wiki-fact-pot">${potentialLevel(owned)}${pips(owned.potential)}</span></span>` : ''}
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

/**
 * One skill, with its own rank slider (each skill levels on its own). The
 * last skill is the one Potential raises: each copy adds 1 to its base rank
 * and its rank limit (1–4 at P0, up to 6–9 at P5), so its slider starts at
 * the player's limit. The first two rise with essence instead.
 */
function skillRow(id: string, i: number, s: WikiWeaponSkill, isLast: boolean, owned: Owned | undefined): Html {
  const p = owned?.copies ? owned.potential : null;
  const key = `${id}:${i}`;
  const rank = sliderRank(key, MAX_RANK, isLast && p !== null ? Math.min(MAX_RANK, 4 + p) : MAX_RANK);
  return accordion(
    `skill-${i}`,
    html`<span class="wiki-acc-title min0"><span class="wiki-acc-name">${s.name}</span></span><span class="num wiki-acc-rank" title="Rank">${rank}</span>`,
    html`<div class="wiki-rank-scope" data-rank-scope>
      ${s.values.length ? rankSlider(key, MAX_RANK, rank) : ''}
      <p class="copy-14 wiki-text">${s.text ? rich(s.text, s.values, rank) : html`<span class="secondary">No description on the wiki yet.</span>`}</p>
      ${isLast
        ? html`<p class="copy-13 secondary wiki-note">
            Ranks 1–4 at P0; each Potential adds one, up to ${1 + MAX_POTENTIAL}–${MAX_RANK} at P${MAX_POTENTIAL}.
            ${p !== null ? html`<span class="wiki-em">Yours: P${p}, ranks ${1 + p}–${4 + p}.</span>` : ''}
          </p>`
        : ''}
    </div>`,
  );
}

function skillsSection(id: string, w: WikiWeapon, owned: Owned | undefined): Html {
  if (!w.skills.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Skills</h2></div>
    <div class="card wiki-accs">${w.skills.map((s, i) => skillRow(id, i, s, i === w.skills.length - 1 && w.skills.length > 1, owned))}</div>
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

function detailPage(id: string, w: WikiWeapon, attribution: WikiAttribution, a: Analysis | null, redraw: () => void): Html {
  const owned = ownedOf(a, 'weap')?.get(id);
  return html`${hero(id, w, owned)}
    <main class="container fade-in wiki-page">
      ${ownedSection('weap', w.name, a, owned)}
      ${wieldersSection(id, redraw)}
      <div class="wiki-cols">
        <div class="wiki-col">${statsSection(w)}${potentialSection(w, owned, !!a)}</div>
        <div class="wiki-col">${skillsSection(id, w, owned)}${tuningSection(w)}</div>
      </div>
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
      <div class="card"><div class="card-body copy-14">Rate-up on <b>${p.banner.name}</b>. Its dates are on <a href="/">Home</a>.</div></div></section>` : ''}`;
  return previewPage('weap', id, p, [['Type', p.type]], [], about, attribution);
}

/** /arsenal/info[/<wpn id>]; `redraw` runs once the data has loaded. */
export function weaponInfoPage(id: string | undefined, a: Analysis | null, redraw: () => void): Html {
  const f = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  file = f.data;
  previews = previewsOf(redraw);
  if (!file) return loadingOrFailed('weap', 'Weapon info', f.failed);
  if (!id) return indexPage(file, ownedOf(a, 'weap'));
  const w = file.weapons[id];
  // Not on the wiki yet: the version guide's preview, if it has one.
  const p = !w ? previews?.weapons[id] : undefined;
  if (p && previews) return weaponPreview(id, p, previews.attribution);
  if (!w) return statusPage('weap', 'Weapon info', html`There's no wiki data for this weapon yet. <a href="${weaponInfoHref()}">See all weapons</a>. ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')} may have it.`);
  return detailPage(id, w, file.attribution, a, redraw);
}

export function weaponInfoTitle(id: string | undefined): string {
  const w = id && (file?.weapons[id] ?? previews?.weapons[id]);
  return w ? w.name : 'Weapon info';
}
