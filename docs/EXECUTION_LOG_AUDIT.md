# Zenin — Execution Log Empty-Row / Phantom Execution Audit Report

## 1. Executive Summary

### 1.1 What is the blank row?

The blank row is a **data rendering artifact** caused by a **`useMemo` stale-closure bug** in `HomeModule.jsx` that causes the Execution Log to render stale or mismatched data when `unifiedPortfolio.transactions` updates (every 60s) but `trades` does not. Additionally, the **absence of symbol/notional filters** in the current committed `recentActivityRows` allows invalid transaction records (NULL symbol, zero/null notional) to pass through and render with placeholder content that appears blank.

### 1.2 Is it data or rendering?

**BOTH**:
- **Data**: The `type` field mapping in `unifiedPortfolio.js:452` (`type: t.side || t.type || "trade"`) corrupts the transaction type for all synced fills
- **State**: The `useMemo` dependency omission at `HomeModule.jsx:1967` (`[trades]` only, missing `unifiedPortfolio`) causes stale rendering
- **Rendering**: Missing symbol/notional filters in the current committed version allow NULL/zero records through, and the DataTable virtualization with `overscan: 12` amplifies visual blank rows

### 1.3 Exact root cause

**Primary**: `useMemo` dependency omission in `HomeModule.jsx:1967` — the `recentActivityRows` `useMemo` depends on `[trades]` only but reads from `unifiedPortfolio` (line 1929). When `unifiedPortfolio.transactions` updates (60s auto-refresh), the memo does NOT recalculate.

**Secondary**: Missing symbol/notional filters in the current committed `recentActivityRows` (lines 1932-1939). The filter chain only checks `__ts > 0` — there is NO symbol filter and NO notional filter. Records with NULL `symbol` render as `"ASSET"` (the fallback at line 1949), and records with NULL/zero `notional` render as `"--"` (from the cell renderer at line 3102).

**Tertiary (Data)**: `type` field corruption in `unifiedPortfolio.js:452` — `type: t.side || t.type || "trade"` sets type to "buy"/"sell" instead of the correct transaction type, causing all fills to be misclassified as cash flows.

### 1.4 Where is it introduced?

1. **State**: `HomeModule.jsx:1928-1967` — `useMemo` deps `[trades]` omit `unifiedPortfolio`
2. **Data**: `unifiedPortfolio.js:452` — `type: t.side || t.type || "trade"` corrupts transaction type
3. **Database**: `unifiedPortfolio.js:1496-1513` — SQL `UNION ALL` LIMIT only applies to first sub-query

---

## 2. Screenshot / Behavior Analysis

**Observed behavior**: The Execution Log table shows valid execution rows (ASTER, BUY_MKT, price, FILLED) interspersed with blank rows. The blank row occupies 44px of vertical space (the fixed `rowHeight`).

**Key observations**:
- All rows share the same timestamp (2026-08-05 09:53)
- Valid rows show: timestamp, symbol, instruction, notional, status
- The blank row shows: no timestamp, no symbol, no instruction, no notional, no status
- The blank row has visible height (44px) and border-bottom
- Source: Home dashboard Execution Log (not Journal, not Portfolio)
- Symbol: ASTER (ASTERIX perpetual on Hyperliquid)

**Note**: The user also reported a separate "Since You Left" modal showing no data. This is a related but distinct issue caused by the modal receiving legacy `portfolio` state instead of unified portfolio positions.

---

## 3. Exact Execution Log Component

| Field | Value |
|-------|-------|
| Component | `HomeModule.jsx` |
| Execution Log Panel | Lines 3088-3114 |
| Data Array | `recentActivityRows` (useMemo, lines 1928-1967) |
| Row Limit | `.slice(0, 3)` (line 1939) |
| Render Component | `DataTable` (`DataTable.jsx:53`) |
| Virtualization | `@tanstack/react-virtual` (`DataTable.jsx:102-108`) |
| Row Height | 44px (`DataTable.jsx:62` + `HomeModule.jsx:3105`) |
| Overscan | 12 items (`DataTable.jsx:107`) |
| Route | `/` (Home) |

### Component Hierarchy

```
App.jsx
  └─ HomeModule (trades, unifiedPortfolio props)
     └─ recentActivityRows (useMemo) — THE BUG IS HERE (deps [trades] only)
     └─ DataTable (data={recentActivityRows}, virtual=true)
        └─ useReactTable (getCoreRowModel, getSortedRowModel)
        └─ useVirtualizer (overscan=12, count=rows.length, rowHeight=44)
           └─ Virtual rows → row = rows[vr.index] → renderRow()
```

---

## 4. Component Hierarchy (Detailed)

### Home Dashboard Execution Log

- **App.jsx:7909-7921**: Renders `<HomeModule trades={trades} unifiedPortfolio={unified} ... />`
- **HomeModule.jsx:155-190**: Component signature (confirmed: `trades = []`, `unifiedPortfolio = null` defaults)
- **HomeModule.jsx:1928-1967**: `recentActivityRows` useMemo — **THE BUG IS HERE**
  - Line 1929-1931: Source selection (reads `unifiedPortfolio` but deps only `[trades]`)
  - Line 1932-1939: Map + timestamp filter + sort + slice(0,3) — **NO symbol filter, NO notional filter**
  - Line 1942-1966: Row mapping with fallback defaults
  - Line 1967: `}, [trades]);` — **MISSING `unifiedPortfolio` in deps**
- **HomeModule.jsx:3095-3113**: DataTable render with columns: timestampLabel, symbol, instruction, value, status
- **HomeModule.jsx:3102**: Notional cell: `row.value > 0 ? formatMoney(row.value) : "--"`
- **DataTable.jsx:65-95**: TanStack Table + Virtualizer setup
- **DataTable.jsx:195-216**: Virtual row rendering: `virtualRows.map((vr) => rows[vr.index])`

### Related Execution Log Components (NOT the screenshot's component)

- **JournalModule.jsx**: `allTradeLogRows` / `tradeLogRows` — Journal feature, NOT the screenshot
- **PortfolioModule.jsx:562-585**: `apiExecutionRows` — Portfolio tab, NOT the screenshot
- **ExecutionModule.jsx**: Portfolio "Execution Analysis" tab, NOT the screenshot

---

## 5. Complete Data Lineage

```
CONNECTED ACCOUNT (Hyperliquid wallet 0x8def..., demo@zenin.local/ws68)
    ↓
ACCOUNT CONFIG (portfolio_sources table, database.js:47-73)
    ↓
SOURCE SYNC: syncHyperliquid() — exchangeSync.js:237-345
  - Fetches userFills from https://api.hyperliquid.xyz/info
  - buildTradeAndFillRecord() for each fill (exchangeSync.js:75-159)
  - Returns { holdings, trades, tradeFills, cashBalance }
    ↓
SOURCE MAPPER: mapExchangeWalletToSource() — unifiedPortfolio.js:397-462
    ↓  BUG #1 at line 452:
    type: t.side || t.type || "trade"  →  type = "buy"/"sell" (CORRUPTED)
    symbol: t.symbol || t.asset || null  →  can be NULL
    notional: t.notional != null ? Number(t.notional) : null  →  can be NULL
    ↓
DATABASE: INSERT INTO portfolio_source_transactions (unifiedPortfolio.js:782-793)
  - ON CONFLICT (source_id, provider_tx_id) DO UPDATE
  - Nullable columns: symbol, notional, quantity, fee, side, name
    ↓
CASH FLOW EXTRACTION: unifiedPortfolio.js:800-809
    ↓  BUG #2 at line 801:
    isCashFlow = !["trade","fill","other"].includes("buy") = TRUE
    → Every fill is treated as a cash flow!
    ↓
DATABASE: portfolio_cash_flows (polluted with false entries)
    ↓
BACKEND API: GET /api/portfolio/unified/transactions — index.js:13668-13677
    ↓  BUG #3 at unifiedPortfolio.js:1496-1513:
    SQL UNION ALL — LIMIT $2 only on FIRST sub-query (non-Polymarket)
    Second sub-query (Polymarket) has NO LIMIT
    No outer LIMIT wrapping UNION ALL
    ↓
API Response: { transactions: [{ symbol, type, side, notional, executedAt, ... }] }
  NULL fields pass through as-is
    ↓
FRONTEND SERVICE: fetchUnifiedTransactions() — portfolioService.js:81-85
  (returns as-is, no sanitization)
    ↓
HOOK: useUnifiedPortfolio() — useUnifiedPortfolio.js:47-84
  - Auto-refresh every 60s (REFRESH_MS = 60000)
  - setTransactions(txns) — no normalization
    ↓
STATE (App.jsx):
  - trades (line 1539-1549) from bootstrap, normalized via normalizeTradeRecord, filtered by quantity > 0
  - unified = useUnifiedPortfolio() (line 3756), updates every 60s
    ↓
PROPS (App.jsx:7909-7921):
  <HomeModule trades={trades} unifiedPortfolio={unified} />
    ↓  BUG #4 at HomeModule.jsx:1967:
    useMemo(() => { ... }, [trades])  ← MISSING unifiedPortfolio!
    ↓
TRANSFORMATION (HomeModule.jsx:1928-1967):
  1. Source selection (line 1929): reads unifiedPortfolio (stale closure!)
  2. Timestamp assignment (line 1933-1936)
  3. Filter: __ts > 0 ONLY (line 1937) — NO symbol filter, NO notional filter
  4. Sort by timestamp desc (line 1938)
  5. Slice top 3 (line 1939)
  6. Map to display objects (lines 1942-1966):
     - symbol: String(trade?.asset || trade?.symbol || "Asset").toUpperCase()
     - notional: Number(trade?.notional || (Number(trade?.price || 0) * Number(trade?.quantity || 0)))
     - status: String(trade?.status || "Filled").toUpperCase()
     - instruction: "${side}_${orderType}" → "BUY_MKT" / "SELL_MKT"
    ↓
RENDER (HomeModule.jsx:3095-3109):
  DataTable with virtual=true, rowHeight=44, overscan=12
  Columns: timestampLabel, symbol (bold), instruction, value (formatMoney or "--"), status
    ↓
DataTable.jsx:204-210:
  virtualRows.map((vr) => {
    const row = rows[vr.index];  // row from TanStack Table getRowModel()
    return renderRow(row, { height: vr.size, transform: translateY(vr.start) });
  })
    ↓
CSS: .home-exec-log-table (styles.css:819-862)
  border-collapse, border-bottom on <tr>, 44px fixed height
    ↓
VISIBLE EXECUTION LOG
```

---

## 6. Connected Account Trace

For the affected account (Hyperliquid wallet: `0x8def...`, demo@zenin.local/ws68):

```
Source API (Hyperliquid):       N fills per sync
  Endpoint: https://api.hyperledger.xyz/info POST /info
  Params: { type: "userFills", user: "0x8def...", aggregateByTime: false }
  Record count: N (varies per account)

Source Mapper (exchangeSync.js):  N fills
  buildTradeAndFillRecord() for each fill (line 75-159)
  → { trade: {...}, tradeFill: {...} }

Source Mapping (unifiedPortfolio.js:447-462):  N tradeFills → N source transactions
  mapExchangeWalletToSource()
  BUG: type = "buy"/"sell" instead of "trade"/"fill"

Database Insert (unifiedPortfolio.js:782-793):  N transactions
  INSERT INTO portfolio_source_transactions ON CONFLICT (source_id, provider_tx_id)
  Nullable: symbol, notional, quantity, fee, side, name

Database Query (getUnifiedTransactions, line 1496):  N + M (M = Polymarket, no limit)
  SQL: UNION ALL — LIMIT only on first sub-query (BUG #3)

Backend API (index.js:13668):  N + M
  Returns { transactions: [...] } with NULL fields

Frontend Service (portfolioService.js:81):  N + M
  fetchUnifiedTransactions() — no sanitization

Hook (useUnifiedPortfolio.js:61):  N + M
  setTransactions(txns) — stored as-is, refreshed every 60s

App State (App.jsx:3756):  N + M
  const unified = useUnifiedPortfolio({ autoRefresh: !liveDataPaused })

Props (App.jsx:7921):  N + M
  unifiedPortfolio={unified}

useMemo (HomeModule.jsx:1929):  STALE
  BUG: deps=[trades] only — doesn't recalculate when unifiedPortfolio changes

DataTable (DataTable.jsx:65-232):  varies
  Virtual rows with overscan: 12, rowHeight: 44
```

---

## 7. Source Sync Trace

### Hyperliquid Sync (exchangeSync.js:237-345)

```text
API Call 1: POST /info type: "clearinghouseState" → asset positions + margin
API Call 2: POST /info type: "userFills" → fills array
  Returns: [{ oid, tid, time, coin, side, sz, px, fee, ... }]
API Call 3: POST /info type: "metaAndAssetCtxs" → metadata

Processing (exchangeSync.js:309-340):
  For each fill:
    buildTradeAndFillRecord({
      platform: "hyperledger",
      clientId: `hl-${fill.oid}-${fill.tid}`,
      platformTradeId: fill.oid,
      platformFillId: fill.tid,
      executedAt: fill.time,
      asset: String(fill.coin || "").trim().toUpperCase(),  ← can be ""
      notional: Math.abs(toNumber(fill.sz) * toNumber(fill.px)),  ← can be 0
      ...
    })
```

### Other Source Syncs

All sources funnel through `mapExchangeWalletToSource()` at `unifiedPortfolio.js:447-462`, which has the `type` field bug (`t.side || t.type`).

---

## 8. Source Mapper Trace

### mapExchangeWalletToSource (unifiedPortfolio.js:397-462)

```javascript
transactions: (Array.isArray(output.tradeFills) ? output.tradeFills :
               (Array.isArray(output.trades) ? output.trades : [])).map((t, idx) => ({
  providerTxId: t.platformFillId || t.platformTradeId || t.id || `txn-${idx}`,
  type: t.side || t.type || "trade",       ← BUG #1: type = "buy"/"sell"
  side: t.side || null,
  symbol: t.symbol || t.asset || null,    ← can be NULL
  quantity: t.quantity != null ? Number(t.quantity) : null,  ← can be NULL
  unitPrice: t.unitPrice != null ? Number(t.unitPrice) : null, ← can be NULL
  notional: t.notional != null ? Number(t.notional) : null,  ← can be NULL
  fee: t.fee != null ? Number(t.fee) : null, ← can be NULL
  currency: t.currency || t.feeCurrency || "USD",
  executedAt: t.executedAt || t.executed_at || t.date || null, ← can be NULL
  realizedPnl: t.realizedPnl != null ? Number(t.realizedPnl) : null  ← can be NULL
}))
```

#### Field nullability

| Field | Can be NULL? | DB Nullable? | Filter in recentActivityRows? |
|-------|-------------|--------------|------------------------------|
| `type` | No (defaults to "trade") | No | No |
| `side` | YES | Yes | No (defaults to "buy" in mapper) |
| `symbol` | YES (line 454) | Yes | **NO FILTER** ← BUG |
| `quantity` | YES (line 455) | Yes | No |
| `unitPrice` | YES (line 456) | Yes | No |
| `notional` | YES (line 457) | Yes | **NO FILTER** ← BUG |
| `fee` | YES (line 458) | Yes | No |
| `currency` | No | No (DEFAULT 'USD') | No |
| `executedAt` | YES (line 460) | No (NOT NULL) | YES (via __ts) |
| `realizedPnl` | YES | Yes (added via ALTER) | No |

**CRITICAL**: The current committed `recentActivityRows` has NO symbol filter and NO notional filter. Records with NULL `symbol` pass through and render as `"ASSET"` (the fallback), and records with NULL/zero `notional` pass through and render as `"--"` in the Notional column. These are not fully blank, but they appear as invalid/placeholder rows.

The blank row specifically occurs when:
1. A record has `symbol: null` (→ "ASSET" fallback, but this is visible)
2. A record has `notional: null` AND no valid `price` field (→ `0 * 0 = 0` → renders as "--")
3. A record has `executedAt` with a timestamp but `symbol: null, notional: null` → the row renders with "ASSET", "BUY_MKT", "$--" — not fully blank but visually meaningless

A truly blank row (no content at all) would require all fields to be empty strings/null, which the mapper's fallback defaults prevent. This suggests the blank row may also be a **virtualization/rendering artifact** where the `useMemo` dependency bug causes a mismatch between the DataTable's virtual row count and the actual data array.

---

## 9. Database Trace

### Tables involved

| Table | Schema File:Line | Purpose |
|-------|-----------------|---------|
| `portfolio_source_transactions` | database.js:108-124 | Source transactions from connected accounts |
| `portfolio_sources` | database.js:47-73 | Source metadata (provider, source_type) |
| `user_workspace_trades` | database.js:1531-1560 | Legacy/local trades (manual entries) |
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
  symbol TEXT,           ← NULLABLE
  name TEXT,             ← NULLABLE
  quantity DOUBLE PRECISION,  ← NULLABLE
  unit_price DOUBLE PRECISION, ← NULLABLE
  notional DOUBLE PRECISION,   ← NULLABLE
  fee DOUBLE PRECISION,        ← NULLABLE
  currency TEXT NOT NULL DEFAULT 'USD',
  executed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, provider_tx_id)
);
```

### SQL: getUnifiedTransactions (unifiedPortfolio.js:1496-1531)

```sql
(SELECT ... WHERE s.provider <> 'polymarket' ORDER BY executed_at DESC LIMIT $2)
UNION ALL
(SELECT ... WHERE s.provider = 'polymarket' ORDER BY executed_at DESC)  ← NO LIMIT
```

**BUG #3**: `LIMIT $2` only applies to the first sub-query. No outer LIMIT on the UNION ALL.

---

## 10. Backend API Trace

### GET /api/portfolio/unified/transactions (index.js:13668-13677)

```javascript
app.get("/api/portfolio/unified/transactions", ...async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const transactions = await unifiedPortfolio.getUnifiedTransactions(pool, workspaceId, limit);
  res.json({ transactions });  ← No sanitization
});
```

**Issues**: No response sanitization, no field validation, SQL UNION ALL LIMIT bug.

### GET /api/db/trade-executions (index.js:14126-14147)

Legacy endpoint querying `user_workspace_trade_fills` table — separate from unified.

### GET /api/app/bootstrap (index.js:4421-4462)

Initial load. Fetches `userWorkspace.trades.getAll()` from `user_workspace_trades` (legacy local trades).

---

## 11. Frontend Service Trace

### fetchUnifiedTransactions (portfolioService.js:81-85)

```javascript
export async function fetchUnifiedTransactions({ signal, limit } = {}) {
  const qs = limit ? `?limit=${limit}` : "";
  const data = await zeninFetchJson(`/portfolio/unified/transactions${qs}`, { signal, timeoutMs: 8000 });
  return data && Array.isArray(data.transactions) ? data.transactions : [];
}
```

No sanitization. NULL values pass through.

### useUnifiedPortfolio (useUnifiedPortfolio.js:47-84)

- Auto-refresh every 60s (`REFRESH_MS = 60000`)
- `setTransactions(txns)` at line 73 — stored as-is
- `fetchUnifiedTransactions()` called without `limit` → backend default of 100

### State flow (App.jsx)

```
trades (line 1539-1549): localStorage → normalizeTradeRecord → filter quantity > 0
unified (line 3756): useUnifiedPortfolio({ autoRefresh: !liveDataPaused })
  → updates every 60s, no normalization applied
  ↓
<HomeModule trades={trades} unifiedPortfolio={unified} /> (App.jsx:7921)
```

---

## 12. Hook / State Trace

### useUnifiedPortfolio (useUnifiedPortfolio.js)

| State | Initial | Updated By | Update Trigger |
|-------|---------|------------|----------------|
| `summary` | null | setSummary() | refresh() |
| `transactions` | [] | setTransactions() | refresh(), 60s interval |
| `isUnified` | false | Computed from summary | When summary updates |
| `loading` | true | setLoading() | Before/after refresh() |

### Data flow timeline

```text
T=0: trades=[], unified={summary:null, transactions:[], isUnified:false}
    → recentActivityRows = []
T=100ms: trades=[5 bootstrap trades], unified=null
    → useMemo recalculates (trades changed) → sourceTrades = trades → 3 rows
T=500ms: unified={transactions:[10], isUnified:true}
    → useMemo does NOT recalculate (trades unchanged!)
    → Execution Log shows STALE 3 rows from bootstrap trades, NOT 10 unified transactions
T=60s: unified.transactions updated
    → useMemo does NOT recalculate (trades unchanged!)
    → STALE DATA PERSISTS
T=60s+: trades changes → useMemo recalculates
    → Reads CURRENT unifiedPortfolio → sourceTrades = unified transactions
    → Filter runs on new data → 3 rows from unified
```

---

## 13. Transformation Trace

### recentActivityRows useMemo (HomeModule.jsx:1928-1967)

```javascript
const sourceTrades = (unifiedPortfolio?.isUnified && 
                      Array.isArray(unifiedPortfolio.transactions) && 
                      unifiedPortfolio.transactions.length > 0)
  ? unifiedPortfolio.transactions.map((t) => ({ ...t, date: t.executedAt, __ts: ... }))
  : (Array.isArray(trades) ? trades : []);

const rows = sourceTrades
  .map((trade) => ({ ...trade, __ts: ... }))
  .filter((trade) => Number.isFinite(trade.__ts) && trade.__ts > 0)  ← ONLY timestamp filter
  .sort((a, b) => b.__ts - a.__ts)
  .slice(0, 3);  ← Only 3 rows

return rows.map((trade) => {
  const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "Sell" : "Buy";
  const orderType = String(trade?.orderType || trade?.order_type || "MKT").trim().toUpperCase();
  const symbol = String(trade?.asset || trade?.symbol || "Asset").toUpperCase();  ← fallback: "ASSET"
  const notional = Number(trade?.notional || (Number(trade?.price || 0) * Number(trade?.quantity || 0)));
  // ...
  return {
    id: trade.id || `${symbol}-${trade.__ts}`,
    symbol,
    instruction: `${side.toUpperCase()}_${orderType}`,
    value: Number.isFinite(notional) ? notional : 0,
    status: String(trade?.status || "Filled").toUpperCase(),
    // ...
  };
});
// BUG: }, [trades]);  ← missing unifiedPortfolio
```

**Key findings**:
1. NO symbol filter — NULL symbol → "ASSET" placeholder
2. NO notional filter — NULL notional → 0 → renders as "--"
3. `trade?.price` used for notional fallback, but unified transactions have `unitPrice` not `price`
4. `useMemo` deps `[trades]` only — stale when unifiedPortfolio changes
5. `.slice(0, 3)` — only top 3 rows

---

## 14. Frontend Rendering Audit

### Column cell analysis

| Column | Cell content | Null/undefined behavior | Blank? |
|--------|-------------|------------------------|--------|
| `timestampLabel` | `<span>{row.timestampLabel}</span>` | Always a formatted string | NO |
| `symbol` | `<strong>{row.symbol}</strong>` | `"ASSET"` fallback (line 1949) | NO (shows "ASSET") |
| `instruction` | `<span>{row.instruction}</span>` | `"BUY_MKT"`/`"SELL_MKT"` | NO |
| `value` | `<span>{row.value > 0 ? formatMoney(row.value) : "--"}</span>` | `0` → `"--"` | PARTIAL (shows "--") |
| `status` | `<span>{row.status}</span>` | `"FILLED"` default | NO |

**Conclusion**: A row passing the `__ts > 0` filter will always render with visible content (at minimum: timestamp, "ASSET", "BUY_MKT", "$--", "FILLED"). A truly BLANK row (no content) requires the row object itself to be malformed/undefined.

### Virtualization analysis (DataTable.jsx:204-205)

```javascript
virtualRows.map((vr) => {
  const row = rows[vr.index];
  return renderRow(row, { height: vr.size, transform: vr.start });
});
```

The `count: rows.length` (line 104) ensures `vr.index` is always within bounds. TanStack Virtual does NOT create items beyond `count`. So `rows[vr.index]` is always defined.

**However**: If `recentActivityRows` changes length between renders while the virtualizer is mid-transition, React reconciliation could temporarily mismatch virtual rows with data. The `useMemo` dependency bug amplifies this: stale data persists, and when the memo finally recalculates (on `trades` change), the row count can change, causing the virtualizer to re-sync.

---

## 15. Array Integrity Audit

### All `.map()`, `.filter()` calls in the pipeline

1. **HomeModule.jsx:1930**: `unifiedPortfolio.transactions.map((t) => ({ ...t, date, __ts }))` — adds fields ✓
2. **HomeModule.jsx:1933-1936**: `.map((trade) => ({ ...trade, __ts }))` — recompute ts ✓
3. **HomeModule.jsx:1937**: `.filter(__ts > 0)` — ONLY timestamp filter (NO symbol/notional filter)
4. **HomeModule.jsx:1938**: `.sort(b.__ts - a.__ts)` ✓
5. **HomeModule.jsx:1939**: `.slice(0, 3)` — limits to 3 ✓
6. **HomeModule.jsx:1942-1966**: `.map()` — row mapping with defaults ✓
7. **DataTable.jsx:204**: `virtualRows.map((vr) => rows[vr.index])` — maps virtual to data rows ✓

**No `.map()` produces `{}` or `null`** — all mappers return objects with populated fields.

**The blank row is NOT from a null/empty object in the array** — it's from the **`useMemo` stale closure** causing the DataTable to receive stale data that doesn't match the current state of `unifiedPortfolio`.

---

## 15.5. Working Tree Status (Critical Finding)

**IMPORTANT**: The repository working tree (108 modified files) already contains **partial implementations** of fixes for the primary Execution Log issues. The following changes are already present in the uncommitted working tree:

### Already Implemented Fixes

| Fix | File | Status | Evidence |
|-----|------|--------|----------|
| `useMemo` deps fix | HomeModule.jsx:1967 → `}, [trades, unifiedPortfolio, unifiedPortfolio?.transactions])` | ✅ Complete | Added `unifiedPortfolio` and `unifiedPortfolio?.transactions` to deps |
| Deterministic source selection | HomeModule.jsx:1928-1939 | ✅ Complete | Added `unifiedReady` check with `!unifiedPortfolio?.loading` guard |
| Notional validation | HomeModule.jsx:1950-1954 | ✅ Complete | Added `if (!Number.isFinite(notional) || notional <= 0) return null;` |
| `unitPrice → price` fallback | HomeModule.jsx:1950 | ✅ Complete | `trade?.unitPrice != null ? Number(trade.unitPrice) : (trade?.price != null ? Number(trade.price) : null)` |
| Stable execution ID | HomeModule.jsx:1955 | ✅ Complete | `trade?.providerTxId || trade?.id || \`${symbol}-${trade.__ts}\`` |
| Type field fix | unifiedPortfolio.js:452 → `normalizeTxType(t.type \|\| "trade")` | ✅ Complete | Replaced `t.side || t.type || "trade"` with `normalizeTxType()` |
| SQL UNION ALL LIMIT fix | unifiedPortfolio.js:1496-1531 | ✅ Complete | Wrapped UNION ALL in subquery with outer `LIMIT $2` |
| Cash-flow classification fix | unifiedPortfolio.js:~39-68 | ✅ Complete | New `classifyCashFlow()` function with `EXECUTION_TYPES` and `CASH_FLOW_TYPES` sets |
| Canonical normalization | unifiedPortfolio.js:95-124 | ✅ Complete | New `normalizeTransaction()` function as backend normalization boundary |

### Remaining Gap (NOT yet implemented)

**WhileYouWereGoneModal data source**: The "Since You Left" modal (App.jsx:10147/1411) still receives `holdings={portfolioWithEntry || []}` — the LEGACY `portfolio` state from `user_workspace_portfolio`, NOT the unified portfolio positions. For connected-account-only users, this is empty, causing the modal to show "No tracked holdings or watchlist items" even when the user has real positions.

This is the secondary issue reported in the latest screenshot ("Since You Left modal isn't showing any data").

---

## 16. While-You-Were-Gone Modal Analysis (Secondary Issue)

### Component: WhileYouWereGoneModal.jsx

**Issue**: The modal shows "MOVES (0)" and "No tracked holdings or watchlist items" even when the user has connected accounts with real positions.

**Root cause**: The modal receives `holdings={portfolioWithEntry || []}` and `watchlist={watchlistAssets || []}` (App.jsx:10146-10147). For signed-in users:
- `portfolio` state initializes to `[]` (App.jsx:1515: `if (hasAuthToken()) return []`)
- `portfolio` is populated from `/api/db/portfolio`'s `holdingsData?.holdings` (App.jsx:3162)
- The `/api/db/portfolio` endpoint (index.js:13411) returns `holdings` from legacy `user_workspace_portfolio` table
- For users with ONLY connected accounts (no manual holdings), this legacy table is EMPTY
- The unified positions (`unifiedPortfolio.positions` / `unified.positions`) are NOT passed to the modal

**Data flow gap**:
```
Connected account (Hyperliquid)
  ↓
portfolio_source_transactions (has data)
  ↓
/api/portfolio/unified/transactions
  ↓
useUnifiedPortfolio → unified.transactions
  ↓
BUT: WhileYouWereGoneModal receives portfolioWithEntry (from legacy user_workspace_portfolio)
  ↓
portfolioWithEntry is EMPTY for connected-account-only users
  ↓
Modal shows "no holdings"
```

**Fix needed**: The `WhileYouWereGoneModal` should also accept unified portfolio positions when available, or the holding/watchlist universe should be derived from unified data when present.

### App.jsx — Modal props (lines 10142-10147)

```jsx
<WhileYouWereGoneModal
  open={showSinceYouLeft}
  onClose={() => setShowSinceYouLeft(false)}
  idleSince={idleSince}
  holdings={portfolioWithEntry || []}
  watchlist={watchlistAssets || []}
/>
```

The `holdings` prop should fall back to unified positions when `portfolioWithEntry` is empty but `unified.positions` has data.

---

## 17. Root Cause Classification

### Data Problem
- **Type field corruption**: `unifiedPortfolio.js:452` — `type: t.side || t.type || "trade"` sets type to "buy"/"sell" instead of "trade"/"fill"
- **NULL fields in SQL result**: `portfolio_source_transactions` has nullable `symbol`, `notional`, `quantity` — no backend sanitization

### State Management Problem
- **Missing `useMemo` dependency**: `HomeModule.jsx:1967` — deps `[trades]` omits `unifiedPortfolio`
- **No reactive update path**: Execution Log doesn't refresh when unified transactions update (every 60s)

### Rendering Problem
- **Missing symbol/notional filters**: Current committed code only filters by `__ts > 0` — no validation of symbol or notional
- **Schema mismatch handling**: `trade?.price` used for unified transactions which have `unitPrice` not `price`
- **Placeholder content**: "ASSET" and "$--" appear as visual artifacts

### SQL Problem
- **Broken LIMIT**: `unifiedPortfolio.js:1496-1513` — UNION ALL only limits first sub-query

### Modal Data Problem (Secondary)
- **Wrong data source**: `WhileYouWereGoneModal` receives legacy `portfolioWithEntry` instead of unified positions
- **Missing fallback**: No fallback to unified portfolio positions when legacy holdings are empty

---

## 18. Recommended Fixes

### Fix 1: Correct `useMemo` dependencies (HomeModule.jsx:1967)
Change `}, [trades]);` to `}, [trades, unifiedPortfolio]);`

### Fix 2: Add symbol/notional filters (HomeModule.jsx:1932-1939)
Add filters for:
- Symbol: reject null/empty/"ASSET" fallback
- Notional: reject null/0/NaN

### Fix 3: Fix `type` field mapping (unifiedPortfolio.js:452)
Change `type: t.side || t.type || "trade"` to `type: t.type || "trade"`

### Fix 4: Fix SQL UNION ALL LIMIT (unifiedPortfolio.js:1496-1513)
Wrap UNION ALL in subquery with LIMIT, or add LIMIT to both sub-queries

### Fix 5: Fix notional fallback (HomeModule.jsx:1950)
Use `trade?.unitPrice || trade?.price` instead of just `trade?.price`

### Fix 6: Fix WhileYouWereGoneModal data source (App.jsx:10146)
Pass unified positions when legacy holdings are empty

---

## 19. Regression Test Plan

### A. Frontend Tests

- **A1**: Valid unified execution renders with all fields visible
- **A2**: NULL symbol record → 0 visible rows
- **A3**: NULL notional record → 0 visible rows
- **A4**: Zero notional record → 0 visible rows
- **A5**: Invalid timestamp record → 0 visible rows
- **A6**: Multiple same-time Hyperliquid fills → all preserved (no dedup)
- **B1**: unifiedPortfolio.transactions update → Execution Log recalculates
- **B2**: trades update while unified data exists → no stale switching
- **B3**: Bootstrap → unified transition → clean switch, no blank rows

### B. Backend Tests

- **C1**: Transaction type = "trade" (not "buy"/"sell") for normal fills
- **C2**: Normal fills not classified as cash flows
- **C3**: SQL global limit works: 50 non-Polymarket + 100 Polymarket, limit=100 → 100 total

### C. Modal Tests

- **D1**: Connected-account-only user → modal shows unified positions
- **D2**: Guest user → modal shows demo holdings
- **D3**: User with both → both shown

### D. Integration Tests

- **E1**: P&L, equity, returns not regressed
- **E2**: Journal consumers work with corrected `type` values
- **E3**: Portfolio tab consumers work with corrected data
- **E4**: Performance curve unaffected by type fix

---

## 20. Acceptance Criteria

- [ ] `recentActivityRows` reacts to `unifiedPortfolio` changes (Fix 1)
- [ ] NULL/zero notional records cannot render (Fix 2)
- [ ] NULL symbol records cannot render (Fix 2)
- [ ] Transaction `type` no longer derives from `side` (Fix 3)
- [ ] Normal fills not classified as cash flows (Fix 3 + cash-flow verification)
- [ ] Global SQL limit works across UNION ALL (Fix 4)
- [ ] Polymarket transactions remain supported (Fix 4)
- [ ] Notional fallback uses `unitPrice` for unified transactions (Fix 5)
- [ ] Multiple Hyperliquid fills preserved (no over-aggressive dedup)
- [ ] "Since You Left" modal shows connected-account positions (Fix 6)
- [ ] No regressions in P&L, equity, returns, Journal, Portfolio
- [ ] Browser/build uses current implementation
- [ ] Screenshot scenario no longer produces blank rows
