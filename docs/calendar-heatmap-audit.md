# Zenin — Calendar Heatmap: Architecture & Data-Integrity Audit

**Date:** 2026-07-10
**Scope:** Read-only investigation. No code was modified, no fixes applied.
**Method:** Source traced from the React render layer down to the database write path, with every conclusion cited to a file:line.
**Status of feature under audit:** The "Calendar Heatmap" is the *Daily P&L Heatmap* rendered inside `JournalModule.jsx` (kicker "Calendar Heatmap", `journal-debrief-heatmap` panel).

---

## 1. Executive Summary

The Calendar Heatmap does **not** store historical daily portfolio snapshots. It reconstructs a day-by-day equity curve **on every render** by reading the *current* stored `account_equity_after` field off each trade row, then computing daily P&L as a **day-over-day delta between consecutive trade-days**, and **overwriting "today" with the live account equity**.

This produces exactly the reported symptoms:

- **Today's gain "shifts" forward / historical days change** because only *days that have a trade* exist in the map; a non-trading day is simply absent, and the delta is computed between the last trade-day-before and the first trade-day-after — so an equity change that happened on a no-trade day is silently absorbed into whichever trade-day follows, and re-attributed to that later date.
- **"Today" is the live portfolio**, not a close-of-business snapshot (`JournalModule.jsx:1227-1231`), so as prices move intraday the current day's number drifts and, because it is the last point in the delta chain, it also re-bases "yesterday's" delta.
- **Historical values are not immutable**: the stored `account_equity_after` is itself a *trade-time* figure computed from the *current holding prices* in `user_workspace_portfolio` (`database.js:6833`, `:6894`), not a market-close price. Every reload that re-derives it (or any reprice of the holdings table) can change the stored number.

Three structural facts make drift inevitable:
1. There is **no daily snapshot table** anywhere in the schema (verified against all `CREATE TABLE IF NOT EXISTS` in `backend/database.js`).
2. `account_equity_after` is only ever populated by the `executeTrade` path (`database.js:6835-6894`); the API-import `trade_executions.add` is a pure pass-through (`database.js:2736-2738`) and leaves it `NULL`. Manual logs therefore produce days with `equity = null` → **dropped** from the calendar.
3. Daily P&L is a *derived* delta (`JournalModule.jsx:1234-1241`), never stored, recomputed every render, and only between trade-days.

**Verdict:** The feature is fundamentally an execution-log equity chart mislabeled as a portfolio journal. It must be re-architected around **immutable end-of-day snapshots** (Option B) to meet the product spec. Details, proof, and a phased plan follow.

---

## 2. Architecture Diagram (as built)

```
JournalModule.jsx  (Calendar Heatmap panel :2405-2490, :2812)
│  props: trades, portfolio, balance, accountEquity
│
├─ calendarPnlByDate  useMemo  (:1204)
│   ├─ executionRows   useMemo  (:499)  ← sorts trades, derives positionAfter
│   │     └─ source: props.trades
│   ├─ equityByDate: Map<dateKey, equity>
│   │     ├─ per trade: trade.accountEquityAfter
│   │     │     └─ buildTradeTimeline()  utils/accountMetrics.js:43-61
│   │     │           └─ reads trade.accountEquityAfter ?? (balanceAfter+portfolioValueAfter)
│   │     └─ TODAY: totalAccountEquity (LIVE)  JournalModule.jsx:1227-1231
│   └─ pnlByDate: day-over-day delta of equityByDate  (:1234-1241)
│         prevEquity starts at 10000 (:1235)
│
├─ analytics  useMemo  (:622)  → realizedTrades (symbol-filtered fallback :1247-1257)
└─ totalAccountEquity  (:1080) = accountMetrics.totalAccountEquity (LIVE prop)
        = accountEquity prop ?? (balance + live portfolio value)

App.jsx:6763 <JournalModule trades={trades} accountEquity={accountMetrics.totalAccountEquity} />
   │
   ├─ trades ← normalizeTradeRecord() (:1097-1129) ← GET /api/db/trades
   └─ accountMetrics = calculateAccountSnapshot(...)  utils/accountMetrics.js:78-100
         └─ buildTradeTimeline(trades) (:85)
               └─ equity per trade from trade.accountEquityAfter

GET /api/db/trades  backend/index.js:12360
   └─ userWorkspace.trades.getAll  backend/database.js:5244 → SELECT FROM user_workspace_trades
         └─ returns account_equity_after (backend/database.js:2711 mapping)

WRITE of account_equity_after:
   POST /api/db/execute-trade  backend/index.js:15070
      └─ userWorkspace.trading.executeTrade  backend/database.js:6555
            └─ INSERT user_workspace_trades (:6835)
                  account_equity_after = nextCashBalance + portfolioValueAfter  (:6894)
                  portfolioValueAfter = Σ(holding.price × qty)  ← CURRENT holding price (:6833)
```

---

## 3. Data Flow Diagram (one day, rendered)

```
[Market data / user action]
        │
        ▼
executeTrade()  backend/database.js:6555
        │  computes account_equity_after = cash + Σ(holding.price × qty)
        │  holding.price = LIVE price in user_workspace_portfolio (not close price)
        ▼
INSERT user_workspace_trades(account_equity_after = <value>)   ← STORED, mutable
        │
        ▼  (later) GET /api/db/trades → row.account_equity_after
        ▼
normalizeTradeRecord()  App.jsx:1099,1128
        ▼
JournalModule calendarPnlByDate  (:1204)
        │  equityByDate.set(tradeDay, trade.accountEquityAfter)
        │  equityByDate.set(TODAY, LIVE totalAccountEquity)   ← OVERWRITE (:1230)
        ▼
pnlByDate[day] = equity[day] − equity[prevTradeDay]   ← DELTA, recomputed every render
        ▼
calendarCells map → heatmap cell pnl  (:1268-1274, :2417-2435)
```

---

## 4. Source of Truth Analysis

For each metric the calendar displays, where it comes from:

| Metric | Source | Stored or Calculated | Evidence |
|---|---|---|---|
| **Daily P&L** | `pnlByDate[day] = equity[day] − equity[prevTradeDay]` | **Calculated**, never stored | `JournalModule.jsx:1234-1241` |
| **Portfolio Value (day)** | `trade.accountEquityAfter` (or `balanceAfter+portfolioValueAfter`) | Stored per trade, but trade-time | `accountMetrics.js:43-61`; `database.js:6894` |
| **Daily %** | Not directly shown on heatmap; stats use `monthPnL` sum | Calculated | `JournalModule.jsx:1527` |
| **Holdings** | `user_workspace_portfolio` (current) | Stored, but **current** not historical | `database.js:6833` |
| **Allocation** | Derived from current `portfolio` prop | Calculated (current) | `App.jsx:2880` |
| **Cash** | `user_workspace_cash.balance` / `account_equity_after` | Stored, but trade-time | `database.js:6842,6892` |
| **Benchmark** | **Not present** in heatmap | — | (no benchmark lookup in `:1204`) |
| **Decisions** | `decision_threads` table (separate) | Stored, unrelated to heatmap | `backend/database.js:2067` |
| **Journal entries** | `journal:entries` (workspace collection) | Stored, separate | `JournalModule.jsx:240` |
| **Deposits/withdrawals** | **Not modeled** | — | no cash-flow rows in calendar path |
| **Notes / Corporate actions / Dividends / Tax events / Research / Predictions / Options expiration** | **Not present** in calendar path | — | absent from `:1204` |

Key conclusion: **The only value the calendar plots is a derived day-over-day delta of a trade-time equity figure, with the last day forced to the live equity.** Everything else the product spec asks for (holdings/allocation/benchmark/decisions/deposits per day) is either absent or read from *current* state.

---

## 5. Root Cause Analysis (proven)

### RCA-1 — Daily P&L is a delta between *trade-days*, not a value per calendar day
`calendarPnlByDate` builds `equityByDate` only from trades, then walks the sorted unique dates computing `eq − prevEquity` (`JournalModule.jsx:1233-1241`). Non-trading days are absent, so the delta "jumps" from the last trade-day to the next trade-day. Any equity change on a no-trade day is **attributed to the later trade-day**. This is precisely *"today's gain appears to move into the next active day."*
**Proof:** `equityByDate` is populated solely in the `for (const trade of sorted)` loop (`:1212-1225`) and the today-overwrite (`:1227-1231`); no entry is ever created for a date without a trade. The delta loop (`:1236-1241`) then only connects existing points.

### RCA-2 — "Today" is overwritten with the *live* equity
`equityByDate.set(todayKey, Number(totalAccountEquity))` (`:1229-1230`) forces the most recent point to the current portfolio value. `totalAccountEquity` is the live `accountEquity` prop or `balance + livePortfolioValue` (`JournalModule.jsx:1080-1082`; `App.jsx:2880` uses `spotPrices` = live prices). Because today is the right edge of the delta chain, intraday price movement:
(a) changes today's own cell, and
(b) re-bases yesterday's delta (yesterday = prevEquity for today's delta), so **historical-looking days visibly change every time the price ticks**.
**Proof:** `:1227-1231` unconditionally overwrites today; `totalAccountEquity` depends on live `spotPrices` (`App.jsx:2854-2880`).

### RCA-3 — The stored "equity" is trade-time, not close-of-day, and is mutable
`executeTrade` writes `account_equity_after = nextCashBalance + portfolioValueAfter` where `portfolioValueAfter = holdings.reduce(price×qty)` using `h.price` from `user_workspace_portfolio` (`database.js:6833`, `:6894`). `h.price` is the *current* marked price of the holding, which is updated by live pricing. There is no close-of-day capture. Therefore the stored `account_equity_after` for past trades can change whenever the holding price is refreshed, and the calendar re-derives from it on every load.
**Proof:** `:6833` uses `toNumber(h.price)` (current); `:6894` stores the sum. No `close_price`/`eod_price` column exists.

### RCA-4 — `account_equity_after` is frequently NULL for non-executed trades → those days vanish
The API-import path `trade_executions.add` (`database.js:2722-2738`) is a pure pass-through: it stores whatever `balanceAfter/portfolioValueAfter/accountEquityAfter` the caller sends, defaulting to `null`. Manual trade logging and brokerage auto-imports do not compute equity. `buildTradeTimeline` then sets `equity = null` for those rows (`accountMetrics.js:55-59`), and `calendarPnlByDate` skips `!Number.isFinite(eq)` (`:1238`). **Result:** days with only imported/manual trades contribute no cell, further fragmenting the timeline and shifting deltas.
**Proof:** `database.js:2736-2738`; `accountMetrics.js:55-59`; `JournalModule.jsx:1238`.

### RCA-5 — No timezone normalization for date keys
`toDateKey` (`:18-24`) uses local `getFullYear/getMonth/getDate` of the browser. `executionRows` likewise keys by local date. The server stores `executed_at` as an ISO timestamp. A trade executed late in the user's day can map to a different calendar date than the server's, and two users in different timezones see different "same-day" groupings. This is a secondary but real integrity gap.
**Proof:** `:18-24`; server stores ISO `executionTimestamp` (`database.js:6565`).

### Hypotheses (not fully provable from static source)
- **"Weekend carries Friday's close"** — Currently *not* handled; a Saturday/Sunday simply has no trade so no cell; there is no logic to carry Friday's equity forward as a flat day. Stated as a gap, not a bug.
- **Market-holiday handling** — None. No trading-calendar lookup exists in the calendar path.

---

## 6. Historical Integrity Audit

| Metric | Stored | Calculated | Missing |
|---|---|---|---|
| Daily portfolio snapshot | ❌ | ✅ (derived) | Yes — no `daily_snapshots` table |
| Daily holdings snapshot | ❌ | ✅ (current only) | Yes |
| Daily allocation snapshot | ❌ | ✅ (current only) | Yes |
| Daily cash snapshot | ⚠️ (trade-time only) | — | Yes (proper EOD cash) |
| Daily benchmark snapshot | ❌ | — | Yes |
| Daily performance snapshot | ❌ | ✅ (delta, not stored) | Yes |
| Daily prices (close) | ❌ | — | Yes (only live `spotPrices`) |
| Decisions per day | ✅ (separate table) | — | Linked, not in heatmap |
| Journal per day | ✅ (collection) | — | Linked, not in heatmap |
| Deposits / withdrawals | ❌ | — | Yes (no cashflow ledger) |

**Conclusion:** Zenin does **not** store historical daily portfolio state. The calendar is reconstructed every render from trade-time equity figures plus the live equity for today. Historical integrity is therefore structurally impossible in the current design.

---

## 7. Database Audit

Tables inspected (`backend/database.js`):

- `user_workspace_trades` (:1514) — columns include `balance_after`, `portfolio_value_after`, `account_equity_after` (`:1537-1539`), `executed_at`, `position_after`. **Granularity: per trade.** No date-only uniqueness, no EOD concept. Indexes: `user_workspace_trades(workspace_id, executed_at DESC, id DESC)` (:1884) and `(workspace_id, client_id)` (:1863).
- `trade_executions` (:1051) — brokerage auto-imports; same three `_after` columns (:1069-1071) but populated as pass-through only.
- `user_workspace_portfolio` (:1466) — current holdings with `price` (live-marked). Source of the "current" portfolio value.
- `user_workspace_cash` (:1437) / `user_workspace_balance` (:1429) — current cash.
- No `daily_*`, `snapshot`, `eod`, or `portfolio_history` table exists (full `CREATE TABLE` scan returned none matching those terms).

**Does the schema support immutable history?** No. The three `*_after` columns are trade-scoped and mutable (they can be recomputed/overwritten via the execute path). There is no notion of a date key, no close price, no deposit/withdrawal ledger, no benchmark store.

**What must be added (target schema):**
```sql
CREATE TABLE daily_portfolio_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  snapshot_date DATE NOT NULL,            -- market date (timezone-normalized)
  close_equity  DOUBLE PRECISION NOT NULL,
  cash          DOUBLE PRECISION,
  holdings_value DOUBLE PRECISION,
  benchmark_value DOUBLE PRECISION,
  deposit       DOUBLE PRECISION DEFAULT 0,
  withdrawal    DOUBLE PRECISION DEFAULT 0,
  daily_pnl     DOUBLE PRECISION,          -- stored, immutable after close
  daily_pct     DOUBLE PRECISION,
  source        TEXT,                      -- 'eod-job' | 'recompute'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, snapshot_date)
);
-- plus holdings/allocation snapshot table keyed by (snapshot_date, asset)
```

---

## 8. Backend Audit (endpoints powering the calendar)

| Endpoint | Purpose | Historical logic | Issue |
|---|---|---|---|
| `GET /api/db/trades` (`index.js:12360`) | List trades → calendar source | returns `account_equity_after` as stored | only populated for executed trades |
| `POST /api/db/execute-trade` (`index.js:15070`) | Record executed trade | computes `account_equity_after = cash + Σ(price×qty)` at trade time | uses **current** holding price, not EOD; overwrites nothing historical but the figure is trade-time |
| `POST /api/db/trades` (`index.js:12438`, `tradeLogSchema`) | Manual trade log | delegates to `trade_executions.add` pass-through | **never computes equity → NULL → day dropped** |
| `GET /api/db/trade-executions` (`index.js:12369`) | Brokerage imports | separate table, equity NULL | not even surfaced to calendar |

**Sorting / Timezone / Grouping:** trades are sorted by `executed_at` timestamp (`JournalModule.jsx:1206-1210`, `accountMetrics.js:40`); grouping is by local-date key (`toDateKey`). No server-side daily grouping endpoint exists — all daily aggregation happens client-side.

**Caching:** `invalidateRuntimeSnapshotsByPrefix("app-bootstrap")` (`index.js:15077`) is the only cache invalidation; trades themselves are not cached, but `accountMetrics` is a `useMemo` in App (`accountMetrics.js`) recomputed from props.

---

## 9. Frontend Audit

- **State reused as historical:** `totalAccountEquity` (live) is forced into the "today" cell (`JournalModule.jsx:1229-1230`). This is current-state reused as a historical row.
- **Derived state:** `calendarPnlByDate` (`useMemo`, deps `analytics.realizedTrades, selectedSymbols, executionRows, totalAccountEquity` `:1258`) — recomputed whenever live equity changes; memoization does not prevent drift, it just avoids redundant recompute within a render.
- **Mutation:** No direct object mutation found in the calendar path (uses `Map.set` on fresh maps). The "drift" is a *semantic* reuse of live data, not an accidental mutation.
- **Effects:** none driving the heatmap directly; data flows from props → memos.
- **Rendering:** `calendarCells` (`:1268-1274`) maps every day of the month; `pnl` is `null` for non-trade days → rendered as `—` (`:2432`). Month stats (`:2437-2442`) sum only finite in-month values.

---

## 10. Date Handling Audit

- **UTC vs local:** `toDateKey` uses **local** browser date parts (`:18-24`). `executionRows` sorts by full `new Date(...).getTime()` then keys locally. Server stores ISO `executed_at` (`database.js:6565`). Mismatch possible across timezones.
- **ISO strings:** trades may carry `executedAt` as ISO or `date` as `YYYY-MM-DD`; both handled (`toDateKey:20` short-circuits ISO date, else parses).
- **Start/end-of-day:** not used; the calendar keys by calendar day only.
- **DST:** `getDate()` is DST-safe in the sense it returns the local calendar day, but a trade near midnight can straddle a date boundary differently from the server.
- **Weekend / holidays / sessions:** **No handling.** No trading calendar, no holiday table, no session logic in the calendar path.

---

## 11. Performance Audit

- `calendarPnlByDate` iterates all `executionRows` + builds maps + sorts + walks dates on every change to `totalAccountEquity` (which changes on every live-price tick via `App.jsx:2854-2880`). Deps include `totalAccountEquity` (`:1258`), so **any live price update recomputes the entire equity curve**.
- `analytics` (`useMemo`, `:622`) also recomputes on `trades` change — independent of the heatmap but heavy.
- `calendarCells` is `O(daysInMonth)` — cheap. The cost is the upstream `executionRows` sort + `equityByDate` build, which is `O(trades log trades)` per live tick.
- **Opportunity:** decouple "today" from the historical curve (snapshot today once at EOD), memoize on `trades` + a frozen `asOfDate` rather than live equity, and compute the curve in a web worker / backend job. With immutable snapshots (Phase 2) the frontend becomes a pure read.

---

## 12. Product Review

The spec wants a portfolio journal: each cell = immutable snapshot answering value, P&L, %, holdings, allocation, cash, benchmark, decisions, deposits/withdrawals, notes, journal.

Comparisons:
- **Bloomberg / Koyfin:** performance calendar = daily total return vs benchmark, click → day detail.
- **Snowball Analytics / Kubera:** net-worth history with deposits/withdrawals separated so returns aren't inflated by cashflows.
- **Portfolio Performance (desktop):** transaction-based with explicit "deposit/withdrawal" transactions and per-day valuations.

**Zenin gaps vs. peers:**
1. No separation of **deposits/withdrawals** from P&L (a deposit would show as a "gain").
2. No **benchmark** line (spec asks for it).
3. No **holdings/allocation** drill-down per day.
4. Days with no trade are blank rather than carrying the prior close (peer tools show a flat day).
5. "Today" is live, not closed — violates the "immutable after close" rule.

**Recommended scope (high value, low complexity):** daily close equity + daily P&L + daily % vs benchmark + deposits/withdrawals separated + click-day → snapshot detail (holdings/cash at that date). Defer corporate actions / dividends / options-expiry overlays to a later phase.

---

## 13. Recommended Architecture — Option B (immutable daily snapshots)

| Option | Description | Pros | Cons |
|---|---|---|---|
| A — Recompute from transactions every render | Derive history from trades + live prices | No new storage | Re-introduces all drift bugs; needs a full pricing engine; slow; never immutable |
| **B — Persist immutable EOD snapshots** | Nightly/event job writes one row per `(workspace, date)` at market close; calendar reads it | Truly immutable; fast reads; supports deposits/withdrawals/benchmark; trivially regression-testable; fixes every reported symptom | New table + backfill job + migration |
| C — Hybrid | Snapshots + recompute fallback for gaps | Flexible | Complexity of two code paths; risk of divergence |

**Recommendation: Option B.** It is the only design that satisfies "tomorrow never rewrites yesterday." Backfill historical rows by replaying trades up to each date's EOD using the *close* price for that date (from a price history service), and stamp `source='recompute'`; thereafter a scheduler stamps `source='eod-job'`.

---

## 14. Implementation Plan (phased, no code written yet)

### Phase 1 — Critical bug fix (stop the bleeding)
- **Files:** `JournalModule.jsx` (`calendarPnlByDate`, `:1204-1258`), `utils/accountMetrics.js`.
- **Backend:** none required for the stopgap.
- **Change:** (a) Stop overwriting "today" with live equity for *historical* months — only the current month's latest cell may reflect live, and label it "live". (b) Carry the last known equity forward across non-trading days so deltas don't jump (flat days). (c) Treat `account_equity_after === null` as "use carried-forward", not "drop day".
- **Migration risk:** Low (frontend-only, display semantics).
- **Testing:** regression checklist below; assert a no-trade day between two trade-days shows 0 P&L, not a jump.

### Phase 2 — Historical snapshot infrastructure (the real fix)
- **DB:** add `daily_portfolio_snapshots` (+ holdings snapshot table) per §7.
- **Backend:** `POST /api/db/snapshots/eod` job (scheduler + manual trigger); `GET /api/db/snapshots?from&to` returning immutable rows; backfill script replaying trades to close prices.
- **Frontend:** `JournalModule` reads `GET /api/db/snapshots`; heatmap plots `daily_pnl` directly; "today" = latest snapshot + optional live overlay clearly marked.
- **Migration risk:** Medium — backfill must reconcile with existing `account_equity_after` where present.
- **Testing:** snapshot row immutability (update attempt is rejected / no-op); backfill matches manual recompute within tolerance.

### Phase 3 — Performance
- Memoize on `asOfDate` snapshot, not live equity; move curve build off the render path; virtualize year view.
- **Testing:** no recompute on live-price tick when viewing historical month.

### Phase 4 — Advanced analytics
- Benchmark %, deposits/withdrawals separation, per-day holdings/allocation drill-down, corporate-action/dividend overlays, options-expiry markers.
- **Testing:** deposit does not appear as P&L; benchmark delta independent of equity.

---

## 15. Regression Checklist (post-fix)

- [ ] Yesterday never changes after today's prices move
- [ ] A no-trade day between two trade-days shows 0 P&L (carries prior close), not a jump
- [ ] Weekend carries Friday's close as a flat day
- [ ] Deposits affect only the deposit day's cash, not P&L
- [ ] Withdrawals reduce equity without showing as a loss
- [ ] Historical allocations remain identical across reloads
- [ ] Reload does not alter any historical day
- [ ] New market prices do not rewrite previous days (snapshots immutable)
- [ ] Different timezones render the same historical values (date normalized to market TZ)
- [ ] Leap years work (Feb 29 cell present in leap year)
- [ ] Month boundaries work (Jan 31 → Feb 1 continuous)
- [ ] Portfolio reset works (equity restarts from new initial balance)
- [ ] Multi-account portfolios remain correct (per-workspace snapshot)
- [ ] Multiple exchanges remain correct (snapshot is currency-normalized)
- [ ] Days from imported/manual trades are not dropped when equity is absent

---

## 16. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Backfill diverges from user's mental account | Med | High | Reconcile to latest `account_equity_after`; show "recomputed" badge |
| Price-history gaps for backfill | Med | Med | Use last available close; flag incomplete days |
| Scheduler misses EOD (server downtime) | Low | Med | Idempotent catch-up job on boot |
| Snapshot table growth | Low | Low | Partition by month / archive |
| Live "today" overlay confused with closed day | Med | Low | Explicit "LIVE" label + different tone |

---

## 17. Final Verdict

The Calendar Heatmap is **not a historical journal** — it is a trade-execution equity delta chart that (a) only has points on trade-days, (b) forces the last point to the live portfolio, and (c) derives its per-day numbers from trade-time equity figures that themselves depend on current holding prices. Every reported symptom ("gain moves to next active day", "historical days change", "represents current state") is a **direct, provable consequence** of these design choices (RCA-1…RCA-4, each cited to source).

**No code change was made.** The fix requires adopting **immutable end-of-day snapshots (Option B)** as described in Phase 2, preceded by the Phase 1 display stopgap. Until then, the calendar should not be relied upon as a record of historical daily performance.

---

### Evidence index (file:line)
- Heatmap panel: `frontend/src/components/JournalModule.jsx:2405`, `:2812`
- Core calc: `JournalModule.jsx:1204-1258` (equityByDate, today-overwrite `:1227-1231`, delta `:1234-1241`, initial 10000 `:1235`)
- Date key: `JournalModule.jsx:18-24` (local-time)
- Live equity: `JournalModule.jsx:1080-1082`; `App.jsx:2854-2880` (spotPrices)
- Trade normalization: `App.jsx:1097-1129`
- Equity-from-trade: `frontend/src/utils/accountMetrics.js:43-61`, `:78-100`
- Backend write (computed equity): `backend/database.js:6833`, `:6835-6894` (`account_equity_after = cash + Σ price×qty`)
- Backend pass-through (NULL equity): `backend/database.js:2722-2738`
- Endpoints: `backend/index.js:12360`, `:12438`, `:15070`
- Schema (no snapshot table; `*_after` columns): `backend/database.js:1051, 1466, 1514, 1537-1539`
