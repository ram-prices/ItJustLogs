import { cdnFallback } from '../domain/banners';

export function installImageFallback(): void {
  document.addEventListener(
    'error',
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-fallback')) return;
      const next = !img.dataset.retried && cdnFallback(img.src);
      if (next) {
        img.dataset.retried = '1';
        img.src = next;
      } else {
        img.classList.add('missing');
        img.dispatchEvent(new CustomEvent('img-missing', { bubbles: true }));
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

