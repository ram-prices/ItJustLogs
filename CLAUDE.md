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
Served from the domain root (`base: '/'`). Every clean path, item, banner and
event gets a built page with its Discord embed (`pageCopies` in
`vite.config.ts`; add new pages to its `PAGES` list): see `docs/pages.md`.

## Area notes (read the one you're working in)

- `docs/rotations.md`: Rotations tab, DPS sim (`src/domain/sim/`), the
  gameplay-recording Parser, parsed runs.
- `docs/ui.md`: styles in full, icons, Home widgets, routing, what each page
  file holds.
- `docs/sync.md`: Google Drive sync, version history, operator art, profile
  picture, Google Cloud setup.
- `docs/tabs.md`: Achievements, Archive, Story, AIC, Essences (and their
  screen readers).
- `docs/income.md`: Stats → By patch free pull income.
- `docs/pages.md`: built pages, Discord embeds, event pages, legacy links.

Keep these up to date when you change an area; keep this file short.

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
- UI essentials (more in `docs/ui.md`): Geist tokens and type classes as a
  baseline, drifting toward the old eftracker "acrylic" feel. `src/styles.css`
  is the only stylesheet; light theme is `:root[data-theme='light']`; phone
  tweaks in `max-width: 640px` blocks; pages up to 1600px (`.container`).
  Borders are shadows (`--shadow-border`); weights 400/500/600; Jost
  everywhere, Geist Mono only for code; colour for data only; sentence-case
  labels; inline styles only for data-driven values. Icons: Material Symbols
  Rounded, add names to `icon_names=` in index.html (alphabetical). Rarity is
  the game's emblem (`stars`, `withStars`), Potential is written "P3".
  Escape every user/game string with the `html` template (`ui/html.ts`).
- Readers (medals, findings, essences, gameplay recordings) are Tesseract.js +
  rules, no AI, pinned by tests with real samples.
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
- Never commit: `fixtures/`, `tools/ai-parser/` (owner's personal tool),
  `src/domain/sim/dbg*.test.ts` and `dbgTeam*.ts` scratch, `.claude/launch.json`,
  `essence-icon-preview.html`, `essence.svg`.
