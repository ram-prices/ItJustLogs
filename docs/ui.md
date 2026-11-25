# UI, routing and pages

The full UI notes: styles, icons, Home widgets, routing and what each page file holds (read for UI work beyond the rules in CLAUDE.md).

- UI: Geist typography and tokens as the base, but the owner is deliberately
  drifting from strict Geist toward the original eftracker feel: banner cards
  are "acrylic" (blurred art backdrop under translucent panels, hero art with
  a vignette, mono rate-up chip with a left accent bar, and a pity ruler with
  6★ portrait pins inside the opened card). Keep that direction;
  the Geist rules below are a baseline, not a ceiling.
  - Styles: `src/styles.css` imports `src/styles/*.css` in cascade order (keep it); `base.css` has the Geist tokens first
    (`--background-100/200`, `--gray-100..1000`, `--gray-alpha-*`, `--op`
    purple = operators, `--ars` teal = arsenals, `--green/--amber/--red`
    status, `--r6/5/4/3` rarity, `--radius-sm/md/lg` 6/8/12), then the Geist
    type classes (`heading-48..14`, `copy-16..13`, `label-14..12`), then
    components. Light theme is the `:root[data-theme='light']` token block.
    Phone tweaks live in the `max-width: 640px` blocks. Wide content scrolls sideways
    in its own box (the Rotations timeline, tables), never the page.
    Pages are up to 1600px wide (`.container`); text that is read, not scanned,
    keeps a readable width (story dialogue 960px, Settings 1000px, event details 80ch).
  - Vercel rules: borders are shadows (`--shadow-border`, `--shadow-card`,
    never CSS `border` on cards); tracking in px shrinking with size (-2.4px
    at 48, -1.28px at 32, -0.96px at 24, -0.32px at 16, 0 at 14); weights
    400/500/600 only; Geist Mono uppercase for technical labels (metric
    labels, table headers); pill badges; blue `--focus` ring and `--link`.
    Colour is for data only (rarity, pity heat, operator/arsenal), not chrome.
  - Fonts: Jost everywhere (400 body, 500 labels, 600 headings/numbers; index.html
    loads only `wght@400..600`, so a 700 renders as 600); Geist Mono only for code. Icons: Material Symbols Rounded weight 300,
    loaded with an explicit `icon_names=` list in index.html: add new names
    there (alphabetical).
  - Sentence-case labels; inline styles only for data-driven values.
  - Home plays a looping game clip behind it (`ui/videoBackground.ts`): the
    one picked in Settings → Backgrounds (`homeClip`, or 'none'), else one of
    ef-assets `backgrounds/index.json`'s defaults at random (its `operators`
    map is unused for now). Clips are made with ef-assets
    `scripts/background-clip.py` from the owner's recordings (seamless loop,
    1280x720 WebM + MP4 + first-frame JPG, bottom strip with the player's UID
    always cut off). Settings → Backgrounds Still, reduced motion, phones and
    Save-Data get the still frame only. Pictures (banner art, event headers, the
    Character card; not the operator page's header) shift a little against the mouse (`ui/parallax.ts`;
    Arsenal Issues in layers from ef-assets `banners/layers/`, the weapon
    floating; `gameArt` Headhunting cards as backdrop + operator from
    `banners/game/layers/<pool>-back|op.webp` (`operatorArt`, made by
    `operator-banner.py`: the operator is the layout's `MainRoleImage`, its
    colours solved so the pair stacks back to the flat file), the operator
    moving ~3 px against a ~1 px backdrop on Home's and the Headhunting page's
    cards; only drawn where pictures can move, so phones and Still load the
    flat file). Firefox puts moved-only pictures on whole pixels (twitching);
    `transform: perspective(600px) rotateY(0.02deg)` stops it, measured on a
    real screen (a flat `rotate` fixes headless Firefox only).
  - Banner art (`bannerArtUrl` in `domain/banners.ts`): Headhunting pools
    flagged `gameArt` in banners.json (`GAME_ART`, filled by `setGameArtPools`
    whenever state sets the banner db) use ef-assets `banners/game/<pool id>.webp`, the game's own
    banner screen laid out without text (ef-assets `scripts/operator-banner.py`,
    from the EndfieldDataDump checkout; it puts tightly packed sprites back on
    their full rect so nothing stretches); ef-assets `scripts/site-art.mjs` sets
    the flag once the file and both layers are there. Other pools keep `banners/<pool id>.webp` (operator close-up, Issue
    art). Unpulled Headhunting cards prefer it over the schedule's `art`.
    Discord embeds still use the schedule's `art`.
  - Potential art (`domain/potentialArt.ts`, `ui/pages/potentialArt.ts`): the
    pictures P1, P3 and P5 unlock (ef-assets `operators/potential/<id>-p<n>.webp`
    and its `index.json`, from `scripts/potential-art.py` and the EndfieldDataDump
    checkout). An operator page's banner
    (Auto) shows the player's own banner picture (art.ts, placed in Banner),
    else the highest Potential picture they own (`bannerShown` in
    domain/potentialArt.ts); the hero's Banner art button (`wallpaper`,
    labelled with what shows) opens a pop-up of Auto, Custom (only with an
    own banner picture), Base and every Potential picture, locked ones dimmed
    with a lock and still pickable. Custom with its picture deleted falls back
    like Auto; Base shows no picture. Any banner picture, the player's or a
    Potential's, makes the hero taller (the player's keeps its own position,
    `.own-art`) (`.wiki-hero.tall`: a wide
    band, 20vw between 260px and 320px, the picture cropped not stretched, facts on a stronger bottom
    fade; phones show the whole 2:1 picture across the top with the facts
    under its fading foot) with the operator's eyes about 40% down the band:
    `focus` in the `index.json` (file → [x, y] fractions, between the eyes, set by
    hand from a contact sheet; operator.ts passes it as `--fx`/`--fy`, CSS
    places it with `cqw` and lets the picture end early, faded, when a low
    face needs room; `potential-art.py` keeps them and leaves new
    pictures without one, which centres them). The player's own banner art
    keeps the usual height and their own position. A hero with a picture
    (`.wiki-hero.has-art`) pins only its
    picture (`.wiki-hero-pin`, `position: fixed` under the site header, as tall
    as the header: `--hero-h`, app.ts `watchHero`), which fades out fully once the page has
    scrolled 60% of the header's height (scroll-linked, no script); its shades sit on the
    pin and fade with it: a strong vignette in the page's colour and an eased
    fade at its foot (from 40% of the band) into the page. The facts, page and footer scroll up over it; the
    page's background is clear and its cards acrylic. The picture runs on
    `--pin-under` (220px, phones 96px) under the top of the page. No shade
    behind the facts: the text keeps its halo (`.tall .wiki-hero-text`). Browsers without
    scroll-linked animations (Firefox) get the same fade from a scroll handler
    (`ui/heroFade.ts`, once per frame); the rest is plain CSS both share. Once the picture has fully faded (48px past the end) `heroFade.ts` sets `.pin-gone` on the header in every browser: the picture stops being drawn and the cards drop their blur, with only the plain page behind them. Keep that: blurred cards over the running fade cost most of this page's drawing (Firefox software rendering at 3440x1315: 15 fps, p50 70 ms; with `.pin-gone` p50 7 ms past the fade), while scroll handlers, style, layout and paint cost next to nothing. Inside the fade itself the blur has to follow the changing picture every frame and stays slow on weak GPUs; that part is the design. With
    reduced motion the picture isn't held or faded: it scrolls away with the header. The picture is one flat file (Potential posters and the
    player's art have no layers), so on the detail view it shifts as a whole.
    Built pages and Discord embeds keep the base art.
  - Oroberyl, wherever named, shows its game icon in red: `itemName` in
    `ui/components.ts` (`OROBERYL_ICON`, ef-assets icons/items, `--oroberyl`).
  - Rarity is drawn with the game's emblem, not a ★ glyph: `STAR_SVG`,
    `stars(n)` and `withStars(text)` in `ui/components.ts` (endfield.wiki.gg
    Star.svg, in the text's colour). `--emblem` (13px beside small text, database.css) keeps one size on cards, stats and filters;
    headings and the header's row keep their own. A chart's emblem is a nested SVG, so it's sized by attributes: Chrome ignores CSS sizes there. Keep "★" only in attributes and
    `<option>` text. Potential is written "P3"; the game's Potential star
    (`potentialStar`) only beside that text or as decoration.
    Artifice levels show the game's mark (`artificeIcon`, endfield.wiki.gg
    Artifice_<n>_icon.svg: a gear and three bars, lit per level, in the game's
    blue #26bbfd, its gear widgets' COLOR_ENHANCED). Artifice is per stat, as in the
    game (EquipConst maxAttrEnhanceLevel 3; EquipTable's enhancedAttrValues, the
    same numbers as wiki/gear.json's stat `values` [base, +1, +2, +3]): every stat
    line (`gearStats` in loadout.ts) has its own mark and "+base » +artificed" (the
    artificed value in the blue), and the piece its own node (`gearArtificeIcon`:
    the mark without bars) in three states, `artificeState` after the game's
    EquipEnhanceNode: empty at 0, half once any stat is artificed, full when the
    total reaches stats × 3. Loadout: the node at the slot's top right, the stats
    under the name, each mark a select over it (`gear-art-pick`).
    Weapons: tuning and essence, as in the game (ef-assets combat/weapon-tuning.json, its
    scripts/weapon-tuning.mjs, from WeaponBreakThroughTemplateTable, WeaponTalentTemplateTable and
    WeaponBasicTable; `weaponBounds` in domain/loadout.ts). Each tuning stage (0–4, tuned at Lv 20, 40,
    60, 80) gives each skill a [lowest, highest] level; 4–6★: 1–3/1–3/1–4, 2–5/1–4, 2–6/2–6, 3–8/2–7,
    3–9/3–9 (the own skill 1–4 at every stage). Each Potential moves the own skill's both bounds up one
    (P5: 6–9). An essence adds its term level (GemPresetTable: up to 6 on a stat skill, 3 on the own
    skill) to the lowest, up to the highest (`skillLevel`). Per weapon in settings (`weaponTuning`, unset
    = 4; `weaponEssence`, else old `weaponRanks` read as fully tuned, `essenceFromRanks`; `maxEssence`),
    so every operator holding it agrees. The weapon's page (Database → Arsenals) is the main place to set
    them, in one Skills section beside Base ATK (stacked on phones; Maxed Essence in its head). Grooves are the game's notches (WeaponSkillCell's
    notch cell: ef-assets icons/weapon-skill from its scripts/weapon-skill-notches.py). Each skill row, after
    its name, has its 9 levels as two groups side by side (`grooveSlots`): what tuning gives (white: 3 on a
    4–6★ stat skill, 5 on a 3★'s, 1 on the own skill, lit up to its lowest at the stage) joined with what
    Potential gives (purple, 5, own skill only: lit per Potential, crossed out past it; `baseNotches`), then the essence's (yellow,
    6/6/3, 4 on a 3★'s stat skill; grey not yet etched, crossed out past what the tuning cap lets count;
    `essenceNotches`, each a button: a click etches up to it, on the top one back one), with its rank "7/9", on a line under its
    name, and at the far right its stat at that rank (`skillStat`: "+100", the own skill's named, "Treatment
    Efficiency +18%"); the same at every width. Rows don't collapse; the own skill's effect (its text past that
    stat, at its rank) always shows under them. Under
    both columns, Tuning: each tuning
    row a button (the done ones lit, the level reached in the head), a click tunes up to it, on the current
    one back one.
    Loadout's weapon slot (`weaponPicker`) only shows them, under the weapon's name laid out like gear stats:
    each skill's level of what it can reach now ("5/7": tuning's cap, Potential's on the own skill) where a
    gear stat has its Artifice mark, its name (the own skill by its kind, "Medicant"), and at the right what it
    gives at that level (`skillStat`, the game's value: "+100", or "Treatment Efficiency +18%" on the own
    skill). Under the own skill, its effect in short: ef-assets wiki/weapon-summaries.json (hand-written, checked
    by its scripts/check-weapon-summaries.mjs), lines in wiki markup with {k} = the skill's values[k] at its level
    (`fillTemplate`); a branching one (Type 42: Solemn Phalanx, Intellect vs Will) shows only the branch the
    operator's attribute totals meet (`summaryLines`, the Attributes card's numbers), its label first.
    Tuning and essence are set on the weapon's page. Gear slots show the game's slot
    marks (`slotIcon`, ef-assets icons/gear-slots, the wiki's Gear Icons),
    the weapon slot the operator's weapon type (`weaponTypeIcon`, ef-assets weapon-types).
    The Operators list (`database.css` `.op-card`) is portrait cards, our take on
    the game's: card art (`operatorCard`, ef-assets `operators/bust-3/`; a new
    folder name whenever the art changes, since caches keep it a week): the
    official site's operator pictures (endfield.gryphline.com/en-us/operator,
    clean upper body, no background) cut to 303x324 from the top (shown square) by ef-assets
    `operator-cards.py`, which the weekly update-wiki run uses for new operators; the face
    portrait via `data-alt` until a card exists), Potential top right as an acrylic
    pill, then the name with class and element icons
    (`classIcon`, `elementIcon`) under it, a rarity-coloured line along the card's bottom; no stars. The class/element names sit in `hidden` spans so
    the search still finds them.
    6★ tiles (`tileArt`, `.rarity-art.smoke`, weapons and operators) draw the game's rainbow smoke: the item slot's
    `6StarColorSequence` with `m_fx_sixstar_bg_w`, pre-rendered by ef-assets `scripts/six-star-smoke.py`
    into a 10 s loop (`effects/six-star/smoke-loop-3.webp`; sway and speed matched by eye to a recording),
    sized from the 120px slot to the 48px tile, in place of the rarity glow (no tile has the glow). Operator cards show the plain portrait, no smoke.
    (A live SVG filter was too slow: Chrome redraws it on the CPU per tile, every frame.)
  - `index.html` is a bare shell (`#app`, drop overlay, file input).
    `ui/app.ts` renders header + tabs, routes on clean paths (`/` Home,
    `/database/operators[/<name>]`, `/database/arsenals[/<name>]`,
    `/banner/headhunting[/<banner>]`, `/banner/arsenal[/<banner>]`,
    `/banner/stats`, `/settings`) with `history.pushState` for in-page links,
    and holds the delegated `data-action` click handlers. URLs use English
    names: items by `itemSlugs`, banners by the name `scheduleLinks` gives
    them (`bannerSlugs`), else the id; links are built by `infoHref` /
    `bannerHref` in `pages/info.ts`, and the router swaps ids for names. Old
    paths (`/operators/info/<chr id>`, `/arsenal/<poolId>`, `/stats`, `/pulls`,
    `#/...`) are moved to today's (`currentPath`), and their folders are
    still built, so old links keep working.
    Header tabs: Home, Pulls, Database, Rotations (WIP), Contracts, Essences, AIC (WIP), Achievements, Archive, Story,
    Settings. The current tab has a `--gray-alpha-200` pill and the underline. On phones (`max-width: 640px`) the tabs share the row, icons only (`TAB_ICON`, every tab needs one; the label is `aria-label` and `title`), so all eleven fit without scrolling; the WIP badge shrinks to the icon's corner. Essences, AIC, Contracts and Rotations are hidden until ticked in Settings → Tabs (`showEssences`, `showAic`, `showContracts`, `showSim`); their routes still open when typed. Database (`/database/...`) and Pulls (`/banner/...`) are
    sections picked with side tabs (`databaseTabs` / `pullsTabs` in
    `pages/info.ts`); `/database` and `/banner` open the page last used there.
    Side-tab pages show no title or summary line (the top and side tabs say
    where you are): `pageHeader` goes inside `.collection-layout` (`sideTabs`
    `head`), its title for screen readers only, its buttons above the side tabs.
    Home is widgets (`ui/pages/homeWidgets.ts`, settings `home`: type, width
    4/6/8/12 of a 12-column grid, own settings; unset = the schedule as
    before): the schedule's four sections, Pity, 6★ history, Latest pulls,
    Stats, Collection, Contingency Contract (`contractSection` in home.ts, Current's row look: the running season, else the next, hidden with none or with `showContracts` off; loads only cc/index.json, and the season file when the picker has a saved selection for it), Note and Character card (an operator, one of their
    pictures, title, note, chosen facts) and Empty space (full width, height
    dragged). Customize: drag to move (near a widget's top or bottom stacks
    it in that widget's column; into empty room in a row it lands there at
    that column, `col`, shrunk to fit, outlined while dragging: `roomAt`),
    width, title, edit, remove, add, reset, cancel; a narrower widget can be
    placed left, middle or right of its row (`align`); width and place change
    each widget on its own (`separate`): `gridPlaces` gives every widget or column an
    explicit row and column on wide screens (`newRow` keeps a widget placed
    out of a column at its height), and placing one pins the others in its
    row where they are. On a phone (640px wide or less) Home is one column
    with its own order and hidden widgets (settings `homePhone`, the same
    widgets; unlisted ones follow in the wide layout's reading order):
    Customize there only reorders, edits, and hides/shows. Home's event rows
    have a tags line (`eventTags`: Limited/Permanent, Limited-Time Rewards,
    Daily Rewards with how long's left to start them, Unique) from ef-assets
    events.json `permanent`, `limitedRewards`, `days`, `unique`.
    The profile picture can rise above its
    circle (settings `avatarPop`; `avatar` in components.ts): `cropper.ts`
    gives a frame 2.5 circles wide and 1.4 tall where the player paints what
    shows outside the circle (with a live preview); it's saved trimmed to
    what shows, see-through elsewhere, and settings `avatarBox` says how far
    it reaches left and right, so room is made only on those sides.
    Every saved picture is kept (last 12, `SavedAvatar` in store.ts, this
    browser only) under Saved pictures, to use again or delete.
    Pages live in `ui/pages/` (`home.ts` = the schedule: banners open now
    with your pity and rate-up status (Headhunting: Chartered first, then RE-Factor, then the rest, `headhuntingRow` in domain/schedule.ts, and a limit never drops a Chartered banner for a re-run), events now, coming up, and a
    version/banner/event timeline; works without an import; anything with
    `data-link` or `data-card-image` gets a right-click / long-press menu
    (`installCopyMenu`: Copy link, Copy banner card, or Share banner card on phones, via `ui/cardImage.ts`); `kind.ts` = operators/arsenal: every banner as a fixed-height card
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/banner/headhunting/<banner>` is that banner's own page, `bannerPage`: its art as the header, then its card opened), `operator.ts` / `weapon.ts` = `/database/operators[/<name>]` / `/database/arsenals[/<name>]`, info from the wiki data plus the player's copies and Potential (`domain/owned.ts`: pulls + Token/Issue reward copies, shown as P0–P5: P0 is the first copy, each duplicate adds one, P5 (6 copies) is max; the copy that reached P5 and later spare copies are dated; Selectors aren't counted; the Operators/Arsenal pages (breadcrumbs Operators › Headhunting, Arsenal › Issues) switch to them with `kindNav`, and without an import those tabs open them; "All banners" (setting `showAllBanners`) adds every opened banner the player never pulled on, from `domain/catalog.ts`); shared pieces in `info.ts` (Pull history, `ownedSection`: one box `ladderBox`: the Potential reached ("P5"), then P0–P5, each in a circle lit once unlocked, beside the copy that unlocked it (pull list cells and markers: Free, Reward, Extra, Lost; the pull or set number alone in the pull list's grey `pull-no`, and for 6★ only the pity as "18/80", the banner's hard pity: 80, 40 on New Horizons, 4 sets for weapons; the section is titled "Potentials"; the whole row opens, its arrow centred), every Potential opening what it does (locked ones dimmed too), further copies folded in a "20 more" row under it; weapons get P-levels only and their Potential text under it (`LadderInfo`); the ladder's rows go two-line when the box is under 560px (a container query). Operator pages put it, Attributes and Loadout in three columns (`.wiki-cols.three`; 900–1200px Pull history spans the top; one column under 900px); the operator's storage box sits in its own row above Profile ("Storage", `storageBox` in art.ts: a small drive, newest first, as `Entry` kinds (files, notes, links; another kind is one more variant with a tile and editor): files are kept as uploaded with their names; a picture or video opens in the viewer (`openArtViewer`: videos play with controls; Use as banner and the banner position sliders on pictures; Download; Delete pressed twice), any other file is a row that downloads; notes (plain text, line breaks kept) and links (optional title, open in a new tab, never fetched) are edited in place in their own row, Edit and Delete (pressed twice) beside them, Ctrl+Enter saves and Escape cancels; Add offers Note, Link or Files; the header's Art button opens Add; Home's character card can upload pictures through the same `saveFiles`; docs/sync.md)); works without an import; operators and weapons the wiki doesn't have yet come from ef-assets `wiki/previews.json` (the official version guide: class, element, tags, kit summary, banner) as "Coming soon" pages and list rows (`previewPage`), until the wiki's entry replaces them; 6★ strip and ruler portraits link to it), `stats.ts`, `settings.ts`, `rotations.ts` with its parts in `rotations/` (docs/rotations.md)); shared pieces in
    `ui/components.ts` (metric, badge, toggleGroup, pageHeader...);
    import/export in `ui/io.ts`; charts in `ui/charts.ts`.
  - The operator page's footer credits the data source per operator: one whose numbers the wiki has no set for yet (ef-assets `wiki/operators-game.json`, read from the game's tables by its `scripts/operator-from-game.py`) gets the game-tables credit (`gameCredit` in `info.ts`: "Data from the game's tables (EndfieldData)"); every other operator keeps the wiki credit (`credit`: "Data from endfield.wiki.gg, CC BY-SA 4.0. Snapshot of <date>"). The page loads `operators-game.json` beside `operators.json` and picks the credit by membership; drop an operator from `operators-game.json` once the wiki has it (its `update-wiki.mjs` run then warns and skips it).
  - Popups: hover tips and the right-click menu share one dark panel (`.tooltip`, `.ctx-menu` in
    `components.css`: `--background-100`, `--shadow-menu`, `--radius-md`). A tip is a `data-tip`
    attribute holding `tip(title, rows)` from `ui/charts.ts`: a bold title (left out when ''), then
    `tipNote(text)` lines (muted) and `tipRow(label, value)` rows (muted label, semibold value);
    joined tips stack with a line between. One delegated host (`installTooltips`) shows them beside
    the pointer, kept inside the window; on touch screens a tap opens one (links and fields keep
    their tap). Use it for anything that tells the player something (dates, breakdowns, counts);
    native `title=` stays only on plain button hints. The right-click / long-press menu is
    `installCopyMenu` in `home.ts`; a new menu reuses `.ctx-menu` with icon + label buttons.
  - Escape every user/game string: use the `html` tagged template from
    `ui/html.ts` (`raw()` only for trusted markup).
  - Signature features of the old site (6★ portrait strip, pity ruler, luck
    curves, profile header) are being re-added one at a time in Geist style.

- Art header (`.wiki-hero.art-hero.has-art`, collections.css), shared by event pages and banner pages (`.banner-hero`): the art fills the header (at least `clamp(260px, 30vw, 340px)`, 220px on phones; taller when the text needs it), `object-fit: cover` anchored at the bottom (banner art at 30% from the top, where the game's layouts put the face); its own vignette runs into the page, plus a 56px `--background-100` fade (`::after`; in light a long eased one, 56% of the header, since dark art over a short fade reads as a grey band) and a dark scrim behind the white text (stronger in light; `closest-side`, so it reaches nothing before its box ends and leaves no edge). Art that fails to load drops `has-art` (`installImageFallback`), leaving a plain header. Basic Headhunting's and New Horizons' flat art has lettering beside the faces, so their headers use `HERO_ART` in kind.ts: ef-assets `banners/game/standard.webp` and `banners/game/beginner.webp`, the same art with the lettering painted out (faces held right, the left a smooth dark gradient for the text); their cards keep the flat files.
- Skeletons: pictures with a fixed box (hero art, portraits, operator cards, tiles, banner art, Home thumbnails, ruler heads; the `:is()` list in components.css) show `--skeleton` with a `--skeleton-shine` band until `installImageReady` (common.ts) marks them `.img-ready`, on load, or before paint for a redraw's pictures already in memory. New picture kinds go in both lists (the shimmer and the reduced-motion one).
- Rate-up names on banner cards (`rateUpNames` in kind.ts) link to the Database page: operators always, weapons once weapons.json shows they have one (app.ts loads it on Home and the Arsenal banner list). Joint banners' "N rate-ups" stays text. The banner page header's Rate-up line uses the same `rateUpNames`: one rate-up links to its page, and a Joint banner's several read as "N rate-ups" (like the card's chip), beside the player's Potential chip.
- Home's list cards (`.sched-next-list`) have no vertical padding, so an event row's art reaches the card's edges; `.evt-strip` overscans the row by 32px so its blur never thins out at an edge.
- Event headers (`.event-hero`) have no parallax, in CSS and `parallax.ts`; `heroFade.ts` only schedules frames on pages with a pinned picture.
- Empty states: `emptyState(icon, text, { cls, hidden, action })` in components.ts, `.empty-state` in banners.css: one icon and one line inside the panel, wherever a panel has nothing yet and for empty searches (`cls: 'list-search-empty', hidden: true`). `icon` is a Material name or an `Html` mark.
- Home cards lift 2px with a stronger tint glow (150ms, `@media (hover: hover)`, loadout.css), not while Customize is on. Event rows with art draw it blurred behind the row (`.evt-strip`, home.css); the thumbnail or icon stays.
- Pity rulers: a 5px track holding two 2px lines; crowded rulers (over `MAX_FULL_PINS`) mark each 6★ with a small emblem in its pity heat. Stats: the weekly chart's 6★ mark is the emblem, and data hints use `data-tip`, not `title`.
- The banner card's glance row (kind.ts `bannerSection`) pairs the pity stat with a reward stat (the "token counter"): the pulls (Arsenal: sets) toward the next reward, now shown out of its goal as `X / goal` (`<b>progress</b><i>/goal</i>`, like the pity stat) — Chartered Token `/240`, Joint Selector `/120`, Arsenal `/8` or `/10` sets.
- Win treatments on the pull views (kind.ts) make the big wins stand out with subtle, theme-consistent marks, no confetti or big animations: the 6★ strip tiles and the banner pull list each carry a rate-up chevron (`.six-flag.rateup` / the list's `.pull-tag.rateup`) and a "new" sparkle (`.six-flag.new` / `.pull-tag.new`, amber) for a first copy; on the strip both marks sit on a small dark badge (80% opaque, rounded) so they read over busy operator art — the chevron solid white in a heavier weight (the banner's colour stays on the tile's ring), the sparkle amber — while the list's chevron takes the banner's colour; on a shared set (one box, several 6★) each mark sits on its own weapon's portrait — the chevron on the rate-up, a star on each new copy — not on the box's corners; the strip's pity line shows only the number and its heat dot. The one-time light-up of a rate-up tile (banners.css) is a diagonal light band across the tile's own portrait, rippling diagonally across the strip (`.six-item.win`'s `::after`, `six-shimmer`, one-time; the `.win` class is set on rate-up tiles only, so a new-only or lucky-only tile keeps its corner marks but doesn't shimmer; each tile's band is delayed by its diagonal position — `--win-delay`, measured by `sixShimmerCascade` after render: top-left tiles first, bottom-right last, tiles on the same diagonal together; the band rests fully off the tile's edge, so a non-animating tile shows no trace). It plays once per page open; kind.ts keeps the class through the startup's redraws (a `lit` map, 3s window — longer than the effect) so it finishes, and the marks are static after; under reduced motion it doesn't play. The banner page (`bannerPage`) adds a one-line highlight callout (`.banner-highlight`, collections.css) above its card: the banner's most notable 6★ (its rate-up, else its luckiest) as "Rate-up <name> · pull N", with "· luckiest 6★ this banner" when it's the lowest pity; it glows in once on the page's opening (`.banner-highlight.enter`: the line rises while a soft gold bloom fades up and settles, the same family, skipped under reduced motion).
- Reduced motion: the block at the end of components.css stops every animation, keeps transitions to opacity, removes hover lifts and zooms, makes skeletons plain grey and drops the smoke. Parallax CSS sits behind `no-preference` (loadout.css), `parallax.ts` stops listening, the header picture isn't held (database.css, `heroFade.ts`) and the video shows its still. `scrollIntoView` calls pick `auto` there too. To test it, rewrite the stylesheets' `mediaText` from the page: the pane can't emulate it.
- Settings: four `group(title, parts)` cards in settings.ts (Account and sync, Display, Tabs, Data), each part a `.settings-part` with a line between; Delete locally saved data stays its own danger card.
- Light theme: dark-first values are tokens with a light counterpart in base.css: `--shadow-pop` (pop-up drop shadow), `--badge-backing` (light only: badges' tint sits on a light backing, so Limited/Unique and the rest read over art too; badges set their tint as `--badge-bg`), `--white-icon-filter` (the game's white class/weapon-type icons, `img.trait-icon`, darkened on white). Timeline bars get fuller fills in light so their white labels read. Hard-coded blacks left in the CSS are art scrims, masks and dialog backdrops, right in both themes.
- Redraws keep the player's place (app.ts `draw`): focus goes back to the same control (`focusMark` / `restoreFocus` in html.ts: by id, else data-action + data-value, else its data-* and name, else href, else its path; a text field keeps its caret), and inner scrollers (`INNER_SCROLLERS`: the timeline, banner cards' pull lists keyed by `data-pool`, tables, Rotations' lists...) keep their scroll. A new scroller that a redraw resets goes in that list.
- Background redraws wait for the banner cards' entrance (app.ts `holdForEntrance`): just after a page opens, data keeps arriving (saved versions, icons, pictures at about 90/130/160 ms on a full load; wiki files on a tab switch) and each arrival used to rebuild the page while the cards were sliding in. In a real Firefox the rebuilt cards stall until they're painted, then jump into place ("popcorn": in the owner's 60 fps recordings the cards step back at the redraw, crawl, stop 3/6/9 px short, and snap 0.3 s later). `getBoundingClientRect` in a headless browser doesn't show this (it reads the animation's time, not what was painted), so judge it from recordings, and from the rebuild log: no `#app` rebuild between a page opening and its visible cards landing. A redraw of the same page that no input caused (`userTurn`, set during click/key/input/change/drop/popstate handlers) is held while a `card-in` animation on screen is running, and done once when they finish (1.5 s cap). Opening another page and anything the player does redraw at once. The footer's "Version <commit> <UTC time>" (`__BUILD__`, vite.config.ts `buildId`) tells which build a browser or a recording is showing.
- Firefox stale entrance (app.ts `keepEntrancesSampled`): real Firefox runs the cards' slide off the main thread and stops updating its own copy; another repaint then draws the cards from that stale copy (step back at about +150 ms, a plateau 3/6/9 px short, a snap about 0.3 s later). It only shows in a real Firefox, never headless. The `?debug` readout (app.ts `debugNote`; `?debug=cv` also drops the cards' `content-visibility`, `?debug=off` ends it) made the jump disappear because it read each card's computed transform every frame, so that read now runs for every visitor while cards slide in (at most 2 s). Don't remove it as "unused".
- Entrances survive redraws (app.ts `entrancesPlayed` / `carryEntrances`; for the redraws that still happen mid-entrance, e.g. a click): the startup's redraws (data arriving just after a page opens) rebuild the page mid-entrance, which made banner cards jump to their end ("popcorn"). Before the rebuild each entrance's `currentTime` is read from the browser (Web Animations; it includes the stagger delay), and the rebuilt card, its `.banner-summary::before` tint and `main.fade-in` are set to it, or finished if done. Don't replace this with a clock guess (`performance.now()` since first render): on a busy load the browser starts the animation hundreds of ms after the code runs, so the guess runs ahead and still pops. Cards keep their `enter` class for 5 s (kind.ts `ENTER_MS`) so the rebuilt card has the animation to set. A new entrance animation goes in `ENTRANCE`. Checked by driving headless Edge over CDP with an imported history and logging the cards' top edge per frame: the old code jumped 14–15 px in one frame, this one moves at most ~3.7 px per frame.
- Back / Forward: each history entry keeps `scrollY` in `history.state` (saved 250 ms after scrolling stops and just before a link's `pushState`; `history.scrollRestoration` is manual), and `onPopState` scrolls there after drawing, trying again on the redraws of the page's first 1.5 s while its data loads, unless the player scrolls first. Links open new pages at the top. Keep `history.replaceState(history.state, …)` when rewriting an address, so the saved scroll stays.
- Route changes (a link or Back/Forward) move focus to the page's `h1` (else its `main`; given `tabindex="-1"` and `data-route-focus`, no ring) and the polite live region `#routeAnnouncer` (index.html, outside `#app` so it survives redraws) reads the page title. The first Tab stop is a "Skip to content" link (`.skip-link`, hidden until focused; `data-action="skip-to-content"` focuses `main`). Unknown paths (`/foo/bar`, `/banner/xyz`) show "Page not found"; `/banners`, `/event`, `/events`, `/index.html` alone still open Home.
- Dialogs: in-page dialogs call `holdFocus(backdrop, close, first?)` from `ui/dialog.ts` after appending: focus moves in, Tab stays inside, Escape closes, and its returned function (call it from `close`) puts focus back on the opener (or its stand-in after a redraw). Home's widget dialogs keep focus across their own re-renders.
- Lazy pages (`lazy` in app.ts) whose chunk fails to load (a tab open across a deploy asks for a file that's gone) aren't retried; the page shows "Couldn't load this page." with Reload (`data-action="reload"`). The picture cropper offers the same as a dialog (`askReload`).
- Home's Collection widget counts from `src/data/collectionIds.json` (the snapshots' ids only), so Home never loads `medals.snapshot.json` / `findings.snapshot.json`; `collectionIds.test.ts` fails when a snapshot refresh leaves it stale, and has the one-line command that rebuilds it.
- Saved data (IndexedDB, `openDb` in store.ts) never holds the page back: blocked by another tab's older version for 3 s, or no answer in 8 s, the app mounts without saved pulls and says so in a toast (`savedDataTrouble`); an open database closes itself when a newer version elsewhere needs to upgrade.
- Wiki data loads (`loadWikiFile` in store.ts) keep their resolved promise, never refetched; a failed load is negative-cached for a minute (`WIKI_FAIL_TTL`): calls in the minute get the same rejection without a new request, and once the minute is up the file is tried again. `wikiFile` (info.ts) redraws only on a state change (loading → failed, failed → loaded), so a failing file (Home's `events.json`, the `cc/` files) can't refetch or redraw the page on every redraw.
