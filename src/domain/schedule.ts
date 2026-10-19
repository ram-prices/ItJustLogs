/**
 * Banner schedule from ef-assets' schedule.json, built from the official news
 * feed (see ef-assets scripts/update-schedule.mjs). Times are given per server:
 * dated banners open at the same local time on each server, so Americas/Europe
 * (UTC-5) and Asia (UTC+8) differ by 13 hours; version updates are one instant.
 */

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
  name: string;
  /** "Sign-In Event", "Challenge Event", "Fun & Games Event", ... */
  type: string;
  version: string | null;
  start: ServerTimes | null;
  end: ServerTimes | null;
  details: string | null;
  availability?: string;
  post: string;
  needsReview?: boolean;
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
 * its timing relative to now. Server is noted since dates differ by server.
 */
export function discordText(
  item: { name: string; start: ServerTimes | null; end: ServerTimes | null },
  label: string,
  server: Server,
  now: number,
  rateUps: string[] = [],
): string {
  const start = timeOn(item.start, server);
  const end = timeOn(item.end, server);
  const lines = [`**${item.name}** · ${label}`];
  if (rateUps.length) lines.push(`Rate-up: ${rateUps.join(', ')}`);
  const status = statusOf(item, now, server);
  if (start == null) lines.push('Date not announced yet');
  else if (status === 'upcoming') {
    lines.push(`Opens ${stamp(start, 'F')} (${stamp(start, 'R')})`);
    if (end) lines.push(`Ends ${stamp(end, 'F')}`);
  }
  else if (status === 'live') lines.push(end ? `Ends ${stamp(end, 'F')} (${stamp(end, 'R')})` : `Open now since ${stamp(start, 'D')}, end not announced yet`);
  else lines.push(`Ran ${stamp(start, 'D')} to ${end ? stamp(end, 'D') : 'the next version update'}`);
  lines.push(`-# ${SERVER_LABEL[server]} server`);
  return lines.join('\n');
}
