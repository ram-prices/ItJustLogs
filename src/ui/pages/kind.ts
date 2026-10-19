import { copyPmf, LUCK_LABEL, luckTier, setOf, WEAPON_PITY_SETS, type AnalyzedPull, type Analysis, type BannerSummary, type LuckTier } from '../../domain/analyze';
import { bannerArtUrl, itemIconUrl } from '../../domain/banners';
import { tintFor } from '../tint';
import { luckGraph, tip, tipNote, tipRow } from '../charts';
import type { Kind } from '../../domain/types';
import { badge, heat, icon, itemImg, metric, metrics, pageHeader } from '../components';
import { fmtDate, fmtInt, html, raw, type Html } from '../html';

/** Operators / Arsenal: list of banners, and a page per banner with its pull history. */

const KIND = {
  char: { title: 'Operators', path: 'operators', flip: '50/50', items: 'operators' },
  weap: { title: 'Arsenal', path: 'arsenal', flip: '25/75', items: 'weapons' },
} as const;

const LUCK_COLOR: Record<LuckTier, string> = {
  'very-lucky': 'var(--green)',
  lucky: 'var(--green)',
  average: 'var(--gray-1000)',
  unlucky: 'var(--amber)',
  'very-unlucky': 'var(--red)',
};
const luckWord = (t: LuckTier): Html => html`<span class="luck-word" style="color:${LUCK_COLOR[t]}">${LUCK_LABEL[t]}</span>`;


/** Basic Headhunting always leads; everything else is most recent first. */
const bannersOf = (kind: Kind, a: Analysis) =>
  a.banners
    .filter((b) => b.kind === kind)
    .sort((x, y) => Number(y.category === 'basic') - Number(x.category === 'basic') || y.lastTs - x.lastTs);

/** The rate-up mark: stacked chevrons in a circle. */
const rateUpIcon = (): Html => html`<span class="rateup-icon">${icon('stat_2')}</span>`;

/** Banner key art; weapon banners without art fall back to the rate-up weapon icon. */
/** Reward icons: a ticket for Tokens, a crate for Selectors (pick-one boxes), a gift for free rate-up copies. */
/** What a reward teardrop gives, for its hover tip. */
const rewardInfo = (name: string, kind: Kind): string =>
  name === 'Token'
    ? 'A Token for the rate-up operator.'
    : name === 'Rate-up copy'
      ? 'A free copy of the rate-up weapon.'
      : kind === 'weap'
        ? "Pick a 6★ weapon that isn't the rate-up."
        : 'Pick one of the rate-up operators.';
const rewardIcon = (name: string): string =>
  name === 'Selector' ? 'deployed_code' : name === 'Rate-up copy' ? 'redeem' : 'confirmation_number';

function artUrls(b: BannerSummary): { art: string; weapon: string } {
  const weaponId = b.info?.rateUpIds.find((id) => id.startsWith('wpn_'));
  return { art: bannerArtUrl(b.poolId) ?? '', weapon: weaponId ? itemIconUrl('weap', weaponId) ?? '' : '' };
}

function art(b: BannerSummary): Html {
  const { art: url, weapon } = artUrls(b);
  // Arsenal cards take their glow from the weapon (see tintWeaponCards), so their art doesn't tint.
  const tint = b.kind === 'weap' && weapon ? '' : raw('data-tint');
  if (url) return html`<img src="${url}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback data-alt="${weapon}" />`;
  if (weapon) return html`<img class="weapon" src="${weapon}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback />`;
  return html``;
}

function rateUpChip(b: BannerSummary): Html {
  if (!b.info) return html``;
  const names = b.category === 'joint' && b.info.rateUpIds.length > 1 ? `${b.info.rateUpIds.length} rate-ups` : b.info.rateUpNames.join(', ');
  // Copies you own: the ones pulled plus every reward that is a rate-up copy
  // (Chartered Tokens, Joint Selectors, Arsenal rate-up rewards). Arsenal
  // Selectors offer other weapons, so they don't count.
  const pulled = b.rateUpCopies;
  const fromRewards = b.rewards?.copies ?? 0;
  const total = pulled + fromRewards;
  const got = total > 0;
  const rewardKind = b.kind === 'weap' ? 'rate-up reward' : b.rewards?.label.toLowerCase() ?? '';
  const rewardWord = `${rewardKind}${fromRewards === 1 ? '' : 's'}`;
  const breakdown = fromRewards ? ` (${pulled} pulled + ${fromRewards} from ${rewardWord})` : '';
  const label = `Rate-up: ${names}${got ? ` · obtained ×${total}${breakdown}` : ' · not obtained yet'}`;
  return html`<span class="banner-rateup${got ? ' got' : ''}" title="${label}" aria-label="${label}">
    ${rateUpIcon()}<span class="ellipsis">${names}</span>${got ? html`${icon('check')}${total > 1 ? html`<span class="rateup-count">×${total}</span>` : ''}` : ''}
  </span>`;
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

/** Pages whose 6★ history is showing every row (each starts at two). */
const sixOpen = new Set<Kind>();
export function toggleSixStrip(kind: Kind): boolean {
  if (sixOpen.delete(kind)) return false;
  sixOpen.add(kind);
  return true;
}

/**
 * Every 6★ for this kind, newest first: portrait with its pity underneath.
 * Arsenal shows only the rate-up weapons. Two rows until opened.
 */
function sixStrip(kind: Kind, a: Analysis): Html {
  const sixes = a.sixStars.filter((x) => x.kind === kind && (kind === 'char' || x.isRateUp)).sort((x, y) => y.ts - x.ts);
  if (!sixes.length) return html``;
  const max = kind === 'char' ? 80 : WEAPON_PITY_SETS;
  const open = sixOpen.has(kind);
  return html`<div class="section six-section${open ? ' open' : ''}" data-kind="${kind}">
    <div class="section-head">
      <h2 class="heading-20">${kind === 'char' ? '6★ history' : 'Rate-up 6★ history'}</h2>
      <div class="row">
        <span class="label-13 secondary">${sixes.length} total · newest first</span>
        <button class="btn tertiary sm six-toggle" data-action="six-strip" aria-expanded="${String(open)}">${open ? 'Show less' : 'Show all'}</button>
      </div>
    </div>
    <div class="six-strip">
      ${sixes.map(
        (p) => html`<div class="six-item${p.isRateUp ? ' rateup' : ''}" title="${p.name} · ${p.bannerName} · ${fmtDate(p.ts, true)}">
          ${itemImg(p.kind, p.itemId, 'six-portrait')}
          <span class="six-pity">${p.pity === null ? html`<i style="background:var(--green)"></i>Free` : html`<i style="background:${heat(p.pity, max)}"></i>${p.pity}`}</span>
        </div>`,
      )}
    </div>
  </div>`;
}

export function listPage(kind: Kind, a: Analysis): Html {
  const k = KIND[kind];
  const s = a[kind];
  const banners = bannersOf(kind, a);
  const sixes = a.sixStars.filter((x) => x.kind === kind && x.pity !== null);
  const avgPity = sixes.length ? sixes.reduce((n, x) => n + x.pity!, 0) / sixes.length : 0;
  const rateTier = luckTier(s.rate, s.expectedRate);
  const flips = s.won + s.lost;
  const winRate = flips ? s.won / flips : 0;
  const flipTier = luckTier(winRate, s.expectedWinRate);

  return html`
    ${pageHeader(k.title, `${fmtInt(s.pulls)} pulls across ${banners.length} banners · ${s.uniqueItems} unique ${k.items}`)}
    <main class="container fade-in">
      ${metrics(
        [
          metric({ label: 'Pulls', value: fmtInt(s.pulls), sub: s.freePulls ? `+${fmtInt(s.freePulls)} free` : undefined }),
          metric({ label: '6★ rate', value: `${(s.rate * 100).toFixed(2)}%`, sub: html`${luckWord(rateTier)} · expected ${(s.expectedRate * 100).toFixed(2)}%` }),
          metric({ label: `${k.flip} won`, value: flips ? `${Math.round(winRate * 100)}%` : '–', sub: flips ? html`${luckWord(flipTier)} · ${s.won} of ${flips}` : undefined }),
          metric({ label: 'Average 6★ pity', value: avgPity ? avgPity.toFixed(1) : '–', sub: sixes.length ? `over ${sixes.length} 6★` : undefined }),
        ],
        'plain',
      )}

      ${sixStrip(kind, a)}

      <div class="section">
        <div class="section-head">
          <h2 class="heading-20">Banners</h2>
          <div class="row">
            <button class="btn tertiary sm" data-action="expand-all" data-value="1">Expand all</button>
            <button class="btn tertiary sm" data-action="expand-all" data-value="">Collapse all</button>
          </div>
        </div>
        <div class="banner-list">${banners.map((b) => bannerSection(b))}</div>
      </div>
    </main>`;
}

// ---------------------------------------------------------------------------
// Banner sections: a summary row that expands into the banner's pull history
// ---------------------------------------------------------------------------

const expanded = new Set<string>();

export const bannerKey = (b: BannerSummary) => `${b.kind}:${b.poolId}`;

/**
 * List filters per banner; any combination, never empty. '4' means 4★ and
 * below; 'up' always keeps the rate-up pulls, whatever rarities are on.
 */
type Rarity = 'up' | '6' | '5' | '4';
const filters = new Map<string, Set<Rarity>>();
const filterOf = (key: string): Set<Rarity> => filters.get(key) ?? new Set<Rarity>(['up', '6']);

/** Banners with a rate-up (and so a rate-up filter button); filled as cards render. */
const rateUpBanners = new Set<string>();

/** Turns one filter on or off for a banner. The last active one can't be turned off. */
export function toggleBannerFilter(key: string, r: Rarity): void {
  const next = new Set(filterOf(key));
  if (next.has(r)) {
    next.delete(r);
    // 'up' only counts on banners that show its button.
    const active = [...next].filter((x) => x !== 'up' || rateUpBanners.has(key));
    if (!active.length) return;
  } else next.add(r);
  filters.set(key, next);
}

/** Just the expandable body of one banner, so a filter change re-renders only that. */
export function bannerBodyFor(key: string, a: Analysis): Html | null {
  const b = a.banners.find((x) => bannerKey(x) === key);
  return b ? bannerBody(b) : null;
}

/** Remembers which cards are expanded (full list, no scroll) so a re-render keeps them that way. */
export function setExpanded(key: string, open: boolean): void {
  if (open) expanded.add(key);
  else expanded.delete(key);
}

export function setAllExpanded(kind: Kind, a: Analysis, open: boolean): void {
  for (const b of bannersOf(kind, a)) setExpanded(bannerKey(b), open);
}

/** "7 pulls" / "1 set of 10" / "3 sets of 10" toward the next reward. */
function rewardProgress(b: BannerSummary): string {
  const n = b.rewards!.progress;
  if (b.kind === 'weap') return `${n} ${n === 1 ? 'set' : 'sets'} of 10`;
  return `${fmtInt(n)} ${n === 1 ? 'pull' : 'pulls'}`;
}

function bannerSection(b: BannerSummary): Html {
  const key = bannerKey(b);
  const pityColor = b.pity.done ? 'var(--gray-700)' : heat(b.pity.value, b.pity.max);
  const { art: artSrc, weapon } = artUrls(b);
  const src = artSrc || weapon;
  // Arsenal cards glow in the rate-up weapon's own colour, not the banner art's.
  const byWeapon = b.kind === 'weap' && !!weapon;
  const open = expanded.has(key);
  return html`<article class="card banner${open ? ' expanded' : ''}" id="banner-${b.poolId}" data-pool="${key}" data-art="${src}" ${byWeapon ? raw(`data-tint-weapon="${weapon.replace(/"/g, '&quot;')}"`) : ''} style="--banner-tint:${tintFor(byWeapon ? weapon : src)}">
    <div class="banner-summary">
      <div class="banner-art">
        ${art(b)}
        <div class="banner-art-text">
          <div class="banner-name ellipsis">${b.name}</div>
          ${rateUpChip(b)}
        </div>
      </div>
      <div class="banner-glance">
        <div class="glance-row">
          ${b.rewards
            ? html`<span class="glance-stat" title="${rewardProgress(b)} toward the next ${b.rewards.nextReward.toLowerCase()} (${b.rewards.goal})" aria-label="${rewardProgress(b)} toward the next ${b.rewards.nextReward.toLowerCase()}">${icon(rewardIcon(b.rewards.nextReward), true)}<b>${fmtInt(b.rewards.progress)}</b></span>`
            : ''}
          <span class="glance-stat" style="color:${pityColor}" title="6★ pity: ${b.pity.done ? 'done' : `${b.pity.value} of ${b.pity.max}${b.kind === 'weap' ? ' sets of 10' : ''}`}" aria-label="6★ pity ${b.pity.done ? 'done' : `${b.pity.value} of ${b.pity.max}${b.kind === 'weap' ? ' sets of 10' : ''}`}">${icon('hourglass_bottom')}<b>${b.pity.done ? 'Done' : b.pity.value}</b>${b.pity.done ? '' : html`<i>/${b.pity.max}</i>`}</span>
        </div>
        ${pityRuler(b)}
      </div>
    </div>
    <div class="banner-body">${bannerBody(b)}</div>
    <button type="button" class="banner-expand" data-action="expand-card" aria-expanded="${String(open)}">
      <span>${open ? 'Collapse' : 'Expand'}</span>${icon('chevron_right')}
    </button>
  </article>`;
}

/**
 * Pity ruler: the banner's paid pulls laid out on one line, from 0 to the next
 * milestone (reward or hard-pity multiple). A fill shows pulls made so far, a
 * faint segment where hard pity would land, and each 6★ gets a portrait pin
 * at the pull it dropped on. Pins that land close together are spread around
 * their shared centre so they don't merge.
 */
// % of the axis between pin centres: a 26px portrait plus its 2px ring (30px)
// on a ~300px ruler, so neighbours sit side by side (just touching on phones).
const PIN_MIN_GAP = 10;
/** More pins than this on one side of the track switch to compact markers. */
const MAX_FULL_PINS = 10;
/** Basic Headhunting's ruler covers only this many of the latest pulls. */
const BASIC_WINDOW = 300;
/** How crowded rows are drawn: thin tick marks off the track, or dots. */
const CROWDED_STYLE: 'tick' | 'dot' = 'tick';
/**
 * Lays out pins and teardrop markers on one side of the track. Items that would
 * touch form a group, PIN_MIN_GAP apart and centred on the mean of their true
 * spots, so neighbours spread out evenly either side of where they point.
 * Groups stay inside [3.5, hi of their last item]; groups that meet merge and
 * are re-centred. `pcts` must be in ascending order.
 */
function declutter(pcts: number[], his: number[]): number[] {
  const lo = 3.5;
  type Group = { first: number; n: number; sum: number; gap: number; left: number };
  const place = (g: Group) => {
    const hi = his[g.first + g.n - 1];
    g.gap = g.n > 1 ? Math.min(PIN_MIN_GAP, (hi - lo) / (g.n - 1)) : 0;
    const span = (g.n - 1) * g.gap;
    g.left = Math.max(lo, Math.min(hi - span, g.sum / g.n - span / 2));
  };
  let groups: Group[] = pcts.map((p, i) => ({ first: i, n: 1, sum: p, gap: 0, left: p }));
  groups.forEach(place);
  for (let merged = true; merged; ) {
    merged = false;
    const out: Group[] = [];
    for (const g of groups) {
      const prev = out[out.length - 1];
      if (prev && g.left - (prev.left + (prev.n - 1) * prev.gap) < PIN_MIN_GAP - 0.01) {
        prev.n += g.n;
        prev.sum += g.sum;
        place(prev);
        merged = true;
      } else out.push(g);
    }
    groups = out;
  }
  const out: number[] = [];
  for (const g of groups) for (let k = 0; k < g.n; k++) out.push(g.left + k * g.gap);
  return out;
}

function pityRuler(b: BannerSummary): Html {
  const max = b.pity.max;
  // Arsenal rulers count sets of 10 (the game treats each set as one pull);
  // everything else counts single pulls.
  const sets = b.kind === 'weap';
  const done = sets ? setOf(b.paidPulls) : b.paidPulls;
  const posOf = (p: AnalyzedPull) => (sets ? setOf(p.bannerPull!) : p.bannerPull!);
  const nextReward = b.rewards ? done - b.rewards.progress + b.rewards.goal : 0;
  const axis = Math.max(nextReward, Math.ceil(Math.max(done, 1) / max) * max);
  // Basic Headhunting never ends, so its ruler shows just the last 300 pulls.
  const from = b.category === 'basic' ? Math.max(0, done - BASIC_WINDOW) : 0;
  const pct = (n: number) => Math.max(0, Math.min(100, ((n - from) / (axis - from)) * 100));
  const clamp = (x: number) => Math.max(3.5, Math.min(96.5, x));
  const fillColor = b.kind === 'char' ? 'var(--op)' : 'var(--ars)';
  const heatColor = heat(b.pity.value, max);

  // Second line: the current pity run, from the last 6★ (or carried-in pity)
  // to now, then faintly on to where hard pity would hit.
  const runStart = done - b.pity.value;
  const hardAt = runStart + max;
  const run = b.pity.done ? '' : html`<i class="ruler-run" style="left:${pct(runStart)}%;width:${pct(done) - pct(runStart)}%;background:${heatColor}"></i>`;
  const ahead = !b.pity.done && hardAt > done ? html`<i class="ruler-ahead" style="left:${pct(done)}%;width:${pct(hardAt) - pct(done)}%;background:${heatColor}"></i>` : '';

  // One item per pin or teardrop; `draw` gets its laid-out spot and `dx`, how
  // far its true spot is from there (in % of the ruler). CSS turns each tip
  // to aim at the true spot (see .ruler-body).
  type Item = { at: number; hi: number; draw: (left: number, dx: number) => Html };
  const items = { above: [] as Item[], below: [] as Item[] };

  // Milestones as teardrop markers: the rate-up guarantee (when it lands
  // before the axis end) and every reward point on the axis.
  // The guarantee only matters while the rate-up is still outstanding.
  if (b.guarantee && b.guarantee.max < axis && b.rateUpCopies === 0) {
    const g = b.guarantee.max;
    items.above.push({
      at: pct(g),
      hi: 100,
      draw: (left, dx) => html`<div class="ruler-mark ahead" style="left:${left}%;--dx:${dx}" aria-label="Rate-up guarantee, ${sets ? 'set' : 'pull'} ${g}" data-tip="${tip('Rate-up guarantee', [tipNote(`A rate-up 6★ is certain by this ${sets ? 'set' : 'pull'}.`), tipRow(sets ? 'Set' : 'Pull', String(g))])}">
        <span class="ruler-mark-label">${g}</span><span class="ruler-mark-drop">${icon('check_circle')}</span>
      </div>`,
    });
  }
  // Token every 240 pulls, Selector every 10 Arsenal sets... Rewards already
  // earned are grayed out; the next one is coloured and named.
  if (b.rewards) {
    for (const { at, name, copy } of b.rewards.milestones(axis)) {
      if (at <= from) continue;
      const passed = at <= done;
      const where = sets ? `Set ${at}` : `${at}`;
      // Rewards that aren't the rate-up (Arsenal Selectors) sit under the
      // track with the off-banner 6★, drawn behind them; the rest go above.
      const below = !copy;
      items[below ? 'below' : 'above'].push({
        at: pct(at),
        hi: 100,
        draw: (left, dx) => html`<div class="ruler-mark ${passed ? 'passed' : 'ahead'}${below ? ' below' : ''}" style="left:${left}%;--dx:${dx}" aria-label="${name}, ${where}" data-tip="${tip(name, [tipNote(rewardInfo(name, b.kind)), tipRow(sets ? 'Set' : 'Pull', String(at)), tipRow('Status', passed ? 'Earned' : at === nextReward ? 'Next' : 'Coming up')])}">
          <span class="ruler-mark-label">${at}</span><span class="ruler-mark-drop">${icon(rewardIcon(name), true)}</span>
        </div>`,
      });
    }
  }

  // Rate-up copies pin above the track; every other 6★ hangs below it.
  const sixes = b.pulls.filter((p) => p.rarity === 6 && p.bannerPull !== null && posOf(p) > from);
  const sideOf = (side: 'above' | 'below', list: AnalyzedPull[]): Html[] => {
    // Heavy pullers can have more 6★ than fit as labelled pins. Past that,
    // draw them as ticks at their true spots (hover one for the details) and
    // leave the teardrops where they are.
    if (list.length > MAX_FULL_PINS) {
      return [
        ...items[side].map((it) => it.draw(it.at, 0)),
        ...list.map((p) => {
          const rows = [
            sets ? tipRow('Set', `${posOf(p)} (pull ${p.bannerPull})`) : tipRow('Pull', String(p.bannerPull)),
            tipRow('Pity', `${p.pity}/${sets ? WEAPON_PITY_SETS : b.pity.max}`),
          ];
          // Ticks sit at the exact spot (no clamping); dots keep clear of the edges.
          const left = CROWDED_STYLE === 'tick' ? pct(posOf(p)) : clamp(pct(posOf(p)));
          return html`<div class="ruler-pin ${side} pin-${CROWDED_STYLE}" style="left:${left}%" data-tip="${tip(p.name, rows)}" aria-label="${p.name}"><span class="ruler-${CROWDED_STYLE}" style="${CROWDED_STYLE === 'tick' && p.pity !== null ? `background:${heat(p.pity, sets ? WEAPON_PITY_SETS : b.pity.max)}` : ''}"></span></div>`;
        }),
      ];
    }
    const all = [
      ...items[side],
      ...list.map((p): Item => ({
        at: pct(posOf(p)),
        hi: 96.5,
        draw: (left, dx) => html`<div class="ruler-pin ${side}" style="left:${left}%;--dx:${dx}" title="${sets ? `${p.name} · set ${posOf(p)} (pull ${p.bannerPull}) · pity ${p.pity}/${WEAPON_PITY_SETS}` : `${p.name} · pull ${p.bannerPull} · pity ${p.pity}`}">
          <span class="ruler-pin-label">${posOf(p)}</span>
          ${itemImg(p.kind, p.itemId, 'ruler-portrait')}
          <span class="ruler-pin-point"></span>
        </div>`,
      })),
    ].sort((x, y) => x.at - y.at);
    const spots = declutter(all.map((it) => it.at), all.map((it) => it.hi));
    return all.map((it, i) => it.draw(spots[i], Math.round((it.at - spots[i]) * 100) / 100));
  };
  const above = sideOf('above', sixes.filter((p) => p.isRateUp));
  const below = sideOf('below', sixes.filter((p) => !p.isRateUp));

  return html`<div class="ruler">
    <div class="ruler-body">
      ${above}${below}
      <div class="ruler-track"></div>
      <i class="ruler-fill" style="width:${pct(done)}%;background:${fillColor}"></i>
      ${run}${ahead}
      ${from ? html`<span class="ruler-from" title="The ruler starts here: Basic Headhunting shows the last ${BASIC_WINDOW} pulls">${fmtInt(from)}</span>` : ''}
      <i class="ruler-now" style="left:${pct(done)}%"></i>
    </div>
  </div>`;
}

function bannerBody(b: BannerSummary): Html {
  const key = bannerKey(b);
  const f = filterOf(key);
  const hasRateUp = !!b.info?.rateUpIds.length;
  if (hasRateUp) rateUpBanners.add(key);
  const shown = b.pulls
    .filter((p) => (hasRateUp && f.has('up') && p.isRateUp) || f.has(p.rarity >= 6 ? '6' : p.rarity === 5 ? '5' : '4'))
    .slice()
    .reverse();

  return html`
    <div class="card-head">
      <span class="glance-stat"><b>${fmtInt(b.paidPulls)}</b>pulls</span>
      <div class="rarity-filter" role="group" aria-label="Rarity">
        ${hasRateUp ? html`<button type="button" class="filter-up" data-action="filter" data-value="up" aria-pressed="${String(f.has('up'))}" title="Rate-up: always listed" aria-label="Rate-up">${icon('stat_2')}</button>` : ''}
        ${(
          [
            ['6', '6★'],
            ['5', '5★'],
            ['4', '4★'],
          ] as [Rarity, string][]
        ).map(([v, label]) => html`<button type="button" data-action="filter" data-value="${v}" aria-pressed="${String(f.has(v))}">${label}</button>`)}
      </div>
    </div>
    ${shown.length ? pullTable(b, shown) : html`<div class="table-empty">No pulls match this filter.</div>`}`;
}

/** Luck column is hidden for now; flip this to bring it back (analyze.ts still computes `luck`). */
const SHOW_LUCK = false;

/** Rate-up pulls whose luck drawer is open, by pull key; kept across re-renders. */
const openLuck = new Set<string>();
export function toggleLuck(key: string): boolean {
  if (openLuck.has(key)) openLuck.delete(key);
  else openLuck.add(key);
  return openLuck.has(key);
}

/** The drawer under a rate-up pull: how likely that result was, and the curve. */
function luckDrawer(b: BannerSummary, p: AnalyzedPull): Html {
  const pmf = copyPmf(b, p.copy!);
  if (!pmf || p.luck === undefined) return html``;
  const at = p.kind === 'weap' ? Math.ceil(p.bannerPull! / 10) * 10 : p.bannerPull!;
  const copies = p.copy === 1 ? '1 copy' : `${p.copy} copies`;
  const tone = p.luck < 0.25 ? 'var(--green)' : p.luck > 0.75 ? 'var(--red)' : 'var(--gray-1000)';
  const carried = b.startPity > 0 && b.category === 'chartered' ? html` <span class="tertiary">Started with ${b.startPity} pity carried over.</span>` : '';
  const guaranteed = p.outcome === 'guaranteed' ? html` <span class="tertiary">This one was the guarantee.</span>` : '';
  return html`<div class="luck-drawer"><div class="luck-inner">
    <p class="luck-text">You had a <b style="color:${tone}">${(p.luck * 100).toFixed(1)}%</b> chance to get ${copies} of the rate-up within ${p.kind === 'weap' ? `${setOf(at)} sets of 10` : `${at} pulls`}.${carried}${guaranteed}</p>
    ${luckGraph(pmf, at, p.kind === 'weap' ? 10 : 1)}
  </div></div>`;
}

/** One pull, as a small box. Rate-up pulls open a luck drawer. */
function pullRow(b: BannerSummary, p: AnalyzedPull): Html {
  const luck = p.luck;
  const hasLuck = p.isRateUp && p.rarity === 6 && p.copy !== undefined && luck !== undefined;
  const open = hasLuck && openLuck.has(p.key);
  return html`<div class="pull${p.rarity === 6 ? ' six' : p.rarity === 5 ? ' five' : ''}${hasLuck ? ' has-luck' : ''}${open ? ' open' : ''}" title="${fmtDate(p.ts, true)}"
    ${hasLuck ? raw(`data-action="luck" data-key="${p.key.replace(/"/g, '&quot;')}" role="button" tabindex="0" aria-expanded="${String(open)}"`) : ''}>
    <span class="pull-no num">${p.bannerPull ?? '–'}</span>
    <div class="item">${itemImg(p.kind, p.itemId)}<div class="item-name">
      <span class="ellipsis">${p.name}</span>${p.isRateUp && p.rarity === 6 ? html`<span class="pull-tag rateup${p.kind === 'weap' ? ' weap' : ''}" role="img" title="Rate-up" aria-label="Rate-up">${icon('stat_2')}</span>` : ''}${p.isNew ? html`<span class="pull-tag new" role="img" title="New" aria-label="New">${icon('auto_awesome', true)}</span>` : ''}${p.pity === null ? badge('Free', 'outline') : ''}
    </div></div>
    <span class="pull-pity num" style="${p.rarity === 6 && p.pity !== null ? `color:${heat(p.pity, b.pity.max)}` : 'color:var(--gray-700)'}">${p.pity ?? '–'}</span>
    ${SHOW_LUCK ? html`<span class="pull-luck num">${luck !== undefined && p.outcome !== 'guaranteed' ? html`<span style="color:${luck < 0.25 ? 'var(--green)' : luck > 0.75 ? 'var(--red)' : 'inherit'}">${(luck * 100).toFixed(1)}%</span>` : html`<span class="tertiary">–</span>`}</span>` : ''}
    ${hasLuck ? luckDrawer(b, p) : ''}
  </div>`;
}

/**
 * Pull list, newest first. Arsenal pulls come in sets of 10 (the game's unit),
 * so their list is grouped by set; everything else is a flat list.
 */
function pullTable(b: BannerSummary, pulls: AnalyzedPull[]): Html {
  const cls = `pulls${SHOW_LUCK ? ' with-luck' : ''}`;
  if (b.kind !== 'weap') return html`<div class="${cls}">${pulls.map((p) => pullRow(b, p))}</div>`;
  const groups: { set: number | null; pulls: AnalyzedPull[] }[] = [];
  for (const p of pulls) {
    const set = p.bannerPull === null ? null : setOf(p.bannerPull);
    const last = groups[groups.length - 1];
    if (last && last.set === set) last.pulls.push(p);
    else groups.push({ set, pulls: [p] });
  }
  return html`<div class="${cls}">
    ${groups.map(
      (g) => html`<div class="pull-set">
        <div class="pull-set-head">
          <span>${g.set === null ? 'Free' : `Set ${g.set}`}</span>
        </div>
        ${g.pulls.map((p) => pullRow(b, p))}
      </div>`,
    )}
  </div>`;
}
