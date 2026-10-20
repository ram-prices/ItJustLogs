/**
 * Runs work for an element only once it's near the screen: banner cards
 * work out their colour and whether their list needs Expand as you scroll
 * to them, not all at once on every render.
 */

/** How far outside the screen counts as near, in px. */
const MARGIN = 800;

const pending = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function obs(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer!.unobserve(e.target);
        const fn = pending.get(e.target);
        pending.delete(e.target);
        fn?.();
      }
    },
    { rootMargin: `${MARGIN}px 0px` },
  );
  return observer;
}

/**
 * Calls `fn` now if `el` is on or near the screen (so what's visible never
 * flickers), else when it scrolls near. Calling again for the same element
 * replaces the earlier `fn`.
 */
export function whenNear(el: Element, fn: () => void): void {
  const r = el.getBoundingClientRect();
  if (r.bottom >= -MARGIN && r.top <= innerHeight + MARGIN) {
    pending.delete(el);
    observer?.unobserve(el);
    fn();
    return;
  }
  pending.set(el, fn);
  obs().observe(el);
}
