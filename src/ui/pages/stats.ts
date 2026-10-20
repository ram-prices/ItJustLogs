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

/** "1,600 Oroberyl (3.2 pulls)": what something gave, and the limited pulls it comes to. */
function gave(totals: Record<string, number>): string {
  const what = itemsText(Object.fromEntries(Object.entries(totals).map(([k, n]) => [k, Math.round(n)])));
  const p = pullsFrom(totals).headhunting;
  return what ? `${what}${p ? ` (${fmtPulls(Math.round(p * 10) / 10)} ${p === 1 ? 'pull' : 'pulls'})` : ''}` : 'no amounts listed';
}

const bullets = (items: (Html | string | false | null | undefined)[]): Html =>
  html`<ul class="patch-income-bullets">${items.filter(Boolean).map((x) => html`<li>${x}</li>`)}</ul>`;

/** "From community guides: gamsgo.com, game8.co". */
const guides = (sources: string[]): Html =>
  html`from ${sources.map((u, i) => html`${i ? ', ' : ''}${external(u, new URL(u).hostname.replace(/^www\./, ''))}`)}`;

/**
 * An opened patch's free pulls in eight sections, in this order: Daily
 * Missions, Weekly Missions, Protocol Pass, Monthly Pass (when turned on),
 * Permanent Modes, Events, Exploration, Mailbox; then the Arsenal Tickets
 * Headhunting gave back, and the total.
 */
function patchIncomeList(inc: PatchIncome, tickets: number): Html {
  const back = (tickets / TICKETS_PER_ISSUE) * 10;
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

  // 1, 2. Daily and weekly missions.
  const [daily] = of('daily');
  const [weekly] = of('weekly');
  // 3. The Protocol Pass: the free track, then the paid tiers turned on.
  const [pass] = of('pass');
  const tier = (source: IncomeLine['source']) => inc.lines.find((t) => t.source === source && t.name === pass?.name);
  const originium = pass && tier('originium');
  const customized = pass && tier('customized');
  const cost = income?.passTiers?.originium.cost ?? {};
  const crates = pass?.crates;
  const freeTrack = pass && crates ? Object.fromEntries(Object.entries(pass.totals).map(([k, n]) => [k, k === 'Oroberyl' ? n - crates.oroberyl : n])) : pass?.totals;
  // 4. The Monthly Pass.
  const [monthly] = of('monthly');
  const m = income?.monthly;
  // 5. Permanent modes.
  const [modes] = of('modes');
  // 6. Events, each on its own line, and Combat Drills.
  const [events] = of('events');
  const [drills] = of('combatDrills');
  // 7. Exploration.
  const [craft] = of('crafting');
  const [aur] = of('aurylene');
  const [crateLine] = of('crates');
  const [quests] = of('quests');
  const [outposts] = of('outposts');
  const [prog] = of('progression');
  const questKinds = () => {
    const kinds = new Map<string, number>();
    for (const q of quests!.quests!) kinds.set(q.type, (kinds.get(q.type) ?? 0) + 1);
    const order = ['Main Mission', 'Side Mission', 'Exploration Mission'];
    return [...kinds]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([k, n]) => `${n} ${k.replace(' Mission', '').toLowerCase()}`)
      .join(', ');
  };
  // 8. Mailbox.
  const [comp] = of('compensation');
  const [survey] = of('survey');
  const [live] = of('livestream');

  return html`<div class="patch-income">
    <div class="patch-income-row patch-income-head label-12">
      <span>${inc.lines.some((l) => l.paid) ? 'Pulls earned' : 'Free pulls'}${inc.projected ? `, projected to ${fmtDate(inc.end)}` : inc.ongoing ? ' so far' : ''}</span><span>Headhunting</span><span>Arsenal</span>
    </div>
    ${daily ? section(html`${external(daily.url!, 'Daily Missions')}`, [daily], `${plural(daily.count, 'day')} × ${itemsText(perOne(daily.totals, daily.count))}`) : ''}
    ${weekly ? section(html`${external(weekly.url!, 'Weekly Missions')}`, [weekly], `${plural(weekly.count, 'week')} × ${itemsText(perOne(weekly.totals, weekly.count))} (the Weekly Routine)`) : ''}
    ${pass
      ? section(
          html`${external(pass.url!, `Protocol Pass: ${pass.name}`)}`,
          [pass, originium, customized].filter((l): l is IncomeLine => !!l),
          bullets([
            html`Free track: ${itemsText(freeTrack!)}${crates ? `, and ${crates.count} ${crates.item} boxes, about ${fmtInt(Math.round(crates.oroberyl))} Oroberyl on average` : ''}`,
            originium && html`Originium Supply: ${itemsText(Object.fromEntries(Object.entries(originium.totals).map(([k, n]) => [k, n + (cost[k] ?? 0)])))}, less the ${itemsText(cost)} it costs`,
            customized && html`Protocol Customized (${income?.passTiers?.customized.price ?? 'bought'}): ${itemsText(customized.totals)}, with what it hands out on purchase`,
          ]),
        )
      : ''}
    ${monthly
      ? section(
          html`${external(monthly.url!, 'Monthly Pass')}`,
          [monthly],
          m ? `${plural(monthly.count, 'day')} × ${itemsText(m.daily)}, and ${itemsText(m.onPurchase)} per ${m.days} days (${m.price ?? ''} each)` : itemsText(monthly.totals),
        )
      : ''}
    ${modes
      ? section(
          'Permanent Modes',
          [modes],
          bullets(
            modes.modes!.map(
              (x) =>
                html`${external(x.url, x.name)}: ${x.partial ? 'amount not listed' : gave(x.rewards)}${x.estimate ? ' (a share: the wiki doesn\'t say which milestones each version added)' : ''}${x.estimated ? ' ≈ (no amounts listed: what it gives in other versions)' : ''}`,
            ),
          ),
        )
      : ''}
    ${events || drills
      ? section(
          `Events${events ? ` (${events.count})` : ''}`,
          [events, drills].filter((l): l is IncomeLine => !!l),
          html`${bullets([
            ...(events?.events ?? []).map(
              (e) =>
                html`${e.id != null ? html`<a href="/event/${e.id}" data-link="/event/${e.id}">${e.name}</a>` : external(e.url!, e.name)}: ${gave(e.totals)}${e.partial ? ' *' : ''}${e.estimated ? ' ≈' : ''}`,
            ),
            drills && html`Combat Drills (${plural(drills.count, 'new Chartered banner')}): ${gave(drills.totals)}, ${guides(drills.extra!.sources)}`,
          ])}${events?.events?.some((e) => e.estimated) ? html`≈ No amounts on the wiki: what events of its kind give. ` : ''}${events?.partial ? html`* The wiki lists some of its rewards without amounts.` : ''}`,
        )
      : ''}
    ${section(
      'Exploration',
      [crateLine, aur, craft, quests, outposts, prog].filter((l): l is IncomeLine => !!l),
      bullets([
        crateLine &&
          html`Storage crates: ${crateLine.areas!.map((a, i) => html`${i ? ', ' : ''}${external(a.url, a.area)} ${fmtInt(a.crates)}`)}, at about ${fmtPulls(income?.exploration?.perCrate ?? 0)} Oroberyl a crate: ${gave(crateLine.totals)} (an estimate: Oroberyl by crate type, averaged over Wuling's mix of types)`,
        aur &&
          html`${external(aur.url!, 'Aurylene')} handed in at TP Points: ${itemsText(aur.totals) ? gave(aur.totals) : 'nothing listed'}${aur.note ? ` (${aur.note}: the rest isn't counted until the wiki lists those phases)` : ''}`,
        'Regional Development: not counted (no source lists its rewards)',
        craft && html`${external(craft.url!, 'Crafting Manual')}: ${gave(craft.totals)} for gathering ${plural(craft.count, 'new item')}`,
        quests && html`Missions released: ${questKinds()}: ${gave(quests.totals)}`,
        outposts && html`Outposts: ${outposts.outposts!.map((o, i) => html`${i ? ', ' : ''}${external(o.url, o.outpost)} ${gave(o.rewards)}`)}, for raising their level`,
        prog && html`${prog.items!.map((x, i) => html`${i ? ' · ' : ''}${external(x.url, x.name)}: ${gave(x.rewards)}`)}`,
      ]),
    )}
    ${section(
      'Mailbox',
      [comp, survey, live].filter((l): l is IncomeLine => !!l),
      bullets([
        ...(comp?.rows ?? []).map((r) => html`${external(comp!.url!, r.label)}: ${gave(r.rewards)}`),
        survey && html`${survey.extra!.label}: ${gave(survey.totals)}, ${guides(survey.extra!.sources)}`,
        live &&
          html`${live.extra!.label}: ${gave(live.totals)}, ${guides(live.extra!.sources)}${live.estimate ? ' (not confirmed for this version)' : ''}`,
      ]),
    )}
    ${tickets ? incomeRow('Your Headhunting pulls', `${fmtInt(tickets)} Arsenal Tickets back (20, 200 or 2,000 for each 4★, 5★ or 6★)`, 0, back) : ''}
    <div class="patch-income-row patch-income-total">
      <span>In all${inc.basic ? html` <span class="secondary">· plus ${plural(inc.basic, 'Basic HH Permit')} (Basic Headhunting only)</span>` : ''}</span><span class="num">${fmtPulls(Math.round(inc.headhunting * 10) / 10)}</span><span class="num">${fmtPulls(Math.round((inc.arsenal + back) * 10) / 10)}</span>
    </div>
    <p class="patch-income-note copy-13 secondary">If you did every daily and weekly${monthly ? ' and kept the Monthly Pass up all patch' : ''}.${inc.projected ? ` This patch is counted to its end (${fmtDate(inc.end)}, when its last banner or event closes), with every event it lists.` : ''}
      Headhunting means limited banners: Oroberyl at 500 a pull, Origeometry at 75 Oroberyl, each limited HH Permit one pull. Arsenal Tickets at 1,980 for an Issue of 10.
      Not counted: Regional Development, Intel Gathering, the Credit Store, achievements and launch-only mail (no source lists their amounts)${inc.lines.some((l) => l.paid) ? ', and anything else bought' : ', and anything bought'}.</p>
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
  // Pulls earned per week: each patch's limited Headhunting pulls, for the part of it since the
  // player's first pull and up to now (the current patch's projection prorated by time), over those weeks.
  const now = Date.now();
  const from = a.firstTs;
  let earned = 0;
  for (const inc of free.values()) {
    const span = inc.end - inc.start;
    const overlap = Math.min(inc.end, now) - Math.max(inc.start, from);
    if (span > 0 && overlap > 0) earned += inc.headhunting * (overlap / span);
  }
  const weeksSince = (now - from) / (7 * 86_400_000);
  const earnedPerWeek = free.size && weeksSince > 0 ? Math.round((earned / weeksSince) * 10) / 10 : null;
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
    const tip = `${fmtInt(n)} made · ${projected ? '≈' : ''}${fmtInt(e)} ${paid.length ? 'earned' : 'free'}${projected ? ' (projected to the patch end)' : ''}: ${
      diff > 0 ? `${fmtInt(diff)} more than earned (savings or bought)` : diff < 0 ? `${fmtInt(-diff)} spare` : 'all of it'
    }`;
    return html`<div class="bar-pair" title="${tip}">
      <span class="num">${fmtInt(n)}</span><div class="bar"><i style="width:${pct(n)};background:${color}"></i></div>
      <span class="num secondary">${projected ? '≈' : ''}${fmtInt(e)}</span><div class="bar earned"><i style="width:${pct(earned)};background:${color}"></i></div>
    </div>`;
  };
  const anyFree = patches.some(freeOf);

  return html`
    ${pageHeader('Stats', `${fmtDate(a.firstTs)} – ${fmtDate(a.lastTs)}`)}
    <main class="container fade-in">
      ${metrics([
        metric({ label: 'Operator pulls', value: fmtInt(a.char.pulls), sub: `${a.char.sixStars} × 6★` }),
        metric({ label: 'Arsenal pulls', value: fmtInt(a.weap.pulls), sub: `${a.weap.sixStars} × 6★` }),
        metric({ label: 'Active weeks', value: activeWeeks, sub: `of ${weeks.length} since your first pull` }),
        metric({
          label: 'Pulls earned per week',
          value: earnedPerWeek ?? '–',
          sub: earnedPerWeek == null ? 'loading…' : `${paid.length ? 'with your paid options, ' : ''}for Chartered banners (no Basic HH Permits), since your first pull`,
        }),
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
          ${anyFree
            ? html`<div class="legend">
                <span><i style="background:var(--gray-1000)"></i>Pulls made</span>
                <span><i class="faded" style="background:var(--gray-1000)"></i>${paid.length ? 'Pulls earned' : 'Free pulls earned'} (open a patch for the sources)</span>
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
