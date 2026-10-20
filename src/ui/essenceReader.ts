import { readEssence, readEssenceArea, EssenceTally } from '../domain/essenceReader';
import { parseEssenceKey } from '../domain/essences';
import { state, updateSettings } from '../state';
import { toast } from './common';
import { icon } from './components';
import { html, render } from './html';
import { pickMedia, scan, type FrameText } from './screenReader';

/**
 * "Read from video or screenshots" on the Essences page (also a paste or
 * drop there): a recording of Valuables → Essences, selecting each essence
 * in turn, or of Etch Essence, stepping through the materials; or
 * screenshots of either. Read in this browser (screenReader.ts): it finds
 * the stats panel once, then reads only that, ten times a second, which
 * keeps up with fast scrolling. domain/essenceReader.ts turns frames into
 * essences. The review offers to replace the saved essences or add to them.
 */

/** Seconds between frames: an essence may be on screen for only a quarter of a second. */
const STEP = 0.1;

export const readEssences = (): void => pickMedia((files) => void readEssenceFiles(files));

const linesOf = (text: FrameText) => text.lines.map((l) => ({ text: l.text.trim(), x0: l.bbox.x0, x1: l.bbox.x1, y0: l.bbox.y0, y1: l.bbox.y1 }));

/** Reads the given recordings or screenshots and shows the review screen. */
export async function readEssenceFiles(files: File[]): Promise<void> {
  const tally = new EssenceTally();
  const shots = files.every((f) => f.type.startsWith('image/'));
  const done = await scan(
    files,
    'Reading your essences',
    (text) => {
      const stats = readEssence(linesOf(text));
      tally.add(stats);
      // A screenshot is one essence on its own: count it without waiting for a second frame.
      if (shots && stats) tally.add(stats);
      return !!stats;
    },
    {
      step: STEP,
      focus: (text) => readEssenceArea(linesOf(text))?.box ?? null,
      onSame: () => tally.hold(),
    },
  );
  if (done) review(done.dlg, tally, done.seconds);
}

function review(dlg: HTMLDialogElement, tally: EssenceTally, seconds: number): void {
  const kinds = [...tally.stash.entries()].sort((a, b) => b[1] - a[1]);
  const have = state.settings.essences ?? {};
  const saved = Object.values(have).reduce((n, c) => n + c, 0);
  render(
    dlg,
    html`<div class="reader-head">
        <h2 class="heading-20">Read ${tally.count} ${tally.count === 1 ? 'essence' : 'essences'}${kinds.length ? html`, ${kinds.length} different` : ''}</h2>
        <p class="copy-13 secondary">Read in ${seconds}s. Two identical essences next to each other count once; they fit the same weapons either way.</p>
      </div>
      <div class="reader-body reader-list">
        ${kinds.length
          ? kinds.slice(0, 60).map(
              ([key, n]) => html`<div class="reader-row reader-row-essence">
                <span class="min0 essence-stats">${parseEssenceKey(key).map(([s, l]) => html`<span class="essence-stat">${s} <b>+${l}</b></span>`)}</span>
                <span class="num secondary">×${n}</span>
              </div>`,
            )
          : html`<p class="copy-14 secondary">No essences were recognised. Record Valuables → Essences while selecting each essence (its Essence Stats panel showing), or Etch Essence while stepping through the materials.</p>`}
        ${kinds.length > 60 ? html`<p class="copy-13 secondary reader-notyet">And ${kinds.length - 60} more kinds.</p>` : ''}
      </div>
      <div class="reader-foot">
        <button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button>
        ${kinds.length
          ? html`<div class="row">
              ${saved ? html`<button type="button" class="btn secondary sm" data-reader-add title="Keep the ${saved} saved and add these">Add to saved</button>` : ''}
              <button type="button" class="btn primary sm" data-reader-save>${icon('check')}${saved ? `Replace the ${saved} saved` : 'Save'}</button>
            </div>`
          : ''}
      </div>`,
  );
  const save = (add: boolean) => {
    const next: Record<string, number> = add ? { ...(state.settings.essences ?? {}) } : {};
    for (const [k, n] of tally.stash) next[k] = (next[k] ?? 0) + n;
    dlg.close();
    updateSettings({ essences: next, essencesRead: Date.now() });
    toast(`Saved ${tally.count} ${tally.count === 1 ? 'essence' : 'essences'}.`);
  };
  dlg.querySelector('[data-reader-save]')?.addEventListener('click', () => save(false));
  dlg.querySelector('[data-reader-add]')?.addEventListener('click', () => save(true));
}
