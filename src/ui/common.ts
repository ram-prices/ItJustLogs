import { mirrorUrl } from '../domain/banners';

/**
 * Marks each loaded picture `.img-ready`, which ends its skeleton (components.css). A redraw's
 * pictures already in the browser's memory are marked before the page paints, so they don't flash grey.
 */
export function installImageReady(): void {
  const scan = (root: ParentNode) => {
    for (const img of root.querySelectorAll('img')) if (img.complete && img.naturalWidth) img.classList.add('img-ready');
  };
  document.addEventListener(
    'load',
    (e) => {
      if (e.target instanceof HTMLImageElement) e.target.classList.add('img-ready');
    },
    true,
  );
  new MutationObserver((changes) => {
    for (const c of changes) for (const n of c.addedNodes) if (n instanceof Element) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document);
}

export function installImageFallback(): void {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-fallback')) return;
      const next = !img.dataset.retried && mirrorUrl(img.src);
      if (next) {
        img.dataset.retried = '1';
        img.src = next;
      } else if (img.closest<HTMLElement>('.issue-art[data-flat], .op-art[data-flat]')) {
        // A banner whose layers don't exist (or failed): its flat art instead.
        const layers = img.closest<HTMLElement>('.issue-art, .op-art')!;
        const flat = document.createElement('img');
        flat.src = layers.dataset.flat!;
        flat.alt = '';
        flat.crossOrigin = 'anonymous';
        flat.setAttribute('data-fallback', '');
        layers.replaceWith(flat);
      } else if (img.dataset.alt) {
        // e.g. banner art that doesn't exist yet: show the rate-up weapon instead (or an operator card's portrait).
        const alt = img.dataset.alt;
        delete img.dataset.alt;
        delete img.dataset.retried;
        img.classList.add(img.dataset.altClass ?? 'weapon');
        img.src = alt;
      } else if (img.matches('.art-hero > .wiki-hero-art')) {
        // A page header whose art is missing: a plain header, no empty band.
        img.parentElement!.classList.remove('has-art');
        img.remove();
      } else {
        img.classList.add('missing');
      }
    },
    true,
  );
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  const t = document.createElement('div');
  t.className = `toast${kind === 'error' ? ' error' : ''}`;
  t.textContent = message;
  host.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 4000);
}

