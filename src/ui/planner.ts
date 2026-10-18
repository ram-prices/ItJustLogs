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
import { escape as esc } from './html';
import { cdfSparkline } from './model';

/** Pull Planner tab in eftracker's markup. */

type PlanType = 'char' | 'joint' | 'weap';

const PROFILES: Record<PlanType, { profile: PityProfile; guarantee: number | null; category: string }> = {
  char: { profile: CHARTERED, guarantee: CHARTERED_GUARANTEE, category: 'chartered' },
  joint: { profile: JOINT, guarantee: null, category: 'joint' },
  weap: { profile: WEAPON, guarantee: WEAPON_GUARANTEE, category: 'limited' },
};

const NEXT = '__next';
const CUSTOM = '__custom';

interface Plan {
  type: PlanType;
  key: string;
  pity: number;
  rateUpPity: number;
  have: boolean;
  pulls: number;
}

let plan: Plan | null = null;

const bannersFor = (type: PlanType, a: Analysis) =>
  a.banners.filter((b) => b.category === PROFILES[type].category).sort((x, y) => y.lastTs - x.lastTs);
const keyOf = (b: BannerSummary) => `${b.kind}:${b.poolId}`;

/** Chartered 6★ pity carries into the next banner; joint and arsenal pity don't. */
function fromKey(type: PlanType, key: string, a: Analysis, pulls: number): Plan {
  const banners = bannersFor(type, a);
  if (key === NEXT) {
    const live = type === 'char' ? (banners.find((b) => b.isLatest)?.pity.value ?? 0) : 0;
    return { type, key, pity: live, rateUpPity: 0, have: false, pulls };
  }
  const b = banners.find((x) => keyOf(x) === key);
  if (!b) return { type, key: CUSTOM, pity: 0, rateUpPity: 0, have: false, pulls };
  return {
    type,
    key,
    pity: b.pity.value,
    rateUpPity: type === 'joint' ? 0 : Math.min(b.paidPulls, PROFILES[type].guarantee ?? 0),
    have: b.rateUpCopies > 0,
    pulls,
  };
}

function defaultPlan(type: PlanType, a: Analysis, pulls: number): Plan {
  const current = bannersFor(type, a).find((b) => b.isLatest);
  return fromKey(type, current && current.rateUpCopies === 0 && type !== 'joint' ? keyOf(current) : NEXT, a, pulls);
}

function compute(p: Plan): { probability: number; pmf: Float64Array | null } {
  if (p.have) return { probability: 1, pmf: null };
  const cfg = PROFILES[p.type];
  const guaranteeAt = cfg.guarantee ? Math.max(1, cfg.guarantee - Math.min(p.rateUpPity, cfg.guarantee)) : null;
  const pmf = rateUpPmf(cfg.profile, { startPity: p.pity, guaranteeAt });
  return { probability: cdfAt(pmf, p.pulls), pmf };
}

export function renderPlanner(a: Analysis): string {
  plan ??= defaultPlan('char', a, 80);
  const p = plan;
  const cfg = PROFILES[p.type];
  const opt = (v: string, label: string) => `<option value="${esc(v)}" ${p.key === v ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="banner-box planner-box">
      <h3>Chance Calculator</h3>
      <div class="pity-box planner-row">
        <div class="planner-field">
          <label class="planner-label">Banner Type</label>
          <select id="plannerType" class="planner-input" data-plan="type">
            <option value="char" ${p.type === 'char' ? 'selected' : ''}>Character (Chartered)</option>
            <option value="joint" ${p.type === 'joint' ? 'selected' : ''}>Character (Joint)</option>
            <option value="weap" ${p.type === 'weap' ? 'selected' : ''}>Arsenal</option>
          </select>
        </div>
        <div class="planner-field planner-field-wide">
          <label class="planner-label">Auto-Fill From Banner</label>
          <select id="plannerBannerSelect" class="planner-input" data-plan="key">
            ${opt(NEXT, p.type === 'char' ? 'Next new banner (keeps current pity)' : 'Next new banner')}
            ${opt(CUSTOM, 'Custom (start from 0)')}
            ${bannersFor(p.type, a).map((b) => opt(keyOf(b), b.name + (b.isLatest ? ' (current)' : ''))).join('')}
          </select>
        </div>
      </div>
      <div class="pity-box planner-row">
        <div class="planner-field">
          <label class="planner-label">Starting Pity</label>
          <input id="plannerPity" type="number" min="0" max="${cfg.profile.hardPity - 1}" class="planner-input" value="${p.pity}" data-plan="pity">
        </div>
        ${
          cfg.guarantee
            ? `<div class="planner-field" id="plannerRateUpPityField">
                <label class="planner-label">Rate-Up Pity (of ${cfg.guarantee})</label>
                <input id="plannerRateUpPity" type="number" min="0" max="${cfg.guarantee}" class="planner-input" value="${p.rateUpPity}" data-plan="rateUpPity">
              </div>`
            : ''
        }
        <div class="planner-field">
          <label class="planner-label">Already Have It</label>
          <input id="plannerAlreadyHave" type="checkbox" class="planner-checkbox" ${p.have ? 'checked' : ''} data-plan="have">
        </div>
        <div class="planner-field">
          <label class="planner-label">Pulls To Simulate</label>
          <input id="plannerPulls" type="number" min="0" max="${MAX_PULLS}" class="planner-input" value="${p.pulls}" data-plan="pulls">
        </div>
      </div>
      <div class="planner-output" id="plannerOutput">${renderOutput()}</div>
    </div>`;
}

function renderOutput(): string {
  const { probability, pmf } = compute(plan!);
  return `
    <div class="planner-output-value" id="plannerResult">${(probability * 100).toFixed(1)}%</div>
    <div class="planner-output-label">chance of getting the rate-up within that many pulls</div>
    <div id="plannerGraph" class="planner-graph">${pmf ? cdfSparkline(pmf, Math.min(plan!.pulls, MAX_PULLS)) : ''}</div>`;
}

const clampInt = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

/** Returns true when the whole planner must be re-rendered (type or banner changed). */
export function handlePlannerInput(el: HTMLInputElement | HTMLSelectElement, a: Analysis): 'all' | 'output' | null {
  if (!plan) return null;
  const cfg = PROFILES[plan.type];
  switch (el.dataset.plan) {
    case 'type':
      plan = defaultPlan(el.value as PlanType, a, plan.pulls);
      return 'all';
    case 'key':
      plan = fromKey(plan.type, el.value, a, plan.pulls);
      return 'all';
    case 'pity':
      plan.pity = clampInt(el.value, 0, cfg.profile.hardPity - 1);
      return 'output';
    case 'rateUpPity':
      plan.rateUpPity = clampInt(el.value, 0, cfg.guarantee ?? 0);
      return 'output';
    case 'have':
      plan.have = (el as HTMLInputElement).checked;
      return 'output';
    case 'pulls':
      plan.pulls = clampInt(el.value, 0, MAX_PULLS);
      return 'output';
  }
  return null;
}

export const plannerOutput = renderOutput;
