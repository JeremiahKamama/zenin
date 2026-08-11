# Plan: notification noise + Hyperliquid portfolio not showing in UI

## Bug A — "previous fills" notifications re-firing on sync
**Root cause:** `portfolioTransactions.createPortfolioTransactionNotifications` emits a
`batch_imported` event ("N transactions imported from hyperliquid across BTC, ASTER…")
whenever >5 fills sync at once. On first/per-day sync that's 2000 fills → one bulk
"historical import" notification. User wants ONLY new trades + account sync success.
Per-fill notifications are already new-only (DB `wasInserted` gate on `tradeFills.sync`).
`account_sync_success` already exists in the sync handler.

**Fix:** Suppress the `batch_imported` notification (the `>5` branch in
`portfolioTransactions.js`). Keep: (1) per-new-trade notifications (≤5, new-only),
(2) `account_sync_success`. This satisfies "only new trades + sync success".

## Bug B — Hyperliquid portfolio data not showing in UI
**Root cause:** Perps ARE correctly in `user_workspace_portfolio` (ws 68). The UI reads the
**unified portfolio model** (`useUnifiedPortfolio` → `/api/portfolio/unified/summary`),
populated only by `recordSourceSync`, gated by `ZENIN_UNIFIED_PORTFOLIO === "true"`.
That env var is UNSET in `.env` → unified model empty → UI falls back to the
$10,000 seed (`INITIAL_ACCOUNT_BALANCE`) + "No positions found".

**Fix:**
1. Set `ZENIN_UNIFIED_PORTFOLIO=true` in `backend/.env`.
2. Re-run the HL sync for ws 68 so `recordSourceSync` writes the BTC+ASTER perps +
   USDC cash into `portfolio_sources` / `portfolio_source_positions` / `portfolio_source_cash`.
3. Verify the unified model is populated; the UI will then render real data.

## Verification
- A: `npm run build` + ad-hoc replay of notification logic (batch suppressed, new-only kept).
- B: after enabling env + re-sync, query `portfolio_sources`/`portfolio_source_positions`
  for ws 68 shows BTC+ASTER; live `/api/portfolio/unified/summary` returns them.
- User confirms: Portfolio view shows BTC 1.76232 + ASTER -97487 with live marks, no $10k seed.

## Out of scope
- The "Maximum update depth exceeded" React warning (TradingViewChart/HomeModule) — separate
  render-loop issue; note for follow-up, not blocking data display.
- `authLimiter` 10→40, guest-gate fix, perp-sync address fix — already shipped.
