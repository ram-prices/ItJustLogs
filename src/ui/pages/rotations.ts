import { GEAR_SLOTS, artificeOf, type Loadout } from '../../domain/loadout';
import { FPS } from '../../domain/sim/engine';
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
let draft: { at: number; steps: VideoStep[] } | null = null;
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
  const steps: ReplayStep[] = v.steps.map((x) => ({ t: x.t, slot: at[x.slot], input: x.input }));
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
  w.postMessage({ id, req, replay: steps, stopwatch: { end: v.end ?? v.seconds, pauses: v.pauses ?? [] } });
}

/** The video's rotation as the sim played it: the usual results, and the presses it couldn't make. */
function replayView(r: NonNullable<typeof replay>): Html {
  const missed = r.result?.missed ?? [];
  const entry = r.at === undefined ? undefined : runs.find((x) => x.at === r.at);
  return html`<section class="sim-video">
    ${entry
      ? html`<div class="sim-past-row sim-run-head">
          <div class="sim-past min0"><span class="num secondary">${when(entry.at)}</span><span class="label-14 ellipsis">${entry.name ?? runLine(entry, entry.names)}</span><span></span></div>
          <div class="row">
            ${videoOf(entry) ? html`<button type="button" class="btn secondary sm" data-action="sim-transcript" data-value="${String(entry.at)}" aria-pressed="${draft?.at === entry.at ? 'true' : 'false'}">${icon('description')}Edit transcript</button>` : ''}
            ${runTools(entry)}
          </div>
          ${runEdit(entry)}
        </div>
        ${transcriptEditor(entry)}`
      : ''}
    ${r.error
      ? html`<p class="copy-14 sim-error">${r.error}</p>`
      : !r.result
        ? html`<p class="copy-14 secondary">${icon('hourglass_empty')} Playing the recording’s presses…</p>`
        : html`${resultsView(r.result, r.names, r.ids, false)}
            ${missed.length ? html`<p class="copy-13 secondary">The sim couldn’t make ${missed.length === 1 ? 'this press' : `these ${missed.length} presses`}: ${missed.map((m) => `${secs(m.t * FPS)} ${r.names[m.slot]} · ${m.input === 'strike' ? 'Final Strike' : INPUT_NAME[m.input]}`).join(', ')}.</p>` : ''}`}
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
    case 'sim-transcript': {
      const entry = runs.find((x) => String(x.at) === v);
      const reading = entry && videoOf(entry);
      draft = draft?.at === entry?.at || !entry || !reading ? null : { at: entry.at, steps: reading.steps.map((x) => ({ ...x })) };
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
    case 'sim-step-cancel':
      draft = null;
      return true;
    case 'sim-step-save': {
      const entry = draft && runs.find((x) => x.at === draft!.at);
      const reading = entry && videoOf(entry);
      if (entry && reading && draft) {
        const { video: _, ...req } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
        const edited = { ...reading, steps: draft.steps.slice().sort((a, b) => a.t - b.t) };
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
  else if (f === 'step-t' || f === 'step-slot' || f === 'step-input') {
    const step = draft?.steps[Number(el.dataset.k)];
    if (step && f === 'step-t') step.t = Math.max(0, Number(el.value) || 0);
    else if (step && f === 'step-slot') step.slot = Number(el.value) as VideoStep['slot'];
    else if (step) step.input = el.value as VideoStep['input'];
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

/** Weapons only Arsenal Issues give: their rate-ups (weponbox_ pools; weaponbox_constant_ is the standard pool). */
const limitedWeapons = (): string[] =>
  [...new Set(Object.entries(cachedBannerDb()).flatMap(([pool, b]) => (pool.startsWith('weponbox_') ? (b.rateUpIds ?? []).filter((id) => id.startsWith('wpn_')) : [])))].sort();

/** How the page finds a rotation, for the curious. */
const HOW: [string, string][] = [
  ['Fight', 'The training dummy (DEF 100, a 280 Stagger meter, Staggered 12 s), frame by frame at 30 fps. Each operator runs the game’s own skill, buff and talent files: every hit, buff, Arts Infliction, reaction, Physical Status, cooldown, SP and Ultimate Energy gain as the game defines them. Only the controlled operator basic attacks; the others stand by, as they mostly do in the game.'],
  ['Damage', 'ATK × multiplier × DMG bonus × critical hits (their expected value) × Amp × Susceptibility × DMG taken × DEF × Resistance × Stagger, as endfield.wiki.gg’s Damage page lays it out.'],
  ['Search', 'Step 1 finds a priority list: a ranking of buttons, where the first one that’s ready gets pressed. Many rankings are tried, and the best ones are improved by swapping pairs. Step 2 goes through the fight press by press: each time a skill could be pressed, it tries every option (each ready skill, or waiting a moment), plays out the rest of the fight for each, and keeps the few that did best.'],
  ['Styles', 'Advanced: anything the game allows, swaps and animation cancels too. Standard: one operator controlled the whole fight, no animation cancels, at least half a second between presses. Basic: one operator controlled; combos as they come up, ultimates when charged, and the battle skills in one order, over and over.'],
  ['Goal', 'Fight length: the most damage in that time. Dummy HP: the fight ends when it’s defeated, and the fastest wins.'],
  ['Optimal gear', 'Each weapon is tried in a fight (Maxed Essence; a gacha-only weapon goes to one operator at most). Then it measures how much each stat adds for this team, and tries gear sets and pieces at their top Artifice.'],
  ['Uptime', 'How much of the fight the enemy can be hit. The rest comes at the end of every 10 s: nothing is pressed and basic attacks stop, while what’s already running goes on.'],
  ['Threads', 'Fights that don’t depend on each other are played side by side on several threads of this device; the rotation found is the same as on one.'],
  ['Not simulated', 'Enemy attacks, positions and distances (counters, shields, attacks landing on random spots), and inputs timed by the player (perfect timing).'],
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const big = (n: number) => Math.round(n).toLocaleString();
const secs = (frame: number) => `${(frame / FPS).toFixed(1)} s`;

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
function timeline(r: SimResult, names: string[]): Html {
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
  return html`<div class="sim-timeline" role="img" aria-label="Presses over the fight">
    ${names.map(
      (name, slot) => html`<div class="sim-lane">
        <span class="sim-lane-name label-12 ellipsis">${name}</span>
        <span class="sim-lane-track">
          ${spans.filter((s) => s.slot === slot).map((s) => html`<i class="sim-control" style="left:${at(s.from)};width:${at(s.to - s.from)}"></i>`)}
          ${r.presses
            .filter((p) => p.slot === slot && p.input !== 'swap')
            .map((p) => html`<i class="sim-press ${p.input}" style="left:${at(p.frame)}" title="${secs(p.frame)} · ${INPUT_NAME[p.input]}">${p.input === 'battle' ? 'B' : p.input === 'combo' ? 'C' : 'U'}</i>`)}
          ${(r.strikes ?? [])
            .filter((s) => s.slot === slot)
            .map((s) => html`<i class="sim-strike${s.finisher ? ' finisher' : ''}" style="left:${at(s.frame)}" title="${secs(s.frame)} · ${s.finisher ? 'Finisher' : 'Final Strike'}"></i>`)}
        </span>
      </div>`,
    )}
    ${r.staggers?.length
      ? html`<div class="sim-lane">
          <span class="sim-lane-name label-12 ellipsis">Enemy</span>
          <span class="sim-lane-track">${r.staggers.map((s) => html`<i class="sim-stagger" style="left:${at(s.frame)};width:${at(s.end - s.frame)}" title="${secs(s.frame)} · Staggered ${((s.end - s.frame) / FPS).toFixed(1)} s"></i>`)}</span>
        </div>`
      : ''}
    <div class="sim-lane sim-axis"><span></span><span class="sim-lane-track">${ticks.map((t) => html`<span class="label-12 secondary" style="left:${at(t * FPS)}">${t}s</span>`)}</span></div>
  </div>`;
}

/** The presses, with the controlled operator's Final Strikes and Finishers between them (how long to keep attacking). */
function steps(r: SimResult): { frame: number; slot: number; label: string; strike: boolean }[] {
  const out = [
    ...r.presses.map((p) => ({ frame: p.frame, slot: p.slot, label: INPUT_NAME[p.input], strike: false })),
    ...(r.strikes ?? []).map((s) => ({ frame: s.frame, slot: s.slot, label: s.finisher ? 'Finisher' : 'Final Strike', strike: true })),
    ...(r.staggers ?? []).map((s) => ({ frame: s.frame, slot: -1, label: 'Staggered', strike: true })),
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

const STEP_NAME: Record<VideoStep['input'], string> = { battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', strike: 'Final Strike', finisher: 'Finisher' };

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
          <select class="input" data-sim="step-input" data-k="${k}" aria-label="Press">
            ${Object.entries(STEP_NAME).map(([id, n]) => html`<option value="${id}" ${id === s.input ? 'selected' : ''}>${n}</option>`)}
          </select>
          <button type="button" class="btn tertiary sm icon-only" data-action="sim-step-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
        </li>`,
      )}
    </ol>
    <div class="sim-run">
      <button type="button" class="btn secondary sm" data-action="sim-step-add">${icon('add')}Add press</button>
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
        const value = r.hp ? (r.killed ? `${r.seconds.toFixed(1)} s` : 'Not defeated') : `${big(r.total / r.seconds)} DPS`;
        return html`<div class="sim-past-row${x.at === showing ? ' on' : ''}">
          <button type="button" class="sim-past" data-action="sim-past" data-value="${String(x.at)}">
            <span class="num secondary">${when(x.at)}</span>
            <span class="min0 ellipsis">${x.name ? html`<span class="label-14">${x.name}</span> <span class="secondary">${runLine(x, names)}</span>` : runLine(x, names)}</span>
            <span class="num">${value}</span>
          </button>
          ${runTools(x)} ${runEdit(x)}
        </div>`;
      })}
    </div>
  </div></section>`;
}

function resultsView(r: SimResult, names: string[], ids: string[], stale: boolean): Html {
  const dps = r.total / r.seconds;
  const time = `${r.seconds.toFixed(1)} s`;
  const shares = ids.map((id, slot) => ({ id, slot, total: r.byOperator[id] ?? 0 })).sort((a, b) => b.total - a.total);
  return html`<div class="sim-results${stale ? ' stale' : ''}">
    ${metrics([
      ...(r.hp ? [metric({ label: 'Clear time', value: r.killed ? time : 'Not defeated', sub: r.killed ? `${big(r.hp)} HP` : `${big(r.total)} of ${big(r.hp)} HP in ${time}` })] : []),
      metric({ label: 'Damage per second', value: big(dps) }),
      metric({ label: 'Total damage', value: big(r.total), sub: `${time} duration` }),
      metric({ label: 'Presses', value: String(r.presses.length), sub: 'besides basic attacks' }),
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
    <section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Timeline</h2>
      ${r.order
        ? html`<p class="copy-14">Control ${names[r.main]}. Combo skills as they come up, ultimates when charged, and these battle skills in turn, over and over:</p>
            <ol class="sim-order copy-14">${r.order.map(([slot, input]) => html`<li>${names[slot]} · ${INPUT_NAME[input]}</li>`)}</ol>`
        : ''}
      ${timeline(r, names)}
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
  const style = styleOf(s.style);
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
        optimize: { weapons: team.map((m) => (m.weapon ? [m.weapon] : weaponsFor(m.op, wiki, index.data!))), limited: limitedWeapons() },
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
            <option value="" ${at < 0 ? 'selected' : ''}>Best (sim picks)</option>
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
                      ? `${progress.killedIn !== undefined ? `Fastest so far ${progress.killedIn.toFixed(1)} s` : `Best so far ${big(progress.dps)} DPS`} · ${Math.min(100, Math.round((progress.played / progress.budget) * 100))}%${(running.cores ?? 1) > 1 ? ` · ${running.cores} threads` : ''}`
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
  return html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Recording</h2>
      ${v
        ? html`<div class="sim-options">
              ${fact('Enemy', foe?.name ?? (seen ? `${seen} (not in the sim yet: fought as the training dummy)` : 'Not read from the video: fought as the training dummy'))}
              ${fact('Duration', `${v.seconds.toFixed(1)} s`)}
              ${fact('Presses', String(v.steps.filter((x) => x.input !== 'strike' && x.input !== 'finisher').length))}
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
        ${lastVideo && !replayWorker ? html`<button type="button" class="btn secondary" data-action="sim-video-again">${icon('replay')}Play again</button>` : ''}
      </div>
    </div></section>
    ${replay ? replayView(replay) : ''}
    ${historyView([], replay?.at, true)}
    ${CREDIT}`;
}
