/**
 * Banner cards as pictures: right-click or long-press a card → "Copy image".
 * The card is drawn as it looks on screen (html-to-image, loaded only when
 * used) at twice the screen's resolution, on the page's background so its
 * translucent panels look the same as on the site.
 *
 * Copying an image needs the async Clipboard API. Where that's refused (some
 * phone browsers, Firefox before 127), the share sheet opens instead, and as
 * a last resort the PNG is downloaded.
 */

/** Controls (Expand), menus and toasts don't belong in the picture. */
const skip = (node: Node) => !(node instanceof Element && node.matches('.ctx-menu, .toast, [data-action="expand-card"]'));

/** The card as a PNG. */
export async function render(el: HTMLElement): Promise<Blob> {
  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(el, {
    pixelRatio: Math.max(2, devicePixelRatio),
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: skip,
  });
  if (!blob) throw new Error("Couldn't draw the card.");
  return blob;
}

/** What happened to the picture. */
export type CardImageResult = 'copied' | 'shared' | 'saved';

export async function copyCardImage(el: HTMLElement, name: string): Promise<CardImageResult> {
  // Safari only allows the clipboard during the tap itself: hand it the
  // ClipboardItem now, with the picture still being drawn.
  const blob = render(el);
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('no image clipboard');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    /* fall back to sharing or saving it */
  }
  const file = new File([await blob], `${name.replace(/[^\w\- ]+/g, '').trim() || 'banner'}.png`, { type: 'image/png' });
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
