import { artChanged, state, updateSettings } from '../../state';
import { deleteArt, loadArt, saveArt } from '../../store';
import { icon } from '../components';
import { html, render, type Html } from '../html';

/**
 * Art the player adds to an operator's page: pictures they upload or paste a
 * link to (the picture is downloaded once and kept, so a dead link doesn't
 * matter later). They live in IndexedDB and, with Google Drive sync on, in
 * Drive too (ui/sync.ts). Each picture shows in the places the player picks
 * (banner, character picture, page background, slideshow); where several
 * share a place, one is picked at random each time the page opens.
 */

export type ArtPlace = 'banner' | 'portrait' | 'background' | 'slideshow';
export const ART_PLACES: { place: ArtPlace; label: string; hint: string }[] = [
  { place: 'banner', label: 'Banner', hint: 'Across the top of the page' },
  { place: 'portrait', label: 'Picture', hint: "In place of the operator's portrait" },
  { place: 'background', label: 'Background', hint: 'Faded behind the whole page' },
  { place: 'slideshow', label: 'Slideshow', hint: 'In the Gallery slideshow' },
];

/** Where a picture shows (new pictures: the banner). */
export const placesOf = (key: string): ArtPlace[] => (state.settings.artPlaces?.[key] as ArtPlace[] | undefined) ?? ['banner'];

/** Where a banner picture sits until moved: centred, a little above the middle (faces usually are). */
const BANNER_POS: [number, number] = [50, 30];

/** A banner picture's focus, x and y in %. */
export const positionOf = (key: string): [number, number] => state.settings.artPos?.[key] ?? BANNER_POS;

function setPosition(key: string, pos: [number, number]): void {
  const all = { ...state.settings.artPos };
  if (pos[0] === BANNER_POS[0] && pos[1] === BANNER_POS[1]) delete all[key];
  else all[key] = pos;
  updateSettings({ artPos: all });
}

function togglePlace(key: string, place: ArtPlace): void {
  const now = placesOf(key);
  const next = now.includes(place) ? now.filter((p) => p !== place) : [...now, place];
  updateSettings({ artPlaces: { ...state.settings.artPlaces, [key]: next } });
}

export interface Art {
  /** Its IndexedDB key (art:<operator id>:<id>). */
  id: string;
  src: string;
}

/** Each operator's pictures as object URLs, loaded once (and again after a change). */
const loaded = new Map<string, Art[]>();
/** Operators whose pictures are loading, with everything to redraw when they're in. */
const loading = new Map<string, Set<() => void>>();
/** The art each operator's page shows until it's opened again (or shuffled). */
const picks = new Map<string, string>();

/** A fresh random pick next time each page opens. */
export const resetArtPick = (): void => picks.clear();

export function artOf(opId: string, redraw: () => void): Art[] {
  const have = loaded.get(opId);
  if (have) return have;
  const waiting = loading.get(opId);
  if (waiting) {
    waiting.add(redraw);
    return [];
  }
  loading.set(opId, new Set([redraw]));
  void loadArt(opId).then((list) => {
    loaded.set(opId, list.map(({ key, blob }) => ({ id: key, src: URL.createObjectURL(blob) })));
    const fns = loading.get(opId) ?? new Set();
    loading.delete(opId);
    fns.forEach((fn) => fn());
  });
  return [];
}

/** Forget what's loaded (for one operator, or all after a sync), so it loads again. */
export function forgetLoadedArt(opId?: string): void {
  for (const [id, list] of loaded) {
    if (opId && id !== opId) continue;
    list.forEach((a) => URL.revokeObjectURL(a.src));
    loaded.delete(id);
  }
}

/** The operator's pictures that show in `place`. */
export const artIn = (opId: string, place: ArtPlace, redraw: () => void): Art[] => artOf(opId, redraw).filter((a) => placesOf(a.id).includes(place));

/** The picture `place` shows: a random one, kept until the page opens again or Shuffle is pressed. */
export function currentArt(opId: string, place: ArtPlace, redraw: () => void): Art | null {
  const all = artIn(opId, place, redraw);
  if (!all.length) return null;
  const k = `${opId}:${place}`;
  let id = picks.get(k);
  if (!id || !all.some((a) => a.id === id)) {
    id = all[Math.floor(Math.random() * all.length)].id;
    picks.set(k, id);
  }
  return all.find((a) => a.id === id)!;
}

/** Whether Shuffle would change anything: some place has more than one picture. */
export const canShuffle = (opId: string, redraw: () => void): boolean =>
  ART_PLACES.some(({ place }) => place !== 'slideshow' && artIn(opId, place, redraw).length > 1);

/** A new random pick for every place, never the one showing. */
export function shuffleArt(opId: string, redraw: () => void): void {
  for (const { place } of ART_PLACES) {
    const k = `${opId}:${place}`;
    const rest = artIn(opId, place, redraw).filter((a) => a.id !== picks.get(k));
    if (rest.length) picks.set(k, rest[Math.floor(Math.random() * rest.length)].id);
  }
}

/**
 * The Gallery: the operator's slideshow pictures, crossfading every few
 * seconds (paused while hovered), with back and next buttons.
 */
export function gallerySection(opId: string, redraw: () => void): Html {
  const all = artIn(opId, 'slideshow', redraw);
  if (!all.length) return html``;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Gallery</h2><span class="label-13 secondary">${all.length} ${all.length === 1 ? 'picture' : 'pictures'}</span></div>
    <div class="card art-slideshow" data-slideshow>
      ${all.map((a, i) => html`<img class="art-slide${i === 0 ? ' on' : ''}" src="${a.src}" alt="" decoding="async" />`)}
      ${all.length > 1
        ? html`<button type="button" class="art-slide-nav prev" data-slide="-1" aria-label="Previous picture">${icon('chevron_right')}</button>
            <button type="button" class="art-slide-nav next" data-slide="1" aria-label="Next picture">${icon('chevron_right')}</button>
            <span class="art-slide-count label-12">1 / ${all.length}</span>`
        : ''}
    </div>
  </section>`;
}

function step(show: HTMLElement, by: number): void {
  const slides = [...show.querySelectorAll<HTMLElement>('.art-slide')];
  if (slides.length < 2) return;
  const at = Math.max(0, slides.findIndex((s) => s.classList.contains('on')));
  const next = (at + by + slides.length) % slides.length;
  slides[at].classList.remove('on');
  slides[next].classList.add('on');
  show.querySelector('.art-slide-count')?.replaceChildren(`${next + 1} / ${slides.length}`);
}

/** Back/next buttons and the timer for every slideshow on the page. */
export function installSlideshows(): void {
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-slide]');
    const show = b?.closest<HTMLElement>('[data-slideshow]');
    if (b && show) step(show, Number(b.dataset.slide));
  });
  setInterval(() => {
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const show of document.querySelectorAll<HTMLElement>('[data-slideshow]:not(:hover)')) step(show, 1);
  }, 6000);
}

// ---------------------------------------------------------------------------
// Adding and removing
// ---------------------------------------------------------------------------

/** Pictures are shrunk to this long side and saved as WebP, so dozens stay small. */
const MAX_SIDE = 2560;

async function shrink(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  // Small enough already: keep the original (and any animation).
  if (scale === 1 && file.size < 1_500_000) {
    bmp.close();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("Couldn't read that picture."))), 'image/webp', 0.86));
}

/** A web address, or null if it isn't one. */
function webUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Downloads the picture a link points to. Only works where the site allows
 * other sites to fetch its images (most image hosts and CDNs do; some, like
 * Pixiv, don't, and there's no server here to fetch it for us).
 */
async function download(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error("That site doesn't let other sites download its pictures. Save the picture and upload it instead.");
  }
  if (!res.ok) throw new Error(`Couldn't download that picture (the site said ${res.status}).`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error("That link isn't a picture. Copy the image's own address (right-click the image › Copy image address).");
  return blob;
}

async function add(opId: string, blob: Blob): Promise<void> {
  await saveArt(opId, await shrink(blob));
}

async function remove(opId: string, key: string): Promise<void> {
  await deleteArt(key);
  // Remembered so sync removes it from Drive and the player's other devices too.
  const { [key]: _, ...places } = state.settings.artPlaces ?? {};
  const { [key]: __, ...pos } = state.settings.artPos ?? {};
  updateSettings({ deletedArt: [...(state.settings.deletedArt ?? []), key], artPlaces: places, artPos: pos });
  forgetLoadedArt(opId);
}

/** Sliders that move which part of a banner picture the header shows (left–right, up–down). */
function positionControls(key: string): Html {
  const [x, y] = positionOf(key);
  return html`<div class="art-pos" title="Move the banner picture">
    <label><span>Left–right</span><input type="range" min="0" max="100" value="${x}" data-art-pos="${key}" data-axis="0" aria-label="Banner left to right" /></label>
    <label><span>Up–down</span><input type="range" min="0" max="100" value="${y}" data-art-pos="${key}" data-axis="1" aria-label="Banner up to down" /></label>
  </div>`;
}

/**
 * The art dialog: what's there (remove any), upload pictures or paste a link.
 * Changes apply at once; `redraw` updates the page behind it.
 */
export function openArtManager(opId: string, name: string, redraw: () => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  let error = '';
  let busy = '';

  const paint = () => {
    const all = artOf(opId, () => paint());
    render(
      backdrop,
      html`<div class="card dialog art-dialog" role="dialog" aria-modal="true" aria-labelledby="art-title">
        <h2 class="heading-20" id="art-title">Art for ${name}</h2>
        <p class="copy-13 secondary">Pick where each picture shows. Where several share a spot, one is picked at random each time the page opens. Pictures are kept in this browser, and in Google Drive when sync is on.</p>
        ${all.length
          ? html`<div class="art-grid">
              ${all.map(
                (a) => html`<figure class="art-item">
                  <div class="art-thumb">
                    <img src="${a.src}" alt="" loading="lazy" decoding="async" />
                    <button type="button" class="art-remove" data-art-remove="${a.id}" aria-label="Remove this picture" title="Remove">${icon('close')}</button>
                  </div>
                  <figcaption class="art-places" role="group" aria-label="Where it shows">
                    ${ART_PLACES.map(
                      ({ place, label, hint }) =>
                        html`<button type="button" class="art-place" data-art-place="${a.id}" data-place="${place}" aria-pressed="${String(placesOf(a.id).includes(place))}" title="${hint}">${label}</button>`,
                    )}
                  </figcaption>
                  ${placesOf(a.id).includes('banner') ? positionControls(a.id) : ''}
                </figure>`,
              )}
            </div>`
          : html`<p class="art-empty copy-13 tertiary">No art yet.</p>`}
        <form class="art-add" data-art-form>
          <input type="url" name="url" placeholder="Paste an image link (https://…)" aria-label="Image link" ${busy ? 'disabled' : ''} />
          <button type="submit" class="btn secondary sm" ${busy ? 'disabled' : ''}>Add</button>
        </form>
        ${error ? html`<p class="copy-13 art-error" role="alert">${error}</p>` : ''}
        <div class="dialog-actions">
          <label class="btn secondary sm art-upload${busy ? ' busy' : ''}">${icon('upload_file')}${busy || 'Upload pictures'}<input type="file" accept="image/*" multiple hidden data-art-files /></label>
          <button class="btn primary sm" data-choice="done">Done</button>
        </div>
      </div>`,
    );
  };

  /** Runs one change with the dialog busy, then refreshes it, the page and sync. */
  const run = async (label: string, fn: () => Promise<string | void>) => {
    busy = label;
    error = '';
    paint();
    try {
      error = (await fn()) || '';
    } catch (e) {
      error = (e as Error).message;
    }
    busy = '';
    forgetLoadedArt(opId);
    paint();
    redraw();
    artChanged();
  };

  backdrop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === backdrop || t.closest('[data-choice="done"]')) return backdrop.remove();
    const place = t.closest<HTMLElement>('[data-art-place]');
    if (place) {
      togglePlace(place.dataset.artPlace!, place.dataset.place as ArtPlace);
      paint();
      return redraw();
    }
    const key = t.closest<HTMLElement>('[data-art-remove]')?.dataset.artRemove;
    if (key && !busy) void run('Removing…', () => remove(opId, key));
  });
  backdrop.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('url') as HTMLInputElement;
    const url = webUrl(input.value);
    if (!url) {
      error = 'That isn’t a web address. Paste a link that starts with https://.';
      return paint();
    }
    void run('Downloading…', async () => add(opId, await download(url)));
  });
  // Moving a banner slider shows it live behind the dialog; letting go saves it.
  const posFrom = (input: HTMLInputElement): [number, number] => {
    const key = input.dataset.artPos!;
    const pos = [...positionOf(key)] as [number, number];
    pos[Number(input.dataset.axis)] = Number(input.value);
    return pos;
  };
  backdrop.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('[data-art-pos]')) return;
    const img = document.querySelector<HTMLElement>(`.wiki-hero-art[data-art="${CSS.escape(input.dataset.artPos!)}"]`);
    const [x, y] = posFrom(input);
    if (img) img.style.objectPosition = `${x}% ${y}%`;
  });
  backdrop.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.matches('[data-art-pos]')) {
      setPosition(input.dataset.artPos!, posFrom(input));
      return redraw();
    }
    if (!input.matches('[data-art-files]') || !input.files?.length) return;
    const files = [...input.files];
    void run('Saving…', async () => {
      let failed = 0;
      for (const f of files) {
        try {
          await add(opId, f);
        } catch {
          failed++;
        }
      }
      if (failed) return failed === files.length ? "Couldn't save those pictures." : `Couldn't save ${failed} of them.`;
    });
  });
  backdrop.addEventListener('keydown', (e) => e.key === 'Escape' && backdrop.remove());

  paint();
  document.body.append(backdrop);
  backdrop.querySelector<HTMLElement>('[data-choice="done"]')?.focus();
}
