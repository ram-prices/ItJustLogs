import { copyPmf, type AnalyzedPull, type Analysis, type BannerSummary } from '../domain/analyze';
import { cumulative } from '../domain/pity';
import type { Category, Kind } from '../domain/types';

/**
 * Adapts the domain Analysis into the shapes the eftracker-style views expect
 * (category names, 10-pull weapon blocks, summary-strip entries with FREE/TOKEN
 * markers, the tiny luck graphs). Read-only over the analysis.
 */

export type Pity = number | 'FREE' | 'TOKEN';

export interface ViewPull {
  key: string;
  kind: Kind;
  name: string;
  itemId: string;
  rarity: number;
  /** nth paid pull on the banner, or FREE. */
  pullNum: number | 'FREE';
  /** Characters: 6★ pity on 6★ rows (null otherwise). Weapons: the 10-pull block number. */
  pityAtPull: number | 'FREE' | null;
  isNew: boolean;
  isRateUpItem: boolean;
  pullProb?: number;
  rateUpCopyNum?: number;
  graphHTML?: string;
  ts: number;
}

export interface ViewBanner {
  summary: BannerSummary;
  domId: string;
  name: string;
  prefix: Kind;
  category: string;
  isConstant: boolean;
  isActive: boolean;
  totalPulls: number;
  allPulls: ViewPull[];
  startingPityForMath: number;
  // Chartered
  endPity: number;
  endRateUpPity: number;
  endTokenPulls: number;
  endHasPulledRateUp: boolean;
  // Weapons
  hasPulledSixStar: boolean;
  firstSixStarBlock: number;
  hasPulledRateUp: boolean;
  rateUpBlock: number;
  // Other character pools
  firstSixStarPity: number | null;
}

export interface SummaryItem {
  kind: Kind;
  id: string;
  name: string;
  rarity: number;
  pity: Pity;
  poolId: string;
  bannerName: string;
}

export interface ViewModel {
  char: ViewBanner[];
  weap: ViewBanner[];
  /** Banners ordered by first pull (eftracker's "timeline"). */
  timeline: Record<Kind, ViewBanner[]>;
  summary: Record<Kind, SummaryItem[]>;
}

const CATEGORY_NAME: Record<Category, string> = {
  chartered: 'Chartered Headhunting',
  joint: 'Joint Headhunting',
  basic: 'Basic Headhunting',
  newHorizons: 'New Horizons',
  limited: 'Arsenal Issue',
  constant: 'Constant Issue',
};

const block = (n: number) => Math.ceil(n / 10) || 1;

/** eftracker's 120×30 luck sparkline: the CDF with the actual pull marked. */
export function cdfSparkline(pmf: Float64Array, actualPull: number): string {
  const width = 120;
  const height = 30;
  const cdf = cumulative(pmf);
  let maxX = cdf.findIndex((v) => v >= 0.999);
  if (maxX < 0) maxX = cdf.length - 1;
  maxX = Math.max(maxX, actualPull) || 1;
  const points: string[] = [];
  let ax = 0;
  let ay = 0;
  for (let i = 0; i <= maxX; i++) {
    const x = (i / maxX) * width;
    const y = height - (cdf[Math.min(i, cdf.length - 1)] ?? 1) * height;
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    if (i === actualPull) {
      ax = x;
      ay = y;
    }
  }
  const pts = points.join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="luck-graph">
    <polyline points="${pts}" fill="none" stroke="rgba(255, 152, 0, 0.2)" stroke-width="2" />
    <polyline points="${pts}" fill="none" stroke="var(--accent-orange)" stroke-width="2" class="luck-graph-path" />
    <g class="luck-graph-elements">
      <line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${ax.toFixed(1)}" y2="${height}" stroke="rgba(255, 152, 0, 0.5)" stroke-width="1" stroke-dasharray="2,2" />
      <circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="3" fill="var(--bg-panel)" stroke="var(--luck-dot-ring, #fff)" stroke-width="1.5" />
    </g>
  </svg>`;
}

function viewPull(b: BannerSummary, p: AnalyzedPull): ViewPull {
  const isRateUpItem = p.rarity === 6 && (p.outcome === 'won' || p.outcome === 'guaranteed' || (b.category === 'joint' && p.isRateUp));
  const v: ViewPull = {
    key: p.key,
    kind: p.kind,
    name: p.name,
    itemId: p.itemId,
    rarity: p.rarity,
    pullNum: p.bannerPull ?? 'FREE',
    pityAtPull: p.isFree ? 'FREE' : p.kind === 'weap' ? block(p.bannerPull!) : p.rarity === 6 ? p.pity : null,
    isNew: p.isNew,
    isRateUpItem,
    ts: p.ts,
  };
  if (p.luck !== undefined && p.copy && p.bannerPull) {
    const pmf = copyPmf(b, p.copy);
    if (pmf) {
      const at = p.kind === 'weap' ? Math.ceil(p.bannerPull / 10) * 10 : p.bannerPull;
      v.pullProb = p.luck * 100;
      v.rateUpCopyNum = p.copy;
      v.graphHTML = cdfSparkline(pmf, Math.min(at, pmf.length - 1));
    }
  }
  return v;
}

function viewBanner(b: BannerSummary, index: number): ViewBanner {
  const paid = b.pulls.filter((p) => p.bannerPull !== null);
  const sixes = paid.filter((p) => p.rarity === 6);
  const firstWin = sixes.find((p) => p.outcome === 'won' || p.outcome === 'guaranteed');
  return {
    summary: b,
    domId: `banner-${b.kind}-${index}`,
    name: b.name,
    prefix: b.kind,
    category: CATEGORY_NAME[b.category],
    isConstant: b.category === 'constant',
    isActive: b.isLatest,
    totalPulls: b.paidPulls,
    allPulls: b.pulls.map((p) => viewPull(b, p)),
    startingPityForMath: b.category === 'chartered' ? b.startPity : 0,
    endPity: b.pity.value,
    endRateUpPity: Math.min(CHARTERED_CAP, b.guarantee?.value ?? 0),
    endTokenPulls: b.paidPulls,
    endHasPulledRateUp: !!b.guarantee?.done,
    hasPulledSixStar: sixes.length > 0,
    firstSixStarBlock: sixes.length ? block(sixes[0].bannerPull!) : 0,
    hasPulledRateUp: !!firstWin,
    rateUpBlock: firstWin ? block(firstWin.bannerPull!) : 0,
    firstSixStarPity: sixes.length ? sixes[0].pity : null,
  };
}

const CHARTERED_CAP = 120;

/** Rewards eftracker showed in the summary strip as "TOKEN" items, in pull order. */
function summaryItems(kind: Kind, banners: BannerSummary[]): SummaryItem[] {
  const out: SummaryItem[] = [];
  const pulls = banners
    .filter((b) => b.kind === kind)
    .flatMap((b) => b.pulls.map((p) => ({ b, p })))
    .sort((x, y) => x.p.ts - y.p.ts || x.p.seq - y.p.seq);
  const jointCount = new Map<string, number>();

  for (const { b, p } of pulls) {
    const rateUpId = b.info?.rateUpIds[0] ?? '';
    const rateUpName = b.info?.rateUpNames[0] ?? p.name;
    const base = { kind, poolId: b.poolId, bannerName: b.name };
    if (p.rarity === 6) {
      let pity: Pity = p.pity ?? 'FREE';
      // Arsenal 6★s are summarized by how many 10-pull blocks they took.
      if (kind === 'weap' && p.bannerPull !== null && p.pity !== null) {
        pity = block(p.bannerPull) - Math.ceil((p.bannerPull - p.pity) / 10);
      }
      out.push({ ...base, id: p.itemId, name: p.name, rarity: 6, pity });
    }
    const n = p.bannerPull;
    if (n === null) continue;
    if (b.category === 'chartered' && b.info && n % 240 === 0) {
      out.push({ ...base, id: rateUpId, name: rateUpName, rarity: 6, pity: 'TOKEN' });
    } else if (b.category === 'joint') {
      const c = (jointCount.get(b.poolId) ?? 0) + 1;
      jointCount.set(b.poolId, c);
      if (c % 120 === 0) out.push({ ...base, id: '', name: 'Joint Selector', rarity: 6, pity: 'TOKEN' });
    } else if (kind === 'weap' && b.info && n % 10 === 0) {
      const tB = n / 10;
      if (tB >= 18 && (tB - 18) % 16 === 0) out.push({ ...base, id: rateUpId, name: rateUpName, rarity: 6, pity: 'TOKEN' });
    }
  }
  return out;
}

export function buildViewModel(a: Analysis): ViewModel {
  const timeline = {
    char: a.banners.filter((b) => b.kind === 'char'),
    weap: a.banners.filter((b) => b.kind === 'weap'),
  };
  // eftracker order: Basic Headhunting first then newest first; arsenal limited newest first, then constant.
  const charOrder = [
    ...timeline.char.filter((b) => b.category === 'basic'),
    ...timeline.char.filter((b) => b.category !== 'basic').reverse(),
  ];
  const weapOrder = [
    ...timeline.weap.filter((b) => b.category !== 'constant').reverse(),
    ...timeline.weap.filter((b) => b.category === 'constant').reverse(),
  ];
  const char = charOrder.map((b, i) => viewBanner(b, i));
  const weap = weapOrder.map((b, i) => viewBanner(b, i));
  const byPool = (list: ViewBanner[]) => new Map(list.map((v) => [v.summary.poolId, v]));
  const charMap = byPool(char);
  const weapMap = byPool(weap);
  return {
    char,
    weap,
    timeline: {
      char: timeline.char.map((b) => charMap.get(b.poolId)!),
      weap: timeline.weap.map((b) => weapMap.get(b.poolId)!),
    },
    summary: { char: summaryItems('char', a.banners), weap: summaryItems('weap', a.banners) },
  };
}
