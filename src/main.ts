import './styles.css';
import { loadImages, loadSavedHistory, setBannerDb, setSchedule } from './state';
import { refreshBannerDb, refreshSchedule } from './store';
import { mount } from './ui/app';

await loadSavedHistory();
mount();
void loadImages();
// Banner data ships with the site and is cached; refresh it from ef-assets in the background.
void refreshBannerDb().then((db) => db && setBannerDb(db));
void refreshSchedule().then((s) => s && setSchedule(s));
