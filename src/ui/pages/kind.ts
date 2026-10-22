import { copyPmf, LUCK_LABEL, luckTier, setOf, WEAPON_PITY_SETS, type AnalyzedPull, type Analysis, type BannerSummary, type LuckTier } from '../../domain/analyze';
import { bannerArtUrl, canonicalPoolId, cdnUrl, itemIconUrl, lookupBanner } from '../../domain/banners';
import { sixTintFor, tintFor } from '../tint';
import { luckGraph, tip, tipNote, tipRow } from '../charts';
import { bannerEnded, poolStarts, unpulledBanners, type CatalogBanner } from '../../domain/catalog';
import type { Schedule, Server } from '../../domain/schedule';
import type { BannerDb, Kind } from '../../domain/types';
import { badge, heat, icon, issueArt, withStars, itemImg, metric, metrics, pageHeader, toggleGroup } from '../components';
import { fmtDate, fmtInt, html, raw, type Html } from '../html';
import { infoHref, ownedOf, pullsTabs } from './info';
import { state } from '../../state';
import { MAX_COPIES } from '../../domain/owned';
import { wikiId } from '../../domain/wiki';

/** Operators / Arsenal: list of banners, and a page per banner with its pull history. */

const KIND = {
  char: { title: 'Headhunting', path: 'operators', flip: '50/50', items: 'operators' },
  weap: { title: 'Arsenal Issues', path: 'arsenal', flip: '25/75', items: 'weapons' },
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
/** The circled rate-up chevrons; `got`: the player has it, so a check instead. */
export const rateUpIcon = (got = false): Html => html`<span class="rateup-icon${got ? ' got' : ''}">${icon(got ? 'check' : 'stat_2')}</span>`;

/** Banner key art; weapon banners without art fall back to the rate-up weapon icon. */
/** Reward icons: a star in a circle for Tokens, a crate for Selectors (pick-one boxes), a gift for free rate-up copies. */
/** What a reward teardrop gives, for its hover tip. */
const rewardInfo = (name: string, kind: Kind): string =>
  name === 'Token'
    ? 'A Token for the rate-up operator.'
    : name === 'Rate-up copy'
      ? 'A free copy of the rate-up weapon.'
      : kind === 'weap'
        ? "Pick a 6★ weapon that isn't the rate-up."
        : 'Pick one of the rate-up operators.';
/**
 * The Token teardrop's glyph: a disc with a star cut out of it, like the
 * Material "stars" icon but with a bigger star, so it reads at ruler size.
 * The star is a hole (evenodd), so it shows the teardrop's own colour.
 */
const TOKEN_GLYPH = raw(
  '<svg class="token-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" fill="currentColor" d="M0 12a12 12 0 1 0 24 0a12 12 0 1 0-24 0ZM12 4.1L14.32 9.31L19.99 9.9L15.75 13.72L16.94 19.3L12 16.45L7.06 19.3L8.25 13.72L4.01 9.9L9.68 9.31Z"/></svg>',
);
const rewardIcon = (name: string): string =>
  name === 'Selector' ? 'deployed_code' : name === 'Rate-up copy' ? 'redeem' : 'stars';

/**
 * A banner's art, its rate-up weapon's icon, and `item`: the icon its glow
 * comes from when it has one rate-up (the weapon, or the operator), else ''.
 */
function artUrls(b: BannerSummary): { art: string; weapon: string; item: string } {
  const weaponId = b.info?.rateUpIds.find((id) => id.startsWith('wpn_'));
  const weapon = weaponId ? itemIconUrl('weap', weaponId) ?? '' : '';
  const operators = [...new Set((b.info?.rateUpIds ?? []).filter((id) => id.startsWith('chr_')).map((id) => itemIconUrl('char', id) ?? ''))].filter(Boolean);
  const item = b.kind === 'weap' ? weapon : operators.length === 1 ? operators[0] : '';
  return { art: bannerArtUrl(b.poolId) ?? '', weapon, item };
}

function art(b: BannerSummary): Html {
  const { art: url, weapon, item } = artUrls(b);
  // Cards with one rate-up take their glow from it (see tintWeaponCards), so their art doesn't tint.
  const tint = item ? '' : raw('data-tint');
  if (url) return issueArt(b.poolId, url) ?? html`<img src="${url}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback data-alt="${weapon}" />`;
  if (weapon) return html`<img class="weapon" src="${weapon}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback />`;
  return html``;
}

/** Rate-up copies you own on a banner: pulled plus rate-up rewards (Tokens, Joint Selectors, Arsenal copies). */
export const rateUpOwned = (b: BannerSummary): number => b.rateUpCopies + (b.rewards?.copies ?? 0);

/**
 * The player's Potential with a banner's rate-up ("P2"), when the banner has
 * one rate-up and they own a copy of it, from any banner or reward.
 */
/**
 * A banner's rate-up ids when its data only has names (a banner announced
 * before its pool id is known): ids from banners.json by pool id, else the
 * player's own pulls of those names.
 */
export function rateUpIdsOf(kind: Kind, poolId: string | null, names: string[]): string[] {
  const known = poolId ? lookupBanner(state.db, poolId)?.rateUpIds : undefined;
  if (known?.length) return known;
  const byName = new Map<string, string>();
  for (const b of state.analysis?.banners ?? []) if (b.kind === kind) for (const p of b.pulls) if (p.itemId) byName.set(p.name.trim().toLowerCase(), p.itemId);
  return names.map((n) => byName.get(n.trim().toLowerCase())).filter((id): id is string => !!id);
}

export function rateUpPotential(kind: Kind, rateUpIds: string[], poolId?: string | null): Html {
  // One character can be listed under both its ids (chr_0034_typhoeus, chr_0034_typhoea).
  const ids = [...new Set(rateUpIds.map(wikiId))];
  if (ids.length !== 1) return html``;
  const owned = ownedOf(state.analysis, kind)?.get(ids[0]);
  if (!owned?.copies) return html``;
  // Where this banner's copies took them (its last copy); a banner that gave
  // none (a rerun of someone they have, one not pulled on yet) shows where they are now.
  const pool = poolId && canonicalPoolId(poolId);
  const last = pool ? owned.acquisitions.filter((x) => !x.extra && canonicalPoolId(x.poolId) === pool).at(-1) : undefined;
  const copy = last?.copy ?? owned.copies;
  const level = copyLabel(copy);
  return html`<span class="rateup-pot${copy >= MAX_COPIES ? ' max' : ''}" title="${last ? 'Potential after this banner' : 'Your Potential now'}: ${level}">${level}</span>`;
}

export function rateUpChip(b: BannerSummary): Html {
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
    ${rateUpIcon(got)}<span class="ellipsis">${names}</span>${rateUpPotential(b.kind, b.info.rateUpIds, b.poolId)}${total > 1 ? html`<span class="rateup-count">×${total}</span>` : ''}
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

/** An operator's Token from a banner: when it came, and the banner pull that earned it. */
interface TokenEntry {
  id: string;
  name: string;
  ts: number;
  seq: number;
  bannerName: string;
  /** The banner's pull count when it came (null if that pull isn't in the history). */
  at: number | null;
  estimated: boolean;
  /** Which copy it was (1 = the first). */
  copy: number;
}

/** The Potential a copy brought: P0 for the first, up to P5; spare copies past that as +1, +2... */
const copyLabel = (copy: number): string => (copy > MAX_COPIES ? `+${copy - MAX_COPIES}` : `P${copy - 1}`);

/** Each pulled copy's number (which copy of that operator or weapon it was), by pull. */
function copiesByPull(a: Analysis, kind: Kind): Map<AnalyzedPull, number> {
  const out = new Map<AnalyzedPull, number>();
  for (const o of ownedOf(a, kind)?.values() ?? []) for (const x of o.acquisitions) if (x.pull && !x.reward) out.set(x.pull, x.copy);
  return out;
}

/**
 * Every Token the player got: from the export's reward records, else worked
 * out from the pull count (estimated, older banners), as Potential counts them.
 */
function tokensOf(a: Analysis, kind: Kind): TokenEntry[] {
  const out: TokenEntry[] = [];
  const names = new Map(a.sixStars.map((x) => [wikiId(x.itemId), x.name]));
  for (const [id, o] of ownedOf(a, kind) ?? []) {
    for (const x of o.acquisitions) {
      if (!x.reward || x.extra) continue;
      // A listed Token comes with the pull that earned it: the banner's last pull up to it.
      const b = x.pull ? null : a.banners.find((y) => canonicalPoolId(y.poolId) === canonicalPoolId(x.poolId));
      const before = b?.pulls.filter((p) => p.ts < x.ts || (p.ts === x.ts && p.seq <= x.seq)).at(-1);
      out.push({ id, name: names.get(wikiId(id)) ?? (kind === 'char' ? 'Operator' : 'Weapon'), ts: x.ts, seq: x.seq, bannerName: x.bannerName, at: (x.pull ?? before)?.bannerPull ?? null, estimated: !!x.estimated, copy: x.copy });
    }
  }
  return out;
}

/**
 * Every 6★ for this kind, newest first: portrait with its pity underneath,
 * rate-ups outlined. Weapons that dropped in the same set of ten share one
 * box (as their pins share one oval on the banner's ruler). Operators'
 * Tokens are listed among them, with the banner pull that earned them. Two
 * rows until opened.
 */
export function sixStrip(kind: Kind, a: Analysis): Html {
  // Newest first; pulls from one ten-pull share a time, so their order breaks the tie.
  const sixes = a.sixStars.filter((x) => x.kind === kind).sort((x, y) => y.ts - x.ts || y.seq - x.seq);
  if (!sixes.length) return html``;
  const tokens = tokensOf(a, kind);
  const rewards = !tokens.length ? '' : kind === 'char' ? ` · ${tokens.length} Token${tokens.length > 1 ? 's' : ''}` : ` · ${tokens.length} rate-up cop${tokens.length > 1 ? 'ies' : 'y'}`;
  const copies = copiesByPull(a, kind);
  // Its Potential in the portrait's corner.
  const pot = (copy: number | undefined) => (copy ? html`<span class="six-pot">${copyLabel(copy)}</span>` : '');
  // Weapons from one set of ten (same banner, same set) together.
  const setKey = (x: AnalyzedPull) => (x.kind === 'weap' && x.bannerPull != null ? `${x.poolId}:${setOf(x.bannerPull)}` : null);
  const groups: AnalyzedPull[][] = [];
  for (const x of sixes) {
    const last = groups[groups.length - 1];
    if (last && setKey(x) !== null && setKey(x) === setKey(last[0])) last.push(x);
    else groups.push([x]);
  }
  const max = kind === 'char' ? 80 : WEAPON_PITY_SETS;
  const open = sixOpen.has(kind);
  return html`<div class="section six-section${open ? ' open' : ''}" data-kind="${kind}">
    <div class="section-head">
      <h2 class="heading-20">${withStars('6★ history')}</h2>
      <div class="row">
        <span class="label-13 secondary">${sixes.length} total${rewards} · newest first</span>
        <button class="btn tertiary sm six-toggle" data-action="six-strip" aria-expanded="${String(open)}">${open ? 'Show less' : 'Show all'}</button>
      </div>
    </div>
    <div class="six-strip">
      ${[...groups.map((g) => ({ ts: g[0].ts, seq: g[0].seq, g, t: null as TokenEntry | null })), ...tokens.map((t) => ({ ts: t.ts, seq: t.seq, g: null, t }))]
        .sort((x, y) => y.ts - x.ts || y.seq - x.seq)
        .map(({ g, t }) => {
        if (t) {
          // Arsenal counts in sets of ten.
          const n = t.at == null ? null : kind === 'weap' ? setOf(t.at) : t.at;
          const at = n != null ? `at ${kind === 'weap' ? 'set' : 'pull'} ${n}${t.estimated ? ' (estimated)' : ''}` : 'pull not in your history';
          const name = kind === 'char' ? `${t.name}'s Token` : `${t.name} (rate-up copy)`;
          return html`<a class="six-item token" href="${infoHref(kind, t.id)}" title="${name} · ${t.bannerName} · ${t.ts ? fmtDate(t.ts, true) : ''} · ${at}"><span class="six-art">${itemImg(kind, t.id, 'six-portrait')}${pot(t.copy)}</span><span class="six-pity">${kind === 'char' ? TOKEN_GLYPH : icon('redeem')}${n ?? '–'}</span></a>`;
        }
        g = g!;
        const p = g[0];
        const pity = html`<span class="six-pity">${p.pity === null ? html`<i style="background:var(--green)"></i>Free` : html`<i style="background:${heat(p.pity, max)}"></i>${p.pity}`}</span>`;
        // Rate-ups are outlined in their banner card's colour: the art's for
        // Headhunting, the weapon's own for Arsenal (as the cards glow).
        // Chartered banners (one rate-up) glow in the operator's colour; Joint ones in their art's.
        // A shared box takes its rate-up's.
        const up = g.find((x) => x.isRateUp);
        const byOperator = p.kind === 'char' && p.poolId.startsWith('special_');
        const tintUrl = up ? (up.kind === 'weap' ? itemIconUrl('weap', up.itemId) : byOperator ? itemIconUrl('char', up.itemId) : bannerArtUrl(up.poolId)) : null;
        const known = tintUrl ? sixTintFor(tintUrl) : null;
        const tintAttrs = tintUrl
          ? raw(`data-six-tint="${tintUrl.replace(/"/g, '&quot;')}" data-six-tint-kind="${p.kind === 'weap' ? 'weap' : byOperator ? 'op' : 'art'}"${known ? ` style="--six-tint:${known}"` : ''}`)
          : '';
        const cls = `six-item${up ? ' rateup' : ''}`;
        const title = (x: AnalyzedPull) => `${x.name} · ${x.bannerName} · ${fmtDate(x.ts, true)}`;
        // Portraits open that operator's or weapon's info page.
        if (g.length === 1) return html`<a class="${cls}" href="${infoHref(p.kind, p.itemId)}" title="${title(p)}" ${tintAttrs}><span class="six-art">${itemImg(p.kind, p.itemId, 'six-portrait')}${pot(copies.get(p))}</span>${pity}</a>`;
        // Its outline: the rate-up's colour around the rate-up, the usual outline around the rest, blending between.
        const step = 100 / g.length;
        const blend = Math.min(10, step / 3);
        const ring = g
          .map((x, i) => {
            const c = x.isRateUp ? 'var(--six-tint, var(--r6))' : 'var(--gray-alpha-400)';
            return `${c} ${(i ? i * step + blend : 0).toFixed(1)}%, ${c} ${(i < g.length - 1 ? (i + 1) * step - blend : 100).toFixed(1)}%`;
          })
          .join(', ');
        return html`<div class="${cls} shared" title="${g.map(title).join('\n')}" ${tintAttrs}>
          <span class="six-heads" style="--ring: linear-gradient(90deg, ${ring})"><span class="six-heads-in">${g.map((x) => html`<a class="six-art" href="${infoHref(x.kind, x.itemId)}" aria-label="${x.name} info">${itemImg(x.kind, x.itemId, 'six-portrait')}${pot(copies.get(x))}</a>`)}</span></span>
          ${pity}
        </div>`;
      })}
    </div>
  </div>`;
}

/** What the list page needs beyond the analysis: the banner catalog, for "All banners". */
export interface ListOptions {
  db: BannerDb;
  schedule: Schedule;
  server: Server;
  /** List every banner that has opened, not just the ones pulled on. */
  showAll: boolean;
}

/**
 * A banner the player didn't pull on (shown with "All banners"): its art,
 * name, rate-up and dates, nothing to expand.
 */
function unpulledCard(c: CatalogBanner, i = 0): Html {
  const weaponId = c.rateUpIds.find((id) => id.startsWith('wpn_'));
  const weapon = weaponId ? itemIconUrl('weap', weaponId) : '';
  const url = (c.art ? cdnUrl(c.art) : null) ?? (c.poolId ? bannerArtUrl(c.poolId) : null) ?? '';
  // Coloured like a pulled card: from its one rate-up when it has one (see
  // tintWeaponCards), else from the art.
  const operators = c.rateUpIds.filter((id) => id.startsWith('chr_'));
  const item = (c.kind === 'weap' ? weapon : operators.length === 1 ? itemIconUrl('char', operators[0]) : '') ?? '';
  const tintAttr = item ? raw(`data-tint-item="${item.replace(/"/g, '&quot;')}"${c.kind === 'char' ? ' data-tint-skin' : ''}`) : '';
  const tint = item ? '' : raw('data-tint');
  const img = url
    ? (!c.art && c.poolId ? issueArt(c.poolId, url) : null) ??
      html`<img src="${url}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback data-alt="${weapon}" />`
    : weapon
      ? html`<img class="weapon" src="${weapon}" alt="" loading="lazy" decoding="async" crossorigin="anonymous" ${tint} data-fallback />`
      : '';
  const when = c.start ? `${fmtDate(c.start)} – ${c.end ? fmtDate(c.end) : 'open'}` : 'Permanent';
  return html`<article class="card banner unpulled${enter(`unpulled:${c.poolId ?? c.name}`)}" ${c.poolId ? html`id="banner-${c.poolId}"` : ''} data-card-image="${c.name}" ${tintAttr} style="--banner-tint:${tintFor(item || url)};--i:${i}">
    <div class="banner-art">
      ${img}
      <div class="banner-art-text">
        <div class="banner-name ellipsis">${c.name}</div>
        ${c.rateUpNames.length ? html`<span class="banner-rateup">${rateUpIcon()}<span class="ellipsis">${c.rateUpNames.join(', ')}</span>${rateUpPotential(c.kind, c.rateUpIds.length ? c.rateUpIds : rateUpIdsOf(c.kind, c.poolId, c.rateUpNames), c.poolId)}</span>` : ''}
      </div>
    </div>
    <div class="unpulled-body">
      <span class="label-13 secondary">${when}</span>
      <span class="label-13 tertiary">No pulls</span>
    </div>
  </article>`;
}

/**
 * Banner cards light up under the pointer: a glow in the banner's colour
 * follows it around the card (--mx/--my, see .banner in styles.css).
 */
export function installCardGlow(): void {
  document.addEventListener('pointermove', (e) => {
    const card = (e.target as Element | null)?.closest?.<HTMLElement>('.banner, .sched-card');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
}

/**
 * Cards that have played their fade-in since the page opened: a redraw
 * (data loading, sync, a setting) draws them without it.
 */
const entered = new Set<string>();
export const resetCardEntrance = (): void => entered.clear();
const enter = (key: string): string => (entered.has(key) ? '' : (entered.add(key), ' enter'));

/** The banner cards: pulled ones, plus (with `showAll`) every other banner that has opened, by opening date. */
function bannerCards(kind: Kind, banners: BannerSummary[], opts: ListOptions): { cards: Html[]; total: number } {
  const ended = bannerEnded(opts.schedule, opts.server);
  if (!opts.showAll) return { cards: banners.map((b, i) => bannerSection(b, ended(b), i)), total: banners.length };
  const starts = poolStarts(opts.schedule, opts.server);
  const extra = unpulledBanners(kind, banners, opts.db, opts.schedule, opts.server);
  const items = [
    ...banners.map((b) => ({ basic: b.category === 'basic', at: starts.get(b.poolId) ?? b.firstTs, card: (i: number) => bannerSection(b, ended(b), i) })),
    ...extra.map((c) => ({ basic: c.poolId === 'standard', at: c.start ?? -Infinity, card: (i: number) => unpulledCard(c, i) })),
  ].sort((x, y) => Number(y.basic) - Number(x.basic) || y.at - x.at);
  return { cards: items.map((it, i) => it.card(i)), total: items.length };
}

export function listPage(kind: Kind, a: Analysis, opts: ListOptions): Html {
  const k = KIND[kind];
  const s = a[kind];
  const banners = bannersOf(kind, a);
  const sixes = a.sixStars.filter((x) => x.kind === kind && x.pity !== null);
  const avgPity = sixes.length ? sixes.reduce((n, x) => n + x.pity!, 0) / sixes.length : 0;
  const rateTier = luckTier(s.rate, s.expectedRate, s.pulls);
  const flips = s.won + s.lost;
  const winRate = flips ? s.won / flips : 0;
  const flipTier = luckTier(winRate, s.expectedWinRate, flips);
  const list = bannerCards(kind, banners, opts);

  return html`
    ${pageHeader(k.title, `${banners.length} banners · ${s.uniqueItems} unique ${k.items}`)}
    <main class="container fade-in">${pullsTabs(
      kind,
      html`${metrics(
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
          <h2 class="heading-20">Banners${opts.showAll ? html` <span class="label-13 secondary">${banners.length} of ${list.total} pulled on</span>` : ''}</h2>
          <div class="row">
            ${toggleGroup('banner-scope', [['pulled', 'Pulled on'], ['all', 'All banners']], opts.showAll ? 'all' : 'pulled')}
            <button class="btn tertiary sm" data-action="expand-all" data-value="1">Expand all</button>
            <button class="btn tertiary sm" data-action="expand-all" data-value="">Collapse all</button>
          </div>
        </div>
        <div class="banner-list">${list.cards}</div>
      </div>`,
    )}</main>`;
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

/**
 * Pity as the Material Symbols hourglass with its sand set by `run` (0-1,
 * pity / hard pity): the empty frame, plus two copies of the full hourglass,
 * each clipped to show only the sand left in the top bulb and the sand that
 * has run into the bottom one. The bulbs taper to the neck, so a sand
 * height goes with the square root of the amount in that bulb.
 */
// Sand rows of hourglass_full as a fraction of its 1em line box (measured
// from the font: the glyph is centred, ink 12%-88%).
const SAND_TOP = [0.175, 0.465];
const SAND_BOTTOM = [0.532, 0.823];
export function hourglass(run: number): Html {
  const r = Math.max(0, Math.min(1, run));
  const left = Math.sqrt(1 - r);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  // Top: sand from its surface down to the neck. Bottom: from its surface down.
  const top = SAND_TOP[1] - (SAND_TOP[1] - SAND_TOP[0]) * left;
  const bottom = SAND_BOTTOM[0] + (SAND_BOTTOM[1] - SAND_BOTTOM[0]) * left;
  return html`<span class="hourglass" aria-hidden="true">
    <span class="icon">hourglass_empty</span>
    <span class="icon sand" style="clip-path:inset(${pct(top)} 0 ${pct(1 - SAND_TOP[1])} 0)">hourglass_full</span>
    <span class="icon sand" style="clip-path:inset(${pct(bottom)} 0 0 0)">hourglass_full</span>
  </span>`;
}

/** "7 pulls" / "1 set of 10" / "3 sets of 10" toward the next reward. */
function rewardProgress(b: BannerSummary): string {
  const n = b.rewards!.progress;
  if (b.kind === 'weap') return `${n} ${n === 1 ? 'set' : 'sets'} of 10`;
  return `${fmtInt(n)} ${n === 1 ? 'pull' : 'pulls'}`;
}

/**
 * The pity counter at the top of a card. New Horizons ends at its first 6★
 * (by pull 40 at the latest), so it shows the pull that 6★ came on.
 */
function pityStat(b: BannerSummary, ended: boolean): Html {
  const unit = b.kind === 'weap' ? ' sets of 10' : '';
  const color = ended || b.pity.done ? 'var(--gray-700)' : heat(b.pity.value, b.pity.max);
  if (b.category === 'newHorizons') {
    const six = b.pulls.find((p) => p.rarity === 6 && p.pity !== null);
    const n = six ? six.pity! : b.pity.value;
    const say = six ? `First 6★ on pull ${n} of ${b.pity.max}; the banner has ended` : `${n} of ${b.pity.max}: a 6★ is certain by pull ${b.pity.max}, and the banner ends at the first one`;
    return html`<span class="glance-stat" style="color:${color}" title="${say}" aria-label="6★ pity: ${say}">${hourglass(six ? 1 : n / b.pity.max)}<b>${n}</b><i>/${b.pity.max} or first ${withStars('6★')}</i></span>`;
  }
  const say = b.pity.done ? 'done' : `${b.pity.value} of ${b.pity.max}${unit}${ended ? ' (banner ended)' : ''}`;
  return html`<span class="glance-stat" style="color:${color}" title="6★ pity: ${say}" aria-label="6★ pity ${say}">${hourglass(b.pity.done ? 1 : b.pity.value / b.pity.max)}<b>${b.pity.done ? 'Done' : b.pity.value}</b>${b.pity.done ? '' : html`<i>/${b.pity.max}</i>`}</span>`;
}

/**
 * One banner card. `ended`: the banner has closed, so its counters and ruler
 * go gray. `i`: its place in the list, which staggers the cards' fade-in.
 */
function bannerSection(b: BannerSummary, ended = false, i = 0): Html {
  const key = bannerKey(b);
  const { art: artSrc, weapon, item } = artUrls(b);
  const src = artSrc || weapon;
  // Cards with one rate-up glow in its own colour (the weapon's, or the
  // operator's with skin left out), not the banner art's.
  const tintAttr = item ? raw(`data-tint-item="${item.replace(/"/g, '&quot;')}"${b.kind === 'char' ? ' data-tint-skin' : ''}`) : '';
  const open = expanded.has(key);
  return html`<article class="card banner${open ? ' expanded' : ''}${ended ? ' ended' : ''}${enter(key)}" id="banner-${b.poolId}" data-pool="${key}" data-art="${src}" data-card-image="${b.name}" ${tintAttr} style="--banner-tint:${tintFor(item || src)};--i:${i}">
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
          ${pityStat(b, ended)}
          ${b.rewards
            ? html`<span class="glance-stat glance-reward" title="${rewardProgress(b)} toward the next ${b.rewards.nextReward.toLowerCase()} (${b.rewards.goal})" aria-label="${rewardProgress(b)} toward the next ${b.rewards.nextReward.toLowerCase()}">${b.rewards.nextReward === 'Token' ? TOKEN_GLYPH : icon(rewardIcon(b.rewards.nextReward), true)}<b>${fmtInt(b.rewards.progress)}</b></span>`
            : ''}
        </div>
        ${pityRuler(b, ended)}
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
/**
 * How wide a pin holding `n` portraits is, in single pins: a single pin is
 * 30px with its ring; an oval is 26px per icon, 2px padding each side and
 * the 2px ring.
 */
const pinWidth = (n: number) => (n > 1 ? 26 * n + 8 : 30) / 30;
/** More pins than this on one side of the track switch to compact markers. */
const MAX_FULL_PINS = 10;
/** Basic Headhunting's ruler covers only this many of the latest pulls. */
const BASIC_WINDOW = 300;
/** How crowded rows are drawn: thin tick marks off the track, or dots. */
const CROWDED_STYLE: 'tick' | 'dot' = 'tick';
/**
 * Lays out pins and teardrop markers on one side of the track. Items that would
 * touch form a group, spaced by their widths (`ws`, in pins: a pin holding two
 * portraits is wider) and centred on the mean of their true spots, so
 * neighbours spread out evenly either side of where they point. Groups stay
 * inside [0, hi of their last item], squeezing if they must; groups that meet
 * merge and are re-centred. `pcts` must be in ascending order.
 */
function declutter(pcts: number[], his: number[], ws: number[] = pcts.map(() => 1)): number[] {
  // The ruler's padding leaves room for half a pin past either end, so a pin
  // at the very first or last pull sits straight over its spot.
  const lo = 0;
  const gapAfter = (i: number) => (PIN_MIN_GAP * (ws[i] + ws[i + 1])) / 2;
  type Group = { first: number; n: number; sum: number; offsets: number[]; left: number };
  const place = (g: Group) => {
    const hi = his[g.first + g.n - 1];
    const full: number[] = [0];
    for (let k = 1; k < g.n; k++) full.push(full[k - 1] + gapAfter(g.first + k - 1));
    const span = full[g.n - 1];
    const squeeze = span > hi - lo ? (hi - lo) / span : 1;
    g.offsets = full.map((x) => x * squeeze);
    const mean = g.offsets.reduce((s, x) => s + x, 0) / g.n;
    g.left = Math.max(lo, Math.min(hi - span * squeeze, g.sum / g.n - mean));
  };
  let groups: Group[] = pcts.map((p, i) => ({ first: i, n: 1, sum: p, offsets: [0], left: p }));
  groups.forEach(place);
  for (let merged = true; merged; ) {
    merged = false;
    const out: Group[] = [];
    for (const g of groups) {
      const prev = out[out.length - 1];
      if (prev && g.left - (prev.left + prev.offsets[prev.n - 1]) < gapAfter(g.first - 1) - 0.01) {
        prev.n += g.n;
        prev.sum += g.sum;
        place(prev);
        merged = true;
      } else out.push(g);
    }
    groups = out;
  }
  const out: number[] = [];
  for (const g of groups) for (let k = 0; k < g.n; k++) out.push(g.left + g.offsets[k]);
  return out;
}

function pityRuler(b: BannerSummary, ended = false): Html {
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
  // A closed banner's ruler is a record, not a goal: all gray, nothing ahead.
  const fillColor = ended ? 'var(--gray-600)' : b.kind === 'char' ? 'var(--op)' : 'var(--ars)';
  const heatColor = ended ? 'var(--gray-700)' : heat(b.pity.value, max);

  // Second line: the current pity run, from the last 6★ (or carried-in pity)
  // to now, then faintly on to where hard pity would hit.
  const runStart = done - b.pity.value;
  const hardAt = runStart + max;
  const run = b.pity.done ? '' : html`<i class="ruler-run" style="left:${pct(runStart)}%;width:${pct(done) - pct(runStart)}%;background:${heatColor}"></i>`;
  const ahead = !ended && !b.pity.done && hardAt > done ? html`<i class="ruler-ahead" style="left:${pct(done)}%;width:${pct(hardAt) - pct(done)}%;background:${heatColor}"></i>` : '';

  // One item per pin or teardrop; `draw` gets its laid-out spot and `dx`, how
  // far its true spot is from there (in % of the ruler). CSS turns each tip
  // to aim at the true spot (see .ruler-body).
  type Item = { at: number; hi: number; w?: number; draw: (left: number, dx: number) => Html };
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
        draw: (left, dx) => html`<div class="ruler-mark ${passed ? 'passed' : 'ahead'}${below ? ' below' : ''}" style="left:${left}%;--dx:${dx}" aria-label="${name}, ${where}" data-tip="${tip(name, [tipNote(rewardInfo(name, b.kind)), tipRow(sets ? 'Set' : 'Pull', String(at)), tipRow('Status', passed ? 'Earned' : ended ? 'Not reached' : at === nextReward ? 'Next' : 'Coming up')])}">
          <span class="ruler-mark-label">${at}</span><span class="ruler-mark-drop">${name === 'Token' ? TOKEN_GLYPH : icon(rewardIcon(name), true)}</span>
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
    // 6★ from the same Arsenal set share one pin: their portraits side by
    // side in one oval over a single pointer. `list` is in pull
    // order, so a set's 6★ are next to each other.
    const bySpot: AnalyzedPull[][] = [];
    for (const p of list) {
      const last = bySpot[bySpot.length - 1];
      if (last && posOf(last[0]) === posOf(p)) last.push(p);
      else bySpot.push([p]);
    }
    const pinTitle = (p: AnalyzedPull) =>
      (sets ? `${p.name} · set ${posOf(p)} (pull ${p.bannerPull}) · pity ${p.pity}/${WEAPON_PITY_SETS}` : `${p.name} · pull ${p.bannerPull} · pity ${p.pity}`) +
      (p.outcome === 'guaranteed' ? ' · the rate-up guarantee' : '');
    const all = [
      ...items[side],
      ...bySpot.map((g): Item => ({
        at: pct(posOf(g[0])),
        hi: 100,
        w: pinWidth(g.length),
        // The guarantee's 6★: blue ring and number.
        draw: (left, dx) => html`<div class="ruler-pin ${side}${g.some((p) => p.outcome === 'guaranteed') ? ' guaranteed' : ''}" style="left:${left}%;--dx:${dx}" title="${g.map(pinTitle).join('\n')}">
          <span class="ruler-pin-label">${posOf(g[0])}</span>
          <span class="ruler-pin-heads${g.length > 1 ? ' multi' : ''}">${g.map((p) => html`<a href="${infoHref(p.kind, p.itemId)}" aria-label="${p.name} info">${itemImg(p.kind, p.itemId, 'ruler-portrait')}</a>`)}</span>
          <span class="ruler-pin-point"></span>
        </div>`,
      })),
    ].sort((x, y) => x.at - y.at);
    const spots = declutter(all.map((it) => it.at), all.map((it) => it.hi), all.map((it) => it.w ?? 1));
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
      ${b.kind === 'weap'
        ? // An Issue is pulled a set of 10 at a time: count sets, like the pity and the list's set headings.
          html`<span class="glance-stat" title="${fmtInt(b.paidPulls)} weapons"><b>${fmtInt(setOf(b.paidPulls))}</b>${setOf(b.paidPulls) === 1 ? 'set' : 'sets'}</span>`
        : html`<span class="glance-stat"><b>${fmtInt(b.paidPulls)}</b>pulls</span>`}
      <div class="rarity-filter" role="group" aria-label="Rarity">
        ${hasRateUp ? html`<button type="button" class="filter-up" data-action="filter" data-value="up" aria-pressed="${String(f.has('up'))}" title="Rate-up: always listed" aria-label="Rate-up">${icon('stat_2')}</button>` : ''}
        ${(
          [
            ['6', '6★'],
            ['5', '5★'],
            ['4', '4★'],
          ] as [Rarity, string][]
        ).map(([v, label]) => html`<button type="button" data-action="filter" data-value="${v}" aria-pressed="${String(f.has(v))}" aria-label="${label}">${withStars(label)}</button>`)}
      </div>
    </div>
    <div class="banner-scroll">${shown.length ? pullTable(b, shown) : html`<div class="table-empty">No pulls match this filter.</div>`}</div>`;
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
