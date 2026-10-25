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

## State at handoff (2026-10-25)

- Live: eb7cd4a (CLAUDE.md split into docs/, scratch tests ignored). Earlier site changes: 41db3bf.
- Local and not committed:
  - the styles split (`src/styles.css` now imports `src/styles/*.css`; built CSS identical),
  - CLAUDE.md "Deploying" section, this file, `docs/ui.md` styles note, the DPS handoff section at
    the end of `docs/rotations.md`,
  - an icon move by another session: `public/icons/` deleted (gear slot icons, `poise-node.png`,
    `arsenal.svg`, `oroberyl.webp`), now loaded from ef-assets via jsDelivr, with edits in
    `src/ui/components.ts`, `src/ui/pages/rotations.ts`, `src/ui/pages/stats.ts`. Before the first
    deploy: check which session made it, that it's finished, and that every icon renders on the
    test server (Oroberyl, Arsenal tab icon, gear slots, Stagger node).
  - more changes from sessions running after this file was written: `src/domain/sim/engine.ts`,
    `team.ts`, `src/store.ts`, `src/ui/sync.ts`, and a new `src/ui/pages/rotations/` folder (a
    rotations.ts split under way?). Find out which sessions made them and whether they're finished
    before deploying any of it.
- Sessions still open: "[IJL] DPS Sim" (handoff written, archive once idle) and "[IJL] Android
  Development" (idle; archive). Both can be archived from the sidebar.

## Next tasks (one worker each, in order)

1. Deploy the local changes above (after the icon check).
2. Sim: the Skydrummer's late Stagger at 1:02 (`docs/rotations.md`, current state section).
3. Sim: the second Skydrummer Finisher lands 0.8 s late.
4. Refactor: split `ui/pages/rotations.ts`, gathering its ~36 module-level `let`s into one state
   module first; no behaviour change.
5. Sim: rule tests that run for every operator.

Reading a recording: start a worker with "/parse-recording <path>" (a personal skill; it follows
`tools/ai-parser/README.md`). It can run alongside a Rotations worker: it only touches `tools/ai-parser/`.

Owner checks (no worker needed): parsed-run Drive sync on two devices; the first ef-assets schedule
pull request.
