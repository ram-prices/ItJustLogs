# Game client dump

Decrypted Arknights: Endfield client data on the owner's PC. Local only, never committed.
Used for ef-assets art and data; the site itself never reads it.

- Folder: `C:\Users\Albert\Development\EndfieldDataDump` (`README.md`, `HANDOFF-*.md`).
- Dumper: `dumper\dump.py` plus parsers, based on Escartem's DataDumper (`dumper\SOURCE.md`).
- The game is only read, never modified. Runs are incremental.

## Running it

- `run_all.bat ["<game folder>"]` runs every stage. It finds the install itself.
  Stages are in `advanced\`: `run_dump.bat`, `run_jsondata.bat`, `run_bundle_stage.bat`.
- After a game patch, open the game so it downloads, then rerun.
- Check `output\dump_status.txt`. Python needs UnityPy for bundles.

## Output (`output\`)

- `Data\TableCfg\*.json`: game tables. Strings are `{id, text}`; look up `id` in `I18nTextTable_EN.json`.
- `Data\LuaScripts\`: decrypted UI and game Lua.
- `jsondata\{Persistent,StreamingAssets}\`: `SkillData`, `BuffData`, `SpawnerConfig`, `LevelData`, `LevelScriptData`.
- `bundles\{Persistent,StreamingAssets}\Bundle\...\<hash>\`: decrypted bundles, each with `CAB-*` and `manifest.json`.
- `asset_index.tsv`: bundle path to asset path (351k rows). `banner_layers.json`: banner art layers.
- `raw\`: every file, archive-layer decrypted (~64 GiB). `videos\`: webm.

## Reading bundles

- `dumper\map_banner_layers.py`: `load_asset_index()` gives bundle to paths; `BUNDLES` is the root.
- Open a CAB with `UnityPy.load(path)`; use `o.read_typetree()`, or `o.read()` for textures.
- PPtrs: `m_FileID` 0 is this file, otherwise `externals[id-1]`. A CAB-to-path index follows them across bundles.
- Legacy clips hold keys in `m_FloatCurves`; `m_MuscleClip.m_StopTime` reads 1.0 there and is wrong.

## Pitfalls

- `Persistent` overrides `StreamingAssets`. The same CAB name can exist in both, so a CAB index
  keyed by name can return the old copy. Open the `Persistent` bundle by its own path first.
- Text with ids in `I18nTextServerTimeIdTable` comes from the server (`I18nServerTextManager`), so dumps lack it.
- `TimeRangeTable` lists local times: entries 0 and 1 are UTC+8, entry 2 is UTC-5.
- Run scratch Python with `-I`, from outside the dump. Don't pipe heredocs into Python here: it hung.
