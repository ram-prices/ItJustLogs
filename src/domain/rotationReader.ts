/**
 * Reading a rotation from a gameplay video, with image checks only: no AI.
 * ui/rotationReader.ts plays the video and cuts a few areas out of each frame
 * (scaled to READ_HEIGHT tall: the game sizes its HUD to the screen's
 * height); this file measures them and turns the measurements into presses.
 * Two HUDs: the controller one (a 2560×1600 Crisis Calamity recording) and
 * the phone one (a 1560×720 recording), pinned by rotationReader.test.ts:
 * - SP bar (bottom centre, 3 segments of 100): a battle skill drops it, a
 *   Final Strike adds 10–25, a Finisher more.
 * - An ultimate hides the HUD for its cut-in. Controller: whose it was is
 *   the Ultimate dot (skill diamond, bottom right) full before and empty
 *   after. Phone: the skill button lit up just before it.
 * - Who used a battle skill: the button pressed. Controller: in the skill
 *   wheel (hold LB) it flashes, or stays lit a frame longer as the wheel
 *   closes. Phone: the operator's skill button (bottom right) lights up.
 * - A combo shows its operator's art in a side banner (top left). Banners
 *   are grouped by their art: each group is one operator, for the player
 *   to name (colours alone told look-alike art apart wrongly).
 * - The stopwatch ticks once a second (up, or down in timed stages): when
 *   it stops is the fight's end, and a stretch where it stood still a
 *   pause (a phase change; ultimates don't stop it). Its digits are read
 *   with text recognition at a few ticks only (readings passed in).
 */

export const READ_HEIGHT = 1080;

export type Slot = 0 | 1 | 2 | 3;

/** RGBA pixels of an area, as a canvas gives them. */
export interface Px {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Point = readonly [number, number];
type Test = (r: number, g: number, b: number) => boolean;

/** A HUD: where its parts are at READ_HEIGHT, and how they look. */
export interface Layout {
  name: 'controller' | 'mobile';
  /** The four operators' places on the HUD, as the review names them. */
  slots: readonly string[];
  /**
   * Each slot's team position (1–4) when it isn't the slots' order: the controller's goes Left 1, Top 2, Right 3,
   * Bottom 4 (the owner's team Yvonne, Tangtang, Xaihi, Arcane sits Left, Top, Right, Bottom).
   */
  positions?: readonly number[];
  /** Bottom right (anchored to the right edge): the skill buttons. */
  right: { w: number; h: number; y: number };
  /** Bottom centre: the SP bar over the HP bar. */
  centre: { w: number; h: number; y: number };
  /** Top left: where a combo's banner shows. */
  banner: Area;
  /** The stopwatch's digits: from the left edge (x) or the centre (dx). */
  clock: { x?: number; dx?: number; y: number; w: number; h: number };
  /** The boss's name, centred. */
  enemy?: { w: number; h: number; y: number };
  /** The boss's Stagger meter under its HP bar: from the centre (dx), its full width. */
  stagger?: { dx: number; y: number; w: number; h: number };
  /** The boss's HP bar: from the centre (dx), its full width. */
  bossHp?: { dx: number; y: number; w: number; h: number };
  /** Where each slot's picture is for the review: in `area`, a square `size` wide around these points. */
  faces: { area: 'portraits' | 'right'; at: Point[]; above: number; size: number };
  portraits?: Area;
  segments: number[][];
  spY: number;
  hpY: number;
  hpX: number[];
  /** Each slot's Ultimate dot in the right area (controller only). */
  dots: Point[];
  /** Where each slot's press shows in the right area, and how far around it to look. */
  presses: Point[];
  pressHalf: number;
  pressTest: Test;
  /** A banner's edges show at least this clearly (the phone's, smaller and see-through, less so). */
  bannerOn: number;
  bannerEdges: number[];
  /** The stopwatch's ink. */
  ink: Test;
}

const timerGreen: Test = (r, g, b) => g > 150 && r > 110 && b < 110 && g - b > 80;
const white: Test = (r, g, b) => Math.min(r, g, b) > 200;
const light: Test = (r, g, b) => Math.min(r, g, b) > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 40;

/** The controller HUD, measured at 2560×1600. */
export const CONTROLLER: Layout = (() => {
  const S = READ_HEIGHT / 1600;
  const right = { w: 312, h: 280, y: 776 };
  const centre = { w: 300, h: 32, y: 980 };
  const banner = { x: 0, y: 220, w: 340, h: 155 };
  const portraits = { x: 0, y: 776, w: 420, h: 304 };
  const rp = (x: number, y: number) => [Math.round((x - 2560) * S + right.w), Math.round(y * S - right.y)] as const;
  const cp = (x: number, y: number) => [Math.round((x - 1280) * S + centre.w / 2), Math.round(y * S - centre.y)] as const;
  return {
    name: 'controller',
    slots: ['Top', 'Left', 'Right', 'Bottom'],
    positions: [2, 1, 3, 4],
    right,
    centre,
    banner,
    clock: { x: 214, y: 30, w: 88, h: 40 },
    enemy: { w: 400, h: 36, y: 18 },
    // At 2560×1600: rows 106–110, x 963–1600.
    stagger: { dx: Math.round((963 - 1280) * S), y: Math.round(106 * S), w: Math.round(637 * S), h: 3 },
    // At 2560×1600: rows 82–93, x 964–1596.
    bossHp: { dx: Math.round((964 - 1280) * S), y: Math.round(84 * S), w: Math.round(632 * S), h: 5 },
    portraits,
    faces: {
      area: 'portraits',
      at: [
        [305, 1255],
        [200, 1365],
        [410, 1370],
        [310, 1470],
      ].map(([x, y]) => [Math.round(x * S) - portraits.x, Math.round(y * S) - portraits.y] as const),
      above: 20,
      size: 64,
    },
    segments: [
      [cp(1072, 0)[0], cp(1198, 0)[0]],
      [cp(1216, 0)[0], cp(1344, 0)[0]],
      [cp(1360, 0)[0], cp(1494, 0)[0]],
    ],
    spY: cp(0, 1468)[1],
    hpY: cp(0, 1490)[1],
    hpX: [cp(1080, 0)[0], cp(1480, 0)[0]],
    dots: [rp(2368, 1255), rp(2228, 1390), rp(2510, 1390), rp(2368, 1530)],
    // Each slot's icon while the skill wheel is open.
    presses: [rp(2273, 1250), rp(2173, 1342), rp(2373, 1342), rp(2273, 1438)],
    pressHalf: 19,
    pressTest: white,
    bannerOn: 0.5,
    bannerEdges: [Math.round(345 * S) - banner.y, Math.round(541 * S) - banner.y],
    ink: timerGreen,
  };
})();

/** The phone HUD, measured at 1560×720: everything about 1.4 times the controller HUD's size, laid out apart. */
export const MOBILE: Layout = (() => {
  const S = READ_HEIGHT / 720;
  const right = { w: 720, h: 460, y: 540 };
  const centre = { w: 420, h: 40, y: 940 };
  // Its left part: the banner is see-through further right, over the stage's objectives.
  const banner = { x: 0, y: 290, w: 420, h: 220 };
  const rp = (x: number, y: number) => [Math.round((x - 1560) * S + right.w), Math.round(y * S - right.y)] as const;
  const cp = (x: number, y: number) => [Math.round((x - 780) * S + centre.w / 2), Math.round(y * S - centre.y)] as const;
  // The four skill buttons, upper right to lower left.
  const buttons = [rp(1282, 412), rp(1182, 432), rp(1128, 520), rp(1142, 625)];
  return {
    name: 'mobile',
    slots: ['Upper right', 'Upper', 'Middle', 'Lower'],
    right,
    centre,
    banner,
    clock: { dx: -48, y: 172, w: 140, h: 60 },
    faces: { area: 'right', at: buttons, above: 48, size: 96 },
    segments: [
      [cp(648, 0)[0], cp(729, 0)[0]],
      [cp(741, 0)[0], cp(822, 0)[0]],
      [cp(829, 0)[0], cp(912, 0)[0]],
    ],
    spY: cp(0, 637)[1],
    hpY: cp(0, 651)[1],
    hpX: [cp(655, 0)[0], cp(905, 0)[0]],
    dots: [],
    presses: buttons,
    pressHalf: 32,
    pressTest: light,
    bannerOn: 0.3,
    bannerEdges: [Math.round(206 * S) - banner.y, Math.round(329 * S) - banner.y],
    ink: white,
  };
})();

export const LAYOUTS = { controller: CONTROLLER, mobile: MOBILE };

/** The controller HUD's slot names (the review's default). */
export const SLOTS = CONTROLLER.slots;

/** Where to cut the areas from a frame `width` wide and READ_HEIGHT tall. */
export function areas(width: number, layout: Layout = CONTROLLER): { right: Area; centre: Area; banner: Area; portraits: Area; clock: Area; enemy?: Area; stagger?: Area; bossHp?: Area } {
  const { right, centre, clock, enemy, stagger, bossHp } = layout;
  return {
    right: { x: width - right.w, y: right.y, w: right.w, h: right.h },
    centre: { x: Math.round(width / 2) - centre.w / 2, y: centre.y, w: centre.w, h: centre.h },
    banner: layout.banner,
    portraits: layout.portraits ?? { x: width - right.w, y: right.y, w: right.w, h: right.h },
    clock: { x: clock.x ?? Math.round(width / 2) + clock.dx!, y: clock.y, w: clock.w, h: clock.h },
    enemy: enemy && { x: Math.round(width / 2) - enemy.w / 2, y: enemy.y, w: enemy.w, h: enemy.h },
    stagger: stagger && { x: Math.round(width / 2) + stagger.dx, y: stagger.y, w: stagger.w, h: stagger.h },
    bossHp: bossHp && { x: Math.round(width / 2) + bossHp.dx, y: bossHp.y, w: bossHp.w, h: bossHp.h },
  };
}

const at = (p: Px, x: number, y: number) => (y * p.width + x) * 4;

/** What a frame shows. */
export interface Sample {
  /** Seconds into the video. */
  t: number;
  /** SP, 0–300. */
  sp: number;
  /** How much of the HP bar is lit: the HUD is up (it hides for ultimates' cut-ins). */
  hud: number;
  /** How clearly a side banner's edges show (a combo). */
  banner: number;
  /** Each slot's Ultimate dot: how much of it is filled with colour (controller). */
  ready: number[];
  /** Each slot's press: how much of its icon in the skill wheel is white (controller), or of its skill button is lit (phone). */
  wheel: number[];
  /** While a banner shows: its art, 24×9 RGB means. */
  art?: number[];
  /** The stopwatch: how many of its ink pixels each column has (it changes when it ticks). */
  clock?: number[];
  /** The boss's Stagger meter: how full (0–1), and whether it's yellow (Staggered). */
  stagger?: number;
  staggered?: boolean;
  /** The boss's HP bar: how much is left (0–1; its white part is the damage effect, not HP). */
  bossHp?: number;
}

/** SP from the bar: how far each segment is lit from its left (white or yellow). */
function spOf(c: Px, l: Layout): number {
  let sp = 0;
  for (const [a, b] of l.segments) {
    let n = 0;
    for (let x = a; x < b; x++) {
      // The dimmest of three rows, brightest channel.
      let v = 255;
      for (let y = l.spY - 1; y <= l.spY + 1; y++) {
        const i = at(c, x, y);
        v = Math.min(v, Math.max(c.data[i], c.data[i + 1], c.data[i + 2]));
      }
      if (v > 180) n++;
      else break;
    }
    sp += (100 * n) / (b - a);
  }
  return sp;
}

function hudOf(c: Px, l: Layout): number {
  let lit = 0;
  let n = 0;
  for (let y = l.hpY - 1; y <= l.hpY + 1; y++)
    for (let x = l.hpX[0]; x < l.hpX[1]; x++, n++) {
      const i = at(c, x, y);
      if (c.data[i + 2] > 170 && c.data[i + 1] > 140 && c.data[i] < 130) lit++;
    }
  return lit / n;
}

/** The HP bar's lit share in a centre area cut for `layout` (which HUD a video has: ui picks by it). */
export const hudIn = (centre: Px, layout: Layout) => hudOf(centre, layout);

/** The share of columns with a sharp step at the banner's top edge, and at its bottom: the smaller. */
function bannerOf(p: Px, l: Layout): number {
  const grey = (x: number, y: number) => {
    const i = at(p, x, y);
    return (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
  };
  let edges = 1;
  for (const r of l.bannerEdges) {
    let best = 0;
    for (let y = r - 2; y <= r; y++) {
      let n = 0;
      for (let x = 10; x < p.width - 10; x++) if (Math.abs(grey(x, y + 1) - grey(x, y)) > 22) n++;
      best = Math.max(best, n / (p.width - 20));
    }
    edges = Math.min(edges, best);
  }
  return edges;
}

function share(p: Px, cx: number, cy: number, half: number, test: Test): number {
  let hit = 0;
  let n = 0;
  for (let y = cy - half; y <= cy + half; y++)
    for (let x = cx - half; x <= cx + half; x++, n++) {
      const i = at(p, x, y);
      if (test(p.data[i], p.data[i + 1], p.data[i + 2])) hit++;
    }
  return hit / n;
}

/** The stopwatch's ink pixels per column. */
export function clockProfile(c: Px, layout: Layout = CONTROLLER): number[] {
  const out: number[] = [];
  for (let x = 0; x < c.width; x++) {
    let n = 0;
    for (let y = 0; y < c.height; y++) {
      const i = at(c, x, y);
      if (layout.ink(c.data[i], c.data[i + 1], c.data[i + 2])) n++;
    }
    out.push(n);
  }
  return out;
}

/** The stopwatch's digits as black on white, `scale` times bigger with a white margin, for text recognition. */
export function clockInk(c: Px, layout: Layout = CONTROLLER, scale = 3, margin = 24): Px {
  const w = c.width * scale + 2 * margin;
  const h = c.height * scale + 2 * margin;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < c.height * scale; y++)
    for (let x = 0; x < c.width * scale; x++) {
      const i = at(c, Math.floor(x / scale), Math.floor(y / scale));
      if (layout.ink(c.data[i], c.data[i + 1], c.data[i + 2])) data.set([0, 0, 0, 255], ((y + margin) * w + x + margin) * 4);
    }
  return { data, width: w, height: h };
}

/** White text (the boss's name) as black on white, for text recognition. */
export function whiteInk(c: Px, scale = 2): Px {
  const w = c.width * scale;
  const h = c.height * scale;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = at(c, Math.floor(x / scale), Math.floor(y / scale));
      const v = Math.min(c.data[i], c.data[i + 1], c.data[i + 2]) > 190 ? 0 : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

const colourful: Test = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) > 80 && Math.max(r, g, b) > 140;

/**
 * The boss's Stagger meter: how far from its left it's filled (pink, or yellow while Staggered), a gap of a few
 * pixels allowed (its node's mark).
 */
export function staggerOf(p: Px): { full: number; yellow: boolean } {
  let end = 0;
  let gap = 0;
  let yellow = 0;
  for (let x = 0; x < p.width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < p.height; y++) {
      const i = at(p, x, y);
      r += p.data[i];
      g += p.data[i + 1];
      b += p.data[i + 2];
    }
    r /= p.height;
    g /= p.height;
    b /= p.height;
    const isYellow = r > 170 && g > 150 && b < 120;
    if ((r > 170 && b > 90 && g > 80) || isYellow) {
      end = x + 1;
      gap = 0;
      if (isYellow) yellow++;
    } else if (++gap > 4) break;
  }
  return { full: end / p.width, yellow: end > 0 && yellow > end / 2 };
}

/** The boss's HP bar: how far from its left it's red (a gap of a few pixels allowed); null if no red shows. */
export function bossHpOf(p: Px): number | null {
  let end = 0;
  let gap = 0;
  for (let x = 0; x < p.width; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < p.height; y++) {
      const i = at(p, x, y);
      r += p.data[i];
      g += p.data[i + 1];
      b += p.data[i + 2];
    }
    r /= p.height;
    g /= p.height;
    b /= p.height;
    if (r > 170 && g < 120 && b > 60 && b < 170) {
      end = x + 1;
      gap = 0;
    } else if (++gap > 3) break;
  }
  return end > 2 ? end / p.width : null;
}

/** Measures one frame from its areas, cut for `layout`. */
export function measure(t: number, right: Px, centre: Px, banner: Px, clock?: Px, layout: Layout = CONTROLLER, meter?: Px, hpBar?: Px): Sample {
  const s: Sample = {
    t,
    sp: spOf(centre, layout),
    hud: hudOf(centre, layout),
    banner: bannerOf(banner, layout),
    ready: layout.dots.length ? layout.dots.map(([x, y]) => share(right, x, y, 3, colourful)) : [0, 0, 0, 0],
    wheel: layout.presses.map(([x, y]) => share(right, x, y, layout.pressHalf, layout.pressTest)),
  };
  if (s.banner > 0.3) s.art = artOf(banner, layout);
  if (clock) s.clock = clockProfile(clock, layout);
  if (meter && s.hud > 0.5) {
    const m = staggerOf(meter);
    s.stagger = m.full;
    if (m.yellow) s.staggered = true;
  }
  if (hpBar && s.hud > 0.5) {
    const h = bossHpOf(hpBar);
    if (h !== null) s.bossHp = h;
  }
  return s;
}

/** A banner's art as 24×9 cells of mean colour (between its edges). */
export function artOf(p: Px, layout: Layout = CONTROLLER): number[] {
  const [y0, y1] = layout.bannerEdges;
  const span = p.width - 23;
  const out: number[] = [];
  for (let cy = 0; cy < 9; cy++)
    for (let cx = 0; cx < 24; cx++) {
      const sum = [0, 0, 0];
      let n = 0;
      const ya = y0 + 2 + Math.floor(((y1 - y0 - 4) * cy) / 9);
      const yb = y0 + 2 + Math.floor(((y1 - y0 - 4) * (cy + 1)) / 9);
      const xa = 20 + Math.floor((span * cx) / 24);
      const xb = 20 + Math.floor((span * (cx + 1)) / 24);
      for (let y = ya; y < yb; y += 2)
        for (let x = xa; x < xb; x += 2, n++) {
          const i = at(p, x, y);
          sum[0] += p.data[i];
          sum[1] += p.data[i + 1];
          sum[2] += p.data[i + 2];
        }
      out.push(sum[0] / n, sum[1] / n, sum[2] / n);
    }
  return out;
}

/** 'dive' only from the transcript editor (a dive attack: the reader can't see one). */
export type Read = 'battle' | 'combo' | 'ultimate' | 'strike' | 'finisher' | 'dive';
export const READ_NAME: Record<Read, string> = { battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', strike: 'Final Strike', finisher: 'Finisher', dive: 'Dive attack' };

/** A press read from the video (or a Final Strike / Finisher between them). */
export interface Step {
  /** Seconds into the video. */
  t: number;
  input: Read;
  /** Whose: a HUD slot, or null when it can't be told. */
  slot: Slot | null;
  /** The slot is a guess. */
  unsure?: boolean;
  /** Battle skills: SP came back right after it (some operators' battle skills return SP): a hint at whose it was. */
  spBack?: boolean;
  /** Battle skills: how much SP came back within SP_BACK seconds (regeneration taken out), when any did. */
  back?: number;
  /** Combos: which banner art it showed (one per operator). */
  group?: number;
  /** Battle skills and combos: it interrupted the boss's attack (its Stagger meter jumped more than a skill's). */
  interrupt?: boolean;
}

export interface Reading {
  steps: Step[];
  /** When the fight's HUD first and last shows (seconds into the video); null if it never does. */
  start: number | null;
  end: number | null;
  /** Each combo group's banner art (24×9 RGB cells), by group. */
  arts: number[][];
  /** From the stopwatch, when its digits were read: when it stopped (seconds into the video), what it showed then (the fight's length, seconds), and the stretches it stood still (seconds into the video). */
  clock?: { end: number; seconds: number; pauses: [number, number][] };
  /** Stretches the boss took no Stagger after its meter's node (seconds into the video): `guards`. */
  guards?: [number, number][];
  /** The boss's bars every BOSS_EVERY seconds: time (seconds into the video), HP left, Stagger meter (-1 Staggered). */
  boss?: [number, number, number][];
}

/** What the stopwatch showed at a tick (text recognition's words, "01:05"). */
export interface ClockReading {
  t: number;
  text: string;
}

const ON = 0.5;
/** HUD hidden at least this long: a cut-in (shorter is a flicker). */
const CUT_IN = 0.25;
/** HUD back for less than this between two hidden stretches: the same cut-in. */
const REJOIN = 0.4;
const DROP = 12;
const GAIN = 8;
const FINISHER = 40;
/** SP coming back from a battle skill: a step within this long after it. */
const SP_BACK = 0.8;
/** How much SP coming back counts. */
const SP_BACK_GAIN = 10;
/** Two Final Strikes are at least this far apart (a basic attack chain takes longer). */
const CHAIN = 1.2;
/** A step smaller than this share of the usual Final Strike's is SP from something else. */
const REFUND = 0.6;
/** The stopwatch is read this long after a tick (seconds). */
const SETTLE = 0.5;
/** A phone skill button lighting up by this much more than before: pressed. */
const PRESSED = 0.25;
/** The stopwatch standing still at least this long is a pause (a phase change; less is a tick found a frame off). */
const PAUSE = 1;
/** The HUD hidden this long is a phase change's black screen (cut-ins and Finishers take about 2 s at most). */
const PHASE = 3;

/** When the HUD shows: per sample, and the hidden stretches ([first, past last] sample), a short flicker of HUD inside one joined to it. */
function shown(samples: Sample[]): { on: boolean[]; gaps: [number, number][] } {
  const n = samples.length;
  const t = samples.map((s) => s.t);
  const on = samples.map((s) => s.hud > ON);
  // Hidden stretches, a short flicker of HUD inside one joined to it.
  const gaps: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (on[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !on[j]) j++;
    const last = gaps[gaps.length - 1];
    if (last && last[1] < n && t[i] - t[last[1]] < REJOIN) last[1] = j;
    else gaps.push([i, j]);
    i = j;
  }
  for (const [i, j] of gaps) for (let k = i; k < j; k++) on[k] = false;
  return { on, gaps };
}

/**
 * Turns a video's samples (in time order) into steps. `clock`: the stopwatch's digits at the ticks clockAnchors
 * asked for, read by text recognition. `layout`: the HUD they were measured with.
 */
export function readRotation(samples: Sample[], clock: ClockReading[] = [], layout: Layout = CONTROLLER): Reading {
  const phone = layout.name === 'mobile';
  const n = samples.length;
  const t = samples.map((s) => s.t);
  const { on, gaps } = shown(samples);
  const first = on.indexOf(true);
  if (first < 0) return { steps: [], start: null, end: null, arts: [] };
  const steps: Step[] = [];

  // Ultimates: a cut-in with the HUD up on both sides, and a dot full before it and empty after (controller), or a
  // skill button lit up just before it (phone).
  const gapEnds: number[] = [];
  for (const [i, j] of gaps) {
    if (j >= n) continue;
    gapEnds.push(t[j]);
    if (i === 0 || t[j] - t[i] < CUT_IN) continue;
    if (phone) {
      const lit = pressed(samples, t[i] - 0.6, t[i] - 0.01);
      if (lit) steps.push({ t: t[i], input: 'ultimate', slot: lit.slot });
      continue;
    }
    // Before: the last moments the dots could be seen (the skill wheel hides them; an ultimate needs one full dot).
    const seen: number[] = [];
    for (let k = i - 1; k >= 0 && t[k] >= t[i] - 3; k--) if (on[k] && Math.max(...samples[k].ready) > ON) seen.push(k);
    const before = seen.filter((k) => t[k] >= t[seen[0]] - 0.3);
    const after: number[] = [];
    for (let k = j; k < n && t[k] < t[j] + 1.5; k++) if (on[k]) after.push(k);
    if (!before.length || !after.length) continue;
    for (let slot = 0; slot < 4; slot++) {
      const full = before.filter((k) => samples[k].ready[slot] > ON).length / before.length;
      const later = Math.max(...after.map((k) => samples[k].ready[slot]));
      if (full > 0.5 && later < 0.3) steps.push({ t: t[i], input: 'ultimate', slot: slot as Slot });
    }
  }

  let lastOn = n - 1;
  while (!on[lastOn]) lastOn--;
  // SP: a drop is a battle skill, a step up a Final Strike (or a Finisher). Not a Final Strike: SP coming back from
  // a battle skill (a step 0.4 s after it), a second step sooner than a basic attack chain takes, or a small step
  // (another source of SP: under REFUND of the usual Final Strike's).
  let lastDrop = -Infinity;
  let lastGain = -Infinity;
  const gains: { step: Step; gain: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (!on[i]) continue;
    let hi = -1;
    let lo = Infinity;
    // The last 0.12 s, and at least the frame before (frames seen far apart when the video plays fast).
    for (let k = i - 1; k >= 0 && (t[k] > t[i] - 0.12 || (hi < 0 && t[k] > t[i] - 0.3)); k--)
      if (on[k]) {
        hi = Math.max(hi, samples[k].sp);
        lo = Math.min(lo, samples[k].sp);
      }
    if (hi < 0) continue;
    const sp = samples[i].sp;
    // Not a battle skill: the bar emptied as the fight ends (the HUD goes for good just after).
    const ends = (sp < 5 && hi - sp > 150) || t[i] > t[lastOn] - 0.5;
    if (hi - sp >= DROP && !ends && t[i] - lastDrop > 0.3 && staysDown(samples, on, i, hi)) {
      lastDrop = t[i];
      const caster = phone ? buttonOf(samples, t[i]) : casterOf(samples, i);
      const back = spBack(samples, on, i);
      steps.push({ t: t[i], input: 'battle', ...caster, ...(back ? { spBack: true, back } : {}) });
    } else if (sp - lo >= GAIN && sp - level(samples, on, i) >= GAIN && t[i] - lastGain > CHAIN && t[i] - lastDrop > SP_BACK && !gapEnds.some((e) => t[i] - e >= 0 && t[i] - e < 0.6) && holds(samples, on, i)) {
      lastGain = t[i];
      // How much it rose: from just before, or from the level before if the bar blinked in between.
      const gain = Math.min(sp - lo, sp - level(samples, on, i));
      gains.push({ step: { t: t[i], input: gain >= FINISHER ? 'finisher' : 'strike', slot: null }, gain });
    }
  }
  const usual = median(gains.filter((g) => g.step.input === 'strike').map((g) => g.gain));
  steps.push(...gains.filter((g) => g.step.input === 'finisher' || g.gain >= usual * REFUND).map((g) => g.step));

  const combo = combos(samples, on, layout.bannerOn, !phone);
  steps.push(...combo.steps);
  interrupts(samples, steps);
  const guard = guards(samples, steps);
  let end = n - 1;
  while (!on[end]) end--;
  const reading: Reading = { steps: steps.sort((a, b) => a.t - b.t), start: t[first], end: t[end], arts: combo.arts };
  if (guard.length) reading.guards = guard;
  const bars = bossBars(samples);
  if (bars.length) reading.boss = bars;
  const c = clockOf(samples, on, gaps, clock, t[first]);
  if (c) reading.clock = c;
  // The phase change's black screen stops the stopwatch: when its digits weren't read at all, a HUD-hidden stretch
  // longer than any cut-in (PHASE) is that pause, and the length the span less it. (Read digits know better: a phone
  // recording hides the HUD that long with the stopwatch running.)
  const black = gaps.filter(([i, j]) => i > first && j < n && t[j] - t[i] >= PHASE).map(([i, j]) => [t[i], t[j]] as [number, number]);
  if (!c && black.length) reading.clock = { end: t[end], seconds: Math.round(t[end] - t[first] - black.reduce((a, [x, y]) => a + (y - x), 0)), pauses: black };
  return reading;
}

/**
 * Interrupts: the boss's Stagger meter rising by INTERRUPTED (of its 320) within 0.3 s, a battle skill or combo
 * pressed near it (a battle skill up to 1.4 s before, Yvonne's bomb flying; a combo, which lands at once, 0.8 s; or
 * 0.4 s after, as a battle skill's SP drop can show after its hit) and no Final Strike near
 * it. A skill alone gives 15 or less (a Final Strike 17); one that cancels the boss's attack adds his interrupt's 20
 * (the owner's Alleikhreos video: +30 for Yvonne's bomb and Tangtang's shot, sometimes split into +17 and a few).
 */
const INTERRUPTED = 16 / 320;
export function interrupts(samples: Sample[], steps: Step[]): void {
  const m = samples.filter((x) => x.stagger !== undefined && !x.staggered);
  if (m.length < 5) return;
  // A median of five, against a frame where effects cover the bar.
  const v = m.map((_, i) => median(m.slice(Math.max(0, i - 2), i + 3).map((x) => x.stagger!)));
  const strikes = steps.filter((x) => x.input === 'strike' || x.input === 'finisher').map((x) => x.t);
  for (let i = 0; i < m.length; i++) {
    let j = i;
    while (j + 1 < m.length && m[j + 1].t <= m[i].t + 0.3) j++;
    if (v[j] - v[i] < INTERRUPTED) continue;
    const at = m[j].t;
    i = j;
    if (strikes.some((x) => Math.abs(x - at) < 0.5)) continue;
    const near = steps.filter((x) => (x.input === 'battle' || x.input === 'combo') && x.t <= at + 0.4 && x.t >= at - (x.input === 'combo' ? 0.8 : 1.4));
    const by = near.sort((a, b) => Math.abs(a.t - (at - 0.4)) - Math.abs(b.t - (at - 0.4)))[0];
    if (by) by.interrupt = true;
  }
}

/** How often the boss's bars are kept (seconds). */
const BOSS_EVERY = 0.25;
/**
 * The boss's bars over the fight, for comparing a replay with the video: each BOSS_EVERY seconds the median of the
 * frames around it (effects flash over the bars), HP never rising within a stretch the HUD shows (a phase change
 * refills it), the meter -1 while Staggered.
 */
function bossBars(samples: Sample[]): [number, number, number][] {
  const seen = samples.filter((x) => x.bossHp !== undefined && x.stagger !== undefined);
  if (seen.length < 20) return [];
  const out: [number, number, number][] = [];
  let low = 1;
  let lastT = -Infinity;
  for (let t = seen[0].t; t <= seen[seen.length - 1].t; t += BOSS_EVERY) {
    const near = seen.filter((x) => Math.abs(x.t - t) <= BOSS_EVERY);
    if (near.length < 2) continue;
    // A refill (a new phase) after the HUD was away.
    const hp = median(near.map((x) => x.bossHp!));
    if (t - lastT > 2 && hp > low + 0.3) low = 1;
    low = Math.min(low, hp);
    lastT = t;
    const yellow = near.filter((x) => x.staggered).length > near.length / 2;
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    out.push([r3(t), r3(low), yellow ? -1 : r3(median(near.map((x) => x.stagger!)))]);
  }
  return out;
}

/** The boss's Stagger meter while not Staggered, a median of five against a frame where effects cover it. */
function meterOf(samples: Sample[]): { t: number; v: number }[] {
  const m = samples.filter((x) => x.stagger !== undefined && !x.staggered);
  return m.map((x, i) => ({ t: x.t, v: median(m.slice(Math.max(0, i - 2), i + 3).map((y) => y.stagger!)) }));
}

/**
 * After the boss's meter passes its node (half), a stretch it takes no Stagger (Alleikhreos's Foundite Weapon, its
 * timing his AI's): from the meter's last rise within 6 s of the node to its next, at least 4 s on with a press or
 * Final Strike landing in between (the owner's video: 0:23.5–0:29.7 and 1:47.3–1:53.6 on the stopwatch).
 */
export function guards(samples: Sample[], steps: Step[]): [number, number][] {
  const m = meterOf(samples);
  const rises: { t: number; before: number; after: number }[] = [];
  for (let i = 0; i < m.length; i++) {
    let j = i;
    while (j + 1 < m.length && m[j + 1].t <= m[i].t + 0.3) j++;
    if (m[j].v - m[i].v >= 3 / 320) {
      rises.push({ t: m[j].t, before: m[i].v, after: m[j].v });
      i = j;
    }
  }
  const out: [number, number][] = [];
  // Where the meter reaches its node (it may creep over in small steps).
  const nodes = m.filter((x, i) => i > 0 && m[i - 1].v < 0.5 && x.v >= 0.5).map((x) => x.t);
  for (const node of nodes) {
    const k = rises.findIndex((r) => r.t >= node - 0.3);
    if (k < 0) continue;
    for (let a = k; a + 1 < rises.length && rises[a].t - node <= 6; a++) {
      const from = rises[a].t;
      const to = rises[a + 1].t;
      if (to - from >= 4 && steps.some((x) => x.input !== 'ultimate' && x.t > from + 0.3 && x.t < to - 0.3)) {
        // Inside its edges by 0.3 s: smoothing blurs a rise, and a hit landing right at an edge may count.
        out.push([from + 0.3, to - 0.3]);
        break;
      }
    }
  }
  return out;
}

/** How much the stopwatch's digits differ between two samples (a pixel or two per column is the video's noise). */
const changed = (a: Sample, b: Sample) => a.clock!.reduce((d, v, x) => d + Math.max(0, Math.abs(v - (b.clock![x] ?? 0)) - 2), 0);

/** The sample nearest time x (samples in time order). */
function nearest(samples: Sample[], x: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(samples[lo - 1].t - x) < Math.abs(samples[lo].t - x) ? lo - 1 : lo;
}

interface Stretch {
  /** The stopwatch's ticks: every beat of its second while the HUD shows (times into the video). */
  ticks: number[];
  /** How much its digits changed at each tick. */
  change: number[];
}

/**
 * The stopwatch's ticks in each stretch the HUD shows. Its digits change once a second; effects behind them change
 * them too, and a change can spread over a few frames. So the ticks are found as a beat: the phase where the changes
 * line up once a second best, every beat of it a tick.
 */
function stretches(samples: Sample[], on: boolean[]): Stretch[] {
  const t = samples.map((s) => s.t);
  const lit = (k: number) => (samples[k].clock ?? []).reduce((a, b) => a + b, 0) > 20;
  // The HUD's stretches, from 0.5 s after it comes back.
  const spans: [number, number][] = [];
  for (let k = 0; k < samples.length; ) {
    if (!on[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < samples.length && on[j]) j++;
    if (t[j - 1] - t[k] > 1.5) spans.push([t[k] + (k ? 0.5 : 0), t[j - 1]]);
    k = j;
  }
  // How much the digits changed across a moment.
  const change = (x: number) => {
    const a = nearest(samples, x - 0.08);
    const b = nearest(samples, x + 0.12);
    return on[a] && on[b] && lit(a) && lit(b) ? changed(samples[a], samples[b]) : 0;
  };
  return spans.flatMap(([from, to]) => {
    const score = Array.from({ length: 50 }, (_, i) => {
      let sum = 0;
      for (let x = Math.ceil(from - i / 50) + i / 50; x <= to; x++) sum += Math.min(60, change(x));
      return sum;
    });
    // Every phase whose window holds the change scores alike: the middle of them, where the window's middle is.
    const top = score.indexOf(Math.max(...score));
    let lo = 0;
    let hi = 0;
    while (lo < 24 && score[(top - lo - 1 + 50) % 50] >= score[top] * 0.95) lo++;
    while (hi < 24 && score[(top + hi + 1) % 50] >= score[top] * 0.95) hi++;
    const phase = ((((top + (hi - lo) / 2) / 50 + 0.02) % 1) + 1) % 1;
    const ticks: number[] = [];
    for (let x = Math.ceil(from - phase) + phase; x <= to; x++) ticks.push(x);
    const changes = ticks.map(change);
    // A stretch where the digits never clearly change on the beat says nothing.
    return changes.filter((c) => c > 25).length >= 2 ? [{ ticks, change: changes }] : [];
  });
}

/**
 * When to read the stopwatch's digits (seconds into the video): half a second after the second, middle and last
 * tick of each stretch, when they hold still (at a tick a frame may still show the second before), and the last
 * moment the HUD shows (what it stopped at).
 */
export function clockAnchors(samples: Sample[]): number[] {
  const { on } = shown(samples);
  const out = stretches(samples, on).flatMap(({ ticks: x }) => [...new Set([x[Math.min(1, x.length - 1)], x[Math.floor(x.length / 2)], x[x.length - 2] ?? x[0]])].map((v) => v + SETTLE));
  const last = on.lastIndexOf(true);
  if (last >= 0) out.push(samples[last].t);
  return out;
}

/** The boss's name from a few readings of it: the one read most often (stray marks dropped), if any. */
export function enemyName(texts: string[]): string | undefined {
  const names = texts
    .map((x) => x.replace(/\s*\.\s+/g, ', ').replace(/[^A-Za-z ,'\-]/g, ' ').replace(/\s+/g, ' ').replace(/^[ ,'-]+|[ ,'-]+$/g, '').replace(/\b[a-z]\b ?/g, '').trim())
    .filter((x) => /[A-Za-z]{3}/.test(x));
  const count = new Map<string, number>();
  for (const x of names) count.set(x, (count.get(x) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
}

/** "01:05" as seconds, or null. */
function clockSeconds(text: string): number | null {
  const m = /(\d{1,2})\s*[:.;]?\s*(\d{2})(?!\d)/.exec(text.replace(/[oO]/g, '0'));
  return m && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clockOf(samples: Sample[], on: boolean[], gaps: [number, number][], readings: ClockReading[], start: number): Reading['clock'] {
  const runs = stretches(samples, on);
  if (!runs.length || !readings.length) return undefined;
  const within = (x: ClockReading, r: number[]) => x.t >= r[0] && x.t <= r[r.length - 1] + 2 * SETTLE;
  // Up, or down (a timed stage): which way its readings go within a stretch.
  let down = 0;
  for (const { ticks: r } of runs) {
    const read = readings.filter((x) => within(x, r)).map((x) => ({ t: x.t, g: clockSeconds(x.text) })).filter((x) => x.g !== null);
    if (read.length >= 2) down += Math.sign(read[0].g! - read[read.length - 1].g!);
  }
  const dir = down > 0 ? -1 : 1;
  // Each stretch's time at its first tick, by vote of its readings (each tick is one more second, or one less).
  const zero = runs.map(({ ticks: r }) => {
    const votes = new Map<number, number>();
    for (const x of readings) {
      const g = clockSeconds(x.text);
      if (g === null || !within(x, r)) continue;
      const g0 = g - dir * Math.round(x.t - SETTLE - r[0]);
      // A clean "00:00" counts twice: a misread usually loses its colon or a digit.
      votes.set(g0, (votes.get(g0) ?? 0) + (/^\d\d:\d\d$/.test(x.text.trim()) ? 2 : 1));
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  });
  const t = samples.map((s) => s.t);
  const pauses: [number, number][] = [];
  let prev = -1;
  let first = -1;
  runs.forEach(({ ticks: r }, k) => {
    if (zero[k] === null) return;
    if (first < 0) first = k;
    if (prev >= 0) {
      const p = runs[prev].ticks;
      const a = p[p.length - 1];
      const ga = zero[prev]! + dir * Math.round(a - p[0]);
      // Time that went by between the two ticks, less what the stopwatch counted: it stood still. Ultimates' cut-ins
      // don't stop it, and a tick found a frame off is no pause.
      const still = r[0] - a - dir * (zero[k]! - ga);
      if (still >= PAUSE) {
        // From where the HUD went away for longest between the two ticks.
        const hidden = gaps.filter(([i, j]) => t[i] > a && t[i] < r[0] && j < t.length).sort(([i1, j1], [i2, j2]) => t[j2] - t[i2] - (t[j1] - t[i1]))[0];
        const from = hidden ? t[hidden[0]] : a;
        pauses.push([from, from + still]);
      }
    }
    prev = k;
  });
  if (prev < 0) return undefined;
  const last = runs[prev].ticks;
  const g = (x: number) => zero[prev]! + dir * Math.round(x - last[0]);
  // The fight's length: how far it moved from what it showed when the HUD first did.
  const atStart = zero[first]! - dir * Math.round(runs[first].ticks[0] - start);
  const length = (v: number) => dir * (v - atStart);
  // Where it stopped: the tick at what it shows at the last moment the HUD does, else the last tick it changed at.
  const [lo, hi] = [g(last[0]), g(last[last.length - 1])].sort((x, y) => x - y);
  const final = readings
    .filter((x) => x.t > last[last.length - 1])
    .map((x) => clockSeconds(x.text))
    .find((v): v is number => v !== null && v >= lo && v <= hi);
  if (final !== undefined) return { end: last[0] + dir * (final - zero[prev]!), seconds: length(final), pauses };
  // While it runs, every tick changes it; a lone change after a still tick is the HUD fading out (the owner's
  // ef-alleikhreos.mp4: its 2:21 read as 2:23 that way).
  const ch = runs[prev].change;
  const moved = last.filter((_, i) => ch[i] > 25 && (i === 0 || ch[i - 1] > 25));
  const end = moved[moved.length - 1] ?? last[0];
  return { end, seconds: length(g(end)), pauses };
}

/**
 * SP coming back after the battle skill whose drop is sample i: SP_BACK_GAIN more at SP_BACK after it than just after
 * the drop, and still there (the bar's own refill is about 6 a second; a flicker doesn't stay). Later rises can be
 * the controlled operator's Final Strike.
 */
function spBack(samples: Sample[], on: boolean[], i: number): number {
  const t = samples[i].t;
  let low = samples[i].sp;
  let end = -1;
  let endAt = t;
  let high = -1;
  for (let k = i + 1; k < samples.length && samples[k].t <= t + SP_BACK; k++) {
    if (!on[k]) continue;
    if (samples[k].t <= t + 0.15) low = Math.min(low, samples[k].sp);
    else {
      high = Math.max(high, samples[k].sp);
      end = samples[k].sp;
      endAt = samples[k].t;
    }
  }
  if (!(end - low >= SP_BACK_GAIN && high - end < 5)) return 0;
  // Less the bar's own 8 SP a second.
  return Math.max(0, Math.round(end - low - 8 * (endAt - t)));
}

/** SP over the half second before sample i (its middle value: a frame the bar blinks doesn't count). */
function level(samples: Sample[], on: boolean[], i: number): number {
  const t = samples[i].t;
  const sp: number[] = [];
  for (let k = i - 1; k >= 0 && samples[k].t >= t - 0.6; k--) if (on[k] && samples[k].t < t - 0.05) sp.push(samples[k].sp);
  return sp.length ? median(sp) : -Infinity;
}

/**
 * An SP drop that stays: on the next frames, and most of the next moment (the bar can blink empty for a frame, or
 * back full for a frame or two after a real drop).
 */
function staysDown(samples: Sample[], on: boolean[], i: number, before: number): boolean {
  const t = samples[i].t;
  const dip = samples[i].sp;
  let up = 0;
  let n = 0;
  for (let k = i + 1; k < samples.length && samples[k].t <= t + 0.4; k++) {
    if (!on[k]) continue;
    if (samples[k].t < t + 0.1 && samples[k].sp > dip + DROP) return false;
    if (samples[k].t >= t + 0.1) {
      n++;
      if (samples[k].sp > before - DROP / 2) up++;
    }
  }
  return up * 2 < n || n === 0;
}

/** An SP step that stays (the bar refilling at the end of a fight keeps climbing). */
function holds(samples: Sample[], on: boolean[], i: number): boolean {
  const t = samples[i].t;
  let max = -1;
  for (let k = i + 1; k < samples.length && samples[k].t < t + 0.35; k++) if (on[k] && samples[k].t > t + 0.15) max = Math.max(max, samples[k].sp);
  return max >= 0 && max - samples[i].sp < 5;
}

const wheelOpen = (s: Sample) => s.wheel.filter((w) => w > 0.08).length >= 3;

/**
 * Who used the battle skill whose SP drop is sample i: the button pressed in
 * the skill wheel. It flashes white, or it stays lit after the others dim
 * (they dim when SP falls below their cost, or as the wheel closes). No
 * wheel seen (not the controller layout): unknown.
 */
/**
 * The phone's skill button that lit up between from and to (seconds into the video): of those whose lit share rose
 * PRESSED above their own before, the one that lit up last (a press flashes as it happens; a button can also glow a
 * while). `others`: how many more rose.
 */
function pressed(samples: Sample[], from: number, to: number): { slot: Slot; others: number } | null {
  const before = samples.filter((x) => x.t >= from - 0.9 && x.t < from - 0.05 && x.hud > ON);
  const during = samples.filter((x) => x.t >= from && x.t <= to);
  if (!during.length) return null;
  const lit = [0, 1, 2, 3].flatMap((k) => {
    const base = median(before.map((x) => x.wheel[k]));
    const first = during.find((x) => x.wheel[k] - base >= PRESSED);
    return first ? [{ slot: k as Slot, at: first.t }] : [];
  });
  if (!lit.length) return null;
  const last = lit.reduce((a, b) => (b.at > a.at ? b : a));
  return { slot: last.slot, others: lit.length - 1 };
}

/** Who used the battle skill whose SP drops at t, on the phone: the skill button that lit up as it was pressed. */
function buttonOf(samples: Sample[], t: number): { slot: Slot | null; unsure?: boolean } {
  const lit = pressed(samples, t - 0.35, t + 0.12);
  if (!lit) return { slot: null };
  return lit.others ? { slot: lit.slot, unsure: true } : { slot: lit.slot };
}

function casterOf(samples: Sample[], i: number): { slot: Slot | null; unsure?: boolean } {
  const t = samples[i].t;
  const open: Sample[] = [];
  for (let k = i - 1; k >= 0 && samples[k].t >= t - 0.8; k--) if (wheelOpen(samples[k])) open.push(samples[k]);
  if (!open.length) return { slot: null };
  const base = [0, 1, 2, 3].map((s) => median(open.filter((x) => x.t < t - 0.03).map((x) => x.wheel[s])));
  // The flash shows on the frame SP drops, or one or two after it.
  for (let k = i; k >= 0 && samples[k].t >= t - 0.04; k--) {
    const flash = samples[k].wheel.findIndex((w, s) => w > base[s] + 0.25);
    if (flash >= 0) return { slot: flash as Slot };
  }
  for (let k = i + 1; k < samples.length && samples[k].t <= t + 0.12; k++) {
    const flash = samples[k].wheel.findIndex((w, s) => w > base[s] + 0.25);
    if (flash >= 0) return { slot: flash as Slot };
  }
  let lit: number[] = [];
  for (let k = i; k < samples.length && samples[k].t <= t + 0.25; k++) {
    const now = [0, 1, 2, 3].filter((s) => samples[k].wheel[s] > 0.02);
    if (now.length === 1) return { slot: now[0] as Slot, unsure: true };
    if (!now.length) break;
    lit = now;
  }
  return { slot: null, unsure: lit.length > 0 };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function corr(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb + 1e-9);
}

/** Same art: banners of one operator. */
const SAME_ART = 0.8;
/** Between two frames' art below this, and still below it a few frames on: a new banner. */
const JUMP = 0.5;
/** Steady art this long (seconds) before a jump counts as a new banner. */
const STEADY = 0.1;


/**
 * Combos: banner stretches (a gap under 0.6 s is the same banner), cut where the art jumps (a new banner slides in
 * over the last one; the art itself only pans), grouped by art: each group one operator.
 */
function combos(samples: Sample[], on: boolean[], bannerOn: number, solid: boolean): { steps: Step[]; arts: number[][] } {
  const n = samples.length;
  const t = samples.map((s) => s.t);
  const runs: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (!(on[i] && samples[i].banner > bannerOn)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && on[j] && samples[j].banner > bannerOn) j++;
    // On the controller, from the first frames its art shows: a banner cut short by the next may never show clearly
    // (Tangtang's before Arcane's at 0:57 in the owner's video).
    // Across a dip of a frame or two (one banner giving way to the next).
    if (solid)
      for (let k = i - 1, dip = 0; k >= (runs.length ? runs[runs.length - 1][1] : 0) && on[k]; k--) {
        if (samples[k].art) {
          i = k;
          dip = 0;
        } else if (++dip > 2) break;
      }
    const last = runs[runs.length - 1];
    if (last && t[i] - t[last[1] - 1] <= 0.6) last[1] = j;
    else runs.push([i, j]);
    i = j;
  }
  // Each banner: from where it starts, its frames' art. A jump that stays (not one flash), once the art has held
  // steady, starts a new banner (a banner's own first frames, sliding in, are unsteady).
  const banners: { from: number; arts: Sample[] }[] = [];
  for (const [i, j] of runs) {
    if (t[j - 1] - t[i] < 0.15) continue;
    const arts = samples.slice(i, j).filter((s) => s.art);
    if (!arts.length) continue;
    // A frame between two arts with no banner showing (one fading as the next slides in).
    const dipped = (a: Sample, b: Sample) => samples.slice(i, j).some((s) => s.t > a.t && s.t < b.t && !s.art);
    const parts = [{ from: t[i], arts: [arts[0]] }];
    let steadySince = -1;
    let settled = false;
    for (let k = 1; k < arts.length; k++) {
      const step = corr(arts[k - 1].art!, arts[k].art!);
      const after = arts[Math.min(k + 3, arts.length - 1)];
      // Frames without a banner between: its edges blurred while one replaced another.
      const gap = arts[k].t - arts[k - 1].t > 0.2;
      // Or, without time to settle, a dip between two different arts: a banner cut short by the next (the owner's
      // video: Tangtang's combo for 0.1 s, then Arcane's at once). Not on the phone, whose see-through banner dips
      // as it slides in.
      const cut = solid && !settled && step < JUMP && corr(arts[k - 1].art!, after.art!) < JUMP && dipped(arts[k - 1], arts[k]) && arts[k - 1].t - parts[parts.length - 1].from >= 0.05;
      if (cut || (settled && ((step < JUMP && corr(arts[k - 1].art!, after.art!) < JUMP) || (gap && step < 0.6))) || (gap && step < 0.45 && corr(arts[k - 1].art!, after.art!) < JUMP && arts[k - 1].t - parts[parts.length - 1].from >= 0.25)) {
        parts.push({ from: arts[k].t, arts: [] });
        steadySince = -1;
        settled = false;
      } else if (step >= 0.75) {
        if (steadySince < 0) steadySince = arts[k - 1].t;
        settled ||= arts[k].t - steadySince >= STEADY - 1e-6;
      } else steadySince = -1;
      parts[parts.length - 1].arts.push(arts[k]);
    }
    // A banner starting part-way that doesn't stay (until the next one, or the stretch's end) is the last one sliding out.
    for (let k = parts.length - 1; k > 0; k--) {
      const until = parts[k + 1]?.from ?? parts[k].arts[parts[k].arts.length - 1].t;
      if (until - parts[k].from < 0.3) parts[k - 1].arts.push(...parts.splice(k, 1)[0].arts);
    }
    banners.push(...parts);
  }
  // A banner's art: its frames at the same moment of its animation (it slides in, then pans), cell by cell.
  const artOf = (b: (typeof banners)[number]) => {
    const at = (from: number, to: number) => b.arts.filter((x) => x.t >= b.from + from && x.t <= b.from + to);
    const p = [at(0.35, 0.75), at(0.2, 9), b.arts].find((x) => x.length)!;
    return p[0].art!.map((_, c) => median(p.map((x) => x.art![c])));
  };
  // How alike two banners are: their frames at the same moments of the animation, as alike as they get with one
  // started a little earlier (a banner's start is seen a frame or two late).
  const alike = (a: (typeof banners)[number], b: (typeof banners)[number], from = 0.1, least = 3) => {
    let best = -1;
    for (let shift = -0.3; shift <= 0.3; shift += 0.05) {
      const pairs: number[] = [];
      for (const x of a.arts) {
        const tau = x.t - a.from;
        if (tau < from || tau > 1) continue;
        const y = b.arts.reduce((m, z) => (Math.abs(z.t - b.from - tau - shift) < Math.abs(m.t - b.from - tau - shift) ? z : m));
        if (Math.abs(y.t - b.from - tau - shift) <= 0.05) pairs.push(corr(x.art!, y.art!));
      }
      if (pairs.length >= least) best = Math.max(best, median(pairs));
    }
    return best;
  };
  // Groups: banners alike are one operator's (a banner cut short is compared on what it showed).
  // A banner cut short (the next one right after it) shows only its slide-in, which looks like the next one's coming
  // in: it's compared only with other banners cut short, on those first frames.
  const short = banners.map((b, i) => b.arts[b.arts.length - 1].t - b.from < 0.2 && !!banners[i + 1] && banners[i + 1].from - b.arts[b.arts.length - 1].t < 0.15);
  const parent = banners.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < banners.length; i++)
    for (let j = 0; j < i; j++) {
      if (root(i) === root(j) || short[i] !== short[j]) continue;
      const how = short[i] ? Math.max(alike(banners[i], banners[j], 0, 2), alike(banners[j], banners[i], 0, 2)) : Math.max(alike(banners[i], banners[j]), alike(banners[j], banners[i]));
      if (how >= SAME_ART) parent[root(i)] = root(j);
    }
  // Groups numbered in order of first appearance.
  const order: number[] = [];
  banners.forEach((_, i) => {
    if (!order.includes(root(i))) order.push(root(i));
  });
  return {
    steps: banners.map((b, i) => ({ t: b.from, input: 'combo', slot: null, group: order.indexOf(root(i)) })),
    arts: order.map((i) => artOf(banners[i])),
  };
}

