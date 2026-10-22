import { mirrorUrl } from '../domain/banners';

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
      } else if (img.closest<HTMLElement>('.issue-art[data-flat]')) {
        // An Issue banner whose layers don't exist yet: its flat art instead.
        const layers = img.closest<HTMLElement>('.issue-art')!;
        const flat = document.createElement('img');
        flat.src = layers.dataset.flat!;
        flat.alt = '';
        flat.crossOrigin = 'anonymous';
        flat.setAttribute('data-fallback', '');
        layers.replaceWith(flat);
      } else if (img.dataset.alt) {
        // e.g. banner art that doesn't exist yet: show the rate-up weapon instead.
        const alt = img.dataset.alt;
        delete img.dataset.alt;
        delete img.dataset.retried;
        img.classList.add('weapon');
        img.src = alt;
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

