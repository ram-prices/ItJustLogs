import type { Medal, MedalProgress } from '../domain/collections';
import { nameIndex, normName, readFrame, settle, type ReadLine, type ReadMedal, type Sighting } from '../domain/medalReader';
import { lookOf, tierOf } from '../domain/medalTier';
import { state, updateSettings } from '../state';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';
import { pickMedia, scan, type FrameText } from './screenReader';

/**
 * "Read from video or screenshots" on the Achievements page (also a paste
 * or drop there): a recording of the Medal Album, scrolled through, or some
 * screenshots of it are read in this browser (screenReader.ts); the
 * matching and the vote across frames are domain/medalReader.ts. A review
 * screen lists what was read, and only what the player ticks is saved.
 */

/** Opens the file picker, reads the chosen files, then shows the review screen. */
export const readMedals = (medals: Medal[]): void => pickMedia((files) => void readMedalFiles(files, medals));

/** Reads the given recordings or screenshots and shows the review screen. */
export async function readMedalFiles(files: File[], medals: Medal[]): Promise<void> {
  const names = nameIndex(medals);
  const byId = new Map(medals.map((m) => [m.id, m]));
  const sightings: Sighting[] = [];
  const done = await scan(files, 'Reading your medals', (text, frame) => {
    const lines: ReadLine[] = text.lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 + l.bbox.y1) / 2 }));
    for (const s of readFrame(lines, names)) {
      const m = byId.get(s.id);
      if (m && (m.reforge.length || m.trim) && s.line !== undefined) s.look = lookAt(frame, text.lines[s.line], m);
      sightings.push(s);
    }
  });
  if (done) review(done.dlg, settle(sightings, medals), medals, done.seconds);
}

/**
 * Where a row's medal picture sits, from its title (frames are READ_HEIGHT
 * tall, and the game scales its layout with the height): measured on Medal
 * Album screenshots, the picture's middle is 126px left of the title's
 * first letter and 43px below the title's middle.
 */
const PICTURE = { dx: -126, dy: 43, half: 30 };

/** The look of the medal beside a title line (dark, silver, gold or holographic), or null if unsure. */
function lookAt(frame: HTMLCanvasElement, line: FrameText['lines'][number], m: Medal) {
  // The title's first word (the name's start), so stray marks before it don't shift the square.
  const first = normName(m.name).split(' ')[0];
  const word = line.words?.find((w) => normName(w.text).split(' ')[0] === first) ?? line.words?.[0];
  const x0 = (word ?? line).bbox.x0;
  const y = (line.bbox.y0 + line.bbox.y1) / 2;
  const cx = x0 + PICTURE.dx;
  const cy = y + PICTURE.dy;
  if (cx - PICTURE.half < 0 || cy + PICTURE.half > frame.height) return null;
  const px = frame.getContext('2d', { willReadFrequently: true })!.getImageData(cx - PICTURE.half, cy - PICTURE.half, PICTURE.half * 2, PICTURE.half * 2).data;
  return tierOf(lookOf(px), { reforge: m.reforge.length > 0, trim: !!m.trim });
}

const LOOK = ['', 'Base', 'Reforged II', 'Reforged III'];
const lookLabel = (r: ReadMedal) => (r.tier && r.tier > 1 ? LOOK[r.tier] : r.trim ? 'Trimmed' : '');

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
    const looksNew = (r.tier !== undefined && (mine.tier ?? 1) !== r.tier) || (r.trim !== undefined && !!mine.trim !== r.trim);
    if (mine.at === r.date) return looksNew ? { label: 'Updates its look', tick: true } : { label: 'Already marked', tick: false };
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
                <input type="checkbox" data-reader-id="${r.id}" data-reader-date="${r.date}" data-reader-tier="${r.tier ?? ''}" data-reader-trim="${r.trim === undefined ? '' : String(r.trim)}" ${raw(s.tick ? 'checked' : '')} />
                <span class="min0 reader-name">${r.name}${lookLabel(r) ? html` <span class="badge outline">${lookLabel(r)}</span>` : ''}${r.unsure ? html` <span class="badge amber">Check</span>` : ''}</span>
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
      const next: MedalProgress = { ...all[box.dataset.readerId!], at: box.dataset.readerDate };
      // The look it was seen with: its Reforging tier (base drops the tier) or Trimming.
      const tier = Number(box.dataset.readerTier);
      if (tier === 2 || tier === 3) next.tier = tier;
      else if (tier === 1) delete next.tier;
      if (box.dataset.readerTrim === 'true') next.trim = true;
      else if (box.dataset.readerTrim === 'false') delete next.trim;
      all[box.dataset.readerId!] = next;
      n++;
    }
    dlg.close();
    if (n) updateSettings({ medals: all });
    toast(n ? `Saved ${n} ${n === 1 ? 'medal' : 'medals'}.` : 'Nothing saved.');
  });
}
