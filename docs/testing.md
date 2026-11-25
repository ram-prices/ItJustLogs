# Testing and verifying the site

Where to test, which data to load, and the traps in checking the site from a session.

## Servers and data

- 5173 (`itjustlogs-dev`, a friend's pulls) and 5174 (`itjustlogs-lan`, the owner's pulls) hold real
  data: view only. Never change a setting, avatar or saved result there. Test on 5175
  (`itjustlogs-test`), 5176, 5178, or 4173 (`npm run preview`, serves `dist/`, rebuild first).
  `.claude/launch.json` is local config, never committed.
- Every preview loads `D:\Development\ijl_DEFAULT.json` (not `fixtures/`, not any other backup).
  Vite won't serve files outside the project: copy it to `public/_tmp/`, set it on `#fileInput` via
  `DataTransfer` and dispatch `change`, delete the folder afterwards. Never commit or upload it.
- Saved runs live in IndexedDB, shared by every tab on one origin. After an engine change, replay
  them (Edit → Play edited transcript) and report before/after (total, clear time, per operator);
  the owner's own tab keeps old results in memory until reloaded.

## Off-screen checks (headless Edge)

The owner's screen is not a test surface; check from a headless browser.

- The Vite dev server binds IPv6 only: open `http://[::1]:5175/` (127.0.0.1 is refused).
- Headless Chrome with a fresh profile is network-blocked on this machine; use headless Edge:
  `msedge --headless=new --no-sandbox --disable-gpu --no-proxy-server --remote-debugging-port=9333
  --user-data-dir=<temp> "http://[::1]:5175/"`, then drive it over CDP (`/json/list` →
  `webSocketDebuggerUrl`; `Runtime.evaluate`, `Page.captureScreenshot` to a file).
- `#fileInput` exists only after Vite connects. To load the preview data there, inject the file as
  base64 and build the `File` in the page.
- `--virtual-time-budget` fast-forwards timers, so app timeouts (e.g. the 8 s IndexedDB open
  timeout) fire at once: a false alarm.
- Headless reads an animation's time, not what was painted: Firefox entrance glitches only show in
  the owner's recordings (`docs/ui.md`).

## OpenChamber browser pane

- It doesn't tick the compositor or requestAnimationFrame in the background: CSS animations look
  stuck (banner cards at opacity 0), timeline playback never advances (test the player by seeking:
  set `.sim-play-seek` and dispatch `input`/`change`), `loading="lazy"` images never load. Colour and
  layout still read correctly. For "does it animate", use headless Edge.
- Gameplay video reads in a background tab get about 4 fps and lose actions: don't judge reader
  accuracy there. Dev builds keep the last read's frames; `window.__reread(asDraft)` redoes it.
- Stale CSS: the pane caches CSS modules, and a leftover `vite preview` on the same port can answer
  IPv4 requests. Mixed old/new values in one file mean: stop any preview on 5175, restart the dev
  server (`npm run dev -- --port 5175 --strictPort`), open a fresh tab.
- If typing fails with "Browser page lost keyboard focus": add a temporary script to `index.html`
  that reads `?param=<value>`, sets the input's value and dispatches a bubbling `input` event; verify,
  then delete it.
- Screenshots come back about 800px wide: zoom the page (`document.body.style.zoom`) for detail. For
  pixel checks (the owner notices 1–3px) measure with `getBoundingClientRect` and Range rects.

## Editing traps

- The repo mixes CRLF and LF files: keep each file's endings, and compare against HEAD before a
  commit. `sed -i` in Git Bash strips CRs. Write patch scripts with the Write tool, not heredocs
  (backslashes, quotes and `\b` get mangled; a heredoc into Python once hung).
- Vite HMR serves stale modules here ("x is not defined", missing exports): restart the dev server.
  Editing files mid-test reloads the page and kills long runs.
- The CSS minifier empties `border-image: none`; use `border-image-source: none` and check a build.
- `icon_names=` in `index.html` must stay alphabetical.
