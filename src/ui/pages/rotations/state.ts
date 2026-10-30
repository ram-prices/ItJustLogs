import { type BuffSpan, DEFAULT_TEAM, type Effort, ENEMIES, type ReplayResult, type SimBuild, type SimMember, type SimProgress, type SimResult, type SimSettings } from '../../../domain/sim/team';
import type { WikiGearFile, WikiOperatorFile, WikiWeaponFile } from '../../../domain/wiki';
import { state, updateSettings } from '../../../state';
import type { SavedSim } from '../../../store';
import type { VideoRotation } from '../../rotationReader';
import type { LiveDamage, RecordingCard } from './fit';
import type { Bars } from './player';

export const EFFORTS: [Effort, string][] = [
  ['quick', 'Quick'],
  ['normal', 'Moderate'],
  ['thorough', 'Thorough'],
];

export const settings = (): SimSettings => state.settings.sim ?? {};
export const save = (patch: Partial<SimSettings>) => updateSettings({ sim: { ...settings(), ...patch } });
export const teamOf = (s: SimSettings): SimMember[] => s.team ?? DEFAULT_TEAM;

export interface CombatIndex {
  ops: string[];
  weapons: string[];
}

/** This device's threads (logical processors: 2 per core with hyper-threading), and how many a search uses unless set: all but one. */
export const CORES = Math.max(1, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
export const AUTO_CORES = Math.max(1, CORES - 1);

/** A parsed run's transcript step (ui/rotationReader.ts). */
export type VideoStep = VideoRotation['steps'][number];

/** The timeline's zoom steps (1: its own width, or the phone's minimum px per second). */
export const TL_ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
const ZOOM_KEY = 'ijl.timelineZoom';
function readZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return TL_ZOOMS.includes(z) ? z : 1;
  } catch {
    return 1;
  }
}
export function saveZoom(z: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    // Kept for this visit only.
  }
}

/**
 * The page's state, all of it in one object: the search and what it last gave, the saved runs, the Parser's open run
 * and its editor, the timeline player, and what the page drew with. (One object, so the page's modules can share it.)
 */
interface PageState {
  // The search: its worker, what it's doing, what it last gave, and why it stopped.
  worker: Worker | null;
  running: { key: string; progress: SimProgress | null; loading: boolean; cores?: number } | null;
  result: { key: string; result: SimResult; names: string[]; ids: string[]; at?: number } | null;
  failed: string;
  /** Each worker message's id: a reply to an older one is ignored. */
  seq: number;
  /** Set by the Run button; the page starts the search when it next draws (it has the data then). */
  pending: boolean;
  // Results found before (this browser's data), by request: a team shows its last one at once. Every run is kept
  // (`runs`, oldest first) for the team's history.
  saved: Map<string, SavedSim<SimResult>> | null;
  runs: SavedSim<SimResult>[];
  savedLoading: boolean;
  /** A run picked from the history: shown until the next run or another team. */
  picked: boolean;
  /** History: the run being renamed or noted, and the one asking to be deleted. */
  editing: number | null;
  deleting: number | null;
  // The Parser.
  /** A gameplay video's rotation (ui/rotationReader.ts) waiting to be played in the sim, and what it gave. */
  video: VideoRotation | null;
  /** The last video read, kept in this browser: played again after fixing a loadout, without reading the video again. */
  lastVideo: VideoRotation | null;
  replay: { names: string[]; ids: string[]; result?: ReplayResult; error?: string; at?: number } | null;
  replayWorker: Worker | null;
  /** A parsed run's transcript being edited: its presses, until played again or cancelled. */
  draft: { at: number; steps: VideoStep[]; away: [number, number][]; seconds: number; builds: SimBuild[]; orig: Pick<SavedSim<SimResult>, 'key' | 'result' | 'video' | 'name' | 'note'> } | null;
  /** Parsed runs' list shown (true) or folded to its title row (false); null: folded while a run is open. */
  runsShown: boolean | null;
  /** The Parser already opened the newest run once (closing it afterwards stays closed). */
  latestOpened: boolean;
  /**
   * A read video waiting for the player's picks: its review section (the reader's own, kept so picks survive redraws),
   * whether a draft is saved (after a reload, before it's reopened), and whether it's what the page shows.
   */
  readerEl: HTMLElement | null;
  hasDraft: boolean;
  draftOpen: boolean;
  /** The last fit (recordingCard), kept while its run's result is the same one: the timeline's player plays the object it was given and starts over when a redraw hands it another. */
  fitted: { of: ReplayResult; card: RecordingCard } | null;
  /** The open run's, while its timeline can play (paintPlay updates the loadout boxes from it). */
  liveDmg: LiveDamage | undefined;
  /** The shown run's boss: the open parsed run's or the Simulator result's (the Enemy lane and Buffs panel show its picture). */
  laneFoe: (typeof ENEMIES)[number] | undefined;
  /** The Parser tab's timeline: the recording's own (what happened) or the sim's (how it adds up). */
  view: 'recording' | 'sim';
  // The timeline player.
  /** The timeline playing: where it is (seconds on the fight's clock), how fast, whether it runs, and for which result. */
  play: { t: number; speed: number; running: boolean; of: SimResult | null; raf: number; last: number };
  /** The player's bars, plus the boss's Stagger nodes (shares of its meter) and where its later phases begin (seconds). */
  playBars: { sim: Bars; video?: Bars; seconds: number; nodes: number[]; phases: number[]; sp: { sim?: [number, number][]; video?: [number, number][] }; spMax?: number; spRegen?: number; buffs?: BuffSpan[]; controlled?: { slot: number; from: number; to: number }[] } | null;
  /** Where the timeline starts (seconds, 0 or before: a press cast before the stopwatch's 0). */
  tlStart: number;
  /** The timeline's zoom (TL_ZOOMS), this viewer's (localStorage). */
  tlZoom: number;
  /** A buff tapped in the buffs panel: its name and stacks, shown under it. */
  buffTip: string;
  /** What's shown under the timeline: the discrepancies list, the buffs, the full transcript. */
  fold: { video: boolean; checks: boolean; buffs: boolean; moves: boolean };
  /**
   * The loadout boxes' team bars ease to their share at the playhead (a seek, the first Play from the whole fight's
   * shares to an even start) instead of jumping: what each segment shows now (`<box>|<operator>`, kept across redraws,
   * so a redrawn bar goes on from there), and where each operator's is headed.
   */
  barShown: Map<string, number>;
  barTarget: Map<string, number> | null;
  barRaf: number;
  barLast: number;
  /** The transcript's scroll (a redraw, such as pausing, makes a new list: it goes on from here, not the top). */
  movesTop: number;
  /** The labels for the normal view's action column, set as it's drawn (the editor's from the same track). */
  actLabels: string[];
  // What the page drew with.
  /** The page's wiki data as last drawn, for naming buffs. */
  wikiNow: Wiki | null;
  /**
   * Which buff shows which of the game's icons: ef-assets icons/buffs/index.json (buff id -> sprite, from the game's
   * BuffData), fetched once; until then a letter shows.
   */
  buffIcons: Record<string, string> | null;
  /** Buffs the game draws only on the controlled operator's row (ef-assets icons/buffs/main-only.json). */
  buffMainOnly: Set<string> | null;
  buffIconsAsked: boolean;
  /** Every operator's name, for the gameplay reader (ui/rotationReader.ts). */
  allNames: string[];
  /** Redraws the page (app.ts's, from the last draw). */
  redrawPage: () => void;
}

export const page: PageState = {
  worker: null,
  running: null,
  result: null,
  failed: '',
  seq: 0,
  pending: false,
  saved: null,
  runs: [],
  savedLoading: false,
  picked: false,
  editing: null,
  deleting: null,
  video: null,
  lastVideo: null,
  replay: null,
  replayWorker: null,
  draft: null,
  runsShown: null,
  latestOpened: false,
  readerEl: null,
  hasDraft: false,
  draftOpen: false,
  fitted: null,
  liveDmg: undefined,
  laneFoe: undefined,
  view: 'recording',
  // Played at 4× unless picked: a fight is minutes long.
  play: { t: 0, speed: 4, running: false, of: null, raf: 0, last: 0 },
  playBars: null,
  fold: { video: true, checks: true, buffs: false, moves: false },
  tlStart: 0,
  tlZoom: readZoom(),
  buffTip: '',
  barShown: new Map(),
  barTarget: null,
  barRaf: 0,
  barLast: 0,
  movesTop: 0,
  actLabels: [],
  wikiNow: null,
  buffIcons: null,
  buffMainOnly: null,
  buffIconsAsked: false,
  allNames: [],
  redrawPage: () => {},
};

/** A team by its characters (any order, any loadouts). */
export const teamKey = (names: string[]) => names.slice().sort().join('|');

export interface Wiki {
  ops: WikiOperatorFile['operators'];
  weapons: WikiWeaponFile['weapons'];
  gear: WikiGearFile['gear']['items'];
}
