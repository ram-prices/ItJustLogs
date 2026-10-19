# ItJustLogs

Client-side pull-history tracker for Arknights: Endfield, a rewrite of
`ram-prices/eftracker`. Vite + TypeScript, no framework, no backend: everything
lives in the visitor's browser: IndexedDB for pull history and avatar/header
images, localStorage only for small settings and the banner cache. Keep it that
way: localStorage's ~5 MB is shared with every site on `ram-prices.github.io`
(the old eftracker filled it with base64 images, which broke imports).
Deploys as static files via `.github/workflows/deploy.yml` on push to `main`
(`npm run build` → `dist/`) to GitHub Pages at the custom domain
`itjustlogs.dev` (the old `ram-prices.github.io/ItJustLogs` redirects there).
Served from the domain root, so `base: '/'` (absolute asset paths). Clean
paths need files on Pages: the `pageCopies` plugin in `vite.config.ts` copies
`index.html` into `operators/`, `arsenal/`, `stats/`, `settings/` and to
`404.html` (the fallback for `/operators/<poolId>`). Add new top-level pages
to its `PAGES` list.

## Commands

Node lives at `C:\Program Files\nodejs` and may not be on the Bash PATH:
`export PATH="/c/Program Files/nodejs:$PATH"` first.

- `npm run dev` (or `preview_start` name `itjustlogs-dev`, port 5173)
- `npm test` (Vitest), `npm run typecheck`, `npm run build`

## Layout

- `src/domain/`: pure logic, no DOM. `parse.ts` (import formats, merge/dedupe),
  `banners.ts` (pool ids → category/patch/rate-up, asset URLs), `pity.ts`
  (probability model), `analyze.ts` (per-banner pity/guarantee/luck),
  `patches.ts` (patch + weekly aggregation). Covered by `domain.test.ts`.
- `src/state.ts`: app state + `subscribe`.
- `src/store.ts`: persistence (localStorage, IndexedDB, ef-assets fetch).
- UI: Geist typography and tokens as the base, but the owner is deliberately
  drifting from strict Geist toward the original eftracker feel: banner cards
  are "acrylic" (blurred art backdrop under translucent panels, hero art with
  a vignette, mono rate-up chip with a left accent bar, and a pity ruler with
  6★ portrait pins inside the opened card). Keep that direction;
  the Geist rules below are a baseline, not a ceiling.
  - `src/styles.css` is the only stylesheet: Geist tokens first
    (`--background-100/200`, `--gray-100..1000`, `--gray-alpha-*`, `--op`
    purple = operators, `--ars` teal = arsenals, `--green/--amber/--red`
    status, `--r6/5/4/3` rarity, `--radius-sm/md/lg` 6/8/12), then the Geist
    type classes (`heading-48..14`, `copy-16..13`, `label-14..12`), then
    components. Light theme is the `:root[data-theme='light']` token block.
    Phone tweaks live in the `max-width: 640px` blocks.
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
  - `index.html` is a bare shell (`#app`, drop overlay, file input).
    `ui/app.ts` renders header + tabs, routes on clean paths (`/operators`,
    `/operators/<poolId>`, `/arsenal[/<poolId>]`, `/stats`, `/settings`;
    `/` is Operators) with `history.pushState` for in-page links, rewrites
    old `#/...` links, and holds the delegated `data-action` click handlers.
    Pages live in `ui/pages/` (`kind.ts` = operators/arsenal: every banner as a fixed-height card
    whose pull list scrolls; Expand (app.ts `toggleCard`) animates it to full height; `/operators/<poolId>` opens one), `stats.ts`, `settings.ts`); shared pieces in
    `ui/components.ts` (metric, badge, toggleGroup, pageHeader...);
    import/export in `ui/io.ts`; charts in `ui/charts.ts`.
  - Escape every user/game string: use the `html` tagged template from
    `ui/html.ts` (`raw()` only for trusted markup).
  - Signature features of the old site (6★ portrait strip, pity ruler, luck
    curves, profile header) are being re-added one at a time in Geist style.
- `scripts/export-pulls.ps1`: the PowerShell exporter, shown in Settings → Get
  your data via `?raw`. Keep it readable and dependency-free. Its only network
  target must stay `ef-webview.gryphline.com`. Character pool types are a fixed
  list; the server stopped listing valid values in its error message.

## Domain rules worth knowing

- Chartered Headhunting 6★ pity is shared across all Chartered banners; the
  120-pull rate-up guarantee is per banner. Basic, New Horizons and each Joint
  pool keep their own pity. Weapon pity and the 80-pull guarantee are per banner.
- Arsenal Issues are pulled in sets of 10 and the game treats each set as one
  pull: weapon pity is out of 4 sets, the rate-up guarantee is the 8th set.
  Rewards: a Selector on set 10 (non-rate-up weapons, not a copy), then every 8
  sets alternating a rate-up copy and a Selector (18 copy, 26 Selector, ...). `analyze.ts` stores weapon pity,
  guarantee and rewards in sets (`setOf`); rulers and labels show set numbers.
- Free pulls never touch pity. Banner rewards are listed in the export but are
  not pulls and are filtered out (`isGift`: any `kind: gift_*`):
  `gift_intel_book` (Headhunting Dossier), `gift_operator_token` (Token),
  `gift_weapon` (Arsenal rate-up copy, no `weaponId`), `gift_weapon_box`
  (Selector). Reward counts come from the schedule in `analyze.ts`, not these.
- `rateUpPmf` clamps `startPity` to `hardPity - 1`. Pity resets on hit, so
  `hardPity` itself is not a real state.
- Banner names/rate-ups come from `ram-prices/ef-assets/banners.json`
  (snapshot in `src/data/` for offline/tests, refreshed at runtime). Fix bad
  banner data there, not with special cases here.
- `fixtures/` is gitignored and holds the owner's real export. Never commit it.
