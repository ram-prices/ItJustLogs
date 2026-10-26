# Hub session: coordinator and deployer

How the owner's hub session works. A hub is short-lived: one per batch of work, archived when the
batch is done. The next hub starts from this file, CLAUDE.md, git and the memory files, not from
an old conversation.

## The hub's job

- Turn the owner's requests into worker sessions (`start_session`, `user_asked` when the owner
  says to start one), each with a complete brief: the task, the files, what done looks like,
  "don't commit", and the docs file to read first.
- Track the workers: when one reports, tell the owner in a line or two. Don't re-explain.
- Answer cross-cutting questions (what's live, what's local, what clashes with what).
- Deploy when the owner says "deploy" (CLAUDE.md → Deploying), and only then.

## The hub does not

- Edit code, run the sim, read recordings or check pages in the browser. A worker does that, or a
  subagent for a quick lookup.
- Run two workers on the same files at once. Sim engine, Parser and `ui/pages/rotations.ts` work
  goes one at a time.
- Start cloud sessions (they never report back) or nest workers more than one level deep.
- Stay open for days. When a batch is done, say so; the owner archives it.

## Writing a worker brief

Name the area's doc (`docs/rotations.md`, `docs/ui.md`, `docs/sync.md`, `docs/tabs.md`,
`docs/income.md`, `docs/pages.md`) and the files. Ask for quiet test output, an update to that doc
when behaviour changes, and a short report (the hub forwards it). Workers use the test dev server
on 5175 or 5176, never 5173/5174 (real data).

## State (2026-10-25)

- Live: 2948d26: styles split, icons from ef-assets (all six checked on both mirrors),
  `ui/pages/rotations.ts` split into `ui/pages/rotations/` (page state is `page.<field>` in
  `rotations/state.ts`; keep the one-way import order), and `Enemy.sp` (a stage's own SP
  start/cap/regen; the SP bar draws a segment per 100).
- Local: only this file's update.
- Sessions to archive: "[IJL] DPS Sim", "[IJL] Android Development", "Refactor rotations.ts module
  state", "Pre-deploy icon check", "Gear slot and poise-node icons migration".

## Next tasks (one worker each, in order)

1. Sim: the Skydrummer's late Stagger at 1:02 (`docs/rotations.md`, current state section).
2. Sim: the second Skydrummer Finisher lands 0.8 s late.
3. Sim: rule tests that run for every operator.
4. Sim: a Glaiver File / YSTF Captain Blightshade entry in `ENEMIES` with its `sp` (~620 of 700,
   ~4/s, holds during combo banners); parsed runs stand in the training dummy for now.
5. Rotations page: the "SP at the start" field still caps at 300; follow the stage's `spMax`.
6. Open: Last Rite's battle skill gave 17–27 SP in footage vs the sim's 30 (check, don't tune).

Reading a recording: start a worker with "/parse-recording <path>" (a personal skill; it follows
`tools/ai-parser/README.md`). It can run alongside a Rotations worker: it only touches `tools/ai-parser/`.

Owner checks (no worker needed): parsed-run Drive sync on two devices; the first ef-assets schedule
pull request.
