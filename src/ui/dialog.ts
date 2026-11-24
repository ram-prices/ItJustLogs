import type { HistoryMatch } from '../domain/parse';
import { focusMark, html, render, restoreFocus } from './html';

export type SamePlayerChoice = 'cancel' | 'replace' | 'merge';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Makes an in-page dialog (`backdrop`, already in the document) modal for the
 * keyboard: focus moves into it (`first`, else its first control), Tab and
 * Shift+Tab stay inside it, Escape calls `close`. The returned function puts
 * focus back where it was before; call it from `close`. Keeps working when
 * the dialog re-renders its own content.
 */
export function holdFocus(backdrop: HTMLElement, close: () => void, first?: HTMLElement | null): () => void {
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const mark = focusMark(document.body);
  const controls = () => [...backdrop.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = controls();
    if (!list.length) return e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      list[list.length - 1].focus();
    } else if (!e.shiftKey && (at === -1 || at === list.length - 1)) {
      e.preventDefault();
      list[0].focus();
    }
  });
  const target = first ?? controls()[0] ?? backdrop.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (target && !target.matches(FOCUSABLE)) target.tabIndex = -1;
  target?.focus({ preventScroll: true });
  return () => {
    // A redraw while it was open replaced the opener: its stand-in in the new page.
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else restoreFocus(document.body, mark);
  };
}

/**
 * Code loaded on use (the picture cropper) that didn't load: usually a newer
 * version of the site is out and this tab asks for an old file. Offers a reload.
 */
export function askReload(): void {
  document.querySelector('.reload-dialog')?.closest('.dialog-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  render(
    backdrop,
    html`<div class="card dialog reload-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reload-title">
      <h2 class="heading-20" id="reload-title">Couldn't load this page.</h2>
      <div class="dialog-actions">
        <button class="btn secondary sm" data-choice="cancel">Cancel</button>
        <button class="btn primary sm" data-choice="reload">Reload</button>
      </div>
    </div>`,
  );
  let release = () => {};
  const close = () => {
    backdrop.remove();
    release();
  };
  backdrop.addEventListener('click', (ev) => {
    const choice = (ev.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
    if (choice === 'reload') location.reload();
    else if (ev.target === backdrop || choice === 'cancel') close();
  });
  document.body.append(backdrop);
  release = holdFocus(backdrop, close, backdrop.querySelector<HTMLElement>('[data-choice="reload"]'));
}

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
    let release = () => {};
    const close = (choice: SamePlayerChoice) => {
      backdrop.remove();
      closeOpen = null;
      release();
      resolve(choice);
    };
    closeOpen = close;
    backdrop.addEventListener('click', (ev) => {
      const choice = (ev.target as HTMLElement).closest<HTMLElement>('[data-choice]')?.dataset.choice;
      if (ev.target === backdrop || choice === 'cancel') return close('cancel');
      if (choice === 'replace' || choice === 'merge') close(choice);
    });
    document.body.append(backdrop);
    release = holdFocus(backdrop, () => close('cancel'), backdrop.querySelector<HTMLElement>('[data-choice="cancel"]'));
  });
}
