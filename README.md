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
  protocols that carry a market cap, times a category factor and a growth factor. The factors are
  median residuals from the line, shrunk toward 1 by each group's sample size and capped, so a
  thin category borrows the market's answer instead of inventing its own. Extra terms (log age,
  chain count, continuous weekly change) are admitted only when they lower the pooled
  cross-validated error; this run ships the continuous weekly-change term, winsorized at ±150%.
- **Value range** — every row carries the central 80% of the model's own out-of-fold errors in
  its category, shrunk toward the global spread.
- **Launch odds** — a category's tokened share of the snapshot, times an age multiplier read off
  the whole universe (over three years old: 1.4×; under six months: 0.6×), clamped to 1%–98%.
- **Implied value** — fitted value × launch odds, in whole dollars. That is the board's sort key.
- **Held-out honesty, four ways** — a slug-hash half split, a five-fold cross-validation, an
  older-to-newer temporal split, and a leave-one-category-out pass. The dashboard's Model ledger
  tab publishes all four, every category factor, the age-odds table, the pricing anchors
  (recorded cap beside fitted value for all 128 training protocols), and the board's self-checks.
- **Farm verdicts** — each plan's expected share is weighted by the board's own launch odds and
  priced against the plan's full cost, routed through the protocol's cheapest chain, with
  capital never under twice the cost (5% of a launch reaches farmers; the qualifying crowd is
  TVL / $25,000, bounded 5,000–100,000 wallets). Strong = at least 5× cost in odds-weighted
  value; worthwhile = at least 1×; thin = below.

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
board, a detail view, a filtered view) and `dossier.json`, written last with the vendored make.fun
library so the scorer can rebuild it and compare bytes. The program is deterministic: two runs on
the same snapshot write identical bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board and dossier out.
- `lib/model.ts` — the fit, the pricing, the farm plans, and the gate's self-check.
- `dashboard/` — the page (index.html, app.css, app.js), hand-written, no framework, no network.
- `screenshots/` — three views of the dashboard, taken from the program's own output.
- `vendor/makefun-board.ts` — the vendored dossier library from the competition kit.
