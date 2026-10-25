import { type Enemy, FPS } from '../../../domain/sim/engine';
import { fitToRecording } from '../../../domain/sim/videoCheck';
import { type ActionHits, enemyById, type ReplayResult } from '../../../domain/sim/team';
import { page } from './state';
import { formOf, recordingTrack, simTrack, type Track } from './track';
import { videoOf } from './runs';

/**
 * A parsed run's own track, 1:1 with the recording (recordingTrack): the Parser tab's timeline shows it by default,
 * with the video's boss bars, and a switch shows the sim's instead (its damage lane on the same scale).
 */
export type RecordingCard = { recording?: Track; simTrack?: Track; dpsMax?: number; unattributed?: number; afterKill?: number; shown: ReplayResult; live?: LiveDamage };
/** Damage so far at the end of each second of the fight, by `<operator>|<source>` (the fit's numbers), for playback. */
export type LiveDamage = Map<string, number[]>;

/** Damage so far at a moment: the cumulative series' second before it plus its share of that second. */
export function soFar(series: number[] | undefined, t: number): number {
  if (!series?.length) return 0;
  const k = Math.floor(t);
  if (k >= series.length) return series[series.length - 1];
  const before = k > 0 ? series[k - 1] : 0;
  return before + (series[k] - before) * (t - k);
}

/**
 * Each action's damage on a track: the sim's own presses and strikes by index, a recording's matched to the sim's
 * (same operator and kind, the nearest within 3 s, each used once).
 */
function withDamage(track: Track, sim: { presses: Track['presses']; strikes: Track['strikes'] }, press: number[], strike: number[], same: boolean): Track {
  if (same) return { ...track, pressDmg: press, strikeDmg: strike };
  const m = matchActions(track, sim);
  return { ...track, pressDmg: m.presses.map((j) => (j === undefined ? undefined : press[j])), strikeDmg: m.strikes.map((j) => (j === undefined ? undefined : strike[j])) };
}

/** A recording's actions matched to the sim's: for each, the index of the sim's (same operator and kind, the nearest within 3 s, each used once). */
function matchActions(track: Pick<Track, 'presses' | 'strikes'>, sim: Pick<Track, 'presses' | 'strikes'>): { presses: (number | undefined)[]; strikes: (number | undefined)[] } {
  const near = <T extends { frame: number; slot: number }>(mine: T[], theirs: T[], fits: (a: T, b: T) => boolean) => {
    const used = new Set<number>();
    return mine.map((a) => {
      let best = -1;
      theirs.forEach((b, i) => {
        if (used.has(i) || a.slot !== b.slot || !fits(a, b) || Math.abs(a.frame - b.frame) > 3 * FPS) return;
        if (best < 0 || Math.abs(a.frame - b.frame) < Math.abs(a.frame - theirs[best].frame)) best = i;
      });
      if (best < 0) return undefined;
      used.add(best);
      return best;
    });
  };
  return { presses: near(track.presses, sim.presses, (a, b) => a.input === b.input), strikes: near(track.strikes, sim.strikes, (a, b) => a.finisher === b.finisher) };
}

/** A battle skill's cost unless its data says otherwise (SkillPatchTable `cost`; the sim's own presses know it exactly). */
const BATTLE_COST = 100;
/**
 * The recording's SP amounts in the game's own: a skill costs and a Final Strike gives what its data says, so the bar's
 * pixel-sized read (a 101 or 102) takes the sim's amount for the same action (or a battle skill's usual cost when the
 * sim has none and the read is near it); the bar after it is then the bar read just before plus that amount.
 */
function withExactSp(track: Track, sim: Track): Track {
  if (!sim.pressSp) return track;
  const m = matchActions(track, sim);
  // A reading without the SP bar (read before it was, or elsewhere): each action's amount from the sim's same action,
  // no bar after it (the video didn't give one).
  if (!track.pressSp) {
    const take = (idx: (number | undefined)[], theirs: (number | undefined)[] | undefined) => idx.map((j) => (j === undefined ? undefined : theirs?.[j]));
    return { ...track, pressSp: take(m.presses, sim.pressSp), strikeSp: take(m.strikes, sim.strikeSp) };
  }
  const exact = (read: (number | undefined)[], after: (number | undefined)[] | undefined, theirs: (number | undefined)[] | undefined, idx: (number | undefined)[], usual?: number) => {
    const sp = read.map((x, i) => {
      // None read (a combo or ultimate moves no SP): the sim's same action's, so every action has one.
      if (x === undefined) return idx[i] === undefined ? undefined : theirs?.[idx[i]!];
      if (x === 0) return x;
      const j = idx[i];
      const t = j === undefined ? undefined : theirs?.[j];
      if (t) return t;
      return usual !== undefined && Math.abs(x - usual) <= 15 ? usual : x;
    });
    const spAfter = after?.map((a, i) => (a === undefined || read[i] === undefined || sp[i] === undefined ? a : Math.max(0, Math.min(300, Math.round(a - read[i]! + sp[i]!)))));
    return { sp, spAfter };
  };
  // A press's usual amount by kind: only a battle skill's is known without the sim.
  const presses = exact(track.pressSp, track.pressSpAfter, sim.pressSp, m.presses, undefined);
  const battle = track.presses.map((p, i) => (p.input === 'battle' && presses.sp[i] !== undefined && presses.sp[i] === track.pressSp![i] && Math.abs(track.pressSp![i]! + BATTLE_COST) <= 15 ? -BATTLE_COST : presses.sp[i]));
  const spAfterP = presses.spAfter?.map((a, i) => (a === undefined || battle[i] === presses.sp[i] ? a : Math.max(0, Math.min(300, Math.round(a - presses.sp[i]! + battle[i]!)))));
  const strikes = exact(track.strikeSp ?? [], track.strikeSpAfter, sim.strikeSp, m.strikes);
  return { ...track, pressSp: battle, pressSpAfter: spAfterP, strikeSp: strikes.sp, strikeSpAfter: strikes.spAfter };
}

export function recordingCard(r: NonNullable<typeof page.replay>): RecordingCard {
  if (r.result && page.fitted?.of === r.result) return page.fitted.card;
  const card = fitRecording(r);
  if (r.result) page.fitted = { of: r.result, card };
  return card;
}

function fitRecording(r: NonNullable<typeof page.replay>): RecordingCard {
  const entry = r.at === undefined ? undefined : page.runs.find((x) => x.at === r.at);
  const reading = entry && videoOf(entry);
  if (!r.result || !entry || !reading?.boss?.length) return { shown: r.result! };
  const asked = (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy;
  const enemy = typeof asked === 'object' ? asked : asked ? enemyById(asked).enemy : undefined;
  const phaseHp = enemy?.phaseHp ?? r.result.hp ?? 0;
  const sim = simTrack(r.result);
  const rec = withUnseen(recordingTrack(reading, r.result.seconds, phaseHp, enemy?.nodes ?? [], enemy?.nodeMechanic), r.result.strikes ?? []);
  // The Parser tells what each operator did: the recording's damage, split as the sim split its own, each of the sim's
  // actions moved to where the recording made it.
  const m = matchActions(rec, sim);
  const shift = { presses: sim.presses.map((): number | undefined => undefined), strikes: sim.strikes.map((): number | undefined => undefined) };
  m.presses.forEach((j, i) => j !== undefined && (shift.presses[j] = (rec.presses[i].frame - sim.presses[j].frame) / FPS));
  m.strikes.forEach((j, i) => j !== undefined && (shift.strikes[j] = (rec.strikes[i].frame - sim.strikes[j].frame) / FPS));
  const fit = fitToRecording(r.result, reading.boss, reading.pauses ?? [], phaseHp, shift);
  // The recording's ultimate forms: the sim's, moved with their press (the reader can't see one end).
  const forms = (sim.forms ?? []).flatMap((f) => {
    const j = sim.presses.findIndex((p) => formOf(sim, p) === f);
    const d = j < 0 ? undefined : shift.presses[j];
    return d === undefined ? [] : [{ ...f, frame: f.frame + Math.round(d * FPS), end: f.end + Math.round(d * FPS) }];
  });
  // Each action's damage, every second of it scaled as the fit scales that second.
  const ad = fit.actionDamage;
  const sum = (pairs: ActionHits) => Math.round(pairs.reduce((n, [s, d]) => n + d * fit.scaleAt(s), 0));
  // A crit's excess (fit.extras) to the action whose hit took it.
  const press = (ad?.presses.map(sum) ?? []).map((d, i) => d + Math.round(fit.extras.filter((x) => x.hit.press === i).reduce((n, x) => n + x.amount, 0)));
  const strike = (ad?.strikes.map(sum) ?? []).map((d, i) => d + Math.round(fit.extras.filter((x) => x.hit.strike === i).reduce((n, x) => n + x.amount, 0)));
  const simWithDmg = ad ? withDamage(sim, sim, press, strike, true) : sim;
  const asp = r.result.actionSp;
  const simWith = asp ? { ...simWithDmg, pressSp: asp.presses, strikeSp: asp.strikes, pressSpAfter: asp.pressesAfter, strikeSpAfter: asp.strikesAfter } : simWithDmg;
  // Each source's damage so far, each second scaled as the fit scales it.
  const live: LiveDamage = new Map();
  const per = fit.perSecond;
  for (const sec of per) for (const key of Object.keys(sec ?? {})) if (!live.has(key)) live.set(key, []);
  for (const [key, series] of live) {
    let run = 0;
    for (let k = 0; k < per.length; k++) {
      run += (per[k]?.[key] ?? 0) * fit.scaleAt(k) + fit.extras.filter((x) => x.second === k && x.hit.key === key).reduce((n, x) => n + x.amount, 0);
      series.push(run);
    }
  }
  const recF = forms.length ? { ...rec, forms } : rec;
  const recWith = withExactSp(ad ? withDamage(recF, sim, press, strike, false) : recF, simWith);
  return { recording: recWith, simTrack: simWith, dpsMax: Math.max(...rec.dps, ...sim.dps, 0), unattributed: fit.unattributed, afterKill: fit.afterKill, shown: fit.result, live };
}

/**
 * The sim's Final Strikes the recording can't show, put in a recording's track where none of its own matches: an
 * ultimate form's attacks move no SP (Yvonne's closing ult_attack_end), so the reader never sees them.
 */
function withUnseen(track: Track, strikes: { frame: number; slot: number; finisher: boolean; unseen?: boolean }[]): Track {
  const taken = new Set(matchActions(track, { presses: [], strikes }).strikes);
  const add = strikes.filter((x, i) => x.unseen && !x.finisher && !taken.has(i));
  if (!add.length) return track;
  const rows = [
    ...track.strikes.map((x, i) => ({ x, sp: track.strikeSp?.[i], after: track.strikeSpAfter?.[i] })),
    ...add.map((x) => ({ x: { frame: x.frame, slot: x.slot, finisher: false }, sp: undefined, after: undefined })),
  ].sort((a, b) => a.x.frame - b.x.frame);
  return { ...track, strikes: rows.map((r) => r.x), ...(track.strikeSp ? { strikeSp: rows.map((r) => r.sp), strikeSpAfter: rows.map((r) => r.after) } : {}) };
}
