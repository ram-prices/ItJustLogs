import type { TimelineBucket } from '../domain/patches';
import { cumulative } from '../domain/pity';
import { escape, fmtInt, html, raw, type Html } from './html';
import { STAR_SVG } from './components';

/**
 * Charts are plain SVG strings. Hover targets carry a `data-tip` attribute
 * holding trusted tooltip markup; one delegated listener (installTooltips)
 * shows it, so charts survive re-renders without per-chart wiring.
 */

function niceStep(max: number, target = 4): number {
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/** Tooltip HTML helpers (values are escaped); used with a `data-tip` attribute. */
export const tipRow = (label: string, value: string, color?: string) =>
  `<div class="t-row"><span>${color ? `<i style="background:${color}"></i>` : ''}${escape(label).replaceAll('★', STAR_SVG)}</span><b>${escape(value)}</b></div>`;
/** A line of plain text in a tooltip, under the title. */
export const tipNote = (text: string) => `<div class="t-note">${escape(text)}</div>`;
/** A tooltip: a title (left out when empty), then notes (`tipNote`) and label/value rows (`tipRow`). Joined tips stack. */
export const tip = (title: string, rows: string[]) =>
  `${title ? `<div class="t-title">${escape(title)}</div>` : ''}${rows.join('')}`;

/** Rounded-top column path anchored square to the baseline. */
function column(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

// ---------------------------------------------------------------------------
// Weekly pulls: stacked columns (operators + arsenal), 6★ count above
// ---------------------------------------------------------------------------

export function weeklyChart(buckets: TimelineBucket[]): Html {
  if (!buckets.length) return html``;
  const W = 960;
  const H = 280;
  const m = { t: 22, r: 8, b: 28, l: 40 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1, ...buckets.map((b) => b.char + b.weap));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const slot = iw / buckets.length;
  const bw = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => m.t + ih - (v / top) * ih;

  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);

  const fmtWeek = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  const marks: string[] = [];
  buckets.forEach((b, i) => {
    const x0 = m.l + i * slot + (slot - bw) / 2;
    const charTop = y(b.char);
    const total = b.char + b.weap;
    // Operators at the base, arsenal stacked above with a 2px surface gap.
    if (b.char) {
      const h = y(0) - charTop;
      marks.push(`<path d="${b.weap ? `M${x0},${y(0)}V${charTop}H${x0 + bw}V${y(0)}Z` : column(x0, charTop, bw, h)}" fill="var(--op)"/>`);
    }
    if (b.weap) {
      const gap = b.char ? 2 : 0;
      const yTop = y(total);
      marks.push(`<path d="${column(x0, yTop, bw, charTop - yTop - gap)}" fill="var(--ars)"/>`);
    }
    if (b.sixStars.length) {
      marks.push(
        `<circle cx="${x0 + bw / 2}" cy="${y(total) - 9}" r="4" fill="var(--r6)" stroke="var(--background-100)" stroke-width="2"/>`,
      );
    }
    if (i % labelEvery === 0) marks.push(`<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${fmtWeek(b.start)}</text>`);

    const sixNames = b.sixStars.map((s) => s.name);
    const tipHtml = tip(`Week of ${fmtWeek(b.start)}`, [
      tipRow('Operators', fmtInt(b.char), 'var(--op)'),
      tipRow('Arsenal', fmtInt(b.weap), 'var(--ars)'),
      ...(sixNames.length ? [tipRow('6★', sixNames.join(', '), 'var(--r6)')] : []),
    ]);
    marks.push(
      `<rect class="hit" x="${m.l + i * slot}" y="${m.t}" width="${slot}" height="${ih}" data-tip="${escape(tipHtml)}"/>`,
    );
  });

  return html`<div class="chart">
    ${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pulls per week">
      <g class="grid">${ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
      ${ticks.map((t) => `<text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtInt(t)}</text>`).join('')}
      ${marks.join('')}
    </svg>`)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Chance curve: P(rate-up within n pulls), with the planned pull count marked
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tooltip host
// ---------------------------------------------------------------------------

export function installTooltips(): void {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.hidden = true;
  el.setAttribute('role', 'tooltip');
  document.body.append(el);
  let current: Element | null = null;
  const tipOf = (e: Event) => (e.target as Element | null)?.closest?.('[data-tip]') ?? null;

  // Beside the pointer, flipped to its other side near the window's edges.
  const place = (e: { clientX: number; clientY: number }) => {
    const pad = 14;
    const r = el.getBoundingClientRect();
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    if (left + r.width > innerWidth - 8) left = e.clientX - r.width - pad;
    if (top + r.height > innerHeight - 8) top = e.clientY - r.height - pad;
    el.style.left = `${Math.max(8, Math.min(left, innerWidth - r.width - 8))}px`;
    el.style.top = `${Math.max(8, top)}px`;
  };
  const show = (target: Element | null) => {
    current?.classList.remove('hovered');
    target?.classList.add('hovered');
    current = target;
    el.hidden = !target;
    if (target) el.innerHTML = target.getAttribute('data-tip') ?? '';
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const target = tipOf(e);
    if (target !== current) show(target);
    if (current) place(e);
  });
  // Touch screens have no hover: a tap opens the tip, a second tap or one elsewhere closes it.
  // Links and fields still do their own thing on a tap.
  let touch = false;
  document.addEventListener('pointerdown', (e) => (touch = e.pointerType === 'touch'), { passive: true });
  document.addEventListener('click', (e) => {
    if (!touch) return;
    const target = tipOf(e);
    const own = (e.target as Element).closest?.('a[href], input, select, textarea, label');
    if (!target || target === current || (own && target.contains(own))) return show(null);
    show(target);
    place(e);
  });
  const hide = () => show(null);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  addEventListener('resize', hide);
  document.addEventListener('contextmenu', hide);
}

/**
 * Luck curve for one rate-up pull, after the original tracker's drawer graph:
 * the chance of having the rate-up by each pull, with a marker where you
 * actually got it. Compact: no grid, just the curve, a baseline and its ends.
 */
export function luckGraph(pmf: Float64Array, at: number, unit = 1): Html {
  const cdf = cumulative(pmf);
  let end = cdf.findIndex((v) => v >= 0.999);
  if (end < 0) end = cdf.length - 1;
  end = Math.max(end, at, 10);
  const W = 320;
  const H = 72;
  const m = { t: 6, r: 6, b: 18, l: 6 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (n: number) => m.l + (n / end) * iw;
  const y = (p: number) => m.t + (1 - p) * ih;
  const pts: string[] = [];
  for (let n = 0; n <= end; n++) pts.push(`${x(n).toFixed(1)},${y(cdf[Math.min(n, cdf.length - 1)] ?? 1).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const atP = cdf[Math.min(at, cdf.length - 1)] ?? 1;
  const bands = Math.min(end, 40);
  const bw = iw / bands;
  const hits: string[] = [];
  for (let i = 0; i < bands; i++) {
    const n = Math.round(((i + 0.5) / bands) * end);
    const label = unit === 1 ? `Within ${n} pulls` : `Within ${Math.ceil(n / unit)} sets of ${unit}`;
    const tipHtml = tip(label, [tipRow('Chance', `${((cdf[Math.min(n, cdf.length - 1)] ?? 1) * 100).toFixed(1)}%`)]);
    hits.push(`<rect class="hit" x="${(m.l + i * bw).toFixed(1)}" y="${m.t}" width="${(bw + 0.5).toFixed(1)}" height="${ih}" data-tip="${escape(tipHtml)}"/>`);
  }
  return html`<div class="chart luck-graph">${raw(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${(atP * 100).toFixed(1)}% chance by pull ${at}">
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--gray-alpha-400)"/>
    <path d="${line}L${x(end)},${y(0)}L${x(0)},${y(0)}Z" fill="var(--gray-1000)" opacity="0.06"/>
    <path class="luck-line" d="${line}" pathLength="1" fill="none" stroke="var(--gray-1000)" stroke-width="2" stroke-linejoin="round"/>
    <line class="luck-mark" x1="${x(at)}" x2="${x(at)}" y1="${y(atP)}" y2="${y(0)}" stroke="var(--gray-700)" stroke-dasharray="3 3"/>
    <circle class="luck-mark" cx="${x(at)}" cy="${y(atP)}" r="4.5" fill="var(--gray-1000)" stroke="var(--background-100)" stroke-width="2"/>
    <text x="${m.l}" y="${H - 4}">0</text>
    <text x="${x(at)}" y="${H - 4}" text-anchor="middle">${Math.ceil(at / unit)}</text>
    <text x="${W - m.r}" y="${H - 4}" text-anchor="end">${Math.ceil(end / unit)}</text>
    ${hits.join('')}
  </svg>`)}</div>`;
}
