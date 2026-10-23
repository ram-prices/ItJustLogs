/**
 * A runner (domain/sim/rotation.ts Runner) that plays a batch of fights on
 * several threads: fight workers (ui/simJudge.ts), one per core asked for.
 * Started by the search worker (ui/simWorker.ts), so the page itself never
 * waits. Results come back in the batch's order, so the search finds what one
 * thread would.
 *
 * A press-by-press way is sent as its presses; the worker that made it still
 * has its fight, so its next steps go to that worker first (the others replay
 * it from its presses).
 */
import type { ChildResult, ChildTask, Fight, PlayTask, Runner, Team } from '../domain/sim/rotation';
import type { SimRequest, TeamSpec } from '../domain/sim/team';
import type { JudgeIn, JudgeOut, WireChild, WirePlay } from './simJudge';

export class Pool implements Runner {
  readonly width: number;
  private seq = 0;
  private waiting = new Map<number, { resolve: (m: JudgeOut) => void; reject: (e: Error) => void }>();
  /** Which worker made each way. */
  private maker = new Map<string, number>();

  private judges: Worker[];

  private constructor(judges: Worker[]) {
    this.judges = judges;
    this.width = judges.length;
    judges.forEach((w) => {
      w.onmessage = (e: MessageEvent<JudgeOut>) => {
        const job = this.waiting.get(e.data.id);
        if (!job) return;
        this.waiting.delete(e.data.id);
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data);
      };
      w.onerror = (e) => {
        for (const job of this.waiting.values()) job.reject(new Error(e.message || 'A fight worker failed'));
        this.waiting.clear();
      };
    });
  }

  /** A pool of `n` workers with the request's combat data loaded; null when workers can't start here. */
  static async open(n: number, req: SimRequest): Promise<Pool | null> {
    if (n < 2 || typeof Worker === 'undefined') return null;
    try {
      const judges = Array.from({ length: n }, () => new Worker(new URL('./simJudge.ts', import.meta.url), { type: 'module' }));
      const pool = new Pool(judges);
      await Promise.all(judges.map((_, i) => pool.send(i, { id: 0, init: req })));
      return pool;
    } catch {
      return null;
    }
  }

  close(): void {
    for (const w of this.judges) w.terminate();
    this.judges = [];
  }

  private send(i: number, m: JudgeIn): Promise<JudgeOut> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.judges[i].postMessage({ ...m, id });
    });
  }

  private static spec(team: Team): TeamSpec {
    if (!team.spec) throw new Error('A team without its spec can’t go to another thread');
    return team.spec as TeamSpec;
  }

  async plays(tasks: PlayTask[]): Promise<Fight[]> {
    const n = this.judges.length;
    const share: { at: number[]; tasks: WirePlay[] }[] = this.judges.map(() => ({ at: [], tasks: [] }));
    tasks.forEach((t, k) => {
      const s = share[k % n];
      s.at.push(k);
      s.tasks.push({ ...t, team: Pool.spec(t.team) });
    });
    const out: Fight[] = new Array(tasks.length);
    await Promise.all(
      share.map(async (s, i) => {
        if (!s.tasks.length) return;
        const r = await this.send(i, { id: 0, plays: s.tasks });
        r.fights!.forEach((f, j) => (out[s.at[j]] = f));
      }),
    );
    return out;
  }

  async children(tasks: ChildTask[]): Promise<ChildResult[]> {
    const n = this.judges.length;
    const fair = Math.ceil(tasks.length / n);
    const load = new Array(n).fill(0);
    const share: { at: number[]; tasks: WireChild[] }[] = this.judges.map(() => ({ at: [], tasks: [] }));
    tasks.forEach((t, k) => {
      // The worker that made the way, while it has no more than its share; else the least busy.
      const m = this.maker.get(t.parent.key);
      const i = m !== undefined && load[m] < fair ? m : load.indexOf(Math.min(...load));
      load[i]++;
      share[i].at.push(k);
      share[i].tasks.push({ ...t, team: Pool.spec(t.team), parent: { ...t.parent, world: undefined } });
    });
    const out: ChildResult[] = new Array(tasks.length);
    await Promise.all(
      share.map(async (s, i) => {
        if (!s.tasks.length) return;
        const r = await this.send(i, { id: 0, children: s.tasks });
        r.children!.forEach((c, j) => {
          out[s.at[j]] = c;
          this.maker.set(c.key, i);
        });
      }),
    );
    if (this.maker.size > 20000) this.maker.clear();
    return out;
  }
}
