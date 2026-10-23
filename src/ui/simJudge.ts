/**
 * One of the pool's fight workers (ui/simPool.ts): plays the fights it's
 * handed. Teams come as what they're made of (TeamSpec) and are built here
 * from this worker's own copy of the combat data; a press-by-press way comes
 * as its presses and is replayed, unless this worker made it (it keeps the
 * fights it made for a while).
 */
import { childOf, play, replayWay, type ChildResult, type ChildTask, type Fight, type PlayTask, type Team } from '../domain/sim/rotation';
import { teamFromSpec, type SimData, type SimRequest, type TeamSpec } from '../domain/sim/team';
import type { World } from '../domain/sim/engine';
import { dataFor } from './simData';

/** Tasks as they cross threads: the team as its spec, a way without its fight. */
export type WirePlay = Omit<PlayTask, 'team'> & { team: TeamSpec };
export type WireChild = Omit<ChildTask, 'team'> & { team: TeamSpec };
export type JudgeIn = { id: number; init: SimRequest } | { id: number; plays: WirePlay[] } | { id: number; children: WireChild[] };
export type JudgeOut = { id: number; ready?: true; fights?: Fight[]; children?: ChildResult[]; error?: string };

let data: SimData | null = null;
const teams = new Map<string, Team>();
/** Ways this worker made, by key, newest last. */
const ways = new Map<string, World>();
const KEEP = 96;

const teamOf = (spec: TeamSpec): Team => {
  const key = JSON.stringify(spec);
  let t = teams.get(key);
  if (!t) {
    t = teamFromSpec(spec, data!);
    if (teams.size > 64) teams.clear();
    teams.set(key, t);
  }
  return t;
};

/** A fight crossing back: its hits left out (the search only compares fights; the one it keeps is played again). */
const light = (f: Fight): Fight => ({ ...f, hits: [] });

const scope = self as unknown as { onmessage: ((e: MessageEvent<JudgeIn>) => void) | null; postMessage(m: JudgeOut): void };

scope.onmessage = async (e) => {
  const m = e.data;
  try {
    if ('init' in m) {
      data = await dataFor(m.init);
      teams.clear();
      ways.clear();
      scope.postMessage({ id: m.id, ready: true });
    } else if ('plays' in m) {
      scope.postMessage({ id: m.id, fights: m.plays.map((t) => light(play(teamOf(t.team), t.policy, t.seconds, t.script, t.from))) });
    } else {
      const out = m.children.map((t) => {
        const team = teamOf(t.team);
        const parent = ways.get(t.parent.key) ?? replayWay(team, t.policy, t.parent);
        const r = childOf({ ...t, team }, parent);
        if (r.ok && r.world) {
          ways.set(r.key, r.world);
          if (ways.size > KEEP) ways.delete(ways.keys().next().value!);
        }
        return { ...r, world: undefined };
      });
      scope.postMessage({ id: m.id, children: out });
    }
  } catch (err) {
    scope.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
