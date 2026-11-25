# Coordinator (hub) sessions

How a coordinator session runs ItJustLogs work. The general rules (models, token pacing, local-model
workers, workers never delegate) are in the global `AGENTS.md`; this file adds what is specific to
this project. Read it with `CLAUDE.md`, `docs/history-handoff.md` (what was tried, removed and ruled
out) and `docs/testing.md`.

## Roles

- The coordinator plans and briefs; workers implement. Start a worker with OpenChamber
  `session.create` (`ownWork: true`, model `claude-agent/opus` with variant `medium`, or the local
  model for mechanical work); the answer comes back as a message.
- A brief has: the task; the area doc to read (`docs/rotations.md`, `ui.md`, `sync.md`, `tabs.md`,
  `income.md`, `pages.md`, `testing.md`); the files involved; what done looks like; test servers
  5175/5176/5178 only (never 5173/5174, real data); quiet test output; update the area doc; don't
  commit; never start sub-workers; a 2–3 line report.
- Deploying: only when the owner says "deploy", for that batch only, following CLAUDE.md →
  Deploying. "Deploy once workers are finished" means wait until every worker is idle.
- ef-assets (images, game data) may be pushed directly by workers as `ram-prices` /
  `celestriad@pm.me`, from the permanent checkout `C:\Users\Albert\Development\EF Assets` (rules in
  CLAUDE.md → Deploying: clean and pulled first, one worker at a time, a worktree for parallel work).
  Name the folder in every ef-assets brief. Site changes stay local until a deploy.

## Practical rules

- Sim engine, Parser and `ui/pages/rotations*` work: one worker at a time (shared files).
- Sonnet only at high effort: a Sonnet-low worker broke the event page layout (2026-10-30).
- Engine rules come from game data (the dump first, then ef-assets). Footage only confirms
  mechanics and is never a DPS target. Flag any rule modelled from footage.
- Name every recording event with its video time (e.g. Mirage 1, video 12.95 s).
- Reading a recording: a worker with `/parse-recording <path>` (follows `tools/ai-parser/README.md`).
  It only touches `tools/ai-parser/`, so it can run beside a Rotations worker.
- Rule tests (`src/domain/sim/rules.test.ts`, `rules2.test.ts`, `rules3.test.ts` for 1.7 on; harness
  `testkit.ts`): to add an operator, a worker writes its table (id, name, setups, rules from the
  `rules` builders, each naming its source) and adds it to `OPERATORS` (rules2/rules3: the list
  passed to `runTables`). A failing row is a finding for the owner: marked `finding` (an expected
  failure), never made to pass.
- Settled, don't offer variants: the operator hero gradient; the Storage box is a plain store that
  never fetches from links; the Android wrapper stays a WebView, never a TWA.
- The owner often steers workers directly: read a worker's final message before relaying it.
- Replies short. No hints, asides or parentheticals in site copy. The owner reverses decisions
  freely: implement cleanly, remove cleanly.

## Things a new coordinator must know

- **ef-assets hosting.** Since 2026-11-25 the site loads every ef-assets file from Cloudflare Pages
  at `assets.itjustlogs.dev` (deployed from `main` on every push; free plan: 20,000 files, 25 MiB
  each; ef-assets is about 2,200 files), with raw.githubusercontent as the fallback (see CLAUDE.md).
  Cache rules are ef-assets' `_headers`. The old jsDelivr `cdn`, `cdn-full` and `cdn-potential`
  branches and their `scripts/cdn-branches.sh` workflow stay until the site change is deployed and
  live, then go (open item). Its workflows commit straight to `main` (no pull request branches).
- **Contingency Contract.** One stage per season, Test Criteria worth 1–3 points. Data: ef-assets
  `cc/index.json`, `cc/seasons/<id>.json`, schema and share-code spec in `cc/README.md`. Site:
  `src/domain/contracts.ts`, `src/ui/pages/contracts.ts`, `src/styles/contracts.css`, `docs/tabs.md`.
- **Server-delivered text.** New-season criteria text is not in any dump: its ids are in
  `I18nTextServerTimeIdTable` and come from the server at runtime. Redumping never helps.
  Transcribed text goes in ef-assets `cc/transcribed/<season>.json`, which `update-cc.py` must not
  overwrite.
- **Game dump.** `docs/game-dump.md`; the owner reruns `run_all.bat` after a client update.
- **Music.** Parked three times ("hold off"); options are in `docs/history-handoff.md`. Don't raise
  it unasked.
- **Gacha reveal effects.** Researched fully; rejected on operator cards. Don't re-offer.

## Open items (as of 2026-11-16; the owner decides the order)

1. Last Rite run about 10% short (4.08M of 4.54M by 31 s); likely the other player's unknown crit
   gear. Parked.
2. Summons running through other operators' cut-ins were modelled from footage, not game data;
   they need a data source. Tangtang's Whirlpools through cut-ins are unverified.
3. Yvonne's Final Strikes read 1.15–1.45× high in the owner's runs (crowded readings); they need a
   clean read before any engine change.
4. Last Rite's battle skill gave 17–27 SP in footage vs the sim's 30.
5. Rule-test findings still open: group E (Arclight's third slash, Perlica's Cycle Protocol, Rossi's
   combo SEQ 1, Purrchena's hold) and Endministrator P1, Avywenna's lances, Camille's Vesperwings,
   Liino's Starry Boost (`docs/rotations.md`, "Tracked sim-vs-data gaps").
6. Owner checks parked: a Drive upload over 5 MB.
7. Contracts, Indigo: 21 of 39 criteria unnamed, 18 inferred (`matchedBy`). Needs the owner's
   recording of the criteria screen (about 2 s per criterion); the owner said to leave it. Stage
   timer unknown (`timer: null`); no tag-to-buff map. Share codes never pasted into the real game.
   The picker leaves out the game's cached locked criteria that return when a key is re-picked.
8. `wikiFile` has no guard after a failed load, so a failed file may refetch on every redraw
   (affects `events.json` and `cc/` on Home). Seen in code only, not fixed.
9. Argent Flow (`chr_0037_minghe`): the operator page footer credits the wiki snapshot date though
   his numbers came from game tables (needs a per-operator source). Once the wiki lists him, delete
   his entry from ef-assets `wiki/operators-game.json`. `final-strikes.json` must be regenerated for
   each new operator.
10. Visual: New Horizons banner art has a baked title. Never seen on real hardware: Firefox heroes,
    reduced motion on a device, light-theme skeletons, the phone picture dialog (689659c). The
    banner page header's Rate-up line and Joint banners' "N rate-ups" are plain text.
11. Income sources not added (no source found): see `docs/income.md`.

## Parked ideas (raise when relevant, don't start unasked)

- **Password-locked features** (parked 2026-10-22): lock the AIC optimizer (multi-site plans; the
  basic recipe calculator stays open) and the full story summaries behind a password, because the
  site may "suck out the fun". Recommended start: a soft gate (code stays public). A real lock would
  move the source to a private `ram-prices/itjustlogs-private` repo, checked out by the deploy
  workflow with a read-only deploy key, each private chunk encrypted at build time (AES-GCM, key from
  a slow KDF on the password; source maps inside the encrypted bundle) and only ciphertext
  published; never print private source in public workflow logs. ef-assets `story/` and `aic/` are
  already public, history included. Per-person accounts would need a backend.
- **AIC schematic layouts** per area: on hold until the map art is decoded. Terrain tiles
  (`StreamingAssets/Terrain/.../Terrain_*_{A,C,H,N}.bytes`) are an undocumented, unencrypted format.
- **AIC planner depot belts:** plans treat moving items through the depot as free; really each belt
  needs a core port (14 in / 6 out free) or a Depot Loader/Unloader (1 Protocol Capacity). ef-assets
  `aic/planner.json` has the `depot` facts; the model isn't changed.
- Feature ideas offered, none started: pull planner, luck percentile, operator compare, build links,
  Rotations out of WIP, result compare, structured event rewards, share card, per-banner stats under
  the hero, operator pull plan, search, offline service worker, changelog page.

## Android apps (own repos, outside this one)

- Native app: `C:\Users\Albert\Development\ItJustLogs Android` (no remote; commit only when the owner
  says). `PLAN.md` there is the plan, `README.md` the build and install steps. `:domain` is the site's
  `src/domain/` ported 1:1; last site commit ported `77ac7fa`. To catch up: diff `src/domain` and the
  relevant UI since then, port with their tests, rerun `SiteMatchTest` (`tools/golden.mjs`). Install
  over wireless adb, then don't launch, tap or screenshot: the owner checks it. Owner's scope calls
  (2026-10-21): no Home video background, no screen readers, no Essences page, no adding or removing
  Home widgets; tab pages use the headline title bar with a Search icon that turns the title into a
  search field (a search app bar was tried and reverted); details open in bottom sheets; banner and
  event pages open with a full-bleed art hero; names are never coloured by rarity; M3 Expressive.
- WebView wrapper: `C:\Users\Albert\Development\ItJustLogs Wrapper` (app id `dev.itjustlogs.web`; the
  owner doesn't need it committed, don't ask). Native Google sign-in reaches the site as
  `window.IJLAndroid` (`src/drive.ts`); the page loads with `Cache-Control: no-cache` because a cached
  page once ran a stale build.
