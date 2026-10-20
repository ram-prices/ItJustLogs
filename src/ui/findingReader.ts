import { FINDING_CATEGORIES, type Finding } from '../domain/collections';
import { chain, collectedCounts, findingIndex, tilesFrom, type Tile } from '../domain/findingReader';
import { normName } from '../domain/medalReader';
import { state, updateSettings } from '../state';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';
import { pickMedia, scan } from './screenReader';

/**
 * "Read from video or screenshots" on the Archive page (also a paste or drop
 * there): a recording of Intel Archives → Findings, each category scrolled
 * through, or screenshots of it, read in this browser (screenReader.ts).
 * The grid shows only collected findings, in the wiki list's order, with
 * names cut short; domain/findingReader.ts matches them by how names start
 * and settles look-alikes by that order. A review screen lists what was
 * found per category, and only what the player ticks is saved.
 */

export const readFindings = (findings: Finding[]): void => pickMedia((files) => void readFindingFiles(files, findings));

/** Reads the given recordings or screenshots and shows the review screen. */
export async function readFindingFiles(files: File[], findings: Finding[]): Promise<void> {
  const list = findingIndex(findings);
  const found = new Set<number>();
  // Leftover names, and how many frames showed each: one frame alone is usually motion blur.
  const unread = new Map<string, { tile: Tile; frames: number }>();
  // The side menu's "Collected N" per category, voted on across frames (a frame can misread a digit).
  const votes: Record<string, Map<number, number>> = {};
  const done = await scan(files, 'Reading your Archive', (text) => {
    const words = text.words.map((w) => ({ text: w.text, ...w.bbox }));
    const { picks, unread: miss } = chain(tilesFrom(words), list);
    picks.forEach((p) => p >= 0 && found.add(p));
    for (const t of miss) {
      const key = normName(t.text);
      unread.set(key, { tile: t, frames: (unread.get(key)?.frames ?? 0) + 1 });
    }
    const lines = text.lines.map((l) => ({ text: l.text.trim(), y: (l.bbox.y0 + l.bbox.y1) / 2 }));
    for (const [cat, n] of Object.entries(collectedCounts(lines))) {
      const v = (votes[cat] ??= new Map<number, number>());
      v.set(n, (v.get(n) ?? 0) + 1);
    }
  });
  if (!done) return;
  const counts = Object.fromEntries(Object.entries(votes).map(([cat, m]) => [cat, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]]));
  // A name left over is one the wiki doesn't list yet, unless another frame matched it after all.
  const matched = new Set([...found].map((i) => list[i].n));
  const many = [...unread.values()].filter((u) => u.frames >= 2 || files.every((f) => f.type.startsWith('image/'))).map((u) => u.tile);
  const left = many.filter((t) => ![...matched].some((n) => n.startsWith(normName(t.text))));
  review(done.dlg, [...found].sort((a, b) => a - b).map((i) => list[i]), left, counts, done.seconds);
}

function review(dlg: HTMLDialogElement, found: { id: string; name: string; category: string }[], left: Tile[], counts: Record<string, number>, seconds: number): void {
  const owned = new Set(state.settings.findings ?? []);
  const fresh = found.filter((f) => !owned.has(f.id)).length;
  render(
    dlg,
    html`<div class="reader-head">
        <h2 class="heading-20">Found ${found.length} ${found.length === 1 ? 'finding' : 'findings'}${fresh < found.length ? html`, ${fresh} new` : ''}</h2>
        <p class="copy-13 secondary">Read in ${seconds}s. Untick anything that looks wrong.</p>
      </div>
      <div class="reader-body reader-list">
        ${found.length
          ? FINDING_CATEGORIES.map((cat) => {
              const rows = found.filter((f) => f.category === cat);
              if (!rows.length) return '';
              const game = counts[cat];
              return html`<div class="reader-cat">
                <div class="reader-cat-head label-14">
                  <span>${cat}</span>
                  <span class="secondary">${rows.length} read${game ? html` · the game says ${game} collected` : ''}</span>
                </div>
                ${rows.map(
                  (f) => html`<label class="reader-row reader-row-finding">
                    <input type="checkbox" data-reader-id="${f.id}" ${raw(owned.has(f.id) ? '' : 'checked')} />
                    <span class="min0 reader-name">${f.name}</span>
                    <span class="label-12 secondary reader-status">${owned.has(f.id) ? 'Already marked' : 'New'}</span>
                  </label>`,
                )}
              </div>`;
            })
          : html`<p class="copy-14 secondary">No findings were recognised. Record or screenshot Intel Archives → Findings, with a category's grid showing.</p>`}
        ${left.length
          ? html`<p class="copy-13 secondary reader-notyet">Not matched (likely newer than the wiki's list, or misread): ${left.map((t) => `${t.text}${t.cut ? '…' : ''}`).join(', ')}.</p>`
          : ''}
      </div>
      <div class="reader-foot">
        <button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button>
        ${found.length ? html`<button type="button" class="btn primary sm" data-reader-save>${icon('check')}Save ticked</button>` : ''}
      </div>`,
  );
  dlg.querySelector('[data-reader-save]')?.addEventListener('click', () => {
    const have = new Set(state.settings.findings ?? []);
    let n = 0;
    for (const box of dlg.querySelectorAll<HTMLInputElement>('[data-reader-id]:checked')) {
      if (!have.has(box.dataset.readerId!)) n++;
      have.add(box.dataset.readerId!);
    }
    dlg.close();
    if (n) updateSettings({ findings: [...have] });
    toast(n ? `Marked ${n} ${n === 1 ? 'finding' : 'findings'} collected.` : 'Nothing new to save.');
  });
}
