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
`index.html` into `database/operators/`, `banner/headhunting/`, `settings/`...
and to `404.html` (the fallback for `/banner/headhunting/<poolId>`). Add new
pages to its `PAGES` list. It also writes `database/operators/<name>.html` and
`database/arsenals/<name>.html` (Pages serves them at the clean path; the
name is `itemSlugs` in `domain/wiki.ts`, the id when a name is shared) and
the same page at the old `operators/info/<chr id>.html` and
`arsenal/info/<wpn id>.html` for every
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
Discord timestamps. In the app a banner's path opens Home at that card, row
or timeline bar (`focusScheduleItem`); an event's path opens its own page
(`ui/pages/event.ts`): dates, details, phases and its rewards from ef-assets
`wiki/events.json` (whose wiki end dates fill in events the notes leave
open, `withWikiEnds`, on the event page and Home) (`scripts/event-rewards.mjs` there; totals as
Headhunting pulls at 500 Oroberyl each, `domain/eventRewards.ts`; `partial`
when the wiki names rewards without amounts). Home's event rows and
timeline bars link to it, and Home's right-click menu has "Copy link".
Stats → By patch adds each version's free pulls (`domain/income.ts`): its
events (plus events.json `extra`: the wiki's mid-version events, by start), daily missions and Weekly Routine for every day and week of the
version (resets at 04:00 server time), the Protocol Pass free track, the
maintenance compensation in its official Version Update Notes and the
permanent missions it released (main story by the notes' "available up to",
others by the wiki's version pages or their region), what its permanent
modes hand out anew (Echoes of War seasons, Monumental Etching, Delver of the
Cryptic...: its notes' Event & Gameplay Updates, else the wiki) and its new
outposts, a rough estimate for
the storage crates in the areas it added (wiki crate counts times an average
Oroberyl per crate, badged Estimate), the Origeometry its areas' Aurylene
unlocks (each region's TP Point table; Partial past the table's end on the
wiki), and hand-kept community-guide amounts with sources (version preview
livestream, version survey, Combat Drills), the Crafting
Manual's milestones, one-time progression at launch (Node milestones,
Authority Level), and our own rough estimate (an event or mode the wiki names
without amounts gets the median of its kind, marked ≈); one-time rewards by
the version that added them (`oneTime`: Operational Manual stage first
clears, Regional Development levels, Intel Gathering, mail events, launch
codes) and the Credit Store's daily stock on average (Estimate); the SKPORT
web check-in, Twitch drops and birthday mail are left out (owner's call). Each
Headhunting Dossier (60 paid pulls on a Chartered banner) is 10 pulls for the
next Chartered banner's patch; Basic Headhunting pulls' Arsenal Tickets and
Bond Quota count for the patch they were made in. Limited-time rewards that
ended before the player's first pull are left out (`since`: events, passes,
mail `until`, a version's compensation, survey, livestream, Combat Drills and
AIC permits once it's over); dailies and weeklies count from that pull. The
quota shops count too: the AIC Quota Exchange's banner HH Permits (official
notes, else 5 per Chartered/Special banner) and the Bond Quota the player's
duplicate 5★/6★ operators gave (25 per Chartered HH Permit). The breakdown
lists pull currencies only, credits only the wiki, and the table ends with a
total (patch banners only, to today). No
third-party spreadsheet is used: the owner wants our own estimate. From
ef-assets `wiki/income.json` (`scripts/income.mjs` there), plus the Arsenal
Tickets Headhunting gives back; marked on the bars, listed by source when a
patch is opened. Headhunting counts limited pulls (Basic HH Permits are
listed apart, as community pull counts do). The current patch is projected
to the next version's release, or else its last banner or event end.
Toggles (setting `paidIncome`) add Originium Supply, Protocol Customized
and the Monthly Pass. All pages are kept; if their number ever becomes a problem, drop old
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
  - The profile picture's original (at most 1024px) with its framing and
    painting (`AvatarEdit` in store.ts, for Edit picture) syncs as one
    appData file, `avatar-edit` (`syncAvatarEdit`; the newer `at` wins, gone
    with the picture), and goes in downloaded backups (`Backup.avatarEdit`).
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
  - Home plays a looping game clip behind it (`ui/videoBackground.ts`): the
    one picked in Settings → Backgrounds (`homeClip`, or 'none'), else one of
    ef-assets `backgrounds/index.json`'s defaults at random (its `operators`
    map is unused for now). Clips are made with ef-assets
    `scripts/background-clip.py` from the owner's recordings (seamless loop,
    1280x720 WebM + MP4 + first-frame JPG, bottom strip with the player's UID
    always cut off). Settings → Backgrounds Still, reduced motion, phones and
    Save-Data get the still frame only. Pictures (banner art, headers, the
    Character card) shift a little against the mouse (`ui/parallax.ts`;
    Arsenal Issues in layers from ef-assets `banners/layers/`, the weapon
    floating). Firefox puts moved-only pictures on whole pixels (twitching);
    `transform: perspective(600px) rotateY(0.02deg)` stops it, measured on a
    real screen (a flat `rotate` fixes headless Firefox only).
  - Oroberyl, wherever named, shows its game icon in red: `itemName` in
    `ui/components.ts` (`public/icons/oroberyl.webp`, `--oroberyl`).
  - Rarity is drawn with the game's emblem, not a ★ glyph: `STAR_SVG`,
    `stars(n)` and `withStars(text)` in `ui/components.ts` (endfield.wiki.gg
    Star.svg, in the text's colour). Keep "★" only in attributes and
    `<option>` text. Potential is written "P3"; the game's Potential star
    (`potentialStar`) only beside that text or as decoration.
  - `index.html` is a bare shell (`#app`, drop overlay, file input).
    `ui/app.ts` renders header + tabs, routes on clean paths (`/` Home,
    `/database/operators[/<name>]`, `/database/arsenals[/<name>]`,
    `/banner/headhunting[/<banner>]`, `/banner/arsenal[/<banner>]`,
    `/banner/stats`, `/settings`) with `history.pushState` for in-page links,
    and holds the delegated `data-action` click handlers. URLs use English
    names: items by `itemSlugs`, banners by the name `scheduleLinks` gives
    them (`bannerSlugs`), else the id; links are built by `infoHref` /
    `bannerHref` in `pages/info.ts`, and the router swaps ids for names. Old
    paths (`/operators/info/<chr id>`, `/arsenal/<poolId>`, `/stats`, `/pulls`,
    `#/...`) are moved to today's (`currentPath`), and their folders are
    still built, so old links keep working.
    Header tabs: Home, Database, Pulls, Essences, Achievements, Archive,
    Settings. Database (`/database/...`) and Pulls (`/banner/...`) are
    sections picked with side tabs (`databaseTabs` / `pullsTabs` in
    `pages/info.ts`); `/database` and `/banner` open the page last used there.
    Home is widgets (`ui/pages/homeWidgets.ts`, settings `home`: type, width
    4/6/8/12 of a 12-column grid, own settings; unset = the schedule as
    before): the schedule's four sections, Pity, 6★ history, Latest pulls,
    Stats, Collection, Note and Character card (an operator, one of their
    pictures, title, note, chosen facts) and Empty space (full width, height
    dragged). Customize: drag to move (near a widget's top or bottom stacks
    it in that widget's column; into empty room in a row it lands there at
    that column, `col`, shrunk to fit, outlined while dragging: `roomAt`),
    width, title, edit, remove, add, reset, cancel; a narrower widget can be
    placed left, middle or right of its row (`align`); width and place change
    each widget on its own (`separate`): `gridPlaces` gives every widget or column an
    explicit row and column on wide screens (`newRow` keeps a widget placed
    out of a column at its height), and placing one pins the others in its
    row where they are. On a phone (640px wide or less) Home is one column
    with its own order and hidden widgets (settings `homePhone`, the same
    widgets; unlisted ones follow in the wide layout's reading order):
    Customize there only reorders, edits, and hides/shows. Home's event rows
    have a tags line (`eventTags`: Limited/Permanent, Limited-Time Rewards,
    Daily Rewards with how long's left to start them, Unique) from ef-assets
    events.json `permanent`, `limitedRewards`, `days`, `unique`.
    The profile picture can rise above its
    circle (settings `avatarPop`; `avatar` in components.ts): `cropper.ts`
    gives a frame 2.5 circles wide and 1.4 tall where the player paints what
    shows outside the circle (with a live preview); it's saved trimmed to
    what shows, see-through elsewhere, and settings `avatarBox` says how far
    it reaches left and right, so room is made only on those sides.
    Every saved picture is kept (last 12, `SavedAvatar` in store.ts, this
    browser only) under Saved pictures, to use again or delete.
    Pages live in `ui/pages/` (`home.ts` = the schedule: banners open now
    with your pity and rate-up status, events now, coming up, and a
    version/banner/event timeline; works without an import; anything with
    `data-link` or `data-card-image` gets a right-click / long-press menu
    (`installCopyMenu`: Copy link, Copy banner card, or Share banner card on phones, via `ui/cardImage.ts`); `kind.ts` = operators/arsenal: every banner as a fixed-height card
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/banner/headhunting/<banner>` opens one), `operator.ts` / `weapon.ts` = `/database/operators[/<name>]` / `/database/arsenals[/<name>]`, info from the wiki data plus the player's copies and Potential (`domain/owned.ts`: pulls + Token/Issue reward copies, shown as P0–P5: P0 is the first copy, each duplicate adds one, P5 (6 copies) is max; the copy that reached P5 and later spare copies are dated; Selectors aren't counted; the Operators/Arsenal pages (breadcrumbs Operators › Headhunting, Arsenal › Issues) switch to them with `kindNav`, and without an import those tabs open them; "All banners" (setting `showAllBanners`) adds every opened banner the player never pulled on, from `domain/catalog.ts`); shared pieces in `info.ts`; works without an import; operators and weapons the wiki doesn't have yet come from ef-assets `wiki/previews.json` (the official version guide: class, element, tags, kit summary, banner) as "Coming soon" pages and list rows (`previewPage`), until the wiki's entry replaces them; 6★ strip and ruler portraits link to it), `stats.ts`, `settings.ts`); shared pieces in
    `ui/components.ts` (metric, badge, toggleGroup, pageHeader...);
    import/export in `ui/io.ts`; charts in `ui/charts.ts`.
  - Escape every user/game string: use the `html` tagged template from
    `ui/html.ts` (`raw()` only for trusted markup).
  - Signature features of the old site (6★ portrait strip, pity ruler, luck
    curves, profile header) are being re-added one at a time in Geist style.
- Achievements and Archive tabs (`ui/pages/collections.ts`, types in
  `domain/collections.ts`): the game's Medal Album and Intel Archives
  (Findings' Manuscripts, E-Files and Peculiars, then Audio Records, Nexus
  Files and Intel Gathering), one category tab at a time; work without an
  import. The reader only reads Findings. Data is ef-assets `wiki/medals.json`
  and `wiki/findings.json` (its `scripts/wiki-collections.mjs`, weekly) with
  pictures from its `collections/` (`scripts/collection-pictures.py`), copied
  into `src/data/medals.snapshot.json` and `findings.snapshot.json`
  (lazy-loaded chunks) by our `scripts/wiki-collections.mjs`; no picture
  loads from the wiki. The
  player's progress is settings (`medals`: date, Reforging tier, Trimmed;
  `findings`: ids), so it syncs and exports. "Read from video or
  screenshots" (`ui/medalReader.ts`) reads the Medal Album in the browser:
  Tesseract.js from jsDelivr, loaded only on that click, on whole frames
  scaled to 1080 tall (any aspect ratio); `domain/medalReader.ts` matches
  lines to medal names by rules (no AI: noise stripped, numerals fixed,
  impossible dates dropped, majority vote across frames), pinned by
  `medalReader.test.ts` with real lines; a review screen saves only what's
  ticked.
  Archive has the same button (and paste/drop on its page):
  `ui/findingReader.ts` + `domain/findingReader.ts` split each frame's words
  into tile names (gaps, "~~" marks and "…" end a name), match the cut-off
  names by how wiki names start (spaces ignored), and settle look-alikes
  ("Agent Data: Ha…" ×3) by the grid's order, which is the wiki list's: the
  longest chain of tiles that rises through the list wins; leftovers seen in
  2+ frames are listed as not on the wiki yet. `ui/screenReader.ts` is the
  shared part (files → frames at 1080 tall, Tesseract.js, progress dialog).
  The medal reader also reads each reforgeable/trimmable medal's look
  (`domain/medalTier.ts`: dark/silver/gold = base/Reforged II/III,
  holographic = Trimmed) from a square of its picture beside the title,
  rules pinned by `medalTier.test.ts` with real samples.
- Story tab (`ui/pages/story.ts`, types in `domain/story.ts`; `/story`,
  `/story/<mission name slug>`): every mission's dialogue from the game's own
  text, read from ef-assets `story/` (`scripts/story.mjs` there, weekly: the
  EndfieldData community dump at git.escartem.moe, a datamine of the game's
  tables; the text is Gryphline's, credited as such, not CC BY-SA).
  `index.json` groups missions as the wiki's Mission/Main and Mission/Side
  pages order them; sections the wiki doesn't index yet are `unlisted`
  (folded away: maybe unreleased). Each mission file has its scenes with the
  game's own summary, lines with speaker (operator portraits via `actor`),
  and the replies offered; where a reply falls in the scene isn't in the
  dump, so they're listed after the scene. Lines without English text are
  left out. Works without an import; loaded on first use (`lazy`). The
  list's search field (`searchField` in pages/search.ts, visible so phones
  can use it) filters missions by name and chapter, and from 3 letters lists
  matching lines from ef-assets `story/search.json` (loaded on the first such
  search); a result opens `/story/<mission>#l-<scene>-<line>`, scrolled to and
  marking that line (`scrollToLine` in app.ts).
- Essences tab (`ui/pages/essences.ts`, `domain/essences.ts`): the player's
  essences (settings `essences`: kind key → count) against every weapon's
  skill stats; only perfect fits (all of a weapon's stats) are suggested, by
  weapon or by essence. `ui/essenceReader.ts` + `domain/essenceReader.ts` read
  a recording of Valuables → Essences, Etch Essence or a weapon's essence
  screen: find the stat column once, then read only that area every 0.1s
  (`scan` focus option); a new essence each time the stats change and hold
  two frames.
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
- ef-assets pictures (portraits, gear, banner art and layers, item icons,
  schedule art via `cdnUrl`, backgrounds) load from jsDelivr
  (`EF_ASSETS_CDN`: browsers keep them a week; a changed file reaches the CDN
  within 12 hours, or purge `https://purge.jsdelivr.net/gh/ram-prices/ef-assets@main/<path>`),
  data files (`schedule.json`, `banners.json`, `wiki/*`, `icons/index.json`)
  from raw.githubusercontent (`EF_ASSETS`, fresh within minutes). A failed
  load tries the other mirror once (`mirrorUrl`, `data-fallback` images).
  The screen readers, the cropper and the Essences page are loaded on first
  use (`lazy` in app.ts, dynamic imports), so every visit downloads less.
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
