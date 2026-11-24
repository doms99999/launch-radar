[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/doms99999/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/doms99999/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Launch Radar

A token launch radar for the make.fun bounty **token-radar-01**: it reads the sealed DefiLlama
snapshot (758 protocols at or above $5M TVL, frozen 2026-11-14), separates the protocols that
already carry a token from the ones still waiting on a launch, and ranks the pre-token candidates
by the value a launch would plausibly carry, with a costed farm plan for every row.

## The model

Every number is fitted from the snapshot's own tokened protocols; no protocol name is
special-cased anywhere.

- **Fitted value** — a least-squares price line of log market cap on log TVL over the 128 tokened
  protocols that carry a market cap (slope ≈ 0.53: value grows with roughly the square root of
  TVL), times a capped term adjustment, a category factor and a growth factor. The factors are
  median residuals from the line, shrunk toward 1 by each group's sample size and capped, so a
  thin category borrows the market's answer instead of inventing its own. Extra terms (log age,
  chain count, continuous weekly change — and a scrambled placebo that must fail) are admitted
  only when they lower the pooled cross-validated error; the ledger publishes the full audit of
  every test, kept or dropped. This run ships weekly change alone (coefficient −3.71); log age
  and chain count were tested against it and rejected, the placebo scored +0.4% and was refused,
  and any shipped term's total effect on one price is capped at ×0.33–×3.00, so no single
  regressor can manufacture a row.
- **Value range** — an 80% split-conformal band from the model's own out-of-fold errors in the
  row's category, conformalized on both tails. On the held-out anchors the bands covered 84.4%
  (target 80%), and that coverage check is published on the board itself.
- **Launch odds** — a category's tokened share of the snapshot, times a survival factor read off
  the whole universe Kaplan-Meier style: of the launches that ever happen, most happen young, so
  the factor falls with age (×1.19 under six months, ×0.45 over three years). A protocol still
  tokenless after years is priced on the tail of launches that remain, not rewarded for
  surviving. Odds are clamped to 1%–98%.
- **Implied value** — fitted value × launch odds, in whole dollars. That is the board's sort key.
- **Held-out honesty, four ways** — a slug-hash half split, a five-fold cross-validation, an
  older-to-newer temporal split, and a leave-one-category-out pass, each reported as a typical
  multiplicative miss (five-fold: ×/÷ 3.5) beside the percentage errors. The dashboard's Model
  ledger tab publishes all four passes, the term audit, every category factor, the survival
  table, the pricing anchors (recorded cap beside fitted value for all 128 training protocols),
  and the board's self-checks. The dashboard also recomputes every row's fitted value from the
  published fit, in the browser, and reports the match count on the cover.
- **Farm verdicts** — each plan's expected share is weighted by the board's own launch odds and
  priced against the plan's full cost: gas and bridge fees routed through the protocol's
  cheapest chain, plus the farmer's time at $5 an hour, with capital never under twice the cost.
  The qualifying crowd scales with the fitted launch value (fitted / $2,500, bounded
  5,000–200,000 wallets), so a bigger launch draws a bigger crowd instead of a bigger per-wallet
  share. Every plan states its break-even launch value and its net value per hour of effort.
  Strong = at least 3× full cost in odds-weighted value; worthwhile = at least 1×; thin = below.
  This run: 23 strong, 90 worthwhile, 84 thin.

The whole universe is accounted for on the dashboard's integrity strip: 416 tokened protocols are
the training set and the Live view, 197 pre-token protocols are ranked, and 145 are set aside with
their reasons (exchange, versioned pool, wrapped or staked product, staked or bridged product) —
including the bridge and staking product categories the snapshot's own watchlist definition
excludes. All 40 watchlist protocols are on the board.

## Run it

Node.js 22.18 or later, standard library only, no network:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

This writes `board.json` (the ranked board), `data.js` (the dashboard's dataset), `dashboard/`
(the static page: sortable, filterable, with a detail view per protocol), `screenshots/` (the
board, a detail view, a watchlist view, the model ledger) and `dossier.json`, written last with
the vendored make.fun library so the scorer can rebuild it and compare bytes. The program is
deterministic: two runs on the same snapshot write identical bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board and dossier out.
- `lib/model.ts` — the fit, the pricing, the farm plans, and the gate's self-check.
- `dashboard/` — the page (index.html, app.css, app.js), hand-written, no framework, no network.
- `screenshots/` — four views of the dashboard, taken from the program's own output.
- `vendor/makefun-board.ts` — the vendored dossier library from the competition kit.
