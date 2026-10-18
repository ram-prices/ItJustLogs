import exporter from '../../scripts/export-pulls.ps1?raw';
import { ICONS } from './common';
import { html, raw, type Html } from './html';

// The trailing newline closes the block when pasted; PowerShell still needs one Enter to run it.
export const EXPORTER_SOURCE = `${exporter.trim()}\n`;

export function guideView(): Html {
  return html`
    <div class="page-head">
      <div>
        <h1>Get your pull history</h1>
        <p>Two steps on Windows. Takes about a minute.</p>
      </div>
    </div>
    <div class="prose">
      <div class="callout">
        ItJustLogs never asks for your account token or history link. A short script runs on your own PC, talks
        only to Gryphline’s official server, and hands the result to this page. Everything below is the
        complete script, so you (or someone you trust) can read all of it before running it.
      </div>

      <h2>1. Open your history in-game</h2>
      <p>Launch Arknights: Endfield and open the <b>Headhunting → History</b> page once. This refreshes the
        temporary link the script reads. The link expires after a while, so do this right before step 2.</p>

      <h2>2. Run the exporter in PowerShell</h2>
      <ol>
        <li>Press <kbd>Win</kbd>, type <b>PowerShell</b>, and open <b>Windows PowerShell</b>. Don’t choose “Run as administrator”, because it isn’t needed.</li>
        <li>Copy the script below and right-click inside the PowerShell window to paste it. If the last line shows <code>&gt;&gt;</code>, press <kbd>Enter</kbd> once more to run it.</li>
        <li>When it says <i>Done</i>, come back here and press <kbd>Ctrl</kbd>+<kbd>V</kbd>. The file is also saved to your Desktop.</li>
      </ol>
      ${scriptBlock()}

      <h2>What the script does</h2>
      <ul>
        <li>It reads the game’s web cache in <code>%LOCALAPPDATA%\\PlatformProcess\\Cache</code> to find the history link the game last opened.</li>
        <li>It downloads your operator and arsenal history from <code>ef-webview.gryphline.com</code>, the same server the in-game page uses.</li>
        <li>It writes <code>endfield_pulls_DATE.json</code> to your Desktop and copies the same text to your clipboard.</li>
        <li>It does <b>not</b> need admin rights, change settings or execution policy, contact any other server, or download other code.</li>
      </ul>

      <h2>Keeping history forever</h2>
      <p>The game only shows recent history. Each new export is <b>merged</b> into what this browser already
        has, so older pulls are kept. Download a backup from <a href="#/settings">Settings</a> now and then.</p>

      <h2>Already have an export?</h2>
      <p>Files from the old eftracker site and from <code>track.py</code> work too. Drop one anywhere on this page.</p>
    </div>
  `;
}

export function scriptBlock(): Html {
  return html`<div class="code-block">
    <button class="btn" data-action="copy-script">${raw(ICONS.copy)} Copy script</button>
    <pre><code>${EXPORTER_SOURCE}</code></pre>
  </div>`;
}
