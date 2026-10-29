import { removedArt, sourceSite } from '../../domain/artMeta';
import { itemKey, itemsOf, newestFirst, removedItem, savedItem, type StoredItem } from '../../domain/storage';
import { artChanged, state, updateSettings } from '../../state';
import { deleteArt, loadArt, saveArt } from '../../store';
import { icon } from '../components';
import { html, render, type Html } from '../html';

/**
 * The operator page's storage: what the player keeps for each operator, like
 * a small drive. Files are kept exactly as uploaded (IndexedDB, and one Google
 * Drive file each with sync on, ui/sync.ts), their names and the notes and
 * links in settings (domain/storage.ts). Nothing is fetched from links.
 * Pictures and videos open in a viewer; a picture can be the page's banner
 * (where several are, one is picked at random each time the page opens).
 * Items saved before have their link in `settings.artSources`.
 */

export type ArtPlace = 'banner';
export const ART_PLACES: { place: ArtPlace; label: string; hint: string }[] = [{ place: 'banner', label: 'Banner', hint: 'Across the top of the page' }];

/** Where a picture shows. Pictures saved before the storage box have no entry and are banner pictures; new uploads start with none. */
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

/** A stored file, loaded as an object URL. */
export interface Art {
  /** Its IndexedDB key (art:<operator id>:<id>). */
  id: string;
  src: string;
  /** How it shows: a picture (can be the banner), a video, or any other file (downloaded). */
  type: 'image' | 'video' | 'file';
  size: number;
  mime: string;
}

const typeOf = (mime: string): Art['type'] => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'file');

/** The link an item was saved from, if any (only items saved before the storage box have one). */
export const sourceOf = (key: string): string | undefined => state.settings.artSources?.[key];

/** A file's name: the one it was uploaded with, else one made from its type. */
function nameOf(a: Art): string {
  const item = state.settings.storeItems?.[a.id];
  if (item?.kind === 'file') return item.name;
  const ext = a.mime.split('/')[1]?.split(/[+;]/)[0] || 'bin';
  return `${a.type === 'image' ? 'picture' : a.type === 'video' ? 'video' : 'file'}.${ext}`;
}

const sizeText = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A picture or video's media element: a still image, or a silent looping video. */
const media = (a: Art): Html =>
  a.type === 'video'
    ? html`<video src="${a.src}" muted loop playsinline preload="metadata"></video>`
    : html`<img src="${a.src}" alt="" decoding="async" />`;

/** A small link back to where an item came from. */
const sourceLink = (url: string | undefined): Html =>
  url ? html`<a class="art-source label-12" href="${url}" target="_blank" rel="noopener noreferrer" title="${url}">${icon('open_in_new')}${sourceSite(url) || 'Source'}</a>` : html``;

/** Each operator's files as object URLs, loaded once (and again after a change). */
const loaded = new Map<string, Art[]>();
/** Operators whose files are loading, with everything to redraw when they're in. */
const loading = new Map<string, Set<() => void>>();
/** The banner picture each operator's page shows until it's opened again (or shuffled). */
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
    loaded.set(
      opId,
      list.map(({ key, blob }) => ({ id: key, src: URL.createObjectURL(blob), type: typeOf(blob.type), size: blob.size, mime: blob.type })),
    );
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
  artOf(opId, redraw).filter((a) => a.type === 'image' && placesOf(a.id).includes(place));

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

// ---------------------------------------------------------------------------
// The storage box
// ---------------------------------------------------------------------------

/**
 * One thing in an operator's storage box: a file, a note or a link. Another
 * kind (runs, say) is one more variant here, with a tile in `entryTile` and,
 * if editable, an editor.
 */
type Entry = { kind: 'file'; key: string; art: Art } | { kind: 'note'; key: string; text: string } | { kind: 'link'; key: string; url: string; title?: string };

/** The box's one open editor: a new note or link, or one being edited, with what's typed so far. */
let editing: { opId: string; key: string; kind: 'note' | 'link'; isNew: boolean; text: string; url: string; title: string } | null = null;
/** The operator whose Add menu is open. */
let adding: string | null = null;
/** An item whose Delete was pressed once (a second press deletes it). */
let deleting: string | null = null;
/** Files being saved, by operator (shown as a line in the box). */
const saving = new Map<string, number>();
/** The page's redraw, for keys pressed in an editor and files picked. */
let lastRedraw: (() => void) | null = null;

const entriesOf = (opId: string, redraw: () => void): Entry[] =>
  newestFirst([
    ...artOf(opId, redraw).map((art): Entry => ({ kind: 'file', key: art.id, art })),
    ...itemsOf(state.settings, opId).flatMap(({ key, item }): Entry[] =>
      item.kind === 'note' ? [{ kind: 'note', key, text: item.text }] : item.kind === 'link' ? [{ kind: 'link', key, url: item.url, title: item.title }] : [],
    ),
  ]);

/** Delete, pressed twice. */
const deleteButton = (key: string): Html =>
  html`<button type="button" class="btn sm ${deleting === key ? 'error' : 'tertiary icon-only'}" data-action="store-delete" data-key="${key}" title="Delete" aria-label="Delete">${icon('delete')}${deleting === key ? 'Delete?' : ''}</button>`;

/** Edit and Delete for a note or link. */
const itemActions = (key: string): Html => html`<span class="store-actions">
  <button type="button" class="btn tertiary sm icon-only" data-action="store-edit" data-key="${key}" title="Edit" aria-label="Edit">${icon('edit')}</button>
  ${deleteButton(key)}
</span>`;

function entryTile(opId: string, e: Entry): Html {
  if (editing && editing.key === e.key) return editor();
  if (e.kind === 'note')
    return html`<div class="store-row store-note">
      <p class="copy-14 store-note-text">${e.text}</p>
      ${itemActions(e.key)}
    </div>`;
  if (e.kind === 'link')
    return html`<div class="store-row store-link">
      <a class="store-link-main" href="${e.url}" target="_blank" rel="noopener noreferrer" title="${e.url}">
        ${icon('link')}<span class="min0"><span class="copy-14 ellipsis store-link-title">${e.title || sourceSite(e.url) || e.url}</span><span class="label-12 tertiary ellipsis">${e.url}</span></span>
      </a>
      ${itemActions(e.key)}
    </div>`;
  const a = e.art;
  if (a.type === 'file')
    return html`<div class="store-row store-file">
      <a class="store-link-main" href="${a.src}" download="${nameOf(a)}" title="Download">
        ${icon('description')}<span class="min0"><span class="copy-14 ellipsis store-link-title">${nameOf(a)}</span><span class="label-12 tertiary">${sizeText(a.size)}</span></span>
      </a>
      <span class="store-actions">
        <a class="btn tertiary sm icon-only" href="${a.src}" download="${nameOf(a)}" title="Download" aria-label="Download">${icon('download')}</a>
        ${deleteButton(e.key)}
      </span>
    </div>`;
  const banner = a.type === 'image' && placesOf(a.id).includes('banner');
  return html`<button type="button" class="wiki-art-item" data-action="art-view" data-op="${opId}" data-art="${a.id}" title="${nameOf(a)}">
    <span class="wiki-art-thumb">${media(a)}${a.type === 'video' ? html`<span class="wiki-art-play">${icon('play_arrow')}</span>` : ''}</span>
    <span class="copy-13 secondary ellipsis">${banner ? 'Banner' : nameOf(a)}</span>
  </button>`;
}

/** A note or link being written, in the tile's own place and shape. */
function editor(): Html {
  const ed = editing!;
  const actions = html`<span class="store-edit-actions">
    <button type="button" class="btn primary sm" data-action="store-save">Save</button>
    <button type="button" class="btn tertiary sm" data-action="store-cancel">Cancel</button>
  </span>`;
  return ed.kind === 'note'
    ? html`<div class="store-row store-note store-edit">
        <textarea class="copy-14 store-note-text" data-store-field="text" rows="4" placeholder="Note" aria-label="Note">${ed.text}</textarea>
        ${actions}
      </div>`
    : html`<div class="store-row store-link store-edit">
        <span class="store-link-fields">
          <input type="url" class="copy-14" data-store-field="url" value="${ed.url}" placeholder="https://…" aria-label="Link" />
          <input type="text" class="copy-14" data-store-field="title" value="${ed.title}" placeholder="Title (optional)" aria-label="Title" />
        </span>
        ${actions}
      </div>`;
}

/**
 * The operator's storage box, in Pull history (info.ts ownedSection): files,
 * notes and links, newest first. Pictures and videos open in the viewer,
 * other files download; notes and links are edited in place. Add offers a
 * note, a link or files.
 */
export function storageBox(opId: string, name: string, redraw: () => void): Html {
  lastRedraw = redraw;
  const entries = entriesOf(opId, redraw);
  const open = editing?.opId === opId ? editing : null;
  const busy = saving.get(opId);
  return html`<div class="card wiki-art-box" data-store-op="${opId}">
    <div class="metric-label"><span>Storage</span>
      <span class="store-head">
        ${entries.length ? html`<span class="label-13 secondary">${entries.length}</span>` : ''}
        <button type="button" class="btn secondary sm" data-action="store-add" data-op="${opId}" aria-expanded="${String(adding === opId)}">${icon('add')}Add</button>
      </span>
    </div>
    ${adding === opId
      ? html`<div class="store-add" role="group" aria-label="Add">
          <button type="button" class="btn secondary sm" data-action="store-new" data-op="${opId}" data-kind="note">${icon('description')}Note</button>
          <button type="button" class="btn secondary sm" data-action="store-new" data-op="${opId}" data-kind="link">${icon('link')}Link</button>
          <label class="btn secondary sm">${icon('upload_file')}Files<input type="file" multiple hidden data-store-files="${opId}" /></label>
        </div>`
      : ''}
    ${busy ? html`<p class="copy-13 secondary">Saving ${busy} ${busy === 1 ? 'file' : 'files'}…</p>` : ''}
    ${open?.isNew ? editor() : ''}
    ${entries.length
      ? html`<div class="wiki-art-list">${entries.map((e) => entryTile(opId, e))}</div>`
      : open?.isNew || busy
        ? ''
        : html`<p class="copy-13 secondary">Nothing kept for ${name} yet.</p>`}
  </div>`;
}

const focusEditor = () => setTimeout(() => document.querySelector<HTMLElement>('.store-edit [data-store-field]')?.focus());

/** A web address, or null if it isn't one. */
function webUrl(text: string): string | null {
  try {
    const u = new URL(text.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function saveEditing(redraw: () => void): void {
  const ed = editing;
  if (!ed) return;
  const item: StoredItem = ed.kind === 'note' ? { kind: 'note', text: ed.text } : { kind: 'link', url: ed.url, title: ed.title };
  if (item.kind === 'link' && !webUrl(item.url)) return;
  updateSettings(savedItem(state.settings, ed.key, item));
  editing = null;
  redraw();
}

/** Saves picked files as they are, with their names; pictures aren't banner pictures until the player says so. */
export async function saveFiles(opId: string, files: File[], redraw: () => void): Promise<void> {
  saving.set(opId, (saving.get(opId) ?? 0) + files.length);
  redraw();
  for (const f of files) {
    try {
      const key = await saveArt(opId, f);
      updateSettings({ ...savedItem(state.settings, key, { kind: 'file', name: f.name || 'file', size: f.size }), artPlaces: { ...state.settings.artPlaces, [key]: [] } });
    } catch {
      /* a file the browser couldn't store: skipped */
    }
    saving.set(opId, (saving.get(opId) ?? 1) - 1);
  }
  saving.delete(opId);
  forgetLoadedArt(opId);
  redraw();
  artChanged();
}

/** Deletes a file: the file, everything about it, and a tombstone so sync removes it elsewhere too. */
async function removeFile(opId: string, key: string): Promise<void> {
  await deleteArt(key);
  updateSettings({ ...removedArt(state.settings, key), ...removedItem(state.settings, key) });
  forgetLoadedArt(opId);
}

/** The storage box's buttons (app.ts hands every `store-*` action here). */
export function storageAction(el: HTMLElement, redraw: () => void): void {
  const action = el.dataset.action;
  const key = el.dataset.key;
  if (action !== 'store-delete') deleting = null;
  if (action === 'store-add') {
    adding = adding === el.dataset.op ? null : el.dataset.op!;
  } else if (action === 'store-open') {
    // The header's Art button: the box's Add menu, scrolled into view.
    adding = el.dataset.op!;
    redraw();
    document.querySelector('.wiki-art-box')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  } else if (action === 'store-new') {
    adding = null;
    const opId = el.dataset.op!;
    editing = { opId, key: itemKey(opId), kind: el.dataset.kind as 'note' | 'link', isNew: true, text: '', url: '', title: '' };
    focusEditor();
  } else if (action === 'store-edit' && key) {
    const item = state.settings.storeItems?.[key];
    if (!item || item.kind === 'file') return;
    const opId = key.split(':')[1];
    editing = item.kind === 'note' ? { opId, key, kind: 'note', isNew: false, text: item.text, url: '', title: '' } : { opId, key, kind: 'link', isNew: false, text: '', url: item.url, title: item.title ?? '' };
    focusEditor();
  } else if (action === 'store-save') {
    return saveEditing(redraw);
  } else if (action === 'store-cancel') {
    editing = null;
  } else if (action === 'store-delete' && key) {
    if (deleting !== key) deleting = key;
    else {
      deleting = null;
      if (editing?.key === key) editing = null;
      const opId = key.split(':')[1];
      if (loaded.get(opId)?.some((a) => a.id === key)) {
        void removeFile(opId, key).then(() => {
          redraw();
          artChanged();
        });
        return;
      }
      updateSettings(removedItem(state.settings, key));
    }
  }
  redraw();
}

/** Typing in an editor keeps its draft through redraws; Ctrl+Enter saves, Escape cancels; picked files are saved. */
export function installStorage(): void {
  document.addEventListener('input', (e) => {
    const field = (e.target as HTMLElement).closest<HTMLInputElement | HTMLTextAreaElement>('[data-store-field]');
    if (!field || !editing) return;
    const f = field.dataset.storeField as 'text' | 'url' | 'title';
    editing[f] = field.value;
  });
  document.addEventListener('change', (e) => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-store-files]');
    if (!input?.files?.length || !lastRedraw) return;
    adding = null;
    void saveFiles(input.dataset.storeFiles!, [...input.files], lastRedraw);
  });
  document.addEventListener('keydown', (e) => {
    if (!editing || !(e.target as HTMLElement).closest?.('[data-store-field]') || !lastRedraw) return;
    if (e.key === 'Escape') {
      editing = null;
      lastRedraw();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || editing.kind === 'link')) {
      e.preventDefault();
      saveEditing(lastRedraw);
    }
  });
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

/**
 * A banner picture only moves along the axis it overflows: one wider than the
 * header can slide left–right, one taller up–down. Turns off the other slider.
 */
function lockSliders(box: HTMLElement, img: HTMLImageElement): void {
  const hero = document.querySelector<HTMLElement>('.wiki-hero');
  const bw = hero?.clientWidth || 1200;
  const bh = hero?.clientHeight || 224;
  const apply = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const pic = img.naturalWidth / img.naturalHeight;
    const banner = bw / bh;
    for (const input of box.querySelectorAll<HTMLInputElement>('input[data-axis]')) {
      const can = input.dataset.axis === '0' ? pic > banner * 1.01 : pic < banner * 0.99;
      input.disabled = !can;
      input.title = can ? '' : input.dataset.axis === '0' ? 'This picture already fits the banner from side to side' : 'This picture already fits the banner from top to bottom';
    }
  };
  if (img.complete) apply();
  else img.addEventListener('load', apply, { once: true });
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
 * Shows a picture full size, or plays a video with its controls. A picture
 * can be made a banner picture here and moved within the banner; either can
 * be downloaded or deleted (press twice). A click outside, the close button
 * or Escape closes it.
 */
export function openArtViewer(opId: string, key: string, redraw: () => void): void {
  const a = loaded.get(opId)?.find((x) => x.id === key);
  if (!a) return;
  const box = document.createElement('div');
  box.className = 'dialog-backdrop art-viewer';
  let confirm = false;
  const paint = () => {
    const banner = a.type === 'image' && placesOf(a.id).includes('banner');
    render(
      box,
      html`<div class="art-viewer-frame" role="dialog" aria-modal="true" aria-label="${nameOf(a)}">
        ${a.type === 'video' ? html`<video src="${a.src}" controls autoplay loop playsinline></video>` : html`<img src="${a.src}" alt="" decoding="async" />`}
        <button type="button" class="art-viewer-close" data-close aria-label="Close">${icon('close')}</button>
        <div class="art-viewer-bar">
          ${a.type === 'image' ? html`<button type="button" class="btn secondary sm" data-banner aria-pressed="${String(banner)}">${icon('wallpaper')}Use as banner</button>` : ''}
          ${banner ? positionControls(a.id) : ''}
          <a class="btn secondary sm" href="${a.src}" download="${nameOf(a)}">${icon('download')}Download</a>
          <button type="button" class="btn sm ${confirm ? 'error' : 'secondary'}" data-delete>${icon('delete')}${confirm ? 'Delete?' : 'Delete'}</button>
          ${sourceLink(sourceOf(a.id))}
        </div>
      </div>`,
    );
    const img = box.querySelector<HTMLImageElement>('.art-viewer-frame > img');
    const pos = box.querySelector<HTMLElement>('.art-pos');
    if (img && pos) lockSliders(pos, img);
  };
  const close = () => {
    box.querySelector('video')?.pause();
    box.remove();
  };
  box.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === box || t.closest('[data-close]')) return close();
    if (t.closest('[data-banner]')) {
      togglePlace(a.id, 'banner');
      paint();
      return redraw();
    }
    if (t.closest('[data-delete]')) {
      if (!confirm) {
        confirm = true;
        return paint();
      }
      close();
      void removeFile(opId, a.id).then(() => {
        redraw();
        artChanged();
      });
    }
  });
  // Moving a banner slider shows it live in the header; letting go saves it.
  const posFrom = (input: HTMLInputElement): [number, number] => {
    const pos = [...positionOf(a.id)] as [number, number];
    pos[Number(input.dataset.axis)] = Number(input.value);
    return pos;
  };
  box.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('[data-art-pos]')) return;
    const [x, y] = posFrom(input);
    const hero = document.querySelector<HTMLElement>(`.wiki-hero-art[data-art="${CSS.escape(a.id)}"]`);
    if (hero) hero.style.objectPosition = `${x}% ${y}%`;
  });
  box.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (!input.matches('[data-art-pos]')) return;
    setPosition(a.id, posFrom(input));
    redraw();
  });
  box.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  paint();
  document.body.append(box);
  box.querySelector<HTMLElement>('[data-close]')!.focus();
}
