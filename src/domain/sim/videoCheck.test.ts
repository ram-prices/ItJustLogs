import { describe, expect, it } from 'vitest';
import { compareWithVideo } from './videoCheck';

// A made-up fight against a 1,000,000 HP phase and a 320 meter: the video's bars every 0.25 s, the sim's track the
// same until it parts.
const HP = 1_000_000;
const POISE = 320;
const times = Array.from({ length: 241 }, (_, i) => i / 4);

describe('replay against the video', () => {
  it('says nothing while they match', () => {
    const boss = times.map((t) => [t, 1 - t / 100, Math.min(0.9, t / 80)] as [number, number, number]);
    const track = times.map((t) => [t, (t / 100) * HP, Math.min(0.9, t / 80)] as [number, number, number]);
    expect(compareWithVideo(track, boss, [], HP, POISE)).toEqual([]);
  });

  it('finds where the damage parts, and a Final Strike the sim misses', () => {
    const boss = times.map((t) => [t, 1 - t / 100, (t >= 30 ? 17 : 0) / POISE] as [number, number, number]);
    const track = times.map((t) => [t, (t / 100) * HP * (t >= 20 ? 1.3 : 1), 0] as [number, number, number]);
    const found = compareWithVideo(track, boss, [], HP, POISE);
    expect(found.map((d) => [d.t, d.kind])).toEqual([
      [20, 'damage'],
      [30, 'stagger'],
    ]);
    expect(found[1].by).toBe(-17);
    expect(found[1].hint).toBe('a Final Strike the transcript misses?');
  });

  it("takes the stopwatch's pauses out and starts each phase anew", () => {
    // A phase change from 30 to 35 s on the video: the boss's HP refills, the fight's clock stands still.
    const boss = times.map((t) => [t, t < 30 ? 1 - t / 50 : 1 - (t - 35) / 50, 0] as [number, number, number]).filter(([t]) => t < 30 || t >= 35);
    const track = times.filter((t) => t <= 55).map((t) => [t, t < 30 ? (t / 50) * HP : 0.6 * HP + ((t - 30) / 50) * HP, 0] as [number, number, number]);
    expect(compareWithVideo(track, boss, [[30, 35]], HP, POISE)).toEqual([]);
  });
});
