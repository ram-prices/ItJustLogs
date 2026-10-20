/**
 * Pictures shift a little against the mouse while it's over them, like the
 * banner cards' glow follows it (Settings → Backgrounds; CSS turns it off for
 * Still and reduced motion). Sets --px/--py, -1 to 1 from the hovered area's
 * centre; a page background follows the mouse over the whole window.
 *
 * The easing is done here, a step toward the mouse each frame, not with a CSS
 * transition, which would restart on every mouse move.
 */
const AREAS = '.wiki-hero, .char-card, .banner, .sched-card';
/** How much of the way to the mouse each frame covers. */
const EASE = 0.08;

interface Move {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

export function installParallax(): void {
  const moving = new Map<HTMLElement, Move>();
  let frame = 0;
  const aim = (el: HTMLElement, tx: number, ty: number) => {
    const m = moving.get(el) ?? { x: 0, y: 0, tx: 0, ty: 0 };
    m.tx = tx;
    m.ty = ty;
    moving.set(el, m);
    if (!frame) frame = requestAnimationFrame(step);
  };
  const step = () => {
    frame = 0;
    for (const [el, m] of moving) {
      m.x += (m.tx - m.x) * EASE;
      m.y += (m.ty - m.y) * EASE;
      const settled = Math.abs(m.tx - m.x) < 0.002 && Math.abs(m.ty - m.y) < 0.002;
      if ((settled && !m.tx && !m.ty) || !el.isConnected) {
        // Back at the centre (or gone): let go of it.
        el.style.removeProperty('--px');
        el.style.removeProperty('--py');
        moving.delete(el);
        continue;
      }
      el.style.setProperty('--px', m.x.toFixed(4));
      el.style.setProperty('--py', m.y.toFixed(4));
    }
    if ([...moving.values()].some((m) => Math.abs(m.tx - m.x) >= 0.002 || Math.abs(m.ty - m.y) >= 0.002)) frame = requestAnimationFrame(step);
  };
  const toward = (el: HTMLElement, x: number, y: number, r: DOMRect) => aim(el, ((x - r.left) / r.width) * 2 - 1, ((y - r.top) / r.height) * 2 - 1);

  let last: HTMLElement | null = null;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(AREAS) ?? null;
    if (last && last !== el) aim(last, 0, 0);
    last = el;
    if (el) toward(el, e.clientX, e.clientY, el.getBoundingClientRect());
    const backdrop = document.querySelector<HTMLElement>('.op-backdrop');
    if (backdrop) toward(backdrop, e.clientX, e.clientY, new DOMRect(0, 0, innerWidth, innerHeight));
  });
  document.documentElement.addEventListener('pointerleave', () => {
    if (last) aim(last, 0, 0);
    last = null;
  });
}
