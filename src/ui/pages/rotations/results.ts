import { FPS } from '../../../domain/sim/engine';
import { type BuffSpan, ENEMIES, INPUT_NAME, type SimResult } from '../../../domain/sim/team';
import { icon, itemImg, metric, metrics } from '../../components';
import { EF_ASSETS_CDN } from '../../../domain/banners';
import { html, type Html } from '../../html';
import { tip, tipRow } from '../../charts';
import { page, type VideoStep } from './state';
import { big, clockTime, pct, secs, spText } from './text';
import { formLength, formOf, simTrack, steps, tipDmg, tipSp, type Track } from './track';
import { buffRows, buffsPanel } from './buffs';
import { bossRow, playControls, preparePlay, spRow } from './player';

const foeIcon = (foe: (typeof ENEMIES)[number]) => `${EF_ASSETS_CDN}/icons/enemies/${foe.icon}.webp`;
/**
 * A boss's face: its picture zoomed in on the face (ENEMIES `face`), as a box's background (the share each way that
 * puts the face in the box's middle).
 */
export const foeFace = (foe: (typeof ENEMIES)[number], cls: string) => {
  const [x, y, zoom] = foe.face;
  const at = (f: number) => `${Math.max(0, Math.min(100, ((f * zoom - 0.5) / (zoom - 1)) * 100)).toFixed(1)}%`;
  return html`<span class="${cls}" role="img" aria-label="${foeName(foe)}" title="${foeName(foe)}" style="background-image:url('${foeIcon(foe)}');background-size:${zoom * 100}%;background-position:${at(x)} ${at(y)}"></span>`;
};
/** The boss's short name: its entry's without the stage ("Skydrummer"). */
const foeName = (foe: (typeof ENEMIES)[number]) => foe.name.replace(/\s*\(.*$/, '');

/** Seconds from the timeline's start (0, or a press cast before the stopwatch's 0) to its end. */
const spanOf = (seconds: number) => seconds - page.tlStart;
/** Where the timeline starts for these tracks: a whole second at least half a second before the earliest press. */
export function startOf(...tracks: ({ presses: { frame: number }[]; strikes?: { frame: number }[] } | undefined)[]): number {
  const first = Math.min(0, ...tracks.flatMap((t) => [...(t?.presses ?? []), ...(t?.strikes ?? [])].map((x) => x.frame)));
  return first < 0 ? Math.floor(first / FPS - 0.5) : 0;
}
/** The fewest px a second gets on a phone (rotations.css --tl-pps: it scrolls sideways beyond it); a wider screen fits the fight. */
const PHONE_PPS = 24;
const PHONE = typeof matchMedia !== 'undefined' ? matchMedia('(max-width: 640px)') : null;
const phone = () => !!PHONE?.matches;
// Markers are spaced for the width they're drawn at: drawn again when the screen turns phone-sized or back.
PHONE?.addEventListener('change', () => page.redrawPage());
/** The track's width in px as rotations.css draws it (.sim-timeline), for spacing the markers. */
function trackPx(seconds: number): number {
  const shown = document.querySelector<HTMLElement>('.sim-tl-scroll')?.clientWidth ?? innerWidth - 120;
  return Math.max(shown - LABEL - 16, spanOf(seconds) * (phone() ? PHONE_PPS : 0)) * page.tlZoom;
}
/** The lanes' name column (px): a portrait or a short name; wider with the buffs' rows, which are named. */
const LABEL = 56;
/** Each marker's tier in its lane: the second where it would overlap the last one on the first. */
function tiers(frames: number[], pxPerFrame: number): number[] {
  let last = -Infinity;
  return frames.map((f) => {
    if ((f - last) * pxPerFrame >= 20) {
      last = f;
      return 0;
    }
    return 1;
  });
}

function lanes(r: Track, names: string[], dpsMax: number, buffs?: BuffSpan[], ids?: string[], seek?: SimResult): Html {
  // With the operators' ids (a parsed run's), each lane is named by a small portrait (the buffs at the playhead are in
  // the panel under the timeline). Every row is on one clock (`at`), from the timeline's start to its end, in one
  // area that scrolls sideways: the scrubber, the lanes, the axis and the playhead.
  const faces = !!ids?.length;
  const who = (name: string, slot: number) =>
    faces && ids![slot]
      ? html`<span class="sim-lane-name sim-lane-who" title="${name}">${itemImg('char', ids![slot], 'sim-lane-face')}</span>`
      : html`<span class="sim-lane-name label-12 ellipsis">${name}</span>`;
  // On the player's clock (its result's length: the Sim view's runs on past the recording's).
  const seconds = seek?.seconds ?? r.seconds;
  const end = seconds * FPS;
  const f0 = page.tlStart * FPS;
  // Who's controlled when: the swaps.
  const spans: { slot: number; from: number; to: number }[] = [];
  let cur = r.main;
  let from = f0;
  for (const p of r.presses)
    if (p.input === 'swap') {
      spans.push({ slot: cur, from, to: p.frame });
      cur = p.slot;
      from = p.frame;
    }
  spans.push({ slot: cur, from, to: end });
  const at = (f: number) => `${Math.max(0, Math.min(100, ((f - f0) / (end - f0)) * 100)).toFixed(3)}%`;
  const len = (f: number) => `${Math.max(0, Math.min(100, (f / (end - f0)) * 100)).toFixed(3)}%`;
  const px = trackPx(seconds) / Math.max(1, end - f0);
  const step = px * FPS >= 40 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(seconds / step) + 1 }, (_, k) => k * step);
  // A parsed run's lane is named by the boss's picture in a red ring, as operators' by their portraits.
  const foe = faces ? page.laneFoe : undefined;
  const enemyName = () => (foe ? html`<span class="sim-lane-name sim-lane-who">${foeFace(foe, 'sim-lane-face sim-foe-face')}</span>` : html`<span class="sim-lane-name label-12 ellipsis">Enemy</span>`);
  const p = (page.play.t - page.tlStart) / spanOf(seconds);
  return html`<div class="sim-tl-scroll"><div class="sim-timeline" role="img" aria-label="Actions over the fight" style="--tl-span:${spanOf(seconds).toFixed(2)};--tl-zoom:${page.tlZoom}">
    <div class="sim-lane sim-seek-lane"><span class="sim-lane-name"></span><span class="sim-seek-wrap" style="--p:${p}"><span class="num label-12 sim-play-time" aria-hidden="true">${clockTime(page.play.t)}</span><input class="sim-play-seek" type="range" min="${page.tlStart}" max="${seconds}" step="any" value="${page.play.t}" data-sim="play-seek" aria-label="Time" style="--p:${p}" /></span></div>
    ${names.map((name, slot) => {
      const presses = r.presses.filter((x) => x.slot === slot && x.input !== 'swap');
      const tier = tiers(presses.map((x) => x.frame), px);
      return html`<div class="sim-lane${tier.some((k) => k > 0) ? ' two' : ''}">
        ${who(name, slot)}
        <span class="sim-lane-track">
          ${spans.filter((s) => s.slot === slot).map((s) => html`<i class="sim-control" style="left:${at(s.from)};width:${len(s.to - s.from)}"></i>`)}
          ${(r.forms ?? []).filter((f) => f.slot === slot).map((f) => html`<i class="sim-form" style="left:${at(f.frame)};width:${len(f.end - f.frame)}" data-tip="${tip('Ultimate', [tipRow('Time', secs(f.frame)), tipRow('Length', formLength(f))])}"></i>`)}
          ${r.strikes
            .filter((s) => s.slot === slot)
            .map((s) => html`<i class="sim-strike${s.finisher ? ' finisher' : ''}" style="left:${at(s.frame)}" data-tip="${tip(s.finisher ? 'Finisher' : 'Final Strike', [tipRow('Time', secs(s.frame)), ...tipDmg(r.strikeDmg, r.strikes, s), ...tipSp(r.strikeSp, r.strikes, s)])}"></i>`)}
          ${presses.map((x, k) => html`<i class="sim-press ${x.input}${tier[k] ? ' t1' : ''}" style="left:${at(x.frame)}" data-tip="${tip(INPUT_NAME[x.input], [tipRow('Time', secs(x.frame)), ...(formOf(r, x) ? [tipRow('Length', formLength(formOf(r, x)))] : []), ...tipDmg(r.pressDmg, r.presses, x), ...tipSp(r.pressSp, r.presses, x)])}">${x.input === 'battle' ? 'B' : x.input === 'combo' ? 'C' : x.input === 'dive' ? 'D' : 'U'}</i>`)}
        </span>
      </div>${buffRows(buffs, slot, name, at, len)}`;
    })}
    ${r.dps.length && dpsMax > 0
      ? html`<div class="sim-lane">
          <span class="sim-lane-name label-12 ellipsis">Damage</span>
          <span class="sim-lane-track sim-dmg">${r.dps.map((d, k) => (d > 0 ? html`<i style="left:${at(k * FPS)};width:${len(FPS)};height:${Math.max(4, Math.round((d / dpsMax) * 100))}%" data-tip="${tip('Damage', [tipRow('Time', `${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')}`), tipRow('Damage', big(d))])}"></i>` : ''))}</span>
        </div>`
      : ''}
    ${r.staggers.length || r.mechanics.length || r.away.length || r.guard.length
      ? html`<div class="sim-lane">
          ${enemyName()}
          <span class="sim-lane-track">${r.away.map(([a, b]) => html`<i class="sim-away" style="left:${at(a)};width:${len(b - a)}" data-tip="${tip('Invulnerable', [tipRow('Time', secs(a)), tipRow('Length', `${((b - a) / FPS).toFixed(1)} s`)])}"></i>`)}${r.guard.map(([a, b]) => html`<i class="sim-guard" style="left:${at(a)};width:${len(b - a)}" data-tip="${tip('No Stagger', [tipRow('Time', secs(a)), tipRow('Length', `${((b - a) / FPS).toFixed(1)} s`)])}"></i>`)}${r.staggers.map((s) => html`<i class="sim-stagger" style="left:${at(s.frame)};width:${len(s.end - s.frame)}" data-tip="${tip('Staggered', [tipRow('Time', secs(s.frame)), tipRow('Length', `${((s.end - s.frame) / FPS).toFixed(1)} s`)])}"></i>`)}${r.mechanics.map((m) => html`<i class="sim-mechanic" style="left:${at(m.frame)}" data-tip="${tip(m.label, [tipRow('Time', secs(m.frame))])}">${icon(m.label === 'Interrupted' ? 'close' : m.label === 'Stagger node' ? 'change_history' : 'swords')}</i>`)}</span>
        </div>`
      : faces || (page.fold.buffs && buffs?.some((b) => b.slot < 0))
        ? html`<div class="sim-lane">${enemyName()}<span class="sim-lane-track"></span></div>`
        : ''}
    ${buffRows(buffs, -1, 'Enemy', at, len)}
    <div class="sim-lane sim-axis"><span class="sim-lane-name"></span><span class="sim-lane-track">${ticks.map((t) => html`<span class="label-12 secondary${t * FPS <= f0 ? ' first' : t === seconds ? ' last' : ''}" style="left:${at(t * FPS)}">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span>`)}</span></div>
    <i class="sim-playhead" aria-hidden="true"></i>
  </div></div>`;
}

/** The Buffs eye over the timeline, when the run has buffs. */
const buffsFold = (r: SimResult) => (r.buffs?.length ? html`<span class="sim-play-extra">${foldButton('buffs', 'Buffs', true)}</span>` : undefined);
/** "Buffs at <time>" under the timeline: a row per operator, then the boss (`page.laneFoe`). */
const panelOf = (r: SimResult, names: string[], ids: string[]) =>
  buffsPanel(r.buffs, [...names.map((name, slot) => ({ slot, name, face: itemImg('char', ids[slot], 'sim-lane-face') })), { slot: -1, name: page.laneFoe ? foeName(page.laneFoe) : 'Enemy', face: page.laneFoe ? foeFace(page.laneFoe, 'sim-lane-face sim-foe-face') : html`<span class="label-12">Enemy</span>` }]);

/** The sim's timeline with the player around it (a run that isn't a recording's: one timeline). */
function timeline(r: SimResult, names: string[], ids: string[]): Html {
  const t = simTrack(r);
  page.tlStart = startOf(t, r);
  return html`${(preparePlay(r), '')}${playControls(buffsFold(r))}${lanes(t, names, Math.max(...t.dps, 0), r.buffs, ids, r)}<div class="sim-player">${bossRow('Boss', 'sim')}</div>${panelOf(r, names, ids)}`;
}

export const foldButton = (what: keyof typeof page.fold, label: string, iconOnly = false) =>
  html`<button type="button" class="sim-fold-btn label-12 secondary" data-action="sim-fold" data-value="${what}" title="${page.fold[what] ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}" aria-label="${label}" aria-expanded="${page.fold[what] ? 'true' : 'false'}">${iconOnly ? '' : `${label} `}${icon(page.fold[what] ? 'visibility_off' : 'visibility')}</button>`;

export const STEP_NAME: Record<VideoStep['input'], string> = { battle: 'Battle skill', combo: 'Combo skill', ultimate: 'Ultimate', strike: 'Final Strike', finisher: 'Finisher', dive: 'Dive attack', swap: 'Swap in' };

/**
 * Every name the transcript's operator column can hold, invisible and flat: the column is as wide as the widest in both
 * views (a choice sizes itself by its options in another font, and lines only show some names).
 */
/** The action column's labels: the editor's choices and every label the transcript shows (Staggered, mechanics...). */
export const moveLabels = (track: Track) => [...new Set([...Object.values(STEP_NAME), 'Invulnerable', ...steps(track).map((p) => p.label)])];
/** Every label the action column can hold, invisible and flat: the column is as wide as the widest in both views. */
export const actSizers = (labels: string[]) => html`${labels.map((n) => html`<span class="sim-move-size" aria-hidden="true">${n}</span>`)}`;
export const opSizers = (names: string[]) => html`${[...names, 'Enemy'].map((n) => html`<span class="sim-move-size" aria-hidden="true">${n}</span>`)}`;

/** How the controlled operator held: the whole fight, or swapped after the start. */
const controlledSub = (r: SimResult) => (new Set((r.strikes ?? []).map((x) => x.slot)).size > 1 ? 'at the start, swaps after' : 'the whole fight');

export function resultsView(r: SimResult, names: string[], ids: string[], stale: boolean, extra: { recording?: Track; simTrack?: Track; underTimeline?: Html; dpsMax?: number; unattributed?: number; noMetrics?: boolean; editor?: (track: Track) => Html; timeline?: SimResult } = {}): Html {
  const rec = extra.recording;
  const shown: Track | null = rec ? (page.view === 'recording' ? rec : (extra.simTrack ?? simTrack(r))) : null;
  const dps = r.total / r.seconds;
  const time = clockTime(r.seconds);
  const shares = ids.map((id, slot) => ({ id, slot, total: r.byOperator[id] ?? 0 })).sort((a, b) => b.total - a.total);
  return html`<div class="sim-results${stale ? ' stale' : ''}">
    ${extra.noMetrics ? '' : metrics([
      ...(r.hp ? [metric({ label: 'Clear time', value: r.killed ? time : 'Not defeated', sub: r.killed ? `${big(r.hp)} HP` : `${big(r.total)} of ${big(r.hp)} HP in ${time}` })] : []),
      metric({ label: 'DPS', value: big(dps) }),
      metric({ label: 'Total damage', value: big(r.total), sub: `${time} duration` }),
      metric({ label: 'Actions', value: String(r.presses.length), sub: 'besides basic attacks' }),
      ...(names[r.main] ? [metric({ label: 'Controlled', value: names[r.main], sub: controlledSub(r) })] : []),
    ])}
    ${extra.noMetrics ? '' : html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Damage by operator</h2>
      ${shares.map(
        (s) => html`<div class="sim-share">
          ${itemImg('char', s.id, 'sim-portrait sm')}
          <span class="min0 ellipsis">${names[s.slot]}</span>
          <span class="sim-bar"><i style="width:${r.total ? (s.total / r.total) * 100 : 0}%"></i></span>
          <span class="num">${pct(r.total ? s.total / r.total : 0)}</span>
        </div>`,
      )}
    </div></section>`}
    <section class="card"><div class="card-body sim-card sim-faces${page.fold.buffs && r.buffs?.length ? ' sim-buff-names' : ''}">
      ${rec ? '' : html`<div class="sim-fold-head"><h2 class="heading-16">Timeline</h2></div>`}
      ${r.order
        ? html`<p class="copy-14">Control ${names[r.main]}. Combo skills as they come up, ultimates when charged, and these battle skills in turn, over and over:</p>
            <ol class="sim-order copy-14">${r.order.map(([slot, input]) => html`<li>${names[slot]} · ${INPUT_NAME[input]}</li>`)}</ol>`
        : ''}
      ${shown
        ? html`${((page.tlStart = startOf(rec, extra.simTrack, extra.timeline ?? r)), preparePlay(extra.timeline ?? r), '')}${playControls(buffsFold(r))}${lanes(shown, names, extra.dpsMax ?? Math.max(...shown.dps, 0), r.buffs, ids, extra.timeline ?? r)}${page.view === 'recording' ? html`${bossRow('', 'video')}${spRow('video')}` : html`${bossRow('', 'sim')}${spRow('sim')}`}${panelOf(r, names, ids)}`
        : timeline(r, names, ids)}
      ${rec && page.view !== 'sim' ? '' : (extra.underTimeline ?? '')}
      ${extra.editor
        ? extra.editor(shown ?? simTrack(r))
        : html`<div class="sim-moves-wrap">
      <ol class="sim-moves copy-14${page.fold.moves ? '' : ' one'}">
        ${((page.actLabels = moveLabels(shown ?? simTrack(r))), '')}${steps(shown ?? simTrack(r)).map((p) => html`<li class="${p.strike ? 'secondary' : ''}" data-t="${p.frame / FPS}"><span></span><button type="button" class="sim-seek num" data-action="sim-seek" data-value="${String(p.frame / FPS)}" title="Go to ${secs(p.frame)}">${secs(p.frame)}</button><span class="sim-move-op">${p.slot < 0 ? 'Enemy' : names[p.slot]}${opSizers(names)}</span><span class="sim-move-dot">·</span><span class="sim-move-act">${p.label}${actSizers(page.actLabels)}</span><span></span><span></span><span class="num secondary sim-move-len" ${p.length ? html`data-tip="${tip('How long the ultimate lasted', [])}"` : ''}>${p.length ?? ''}</span><span class="num sim-move-sp${p.sp && p.sp < 0 ? ' used' : ''}" ${p.sp ? html`data-tip="${tip(`${p.sp > 0 ? 'Gained' : 'Used'} ${Math.abs(p.sp)} SP`, p.spAfter !== undefined ? [tipRow('After', String(p.spAfter))] : [])}"` : ''}>${spText(p.sp)}</span><span class="num sim-move-spafter">${p.sp !== undefined && p.spAfter !== undefined ? `→ ${p.spAfter}` : ''}</span><span class="num sim-move-dmg">${p.dmg ? big(p.dmg) : ''}</span></li>`)}
      </ol>
      ${foldButton('moves', 'Full transcript')}
      </div>`}
    </div></section>
    ${extra.noMetrics ? '' : html`<section class="card"><div class="card-body sim-card">
      <h2 class="heading-16">Where the damage comes from</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Operator</th><th>Source</th><th class="num">Hits</th><th class="num">Damage</th><th class="num">Share</th></tr></thead>
        <tbody>${r.sources.slice(0, 24).map((s) => html`<tr><td>${names[ids.indexOf(s.op)] ?? s.op}</td><td>${s.source}</td><td class="num">${s.hits}</td><td class="num">${big(s.total)}</td><td class="num">${pct(s.total / r.total)}</td></tr>`)}${extra.unattributed ? html`<tr><td class="secondary">Not attributed</td><td class="secondary">No action read for it</td><td class="num"></td><td class="num">${big(extra.unattributed)}</td><td class="num">${pct(extra.unattributed / r.total)}</td></tr>` : ''}</tbody>
      </table></div>
    </div></section>`}
  </div>`;
}

export const CREDIT = html`<p class="copy-13 secondary">Game data © Gryphline / Hypergryph. Damage formula from endfield.wiki.gg, CC BY-SA 4.0. Simulated in this browser.</p>`;
