import {
  copyPmf,
  LUCK_LABEL,
  luckTier,
  type AnalyzedPull,
  type Analysis,
  type BannerSummary,
  type KindStats,
  type Meter,
  type RewardTrack,
} from '../domain/analyze';
import { bannerArtUrl, CATEGORY_LABEL } from '../domain/banners';
import type { Kind } from '../domain/types';
import { state } from '../state';
import { cdfChart } from './charts';
import { heat, itemIcon, outcomeMark } from './common';
import { fmtDate, fmtInt, fmtPct, html, render, type Html } from './html';

type Filter = '6' | '5' | '4' | 'rateup';

/** Per-banner UI state that survives re-renders. */
const filters = new Map<string, Set<Filter>>();
const openRows = new Set<string>();
const filtersFor = (poolId: string) => filters.get(poolId) ?? new Set<Filter>(['6', '5']);

const KIND_COPY = {
  char: { title: 'Operators', flip: '50/50', items: 'operators' },
  weap: { title: 'Arsenal', flip: '25/75', items: 'weapons' },
} as const;

export function dashboardView(kind: Kind, analysis: Analysis): Html {
  const stats = analysis[kind];
  const banners = analysis.banners.filter((b) => b.kind === kind).sort((a, b) => b.lastTs - a.lastTs);
  const sixes = analysis.sixStars.filter((s) => s.kind === kind).reverse();
  const copy = KIND_COPY[kind];

  return html`
    <div class="page-head">
      <div>
        <h1>${copy.title}</h1>
        <p>${fmtInt(stats.pulls)} pulls across ${banners.length} banners · ${fmtInt(stats.uniqueItems)} unique ${copy.items}</p>
      </div>
    </div>
    ${tiles(kind, stats, sixes)}
    <h2 class="section-title">6★ history <small>newest first · tap one to jump to its banner</small></h2>
    ${sixes.length
      ? html`<div class="strip">${sixes.map((s) => stripItem(s))}</div>`
      : html`<p class="muted">No 6★ pulls yet.</p>`}
    <h2 class="section-title">Banners <small>most recently pulled first</small></h2>
    <div class="banner-grid">${banners.map((b) => bannerCard(b))}</div>
  `;
}

function tiles(kind: Kind, s: KindStats, sixes: AnalyzedPull[]): Html {
  const rateTier = luckTier(s.rate, s.expectedRate);
  const flips = s.won + s.lost;
  const winRate = flips ? s.won / flips : 0;
  const flipTier = luckTier(winRate, s.expectedWinRate);
  const paidSixes = sixes.filter((x) => x.pity !== null);
  const avgPity = paidSixes.length ? paidSixes.reduce((n, x) => n + x.pity!, 0) / paidSixes.length : 0;
  const badge = (tier: ReturnType<typeof luckTier>) =>
    html`<span class="badge ${tier.includes('unlucky') ? 'badge-bad' : tier.includes('lucky') ? 'badge-good' : ''}">${LUCK_LABEL[tier]}</span>`;

  return html`<div class="tiles">
    <div class="card tile">
      <div class="tile-label">Pulls</div>
      <div class="tile-value num">${fmtInt(s.pulls)}</div>
      <div class="tile-sub">${s.freePulls ? `+ ${fmtInt(s.freePulls)} free` : 'No free pulls'}</div>
    </div>
    <div class="card tile">
      <div class="tile-label">6★ rate ${s.pulls ? badge(rateTier) : ''}</div>
      <div class="tile-value num">${fmtPct(s.rate, 2)}</div>
      <div class="tile-sub">${s.sixStars} total · expected ${fmtPct(s.expectedRate, 2)}</div>
    </div>
    <div class="card tile">
      <div class="tile-label">${KIND_COPY[kind].flip} wins ${flips ? badge(flipTier) : ''}</div>
      <div class="tile-value num">${flips ? fmtPct(winRate, 0) : '–'}</div>
      <div class="tile-sub">
        ${s.won} won · ${s.lost} lost${s.guaranteed ? ` · ${s.guaranteed} guaranteed` : ''} · expected ${fmtPct(s.expectedWinRate, 0)}
      </div>
    </div>
    <div class="card tile">
      <div class="tile-label">Average 6★ pity</div>
      <div class="tile-value num">${avgPity ? avgPity.toFixed(1) : '–'}</div>
      <div class="tile-sub">${fmtInt(s.fiveStars)} 5★ pulls · 1 in ${s.fiveStars ? (s.pulls / s.fiveStars).toFixed(1) : '–'}</div>
    </div>
  </div>`;
}

function stripItem(s: AnalyzedPull): Html {
  return html`<button class="strip-item" data-action="jump" data-pool="${s.kind}:${s.poolId}" title="${s.name} — ${s.bannerName}">
    <div class="strip-portrait">
      ${itemIcon(s.kind, s.itemId, s.name, '')}
      <span class="mark-wrap">${outcomeMark(s.outcome)}</span>
    </div>
    <div class="strip-name">${s.name}</div>
    <div class="strip-pity num">${s.pity === null ? 'Free' : `Pity ${s.pity}`}</div>
  </button>`;
}

// ---------------------------------------------------------------------------
// Banner card
// ---------------------------------------------------------------------------

function bannerCard(b: BannerSummary): Html {
  const art = bannerArtUrl(b.poolId);
  const rateUpId = b.info?.rateUpIds.find((id) => id.startsWith(b.kind === 'char' ? 'chr_' : 'wpn_')) ?? '';
  const rateUpName = b.info?.rateUpNames.join(', ') ?? '';
  const multi = (b.info?.rateUpNames.length ?? 0) > 1;
  const fallback = html`<div class="placeholder">${rateUpId ? itemIcon(b.kind, rateUpId, rateUpName, '') : ''}</div>`;

  return html`<article class="card banner" id="banner-${b.kind}-${b.poolId}" data-pool="${b.poolId}">
    <div class="banner-art">
      ${fallback} ${art ? html`<img class="art" src="${art}" alt="" loading="lazy" data-fallback />` : ''}
      <div class="tags">
        ${b.isLatest ? html`<span class="badge badge-brand">Current</span>` : ''}
        <span class="badge">${b.patch.major === -1 ? 'Permanent' : `Patch ${b.patch.key}`}</span>
      </div>
    </div>
    <div class="banner-head">
      <h3>${b.name}</h3>
      <div class="sub">
        <span>${CATEGORY_LABEL[b.category]}</span>·
        <span>${fmtDate(b.firstTs)}${b.lastTs - b.firstTs > 86_400_000 ? ` – ${fmtDate(b.lastTs)}` : ''}</span>
      </div>
      ${b.info
        ? html`<div class="rateup">
            ${rateUpId && !multi ? itemIcon(b.kind, rateUpId, rateUpName) : ''}
            <div style="flex:1;min-width:0">
              <div class="muted" style="font-size:12px">Rate-up${multi ? 's' : ''}</div>
              <b>${rateUpName || 'Unknown'}</b>
            </div>
            ${b.rateUpCopies
              ? html`<span class="badge badge-good">✓ ${b.rateUpCopies > 1 ? `${b.rateUpCopies} copies` : 'Obtained'}</span>`
              : b.category === 'joint'
                ? ''
                : html`<span class="badge">Not yet</span>`}
          </div>`
        : ''}
    </div>
    <div class="meters">
      ${pityMeter(b)} ${b.guarantee ? meter(b.guarantee) : ''} ${b.rewards ? rewardMeter(b.rewards) : ''}
    </div>
    <div data-list>${pullList(b)}</div>
  </article>`;
}

function pityMeter(b: BannerSummary): Html {
  const m = b.pity;
  if (m.done) return meter({ ...m, value: m.max, done: true }, 'Done');
  const h = heat(m.value, m.max);
  const color = h === 'high' ? 'var(--bad)' : h === 'mid' ? 'var(--warn)' : 'var(--good)';
  const label = b.isLatest || b.kind === 'weap' ? m.label : `${m.label} when you left`;
  return meter({ ...m, label }, undefined, color);
}

function meter(m: Meter, doneText = 'Secured', color?: string): Html {
  const pct = Math.min(100, (m.value / m.max) * 100);
  return html`<div class="meter-row">
    <span class="label">${m.label}</span>
    <span class="value num">${m.done ? doneText : `${m.value} / ${m.max}`}</span>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${m.max}" aria-valuenow="${m.value}" aria-label="${m.label}">
      <i style="width:${pct}%;--meter:${m.done ? 'var(--muted)' : (color ?? 'var(--ars)')}"></i>
    </div>
  </div>`;
}

function rewardMeter(r: RewardTrack): Html {
  return html`<div class="meter-row">
    <span class="label">${r.label}${r.earned ? html` <span class="badge">${r.earned} earned</span>` : ''}</span>
    <span class="value num">${r.progress} / ${r.goal}</span>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="${r.goal}" aria-valuenow="${r.progress}" aria-label="${r.label}: next ${r.nextReward}">
      <i style="width:${(r.progress / r.goal) * 100}%;--meter:var(--r4)"></i>
    </div>
  </div>`;
}

function pullList(b: BannerSummary): Html {
  const f = filtersFor(b.poolId);
  const matches = (p: AnalyzedPull) =>
    (f.has('6') && p.rarity === 6) ||
    (f.has('5') && p.rarity === 5) ||
    (f.has('4') && p.rarity <= 4) ||
    (f.has('rateup') && p.isRateUp);
  const shown = b.pulls.filter(matches).reverse();
  const chip = (key: Filter, label: string, color: string) =>
    html`<button class="chip" data-action="filter" data-filter="${key}" aria-pressed="${f.has(key)}">
      <span class="dot" style="background:${color}"></span>${label}
    </button>`;

  return html`<div class="banner-tools">
      <span class="count"><b class="num">${fmtInt(b.paidPulls)}</b> pulls${b.freePulls ? ` + ${b.freePulls} free` : ''}</span>
      ${chip('6', '6★', 'var(--r6)')} ${chip('5', '5★', 'var(--r5)')} ${chip('4', '4★', 'var(--r4)')}
      ${b.info ? chip('rateup', 'Rate-up', 'var(--good)') : ''}
    </div>
    <ul class="pull-list ${state.settings.showTimestamps ? 'show-ts' : ''}">
      ${shown.length ? shown.map((p) => pullRow(b, p)) : html`<li class="empty">No pulls match these filters.</li>`}
    </ul>`;
}

function pullRow(b: BannerSummary, p: AnalyzedPull): Html {
  const max = b.pity.max;
  const expandable = p.luck !== undefined;
  const open = expandable && openRows.has(p.key);
  const inner = html`<span class="rarity"></span>
    ${itemIcon(p.kind, p.itemId, p.name)}
    <span class="pull-name">
      <span class="n">
        <span>${p.name}</span>${outcomeMark(p.outcome)}
        ${p.isNew ? html`<span class="tag tag-new">NEW</span>` : ''}
      </span>
      <span class="meta">
        ${p.bannerPull !== null ? `Pull #${p.bannerPull}` : 'Free pull'}<span class="ts"> · ${fmtDate(p.ts, true)}</span>
      </span>
    </span>
    ${p.pity === null
      ? html`<span class="tag tag-free">FREE</span>`
      : p.rarity === 6
        ? html`<span class="pity-pill" data-heat="${heat(p.pity, max)}" title="6★ pity at this pull">${p.pity} / ${max}</span>`
        : html`<span class="pity-pill muted">${p.pity}</span>`}`;

  return html`<li class="pull" data-r="${Math.min(p.rarity, 6)}">
    ${expandable
      ? html`<button class="pull-row" data-action="luck" data-key="${p.key}" aria-expanded="${open}">${inner}</button>`
      : html`<div class="pull-row">${inner}</div>`}
    ${open ? luckPanel(b, p) : ''}
  </li>`;
}

function luckPanel(b: BannerSummary, p: AnalyzedPull): Html {
  const pmf = copyPmf(b, p.copy!);
  if (!pmf || p.luck === undefined) return html``;
  const at = b.kind === 'weap' ? Math.ceil(p.bannerPull! / 10) * 10 : p.bannerPull!;
  const copyText = p.copy === 1 ? 'the rate-up' : `${p.copy} copies of the rate-up`;
  const verdict = p.luck < 0.25 ? 'luckier than most' : p.luck > 0.75 ? 'unluckier than most' : 'about typical';
  return html`<div class="luck">
    <p>
      ${p.outcome === 'guaranteed'
        ? html`This copy came from the banner guarantee at pull ${p.bannerPull}.`
        : html`<b>${fmtPct(p.luck)}</b> of players would have ${copyText} within ${at} pulls on this banner — ${verdict}.`}
      ${b.category === 'chartered' && b.startPity && p.copy === 1 ? html` You started this banner with ${b.startPity} pity banked.` : ''}
    </p>
    ${cdfChart(pmf, { at, compact: true })}
  </div>`;
}

// ---------------------------------------------------------------------------
// Interaction (delegated from the app root)
// ---------------------------------------------------------------------------

export function handleDashboardClick(target: HTMLElement, analysis: Analysis): boolean {
  const action = target.closest<HTMLElement>('[data-action]');
  if (!action) return false;
  const card = action.closest<HTMLElement>('.banner');
  const banner = card && analysis.banners.find((b) => b.poolId === card.dataset.pool && card.id === `banner-${b.kind}-${b.poolId}`);

  switch (action.dataset.action) {
    case 'filter': {
      if (!banner) return false;
      const f = new Set(filtersFor(banner.poolId));
      const key = action.dataset.filter as Filter;
      if (f.has(key)) f.delete(key);
      else f.add(key);
      filters.set(banner.poolId, f);
      render(card!.querySelector('[data-list]')!, pullList(banner));
      return true;
    }
    case 'luck': {
      if (!banner) return false;
      const key = action.dataset.key!;
      if (openRows.has(key)) openRows.delete(key);
      else openRows.add(key);
      const list = card!.querySelector<HTMLElement>('.pull-list')!;
      const scroll = list.scrollTop;
      render(card!.querySelector('[data-list]')!, pullList(banner));
      card!.querySelector<HTMLElement>('.pull-list')!.scrollTop = scroll;
      return true;
    }
    case 'jump': {
      const [kind, poolId] = action.dataset.pool!.split(':');
      const el = document.getElementById(`banner-${kind}-${poolId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
      return true;
    }
  }
  return false;
}
