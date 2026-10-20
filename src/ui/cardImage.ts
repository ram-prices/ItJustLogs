/**
 * Banner cards as pictures: right-click or long-press a card → "Copy image".
 * The card is drawn as it looks on screen (html-to-image, loaded only when
 * used) at twice the screen's resolution, on the page's background so its
 * translucent panels look the same as on the site.
 *
 * Copying an image needs the async Clipboard API. Where that's refused (some
 * phone browsers, Firefox before 127), the share sheet opens instead (it has
 * a Copy action on phones), and as a last resort the PNG is downloaded.
 *
 * Phones only allow the clipboard and the share sheet during the tap itself,
 * and drawing the card takes a moment: so the long-press menu starts drawing
 * it as it opens (`prepareCardImage`), and the tap on Copy image finds it
 * ready.
 */

/** Controls (Expand), menus and toasts don't belong in the picture. */
const skip = (node: Node) => !(node instanceof Element && node.matches('.ctx-menu, .toast, [data-action="expand-card"]'));

/**
 * The card as a PNG: at rest (no hover glow or lift) and with square corners,
 * which `.capturing` sets while it's drawn.
 */
export async function render(el: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image');
  el.classList.add('capturing');
  try {
    const blob = await toBlob(el, {
      pixelRatio: Math.max(2, devicePixelRatio),
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: skip,
    });
    if (!blob) throw new Error("Couldn't draw the card.");
    return blob;
  } finally {
    el.classList.remove('capturing');
  }
}

/** What happened to the picture. */
export type CardImageResult = 'copied' | 'shared' | 'saved';

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

export async function copyCardImage(el: HTMLElement, name: string, prepared: PreparedImage = prepareCardImage(el)): Promise<CardImageResult> {
  // The clipboard only works during the tap: hand it the picture now, ready
  // or still being drawn (Safari accepts a promise of it).
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('no image clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': prepared.blob ?? prepared.promise })]);
    return 'copied';
  } catch {
    /* fall back to sharing or saving it */
  }
  const file = new File([prepared.blob ?? (await prepared.promise)], `${name.replace(/[^\w\- ]+/g, '').trim() || 'banner'}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared'; // closed the share sheet
    }
  }
  const url = URL.createObjectURL(file);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}
