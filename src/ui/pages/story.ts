import { storyOrder, storySlugs, type StoryIndex, type StoryLine, type StoryMission, type StorySection } from '../../domain/story';
import { endministratorOf, extrasOf } from '../../domain/owned';
import { state } from '../../state';
import { icon, itemImg, pageHeader } from '../components';
import { html, type Html } from '../html';
import { external, rich, wikiFile } from './info';

/**
 * Story (/story, /story/<mission>): every mission's dialogue from the
 * game's own text (ef-assets story/), listed as the wiki orders the
 * missions. A mission's page shows its scenes: the game's summary of each,
 * every line with who says it, and the replies the player can pick. Sections
 * the wiki doesn't index yet are folded away, since they may be unreleased.
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
  <span>${ix.attribution.note}. Text from the ${external(ix.attribution.url, 'EndfieldData')} community dump (${external(ix.attribution.dumper, 'EndfieldDataDumper')}), snapshot of ${ix.attribution.fetched}.</span>
</p>`;

function listPage(ix: StoryIndex): Html {
  const slugs = storySlugs(ix).byId;
  const row = (id: string) => {
    const m = ix.missions[id];
    return html`<a class="story-row" href="/story/${slugs.get(id)}">
      <span class="story-row-name ellipsis">${m.name}</span>
      <span class="label-12 secondary num">${m.lines} lines${m.partial ? ' · partly in English' : ''}</span>
      ${icon('chevron_right')}
    </a>`;
  };
  const section = (s: StorySection) => html`${s.title ? html`<h3 class="wiki-skill-type">${s.title}</h3>` : ''}<div class="card story-list">${s.missions.map(row)}</div>`;
  return html`${pageHeader('Story', "Every mission's dialogue, from the game's own text. It tells the whole story: spoilers for anything you haven't played.")}
    <main class="container fade-in">
      ${ix.groups.map((g) => {
        const listed = g.sections.filter((s) => !s.unlisted);
        const unlisted = g.sections.filter((s) => s.unlisted);
        const n = (list: StorySection[]) => list.reduce((sum, s) => sum + s.missions.length, 0);
        return html`<section class="section">
          <div class="section-head"><h2 class="heading-20">${g.title}</h2><span class="label-13 secondary">${n(g.sections)} missions</span></div>
          ${listed.map(section)}
          ${unlisted.length
            ? html`<details class="story-unlisted">
                <summary class="label-13">Not in the wiki's index yet · ${n(unlisted)} missions. They may be unreleased: spoilers.</summary>
                ${unlisted.map((s) => section({ ...s, title: '' }))}
              </details>`
            : ''}
        </section>`;
      })}
      ${credit(ix)}
    </main>`;
}

/** A spoken line with its speaker (an operator's portrait, else their initial), or narration. Worded for the player's Endministrator. */
function line(l: StoryLine, male: boolean): Html {
  const text = (male && l.textM) || l.text;
  if (!l.who) return html`<p class="story-narr copy-14 secondary wiki-text">${rich(text)}</p>`;
  return html`<div class="story-line">
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
          <div class="card story-lines">${s.lines.map((l) => line(l, male))}</div>
          ${s.options?.length
            ? html`<div class="story-options"><span class="label-12 secondary">Replies in this scene</span>${s.options.flat().map((o) => html`<span class="story-option copy-13">${rich(o)}</span>`)}</div>`
            : ''}
        </section>`,
      )}
      ${nav}
      ${credit(ix)}
    </main>`;
}
