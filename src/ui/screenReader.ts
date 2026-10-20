import { toast } from './common';
import { html, render } from './html';

/**
 * Reading the game's screens from a screen recording or screenshots, in this
 * browser (shared by the Achievements and Archive readers: medalReader.ts,
 * findingReader.ts). Nothing is uploaded. Tesseract.js (text recognition
 * compiled to run in the page) is loaded from jsDelivr only when someone
 * starts a read; what its words mean is up to each reader's rules in
 * domain/. This file turns files into frames, runs the recognition with a
 * progress dialog, and hands the dialog back for the review screen.
 */

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** What Tesseract.js reports for a frame: its lines and its words, each with a box. */
export interface FrameText {
  lines: { text: string; bbox: Box; words?: { text: string; bbox: Box }[] }[];
  words: { text: string; bbox: Box }[];
}
interface TesseractWorker {
  recognize(img: HTMLCanvasElement): Promise<{ data: FrameText }>;
  terminate(): Promise<void>;
}
declare global {
  interface Window {
    Tesseract?: { createWorker(lang: string): Promise<TesseractWorker> };
  }
}

function loadTesseract(): Promise<NonNullable<Window['Tesseract']>> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('The text reader did not load.')));
    s.onerror = () => reject(new Error("Couldn't load the text reader. Check your connection."));
    document.head.append(s);
  });
}

/**
 * Frames are read whole, at this height: the game sizes its text to the
 * screen's height, so any shape of screen (16:9, 16:10, ultrawide, a phone)
 * reads the same. Nothing is cut out by position; menus and pictures read as
 * stray words, which matching against the known names ignores.
 */
export const READ_HEIGHT = 1080;
/** Seconds between the frames read from a recording (unless a reader asks for another step). */
const STEP = 0.5;

function drawFrame(canvas: HTMLCanvasElement, src: CanvasImageSource, w: number, h: number): void {
  canvas.height = READ_HEIGHT;
  canvas.width = Math.round((w / h) * READ_HEIGHT);
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0, w, h, 0, 0, canvas.width, canvas.height);
}

/** A 32×18 grey thumbnail, to skip frames that barely changed (the list held still). */
function thumb(canvas: HTMLCanvasElement): Uint8ClampedArray {
  const t = document.createElement('canvas');
  t.width = 32;
  t.height = 18;
  const g = t.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, 32, 18);
  return g.getImageData(0, 0, 32, 18).data;
}
const sameish = (a: Uint8ClampedArray | null, b: Uint8ClampedArray) => {
  if (!a) return false;
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]);
  return d / (a.length / 4) < 2;
};

/** Each frame to read: each screenshot, then every STEP seconds of each recording. */
async function* frames(files: File[], canvas: HTMLCanvasElement, progress: (done: number, total: number) => void, step = STEP): AsyncGenerator<void> {
  const videos = files.filter((f) => f.type.startsWith('video/'));
  const images = files.filter((f) => f.type.startsWith('image/'));
  const metas = await Promise.all(
    videos.map(
      (f) =>
        new Promise<HTMLVideoElement>((resolve, reject) => {
          const v = document.createElement('video');
          v.muted = true;
          v.preload = 'auto';
          v.src = URL.createObjectURL(f);
          v.onloadedmetadata = () => resolve(v);
          v.onerror = () => reject(new Error(`Couldn't open ${f.name} (this browser may not play that format).`));
        }),
    ),
  );
  const total = images.length + metas.reduce((n, v) => n + Math.ceil(v.duration / step), 0);
  let done = 0;
  try {
    for (const f of images) {
      const bmp = await createImageBitmap(f);
      drawFrame(canvas, bmp, bmp.width, bmp.height);
      bmp.close();
      progress(++done, total);
      yield;
    }
    for (const v of metas) {
      for (let t = 0; t < v.duration; t += step) {
        v.currentTime = t;
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
        drawFrame(canvas, v, v.videoWidth, v.videoHeight);
        progress(++done, total);
        yield;
      }
    }
  } finally {
    for (const v of metas) URL.revokeObjectURL(v.src);
  }
}

/** Opens the file picker for recordings and screenshots. */
export function pickMedia(then: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*,image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) then(files);
  };
  input.click();
}

/** An area of a frame (at READ_HEIGHT), to read alone. */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScanOptions {
  /** Seconds between frames read from a recording. */
  step?: number;
  /**
   * Reading just one area: given a whole frame's text, where the thing to
   * read is (or null). Once found, later frames read only that area,
   * enlarged, until `onFrame` stops finding anything there a few frames in
   * a row; then whole frames again.
   */
  focus?: (text: FrameText) => Area | null;
  /** A frame that didn't change since the last one (it isn't read again). */
  onSame?: () => void;
}

/** How much a focused area is enlarged before reading (small text reads better bigger). */
const ZOOM = 2;
/** Frames in a row with nothing found in the focused area before going back to whole frames. */
const LOST_AFTER = 6;

/**
 * Reads every frame of `files` with a progress dialog titled `title`,
 * passing each frame's text to `onFrame` (which says whether it found what
 * it reads). Resolves with the dialog (to show the review screen in) and
 * the time it took, or null if the player cancelled or it failed (a toast
 * says why).
 */
export async function scan(
  files: File[],
  title: string,
  onFrame: (text: FrameText, frame: HTMLCanvasElement) => boolean | void,
  opts: ScanOptions = {},
): Promise<{ dlg: HTMLDialogElement; seconds: number } | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'card reader-dialog';
  document.body.append(dlg);
  let cancelled = false;
  dlg.addEventListener('close', () => {
    cancelled = true;
    dlg.remove();
  });
  dlg.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-reader-cancel]')) dlg.close();
  });
  const paint = (text: string, done = 0, total = 0) =>
    render(
      dlg,
      html`<div class="reader-head"><h2 class="heading-20">${title}</h2></div>
        <div class="reader-body">
          <p class="copy-14">${text}</p>
          <div class="reader-bar"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
          <p class="copy-13 secondary">Everything is read here in your browser; nothing is uploaded.</p>
        </div>
        <div class="reader-foot"><span></span><button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button></div>`,
    );
  paint('Loading the text reader…');
  dlg.showModal();

  let worker: TesseractWorker | null = null;
  try {
    worker = await (await loadTesseract()).createWorker('eng');
    const canvas = document.createElement('canvas');
    const zoomed = document.createElement('canvas');
    let area: Area | null = null;
    let misses = 0;
    let last: Uint8ClampedArray | null = null;
    const started = Date.now();
    for await (const _ of frames(files, canvas, (done, total) => paint(`Reading frame ${done} of ${total}…`, done, total), opts.step)) {
      if (cancelled) return null;
      // Read the focused area alone when there is one, else the whole frame.
      let src = canvas;
      if (area) {
        const w = Math.max(1, area.x1 - area.x0);
        const h = Math.max(1, area.y1 - area.y0);
        zoomed.width = Math.round(w * ZOOM);
        zoomed.height = Math.round(h * ZOOM);
        zoomed.getContext('2d', { willReadFrequently: true })!.drawImage(canvas, area.x0, area.y0, w, h, 0, 0, zoomed.width, zoomed.height);
        src = zoomed;
      }
      const t = thumb(src);
      if (sameish(last, t)) {
        opts.onSame?.();
        continue;
      }
      last = t;
      const text = (await worker.recognize(src)).data;
      if (!area && opts.focus) {
        const found = opts.focus(text);
        if (found) {
          area = {
            x0: Math.max(0, Math.floor(found.x0)),
            y0: Math.max(0, Math.floor(found.y0)),
            x1: Math.min(canvas.width, Math.ceil(found.x1)),
            y1: Math.min(canvas.height, Math.ceil(found.y1)),
          };
          misses = 0;
        }
      }
      const hit = onFrame(text, src);
      if (area && src === zoomed && hit === false && ++misses >= LOST_AFTER) {
        area = null;
        last = null;
      } else if (hit) misses = 0;
    }
    if (cancelled) return null;
    // A new dialog state: the review screen. Cancel closes it as before.
    cancelled = false;
    return { dlg, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (e) {
    if (!cancelled) {
      dlg.close();
      toast((e as Error).message, 'error');
    }
    return null;
  } finally {
    await worker?.terminate();
  }
}
