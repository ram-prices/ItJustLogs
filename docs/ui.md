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
    Save-Data get the still frame only. Pictures (banner art, headers, the
    Character card) shift a little against the mouse (`ui/parallax.ts`;
    Arsenal Issues in layers from ef-assets `banners/layers/`, the weapon
    floating). Firefox puts moved-only pictures on whole pixels (twitching);
    `transform: perspective(600px) rotateY(0.02deg)` stops it, measured on a
    real screen (a flat `rotate` fixes headless Firefox only).
  - Banner art (`bannerArtUrl` in `domain/banners.ts`): Headhunting pools in
    `GAME_ART` use ef-assets `banners/game/<pool id>.webp`, the game's own
    banner screen laid out without text (ef-assets `scripts/operator-banner.py`,
    from the EndfieldDataDump checkout); add a pool there once its file is
    made. Other pools keep `banners/<pool id>.webp` (operator close-up, Issue
    art). Unpulled Headhunting cards prefer it over the schedule's `art`.
    Discord embeds still use the schedule's `art`.
  - Potential art (`domain/potentialArt.ts`, `ui/pages/potentialArt.ts`): the
    pictures P1, P3 and P5 unlock (ef-assets `operators/potential/<id>-p<n>.webp`
    and its `index.json`, from `scripts/potential-art.py` and the EndfieldDataDump
    checkout; Minghe has none in the game's table). An operator page's banner
    shows the highest one the player owns (Auto); the hero's Banner art button
    (`wallpaper`, labelled with what shows) opens a pop-up of Auto, Base and
    every picture, locked ones dimmed with a lock and still pickable. A picked
    picture goes over the player's own banner pictures; Auto and Base don't.
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
    them. Ranks show as the game's notches (`skillNotches`, WeaponSkillCell's notch cell: ef-assets
    icons/weapon-skill from its scripts/weapon-skill-notches.py; white = the weapon's own level, #FFF100 =
    what essence adds, dim = still reachable, outline crossed by a slash = past its tuning/Potential cap):
    by each name in Skills (16px, as Essence's; no rank slider: each skill's text shows at its rank). Beside it, Essence holds only the
    essence's own grooves per skill, a list whose rows line up with Skills' (the third skill named by its kind,
    "Efficacy": an essence fits any weapon with that kind of third skill) (`essenceNotches`, 6/6/3: yellow etched, grey not yet), each a button:
    a click etches up to it, on the top one back one. Under both, Tuning: each tuning row a button (the done
    ones lit, the level reached in the head), a click tunes up to it, on the current one back one.
    Loadout's weapon slot (`weaponPicker`) only shows them: each skill's name and rank notches under
    the weapon's name, like gear stats; tuning and essence are set on the weapon's page. Gear slots show the game's slot
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
    Settings. Database (`/database/...`) and Pulls (`/banner/...`) are
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
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/banner/headhunting/<banner>` opens one), `operator.ts` / `weapon.ts` = `/database/operators[/<name>]` / `/database/arsenals[/<name>]`, info from the wiki data plus the player's copies and Potential (`domain/owned.ts`: pulls + Token/Issue reward copies, shown as P0–P5: P0 is the first copy, each duplicate adds one, P5 (6 copies) is max; the copy that reached P5 and later spare copies are dated; Selectors aren't counted; the Operators/Arsenal pages (breadcrumbs Operators › Headhunting, Arsenal › Issues) switch to them with `kindNav`, and without an import those tabs open them; "All banners" (setting `showAllBanners`) adds every opened banner the player never pulled on, from `domain/catalog.ts`); shared pieces in `info.ts`; works without an import; operators and weapons the wiki doesn't have yet come from ef-assets `wiki/previews.json` (the official version guide: class, element, tags, kit summary, banner) as "Coming soon" pages and list rows (`previewPage`), until the wiki's entry replaces them; 6★ strip and ruler portraits link to it), `stats.ts`, `settings.ts`, `rotations.ts` with its parts in `rotations/` (docs/rotations.md)); shared pieces in
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
