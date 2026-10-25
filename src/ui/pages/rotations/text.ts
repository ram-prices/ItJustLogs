import { FPS } from '../../../domain/sim/engine';

export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const big = (n: number) => Math.round(n).toLocaleString();
/** A time as m:ss.s, as the game's stopwatch reads (with tenths). */
export const clockTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
export const secs = (frame: number) => clockTime(frame / FPS);

/** An action's SP change, every action (a combo's or ultimate's 0 too): "−100 SP", "+17 SP", "0 SP". */
export const spText = (d: number | undefined): string => (d === undefined ? '' : d === 0 ? '0 SP' : `${d > 0 ? '+' : '−'}${Math.abs(d)} SP`);

export const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
