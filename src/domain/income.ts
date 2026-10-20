/**
 * Income per patch: what a player could earn in each version, as Headhunting
 * and Arsenal pulls. Free sources: the version's events (ef-assets
 * wiki/events.json), daily missions and the Weekly Routine for every day and
 * week of the version, and the Protocol Pass's free track (ef-assets
 * wiki/income.json, both from endfield.wiki.gg). On request, paid ones too
 * (`PaidIncome`): the pass's Originium Supply (less the Origeometry it costs)
 * and Protocol Customized tiers, and the Monthly Pass kept up all version.
 * Also each version's maintenance compensation (its official Version Update
 * Notes, also in income.json) and the one-time rewards of the permanent
 * missions it released (Main, Side and Exploration Missions), what its
 * permanent modes hand out anew (Echoes of War seasons, Monumental Etching,
 * Delver of the Cryptic...; official notes, else the wiki) and the outposts
 * it added, a rough estimate for the storage crates in the areas it added
 * (their count times an average Oroberyl per crate), the Origeometry their
 * Aurylene unlocks at TP Points, and hand-kept amounts from community guides
 * (version preview livestream, version survey, Combat Drills). Plus the Crafting Manual's gathering milestones (by the version
 * that added the item's area or enemy), one-time progression at launch
 * (Operational Manual Node milestones, Authority Level rewards), other
 * one-time rewards by the version that added them (`oneTime`: Operational
 * Manual stages, Regional Development levels, Intel Gathering, mail events,
 * launch codes), the Credit Store's daily stock on average, and our own
 * rough estimate for an event or mode the wiki names without amounts: what
 * others of its kind give (the median). Assumes every daily and weekly is
 * done; achievements aren't counted. Headhunting pulls are limited ones: Basic HH
 * Permits are counted apart. The current version is projected to its end.
 * Pure logic, no DOM.
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
  /** Each Protocol Pass season (UTC times): its free track (Basic Supply) and the paid tiers (Originium Supply, Protocol Customized). */
  passes: {
    name: string;
    version: string | null;
    start: string | null;
    end: string | null;
    url: string;
    rewards: Record<string, number>;
    originium?: Record<string, number>;
    customized?: Record<string, number>;
    /** The free track's crates and the Oroberyl they average. */
    freeCrates?: { item: string; count: number; oroberyl: number };
  }[];
  /** What the paid tiers cost: Originium Supply in Origeometry; Protocol Customized in money, handing out Origeometry on purchase. */
  passTiers?: {
    url: string;
    originium: { cost: Record<string, number> };
    customized: { price: string | null; onPurchase: Record<string, number> };
  };
  /** The Monthly Pass: bought for `days` at a time, it hands out `onPurchase` once and `daily` every day. */
  monthly?: { url: string; price: string | null; days: number; onPurchase: Record<string, number>; daily: Record<string, number> };
  /** What each version's official Version Update Notes hand out in the mail, by version name. */
  compensation?: { source: string; versions: Record<string, { url: string; rows: { label: string; rewards: Record<string, number> }[] }> };
  /** Permanent missions with pull currency rewards, by the version that released them. */
  quests?: { source: string; caps: Record<string, string>; versions: Record<string, Quest[]> };
  /** The areas each version added, with their crate counts, and a rough Oroberyl per crate. */
  exploration?: {
    source: string;
    crateOroberyl: Record<string, number>;
    mix: Record<string, number>;
    perCrate: number;
    sources: string[];
    versions: Record<string, Area[]>;
    /** The outposts each version added and their level rewards. */
    outposts?: Record<string, { outpost: string; url: string; rewards: Record<string, number> }[]>;
    /** The Crafting Manual's gathering milestones, by the version that added each item's area or enemy. */
    crafting?: { url: string; versions: Record<string, { rewards: Record<string, number>; items: number }> };
    /** What each version's new areas' Aurylene unlocks at TP Points; `partial` (why) past the end of the wiki's table. */
    aurylene?: { url: string; versions: Record<string, { rewards: Record<string, number>; partial?: string }> };
  };
  /** Hand-kept amounts from community guides and posts, each with its sources. */
  extras?: {
    livestream?: Extra & { perVersion: Record<string, number>; fromVersion: number; confirmed: string[] };
    survey?: Extra & { perVersion: Record<string, number>; fromVersion: number };
    combatDrills?: Extra & { perBanner: Record<string, number>; kinds: string[] };
  };
  /**
   * The quota shops: the AIC Quota Exchange's banner HH Permits (per version
   * from the official notes, else `perBanner` per banner of `kinds`), and the
   * Bond Quota Exchange's Chartered HH Permit price and the Bond Quota a
   * duplicate 5★ / 6★ operator gives.
   */
  shops?: {
    aic: { url: string; price: number; perBanner: number; kinds: string[]; versions: Record<string, { permit: string; count: number }[]> };
    bond: { url: string; price: number; duplicate: Record<string, number> };
    /** The Credit Store's daily stock on average (Oroberyl or Arsenal Tickets, never both). */
    credit?: { url: string; perDay: Record<string, number> };
  };
  /** One-time rewards by the version that added them, and the breakdown section they're listed in. */
  oneTime?: { source: string; versions: Record<string, OneTimeReward[]> };
  /** One-time rewards there from launch (Operational Manual Node milestones, Authority Level rewards). */
  progression?: { version: string; items: { name: string; url: string; rewards: Record<string, number> }[] };
  /** What each version's permanent modes hand out anew, by version name. */
  modes?: { source: string; versions: Record<string, ModeReward[]> };
}

/** An event type as a key: "Narrative Event" and "Narrative" are the same. */
const typeKey = (t: string | undefined) => (t ?? '').toLowerCase().replace(/\s*event$/, '').trim();

/** The middle value (the lower one of an even count); 0 without any. */
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};

export interface Extra {
  label: string;
  note: string;
  sources: string[];
}

export interface ModeReward {
  name: string;
  /** Where the amounts come from: the official `notes`, or the `wiki`. */
  from: 'notes' | 'wiki';
  url: string;
  rewards: Record<string, number>;
  /** Named without amounts. */
  partial?: boolean;
  /** A rough share (Etchspace milestones split over the versions that added to them). */
  estimate?: boolean;
  /** Amounts estimated from the same mode in other versions (the wiki and notes name it without them). */
  estimated?: boolean;
}

export interface Area {
  area: string;
  url: string;
  crates: number;
  aurylene: number;
}

export interface Quest {
  name: string;
  type: string;
  url: string;
  rewards: Record<string, number>;
  /** How its version was found: the main `story`'s progress, `listed` on the version's wiki page, its `region`, or `launch`. */
  how: string;
}

/** Paid income a player may ask to count: the pass's two paid tiers and the Monthly Pass. */
export type PaidIncome = 'originium' | 'customized' | 'monthly';
export const PAID_INCOME: PaidIncome[] = ['originium', 'customized', 'monthly'];

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

/**
 * How many more days a daily reward can be claimed before `end`, today
 * included (a day runs from one 04:00 reset to the next, server time).
 */
export const claimDaysLeft = (now: number, end: number, server: Server): number => (end <= now ? 0 : resetDay(end - 1, server) - resetDay(now, server) + 1);

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
  /**
   * The next version's release. For the current version, when it isn't
   * announced yet: the latest end of the version's banners and events (the
   * last ones run until the update), else now.
   */
  end: number;
  ongoing: boolean;
  /** The current version, counted to an end that hasn't come yet. */
  projected: boolean;
}

/** Each released version's time span on `server`, oldest first. */
export function patchWindows(schedule: Schedule, server: Server, now: number): PatchWindow[] {
  const dated = schedule.versions
    .map((v) => ({ name: v.name, start: timeOn(v.release, server) }))
    .filter((v): v is { name: string; start: number } => v.start != null);
  const released = dated.filter((v) => v.start <= now);
  return released.map((v, i) => {
    const next = dated[i + 1]?.start;
    const ongoing = next == null || next > now;
    let end = next;
    if (end == null) {
      const ends = [...schedule.banners, ...(schedule.events ?? [])]
        .filter((x) => x.version === v.name)
        .map((x) => timeOn(x.end, server))
        .filter((t): t is number => t != null);
      end = Math.max(now, ...ends);
    }
    return { key: `1.${i}`, version: v.name, start: v.start, end, ongoing, projected: ongoing && end > now };
  });
}

export interface OneTimeReward {
  name: string;
  section: 'modes' | 'exploration' | 'mailbox';
  url: string;
  rewards: Record<string, number>;
  count: number;
  /** Partly our own rule (Wuling's Regional Development caps, voucher averages). */
  estimate?: boolean;
  /** Claimable only until then (UTC): mail events, expired codes. */
  until?: string;
}

export type IncomeSource =
  | 'events'
  | 'quests'
  | 'modes'
  | 'outposts'
  | 'crates'
  | 'aurylene'
  | 'livestream'
  | 'survey'
  | 'combatDrills'
  | 'aicShop'
  | 'bondShop'
  | 'crafting'
  | 'progression'
  | 'oneTime'
  | 'creditStore'
  | 'daily' | 'weekly' | 'pass' | 'compensation' | PaidIncome;

export interface IncomeLine {
  source: IncomeSource;
  /** Days (daily, Monthly Pass), weeks or events counted. */
  count: number;
  /** Bought with money or Origeometry: a paid pass tier or the Monthly Pass. */
  paid?: boolean;
  /** Pull currencies in all (Oroberyl, Origeometry, HH Permits, Arsenal Tickets). */
  totals: Record<string, number>;
  /** The pass season's name. */
  name?: string;
  url?: string;
  /** Events: each one counted, for links (`id`: a schedule event's page here; `url`: the wiki's, for events the schedule doesn't list). */
  events?: { id?: number; url?: string; name: string; pulls: number; totals: Record<string, number>; partial: boolean; estimated?: boolean }[];
  /** Quests: each mission counted. */
  quests?: Quest[];
  /** Crates: the areas counted. */
  areas?: Area[];
  /** Modes: each mode's rewards. */
  modes?: ModeReward[];
  /** Outposts: each outpost counted. */
  outposts?: { outpost: string; url: string; rewards: Record<string, number> }[];
  /** A rough figure, not the game's own amounts (crates: count × average per crate). */
  estimate?: boolean;
  /** Hand-kept from community guides: what they say and where. */
  extra?: Extra;
  /** Why it's partial, when the data says. */
  note?: string;
  /** One-time rewards: the section they belong to, and each kind counted. */
  section?: OneTimeReward['section'];
  oneTime?: OneTimeReward[];
  /** Progression: each one-time reward set. */
  items?: { name: string; url: string; rewards: Record<string, number> }[];
  /** Pass: its free-track crates' average Oroberyl, included in `totals`. */
  crates?: { item: string; count: number; oroberyl: number };
  /** Compensation: each mail ("Bug Fix Compensation") and what it holds. */
  rows?: { label: string; rewards: Record<string, number> }[];
  /** Some amounts are unknown (events the wiki lists without amounts, or not on the wiki). */
  partial?: boolean;
}

export interface PatchIncome extends PatchWindow {
  lines: IncomeLine[];
  /** Limited Headhunting pulls everything comes to: Oroberyl (and Origeometry) at 500 a pull, plus limited HH Permits. */
  headhunting: number;
  /** Basic HH Permits: pulls on Basic Headhunting only. */
  basic: number;
  /** Arsenal pulls: Arsenal Tickets at 1,980 per Issue of 10. */
  arsenal: number;
  partial: boolean;
}

const plus = (a: Record<string, number>, b: Record<string, number>, times = 1) => {
  for (const [k, n] of Object.entries(b)) a[k] = (a[k] ?? 0) + n * times;
  return a;
};

/** Limited Headhunting, Basic Headhunting and Arsenal pulls a set of totals comes to. */
export function pullsFrom(totals: Record<string, number>): { headhunting: number; basic: number; arsenal: number } {
  const p = pullsOf(totals);
  return { headhunting: p.pulls, basic: p.basicPermits, arsenal: (p.arsenalTickets / TICKETS_PER_ISSUE) * 10 };
}

/**
 * The Bond Quota each operator pull gave: a 5★ or 6★ the player already had
 * gives `duplicate[rarity]` (the first copy gives none). Pulls in time order.
 */
export function bondQuota(pulls: Pick<AnalyzedPull, 'kind' | 'rarity' | 'itemId' | 'ts'>[], duplicate: Record<string, number>): Map<object, number> {
  const owned = new Set<string>();
  const out = new Map<object, number>();
  for (const p of [...pulls].filter((x) => x.kind === 'char').sort((a, b) => a.ts - b.ts)) {
    if (p.rarity < 5) continue;
    if (owned.has(p.itemId)) out.set(p, duplicate[p.rarity] ?? 0);
    else owned.add(p.itemId);
  }
  return out;
}

/** Arsenal Tickets Headhunting results give back (20 / 200 / 2,000 for a 4★ / 5★ / 6★). */
export const ticketsFromPulls = (pulls: Pick<AnalyzedPull, 'kind' | 'rarity'>[]): number =>
  pulls.reduce((n, p) => n + (p.kind === 'char' ? (TICKETS_PER_HEADHUNT[p.rarity] ?? 0) : 0), 0);

/**
 * Income for every released version on `server`, oldest first: the free
 * sources, plus the `paid` ones asked for.
 * Daily and weekly resets inside a version count for it; Launch also gets its
 * first day and week. An event counts for its version (or, without one, the
 * version it starts in) once it has started; a pass for the version it starts
 * in. The Monthly Pass counts every day, with its purchase Origeometry spread
 * over its days (kept up all version). The current version is counted to its
 * (projected) end: all its days and weeks, every event it lists.
 */
export function patchIncome(
  schedule: Schedule,
  server: Server,
  now: number,
  events: EventRewardsFile | null,
  income: IncomeFile | null,
  paid: readonly PaidIncome[] = [],
  since?: number,
): PatchIncome[] {
  const windows = patchWindows(schedule, server, now);
  // A player who started later never had the limited-time rewards that ended before then.
  const gone = (end: number | null | undefined) => since != null && end != null && !Number.isNaN(end) && end < since;
  const index = new Map(windows.map((w, i) => [w.version, i]));
  const at = (t: number) => windows.findIndex((w, i) => t >= w.start && (i === windows.length - 1 || t < w.end));

  // What events of each type give, from those whose Oroberyl the wiki lists: for an event of that type it names without amounts.
  const byType = new Map<string, number[]>();
  const seen = (type: string | undefined, totals: Record<string, number> | undefined) => {
    const n = totals?.Oroberyl ?? 0;
    if (n > 0) byType.set(typeKey(type), [...(byType.get(typeKey(type)) ?? []), n]);
  };
  for (const e of schedule.events ?? []) if (e.id != null) seen(e.type, events?.events[e.id]?.totals);
  for (const x of Object.values(events?.extra ?? {})) seen(x.type, x.totals);
  /** A rough amount for an event the wiki names without amounts: the median of its type. */
  const typical = (type: string | undefined): Record<string, number> | undefined => {
    const n = median(byType.get(typeKey(type)) ?? []);
    return n ? { Oroberyl: n } : undefined;
  };
  // What each mode gives where its amounts are listed: for a version whose notes and wiki name it without them.
  const modeAmounts = new Map<string, number[]>();
  for (const list of Object.values(income?.modes?.versions ?? {}))
    for (const m of list) if (!m.partial && m.rewards.Oroberyl) modeAmounts.set(m.name, [...(modeAmounts.get(m.name) ?? []), m.rewards.Oroberyl]);

  return windows.map((w, i) => {
    const lines: IncomeLine[] = [];
    if (events) {
      const counted: NonNullable<IncomeLine['events']> = [];
      const totals: Record<string, number> = {};
      for (const e of schedule.events ?? []) {
        const start = timeOn(e.start, server);
        if (e.id == null || start == null || start > windows[windows.length - 1].end) continue;
        if ((e.version != null && index.has(e.version) ? index.get(e.version) : at(start)) !== i) continue;
        if (gone(timeOn(e.end, server))) continue;
        const r = events.events[e.id];
        const fill = r?.partial && !pullsOf(r.totals).pulls ? typical(e.type) : undefined;
        const t = fill ?? r?.totals ?? {};
        plus(totals, t);
        counted.push({ id: e.id, name: e.name, pulls: pullsOf(t).pulls, totals: t, partial: fill ? false : !r || !!r.partial, ...(fill ? { estimated: true } : {}) });
      }
      // Events the schedule doesn't list (announced mid-version): by when they start.
      for (const x of Object.values(events.extra ?? {})) {
        const start = Date.parse(x.start[server] ?? x.start.asia ?? '');
        if (Number.isNaN(start) || start > windows[windows.length - 1].end || at(start) !== i) continue;
        if (x.end && gone(Date.parse(x.end[server] ?? x.end.asia ?? ''))) continue;
        const fill = x.partial && !pullsOf(x.totals).pulls ? typical(x.type) : undefined;
        const t = fill ?? x.totals;
        plus(totals, t);
        counted.push({ url: x.url, name: x.name, pulls: pullsOf(t).pulls, totals: t, partial: fill ? false : !!x.partial, ...(fill ? { estimated: true } : {}) });
      }
      if (counted.length)
        lines.push({
          source: 'events',
          count: counted.length,
          totals,
          events: counted,
          partial: counted.some((e) => e.partial),
          estimate: counted.some((e) => e.estimated),
        });
    }
    // Days and weeks from the later of the version's start and the player's.
    const from = since != null && since > w.start ? since : w.start;
    const missed = from >= w.end && i < windows.length - 1;
    // Limited to the version: gone if the player started after it ended.
    const versionGone = gone(w.end) && i < windows.length - 1;
    if (income) {
      const first = i === 0 || from > w.start ? 1 : 0;
      const days = missed ? 0 : dailyResets(from, w.end, server) + first;
      const weeks = missed ? 0 : weeklyResets(from, w.end, server) + first;
      if (days) lines.push({ source: 'daily', count: days, totals: plus({}, income.daily.rewards, days), url: income.daily.url });
      if (weeks) lines.push({ source: 'weekly', count: weeks, totals: plus({}, income.weekly.rewards, weeks), url: income.weekly.url });
      for (const p of income.passes) {
        const start = p.start ? Date.parse(p.start) : NaN;
        if (Number.isNaN(start) || start > w.end || at(start) !== i) continue;
        if (gone(p.end ? Date.parse(p.end) : null)) continue;
        lines.push({
          source: 'pass',
          count: 1,
          totals: plus({ ...p.rewards }, p.freeCrates ? { Oroberyl: p.freeCrates.oroberyl } : {}),
          name: p.name,
          url: p.url,
          crates: p.freeCrates,
          estimate: !!p.freeCrates,
        });
        const tiers = income.passTiers;
        if (paid.includes('originium') && p.originium && tiers)
          lines.push({ source: 'originium', count: 1, paid: true, totals: plus({ ...p.originium }, tiers.originium.cost, -1), name: p.name, url: tiers.url });
        if (paid.includes('customized') && p.customized && tiers)
          lines.push({ source: 'customized', count: 1, paid: true, totals: plus({ ...p.customized }, tiers.customized.onPurchase), name: p.name, url: tiers.url });
      }
      const quests = income.quests?.versions[w.version] ?? [];
      if (quests.length)
        lines.push({
          source: 'quests',
          count: quests.length,
          totals: quests.reduce((t, q) => plus(t, q.rewards), {} as Record<string, number>),
          quests,
        });
      const modes = (income.modes?.versions[w.version] ?? []).map((m) => {
        // Named without amounts: what the same mode gives in other versions.
        const n = m.partial ? median(modeAmounts.get(m.name) ?? []) : 0;
        return n ? { ...m, rewards: { Oroberyl: n }, partial: false, estimated: true } : m;
      });
      if (modes.length)
        lines.push({
          source: 'modes',
          count: modes.length,
          totals: modes.reduce((t, m) => plus(t, m.rewards), {} as Record<string, number>),
          modes,
          partial: modes.some((m) => m.partial),
          estimate: modes.some((m) => m.estimate || m.estimated),
        });
      const outposts = income.exploration?.outposts?.[w.version] ?? [];
      if (outposts.length)
        lines.push({ source: 'outposts', count: outposts.length, totals: outposts.reduce((t, o) => plus(t, o.rewards), {} as Record<string, number>), outposts });
      const craft = income.exploration?.crafting?.versions[w.version];
      if (craft?.items && Object.keys(craft.rewards).length)
        lines.push({ source: 'crafting', count: craft.items, totals: { ...craft.rewards }, url: income.exploration!.crafting!.url });
      const prog = income.progression;
      if (prog && prog.version === w.version && prog.items.length)
        lines.push({ source: 'progression', count: prog.items.length, totals: prog.items.reduce((t, x) => plus(t, x.rewards), {} as Record<string, number>), items: prog.items });
      const once = (income.oneTime?.versions[w.version] ?? []).filter((x) => !gone(x.until ? Date.parse(x.until) : null));
      for (const section of ['modes', 'exploration', 'mailbox'] as const) {
        const items = once.filter((x) => x.section === section);
        if (items.length)
          lines.push({
            source: 'oneTime',
            section,
            count: items.reduce((n, x) => n + x.count, 0),
            totals: items.reduce((t, x) => plus(t, x.rewards), {} as Record<string, number>),
            oneTime: items,
            estimate: items.some((x) => x.estimate),
          });
      }
      const credit = income.shops?.credit;
      if (credit && days) lines.push({ source: 'creditStore', count: days, totals: plus({}, credit.perDay, days), url: credit.url, estimate: true });
      const ex = income.exploration;
      const areas = (ex?.versions[w.version] ?? []).filter((a) => a.crates > 0);
      const crates = areas.reduce((n, a) => n + a.crates, 0);
      if (ex && crates)
        lines.push({ source: 'crates', count: crates, totals: { Oroberyl: Math.round(crates * ex.perCrate) }, areas, estimate: true });
      const aur = income.exploration?.aurylene?.versions[w.version];
      if (aur && (Object.keys(aur.rewards).length || aur.partial))
        lines.push({ source: 'aurylene', count: 1, totals: { ...aur.rewards }, url: income.exploration!.aurylene!.url, partial: !!aur.partial, note: aur.partial });
      const x = income.extras;
      if (x?.livestream && i >= x.livestream.fromVersion && !versionGone)
        lines.push({ source: 'livestream', count: 1, totals: { ...x.livestream.perVersion }, extra: x.livestream, estimate: !x.livestream.confirmed.includes(w.version) });
      if (x?.survey && i >= x.survey.fromVersion && !versionGone) lines.push({ source: 'survey', count: 1, totals: { ...x.survey.perVersion }, extra: x.survey });
      const drills = x?.combatDrills;
      const newBanners = drills ? schedule.banners.filter((b) => b.version === w.version && drills.kinds.includes(b.kind)).length : 0;
      if (drills && newBanners && !versionGone)
        lines.push({ source: 'combatDrills', count: newBanners, totals: plus({}, drills.perBanner, newBanners), extra: drills });
      // The AIC Quota Exchange's banner HH Permits: as the notes list them, else so many per banner.
      const aic = income.shops?.aic;
      if (aic && !versionGone) {
        const named = aic.versions[w.version];
        const banners = schedule.banners.filter((b) => b.version === w.version && aic.kinds.includes(b.kind)).length;
        const permits = named ?? (banners ? [{ permit: 'Banner HH Permit', count: aic.perBanner * banners }] : []);
        const totals = permits.reduce((t, p) => plus(t, { [p.permit]: p.count }), {} as Record<string, number>);
        if (permits.length) lines.push({ source: 'aicShop', count: permits.reduce((n, p) => n + p.count, 0), totals, url: aic.url });
      }
      const comp = income.compensation?.versions[w.version];
      if (comp && !versionGone)
        lines.push({
          source: 'compensation',
          count: comp.rows.length,
          totals: comp.rows.reduce((t, r) => plus(t, r.rewards), {} as Record<string, number>),
          rows: comp.rows,
          url: comp.url,
        });
      const m = income.monthly;
      if (paid.includes('monthly') && m && days)
        lines.push({ source: 'monthly', count: days, paid: true, totals: plus(plus({}, m.daily, days), m.onPurchase, days / m.days), url: m.url });
    }
    const all = lines.reduce((t, l) => plus(t, l.totals), {} as Record<string, number>);
    const { headhunting, basic, arsenal } = pullsFrom(all);
    // Started during this version: it begins for the player then (the total prorates from there).
    return { ...w, start: missed ? w.start : from, lines, headhunting, basic, arsenal, partial: lines.some((l) => l.partial) };
  });
}
