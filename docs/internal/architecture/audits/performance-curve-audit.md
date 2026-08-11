# Zenin — Performance Curve: Architecture & Data-Integrity Audit

**Date:** 2026-07-10
**Scope:** Read-only investigation. No code was modified, no fixes applied, no commits made.
**Method:** Source traced from the React render layer down to the database write path, with every conclusion cited to `file:line`.
**Status of feature under audit:** The "Performance Curve" is the **Equity Curve / % Gain / Cash P&L** area chart rendered inside `PortfolioModule.jsx` (the `portfolioPerformanceSeries` passed to `ReactApexChart` at `PortfolioModule.jsx:795-811`).

---

## 1. Executive Summary

There are **two parallel realities** in the codebase, and they are **disconnected**:

1. **What the Performance Curve renders today** — a curve built **entirely client-side** by reconstructing equity from *trade-time* figures plus the *live* account equity, interpolated across a fixed number of synthetic time buckets. The benchmark overlay is **purely synthetic** (a hardcoded daily-drift compound curve indexed by array position, with **no relationship to real SPY/BTC/ACWI prices**).

2. **A fully-built, immutable historical snapshot engine** (`backend/portfolioSnapshots.js` → `portfolio_daily_snapshots` table) that exists, is schema-created, is wired into `userWorkspace.snapshots` / `userWorkspace.snapshotService`, has read APIs (`/api/history/*`) and a nightly EOD scheduler (`backend/index.js:15811-15830`) — **but is never read by the frontend Performance Curve.**

### What the curve actually plots (verified)
- **Portfolio line (`chartData`):** account equity = `liveAvailableBalance + Σ(holding.price × qty) + optionsUnrealizedPnL`, anchored at trade timestamps read from the stored `account_equity_after` field, with the **rightmost point forced to the live equity** and everything between interpolated across `pointCount` buckets (`PortfolioModule.jsx:339-415`). Modes: `equity` (USD value), `percentage` (`(equity−initial)/initial × 100`), `pnl` (equity − initial).
- **Benchmark line (`benchmarkSeries`):** `initialBalance × (1 + drift)^idx`, where `drift` is a hardcoded constant (`SPY=0.0008`, `ACWI=0.0006`, else `0.0005`) and `idx` is the **array index** of the point — i.e. it is a fabricated exponential curve, not market data (`PortfolioModule.jsx:761-811`).

### Verdict
**The Performance Curve in its current rendered form is not a true portfolio equity curve.** It is a *trade-event-anchored equity reconstruction* that:
- only has points where the stored `account_equity_after` is finite (manual trades populate it; API-imported brokerage fills leave it `NULL` → dropped),
- forces the last point to the **live** equity and re-derives it on every price tick,
- derives its stored equity from **current holding prices**, so historical values can drift,
- and overlays a **synthetic, fabricated** benchmark with no real market series behind it.

The infrastructure to make it correct (`portfolio_daily_snapshots`, immutable EOD writer, scheduler, history APIs) **already exists in the backend but is not consumed by this chart.** Until the chart is re-pointed at `/api/history/*`, it should not be relied upon as a record of historical performance.

---

## 2. What Is the Performance Curve Actually Plotting?

| Series | Source of Y value | Mode | Evidence |
|---|---|---|---|
| **Portfolio (area)** | `chartData` → anchors from `tradeTimeline[].equity` (stored `account_equity_after`) + final point = `currentAccountEquity` (live) | `equity` = USD value; `percentage` = `(equity−initial)/initial×100`; `pnl` = `equity−initial` | `PortfolioModule.jsx:339-415`, `:795-811` |
| **Benchmark (line)** | `initialBalance × (1 + drift)^idx` (synthetic) | same three modes | `PortfolioModule.jsx:761-811` |

**Therefore the curve represents:**
- ❌ Not benchmark-relative return (benchmark is fake)
- ❌ Not cumulative return independent of trades (it is anchored to trade events)
- ❌ Not a daily portfolio value series (buckets are interpolated, not dated)
- ✅ **Account equity reconstructed from trade-time equity figures + live equity at the right edge**, in `equity`/`percentage`/`pnl` form.
- The benchmark overlay is **synthetic demo data** (a hardcoded drift compound), not a real index.

### Mode math (verified)
- `equity`: `toSeriesValue(equity) = convertFromUSD(equity, displayCurrency, spotPrices)` (`PortfolioModule.jsx:393-401`)
- `percentage`: `((equity − initialBalance) / initialBalance) × 100`
- `pnl`: `equity − initialBalance`
- `initialBalance` defaults to **`INITIAL_ACCOUNT_BALANCE = 10000`** (`accountMetrics.js:9`, `PortfolioModule.jsx:286-287`) unless `accountMetrics.initialBalance` overrides it.

---

## 3. Where Does the Data Originate? (Full pipeline)

```
ReactApexChart  PortfolioModule.jsx:795-811  ← portfolioPerformanceSeries
   │
   ├─ chartData  (useMemo)  PortfolioModule.jsx:339
   │    ├─ anchors = [
   │    │    {t: start, equity: startEquity},                       (:366, :375)
   │    │    ...inRangeTrades.map(t => ({t, equity: t.equity})),    (:376)  ← tradeTimeline
   │    │    ...optionOpenAnchors,                                  (:368-372)
   │    │    {t: now, equity: currentAccountEquity}                (:378)  ← LIVE
   │    │  ].sort(by t)
   │    ├─ points = pointCountMap[chartInterval]  (:340)  // 1D=24,1W=7,1M=30,3M=90,1Y=52,ALL=120,...
   │    └─ interpolation step = (now−start)/(points−1)  (:382-414)
   │
   ├─ tradeTimeline  PortfolioModule.jsx:289
   │    └─ activeAccountMetrics.tradeTimeline
   │         └─ derivedAccountMetrics = calculateAccountSnapshot({trades, portfolioValue, balance})
   │              App.jsx:2943-2951   (or inbound accountMetrics prop)
   │              └─ buildTradeTimeline(trades)  accountMetrics.js:37-65
   │                   equity per trade = trade.accountEquityAfter
   │                                  ?? (balanceAfter + portfolioValueAfter)
   │                                  ?? null  (→ dropped)
   │
   ├─ currentAccountEquity  PortfolioModule.jsx:330-334
   │    = liveAvailableBalance + portfolioValue + totalOptionsValue
   │    liveAvailableBalance = activeAccountMetrics.liveAvailableBalance  (:294-298)
   │         = balance prop (from GET /db/cash)  OR inferred cash  accountMetrics.js:67-99
   │    portfolioValue = Σ(price × qty) over filteredPortfolio  (:270-272)
   │         filteredPortfolio ← props.portfolio  ← GET /db/portfolio
   │    totalOptionsValue = Σ calculateOptionPnL(trade)  (:301-310)
   │
   └─ benchmarkSeries  PortfolioModule.jsx:761-811  (SYNTHETIC, see §8)

DATA SOURCES (backend, via App.jsx refreshTradingWorkspaceState App.jsx:2234-2316):
   GET /db/portfolio      → holdings (user_workspace_portfolio, CURRENT prices)   index.js:12297
   GET /db/cash           → USD balance (user_workspace_cash)                     index.js:2167-ish (zeninFetch '/db/cash')
   GET /db/trades         → trades (user_workspace_trades, incl. account_equity_after)  index.js:12360
   GET /db/trade-executions → apiTradeExecutions (trade_executions)  index.js:12457  **NOT used by chartData**
   GET /db/trade-fees/summary → fee summary
   Live prices: zeninFetch('/prices?...') App.jsx:2964-2982 → spotPrices (drives re-derive)
```

**Key fact:** `chartData` consumes `trades` (the `user_workspace_trades` table). It does **not** consume `apiTradeExecutions` (brokerage/API imports) or `connectedAccounts` balances. See §6/§11.

---

## 4. Is Historical Data Stored?

### Stored tables (verified in `backend/database.js`)
| Table | Granularity | What it stores | Relevance to curve |
|---|---|---|---|
| `user_workspace_trades` | per-trade | `balance_after`, `portfolio_value_after`, `account_equity_after` (trade-time, **mutable**) | **Primary source** of `tradeTimeline[].equity` |
| `trade_executions` | per-fill | same 3 `_after` cols, but **NULL** unless caller computes them | Not in curve (pass-through, `database.js:2722-2738`) |
| `user_workspace_portfolio` | per-holding | current `price`, `quantity` | Current portfolio value (live-marked) |
| `user_workspace_cash` | per-currency | current `balance` | Current cash |
| `portfolio_daily_snapshots` | **per-day** | immutable EOD equity + allocations + benchmark cols (NULL) | **Exists but not read by the curve** (`database.js:2068`) |
| `brokerage_holdings` / `brokerage_transactions` / `brokerage_accounts` | per-account | normalized brokerage data | **Not merged into curve** |

### What is NOT stored
- ❌ No daily portfolio value series feeding the curve (the curve rebuilds from trades each render).
- ❌ No hourly/intraday portfolio snapshots.
- ❌ **No historical price/candle store** (search for `price_history|candles|market_history|historical_prices|equity_history` returned nothing in `database.js`). Only **live** `spotPrices`.
- ❌ No historical connected-account balances (exchange balances are pulled live, not persisted as history — see §10).
- ❌ No `user_workspace_cashflows` table (the snapshot writer references it but it does **not exist** — `portfolioSnapshots.js:158-164` queries `user_workspace_cashflows`; not in schema). So deposits/withdrawals cannot be captured.
- ✅ `portfolio_daily_snapshots` *would* store daily value + settlement + benchmark — but the curve ignores it.

**Conclusion:** The curve is **reconstructed every render** from trade-time equity + live equity. There is no immutable daily series behind it (yet). The snapshot table that *would* provide one exists but is orphaned from this UI.

---

## 5. How Are Connected Exchanges Handled?

**Providers in the codebase:** The exchange-credential path (`/api/db/exchange-keys`, `index.js:5100`) stores **encrypted API keys + detected permission scope** only. There is **no live balance/fill sync loop** from Binance/Bybit/Hyperliquid/etc. into the portfolio tables — the `exchange-keys` POST persists credentials and records an activity event, but does **not** call any `pullBalances`/`importTrades` (search for `syncBalances|fetchBalances|importTrades` in the exchange path returned nothing; the only `sync` references are guest-mode `syncAvailable` flags).

**What connected exchanges contribute today:**
- Credentials are stored (`user_exchange_keys`, `database.js:1984`) for **read-only scope verification** (`buildCredentialScopeState`, `index.js:5100` handler).
- They surface in the **Connections modal** / `WorkspaceScopeSelector` (`WorkspaceScopeSelector.jsx`) as *framing context* ("which connected account(s) the workspace is framed around") — **not** as aggregated balances in the curve.
- They are **not** pulled for current balances, historical balances, historical equity, trade history, position history, funding, or daily snapshots in any path that reaches `portfolio`/`trades`/`balance` props.

**Per-provider reality check (verified against source):**
| Provider | Current balances pulled? | Historical balances? | Trade history? | Persisted to curve? |
|---|---|---|---|---|
| Binance / Bybit / Hyperliquid (CEX keys) | ❌ No live pull | ❌ | ❌ | ❌ |
| Interactive Brokers / Alpaca | ❌ (only via SnapTrade brokerage path, see §6) | ❌ | ❌ unless synced | ❌ |
| Polymarket | ❌ (prediction market module separate) | ❌ | ❌ | ❌ |

**Verdict:** Connected exchanges today are **credential stores + UI framing**, not data feeds into the Performance Curve.

---

## 6. How Are Brokerages Handled?

There **is** a full provider-agnostic brokerage abstraction (`backend/brokerage/`, documented in `docs/BROKERAGE_ARCHITECTURE.md`):
- `BrokerageService` → `SyncEngine` → `BrokerageRegistry` → `SnapTradeProvider` (only registered provider, `bootstrap.js`, gated on `isSnapTradeConfigured`).
- `SyncEngine.syncConnection` fetches accounts/holdings/transactions from the provider and persists to `brokerage_accounts` / `brokerage_holdings` / `brokerage_transactions` (`database.js:2344, 2399, 2425`).
- Routes mounted at `registerBrokerageRoutes(app, …)` (`index.js:3929`).

**Critical gap:** `GET /api/db/portfolio` (`index.js:12297`) reads **only** `user_workspace_portfolio` — there is **no `UNION`/merge with `brokerage_holdings`** (`database.js` `portfolio.getAll` selects solely from `user_workspace_portfolio`). Likewise `GET /api/db/trades` returns only `user_workspace_trades`. The `portfolio` and `trades` props that feed the curve **never include brokerage data.**

So brokerage accounts, when synced, land in **separate `brokerage_*` tables** that feed **separate UI** (the Connections/Brokerage panels) but **do not aggregate into Portfolio Value, Cash, Holdings, the Performance Curve, Benchmark, Analytics (curve path), Journal (curve path), Calendar, or Portfolio Summary** as those are currently wired.

> Note: This is a structural finding from the data-flow wiring, not a statement that brokerage sync is non-functional. The sync *does* write `brokerage_*` rows; it simply isn't joined into the portfolio/curve read path.

---

## 7. How Are Manual Trades Handled? (Trade → Chart path)

```
executeTrade()  backend/database.js (executeTrade path)
   │  nextCashBalance = cash ∓ notional ∓ fee
   │  portfolioValueAfter = Σ(holding.price × qty)   ← CURRENT holding price
   │  account_equity_after = nextCashBalance + portfolioValueAfter   ← TRADE-TIME, LIVE-MARKED
   ▼
INSERT user_workspace_trades (account_equity_after = <value>)  database.js:1515 cols; :6885 insert list
   ▼
GET /api/db/trades → row.account_equity_after  index.js:12360; database.js:2749 mapping
   ▼
normalizeTradeRecord()  App.jsx:1097-1129 → props.trades
   ▼
buildTradeTimeline(trades)  accountMetrics.js:37-65 → tradeTimeline[].equity
   ▼
PortfolioModule chartData  PortfolioModule.jsx:339  → anchor at trade.t
   ▼
ReactApexChart area  PortfolioModule.jsx:800
```

- **Manual trade (executeTrade):** computes and **stores** `account_equity_after` at trade time → appears as a curve anchor. ✅
- **Manual trade log (POST /api/db/trades → trade_executions.add):** pure pass-through, equity left `NULL` (`database.js:2722-2738`) → **dropped from the curve** (equity = null → skipped in `buildTradeTimeline`, `accountMetrics.js:55-59`). ❌
- **API/brokerage import (trade_executions):** same pass-through → equity `NULL` → not even in `chartData` (which reads `trades`, not `apiTradeExecutions`). ❌
- **Journal entry:** separate `workspace_collections` (`journal:entries`); does not touch the curve.

**Therefore manual trades and connected/API trades do NOT affect the chart identically:** only `executeTrade`-path trades carry an equity anchor.

---

## 8. Does the Chart Represent Reality? (Lifecycle)

The curve changes because of **live recalculation every render**, driven by `spotPrices` and `balance`:

- `chartData` `useMemo` deps include `currentAccountEquity`, `optionTimelineAdjustments`, `spotPrices`, `initialBalance`, `displayCurrency` (`PortfolioModule.jsx:415`). `currentAccountEquity = liveAvailableBalance + portfolioValue + totalOptionsValue`, where `portfolioValue` and option P&L are computed from **live** `spotPrices` (`App.jsx:2964-3020` refresh loop; `PortfolioModule.jsx:270, 301-310`).
- The **rightmost anchor is the live equity** (`{t: now, equity: currentAccountEquity}`, `:378`), so as prices tick, "today" moves and re-bases the last segment.
- `chartData` interpolation is by **array index / fixed bucket count** (`:382-414`), not by calendar date — the X-axis is `now − window` divided into `pointCount` steps, so historical *placement* is purely cosmetic relative to real dates.

**Lifecycle:** data → trades (stored trade-time equity) + live portfolio value + live option P&L → anchors → linear interpolation across fixed buckets → render. On every price tick the memo recomputes, re-deriving the entire curve including the live right edge.

---

## 9. How Does Benchmark Comparison Work?

**The benchmark is fabricated.** `benchmarkSeries` (`PortfolioModule.jsx:761-811`):
```js
const drift = benchmarkSymbol === "SPY" ? 0.0008 : benchmarkSymbol === "ACWI" ? 0.0006 : 0.0005;
return chartData.map((point, idx) => {
  const multiplier = Math.pow(1 + drift, idx);   // idx = array position
  const value = startValue * multiplier;          // equity mode
  ...
});
```
- `drift` is a **hardcoded constant**; `idx` is the **point index**, so the benchmark is `initialBalance × (1.0008)^n` — an exponential with **no connection to actual SPY/BTC prices**, no volatility, no real returns.
- "Relative return" (`benchmarkSnapshot.relativePct = totalReturnPct − benchmarkReturnPct`, `PortfolioModule.jsx:71858`) is computed against this fake series.
- The backend snapshot table *has* `benchmark_value`/`benchmark_return` columns but they are **always written NULL** (`portfolioSnapshots.js:282-284`) because "the current Zenin benchmark data (equities_benchmarks.js) is ANNUAL only — there is no daily benchmark series." So even the *correct* path has no daily benchmark feed.

**Verdict:** Benchmark comparison is **mathematically incorrect** today — it compares real portfolio returns against a synthetic constant-drift curve. It would be wrong even if the curve were correct.

---

## 10. Historical Accuracy — Can Yesterday Change Tomorrow?

**Yes, historical-looking values are not immutable in the rendered curve:**

1. **Trade-time equity is mutable.** `account_equity_after` is computed from *current* holding `price` at execute time (`database.js` executeTrade path). The holdings `price` column is updated by live pricing (`App.jsx:3012-3020`). Any reprice of a holding can change the stored `account_equity_after` for **past** trades, which `buildTradeTimeline` then re-reads (`accountMetrics.js:43-61`). → **Historical anchors can drift.**
2. **Live right edge re-bases the last segment.** `{t: now, equity: currentAccountEquity}` (`:378`) forces today; since today is the last anchor, price ticks re-base the previous segment's delta visually.
3. **Recalculation alters historical placement.** Because X-axis is fixed-bucket interpolation (`:382-414`), adding/removing trades changes `pointCount` mapping and shifts how anchors are smoothed — the *shape* of "history" changes with new data.
4. **Importing an exchange does not rewrite prior data** (exchange data isn't in the curve at all — §5), but **importing brokerage fills via `trade_executions` does not rewrite history either** (they're NULL-equity, dropped). The only rewrites come from re-pricing holdings (`account_equity_after`) and live equity.
5. **`portfolio_daily_snapshots` *is* immutable** (`ON CONFLICT DO NOTHING`, `portfolioSnapshots.js:313, 362`) — but the curve doesn't read it, so that immutability is currently unused by the chart.

**Conclusion:** In the *rendered* curve, yesterday **can** change tomorrow (via holding reprice + live right edge). The *snapshot table* would prevent this, but it is not wired to the chart.

---

## 11. Connected Account Synchronization

**What happens when a user connects Binance (or any exchange) today:**
- `POST /api/db/exchange-keys` (`index.js:5100`) stores encrypted key + detected permission scope, records an `account_added` activity event. **No balance/trade/fill/deposit/withdrawal/transfer/funding/staking pull occurs** at connect time or on any scheduler in the exchange-key path.
- The frontend keeps `connectedAccounts` from `localStorage` (`App.jsx:4200-4209`) and shows them in the Connections modal / `WorkspaceScopeSelector`. They are **not** summed into `portfolioValue`, `balance`, `trades`, or `chartData`.

**Aggregation reality:** Portfolio Value = `Σ(manual holding price × qty) + cash + optionsPnL` (`:330-334`). It is **`sum(current manual balances)`**, not `sum(historical balances)`, not `live API values`, not `database snapshots` of connected accounts. Connected accounts are **excluded** from the aggregation entirely.

**Multi-account:** Binance + IB + Hyperliquid + Wallet + Manual → only the **manual** holdings/cash/trades feed the curve. Connected accounts contribute **nothing** to Portfolio Value or the Performance Curve. (Brokerage-synced accounts land in `brokerage_*` tables, also unmerged — §6.)

---

## 12. Time Axis

Each X-axis point is **not** a real calendar timestamp with a value:
- The axis is `start + step × i`, where `step = (now − start)/(points − 1)` and `points` is a **fixed bucket count** per interval (`1D=24 … 1Y=52 … ALL=120`, `PortfolioModule.jsx:340`).
- Anchors are placed at **trade timestamps** and at `now`; between anchors the value is **linearly interpolated** (`:381-414`).
- So the X-axis represents **recalculation buckets**, not Trade / Minute / Hour / Day / Week / Month / Snapshot in any historical sense. There are no real dated daily samples — only trade events + a live endpoint + synthetic bucketing.

This is why the curve's apparent "history" reshapes when trades are added/removed: the bucket count is constant, so anchor spacing changes.

---

## 13. Architecture Diagrams

### 13.1 Architecture Diagram (as built)
```
Performance Curve (ReactApexChart)        PortfolioModule.jsx:795-811
        │
        ├─ Portfolio Series (chartData)     PortfolioModule.jsx:339-415
        │     ├─ tradeTimeline.equity ───► buildTradeTimeline   accountMetrics.js:37-65
        │     │     └─ trades.account_equity_after (stored, trade-time, mutable)
        │     └─ currentAccountEquity ───► liveAvailableBalance + portfolioValue + optionsPnL
        │           portfolioValue ← Σ(price×qty) from user_workspace_portfolio (LIVE)
        │           balance ← user_workspace_cash (LIVE)
        │
        └─ Benchmark Series (SYNTHETIC)     PortfolioModule.jsx:761-811
              initialBalance × (1+drift)^idx   (drift hardcoded; idx = array position)

        Backend (NOT consumed by curve):
        portfolio_daily_snapshots ──► /api/history/* ──► (orphaned; no frontend reader)
```

### 13.2 Data Flow Diagram (ideal vs actual)
```
[Connected Exchange] ──(credentials only)──► user_exchange_keys
        │  (NO live pull)
        ▼
[Database]  user_workspace_trades (account_equity_after, trade-time)
        │
        ▼ GET /api/db/trades
[Holdings] user_workspace_portfolio (current price) ──► Portfolio Value (live)
        │
        ▼
[Performance Curve] = reconstructed equity + live endpoint, interpolated
```
*(No step persists a daily snapshot that the curve reads.)*

### 13.3 Trade Flow Diagram
```
Trade Executed (executeTrade)            database.js executeTrade path
        ▼
Holdings Updated (user_workspace_portfolio.price/qty)
        ▼
Cash Updated (user_workspace_cash)
        ▼
account_equity_after computed (cash + Σ price×qty, LIVE-marked)  ← stored
        ▼
Chart Updated (next render: anchor at trade.t + live right edge)
```

### 13.4 Synchronization Diagram (what exists but is disconnected)
```
[Exchange/Broker] ──(brokerage SyncEngine, SnapTrade only)──► brokerage_* tables
        │
        ▼ (NOT joined into portfolio/trades reads)
[GET /db/portfolio] ── only user_workspace_portfolio
[GET /db/trades]    ── only user_workspace_trades

[EOD Scheduler] index.js:15811 ──► DailySnapshotService.runEod ──► portfolio_daily_snapshots
        │
        ▼
[/api/history/*] ──► (no frontend consumer for the Performance Curve)
```

---

## 14. Data Integrity Audit

| Data class | Immutable | Recomputed | Reconstructed | Synthetic | Missing |
|---|---|---|---|---|---|
| Daily portfolio value (curve) | ❌ | ✅ every render | ✅ from trades+live | — | yes (as dated series) |
| Daily portfolio value (snapshot table) | ✅ | — | — | — | no (table exists, unused) |
| Trade-time equity (`account_equity_after`) | ❌ (live-marked) | — | ✅ at trade time | — | — |
| Benchmark | — | — | — | ✅ hardcoded drift | yes (real series) |
| Historical connected balances | — | — | — | — | ✅ |
| Historical prices | — | — | — | — | ✅ |
| Cash snapshots | ⚠️ trade-time only | — | — | — | ✅ proper EOD |
| Holdings history | ❌ current only | — | — | — | ✅ |
| Deposits/withdrawals ledger | — | — | — | — | ✅ (`user_workspace_cashflows` referenced but absent) |
| Brokerage aggregation into curve | — | — | — | — | ✅ |

**Subjective vs verified:** "The benchmark should be removed or clearly labeled synthetic" is a *recommendation*; "the benchmark is computed as `initialBalance × (1+drift)^idx`" is *verified* (`PortfolioModule.jsx:761-811`).

---

## 15. Institutional Comparison

| Platform | Historical snapshots | Perf. attribution | Daily valuation | Connected sync | Historical equity | Cash tracking |
|---|---|---|---|---|---|---|
| **Bloomberg / Koyfin** | Daily total-return series | Sector/factor | EOD | Feed-dependent | Immutable | Separate |
| **Portfolio Performance** | Transaction-replay daily | Full | EOD | Many brokers | Immutable | Deposit/withdraw txns |
| **Kubera / Snowball Analytics** | Net-worth history | Asset-class | EOD | Manual/API | Immutable | Deposits separated |
| **Interactive Brokers** | Activity-statements | Multi | Real-time+EOD | Native | Immutable | Full ledger |
| **Zenin (curve, today)** | ❌ reconstructed | ❌ | ❌ live-only | ❌ exchanges; ⚠️ brokerage unmerged | ❌ mutable | ❌ no ledger |
| **Zenin (snapshot engine)** | ✅ `portfolio_daily_snapshots` | partial (sector/asset JSON) | ✅ EOD job | ⚠️ brokerage separate | ✅ immutable | ❌ no cashflow table |

**Gap summary vs peers:** (1) no immutable daily equity in the *chart*; (2) benchmark is fabricated; (3) deposits/withdrawals not separated from P&L; (4) connected exchanges contribute nothing; (5) brokerage data not aggregated; (6) no historical price store for true backfill.

---

## 16. Architectural Deficiencies (enumerated)

1. **D-1 — Curve ignores the snapshot table.** `portfolio_daily_snapshots` exists, is written nightly (`index.js:15811-15830`), has read APIs (`index.js:12376-12426`), but the Performance Curve (`PortfolioModule.jsx:339-415`) reads `buildTradeTimeline` + live equity instead. → All immutability work is wasted on this feature.
2. **D-2 — Synthetic benchmark.** `benchmarkSeries` is `initialBalance × (1+drift)^idx` (`PortfolioModule.jsx:761-811`); no real market series; `portfolioSnapshots.js:282-284` confirms no daily benchmark feed.
3. **D-3 — Trade-time equity is live-marked and mutable.** `account_equity_after = cash + Σ(holding.price×qty)` using current `price` (`database.js` executeTrade). Re-pricing holdings rewrites past anchors.
4. **D-4 — Manual-logged & API-imported trades have NULL equity** (`database.js:2722-2738`) → dropped from curve (`accountMetrics.js:55-59`).
5. **D-5 — Live right edge.** `{t: now, equity: currentAccountEquity}` (`:378`) re-bases history on every tick.
6. **D-6 — Fixed-bucket X-axis** (`:340, :382-414`) → not real dates; shape reshapes when trades change.
7. **D-7 — Connected exchanges are credential stores only** (`index.js:5100`); no balance/trade/funding sync into portfolio.
8. **D-8 — Brokerage data not aggregated** into `portfolio`/`trades` reads (`index.js:12297, 12360`; `database.js` `portfolio.getAll` selects only `user_workspace_portfolio`).
9. **D-9 — No historical price store** (no `price_history`/`candles` table) → backfill cannot price holdings at historical close.
10. **D-10 — Missing `user_workspace_cashflows` table** referenced by `portfolioSnapshots.js:158-164` → deposits/withdrawals cannot be captured even by the snapshot engine.
11. **D-11 — No multi-account aggregation layer**; Portfolio Value = manual only (`:330-334`).
12. **D-12 — No valuation service / performance-attribution engine** beyond the partial JSON breakdowns stored in snapshots.

---

## 17. Proposed Architecture (production-grade)

> Recommendations below are **subjective**; the deficient current state above is verified.

1. **Re-point the Performance Curve at `/api/history/*`.** `PortfolioModule.chartData` should fetch `GET /api/history/range?start&end` (or `/daily`, `/monthly`) and plot `portfolio_value` / `daily_return` directly — read-only, immutable. Keep a clearly-labeled **live overlay** for "today" only.
2. **Daily valuation engine** — already present (`portfolioSnapshots.js` `DailySnapshotService`); extend to price holdings at **historical close** via a price-history service (D-9) so backfill is real, not `estimated`.
3. **Connected-account synchronization** — add live balance/fill/history pulls for Binance/Bybit/Hyperliquid (and IB/Alpaca via SnapTrade) that **write into the snapshot pipeline**, not just credential rows.
4. **Historical balance & holdings persistence** — store per-day connected balances and holdings snapshots (separate or within `portfolio_daily_snapshots.holdings_json` + a `connected_balances_history` table).
5. **Daily benchmark snapshots** — wire a real daily benchmark feed (EODHD daily bars exist in `portfolioSnapshots.js:88-100` but only used if `EODHD_API_TOKEN` set and only for equities; extend to BTC and store `benchmark_value`).
6. **Portfolio valuation service** — single service computing equity from (manual + connected + brokerage) aggregated state at a given `asOf` date.
7. **Background snapshot scheduler** — already present (`index.js:15811`); make it also (a) backfill gaps, (b) recompute `estimated` days when a price source becomes available, (c) trigger on every trade/connection event (event-driven + nightly).
8. **Performance attribution engine** — extend stored `sector/country/asset_breakdown` JSON into real time-weighted return (TWR), money-weighted return (MWR), and broker/exchange/cash/sector attribution.
9. **Multi-account aggregation layer** — join manual + connected + brokerage into one `portfolioValue`/`balance`/`trades` source consumed uniformly by the curve.
10. **Time-series storage strategy** — `portfolio_daily_snapshots` (daily) + optional intraday sampling; partition by month; archive.
11. **Historical reconciliation & backfill** — replay trades to close prices; reconcile to latest `account_equity_after` where present; flag `estimated`.
12. **Snapshot integrity verification** — hash/checksum per snapshot; reject mutation; alert on recompute divergence.

---

## 18. Improvement Roadmap

### Phase 1 — Quick wins (stop the bleeding, frontend-only, no schema)
- **Re-point curve to snapshots:** `chartData` reads `/api/history/range`; falls back to current reconstruction only when no snapshots exist.
- **Fix/label benchmark:** either remove the synthetic line or replace `idx`-based drift with a real series fetch (start with EODHD daily close for the selected symbol). Until real, label it explicitly "illustrative."
- **Decouple live "today"** from historical curve: plot historical snapshots as-is; overlay live only on the last point, labeled "LIVE."
- **Carry-forward / flat days** so added/removed trades don't reshape history.

### Phase 2 — Historical snapshots (wire the existing engine to the UI)
- Frontend consumes `/api/history/*` for the curve, calendar, analytics, journal.
- Backfill `portfolio_daily_snapshots` using `POST /api/history/backfill` (`index.js:12442`) once a price-history source exists (D-9).
- Add `user_workspace_cashflows` table (D-10) and populate deposits/withdrawals so P&L ≠ cashflow.

### Phase 3 — Connected-account synchronization & aggregation
- Live pulls for exchanges (balances, fills, funding, staking) → snapshot pipeline.
- Merge brokerage `brokerage_*` into the unified `portfolio`/`trades` read path (D-8).
- Multi-account aggregation layer (D-11).
- Real daily benchmark storage (D-2 fix at the source).

### Phase 4 — Institutional-grade analytics
- TWR / MWR, risk + performance + sector/asset/broker/exchange/cash attribution, benchmark-relative return with real index, reporting/export, AI-ready immutable history.

---

## 19. Acceptance Criteria — answered with evidence

| Criterion | Answer | Evidence |
|---|---|---|
| ✅ What the curve plots today | Reconstructed account equity (trade-anchored + live endpoint) in equity/%/pnl modes; benchmark is synthetic | `PortfolioModule.jsx:339-415, 761-811` |
| ✅ Why it behaves this way | Built from trade-time `account_equity_after` + live equity, interpolated over fixed buckets | `accountMetrics.js:37-65`; `PortfolioModule.jsx:382-414` |
| ✅ Whether historical values are trustworthy | **No** — trade-time equity is live-marked/mutable; live right edge re-bases; buckets reshape | `database.js` executeTrade path; `PortfolioModule.jsx:378` |
| ✅ Whether connected accounts contribute correctly | **No** — exchanges are credentials-only; brokerage unmerged; curve = manual only | `index.js:5100, 12297, 12360`; `database.js` `portfolio.getAll` |
| ✅ How balances are calculated | `liveAvailableBalance + Σ(price×qty) + optionsPnL`; cash from `/db/cash` | `PortfolioModule.jsx:270-334`; `accountMetrics.js:67-99` |
| ✅ How trades update the chart | `executeTrade` stores `account_equity_after` → anchor; manual-log/API imports leave NULL → dropped | `database.js` executeTrade; `:2722-2738`; `accountMetrics.js:55-59` |
| ✅ Where historical data is missing | No dated daily series in curve; no price history; no cashflow ledger; brokerage/exchange unmerged | `database.js` schema scan; `portfolioSnapshots.js:158-164` |
| ✅ What architecture is required | Re-point to `portfolio_daily_snapshots` + real benchmark + connected-account sync + aggregation + attribution | §17 |

---

## 20. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Re-pointing curve to snapshots shows empty history for old accounts | High | Med | Backfill from trades (Phase 2); show reconstruction fallback until backfilled |
| Backfill diverges from user's mental account | Med | High | Reconcile to latest `account_equity_after`; mark `estimated` |
| No price-history store limits true backfill | High | Med | Use EODHD daily; flag `estimated` days |
| Synthetic benchmark misleads users | Med | High | Label or remove until real feed wired (Phase 1) |
| Brokerage merge breaks existing portfolio math | Med | Med | Phase-3 incremental join behind feature flag |

---

## 21. Final Verdict

The Performance Curve **is not yet a true historical portfolio equity curve.** It is a **trade-event-anchored, live-recomputed equity reconstruction** with a **fabricated benchmark overlay**. Its stored trade-time equity is **mutable** (live-marked), its right edge is **live**, and its X-axis is **synthetic bucketing** — so historical-looking values are not trustworthy and the benchmark is mathematically meaningless.

**Crucially, the fix is largely already built:** `portfolio_daily_snapshots` + `DailySnapshotService` + nightly EOD scheduler + `/api/history/*` read APIs all exist and are correctly designed for immutability — they are simply **not read by this chart**. The highest-leverage work is **Phase 1**: re-point `chartData` at `/api/history/range` (with a live-only "today" overlay) and replace the synthetic benchmark with a real series. That alone converts the curve from "reconstructed + fake" to "immutable + real," satisfying the institutional bar without a schema rewrite.

**No code was modified.** This document is the implementation blueprint.

---

### Evidence index (file:line)
- Curve render: `frontend/src/components/PortfolioModule.jsx:795-811` (series), `:339-415` (chartData), `:761-811` (synthetic benchmark), `:270-334` (equity composition), `:378` (live right edge), `:382-414` (bucket interpolation)
- Equity-from-trade: `frontend/src/utils/accountMetrics.js:37-65` (`buildTradeTimeline`), `:67-99` (`calculateAccountSnapshot`), `:9` (`INITIAL_ACCOUNT_BALANCE=10000`)
- Props/state: `frontend/src/App.jsx:6673-6714` (PortfolioModule props), `:2943-2951` (accountMetrics), `:2234-2316` (workspace refresh), `:2164-2189` (`/db/cash`), `:2215-2232` (`/db/trade-executions`), `:4200-4209` (connectedAccounts from localStorage), `:2964-3020` (live price refresh)
- Backend read APIs: `backend/index.js:12297` (`/db/portfolio`), `:12360` (`/db/trades`), `:12457` (`/db/trade-executions`), `:12376-12426` (`/api/history/*`), `:12429` (`/api/history/snapshot/run`), `:12442` (backfill), `:15811-15830` (EOD scheduler)
- Exchange connect (credentials only): `backend/index.js:5100` (`POST /api/db/exchange-keys`)
- Brokerage: `backend/index.js:3929` (`registerBrokerageRoutes`), `backend/brokerage/application/SyncEngine.js`, `backend/brokerage/infrastructure/bootstrap.js` (SnapTrade only), `docs/BROKERAGE_ARCHITECTURE.md`
- Snapshot engine: `backend/portfolioSnapshots.js:1-457` (writer `:250-377`, reader `:384-445`, benchmark-NULL `:282-284`, missing cashflows `:158-164`, immutable `ON CONFLICT DO NOTHING` `:313,:362`)
- Schema: `backend/database.js:1052` (`trade_executions`), `:1467` (`user_workspace_portfolio`), `:1515` (`user_workspace_trades`, `_after` cols `:1538-1540`), `:1984` (`user_exchange_keys`), `:2068-2100` (`portfolio_daily_snapshots`), `:2344/2399/2425` (`brokerage_*`), `:5018-5019` (`snapshots`/`snapshotService` wiring)
- Execute-trade equity write: `backend/database.js` executeTrade path (`account_equity_after = nextCashBalance + portfolioValueAfter`, live-marked `price`)
- Pass-through (NULL equity): `backend/database.js:2722-2738`
