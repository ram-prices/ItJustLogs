# ItJustLogs

Client-side pull-history tracker for Arknights: Endfield, a rewrite of
`ram-prices/eftracker`. Vite + TypeScript, no framework, no backend: everything
lives in the visitor's browser: IndexedDB for pull history and avatar/header
images, localStorage only for small settings and the banner cache. Keep it that
way: localStorage's ~5 MB is shared with every site on `ram-prices.github.io`
(the old eftracker filled it with base64 images, which broke imports).
Deploys as static files via `.github/workflows/deploy.yml` on push to `main`
and daily at 06:17 UTC (so pages made from ef-assets data stay current)
(`npm run build` → `dist/`) to GitHub Pages at the custom domain
`itjustlogs.dev` (the old `ram-prices.github.io/ItJustLogs` redirects there).
Served from the domain root, so `base: '/'` (absolute asset paths). Clean
paths need files on Pages: the `pageCopies` plugin in `vite.config.ts` copies
`index.html` into `operators/`, `arsenal/`, `stats/`, `settings/` and to
`404.html` (the fallback for `/operators/<poolId>`). Add new top-level pages
to its `PAGES` list. It also writes `operators/info/<chr id>.html` and
`arsenal/info/<wpn id>.html` (Pages serves them at the clean path) for every
item in the ef-assets wiki data, each with that item's Discord component
embed (`<script id="discord:component-embed">`, max 3,000 bytes: header with
portrait, every skill fitted, wiki credit link) and Open Graph tags as its
fallback (Discord runs no script). Built by `domain/share.ts`, fitted to
Discord's limits (OG description 350 bytes, title 70 bytes), which also
builds the (now unused) "Copy to Discord" text. If
ef-assets can't be fetched it uses `src/data/wiki-share.snapshot.json`, which
local builds refresh. New operators get a preview only after a rebuild.
Every banner and event in ef-assets `schedule.json` gets one too:
`banners/<name>.html` and `event/<id>.html` (`scheduleLinks` in
`domain/schedule.ts`; a banner name used again later adds its opening date,
and an event's `id` is a stable number ef-assets assigns and never reuses, so
links never change target). The old `/events/<name>` links still work
(`legacyEventLinks`, redirected in app.ts and built in vite.config.ts, all
marked LEGACY); the owner plans to remove them. Their embed has the key art and both servers' dates as
Discord timestamps. In the app those paths open Home at that card, row or
timeline bar (`focusScheduleItem`), and Home's right-click menu has "Copy
link". All pages are kept; if their number ever becomes a problem, drop old
ones then.

## Commands

Node lives at `C:\Program Files\nodejs` and may not be on the Bash PATH:
`export PATH="/c/Program Files/nodejs:$PATH"` first.

- `npm run dev` (or `preview_start` name `itjustlogs-dev`, port 5173)
- `npm test` (Vitest), `npm run typecheck`, `npm run build`

## Layout

- `src/domain/`: pure logic, no DOM. `parse.ts` (import formats, merge/dedupe),
  `banners.ts` (pool ids → category/patch/rate-up, asset URLs), `pity.ts`
  (probability model), `analyze.ts` (per-banner pity/guarantee/luck),
  `patches.ts` (patch + weekly aggregation). Covered by `domain.test.ts`.
- `src/state.ts`: app state + `subscribe` (redraws) and `onChange` (what the
  player changed: history, settings, a picture; sync listens to it).
- `src/store.ts`: persistence (localStorage, IndexedDB, ef-assets fetch).
- Optional Google Drive sync: `src/drive.ts` (Google Identity Services token
  client + Drive REST, scope `drive.appdata` only, so the app sees nothing but
  its own hidden appDataFolder) and `ui/sync.ts` (merge rules). The Drive copy
  is one file, `itjustlogs-backup.json`, in the full-backup shape of `ui/io.ts`
  plus `changed` times. Pulls merge like an import, with the same same-player
  check and dialog (`ui/dialog.ts`); settings and each picture are taken whole
  from whichever side changed them last (ties go to Drive); Drive's file
  `version` is re-checked right before each upload.
  - Guardrail: the Drive copy's pulls only ever grow. Every sync downloads it
    and merges its pulls in before uploading (which also restores pulls this
    browser lost), and `missingPulls` (parse.ts) refuses any upload that would
    drop one. Anything that removes pulls here (both delete buttons, "Replace
    saved pulls" on import, restoring a version) signs this browser out of
    sync first, so it never reaches Drive. Only the player deleting the app
    data in Google Drive removes the Drive copy.
- Version history (`store.ts` snapshots, `state.snapshot`): before any
  import, delete, replace, restore or Drive merge that changes the pulls, the
  previous pulls are saved in IndexedDB (`data` store, `snapshot:<id>` plus a
  `snapshots` index; last 15, identical copies skipped). Settings → Version
  history lists them with Restore (which saves the current pulls first). While synced, each copy also goes to Drive as its own
  appData file (`snapshot:<id>`, list fields in `appProperties`; `syncSnapshots`
  in ui/sync.ts), the newest 30 from every device kept; Version history
  lists them too (`meta.driveSnapshots`) and downloads one only to restore it
  (then signs out, like any restore).
  Delete pull history keeps them; Delete everything clears them. Tokens last an hour and there's no backend to refresh
  them: each visit needs one click (header Sync button / Sync now). The token
  lives in sessionStorage only. Google's script is loaded only when the sync
  card is shown or sync is on; no other visitor ever contacts Google.
  - Operator art (`ui/pages/art.ts`): pictures the player uploads or links
    to on an operator's page (a link is downloaded once, never hotlinked;
    sites that block cross-site downloads get an "upload it instead"
    message). Stored in IndexedDB (`art:<op id>:<id>`), shrunk to 2560px
    WebP. Each picture shows where the player picks (`settings.artPlaces`:
    banner, character picture, page background, Gallery slideshow), a random
    one per spot each visit. Sync copies each picture to its own appData
    file named by its key (`syncArt`), not into the backup file; removals
    travel as `settings.deletedArt` tombstones. Downloaded full backups do
    include it (`Backup.art`, data URLs; `buildBackup({ art: true })`), and
    importing one restores pictures this browser lacks.
  - It's off unless the build has `VITE_GOOGLE_CLIENT_ID` (a public value).
    Locally: put `VITE_GOOGLE_CLIENT_ID=...` in `.env.local` (gitignored). On
    Pages: the deploy workflow reads the repo variable `GOOGLE_CLIENT_ID`
    (Settings → Secrets and variables → Actions → Variables). Without it the
    card is hidden and nothing else changes.
  - Google Cloud setup (owner, once): create a project; APIs & Services →
    enable the Google Drive API; OAuth consent screen (Google Auth Platform):
    External, app name ItJustLogs, support email, add the scope
    `.../auth/drive.appdata` (non-sensitive), authorized domain
    `itjustlogs.dev`, then Publish (in Testing only listed test users can sign
    in); Clients → Create client → Web application, Authorized JavaScript
    origins `https://itjustlogs.dev` and `http://localhost:5173` (no redirect
    URIs needed). Copy the client ID into `.env.local` and the repo variable.
- UI: Geist typography and tokens as the base, but the owner is deliberately
  drifting from strict Geist toward the original eftracker feel: banner cards
  are "acrylic" (blurred art backdrop under translucent panels, hero art with
  a vignette, mono rate-up chip with a left accent bar, and a pity ruler with
  6★ portrait pins inside the opened card). Keep that direction;
  the Geist rules below are a baseline, not a ceiling.
  - `src/styles.css` is the only stylesheet: Geist tokens first
    (`--background-100/200`, `--gray-100..1000`, `--gray-alpha-*`, `--op`
    purple = operators, `--ars` teal = arsenals, `--green/--amber/--red`
    status, `--r6/5/4/3` rarity, `--radius-sm/md/lg` 6/8/12), then the Geist
    type classes (`heading-48..14`, `copy-16..13`, `label-14..12`), then
    components. Light theme is the `:root[data-theme='light']` token block.
    Phone tweaks live in the `max-width: 640px` blocks.
  - Vercel rules: borders are shadows (`--shadow-border`, `--shadow-card`,
    never CSS `border` on cards); tracking in px shrinking with size (-2.4px
    at 48, -1.28px at 32, -0.96px at 24, -0.32px at 16, 0 at 14); weights
    400/500/600 only; Geist Mono uppercase for technical labels (metric
    labels, table headers); pill badges; blue `--focus` ring and `--link`.
    Colour is for data only (rarity, pity heat, operator/arsenal), not chrome.
  - Fonts: Jost everywhere (weights 300–700 differentiate text: 400 body, 500
    labels, 600 headings/numbers, 700 list names); Geist Mono only for code. Icons: Material Symbols Rounded weight 300,
    loaded with an explicit `icon_names=` list in index.html: add new names
    there (alphabetical).
  - Sentence-case labels; inline styles only for data-driven values.
  - `index.html` is a bare shell (`#app`, drop overlay, file input).
    `ui/app.ts` renders header + tabs, routes on clean paths (`/` Home,
    `/operators`, `/operators/<poolId>`, `/arsenal[/<poolId>]`, `/stats`,
    `/settings`) with `history.pushState` for in-page links, rewrites
    old `#/...` links, and holds the delegated `data-action` click handlers.
    Pages live in `ui/pages/` (`home.ts` = the schedule: banners open now
    with your pity and rate-up status, events now, coming up, and a
    version/banner/event timeline; works without an import; anything with
    `data-link` or `data-card-image` gets a right-click / long-press menu
    (`installCopyMenu`: Copy link, Copy image via `ui/cardImage.ts`); `kind.ts` = operators/arsenal: every banner as a fixed-height card
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/operators/<poolId>` opens one), `operator.ts` / `weapon.ts` = `/operators/info[/<chr id>]` / `/arsenal/info[/<wpn id>]`, info from the wiki data plus the player's copies and Potential (`domain/owned.ts`: pulls + Token/Issue reward copies, shown as P0–P5: P0 is the first copy, each duplicate adds one, P5 (6 copies) is max; the copy that reached P5 and later spare copies are dated; Selectors aren't counted; the Operators/Arsenal pages (breadcrumbs Operators › Headhunting, Arsenal › Issues) switch to them with `kindNav`, and without an import those tabs open them; "All banners" (setting `showAllBanners`) adds every opened banner the player never pulled on, from `domain/catalog.ts`); shared pieces in `info.ts`; works without an import; operators and weapons the wiki doesn't have yet come from ef-assets `wiki/previews.json` (the official version guide: class, element, tags, kit summary, banner) as "Coming soon" pages and list rows (`previewPage`), until the wiki's entry replaces them; 6★ strip and ruler portraits link to it), `stats.ts`, `settings.ts`); shared pieces in
    `ui/components.ts` (metric, badge, toggleGroup, pageHeader...);
    import/export in `ui/io.ts`; charts in `ui/charts.ts`.
  - Escape every user/game string: use the `html` tagged template from
    `ui/html.ts` (`raw()` only for trusted markup).
  - Signature features of the old site (6★ portrait strip, pity ruler, luck
    curves, profile header) are being re-added one at a time in Geist style.
- `scripts/export-pulls.ps1`: the PowerShell exporter, shown in Settings → Get
  your data via `?raw`. Keep it readable and dependency-free. Its only network
  target must stay `ef-webview.gryphline.com`. Character pool types are a fixed
  list; the server stopped listing valid values in its error message.

## Domain rules worth knowing

- Chartered Headhunting 6★ pity is shared across all Chartered banners; the
  120-pull rate-up guarantee is per banner. Basic, New Horizons and each Joint
  pool keep their own pity. Weapon pity and the 80-pull guarantee are per banner.
- Arsenal Issues are pulled in sets of 10 and the game treats each set as one
  pull: weapon pity is out of 4 sets, the rate-up guarantee is the 8th set.
  Rewards: a Selector on set 10 (non-rate-up weapons, not a copy), then every 8
  sets alternating a rate-up copy and a Selector (18 copy, 26 Selector, ...). `analyze.ts` stores weapon pity,
  guarantee and rewards in sets (`setOf`); rulers and labels show set numbers.
- Imports check they're from the same player (`compareHistories` in
  `parse.ts`): within the saved history's time span, an export of the same
  account has the same pulls (time + item; seqId is ignored since some
  exporters omit it). Under 90% matching, or no overlap at all, the app asks
  (Cancel / Replace saved pulls / Add anyway) instead of merging.
- Free pulls never touch pity. Banner rewards are listed in the export but are
  not pulls and are filtered out (`isGift`: any `kind: gift_*`):
  `gift_intel_book` (Headhunting Dossier), `gift_operator_token` (Token),
  `gift_weapon` (Arsenal rate-up copy, no `weaponId`), `gift_weapon_box`
  (Selector). Reward counts come from the schedule in `analyze.ts`, not these.
  Exception: copies owned (`domain/owned.ts`) use the Token and `gift_weapon`
  records where the export lists them (only banners from 1.4 on do; it gave
  Arcane a Token at 130 pulls, which the schedule wouldn't), and fall back to
  the schedule, marked estimated, for older banners. `analysis.gifts` holds them.
- `rateUpPmf` clamps `startPity` to `hardPity - 1`. Pity resets on hit, so
  `hardPity` itself is not a real state.
- Operator/weapon/gear info comes from ef-assets `wiki/*.json`, snapshotted
  weekly from endfield.wiki.gg by ef-assets `scripts/update-wiki.mjs`
  (`domain/wiki.ts` has the types and the text markup). It's CC BY-SA 4.0:
  any page showing it must credit "endfield.wiki.gg, CC BY-SA 4.0". Too big
  for localStorage, so it's fetched on demand (`loadWikiFile` in store.ts).
- Banner names/rate-ups come from `ram-prices/ef-assets/banners.json`
  (snapshot in `src/data/` for offline/tests, refreshed at runtime). Fix bad
  banner data there, not with special cases here.
- The banner schedule is ef-assets `schedule.json` (snapshot in `src/data/`,
  types and helpers in `domain/schedule.ts`). ef-assets builds it from the
  official news feed with `scripts/update-schedule.mjs` (a workflow runs it
  every 3 days and opens a PR). Times are per server: dated banners open at
  the same local time on Americas/Europe (UTC-5) and Asia (UTC+8), 13 hours
  apart; version updates are one instant. `end` is null while it depends on
  an unannounced banner. `events` come from each version's update notes
  ("New Events"); some have separate windows per server. An event's `art`
  comes from the official New Version Guide (replaced every version), which
  the same workflow saves to ef-assets `events/`; Home's event rows show it,
  else an icon. Arsenal Issue art is `issues/<weapon>.webp` (text-free,
  made with ef-assets `scripts/issue-banner.py`). The player's server is a setting (guessed from the
  time zone until chosen).
- `fixtures/` is gitignored and holds the owner's real export. Never commit it.
