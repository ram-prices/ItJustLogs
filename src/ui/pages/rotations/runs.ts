import { enemySeen, type ReplayResult, type ReplayStep, type SimProgress, type SimRequest, type SimResult, styleOf, STYLES } from '../../../domain/sim/team';
import { listSims, loadReaderDraft, loadSimVideo, type SavedSim, saveSim, updateSim } from '../../../store';
import { icon } from '../../components';
import { toast } from '../../common';
import { html, type Html } from '../../html';
import type { VideoRotation } from '../../rotationReader';
import { endsAtZero } from '../../../domain/rotationReader';
import { EFFORTS, page, teamKey } from './state';
import { big, clockTime, when } from './text';
import { phaseChanges } from './track';

export function loadSaved(redraw: () => void): void {
  if (page.saved || page.savedLoading) return;
  page.savedLoading = true;
  void Promise.all([listSims<SimResult>(), loadSimVideo<VideoRotation>(), loadReaderDraft<unknown>()]).then(([list, v, d]) => {
    page.runs = list;
    page.saved = new Map(list.map((x) => [x.key, x]));
    page.lastVideo ??= v ?? null;
    page.hasDraft ||= !!d;
    redraw();
  });
}

// Drive sync brought parsed runs from another device (or deleted some there): the lists and the open run follow.
addEventListener('ijl:runs', () => {
  if (!page.saved) return;
  void listSims<SimResult>().then((list) => {
    page.runs = list;
    page.saved = new Map(list.map((x) => [x.key, x]));
    if (page.replay?.at !== undefined && !page.replayWorker && page.draft?.at !== page.replay.at) {
      const open = list.find((x) => x.at === page.replay!.at);
      page.replay = open ? { names: open.names, ids: open.ids, result: open.result as ReplayResult, at: open.at } : null;
    }
    page.redrawPage?.();
  });
});

/**
 * Plays a video's presses in the sim (the worker's replay), the team as the page has it. A new parsed run, or with
 * `into` that saved run again (its transcript edited), keeping its star, name and note.
 */
export function runReplay(v: VideoRotation, at: number[], req: SimRequest, names: string[], ids: string[], redraw: () => void, into?: SavedSim<SimResult>): void {
  page.replayWorker?.terminate();
  // Replaying into the open run keeps its last result on screen until the new one replaces it.
  const shown = into && page.replay?.at === into.at && page.replay.result ? page.replay.result : (into?.result as ReplayResult | undefined);
  page.replay = { names, ids, at: into?.at, ...(shown ? { result: shown } : {}) };
  const steps: ReplayStep[] = v.steps.map((x) => ({ t: x.t, slot: at[x.slot], input: x.input, ...(x.interrupt ? { interrupt: true } : {}), ...(x.back !== undefined ? { back: x.back } : {}) }));
  const w = new Worker(new URL('../../simWorker.ts', import.meta.url), { type: 'module' });
  page.replayWorker = w;
  const id = ++page.seq;
  w.onmessage = (e: MessageEvent<{ id: number; result?: ReplayResult; error?: string }>) => {
    if (e.data.id !== id || page.replayWorker !== w) return;
    if (e.data.result || e.data.error) {
      const at = into?.at ?? Date.now();
      page.replay = { names, ids, result: e.data.result, error: e.data.error, at };
      // Kept in the history too, marked as a recording, with its reading.
      const key = JSON.stringify({ ...req, video: true });
      if (e.data.result && into) {
        Object.assign(into, { key, result: e.data.result, video: v });
        void updateSim(at, { key, result: e.data.result, video: v });
      } else if (e.data.result) {
        const entry = { key, result: e.data.result, names, ids, at, video: v };
        page.runs.push(entry);
        void saveSim(entry);
      }
      w.terminate();
      page.replayWorker = null;
      redraw();
    }
  };
  // Readings saved before the stopwatch was read have no end: the fight's length stands in.
  w.postMessage({ id, req, replay: steps, stopwatch: { end: v.end ?? v.seconds, pauses: v.pauses ?? [], away: v.away ?? [], guard: v.guard ?? [], ...(v.boss ? { phases: phaseChanges(v.boss, v.pauses ?? []) } : {}) } });
}

/** Plays the edited transcript into its run; `close` also leaves the editor (the checkmark), else it stays (refresh). */
export function playDraft(close: boolean): void {
  const entry = page.draft && page.runs.find((x) => x.at === page.draft!.at);
  const reading = entry && videoOf(entry);
  if (!entry || !reading || !page.draft) return;
  const { video: _, ...asked } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
  const away = page.draft.away.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  // The fight's length as edited: the stopwatch's stop moves with it (the boss dies then).
  const longer = page.draft.seconds - reading.seconds;
  const req = { ...asked, seconds: page.draft.seconds, builds: page.draft.builds };
  const edited = { ...reading, steps: page.draft.steps.slice().sort((a, b) => a.t - b.t), away, seconds: page.draft.seconds, end: (reading.end ?? reading.seconds) + longer };
  if (close) page.draft = null;
  runReplay(edited, edited.names.map((_, i) => i), req, entry.names, entry.ids, page.redrawPage, entry);
}

/** A parsed run as a file to share or open elsewhere (Import run): its reading, the request (team, loadouts, enemy), result, name and note. */
const RUN_FILE = 'itjustlogs-parsed-run';

export function exportRun(x: SavedSim<SimResult>): void {
  const file = { kind: RUN_FILE, version: 1, at: x.at, name: x.name, note: x.note, names: x.names, ids: x.ids, request: JSON.parse(x.key), result: x.result, video: videoOf(x) };
  const title = (x.name ?? `${x.names.join('-')}-${new Date(x.at).toISOString().slice(0, 10)}`).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `parsed-run-${title || 'run'}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens an exported parsed run's text: it joins Parsed runs (as new, so it never replaces one) and opens. False if it isn't one. */
export function openRun(text: string): boolean {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return false;
  }
  if (d?.kind !== RUN_FILE || !d.result || !Array.isArray(d.names) || !d.request) return false;
  const entry: SavedSim<SimResult> = { key: JSON.stringify({ ...d.request, video: true }), result: d.result, names: d.names, ids: d.ids ?? [], at: Date.now(), ...(d.name ? { name: d.name } : {}), ...(d.note ? { note: d.note } : {}), ...(d.video ? { video: d.video } : {}) };
  page.runs.push(entry);
  void saveSim(entry);
  page.replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
  page.redrawPage();
  return true;
}

/** Import run: picks an exported parsed run's file and opens it. */
export function importRun(): void {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f && !openRun(await f.text())) toast('That file isn’t an exported parsed run.', 'error');
  };
  input.click();
}

export function stop(): void {
  page.worker?.terminate();
  page.worker = null;
  page.running = null;
}

export function run(req: SimRequest, key: string, names: string[], cores: number, redraw: () => void): void {
  stop();
  page.failed = '';
  page.picked = false;
  page.worker = new Worker(new URL('../../simWorker.ts', import.meta.url), { type: 'module' });
  const id = ++page.seq;
  page.running = { key, progress: null, loading: true };
  page.worker.onmessage = (e: MessageEvent<{ id: number; loaded?: boolean; cores?: number; progress?: SimProgress; result?: SimResult; error?: string }>) => {
    if (e.data.id !== id || !page.running) return;
    if (e.data.loaded) page.running.loading = false;
    if (e.data.cores) page.running.cores = e.data.cores;
    if (e.data.progress) page.running.progress = e.data.progress;
    if (e.data.result) {
      const entry = { key, result: e.data.result, names, ids: req.builds.map((b) => b.op), at: Date.now() };
      page.result = entry;
      page.saved?.set(key, entry);
      page.runs.push(entry);
      void saveSim(entry);
      stop();
    }
    if (e.data.error) {
      page.failed = e.data.error;
      stop();
    }
    redraw();
  };
  page.worker.postMessage({ id, req, cores });
}

/** What a saved run was asked for, in a line: style, search, goal, builds, and the order when it isn't today's. */
export function runLine(entry: SavedSim<SimResult>, names: string[]): string {
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
export const isRecording = (x: SavedSim<SimResult>) => !!(JSON.parse(x.key) as { video?: boolean }).video;

/**
 * A parsed run's reading: its own, or for runs saved before readings were kept, the last reading when it's the same
 * team and length.
 */
export function videoOf(x: SavedSim<SimResult>): VideoRotation | undefined {
  if (x.video) return killed(x.video as VideoRotation);
  const req = JSON.parse(x.key) as SimRequest & { video?: boolean };
  return req.video && page.lastVideo && page.lastVideo.names.join('|') === x.names.join('|') && page.lastVideo.seconds === req.seconds ? killed(page.lastVideo) : undefined;
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

/** A parsed run's header buttons after Edit and Export, boxed icons like them: Star (kept on top, never trimmed or deleted), Delete (asks once, red). */
export function headTools(x: SavedSim<SimResult>): Html {
  const at = String(x.at);
  const ask = page.deleting === x.at;
  return html`<button type="button" class="btn secondary sm icon-only${x.fav ? ' sim-fav' : ''}" data-action="sim-fav" data-value="${at}" title="${x.fav ? 'Starred' : 'Star'}" aria-label="${x.fav ? 'Starred' : 'Star'}" aria-pressed="${x.fav ? 'true' : 'false'}">${icon('star', !!x.fav)}</button>
    ${x.fav
      ? html`<button type="button" class="btn secondary sm icon-only" disabled title="Starred: unstar it to delete" aria-label="Starred: unstar it to delete">${icon('delete')}</button>`
      : html`<button type="button" class="btn ${ask ? 'error' : 'secondary'} sm icon-only" data-action="sim-delete" data-value="${at}" title="${ask ? 'Click again to delete' : 'Delete'}" aria-label="${ask ? 'Confirm delete' : 'Delete'}">${icon('delete')}</button>`}`;
}

/** A saved run's buttons: star (kept on top, never trimmed), edit (name and note), delete (asks once). */
function runTools(x: SavedSim<SimResult>, editsElsewhere = false): Html {
  const at = String(x.at);
  const ask = page.deleting === x.at;
  // A parsed run's name and note are edited with its transcript (Edit), not here.
  return html`<div class="sim-past-tools">
    <button type="button" class="btn tertiary sm icon-only${x.fav ? ' sim-fav' : ''}" data-action="sim-fav" data-value="${at}" title="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-label="${x.fav ? 'Unfavorite' : 'Favorite'}" aria-pressed="${x.fav ? 'true' : 'false'}">${icon('star', !!x.fav)}</button>
    ${editsElsewhere ? '' : html`<button type="button" class="btn tertiary sm icon-only" data-action="sim-edit" data-value="${at}" title="Edit" aria-label="Edit name and note" aria-pressed="${page.editing === x.at ? 'true' : 'false'}">${icon('edit')}</button>`}

    ${x.fav
      ? html`<button type="button" class="btn tertiary sm icon-only" disabled title="Starred: unstar it to delete" aria-label="Starred: unstar it to delete">${icon('delete')}</button>`
      : html`<button type="button" class="btn ${ask ? 'error' : 'tertiary icon-only'} sm" data-action="sim-delete" data-value="${at}" title="Delete" aria-label="${ask ? 'Confirm delete' : 'Delete'}">${ask ? 'Delete' : icon('delete')}</button>`}
  </div>`;
}

/** A saved run's name and note fields while it's being edited, else its note. */
function runEdit(x: SavedSim<SimResult>): Html {
  const at = String(x.at);
  if (page.editing === x.at)
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
export function historyView(names: string[], showing: number | undefined, recordings = false): Html {
  const team = teamKey(names);
  const list = page.runs.filter((x) => (recordings ? isRecording(x) : !isRecording(x) && teamKey(x.names) === team)).reverse();
  list.sort((a, b) => Number(!!b.fav) - Number(!!a.fav));
  if (!list.length && !recordings) return html``;
  const buttons = (sm: boolean) => html`<button type="button" class="btn ${list.length ? 'secondary' : 'primary'}${sm ? ' sm' : ''}" data-action="sim-read">${icon('movie')}Parse gameplay</button>
    <button type="button" class="btn secondary${sm ? ' sm' : ''}" data-action="sim-import">${icon('upload_file')}Import run</button>`;
  // Parsed runs fold to their title row (with the parse and import buttons) while a run is open.
  const shown = !recordings || !list.length || (page.runsShown ?? showing === undefined);
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

/** Parse a recording, or import a run file. */
export const parseButtons = (sm: boolean): Html =>
  html`<button type="button" class="btn primary${sm ? ' sm' : ''}" data-action="sim-read">${icon('movie')}Parse gameplay</button>
    <button type="button" class="btn secondary${sm ? ' sm' : ''}" data-action="sim-import">${icon('upload_file')}Import run</button>`;

/**
 * Parsed runs in the Parser's side column, under its tabs: a read waiting for picks first, then favorites, then
 * newest; each its name (or boss), date and DPS, the open one marked.
 */
export function runsAside(showing: number | undefined): Html {
  const list = page.runs.filter(isRecording).reverse();
  list.sort((a, b) => Number(!!b.fav) - Number(!!a.fav));
  return html`<section class="sim-runs-side" aria-label="Parsed runs">
    <h2 class="label-12 secondary">Parsed runs</h2>
    ${page.hasDraft
      ? html`<button type="button" class="sim-side-run draft" data-action="sim-draft" aria-pressed="${page.draftOpen ? 'true' : 'false'}">
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
      return html`<button type="button" class="sim-side-run" data-action="sim-past" data-value="${String(x.at)}" aria-pressed="${x.at === showing && !page.draftOpen ? 'true' : 'false'}">
        <span class="label-14 ellipsis">${x.fav ? icon('star', true) : ''}${title}</span>
        <span class="label-12 secondary ellipsis">${when(x.at)} · ${value}</span>
      </button>`;
    })}
    <div class="sim-side-buttons">${parseButtons(true)}</div>
  </section>`;
}
