// Launch Radar's model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// Nothing here is a hand-picked constant about a named protocol. Every number the board states is
// fitted from the snapshot's own tokened protocols and then applied, unchanged, to the pre-token
// ones:
//
//   fitted value  = a log-log price line on TVL (with any extra term the held-out test earns),
//                   x a category factor, x a growth factor
//   value range   = the fitted value widened by the model's own out-of-fold errors, per category
//   launch odds   = a category's tokened share of the snapshot, x an age multiplier read off the
//                   whole universe, both shrunk toward the global rate
//   implied value = fitted value x launch odds, in whole dollars
//
// The price line is fitted by least squares over the tokened protocols that carry a market cap.
// The category and growth factors are median residuals from that line, shrunk toward one by each
// group's sample size and capped, so a category with two observations borrows most of its factor
// from the market and one with forty stands on its own. Candidate extra terms (log age, chain
// count, continuous weekly change) are admitted only when they lower the pooled out-of-fold error,
// tested greedily; the ones that ship are named in the ledger the dashboard publishes.
//
// The fit is tested held-out four ways: a slug-hash half split, a five-fold cross-validation, an
// older-to-newer temporal split, and a leave-one-category-out pass. The out-of-fold residuals of
// the five-fold pass also set each row's value range: the central 80% of the model's own errors
// in that row's category, shrunk toward the global spread.
//
// Farm verdicts are priced in odds-weighted dollars: the expected share of a launch's community
// allocation, multiplied by the launch odds the board itself prints, against the plan's full cost
// on the cheapest chain the protocol actually runs on. A plan is strong at five times its cost,
// worthwhile at one times, thin below that.
//
// The board ranks every pre-token protocol that is a candidate for a launch of its own: not an
// exchange, not a versioned pool of another protocol, not a wrapped or staked product by name.
// The rest of the universe is accounted for, not dropped: tokened protocols are the training set
// and the Live view, and every set-aside protocol is counted with its reason.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped, staked or bridged product of another asset. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories that are products of another asset by the house's own watchlist definition. */
const PRODUCT_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Canonical Bridge', 'Bridge', 'Cross Chain Bridge']);

/** Exchange names a product's name can begin with, by the same published definition. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a pre-token protocol is set aside instead of ranked, or null when it is ranked. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'tokened';
  if (p.category === 'CEX') return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  if (PRODUCT_WORD.test(p.name)) return 'wrapped or staked product';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'staked or bridged product';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product';
  return null;
}

/** The median of a non-empty list, taken on a sorted copy so the caller's order survives. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A percentile of a list by nearest rank on a sorted copy. */
function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx]!;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The weekly-change bucket a protocol falls in; a missing change reads as flat. */
export function growthBucket(change: number | null): number {
  const g = change ?? 0;
  if (g < -10) return 0;
  if (g < 0) return 1;
  if (g < 10) return 2;
  return 3;
}

export const GROWTH_BUCKET_LABELS = ['down over 10%', 'down 0 to 10%', 'up 0 to 10%', 'up over 10%'] as const;

/** The age band a protocol falls in; an unknown listing date is its own band. */
export function ageBand(age: number | null): number {
  if (age === null) return 4;
  if (age < 180) return 0;
  if (age < 540) return 1;
  if (age < 1080) return 2;
  return 3;
}

export const AGE_BAND_LABELS = ['under 6 months', '6 to 18 months', '18 to 36 months', 'over 36 months', 'age unknown'] as const;

/** One tokened protocol's market-cap-to-TVL ratio, the observation both fits are built from. */
interface Observation {
  protocol: SnapshotProtocol;
  ratio: number;
  age: number | null;
}

/** The extra regressors a pricing fit may carry, each admitted only by the held-out test. */
export type Term = 'age' | 'chains' | 'growth';
export const TERM_LABELS: Record<Term, string> = {
  age: 'log age in years',
  chains: 'log chain count',
  growth: 'weekly change, continuous',
};

/** Sample size at which a category's own offset counts as much as the prior it shrinks toward. */
const OFFSET_PRIOR = 12;
/** Sample size at which a launch-rate cell counts as much as the rate it shrinks toward. */
const ODDS_PRIOR = 20;

/** A shrunk median offset in log space: the group's median residual, pulled toward zero by size. */
function shrunkOffset(residuals: number[]): number {
  if (residuals.length === 0) return 0;
  return (residuals.length * median(residuals)) / (residuals.length + OFFSET_PRIOR);
}

/** One observation's value for a candidate term; a missing age reads as the training median age. */
function termValue(term: Term, o: Observation, medianAge: number): number {
  if (term === 'age') return Math.log(1 + (o.age ?? medianAge) / 365);
  if (term === 'chains') return Math.log(1 + o.protocol.chains.length);
  // Weekly change, winsorized at +/-150%: the term is fitted on ordinary weeks and must not
  // extrapolate a parabolic week into a parabolic price.
  return Math.min(1.5, Math.max(-1.5, (o.protocol.change_7d ?? 0) / 100));
}

/** Solve a small linear system by Gaussian elimination with partial pivoting; null if singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** A fitted pricing spec: the linear part plus the shrunk category and growth factors. */
interface PricingFit {
  intercept: number;
  slope: number;
  coef: Map<Term, number>;
  medianAge: number;
  byCategory: Map<string, number>;
  catSize: Map<string, number>;
  growth: number[];
  growthSize: number[];
  growthDisabled: boolean;
}

/**
 * Fit one pricing spec on one set of observations: least squares on log TVL plus the admitted
 * terms, then a shrunk median residual per category and per growth bucket, each capped so no
 * thin group can price a protocol at an absurd multiple of its TVL. When the continuous growth
 * term is admitted, the growth buckets are switched off so growth is never counted twice.
 */
function fitPricing(obs: Observation[], terms: Term[]): PricingFit {
  const ages = obs.map((o) => o.age).filter((a): a is number => a !== null);
  const medianAge = ages.length > 0 ? median(ages) : 365;
  const feats = obs.map((o) => [1, Math.log(o.protocol.tvl_usd), ...terms.map((t) => termValue(t, o, medianAge))]);
  const ys = obs.map((o) => Math.log(o.protocol.mcap_usd!));
  const k = feats[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty: number[] = new Array(k).fill(0);
  feats.forEach((row, i) => {
    for (let a = 0; a < k; a++) {
      xty[a]! += row[a]! * ys[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  });
  let beta = solveLinear(xtx, xty);
  if (beta === null) {
    // Singular design (a constant term): fall back to the plain log-log line.
    const plain = fitPricing(obs, []);
    if (terms.length > 0) return plain;
    beta = [0, 1];
  }
  const coef = new Map<Term, number>();
  terms.forEach((t, i) => coef.set(t, beta![i + 2]!));
  const linear = feats.map((row) => row.reduce((s, v, i) => s + v * beta![i]!, 0));
  const resid = obs.map((o, i) => ys[i]! - linear[i]!);
  const cap = Math.log(6);
  const byCategory = new Map<string, number>();
  const catSize = new Map<string, number>();
  const catResid = new Map<string, number[]>();
  obs.forEach((o, i) => {
    const key = o.protocol.category ?? 'Uncategorized';
    const list = catResid.get(key) ?? [];
    list.push(resid[i]!);
    catResid.set(key, list);
  });
  for (const [key, list] of catResid) {
    byCategory.set(key, Math.exp(Math.min(cap, Math.max(-cap, shrunkOffset(list)))));
    catSize.set(key, list.length);
  }
  const growthDisabled = terms.includes('growth');
  const growth: number[] = [];
  const growthSize: number[] = [];
  const gcap = Math.log(1.8);
  for (let b = 0; b < 4; b++) {
    const list = obs.filter((o) => growthBucket(o.protocol.change_7d) === b).map((o) => resid[obs.indexOf(o)]!);
    growthSize.push(list.length);
    growth.push(growthDisabled ? 1 : Math.exp(Math.min(gcap, Math.max(-gcap, shrunkOffset(list)))));
  }
  return { intercept: beta[0]!, slope: beta[1]!, coef, medianAge, byCategory, catSize, growth, growthSize, growthDisabled };
}

/** Price one observation under a fitted spec, before launch odds. */
function fittedValue(fit: PricingFit, o: Observation): number {
  let v = fit.intercept + fit.slope * Math.log(o.protocol.tvl_usd);
  for (const [t, c] of fit.coef) v += c * termValue(t, o, fit.medianAge);
  const factor = fit.byCategory.get(o.protocol.category ?? 'Uncategorized') ?? 1;
  return Math.exp(v) * factor * fit.growth[growthBucket(o.protocol.change_7d)]!;
}

/** A deterministic split key: the sum of the slug's code units, so the split never moves. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h += slug.charCodeAt(i);
  return h;
}

/** Held-out error summary for one validation pass. */
export interface ValidationSplit {
  median_ape: number;
  within_2x_pct: number;
  tested: number;
}

/** Score a set of (predicted, actual) pairs the way every validation pass is scored. */
function scorePairs(pairs: { predicted: number; actual: number }[]): ValidationSplit {
  if (pairs.length === 0) return { median_ape: 0, within_2x_pct: 0, tested: 0 };
  const errors = pairs.map((p) => Math.abs(p.predicted - p.actual) / p.actual);
  const within = pairs.filter((p) => p.predicted >= p.actual / 2 && p.predicted <= p.actual * 2).length;
  return {
    median_ape: round4(median(errors)),
    within_2x_pct: Math.round((within / pairs.length) * 1000) / 10,
    tested: pairs.length,
  };
}

/** The five-fold out-of-fold pass: predictions and log residuals for every training observation. */
function fiveFold(obs: Observation[], terms: Term[]): { pairs: { predicted: number; actual: number }[]; logResid: Map<string, number> } {
  const pairs: { predicted: number; actual: number }[] = [];
  const logResid = new Map<string, number>();
  for (let fold = 0; fold < 5; fold++) {
    const train = obs.filter((o) => slugHash(o.protocol.slug) % 5 !== fold);
    const test = obs.filter((o) => slugHash(o.protocol.slug) % 5 === fold);
    if (train.length === 0 || test.length === 0) continue;
    const fit = fitPricing(train, terms);
    for (const o of test) {
      const predicted = fittedValue(fit, o);
      pairs.push({ predicted, actual: o.protocol.mcap_usd! });
      logResid.set(o.protocol.slug, Math.log(o.protocol.mcap_usd!) - Math.log(predicted));
    }
  }
  return { pairs, logResid };
}

/** The fitted model: everything the board's numbers come from, kept whole so the page can state it. */
export interface FittedModel {
  train_size: number;
  /** The log-log pricing line: log value = intercept + slope x log TVL (+ admitted terms). */
  intercept: number;
  slope: number;
  /** The extra terms the held-out test admitted, in the order they were adopted. */
  terms: Term[];
  /** The admitted terms' fitted coefficients, in the same order. */
  coef: { term: Term; value: number }[];
  /** The training set's median age in days, the stand-in for a protocol with no listing date. */
  median_age: number;
  /** The fitted value-to-TVL multiple at $100M of TVL, before category and growth factors. */
  reference_multiple: number;
  category_factor: Map<string, number>;
  category_train_size: Map<string, number>;
  growth_adjustment: number[];
  growth_train_size: number[];
  growth_disabled: boolean;
  global_launch_rate: number;
  category_launch_rate: Map<string, number>;
  /** The launch-rate multiplier of each age band, read off the whole universe. */
  age_multiplier: number[];
  /** Per-category central-80% error spread in log space, shrunk toward the global spread. */
  interval_low: Map<string, number>;
  interval_high: Map<string, number>;
  global_interval_low: number;
  global_interval_high: number;
  validation: {
    half: ValidationSplit;
    fivefold: ValidationSplit;
    temporal: ValidationSplit;
    category_holdout: ValidationSplit;
    /** The typical multiplicative miss: exp of the median absolute out-of-fold log residual. */
    typical_miss_factor: number;
  };
  /** Every training protocol with the market's value beside the model's, for the ledger. */
  anchors: { slug: string; name: string; tvl_usd: number; actual_mcap_usd: number; fitted_fdv_usd: number }[];
  /** The age-band launch table the odds are read from. */
  age_table: { band: number; n: number; tokened: number; rate: number; multiplier: number }[];
}

/**
 * Fit the whole model on the snapshot: admit extra terms greedily by five-fold error, fit the
 * final spec on every training protocol, validate four ways, read the launch odds off the whole
 * universe, and set each category's error spread from the out-of-fold residuals.
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const obs: Observation[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ protocol: p, ratio: p.mcap_usd! / p.tvl_usd, age: ageDays(snapshot.as_of, p.listed_at) }));

  // Greedy term admission, two rounds: a term ships only if it lowers the pooled five-fold
  // median error of the spec it joins.
  let terms: Term[] = [];
  let bestErr = scorePairs(fiveFold(obs, terms).pairs).median_ape;
  for (let round = 0; round < 2; round++) {
    let roundBest: Term | null = null;
    let roundErr = bestErr;
    for (const cand of ['age', 'chains', 'growth'] as Term[]) {
      if (terms.includes(cand)) continue;
      const err = scorePairs(fiveFold(obs, [...terms, cand]).pairs).median_ape;
      if (err < roundErr - 1e-9) {
        roundErr = err;
        roundBest = cand;
      }
    }
    if (roundBest === null) break;
    terms = [...terms, roundBest];
    bestErr = roundErr;
  }

  const fit = fitPricing(obs, terms);
  const fold = fiveFold(obs, terms);

  // Validation, four ways. Half split: fit one slug-hash half, price the other, then swap.
  const halfPairs: { predicted: number; actual: number }[] = [];
  for (const side of [0, 1]) {
    const train = obs.filter((o) => slugHash(o.protocol.slug) % 2 === side);
    const test = obs.filter((o) => slugHash(o.protocol.slug) % 2 !== side);
    if (train.length === 0) continue;
    const halfFit = fitPricing(train, terms);
    for (const o of test) halfPairs.push({ predicted: fittedValue(halfFit, o), actual: o.protocol.mcap_usd! });
  }
  // Temporal: fit on the older half by listing date, price the newer half.
  const dated = obs.filter((o) => o.protocol.listed_at !== null).sort((a, b) => (a.protocol.listed_at! < b.protocol.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length / 2);
  let temporal: ValidationSplit = { median_ape: 0, within_2x_pct: 0, tested: 0 };
  if (cut > 0 && dated.length - cut > 0) {
    const tFit = fitPricing(dated.slice(0, cut), terms);
    temporal = scorePairs(dated.slice(cut).map((o) => ({ predicted: fittedValue(tFit, o), actual: o.protocol.mcap_usd! })));
  }
  // Category holdout: fit without a category, price it with the market-wide factor of one.
  const catPairs: { predicted: number; actual: number }[] = [];
  const cats = [...new Set(obs.map((o) => o.protocol.category ?? 'Uncategorized'))];
  for (const cat of cats) {
    const train = obs.filter((o) => (o.protocol.category ?? 'Uncategorized') !== cat);
    const test = obs.filter((o) => (o.protocol.category ?? 'Uncategorized') === cat);
    if (train.length === 0 || test.length === 0) continue;
    const cFit = fitPricing(train, terms);
    for (const o of test) catPairs.push({ predicted: fittedValue(cFit, o), actual: o.protocol.mcap_usd! });
  }
  const absLogResid = [...fold.logResid.values()].map((r) => Math.abs(r));
  const validation = {
    half: scorePairs(halfPairs),
    fivefold: scorePairs(fold.pairs),
    temporal,
    category_holdout: scorePairs(catPairs),
    typical_miss_factor: round2(Math.exp(absLogResid.length > 0 ? median(absLogResid) : 0)),
  };

  // Error spread per category: the central 80% of its out-of-fold log residuals, each side
  // shrunk toward the global side by the category's residual count.
  const allResid = [...fold.logResid.values()];
  const gLow = percentile(allResid, 0.1);
  const gHigh = percentile(allResid, 0.9);
  const residByCat = new Map<string, number[]>();
  for (const o of obs) {
    const r = fold.logResid.get(o.protocol.slug);
    if (r === undefined) continue;
    const key = o.protocol.category ?? 'Uncategorized';
    const list = residByCat.get(key) ?? [];
    list.push(r);
    residByCat.set(key, list);
  }
  const intervalLow = new Map<string, number>();
  const intervalHigh = new Map<string, number>();
  for (const [cat, list] of residByCat) {
    const w = list.length / (list.length + ODDS_PRIOR);
    intervalLow.set(cat, w * percentile(list, 0.1) + (1 - w) * gLow);
    intervalHigh.set(cat, w * percentile(list, 0.9) + (1 - w) * gHigh);
  }

  // Launch odds: a category's tokened share, times an age multiplier read off the whole
  // universe (each band's tokened share against the global rate, shrunk toward one).
  const tokened = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalRate = tokened / snapshot.protocols.length;
  const catCount = new Map<string, { tok: number; all: number }>();
  const bandCount = new Map<number, { tok: number; all: number }>();
  for (const p of snapshot.protocols) {
    const cat = p.category ?? 'Uncategorized';
    const band = ageBand(ageDays(snapshot.as_of, p.listed_at));
    const tok = isPreToken(p) ? 0 : 1;
    const c = catCount.get(cat) ?? { tok: 0, all: 0 };
    c.tok += tok;
    c.all += 1;
    catCount.set(cat, c);
    const b = bandCount.get(band) ?? { tok: 0, all: 0 };
    b.tok += tok;
    b.all += 1;
    bandCount.set(band, b);
  }
  const categoryRate = new Map<string, number>();
  for (const [cat, c] of catCount) categoryRate.set(cat, (c.tok + ODDS_PRIOR * globalRate) / (c.all + ODDS_PRIOR));
  const ageMult: number[] = [];
  const ageTable: FittedModel['age_table'] = [];
  for (let band = 0; band < 5; band++) {
    const b = bandCount.get(band) ?? { tok: 0, all: 0 };
    const rate = (b.tok + ODDS_PRIOR * globalRate) / (b.all + ODDS_PRIOR);
    const mult = globalRate > 0 ? rate / globalRate : 1;
    ageMult.push(mult);
    ageTable.push({ band, n: b.all, tokened: b.tok, rate: round4(rate), multiplier: round4(mult) });
  }

  const anchors = obs
    .map((o) => ({
      slug: o.protocol.slug,
      name: o.protocol.name,
      tvl_usd: o.protocol.tvl_usd,
      actual_mcap_usd: o.protocol.mcap_usd!,
      fitted_fdv_usd: Math.round(fittedValue(fit, o)),
    }))
    .sort((a, b) => b.actual_mcap_usd - a.actual_mcap_usd);

  return {
    train_size: obs.length,
    intercept: fit.intercept,
    slope: fit.slope,
    terms,
    coef: terms.map((t) => ({ term: t, value: fit.coef.get(t) ?? 0 })),
    median_age: fit.medianAge,
    reference_multiple: round4(Math.exp(fit.intercept + fit.slope * Math.log(100_000_000)) / 100_000_000),
    category_factor: fit.byCategory,
    category_train_size: fit.catSize,
    growth_adjustment: fit.growth,
    growth_train_size: fit.growthSize,
    growth_disabled: fit.growthDisabled,
    global_launch_rate: globalRate,
    category_launch_rate: categoryRate,
    age_multiplier: ageMult,
    interval_low: intervalLow,
    interval_high: intervalHigh,
    global_interval_low: gLow,
    global_interval_high: gHigh,
    validation,
    anchors,
    age_table: ageTable,
  };
}

/** One protocol priced by the fitted model: every term kept, so the page can show its working. */
export interface Priced {
  fitted_fdv_usd: number;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  size_multiple: number;
  category_factor: number;
  growth_adjustment: number;
  launch_odds: number;
  age_days: number | null;
}

/** Price one pre-token protocol under the fitted model. */
export function price(p: SnapshotProtocol, asOf: string, model: FittedModel): Priced {
  const age = ageDays(asOf, p.listed_at);
  const cat = p.category ?? 'Uncategorized';
  const probe: Observation = { protocol: p, ratio: 0, age };
  let logBase = model.intercept + model.slope * Math.log(p.tvl_usd);
  for (const c of model.coef) logBase += c.value * termValue(c.term, probe, model.median_age);
  const base = Math.exp(logBase);
  const catFactor = model.category_factor.get(cat) ?? 1;
  const growthFactor = model.growth_adjustment[growthBucket(p.change_7d)]!;
  const fdv = base * catFactor * growthFactor;
  const catRate = model.category_launch_rate.get(cat) ?? model.global_launch_rate;
  const odds = Math.min(0.98, Math.max(0.01, catRate * model.age_multiplier[ageBand(age)]!));
  const lo = model.interval_low.get(cat) ?? model.global_interval_low;
  const hi = model.interval_high.get(cat) ?? model.global_interval_high;
  return {
    fitted_fdv_usd: Math.round(fdv),
    implied_value_usd: Math.max(1, Math.round(fdv * odds)),
    value_low_usd: Math.max(1, Math.round(fdv * Math.exp(lo))),
    value_high_usd: Math.round(fdv * Math.exp(hi)),
    size_multiple: round4(base / p.tvl_usd),
    category_factor: round4(catFactor),
    growth_adjustment: round4(growthFactor),
    launch_odds: round4(odds),
    age_days: age,
  };
}

/** Gas cost of one on-chain action, by the chain it lands on, in dollars. */
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 4.5,
  Solana: 0.02,
  'BNB Chain': 0.2,
  BSC: 0.2,
  Avalanche: 0.25,
  Polygon: 0.02,
  Arbitrum: 0.12,
  Base: 0.05,
  Optimism: 0.08,
  'zkSync Era': 0.1,
  Linea: 0.08,
  Scroll: 0.08,
  Mantle: 0.05,
  Blast: 0.05,
  Mode: 0.05,
  Taiko: 0.08,
  Sonic: 0.05,
  Fantom: 0.05,
  Gnosis: 0.02,
  Celo: 0.02,
  Tron: 0.3,
  TON: 0.05,
  Sui: 0.02,
  Aptos: 0.02,
  Near: 0.02,
  Cosmos: 0.05,
  Bitcoin: 1.5,
  Hyperliquid: 0.05,
  'Hyperliquid L1': 0.05,
  Monad: 0.05,
  Plasma: 0.05,
  Berachain: 0.08,
  Tempo: 0.05,
  Ink: 0.05,
  BOB: 0.08,
  'World Chain': 0.05,
  Unichain: 0.05,
  Sei: 0.03,
  Movement: 0.03,
  Fuel: 0.05,
  Starknet: 0.1,
  Manta: 0.05,
  Zircuit: 0.05,
  Corn: 0.08,
  Eclipse: 0.02,
  Soon: 0.02,
};

/** One action's gas on a chain the table does not name. */
const GAS_DEFAULT = 0.4;

export function gasFor(chain: string): number {
  return GAS_BY_CHAIN[chain] ?? GAS_DEFAULT;
}

/** The cheapest chain a protocol actually runs on: the route every plan is priced through. */
export function cheapestChain(chains: string[]): string {
  let best = chains[0] ?? 'Ethereum';
  for (const c of chains) if (gasFor(c) < gasFor(best)) best = c;
  return best;
}

/** The capital tier one farm position carries, from the protocol's own TVL. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 50;
  return 25;
}

/** How many weeks a qualifying position runs, from the protocol's age. */
export function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 10;
  if (age < 540) return 8;
  return 6;
}

/** The farmer crowd a launch of this size draws, under the stated assumption on the model card. */
export function farmersFor(tvl: number): number {
  return Math.min(100_000, Math.max(5_000, Math.round(tvl / 25_000)));
}

/** The share of a launch that reaches the community, under the stated assumption. */
export const COMMUNITY_SHARE = 0.05;

/** A farm plan's money: the position, the running cost, and what the plan has to beat. */
export interface FarmMath {
  capital: number;
  weeks: number;
  entry_chain: string;
  total_cost_usd: number;
  /** The plan's expected share of the community allocation, in dollars, before launch odds. */
  expected_share_usd: number;
  /** The same share weighted by the board's own launch odds: the number the verdict prices. */
  expected_value_usd: number;
  /** Expected value over total cost: the verdict's ratio. */
  ratio: number;
  verdict: 'strong' | 'worthwhile' | 'thin';
}

/**
 * Work out a plan's money from the protocol's record and its fitted value. The plan is routed
 * through the protocol's cheapest chain, its capital never falls below ten times the cost of
 * one action on that chain, and its verdict prices the odds-weighted expected value: strong at
 * five times cost, worthwhile at one times, thin below.
 */
export function farmMath(p: SnapshotProtocol, priced: Priced): FarmMath {
  const entry = cheapestChain(p.chains);
  const gas = gasFor(entry);
  const weeks = weeksFor(priced.age_days);
  let cost = 2 * gas + weeks * 2 * gas;
  const others = p.chains.filter((c) => c !== entry);
  if (others.length > 0) {
    const second = cheapestChain(others);
    cost += 2.5 + gasFor(second);
  }
  const total = round2(cost);
  // Capital: the TVL tier, but never below twenty actions' gas on the entry chain and never
  // below twice the plan's full cost, so no plan's running cost can eat its position.
  const capitalFloor = Math.max(Math.ceil((20 * gas) / 5) * 5, Math.ceil((2 * total) / 5) * 5);
  const capital = Math.max(capitalFor(p.tvl_usd), capitalFloor);
  const share = round2((priced.fitted_fdv_usd * COMMUNITY_SHARE) / farmersFor(p.tvl_usd));
  const value = round2(share * priced.launch_odds);
  const ratio = total > 0 ? round2(value / total) : 0;
  const verdict = ratio >= 5 ? 'strong' : ratio >= 1 ? 'worthwhile' : 'thin';
  return { capital, weeks, entry_chain: entry, total_cost_usd: total, expected_share_usd: share, expected_value_usd: value, ratio, verdict };
}

const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;
const money2 = (n: number): string => `$${n.toFixed(2)}`;

/** The category's core position action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${money(capital)} of USDC as collateral to ${n} on ${chain}, then borrow ${money(Math.round(capital / 2))} against it and re-supply the borrow, so the wallet shows both sides of the market.`;
  if (c.includes('dex') || c.includes('liquidity')) return `Provide ${money(capital)} of liquidity to ${n}'s deepest USDC pool on ${chain}, split evenly across both assets, and keep the LP position open.`;
  if (c.includes('deriv') || c.includes('perpetual')) return `Deposit ${money(capital)} of USDC margin on ${n} and trade one small hedged pair each week, half long and half short, so volume accrues without directional risk.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge ${money(capital)} of USDC through ${n} to ${chain}, then put the bridged funds to work in one app on the far side instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake ${money(capital)} of the chain's staking asset through ${n} on ${chain} and hold the receipt token in the same wallet for the whole run.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit ${money(capital)} into a ${n} vault on ${chain} and keep the vault shares untouched, so the deposit ages in the protocol's snapshots.`;
  if (c.includes('rwa')) return `Mint ${money(capital)} of ${n}'s yield-bearing asset on ${chain} through its own app and hold it; do not route the mint through an aggregator.`;
  if (c.includes('prediction')) return `Fund the wallet with ${money(capital)} on ${n} and take one position in each of its three most liquid markets.`;
  if (c.includes('insurance')) return `Buy ${money(capital)} of cover from ${n} on ${chain} for the longest term it offers and keep the policy active.`;
  if (c.includes('stable')) return `Mint or deposit ${money(capital)} of the stable asset through ${n} on ${chain} and hold the balance in the farming wallet.`;
  return `Deposit ${money(capital)} of USDC into ${n} on ${chain} through its own app and keep the position open for the whole run.`;
}

/** The weekly cadence step, worded by the category's own verb and the protocol's growth record. */
function cadenceStep(p: SnapshotProtocol, weeks: number, gas: number): string {
  const c = (p.category ?? '').toLowerCase();
  const verb = c.includes('lend')
    ? 'one health-factor check and one small top-up of collateral'
    : c.includes('dex') || c.includes('liquidity')
      ? 'one fee claim and one small rebalance of the LP range'
      : c.includes('deriv') || c.includes('perpetual')
        ? 'one hedged pair trade and one margin top-up'
        : c.includes('curator') || c.includes('allocator') || c.includes('yield')
          ? 'one vault statement check and one small additional deposit'
          : c.includes('prediction')
            ? 'one new market position and one settlement claim'
            : 'one deposit and one smaller interaction';
  const g = p.change_7d;
  const trend =
    g === null
      ? `its weekly TVL change is unrecorded in the snapshot, so keep the cadence flat`
      : g >= 10
        ? `its TVL grew ${g.toFixed(1)}% this week, so front-load the bigger actions into the first half of the run while the growth lasts`
        : g >= 0
          ? `its TVL grew ${g.toFixed(1)}% this week, so keep the cadence even across the run`
          : `its TVL fell ${Math.abs(g).toFixed(1)}% this week, so keep actions small and steady rather than chasing a shrinking protocol`;
  return `Every week for ${weeks} weeks, make two qualifying actions from ${p.name}'s own app: ${verb}; ${trend}. Cost: about ${money2(2 * gas)} of gas a week. Time: 15 minutes a week.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, and a closing
 * verdict that prices the plan's odds-weighted value against its cost. Every figure in the text
 * comes from the protocol's own record and the plan's arithmetic, never from a hand-written
 * list of names.
 */
export function farmSteps(p: SnapshotProtocol, priced: Priced, math: FarmMath): string[] {
  const entry = math.entry_chain;
  const gas = gasFor(entry);
  const steps: string[] = [];
  const routeNote = p.chains.length > 1 ? `, entered via ${entry}, the cheapest of its ${p.chains.length} chains at ${money2(gas)} an action` : ` on ${entry}`;
  steps.push(`Open a fresh wallet for ${p.name} alone${routeNote}, fund it with ${money(math.capital)} plus gas, and keep its seed phrase offline and never reused on another farm. Cost: ${money2(2 * gas)} of gas to fund and approve. Time: 10 minutes, once.`);
  steps.push(`${coreAction(p, math.capital, entry)} Cost: ${money(math.capital)} of capital and about ${money2(2 * gas)} of gas. Time: 20 minutes to set up.`);
  const others = p.chains.filter((c) => c !== entry);
  if (others.length > 0) {
    const second = cheapestChain(others);
    steps.push(`Repeat a smaller position on ${second}: bridge ${money(Math.round(math.capital / 2))} across and open the same kind of position, so the wallet is active on two of ${p.name}'s ${p.chains.length} chains. Cost: about ${money2(2.5 + gasFor(second))} in bridge and gas fees. Time: 25 minutes, once.`);
  } else {
    steps.push(`Deepen the same position once in week two: add ${money(Math.round(math.capital / 2))} more on ${entry}, so the wallet's balance grows the way a real user's would instead of sitting flat. Cost: ${money(Math.round(math.capital / 2))} of capital and about ${money2(gas)} of gas. Time: 10 minutes, once.`);
  }
  steps.push(cadenceStep(p, math.weeks, gas));
  steps.push(`Hold every position for the full ${math.weeks} weeks without withdrawing, so the wallet appears in at least ${math.weeks} weekly snapshots and is not filtered out as a one-day farm. Cost: the ${money(math.capital)} stays locked in the position. Time: ${math.weeks} weeks.`);
  steps.push(`Each week, open ${p.name}'s own points or rewards page from the link its app publishes, record the balance in a farm log, and claim nothing from any link sent by message or social post. Cost: nothing to check, and never pay a fee to claim. Time: 5 minutes a week.`);
  const verdictText =
    math.verdict === 'strong'
      ? `at ${math.ratio.toFixed(1)} times its cost in odds-weighted value, the plan is worth running at full size`
      : math.verdict === 'worthwhile'
        ? `at ${math.ratio.toFixed(1)} times its cost in odds-weighted value, the plan clears its cost and is worth running at this size and no larger`
        : `at ${math.ratio.toFixed(1)} times its cost in odds-weighted value, the plan does not cover its cost; the minimum viable run is one wallet at the ${money(math.capital)} floor for the first two weeks only, then stop unless the fitted value rises`;
  steps.push(`Verdict: ${math.weeks} weeks at ${money(math.capital)} via ${entry} costs about ${money2(math.total_cost_usd)} all in. If ${p.name} launches at the fitted ${money(priced.fitted_fdv_usd)}, one of an estimated ${farmersFor(p.tvl_usd).toLocaleString('en-US')} qualifying wallets sees about ${money2(math.expected_share_usd)} of the community allocation, which the board's ${Math.round(priced.launch_odds * 100)}% launch odds weight to ${money2(math.expected_value_usd)}; ${verdictText}. Time: the full ${math.weeks} weeks.`);
  return steps;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    size_multiple: number;
    category_factor: number;
    growth_adjustment: number;
    launch_odds: number;
    fitted_fdv_usd: number;
    value_low_usd: number;
    value_high_usd: number;
    age_days: number | null;
  };
  farm: { capital_usd: number; weeks: number; entry_chain: string; total_cost_usd: number; expected_share_usd: number; expected_value_usd: number; ratio: number; verdict: string };
  farm_steps: string[];
}

/** The whole universe, accounted for: every protocol is ranked, live, or set aside with a reason. */
export interface Accounting {
  total: number;
  tokened: number;
  ranked: number;
  aside: Record<string, number>;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** The model ledger: the fit itself, published with the board so the page can show its working. */
export interface Ledger {
  terms_adopted: string[];
  growth_factors_active: boolean;
  categories: { category: string; factor: number; train_n: number }[];
  growth: { label: string; factor: number; train_n: number }[];
  age_odds: { label: string; n: number; tokened: number; rate: number; multiplier: number }[];
  validation: {
    half: ValidationSplit;
    fivefold: ValidationSplit;
    temporal: ValidationSplit;
    category_holdout: ValidationSplit;
    typical_miss_factor: number;
    within_2x_pct: number;
  };
  interval: { coverage: string; global_low_mult: number; global_high_mult: number };
  anchors: { slug: string; name: string; tvl_usd: number; actual_mcap_usd: number; fitted_fdv_usd: number }[];
  self_checks: string[];
}

/** Everything the dashboard needs: the board, the live set, the fit, and the accounting. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: {
    train_size: number;
    reference_multiple: number;
    slope: number;
    validation_median_ape: number;
    validation_within_2x_pct: number;
    validation_tested: number;
    typical_miss_factor: number;
    global_launch_rate: number;
  };
  accounting: Accounting;
  watchlist_size: number;
  board_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  ledger: Ledger;
}

export const MODEL_VERSION = 'launch-radar-3';

/** Build the ranked board and the dashboard's data from the snapshot and the fitted model. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const watch = new Set(snapshot.watchlist);
  const aside: Record<string, number> = {};
  let tokened = 0;
  const candidates: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    const reason = setAsideReason(p);
    if (reason === 'tokened') {
      tokened++;
    } else if (reason !== null) {
      aside[reason] = (aside[reason] ?? 0) + 1;
    } else {
      candidates.push(p);
    }
  }
  const scored = candidates.map((p) => {
    const priced = price(p, snapshot.as_of, model);
    const math = farmMath(p, priced);
    return { p, priced, math };
  });
  scored.sort(
    (a, b) =>
      b.priced.implied_value_usd - a.priced.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(s.p.slug),
    age_days: s.priced.age_days,
    implied_value_usd: s.priced.implied_value_usd,
    model: {
      size_multiple: s.priced.size_multiple,
      category_factor: s.priced.category_factor,
      growth_adjustment: s.priced.growth_adjustment,
      launch_odds: s.priced.launch_odds,
      fitted_fdv_usd: s.priced.fitted_fdv_usd,
      value_low_usd: s.priced.value_low_usd,
      value_high_usd: s.priced.value_high_usd,
      age_days: s.priced.age_days,
    },
    farm: {
      capital_usd: s.math.capital,
      weeks: s.math.weeks,
      entry_chain: s.math.entry_chain,
      total_cost_usd: s.math.total_cost_usd,
      expected_share_usd: s.math.expected_share_usd,
      expected_value_usd: s.math.expected_value_usd,
      ratio: s.math.ratio,
      verdict: s.math.verdict,
    },
    farm_steps: farmSteps(s.p, s.priced, s.math),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));

  // Self-checks, computed on the finished board and published in the ledger.
  const asideTotal = Object.values(aside).reduce((a, b) => a + b, 0);
  const onBoard = snapshot.watchlist.filter((s) => board.some((r) => r.slug === s)).length;
  const sortedOk = board.every((r, i) => i === 0 || board[i - 1]!.implied_value_usd >= r.implied_value_usd);
  const bracketed = board.filter((r) => r.model.value_low_usd <= r.model.fitted_fdv_usd && r.model.fitted_fdv_usd <= r.model.value_high_usd).length;
  const verdicts = { strong: 0, worthwhile: 0, thin: 0 };
  for (const r of board) verdicts[r.farm.verdict as keyof typeof verdicts]++;
  const selfChecks = [
    `accounting reconciles: ${tokened} tokened + ${board.length} ranked + ${asideTotal} set aside = ${snapshot.protocols.length} protocols`,
    `watchlist coverage: ${onBoard} of ${snapshot.watchlist.length} watchlist slugs on the board`,
    `board order: implied values non-increasing down the ranks (${sortedOk ? 'verified' : 'FAILED'})`,
    `value ranges bracket the fitted value on ${bracketed} of ${board.length} rows`,
    `farm verdicts: ${verdicts.strong} strong, ${verdicts.worthwhile} worthwhile, ${verdicts.thin} thin`,
    `price fit trained on ${model.train_size} of the ${tokened} tokened protocols (the ones carrying a market cap)`,
  ];

  const ledger: Ledger = {
    terms_adopted: model.terms.map((t) => TERM_LABELS[t]),
    growth_factors_active: !model.growth_disabled,
    categories: [...model.category_factor.entries()]
      .map(([category, factor]) => ({ category, factor: round4(factor), train_n: model.category_train_size.get(category) ?? 0 }))
      .sort((a, b) => b.train_n - a.train_n || (a.category < b.category ? -1 : 1)),
    growth: GROWTH_BUCKET_LABELS.map((label, i) => ({ label, factor: round4(model.growth_adjustment[i]!), train_n: model.growth_train_size[i]! })),
    age_odds: model.age_table.map((a) => ({ label: AGE_BAND_LABELS[a.band]!, n: a.n, tokened: a.tokened, rate: a.rate, multiplier: a.multiplier })),
    validation: {
      half: model.validation.half,
      fivefold: model.validation.fivefold,
      temporal: model.validation.temporal,
      category_holdout: model.validation.category_holdout,
      typical_miss_factor: model.validation.typical_miss_factor,
      within_2x_pct: model.validation.fivefold.within_2x_pct,
    },
    interval: {
      coverage: 'central 80% of out-of-fold errors',
      global_low_mult: round2(Math.exp(model.global_interval_low)),
      global_high_mult: round2(Math.exp(model.global_interval_high)),
    },
    anchors: model.anchors,
    self_checks: selfChecks,
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: {
      train_size: model.train_size,
      reference_multiple: model.reference_multiple,
      slope: round4(model.slope),
      validation_median_ape: model.validation.fivefold.median_ape,
      validation_within_2x_pct: model.validation.fivefold.within_2x_pct,
      validation_tested: model.validation.fivefold.tested,
      typical_miss_factor: model.validation.typical_miss_factor,
      global_launch_rate: round4(model.global_launch_rate),
    },
    accounting: { total: snapshot.protocols.length, tokened, ranked: board.length, aside },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board,
    live,
    ledger,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
