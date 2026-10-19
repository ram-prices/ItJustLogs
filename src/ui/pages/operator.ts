import type { Analysis } from '../../domain/analyze';
import { endministratorOf, ENDMINISTRATORS, extrasOf, isEndministrator, type Owned } from '../../domain/owned';
import { state } from '../../state';
import { operatorDiscord, operatorSkillDiscord } from '../../domain/share';
import { skillSets, wikiId, type WikiAttribution, type WikiOperator, type WikiOperatorFile, type WikiSkill } from '../../domain/wiki';
import { badge, icon, itemImg, rarity } from '../components';
import { html, type Html } from '../html';
import { copyLinkButton, credit, crumbs, external, infoHref, kindNav, loadingOrFailed, ownedOf, ownedSection, ownedTag, pips, potentialLevel, rankSlider, rich, sliderRank, statusPage, wikiFile } from './info';

/**
 * Operator info pages (/operators/info and /operators/info/<chr id>): class,
 * element, stats, skills and talents from the community wiki's data, which
 * ef-assets snapshots, plus what the player's pulls say (copies, Potential).
 * Works without an import. The data is CC BY-SA 4.0, so every page credits
 * endfield.wiki.gg.
 */

const MAX_RANK = 12;

/** Toast after "Copy to Discord" (right-click or long-press the header or a skill). */
const COPIED = 'Copied. Paste it in Discord.';

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
    .filter(([, o]) => !seen.has(o.page) && !!seen.add(o.page))
    .sort(([, a], [, b]) => b.rarity - a.rarity || a.name.localeCompare(b.name));
  const have = owned ? ops.filter(([id]) => owned.get(id)?.copies).length : 0;
  return html`<div class="page-header"><div class="container page-header-inner"><div class="min0">
      ${crumbs('char')}
      <h1 class="heading-32">Operator info</h1>
      <p class="copy-16">Class, attributes, skills and talents for every operator${owned ? html`. You have ${have} of ${ops.length}` : ''}.</p>
    </div><div class="row">${kindNav('char', 'info')}</div></div></div>
    <main class="container fade-in">
      <div class="wiki-grid">
        ${ops.map(([id, o]) => {
          const mine = owned?.get(id);
          return html`<a class="wiki-tile card${owned && !mine?.copies ? ' unowned' : ''}" href="${operatorInfoHref(id)}">
            ${itemImg('char', id, 'wiki-tile-portrait')}
            <span class="wiki-tile-text min0">
              <span class="wiki-tile-name ellipsis">${o.name}</span>
              <span class="label-12 secondary">${rarity(o.rarity)} · ${o.class} · ${o.element}</span>
            </span>
            ${ownedTag(mine)}
          </a>`;
        })}
      </div>
      ${credit(f.attribution)}
    </main>`;
}

// ---------------------------------------------------------------------------
// One operator
// ---------------------------------------------------------------------------

function hero(id: string, o: WikiOperator, owned: Owned | undefined): Html {
  return html`<section class="wiki-hero" data-discord="${operatorDiscord(id, o)}" data-discord-note="${COPIED}">
    ${itemImg('char', id, 'wiki-hero-bg')}
    <div class="container wiki-hero-inner">
      ${itemImg('char', id, 'wiki-hero-portrait')}
      <div class="min0 wiki-hero-text">
        ${crumbs('char', o.name)}
        <div class="wiki-stars" style="color:var(--r${o.rarity})" aria-label="${o.rarity} star">${'★'.repeat(o.rarity)}</div>
        <h1 class="heading-32">${o.name}</h1>
        <div class="wiki-facts">
          <span class="wiki-fact"><span class="wiki-fact-label">Class</span>${o.class}</span>
          <span class="wiki-fact"><span class="wiki-fact-label">Element</span><span class="wk wk-${o.element.toLowerCase().replace(/\W/g, '')}">${o.element}</span></span>
          <span class="wiki-fact"><span class="wiki-fact-label">Weapon</span>${o.weapon}</span>
          ${o.faction ? html`<span class="wiki-fact"><span class="wiki-fact-label">Faction</span>${o.faction}</span>` : ''}
          ${owned?.copies ? html`<span class="wiki-fact"><span class="wiki-fact-label">Potential</span><span class="wiki-fact-pot">${potentialLevel(owned)}${pips(owned.potential)}</span></span>` : ''}
        </div>
        ${o.tags.length ? html`<div class="wiki-tags">${o.tags.map((t) => badge(t, 'outline'))}</div>` : ''}
      </div>
      <div class="row wiki-hero-link">
        ${copyLinkButton(id)}
        <a class="btn secondary sm" href="${o.page}" target="_blank" rel="noopener">${icon('open_in_new')}<span class="hide-sm">Wiki page</span></a>
      </div>
    </div>
  </section>`;
}

const STAT_ROWS: [keyof NonNullable<WikiOperator['stats']>, string][] = [
  ['hp', 'HP'],
  ['atk', 'ATK'],
  ['strength', 'Strength'],
  ['agility', 'Agility'],
  ['intellect', 'Intellect'],
  ['will', 'Will'],
];

function statsSection(o: WikiOperator): Html {
  const s = o.stats;
  if (!s) return html``;
  const tag = (label: string) =>
    label === o.mainAttribute ? badge('Main', 'purple') : label === o.secondaryAttribute ? badge('Secondary') : '';
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Attributes</h2></div>
    <div class="card">
      <div class="table-wrap">
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
      </div>
      <div class="card-footer">
        <span>Critical rate <b class="num wiki-em">${s.critRate != null ? `${Math.round(s.critRate * 1000) / 10}%` : '–'}</b></span>
        <span>Attack speed <b class="num wiki-em">${s.attackSpeed ?? '–'}</b></span>
        <span>Range <b class="wiki-em">${s.range ?? '–'}</b></span>
      </div>
    </div>
  </section>`;
}

function skillCard(id: string, o: WikiOperator, s: WikiSkill, rank: number): Html {
  return html`<article class="card wiki-skill" data-discord="${operatorSkillDiscord(id, o, s)}" data-discord-note="${COPIED}">
    <div class="wiki-skill-head">
      <span class="wiki-skill-type">${s.type}</span>
      <h3 class="heading-16">${s.name}</h3>
    </div>
    <p class="copy-14 wiki-text">${rich(s.description)}</p>
    ${s.info ? html`<p class="copy-13 secondary wiki-text">${rich(s.info)}</p>` : ''}
    ${s.values.length
      ? html`<dl class="wiki-values">
          ${s.values.map(
            (v) => html`<div><dt>${v.label}</dt><dd class="num" data-ranks="${v.ranks.join('|')}">${v.ranks[Math.min(rank, v.ranks.length) - 1] ?? '–'}</dd></div>`,
          )}
        </dl>`
      : ''}
  </article>`;
}

function skillsSection(id: string, o: WikiOperator): Html {
  if (!o.skills.length) return html``;
  const rank = sliderRank('char', MAX_RANK);
  return html`<section class="section">
    <div class="section-head">
      <h2 class="heading-20">Combat skills</h2>
      ${rankSlider('char', MAX_RANK)}
    </div>
    ${skillSets(o.skills).map(
      (set) => html`${set.variant ? html`<h3 class="heading-16 wiki-variant">${set.variant}</h3>` : ''}
        <div class="wiki-skills">${set.skills.map((s) => skillCard(id, o, s, rank))}</div>`,
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
      ${imported ? html`<span class="label-13 secondary">${have > 0 ? `${have} of ${o.potentials.length} unlocked by your copies` : 'None unlocked yet'}</span>` : ''}
    </div>
    <ol class="card wiki-list">
      ${o.potentials.map((p) => {
        const on = p.rank <= have;
        return html`<li class="${imported ? (on ? 'on' : 'off') : ''}">
          <span class="wiki-pot" title="Unlocked at P${p.rank}">${on ? icon('check') : `P${p.rank}`}</span>
          <div class="min0"><div class="label-14">${p.name}</div><p class="copy-14 secondary wiki-text">${rich(p.description)}</p></div>
        </li>`;
      })}
    </ol>
  </section>`;
}

function talentsSection(o: WikiOperator): Html {
  if (!o.talents.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Talents</h2></div>
    <div class="wiki-skills">
      ${o.talents.map(
        (t) => html`<article class="card wiki-skill">
          <div class="wiki-skill-head"><h3 class="heading-16">${t.name}</h3></div>
          <ul class="wiki-levels">
            ${t.levels.map((l) => html`<li>${l.requires ? html`<span class="wiki-req">${l.requires}</span>` : ''}<span class="copy-14 wiki-text">${rich(l.description)}</span></li>`)}
          </ul>
        </article>`,
      )}
    </div>
  </section>`;
}

function baseSkillsSection(o: WikiOperator): Html {
  if (!o.baseSkills.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Base skills</h2></div>
    <div class="wiki-skills">
      ${o.baseSkills.map(
        (b) => html`<article class="card wiki-skill">
          <div class="wiki-skill-head"><span class="wiki-skill-type">${b.facility}</span><h3 class="heading-16">${b.name}</h3></div>
          <ul class="wiki-levels">
            ${b.levels.map((l) => html`<li><span class="wiki-req">${[b.name + (l.grade ? ` ${l.grade}` : ''), l.requires].filter(Boolean).join(' · ')}</span><span class="copy-14 wiki-text">${rich(l.description)}</span></li>`)}
          </ul>
        </article>`,
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

function detailPage(id: string, o: WikiOperator, attribution: WikiAttribution, a: Analysis | null): Html {
  const owned = ownedOf(a, 'char')?.get(id);
  return html`${hero(id, o, owned)}
    <main class="container fade-in wiki-page">
      ${ownedSection('char', o.name, a, owned)}
      ${statsSection(o)}
      ${skillsSection(id, o)}
      ${potentialsSection(o, owned, !!a)}
      ${talentsSection(o)}
      ${baseSkillsSection(o)}
      ${profileSection(o)}
      ${credit(attribution, o.page)}
    </main>`;
}

let file: WikiOperatorFile | null = null;

/** /operators/info[/<chr id>]; `redraw` runs once the data has loaded. */
export function operatorInfoPage(id: string | undefined, a: Analysis | null, redraw: () => void): Html {
  const f = wikiFile<WikiOperatorFile>('operators.json', redraw);
  file = f.data;
  if (!file) return loadingOrFailed('char', 'Operator info', f.failed);
  if (!id) return indexPage(file, ownedOf(a, 'char'));
  const o = file.operators[wikiId(id)];
  if (!o) return statusPage('char', 'Operator info', html`There's no wiki data for this operator yet. <a href="${operatorInfoHref()}">See all operators</a>. ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')} may have it.`);
  return detailPage(wikiId(id), o, file.attribution, a);
}

/** Tab title for the operator info pages. */
export function operatorInfoTitle(id: string | undefined): string {
  const o = id && file?.operators[wikiId(id)];
  return o ? o.name : 'Operator info';
}
