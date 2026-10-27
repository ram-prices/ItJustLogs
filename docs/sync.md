# Google Drive sync, version history, pictures

Read when touching `src/drive.ts`, `ui/sync.ts`, snapshots, operator art or the profile picture.

- Optional Google Drive sync: `src/drive.ts` (Google Identity Services token
  client + Drive REST, scope `drive.appdata` only, so the app sees nothing but
  its own hidden appDataFolder) and `ui/sync.ts` (merge rules). The Drive copy
  is one file, `itjustlogs-backup.json`, in the full-backup shape of `ui/io.ts`
  plus `changed` times. Pulls merge like an import, with the same same-player
  check and dialog (`ui/dialog.ts`); settings and each picture are taken whole
  from whichever side changed them last (ties go to Drive); Drive's file
  `version` is re-checked right before each upload.
  - Guardrail: the Drive copy's pulls only ever grow. Every sync downloads it
    and merges its pulls in before uploading (which also restores pulls this
    browser lost), and `missingPulls` (parse.ts) refuses any upload that would
    drop one. Anything that removes pulls here (both delete buttons, "Replace
    saved pulls" on import, restoring a version) signs this browser out of
    sync first, so it never reaches Drive. Only the player deleting the app
    data in Google Drive removes the Drive copy.
- Version history (`store.ts` snapshots, `state.snapshot`): before any
  import, delete, replace, restore or Drive merge that changes the pulls, the
  previous pulls are saved in IndexedDB (`data` store, `snapshot:<id>` plus a
  `snapshots` index; last 15, identical copies skipped). Settings → Version
  history lists them with Restore (which saves the current pulls first). While synced, each copy also goes to Drive as its own
  appData file (`snapshot:<id>`, list fields in `appProperties`; `syncSnapshots`
  in ui/sync.ts), the newest 30 from every device kept; Version history
  lists them too (`meta.driveSnapshots`) and downloads one only to restore it
  (then signs out, like any restore).
  Delete pull history keeps them; Delete everything clears them. Tokens last an hour and there's no backend to refresh
  them: each visit needs one click (header Sync button / Sync now). The token
  lives in sessionStorage only. Google's script is loaded only when the sync
  card is shown or sync is on; no other visitor ever contacts Google.
  - Operator art (`ui/pages/art.ts`): pictures the player uploads or links
    to on an operator's page (a link is downloaded once, never hotlinked;
    sites that block cross-site downloads get an "upload it instead"
    message). Stored in IndexedDB (`art:<op id>:<id>`), shrunk to 2560px
    WebP. Each picture shows where the player picks (`settings.artPlaces`:
    banner, character picture, page background, Gallery slideshow), a random
    one per spot each visit. Sync copies each picture to its own appData
    file named by its key (`syncArt`), not into the backup file; removals
    travel as `settings.deletedArt` tombstones. Downloaded full backups do
    include it (`Backup.art`, data URLs; `buildBackup({ art: true })`), and
    importing one restores pictures this browser lacks.
  - Potential art picks (`settings.potentialArt`: operator id → `'base'` or a
    picture key like `'p3'`; Auto isn't stored, so older settings load as
    Auto) are plain settings: they sync and go in backups with the rest, and
    the pictures themselves stay on ef-assets (docs/ui.md).
  - Parsed runs (Rotations → Parser) sync too, each as its own appData file
    `run:<at>` (`syncRuns`, its last change `edited` in appProperties; the newer
    side wins); deletions travel as `settings.deletedRuns`. Simulator results
    stay in this browser. Not in downloaded backups (Export run moves one).
  - The profile picture's original (at most 1024px) with its framing and
    painting (`AvatarEdit` in store.ts, for Edit picture) syncs as one
    appData file, `avatar-edit` (`syncAvatarEdit`; the newer `at` wins, gone
    with the picture), and goes in downloaded backups (`Backup.avatarEdit`).
  - It's off unless the build has `VITE_GOOGLE_CLIENT_ID` (a public value).
    Locally: put `VITE_GOOGLE_CLIENT_ID=...` in `.env.local` (gitignored). On
    Pages: the deploy workflow reads the repo variable `GOOGLE_CLIENT_ID`
    (Settings → Secrets and variables → Actions → Variables). Without it the
    card is hidden and nothing else changes.
  - Google Cloud setup (owner, once): create a project; APIs & Services →
    enable the Google Drive API; OAuth consent screen (Google Auth Platform):
    External, app name ItJustLogs, support email, add the scope
    `.../auth/drive.appdata` (non-sensitive), authorized domain
    `itjustlogs.dev`, then Publish (in Testing only listed test users can sign
    in); Clients → Create client → Web application, Authorized JavaScript
    origins `https://itjustlogs.dev` and `http://localhost:5173` (no redirect
    URIs needed). Copy the client ID into `.env.local` and the repo variable.
