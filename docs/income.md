# Stats → By patch: free pull income

What `domain/income.ts` counts for each version, and where the numbers come from (read when touching income or Stats).

Stats → By patch adds each version's free pulls (`domain/income.ts`): its
events (plus events.json `extra`: the wiki's mid-version events, by start), daily missions and Weekly Routine for every day and week of the
version (resets at 04:00 server time), the Protocol Pass free track, the
maintenance compensation in its official Version Update Notes and the
permanent missions it released (main story by the notes' "available up to",
others by the wiki's version pages or their region), what its permanent
modes hand out anew (Echoes of War seasons, Monumental Etching, Delver of the
Cryptic...: its notes' Event & Gameplay Updates, else the wiki) and its new
outposts, the storage crates in the areas it added (each area's chests as
the game's tables list them; an area missing there: wiki crate count times an
average Oroberyl per crate, badged Estimate), the Origeometry its areas' Aurylene
unlocks (each region's TP Point table; Partial past the table's end on the
wiki), and hand-kept community-guide amounts with sources (version preview
livestream, version survey, Combat Drills), the Crafting
Manual's milestones, one-time progression at launch (Node milestones,
Authority Level), and our own rough estimate (an event or mode the wiki names
without amounts gets the median of its kind, marked ≈); one-time rewards by
the version that added them (`oneTime`: Operational Manual stage first
clears, Regional Development levels, Intel Gathering, mail events, launch
codes) and the Credit Store's daily stock on average (Estimate); the SKPORT
web check-in, Twitch drops and birthday mail are left out (owner's call). Each
Headhunting Dossier (60 paid pulls on a Chartered banner) is 10 pulls for the
next Chartered banner's patch; Basic Headhunting pulls' Arsenal Tickets and
Bond Quota count for the patch they were made in. Limited-time rewards that
ended before the player's first pull are left out (`since`: events, passes,
mail `until`, a version's compensation, survey, livestream, Combat Drills and
AIC permits once it's over); dailies and weeklies count from that pull. The
quota shops count too: the AIC Quota Exchange's banner HH Permits (official
notes, else 5 per Chartered/Special banner) and the Bond Quota the player's
duplicate 5★/6★ operators gave (25 per Chartered HH Permit). The breakdown
lists pull currencies only, credits only the wiki, and the table ends with a
total (patch banners only, to today). No
third-party spreadsheet is used: the owner wants our own estimate. From
ef-assets `wiki/income.json` (`scripts/income.mjs` there; then
`scripts/game-income.mjs` puts in the game's own amounts from the
EndfieldData dump: daily, weekly, pass tracks, missions, area chests,
Valley's Aberrants chests by zone), plus the Arsenal
Tickets Headhunting gives back; marked on the bars, listed by source when a
patch is opened. Headhunting counts limited pulls (Basic HH Permits are
listed apart, as community pull counts do). The current patch is projected
to the next version's release, or else its last banner or event end.
Toggles (setting `paidIncome`) add Originium Supply, Protocol Customized
