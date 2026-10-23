import { FACES, READ_HEIGHT, READ_NAME, SLOTS, areas, clockAnchors, clockInk, enemyName, measure, readRotation, whiteInk, type Area, type ClockReading, type Px, type Read, type Reading, type Sample, type Slot, type Step } from '../domain/rotationReader';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';
import { recognize } from './screenReader';

/**
 * "Read a gameplay video" on the Rotations page: the player picks a
 * recording of a fight (controller layout) and gets its rotation written
 * out. The video plays in this browser at double speed; each frame's SP
 * bar, skill diamond and banner area are cut out and measured
 * (domain/rotationReader.ts turns that into presses). Then the stopwatch's
 * digits at a few of its ticks, and the boss's name, are read with text
 * recognition (Tesseract.js, as the other readers). Nothing is uploaded.
 * The review shows the HUD's four portraits from the video to name, the
 * combo banners' art, and the presses; whose a press was can be changed
 * where it was a guess.
 */

/** Played this much faster than real time: about every other frame of a 60 fps video is still seen. */
const SPEED = 2;
/** A longer step between frames seen means some were missed (a press can show for a few frames only). */
const MISSED = 0.15;
/** The stopwatch's picture is kept this often (seconds), to read a few of them afterwards. */
const CLOCK_EVERY = 0.2;
/**
 * Operators whose battle skill gives SP back (endfield.wiki.gg's battle skill values): with one of them in the team,
 * a battle skill SP came back after is suggested as theirs, and one it didn't as not theirs.
 */
const SP_BACK_OPERATORS = ['Tangtang', 'Last Rite', 'Snowshine', 'Catcher', 'Purrchena', 'Arclight', 'Alesh', 'Pogranichnik'];

/** A video's rotation, once every press has an operator: to play in the sim (Rotations page). */
export interface VideoRotation {
  /** Who's in each HUD slot. */
  names: string[];
  /** Seconds from the fight's start; whose (HUD slot); what. Final Strikes and Finishers by the controlled operator. */
  steps: { t: number; slot: Slot; input: Read }[];
  /** The fight's length: what the stopwatch showed when it stopped, else how long the HUD showed. */
  seconds: number;
  /** When the stopwatch stopped (seconds from the fight's start; else when the HUD last showed). */
  end: number;
  /** Stretches the stopwatch stood still (a phase change), seconds from the fight's start. */
  pauses: [number, number][];
  /** The boss's name, as shown above its HP bar. */
  enemy?: string;
}

/**
 * Opens the file picker, reads the chosen video, then shows the transcript. `operators`: every operator's name, to
 * pick from; `simulate`: plays the rotation in the sim.
 */
export function readGameplay(operators: string[], simulate?: (v: VideoRotation) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void readGameplayFile(file, operators, simulate);
  };
  input.click();
}

const canvasFor = (a: Area) => {
  const c = document.createElement('canvas');
  c.width = a.w;
  c.height = a.h;
  return c;
};

export async function readGameplayFile(file: File, operators: string[], simulate?: (v: VideoRotation) => void): Promise<void> {
  const dlg = document.createElement('dialog');
  dlg.className = 'card reader-dialog';
  document.body.append(dlg);
  let cancelled = false;
  dlg.addEventListener('close', () => {
    cancelled = true;
    video.pause();
    URL.revokeObjectURL(video.src);
    dlg.remove();
  });
  dlg.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-reader-cancel]')) dlg.close();
  });
  render(
    dlg,
    html`<div class="reader-head"><h2 class="heading-20">Reading the video</h2></div>
      <div class="reader-body">
        <div class="gameplay-preview"></div>
        <p class="copy-14 gameplay-status">Opening the video…</p>
        <div class="reader-bar"><span style="width:0%"></span></div>
        <p class="copy-13 secondary">Everything is read here in your browser; nothing is uploaded.</p>
      </div>
      <div class="reader-foot"><span></span><button type="button" class="btn secondary sm" data-reader-cancel>Cancel</button></div>`,
  );
  dlg.showModal();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  dlg.querySelector('.gameplay-preview')!.append(video);
  const status = dlg.querySelector<HTMLElement>('.gameplay-status')!;
  const bar = dlg.querySelector<HTMLElement>('.reader-bar span')!;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`Couldn't open ${file.name} (this browser may not play that format).`));
    });
    const started = Date.now();
    const got = await sampleVideo(video, () => cancelled, (done) => {
      status.textContent = `Reading ${Math.round(done * 100)}%…`;
      bar.style.width = `${Math.round(done * 100)}%`;
    });
    if (cancelled) return;
    status.textContent = 'Reading the stopwatch and the boss’s name…';
    const words = await readWords(got);
    if (cancelled) return;
    const reading = readRotation(got.samples, words.clock);
    review(dlg, reading, got.portraits, operators, simulate, Math.round((Date.now() - started) / 1000), words.enemy);
  } catch (e) {
    if (!cancelled) {
      dlg.close();
      toast((e as Error).message, 'error');
    }
  }
}

interface Sampled {
  samples: Sample[];
  /** Each slot's portrait, from a frame with the HUD up. */
  portraits: string[];
  /** The stopwatch every CLOCK_EVERY seconds: time (seconds into the video) and picture. */
  clocks: [number, Px][];
  /** The boss's name at a few moments. */
  enemies: Px[];
}

const canvasOf = (p: Px) => {
  const c = document.createElement('canvas');
  c.width = p.width;
  c.height = p.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return c;
};

/** The stopwatch at the ticks the domain asks for, and the boss's name; nothing if the text reader can't load. */
async function readWords(got: Sampled): Promise<{ clock: ClockReading[]; enemy?: string }> {
  // The stopwatch's picture nearest each time asked for.
  const near = (t: number) => got.clocks.reduce<[number, Px] | undefined>((a, b) => (Math.abs(b[0] - t) < Math.abs((a?.[0] ?? Infinity) - t) ? b : a), undefined);
  const picks = clockAnchors(got.samples).flatMap((t) => {
    const c = near(t);
    return c && Math.abs(c[0] - t) <= CLOCK_EVERY ? [c] : [];
  });
  try {
    const texts = await recognize(picks.map(([, px]) => canvasOf(clockInk(px))), '0123456789:');
    const names = got.enemies.length ? await recognize(got.enemies.map((p) => canvasOf(whiteInk(p)))) : [];
    return { clock: picks.map(([t], k) => ({ t, text: texts[k] })), enemy: enemyName(names) };
  } catch {
    return { clock: [] };
  }
}

/** Plays the video through, measuring each frame shown. */
async function sampleVideo(video: HTMLVideoElement, cancelled: () => boolean, progress: (done: number) => void): Promise<Sampled> {
  const scale = READ_HEIGHT / video.videoHeight;
  const a = areas(Math.round(video.videoWidth * scale));
  const cut = (area: Area) => {
    const c = canvasFor(area);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    return {
      c,
      read(): Px {
        g.drawImage(video, area.x / scale, area.y / scale, area.w / scale, area.h / scale, 0, 0, area.w, area.h);
        return g.getImageData(0, 0, area.w, area.h);
      },
    };
  };
  const right = cut(a.right);
  const centre = cut(a.centre);
  const banner = cut(a.banner);
  const portraits = cut(a.portraits);
  const clock = cut(a.clock);
  const enemy = cut(a.enemy);
  const out: Sampled = { samples: [], portraits: [], clocks: [], enemies: [] };
  let seenOn = 0;
  const take = (t: number) => {
    const px = clock.read();
    const s = measure(t, right.read(), centre.read(), banner.read(), px);
    out.samples.push(s);
    // The stopwatch now and then (the domain picks a few moments to read).
    if (t - (out.clocks[out.clocks.length - 1]?.[0] ?? -Infinity) >= CLOCK_EVERY) out.clocks.push([t, px]);
    if (s.hud > 0.5 && [60, 600, 1800].includes(seenOn + 1)) out.enemies.push(enemy.read());
    // The portraits, once the HUD has been up a moment.
    if (s.hud > 0.5 && ++seenOn === 30) {
      portraits.read();
      out.portraits = FACES.map(([x, y]) => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        c.getContext('2d')!.drawImage(portraits.c, x - 32, y - 20, 64, 64, 0, 0, 64, 64);
        return c.toDataURL('image/png');
      });
    }
    progress(Math.min(1, t / video.duration));
  };
  let last = -1;
  // Played through, measuring each frame shown (older browsers lack frame callbacks).
  if (typeof (video as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function') {
    await new Promise<void>((resolve, reject) => {
      let speed = SPEED;
      const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
        if (cancelled()) return resolve();
        if (video.paused) return;
        if (last >= 0 && meta.mediaTime - last > MISSED) {
          // Frames went by unseen (a busy device): back up, a little slower.
          speed = Math.max(0.5, speed - 0.5);
          video.playbackRate = speed;
          video.currentTime = last + 1 / 60;
        } else if (meta.mediaTime > last) {
          take(meta.mediaTime);
          last = meta.mediaTime;
        }
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      const stop = () => {
        video.pause();
        video.ontimeupdate = video.onended = null;
        resolve();
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = stop;
      // No frames shown while it plays (a tab in the background draws none): step through it instead.
      video.ontimeupdate = () => {
        if (cancelled() || video.currentTime - Math.max(0, last) > 1) stop();
      };
      video.playbackRate = speed;
      video.play().catch(reject);
    });
  }
  // Step through what's left, 30 frames a second (slower, but works anywhere).
  for (let t = Math.max(0, last + 1 / 30); t < video.duration && !cancelled(); t += 1 / 30) {
    video.currentTime = t;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    take(t);
  }
  return out;
}

const secs = (t: number) => `${t.toFixed(1)} s`;

/** The transcript, for the player to name the operators and fix guesses. */
function review(dlg: HTMLDialogElement, reading: Reading, portraits: string[], operators: string[], simulate: ((v: VideoRotation) => void) | undefined, seconds: number, enemy?: string): void {
  const start = reading.start ?? 0;
  const clock = reading.clock;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  const steps = reading.steps;
  // Who's in each HUD slot: the player picks, beside the portrait from the video (until then, the slot's place).
  const slotName: string[] = [...SLOTS];
  const picked: boolean[] = SLOTS.map(() => false);
  const groups = [...new Set(steps.filter((s) => s.group !== undefined).map((s) => s.group!))].sort((a, b) => a - b);
  const groupSlot = new Map<number, Slot | null>(groups.map((g) => [g, steps.find((s) => s.group === g)!.slot]));
  const groupArt = new Map<number, string>();
  // Who's controlled (swaps aren't read): Final Strikes are theirs. A guess: whose battle skills flashed most.
  const flashed = [0, 1, 2, 3].map((i) => steps.filter((s) => s.input === 'battle' && s.slot === i && !s.unsure).length);
  let controlled: Slot | null = Math.max(...flashed) > 0 ? (flashed.indexOf(Math.max(...flashed)) as Slot) : null;
  // Battle skills whose caster is a guess or unknown: a list each, which stays; what the player picked there.
  const guessed = new Set(steps.flatMap((s, k) => (s.input === 'battle' && (s.unsure || s.slot === null) ? [k] : [])));
  const chosen = new Map<Step, Slot | null>();
  // The guess for one of those: with exactly one operator in the team whose battle skill gives SP back, theirs when SP
  // came back after it, and not theirs when it didn't.
  const suggested = (s: Step): Slot | null => {
    const back = SLOTS.flatMap((_, i) => (picked[i] && SP_BACK_OPERATORS.includes(slotName[i]) ? [i as Slot] : []));
    if (back.length !== 1) return s.slot;
    if (s.spBack) return back[0];
    return s.slot === back[0] ? null : s.slot;
  };
  const slotOf = (s: Step): Slot | null => {
    if (s.input === 'combo') return groupSlot.get(s.group!) ?? null;
    if (s.input === 'strike' || s.input === 'finisher') return controlled;
    if (s.input === 'battle' && (s.unsure || s.slot === null)) return chosen.has(s) ? chosen.get(s)! : suggested(s);
    return s.slot;
  };
  // Ready to play in the sim: every slot named, every press someone's.
  const ready = () => picked.every(Boolean) && steps.every((s) => slotOf(s) !== null);
  const nameOf = (s: Step) => {
    const slot = slotOf(s);
    return slot === null ? '?' : slotName[slot];
  };
  const presses = () => steps.filter((s) => s.input !== 'strike' && s.input !== 'finisher').length;
  const slotSelect = (value: Slot | null | undefined, attrs: string) =>
    html`<select class="input gameplay-select" ${raw(attrs)}>
      <option value="" ${value === null || value === undefined ? 'selected' : ''}>?</option>
      ${SLOTS.map((_, i) => html`<option value="${i}" ${value === i ? 'selected' : ''}>${slotName[i]}</option>`)}
    </select>`;
  const draw = () =>
    render(
      dlg,
      html`<div class="reader-head">
          <h2 class="heading-20">${reading.start === null ? 'No fight found' : `Read ${presses()} presses`}</h2>
          <p class="copy-13 secondary">${reading.start === null
            ? 'Record with a controller and the HUD showing: the SP bar, the skill diamond and the portraits.'
            : `${enemy ? `${enemy} · ` : ''}${clock ? `${mmss(clock.seconds)} on the stopwatch${clock.pauses.length ? `, stopped ${clock.pauses.map(([a, b]) => `${(b - a).toFixed(1)} s at ${secs(a - start)}`).join(', ')}` : ''}. ` : ''}Times from when the HUD first shows. Read in ${seconds}s. A list on a press means whose it was is a guess.`}</p>
        </div>
        ${reading.start === null
          ? ''
          : html`<div class="reader-body reader-list">
              <div class="gameplay-slots">
                ${SLOTS.map(
                  (label, i) => html`<label class="gameplay-slot">
                    ${portraits[i] ? html`<img src="${portraits[i]}" alt="" width="40" height="40" />` : ''}
                    <span class="label-12 secondary">${label}</span>
                    <select class="input gameplay-select" data-gameplay-slot="${i}">
                      <option value="" ${picked[i] ? '' : 'selected'}>Pick</option>
                      ${operators.map((n) => html`<option ${picked[i] && n === slotName[i] ? 'selected' : ''}>${n}</option>`)}
                    </select>
                  </label>`,
                )}
                <label class="gameplay-slot"><span class="label-12 secondary">Controlled</span>${slotSelect(controlled, 'data-gameplay-controlled')}</label>
              </div>
              ${groups.length
                ? html`<p class="label-12 secondary">Combo banners</p>
                    <div class="gameplay-slots">
                      ${groups.map(
                        (g) => html`<label class="gameplay-slot">
                          <img class="gameplay-art" src="${groupArt.get(g) ?? ''}" alt="" width="96" height="36" />
                          ${slotSelect(groupSlot.get(g), `data-gameplay-group="${g}"`)}
                        </label>`,
                      )}
                    </div>`
                : ''}
              <ol class="sim-steps copy-14 gameplay-steps">
                ${steps.map((s, k) => {
                  const strike = s.input === 'strike' || s.input === 'finisher';
                  const pick = guessed.has(k);
                  return html`<li class="${strike ? 'secondary' : ''}">
                    <span class="num secondary">${secs(s.t - start)}</span>
                    ${strike ? '' : pick ? slotSelect(slotOf(s), `data-gameplay-step="${k}"`) : nameOf(s)}${strike ? '' : ' · '}${READ_NAME[s.input]}
                  </li>`;
                })}
              </ol>
            </div>`}
        <div class="reader-foot">
          <button type="button" class="btn secondary sm" data-reader-cancel>Close</button>
          ${steps.length
            ? html`<div class="row">
                <button type="button" class="btn secondary sm" data-gameplay-copy>${icon('content_copy')}Copy transcript</button>
                ${simulate ? html`<button type="button" class="btn primary sm" data-gameplay-sim ${ready() ? '' : 'disabled'} title="${ready() ? '' : 'Pick every operator first'}">${icon('play_arrow')}Simulate this rotation</button>` : ''}
              </div>`
            : ''}
        </div>`,
    );
  for (const g of groups) if (reading.arts[g]) groupArt.set(g, artImage(reading.arts[g]));
  draw();
  dlg.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    const v = el.value === '' ? null : (Number(el.value) as Slot);
    if (el.dataset.gameplaySlot) {
      const i = Number(el.dataset.gameplaySlot);
      picked[i] = !!el.value;
      slotName[i] = el.value || SLOTS[i];
    }
    else if (el.dataset.gameplayGroup) groupSlot.set(Number(el.dataset.gameplayGroup), v);
    else if (el.dataset.gameplayStep) chosen.set(steps[Number(el.dataset.gameplayStep)], v);
    else if ('gameplayControlled' in el.dataset) controlled = v;
    else return;
    draw();
  });
  dlg.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-gameplay-sim]') && simulate && ready()) {
      const end = reading.end ?? start;
      simulate({
        names: slotName.slice(),
        steps: steps.map((s) => ({ t: s.t - start, slot: slotOf(s)!, input: s.input })),
        seconds: clock ? clock.seconds : Math.ceil(end - start),
        end: (clock?.end ?? end) - start,
        pauses: (clock?.pauses ?? []).map(([a, b]) => [a - start, b - start]),
        enemy,
      });
      dlg.close();
      return;
    }
    if (!(e.target as HTMLElement).closest('[data-gameplay-copy]')) return;
    const text = steps.map((s) => `${secs(s.t - start)}  ${s.input === 'strike' || s.input === 'finisher' ? READ_NAME[s.input] : `${nameOf(s)} · ${READ_NAME[s.input]}`}`).join('\n');
    void navigator.clipboard.writeText(text).then(
      () => toast('Transcript copied.'),
      () => toast('Couldn’t copy.', 'error'),
    );
  });
}

/** A banner's 24×9 art cells as a picture. */
function artImage(art: number[]): string {
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 9;
  const img = new ImageData(24, 9);
  for (let i = 0; i < 24 * 9; i++) {
    img.data.set([art[i * 3], art[i * 3 + 1], art[i * 3 + 2], 255], i * 4);
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
