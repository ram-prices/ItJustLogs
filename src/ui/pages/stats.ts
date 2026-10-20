import type { Analysis } from '../../domain/analyze';
import { fmtPulls, type EventRewardsFile } from '../../domain/eventRewards';
import { patchIncome, pullsFrom, ticketsFromPulls, TICKETS_PER_ISSUE, type IncomeFile, type IncomeLine, type PatchIncome } from '../../domain/income';
import { patchStats, weeklyTimeline, type PatchStats } from '../../domain/patches';
import { currentServer, state } from '../../state';
import { weeklyChart } from '../charts';
import { TAB_ICON, badge, icon, metric, metrics, pageHeader } from '../components';
import { fmtDate, fmtInt, html, type Html } from '../html';
import { credit, external, wikiFile } from './info';

/**
 * Stats: totals, pulls per week, and a per-patch breakdown table. Each patch
 * also shows the free pulls it handed out (domain/income.ts: events, daily
 * missions, Weekly Routine, Protocol Pass free track, and the Arsenal Tickets
 * Headhunting gives back), marked on its bars and listed when it's opened.
 */

/** Patches whose row is open (showing their banners); kept across redraws. */
const openPatches = new Set<string>();
export function togglePatch(key: string): void {
  if (!openPatches.delete(key)) openPatches.add(key);
}

/** What a set of totals comes to, written out: "1,600 Oroberyl, 5 Basic HH Permits" (Oroberyl and Origeometry have no plural). */
function itemsText(totals: Record<string, number>): string {
  return Object.entries(totals)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${fmtInt(n)} ${n !== 1 && /(Permit|Ticket)$/.test(k) ? `${k}s` : k}`)
    .join(', ');
}

const plural = (n: number, one: string) => `${fmtInt(n)} ${one}${n === 1 ? '' : 's'}`;

/** One source of free pulls in an opened patch. */
function incomeRow(label: Html | string, detail: Html | string, headhunting: number, arsenal: number, partial = false): Html {
  const n = (x: number) => (x ? fmtPulls(Math.round(x * 10) / 10) : '–');
  return html`<div class="patch-income-row">
    <div class="min0"><div class="patch-income-label">${label}${partial ? html` ${badge('Partial', 'amber')}` : ''}</div><div class="patch-income-detail secondary">${detail}</div></div>
    <span class="num${headhunting ? '' : ' tertiary'}">${n(headhunting)}</span>
    <span class="num${arsenal ? '' : ' tertiary'}">${n(arsenal)}</span>
  </div>`;
}

function incomeLine(l: IncomeLine): Html {
  const { headhunting, arsenal } = pullsFrom(l.totals);
  switch (l.source) {
    case 'events':
      return incomeRow(
        plural(l.count, 'event'),
        html`${l.events!.map((e, i) => html`${i ? ' · ' : ''}<a href="/event/${e.id}" data-link="/event/${e.id}">${e.name}</a>${e.partial ? '*' : ''}`)}`,
        headhunting,
        arsenal,
        l.partial,
      );
    case 'daily':
      return incomeRow(html`${external(l.url!, 'Daily missions')}`, `${plural(l.count, 'day')} × ${itemsText(pullsDiv(l.totals, l.count))}`, headhunting, arsenal);
    case 'weekly':
      return incomeRow(html`${external(l.url!, 'Weekly Routine')}`, `${plural(l.count, 'week')} × ${itemsText(pullsDiv(l.totals, l.count))}`, headhunting, arsenal);
    case 'pass':
      return incomeRow(html`${external(l.url!, `Protocol Pass: ${l.name}`)}`, `Free track: ${itemsText(l.totals)}`, headhunting, arsenal);
    default:
      return html``;
  }
}

/** A daily or weekly line's totals for one day or week. */
const pullsDiv = (totals: Record<string, number>, by: number) => Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, n / by]));

/** An opened patch's free pulls, source by source. */
function patchIncomeList(inc: PatchIncome, tickets: number): Html {
  const back = (tickets / TICKETS_PER_ISSUE) * 10;
  return html`<div class="patch-income">
    <div class="patch-income-row patch-income-head label-12">
      <span>Free pulls${inc.ongoing ? ' so far' : ''}</span><span>Headhunting</span><span>Arsenal</span>
    </div>
    ${inc.lines.map(incomeLine)}
    ${tickets ? incomeRow('Your Headhunting pulls', `${fmtInt(tickets)} Arsenal Tickets back (20, 200 or 2,000 for each 4★, 5★ or 6★)`, 0, back) : ''}
    <div class="patch-income-row patch-income-total">
      <span>In all</span><span class="num">${fmtPulls(Math.round(inc.headhunting * 10) / 10)}</span><span class="num">${fmtPulls(Math.round((inc.arsenal + back) * 10) / 10)}</span>
    </div>
    <p class="patch-income-note copy-13 secondary">If you did every daily and weekly. Oroberyl at 500 a pull, Origeometry at 75 Oroberyl, each HH Permit one pull, Arsenal Tickets at 1,980 for an Issue of 10.
      Not counted: one-time rewards (story, exploration, achievements), mail and compensation, and anything bought.${inc.partial ? ' * The wiki lists some of that event\'s rewards without amounts, so the totals are what\'s known so far.' : ''}</p>
  </div>`;
}

/** An open patch's free pulls, then its banners: every one, pulled on or not, in opening order. */
function patchBanners(p: PatchStats, inc: PatchIncome | undefined, tickets: number): Html {
  return html`<tr class="patch-banners"><td colspan="6">${inc?.lines.length ? patchIncomeList(inc, tickets) : ''}<div class="patch-banner-list">
    ${p.banners.map((b) => {
      const s = b.summary;
      const six = s ? s.pulls.filter((x) => x.rarity === 6).length : 0;
      const kind = b.kind === 'weap' ? 'Arsenal' : 'Headhunting';
      const inner = html`${TAB_ICON[b.kind === 'weap' ? 'arsenal' : 'operators']}
        <span class="patch-banner-name ellipsis">${b.name}</span>
        <span class="patch-banner-when secondary">${b.start ? fmtDate(b.start) : kind}</span>
        <span class="patch-banner-pulls num${s?.paidPulls ? '' : ' tertiary'}">${s?.paidPulls ? `${fmtInt(s.paidPulls)} pulls` : 'No pulls'}</span>
        <span class="patch-banner-six num${six ? '' : ' tertiary'}">${six ? `${six} × 6★` : ''}</span>`;
      return s?.paidPulls && b.poolId
        ? html`<a class="patch-banner ${b.kind}" href="/${b.kind === 'weap' ? 'arsenal' : 'operators'}/${b.poolId}" title="${kind}">${inner}</a>`
        : html`<div class="patch-banner ${b.kind} unpulled" title="${kind}">${inner}</div>`;
    })}
  </div></td></tr>`;
}

export function statsPage(a: Analysis, redraw: () => void): Html {
  const events = wikiFile<EventRewardsFile>('events.json', redraw);
  const income = wikiFile<IncomeFile>('income.json', redraw);
  const free = new Map(patchIncome(state.schedule, currentServer(), Date.now(), events.data, income.data).map((p) => [p.key, p]));
  /** Arsenal Tickets a patch's Headhunting results gave back. */
  const ticketsOf = (p: PatchStats) => ticketsFromPulls(p.banners.flatMap((b) => (b.kind === 'char' ? (b.summary?.pulls ?? []) : [])));
  const freeOf = (p: PatchStats) => {
    const inc = free.get(p.patch.key);
    return inc?.lines.length ? { char: inc.headhunting, weap: inc.arsenal + (ticketsOf(p) / TICKETS_PER_ISSUE) * 10 } : null;
  };
  const patches = patchStats(a, state.db, state.schedule)
    .filter((p) => p.charPulls + p.weapPulls > 0 || freeOf(p))
    .sort((x, y) => (x.patch.major === -1 ? 1 : y.patch.major === -1 ? -1 : y.patch.major - x.patch.major || y.patch.minor - x.patch.minor));
  const maxPulls = Math.max(1, ...patches.map((p) => Math.max(p.charPulls, p.weapPulls, freeOf(p)?.char ?? 0, freeOf(p)?.weap ?? 0)));
  const weeks = weeklyTimeline(a);
  const activeWeeks = weeks.filter((w) => w.char + w.weap > 0).length;
  const bar = (n: number, earned: number | undefined, color: string) =>
    html`<div class="bar-cell"><span class="num" style="min-width:36px;text-align:right">${fmtInt(n)}</span><div class="bar"><i style="width:${(n / maxPulls) * 100}%;background:${color}"></i>${earned ? html`<b class="bar-mark" style="left:${(earned / maxPulls) * 100}%"></b>` : ''}</div>${earned != null ? html`<span class="bar-free num secondary" title="Free pulls this patch handed out">${fmtInt(Math.round(earned))} free</span>` : ''}</div>`;
  const anyFree = patches.some(freeOf);

  return html`
    ${pageHeader('Stats', `${fmtDate(a.firstTs)} – ${fmtDate(a.lastTs)}`)}
    <main class="container fade-in">
      ${metrics([
        metric({ label: 'Operator pulls', value: fmtInt(a.char.pulls), sub: `${a.char.sixStars} × 6★` }),
        metric({ label: 'Arsenal pulls', value: fmtInt(a.weap.pulls), sub: `${a.weap.sixStars} × 6★` }),
        metric({ label: 'Active weeks', value: activeWeeks, sub: `of ${weeks.length} since your first pull` }),
        metric({ label: 'Pulls per active week', value: activeWeeks ? Math.round((a.char.pulls + a.weap.pulls) / activeWeeks) : '–' }),
      ], 'plain')}

      <div class="section card">
        <div class="card-head">
          <h2 class="heading-16">Pulls per week</h2>
          <div class="legend">
            <span><i style="background:var(--op)"></i>Operators</span>
            <span><i style="background:var(--ars)"></i>Arsenal</span>
            <span><i class="round" style="background:var(--r6)"></i>Week with a 6★</span>
          </div>
        </div>
        <div class="card-body">${weeklyChart(weeks)}</div>
      </div>

      <div class="section card">
        <div class="card-head">
          <h2 class="heading-16">By patch</h2>
          ${anyFree ? html`<div class="legend"><span><i class="mark"></i>Free pulls the patch handed out (open a patch for the sources)</span></div>` : ''}
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Patch</th><th>Operator pulls</th><th>Arsenal pulls</th><th class="right">6★</th><th class="right hide-sm" title="Operator 6★ only: Arsenal pity counts sets of 10, so the two can't be averaged together">Avg. operator pity</th><th class="right hide-sm">Banners pulled</th></tr></thead>
          <tbody>
            ${patches.map((p) => {
              // Operators only: Arsenal pity is counted in sets of 10, a different unit.
              const six = p.sixStars.filter((s) => s.pity !== null && s.kind === 'char');
              const avg = six.length ? (six.reduce((n, s) => n + s.pity!, 0) / six.length).toFixed(1) : '–';
              const pulled = p.banners.filter((b) => (b.summary?.paidPulls ?? 0) > 0).length;
              const open = openPatches.has(p.patch.key);
              const earned = freeOf(p);
              return html`<tr class="patch-row${open ? ' open' : ''}">
                <td class="label-14"><button type="button" class="patch-toggle" data-action="patch-toggle" data-value="${p.patch.key}" aria-expanded="${String(open)}">${icon('chevron_right')}${p.patch.major === -1 ? 'Permanent' : `Patch ${p.patch.key}`}</button></td>
                <td>${bar(p.charPulls, earned?.char, 'var(--op)')}</td>
                <td>${bar(p.weapPulls, earned?.weap, 'var(--ars)')}</td>
                <td class="right num">${p.sixStars.length}</td>
                <td class="right num secondary hide-sm">${avg}</td>
                <td class="right num secondary hide-sm">${pulled} / ${p.banners.length}</td>
              </tr>${open ? patchBanners(p, free.get(p.patch.key), ticketsOf(p)) : ''}`;
            })}
          </tbody>
        </table></div>
      </div>
      ${anyFree && income.data ? credit(income.data.attribution) : ''}
    </main>`;
}
