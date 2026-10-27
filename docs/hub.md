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
  Deployer" (`local_f10792e5-bf13-44bc-8c22-0cd7e50ef07e`), which follows CLAUDE.md → Deploying
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

## State (2026-10-27)

- Live: the "Operator banner layers, Arsenal Skills, Loadout weapon slot, backups with runs" commit
  (sha in the pending-work memory).
- Local, not deployed: nothing. `.claude/launch.json` is never committed.
- Recently shipped: full backups with saved runs (`Backup.sims`, `restoreSims`); Arcane back in
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
5. Rule tests that run for every operator: not started.
6. Simulator tab has no buff rows or boss face. Fix scoped: record buffs in the final fight, pass
   them to the timeline. Waiting on the owner.
7. Si's "20" portrait badge isn't drawn (not matched to data). Si has no tall card art on the
   wiki yet.
8. The "SP at the start" field cap of 300: unverified whether it was fixed.
9. Heat and Electric element icons have no backup mirror, so they sometimes load empty.
10. Owner checks: parsed-run Drive sync on two devices; the first ef-assets schedule pull request.
11. Done: stretched game-screen banners. `operator-banner.py` drew tightly packed sprites over
   their whole rect; fixed in ef-assets 6e84af1, which rebuilt 12 banners. Arcane is back in `GAME_ART`.
