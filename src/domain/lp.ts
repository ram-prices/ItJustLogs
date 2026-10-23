/**
 * Linear programs for the AIC planner, solved by HiGHS (the open-source
 * solver from the University of Edinburgh, as WebAssembly: `highs` on npm,
 * loaded from jsDelivr by ui/pages/aic.ts and from node_modules in tests).
 * A model is minimise cost·x subject to rows (≤, ≥, =), x ≥ 0, some
 * variables whole numbers; it's written in CPLEX LP format, which HiGHS
 * reads. Pure logic, no DOM.
 */

export interface Row {
  /** Variable index → coefficient. */
  coef: Map<number, number>;
  op: '<=' | '>=' | '=';
  rhs: number;
}

/** The part of HiGHS used here (its one-shot `solve`). */
export interface Solver {
  solve(problem: string, options?: Record<string, string | number | boolean>): {
    Status: string;
    ObjectiveValue: number;
    Columns: Record<string, object>;
  };
}

export interface Solution {
  status: 'optimal' | 'infeasible';
  /** Proved best (within HiGHS's default gap); false when it stopped at the time limit with the best found. */
  exact: boolean;
  x: number[];
  value: number;
}

/** A number as LP format writes it (no exponent; tiny values are dropped before this). */
const num = (v: number) => {
  const s = Number(v.toPrecision(12)).toString();
  return s.includes('e') ? v.toFixed(12).replace(/0+$/, '') : s;
};
const term = (a: number, j: number) => `${a < 0 ? '-' : '+'} ${num(Math.abs(a))} x${j}`;

/** The model in CPLEX LP format. */
export function lpFormat(n: number, cost: number[], rows: Row[], whole: readonly number[]): string {
  const out = ['Minimize', ' obj:'];
  for (let j = 0; j < n; j++) if (Math.abs(cost[j] ?? 0) > 1e-12) out.push(`  ${term(cost[j], j)}`);
  if (out.length === 2) out.push('  0 x0');
  out.push('Subject To');
  rows.forEach((r, i) => {
    const terms = [...r.coef].filter(([, a]) => Math.abs(a) > 1e-12);
    if (!terms.length) return;
    out.push(` c${i}:`);
    for (const [j, a] of terms) out.push(`  ${term(a, j)}`);
    out.push(`  ${r.op} ${r.rhs < 0 ? '-' : ''}${num(Math.abs(r.rhs))}`);
  });
  if (whole.length) {
    out.push('General');
    for (const j of whole) out.push(` x${j}`);
  }
  out.push('End');
  return out.join('\n');
}

/** Solves the model, giving up the search for a better whole-number answer after `seconds`. */
export function solveModel(solver: Solver, n: number, cost: number[], rows: Row[], whole: readonly number[], seconds = 5): Solution {
  const res = solver.solve(lpFormat(n, cost, rows, whole), { time_limit: seconds, output_flag: false });
  const x = Array.from({ length: n }, (_, j) => (res.Columns[`x${j}`] as { Primal?: number } | undefined)?.Primal ?? 0);
  const found = res.Status === 'Optimal' || (res.Status === 'Time limit reached' && Number.isFinite(res.ObjectiveValue) && Object.keys(res.Columns).length > 0);
  if (!found) return { status: 'infeasible', exact: true, x, value: Infinity };
  return { status: 'optimal', exact: res.Status === 'Optimal', x, value: res.ObjectiveValue };
}
