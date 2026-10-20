import type { Analysis } from '../../domain/analyze';
import { extrasOf, MAX_COPIES, MAX_POTENTIAL, ownedItems, type Acquisition, type ExtraCopy, type Owned } from '../../domain/owned';
import type { Kind } from '../../domain/types';
import { scheduleLinks } from '../../domain/schedule';
import { SITE_URL } from '../../domain/share';
import {
  fmtSkillValue,
  itemShortLinks,
  parseMarkup,
  shortLinkOf,
  splitPlaceholders,
  type ShortTarget,
  type WikiAttribution,
  type WikiOperatorFile,
  type WikiPreviewFile,
  type WikiWeaponFile,
} from '../../domain/wiki';
import { state } from '../../state';
import { loadWikiFile } from '../../store';
import { badge, icon, itemImg, metric, metrics } from '../components';
import { fmtDate, html, raw, type Html } from '../html';

/**
 * Shared pieces of the info pages (operator.ts, weapon.ts): wiki data loading,
 * wiki text, the credit line, the rank slider and the "Your pulls" panel that
 * ties the page to the player's imported history.
 */

const PATH: Record<Kind, string> = { char: 'operators', weap: 'arsenal' };
const NOUN: Record<Kind, string> = { char: 'Operators', weap: 'Arsenal' };
/** What the banners page of each kind is called (breadcrumbs, the view switch). */
const BANNERS_LABEL: Record<Kind, string> = { char: 'Headhunting', weap: 'Issues' };

/** Link to an item's info page, or the list of all of them. */
export const infoHref = (kind: Kind, id?: string): string => `/${PATH[kind]}/info${id ? `/${encodeURIComponent(id)}` : ''}`;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface Loaded<T> {
  data: T | null;
  failed: boolean;
}
const files = new Map<string, Loaded<unknown> & { loading: boolean; waiting: Set<() => void> }>();

/**
 * The wiki file if it's loaded; starts loading it if not, and redraws (with
 * every `redraw` asked for while it loaded) when it's in.
 */
export function wikiFile<T>(file: string, redraw: () => void): Loaded<T> {
  let f = files.get(file);
  if (!f) files.set(file, (f = { data: null, failed: false, loading: false, waiting: new Set() }));
  if (!f.data) f.waiting.add(redraw);
  if (!f.data && !f.loading) {
    const entry = f;
    entry.loading = true;
    entry.failed = false;
    const done = () => {
      entry.loading = false;
      const fns = [...entry.waiting];
      entry.waiting.clear();
      fns.forEach((fn) => fn());
    };
    loadWikiFile<T>(file).then(
      (d) => {
        entry.data = d;
        done();
      },
      () => {
        entry.failed = true;
        done();
      },
    );
  }
  return f as Loaded<T>;
}

const linkCache = new WeakMap<object, { weps: object; pre: object | null; map: Map<string, ShortTarget> }>();

/**
 * Every short link (/si, /lunar-calling), once both wiki files are in; starts
 * loading them (redrawing when done) if not. `map` null while loading.
 */
export function shortLinkMap(redraw: () => void): { map: Map<string, ShortTarget> | null; failed: boolean } {
  const ops = wikiFile<WikiOperatorFile>('operators.json', redraw);
  const weps = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  const pre = previewsOf(redraw);
  if (!ops.data || !weps.data) return { map: null, failed: ops.failed || weps.failed };
  let c = linkCache.get(ops.data);
  if (!c || c.weps !== weps.data || c.pre !== pre) {
    // Unreleased operators and weapons get theirs too (/argent-flow); the wiki's names come first.
    const map = itemShortLinks({ ...pre?.operators, ...ops.data.operators }, { ...pre?.weapons, ...weps.data.weapons });
    linkCache.set(ops.data, (c = { weps: weps.data, pre, map }));
  }
  return { map: c.map, failed: false };
}

/**
 * The version guide's previews of unreleased operators and weapons, once
 * loaded (null until then, or if they can't be: pages don't wait on them).
 */
export function previewsOf(redraw: () => void): WikiPreviewFile | null {
  return wikiFile<WikiPreviewFile>('previews.json', redraw).data;
}

/**
 * The banner an unreleased operator or weapon is the rate-up of, with a
 * button to its page (`/banners/<name>`, which opens Home at its card) once
 * the schedule has it.
 */
export function rateUpCard(banner: { name: string | null; poolId: string | null }): Html {
  if (!banner.name) return html``;
  const links = scheduleLinks(state.schedule);
  const b = state.schedule.banners.find((x) => (banner.poolId && x.poolId === banner.poolId) || x.name.trim().toLowerCase() === banner.name!.trim().toLowerCase());
  const href = b ? links.get(b) : undefined;
  return html`<div class="card"><div class="card-body rate-up-card">
    <span class="copy-14">Rate-up on <b>${banner.name}</b>.</span>
    ${href ? html`<a class="btn secondary sm" href="${href}">${icon('event')}Go to banner</a>` : ''}
  </div></div>`;
}

/** The "Coming soon" page of an operator or weapon the wiki doesn't have yet. */
export function previewPage(
  kind: Kind,
  id: string,
  p: { name: string; rarity: number },
  facts: [string, Html | string | null][],
  tags: string[],
  about: Html,
  attribution: WikiPreviewFile['attribution'],
): Html {
  return html`<section class="wiki-hero${kind === 'weap' ? ' weapon' : ''}">
      ${itemImg(kind, id, 'wiki-hero-bg')}
      <div class="container wiki-hero-inner">
        ${itemImg(kind, id, 'wiki-hero-portrait')}
        <div class="min0 wiki-hero-text">
          ${crumbs(kind, p.name)}
          <div class="wiki-stars" style="color:var(--r${p.rarity})" aria-label="${p.rarity} star">${'★'.repeat(p.rarity)}</div>
          <h1 class="heading-32">${p.name} ${badge('Unreleased', 'amber')}</h1>
          <div class="wiki-facts">
            ${facts.filter(([, v]) => v).map(([label, v]) => html`<span class="wiki-fact"><span class="wiki-fact-label">${label}</span>${v}</span>`)}
          </div>
          ${tags.length ? html`<div class="wiki-tags">${tags.map((t) => badge(t, 'outline'))}</div>` : ''}
        </div>
        <div class="row wiki-hero-link">${copyLinkButton(id)}</div>
      </div>
    </section>
    <main class="container fade-in wiki-page">
      ${about}
      <p class="copy-13 secondary wiki-note">Not released yet: this is what the official version guide shows. Stats, skills${kind === 'char' ? ', talents' : ''} and Potential arrive from the wiki after release.</p>
      <p class="wiki-credit copy-13">${icon('menu_book')}<span>From the ${external(attribution.url, attribution.source)}, ${attribution.fetched}.</span></p>
    </main>`;
}

/** Copy-link button for an item's short link, when it has one and the links are known. */
export function copyLinkButton(id: string): Html {
  const map = shortLinkMap(() => {}).map;
  const slug = map && shortLinkOf(map, id);
  if (!slug) return html``;
  const url = `${SITE_URL}/${slug}`;
  return html`<button class="btn secondary sm" data-action="copy-link" data-value="${url}" title="${url.replace('https://', '')}">${icon('link')}<span class="hide-sm">Copy link</span></button>`;
}

let ownedCache: { a: Analysis | null; extras: ExtraCopy[]; maps: Partial<Record<Kind, Map<string, Owned>>> } | null = null;

/**
 * The player's copies of every item of `kind`: pulls, rewards and the extra
 * copies from Settings. Null only with neither an import nor any extras.
 */
export function ownedOf(a: Analysis | null, kind: Kind): Map<string, Owned> | null {
  const extras = extrasOf(state.settings);
  if (!a && !extras.length) return null;
  if (ownedCache?.a !== a || ownedCache.extras !== extras) ownedCache = { a, extras, maps: {} };
  return (ownedCache.maps[kind] ??= ownedItems(a, kind, extras));
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A value that follows the rank slider. */
const ranked = (ranks: string[], rank: number): Html =>
  html`<span class="num" data-ranks="${ranks.join('|')}">${ranks[Math.min(rank, ranks.length) - 1] ?? '–'}</span>`;

/** Wiki text with {n} placeholders filled from `values` (weapon skills). */
function filled(text: string, values: number[][] | undefined, rank: number): Html | string {
  if (!values || !/\{\d+\}/.test(text)) return text;
  return html`${splitPlaceholders(text).map((p) => (typeof p === 'number' ? ranked((values[p] ?? []).map(fmtSkillValue), rank) : p))}`;
}

/** Wiki markup → escaped HTML (bold, highlights, line breaks). */
export function rich(s: string, values?: number[][], rank = 1): Html {
  return html`${parseMarkup(s).map((seg) => {
    switch (seg.kind) {
      case 'bold':
        return html`<b>${filled(seg.text, values, rank)}</b>`;
      case 'mark':
        return html`<span class="wk wk-${seg.cls.replace(/\W/g, '')}">${filled(seg.text, values, rank)}</span>`;
      case 'break':
        return html`<br />`;
      default:
        return filled(seg.text, values, rank);
    }
  })}`;
}

export const external = (href: string, label: string | Html): Html => html`<a href="${href}" target="_blank" rel="noopener">${label}</a>`;

/** CC BY-SA 4.0 asks for credit wherever the data shows. */
export function credit(a: WikiAttribution, page?: string): Html {
  return html`<p class="wiki-credit copy-13">
    ${icon('menu_book')}
    <span>Data from ${external(page ?? a.url, a.source)}, ${external(a.licenseUrl, a.license)}. Snapshot of ${a.fetched}.</span>
  </p>`;
}

/** Operators › Headhunting, Arsenal › Issues: the banners pages' breadcrumbs. */
export function bannerCrumbs(kind: Kind): Html {
  return html`<nav class="breadcrumb wiki-crumbs" aria-label="Breadcrumb">
    <a href="/${PATH[kind]}">${NOUN[kind]}</a>${icon('chevron_right')}<span class="wiki-em">${BANNERS_LABEL[kind]}</span>
  </nav>`;
}

export function crumbs(kind: Kind, name?: string): Html {
  return html`<nav class="breadcrumb wiki-crumbs" aria-label="Breadcrumb">
    <a href="/${PATH[kind]}">${NOUN[kind]}</a>${icon('chevron_right')}
    ${name ? html`<a href="${infoHref(kind)}">Info</a>${icon('chevron_right')}<span class="wiki-em">${name}</span>` : html`<span class="wiki-em">Info</span>`}
  </nav>`;
}

/** Loading, failed and not-found states. */
export function statusPage(kind: Kind, title: string, message: Html | string): Html {
  return html`<div class="page-header"><div class="container page-header-inner"><div class="min0">${crumbs(kind)}<h1 class="heading-32">${title}</h1></div></div></div>
    <main class="container fade-in"><div class="card"><div class="empty"><p class="copy-14 secondary">${message}</p></div></div></main>`;
}

export function loadingOrFailed(kind: Kind, title: string, failed: boolean): Html {
  return failed
    ? statusPage(kind, title, html`Couldn't load the data. Check your connection and reload, or read it on ${external('https://endfield.wiki.gg/', 'endfield.wiki.gg')}.`)
    : statusPage(kind, title, 'Loading…');
}

// ---------------------------------------------------------------------------
// Rank slider: values follow it in place, no redraw
// ---------------------------------------------------------------------------

const ranks = new Map<string, number>();

/** The rank a slider is at (`start`, else `max`, until moved). */
export const sliderRank = (key: string, max: number, start = max): number => Math.min(ranks.get(key) ?? start, max);

/**
 * A rank slider. Moving it updates the values in its `[data-rank-scope]`
 * (one weapon skill), or on the whole page when it has none.
 */
export function rankSlider(key: string, max: number, rank = sliderRank(key, max), save?: { wpn: string; index: number; base: number[] }): Html {
  // `save`: the slider is the player's own rank for that weapon skill, kept on change (app.ts).
  return html`<label class="wiki-rank label-13 secondary">
    <span>${save ? 'Your rank' : 'Rank'}</span>
    <input type="range" min="1" max="${max}" value="${rank}" data-wiki-rank="${key}" ${save ? html`data-save-wpn="${save.wpn}" data-save-index="${String(save.index)}" data-save-base="${save.base.join(',')}"` : ''} aria-label="Skill rank" />
    <span class="num wiki-em wiki-rank-value">${rank}</span>
  </label>`;
}

/** Collapsible rows (skills, talents, Potentials) the player opened; kept across redraws. */
const openRows = new Set<string>();

/**
 * One collapsible row in a `.wiki-accs` card: `head` always shows, `body`
 * when opened. `key` must be unique on the page (it keeps the row open
 * across redraws).
 */
export function accordion(key: string, head: Html, body: Html): Html {
  return html`<details class="wiki-acc" data-row="${key}" ${raw(openRows.has(key) ? 'open' : '')}>
    <summary>${head}<span class="wiki-acc-chev">${icon('chevron_right')}</span></summary>
    <div class="wiki-acc-body">${body}</div>
  </details>`;
}

export function installWikiControls(): void {
  // 'toggle' doesn't bubble.
  document.addEventListener(
    'toggle',
    (e) => {
      const el = e.target as HTMLDetailsElement;
      const key = el.dataset?.row;
      if (!key) return;
      if (el.open) openRows.add(key);
      else openRows.delete(key);
    },
    true,
  );
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!el.matches?.('[data-wiki-rank]')) return;
    const rank = Number(el.value) || 1;
    ranks.set(el.dataset.wikiRank!, rank);
    el.parentElement?.querySelector('.wiki-rank-value')?.replaceChildren(String(rank));
    const scope = el.closest('[data-rank-scope]');
    // A weapon skill's slider also updates the rank shown on its row.
    scope?.closest('.wiki-acc')?.querySelector('.wiki-acc-rank')?.replaceChildren(String(rank));
    for (const v of (scope ?? document).querySelectorAll<HTMLElement>('[data-ranks]')) {
      const list = v.dataset.ranks!.split('|');
      v.textContent = list[Math.min(rank, list.length) - 1] ?? '–';
    }
  });
}

/** One pip per Potential level (each duplicate), P0 to P5. */
export function pips(potential: number): Html {
  return html`<span class="wiki-pips" role="img" aria-label="P${Math.max(potential, 0)} of P${MAX_POTENTIAL}">
    ${Array.from({ length: MAX_POTENTIAL }, (_, i) => html`<i class="${i < potential ? 'on' : ''}"></i>`)}
  </span>`;
}

// ---------------------------------------------------------------------------
// Your pulls
// ---------------------------------------------------------------------------

const OUTCOME: Record<string, Html> = {
  won: badge('Won', 'green'),
  lost: badge('Lost', 'red'),
  guaranteed: badge('Guaranteed', 'blue'),
};

/**
 * What the player's history says about this item: copies, Potential, where
 * each copy came from. `a` null = no import yet.
 */
export function ownedSection(kind: Kind, name: string, a: Analysis | null, owned: Owned | undefined): Html {
  const head = html`<div class="section-head"><h2 class="heading-20">Your pulls</h2></div>`;
  if (!a && !owned?.copies) {
    return html`<section class="section">${head}
      <div class="card wiki-owned-empty">
        <p class="copy-14 secondary">Import your pull history to see how many copies of ${name} you have and their Potential.</p>
        <button class="btn secondary sm" data-action="import">${icon('upload_file')}Import</button>
      </div>
    </section>`;
  }
  if (!owned || !owned.copies) {
    return html`<section class="section">${head}
      <div class="card wiki-owned-empty">
        <p class="copy-14 secondary">
          No copies of ${name} in your pull history yet.
          ${owned?.selectors ? `You earned ${owned.selectors} Selector${owned.selectors > 1 ? 's' : ''} on banners featuring ${name}; if you picked ${name}, that copy isn't counted here.` : ''}
        </p>
      </div>
    </section>`;
  }

  const first = owned.acquisitions[0];
  const latest = owned.acquisitions[owned.acquisitions.length - 1];
  const level = potentialLevel(owned);
  const isMax = owned.copies >= MAX_COPIES;
  const toMax = MAX_COPIES - owned.copies;
  const fromRewards = owned.copies - owned.pulled - owned.extra;
  const lastSpare = owned.spare ? latest : null;
  const via = (x: Acquisition) => (x.reward ? `${x.reward} · ${x.bannerName}` : x.bannerName);
  // Extra copies have no date: they show as "Extra" with their note.
  const when = (x: Acquisition) => html`<span class="wiki-date">${x.extra ? 'Extra' : fmtDate(x.ts)}</span>`;
  const path = PATH[kind];

  return html`<section class="section">
    ${head}
    ${metrics([
      metric({
        label: 'Copies',
        value: String(owned.copies),
        sub: [`${owned.pulled} pulled`, fromRewards ? `${fromRewards} from rewards` : '', owned.extra ? `${owned.extra} extra` : ''].filter(Boolean).join(' · '),
      }),
      metric({
        label: 'Potential',
        value: html`${level}${isMax ? html` <small>Max</small>` : ''}`,
        aside: pips(owned.potential),
        // Spare copies stay low-key: a count and when the latest one turned up.
        sub: isMax
          ? lastSpare
            ? `${owned.spare} spare${lastSpare.extra ? '' : ` · latest ${fmtDate(lastSpare.ts)}`}`
            : 'Fully upgraded'
          : `${toMax} more cop${toMax > 1 ? 'ies' : 'y'} to P${MAX_POTENTIAL}`,
      }),
      metric({ label: 'First copy', value: when(first), sub: via(first) }),
      owned.maxed
        ? metric({ label: `Reached P${MAX_POTENTIAL}`, value: when(owned.maxed), sub: via(owned.maxed) })
        : metric({ label: 'Latest copy', value: when(latest), sub: via(latest) }),
    ])}
    <div class="card wiki-pulls">
      ${[...owned.acquisitions].reverse().map((x) => {
        const p = x.pull;
        const spare = x.copy > MAX_COPIES;
        const copyTag = html`<span class="wiki-copy" title="Copy ${x.copy}">${spare ? `+${x.copy - MAX_COPIES}` : `P${x.copy - 1}`}</span>`;
        if (x.extra) {
          return html`<a class="wiki-pull${x.copy === MAX_COPIES ? ' max' : spare ? ' spare' : ''}" href="/settings" title="Extra copies are listed in Settings">
            <span class="num secondary">Extra</span>
            <span class="ellipsis wiki-em">${x.bannerName}</span>
            <span class="num secondary wiki-pull-at">Not a pull</span>
            <span class="wiki-pull-tag">${badge('Extra', 'outline')}</span>
            ${copyTag}
          </a>`;
        }
        const at = x.reward
          ? `${x.reward}${p?.bannerPull ? ` · ${kind === 'weap' ? `set ${Math.ceil(p.bannerPull / 10)}` : `pull ${p.bannerPull}`}` : ''}${x.estimated ? ' · estimated' : ''}`
          : !p || p.bannerPull === null
            ? 'Free'
            : `${kind === 'weap' ? `Set ${Math.ceil(p.bannerPull / 10)}` : `Pull ${p.bannerPull}`}${p.pity !== null ? ` · pity ${p.pity}` : ''}`;
        const tag = x.reward ? badge('Reward', 'outline') : p?.outcome ? OUTCOME[p.outcome] : p?.bannerPull === null ? badge('Free', 'outline') : '';
        return html`<a class="wiki-pull${x.copy === MAX_COPIES ? ' max' : spare ? ' spare' : ''}" href="/${path}/${encodeURIComponent(x.poolId)}">
          <span class="num secondary">${fmtDate(x.ts)}</span>
          <span class="ellipsis wiki-em">${x.bannerName}</span>
          <span class="num secondary wiki-pull-at">${at}</span>
          <span class="wiki-pull-tag">${tag}</span>
          ${copyTag}
        </a>`;
      })}
    </div>
    ${owned.selectors
      ? html`<p class="copy-13 secondary wiki-note">You also earned ${owned.selectors} Selector${owned.selectors > 1 ? 's' : ''} on banners featuring ${name}; any picked for ${name} aren't counted.</p>`
      : ''}
  </section>`;
}

/**
 * Potential as the game counts it: P0 for the first copy, one more per
 * duplicate, P5 at max (6 copies).
 */
export const potentialLevel = (owned: Owned): string => `P${Math.max(owned.potential, 0)}`;

/** Small Potential/copies tag for index tiles. */
export function ownedTag(owned: Owned | undefined): Html {
  if (!owned?.copies) return raw('');
  return html`<span class="wiki-tile-tag" title="${owned.copies} cop${owned.copies > 1 ? 'ies' : 'y'}">${potentialLevel(owned)}</span>`;
}

/** Switches between the player's banners and the info pages for a kind. */
export function kindNav(kind: Kind, current: 'banners' | 'info'): Html {
  const link = (to: 'banners' | 'info', href: string, label: string, ic: string) =>
    html`<a href="${href}" ${raw(current === to ? 'aria-current="page"' : '')}>${icon(ic)}${label}</a>`;
  return html`<nav class="toggle kind-nav" aria-label="${NOUN[kind]} views">
    ${link('banners', `/${PATH[kind]}`, BANNERS_LABEL[kind], 'inventory_2')}
    ${link('info', infoHref(kind), kind === 'char' ? 'All operators' : 'All weapons', 'menu_book')}
  </nav>`;
}
