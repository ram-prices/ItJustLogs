import { FPS } from '../../../domain/sim/engine';
import type { BuffSpan } from '../../../domain/sim/team';
import { EF_ASSETS, EF_ASSETS_CDN, mirrorUrl } from '../../../domain/banners';
import { html, type Html } from '../../html';
import { tip, tipRow } from '../../charts';
import { page } from './state';
import { clockTime, secs } from './text';

/** A buff's name: its status's, else from its id (an operator's or weapon's by its name, the rest in words). */
function buffName(b: BuffSpan): string {
  // Replays before the game's wording was used said Crystal (its data's kind) for Cryo.
  if (b.status) return b.status.replace(/^Crystal /, 'Cryo ');
  const words = (s: string) => {
    const t = s.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : '';
  };
  // A gear set's: by the set whose id (suit_criti01, from its pieces' ids) starts as the buff's does
  // (equipsuit_critsuitatk_01), its number settling sets of one kind (usp01, usp02); then what's left of the id.
  const suit = /^buff_equipsuit_(.*)$/.exec(b.id);
  if (suit && page.wikiNow) {
    const s = suit[1].replace(/_/g, '').toLowerCase();
    const sets = new Map<string, string>();
    for (const [id, g] of Object.entries(page.wikiNow.gear)) {
      const k = /_suit_([a-z]+\d*)_/.exec(id)?.[1];
      if (k && g.set) sets.set(k, g.set);
    }
    let best: { k: string; n: number; num: boolean } | null = null;
    for (const k of sets.keys()) {
      const letters = k.replace(/\d+$/, '');
      let n = 0;
      while (n < letters.length && s[n] === letters[n]) n++;
      const num = !!k.match(/\d+$/) && s.includes(k.match(/\d+$/)![0]);
      if (n >= 3 && (!best || n > best.n || (n === best.n && num && !best.num))) best = { k, n, num };
    }
    if (best) {
      const rest = s.slice(best.n).replace(/^suit/, '').replace(/\d+/g, '');
      return rest ? `${sets.get(best.k)} · ${words(rest)}` : sets.get(best.k)!;
    }
  }
  const m = /^buff_(chr_\d+_[a-z]+|wpn_[a-z]+_\d+)_?(.*)$/.exec(b.id);
  if (!m) return words(b.id.replace(/^buff_/, ''));
  const who = page.wikiNow?.ops[m[1]]?.name ?? page.wikiNow?.weapons[m[1]]?.name ?? m[1];
  return m[2] ? `${who} · ${words(m[2])}` : who;
}

/** A Susceptibility's or Amp's kind in the game's sprite names (icon_battle_affix_cryst_vulnerable). */
const AFFIX_SPRITE: Record<string, string> = { Spell: 'spell', Fire: 'fire', Cryst: 'cryst', Crystal: 'cryst', Pulse: 'pulse', Natural: 'natural', Nature: 'natural', Physical: 'physical' };
/** An enemy's elemental infliction as the game draws it: the element's orb. */
const INFLICT_SPRITE: Record<string, string> = { Fire: 'icon_energy_fusion_fire', Cryst: 'icon_energy_fusion_cryst', Pulse: 'icon_energy_fusion_pulse', Natural: 'icon_infliction_nature' };

export function loadBuffIcons(redraw: () => void): void {
  if (page.buffIconsAsked) return;
  page.buffIconsAsked = true;
  const only = `${EF_ASSETS}/icons/buffs/main-only.json`;
  fetch(only)
    .then((r) => (r.ok ? r : fetch(mirrorUrl(only)!)))
    .then((r) => (r.ok ? r.json() : null))
    .then((d: string[] | null) => {
      if (!d) return;
      page.buffMainOnly = new Set(d);
      redraw();
    })
    .catch(() => {});
  const url = `${EF_ASSETS}/icons/buffs/index.json`;
  fetch(url)
    .then((r) => (r.ok ? r : fetch(mirrorUrl(url)!)))
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Record<string, string> | null) => {
      if (!d) return;
      page.buffIcons = d;
      redraw();
    })
    .catch(() => {});
}

/** A buff's icon in the game (ef-assets icons/buffs/<sprite>.webp, from its UI bundle), if it has one. */
function buffIcon(b: BuffSpan): string | undefined {
  const fx = /^(vul|amp)_([^@]+)/.exec(b.id);
  const sprite = fx
    ? `icon_battle_affix_${AFFIX_SPRITE[fx[2]] ?? 'spell'}_${fx[1] === 'vul' ? 'vulnerable' : 'enhance'}`
    : b.id === 'haste'
      ? 'icon_battle_affix_speedup'
      : b.id.startsWith('inflict_')
        ? INFLICT_SPRITE[b.id.slice(8)]
        : page.buffIcons?.[b.id];
  return sprite ? `${EF_ASSETS_CDN}/icons/buffs/${sprite}.webp` : undefined;
}

/**
 * Under a lane, a row for each buff its owner held (the sim's, played from the recording's presses): its stretches on
 * the lane's clock, its name at the left (less the owner's own name), stacks and times on hover.
 */
export function buffRows(buffs: BuffSpan[] | undefined, slot: number, owner: string, at: (f: number) => string, len: (f: number) => string): Html {
  if (!page.fold.buffs || !buffs?.length) return html``;
  const rows = new Map<string, BuffSpan[]>();
  for (const b of buffs) if (b.slot === slot) rows.set(b.id, [...(rows.get(b.id) ?? []), b]);
  return html`${[...rows.values()].map((spans) => {
    const full = buffName(spans[0]);
    const name = full.startsWith(`${owner} · `) ? full.slice(owner.length + 3) : full;
    const src = buffIcon(spans[0]);
    return html`<div class="sim-lane sim-buff-lane">
      <span class="sim-lane-name label-12 ellipsis" title="${full}">${src ? html`<img class="sim-buff-row-icon" src="${src}" alt="" onerror="this.remove()" />` : ''}${name}</span>
      <span class="sim-lane-track">${spans.map(
        (s) => html`<i class="sim-buff${slot < 0 ? ' debuff' : ''}" style="left:${at(s.from * FPS)};width:${len(Math.max(s.to - s.from, 0.15) * FPS)}" data-tip="${tip(full, [tipRow('Time', `${secs(s.from * FPS)}–${secs(s.to * FPS)}`), ...(s.level ? [tipRow('Level', String(s.stacks))] : s.stacks > 1 ? [tipRow('Stacks', String(s.stacks))] : [])])}"></i>`,
      )}</span>
    </div>`;
  })}`;
}

/**
 * Under the timeline, the buffs at the playhead: a row for each operator and the boss (its face, its chips on one line
 * that scrolls sideways, how many), the playhead's time in the heading, a tapped chip's name and stacks under it.
 * paintBuffs fills it. The boss's Arts Inflictions stay by its bars.
 */
export function buffsPanel(buffs: BuffSpan[] | undefined, rows: { slot: number; name: string; face: Html }[]): Html {
  if (!buffs?.length) return html``;
  return html`<div class="sim-buffs-panel">
    <p class="label-12 secondary">Buffs at <span class="num sim-buffs-time">${clockTime(page.play.t)}</span></p>
    ${rows.map(
      (r) => html`<div class="sim-buffs-row">
        <span class="sim-buffs-who" title="${r.name}">${r.face}</span>
        <span class="sim-buffs-now" data-buffs-slot="${r.slot}" ${r.slot < 0 ? html`data-buffs-kind="other"` : ''} aria-label="${r.slot < 0 ? 'The enemy’s debuffs' : `${r.name}’s buffs`}"></span>
        <span class="num label-12 secondary sim-buffs-count"></span>
      </div>`,
    )}
    <p class="label-12 sim-buffs-tip" aria-live="polite">${page.buffTip}</p>
  </div>`;
}

// A tapped chip says what it is (a hover does too, by its title).
if (typeof document !== 'undefined')
  document.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('.sim-buffs-panel .sim-buff-chip');
    if (!chip) return;
    page.buffTip = chip.title;
    for (const el of document.querySelectorAll<HTMLElement>('.sim-buffs-tip')) el.textContent = page.buffTip;
  });

/**
 * The buffs on someone at the playhead, as the game shows them: each icon in a square whose outline is its timer
 * (what's left of its stretch), its stacks in the corner. Into each `[data-buffs-slot]` (an operator's box; -1 the
 * enemy, by the boss's bars); rebuilt only when the set changes, the timers every paint.
 */
export function paintBuffs(): void {
  const list = page.playBars?.buffs ?? [];
  for (const el of document.querySelectorAll<HTMLElement>('[data-buffs-slot]')) {
    const slot = Number(el.dataset.buffsSlot);
    // `data-buffs-kind`: only the enemy's inflictions (by the boss's bars), or all but them (its lane).
    const kind = el.dataset.buffsKind;
    const fits = (b: BuffSpan) => !kind || (kind === 'infl') === b.id.startsWith('inflict_');
    // Only what the game draws: a buff whose icon it lacks (an empty sprite: Si's soul_timedisplay_jsspsiself) has none.
    // And one the game draws only for the controlled operator (Last Rite's Perfusion, on the whole team) on that row only.
    const t = page.play.t;
    const ctl = page.playBars?.controlled?.find((c) => c.from <= t && t < c.to)?.slot;
    const drawn = (b: BuffSpan) => (!page.buffIcons || !!buffIcon(b) || !!b.status) && !(page.buffMainOnly?.has(b.id) && ctl !== undefined && slot !== ctl);
    const on = page.play.t > 0 ? list.filter((b) => b.slot === slot && fits(b) && drawn(b) && b.from <= page.play.t && page.play.t < b.to) : [];
    const key = on.map((b) => `${b.id}@${b.from}`).join('|');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      el.replaceChildren(
        ...on.map((b) => {
          const chip = document.createElement('span');
          chip.className = `sim-buff-chip${slot < 0 ? ' debuff' : ''}`;
          const name = buffName(b);
          chip.dataset.tip = tip(name, b.level ? [tipRow('Level', String(b.stacks))] : b.stacks > 1 ? [tipRow('Stacks', String(b.stacks))] : []);
          const letter = () => {
            const i = document.createElement('i');
            i.textContent = name.slice(0, 1);
            return i;
          };
          const src = buffIcon(b);
          // An Arts Infliction as the game draws it: the element's icon in a circle of four arcs, one lit per stack;
          // inside them a thin ring for the time left (the game's circle doesn't show that).
          const infliction = b.id.startsWith('inflict_');
          const inner = infliction ? document.createElement('span') : chip;
          if (infliction) {
            chip.classList.add('infl');
            const lit = 'var(--gray-1000)';
            const dim = 'var(--gray-alpha-300)';
            chip.style.background = `conic-gradient(from -39deg, ${[0, 1, 2, 3].map((k) => `${k < b.stacks ? lit : dim} ${k * 90 + 6}deg ${k * 90 + 84}deg, transparent ${k * 90 + 84}deg ${k * 90 + 96}deg`).join(', ')})`;
            inner.className = 'infl-timer';
            chip.append(inner);
          }
          // An infliction's icon sits on a round face that clips it, so it can fill its circle.
          const face = infliction ? document.createElement('span') : inner;
          if (infliction) {
            face.className = 'infl-face';
            inner.append(face);
          }
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            img.onerror = () => img.replaceWith(letter());
            face.append(img);
          } else face.append(letter());
          // Stacks as a number; an Arts Reaction's level as the game draws it, a Roman numeral in a corner box.
          if (b.level) {
            const lv = document.createElement('b');
            lv.className = 'lv';
            lv.textContent = ['I', 'II', 'III', 'IV'][b.stacks - 1] ?? String(b.stacks);
            chip.append(lv);
          } else if (b.stacks > 1 && !infliction) {
            const n = document.createElement('b');
            n.textContent = String(b.stacks);
            chip.append(n);
          }
          return chip;
        }),
      );
    }
    const count = el.parentElement?.querySelector<HTMLElement>('.sim-buffs-count');
    if (count) count.textContent = on.length ? String(on.length) : '';
    on.forEach((b, k) => (el.children[k] as HTMLElement | undefined)?.style.setProperty('--left', String(Math.max(0, Math.min(1, (b.to - page.play.t) / Math.max(0.01, b.to - b.from))))));
  }
}
