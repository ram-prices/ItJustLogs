# Built pages, share embeds and event pages

How `vite.config.ts` writes a page for every clean path, item, banner and event (read when touching routing, the build or Discord embeds).

Served from the domain root, so `base: '/'` (absolute asset paths). Clean
paths need files on Pages: the `pageCopies` plugin in `vite.config.ts` copies
`index.html` into `database/operators/`, `banner/headhunting/`, `settings/`...
and to `404.html` (the fallback for `/banner/headhunting/<poolId>`). Add new
pages to its `PAGES` list. It also writes `database/operators/<name>.html` and
`database/arsenals/<name>.html` (Pages serves them at the clean path; the
name is `itemSlugs` in `domain/wiki.ts`, the id when a name is shared) and
the same page at the old `operators/info/<chr id>.html` and
`arsenal/info/<wpn id>.html` for every
item in the ef-assets wiki data, each with that item's Discord component
embed (`<script id="discord:component-embed">`, max 3,000 bytes: header with
portrait, every skill fitted, wiki credit link) and Open Graph tags as its
fallback (Discord runs no script). Built by `domain/share.ts`, fitted to
Discord's limits (OG description 350 bytes, title 70 bytes), which also
builds the (now unused) "Copy to Discord" text. If
ef-assets can't be fetched it uses `src/data/wiki-share.snapshot.json`, which
local builds refresh. New operators get a preview only after a rebuild.
Every banner and event in ef-assets `schedule.json` gets one too:
`banners/<name>.html` and `event/<id>.html` (`scheduleLinks` in
`domain/schedule.ts`; a banner name used again later adds its opening date,
and an event's `id` is a stable number ef-assets assigns and never reuses, so
links never change target). The old `/events/<name>` links still work
(`legacyEventLinks`, redirected in app.ts and built in vite.config.ts, all
marked LEGACY); the owner plans to remove them. Their embed has the key art and both servers' dates as
Discord timestamps. In the app a banner's path opens Home at that card, row
or timeline bar (`focusScheduleItem`); an event's path opens its own page
(`ui/pages/event.ts`): dates, details, phases and its rewards from ef-assets
`wiki/events.json` (whose wiki end dates fill in events the notes leave
open, `withWikiEnds`, on the event page and Home; official changes the news
feed lacks, such as notices posted only on X, go in ef-assets
`schedule-overrides.json`, which `update-schedule.mjs` applies by event id
until the feed changes, marking the event's `source`) (`scripts/event-rewards.mjs` there; totals as
Headhunting pulls at 500 Oroberyl each, `domain/eventRewards.ts`; `partial`
when the wiki names rewards without amounts). Home's event rows and
timeline bars link to it, and Home's right-click menu has "Copy link".
and the Monthly Pass. All pages are kept; if their number ever becomes a problem, drop old
ones then.
