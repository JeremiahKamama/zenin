Picking up the 4 remaining items from the data-integrity plan, all verified against current code:

## B1 — USDC as buying power (App.jsx)
Two sites still gate on `nextCashBalances.USD != null` only: line 2822 (cash refresh) and line 3080 (bootstrap multi-fetch). HL syncs USDC, so the $317K never replaces the $10K default.
**Fix:** sum USD-pegged stablecoins (USD, USDC, USDT) into the buying-power balance. Add a small `STABLE_USD_EQUIV` set and compute `setBalance` from the sum of those currencies when present. Apply at both call sites identically.

## C3 — dead `sem.unrealizedPnl` reference (unifiedPortfolio.js:383)
`sem` from `deriveReadModelSemantics` has no `unrealizedPnl` field, so this is always `undefined`. Harmless (the offset now uses `row.unrealized_pnl`), but it's dead code flagged in the plan.
**Fix:** change `unrealizedPnl: sem.unrealizedPnl` → `unrealizedPnl: row.unrealized_pnl != null ? Number(row.unrealized_pnl) : null` so the field carries the real per-position PnL (useful for display and matches the value used in the offset calc).

## G — Remove redundant Sources + Coverage cards (PortfolioDrillDown.jsx)
The original plan said "remove the whole PortfolioDrillDown" — that's too blunt because DrillDown also renders the **Positions** card (where real synced BTC/ASTER holdings show) plus Rollout-check and Daily-snapshots. Surgical fix per the user's actual ask ("remove the two Sources cards and the Coverage card"):
- Remove the Sources card block (`PortfolioDrillDown.jsx:142-175`).
- Remove the Coverage card block (`:177-218`).
- Keep Positions (`:222-321`), Rollout check (`:324-354`), Daily snapshots (`:356+`).
- Remove now-unused props (`duplicateInstruments`, `unvaluedTotal`, `warnings`, `fxRates`) from the component signature and the call site in PortfolioModule.jsx:3528-3542 if they're no longer referenced.

## H — Move timeframe dropdown to top-right of hero card (HomeModule.jsx)
Currently the timeframe strip (`home-exec-timeframe-strip` at line 2894) is a flex sibling inside `home-exec-command-head`, sitting below/left of the value block rather than at the card's top-right corner.
**Fix:** restructure the `home-exec-command-head` (line 2850) so the left content (label/value/sources/brokerage) and the timeframe strip are in a row, with the timeframe pushed to the right edge via `margin-left: auto` (or a header-row flex layout). Pure layout/CSS change, no logic change.

## Verification
- B1: after re-sync, the wallet's USDC ($317K) becomes buying power; "Buying power" stat shows the real balance not $10K.
- C3: grep confirms no remaining `sem.unrealizedPnl`; positions carry real unrealized PnL.
- G: Portfolio page shows Positions/Rollout/Snapshots but no Sources/Coverage cards; Home's UnifiedSourceStrip remains the single source indicator.
- H: timeframe dropdown sits at top-right of the hero card.
- `npm run build` clean in frontend.

## Not touched (out of scope)
- The PnL double-count numeric re-check (C2) — you only asked for B1, C3, G, H. The offset wiring is in place; a live numeric check against the $317K wallet is a separate verification step if you want it.
- `INITIAL_ACCOUNT_BALANCE` denominator / +34700% — separate item.
- Harmonization plan (Journal/Tax) — separate track.