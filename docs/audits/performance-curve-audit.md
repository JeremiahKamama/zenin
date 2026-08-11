# Zenin — Performance Curve / Equity / PNL / Returns Audit

**Status:** READ-ONLY — Code-level audit completed. No files were modified.
**Date:** 2026-08-10
**Scope:** PortfolioModule.jsx Performance Curve data pipeline (frontend → backend → database)

---

## Executive Summary

### 1. Why does connected-account equity appear incorrect?

The Performance Curve does **not** display true portfolio equity for connected accounts. Instead, it displays a **fill-reconstructed equity curve** that backward-subtracts cumulative `realized_pnl` from the **current live equity** (`getUnifiedSummary().totalValue`). This means:

- The curve **ignores unrealized PNL** — open positions with gains/losses are invisible in the historical curve
- The curve **ignores cash** — deposits/withdrawals are hardcoded to 0
- The curve **assumes** `historicalEquity = currentEquity - Σ(future_realizedPnL)`, which is only valid if there are no open positions, no cash flows, and no unrealized P&L changes — **never true in practice**

**Root cause:** `getUnifiedEquityCurveFromFills()` (`unifiedPortfolio.js:1569-1667`) and the frontend's preference for `fillEquityCurve` over snapshots (`PortfolioModule.jsx:694`).

### 2. Why does connected-account PNL appear incorrect?

**Realized PNL** is reconstructed from per-fill `closedPnl` (Hyperliquid-specific, stored in `raw_payload_json`). **Unrealized PNL** is computed for the live headline (`getUnifiedSummary`) but **never back-propagated** to historical snapshots. The EOD snapshot writer (`assembleSnapshotInputs`) reads from `user_workspace_trades` (legacy manual trades), **not** from `user_workspace_trade_fills` or `portfolio_source_transactions`, so realized PNL from connected-account fills is **missing from snapshots**.

### 3. Why do returns appear incorrect?

Daily return is computed client-side as `(today.portfolioValue - yesterday.portfolioValue) / yesterday.portfolioValue` on the fill-reconstructed curve — measuring the return on **accumulated realized PNL**, not portfolio return. Deposits/withdrawals are zero, so any deposit appears as 100% gain.

### 4. Is the Performance Curve using the correct historical source?

**NO.** The `portfolio_daily_snapshots` table is the architecturally correct immutable source-of-truth, but:
- The frontend **prefers** `fillEquityCurve` (line 694) and only falls back to snapshots when it's empty
- The EOD snapshot writer (`assembleSnapshotInputs`) reads **only legacy manual tables** — not the `portfolio_source_*` connected-account tables
- `backfillUnifiedSnapshotsFromFills` writes snapshots **from the same flawed fill curve**

### 5. Is account sync providing sufficient historical data?

**NO.** The Hyperliquid sync returns current positions, fills, and `cashBalance` (`accountValue`), but `recordSourceSync` does **not** persist `cashBalance` to `portfolio_source_cash`. No historical equity time-series is stored — only current snapshots are written. Historical equity is **reconstructed** from fills, which is lossy.

### 6. Is the unified portfolio layer losing required information?

**YES — selectively.** `getUnifiedSummary()` correctly reads `portfolio_source_positions` (including `unrealized_pnl`) and `portfolio_source_cash` for the **live headline**, but `getUnifiedEquityCurveFromFills()` bypasses the unified layer entirely — it reads only `realized_pnl` from `user_workspace_trade_fills`.

### 7. Are cash flows handled correctly?

**NO.** Both fill-curve and snapshot paths hardcode `deposits = 0, withdrawals = 0`. There is no `user_workspace_cashflows` ledger table.

### 8. Is the benchmark real?

**Partially.** Yahoo Finance is used for real daily close data (`portfolioSnapshots.js:96-147`), but on the fill-curve path, `benchmarkValue` is sparsely populated. On the snapshot fallback path, it's hardcoded to `null` (line 745).

### 9. What is the single biggest architectural problem?

The `portfolio_daily_snapshots` table was designed as the canonical immutable historical source, but `assembleSnapshotInputs()` — the EOD snapshot writer — only reads from **legacy manual tables** (`user_workspace_portfolio`, `user_workspace_cash`), completely **bypassing** the connected-account `portfolio_source_*` tables. No immutable snapshots are ever written from connected-account data. The fill-curve backfill then writes **derived** (fill-reconstructed) snapshots, making them appear as historical data when they are fabricated.

### 10. What should be fixed first?

**Priority 1:** `assembleSnapshotInputs()` must read from `portfolio_source_positions` and `portfolio_source_cash`, not just legacy tables (fixes EOD for connected accounts).

**Priority 2:** The frontend must **always prefer** `portfolio_daily_snapshots` for the Performance Curve, using the fill curve only as a transient live overlay.

---

## Data Lineage Diagram (Actual)

```
BROKERS/EXCHANGES
  │
  ├── Hyperliquid: holdings (positions + unrealized_pnl),
  │                fills (closedPnl → realized_pnl),
  │                marginSummary.accountValue (cashBalance)
  ├── SnapTrade: holdings, positions, transactions
  └── Wallet: balances
  │
  ▼
ACCOUNT SYNC (exchangeSync.js:237)
  │ — returns { holdings, trades, tradeFills, cashBalance, currency: "USDC" }
  │
  ▼
recordSourceSync (unifiedPortfolio.js:653)
  │ — INSERT INTO: portfolio_sources, portfolio_source_positions,
  │   portfolio_source_cash, portfolio_source_transactions
  │ — ⚠️ cashBalance NOT written to portfolio_source_cash
  │ — ⚠️ No historical equity stored
  │
  ▼
getUnifiedSummary (unifiedPortfolio.js:893)
  │ — CURRENT live headline: totalValue = investedValue + cashValue + manualValue
  │ — Reads portfolio_source_positions, portfolio_source_cash, user_workspace_portfolio
  │ — ✅ Correct for live display
  │
  ▼
runWorkspaceSync (unifiedPortfolio.js:1742)
  │ — Calls recordUnifiedSnapshot + backfillUnifiedSnapshotsFromFills
  │
  ▼
getUnifiedEquityCurveFromFills (unifiedPortfolio.js:1569)
  │ — ⚠️ Reconstructs curve from user_workspace_trade_fills.realized_pnl ONLY
  │ — equity(t) = currentEquity - Σ(future realPnl after t)
  │ — ⚠️ Ignores unrealized PNL, cash, market value changes
  │ — ⚠️ Hyperliquid-only (raw_payload_json ? 'closedPnl')
  │
  ▼
backfillUnifiedSnapshotsFromFills (unifiedPortfolio.js:1673)
  │ — INSERT fill-curve points into portfolio_daily_snapshots
  │ — All rows: estimated=TRUE, invested_capital=0, cash from summary
  │ — ⚠️ Snapshots are DERIVED from fill curve, not independent observations
  │
  ▼
portfolio_daily_snapshots (database.js:2113)
  │ — Rich schema: portfolio_value, cash, invested_capital, daily_pnl,
  │   realized_pnl, unrealized_pnl, deposits, withdrawals, benchmark_*
  │ — ⚠️ BUT only populated from: fill-curve backfill (estimated) OR
  │ —   EOD job (legacy tables only → portfolio_value=0 for connected accounts)
  │
  ▼
API endpoints (backend/index.js):
  │ GET /api/portfolio/unified/summary        → getUnifiedSummary (live headline)
  │ GET /api/portfolio/unified/snapshots      → getUnifiedSnapshots (is_unified=TRUE only)
  │ GET /api/portfolio/unified/equity-curve   → getUnifiedEquityCurveFromFills (fill curve)
  │ GET /api/portfolio/history                → reads portfolio_daily_snapshots (legacy)
  │
  ▼
FRONTEND: useUnifiedPortfolio (hooks/useUnifiedPortfolio.js:29)
  │ — Fetches all 5 endpoints in parallel (line 52-63)
  │ — Returns: { summary, snapshots, fillEquityCurve, snapshotTimeline, ... }
  │
  ▼
FRONTEND: PortfolioModule.jsx:687-785 (loadHistory useEffect)
  │ — PREFERENCE ORDER (line 694):
  │   1. unifiedPortfolio.fillEquityCurve (if length > 1)   ← CURRENTLY ACTIVE
  │   2. unifiedPortfolio.snapshots (fallback)              ← ONLY IF fillCurve empty
  │   3. fetchPerformanceHistory() (legacy API)             ← ONLY IF unified=false
  │
  │ — ⚠️ fillEquityCurve branch HARDCODES:
  │     cash=0, investedCapital=0, deposits=0, withdrawals=0, benchmarkValue=null
  │ — ⚠️ snapshots branch also overwrites dailyReturn=0, benchmarkValue=null
  │
  ▼
buildEquitySeries (frontend/src/utils/performanceHistory.js:114)
  │ — Converts to [timestamp, value] pairs
  │ — mode: "equity" (raw value), "pnl" (value - baseValue),
  │   "percentage" ((value - baseValue) / baseValue * 100)
  │ — ⚠️ No interpolation, no cash-flow adjustment
  │
  ▼
Live overlay (PortfolioModule.jsx:800-812)
  │ — Appends currentAccountEquity as single point (Date.now())
  │
  ▼
PERFORMANCE CURVE (chart)
  │
  ├── Y-axis = portfolioValue (from snapshotHistory)
  ├── Tooltip = Equity / PNL / Return from same snapshotHistory
  └── Daily return = (today - yesterday) / yesterday  [client-side]
```

---

## File & Function Inventory

### Performance UI

| Area | File | Function / Component | Purpose |
|------|------|---------------------|---------|
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `loadHistory` useEffect (lines 687–785) | Loads equity curve with 3-tier fallback |
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `chartData` useMemo (lines 794–814) | Converts snapshotHistory → chart series + live overlay |
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `snapshotHistory` state | Stores normalized curve points |
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `historyBaseValue` useMemo (line 789) | First point or live equity as base |
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `buildEquitySeries` (via import, line 796) | Generates [ts, value] arrays for chart |
| Performance Curve | `frontend/src/components/PortfolioModule.jsx` | `yFormatter` (line 831) | Y-axis label formatting |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `buildEquitySeries` (line 114) | Converts points → chart series with modes |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `buildBenchmarkSeries` (line 134) | Benchmark series from stored closes |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `resolveRange` (line 42) | Date filtering for 1D/1W/1M/YTD/1Y/ALL |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `fetchPerformanceHistory` (line 62) | Calls /api/portfolio/unified/equity-curve |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `timeWeightedReturn` (line 155) | TWR: geometric link of daily returns |
| Performance Curve | `frontend/src/utils/performanceHistory.js` | `moneyWeightedReturn` (line 181+) | MWR/IRR with Newton's method |
| Connected data | `frontend/src/hooks/useUnifiedPortfolio.js` | `useUnifiedPortfolio` (line 29) | Fetches summary, positions, sources, snapshots, fillEquityCurve |
| Live overlay | `frontend/src/components/PortfolioModule.jsx` | `currentAccountEquity` (line 682) | `resolveHeadlineValue({ unified, legacyEquity })` |

### Equity Calculation

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Live headline equity | `frontend/src/utils/portfolioHeadline.js` | `resolveHeadlineValue` (line 1) | Unified `totalValue` vs legacy `totalAccountEquity` |
| Live headline equity | `backend/unifiedPortfolio.js` | `getUnifiedSummary` (line 893) | `totalValue = investedValue + cashValue + manualValue` |
| Historical equity (fill-curve) | `backend/unifiedPortfolio.js` | `getUnifiedEquityCurveFromFills` (line 1569) | `equity(t) = currentEquity - Σ(future_realized_pnl)` |
| Historical equity (snapshots) | `backend/portfolioSnapshots.js` | `PortfolioHistoryRepository.getSnapshots` (line 554) | Reads `portfolio_daily_snapshots` |
| Snapshot equity inputs | `backend/portfolioSnapshots.js` | `assembleSnapshotInputs` (line 168) | `portfolioValue = cash + totalValue` (legacy tables ONLY) |
| Snapshot daily PnL | `backend/portfolioSnapshots.js` | `DailySnapshotService.writeDay` (line 394) | `dailyPnl = portfolioValue - prevValue` |
| Account snapshot (legacy) | `frontend/src/utils/accountMetrics.js` | `calculateAccountSnapshot` (line 78) | `totalAccountEquity = liveAvailableBalance + portfolioValue + optionsUnrealizedPnL` |
| Trade timeline equity | `frontend/src/utils/accountMetrics.js` | `buildTradeTimeline` (line 37) | Per-fill equity from `accountEquityAfter` (legacy, not used on unified path) |
| Today's snapshot | `backend/unifiedPortfolio.js` | `recordUnifiedSnapshot` (line 1503) | Writes `portfolio_value = summary.totalValue` for today |

### PNL Calculation

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Realized PNL (fill-curve) | `backend/unifiedPortfolio.js` | `getUnifiedEquityCurveFromFills` (line 1583) | `realized = closedPnl - fee_amount` per fill |
| Realized PNL (fills storage) | `backend/database.js` | `tradeFills.sync` (line 6044) | Stores `realized_pnl` in `user_workspace_trade_fills` |
| Realized PNL (snapshots) | `backend/portfolioSnapshots.js` | `assembleSnapshotInputs` (line 260-268) | Reads from `user_workspace_trades` (LEGACY ONLY — misses connected fills) |
| Unrealized PNL (unified) | `backend/unifiedPortfolio.js` | `getUnifiedSummary` (line 1014) | `row.unrealized_pnl` from `portfolio_source_positions` |
| Unrealized PNL (snapshots) | `backend/portfolioSnapshots.js` | `writeDay` (line 423) | `unrealizedPnl = portfolioValue - investedCapital - cash` |
| Unrealized PNL (storage) | `backend/unifiedPortfolio.js` | `recordSourceSync` (line 741) | Writes `p.unrealizedPnl` to `portfolio_source_positions.unrealized_pnl` |
| Unrealized PNL (curve) | N/A | N/A | **NOT USED IN EQUITY CURVE** |

### Return Calculation

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Daily return (fill-curve) | `frontend/src/components/PortfolioModule.jsx` | (line 716-719) | `(today.value - yesterday.value) / yesterday.value` |
| Daily return (snapshots) | `frontend/src/components/PortfolioModule.jsx` | (line 756-760) | Same formula, **overwrites** backend `daily_return` (line 742) |
| Daily return (backend, stored) | `backend/portfolioSnapshots.js` | `writeDay` (line 395) | `dailyReturn = dailyPnl / prevValue` |
| TWR | `frontend/src/utils/performanceHistory.js` | `timeWeightedReturn` (line 155) | Geometric link of daily returns |
| MWR | `frontend/src/utils/performanceHistory.js` | `moneyWeightedReturn` (line 181+) | Newton's method IRR |
| Total/cumulative return | `frontend/src/components/PortfolioModule.jsx` | chartMode "percentage" (line 807) | `(value - baseValue) / baseValue * 100` |

### Historical Data

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Equity curve API | `backend/index.js:13733` | `GET /api/portfolio/unified/equity-curve` | Returns `getUnifiedEquityCurveFromFills` result |
| Snapshots API | `backend/index.js:13719` | `GET /api/portfolio/unified/snapshots` | Returns `getUnifiedSnapshots` (is_unified=TRUE, last 30-90) |
| Legacy history API | `backend/index.js:13749` | `GET /api/portfolio/history` | Serves `portfolio_daily_snapshots` (read-only) |
| Fill-curve builder | `backend/unifiedPortfolio.js:1569` | `getUnifiedEquityCurveFromFills` | Queries `user_workspace_trade_fills` |
| Fill equity formula | `backend/unifiedPortfolio.js:1591-1594` | Inside above | `after[i] = after[i+1] + fills[i+1].realized; equity = currentEquity - after[i]` |
| Daily forward-fill | `backend/unifiedPortfolio.js:1598-1623` | Inside above | One point per UTC day, carry-forward if no fill |
| Snapshot backfill | `backend/unifiedPortfolio.js:1673` | `backfillUnifiedSnapshotsFromFills` | Inserts fill-curve → snapshots (all estimated=TRUE) |
| EOD job trigger | `backend/unifiedPortfolio.js:1770` | Inside `runWorkspaceSync` | Calls `recordUnifiedSnapshot` + `backfillUnifiedSnapshotsFromFills` |
| EOD snapshot inputs | `backend/portfolioSnapshots.js:168` | `assembleSnapshotInputs` | Reads ONLY `user_workspace_portfolio` + `user_workspace_cash` |
| Snapshot reader | `backend/portfolioSnapshots.js:554` | `getSnapshots` | Reads `portfolio_daily_snapshots` by date range |
| Snapshot mapper | `backend/portfolioSnapshots.js:338` | `mapSnapshotRow` | Converts DB row → JS object |
| Unified snapshots | `backend/unifiedPortfolio.js:1535` | `getUnifiedSnapshots` | Reads `portfolio_daily_snapshots` WHERE `is_unified=TRUE` |

### Snapshot Generation

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Unified today | `backend/unifiedPortfolio.js:1503` | `recordUnifiedSnapshot` | Immutable insert of today's `summary.totalValue` |
| EOD writer | `backend/portfolioSnapshots.js:385` | `DailySnapshotService.writeDay` | `ON CONFLICT DO NOTHING` insert |
| EOD runner | `backend/portfolioSnapshots.js:476` | `DailySnapshotService.runEod` | Iterates market days, carries weekends forward |
| Carry-forward | `backend/portfolioSnapshots.js:491` | Inside `runEod` | Weekend/holiday: copy prior close, `estimated=TRUE` |
| Fill backfill | `backend/unifiedPortfolio.js:1673` | `backfillUnifiedSnapshotsFromFills` | Fill-curve → snapshot (all `estimated=TRUE`) |
| Snapshot trigger | `backend/unifiedPortfolio.js:1770` | Inside `runWorkspaceSync` | Calls both writers after sync |
| Snapshot schema | `backend/database.js:2113` | Table DDL | 20+ fields: cash, invested_capital, daily_pnl, realized/unrealized_pnl, deposits/withdrawals, benchmark_* |
| Snapshot index | `backend/database.js:2147` | `idx_snapshots_workspace_date` | `(workspace_id, snapshot_date DESC)` |

### Account Sync

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Hyperliquid sync | `backend/exchangeSync.js:237` | `syncHyperliquid` | Fetches positions, fills, cashBalance |
| CashBalance source | `backend/exchangeSync.js:342` | Inside `syncHyperliquid` | `state?.marginSummary?.accountValue` → `cashBalance` |
| Sync orchestrator | `backend/index.js` | `POST /api/portfolio/sync` | Triggers connector sync |
| Source recording | `backend/unifiedPortfolio.js:653` | `recordSourceSync` | Writes to `portfolio_sources` + child tables |
| ⚠️ Cash not persisted | `backend/unifiedPortfolio.js:746-752` | Inside `recordSourceSync` | Only writes `source.cash` array → `portfolio_source_cash`, but `cashBalance` from Hyperliquid is returned separately and NOT included in `source.cash` |
| Sync runs log | `backend/unifiedPortfolio.js:127` | Table DDL | `portfolio_sync_runs` with status tracking |
| Workspace sync | `backend/unifiedPortfolio.js:1742` | `runWorkspaceSync` | Orchestrates summary + snapshot + backfill |
| Sync status API | `backend/index.js:13562` | `GET /api/portfolio/unified/sync-status` | Returns sync run status |

### Position Sync

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Position storage | `backend/unifiedPortfolio.js:720` | Inside `recordSourceSync` | INSERT into `portfolio_source_positions` |
| Position schema | `backend/unifiedPortfolio.js:72` | Table DDL | 20+ columns: unrealized_pnl, market_value, notional_value, collateral_value, leverage |
| Position query | `backend/unifiedPortfolio.js:926` | Inside `getUnifiedSummary` | SELECT with JOIN on `portfolio_sources` |
| Position valuation | `backend/unifiedPortfolio.js:984` | `valueRow()` | `marketValue = row.market_value \|\| qty * price` |
| Position semantics | `backend/unifiedPortfolio.js:808` | `deriveReadModelSemantics` | Determines derivative/spot/liability |
| Derivative handling | `backend/unifiedPortfolio.js:1013-1036` | Inside `valueRow` | Derivatives: `portfolioValue = collateral + unrealizedPnl` |
| Position metadata | `backend/unifiedPortfolio.js:148` | Column | `position_metadata JSONB` for future extensibility |

### Transaction Sync

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Transaction storage | `backend/unifiedPortfolio.js:754` | Inside `recordSourceSync` | INSERT into `portfolio_source_transactions` |
| Transaction schema | `backend/unifiedPortfolio.js:108` | Table DDL | Includes `realized_pnl` column |
| Fill storage | `backend/database.js:6058` | `tradeFills.sync` | INSERT into `user_workspace_trade_fills` with `realized_pnl` |
| Fill schema | `backend/database.js:1649` | Table DDL | 20+ columns including `realized_pnl`, `raw_payload_json` |
| Fill query for curve | `backend/unifiedPortfolio.js:1574-1576` | Inside `getUnifiedEquityCurveFromFills` | `SELECT executed_at, fee_amount, raw_payload_json WHERE raw_payload_json ? 'closedPnl'` |
| Unified transactions API | `backend/index.js:13668` | `GET /api/portfolio/unified/transactions` | Returns `portfolio_source_transactions` records |

### Unified Portfolio

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Unified module | `backend/unifiedPortfolio.js` | Full file | Canonical source-aware read model |
| Feature flag | `backend/unifiedPortfolio.js:19` | `isEnabled()` | `ZENIN_UNIFIED_PORTFOLIO` must be `"true"` |
| Summary | `backend/unifiedPortfolio.js:893` | `getUnifiedSummary` | Current headline: `totalValue = investedValue + cashValue + manualValue` |
| Equity curve | `backend/unifiedPortfolio.js:1569` | `getUnifiedEquityCurveFromFills` | Reconstructs curve from fill `realized_pnl` |
| Snapshots | `backend/unifiedPortfolio.js:1535` | `getUnifiedSnapshots` | Reads `portfolio_daily_snapshots WHERE is_unified=TRUE` |
| Source write | `backend/unifiedPortfolio.js:653` | `recordSourceSync` | Writes sources/positions/cash/transactions |
| Workspace sync | `backend/unifiedPortfolio.js:1742` | `runWorkspaceSync` | Orchestrates summary + today snapshot + backfill |
| FX loading | `backend/unifiedPortfolio.js` | `loadFxRates` | Loads `portfolio_fx_rates` for `toBase()` conversion |
| FX schema | `backend/database.js:141` | Table DDL | `portfolio_fx_rates` (base, quote, rate) |
| Stablecoin registry | `backend/stablecoins.js` | USD_EQUIVALENTS | USD, USDC, USDT, BUSD, DAI, etc. |

### Benchmark

| Area | File | Function | Purpose |
|------|------|----------|---------|
| Benchmark close | `backend/portfolioSnapshots.js:138` | `getBenchmarkClose` | Yahoo Finance daily close |
| Benchmark series | `backend/portfolioSnapshots.js:101` | `loadYahooSeries` | Yahoo Finance chart API (cached 1h) |
| Crypto benchmarks | `backend/portfolioSnapshots.js:95` | `CRYPTO_BENCHMARKS` | BTC, ETH, BTC-USD, ETH-USD |
| Benchmark stored | `backend/database.js:2124` | Column | `benchmark_value`, `benchmark_return`, `benchmark_relative_return` |
| Benchmark write | `backend/portfolioSnapshots.js:401-412` | Inside `writeDay` | Only during EOD snapshot; `null` if Yahoo fetch fails |
| Benchmark on fill-curve | `backend/unifiedPortfolio.js:1637-1656` | Inside `getUnifiedEquityCurveFromFills` | Real Yahoo close per fill-curve point (best-effort) |
| Benchmark on snapshot path | `PortfolioModule.jsx:706,745` | Frontend | `benchmarkValue: null` on snapshots fallback — **hardcoded null** |
| Benchmark TWR | `performanceHistory.js:155` | `timeWeightedReturn` | TWR from daily returns (not yet wired to chart) |

### API

| Area | File | Endpoint | Purpose |
|------|------|----------|---------|
| Unified summary | `backend/index.js:13481` | `GET /api/portfolio/unified/summary` | `getUnifiedSummary` — current headline |
| Unified positions | `backend/index.js:13491` | `GET /api/portfolio/unified/positions` | `getUnifiedPositions` |
| Unified sources | `backend/index.js:13501` | `GET /api/portfolio/unified/sources` | `getUnifiedSources` |
| Unified sync | `backend/index.js` | `POST /api/portfolio/sync` | Triggers `runWorkspaceSync` |
| Unified transactions | `backend/index.js:13668` | `GET /api/portfolio/unified/transactions` | `portfolio_source_transactions` |
| Unified reconciliation | `backend/index.js:13680` | `GET /api/portfolio/unified/reconciliation` | Source vs legacy comparison |
| Unified FX rates | `backend/index.js:13691` | `GET /api/portfolio/unified/fx-rates` | `portfolio_fx_rates` |
| Unified snapshots | `backend/index.js:13719` | `GET /api/portfolio/unified/snapshots` | `getUnifiedSnapshots` (is_unified=TRUE) |
| Unified equity curve | `backend/index.js:13733` | `GET /api/portfolio/unified/equity-curve` | `getUnifiedEquityCurveFromFills` |
| Legacy history | `backend/index.js:13749` | `GET /api/portfolio/history` | Reads `portfolio_daily_snapshots` (all, not just unified) |
| Legacy portfolio summary | `backend/index.js` | `GET /api/portfolio/summary` | Legacy summary (manual holdings only) |

### Database

| Area | File | Table | Purpose |
|------|------|-------|---------|
| Trade fills | `backend/database.js:1649` | `user_workspace_trade_fills` | Per-fill executions with `realized_pnl`, `raw_payload_json` |
| Daily snapshots | `backend/database.js:2113` | `portfolio_daily_snapshots` | Immutable historical portfolio data (20+ fields) |
| Source positions | `backend/unifiedPortfolio.js:72` | `portfolio_source_positions` | Connected-account positions with full semantics |
| Source cash | `backend/unifiedPortfolio.js:96` | `portfolio_source_cash` | Connected-account cash balances |
| Source transactions | `backend/unifiedPortfolio.js:108` | `portfolio_source_transactions` | Connected-account transactions with `realized_pnl` |
| Sources registry | `backend/unifiedPortfolio.js:38` | `portfolio_sources` | Connected account metadata |
| Source accounts | `backend/unifiedPortfolio.js:61` | `portfolio_source_accounts` | Account-level mapping |
| Sync runs | `backend/unifiedPortfolio.js:127` | `portfolio_sync_runs` | Sync status tracking |
| FX rates | `backend/database.js:141` | `portfolio_fx_rates` | Currency conversion rates |
| Manual portfolio | `backend/database.js` | `user_workspace_portfolio` | Manual holdings (legacy, used by EOD) |
| Manual cash | `backend/database.js` | `user_workspace_cash` | Manual cash (legacy, used by EOD) |
| Manual trades | `backend/database.js` | `user_workspace_trades` | Manual trade records (used by EOD for realized PnL) |
| Brokerage holdings | `backend/exchangeSync.js` | `brokerage_holdings` | SnapTrade brokerage holdings (legacy sync path) |

---

## What Each Performance Curve Point Represents

### Fill-Curve Path (current primary source)

```
Each point on the Performance Curve:

  t = UTC midnight timestamp of either a fill date or a forward-filled day

  equity (mapped to portfolioValue in frontend):
    = currentEquity - Σ(realized_pnl of all fills AFTER this date)
    where currentEquity = getUnifiedSummary().totalValue (LIVE value)

  dailyReturn:
    = (this.equity - prev.equity) / prev.equity  [computed client-side]

  cash: 0           ⚠️ hardcoded
  investedCapital: 0 ⚠️ hardcoded
  deposits: 0        ⚠️ hardcoded
  withdrawals: 0     ⚠️ hardcoded
  benchmarkValue: Yahoo Finance close (best-effort, sparse)
  estimated: TRUE for forward-filled days, FALSE for fill days
  source: "fill_curve"

  This is NOT portfolio equity.
  This is LIVE EQUITY backward-subtracted by FUTURE realized PNL.
```

### Snapshot Path (fallback when fill-curve empty)

```
  portfolioValue = portfolio_daily_snapshots.portfolio_value
  (from recordUnifiedSnapshot: totalValue, or from backfillUnifiedSnapshotsFromFills: fill-curve equity)

  dailyReturn: 0  ⚠️ then overwritten client-side with same simple return formula
  benchmarkValue: null  ⚠️ hardcoded null
```

### Live Overlay Point (always appended)

```
  t = Date.now()
  portfolioValue = currentAccountEquity (from getUnifiedSummary().totalValue)
  Only appended if last snapshot predates today.
```

---

## Equity Formula Audit

### Live Headline (getUnifiedSummary, line 1196)

```
totalValue = investedValue + cashValue + manualValue

investedValue = Σ position.marketValue (from portfolio_source_positions OR user_workspace_portfolio)
  - For derivatives: marketValue = collateralValue + unrealizedPnl
  - For spot: marketValue = market_value || (quantity × current_price)

cashValue = Σ portfolio_source_cash.amount (USD-equivalent only)
  - Minus: totalCollateralOffset + totalPnlOffset (to avoid double-counting margin/PnL)
  - If cashValue < 0: cashValue = 0

manualValue = Σ user_workspace_portfolio (qty × price)
  - Only included when NO connected source has valued positions (manualExclusion logic, line 1157-1166)
```

### Historical (getUnifiedEquityCurveFromFills, line 1594)

```
currentEquity = getUnifiedSummary().totalValue  (LIVE current value)

fills = SELECT executed_at, fee_amount, raw_payload_json
        FROM user_workspace_trade_fills
        WHERE raw_payload_json ? 'closedPnl'  ← Hyperliquid-only

equity(t) = currentEquity - Σ(fills[i].realized) for all fills where fills[i].t > t

This backward-accumulation assumes:
  historicalEquity(t) = currentEquity(t_now) - Σ(realizedPnL between t and t_now)

This is WRONG because:
  - currentEquity includes UNREALIZED PnL that didn't exist at time t
  - currentEquity includes current cash (deposits/withdrawals after t)
  - currentEquity includes market value changes after t
  - There may be open positions at time t that have since been closed
```

### Snapshot (assembleSnapshotInputs, line 253)

```
portfolioValue = cash + totalValue

Where:
  cash = Σ user_workspace_cash.balance  (ONLY manual cash — no connected cash)
  totalValue = Σ (qty × price) from user_workspace_portfolio  (ONLY manual positions)

⚠️ portfolio_source_positions is NOT queried.
⚠️ portfolio_source_cash is NOT queried.
⚠️ Connected-account equity is NOT included in snapshots.
```

---

## Connected Account Equity — Source Mapping

| Provider | Account Value | Cash | Buying Power | Equity | Margin | Available |
|----------|-------------:|-----:|------------:|------:|------:|----------:|
| Hyperliquid | `marginSummary.accountValue` (exchangeSync.js:342) → `cashBalance` | Same as accountValue | Not fetched | Not explicit | `marginSummary` has `imfFactor`, `mmr` | Not fetched |
| SnapTrade | `holdings[].market_value` (mapped to `portfolio_source_positions.market_value`) | Not mapped in `mapSnapTradeToSource` | Not fetched | Not explicit | Not fetched | Not fetched |
| Wallet | `balance × price` | `balance` | N/A | N/A | N/A | N/A |
| Lighter | `positions[].value` or similar | Not mapped | Not fetched | Not explicit | Not fetched | Not fetched |

**The authoritative field for connected-account equity in `getUnifiedSummary()` is:**
- `portfolio_source_positions.market_value` (current value of positions)
- `portfolio_source_cash.amount` (cash balance)
- Combined: `totalValue = investedValue + cashValue`

But `cashBalance` from Hyperliquid sync (`marginSummary.accountValue`) is **returned** by the sync function but **NOT written** to `portfolio_source_cash`. It's used for the snapshot `recordUnifiedSnapshot` (line 1521: `Number(summary.cashValue || 0)` — but `cashValue` is computed from `portfolio_source_cash`, not from the sync return value).

---

## Position-Level Equity Audit

### Spot/Holding Positions

```
Market Value = row.market_value || (quantity × current_price)
  (unifiedPortfolio.js:987)

Side: "balance" (long) or "short"
  - netExposure = -marketValue if short, else +marketValue (line 1034)

Currency: position.native_currency
  - Converted via toBase() using FX rates (line 1040)
```

### Derivative Positions (perps, options)

```
portfolioValueRaw = collateralValue + unrealizedPnl  (line 1015)
  - collateralValue = row.collateral_value
  - unrealizedPnl = row.unrealized_pnl
  (NOT: marketValue or notionalValue)

grossExposureRaw = notionalValue || |marketValue|  (line 1016)
netExposureRaw = -grossExposure if short, else +grossExposure (line 1017)

⚠️ These semantics ARE preserved in portfolio_source_positions
⚠️ BUT getUnifiedEquityCurveFromFills does NOT use them (only uses realized_pnl from fills)
```

### Derivative Semantics in Equity Curve

**The equity curve completely loses derivative semantics** because `getUnifiedEquityCurveFromFills` only reads `user_workspace_trade_fills.realized_pnl` (Hyperliquid `closedPnl`). It does not query `portfolio_source_positions` for `unrealized_pnl`, `collateral_value`, or `market_value` at any historical point.

---

## PNL Calculation Audit

### Unrealized PNL

**Current formula (unified summary):**
```
unrealized_pnl = position.unrealized_pnl  (broker-reported, from portfolio_source_positions)
```
- Read in `getUnifiedSummary` → `valueRow` (line 1014): `row.unrealized_pnl`
- Used in `totalValue` calculation (line 1015: `portfolioValueRaw = collateralValue + unrealizedPnl`)
- **NOT used in equity curve** — `getUnifiedEquityCurveFromFills` does not query positions

**Snapshot path:** `unrealizedPnl = portfolioValue - investedCapital - cash` (line 423)
- This is a **residual** calculation, not broker-reported
- `investedCapital` is always 0 in backfilled snapshots (from fill curve)
- So `unrealizedPnl = portfolioValue - 0 - cash` — which includes cash in the "unrealized" bucket

### Realized PNL

**Fill-curve path:**
```
realized (per fill) = Number(raw_payload_json.closedPnl) - Number(fee_amount)
  (unifiedPortfolio.js:1583)

equity(t) = currentEquity - Σ(realized for fills after t)
```

**Snapshot EOD path (assembleSnapshotInputs):**
```
realizedPnl = Σ(CASE WHEN side='sell' THEN notional - fee ELSE -(notional + fee) END)
  FROM user_workspace_trades WHERE date = snapshot_date  (line 262-265)
```
⚠️ This reads from `user_workspace_trades` — the **legacy manual trades** table — NOT from `user_workspace_trade_fills` or `portfolio_source_transactions`. So realized PNL from connected broker fills is **completely absent** from EOD snapshots.

### Total PNL

**No single "Total PNL" calculation exists.** The codebase has:
- `totalValue` (equity) = investedValue + cashValue + manualValue
- `dailyPnl` (in snapshots) = portfolioValue - prevValue (day-over-day delta)
- `realizedPnl` (in snapshots) = from `user_workspace_trades` (legacy)
- `unrealizedPnl` (in snapshots) = portfolioValue - investedCapital - cash (residual)

There is **no** `Total PNL = Realized + Unrealized` field computed for the curve.

### FIFO/LIFO/ Average-Cost

**Not implemented.** The fill-curve path uses `closedPnl` directly from the broker — the broker determines realized PNL per fill. There is no cost-basis tracking, no lot matching, no FIFO/LIFO logic in the unified code.

---

## Return Calculation Audit

### Daily Return

**Fill-curve path (client-side):**
```
dailyReturn = (portfolioValue[i] - portfolioValue[i-1]) / portfolioValue[i-1]
```
PortfolioModule.jsx:718

**Snapshot path (client-side):**
```
dailyReturn = 0  (line 742, then overwritten)
dailyReturn = (portfolioValue[i] - portfolioValue[i-1]) / portfolioValue[i-1]
```
PortfolioModule.jsx:759

**Backend-stored daily return (NOT used by frontend):**
```
daily_return = daily_pnl / previous_day_portfolio_value
```
portfolioSnapshots.js:395

⚠️ The frontend **overwrites** the backend's `daily_return` with its own calculation (line 742 sets it to 0, line 759 recomputes it). This means the TWR implementation in `performanceHistory.js:155` is **bypassed** entirely.

### Total / Cumulative Return

```
percentage mode: (value - baseValue) / baseValue * 100
```
Where `baseValue = snapshotHistory[0].portfolioValue` (first point in range, line 790).

⚠️ No cash-flow adjustment. A deposit that doubles the account shows as +100% return.

### TWR (Time-Weighted Return)

**Implemented but NOT used.** `timeWeightedReturn()` exists in `performanceHistory.js:155` with proper flow adjustment (line 162-169), but it is **not called** by `PortfolioModule.jsx`. The chart uses simple day-over-day returns instead.

### MWR (Money-Weighted Return)

**Implemented but NOT used.** `moneyWeightedReturn()` exists in `performanceHistory.js:181` with Newton's method and bisection fallback, but is **not called** by any component in the current code path.

---

## Cash Flow Treatment

### Deposits / Withdrawals

**Fill-curve path:**
```
deposits: 0, withdrawals: 0  (PortfolioModule.jsx:705)
```

**Snapshot path:**
```
deposits: s.deposits || 0, withdrawals: s.withdrawals || 0  (PortfolioModule.jsx:747-748)
```
But `assembleSnapshotInputs` hardcodes both to 0:
```javascript
const deposits = 0;    // portfolioSnapshots.js:274
const withdrawals = 0;  // portfolioSnapshots.js:275
```
With comment: *"there is no user_workspace_cashflows ledger in the current schema, so net external flow cannot be reconstructed per day."*

### Impact Test

**Scenario 1: $10,000 deposit → $10,000 portfolio value (no trades)**
- Expected: Equity = $10,000, PNL = $0, Return = 0%
- Fill-curve path: No fills → empty curve → falls back to snapshots
- Snapshots: `portfolio_value` = 0 (EOD reads only legacy tables; no manual holdings exist)
- Result: Equity shows $0 (or live overlay of $10,000), curve is empty or shows single point

**Scenario 2: $10,000 deposit → Buy $8,000 assets → $2,000 cash → Portfolio rises to $8,500 → Total = $10,500**
- Expected: Equity = $10,500, Investment gain = $500, Return = +5%
- Fill-curve: If no fills with `closedPnl`, curve is empty → $0 gain shown
- If fills exist: `equity = currentEquity - Σ(future_realizedPnL)` — only shows realized gains, not the $500 unrealized gain
- Return: `(equity - 0) / 0` = NaN or Infinity (if starting from 0)

**Scenario 3: $10,000 deposit → $10,000 → Withdraw $5,000 → $5,000**
- Expected: Equity = $5,000, Return = 0% (no investment gain)
- Actual: Return = ($5,000 - $10,000) / $10,000 = -50% — withdrawal misinterpreted as 50% loss

---

## Time-Series Construction Audit

### Fill-Curve Construction

**Source data:** `user_workspace_trade_fills` (line 1574-1576)
```
SELECT executed_at, fee_amount, raw_payload_json
FROM user_workspace_trade_fills
WHERE workspace_id = ? AND raw_payload_json ? 'closedPnl'
ORDER BY executed_at ASC
```

⚠️ **Critical filter:** `raw_payload_json ? 'closedPnl'` — only Hyperliquid fills have `closedPnl` in `raw_payload_json`. Other brokers' fills (stored in `portfolio_source_transactions`) are **excluded**. SnapTrade, manual, and other source transactions have NO representation in the equity curve.

**Equity reconstruction (line 1583-1594):**
```
realized = closedPnl - fee_amount  (per fill)

after[i] = Σ(realized[j]) for j > i  (backward cumulative)

equity(t) = currentEquity - after[i]
  where currentEquity = getUnifiedSummary().totalValue
```

This is the **backward-subtraction** approach. It starts from the current total value and subtracts all future realized P&L to estimate historical equity. This is fundamentally broken for any portfolio with:
- Unrealized gains/losses (not subtracted — they didn't exist at the historical point)
- Cash flows (not accounted for)
- Open positions that were later closed (the realized P&L already captures the gain, but the starting equity at that point is wrong)
- Multiple positions with correlated/unrelated movements

**Forward-fill (line 1598-1623):**
- One point per UTC day from first fill to today
- Carry-forward equity on days with no fills
- `estimated = TRUE` for carry-forward days
- This creates a continuous curve but with **fabricated dates**

### Snapshot Construction

Snapshots are written by:
1. `recordUnifiedSnapshot` (line 1503) — today's live `totalValue` (one point)
2. `backfillUnifiedSnapshotsFromFills` (line 1673) — fill-curve points (all estimated)
3. `DailySnapshotService.runEod` (portfolioSnapshots.js:476) — reads ONLY legacy manual tables

### Interpolation

`buildEquitySeries` (line 119-124) does **NOT** interpolate — it maps each snapshot to a `[ts, value]` pair as-is. No missing dates are filled. However, the fill-curve backend code creates synthetic daily points via forward-fill (line 1598-1623), so the frontend receives pre-interpolated data from the fill curve.

---

## Historical Snapshot Audit

1. **Does the backend create immutable daily snapshots?** YES — `portfolio_daily_snapshots` with `ON CONFLICT DO NOTHING` (line 455, 1706). Written by `DailySnapshotService.writeDay` and `recordUnifiedSnapshot`.

2. **Fields:** `portfolio_value, cash, invested_capital, daily_pnl, daily_return, realized_pnl, unrealized_pnl, benchmark_value, benchmark_return, benchmark_relative_return, deposits, withdrawals, fees, tax_estimate, dividends, decision_count, journal_count, research_count, prediction_count, estimated, source, is_unified, base_currency, source_breakdown`

3. **Connected accounts included?** **NO (EOD writer)** — `assembleSnapshotInputs` only queries `user_workspace_portfolio` and `user_workspace_cash`. ⚠️ **YES (backfill)** — `backfillUnifiedSnapshotsFromFills` writes fill-curve points as snapshots, but these are all `estimated=TRUE`.

4. **Cash balances included?** **ONLY manual** — `portfolio_source_cash` is NOT queried by `assembleSnapshotInputs`. Backfill uses `summary.cashValue` (line 1682), but this is 0 when no manual cash exists.

5. **Positions included?** **ONLY manual** — `portfolio_source_positions` is NOT queried by `assembleSnapshotInputs`. Backfill writes empty holdings arrays (`JSON.stringify([])`, line 1707).

6. **Total equity stored?** YES — `portfolio_value` column. `recordUnifiedSnapshot` writes `summary.totalValue` (line 1520). `backfillUnifiedSnapshotsFromFills` writes fill-curve equity (line 1707).

7. **PNL stored?** YES — `realized_pnl` (from `user_workspace_trades`, legacy), `unrealized_pnl` (computed as `portfolioValue - investedCapital - cash`, line 423).

8. **External cash flows stored?** YES — columns exist (`deposits`, `withdrawals`), but always **0** (`assembleSnapshotInputs` line 274-275).

9. **Benchmarks stored?** YES — `benchmark_value`, `benchmark_return`, `benchmark_relative_return`. Only populated on EOD snapshots if Yahoo Finance has data. Always `NULL` on backfill snapshots (line 1703-1707 doesn't set them).

10. **Does the Performance Curve consume these?** **ONLY as last resort.** `PortfolioModule.jsx:694` returns early if `fillEquityCurve.length > 1`, bypassing snapshots entirely. Snapshots from `getUnifiedSnapshots` (line 1535) are only available when `is_unified=TRUE`, which is set by `recordUnifiedSnapshot` (today only) and `backfillUnifiedSnapshotsFromFills` (fill-curve dates).

**EXISTING SOURCE OF TRUTH NOT USED AS PRIMARY.** The `portfolio_daily_snapshots` table has the right schema but is populated incorrectly:
- EOD snapshots: zero for connected accounts (wrong source tables)
- Backfill snapshots: all estimated=TRUE with zero invested_capital (fill-curve derived)

---

## Connected Account Sync Audit

### Hyperliquid (primary connected account)

**Sync function:** `syncHyperliquid()` in `exchangeSync.js:237`

**Returns:**
```
{ holdings, trades, tradeFills, cashBalance, currency: "USDC", syncContext }
```

**Data mapping:**
| API field | ExchangeSync line | Normalized to | Stored in table |
|-----------|------------------|---------------|-----------------|
| `state.positions[]` | exchangeSync.js:290-318 | `holdings[]` with `market_value`, `unrealizedPnl` | `portfolio_source_positions` (via recordSourceSync) |
| `fills[]` with `closedPnl` | exchangeSync.js:315-339 | `tradeFills[]` with `realizedPnl`, `rawPayload.closedPnl` | `user_workspace_trade_fills` (via tradeFills.sync) |
| `state.marginSummary.accountValue` | exchangeSync.js:342 | `cashBalance` (return value) | **NOT STORED** — only returned to caller |
| `state.marginSummary` fields | exchangeSync.js | Available in `rawPayload` | `user_workspace_trade_fills.raw_payload_json` |

**Historical data import:**
- **Fills**: YES — all past fills are stored immutably in `user_workspace_trade_fills` (line 1672: `UNIQUE(user_id, platform, platform_fill_id)`)
- **Positions**: NO — only current state is stored (upsert at line 720)
- **Cash/Equity**: NO — `cashBalance` is returned but NOT persisted to `portfolio_source_cash`

### Sync type:
- Initial: On connect
- Periodic: Triggered by `POST /api/portfolio/sync` → `runWorkspaceSync`
- Historical: Fills are imported; positions/cash are point-in-time only

---

## Imported Trades / Fills Audit

### `user_workspace_trade_fills` schema (database.js:1649-1673)

```
id, user_id, workspace_id, trade_client_id, platform, platform_trade_id,
platform_fill_id, symbol, side, market_type, quantity, price, notional,
fee_amount, fee_currency, fee_source, liquidity_role, executed_at,
reference_price, realized_pnl, raw_payload_json, created_at, updated_at
```

### Key findings:

1. **No `account_equity_after` column** — the table does NOT store per-fill equity. The `realized_pnl` column (added at line 1678) stores per-fill realized P&L from `closedPnl`.

2. **`realized_pnl` is populated** from Hyperliquid's `closedPnl` (exchangeSync.js:329, database.js:6044-6052). The mapping looks through multiple possible field paths: `fill.realizedPnl`, `fill.rawPayload.closedPnl`, `fill.raw_payload_json.closedPnl`, etc.

3. **`raw_payload_json`** stores the full raw fill object — `getUnifiedEquityCurveFromFills` reads `raw_payload_json -> 'closedPnl'` (line 1576).

4. **⚠️ `raw_payload_json ? 'closedPnl'` filter (line 1576)** — only fills where `closedPnl` key exists in `raw_payload_json` are included. Opening trades with no realized P&L are **excluded**. This means the curve has **no data points for opening trades** — it only appears when a fill closes part of a position.

5. **⚠️ Source-table mismatch** — the equity curve reads from `user_workspace_trade_fills`, but `recordSourceSync` stores transaction data to `portfolio_source_transactions` (which also has a `realized_pnl` column, line 762). These two tables are **not joined** in the equity curve query. If fills are stored in `portfolio_source_transactions` but not `user_workspace_trade_fills`, they are invisible to the curve.

### Impact Statement

**Historical connected-account trades CAN reconstruct the equity curve, but only partially and incorrectly:**
- The curve only has data points at **closing fills** (where `closedPnl` is non-null)
- It backward-subtracts from current equity, which is wrong when there are unrealized gains
- Open positions that are never closed never appear as equity points
- Non-Hyperliquid fills (SnapTrade, manual) are **completely absent**

---

## Unified Portfolio Layer Audit

### What the Performance Curve consumes

1. **`unifiedPortfolio.fillEquityCurve`** (array of `{ t, equity, benchmark, estimated }`)
   - Source: `GET /api/portfolio/unified/equity-curve` → `getUnifiedEquityCurveFromFills`
   - ⚠️ This is a **fill-reconstructed** curve, not authoritative

2. **`unifiedPortfolio.snapshots`** (array of unified snapshots)
   - Source: `GET /api/portfolio/unified/snapshots` → `getUnifiedSnapshots`
   - Only used as **fallback** when `fillEquityCurve` is empty (line 729)

3. **`unifiedPortfolio.totalValue`** (live headline number)
   - Source: `GET /api/portfolio/unified/summary` → `getUnifiedSummary`
   - Used as `currentAccountEquity` for live overlay (line 682, 804)

### Information loss

| Layer | Has unrealized_pnl | Has cash | Has market_value | Has account_value | Has historical equity |
|-------|-------------------|----------|-----------------|-------------------|---------------------|
| Broker API | Yes (Hyperliquid) | Yes | Yes | Yes (accountValue) | No |
| Source Layer (portfolio_source_*) | Yes (positions) | Yes (cash table) | Yes (positions) | No | No |
| Unified Summary (getUnifiedSummary) | Yes (line 1014) | Yes (line 940-1144) | Yes (line 987) | No | No |
| Fill Curve (getUnifiedEquityCurveFromFills) | NO | NO | NO | NO (uses totalValue as single anchor) | Yes (reconstructed) |
| Daily Snapshots | Partial (EOD: computed) | Partial (EOD: 0 for connected) | Partial (EOD: 0 for connected) | No | Yes (if populated correctly) |
| EOD assembleSnapshotInputs | No (reads legacy tables only) | No (reads legacy only) | No (reads legacy only) | No | No |

### The loss chain

```
Broker (has all) 
  → recordSourceSync (stores all to portfolio_source_*) 
  → getUnifiedSummary (reads portfolio_source_* correctly for LIVE headline) 
  → [BROKEN BRIDGE] 
  → getUnifiedEquityCurveFromFills (reads ONLY user_workspace_trade_fills.realized_pnl, ignores portfolio_source_*)
  → backfillUnifiedSnapshotsFromFills (writes fill-curve to snapshots)
  → Frontend (prefers fillEquityCurve, fallback to snapshots)
```

---

## Multi-Account Aggregation Audit

### How multiple accounts are aggregated

**`getUnifiedSummary()`** correctly sums across ALL sources:
```
totalValue = investedValue + cashValue + manualValue
```
- `investedValue` sums `portfolio_source_positions.market_value` from ALL sources (line 1113)
- `cashValue` sums `portfolio_source_cash.amount` from ALL sources (line 1142)
- `manualValue` from `user_workspace_portfolio` only when no connected sources (line 1157-1166)

**`getUnifiedEquityCurveFromFills()`** queries `user_workspace_trade_fills WHERE workspace_id = ?` — aggregates across all accounts within a workspace, BUT:
- Only uses `realized_pnl` (not account equity or market value)
- Only includes fills with `closedPnl` in `raw_payload_json`

### Edge cases

| Scenario | Behavior | Risk Level |
|----------|----------|------------|
| Different currencies | `toBase()` converts using FX rates; USD/USDC/USDT treated 1:1 | Medium — FX not applied to fill-curve |
| Same asset across accounts | `sourceMap` dedupes by provider+source_type; positions summed | Low — no double-count in headline |
| Missing historical data | Fill-curve backward-subtracts from current; EOD zeros for connected | P0 — connected accounts get zero snapshots |
| Account inception dates | All fills accumulated from single zero baseline | P1 — early fills inflate/deflate curve |

---

## Currency Conversion Audit

### Base currency
`getWorkspaceBaseCurrency()` — returns workspace-configured base (default USD).

### Conversion path

1. **Same-currency equivalents**: USD, USDC, USDT, BUSD, DAI, etc. (`USD_EQUIVALENTS` from `stablecoins.js`) → 1:1
2. **Other currencies**: `getFxRate()` from `portfolio_fx_rates` table
3. **`toBase(rawValue, currency)`**: Returns `{value: null, unvalued: true}` if FX rate is missing → position excluded from `totalValue` with a warning (line 975-978)

### Fill-curve currency handling

**No FX conversion at all.** `getUnifiedEquityCurveFromFills` operates in whatever currency `summary.totalValue` returns (already in base currency via `getUnifiedSummary`). The `realized_pnl` from `raw_payload_json.closedPnl` is in the position's settlement currency but is treated as base currency without conversion.

### Snapshot currency handling

`assembleSnapshotInputs` does NO FX conversion — `portfolioValue = cash + totalValue` where both are raw values from `user_workspace_cash.balance` and `user_workspace_portfolio.price * quantity`. No FX rates are loaded.

### FX impact classification

FX movements are **not** separated from investment PNL. For a non-USD position, changes in FX rate between the position currency and base currency are mixed into `market_value` changes without attribution.

---

## Benchmark Audit

### Data source
Yahoo Finance via `loadYahooSeries()` (line 101-134) — real daily close data, cached 1 hour.

### Symbols
- Default: `'SPY'` (line 401)
- Crypto: `BTC-USD`, `ETH-USD` (mapped via `CRYPTO_BENCHMARKS`, line 95)
- User-selectable: `benchmarkSymbol` passed through opts (line 1570, 1639)

### Historical range
2 years (`period1 = now - 2 years`, line 107)

### Sampling frequency
Daily (`interval=1d`, line 109)

### Corporate actions
Handled by Yahoo Finance (splits, dividends reflected in close prices)

### Benchmark on Performance Curve

**Fill-curve path:** `benchmark` field is populated per-point from Yahoo (`unifiedPortfolio.js:1637-1656`). BUT — the frontend maps this to `benchmarkValue` (line 706), and `buildBenchmarkSeries` in `performanceHistory.js:134` only includes points where `benchmarkValue != null`. Since the fill-curve only has points at closing-fill dates, benchmark data is **sparse**.

**Snapshot path:** `benchmarkValue: null` (hardcoded, line 745). Backend snapshots from `recordUnifiedSnapshot` do NOT set benchmark values (line 1512-1529 — no benchmark columns in INSERT). Only `DailySnapshotService.writeDay` sets them (line 424-426), and that only runs for legacy tables.

### Benchmark integrity
✅ **Real data** — not fabricated. `getBenchmarkClose` returns `null` when unavailable; the caller leaves fields NULL. No synthetic drift values are generated (`portfolioSnapshots.js:406-412`).

⚠️ **BUT** — the backend comment at line 23-27 of `portfolioSnapshots.js` states: *"this is intended to be real historical benchmark data. If Yahoo Finance is down, fields are left NULL (never fabricated)."*

---

## Date Range Audit

### Frontend date ranges
`resolveRange()` in `performanceHistory.js:42` maps intervals to `{ start, end }` ISO date strings:
- 1D → 1 day, 1W → 7 days, 1M → 31 days, 3M → 93 days, 6M → 186 days
- YTD → Jan 1 to today, 1Y → 366 days, 3Y → 1096, 5Y → 1827
- ALL → start=null (floor "2000-01-01")

### Range application

**Fill-curve preference path (PortfolioModule.jsx:694-724):**
- The `useUnifiedPortfolio` hook fetches the fill curve for the **last 180 days** (`fetchUnifiedEquityCurve` line 32: `limit: "365"`)
- Frontend filters by `r.date >= start && r.date <= end` (line 714) — only filters existing fill timestamps
- **No resampling** for the selected range — data outside the range is hidden, and there's no interpolation within the range

**Snapshot fallback path (PortfolioModule.jsx:729-765):**
- `getUnifiedSnapshots` returns last 30-90 snapshots (line 1535: `LIMIT 30`)
- `getUnifiedSummary` returns last 400 (line 1228: `getUnifiedSnapshots(pool, workspaceId, 400)`)
- Frontend filters by date range (line 755)

### Baseline reset

`historyBaseValue` (line 789): `snapshotHistory[0].portfolioValue` — the first point **after** range filtering.

✅ This means changing the date range correctly resets the baseline for percentage/PnL modes. The `baseValue` is always relative to the selected range's first point.

### Return recalculation on range change

Daily returns are **recomputed** client-side on each range change (line 719, 759). Since returns are `(today - yesterday) / yesterday`, they are range-dependent. Cumulative return is also range-relative via `baseValue`.

⚠️ But since the fill-curve backward-subtracts from **current** equity, changing the range doesn't change the underlying equity values — it just shows a subset. The return percentages will be inconsistent because the baseline is always the first point in the range, regardless of what happened before.

---

## Portfolio Inception Audit

### Current inception detection

1. **`historyBaseValue`** (PortfolioModule.jsx:789): `snapshotHistory[0].portfolioValue` (first fill-curve point or first snapshot)
2. **EOD job start** (`portfolioSnapshots.js:480`): `start = latest ? addDays(latest.date, 1) : (opts.from || addDays(through, -30))` — defaults to 30 days back
3. **Fill-curve start** (`unifiedPortfolio.js:1604`): `startDay = floor(allPts[0].t / DAY)` — earliest fill timestamp

### Initial balance

- **EOD `writeDay`** (line 392): `prevValue = prev ? prev.portfolioValue : (opts.initialBalance ?? 10000)` — defaults to $10,000
- **Fill-curve backfill**: No initial balance — starts from `currentEquity - Σ(future_realizedPnL)`, which for the earliest fill is `currentEquity - Σ(all_future_realizedPnL)`. This can be positive, negative, or zero depending on the net realized PNL.
- **`assembleSnapshotInputs`**: `portfolioValue = cash + totalValue` — no initial balance concept

### Different inception dates across accounts

Not handled — all fills are accumulated from a single zero baseline per workspace. The backward-subtraction approach implicitly assumes a single inception date.

---

## Missing Data Audit

| Scenario | Behavior | Evidence |
|----------|----------|----------|
| No trades/fills | `fillEquityCurve` empty → falls back to snapshots → may be empty → `historyStatus = "empty"` | PortfolioModule.jsx:694, 722, 763-764 |
| No snapshots | Uses live equity only for overlay; series = [] → chart shows nothing or just live point | PortfolioModule.jsx:729 |
| No connected fills | `getUnifiedEquityCurveFromFills` returns `[]` (line 1586) → falls back to snapshots | unifiedPortfolio.js:1586 |
| Position exists but no price | `valueRow()` returns `null` (line 1005), position excluded, warning pushed | unifiedPortfolio.js:1003-1006 |
| Price exists but no account equity | N/A — equity is computed from positions | N/A |
| Account synced but no fills with closedPnl | Curve empty → fallback to snapshots (which may also be empty/zero for connected) | unifiedPortfolio.js:1576 |
| Weekend/holiday (fill curve) | Forward-fill from last fill (line 1598-1623), `estimated=TRUE` | unifiedPortfolio.js:1619-1621 |
| Weekend/holiday (EOD) | Carry-forward from previous market day, `estimated=TRUE` | portfolioSnapshots.js:491-514 |
| Broker API outage | `recordSourceSync` catches error, marks source `error`, keeps prior data | unifiedPortfolio.js:758-783 |
| Missing snapshot date | No interpolation — calendar gaps in the curve | portfolioSnapshots.js:554 (simple date range query) |

### Zero substitution

**Critical zero-substitution patterns:**

1. `getUnifiedEquityCurveFromFills` line 1583: `Number(r.fee_amount) || 0` — NULL fee → 0
2. `getUnifiedEquityCurveFromFills` line 1583: `Number(r.raw_payload_json?.closedPnl) || 0` — NULL closedPnl → 0 (but filtered out by line 1576 `? 'closedPnl'`)
3. `backfillUnifiedSnapshotsFromFills` line 1692: `equity: Number(pt.equity) || 0` — NULL → 0
4. `recordUnifiedSnapshot` line 1520-1522: `Number(summary.totalValue || 0)`, `Number(summary.cashValue || 0)`, `Number(summary.investedValue || 0)` — NULL → 0
5. `PortfolioModule.jsx:633`: `currentAccountEquity >= initialBalance` — if equity is null/0, treated as not profitable

**The fill-curve filter** (line 1576: `raw_payload_json ? 'closedPnl'`) means fills WITHOUT `closedPnl` are **excluded** (not zeroed). This is correct for opening trades but means the curve has no data before the first closing trade.

---

## NULL / ZERO / MISSING Semantics Audit

### Critical `value || 0` patterns

| Location | Pattern | Impact |
|----------|---------|--------|
| `unifiedPortfolio.js:88` | `COALESCE(SUM(...), 0)` | Deposits/withdrawals default to 0 (already always 0) |
| `unifiedPortfolio.js:1572` | `Number(summary.totalValue) \|\| 0` | If summary fails, currentEquity = 0 → entire curve is 0 |
| `unifiedPortfolio.js:1583` | `Number(r.fee_amount) \|\| 0` | NULL fee → 0 (correct) |
| `unifiedPortfolio.js:1594` | `currentEquity - after[i]` | If currentEquity=0, all historical equity = -Σ(realizedPnL) |
| `unifiedPortfolio.js:1682` | `Number(summary?.cashValue \|\| 0)` | Backfill snapshots get cash=0 if summary fails |
| `unifiedPortfolio.js:1692` | `Number(pt.equity) \|\| 0` | NULL equity → 0 in backfill |
| `unifiedPortfolio.js:1520-1522` | `Number(summary.totalValue \|\| 0)` etc. | NULL live values → 0 in today's snapshot |
| `portfolioSnapshots.js:85` | `toNum(v, fallback=0)` | NULL → 0 for all snapshot fields |
| `PortfolioModule.jsx:697` | `Number.isFinite(p.equity)` | Filters out null/undefined but NOT zero |
| `PortfolioModule.jsx:742` | `dailyReturn: 0` | Snapshots path zeroes dailyReturn before recomputing |
| `portfolioService.js:38` | `Number(p.equity)` | Converts string equity, NaN if not parseable |

**Most dangerous:** `unifiedPortfolio.js:1572` — `const currentEquity = Number(summary.totalValue) || 0`. If the unified summary fails (e.g., `isEnabled()` returns false, or query error), `currentEquity = 0`, and the entire fill-curve becomes `0 - Σ(realizedPnL) = -Σ(realizedPnL)`. This would show all historical equity as **negative** of cumulative realized P&L.

---

## API Audit

### `GET /api/portfolio/unified/equity-curve` (backend/index.js:13733)

```
Frontend: useUnifiedPortfolio → fetchUnifiedEquityCurve (portfolioService.js:31)
  → zeninFetchJson(`/portfolio/unified/equity-curve?limit=365&from=...&to=...&benchmark=...`)
  → Backend: getUnifiedEquityCurveFromFills(pool, workspaceId, limit, { from, to, benchmark })
  → Returns: { curve: [{ t, equity, benchmark, estimated, live? }] }

Response schema:
  data.curve = [{
    t: Number (epoch ms),
    equity: Number (currentEquity - Σ(future_realizedPnL)),
    benchmark: Number | null (Yahoo close),
    estimated: Boolean (TRUE for forward-filled days),
    live: Boolean (for today's overlay point)
  }]
```

### `GET /api/portfolio/unified/snapshots` (backend/index.js:13719)

```
Frontend: useUnifiedPortfolio → fetchUnifiedSnapshots
  → zeninFetchJson(`/portfolio/unified/snapshots?limit=90`)
  → Backend: getUnifiedSnapshots(pool, workspaceId, limit)
  → Query: SELECT ... FROM portfolio_daily_snapshots WHERE is_unified=TRUE ORDER BY DESC LIMIT ?
  → Returns: { snapshots: [{ id, snapshotDate, portfolioValue, cash, investedCapital,
      deposits, withdrawals, dailyPnl, baseCurrency, sourceBreakdown,
      snapshotCreatedAt, estimated }] }
```

### `GET /api/portfolio/unified/summary` (backend/index.js:13481)

```
Frontend: useUnifiedPortfolio → fetchUnifiedSummary
  → Backend: getUnifiedSummary(pool, workspaceId)
  → Returns: { totalValue, cashValue, investedValue, ..., positions, sources,
      snapshots (last 400), snapshotTimeline: null }
```

### Three-tier preference (PortfolioModule.jsx:694-785):

1. **Tier 1 (active):** `unifiedPortfolio.fillEquityCurve` — if `isUnified && fillEquityCurve.length > 1`
   - Data source: `/api/portfolio/unified/equity-curve`
   - Transforms: maps `{ t, equity }` → `{ date, ts, portfolioValue: equity, cash:0, investedCapital:0, dailyPnl:0, dailyReturn:0, benchmarkValue, deposits:0, withdrawals:0, estimated, source:"fill_curve" }`
   - Computes `dailyReturn` client-side per point

2. **Tier 2 (fallback):** `unifiedPortfolio.snapshots` — if `snapshots.length > 0`
   - Data source: `/api/portfolio/unified/snapshots` (only `is_unified=TRUE` snapshots)
   - Transforms: maps `{ snapshotDate, portfolioValue, cash, investedCapital, deposits, withdrawals, dailyPnl, estimated }` → normalized format
   - Sets `benchmarkValue: null` (hardcoded)

3. **Tier 3 (legacy):** `fetchPerformanceHistory()` — if `!isUnified`
   - Data source: `/api/portfolio/history` → reads `portfolio_daily_snapshots` (ALL, not just unified)
   - Internally calls `/api/portfolio/unified/equity-curve` (same as Tier 1 via `performanceHistory.js:72`)

⚠️ **Tier 3 actually calls the same endpoint as Tier 1** — the distinction is that Tier 1 reads from the `useUnifiedPortfolio` hook's cache, while Tier 3 calls `fetchPerformanceHistory` which calls the same API endpoint but normalizes differently (line 80: `portfolioValue: equity`).

---

## Frontend vs Backend Calculation Consistency

### Inconsistencies:

| Metric | Backend Store | Frontend Display | Match? |
|--------|--------------|------------------|--------|
| Daily return | `portfolio_daily_snapshots.daily_return` (`pnl/prevValue`) | `(today - yesterday) / yesterday` | ⚠️ **NO** — frontend overwrites backend's `daily_return` with 0 (line 742), then recomputes (line 759/719) with a **different formula** |
| Equity | `portfolio_daily_snapshots.portfolio_value` (EOD: live; backfill: fill-curve) | `snapshotHistory[].portfolioValue` (mapped from same field) | ✅ Yes, but source data is wrong (EOD zeros, backfill fills) |
| PNL | Not directly stored on curve | `chartMode === "pnl"` → `portfolioValue - baseValue` | ⚠️ **MISLABELED** — this is total equity delta, not PNL |
| Benchmark | `benchmark_value` stored on EOD snapshots | `null` on snapshot path; Yahoo close on fill-curve path | ⚠️ **INCONSISTENT** — snapshots always null, fill-curve uses Yahoo |
| Total return | Not stored | `(value - baseValue) / baseValue * 100` | ⚠️ Not cash-flow-adjusted |

### Duplicate calculations

1. **Return calculation** — Backend stores `daily_return` in snapshots; frontend recomputes it client-side (line 759, 719), discarding the backend value (line 742 sets it to 0).
2. **Equity** — Backend writes `portfolio_value` to snapshots; frontend re-reads and re-normalizes it into `portfolioValue` (line 736, 701).
3. **Benchmark** — Backend fetches Yahoo close in `getUnifiedEquityCurveFromFills` (line 1637-1656); frontend also has `buildBenchmarkSeries` (line 134) that re-bases it for display.

**Authoritative layer for the Performance Curve: backend** (both equity value and benchmark close are computed server-side). **But the frontend recalculates daily returns independently.**

---

## Performance Curve Display Audit

### Chart configuration

```javascript
// PortfolioModule.jsx — chart data construction
const chartData = useMemo(() => {
  const series = buildEquitySeries(snapshotHistory, chartMode, { baseValue: historyBaseValue });
  // Live overlay appended...
  return series;
}, [...]);

// buildEquitySeries (performanceHistory.js:114)
function buildEquitySeries(snapshots, mode, { baseValue }) {
  return snapshots.map((s) => {
    let value;
    if (mode === "percentage") value = base ? ((s.portfolioValue - base) / base) * 100 : 0;
    else if (mode === "pnl") value = s.portfolioValue - base;
    else value = s.portfolioValue;
    return [s.ts, Number(Number(value).toFixed(2))];
  });
});
```

### Axes
- X-axis: timestamp (UTC)
- Y-axis: depends on `chartMode`:
  - `"equity"`: absolute value (USD)
  - `"pnl"`: value minus baseline (USD)
  - `"percentage"`: `(value - baseline) / baseline * 100`

### Headline metrics

The headline metrics on the Performance Curve (PNL, Return %, etc.) are computed from `snapshotHistory` (the same data source as the chart). `historyBaseValue` (line 789) is used as the baseline. The headline and chart **do use the same dataset**.

### Baseline

`historyBaseValue = snapshotHistory[0].portfolioValue` (first point in selected range) or `currentAccountEquity` (live, if history empty).

⚠️ On the fill-curve path, the first point's `portfolioValue` is `currentEquity - Σ(all_future_realizedPnL)` — meaning the baseline includes subtracting ALL future realized PNL up to the present. This creates a **look-ahead bias**: the baseline depends on trades that haven't happened yet.

---

## Tooltip Audit

The tooltip reads from the same `snapshotHistory` data that the chart uses. Each point's `{ date, portfolioValue, dailyPnl, dailyReturn }` are all derived from the same source. There is **no discrepancy** between chart and tooltip data — both are wrong in the same way (using fill-reconstructed equity instead of true equity).

---

## Known Risk Areas — Final Assessment

### Risk 1: Performance Curve uses `account_equity_after` instead of snapshots

**STATUS: NOT CONFIRMED** — The current code does NOT use `account_equity_after`. The `buildTradeTimeline` function in `accountMetrics.js:43` references `accountEquityAfter`, but it is only used by `calculateAccountSnapshot` (legacy), not by the unified Performance Curve path. The curve uses `getUnifiedEquityCurveFromFills` which reconstructs from `realized_pnl`.

### Risk 2: Imported broker fills have `account_equity_after = NULL`

**STATUS: NOT APPLICABLE** — The `user_workspace_trade_fills` table does not have an `account_equity_after` column. It has `realized_pnl` (populated from Hyperliquid's `closedPnl`). The risk's premise is about a column that doesn't exist in the current schema. However, the underlying problem — that fills lack full equity context — IS present: fills only carry `realized_pnl` (per-fill realized), not account-level equity levels.

### Risk 3: Performance Curve uses live equity + historical trades + synthetic interpolation

**STATUS: CONFIRMED** — The curve is built from:
1. `currentEquity` (live `getUnifiedSummary().totalValue`)
2. Historical fill `realized_pnl` (backward-subtracted from current)
3. Forward-fill for dates with no fills (line 1598-1623)

The forward-fill IS synthetic interpolation — carry-forward days are marked `estimated=TRUE` but still rendered as real curve points.

### Risk 4: Backend contains `portfolio_daily_snapshots` but frontend doesn't consume them

**STATUS: PARTIALLY CONFIRMED** — The frontend **does** consume snapshots via `unifiedPortfolio.snapshots` (line 729), but only as a **fallback** when `fillEquityCurve` is empty. For active connected accounts, `fillEquityCurve` is populated (unless no fills have `closedPnl`), so snapshots are **bypassed**.

Additionally, the snapshots fetched by `getUnifiedSnapshots` are filtered to `is_unified=TRUE` only (line 1541) — which excludes EOD snapshots written by the legacy `DailySnapshotService.runEod` (those have `is_unified=FALSE`).

### Risk 5: Unified portfolio aggregation collapses derivative semantics

**STATUS: NOT CONFIRMED** — The unified read model (`getUnifiedSummary` → `valueRow`) explicitly preserves derivative semantics: `portfolio_source_positions` stores `notional_value`, `collateral_value`, `leverage`, `liquidation_price`, `unrealized_pnl` separately, and `valueRow()` computes `portfolioValueRaw = collateralValue + unrealizedPnl` for derivatives (line 1015). The `is_unified` flag and `source_breakdown` are also persisted.

HOWEVER — `getUnifiedEquityCurveFromFills` completely ignores these semantics. It only uses `realized_pnl` from fills. So while the **stored data** preserves semantics, the **equity curve does not use them**.

### Risk 6: Cash contributions/withdrawals treated as investment performance

**STATUS: CONFIRMED** — Both fill-curve and snapshot paths hardcode `deposits=0, withdrawals=0` (PortfolioModule.jsx:705, 747-748). There is no cashflows ledger in the schema. The daily return formula `(today - yesterday) / yesterday` has no flow adjustment, meaning deposits appear as gains and withdrawals as losses.

The TWR implementation in `performanceHistory.js:155` does account for flows (line 162: `const flow = (s.deposits || 0) - (s.withdrawals || 0)`), but it is **not called** by the chart.

### Risk 7: Frontend and backend calculate performance independently

**STATUS: CONFIRMED** — Backend stores `daily_return` in `portfolio_daily_snapshots` (portfolioSnapshots.js:395: `dailyPnl / prevValue`), but the frontend **overwrites** this with `0` (PortfolioModule.jsx:742) and recomputes it client-side (line 759). The frontend's TWR/MWR implementations (`performanceHistory.js:155, 181`) are **never called** by the Performance Curve.

---

## Root Cause Analysis

### ROOT CAUSE #1
**Source:** `backend/unifiedPortfolio.js:1569` (`getUnifiedEquityCurveFromFills`)
**Problem:** The equity curve is reconstructed by backward-subtracting cumulative `realized_pnl` from the **current live equity** (`getUnifiedSummary().totalValue`). This approach is mathematically invalid when:
- There are open positions with unrealized gains/losses (not accounted for at historical points)
- There are cash flows (deposits/withdrawals) between historical and current dates
- Current equity includes value changes unrelated to closed trades

The formula `equity(t) = currentEquity(t_now) - Σ(realizedPnL from t to t_now)` assumes `currentEquity = historicalEquity + Σ(realizedPnL)`, which is only true if there are no unrealized PNL, no cash flows, and no market value changes — never true in practice.

**Evidence:**
- Line 1572: `const currentEquity = Number(summary.totalValue) || 0`
- Line 1588-1594: `after[i] = Σ(fills[j].realized) for j > i`; `equity = currentEquity - after[i]`
- `summary.totalValue` (line 1196) includes `investedValue + cashValue + manualValue` — the current live total, not a historical reconstruction

**Impact:** Equity curve shows incorrect values whenever the portfolio has open positions, unrealized gains, or cash flows. For a portfolio with $10K in open unrealized gains, every historical point will be inflated by $10K.

**Severity:** P0 — Financially Incorrect

**Recommended fix:** Replace fill-curve reconstruction with daily snapshots from `portfolio_daily_snapshots`. The EOD snapshot writer must read from the unified `portfolio_source_*` tables, not legacy tables. Each snapshot's `portfolio_value` should be the true equity at that date (cash + position market values at that date's prices).

### ROOT CAUSE #2
**Source:** `backend/portfolioSnapshots.js:168` (`assembleSnapshotInputs`)
**Problem:** The EOD and backfill snapshot writers only query `user_workspace_portfolio` and `user_workspace_cash` (legacy manual tables), completely ignoring the connected-account `portfolio_source_positions` and `portfolio_source_cash` tables. This means:
- Daily snapshots for connected-account workspaces have `portfolio_value ≈ 0` (no manual holdings)
- `cash`, `invested_capital`, `realized_pnl` are all derived from legacy tables only
- The rich schema of `portfolio_daily_snapshots` (20+ fields) is wasted — only legacy data populates it

**Evidence:**
- Line 172-176: Queries `user_workspace_portfolio` (manual holdings only)
- Line 188-192: Queries `user_workspace_cash` (manual cash only)
- Line 204-228: Queries `brokerage_holdings` (SnapTrade legacy, not unified)
- NO query to `portfolio_source_positions` or `portfolio_source_cash`
- Line 260-268: `realizedPnl` from `user_workspace_trades` (legacy manual trades, not connected fills)

**Impact:** Immutable daily snapshots are zero for connected-account-only workspaces. The snapshot infrastructure exists but is functionally useless for the primary use case (connected accounts).

**Severity:** P0 — Financially Incorrect

**Recommended fix:** Modify `assembleSnapshotInputs` to query `portfolio_source_positions` and `portfolio_source_cash` (via `getUnifiedSummary`'s query pattern) for the snapshot date. Implement historical position reconstruction (price at date × quantity at date) using Yahoo Finance or stored historical prices.

### ROOT CAUSE #3
**Source:** `frontend/src/components/PortfolioModule.jsx:694`
**Problem:** The frontend's preference order uses `fillEquityCurve` (Tier 1) when it has >1 point, completely bypassing `portfolio_daily_snapshots` (Tier 2). Even if snapshots were correctly populated (fix #2), they would never be used for active connected accounts.

**Evidence:**
- Line 694: `if (unifiedPortfolio?.isUnified && Array.isArray(unifiedPortfolio.fillEquityCurve) && unifiedPortfolio.fillEquityCurve.length > 1) { ... setSnapshotHistory(rows); return; }`
- Line 729: Snapshots branch only reached when fill-curve is empty
- Line 785: Dependency array includes `unifiedPortfolio?.fillEquityCurve`

**Impact:** Even if the backend is fixed to populate correct snapshots, the frontend will still use the wrong fill-curve data.

**Severity:** P0 — Financially Incorrect

**Recommended fix:** Reverse the preference order: always use `portfolio_daily_snapshots` when available and non-empty. Use `fillEquityCurve` only as a transient data point when snapshots don't cover the requested range. Append today's live equity as an overlay, never overwrite the last snapshot.

### ROOT CAUSE #4
**Source:** `backend/portfolioSnapshots.js:274-275`
**Problem:** `assembleSnapshotInputs` hardcodes `deposits = 0` and `withdrawals = 0` with the comment: *"there is no user_workspace_cashflows ledger in the current schema"*. There is indeed no cash-flows table; deposits/withdrawals are inferred from cash balance changes between snapshots, but never recorded as discrete flows.

**Evidence:**
- Line 270-275: `const deposits = 0; const withdrawals = 0;`
- `portfolio_source_transactions` table (line 108) has no `type` values for deposits/withdrawals (only `type TEXT NOT NULL DEFAULT 'other'`)
- No `user_workspace_cashflows` table exists

**Impact:** Daily return = `(end_value - start_value) / start_value` — when a $10K deposit doubles the account, return shows +100% instead of ~0%.

**Severity:** P0 — Financially Incorrect

**Recommended fix:** Create a `portfolio_cash_flows` table to log deposits, withdrawals, transfers, and dividends with timestamps. Modify `assembleSnapshotInputs` to query cash flows for the snapshot date. Ensure TWR/MWR calculations use these flows.

### ROOT CAUSE #5
**Source:** `backend/exchangeSync.js:342` + `backend/unifiedPortfolio.js:746-752`
**Problem:** `syncHyperliquid` returns `cashBalance = state?.marginSummary?.accountValue` as part of the sync result, but `recordSourceSync` only writes the `source.cash` array to `portfolio_source_cash` (line 746). The `cashBalance` returned by Hyperliquid is **not included** in `source.cash` — it's returned as a top-level property of the sync result and used by... actually, it's only used in the `runWorkspaceSync` return value (line 1773: `summary`), not written to any table.

**Evidence:**
- `syncHyperliquid` line 342: `const cashBalance = toNumber(state?.marginSummary?.accountValue);`
- `syncHyperliquid` line 344: `return { holdings, trades, tradeFills, cashBalance, currency: "USDC" }`
- `recordSourceSync` line 746-752: Only iterates `source.cash || []` — never accesses `source.cashBalance`
- No code path writes `cashBalance` to `portfolio_source_cash`

**Impact:** The account's cash balance (including collateral) is lost. `getUnifiedSummary` reads `portfolio_source_cash` (which was never written with the broker's cash), so `cashValue = 0`. The live headline understates total equity.

**Severity:** P1 — Major

**Recommended fix:** Modify `recordSourceSync` to write `cashBalance` to `portfolio_source_cash` when `source.cash` is empty or when `source.cashBalance` is provided. Alternatively, have `syncHyperliquid` include the cash balance in the `source.cash` array: `cash: [{ currency: "USDC", amount: cashBalance }]`.

---

## Secondary Root Causes

### ROOT CAUSE #6: Fill-curve is Hyperliquid-only

`getUnifiedEquityCurveFromFills` (line 1574-1576) queries:
```sql
SELECT executed_at, fee_amount, raw_payload_json
FROM user_workspace_trade_fills
WHERE workspace_id=$1 AND raw_payload_json ? 'closedPnl'
```
The `raw_payload_json ? 'closedPnl'` filter excludes ALL non-Hyperliquid fills (which store realized PNL as a top-level column, not in `raw_payload_json`). SnapTrade, manual, and other source transactions stored in `portfolio_source_transactions` are **completely invisible** to the equity curve.

### ROOT CAUSE #7: Unrealized PNL excluded from equity curve

`getUnifiedEquityCurveFromFills` only reads `realized_pnl` from fills. It never queries `portfolio_source_positions` for `unrealized_pnl` or `market_value`. The curve shows cumulative realized P&L backward-subtracted from current equity — never true portfolio equity with unrealized gains.

### ROOT CAUSE #8: TWR/MWR implementations exist but are unused

`timeWeightedReturn()` (performanceHistory.js:155) and `moneyWeightedReturn()` (line 181) are fully implemented with proper flow adjustment, but are never called by `PortfolioModule.jsx`. The chart uses a simple day-over-day return with no flow adjustment.

### ROOT CAUSE #9: Benchmark hardcoded null on snapshot path

`PortfolioModule.jsx:745` sets `benchmarkValue: null` for the snapshot fallback path, even though `portfolio_daily_snapshots.benchmark_value` exists in the database and is populated by the EOD writer (when Yahoo Finance has data for the default SPY benchmark).

---

## Symptomatic Issues

| Issue | Location | Impact |
|-------|----------|--------|
| Frontend `performanceHistory.js` header says "NEVER reconstructs history from trades" but `fetchPerformanceHistory` calls the fill-curve endpoint | performanceHistory.js:6-10 vs line 72 | Documentation is aspirational, not enforced |
| `fetchPerformanceHistory` calls the same fill-curve endpoint as Tier 1, not a separate snapshots endpoint | performanceHistory.js:72 | Tier 3 fallback duplicates Tier 1 logic |
| `snapshotTimeline` in `useUnifiedPortfolio` (line 150-155) maps snapshots to `{t, equity}` format — but this field is never used by PortfolioModule | useUnifiedPortfolio.js:150-155 | Dead code path |
| `getUnifiedSnapshots` only returns `is_unified=TRUE` snapshots | unifiedPortfolio.js:1541 | Legacy EOD snapshots are excluded |
| `backfillUnifiedSnapshotsFromFills` writes `invested_capital=0` | line 1707 | `unrealizedPnl = portfolioValue - 0 - cash` is inflated |
| Daily return overwritten: backend value zeroed, frontend recomputes | PortfolioModule.jsx:742, 759 | TWR cannot work |
| `recordUnifiedSnapshot` doesn't write `daily_pnl`, `realized_pnl`, `unrealized_pnl` | lines 1512-1529 | Today's snapshot lacks PNL fields |

---

## Before/After Conceptual Model

### Current

```
Connected Account (Hyperliquid)
  │
  ▼
Sync: holdings + fills(closedPnl) + cashBalance  [cashBalance NOT persisted]
  │
  ▼
Source Tables: portfolio_source_positions, user_workspace_trade_fills
  │
  ├── getUnifiedSummary() → totalValue (live headline)  ✅ Reads source tables correctly
  │
  ├── getUnifiedEquityCurveFromFills() → equity curve   ⚠️ Reads ONLY trade_fills.realized_pnl
  │   = currentEquity - Σ(future_realizedPnL)             ⚠️ Ignores unrealized, cash, flows
  │
  └── backfillUnifiedSnapshotsFromFills() → snapshots     ⚠️ Derived from fill curve (estimated)
        │
        ▼
    portfolio_daily_snapshots (is_unified=TRUE, all estimated=TRUE)
        │
        ▼
    EOD Job: assembleSnapshotInputs                      ⚠️ Reads ONLY legacy manual tables → portfolio_value=0
        │
        ▼
    portfolio_daily_snapshots (is_unified=FALSE, empty for connected accounts)
        │
        ▼
    API: equity-curve / snapshots / summary
        │
        ▼
    Frontend: PREFERS fillEquityCurve (⚠️ wrong)
      → buildEquitySeries → Performance Curve
```

### Recommended

```
Connected Accounts
  │
  ▼
Normalized data: positions, transactions, cash, balances, flows
  │
  ▼
Immutable Daily Snapshots (portfolio_daily_snapshots)
  ├── Real equity per day (cash + position market values at date)
  ├── Daily P&L (computed from prior snapshot + trades + flows)
  ├── Realized PNL (from trades at date)
  ├── Unrealized PNL (market value - cost basis)
  ├── Deposits/Withdrawals (from cash flow ledger)
  ├── Benchmark value + return (from Yahoo Finance)
  └── All fields populated from unified source layer
  │
  ▼
Performance API: GET /api/portfolio/history/range
  │ — Returns ONLY portfolio_daily_snapshots (never fill-reconstructed)
  │ — Includes benchmark, cash flows, daily PNL, daily return
  │
  ▼
Frontend: Performance Curve
  ├── Uses snapshots as primary source (always)
  ├── Appends today's live equity as overlay (separate point)
  ├── TWR/MWR from stored daily_return + cash flows
  └── Benchmark comparison from stored benchmark_value
```

### Architectural differences

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Historical equity source | Fill-curve reconstruction (backward-subtract realized PnL from current) | Immutable daily snapshots (cash + position MV at date) |
| Snapshot data source | Legacy manual tables only | Unified source tables (portfolio_source_*) |
| Unrealized PNL | Excluded from curve | Included in daily snapshot equity |
| Cash flows | Hardcoded 0 | Dedicated cash-flows ledger |
| Frontend preference | Fill-curve > snapshots | Snapshots > fill-curve (supplemental only) |
| Daily return | Client-side simple return | Backend TWR-compatible `daily_return` |
| Benchmark | Sparse/null | Yahoo Finance per snapshot day |
| TWR/MWR | Implemented but unused | Wired to curve display |
| Cash balance | Not persisted from sync | Written to `portfolio_source_cash` |

---

## Severity Framework

- **P0 — Financially Incorrect**: Equity, PNL, or return that could materially mislead users
- **P1 — Major**: Performance history is materially incomplete or inconsistent
- **P2 — Moderate**: Metric is mostly correct but breaks under certain conditions
- **P3 — Minor**: Display, labeling, rounding, or edge-case issue

---

## Findings Table

| ID | Severity | Area | Finding | Evidence | Financial Impact | Recommendation |
|----|----------|------|---------|----------|-----------------|----------------|
| PC-001 | P0 | Equity Curve | Performance Curve uses fill-reconstructed equity (backward-subtract realized PnL from current equity), not true portfolio equity | `unifiedPortfolio.js:1569-1667`; `PortfolioModule.jsx:694` | Equity appears as step-function of trading activity; missing unrealized PNL and cash | Use `portfolio_daily_snapshots` as primary source |
| PC-002 | P0 | PNL | Unrealized PNL included in live headline but excluded from historical curve | `getUnifiedSummary` line 1196 includes it; `getUnifiedEquityCurveFromFills` line 1583 does not | PNL understates during open positions with gains; appears correct only at exit | Feed `unrealized_pnl` from positions into daily snapshot equity |
| PC-003 | P0 | Returns | Daily return computed as simple day-over-day ratio on fill-reconstructed equity | `PortfolioModule.jsx:718, 759` overwritten from backend `daily_return` (line 742) | Returns measure change in cumulative realized PnL, not portfolio return | Use backend `daily_return` and TWR from `performanceHistory.js:155` |
| PC-004 | P0 | Snapshots | EOD snapshot writer (`assembleSnapshotInputs`) reads ONLY legacy manual tables, bypassing connected-account source tables | `portfolioSnapshots.js:172-268` | Connected-account workspaces get `portfolio_value=0` in snapshots | Modify to query `portfolio_source_positions` + `portfolio_source_cash` |
| PC-005 | P0 | Architecture | Frontend prefers `fillEquityCurve` over immutable `portfolio_daily_snapshots` | `PortfolioModule.jsx:694` returns early before snapshots branch (line 729) | Snapshots never consumed even if correctly populated | Reverse preference: snapshots primary, fill-curve supplementary |
| PC-006 | P0 | Cash Flows | Deposits/withdrawals hardcoded to 0 in both fill-curve and snapshot paths; no cash-flows ledger exists | `PortfolioModule.jsx:705`; `portfolioSnapshots.js:274-275` | Deposits show as 100% gains; withdrawals as 100% losses | Create `portfolio_cash_flows` table; populate from deposit/withdrawal transactions |
| PC-007 | P0 | PNL | EOD `realizedPnl` reads from `user_workspace_trades` (legacy manual trades), NOT from connected-account fills | `portfolioSnapshots.js:260-265` | Realized PNL from broker fills is absent from snapshots | Read from `user_workspace_trade_fills` or `portfolio_source_transactions` |
| PC-008 | P1 | Architecture | Fill-curve reconstruction uses `raw_payload_json ? 'closedPnl'` filter, excluding ALL non-Hyperliquid fills | `unifiedPortfolio.js:1576` | SnapTrade, manual, and other source transactions invisible to curve | Include `portfolio_source_transactions.realized_pnl` in curve data |
| PC-009 | P1 | Account Sync | `cashBalance` (Hyperliquid `accountValue`) returned by sync but NOT persisted to `portfolio_source_cash` | `exchangeSync.js:342`; `unifiedPortfolio.js:746-752` | Cash equity component lost from headline `totalValue` | Write `cashBalance` to `portfolio_source_cash` in `recordSourceSync` |
| PC-010 | P1 | Returns | TWR/MWR implementations exist but are unused by the Performance Curve | `performanceHistory.js:155-220`; `PortfolioModule.jsx` never calls them | No cash-flow-adjusted returns displayed | Wire `timeWeightedReturn()` to the chart headline |
| PC-011 | P1 | Benchmark | `benchmarkValue` hardcoded to `null` on snapshot fallback path | `PortfolioModule.jsx:745` | No benchmark comparison when snapshots are used | Use `s.benchmarkValue` from snapshot data when available |
| PC-012 | P1 | Architecture | `getUnifiedSnapshots` only returns `is_unified=TRUE` snapshots, excluding legacy EOD snapshots | `unifiedPortfolio.js:1541` | Legacy EOD data is invisible to unified path | Remove `is_unified=TRUE` filter or migrate legacy snapshots |
| PC-013 | P1 | Snapshots | `backfillUnifiedSnapshotsFromFills` writes `invested_capital=0`, making `unrealized_pnl` = `portfolio_value - 0 - cash` | `unifiedPortfolio.js:1707` | Unrealized PNL inflated by cash amount | Compute invested_capital from fill notionals |
| PC-014 | P2 | Returns | `historyBaseValue` uses first point in range as baseline — look-ahead bias on fill-curve path | `PortfolioModule.jsx:789-792` | Percentage returns are inconsistent across ranges | For fill-curve: anchor to portfolio inception; for snapshots: use snapshot first value |
| PC-015 | P2 | Time-series | Fill-curve forward-fill creates continuous daily curve but ALL non-fill days are `estimated=TRUE` | `unifiedPortfolio.js:1598-1623` | Chart shows interpolated equity as "real" data | Clearly distinguish estimated vs real in UI; label fill-curve as approximate |
| PC-016 | P2 | Multi-account | No multi-account isolation — all sources summed into single curve | `unifiedPortfolio.js:926-1120` | Cannot show per-account performance | Add per-source curve option |
| PC-017 | P2 | Currency | Fill-curve has no FX conversion — `realized_pnl` treated as base currency | `unifiedPortfolio.js:1583` | Multi-currency accounts have inaccurate equity | Apply FX conversion at fill timestamp |
| PC-018 | P2 | Missing data | No fills with `closedPnl` → empty fill-curve → empty Performance Curve | `unifiedPortfolio.js:1586` | Chart is blank for accounts that haven't closed any positions | Use snapshots or live equity as fallback |
| PC-019 | P2 | Missing data | `getUnifiedEquityCurveFromFills` uses `Number(summary.totalValue) \|\| 0` — if summary fails, entire curve becomes 0 | `unifiedPortfolio.js:1572` | Entire curve shows zero/negative equity | Guard against zero currentEquity; return empty curve instead |
| PC-020 | P3 | Display | `performanceHistory.js` header says "NEVER reconstructs history from trades" but `fetchPerformanceHistory` calls fill-curve endpoint | `performanceHistory.js:6-10` vs line 72 | Documentation misleads developers | Update header comment to match actual behavior |
| PC-021 | P3 | Display | `snapshotTimeline` in `useUnifiedPortfolio` is computed but never used by PortfolioModule | `useUnifiedPortfolio.js:150-155` | Dead code, confusion | Remove or wire to actual usage |
| PC-022 | P3 | Display | `recordUnifiedSnapshot` doesn't write `daily_pnl`, `realized_pnl`, `unrealized_pnl` fields | `unifiedPortfolio.js:1512-1529` | Today's snapshot lacks PNL data | Add these fields to the INSERT statement |

---

## Data-Source Matrix

| Metric | Current Source | Correct Source? | Transformation | Problem |
|--------|---------------|-----------------|----------------|---------|
| **Equity** (live) | `getUnifiedSummary().totalValue` | ✅ Yes | `investedValue + cashValue + manualValue` | Correct for live display |
| **Equity** (historical) | `getUnifiedEquityCurveFromFills` | ❌ No | `currentEquity - Σ(future_realizedPnl)` | Ignores unrealized PNL, cash, flows; backward-subtraction is invalid |
| **Equity** (snapshot) | `portfolio_daily_snapshots.portfolio_value` | ⚠️ Partially | Written by `recordUnifiedSnapshot` (today) or `backfillUnifiedSnapshotsFromFills` (history) | EOD snapshots are 0 for connected accounts; backfill is fill-derived |
| **Market Value** | `portfolio_source_positions.market_value` | ✅ Yes | `market_value \|\| (qty × price)` | Correct in live, not in historical |
| **Cash** | `portfolio_source_cash.amount` | ✅ Yes | Summed across sources, FX-converted | Not persisted from sync (PC-009); hardcoded 0 in snapshots |
| **Realized PNL** | `user_workspace_trade_fills.realized_pnl` | ⚠️ Partially | Sum of per-fill `closedPnl - fee` | Only Hyperliquid; not in `portfolio_source_transactions` |
| **Realized PNL** (snapshot) | `user_workspace_trades` (legacy) | ❌ No | `Σ(sell_notional - fee) - Σ(buy_notional + fee)` | Misses connected-account fills entirely |
| **Unrealized PNL** | `portfolio_source_positions.unrealized_pnl` (broker-reported) | ✅ Yes | Used in `valueRow()` for derivatives | NOT in equity curve; snapshot computes as residual |
| **Total PNL** | N/A (not computed) | N/A | N/A | No explicit Total PnL = Realized + Unrealized |
| **Daily Return** | `portfolio_daily_snapshots.daily_return` (backend) | ✅ Yes | `dailyPnl / prevValue` | Frontend overwrites with client-side calc (PC-003) |
| **Cumulative Return** | Client-side `(value - base) / base` | ⚠️ Partially | No cash-flow adjustment | Deposits/withdrawals distort returns |
| **Benchmark** | Yahoo Finance (SPY/BTC/ETH) | ✅ Yes | Daily close, cached 1h | Null on snapshot path; sparse on fill-curve |
| **Deposits** | None (hardcoded 0) | ❌ None | N/A | Causes massive return distortion |
| **Withdrawals** | None (hardcoded 0) | ❌ None | N/A | Causes massive return distortion |

---

## Account-Sync Matrix

| Provider | Accounts | Balances | Positions | Transactions | Executions | Historical Equity | Cash Flows | Performance Ready? |
|----------|---------|----------|-----------|-------------|-----------|-------------------|------------|-------------------|
| Hyperliquid | ✅ (account_value) | ✅ (accountValue → cashBalance, NOT persisted) | ✅ (positions with unrealizedPnl) | ✅ (fills with closedPnl) | ✅ (fills with closedPnl) | ❌ (only fill-curve reconstruction) | ❌ | ❌ |
| SnapTrade | ✅ (account_id) | ⚠️ (market_value per position, not account-level) | ✅ (mappings via mapSnapTradeToSource) | ⚠️ (mapSnapTradeToSource maps to source transactions) | ⚠️ (only if transactions provided) | ❌ | ❌ | ❌ |
| Wallet (Lighter) | ✅ (account endpoint) | ✅ (balance × price) | ✅ (position) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manual | N/A | ✅ (user_workspace_cash) | ✅ (user_workspace_portfolio) | ✅ (user_workspace_trades) | ✅ (user_workspace_trades) | ⚠️ (EOD only, legacy tables) | ❌ | ⚠️ (legacy path only) |

**Key:** ✅ = fully supported, ⚠️ = partial, ❌ = not supported or broken

---

## Recommended Remediation Plan

### Phase 1 — Data Integrity (P0 Fixes)

1. **Fix `assembleSnapshotInputs` to read from unified source tables** (PC-004)
   - Modify `portfolioSnapshots.js:168` to query `portfolio_source_positions` + `portfolio_source_cash`
   - Use the same `valueRow()` + `toBase()` logic from `getUnifiedSummary` for consistent valuation
   - Map the 5 affected positions (unifiedPortfolio.js:100-500)

2. **Fix `recordSourceSync` to persist `cashBalance`** (PC-009)
   - Write Hyperliquid's `cashBalance` (accountValue) to `portfolio_source_cash` with currency "USDC"
   - Modify `unifiedPortfolio.js:746-752` to handle a `source.cashBalance` property

3. **Fix `realizedPnl` in EOD snapshots to read from fills** (PC-007)
   - Modify `portfolioSnapshots.js:260-268` to query `user_workspace_trade_fills` for fills on the snapshot date
   - Include `portfolio_source_transactions.realized_pnl` as well (PC-008)

4. **Create `portfolio_cash_flows` table** (PC-006)
   - Schema: `id, workspace_id, source_id, type (deposit/withdrawal/transfer/dividend/interest/fee), amount, currency, executed_at, notes`
   - Populate from brokerage withdrawal/deposit transactions during sync
   - Modify `assembleSnapshotInputs` to query and sum flows per date

### Phase 2 — Canonical Historical Performance (P0/P1 Fixes)

5. **Make snapshots the primary data source for the Performance Curve** (PC-005)
   - Modify `PortfolioModule.jsx:694` to prefer snapshots when available
   - Use fill-curve only as a supplemental data point (e.g., intra-day resolution)
   - Append today's live equity as a separate overlay point (already done at line 800-812)

6. **Populate all snapshot fields correctly** (PC-013, PC-022)
   - Modify `recordUnifiedSnapshot` (line 1512-1529) to include `daily_pnl`, `realized_pnl`, `unrealized_pnl`
   - Modify `backfillUnifiedSnapshotsFromFills` to compute `invested_capital` from fill notionals

7. **Include all sources in snapshot EOD** (PC-008)
   - Fix `getUnifiedEquityCurveFromFills` filter to include non-Hyperliquid fills
   - Read from `portfolio_source_transactions.realized_pnl` as well

8. **Wire TWR/MWR to the Performance Curve** (PC-010)
   - Call `timeWeightedReturn()` and `moneyWeightedReturn()` from `performanceHistory.js`
   - Display TWR as the primary headline return metric
   - Use backend `daily_return` instead of recomputing client-side (PC-003)

### Phase 3 — PNL / Return Engine (P0/P1 Fixes)

9. **Include unrealized PNL in historical equity** (PC-002)
   - In `assembleSnapshotInputs`, for each day in replay mode, compute `unrealized_pnl = currentMarketValue - costBasis`
   - Store in `portfolio_daily_snapshots.unrealized_pnl`
   - Include in `portfolio_value` = cash + market_value (unrealized PNL is already in market_value for spot; for derivatives, `collateral + unrealizedPnl`)

10. **Implement historical position reconstruction**
    - For replay dates, price positions at historical close (Yahoo Finance) rather than current price
    - Requires `closeForDate()` lookup per position symbol per snapshot date

### Phase 4 — API (P1/P2 Fixes)

11. **Create unified history endpoint** (PC-020)
    - `GET /api/portfolio/history/range?from=...&to=...&benchmark=...`
    - Returns `portfolio_daily_snapshots` rows (only immutable snapshots)
    - Include all fields: portfolio_value, cash, invested_capital, daily_pnl, realized_pnl, unrealized_pnl, deposits, withdrawals, benchmark_value, benchmark_return

12. **Fix `getUnifiedSnapshots` filter** (PC-012)
    - Remove `is_unified=TRUE` filter to include legacy EOD snapshots
    - OR migrate legacy snapshots to `is_unified=TRUE`

13. **Populate benchmark on snapshot path** (PC-011)
    - `assembleSnapshotInputs` should fetch Yahoo close for the snapshot date
    - Store in `benchmark_value`, `benchmark_return`

### Phase 5 — Frontend Performance Curve (P1/P2 Fixes)

14. **Reverse frontend preference** (PC-005 — detailed)
    - Tier 1: `portfolio_daily_snapshots` (immutable, complete)
    - Tier 2: `fillEquityCurve` (supplemental, for intra-day or missing snapshot days)
    - Tier 3: live equity overlay (currentAccountEquity)

15. **Use backend daily_return** (PC-003)
    - Read `s.dailyReturn` from snapshots instead of recomputing client-side
    - Remove the `dailyReturn: 0` overwrite at line 742

16. **Add cash-flow-adjusted returns display** (PC-006)
    - If deposits/withdrawals available, show TWR alongside simple return
    - Flag when returns are not cash-flow-adjusted

17. **Distinguish estimated vs real points** (PC-015)
    - Visually de-emphasize `estimated=TRUE` points (carry-forward days)
    - Label fill-curve as "approximate" where used

### Phase 6 — Validation

18. **Golden-path reconciliation test**
    - Construct: $10K deposit → $8K buy → $8.5K value → $10.5K total
    - Verify: Equity = $10,500, PNL = +$500, Return = +5%
    - Verify: $10K deposit → $10K value → Return = 0% (not 100%)

19. **Multi-account reconciliation test**
    - Two connected accounts (different brokers, different currencies)
    - Verify: totalValue = Σ account equity, no double-counting, FX conversion correct

20. **Time-travel validation**
    - Verify snapshots are immutable (ON CONFLICT DO NOTHING)
    - Verify changing current prices does NOT alter historical snapshots
    - Verify daily_return matches TWR geometric linking

21. **Benchmark validation**
    - Verify benchmark_value matches Yahoo Finance close for snapshot dates
    - Verify benchmark line is not fabricated when Yahoo unavailable (null, not interpolated)

---

## Acceptance Criteria

```
[✅] Where does equity come from?
     → LIVE: getUnifiedSummary().totalValue = investedValue + cashValue + manualValue
     → HISTORICAL: getUnifiedEquityCurveFromFills = currentEquity - Σ(future_realizedPnL)
     → SNAPSHOTS: portfolio_daily_snapshots.portfolio_value (EOD = 0 for connected; backfill = fill-derived)

[x] Where does PNL come from?
     → Realized: user_workspace_trade_fills.realized_pnl (Hyperliquid closedPnl only)
     → Unrealized: portfolio_source_positions.unrealized_pnl (live only; NOT in curve)
     → NOT in curve: unrealized PNL is missing

[x] Where does return come from?
     → Client-side: (today.portfolioValue - yesterday.portfolioValue) / yesterday.portfolioValue
     → NOT TWR/MWR (implemented in performanceHistory.js but unused)

[x] Where does historical equity come from?
     → getUnifiedEquityCurveFromFills (fill-curve reconstruction, backward-subtracted)

[x] Where does connected-account equity come from?
     → getUnifiedSummary reads portfolio_source_positions + portfolio_source_cash
     → BUT cashBalance (accountValue) is NOT persisted to portfolio_source_cash

[x] Where do connected-account transactions come from?
     → user_workspace_trade_fills (fills with closedPnl)
     → portfolio_source_transactions (from recordSourceSync, with realized_pnl)
     → BUT getUnifiedEquityCurveFromFills only reads user_workspace_trade_fills

[x] Where do deposits/withdrawals come from?
     → NOWHERE (hardcoded 0, no cash-flows ledger exists)

[x] How are cash flows treated?
     → Not at all — both fill-curve and snapshot paths hardcode deposits=0, withdrawals=0

[x] How are multiple accounts aggregated?
     → getUnifiedSummary sums across all portfolio_source_positions/cash
     → Fill curve queries user_workspace_trade_fills by workspace_id (all accounts)

[x] How are currencies converted?
     → Live: toBase() with FX rates from portfolio_fx_rates (USD/USDC/USDT 1:1)
     → Historical: NO conversion on fill-curve (realized_pnl treated as base)

[x] How are realized PNL and unrealized PNL calculated?
     → Realized: fill.closedPnl - fee (Hyperliquid only)
     → Unrealized: portfolio_source_positions.unrealized_pnl (broker-reported)
     → Unrealized PNL NOT included in equity curve

[x] How is cumulative return calculated?
     → Client-side: (value - baseValue) / baseValue * 100
     → NO cash-flow adjustment

[x] How is daily return calculated?
     → Client-side: (today - yesterday) / yesterday
     → Frontend overwrites backend daily_return (line 742)

[x] What does each Performance Curve point represent?
     → Fill-curve: equity = currentEquity - Σ(future_realizedPnL after this date)
     → Snapshot: equity = portfolio_value from daily snapshot

[x] What data does the Performance Curve actually consume?
     → PRIMARY: getUnifiedEquityCurveFromFills (fill-reconstructed)
     → FALLBACK: getUnifiedSnapshots (is_unified=TRUE only)

[x] Does it consume immutable snapshots?
     → YES as fallback only; NO as primary (fillEquityCurve preferred)

[x] Are snapshots complete?
     → NO — EOD writer reads legacy tables only (portfolio_value=0 for connected accounts)
     → Backfill snapshots are all estimated=TRUE with invested_capital=0

[x] Are broker fills sufficient to reconstruct performance?
     → PARTIALLY — only Hyperledger fills with closedPnl are used
     → Unrealized PNL is lost (fills only have realized PnL)
     → Cash (accountValue) is not persisted
     → Opening trades (no closedPnl) are excluded

[x] Are NULL values silently converted to zero?
     → YES: `Number(summary.totalValue) || 0` (line 1572), `toNum(v, 0)` (line 85),
       `Number(s.deposits || 0)` etc. throughout

[x] Is interpolation occurring?
     → YES — fill-curve forward-fills dates (line 1598-1623) with estimated=TRUE

[x] Is the benchmark real?
     → YES — Yahoo Finance data, not fabricated
     → BUT null on snapshot path and sparse on fill-curve path

[x] Is frontend calculation duplicated from backend calculation?
     → YES — daily_return computed client-side, overwrites backend value

[x] Can equity be reconciled?
     → NO — cannot reconcile because historical equity is reconstructed (not observed)

[x] Can PNL be reconciled?
     → NO — realized PNL missing for non-Hyperledger fills; unrealized PNL missing from curve

[x] Can return be reconciled?
     → NO — no cash-flow data; simple return with no flow adjustment

[x] Does multi-account aggregation work?
     → YES for live headline; NO for history (fill-curve doesn't support per-account breakdown)

[x] Are derivatives represented correctly?
     → YES in portfolio_source_positions (collateral + unrealizedPnl)
     → NO in equity curve (derivatives ignored entirely)

[x] What is the authoritative source of truth?
     → DESIGNED: portfolio_daily_snapshots (immutable, rich schema)
     → ACTUAL: getUnifiedEquityCurveFromFills (fill-reconstruction, backward-subtracted)
     → RECOMMENDED: portfolio_daily_snapshots (once EOD writer is fixed to read unified tables)

[x] What is the primary root cause?
     → EOD snapshot writer (assembleSnapshotInputs) reads legacy manual tables only,
        bypassing portfolio_source_* connected-account tables → snapshots are zero
     → Frontend prefers fill-curve over snapshots → even correct snapshots would be bypassed

[x] What should be fixed first?
     → 1. Fix assembleSnapshotInputs to read portfolio_source_* tables
     → 2. Fix frontend preference (snapshots primary, fill-curve supplementary)
     → 3. Persist cashBalance to portfolio_source_cash during sync
     → 4. Create cash-flows ledger for deposits/withdrawals
```

---

## Key File Locations for Implementation

| File | Lines | Critical Issue |
|------|-------|---------------|
| `backend/unifiedPortfolio.js` | 1569-1667 | Fill-curve backward-subtraction (PC-001) |
| `backend/unifiedPortfolio.js` | 1572 | `currentEquity \|\| 0` zero-substitution |
| `backend/unifiedPortfolio.js` | 1576 | `raw_payload_json ? 'closedPnl'` filter (PC-008) |
| `backend/unifiedPortfolio.js` | 893-1231 | `getUnifiedSummary` (correct for live, not used for history) |
| `backend/unifiedPortfolio.js` | 1503-1534 | `recordUnifiedSnapshot` (today only, missing PnL fields) |
| `backend/unifiedPortfolio.js` | 1673-1713 | `backfillUnifiedSnapshotsFromFills` (estimated=TRUE, invested_capital=0) |
| `backend/unifiedPortfolio.js` | 1742-1773 | `runWorkspaceSync` (orchestrator) |
| `backend/portfolioSnapshots.js` | 168-324 | `assembleSnapshotInputs` (reads legacy tables only) |
| `backend/portfolioSnapshots.js` | 260-275 | Realized PnL from `user_workspace_trades` + deposits=0 |
| `backend/portfolioSnapshots.js` | 385-468 | `DailySnapshotService.writeDay` |
| `backend/portfolioSnapshots.js` | 476-519 | `DailySnapshotService.runEod` |
| `backend/exchangeSync.js` | 342 | `cashBalance` not persisted |
| `backend/database.js` | 1649-1673 | `user_workspace_trade_fills` schema (no account_equity_after) |
| `backend/database.js` | 2113-2145 | `portfolio_daily_snapshots` schema (rich, but poorly populated) |
| `frontend/src/components/PortfolioModule.jsx` | 694-724 | Fill-curve preference (PC-005) |
| `frontend/src/components/PortfolioModule.jsx` | 705 | Hardcoded cash/deposits/withdrawals = 0 |
| `frontend/src/components/PortfolioModule.jsx` | 742 | dailyReturn overwritten to 0 |
| `frontend/src/components/PortfolioModule.jsx` | 745 | benchmarkValue hardcoded null |
| `frontend/src/components/PortfolioModule.jsx` | 716-719 | Client-side daily return (overwrites backend) |
| `frontend/src/utils/performanceHistory.js` | 62-106 | `fetchPerformanceHistory` calls fill-curve API |
| `frontend/src/utils/performanceHistory.js` | 155-172 | `timeWeightedReturn` (implemented, unused) |
| `frontend/src/utils/performanceHistory.js` | 181-220 | `moneyWeightedReturn` (implemented, unused) |
| `frontend/src/hooks/useUnifiedPortfolio.js` | 29-159 | Fetches all 5 endpoints; `snapshotTimeline` dead code (line 150-155) |
