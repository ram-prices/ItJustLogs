/**
 * The operator header's pinned picture fades out as the page scrolls, gone
 * once it has moved 60% of the header's height (the pinned picture's own). Browsers with scroll-linked CSS animations do
 * it in CSS (database.css `pin-fade`); this does the same for the others
 * (Firefox), once per frame while the page scrolls. Not with reduced motion,
 * where the picture isn't held in place.
 */
export function installHeroFade(): void {
  if (CSS.supports('animation-timeline: scroll()')) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  const update = () => {
    frame = 0;
    const pin = document.querySelector<HTMLElement>('.wiki-hero.has-art .wiki-hero-pin');
    if (!pin) return;
    pin.style.opacity = still.matches ? '' : String(Math.max(0, 1 - scrollY / (pin.offsetHeight * 0.6)));
  };
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  addEventListener('scroll', soon, { passive: true });
  addEventListener('resize', soon);
  still.addEventListener('change', soon);
  // A new page (or a redraw) brings a fresh picture at full opacity.
  new MutationObserver(soon).observe(document.getElementById('app') ?? document.body, { childList: true, subtree: true });
}
