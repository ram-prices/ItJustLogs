import { addedArt, linkArtOf, removedArt, sourceSite } from '../../domain/artMeta';
import { fetchXMedia, parseXPost, pickVariant, VIDEO_WARN_BYTES, XPostError, xPostUrl, type XMedia } from '../../domain/xpost';
import { artChanged, state, updateSettings } from '../../state';
import { deleteArt, loadArt, saveArt } from '../../store';
import { icon } from '../components';
import { html, raw, render, type Html } from '../html';

/**
 * Art the player adds to an operator's page: pictures they upload or paste a
 * link to (the picture is downloaded once and kept, so a dead link doesn't
 * matter later). An X post's link downloads its pictures, videos or GIFs
 * (domain/xpost.ts); videos and GIFs play in the art box's viewer. Every saved link is
 * kept as the item's source (`settings.artSources`), and a link that can't be
 * downloaded can be kept as a link only (`settings.artLinks`). They live in IndexedDB and, with Google Drive sync on, in
 * Drive too (ui/sync.ts). A picture can be the page's banner (where several
 * are, one is picked at random each time the page opens); everything else is
 * kept in the art box (artBox) to look at. Places other than the banner were
 * dropped (domain/artMeta.ts withoutRetiredPlaces).
 */

export type ArtPlace = 'banner';
export const ART_PLACES: { place: ArtPlace; label: string; hint: string }[] = [{ place: 'banner', label: 'Banner', hint: 'Across the top of the page' }];

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
  /** A video (or an X GIF, which is an MP4): shown with <video>, never as the banner. */
  video?: boolean;
}

/** The link a picture was saved from, if any (uploads and older pictures have none). */
export const sourceOf = (key: string): string | undefined => state.settings.artSources?.[key];

/** A picture's media element: a still image, or a silent looping video. */
const media = (a: Art, cls = '', extra = ''): Html =>
  a.video
    ? html`<video class="${cls}" src="${a.src}" muted loop playsinline preload="metadata" ${raw(extra)}></video>`
    : html`<img class="${cls}" src="${a.src}" alt="" decoding="async" />`;

/** A small link back to where an item came from. */
const sourceLink = (url: string | undefined): Html =>
  url ? html`<a class="art-source label-12" href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${icon('open_in_new')}${sourceSite(url) || 'Source'}</a>` : html``;

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
    loaded.set(opId, list.map(({ key, blob }) => ({ id: key, src: URL.createObjectURL(blob), ...(blob.type.startsWith('video/') ? { video: true } : {}) })));
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
export const artIn = (opId: string, place: ArtPlace, redraw: () => void): Art[] =>
  artOf(opId, redraw).filter((a) => placesOf(a.id).includes(place) && !a.video);

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
  ART_PLACES.some(({ place }) => artIn(opId, place, redraw).length > 1);

/** A new random pick for every place, never the one showing. */
export function shuffleArt(opId: string, redraw: () => void): void {
  for (const { place } of ART_PLACES) {
    const k = `${opId}:${place}`;
    const rest = artIn(opId, place, redraw).filter((a) => a.id !== picks.get(k));
    if (rest.length) picks.set(k, rest[Math.floor(Math.random() * rest.length)].id);
  }
}

/**
 * One thing kept in an operator's art box. Art (pictures, videos and GIFs)
 * and links for now; other kinds (notes, runs) slot in as more variants, each
 * with a tile (`itemTile`).
 */
type BoxItem = { kind: 'art'; art: Art } | { kind: 'link'; key: string; url: string };

/** What a tile says under its thumbnail. */
const itemLabel = (i: BoxItem): string =>
  i.kind === 'link'
    ? `Link · ${sourceSite(i.url)}`
    : [i.art.video ? 'Video' : 'Picture', !i.art.video && placesOf(i.art.id).includes('banner') ? 'Banner' : ''].filter(Boolean).join(' · ');

function itemTile(opId: string, i: BoxItem): Html {
  if (i.kind === 'link')
    return html`<a class="wiki-art-item" href="${i.url}" target="_blank" rel="noopener noreferrer" title="${i.url}">
      <span class="wiki-art-link">${icon('link')}</span>
      <span class="copy-13 secondary">${itemLabel(i)}</span>
    </a>`;
  return html`<button type="button" class="wiki-art-item" data-action="art-view" data-op="${opId}" data-art="${i.art.id}" title="${i.art.video ? 'Play' : 'View'}">
    <span class="wiki-art-thumb">${media(i.art)}${i.art.video ? html`<span class="wiki-art-play">${icon('play_arrow')}</span>` : ''}</span>
    <span class="copy-13 secondary">${itemLabel(i)}</span>
  </button>`;
}

/**
 * The operator's art box, in Pull history (info.ts ownedSection): everything
 * the player keeps for this operator. A picture or video opens in a viewer
 * (openArtViewer), a link in a new tab; the button opens the art dialog to
 * add, remove or set the banner.
 */
export function artBox(opId: string, name: string, redraw: () => void): Html {
  const items: BoxItem[] = [
    ...artOf(opId, redraw).map((art): BoxItem => ({ kind: 'art', art })),
    ...linkArtOf(state.settings, opId).map((l): BoxItem => ({ kind: 'link', key: l.key, url: l.url })),
  ];
  return html`<div class="card wiki-art-box">
    <div class="metric-label"><span>Art</span>${items.length ? html`<span class="label-13 secondary">${items.length}</span>` : ''}</div>
    ${items.length
      ? html`<div class="wiki-art-list">${items.map((i) => itemTile(opId, i))}</div>`
      : html`<p class="copy-13 secondary">No art saved for ${name} yet.</p>`}
    <button type="button" class="btn secondary sm" data-action="art-manage" data-op="${opId}" data-name="${name}">${icon('image')}${items.length ? 'Edit art' : 'Add art'}</button>
  </div>`;
}

/** Shows one picture full size, or plays a video with its controls; a click outside, the close button or Escape closes it. */
export function openArtViewer(opId: string, key: string): void {
  const a = loaded.get(opId)?.find((x) => x.id === key);
  if (!a) return;
  const box = document.createElement('div');
  box.className = 'dialog-backdrop art-viewer';
  render(
    box,
    html`<div class="art-viewer-frame" role="dialog" aria-modal="true" aria-label="${a.video ? 'Video' : 'Picture'}">
      ${a.video ? html`<video src="${a.src}" controls autoplay loop playsinline></video>` : html`<img src="${a.src}" alt="" decoding="async" />`}
      <button type="button" class="art-viewer-close" data-close aria-label="Close">${icon('close')}</button>
      ${sourceLink(sourceOf(a.id))}
    </div>`,
  );
  const close = () => {
    box.querySelector('video')?.pause();
    box.remove();
  };
  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === box || t.closest('[data-close]')) close();
  });
  box.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.body.append(box);
  box.querySelector<HTMLElement>('[data-close]')!.focus();
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

/** Saves a picture (shrunk) or a video (as it is), with the link it came from. */
async function add(opId: string, blob: Blob, source?: string): Promise<void> {
  const video = blob.type.startsWith('video/');
  const key = await saveArt(opId, video ? blob : await shrink(blob));
  const change = addedArt(state.settings, key, { source, places: video ? [] : undefined });
  if (Object.keys(change).length) updateSettings(change);
}

/** Keeps a link that couldn't be downloaded, as a link only. */
function addLink(opId: string, url: string): void {
  const key = `art:${opId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  updateSettings(addedArt(state.settings, key, { source: url, linkOnly: true }));
}

/** Downloads one of an X post's files: a picture, or the chosen MP4 of a video or GIF. */
async function downloadX(m: XMedia): Promise<Blob> {
  if (m.type === 'photo') return download(m.url);
  let res: Response;
  try {
    res = await fetch(pickVariant(m).url, { mode: 'cors', referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error("Couldn't download that video.");
  }
  if (!res.ok) throw new Error(`Couldn't download that video (X said ${res.status}).`);
  const blob = await res.blob();
  return blob.type.startsWith('video/') ? blob : new Blob([blob], { type: 'video/mp4' });
}

const MB = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`;

async function remove(opId: string, key: string): Promise<void> {
  await deleteArt(key);
  // Remembered so sync removes it from Drive and the player's other devices too.
  updateSettings(removedArt(state.settings, key));
  forgetLoadedArt(opId);
}

/** An X post being saved: its media, which ones are ticked. */
interface XPick {
  source: string;
  media: XMedia[];
  chosen: Set<number>;
}

/**
 * A banner picture only moves along the axis it overflows: one wider than
 * the header can slide left–right, one taller up–down. Turns off the other
 * slider (or both, for a picture of the header's exact shape), once the
 * thumbnail has loaded and the header's size is known.
 */
function lockSliders(root: HTMLElement): void {
  const hero = document.querySelector<HTMLElement>('.wiki-hero');
  const bw = hero?.clientWidth || 1200;
  const bh = hero?.clientHeight || 224;
  for (const box of root.querySelectorAll<HTMLElement>('.art-pos')) {
    const img = box.closest('.art-item')?.querySelector<HTMLImageElement>('.art-thumb img');
    if (!img) continue;
    const apply = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const pic = img.naturalWidth / img.naturalHeight;
      const banner = bw / bh;
      const canX = pic > banner * 1.01;
      const canY = pic < banner * 0.99;
      for (const input of box.querySelectorAll<HTMLInputElement>('input[data-axis]')) {
        const can = input.dataset.axis === '0' ? canX : canY;
        input.disabled = !can;
        input.title = can ? '' : input.dataset.axis === '0' ? 'This picture already fits the banner from side to side' : 'This picture already fits the banner from top to bottom';
      }
    };
    if (img.complete) apply();
    else img.addEventListener('load', apply, { once: true });
  }
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
  /** A link that couldn't be downloaded, offered as a link only. */
  let offer = '';
  let pick: XPick | null = null;

  /** The X post's media to choose from, with a size warning for big videos. */
  const picker = (p: XPick): Html => {
    const big = [...p.chosen].some((i) => pickVariant(p.media[i]).big);
    return html`<div class="art-pick">
      <p class="copy-13 secondary">${p.media.length > 1 ? 'Pick what to save from this post.' : 'Save this from the post?'}</p>
      <div class="art-grid">
        ${p.media.map((m, i) => {
          const size = m.type === 'photo' ? undefined : pickVariant(m).bytes;
          return html`<label class="art-pick-item">
            <div class="art-thumb">
              ${m.thumb ? html`<img src="${m.thumb}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}
              ${m.type !== 'photo' ? html`<span class="art-kind">${m.type === 'gif' ? 'GIF' : 'Video'}${size ? ` · ${MB(size)}` : ''}</span>` : ''}
              <input type="checkbox" data-pick="${i}" ${raw(p.chosen.has(i) ? 'checked' : '')} aria-label="Save this" />
            </div>
          </label>`;
        })}
      </div>
      ${big ? html`<p class="copy-13 art-warn">Videos over ${MB(VIDEO_WARN_BYTES)} slow sync and fill your Google Drive.</p>` : ''}
      <div class="art-pick-actions">
        <button type="button" class="btn primary sm" data-pick-save ${raw(p.chosen.size && !busy ? '' : 'disabled')}>${big ? 'Save anyway' : 'Save'}</button>
        <button type="button" class="btn secondary sm" data-offer-save="${p.source}" ${raw(busy ? 'disabled' : '')}>Save link only</button>
        <button type="button" class="btn tertiary sm" data-pick-cancel>Cancel</button>
      </div>
    </div>`;
  };

  const paint = () => {
    const all = artOf(opId, () => paint());
    const links = linkArtOf(state.settings, opId);
    render(
      backdrop,
      html`<div class="card dialog art-dialog" role="dialog" aria-modal="true" aria-labelledby="art-title">
        <h2 class="heading-20" id="art-title">Art for ${name}</h2>
        <p class="copy-13 secondary">Pick which pictures can be the banner; with several, one is picked at random each time the page opens. Everything is kept in this browser, and in Google Drive when sync is on.</p>
        ${all.length || links.length
          ? html`<div class="art-grid">
              ${all.map(
                (a) => html`<figure class="art-item">
                  <div class="art-thumb">
                    ${a.video ? media(a) : html`<img src="${a.src}" alt="" loading="lazy" decoding="async" />`}
                    ${a.video ? html`<span class="art-kind">Video</span>` : ''}
                    <button type="button" class="art-remove" data-art-remove="${a.id}" aria-label="Remove this picture" title="Remove">${icon('close')}</button>
                  </div>
                  <figcaption class="art-places" role="group" aria-label="Where it shows">
                    ${ART_PLACES.map(({ place, label, hint }) =>
                      a.video
                        ? ''
                        : html`<button type="button" class="art-place" data-art-place="${a.id}" data-place="${place}" aria-pressed="${String(placesOf(a.id).includes(place))}" title="${hint}">${label}</button>`,
                    )}
                    ${sourceLink(sourceOf(a.id))}
                  </figcaption>
                  ${!a.video && placesOf(a.id).includes('banner') ? positionControls(a.id) : ''}
                </figure>`,
              )}
              ${links.map(
                (l) => html`<figure class="art-item">
                  <div class="art-thumb art-thumb-link">
                    ${icon('link')}
                    <span class="art-kind">Link</span>
                    <button type="button" class="art-remove" data-art-remove="${l.key}" aria-label="Remove this link" title="Remove">${icon('close')}</button>
                  </div>
                  <figcaption class="art-places">${sourceLink(l.url)}</figcaption>
                </figure>`,
              )}
            </div>`
          : html`<p class="art-empty copy-13 tertiary">No art yet.</p>`}
        <form class="art-add" data-art-form>
          <input type="url" name="url" placeholder="Paste an image or X post link (https://…)" aria-label="Image or X post link" ${busy ? 'disabled' : ''} />
          <button type="submit" class="btn secondary sm" ${busy ? 'disabled' : ''}>Add</button>
        </form>
        ${pick ? picker(pick) : ''}
        ${error ? html`<p class="copy-13 art-error" role="alert">${error}</p>` : ''}
        ${offer && !pick ? html`<div class="art-pick-actions"><button type="button" class="btn secondary sm" data-offer-save="${offer}" ${raw(busy ? 'disabled' : '')}>${icon('link')}Save link only</button></div>` : ''}
        <div class="dialog-actions">
          <label class="btn secondary sm art-upload${busy ? ' busy' : ''}">${icon('upload_file')}${busy || 'Upload pictures'}<input type="file" accept="image/*" multiple hidden data-art-files /></label>
          <button class="btn primary sm" data-choice="done">Done</button>
        </div>
      </div>`,
    );
    lockSliders(backdrop);
  };

  /** Runs one change with the dialog busy, then refreshes it, the page and sync. */
  const run = async (label: string, fn: () => Promise<string | void>) => {
    busy = label;
    error = '';
    offer = '';
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
    const link = t.closest<HTMLElement>('[data-offer-save]')?.dataset.offerSave;
    if (link && !busy) {
      pick = null;
      void run('Saving…', async () => addLink(opId, link));
    }
    if (t.closest('[data-pick-cancel]')) {
      pick = null;
      paint();
    }
    if (t.closest('[data-pick-save]') && pick && !busy) {
      const p = pick;
      void run('Downloading…', async () => {
        let failed = 0;
        for (const i of [...p.chosen].sort((x, y) => x - y)) {
          try {
            await add(opId, await downloadX(p.media[i]), p.source);
          } catch {
            failed++;
          }
        }
        pick = null;
        if (failed) {
          offer = p.source;
          return failed === p.chosen.size ? "Couldn't download that post's media." : `Couldn't download ${failed} of them.`;
        }
      });
    }
  });
  backdrop.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem('url') as HTMLInputElement;
    const url = webUrl(input.value);
    if (!url) {
      error = 'That isn’t a web address. Paste a link that starts with https://.';
      return paint();
    }
    pick = null;
    const post = parseXPost(url);
    if (!post) {
      void run('Downloading…', async () => {
        try {
          await add(opId, await download(url), url);
        } catch (e) {
          offer = url;
          return (e as Error).message;
        }
        input.value = '';
      });
      return;
    }
    const source = xPostUrl(post);
    void run('Looking up the post…', async () => {
      let found: XMedia[];
      try {
        found = await fetchXMedia(post);
      } catch (e) {
        offer = source;
        return e instanceof XPostError ? e.message : "Couldn't read that post.";
      }
      if (!found.length) {
        offer = source;
        return 'That post has no pictures or videos.';
      }
      input.value = '';
      // One picture or a small video: saved straight away; otherwise the player picks.
      if (found.length === 1 && !pickVariant(found[0]).big) {
        try {
          await add(opId, await downloadX(found[0]), source);
        } catch (e) {
          offer = source;
          return (e as Error).message;
        }
        return;
      }
      pick = { source, media: found, chosen: new Set(found.map((_, i) => i)) };
    });
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
    if (input.matches('[data-pick]') && pick) {
      const i = Number(input.dataset.pick);
      if (input.checked) pick.chosen.add(i);
      else pick.chosen.delete(i);
      return paint();
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
