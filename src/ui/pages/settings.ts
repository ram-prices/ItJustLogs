import { endministratorOf, EXTRA_PRESETS, extraKind, extrasOf, isEndministrator, MAX_COPIES, type ExtraCopy } from '../../domain/owned';
import { SERVER_LABEL } from '../../domain/schedule';
import type { WikiOperatorFile, WikiWeaponFile } from '../../domain/wiki';
import { currentServer, state } from '../../state';
import { MAX_SNAPSHOTS } from '../../store';
import { EXPORTER_SOURCE } from '../guide';
import { badge, icon, itemImg, pageHeader, toggleGroup } from '../components';
import { wikiFile } from './info';
import { fmtDate, fmtInt, html, type Html } from '../html';
import { driveConfigured } from '../../drive';
import { preloadSync, syncView } from '../sync';

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

/** Google Drive sync; only on builds with a client ID. */
function syncCard(): Html {
  if (!driveConfigured()) return html``;
  preloadSync();
  const v = syncView();
  if (v.status === 'off')
    return html`<section class="card">
      <div class="card-body">
        <h2 class="heading-20">Sync with Google Drive</h2>
        <p class="copy-14">Keep your pulls, settings and pictures in your own Google Drive and use them on any device. ItJustLogs can only see a hidden folder of its own there, not your files.</p>
      </div>
      <div class="card-footer"><span>Optional. Nothing leaves this browser until you sign in.</span>
        <button class="btn primary sm" data-action="sync-signin">${icon('cloud')}Sign in with Google</button></div>
    </section>`;
  const line =
    v.status === 'syncing'
      ? html`${badge('Syncing', 'blue')}`
      : v.status === 'reconnect'
        ? html`${badge('Paused', 'amber')} <span>Google sign-ins last an hour. Sync now to continue on this visit.</span>`
        : v.status === 'paused'
          ? html`${badge('Paused', 'amber')} <span>The Drive copy doesn't look like the pulls saved here. Sync now to choose what to do, or sign out.</span>`
          : v.status === 'error'
            ? html`${badge('Failed', 'red')} <span>${v.error}</span>`
            : html`${badge('Synced', 'green')}`;
  return html`<section class="card">
    <div class="card-body">
      <h2 class="heading-20">Sync with Google Drive</h2>
      <p class="copy-14">Signed in as <b>${v.email ?? 'your Google account'}</b>. Imports and changes are saved to your Drive and merged with your other devices.</p>
      <div class="sync-status">${line}${v.lastSynced ? html`<span class="tertiary">Last synced ${fmtDate(v.lastSynced, true)}</span>` : ''}</div>
    </div>
    <div class="card-footer"><span>To delete the Drive copy: Google Drive → Settings → Manage apps → ItJustLogs → Delete hidden app data.</span>
      <div class="row">
        <button class="btn tertiary sm" data-action="sync-signout">Sign out</button>
        <button class="btn secondary sm" data-action="sync-now" ${v.status === 'syncing' ? 'disabled' : ''}>${icon('sync')}Sync now</button>
      </div></div>
  </section>`;
}

/**
 * Extra copies: operators and weapons the player has without pulling them
 * (story operators, event gifts). Kept in settings, so backups and Drive sync
 * carry them; the pull history is never touched. Names come from the wiki
 * snapshot (loaded on demand, `redraw` once it's in).
 */
function extrasCard(redraw: () => void): Html {
  const ops = wikiFile<WikiOperatorFile>('operators.json', redraw).data;
  const weps = wikiFile<WikiWeaponFile>('weapons.json', redraw).data;
  const extras = extrasOf(state.settings);
  // There are two Endministrators; say which.
  const label = (id: string, name: string) => (id.endsWith('_endminm') ? `${name} (male)` : id.endsWith('_endminf') ? `${name} (female)` : name);
  const nameOf = (id: string): string => {
    const name = extraKind(id) === 'weap' ? weps?.weapons[id]?.name : ops?.operators[id]?.name;
    return name ? label(id, name) : id;
  };
  // One Endministrator: whichever the player has counts as the preset's too.
  const endmin = endministratorOf(extras);
  const has = (x: ExtraCopy) => extras.some((e) => (e.id === x.id && e.note === x.note) || (isEndministrator(x.id) && e.id === endmin));
  const options = (items: [string, { name: string; rarity: number }][]) =>
    items
      .sort(([, p], [, q]) => q.rarity - p.rarity || p.name.localeCompare(q.name))
      .map(([id, v]) => {
        const other = endmin && isEndministrator(id) && id !== endmin;
        return html`<option value="${id}" ${other ? 'disabled' : ''}>${label(id, v.name)} · ${v.rarity}★${other ? ' (you have the other one)' : ''}</option>`;
      });
  // The Endministrator row switches between the two instead of naming one.
  const name = (x: ExtraCopy, i: number) =>
    isEndministrator(x.id)
      ? html`<select class="input extra-endmin" data-extra-id="${i}" aria-label="Which Endministrator">
          <option value="chr_0003_endminf" ${x.id === 'chr_0003_endminf' ? 'selected' : ''}>Endministrator (female)</option>
          <option value="chr_0002_endminm" ${x.id === 'chr_0002_endminm' ? 'selected' : ''}>Endministrator (male)</option>
        </select>`
      : html`<span class="extra-name ellipsis">${nameOf(x.id)}</span>`;
  return html`<section class="card" id="extras">
    <div class="card-body">
      <h2 class="heading-20">Extra copies</h2>
      <p class="copy-14">Operators and weapons you got without pulling: story operators and event gifts. They count toward copies and Potential on the info pages. Your pull history stays exactly as the game exported it.</p>
      ${extras.length
        ? html`<div class="extras">${extras.map(
            (x, i) => html`<div class="extra">
              ${itemImg(extraKind(x.id), x.id, 'extra-icon')}
              ${name(x, i)}
              <input class="input extra-note" data-extra-note="${i}" value="${x.note}" maxlength="48" placeholder="Event" aria-label="Event that gave ${nameOf(x.id)}" />
              <label class="extra-copies"><input class="input" type="number" min="1" max="99" data-extra-copies="${i}" value="${x.copies}" aria-label="Copies of ${nameOf(x.id)}" /><span class="secondary">${x.copies >= MAX_COPIES ? 'max' : `P${x.copies - 1}`}</span></label>
              <button class="btn tertiary sm" data-action="extra-remove" data-value="${i}" aria-label="Remove ${nameOf(x.id)}">${icon('close')}</button>
            </div>`,
          )}</div>`
        : html`<p class="copy-13 secondary versions-empty">None yet.</p>`}
      <div class="extra-add">
        <label class="field extra-add-item"><span>Operator or weapon</span>
          <select class="input" id="extraItem" ${ops && weps ? '' : 'disabled'}>
            ${ops && weps
              ? html`<optgroup label="Operators">${options(Object.entries(ops.operators))}</optgroup><optgroup label="Weapons">${options(Object.entries(weps.weapons))}</optgroup>`
              : html`<option>Loading…</option>`}
          </select></label>
        <label class="field extra-add-copies"><span>Copies</span><input class="input" id="extraCopies" type="number" min="1" max="99" value="1" /></label>
        <label class="field extra-add-note"><span>Event</span><input class="input" id="extraNote" maxlength="48" placeholder="Event name" /></label>
        <button class="btn secondary sm" data-action="extra-add" ${ops && weps ? '' : 'disabled'}>Add</button>
      </div>
      <div class="extra-presets">
        <span class="label-13 secondary">Quick add</span>
        ${EXTRA_PRESETS.map((p) => html`<button class="btn tertiary sm" data-action="extra-preset" data-value="${p.key}" ${p.extras.every(has) ? 'disabled' : ''}>${p.label}</button>`)}
      </div>
    </div>
    <div class="card-footer"><span>Saved with your settings: included in full backups and Google Drive sync, never in your pull history. Copies 1 = P0, 6 = max.</span></div>
  </section>`;
}

export function settingsPage(redraw: () => void): Html {
  const s = state.settings;
  const h = state.history;
  const count = h ? h.characters.length + h.weapons.length : 0;
  const synced = driveConfigured() && syncView().status !== 'off';
  return html`
    ${pageHeader('Settings', synced ? 'Everything is stored in this browser and synced to your Google Drive.' : 'Everything is stored in this browser only.')}
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
          <h2 class="heading-20">Server</h2>
          <p class="copy-14">Banners open at the same local time on each server, 13 hours apart, so the schedule needs to know yours.${s.server ? '' : ' Guessed from your time zone for now.'}</p>
          ${toggleGroup('server', [['americas', SERVER_LABEL.americas], ['asia', SERVER_LABEL.asia]], currentServer())}
        </div>
      </section>

      ${extrasCard(redraw)}

      ${syncCard()}

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

      ${versionHistory(synced)}

      ${count
        ? html`<section class="card danger">
            <div class="card-body">
              <h2 class="heading-20">Delete locally saved data</h2>
              ${deleteOptions(synced)}
            </div>
            <div class="card-footer">${confirmingDelete
              ? html`<span class="delete-confirm">${confirmingDelete === 'pulls'
                    ? html`<b>Delete pull history?</b> ${fmtInt(count)} pulls will be removed from this browser. Your name, picture, settings and version history stay.`
                    : html`<b>Delete everything?</b> ${fmtInt(count)} pulls, your settings, pictures and version history will be removed from this browser.`}
                  ${synced ? driveImpact() : ''}</span>
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

/**
 * Version history: the copies of your pulls saved before each import, delete,
 * replace, restore or Drive merge that changed them (store.ts). Restoring
 * saves the current pulls first, so it can be undone too.
 */
function versionHistory(synced: boolean): Html {
  const list = state.snapshots;
  return html`<section class="card">
    <div class="card-body">
      <h2 class="heading-20">Version history</h2>
      <p class="copy-14">A copy of your pulls is saved in this browser before anything changes them (an import, a delete, a restore or a Google Drive merge). The last ${MAX_SNAPSHOTS} are kept. Restore one if something went wrong; your current pulls are saved here first, so you can undo it.</p>
      ${list.length
        ? html`<div class="versions">${list.map(
            (s) => html`<div class="version">
              <div class="min0">
                <div class="version-when">${fmtDate(s.at, true)}</div>
                <div class="version-what copy-13 secondary">${s.reason} · ${fmtInt(s.chars)} operator, ${fmtInt(s.weaps)} arsenal records</div>
              </div>
              <button class="btn secondary sm" data-action="restore-snapshot" data-value="${s.id}">Restore</button>
            </div>`,
          )}</div>`
        : html`<p class="copy-13 secondary versions-empty">No earlier versions yet.</p>`}
    </div>
    ${synced
      ? html`<div class="card-footer"><span>Restoring signs this browser out of Google Drive sync first, so your Drive copy stays as it was.</span></div>`
      : ''}
  </section>`;
}

/**
 * The two delete buttons, described plainly. Deleting only ever clears this
 * browser: while synced, either button signs it out first (app.ts), so the
 * Google Drive copy is never touched from here.
 */
function deleteOptions(synced: boolean): Html {
  return html`<p class="copy-14">Clears what ItJustLogs saved in this browser. It can't be undone${driveConfigured() ? ', and it never touches your Google Drive copy' : ''}.</p>
    <dl class="delete-options">
      <div><dt>Delete pull history</dt><dd>Removes your pulls. Your name, picture, settings and version history stay, so you can restore them.</dd></div>
      <div><dt>Delete everything</dt><dd>Removes your pulls, settings, pictures and version history.</dd></div>
    </dl>
    ${synced
      ? html`<p class="copy-13 secondary delete-note">You're signed in to Google Drive sync, so either button signs this browser out first. To delete the Drive copy itself: Google Drive → Settings → Manage apps → ItJustLogs → Delete hidden app data.</p>`
      : ''}`;
}

/** Repeated in the confirmation step while synced. */
const driveImpact = (): Html =>
  html`<span class="delete-drive">${icon('cloud')}This browser will be signed out of Google Drive sync first. Your Drive copy isn't touched.</span>`;


