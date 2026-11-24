# Hub session: coordinator and planner

Opening message for a new hub: "You're the hub: coordinator and planner. Read docs/hub.md first,
then follow it."

A hub is short-lived: one per batch of work. The next hub starts from this file, CLAUDE.md, git
and the memory files, not from an old conversation. The memory folder is
`C:\Users\Albert\.claude\projects\C--Users-Albert-Development-ItJustLogs\memory\` (`MEMORY.md` is the
index); `hub-never-does-work`, `pending-work-2026-10-20`, `test-pull-backup` and `be-less-verbose`
matter most to a hub.

## Roles

- Hub = coordinator + planner. The owner asks; the hub writes a plan (a few bullets for the
  owner), then starts a worker session with a complete brief. The hub never codes, never does
  lookups (not even a grep for a brief) and never deploys.
- The hub reads worker reports with `list_events` and relays them in a few lines. Screenshots go
  to the owner with SendUserFile.
- Workers implement. A brief has: the task; the area doc to read (`docs/rotations.md`, `ui.md`,
  `sync.md`, `tabs.md`, `income.md`, `pages.md`) plus the relevant memory files; the files
  involved; what done looks like; test servers 5175/5176/5178 only (never 5173/5174, real data);
  quiet test output; update the area doc; don't commit; a 2–3 line report.
- Deploying: only when the owner says "deploy". The hub messages the deploy worker, "[IJL]
  Deployer" (`local_0cd06d44-1fd1-4c95-9450-2536716085ff`), which follows CLAUDE.md → Deploying.
  If it is gone, start a new deploy worker with the same brief.
- ef-assets (images, game data) may be pushed directly by workers as `ram-prices` /
  `celestriad@pm.me`. Site changes stay local until deploy.

## Models and tokens

- Hub on Fable 5.2 (the owner switched it from Fable 5.1 on 2026-11-16); workers on Opus 5.5 at
  medium effort. While weekly tokens are short, small UI or wording tasks go to Sonnet at high
  effort. Commit attribution is now "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>" —
  say so in the next deploy brief.
- `start_session` may not switch the model. Check with `get_session`, switch with
  `set_session_model`. If the turn already started on the wrong model, stop it and resend the brief.
- Sonnet workers run at high effort at least; a Sonnet-low worker broke the event page layout (2026-10-30).

## Practical rules

- Sim engine, Parser and `ui/pages/rotations*` work: one worker at a time (shared files).
- One task per worker: start a new one rather than reusing a worker above about 300K tokens of
  context.
- When the owner is on Remote Control, `start_session` is refused. Give the task to an idle
  worker of the right model, under that limit, with SendMessage instead, and say so.
- No cloud sessions: they can't report back to the hub.
- Name every recording event with its video time (e.g. Mirage 1, video 12.95 s).
- Engine rules come from game data (EndfieldData dump, ef-assets). Footage only confirms
  mechanics and is never a DPS target. Flag any rule modelled from footage.
- When a batch is done, say so; the owner archives idle workers.
- Every website preview loads `D:\Development\ijl_DEFAULT.json` into the test instance:
  copy it into `public/_tmp/` and delete it after.
- Reading a recording: a worker with "/parse-recording <path>" (follows `tools/ai-parser/README.md`).
  It only touches `tools/ai-parser/`, so it can run beside a Rotations worker.
- The operator hero gradient design is settled: don't offer variants.
- The Storage box is a plain store; it never fetches from links.
- The Android wrapper stays a WebView, never a TWA; its repo isn't committed.
- Build gotcha: the CSS minifier empties `border-image: none`. Use `border-image-source: none` and test Firefox on a build.
- The owner often steers workers directly: read a report's final message before relaying.
- Owner-only checks also include a Drive upload over 5 MB (parked).
- Rule tests (`src/domain/sim/rules.test.ts` and `rules2.test.ts`, harness `testkit.ts`): to add an operator, a
  worker writes its table (id, name, setups, rules from the `rules` builders, each naming its source) and adds it to
  `OPERATORS` (rules2: a section's list passed to `runTables`).
  A failing row is a finding for the owner: it's marked `finding` (an expected failure), never made to pass.
- Brief a worker with SendMessage to an idle worker, or `start_session` fresh (Opus 5.5 medium,
  `use_worktree: false`, `permission_mode: auto`, `wake_when_done: true`). Read the final message
  with `list_events`, limit 5–8; the 400-character note is always cut.
- "deploy" means: message the Deployer for that batch only. "Deploy once workers are finished"
  means wait until all workers are idle, then send it.
- Replies short. No hints, asides or parentheticals in site copy. The owner reverses decisions
  freely (the rarity strips were built, animated, deployed, then removed the same day): implement
  cleanly, remove cleanly.

## Sessions

Only two linked sessions remain; the owner archived the rest.

- Deployer: `local_0cd06d44-1fd1-4c95-9450-2536716085ff` ("[IJL] Deployer"). Idle. Send
  "Deploy: the owner said deploy" plus the expected file list; it follows CLAUDE.md →
  Deploying and reports the sha and the Pages result. It often finds files beyond the
  list: fine, it says so.
- Contracts worker: `local_93fecb7a-3011-46d3-80c8-2bf416e716d5`. Idle, large context
  (about 800 messages). Knows the Contracts tab, picker, share codes and Home widget. Use
  it for small Contracts follow-ups; start a fresh worker for anything big.
- Gone (archived): the visual worker (UI batch, strips, banner widget, Settings tiles), the
  data/dump worker (Argent Flow, gacha textures, `cc/` dataset, `update-cc.py`), the CDN
  worker, scroll-jank. Their knowledge is in docs and ef-assets READMEs: `docs/ui.md`,
  `docs/tabs.md`, `docs/game-dump.md`, ef-assets `cc/README.md`, `ui/gacha/README.md`.
- The owner also runs a separate "datadump" session of their own that works on the client
  dump; it found that some game text is server-delivered (below).
- Shared notes folder used by all workers for reports and screenshots:
  `C:\Users\Albert\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_d4ecccbe-b051-468e-b9cf-9c617581dd8e\`
  (subfolders `gacha-reveal/`, `cc/`, `contracts/`; file `jsdelivr-50mb.md`).

## State (2026-10-29)

- Live commit: `git rev-parse origin/main`.
- Recently shipped: Potentials ladder tweaks (whole-row open, centred arrow, grey pull number,
  pity only for 6★); operator Storage box (`domain/storage.ts`, `settings.storeItems`), X post and
  image-link downloading removed; Pull history as one Potential ladder; operator page in three
  columns with Storage above Profile; Drive tokens from the Android app (`window.IJLAndroid`, `drive.ts`, `ui/sync.ts`);
  schedule snapshot refresh with `ScheduleEvent.source` (Sanctuary of Ink dates
  via ef-assets `schedule-overrides.json`); built-site fix for the operator banner fade (`border-image-source: none`);
  operator hero fade on Firefox (`ui/heroFade.ts`), dark by 60%, no parallax on
  the operator page; banner art Custom/Auto and tall header for every banner art; art only as the
  banner (box lists everything, plays videos); art source links (e.g. X posts) kept in
  `settings.artSources`, link-only `artLinks` (no media download: there is no xpost module; Drive resumable upload over 5 MB untested);
  "SP/s per chain" rows on operator Attributes; Pull history on operator and weapon pages as three equal boxes (Copies,
  Potential, saved art); full backups with saved runs (`Backup.sims`, `restoreSims`); Arcane back in
  `GAME_ART`; operator banner parallax (ef-assets `banners/game/layers/`) and the pinned operator
  hero with per-Potential face anchors; the Arsenal page's single Skills section (`grooveSlots`);
  the Loadout weapon slot with the skill 3 summary (ef-assets `wiki/weapon-summaries.json`); weapon tuning (0–4) and per-skill essence levels on the weapon page, Loadout and
  builds (ef-assets `combat/weapon-tuning.json`), fixing weapon Potential counted twice in the sim;
  "Your pulls" → "Pull history" (Database and Home tooltip); one shared tooltip
  and right-click menu style (`data-tip`, `tip`/`tipNote`/`tipRow`, `.tooltip`/`.ctx-menu` in
  `components.css`, tap opens tips on phones); Home character cards' "Full art" as the full
  operator art (ef-assets `operators/full/`) zoomed to each face (`FULL_ART_FACE`); Database
  weapon tiles without rarity glow, 6★ weapons with the game's smoke (ef-assets
  `effects/six-star/smoke-loop-3.webp`); mobile-friendly Rotations timeline and Buffs panel; Parser as the first and
  default Rotations tab; Database operator portrait cards; stitched operator banner art
  (ef-assets); per-stat gear artifice (0–3 per stat, empty/half/full gear icon); backgrounds list
  from raw.githubusercontent; Skydrummer second-Finisher fix; Last Rite / Blightshade run fixes.

## State (2026-11-16)

- Live site: `d8db63c` (= `origin/main`). Working tree clean except `.claude/launch.json`,
  which is never committed.
- Nothing is in flight. No worker is running, no site change is waiting for a deploy.
- ef-assets `main` is at or after `1e154e0` (cdn branches workflow); check with a fresh clone.
- Shipped since 2026-10-29 (newest first):

| Commit | What |
|---|---|
| `d8db63c` | Home Contingency Contract widget (`contractSection` in `home.ts`, `homeWidgets.ts`). In `DEFAULT_HOME` after Current; saved layouts add it via Customize. |
| `987ea1b` | Contracts tab (`/contracts`, `/contracts/<season>`, picker, share codes, built pages); image URLs moved to ef-assets `cdn` branches; Settings Backgrounds tiles full width; `docs/game-dump.md`. |
| `0ef6b76` | Home headhunting row: Chartered first, then Refactor (`headhuntingRow`, schedule `kind`); event strip top-edge fix; event pages without parallax (`.event-hero`); rate-up names on banner cards link to operator and weapon pages. |
| `5cdb3fb` | Operator grid plain again: rarity strips, animations, settle-in and operator-card smoke removed. Arsenal tiles and Loadout 6-star tiles keep smoke. |
| `dde78a3` | Rarity strips on the operator grid (later removed); Final Strikes table alignment (kept). |
| `ac79880` | Argent Flow Final Strike entry (25 SP) in `src/data/final-strikes.json`. |
| `2fc82b0` | Argent Flow game-layout hero (`special_1_6_2` in `GAME_ART`); CLAUDE.md trimmed. |
| `98ec62f` | Visual batch: light theme, skeletons, empty states, nav pill, Home hover, Settings cards, scroll fix (`.pin-gone`), banner snapshots. |
| `73fb42c` | Sim buff `from` vs `source` (Antal, Lifeng Link); per-banner page with art hero. |
| `fcdef42` | Essences and AIC hidden by default (Settings → Tabs); event header fade. |
| `d39e6f2` | Engine fixes from rule-test findings, rule tests batches 1–2. |

ef-assets, same period: `3baa4b3` Argent Flow Potential art; `2ce6bdd` his Range and
Expertise, `operator-from-game.py` fills them; `7b24cdb` and `21f211b` `ui/gacha/` textures
and motion notes (unused by the site now, kept); `95dd863` `cc/` dataset and
`scripts/update-cc.py`; `1e154e0` `cdn`, `cdn-full`, `cdn-potential` branches rebuilt from
`main` on every push and daily (`scripts/cdn-branches.sh`, fails over 45 MB).

## Things a new hub must know

- **jsDelivr 50 MB limit.** ef-assets `main` is 157 MB, so pictures are served from the three
  cdn branches (see CLAUDE.md). A new picture reaches `cdn` about a minute after a push;
  the raw.githubusercontent fallback covers the gap. Purge URLs use the branch name.
  `cdn-full` and `cdn-potential` each have about 18 MB of headroom (about 2.3 MB per new
  operator across both). When one nears 45 MB, a new branch plus `cdnBase` in
  `src/domain/banners.ts` is needed.
- **Contingency Contract.** One stage per season, Test Criteria worth 1–3 points; seasons
  Re-Ignition (ended) and Indigo (combat ends 24/25 Nov by server, shop closes 2 Dec
  04:00). Data: ef-assets `cc/index.json`, `cc/seasons/<id>.json`, schema and share-code
  spec in `cc/README.md`. Site: `src/domain/contracts.ts`, `src/ui/pages/contracts.ts`,
  `src/styles/contracts.css`, `docs/tabs.md`.
- **Server-delivered text.** The Indigo criteria text is not in any dump: its 78 text ids
  are in `I18nTextServerTimeIdTable` and come from the server at runtime. Redumping never
  helps. Transcribed text goes in ef-assets `cc/transcribed/indigo.json`, which
  `update-cc.py` must not overwrite. Expect the same for future seasons' new text.
- **Game dump.** `docs/game-dump.md` says where the decrypted client lives and how to scan
  it; the owner reruns `run_all.bat` after a client update.
- **Music.** Asked and parked twice ("hold off"). Options already explained: a small visible
  YouTube player loaded on demand (optional opt-in autoplay, which works only after
  in-site navigation), or self-hosted Opus from the Wwise banks (takedown exposure). A
  hidden YouTube frame, as arkpedia.net does, was advised against. Don't raise it unasked.
- **Gacha reveal effects.** Researched fully (report in the notes folder, `gacha-reveal/`).
  The owner rejected them on operator cards. Don't re-offer; other placements (ten-pull
  groups in history, a splash) were suggested and not taken up.

## Open items (owner decides the order)

1. Last Rite run is about 10% short (4.08M of 4.54M by 31 s). Not RNG at the sim's 5% crit
   stats; likely the other player's unknown crit gear. Parked.
2. Summons running through other operators' cut-ins were modelled from footage, not game data;
   they need a data source. Tangtang's Whirlpools through cut-ins are unverified.
3. Yvonne's Final Strikes read 1.15–1.45× high in the owner's runs (crowded readings); they need
   a clean read before any engine change.
4. Last Rite's battle skill gave 17–27 SP in footage vs the sim's 30.
5. Rule tests per operator: batch 1 done: Arcane, Tangtang, Si, Typhoeus,
   Last Rite, Yvonne, Liino, Zhuang Fangyi. Findings 1, 3, 4, 5 fixed in the engine (channel ticks, skill
   groups from ef-assets 9e15d56, Liino's heal projectile); finding 2 settled by footage (Si's combo gives
   10 + 6.5 to the team); no open findings. Batch 2 done: `rules2.test.ts`, the other 26
   operators plus batch 1's gap rows, 1179 tests; 36 findings, run as expected failures. Engine fixes
   for groups A–D, C and F shipped in d39e6f2 (ef-assets f43b5ba, 91d2c58). Then (73fb42c, ef-assets
   4d2582f): a buff's source split from its creator (Antal's Focus) and the Link rebuilt
   on the game's Link buff (Lifeng's 600% hit); replays unchanged (Skydrummer 3,588,467, Alleikhreos
   4,463,252, Last Rite 4,071,541). docs/rotations.md "Engine fixes from batch 2's findings", shared notes
   engine-fixes.md. 15 finding rows left: group E (Arclight's third slash, Perlica's Cycle Protocol,
   Rossi's combo SEQ 1, Purrchena's hold) and open ones with reasons (Endministrator P1, Avywenna's
   lances, Camille's Vesperwings, Liino's Starry Boost).
6. Done: the Simulator's result has buff rows, the boss face and the Buffs
   panel; its shown fight is replayed once with `buffRecorder`. Old saved runs need Run again.
7. Done (already fixed): the "SP at the start" field max and clamp follow the enemy's `sp.max`.
8. Done: element, class and weapon-type icons are CSS masks, so `data-fallback` never covered them; `probeMaskIcons` (`ui/components.ts`) now swaps a failed one to the other mirror.
9. Owner checks: confirmed working: parsed-run Drive sync on two devices, the ef-assets schedule
   pull request, the wrapper app's copy buttons. Parked: a Drive upload over 5 MB.
10. Done: stretched game-screen banners. `operator-banner.py` drew tightly packed sprites over
   their whole rect; fixed in ef-assets 6e84af1, which rebuilt 12 banners. Arcane is back in `GAME_ART`.
11. Contracts — Indigo: 21 of 39 criteria unnamed (7 arrived 12 Nov, 14 unmatched); 18 are
    inferred (`matchedBy`). The fix needs the owner's recording of the criteria screen, about 2 s
    per criterion, read by a worker into `cc/transcribed/indigo.json`. The owner said to leave
    it for now.
12. Contracts — misc: stage timer unknown (`timer: null`); no tag-to-buff map, so descriptions
    with numbers come from the wiki. Share codes match the README's worked examples but were
    never pasted into the real game. The picker leaves out the game's cached locked criteria
    that return when a key is re-picked. `wikiFile` has no guard after a failed load, so a
    failed file may refetch on every redraw (affects `events.json` and `cc/` on Home); seen
    in code only, not tested, not fixed.
13. Argent Flow (`chr_0037_minghe`): the operator page footer still credits the wiki snapshot
    date though his numbers came from game tables; it needs a per-operator source in the site.
    The wiki now lists him: the next `update-wiki` run should prompt deleting his entry from
    `wiki/operators-game.json`. Sim `combat/ops` data is not built, so Rotations can't use
    him. `final-strikes.json` must be regenerated for each new operator.
14. Visual and misc: New Horizons banner art has a baked title (same fix as Basic available).
    Unviewed on real hardware: Firefox heroes, reduced motion on a device, light-theme
    skeletons, the phone picture dialog (689659c). The banner page header's Rate-up line and
    Joint banners' "N rate-ups" are still plain text. Si's Potential text has a stray bracket
    from the wiki snapshot; Si tall card art.
15. Feature ideas offered, none started: pull planner, luck percentile, operator compare, build
    links, Rotations out of WIP, result compare, structured event rewards, share card,
    per-banner stats under the hero, operator pull plan, search, offline service worker,
    changelog page.
