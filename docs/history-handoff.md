# ItJustLogs: history and "don't" handoff

Written 2026-11-25 by the hub session that coordinated the site from late October to
commit `d8db63c` (2026-11-16). It is a record, not a task list: what was done, what was
tried and reversed, what the owner has ruled out. Nothing here asks you to do anything.

Scope of what I know first-hand: everything up to `d8db63c`. The commits after it
(`f3eff17` 6-star strip celebration, the audit fixes, banner-card entrances, the
dump-only event dates, version 1.7, Kay in the sim) were made by other sessions. Where
those touch a topic below, the later commit and current CLAUDE.md win; I mark such spots
"later work exists".

Sources that outrank this file: `CLAUDE.md`, the area docs in `docs/` and git history. (The old
per-rule memory folder was folded into these docs on 2026-11-25 and archived.)

---

## 1. Hard rules (each one was broken at least once)

Committing and deploying
- Site changes stay local. Commit and push only when the owner says "deploy", and only
  that batch; afterwards back to local. Pushing `main` is the live site friends use.
- Never commit: `fixtures/` (the owner's real export), `tools/ai-parser/`,
  `.claude/launch.json`, `src/domain/sim/dbg*`, `essence-icon-preview.html`, `essence.svg`,
  anything under `public/_tmp/`. Stage by name, never `git add -A`.
- No PRs for the site; `gh` isn't installed. The owner never sees bot pull requests.
- ef-assets is different: it may be pushed directly, as `ram-prices` / `celestriad@pm.me`,
  from its permanent checkout `C:\Users\Albert\Development\EF Assets` (since 2026-11-25; before
  that, throwaway scratchpad clones, which piled up in Temp and were sometimes left dirty).

Real data
- Ports 5173 (a friend's pulls) and 5174 (the owner's pulls) are view-only. Never change
  a setting, avatar or saved result there. Test on 5175/5176/5178 (or 4173 for a build).
  `.claude/launch.json`'s `itjustlogs-dev` entry is 5173: a worker once opened it by
  mistake. The test entry is `itjustlogs-test`.
- Every preview loads `D:\Development\ijl_DEFAULT.json` (not `D:\Dev\...`, an old wrong
  path that lingered in docs; not `fixtures/`). Vite won't serve outside the project, so
  copy it to `public/_tmp/`, load it through `#fileInput`, delete the folder afterwards.

Where things live
- Images, game assets, extracted game data and their scripts go in ef-assets, never in the
  site repo (`public/`, `src/data/`). The site repo is structure and tools. `public/icons`
  was emptied for this reason.
- No backend, no API keys, no accounts. Everything runs in the visitor's browser.
- localStorage is for small settings only; pictures and history go in IndexedDB.

Readers and AI
- The site's readers (medals, Archive, essences, gameplay recordings) are Tesseract.js plus
  rules, pinned by tests from real frames. Never wire an AI call into the site.
- The "AI parser" is Claude reading frames inside a session (`tools/ai-parser/`, the
  `/parse-recording` skill). It is a personal tool, never committed, never an API script.
  A script calling the Anthropic API was built once and rejected.

Sourcing
- The sim and the income numbers must be the site's own work: game data, the wiki's
  documented formulas, the official feed, labelled own estimates. Never feed in a community
  rotation, build, damage split or someone's spreadsheet; those only check a result after
  it exists. The "Endfield Bookkeeping" sheet was removed from ef-assets for this reason.
- The owner's recordings confirm mechanics only. Never tune pace, uptime or DPS to a
  recording (Uptime was once fitted to 60% from footage and reverted).
- Game values come from the dump first (see CLAUDE.md, "Game data"). The wiki and our own
  snapshots lag and have been wrong (two Indigo dates on the wiki were wrong).
- Wiki text is CC BY-SA 4.0: credit "endfield.wiki.gg, CC BY-SA 4.0" wherever shown.

Wording and look
- Short. No hints, asides, parentheticals or explanatory sentences in site copy; no long
  chat replies. The Stats income breakdown lists pull currencies and amounts only: no
  prices, no guide links, no "with what it hands out on purchase".
- Pad everything: inset panels 16–20px, 10–12px gaps, nothing flush to an edge.
- Potential is written "P0"–"P5". The Potential star is never used alone in place of text.
- Show the game's values (SP gained 20, cost 100), never raw pixel readings (19, 101).
- Name a recording event with its video time ("Mirage 1, video 12.95 s").
- An editing view looks literally like the normal view, edited in place: no form grids,
  extra labels, moved controls. The owner flags shifts of a few pixels as bugs.
- The site mirrors the old eftracker so friends recognise it; change gradually, keep
  functions where they were. No sweeping redesigns.
- Operator and weapon names are never coloured by rarity; colour is for data.

Editing traps
- The repo mixes CRLF and LF files; keep each file's endings. `sed -i` in Git Bash strips
  CRs. Bash heredocs break on quotes, backslashes and some Unicode: write patch scripts
  and long files with the Write tool.
- The CSS minifier empties `border-image: none`; use `border-image-source: none` and check
  a build in Firefox.
- `icon_names=` in `index.html` must stay alphabetical.
- Vite HMR serves stale modules here; restart the dev server when exports go missing.
- In the background browser pane: no requestAnimationFrame (test players by seeking), lazy
  images never load, screenshots are about 800px wide (zoom the page for detail), video
  reads get about 4 fps. Don't judge reader accuracy or image loading from it.

---

## 2. Things tried and removed or rejected. Don't bring them back unasked.

- **Rarity strips behind operator portraits** (the game's headhunting results-screen
  textures, `ui/gacha/` in ef-assets). Built static (`dde78a3`), then animated from the
  game's real layer data (band pulse, 6-star rainbow ribbon, sweep), deployed, and removed
  the same day (`5cdb3fb`). The owner's ruling: operator portraits on the Database grid are
  plain, no backing effect, no animation.
- **6-star smoke behind operator cards.** Removed with the strips and explicitly not to
  return. Arsenal (weapon) tiles and Loadout's 6-star tiles keep their smoke: the owner
  asked for no change there. Later work exists: `f3eff17` added a "6-star strip
  celebration" elsewhere; that was another session's brief, read its docs before touching.
- **Event page parallax.** Off (`0ef6b76`, `.event-hero`). Operator page parallax was
  also dropped earlier; banner pages keep theirs.
- **Music on Contingency Contract pages.** Discussed three times, parked each time ("hold
  off"). Options already explained to the owner: a small visible YouTube player loaded on
  demand; self-hosted Opus from the client's Wwise banks (takedown risk, Monster Siren
  Records). A hidden 1x1 YouTube frame, as arkpedia.net does, was advised against (YouTube
  terms), and arkpedia's other route needs a server proxy we don't have. Autoplay works
  only after in-site navigation and would be an opt-in setting. Don't raise it again.
- **Sonnet at low effort for UI work.** A Sonnet-low worker broke the event page layout.
  Sonnet only at high effort; Opus medium for most work.
- **Dropping the ultimate cut-in freeze in the sim.** Asked for, measured (Skydrummer
  clear 2:38.6 to 3:10.9), reversed. The freeze stays; no SP regeneration inside cut-ins.
- **X post / image-link downloading** for operator art: built, then removed. The Storage
  box is a plain store and never fetches from links.
- **TWA for Android.** The wrapper is a WebView, never a TWA.
- **Operator hero gradient variants.** The design is settled; don't offer alternatives.
- **Cloud sessions** for workers: not used, they can't report back.
- **A search app bar on the native Android app's tab pages**: tried and reverted.
- **Password-locked AIC optimizer and story summaries**: an idea parked in
  `docs/hub.md` (Parked ideas), not started. So are AIC schematic layouts and depot belt cost.
- **Engine "regenerating through" slow motion or cut-ins** in the sim or in
  `tools/ai-parser/build.mjs`: settled, don't.

---

## 3. What exists, and the decisions behind it

### Deploy and hosting
- Static build to GitHub Pages at `itjustlogs.dev` on push to `main` and daily 06:17 UTC.
  Every clean path, item, banner, event and Contracts page is a built page with a Discord
  embed (`PAGES` / `pageCopies` in `vite.config.ts`). Discord caches embeds per URL;
  appending `?v=2` forces a refetch.
- A dedicated Deployer session did every deploy for this hub, following CLAUDE.md. It
  commonly found files beyond the brief's list and said so; that was accepted.

### ef-assets and the CDN
- jsDelivr refuses any ref whose tree is over 50 MB. ef-assets `main` is about 157 MB, and
  about 6% of cold image requests were failing with 403 by early November. Fix (ef-assets
  `1e154e0`, site `987ea1b`): three branches rebuilt from `main` on every push and daily,
  `cdn`, `cdn-full`, `cdn-potential`, each checked to stay under 45 MB. Site URL helpers
  are in `src/domain/banners.ts` (`cdnBase`), not `store.ts`. Eight hardcoded CSS URLs were
  moved too. Purge URLs use the branch name. Rejected alternatives: GitHub Pages for
  images (10-minute cache), trimming (served pictures alone are 88 MB), a second repo.
- A new picture reaches `cdn` about a minute after a push; the raw.githubusercontent
  fallback covers the gap. Each new operator adds about 2.3 MB across the two art branches.
- Replaced 2026-11-25: ef-assets on Cloudflare Pages (`assets.itjustlogs.dev`, ef-assets
  `_headers`: pictures a day, JSON revalidated) for pictures and data alike, GitHub raw as
  the fallback; `cdnBase`, `EF_ASSETS_CDN` and the branch split left the site. Why: the
  branches would need a fourth one soon (45 MB each), jsDelivr's week-long browser cache
  made every fixed picture need a new URL, and one host is simpler.
- 1.7 lesson (from CLAUDE.md, later work): file checks passed while cards were blank
  because art sat in folders the site doesn't load. Check live pages.

### Banners, schedule, Home
- Banner data lives in ef-assets `banners.json`; fix bad data there, never with special
  cases in the site. Pool ids are spelled both `weponbox_` and `weaponbox_`.
- Home's headhunting row always puts the ordinary Chartered banner first, then RE-Factor
  reruns, then the rest (`headhuntingRow`, by the schedule's `kind`, not title text). A
  limit never drops the Chartered banner. Owner request, `0ef6b76`.
- Rate-up names on banner cards link to the operator page; weapons link only when a weapon
  page exists. The banner page header's Rate-up line and Joint banners' "N rate-ups" were
  left as plain text.
- The event strip's top black line was the list card's 4px padding, not blur. Fixed.
- Event and banner pages share the `.wiki-hero.art-hero.has-art` header: capped height,
  bottom-anchored art, 56px fade into the body. An earlier attempt made the art fill the
  viewport and lost the body padding; that was the broken layout.
- Operator page scroll lag: blurred cards over a scroll-linked fade. `heroFade.ts` sets
  `.pin-gone` 48px past the fade to hide the picture and drop the blur. Could not be
  reproduced on the owner's hardware; validated in software rendering only.
- Essences and AIC tabs are hidden by default behind Settings, Tabs checkboxes; their
  routes still open directly. Contracts is on by default with its own checkbox (later
  commits mention "hidden tabs by default"; check current state).
- Settings, Backgrounds tiles span the full card (`987ea1b`).
- Revert point before the modular Home: commit `bfe6d1c` plus the stash "pre-modular-home:
  Arsenals + Arsenal Issues renames on top of bfe6d1c". To look at it, set aside local changes,
  `git switch -c pre-modular-home bfe6d1c`, then `git stash apply` that stash (`git stash list`).

### Database and operators
- Operator and weapon info comes from the weekly wiki snapshot in ef-assets. A brand-new
  operator can be built from game tables with ef-assets `scripts/operator-from-game.py`
  into `wiki/operators-game.json`; once the wiki lists them, that entry should go.
- Argent Flow (`chr_0037_minghe`, game text "his"): pool `special_1_6_2`, Issue
  `weaponbox_1_6_2`. No enhanced basic attack; Bolt Rush is `normalskill_2` under a 20 s
  buff, 100 SP. Final Strike gives 25 SP (`attack5`, `atb: 25`). Range 8 m came from the
  wiki because no game table carries range. Final Strike rows live in the site's
  `src/data/final-strikes.json` and are regenerated per operator, not filled by the script.
- The Final Strikes table's numbers are right-aligned under their headers (`.fs-table`).
- Potential art per operator with face focus points: ef-assets `operators/potential/`.

### Contingency Contract (built 2026-11-05/06)
- The mode is one stage per season, replayed with chosen Test Criteria worth 1–3 points.
  No rounds, no contract lists, no leaderboard, no stage map. `..._stage_1..3` in the
  tables are time phases, not combat stages. Seasons: Re-Ignition, Indigo.
- Data: ef-assets `cc/index.json`, `cc/seasons/<id>.json`, art under `cc/art/`, schema and
  share-code spec in `cc/README.md`, rebuilt by `scripts/update-cc.py` from the dump (a
  local rerun; the dump exists only on the owner's PC).
- Site: `/contracts`, `/contracts/<season>`, `src/domain/contracts.ts`,
  `src/ui/pages/contracts.ts`, `src/styles/contracts.css`, `docs/tabs.md`. The criteria
  board follows the game's grid and scrolls sideways (23–24 columns). The picker enforces
  conflict groups, keys and locks, unlock totals and phases. Share codes are a port of the
  client's Lua and match the README's examples; nobody has pasted one into the real game.
  Phase checks follow the Lua (also on import), not the README's wording.
- Home widget (`d8db63c`): an event-style row; loads only `cc/index.json` unless a saved
  selection exists. It is in `DEFAULT_HOME`, but an already-customised Home must add it via
  Customize. It hides when no season is running or upcoming.
- **Server-delivered text.** New-season criteria text is not in any dump. The 78 Indigo
  text ids sit in `I18nTextServerTimeIdTable` and arrive from the server at runtime;
  `LuaCfg.lua` never checks local tables for them. Redumping does not help; this was
  tried. Transcribed text belongs in `cc/transcribed/<season>.json`, which the script must
  not overwrite. Reading the running game's memory was ruled out (account risk).
- State when I last saw it: Indigo had 18 of 39 criteria named (inferred, `matchedBy`), 21
  blank, `complete: false`; the owner chose to leave it. Stage timer unknown
  (`timer: null`); no tag-to-buff map, so numbered descriptions come from the wiki.
- `maxTotal` is per phase (Indigo 48 then 55; Re-Ignition 47 then 54).

### Game dump
- Local decrypted client: `C:\Users\Albert\Development\EndfieldDataDump` (`run_all.bat`,
  `output\Data\TableCfg`, Lua, bundles). `docs/game-dump.md` describes the tooling.
- The online EndfieldData mirror returns 403 to Python's default User-Agent; text ids are
  64-bit integers.
- Gacha results-screen assets were fully researched (`ui/gacha/README.md` in ef-assets):
  no particle systems, only flat layers with scrolling textures. The files remain in
  ef-assets although the site stopped using them.

### DPS sim and Rotations
- Purpose, in the owner's words: teach button order, not min-maxing. An interpreter of the
  game's own skill and buff data, not hand rules per operator.
- Only one worker at a time on the engine, Parser and `ui/pages/rotations*`.
- Engine rule changes: keep them clean and revertable, replay every saved run, report
  before and after. Reference replays when I last saw them: Skydrummer 3,588,467,
  Alleikhreos 4,463,252, Last Rite 4,071,541.
- Rule tests: `rules.test.ts`, `rules2.test.ts`, harness `testkit.ts`. A failing row is a
  finding for the owner, marked as an expected failure, never forced to pass. There were
  15 such rows at `d8db63c` (hence "N passed and 15 expected failures" in every deploy).
- Done: buff `source` (creator) split from `from` (entity named by buffSource), which
  fixed Antal's Focus; Link rebuilt on the game's own Link buff (0.2/0.3/0.4/0.5 per
  count), which fixed Lifeng; findings groups A–D, C, F.
- Settled facts: the stage timer runs through ultimate cut-ins, the fight clock, SP,
  buffs and Stagger do not. Transcript SP is the flat game amount per action; regeneration
  shows only in the bar level. Teammates' basic attacks use a fitted share (0.4).
- Known open when I left: Last Rite run about 10% short (parked, likely the other
  player's crit gear); summons through cut-ins modelled from footage, not data; Yvonne's
  Final Strikes read high; Last Rite battle skill 17–27 SP in footage vs 30; group E rows
  need footage. The owner planned to record clips. Later work exists (Kay, `55f50e9`).

### Android
- Native app: `C:\Users\Albert\Development\ItJustLogs Android`, own repo, nothing
  committed unless the owner says. `:domain` is the site's `src/domain` ported 1:1; last
  site commit ported `77ac7fa`. After installing over adb, don't launch, tap or
  screenshot: the owner checks the screen.
- Wrapper: `C:\Users\Albert\Development\ItJustLogs Wrapper`, WebView app
  `dev.itjustlogs.web`, native Google sign-in exposed to the site as `window.IJLAndroid`.
  It loads with `Cache-Control: no-cache` because a cached page once ran a stale build.
  The owner doesn't need it committed; don't ask.

---

## 4. How the owner works

- Reverses decisions quickly and without fuss. Build cleanly so removal is clean, and
  remove completely when asked (code, CSS, helpers, docs lines).
- Says exactly which surface they mean. "Keep the arsenal ones as is since I did not ask
  for any changes for them": don't extend a change to neighbouring components.
- Often on a phone or Remote Control: send screenshots as files, keep the last message
  complete on its own.
- Steers workers directly; a worker's last message may already reflect a new instruction.
- "Deploy" is one word and means now. "Deploy once the workers are finished" means wait
  for all of them.
- Checks things on real devices that sessions can't: Firefox, phones, the game itself.
  Say plainly what was not seen (real-speed animation, a phone, the live game).
- Offers of extra features are fine after a task, never instead of it. Ideas offered and
  not taken up: pull planner, luck percentile, operator compare, build links, result
  compare, share card, search, offline service worker, changelog page.

---

## 5. Commit map up to `d8db63c`

| Commit | What |
|---|---|
| `d8db63c` | Home Contingency Contract widget |
| `987ea1b` | Contracts tab; ef-assets cdn branches; Settings Backgrounds tiles; `docs/game-dump.md` |
| `0ef6b76` | Home headhunting order; event strip edge; event parallax off; rate-up name links |
| `5cdb3fb` | Operator grid plain again (strips, animations, card smoke removed) |
| `dde78a3` | Rarity strips (removed next commit); Final Strikes table alignment (kept) |
| `ac79880` | Argent Flow Final Strike entry |
| `2fc82b0` | Argent Flow game-layout hero; CLAUDE.md trimmed |
| `98ec62f` | Visual batch: light theme, skeletons, empty states, nav pill, Home hover, Settings cards, scroll fix |
| `73fb42c` | Sim buff sources (Antal, Lifeng); per-banner page with art hero |
| `fcdef42` | Essences/AIC hidden by default; event header fade |
| `d39e6f2` | Engine fixes from rule-test findings; rule tests batches 1–2; result buff rows |
| `ab0049e`, `33c2b51`, `51786ba` | Potentials ladder; operator Storage box and three-column page; Drive tokens from the Android app |

ef-assets in the same period: `f43b5ba`, `91d2c58`, `4d2582f` (sim buffs, Potentials),
`a645278` (text-free Basic Headhunting art), `621e108`, `253591c`, `aedcdda`, `3baa4b3`,
`2ce6bdd` (Argent Flow pools, data, banner, Potential art, Range/Expertise), `7b24cdb`,
`21f211b` (`ui/gacha/`), `95dd863` (`cc/`), `1e154e0` (cdn branches).

Older history is summarised in `docs/hub.md` ("State" and "Open items") and in git.
