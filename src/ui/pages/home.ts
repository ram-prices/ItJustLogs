import type { Analysis, BannerSummary } from '../../domain/analyze';
import { bannerArtUrl, canonicalPoolId } from '../../domain/banners';
import {
  KIND_LABEL,
  SERVER_LABEL,
  discordText,
  endOrGuess,
  isWeaponBanner,
  packLanes,
  statusOf,
  timeOn,
  type Schedule,
  type ScheduleBanner,
  type ScheduleEvent,
  type Server,
} from '../../domain/schedule';
import { tip, tipRow } from '../charts';
import { toast } from '../common';
import { heat, icon } from '../components';
import { fmtInt, html, type Html } from '../html';
import { hourglass, rateUpChip, rateUpIcon, rateUpOwned } from './kind';

/**
 * Home: the banner and event schedule. What's open now (with your pity on
 * each banner), what's announced next, and a timeline of every version, banner
 * and event since launch. Built from ef-assets' schedule.json, so it works
 * before any import. Right-click or long-press anything to copy it for Discord.
 */

const DAY = 86_400_000;

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' });
const when = (ms: number) => dateFmt.format(ms);

/** "16d 4h", "5h 20m", "12m". */
function span(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** ef-assets' 1024px art when the pool is known, else the announcement cover. */
const artOf = (b: ScheduleBanner): string | null => (b.poolId && bannerArtUrl(b.poolId)) || b.art;

/** Your banner card for a schedule entry, if you've pulled on it. */
function summaryFor(b: ScheduleBanner, a: Analysis | null): BannerSummary | null {
  if (!a || !b.poolId) return null;
  return a.banners.find((s) => canonicalPoolId(s.poolId) === b.poolId) ?? null;
}

const pagePath = (b: ScheduleBanner) => `/${isWeaponBanner(b.kind) ? 'arsenal' : 'operators'}/${b.poolId}`;

function rateUpLine(b: ScheduleBanner): Html {
  if (!b.rateUps.length) return html``;
  return html`<span class="banner-rateup">${rateUpIcon()}<span class="ellipsis">${b.rateUps.join(', ')}</span></span>`;
}

/** An icon per event type ("Sign-In Event", "Challenge Event", ...). */
const EVENT_ICONS: [RegExp, string][] = [
  [/Sign-In/i, 'event_available'],
  [/Challenge/i, 'swords'],
  [/Guide/i, 'explore'],
  [/Narrative/i, 'menu_book'],
  [/Fun & Games/i, 'sports_esports'],
  [/Camera/i, 'photo_camera'],
  [/Supply/i, 'inventory_2'],
  [/Celebration/i, 'celebration'],
  [/AIC|Production/i, 'factory'],
  [/Exploration/i, 'rocket_launch'],
  [/Tribute/i, 'redeem'],
  [/Limited-Time/i, 'timer'],
];
const eventIcon = (e: ScheduleEvent) => EVENT_ICONS.find(([re]) => re.test(e.type))?.[1] ?? 'event';

/** The "Copy to Discord" text, stored on the element (see installDiscordMenu). */
const bannerDiscord = (b: ScheduleBanner, server: Server, now: number) => discordText(b, KIND_LABEL[b.kind], server, now, b.rateUps);
const eventDiscord = (e: ScheduleEvent, server: Server, now: number) => discordText(e, e.type, server, now);

// ---------------------------------------------------------------------------
// Open now
// ---------------------------------------------------------------------------

function liveCard(b: ScheduleBanner, now: number, server: Server, a: Analysis | null): Html {
  const start = timeOn(b.start, server)!;
  const end = timeOn(b.end, server);
  const src = artOf(b);
  const mine = summaryFor(b, a);
  const elapsed = end ? Math.min(1, (now - start) / (end - start)) : null;
  return html`<article class="card sched-card${isWeaponBanner(b.kind) ? ' weap' : ''}" data-discord="${bannerDiscord(b, server, now)}">
    <div class="banner-art">
      ${src ? html`<img src="${src}" alt="" loading="lazy" decoding="async" />` : ''}
      <div class="banner-art-text">
        <span class="sched-kind">${KIND_LABEL[b.kind]}</span>
        <div class="banner-name ellipsis">${b.name}</div>
        ${mine?.info ? rateUpChip(mine) : rateUpLine(b)}
      </div>
    </div>
    <div class="sched-body">
      <div class="sched-when">
        ${end
          ? html`<span>Ends in <b>${span(end - now)}</b></span><span class="tertiary">${when(end)}</span>`
          : html`<span>Open</span><span class="tertiary">End not announced yet</span>`}
      </div>
      <div class="progress"><i style="width:${(elapsed ?? 0.15) * 100}%;${elapsed == null ? 'opacity:0.4' : ''}"></i></div>
      ${mine
        ? html`<a class="sched-mine" href="${pagePath(b)}" style="color:${mine.pity.done ? 'var(--gray-700)' : heat(mine.pity.value, mine.pity.max)}">
            ${hourglass(mine.pity.done ? 1 : mine.pity.value / mine.pity.max)}<b>${mine.pity.done ? 'Done' : mine.pity.value}</b>${mine.pity.done ? '' : html`<i>/${mine.pity.max}</i>`}
            <span class="sched-mine-pulls">${fmtInt(mine.paidPulls)} pulls</span>${icon('chevron_right')}
          </a>`
        : ''}
    </div>
  </article>`;
}

// ---------------------------------------------------------------------------
// Rows: upcoming banners, and events (now and upcoming)
// ---------------------------------------------------------------------------

/** "in 10d 8h / Oct 29, 1:00 PM" for upcoming; "ends in ... / date" for open. */
function rowWhen(start: number | null, end: number | null, now: number): Html {
  if (start == null) return html`<span class="tertiary">Date not announced</span>`;
  if (now < start) return html`<b>in ${span(start - now)}</b><span class="tertiary">${when(start)}</span>`;
  if (end == null) return html`<b>Open</b><span class="tertiary">End not announced</span>`;
  return html`<b>ends in ${span(end - now)}</b><span class="tertiary">${when(end)}</span>`;
}

function bannerRow(b: ScheduleBanner, now: number, server: Server): Html {
  const start = timeOn(b.start, server);
  const src = artOf(b);
  return html`<div class="sched-next${isWeaponBanner(b.kind) ? ' weap' : ''}" data-discord="${bannerDiscord(b, server, now)}">
    ${src
      ? html`<div class="sched-thumb"><img src="${src}" alt="" loading="lazy" decoding="async" /></div>`
      : html`<div class="sched-thumb sched-date">${start ? html`<span>${monthFmt.format(start)}</span><b>${dayFmt.format(start)}</b>` : '?'}</div>`}
    <div class="sched-next-text min0">
      <div class="sched-next-name ellipsis">${b.name}</div>
      <div class="sched-next-meta ellipsis"><span>${KIND_LABEL[b.kind]}</span>${b.rateUps.length ? html` · ${rateUpIcon()} ${b.rateUps.join(', ')}` : ''}</div>
    </div>
    <div class="sched-next-when">${rowWhen(start, timeOn(b.end, server), now)}</div>
  </div>`;
}

function eventRow(e: ScheduleEvent, now: number, server: Server): Html {
  return html`<div class="sched-next evt" data-discord="${eventDiscord(e, server, now)}" ${e.details ? html`title="${e.details}"` : ''}>
    <div class="sched-thumb sched-evt-icon">${icon(eventIcon(e))}</div>
    <div class="sched-next-text min0">
      <div class="sched-next-name ellipsis">${e.name}</div>
      <div class="sched-next-meta ellipsis"><span>${e.type}</span></div>
    </div>
    <div class="sched-next-when">${rowWhen(timeOn(e.start, server), timeOn(e.end, server), now)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Pixels per day on the timeline. */
const PX_DAY = 14;
const LANE = 30;

interface Bar {
  start: number;
  /** null: not announced yet (the bar runs to the edge and fades). */
  end: number | null;
  name: string;
  cls: string;
  tip: string;
  discord: string;
  href?: string;
}

function timeline(schedule: Schedule, now: number, server: Server, a: Analysis | null): Html {
  const dated = schedule.banners.filter((b) => b.start);
  const events = (schedule.events ?? []).filter((e) => e.start);
  if (!dated.length) return html``;
  const releases = schedule.versions.map((v) => timeOn(v.release, server)).filter((t): t is number => t != null);
  const from = Math.min(...releases, ...dated.map((b) => timeOn(b.start, server)!)) - 3 * DAY;
  // Anything whose end isn't announced yet runs to the right edge and fades out.
  const to =
    Math.max(
      now,
      ...dated.map((b) => endOrGuess(b, server)!),
      ...events.map((e) => timeOn(e.end, server) ?? timeOn(e.start, server)!),
    ) +
    10 * DAY;
  const x = (t: number) => ((t - from) / DAY) * PX_DAY;
  const width = x(to);

  const bannerBar = (b: ScheduleBanner): Bar => {
    const start = timeOn(b.start, server)!;
    const end = timeOn(b.end, server);
    const mine = summaryFor(b, a);
    const rows = [
      tipRow('Type', KIND_LABEL[b.kind]),
      ...(b.rateUps.length ? [tipRow('Rate-up', b.rateUps.join(', '))] : []),
      ...(mine?.info ? [tipRow('You have it', rateUpOwned(mine) ? `Yes, ×${rateUpOwned(mine)}` : 'Not yet')] : []),
      tipRow('Opens', when(start)),
      tipRow('Ends', end == null ? 'Not announced' : when(end)),
      ...(mine ? [tipRow('Your pulls', fmtInt(mine.paidPulls))] : []),
    ];
    return {
      start,
      end,
      name: b.name,
      cls: `${isWeaponBanner(b.kind) ? 'weap' : 'op'} ${b.kind} ${statusOf(b, now, server)}${mine ? ' mine' : ''}`,
      tip: tip(b.name, rows),
      discord: bannerDiscord(b, server, now),
      href: mine ? pagePath(b) : undefined,
    };
  };
  const eventBar = (e: ScheduleEvent): Bar => {
    const start = timeOn(e.start, server)!;
    const end = timeOn(e.end, server);
    return {
      start,
      end,
      name: e.name,
      cls: `evt ${statusOf(e, now, server)}`,
      tip: tip(e.name, [tipRow('Type', e.type), tipRow('Opens', when(start)), tipRow('Ends', end == null ? 'Not announced' : when(end))]),
      discord: eventDiscord(e, server, now),
    };
  };

  const groups: [string, Bar[]][] = [
    ['Headhunting', dated.filter((b) => !isWeaponBanner(b.kind)).map(bannerBar)],
    ['Arsenal', dated.filter((b) => isWeaponBanner(b.kind)).map(bannerBar)],
    ['Events', events.map(eventBar)],
  ];

  // Version bands: from each release to the next.
  const versions = schedule.versions
    .map((v) => ({ name: v.name, start: timeOn(v.release, server) }))
    .filter((v): v is { name: string; start: number } => v.start != null)
    .sort((p, q) => p.start - q.start);
  const bands = versions.map((v, i) => {
    const end = versions[i + 1]?.start ?? to;
    return html`<div class="tl-band${i % 2 ? ' alt' : ''}${now >= v.start && now < end ? ' current' : ''}" style="left:${x(v.start)}px;width:${x(end) - x(v.start)}px">
      <span class="tl-band-name ellipsis" title="${v.name}">${v.name === 'Launch' ? 'Launch (1.0)' : v.name}</span>
    </div>`;
  });

  // Month ticks.
  const months: Html[] = [];
  const d = new Date(from);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  for (d.setMonth(d.getMonth() + 1); d.getTime() < to; d.setMonth(d.getMonth() + 1)) {
    months.push(html`<div class="tl-month" style="left:${x(d.getTime())}px"><span>${monthFmt.format(d)}${d.getMonth() === 0 ? ` ${d.getFullYear()}` : ''}</span></div>`);
  }

  const rows = groups
    .filter(([, bars]) => bars.length)
    .map(([label, bars]) => {
      const lanes = packLanes(bars.map((b) => ({ start: b.start, end: b.end ?? to })));
      const height = (Math.max(0, ...lanes) + 1) * LANE;
      return html`<div class="tl-row">
        <div class="tl-row-label">${label}</div>
        <div class="tl-lanes" style="height:${height}px">${bars.map((b, i) => {
          const left = x(b.start);
          const w = Math.max(6, x(b.end ?? to) - left);
          // --x/--w let the label slide along to stay in view (see .tl-bar > span).
          const style = `left:${left}px;width:${w}px;top:${lanes[i] * LANE + 4}px;--x:${left}px;--w:${w}px`;
          const cls = `tl-bar ${b.cls}${b.end == null ? ' open-end' : ''}`;
          const inner = html`<span class="ellipsis">${b.name}</span>`;
          return b.href
            ? html`<a class="${cls}" href="${b.href}" style="${style}" data-tip="${b.tip}" data-discord="${b.discord}">${inner}</a>`
            : html`<div class="${cls}" style="${style}" data-tip="${b.tip}" data-discord="${b.discord}">${inner}</div>`;
        })}</div>
      </div>`;
    });

  return html`<div class="card tl" data-now="${x(now)}">
    <div class="tl-scroll">
      <div class="tl-canvas" style="width:${width}px">
        <div class="tl-bands">${bands}${months}</div>
        <div class="tl-rows">${rows}</div>
        <div class="tl-now" style="left:${x(now)}px"><span>Today</span></div>
      </div>
    </div>
  </div>`;
}

/**
 * Keeps bar names in view: the timeline's scroll position goes into --sl,
 * which each bar's label uses to slide right while its bar starts off-screen.
 */
export function installTimelineLabels(): void {
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.classList.contains('tl-scroll')) el.style.setProperty('--sl', `${el.scrollLeft}px`);
    },
    true, // scroll doesn't bubble
  );
}

/** Opens the timeline scrolled so today sits about a third of the way in. */
export function scrollTimelineToNow(): void {
  const tl = document.querySelector<HTMLElement>('.tl');
  const scroller = tl?.querySelector<HTMLElement>('.tl-scroll');
  if (!tl || !scroller) return;
  scroller.scrollLeft = Number(tl.dataset.now) - scroller.clientWidth / 3;
}

// ---------------------------------------------------------------------------
// Copy to Discord: right-click, or long-press on touch screens
// ---------------------------------------------------------------------------

let menu: HTMLElement | null = null;

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

/** Copies text, falling back to a hidden textarea where the Clipboard API isn't allowed (plain http). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the old way */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function openMenu(x: number, y: number, text: string): void {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  btn.innerHTML = '<span class="icon" aria-hidden="true">content_copy</span>Copy to Discord';
  btn.addEventListener('click', async () => {
    closeMenu();
    const ok = await copyText(text);
    toast(ok ? 'Copied. Paste it in Discord to show the time for everyone.' : "Couldn't copy here.", ok ? 'info' : 'error');
  });
  menu.append(btn);
  document.body.append(menu);
  // Keep the menu on screen.
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  btn.focus();
}

/** Things on the Home page that can be copied (only Home has data-discord). */
const copyable = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-discord]') : null);

export function installDiscordMenu(): void {
  document.addEventListener('contextmenu', (e) => {
    const el = copyable(e.target);
    if (!el) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY, el.dataset.discord!);
  });

  // iOS Safari has no contextmenu event: open on a 500ms press instead, and
  // swallow the click that follows so a long-pressed link doesn't navigate.
  let timer = 0;
  let startXY: [number, number] | null = null;
  let swallowClick = false;
  document.addEventListener(
    'touchstart',
    (e) => {
      const el = copyable(e.target);
      if (!el || e.touches.length !== 1) return;
      const t = e.touches[0];
      startXY = [t.clientX, t.clientY];
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        swallowClick = true;
        openMenu(t.clientX, t.clientY, el.dataset.discord!);
      }, 500);
    },
    { passive: true },
  );
  const cancel = () => {
    clearTimeout(timer);
    startXY = null;
  };
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0];
      if (startXY && t && Math.hypot(t.clientX - startXY[0], t.clientY - startXY[1]) > 10) cancel();
    },
    { passive: true },
  );
  document.addEventListener('touchend', cancel, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });

  document.addEventListener(
    'click',
    (e) => {
      // The tap that ends a long-press: don't follow it, and keep the menu it opened.
      if (swallowClick && copyable(e.target)) {
        swallowClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      swallowClick = false;
      if (menu && !menu.contains(e.target as Node)) closeMenu();
    },
    true,
  );
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  addEventListener('scroll', closeMenu, true);
  addEventListener('resize', closeMenu);
}

// ---------------------------------------------------------------------------

export function homePage(schedule: Schedule, server: Server, a: Analysis | null): Html {
  const now = Date.now();
  const startOf = (i: { start: ScheduleBanner['start'] }) => timeOn(i.start, server) ?? Infinity;
  const byStart = (p: ScheduleBanner, q: ScheduleBanner) => startOf(p) - startOf(q) || Number(isWeaponBanner(p.kind)) - Number(isWeaponBanner(q.kind));
  // Headhunting banners first, then Arsenal Issues; each by when it opened.
  const live = schedule.banners
    .filter((b) => statusOf(b, now, server) === 'live')
    .sort((p, q) => Number(isWeaponBanner(p.kind)) - Number(isWeaponBanner(q.kind)) || byStart(p, q));
  const events = schedule.events ?? [];
  const liveEvents = events
    .filter((e) => statusOf(e, now, server) === 'live')
    .sort((p, q) => (timeOn(p.end, server) ?? Infinity) - (timeOn(q.end, server) ?? Infinity));
  // Coming up: banners and events together, soonest first.
  const next = [
    ...schedule.banners.filter((b) => statusOf(b, now, server) === 'upcoming').map((b) => ({ at: startOf(b), row: bannerRow(b, now, server) })),
    ...events.filter((e) => statusOf(e, now, server) === 'upcoming').map((e) => ({ at: startOf(e), row: eventRow(e, now, server) })),
  ].sort((p, q) => p.at - q.at);

  return html`
    <main class="container fade-in home" aria-label="Schedule for the ${SERVER_LABEL[server]} server">
      ${a
        ? ''
        : html`<div class="card sched-import">
            <span class="copy-14">Import your pull history to see your pity on each banner here.</span>
            <button class="btn primary sm" data-action="import">${icon('upload_file')}Import file</button>
          </div>`}
      <div class="sched-live">${live.map((b) => liveCard(b, now, server, a))}</div>

      ${liveEvents.length
        ? html`<div class="section">
            <div class="section-head"><h2 class="heading-20">Events now</h2><span class="label-13 secondary">${liveEvents.length} events, ending soonest first</span></div>
            <div class="card sched-next-list">${liveEvents.map((e) => eventRow(e, now, server))}</div>
          </div>`
        : ''}

      ${next.length
        ? html`<div class="section">
            <div class="section-head"><h2 class="heading-20">Coming up</h2></div>
            <div class="card sched-next-list">${next.map((n) => n.row)}</div>
          </div>`
        : ''}

      <div class="section">
        <div class="section-head"><h2 class="heading-20">Timeline</h2><span class="label-13 secondary">Every version, banner and event since launch</span></div>
        ${timeline(schedule, now, server, a)}
      </div>
    </main>`;
}
