/**
 * Event rewards: ef-assets wiki/events.json (scripts/event-rewards.mjs, from
 * endfield.wiki.gg), keyed by the event's id in schedule.json. Each event has
 * its reward rows (a mission, a sign-in day, a milestone) and totals per item;
 * `partial` when the wiki names rewards without (all) their amounts, so the
 * totals are a lower bound. A group with `exchange` is a shop paid in a
 * currency only the event hands out (AIC Support's Goods Exchange): its whole
 * stock is counted. Pure logic, no DOM.
 */
import type { Schedule, ServerTimes } from './schedule';
import type { WikiAttribution } from './wiki';

/** An item and how many; null when the wiki doesn't say. */
export type Reward = [item: string, count: number | null];

/** A stage of an event: from `start` (server time; null: the event's start) until the next one's start, the last until the event ends. */
export interface EventPhase {
  name: string;
  start: ServerTimes | null;
  about: string;
}

export interface EventRewards {
  name: string;
  page: string;
  url: string;
  /** Its end per server from the wiki's event table, when the wiki has one. */
  end?: ServerTimes;
  /** Its phases, when the wiki's page lists them (two or more). */
  phases?: EventPhase[];
  /** It stays playable after it ends; `limitedRewards`: some of its rewards still end with it. */
  permanent?: boolean;
  limitedRewards?: boolean;
  /** How many daily rewards it hands out (sign-in days, "every day, N times"). */
  days?: number;
  /** Its rewards that aren't general materials or currencies: portraits, frames, stickers, models, operators... */
  unique?: string[];
  partial?: boolean;
  totals: Record<string, number>;
  groups: { title: string; partial?: boolean; exchange?: string; rows: { label: string; rewards: Reward[] }[] }[];
}

export interface EventRewardsFile {
  attribution: WikiAttribution;
  fetched: string;
  events: Record<string, EventRewards>;
  /** Events the wiki lists but schedule.json doesn't (announced mid-version), by wiki page, with their UTC start per server. */
  extra?: Record<string, EventRewards & { type: string; start: { asia: string | null; americas: string | null }; end?: { asia: string | null; americas: string | null } }>;
}

/**
 * The schedule with the wiki's end given to each event the update notes leave
 * open ("until the next version update"), when the wiki has one. The same
 * object back for the same inputs.
 */
let lastEnds: { s: Schedule; file: EventRewardsFile | null | undefined; out: Schedule } | null = null;
export function withWikiEnds(s: Schedule, file: EventRewardsFile | null | undefined): Schedule {
  if (lastEnds && lastEnds.s === s && lastEnds.file === file) return lastEnds.out;
  const out =
    file && s.events?.some((e) => !e.end && e.id != null && file.events[e.id]?.end)
      ? { ...s, events: s.events.map((e) => (!e.end && e.id != null && file.events[e.id]?.end ? { ...e, end: file.events[e.id].end! } : e)) }
      : s;
  lastEnds = { s, file, out };
  return out;
}

/** Oroberyl per Headhunting pull, and per Origeometry (from the wiki's Headhunting and Origeometry pages). */
export const OROBERYL_PER_PULL = 500;
export const OROBERYL_PER_ORIGEOMETRY = 75;

/**
 * What an event's totals come to in limited Headhunting pulls: Oroberyl (and
 * Origeometry, at its exchange rate) over a pull's cost, plus HH Permits
 * (each one pull; a banner's own permits only work on that banner, so
 * they're listed apart). Basic HH Permits only work on Basic Headhunting (the
 * standard banner), so they're counted apart and not in `pulls`, as the
 * community's pull counts do. Arsenal Tickets are a separate currency, kept
 * as is.
 */
export function pullsOf(totals: Record<string, number>): {
  oroberyl: number;
  /** Pulls the Oroberyl and Origeometry buy. */
  fromOroberyl: number;
  /** HH Permits for limited banners by name ("Chartered HH Permit", "Gently Flows Qingbo HH Permit"). */
  permits: [string, number][];
  /** Basic HH Permits: Basic Headhunting only. */
  basicPermits: number;
  arsenalTickets: number;
  /** Oroberyl, Origeometry and limited HH Permits as limited Headhunting pulls. */
  pulls: number;
} {
  const oroberyl = (totals.Oroberyl ?? 0) + (totals.Origeometry ?? 0) * OROBERYL_PER_ORIGEOMETRY;
  const isBasic = (k: string) => /^Basic HH Permit$/i.test(k);
  const permits = Object.entries(totals).filter(([k]) => /HH Permit/i.test(k) && !/selection|designation/i.test(k) && !isBasic(k));
  const fromOroberyl = oroberyl / OROBERYL_PER_PULL;
  return {
    oroberyl,
    fromOroberyl,
    permits,
    basicPermits: Object.entries(totals).reduce((s, [k, n]) => s + (isBasic(k) ? n : 0), 0),
    arsenalTickets: totals['Arsenal Ticket'] ?? 0,
    pulls: fromOroberyl + permits.reduce((s, [, n]) => s + n, 0),
  };
}

/** "3.2" for a pull count: whole numbers stay whole. */
export const fmtPulls = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
