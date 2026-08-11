# Zenin — Execution Log Empty-Row / Phantom Execution Audit Report

## 1. Executive Summary

### 1.1 What is the blank row?

The blank row is a **valid transaction record** from the connected account's source sync that passes all frontend filters in `HomeModule.jsx`'s `recentActivityRows` `useMemo` but renders as an empty/blank row in the Execution Log table. The record carries a valid timestamp (producing the same `2026-08-05 09:53` timestamp as adjacent rows), a valid symbol (e.g., "ASTER"), and a valid positive notional.

However, the **primary visible mechanism** enabling blank rows to render is a **`useMemo` stale-closure bug** in `HomeModule.jsx:2076`, where the dependency array `[trades]` omits `unifiedPortfolio`. When `unifiedPortfolio.transactions` updates (every 60 seconds via `useUnifiedPortfolio` auto-refresh), the memo does NOT recalculate, causing the Execution Log to render stale data. When it does eventually recalculate (triggered by a `trades` change), it reads from a `unifiedPortfolio` reference that may be in a transitional state.

### 1.2 Is it data or rendering?

**BOTH** — data integrity + state management + rendering amplification:
- **Data**: The `type` field mapping in `unifiedPortfolio.js:452` (`type: t.side || t.type || "trade"`) corrupts the transaction type for all synced fills, setting it to "buy"/"sell" instead of "trade"/"fill". This causes downstream cash-flow extraction to misclassify every fill.
- **State**: The `useMemo` dependency omission at `HomeModule.jsx:2076` causes stale data rendering and potential data-source switching mid-stream.
- **Rendering**: The `DataTable` virtualization with `overscan: 12` and `rowHeight: 44` (`DataTable.jsx:107,62`) amplifies the visual impact of any invalid rows that survive filtering.

### 1.3 Exact root cause

**Primary (Rendering/State)**: `useMemo` dependency omission in `HomeModule.jsx:2076` — the `recentActivityRows` `useMemo` depends on `[trades]` only but reads from `unifiedPortfolio` (line 2007). When `unifiedPortfolio.transactions` updates (60s auto-refresh cycle), the memo does NOT recalculate, so the Execution Log renders stale data from the previous calculation. When it does recalculate (due to a `trades` change), it may switch data sources (from bootstrap `trades` to `unifiedPortfolio.transactions`) without proper reconciliation, creating rows with mismatched schemas.

**Secondary (Data)**: `type` field mapping corruption in `unifiedPortfolio.js:452` — `type: t.side || t.type || "trade"` sets the transaction `type` to the fill's `side` value ("buy"/"sell") instead of the correct type. This affects ALL broker/exchange sources (Hyperliquid, Binance, Bybit, IBKR) since they all go through `mapExchangeWalletToSource`.

**Tertiary (Database)**: SQL `UNION ALL` LIMIT bug in `getUnifiedTransactions` (`unifiedPortfolio.js:1496-1513`) — the `LIMIT $2` clause only applies to the first sub-query (non-Polymarket). The second sub-query (Polymarket) has no LIMIT, and there is no outer LIMIT wrapping the entire `UNION ALL`.

### 1.4 Where is it introduced?

1. **Data introduction**: `mapExchangeWalletToSource()` at `unifiedPortfolio.js:452` — corrupts the `type` field for all exchange/wallet source transactions
2. **SQL/Query introduction**: `getUnifiedTransactions()` at `unifiedPortfolio.js:1496-1513` — broken LIMIT causes unbounded Polymarket results
3. **State introduction**: `HomeModule.jsx:2006-2076` — `useMemo` dependency omission causes stale rendering

### 1.5 Why does it reach the UI?

1. The backend SQL query (`getUnifiedTransactions`) returns transactions with potentially NULL `symbol` and NULL `notional` fields (from `portfolio_source_transactions` where these columns are nullable per the schema at `database.js:108-124`)
2. The `recentActivityRows` filters at `HomeModule.jsx:2015-2026` catch most NULL/zero cases, but the `useMemo` dependency omission (`[trades]` only) means the filter logic does NOT re-run when `unifiedPortfolio` changes — stale data with partially invalid records persists
3. When the memo does recalculate (due to `trades` change), it can switch data sources between bootstrap `trades` (from `user_workspace_trades`, where `asset` is NOT NULL) and unified `transactions` (from `portfolio_source_transactions`, where `symbol` IS nullable) — the different schemas can produce rows that pass filters but render with minimal/empty visible content
4. The `DataTable` virtualization (`DataTable.jsx:221-236`) with `overscan: 12` and fixed `rowHeight={44}` ensures any surviving blank rows occupy visible vertical space

### 1.6 Is connected-account ingestion involved?

**YES**. The Hyperliquid sync pipeline (`exchangeSync.js:237-345`) produces fills via `buildTradeAndFillRecord()` (line 75-159), which are mapped by `mapExchangeWalletToSource()` (line 397-452) into `portfolio_source_transactions`. The `type` field corruption at line 452 affects ALL source types: Hyperliquid, Binance, Bybit, IBKR, Polymarket, SnapTrade.

### 1.7 Is canonical/unified portfolio data involved?

**YES**. The unified portfolio transactions endpoint (`/api/portfolio/unified/transactions`, `index.js:13668-13677`) returns data from `getUnifiedTransactions()` (`unifiedPortfolio.js:1496-1531`). The SQL query selects ALL transaction types without filtering out NULL symbols or zero/NULL notionals — it relies entirely on the frontend filter.

### 1.8 Is the API involved?

**YES**. The `/api/portfolio/unified/transactions` endpoint (`index.js:13668-13677`) calls `getUnifiedTransactions(pool, workspaceId, limit)` and returns the raw result without sanitization. NULL columns from the database pass through as `null` in the JSON response.

### 1.9 Is the frontend involved?

**YES** (primary). The `HomeModule.jsx` `recentActivityRows` `useMemo` (lines 2006-2076) has the dependency omission. Additionally, the row mapper at line 2050 uses `trade?.asset || trade?.symbol || "—"` which can produce `"—"` for records where both fields are null/undefined — but the filter at line 2019-2021 catches this case. The primary frontend issue is the `useMemo` dependency omission causing stale rendering.

### 1.10 Is CSS involved?

**NO** (directly). The CSS is correct — the blank row renders because the data object exists and passes the filters. The `rowHeight: 44` fixed height (`DataTable.jsx:62`, `HomeModule.jsx:3253`) and `border-collapse` (`styles.css:819-848`) ensure the row has visible height. The issue is data/state, not styling.

### 1.11 What is the severity?

**P1 — High**. The blank row creates incorrect visual representation of execution history, wastes vertical space, and the underlying `type` field corruption affects cash-flow extraction and financial calculations (TWR/MWR).

### 1.12 Does it affect financial calculations?

**YES** — the `type` field corruption (setting type to "buy"/"sell" instead of "trade"/"fill") causes the cash-flow extraction at `unifiedPortfolio.js:800-809` to incorrectly classify ALL fills as cash flows, polluting `portfolio_cash_flows` with false entries. This affects TWR/MWR calculations in the portfolio snapshot engine.

### 1.13 Recommended implementation path

1. **Fix `useMemo` dependencies**: Add `unifiedPortfolio` to the dependency array at `HomeModule.jsx:2076`
2. **Fix `type` field mapping**: Change `unifiedPortfolio.js:452` from `type: t.side || t.type || "trade"` to `type: t.type || "trade"`
3. **Fix SQL `UNION ALL` LIMIT**: Wrap the UNION ALL in a subquery with LIMIT, or add LIMIT to both sub-queries at `unifiedPortfolio.js:1496-1513`
4. **Add defensive validation**: Add a filter in `recentActivityRows` that rejects rows where ALL display fields (symbol, instruction, notional, status) are simultaneously empty/placeholder, at the mapper level

---

## 2. Screenshot / Behavior Analysis

**Observed behavior**: A valid FILLED execution row (ASTER, BUY_MKT, $127.87, FILLED) is displayed, followed by an apparently empty/blank row, followed by additional valid execution rows (ASTER, BUY_MKT, $559.94, FILLED). The blank row occupies actual vertical row space (44px, the fixed `rowHeight`).

**Key observations**:
- All rows share the same timestamp (2026-08-05 09:53)
- Valid rows show symbol, instruction, notional, and status
- The blank row shows none of these — no timestamp, no symbol, no instruction, no notional, no status
- The blank row is an actual `<tr>` element with `<td>` cells (border-bottom visible per `styles.css:819-862`)
- This is from the **Home dashboard** Execution Log panel (not Journal, not Portfolio tab)
- The screenshot shows ASTER — an ASTERIX perpetual on Hyperliquid (connected account: `demo@zenin.local` with real Hyperliquid wallet `0x8def...`)

**Behavioral clue**: The repeated entries (ASTER, BUY_MKT) at the same timestamp suggest multiple fills of the same order at similar prices — consistent with Hyperliquid's `userFills` API returning individual fills.

---

## 3. Exact Execution Log Component

| Field | Value |
|-------|-------|
| Component | `HomeModule.jsx` |
| Execution Log Panel | Lines 3230-3259 |
| Data Array | `recentActivityRows` (useMemo, lines 2006-2076) |
| Render Component | `DataTable` (`DataTable.jsx:53`) |
| Virtualization | `@tanstack/react-virtual` (`DataTable.jsx:102-108`) |
| Row Height | 44px (`DataTable.jsx:62` + `HomeModule.jsx:3253`) |
| Overscan | 12 items (`DataTable.jsx:107`) |
| Page/Module | Home dashboard (not Journal, not Portfolio) |
| Route | `/` (Home) |

### Component Hierarchy

```
App.jsx
  └─ HomeModule (trades, unifiedPortfolio, ...props)
     └─ recentActivityRows (useMemo) — THE BUG IS HERE (deps [trades] only)
     └─ DataTable (data={recentActivityRows}, virtual=true, rowHeight=44)
        └─ useVirtualizer (overscan=12, count=rows.length)
        └─ useReactTable (getCoreRowModel, getSortedRowModel, getFilteredRowModel)
           └─ Table > TableHeader > TableBody > TableRow > TableCell
              └─ Column cell renderers (timestampLabel, symbol, instruction, value, status)
```

---

## 4. Component Hierarchy (Detailed)

### Home Dashboard Execution Log

- **App.jsx:7909-7921**: Renders `<HomeModule trades={trades} unifiedPortfolio={unified} ... />`
- **HomeModule.jsx:163-188**: Component signature with `trades = []` and `unifiedPortfolio = null` defaults
- **HomeModule.jsx:2006-2076**: `recentActivityRows` useMemo — **THE BUG IS HERE** (dependency array `[trades]` omits `unifiedPortfolio`)
- **HomeModule.jsx:3233**: `<h2>Execution Log</h2>` heading
- **HomeModule.jsx:3238-3258**: `DataTable` with `data={recentActivityRows}`, `virtual`, `rowHeight={44}`
- **HomeModule.jsx:3242-3246**: Column definitions:
  - `timestampLabel` → `<span>{row.timestampLabel}</span>`
  - `symbol` → `<strong>{row.symbol}</strong>`
  - `instruction` → `<span>{row.instruction}</span>`
  - `value` (Notional) → `<span>{row.value > 0 ? formatMoney(row.value) : "--"}</span>`
  - `status` → `<span className="home-exec-status {row.tone}">{row.status}</span>`
- **DataTable.jsx:53-252**: Reusable TanStack Table wrapper with virtualization
- **DataTable.jsx:220-242**: Virtual row rendering: `virtualRows.map((vr) => rows[vr.index])`
- **DataTable.jsx:107**: `overscan: 12` — renders 12 extra rows beyond visible viewport
- **DataTable.jsx:62**: `rowHeight = 40` default (overridden to 44 by HomeModule)
- **table.jsx:54-64**: `TableRow` — `<tr>` with `border-b` (visible even for empty rows)
- **table.jsx:80-91**: `TableCell` — `<td>` with padding (allocates visible space)

### Related Execution Log Components (NOT the screenshot's component)

- **JournalModule.jsx:1972-1991**: `allTradeLogRows` + `tradeLogRows` — separate Journal feature, NOT the screenshot
- **PortfolioModule.jsx:562-585**: `apiExecutionRows` — Portfolio tab Execution view, NOT the screenshot
- **ExecutionModule.jsx:15-209**: Portfolio "Execution Analysis" tab — NOT the screenshot

---

## 5. Complete Data Lineage

```
CONNECTED ACCOUNT
( Hyperliquid wallet 0x8def... )
    ↓
ACCOUNT/SOURCE CONFIG
(user_exchange_keys table, database.js — stored API keys/wallets per workspace)
    ↓
SOURCE SYNC
syncHyperliquid() — exchangeSync.js:237-345
  - Fetches via Hyperliquid API (clearinghouseState, userFills, metaAndAssetCtxs)
  - Returns { holdings, trades, tradeFills, cashBalance, currency: "USDC" }
    ↓
SOURCE MAPPER
mapExchangeWalletToSource() — unifiedPortfolio.js:397-463
  ↓ BUG #1 at line 452:
    type: t.side || t.type || "trade"  →  type = "buy"/"sell" (WRONG)
    symbol: t.symbol || t.asset || null  →  can be NULL
    notional: t.notional != null ? Number(t.notional) : null  →  can be NULL
    quantity: t.quantity != null ? Number(t.quantity) : null  →  can be NULL
    ↓
TRANSACTION INSERT
INSERT INTO portfolio_source_transactions — unifiedPortfolio.js:782-793
  - ON CONFLICT (source_id, provider_tx_id) DO UPDATE
  - nullable columns: symbol TEXT, notional DOUBLE PRECISION, quantity DOUBLE PRECISION
    ↓
TABLE: portfolio_source_transactions
(database.js:108-124)
  Columns: id, source_id, account_id, provider_tx_id, type, side, symbol, name,
           quantity, unit_price, notional, fee, currency, executed_at, created_at
  Nullable: side, symbol, name, quantity, unit_price, notional, fee, account_id
    ↓
CASH FLOW EXTRACTION
(unifiedPortfolio.js:800-810)
  ↓ BUG #2 at line 801:
    txType = String(t.type).toLowerCase()  = "buy" or "sell"
    isCashFlow = !["trade","fill","other"].includes(txType)  = TRUE
    → Every fill is treated as a cash flow!
    ↓
DATABASE: portfolio_cash_flows (polluted with false entries)
    ↓
BACKEND API
GET /api/portfolio/unified/transactions — index.js:13668-13677
  ↓
  SQL: getUnifiedTransactions() — unifiedPortfolio.js:1496-1531
  ↓ BUG #3 at line 1496-1513:
    UNION ALL with LIMIT $2 only on FIRST sub-query
    Second sub-query (Polymarket) has NO LIMIT
    No outer LIMIT on UNION ALL result
  ↓
  Returns: [{ provider, sourceType, providerTxId, symbol, name, type, side,
              quantity, unitPrice, notional, fee, currency, executedAt,
              realizedPnl, sourceAccountId }]
  (NULL values pass through as-is)
    ↓
FRONTEND SERVICE
fetchUnifiedTransactions() — portfolioService.js:81-85
  (returns data.transactions as-is, no sanitization)
    ↓
HOOK
useUnifiedPortfolio() — useUnifiedPortfolio.js:47-84
  - Auto-refreshes every 60s (REFRESH_MS = 60000)
  - setTransactions(Array.isArray(txns) ? txns : [])  (line 73)
    ↓
STATE (App.jsx)
  - trades = useState(...) from bootstrap (line 1539) — normalized via normalizeTradeRecord
    Filtered: quantity > 0 (line 1545, 3149)
  - unified = useUnifiedPortfolio({ autoRefresh: !liveDataPaused }) (line 3756)
    - transactions from /api/portfolio/unified/transactions
    - Updates every 60s
    ↓
PROPS
<App.jsx:7909>  <HomeModule trades={trades} unifiedPortfolio={unified} ... />
    ↓
COMPONENT
HomeModule.jsx:163-188
    ↓
MEMOIZATION
recentActivityRows useMemo (HomeModule.jsx:2006-2076)
  ↓ BUG #4 at line 2076:
    } => [trades]);  ← MISSING unifiedPortfolio in deps!
  Step 1 — Source selection (line 2007):
    if unifiedPortfolio?.isUnified && transactions.length > 0
      sourceTrades = unifiedPortfolio.transactions.map(...)
    else
      sourceTrades = trades
  Step 2 — Timestamp assignment (line 2011-2014)
  Step 3 — FILTER: __ts > 0 (line 2015)
  Step 4 — FILTER: symbol non-empty (line 2018-2021)
  Step 5 — FILTER: notional > 0 (line 2024-2026)
  Step 6 — DEDUP by sym-side-notional-timestamp (line 2041-2054)
  Step 7 — MAP to display objects (line 2043-2074)
    ↓
RENDER
DataTable (DataTable.jsx:220-236)
  - Virtual rows: rows[vr.index] for each vr in getVirtualItems()
  - overscan: 12 (renders 12 extra rows beyond viewport)
  - rowHeight: 44 (fixed)
    ↓
CSS/LAYOUT
.home-exec-log-table (styles.css:819-862)
  - border-collapse, border-bottom on <tr>, fixed 44px height
    ↓
VISIBLE EXECUTION LOG
```

---

## 6. Connected Account Trace

For the affected account (Hyperliquid wallet):

```
Source API (Hyperliquid):       N fills per sync
  Endpoint: https://api.hyperliquid.xyz/info (type: "userFills")
  Params: { type: "userFills", user: "0x8def...", aggregateByTime: false }
  Record count: N (varies per account)

Source Mapper (exchangeSync.js):  N fills
  buildTradeAndFillRecord() for each fill
  → { trade: {...}, tradeFill: {...} }

Source Mapping (unifiedPortfolio.js:447):  N tradeFills
  mapExchangeWalletToSource() maps tradeFills to source transactions
  → { providerTxId, type(=side!), symbol, notional, fee, currency, executedAt, ... }
  Record count: N
  BUG: type = "buy"/"sell" instead of "trade"/"fill"

Database Insert (unifiedPortfolio.js:782):  N transactions
  INSERT INTO portfolio_source_transactions ... ON CONFLICT (source_id, provider_tx_id)
  Record count: N (deduplicated on provider_tx_id)
  Nullable columns: symbol, notional, quantity, fee

Database Query (getUnifiedTransactions, line 1496):  N + M
  SQL: UNION ALL of non-Polymarket (LIMIT $2) + Polymarket (NO LIMIT)
  BUG: Second sub-query has no LIMIT → unbounded

Backend API (index.js:13668):  N + M
  Returns { transactions: [...] } with NULL fields unfiltered

Frontend Service (portfolioService.js:81):  N + M
  fetchUnifiedTransactions() — no sanitization

Hook (useUnifiedPortfolio.js:61):  N + M
  setTransactions(txns) — stored as-is, refreshed every 60s

App State (App.jsx:3756):  N + M
  const unified = useUnifiedPortfolio({ autoRefresh: !liveDataPaused })

Props (App.jsx:7921):  N + M
  unifiedPortfolio={unified}

useMemo (HomeModule.jsx:2007):  STALE
  BUG: deps=[trades] only — doesn't recalculate when unifiedPortfolio changes
  Record count: varies (stale)

Render (DataTable):  varies
  Virtual rows with overscan: 12, rowHeight: 44
```

---

## 7. Source Sync Trace

### Hyperliquid Sync (exchangeSync.js:237-345)

```text
API Call 1: POST /info → type: "clearinghouseState", user: address
  → Returns: { assetPositions: [...], marginSummary: {...} }

API Call 2: POST /info → type: "userFills", user: address, aggregateByTime: false
  → Returns: [{ oid, tid, time, coin, side, sz, px, fee, closedPnl, startPosition, dir, crossed, hash }]

API Call 3: POST /info → type: "metaAndAssetCtxs"
  → Returns: [universe, assetCtxs]

Processing (exchangeSync.js:309-340):
  For each fill:
    buildTradeAndFillRecord({
      platform: "hyperliquid",
      clientId: `hl-${fill.oid}-${fill.tid}`,
      platformTradeId: fill.oid,
      platformFillId: fill.tid,
      executedAt: fill.time,
      asset: String(fill.coin || "").trim().toUpperCase(),  ← can be "" if coin missing
      name: String(fill.coin || "").trim().toUpperCase(),   ← same
      type: "crypto",
      side: fill.side === "B" ? "buy" : "sell",
      quantity: Math.abs(toNumber(fill.sz)),
      price: toNumber(fill.px),
      notional: Math.abs(toNumber(fill.sz) * toNumber(fill.px)),  ← can be 0 if sz or px = 0
      fee: Math.abs(toNumber(fill.fee)),
      ...
    })

  Return: { holdings, trades, tradeFills, cashBalance, currency: "USDC" }
```

**Critical fields that can produce blank rows**:
- `asset: String(fill.coin || "")` → empty string if coin missing
- `notional: Math.abs(toNumber(fill.sz) * toNumber(fill.px))` → 0 if sz or px is 0/null

### Other Source Syncs (same pattern via buildTradeAndFillRecord):

- **Binance** (exchangeSync.js:~755): Same `buildTradeAndFillRecord` pattern
- **Bybit** (exchangeSync.js:~1080): Same pattern
- **IBKR** (exchangeSync.js:~1260): Same pattern
- **Lighter** (exchangeSync.js:351-535): Same pattern

All sources funnel through `mapExchangeWalletToSource` at `unifiedPortfolio.js:447-462`, which has the `type` field bug.

---

## 8. Source Mapper Trace

### mapExchangeWalletToSource (unifiedPortfolio.js:397-463)

```javascript
// Line 447-462: Map tradeFills to source transactions
transactions: (Array.isArray(output.tradeFills) ? output.tradeFills : 
               (Array.isArray(output.trades) ? output.trades : [])).map((t, idx) => ({
  providerTxId: t.platformFillId || t.platformTradeId || t.id || `txn-${idx}`,
  type: t.side || t.type || "trade",       ← BUG #1: type = "buy"/"sell"
  side: t.side || null,
  symbol: t.symbol || t.asset || null,    ← can be NULL
  quantity: t.quantity != null ? Number(t.quantity) : null,  ← can be NULL
  unitPrice: t.unitPrice != null ? Number(t.unitPrice) : null, ← can be NULL
  notional: t.notional != null ? Number(t.notional) : null,  ← can be NULL
  fee: t.fee != null ? Number(t.fee) : (t.feeAmount != null ? Number(t.feeAmount) : null), ← can be NULL
  currency: t.currency || t.feeCurrency || "USD",
  executedAt: t.executedAt || t.executed_at || t.date || null, ← can be NULL
  realizedPnl: t.realizedPnl != null ? Number(t.realizedPnl) : null  ← can be NULL
}))
```

#### Field nullability

| Field | Can be NULL in source object | DB Column Nullable? | Filter in recentActivityRows? |
|-------|-----------------------------|---------------------|------------------------------|
| `type` | No (defaults to "trade") | No (NOT NULL DEFAULT 'other') | No |
| `side` | YES | Yes | No (defaults to "buy" in mapper) |
| `symbol` | YES (line 454) | Yes | YES (line 2018-2021) |
| `quantity` | YES (line 455) | Yes | No (used in notional fallback) |
| `unitPrice` | YES (line 456) | Yes | No (not directly used in filter) |
| `notional` | YES (line 457) | Yes | YES (line 2024-2026) |
| `fee` | YES (line 458) | Yes | No |
| `currency` | No (defaults to "USD") | No (DEFAULT 'USD') | No |
| `executedAt` | YES (line 460) | No (NOT NULL) — but mapper allows null | YES (line 2015 via __ts) |
| `realizedPnl` | YES | Yes (added via ALTER) | No |

#### The `type` field bug (BUG #1)

```javascript
// Current (BUGGY):
type: t.side || t.type || "trade"
```

For exchange/wallet sources (Hyperliquid, Binance, Bybit), `buildTradeAndFillRecord` sets:
- `t.side` = "buy" or "sell" (line 100 of exchangeSync.js)
- `t.type` = "crypto" (line 83 of exchangeSync.js)

So `t.side || t.type` = `"buy"` or `"sell"` — the `type` field becomes the side, not the asset type.

**Fix**: `type: t.type || "trade"` (prefer the actual type, then default)

**Impact**: At `unifiedPortfolio.js:801`, `txType = String(t.type).toLowerCase()` = "buy"/"sell", `isCashFlow = !["trade","fill","other"].includes("buy")` = `true`. This means **every fill is extracted as a cash flow**, polluting the `portfolio_cash_flows` table.

---

## 9. Canonical Data Trace

### Unified Portfolio Transaction Model

The unified portfolio transactions follow this flow:

1. **Source mapper** (`unifiedPortfolio.js:447-462`): Maps from source objects to flat transaction objects
2. **DB storage** (`unifiedPortfolio.js:782-793`): INSERT into `portfolio_source_transactions`
3. **DB query** (`getUnifiedTransactions`, `unifiedPortfolio.js:1496-1531`): SELECT with UNION ALL
4. **API response** (`index.js:13668-13677`): Returns `{ transactions: [...] }`
5. **Frontend hook** (`useUnifiedPortfolio.js:73`): `setTransactions(txns)`
6. **Frontend consumption** (`HomeModule.jsx:2007`): `unifiedPortfolio.transactions`

#### Canonical schema (from `mapTradeRow`, database.js:285-323)

Used for the legacy `user_workspace_trades` table (bootstrap path):

```javascript
{
  id: row.id,
  clientId: row.clientId || null,
  date: toDateString(row.date),          // null if input is falsy
  executedAt: toIsoString(row.executed_at),  // null if input is falsy
  asset: row.asset,                      // raw, can be NULL
  name: row.name,                        // raw, can be NULL
  type: row.type,                        // raw
  side: row.side,                        // raw
  marketType: row.market_type || "spot",
  status: row.status,                    // raw
  quantity: toNumber(row.quantity),      // NULL → 0
  price: toNumber(row.price),            // NULL → 0
  notional: toNumber(row.notional),      // NULL → 0
  platform, fee, feeCurrency, feeSource, slippage, referencePrice, etc.
}
```

#### Unified schema (from `getUnifiedTransactions`, unifiedPortfolio.js:1514-1530)

Used for the connected account sync path:

```javascript
{
  provider: t.provider,                  // from portfolio_sources
  sourceType: t.source_type,            // from portfolio_sources
  providerTxId: t.provider_tx_id,       // NOT NULL
  symbol: t.symbol,                     // nullable — can be NULL
  name: t.name || null,                 // nullable
  type: t.type,                         // NOT NULL, but CORRUPTED (buy/sell)
  side: t.side,                         // nullable
  quantity: t.quantity,                 // nullable
  unitPrice: t.unit_price,              // nullable
  notional: t.notional,                 // nullable
  fee: t.fee,                           // nullable
  currency: t.currency,                 // NOT NULL, default 'USD'
  executedAt: t.executed_at,            // NOT NULL
  realizedPnl: t.realized_pnl != null ? Number(t.realized_pnl) : null,  // nullable
  sourceAccountId: t.account_id         // nullable
}
```

**Key difference**: The unified schema has NO `asset` field (it has `symbol`), while the bootstrap schema has `asset` (always NOT NULL) but no `symbol`. The frontend `recentActivityRows` mapper uses `trade?.asset || trade?.symbol` to handle both — but this creates a schema mismatch when the `useMemo` switches data sources.

---

## 10. Database Trace

### Tables involved

| Table | Schema File:Line | Purpose |
|-------|-----------------|---------|
| `portfolio_source_transactions` | database.js:108-124 | Source transactions from connected accounts |
| `portfolio_sources` | database.js:47-73 | Source metadata (provider, source_type) |
| `user_workspace_trades` | database.js:1531-1560 | Legacy/local trades (manual entries) |
| `user_workspace_trade_fills` | database.js:~1565 | Legacy trade fills (deprecated) |
| `portfolio_cash_flows` | unifiedPortfolio.js:~160 | Cash flows (deposits, withdrawals, fees) |
| `portfolio_sync_runs` | database.js:127-134 | Sync run tracking |

### Schema: portfolio_source_transactions (database.js:108-124)

```sql
CREATE TABLE IF NOT EXISTS portfolio_source_transactions (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES portfolio_sources(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES portfolio_source_accounts(id) ON DELETE CASCADE,
  provider_tx_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  side TEXT,
  symbol TEXT,
  name TEXT,
  quantity DOUBLE PRECISION,
  unit_price DOUBLE PRECISION,
  notional DOUBLE PRECISION,
  fee DOUBLE PRECISION,
  currency TEXT NOT NULL DEFAULT 'USD',
  executed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, provider_tx_id)
);
```

**Nullable columns**: `side`, `symbol`, `name`, `quantity`, `unit_price`, `notional`, `fee`, `account_id`

### Migrations (unifiedPortfolio.js:200-201)

```sql
ALTER TABLE portfolio_source_transactions ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE portfolio_source_transactions ADD COLUMN IF NOT EXISTS realized_pnl DOUBLE PRECISION;
```

**Impact**: Records inserted before these migrations have `name = NULL` and `realized_pnl = NULL`.

### SQL Query: getUnifiedTransactions (unifiedPortfolio.js:1496-1513)

```sql
(SELECT s.provider, s.source_type, t.provider_tx_id, t.symbol, t.name, t.type, t.side, t.quantity,
        t.unit_price, t.notional, t.fee, t.currency, t.executed_at, t.realized_pnl, t.account_id
 FROM portfolio_source_transactions t
 JOIN portfolio_sources s ON s.id = t.source_id
 WHERE s.workspace_id=$1 AND s.provider <> 'polymarket'
 ORDER BY t.executed_at DESC
 LIMIT $2)                    ← LIMIT $2 only on FIRST sub-query (BUG #3)
UNION ALL
(SELECT s.provider, s.source_type, t.provider_tx_id, t.symbol, t.name, t.type, t.side, t.quantity,
        t.unit_price, t.notional, t.fee, t.currency, t.executed_at, t.realized_pnl, t.account_id
 FROM portfolio_source_transactions t
 JOIN portfolio_sources s ON s.id = t.source_id
 WHERE s.workspace_id=$1 AND s.provider = 'polymarket'
 ORDER BY t.executed_at DESC)  ← NO LIMIT on second sub-query
```

**BUG #3 — SQL UNION ALL LIMIT**: The `LIMIT $2` only applies to the first sub-query. The second sub-query (Polymarket) returns ALL Polymarket transactions without limit. There is no outer `LIMIT` wrapping the `UNION ALL`. This means:
- If the workspace has 95 non-Polymarket transactions and 5 Polymarket transactions, the result is 95 + ALL Polymarket (could be hundreds)
- The `limit` parameter (default 100, max 500) is effectively ignored for Polymarket data

### Potential SQL row issues

The SQL selects ALL rows regardless of `type`, `symbol`, `notional` being NULL:
- A row with `symbol = NULL` → frontend filter catches it
- A row with `notional = NULL` → frontend filter catches it
- A row with `symbol = NULL, notional = NULL` → frontend filter catches both
- BUT: a row with `symbol = "ASTER", notional = NULL` → NOTIONAL filter: `Number(null) = 0` → `0 > 0 = false` → filtered ✓
- A row with `symbol = NULL, notional = 50.0` → SYMBOL filter: `String(undefined || null || "")` = `""` → `length = 0` → filtered ✓

**However**: the `useMemo` dependency bug means these filters may NOT re-run when new data arrives from the unified portfolio. Stale data persists.

---

## 11. Backend API Trace

### Primary API: GET /api/portfolio/unified/transactions

**File**: `index.js:13668-13677`

```javascript
app.get("/api/portfolio/unified/transactions", requireSignedIn, attachActiveWorkspace, 
  requireWorkspaceMember, async (req, res) => {
  try {
    const workspaceId = req.workspace.workspace.id;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const transactions = await unifiedPortfolio.getUnifiedTransactions(pool, workspaceId, limit);
    res.json({ transactions });
  } catch (error) {
    handleServerError(res, "Unified transactions failed", error);
  }
});
```

**Issues**:
1. `limit` parameter only partially enforced (SQL UNION ALL bug)
2. No response sanitization — NULL fields from SQL pass through as `null` in JSON
3. No error response body on failure
4. No caching (unlike `/api/app/bootstrap` which uses `readFreshSnapshot`)
5. No field validation/transformation on the response

### Secondary API: GET /api/db/trade-executions

**File**: `index.js:14126-14147`

This is the **older** API path (used for `apiTradeExecutions`):
```javascript
app.get("/api/db/trade-executions", requireSignedIn, attachActiveWorkspace, 
  requireWorkspaceMember, async (req, res) => {
  try {
    const executions = await userWorkspace.tradeFills.getExecutions(
      req.auth.userId, filters, req.workspace?.workspace.id || null);
    res.json({ executions, source: "api_connections", manualEntriesIncluded: false });
  } catch (error) {
    handleServerError(res, "Trade execution history failed", error);
  }
});
```

This queries `user_workspace_trade_fills` table — a **different table** from `portfolio_source_transactions`. The `apiTradeExecutions` are used in `App.jsx:3151-3153` and passed to `PortfolioModule` as `apiTradeExecutions`.

**Key difference**: `apiTradeExecutions` comes from `user_workspace_trade_fills` (legacy table), while unified portfolio transactions come from `portfolio_source_transactions` (new unified table). These are **two separate data stores** that can have different data.

### Bootstrap API: GET /api/app/bootstrap

**File**: `index.js:4421-4462`

This is the initial data load. It calls `buildUserBootstrapPayload()` which fetches:
- `userWorkspace.trades.getAll()` — from `user_workspace_trades` (legacy local trades)
- NOT from `portfolio_source_transactions`

The bootstrap `trades` go through `normalizeTradeRecord` (App.jsx:1284-1326) and are filtered by `quantity > 0` (App.jsx:1545, 3149).

### Response Contract Comparison

| Field | Bootstrap trades (normalizeTradeRecord) | Unified transactions (getUnifiedTransactions) | apiTradeExecutions (getExecutions) |
|-------|----------------------------------------|----------------------------------------------|-------------------------------------|
| `id` | `Number(trade?.id) || Date.now() + idx` | NOT included (no `id` field in SQL select) | `Number(raw.id) || api-exec-...` |
| `asset` | `String(trade?.asset || "UNKNOWN")` | NOT present | NOT present |
| `symbol` | NOT present | `t.symbol` (can be NULL) | `t.symbol` (can be NULL) |
| `notional` | `toNumber(row.notional)` → 0 for NULL | `t.notional` (can be NULL) | `toNumber(row.notional)` → 0 for NULL |
| `executedAt` | `trade?.executedAt \|\| null` | `t.executed_at` (NOT NULL in DB) | `toIsoString(row.executed_at)` |
| `quantity` | `toNumber(row.quantity)` → 0 for NULL | `t.quantity` (can be NULL) | `toNumber(row.quantity)` → 0 for NULL |
| `type` | `side === "sell" ? "SELL" : "BUY"` | `t.type` (BUG: "buy"/"sell" for fills) | NOT present |
| `side` | `trade?.side \|\| "buy"` | `t.side` (can be NULL) | `mapTradeFillRow(...).side` |

**Critical**: The unified transactions schema has NO `id` field, NO `price` field (has `unitPrice` instead), and NO `asset` field (has `symbol`). The `recentActivityRows` mapper in HomeModule uses `trade?.asset || trade?.symbol` (line 2019, 2050, 2054) — this handles both, but creates a dependency on BOTH fields being present in the right way.

---

## 12. Frontend Service Trace

### fetchUnifiedTransactions (portfolioService.js:81-85)

```javascript
export async function fetchUnifiedTransactions({ signal, limit } = {}) {
  const qs = limit ? `?limit=${limit}` : "";
  const data = await zeninFetchJson(`/portfolio/unified/transactions${qs}`, { 
    signal, timeoutMs: 8000 
  });
  return data && Array.isArray(data.transactions) ? data.transactions : [];
}
```

**Issues**:
1. No sanitization — `data.transactions` is returned as-is
2. No field validation — NULL values from the API pass through to the hook
3. `limit` is undefined by default in `useUnifiedPortfolio` → no `?limit=` query param → backend uses default of 100
4. 8-second timeout — may time out on large result sets (due to the SQL UNION ALL bug returning excessive Polymarket transactions)

### useUnifiedPortfolio hook (useUnifiedPortfolio.js:47-84)

```javascript
// Line 52-63: Parallel fetch
const [s, p, src, st, rec, fx, snaps, curve, txns, sh] = await Promise.all([
  fetchUnifiedSummary().catch(() => null),
  fetchUnifiedPositions().catch(() => []),
  fetchUnifiedSources().catch(() => []),
  fetchUnifiedSyncStatus().catch(() => null),
  fetchUnifiedReconciliation().catch(() => null),
  fetchUnifiedFxRates().catch(() => null),
  fetchUnifiedSnapshots().catch(() => []),
  fetchUnifiedEquityCurve().catch(() => []),
  fetchUnifiedTransactions().catch(() => []),   ← fetchUnifiedTransactions called without limit
  fetchUnifiedShadowComparison().catch(() => null)
]);

// Line 73: Store transactions
setTransactions(Array.isArray(txns) ? txns : []);
```

**Issues**:
1. `fetchUnifiedTransactions()` called WITHOUT `limit` → no query param → backend default (100)
2. On error, `catch(() => [])` returns `[]` — no stale data handling
3. Transactions stored as-is without normalization
4. Auto-refresh every 60s (`REFRESH_MS = 60000`)

### State flow in App.jsx

```
App.jsx:1539  const [trades, setTrades] = useState(...)
  Initialized from localStorage (normalized via normalizeTradeRecord, filtered: quantity > 0)

App.jsx:1550  const [apiTradeExecutions, setApiTradeExecutions] = useState([])
  Filled from /db/trade-executions (mapTradeFillRow)

App.jsx:3756  const unified = useUnifiedPortfolio({ autoRefresh: !liveDataPaused })
  - transactions from /api/portfolio/unified/transactions
  - Updates every 60s
  - No normalizeTradeRecord applied

App.jsx:7909-7921  <HomeModule trades={trades} unifiedPortfolio={unified} ... />
App.jsx:8113-8121  <HomeModule trades={trades} unifiedPortfolio={unified} ... />
  (HomeModule rendered in two places — dashboard and full-page view)
```

---

## 13. Hook / State Trace

### useUnifiedPortfolio (useUnifiedPortfolio.js)

| State Variable | Initial Value | Updated By | Update Trigger |
|---------------|---------------|------------|----------------|
| `summary` | `null` | `setSummary(s)` | `refresh()` call |
| `transactions` | `[]` | `setTransactions(txns)` | `refresh()` call, 60s interval |
| `isUnified` | `false` | Computed from `summary.totalValue` | When `summary` updates |
| `loading` | `true/false` | `setLoading(true/false)` | Before/after `refresh()` |
| `error` | `null` | `setError(...)` | On fetch error |

### Data flow timeline

```text
T=0:    App renders. trades=[]. unified={summary:null, transactions:[], isUnified:false}
        HomeModule: recentActivityRows = [] (trades empty, unifiedPortfolio null)

T=100ms: Bootstrap resolves. trades = [5 local trades]. unifiedPortfolio still null.
        HomeModule: useMemo recalculates (trades changed) → sourceTrades = trades (5 rows)
        recentActivityRows = 5 filtered rows from local trades

T=500ms: useUnifiedPortfolio resolves. unified = {summary: {...}, transactions: [10 unified txns], isUnified: true}
        HomeModule: useMemo does NOT recalculate (trades unchanged!)  
        ← BUG #4: recentActivityRows still shows 5 STALE rows from local trades,
          NOT the 10 new unified transactions

T=60s:  useUnifiedPortfolio auto-refresh fires. unified.transactions updated (may add/remove rows)
        HomeModule: useMemo does NOT recalculate (trades unchanged!)
        ← STALE DATA PERSISTS — execution log doesn't update!

T=60s+: User places a manual trade → trades changes → useMemo recalculates
        → NOW reads unifiedPortfolio (isUnified=true) → sourceTrades = unifiedPortfolio.transactions
        → 10 unified transactions are processed through filters
        → If any have edge-case values (tiny notional, "UNKNOWN" symbol, etc.) → 
          may produce rows that look blank
```

### The stale closure effect

The `useMemo` at line 2006 captures the `unifiedPortfolio` reference from the render scope at the time of the last recalculation. When `unifiedPortfolio` changes but `trades` doesn't:
1. The `useMemo` returns the cached `recentActivityRows` (from old `unifiedPortfolio` or `trades`)
2. The `DataTable` renders the stale rows
3. The virtualizer maintains its scroll position based on the old row count
4. When `trades` finally changes, the `useMemo` recalculates with the CURRENT `unifiedPortfolio` — which may have changed since the last render

This can cause:
- **Missing rows**: New transactions not appearing in the log
- **Extra rows**: Stale rows from old data persisting
- **Schema mismatch**: If the memo switches data source (trades → unified), field names change

---

## 14. Transformation Trace

### Step 1: Source Selection (HomeModule.jsx:2007)

```javascript
const sourceTrades = (unifiedPortfolio?.isUnified && 
                      Array.isArray(unifiedPortfolio.transactions) && 
                      unifiedPortfolio.transactions.length > 0)
  ? unifiedPortfolio.transactions.map((t) => ({ 
      ...t, 
      date: t.executedAt, 
      __ts: new Date(t.executedAt || 0).getTime() 
    }))
  : (Array.isArray(trades) ? trades : []);
```

**Data source shapes**:
- **Unified**: `{ provider, sourceType, providerTxId, symbol, name, type, side, quantity, unitPrice, notional, fee, currency, executedAt, realizedPnl, sourceAccountId, __ts }`
- **Bootstrap trades**: `{ id, clientId, date, executedAt, asset, name, type, side, marketType, status, quantity, price, notional, platform, fee, feeCurrency, ... }`

**Schema differences that matter**:
| Unified field | Bootstrap equivalent | Used in mapper? |
|--------------|---------------------|-----------------|
| `symbol` | `asset` | Yes (line 2019, 2050, 2054) |
| `unitPrice` | `price` | No (line 2051 uses `trade?.price` — undefined for unified!) |
| `type` (="buy") | `type` (="BUY") | Yes (line 2019 fallback, line 2048 side detection) |
| `status` | `status` | No (line 2071: `trade?.status || "Filled"` — unified txns don't have `status`!) |

### Step 2: Timestamp Assignment (HomeModule.jsx:2011-2014)

```javascript
const rows = sourceTrades
  .map((trade) => ({
    ...trade,
    __ts: Number.isFinite(trade.__ts) 
      ? trade.__ts 
      : new Date(trade?.executedAt || trade?.date || 0).getTime()
  }))
```

For unified transactions: `trade.__ts` is already set (from the `.map()` at line 2008).
For bootstrap trades: `trade.__ts` is undefined → falls back to `new Date(trade?.executedAt || trade?.date || 0).getTime()`.

### Step 3: FILTER — Timestamp (HomeModule.jsx:2015)

```javascript
.filter((trade) => Number.isFinite(trade.__ts) && trade.__ts > 0)
```

Catches records with: invalid timestamps, null/undefined executedAt, NaN dates.

**PASSED**: Records with valid `executedAt` (NOT NULL in DB per schema).

### Step 4: FILTER — Symbol (HomeModule.jsx:2018-2021)

```javascript
.filter((trade) => {
  const sym = String(trade?.asset || trade?.symbol || "").trim().toUpperCase();
  return sym.length > 0 && sym !== "—";
})
```

Catches records with: null symbol, null asset, empty string symbol.
**PASSED**: Records with non-empty symbol like "ASTER".
**Note**: For unified transactions, `trade?.asset` is always undefined → uses `trade?.symbol`. If `symbol` is null → `"null"` → `"NULL"` → passes! But the DB has `symbol: NULL` (SQL null → JS null → `String(null || "")` = `String("")` = `""`) → `"".length = 0` → filtered. Wait, let me re-check...

Actually: `trade?.asset || trade?.symbol || ""` — if `trade.asset` is undefined and `trade.symbol` is null:
- `undefined || null` → `null` (falsy)
- `null || ""` → `""`
- `String("")` = `""`
- `"".trim().toUpperCase()` = `""`
- `"".length > 0` = false → **FILTERED** ✓

So NULL symbols ARE filtered. ✓

### Step 5: FILTER — Notional (HomeModule.jsx:2024-2026)

```javascript
.filter((trade) => {
  const notional = Number(trade?.notional);
  return Number.isFinite(notional) && notional > 0;
})
```

Catches records with: null notional (`Number(null)` = 0 → 0 > 0 = false), undefined notional (`Number(undefined)` = NaN → filtered), zero notional, invalid notional.

**PASSED**: Records with `notional > 0`.

### Step 6: Dedup (HomeModule.jsx:2041-2054)

```javascript
const key = `${sym}-${String(trade?.side || trade?.type || "").toLowerCase()}-${trade.notional}-${trade.__ts}`;
```

**BUG**: For unified transactions, `trade.side` can be null. `trade.type` is "buy"/"sell" (due to BUG #1). So `String(null || "buy")` = `"buy"` → dedup key includes "buy". For bootstrap trades, `trade.side` is "buy"/"sell" → the key uses "buy"/"sell" directly. Both consistent.

**Edge case**: Two fills from Hyperliquid at the same timestamp with the same symbol, side, and notional would be deduplicated. If the notional is slightly different, they'd both appear.

### Step 7: Row Mapping (HomeModule.jsx:2043-2074)

```javascript
const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "Sell" : "Buy";
const orderType = String(trade?.orderType || trade?.order_type || "MKT").trim().toUpperCase();
const symbol = String(trade?.asset || trade?.symbol || "—").toUpperCase();
const notional = Number(trade?.notional || (Number(trade?.price || 0) * Number(trade?.quantity || 0)));
const when = ...;
const timestampLabel = ...;
let id = trade.id || `${symbol}-${trade.__ts}`;
return {
  id, title: `${side} ${symbol}`, action: side.toUpperCase(),
  instruction: `${side.toUpperCase()}_${orderType}`,
  symbol, when, timestampLabel,
  value: Number.isFinite(notional) ? notional : 0,
  status: String(trade?.status || "Filled").toUpperCase(),
  raw: trade,
  tone: side === "Sell" ? "sell" : "buy"
};
```

**Critical issues in mapper**:
1. `trade?.orderType` — neither unified transactions nor bootstrap trades have `orderType` → defaults to "MKT" → `instruction = "BUY_MKT"` or `"SELL_MKT"` ✓
2. `trade?.status` — unified transactions do NOT have a `status` field → defaults to "Filled" → `"FILLED"` ✓
3. `trade?.price` — unified transactions have `unitPrice`, not `price` → `Number(trade?.price || 0)` = 0 → used only in notional fallback (which is dead code if notional passes filter) ✓
4. `trade.id` — unified transactions do NOT have an `id` field → `id = "${symbol}-${trade.__ts}"` ✓

**No null/undefined display fields** — all have defaults. So a row that passes all filters would render visible content.

### Step 8: DataTable Rendering (DataTable.jsx:53-252)

```javascript
const table = useReactTable({
  data,  // recentActivityRows
  columns: tableColumns,
  state: { sorting },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getRowId,  // (row) => row.id
});

const { rows } = table.getRowModel();  // rows from TanStack Table
const rowVirtualizer = useVirtualizer({
  count: rows.length,
  overscan: 12,
  estimateSize: () => rowHeight,  // 44
});

const virtualRows = rowVirtualizer.getVirtualItems();
virtualRows.map((vr) => {
  const row = rows[vr.index];
  return renderRow(row, {
    height: `${vr.size}px`,          // "44px"
    transform: `translateY(${vr.start}px)`,
  });
});
```

**Virtualization**: The virtualizer creates virtual items for the visible range + overscan (12). Each virtual item maps to `rows[vr.index]`. If `rows.length = 10` and `overscan = 12`, the virtualizer might try to create items for indices 0-21, but `rows[10]` through `rows[21]` would be `undefined`.

**WAIT — THIS IS THE BUG**: Let me re-check. `count: rows.length` = 10. The virtualizer's `getVirtualItems()` returns items for the visible range + overscan. But `count` is 10, so `vr.index` should be 0-9. Let me verify...

Actually, TanStack Virtual's `overscan` adds extra items to the virtual range, but `count` caps the total. So `vr.index` should always be `0 <= index < count`. If `count = 10`, indices are 0-9. No undefined access.

BUT — what if `rows.length` changes between the virtualizer's `count` update and the render? React/TanStack Virtual should handle this correctly via the `count` option.

**Conclusion**: The virtualization itself does NOT produce blank rows from undefined data. The blank rows must come from the data itself.

---

## 15. Frontend Rendering Audit

### HomeModule Execution Log DataTable (lines 3240-3254)

```jsx
<DataTable
  columns={[
    { key: "timestampLabel", cell: (row) => <span>{row.timestampLabel}</span> },
    { key: "symbol", cell: (row) => <strong>{row.symbol}</strong> },
    { key: "instruction", cell: (row) => <span>{row.instruction}</span> },
    { key: "value", cell: (row) => <span>{row.value > 0 ? formatMoney(row.value) : "--"}</span> },
    { key: "status", cell: (row) => <span className={`home-exec-status ${row.tone}`}>{row.status}</span> },
  ]}
  data={recentActivityRows}
  getRowId={(row) => row.id}
  className="home-exec-log-table"
  virtual
  rowHeight={44}
/>
```

### Column cell analysis for blank row scenarios

| Column | Cell content | Null/undefined behavior | Blank? |
|--------|-------------|------------------------|--------|
| `timestampLabel` | `<span>{row.timestampLabel}</span>` | `row.timestampLabel` is always a formatted string (line 2053) → never blank | NO |
| `symbol` | `<strong>{row.symbol}</strong>` | `row.symbol = String(... || "—").toUpperCase()` → "—" if missing, but filtered out at line 2019 | NO (if passes filter) |
| `instruction` | `<span>{row.instruction}</span>` | `row.instruction = "${side.toUpperCase()}_${orderType}"` → "BUY_MKT" if no orderType | NO |
| `value` | `<span>{row.value > 0 ? formatMoney(row.value) : "--"}</span>` | `row.value: 0` → renders "--" | **YES** — shows "--" |
| `status` | `<span>{row.status}</span>` | `String(trade?.status || "Filled").toUpperCase()` → "FILLED" | NO |

**Key finding**: A row that passes all filters would have:
- `timestampLabel`: always a formatted string (never blank)
- `symbol`: a valid symbol or "—" (but "—" is filtered)
- `instruction`: "BUY_MKT" or "SELL_MKT" (never blank)
- `value`: `formatMoney(notional)` or "--" (if value ≤ 0)
- `status`: "FILLED" or the actual status

So a row that passes all filters would NOT be completely blank — it would show at minimum the timestamp and instruction.

**This means the blank row is NOT from a record that passes all filters.** The blank row must come from one of:
1. A rendering issue in the DataTable/TableCell
2. The `useMemo` dependency bug causing stale state that includes unfiltered records
3. A CSS/layout issue

Let me now check if the `useMemo` dependency bug could cause the filter to NOT run on new data:

The `useMemo` only recalculates when `trades` changes. If `unifiedPortfolio.transactions` changes (60s refresh), the memo does NOT recalculate. The `recentActivityRows` array stays the SAME — it's the same filtered array from the last calculation. The DataTable receives the same `data` prop → no new rendering.

When `trades` finally changes (user action, bootstrap refresh), the memo recalculates. At this point:
1. It checks `unifiedPortfolio?.isUnified` (current value — may have changed)
2. If `isUnified` is true → `sourceTrades = unifiedPortfolio.transactions` (current, possibly updated)
3. The filters run on the NEW transactions data

So the filters DO run on new data when the memo recalculates. The issue is TIMING — there's a delay between `unifiedPortfolio` updating and `trades` changing.

But this would cause stale data, not blank rows. The stale data would just be old rows from the previous `trades` value — which were already filtered.

**NEW HYPOTHESIS**: What if the blank row is actually a **skeleton/loading row** from a different rendering path? Or what if the issue is with the `getRowId` function?

Let me check: `getRowId={(row) => row.id}` (line 3249). If `row.id` is undefined (unified transactions don't have `id`), the id becomes `undefined`. Two rows with `undefined` id would have the same React key, causing React to reuse the DOM node and potentially render stale content.

Wait — the mapper at line 2054: `let id = trade.id || '${symbol}-${trade.__ts}'`. For unified transactions, `trade.id` is undefined → `id = '${symbol}-${trade.__ts}'`. For bootstrap trades, `trade.id` is always a number (NOT NULL in `user_workspace_trades`). So this works.

But what if two unified transactions have the same `symbol` and `__ts` (same timestamp)? They'd get the same `id`. The dedup at line 2056-2061 handles this:
```javascript
if (seenIds.has(id)) {
  let n = 1;
  while (seenIds.has(`${id}#${n}`)) n += 1;
  id = `${id}#${n}`;
}
seenIds.add(id);
```

So IDs are unique. No React key collision.

---

## 16. Array Integrity Audit

### All `.map()`, `.filter()`, `.flatMap()`, `.reduce()` calls in the pipeline

1. **HomeModule.jsx:2008**: `unifiedPortfolio.transactions.map((t) => ({ ...t, date: t.executedAt, __ts: ... }))` — spreads all fields, adds `date` and `__ts`. ✓
2. **HomeModule.jsx:2011-2014**: `.map((trade) => ({ ...trade, __ts: ... }))` — recompute __ts. ✓
3. **HomeModule.jsx:2015**: `.filter((trade) => Number.isFinite(trade.__ts) && trade.__ts > 0)` — removes invalid timestamps. ✓
4. **HomeModule.jsx:2016**: `.sort((a, b) => b.__ts - a.__ts)` — sorts by timestamp. ✓
5. **HomeModule.jsx:2017**: `.slice(0, 50)` — limits to 50 rows. ✓
6. **HomeModule.jsx:2018-2021**: `.filter()` for symbol. ✓
7. **HomeModule.jsx:2024-2026**: `.filter()` for notional. ✓
8. **HomeModule.jsx:2041-2054**: `.filter()` for dedup. ✓
9. **HomeModule.jsx:2043-2074**: `.map()` for row mapping. All fields have defaults/fallbacks. ✓
10. **DataTable.jsx:230-236**: `virtualRows.map((vr) => { const row = rows[vr.index]; return renderRow(row, ...); })` — maps virtual rows to data rows. `rows[vr.index]` could be undefined if index is out of bounds (see virtualization note above).
11. **unifiedPortfolio.js:1514-1530**: `rows.rows.map((t) => ({ ... }))` — maps SQL rows to JS objects. NULL columns pass through as `null`. ✓

### Transformation that can produce null/undefined/{}

- **No `.map()` in the pipeline produces `{}` or `null`** — all mappers return objects with all fields populated
- **The SQL `UNION ALL` can produce rows with NULL symbol/notional, but these are filtered by the frontend filters**
- **The `useMemo` dependency bug means the filters may not re-run on `unifiedPortfolio` changes**

### Could the render array contain: VALID, VALID, INVALID, VALID?

**Yes, but only transiently** — if the `useMemo` recalculates with new data that hasn't been properly filtered yet. But the filters run synchronously within the `useMemo`, so invalid records should be filtered before the render array is set.

**The EXCEPTION** is if the `useMemo` returns a stale cached value that was computed from a different data source. In that case, the cached value may contain records that were valid for one source but not another — for example, a bootstrap trade with `notional: 0` (which was NOT filtered by the bootstrap's `quantity > 0` filter but WOULD be filtered by `recentActivityRows`'s notional filter).

WAIT — actually, I need to re-check this. The `trades` state from bootstrap IS normalized by `normalizeTradeRecord` which sets `notional: Number.isFinite(notional) ? Math.abs(notional) : 0`. Then `recentActivityRows` filters by `notional > 0`. So a bootstrap trade with `notional: 0` would be filtered out by `recentActivityRows`. ✓

But what if the `useMemo` previously cached a result from a `trades` update that included this trade, and then `trades` was updated again with a different version? The `useMemo` should recalculate each time `trades` changes. Each recalculation runs the full filter pipeline. So stale cached results shouldn't contain unfiltered records.

**FINAL CONCLUSION on array integrity**: The `recentActivityRows` useMemo produces a correctly filtered array. The blank row cannot come from the array itself — it must come from either:

1. **The `useMemo` stale closure** — not recalculating when `unifiedPortfolio` changes, causing the Execution Log to display stale rows. This doesn't produce blank rows, just stale (but valid) rows.

2. **A data source switching** — when `trades` changes and the memo recalculates, if `unifiedPortfolio` was null at the first calculation but true at the second, the source switches from `trades` to `transactions`. If the two data sources have different items (some items exist in one but not the other), the row count changes. The DataTable's virtualizer would then render based on the new count, but the visual transition might appear as "blank rows" during re-rendering.

3. **A race condition** — between the `useUnifiedPortfolio` refresh (every 60s) and the `trades` state updates. If a `useUnifiedPortfolio` refresh completes and sets new `transactions`, but the `useMemo` doesn't recalculate (because `trades` hasn't changed), and then a render occurs, the DataTable renders the stale `recentActivityRows` with the old row count. Then when `trades` finally changes, the `useMemo` recalculates, and during the React reconciliation, the virtualizer might render a mix of old and new rows, including blank ones.

4. **Most likely**: The blank row is a **symptom of the stale `useMemo` showing old `trades` data** (which includes a trade that was previously valid but has since been updated/synced). The trade was valid when it entered the `trades` array, but after a unified portfolio sync, the same trade may have been updated (e.g., notional corrected to a different value, or the trade was removed via deduplication). The stale `recentActivityRows` still contains the old version of this trade, which may render as a blank row if its display fields have since been invalidated.

Actually — let me reconsider one more time. The `useMemo` returns a NEW array each time it recalculates. The cached array from a previous calculation is a snapshot — it doesn't change. So if the previous calculation produced 10 valid rows, the cached array has 10 valid rows. Even if the underlying data changes, the cached array stays the same. This means stale data is always valid (it was valid when calculated), just outdated.

**THE REAL ROOT CAUSE (FINAL)**: The blank row is most likely produced when:

1. A trade record from the **bootstrap** path (`user_workspace_trades`) has `quantity > 0` (passes bootstrap filter) but `notional = 0` (from the DB, set to `NOT NULL` with default 0)
2. This trade enters the `trades` state
3. The `useMemo` recalculates and the notional filter catches it → row removed
4. BUT: the `useMemo` dependency bug means the memo might not recalculate when `unifiedPortfolio` changes
5. Meanwhile, `trades` gets updated from a refetch, and the trade is gone
6. On the next `useMemo` recalculation (due to `trades` change), the memo switches to `unifiedPortfolio.transactions` (if `isUnified` is now true)
7. The unified transactions include a record that was previously in `trades` but with different field values (e.g., `notional = 0` now) — this record passes the timestamp and symbol filters but fails the notional filter

Wait — if it fails the notional filter, it's removed. So it can't be in the render array.

Let me try yet another angle. What if the issue is simpler than I think? What if the blank row is simply a trade from the **bootstrap** path that has `notional: 0` but `quantity > 0`, and the `useMemo`'s notional filter at line 2024-2026 was **recently added** (as the comment says: "Drop incomplete fill records")?

If the fix was recently added but the user's browser still has a cached/old version of the bundle (stale build), the old code without the notional filter would render the blank row. The comment at line 2022-2023 says: "Drop incomplete fill records (sync artifacts with 0 or invalid notional). These render as `"--"` rows and create empty space in the execution log."

This suggests the developers **already identified** the problem and added a fix, but:
1. The fix might not have taken effect (stale bundle)
2. OR the fix doesn't catch all cases (there are records that pass all filters but still render blank)

Since the user is asking "where's the audit report?" — the audit report IS this document. Let me now also check what happens with `formatMoney(0)`:

`formatMoney(0)` → `formatCurrency(0, "USD")` → `Number(0)` = 0 → `Number.isFinite(0)` = true → formats as `"$0.00"`. But the cell renderer at line 3245: `row.value > 0 ? formatMoney(row.value) : "--"` — if `row.value` is 0, it renders `"--"`. So a row with `notional: 0` would render `"--"` in the Notional column.

But the filter at line 2024-2026 should have removed it. Unless the filter was recently added and the user's app is running an older version.

Let me now check git history for this filter:<tool_call>terminal<arg_key>command</arg_key><arg_value>git log --oneline -5 -- frontend/src/components/HomeModule.jsx 2>/dev/null; echo "---"; git log --oneline -5 -- backend/unifiedPortfolio.js 2>/dev/null