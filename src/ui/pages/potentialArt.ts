import { EF_ASSETS_CDN } from '../../domain/banners';
import { artChoiceOf, bannerShown, potentialPictures, withArtChoice, type BannerShown, type PotentialArtIndex, type PotentialPicture } from '../../domain/potentialArt';
import { state, updateSettings } from '../../state';
import { icon, itemImg } from '../components';
import { html, render, type Html } from '../html';
import { currentArt, type Art } from './art';
import { wikiFile } from './info';

/**
 * The operator page's banner art (domain/potentialArt.ts): by default the
 * player's own banner picture (art.ts, placed in Banner), else the highest
 * Potential's picture they own; or what they pick in the hero's Banner
 * pop-up: Custom, Base or any Potential's, locked ones included.
 */

export const potentialArtUrl = (file: string): string => `${EF_ASSETS_CDN}/operators/potential/${file}`;

const indexOf = (redraw: () => void): PotentialArtIndex | null =>
  wikiFile<PotentialArtIndex>('index.json', redraw, 'operators/potential').data;

export interface HeroPotentialArt {
  list: PotentialPicture[];
  /** The player's own banner picture, if any. */
  custom: Art | null;
  /** What the banner shows. */
  shown: BannerShown;
}

/** `potential`: the player's (−1 without a copy). */
export function heroPotentialArt(opId: string, potential: number, redraw: () => void): HeroPotentialArt {
  const list = potentialPictures(indexOf(redraw), opId);
  const custom = currentArt(opId, 'banner', redraw);
  return { list, custom, shown: bannerShown(list, artChoiceOf(state.settings, opId), potential, !!custom) };
}

const labelOf = (b: BannerShown): string => (b.kind === 'custom' ? 'Custom' : b.kind === 'potential' ? `P${b.picture.level}` : 'Base');

/** The hero's button: what the banner shows. */
export const potentialArtButton = (opId: string, potential: number, art: HeroPotentialArt): Html =>
  html`<button type="button" class="btn secondary sm" data-action="potential-art" data-op="${opId}" data-pot="${potential}" title="Banner art" aria-haspopup="dialog">${icon('wallpaper')}<span>${labelOf(art.shown)}</span></button>`;

export function openPotentialArtPicker(anchor: HTMLElement, opId: string, potential: number): void {
  document.querySelector('.pot-art-pop')?.remove();
  const list = potentialPictures(indexOf(() => {}), opId);
  const custom = currentArt(opId, 'banner', () => {});
  const choice = artChoiceOf(state.settings, opId);
  const auto = bannerShown(list, 'auto', potential, !!custom);
  const pop = document.createElement('div');
  pop.className = 'card pot-art-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Banner art');

  const thumb = (b: BannerShown): Html =>
    b.kind === 'custom' && custom
      ? html`<img src="${custom.src}" alt="" decoding="async" />`
      : b.kind === 'potential'
        ? html`<img src="${potentialArtUrl(b.picture.file)}" alt="" decoding="async" />`
        : itemImg('char', opId, 'pot-art-base');
  const tile = (key: string, label: string, p: BannerShown, locked = false): Html =>
    html`<button type="button" class="pot-art-tile${key === choice ? ' on' : ''}${locked ? ' locked' : ''}" data-pick="${key}" aria-pressed="${key === choice}">
      <span class="pot-art-thumb">${thumb(p)}</span>
      <span class="label-13">${locked ? icon('lock') : ''}${label}</span>
    </button>`;
  render(
    pop,
    html`<h2 class="heading-16">Banner art</h2>
      <div class="pot-art-grid">
        ${tile('auto', `Auto · ${labelOf(auto)}`, auto)}
        ${custom ? tile('custom', 'Custom', { kind: 'custom' }) : ''}
        ${tile('base', 'Base', { kind: 'base' })}
        ${list.map((p) => tile(p.key, `P${p.level}`, { kind: 'potential', picture: p }, p.level > potential))}
      </div>`,
  );
  document.body.append(pop);

  const close = () => {
    pop.remove();
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (!pop.contains(t) && !anchor.contains(t)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      anchor.focus();
    }
  });
  pop.addEventListener('click', (e) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
    if (!key) return;
    close();
    updateSettings({ potentialArt: withArtChoice(state.settings.potentialArt, opId, key) });
  });

  // Under the button, kept on screen.
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(a.right - w, innerWidth - w - 8))}px`;
  pop.style.top = `${a.bottom + 6}px`;
  pop.querySelector<HTMLElement>('.pot-art-tile.on')?.focus();
}
