[![make.fun entry](https://make.fun/api/competitions/token-radar-01/badge.svg?entry=doms9999)](https://make.fun/bounty/token-radar-01)
[![Live on make.fun](https://make.fun/api/badges/live.svg?user=doms9999&competition=token-radar-01)](https://make.fun/bounty/token-radar-01)
[![Token Radar entry by @doms9999 on make.fun](https://make.fun/api/competitions/token-radar-01/badge.svg?entry=doms9999&v=2)](https://make.fun/bounty/token-radar-01)

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
  thin category borrows the market's answer instead of inventing its own.
- **Launch odds** — the share of a protocol's own category-and-age peers that already carry a
  token, read off the snapshot itself and smoothed cell to category to universe.
- **Implied value** — fitted value × launch odds, in whole dollars. That is the board's sort key.
- **Held-out honesty** — the tokened set is split in two by a hash of the slug; each half is
  fitted on one side and priced on the other. The dashboard publishes the resulting median error
  and the share of prices landing within 2× of the recorded market cap.
- **Farm verdicts** — each plan is priced against its fitted value under stated assumptions (5%
  of a launch reaches farmers; the qualifying crowd is TVL / $50,000, bounded 1,000–100,000
  wallets; gas is charged per chain). Every plan ends in a verdict: strong, worthwhile, or thin.

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
