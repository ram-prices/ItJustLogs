import type { Analysis } from '../domain/analyze';
import { bannerArtUrl, itemIconUrl } from '../domain/banners';
import { patchStats, weeklyTimeline, type PatchStats } from '../domain/patches';
import { state } from '../state';
import { weeklyChart } from './charts';
import { createStatCard } from './dashboard';
import { escape as esc } from './html';

/** Patch Stats tab, ported from eftracker's render-patch-stats.js, plus the weekly pulls chart. */

type Filter = 'all' | 'char' | 'weap';
type Sort = 'latest' | 'chrono' | 'pulls';

export const patchView = { filter: 'all' as Filter, sort: 'latest' as Sort };
export const SORT_LABEL: Record<Sort, string> = { latest: 'LATEST FIRST ▼', chrono: 'EARLIEST FIRST ▲', pulls: 'MOST PULLS ★' };

interface PatchRow {
  key: string;
  title: string;
  isPermanent: boolean;
  major: number;
  minor: number;
  charPulls: number;
  weapPulls: number;
  src: PatchStats;
}

const domKey = (k: string) => k.replace(/\./g, '_');

function rows(a: Analysis): PatchRow[] {
  return patchStats(a, state.db)
    .filter((p) => p.patch.major !== -1 || p.charPulls + p.weapPulls > 0)
    .map((p) => ({
      key: p.patch.key,
      title: p.patch.major === -1 ? 'Standard / Constant' : `Patch ${p.patch.key}`,
      isPermanent: p.patch.major === -1,
      major: p.patch.major,
      minor: p.patch.minor,
      charPulls: p.charPulls,
      weapPulls: p.weapPulls,
      src: p,
    }));
}

function sortPatches(list: PatchRow[], mode: Sort | 'chrono'): PatchRow[] {
  const f = patchView.filter;
  return [...list].sort((a, b) => {
    if (mode === 'pulls') {
      if (f === 'char' && b.charPulls !== a.charPulls) return b.charPulls - a.charPulls;
      if (f === 'weap' && b.weapPulls !== a.weapPulls) return b.weapPulls - a.weapPulls;
      if (f === 'all') {
        if (b.charPulls !== a.charPulls) return b.charPulls - a.charPulls;
        if (b.weapPulls !== a.weapPulls) return b.weapPulls - a.weapPulls;
      }
    }
    if (a.isPermanent !== b.isPermanent) return a.isPermanent ? 1 : -1;
    if (mode === 'chrono') return a.major - b.major || a.minor - b.minor;
    return b.major - a.major || b.minor - a.minor;
  });
}

const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');
const rate = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(2)}%` : '0%');

export function renderKpis(a: Analysis): string {
  const list = rows(a);
  const grandChar = list.reduce((n, p) => n + p.charPulls, 0);
  const grandWeap = list.reduce((n, p) => n + p.weapPulls, 0);
  const six = a.sixStars.filter((s) => !s.isFree);
  const char6 = six.filter((s) => s.kind === 'char').length;
  const weap6 = six.filter((s) => s.kind === 'weap').length;
  const peak = (k: 'charPulls' | 'weapPulls') => list.reduce<PatchRow | null>((m, p) => (p[k] > 0 && (!m || p[k] > m[k]) ? p : m), null);
  const peakChar = peak('charPulls');
  const peakWeap = peak('weapPulls');
  const activeChar = list.filter((p) => p.charPulls > 0).length;
  const activeWeap = list.filter((p) => p.weapPulls > 0).length;
  const avgChar = activeChar ? Math.round(grandChar / activeChar) : 0;
  const avgWeap = activeWeap ? Math.round(grandWeap / activeWeap) : 0;

  if (patchView.filter === 'char') {
    return (
      createStatCard('OPERATOR PULLS', grandChar, `Across ${activeChar} active updates`) +
      createStatCard('PEAK OPERATOR INVESTMENT', peakChar?.title ?? 'N/A', peakChar ? `${peakChar.charPulls} Operator Pulls` : '0 Pulls') +
      createStatCard('AVG PER UPDATE', avgChar, 'Operator pulls per active patch') +
      createStatCard('6★ OPERATORS WON', char6, `Drop Rate: ${rate(char6, grandChar)}`)
    );
  }
  if (patchView.filter === 'weap') {
    return (
      createStatCard('ARSENAL PULLS', grandWeap, `Across ${activeWeap} active updates`) +
      createStatCard('PEAK ARSENAL INVESTMENT', peakWeap?.title ?? 'N/A', peakWeap ? `${peakWeap.weapPulls} Arsenal Pulls` : '0 Pulls') +
      createStatCard('AVG PER UPDATE', avgWeap, 'Arsenal pulls per active patch') +
      createStatCard('6★ WEAPONS WON', weap6, `Drop Rate: ${rate(weap6, grandWeap)}`)
    );
  }
  return (
    createStatCard('OPERATOR PULLS', grandChar, `Peak: ${peakChar ? `${peakChar.title} (${peakChar.charPulls})` : 'N/A'}`) +
    createStatCard('ARSENAL PULLS', grandWeap, `Peak: ${peakWeap ? `${peakWeap.title} (${peakWeap.weapPulls})` : 'N/A'}`) +
    createStatCard('6★ OPERATORS', char6, `Rate: ${rate(char6, grandChar)} (Avg ${avgChar}/patch)`) +
    createStatCard('6★ ARSENALS', weap6, `Rate: ${rate(weap6, grandWeap)} (Avg ${avgWeap}/patch)`)
  );
}

export function renderDistribution(a: Analysis): string {
  const list = sortPatches(rows(a), 'chrono');
  const f = patchView.filter;
  const grandChar = list.reduce((n, p) => n + p.charPulls, 0);
  const grandWeap = list.reduce((n, p) => n + p.weapPulls, 0);
  const maxChar = Math.max(1, ...list.map((p) => p.charPulls));
  const maxWeap = Math.max(1, ...list.map((p) => p.weapPulls));
  const swatch = (c: string) => `<span style="display:inline-block;width:10px;height:10px;background:${c};margin-right:5px;vertical-align:middle;border-radius:1px;"></span>`;
  const track = (cls: string, w: number) => `<div class="dist-bar-track"><div class="${cls}" style="width: ${w}%;"></div></div>`;

  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <div class="dist-title">INVESTMENT BY UPDATE / PATCH</div>
      <div style="display: flex; gap: 15px; font-size: 11px; font-family: monospace; color: var(--text-dim);">
        ${f !== 'weap' ? `<span>${swatch('var(--accent-orange)')}Operators</span>` : ''}
        ${f !== 'char' ? `<span>${swatch('var(--accent-blue)')}Arsenals</span>` : ''}
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
    ${list
      .map((p) => {
        const cw = (p.charPulls / maxChar) * 100;
        const ww = (p.weapPulls / maxWeap) * 100;
        let bars: string;
        let text: string;
        if (f === 'char') {
          bars = `<div class="dist-bar-single">${track('dist-bar-fill-char', cw)}</div>`;
          text = `<strong style="color: var(--accent-orange);">${p.charPulls}</strong> <span style="color: var(--text-dim); font-size: 11px;">Pulls (${pct(p.charPulls, grandChar)}%)</span>`;
        } else if (f === 'weap') {
          bars = `<div class="dist-bar-single">${track('dist-bar-fill-weap', ww)}</div>`;
          text = `<strong style="color: var(--accent-blue);">${p.weapPulls}</strong> <span style="color: var(--text-dim); font-size: 11px;">Pulls (${pct(p.weapPulls, grandWeap)}%)</span>`;
        } else {
          bars = `
            <div class="dist-bar-single"><span class="dist-bar-type-tag" style="color: var(--accent-orange);">OPER</span>${track('dist-bar-fill-char', cw)}<span class="dist-bar-count-inline" style="color: var(--accent-orange);">${p.charPulls}</span></div>
            <div class="dist-bar-single"><span class="dist-bar-type-tag" style="color: var(--accent-blue);">ARSEN</span>${track('dist-bar-fill-weap', ww)}<span class="dist-bar-count-inline" style="color: var(--accent-blue);">${p.weapPulls}</span></div>`;
          text = `<div style="line-height: 1.4;">
            <div><strong style="color: var(--accent-orange);">${p.charPulls}</strong> <span style="color: var(--text-dim); font-size: 10px;">Op (${pct(p.charPulls, grandChar)}%)</span></div>
            <div><strong style="color: var(--accent-blue);">${p.weapPulls}</strong> <span style="color: var(--text-dim); font-size: 10px;">Ars (${pct(p.weapPulls, grandWeap)}%)</span></div>
          </div>`;
        }
        return `<div class="dist-patch-row" data-action="patch-jump" data-key="${domKey(p.key)}" title="Jump to ${p.title}">
          <div class="dist-patch-label">${p.title}</div>
          <div class="dist-bars-container">${bars}</div>
          <div class="dist-patch-stats">${text}</div>
        </div>`;
      })
      .join('')}
    </div>`;
}

export function renderWeekly(a: Analysis): string {
  return `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
      <div class="dist-title">PULLS PER WEEK</div>
      <div style="display: flex; gap: 15px; font-size: 11px; font-family: monospace; color: var(--text-dim);">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent-orange);margin-right:5px;vertical-align:middle;border-radius:1px;"></span>Operators</span>
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent-blue);margin-right:5px;vertical-align:middle;border-radius:1px;"></span>Arsenals</span>
        <span><span style="display:inline-block;width:8px;height:8px;background:var(--rarity-6);margin-right:5px;vertical-align:middle;border-radius:50%;"></span>Week with a 6★</span>
      </div>
    </div>
    ${weeklyChart(weeklyTimeline(a)).value}`;
}

export function renderPatchCards(a: Analysis): string {
  const list = rows(a);
  const grandChar = list.reduce((n, p) => n + p.charPulls, 0);
  const grandWeap = list.reduce((n, p) => n + p.weapPulls, 0);
  const f = patchView.filter;

  return sortPatches(list, patchView.sort)
    .map((p) => {
      const charShare = pct(p.charPulls, grandChar);
      const weapShare = pct(p.weapPulls, grandWeap);
      const paidSix = p.src.sixStars.filter((s) => s.pity !== null);
      const char6 = paidSix.filter((s) => s.kind === 'char');
      const weap6 = paidSix.filter((s) => s.kind === 'weap');
      const avg = (l: typeof paidSix) => (l.length ? (l.reduce((n, s) => n + s.pity!, 0) / l.length).toFixed(1) : '-');
      const banners = p.src.banners
        .filter((b) => f === 'all' || b.kind === f)
        .sort((x, y) => (y.summary?.paidPulls ?? 0) - (x.summary?.paidPulls ?? 0) || x.poolId.localeCompare(y.poolId));

      const bannersHtml = banners
        .map((b) => {
          const pulls = b.summary?.paidPulls ?? 0;
          const art = bannerArtUrl(b.poolId);
          const kindTotal = b.kind === 'char' ? p.charPulls : p.weapPulls;
          const share = kindTotal > 0 ? `${((pulls / kindTotal) * 100).toFixed(0)}% of patch ${b.kind === 'char' ? 'operators' : 'arsenals'}` : '';
          const drops = (b.summary?.pulls ?? []).filter((x) => x.rarity === 6);
          const dropsHtml = drops.length
            ? `<div class="patch-banner-drops">${drops
                .map((s) => {
                  const pity = s.pity ?? 'FREE';
                  const luck = typeof pity !== 'number' ? 'luck-good' : pity <= 40 ? 'luck-good' : pity <= 65 ? 'luck-avg' : 'luck-bad';
                  const won = s.outcome === 'won' || s.outcome === 'guaranteed';
                  return `<div class="patch-drop-item" title="${esc(s.name)} (Pity: ${pity})">
                    <img src="${itemIconUrl(s.kind, s.itemId)}" class="patch-drop-icon" alt="" data-fallback>
                    <span class="patch-drop-name">${esc(s.name)}</span>
                    <span class="patch-drop-pity ${luck}">${pity}</span>
                    ${won ? '<span style="color: var(--color-green); font-size: 10px;" title="Rate-Up Won">&#10004;</span>' : s.outcome === 'lost' ? '<span style="color: var(--color-red); font-size: 10px;" title="Off-Banner">&#10006;</span>' : ''}
                  </div>`;
                })
                .join('')}</div>`
            : '';
          return `<div class="patch-banner-item ${pulls === 0 ? 'skipped' : ''}">
            <div class="patch-banner-item-header">
              ${art ? `<img src="${art}" class="patch-banner-thumb" alt="" data-fallback>` : ''}
              <div class="patch-banner-info">
                <div class="patch-banner-name" title="${esc(b.name)}">${esc(b.name)}</div>
                <div class="patch-banner-meta"><span class="${b.kind === 'char' ? 'patch-pill-char' : 'patch-pill-weap'}">${b.kind === 'char' ? 'OPERATOR' : 'ARSENAL'}</span><span>${esc(b.poolId)}</span></div>
              </div>
              <div class="patch-banner-pulls">
                <div class="patch-banner-pulls-val${pulls > 0 ? '' : ' zero'}">${pulls} <span style="font-size: 11px; font-weight: normal; color: var(--text-dim);">PULLS</span></div>
                ${pulls > 0 ? `<div class="patch-banner-pulls-share">${share}</div>` : `<div class="patch-banner-pulls-share" style="color: #666;">SKIPPED</div>`}
              </div>
            </div>
            ${dropsHtml}
          </div>`;
        })
        .join('');

      const badge = (k: 'char' | 'weap', n: number) =>
        `<div class="patch-pull-badge ${k}"><div class="patch-pull-badge-num">${n}</div><div class="patch-pull-badge-label">${k === 'char' ? 'OPERATOR' : 'ARSENAL'} PULLS</div></div>`;
      const badges = f === 'char' ? badge('char', p.charPulls) : f === 'weap' ? badge('weap', p.weapPulls) : `<div class="patch-pulls-dual-box">${badge('char', p.charPulls)}${badge('weap', p.weapPulls)}</div>`;

      const pulled = banners.filter((b) => (b.summary?.paidPulls ?? 0) > 0).length;
      const cell = (title: string, val: string | number, sub: string, color = '') =>
        `<div class="patch-metric-cell"><div class="patch-metric-title">${title}</div><div class="patch-metric-val"${color ? ` style="color: ${color};"` : ''}>${val}</div><div class="patch-metric-sub">${sub}</div></div>`;

      let subline: string;
      let metrics: string;
      if (f === 'char') {
        subline = `<span>Operator Pulls Share: <strong style="color: var(--accent-orange);">${charShare}%</strong> of all operator pulls</span><span>${char6.length} 6★ Operators &middot; Avg Pity: ${avg(char6)}</span>`;
        metrics =
          cell('6★ OPERATORS', char6.length, `Avg Pity: ${avg(char6)}`, 'var(--color-yellow)') +
          cell('OPERATOR PULLS', p.charPulls, `${charShare}% of all Op pulls`, 'var(--accent-orange)') +
          cell('BANNERS ACTIVE', banners.length, `${pulled} Pulled &middot; ${banners.length - pulled} Skipped`);
      } else if (f === 'weap') {
        subline = `<span>Arsenal Pulls Share: <strong style="color: var(--accent-blue);">${weapShare}%</strong> of all arsenal pulls</span><span>${weap6.length} 6★ Weapons &middot; Avg Pity: ${avg(weap6)}</span>`;
        metrics =
          cell('6★ WEAPONS', weap6.length, `Avg Pity: ${avg(weap6)}`, 'var(--color-yellow)') +
          cell('ARSENAL PULLS', p.weapPulls, `${weapShare}% of all Ars pulls`, 'var(--accent-blue)') +
          cell('BANNERS ACTIVE', banners.length, `${pulled} Pulled &middot; ${banners.length - pulled} Skipped`);
      } else {
        subline = `<span>Operator Share: <strong style="color: var(--accent-orange);">${charShare}%</strong> &nbsp;|&nbsp; Arsenal Share: <strong style="color: var(--accent-blue);">${weapShare}%</strong></span><span>Active Banners: <strong>${banners.length}</strong></span>`;
        metrics =
          cell('6★ OPERATORS', char6.length, `Avg Pity: ${avg(char6)}`, 'var(--accent-orange)') +
          cell('6★ WEAPONS', weap6.length, `Avg Pity: ${avg(weap6)}`, 'var(--accent-blue)') +
          cell('OPERATOR PULLS', p.charPulls, `${charShare}% of Op pulls`, 'var(--accent-orange)') +
          cell('ARSENAL PULLS', p.weapPulls, `${weapShare}% of Ars pulls`, 'var(--accent-blue)');
      }

      return `<div class="patch-card reveal-on-scroll" id="patch-card-${domKey(p.key)}">
        <div class="patch-card-header">
          <div class="patch-tag-box"><h3 class="patch-title-text">${p.title}</h3><span class="patch-status-badge">${p.isPermanent ? 'PERMANENT' : 'UPDATE'}</span></div>
          ${badges}
        </div>
        <div class="patch-subline">${subline}</div>
        <div class="patch-metrics-grid">${metrics}</div>
        <div class="patch-banners-subhead"><span>Banners in ${p.title}</span><span style="font-size: 11px; color: var(--text-dim); text-transform: none;">${banners.length} banners recorded</span></div>
        <div class="patch-banners-grid">${bannersHtml || '<div style="color: var(--text-dim); font-size: 12px; font-style: italic;">No banners recorded for this category.</div>'}</div>
      </div>`;
    })
    .join('');
}
