import type { Medal, MedalProgress } from '../domain/collections';
import { nameIndex, readFrame, settle, type ReadLine, type ReadMedal, type Sighting } from '../domain/medalReader';
import { state, updateSettings } from '../state';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';

/**
 * "Read from video or screenshots" on the Achievements page: the player
 * picks a recording of the Medal Album (scrolling through it) or some
 * screenshots of it, and the medals they show are read in this browser.
 * Nothing is uploaded. Tesseract.js (text recognition compiled to run in
 * the page) is loaded from jsDelivr only when someone uses this; the
 * matching and the vote across frames are domain/medalReader.ts. A review
 * screen lists what was read, and only what the player ticks is saved.
 */

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

interface TesseractWorker {
  recognize(img: HTMLCanvasElement): Promise<{ data: { lines: { text: string; bbox: { y0: number; y1: number } }[] } }>;
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
 * reads the same. Nothing is cut out by position; the side menu and medal
 * pictures read as stray words, which matching against the medal names
 * ignores (domain/medalReader.ts).
 */
const READ_HEIGHT = 1080;
/** Seconds between the frames read from a recording. */
const STEP = 0.5;

/** Draws a whole frame, scaled to READ_HEIGHT tall. */
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

/** Each frame to read: every STEP seconds of a recording, and each screenshot. */
async function* frames(files: File[], canvas: HTMLCanvasElement, progress: (done: number, total: number) => void): AsyncGenerator<void> {
  const videos = files.filter((f) => f.type.startsWith('video/'));
  const images = files.filter((f) => f.type.startsWith('image/'));
  // Estimate the work up front for the progress bar.
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

/** Opens the file picker, reads the chosen files, then shows the review screen. */
export function readMedals(medals: Medal[]): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*,image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) void readMedalFiles(files, medals);
  };
  input.click();
}

/** Reads the given recordings or screenshots and shows the review screen (the picker above, or a test). */
export async function readMedalFiles(files: File[], medals: Medal[]): Promise<void> {
  const dlg = document.createElement('dialog');
  dlg.className = 'card reader-dialog';
  document.body.append(dlg);
  let cancelled = false;
  dlg.addEventListener('close', () => {
    cancelled = true;
    dlg.remove();
  });
  const paint = (text: string, done = 0, total = 0) =>
    render(
      dlg,
      html`<div class="reader-head"><h2 class="heading-20">Reading your medals</h2></div>
        <div class="reader-body">
          <p class="copy-14">${text}</p>
          <div class="reader-bar"><span style="width:${total ? Math.round((done / total) * 100) : 0}%"></span></div>
          <p class="copy-13 secondary">Everything is read here in your browser; nothing is uploaded.</p>
        </div>
        <div class="reader-foot"><span></span><button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button></div>`,
    );
  dlg.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-reader-cancel]')) dlg.close();
  });
  paint('Loading the text reader…');
  dlg.showModal();

  let worker: TesseractWorker | null = null;
  try {
    worker = await (await loadTesseract()).createWorker('eng');
    const names = nameIndex(medals);
    const canvas = document.createElement('canvas');
    const sightings: Sighting[] = [];
    let last: Uint8ClampedArray | null = null;
    const started = Date.now();
    for await (const _ of frames(files, canvas, (done, total) => paint(`Reading frame ${done} of ${total}…`, done, total))) {
      if (cancelled) return;
      const t = thumb(canvas);
      if (sameish(last, t)) continue;
      last = t;
      const { data } = await worker.recognize(canvas);
      const lines: ReadLine[] = data.lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 + l.bbox.y1) / 2 }));
      sightings.push(...readFrame(lines, names));
    }
    if (cancelled) return;
    review(dlg, settle(sightings, medals), medals, Math.round((Date.now() - started) / 1000));
  } catch (e) {
    if (!cancelled) {
      dlg.close();
      toast((e as Error).message, 'error');
    }
  } finally {
    await worker?.terminate();
  }
}

/** What was read, for the player to check: only ticked rows are saved. */
function review(dlg: HTMLDialogElement, read: ReadMedal[], medals: Medal[], seconds: number): void {
  const owned = state.settings.medals ?? {};
  const order = new Map(medals.map((m, i) => [m.id, i]));
  const got = read.filter((r) => r.date).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const notYet = read.filter((r) => !r.date && !owned[r.id]);
  const status = (r: ReadMedal) => {
    const mine = owned[r.id];
    if (!mine) return { label: 'New', tick: true };
    if (!mine.at) return { label: 'Adds the date', tick: true };
    if (mine.at === r.date) return { label: 'Already marked', tick: false };
    return { label: `Yours says ${mine.at}`, tick: false };
  };
  render(
    dlg,
    html`<div class="reader-head">
        <h2 class="heading-20">Found ${got.length} acquired ${got.length === 1 ? 'medal' : 'medals'}</h2>
        <p class="copy-13 secondary">Read in ${seconds}s. Untick anything that looks wrong; rows marked Check were harder to read.</p>
      </div>
      <div class="reader-body reader-list">
        ${got.length
          ? got.map((r) => {
              const s = status(r);
              return html`<label class="reader-row">
                <input type="checkbox" data-reader-id="${r.id}" data-reader-date="${r.date}" ${raw(s.tick ? 'checked' : '')} />
                <span class="min0 reader-name">${r.name}${r.unsure ? html` <span class="badge amber">Check</span>` : ''}</span>
                <span class="num reader-date">${r.date}</span>
                <span class="label-12 secondary reader-status">${s.label}</span>
              </label>`;
            })
          : html`<p class="copy-14 secondary">No acquired medals were recognised. Record or screenshot the Medal Album itself, with the list of medals showing.</p>`}
        ${notYet.length ? html`<p class="copy-13 secondary reader-notyet">Also seen, not acquired yet: ${notYet.map((r) => r.name).join(', ')}.</p>` : ''}
      </div>
      <div class="reader-foot">
        <button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button>
        ${got.length ? html`<button type="button" class="btn primary sm" data-reader-save>${icon('check')}Save ticked</button>` : ''}
      </div>`,
  );
  dlg.querySelector('[data-reader-save]')?.addEventListener('click', () => {
    const all: Record<string, MedalProgress> = { ...(state.settings.medals ?? {}) };
    let n = 0;
    for (const box of dlg.querySelectorAll<HTMLInputElement>('[data-reader-id]:checked')) {
      all[box.dataset.readerId!] = { ...all[box.dataset.readerId!], at: box.dataset.readerDate };
      n++;
    }
    dlg.close();
    if (n) updateSettings({ medals: all });
    toast(n ? `Saved ${n} ${n === 1 ? 'medal' : 'medals'}.` : 'Nothing saved.');
  });
}
