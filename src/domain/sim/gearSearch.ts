/**
 * Builds for the Rotations page's "Optimal gear": the best weapon of each
 * operator's type (Maxed Essence, at the Potential asked for) and the best
 * four gear pieces at their top Artifice, found by fighting the dummy:
 *
 * 1. Weapons: each one the operator can wield, with the rest of the team as
 *    it stands; the most team damage wins.
 * 2. Gear stats: how much team damage a little more of each stat gives the
 *    operator (one fight each), so every top-tier piece gets a score.
 * 3. Gear: for every set with a 3-piece effect, its best three with the best
 *    fourth, and the best piece for each slot, fought out (set effects are
 *    skills: only a fight shows them); then each slot's few best pieces
 *    against the one it has. Twice over the team.
 *
 * Fights are played with a priority list found for the team as it stands;
 * the gear given (the player's loadout) is where it starts. Fights that don't
 * depend on each other go to the runner as one batch (several threads with a
 * pool) and are taken in order, so the result doesn't depend on the threads.
 * Pure logic.
 */
import type { GearData } from './build';
import type { Mod } from './engine';
import { localRunner, search, type Policy, type Runner, type Team } from './rotation';
import { teamFromSpec, type SimBuild, type SimData, type SimRequest } from './team';

/** Gear slots by the data's part number: Armor 0, Gloves 1, two Kits 2. */
const SLOT_PARTS = [0, 1, 2, 2];
/** Rounds over the team (each with a priority list found for the builds as they stand), and pieces tried per slot. */
const PASSES = 2;
const PER_SLOT = 4;
/** The top gear tier's level. */
const TOP = (gear: GearData) => Math.max(...Object.values(gear.items).map((g) => g.level));

type Piece = { id: string; suit: string | null; part: number; stats: { attr: string; how: string; value: number }[] };

/** Every top-tier piece, its stats at its top Artifice level. */
/** A piece's slot as a number (body 0, hand 1, EDC 2): gear.json names it ("Body", "Hand", "EDC"; older files a number). */
const PARTS: Record<string, number> = { Body: 0, Hand: 1, EDC: 2 };
const partOf = (part: number | string): number => (typeof part === 'number' ? part : (PARTS[part] ?? -1));

function pieces(gear: GearData): Piece[] {
  const top = TOP(gear);
  return Object.entries(gear.items)
    .filter(([, g]) => g.level === top)
    .map(([id, g]) => ({ id, suit: g.suit, part: partOf(g.part), stats: g.stats.map((s) => ({ attr: s.attr, how: s.how, value: s.values[s.values.length - 1] ?? 0 })) }));
}
const artifice = (gear: GearData, id: string) => Math.max(0, ...gear.items[id].stats.map((s) => s.values.length - 1));

export interface Optimize {
  /** The weapons each member may use (by position); one weapon: that one. */
  weapons: string[][];
  /**
   * Weapons only Arsenal Issues give (rate-ups, like Lone Barge): a player rarely has two copies, so the search gives
   * each to one member at most.
   */
  limited?: string[];
  /** Each operator's signature weapon (the Arsenal Issue that ran with their banner): a start where they hold it. */
  signatures?: Record<string, string>;
}

/** The team for a fight: builds equipped, and any extra stats per member (to weigh gear stats). Damage over the time limit (no HP goal). */
const teamOf = (builds: SimBuild[], req: SimRequest, data: SimData, extra?: (Mod | null)[]): Team => teamFromSpec({ builds, extra, startSp: req.startSp }, data);

/** Each member's best weapon and gear; `progress` hears how many fights are done of about how many. */
export async function optimizeBuilds(
  req: SimRequest,
  opt: Optimize,
  data: SimData,
  progress?: (done: number, of: number) => void,
  note?: (line: string) => void,
  runner: Runner = localRunner,
): Promise<SimBuild[]> {
  const all = pieces(data.gear);
  const kinds = [...new Map(all.flatMap((p) => p.stats.map((s) => [`${s.attr}|${s.how}`, s] as const))).values()].filter((s) => s.attr !== 'Def');
  const sets = Object.entries(data.gear.sets).filter(([, e]) => e.some((x) => x.pieces === 3));
  const n = req.builds.length;
  const of = PASSES * opt.weapons.reduce((k, w) => k + (w.length > 1 ? w.length : 0), 0) + PASSES * n * (kinds.length + sets.length + 3 + SLOT_PARTS.length * PER_SLOT);
  let done = 0;
  const tick = () => progress?.(++done, of);

  // Seeds: the weapon asked for (or the first), the gear given (the player's loadout, when there is one).
  const builds: SimBuild[] = req.builds.map((b, i) => ({ ...b, weapon: { id: b.weapon?.id && opt.weapons[i].includes(b.weapon.id) ? b.weapon.id : opt.weapons[i][0], potential: b.weapon?.potential ?? 0 }, gear: b.gear }));
  let policy: Policy = (await search(teamOf(builds, req, data), { seconds: req.seconds, budget: 40, pressByPress: false }, runner)).policy;
  // Fights as a batch: each team's damage, in order.
  const fights = async (teams: { bs: SimBuild[]; extra?: (Mod | null)[] }[]) => {
    const got = await runner.plays(teams.map((t) => ({ team: teamOf(t.bs, req, data, t.extra), policy, seconds: req.seconds })));
    for (let k = 0; k < got.length; k++) tick();
    return got.map((f) => f.total);
  };
  const fight = async (bs: SimBuild[], extra?: (Mod | null)[]) => (await fights([{ bs, extra }]))[0];
  const asGear = (ps: Piece[]) => ps.map((p) => ({ id: p.id, artifice: artifice(data.gear, p.id) }));
  const byId = new Map(all.map((p) => [p.id, p]));

  for (let pass = 0; pass < PASSES; pass++) {
    // Each pass plays with a list found for the team as it now stands.
    if (pass > 0) policy = (await search(teamOf(builds, req, data), { seconds: req.seconds, budget: 40, pressByPress: false }, runner)).policy;
    for (let i = 0; i < n; i++) {
      const withOwn = (patch: Partial<SimBuild>) => builds.map((b, j) => (j === i ? { ...b, ...patch } : b));
      // 1. The weapon.
      // Every pass: the first chooses with no gear yet, the next with the gear the first found.
      if (opt.weapons[i].length > 1) {
        let best = -1;
        const ids = opt.weapons[i].filter((id) => !(opt.limited?.includes(id) && builds.some((b, j) => j !== i && b.weapon?.id === id)));
        const potential = builds[i].weapon!.potential;
        const got = await fights(ids.map((id) => ({ bs: withOwn({ weapon: { id, potential } }) })));
        ids.forEach((id, k) => {
          if (got[k] > best) {
            best = got[k];
            builds[i] = { ...builds[i], weapon: { id, potential } };
          }
        });
      }
      // 2. What a little more of each gear stat gives the team (gains only: a stat that seems to cost damage counts
      //    as nothing here; Ultimate Energy gain is left to the fights, its worth depends on when ultimates go).
      const weighed = kinds.filter((k) => !/UltimateSpGain|Heal|DamageTaken|MaxHp/.test(k.attr));
      const sizeOf = (k: (typeof kinds)[number]) => {
        const sizes = all.flatMap((p) => p.stats.filter((s) => s.attr === k.attr && s.how === k.how).map((s) => s.value)).sort((a, b) => a - b);
        return sizes[sizes.length >> 1] || 1;
      };
      const totals = await fights([
        { bs: builds },
        ...weighed.map((k) => ({ bs: builds, extra: builds.map((_, j) => (j === i ? { attributeType: resolve(k.attr, data, builds[i].op), formulaItem: k.how, value: sizeOf(k) } : null)) })),
      ]);
      const base = totals[0];
      const weight = new Map<string, number>();
      weighed.forEach((k, j) => weight.set(`${k.attr}|${k.how}`, Math.max(0, (totals[j + 1] - base) / sizeOf(k))));
      note?.(`${builds[i].op} base ${Math.round(base)} weights ${[...weight].filter(([, v]) => v).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ')}`);
      const score = (p: Piece) => p.stats.reduce((s, x) => s + (weight.get(`${x.attr}|${x.how}`) ?? 0) * x.value, 0);
      const ranked = (part: number, suit?: string) => all.filter((p) => p.part === part && (!suit || p.suit === suit)).sort((a, b) => score(b) - score(a));

      // 3. Gear: a set's best three with the best fourth, or the best piece for each slot, fought out...
      let best = builds[i].gear.length ? await fight(builds) : -1;
      // Gear to try, fought as one batch, the best kept (the first of equals).
      const tryGear = async (list: Piece[][]) => {
        const got = await fights(list.map((ps) => ({ bs: withOwn({ gear: asGear(ps) }) })));
        list.forEach((ps, k) => {
          note?.(`  ${Math.round(got[k])} ${ps.map((p) => p.id.replace('item_equip_t4_', '')).join(',')}`);
          if (got[k] > best) {
            best = got[k];
            builds[i] = { ...builds[i], gear: asGear(ps) };
          }
        });
      };
      const first: Piece[][] = [SLOT_PARTS.map((part) => ranked(part)[0]).filter(Boolean)];
      for (const [suit] of sets) {
        const own = SLOT_PARTS.map((part) => ranked(part, suit)[0]);
        const free = SLOT_PARTS.map((part) => ranked(part)[0]);
        // The slot the set leaves to another piece: where that scores best.
        let pick: Piece[] | null = null;
        let pickScore = -Infinity;
        for (let skip = -1; skip < SLOT_PARTS.length; skip++) {
          const ps = SLOT_PARTS.map((_, s) => (s === skip ? free[s] : own[s]));
          if (ps.some((p) => !p) || ps.filter((p) => p.suit === suit).length < 3) continue;
          const sc = ps.reduce((k, p) => k + score(p), 0);
          if (sc > pickScore) {
            pickScore = sc;
            pick = ps;
          }
        }
        if (pick) first.push(pick);
      }
      await tryGear(first);
      // ...then each slot on its own: its few best-scoring pieces against the one it has.
      for (let slot = 0; slot < SLOT_PARTS.length; slot++) {
        const current = builds[i].gear.map((g) => byId.get(g.id)!).filter(Boolean);
        if (current.length !== SLOT_PARTS.length) break;
        // One slot's pieces as a batch: each is the current gear with that piece, so the order of keeping is the same.
        const tries: Piece[][] = [];
        for (const p of ranked(SLOT_PARTS[slot]).slice(0, PER_SLOT)) if (p.id !== current[slot].id) tries.push(current.map((c, s) => (s === slot ? p : c)));
        await tryGear(tries);
      }
    }
  }
  return builds;
}

/** A gear stat's attribute: Main / Sub as the operator's own. */
function resolve(attr: string, data: SimData, op: string): string {
  const base = data.ops[op].base;
  return attr === 'Main' ? (base?.main ?? attr) : attr === 'Sub' ? (base?.sub ?? attr) : attr;
}
