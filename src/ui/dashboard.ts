import { luckTier, type Analysis, type KindStats, type LuckTier } from '../domain/analyze';
import { bannerArtUrl, itemIconUrl } from '../domain/banners';
import type { Kind } from '../domain/types';
import { escape as esc } from './html';
import type { ViewBanner, ViewModel, ViewPull } from './model';

/**
 * Operators / Arsenals views, ported from eftracker's render-dashboard.js so the
 * markup (and therefore the original stylesheet) matches it exactly. Inline
 * handlers became data-action attributes handled in ui/interactions.ts.
 */

const icon = (kind: Kind, id: string) => itemIconUrl(kind, id);
/**
 * eftracker emitted pull rows and banner-box skeletons as single lines, and its
 * stylesheet renders whitespace between those tags, so strip it to match.
 */
const tight = (s: string) => s.replace(/>\s+</g, '><').trim();

export function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

// ---------------------------------------------------------------------------
// Overview stat cards
// ---------------------------------------------------------------------------

export function createStatCard(title: string, val: string | number, sub: string, badgeText?: string | null, badgeCss?: string | null, valColorCss?: string): string {
  return `
    <div class="stat-card reveal-on-scroll">
      ${badgeText ? `<div class="stat-card-badge ${badgeCss}">${badgeText}</div>` : ''}
      <div class="stat-card-title">${title}</div>
      <div class="stat-card-value ${valColorCss || ''}">${val}</div>
      <div class="stat-card-sub">${sub}</div>
    </div>`;
}

const LUCK: Record<LuckTier, { t: string; c: string }> = {
  'very-lucky': { t: 'VERY LUCKY', c: 'luck-very-good' },
  lucky: { t: 'LUCKY', c: 'luck-good' },
  average: { t: 'AVERAGE', c: 'luck-avg' },
  unlucky: { t: 'UNLUCKY', c: 'luck-bad' },
  'very-unlucky': { t: 'VERY UNLUCKY', c: 'luck-very-bad' },
};

export function renderOverview(kind: Kind, s: KindStats): string {
  if (!s.pulls) return `<div style="color: var(--text-dim); font-size: 12px; font-style: italic;">NO DATA AVAILABLE</div>`;
  const name = kind === 'char' ? 'OPERATOR' : 'ARSENAL';
  const expected = s.expectedRate * 100;
  const actual = s.rate * 100;
  const luck = LUCK[luckTier(actual, expected)];
  let html =
    createStatCard(`TOTAL ${name} PULLS`, s.pulls, `Total 6★ Acquired: ${s.sixStars}`) +
    createStatCard(
      `${name} 6★ DROP RATE`,
      `${actual.toFixed(2)}%`,
      `Actual: 1 in ${(s.sixStars > 0 ? s.pulls / s.sixStars : s.pulls).toFixed(1)} pulls | Expected: ${expected.toFixed(2)}%`,
      luck.t,
      luck.c,
      luck.c,
    );
  const flips = s.won + s.lost;
  if (flips > 0) {
    const wr = (s.won / flips) * 100;
    const exp = s.expectedWinRate * 100;
    const wl = LUCK[luckTier(wr, exp)];
    const label = kind === 'char' ? '50/50' : '25/75';
    html += createStatCard(
      `${name} ${label} WINS`,
      `${wr.toFixed(0)}%`,
      `Won ${s.won} out of ${flips} ${label}s | Expected: ${exp.toFixed(0)}%`,
      wl.t,
      wl.c,
      wl.c,
    );
  }
  return html;
}

// ---------------------------------------------------------------------------
// Pity boxes
// ---------------------------------------------------------------------------

function createPityCol(val: number, max: number, label: string, valColor: string, labelColor: string, extraHtml = ''): string {
  const pct = max > 0 ? Math.max(0, Math.min(100, (val / max) * 100)) : 0;
  return `
    <div class="pity-col">
      <div class="pity-label" style="color: ${labelColor}; line-height: 1.2;"><span class="pity-dot" style="background: ${valColor};"></span>${label} ${extraHtml}</div>
      <div class="pity-val" style="color: ${valColor};">${val}<span class="pity-max" style="color: ${labelColor};">/${max}</span></div>
      <div class="pity-fill-track"><div class="pity-fill-bar" style="width: ${pct}%; background: ${valColor};"></div></div>
    </div>`;
}

const createPityBox = (cols: string[]) => `<div class="pity-box banner-pity-box">${cols.join('')}</div>`;

// ---------------------------------------------------------------------------
// Chartered "pity ruler"
// ---------------------------------------------------------------------------

const PITY_RULER_ICONS = {
  badge: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 12c2.7 0 8 1.3 8 4v2H4v-2c0-2.7 5.3-4 8-4zm0-2a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M21 10V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 1 0 4v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 1 0-4z"/></svg>',
};

// Pins that get nudged apart tilt their pointer back toward the true pull.
const PIN_TILT_DEG_PER_PCT = 3;
const PIN_TILT_MAX_DEG = 55;
const PIN_TILT_MIN_DEG = 10;
/** Minimum spacing between same-side pins, sized for a ~260px mobile segment. */
const PIN_MIN_GAP_PCT = 8.5;
const WIDE_PIN_EDGE_PX = 28;

const pinEdgeClamp = (pct: number, edgePx = 16) => `clamp(${edgePx}px, ${pct}%, calc(100% - ${edgePx}px))`;

function portraitPin(side: 'above' | 'below', leftPct: number, p: ViewPull, truePct: number): string {
  const url = icon('char', p.itemId);
  const img = url ? `<img src="${url}" loading="lazy" data-fallback alt="${esc(p.name)}">` : PITY_RULER_ICONS.check;
  const label = `<div class="ruler-pin-label">${p.pullNum}</div>`;
  const circle = `<div class="ruler-pin-circle">${img}</div>`;
  const delta = truePct - leftPct;
  const magnitude = Math.abs(delta) > 0.05 ? Math.max(PIN_TILT_MIN_DEG, Math.min(Math.abs(delta) * PIN_TILT_DEG_PER_PCT, PIN_TILT_MAX_DEG)) : 0;
  const tilt = Math.sign(delta) * magnitude * (side === 'below' ? 1 : -1);
  const point = `<div class="ruler-pin-point"${magnitude > 0 ? ` style="transform: rotate(${tilt.toFixed(1)}deg);"` : ''}></div>`;
  const children = side === 'below' ? circle + point + label : label + circle + point;
  return `<div class="ruler-pin-${side} done" style="left: ${pinEdgeClamp(leftPct)}; color: var(--text-dim);" title="${esc(p.name)}">${children}</div>`;
}

/** Clusters pins closer than minGap and spaces each cluster evenly around its average. */
export function declutterPct(pcts: number[], minGap = PIN_MIN_GAP_PCT): number[] {
  const out = new Array<number>(pcts.length);
  let start = 0;
  for (let i = 1; i <= pcts.length; i++) {
    if (i === pcts.length || pcts[i] - pcts[i - 1] >= minGap) {
      const size = i - start;
      if (size === 1) out[start] = pcts[start];
      else {
        const avg = pcts.slice(start, i).reduce((a, b) => a + b, 0) / size;
        const first = avg - (minGap * (size - 1)) / 2;
        for (let j = 0; j < size; j++) out[start + j] = first + j * minGap;
      }
      start = i;
    }
  }
  return out;
}

function pinGroup(side: 'above' | 'below', pulls: ViewPull[], windowStart: number, axisMax: number): string {
  const truePcts = pulls.map((p) => (((p.pullNum as number) - windowStart) / axisMax) * 100);
  const nudged = declutterPct(truePcts);
  return pulls.map((p, i) => portraitPin(side, nudged[i], p, truePcts[i])).join('');
}

interface AxisOpts {
  windowStart: number;
  axisMax: number;
  ownerNow: number;
  ownerColor: string;
  ownerLabel: string;
  ownerTarget: number;
  ownerIcon: string;
  ownerPinMode: 'active' | 'done';
  pityColor: string;
  pityVal: number;
  showPityLive: boolean;
  allPulls: ViewPull[];
}

function renderRulerAxis(o: AxisOpts): string {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const ownerPct = o.axisMax > 0 ? clamp((o.ownerNow / o.axisMax) * 100) : 0;
  const inWindow = (p: ViewPull) =>
    p.rarity === 6 && typeof p.pullNum === 'number' && p.pullNum > o.windowStart && p.pullNum <= o.windowStart + o.ownerNow;
  const below = pinGroup('below', o.allPulls.filter((p) => inWindow(p) && !p.isRateUpItem), o.windowStart, o.axisMax);
  const above = pinGroup('above', o.allPulls.filter((p) => inWindow(p) && p.isRateUpItem), o.windowStart, o.axisMax);

  let pityFill = '';
  let nowCap = '';
  if (o.showPityLive) {
    // The pity band spans the 80-pull window from the last 6★; the part ahead of "now" is a projection.
    const resetRaw = o.ownerNow - o.pityVal;
    const left = o.axisMax > 0 ? (Math.max(0, resetRaw) / o.axisMax) * 100 : 0;
    const right = o.axisMax > 0 ? (Math.min(o.axisMax, resetRaw + 80) / o.axisMax) * 100 : 0;
    pityFill = `
      <div class="ruler-fill-pity" style="left: ${left}%; width: ${Math.max(0, ownerPct - left)}%; background: ${o.pityColor};"></div>
      <div class="ruler-fill-pity ruler-fill-pity-ahead" style="left: ${ownerPct}%; width: ${Math.max(0, right - ownerPct)}%; background: ${o.pityColor};"></div>`;
    nowCap = `<div class="ruler-now-cap" style="left: ${ownerPct}%;"></div>`;
  }

  const ownerPin =
    o.ownerPinMode === 'done'
      ? `<div class="ruler-pin-above done" style="left: ${pinEdgeClamp(100)}; color: var(--text-dim);">
          <div class="ruler-pin-label">${o.ownerTarget}</div>
          <div class="ruler-pin-circle">${PITY_RULER_ICONS.check}</div>
          <div class="ruler-pin-point"></div>
        </div>`
      : `<div class="ruler-pin-above" style="left: ${pinEdgeClamp(100, WIDE_PIN_EDGE_PX)}; color: ${o.ownerColor};">
          <div class="ruler-pin-label" style="color: ${o.ownerColor};">${o.ownerLabel}<br>${o.ownerTarget}</div>
          <div class="ruler-pin-circle" style="background: ${o.ownerColor};">${o.ownerIcon}</div>
          <div class="ruler-pin-point"></div>
        </div>`;

  return `
    <div class="ruler-axis">
      <div class="ruler-track">
        ${pityFill}
        <div class="ruler-fill-owner" style="width: ${ownerPct}%; background: ${o.ownerColor};"></div>
      </div>
      ${nowCap}${below}${above}${ownerPin}
    </div>`;
}

/**
 * One axis for the 120-pull guarantee (then 240-pull bonus-copy cycles once it's
 * won) with a floating 80-pull pity lane. Multiple cycles scroll horizontally.
 */
function createPityRulerChartered(v: ViewBanner): string {
  const grey = '#888888';
  const isActive = v.isActive;
  const pityVal = v.endPity;
  const rateUp = Math.min(120, v.endRateUpPity);
  const tokenCycles = Math.floor(v.endTokenPulls / 240);
  const tokenNow = v.endTokenPulls % 240;
  const done = v.endHasPulledRateUp;
  const pityColor = !isActive ? grey : pityVal >= 64 ? 'var(--color-red)' : pityVal >= 40 ? 'var(--accent-orange)' : 'var(--color-green)';
  const guarColor = !isActive ? grey : rateUp >= 100 ? 'var(--color-red)' : rateUp >= 70 ? 'var(--accent-orange)' : 'var(--color-green)';

  let segments: string;
  let scrollable = false;
  if (!done) {
    segments = `<div class="ruler-segment">${renderRulerAxis({
      windowStart: 0, axisMax: 120, ownerNow: rateUp, ownerColor: guarColor,
      ownerLabel: 'Guarantee', ownerTarget: 120, ownerIcon: PITY_RULER_ICONS.badge, ownerPinMode: 'active',
      pityColor, pityVal, showPityLive: true, allPulls: v.allPulls,
    })}</div>`;
  } else {
    const segs: string[] = [];
    for (let i = 0; i <= tokenCycles; i++) {
      const current = i === tokenCycles;
      const windowStart = i * 240;
      segs.push(`
        <div class="ruler-segment" style="flex-basis: ${100 / (tokenCycles + 1)}%;">
          ${tokenCycles > 0 ? `<div class="ruler-segment-label">Cycle ${i + 1} of ${tokenCycles + 1}</div>` : ''}
          ${renderRulerAxis({
            windowStart, axisMax: 240, ownerNow: current ? tokenNow : 240,
            ownerColor: current && isActive ? 'var(--accent-blue)' : grey,
            ownerLabel: 'Token', ownerTarget: windowStart + 240, ownerIcon: PITY_RULER_ICONS.ticket,
            ownerPinMode: current ? 'active' : 'done',
            pityColor, pityVal, showPityLive: current, allPulls: v.allPulls,
          })}
        </div>`);
    }
    segments = segs.join('');
    scrollable = tokenCycles > 0;
  }

  const readoutColor = !isActive ? grey : done ? 'var(--accent-blue)' : guarColor;
  return `
    <div class="pity-ruler">
      <div class="pity-ruler-readout">
        <span style="color: ${readoutColor};">${done ? tokenNow : rateUp}<span class="unit">${done ? 'token' : 'guar'}</span></span>
        <span style="color: ${pityColor};">${pityVal}<span class="unit">pity</span></span>
      </div>
      <div class="ruler-body${scrollable ? ' ruler-body-multi' : ''}">${
        scrollable
          ? `<div class="ruler-scroll"><div class="ruler-segments" style="width: ${(tokenCycles + 1) * 100}%;">${segments}</div></div>`
          : segments
      }</div>
    </div>`;
}

function weaponPity(v: ViewBanner): string {
  const tB = Math.ceil(v.totalPulls / 10);
  const gVal = v.hasPulledRateUp ? v.rateUpBlock : (tB % 8 === 0 && tB > 0 ? 8 : tB % 8) || 0;
  const pVal = tB >= 10 ? (tB - 10) % 8 || (tB > 10 ? 8 : 0) : tB;
  const earn = tB >= 10 ? 1 + Math.floor((tB - 10) / 8) : 0;
  const p4 = v.hasPulledSixStar ? v.firstSixStarBlock : tB;
  const grey = '#666666';
  return createPityBox([
    createPityCol(p4, 4, 'PITY', v.hasPulledSixStar ? grey : p4 >= 3 ? 'var(--color-red)' : p4 >= 2 ? 'var(--accent-orange)' : 'var(--color-green)', v.hasPulledSixStar ? grey : 'var(--text-dim)'),
    createPityCol(gVal, 8, 'GUARANTEE', v.hasPulledRateUp ? grey : gVal >= 6 ? 'var(--color-red)' : gVal >= 4 ? 'var(--accent-orange)' : 'var(--color-green)', v.hasPulledRateUp ? grey : 'var(--text-dim)'),
    createPityCol(
      pVal,
      tB >= 10 ? 8 : 10,
      `SEL <span style="color: var(--accent-blue); font-weight: bold;">${Math.ceil(earn / 2)}</span> R-UP <span style="color: var(--accent-orange); font-weight: bold;">${Math.floor(earn / 2)}</span>`,
      tB < 10 || earn % 2 === 0 ? 'var(--accent-blue)' : 'var(--accent-orange)',
      'var(--text-dim)',
    ),
  ]);
}

function otherCharPity(v: ViewBanner): string {
  const nh = v.category === 'New Horizons';
  const limit = nh ? 40 : 80;
  const val = nh ? (v.firstSixStarPity ?? v.totalPulls) : v.endPity;
  const color =
    nh && (v.firstSixStarPity !== null || v.totalPulls >= 40)
      ? '#666666'
      : val >= limit * 0.8 ? 'var(--color-red)' : val >= limit * 0.5 ? 'var(--accent-orange)' : 'var(--color-green)';
  const joint = v.summary.category === 'joint';
  const label = joint ? 'PITY (JOINT)' : 'PITY';
  const cols = [createPityCol(val, limit, label, v.isActive ? color : '#888888', v.isActive ? 'var(--text-dim)' : '#888888')];
  if (joint) {
    const c = v.isActive ? 'var(--accent-blue)' : '#888888';
    cols.push(createPityCol(v.endTokenPulls % 120, 120, 'TOKEN', c, v.isActive ? 'var(--text-dim)' : '#888888', `<span style="color: ${c}; font-weight: bold;">${Math.floor(v.endTokenPulls / 120)}</span>`));
  }
  return createPityBox(cols);
}

// ---------------------------------------------------------------------------
// Banner boxes
// ---------------------------------------------------------------------------

/** Art-less banners (constant issues, or art that failed to load) get a weapon showcase instead. */
export function fallbackBannerHtml(v: ViewBanner): string {
  const info = v.summary.info;
  const weaponId = info?.rateUpIds.find((id) => id.startsWith('wpn_')) ?? '';
  const displayName = info?.rateUpNames[0] || v.name || 'Arsenal Requisition';
  const poolTitle = (v.name || 'Arsenal Requisition').toUpperCase();
  const tag = poolTitle.includes('CONSTANT') || v.isConstant ? 'CONSTANT ISSUE · ARSENAL' : poolTitle;
  const visual = weaponId
    ? `<div class="fallback-banner-visual"><div class="fallback-banner-glow"></div>
         <img src="${icon('weap', weaponId)}" class="fallback-banner-weapon-img" alt="${esc(displayName)}" loading="lazy" crossorigin="anonymous" data-fallback data-tint="${v.domId}"></div>`
    : `<div class="fallback-banner-visual"><div class="fallback-banner-glow"></div>
         <div style="font-family: monospace; font-size: 24px; color: var(--accent-orange); opacity: 0.6;">✦</div></div>`;
  return `
    <div class="fallback-banner" id="fallback-${v.domId}">
      <div class="fallback-banner-decor-corner"></div>
      <div class="fallback-banner-content">
        <div class="fallback-banner-tag"><span class="fallback-banner-tag-dot"></span>${esc(tag)}</div>
        <div class="fallback-banner-name" title="${esc(displayName)}">${esc(displayName)}</div>
        <div class="fallback-banner-sub"><span class="fallback-banner-stars">★★★★★★</span> 6★ ${v.prefix === 'char' ? 'OPERATOR' : 'ARSENAL'}</div>
      </div>
      ${visual}
    </div>`;
}

function pullItem(v: ViewBanner, p: ViewPull, lastBlock: { n: number | 'FREE' | null }): string {
  const prefix = v.prefix;
  const timeStr = formatTimestamp(p.ts);
  const newTag = p.isNew
    ? `<span class="pity-count pity-green" style="font-size: 9px; padding: 1px 4px; background: rgba(76, 175, 80, 0.1); border: none; border-radius: 2px;">NEW</span>`
    : '';
  let rateUpTag = '';
  let luckHTML = '';
  let blockHeader = '';
  let badgeHTML = '';
  let clickable = false;

  if (p.rarity === 6 && p.isRateUpItem) {
    rateUpTag = `<span class="pity-count pity-yellow" style="font-size: 9px; padding: 1px 4px; background: rgba(255, 152, 0, 0.1); border: none; border-radius: 2px;">RATE-UP</span>`;
    if (p.pullProb !== undefined) {
      const copies = (p.rateUpCopyNum ?? 1) > 1 ? `${p.rateUpCopyNum} copies` : '1 copy';
      const msg =
        prefix === 'weap'
          ? `chance to pull ${copies} of the Rate-Up within ${Math.ceil((p.pullNum as number) / 10)} blocks.`
          : `chance to pull ${copies} of the Rate-Up within ${p.pullNum} pulls.<br><span style="font-size: 9px; color: #666;">${v.startingPityForMath > 0 && p.rateUpCopyNum === 1 ? `(Started with ${v.startingPityForMath} pity)` : ''}</span>`;
      luckHTML = `<div class="luck-content"><div class="luck-text">You had a <span class="luck-pct">${p.pullProb.toFixed(2)}%</span> ${msg}</div>${p.graphHTML ?? ''}</div>`;
      clickable = true;
    }
  }

  if (p.pityAtPull !== null) {
    if (prefix === 'weap' && p.pityAtPull !== 'FREE') {
      if (p.pityAtPull !== lastBlock.n) {
        blockHeader = `<li class="pull-block-header">BLOCK_${p.pityAtPull}</li>`;
        lastBlock.n = p.pityAtPull;
      }
    } else {
      const pity = p.pityAtPull;
      const cls =
        pity === 'FREE'
          ? 'pity-green'
          : p.rarity === 6
            ? pity < (prefix === 'weap' ? 4 : 40) ? 'pity-green' : pity <= (prefix === 'weap' ? 6 : 64) ? 'pity-yellow' : 'pity-red'
            : '';
      badgeHTML = `<span class="pity-count ${cls}" style="line-height: 1;">${pity === 'FREE' ? 'FREE' : `${pity} / ${prefix === 'weap' ? 8 : 80}`}</span>`;
    }
  }

  const url = icon(prefix, p.itemId);
  return tight(`${blockHeader}<li class="pull-item rarity-${p.rarity}-item ${p.isRateUpItem ? 'is-rate-up-item' : ''}" ${clickable ? 'data-action="luck"' : ''}>
    <div class="pull-item-top" style="gap: 12px;">
      <span class="pull-name">
        ${url ? `<img src="${url}" class="char-icon" loading="lazy" data-fallback alt="">` : ''}
        <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(p.name)}</span>
          <span class="banner-pull-num">#${p.pullNum}</span>
          ${rateUpTag || newTag ? `<div style="display: flex; gap: 6px; margin-left: 8px; flex-shrink: 0;">${rateUpTag}${newTag}</div>` : ''}
        </div>
      </span>${badgeHTML}
    </div>
    <div class="extra-drawer">${timeStr ? `<div class="timestamp-content">${timeStr}</div>` : ''}${luckHTML}</div>
  </li>`);
}

function bannerBox(v: ViewBanner): string {
  const prefix = v.prefix;
  const info = v.summary.info;
  let pityHTML = '';
  if (prefix === 'weap') pityHTML = weaponPity(v);
  else if (v.summary.category === 'chartered') pityHTML = createPityRulerChartered(v);
  else if (v.isActive) pityHTML = otherCharPity(v);

  const lastBlock = { n: null as number | 'FREE' | null };
  const pullsHTML = v.allPulls.slice().reverse().map((p) => pullItem(v, p, lastBlock)).join('');

  let ruHTML = '';
  let ruBtn = '';
  if (info) {
    const joint = v.summary.category === 'joint';
    const ruText = joint && info.rateUpIds.length > 1 ? `${info.rateUpIds.length} RATE-UPS` : info.rateUpNames.join(', ') || 'Unknown Item';
    ruHTML = `<div class="banner-rate-up ${v.hasPulledRateUp ? 'won' : 'lost'}">RATE-UP: <span>${esc(ruText)}${v.hasPulledRateUp ? ' <span style="color: var(--color-green); margin-left: 4px;">&#10004;</span>' : ''}</span></div>`;
    ruBtn = `<button class="filter-btn" data-filter="RU" data-action="filter">RATE-UP</button>`;
  }

  const art = bannerArtUrl(v.summary.poolId);
  const header = art
    ? `<div class="banner-hero"><img src="${art}" class="banner-img" loading="lazy" crossorigin="anonymous" data-fallback data-tint="${v.domId}" data-banner-art alt=""><div class="banner-hero-vignette"></div><div class="banner-hero-content"><h3>${esc(v.name)}</h3>${ruHTML}</div></div>
       <template data-fallback-for="${v.domId}"><h3>${esc(v.name)}</h3>${ruHTML}${fallbackBannerHtml(v)}</template>`
    : `<h3>${esc(v.name)}</h3>${ruHTML}${fallbackBannerHtml(v)}`;

  return `<div class="banner-box reveal-on-scroll${art ? '' : ' warm-tint'}" id="${v.domId}"><div class="banner-header-top-box">${header}${pityHTML}${tight(`
      <div class="banner-stats-row">
        <div class="banner-stats">TOTAL_PULLS: ${v.totalPulls}</div>
        <div class="banner-filters" id="filters-${v.domId}">${ruBtn}<button class="filter-btn active" data-filter="6" data-action="filter">6★</button><button class="filter-btn" data-filter="5" data-action="filter">5★</button><button class="filter-btn" data-filter="4" data-action="filter">4★</button></div>
      </div>
    </div>
    <div class="pull-list-container" id="list-${v.domId}">
      <ul class="pull-list">${pullsHTML}</ul>
      <div class="empty-filter-msg" style="display: none; text-align: center; color: var(--text-dim); font-family: monospace; margin-top: 30px; font-size: 12px; font-style: italic;">NO PULLS TO DISPLAY</div>
    </div>
    <button class="banner-expand-area" data-action="expand">▼ EXPAND ▼</button>
  </div>`)}`;
}

export function renderBanners(kind: Kind, vm: ViewModel): string {
  return vm[kind].map(bannerBox).join('');
}

export function renderOverviews(a: Analysis): Record<Kind, string> {
  return { char: renderOverview('char', a.char), weap: renderOverview('weap', a.weap) };
}
