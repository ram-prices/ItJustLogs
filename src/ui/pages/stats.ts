import type { Analysis } from '../../domain/analyze';
import { fmtPulls, type EventRewardsFile } from '../../domain/eventRewards';
import {
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
import { TAB_ICON, badge, icon, metric, metrics, pageHeader } from '../components';
import { fmtDate, fmtInt, html, type Html } from '../html';
import { credit, external, wikiFile } from './info';

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

/** What a set of totals comes to, written out: "1,600 Oroberyl, 5 Basic HH Permits" (Oroberyl and Origeometry have no plural). */
function itemsText(totals: Record<string, number>): string {
  return Object.entries(totals)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${fmtInt(n)} ${n !== 1 && /(Permit|Ticket)$/.test(k) ? `${k}s` : k}`)
    .join(', ');
}

const plural = (n: number, one: string) => `${fmtInt(n)} ${one}${n === 1 ? '' : 's'}`;

/** One source of free pulls in an opened patch. */
function incomeRow(label: Html | string, detail: Html | string, headhunting: number, arsenal: number, partial = false, paid = false, estimate = false): Html {
  const n = (x: number) => (x ? fmtPulls(Math.round(x * 10) / 10) : '–');
  return html`<div class="patch-income-row">
    <div class="min0"><div class="patch-income-label">${label}${partial ? html` ${badge('Partial', 'amber')}` : ''}${paid ? html` ${badge('Paid', 'outline')}` : ''}${estimate ? html` ${badge('Estimate', 'outline')}` : ''}</div><div class="patch-income-detail secondary">${detail}</div></div>
    <span class="num${headhunting ? '' : ' tertiary'}">${n(headhunting)}</span>
    <span class="num${arsenal ? '' : ' tertiary'}">${n(arsenal)}</span>
  </div>`;
}

/** The income file, for the rows' prices; set while the page draws. */
let income: IncomeFile | null = null;

function incomeLine(l: IncomeLine): Html {
  const { headhunting, arsenal } = pullsFrom(l.totals);
  switch (l.source) {
    case 'events':
      return incomeRow(
        plural(l.count, 'event'),
        html`${l.events!.map((e, i) => html`${i ? ' · ' : ''}${e.id != null ? html`<a href="/event/${e.id}" data-link="/event/${e.id}">${e.name}</a>` : external(e.url!, e.name)}${e.partial ? '*' : ''}${e.estimated ? '≈' : ''}`)}${l.events!.some((e) => e.estimated) ? html`. ≈ No amounts on the wiki: what events of its kind give.` : ''}`,
        headhunting,
        arsenal,
        l.partial,
        false,
        l.estimate,
      );
    case 'daily':
      return incomeRow(html`${external(l.url!, 'Daily missions')}`, `${plural(l.count, 'day')} × ${itemsText(pullsDiv(l.totals, l.count))}`, headhunting, arsenal);
    case 'weekly':
      return incomeRow(html`${external(l.url!, 'Weekly Routine')}`, `${plural(l.count, 'week')} × ${itemsText(pullsDiv(l.totals, l.count))}`, headhunting, arsenal);
    case 'pass': {
      const c = l.crates;
      const own = c ? Object.fromEntries(Object.entries(l.totals).map(([k, n]) => [k, k === 'Oroberyl' ? n - c.oroberyl : n])) : l.totals;
      return incomeRow(
        html`${external(l.url!, `Protocol Pass: ${l.name}`)}`,
        `Free track: ${itemsText(own)}${c ? `, and ${c.count} ${c.item} boxes, about ${fmtInt(Math.round(c.oroberyl))} Oroberyl on average` : ''}`,
        headhunting,
        arsenal,
        false,
        false,
        l.estimate,
      );
    }
    case 'creditStore':
      return incomeRow(
        html`${external(l.extra!.sources[0], 'Credit Store')}`,
        `${plural(l.count, 'day')} × ${fmtPulls(l.totals.Oroberyl / l.count)} Oroberyl. ${l.extra!.note}`,
        headhunting,
        arsenal,
        false,
        false,
        true,
      );
    case 'crafting':
      return incomeRow(
        html`${external(l.url!, 'Crafting Manual')}`,
        `${itemsText(l.totals)} for gathering ${plural(l.count, 'new item')}`,
        headhunting,
        arsenal,
      );
    case 'progression':
      return incomeRow(
        'One-time progression',
        html`${l.items!.map((x, i) => html`${i ? ' · ' : ''}${external(x.url, x.name)} ${itemsText(x.rewards)}`)}`,
        headhunting,
        arsenal,
      );
    case 'quests': {
      const kinds = new Map<string, number>();
      for (const q of l.quests!) kinds.set(q.type, (kinds.get(q.type) ?? 0) + 1);
      const order = ['Main Mission', 'Side Mission', 'Exploration Mission'];
      const kindText = [...kinds]
        .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
        .map(([k, n]) => `${n} ${k.replace(' Mission', '').toLowerCase()}`)
        .join(', ');
      return incomeRow(
        `${plural(l.count, 'permanent mission')} released`,
        `${kindText}: ${itemsText(l.totals)}`,
        headhunting,
        arsenal,
      );
    }
    case 'modes':
      return incomeRow(
        'Permanent modes',
        html`${l.modes!.map((m, i) => html`${i ? ' · ' : ''}${external(m.url, m.name)} ${m.partial ? 'amount not listed' : itemsText(m.rewards)}${m.estimate ? ' (a share: the wiki doesn\'t say which milestones each version added)' : ''}${m.estimated ? ' (≈ no amounts listed: what it gives in other versions)' : ''}`)}`,
        headhunting,
        arsenal,
        l.partial,
        false,
        l.estimate,
      );
    case 'outposts':
      return incomeRow(
        `${plural(l.count, 'new outpost')}`,
        html`${l.outposts!.map((o, i) => html`${i ? ' · ' : ''}${external(o.url, o.outpost)} ${itemsText(o.rewards)}`)}, for raising its level`,
        headhunting,
        arsenal,
      );
    case 'aurylene':
      return incomeRow(
        html`${external(l.url!, 'Aurylene')}`,
        `${itemsText(l.totals) || 'Nothing listed'} for handing in the new areas' Aurylene at TP Points (the region's reward table).${l.note ? ` ${l.note}: the rest isn't counted until the wiki lists those phases.` : ''}`,
        headhunting,
        arsenal,
        l.partial,
      );
    case 'livestream':
    case 'survey':
    case 'checkIn':
    case 'combatDrills': {
      const x = l.extra!;
      const what =
        l.source === 'checkIn' ? `${plural(l.count, 'day')}: ${x.note}` : l.source === 'combatDrills' ? `${plural(l.count, 'new Chartered banner')}. ${x.note}` : x.note;
      return incomeRow(
        x.label,
        html`${itemsText(Object.fromEntries(Object.entries(l.totals).map(([k, n]) => [k, Math.round(n)])))}. ${what} From community guides: ${x.sources.map((u, i) => html`${i ? ', ' : ''}${external(u, new URL(u).hostname.replace(/^www\./, ''))}`)}.${l.estimate ? ' Not confirmed for this version.' : ''}`,
        headhunting,
        arsenal,
        false,
        false,
        l.estimate,
      );
    }
    case 'crates': {
      const per = income?.exploration?.perCrate ?? 0;
      return incomeRow(
        `${plural(l.count, 'storage crate')} in new areas`,
        html`${l.areas!.map((a, i) => html`${i ? ' · ' : ''}${external(a.url, a.area)} ${fmtInt(a.crates)}`)}, at about ${fmtPulls(per)} Oroberyl a crate (Oroberyl by crate type, averaged over Wuling's mix of types)`,
        headhunting,
        arsenal,
        false,
        false,
        true,
      );
    }
    case 'compensation':
      return incomeRow(
        html`${external(l.url!, 'Maintenance compensation')}`,
        l.rows!.map((r) => `${r.label}: ${itemsText(r.rewards)}`).join(' · '),
        headhunting,
        arsenal,
      );
    case 'originium': {
      // Totals are net of the unlock cost: show what the tier gives and what it costs.
      const cost = income?.passTiers?.originium.cost ?? {};
      const gross = Object.fromEntries(Object.entries(l.totals).map(([k, n]) => [k, n + (cost[k] ?? 0)]));
      return incomeRow(html`${external(l.url!, 'Originium Supply')}`, `${itemsText(gross)}, less the ${itemsText(cost)} it costs`, headhunting, arsenal, false, true);
    }
    case 'customized':
      return incomeRow(
        html`${external(l.url!, 'Protocol Customized')}`,
        `${income?.passTiers?.customized.price ?? 'Bought'}: ${itemsText(l.totals)}, with what it hands out on purchase`,
        headhunting,
        arsenal,
        false,
        true,
      );
    case 'monthly': {
      const m = income?.monthly;
      return incomeRow(
        html`${external(l.url!, 'Monthly Pass')}`,
        m ? `${plural(l.count, 'day')} × ${itemsText(m.daily)}, and ${itemsText(m.onPurchase)} per ${m.days} days (${m.price ?? ''} each)` : itemsText(l.totals),
        headhunting,
        arsenal,
        false,
        true,
      );
    }
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
      <span>${inc.lines.some((l) => l.paid) ? 'Pulls earned' : 'Free pulls'}${inc.projected ? `, projected to ${fmtDate(inc.end)}` : inc.ongoing ? ' so far' : ''}</span><span>Headhunting</span><span>Arsenal</span>
    </div>
    ${inc.lines.map(incomeLine)}
    ${tickets ? incomeRow('Your Headhunting pulls', `${fmtInt(tickets)} Arsenal Tickets back (20, 200 or 2,000 for each 4★, 5★ or 6★)`, 0, back) : ''}
    <div class="patch-income-row patch-income-total">
      <span>In all${inc.basic ? html` <span class="secondary">· plus ${plural(inc.basic, 'Basic HH Permit')} (Basic Headhunting only)</span>` : ''}</span><span class="num">${fmtPulls(Math.round(inc.headhunting * 10) / 10)}</span><span class="num">${fmtPulls(Math.round((inc.arsenal + back) * 10) / 10)}</span>
    </div>
    <p class="patch-income-note copy-13 secondary">If you did every daily and weekly${inc.lines.some((l) => l.source === 'monthly') ? ' and kept the Monthly Pass up all patch' : ''}.${inc.projected ? ` This patch is counted to its end (${fmtDate(inc.end)}, when its last banner or event closes), with every event it lists.` : ''}
      Headhunting means limited banners: Oroberyl at 500 a pull, Origeometry at 75 Oroberyl, each limited HH Permit one pull. Arsenal Tickets at 1,980 for an Issue of 10.
      Not counted: Regional Development, Intel Gathering, achievements and launch-only mail (no source lists their amounts)${inc.lines.some((l) => l.paid) ? ', and anything else bought' : ', and anything bought'}.${inc.partial ? ' * The wiki lists some of that event\'s rewards without amounts, so the totals are what\'s known so far.' : ''}</p>
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
  const incomeFile = wikiFile<IncomeFile>('income.json', redraw);
  income = incomeFile.data;
  const paid = state.settings.paidIncome ?? [];
  const free = new Map(patchIncome(state.schedule, currentServer(), Date.now(), events.data, income, paid).map((p) => [p.key, p]));
  /** Arsenal Tickets a patch's Headhunting results gave back. */
  const ticketsOf = (p: PatchStats) => ticketsFromPulls(p.banners.flatMap((b) => (b.kind === 'char' ? (b.summary?.pulls ?? []) : [])));
  const freeOf = (p: PatchStats) => {
    const inc = free.get(p.patch.key);
    return inc?.lines.length ? { char: inc.headhunting, weap: inc.arsenal + (ticketsOf(p) / TICKETS_PER_ISSUE) * 10, projected: inc.projected } : null;
  };
  const patches = patchStats(a, state.db, state.schedule)
    .filter((p) => p.charPulls + p.weapPulls > 0 || freeOf(p))
    .sort((x, y) => (x.patch.major === -1 ? 1 : y.patch.major === -1 ? -1 : y.patch.major - x.patch.major || y.patch.minor - x.patch.minor));
  const maxPulls = Math.max(1, ...patches.map((p) => Math.max(p.charPulls, p.weapPulls, freeOf(p)?.char ?? 0, freeOf(p)?.weap ?? 0)));
  const weeks = weeklyTimeline(a);
  const activeWeeks = weeks.filter((w) => w.char + w.weap > 0).length;
  const bar = (n: number, earned: number | undefined, color: string, projected = false) =>
    html`<div class="bar-cell"><span class="num" style="min-width:36px;text-align:right">${fmtInt(n)}</span><div class="bar"><i style="width:${(n / maxPulls) * 100}%;background:${color}"></i>${earned ? html`<b class="bar-mark" style="left:${(earned / maxPulls) * 100}%"></b>` : ''}</div>${earned != null ? html`<span class="bar-free num secondary" title="${paid.length ? 'Pulls this patch hands out, with the paid options on' : 'Free pulls this patch hands out'}${projected ? ', projected to its end' : ''}">${projected ? '≈' : ''}${fmtInt(Math.round(earned))} ${paid.length ? 'earned' : 'free'}</span>` : ''}</div>`;
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
          ${anyFree ? html`<div class="legend"><span><i class="mark"></i>${paid.length ? 'Pulls' : 'Free pulls'} the patch handed out (open a patch for the sources)</span></div>` : ''}
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
                <td>${bar(p.charPulls, earned?.char, 'var(--op)', earned?.projected)}</td>
                <td>${bar(p.weapPulls, earned?.weap, 'var(--ars)', earned?.projected)}</td>
                <td class="right num">${p.sixStars.length}</td>
                <td class="right num secondary hide-sm">${avg}</td>
                <td class="right num secondary hide-sm">${pulled} / ${p.banners.length}</td>
              </tr>${open ? patchBanners(p, free.get(p.patch.key), ticketsOf(p)) : ''}`;
            })}
          </tbody>
        </table></div>
      </div>
      ${anyFree && income ? credit(income.attribution) : ''}
    </main>`;
}
