import type { HistoryMatch } from '../domain/parse';
import { html, render } from './html';

export type SamePlayerChoice = 'cancel' | 'replace' | 'merge';

/** Opening a second dialog cancels the first, so its caller isn't left waiting. */
let closeOpen: ((c: SamePlayerChoice) => void) | null = null;

/**
 * Pulls that don't look like the saved player's: ask before mixing two
 * players' pulls. In-page, since some browsers block confirm() dialogs.
 * `source` names where they came from ("endfield_pulls.json", "Your Google
 * Drive copy"); `replaceLabel` is the button that drops this browser's pulls.
 */
export function askSamePlayer(match: HistoryMatch, source: string, replaceLabel = 'Replace saved pulls'): Promise<SamePlayerChoice> {
  closeOpen?.('cancel');
  const { verdict, shared, foreign } = match;
  const total = shared + foreign;
  const why =
    verdict === 'different'
      ? `Only ${shared} of the ${total} pulls it has from the same period match the history saved here, so it's probably from a different account. Adding it would mix two players' pulls.`
      : "It has no pulls from the period saved here, so there's no way to tell whether it's the same account.";
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title">
      <h2 class="heading-20" id="dialog-title">${verdict === 'different' ? "This doesn't look like the same player" : 'Is this the same player?'}</h2>
      <p class="copy-14">${source}: ${why}</p>
      <div class="dialog-actions">
        <button class="btn secondary sm" data-choice="cancel">Cancel</button>
        <button class="btn secondary sm" data-choice="replace">${replaceLabel}</button>
        <button class="btn ${verdict === 'different' ? 'secondary' : 'primary'} sm" data-choice="merge">Add anyway</button>
      </div>
    </div>`,
  );
  return new Promise((resolve) => {
    const close = (choice: SamePlayerChoice) => {
      backdrop.remove();
      closeOpen = null;
      resolve(choice);
    };
    closeOpen = close;
    backdrop.addEventListener('click', (ev) => {
      const choice = (ev.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
      if (ev.target === backdrop || choice === 'cancel') return close('cancel');
      if (choice === 'replace' || choice === 'merge') close(choice);
    });
    backdrop.addEventListener('keydown', (ev) => ev.key === 'Escape' && close('cancel'));
    document.body.append(backdrop);
    backdrop.querySelector<HTMLElement>('[data-choice="cancel"]')!.focus();
  });
}
