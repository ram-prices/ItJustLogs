import { GEAR_SLOTS, artificeOf, type Loadout } from '../../domain/loadout';
import { FPS, type Enemy, type Input } from '../../domain/sim/engine';
import { compareWithVideo } from '../../domain/sim/videoCheck';
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
  styleOf,
  type BuildMode,
  type Effort,
  type Goal,
  type SimBuild,
  type SimMember,
  type SimProgress,
  type SimRequest,
  type SimResult,
  type ReplayResult,
  type ReplayStep,
  type SimSettings,
  type Style,
} from '../../domain/sim/team';
import { wikiId, type WikiGearFile, type WikiOperatorFile, type WikiWeaponFile } from '../../domain/wiki';
import { state, updateSettings } from '../../state';
import { cachedBannerDb, deleteSim, listSims, loadSimVideo, saveSim, saveSimVideo, updateSim, type SavedSim } from '../../store';
import { badge, icon, itemImg, metric, metrics, pageHeader, toggleGroup } from '../components';
import { toast } from '../common';
import { html, type Html } from '../html';
import { infoHref, ownedOf, sideTabs, wikiFile } from './info';
import type { VideoRotation } from '../rotationReader';
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
let draft: { at: number; steps: VideoStep[]; away: [number, number][] } | null = null;
let deleting: number | null = null;

function loadSaved(redraw: () => void): void {
  if (saved || savedLoading) return;
  savedLoading = true;
  void Promise.all([listSims<SimResult>(), loadSimVideo<VideoRotation>()]).then(([list, v]) => {
    runs = list;
    saved = new Map(list.map((x) => [x.key, x]));
    lastVideo ??= v ?? null;
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
  replay = { names, ids, at: into?.at };
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
  w.postMessage({ id, req, replay: steps, stopwatch: { end: v.end ?? v.seconds, pauses: v.pauses ?? [], away: v.away ?? [], guard: v.guard ?? [] } });
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

/** Opens an exported parsed run: it joins Parsed runs (as new, so it never replaces one) and opens. */
function importRun(): void {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d?.kind !== RUN_FILE || !d.result || !Array.isArray(d.names) || !d.request) throw new Error('not a parsed run');
      const entry: SavedSim<SimResult> = { key: JSON.stringify({ ...d.request, video: true }), result: d.result, names: d.names, ids: d.ids ?? [], at: Date.now(), ...(d.name ? { name: d.name } : {}), ...(d.note ? { note: d.note } : {}), ...(d.video ? { video: d.video } : {}) };
      runs.push(entry);
      void saveSim(entry);
      replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
      redrawPage();
    } catch {
      toast('That file isn’t an exported parsed run.', 'error');
    }
  };
  input.click();
}

/**
 * The open parsed run, above the Recording: its time and name, its buttons under them (Edit transcript, star, edit,
 * delete), the name and note fields while edited, and the transcript editor.
 */
function runHead(): Html {
  const entry = replay?.at === undefined ? undefined : runs.find((x) => x.at === replay!.at);
  if (!entry) return html``;
  return html`<section class="card sim-run-head"><div class="card-body">
      <div class="sim-run-title"><span class="num secondary">${when(entry.at)}</span><span class="label-16 ellipsis">${entry.name ?? runLine(entry, entry.names)}</span></div>
      <div class="sim-run-buttons">
        ${videoOf(entry) ? html`<button type="button" class="btn secondary sm" data-action="sim-transcript" data-value="${String(entry.at)}" aria-pressed="${draft?.at === entry.at ? 'true' : 'false'}">${icon('description')}Edit transcript</button>` : ''}
        <button type="button" class="btn secondary sm" data-action="sim-export" data-value="${String(entry.at)}">${icon('download')}Export</button>
        ${runTools(entry)}
      </div>
      ${runEdit(entry)}
    </div></section>
    ${transcriptEditor(entry)}`;
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
 * A parsed run's own timeline, 1:1 with the recording (recordingTrack), with the player's controls and the video's
 * boss bars under it; the sim's timeline follows with its own bars. The damage lanes share one scale.
 */
function recordingCard(r: NonNullable<typeof replay>): { before?: Html; dpsMax?: number } {
  const entry = r.at === undefined ? undefined : runs.find((x) => x.at === r.at);
  const reading = entry && videoOf(entry);
  if (!r.result || !entry || !reading?.boss?.length) return {};
  const asked = (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy;
  const enemy = typeof asked === 'object' ? asked : asked ? enemyById(asked).enemy : undefined;
  const rec = recordingTrack(reading, r.result.seconds, enemy?.phaseHp ?? r.result.hp);
  const dpsMax = Math.max(...rec.dps, ...simTrack(r.result).dps, 0);
  preparePlay(r.result);
  return {
    dpsMax,
    before: html`<section class="card"><div class="card-body sim-card">
      <div class="sim-fold-head"><h2 class="heading-16">Timeline · Recording</h2>${foldButton('video', '')}</div>
      ${playControls(r.result)}
      ${fold.video ? html`${lanes(rec, r.names, dpsMax)}${bossRow('Video', 'video')}` : ''}
    </div></section>`,
  };
}

/** The video's rotation as the sim played it: the usual results, and the presses it couldn't make. */
function replayView(r: NonNullable<typeof replay>): Html {
  const missed = r.result?.missed ?? [];
  return html`<section class="sim-video">
    ${r.error
      ? html`<p class="copy-14 sim-error">${r.error}</p>`
      : !r.result
        ? html`<p class="copy-14 secondary">${icon('hourglass_empty')} Playing the recording’s actions…</p>`
        : html`${resultsView(r.result, r.names, r.ids, false, { ...recordingCard(r), underTimeline: videoCheck(r) })}
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
      const entry = runs.find((x) => String(x.at) === v);
      if (entry && isRecording(entry)) replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
      else if (entry && !running) {
        result = { ...entry };
        picked = true;
      }
      return true;
    }
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
      if (v === 'video' || v === 'checks') fold[v] = !fold[v];
      return true;
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
      draft = draft?.at === entry?.at || !entry || !reading ? null : { at: entry.at, steps: reading.steps.map((x) => ({ ...x })), away: (reading.away ?? []).map(([a, b]) => [a, b]) };
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
    case 'sim-step-cancel':
      draft = null;
      return true;
    case 'sim-step-save': {
      const entry = draft && runs.find((x) => x.at === draft!.at);
      const reading = entry && videoOf(entry);
      if (entry && reading && draft) {
        const { video: _, ...req } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
        const away = draft.away.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
        const edited = { ...reading, steps: draft.steps.slice().sort((a, b) => a.t - b.t), away };
        draft = null;
        runReplay(edited, edited.names.map((_, i) => i), req, entry.names, entry.ids, redrawPage, entry);
      }
      return true;
    }
    case 'sim-delete': {
      const at = Number(v);
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
      void import('../rotationReader').then((m) =>
        m.readGameplay(allNames, (v) => {
          video = v;
          lastVideo = v;
          void saveSimVideo(v);
          redrawPage();
        }),
      );
      return true;
    case 'sim-video-again':
      video = lastVideo;
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
  else if (f === 'step-main') {
    for (const step of draft?.steps ?? []) if (step.input === 'strike' || step.input === 'finisher') step.slot = Number(el.value) as VideoStep['slot'];
    redrawPage();
  }
  // A press in a transcript being edited (no redraw, so Tab moves along; sorted by time when played).
  // A stretch the enemy is invulnerable: from, to.
  else if (f === 'away-a' || f === 'away-b') {
    const stretch = draft?.away[Number(el.dataset.k)];
    if (stretch) stretch[f === 'away-a' ? 0 : 1] = Math.max(0, Number(el.value) || 0);
  }
  else if (f === 'step-t' || f === 'step-slot' || f === 'step-input') {
    const step = draft?.steps[Number(el.dataset.k)];
    if (step && f === 'step-t') step.t = Math.max(0, Number(el.value) || 0);
    else if (step && f === 'step-slot') step.slot = Number(el.value) as VideoStep['slot'];
    else if (step) step.input = el.value as VideoStep['input'];
  }
  // The timeline player: where, how fast.
  else if (f === 'play-seek') {
    play.t = Math.max(0, Number(el.value) || 0);
    paintPlay();
  } else if (f === 'play-speed') play.speed = Number(el.value) || 1;
  // A battle skill's SP back in the recording (blank: unknown).
  else if (f === 'step-back') {
    const step = draft?.steps[Number(el.dataset.k)];
    if (step) step.back = el.value.trim() === '' ? undefined : Math.max(0, Number(el.value) || 0);
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
    if (entry && f === 'runname') void updateSim(entry.at, { name: (entry.name = value) });
    else if (entry) void updateSim(entry.at, { note: (entry.note = value) });
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
  const w = build.weapon ? wiki.weapons[build.weapon.id] : undefined;
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
      <label class="label-12 secondary">Food <select class="input sim-food" data-sim="food" data-i="${i}" aria-label="Food">
        <option value="" ${m.food ? '' : 'selected'}>None</option>
        ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === m.food ? 'selected' : ''}>${f.name}</option>`)}
      </select></label>
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
      ${optimal ? '' : build.weapon
        ? html`<div class="sim-weapon">${itemImg('weap', build.weapon.id, 'sim-weapon-img')}<span class="min0 ellipsis">${w?.name ?? build.weapon.id}</span></div>`
        : ''}
      ${optimal ? '' : GEAR_SLOTS.map(({ slot, label }) => {
        const id = l[slot];
        const g = id ? wiki.gear[id] : undefined;
        return g ? html`<div class="sim-piece secondary ellipsis">${g.name}${build.gear.find((x) => x.id === id)?.artifice ? html` <span class="label-12">+${artificeOf(l, slot, g)}</span>` : ''}</div>` : html`<div class="sim-piece secondary">No ${label.toLowerCase()}</div>`;
      })}
    </div>
  </div>`;
}

/** A build's weapon and gear, as lines. */
function buildLines(b: SimBuild, wiki: Wiki): Html {
  return html`${b.weapon?.id ? html`<div class="sim-weapon">${itemImg('weap', b.weapon.id, 'sim-weapon-img')}<span class="min0 ellipsis">${wiki.weapons[b.weapon.id]?.name ?? b.weapon.id}</span></div>` : ''}
    ${b.gear.map((g) => html`<div class="sim-piece secondary ellipsis">${wiki.gear[g.id]?.name ?? g.id}${g.artifice ? html` <span class="label-12">+${g.artifice}</span>` : ''}</div>`)}`;
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
function recordingTrack(reading: VideoRotation, seconds: number, phaseHp: number | undefined): Track {
  const pauses = reading.pauses ?? [];
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  const f = (t: number) => Math.round(clock(t) * FPS);
  const presses: Track['presses'] = [];
  const strikes: Track['strikes'] = [];
  const mechanics: Track['mechanics'] = [];
  const who = new Map<number, number>();
  for (const x of reading.steps) {
    if (x.input === 'strike' || x.input === 'finisher') {
      strikes.push({ frame: f(x.t), slot: x.slot, finisher: x.input === 'finisher' });
      who.set(x.slot, (who.get(x.slot) ?? 0) + 1);
    } else presses.push({ frame: f(x.t), slot: x.slot, input: x.input });
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
    // The meter reaching half: the boss's Stagger node.
    if (meter >= 0.5 && under) mechanics.push({ frame: Math.round(c * FPS), label: 'Stagger node' });
    if (meter >= 0 && meter < 0.5) under = true;
    if (meter >= 0.5) under = false;
    // A new phase refills the bar; otherwise what it lost is damage.
    if (phaseHp) {
      if (t - lastT > 2 && hp > lastHp + 0.3) lastHp = 1;
      const k = Math.floor(c);
      while (dps.length <= k) dps.push(0);
      dps[k] += Math.max(0, lastHp - hp) * phaseHp;
      lastHp = Math.min(lastHp, hp);
    }
    lastT = t;
  }
  return { seconds, main, presses, strikes, staggers, mechanics, away: (reading.away ?? []).map(([a, b]) => [clock(a), clock(b)] as [number, number]).map(([a, b]) => [a * FPS, b * FPS] as [number, number]), guard: (reading.guard ?? []).map(([a, b]) => [clock(a) * FPS, clock(b) * FPS] as [number, number]), dps };
}

/** The lanes of a track: each operator's presses and Final Strikes, the damage each second, the enemy's stretches. */
function lanes(r: Track, names: string[], dpsMax: number): Html {
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
  return html`<div class="sim-timeline" role="img" aria-label="Actions over the fight">
    ${names.map(
      (name, slot) => html`<div class="sim-lane">
        <span class="sim-lane-name label-12 ellipsis">${name}</span>
        <span class="sim-lane-track">
          ${spans.filter((s) => s.slot === slot).map((s) => html`<i class="sim-control" style="left:${at(s.from)};width:${at(s.to - s.from)}"></i>`)}
          ${r.presses
            .filter((p) => p.slot === slot && p.input !== 'swap')
            .map((p) => html`<i class="sim-press ${p.input}" style="left:${at(p.frame)}" title="${secs(p.frame)} · ${INPUT_NAME[p.input]}">${p.input === 'battle' ? 'B' : p.input === 'combo' ? 'C' : p.input === 'dive' ? 'D' : 'U'}</i>`)}
          ${r.strikes
            .filter((s) => s.slot === slot)
            .map((s) => html`<i class="sim-strike${s.finisher ? ' finisher' : ''}" style="left:${at(s.frame)}" title="${secs(s.frame)} · ${s.finisher ? 'Finisher' : 'Final Strike'}"></i>`)}
        </span>
      </div>`,
    )}
    ${r.dps.length && dpsMax > 0
      ? html`<div class="sim-lane">
          <span class="sim-lane-name label-12 ellipsis">Damage</span>
          <span class="sim-lane-track sim-dmg">${r.dps.map((d, k) => (d > 0 ? html`<i style="left:${at(k * FPS)};width:${at(FPS)};height:${Math.max(4, Math.round((d / dpsMax) * 100))}%" title="${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')} · ${big(d)}"></i>` : ''))}</span>
        </div>`
      : ''}
    ${r.staggers.length || r.mechanics.length || r.away.length || r.guard.length
      ? html`<div class="sim-lane">
          <span class="sim-lane-name label-12 ellipsis">Enemy</span>
          <span class="sim-lane-track">${r.away.map(([a, b]) => html`<i class="sim-away" style="left:${at(a)};width:${at(b - a)}" title="${secs(a)} · Invulnerable ${((b - a) / FPS).toFixed(1)} s"></i>`)}${r.guard.map(([a, b]) => html`<i class="sim-guard" style="left:${at(a)};width:${at(b - a)}" title="${secs(a)} · No Stagger ${((b - a) / FPS).toFixed(1)} s"></i>`)}${r.staggers.map((s) => html`<i class="sim-stagger" style="left:${at(s.frame)};width:${at(s.end - s.frame)}" title="${secs(s.frame)} · Staggered ${((s.end - s.frame) / FPS).toFixed(1)} s"></i>`)}${r.mechanics.map((m) => html`<i class="sim-mechanic" style="left:${at(m.frame)}" title="${secs(m.frame)} · ${m.label}">${icon(m.label === 'Interrupted' ? 'close' : m.label === 'Stagger node' ? 'change_history' : 'swords')}</i>`)}</span>
        </div>`
      : ''}
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
const play = { t: 0, speed: 1, running: false, of: null as SimResult | null, raf: 0, last: 0 };
/** The boss's bars over the fight: HP left (0–1) and its Stagger meter (0–1, -1 Staggered, NaN unknown). */
type Bars = { t: number[]; hp: number[]; meter: number[] };
let playBars: { sim: Bars; video?: Bars; seconds: number } | null = null;
/** What's shown under the timeline: the video's bars, the discrepancies list. */
const fold = { video: true, checks: true };
const foldButton = (what: keyof typeof fold, label: string) =>
  html`<button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-fold" data-value="${what}" title="${fold[what] ? 'Hide' : 'Show'}" aria-expanded="${fold[what] ? 'true' : 'false'}">${label} ${icon(fold[what] ? 'visibility_off' : 'visibility')}</button>`;

/**
 * The boss's bars as the sim's fight would show them, from its track (a replay's has its meter; a search's only
 * when it was Staggered). A boss with phases (a recording's pauses) starts each phase full; without HP to go by (a
 * dummy for a time), the bar empties as the fight's damage adds up.
 */
function simBars(r: SimResult, enemy: Enemy | undefined, pauses: [number, number][], clock: (t: number) => number): Bars {
  const out: Bars = { t: [], hp: [], meter: [] };
  const track = r.track ?? [];
  const phases = pauses.filter(([a, b]) => b - a >= 2).map(([a]) => clock(a));
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
function preparePlay(r: SimResult): { video?: Bars } {
  if (play.of !== r) {
    cancelAnimationFrame(play.raf);
    Object.assign(play, { t: 0, running: false, of: r });
  }
  const entry = replay?.result === r && replay.at !== undefined ? runs.find((x) => x.at === replay!.at) : undefined;
  const reading = entry && videoOf(entry);
  const asked = entry ? (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy : settings().enemy;
  const enemy = typeof asked === 'object' ? asked : asked ? enemyById(asked).enemy : undefined;
  const pauses = reading?.pauses ?? [];
  const clock = (t: number) => t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0);
  let video: Bars | undefined;
  if (reading?.boss?.length) {
    video = { t: [], hp: [], meter: [] };
    for (const [t, hp, meter] of reading.boss)
      if (!pauses.some(([a, b]) => t >= a && t < b)) {
        video.t.push(clock(t));
        video.hp.push(hp);
        video.meter.push(meter);
      }
  }
  playBars = { sim: simBars(r, enemy, pauses, clock), video, seconds: r.seconds };
  queueMicrotask(paintPlay);
  return { video };
}

/** Play, scrub, time and speed. */
function playControls(r: SimResult): Html {
  return html`<div class="sim-play">
    <button type="button" class="btn secondary sm icon-only" data-action="sim-play" title="${play.running ? 'Pause' : 'Play'}" aria-label="${play.running ? 'Pause' : 'Play'}">${icon(play.running ? 'pause' : 'play_arrow')}</button>
    <input class="sim-play-seek" type="range" min="0" max="${r.seconds}" step="0.1" value="${play.t}" data-sim="play-seek" aria-label="Time" />
    <span class="num sim-play-time">${clockTime(play.t)}</span>
    <select class="input" data-sim="play-speed" aria-label="Speed">
      ${[1, 2, 4].map((s) => html`<option value="${s}" ${s === play.speed ? 'selected' : ''}>${s}×</option>`)}
    </select>
  </div>`;
}

/** The boss's HP and Stagger bars for one source, painted as the timeline plays. */
function bossRow(label: string, kind: 'sim' | 'video'): Html {
  return html`<div class="sim-boss"><div class="sim-boss-row" data-bars="${kind}">
    <span class="label-12 secondary">${label}</span>
    <span class="sim-boss-hp" title="HP"><i></i></span>
    <span class="sim-boss-meter" title="Stagger"><i></i></span>
  </div></div>`;
}

/** Under a lone timeline: the controls and the boss's bars. */
function player(r: SimResult): Html {
  preparePlay(r);
  return html`<div class="sim-player">${playControls(r)}${bossRow('Boss', 'sim')}</div>`;
}

/** Puts the playhead, the time and the bars where play.t is. */
function paintPlay(): void {
  const d = playBars;
  if (!d) return;
  const frac = Math.min(1, play.t / d.seconds);
  for (const el of document.querySelectorAll<HTMLElement>('.sim-playhead')) el.style.left = `calc(104px + (100% - 104px) * ${frac})`;
  for (const el of document.querySelectorAll<HTMLElement>('.sim-play-time')) el.textContent = clockTime(play.t);
  for (const el of document.querySelectorAll<HTMLInputElement>('.sim-play-seek')) if (document.activeElement !== el) el.value = String(play.t);
  for (const el of document.querySelectorAll<HTMLElement>('.sim-boss-row')) {
    const b = el.dataset.bars === 'video' ? d.video : d.sim;
    if (!b) continue;
    const { hp, meter } = barAt(b, play.t);
    const hpBar = el.querySelector<HTMLElement>('.sim-boss-hp i');
    const meterBar = el.querySelector<HTMLElement>('.sim-boss-meter i');
    if (hpBar) hpBar.style.width = `${(hp * 100).toFixed(1)}%`;
    if (meterBar) {
      meterBar.style.width = Number.isNaN(meter) ? '0%' : meter < 0 ? '100%' : `${(meter * 100).toFixed(1)}%`;
      meterBar.classList.toggle('staggered', meter < 0);
    }
  }
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
function steps(r: SimResult): { frame: number; slot: number; label: string; strike: boolean }[] {
  const out = [
    ...r.presses.map((p) => ({ frame: p.frame, slot: p.slot, label: INPUT_NAME[p.input], strike: false })),
    ...(r.strikes ?? []).map((s) => ({ frame: s.frame, slot: s.slot, label: s.finisher ? 'Finisher' : 'Final Strike', strike: true })),
    ...(r.staggers ?? []).map((s) => ({ frame: s.frame, slot: -1, label: 'Staggered', strike: true })),
    ...(r.mechanics ?? []).map((m) => ({ frame: m.frame, slot: -1, label: m.label, strike: true })),
    ...(r.away ?? []).map(([a]) => ({ frame: a, slot: -1, label: 'Invulnerable', strike: true })),
  ];
  return out.sort((a, b) => a.frame - b.frame);
}

/** What a saved run was asked for, in a line: style, search, goal, builds, and the order when it isn't today's. */
function runLine(entry: SavedSim<SimResult>, names: string[]): string {
  const req = JSON.parse(entry.key) as SimRequest & { video?: boolean };
  if (req.video) return ['Recording', `${req.seconds} s`, ...(entry.names.join('|') !== names.join('|') ? [entry.names.join(', ')] : [])].join(' · ');
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
  if (x.video) return x.video as VideoRotation;
  const req = JSON.parse(x.key) as SimRequest & { video?: boolean };
  return req.video && lastVideo && lastVideo.names.join('|') === x.names.join('|') && lastVideo.seconds === req.seconds ? lastVideo : undefined;
}

/** The open parsed run's presses to edit: time (seconds into the fight), operator, press; then played again. */
function transcriptEditor(x: SavedSim<SimResult>): Html {
  const reading = videoOf(x);
  if (!draft || draft.at !== x.at || !reading) return html``;
  const who = new Set(draft.steps.filter((s) => s.input === 'strike' || s.input === 'finisher').map((s) => s.slot));
  const main = who.size === 1 ? [...who][0] : null;
  return html`<div class="sim-transcript">
    <label class="sim-field"><span class="label-12 secondary">Controlled</span><select class="input sim-enemy" data-sim="step-main" aria-label="Controlled">
      ${main === null ? html`<option value="" selected>${who.size ? 'Mixed' : 'None'}</option>` : ''}
      ${reading.names.map((n, i) => html`<option value="${i}" ${i === main ? 'selected' : ''}>${n}</option>`)}
    </select></label>
    <ol class="sim-step-list">
      ${draft.steps.map(
        (s, k) => html`<li>
          <input class="input num" type="number" step="0.01" min="0" value="${s.t.toFixed(2)}" data-sim="step-t" data-k="${k}" aria-label="Time (s)" />
          <select class="input" data-sim="step-slot" data-k="${k}" aria-label="Operator">
            ${reading.names.map((n, i) => html`<option value="${i}" ${i === s.slot ? 'selected' : ''}>${n}</option>`)}
          </select>
          <select class="input" data-sim="step-input" data-k="${k}" aria-label="Action">
            ${Object.entries(STEP_NAME).map(([id, n]) => html`<option value="${id}" ${id === s.input ? 'selected' : ''}>${n}</option>`)}
          </select>
          <span class="sim-step-back">${s.input === 'battle' ? html`<input class="input num" type="number" min="0" max="300" value="${s.back ?? ''}" placeholder="SP" data-sim="step-back" data-k="${k}" title="SP back after it (blank: unknown)" aria-label="SP back" />` : ''}</span>
          <label class="sim-step-int label-12" title="It interrupted the boss's attack">${s.input === 'battle' || s.input === 'combo' || s.input === 'ultimate' ? html`<input type="checkbox" data-sim="step-int" data-k="${k}" ${s.interrupt ? 'checked' : ''} />Interrupt` : ''}</label>
          <button type="button" class="btn tertiary sm icon-only" data-action="sim-step-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
        </li>`,
      )}
    </ol>
    ${draft.away.length
      ? html`<span class="label-12 secondary">Invulnerable</span>
          <ol class="sim-step-list sim-away-list">
            ${draft.away.map(
              ([a, b], k) => html`<li>
                <input class="input num" type="number" step="0.01" min="0" value="${a.toFixed(2)}" data-sim="away-a" data-k="${k}" aria-label="From (s)" />
                <input class="input num" type="number" step="0.01" min="0" value="${b.toFixed(2)}" data-sim="away-b" data-k="${k}" aria-label="To (s)" />
                <button type="button" class="btn tertiary sm icon-only" data-action="sim-away-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
              </li>`,
            )}
          </ol>`
      : ''}
    <div class="sim-run">
      <button type="button" class="btn secondary sm" data-action="sim-step-add">${icon('add')}Add action</button>
      <button type="button" class="btn secondary sm" data-action="sim-away-add">${icon('add')}Add invulnerable</button>
      <button type="button" class="btn primary sm" data-action="sim-step-save" ${replayWorker ? 'disabled' : ''}>${icon('play_arrow')}Play edited transcript</button>
      <button type="button" class="btn tertiary sm" data-action="sim-step-cancel">Cancel</button>
    </div>
  </div>`;
}

/** A saved run's buttons: star (kept on top, never trimmed), edit (name and note), delete (asks once). */
function runTools(x: SavedSim<SimResult>): Html {
  const at = String(x.at);
  const ask = deleting === x.at;
  return html`<div class="sim-past-tools">
    <button type="button" class="btn tertiary sm icon-only${x.fav ? ' sim-fav' : ''}" data-action="sim-fav" data-value="${at}" title="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-label="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-pressed="${x.fav ? 'true' : 'false'}">${icon('star', !!x.fav)}</button>
    <button type="button" class="btn tertiary sm icon-only" data-action="sim-edit" data-value="${at}" title="Edit" aria-label="Edit name and note" aria-pressed="${editing === x.at ? 'true' : 'false'}">${icon('edit')}</button>
    <button type="button" class="btn ${ask ? 'error' : 'tertiary icon-only'} sm" data-action="sim-delete" data-value="${at}" title="Delete" aria-label="${ask ? 'Confirm delete' : 'Delete'}">${ask ? 'Delete' : icon('delete')}</button>
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
  if (!list.length) return html``;
  return html`<section class="card"><div class="card-body sim-card">
    <h2 class="heading-16">${recordings ? 'Parsed runs' : 'History'}</h2>
    <div class="sim-history">
      ${list.map((x) => {
        const r = x.result;
        const value = r.hp ? (r.killed ? clockTime(r.seconds) : 'Not defeated') : `${big(r.total / r.seconds)} DPS`;
        return html`<div class="sim-past-row${x.at === showing ? ' on' : ''}">
          <button type="button" class="sim-past" data-action="sim-past" data-value="${String(x.at)}">
            <span class="num secondary">${when(x.at)}</span>
            <span class="min0 ellipsis">${x.name ? html`<span class="label-14">${x.name}</span> <span class="secondary">${runLine(x, names)}</span>` : runLine(x, names)}</span>
            <span class="num">${value}</span>
          </button>
          ${recordings ? (x.note ? html`<p class="copy-13 secondary sim-note-text">${x.note}</p>` : '') : html`${runTools(x)} ${runEdit(x)}`}
        </div>`;
      })}
    </div>
  </div></section>`;
}

function resultsView(r: SimResult, names: string[], ids: string[], stale: boolean, extra: { before?: Html; underTimeline?: Html; dpsMax?: number } = {}): Html {
  const dps = r.total / r.seconds;
  const time = clockTime(r.seconds);
  const shares = ids.map((id, slot) => ({ id, slot, total: r.byOperator[id] ?? 0 })).sort((a, b) => b.total - a.total);
  return html`<div class="sim-results${stale ? ' stale' : ''}">
    ${metrics([
      ...(r.hp ? [metric({ label: 'Clear time', value: r.killed ? time : 'Not defeated', sub: r.killed ? `${big(r.hp)} HP` : `${big(r.total)} of ${big(r.hp)} HP in ${time}` })] : []),
      metric({ label: 'Damage per second', value: big(dps) }),
      metric({ label: 'Total damage', value: big(r.total), sub: `${time} duration` }),
      metric({ label: 'Actions', value: String(r.presses.length), sub: 'besides basic attacks' }),
      ...(names[r.main] ? [metric({ label: 'Controlled', value: names[r.main], sub: new Set((r.strikes ?? []).map((x) => x.slot)).size > 1 ? 'at the start, swaps after' : 'the whole fight' })] : []),
    ])}
    <section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Damage by operator</h2>
      ${shares.map(
        (s) => html`<div class="sim-share">
          ${itemImg('char', s.id, 'sim-portrait sm')}
          <span class="min0 ellipsis">${names[s.slot]}</span>
          <span class="sim-bar"><i style="width:${r.total ? (s.total / r.total) * 100 : 0}%"></i></span>
          <span class="num">${pct(r.total ? s.total / r.total : 0)}</span>
        </div>`,
      )}
    </div></section>
    ${extra.before ?? ''}
    <section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">${extra.before ? 'Timeline · Sim' : 'Timeline'}</h2>
      ${r.order
        ? html`<p class="copy-14">Control ${names[r.main]}. Combo skills as they come up, ultimates when charged, and these battle skills in turn, over and over:</p>
            <ol class="sim-order copy-14">${r.order.map(([slot, input]) => html`<li>${names[slot]} · ${INPUT_NAME[input]}</li>`)}</ol>`
        : ''}
      ${extra.before ? html`${lanes(simTrack(r), names, extra.dpsMax ?? Math.max(...simTrack(r).dps, 0))}${bossRow('Sim', 'sim')}` : timeline(r, names)}
      ${extra.underTimeline ?? ''}
      <ol class="sim-steps copy-14">
        ${steps(r).map((p) => html`<li class="${p.strike ? 'secondary' : ''}"><span class="num secondary">${secs(p.frame)}</span> ${p.slot < 0 ? 'Enemy' : names[p.slot]} · ${p.label}</li>`)}
      </ol>
    </div></section>
    <section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Where the damage comes from</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Operator</th><th>Source</th><th class="num">Hits</th><th class="num">Damage</th><th class="num">Share</th></tr></thead>
        <tbody>${r.sources.slice(0, 24).map((s) => html`<tr><td>${names[ids.indexOf(s.op)] ?? s.op}</td><td>${s.source}</td><td class="num">${s.hits}</td><td class="num">${big(s.total)}</td><td class="num">${pct(s.total / r.total)}</td></tr>`)}</tbody>
      </table></div>
    </div></section>
    ${r.unknown.length
      ? html`<p class="copy-13 secondary">Not simulated yet: ${r.unknown
          .slice(0, 8)
          .map(([t]) => t)
          .join(', ')}${r.unknown.length > 8 ? ` and ${r.unknown.length - 8} more` : ''}.</p>`
      : ''}
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
  const s = settings();
  const team = teamOf(s);
  const mode = s.builds ?? 'mine';
  const optimal = mode === 'optimal';
  const built = team.map((m) => buildOf(m, wiki, index.data!));
  const names = team.map((m) => wiki.ops[m.op]?.name ?? m.op);
  allNames = [...new Set(Object.values(wiki.ops).map((o) => o.name))].sort();
  redrawPage = redraw;
  loadSaved(redraw);
  const tabs = (current: string, body: Html) =>
    html`${header}<main class="container fade-in">${sideTabs('Rotations', [['/rotations', 'Simulator', ''], ['/rotations/parser', 'Parser', '']], current, html`<div class="sim-page">${body}</div>`)}</main>`;
  if (view === 'parser') return tabs('/rotations/parser', parseView(wiki, index.data, s, redraw));
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
  const v = video ?? lastVideo;
  const idOf = new Map(pickable(wiki, index, []).map((id) => [wiki.ops[id].name, id]));
  // The boss bar's name.
  const seen = v?.enemy;
  const foe = enemySeen(seen);
  const ops = v ? v.names.map((n) => idOf.get(n)) : [];
  const builds = ops.map((op) => (op ? buildOf({ op, ...(s.videoFood?.[op] ? { food: s.videoFood[op] } : {}) }, wiki, index) : null));
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
  const fact = (label: string, value: string) => html`<div class="sim-field"><span class="label-12 secondary">${label}</span><span class="copy-14">${value}</span></div>`;
  return html`${runHead()}<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Recording</h2>
      ${v
        ? html`<div class="sim-options">
              ${fact('Enemy', foe?.name ?? (seen ? `${seen} (not in the sim yet: fought as the training dummy)` : 'Not read from the video: fought as the training dummy'))}
              ${fact('Duration', clockTime(v.seconds))}
              ${fact('Actions', String(v.steps.filter((x) => x.input !== 'strike' && x.input !== 'finisher').length))}
            </div>
            <div class="sim-team">
              ${v.names.map((name, i) => {
                const op = ops[i];
                const b = builds[i]?.build;
                return html`<div class="sim-member">
                  <div class="sim-op">${op ? html`<a class="sim-op-link" href="${infoHref('char', op)}" title="${name}’s page" aria-label="${name}’s page">${itemImg('char', op, 'sim-portrait')}</a>` : ''}<span class="label-14 ellipsis">${name}</span>${b ? html`<span class="label-12 secondary">P${b.potential}</span>` : ''}</div>
                  ${op
                    ? html`<label class="label-12 secondary">Food <select class="input sim-food" data-sim="vfood" data-op="${op}" aria-label="Food">
                        <option value="" ${s.videoFood?.[op] ? '' : 'selected'}>None</option>
                        ${Object.entries(FOODS).map(([id, f]) => html`<option value="${id}" ${id === s.videoFood?.[op] ? 'selected' : ''}>${f.name}</option>`)}
                      </select></label>`
                    : ''}
                  <div class="sim-gear copy-13">${b ? buildLines(b, wiki) : ''}</div>
                </div>`;
              })}
            </div>`
        : html`<p class="copy-14 secondary">Parse a gameplay recording to see its rotation, timeline and damage.</p>`}
      <div class="sim-run">
        <button type="button" class="btn ${v ? 'secondary' : 'primary'}" data-action="sim-read">${icon('movie')}Parse gameplay recording</button>
        <button type="button" class="btn secondary" data-action="sim-import">${icon('upload_file')}Import run</button>
        ${lastVideo && !replayWorker ? html`<button type="button" class="btn secondary" data-action="sim-video-again">${icon('replay')}Play again</button>` : ''}
      </div>
    </div></section>
    ${replay ? replayView(replay) : ''}
    ${historyView([], replay?.at, true)}
    ${CREDIT}`;
}
