/**
 * The operator header's pinned picture fades out as the page scrolls, gone
 * once it has moved 60% of the header's height (the pinned picture's own). Browsers with scroll-linked CSS animations do
 * that in CSS (database.css `pin-fade`); this does the same for the others,
 * once per frame while the page scrolls. Not with reduced motion, where the
 * picture isn't held in place.
 *
 * All browsers: once the picture has faded, `.pin-gone` on the header stops
 * drawing it and takes the blur off the page's cards, which then have only
 * the plain page behind them, so nothing changes on screen (docs/ui.md).
 */
/** Past the end of the fade, so a quick scroll back up can't catch it unfaded. */
const SLACK = 48;

export function installHeroFade(): void {
  const scripted = !CSS.supports('animation-timeline: scroll()');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  const update = () => {
    frame = 0;
    const hero = document.querySelector<HTMLElement>('.wiki-hero.has-art');
    const pin = hero?.querySelector<HTMLElement>('.wiki-hero-pin');
    if (!hero || !pin) return;
    const fadeEnd = pin.offsetHeight * 0.6;
    if (scripted) {
      const opacity = still.matches ? '' : String(Math.max(0, 1 - scrollY / fadeEnd));
      if (pin.style.opacity !== opacity) pin.style.opacity = opacity;
    }
    hero.classList.toggle('pin-gone', !still.matches && scrollY >= fadeEnd + SLACK);
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
