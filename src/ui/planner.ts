import type { Analysis, BannerSummary } from '../domain/analyze';
import {
  CHARTERED,
  CHARTERED_GUARANTEE,
  JOINT,
  MAX_PULLS,
  WEAPON,
  WEAPON_GUARANTEE,
  cdfAt,
  rateUpPmf,
  type PityProfile,
} from '../domain/pity';
import { cdfChart } from './charts';
import { fmtPct, html, render, type Html } from './html';

type PlanType = 'chartered' | 'joint' | 'weapon';

interface Plan {
  type: PlanType;
  bannerKey: string;
  pity: number;
  bannerPulls: number;
  have: boolean;
  pulls: number;
}

const PROFILES: Record<PlanType, { profile: PityProfile; guarantee: number | null; label: string }> = {
  chartered: { profile: CHARTERED, guarantee: CHARTERED_GUARANTEE, label: 'Chartered Headhunting' },
  joint: { profile: JOINT, guarantee: null, label: 'Joint Headhunting' },
  weapon: { profile: WEAPON, guarantee: WEAPON_GUARANTEE, label: 'Arsenal Issue' },
};

let plan: Plan | null = null;

function bannersFor(type: PlanType, analysis: Analysis): BannerSummary[] {
  const cat = type === 'weapon' ? 'limited' : type;
  return analysis.banners.filter((b) => b.category === cat).sort((a, b) => b.lastTs - a.lastTs);
}

const NEXT = 'next';

/**
 * Fill pity from a real banner: its end-state is exactly where the player left off.
 * "Next banner" starts a fresh guarantee; Chartered 6★ pity carries over, the others don't.
 */
function fromBanner(type: PlanType, key: string, analysis: Analysis, pulls: number): Plan {
  const banners = bannersFor(type, analysis);
  if (key === NEXT) {
    const live = type === 'chartered' ? (banners.find((b) => b.isLatest)?.pity.value ?? 0) : 0;
    return { type, bannerKey: NEXT, pity: live, bannerPulls: 0, have: false, pulls };
  }
  const b = banners.find((x) => `${x.kind}:${x.poolId}` === key);
  return {
    type,
    bannerKey: b ? key : '',
    pity: b?.pity.value ?? 0,
    bannerPulls: b && type !== 'joint' ? Math.min(b.paidPulls, PROFILES[type].guarantee ?? 0) : 0,
    have: !!b && b.rateUpCopies > 0,
    pulls,
  };
}

/** Default: keep chasing the current banner if its rate-up is still missing, otherwise plan the next one. */
function defaultPlan(type: PlanType, analysis: Analysis, pulls: number): Plan {
  const current = bannersFor(type, analysis).find((b) => b.isLatest);
  const key = current && current.rateUpCopies === 0 && type !== 'joint' ? `${current.kind}:${current.poolId}` : NEXT;
  return fromBanner(type, key, analysis, pulls);
}

export function plannerView(analysis: Analysis): Html {
  plan ??= defaultPlan('chartered', analysis, 80);
  return html`
    <div class="page-head">
      <div>
        <h1>Planner</h1>
        <p>What are the odds of getting the rate-up if you pull N more times? Starts from your real pity.</p>
      </div>
    </div>
    <div class="planner">
      <form class="card card-pad planner-form" data-planner onsubmit="return false">${form(analysis)}</form>
      <div class="card card-pad planner-result" data-planner-result>${result()}</div>
    </div>
  `;
}

function form(analysis: Analysis): Html {
  const p = plan!;
  const cfg = PROFILES[p.type];
  const banners = bannersFor(p.type, analysis);
  return html`
    <label class="field"><span>Banner type</span>
      <select class="input" name="type">
        ${(Object.keys(PROFILES) as PlanType[]).map(
          (t) => html`<option value="${t}" ${t === p.type ? 'selected' : ''}>${PROFILES[t].label}</option>`,
        )}
      </select>
    </label>
    <label class="field"><span>Start from</span>
      <select class="input" name="banner">
        <option value="${NEXT}" ${p.bannerKey === NEXT ? 'selected' : ''}>
          Next new banner${p.type === 'chartered' ? ' (keeps your current pity)' : ''}
        </option>
        <option value="" ${p.bannerKey === '' ? 'selected' : ''}>Fresh start (0 pity)</option>
        ${banners.map(
          (b) =>
            html`<option value="${b.kind}:${b.poolId}" ${p.bannerKey === `${b.kind}:${b.poolId}` ? 'selected' : ''}>
              ${b.name}${b.isLatest ? ' (current)' : ''}
            </option>`,
        )}
      </select>
    </label>
    <label class="field"><span>6★ pity so far (0–${cfg.profile.hardPity - 1})</span>
      <input class="input num" type="number" name="pity" min="0" max="${cfg.profile.hardPity - 1}" value="${p.pity}" inputmode="numeric" />
    </label>
    ${cfg.guarantee
      ? html`<label class="field"><span>Pulls already on this banner (guarantee at ${cfg.guarantee})</span>
          <input class="input num" type="number" name="bannerPulls" min="0" max="${cfg.guarantee}" value="${p.bannerPulls}" inputmode="numeric" />
        </label>`
      : ''}
    <label class="inline-check"><input class="switch" type="checkbox" name="have" ${p.have ? 'checked' : ''} /> Already have the rate-up</label>
    <label class="field"><span>Pulls you plan to make</span>
      <input class="input num" type="number" name="pulls" min="0" max="${MAX_PULLS}" value="${p.pulls}" inputmode="numeric" />
    </label>
  `;
}

function compute(p: Plan): { chance: number; pmf: Float64Array | null } {
  if (p.have) return { chance: 1, pmf: null };
  const cfg = PROFILES[p.type];
  const guaranteeAt = cfg.guarantee ? Math.max(1, cfg.guarantee - Math.min(p.bannerPulls, cfg.guarantee)) : null;
  const pmf = rateUpPmf(cfg.profile, { startPity: p.pity, guaranteeAt });
  return { chance: cdfAt(pmf, p.pulls), pmf };
}

function result(): Html {
  const p = plan!;
  const { chance, pmf } = compute(p);
  return html`
    <div class="big num">${fmtPct(chance)}</div>
    <p class="dim" style="margin-top:8px">
      ${p.have
        ? 'You already own this banner’s rate-up. The guarantee no longer applies, so more pulls are a fresh chase.'
        : `chance of getting the rate-up within ${p.pulls} pulls`}
    </p>
    ${pmf ? html`<div style="margin-top:20px">${cdfChart(pmf, { at: Math.min(p.pulls, MAX_PULLS) })}</div>` : ''}
  `;
}

const clampInt = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

export function handlePlannerInput(target: HTMLElement, analysis: Analysis): boolean {
  const formEl = target.closest<HTMLFormElement>('[data-planner]');
  if (!formEl || !plan) return false;
  const el = target as HTMLInputElement;
  const cfg = PROFILES[plan.type];
  switch (el.name) {
    case 'type': {
      const type = el.value as PlanType;
      plan = defaultPlan(type, analysis, plan.pulls);
      render(formEl, form(analysis));
      break;
    }
    case 'banner': {
      plan = fromBanner(plan.type, el.value, analysis, plan.pulls);
      render(formEl, form(analysis));
      break;
    }
    case 'pity':
      plan.pity = clampInt(el.value, 0, cfg.profile.hardPity - 1);
      break;
    case 'bannerPulls':
      plan.bannerPulls = clampInt(el.value, 0, cfg.guarantee ?? 0);
      break;
    case 'have':
      plan.have = el.checked;
      break;
    case 'pulls':
      plan.pulls = clampInt(el.value, 0, MAX_PULLS);
      break;
    default:
      return false;
  }
  render(document.querySelector('[data-planner-result]')!, result());
  return true;
}
