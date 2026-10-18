import { cdnFallback, itemIconUrl } from '../domain/banners';
import type { Kind, Outcome } from '../domain/types';
import { html, type Html } from './html';

/** Item portrait; a broken image retries once via jsDelivr, then hides (see installImageFallback). */
export function itemIcon(kind: Kind, itemId: string, name: string, cls = 'icon'): Html {
  const src = itemIconUrl(kind, itemId);
  if (!src) return html`<span class="${cls} missing"></span>`;
  return html`<img class="${cls}" src="${src}" alt="${name}" loading="lazy" decoding="async" data-fallback />`;
}

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

const OUTCOME: Record<Outcome, { cls: string; glyph: string; label: string }> = {
  won: { cls: 'mark-won', glyph: '✓', label: 'Won the rate-up' },
  lost: { cls: 'mark-lost', glyph: '✕', label: 'Lost the rate-up' },
  guaranteed: { cls: 'mark-guaranteed', glyph: 'G', label: 'Guaranteed rate-up' },
};

export function outcomeMark(o: Outcome | undefined): Html {
  if (!o) return html``;
  const m = OUTCOME[o];
  return html`<span class="mark ${m.cls}" title="${m.label}" aria-label="${m.label}">${m.glyph}</span>`;
}

/** low / mid / high relative to a pity cap. */
export function heat(value: number, max: number): 'low' | 'mid' | 'high' {
  const r = value / max;
  return r < 0.5 ? 'low' : r <= 0.8 ? 'mid' : 'high';
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

export const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
};
