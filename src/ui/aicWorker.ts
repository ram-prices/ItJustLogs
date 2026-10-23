/**
 * Solves AIC plans (domain/aic.ts) off the page's thread, so a long search
 * for whole numbers doesn't freeze it. HiGHS comes from jsDelivr, loaded
 * the first time a plan is asked for (like the readers' Tesseract.js).
 */
import { plan, type AicData, type PlanInput } from '../domain/aic';
import type { Solver } from '../domain/lp';

const HIGHS = 'https://cdn.jsdelivr.net/npm/highs@1.15.3/build/';

let solver: Promise<Solver> | null = null;
const load = () =>
  (solver ??= import(/* @vite-ignore */ `${HIGHS}highs.mjs`).then((m: { default: (o: { locateFile(f: string): string }) => Promise<Solver> }) =>
    m.default({ locateFile: (f) => HIGHS + f }),
  ));

/** The worker's own scope (the project's types are the page's). */
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; data: AicData; input: PlanInput }>) => void) | null; postMessage(m: unknown): void };

scope.onmessage = async (e) => {
  const { id, data, input } = e.data;
  try {
    const s = await load();
    const start = Date.now();
    const result = plan(data, input, s);
    scope.postMessage({ id, plan: result, ms: Date.now() - start });
  } catch (err) {
    solver = null;
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
