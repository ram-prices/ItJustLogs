# Achievements, Archive, Story, AIC and Essences

Read when working on one of these tabs or their screen readers.

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
  `/story/<slug>`: numbered as the list shows it, main story
  chapter-act-position (Rally and Unite `1-1-3`, the prologue act 0), side
  missions `s-<section>-<n>`, events `e-<n>`, outposts `o-<n>`, other
  missions `m-<n>`; old name links redirect, `storySlugs`; event pages list
  their own missions from index.json `activities`): every mission's dialogue from the game's own
  text, read from ef-assets `story/` (`scripts/story.mjs` there, weekly: the
  EndfieldData community dump at git.escartem.moe, a datamine of the game's
  tables; the text is Gryphline's, credited as such, not CC BY-SA).
  `index.json` groups missions as the wiki's Mission/Main and Mission/Side
  pages order them; sections the wiki doesn't index yet are `unlisted`
  (folded away: maybe unreleased). Each mission file has its scenes with the
  game's own summary, lines with speaker (operator portraits via `actor`),
  and the replies offered. Scenes with a dialogue tree in the owner's bundle
  export also have `flow` (ef-assets `scripts/dialog-order.mjs` →
  `dialog/order.json`, read by story.mjs): lines in play order, each choice
  where it comes with the lines every reply leads to, returns to the choice,
  conversations that end, conditional splits named by their condition (quest
  state 3 = the current objective, mission state 3 = done; `StoryFlow`,
  rendered by `flow()` in pages/story.ts: replies under the Endministrator,
  branches in columns, lines that only sometimes play kept in place);
  without one, the replies are listed after the scene. Lines without English text are
  left out. Works without an import; loaded on first use (`lazy`). The
  list's search field (`searchField` in pages/search.ts, visible so phones
  can use it) filters missions by name and chapter, and from 3 letters lists
  matching lines from ef-assets `story/search.json` (loaded on the first such
  search); a result opens `/story/<mission>#l-<scene>-<line>`, scrolled to and
  marking that line (`scrollToLine` in app.ts).
- AIC tab (`/aic`, `ui/pages/aic.ts`, `domain/aic.ts`): the AIC planner,
  from ef-assets `aic/planner.json` (`scripts/aic.mjs` there, weekly, from the
  EndfieldData dump: recipes with their facility mode, rigs/pumps/extractor as
  recipes, facilities' power and Protocol Capacity, items' phase and which
  depots hold them, Thermal Bank fuels, each area's Protocol Capacity by
  Regional Development level, Regional Transfer). Calculator: one place, no
  limits. Multi-site: the areas the player picks, each within its Protocol
  Capacity and ore nodes (blank = no limit); depot items are shared across a
  region's sites, other items (most fluids) stay at their site; each region's
  power is the PAC's 200 plus Thermal Banks; a region builds only recipes of
  modes it allows (Valley IV: "normal" only); Valley IV can send depot items
  to Wuling by Regional Transfer. A mixed-integer program solved by HiGHS
  (`highs` on npm, a devDependency for tests; loaded from jsDelivr in
  `ui/aicWorker.ts`, a Web Worker), a few seconds then the best found with
  its gap ("Search longer" gives it 30 s). What no site can make is listed as
  brought in from outside. Settings `aic` hold the page state.

- Essences tab (`ui/pages/essences.ts`, `domain/essences.ts`): the player's
  essences (settings `essences`: kind key → count) against every weapon's
  skill stats; only perfect fits (all of a weapon's stats) are suggested, by
  weapon or by essence. `ui/essenceReader.ts` + `domain/essenceReader.ts` read
  a recording of Valuables → Essences, Etch Essence or a weapon's essence
  screen: find the stat column once, then read only that area every 0.1s
  (`scan` focus option); a new essence each time the stats change and hold
  two frames.

Essences and AIC are hidden tabs by default: Settings → Tabs (`showEssences`, `showAic`) shows them. The routes always work.
