import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { teamOf, type SimData, type SimRequest } from '../src/domain/sim/team';
import { World, FPS } from '../src/domain/sim/engine';
import { EF_ASSETS } from '../src/domain/banners';

/**
 * Writes src/data/final-strikes.json: each operator's basic attack chain as the sim plays it, controlled alone and
 * attacking as soon as it can (no gear, Potential 0): its hits, the seconds from one Final Strike to the next, and
 * the SP one chain gives. Run it after combat data changes (new operators):
 *   GEN=1 npx vitest run scripts/final-strikes.test.ts
 * It reads ef-assets combat/ from GitHub, or a local copy at COMBAT_DIR.
 */

const DIR = process.env.COMBAT_DIR;
const load = async (path: string) =>
  DIR ? JSON.parse(readFileSync(DIR + path, 'utf8')) : (await fetch(`${EF_ASSETS}/combat/${path}`)).json();

it.skipIf(!process.env.GEN)(
  'final strikes',
  async () => {
    const ops: string[] = (await load('index.json')).ops;
    const settings = (await load('settings.json')).settings;
    const gear = await load('gear.json');
    const proto = World.prototype as unknown as { obtain: (type: string, amount: number, ...rest: unknown[]) => unknown; frame: number };
    const obtain = proto.obtain;
    let gains: [number, number][] = [];
    proto.obtain = function (this: { frame: number }, type: string, amount: number, ...rest: unknown[]) {
      if (type === 'Atb' && amount > 0) gains.push([this.frame, amount]);
      return obtain.call(this, type, amount, ...rest);
    };
    const out: Record<string, { hits: number; seconds: number; sp: number }> = {};
    try {
      for (const op of ops) {
        const data: SimData = { ops: { [op]: await load(`ops/${op}.json`) }, weapons: {}, gear, settings };
        const team = teamOf({ builds: [{ op, potential: 0, gear: [] }], seconds: 30, style: 'advanced', effort: 'normal' } as SimRequest, data);
        const w = new World(team.bundles, team.stats, { def: 100, poise: 1e9, staggerSeconds: 0, finisherSp: 0 }, team.settings);
        w.start(team.potentials);
        w.controlled = 0;
        gains = [];
        for (let f = 0; f < FPS * 30; f++) {
          if (w.can(0, 'attack')) w.press(0, 'attack');
          w.tick();
        }
        // One Final Strike per chain (a strike's projectiles can register a few frames apart); the first chain is skipped.
        const fs: number[] = [];
        for (const s of w.strikes) if (!fs.length || s.frame - fs[fs.length - 1] > 15) fs.push(s.frame);
        if (fs.length < 4) continue;
        const seconds = (fs[fs.length - 1] - fs[1]) / (fs.length - 2) / FPS;
        // SP of one chain: from just after one Final Strike to just after the next (projectile hits land late).
        const sp = gains.filter(([f]) => f > fs[1] + 10 && f <= fs[2] + 10).reduce((a, [, v]) => a + v, 0);
        out[op] = { hits: w.chainLength(w.team[0]), seconds: Math.round(seconds * 100) / 100, sp: Math.round(sp * 10) / 10 };
      }
    } finally {
      proto.obtain = obtain;
    }
    writeFileSync(new URL('../src/data/final-strikes.json', import.meta.url), JSON.stringify({ note: 'Made by scripts/final-strikes.test.ts with the sim engine.', operators: out }, null, 1) + '\n');
  },
  600_000,
);
