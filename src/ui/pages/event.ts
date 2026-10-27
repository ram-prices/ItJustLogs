import { cdnUrl } from '../../domain/banners';
import { fmtPulls, pullsOf, withWikiEnds, type EventRewards, type EventRewardsFile, type Reward } from '../../domain/eventRewards';
import { claimDaysLeft } from '../../domain/income';
import { hasDailyRewards, SERVER_LABEL, timeOn, type Schedule, type Server, type ScheduleEvent } from '../../domain/schedule';
import { currentServer, state } from '../../state';
import { badge, icon, itemName } from '../components';
import { fmtDate, fmtInt, html, type Html } from '../html';
import { tip, tipNote } from '../charts';
import { credit, external, wikiFile } from './info';
import { storySlugs, type StoryIndex } from '../../domain/story';

/**
 * /event/<id>: one event, with its rewards written out (ef-assets
 * wiki/events.json, from endfield.wiki.gg). At the top, what they come to in
 * pulls (Oroberyl over a pull's cost, plus HH Permits); then every item in
 * all; then the rewards mission by mission, day by day. Events whose wiki
 * page names rewards without amounts say so: their totals are "at least".
 * An event the update notes leave open-ended takes the wiki's end, and one
 * the wiki splits into phases lists them, with the one running now marked.
 */

export const eventOf = (id: string | undefined, file?: EventRewardsFile | null): ScheduleEvent | undefined =>
  id === undefined ? undefined : withWikiEnds(state.schedule, file).events?.find((e) => String(e.id) === id);

/**
 * An event's tags (Home's rows and its own page): Limited or Permanent (the
 * wiki's page says whether it stays playable), Limited-Time Rewards for a
 * permanent one whose rewards still end, Daily Rewards (with how long there's
 * left to start them and still get them all), and Unique when it hands out
 * portraits, frames, stickers, operators and the like (`items`: named after
 * it, else on hover).
 */
export function eventTags(e: ScheduleEvent, r: EventRewards | undefined, now: number, server: Server, schedule: Schedule, items = false): Html {
  const tags: Html[] = [r?.permanent ? badge('Permanent', 'green') : badge('Limited', 'amber')];
  if (r?.permanent && r.limitedRewards) tags.push(badge('Limited-Time Rewards', 'amber'));
  if (hasDailyRewards(e, schedule)) {
    const start = timeOn(e.start, server);
    const end = timeOn(e.end, server);
    const days = r?.days;
    let when = '';
    if (days && start != null && now < start) when = `${days} days`;
    else if (days && end != null) {
      const left = claimDaysLeft(now, end, server);
      // Days to start in and still claim every one: today counts.
      const spare = left - days;
      when = spare > 0 ? `start within ${spare + 1} days` : spare === 0 ? 'start today' : `${left} ${left === 1 ? 'day' : 'days'} left`;
    }
    tags.push(html`${badge('Daily Rewards', 'blue')}${when ? html`<span class="evt-tag-note">${when}</span>` : ''}`);
  }
  if (r?.unique?.length)
    tags.push(
      items
        ? html`${badge('Unique', 'purple')}<span class="evt-tag-note">${r.unique.join(', ')}</span>`
        : html`<span data-tip="${tip('Unique', [tipNote(r.unique.join(', '))])}">${badge('Unique', 'purple')}</span>`,
    );
  return html`<div class="sched-next-tags">${tags}</div>`;
}

/** The event's phases with their dates on the player's server: each until the next starts, the last until the event ends. */
function phases(r: EventRewards, e: ScheduleEvent, server: Server): Html {
  if (!r.phases?.length) return html``;
  const now = Date.now();
  const starts = r.phases.map((p) => timeOn(p.start ?? e.start, server));
  const ends = [...starts.slice(1), timeOn(e.end, server)];
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Phases</h2></div>
    <div class="card event-phases">
      ${r.phases.map((p, i) => {
        const from = starts[i];
        const to = ends[i];
        const live = from != null && from <= now && (to == null || now < to);
        return html`<div class="event-phase">
          <div class="event-phase-head">
            <b>${p.name}</b>${live ? badge('Now', 'green') : ''}
            <span class="label-13 secondary">${from ? fmtDate(from, true) : 'Not announced'} – ${to ? fmtDate(to, true) : 'end TBA'}</span>
          </div>
          ${p.about ? html`<p class="copy-14">${p.about}</p>` : ''}
        </div>`;
      })}
    </div>
  </section>`;
}

const count = ([, n]: Reward) => (n === null ? '' : `×${fmtInt(n)}`);

function rewardChips(rewards: Reward[]): Html {
  return html`<span class="reward-chips">${rewards.map((r) => html`<span class="reward-chip${/oroberyl|origeometry|hh permit|arsenal ticket/i.test(r[0]) ? ' currency' : ''}">${itemName(r[0])} <b>${count(r)}</b></span>`)}</span>`;
}

function summary(r: EventRewards): Html {
  const p = pullsOf(r.totals);
  const atLeast = r.partial ? 'at least ' : '';
  const parts: Html[] = [];
  if (p.oroberyl) parts.push(html`<div class="metric"><div class="metric-label"><span>${itemName('Oroberyl')}</span></div><div class="metric-value num">${atLeast ? '≥ ' : ''}${fmtInt(p.oroberyl)}</div><div class="metric-sub">${fmtPulls(p.fromOroberyl)} pulls</div></div>`);
  for (const [name, n] of p.permits)
    parts.push(html`<div class="metric"><div class="metric-label"><span>${name}</span></div><div class="metric-value num">${fmtInt(n)}</div><div class="metric-sub">${n === 1 ? 'pull' : 'pulls'}</div></div>`);
  if (p.basicPermits)
    parts.push(html`<div class="metric"><div class="metric-label"><span>Basic HH Permit</span></div><div class="metric-value num">${fmtInt(p.basicPermits)}</div><div class="metric-sub">Basic Headhunting only</div></div>`);
  if (p.arsenalTickets) parts.push(html`<div class="metric"><div class="metric-label"><span>Arsenal Tickets</span></div><div class="metric-value num">${fmtInt(p.arsenalTickets)}</div></div>`);
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">${p.oroberyl ? 'Total Oroberyls' : 'Pulls'}</h2>${r.partial ? badge('Partial', 'amber') : ''}</div>
    ${r.partial ? html`<p class="copy-14 secondary event-partial">The wiki lists some of this event's rewards without amounts, so these totals are what's known so far.</p>` : ''}
    ${parts.length ? html`<div class="metrics event-metrics">${parts}</div>` : ''}
  </section>`;
}

function allItems(r: EventRewards): Html {
  const named = new Set(r.groups.flatMap((g) => g.rows.flatMap((row) => row.rewards.map(([n]) => n))));
  const items: Reward[] = [...named].map((n) => [n, r.totals[n] ?? null]);
  items.sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Rewards</h2><span class="label-13 secondary">${items.length} items</span></div>
    <div class="card"><div class="card-body">${rewardChips(items)}</div></div>
  </section>`;
}

function breakdown(r: EventRewards): Html {
  return html`${r.groups.map(
    (g) => html`<section class="section">
      <div class="section-head"><h2 class="heading-20">${g.title}</h2>${g.partial ? badge('Partial', 'amber') : ''}</div>
      ${g.exchange ? html`<p class="copy-14 secondary event-partial">Bought with ${g.exchange}, which only this event hands out. Counted as if you buy the whole stock.</p>` : ''}
      <div class="card event-rows">
        ${g.rows.map(
          (row) => html`<div class="event-row">
            <div class="event-row-label">${row.label}</div>
            ${rewardChips(row.rewards)}
          </div>`,
        )}
      </div>
    </section>`,
  )}`;
}

/** The event's own story missions (the Story tab's pages), when the game's tables name them. */
function storySection(name: string, redraw: () => void): Html {
  const ix = wikiFile<StoryIndex>('index.json', redraw, 'story').data;
  const ids = ix?.activities?.[name]?.filter((id) => ix.missions[id]);
  if (!ix || !ids?.length) return html``;
  const slugs = storySlugs(ix).byId;
  return html`<section class="section">
    <div class="section-head"><h2 class="heading-20">Story</h2><span class="label-13 secondary">${ids.length} mission${ids.length === 1 ? '' : 's'}</span></div>
    <div class="card story-list">
      ${ids.map(
        (id) => html`<a class="story-row" href="/story/${slugs.get(id)}">
          <span class="story-row-name ellipsis">${ix.missions[id].name}</span>
          <span class="label-12 secondary num">${ix.missions[id].lines} lines</span>
          ${icon('chevron_right')}
        </a>`,
      )}
    </div>
  </section>`;
}

export function eventPage(id: string | undefined, redraw: () => void): Html {
  const file = wikiFile<EventRewardsFile>('events.json', redraw);
  const e = eventOf(id, file.data);
  const server = currentServer();
  if (!e)
    return html`<div class="page-header"><div class="container page-header-inner"><div class="min0"><h1 class="heading-32">Event not found</h1>
        <p class="copy-16">There's no event with that link in the schedule. <a href="/">Back to Home</a>.</p></div></div></div>`;
  const r = file.data?.events[String(e.id)];
  const start = timeOn(e.start, server);
  const end = timeOn(e.end, server);
  const when = start ? `${fmtDate(start, true)}${end ? ` – ${fmtDate(end, true)}` : ''}` : 'Dates not announced';
  return html`<section class="wiki-hero event-hero${e.art ? ' has-art' : ''}">
      ${e.art ? html`<img class="wiki-hero-art" src="${cdnUrl(e.art)}" alt="" decoding="async" data-fallback />` : ''}
      <div class="container wiki-hero-inner">
        <div class="min0 wiki-hero-text">
          <nav class="breadcrumb wiki-crumbs" aria-label="Breadcrumb"><a href="/">Home</a>${icon('chevron_right')}<span class="wiki-em">${e.type}</span></nav>
          <h1 class="heading-32">${e.name}</h1>
          <div class="wiki-facts">
            <span class="wiki-fact"><span class="wiki-fact-label">When (${SERVER_LABEL[server]})</span>${when}</span>
            ${e.version ? html`<span class="wiki-fact"><span class="wiki-fact-label">Version</span>${e.version}</span>` : ''}
          </div>
          ${eventTags(e, r, Date.now(), server, state.schedule, true)}
        </div>
      </div>
    </section>
    <main class="container fade-in">
      ${e.details ? html`<p class="copy-16 event-details">${e.details.replace(/\[|\]/g, '')}</p>` : ''}
      ${r ? phases(r, e, server) : ''}
      ${storySection(e.name, redraw)}
      ${r
        ? r.groups.length
          ? html`${summary(r)}${allItems(r)}${breakdown(r)}
              <p class="copy-13 secondary">Rewards from the wiki's ${external(r.url, 'event page')}. Missing something? The wiki may not have the information yet.</p>`
          : html`<section class="section"><p class="copy-14 secondary">The wiki's page for this event doesn't list its rewards (yet). ${external(r.url, 'Open it')}.</p></section>`
        : file.data
          ? html`<section class="section"><p class="copy-14 secondary">This event has no page on the wiki yet, so its rewards aren't listed.</p></section>`
          : file.failed
            ? html`<section class="section"><p class="copy-14 secondary">Couldn't load the rewards. Check your connection and reload.</p></section>`
            : html`<section class="section"><p class="copy-14 secondary">Loading rewards…</p></section>`}
      ${file.data ? credit(file.data.attribution) : ''}
    </main>`;
}
