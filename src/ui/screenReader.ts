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
  lines: { text: string; bbox: Box }[];
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
/** Seconds between the frames read from a recording. */
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
async function* frames(files: File[], canvas: HTMLCanvasElement, progress: (done: number, total: number) => void): AsyncGenerator<void> {
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
  const total = images.length + metas.reduce((n, v) => n + Math.ceil(v.duration / STEP), 0);
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
      for (let t = 0; t < v.duration; t += STEP) {
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

/**
 * Reads every frame of `files` with a progress dialog titled `title`,
 * passing each frame's text to `onFrame`. Resolves with the dialog (to show
 * the review screen in) and the time it took, or null if the player
 * cancelled or it failed (a toast says why).
 */
export async function scan(files: File[], title: string, onFrame: (text: FrameText) => void): Promise<{ dlg: HTMLDialogElement; seconds: number } | null> {
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
    let last: Uint8ClampedArray | null = null;
    const started = Date.now();
    for await (const _ of frames(files, canvas, (done, total) => paint(`Reading frame ${done} of ${total}…`, done, total))) {
      if (cancelled) return null;
      const t = thumb(canvas);
      if (sameish(last, t)) continue;
      last = t;
      onFrame((await worker.recognize(canvas)).data);
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
