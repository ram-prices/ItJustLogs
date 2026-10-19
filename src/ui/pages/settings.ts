import { state } from '../../state';
import { EXPORTER_SOURCE } from '../guide';
import { icon, pageHeader, toggleGroup } from '../components';
import { fmtInt, html, type Html } from '../html';

/** Settings, laid out like Vercel's: one card per topic with a footer for its action. */

export function getDataSteps(): Html {
  return html`
    <ol class="steps">
      <li><span>Open <b>Headhunting → History</b> in the game once, so the history link is fresh.</span></li>
      <li><span><b>Close the game.</b> While it's running it keeps the file with the history link in use, and the script can't read it.</span></li>
      <li><span>Open <b>Windows PowerShell</b> (no administrator needed), paste the script below with a right-click, and press <kbd>Enter</kbd> if it shows <code>&gt;&gt;</code>.</span></li>
      <li><span>When it says <b>Done</b>, come back here and press <kbd>Ctrl</kbd> <kbd>V</kbd>. The file is also saved to your Desktop.</span></li>
    </ol>
    <div class="code" style="margin-top:20px">
      <button class="btn secondary sm" data-action="copy-script">${icon('content_copy')}Copy</button>
      <pre><code>${EXPORTER_SOURCE}</code></pre>
    </div>`;
}

/**
 * Deleting asks for confirmation in the page itself: native confirm() dialogs
 * are silently blocked by some in-app and embedded browsers, which made the
 * button appear to do nothing.
 */
export type DeleteScope = 'pulls' | 'all';
let confirmingDelete: DeleteScope | null = null;
export function setConfirmingDelete(v: DeleteScope | null): void {
  confirmingDelete = v;
}

export function settingsPage(): Html {
  const s = state.settings;
  const h = state.history;
  const count = h ? h.characters.length + h.weapons.length : 0;
  return html`
    ${pageHeader('Settings', 'Everything is stored in this browser only.')}
    <main class="container fade-in"><div class="settings">

      <section class="card">
        <div class="card-body">
          <h2 class="heading-20">Pull history</h2>
          <p class="copy-14">${count ? `${fmtInt(count)} records saved. ` : ''}Each import is merged into what's saved, so pulls the game no longer shows are kept. You can also drop a file anywhere, or press <kbd>Ctrl</kbd> <kbd>V</kbd>.</p>
        </div>
        <div class="card-footer"><span>Exports from the PowerShell script, EF Tracker or track.py all work.</span>
          <button class="btn primary sm" data-action="import">${icon('upload_file')}Import file</button></div>
      </section>

      <section class="card">
        <div class="card-body">
          <h2 class="heading-20">Personalization</h2>
          <p class="copy-14">The name and picture at the top of every page.</p>
          <div class="profile-edit">
            ${state.images.avatar ? html`<img class="avatar lg" src="${state.images.avatar}" alt="" />` : html`<span class="avatar lg"></span>`}
            <label class="field">
              <span>Display name</span>
              <input class="input" id="displayName" data-setting="displayName" maxlength="32" placeholder="Endministrator" value="${s.displayName}" autocomplete="off" spellcheck="false" />
            </label>
          </div>
        </div>
        <div class="card-footer"><span>Pictures are cropped square and kept in this browser.</span>
          <div class="row">
            ${state.images.avatar ? html`<button class="btn tertiary sm" data-action="avatar-remove">Remove</button>` : ''}
            <button class="btn secondary sm" data-action="avatar-upload">${icon('upload_file')}Upload picture</button>
          </div></div>
      </section>

      <section class="card">
        <div class="card-body">
          <h2 class="heading-20">Get your pull history</h2>
          <p class="copy-14">Windows PC version of the game. The script only reads the game's web cache and talks to Gryphline's own history server. It needs no admin rights, changes no settings and downloads nothing else.</p>
          ${getDataSteps()}
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <h2 class="heading-20">Theme</h2>
          <p class="copy-14">Follow your device, or pick one.</p>
          ${toggleGroup('theme', [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], s.theme)}
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <h2 class="heading-20">Backup</h2>
          <p class="copy-14">Download your pulls to keep a copy, or a full backup (pulls and settings) to move to another browser.</p>
        </div>
        <div class="card-footer"><span>Restore a backup with Import file.</span>
          <div class="row">
            <button class="btn secondary sm" data-action="export-history" ${count ? '' : 'disabled'}>${icon('download')}Pulls</button>
            <button class="btn secondary sm" data-action="export-backup">${icon('download')}Full backup</button>
          </div></div>
      </section>

      ${count
        ? html`<section class="card danger">
            <div class="card-body">
              <h2 class="heading-20">Delete saved data</h2>
              <p class="copy-14">Delete just your imported pulls (your name, picture and settings stay), or everything this site saved. This can't be undone.</p>
            </div>
            <div class="card-footer">${confirmingDelete
              ? html`<span>${confirmingDelete === 'pulls'
                    ? html`<b>Delete pull history?</b> ${fmtInt(count)} pulls will be removed. Settings and images stay.`
                    : html`<b>Delete everything?</b> ${fmtInt(count)} pulls, your settings and images will be removed from this browser.`}</span>
                  <div class="row">
                    <button class="btn secondary sm" data-action="clear-cancel">Cancel</button>
                    <button class="btn error sm" data-action="clear-confirm" data-value="${confirmingDelete}">${icon('delete')}${confirmingDelete === 'pulls' ? 'Delete pulls' : 'Delete everything'}</button>
                  </div>`
              : html`<span>Download a backup first if you want to keep anything.</span>
                  <div class="row">
                    <button class="btn secondary sm" data-action="clear-all" data-value="all">Delete everything</button>
                    <button class="btn error sm" data-action="clear-all" data-value="pulls">${icon('delete')}Delete pull history</button>
                  </div>`}</div>
          </section>`
        : ''}
    </div></main>`;
}

export function aboutCard(): Html {
  return html`<p class="copy-13 tertiary" style="margin-top:40px">
    ItJustLogs is a fan-made tracker for Arknights: Endfield. It's not affiliated with Gryphline or Hypergryph, and game assets belong to them.
    Your data never leaves your browser. Source: <a href="https://github.com/ram-prices/ItJustLogs" target="_blank" rel="noopener">github.com/ram-prices/ItJustLogs</a>.
  </p>`;
}
