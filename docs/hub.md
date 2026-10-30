# Hub session: coordinator and planner

Opening message for a new hub: "You're the hub: coordinator and planner. Read docs/hub.md first,
then follow it."

A hub is short-lived: one per batch of work. The next hub starts from this file, CLAUDE.md, git
and the memory files (`hub-never-does-work`, `pending-work-2026-10-20`), not from an old
conversation.

## Roles

- Hub = coordinator + planner. The owner asks; the hub writes a plan (a few bullets for the
  owner), then starts a worker session with a complete brief. The hub never codes, never does
  lookups (not even a grep for a brief) and never deploys.
- The hub reads worker reports with `list_events` and relays them in a few lines. Screenshots go
  to the owner with SendUserFile.
- Workers implement. A brief has: the task; the area doc to read (`docs/rotations.md`, `ui.md`,
  `sync.md`, `tabs.md`, `income.md`, `pages.md`) plus the relevant memory files; the files
  involved; what done looks like; test servers 5175/5176 only (never 5173/5174, real data);
  quiet test output; update the area doc; don't commit; a 2–3 line report.
- Deploying: only when the owner says "deploy". The hub messages the deploy worker, "[IJL]
  Deployer" (`local_0cd06d44-1fd1-4c95-9450-2536716085ff`), which follows CLAUDE.md → Deploying
  and updates the Live line in memory. If it is gone, start a new deploy worker with the same
  brief.
- ef-assets (images, game data) may be pushed directly by workers as `ram-prices` /
  `celestriad@pm.me`. Site changes stay local until deploy.

## Models and tokens

- Ideal: hub on Fable 5.1; workers on Opus 5.5 at medium effort. While weekly tokens are short,
  small UI or wording tasks go to Sonnet at low effort.
- `start_session` may not switch the model. Check with `get_session`, switch with
  `set_session_model`. If the turn already started on the wrong model, stop it and resend the brief.

## Practical rules

- Sim engine, Parser and `ui/pages/rotations*` work: one worker at a time (shared files).
- When the owner is on Remote Control, `start_session` is refused. Give the task to an idle
  worker of the right model with SendMessage instead, and say so.
- No cloud sessions: they can't report back to the hub.
- Name every recording event with its video time (e.g. Mirage 1, video 12.95 s).
- Engine rules come from game data (EndfieldData dump, ef-assets). Footage only confirms
  mechanics and is never a DPS target. Flag any rule modelled from footage.
- When a batch is done, say so; the owner archives idle workers.
- Every website preview loads `D:\Dev\ijl_DEFAULT.json` into the test instance.
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

## State (2026-10-29)

- Live: ab0049e (Potentials ladder tweaks).
- Local, not deployed: rule tests batch 1 (`src/domain/sim/rules.test.ts`, `testkit.ts`, docs). `.claude/launch.json` is never committed.
- Recently shipped: Potentials ladder tweaks (whole-row open, centred arrow, grey pull number,
  pity only for 6★); operator Storage box (`domain/storage.ts`, `settings.storeItems`), X post and
  image-link downloading removed; Pull history as one Potential ladder; operator page in three
  columns with Storage above Profile; Drive tokens from the Android app (`window.IJLAndroid`, `drive.ts`, `ui/sync.ts`);
  schedule snapshot refresh with `ScheduleEvent.source` (Sanctuary of Ink dates
  via ef-assets `schedule-overrides.json`); built-site fix for the operator banner fade (`border-image-source: none`);
  operator hero fade on Firefox (`ui/heroFade.ts`), dark by 60%, no parallax on
  the operator page; banner art Custom/Auto and tall header for every banner art; art only as the
  banner (box lists everything, plays videos); X post links download media (`domain/xpost.ts`,
  sources in `settings.artSources`, link-only `artLinks`; Drive resumable upload over 5 MB untested);
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

## Open items (owner decides the order)

1. Last Rite run is about 10% short (4.08M of 4.54M by 31 s). Not RNG at the sim's 5% crit
   stats; likely the other player's unknown crit gear. Parked.
2. Summons running through other operators' cut-ins were modelled from footage, not game data;
   they need a data source. Tangtang's Whirlpools through cut-ins are unverified.
3. Yvonne's Final Strikes read 1.15–1.45× high in the owner's runs (crowded readings); they need
   a clean read before any engine change.
4. Last Rite's battle skill gave 17–27 SP in footage vs the sim's 30.
5. Rule tests per operator: batch 1 done (local, not deployed): Arcane, Tangtang, Si, Typhoeus,
   Last Rite, Yvonne, Liino, Zhuang Fangyi. Findings 1, 3, 4, 5 fixed in the engine (channel ticks, skill
   groups from ef-assets 9e15d56, Liino's heal projectile); finding 2 settled by footage (Si's combo gives
   10 + 6.5 to the team); no open findings. Batch 2 done (local, not deployed): `rules2.test.ts`, the other 26
   operators plus batch 1's gap rows, 1179 tests; 36 findings, run as expected failures. Engine fixes
   for groups A–D, C and F done (local, not deployed; ef-assets f43b5ba reaction buffs in every bundle,
   91d2c58 the Endministrators' Potentials, both pushed): docs/rotations.md "Engine fixes from batch 2's
   findings", shared notes engine-fixes.md. 21 finding rows left: group E (Arclight's third slash,
   Perlica's Cycle Protocol, Rossi's combo SEQ 1, Purrchena's hold; Catcher's free frame now follows the
   jump rule) and open ones with reasons (Endministrator P1, Avywenna's lances, Lifeng's Link hit, Antal's
   Focus, Camille's Vesperwings, Liino's Starry Boost). Replays: Skydrummer 3,574,833 → 3,588,467,
   Alleikhreos 4,445,576 → 4,463,252, Last Rite 4,076,698 → 4,071,541.
6. Done (local, not deployed): the Simulator's result has buff rows, the boss face and the Buffs
   panel; its shown fight is replayed once with `buffRecorder`. Old saved runs need Run again.
7. Done (already fixed): the "SP at the start" field max and clamp follow the enemy's `sp.max`.
8. Done: element, class and weapon-type icons are CSS masks, so `data-fallback` never covered them; `probeMaskIcons` (`ui/components.ts`) now swaps a failed one to the other mirror.
9. Owner checks: confirmed working: parsed-run Drive sync on two devices, the ef-assets schedule
   pull request, the wrapper app's copy buttons. Parked: a Drive upload over 5 MB.
10. Done: stretched game-screen banners. `operator-banner.py` drew tightly packed sprites over
   their whole rect; fixed in ef-assets 6e84af1, which rebuilt 12 banners. Arcane is back in `GAME_ART`.
