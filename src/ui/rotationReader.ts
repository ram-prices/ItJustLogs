import { CONTROLLER, MOBILE, READ_HEIGHT, READ_NAME, areas, clockAnchors, clockInk, enemyName, hudIn, measure, readRotation, whiteInk, type Area, type ClockReading, type Layout, type Px, type Read, type Reading, type Sample, type Slot, type Step } from '../domain/rotationReader';
import { toast } from './common';
import { icon } from './components';
import { html, raw, render } from './html';
import { recognize } from './screenReader';

/**
 * "Read a gameplay video" on the Rotations page: the player picks a
 * recording of a fight (controller or phone HUD, told apart by where its HP
 * bar shows) and gets its rotation written
 * out. The video plays in this browser at double speed; each frame's SP
 * bar, skill diamond and banner area are cut out and measured
 * (domain/rotationReader.ts turns that into presses). Then the stopwatch's
 * digits at a few of its ticks, and the boss's name, are read with text
 * recognition (Tesseract.js, as the other readers). Nothing is uploaded.
 * The review shows the HUD's four portraits from the video to name, the
 * combo banners' art, and the presses; whose a press was can be changed
 * where it was a guess.
 */

/**
 * Played in real time: as many frames seen as the device can measure (a combo banner cut short by the next shows for
 * about 0.1 s, a Final Strike's SP step for a few frames); slower than this costs time, faster loses them.
 */
const SPEED = 1;
/** A longer step between frames seen means some were missed: back up and slow down (to SLOWEST). */
const MISSED = 0.05;
const SLOWEST = 0.25;
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
  steps: { t: number; slot: Slot; input: Read; interrupt?: boolean; back?: number }[];
  /** The fight's length: what the stopwatch showed when it stopped, else how long the HUD showed. */
  seconds: number;
  /** When the stopwatch stopped (seconds from the fight's start; else when the HUD last showed). */
  end: number;
  /** Stretches the stopwatch stood still (a phase change), seconds from the fight's start. */
  pauses: [number, number][];
  /** Stretches the enemy couldn't be hit (added in the transcript editor), seconds from the fight's start. */
  away?: [number, number][];
  /** Stretches the boss took no Stagger (read from its meter, or edited), seconds from the fight's start. */
  guard?: [number, number][];
  /** The boss's bars as the video shows them: seconds from the fight's start, HP left (0–1), Stagger meter (0–1, -1 Staggered). */
  boss?: [number, number, number][];
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

/** A video being read: one at a time. */
let busy = false;

/** Leaving the site would lose the read. */
const stay = (e: BeforeUnloadEvent) => e.preventDefault();

/**
 * Reads a video in the background: a small panel (bottom left) shows the video and how far it got, and the rest of
 * the site stays usable meanwhile. When it's done the panel offers the transcript.
 */
export async function readGameplayFile(file: File, operators: string[], simulate?: (v: VideoRotation) => void): Promise<void> {
  if (busy) return toast('A video is being read already.');
  busy = true;
  addEventListener('beforeunload', stay);
  const panel = document.createElement('div');
  panel.className = 'card gameplay-progress';
  panel.setAttribute('role', 'status');
  document.body.append(panel);
  let cancelled = false;
  const video = document.createElement('video');
  const finish = () => {
    busy = false;
    removeEventListener('beforeunload', stay);
    video.pause();
    URL.revokeObjectURL(video.src);
  };
  const close = () => {
    cancelled = true;
    finish();
    panel.remove();
  };
  render(
    panel,
    html`<div class="gameplay-progress-head">
        <span class="label-14">Reading the video</span>
        <button type="button" class="btn tertiary sm icon-btn" data-gameplay-cancel title="Cancel" aria-label="Cancel">${icon('close')}</button>
      </div>
      <div class="gameplay-preview"></div>
      <p class="copy-13 secondary gameplay-status">Opening the video…</p>
      <div class="reader-bar"><span style="width:0%"></span></div>`,
  );
  panel.querySelector('[data-gameplay-cancel]')!.addEventListener('click', close);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  panel.querySelector('.gameplay-preview')!.append(video);
  const status = panel.querySelector<HTMLElement>('.gameplay-status')!;
  const bar = panel.querySelector<HTMLElement>('.reader-bar span')!;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`Couldn't open ${file.name} (this browser may not play that format).`));
    });
    const started = Date.now();
    const layout = await layoutOf(video);
    const got = await sampleVideo(video, layout, () => cancelled, (done) => {
      status.textContent = `Reading ${Math.round(done * 100)}%…`;
      bar.style.width = `${Math.round(done * 100)}%`;
    });
    if (cancelled) return;
    status.textContent = 'Reading the stopwatch and the boss’s name…';
    const words = await readWords(got, layout);
    if (cancelled) return;
    const result = readRotation(got.samples, words.clock, layout);
    finish();
    // The transcript, in a dialog the panel opens (again, if closed: picks made in it stay).
    const dlg = document.createElement('dialog');
    dlg.className = 'card reader-dialog';
    document.body.append(dlg);
    dlg.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-reader-cancel]')) dlg.close();
    });
    const done = () => {
      dlg.remove();
      panel.remove();
    };
    review(dlg, result, got.portraits, operators, simulate, Math.round((Date.now() - started) / 1000), words.enemy, layout, done);
    const presses = result.steps.filter((x) => x.input !== 'strike' && x.input !== 'finisher').length;
    render(
      panel,
      html`<div class="gameplay-progress-head">
          <span class="label-14">${result.start === null ? 'No fight found' : `Read ${presses} actions`}</span>
          <button type="button" class="btn tertiary sm icon-btn" data-gameplay-dismiss title="Close" aria-label="Close">${icon('close')}</button>
        </div>
        <button type="button" class="btn primary sm" data-gameplay-open>Open the transcript</button>`,
    );
    panel.querySelector('[data-gameplay-dismiss]')!.addEventListener('click', done);
    panel.querySelector('[data-gameplay-open]')!.addEventListener('click', () => dlg.showModal());
  } catch (e) {
    if (!cancelled) {
      close();
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

/** Which HUD the video has, controller or phone: whose HP bar shows in a few frames across it. */
async function layoutOf(video: HTMLVideoElement): Promise<Layout> {
  const scale = READ_HEIGHT / video.videoHeight;
  const width = Math.round(video.videoWidth * scale);
  const hits = new Map<Layout, number>([
    [CONTROLLER, 0],
    [MOBILE, 0],
  ]);
  for (let f = 0.2; f < 0.85; f += 0.1) {
    video.currentTime = f * video.duration;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    for (const l of hits.keys()) {
      const a = areas(width, l).centre;
      const c = canvasFor(a);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(video, a.x / scale, a.y / scale, a.w / scale, a.h / scale, 0, 0, a.w, a.h);
      if (hudIn(g.getImageData(0, 0, a.w, a.h), l) > 0.5) hits.set(l, hits.get(l)! + 1);
    }
  }
  video.currentTime = 0;
  await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
  return hits.get(MOBILE)! > hits.get(CONTROLLER)! ? MOBILE : CONTROLLER;
}

/** The stopwatch at the ticks the domain asks for, and the boss's name; nothing if the text reader can't load. */
async function readWords(got: Sampled, layout: Layout): Promise<{ clock: ClockReading[]; enemy?: string }> {
  // The stopwatch's picture nearest each time asked for.
  const near = (t: number) => got.clocks.reduce<[number, Px] | undefined>((a, b) => (Math.abs(b[0] - t) < Math.abs((a?.[0] ?? Infinity) - t) ? b : a), undefined);
  const picks = clockAnchors(got.samples).flatMap((t) => {
    const c = near(t);
    return c && Math.abs(c[0] - t) <= CLOCK_EVERY ? [c] : [];
  });
  try {
    const texts = await recognize(picks.map(([, px]) => canvasOf(clockInk(px, layout))), '0123456789:');
    const names = got.enemies.length ? await recognize(got.enemies.map((p) => canvasOf(whiteInk(p)))) : [];
    return { clock: picks.map(([t], k) => ({ t, text: texts[k] })), enemy: enemyName(names) };
  } catch {
    return { clock: [] };
  }
}

/** Plays the video through, measuring each frame shown with `layout`'s areas. */
async function sampleVideo(video: HTMLVideoElement, layout: Layout, cancelled: () => boolean, progress: (done: number) => void): Promise<Sampled> {
  const scale = READ_HEIGHT / video.videoHeight;
  const a = areas(Math.round(video.videoWidth * scale), layout);
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
  const enemy = a.enemy && cut(a.enemy);
  const meter = a.stagger && cut(a.stagger);
  const hpBar = a.bossHp && cut(a.bossHp);
  // The boss's bars change slowly: every third frame, so reading them costs few frames.
  let frames = 0;
  const out: Sampled = { samples: [], portraits: [], clocks: [], enemies: [] };
  let seenOn = 0;
  const take = (t: number) => {
    const px = clock.read();
    const bars = frames++ % 3 === 0;
    const s = measure(t, right.read(), centre.read(), banner.read(), px, layout, bars ? meter?.read() : undefined, bars ? hpBar?.read() : undefined);
    out.samples.push(s);
    // The stopwatch now and then (the domain picks a few moments to read).
    if (t - (out.clocks[out.clocks.length - 1]?.[0] ?? -Infinity) >= CLOCK_EVERY) out.clocks.push([t, px]);
    if (enemy && s.hud > 0.5 && [60, 600, 1800].includes(seenOn + 1)) out.enemies.push(enemy.read());
    // Each slot's picture (portraits, or the phone's skill buttons), once the HUD has been up a moment.
    if (s.hud > 0.5 && ++seenOn === 30) {
      const { at, above, size } = layout.faces;
      const from = layout.faces.area === 'right' ? right : portraits;
      from.read();
      out.portraits = at.map(([x, y]) => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        c.getContext('2d')!.drawImage(from.c, x - size / 2, y - above, size, size, 0, 0, 64, 64);
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
      let missedAt = -Infinity;
      const onFrame = (_: number, meta: VideoFrameCallbackMetadata) => {
        if (cancelled()) return resolve();
        if (video.paused) return;
        // Already at the slowest: what it shows is what this device can measure, so go on.
        if (last >= 0 && meta.mediaTime - last > MISSED && speed > SLOWEST) {
          // Frames went by unseen (a busy device): back up, a little slower.
          speed = Math.max(SLOWEST, speed / 2);
          missedAt = last;
          video.playbackRate = speed;
          video.currentTime = last + 1 / 60;
        } else if (meta.mediaTime > last) {
          take(meta.mediaTime);
          last = meta.mediaTime;
          // 5 s with none missed: back up to speed.
          if (speed < SPEED && last - missedAt > 5) {
            speed = Math.min(SPEED, speed * 2);
            missedAt = last;
            video.playbackRate = speed;
          }
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

/** Seconds as m:ss.s, as the game's stopwatch reads (with tenths). */
const secs = (t: number) => `${t < 0 ? '-' : ''}${Math.floor(Math.abs(t) / 60)}:${(Math.abs(t) % 60).toFixed(1).padStart(4, '0')}`;

/** The transcript, for the player to name the operators and fix guesses. */
function review(dlg: HTMLDialogElement, reading: Reading, portraits: string[], operators: string[], simulate: ((v: VideoRotation) => void) | undefined, seconds: number, enemy: string | undefined, layout: Layout, done: () => void): void {
  const SLOTS = layout.slots;
  const start = reading.start ?? 0;
  const clock = reading.clock;
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  const steps = reading.steps;
  // Who's in each HUD slot: the player picks, beside the portrait from the video (until then, the slot's place).
  const slotName: string[] = [...SLOTS];
  // The slots in team position order (position 01 matters to some kits), for the review and the sim.
  const order = SLOTS.map((_, i) => i).sort((a, b) => (layout.positions?.[a] ?? a + 1) - (layout.positions?.[b] ?? b + 1));
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
          <h2 class="heading-20">${reading.start === null ? 'No fight found' : `Read ${presses()} actions`}</h2>
          <p class="copy-13 secondary">${reading.start === null
            ? 'Record with the HUD showing: the SP bar, the skill buttons and the portraits.'
            : `${enemy ? `${enemy} · ` : ''}${clock ? `${mmss(clock.seconds)} on the stopwatch${clock.pauses.length ? `, stopped ${clock.pauses.map(([a, b]) => `${(b - a).toFixed(1)} s at ${secs(a - start)}`).join(', ')}` : ''}. ` : ''}Times from when the HUD first shows. Read in ${seconds}s. A list on an action means whose it was is a guess.`}</p>
        </div>
        ${reading.start === null
          ? ''
          : html`<div class="reader-body reader-list">
              <div class="gameplay-slots">
                ${order.map(
                  (i, k) => html`<label class="gameplay-slot">
                    ${portraits[i] ? html`<img src="${portraits[i]}" alt="" width="40" height="40" />` : ''}
                    <span class="label-12 secondary">${k + 1} · ${SLOTS[i]}</span>
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
                    ${strike ? '' : pick ? slotSelect(slotOf(s), `data-gameplay-step="${k}"`) : nameOf(s)}${strike ? '' : ' · '}${READ_NAME[s.input]}${s.interrupt ? ' · Interrupt' : ''}${s.back ? ` · ${s.back} SP back` : ''}
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
        names: order.map((i) => slotName[i]),
        steps: steps.map((s) => ({ t: s.t - start, slot: order.indexOf(slotOf(s)!) as Slot, input: s.input, ...(s.interrupt ? { interrupt: true } : {}), ...(s.back ? { back: s.back } : {}) })),
        seconds: clock ? clock.seconds : Math.ceil(end - start),
        end: (clock?.end ?? end) - start,
        pauses: (clock?.pauses ?? []).map(([a, b]) => [a - start, b - start]),
        ...(reading.guards ? { guard: reading.guards.map(([a, b]) => [a - start, b - start] as [number, number]) } : {}),
        ...(reading.boss ? { boss: reading.boss.map(([t, hp, st]) => [Math.round((t - start) * 1000) / 1000, hp, st] as [number, number, number]) } : {}),
        enemy,
      });
      done();
      // Its results show on the Rotations page.
      if (!location.pathname.startsWith('/rotations')) {
        history.pushState(null, '', '/rotations');
        dispatchEvent(new PopStateEvent('popstate'));
      }
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
