import { type Enemy, FPS } from '../../../domain/sim/engine';
import { enemyById, type ReplayResult, type SimResult } from '../../../domain/sim/team';
import { icon } from '../../components';
import { html, type Html } from '../../html';
import { page, settings, TL_ZOOMS } from './state';
import { big, clockTime, pct } from './text';
import { baseOf, phaseChanges } from './track';
import { soFar } from './fit';
import { paintBuffs } from './buffs';
import { videoOf } from './runs';

function easeBars(now: number): void {
  // About a fifth of a second to get most of the way there.
  const k = 1 - Math.exp(-(now - page.barLast) / 90);
  page.barLast = now;
  let moving = false;
  for (const el of document.querySelectorAll<HTMLElement>('[data-live-bar]')) {
    const key = `${el.dataset.liveBox}|${el.dataset.liveBar}`;
    const target = page.barTarget?.get(el.dataset.liveBar!) ?? Number(el.dataset.full);
    const was = page.barShown.get(key) ?? target;
    const next = Math.abs(target - was) < 0.0005 ? target : was + (target - was) * k;
    if (next !== target) moving = true;
    page.barShown.set(key, next);
    el.style.flexBasis = `${next * 100}%`;
  }
  page.barRaf = moving ? requestAnimationFrame(easeBars) : 0;
}
function aimBars(targets: Map<string, number>): void {
  page.barTarget = targets;
  if (page.barRaf) return;
  page.barLast = performance.now();
  page.barRaf = requestAnimationFrame(easeBars);
}

/** The boss's bars over the fight: HP left (0–1) and its Stagger meter (0–1, -1 Staggered, NaN unknown). */
/** A source's boss bars: readings in time (the meter -1 while Staggered), and its Staggered stretches (seconds). */
export type Bars = { t: number[]; hp: number[]; meter: number[]; staggered?: [number, number][]; staggerSeconds?: number; holds?: [number, number][]; left?: [number, number][] };

/** A Staggered meter's fill at t from its readings within the stretch (between them in a straight line), if any. */
function leftAt(left: [number, number][] | undefined, s: [number, number], t: number): number | undefined {
  const inside = (left ?? []).filter(([x]) => x >= s[0] - 0.3 && x <= s[1] + 0.3);
  if (!inside.length) return undefined;
  const i = inside.findIndex(([x]) => x > t);
  if (i === 0) return inside[0][1];
  if (i < 0) return inside.at(-1)![1];
  const [[a, va], [b, vb]] = [inside[i - 1], inside[i]];
  return va + ((vb - va) * (t - a)) / Math.max(1e-6, b - a);
}

/** How much of a to b the fight's clock stood still in (cut-ins, seconds). */
const heldIn = (holds: [number, number][] | undefined, a: number, b: number): number =>
  (holds ?? []).reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);

/** The Staggered stretches of a series' meter: each run of -1 readings, to the next reading after it. */
function staggeredOf(b: Bars): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < b.t.length; i++) {
    if (b.meter[i] !== -1) continue;
    let j = i;
    while (j + 1 < b.t.length && b.meter[j + 1] === -1) j++;
    out.push([b.t[i], b.t[j + 1] ?? b.t[j]]);
    i = j;
  }
  return out;
}

/**
 * The boss's bars as the sim's fight would show them, from its track (a replay's has its meter; a search's only
 * when it was Staggered). A boss with phases (a recording's pauses) starts each phase full; without HP to go by (a
 * dummy for a time), the bar empties as the fight's damage adds up.
 */
function simBars(r: SimResult, enemy: Enemy | undefined, phaseStarts: number[], clock: (t: number) => number): Bars {
  const out: Bars = { t: [], hp: [], meter: [] };
  const track = r.track ?? [];
  // Where each later phase begins on the fight's clock (a pause after which the recording's bar was full again).
  const phases = phaseStarts.map(clock);
  const max = (phases.length ? enemy?.phaseHp : undefined) ?? r.hp ?? (track.at(-1)?.[1] || 1);
  let k = 0;
  let base = 0;
  for (const [t, dealt, meter] of track) {
    while (k < phases.length && t >= phases[k]) {
      base = dealt;
      k++;
    }
    out.t.push(t);
    out.hp.push(Math.max(0, 1 - (dealt - base) / max));
    out.meter.push(meter === -2 ? NaN : meter);
  }
  return out;
}

/** The value of a bar series at a moment (the last reading at or before it). */
function barAt(b: Bars, t: number): { hp: number; meter: number } {
  let lo = 0;
  let hi = b.t.length - 1;
  if (hi < 0 || t < b.t[0]) return { hp: 1, meter: 0 };
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (b.t[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return { hp: b.hp[lo], meter: b.meter[lo] };
}

/** Under the timeline: play it, and the boss's bars as it goes (the sim's, and the video's for a parsed run). */
/** The boss's bars for a result (the sim's; and the video's, for a parsed run), ready for the player. */
export function preparePlay(r: SimResult): { video?: Bars } {
  if (page.play.of !== (baseOf.get(r) ?? r)) {
    cancelAnimationFrame(page.play.raf);
    Object.assign(page.play, { t: 0, running: false, of: baseOf.get(r) ?? r });
  }
  // The open parsed run's: its result as the sim made it, or as fitted to the recording (what its timeline shows).
  // The Sim view's longer timeline (simLong) is the same run's: its base result decides.
  const base = baseOf.get(r) ?? r;
  const ofRun = !!page.replay?.result && (page.replay.result === base || (page.fitted?.of === page.replay.result && page.fitted.card.shown === base));
  const entry = ofRun && page.replay!.at !== undefined ? page.runs.find((x) => x.at === page.replay!.at) : undefined;
  const reading = entry && videoOf(entry);
  const asked = entry ? (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy : settings().enemy;
  const enemy = typeof asked === 'object' ? asked : asked ? enemyById(asked).enemy : undefined;
  const pauses = reading?.pauses ?? [];
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  let video: Bars | undefined;
  if (reading?.boss?.length) {
    video = { t: [], hp: [], meter: [] };
    // Up to the timeline's end: the stop (the kill's zero) can fall a fraction past the run's whole seconds.
    for (const [t, hp, meter] of reading.boss)
      if (!pauses.some(([a, b]) => t >= a && t < b)) {
        video.t.push(Math.min(clock(t), r.seconds));
        video.hp.push(hp);
        video.meter.push(meter);
      }
  }
  // A pause is a phase change only where the recording's bar refilled after it (as the replay has it); without bars,
  // any pause of 2 s or more.
  const phaseStarts = reading?.boss?.length ? phaseChanges(reading.boss, pauses) : pauses.filter(([a, b]) => b - a >= 2).map(([a]) => a);
  const sim = simBars(r, enemy, phaseStarts, clock);
  sim.staggered = (r.staggers ?? []).map((s) => [s.frame / FPS, s.end / FPS]);
  sim.staggerSeconds = enemy?.staggerSeconds;
  // The game's Stagger time stands still through a cut-in, and so does its meter's drain: the sim's own cut-ins, and
  // for the recording the replay's, made at the video's ultimates.
  sim.holds = (r as ReplayResult).freezes;
  sim.left = (r as ReplayResult).staggerLeft;
  if (video) {
    // The meter only fills between resets (a Stagger, a phase change), so within each stretch a reading is the lowest
    // read after it: a rise counts once the readings after it hold it, and misreads (a hit's flash over the meter:
    // 6.6, 13.5, 6.6 at 1:23 in the Skydrummer run) drop out.
    const phaseAt = phaseStarts.map(clock);
    const m = video.meter;
    let low = Infinity;
    for (let i = m.length - 1; i >= 0; i--) {
      const reset = !(m[i] >= 0) || phaseAt.some((p) => video!.t[i] < p && (i + 1 >= m.length || video!.t[i + 1] >= p));
      if (!(m[i] >= 0)) {
        low = Infinity;
        continue;
      }
      if (reset) low = Infinity;
      low = Math.min(low, m[i]);
      m[i] = low;
    }
    video.staggered = staggeredOf(video);
    video.staggerSeconds = enemy?.staggerSeconds;
    video.holds = (page.replay?.result as ReplayResult | undefined)?.freezes;
    // The meter's fill as the video showed it while Staggered, where the reading has it (the AI parser's).
    video.left = reading?.staggerLeft?.filter(([t]) => !pauses.some(([a, b]) => t >= a && t < b)).map(([t, v]) => [clock(t), v] as [number, number]);
  }
  // The SP bar: the sim's (a replay's), and the video's as read (seconds into the video, put on the fight's clock).
  const simSp = (r as ReplayResult).spTrack;
  const videoSp = reading?.sp?.filter(([t]) => !pauses.some(([a, b]) => t >= a && t < b)).map(([t, v]) => [clock(t), v] as [number, number]);
  // Who's controlled when (seconds): the run's swaps.
  const controlled: { slot: number; from: number; to: number }[] = [];
  let cur = r.main;
  let since = -Infinity;
  for (const p of r.presses)
    if (p.input === 'swap') {
      controlled.push({ slot: cur, from: since, to: p.frame / FPS });
      cur = p.slot;
      since = p.frame / FPS;
    }
  controlled.push({ slot: cur, from: since, to: Infinity });
  page.playBars = { sim, video, seconds: r.seconds, nodes: enemy?.nodes ?? [], phases: phaseStarts.map(clock), sp: { sim: simSp, video: videoSp }, spMax: enemy?.sp?.max ?? 300, spRegen: enemy?.sp?.regen, buffs: (r as ReplayResult).buffs, controlled };
  queueMicrotask(paintPlay);
  return { video };
}

/** The timeline's playback speed, in its header. */
const speedSelect = (): Html => html`<select class="input sim-play-speed" data-sim="play-speed" aria-label="Playback speed">
    ${[1, 2, 4].map((s) => html`<option value="${s}" ${s === page.play.speed ? 'selected' : ''}>${s}×</option>`)}
  </select>`;

const playButton = (): Html =>
  html`<button type="button" class="btn secondary sm icon-only" data-action="sim-play" title="${page.play.running ? 'Pause' : 'Play'}" aria-label="${page.play.running ? 'Pause' : 'Play'}">${icon(page.play.running ? 'pause' : 'play_arrow')}</button>`;

/** Zoom the timeline out or in (`dir` -1 or 1). */
const zoomButton = (dir: -1 | 1): Html => {
  const k = TL_ZOOMS.indexOf(page.tlZoom);
  // Wider than a phone the timeline fits the card at 1×: no narrower.
  const fits = typeof matchMedia !== 'undefined' && !matchMedia('(max-width: 640px)').matches;
  const off = dir < 0 ? k <= 0 || (fits && page.tlZoom <= 1) : k >= TL_ZOOMS.length - 1;
  return html`<button type="button" class="btn secondary sm icon-only" data-action="sim-zoom" data-value="${dir}" title="${dir < 0 ? 'Zoom out' : 'Zoom in'}" aria-label="${dir < 0 ? 'Zoom out' : 'Zoom in'}" ${off ? 'disabled' : ''}>${icon(dir < 0 ? 'remove' : 'add')}</button>`;
};

/** Play, speed and zoom over the timeline (its scrubber is the timeline's first row); `extra` after them (a parsed run's Buffs toggle). */
export function playControls(extra?: Html): Html {
  return html`<div class="sim-play">
    <div class="sim-play-left">${playButton()}${speedSelect()}${zoomButton(-1)}${zoomButton(1)}${extra ?? ''}</div>
  </div>`;
}

/** Scrolls the timeline so the playhead is in view (`center`: in the middle; else a quarter in, once it nears the edge). */
export function showPlayhead(center = false): void {
  const d = page.playBars;
  if (!d) return;
  const frac = Math.max(0, Math.min(1, (page.play.t - page.tlStart) / (d.seconds - page.tlStart)));
  for (const box of document.querySelectorAll<HTMLElement>('.sim-tl-scroll')) {
    const tl = box.firstElementChild as HTMLElement | null;
    if (!tl || box.scrollWidth <= box.clientWidth) continue;
    const label = parseFloat(getComputedStyle(tl).getPropertyValue('--lane-label')) || 56;
    const x = label + 8 + (tl.clientWidth - label - 16) * frac;
    const room = box.clientWidth - label - 8;
    const left = box.scrollLeft;
    if (center) box.scrollLeft = x - label - 8 - room / 2;
    else if (x < left + label + 8 || x > left + label + 8 + room * 0.8) box.scrollLeft = x - label - 8 - room / 4;
  }
}

/**
 * The boss's HP and Stagger bars for one source, painted as the timeline plays: its phase under the name (a boss with
 * more than one), its Stagger nodes marked on the meter with the game's brackets.
 */
/**
 * A source's boss bars at the playhead: HP's width, the Stagger meter's (a Staggered meter drains from full to empty
 * over its stretch, as the game draws it, and never faster than the boss's Stagger duration: a kill or a phase change
 * that cuts the stretch short leaves the rest of the meter; it stands still through cut-ins, as the game's does) and
 * whether it's Staggered. The first markup draws them too, so a redraw
 * (playback's end) doesn't flash full bars before the next paint.
 */
function barsNow(b: Bars, kind?: string): { hp: string; meter: string; staggered: boolean } {
  const raw = barAt(b, page.play.t);
  // The last stretch runs to its last reading: a kill while Staggered keeps the meter at the timeline's end.
  const s = b.staggered?.find(([a, z], i, all) => page.play.t >= a && (page.play.t < z || (i === all.length - 1 && raw.meter < 0)));
  const on = !!s || (raw.meter < 0 && !b.staggered);
  // As it was where that's known (the sim's Stagger time left, the video's fill); else spread over the stretch.
  const left = s ? (leftAt(b.left, s, page.play.t) ?? Math.max(0, 1 - (page.play.t - s[0] - heldIn(b.holds, s[0], page.play.t)) / Math.max(1e-6, s[1] - s[0] - heldIn(b.holds, s[0], s[1]), b.staggerSeconds ?? 0))) : 1;
  // While playing (`kind`: which row), a reading's change slides in (barSlide); a Staggered meter drains as it is.
  const hp = kind ? barSlide(`${kind}|hp`, raw.hp) : raw.hp;
  const meter = on ? left : Number.isNaN(raw.meter) || raw.meter < 0 ? 0 : kind ? barSlide(`${kind}|meter`, raw.meter) : raw.meter;
  // A Staggered meter drains every frame: the slide follows it exactly, so it doesn't lag behind and jump up at the end.
  if (on && kind) barDrawn[`${kind}|meter`] = { v: left, from: left, to: left, start: 0, at: performance.now() };
  return { hp: `${(hp * 100).toFixed(3)}%`, meter: `${(meter * 100).toFixed(3)}%`, staggered: on };
}

/** How long a boss bar takes to slide to a new reading while playing (it holds between readings). */
const BAR_SLIDE_MS = 180;
/** Each boss bar as drawn: where it is, and the slide it's on (from where, to where, since when). */
const barDrawn: Record<string, { v: number; from: number; to: number; start: number; at: number }> = {};

/**
 * A boss bar's drawn value: it holds a reading, and when the reading changes it slides there over BAR_SLIDE_MS (eased
 * out) instead of jumping. Seeking, pausing or a gap between paints draws the reading itself.
 */
function barSlide(key: string, target: number): number {
  const now = performance.now();
  const d = barDrawn[key];
  if (!d || !page.play.running || now - d.at > 250) {
    barDrawn[key] = { v: target, from: target, to: target, start: 0, at: now };
    return target;
  }
  d.at = now;
  if (target !== d.to) Object.assign(d, { from: d.v, to: target, start: now });
  const k = d.start ? Math.min(1, (now - d.start) / BAR_SLIDE_MS) : 1;
  d.v = d.from + (d.to - d.from) * (1 - (1 - k) ** 2);
  if (k >= 1) d.start = 0;
  return d.v;
}

/** SP regained each second without doing anything (the game's natural regeneration). */
const SP_REGEN = 8;

/**
 * A series with the game bar's own animation taken out: it drains a cost and fills a gain over a few readings, so a
 * run of drops (or of rises faster than regeneration) a quarter second apart is one jump, at its first reading, to
 * where the run ends.
 */
const spJumps = new WeakMap<[number, number][], [number, number][]>();
function spSeries(series: [number, number][]): [number, number][] {
  const known = spJumps.get(series);
  if (known) return known;
  const out = series.map(([t, v]) => [t, v] as [number, number]);
  const kind = (k: number) => {
    const gap = out[k][0] - out[k - 1][0];
    const d = series[k][1] - series[k - 1][1];
    return gap > 0.6 ? 0 : d < -2 ? -1 : d > SP_REGEN * gap + 2 ? 1 : 0;
  };
  for (let k = 1; k < out.length; k++) {
    const dir = kind(k);
    if (!dir) continue;
    let end = k;
    while (end + 1 < out.length && kind(end + 1) === dir) end++;
    for (let j = k; j < end; j++) out[j][1] = series[end][1];
    k = end;
  }
  spJumps.set(series, out);
  return out;
}

/** The SP bar's value at the playhead from a series ([seconds, SP]). */
function spNow(raw: [number, number][]): number {
  const series = spSeries(raw);
  let i = 0;
  while (i + 1 < series.length && series[i + 1][0] <= page.play.t) i++;
  const [t0, v0] = series[i];
  const next = series[i + 1];
  const dt = page.play.t - t0;
  if (!next || dt < 0 || next[0] - t0 > 1) return v0;
  // Between readings the bar regenerates, 8 a second (as World.tick), up to 300: on to the next reading where
  // only regeneration (or none, full or frozen) lies between; a skill's cost or a strike's gain comes as a jump there.
  const gap = next[0] - t0;
  const d = next[1] - v0;
  if (d >= 0 && d <= SP_REGEN * gap + 2) return v0 + (d * dt) / gap;
  return Math.min(page.playBars?.spMax ?? 300, v0 + (page.playBars?.spRegen ?? SP_REGEN) * dt);
}

/** How long the drawn SP bar takes to drain a cost and to fill a gain (ms of real time), about as the game's bar animates. */
const SP_DRAIN_MS = 220;
const SP_FILL_MS = 120;
/** Each SP row's bar as drawn: where it is, and the slide it's on (from where, since when, how long). */
const spDrawn: Record<string, { v: number; from: number; start: number; ms: number; at: number }> = {};

/**
 * The SP bar's drawn value for a row: a jump (a cost or a gain, more than regeneration moves between frames) slides
 * there over SP_DRAIN_MS / SP_FILL_MS instead of snapping, on to wherever the value is by then. Seeking, pausing or a
 * gap between paints draws the value itself.
 */
function spShown(kind: string, target: number): number {
  const now = performance.now();
  const s = spDrawn[kind];
  if (!s || !page.play.running || now - s.at > 250) {
    spDrawn[kind] = { v: target, from: target, start: 0, ms: 0, at: now };
    return target;
  }
  s.at = now;
  if (!s.start && Math.abs(target - s.v) > 3) Object.assign(s, { from: s.v, start: now, ms: target < s.v ? SP_DRAIN_MS : SP_FILL_MS });
  if (s.start) {
    const k = Math.min(1, (now - s.start) / s.ms);
    s.v = s.from + (target - s.from) * k;
    if (k >= 1) s.start = 0;
  } else s.v = target;
  return s.v;
}

export function bossRow(label: string, kind: 'sim' | 'video'): Html {
  const nodes = page.playBars?.nodes ?? [];
  const b = kind === 'video' ? page.playBars?.video : page.playBars?.sim;
  const now = b ? barsNow(b) : null;
  const phase = 1 + (page.playBars?.phases.filter((p) => page.play.t >= p).length ?? 0);
  return html`<div class="sim-boss"><div class="sim-boss-row" data-bars="${kind}">
    <span class="sim-boss-label"><span class="label-12 secondary">${label}</span>${page.playBars?.phases.length ? html`<span class="label-12 sim-boss-phase">Phase ${phase}</span>` : ''}${page.playBars?.buffs?.some((b) => b.id.startsWith('inflict_'))
      ? html`<span class="sim-buffs-now lane sim-boss-infl" data-buffs-slot="-1" data-buffs-kind="infl" aria-label="The enemy's Arts Inflictions"></span>`
      : ''}</span>
    <span class="sim-boss-hp" title="HP"><i ${now ? html`style="width:${now.hp}"` : ''}></i></span>
    <span class="sim-boss-meter-wrap"><span class="sim-boss-meter" title="Stagger"><i class="${now?.staggered ? 'staggered' : ''}" ${now ? html`style="width:${now.meter}"` : ''}></i></span>${nodes.map((n) => html`<span class="sim-boss-node" style="left:${n * 100}%" title="Stagger node"></span>`)}</span>
  </div></div>`;
}

/** The team's SP bar for one source as the timeline plays: a segment per 100 (three, or the stage's), the amount beside it. */
export function spRow(kind: 'sim' | 'video'): Html {
  const series = page.playBars?.sp[kind];
  if (!series?.length) return html``;
  const v = spNow(series);
  const segments = Math.ceil((page.playBars?.spMax ?? 300) / 100);
  return html`<div class="sim-sp-row" data-sp="${kind}">
    <span class="sim-boss-label sim-sp-label"><span class="label-12 secondary">SP</span><span class="num sim-sp-value">${Math.round(v)}</span></span>
    <span class="sim-sp-bar" role="img" aria-label="SP">${Array.from({ length: segments }, (_, k) => k).map((k) => html`<span class="sim-sp-seg"><i style="width:${Math.max(0, Math.min(1, (v - k * 100) / 100)) * 100}%"></i></span>`)}</span>
  </div>`;
}

// The transcript's scroll, kept for the next draw (page.movesTop).
if (typeof document !== 'undefined')
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.classList?.contains('sim-moves')) page.movesTop = el.scrollTop;
    },
    true,
  );

/** Puts the playhead, the time and the bars where page.play.t is. */
export function paintPlay(): void {
  const d = page.playBars;
  if (!d) return;
  for (const list of document.querySelectorAll<HTMLElement>('.sim-moves:not([data-kept])')) {
    list.dataset.kept = '1';
    list.scrollTop = page.movesTop;
  }
  // On the timeline's clock, from its start (a press before the stopwatch's 0) to its end.
  const frac = Math.max(0, Math.min(1, (page.play.t - page.tlStart) / (d.seconds - page.tlStart)));
  for (const el of document.querySelectorAll<HTMLElement>('.sim-playhead')) el.style.setProperty('--p', String(frac));
  for (const el of document.querySelectorAll<HTMLElement>('.sim-play-time, .sim-buffs-time')) el.textContent = clockTime(page.play.t);
  if (page.play.running) showPlayhead();
  for (const el of document.querySelectorAll<HTMLInputElement>('.sim-play-seek')) {
    // Not while it's being dragged; a click leaves it focused, so focus alone isn't that.
    if (!el.matches(':active')) el.value = String(page.play.t);
    el.style.setProperty('--p', String(frac));
    el.parentElement?.style.setProperty('--p', String(frac));
  }
  // The transcript's move at the playhead (the last one at or before it), and any at the same moment with it.
  let at: HTMLElement | null = null;
  const rows = [...document.querySelectorAll<HTMLElement>('.sim-moves li[data-t]')];
  for (const li of rows) {
    li.classList.remove('now');
    if (Number(li.dataset.t) <= page.play.t + 1e-6) at = li;
  }
  if (page.play.t > 0 && at) {
    const t = Number(at.dataset.t);
    for (const li of rows) if (Math.abs(Number(li.dataset.t) - t) < 0.05) li.classList.add('now');
  }
  // Folded, the transcript shows only the moment at the playhead (before it starts, the first).
  const curT = Number((page.play.t > 0 && at ? at : rows[0])?.dataset.t ?? NaN);
  for (const li of rows) li.classList.toggle('cur', Math.abs(Number(li.dataset.t) - curT) < 0.05);
  // While playing, the transcript keeps the current move in view (its own list scrolls, not the page).
  if (page.play.running && at && !at.classList.contains('seen')) {
    for (const li of document.querySelectorAll<HTMLElement>('.sim-moves li.seen')) li.classList.remove('seen');
    at.classList.add('seen');
    const list = at.closest<HTMLElement>('.sim-moves');
    if (list) {
      const top = at.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + at.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = page.movesTop = Math.max(0, top - list.clientHeight / 3);
    }
  }
  for (const el of document.querySelectorAll<HTMLElement>('.sim-sp-row')) {
    const series = d.sp[el.dataset.sp as 'sim' | 'video'];
    if (!series?.length) continue;
    const v = spNow(series);
    const value = el.querySelector<HTMLElement>('.sim-sp-value');
    if (value) value.textContent = String(Math.round(v));
    // The number is the value; the bar slides to it on a jump.
    const drawn = spShown(el.dataset.sp ?? '', v);
    el.querySelectorAll<HTMLElement>('.sim-sp-seg i').forEach((seg, k) => (seg.style.width = `${Math.max(0, Math.min(1, (drawn - k * 100) / 100)) * 100}%`));
  }
  paintLive();
  paintBuffs();
  const phase = 1 + d.phases.filter((p) => page.play.t >= p).length;
  for (const el of document.querySelectorAll<HTMLElement>('.sim-boss-phase')) el.textContent = `Phase ${phase}`;
  for (const el of document.querySelectorAll<HTMLElement>('.sim-boss-row')) {
    const b = el.dataset.bars === 'video' ? d.video : d.sim;
    if (!b) continue;
    const now = barsNow(b, el.dataset.bars);
    const hpBar = el.querySelector<HTMLElement>('.sim-boss-hp i');
    const meterBar = el.querySelector<HTMLElement>('.sim-boss-meter i');
    if (hpBar) hpBar.style.width = now.hp;
    if (meterBar) {
      meterBar.style.width = now.meter;
      meterBar.classList.toggle('staggered', now.staggered);
    }
  }
}

/**
 * The loadout boxes' numbers at the playhead: each source's damage so far, each operator's total and share of the
 * team's so far, the team bar's segments. At 0:00 (never played) they show the whole fight.
 */
function paintLive(): void {
  const live = page.liveDmg;
  if (!live) return;
  const t = page.play.t;
  const full = t <= 0;
  const byOp = new Map<string, number>();
  let team = 0;
  for (const [key, series] of live) {
    const d = soFar(series, t);
    const op = key.slice(0, key.indexOf('|'));
    byOp.set(op, (byOp.get(op) ?? 0) + d);
    team += d;
  }
  const set = (sel: string, value: (el: HTMLElement) => string) => {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) el.textContent = value(el);
  };
  set('[data-live]', (el) => big(full ? Number(el.dataset.full) : soFar(live.get(el.dataset.live!), t)));
  set('[data-live-pct]', (el) => pct(full ? Number(el.dataset.full) : team ? soFar(live.get(el.dataset.livePct!), t) / team : 0));
  set('[data-live-op]', (el) => big(full ? Number(el.dataset.full) : (byOp.get(el.dataset.liveOp!) ?? 0)));
  // Shares start even and real damage takes over: each operator counts a share of one second's average damage
  // (the whole fight's over its length) on top of their own, so the first hit doesn't make one operator 100%.
  const n = byOp.size || 1;
  let whole = 0;
  for (const series of live.values()) whole += series[series.length - 1] ?? 0;
  const prior = whole / Math.max(1, page.playBars?.seconds ?? 1);
  const shareOf = (op: string) => ((byOp.get(op) ?? 0) + prior / n) / (team + prior || 1);
  set('[data-live-op-pct]', (el) => pct(full ? Number(el.dataset.full) : shareOf(el.dataset.liveOpPct!)));
  const targets = new Map<string, number>();
  for (const el of document.querySelectorAll<HTMLElement>('[data-live-bar]')) {
    const op = el.dataset.liveBar!;
    if (!targets.has(op)) targets.set(op, full ? Number(el.dataset.full) : shareOf(op));
  }
  aimBars(targets);
}

/** Plays the timeline from where it is (in real time × its speed) until its end or a pause. */
export function runPlay(): void {
  const step = (now: number) => {
    if (!page.play.running || !page.playBars) return;
    page.play.t = Math.min(page.playBars.seconds, page.play.t + ((now - page.play.last) / 1000) * page.play.speed);
    page.play.last = now;
    paintPlay();
    if (page.play.t >= page.playBars.seconds) {
      page.play.running = false;
      page.redrawPage();
      return;
    }
    page.play.raf = requestAnimationFrame(step);
  };
  page.play.last = performance.now();
  page.play.raf = requestAnimationFrame(step);
}
