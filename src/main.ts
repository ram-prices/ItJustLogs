import './styles.css';
import { loadImages, loadSavedHistory, loadSnapshots, setBannerDb, setSchedule } from './state';
import { refreshBannerDb, refreshSchedule, savedDataTrouble } from './store';
import { mount } from './ui/app';
import { toast } from './ui/common';

// Never holds the page back for long: saved data that can't be opened (another tab with an older
// version of the site, a browser that doesn't answer) gives up after a few seconds (store.ts openDb).
await loadSavedHistory();
mount();
if (savedDataTrouble())
  toast(
    savedDataTrouble() === 'blocked'
      ? "Your saved pulls couldn't be opened: another ItJustLogs tab is holding them. Close it and reload."
      : "Your saved pulls couldn't be opened. Reload to try again.",
    'error',
  );
void loadImages();
void loadSnapshots().catch((e) => console.warn('Could not read version history', e));
// Banner data ships with the site and is cached; refresh it from ef-assets in the background.
void refreshBannerDb().then((db) => db && setBannerDb(db));
void refreshSchedule().then((s) => s && setSchedule(s));
