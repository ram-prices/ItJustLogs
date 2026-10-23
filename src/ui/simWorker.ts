/**
 * Runs the rotation search (domain/sim/team.ts) off the page's thread: it
 * plays thousands of fights. With more than one core asked for, the fights go
 * to a pool of fight workers (ui/simPool.ts) and play side by side; the search
 * finds the same rotation either way. The combat data comes from ef-assets
 * combat/ (ui/simData.ts).
 */
import { localRunner } from '../domain/sim/rotation';
import { replaySim, runSim, type ReplayClock, type ReplayStep, type SimRequest } from '../domain/sim/team';
import { dataFor } from './simData';
import { Pool } from './simPool';

/** The worker's own scope (the project's types are the page's). */
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; req: SimRequest; cores?: number; replay?: ReplayStep[]; stopwatch?: ReplayClock }>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = async (e) => {
  const { id, req, cores = 1, replay, stopwatch } = e.data;
  // A gameplay video's rotation played as it was (one fight: no search, no pool).
  if (replay) {
    try {
      const data = await dataFor(req);
      scope.postMessage({ id, loaded: true, cores: 1 });
      scope.postMessage({ id, result: replaySim(req, data, replay, stopwatch) });
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  let pool: Pool | null = null;
  try {
    const data = await dataFor(req);
    pool = await Pool.open(cores, req);
    scope.postMessage({ id, loaded: true, cores: pool?.width ?? 1 });
    const result = await runSim(req, data, (progress) => scope.postMessage({ id, progress }), pool ?? localRunner);
    scope.postMessage({ id, result });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  } finally {
    pool?.close();
  }
};
