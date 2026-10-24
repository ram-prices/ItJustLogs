import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import fixture from './rotationReader.samples.json';
import phoneFixture from './rotationReader.mobile.json';
import { clockAnchors, enemyName, measure, MOBILE, readRotation, SLOTS, type Px, type Sample } from './rotationReader';

// A real recording (ef-alleikhreos.mp4: 2560×1600, Crisis Calamity, controller layout) as Chrome measured it with
// ui/rotationReader.ts, 30 frames a second: per sample its time in ms, SP × 0.85, then × 255 the HUD, banner,
// Ultimate dots and wheel icons, and the banner's art when one shows. What happens when was checked frame by frame
// against the video. The stopwatch's column profiles were read from the same frames with OpenCV.
const f = fixture as { data: string; clock: string; strips: { t: number; centre: string; sp: number; hud: number }[] };
const bytes = inflateSync(Buffer.from(f.data, 'base64'));
const samples: Sample[] = [];
for (let k = 0; k < bytes.length; ) {
  const b = bytes.subarray(k + 4, k + 16);
  const s: Sample = {
    t: bytes.readUInt32LE(k) / 1000,
    sp: b[0] / 0.85,
    hud: b[1] / 255,
    banner: b[2] / 255,
    ready: [...b.subarray(3, 7)].map((x) => x / 255),
    wheel: [...b.subarray(7, 11)].map((x) => x / 255),
  };
  k += 16;
  if (b[11]) {
    s.art = [...bytes.subarray(k, k + 648)];
    k += 648;
  }
  samples.push(s);
}
const clock = inflateSync(Buffer.from(f.clock, 'base64'));
samples.forEach((s, k) => (s.clock = [...clock.subarray(k * 88, k * 88 + 88)]));
// What the stopwatch shows at a moment, checked on the frames: it reads 00:08 at 9.2 s and 01:04 at 65.0 s (ticking at
// .81 s), stands still through the phase change, and reads 01:35 at 100.8 s and 02:21 from 146.47 s on (ticking at
// .48 s), where it stays. Text recognition gives these words.
const shows = (t: number) => {
  const g = Math.min(141, Math.floor(t - (t < 66 ? 0.81 : 5.48) + 0.02));
  return `${String(Math.floor(g / 60)).padStart(2, '0')}:${String(g % 60).padStart(2, '0')}`;
};
const anchors = clockAnchors(samples);
const reading = readRotation(
  samples,
  anchors.map((t) => ({ t, text: shows(t) })),
);
const of = (input: string) => reading.steps.filter((s) => s.input === input);
const near = (a: number, b: number, tol = 0.1) => Math.abs(a - b) <= tol;
const slot = (name: (typeof SLOTS)[number]) => SLOTS.indexOf(name);

describe('rotation reader', () => {
  it('measures SP and the HUD from the bar under the HP', () => {
    for (const s of f.strips) {
      const px: Px = { data: new Uint8ClampedArray(inflateSync(Buffer.from(s.centre, 'base64'))), width: 300, height: 32 };
      const empty: Px = { data: new Uint8ClampedArray(312 * 280 * 4), width: 312, height: 280 };
      const banner: Px = { data: new Uint8ClampedArray(340 * 155 * 4), width: 340, height: 155 };
      const m = measure(s.t, empty, px, banner);
      expect(m.sp).toBeCloseTo(s.sp, 1);
      expect(m.hud).toBeCloseTo(s.hud, 2);
    }
  });

  it('finds the fight on screen', () => {
    expect(near(reading.start!, 0.55)).toBe(true);
    expect(reading.end! > 149).toBe(true);
  });

  it("reads every ultimate and whose it was from the dot that emptied", () => {
    const want: [number, (typeof SLOTS)[number]][] = [
      [9.32, 'Bottom'],
      [21.06, 'Bottom'],
      [32.67, 'Right'],
      [41.37, 'Top'],
      [52.96, 'Left'],
      [99.0, 'Bottom'],
      [111.09, 'Bottom'],
      [124.58, 'Right'],
      [127.61, 'Top'],
      [138.3, 'Left'],
    ];
    const got = of('ultimate');
    expect(got.length).toBe(want.length);
    want.forEach(([t, s], i) => {
      expect(near(got[i].t, t)).toBe(true);
      expect(got[i].slot).toBe(slot(s));
    });
  });

  it('reads every battle skill from the SP bar', () => {
    const want = [3.64, 5.19, 15.89, 26.61, 36.5, 45.35, 56.78, 73.27, 84.69, 85.72, 102.35, 106.87, 118.24, 121.32, 134.7];
    const got = of('battle');
    expect(got.map((s) => s.t)).toHaveLength(want.length);
    want.forEach((t, i) => expect(near(got[i].t, t)).toBe(true));
  });

  it('tells who used a battle skill when the wheel button flashes', () => {
    // The left operator's presses at 45.4 s and 102.4 s light their icon up white.
    for (const t of [45.35, 102.35]) {
      const s = of('battle').find((x) => near(x.t, t))!;
      expect(s.slot).toBe(slot('Left'));
      expect(s.unsure).toBeFalsy();
    }
  });

  it('reads Final Strikes as SP steps, not the bar refilling after a cut-in or at the end', () => {
    const got = of('strike');
    expect(got.length).toBeGreaterThanOrEqual(14);
    expect(got.length).toBeLessThanOrEqual(18);
    expect(got.some((s) => near(s.t, 7.35))).toBe(true);
    // Before Yvonne's combo at 18.8 s, which only a Final Strike starts.
    expect(got.some((s) => near(s.t, 18.1))).toBe(true);
    expect(got.some((s) => near(s.t, 137.9))).toBe(true);
    expect(got.every((s) => s.t < 149)).toBe(true);
    expect(of('finisher')).toHaveLength(0);
  });

  it('marks the battle skills SP came back after', () => {
    const back = of('battle').filter((s) => s.spBack).map((s) => s.t);
    const want = [26.61, 36.5, 73.27, 84.69, 106.87, 118.24, 121.32];
    expect(back).toHaveLength(want.length);
    want.forEach((t, i) => expect(near(back[i], t)).toBe(true));
    // The left operator's flashed presses gave none back.
    for (const t of [45.35, 102.35]) expect(of('battle').find((s) => near(s.t, t))!.spBack).toBeFalsy();
  });

  it('leaves out SP that comes back from a battle skill, and small steps from other sources', () => {
    const got = of('strike');
    // +21 SP 0.4 s after each of these battle skills.
    for (const t of [27.02, 36.92, 73.62, 85.05, 107.22, 118.58]) expect(got.some((s) => near(s.t, t, 0.15))).toBe(false);
    // +8 and +9 SP while the usual Final Strike gives about 20.
    for (const t of [92.08, 94.38, 96.45]) expect(got.some((s) => near(s.t, t, 0.15))).toBe(false);
  });

  it('times the fight by the stopwatch: its end, and the phase change it stood still for', () => {
    expect(anchors.length).toBeLessThanOrEqual(45);
    const c = reading.clock!;
    expect(c.seconds).toBe(141);
    expect(near(c.end, 146.47)).toBe(true);
    expect(c.pauses).toHaveLength(1);
    const [from, to] = c.pauses[0];
    expect(near(from, 65.87, 0.15)).toBe(true);
    expect(near(to - from, 4.67, 0.15)).toBe(true);
  });

  it('reads each combo banner and groups them by art, one group per operator', () => {
    // Checked by eye: the four operators' banners.
    const want: [number, (typeof SLOTS)[number]][] = [
      [7.57, 'Bottom'],
      [15.31, 'Right'],
      [18.79, 'Left'],
      [30.0, 'Top'],
      [30.5, 'Bottom'],
      [47.87, 'Left'],
      [58.23, 'Bottom'],
      [75.04, 'Top'],
      [87.19, 'Bottom'],
      [90.08, 'Top'],
      [97.08, 'Right'],
      [104.9, 'Left'],
      [108.77, 'Bottom'],
      [122.89, 'Top'],
      [135.61, 'Bottom'],
      [136.9, 'Top'],
      [141.08, 'Left'],
    ];
    const got = of('combo');
    expect(got).toHaveLength(want.length);
    want.forEach(([t], i) => expect(near(got[i].t, t, 0.25)).toBe(true));
    // The same operator, the same group; different operators, different groups.
    const groupOf = new Map<string, number>();
    want.forEach(([, s], i) => {
      if (!groupOf.has(s)) groupOf.set(s, got[i].group!);
      expect(got[i].group).toBe(groupOf.get(s));
    });
    expect(new Set(groupOf.values()).size).toBe(4);
  });

  it('outvotes a misread of the stopwatch in each stretch', () => {
    // Misreads text recognition made on this video: "0005" for 00:08, "0:" for 00:11.
    const bad = (t: number, k: number) => (k % 3 === 1 ? (k % 2 ? '0005' : '0:') : shows(t));
    const c = readRotation(
      samples,
      anchors.map((t, k) => ({ t, text: bad(t, k) })),
    ).clock!;
    expect(c.seconds).toBe(141);
    expect(c.pauses).toHaveLength(1);
  });

  it("keeps the boss's name read most often, without stray marks", () => {
    expect(enemyName(['Alleikhreos, Chiliarch', '| Alleikhreos, Chiliarch ~', 'Alleikhreos, Chiliarch', 'Alleikhre0s Chiliarch'])).toBe('Alleikhreos, Chiliarch');
    // As text recognition read it from the video: a full stop for the comma.
    expect(enemyName(['Alleikhreos. Chiliarch', 'Alleikhreos. Chiliarch »', 'Alleikhreos. Chiliarch'])).toBe('Alleikhreos, Chiliarch');
    expect(enemyName(['', '~ |'])).toBeUndefined();
  });
});

// The owner's own read of this video, playing it at double speed, saw fewer frames and some far apart: it merged the
// combos at 30.0 and 30.3 s, missed the battle skill at 84.7 s, ended the stopwatch early and found pauses at
// ultimates. Every other sample of the fixture (15 a second, either half) is harder still.
describe.each([0, 1])('rotation reader on every other frame (half %i)', (half) => {
  const few = samples.filter((_, k) => k % 2 === half);
  const r = readRotation(
    few,
    clockAnchors(few).map((t) => ({ t, text: shows(t) })),
  );
  const got = (input: string) => r.steps.filter((s) => s.input === input);

  it('still reads every battle skill and ultimate', () => {
    const battles = [3.64, 5.19, 15.89, 26.61, 36.5, 45.35, 56.78, 73.27, 84.69, 85.72, 102.35, 106.87, 118.24, 121.32, 134.7];
    expect(got('battle')).toHaveLength(battles.length);
    battles.forEach((t, i) => expect(near(got('battle')[i].t, t, 0.12)).toBe(true));
    expect(got('ultimate').map((s) => SLOTS[s.slot!])).toEqual(['Bottom', 'Bottom', 'Right', 'Top', 'Left', 'Bottom', 'Bottom', 'Right', 'Top', 'Left']);
    // The left operator's flash, a frame after the SP drops.
    const flash = got('battle').find((s) => near(s.t, 45.35, 0.12))!;
    expect([flash.slot, flash.unsure]).toEqual([slot('Left'), undefined]);
    expect(got('battle').filter((s) => s.spBack)).toHaveLength(7);
  });

  it('still splits the combos back to back and groups them by operator', () => {
    const who = ['Bottom', 'Right', 'Left', 'Top', 'Bottom', 'Left', 'Bottom', 'Top', 'Bottom', 'Top', 'Right', 'Left', 'Bottom', 'Top', 'Bottom', 'Top', 'Left'];
    const combos = got('combo');
    expect(combos).toHaveLength(who.length);
    const groupOf = new Map<string, number>();
    who.forEach((w, i) => {
      if (!groupOf.has(w)) groupOf.set(w, combos[i].group!);
      expect(combos[i].group).toBe(groupOf.get(w));
    });
    expect(new Set(groupOf.values()).size).toBe(4);
    expect(near(combos[3].t, 30.0, 0.15) && near(combos[4].t, 30.3, 0.25)).toBe(true);
  });

  it('still times the fight by the stopwatch, with no pauses at ultimates', () => {
    expect(r.clock!.seconds).toBe(141);
    expect(near(r.clock!.end, 146.47, 0.15)).toBe(true);
    expect(r.clock!.pauses).toHaveLength(1);
  });
});

// A phone recording (1560×720, Wall of Shields: Brutal), every frame measured with the phone HUD's areas at its own
// time (phone recordings have a variable frame rate), checked frame by frame against the video. Its skill buttons,
// upper right to lower: a crossed heart, a pinwheel, a zigzag, a lily.
describe('rotation reader on a phone recording', () => {
  const bytes = inflateSync(Buffer.from((phoneFixture as { data: string }).data, 'base64'));
  const phone: Sample[] = [];
  for (let k = 0; k < bytes.length; ) {
    const b = bytes.subarray(k + 4, k + 16);
    const s: Sample = { t: bytes.readUInt32LE(k) / 1000, sp: b[0] / 0.85, hud: b[1] / 255, banner: b[2] / 255, ready: [...b.subarray(3, 7)].map((x) => x / 255), wheel: [...b.subarray(7, 11)].map((x) => x / 255) };
    k += 16;
    if (b[11]) {
      s.art = [...bytes.subarray(k, k + 648)];
      k += 648;
    }
    s.clock = [...bytes.subarray(k, k + 140)];
    k += 140;
    phone.push(s);
  }
  // What text recognition read at each moment asked for, in the browser: the stopwatch counts down from 7:00 here;
  // before the fight and after it the spot shows something else.
  const read = ['1', '06:57', '06:26', '06:53', '06:40', '06:28', '06:22', '06:16', '06:11', '06:03', '', '4', ''];
  const asked = clockAnchors(phone);
  const r = readRotation(
    phone,
    asked.map((t, k) => ({ t, text: read[k] ?? '' })),
    MOBILE,
  );
  const got = (input: string) => r.steps.filter((s) => s.input === input);
  const button = (name: string) => MOBILE.slots.indexOf(name);

  it('reads the battle skills, and whose by the button that lit up', () => {
    const want: [number, string, boolean][] = [
      [17.52, 'Upper', false],
      [39.05, 'Upper', false],
      [44.46, 'Upper', false],
      // The lily glowed too; the crossed heart lit up as SP dropped.
      [57.13, 'Upper right', true],
    ];
    expect(got('battle')).toHaveLength(want.length);
    want.forEach(([t, b, unsure], i) => {
      expect(near(got('battle')[i].t, t)).toBe(true);
      expect(got('battle')[i].slot).toBe(button(b));
      expect(!!got('battle')[i].unsure).toBe(unsure);
    });
  });

  it('reads the ultimates by the button pressed just before the cut-in', () => {
    expect(got('ultimate').map((s) => [Math.round(s.t * 10) / 10, MOBILE.slots[s.slot!]])).toEqual([
      [35.6, 'Upper'],
      [52.1, 'Middle'],
    ]);
  });

  it('reads the combo banners, three of them back to back, one group per operator', () => {
    // Silver hair, brown hair, blonde with horns, purple hair.
    const who = ['silver', 'brown', 'blonde', 'purple', 'silver', 'brown', 'blonde', 'silver', 'purple', 'brown', 'blonde'];
    const at = [8.34, 9.47, 10.11, 17.38, 28.21, 29.06, 29.51, 48.26, 49.32, 50.04, 50.47];
    const combos = got('combo');
    expect(combos).toHaveLength(who.length);
    const groupOf = new Map<string, number>();
    who.forEach((w, i) => {
      expect(near(combos[i].t, at[i], 0.15)).toBe(true);
      if (!groupOf.has(w)) groupOf.set(w, combos[i].group!);
      expect(combos[i].group).toBe(groupOf.get(w));
    });
    expect(new Set(groupOf.values()).size).toBe(4);
  });

  it("reads Final Strikes, not the SP bar's blinks or its emptying at the end", () => {
    expect(got('strike').map((s) => Math.round(s.t))).toEqual([40, 43, 48]);
    expect(got('finisher')).toHaveLength(0);
    expect(got('battle').every((s) => s.t < 63)).toBe(true);
  });

  it('times the fight by the stopwatch counting down, ultimates not stopping it', () => {
    expect(r.clock!.seconds).toBe(62);
    expect(near(r.clock!.end, 62.81, 0.15)).toBe(true);
    expect(r.clock!.pauses).toHaveLength(0);
  });
});
