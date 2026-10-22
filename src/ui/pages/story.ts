import { lineAnchor, storyOrder, storySlugs, type StoryIndex, type StoryLine, type StoryMission, type StorySearch, type StorySection } from '../../domain/story';
import { loadWikiFile } from '../../store';
import { endministratorOf, extrasOf } from '../../domain/owned';
import { state } from '../../state';
import { icon, itemImg, pageHeader } from '../components';
import { html, render, type Html } from '../html';
import { rich, wikiFile } from './info';
import { fold, searchField } from './search';

/**
 * Story (/story, /story/<mission>): every mission's dialogue from the
 * game's own text (ef-assets story/), listed as the wiki orders the
 * missions. A mission's page shows its scenes: the game's summary of each,
 * every line with who says it, and the replies the player can pick. The
 * list's search filters missions by name and chapter, and from 3 letters on
 * also lists the lines that contain every word typed (story/search.json,
 * loaded on the first such search); a line opens its mission at that line.
 */

const indexOf = (redraw: () => void) => wikiFile<StoryIndex>('index.json', redraw, 'story');

/** The tab's title: the mission's name, else Story. */
export function storyTitle(slug: string | undefined): string {
  const ix = indexOf(() => {}).data;
  const id = ix && slug ? storySlugs(ix).bySlug.get(slug.toLowerCase()) : undefined;
  return ix && id ? ix.missions[id].name : 'Story';
}

export function storyPage(slug: string | undefined, redraw: () => void): Html {
  const ix = indexOf(redraw);
  if (!ix.data) return status('Story', ix.failed ? "Couldn't load the story data. Check your connection and reload." : 'Loading…');
  if (!slug) return listPage(ix.data);
  const id = storySlugs(ix.data).bySlug.get(slug.toLowerCase());
  if (!id) return status('Story', html`There's no mission at <b>/story/${slug}</b>. <a href="/story">See every mission</a>.`);
  const m = wikiFile<StoryMission>(`${id}.json`, redraw, 'story');
  if (!m.data) return status(ix.data.missions[id].name, m.failed ? "Couldn't load this mission's text. Check your connection and reload." : 'Loading…', crumbs());
  return missionPage(ix.data, id, m.data);
}

const status = (title: string, message: Html | string, crumb?: Html): Html => html`${pageHeader(title, message, undefined, crumb)}<main class="container"></main>`;

const crumbs = (where?: string): Html =>
  html`<div class="story-crumbs label-13 secondary"><a href="/story">Story</a>${where ? html`${icon('chevron_right')}<span>${where}</span>` : ''}</div>`;

const credit = (ix: StoryIndex): Html => html`<p class="wiki-credit copy-13">
  ${icon('menu_book')}
  <span>${ix.attribution.note}.</span>
</p>`;

function listPage(ix: StoryIndex): Html {
  const slugs = storySlugs(ix).byId;
  // Missions the wiki doesn't index yet sit with the rest, under no heading of their own.
  const titleOf = (s: StorySection) => (s.unlisted ? '' : s.title);
  const row = (id: string, where: string) => {
    const m = ix.missions[id];
    return html`<a class="story-row" href="/story/${slugs.get(id)}" data-search-item>
      <span class="story-row-name ellipsis">${m.name}</span>
      <span class="label-12 secondary num">${m.lines} lines${m.partial ? ' · partly in English' : ''}</span>
      ${icon('chevron_right')}
      <span class="story-row-where">${where}</span>
    </a>`;
  };
  const n = (list: StorySection[]) => list.reduce((sum, s) => sum + s.missions.length, 0);
  return html`${pageHeader('Story', "Every mission's dialogue, from the game's own text. It tells the whole story: spoilers for anything you haven't played.")}
    <main class="container fade-in">
      ${searchField('story', 'Search missions and dialogue')}
      <div class="story-hits" id="storyHits"></div>
      ${ix.groups.map(
        (g) => html`<section class="section" data-search-section>
          <div class="section-head"><h2 class="heading-20">${g.title}</h2><span class="label-13 secondary"><span class="wiki-count">${n(g.sections)}</span> missions</span></div>
          ${g.sections.map(
            (s) => html`<div data-search-section>
              ${titleOf(s) ? html`<h3 class="wiki-skill-type">${titleOf(s)}</h3>` : ''}
              <div class="card story-list">${s.missions.map((id) => row(id, [g.title, titleOf(s)].filter(Boolean).join(' ')))}</div>
            </div>`,
          )}
        </section>`,
      )}
      <p class="copy-14 secondary list-search-empty" hidden>No missions match your search.</p>
      ${credit(ix)}
    </main>`;
}

/** A spoken line with its speaker (an operator's portrait, else their initial), or narration. Worded for the player's Endministrator. */
function line(l: StoryLine, male: boolean, anchor: string): Html {
  const text = (male && l.textM) || l.text;
  if (!l.who) return html`<p class="story-narr copy-14 secondary wiki-text" id="${anchor}">${rich(text)}</p>`;
  return html`<div class="story-line" id="${anchor}">
    ${l.actor ? itemImg('char', l.actor, 'story-face') : html`<span class="story-face story-face-none" aria-hidden="true">${l.who.slice(0, 1)}</span>`}
    <div class="min0"><div class="story-who">${l.who}</div><div class="copy-14 wiki-text story-text">${rich(text)}</div></div>
  </div>`;
}

function missionPage(ix: StoryIndex, id: string, m: StoryMission): Html {
  const order = storyOrder(ix);
  const slugs = storySlugs(ix).byId;
  const at = order.indexOf(id);
  const place = ix.groups.flatMap((g) => g.sections.map((s) => ({ g, s }))).find((x) => x.s.missions.includes(id));
  const where = place ? [place.g.title, place.s.title].filter(Boolean).join(' · ') : '';
  const link = (j: number, next: boolean) => {
    const o = order[j];
    return o ? html`<a class="btn secondary sm story-nav-link" href="/story/${slugs.get(o)}">${next ? '' : '← '}${ix.missions[o].name}${next ? ' →' : ''}</a>` : html`<span></span>`;
  };
  const nav = html`<nav class="story-nav" aria-label="Missions">${link(at - 1, false)}${link(at + 1, true)}</nav>`;
  // Lines worded by the Endministrator's gender follow the one in Extra copies (the female until chosen).
  const male = endministratorOf(extrasOf(state.settings)) === 'chr_0002_endminm';
  return html`${pageHeader(m.name, `${m.scenes.length} scene${m.scenes.length === 1 ? '' : 's'} · ${ix.missions[id].lines} lines${m.partial ? ' · some lines have no English text yet' : ''}`, undefined, crumbs(where))}
    <main class="container fade-in story-page">
      ${m.scenes.map(
        (s, k) => html`<section class="section story-scene">
          <div class="section-head"><h2 class="heading-20">Scene ${k + 1}</h2></div>
          ${s.summary ? html`<p class="copy-14 secondary story-summary">${rich(s.summary)}</p>` : ''}
          <div class="card story-lines">${s.lines.map((l, i) => line(l, male, lineAnchor(k, i)))}</div>
          ${s.options?.length
            ? html`<div class="story-options"><span class="label-12 secondary">Replies in this scene</span>${s.options.flat().map((o) => html`<span class="story-option copy-13">${rich(o)}</span>`)}</div>`
            : ''}
        </section>`,
      )}
      ${nav}
      ${credit(ix)}
    </main>`;
}

// ---------------------------------------------------------------------------
// Searching the dialogue
// ---------------------------------------------------------------------------

/** How many lines the results show (the rest are counted). */
const MAX_HITS = 60;
let searchFile: StorySearch | null = null;
let searchLoading = false;

/** The matching lines for what's typed in the Story search, under the field. */
function showHits(query: string): void {
  const box = document.getElementById('storyHits');
  if (!box) return;
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (fold(query).replace(/\s/g, '').length < 3) return render(box, html``);
  if (!searchFile) {
    render(box, html`<p class="copy-13 secondary">Searching the dialogue…</p>`);
    if (!searchLoading) {
      searchLoading = true;
      loadWikiFile<StorySearch>('search.json', 'story').then(
        (f) => {
          searchFile = f;
          const input = document.querySelector<HTMLInputElement>('[data-list-search="story"]');
          if (input) showHits(input.value);
        },
        () => {
          searchLoading = false;
          render(box, html`<p class="copy-13 secondary">Couldn't load the dialogue to search. Check your connection and try again.</p>`);
        },
      );
    }
    return;
  }
  const ix = indexOf(() => {}).data;
  if (!ix) return;
  const slugs = storySlugs(ix).byId;
  const hits: { id: string; scene: number; line: number; text: string }[] = [];
  let total = 0;
  const missions = new Set<string>();
  for (const id of storyOrder(ix)) {
    (searchFile[id] ?? []).forEach((lines, scene) =>
      lines.forEach((text, line) => {
        const t = fold(text);
        if (!words.every((w) => t.includes(w))) return;
        total++;
        missions.add(id);
        if (hits.length < MAX_HITS) hits.push({ id, scene, line, text });
      }),
    );
  }
  // Nothing in the titles or the lines: the page's "nothing matches" says so; lines found: it doesn't.
  const empty = document.querySelector<HTMLElement>('.list-search-empty');
  if (empty && total) empty.hidden = true;
  if (!total) return render(box, html``);
  render(
    box,
    html`<div class="section-head"><h2 class="heading-20">In the dialogue</h2><span class="label-13 secondary">${total} line${total === 1 ? '' : 's'} in ${missions.size} mission${missions.size === 1 ? '' : 's'}${total > hits.length ? `, first ${hits.length} shown` : ''}</span></div>
      <div class="card story-list">${hits.map(
        (h) => html`<a class="story-hit" href="/story/${slugs.get(h.id)}#${lineAnchor(h.scene, h.line)}">
          <span class="label-12 secondary">${ix.missions[h.id].name} · scene ${h.scene + 1}</span>
          <span class="copy-14 story-hit-text">${marked(h.text, words)}</span>
        </a>`,
      )}</div>`,
  );
}

/** A line around its first match (long ones trimmed), with every typed word marked. */
function marked(text: string, words: string[]): Html {
  const folded = fold(text);
  const first = Math.min(...words.map((w) => folded.indexOf(w)).filter((i) => i >= 0));
  const from = first > 90 ? text.lastIndexOf(' ', first - 60) + 1 : 0;
  const shown = (from ? '…' : '') + text.slice(from);
  const lower = fold(shown);
  const marks: [number, number][] = [];
  for (const w of words) for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + w.length)) marks.push([i, i + w.length]);
  marks.sort((a, b) => a[0] - b[0]);
  const parts: Html[] = [];
  let at = 0;
  for (const [a, b] of marks) {
    if (a < at) continue;
    parts.push(html`${shown.slice(at, a)}<mark>${shown.slice(a, b)}</mark>`);
    at = b;
  }
  parts.push(html`${shown.slice(at)}`);
  return html`${parts}`;
}

// The Story search's field: lines as it changes, and again when the list redraws.
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset?.listSearch === 'story') showHits(el.value);
});

/** After a redraw of the list (app.ts draw): its line results again, for what's in the field. */
export function refreshStoryHits(): void {
  const input = document.querySelector<HTMLInputElement>('[data-list-search="story"]');
  if (input?.value) showHits(input.value);
}

