import type { TimelineBucket } from '../domain/patches';
import { escape, fmtInt, html, raw, type Html } from './html';

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

const tipRow = (label: string, value: string, color?: string) =>
  `<div class="t-row"><span>${color ? `<i style="background:${color}"></i>` : ''}${escape(label)}</span><b>${escape(value)}</b></div>`;
const tip = (title: string, rows: string[]) =>
  `<div class="t-title">${escape(title)}</div>${rows.join('')}`;

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
        `<circle cx="${x0 + bw / 2}" cy="${y(total) - 9}" r="4" fill="var(--r6)" stroke="var(--surface)" stroke-width="2"/>`,
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
// Tooltip host
// ---------------------------------------------------------------------------

export function installTooltips(): void {
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.hidden = true;
  el.setAttribute('role', 'tooltip');
  document.body.append(el);
  let current: Element | null = null;

  const place = (e: PointerEvent) => {
    const pad = 14;
    const r = el.getBoundingClientRect();
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    if (left + r.width > innerWidth - 8) left = e.clientX - r.width - pad;
    if (top + r.height > innerHeight - 8) top = e.clientY - r.height - pad;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  };

  document.addEventListener('pointermove', (e) => {
    const target = (e.target as Element | null)?.closest?.('[data-tip]') ?? null;
    if (target !== current) {
      current?.classList.remove('hovered');
      current = target;
      if (!target) {
        el.hidden = true;
        return;
      }
      el.innerHTML = target.getAttribute('data-tip') ?? '';
      el.hidden = false;
    }
    if (current) place(e);
  });
  document.addEventListener('scroll', () => (el.hidden = true), { passive: true });
}
