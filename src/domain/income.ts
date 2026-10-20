/**
 * Free income per patch: what a player could earn in each version without
 * paying, as Headhunting and Arsenal pulls. Sources: the version's events
 * (ef-assets wiki/events.json), daily missions and the Weekly Routine for
 * every day and week of the version, and the Protocol Pass's free track
 * (ef-assets wiki/income.json, both from endfield.wiki.gg). Assumes every
 * daily and weekly is done; one-time rewards (story, exploration,
 * achievements), mail and compensation aren't counted. Pure logic, no DOM.
 */
import type { AnalyzedPull } from './analyze';
import { pullsOf, type EventRewardsFile } from './eventRewards';
import { timeOn, type Schedule, type Server } from './schedule';
import type { WikiAttribution } from './wiki';

export interface IncomeFile {
  attribution: WikiAttribution;
  fetched: string;
  /** Operational Manual → Daily: every day. */
  daily: { url: string; rewards: Record<string, number> };
  /** Weekly Routine: every week (Monday reset). */
  weekly: { url: string; rewards: Record<string, number> };
  /** Each Protocol Pass season (UTC times) and its free track (Basic Supply). */
  passes: { name: string; version: string | null; start: string | null; end: string | null; url: string; rewards: Record<string, number> }[];
}

/** Arsenal Tickets per Issue (one set of 10 weapons, counted as 10 pulls), from the wiki's Arsenal Exchange page. */
export const TICKETS_PER_ISSUE = 1980;

/** Arsenal Tickets every Headhunting result gives, by rarity (the wiki's Arsenal Ticket page). */
export const TICKETS_PER_HEADHUNT: Record<number, number> = { 4: 20, 5: 200, 6: 2000 };

/** Server time zones (hours from UTC) and the daily reset hour, server time. */
const SERVER_UTC_OFFSET: Record<Server, number> = { americas: -5, asia: 8 };
const RESET_HOUR = 4;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Days since 1970-01-01 in the server's calendar, where a day starts at the 04:00 reset. */
const resetDay = (t: number, server: Server) => Math.floor((t + (SERVER_UTC_OFFSET[server] - RESET_HOUR) * HOUR) / DAY);

/** Daily resets after `start`, up to and including `end`. */
export const dailyResets = (start: number, end: number, server: Server): number => Math.max(0, resetDay(end, server) - resetDay(start, server));

/** Weekly (Monday 04:00) resets after `start`, up to and including `end`. 1970-01-01 was a Thursday. */
export const weeklyResets = (start: number, end: number, server: Server): number => {
  const week = (t: number) => Math.floor((resetDay(t, server) + 3) / 7);
  return Math.max(0, week(end) - week(start));
};

export interface PatchWindow {
  /** "1.0" for Launch, then one minor version per release, like `patchOf`. */
  key: string;
  version: string;
  start: number;
  /** The next version's release, or now while this one is current. */
  end: number;
  ongoing: boolean;
}

/** Each released version's time span on `server`, oldest first. */
export function patchWindows(schedule: Schedule, server: Server, now: number): PatchWindow[] {
  const released = schedule.versions
    .map((v) => ({ name: v.name, start: timeOn(v.release, server) }))
    .filter((v): v is { name: string; start: number } => v.start != null && v.start <= now);
  return released.map((v, i) => {
    const next = released[i + 1]?.start;
    return { key: `1.${i}`, version: v.name, start: v.start, end: next ?? now, ongoing: next == null };
  });
}

export type IncomeSource = 'events' | 'daily' | 'weekly' | 'pass';

export interface IncomeLine {
  source: IncomeSource;
  /** Days, weeks or events counted. */
  count: number;
  /** Pull currencies in all (Oroberyl, Origeometry, HH Permits, Arsenal Tickets). */
  totals: Record<string, number>;
  /** The pass season's name. */
  name?: string;
  url?: string;
  /** Events: each one counted, for links. */
  events?: { id: number; name: string; pulls: number; partial: boolean }[];
  /** Some amounts are unknown (events the wiki lists without amounts, or not on the wiki). */
  partial?: boolean;
}

export interface PatchIncome extends PatchWindow {
  lines: IncomeLine[];
  /** Headhunting pulls everything comes to: Oroberyl (and Origeometry) at 500 a pull, plus HH Permits. */
  headhunting: number;
  /** Arsenal pulls: Arsenal Tickets at 1,980 per Issue of 10. */
  arsenal: number;
  partial: boolean;
}

const plus = (a: Record<string, number>, b: Record<string, number>, times = 1) => {
  for (const [k, n] of Object.entries(b)) a[k] = (a[k] ?? 0) + n * times;
  return a;
};

/** Headhunting and Arsenal pulls a set of totals comes to. */
export function pullsFrom(totals: Record<string, number>): { headhunting: number; arsenal: number } {
  const p = pullsOf(totals);
  return { headhunting: p.pulls, arsenal: (p.arsenalTickets / TICKETS_PER_ISSUE) * 10 };
}

/** Arsenal Tickets Headhunting results give back (20 / 200 / 2,000 for a 4★ / 5★ / 6★). */
export const ticketsFromPulls = (pulls: Pick<AnalyzedPull, 'kind' | 'rarity'>[]): number =>
  pulls.reduce((n, p) => n + (p.kind === 'char' ? (TICKETS_PER_HEADHUNT[p.rarity] ?? 0) : 0), 0);

/**
 * Free income for every released version on `server`, oldest first.
 * Daily and weekly resets inside a version count for it; Launch also gets its
 * first day and week. An event counts for its version (or, without one, the
 * version it starts in) once it has started; a pass for the version it starts
 * in. The current version counts what's been possible so far.
 */
export function patchIncome(
  schedule: Schedule,
  server: Server,
  now: number,
  events: EventRewardsFile | null,
  income: IncomeFile | null,
): PatchIncome[] {
  const windows = patchWindows(schedule, server, now);
  const index = new Map(windows.map((w, i) => [w.version, i]));
  const at = (t: number) => windows.findIndex((w, i) => t >= w.start && (i === windows.length - 1 || t < w.end));

  return windows.map((w, i) => {
    const lines: IncomeLine[] = [];
    if (events) {
      const counted: NonNullable<IncomeLine['events']> = [];
      const totals: Record<string, number> = {};
      for (const e of schedule.events ?? []) {
        const start = timeOn(e.start, server);
        if (e.id == null || start == null || start > now) continue;
        if ((e.version != null && index.has(e.version) ? index.get(e.version) : at(start)) !== i) continue;
        const r = events.events[e.id];
        plus(totals, r?.totals ?? {});
        counted.push({ id: e.id, name: e.name, pulls: r ? pullsOf(r.totals).pulls : 0, partial: !r || !!r.partial });
      }
      if (counted.length) lines.push({ source: 'events', count: counted.length, totals, events: counted, partial: counted.some((e) => e.partial) });
    }
    if (income) {
      const first = i === 0 ? 1 : 0;
      const days = dailyResets(w.start, w.end, server) + first;
      const weeks = weeklyResets(w.start, w.end, server) + first;
      if (days) lines.push({ source: 'daily', count: days, totals: plus({}, income.daily.rewards, days), url: income.daily.url });
      if (weeks) lines.push({ source: 'weekly', count: weeks, totals: plus({}, income.weekly.rewards, weeks), url: income.weekly.url });
      for (const p of income.passes) {
        const start = p.start ? Date.parse(p.start) : NaN;
        if (Number.isNaN(start) || start > now || at(start) !== i) continue;
        lines.push({ source: 'pass', count: 1, totals: { ...p.rewards }, name: p.name, url: p.url });
      }
    }
    const all = lines.reduce((t, l) => plus(t, l.totals), {} as Record<string, number>);
    const { headhunting, arsenal } = pullsFrom(all);
    return { ...w, lines, headhunting, arsenal, partial: lines.some((l) => l.partial) };
  });
}
