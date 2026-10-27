# Rotations: DPS sim and Parser

Everything about the team DPS sim, the gameplay-recording Parser and parsed runs (read before any work in `src/domain/sim/`, `rotationReader`, `pages/rotations.ts` and `pages/rotations/`).

- Files: `ui/pages/rotations.ts` is the page (`rotationsPage`, `simAction`, `simChange`, `parserFiles`); its parts
  are in `ui/pages/rotations/`: `state.ts` (every piece of page state in one `page` object, plus the settings
  helpers), `text.ts` (number and time formats), `track.ts` (a `Track`: a sim result or a recording on the fight's
  clock, its transcript steps, the Sim view's longer timeline), `fit.ts` (a recording fitted to the sim:
  `recordingCard`, action matching, the game's SP amounts), `buffs.ts` (buff names, icons, rows and chips),
  `player.ts` (the timeline player: boss bars, SP bar, playback, the loadout boxes' live numbers), `results.ts`
  (lanes, the results view, fold buttons, boss faces), `builds.ts` (builds from loadouts, member cards, loadout
  lines and their edit fields), `runs.ts` (saved runs: loading, the search and replay workers, export and import,
  History and Parsed runs), `parser.ts` (the Parser tab: the run's head, discrepancies, the transcript editor,
  `parseView`). Modules only import downwards (state, text, track, fit, buffs, player, results, builds, runs,
  parser, then the page), so none runs another's code while loading.
- Rotations tab (`/rotations` Parser, `/rotations/sim` Simulator; `ui/pages/rotations.ts`): a team DPS simulator
  that teaches button order. Four operators in team position order (position
  01 matters: e.g. Si's ultimate cuts its combo cooldown), each from their
  loadout and copies ("My loadouts") or with weapon and gear the sim picks
  (a loadout's weapon: `skillLevels` as at P0 from its tuning and essence, `weaponBuildOf` then `weaponBounds(w, 0, …)`,
  since `build.ts` adds the Potential; before 2026-10-27 loadout builds sent ranks with the Potential in them, so the
  own skill got it twice: Xaihi's P3 Chivalric Virtues counted at 7 instead of 4, Yvonne/Tangtang/Xaihi/Arcane on
  Alleikhreos Quick went 1:07.9 → 1:20.0; `tuning` and the stage's `level` ride along below 4)
  ("Optimal gear", `domain/sim/gearSearch.ts`: Maxed Essence, every stat at top Artifice,
  chosen by fights; weapons tried again on the second pass with the gear found; gear.json names a piece's slot
  "Body"/"Hand"/"EDC", `partOf`; a third start gives each operator their signature weapon, the Arsenal Issue that ran
  with their banner (`signatures`: special_<n> with weponbox_<n>), and the start whose rotation plays best is kept); styles Advanced (swaps, animation cancels) / Standard (the default, with search Moderate; one
  operator controlled, no cancels: `Rules`, World `swaps`/`cancels`; 0.5 s between presses) / Basic
  (one operator; combos as they come, ultimates when charged, battle skills in a fixed cycle:
  `searchCycle`, `Policy.cycle`); old saved names map by `styleOf`; goal a fight length, or a dummy HP to defeat fastest (within its own limit, 300 s unless set;
  `Team.hp`, `scoreOf` in rotation.ts). The picker lists the Endministrator once (two appearances, one
  operator) and greys out teammates. Every run is saved in IndexedDB (`sims`, last 100, `saveSim` in
  store.ts) under the request, so a team shows its last result at once (Run again redoes it);
  History lists every run of the same characters (any order or loadouts) to open again. Optimal gear
  gives each gacha-only weapon (an Arsenal Issue rate-up, `weponbox_` pools) to one operator at most. A
  collapsed "How it works" sits under the header.
  Searches run on several threads (setting `cores`, "Threads": all but one unless set): `ui/simWorker.ts`
  opens a pool of fight workers (`ui/simPool.ts`, `ui/simJudge.ts`, data via `ui/simData.ts`); search,
  beam and gear search hand batches to a `Runner` (rotation.ts; `localRunner` on one thread) and take
  results in order, so the rotation is the same on any number of threads. Beam ways cross threads as
  their presses (`WayRef`, replayed by `replayWay`); teams as their `TeamSpec`. Fights the training dummy with the game's own skill
  and buff logic: `domain/sim/engine.ts` interprets the EndfieldData skill and
  buff files (ef-assets `combat/`: `ops/<id>.json`, `weapons/`, `gear.json`,
  `settings.json`, `index.json`, made by its `scripts/combat-bundle.mjs`);
  `build.ts` equips (gear: gear.json's DEF row, then the game's three stats, each at its own Artifice level from
  `artifice: [s1, s2, s3]`; one number, as in requests, saved runs, parsed runs and loadouts from before per-stat
  Artifice and the ai-parser's files, is every stat at that level, which is what it meant, so no total moved:
  Skydrummer 3,569,029, Alleikhreos 4,434,405, Last Rite 4,076,698 before and after; `statArtifice`,
  `artificeLevels` in loadout.ts); `rotation.ts` searches (priority list, then a beam search
  over presses using `World.clone()`); `team.ts` is the page's side. Runs in
  `ui/simWorker.ts`. Damage formula from the endfield.wiki.gg Damage page
  (credit it). Checked against a community calculation for Arcane, Last Rite,
  Si and Xaihi only (`CHECKED`); others show "Not checked yet". Assumptions the
  data doesn't give are marked in the code (1 s swap cooldown, Si's combo
  stack count, swapping out of Liino's stance and cutting it with her
  ultimate; End Stance is never pressed; Liino's beats reach every teammate). Teammates the AI controls basic attack on an estimate of the game's guard AI (`guardAttacks`, on;
  `GUARD_SHARE` 0.4 of the time each, in staggered windows of 6 s, and only while the controlled operator is attacking or in a skill; 0.75 s before
  each chain): GroupAIConfig
  Default_GroupAITargetNotMain deals 5 s Attacker roles by mode (Radical/Moderate/Steady/SingleOne, weighed the same:
  the data doesn't say how a mode is picked), AIGlobalSetting the delays. Only the controlled operator's Final Strikes
  give SP and trigger combos. The data's share is ≈ 0.59 (`GUARD_DATA_SHARE`, a ceiling: they also move and dodge);
  0.4 is fitted to the owner's two recordings at the owner's request, by kill time (damage sums mislead: a phase's
  damage is capped at its HP, so Alleikhreos's phase 1 says nothing): at 0.4 the sim killed the Skydrummer at 2:27.4
  (the game 2:27.4) and Alleikhreos at 2:20.6 (2:21). That fit used the Skydrummer's HUD blackouts as stopwatch pauses
  (free sim time); read from its countdown (2:35, no pauses) and with inflictions expiring and Yvonne's bomb consuming
  Cryo (2026-10-24), no share in the data's range kills either in time (0.4: Skydrummer 79% by 2:35, Alleikhreos 92%;
  0.59: 83%, 95%; Alleikhreos needs ~0.8, the Skydrummer more than 1.0): the missing damage is elsewhere, so 0.4 stays
  until it's found. Checked
  for inflation (2026-10-24): their basic attacks add no Stagger (enforced in `deal`; the data flags only some Final
  Strike units main-only), give no SP, and their per-hit sizes match the recording's small numbers; the Stagger they
  add is their skills' the player pressed. `reduceDamageForGuard` is set only on Laevatain's battle-skill entity. A few
  skills have an `aiExclusiveFrame` (Arcane's attack5 80 vs 41; Liino, Si, Purrchena), not applied. The Attacker role
  needs the target inside the teammate's slot range (`TargetInsideMaxSlotRange`, offset 5) and the sim has no
  positions; the character AI itself is a Unity asset (the dump's `AIConfig` has only global and group settings). A mode's own basic attacks replace the chain while it's on
  (`chainOf`: <id>_<mode>_attack#, Typhoeus's hover "floating"); an attack with no next-attack window opens the next
  one when it ends itself, or by a ComboCacheAction for Attack. A skill an operator's current skill casts of its own
  (Character* spec) takes over (`Run.follow`: one skill at a time, so Typhoeus's AI hover fires 5 shots, not a
  runaway), and that operator's next basic attack cuts it. A Final Strike's Stagger counts once per strike however
  many projectiles carry it (`Run.origin`/`poised`: Gilberta's fires three, each with the full 16). EntityBB_ keys
  only projectile hits use are the launch's own (`projectileKeys`, `Run.projBB`): Tangtang's Final Strike gives SP
  on its first hit each time, not once ever. Database shows each operator's basic attack chain (hits, seconds per
  chain, Final Strike SP, SP per second) from `src/data/final-strikes.json`, made by the sim with
  `GEN=1 npx vitest run scripts/final-strikes.test.ts` (COMBAT_DIR for a local ef-assets combat/; rerun for new
  operators): a sortable table under the Operators list (`finalStrikeTable`) and rows in each page's Attributes. Ultimate Energy blocks (RefrainObtainUsp) last only
  while their buff or skill does and let their tags through (Last Rite's own skills, Arcane's array); a
  DoOnceAction runs once per cast. An AuraAction's buffs come from its source (`buffSource` ActionSource: an entity's
  spawner) or, with ActionOwner, from the entity running it: Xaihi's crystal heals twice, as its heal checks the crystal
  for finishball_04 (checked against the Skydrummer recording).
  The enemy is the training dummy (`DUMMY` in team.ts) unless a request sets `enemy`: `ALLEIKHREOS`
  (Crisis Calamity boss) is defined from EnemyAttributeTemplateTable and its wiki page (Resistance 20,
  Stagger 320 / 11 s, Finisher ×1.75 via `Enemy.finisherMul`), picked with Enemy (`ENEMIES`, setting `enemy`);
  Each boss entry carries its stage's rules (`Enemy.food`, `fullUltimate`, `prep`): Crisis Calamity (Alleikhreos) is
  the Re-Crisis kind, food allowed and every ultimate full at the start; every other fight forbids food (a buff placed
  on each operator before it; healing items used during a fight are another thing); Echoes of War waits for a start
  button (`prep`, not simulated); a stage starts at 200 SP of 300, regenerating 8 a second, unless its `Enemy.sp`
  says otherwise (Glaiver File: 700 of 700, 4 a second; the Recording view's SP bar then shows a segment per 100, and
  the Simulator's SP at the start field caps at the stage's max). Food pickers show only where allowed (`foodPicker`;
  `teamFromSpec` drops food elsewhere), and the parser's review asks for it before simulating (Before the fight:
  the stage and its rules, each operator's food → `VideoRotation.food`). The Parser outlines the box of whoever made
  the most Final Strikes and Finishers (controlled most) and "Controlled" at the end of its name row (no tab or fill: the boxes aren't selectable), others who
  made some fainter. A box's portrait and name link to the operator's Database page.
  `SKYDRUMMER` is Echoes of War's "Howling of Undying Beasts" boss (eny_0082_hsbear_race007: DEF 100, Resistance 50,
  Stagger 320 / 9 s, Finisher ×1.5 / 50 SP, no node, interrupt +20; one entry per difficulty, Brutal/Hard/Normal
  = Lv 90/75/60, each entry's HP as `phaseHp`, which the Parser's fit and bars need). Its HP is the
  template's × 3.6 at every difficulty: the stage's spawner gives it buff_dung_maxhp_01, ratio 2.6, at birth. Stage
  stat changes live in the spawner (dump `Json/SpawnerConfig/<scene>/sc_<scene>_<id>.json` `enemyLibrary`: level and
  `bornBuffList`), found from SubGameInstanceDataTable's `bindScriptId` → the level script's EncounterData `spawnerId`;
  the local dump has those as binary, the EndfieldData repo as text. `Enemy.guard` (a stance below HP shares: damage
  taken ×(1+x), DEF, no Stagger, `World.checkGuard`, a Guard stance mechanic) is implemented but no enemy uses it:
  the Skydrummer's skill06 stance proved short in the recording.
  Its replay breaks Stagger early (video 57.8 / 129.6, the game 62.1 / 132.95), and that stays (owner, 2026-10-26).
  Every hit gives its data Stagger, but around Tangtang's battle skill (video 3.5, 22, 49) the footage's meter gains
  3–5 less: likely Whirlpool ticks missing the big moving boss, which the sim can't place. Alleikhreos shows the
  full 10 per Whirlpool (5 ticks of 2, `targetTriggerInterval` 0.075 s kept at 2 frames).
  `BLIGHTSHADE` is Echoes of War's "Glaiver File: Yinglung" boss, YSTF Captain Blightshade (eny_0124_kltdcap_tower016,
  template eny_0124_kltdcap: DEF 100, Resistance 20 Physical / 35 Electric / 0 the rest, Stagger 320 + 20 / 9 s with a
  node at half, Finisher ×1.5 / 50 SP, interrupt +20; Brutal/Hard/Normal = Lv 90/75/60). Its spawners
  (sc_indie_tower001_43000030003/04/05) give it buff_common_maxhpup ratio 4.5 (HP × 5.5) and buff_common_maxpoiseadd 20.
  The stage's DungeonTable paramList: atb_max 700 (SP starts at and caps at 700) and get_atb_reduce -0.5 ("All SP
  recovery and regeneration -50%"): regeneration 4 a second and `Enemy.sp.gain` 0.5 on every other SP gain (Final
  Strikes, Finishers, battle-skill returns; `obtain`). A request saves its enemy, so a replay takes today's entry for
  it (`knownEnemy`: the same boss, its SP rules aside). The stage's level script adds no SP buff (other Echoes of War
  stages use buff_dung_atb_recoverspeed_no_icon); the −50% is applied by the game's code from paramList, so 4 a second
  is the data's figure. The Last Rite recording's quiet stretches read about 2.4–3.9 a second once combo holds are
  taken out (its bar read 620 at the start, the data and the owner say 700: a request's `startSp` overrides the
  stage's start). Its fake death (buff_eny_0124_kltdcap_fakedead: heals to full over ~4 s, refills the meter) isn't
  simulated. The Last Rite 31 s recording (bluejay, yG8o5fgjd0o) is Brutal (the owner): with the re-read's four
  Final Strikes and the owner's builds the sim reaches 2.06M of 4,539,959 (45%) by its 31 s clear (1.15M by 27 s,
  where the recording shows ~2.55M); the per-hit gap is below. The Parser names an open run's enemy from
  its request when it's one of ENEMIES (the boss bar has no difficulty). The owner's recording replays to 86% (3.47M of
  4.03M) once its transcript has a Final Strike the parser missed at 0:28.9 (the meter's +17) and Yvonne's and
  Tangtang's ultimates in the 5 s pause at 1:07. The parser now reads such pairs: a dot full for 0.2 s within the
  last second before a cut-in counts as used (`RECENT`/`HELD`; both dots emptied 0.35 s before the HUD hid),
  pinned by `rotationReader.ults.json`.
  A combo skill's banner slows the game for all but its caster (TimeDilationAction, layer Global, curve "ComboSkill",
  for its duration: Last Rite 0.6 s, Si 0.8, Xaihi 0.9, Tangtang 0.867, Yvonne 0.667; Arcane's 0.6 cut to 9 frames by
  a RESETto1). The curve isn't in the dump; the recordings show SP regeneration and the Staggered meter at about a
  sixth of their rate (`COMBO_SLOW`), so both stand still for the time lost (`World.slowLeft`: 15 frames for Last
  Rite's). The team acts on: freezing everyone instead (tried) made Arcane's Final Strike after Last Rite's combo at
  0:23.5 of the Last Rite run 0.5 s late, past the next cut-in, where the recording's kept its time.
  A step before the stopwatch's 0 (negative `t`: Last Rite's battle skill cast as the stage starts, so Arcane begins
  with Hypothermic Perfusion) is pressed at 0:00 but kept at its own time (the Press's frame), so both views draw it left
  of 0:00 and the transcript reads it as −0:01.7 (`clockTime`); it's paid from the stage's SP (Glaiver File: 700 − 100 + its halved return, the
  ~615 the recording's bar reads at the timer's start); its buffs run from 0:00, so they end that much later than the
  game's. A loadout's weapon Potential (`weapon.potential`, the Parser loadout's Weapon picker) adds the weapon's
  potentialLevels to its skills' levels (Khravengger P2: its third skill at level 6 of 9).
  A transcript step `swap` (Swap in) takes control of an operator where the recording shows it, for one who then makes
  no Final Strike (`ReplayStep`, the editor's Swap in; the controlled operator otherwise follows the strikes). The
  Last Rite run has them from the team bar's ring (stopwatch 8.89 Last Rite, 13.29 Arcane, 28.99 Si;
  `tools/ai-parser/out/lastrite2/vA`). A skill that jumps past its MarkCanInterrupt no longer holds its operator
  (`jumpTo`): Last Rite's battle skill cast off-field jumps from frame 0 to 300, past its mark at 51, and the recording
  swaps to her 0.75 s in (her exclusiveFrame 373 had held her for the whole 4.3 s path). The replay's chain timing
  holds an operator for a press as `busy` does (`holdOf`: to the skill's MarkCanInterrupt where it has one, else its
  exclusiveFrame): her 373 frames had started Last Rite's own 13.09 Final Strike 12 s early, which made Arcane's 8.19
  one land at 6.1, before the Perfusion.
  The Mirage (Last Rite's battle skill, Hypothermic Perfusion) follows its data: the battle skill halves atk_scale
  (3.2 at rank 12) at frame 0, and the phantom buff's two Cryo hits each take the half (the wiki's 320% in all); both
  are one coalesced number on screen (damageVisualCoalitionGroupKey 0026_normal). Every teammate gets the Perfusion
  buff (normal_skill_self on the team), but only the controlled operator's fires, once per 0.1 s marker: one Mirage a
  strike. Her ultimate's 400/400/800% and combo multipliers match the wiki. In the Last Rite run her basic attacks
  match the screen (29,739 against the sim's 33,522) but the Mirages are 3-6× short (199K/327K/643K against
  35K/74K/115K pairs) and the ultimate ~2× (~270K/411K/662K against 149K/149K/298K), with the same growth over the run.
  Not found in the data (2026-10-25): the stage (featureDesc: SP rules, "Enemies have better stats", its HP), DEF 100
  and Cryo Resistance 0, Khravengger (Skill DMG and Cryo DMG, additive), Tide Fall (skill +20%, battle +35% stacking,
  additive), Xaihi (Amp, +10% Cryo DMG taken), Arcane (Susceptibility). Si's Inksoul is a real gap (all damage to it
  is dealt to its host too; CheckDamageTransferredSource is false here) but it lives only 3-6 s and from 29 s in this
  run, not at the Mirages. Left open.
  Corrosion in that run (Arcane as Array Arcana: WILL, the owner's call): the data gives three Cryo stacks before her
  battle skill's Nature (Si's battle skill, Arcane's WILL combo, Si's Brushwork), and Arcane's grid applies Nature on
  its entity's frame 20 (0.67 s after the press), Si's Brushwork 15 frames after hers: Corrosion III, as the second
  recording shows. It needs Si's Final Stroke read at 4.24 s, not 4.39 (her Brushwork comes on the Final Stroke's frame
  9 window); at 4.39 her Cryo lands 0.03 s after Arcane's Nature and the reaction is level II. The first recording's
  fourth stack has no source in the data: Artful Intent's extra infliction (buff_chr_0036_jsspsi_xianjing_inkhurteffect_1)
  is switched off there (its SwitchAction isEnable false), and her text says the Inksoul and its host take one instance.
  The Mirage on Last Rite's own Final Strike is phantom_main (both hits on its frame 21), on a teammate's the phantom
  (frame 9): her Perfusion checks the striker for her own tag (CheckTagMatch 264623624), which an operator carries as
  herself (`World.ownTags`: the tag her own skills' Ultimate Energy carries that her passive's RefrainObtainUsp lets
  through). Every Mirage adds normal_skill_tag, which finishes the Perfusion on the whole team: one Mirage a cast, on
  the first Final Strike by whoever is controlled. In the Last Rite run that makes the reading's 13.09 strike (hers,
  after the 11.04 cast) take the Perfusion the game spends on Arcane's 18.44 strike; without it the sim's Mirages fall
  on the game's three strikes (8.2, 18.43, 25.57), so 13.09 likely isn't a Final Strike.
  The Mirage's Cryo Infliction on a boss already holding Cryo sets off a Cryo Arts Burst (buff_common_cryst_cryst_triggered:
  1.6 × ATK × the level/Arts Intensity multiplier, mask 8388608, no skill bonus), which the sim fires (Last Rite run,
  13.57 s: 36,672). An Arts Reaction consumes every stack (the game's text: "applying Nature Infliction consumes all
  Arts Infliction ... triggers Corrosion"), so the boss holds no Cryo at the sim's first and third Mirages (Corrosion at
  5.17, Last Rite's combo at 23.54) and no Burst follows; the recording shows one after each. The team's data has no
  Burst-only or Arts Intensity buff (only the Spellburst set's, not worn), so the Burst's growth over that fight
  (1.9× to 7.3× the Mirage) isn't in the data either.
  Last Rite's combo consumes the Cryo stacks on its frame 63 (2.1 s after the press): a 1.6 slash and a hit of atk_scale3
  2.4 × the stacks (9.6 at four), then FinishBuffByTag on the Cryo. Her ultimate's cut-in starts on its frame 0, so
  it doesn't cut the combo short when pressed later. In the Last Rite run the combo pressed at 0:28.3 lands those
  hits at 0:30.40: the recording's 89,079 at 30.417 and 649,793 at 30.467 are they (sim 67,466 and 404,794), not a
  Mirage and its Burst; the Mirage from Arcane's 30.45 strike lands after the cut-in on no Cryo.
  A replay makes due presses in order per operator: one that can't be made yet (a combo on cooldown) holds up only its
  own operator's later presses, up to REPLAY_SLACK, not a teammate's (`waiting` in replaySim; Arcane's second combo
  waiting had held Last Rite's combo and lost her ultimate).
  An ultimate's cut-in stops the caster's own summons with everything else, but other operators' summons run on
  through it (`summonOfOther`), as the owner's Last Rite recording shows: Si's Ink Lung cuts Team Position 01's combo
  cooldown by her talent's 20 s on its frame 62 (SetSkillCdAtOnce); frozen through her own cut-in (video 23.93–25.85),
  it counts on through Arcane's (26.6–28.25) and the cut lands at ~27.9, after Arcane's combo at 26.10, which is back
  at 28.37. The data's UltimateTimeAction ignoreTargets (Si's `dazhao`, Zhuang Fangyi's models) would have kept the Ink
  Lung running through Si's own cut-in (cut at ~26.0, before that combo); the footage says otherwise, so it isn't used:
  the Ink Lung's hits (frames 63–100, right after the cut) show as one climbing Cryo number at video 28.4–29.1 (…36,410,
  46,015), not at 26.0–26.6, where only a fixed 136,267 shows.
  What a cut-in stops, from the recordings: SP regeneration (Skydrummer: +3 over 3.4–5 s cut-ins), Staggered time and
  Corrosion (Skydrummer), the caster's own summons (Si's Ink Lung); what runs on: the stopwatch, cooldowns (Last Rite's
  8 s combo at video 19.45 and 28.47 s with three cut-ins between), the caster's own casts, other operators' summons.
  Also held, from the Last Rite recording: Arcane's own Imprisonment and Tactical Doubles through her own cut-in (her
  second Imprisonment, combo at video 26.10, still on the boss at the 35.1 clear with no explosion, where running
  through would end it ~33.75), and, at low confidence, teammates' buff timers (Perfusion's outline lost ~0.9 s over
  Si's 1.9 s cut-in). Tangtang's Whirlpools through her own cut-in: not settled (the footage can't follow them).
  The current Last Rite run (tools/ai-parser/out/lastrite.parsed-run.json) replays with nothing missed: 4,076,698 by
  31 s, clear 32.0 s.
  A search's ExcludeOwnerValidator leaves out the ability's owner: Eternal Xiranite's +16% goes to the other
  teammates only, never its wearer (Xaihi in the Last Rite run, Arcane in the owner's).
  Si's Artful Intent burst is Fixed damage equal to 13% of the real damage the marked enemy took from the team
  (inkhurteffect OnTakeDamage: SaveDamageContext RealValue × ink_damage_rate; the burst's DefiniteValueCalculation, no
  processors): no ATK, bonus, Amp, Susceptibility, resistance or DEF on it. It's short wherever the hits it records are.
  The enemy's Staggered time stands still while the stopwatch does and the sim isn't frozen itself
  (`World.holdStagger`, from replaySim): the game's Stagger lasted 9 s of stopwatch with that 5 s pause inside.
  Arcane's Cluster Strike lasers deal 0.45 each in the sim (four per strike, 1.8); the wiki's "Cluster Strike Total
  DMG Multiplier 360%" may be both strikes together, so it's left as is. A replay takes a pause as a phase change
  only where the recording's bar was full again after it (`phaseChanges` in `pages/rotations/track.ts` → `ReplayClock.phases`);
  without bars, any pause of 2 s or more. A stage's own rules (DungeonTable `featureDesc`/`paramList`, the enemy variant's template and
  skills) go in the entry, not the base enemy's: the dump's raw Json/SkillData and BuffData are binary, read them
  from the EndfieldData repo (text). The
  timeline has an Enemy lane with its Staggered stretches (`World.staggers`); a parsed run always has it, its boss's face
  as its name, in both views, even with nothing on it (a recording with no Stagger or mechanic). Cooldowns run through ultimate cut-ins
  (`clockNow`: the game timer does; a video shows a combo back on cooldown across two). Rotations has side tabs:
  Parser (`/rotations`, also `/rotations/parser`; opens on the newest parsed run) and Simulator (`/rotations/sim`); the old `/rotations/transcript` redirects): a read video's team, enemy
  (`enemySeen`) and presses, food (setting `videoFood`); its history (Parsed runs) lists recordings only and comes
  first, with Parse gameplay and Import run at its bottom; an opened run shows below it on the page, not in
  a card (its name as a header, date and length under it, its buttons at the right; then Damage per second, Total
  damage, Duration, Actions, Controlled and Not attributed as laid-out figures; then the loadouts' boxes, from the
  run's own reading, each with its operator's share (the percentage by the name, a bar under the breakdown's Total) and its damage
  by source with a Total pinned to the box's bottom; a loadout's weapon is a line like its gear's (`weaponLine`: its
  picture, its name in the text's colour, at the right "Tuning n" below 4, its level when not 90 and the essence icon: green when maxed,
  dim with the skill ranks before it otherwise, none with no essence; its picture centred on the gear marks' column,
  its name a link to its Database page), every gear line's own Artifice node at the right edge (empty, half, full),
  the line a `<details>` that opens to its three stats with their marks and "+base » +artificed" (`gearLine`, its open
  state kept through redraws and Edit by `data-gear-key`); the
  operator's level and skill ranks when not maxed at the box's top right (`levelsLine`); the timeline (`lanes` in results.ts) is
  one area that scrolls sideways (`.sim-tl-scroll`), every row on one clock from `page.tlStart` (a whole second at
  least half a second before a press cast before the stopwatch's 0, `startOf`; else 0) to the player's end: the
  scrubber (its first row, the thumb's centre edge to edge over the track), the lanes, damage, the enemy's lane, the
  axis and one playhead line (`--p`). Its width is the fight's seconds × at least 24 px a second on a phone (CSS
  `--tl-pps`; wider screens fit the card) × the zoom (−/+ by play and speed, `TL_ZOOMS`, this viewer's in
  localStorage `ijl.timelineZoom`); the names column is sticky (portraits, 56px). Markers that would overlap go to a
  second tier, and that lane is taller for good (`tiers`), so nothing moves while scrubbing; playback scrolls to
  keep the playhead in view (`showPlayhead`). The boss's HP/Stagger and SP bars show the playhead's values, not a
  time axis, so they stay under it, their track as wide as the visible one; each box's bar shows every teammate's share in team
  order with a gap between, each in its portrait's hue (the hero tint, `data-hero-tint`; CSS relative colour): the box's own operator vivid, the others greyed and dark. Each action's damage (ReplayResult `actionDamage`, `damageByAction` in team.ts: a
  press gets its operator's hits of that kind until their next such press, a Final Strike their basic attacks up to
  it; an ultimate form's attacks, its closing one too, are its Ultimate's (`sourceOf`: _ult_attack, _attack#_ult),
  and each form's stretch (`World.forms`, while `attacksUnseen`: from after its cut-in to its closing attack; Yvonne's
  ends at 12 s or when its shots run out) is a band in its lane with its length in the transcript (`formOf`,
  `.sim-form`), the Recording view's moved with its press; scaled per second as `fitToRecording` scales, its `scaleAt`) shows at the right of the transcript and on the
  timeline markers' hover, the recording's actions matched to the sim's (same operator and kind, nearest within
  3 s); runs replayed before it show none until replayed again. The boss bars: a Staggered meter drains from full
  to empty over its stretch, Stagger nodes (`Enemy.nodes`) are marked with the game's node sprite (ef-assets `icons/stagger/poise-node.png`, deco_poise_knot_boss from its
  UI bundle, a mask in the text's colour), and a boss with phases shows
  which one under the row's name; the sim's bars refill only at `phaseChanges`. The player keeps the run's fit
  (`fitted`): handing it a new object each redraw had stopped Play; `resultsView` `noMetrics` drops Damage by operator and Where the
  damage comes from there). The timeline's transcript (`.sim-moves`) is one move a line, each time a button
  (`sim-seek`) that moves the playhead there, the move at the playhead marked; Recording-sim discrepancies show only
  under the Sim view,
  then its results; clicking it again closes it. No Play again. A parsed run's boxes show its own saved builds and food (its request); "Play edited transcript"
  replays that request, and changing a run's food (`runfood`) replays it with the new food. Timeline playback is 4×
  unless picked. While it plays, the transcript keeps the current move in view (its own list, instantly: smooth scrolling
  didn't move it), and once played or sought the loadout boxes show the damage so far (`paintLive`, from the card's
  `live`: each `<operator>|<source>` per second, scaled by the fit), the whole fight again at 0:00. SP: an SP bar row
  under the boss's (three segments of 100, the amount beside it), the video's in Recording (`Reading.sp`, every
  0.25 s; new parses only) and the sim's in Sim (`ReplayResult.spTrack`), and each transcript line's SP change (the
  step's `sp`: a battle skill's drop as the bar shows it, less what comes straight back; a Final Strike's gain; the
  sim's `actionSp`) with the bar just after it (`spAfter`; `actionSp.pressesAfter`/`strikesAfter`), also on the markers' hover. While a run is open, Parsed runs folds to its title row
  (count, Parse, Import; `runsShown`), its chevron toggle bringing the list back. History
  rows and an open parsed run can be starred (kept on top and never trimmed), named, noted and deleted
  (`runTools`/`runEdit`; `updateSim`, `deleteSim` in store.ts). Controlled (setting `controlled`, request `main`, Team
  `main`): the operator controlled the whole fight, no swaps; "Auto (Best)" lets the search try each (Advanced
  may still swap), and results show who (metric Controlled). Portraits link to the operator's page. The transcript editor's
  Controlled gives every Final Strike and Finisher to one operator. Each parsed run keeps its reading (`SavedSim.video`) so
  its transcript can be edited (presses' time, operator, press; added or removed) and played again into the same run
  (`transcriptEditor`, `runReplay` `into`); runs saved before that use the last reading if it's the same team and length. `replaySim` runs to the video stopwatch's stop, attacks nothing in its pauses and shows its time (`ReplayClock`); after a pause (a phase change) SP is refilled to 200, as the owner's video shows; it basic-attacks only while
  the sim has fewer Final Strikes than the video by then, and always for what the SP bar can't show
  (`World.attacksUnseen`: a Finisher on the Staggered enemy, an ultimate form's attacks such as Yvonne's, which give no
  SP, and an attack a buff has waiting, such as her ultimate's closing ult_attack_end), those not counted against the
  video. A Finisher holds its operator until its next-skill window (`busy`), so a skill pressed right after it doesn't
  cut its main hit off. A reading whose stopwatch digits weren't read takes a HUD-hidden stretch
  of 3 s or more (`PHASE`, rotationReader.ts) as the phase change's pause. In a replay a chain the player paused
  (dodging, moving) goes on for 2 s past its window (`World.chainGrace`; skills never break one: every operator has
  CharacterTable dontInterruptCombo), and its Final Strikes are matched to the video's in fight frames, so a cut-in
  between them doesn't count. The stopwatch's end without a read final value is its last tick that follows another
  changing one (a lone change is the HUD fading out). Enemies can have mechanics (`Enemy.nodeStagger`/`nodeMechanic`:
  Alleikhreos's Foundite Weapon, 20 Stagger when his meter passes its node, from his interrupt buff), drawn in the
  Enemy lane (`World.mechanics`). Times show as m:ss.s (`clockTime`). Full backups (Settings) also carry every saved result (`Backup.sims`). A parsed run can be exported as a file and
  imported elsewhere (Export, Import run: `RUN_FILE`); on the Parser a pasted or dropped recording is parsed and
  an exported run opened (`parserFiles`; other JSON goes to the pull import). The transcript editor also takes Dive attack (`dive`: the
  controlled operator's `_plunging_attack_end`; the parser can't see one) and Invulnerable stretches
  (`VideoRotation.away` → `World.away`: the team's hits do nothing then, hatched in the Enemy lane; Alleikhreos's
  phantoms). A dive ends Tangtang's ultimate early with its bigger wave only while her stare runs: her aura hears it
  as OnBeforeDamageAction and the stare's EventListenerAction (`runListeners`, alive while its run is) jumps ahead;
  a late dive is a plain dive. Summons hitting together Stagger once (`summonPoise`: Arcane's four Tactical Doubles'
  explosion is 5, the wiki's and the owner's count; each still deals its 120%). Arcane's ultimate ends only its own
  entities (`SUMMON_TAGS` 464088014), so a combo's doubles still explode after it.
  Checked against the owner's Alleikhreos video by tracing its boss bar (HP and the Stagger meter under it, which
  turns yellow while Staggered): no Finisher in an ultimate form or with its closing attack waiting; another attack
  a buff has waiting comes after the Finisher (Skydrummer video: Yvonne's bomb 131.6, Finisher 137.3, her talent's
  Final Strike 139.0). A replay makes a Finisher only where the video shows one (`World.finishers` false otherwise,
  so a due attack on a Staggered enemy the video leaves alone stays an attack; the parser can't see one cut off by a
  phase change, so it's added by hand), pressed as long before the video's as it takes to land (`finisherFrames`,
  measured at the first Stagger: Yvonne's 23 frames); a video Final Strike's chain starts earlier by the operator's own battle and combo
  skills' exclusiveFrame in between (`holdOf`); strikes from unseen attacks are marked (`Strike.unseen`) so they
  aren't counted against the video; critical-hit events are counted per skill kind (`critSum`), so battle and combo
  skills crit at their own rate (Artzy Tyrannical). Alleikhreos: no Stagger at his node; the Foundite Weapon about
  6 s after it and no Stagger from 2.5 s after it for 6 s (`nodeGuard`); a phase's damage past its HP is lost
  (`phaseHp`; the bar's white part is the damage effect, not HP); a phase change empties his meter (`newPhase`).
  Interrupts: Alleikhreos's sword and lance attacks open a weakness window (SetWeaknessAction); a hit then
  interrupts him for +20 Stagger (`Enemy.interrupt`, his interrupt buff's poise_value; the big X on screen). The sim
  doesn't play his attacks, so a recording says which presses did it: a step's `interrupt` (the transcript editor's
  Interrupt box; `World.interrupt`: the operator's next hit of that skill kind within 3 s). The parser reads his
  Stagger meter under the HP bar (`Layout.stagger`, `staggerOf`: filled share, yellow while Staggered) and marks a
  battle skill or combo near a rise of 16+ that no Final Strike explains (`interrupts`), pinned by
  `rotationReader.stagger.json` (real crops and the traced meter).
  A video Final Strike's chain also starts earlier by any ultimate cut-in over it (`cutInOf`: the video's clock runs
  through it, the sim's frames don't), and later by what Haste saves it (`chainFrames` at the operator's Haste now,
  at most its rate × the frames it has left, `World.hasteLeft`: Tangtang's combo buff takes Yvonne's chain from 95
  frames to 80; measured without it, her strikes landed 0.5 s before the video's); with an attack a buff has waiting that the video shows (`strikeWaiting`:
  Yvonne's talent after her bomb makes her next basic attack the Final Strike) it's pressed just before the video's
  strike (`QUICK_STRIKE`). Only an ultimate's own waiting attack is unseen. CheckSkillCastId compares the kind of
  skill whose cast gives a buff (`Buff.castKind`, `creating`) with the listener's, and OnBeforeOutputBuff carries a
  stand-in for a new buff: her talent takes her bomb's Solidification, not her combo's.
  The parser also measures the stretches the boss took no Stagger after its meter's node (`guards`: from its meter's
  last rise within 6 s of reaching half to its next, 4 s on with a press in between; `Reading.guards`,
  `VideoRotation.guard` → `World.noStagger`, which replaces Enemy.nodeGuard's estimate in a replay). On the controller
  HUD a combo banner cut short by the next (a dip with no banner between two different arts, before it settled) is its
  own combo, and a stretch starts from its first readable art across a dip of up to two frames (Tangtang's combo
  before Arcane's at 0:07 and 0:57); banners cut short are grouped only with each other (their slide-in looks like
  the next one coming in), so the review can show one operator twice.
  Against the video: the parser keeps the boss's bars (`Layout.bossHp`, `bossHpOf`: red only, the white part is the
  damage effect; `Reading.boss` every 0.25 s, read every third frame so it costs few frames), a replay keeps its own
  (`ReplayResult.track`: damage so far, `World.meterNow`), and the run shows where they first part
  (`compareWithVideo` in domain/sim/videoCheck.ts: damage 10% apart for 3 s, Stagger 12 apart for 2 s, Staggered in
  only one for 1.5 s; the meter's step hints what's missing: 20 an interrupt, 17 a Final Strike, 10 a skill). The
  reader plays recordings in real time (`SPEED` 1), backing up and halving speed (to 0.25) when frames go unseen
  for 0.05 s, back up to speed after 5 s without: short things (a banner cut short, a Final Strike's step) need
  every frame. A Whirlpool-style JumpToAction over a span is watched each frame (`jumpWatch`); Tangtang's Whirlpool
  tag counts her combo's and her ultimate's entity (assumed from the owner's video).
  The report is titled Recording-sim discrepancies; each can be dismissed (`SavedSim.dismissed`, `kind@seconds`;
  Show dismissed brings them back). The timeline plays (`player`/`runPlay`: a playhead, a scrubber, 1/2/4×) with the
  boss's bars under it: the sim's from `SimResult.track` (every result keeps one: damage so far and, in a replay, the
  meter; a search's only knows when it was Staggered), each phase starting full, and a parsed run's video bars beside.
  A basic attack's next-attack window is the AllowNextSkillAction whose allowedSkillIdList names the attack that
  follows (others open at once for a talent's Final Strike or an ultimate's closing attack), and the attack that
  follows is the ComboCacheAction's mapping first (`nextAttack`: Yvonne's ult_attack3_2 maps to itself and repeats,
  eight shots every 16 frames; her ultimate's three spawned entities are decoration, their skill empty).
  A battle skill's SP gained (`Step.back`, the parser's `spBack` amount less regeneration, shown and edited as the game's
  amount: `spGained` snaps a reading's 19 to 20; the editor's SP gained box) says
  how many of the operator's summons it reached (`SP_BACK_REACH` in team.ts: Tangtang 20 SP a Whirlpool;
  `World.reachOnly` caps the newest n her next skill finds), since the sim has no positions and the boss walks away
  from Whirlpools (the owner's video: 1 at 0:26, 0:36, 1:12, 1:46, 2:00; none at 0:03, 0:56, 1:25, 2:14). A
  battle skill's caster is often the parser's guess: Xaihi's crystal at 1:25 and Yvonne's bomb at 2:14 in that video
  were first taken for Tangtang's (the 266,083 Solidified crit at 2:10 is that bomb).
  An Invulnerable enemy takes no HP damage and no Stagger, but hits still land (`deal` amount 0): statuses apply and
  critical hits count, as in the video (her bomb into the phantoms Solidified him). The sim averages critical hits,
  so a recording's big rolls (the Finisher that ends phase 1, the 266k bomb) are luck it can't follow.
  A parsed run's Timeline card has a Recording | Sim switch (`view`, default Recording: what happened; the sim
  tells who dealt how much). Recording (`recordingTrack`) is 1:1 with the video: the presses, Final Strikes and
  interrupts as read (plus the sim's Final Strikes the SP bar can't show, an ultimate form's, where none of the
  reading's matches: `withUnseen`), the boss's node mechanic (Foundite Weapon) at each no-Stagger stretch's start, Staggered where the meter went yellow, the Stagger node where it passed half, Invulnerable
  and no-Stagger stretches, a Damage lane with each second's damage from the HP bar (crits and all) and the
  video's bars; Sim (`simTrack`) is the same actions as the sim made them, its expected damage and its bars. One
  play control, one damage scale; the action list follows the view.
  The Parser's numbers are the recording's: `fitToRecording` (videoCheck.ts) takes each second's damage from the
  boss's HP bar and splits it among that second's hits as the sim split them, before the phase cap, so a hit after the
  sim's phase ran out still claims its share (`ReplayResult.perSecond`; a 2 s bin 25% or more over the sim's expectation
  gives up to half its biggest single hit's expected size to that hit, a crit (the rest shared out as usual): `actionDamage.top`,
  `fit.extras`; a Finisher's hit counts for its Finisher however late it lands (its projectile, landing before the
  strike is recorded, for the Finisher just after it); each sim action's hits are first moved by its offset to the
  recording's same action (`alignActions`, `ActionShift`; actionDamage pairs carry their source, so runs replayed before
  that stay put): the Skydrummer's Stagger came 1.1 s late in the sim, which put its Finisher in the next bin,
  operator|source), so a crit shows at its real size and totals match the video; damage in a second the sim made no
  hit in is a "Not attributed" row (an action the transcript lacks), unless the sim hits nothing more until the fight's end or
  the next phase: then its boss died sooner (`afterKill`, not counted there). The summary always compares the two clear
  times: "VS Sim" under Recording, "VS Run" under Sim, as "13.2 s slower" (`versus`). The discrepancies list still compares the raw
  sim track with the video, which is how transcript mistakes are found; the Simulator tab stays expected-value.
  Under the Sim view the summary's Duration is the sim's clear time (`ReplayResult.clear`, `clearOn` in team.ts): the
  hit that empties the last phase's HP, or, short of that by the recording's end, a copy of the fight going on the
  Basic way (combos and ultimates as they come, battle skills in team order) until it does; no time limit. That fight is kept
  (`ReplayResult.runOn`: presses, Final Strikes, Staggers, track, SP), and the Sim view's timeline plays on through it to
  the sim's clear (`simLong`, `withRunOn`; the player keeps its place switching views, `baseOf`, and the run's
  phases and nodes, `preparePlay` taking the base result; the engine marks each Stagger node it reaches), with the sim's own
  bars. Its actions carry their damage and SP in the transcript and on the markers (`runOn.pressDmg`/`strikeDmg`, split
  by `damageByAction` over its own hits, the sim's values with no recording to fit; `pressSp`/`strikeSp` and the bar
  after, measured as in the replay), after the recording's fitted ones. Hits after the recording's end from actions
  pressed before it stay unattributed, as Bursts and reactions are. Runs replayed before this show none until replayed.
  The HUD leaving as the stopwatch stops is the kill, and a phase ending in a pause (the bar full again after it)
  reached zero in the cut-in: the parser adds a zero-HP reading at each (`endsAtZero`; the kill at the stop, however early the bar stopped being read), and every saved recording gets the same when shown (`killed` in videoOf), its last readings clamped to the timeline's end.
  The boss's name is read on eight frames with the band's own ink threshold and scraps voted down (`whiteInk`,
  `enemyName`): the Skydrummer's bright sky spoiled single reads.
  Stages put their timer in different places: the controller layout's own (top left, yellow, counting up: Crisis
  Calamity) and `clockAlt` (Echoes of War: white, counting down from 10:00, centred under the boss's bar). Each place
  is cut every frame; `readWords` keeps the one whose pictures read as times most often. Both timers run through
  ultimate cut-ins (the Skydrummer's read a second a second across them), so only a phase change is a pause; reading
  no digits falls back on HUD blackouts of 3 s or more (`PHASE`), which take double-ultimate cut-ins for pauses.
  The HP series is the lowest reading so far, so readings while the bar fills in (the fight's start, after a refill)
  are skipped while one in the next `SETTLE_HP` seconds is higher: one such frame once held the Skydrummer at 35%.
  Buffs (a replay's `ReplayResult.buffs`, `BuffSpan`: every 8 frames with the bars): the buffs the game shows an icon
  for (`buffShown`: the data's `hasIcon`), the enemy's elemental inflictions and the Susceptibility, Amp and Haste
  effects (`effectsShown`), as rows under each operator's lane and the Enemy lane (Buffs folds them, `fold.buffs`).
  Names: statuses and effects in the game's terms (the dump's HyperlinkTextTable ba.* names: Vulnerable, Cryo
  Infliction, Cryo Susceptibility; `INFLICTION_NAME`, `EFFECT_KIND`); the dump has none for operators' own buffs
  (BuffTable is empty in this build), so those are their ids in words with the operator's or weapon's name, and a
  gear set's buff by the set whose piece ids start as it does (`buffName`). The boss and SP rows draw their playhead
  values in their first markup (`barsNow`, `spNow`): playback's end redraws the page, which had flashed full HP.
  Each buff's game icon: ef-assets icons/buffs/index.json (buff id → sprite, BuffData `iconConfig._spritePath`, buffs
  with `hasIcon`; `loadBuffIcons`), Susceptibility/Amp/Haste as icon_battle_affix_<kind>_vulnerable|enhance|speedup,
  inflictions as their element's orb; the images are ef-assets icons/buffs/<sprite>.webp on jsDelivr (its
  scripts/buff-icons.py exports them from the dump's ui/sprites/bufficon bundle; a letter shows until they load).
  Under a parsed run's timeline, "Buffs at <time>" (`buffsPanel`) has a fixed row per operator and the boss: its
  face, its chips on one line that scrolls sideways, how many; a tapped chip's name and stacks show under it (a hover
  by its title). The chips are as the game draws them, the icon in a square whose outline is the timer, stacks as a number and an Arts
  Reaction's level (its buff's `count`, `BuffSpan.level`) as a Roman numeral in a corner box, an Arts Infliction as the
  game draws it (its icon in a circle of four arcs, one lit per stack) with a thin timer ring inside, to the left of the
  boss's bars rather than in the boss's row (`data-buffs-kind`) (`paintBuffs`, `--left`); timeline buff rows start
  folded (`fold.buffs`), and with them the names column widens (`.sim-buff-names`). As the game: no chip for a buff the icon index has no sprite for (Si's
  soul_timedisplay_jsspsiself: `hasIcon` with an empty sprite); one chip per Amp or Susceptibility source
  (`effectsShown` ids `amp_<kind>@<operator>`: Xaihi's and Si's ultimates each give a Cryo Amp); a buff the game draws
  only on the controlled operator's row (iconConfig.onlyShowForMainCharacter, ef-assets icons/buffs/main-only.json from
  buff-icons.py; Last Rite's Perfusion, which the whole team holds) only on that lane (`playBars.controlled`). The
  run's header holds the timeline's Recording | Sim switch, then Edit, Export, Star and Delete as labelled buttons
  (`headTools`; a starred run can't be deleted); play, speed, zoom and the Buffs eye sit over the timeline, the time in a tip over the scrubber's dot; dragging it moves the playhead as it goes (an `input` listener). The recording's Stagger meter never falls between resets
  (a Stagger, a phase change: each reading is the lowest read after it in its stretch, so a hit's flash misread as fill
  drops out). The boss's bars hold each reading
  (`barAt`) and, while playing, slide to the next over 180 ms (`barSlide`; a Staggered meter's drain is drawn as
  it is, the slide set to it each frame, or it lagged and jumped up when the Stagger ended); between readings the SP bar regenerates at 8 a second (`spNow`, `SP_REGEN`; the video's bar animates its drains and fills over a few readings,
  folded into one jump by `spSeries`); costs and
  gains stay jumps. Edit turns the title and note into fields in place. No "Controlled" label (the box's outline says
  it) and no label by the boss's bars (the switch says which). The boss's face leads the run's title (its picture zoomed on the face, ENEMIES `face`, `foeFace`; the Enemy lane's too); the note is its own box at the right end of the figures (a field there
  while edited); the Enemy lane is named by that face (`laneFoe`). Enemy pictures are ef-assets icons/enemies/<template id>.webp (its scripts/enemy-icons.py, from the
  dump's monstericonbig bundle), named by `ENEMIES[].icon`. An infliction by the boss's bars is 30px, centred on both bars, its icon on a
  round face scaled to fill it. The summary's DPS and total are the recording's, or
  under Sim the sim's own.
  Layout: Parsed runs are in the side column under Simulator/Parser (`runsAside`, `sideTabs`' `aside`); a read's review
  is a section of the Parser page, not a dialog (`reviewPage` in ui/rotationReader.ts), saved first as a draft
  (store.ts `readerDraft`; "Not simulated yet" in the list; Discard drops it); one Edit (the edit view kept as literally like the normal one as it can be: the owner's rule) opens a run's name, note, duration (the Duration figure, m:ss.s or seconds), who's controlled (click an operator's box: the outline moves, `sim-main`),
  loadouts, length (`step-len`, the stopwatch's stop moves with it) and transcript, each edited in place where it's
  shown (numbers as `sim-inl` fields, choices as `sim-inl-sel`: grey boxes reaching 3px past their text with a margin
  taking it back, so the text sits at the same pixel as unedited; each gear stat's Artifice mark as a button stepping it
  0 → 3 and round, only that gear line drawn again (`sim-art`); the transcript's own lines
  under the timeline, `transcriptLines`: one grid for both views, each line a subgrid: remove, time, operator (as wide as the
  team's widest name, `opSizers`), the dot, action (as wide as its widest label, `actSizers`), SP gained, interrupt,
  the stretch, SP, bar after, damage; remove, interrupt and SP gained empty unedited; the scrollbar's room always kept; times as m:ss.s on the fight's clock, `videoTimeOf` adding the pauses back, Add action / Add invulnerable where Full transcript is), all kept in `draft` (no replay or redraw per change) until Play edited
  transcript (in the header, with Cancel, in place of Edit) replays it once; the transcript under the timeline
  shows only the moment at the playhead (and actions at the same moment together) unless Full transcript
  (`fold.moves`); on a phone each line is two at a fixed height (the numbers on the second) and the toggle goes under it; contribution bars ease to the playhead's shares (`aimBars`), even before any damage (a second's
  average damage spread over everyone as a start).
  The stopwatch: the timer's places (`clockAlt`), a countdown's start rounded up to its minute within 2 s (the HUD fades
  in a moment after it starts: `clock.lead`, from its ticks: the tick to a value comes that many seconds after the
  minute, the Skydrummer's 10:00 at 0.65 s of video), and its last value read from `lateAnchors`
  (every 0.25 s over the HUD's last 4 s, just after each stretch's last tick; they never vote, a stopwatch that stopped
  would miscount): the Skydrummer's last 7:25 showed for half a second, 3 s before the HUD left. A read in a hidden tab
  gets few frames (the browser slows it: 4 a second for the Skydrummer's first 100 s in testing), which loses Final
  Strikes and HP readings; the HP series takes a second's window then (`bossBars`), and the fill-in skip lasts only
  `SETTLE_FOR` (2 s) after the start or a refill. An SP gain is measured to its peak within `RISE` (0.4 s): the bar
  fills in steps, and a Finisher's +52 first seen at +20 was taken for a Final Strike. In dev builds a read's frames are kept (IndexedDB
  `itjustlogs-debug`) and `window.__reread(asDraft)` redoes the stopwatch and the reading from them.
  Arts Inflictions on the enemy last 20 s from their last application, a new one of the element resetting every
  stack's (`INFLICTION_SECONDS`, `inflictUntil`; endfield.wiki.gg Arts Infliction, and the game's infliction buffs'
  duration 20); ForceSpellStatusAction consumes `consumedLayer` stacks of the infliction `consumedType` names (1–4 as
  consumed_type: Yvonne's bomb takes the Cryo it freezes with). A cut-in stops the fight's clock (`freeze`): no SP regenerates and no buff or Stagger time passes; the stage
  timer runs on (the game's SP bar stands still through one: 58 → 61 over 3.4 s, 57 → 60 over 5.0 s, only the fade).
  SP also holds while a recording's stopwatch stands still (`World.holdSp`, set by replaySim). A second ultimate in
  another's cut-in plays its own cut-in after it (`freezeQueue`: the game stays frozen for both, 3.38 s for a pair where
  one cut-in is 1.57). Imprisonment
  (SealAction, Arcane's combo) slows the enemy's own clock by its curve (0.3, 0.2 at 5%, rising to 1): each whole frame
  it loses, its buffs, inflictions, Breach and Staggered time wait a frame (`seals`, `foeScale`, `foeLoseFrame`;
  Corrosion III lasted 28.15 s in the Skydrummer recording, each Stagger ~11.2 s). Found by the AI parser session; with
  both the Skydrummer replay went from 79% to 98% of its HP (full loadouts), Alleikhreos 92% to 96%.
  A build (`SimBuild`) can carry operator `level`, `ranks` (basic, normal, combo, ultimate: each of the
  operator's skills by `kindOf`, only its own: bundles carry other operators' skills and levels are one map for the
  team; a passive that levels with a skill follows its rank, `rankKind`: Tangtang's passive_0 holds Waterspout's tick;
  the World keeps skill levels by team position, `<slot>|<skill id>`, since weapons share attribute skills)
  and `weapon.level`; `teamFromSpec` passes them on (90 / 12 / 90 unless set), with the promotion they imply (it unlocks attribute nodes and talent levels: ef-assets combat bundles' `base.talentStages`,
  CharGrowthTable's passive skill nodes, filtered in `equip`; a level with none, such as Xaihi's talent_2_2, is never
  given; `promotionOf`: the lowest stage whose level and skill-rank caps hold them, CharBreakStageTable; a level at a cap, 80, takes the lower stage). A
  parsed run keeps the loadouts it ran with in its request; while it's edited each box has fields for them plus
  Potential, each gear stat's Artifice (0–3; `art<piece>:<stat>`, saved as a list) and each weapon skill's rank (its level, the data's caps at its tuning, 9/9/4 fully tuned, plus
  the weapon's Potential on the last: `essenceCaps`, `skillRanks`) (`levelsEdit` in the top row, where the name gives way; `weaponLine`; `editBuild`),
  portraits square in the boxes, a box's food as a sixth line under its gear (`foodLine`: item icon and name, a choice in
  place while edited; only where the stage allows food),
  otherwise a line for what isn't the default. Two ultimates can share a cut-in in a replay (`can`:
  only an ultimate, only with `strictUltimates` off). The Recording view's SP amounts are the game's (the sim's for the
  same action; a battle skill's 100 otherwise): the bar's pixels read 101 or 102 (`withExactSp`); a reading without the SP bar takes the sim's amounts, with no bar after. Every action shows its SP (`spText`, a combo's 0 too: the sim's same action's where none was read) and the bar after it (an action that moved none: the bar as read at it). The transcript keeps its SP and damage columns while edited.
  Uptime (setting `uptime`, %; `World.uptime`): the share of the fight the enemy can be hit, the rest a
  stretch at the end of every 10 s with no presses or basic attacks (100% unless set). The owner's gameplay
  videos only confirm game mechanics (energy, combo triggers, cooldowns), never a target for the sim's pace or
  DPS. Food (member `food`, `FOODS` in team.ts, from the game's
  UseItemTable and BuffData: Jakub's Legacy ATK +27%) buffs one operator the whole fight. `replaySim` (team.ts) plays a gameplay video's read
  steps in the sim for its timeline and DPS (worker message `replay`; combos and ultimates the video shows are allowed:
  `strictCombos`/`strictUltimates` off). The page keeps the last reading (`simVideo` in IndexedDB) for runs saved without one, and
  each replay goes in History as a Recording. Scratch tests `src/domain/sim/dbg*.test.ts` and `dbgTeam.ts` (gitignored, run with `DBG=1 npx vitest run <file>`)
  read a local ef-assets clone: never commit them.

## Current state and next steps (2026-10-25 handoff)

- Nothing of the sim/Parser work is uncommitted: the last batch is 41db3bf (ultimate forms). Scratch only, never
  committed: `src/domain/sim/dbgAudit*.test.ts` (the all-operator audit; it reads an ef-assets clone at a hard-coded
  session scratchpad path, which goes away with that session: point `S` at a fresh clone) and its
  `audit_compare.py` (same scratchpad, lost; it compared the audit's per-rank hit multipliers with wiki
  `operators.json` skill values, 0.6% tolerance, sums of hits as candidates).
- Saved runs replayed before 41db3bf lack actions' sources (no alignment) and forms: replay them (Edit, Play edited
  transcript). The owner's two runs on 5175 (Alleikhreos 2:45 AM, Skydrummer 11:55 PM, Oct 24) are replayed.
- Waiting on the owner: whether the site parser should emit `staggerLeft` (offered, not answered).
- Gaps against the recordings:
  - Skydrummer: Yvonne's Final Strikes now land on the video's frames (the Haste fix above); before it the one at
    0:33.3 landed in the parsed no-Stagger stretch (to 33.02) and lost its 17, which hid the next gap and made the
    Stagger late (63.2 s against 62.1 s). Now the sim's meter runs ~11 (3.4%) above the video's by 0:57.8 (320
    against 309), so both Staggers come early: 57.8 s against 62.1 s, 129.6 s against 133.0 s. Where the meters part:
    Tangtang's battle skill gives 10 in the sim and ~8 on the video (0:03.5, 0:21.8), the interrupt at 0:48.4 20
    against ~17, and single points elsewhere. Alleikhreos's meter matches the video within 2 with the same skills,
    and the Skydrummer's spawners add no Stagger (only buff_dung_maxhp_01), so it isn't the meter's size.
  - Skydrummer Finishers land on the video's (2026-10-26): 63.17 / 137.30 against 63.18 / 137.3 (were 62.97 /
    138.13: her talent's Final Strike took the second's place, and the 1 s press lead put the first 0.2 s early).
    The second's damage: 135k in the sim against ~238k on the bar (0.199 → 0.139 of 3.96M at 137.1–137.35); a crit
    accounts for ×1.38 of it (the sim's expected crit), and its ATK is 4,725 against 6,266 at the first Finisher
    (63.17): the crit set's ATK stacks lapsed (last crit refresh 127.0) and Li Zhiyan's weapon buff (last 112.7) is
    gone, both down to rolls the expected-value sim can't follow; Resistance 0.5 against 0.72 and no Li Zhiyan seal
    Susceptibility at 137.3 likewise follow the replay's own timing. The fit's 306k was that second scaled.
  - Arts Amp from Xaihi's crystal heal is given even at full HP (the sim's team takes no damage).
- Engine gaps from the audit (multipliers 189 exact, 95 rounding, 77 conditional untested, 35 off; costs all match):
  Purrchena's ultimate ticks (ExecuteIntervalAction), counter skills never fire (TakeDownAction: no enemy attacks),
  CreateGlobalBuffAction (Akekuri, Liino), buff_common_try_pulse_cryst_triggered (Arclight, Liino),
  CheckSkillCameraMotionFree, CheckSkillHasHit, Typhoeus's three. Not audited: conditional rows, buff durations and
  stacks, weapons and gear.
- Next, in order:
  1. The Skydrummer's meter filling ~3.4% faster than the video's (the gap above).
  2. Done: the second Finisher's delay (a talent's waiting attack took the Finisher's place).
  3. Rule tests that run for every operator (skill levels per operator, aura sources, SP regen, durations).
  4. The audit's engine gaps above, then audit conditional rows, buffs, weapons and gear.
