import type { Analysis } from '../../domain/analyze';
import { canonicalPoolId } from '../../domain/banners';
import { timeOn } from '../../domain/schedule';
import { fmtPulls, type EventRewardsFile } from '../../domain/eventRewards';
import {
  bondQuota,
  patchIncome,
  pullsFrom,
  ticketsFromPulls,
  TICKETS_PER_ISSUE,
  type IncomeFile,
  type IncomeLine,
  type PaidIncome,
  type PatchIncome,
} from '../../domain/income';
import { patchStats, weeklyTimeline, type PatchStats } from '../../domain/patches';
import { currentServer, state } from '../../state';
import { weeklyChart } from '../charts';
import { TAB_ICON, badge, colorOf, icon, iconOf, itemName, metric, metrics, pageHeader, withStars } from '../components';
import { fmtDate, fmtInt, html, type Html } from '../html';
import { bannerHref, credit, external, pullsTabs, wikiFile } from './info';

/**
 * Stats: totals, pulls per week, and a per-patch breakdown table. Each patch
 * also shows the free pulls it handed out (domain/income.ts: events, daily
 * missions, Weekly Routine, Protocol Pass free track, and the Arsenal Tickets
 * Headhunting gives back), marked on its bars and listed when it's opened.
 * Toggles above the table add paid income (setting `paidIncome`): the pass's
 * Originium Supply and Protocol Customized tiers, and the Monthly Pass.
 * Headhunting counts limited pulls; Basic HH Permits are listed apart. The
 * current patch is projected to its end ("≈").
 */

const PAID_LABEL: Record<PaidIncome, string> = { originium: 'Originium Supply', customized: 'Protocol Customized', monthly: 'Monthly Pass' };

/** Patches whose row is open (showing their banners); kept across redraws. */
const openPatches = new Set<string>();
export function togglePatch(key: string): void {
  if (!openPatches.delete(key)) openPatches.add(key);
}

/** Pull currencies written as their icon and the number in their colour, no name. */
const CURRENCY: Record<string, string> = {
  Oroberyl: 'oroberyl',
  Origeometry: 'origeometry',
  'Chartered HH Permit': 'chartered',
  'Basic HH Permit': 'basic-permit',
  'Arsenal Ticket': 'arsenal-ticket',
};

/**
 * An amount of one item: "[icon] 1,600" for those currencies and for banner
 * HH Permits (in the permit's own colour), else "5 Arsenal Tickets"
 * (Oroberyl and Origeometry have no plural).
 */
function amount(k: string, n: number): Html {
  const src = k === 'Oroberyl' ? '/icons/oroberyl.webp' : iconOf('items', k);
  const own = !CURRENCY[k] && colorOf(k);
  if (src && (CURRENCY[k] || own))
    return html`<span class="amt${CURRENCY[k] ? ` amt-${CURRENCY[k]}` : ''}" ${own ? html`style="--amt:${own}"` : ''} title="${k}" aria-label="${fmtInt(n)} ${k}"><img src="${src}" alt="" />${fmtInt(n)}</span>`;
  return html`${fmtInt(n)} ${itemName(n !== 1 && /(Permit|Ticket)$/.test(k) ? `${k}s` : k)}`;
}

/** What a set of totals comes to, written out: "[icon] 1,600, [icon] 5". */
function itemsText(totals: Record<string, number>): Html {
  const items = Object.entries(totals)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => amount(k, n));
  return html`${items.flatMap((x, i) => (i ? [', ', x] : [x]))}`;
}
const hasItems = (totals: Record<string, number>) => Object.values(totals).some((n) => n > 0);

const plural = (n: number, one: string) => `${fmtInt(n)} ${one}${n === 1 ? '' : 's'}`;

/** One section of an opened patch's free pulls: its label, what's in it, and the pulls its lines come to. */
function incomeRow(label: Html | string, detail: Html | string, headhunting: number, arsenal: number, partial = false, paid = false, estimate = false): Html {
  const n = (x: number) => (x ? fmtPulls(Math.round(x * 10) / 10) : '–');
  return html`<div class="patch-income-row">
    <div class="min0"><div class="patch-income-label">${label}${partial ? html` ${badge('Partial', 'amber')}` : ''}${paid ? html` ${badge('Paid', 'outline')}` : ''}${estimate ? html` ${badge('Estimate', 'outline')}` : ''}</div><div class="patch-income-detail secondary">${detail}</div></div>
    <span class="num${headhunting ? '' : ' tertiary'}">${n(headhunting)}</span>
    <span class="num${arsenal ? '' : ' tertiary'}">${n(arsenal)}</span>
  </div>`;
}

/** The income file, for prices and rates; set while the page draws. */
let income: IncomeFile | null = null;

/** A daily or weekly line's totals for one day or week. */
const perOne = (totals: Record<string, number>, by: number) => Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, n / by]));

/** Pull currencies only: what a reward list shows of an event or source. */
const PULL_ITEM = /^(Oroberyl|Origeometry|Arsenal Ticket)$|HH Permit/;

/** "1,600 Oroberyl (3.2 pulls)": the pull currencies something gave, and the limited pulls they come to. */
function gave(totals: Record<string, number>): Html {
  const shown = Object.fromEntries(Object.entries(totals).filter(([k]) => PULL_ITEM.test(k)).map(([k, n]) => [k, Math.round(n)]));
  const p = pullsFrom(totals).headhunting;
  return hasItems(shown) ? html`${itemsText(shown)}${p ? ` (${fmtPulls(Math.round(p * 10) / 10)} ${p === 1 ? 'pull' : 'pulls'})` : ''}` : html`none`;
}

const bullets = (items: (Html | string | false | null | undefined)[]): Html =>
  html`<ul class="patch-income-bullets">${items.filter(Boolean).map((x) => html`<li>${x}</li>`)}</ul>`;

/** Marks on an amount that isn't the game's own figure; hover says why. */
const ESTIMATED = html`<span title="No amounts on the wiki: what others of its kind give">≈</span>`;
const PARTIAL = html`<span title="The wiki lists some of its rewards without amounts">*</span>`;

/**
 * An opened patch's earned pulls in sections, in this order: Daily Missions,
 * Weekly Missions, Protocol Pass, Monthly Pass (when turned on), Permanent
 * Modes, Events, Exploration, Mailbox, Shops; then the Arsenal Tickets
 * Headhunting gave back, and the total. Only pull currencies are listed.
 * `bond`: the Bond Quota the player's duplicate operators gave this patch.
 */
function patchIncomeList(inc: PatchIncome, tickets: Tickets, bond: number, dossiers: Dossiers | undefined): Html {
  const dossierPulls = (dossiers?.count ?? 0) * DOSSIER_PULLS;
  const back = ((tickets.patch + tickets.other) / TICKETS_PER_ISSUE) * 10;
  const of = (...sources: IncomeLine['source'][]) => inc.lines.filter((l) => sources.includes(l.source));
  /** A section's row: its lines' pulls added up, their badges merged. */
  const section = (label: Html | string, lines: IncomeLine[], detail: Html | string) => {
    if (!lines.length) return '';
    const sum = lines.reduce(
      (a, l) => {
        const p = pullsFrom(l.totals);
        return { headhunting: a.headhunting + p.headhunting, arsenal: a.arsenal + p.arsenal };
      },
      { headhunting: 0, arsenal: 0 },
    );
    return incomeRow(label, detail, sum.headhunting, sum.arsenal, lines.some((l) => l.partial), lines.some((l) => l.paid), lines.some((l) => l.estimate));
  };

  const [daily] = of('daily');
  const [weekly] = of('weekly');
  const [pass] = of('pass');
  const tier = (source: IncomeLine['source']) => inc.lines.find((t) => t.source === source && t.name === pass?.name);
  const originium = pass && tier('originium');
  const customized = pass && tier('customized');
  const [monthly] = of('monthly');
  const [modes] = of('modes');
  const [events] = of('events');
  const [drills] = of('combatDrills');
  const [craft] = of('crafting');
  const [aur] = of('aurylene');
  const [crateLine] = of('crates');
  const [quests] = of('quests');
  const [outposts] = of('outposts');
  const [prog] = of('progression');
  const [comp] = of('compensation');
  const [survey] = of('survey');
  const [live] = of('livestream');
  const [aic] = of('aicShop');
  const [credit] = of('creditStore');
  const once = (section: IncomeLine['section']) => inc.lines.find((l) => l.source === 'oneTime' && l.section === section);
  const onceModes = once('modes');
  const onceExplore = once('exploration');
  const onceMail = once('mailbox');
  const onceBullets = (l: IncomeLine | undefined) =>
    (l?.oneTime ?? []).map((x) => html`${external(x.url, x.count > 1 ? `${x.name} (${fmtInt(x.count)})` : x.name)}: ${gave(x.rewards)}${x.estimate ? html` ${ESTIMATED}` : ''}`);
  // The player's Bond Quota this patch, as whole Chartered HH Permits.
  const bondPrice = income?.shops?.bond.price ?? 0;
  const bondPermits = bondPrice ? Math.floor(bond / bondPrice) : 0;
  const bondLine: IncomeLine | undefined = bondPermits
    ? { source: 'bondShop', count: bondPermits, totals: { 'Chartered HH Permit': bondPermits }, url: income?.shops?.bond.url }
    : undefined;

  return html`<div class="patch-income">
    <div class="patch-income-row patch-income-head label-12">
      <span>Pull sources${inc.projected ? ` (projected to ${fmtDate(inc.end)})` : inc.ongoing ? ' (so far)' : ''}</span><span>Headhunting</span><span>Arsenal</span>
    </div>
    ${daily ? section(html`${external(daily.url!, 'Daily Missions')}`, [daily], html`${plural(daily.count, 'day')} × ${itemsText(perOne(daily.totals, daily.count))}`) : ''}
    ${weekly ? section(html`${external(weekly.url!, 'Weekly Missions')}`, [weekly], html`${plural(weekly.count, 'week')} × ${itemsText(perOne(weekly.totals, weekly.count))}`) : ''}
    ${pass
      ? section(
          html`${external(pass.url!, `Protocol Pass: ${pass.name}`)}`,
          [pass, originium, customized].filter((l): l is IncomeLine => !!l),
          bullets([
            html`Free track: ${gave(pass.totals)}`,
            originium && html`Originium Supply: ${gave(originium.totals)}`,
            customized && html`Protocol Customized: ${gave(customized.totals)}`,
          ]),
        )
      : ''}
    ${monthly ? section(html`${external(monthly.url!, 'Monthly Pass')}`, [monthly], `${plural(monthly.count, 'day')}: ${gave(monthly.totals)}`) : ''}
    ${section(
      'Permanent Modes',
      [modes, onceModes].filter((l): l is IncomeLine => !!l),
      bullets([
        ...(modes?.modes ?? []).map((x) => html`${external(x.url, x.name)}: ${x.partial ? 'amount not listed' : gave(x.rewards)}${x.estimated ? html` ${ESTIMATED}` : ''}`),
        ...onceBullets(onceModes),
      ]),
    )}
    ${events || drills
      ? section(
          `Events${events ? ` (${events.count})` : ''}`,
          [events, drills].filter((l): l is IncomeLine => !!l),
          bullets([
            ...(events?.events ?? []).map(
              (e) =>
                html`${e.id != null ? html`<a href="/event/${e.id}" data-link="/event/${e.id}">${e.name}</a>` : external(e.url!, e.name)}: ${gave(e.totals)}${e.partial ? html` ${PARTIAL}` : ''}${e.estimated ? html` ${ESTIMATED}` : ''}`,
            ),
            drills && html`Combat Drills: ${gave(drills.totals)}`,
          ]),
        )
      : ''}
    ${section(
      'Exploration',
      [crateLine, aur, craft, quests, outposts, prog, onceExplore].filter((l): l is IncomeLine => !!l),
      bullets([
        crateLine && html`Storage crates (${fmtInt(crateLine.count)}): ${gave(crateLine.totals)}`,
        aur && html`${external(aur.url!, 'Aurylene')}: ${hasItems(aur.totals) ? gave(aur.totals) : 'none listed'}`,
        craft && html`${external(craft.url!, 'Crafting Manual')}: ${gave(craft.totals)}`,
        quests && html`Missions: ${gave(quests.totals)}`,
        outposts && html`Outposts: ${gave(outposts.totals)}`,
        ...(prog?.items ?? []).map((x) => html`${external(x.url, x.name)}: ${gave(x.rewards)}`),
        ...onceBullets(onceExplore),
      ]),
    )}
    ${section(
      'Mailbox',
      [comp, survey, live, onceMail].filter((l): l is IncomeLine => !!l),
      bullets([
        ...(comp?.rows ?? []).map((r) => html`${external(comp!.url!, r.label)}: ${gave(r.rewards)}`),
        survey && html`${survey.extra!.label}: ${gave(survey.totals)}`,
        live && html`${live.extra!.label}: ${gave(live.totals)}`,
        ...onceBullets(onceMail),
      ]),
    )}
    ${section(
      'Shops',
      [aic, credit, bondLine].filter((l): l is IncomeLine => !!l),
      bullets([
        aic && html`${external(aic.url!, 'AIC Quota Exchange')}: ${gave(aic.totals)}`,
        credit && html`${external(credit.url!, 'Credit Store')} (${plural(credit.count, 'day')}): ${gave(credit.totals)} ${ESTIMATED}`,
        bondLine && html`${external(bondLine.url!, 'Bond Quota Exchange')}: ${gave(bondLine.totals)}, from ${fmtInt(bond)} Bond Quota`,
      ]),
    )}
    ${dossiers ? incomeRow('Headhunting Dossiers', `${plural(dossiers.count, 'Dossier')} × 10 pulls, from ${dossiers.from.join(', ')}`, dossierPulls, 0) : ''}
    ${tickets.patch + tickets.other
      ? incomeRow(
          'Your Headhunting pulls',
          tickets.other
            ? bullets([
                tickets.patch > 0 && html`Patch banners: ${amount('Arsenal Ticket', tickets.patch)}`,
                html`Basic Headhunting and other banners: ${amount('Arsenal Ticket', tickets.other)}`,
              ])
            : html`${amount('Arsenal Ticket', tickets.patch)} back`,
          0,
          back,
        )
      : ''}
    <div class="patch-income-row patch-income-total">
      <span>${inc.basic ? html`Plus ${amount('Basic HH Permit', Math.round(inc.basic))}` : 'In all'}</span><span class="num">${fmtPulls(Math.round((inc.headhunting + (bondLine ? bondPermits : 0) + dossierPulls) * 10) / 10)}</span><span class="num">${fmtPulls(Math.round((inc.arsenal + back) * 10) / 10)}</span>
    </div>
  </div>`;
}

/** An open patch's free pulls, then its banners: every one, pulled on or not, in opening order. */
/** A Headhunting Dossier: a 10-pull for the next Chartered banner, given at 60 paid pulls on one. */
const DOSSIER_AT = 60;
const DOSSIER_PULLS = 10;

/** The Dossiers usable on a patch's banners: how many, the banners that gave them, and how many of those banners have opened. */
interface Dossiers {
  count: number;
  from: string[];
  opened: number;
}

/** Arsenal Tickets back from a patch's own banners, and from pulls made then on banners outside any patch. */
interface Tickets {
  patch: number;
  other: number;
}

function patchBanners(p: PatchStats, inc: PatchIncome | undefined, tickets: Tickets, bond: number, dossiers: Dossiers | undefined): Html {
  return html`<tr class="patch-banners"><td colspan="3"><div class="patch-banner-list">
    ${p.banners.map((b) => {
      const s = b.summary;
      const kind = b.kind === 'weap' ? 'Arsenal' : 'Headhunting';
      const inner = html`${TAB_ICON[b.kind === 'weap' ? 'arsenal' : 'operators']}
        <span class="patch-banner-name ellipsis">${b.name}</span>
        <span class="patch-banner-when secondary">${b.start ? fmtDate(b.start) : kind}</span>
        <span class="patch-banner-pulls num${s?.paidPulls ? '' : ' tertiary'}">${s?.paidPulls ? `${fmtInt(s.paidPulls)} pulls` : 'No pulls'}</span>`;
      return s?.paidPulls && b.poolId
        ? html`<a class="patch-banner ${b.kind}" href="${bannerHref(b.kind, b.poolId)}" title="${kind}">${inner}</a>`
        : html`<div class="patch-banner ${b.kind} unpulled" title="${kind}">${inner}</div>`;
    })}
  </div>${inc?.lines.length ? patchIncomeList(inc, tickets, bond, dossiers) : ''}</td></tr>`;
}

/**
 * Earned per week since the player's first pull and up to now (the current
 * patch's projection prorated by time): limited Headhunting pulls, and
 * Arsenal Issues (sets of 10) with the Arsenal Tickets the player's
 * Headhunting results gave back.
 */
function perWeekOf(a: Analysis, patches: Iterable<PatchIncome>): { char: string; issues: string } {
  const now = Date.now();
  const from = a.firstTs;
  let earned = 0;
  let earnedArsenal = 0;
  let any = false;
  for (const inc of patches) {
    any = true;
    const span = inc.end - inc.start;
    const overlap = Math.min(inc.end, now) - Math.max(inc.start, from);
    if (span > 0 && overlap > 0) {
      earned += inc.headhunting * (overlap / span);
      earnedArsenal += inc.arsenal * (overlap / span);
    }
  }
  earnedArsenal += (ticketsFromPulls(a.banners.flatMap((b) => (b.kind === 'char' ? b.pulls : []))) / TICKETS_PER_ISSUE) * 10;
  const weeksSince = (now - from) / (7 * 86_400_000);
  // Per week: the metrics say so underneath.
  const perWeek = (n: number, unit = '') => (any && weeksSince > 0 ? `${fmtPulls(Math.round((n / weeksSince) * 10) / 10)}${unit}` : '–');
  return { char: perWeek(earned), issues: perWeek(earnedArsenal / 10, ' (×10)') };
}

/** The same, for Home's Stats widget. */
export function earnedPerWeek(a: Analysis, redraw: () => void): { char: string; issues: string } {
  const events = wikiFile<EventRewardsFile>('events.json', redraw);
  const data = wikiFile<IncomeFile>('income.json', redraw).data;
  return perWeekOf(a, patchIncome(state.schedule, currentServer(), Date.now(), events.data, data, state.settings.paidIncome ?? [], a.firstTs));
}

export function statsPage(a: Analysis, redraw: () => void): Html {
  const events = wikiFile<EventRewardsFile>('events.json', redraw);
  const incomeFile = wikiFile<IncomeFile>('income.json', redraw);
  income = incomeFile.data;
  const paid = state.settings.paidIncome ?? [];
  const free = new Map(patchIncome(state.schedule, currentServer(), Date.now(), events.data, income, paid, a.firstTs).map((p) => [p.key, p]));
  // Operator pulls on banners outside any patch (Basic Headhunting, New Horizons) count for the patch they were made in.
  const otherPulls = a.banners.filter((b) => b.kind === 'char' && b.patch.major === -1).flatMap((b) => b.pulls);
  const otherIn = (p: PatchStats) => {
    const inc = p.patch.major === -1 ? undefined : free.get(p.patch.key);
    return inc ? otherPulls.filter((x) => x.ts >= inc.start && x.ts < inc.end) : [];
  };
  // Constant Issue pulls count as Arsenal pulls made in the patch they were made in, like the tickets that pay for them.
  const constantPulls = a.banners.filter((b) => b.kind === 'weap' && b.patch.major === -1).flatMap((b) => b.pulls.filter((x) => !x.isFree));
  const weapMadeOf = (p: PatchStats) => {
    const inc = p.patch.major === -1 ? undefined : free.get(p.patch.key);
    return p.weapPulls + (inc ? constantPulls.filter((x) => x.ts >= inc.start && x.ts < inc.end).length : 0);
  };
  /** Arsenal Tickets a patch's Headhunting results gave back. */
  const ticketsOf = (p: PatchStats): Tickets => ({
    patch: ticketsFromPulls(p.banners.flatMap((b) => (b.kind === 'char' ? (b.summary?.pulls ?? []) : []))),
    other: ticketsFromPulls(otherIn(p)),
  });
  const ticketPulls = (p: PatchStats) => {
    const t = ticketsOf(p);
    return ((t.patch + t.other) / TICKETS_PER_ISSUE) * 10;
  };
  // Bond Quota: what each duplicate 5★ / 6★ operator gave, then by patch, as whole Chartered HH Permits.
  const bondByPull = income?.shops ? bondQuota(a.banners.flatMap((b) => b.pulls), income.shops.bond.duplicate) : new Map<object, number>();
  const bondOf = (p: PatchStats) =>
    [...p.banners.flatMap((b) => b.summary?.pulls ?? []), ...otherIn(p)].reduce((n, x) => n + (bondByPull.get(x) ?? 0), 0);
  // Headhunting Dossiers: the export's records where it lists a banner's rewards, else one per Chartered banner at
  // 60 paid pulls. Each is a 10-pull on the next Chartered banner, so it counts for that banner's patch.
  const giftPools = new Set(a.gifts.filter((g) => g.kind === 'char').map((g) => canonicalPoolId(g.poolId)));
  const released = state.schedule.versions.filter((v) => v.release).map((v) => v.name);
  const charteredOrder = state.schedule.banners
    .filter((b) => ['chartered', 'special', 'refactor'].includes(b.kind))
    .map((b) => ({
      poolId: b.poolId ? canonicalPoolId(b.poolId) : null,
      minor: b.version ? released.indexOf(b.version) : -1,
      start: timeOn(b.start, currentServer()) ?? Infinity,
    }))
    .sort((x, y) => x.start - y.start);
  const dossiers = new Map<string, Dossiers>();
  for (const s of a.banners) {
    if (s.kind !== 'char' || s.category !== 'chartered') continue;
    const n = giftPools.has(s.poolId)
      ? a.gifts.filter((g) => g.gift === 'gift_intel_book' && canonicalPoolId(g.poolId) === s.poolId).length
      : s.paidPulls >= DOSSIER_AT
        ? 1
        : 0;
    if (!n) continue;
    const at = charteredOrder.findIndex((b) => b.poolId === s.poolId);
    const next = at >= 0 ? charteredOrder[at + 1] : undefined;
    // Not in the schedule: its own patch. Its next banner not announced yet: nowhere so far.
    const key = at < 0 ? s.patch.key : next && next.minor >= 0 ? `1.${next.minor}` : null;
    if (!key) continue;
    const d = dossiers.get(key) ?? { count: 0, from: [], opened: 0 };
    d.count += n;
    d.from.push(s.name);
    if (!next || next.start <= Date.now()) d.opened += n;
    dossiers.set(key, d);
  }
  const dossiersOf = (p: PatchStats) => (p.patch.major === -1 ? undefined : dossiers.get(p.patch.key));
  const bondPermitsOf = (p: PatchStats) => (income?.shops ? Math.floor(bondOf(p) / income.shops.bond.price) : 0);
  const freeOf = (p: PatchStats) => {
    const inc = free.get(p.patch.key);
    return inc?.lines.length
      ? { char: inc.headhunting + bondPermitsOf(p) + (dossiersOf(p)?.count ?? 0) * DOSSIER_PULLS, weap: inc.arsenal + ticketPulls(p), projected: inc.projected }
      : null;
  };
  const patches = patchStats(a, state.db, state.schedule)
    .filter((p) => p.charPulls + weapMadeOf(p) > 0 || freeOf(p))
    // Permanent banners first: the table ends with the total.
    .sort((x, y) => (x.patch.major === -1 ? -1 : y.patch.major === -1 ? 1 : y.patch.major - x.patch.major || y.patch.minor - x.patch.minor));
  const maxPulls = Math.max(1, ...patches.map((p) => Math.max(p.charPulls, weapMadeOf(p), freeOf(p)?.char ?? 0, freeOf(p)?.weap ?? 0)));
  const weeks = weeklyTimeline(a);
  const now = Date.now();
  const per = perWeekOf(a, free.values());
  /**
   * Pulls made over pulls earned, on one scale: the solid bar is what was
   * pulled, the faded one under it what the patch handed out (≈ while it's
   * projected). The hover tip says which is bigger, and by how much.
   */
  const bar = (n: number, earned: number | undefined, color: string, projected = false) => {
    const pct = (x: number) => `${Math.min(100, (x / maxPulls) * 100)}%`;
    if (earned == null)
      return html`<div class="bar-cell"><span class="num">${fmtInt(n)}</span><div class="bar"><i style="width:${pct(n)};background:${color}"></i></div></div>`;
    const e = Math.round(earned);
    const diff = n - e;
    const tip = `${fmtInt(n)} spent · ${projected ? '≈' : ''}${fmtInt(e)} ${paid.length ? 'earned' : 'free'}${projected ? ' (projected to the patch end)' : ''}: ${
      diff > 0 ? `${fmtInt(diff)} more than earned (savings or bought)` : diff < 0 ? `${fmtInt(-diff)} spare` : 'all of it'
    }`;
    return html`<div class="bar-pair" title="${tip}">
      <span class="num">${fmtInt(n)}</span><div class="bar"><i style="width:${pct(n)};background:${color}"></i></div>
      <span class="num secondary">${projected ? '≈' : ''}${fmtInt(e)}</span><div class="bar earned"><i style="width:${pct(earned)};background:${color}"></i></div>
    </div>`;
  };
  const anyFree = patches.some(freeOf);

  // The total: pulls made against pulls earned up to today (the current patch's
  // earnings prorated by how much of it has passed, not projected). Operators:
  // patch banners only (not Basic Headhunting); Arsenal: patch Issues and the
  // Constant Issue pulls made in each patch.
  const sofar = (key: string) => {
    const inc = free.get(key);
    if (!inc) return 0;
    const span = inc.end - inc.start;
    return span > 0 ? Math.max(0, Math.min(1, (now - inc.start) / span)) : 1;
  };
  const total = patches.reduce(
    (t, p) => {
      if (p.patch.major === -1) return t;
      const inc = free.get(p.patch.key);
      const f = sofar(p.patch.key);
      return {
        charMade: t.charMade + p.charPulls,
        weapMade: t.weapMade + weapMadeOf(p),
        charEarned: t.charEarned + (inc ? inc.headhunting * f : 0) + bondPermitsOf(p) + (dossiersOf(p)?.opened ?? 0) * DOSSIER_PULLS,
        weapEarned: t.weapEarned + (inc ? inc.arsenal * f : 0) + ticketPulls(p),
      };
    },
    { charMade: 0, weapMade: 0, charEarned: 0, weapEarned: 0 },
  );
  const totalMax = Math.max(1, total.charMade, total.weapMade, total.charEarned, total.weapEarned);
  /** A total cell: made over earned on their own scale, and the gain or deficit. */
  const totalCell = (made: number, earnedPulls: number, color: string) => {
    const e = Math.round(earnedPulls);
    const diff = made - e;
    const pct = (x: number) => `${Math.min(100, (x / totalMax) * 100)}%`;
    return html`<div class="bar-pair" title="${fmtInt(made)} spent · ${fmtInt(e)} earned so far">
        <span class="num">${fmtInt(made)}</span><div class="bar"><i style="width:${pct(made)};background:${color}"></i></div>
        <span class="num secondary">${fmtInt(e)}</span><div class="bar earned"><i style="width:${pct(earnedPulls)};background:${color}"></i></div>
      </div>
      <div class="patch-total-diff label-13">${diff > 0 ? html`<b class="num">−${fmtInt(diff)}</b> more pulls than earned` : diff < 0 ? html`<b class="num">+${fmtInt(-diff)}</b> earned, not pulled yet` : 'Even'}</div>`;
  };

  return html`
    <main class="container fade-in">${pullsTabs(
      'stats',
      pageHeader('Stats', `${fmtDate(a.firstTs)} – ${fmtDate(a.lastTs)}`),
      html`${metrics([
        metric({ label: 'Operator pulls', value: fmtInt(a.char.pulls), sub: `${a.char.sixStars} × 6★` }),
        metric({ label: 'Arsenal pulls', value: fmtInt(a.weap.pulls), sub: `${a.weap.sixStars} × 6★` }),
        metric({ label: 'Chartered permits earned', value: per.char, sub: 'per week' }),
        metric({ label: 'Arsenal Issues earned', value: per.issues, sub: 'per week' }),
      ], 'plain')}

      <div class="section card">
        <div class="card-head">
          <h2 class="heading-16">Pulls per week</h2>
          <div class="legend">
            <span><i style="background:var(--op)"></i>Operators</span>
            <span><i style="background:var(--ars)"></i>Arsenal</span>
            <span><i class="round" style="background:var(--r6)"></i>${withStars('Week with a 6★')}</span>
          </div>
        </div>
        <div class="card-body">${weeklyChart(weeks)}</div>
      </div>

      <div class="section card">
        <div class="card-head">
          <h2 class="heading-16">By patch</h2>
          ${anyFree
            ? html`<div class="legend">
                <span><i style="background:var(--gray-1000)"></i>Pulls spent</span>
                <span><i class="faded" style="background:var(--gray-1000)"></i>${paid.length ? 'Pulls earned' : 'Free pulls earned'}</span>
              </div>`
            : ''}
        </div>
        ${income?.passTiers || income?.monthly
          ? html`<div class="card-body paid-income">
              <span class="label-13 secondary">Add paid:</span>
              ${(['originium', 'customized', 'monthly'] as PaidIncome[])
                .filter((k) => (k === 'monthly' ? income?.monthly : income?.passTiers))
                .map((k) => html`<button type="button" class="attr-toggle" data-action="paid-income" data-value="${k}" aria-pressed="${String(paid.includes(k))}">${PAID_LABEL[k]}</button>`)}
            </div>`
          : ''}
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Patch</th><th>Operator pulls</th><th>Arsenal pulls</th></tr></thead>
          <tbody>
            ${patches.map((p) => {
              const open = openPatches.has(p.patch.key);
              const earned = freeOf(p);
              return html`<tr class="patch-row${open ? ' open' : ''}">
                <td class="label-14"><button type="button" class="patch-toggle" data-action="patch-toggle" data-value="${p.patch.key}" aria-expanded="${String(open)}">${icon('chevron_right')}${p.patch.major === -1 ? 'Permanent' : `Patch ${p.patch.key}`}</button></td>
                <td>${bar(p.charPulls, earned?.char, 'var(--op)', earned?.projected)}</td>
                <td>${bar(weapMadeOf(p), earned?.weap, 'var(--ars)', earned?.projected)}</td>
              </tr>${open ? patchBanners(p, free.get(p.patch.key), ticketsOf(p), bondOf(p), dossiersOf(p)) : ''}`;
            })}
          </tbody>
          ${anyFree
            ? html`<tfoot>
                <tr class="patch-total">
                  <td class="label-14">In all<div class="label-12 secondary">To today</div></td>
                  <td title="Patch banners only (not the Permanent row)">${totalCell(total.charMade, total.charEarned, 'var(--op)')}</td>
                  <td title="Patch Issues, and Constant Issues by the patch you pulled them in">${totalCell(total.weapMade, total.weapEarned, 'var(--ars)')}</td>
                </tr>
              </tfoot>`
            : ''}
        </table></div>
      </div>`,
    )}
      ${anyFree && income ? credit(income.attribution) : ''}
    </main>`;
}
