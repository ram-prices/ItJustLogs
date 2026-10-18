import './style.css';
import { loadImages, loadSavedHistory, setBannerDb } from './state';
import { refreshBannerDb } from './store';
import { mount } from './ui/app';

await loadSavedHistory();
mount(document.getElementById('app')!);
void loadImages();
// Banner data ships with the site and is cached; refresh it from ef-assets in the background.
void refreshBannerDb().then((db) => db && setBannerDb(db));
