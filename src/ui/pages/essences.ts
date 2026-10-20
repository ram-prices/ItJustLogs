import { ALL_STATS, STAT_ALIASES, byFit, fitOf, parseEssenceKey, type EssenceStat } from '../../domain/essences';
import type { WikiWeapon, WikiWeaponFile } from '../../domain/wiki';
import { state } from '../../state';
import { icon, itemImg, pageHeader, rarity, toggleGroup } from '../components';
import { html, type Html } from '../html';
import { credit, infoHref, ownedOf, wikiFile } from './info';
import { searchBox } from './search';
import { subTabs } from './collections';

/**
 * Essences: the player's essences (read from the game: ui/essenceReader.ts)
 * against every weapon's skill stats. Only perfect fits count: an essence
 * with every stat the weapon wants. "By weapon" lists each weapon with the
 * essences that fit it (most levels first); "By essence" lists each kind of
 * essence with the weapons it fits, and which fit none (safe to use for
 * etching). Works without an
 * import; with one, it starts from the weapons the player owns.
 */

type View = 'By weapon' | 'By essence';
const VIEWS: View[] = ['By weapon', 'By essence'];
let view: View = 'By weapon';
let weaponsShown: 'owned' | 'all' | null = null;
let essencesShown: 'all' | 'fits' | 'none' = 'all';

/** The stats a weapon's skills want: each skill's tag (its stat), known names only. */
export function wantsOf(w: WikiWeapon): string[] {
  return w.skills
    .map((s) => s.tag ?? s.name)
    .map((t) => STAT_ALIASES[t] ?? t)
    .filter((t) => ALL_STATS.includes(t));
}

/** The pages' clicks (app.ts passes them on, then redraws). True if it was one of theirs. */
export function essenceAction(action: string, el: HTMLElement): boolean {
  const v = el.dataset.value ?? '';
  if (action === 'essence-view') view = v as View;
  else if (action === 'essence-weapons') weaponsShown = v as 'owned' | 'all';
  else if (action === 'essence-show') essencesShown = v as 'all' | 'fits' | 'none';
  else return false;
  return true;
}

const statChips = (stats: EssenceStat[], hit: string[] = []): Html =>
  html`<span class="essence-stats">${stats.map(([s, l]) => html`<span class="essence-stat${hit.includes(s) ? ' hit' : ''}">${s} <b>+${l}</b></span>`)}</span>`;

export function essencesPage(redraw: () => void): Html {
  const file = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  const stash = state.settings.essences ?? {};
  const kinds = Object.entries(stash).map(([key, n]) => ({ key, n, stats: parseEssenceKey(key) }));
  const total = kinds.reduce((s, k) => s + k.n, 0);
  const owned = ownedOf(state.analysis, 'weap');
  const read = state.settings.essencesRead ? new Date(state.settings.essencesRead).toLocaleDateString() : null;
  const header = pageHeader(
    'Essences',
    kinds.length
      ? `${total} essences (${kinds.length} different), read ${read ?? 'from the game'}. Which weapons each one fits. Paste or drop a new recording to update them.`
      : 'Which weapons your essences fit. Read them from a recording of the game: Valuables → Essences, selecting each one, or Etch Essence.',
    html`<button type="button" class="btn secondary sm" data-action="essence-read" title="Read your essences from a recording or screenshots of Valuables → Essences or Etch Essence. You can also paste (Ctrl+V) or drop them on this page">${icon('document_scanner')}Read from video or screenshots</button>`,
  );
  if (!kinds.length)
    return html`${header}<main class="container fade-in">
        <section class="card"><div class="card-body">
          <h2 class="heading-20">No essences yet</h2>
          <p class="copy-14">Record the game while you go through your essences, then paste, drop or pick the recording here. It's read in this browser; nothing is uploaded.</p>
          <ol class="copy-14 essence-how">
            <li><b>Valuables → Essences:</b> select each essence in turn (arrow keys work), so its Essence Stats panel shows.</li>
            <li><b>Or Etch Essence:</b> step through the materials at the bottom; the card on the left shows each one's stats.</li>
          </ol>
          <p class="copy-13 secondary">Any screen size works. A slower pace reads better; a quarter of a second per essence is enough.</p>
        </div></section>
      </main>`;
  if (!file.data) return html`${header}<main class="container fade-in"><p class="copy-14 secondary">Loading weapons…</p></main>`;

  const weapons = Object.entries(file.data.weapons)
    .map(([id, w]) => ({ id, w, wants: wantsOf(w), mine: owned?.get(id)?.copies ? owned.get(id)! : null }))
    .filter((x) => x.wants.length >= 2);
  // Start from the weapons the player owns, if they own any (story extras alone own no weapons).
  const ownsSome = weapons.some((x) => x.mine);
  const shownWeapons = ownsSome ? (weaponsShown ?? 'owned') : 'all';
  const pool = shownWeapons === 'owned' ? weapons.filter((x) => x.mine) : weapons;

  const byWeapon = () =>
    html`<div class="section-head wiki-sort-head">${searchBox('essence-weapons', 'Search weapons')}${ownsSome ? toggleGroup('essence-weapons', [['owned', 'Owned'], ['all', 'All weapons']], shownWeapons) : ''}</div>
      <div data-search-section class="essence-list">
        ${[...pool]
          .sort((a, b) => b.w.rarity - a.w.rarity || a.w.name.localeCompare(b.w.name))
          .map(({ id, w, wants }) => {
            // Only essences with every stat it wants (the best levels first): a partial fit isn't worth suggesting.
            const full = kinds.map((k) => ({ k, fit: fitOf(k.stats, wants) })).filter((x) => x.fit.full).sort((a, b) => byFit(a.fit, b.fit));
            const show = full.slice(0, 3);
            const more = full.length - show.length;
            return html`<div class="card essence-weapon" data-search-item>
              <a class="essence-weapon-head" href="${infoHref('weap', id)}">
                ${itemImg('weap', id, 'essence-weapon-icon')}
                <span class="min0"><span class="essence-weapon-name">${w.name}</span><span class="label-12 secondary">${rarity(w.rarity)} · ${w.type}</span></span>
              </a>
              <div class="essence-wants label-12 secondary">Wants ${statChips(wants.map((s) => [s, 0] as EssenceStat), wants)}</div>
              <div class="essence-best">
                ${show.length
                  ? html`<span class="label-12 secondary">${full.length} ${full.length === 1 ? 'essence fits' : 'essences fit'}</span>
                      ${show.map(({ k }) => html`<div class="essence-row">${statChips(k.stats, wants)}${k.n > 1 ? html`<span class="num secondary">×${k.n}</span>` : ''}</div>`)}
                      ${more > 0 ? html`<span class="label-12 secondary">and ${more} more</span>` : ''}`
                  : html`<span class="copy-13 secondary">None of your essences has all its stats yet.</span>`}
              </div>
            </div>`;
          })}
      </div>
      <p class="copy-14 secondary list-search-empty" hidden>No weapons match your search.</p>`;

  const byEssence = () => {
    const rows = kinds
      .map((k) => {
        const fits = weapons.map((x) => ({ x, fit: fitOf(k.stats, x.wants) })).filter((f) => f.fit.full);
        // Owned weapons first, then rarity.
        fits.sort((a, b) => Number(!!b.x.mine) - Number(!!a.x.mine) || b.x.w.rarity - a.x.w.rarity);
        return { k, fits };
      })
      .filter((r) => (essencesShown === 'fits' ? r.fits.length : essencesShown === 'none' ? !r.fits.length : true))
      .sort((a, b) => b.fits.length - a.fits.length || b.k.n - a.k.n);
    return html`<div class="section-head wiki-sort-head">${searchBox('essence-kinds', 'Search essences')}${toggleGroup('essence-show', [['all', 'All'], ['fits', 'Fit a weapon'], ['none', 'Fit nothing']], essencesShown)}</div>
      <div data-search-section class="essence-list">
        ${rows.map(
          ({ k, fits }) => html`<div class="card essence-kind" data-search-item>
            <div class="essence-row">${statChips(k.stats)}<span class="num secondary">×${k.n}</span></div>
            <div class="essence-fits copy-13">
              ${fits.length
                ? fits.map(({ x }) => html`<a class="essence-fit-weapon${x.mine ? ' mine' : ''}" href="${infoHref('weap', x.id)}" title="${x.mine ? 'You have this weapon' : ''}">${itemImg('weap', x.id, 'essence-fit-icon')}${x.w.name}</a>`)
                : html`<span class="secondary">Fits no weapon fully: fine to use for etching.</span>`}
            </div>
          </div>`,
        )}
      </div>
      <p class="copy-14 secondary list-search-empty" hidden>No essences match your search.</p>`;
  };

  return html`${header}
    <main class="container fade-in">
      <div class="collection-layout">
        ${subTabs('essence-view', VIEWS, view, (v) => (v === 'By weapon' ? String(pool.length) : String(kinds.length)))}
        <div class="min0 collection-panes">${view === 'By weapon' ? byWeapon() : byEssence()}</div>
      </div>
      ${credit(file.data.attribution)}
    </main>`;
}
