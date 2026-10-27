import { type Enemy, FPS } from '../../../domain/sim/engine';
import { compareWithVideo } from '../../../domain/sim/videoCheck';
import { enemyById, enemySeen, knownEnemy, INPUT_NAME, type ReplayResult, type SimRequest, type SimResult, type SimSettings, spGained } from '../../../domain/sim/team';
import { type SavedSim, saveSimVideo } from '../../../store';
import { icon, itemImg, toggleGroup } from '../../components';
import { itemIconUrl } from '../../../domain/banners';
import { tintFor } from '../../tint';
import { html, type Html } from '../../html';
import { tip, tipRow } from '../../charts';
import { infoHref } from '../info';
import type { VideoRotation } from '../../rotationReader';
import { type CombatIndex, page, type VideoStep, type Wiki } from './state';
import { big, clockTime, pct, secs, spText, when } from './text';
import { simLong, simTrack, steps, type Track, withRunOn } from './track';
import { recordingCard } from './fit';
import { actSizers, CREDIT, foeFace, foldButton, moveLabels, opSizers, resultsView, STEP_NAME } from './results';
import { buildLines, buildOf, foodLine, foodPicker, inl, levelsEdit, levelsLine, pickable } from './builds';
import { headTools, isRecording, parseButtons, runLine, runReplay, videoOf } from './runs';

export const onDraft = (el: HTMLElement | null): void => {
  page.readerEl = el;
  page.hasDraft = !!el;
  page.draftOpen = !!el;
  if (el) page.replay = null;
  page.redrawPage();
};
/** A reviewed read goes to the sim: its run opens when played. */
export const simulated = (v: VideoRotation): void => {
  page.video = v;
  page.lastVideo = v;
  void saveSimVideo(v);
  page.draftOpen = false;
  page.redrawPage();
};
/** The review section into its place on the page, after each redraw. */
function mountReader(): void {
  const m = document.querySelector<HTMLElement>('[data-reader-mount]');
  if (m && page.readerEl && page.readerEl.parentElement !== m) m.replaceChildren(page.readerEl);
}

/**
 * The open parsed run, above the Recording: its time and name, its buttons under them (Edit transcript, star, edit,
 * delete), the name and note fields while edited, and the transcript editor.
 */
function runHead(title: string, body: Html, enemy = ''): Html {
  const entry = page.replay?.at === undefined ? undefined : page.runs.find((x) => x.at === page.replay!.at);
  if (!entry) return html`<section class="card"><div class="card-body sim-card">${body}</div></section>`;
  // Editing (Edit): its name and note fields where they show.
  const editing = page.draft?.at === entry.at;
  const at = String(entry.at);
  // The timeline's view and speed at the top (play and its time stay by the scrubber).
  const played = page.replay?.result && !page.replay.error ? page.replay : null;
  const rec = played ? recordingCard(played).recording : undefined;
  // Not a card: the run's header and summary lie on the page, its loadouts in their own boxes.
  return html`<section class="sim-run-head">
      <header class="sim-run-header">
        ${page.laneFoe ? foeFace(page.laneFoe, 'sim-run-foe') : ''}
        <div class="sim-run-title">
          <div class="sim-run-name-row">
            ${editing
              ? html`<span class="heading-24 sim-run-name-wrap" data-value="${entry.name ?? title}"><input class="heading-24 sim-run-name" data-sim="runname" data-at="${at}" data-title="${title}" value="${entry.name ?? title}" placeholder="${title}" aria-label="Name" maxlength="80" size="1" /></span>`
              : html`<h2 class="heading-24">${entry.name ?? title}</h2>`}
            ${page.draft?.at === entry.at
              ? html`<button type="button" class="btn primary sm icon-only" data-action="sim-step-save" title="${page.replayWorker ? 'Playing…' : 'Play edited transcript'}" aria-label="Play edited transcript" ${page.replayWorker ? 'disabled' : ''}>${icon(page.replayWorker ? 'hourglass_empty' : 'refresh')}</button>`
              : ''}
          </div>
          <p class="copy-14 secondary sim-run-sub">${when(entry.at)} · ${runLine(entry, entry.names)}${enemy ? ` · ${enemy}` : ''}</p>
        </div>
        <div class="sim-run-buttons">
          ${played && rec ? html`<div class="sim-run-play">${toggleGroup('sim-view', [['recording', 'Recording'], ['sim', 'Sim']], page.view)}</div>` : ''}
          ${page.draft?.at === entry.at
            ? html`<button type="button" class="btn error sm icon-only" data-action="sim-step-cancel" title="Discard changes" aria-label="Discard changes">${icon('close')}</button><button type="button" class="btn secondary sm icon-only" data-action="sim-step-done" title="Save changes" aria-label="Save changes" ${page.replayWorker ? 'disabled' : ''}>${icon('check')}</button>`
            : videoOf(entry)
              ? html`<button type="button" class="btn secondary sm icon-only" data-action="sim-transcript" data-value="${String(entry.at)}" title="Edit name, note, loadouts and transcript" aria-label="Edit">${icon('edit')}</button>`
              : ''}
          <button type="button" class="btn secondary sm icon-only" data-action="sim-export" data-value="${String(entry.at)}" title="Export" aria-label="Export">${icon('ios_share')}</button>
          ${headTools(entry)}
        </div>
      </header>
      ${body}
    </section>`;
}

/**
 * Where the replay parts from the video's boss bars (its HP and Stagger meter, read by the parser), so the
 * transcript can be fixed there.
 */
function videoCheck(r: NonNullable<typeof page.replay>): Html {
  const entry = r.at === undefined ? undefined : page.runs.find((x) => x.at === r.at);
  const reading = entry && videoOf(entry);
  const track = r.result?.track;
  if (!entry || !reading?.boss?.length || !track?.length) return html``;
  const asked = (JSON.parse(entry.key) as { enemy?: string | Enemy }).enemy;
  const enemy = typeof asked === 'object' ? asked : enemyById(asked).enemy;
  if (!enemy.phaseHp || !enemy.poise) return html``;
  const dismissed = new Set(entry.dismissed ?? []);
  const keyOf = (d: { kind: string; t: number }) => `${d.kind}@${d.t.toFixed(1)}`;
  const all = compareWithVideo(track, reading.boss, reading.pauses ?? [], enemy.phaseHp, enemy.poise);
  const found = all.filter((d) => !dismissed.has(keyOf(d)));
  const hidden = all.length - found.length;
  const what = (d: (typeof found)[number]) =>
    d.kind === 'damage'
      ? `Damage ${Math.round(Math.abs(d.by) * 100)}% ${d.by > 0 ? 'above' : 'below'} the video`
      : d.kind === 'staggered'
        ? d.by > 0
          ? 'Staggered before the video'
          : 'Staggered after the video'
        : `Stagger ${Math.abs(d.by)} ${d.by > 0 ? 'above' : 'below'} the video`;
  const at = String(entry.at);
  return html`<div class="sim-fold">
    <div class="sim-fold-head">${foldButton('checks', `Recording-sim discrepancies${found.length ? ` (${found.length})` : ''}`)}</div>
    ${!page.fold.checks
      ? ''
      : found.length
      ? html`<ol class="sim-check copy-14">
          ${found.map(
            (d) => html`<li>
              <span class="num secondary">${clockTime(d.t)}</span>
              <span class="min0">${what(d)}${d.hint ? html` <span class="secondary">· ${d.hint}</span>` : ''}</span>
              <button type="button" class="btn tertiary sm icon-only" data-action="sim-dismiss" data-at="${at}" data-value="${keyOf(d)}" title="Dismiss" aria-label="Dismiss">${icon('check')}</button>
            </li>`,
          )}
        </ol>`
        : html`<p class="copy-14 secondary">${all.length ? 'All dismissed.' : 'Matches the boss’s bars: damage within 10%, Stagger within 12.'}</p>`}
    ${page.fold.checks && hidden ? html`<div class="sim-run"><button type="button" class="btn tertiary sm" data-action="sim-undismiss" data-value="${at}">Show ${hidden} dismissed</button></div>` : ''}
  </div>`;
}

/** The video's rotation as the sim played it: the usual results, and the presses it couldn't make. */
function replayView(r: NonNullable<typeof page.replay>, card?: ReturnType<typeof recordingCard>): Html {
  const missed = r.result?.missed ?? [];
  return html`<section class="sim-video">
    ${r.error
      ? html`<p class="copy-14 sim-error">${r.error}</p>`
      : !r.result
        ? html`<p class="copy-14 secondary">${icon('hourglass_empty')} Playing the recording’s actions…</p>`
        : html`${(() => {
            const c = card ?? recordingCard(r);
            const entry = page.draft && r.at !== undefined && page.draft.at === r.at ? page.runs.find((x) => x.at === r.at) : undefined;
            const long = page.view === 'sim' ? simLong(c.shown, r.result as ReplayResult) : undefined;
            return resultsView(c.shown, r.names, r.ids, false, { ...c, ...(long && long !== c.shown ? { timeline: long, simTrack: withRunOn(c.simTrack ?? simTrack(c.shown), long) } : {}), underTimeline: videoCheck(r), noMetrics: !!card, editor: entry ? (track: Track) => transcriptLines(entry, track) : undefined });
          })()}
            ${missed.length ? html`<p class="copy-13 secondary">The sim couldn’t make ${missed.length === 1 ? 'this action' : `these ${missed.length} actions`} in time: ${missed.map((m) => `${secs(m.t * FPS)} ${r.names[m.slot]} · ${m.input === 'strike' ? 'Final Strike' : INPUT_NAME[m.input]}`).join(', ')}.</p>` : ''}`}
  </section>`;
}

/**
 * A time typed in the transcript editor (m:ss.s as shown, or seconds) as the recording's time: shown on the fight's
 * clock, so the stopwatch's pauses before it are added back.
 */
export function videoTimeOf(text: string): number | undefined {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  let t = Number(m[1] ?? 0) * 60 + Number(m[2]);
  const entry = page.draft && page.runs.find((x) => x.at === page.draft!.at);
  for (const [a, b] of (entry && videoOf(entry)?.pauses) ?? []) if (t >= a) t += b - a;
  return Math.round(t * 100) / 100;
}

/** The open parsed run's presses to edit: time (seconds into the fight), operator, press; then played again. */
function transcriptLines(x: SavedSim<SimResult>, track: Track): Html {
  const reading = videoOf(x);
  if (!page.draft || page.draft.at !== x.at || !reading) return html``;
  // Each line's SP and damage as the transcript shows them (the view's track): its action there, the same operator and
  // kind nearest in time (within 3 s, as matchActions), each used once.
  const pool = steps(track).filter((p) => p.slot >= 0);
  const used = new Set<number>();
  const shownOf = (st: VideoStep) => {
    const strike = st.input === 'strike' || st.input === 'finisher';
    let best = -1;
    pool.forEach((p, j) => {
      if (used.has(j) || p.slot !== st.slot || p.strike !== strike || Math.abs(p.frame / FPS - st.t) > 3) return;
      if (best < 0 || Math.abs(p.frame / FPS - st.t) < Math.abs(pool[best].frame / FPS - st.t)) best = j;
    });
    if (best >= 0) used.add(best);
    return best >= 0 ? pool[best] : undefined;
  };
  // While a parsed run is edited its transcript's lines take fields in place: time, operator, action, a battle skill's
  // SP back, Interrupt; Invulnerable stretches after them. (Its length and who's controlled are in the figures above.)
  const labels = moveLabels(track);
  // Times as the transcript shows them, on the fight's clock (the stopwatch's pauses taken out; `stepClock`).
  const pauses = reading.pauses ?? [];
  const shownT = (t: number) => clockTime(t - pauses.reduce((n, [a, b]) => n + Math.max(0, Math.min(b, t) - a), 0));
  const time = (t: number, name: string, k: number, label: string) =>
    html`<input class="sim-inl num sim-move-time" type="text" inputmode="decimal" value="${shownT(t)}" data-sim="${name}" data-k="${k}" aria-label="${label}" title="${label} (m:ss.s)" />`;
  return html`<div class="sim-moves-wrap"><ol class="sim-moves sim-moves-edit copy-14">
      ${page.draft.steps.map(
        (s, k) => html`<li class="${s.input === 'strike' || s.input === 'finisher' ? 'secondary' : ''}">
          <button type="button" class="sim-line-del" data-action="sim-step-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
          ${time(s.t, 'step-t', k, 'Time')}
          <span class="sim-move-op"><select class="sim-inl-sel" data-sim="step-slot" data-k="${k}" aria-label="Operator">
            ${reading.names.map((n, i) => html`<option value="${i}" ${i === s.slot ? 'selected' : ''}>${n}</option>`)}
          </select>${opSizers(reading.names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act"><select class="sim-inl-sel" data-sim="step-input" data-k="${k}" aria-label="Action">
            ${Object.entries(STEP_NAME).map(([id, n]) => html`<option value="${id}" ${id === s.input ? 'selected' : ''}>${n}</option>`)}
          </select>${actSizers(labels)}</span>
          <span>${s.input === 'battle' ? html`<input class="sim-inl num" type="number" min="0" max="300" value="${spGained(s.back, x.ids[s.slot] ?? undefined) ?? ''}" placeholder="+0" style="--d:3" data-sim="step-back" data-k="${k}" title="SP gained (blank: unknown)" aria-label="SP gained" />` : ''}</span>
          <span class="sim-move-int">${s.input === 'battle' || s.input === 'combo' || s.input === 'ultimate' ? html`<input type="checkbox" data-sim="step-int" data-k="${k}" ${s.interrupt ? 'checked' : ''} title="It interrupted the boss's attack" aria-label="Interrupt" />` : ''}</span>
          ${(() => {
            const p = shownOf(s);
            return html`<span class="num secondary sim-move-len">${p?.length ?? ''}</span>`;
          })()}
          ${(() => {
            const p = shownOf(s);
            return html`<span class="num sim-move-sp${p?.sp && p.sp < 0 ? ' used' : ''}">${spText(p?.sp)}</span><span class="num sim-move-spafter">${p?.sp !== undefined && p.spAfter !== undefined ? `→ ${p.spAfter}` : ''}</span><span class="num sim-move-dmg">${p?.dmg ? big(p.dmg) : ''}</span>`;
          })()}
        </li>`,
      )}
      ${page.draft.away.map(
        ([a, b], k) => html`<li class="secondary">
          <button type="button" class="sim-line-del" data-action="sim-away-del" data-value="${k}" title="Remove" aria-label="Remove">${icon('close')}</button>
          ${time(a, 'away-a', k, 'From')}
          <span class="sim-move-op">Enemy${opSizers(reading.names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act">Invulnerable${actSizers(labels)}</span>
          <span>to ${time(b, 'away-b', k, 'To')}</span><span></span><span></span><span></span><span></span><span></span>
        </li>`,
      )}
    </ol>
    <div class="sim-moves-side">
      <button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-step-add">Add action ${icon('add')}</button>
      <button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-away-add">Add invulnerable ${icon('add')}</button>
    </div></div>`;
}

/**
 * The Parser tab: a gameplay recording's rotation as read (ui/rotationReader.ts), played in the sim. What the video
 * shows (team, enemy, every press) can't be changed here; only food, which a video can't show. Builds are the
 * operators' loadouts.
 */
export function parseView(wiki: Wiki, index: CombatIndex, s: SimSettings, redraw: () => void): Html {
  const open = page.replay?.at === undefined ? undefined : page.runs.find((x) => x.at === page.replay!.at);
  const v = page.video ?? (open && videoOf(open)) ?? page.lastVideo;
  const idOf = new Map(pickable(wiki, index, []).map((id) => [wiki.ops[id].name, id]));
  // The boss bar's name; an open run's own enemy when it's one of ENEMIES (the bar doesn't name the difficulty).
  const seen = v?.enemy;
  const asked = open && (JSON.parse(open.key) as { enemy?: string | Enemy }).enemy;
  const foe = (typeof asked === 'object' ? knownEnemy(asked) : undefined) ?? enemySeen(seen);
  page.laneFoe = foe;
  const ops = v ? v.names.map((n) => idOf.get(n)) : [];
  // A new reading's food is what was picked before simulating it.
  const builds = ops.map((op, i) => {
    const food = page.video ? page.video.food?.[page.video.names[i]] : s.videoFood?.[op ?? ''];
    return op ? buildOf({ op, ...(food ? { food } : {}) }, wiki, index) : null;
  });
  // An open run's own request: the builds and food it ran with, and its boss's stage rules.
  const runReq = open && !page.video ? (JSON.parse(open.key) as SimRequest) : undefined;
  // The stage's rules from the boss the recording names (saved requests predate them); no boss read: the dummy's.
  const foodOk = (foe?.enemy ?? enemyById().enemy).food !== false;
  if (page.video) {
    const pend = page.video;
    page.video = null;
    const unknown = pend.names.filter((_, i) => !ops[i]);
    if (unknown.length) page.replay = { names: pend.names, ids: [], error: `No combat data yet for ${unknown.join(', ')}.` };
    else if (builds.some((b) => !b!.build.weapon)) page.replay = { names: pend.names, ids: [], error: 'Every operator needs a weapon in their loadout.' };
    else
      runReplay(
        pend,
        pend.names.map((_, i) => i),
        { builds: builds.map((b) => b!.build), seconds: pend.seconds, style: 'advanced', effort: 'normal', ...(foe && foe.id !== 'dummy' ? { enemy: foe.enemy } : {}) },
        pend.names,
        ops as string[],
        redraw,
      );
  }
  const fact = (label: string, value: string | Html, sub?: string) => html`<div class="sim-run-fact"><span class="metric-label">${label}</span><span class="sim-run-value">${value}</span>${sub ? html`<span class="copy-13 secondary">${sub}</span>` : ''}</div>`;
  // The open run's figures (the recording's damage, as its breakdown below), laid out in its summary.
  const card = page.replay?.result && !page.replay.error ? recordingCard(page.replay) : undefined;
  page.liveDmg = card?.live;
  const shown = card?.shown;
  // The team's shares of the damage, in team order: each loadout box's bar shows them all, its own operator's bright.
  const shares = ops.map((op) => (shown && op && shown.total ? (shown.byOperator[op] ?? 0) / shown.total : 0));
  // Who was controlled, and how much: their share of the run's Final Strikes and Finishers (only the controlled
  // operator makes them); none read, the run's controlled operator.
  const strikes = shown?.strikes ?? [];
  const held = ops.map((_, k) => (strikes.length ? strikes.filter((x) => x.slot === k).length / strikes.length : shown && shown.main === k ? 1 : 0));
  const most = held.indexOf(Math.max(...held));
  // While editing, the outline is the draft's: whoever makes every Final Strike and Finisher (click a box to give
  // them all to that operator, `sim-main`).
  const draftMain = (() => {
    if (!open || page.draft?.at !== open.at) return undefined;
    const who = new Set(page.draft.steps.filter((x) => x.input === 'strike' || x.input === 'finisher').map((x) => x.slot));
    return who.size === 1 ? [...who][0] : -1;
  })();
  const controlClass = (k: number) =>
    draftMain !== undefined ? (k === draftMain ? ' controlled' : '') : !shown || !held[k] ? '' : k === most ? ' controlled' : ' controlled-some';
  // Each teammate's segment in their portrait's main colour (the Database hero glow's, tint.ts tintHeroes).
  const portrait = (op: string | undefined) => (op ? itemIconUrl('char', op) : null);
  const tintOf = (op: string | undefined) => {
    const src = portrait(op);
    return src ? tintFor(src) : 'var(--gray-alpha-400)';
  };
  const tinted = (op: string | undefined) => {
    const src = portrait(op);
    return src ? html`data-hero-tint="${src}" data-hero-tint-skin` : '';
  };
  const teamShare = (mine: number) =>
    html`<span class="sim-member-share" role="img" aria-label="${shares.map((x, k) => `${v?.names[k] ?? ''} ${pct(x)}`).join(', ')}; ${v?.names[mine] ?? ''}’s marked">${shares.map((x, k) => (x > 0 ? html`<i class="${k === mine ? 'on' : ''}" ${tinted(ops[k])} style="flex-basis:${(page.barShown.get(`${mine}|${ops[k] ?? ''}`) ?? x) * 100}%;--banner-tint:${tintOf(ops[k])}" data-live-box="${mine}" data-live-bar="${ops[k] ?? ''}" data-full="${x}" title="${v?.names[k] ?? ''} ${pct(x)}"></i>` : ''))}</span>`;
  // Under the Sim view, when the sim's boss died (ReplayResult.clear: the sim's own clear time, no time limit).
  const simRun = !page.replay?.error ? (page.replay?.result as ReplayResult | undefined) : undefined;
  const clear = page.view === 'sim' ? simRun?.clear : undefined;
  const clearTotal = clear !== undefined ? simRun?.clearTotal : undefined;
  // This side against the other (Recording: VS Sim; Sim: VS Run): how much sooner or later it cleared (the sim's to
  // its kill, the recording's to its stop).
  const versus = (() => {
    if (!simRun || !shown || !v) return html``;
    const simSecs = simRun.clear ?? simRun.seconds;
    const dt = page.view === 'sim' ? simSecs - v.seconds : v.seconds - simSecs;
    return fact(page.view === 'sim' ? 'VS Run' : 'VS Sim', `${Math.abs(dt).toFixed(1)} s ${dt <= 0 ? 'faster' : 'slower'}`);
  })();
  // The summary's damage: the recording's (the sim's split fitted to its HP bar), or under the Sim view the sim's own.
  const figures = page.view === 'sim' && page.replay?.result && !page.replay.error ? page.replay.result : shown;
  const team = html`${v
        ? html`<div class="sim-run-facts">
              ${figures ? fact('DPS', big((clearTotal ?? figures.total) / (clear ?? figures.seconds))) : ''}
              ${figures ? fact('Total damage', big(clearTotal ?? figures.total)) : ''}
              ${open && page.draft?.at === open.at && v
                ? fact('Duration', html`<input class="sim-inl num sim-run-value-edit" type="text" inputmode="decimal" value="${clockTime(page.draft.seconds)}" style="--d:${clockTime(page.draft.seconds).length}" data-sim="step-len" aria-label="Duration" title="The fight's length on its timer (m:ss.s or seconds)" />`)
                : fact('Duration', clockTime(clear ?? v.seconds))}
              ${fact('Actions', String(shown ? shown.presses.length : v.steps.filter((x) => x.input !== 'strike' && x.input !== 'finisher').length))}
              ${card?.unattributed && page.view !== 'sim' ? fact('Not attributed', big(card.unattributed), `${pct(card.unattributed / shown!.total)}: no action read for it`) : ''}
              ${versus}
              ${open && page.draft?.at === open.at
                ? html`<label class="sim-run-note-box"><textarea class="sim-run-note" data-sim="note" data-at="${String(open.at)}" placeholder="Note" aria-label="Note" maxlength="300" rows="2">${open.note ?? ''}</textarea></label>`
                : open?.note
                  ? html`<div class="sim-run-note-box"><p class="copy-13">${open.note}</p></div>`
                  : ''}
            </div>
            <div class="sim-team">
              ${v.names.map((name, i) => {
                const op = ops[i];
                const b = (runReq && open && page.draft?.at === open.at ? page.draft.builds[i] : runReq?.builds[i]) ?? builds[i]?.build;
                const editingRun = !!runReq && !!b && !!open && page.draft?.at === open.at;
                // This operator's share of the run's damage (the recording's, as the breakdown below splits it).
                const dealt = shown && op ? (shown.byOperator[op] ?? 0) : undefined;
                const share = dealt !== undefined && shown!.total ? dealt / shown!.total : undefined;
                return html`<div class="sim-member${controlClass(i)}${editingRun ? ' pickable' : ''}" ${editingRun ? html`data-action="sim-main" data-value="${i}" title="Click: ${name} controlled the whole fight"` : held[i] && shown ? html`style="--held:${held[i]}" title="Controlled ${i === most && held[i] === 1 ? 'the whole fight' : `${pct(held[i])} of the fight`}"` : ''}>
                  <div class="sim-op${editingRun ? ' editing' : ''}">${op ? html`<a class="sim-op-name" href="${infoHref('char', op)}" title="${name}’s page">${itemImg('char', op, 'sim-portrait')}${editingRun ? '' : html`<span class="label-14 ellipsis">${name}</span>`}</a>` : editingRun ? '' : html`<span class="label-14 ellipsis">${name}</span>`}${b ? html`<span class="label-12 secondary">P${editingRun ? inl(i, 'potential', b.potential, 0, 5, 'Potential') : b.potential}</span>` : ''}${b && editingRun ? levelsEdit(i, b) : b && levelsLine(b) ? html`<span class="label-12 secondary num sim-op-levels" title="Level and skill ranks">${levelsLine(b)}</span>` : ''}</div>
                  ${op && !runReq ? foodPicker(foodOk ? b?.food : undefined, foodOk, runReq ? html`data-sim="runfood" data-i="${i}"` : html`data-sim="vfood" data-op="${op}"`) : ''}
                  <div class="sim-gear copy-13">${b ? buildLines(b, wiki, editingRun ? i : undefined) : ''}${b && runReq && foodOk ? foodLine(b, editingRun ? i : undefined) : ''}</div>
                  ${shown && op
                    ? (() => {
                        const own = shown.sources.filter((x) => x.op === op).sort((a, c) => c.total - a.total);
                        return own.length
                          ? html`<div class="sim-member-sources copy-13">
                              ${own.map((x) => html`<div class="sim-member-source" data-tip="${tip(x.source, [tipRow('Hits', String(x.hits))])}"><span class="min0 ellipsis">${x.source}</span><span class="num secondary" data-live="${x.op}|${x.source}" data-full="${x.total}">${big(x.total)}</span><span class="num" data-live-pct="${x.op}|${x.source}" data-full="${x.total / shown.total}">${pct(x.total / shown.total)}</span></div>`)}
                              <div class="sim-member-source total"><span>Total</span><span class="num" data-live-op="${op}" data-full="${dealt ?? 0}">${big(dealt ?? 0)}</span><span class="num" data-live-op-pct="${op}" data-full="${share ?? 0}">${pct(share ?? 0)}</span></div>
                              ${teamShare(i)}
                            </div>`
                          : '';
                      })()
                    : ''}
                </div>`;
              })}
            </div>`
        : ''}`;
  // A read waiting for picks, else the open run (its title, team and results), else a start; Parsed runs are in the
  // side column (runsAside).
  if (page.draftOpen && page.readerEl) {
    queueMicrotask(mountReader);
    return html`<section class="card reader-card"><div class="card-body" data-reader-mount></div></section>${CREDIT}`;
  }
  // The enemy in the subtitle when the title doesn't name it.
  const enemyLine = open && !open.name && foe ? '' : (foe?.name ?? (seen ? `${seen} (not in the sim yet: the training dummy)` : 'No boss read: the training dummy'));
  if (page.replay) return html`${runHead(foe?.name ?? seen ?? 'Parsed run', team, enemyLine)}${replayView(page.replay, card)}${CREDIT}`;
  return html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Parser</h2>
      <p class="copy-14 secondary">${page.runs.some(isRecording) ? 'Open a parsed run, or parse a gameplay recording.' : 'Parse a gameplay recording to see its rotation, timeline and damage.'}</p>
      <div class="sim-run">${parseButtons(false)}</div>
    </div></section>${CREDIT}`;
}
