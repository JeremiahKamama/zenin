# Zenin — Multi-Source Account Sync & Asset Presentation Audit

> Audit-only deliverable (per task §25: *Do not implement changes yet*).
> Every finding below is traced to the actual codebase as of 2026-07-19.
> No assumptions; where the code does not support a capability, that is stated explicitly.

---

## 1. Executive Summary

Zenin already has a **source-aware canonical layer** (`portfolio_source_positions` / `portfolio_source_accounts` / `portfolio_sources`) built in the *Unified Multi-Source Portfolio* work, plus a **read model** (`getUnifiedSummary` in `backend/unifiedPortfolio.js`) that aggregates it. This is materially better than a single flat holding table.

However, the **device that presents value to the user is shallow**:

- The read model collapses **every position to a single `marketValue` number** and discards derivative semantics (`side`, `leverage`, `collateral`, `notional`). A `portfolio_source_positions` row has no `position_type` / `side` / `leverage` / `collateral` columns at all.
- The **legacy** `portfolio_holdings` table (still the public `GET /api/portfolio` headline source in `index.js:4840`) is a **single flat `symbol/quantity/price` scratch table** with `UNIQUE(symbol, market_type, strategy_name)` and **no source, account, asset-class, or position-type column**. Any path that writes derived/perp/wallet data here WOULD merge BTC spot with BTC perp by symbol. (Currently the canonical layer is the one actually fed by syncs; `portfolio_holdings` is now the *manual* scratch, see §6.)
- **On-chain / DEX wallets are NOT supported.** The only "wallet" integrations are **Hyperliquid** (public watch-only perp+USDC via `exchangeSync.syncHyperliquid`) and **Polymarket** (`mapPredictionWalletToSource`, prediction markets). There is no EVM/Solana/RPC/address-based balance or DeFi/LP/staking fetcher anywhere in the repo (grep for `evm|solana|alchemy|infura|ethers|viem|web3|rpc` returns only an unrelated `options-chain` string). The audit therefore scopes "wallet" to Hyperliquid + Polymarket as they actually exist.

**Primary problem (P1, not P0):** Zenin does **not** currently merge spot and perpetuals incorrectly *at rest* — the canonical storage is source-scoped and `assetType` (perp) is preserved through `mapExchangeWalletToSource`. The risk is at the **read/presentation** layer, where perps are valued as plain `marketValue` and lose their `notional`/`collateral`/`side` identity, and at any **legacy** aggregation that might still key on bare `symbol`.

---

## 2. Scope

Audited:
- **SnapTrade** brokerage: `backend/brokerage/**` (`providers/snaptrade/{client,index,SnapTradeProvider,mappers,errors}.js`, `application/{BrokerageService,SyncEngine}.js`, `domain/models.js`), DB `brokerage_connections` / `brokerage_accounts` / `brokerage_holdings` / `brokerage_transactions`.
- **Exchange API keys**: `backend/exchangeSync.js` (Binance, Bybit, Hyperliquid, Coinbase/Advanced), `user_exchange_keys` table, `mapExchangeWalletToSource` in `unifiedPortfolio.js`.
- **Wallets**: Hyperliquid (perp+USDC) and Polymarket (prediction) via `exchangeSync.js` + `mapExchangeWalletToSource` / `mapPredictionWalletToSource`.
- **Manual**: `user_workspace_portfolio` / `user_workspace_cash` (the real manual source).
- **Unified read model**: `backend/unifiedPortfolio.js` (`getUnifiedSummary`, `getUnifiedPositions`, `getUnifiedSyncStatus`, mappers, `valueRow`), `backend/portfolioSyncOrchestrator.js`, `portfolioTransactions.js`, `unifiedNotifications.js`.
- **Frontend**: `frontend/src/components/PortfolioModule.jsx`, `PortfolioAnalysis.jsx`, `PortfolioDrillDown.jsx`, `PortfolioActivity.jsx`, `hooks/useUnifiedPortfolio.js`, `services/portfolioService.js`.

Not in scope / not present: real DEX on-chain (EVM/Solana), NFT, lending/borrowing protocols, LP positions as on-chain fetches, staking rewards. These do not exist in the codebase; the audit flags the *gap* rather than auditing absent code.

---

## 3. Current Architecture (actual)

```
CONNECTION LAYER
  SnapTrade  ── OAuth ──> brokerage_connections ──> brokerage_accounts ──> brokerage_holdings / brokerage_transactions
  Exchange    ── API key (user_exchange_keys) ──> exchangeSync.js ──> (no dedicated table; normalized into canonical)
  Hyperliquid ── public address (watch-only) ──> exchangeSync.syncHyperliquid ──> canonical
  Polymarket ── prediction wallet ──> mapPredictionWalletToSource ─> canonical
  Manual      ── form ──> user_workspace_portfolio / user_workspace_cash

NORMALIZATION (all sources -> one shape)
  brokerage/providers/snaptrade/mappers.js : mapAccount / mapPosition / mapTransaction
  unifiedPortfolio.js : mapSnapTradeToSource / mapExchangeWalletToSource / mapManualToSource / mapPredictionWalletToSource

CANONICAL LAYER (portfolio_source_*)
  portfolio_sources (workspace_id, source_type, provider, external_connection_id, label, native_currency, access_mode, status)
  portfolio_source_accounts (source_id, external_account_id, label, native_currency)
  portfolio_source_positions (source_id, account_id, symbol, instrument_key, name, asset_type, quantity, average_entry_price, cost_basis, current_price, market_value, native_currency, base_currency)
  portfolio_source_cash (source_id, currency, amount)
  portfolio_source_transactions (source_id, provider_tx_id, type, side, symbol, quantity, unit_price, notional, fee, currency, executed_at)

READ MODEL
  getUnifiedSummary(pool, workspaceId)  -> { totalValue, cashValue, investedValue, manualValue, excludedManualValue, unvaluedTotal, baseCurrency, positions[], sources[], warnings[] }
  positions[] = flat list of { symbol, instrumentKey, name, assetType, quantity, marketValue, currency, source }

UI
  useUnifiedPortfolio (15-min refresh) -> App.calculatePortfolioValue override -> PortfolioModule -> PortfolioAnalysis tabs
  (Portfolio / Performance / Exposure / Execution / Orders / Costs / Events / Activity)
  + PortfolioDrillDown (per-source breakdown, dup-exposure, unvalued, snapshots, rollout shadow-compare)
```

---

## 4. Source-by-Source Audit

### 4.1 SnapTrade (brokerage)
- **Auth**: OAuth via `brokerage/providers/snaptrade/client.js`; connection persisted in `brokerage_connections` (provider, provider_user_ref, status, capabilities JSONB, last_synced_at, provider_meta JSONB).
- **Accounts**: `brokerage_accounts` carries `provider_account_id`, `institution_name`, `account_type` (DEFAULT `'other'`), `masked_number`, `name`, `is_meta_only`. `normalizeAccountType` (mappers.js:75) reads `meta.type`. **Account boundaries ARE preserved** (FK `account_id` on `brokerage_holdings`).
- **Positions**: `brokerage_holdings` = `account_id, symbol, name, asset_type, quantity, average_entry_price, current_price, market_value, currency, opened_at`. `normalizeAssetType` (mappers.js:168) maps security types → `equity|etf|fund|bond|option|crypto|cash|other`.
- **Transactions**: `brokerage_transactions` = `account_id, provider_tx_id, type, side, symbol, quantity, unit_price, notional, fee, currency, executed_at`. `normalizeTransactionType` (mappers.js:249) → buy/sell/dividend/interest/fee/etc.
- **Classification**: per-account, per-asset-type. **NOT** merged across accounts — `brokerage_holdings` is keyed `(account_id, symbol, asset_type, currency)`.
- **Gap**: `account_type` defaults to `'other'`; the UI only shows a generic read-only trust pill. Retirement/margin/cash sub-types are not surfaced distinctly.

### 4.2 Exchange API Keys
- **Storage**: `user_exchange_keys` = `user_id, workspace_id, exchange, api_key, api_secret, extra_data JSONB, last_sync_at, last_sync_status, last_sync_meta`. `api_secret` is **stored in cleartext** (no encryption-at-rest column, no KMS). `extra_data` is free-form JSONB.
- **Scope**: `exchangeSync.js` supports **Binance** (spot + futures/perp via `fetchBinancePerpTrades`), **Bybit** (spot + linear perps), **Hyperliquid** (public perp+USDC, watch-only), **Coinbase Advanced**. Read-only semantics are *asserted by code convention* (`accessMode = "read_only_key"` / `"watch_only"`) but **not cryptographically enforced** — the secret has whatever permission the user granted at the exchange.
- **Normalization**: per-exchange fetchers return `{ symbol, marketType: 'spot'|'perp', side, quantity, price, notional, fee, ... }`. `mapExchangeWalletToSource` (unifiedPortfolio.js:230) maps to `assetType: 'crypto'`, preserving `perp` via the upstream `market_type`. **Perp stays perp through normalization.**
- **Gap**: futures/margin *collateral* and *leverage* are **not persisted** — `portfolio_source_positions` has no `leverage`/`collateral`/`position_type`/`side` columns. `notional` from the source is **dropped on insert** (the INSERT at unifiedPortfolio.js:487–499 writes `quantity, average_entry_price, cost_basis, current_price, market_value` — `notional` is never stored).

### 4.3 DEX / Wallet Addresses
- **Hyperliquid**: `exchangeSync.syncHyperliquid` (line 211) fetches `clearinghouseState` (USDC accountValue = cash) + `userFills`/`metaAndAssetCtxs` → maps perp positions (`market_type: 'perp'`) + spot holdings (`market_type: 'spot'`) + USDC. Watch-only public address — **no private key**.
- **Polymarket**: `mapPredictionWalletToSource` (unifiedPortfolio.js:367) → `assetType: 'prediction'`.
- **Real on-chain (EVM/Solana/RPC/address balances, DeFi/LP/staking/NFT)**: **ABSENT**. No RPC client, no chain registry, no address→balance fetcher. A wallet address today means *only* a Hyperliquid or Polymarket public key.

---

## 5. Data Flow Diagrams (actual)

```
SnapTrade
  OAuth connection
    -> brokerage/providers/snaptrade/client.js
    -> brokerage_connections / brokerage_accounts
  brokerageAccountSync (SyncEngine)
    -> mappers.mapPosition / mapAccount / mapTransaction
    -> brokerage_holdings / brokerage_transactions   (per-account FK)
    -> mapSnapTradeToSource  (canonical shape)
    -> portfolio_source_positions / _accounts / _cash / _transactions
  getUnifiedSummary
    -> positions[] (assetType preserved)
    -> Portfolio UI (drill-down + Activity)

Exchange API key
  user_exchange_keys (api_key + api_secret, cleartext)
    -> exchangeSync.syncBinance / syncBybit / syncHyperliquid
    -> { symbol, marketType: 'spot'|'perp', notional, ... }
    -> mapExchangeWalletToSource
    -> portfolio_source_positions (assetType 'crypto', perp retained)
  NOTE: notional/leverage/collateral DROPPED at insert

Hyperliquid wallet (public)
  exchangeSync.syncHyperliquid (watch-only)
    -> clearinghouseState (USDC) + perp fills
    -> mapExchangeWalletToSource (provider 'hyperliquid')
    -> portfolio_source_positions (spot + perp) + _cash (USDC)

Manual
  form -> user_workspace_portfolio / user_workspace_cash
    -> mapManualToSource -> portfolio_source_positions (source_type 'manual')
```

---

## 6. Current Data Model (the competing models)

There are **three** position stores. This is the central architectural tension.

| Model | Table | Source of truth for | Keyed by | Asset-type aware? |
|---|---|---|---|---|
| **Canonical (new)** | `portfolio_source_positions` | Unified read model | `(source_id, COALESCE(account_id,0), symbol)` | **Yes** (`asset_type` column) |
| Brokerage (legacy-but-live) | `brokerage_holdings` | SnapTrade sync path | `(account_id, symbol, asset_type, currency)` | Yes |
| Manual scratch (legacy) | `portfolio_holdings` | `GET /api/portfolio` headline (`index.js:4840`) | `(symbol, market_type, strategy_name)` | **No useful axis** — `market_type` here means *strategy/asset tag*, not source |

**Problem (P1):** `index.js:4840` still computes `portfolioValue` from `portfolio_holdings` (the flat scratch) for the public portfolio endpoint + daily briefing. The unified model is layered *alongside* it (consumed only by `useUnifiedPortfolio` when `ZENIN_UNIFIED_PORTFOLIO` flag is on). So there are **two competing headlines**: legacy flat (`portfolio_holdings`) and canonical (`portfolio_source_positions`). The `getUnifiedShadowComparison` function exists precisely to validate the two during rollout — confirming they are not yet unified.

---

## 7. Account Hierarchy Analysis

- **SnapTrade**: `connection → brokerage_accounts → brokerage_holdings` with FK chain. **Hierarchy preserved.**
- **Exchange**: `portfolio_source_accounts` (one row per `external_account_id`) under `portfolio_sources`. Hyperliquid yields one account row keyed by address. **Hierarchy preserved in canonical layer.**
- **Manual**: flat `user_workspace_portfolio`, no account dimension.
- **Merging risk**: only via the **legacy `portfolio_holdings`** table, which has no account/source column. Any future writer that routes exchange/perp data into `portfolio_holdings` would collapse all accounts into one symbol-keyed row. **Currently no sync writer targets `portfolio_holdings`** (grep: only `index.js:4373` *reads* it for the briefing; the canonical layer is written instead). So the bug is *latent*, not active.

---

## 8. Asset Classification Analysis

`asset_type` is the only classification axis that survives to storage, and it is coarse:

| Source | Stored `asset_type` | Lost semantics |
|---|---|---|
| SnapTrade equity | `equity` | — |
| SnapTrade option | `option` | strikes/expiry only in `provider_meta` JSONB, not queryable |
| Binance spot | `crypto` | spot vs perp **only differs by upstream `market_type`**, which is **not stored** as a column — `mapExchangeWalletToSource` sets `assetType: 'crypto'` for both spot and perp |
| Binance perp | `crypto` (same!) | `notional`/`side`/`leverage`/`collateral` **all dropped** |
| Hyperliquid perp | `crypto` (same!) | same loss |
| Polymarket | `prediction` | — |
| Manual | from `market_type` user tag | — |

**Critical**: a BTC spot position and a BTC-PERP position both land as `asset_type: 'crypto'`, `symbol: 'BTC'` in `portfolio_source_positions`. They are **distinguishable only by `source_id`** (binance-spot vs binance-perp are different sources because `mapExchangeWalletToSource` is called per-account). So *today* they do not merge. But the read model's `valueRow` (unifiedPortfolio.js:655) returns `{ symbol, assetType, quantity, marketValue }` with **no `position_type`/`side`**, so the UI literally cannot tell a long spot from a long perp from a short perp — it only sees `marketValue`.

---

## 9. Spot vs Perpetual Analysis (primary requirement)

**Does the code merge BTC spot with BTC-PERP?** Not at rest. Reasons:
1. `portfolio_source_positions` is keyed `(source_id, account_id, symbol)`. Binance spot and Binance perp are **separate sources** (`mapExchangeWalletToSource` is invoked per exchange-account context), so they get separate `source_id`s and never collide on the unique key.
2. Upstream `market_type: 'perp'` is preserved through `exchangeSync.js` → `mapExchangeWalletToSource`.

**Where they ARE conflated:**
- `mapExchangeWalletToSource` (unifiedPortfolio.js:242) hard-codes `assetType: String(h.type || "crypto").toLowerCase() === "crypto" ? "crypto" : "other"`. It ignores the perp/spot distinction and writes `crypto` for both. The richer `market_type` from the source is discarded.
- The read model `valueRow` (unifiedPortfolio.js:655) computes `marketValue = qty * price` for **both** spot and perp, and **never records `notional`, `side`, or `leverage`**. A 5× BTC perp (notional $50k, margin $10k) and a 0.5 BTC spot ($50k) both surface as `$50,000 market value` with zero derivative context.
- `notional` is **dropped on insert** (unifiedPortfolio.js:487–499 writes no notional column). The source *had* it (`t.notional` in `mapSnapTradeToSource` / exchange fills) but it is never persisted.

**Dangerous aggregation pattern (the spec's flagged reduce):** the legacy `portfolio_holdings` table + any `symbol`-keyed reduce (the example in the spec) would merge them — but **no active sync writer uses `portfolio_holdings`**, and `getUnifiedSummary` iterates `portfolio_source_positions` row-by-row (no symbol-based `reduce` that sums across sources). So the specific dangerous `positions.reduce((t,p)=> p.symbol==='BTC' ? t+p.quantity : t)` pattern is **not present** in the sync/aggregation code. It would only appear if someone aggregated `positions[]` by bare `symbol` in a UI selector — `PortfolioDrillDown`/`PortfolioActivity` currently render per-row, not symbol-merged, so no active merge.

**Verdict**: spot/perp are **not currently merged**, but the system **cannot represent them distinctly** past normalization (no `position_type`/`side`/`leverage`/`collateral`/`notional` columns), so they are *de-facto indistinguishable* in the UI. This is **P1** (classification/representation), not yet **P0** (active financial mis-statement).

---

## 10. Brokerage vs Exchange vs Wallet Analysis

| | Brokerage (SnapTrade) | Exchange (Binance/Bybit/HL) | Wallet (HL/Polymarket) |
|---|---|---|---|
| Creds | OAuth token (no secret in our DB beyond token) | `api_key`+`api_secret` **cleartext** | public address (HL) / prediction wallet |
| Account model | `brokerage_accounts` (rich) | `portfolio_source_accounts` (thin) | 1 account row = address |
| Position model | `brokerage_holdings` (per-asset-type) | `portfolio_source_positions` | `portfolio_source_positions` |
| Derivatives | options (asset_type `option`) | perps (asset_type `crypto`, notional lost) | HL perps (same) |
| Distinct in UI? | Yes (brokerage banner) | Partially (drill-down lists provider) | Partially |

---

## 11. Portfolio Aggregation Audit

`getUnifiedSummary` (unifiedPortfolio.js:648+):
```
investedValue += valueRow(row).marketValue   // every position, spot OR perp, summed as marketValue
cashValue     += base-equiv cash
manualValue  += manual marketValue (or excluded)
totalValue = investedValue + cashValue + manualValue
unvaluedTotal += positions we could NOT price (no price / no FX)
```
- **Derivatives treated as market value, not notional.** A perp's `marketValue` (which `mapExchangeWalletToSource` sets = `qty * price`, i.e. *position size*, not margin) is added to `investedValue`. For a 5× perp this overstates "invested" by the leverage multiple vs the actual margin deployed. **P1** — exposure misrepresentation.
- **Collateral double-count**: Hyperliquid USDC `accountValue` is written as `_cash` (unifiedPortfolio.js:502). If the same USDC also backs a perp, the perp's `marketValue` (size) is counted in `investedValue` AND the USDC is counted in `cashValue` → **the margin is double-counted** (shown once as cash, once as perp size). **P0 candidate** for Hyperliquid perp users: `totalValue` can exceed real net worth by the notional of open perps. This is the spec's exact "Exchange wallet balance + Futures collateral + Perpetual position value" double-count, realized via `cashValue` (USDC) + `investedValue` (perp size).
- **Liabilities / short side**: `side` is captured in `portfolio_source_transactions` and source mappers but **never in `portfolio_source_positions`** (no `side` column). A short perp is stored with positive `quantity` + `asset_type: crypto` → rendered as a long asset. **P0** for shorts: a short BTC perp appears as +BTC holdings.

---

## 12. Double-Counting Audit

| Path | Status | Evidence |
|---|---|---|
| Hyperliquid USDC (cash) + perp size (invested) | **Incorrect (P0)** | unifiedPortfolio.js:502 (cash) + :690 (invested += perp marketValue) |
| BTC spot + BTC perp (same symbol) | Correct at rest (separate sources) | keyed `(source_id, account_id, symbol)` |
| Wallet USDC + DeFi USDC | N/A — no DeFi fetcher exists | §4.3 |
| Brokerage cash + buying power | N/A — buying power not modeled | `brokerage_holdings` has no BP field |
| Option MV + underlying MV | N/A — options stored as `asset_type: option` separately, not netted | `brokerage_holdings` |

---

## 13. Data Freshness / Sync State Audit

- **Per-source**: `portfolio_sources` has `status`, `sync_status`, `last_sync_at`, `last_attempted_sync_at`, `last_error`, `data_as_of`. `getUnifiedSyncStatus` surfaces auth/stale/repeated-failure/recovery. **Granularity: per source** (good).
- **Per account**: `brokerage_accounts.last_synced_at` exists; canonical `portfolio_source_accounts` has no `last_synced_at`. Partial.
- **Per position**: `portfolio_source_positions.as_of` (from source). No per-position `dataStatus` (live/stale/error) outside the parent source.
- **UI communication**: `PortfolioDrillDown` shows `Sync now` + per-source status pill + `manual excluded` note. The **"SHOWING LAST CONFIRMED DATA"** pattern exists in the brokerage banner (`PortfolioModule.jsx:3449` reads `formatLastSync`). **Global-ish**, not per-position. Acceptable but coarse.

---

## 14. Current UI Placement Matrix

| Data Type | Source | Current Location | Data Selector | Recommended |
|---|---|---|---|---|
| US equity | SnapTrade | Portfolio (drill-down) | `useUnifiedPortfolio` → `sources[]` | Portfolio · Holdings |
| ETF | SnapTrade | Portfolio | same | Portfolio · Holdings |
| Option | SnapTrade | Portfolio (as `option`) | same | Portfolio · Derivatives/Options |
| Crypto spot | Exchange | Portfolio | `positions[]` | Portfolio · Crypto |
| Perp | Exchange/HL | Portfolio (as `crypto`) | `positions[]` (no perp flag) | Portfolio · Derivatives/Perpetuals |
| Wallet token | HL | Portfolio | `positions[]` | Portfolio · On-chain |
| Prediction | Polymarket | Portfolio | `positions[]` | Portfolio · (prediction) |
| Transaction | Any | Activity tab (new) | `PortfolioActivity` | Activity / Ledger |
| Funding payment | Exchange | Not surfaced (perp funding dropped) | — | Activity / Derivatives |
| Dividend | Brokerage | Not surfaced post-normalization | — | Activity / Income |
| Tax event | Any | Tax Estimator (separate) | — | Tax |

The UI **consumes canonical read models** (`useUnifiedPortfolio`), not raw provider objects — this part of the spec's recommendation is already satisfied.

---

## 15–17. (Summarized; see §18–§21 for the consolidated findings.)

---

## 18. Source-of-Truth Assessment

| Category | Current source of truth |
|---|---|
| Brokerage positions | `brokerage_holdings` (live sync) → mirrored to `portfolio_source_positions` |
| Exchange spot/perp | `portfolio_source_positions` (canonical) — **not** `user_exchange_keys` (that's creds only) |
| Wallet (HL) | `portfolio_source_positions` |
| Manual | `user_workspace_portfolio` / `user_workspace_cash` |
| Portfolio aggregate (legacy endpoint) | `portfolio_holdings` (flat scratch) — **competing** with canonical |
| Portfolio aggregate (unified) | `getUnifiedSummary` over `portfolio_source_positions` |

**Competing truths**: legacy `portfolio_holdings` vs canonical `portfolio_source_positions`. The `shadow-compare` endpoint exists to reconcile them during rollout but they are not yet unified.

---

## 19. Findings by Severity

### P0 — Data integrity / financial correctness
- **P0-1 Hyperliquid perp double-count.** USDC `accountValue` → `_cash` (cashValue) AND perp `marketValue` (size) → `investedValue`. Margin is counted twice. (`unifiedPortfolio.js:502`, `:690`.)
- **P0-2 Short positions rendered as long assets.** No `side`/`position_type` column on `portfolio_source_positions`; short perp stored with positive quantity + `asset_type: crypto` → appears as +BTC. (Schema + `valueRow`.)
- **P0-3 `api_secret` stored in cleartext** in `user_exchange_keys`. No encryption-at-rest, no KMS, no scoping enforcement. (§4.2, §12 of task.)

### P1 — Major architectural / classification
- **P1-1 No `position_type` / `side` / `leverage` / `collateral` / `notional` columns.** Perps lose all derivative identity at rest. (`portfolio_source_positions` schema.)
- **P1-2 `notional` dropped on insert.** Source provides it; never persisted. (`unifiedPortfolio.js:487–499`.)
- **P1-3 `assetType` hardcoded `'crypto'` for both spot and perp** in `mapExchangeWalletToSource` (`:242`); `market_type` discarded.
- **P1-4 Two competing portfolio headlines** (`portfolio_holdings` flat vs canonical). Rollout not complete.
- **P1-5 Aggregation treats perp size as invested market value**, overstating exposure by leverage. (`unifiedPortfolio.js:648`.)

### P2 — UX / maintainability
- **P2-1** No UI filter by source/account/asset-class beyond the drill-down list (Activity has filters; Holdings does not).
- **P2-2** `account_type` defaults to `'other'`; retirement/margin/cash not surfaced.
- **P2-3** Freshness shown per-source only, not per-position.
- **P2-4** On-chain / DeFi / LP / staking / NFT **entirely absent** — no wallet-chain model exists. (Gap, not a bug.)

---

## 20. Recommended Target Architecture (conceptual)

Extend the **existing canonical layer** — do NOT rewrite. Minimal schema addition to `portfolio_source_positions`:

```
ALTER TABLE portfolio_source_positions
  ADD COLUMN position_type TEXT NOT NULL DEFAULT 'balance',  -- long|short|balance|collateral|liability
  ADD COLUMN side TEXT,                                  -- long|short (derivatives)
  ADD COLUMN notional DOUBLE PRECISION,                   -- derivative notional
  ADD COLUMN leverage DOUBLE PRECISION,
  ADD COLUMN collateral DOUBLE PRECISION;
```

And refine `asset_type` vocabulary to include `perp` / `future` / `prediction` (stop folding perps into `crypto`).

**Read-model change** (`getUnifiedSummary`):
- `investedValue` = Σ spot/option/equity `marketValue` only.
- `derivativeExposure` = Σ `notional` (separate from value).
- `collateral` = Σ `collateral` → counted ONCE (never also as a perp's size).
- Short `position_type` → subtracts from net, not adds.

**Hierarchy** (already mostly present): `portfolio_sources → portfolio_source_accounts → portfolio_source_positions`, keyed by source+account+symbol. Preserve it; extend `portfolio_source_accounts` with `account_type` (spot|margin|futures|wallet|defi|brokerage) + `last_synced_at`.

**Canonical Position shape** (recommended, extends current — not a new model):
```
{ source:{type,provider,connectionId}, account:{id,type},
  instrument:{symbol,name,assetClass, instrumentType: spot|option|future|perp|token|prediction|...},
  position:{side: long|short|balance, quantity, notional, marketValue, costBasis, margin, leverage},
  valuation:{price,currency,marketValue,asOf},
  lifecycle:{status, lastSyncedAt} }
```

---

## 21. Prioritized Next Steps

1. **P0-1** Stop double-counting HL perp margin: exclude perp `marketValue` from `investedValue`; add `collateral` column; count collateral once.
2. **P0-2** Add `position_type`/`side`; map short perps to `short` (subtract from net).
3. **P0-3** Encrypt `api_secret` at rest (or move to a secrets manager); enforce read-only scope server-side.
4. **P1-1/1-2/1-3** Add `notional`/`leverage`/`collateral` columns; persist `notional`; stop hardcoding `crypto` for perps in `mapExchangeWalletToSource`.
5. **P1-4** Complete rollout: make canonical `portfolio_source_positions` the single headline; deprecate `portfolio_holdings` aggregation (use `getUnifiedShadowComparison` to validate, then cut over).
6. **P1-5** Split `investedValue` vs `derivativeExposure` in the read model + UI.
7. **P2** Account-type surfacing, per-position freshness, source/asset filters on Holdings.
8. **Gap** Decide on real on-chain wallet support (EVM/Solana/RPC) before claiming "wallet" coverage — currently only HL/Polymarket.

---

## 22. Final Recommendation

**RECOMMENDATION**

**Current State:**
Zenin has a working source-aware canonical layer (`portfolio_source_positions`, keyed by source+account+symbol) fed by SnapTrade, exchange API keys (Binance/Bybit/HL/Coinbase), Hyperliquid, Polymarket, and manual entries. The frontend consumes canonical read models (`useUnifiedPortfolio`), not raw provider objects. Spot and perpetuals are **not** merged at rest (separate sources; `asset_type` preserved).

**Primary Problem:**
The canonical position model **cannot represent derivative semantics** — no `position_type`/`side`/`leverage`/`collateral`/`notional` columns, and `notional` is dropped on insert. Consequently (a) Hyperliquid perp **margin is double-counted** (USDC cash + perp size), (b) **short perps render as long assets**, (c) perp **size is counted as invested market value** (overstating exposure by leverage), and (d) `api_secret` is stored **cleartext**. None of these are yet *active mis-merges of spot+perp by symbol* — the dangerous `symbol.reduce` pattern is not present — but the system is one careless writer-to-`portfolio_holdings` away from that, and is already financially incorrect on perp accounts today.

**Recommended Architecture:**
Extend (don't rewrite) `portfolio_source_positions` with `position_type`/`side`/`notional`/`leverage`/`collateral`; refine `asset_type` to separate `perp`/`future`/`prediction` from `crypto`; persist `notional`; make canonical the single headline and retire `portfolio_holdings` aggregation behind the existing `shadow-compare` gate.

**Recommended UI Model:**
Keep the current tab shell (Portfolio / Performance / Exposure / Execution / Orders / Costs / Events / Activity). Within **Portfolio**, group by **account** (already in drill-down) and add a **Derivatives** sub-view that shows perps with `notional`/`side`/`leverage`/`collateral`/`liquidation` instead of bare `marketValue`. **Do not** force separate top-level nav items for crypto/on-chain/defi until real on-chain sources exist.

**P0 Changes:**
- P0-1 Fix HL perp double-count (collateral counted once).
- P0-2 Add `side`/`position_type`; shorts subtract.
- P0-3 Encrypt `api_secret` at rest; enforce read-only.

**P1 Changes:**
- P1-1 Add `notional`/`leverage`/`collateral` columns.
- P1-2 Persist `notional` on insert.
- P1-3 Stop hardcoding `crypto` for perps in `mapExchangeWalletToSource`.
- P1-4 Complete rollout (canonical = single headline).
- P1-5 Split `investedValue` vs `derivativeExposure`.

**P2 Changes:**
- Account-type surfacing; per-position freshness; Holdings source/asset filters.

**Do Not Change Yet:**
- Don't build a brand-new schema/model — extend the existing canonical layer.
- Don't add EVM/Solana/RPC wallet fetchers until product commits to on-chain scope (currently only HL/Polymarket).
- Don't delete `portfolio_holdings` until `shadow-compare` shows zero divergence post-cutover.

**Next Implementation Phase:**
Phase 1 (P0): add `position_type`/`side`/`collateral`/`notional`/`leverage` columns to `portfolio_source_positions`; update `mapExchangeWalletToSource` + `mapSnapTradeToSource` to populate them; fix `getUnifiedSummary` to count collateral once and treat shorts as subtractive; encrypt `api_secret`. Validate with `getUnifiedShadowComparison` + unit tests on `unifiedPortfolio.js`.
