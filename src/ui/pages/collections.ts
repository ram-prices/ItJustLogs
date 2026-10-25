import { ARCHIVE_CATEGORIES, FINDING_CATEGORIES, MEDAL_CATEGORIES, medalImage, type Finding, type FindingFile, type Medal, type MedalFile, type MedalProgress } from '../../domain/collections';
import { state, updateSettings } from '../../state';
import { icon, pageHeader, toggleGroup } from '../components';
import { html, raw, render, type Html } from '../html';
import { credit } from './info';
import { searchBox } from './search';

/**
 * Achievements (the game's Medal Album) and Archive (its Intel Archives →
 * Findings): every medal and finding from the wiki snapshots
 * (scripts/wiki-collections.mjs), and which ones the player has. That's
 * kept in settings (`medals`, `findings`), so it's in exports and Drive
 * sync. Both pages work without an import. Typing filters them
 * (pages/search.ts), and a toggle shows all, only those owned, or the rest.
 */

// ---------------------------------------------------------------------------
// Data: loaded on first visit (its own chunk, so other pages don't carry it)
// ---------------------------------------------------------------------------

let medalFile: MedalFile | null = null;
let findingFile: FindingFile | null = null;
const waiting = { medals: new Set<() => void>(), findings: new Set<() => void>() };
let loading = { medals: false, findings: false };

function medalData(redraw: () => void): MedalFile | null {
  if (medalFile) return medalFile;
  waiting.medals.add(redraw);
  if (!loading.medals) {
    loading = { ...loading, medals: true };
    void import('../../data/medals.snapshot.json').then((m) => {
      medalFile = m.default as unknown as MedalFile;
      waiting.medals.forEach((fn) => fn());
      waiting.medals.clear();
    });
  }
  return null;
}

function findingData(redraw: () => void): FindingFile | null {
  if (findingFile) return findingFile;
  waiting.findings.add(redraw);
  if (!loading.findings) {
    loading = { ...loading, findings: true };
    void import('../../data/findings.snapshot.json').then((m) => {
      findingFile = m.default as unknown as FindingFile;
      waiting.findings.forEach((fn) => fn());
      waiting.findings.clear();
    });
  }
  return null;
}

/** Reads medals from pasted or dropped files (app.ts), loading the medal list first if needed. */
export async function readMedalsFrom(files: File[]): Promise<void> {
  const data = medalFile ?? ((await import('../../data/medals.snapshot.json')).default as unknown as MedalFile);
  const { readMedalFiles } = await import('../medalReader');
  await readMedalFiles(files, data.medals);
}

/** Medals and Archive entries the player has, of how many (Home's Collection widget); null while loading. */
export function archiveProgress(redraw: () => void): { medals: [number, number] | null; archive: [number, number] | null } {
  const m = medalData(redraw);
  const f = findingData(redraw);
  const medals = state.settings.medals ?? {};
  const have = new Set(state.settings.findings ?? []);
  return {
    medals: m ? [m.medals.filter((x) => medals[x.id]).length, m.medals.length] : null,
    archive: f ? [f.findings.filter((x) => have.has(x.id)).length, f.findings.length] : null,
  };
}

/** Reads findings from pasted or dropped files (app.ts), loading the list first if needed. */
export async function readFindingsFrom(files: File[]): Promise<void> {
  const data = findingFile ?? ((await import('../../data/findings.snapshot.json')).default as unknown as FindingFile);
  const { readFindingFiles } = await import('../findingReader');
  await readFindingFiles(files, data.findings.filter((f) => FINDING_CATEGORIES.includes(f.category)));
}

// ---------------------------------------------------------------------------
// The player's progress
// ---------------------------------------------------------------------------

type Show = 'all' | 'have' | 'missing';
const show: Record<'medals' | 'findings', Show> = { medals: 'all', findings: 'all' };
/** The open category tab on each page (kept while the app is open). */
const tab = { medals: MEDAL_CATEGORIES[0], findings: FINDING_CATEGORIES[0] };

const medalsOwned = (): Record<string, MedalProgress> => state.settings.medals ?? {};
const findingsOwned = (): Set<string> => new Set(state.settings.findings ?? []);

function setMedal(id: string, p: MedalProgress | null): void {
  const all = { ...medalsOwned() };
  if (p) all[id] = p;
  else delete all[id];
  updateSettings({ medals: Object.keys(all).length ? all : undefined });
}

/** The pages' clicks (app.ts passes them on, then redraws). True if it was one of theirs. */
export function collectionAction(action: string, el: HTMLElement): boolean {
  const id = el.dataset.value ?? '';
  switch (action) {
    case 'medal-show':
    case 'finding-show':
      // A filter is a view, not a setting: nothing is saved (app.ts redraws).
      show[action === 'medal-show' ? 'medals' : 'findings'] = id as Show;
      return true;
    case 'medal-tab':
    case 'finding-tab':
      tab[action === 'medal-tab' ? 'medals' : 'findings'] = id;
      return true;
    case 'medal-read': {
      // The reader (Tesseract and its rules) loads on the first click.
      const file = medalFile;
      if (file) void import('../medalReader').then((m) => m.readMedals(file.medals));
      return true;
    }
    case 'finding-read': {
      const file = findingFile;
      if (file) void import('../findingReader').then((m) => m.readFindings(file.findings.filter((f) => FINDING_CATEGORIES.includes(f.category))));
      return true;
    }
    case 'medal-toggle':
      setMedal(id, medalsOwned()[id] ? null : {});
      return true;
    case 'finding-toggle': {
      const have = findingsOwned();
      if (!have.delete(id)) have.add(id);
      updateSettings({ findings: have.size ? [...have] : undefined });
      // The open document's own toggle follows.
      const dlg = document.querySelector<HTMLElement>('.finding-dialog [data-action="finding-toggle"]');
      if (dlg) paintToggle(dlg, have.has(id), 'Collected', 'Mark collected');
      return true;
    }
    case 'finding-open':
      openFinding(id);
      return true;
  }
  return false;
}

/** A medal's date, Reforging tier or Trimming changed (its inputs on the Achievements page). */
export function collectionChange(el: HTMLInputElement | HTMLSelectElement): boolean {
  const id = el.dataset.medal;
  if (!id) return false;
  const now = medalsOwned()[id];
  if (!now) return false;
  const next: MedalProgress = { ...now };
  if (el.dataset.medalField === 'at') next.at = el.value || undefined;
  if (el.dataset.medalField === 'tier') next.tier = el.value === '3' ? 3 : el.value === '2' ? 2 : undefined;
  if (el.dataset.medalField === 'trim') next.trim = (el as HTMLInputElement).checked || undefined;
  for (const k of Object.keys(next) as (keyof MedalProgress)[]) if (next[k] === undefined) delete next[k];
  setMedal(id, next);
  return true;
}

const showToggle = (name: string, current: Show, have: string, missing: string) =>
  toggleGroup(name, [['all', 'All'], ['have', have], ['missing', missing]], current);

const loadingPage = (title: string) =>
  html`${pageHeader(title, 'Loading…')}<main class="container fade-in"><p class="copy-14 secondary">Loading…</p></main>`;

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

const TIER = ['', '', 'Reforged II', 'Reforged III'];

function medalRow(m: Medal, p: MedalProgress | undefined): Html {
  const got = !!p;
  const img = medalImage(m, p);
  const desc = p?.tier && m.reforge[p.tier - 2]?.desc ? m.reforge[p.tier - 2].desc : m.desc;
  return html`<div class="medal card${got ? ' got' : ''}" data-search-item>
    ${img ? html`<img class="medal-img" src="${img}" alt="" loading="lazy" decoding="async" />` : html`<span class="medal-img"></span>`}
    <div class="medal-body min0">
      <div class="medal-name">${m.name}${p?.tier ? html` <span class="badge outline">${TIER[p.tier]}</span>` : ''}${p?.trim ? html` <span class="badge outline">Trimmed</span>` : ''}</div>
      ${desc ? html`<p class="copy-13 secondary medal-desc">${lines(desc)}</p>` : ''}
      <dl class="medal-conds copy-13">
        ${m.cond ? html`<div><dt>Condition</dt><dd>${m.cond}</dd></div>` : ''}
        ${m.secret ? html`<div><dt>Secret</dt><dd><details><summary>Show</summary>${m.secret}</details></dd></div>` : ''}
        ${m.reforge.map((r, i) => html`<div><dt>${TIER[i + 2]}</dt><dd>${r.cond}</dd></div>`)}
        ${m.trim ? html`<div><dt>Trimmed</dt><dd>${m.trim}</dd></div>` : ''}
        ${m.end ? html`<div class="tertiary"><dt>Ended</dt><dd>${m.end}</dd></div>` : ''}
      </dl>
    </div>
    <div class="medal-mine">
      <button type="button" class="have-toggle" data-action="medal-toggle" data-value="${m.id}" aria-pressed="${String(got)}">${icon(got ? 'check_circle' : 'add')}${got ? 'Acquired' : 'Mark acquired'}</button>
      ${got
        ? html`<input class="input medal-date" type="date" data-medal="${m.id}" data-medal-field="at" value="${p?.at ?? ''}" aria-label="Date acquired" title="Date acquired (as the game shows it)" />
            ${m.reforge.length
              ? html`<select class="input medal-tier" data-medal="${m.id}" data-medal-field="tier" aria-label="Reforging">
                  <option value="1">Base</option>
                  ${m.reforge.map((_, i) => html`<option value="${String(i + 2)}" ${raw(p?.tier === i + 2 ? 'selected' : '')}>${TIER[i + 2]}</option>`)}
                </select>`
              : ''}
            ${m.trim ? html`<label class="medal-trim copy-13"><input type="checkbox" data-medal="${m.id}" data-medal-field="trim" ${raw(p?.trim ? 'checked' : '')} />Trimmed</label>` : ''}`
        : ''}
    </div>
  </div>`;
}

/** Line breaks in the wiki's text. */
const lines = (s: string): Html => html`${s.split('\n').map((l, i) => html`${i ? html`<br />` : ''}${l}`)}`;

export function achievementsPage(redraw: () => void): Html {
  const data = medalData(redraw);
  if (!data) return loadingPage('Achievements');
  const owned = medalsOwned();
  const all = data.medals;
  const got = all.filter((m) => owned[m.id]).length;
  const keep = (m: Medal) => (show.medals === 'have' ? !!owned[m.id] : show.medals === 'missing' ? !owned[m.id] : true);
  const cats = [...MEDAL_CATEGORIES, ...new Set(all.map((m) => m.category).filter((c) => !MEDAL_CATEGORIES.includes(c)))];
  if (!cats.includes(tab.medals)) tab.medals = cats[0];
  const count = (cat: string) => {
    const inCat = all.filter((m) => m.category === cat);
    return `${inCat.filter((m) => owned[m.id]).length}/${inCat.length}`;
  };
  return html`<main class="container fade-in">
      <div class="collection-layout">
        ${pageHeader(
      'Achievements',
      `${got}/${all.length} medals`,
      html`<button type="button" class="btn secondary sm" data-action="medal-read" title="Read acquired medals and their dates from a recording or screenshots of the Medal Album. You can also paste (Ctrl+V) or drop them on this page">${icon('document_scanner')}Read from video or screenshots</button>`,
    )}
        ${subTabs('medal-tab', cats, tab.medals, count)}
        <div class="min0 collection-panes">
          <div class="section-head wiki-sort-head">${searchBox('medals', 'Search medals')}${showToggle('medal-show', show.medals, 'Acquired', 'Not yet')}</div>
          ${cats.map((cat) => {
            const inCat = all.filter((m) => m.category === cat);
            const groups = [...new Set(inCat.map((m) => m.group))];
            const shown = inCat.filter(keep);
            return html`<section class="collection-pane${cat === tab.medals ? ' active' : ''}" data-pane>
              <div class="section-head collection-pane-head"><h2 class="heading-20">${cat}</h2><span class="label-13 secondary">${count(cat)}</span></div>
              ${shown.length ? '' : html`<p class="copy-14 secondary">${show.medals === 'have' ? 'None acquired here yet.' : 'All acquired here.'}</p>`}
              ${groups.map((g) => {
                const rows = shown.filter((m) => m.group === g);
                return rows.length
                  ? html`<div class="collection-group" data-search-section>
                      ${g ? html`<h3 class="collection-group-name label-14 secondary">${g}</h3>` : ''}
                      <div class="medal-list">${rows.map((m) => medalRow(m, owned[m.id]))}</div>
                    </div>`
                  : '';
              })}
            </section>`;
          })}
          <p class="copy-14 secondary list-search-empty" hidden>No medals match your search.</p>
        </div>
      </div>
      ${credit(data.attribution, 'https://endfield.wiki.gg/wiki/Path_of_Glory')}
    </main>`;
}

/**
 * The category tabs: a list down the side (like the game's) on wide
 * screens, a scrolling row on phones. Only the open category's list shows;
 * while the player searches, every category's matches show (pages/search.ts
 * marks the page `searching`).
 */
export function subTabs(action: string, cats: string[], current: string, count: (cat: string) => string): Html {
  return html`<nav class="collection-tabs" aria-label="Categories">
    ${cats.map(
      (c) => html`<button type="button" class="collection-tab" data-action="${action}" data-value="${c}" aria-current="${String(c === current)}">
        <span>${c}</span><span class="label-12 secondary num">${count(c)}</span>
      </button>`,
    )}
  </nav>`;
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/** Tiles without a picture: an icon for what they are. */
const ARCHIVE_ICON: Record<string, string> = { 'Audio Records': 'mic', 'Nexus Files': 'menu_book', 'Intel Gathering': 'search' };

function findingTile(f: Finding, got: boolean): Html {
  const where = [f.region, f.area].filter(Boolean).join(' · ');
  return html`<div class="finding card${got ? ' got' : ''}" data-search-item>
    <button type="button" class="finding-open" data-action="finding-open" data-value="${f.id}" title="${f.name}">
      <span class="finding-art">${f.icon ? html`<img src="${f.icon}" alt="" loading="lazy" decoding="async" />` : icon(ARCHIVE_ICON[f.category] ?? 'description')}</span>
      <span class="finding-name">${f.name}</span>
      <span class="finding-where label-12 secondary">${where || f.unlock?.replace(/^Complete the (?:main |side )?mission\s*/i, '') || f.type || ''}</span>
    </button>
    <button type="button" class="finding-check" data-action="finding-toggle" data-value="${f.id}" aria-pressed="${String(got)}" aria-label="${got ? `${f.name}: collected` : `Mark ${f.name} collected`}" title="${got ? 'Collected' : 'Mark collected'}">${icon(got ? 'check_circle' : 'add')}</button>
  </div>`;
}

export function archivesPage(redraw: () => void): Html {
  const data = findingData(redraw);
  if (!data) return loadingPage('Archive');
  const owned = findingsOwned();
  const all = data.findings;
  const got = all.filter((f) => owned.has(f.id)).length;
  const keep = (f: Finding) => (show.findings === 'have' ? owned.has(f.id) : show.findings === 'missing' ? !owned.has(f.id) : true);
  if (!ARCHIVE_CATEGORIES.includes(tab.findings)) tab.findings = ARCHIVE_CATEGORIES[0];
  const count = (cat: string) => {
    const inCat = all.filter((f) => f.category === cat);
    return `${inCat.filter((f) => owned.has(f.id)).length}/${inCat.length}`;
  };
  return html`<main class="container fade-in">
      <div class="collection-layout">
        ${pageHeader(
      'Archive',
      `${got}/${all.length} collected`,
      html`<button type="button" class="btn secondary sm" data-action="finding-read" title="Read collected findings from a recording or screenshots of Intel Archives → Findings. You can also paste (Ctrl+V) or drop them on this page">${icon('document_scanner')}Read from video or screenshots</button>`,
    )}
        ${subTabs('finding-tab', ARCHIVE_CATEGORIES, tab.findings, count)}
        <div class="min0 collection-panes">
          <div class="section-head wiki-sort-head">${searchBox('findings', 'Search the archive')}${showToggle('finding-show', show.findings, 'Collected', 'Not yet')}</div>
          ${ARCHIVE_CATEGORIES.map((cat) => {
            const shown = all.filter((f) => f.category === cat && keep(f)).sort((a, b) => a.order - b.order);
            return html`<section class="collection-pane${cat === tab.findings ? ' active' : ''}" data-pane>
              <div class="section-head collection-pane-head"><h2 class="heading-20">${cat}</h2><span class="label-13 secondary">${count(cat)}</span></div>
              ${shown.length
                ? html`<div data-search-section><div class="finding-grid">${shown.map((f) => findingTile(f, owned.has(f.id)))}</div></div>`
                : html`<p class="copy-14 secondary">${show.findings === 'have' ? 'None collected here yet.' : 'All collected here.'}</p>`}
            </section>`;
          })}
          <p class="copy-14 secondary list-search-empty" hidden>Nothing matches your search.</p>
        </div>
      </div>
      ${credit(data.attribution, 'https://endfield.wiki.gg/wiki/Intel_Archives')}
    </main>`;
}

const paintToggle = (b: HTMLElement, on: boolean, yes: string, no: string) => {
  b.setAttribute('aria-pressed', String(on));
  render(b, html`${icon(on ? 'check_circle' : 'add')}${on ? yes : no}`);
};

/** A finding's text and picture, in a dialog over the page. */
function openFinding(id: string): void {
  const f = findingFile?.findings.find((x) => x.id === id);
  if (!f) return;
  document.querySelector('.finding-dialog')?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'card finding-dialog';
  const got = findingsOwned().has(f.id);
  render(
    dlg,
    html`<div class="finding-dialog-head">
        <div class="min0">
          <div class="label-13 secondary">${[f.category, f.type, f.region, f.area, f.unlock].filter(Boolean).join(' · ')}</div>
          <h2 class="heading-24">${f.name}</h2>
        </div>
        <button type="button" class="btn tertiary sm" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <div class="finding-dialog-body">
        ${f.image ? html`<img class="finding-picture" src="${f.image}" alt="" decoding="async" />` : ''}
        ${f.text ? html`<div class="copy-14 finding-text">${f.text.split(/\n{2,}/).map((p) => html`<p>${lines(p)}</p>`)}</div>` : html`<p class="copy-14 secondary">No text on the wiki yet.</p>`}
      </div>
      <div class="finding-dialog-foot">
        <button type="button" class="have-toggle" data-action="finding-toggle" data-value="${f.id}" aria-pressed="${String(got)}">${icon(got ? 'check_circle' : 'add')}${got ? 'Collected' : 'Mark collected'}</button>
        <a class="copy-13" href="https://endfield.wiki.gg/wiki/${encodeURIComponent(f.name.replace(/ /g, '_'))}" target="_blank" rel="noopener">Wiki page</a>
      </div>`,
  );
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => {
    // The close button, or a click on the backdrop (outside the box).
    if ((e.target as HTMLElement).closest('[data-close]') || e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
