import { EF_ASSETS_CDN } from '../../domain/banners';
import {
  blockOf,
  decodeShareCode,
  EMPTY_SELECTION,
  encodeShareCode,
  missionText,
  nextDate,
  phaseOf,
  rulesSections,
  seasonsInOrder,
  seasonStatus,
  STATUS_LABEL,
  toggle,
  totalOf,
  type Criterion,
  type Enemy,
  type Reward,
  type Season,
  type SeasonFile,
  type SeasonIndex,
  type SeasonStatus,
  type Selection,
} from '../../domain/contracts';
import { SERVER_LABEL, timeOn, type Server, type ServerTimes } from '../../domain/schedule';
import { currentServer } from '../../state';
import { loadContractPicks, saveContractPicks } from '../../store';
import { tip, tipNote, tipRow } from '../charts';
import { toast } from '../common';
import { badge, icon } from '../components';
import { fmtDate, fmtInt, html, raw, type Html } from '../html';
import { copyText, span } from './home';
import { external, wikiFile } from './info';

/**
 * /contracts: the Contingency Contract seasons, the running one first.
 * /contracts/<season>: its Test Criteria board, which is also the picker, then
 * enemies, missions, shop and medal. Data is ef-assets cc/ (domain/contracts.ts).
 */

const NOT_KNOWN = 'Not yet known';

const asset = (path: string): string => `${EF_ASSETS_CDN}/${path}`;
const STATUS_TONE: Record<SeasonStatus, 'green' | 'amber' | 'blue' | 'gray'> = { live: 'green', shop: 'amber', upcoming: 'blue', ended: 'gray' };

const statusBadge = (s: Season, now: number, server: Server): Html => {
  const status = seasonStatus(s, now, server);
  return badge(STATUS_LABEL[status], STATUS_TONE[status]);
};

const dateOn = (t: ServerTimes | null, server: Server): string => {
  const at = timeOn(t, server);
  return at == null ? 'Not announced' : fmtDate(at, true);
};

/** A page with one line on it, for loading and missing data. */
const notice = (title: string, message: Html | string): Html =>
  html`<div class="page-header"><div class="container page-header-inner"><div class="min0"><h1 class="heading-32">${title}</h1></div></div></div>
    <main class="container fade-in"><div class="card"><div class="empty"><p class="copy-14 secondary">${message}</p></div></div></main>`;

const rewardChips = (rewards: Reward[]): Html =>
  html`<span class="reward-chips">
    ${rewards.map(
      (r) => html`<span class="reward-chip cc-reward"><img src="${asset(r.icon)}" alt="" loading="lazy" decoding="async" data-fallback />${r.item}${r.count == null ? '' : html` <b>×${fmtInt(r.count)}</b>`}</span>`,
    )}
  </span>`;

/** The next date that matters on this server, as a countdown. */
function nextFact(s: Season, now: number, server: Server): Html {
  const next = nextDate(s, now, server);
  if (!next) return html``;
  return html`<span class="wiki-fact"><span class="wiki-fact-label">${next.label}</span>in ${span(next.at - now)} · ${fmtDate(next.at, true)}</span>`;
}

function hero(title: string, art: string, crumbs: Html, facts: Html): Html {
  return html`<section class="wiki-hero art-hero event-hero cc-hero has-art">
    <img class="wiki-hero-art" src="${art}" alt="" decoding="async" data-fallback />
    <div class="container wiki-hero-inner">
      <div class="min0 wiki-hero-text">
        ${crumbs}
        <h1 class="heading-32">${title}</h1>
        <div class="wiki-facts">${facts}</div>
      </div>
    </div>
  </section>`;
}

/** The game's text writes names as [Key Criteria]: plain here, like event details. */
const unbracket = (s: string): string => s.replace(/\[|\]/g, '');

// ---------------------------------------------------------------------------
// /contracts
// ---------------------------------------------------------------------------

function seasonCard(s: Season, now: number, server: Server): Html {
  return html`<a class="card cc-season" href="/contracts/${s.id}">
    <img class="cc-season-art" src="${asset(s.banner)}" alt="" loading="lazy" decoding="async" data-fallback />
    <div class="cc-season-body">
      <div class="cc-season-head"><b>${s.shortName}</b>${statusBadge(s, now, server)}</div>
      <div class="label-13 secondary">${dateOn(s.start, server)} – ${dateOn(s.end, server)}</div>
      <div class="label-13 secondary">${s.criteria} criteria</div>
    </div>
  </a>`;
}

function seasonsPage(index: SeasonIndex, redraw: () => void): Html {
  const now = Date.now();
  const server = currentServer();
  const [lead, ...rest] = seasonsInOrder(index.seasons, now, server);
  if (!lead) return notice('Contingency Contract', 'No seasons yet.');
  const file = wikiFile<SeasonFile>(`seasons/${lead.id}.json`, redraw, 'cc').data;
  const rules = rulesSections(file?.rules ?? '').find((r) => r.title === 'Event Rules');
  return html`${hero(
      'Contingency Contract',
      asset(lead.art),
      html``,
      html`<span class="wiki-fact"><span class="wiki-fact-label">Season</span><a class="cc-hero-link" href="/contracts/${lead.id}">${lead.shortName}</a></span>
        <span class="wiki-fact"><span class="wiki-fact-label">Status (${SERVER_LABEL[server]})</span>${statusBadge(lead, now, server)}</span>
        ${nextFact(lead, now, server)}`,
    )}
    <main class="container fade-in">
      <section class="section cc-lead">
        <p class="copy-16 cc-text">${lead.desc}</p>
        ${rules ? html`<ul class="cc-rules copy-14">${rules.lines.slice(0, 4).map((l) => html`<li>${unbracket(l)}</li>`)}</ul>` : ''}
        <a class="btn primary" href="/contracts/${lead.id}">${icon('gavel')}Open ${lead.shortName}</a>
      </section>
      ${rest.length
        ? html`<section class="section">
            <div class="section-head"><h2 class="heading-20">Seasons</h2></div>
            <div class="cc-seasons">${rest.map((s) => seasonCard(s, now, server))}</div>
          </section>`
        : ''}
    </main>`;
}

// ---------------------------------------------------------------------------
// The board and picker
// ---------------------------------------------------------------------------

/** The open season page: what the picker's buttons and code field work on. */
let view: { season: Season; file: SeasonFile; phase: number } | null = null;
/** Selections by season, as saved. */
const picks = loadContractPicks();
/** A code that didn't read, kept in the field with its message. */
let badCode: { season: string; text: string } | null = null;

const selectionOf = (season: string): Selection => picks[season] ?? EMPTY_SELECTION;

function select(season: string, sel: Selection): void {
  picks[season] = sel;
  saveContractPicks(picks);
}

const nameOf = (c: Criterion): string => c.name ?? NOT_KNOWN;

function criterionTip(c: Criterion, s: Season, f: SeasonFile, server: Server): string {
  const others = c.conflict ? f.criteria.filter((o) => o.conflict === c.conflict && o !== c) : [];
  return tip(nameOf(c), [
    tipNote(c.desc ?? NOT_KNOWN),
    tipRow('Points', String(c.points)),
    tipRow('First clear', `${c.firstClear} ${s.currency.name}`),
    ...(others.length ? [tipRow('Instead of', others.map(nameOf).join(', '))] : []),
    ...(c.key ? [tipRow(f.keys[c.key]?.keyLabel ?? 'Key', 'Opens Locked Criteria')] : []),
    ...(c.locks.length ? [tipRow(f.keys[c.locks[0]]?.lockLabel ?? 'Locked', 'Needs a Key Criteria')] : []),
    ...(c.unlockTotal ? [tipRow('Needs total', String(c.unlockTotal))] : []),
    ...(c.unlockPhase > 1 ? [tipRow('Opens', dateOn(s.batch2, server))] : []),
  ]);
}

function tile(c: Criterion, s: Season, f: SeasonFile, sel: Selection, phase: number, server: Server): Html {
  const on = sel.ids.includes(c.id);
  const blocked = !on && !!blockOf(c, f.criteria, sel, phase);
  const keyColor = (k: string) => `color:${f.keys[k]?.color ?? 'inherit'}`;
  const named = !c.numeral || c.name?.endsWith(c.numeral);
  return html`<button
    type="button"
    class="cc-tag${on ? ' on' : ''}${blocked ? ' blocked' : ''}"
    style="grid-column:${c.col};grid-row:${c.row + 1}"
    data-action="cc-pick"
    data-id="${c.id}"
    data-conflict="${c.conflict ?? ''}"
    data-key="${c.key ?? ''}"
    data-locks="${c.locks.join(' ')}"
    data-tip="${criterionTip(c, s, f, server)}"
    aria-pressed="${on ? 'true' : 'false'}"
    aria-disabled="${blocked ? 'true' : 'false'}"
  >
    <span class="cc-tag-top">
      <img class="cc-tag-icon" src="${asset(c.icon)}" alt="" loading="lazy" decoding="async" data-fallback />
      <span class="cc-tag-score"><span class="cc-points p${c.points}">${c.points}</span>${named ? '' : html`<span class="label-12 secondary">${c.numeral}</span>`}</span>
    </span>
    <span class="cc-tag-name${c.name ? '' : ' unknown'}">${nameOf(c)}</span>
    <span class="cc-tag-foot">
      <span class="cc-clear label-12 secondary num"><img src="${asset(s.currency.icon)}" alt="" loading="lazy" decoding="async" data-fallback />${c.firstClear}</span>
      <span class="cc-tag-marks">
        ${c.key ? html`<span class="cc-mark" style="${keyColor(c.key)}">${icon('key')}</span>` : ''}
        ${c.locks.map((k) => html`<span class="cc-mark" style="${keyColor(k)}">${icon('lock')}</span>`)}
        ${c.unlockPhase > 1 ? html`<span class="cc-mark-text">P2</span>` : ''}
      </span>
    </span>
  </button>`;
}

/** The Criteria Sets over the board: the columns each cleared total opens. */
function sets(f: SeasonFile, sel: Selection): Html {
  const totals = [...new Set(f.criteria.map((c) => c.unlockTotal))].sort((a, b) => a - b);
  return html`${totals.map((total) => {
    const cols = f.criteria.filter((c) => c.unlockTotal === total).map((c) => c.col);
    const locked = total > sel.best;
    return html`<div class="cc-set${locked ? ' locked' : ''}" style="grid-column:${Math.min(...cols)} / ${Math.max(...cols) + 1}">
      ${locked ? icon('lock') : ''}<span>${total ? `Total ${total}+` : 'Open'}</span>
    </div>`;
  })}`;
}

function legend(s: Season, f: SeasonFile, server: Server): Html {
  const keys = Object.values(f.keys);
  const hasPhase2 = f.criteria.some((c) => c.unlockPhase > 1);
  return html`<div class="cc-legend label-13 secondary">
    <span class="cc-clear"><img src="${asset(s.currency.icon)}" alt="" loading="lazy" decoding="async" data-fallback />First clear</span>
    <span>Highlighted together: pick one</span>
    ${keys.map(
      (k) => html`<span><span class="cc-mark" style="color:${k.color}">${icon('key')}</span>${k.keyLabel}</span>
        <span><span class="cc-mark" style="color:${k.color}">${icon('lock')}</span>${k.lockLabel}</span>`,
    )}
    ${hasPhase2 ? html`<span><span class="cc-mark-text">P2</span>Opens ${dateOn(s.batch2, server)}</span>` : ''}
  </div>`;
}

function picker(s: Season, f: SeasonFile, sel: Selection, phase: number): Html {
  const total = totalOf(f.criteria, sel.ids);
  const bad = badCode?.season === s.id ? badCode.text : null;
  const code = encodeShareCode(f.criteria, sel.ids, f.grid.cols);
  return html`<div class="cc-picker">
    <span class="cc-total"><span class="wiki-fact-label">Total</span><b class="num">${total}</b><span class="secondary num">/ ${f.maxTotalByPhase[phase] ?? f.maxTotal}</span></span>
    <label class="cc-code">
      <span class="wiki-fact-label">Share code</span>
      <input class="input" data-cc-code value="${bad ?? code}" autocomplete="off" spellcheck="false" aria-invalid="${bad != null ? 'true' : 'false'}" />
    </label>
    <button class="btn secondary sm" data-action="cc-copy" ${raw(sel.ids.length ? '' : 'disabled')}>${icon('content_copy')}Copy</button>
    <button class="btn secondary sm" data-action="cc-clear" ${raw(sel.ids.length || sel.best ? '' : 'disabled')}>${icon('close')}Clear</button>
    ${bad != null ? html`<span class="label-13 cc-code-error" role="alert">Not a code for this season.</span>` : ''}
  </div>`;
}

function selected(f: SeasonFile, sel: Selection): Html {
  const list = f.criteria.filter((c) => sel.ids.includes(c.id));
  if (!list.length) return html``;
  return html`<div class="card cc-picked">
    ${list.map(
      (c) => html`<div class="cc-picked-row">
        <span class="cc-points p${c.points}">${c.points}</span>
        <b>${nameOf(c)}</b>
        <span class="copy-14 secondary">${c.desc ?? NOT_KNOWN}</span>
      </div>`,
    )}
  </div>`;
}

function criteriaSection(s: Season, f: SeasonFile, phase: number, server: Server): Html {
  const sel = selectionOf(s.id);
  const open = f.criteria.filter((c) => c.unlockPhase <= phase).length;
  return html`<section class="section" id="cc-criteria">
    <div class="section-head"><h2 class="heading-20">Test Criteria</h2><span class="label-13 secondary">${open} of ${s.criteria} open</span></div>
    ${picker(s, f, sel, phase)}
    <div class="card cc-board-card">
      <div class="cc-board" style="--cols:${f.grid.cols};--rows:${f.grid.rows}">${sets(f, sel)}${f.criteria.map((c) => tile(c, s, f, sel, phase, server))}</div>
    </div>
    ${legend(s, f, server)}
    ${selected(f, sel)}
  </section>`;
}

// ---------------------------------------------------------------------------
// The rest of a season
// ---------------------------------------------------------------------------

function enemyRow(e: Enemy | undefined, id: string, count: number): Html {
  if (!e) return html`<tr><td class="grow">${NOT_KNOWN}</td><td class="right num">${count}</td><td class="right" colspan="3"></td></tr>`;
  const hp = Math.round(e.hp * (1 + e.hpBonus));
  return html`<tr data-enemy="${id}">
    <td class="grow">
      <div class="cc-enemy">
        ${e.portrait ? html`<img class="cc-enemy-art" src="${asset(e.portrait)}" alt="" loading="lazy" decoding="async" data-fallback />` : ''}
        <div class="min0">
          <b>${e.name}</b>
          ${e.abilities?.length ? html`<div class="cc-abilities label-13 secondary">${e.abilities.join(' · ')}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="right num">${count}</td>
    <td class="right num">${e.level}</td>
    <td class="right num">${e.hpBonus ? html`<span data-tip="${tip('', [tipRow('Base HP', fmtInt(e.hp)), tipRow('Bonus', `+${Math.round(e.hpBonus * 100)}%`)])}">${fmtInt(hp)}</span>` : fmtInt(hp)}</td>
    <td class="right num">${fmtInt(e.atk)}</td>
  </tr>`;
}

function enemiesSection(f: SeasonFile): Html {
  // The stage's own waves first, then the ones criteria change.
  const noteOf = (v: number) => f.variants.find((x) => x.id === v)?.note ?? null;
  const variants = [...new Set(f.waves.map((w) => w.variant))].sort((a, b) => Number(!!noteOf(a)) - Number(!!noteOf(b)));
  return html`<section class="section" id="cc-enemies">
    <div class="section-head"><h2 class="heading-20">Enemies</h2></div>
    ${variants.map((v) => {
      return html`${variants.length > 1 ? html`<h3 class="heading-16 cc-variant">${noteOf(v) ?? 'Standard'}</h3>` : ''}
        <div class="card table-wrap">
          <table class="table cc-enemies">
            <thead>
              <tr><th class="grow">Enemy</th><th class="right">Count</th><th class="right">Level</th><th class="right">HP</th><th class="right">ATK</th></tr>
            </thead>
            ${f.waves
              .filter((w) => w.variant === v)
              .map(
                (w) => html`<tbody>
                  <tr class="cc-wave"><th colspan="5">Wave ${w.wave}</th></tr>
                  ${w.enemies.map((x) => enemyRow(f.enemies[x.id], x.id, x.count))}
                </tbody>`,
              )}
          </table>
        </div>`;
    })}
  </section>`;
}

function missionsSection(s: Season, f: SeasonFile, server: Server): Html {
  const groups = [...new Set(f.missions.map((m) => m.group))];
  return html`<section class="section" id="cc-missions">
    <div class="section-head"><h2 class="heading-20">Missions</h2><span class="label-13 secondary">${f.missions.length} missions</span></div>
    ${groups.map(
      (g) => html`${groups.length > 1 ? html`<h3 class="heading-16 cc-variant">${g}</h3>` : ''}
        <div class="card event-rows">
          ${f.missions
            .filter((m) => m.group === g)
            .map((m) => {
              const { title, text } = missionText(m);
              const later = (timeOn(m.opens, server) ?? 0) > timeOn(s.start, server)!;
              return html`<div class="event-row cc-mission">
                <div class="min0">
                  <div class="event-row-label">${title}</div>
                  ${text ? html`<div class="label-13 secondary cc-text">${text}</div>` : ''}
                  ${later ? html`<div class="label-13 secondary">Opens ${dateOn(m.opens, server)}</div>` : ''}
                </div>
                ${rewardChips(m.reward)}
              </div>`;
            })}
        </div>`,
    )}
  </section>`;
}

function shopSection(s: Season, f: SeasonFile): Html {
  // The unlimited rows (T-Creds) have no end to buy.
  const all = f.shop.reduce((sum, i) => sum + i.price * i.limit, 0);
  return html`<section class="section" id="cc-shop">
    <div class="section-head"><h2 class="heading-20">Shop</h2><span class="label-13 secondary">${fmtInt(all)} ${s.currency.name} for everything</span></div>
    <div class="card table-wrap">
      <table class="table">
        <thead>
          <tr><th class="grow">Item</th><th class="right">Count</th><th class="right">Price</th><th class="right">Limit</th></tr>
        </thead>
        <tbody>
          ${f.shop.map(
            (i) => html`<tr>
              <td class="grow"><span class="cc-shop-item"><img class="cc-shop-icon" src="${asset(i.icon)}" alt="" loading="lazy" decoding="async" data-fallback />${i.item}</span></td>
              <td class="right num">${fmtInt(i.count)}</td>
              <td class="right num">${fmtInt(i.price)}</td>
              <td class="right num">${i.limit ? fmtInt(i.limit) : 'No limit'}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}

function medalSection(s: Season, f: SeasonFile): Html {
  const earned = f.missions.flatMap((m) => m.reward).reduce((n, r) => n + (r.item === s.currency.name ? (r.count ?? 0) : 0), 0);
  return html`<section class="section" id="cc-medal">
    <div class="section-head"><h2 class="heading-20">Medal and rewards</h2></div>
    <div class="card cc-medal">
      <img class="cc-medal-art" src="${asset(f.medal.icon)}" alt="" loading="lazy" decoding="async" data-fallback />
      <div class="min0">
        <b class="heading-16">${f.medal.name}</b>
        <p class="copy-14 secondary">${f.medal.desc}</p>
        <p class="copy-14">${unbracket(f.medal.howTo)}</p>
      </div>
      ${f.medal.plate && f.medal.plateIcon
        ? html`<img class="cc-medal-art" src="${asset(f.medal.plateIcon)}" alt="" loading="lazy" decoding="async" data-fallback />
            <div class="min0">
              <b class="heading-16">Plated</b>
              <p class="copy-14">${unbracket(f.medal.plate)}</p>
            </div>`
        : ''}
    </div>
    <div class="card card-body cc-rewards">
      ${earned ? html`<div class="wiki-fact"><span class="wiki-fact-label">From missions</span>${fmtInt(earned)} ${s.currency.name}</div>` : ''}
      ${rewardChips(f.rewards)}
    </div>
  </section>`;
}

function credits(f: SeasonFile, index: SeasonIndex): Html {
  const a = index.attribution;
  const from = a ?? f.attribution;
  if (!from || !(a || f.criteria.some((c) => c.descSource === 'wiki'))) return html``;
  return html`<p class="wiki-credit copy-13">
    ${icon('menu_book')}
    <span>Criteria text from ${external(from.url, from.text)}${a ? `. Snapshot of ${a.fetched}` : ''}.</span>
  </p>`;
}

/** The stage's facts, and the rules folded under them. */
function stage(f: SeasonFile): Html {
  const parts = [
    ...rulesSections(f.stageRules).map((r) => ({ ...r, title: r.title || 'Stage' })),
    ...rulesSections(f.feature).map((r) => ({ ...r, title: r.title || 'Enemies' })),
    ...rulesSections(f.rules),
  ];
  return html`<section class="cc-stage">
    <div class="wiki-facts">
      <span class="wiki-fact"><span class="wiki-fact-label">Recommended level</span>${f.recommendLv}</span>
      <span class="wiki-fact"><span class="wiki-fact-label">Max total</span>${f.maxTotal}</span>
      ${f.timer == null ? '' : html`<span class="wiki-fact"><span class="wiki-fact-label">Time limit</span>${Math.floor(f.timer / 60)}:${String(f.timer % 60).padStart(2, '0')}</span>`}
    </div>
    <details class="card cc-rules-card">
      <summary class="label-14">Rules</summary>
      <div class="cc-rules-body">
        ${parts.map(
          (r) => html`<div>
            <h3 class="heading-14">${r.title}</h3>
            <ul class="cc-rules copy-14">${r.lines.map((l) => html`<li>${unbracket(l)}</li>`)}</ul>
          </div>`,
        )}
      </div>
    </details>
  </section>`;
}

const SECTIONS: [string, string][] = [
  ['cc-criteria', 'Test Criteria'],
  ['cc-enemies', 'Enemies'],
  ['cc-missions', 'Missions'],
  ['cc-shop', 'Shop'],
  ['cc-medal', 'Medal'],
];

function seasonPage(s: Season, f: SeasonFile | null, failed: boolean, index: SeasonIndex): Html {
  const now = Date.now();
  const server = currentServer();
  const phase = phaseOf(s, now, server);
  view = f ? { season: s, file: f, phase } : null;
  return html`${hero(
      s.name,
      asset(s.banner),
      html`<nav class="breadcrumb wiki-crumbs" aria-label="Breadcrumb"><a href="/contracts">Contingency Contract</a>${icon('chevron_right')}<span class="wiki-em">${s.shortName}</span></nav>`,
      html`<span class="wiki-fact"><span class="wiki-fact-label">When (${SERVER_LABEL[server]})</span>${dateOn(s.start, server)} – ${dateOn(s.end, server)}</span>
        <span class="wiki-fact"><span class="wiki-fact-label">Status</span>${statusBadge(s, now, server)}</span>
        ${nextFact(s, now, server)}
        ${seasonStatus(s, now, server) === 'ended' ? '' : html`<span class="wiki-fact"><span class="wiki-fact-label">Shop closes</span>${dateOn(s.shopClose, server)}</span>`}`,
    )}
    <main class="container fade-in">
      ${f
        ? html`<nav class="cc-nav" aria-label="Sections">${SECTIONS.map(([id, label]) => html`<a class="btn secondary sm" href="#${id}">${label}</a>`)}</nav>
            ${stage(f)}
            ${criteriaSection(s, f, phase, server)}${enemiesSection(f)}${missionsSection(s, f, server)}${shopSection(s, f)}${medalSection(s, f)}${credits(f, index)}`
        : html`<section class="section"><p class="copy-14 secondary">${failed ? "Couldn't load this season. Check your connection and reload." : 'Loading…'}</p></section>`}
    </main>`;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function contractsPage(id: string | undefined, redraw: () => void): Html {
  view = null;
  const index = wikiFile<SeasonIndex>('index.json', redraw, 'cc');
  if (!index.data) return notice('Contingency Contract', index.failed ? "Couldn't load the seasons. Check your connection and reload." : 'Loading…');
  if (!id) return seasonsPage(index.data, redraw);
  const s = index.data.seasons.find((x) => x.id === id.toLowerCase());
  if (!s) return notice('Season not found', html`There's no season at that link. <a href="/contracts">All seasons</a>.`);
  const file = wikiFile<SeasonFile>(`seasons/${s.id}.json`, redraw, 'cc');
  return seasonPage(s, file.data, file.failed, index.data);
}

/** The document's title. */
export const contractsTitle = (id: string | undefined): string => (id && view?.season.id === id.toLowerCase() ? view.season.shortName : 'Contingency Contract');

/** A redraw rebuilds the board: keep its sideways scroll and the focus on the tile. */
function keepBoard(id: number): void {
  const left = document.querySelector('.cc-board-card')?.scrollLeft ?? 0;
  queueMicrotask(() => {
    const card = document.querySelector('.cc-board-card');
    if (card) card.scrollLeft = left;
    card?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus({ preventScroll: true });
  });
}

/** The picker's buttons; true when handled. */
export function contractsAction(action: string, el: HTMLElement): boolean {
  if (!view || !action.startsWith('cc-')) return false;
  const { season, file, phase } = view;
  if (action === 'cc-pick') {
    const c = file.criteria.find((x) => x.id === Number(el.dataset.id));
    if (!c) return false;
    badCode = null;
    keepBoard(c.id);
    select(season.id, toggle(c, file.criteria, selectionOf(season.id), phase));
    return true;
  }
  if (action === 'cc-clear') {
    badCode = null;
    select(season.id, EMPTY_SELECTION);
    return true;
  }
  if (action === 'cc-copy') {
    const code = encodeShareCode(file.criteria, selectionOf(season.id).ids, file.grid.cols);
    void copyText(code).then((ok) => toast(ok ? 'Share code copied.' : "Couldn't copy the code.", ok ? 'info' : 'error'));
    return true;
  }
  return false;
}

/** The code field: a code that reads replaces the selection. True when handled. */
export function contractsChange(el: HTMLInputElement): boolean {
  if (!view || el.dataset?.ccCode === undefined) return false;
  const { season, file, phase } = view;
  const ids = decodeShareCode(el.value, file.criteria, file.grid.cols, phase);
  badCode = ids ? null : { season: season.id, text: el.value };
  if (ids) select(season.id, { ids, best: Math.max(selectionOf(season.id).best, totalOf(file.criteria, ids)) });
  return true;
}

/** Hovering or focusing a tile lifts the tiles tied to it: its conflict group, and its key's locks or its locks' keys. */
function relate(e: Event): void {
  const tag = (e.target as HTMLElement).closest?.<HTMLElement>('.cc-tag');
  const board = document.querySelector('.cc-board');
  if (!board) return;
  board.classList.toggle('relating', !!tag);
  for (const t of board.querySelectorAll<HTMLElement>('.cc-tag')) {
    const d = t.dataset;
    const s = tag?.dataset;
    const tied = !!s && (t === tag || (!!s.conflict && d.conflict === s.conflict) || (!!s.key && !!d.locks?.split(' ').includes(s.key)) || (!!d.key && !!s.locks?.split(' ').includes(d.key)));
    t.classList.toggle('related', tied);
  }
}
document.addEventListener('mouseover', relate);
document.addEventListener('focusin', relate);
