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
  - Fonts: Jost everywhere (weights 300–700 differentiate text: 400 body, 500
    labels, 600 headings/numbers, 700 list names); Geist Mono only for code. Icons: Material Symbols Rounded weight 300,
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
    floating; `GAME_ART` Headhunting cards as backdrop + operator from
    `banners/game/layers/<pool>-back|op.webp` (`operatorArt`, made by
    `operator-banner.py`: the operator is the layout's `MainRoleImage`, its
    colours solved so the pair stacks back to the flat file), the operator
    moving ~3 px against a ~1 px backdrop on Home's and the Headhunting page's
    cards; only drawn where pictures can move, so phones and Still load the
    flat file). Firefox puts moved-only pictures on whole pixels (twitching);
    `transform: perspective(600px) rotateY(0.02deg)` stops it, measured on a
    real screen (a flat `rotate` fixes headless Firefox only).
  - Banner art (`bannerArtUrl` in `domain/banners.ts`): Headhunting pools in
    `GAME_ART` use ef-assets `banners/game/<pool id>.webp`, the game's own
    banner screen laid out without text (ef-assets `scripts/operator-banner.py`,
    from the EndfieldDataDump checkout; it puts tightly packed sprites back on
    their full rect so nothing stretches); add a pool there once its file is
    made. Other pools keep `banners/<pool id>.webp` (operator close-up, Issue
    art). Unpulled Headhunting cards prefer it over the schedule's `art`.
    Discord embeds still use the schedule's `art`.
  - Potential art (`domain/potentialArt.ts`, `ui/pages/potentialArt.ts`): the
    pictures P1, P3 and P5 unlock (ef-assets `operators/potential/<id>-p<n>.webp`
    and its `index.json`, from `scripts/potential-art.py` and the EndfieldDataDump
    checkout; Minghe has none in the game's table). An operator page's banner
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
    (`ui/heroFade.ts`, once per frame); the rest is plain CSS both share. With
    reduced motion the picture isn't held or faded: it scrolls away with the header. The picture is one flat file (Potential posters and the
    player's art have no layers), so on the detail view it shifts as a whole.
    Built pages and Discord embeds keep the base art.
  - Oroberyl, wherever named, shows its game icon in red: `itemName` in
    `ui/components.ts` (`OROBERYL_ICON`, ef-assets icons/items, `--oroberyl`).
  - Rarity is drawn with the game's emblem, not a ★ glyph: `STAR_SVG`,
    `stars(n)` and `withStars(text)` in `ui/components.ts` (endfield.wiki.gg
    Star.svg, in the text's colour). Keep "★" only in attributes and
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
    6★ Arsenal tiles (`tileArt`, `.rarity-art.smoke`) draw the game's rainbow smoke: the item slot's
    `6StarColorSequence` with `m_fx_sixstar_bg_w`, pre-rendered by ef-assets `scripts/six-star-smoke.py`
    into a 10 s loop (`effects/six-star/smoke-loop-3.webp`; sway and speed matched by eye to a recording),
    sized from the 120px slot to the 48px tile, in place of the rarity glow (no weapon tile has the glow).
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
    Header tabs: Home, Pulls, Database, Rotations (WIP), Essences, AIC (WIP), Achievements, Archive, Story,
    Settings. Essences and AIC are hidden until ticked in Settings → Tabs (`showEssences`, `showAic`); their routes still open when typed. Database (`/database/...`) and Pulls (`/banner/...`) are
    sections picked with side tabs (`databaseTabs` / `pullsTabs` in
    `pages/info.ts`); `/database` and `/banner` open the page last used there.
    Side-tab pages show no title or summary line (the top and side tabs say
    where you are): `pageHeader` goes inside `.collection-layout` (`sideTabs`
    `head`), its title for screen readers only, its buttons above the side tabs.
    Home is widgets (`ui/pages/homeWidgets.ts`, settings `home`: type, width
    4/6/8/12 of a 12-column grid, own settings; unset = the schedule as
    before): the schedule's four sections, Pity, 6★ history, Latest pulls,
    Stats, Collection, Note and Character card (an operator, one of their
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
    with your pity and rate-up status, events now, coming up, and a
    version/banner/event timeline; works without an import; anything with
    `data-link` or `data-card-image` gets a right-click / long-press menu
    (`installCopyMenu`: Copy link, Copy banner card, or Share banner card on phones, via `ui/cardImage.ts`); `kind.ts` = operators/arsenal: every banner as a fixed-height card
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/banner/headhunting/<banner>` opens one), `operator.ts` / `weapon.ts` = `/database/operators[/<name>]` / `/database/arsenals[/<name>]`, info from the wiki data plus the player's copies and Potential (`domain/owned.ts`: pulls + Token/Issue reward copies, shown as P0–P5: P0 is the first copy, each duplicate adds one, P5 (6 copies) is max; the copy that reached P5 and later spare copies are dated; Selectors aren't counted; the Operators/Arsenal pages (breadcrumbs Operators › Headhunting, Arsenal › Issues) switch to them with `kindNav`, and without an import those tabs open them; "All banners" (setting `showAllBanners`) adds every opened banner the player never pulled on, from `domain/catalog.ts`); shared pieces in `info.ts` (Pull history, `ownedSection`: one box `ladderBox`: the Potential reached ("P5"), then P0–P5, each in a circle lit once unlocked, beside the copy that unlocked it (pull list cells and markers: Free, Reward, Extra, Lost; the pull or set number alone in the pull list's grey `pull-no`, and for 6★ only the pity as "18/80", the banner's hard pity: 80, 40 on New Horizons, 4 sets for weapons; the section is titled "Potentials"; the whole row opens, its arrow centred), every Potential opening what it does (locked ones dimmed too), further copies folded in a "20 more" row under it; weapons get P-levels only and their Potential text under it (`LadderInfo`); the ladder's rows go two-line when the box is under 560px (a container query). Operator pages put it, Attributes and Loadout in three columns (`.wiki-cols.three`; 900–1200px Pull history spans the top; one column under 900px); the operator's storage box sits in its own row above Profile ("Storage", `storageBox` in art.ts: a small drive, newest first, as `Entry` kinds (files, notes, links; another kind is one more variant with a tile and editor): files are kept as uploaded with their names; a picture or video opens in the viewer (`openArtViewer`: videos play with controls; Use as banner and the banner position sliders on pictures; Download; Delete pressed twice), any other file is a row that downloads; notes (plain text, line breaks kept) and links (optional title, open in a new tab, never fetched) are edited in place in their own row, Edit and Delete (pressed twice) beside them, Ctrl+Enter saves and Escape cancels; Add offers Note, Link or Files; the header's Art button opens Add; Home's character card can upload pictures through the same `saveFiles`; docs/sync.md)); works without an import; operators and weapons the wiki doesn't have yet come from ef-assets `wiki/previews.json` (the official version guide: class, element, tags, kit summary, banner) as "Coming soon" pages and list rows (`previewPage`), until the wiki's entry replaces them; 6★ strip and ruler portraits link to it), `stats.ts`, `settings.ts`, `rotations.ts` with its parts in `rotations/` (docs/rotations.md)); shared pieces in
    `ui/components.ts` (metric, badge, toggleGroup, pageHeader...);
    import/export in `ui/io.ts`; charts in `ui/charts.ts`.
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

- Event page header (`.event-hero.has-art`, collections.css): the art is capped (`clamp(260px, 30vw, 340px)`, 220px on phones), full width, `object-fit: cover` anchored at the bottom, in a grid cell shared with the text container; its own vignette runs into the page, plus a 56px `--background-100` fade (`::after`) and a local scrim behind the text.
