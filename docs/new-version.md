# New game version: checklist

Written after 1.7 (Nov 25 2026), when a "banners and events" update left blank
cards, an empty Kay page and Lunar Calling tagged Unreleased. Every step below
is one that was missed then.

## Before

- **The ef-assets "needs attention" issue.** update-schedule and update-wiki
  commit straight to main and rebuild the CDN branches themselves (in 1.7 the
  wiki data was five weeks stale because their pull requests went unmerged).
  What they can't make, or a run that failed, goes into the one open issue
  "ef-assets: needs attention", assigned to and mentioning ram-prices, each
  line with the command that fixes it (`scripts/site-art.mjs` writes the list,
  `scripts/needs-issue.mjs` keeps the issue). It closes itself when clean. Run
  `node scripts/site-art.mjs` in ef-assets for the same list by hand (`needs.md`).
- **Full dump, all stages.** After the tables, also run `advanced\run_jsondata.bat`
  (skills/buffs for the sim), `dumper\build_asset_index.py` and
  `map_banner_layers.py` (banner screens, icons). Stale indexes hide new art.

## The site reads these paths, not the ones the art scripts write first

| Banner | Site loads | Made by |
|---|---|---|
| Chartered / RE-Factor Headhunting | `banners/game/<pool>.webp` + `banners/game/layers/<pool>-back/-op.webp`, and `"gameArt": true` on the pool in banners.json (automatic: `site-art.mjs` sets it once all three are there and the `-op` layer is over 10 KB, except pools on its `HOLD` list) | `operator-banner.py` (locally, needs the dump) |
| Arsenal / RE-Factor Issue | `banners/<pool>.webp` (a copy of `issues/<weapon>.webp`, automatic) + `banners/layers/<pool>.webp` | `issue-banner.py`, then `issue-layers.py` (the schedule workflow runs it) |
| Any pool without the above | `banners/<pool>.webp` | copy of `headhunting/<operator>.webp` (automatic) |

Operator portraits in Database → Operators (`operators/bust-3/<id>.webp`) always come from the official
page https://endfield.gryphline.com/en-us/operator (`operator-cards.py`; the owner's rule), never another
source. A new operator appears there some days after release: re-run it then (the weekly wiki workflow does).

`headhunting/` and `issues/` alone show nothing: `bannerArtUrl` always returns a
`banners/...` path. `site-art.mjs` (run by both workflows) copies a banner's
schedule `art` there when the pool file is missing. Also needed per new operator/weapon: `operators/<id>.webp`,
`operators/full/<id>.webp`, `arsenals/<id>.webp`, and an entry in
`wiki/operators.json` (`operator-from-game.py` until the wiki has them).

Layouts change between versions (1.7 moved the operator to
`CenterNode/MainRoleLayer`): look at every new layer file, not just the flat one.
An `-op` layer of a few KB is empty.

## Medals, archives and story

The wiki and the community dump lag a version by weeks. From the local dump, in ef-assets:
`python scripts/collections-game.py <dump output>`, `node scripts/wiki-collections.mjs --merge-only`
(medals and archives the wiki lacks, kept through weekly runs, replaced by the wiki's entry under the
same id once it lists them) and `node scripts/story.mjs --local <dump output>` (the weekly remote run
leaves story/ alone until the community dump has every mission). Then here:
`EF_ASSETS_DIR=<clone> node scripts/wiki-collections.mjs` for the snapshots.

## After

- After pushing art made locally, run `node scripts/site-art.mjs` and commit
  banners.json with it (or let the next workflow run do it); the cdn-branches
  workflow publishes on every push to main. By hand: `scripts/cdn-branches.sh`, Git Bash. New files
  appear at once; a **changed** file can take up to 12 hours even after a purge,
  so get art right before its first push, or give a fix a new file name.
- Check the live pages, not just the files: Home's open banners, each new
  banner page, each new operator/weapon database page.
