import type { Analysis } from '../../domain/analyze';
import { patchStats, weeklyTimeline } from '../../domain/patches';
import { state } from '../../state';
import { weeklyChart } from '../charts';
import { metric, metrics, pageHeader } from '../components';
import { fmtDate, fmtInt, html, type Html } from '../html';

/** Stats: totals, pulls per week, and a per-patch breakdown table. */

export function statsPage(a: Analysis): Html {
  const patches = patchStats(a, state.db)
    .filter((p) => p.charPulls + p.weapPulls > 0)
    .sort((x, y) => (x.patch.major === -1 ? 1 : y.patch.major === -1 ? -1 : y.patch.major - x.patch.major || y.patch.minor - x.patch.minor));
  const maxPulls = Math.max(1, ...patches.map((p) => Math.max(p.charPulls, p.weapPulls)));
  const weeks = weeklyTimeline(a);
  const activeWeeks = weeks.filter((w) => w.char + w.weap > 0).length;
  const bar = (n: number, color: string) =>
    html`<div class="bar-cell"><span class="num" style="min-width:36px;text-align:right">${fmtInt(n)}</span><div class="bar"><i style="width:${(n / maxPulls) * 100}%;background:${color}"></i></div></div>`;

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
        <div class="card-head"><h2 class="heading-16">By patch</h2></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Patch</th><th>Operator pulls</th><th>Arsenal pulls</th><th class="right">6★</th><th class="right hide-sm" title="Operator 6★ only: Arsenal pity counts sets of 10, so the two can't be averaged together">Avg. operator pity</th><th class="right hide-sm">Banners pulled</th></tr></thead>
          <tbody>
            ${patches.map((p) => {
              // Operators only: Arsenal pity is counted in sets of 10, a different unit.
              const six = p.sixStars.filter((s) => s.pity !== null && s.kind === 'char');
              const avg = six.length ? (six.reduce((n, s) => n + s.pity!, 0) / six.length).toFixed(1) : '–';
              const pulled = p.banners.filter((b) => (b.summary?.paidPulls ?? 0) > 0).length;
              return html`<tr>
                <td class="label-14">${p.patch.major === -1 ? 'Permanent' : `Patch ${p.patch.key}`}</td>
                <td>${bar(p.charPulls, 'var(--op)')}</td>
                <td>${bar(p.weapPulls, 'var(--ars)')}</td>
                <td class="right num">${p.sixStars.length}</td>
                <td class="right num secondary hide-sm">${avg}</td>
                <td class="right num secondary hide-sm">${pulled} / ${p.banners.length}</td>
              </tr>`;
            })}
          </tbody>
        </table></div>
      </div>
    </main>`;
}
