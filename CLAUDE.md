# ItJustLogs

Client-side pull-history tracker for Arknights: Endfield, a rewrite of
`ram-prices/eftracker`. Vite + TypeScript, no framework, no backend: everything
lives in the visitor's browser: IndexedDB for pull history and avatar/header
images, localStorage only for small settings and the banner cache. Keep it that
way: localStorage's ~5 MB is shared with every site on `ram-prices.github.io`
(the old eftracker filled it with base64 images, which broke imports).
Deploys as static files via `.github/workflows/deploy.yml` on push to `main`
(`npm run build` → `dist/`, `base: './'` so any GitHub Pages sub-path works).

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
- UI deliberately reproduces the old eftracker look exactly:
  - `index.html` is eftracker's page shell (same ids); `src/legacy.css` is its
    stylesheet copied verbatim. Put changes and the light variant in
    `src/style.css` rather than editing legacy.css.
  - `src/ui/model.ts` adapts the domain Analysis into the shapes eftracker's
    renderers used (category names, 10-pull weapon blocks, FREE/TOKEN summary
    items). `dashboard.ts`, `summary.ts`, `stats.ts`, `planner.ts`,
    `settings.ts` are ports of the matching eftracker `js/render-*.js` files.
  - `ui/app.ts` is the controller (tab slide animation, expand/filters, luck
    drawers, imports). Events are delegated via `data-action`/`data-tab`.
  - Pull rows and banner-box skeletons must stay whitespace-free between tags
    (`tight()` in dashboard.ts): the old CSS renders that whitespace.
  - Escape every user/game string with `escape` from `ui/html.ts`.
- `scripts/export-pulls.ps1`: the PowerShell exporter, shown in Settings → Get
  your data via `?raw`. Keep it readable and dependency-free. Its only network
  target must stay `ef-webview.gryphline.com`. Character pool types are a fixed
  list; the server stopped listing valid values in its error message.

## Domain rules worth knowing

- Chartered Headhunting 6★ pity is shared across all Chartered banners; the
  120-pull rate-up guarantee is per banner. Basic, New Horizons and each Joint
  pool keep their own pity. Weapon pity and the 80-pull guarantee are per banner.
- Free pulls never touch pity. "Headhunting Dossier" records (`kind:
  gift_intel_book`) are not pulls and are filtered out.
- `rateUpPmf` clamps `startPity` to `hardPity - 1`. Pity resets on hit, so
  `hardPity` itself is not a real state.
- Banner names/rate-ups come from `ram-prices/ef-assets/banners.json`
  (snapshot in `src/data/` for offline/tests, refreshed at runtime). Fix bad
  banner data there, not with special cases here.
- `fixtures/` is gitignored and holds the owner's real export. Never commit it.
