import { BUILD_MODES, type BuildMode, DEFAULT_HP, DEFAULT_LIMIT, DEFAULT_SECONDS, type Effort, ENEMIES, enemyById, type Goal, GOALS, type ReplayResult, type SimRequest, spGained, START_SP, type Style, styleOf, STYLES } from '../../domain/sim/team';
import { artificeTops } from '../../domain/loadout';
import { statArtifice } from '../../domain/sim/build';
import type { WikiGearFile, WikiOperatorFile, WikiWeaponFile } from '../../domain/wiki';
import { deleteSim, updateSim } from '../../store';
import { icon, pageHeader, toggleGroup } from '../components';
import { html, type Html } from '../html';
import { sideTabs, wikiFile } from './info';
import { AUTO_CORES, type CombatIndex, CORES, EFFORTS, page, save, saveZoom, settings, teamKey, teamOf, TL_ZOOMS, type VideoStep, type Wiki } from './rotations/state';
import { big, clockTime } from './rotations/text';
import { loadBuffIcons } from './rotations/buffs';
import { paintPlay, runPlay, showPlayhead } from './rotations/player';
import { CREDIT, resultsView } from './rotations/results';
import { buildOf, editBuild, gearLine, limitedWeapons, memberCard, optimalBuildOf, signatureWeapons, weaponsFor } from './rotations/builds';
import { exportRun, historyView, importRun, isRecording, loadSaved, openRun, playDraft, run, runReplay, runsAside, stop, videoOf } from './rotations/runs';
import { onDraft, parseView, simulated, videoTimeOf } from './rotations/parser';

/**
 * Rotations (/rotations): pick four operators in team position order and a
 * style, and the page finds the button order that deals the most damage to
 * the training dummy in a fight's length, or defeats a dummy with the HP
 * given fastest, by playing thousands of fights with the game's own
 * skill and buff logic (domain/sim, in a worker: ui/simWorker.ts). Builds come
 * from each operator's loadout and the player's copies.
 */

const STYLE_NOTE: Record<Style, string> = {
  advanced: 'Swaps, animation cancels, any timing.',
  standard: 'One operator controlled, no animation cancels, any mix of skills.',
  basic: 'One operator controlled; combos as they come up, ultimates when charged, battle skills in one order.',
};

/**
 * Files or text pasted or dropped on the Parser: a recording is parsed (as Parse gameplay), an exported run
 * opened (as Import run). False if it's neither, for the site's own import to try.
 */
export async function parserFiles(files: File[], text = ''): Promise<boolean> {
  const video = files.find((f) => f.type.startsWith('video/'));
  if (video) {
    void import('../rotationReader').then((m) => m.readGameplayFile(video, page.allNames, simulated, onDraft));
    return true;
  }
  const json = files.find((f) => f.type.includes('json') || f.name.toLowerCase().endsWith('.json'));
  return openRun(json ? await json.text() : text);
}

/** The page's clicks (app.ts passes them on, then redraws). True if it was one of theirs. */
export function simAction(action: string, el: HTMLElement): boolean {
  const v = el.dataset.value ?? '';
  const team = teamOf(settings());
  if (action !== 'sim-delete') page.deleting = null;
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
      page.draftOpen = false;
      const entry = page.runs.find((x) => String(x.at) === v);
      // A parsed run that's open closes when clicked again (its title, team and results go with it).
      if (entry && isRecording(entry) && page.replay?.at === entry.at && !page.replayWorker) {
        page.replay = null;
        page.runsShown = null;
        if (page.draft?.at === entry.at) page.draft = null;
      } else if (entry && isRecording(entry)) {
        page.replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
        // The list folds away so the run's title sits near the top; its toggle brings it back.
        page.runsShown = null;
      }
      else if (entry && !page.running) {
        page.result = { ...entry };
        page.picked = true;
      }
      return true;
    }
    case 'sim-art': {
      // One gear stat's Artifice while a parsed run is edited: the next level, its highest back to 0. Only that gear
      // line is drawn again (its values and own mark change too), open as it was.
      const [i, k, x] = (el.dataset.value ?? '').split(':').map(Number);
      const g = page.draft?.builds[i]?.gear[k];
      const w = g && page.wikiNow?.gear[g.id];
      if (!g || !w) return false;
      editBuild(i, `art${k}:${x}`, (statArtifice(g.artifice, x) + 1) % ((artificeTops(w)[x] ?? 0) + 1));
      const line = el.closest<HTMLElement>('.sim-gear-d');
      if (line) {
        line.outerHTML = String(gearLine(g.id, g.artifice, line.dataset.gearKey ?? '', page.wikiNow!, `${i}:${k}`));
        document.querySelector<HTMLElement>(`[data-action="sim-art"][data-value="${i}:${k}:${x}"]`)?.focus();
      }
      return false;
    }
    case 'sim-main': {
      // An operator's box clicked while editing (not one of its fields): they made every Final Strike and Finisher.
      if (!page.draft || (el !== (window.event?.target as HTMLElement | null) && (window.event?.target as HTMLElement | null)?.closest('input, select, button, a, label'))) return false;
      for (const step of page.draft.steps) if (step.input === 'strike' || step.input === 'finisher') step.slot = Number(v) as VideoStep['slot'];
      return true;
    }
    case 'sim-runs':
      page.runsShown = !(page.runsShown ?? page.replay?.at === undefined);
      return true;
    case 'sim-fav': {
      const entry = page.runs.find((x) => String(x.at) === v);
      if (entry) {
        entry.fav = !entry.fav || undefined;
        void updateSim(entry.at, { fav: entry.fav });
      }
      return true;
    }
    case 'sim-edit':
      page.editing = page.editing === Number(v) ? null : Number(v);
      return true;
    // A recording-sim discrepancy put away (or all of them back).
    case 'sim-dismiss': {
      const entry = page.runs.find((x) => String(x.at) === el.dataset.at);
      if (!entry) return false;
      entry.dismissed = [...new Set([...(entry.dismissed ?? []), v])];
      void updateSim(entry.at, { dismissed: entry.dismissed });
      return true;
    }
    case 'sim-undismiss': {
      const entry = page.runs.find((x) => String(x.at) === v);
      if (!entry) return false;
      entry.dismissed = undefined;
      void updateSim(entry.at, { dismissed: undefined });
      return true;
    }
    case 'sim-fold':
      if (v === 'video' || v === 'checks' || v === 'buffs' || v === 'moves') page.fold[v] = !page.fold[v];
      return true;
    case 'sim-view':
      if (v === 'recording' || v === 'sim') page.view = v;
      return true;
    case 'sim-seek': {
      if (!page.playBars) return false;
      page.play.t = Math.max(page.tlStart, Math.min(page.playBars.seconds, Number(v)));
      if (page.play.running) page.play.last = performance.now();
      paintPlay();
      showPlayhead();
      document.querySelector('.sim-play')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return false;
    }
    // The timeline's zoom: a step out or in, kept for this viewer, the playhead kept in view.
    case 'sim-zoom': {
      const k = TL_ZOOMS.indexOf(page.tlZoom) + Number(v);
      if (k < 0 || k >= TL_ZOOMS.length) return false;
      page.tlZoom = TL_ZOOMS[k];
      saveZoom(page.tlZoom);
      setTimeout(() => showPlayhead(true));
      return true;
    }
    case 'sim-play':
      if (!page.playBars) return false;
      page.play.running = !page.play.running;
      if (page.play.running) {
        if (page.play.t >= page.playBars.seconds) page.play.t = 0;
        runPlay();
      } else cancelAnimationFrame(page.play.raf);
      return true;
    case 'sim-transcript': {
      const entry = page.runs.find((x) => String(x.at) === v);
      const reading = entry && videoOf(entry);
      // The run as it was is kept, so the X can put it back after previews and name or note changes.
      page.draft = page.draft?.at === entry?.at || !entry || !reading ? null : { at: entry.at, steps: reading.steps.map((x) => ({ ...x })), away: (reading.away ?? []).map(([a, b]) => [a, b]), seconds: reading.seconds, builds: JSON.parse(JSON.stringify((JSON.parse(entry.key) as SimRequest).builds)), orig: { key: entry.key, result: entry.result, video: entry.video, name: entry.name, note: entry.note } };
      return true;
    }
    case 'sim-step-add':
      if (page.draft) {
        const last = page.draft.steps[page.draft.steps.length - 1];
        page.draft.steps.push({ t: Math.round(((last?.t ?? 0) + 0.5) * 100) / 100, slot: last?.slot ?? 0, input: 'battle' });
      }
      return true;
    case 'sim-step-del':
      page.draft?.steps.splice(Number(v), 1);
      return true;
    case 'sim-away-add':
      if (page.draft) {
        const from = page.draft.away[page.draft.away.length - 1]?.[1] ?? page.draft.steps[page.draft.steps.length - 1]?.t ?? 0;
        page.draft.away.push([from, Math.round((from + 5) * 100) / 100]);
      }
      return true;
    case 'sim-away-del':
      page.draft?.away.splice(Number(v), 1);
      return true;
    // X: every change since Edit is discarded (previews, name, note), and the run is as it was.
    case 'sim-step-cancel': {
      const entry = page.draft && page.runs.find((x) => x.at === page.draft!.at);
      if (entry && page.draft) {
        page.replayWorker?.terminate();
        page.replayWorker = null;
        Object.assign(entry, page.draft.orig);
        void updateSim(entry.at, page.draft.orig);
        page.replay = { names: entry.names, ids: entry.ids, result: entry.result as ReplayResult, at: entry.at };
      }
      page.draft = null;
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
      if (page.runs.find((x) => x.at === at)?.fav) return false;
      if (page.deleting !== at) {
        page.deleting = at;
        return true;
      }
      page.deleting = null;
      if (page.draft?.at === at) page.draft = null;
      const gone = page.runs.find((x) => x.at === at);
      page.runs = page.runs.filter((x) => x.at !== at);
      if (gone && page.saved?.get(gone.key) === gone) {
        const left = page.runs.filter((x) => x.key === gone.key).pop();
        if (left) page.saved.set(gone.key, left);
        else page.saved.delete(gone.key);
      }
      if (page.result?.at === at) {
        page.result = null;
        page.picked = false;
      }
      if (page.replay?.at === at) page.replay = null;
      void deleteSim(at);
      return true;
    }
    case 'sim-read':
      void import('../rotationReader').then((m) => m.readGameplay(page.allNames, simulated, onDraft));
      return true;
    // The read waiting for picks: shown again, or reopened from its saved draft.
    case 'sim-draft':
      if (page.readerEl) {
        page.draftOpen = true;
        page.replay = null;
        return true;
      }
      void import('../rotationReader').then((m) => m.openReaderDraft(page.allNames, simulated, onDraft));
      return true;
    case 'sim-export': {
      const entry = page.runs.find((x) => String(x.at) === v);
      if (entry) exportRun(entry);
      return true;
    }
    case 'sim-import':
      importRun();
      return true;
    case 'sim-run':
      page.pending = true;
      return true;
  }
  return false;
}

// Dragging the scrubber moves the playhead with it (its time tip, the bars, the lanes), not only on release.
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement | null;
  // The run's name field grows with its text (its box sizes to a copy of it).
  if (el?.dataset?.sim === 'runname' && el.parentElement) el.parentElement.dataset.value = el.value || el.placeholder;
  if (el?.dataset?.sim !== 'play-seek') return;
  page.play.t = Math.max(page.tlStart, Number(el.value) || 0);
  paintPlay();
});

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
  else if (f === 'sp') save({ startSp: el.value.trim() === '' ? undefined : Math.max(0, Math.min(enemyById(settings().enemy).enemy.sp?.max ?? 300, Number(el.value))) });
  // The enemy's own HP for the HP goal, until one is typed.
  else if (f === 'enemy') save({ enemy: el.value === 'dummy' ? undefined : el.value, hp: undefined });
  else if (f === 'controlled') save({ controlled: el.value || undefined });
  // Every Final Strike and Finisher in a transcript being edited: the one controlled.
  // The fight's length in a transcript being edited (seconds on its timer).
  else if (f === 'step-len') {
    // As the figure shows it (m:ss.s) or in seconds.
    const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(el.value);
    const secs = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : NaN;
    if (page.draft && secs >= 1) page.draft.seconds = Math.round(secs * 10) / 10;
    if (page.draft) el.value = clockTime(page.draft.seconds);
  }
  else if (f === 'step-main') {
    for (const step of page.draft?.steps ?? []) if (step.input === 'strike' || step.input === 'finisher') step.slot = Number(el.value) as VideoStep['slot'];
    page.redrawPage();
  }
  // A press in a transcript being edited (no redraw, so Tab moves along; sorted by time when played).
  // A stretch the enemy is invulnerable: from, to.
  else if (f === 'away-a' || f === 'away-b') {
    const stretch = page.draft?.away[Number(el.dataset.k)];
    const t = videoTimeOf(el.value);
    if (stretch && t !== undefined) stretch[f === 'away-a' ? 0 : 1] = t;
  }
  else if (f === 'step-t' || f === 'step-slot' || f === 'step-input') {
    const step = page.draft?.steps[Number(el.dataset.k)];
    const t = f === 'step-t' ? videoTimeOf(el.value) : undefined;
    if (step && f === 'step-t') {
      if (t !== undefined) step.t = t;
    }
    else if (step && f === 'step-slot') step.slot = Number(el.value) as VideoStep['slot'];
    else if (step) step.input = el.value as VideoStep['input'];
  }
  // The timeline player: where, how fast.
  else if (f === 'play-seek') {
    page.play.t = Math.max(page.tlStart, Number(el.value) || 0);
    paintPlay();
  } else if (f === 'play-speed') page.play.speed = Number(el.value) || 1;
  // A battle skill's SP gained (blank: unknown), as the game gives it (spGained: Tangtang's 0, 20, 40).
  else if (f === 'step-back') {
    const step = page.draft?.steps[Number(el.dataset.k)];
    const op = page.draft && page.runs.find((x) => x.at === page.draft!.at)?.ids[step?.slot ?? -1];
    if (step) step.back = el.value.trim() === '' ? undefined : spGained(Math.max(0, Number(el.value) || 0), op ?? undefined);
    if (step) el.value = step.back === undefined ? '' : String(step.back);
  }
  // A press that interrupted the boss's attack (the meter's +20, the big X).
  else if (f === 'step-int') {
    const step = page.draft?.steps[Number(el.dataset.k)];
    if (step) step.interrupt = (el as HTMLInputElement).checked || undefined;
  }
  // A run's name or note: saved as typed, shown when the edit closes (no redraw, so Tab moves between the two).
  else if (f === 'runname' || f === 'note') {
    const entry = page.runs.find((x) => String(x.at) === el.dataset.at);
    const value = el.value.trim() || undefined;
    // A run without a name shows its title in the field (as it does unedited); left as that, it stays unnamed.
    if (entry && f === 'runname') void updateSim(entry.at, { name: (entry.name = value === el.dataset.title ? undefined : value) });
    else if (entry) void updateSim(entry.at, { note: (entry.note = value) });
  } else if (f === 'runfood' && page.draft && page.draft.at === page.replay?.at) {
    const nb = page.draft.builds[Number(el.dataset.i)];
    if (nb && el.value) nb.food = el.value;
    else if (nb) delete nb.food;
  } else if (f === 'runfood') {
    const entry = page.replay?.at === undefined ? undefined : page.runs.find((x) => x.at === page.replay!.at);
    const reading = entry && videoOf(entry);
    if (entry && reading && !page.replayWorker) {
      const { video: _, ...req } = JSON.parse(entry.key) as SimRequest & { video?: boolean };
      const k = Number(el.dataset.i);
      const builds = req.builds.map((b, j) => {
        if (j !== k) return b;
        const { food: _f, ...rest } = b;
        return el.value ? { ...rest, food: el.value } : rest;
      });
      runReplay(reading, reading.names.map((_, j) => j), { ...req, builds }, entry.names, entry.ids, page.redrawPage, entry);
    }
  } else if (f === 'runbuild') {
    const min = Number(el.getAttribute('min'));
    const max = Number(el.getAttribute('max'));
    editBuild(Number(el.dataset.i), el.dataset.field!, el.value.trim() === '' ? undefined : Math.max(min, Math.min(max, Math.round(Number(el.value)))));
    if (el.dataset.field === 'wpotential') page.redrawPage();
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
  page.wikiNow = wiki;
  const s = settings();
  const team = teamOf(s);
  const mode = s.builds ?? 'mine';
  const optimal = mode === 'optimal';
  const built = team.map((m) => buildOf(m, wiki, index.data!));
  const names = team.map((m) => wiki.ops[m.op]?.name ?? m.op);
  page.allNames = [...new Set(Object.values(wiki.ops).map((o) => o.name))].sort();
  page.redrawPage = redraw;
  loadSaved(redraw);
  loadBuffIcons(redraw);
  const TABS: [string, string, string][] = [['/rotations', 'Parser', ''], ['/rotations/sim', 'Simulator', '']];
  const tabs = (current: string, body: Html) =>
    html`<main class="container fade-in">${sideTabs('Rotations', TABS, current, html`<div class="sim-page">${body}</div>`, header)}</main>`;
  if (view !== 'sim') {
    // Nothing chosen: the newest parsed run opens, once.
    if (page.saved && !page.latestOpened) {
      page.latestOpened = true;
      const newest = page.runs.filter(isRecording).sort((a, b) => b.at - a.at)[0];
      if (newest && !page.replay && !page.draftOpen) page.replay = { names: newest.names, ids: newest.ids, result: newest.result as ReplayResult, at: newest.at };
    }
    const body = parseView(wiki, index.data, s, redraw);
    return html`<main class="container fade-in">${sideTabs('Rotations', TABS, '/rotations', html`<div class="sim-page">${body}</div>`, header, runsAside(page.replay?.at))}</main>`;
  }
  // Standard and Moderate unless picked.
  const style = s.style ? styleOf(s.style) : 'standard';
  const effort = s.effort ?? 'normal';
  const goal = s.goal ?? 'time';
  const seconds = goal === 'hp' ? (s.limit ?? DEFAULT_LIMIT) : (s.seconds ?? DEFAULT_SECONDS);
  const foe = enemyById(s.enemy);
  const hp = goal === 'hp' ? (s.hp ?? foe.hp) : undefined;
  const enemy = foe.id === 'dummy' ? {} : { enemy: foe.enemy };
  // The stage's SP: its cap bounds the start typed (one typed for another stage too).
  const spMax = foe.enemy.sp?.max ?? 300;
  const startSp = s.startSp != null ? Math.min(s.startSp, spMax) : undefined;
  // The share of the fight the enemy can be hit (unset or 100%: all of it).
  const uptime = s.uptime && s.uptime < 100 ? s.uptime / 100 : undefined;
  const at = s.controlled ? team.findIndex((m) => m.op === s.controlled) : -1;
  const main = at >= 0 ? { main: at } : {};
  const req: SimRequest = optimal
    ? {
        builds: team.map((m, i) => optimalBuildOf(m, built[i].build)),
        seconds,
        hp,
        startSp,
        uptime,
        ...enemy,
        ...main,
        style,
        effort,
        optimize: { weapons: team.map((m) => (m.weapon ? [m.weapon] : weaponsFor(m.op, wiki, index.data!))), limited: limitedWeapons(), signatures: signatureWeapons() },
      }
    : { builds: built.map((b) => b.build), seconds, hp, startSp, uptime, ...enemy, ...main, style, effort };
  const key = JSON.stringify(req);
  // A run picked from the history stays while the team's the same; else this setup's saved result, when there's one
  // and nothing newer for it is showing.
  if (page.picked && page.result && teamKey(page.result.names) !== teamKey(names)) page.picked = false;
  const before = page.saved?.get(key);
  if (before && !page.running && !page.picked && page.result?.key !== key) page.result = { ...before };
  const fresh = page.result?.key === key;
  const blocked = optimal ? req.optimize!.weapons.some((w) => !w.length) : built.some((b) => !b.build.weapon);
  // The builds the last run chose, for the members still where they were.
  const chosen = (i: number) => (page.result && page.result.ids[i] === team[i].op && JSON.parse(page.result.key).optimize ? page.result.result.builds[i] : undefined);
  if (page.pending) {
    page.pending = false;
    if (!blocked) run(req, key, names, s.cores ?? AUTO_CORES, redraw);
  }
  const progress = page.running?.progress;
  return tabs(
    '/rotations/sim',
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
          <label class="sim-field"><span class="label-12 secondary">SP at the start</span><input class="input sim-num" type="number" min="0" max="${spMax}" data-sim="sp" value="${startSp ?? ''}" placeholder="${foe.enemy.sp?.start ?? START_SP}" /></label>
          <label class="sim-field"><span class="label-12 secondary">Uptime (%)</span><input class="input sim-num" type="number" min="10" max="100" data-sim="uptime" value="${s.uptime ?? ''}" placeholder="100" /></label>
          <label class="sim-field"><span class="label-12 secondary">Threads</span><select class="input sim-cores" data-sim="cores" aria-label="Threads">
            <option value="" ${s.cores ? '' : 'selected'}>Auto (${AUTO_CORES})</option>
            ${Array.from({ length: CORES }, (_, k) => k + 1).map((c) => html`<option value="${c}" ${s.cores === c ? 'selected' : ''}>${c}</option>`)}
          </select></label>
        </div>
        <div class="sim-run">
          ${page.running
            ? html`<button type="button" class="btn secondary" data-action="sim-stop">${icon('stop')}Stop</button>
                <span class="copy-14 secondary">${icon('hourglass_empty')} ${page.running.loading
                  ? 'Loading the combat data…'
                  : progress?.phase === 'gear'
                    ? `Choosing weapons and gear · ${Math.min(100, Math.round((progress.played / progress.budget) * 100))}%`
                    : progress
                      ? `${progress.killedIn !== undefined ? `Fastest so far ${clockTime(progress.killedIn)}` : `Best so far ${big(progress.dps)} DPS`} · ${Math.min(100, Math.round((progress.played / progress.budget) * 100))}%${(page.running.cores ?? 1) > 1 ? ` · ${page.running.cores} threads` : ''}`
                      : 'Searching…'}</span>`
            : html`<button type="button" class="btn primary" data-action="sim-run" ${blocked ? 'disabled' : ''}>${icon(fresh ? 'refresh' : 'play_arrow')}${fresh ? 'Run again' : 'Find rotation'}</button>
                ${fresh && page.result?.at ? html`<span class="copy-13 secondary">Saved ${new Date(page.result.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · took ${Math.max(1, Math.round(page.result.result.ms / 1000))} s</span>` : ''}
                ${blocked ? html`<span class="copy-13 secondary">${optimal ? 'An operator here has no weapons with combat data yet.' : 'Every operator needs a weapon in their loadout.'}</span>` : ''}`}
        </div>
        ${page.failed ? html`<p class="copy-14 sim-error">${page.failed}</p>` : ''}
      </div></section>
      ${historyView(names, page.result?.at)}
      ${page.result ? resultsView(page.result.result, page.result.names, page.result.ids, page.picked ? !!page.running : page.result.key !== key || !!page.running) : ''}
      ${CREDIT}`,
  );
}
