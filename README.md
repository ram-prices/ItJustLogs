# ItJustLogs

A pull-history tracker for **Arknights: Endfield** that runs entirely in your browser.

- Live pity, rate-up guarantee and bonus-reward progress for every banner
- How lucky each 6★ was, as the chance of getting that rate-up copy within that many pulls
- 50/50 (and 25/75) record, drop rates against expected rates
- Pulls per week, plus a breakdown by patch that includes the banners you skipped
- A planner: "if I pull N more times, what are my odds?", starting from your real pity
- Light and dark themes. Import by file, drag and drop, or paste.
- Each import is merged into your saved history, so pulls older than the game's history window are kept

## Getting your data

The site never asks for your token. On the **Get data** page there's a short,
fully visible PowerShell script (`scripts/export-pulls.ps1`) that reads the
history link from the game's cache and downloads your history from Gryphline's
official server. It saves the history to your Desktop and copies it to your
clipboard. Then you paste it into the site.

## Development

```bash
npm install
npm run dev
```

`npm test` runs the unit tests and `npm run build` outputs static files to `dist/`.

Fan-made and not affiliated with Gryphline or Hypergryph. Game assets belong to them.
