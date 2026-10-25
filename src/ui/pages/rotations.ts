import { GEAR_SLOTS, artificeOf, type Loadout } from '../../domain/loadout';
import { FPS, type Enemy, type Input } from '../../domain/sim/engine';
import { compareWithVideo, fitToRecording } from '../../domain/sim/videoCheck';
import {
  BUILD_MODES,
  CHECKED,
  DEFAULT_HP,
  DEFAULT_LIMIT,
  DEFAULT_SECONDS,
  DEFAULT_TEAM,
  ENEMIES,
  FOODS,
  GOALS,
  INPUT_NAME,
  START_SP,
  STYLES,
  enemyById,
  enemySeen,
  spGained,
  styleOf,
  type BuildMode,
  type Effort,
  type Goal,
  type SimBuild,
  type SimMember,
  type SimProgress,
  type SimRequest,
  type SimResult,
  type BuffSpan,
  type ReplayResult,
  type ReplayStep,
  type SimSettings,
  type Style,
} from '../../domain/sim/team';
import { wikiId, type WikiGearFile, type WikiOperatorFile, type WikiWeaponFile } from '../../domain/wiki';
import { state, updateSettings } from '../../state';
import { cachedBannerDb, deleteSim, listSims, loadReaderDraft, loadSimVideo, saveSim, saveSimVideo, updateSim, type SavedSim } from '../../store';
import { artificeIcon, badge, essenceIcon, icon, iconOf, itemImg, metric, metrics, pageHeader, slotIcon, toggleGroup } from '../components';
import { EF_ASSETS, EF_ASSETS_CDN, itemIconUrl, mirrorUrl } from '../../domain/banners';
import { tintFor } from '../tint';
import { toast } from '../common';
import { html, type Html } from '../html';
import { infoHref, ownedOf, sideTabs, wikiFile } from './info';
import type { VideoRotation } from '../rotationReader';
import { endsAtZero } from '../../domain/rotationReader';
import { weaponRanksFor } from './loadout';

/**
 * Rotations (/rotations): pick four operators in team position order and a
 * style, and the page finds the button order that deals the most damage to
 * the training dummy in a fight's length, or defeats a dummy with the HP
 * given fastest, by playing thousands of fights with the game's own
 * skill and buff logic (domain/sim, in a worker: ui/simWorker.ts). Builds come
 * from each operator's loadout and the player's copies.
 */

const EFFORTS: [Effort, string][] = [
  ['quick', 'Quick'],
  ['normal', 'Moderate'],
  ['thorough', 'Thorough'],
];
const STYLE_NOTE: Record<Style, string> = {
  advanced: 'Swaps, animation cancels, any timing.',
  standard: 'One operator controlled, no animation cancels, any mix of skills.',
  basic: 'One operator controlled; combos as they come up, ultimates when charged, battle skills in one order.',
};

const settings = (): SimSettings => state.settings.sim ?? {};
const save = (patch: Partial<SimSettings>) => updateSettings({ sim: { ...settings(), ...patch } });
const teamOf = (s: SimSettings): SimMember[] => s.team ?? DEFAULT_TEAM;

interface CombatIndex {
  ops: string[];
  weapons: string[];
}

// The worker and what it last gave.
let worker: Worker | null = null;
let running: { key: string; progress: SimProgress | null; loading: boolean; cores?: number } | null = null;
/** This device's threads (logical processors: 2 per core with hyper-threading), and how many a search uses unless set: all but one. */
const CORES = Math.max(1, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
const AUTO_CORES = Math.max(1, CORES - 1);
let result: { key: string; result: SimResult; names: string[]; ids: string[]; at?: number } | null = null;
// Results found before (this browser's data), by request: a team shows its last one at once. Every run is kept
// (`runs`, oldest first) for the team's history.
let saved: Map<string, SavedSim<SimResult>> | null = null;
let runs: SavedSim<SimResult>[] = [];
let savedLoading = false;
/** A run picked from the history: shown until the next run or another team. */
let picked = false;
/** History: the run being renamed or noted, and the one asking to be deleted. */
let editing: number | null = null;
/** A parsed run's transcript being edited: its presses, until played again or cancelled. */
type VideoStep = VideoRotation['steps'][number];
let draft: { at: number; steps: VideoStep[]; away: [number, number][]; seconds: number; builds: SimBuild[]; orig: Pick<SavedSim<SimResult>, 'key' | 'result' | 'video' | 'name' | 'note'> } | null = null;
/** Parsed runs' list shown (true) or folded to its title row (false); null: folded while a run is open. */
let runsShown: boolean | null = null;
/**
 * A read video waiting for the player's picks: its review section (the reader's own, kept so picks survive redraws),
 * whether a draft is saved (after a reload, before it's reopened), and whether it's what the page shows.
 */
let readerEl: HTMLElement | null = null;
let hasDraft = false;
let draftOpen = false;
const onDraft = (el: HTMLElement | null): void => {
  readerEl = el;
  hasDraft = !!el;
  draftOpen = !!el;
  if (el) replay = null;
  redrawPage();
};
/** A reviewed read goes to the sim: its run opens when played. */
const simulated = (v: VideoRotation): void => {
  video = v;
  lastVideo = v;
  void saveSimVideo(v);
  draftOpen = false;
  redrawPage();
};
/** The review section into its place on the page, after each redraw. */
function mountReader(): void {
  const m = document.querySelector<HTMLElement>('[data-reader-mount]');
  if (m && readerEl && readerEl.parentElement !== m) m.replaceChildren(readerEl);
}

/** The pauses after which the boss's bar was full again (a phase change), by their start, from the recording's bars. */
function phaseChanges(boss: [number, number, number][], pauses: [number, number][]): number[] {
  return pauses.filter(([a]) => {
    const i = boss.findIndex(([t]) => t >= a);
    const before = boss[(i < 0 ? boss.length : i) - 1];
    const after = boss[i];
    return !!before && !!after && after[1] > before[1] + 0.3;
  }).map(([a]) => a);
}
let deleting: number | null = null;

function loadSaved(redraw: () => void): void {
  if (saved || savedLoading) return;
  savedLoading = true;
  void Promise.all([listSims<SimResult>(), loadSimVideo<VideoRotation>(), loadReaderDraft<unknown>()]).then(([list, v, d]) => {
    runs = list;
    saved = new Map(list.map((x) => [x.key, x]));
    lastVideo ??= v ?? null;
    hasDraft ||= !!d;
    redraw();
  });
}

/** A team by its characters (any order, any loadouts). */
const teamKey = (names: string[]) => names.slice().sort().join('|');
let failed = '';
let seq = 0;

/** A gameplay video's rotation (ui/rotationReader.ts) waiting to be played in the sim, and what it gave. */
let video: VideoRotation | null = null;
/** The last video read, kept in this browser: played again after fixing a loadout, without reading the video again. */
let lastVideo: VideoRotation | null = null;
let replay: { names: string[]; ids: string[]; result?: ReplayResult; error?: string; at?: number } | null = null;
let replayWorker: Worker | null = null;
let redrawPage: () => void = () => {};

/**
 * Plays a video's presses in the sim (the worker's replay), the team as the page has it. A new parsed run, or with
 * `into` that saved run again (its transcript edited), keeping its star, name and note.
 */
function runReplay(v: VideoRotation, at: number[], req: SimRequest, names: string[], ids: string[], redraw: () => void, into?: SavedSim<SimResult>): void {
  replayWorker?.terminate();
  // Replaying into the open run keeps its last result on screen until the new one replaces it.
  const shown = into && replay?.at === into.at && replay.result ? replay.result : (into?.result as ReplayResult | undefined);
  replay = { names, ids, at: into?.at, ...(shown ? { result: shown } : {}) };
  const steps: ReplayStep[] = v.steps.map((x) => ({ t: x.t, slot: at[x.slot], input: x.input, ...(x.interrupt ? { interrupt: true } : {}), ...(x.back !== undefined ? { back: x.back } : {}) }));
  const w = new Worker(new URL('../simWorker.ts', import.meta.url), { type: 'module' });
  replayWorker = w;
  const id = ++seq;
  w.onmessage = (e: MessageEvent<{ id: number; result?: ReplayResult; error?: string }>) => {
    if (e.data.id !== id || replayWorker !== w) return;
    if (e.data.result || e.data.error) {
      const at = into?.at ?? Date.now();
      replay = { names, ids, result: e.data.result, error: e.data.error, at };
      // Kept in the history too, marked as a recording, with its reading.
      const key = JSON.stringify({ ...req, video: true });
      if (e.data.result && into) {
        Object.assign(into, { key, result: e.data.result, video: v });
        void updateSim(at, { key, result: e.data.result, video: v });
      } else if (e.data.result) {
        const entry = { key, result: e.data.result, names, ids, at, video: v };
        runs.push(entry);
        void saveSim(entry);
      }
      w.terminate();
      replayWorker = null;
      redraw();
    }
  };
  // Readings saved before the stopwatch was read have no end: the fight's length stands in.
  w.postMessage({ id, req, replay: steps, stopwatch: { end: v.end ?? v.seconds, pauses: v.pauses ?? [], away: v.away ?? [], guard: v.guard ?? [], ...(v.boss ? { phases: phaseChanges(v.boss, v.pauses ?? []) } : {}) } });
}

/** Plays the edited transcript into its run; `close` also leaves the editor (the checkmark), else it stays (refresh). */
function playDraft(close: boolean): void {
  const entry = draft && runs.find((x) => x.at === draft!.at);
  const reading = entry && videoOf(entry);
  if (!entry || !reading || !draft) return;
  const { video: _, ...asked } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
  const away = draft.away.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  // The fight's length as edited: the stopwatch's stop moves with it (the boss dies then).
  const longer = draft.seconds - reading.seconds;
  const req = { ...asked, seconds: draft.seconds, builds: draft.builds };
  const edited = { ...reading, steps: draft.steps.slice().sort((a, b) => a.t - b.t), away, seconds: draft.seconds, end: (reading.end ?? reading.seconds) + longer };
  if (close) draft = null;
  runReplay(edited, edited.names.map((_, i) => i), req, entry.names, entry.ids, redrawPage, entry);
}

/** A parsed run as a file to share or open elsewhere (Import run): its reading, the request (team, loadouts, enemy), result, name and note. */
const RUN_FILE = 'itjustlogs-parsed-run';

function exportRun(x: SavedSim<SimResult>): void {
  const file = { kind: RUN_FILE, version: 1, at: x.at, name: x.name, note: x.note, names: x.names, ids: x.ids, request: JSON.parse(x.key), result: x.result, video: videoOf(x) };
  const title = (x.name ?? `${x.names.join('-')}-${new Date(x.at).toISOString().slice(0, 10)}`).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `parsed-run-${title || 'run'}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens an exported parsed run's text: it joins Parsed runs (as new, so it never replaces one) and opens. False if it isn't one. */
function openRun(text: string): boolean {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return false;
  }
  if (d?.kind !== RUN_FILE || !d.result || !Array.isArray(d.names) || !d.request) return false;
  const entry: SavedSim<SimResult> = { key: JSON.stringify({ ...d.request, video: true }), result: d.result, names: d.names, ids: d.ids ?? [], at: Date.now(), ...(d.name ? { name: d.name } : {}), ...(d.note ? { note: d.note } : {}), ...(d.video ? { video: d.video } : {}) };
  runs.push(entry);
  void saveSim(entry);
  replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
  redrawPage();
  return true;
}

/** Import run: picks an exported parsed run's file and opens it. */
function importRun(): void {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f && !openRun(await f.text())) toast('That file isn’t an exported parsed run.', 'error');
  };
  input.click();
}

/**
 * Files or text pasted or dropped on the Parser: a recording is parsed (as Parse gameplay), an exported run
 * opened (as Import run). False if it's neither, for the site's own import to try.
 */
export async function parserFiles(files: File[], text = ''): Promise<boolean> {
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) {
    void import('../rotationReader').then((m) => m.readGameplayFile(video, allNames, simulated, onDraft));
    return true;
  }
  const json = files.find((f) => f.type.includes('json') || f.name.toLowerCase().endsWith('.json'));
  return openRun(json ? await json.text() : text);
}

/**
 * The open parsed run, above the Recording: its time and name, its buttons under them (Edit transcript, star, edit,
 * delete), the name and note fields while edited, and the transcript editor.
 */
function runHead(title: string, body: Html, enemy = ''): Html {
  const entry = replay?.at === undefined ? undefined : runs.find((x) => x.at === replay!.at);
  if (!entry) return html`<section class="card"><div class="card-body sim-card">${body}</div></section>`;
  // Editing (Edit): its name and note fields where they show.
  const editing = draft?.at === entry.at;
  const at = String(entry.at);
  // The timeline's view and speed at the top (play and its time stay by the scrubber).
  const played = replay?.result && !replay.error ? replay : null;
  const rec = played ? recordingCard(played).recording : undefined;
  // Not a card: the run's header and summary lie on the page, its loadouts in their own boxes.
  return html`<section class="sim-run-head">
      <header class="sim-run-header">
        ${laneFoe ? foeFace(laneFoe, 'sim-run-foe') : ''}
        <div class="sim-run-title">
          <div class="sim-run-name-row">
            ${editing
              ? html`<span class="heading-24 sim-run-name-wrap" data-value="${entry.name ?? title}"><input class="heading-24 sim-run-name" data-sim="runname" data-at="${at}" data-title="${title}" value="${entry.name ?? title}" placeholder="${title}" aria-label="Name" maxlength="80" size="1" /></span>`
              : html`<h2 class="heading-24">${entry.name ?? title}</h2>`}
            ${draft?.at === entry.at
              ? html`<button type="button" class="btn primary sm icon-only" data-action="sim-step-save" title="${replayWorker ? 'Playing…' : 'Play edited transcript'}" aria-label="Play edited transcript" ${replayWorker ? 'disabled' : ''}>${icon(replayWorker ? 'hourglass_empty' : 'refresh')}</button>`
              : ''}
          </div>
          <p class="copy-14 secondary sim-run-sub">${when(entry.at)} · ${runLine(entry, entry.names)}${enemy ? ` · ${enemy}` : ''}</p>
        </div>
        <div class="sim-run-buttons">
          ${played && rec ? html`<div class="sim-run-play">${toggleGroup('sim-view', [['recording', 'Recording'], ['sim', 'Sim']], view)}</div>` : ''}
          ${draft?.at === entry.at
            ? html`<button type="button" class="btn error sm icon-only" data-action="sim-step-cancel" title="Discard changes" aria-label="Discard changes">${icon('close')}</button><button type="button" class="btn secondary sm icon-only" data-action="sim-step-done" title="Save changes" aria-label="Save changes" ${replayWorker ? 'disabled' : ''}>${icon('check')}</button>`
            : videoOf(entry)
              ? html`<button type="button" class="btn secondary sm icon-only" data-action="sim-transcript" data-value="${String(entry.at)}" title="Edit name, note, loadouts and transcript" aria-label="Edit">${icon('edit')}</button>`
              : ''}
          <button type="button" class="btn secondary sm icon-only" data-action="sim-export" data-value="${String(entry.at)}" title="Export" aria-label="Export">${icon('ios_share')}</button>
          ${headTools(entry)}
        </div>
      </header>
      ${body}
    </section>`;
}

/**
 * Where the replay parts from the video's boss bars (its HP and Stagger meter, read by the parser), so the
 * transcript can be fixed there.
 */
function videoCheck(r: NonNullable<typeof replay>): Html {
  const entry = r.at === undefined ? undefined : runs.find((x) => x.at === r.at);
  const reading = entry && videoOf(entry);
  const track = r.result?.track;
  if (!entry || !reading?.boss?.length || !track?.length) return html``;
  const asked = (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy;
  const enemy = typeof asked === 'object' ? asked : enemyById(asked).enemy;
  if (!enemy.phaseHp || !enemy.poise) return html``;
  const dismissed = new Set(entry.dismissed ?? []);
  const keyOf = (d: { kind: string; t: number }) => `${d.kind}@${d.t.toFixed(1)}`;
  const all = compareWithVideo(track, reading.boss, reading.pauses ?? [], enemy.phaseHp, enemy.poise);
  const found = all.filter((d) => !dismissed.has(keyOf(d)));
  const hidden = all.length - found.length;
  const what = (d: (typeof found)[number]) =>
    d.kind === 'damage'
      ? `Damage ${Math.round(Math.abs(d.by) * 100)}% ${d.by > 0 ? 'above' : 'below'} the video`
      : d.kind === 'staggered'
        ? d.by > 0
          ? 'Staggered before the video'
          : 'Staggered after the video'
        : `Stagger ${Math.abs(d.by)} ${d.by > 0 ? 'above' : 'below'} the video`;
  const at = String(entry.at);
  return html`<div class="sim-fold">
    <div class="sim-fold-head">${foldButton('checks', `Recording-sim discrepancies${found.length ? ` (${found.length})` : ''}`)}</div>
    ${!fold.checks
      ? ''
      : found.length
      ? html`<ol class="sim-check copy-14">
          ${found.map(
            (d) => html`<li>
              <span class="num secondary">${clockTime(d.t)}</span>
              <span class="min0">${what(d)}${d.hint ? html` <span class="secondary">· ${d.hint}</span>` : ''}</span>
              <button type="button" class="btn tertiary sm icon-only" data-action="sim-dismiss" data-at="${at}" data-value="${keyOf(d)}" title="Dismiss" aria-label="Dismiss">${icon('check')}</button>
            </li>`,
          )}
        </ol>`
        : html`<p class="copy-14 secondary">${all.length ? 'All dismissed.' : 'Matches the boss’s bars: damage within 10%, Stagger within 12.'}</p>`}
    ${fold.checks && hidden ? html`<div class="sim-run"><button type="button" class="btn tertiary sm" data-action="sim-undismiss" data-value="${at}">Show ${hidden} dismissed</button></div>` : ''}
  </div>`;
}

/**
 * A parsed run's own track, 1:1 with the recording (recordingTrack): the Parser tab's timeline shows it by default,
 * with the video's boss bars, and a switch shows the sim's instead (its damage lane on the same scale).
 */
/** The last fit (recordingCard), kept while its run's result is the same one: the timeline's player plays the object it was given and starts over when a redraw hands it another. */
let fitted: { of: ReplayResult; card: RecordingCard } | null = null;
type RecordingCard = { recording?: Track; simTrack?: Track; dpsMax?: number; unattributed?: number; afterKill?: number; shown: ReplayResult; live?: LiveDamage };
/** Damage so far at the end of each second of the fight, by `<operator>|<source>` (the fit's numbers), for playback. */
type LiveDamage = Map<string, number[]>;
/** The open run's, while its timeline can play (paintPlay updates the loadout boxes from it). */
let liveDmg: LiveDamage | undefined;

/**
 * The loadout boxes' team bars ease to their share at the playhead (a seek, the first Play from the whole fight's
 * shares to an even start) instead of jumping: what each segment shows now (`<box>|<operator>`, kept across redraws,
 * so a redrawn bar goes on from there), and where each operator's is headed.
 */
const barShown = new Map<string, number>();
let barTarget: Map<string, number> | null = null;
let barRaf = 0;
let barLast = 0;
function easeBars(now: number): void {
  // About a fifth of a second to get most of the way there.
  const k = 1 - Math.exp(-(now - barLast) / 90);
  barLast = now;
  let moving = false;
  for (const el of document.querySelectorAll<HTMLElement>('[data-live-bar]')) {
    const key = `${el.dataset.liveBox}|${el.dataset.liveBar}`;
    const target = barTarget?.get(el.dataset.liveBar!) ?? Number(el.dataset.full);
    const was = barShown.get(key) ?? target;
    const next = Math.abs(target - was) < 0.0005 ? target : was + (target - was) * k;
    if (next !== target) moving = true;
    barShown.set(key, next);
    el.style.flexBasis = `${next * 100}%`;
  }
  barRaf = moving ? requestAnimationFrame(easeBars) : 0;
}
function aimBars(targets: Map<string, number>): void {
  barTarget = targets;
  if (barRaf) return;
  barLast = performance.now();
  barRaf = requestAnimationFrame(easeBars);
}

/** Damage so far at a moment: the cumulative series' second before it plus its share of that second. */
function soFar(series: number[] | undefined, t: number): number {
  if (!series?.length) return 0;
  const k = Math.floor(t);
  if (k >= series.length) return series[series.length - 1];
  const before = k > 0 ? series[k - 1] : 0;
  return before + (series[k] - before) * (t - k);
}

/**
 * Each action's damage on a track: the sim's own presses and strikes by index, a recording's matched to the sim's
 * (same operator and kind, the nearest within 3 s, each used once).
 */
function withDamage(track: Track, sim: { presses: Track['presses']; strikes: Track['strikes'] }, press: number[], strike: number[], same: boolean): Track {
  if (same) return { ...track, pressDmg: press, strikeDmg: strike };
  const m = matchActions(track, sim);
  return { ...track, pressDmg: m.presses.map((j) => (j === undefined ? undefined : press[j])), strikeDmg: m.strikes.map((j) => (j === undefined ? undefined : strike[j])) };
}

/** A recording's actions matched to the sim's: for each, the index of the sim's (same operator and kind, the nearest within 3 s, each used once). */
function matchActions(track: Pick<Track, 'presses' | 'strikes'>, sim: Pick<Track, 'presses' | 'strikes'>): { presses: (number | undefined)[]; strikes: (number | undefined)[] } {
  const near = <T extends { frame: number; slot: number }>(mine: T[], theirs: T[], fits: (a: T, b: T) => boolean) => {
    const used = new Set<number>();
    return mine.map((a) => {
      let best = -1;
      theirs.forEach((b, i) => {
        if (used.has(i) || a.slot !== b.slot || !fits(a, b) || Math.abs(a.frame - b.frame) > 3 * FPS) return;
        if (best < 0 || Math.abs(a.frame - b.frame) < Math.abs(a.frame - theirs[best].frame)) best = i;
      });
      if (best < 0) return undefined;
      used.add(best);
      return best;
    });
  };
  return { presses: near(track.presses, sim.presses, (a, b) => a.input === b.input), strikes: near(track.strikes, sim.strikes, (a, b) => a.finisher === b.finisher) };
}

/** A battle skill's cost unless its data says otherwise (SkillPatchTable `cost`; the sim's own presses know it exactly). */
const BATTLE_COST = 100;
/**
 * The recording's SP amounts in the game's own: a skill costs and a Final Strike gives what its data says, so the bar's
 * pixel-sized read (a 101 or 102) takes the sim's amount for the same action (or a battle skill's usual cost when the
 * sim has none and the read is near it); the bar after it is then the bar read just before plus that amount.
 */
function withExactSp(track: Track, sim: Track): Track {
  if (!sim.pressSp) return track;
  const m = matchActions(track, sim);
  // A reading without the SP bar (read before it was, or elsewhere): each action's amount from the sim's same action,
  // no bar after it (the video didn't give one).
  if (!track.pressSp) {
    const take = (idx: (number | undefined)[], theirs: (number | undefined)[] | undefined) => idx.map((j) => (j === undefined ? undefined : theirs?.[j]));
    return { ...track, pressSp: take(m.presses, sim.pressSp), strikeSp: take(m.strikes, sim.strikeSp) };
  }
  const exact = (read: (number | undefined)[], after: (number | undefined)[] | undefined, theirs: (number | undefined)[] | undefined, idx: (number | undefined)[], usual?: number) => {
    const sp = read.map((x, i) => {
      // None read (a combo or ultimate moves no SP): the sim's same action's, so every action has one.
      if (x === undefined) return idx[i] === undefined ? undefined : theirs?.[idx[i]!];
      if (x === 0) return x;
      const j = idx[i];
      const t = j === undefined ? undefined : theirs?.[j];
      if (t) return t;
      return usual !== undefined && Math.abs(x - usual) <= 15 ? usual : x;
    });
    const spAfter = after?.map((a, i) => (a === undefined || read[i] === undefined || sp[i] === undefined ? a : Math.max(0, Math.min(300, Math.round(a - read[i]! + sp[i]!)))));
    return { sp, spAfter };
  };
  // A press's usual amount by kind: only a battle skill's is known without the sim.
  const presses = exact(track.pressSp, track.pressSpAfter, sim.pressSp, m.presses, undefined);
  const battle = track.presses.map((p, i) => (p.input === 'battle' && presses.sp[i] !== undefined && presses.sp[i] === track.pressSp![i] && Math.abs(track.pressSp![i]! + BATTLE_COST) <= 15 ? -BATTLE_COST : presses.sp[i]));
  const spAfterP = presses.spAfter?.map((a, i) => (a === undefined || battle[i] === presses.sp[i] ? a : Math.max(0, Math.min(300, Math.round(a - presses.sp[i]! + battle[i]!)))));
  const strikes = exact(track.strikeSp ?? [], track.strikeSpAfter, sim.strikeSp, m.strikes);
  return { ...track, pressSp: battle, pressSpAfter: spAfterP, strikeSp: strikes.sp, strikeSpAfter: strikes.spAfter };
}

function recordingCard(r: NonNullable<typeof replay>): RecordingCard {
  if (r.result && fitted?.of === r.result) return fitted.card;
  const card = fitRecording(r);
  if (r.result) fitted = { of: r.result, card };
  return card;
}

function fitRecording(r: NonNullable<typeof replay>): RecordingCard {
  const entry = r.at === undefined ? undefined : runs.find((x) => x.at === r.at);
  const reading = entry && videoOf(entry);
  if (!r.result || !entry || !reading?.boss?.length) return { shown: r.result! };
  const asked = (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy;
  const enemy = typeof asked === 'object' ? asked : asked ? enemyById(asked).enemy : undefined;
  const phaseHp = enemy?.phaseHp ?? r.result.hp ?? 0;
  const rec = recordingTrack(reading, r.result.seconds, phaseHp, enemy?.nodes ?? []);
  const sim = simTrack(r.result);
  // The Parser tells what each operator did: the recording's damage, split as the sim split its own.
  const fit = fitToRecording(r.result, reading.boss, reading.pauses ?? [], phaseHp);
  // Each action's damage, every second of it scaled as the fit scales that second.
  const ad = r.result.actionDamage;
  const sum = (pairs: [number, number][]) => Math.round(pairs.reduce((n, [s, d]) => n + d * fit.scaleAt(s), 0));
  const press = ad?.presses.map(sum) ?? [];
  const strike = ad?.strikes.map(sum) ?? [];
  const simWithDmg = ad ? withDamage(sim, sim, press, strike, true) : sim;
  const asp = r.result.actionSp;
  const simWith = asp ? { ...simWithDmg, pressSp: asp.presses, strikeSp: asp.strikes, pressSpAfter: asp.pressesAfter, strikeSpAfter: asp.strikesAfter } : simWithDmg;
  // Each source's damage so far, each second scaled as the fit scales it.
  const live: LiveDamage = new Map();
  const per = r.result.perSecond ?? [];
  for (const sec of per) for (const key of Object.keys(sec ?? {})) if (!live.has(key)) live.set(key, []);
  for (const [key, series] of live) {
    let run = 0;
    for (let k = 0; k < per.length; k++) {
      run += (per[k]?.[key] ?? 0) * fit.scaleAt(k);
      series.push(run);
    }
  }
  const recWith = withExactSp(ad ? withDamage(rec, sim, press, strike, false) : rec, simWith);
  return { recording: recWith, simTrack: simWith, dpsMax: Math.max(...rec.dps, ...sim.dps, 0), unattributed: fit.unattributed, afterKill: fit.afterKill, shown: fit.result, live };
}

/** The video's rotation as the sim played it: the usual results, and the presses it couldn't make. */
function replayView(r: NonNullable<typeof replay>, card?: ReturnType<typeof recordingCard>): Html {
  const missed = r.result?.missed ?? [];
  return html`<section class="sim-video">
    ${r.error
      ? html`<p class="copy-14 sim-error">${r.error}</p>`
      : !r.result
        ? html`<p class="copy-14 secondary">${icon('hourglass_empty')} Playing the recording’s actions…</p>`
        : html`${(() => {
            const c = card ?? recordingCard(r);
            const entry = draft && r.at !== undefined && draft.at === r.at ? runs.find((x) => x.at === r.at) : undefined;
            const long = view === 'sim' ? simLong(c.shown, r.result as ReplayResult) : undefined;
            return resultsView(c.shown, r.names, r.ids, false, { ...c, ...(long && long !== c.shown ? { timeline: long, simTrack: withRunOn(c.simTrack ?? simTrack(c.shown), long) } : {}), underTimeline: videoCheck(r), noMetrics: !!card, editor: entry ? (track: Track) => transcriptLines(entry, track) : undefined });
          })()}
            ${missed.length ? html`<p class="copy-13 secondary">The sim couldn’t make ${missed.length === 1 ? 'this action' : `these ${missed.length} actions`} in time: ${missed.map((m) => `${secs(m.t * FPS)} ${r.names[m.slot]} · ${m.input === 'strike' ? 'Final Strike' : INPUT_NAME[m.input]}`).join(', ')}.</p>` : ''}`}
  </section>`;
}

function stop(): void {
  worker?.terminate();
  worker = null;
  running = null;
}

function run(req: SimRequest, key: string, names: string[], cores: number, redraw: () => void): void {
  stop();
  failed = '';
  picked = false;
  worker = new Worker(new URL('../simWorker.ts', import.meta.url), { type: 'module' });
  const id = ++seq;
  running = { key, progress: null, loading: true };
  worker.onmessage = (e: MessageEvent<{ id: number; loaded?: boolean; cores?: number; progress?: SimProgress; result?: SimResult; error?: string }>) => {
    if (e.data.id !== id || !running) return;
    if (e.data.loaded) running.loading = false;
    if (e.data.cores) running.cores = e.data.cores;
    if (e.data.progress) running.progress = e.data.progress;
    if (e.data.result) {
      const entry = { key, result: e.data.result, names, ids: req.builds.map((b) => b.op), at: Date.now() };
      result = entry;
      saved?.set(key, entry);
      runs.push(entry);
      void saveSim(entry);
      stop();
    }
    if (e.data.error) {
      failed = e.data.error;
      stop();
    }
    redraw();
  };
  worker.postMessage({ id, req, cores });
}

/** The page's clicks (app.ts passes them on, then redraws). True if it was one of theirs. */
export function simAction(action: string, el: HTMLElement): boolean {
  const v = el.dataset.value ?? '';
  const team = teamOf(settings());
  if (action !== 'sim-delete') deleting = null;
  switch (action) {
    case 'sim-style':
      save({ style: v as Style });
      return true;
    case 'sim-effort':
      save({ effort: v as Effort });
      return true;
    case 'sim-builds':
      save({ builds: v as BuildMode });
      return true;
    case 'sim-goal':
      save({ goal: v as Goal });
      return true;
    case 'sim-up':
    case 'sim-down': {
      const i = Number(v);
      const j = action === 'sim-up' ? i - 1 : i + 1;
      if (j < 0 || j >= team.length) return true;
      const next = team.slice();
      [next[i], next[j]] = [next[j], next[i]];
      save({ team: next });
      return true;
    }
    case 'sim-stop':
      stop();
      return true;
    case 'sim-past': {
      draftOpen = false;
      const entry = runs.find((x) => String(x.at) === v);
      // A parsed run that's open closes when clicked again (its title, team and results go with it).
      if (entry && isRecording(entry) && replay?.at === entry.at && !replayWorker) {
        replay = null;
        runsShown = null;
        if (draft?.at === entry.at) draft = null;
      } else if (entry && isRecording(entry)) {
        replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
        // The list folds away so the run's title sits near the top; its toggle brings it back.
        runsShown = null;
      }
      else if (entry && !running) {
        result = { ...entry };
        picked = true;
      }
      return true;
    }
    case 'sim-art': {
      // A gear piece's Artifice while a parsed run is edited: the next level, 3 back to 0.
      const [i, k] = (el.dataset.value ?? '').split(':').map(Number);
      const g = draft?.builds[i]?.gear[k];
      if (!g) return false;
      const next = ((g.artifice ?? 0) + 1) % 4;
      editBuild(i, `art${k}`, next);
      el.innerHTML = String(artificeIcon(next));
      el.title = `Artifice ${next}: click to change`;
      return false;
    }
    case 'sim-main': {
      // An operator's box clicked while editing (not one of its fields): they made every Final Strike and Finisher.
      if (!draft || (el !== (window.event?.target as HTMLElement | null) && (window.event?.target as HTMLElement | null)?.closest('input, select, button, a, label'))) return false;
      for (const step of draft.steps) if (step.input === 'strike' || step.input === 'finisher') step.slot = Number(v) as VideoStep['slot'];
      return true;
    }
    case 'sim-runs':
      runsShown = !(runsShown ?? replay?.at === undefined);
      return true;
    case 'sim-fav': {
      const entry = runs.find((x) => String(x.at) === v);
      if (entry) {
        entry.fav = !entry.fav || undefined;
        void updateSim(entry.at, { fav: entry.fav });
      }
      return true;
    }
    case 'sim-edit':
      editing = editing === Number(v) ? null : Number(v);
      return true;
    // A recording-sim discrepancy put away (or all of them back).
    case 'sim-dismiss': {
      const entry = runs.find((x) => String(x.at) === el.dataset.at);
      if (!entry) return false;
      entry.dismissed = [...new Set([...(entry.dismissed ?? []), v])];
      void updateSim(entry.at, { dismissed: entry.dismissed });
      return true;
    }
    case 'sim-undismiss': {
      const entry = runs.find((x) => String(x.at) === v);
      if (!entry) return false;
      entry.dismissed = undefined;
      void updateSim(entry.at, { dismissed: undefined });
      return true;
    }
    case 'sim-fold':
      if (v === 'video' || v === 'checks' || v === 'buffs' || v === 'moves') fold[v] = !fold[v];
      return true;
    case 'sim-view':
      if (v === 'recording' || v === 'sim') view = v;
      return true;
    case 'sim-seek': {
      if (!playBars) return false;
      play.t = Math.max(0, Math.min(playBars.seconds, Number(v)));
      if (play.running) play.last = performance.now();
      paintPlay();
      document.querySelector('.sim-play')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return false;
    }
    case 'sim-play':
      if (!playBars) return false;
      play.running = !play.running;
      if (play.running) {
        if (play.t >= playBars.seconds) play.t = 0;
        runPlay();
      } else cancelAnimationFrame(play.raf);
      return true;
    case 'sim-transcript': {
      const entry = runs.find((x) => String(x.at) === v);
      const reading = entry && videoOf(entry);
      // The run as it was is kept, so the X can put it back after previews and name or note changes.
      draft = draft?.at === entry?.at || !entry || !reading ? null : { at: entry.at, steps: reading.steps.map((x) => ({ ...x })), away: (reading.away ?? []).map(([a, b]) => [a, b]), seconds: reading.seconds, builds: JSON.parse(JSON.stringify((JSON.parse(entry.key) as SimRequest).builds)), orig: { key: entry.key, result: entry.result, video: entry.video, name: entry.name, note: entry.note } };
      return true;
    }
    case 'sim-step-add':
      if (draft) {
        const last = draft.steps[draft.steps.length - 1];
        draft.steps.push({ t: Math.round(((last?.t ?? 0) + 0.5) * 100) / 100, slot: last?.slot ?? 0, input: 'battle' });
      }
      return true;
    case 'sim-step-del':
      draft?.steps.splice(Number(v), 1);
      return true;
    case 'sim-away-add':
      if (draft) {
        const from = draft.away[draft.away.length - 1]?.[1] ?? draft.steps[draft.steps.length - 1]?.t ?? 0;
        draft.away.push([from, Math.round((from + 5) * 100) / 100]);
      }
      return true;
    case 'sim-away-del':
      draft?.away.splice(Number(v), 1);
      return true;
    // X: every change since Edit is discarded (previews, name, note), and the run is as it was.
    case 'sim-step-cancel': {
      const entry = draft && runs.find((x) => x.at === draft!.at);
      if (entry && draft) {
        replayWorker?.terminate();
        replayWorker = null;
        Object.assign(entry, draft.orig);
        void updateSim(entry.at, draft.orig);
        replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
      }
      draft = null;
      return true;
    }
    // Refresh plays the edited transcript and stays in the editor; the checkmark plays it and closes the editor.
    case 'sim-step-save':
    case 'sim-step-done':
      playDraft(action === 'sim-step-done');
      return true;
    case 'sim-delete': {
      const at = Number(v);
      // A starred run is kept: unstar it to delete it.
      if (runs.find((x) => x.at === at)?.fav) return false;
      if (deleting !== at) {
        deleting = at;
        return true;
      }
      deleting = null;
      if (draft?.at === at) draft = null;
      const gone = runs.find((x) => x.at === at);
      runs = runs.filter((x) => x.at !== at);
      if (gone && saved?.get(gone.key) === gone) {
        const left = runs.filter((x) => x.key === gone.key).pop();
        if (left) saved.set(gone.key, left);
        else saved.delete(gone.key);
      }
      if (result?.at === at) {
        result = null;
        picked = false;
      }
      if (replay?.at === at) replay = null;
      void deleteSim(at);
      return true;
    }
    case 'sim-read':
      void import('../rotationReader').then((m) => m.readGameplay(allNames, simulated, onDraft));
      return true;
    // The read waiting for picks: shown again, or reopened from its saved draft.
    case 'sim-draft':
      if (readerEl) {
        draftOpen = true;
        replay = null;
        return true;
      }
      void import('../rotationReader').then((m) => m.openReaderDraft(allNames, simulated, onDraft));
      return true;
    case 'sim-export': {
      const entry = runs.find((x) => String(x.at) === v);
      if (entry) exportRun(entry);
      return true;
    }
    case 'sim-import':
      importRun();
      return true;
    case 'sim-run':
      pending = true;
      return true;
  }
  return false;
}

/** Every operator's name, for the gameplay reader (ui/rotationReader.ts). */
let allNames: string[] = [];

/** Set by the Run button; the page starts the search when it next draws (it has the data then). */
let pending = false;

/** The page's fields. True if it was one of theirs. */
/**
 * A parsed run's loadout changed while it's edited (levelsEdit, weaponLine, the Artifice buttons): kept in the draft,
 * played with the transcript (Play edited transcript). Nothing replays or redraws per change.
 */
function editBuild(k: number, name: string, v: number | undefined): void {
  const nb = draft?.builds[k];
  if (!nb) return;
  // The defaults (level 90, rank 12) are left unset; promotion follows from them (promotionOf).
  if (name === 'level') nb.level = v === 90 ? undefined : v;
  else if (name === 'potential') nb.potential = v ?? 0;
  else if (name === 'basic' || name === 'normal' || name === 'combo' || name === 'ultimate') {
    const ranks = { ...(nb.ranks ?? {}), [name]: v };
    if (v === undefined || v === 12) delete ranks[name];
    nb.ranks = Object.keys(ranks).length ? ranks : undefined;
  } else if (nb.weapon && name === 'wlevel') nb.weapon.level = v === 90 ? undefined : v;
  else if (nb.weapon && name === 'wpotential') nb.weapon.potential = v ?? 0;
  else if (/^art\d$/.test(name) && nb.gear[Number(name[3])]) nb.gear[Number(name[3])].artifice = v ?? 0;
  else if (nb.weapon && /^rank\d$/.test(name)) {
    // A skill's rank as shown: its level, plus the weapon's Potential on the last skill. At its cap: maxed (unset).
    const caps = essenceCaps(nb);
    const x = Number(name[4]);
    const level = v === undefined ? caps[x] : Math.max(1, Math.min(caps[x], v - (x === caps.length - 1 ? (nb.weapon.potential ?? 0) : 0)));
    const levels = caps.map((_, y) => nb.weapon!.skillLevels?.[y] ?? null) as (number | null)[];
    levels[x] = level === caps[x] ? null : level;
    nb.weapon.skillLevels = levels.every((y) => y === null) ? undefined : (levels.map((y, z) => y ?? caps[z]) as number[]);
  }
  for (const key of ['level', 'ranks'] as const) if (nb[key] === undefined) delete nb[key];
  if (nb.weapon) for (const key of ['level', 'skillLevels'] as const) if (nb.weapon[key] === undefined) delete nb.weapon[key];
}

// Dragging the scrubber moves the playhead with it (its time tip, the bars, the lanes), not only on release.
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | null;
  // The run's name field grows with its text (its box sizes to a copy of it).
  if (el?.dataset?.sim === 'runname' && el.parentElement) el.parentElement.dataset.value = el.value || el.placeholder;
  if (el?.dataset?.sim !== 'play-seek') return;
  play.t = Math.max(0, Number(el.value) || 0);
  paintPlay();
});

/**
 * A time typed in the transcript editor (m:ss.s as shown, or seconds) as the recording's time: shown on the fight's
 * clock, so the stopwatch's pauses before it are added back.
 */
function videoTimeOf(text: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  let t = Number(m[1] ?? 0) * 60 + Number(m[2]);
  const entry = draft && runs.find((x) => x.at === draft!.at);
  for (const [a, b] of (entry && videoOf(entry)?.pauses) ?? []) if (t >= a) t += b - a;
  return Math.round(t * 100) / 100;
}

export function simChange(el: HTMLInputElement | HTMLSelectElement): boolean {
  const f = el.dataset.sim;
  if (!f) return false;
  const team = teamOf(settings()).slice();
  const i = Number(el.dataset.i);
  const num = (x: string) => (x.trim() === '' ? undefined : Number(x));
  // The HP goal keeps its own time limit.
  if (f === 'seconds' && settings().goal === 'hp') save({ limit: Math.max(5, Math.min(300, num(el.value) ?? DEFAULT_LIMIT)) });
  else if (f === 'seconds') save({ seconds: Math.max(5, Math.min(300, num(el.value) ?? DEFAULT_SECONDS)) });
  else if (f === 'hp') save({ hp: Math.max(1000, Math.min(1e10, Math.round(num(el.value.replace(/[,\s]/g, '')) ?? DEFAULT_HP))) });
  else if (f === 'cores') save({ cores: el.value === '' ? undefined : Math.max(1, Math.min(CORES, Number(el.value))) });
  else if (f === 'sp') save({ startSp: el.value.trim() === '' ? undefined : Math.max(0, Math.min(300, Number(el.value))) });
  // The enemy's own HP for the HP goal, until one is typed.
  else if (f === 'enemy') save({ enemy: el.value === 'dummy' ? undefined : el.value, hp: undefined });
  else if (f === 'controlled') save({ controlled: el.value || undefined });
  // Every Final Strike and Finisher in a transcript being edited: the one controlled.
  // The fight's length in a transcript being edited (seconds on its timer).
  else if (f === 'step-len') {
    // As the figure shows it (m:ss.s) or in seconds.
    const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(el.value);
    const secs = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN;
    if (draft && secs >= 1) draft.seconds = Math.round(secs * 10) / 10;
    if (draft) el.value = clockTime(draft.seconds);
  }
  else if (f === 'step-main') {
    for (const step of draft?.steps ?? []) if (step.input === 'strike' || step.input === 'finisher') step.slot = Number(el.value) as VideoStep['slot'];
    redrawPage();
  }
  // A press in a transcript being edited (no redraw, so Tab moves along; sorted by time when played).
  // A stretch the enemy is invulnerable: from, to.
  else if (f === 'away-a' || f === 'away-b') {
    const stretch = draft?.away[Number(el.dataset.k)];
    const t = videoTimeOf(el.value);
    if (stretch && t !== undefined) stretch[f === 'away-a' ? 0 : 1] = t;
  }
  else if (f === 'step-t' || f === 'step-slot' || f === 'step-input') {
    const step = draft?.steps[Number(el.dataset.k)];
    const t = f === 'step-t' ? videoTimeOf(el.value) : undefined;
    if (step && f === 'step-t') {
      if (t !== undefined) step.t = t;
    }
    else if (step && f === 'step-slot') step.slot = Number(el.value) as VideoStep['slot'];
    else if (step) step.input = el.value as VideoStep['input'];
  }
  // The timeline player: where, how fast.
  else if (f === 'play-seek') {
    play.t = Math.max(0, Number(el.value) || 0);
    paintPlay();
  } else if (f === 'play-speed') play.speed = Number(el.value) || 1;
  // A battle skill's SP gained (blank: unknown), as the game gives it (spGained: Tangtang's 0, 20, 40).
  else if (f === 'step-back') {
    const step = draft?.steps[Number(el.dataset.k)];
    const op = draft && runs.find((x) => x.at === draft!.at)?.ids[step?.slot ?? -1];
    if (step) step.back = el.value.trim() === '' ? undefined : spGained(Math.max(0, Number(el.value) || 0), op ?? undefined);
    if (step) el.value = step.back === undefined ? '' : String(step.back);
  }
  // A press that interrupted the boss's attack (the meter's +20, the big X).
  else if (f === 'step-int') {
    const step = draft?.steps[Number(el.dataset.k)];
    if (step) step.interrupt = (el as HTMLInputElement).checked || undefined;
  }
  // A run's name or note: saved as typed, shown when the edit closes (no redraw, so Tab moves between the two).
  else if (f === 'runname' || f === 'note') {
    const entry = runs.find((x) => String(x.at) === el.dataset.at);
    const value = el.value.trim() || undefined;
    // A run without a name shows its title in the field (as it does unedited); left as that, it stays unnamed.
    if (entry && f === 'runname') void updateSim(entry.at, { name: (entry.name = value === el.dataset.title ? undefined : value) });
    else if (entry) void updateSim(entry.at, { note: (entry.note = value) });
  } else if (f === 'runfood' && draft && draft.at === replay?.at) {
    const nb = draft.builds[Number(el.dataset.i)];
    if (nb && el.value) nb.food = el.value;
    else if (nb) delete nb.food;
  } else if (f === 'runfood') {
    const entry = replay?.at === undefined ? undefined : runs.find((x) => x.at === replay!.at);
    const reading = entry && videoOf(entry);
    if (entry && reading && !replayWorker) {
      const { video: _, ...req } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
      const k = Number(el.dataset.i);
      const builds = req.builds.map((b, j) => {
        if (j !== k) return b;
        const { food: _f, ...rest } = b;
        return el.value ? { ...rest, food: el.value } : rest;
      });
      runReplay(reading, reading.names.map((_, j) => j), { ...req, builds }, entry.names, entry.ids, redrawPage, entry);
    }
  } else if (f === 'runbuild') {
    const min = Number(el.getAttribute('min'));
    const max = Number(el.getAttribute('max'));
    editBuild(Number(el.dataset.i), el.dataset.field!, el.value.trim() === '' ? undefined : Math.max(min, Math.min(max, Math.round(Number(el.value)))));
    if (el.dataset.field === 'wpotential') redrawPage();
  } else if (f === 'vfood') {
    const food = { ...(settings().videoFood ?? {}) };
    if (el.value) food[el.dataset.op!] = el.value;
    else delete food[el.dataset.op!];
    save({ videoFood: food });
  } else if (f === 'uptime') save({ uptime: el.value.trim() === '' ? undefined : Math.max(10, Math.min(100, Math.round(Number(el.value)))) });
  else {
    if (f === 'op') team[i] = { op: el.value };
    else if (f === 'potential') team[i] = { ...team[i], potential: num(el.value) };
    else if (f === 'wpotential') team[i] = { ...team[i], weaponPotential: num(el.value) };
    else if (f === 'weapon') team[i] = { ...team[i], weapon: el.value || undefined };
    else if (f === 'food') team[i] = { ...team[i], food: el.value || undefined };

    save({ team });
  }
  return true;
}

interface Wiki {
  ops: WikiOperatorFile['operators'];
  weapons: WikiWeaponFile['weapons'];
  gear: WikiGearFile['gear']['items'];
}

const loadoutOf = (op: string): Loadout | undefined => state.settings.loadouts?.[op] ?? Object.entries(state.settings.loadouts ?? {}).find(([id]) => wikiId(id) === op)?.[1];

/** An operator's build from their loadout and copies (the member's Potentials when set), or why there's none. */
function buildOf(m: SimMember, wiki: Wiki, index: CombatIndex): { build: SimBuild; missing: string[] } {
  const a = state.analysis;
  const owned = ownedOf(a, 'char')?.get(m.op) ?? ownedOf(a, 'char')?.get(Object.keys(state.settings.loadouts ?? {}).find((id) => wikiId(id) === m.op) ?? '');
  const potential = m.potential ?? Math.max(0, owned?.potential ?? 0);
  const l = loadoutOf(m.op) ?? {};
  const missing: string[] = [];
  let weapon: SimBuild['weapon'];
  if (!l.weapon) missing.push('weapon');
  else if (!index.weapons.includes(l.weapon)) missing.push('weapon data');
  else {
    const w = wiki.weapons[l.weapon];
    const mine = ownedOf(a, 'weap')?.get(l.weapon);
    const wp = m.weaponPotential ?? (mine?.copies ? mine.potential : 0);
    weapon = { id: l.weapon, potential: wp, skillLevels: w ? weaponRanksFor(l.weapon, w, wp) : undefined };
  }
  const gear = GEAR_SLOTS.flatMap(({ slot }) => {
    const id = l[slot];
    const g = id ? wiki.gear[id] : undefined;
    return id && g ? [{ id, artifice: artificeOf(l, slot, g) }] : [];
  });
  if (gear.length < GEAR_SLOTS.length) missing.push(`${GEAR_SLOTS.length - gear.length} gear`);
  return { build: { op: m.op, potential, weapon, gear, ...(m.food ? { food: m.food } : {}) }, missing };
}

/** Weapons of the operator's type that have combat data (4★ and up), best rarity first. */
const weaponsFor = (op: string, wiki: Wiki, index: CombatIndex): string[] =>
  index.weapons
    .filter((id) => wiki.weapons[id]?.type === wiki.ops[op]?.weapon && wiki.weapons[id].rarity >= 4)
    .sort((a, b) => wiki.weapons[b].rarity - wiki.weapons[a].rarity || wiki.weapons[a].name.localeCompare(wiki.weapons[b].name));

/** Optimal gear: the weapon asked for (or none: the best found), Maxed Essence; the loadout's gear as where the search starts. */
function optimalBuildOf(m: SimMember, mine: SimBuild): SimBuild {
  return { op: m.op, potential: mine.potential, weapon: m.weapon ? { id: m.weapon, potential: m.weaponPotential ?? 0 } : { id: '', potential: m.weaponPotential ?? 0 }, gear: mine.gear, ...(m.food ? { food: m.food } : {}) };
}

/**
 * Each limited operator's signature weapon: the Arsenal Issue that ran with their banner (special_<n> with
 * weponbox_<n>: Winter Hunt's Typhoeus with Deep Cold Issue's Umbra of Frigid Eventide).
 */
function signatureWeapons(): Record<string, string> {
  const db = cachedBannerDb();
  const out: Record<string, string> = {};
  for (const [pool, b] of Object.entries(db)) {
    if (!pool.startsWith('special_')) continue;
    const weapon = db[`weponbox_${pool.slice('special_'.length)}`]?.rateUpIds?.find((id) => id.startsWith('wpn_'));
    if (weapon) for (const op of b.rateUpIds ?? []) if (op.startsWith('chr_')) out[op] = weapon;
  }
  return out;
}

/** Weapons only Arsenal Issues give: their rate-ups (weponbox_ pools; weaponbox_constant_ is the standard pool). */
const limitedWeapons = (): string[] =>
  [...new Set(Object.entries(cachedBannerDb()).flatMap(([pool, b]) => (pool.startsWith('weponbox_') ? (b.rateUpIds ?? []).filter((id) => id.startsWith('wpn_')) : [])))].sort();

/** How the page finds a rotation, for the curious. */
const HOW: [string, string][] = [
  ['Fight', 'The training dummy (DEF 100, a 280 Stagger meter, Staggered 12 s), frame by frame at 30 fps. Each operator runs the game’s own skill, buff and talent files: every hit, buff, Arts Infliction, reaction, Physical Status, cooldown, SP and Ultimate Energy gain as the game defines them. Only the controlled operator basic attacks; the others stand by, as they mostly do in the game.'],
  ['Damage', 'ATK × multiplier × DMG bonus × critical hits (their expected value) × Amp × Susceptibility × DMG taken × DEF × Resistance × Stagger, as endfield.wiki.gg’s Damage page lays it out.'],
  ['Search', 'Step 1 finds a priority list: a ranking of buttons, where the first one that’s ready gets pressed. Many rankings are tried, and the best ones are improved by swapping pairs. Step 2 goes through the fight action by action: each time a skill could be pressed, it tries every option (each ready skill, or waiting a moment), plays out the rest of the fight for each, and keeps the few that did best.'],
  ['Styles', 'Advanced: anything the game allows, swaps and animation cancels too. Standard: one operator controlled the whole fight, no animation cancels, at least half a second between actions. Basic: one operator controlled; combos as they come up, ultimates when charged, and the battle skills in one order, over and over.'],
  ['Goal', 'Fight length: the most damage in that time. Dummy HP: the fight ends when it’s defeated, and the fastest wins.'],
  ['Optimal gear', 'Each weapon is tried in a fight (Maxed Essence; a gacha-only weapon goes to one operator at most). Then it measures how much each stat adds for this team, and tries gear sets and pieces at their top Artifice. Twice over: the second time, weapons are tried with the gear found. It also starts once from each operator’s signature weapon, and keeps whichever start plays best.'],
  ['Uptime', 'How much of the fight the enemy can be hit. The rest comes at the end of every 10 s: nothing is pressed and basic attacks stop, while what’s already running goes on.'],
  ['Threads', 'Fights that don’t depend on each other are played side by side on several threads of this device; the rotation found is the same as on one.'],
  ['Not simulated', 'Enemy attacks, positions and distances (counters, shields, attacks landing on random spots), and inputs timed by the player (perfect timing).'],
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const big = (n: number) => Math.round(n).toLocaleString();
/** A time as m:ss.s, as the game's stopwatch reads (with tenths). */
const clockTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const secs = (frame: number) => clockTime(frame / FPS);

/**
 * The operators to pick from, one per name: the Endministrator's two appearances (chr_0002_endminm,
 * chr_0003_endminf) are one operator. The one picked or with a loadout stands for the name.
 */
function pickable(wiki: Wiki, index: CombatIndex, team: SimMember[]): string[] {
  const byName = new Map<string, string>();
  for (const id of index.ops.filter((x) => wiki.ops[x])) {
    const name = wiki.ops[id].name;
    const have = byName.get(name);
    const preferred = (x: string) => team.some((m) => m.op === x) || !!loadoutOf(x);
    if (!have || (!preferred(have) && preferred(id))) byName.set(name, id);
  }
  return [...byName.values()].sort((x, y) => wiki.ops[x].name.localeCompare(wiki.ops[y].name));
}

function memberCard(m: SimMember, i: number, n: number, wiki: Wiki, index: CombatIndex, build: SimBuild, optimal: boolean, chosen: SimBuild | undefined, team: SimMember[]): Html {
  const o = wiki.ops[m.op];
  const ops = pickable(wiki, index, team);
  // An operator can be in the team once: the others' picks are greyed out here.
  const taken = new Set(team.filter((_, j) => j !== i).map((x) => wiki.ops[x.op]?.name));
  const l = loadoutOf(m.op) ?? {};
  const options = (current: number, field: string) =>
    html`<select class="input sim-p" data-sim="${field}" data-i="${i}" aria-label="Potential">${[0, 1, 2, 3, 4, 5].map((p) => html`<option value="${p}" ${p === current ? 'selected' : ''}>P${p}</option>`)}</select>`;
  return html`<div class="sim-member">
    <div class="sim-member-head">
      <span class="label-12 secondary">Position ${i + 1}</span>
      <span class="sim-move">
        <button type="button" class="btn tertiary sm icon-btn" data-action="sim-up" data-value="${i}" ${i === 0 ? 'disabled' : ''} title="Earlier position" aria-label="Earlier position">${icon('arrow_upward')}</button>
        <button type="button" class="btn tertiary sm icon-btn" data-action="sim-down" data-value="${i}" ${i === n - 1 ? 'disabled' : ''} title="Later position" aria-label="Later position">${icon('arrow_downward')}</button>
      </span>
    </div>
    <div class="sim-op">
      <a class="sim-op-link" href="${infoHref('char', m.op)}" title="${o ? `${o.name}’s page` : ''}" aria-label="${o ? `${o.name}’s page` : 'Operator page'}">${itemImg('char', m.op, 'sim-portrait')}</a>
      <select class="input" data-sim="op" data-i="${i}" aria-label="Operator">${ops.map((id) => html`<option value="${id}" ${id === m.op ? 'selected' : ''} ${taken.has(wiki.ops[id].name) ? 'disabled' : ''}>${wiki.ops[id].name}</option>`)}</select>
    </div>
    <div class="sim-pots">
      <label class="label-12 secondary">Potential ${options(build.potential, 'potential')}</label>
      ${build.weapon ? html`<label class="label-12 secondary">Weapon ${options(build.weapon.potential, 'wpotential')}</label>` : ''}
      ${foodPicker(m.food, enemyById(settings().enemy).enemy.food !== false, html`data-sim="food" data-i="${i}"`)}
    </div>
    ${CHECKED.includes(m.op) ? '' : html`<span class="sim-unchecked">${badge('Not checked yet', 'amber')}</span>`}
    ${optimal
      ? html`<div class="sim-gear copy-13">
          <select class="input" data-sim="weapon" data-i="${i}" aria-label="Weapon">
            <option value="" ${m.weapon ? '' : 'selected'}>Best weapon found</option>
            ${weaponsFor(m.op, wiki, index).map((id) => html`<option value="${id}" ${id === m.weapon ? 'selected' : ''}>${wiki.weapons[id].name}</option>`)}
          </select>
          ${chosen ? buildLines(chosen, wiki) : html`<span class="secondary">Weapon and gear are chosen when it runs: Maxed Essence, gear at its top Artifice.</span>`}`
      : html`<div class="sim-gear copy-13">`}
      ${optimal ? '' : build.weapon ? weaponLine(build.weapon, wiki) : ''}
      ${optimal ? '' : GEAR_SLOTS.map(({ slot, type, label }) => {
        const id = l[slot];
        const g = id ? wiki.gear[id] : undefined;
        return g ? html`<div class="sim-piece secondary">${slotIcon(type)}<span class="min0 ellipsis">${g.name}</span>${artificeIcon(build.gear.find((x) => x.id === id)?.artifice ? artificeOf(l, slot, g) : 0)}</div>` : html`<div class="sim-piece secondary">${slotIcon(type)}No ${label.toLowerCase()}</div>`;
      })}
    </div>
  </div>`;
}

/**
 * A weapon as a line like the gear's: its own picture, its name in the text's colour, and its essence: the essence
 * icon in green for Maxed Essence (no skill levels set: each at its cap), dim with its ranks otherwise.
 */
function weaponLine(weapon: NonNullable<SimBuild['weapon']>, wiki: Wiki, edit?: number): Html {
  const w = wiki.weapons[weapon.id];
  const mark = itemImg('weap', weapon.id, 'sim-weapon-mark');
  const b = { weapon } as SimBuild;
  if (edit !== undefined) {
    // While a parsed run is edited: Potential, level and each skill's rank as fields in place, then the icon.
    const caps = essenceCaps(b);
    const ranks = skillRanks(b);
    const maxed = !weapon.skillLevels?.some((x) => x !== null && x !== undefined);
    return html`<div class="sim-piece sim-weapon-line">${mark}<a class="sim-weapon-name min0 ellipsis" href="${infoHref('weap', weapon.id)}" title="${w?.name ?? weapon.id}’s page">${w?.name ?? weapon.id}</a><span class="sim-weapon-end secondary num">P${inl(edit, 'wpotential', weapon.potential, 0, 5, 'Weapon Potential')} Lv ${inl(edit, 'wlevel', weapon.level ?? 90, 1, 90, 'Weapon level')}
      <span>${caps.map((cap, k) => html`${k ? '/' : ''}${inl(edit, `rank${k}`, ranks[k], 1, cap + (k === caps.length - 1 ? (weapon.potential ?? 0) : 0), `Skill ${k + 1} rank`)}`)}</span>${noEssence(b) ? '' : html`<span class="${maxed ? 'essence-max' : 'essence-off'}">${essenceIcon()}</span>`}</span></div>`;
  }
  // At the right: its level when not 90, then its essence: maxed, the icon green; otherwise its skill ranks, then the
  // icon dim (none with no essence).
  const ranks = skillRanks(b).join('/');
  const essence = noEssence(b)
    ? html`<span class="sim-weapon-ranks secondary num" title="Skill ranks">${ranks}</span>`
    : !weapon.skillLevels?.some((x) => x !== null && x !== undefined)
      ? html`<span class="essence-max">${essenceIcon()}</span>`
      : html`<span class="sim-weapon-ranks secondary num" title="Skill ranks">${ranks}</span><span class="essence-off">${essenceIcon(`Not maxed: skill ranks ${ranks}`)}</span>`;
  const level = weapon.level && weapon.level !== 90 ? html`<span class="sim-weapon-ranks secondary num">Lv ${weapon.level}</span>` : '';
  return html`<div class="sim-piece sim-weapon-line">${mark}<a class="sim-weapon-name min0 ellipsis" href="${infoHref('weap', weapon.id)}" title="${w?.name ?? weapon.id}’s page">${w?.name ?? weapon.id}</a><span class="sim-weapon-end">${level}${essence}</span></div>`;
}

/** A number in a parsed run's loadout while it's edited, as a field in place of the text (`runbuild`). */
function inl(i: number, name: string, value: number | null | undefined, min: number, max: number, label: string): Html {
  return html`<input class="sim-inl num" type="number" min="${min}" max="${max}" value="${value ?? ''}" style="--d:${String(max).length}" data-sim="runbuild" data-i="${i}" data-field="${name}" aria-label="${label}" title="${label}" />`;
}

/** A box's top row while its run is edited (the name gives way): level and the four skill ranks as fields. */
function levelsEdit(i: number, b: SimBuild): Html {
  const r = b.ranks ?? {};
  const kinds = [['basic', 'Basic attack'], ['normal', 'Battle skill'], ['combo', 'Combo skill'], ['ultimate', 'Ultimate']] as const;
  return html`<span class="label-12 secondary num sim-op-levels">Lv ${inl(i, 'level', b.level ?? 90, 1, 90, 'Level')} · ${kinds.map(([k, label], n) => html`${n ? '/' : ''}${inl(i, k, r[k] ?? 12, 1, 12, `${label} rank`)}`)}</span>`;
}

/** An operator's level and skill ranks when not maxed (90; 12 each), for the top right of their box. */
function levelsLine(b: SimBuild): string {
  const r = b.ranks ?? {};
  return [
    b.level && b.level !== 90 ? `Lv ${b.level}` : '',
    b.ranks ? (['basic', 'normal', 'combo', 'ultimate'] as const).map((k) => r[k] ?? 12).join('/') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The open parsed run's boss (the Enemy lane shows its picture) and its picture's address. */
let laneFoe: (typeof ENEMIES)[number] | undefined;
const foeIcon = (foe: (typeof ENEMIES)[number]) => `${EF_ASSETS_CDN}/icons/enemies/${foe.icon}.webp`;
/**
 * A boss's face: its picture zoomed in on the face (ENEMIES `face`), as a box's background (the share each way that
 * puts the face in the box's middle).
 */
const foeFace = (foe: (typeof ENEMIES)[number], cls: string) => {
  const [x, y, zoom] = foe.face;
  const at = (f: number) => `${Math.max(0, Math.min(100, ((f * zoom - 0.5) / (zoom - 1)) * 100)).toFixed(1)}%`;
  return html`<span class="${cls}" role="img" aria-label="${foeName(foe)}" title="${foeName(foe)}" style="background-image:url('${foeIcon(foe)}');background-size:${zoom * 100}%;background-position:${at(x)} ${at(y)}"></span>`;
};
/** The boss's short name: its entry's without the stage ("Skydrummer"). */
const foeName = (foe: (typeof ENEMIES)[number]) => foe.name.replace(/\s*\(.*$/, '');

/**
 * A parsed run's food, a sixth line under the gear's: its item icon and name, or none. While the run is edited a choice
 * in place (`runfood`, kept in the draft). Only where the stage allows food (Enemy.food).
 */
function foodLine(b: SimBuild, edit?: number): Html {
  const name = b.food ? FOODS[b.food]?.name : undefined;
  const src = name ? iconOf('items', name.replace(/’/g, "'")) : null;
  const mark = src ? html`<img class="sim-food-mark" src="${src}" alt="" />` : html`<span class="sim-food-mark">${icon('restaurant')}</span>`;
  return html`<div class="sim-piece sim-food-line${name ? '' : ' secondary'}">${mark}${edit === undefined
    ? html`<span class="min0 ellipsis">${name ?? 'No food'}</span>`
    : html`<select class="sim-inl-sel" data-sim="runfood" data-i="${edit}" aria-label="Food">
        <option value="" ${b.food ? '' : 'selected'}>No food</option>
        ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === b.food ? 'selected' : ''}>${f.name}</option>`)}
      </select>`}</div>`;
}

/** A food picker (`attrs`: its data-* attributes), or why there's none: the stage allows no food (Enemy.food). */
function foodPicker(value: string | undefined, allowed: boolean, attrs: Html): Html {
  // A stage without food (its rules show in the review) takes no line.
  if (!allowed) return html``;
  return html`<label class="label-12 secondary">Food <select class="input sim-food" ${attrs} aria-label="Food">
    <option value="" ${value ? '' : 'selected'}>None</option>
    ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === value ? 'selected' : ''}>${f.name}</option>`)}
  </select></label>`;
}

/**
 * A weapon's skill level caps before Potential (the game data's: 9/9/4 for a three-skill weapon, 9/4 for a two-skill
 * one; an essence rank is the level less one, so 0–8/0–8/0–3) and each skill's rank in the sim: its level (the cap unless
 * set) plus, on the last skill, the weapon's Potential (+1 a level, as every weapon's potentialLevels has it).
 */
function essenceCaps(b: SimBuild): number[] {
  const n = (b.weapon && wikiNow?.weapons[b.weapon.id]?.skills.length) || 3;
  return n === 2 ? [9, 4] : [9, 9, 4];
}
function skillRanks(b: SimBuild): number[] {
  const caps = essenceCaps(b);
  return caps.map((cap, k) => (b.weapon?.skillLevels?.[k] ?? cap) + (k === caps.length - 1 ? (b.weapon?.potential ?? 0) : 0));
}

/** A weapon with no essence etched: each skill at level 1 (its Potential still adds to them, in build.ts). */
const noEssence = (b: SimBuild): boolean => !!b.weapon?.skillLevels && b.weapon.skillLevels.length === 3 && b.weapon.skillLevels.every((x) => x === 1);

/** A build's weapon and gear, as lines. */
function buildLines(b: SimBuild, wiki: Wiki, edit?: number): Html {
  // While a parsed run is edited each Artifice mark is a button: a click steps it 0 → 3 and round (`sim-art`).
  return html`${b.weapon?.id ? weaponLine(b.weapon, wiki, edit) : ''}
    ${b.gear.map((g, k) => html`<div class="sim-piece secondary">${slotIcon(wiki.gear[g.id]?.type ?? '')}<span class="min0 ellipsis">${wiki.gear[g.id]?.name ?? g.id}</span>${edit !== undefined
      ? html`<button type="button" class="sim-art-btn" data-action="sim-art" data-value="${edit}:${k}" title="Artifice ${g.artifice ?? 0}: click to change">${artificeIcon(g.artifice ?? 0)}</button>`
      : artificeIcon(g.artifice ?? 0)}</div>`)}`;
}

/** Where each press falls in the fight, one row per team position. */
/** What a timeline shows: a sim's result, or a recording's own reading, on the fight's clock (frames). */
interface Track {
  seconds: number;
  main: number;
  presses: { frame: number; slot: number; input: Input }[];
  strikes: { frame: number; slot: number; finisher: boolean }[];
  staggers: { frame: number; end: number }[];
  mechanics: { frame: number; label: string }[];
  away: [number, number][];
  guard: [number, number][];
  /** Damage dealt each second of the fight. */
  dps: number[];
  /** Each press's and Final Strike's damage (in the order of `presses` and `strikes`), where known. */
  pressDmg?: (number | undefined)[];
  strikeDmg?: (number | undefined)[];
  /** Each press's and Final Strike's SP change (a battle skill's cost negative), where known. */
  pressSp?: (number | undefined)[];
  strikeSp?: (number | undefined)[];
  /** The SP bar just after each press and strike. */
  pressSpAfter?: (number | undefined)[];
  strikeSpAfter?: (number | undefined)[];
}

/** A sim result as a track: its damage each second from its own track. */
function simTrack(r: SimResult): Track {
  const dps: number[] = [];
  let last = 0;
  for (const [t, dealt] of r.track ?? []) {
    const k = Math.floor(t);
    while (dps.length <= k) dps.push(0);
    dps[k] += dealt - last;
    last = dealt;
  }
  return { seconds: r.seconds, main: r.main, presses: r.presses, strikes: r.strikes ?? [], staggers: r.staggers ?? [], mechanics: r.mechanics ?? [], away: r.away ?? [], guard: [], dps };
}

/**
 * A recording as a track, 1:1 with the video: its presses, Final Strikes and interrupts as read, the boss Staggered
 * where its meter went yellow, its Stagger node where the meter passed half, and its damage each second from its
 * HP bar (the game's own rolls, crits and all), on the fight's clock (the stopwatch's pauses taken out).
 */
function recordingTrack(reading: VideoRotation, seconds: number, phaseHp: number | undefined, nodes: number[] = []): Track {
  const pauses = reading.pauses ?? [];
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  const f = (t: number) => Math.round(clock(t) * FPS);
  const presses: Track['presses'] = [];
  const strikes: Track['strikes'] = [];
  const mechanics: Track['mechanics'] = [];
  const who = new Map<number, number>();
  const pressSp: (number | undefined)[] = [];
  const strikeSp: (number | undefined)[] = [];
  const pressSpAfter: (number | undefined)[] = [];
  const strikeSpAfter: (number | undefined)[] = [];
  // An action that moved no SP (a combo, an ultimate): the bar as read at it, so every action has one.
  const bar = reading.sp ?? [];
  const barAt = (t: number) => bar.filter(([u]) => u <= t + 0.1).at(-1)?.[1];
  for (const x of reading.steps) {
    if (x.input === 'strike' || x.input === 'finisher') {
      strikes.push({ frame: f(x.t), slot: x.slot, finisher: x.input === 'finisher' });
      strikeSp.push(x.sp);
      strikeSpAfter.push(x.spAfter);
      who.set(x.slot, (who.get(x.slot) ?? 0) + 1);
    } else {
      presses.push({ frame: f(x.t), slot: x.slot, input: x.input });
      pressSp.push(x.sp);
      pressSpAfter.push(x.spAfter ?? (x.sp === undefined || x.sp === 0 ? barAt(x.t) : undefined));
    }
    if (x.interrupt) mechanics.push({ frame: f(x.t) + FPS, label: 'Interrupted' });
  }
  const main = [...who.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const staggers: Track['staggers'] = [];
  const dps: number[] = [];
  let lastHp = 1;
  let lastT = -Infinity;
  let open: Track['staggers'][number] | null = null;
  let under = true;
  for (const [t, hp, meter] of reading.boss ?? []) {
    if (pauses.some(([a, b]) => t >= a && t < b)) continue;
    const c = clock(t);
    if (meter < 0) {
      if (!open) staggers.push((open = { frame: Math.round(c * FPS), end: Math.round(c * FPS) }));
      open.end = Math.round(c * FPS);
    } else open = null;
    // The meter reaching the boss's Stagger node (its entry's `nodes`: the Skydrummer has none).
    const node = nodes[0];
    if (node !== undefined) {
      if (meter >= node && under) mechanics.push({ frame: Math.round(c * FPS), label: 'Stagger node' });
      if (meter >= 0 && meter < node) under = true;
      if (meter >= node) under = false;
    }
    // A new phase refills the bar; otherwise what it lost is damage.
    if (phaseHp) {
      if (t - lastT > 2 && hp > lastHp + 0.3) lastHp = 1;
      const k = Math.min(Math.floor(c), Math.max(0, seconds - 1));
      while (dps.length <= k) dps.push(0);
      dps[k] += Math.max(0, lastHp - hp) * phaseHp;
      lastHp = Math.min(lastHp, hp);
    }
    lastT = t;
  }
  return { seconds, main, presses, strikes, staggers, mechanics, away: (reading.away ?? []).map(([a, b]) => [clock(a), clock(b)] as [number, number]).map(([a, b]) => [a * FPS, b * FPS] as [number, number]), guard: (reading.guard ?? []).map(([a, b]) => [clock(a) * FPS, clock(b) * FPS] as [number, number]), dps, ...(pressSp.some((x) => x !== undefined) ? { pressSp, strikeSp, pressSpAfter, strikeSpAfter } : {}) };
}

/** The lanes of a track: each operator's presses and Final Strikes, the damage each second, the enemy's stretches. */
/** An action's SP change for its hover text (" · −100 SP"), or nothing. */
function spOf<T>(sp: (number | undefined)[] | undefined, list: T[], item: T): string {
  const d = sp?.[list.indexOf(item)];
  return d === undefined ? '' : ` · ${spText(d)}`;
}

/** An action's SP change, every action (a combo's or ultimate's 0 too): "−100 SP", "+17 SP", "0 SP". */
const spText = (d: number | undefined): string => (d === undefined ? '' : d === 0 ? '0 SP' : `${d > 0 ? '+' : '−'}${Math.abs(d)} SP`);

/** An action's damage for its hover text (" · 12,345 damage"), or nothing. */
function dmgOf<T>(dmg: (number | undefined)[] | undefined, list: T[], item: T): string {
  const d = dmg?.[list.indexOf(item)];
  return d ? ` · ${big(d)} damage` : '';
}

function lanes(r: Track, names: string[], dpsMax: number, buffs?: BuffSpan[], ids?: string[]): Html {
  // With the operators' ids (a parsed run's), each lane is named by a small portrait, the buffs on them at the playhead
  // beside it (paintBuffs), the enemy's by its lane: the timeline shows what's happening, so they're here.
  const faces = !!ids?.length;
  const who = (name: string, slot: number) =>
    faces && ids![slot]
      ? html`<span class="sim-lane-name sim-lane-who" title="${name}">${itemImg('char', ids![slot], 'sim-lane-face')}${buffs?.length ? html`<span class="sim-buffs-now lane" data-buffs-slot="${slot}" aria-label="${name}’s buffs"></span>` : ''}</span>`
      : html`<span class="sim-lane-name label-12 ellipsis">${name}</span>`;
  const end = r.seconds * FPS;
  // Who's controlled when: the swaps.
  const spans: { slot: number; from: number; to: number }[] = [];
  let cur = r.main;
  let from = 0;
  for (const p of r.presses)
    if (p.input === 'swap') {
      spans.push({ slot: cur, from, to: p.frame });
      cur = p.slot;
      from = p.frame;
    }
  spans.push({ slot: cur, from, to: end });
  const at = (f: number) => `${Math.min(100, (f / end) * 100).toFixed(2)}%`;
  const ticks = Array.from({ length: Math.floor(r.seconds / 10) + 1 }, (_, k) => k * 10);
  // A parsed run's lane is named by the boss's picture in a red ring, as operators' by their portraits.
  const foe = faces ? laneFoe : undefined;
  const foeWho = foe ? foeFace(foe, 'sim-lane-face sim-foe-face') : html`<span class="label-12">Enemy</span>`;
  const enemyName = () =>
    faces && buffs?.some((b) => b.slot < 0)
      ? html`<span class="sim-lane-name sim-lane-who">${foeWho}<span class="sim-buffs-now lane" data-buffs-slot="-1" data-buffs-kind="other" aria-label="The enemy's debuffs"></span></span>`
      : foe
        ? html`<span class="sim-lane-name sim-lane-who">${foeWho}</span>`
        : html`<span class="sim-lane-name label-12 ellipsis">Enemy</span>`;
  return html`<div class="sim-timeline" role="img" aria-label="Actions over the fight">
    ${names.map(
      (name, slot) => html`<div class="sim-lane">
        ${who(name, slot)}
        <span class="sim-lane-track">
          ${spans.filter((s) => s.slot === slot).map((s) => html`<i class="sim-control" style="left:${at(s.from)};width:${at(s.to - s.from)}"></i>`)}
          ${r.presses
            .filter((p) => p.slot === slot && p.input !== 'swap')
            .map((p) => html`<i class="sim-press ${p.input}" style="left:${at(p.frame)}" title="${secs(p.frame)} · ${INPUT_NAME[p.input]}${dmgOf(r.pressDmg, r.presses, p)}${spOf(r.pressSp, r.presses, p)}">${p.input === 'battle' ? 'B' : p.input === 'combo' ? 'C' : p.input === 'dive' ? 'D' : 'U'}</i>`)}
          ${r.strikes
            .filter((s) => s.slot === slot)
            .map((s) => html`<i class="sim-strike${s.finisher ? ' finisher' : ''}" style="left:${at(s.frame)}" title="${secs(s.frame)} · ${s.finisher ? 'Finisher' : 'Final Strike'}${dmgOf(r.strikeDmg, r.strikes, s)}${spOf(r.strikeSp, r.strikes, s)}"></i>`)}
        </span>
      </div>${buffRows(buffs, slot, name, at)}`,
    )}
    ${r.dps.length && dpsMax > 0
      ? html`<div class="sim-lane">
          <span class="sim-lane-name label-12 ellipsis">Damage</span>
          <span class="sim-lane-track sim-dmg">${r.dps.map((d, k) => (d > 0 ? html`<i style="left:${at(k * FPS)};width:${at(FPS)};height:${Math.max(4, Math.round((d / dpsMax) * 100))}%" title="${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')} · ${big(d)}"></i>` : ''))}</span>
        </div>`
      : ''}
    ${r.staggers.length || r.mechanics.length || r.away.length || r.guard.length
      ? html`<div class="sim-lane">
          ${enemyName()}
          <span class="sim-lane-track">${r.away.map(([a, b]) => html`<i class="sim-away" style="left:${at(a)};width:${at(b - a)}" title="${secs(a)} · Invulnerable ${((b - a) / FPS).toFixed(1)} s"></i>`)}${r.guard.map(([a, b]) => html`<i class="sim-guard" style="left:${at(a)};width:${at(b - a)}" title="${secs(a)} · No Stagger ${((b - a) / FPS).toFixed(1)} s"></i>`)}${r.staggers.map((s) => html`<i class="sim-stagger" style="left:${at(s.frame)};width:${at(s.end - s.frame)}" title="${secs(s.frame)} · Staggered ${((s.end - s.frame) / FPS).toFixed(1)} s"></i>`)}${r.mechanics.map((m) => html`<i class="sim-mechanic" style="left:${at(m.frame)}" title="${secs(m.frame)} · ${m.label}">${icon(m.label === 'Interrupted' ? 'close' : m.label === 'Stagger node' ? 'change_history' : 'swords')}</i>`)}</span>
        </div>`
      : fold.buffs && buffs?.some((b) => b.slot < 0)
        ? html`<div class="sim-lane">${enemyName()}<span class="sim-lane-track"></span></div>`
        : ''}
    ${buffRows(buffs, -1, 'Enemy', at)}
    <div class="sim-lane sim-axis"><span></span><span class="sim-lane-track">${ticks.map((t) => html`<span class="label-12 secondary" style="left:${at(t * FPS)}">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span>`)}</span></div>
    <i class="sim-playhead" aria-hidden="true"></i>
  </div>`;
}

/** The sim's timeline with the player under it (a run that isn't a recording's: one timeline). */
function timeline(r: SimResult, names: string[]): Html {
  const t = simTrack(r);
  return html`${lanes(t, names, Math.max(...t.dps, 0))}${player(r)}`;
}

/** The timeline playing: where it is (seconds on the fight's clock), how fast, whether it runs, and for which result. */
// Played at 4× unless picked: a fight is minutes long.
const play = { t: 0, speed: 4, running: false, of: null as SimResult | null, raf: 0, last: 0 };
/** The boss's bars over the fight: HP left (0–1) and its Stagger meter (0–1, -1 Staggered, NaN unknown). */
/** A source's boss bars: readings in time (the meter -1 while Staggered), and its Staggered stretches (seconds). */
type Bars = { t: number[]; hp: number[]; meter: number[]; staggered?: [number, number][] };

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
/** The player's bars, plus the boss's Stagger nodes (shares of its meter) and where its later phases begin (seconds). */
let playBars: { sim: Bars; video?: Bars; seconds: number; nodes: number[]; phases: number[]; sp: { sim?: [number, number][]; video?: [number, number][] }; buffs?: BuffSpan[] } | null = null;
/** What's shown under the timeline: the discrepancies list. */
const fold = { video: true, checks: true, buffs: false, moves: false };
/** The page's wiki data as last drawn, for naming buffs. */
let wikiNow: Wiki | null = null;

/** A buff's name: its status's, else from its id (an operator's or weapon's by its name, the rest in words). */
function buffName(b: BuffSpan): string {
  // Replays before the game's wording was used said Crystal (its data's kind) for Cryo.
  if (b.status) return b.status.replace(/^Crystal /, 'Cryo ');
  const words = (s: string) => {
    const t = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  };
  // A gear set's: by the set whose id (suit_criti01, from its pieces' ids) starts as the buff's does
  // (equipsuit_critsuitatk_01), its number settling sets of one kind (usp01, usp02); then what's left of the id.
  const suit = /^buff_equipsuit_(.*)$/.exec(b.id);
  if (suit && wikiNow) {
    const s = suit[1].replace(/_/g, '').toLowerCase();
    const sets = new Map<string, string>();
    for (const [id, g] of Object.entries(wikiNow.gear)) {
      const k = /_suit_([a-z]+\d*)_/.exec(id)?.[1];
      if (k && g.set) sets.set(k, g.set);
    }
    let best: { k: string; n: number; num: boolean } | null = null;
    for (const k of sets.keys()) {
      const letters = k.replace(/\d+$/, '');
      let n = 0;
      while (n < letters.length && s[n] === letters[n]) n++;
      const num = !!k.match(/\d+$/) && s.includes(k.match(/\d+$/)![0]);
      if (n >= 3 && (!best || n > best.n || (n === best.n && num && !best.num))) best = { k, n, num };
    }
    if (best) {
      const rest = s.slice(best.n).replace(/^suit/, '').replace(/\d+/g, '');
      return rest ? `${sets.get(best.k)} · ${words(rest)}` : sets.get(best.k)!;
    }
  }
  const m = /^buff_(chr_\d+_[a-z]+|wpn_[a-z]+_\d+)_?(.*)$/.exec(b.id);
  if (!m) return words(b.id.replace(/^buff_/, ''));
  const who = wikiNow?.ops[m[1]]?.name ?? wikiNow?.weapons[m[1]]?.name ?? m[1];
  return m[2] ? `${who} · ${words(m[2])}` : who;
}

/** A Susceptibility's or Amp's kind in the game's sprite names (icon_battle_affix_cryst_vulnerable). */
const AFFIX_SPRITE: Record<string, string> = { Spell: 'spell', Fire: 'fire', Cryst: 'cryst', Crystal: 'cryst', Pulse: 'pulse', Natural: 'natural', Nature: 'natural', Physical: 'physical' };
/** An enemy's elemental infliction as the game draws it: the element's orb. */
const INFLICT_SPRITE: Record<string, string> = { Fire: 'icon_energy_fusion_fire', Cryst: 'icon_energy_fusion_cryst', Pulse: 'icon_energy_fusion_pulse', Natural: 'icon_infliction_nature' };

/**
 * Which buff shows which of the game's icons: ef-assets icons/buffs/index.json (buff id -> sprite, from the game's
 * BuffData), fetched once; until then a letter shows.
 */
let buffIcons: Record<string, string> | null = null;
let buffIconsAsked = false;
function loadBuffIcons(redraw: () => void): void {
  if (buffIconsAsked) return;
  buffIconsAsked = true;
  const url = `${EF_ASSETS}/icons/buffs/index.json`;
  fetch(url)
    .then((r) => (r.ok ? r : fetch(mirrorUrl(url)!)))
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Record<string, string> | null) => {
      if (!d) return;
      buffIcons = d;
      redraw();
    })
    .catch(() => {});
}

/** A buff's icon in the game (ef-assets icons/buffs/<sprite>.webp, from its UI bundle), if it has one. */
function buffIcon(b: BuffSpan): string | undefined {
  const fx = /^(vul|amp)_(.+)$/.exec(b.id);
  const sprite = fx
    ? `icon_battle_affix_${AFFIX_SPRITE[fx[2]] ?? 'spell'}_${fx[1] === 'vul' ? 'vulnerable' : 'enhance'}`
    : b.id === 'haste'
      ? 'icon_battle_affix_speedup'
      : b.id.startsWith('inflict_')
        ? INFLICT_SPRITE[b.id.slice(8)]
        : buffIcons?.[b.id];
  return sprite ? `${EF_ASSETS_CDN}/icons/buffs/${sprite}.webp` : undefined;
}

/**
 * Under a lane, a row for each buff its owner held (the sim's, played from the recording's presses): its stretches on
 * the lane's clock, its name at the left (less the owner's own name), stacks and times on hover.
 */
function buffRows(buffs: BuffSpan[] | undefined, slot: number, owner: string, at: (f: number) => string): Html {
  if (!fold.buffs || !buffs?.length) return html``;
  const rows = new Map<string, BuffSpan[]>();
  for (const b of buffs) if (b.slot === slot) rows.set(b.id, [...(rows.get(b.id) ?? []), b]);
  return html`${[...rows.values()].map((spans) => {
    const full = buffName(spans[0]);
    const name = full.startsWith(`${owner} · `) ? full.slice(owner.length + 3) : full;
    const src = buffIcon(spans[0]);
    return html`<div class="sim-lane sim-buff-lane">
      <span class="sim-lane-name label-12 ellipsis" title="${full}">${src ? html`<img class="sim-buff-row-icon" src="${src}" alt="" onerror="this.remove()" />` : ''}${name}</span>
      <span class="sim-lane-track">${spans.map(
        (s) => html`<i class="sim-buff${slot < 0 ? ' debuff' : ''}" style="left:${at(s.from * FPS)};width:${at(Math.max(s.to - s.from, 0.15) * FPS)}" title="${full} · ${secs(s.from * FPS)}–${secs(s.to * FPS)}${s.level ? ` · Level ${s.stacks}` : s.stacks > 1 ? ` · ${s.stacks} stacks` : ''}"></i>`,
      )}</span>
    </div>`;
  })}`;
}
/** The Parser tab's timeline: the recording's own (what happened) or the sim's (how it adds up). */
let view: 'recording' | 'sim' = 'recording';
const foldButton = (what: keyof typeof fold, label: string, iconOnly = false) =>
  html`<button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-fold" data-value="${what}" title="${fold[what] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}" aria-label="${label}" aria-expanded="${fold[what] ? 'true' : 'false'}">${iconOnly ? '' : `${label} `}${icon(fold[what] ? 'visibility_off' : 'visibility')}</button>`;

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

/** Each longer timeline (simLong) and the result it extends: the player keeps its place switching views. */
const baseOf = new WeakMap<SimResult, SimResult>();
const longOf = new WeakMap<SimResult, SimResult>();

/**
 * A run's result with the sim's fight after the recording's end (ReplayResult.runOn) added, to the sim's clear: the Sim
 * view's timeline, so a slower sim plays on past the recording. The same object each time for one result.
 */
function simLong(shown: SimResult, replayed: ReplayResult | undefined): SimResult {
  const on = replayed?.runOn;
  if (!on || replayed!.clear === undefined || replayed!.clear <= shown.seconds) return shown;
  const known = longOf.get(shown);
  if (known) return known;
  const long = {
    ...shown,
    seconds: replayed!.clear,
    presses: [...shown.presses, ...on.presses],
    strikes: [...(shown.strikes ?? []), ...on.strikes],
    staggers: [...(shown.staggers ?? []).map((x, k, all) => (k === all.length - 1 && on.lastEnd !== undefined ? { ...x, end: Math.max(x.end, on.lastEnd) } : x)), ...on.staggers],
    track: [...(replayed!.track ?? []), ...on.track],
    spTrack: [...(replayed!.spTrack ?? []), ...on.sp],
  } as ReplayResult;
  longOf.set(shown, long);
  baseOf.set(long, shown);
  return long;
}

/** A sim track run on to a longer timeline: its presses, strikes and Staggers after the recording's, damage each second. */
function withRunOn(track: Track, long: SimResult): Track {
  const more = simTrack(long);
  return { ...more, pressDmg: track.pressDmg, strikeDmg: track.strikeDmg, pressSp: track.pressSp, strikeSp: track.strikeSp, pressSpAfter: track.pressSpAfter, strikeSpAfter: track.strikeSpAfter };
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
function preparePlay(r: SimResult): { video?: Bars } {
  if (play.of !== (baseOf.get(r) ?? r)) {
    cancelAnimationFrame(play.raf);
    Object.assign(play, { t: 0, running: false, of: baseOf.get(r) ?? r });
  }
  // The open parsed run's: its result as the sim made it, or as fitted to the recording (what its timeline shows).
  const ofRun = !!replay?.result && (replay.result === r || (fitted?.of === replay.result && fitted.card.shown === r));
  const entry = ofRun && replay!.at !== undefined ? runs.find((x) => x.at === replay!.at) : undefined;
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
  }
  // The SP bar: the sim's (a replay's), and the video's as read (seconds into the video, put on the fight's clock).
  const simSp = (r as ReplayResult).spTrack;
  const videoSp = reading?.sp?.filter(([t]) => !pauses.some(([a, b]) => t >= a && t < b)).map(([t, v]) => [clock(t), v] as [number, number]);
  playBars = { sim, video, seconds: r.seconds, nodes: enemy?.nodes ?? [], phases: phaseStarts.map(clock), sp: { sim: simSp, video: videoSp }, buffs: (r as ReplayResult).buffs };
  queueMicrotask(paintPlay);
  return { video };
}

/** The timeline's playback speed, in its header. */
const speedSelect = (): Html => html`<select class="input sim-play-speed" data-sim="play-speed" aria-label="Playback speed">
    ${[1, 2, 4].map((s) => html`<option value="${s}" ${s === play.speed ? 'selected' : ''}>${s}×</option>`)}
  </select>`;

/**
 * Play and time in the lanes' label column, the scrubber across exactly the lanes' track (its thumb's centre going
 * edge to edge, as the playhead does), so the two line up.
 */
const playButton = (): Html =>
  html`<button type="button" class="btn secondary sm icon-only" data-action="sim-play" title="${play.running ? 'Pause' : 'Play'}" aria-label="${play.running ? 'Pause' : 'Play'}">${icon(play.running ? 'pause' : 'play_arrow')}</button>`;

/** Play in the label column, by the scrubber (its time in a tip above its dot); `extra` after them (a parsed run's Buffs toggle). */
function playControls(r: SimResult, extra?: Html): Html {
  return html`<div class="sim-play">
    <div class="sim-play-left">${playButton()}${speedSelect()}${extra ?? ''}</div>
    <span class="sim-seek-wrap" style="--p:${r.seconds ? play.t / r.seconds : 0}"><span class="num label-12 sim-play-time" aria-hidden="true">${clockTime(play.t)}</span><input class="sim-play-seek" type="range" min="0" max="${r.seconds}" step="any" value="${play.t}" data-sim="play-seek" aria-label="Time" style="--p:${r.seconds ? play.t / r.seconds : 0}" /></span>
  </div>`;
}

/**
 * The boss's HP and Stagger bars for one source, painted as the timeline plays: its phase under the name (a boss with
 * more than one), its Stagger nodes marked on the meter with the game's brackets.
 */
/**
 * A source's boss bars at the playhead: HP's width, the Stagger meter's (a Staggered meter drains from full to empty
 * over its stretch, as the game draws it) and whether it's Staggered. The first markup draws them too, so a redraw
 * (playback's end) doesn't flash full bars before the next paint.
 */
function barsNow(b: Bars, kind?: string): { hp: string; meter: string; staggered: boolean } {
  const raw = barAt(b, play.t);
  const s = b.staggered?.find(([a, z]) => play.t >= a && play.t < z);
  const on = !!s || (raw.meter < 0 && !b.staggered);
  const left = s ? Math.max(0, 1 - (play.t - s[0]) / Math.max(1e-6, s[1] - s[0])) : 1;
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
  if (!d || !play.running || now - d.at > 250) {
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
  while (i + 1 < series.length && series[i + 1][0] <= play.t) i++;
  const [t0, v0] = series[i];
  const next = series[i + 1];
  const dt = play.t - t0;
  if (!next || dt < 0 || next[0] - t0 > 1) return v0;
  // Between readings the bar regenerates, 8 a second (as World.tick), up to 300: on to the next reading where
  // only regeneration (or none, full or frozen) lies between; a skill's cost or a strike's gain comes as a jump there.
  const gap = next[0] - t0;
  const d = next[1] - v0;
  if (d >= 0 && d <= SP_REGEN * gap + 2) return v0 + (d * dt) / gap;
  return Math.min(300, v0 + SP_REGEN * dt);
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
  if (!s || !play.running || now - s.at > 250) {
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

/**
 * The buffs on someone at the playhead, as the game shows them: each icon in a square whose outline is its timer
 * (what's left of its stretch), its stacks in the corner. Into each `[data-buffs-slot]` (an operator's box; -1 the
 * enemy, by the boss's bars); rebuilt only when the set changes, the timers every paint.
 */
function paintBuffs(): void {
  const list = playBars?.buffs ?? [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-buffs-slot]')) {
    const slot = Number(el.dataset.buffsSlot);
    // `data-buffs-kind`: only the enemy's inflictions (by the boss's bars), or all but them (its lane).
    const kind = el.dataset.buffsKind;
    const fits = (b: BuffSpan) => !kind || (kind === 'infl') === b.id.startsWith('inflict_');
    const on = play.t > 0 ? list.filter((b) => b.slot === slot && fits(b) && b.from <= play.t && play.t < b.to) : [];
    const key = on.map((b) => `${b.id}@${b.from}`).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.replaceChildren(
        ...on.map((b) => {
          const chip = document.createElement('span');
          chip.className = `sim-buff-chip${slot < 0 ? ' debuff' : ''}`;
          const name = buffName(b);
          chip.title = `${name}${b.level ? ` · Level ${b.stacks}` : b.stacks > 1 ? ` · ${b.stacks} stacks` : ''}`;
          const letter = () => {
            const i = document.createElement('i');
            i.textContent = name.slice(0, 1);
            return i;
          };
          const src = buffIcon(b);
          // An Arts Infliction as the game draws it: the element's icon in a circle of four arcs, one lit per stack;
          // inside them a thin ring for the time left (the game's circle doesn't show that).
          const infliction = b.id.startsWith('inflict_');
          const inner = infliction ? document.createElement('span') : chip;
          if (infliction) {
            chip.classList.add('infl');
            const lit = 'var(--gray-1000)';
            const dim = 'var(--gray-alpha-300)';
            chip.style.background = `conic-gradient(from -39deg, ${[0, 1, 2, 3].map((k) => `${k < b.stacks ? lit : dim} ${k * 90 + 6}deg ${k * 90 + 84}deg, transparent ${k * 90 + 84}deg ${k * 90 + 96}deg`).join(', ')})`;
            inner.className = 'infl-timer';
            chip.append(inner);
          }
          // An infliction's icon sits on a round face that clips it, so it can fill its circle.
          const face = infliction ? document.createElement('span') : inner;
          if (infliction) {
            face.className = 'infl-face';
            inner.append(face);
          }
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            img.onerror = () => img.replaceWith(letter());
            face.append(img);
          } else face.append(letter());
          // Stacks as a number; an Arts Reaction's level as the game draws it, a Roman numeral in a corner box.
          if (b.level) {
            const lv = document.createElement('b');
            lv.className = 'lv';
            lv.textContent = ['I', 'II', 'III', 'IV'][b.stacks - 1] ?? String(b.stacks);
            chip.append(lv);
          } else if (b.stacks > 1 && !infliction) {
            const n = document.createElement('b');
            n.textContent = String(b.stacks);
            chip.append(n);
          }
          return chip;
        }),
      );
    }
    on.forEach((b, k) => (el.children[k] as HTMLElement | undefined)?.style.setProperty('--left', String(Math.max(0, Math.min(1, (b.to - play.t) / Math.max(0.01, b.to - b.from))))));
  }
}

function bossRow(label: string, kind: 'sim' | 'video'): Html {
  const nodes = playBars?.nodes ?? [];
  const b = kind === 'video' ? playBars?.video : playBars?.sim;
  const now = b ? barsNow(b) : null;
  const phase = 1 + (playBars?.phases.filter((p) => play.t >= p).length ?? 0);
  return html`<div class="sim-boss"><div class="sim-boss-row" data-bars="${kind}">
    <span class="sim-boss-label"><span class="label-12 secondary">${label}</span>${playBars?.phases.length ? html`<span class="label-12 sim-boss-phase">Phase ${phase}</span>` : ''}${playBars?.buffs?.some((b) => b.id.startsWith('inflict_'))
      ? html`<span class="sim-buffs-now lane sim-boss-infl" data-buffs-slot="-1" data-buffs-kind="infl" aria-label="The enemy's Arts Inflictions"></span>`
      : ''}</span>
    <span class="sim-boss-hp" title="HP"><i ${now ? html`style="width:${now.hp}"` : ''}></i></span>
    <span class="sim-boss-meter-wrap"><span class="sim-boss-meter" title="Stagger"><i class="${now?.staggered ? 'staggered' : ''}" ${now ? html`style="width:${now.meter}"` : ''}></i></span>${nodes.map((n) => html`<span class="sim-boss-node" style="left:${n * 100}%" title="Stagger node"></span>`)}</span>
  </div></div>`;
}

/** The team's SP bar for one source as the timeline plays: three segments of 100, the amount beside it. */
function spRow(kind: 'sim' | 'video'): Html {
  const series = playBars?.sp[kind];
  if (!series?.length) return html``;
  const v = spNow(series);
  return html`<div class="sim-sp-row" data-sp="${kind}">
    <span class="sim-boss-label sim-sp-label"><span class="label-12 secondary">SP</span><span class="num sim-sp-value">${Math.round(v)}</span></span>
    <span class="sim-sp-bar" role="img" aria-label="SP">${[0, 1, 2].map((k) => html`<span class="sim-sp-seg"><i style="width:${Math.max(0, Math.min(1, (v - k * 100) / 100)) * 100}%"></i></span>`)}</span>
  </div>`;
}

/** Under a lone timeline: the controls and the boss's bars. */
function player(r: SimResult): Html {
  preparePlay(r);
  return html`<div class="sim-player">${playControls(r)}${bossRow('Boss', 'sim')}</div>`;
}

/** Puts the playhead, the time and the bars where play.t is. */
/** The transcript's scroll (a redraw, such as pausing, makes a new list: it goes on from here, not the top). */
let movesTop = 0;
if (typeof document !== 'undefined')
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (el?.classList?.contains('sim-moves')) movesTop = el.scrollTop;
    },
    true,
  );

function paintPlay(): void {
  const d = playBars;
  if (!d) return;
  for (const list of document.querySelectorAll<HTMLElement>('.sim-moves:not([data-kept])')) {
    list.dataset.kept = '1';
    list.scrollTop = movesTop;
  }
  const frac = Math.min(1, play.t / d.seconds);
  for (const el of document.querySelectorAll<HTMLElement>('.sim-playhead')) el.style.left = `calc(var(--lane-label, 96px) + 8px + (100% - var(--lane-label, 96px) - 8px) * ${frac})`;
  for (const el of document.querySelectorAll<HTMLElement>('.sim-play-time')) el.textContent = clockTime(play.t);
  for (const el of document.querySelectorAll<HTMLInputElement>('.sim-play-seek')) {
    // Not while it's being dragged; a click leaves it focused, so focus alone isn't that.
    if (!el.matches(':active')) el.value = String(play.t);
    el.style.setProperty('--p', String(frac));
    el.parentElement?.style.setProperty('--p', String(frac));
  }
  // The transcript's move at the playhead (the last one at or before it), and any at the same moment with it.
  let at: HTMLElement | null = null;
  const rows = [...document.querySelectorAll<HTMLElement>('.sim-moves li[data-t]')];
  for (const li of rows) {
    li.classList.remove('now');
    if (Number(li.dataset.t) <= play.t + 1e-6) at = li;
  }
  if (play.t > 0 && at) {
    const t = Number(at.dataset.t);
    for (const li of rows) if (Math.abs(Number(li.dataset.t) - t) < 0.05) li.classList.add('now');
  }
  // Folded, the transcript shows only the moment at the playhead (before it starts, the first).
  const curT = Number((play.t > 0 && at ? at : rows[0])?.dataset.t ?? NaN);
  for (const li of rows) li.classList.toggle('cur', Math.abs(Number(li.dataset.t) - curT) < 0.05);
  // While playing, the transcript keeps the current move in view (its own list scrolls, not the page).
  if (play.running && at && !at.classList.contains('seen')) {
    for (const li of document.querySelectorAll<HTMLElement>('.sim-moves li.seen')) li.classList.remove('seen');
    at.classList.add('seen');
    const list = at.closest<HTMLElement>('.sim-moves');
    if (list) {
      const top = at.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + at.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = movesTop = Math.max(0, top - list.clientHeight / 3);
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
  const phase = 1 + d.phases.filter((p) => play.t >= p).length;
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
  const live = liveDmg;
  if (!live) return;
  const t = play.t;
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
  const prior = whole / Math.max(1, playBars?.seconds ?? 1);
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
function runPlay(): void {
  const step = (now: number) => {
    if (!play.running || !playBars) return;
    play.t = Math.min(playBars.seconds, play.t + ((now - play.last) / 1000) * play.speed);
    play.last = now;
    paintPlay();
    if (play.t >= playBars.seconds) {
      play.running = false;
      redrawPage();
      return;
    }
    play.raf = requestAnimationFrame(step);
  };
  play.last = performance.now();
  play.raf = requestAnimationFrame(step);
}

/** The presses, with the controlled operator's Final Strikes and Finishers between them (how long to keep attacking). */
function steps(r: Track): { frame: number; slot: number; label: string; strike: boolean; dmg?: number; sp?: number; spAfter?: number }[] {
  const out = [
    ...r.presses.flatMap((p, i) => (p.input === 'swap' ? [] : [{ frame: p.frame, slot: p.slot, label: INPUT_NAME[p.input], strike: false, dmg: r.pressDmg?.[i], sp: r.pressSp?.[i], spAfter: r.pressSpAfter?.[i] }])),
    ...r.strikes.map((s, i) => ({ frame: s.frame, slot: s.slot, label: s.finisher ? 'Finisher' : 'Final Strike', strike: true, dmg: r.strikeDmg?.[i], sp: r.strikeSp?.[i], spAfter: r.strikeSpAfter?.[i] })),
    ...r.staggers.map((s) => ({ frame: s.frame, slot: -1, label: 'Staggered', strike: true })),
    ...r.mechanics.map((m) => ({ frame: m.frame, slot: -1, label: m.label, strike: true })),
    ...r.away.map(([a]) => ({ frame: a, slot: -1, label: 'Invulnerable', strike: true })),
  ];
  return out.sort((a, b) => a.frame - b.frame);
}

/** What a saved run was asked for, in a line: style, search, goal, builds, and the order when it isn't today's. */
function runLine(entry: SavedSim<SimResult>, names: string[]): string {
  const req = JSON.parse(entry.key) as SimRequest & { video?: boolean };
  if (req.video) return [`${req.seconds} s`, ...(entry.names.join('|') !== names.join('|') ? [entry.names.join(', ')] : [])].join(' · ');
  const parts = [
    STYLES.find(([k]) => k === styleOf(req.style))?.[1] ?? '',
    EFFORTS.find(([k]) => k === req.effort)?.[1] ?? '',
    req.hp ? `${big(req.hp)} HP` : `${req.seconds} s`,
    req.optimize ? 'Optimal gear' : 'My loadouts',
    req.main != null ? `${entry.names[req.main]} controlled` : '',
  ];
  if (entry.names.join('|') !== names.join('|')) parts.push(entry.names.join(', '));
  return parts.filter(Boolean).join(' · ');
}

/** A saved run that played a video's rotation (the Parser tab's). */
const isRecording = (x: SavedSim<SimResult>) => !!(JSON.parse(x.key) as { video?: boolean }).video;

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STEP_NAME: Record<VideoStep['input'], string> = { battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', strike: 'Final Strike', finisher: 'Finisher', dive: 'Dive attack' };

/**
 * A parsed run's reading: its own, or for runs saved before readings were kept, the last reading when it's the same
 * team and length.
 */
function videoOf(x: SavedSim<SimResult>): VideoRotation | undefined {
  if (x.video) return killed(x.video as VideoRotation);
  const req = JSON.parse(x.key) as SimRequest & { video?: boolean };
  return req.video && lastVideo && lastVideo.names.join('|') === x.names.join('|') && lastVideo.seconds === req.seconds ? killed(lastVideo) : undefined;
}

/**
 * A recording's bars with the boss dead where it was: zero at each phase's end and at the stopwatch's stop
 * (`endsAtZero`, which new parses already ran; older ones, and reads that ended early, get it here). One copy per
 * reading, so it stays the same object across redraws.
 */
const killedOf = new WeakMap<VideoRotation, VideoRotation>();
function killed(v: VideoRotation): VideoRotation {
  if (!v.boss?.length) return v;
  let k = killedOf.get(v);
  if (!k) {
    const boss = v.boss.map((b) => [...b] as [number, number, number]);
    endsAtZero(boss, { end: v.end ?? v.seconds, seconds: v.seconds, pauses: v.pauses ?? [] });
    killedOf.set(v, (k = { ...v, boss }));
  }
  return k;
}

/** The open parsed run's presses to edit: time (seconds into the fight), operator, press; then played again. */
function transcriptLines(x: SavedSim<SimResult>, track: Track): Html {
  const reading = videoOf(x);
  if (!draft || draft.at !== x.at || !reading) return html``;
  // Each line's SP and damage as the transcript shows them (the view's track): its action there, the same operator and
  // kind nearest in time (within 3 s, as matchActions), each used once.
  const pool = steps(track).filter((p) => p.slot >= 0);
  const used = new Set<number>();
  const shownOf = (st: VideoStep) => {
    const strike = st.input === 'strike' || st.input === 'finisher';
    let best = -1;
    pool.forEach((p, j) => {
      if (used.has(j) || p.slot !== st.slot || p.strike !== strike || Math.abs(p.frame / FPS - st.t) > 3) return;
      if (best < 0 || Math.abs(p.frame / FPS - st.t) < Math.abs(pool[best].frame / FPS - st.t)) best = j;
    });
    if (best >= 0) used.add(best);
    return best >= 0 ? pool[best] : undefined;
  };
  // While a parsed run is edited its transcript's lines take fields in place: time, operator, action, a battle skill's
  // SP back, Interrupt; Invulnerable stretches after them. (Its length and who's controlled are in the figures above.)
  const labels = moveLabels(track);
  // Times as the transcript shows them, on the fight's clock (the stopwatch's pauses taken out; `stepClock`).
  const pauses = reading.pauses ?? [];
  const shownT = (t: number) => clockTime(t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0));
  const time = (t: number, name: string, k: number, label: string) =>
    html`<input class="sim-inl num sim-move-time" type="text" inputmode="decimal" value="${shownT(t)}" data-sim="${name}" data-k="${k}" aria-label="${label}" title="${label} (m:ss.s)" />`;
  return html`<div class="sim-moves-wrap"><ol class="sim-moves sim-moves-edit copy-14">
      ${draft.steps.map(
        (s, k) => html`<li class="${s.input === 'strike' || s.input === 'finisher' ? 'secondary' : ''}">
          <button type="button" class="sim-line-del" data-action="sim-step-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
          ${time(s.t, 'step-t', k, 'Time')}
          <span class="sim-move-op"><select class="sim-inl-sel" data-sim="step-slot" data-k="${k}" aria-label="Operator">
            ${reading.names.map((n, i) => html`<option value="${i}" ${i === s.slot ? 'selected' : ''}>${n}</option>`)}
          </select>${opSizers(reading.names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act"><select class="sim-inl-sel" data-sim="step-input" data-k="${k}" aria-label="Action">
            ${Object.entries(STEP_NAME).map(([id, n]) => html`<option value="${id}" ${id === s.input ? 'selected' : ''}>${n}</option>`)}
          </select>${actSizers(labels)}</span>
          <span>${s.input === 'battle' ? html`<input class="sim-inl num" type="number" min="0" max="300" value="${spGained(s.back, x.ids[s.slot] ?? undefined) ?? ''}" placeholder="+0" style="--d:3" data-sim="step-back" data-k="${k}" title="SP gained (blank: unknown)" aria-label="SP gained" />` : ''}</span>
          <span class="sim-move-int">${s.input === 'battle' || s.input === 'combo' || s.input === 'ultimate' ? html`<input type="checkbox" data-sim="step-int" data-k="${k}" ${s.interrupt ? 'checked' : ''} title="It interrupted the boss's attack" aria-label="Interrupt" />` : ''}</span>
          <span></span>
          ${(() => {
            const p = shownOf(s);
            return html`<span class="num sim-move-sp${p?.sp && p.sp < 0 ? ' used' : ''}">${spText(p?.sp)}</span><span class="num sim-move-spafter">${p?.sp !== undefined && p.spAfter !== undefined ? `→ ${p.spAfter}` : ''}</span><span class="num sim-move-dmg">${p?.dmg ? big(p.dmg) : ''}</span>`;
          })()}
        </li>`,
      )}
      ${draft.away.map(
        ([a, b], k) => html`<li class="secondary">
          <button type="button" class="sim-line-del" data-action="sim-away-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
          ${time(a, 'away-a', k, 'From')}
          <span class="sim-move-op">Enemy${opSizers(reading.names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act">Invulnerable${actSizers(labels)}</span>
          <span>to ${time(b, 'away-b', k, 'To')}</span><span></span><span></span><span></span><span></span><span></span>
        </li>`,
      )}
    </ol>
    <div class="sim-moves-side">
      <button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-step-add">Add action ${icon('add')}</button>
      <button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-away-add">Add invulnerable ${icon('add')}</button>
    </div></div>`;
}

/**
 * Every name the transcript's operator column can hold, invisible and flat: the column is as wide as the widest in both
 * views (a choice sizes itself by its options in another font, and lines only show some names).
 */
/** The action column's labels: the editor's choices and every label the transcript shows (Staggered, mechanics...). */
const moveLabels = (track: Track) => [...new Set([...Object.values(STEP_NAME), 'Invulnerable', ...steps(track).map((p) => p.label)])];
/** The labels for the normal view's action column, set as it's drawn (the editor's from the same track). */
let actLabels: string[] = [];
/** Every label the action column can hold, invisible and flat: the column is as wide as the widest in both views. */
const actSizers = (labels: string[]) => html`${labels.map((n) => html`<span class="sim-move-size" aria-hidden="true">${n}</span>`)}`;
const opSizers = (names: string[]) => html`${[...names, 'Enemy'].map((n) => html`<span class="sim-move-size" aria-hidden="true">${n}</span>`)}`;

/** A parsed run's header buttons after Edit and Export, boxed icons like them: Star (kept on top, never trimmed or deleted), Delete (asks once, red). */
function headTools(x: SavedSim<SimResult>): Html {
  const at = String(x.at);
  const ask = deleting === x.at;
  return html`<button type="button" class="btn secondary sm icon-only${x.fav ? ' sim-fav' : ''}" data-action="sim-fav" data-value="${at}" title="${x.fav ? 'Starred' : 'Star'}" aria-label="${x.fav ? 'Starred' : 'Star'}" aria-pressed="${x.fav ? 'true' : 'false'}">${icon('star', !!x.fav)}</button>
    ${x.fav
      ? html`<button type="button" class="btn secondary sm icon-only" disabled title="Starred: unstar it to delete" aria-label="Starred: unstar it to delete">${icon('delete')}</button>`
      : html`<button type="button" class="btn ${ask ? 'error' : 'secondary'} sm icon-only" data-action="sim-delete" data-value="${at}" title="${ask ? 'Click again to delete' : 'Delete'}" aria-label="${ask ? 'Confirm delete' : 'Delete'}">${icon('delete')}</button>`}`;
}

/** A saved run's buttons: star (kept on top, never trimmed), edit (name and note), delete (asks once). */
function runTools(x: SavedSim<SimResult>, editsElsewhere = false): Html {
  const at = String(x.at);
  const ask = deleting === x.at;
  // A parsed run's name and note are edited with its transcript (Edit), not here.
  return html`<div class="sim-past-tools">
    <button type="button" class="btn tertiary sm icon-only${x.fav ? ' sim-fav' : ''}" data-action="sim-fav" data-value="${at}" title="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-label="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-pressed="${x.fav ? 'true' : 'false'}">${icon('star', !!x.fav)}</button>
    ${editsElsewhere ? '' : html`<button type="button" class="btn tertiary sm icon-only" data-action="sim-edit" data-value="${at}" title="Edit" aria-label="Edit name and note" aria-pressed="${editing === x.at ? 'true' : 'false'}">${icon('edit')}</button>`}

    ${x.fav
      ? html`<button type="button" class="btn tertiary sm icon-only" disabled title="Starred: unstar it to delete" aria-label="Starred: unstar it to delete">${icon('delete')}</button>`
      : html`<button type="button" class="btn ${ask ? 'error' : 'tertiary icon-only'} sm" data-action="sim-delete" data-value="${at}" title="Delete" aria-label="${ask ? 'Confirm delete' : 'Delete'}">${ask ? 'Delete' : icon('delete')}</button>`}
  </div>`;
}

/** A saved run's name and note fields while it's being edited, else its note. */
function runEdit(x: SavedSim<SimResult>): Html {
  const at = String(x.at);
  if (editing === x.at)
    return html`<div class="sim-run-edit">
      <input class="input" data-sim="runname" data-at="${at}" value="${x.name ?? ''}" placeholder="Name" aria-label="Name" maxlength="80" autofocus />
      <input class="input" data-sim="note" data-at="${at}" value="${x.note ?? ''}" placeholder="Note" aria-label="Note" maxlength="300" />
      <button type="button" class="btn secondary sm" data-action="sim-edit" data-value="${at}">Done</button>
    </div>`;
  return x.note ? html`<p class="copy-13 secondary sim-note-text">${x.note}</p>` : html``;
}

/**
 * Every run of this team (its characters, whatever their loadouts), favorites first, then newest first; one opens its
 * result. Recordings (Parsed runs): every video played, whatever its team.
 */
function historyView(names: string[], showing: number | undefined, recordings = false): Html {
  const team = teamKey(names);
  const list = runs.filter((x) => (recordings ? isRecording(x) : !isRecording(x) && teamKey(x.names) === team)).reverse();
  list.sort((a, b) => Number(!!b.fav) - Number(!!a.fav));
  if (!list.length && !recordings) return html``;
  const buttons = (sm: boolean) => html`<button type="button" class="btn ${list.length ? 'secondary' : 'primary'}${sm ? ' sm' : ''}" data-action="sim-read">${icon('movie')}Parse gameplay</button>
    <button type="button" class="btn secondary${sm ? ' sm' : ''}" data-action="sim-import">${icon('upload_file')}Import run</button>`;
  // Parsed runs fold to their title row (with the parse and import buttons) while a run is open.
  const shown = !recordings || !list.length || (runsShown ?? showing === undefined);
  if (!shown)
    return html`<section class="card sim-runs"><div class="card-body sim-card">
      <div class="sim-runs-head">
        <button type="button" class="sim-runs-toggle" data-action="sim-runs" aria-expanded="false">${icon('chevron_right')}<span class="heading-16">Parsed runs</span><span class="label-14 secondary">${list.length}</span></button>
        <div class="sim-runs-buttons">${buttons(true)}</div>
      </div>
    </div></section>`;
  return html`<section class="card${recordings ? ' sim-runs' : ''}"><div class="card-body sim-card">
    ${recordings && list.length
      ? html`<button type="button" class="sim-runs-toggle" data-action="sim-runs" aria-expanded="true">${icon('chevron_right')}<span class="heading-16">Parsed runs</span><span class="label-14 secondary">${list.length}</span></button>`
      : html`<h2 class="heading-16">${recordings ? 'Parsed runs' : 'History'}</h2>`}
    ${recordings && !list.length ? html`<p class="copy-14 secondary">Parse a gameplay recording to see its rotation, timeline and damage.</p>` : ''}
    <div class="sim-history">
      ${list.map((x) => {
        const r = x.result;
        const value = r.hp ? (r.killed ? clockTime(r.seconds) : 'Not defeated') : `${big(r.total / r.seconds)} DPS`;
        return html`<div class="sim-past-row${x.at === showing ? ' on' : ''}">
          <button type="button" class="sim-past" data-action="sim-past" data-value="${String(x.at)}"${recordings ? html` aria-pressed="${x.at === showing ? 'true' : 'false'}"` : ''}>
            <span class="num secondary">${when(x.at)}</span>
            <span class="min0 ellipsis">${x.name ? html`<span class="label-14">${x.name}</span> <span class="secondary">${runLine(x, names)}</span>` : runLine(x, names)}</span>
            <span class="num">${value}</span>
          </button>
          ${recordings ? (x.note ? html`<p class="copy-13 secondary sim-note-text">${x.note}</p>` : '') : html`${runTools(x)} ${runEdit(x)}`}
        </div>`;
      })}
    </div>
    ${recordings ? html`<div class="sim-run">${buttons(false)}</div>` : ''}
  </div></section>`;
}

/** How the controlled operator held: the whole fight, or swapped after the start. */
const controlledSub = (r: SimResult) => (new Set((r.strikes ?? []).map((x) => x.slot)).size > 1 ? 'at the start, swaps after' : 'the whole fight');

function resultsView(r: SimResult, names: string[], ids: string[], stale: boolean, extra: { recording?: Track; simTrack?: Track; underTimeline?: Html; dpsMax?: number; unattributed?: number; noMetrics?: boolean; editor?: (track: Track) => Html; timeline?: SimResult } = {}): Html {
  const rec = extra.recording;
  const shown: Track | null = rec ? (view === 'recording' ? rec : (extra.simTrack ?? simTrack(r))) : null;
  const dps = r.total / r.seconds;
  const time = clockTime(r.seconds);
  const shares = ids.map((id, slot) => ({ id, slot, total: r.byOperator[id] ?? 0 })).sort((a, b) => b.total - a.total);
  return html`<div class="sim-results${stale ? ' stale' : ''}">
    ${extra.noMetrics ? '' : metrics([
      ...(r.hp ? [metric({ label: 'Clear time', value: r.killed ? time : 'Not defeated', sub: r.killed ? `${big(r.hp)} HP` : `${big(r.total)} of ${big(r.hp)} HP in ${time}` })] : []),
      metric({ label: 'DPS', value: big(dps) }),
      metric({ label: 'Total damage', value: big(r.total), sub: `${time} duration` }),
      metric({ label: 'Actions', value: String(r.presses.length), sub: 'besides basic attacks' }),
      ...(names[r.main] ? [metric({ label: 'Controlled', value: names[r.main], sub: controlledSub(r) })] : []),
    ])}
    ${extra.noMetrics ? '' : html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Damage by operator</h2>
      ${shares.map(
        (s) => html`<div class="sim-share">
          ${itemImg('char', s.id, 'sim-portrait sm')}
          <span class="min0 ellipsis">${names[s.slot]}</span>
          <span class="sim-bar"><i style="width:${r.total ? (s.total / r.total) * 100 : 0}%"></i></span>
          <span class="num">${pct(r.total ? s.total / r.total : 0)}</span>
        </div>`,
      )}
    </div></section>`}
    <section class="card"><div class="card-body sim-card${rec ? ' sim-faces' : ''}">
      ${rec ? '' : html`<div class="sim-fold-head"><h2 class="heading-16">Timeline</h2></div>`}
      ${r.order
        ? html`<p class="copy-14">Control ${names[r.main]}. Combo skills as they come up, ultimates when charged, and these battle skills in turn, over and over:</p>
            <ol class="sim-order copy-14">${r.order.map(([slot, input]) => html`<li>${names[slot]} · ${INPUT_NAME[input]}</li>`)}</ol>`
        : ''}
      ${shown
        ? html`${(preparePlay(extra.timeline ?? r), '')}${playControls(extra.timeline ?? r, rec && (r as ReplayResult).buffs?.length ? html`<span class="sim-play-extra">${foldButton('buffs', 'Buffs', true)}</span>` : undefined)}${lanes(shown, names, extra.dpsMax ?? Math.max(...shown.dps, 0), (r as ReplayResult).buffs, rec ? ids : undefined)}${view === 'recording' ? html`${bossRow('', 'video')}${spRow('video')}` : html`${bossRow('', 'sim')}${spRow('sim')}`}`
        : timeline(r, names)}
      ${rec && view !== 'sim' ? '' : (extra.underTimeline ?? '')}
      ${extra.editor
        ? extra.editor(shown ?? simTrack(r))
        : html`<div class="sim-moves-wrap">
      <ol class="sim-moves copy-14${fold.moves ? '' : ' one'}">
        ${((actLabels = moveLabels(shown ?? simTrack(r))), '')}${steps(shown ?? simTrack(r)).map((p) => html`<li class="${p.strike ? 'secondary' : ''}" data-t="${p.frame / FPS}"><span></span><button type="button" class="sim-seek num" data-action="sim-seek" data-value="${String(p.frame / FPS)}" title="Go to ${secs(p.frame)}">${secs(p.frame)}</button><span class="sim-move-op">${p.slot < 0 ? 'Enemy' : names[p.slot]}${opSizers(names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act">${p.label}${actSizers(actLabels)}</span><span></span><span></span><span></span><span class="num sim-move-sp${p.sp && p.sp < 0 ? ' used' : ''}" title="${p.sp ? `${p.sp > 0 ? 'Gained' : 'Used'} ${Math.abs(p.sp)} SP${p.spAfter !== undefined ? `, ${p.spAfter} after` : ''}` : ''}">${spText(p.sp)}</span><span class="num sim-move-spafter">${p.sp !== undefined && p.spAfter !== undefined ? `→ ${p.spAfter}` : ''}</span><span class="num sim-move-dmg">${p.dmg ? big(p.dmg) : ''}</span></li>`)}
      </ol>
      ${foldButton('moves', 'Full transcript')}
      </div>`}
    </div></section>
    ${extra.noMetrics ? '' : html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Where the damage comes from</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Operator</th><th>Source</th><th class="num">Hits</th><th class="num">Damage</th><th class="num">Share</th></tr></thead>
        <tbody>${r.sources.slice(0, 24).map((s) => html`<tr><td>${names[ids.indexOf(s.op)] ?? s.op}</td><td>${s.source}</td><td class="num">${s.hits}</td><td class="num">${big(s.total)}</td><td class="num">${pct(s.total / r.total)}</td></tr>`)}${extra.unattributed ? html`<tr><td class="secondary">Not attributed</td><td class="secondary">No action read for it</td><td class="num"></td><td class="num">${big(extra.unattributed)}</td><td class="num">${pct(extra.unattributed / r.total)}</td></tr>` : ''}</tbody>
      </table></div>
    </div></section>`}
  </div>`;
}

/** Rotations: the Simulator (/rotations) and the Parser (/rotations/parser: a gameplay recording's rotation), as side tabs. */
export function rotationsPage(redraw: () => void, view?: string): Html {
  const header = pageHeader('Rotations', 'The whole sim is still very much a work in progress: expect bugs and results that don’t make sense.');
  const index = wikiFile<CombatIndex>('index.json', redraw, 'combat');
  const ops = wikiFile<WikiOperatorFile>('operators.json', redraw);
  const weapons = wikiFile<WikiWeaponFile>('weapons.json', redraw);
  const gearFile = wikiFile<WikiGearFile>('gear.json', redraw);
  if (!index.data || !ops.data || !weapons.data || !gearFile.data) {
    const failed = index.failed || ops.failed || weapons.failed || gearFile.failed;
    return html`${header}<main class="container fade-in"><p class="copy-14 secondary">${failed ? 'Couldn’t load the combat data. Try again later.' : 'Loading…'}</p></main>`;
  }
  const wiki: Wiki = { ops: ops.data.operators, weapons: weapons.data.weapons, gear: gearFile.data.gear.items };
  wikiNow = wiki;
  const s = settings();
  const team = teamOf(s);
  const mode = s.builds ?? 'mine';
  const optimal = mode === 'optimal';
  const built = team.map((m) => buildOf(m, wiki, index.data!));
  const names = team.map((m) => wiki.ops[m.op]?.name ?? m.op);
  allNames = [...new Set(Object.values(wiki.ops).map((o) => o.name))].sort();
  redrawPage = redraw;
  loadSaved(redraw);
  loadBuffIcons(redraw);
  const tabs = (current: string, body: Html) =>
    html`<main class="container fade-in">${sideTabs('Rotations', [['/rotations', 'Simulator', ''], ['/rotations/parser', 'Parser', '']], current, html`<div class="sim-page">${body}</div>`, header)}</main>`;
  if (view === 'parser') {
    const body = parseView(wiki, index.data, s, redraw);
    return html`<main class="container fade-in">${sideTabs('Rotations', [['/rotations', 'Simulator', ''], ['/rotations/parser', 'Parser', '']], '/rotations/parser', html`<div class="sim-page">${body}</div>`, header, runsAside(replay?.at))}</main>`;
  }
  // Standard and Moderate unless picked.
  const style = s.style ? styleOf(s.style) : 'standard';
  const effort = s.effort ?? 'normal';
  const goal = s.goal ?? 'time';
  const seconds = goal === 'hp' ? (s.limit ?? DEFAULT_LIMIT) : (s.seconds ?? DEFAULT_SECONDS);
  const foe = enemyById(s.enemy);
  const hp = goal === 'hp' ? (s.hp ?? foe.hp) : undefined;
  const enemy = foe.id === 'dummy' ? {} : { enemy: foe.enemy };
  // The share of the fight the enemy can be hit (unset or 100%: all of it).
  const uptime = s.uptime && s.uptime < 100 ? s.uptime / 100 : undefined;
  const at = s.controlled ? team.findIndex((m) => m.op === s.controlled) : -1;
  const main = at >= 0 ? { main: at } : {};
  const req: SimRequest = optimal
    ? {
        builds: team.map((m, i) => optimalBuildOf(m, built[i].build)),
        seconds,
        hp,
        startSp: s.startSp,
        uptime,
        ...enemy,
        ...main,
        style,
        effort,
        optimize: { weapons: team.map((m) => (m.weapon ? [m.weapon] : weaponsFor(m.op, wiki, index.data!))), limited: limitedWeapons(), signatures: signatureWeapons() },
      }
    : { builds: built.map((b) => b.build), seconds, hp, startSp: s.startSp, uptime, ...enemy, ...main, style, effort };
  const key = JSON.stringify(req);
  // A run picked from the history stays while the team's the same; else this setup's saved result, when there's one
  // and nothing newer for it is showing.
  if (picked && result && teamKey(result.names) !== teamKey(names)) picked = false;
  const before = saved?.get(key);
  if (before && !running && !picked && result?.key !== key) result = { ...before };
  const fresh = result?.key === key;
  const blocked = optimal ? req.optimize!.weapons.some((w) => !w.length) : built.some((b) => !b.build.weapon);
  // The builds the last run chose, for the members still where they were.
  const chosen = (i: number) => (result && result.ids[i] === team[i].op && JSON.parse(result.key).optimize ? result.result.builds[i] : undefined);
  if (pending) {
    pending = false;
    if (!blocked) run(req, key, names, s.cores ?? AUTO_CORES, redraw);
  }
  const progress = running?.progress;
  return tabs(
    '/rotations',
    html`<details class="card sim-how"><summary class="card-body label-14">How it works</summary>
        <dl class="card-body copy-14">${HOW.map(([k, v]) => html`<div><dt class="label-14">${k}</dt><dd class="secondary">${v}</dd></div>`)}</dl>
      </details>
      <section class="card"><div class="card-body sim-card">
        <h2 class="heading-16">Team</h2>
        ${toggleGroup('sim-builds', BUILD_MODES, mode)}
        <div class="sim-team">${team.map((m, i) => memberCard(m, i, team.length, wiki, index.data!, built[i].build, optimal, chosen(i), team))}</div>
      </div></section>
      <section class="card"><div class="card-body sim-card">
        <h2 class="heading-16">Rotation</h2>
        <div class="sim-options">
          <div class="sim-field"><span class="label-12 secondary">Style</span>${toggleGroup('sim-style', STYLES, style)}</div>
          <div class="sim-field"><span class="label-12 secondary">Search</span>${toggleGroup('sim-effort', EFFORTS, effort)}</div>
          <div class="sim-field"><span class="label-12 secondary">Goal</span>${toggleGroup('sim-goal', GOALS, goal)}</div>
        </div>
        <p class="copy-13 secondary">${STYLE_NOTE[style]}</p>
        <div class="sim-options">
          <label class="sim-field"><span class="label-12 secondary">Controlled</span><select class="input sim-enemy" data-sim="controlled" aria-label="Controlled">
            <option value="" ${at < 0 ? 'selected' : ''}>Auto (Best)</option>
            ${team.map((m, i) => html`<option value="${m.op}" ${i === at ? 'selected' : ''}>${names[i]}</option>`)}
          </select></label>
          <label class="sim-field"><span class="label-12 secondary">Enemy</span><select class="input sim-enemy" data-sim="enemy" aria-label="Enemy">
            ${ENEMIES.map((e) => html`<option value="${e.id}" ${e.id === foe.id ? 'selected' : ''}>${e.name}</option>`)}
          </select></label>
          ${hp !== undefined
            ? html`<label class="sim-field"><span class="label-12 secondary">Enemy HP</span><input class="input sim-hp" type="text" inputmode="numeric" data-sim="hp" value="${big(hp)}" /></label>`
            : ''}
          <label class="sim-field"><span class="label-12 secondary">${hp !== undefined ? 'Time limit (s)' : 'Fight length (s)'}</span><input class="input sim-num" type="number" min="5" max="300" data-sim="seconds" value="${seconds}" /></label>
          <label class="sim-field"><span class="label-12 secondary">SP at the start</span><input class="input sim-num" type="number" min="0" max="300" data-sim="sp" value="${s.startSp ?? ''}" placeholder="${START_SP}" /></label>
          <label class="sim-field"><span class="label-12 secondary">Uptime (%)</span><input class="input sim-num" type="number" min="10" max="100" data-sim="uptime" value="${s.uptime ?? ''}" placeholder="100" /></label>
          <label class="sim-field"><span class="label-12 secondary">Threads</span><select class="input sim-cores" data-sim="cores" aria-label="Threads">
            <option value="" ${s.cores ? '' : 'selected'}>Auto (${AUTO_CORES})</option>
            ${Array.from({ length: CORES }, (_, k) => k + 1).map((c) => html`<option value="${c}" ${s.cores === c ? 'selected' : ''}>${c}</option>`)}
          </select></label>
        </div>
        <div class="sim-run">
          ${running
            ? html`<button type="button" class="btn secondary" data-action="sim-stop">${icon('stop')}Stop</button>
                <span class="copy-14 secondary">${icon('hourglass_empty')} ${running.loading
                  ? 'Loading the combat data…'
                  : progress?.phase === 'gear'
                    ? `Choosing weapons and gear · ${Math.min(100, Math.round((progress.played / progress.budget) * 100))}%`
                    : progress
                      ? `${progress.killedIn !== undefined ? `Fastest so far ${clockTime(progress.killedIn)}` : `Best so far ${big(progress.dps)} DPS`} · ${Math.min(100, Math.round((progress.played / progress.budget) * 100))}%${(running.cores ?? 1) > 1 ? ` · ${running.cores} threads` : ''}`
                      : 'Searching…'}</span>`
            : html`<button type="button" class="btn primary" data-action="sim-run" ${blocked ? 'disabled' : ''}>${icon(fresh ? 'refresh' : 'play_arrow')}${fresh ? 'Run again' : 'Find rotation'}</button>
                ${fresh && result?.at ? html`<span class="copy-13 secondary">Saved ${new Date(result.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · took ${Math.max(1, Math.round(result.result.ms / 1000))} s</span>` : ''}
                ${blocked ? html`<span class="copy-13 secondary">${optimal ? 'An operator here has no weapons with combat data yet.' : 'Every operator needs a weapon in their loadout.'}</span>` : ''}`}
        </div>
        ${failed ? html`<p class="copy-14 sim-error">${failed}</p>` : ''}
      </div></section>
      ${historyView(names, result?.at)}
      ${result ? resultsView(result.result, result.names, result.ids, picked ? !!running : result.key !== key || !!running) : ''}
      ${CREDIT}`,
  );
}

const CREDIT = html`<p class="copy-13 secondary">Game data © Gryphline / Hypergryph. Damage formula from endfield.wiki.gg, CC BY-SA 4.0. Simulated in this browser.</p>`;

/**
 * The Parser tab: a gameplay recording's rotation as read (ui/rotationReader.ts), played in the sim. What the video
 * shows (team, enemy, every press) can't be changed here; only food, which a video can't show. Builds are the
 * operators' loadouts.
 */
function parseView(wiki: Wiki, index: CombatIndex, s: SimSettings, redraw: () => void): Html {
  const open = replay?.at === undefined ? undefined : runs.find((x) => x.at === replay!.at);
  const v = video ?? (open && videoOf(open)) ?? lastVideo;
  const idOf = new Map(pickable(wiki, index, []).map((id) => [wiki.ops[id].name, id]));
  // The boss bar's name.
  const seen = v?.enemy;
  const foe = enemySeen(seen);
  laneFoe = foe;
  const ops = v ? v.names.map((n) => idOf.get(n)) : [];
  // A new reading's food is what was picked before simulating it.
  const builds = ops.map((op, i) => {
    const food = video ? video.food?.[video.names[i]] : s.videoFood?.[op ?? ''];
    return op ? buildOf({ op, ...(food ? { food } : {}) }, wiki, index) : null;
  });
  // An open run's own request: the builds and food it ran with, and its boss's stage rules.
  const runReq = open && !video ? (JSON.parse(open.key) as SimRequest) : undefined;
  // The stage's rules from the boss the recording names (saved requests predate them); no boss read: the dummy's.
  const foodOk = (foe?.enemy ?? enemyById().enemy).food !== false;
  if (video) {
    const pend = video;
    video = null;
    const unknown = pend.names.filter((_, i) => !ops[i]);
    if (unknown.length) replay = { names: pend.names, ids: [], error: `No combat data yet for ${unknown.join(', ')}.` };
    else if (builds.some((b) => !b!.build.weapon)) replay = { names: pend.names, ids: [], error: 'Every operator needs a weapon in their loadout.' };
    else
      runReplay(
        pend,
        pend.names.map((_, i) => i),
        { builds: builds.map((b) => b!.build), seconds: pend.seconds, style: 'advanced', effort: 'normal', ...(foe && foe.id !== 'dummy' ? { enemy: foe.enemy } : {}) },
        pend.names,
        ops as string[],
        redraw,
      );
  }
  const fact = (label: string, value: string | Html, sub?: string) => html`<div class="sim-run-fact"><span class="metric-label">${label}</span><span class="sim-run-value">${value}</span>${sub ? html`<span class="copy-13 secondary">${sub}</span>` : ''}</div>`;
  // The open run's figures (the recording's damage, as its breakdown below), laid out in its summary.
  const card = replay?.result && !replay.error ? recordingCard(replay) : undefined;
  liveDmg = card?.live;
  const shown = card?.shown;
  // The team's shares of the damage, in team order: each loadout box's bar shows them all, its own operator's bright.
  const shares = ops.map((op) => (shown && op && shown.total ? (shown.byOperator[op] ?? 0) / shown.total : 0));
  // Who was controlled, and how much: their share of the run's Final Strikes and Finishers (only the controlled
  // operator makes them); none read, the run's controlled operator.
  const strikes = shown?.strikes ?? [];
  const held = ops.map((_, k) => (strikes.length ? strikes.filter((x) => x.slot === k).length / strikes.length : shown && shown.main === k ? 1 : 0));
  const most = held.indexOf(Math.max(...held));
  // While editing, the outline is the draft's: whoever makes every Final Strike and Finisher (click a box to give
  // them all to that operator, `sim-main`).
  const draftMain = (() => {
    if (!open || draft?.at !== open.at) return undefined;
    const who = new Set(draft.steps.filter((x) => x.input === 'strike' || x.input === 'finisher').map((x) => x.slot));
    return who.size === 1 ? [...who][0] : -1;
  })();
  const controlClass = (k: number) =>
    draftMain !== undefined ? (k === draftMain ? ' controlled' : '') : !shown || !held[k] ? '' : k === most ? ' controlled' : ' controlled-some';
  // Each teammate's segment in their portrait's main colour (the Database hero glow's, tint.ts tintHeroes).
  const portrait = (op: string | undefined) => (op ? itemIconUrl('char', op) : null);
  const tintOf = (op: string | undefined) => {
    const src = portrait(op);
    return src ? tintFor(src) : 'var(--gray-alpha-400)';
  };
  const tinted = (op: string | undefined) => {
    const src = portrait(op);
    return src ? html`data-hero-tint="${src}" data-hero-tint-skin` : '';
  };
  const teamShare = (mine: number) =>
    html`<span class="sim-member-share" role="img" aria-label="${shares.map((x, k) => `${v?.names[k] ?? ''} ${pct(x)}`).join(', ')}; ${v?.names[mine] ?? ''}’s marked">${shares.map((x, k) => (x > 0 ? html`<i class="${k === mine ? 'on' : ''}" ${tinted(ops[k])} style="flex-basis:${(barShown.get(`${mine}|${ops[k] ?? ''}`) ?? x) * 100}%;--banner-tint:${tintOf(ops[k])}" data-live-box="${mine}" data-live-bar="${ops[k] ?? ''}" data-full="${x}" title="${v?.names[k] ?? ''} ${pct(x)}"></i>` : ''))}</span>`;
  // Under the Sim view, when the sim's boss died (ReplayResult.clear: the sim's own clear time, no time limit).
  const simRun = !replay?.error ? (replay?.result as ReplayResult | undefined) : undefined;
  const clear = view === 'sim' ? simRun?.clear : undefined;
  const clearTotal = clear !== undefined ? simRun?.clearTotal : undefined;
  // This side against the other (Recording: VS Sim; Sim: VS Run): how much sooner or later it cleared (the sim's to
  // its kill, the recording's to its stop).
  const versus = (() => {
    if (!simRun || !shown || !v) return html``;
    const simSecs = simRun.clear ?? simRun.seconds;
    const dt = view === 'sim' ? simSecs - v.seconds : v.seconds - simSecs;
    return fact(view === 'sim' ? 'VS Run' : 'VS Sim', `${Math.abs(dt).toFixed(1)} s ${dt <= 0 ? 'faster' : 'slower'}`);
  })();
  // The summary's damage: the recording's (the sim's split fitted to its HP bar), or under the Sim view the sim's own.
  const figures = view === 'sim' && replay?.result && !replay.error ? replay.result : shown;
  const team = html`${v
        ? html`<div class="sim-run-facts">
              ${figures ? fact('DPS', big((clearTotal ?? figures.total) / (clear ?? figures.seconds))) : ''}
              ${figures ? fact('Total damage', big(clearTotal ?? figures.total)) : ''}
              ${open && draft?.at === open.at && v
                ? fact('Duration', html`<input class="sim-inl num sim-run-value-edit" type="text" inputmode="decimal" value="${clockTime(draft.seconds)}" style="--d:${clockTime(draft.seconds).length}" data-sim="step-len" aria-label="Duration" title="The fight's length on its timer (m:ss.s or seconds)" />`)
                : fact('Duration', clockTime(clear ?? v.seconds))}
              ${fact('Actions', String(shown ? shown.presses.length : v.steps.filter((x) => x.input !== 'strike' && x.input !== 'finisher').length))}
              ${card?.unattributed && view !== 'sim' ? fact('Not attributed', big(card.unattributed), `${pct(card.unattributed / shown!.total)}: no action read for it`) : ''}
              ${versus}
              ${open && draft?.at === open.at
                ? html`<label class="sim-run-note-box"><textarea class="sim-run-note" data-sim="note" data-at="${String(open.at)}" placeholder="Note" aria-label="Note" maxlength="300" rows="2">${open.note ?? ''}</textarea></label>`
                : open?.note
                  ? html`<div class="sim-run-note-box"><p class="copy-13">${open.note}</p></div>`
                  : ''}
            </div>
            <div class="sim-team">
              ${v.names.map((name, i) => {
                const op = ops[i];
                const b = (runReq && open && draft?.at === open.at ? draft.builds[i] : runReq?.builds[i]) ?? builds[i]?.build;
                const editingRun = !!runReq && !!b && !!open && draft?.at === open.at;
                // This operator's share of the run's damage (the recording's, as the breakdown below splits it).
                const dealt = shown && op ? (shown.byOperator[op] ?? 0) : undefined;
                const share = dealt !== undefined && shown!.total ? dealt / shown!.total : undefined;
                return html`<div class="sim-member${controlClass(i)}${editingRun ? ' pickable' : ''}" ${editingRun ? html`data-action="sim-main" data-value="${i}" title="Click: ${name} controlled the whole fight"` : held[i] && shown ? html`style="--held:${held[i]}" title="Controlled ${i === most && held[i] === 1 ? 'the whole fight' : `${pct(held[i])} of the fight`}"` : ''}>
                  <div class="sim-op${editingRun ? ' editing' : ''}">${op ? html`<a class="sim-op-name" href="${infoHref('char', op)}" title="${name}’s page">${itemImg('char', op, 'sim-portrait')}${editingRun ? '' : html`<span class="label-14 ellipsis">${name}</span>`}</a>` : editingRun ? '' : html`<span class="label-14 ellipsis">${name}</span>`}${b ? html`<span class="label-12 secondary">P${editingRun ? inl(i, 'potential', b.potential, 0, 5, 'Potential') : b.potential}</span>` : ''}${b && editingRun ? levelsEdit(i, b) : b && levelsLine(b) ? html`<span class="label-12 secondary num sim-op-levels" title="Level and skill ranks">${levelsLine(b)}</span>` : ''}</div>
                  ${op && !runReq ? foodPicker(foodOk ? b?.food : undefined, foodOk, runReq ? html`data-sim="runfood" data-i="${i}"` : html`data-sim="vfood" data-op="${op}"`) : ''}
                  <div class="sim-gear copy-13">${b ? buildLines(b, wiki, editingRun ? i : undefined) : ''}${b && runReq && foodOk ? foodLine(b, editingRun ? i : undefined) : ''}</div>
                  ${shown && op
                    ? (() => {
                        const own = shown.sources.filter((x) => x.op === op).sort((a, c) => c.total - a.total);
                        return own.length
                          ? html`<div class="sim-member-sources copy-13">
                              ${own.map((x) => html`<div class="sim-member-source" title="${x.hits} hit${x.hits === 1 ? '' : 's'}"><span class="min0 ellipsis">${x.source}</span><span class="num secondary" data-live="${x.op}|${x.source}" data-full="${x.total}">${big(x.total)}</span><span class="num" data-live-pct="${x.op}|${x.source}" data-full="${x.total / shown.total}">${pct(x.total / shown.total)}</span></div>`)}
                              <div class="sim-member-source total"><span>Total</span><span class="num" data-live-op="${op}" data-full="${dealt ?? 0}">${big(dealt ?? 0)}</span><span class="num" data-live-op-pct="${op}" data-full="${share ?? 0}">${pct(share ?? 0)}</span></div>
                              ${teamShare(i)}
                            </div>`
                          : '';
                      })()
                    : ''}
                </div>`;
              })}
            </div>`
        : ''}`;
  // A read waiting for picks, else the open run (its title, team and results), else a start; Parsed runs are in the
  // side column (runsAside).
  if (draftOpen && readerEl) {
    queueMicrotask(mountReader);
    return html`<section class="card reader-card"><div class="card-body" data-reader-mount></div></section>${CREDIT}`;
  }
  // The enemy in the subtitle when the title doesn't name it.
  const enemyLine = open && !open.name && foe ? '' : (foe?.name ?? (seen ? `${seen} (not in the sim yet: the training dummy)` : 'No boss read: the training dummy'));
  if (replay) return html`${runHead(foe?.name ?? seen ?? 'Parsed run', team, enemyLine)}${replayView(replay, card)}${CREDIT}`;
  return html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Parser</h2>
      <p class="copy-14 secondary">${runs.some(isRecording) ? 'Open a parsed run, or parse a gameplay recording.' : 'Parse a gameplay recording to see its rotation, timeline and damage.'}</p>
      <div class="sim-run">${parseButtons(false)}</div>
    </div></section>${CREDIT}`;
}

/** Parse a recording, or import a run file. */
const parseButtons = (sm: boolean): Html =>
  html`<button type="button" class="btn primary${sm ? ' sm' : ''}" data-action="sim-read">${icon('movie')}Parse gameplay</button>
    <button type="button" class="btn secondary${sm ? ' sm' : ''}" data-action="sim-import">${icon('upload_file')}Import run</button>`;

/**
 * Parsed runs in the Parser's side column, under its tabs: a read waiting for picks first, then favorites, then
 * newest; each its name (or boss), date and DPS, the open one marked.
 */
function runsAside(showing: number | undefined): Html {
  const list = runs.filter(isRecording).reverse();
  list.sort((a, b) => Number(!!b.fav) - Number(!!a.fav));
  return html`<section class="sim-runs-side" aria-label="Parsed runs">
    <h2 class="label-12 secondary">Parsed runs</h2>
    ${hasDraft
      ? html`<button type="button" class="sim-side-run draft" data-action="sim-draft" aria-pressed="${draftOpen ? 'true' : 'false'}">
          <span class="label-14 ellipsis">${icon('pending')}Not simulated yet</span>
          <span class="label-12 secondary">Pick who's who, then simulate</span>
        </button>`
      : ''}
    ${list.map((x) => {
      const r = x.result;
      const value = r.hp ? (r.killed ? clockTime(r.seconds) : 'Not defeated') : `${big(r.total / r.seconds)} DPS`;
      // Its name, else its boss as the stage's own name (the boss's name as read can come out garbled).
      const seen = (x.video as VideoRotation | undefined)?.enemy;
      const title = x.name ?? enemySeen(seen)?.name ?? seen ?? 'Parsed run';
      return html`<button type="button" class="sim-side-run" data-action="sim-past" data-value="${String(x.at)}" aria-pressed="${x.at === showing && !draftOpen ? 'true' : 'false'}">
        <span class="label-14 ellipsis">${x.fav ? icon('star', true) : ''}${title}</span>
        <span class="label-12 secondary ellipsis">${when(x.at)} · ${value}</span>
      </button>`;
    })}
    <div class="sim-side-buttons">${parseButtons(true)}</div>
  </section>`;
}
