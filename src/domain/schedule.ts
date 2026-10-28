/**
 * Banner schedule from ef-assets' schedule.json, built from the official news
 * feed (see ef-assets scripts/update-schedule.mjs). Times are given per server:
 * dated banners open at the same local time on each server, so Americas/Europe
 * (UTC-5) and Asia (UTC+8) differ by 13 hours; version updates are one instant.
 */
import { nameSlug } from './wiki.ts';

export type Server = 'americas' | 'asia';
export type ScheduleKind = 'chartered' | 'special' | 'refactor' | 'issue' | 'refactorIssue';

export interface ServerTimes {
  americas: string;
  asia: string;
}

export interface ScheduleBanner {
  name: string;
  kind: ScheduleKind;
  rateUps: string[];
  poolId: string | null;
  version: string | null;
  start: ServerTimes | null;
  /** null while the end depends on something not announced yet. */
  end: ServerTimes | null;
  availability: string | null;
  /** The announcement's cover image (the banner key art). */
  art: string | null;
  posts: string[];
  notes?: string[];
  needsReview?: boolean;
}

export interface ScheduleVersion {
  name: string;
  release: ServerTimes | null;
  maintenance: ServerTimes | null;
  posts: string[];
}

/** An in-game event from a version's update notes ("■ New Events"). */
export interface ScheduleEvent {
  /** Stable number from ef-assets (never moves or gets reused): the /event/<id> link. */
  id?: number;
  name: string;
  /** "Sign-In Event", "Challenge Event", "Fun & Games Event", ... */
  type: string;
  version: string | null;
  start: ServerTimes | null;
  end: ServerTimes | null;
  details: string | null;
  availability?: string;
  post: string;
  /** Art from the official New Version Guide (ef-assets events/), when it had the event. */
  art?: string;
  needsReview?: boolean;
  /** The official notice (an X post, say) whose dates ef-assets schedule-overrides.json applied. */
  source?: string;
}

const DAILY = /\b(sign in|log in|every day|each day|daily)\b/i;

/**
 * Events that hand out rewards day by day: sign-ins, daily logins, daily
 * missions. An event without details counts if another of the same name does
 * (Sanity Supply returns every version).
 */
export function hasDailyRewards(e: ScheduleEvent, schedule?: Schedule): boolean {
  const daily = (x: ScheduleEvent) => /sign-in/i.test(x.type) || DAILY.test(x.details ?? '');
  return daily(e) || (!e.details && !!schedule?.events?.some((x) => x.name === e.name && daily(x)));
}

export interface Schedule {
  versions: ScheduleVersion[];
  banners: ScheduleBanner[];
  /** Missing from schedules cached before events were added. */
  events?: ScheduleEvent[];
}

export const SERVER_LABEL: Record<Server, string> = { americas: 'Americas / Europe', asia: 'Asia' };

export const KIND_LABEL: Record<ScheduleKind, string> = {
  chartered: 'Chartered Headhunting',
  special: 'Special Headhunting',
  refactor: 'RE-Factor Headhunting',
  issue: 'Arsenal Issue',
  refactorIssue: 'RE-Factor Issue',
};

export const isWeaponBanner = (k: ScheduleKind): boolean => k === 'issue' || k === 'refactorIssue';

/** A time on the given server, as epoch ms. */
export const timeOn = (t: ServerTimes | null, server: Server): number | null => (t ? Date.parse(t[server]) : null);

/** Without a known end, assume a banner runs about this long (they run ~3 weeks or more). */
export const UNKNOWN_END_DAYS = 21;
const DAY = 86_400_000;

export type BannerStatus = 'live' | 'upcoming' | 'ended';

/** Whether a banner or event is open, coming, or over. */
export function statusOf(b: { start: ServerTimes | null; end: ServerTimes | null }, now: number, server: Server): BannerStatus {
  const start = timeOn(b.start, server);
  const end = timeOn(b.end, server);
  if (start == null || now < start) return 'upcoming';
  if (end != null) return now <= end ? 'live' : 'ended';
  // An open end is only ever the latest banners, waiting on a later announcement.
  return now - start < 120 * DAY ? 'live' : 'ended';
}

/** The banner's end, or a placeholder a few weeks out when it isn't known yet. */
export function endOrGuess(b: ScheduleBanner, server: Server): number | null {
  const start = timeOn(b.start, server);
  return timeOn(b.end, server) ?? (start == null ? null : start + UNKNOWN_END_DAYS * DAY);
}

/**
 * Packs time spans into as few rows as possible without overlaps (greedy, by
 * start). Returns each span's row, in input order.
 */
export function packLanes(spans: { start: number; end: number }[]): number[] {
  const order = spans.map((s, i) => ({ ...s, i })).sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const lanes = new Array<number>(spans.length);
  for (const s of order) {
    let lane = laneEnds.findIndex((e) => e <= s.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = s.end;
    lanes[s.i] = lane;
  }
  return lanes;
}

/** Guesses the player's server from their time zone: UTC+5 and east is Asia. */
export function guessServer(offsetMinutes = -new Date().getTimezoneOffset()): Server {
  return offsetMinutes >= 300 ? 'asia' : 'americas';
}

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

/** Discord's timestamp markup: shown in each reader's own time zone. F = full date, R = "in 3 days". */
const stamp = (ms: number, style: 'F' | 'f' | 'D' | 'R') => `<t:${Math.round(ms / 1000)}:${style}>`;

/**
 * A banner or event as a Discord message: bold name and type, rate-ups, then
 * when it opens and ends. Server is noted since dates differ by server.
 */
export function discordText(
  item: { name: string; start: ServerTimes | null; end: ServerTimes | null },
  label: string,
  server: Server,
  rateUps: string[] = [],
): string {
  const start = timeOn(item.start, server);
  const end = timeOn(item.end, server);
  const lines = [`**${item.name}** · ${label}`];
  if (rateUps.length) lines.push(`Rate-up: ${rateUps.join(', ')}`);
  // Always both times, each with Discord's full date and its live countdown.
  lines.push(start == null ? 'Opens TBA' : `Opens ${stamp(start, 'F')} (${stamp(start, 'R')})`);
  lines.push(end == null ? 'Ends TBA' : `Ends ${stamp(end, 'F')} (${stamp(end, 'R')})`);
  lines.push(`-# ${SERVER_LABEL[server]} server`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Links: itjustlogs.dev/banners/<name>, /event/<id>
// ---------------------------------------------------------------------------

/**
 * When an operator or weapon came out, and in which version: its first
 * rate-up banner, else the event its wiki source names, else the game's
 * launch (standard operators, Arsenal Exchange and Protocol Pass weapons
 * have no dated banner). Null if the schedule has no versions.
 */
export function releaseOf(s: Schedule, name: string, source: string | null | undefined, server: Server): { at: number; version: string } | null {
  const versions = s.versions
    .map((v) => ({ name: v.name, at: timeOn(v.release, server) }))
    .filter((v): v is { name: string; at: number } => v.at != null)
    .sort((a, b) => a.at - b.at);
  if (!versions.length) return null;
  const starts = [
    ...s.banners.filter((b) => b.rateUps.includes(name)).map((b) => timeOn(b.start, server)),
    ...(s.events ?? []).filter((e) => source && e.name === source).map((e) => timeOn(e.start, server)),
  ].filter((t): t is number => t != null);
  const at = starts.length ? Math.min(...starts) : versions[0].at;
  return { at, version: versions.filter((v) => v.at <= at).at(-1)?.name ?? versions[0].name };
}

export type ScheduleItem = ScheduleBanner | ScheduleEvent;
export const isScheduleBanner = (i: ScheduleItem): i is ScheduleBanner => 'kind' in i;

/**
 * Every banner's and event's link path. Banners go by name (/banners/rejuvenation);
 * the first to use a name keeps the plain link, later ones (reruns) add their
 * opening date, so a link never changes what it points to as the schedule
 * grows. Events go by their stable number (/event/12).
 */
export function scheduleLinks(s: Schedule): Map<ScheduleItem, string> {
  const out = byName(s.banners, 'banners');
  for (const [e, path] of legacyEventLinks(s)) out.set(e, e.id != null ? `/event/${e.id}` : path);
  return out;
}

/**
 * LEGACY, to be removed: events' old name links (/events/sanity-supply,
 * /events/sanity-supply-2026-11-19). Still opened (app.ts redirects them to
 * /event/<id>) and still built (vite.config.ts) until they're dropped; delete
 * this and its two uses then.
 */
export function legacyEventLinks(s: Schedule): Map<ScheduleEvent, string> {
  return byName(s.events ?? [], 'events') as Map<ScheduleEvent, string>;
}

function byName(items: ScheduleItem[], dir: string): Map<ScheduleItem, string> {
  const out = new Map<ScheduleItem, string>();
  const seen = new Set<string>();
  const order = items
    .map((item, i) => ({ item, i, at: timeOn(item.start, 'americas') ?? Infinity }))
    .sort((p, q) => p.at - q.at || p.i - q.i);
  for (const { item } of order) {
    const base = nameSlug(item.name) || 'untitled';
    let slug = seen.has(base) && item.start ? `${base}-${item.start.americas.slice(0, 10)}` : base;
    for (let n = 2; seen.has(slug); n++) slug = `${base}-${n}`;
    seen.add(slug);
    out.set(item, `/${dir}/${slug}`);
  }
  return out;
}
