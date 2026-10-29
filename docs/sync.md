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
  - Operator storage (`ui/pages/art.ts`, the operator page's Storage box):
    files the player uploads, kept exactly as uploaded (any type, no
    resizing), in IndexedDB (`art:<op id>:<id>`). Nothing is fetched from
    links. Sync copies each file to its own appData file named by its key
    (`syncArt`, with its type), not into the backup file; removals travel as
    `settings.deletedArt` tombstones. Drive takes files over 5 MB through a
    resumable upload (`uploadArt`; not tested end to end). Downloaded full
    backups include the files (`Backup.art`, data URLs; `buildBackup({ art:
    true })`), and importing one restores those this browser lacks. A
    picture can be the page's banner (`settings.artPlaces`: key →
    `['banner']` or `[]`; new uploads start with `[]`, pictures saved before
    the box have none and count as banner pictures; a random one of several
    each visit); places other than the banner were removed
    (`withoutRetiredPlaces`, domain/artMeta.ts). Items saved earlier from a
    link keep it in `settings.artSources`, shown in the viewer.
  - Storage box names, notes and links (`settings.storeItems`: key →
    `{ kind: 'file', name, size }`, `{ kind: 'note', text }` or
    `{ kind: 'link', url, title? }`, domain/storage.ts) are kept in settings,
    not in a Drive file each: they're a few bytes, an edit needs no file
    versioning, and they sync and go in backups with the rest. Every key has
    the files' shape (`art:<op id>:<time><random>`), so the box sorts all
    kinds newest first. Settings sync whole (the newer copy wins), so edits
    on two devices before either syncs keep one side. Links kept before the
    box (`artLinks` + `artSources`) become link items on load
    (`withStorageItems`, same keys).
  - Banner art picks (`settings.potentialArt`: operator id → `'base'`,
    `'custom'` or a picture key like `'p3'`; Auto isn't stored, so older settings load as
    Auto) are plain settings: they sync and go in backups with the rest, and
    the pictures themselves stay on ef-assets (docs/ui.md).
  - Parsed runs (Rotations → Parser) sync too, each as its own appData file
    `run:<at>` (`syncRuns`, its last change `edited` in appProperties; the newer
    side wins); deletions travel as `settings.deletedRuns`. Simulator results
    stay in this browser. Downloaded full backups carry both kinds (`Backup.sims`, merged on import
    by time, the later `edited` wins, capped at 100; `restoreSims`), not the Drive copy.
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
  - Android app (`C:\Users\Albert\Development\ItJustLogs Wrapper`, id
    `dev.itjustlogs.web`): the site in a WebView, where Google refuses its
    sign-in. The app signs in natively (`AuthorizationClient`, same scope)
    and its bridge script defines `window.IJLAndroid` on the site's origin
    only. When it exists, `drive.ts` takes tokens from it (`requestToken`,
    `silentToken`), sign-out and refused (401) tokens go back to it, and the
    GIS script is never loaded; sync needs no client ID or click there
    (`refreshesSilently`). Everything else in sync is the same. Tested by
    `src/drive.android.test.ts`. Google Cloud: an Android client for package
    `dev.itjustlogs.web` + the signing SHA-1.
