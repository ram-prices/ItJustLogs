import { holdFocus } from './dialog';

/**
 * Banner cards as pictures: right-click or long-press a card → "Copy banner card" ("Share banner card" on phones).
 * The card is drawn as it looks on screen (html-to-image, loaded only when
 * used) at twice the screen's resolution, on the page's background so its
 * translucent panels look the same as on the site.
 *
 * Copying an image needs the async Clipboard API. Where that's refused (some
 * phone browsers, Firefox before 127), the share sheet opens instead (it has
 * a Copy action on phones). As a last resort, on a phone the picture opens in
 * a dialog, where holding it brings up the browser's own image menu (Firefox
 * for Android allows neither: no images on the clipboard, no files to share);
 * elsewhere the PNG is downloaded.
 *
 * Phones only allow the clipboard and the share sheet during the tap itself,
 * and drawing the card takes a moment: so the long-press menu starts drawing
 * it as it opens (`prepareCardImage`) and only offers it once it's
 * ready, so the tap never waits. When it ends up shown or saved, `why` says
 * what the browser refused.
 */

/** Controls (Expand), menus and toasts don't belong in the picture. */
const skip = (node: Node) => !(node instanceof Element && node.matches('.ctx-menu, .toast, [data-action="expand-card"]'));

/**
 * The picture is an SVG image, which sees none of the page's stylesheets: the
 * web fonts (Jost, Geist Mono, Material Symbols) must travel inside it as
 * data: URLs, or text falls back to a generic font and icons show their
 * ligature names. html-to-image can't do that itself here: the Google Fonts
 * stylesheets are cross-origin (their rules can't be read), and its fallback
 * fetches every font it finds. So: the @font-face rules of every stylesheet
 * (fetched once when unreadable), kept only for the families the card uses
 * and the unicode-ranges its text needs, each font file fetched once a visit.
 * Needs fonts.googleapis.com and fonts.gstatic.com in the CSP's connect-src.
 */
const sheetText = new Map<string, Promise<string>>();
const fontData = new Map<string, Promise<string>>();

function fetchOnce(cache: Map<string, Promise<string>>, url: string, read: (r: Response) => Promise<string>): Promise<string> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return read(r);
    });
    p.catch(() => cache.delete(url)); // try again next time
    cache.set(url, p);
  }
  return p;
}

const asDataUrl = (r: Response) =>
  r.blob().then(
    (b) =>
      new Promise<string>((ok, fail) => {
        const fr = new FileReader();
        fr.onload = () => ok(fr.result as string);
        fr.onerror = () => fail(fr.error);
        fr.readAsDataURL(b);
      }),
  );

/** Every @font-face rule on the page, as text, with the URL its own url()s are relative to. */
async function fontFaces(): Promise<{ css: string; base: string }[]> {
  const out: { css: string; base: string }[] = [];
  const pending: Promise<void>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const base = sheet.href ?? location.href;
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // cross-origin: read the file itself
    }
    if (rules) {
      for (const r of Array.from(rules)) if (r instanceof CSSFontFaceRule) out.push({ css: r.cssText, base });
    } else if (sheet.href) {
      pending.push(
        fetchOnce(sheetText, sheet.href, (r) => r.text()).then(
          (text) => {
            for (const css of text.replace(/\/\*[\s\S]*?\*\//g, '').match(/@font-face\s*\{[^}]*\}/g) ?? []) out.push({ css, base });
          },
          () => {},
        ),
      );
    }
  }
  await Promise.all(pending);
  return out;
}

const firstFamily = (css: string) => /font-family:\s*([^;}]+)/.exec(css)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';

/** Whether any of the code points falls in a unicode-range (no range: every one). */
function needed(css: string, codes: Set<number>): boolean {
  const range = /unicode-range:\s*([^;}]+)/.exec(css)?.[1];
  if (!range) return true;
  const spans = range.split(',').map((s) => {
    const [a, b] = s.trim().replace(/^U\+/i, '').split('-');
    if (a.includes('?')) return [parseInt(a.replace(/\?/g, '0'), 16), parseInt(a.replace(/\?/g, 'F'), 16)];
    return [parseInt(a, 16), parseInt(b ?? a, 16)];
  });
  for (const c of codes) if (spans.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  return false;
}

/** The @font-face CSS the card needs, its fonts inlined. */
async function fontEmbedCss(el: HTMLElement): Promise<string> {
  const families = new Set<string>();
  for (const n of [el, ...Array.from(el.querySelectorAll('*'))]) {
    for (const f of getComputedStyle(n).fontFamily.split(',')) families.add(f.trim().replace(/^["']|["']$/g, ''));
  }
  const codes = new Set<number>();
  for (const ch of el.textContent ?? '') codes.add(ch.codePointAt(0)!);
  for (const ch of 'abcdefghijklmnopqrstuvwxyz0123456789_') codes.add(ch.codePointAt(0)!); // icon ligatures
  const faces = (await fontFaces()).filter(({ css }) => families.has(firstFamily(css)) && needed(css, codes));
  const inlined = await Promise.all(
    faces.map(async ({ css, base }) => {
      let text = css;
      for (const [whole, raw] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (raw.startsWith('data:')) continue;
        try {
          text = text.replace(whole, `url("${await fetchOnce(fontData, new URL(raw, base).href, asDataUrl)}")`);
        } catch {
          return ''; // that font stays out; the rest still draw
        }
      }
      return text;
    }),
  );
  return inlined.filter(Boolean).join('\n');
}

/**
 * html-to-image copies each element's computed style onto its copy, except
 * inside an <svg>, which it copies whole: fills, strokes and text styles set by
 * classes or CSS variables would be lost (black boxes, black text). So for the
 * drawing those are written onto the SVG's own elements, and put back after.
 */
const SVG_PROPS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'opacity', 'visibility', 'display', 'color', 'stop-color', 'stop-opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variation-settings', 'letter-spacing', 'text-anchor',
  'dominant-baseline', 'transform', 'transform-origin', 'transform-box', 'mix-blend-mode', 'filter',
] as const;

function inlineSvgStyles(el: HTMLElement): () => void {
  const saved: [Element, string | null][] = [];
  for (const node of Array.from(el.querySelectorAll('svg *'))) {
    if (!(node instanceof SVGElement)) continue;
    const cs = getComputedStyle(node);
    const values = SVG_PROPS.map((p) => [p, cs.getPropertyValue(p)] as const);
    saved.push([node, node.getAttribute('style')]);
    for (const [p, v] of values) if (v) node.style.setProperty(p, v);
  }
  return () => {
    for (const [node, style] of saved) {
      if (style === null) node.removeAttribute('style');
      else node.setAttribute('style', style);
    }
  };
}

/**
 * A closed banner card is a fixed height on the page, with its pull list
 * scrolling inside; when the list is shorter, the rest is empty card. The
 * picture stops at the list's end instead (a longer list is cut where the
 * page cuts it). An open card leaves out the Collapse button's room.
 */
function contentHeight(el: HTMLElement): number | undefined {
  const scroll = el.querySelector<HTMLElement>('.banner-scroll');
  if (!scroll) return undefined;
  if (el.classList.contains('expanded')) {
    const button = el.querySelector<HTMLElement>('[data-action="expand-card"]')?.offsetHeight ?? 0;
    return button ? el.offsetHeight - button : undefined;
  }
  const box = scroll.getBoundingClientRect();
  let bottom = box.top + parseFloat(getComputedStyle(scroll).paddingTop);
  for (const child of Array.from(scroll.children)) {
    bottom = Math.max(bottom, child.getBoundingClientRect().bottom + parseFloat(getComputedStyle(child).marginBottom));
  }
  bottom += parseFloat(getComputedStyle(scroll).paddingBottom);
  const spare = Math.floor(box.bottom - bottom);
  return spare > 0 ? el.offsetHeight - spare : undefined;
}

/**
 * The card as a PNG: at rest (no hover glow or lift) and with square corners,
 * which `.capturing` sets while it's drawn.
 */
async function render(el: HTMLElement): Promise<Blob> {
  const [{ toBlob }, fonts] = await Promise.all([import('html-to-image'), fontEmbedCss(el).catch(() => '')]);
  el.classList.add('capturing');
  const restore = inlineSvgStyles(el);
  try {
    const blob = await toBlob(el, {
      pixelRatio: Math.max(2, devicePixelRatio),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: skip,
      height: contentHeight(el),
      fontEmbedCSS: fonts,
    });
    if (!blob) throw new Error("Couldn't draw the card.");
    return blob;
  } finally {
    restore();
    el.classList.remove('capturing');
  }
}

/** What happened to the picture, and, when it was shown or saved, what the browser refused. */
export interface CardImageResult {
  done: 'copied' | 'shared' | 'shown' | 'saved';
  why?: string;
}

/** A card's picture being drawn, and the picture once it's done. */
export interface PreparedImage {
  promise: Promise<Blob>;
  blob: Blob | null;
}

/** Starts drawing the card now, so a later tap has it ready. */
export function prepareCardImage(el: HTMLElement): PreparedImage {
  const prepared: PreparedImage = { promise: render(el), blob: null };
  prepared.promise.then(
    (b) => (prepared.blob = b),
    () => {},
  );
  return prepared;
}

/**
 * Copies the card's picture, else shares it, else saves or shows it. With
 * `share` (phones) the share sheet comes first and the clipboard second.
 */
export async function copyCardImage(el: HTMLElement, name: string, prepared: PreparedImage = prepareCardImage(el), share = false): Promise<CardImageResult> {
  const refused: string[] = [];
  const reason = (what: string, e: unknown) => refused.push(`${what}: ${(e as Error)?.name ?? 'Error'}${(e as Error)?.message ? ` (${(e as Error).message})` : ''}`);
  const fileName = `${name.replace(/[^\w\- ]+/g, '').trim() || 'banner'}.png`;
  // Both need the tap: no waiting before them when the picture is ready.
  const shareIt = async (): Promise<CardImageResult | null> => {
    const file = new File([prepared.blob ?? (await prepared.promise)], fileName, { type: 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) {
      refused.push('share: files not supported');
      return null;
    }
    try {
      await navigator.share({ files: [file] });
      return { done: 'shared' };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return { done: 'shared' }; // closed the share sheet
      reason('share', e);
      return null;
    }
  };
  if (share) {
    const r = await shareIt();
    if (r) return r;
  }
  // The clipboard only works during the tap: hand it the picture now, ready
  // or still being drawn (Safari accepts a promise of it).
  try {
    if (!navigator.clipboard?.write) throw new Error('no clipboard.write');
    if (typeof ClipboardItem === 'undefined') throw new Error('no ClipboardItem');
    if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports('image/png')) throw new Error('image/png not supported');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': prepared.blob ?? prepared.promise })]);
    return { done: 'copied' };
  } catch (e) {
    reason('clipboard', e); // fall back to sharing or saving it
  }
  if (!share) {
    const r = await shareIt();
    if (r) return r;
  }
  const file = new File([prepared.blob ?? (await prepared.promise)], fileName, { type: 'image/png' });
  const url = URL.createObjectURL(file);
  const save = () => Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  if (matchMedia('(pointer: coarse)').matches) {
    showImage(url, save);
    return { done: 'shown', why: refused.join('; ') };
  }
  save();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { done: 'saved', why: refused.join('; ') };
}

/** The picture in a dialog: holding it opens the browser's own image menu (share, save, copy where it has one). */
function showImage(url: string, save: () => void) {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.innerHTML = `<div class="card dialog image-dialog" role="dialog" aria-modal="true" aria-label="Banner image">
    <img alt="Banner card" />
    <p class="copy-14 secondary">This browser doesn't let sites copy pictures. Press and hold it to share or save it.</p>
    <div class="dialog-actions">
      <button class="btn secondary sm" data-choice="save">Download</button>
      <button class="btn primary sm" data-choice="close">Close</button>
    </div>
  </div>`;
  backdrop.querySelector('img')!.src = url;
  let release = () => {};
  const close = () => {
    backdrop.remove();
    URL.revokeObjectURL(url);
    release();
  };
  backdrop.addEventListener('click', (e) => {
    const choice = (e.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
    if (choice === 'save') save();
    if (choice === 'close' || e.target === backdrop) close();
  });
  document.body.append(backdrop);
  release = holdFocus(backdrop, close, backdrop.querySelector<HTMLElement>('[data-choice="close"]'));
}
