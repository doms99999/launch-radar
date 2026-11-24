// Launch Radar's model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// Nothing here is a hand-picked constant about a named protocol. Every number the board states is
// fitted from the snapshot's own tokened protocols and then applied, unchanged, to the pre-token
// ones:
//
//   fitted value  = the log-log price line on TVL, x a category factor, x a growth factor
//   launch odds   = the share of a protocol's peers that already carry a token, read off the
//                   snapshot itself, by category and age band, smoothed toward the wider rate
//   implied value = fitted value x launch odds, in whole dollars
//
// The price line is an ordinary least-squares fit of log market cap on log TVL over the tokened
// protocols that carry a market cap: bigger protocols are worth more, but less per dollar of TVL.
// The category and growth factors are median residuals from that line, shrunk toward one by each
// group's sample size and capped, so a category with two observations borrows most of its factor
// from the market and one with forty stands on its own. The fit is tested held-out: the tokened
// set is split in two by a hash of the slug, each half is fitted on one side and priced on the
// other, and the errors are published in the data the dashboard shows.
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** The fitted model: everything the board's numbers come from, kept whole so the page can state it. */
export interface FittedModel {
  train_size: number;
  /** The log-log pricing line: log value = intercept + slope x log TVL. */
  intercept: number;
  slope: number;
  /** The fitted value-to-TVL multiple at $100M of TVL, before category and growth factors. */
  reference_multiple: number;
  category_factor: Map<string, number>;
  category_train_size: Map<string, number>;
  growth_adjustment: number[];
  growth_train_size: number[];
  global_launch_rate: number;
  category_launch_rate: Map<string, number>;
  cell_launch_rate: Map<string, number>;
  validation: { median_ape: number; within_2x_pct: number; tested: number };
}

/** Sample size at which a category's own offset counts as much as the prior it shrinks toward. */
const OFFSET_PRIOR = 12;
/** Sample size at which a launch-rate cell counts as much as the rate it shrinks toward. */
const ODDS_PRIOR = 20;

/** A shrunk median offset in log space: the group's median residual, pulled toward zero by size. */
function shrunkOffset(residuals: number[]): number {
  if (residuals.length === 0) return 0;
  return (residuals.length * median(residuals)) / (residuals.length + OFFSET_PRIOR);
}

/**
 * Fit the pricing terms on one set of observations: a log-log line of market cap on TVL, then a
 * shrunk median residual per category and per growth bucket, each capped so no thin category can
 * price a protocol at an absurd multiple of its TVL.
 */
function fitPricing(obs: Observation[]): { intercept: number; slope: number; byCategory: Map<string, number>; catSize: Map<string, number>; growth: number[]; growthSize: number[] } {
  const xs = obs.map((o) => Math.log(o.protocol.tvl_usd));
  const ys = obs.map((o) => Math.log(o.protocol.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx > 0 ? sxy / sxx : 1;
  const intercept = my - slope * mx;
  const resid = obs.map((o, i) => ys[i]! - (intercept + slope * xs[i]!));
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
  const growth: number[] = [];
  const growthSize: number[] = [];
  const gcap = Math.log(1.8);
  for (let b = 0; b < 4; b++) {
    const list = obs.filter((o) => growthBucket(o.protocol.change_7d) === b).map((o) => resid[obs.indexOf(o)]!);
    growthSize.push(list.length);
    growth.push(Math.exp(Math.min(gcap, Math.max(-gcap, shrunkOffset(list)))));
  }
  return { intercept, slope, byCategory, catSize, growth, growthSize };
}

/** A deterministic split key: the sum of the slug's code units, so the split never moves. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h += slug.charCodeAt(i);
  return h;
}

/**
 * Fit the whole model on the snapshot: multiples and growth on the tokened protocols that carry a
 * market cap, launch rates on the whole universe, and a held-out test of the pricing fit.
 */
export function fitModel(snapshot: Snapshot): FittedModel {
  const obs: Observation[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ protocol: p, ratio: p.mcap_usd! / p.tvl_usd, age: ageDays(snapshot.as_of, p.listed_at) }));

  const fit = fitPricing(obs);

  // Held-out test: fit on one slug-hash half, price the other, then swap. The error is the
  // absolute percentage error of the fitted value against the market cap the snapshot records.
  const errors: number[] = [];
  let within2x = 0;
  for (const side of [0, 1]) {
    const train = obs.filter((o) => slugHash(o.protocol.slug) % 2 === side);
    const test = obs.filter((o) => slugHash(o.protocol.slug) % 2 !== side);
    if (train.length === 0) continue;
    const half = fitPricing(train);
    for (const o of test) {
      const factor = half.byCategory.get(o.protocol.category ?? 'Uncategorized') ?? 1;
      const predicted = Math.exp(half.intercept + half.slope * Math.log(o.protocol.tvl_usd)) * factor * half.growth[growthBucket(o.protocol.change_7d)]!;
      const actual = o.protocol.mcap_usd!;
      errors.push(Math.abs(predicted - actual) / actual);
      if (predicted >= actual / 2 && predicted <= actual * 2) within2x++;
    }
  }
  const validation = {
    median_ape: errors.length > 0 ? round4(median(errors)) : 0,
    within_2x_pct: errors.length > 0 ? Math.round((within2x / errors.length) * 1000) / 10 : 0,
    tested: errors.length,
  };

  // Launch rates: in each category and age band, the share of protocols that already carry a
  // token. Rates shrink cell to category to global, each with the same prior strength.
  const tokened = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const globalRate = tokened / snapshot.protocols.length;
  const catCount = new Map<string, { tok: number; all: number }>();
  const cellCount = new Map<string, { tok: number; all: number }>();
  for (const p of snapshot.protocols) {
    const cat = p.category ?? 'Uncategorized';
    const cell = `${cat}|${ageBand(ageDays(snapshot.as_of, p.listed_at))}`;
    const tok = isPreToken(p) ? 0 : 1;
    const c = catCount.get(cat) ?? { tok: 0, all: 0 };
    c.tok += tok;
    c.all += 1;
    catCount.set(cat, c);
    const k = cellCount.get(cell) ?? { tok: 0, all: 0 };
    k.tok += tok;
    k.all += 1;
    cellCount.set(cell, k);
  }
  const categoryRate = new Map<string, number>();
  for (const [cat, c] of catCount) categoryRate.set(cat, (c.tok + ODDS_PRIOR * globalRate) / (c.all + ODDS_PRIOR));
  const cellRate = new Map<string, number>();
  for (const [cell, c] of cellCount) {
    const cat = cell.slice(0, cell.lastIndexOf('|'));
    cellRate.set(cell, (c.tok + ODDS_PRIOR * (categoryRate.get(cat) ?? globalRate)) / (c.all + ODDS_PRIOR));
  }

  return {
    train_size: obs.length,
    intercept: fit.intercept,
    slope: fit.slope,
    reference_multiple: round4(Math.exp(fit.intercept + fit.slope * Math.log(100_000_000)) / 100_000_000),
    category_factor: fit.byCategory,
    category_train_size: fit.catSize,
    growth_adjustment: fit.growth,
    growth_train_size: fit.growthSize,
    global_launch_rate: globalRate,
    category_launch_rate: categoryRate,
    cell_launch_rate: cellRate,
    validation,
  };
}

/** One protocol priced by the fitted model: every term kept, so the page can show its working. */
export interface Priced {
  fitted_fdv_usd: number;
  implied_value_usd: number;
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
  const base = Math.exp(model.intercept + model.slope * Math.log(p.tvl_usd));
  const factor = model.category_factor.get(cat) ?? 1;
  const growth = model.growth_adjustment[growthBucket(p.change_7d)]!;
  const fdv = base * factor * growth;
  const odds = model.cell_launch_rate.get(`${cat}|${ageBand(age)}`) ?? model.category_launch_rate.get(cat) ?? model.global_launch_rate;
  return {
    fitted_fdv_usd: Math.round(fdv),
    implied_value_usd: Math.max(1, Math.round(fdv * odds)),
    size_multiple: round4(base / p.tvl_usd),
    category_factor: round4(factor),
    growth_adjustment: round4(growth),
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
};

/** One action's gas on a chain the table does not name. */
const GAS_DEFAULT = 0.4;

export function gasFor(chain: string): number {
  return GAS_BY_CHAIN[chain] ?? GAS_DEFAULT;
}

/** The capital one farm position carries, from the protocol's own TVL. */
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
  return Math.min(100_000, Math.max(1_000, Math.round(tvl / 50_000)));
}

/** The share of a launch that reaches the community, under the stated assumption. */
export const COMMUNITY_SHARE = 0.05;

/** A farm plan's money: the position, the running cost, and what the plan has to beat. */
export interface FarmMath {
  capital: number;
  weeks: number;
  total_cost_usd: number;
  expected_share_usd: number;
  verdict: 'strong' | 'worthwhile' | 'thin';
}

/** Work out a plan's money from the protocol's record and its fitted value. */
export function farmMath(p: SnapshotProtocol, priced: Priced): FarmMath {
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(priced.age_days);
  const primary = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(primary);
  let cost = 2 * gas + weeks * 2 * gas;
  if (p.chains.length > 1) cost += 2.5 + gasFor(p.chains[1]!);
  const total = Math.round(cost * 100) / 100;
  const expected = Math.round(((priced.fitted_fdv_usd * COMMUNITY_SHARE) / farmersFor(p.tvl_usd)) * 100) / 100;
  const verdict = expected >= 3 * total ? 'strong' : expected >= total ? 'worthwhile' : 'thin';
  return { capital, weeks, total_cost_usd: total, expected_share_usd: expected, verdict };
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

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, and a closing
 * verdict that prices the plan against the fitted value. Every figure in the text comes from the
 * protocol's own record and the plan's arithmetic, never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, priced: Priced, math: FarmMath): string[] {
  const primary = p.chains[0] ?? 'its main chain';
  const gas = gasFor(p.chains[0] ?? 'Ethereum');
  const steps: string[] = [];
  steps.push(`Open a fresh wallet for ${p.name} alone, fund it with ${money(math.capital)} plus gas, and keep its seed phrase offline and never reused on another farm. Cost: ${money2(2 * gas)} of gas to fund and approve. Time: 10 minutes, once.`);
  steps.push(`${coreAction(p, math.capital, primary)} Cost: ${money(math.capital)} of capital and about ${money2(2 * gas)} of gas. Time: 20 minutes to set up.`);
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push(`Repeat a smaller position on ${second}, ${p.name}'s second chain: bridge ${money(Math.round(math.capital / 2))} across and open the same kind of position, so the wallet is active on two of its ${p.chains.length} chains. Cost: about ${money2(2.5 + gasFor(second))} in bridge and gas fees. Time: 25 minutes, once.`);
  } else {
    steps.push(`Deepen the same position once in week two: add ${money(Math.round(math.capital / 2))} more on ${primary}, so the wallet's balance grows the way a real user's would instead of sitting flat. Cost: ${money(Math.round(math.capital / 2))} of capital and about ${money2(gas)} of gas. Time: 10 minutes, once.`);
  }
  steps.push(`Make two qualifying actions every week for ${math.weeks} weeks: one deposit, borrow, trade or vote, and one smaller interaction, each from the protocol's own app and never from a script in a single block. Cost: about ${money2(2 * gas)} of gas a week. Time: 15 minutes a week.`);
  steps.push(`Hold every position for the full ${math.weeks} weeks without withdrawing, so the wallet appears in at least ${math.weeks} weekly snapshots and is not filtered out as a one-day farm. Cost: the ${money(math.capital)} stays locked in the position. Time: ${math.weeks} weeks.`);
  steps.push(`Each week, open ${p.name}'s own points or rewards page from the link its app publishes, record the balance in a farm log, and claim nothing from any link sent by message or social post. Cost: nothing to check, and never pay a fee to claim. Time: 5 minutes a week.`);
  const verdictText =
    math.verdict === 'strong'
      ? `the expected share covers the plan's cost about ${Math.max(2, Math.round(math.expected_share_usd / math.total_cost_usd))} times over, so the plan is worth running at full size`
      : math.verdict === 'worthwhile'
        ? `the expected share clears the plan's cost, so the plan is worth running at this size and no larger`
        : `the expected share does not cover the plan's cost, so run it only at the smallest size or skip it until the fitted value rises`;
  steps.push(`Verdict: ${math.weeks} weeks at ${money(math.capital)} costs about ${money2(math.total_cost_usd)} all in. If ${p.name} launches at the fitted ${money(priced.fitted_fdv_usd)} and ${COMMUNITY_SHARE * 100}% reaches farmers, one of an estimated ${farmersFor(p.tvl_usd).toLocaleString('en-US')} qualifying wallets sees about ${money2(math.expected_share_usd)} before the launch odds of ${Math.round(priced.launch_odds * 100)}% are applied; ${verdictText}. Time: the full ${math.weeks} weeks.`);
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
    age_days: number | null;
  };
  farm: { capital_usd: number; weeks: number; total_cost_usd: number; expected_share_usd: number; verdict: string };
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
    global_launch_rate: number;
  };
  accounting: Accounting;
  watchlist_size: number;
  board_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'launch-radar-2';

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
      age_days: s.priced.age_days,
    },
    farm: {
      capital_usd: s.math.capital,
      weeks: s.math.weeks,
      total_cost_usd: s.math.total_cost_usd,
      expected_share_usd: s.math.expected_share_usd,
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
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit: {
      train_size: model.train_size,
      reference_multiple: model.reference_multiple,
      slope: round4(model.slope),
      validation_median_ape: model.validation.median_ape,
      validation_within_2x_pct: model.validation.within_2x_pct,
      validation_tested: model.validation.tested,
      global_launch_rate: round4(model.global_launch_rate),
    },
    accounting: { total: snapshot.protocols.length, tokened, ranked: board.length, aside },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    rows: board,
    live,
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
