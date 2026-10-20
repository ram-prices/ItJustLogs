import type { Medal, MedalProgress } from '../domain/collections';
import { nameIndex, readFrame, settle, type ReadLine, type ReadMedal, type Sighting } from '../domain/medalReader';
import { state, updateSettings } from '../state';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';
import { pickMedia, scan } from './screenReader';

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
  const sightings: Sighting[] = [];
  const done = await scan(files, 'Reading your medals', (text) => {
    const lines: ReadLine[] = text.lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 + l.bbox.y1) / 2 }));
    sightings.push(...readFrame(lines, names));
  });
  if (done) review(done.dlg, settle(sightings, medals), medals, done.seconds);
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
