import type { Analysis } from '../domain/analyze';
import { bannerArtUrl } from '../domain/banners';
import { patchStats, weeklyTimeline, type PatchStats } from '../domain/patches';
import { state } from '../state';
import { weeklyChart } from './charts';
import { itemIcon, outcomeMark } from './common';
import { fmtDate, fmtInt, fmtPct, html, type Html } from './html';

export function statsView(analysis: Analysis): Html {
  const weeks = weeklyTimeline(analysis);
  const patches = patchStats(analysis, state.db).filter((p) => p.charPulls + p.weapPulls > 0 || p.banners.length);
  const pulled = patches.filter((p) => p.charPulls + p.weapPulls > 0);
  const busiest = [...weeks].sort((a, b) => b.char + b.weap - (a.char + a.weap))[0];
  const activeWeeks = weeks.filter((w) => w.char + w.weap > 0).length;
  const total = analysis.char.pulls + analysis.weap.pulls;

  return html`
    <div class="page-head">
      <div>
        <h1>Stats</h1>
        <p>${fmtDate(analysis.firstTs)} – ${fmtDate(analysis.lastTs)} · ${pulled.length} patches with pulls</p>
      </div>
    </div>
    <div class="tiles">
      <div class="card tile">
        <div class="tile-label">Operator pulls</div>
        <div class="tile-value num">${fmtInt(analysis.char.pulls)}</div>
        <div class="tile-sub">${analysis.char.sixStars} × 6★</div>
      </div>
      <div class="card tile">
        <div class="tile-label">Arsenal pulls</div>
        <div class="tile-value num">${fmtInt(analysis.weap.pulls)}</div>
        <div class="tile-sub">${analysis.weap.sixStars} × 6★</div>
      </div>
      <div class="card tile">
        <div class="tile-label">Busiest week</div>
        <div class="tile-value num">${busiest ? fmtInt(busiest.char + busiest.weap) : '–'}</div>
        <div class="tile-sub">${busiest ? `Week of ${fmtDate(busiest.start)}` : ''}</div>
      </div>
      <div class="card tile">
        <div class="tile-label">Average per active week</div>
        <div class="tile-value num">${activeWeeks ? Math.round(total / activeWeeks) : '–'}</div>
        <div class="tile-sub">${activeWeeks} of ${weeks.length} weeks had pulls</div>
      </div>
    </div>

    <h2 class="section-title">Pulls over time <small>per week · hover a column for details</small></h2>
    <div class="card card-pad">
      <div class="legend" style="margin-bottom:12px">
        <span><i style="background:var(--op)"></i>Operators</span>
        <span><i style="background:var(--ars)"></i>Arsenal</span>
        <span><i style="background:var(--r6);border-radius:50%"></i>Week with a 6★</span>
      </div>
      ${weeklyChart(weeks)}
    </div>

    <h2 class="section-title">By patch <small>open a patch to see every banner, including ones you skipped</small></h2>
    <div class="card">${patchTable(patches)}</div>
  `;
}

function patchTable(patches: PatchStats[]): Html {
  const maxChar = Math.max(1, ...patches.map((p) => p.charPulls));
  const maxWeap = Math.max(1, ...patches.map((p) => p.weapPulls));
  const max = Math.max(maxChar, maxWeap);
  // Newest patch first; permanent banners stay at the bottom.
  const ordered = [...patches.filter((p) => p.patch.major !== -1).reverse(), ...patches.filter((p) => p.patch.major === -1)];
  return html`${ordered.map((p) => {
    const title = p.patch.major === -1 ? 'Permanent banners' : `Patch ${p.patch.key}`;
    const six = p.sixStars.filter((s) => s.pity !== null);
    const avg = six.length ? (six.reduce((n, s) => n + s.pity!, 0) / six.length).toFixed(1) : '–';
    const pulledBanners = p.banners.filter((b) => b.summary?.paidPulls);
    return html`<details class="patch">
      <summary>
        <b style="min-width:150px">${title}</b>
        <span class="bars" style="flex:1;min-width:160px;display:grid;gap:4px">
          <span class="hbar" style="width:${(p.charPulls / max) * 100}%;background:var(--op)" title="${p.charPulls} operator pulls"></span>
          <span class="hbar" style="width:${(p.weapPulls / max) * 100}%;background:var(--ars)" title="${p.weapPulls} arsenal pulls"></span>
        </span>
        <span class="num dim" style="min-width:210px;font-size:13px">
          ${fmtInt(p.charPulls)} operator · ${fmtInt(p.weapPulls)} arsenal
        </span>
        <span class="num dim" style="font-size:13px">${p.sixStars.length} × 6★ · avg pity ${avg}</span>
      </summary>
      <div class="patch-body">
        <p class="muted" style="font-size:13px">
          ${pulledBanners.length} of ${p.banners.length} banners pulled on
        </p>
        <div class="patch-banners">
          ${[...p.banners]
            .sort((a, b) => (b.summary?.paidPulls ?? 0) - (a.summary?.paidPulls ?? 0))
            .map((b) => {
              const art = bannerArtUrl(b.poolId);
              const pulls = b.summary?.paidPulls ?? 0;
              const kindTotal = b.kind === 'char' ? p.charPulls : p.weapPulls;
              const drops = b.summary?.pulls.filter((x) => x.rarity === 6) ?? [];
              return html`<div class="patch-banner ${pulls ? '' : 'skipped'}">
                ${art ? html`<img class="thumb" src="${art}" alt="" loading="lazy" data-fallback />` : html`<span class="thumb"></span>`}
                <div style="min-width:0">
                  <div style="font-weight:600;font-size:14px">${b.name}</div>
                  <div class="muted" style="font-size:12px">
                    ${b.kind === 'char' ? 'Operator' : 'Arsenal'} ·
                    ${pulls ? `${fmtInt(pulls)} pulls (${fmtPct(pulls / Math.max(1, kindTotal), 0)})` : 'Skipped'}
                  </div>
                  ${drops.length
                    ? html`<div class="drops">
                        ${drops.map(
                          (d) =>
                            html`<span title="${d.name}${d.pity !== null ? ` · pity ${d.pity}` : ' · free'}" style="display:flex;align-items:center;gap:2px">
                              ${itemIcon(d.kind, d.itemId, d.name)}${outcomeMark(d.outcome)}
                            </span>`,
                        )}
                      </div>`
                    : ''}
                </div>
              </div>`;
            })}
        </div>
      </div>
    </details>`;
  })}`;
}
