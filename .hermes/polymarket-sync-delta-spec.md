# Polymarket Address Sync — Delta Spec (Zenin-contextual)

> **This is a delta spec, not a greenfield spec.** Zenin already has the bulk of the prediction-market + unified-portfolio stack. This describes **only what's missing** and how it slots into the existing architecture. Reference template: the **Lighter DEX** integration (commit `31ee9297`) — the most recent keyless, read-only, wallet-address-keyed provider. Polymarket is the same shape; mirror it.

## 0. Architectural principle (unchanged)
Polymarket is a **prediction-market account** modeled with `source_type = "prediction"` and `access_mode = "wallet_public"` — **not** a crypto wallet and **not** a synthetic asset. USDC settlement doesn't make it crypto. This is already encoded; this work must not regress it.

## 1. Reuse, don't rebuild — what already exists

| Capability | Where | Status |
|---|---|---|
| `source_type = "prediction"` unified source type | `unifiedPortfolio.js:245,431,575,830,878` | ✅ First-class; rolls into headline value |
| Canonical position/tx/cash tables | `portfolio_source_positions/_transactions/_cash` (`unifiedPortfolio.js:65,99,87`) | ✅ Generic; prediction rows use `instrument_type='prediction'` |
| **Push-only wallet sync endpoint** | `POST /api/portfolio/prediction-wallet/sync` (`index.js:13314`) | ✅ Accepts `{walletAddress, positions, transactions}` |
| **Prediction wallet → source mapper** | `mapPredictionWalletToSource` (`unifiedPortfolio.js:564`) | ✅ Maps positions/txs; `conditionId`-friendly |
| Polymarket Gamma + Data API client | `fetchGammaJson` (`index.js:10934`), `fetchDataApiJson` (`index.js:11045`) | ✅ Reusable |
| `conditionId` first-class field | `normalizePredictionMarket` (`index.js:10902`) | ✅ Already extracted |
| FIFO realized-PnL analyzer for prediction trades | `PortfolioModule.jsx:805-858` (`predictionMarketRows`) | ✅ FIFO matches `marketType in ('prediction','polymarket','yesno')` |
| Provider whitelist/label/venue list | `validation.js:409`, `index.js:5477`, `runtimeConfig.js:99` | ✅ `polymarket` already whitelisted |
| Frontend service client | `portfolioService.js:39-58` | ✅ Implemented, **zero call sites** |

**Do NOT create** dedicated `polymarket_positions`/`prediction_market_trades` tables, a `providers/` adapter framework, a new `accountType` dimension, or a parallel portfolio model.

## 2. The delta — what's actually missing

### Δ-1. Auto-fetcher (`syncPolymarket`) — backend net-new
The push-only endpoint requires the caller to supply positions/transactions; nothing auto-pulls by address.

**File:** `backend/exchangeSync.js` — add `syncPolymarket(walletAddress, extraData, context)`, mirroring `syncLighter` (`:337-434`).
- `GET data-api.polymarket.com/positions?user=<address>` → shape to mapper's position contract (`symbol` from conditionId/slug, `name` = question, `quantity` = shares, `currentPrice`, `averageEntryPrice`, `costBasis`, `side`, `marketValue`, `currency:'USDC'`).
- `GET data-api.polymarket.com/trades?user=<address>` → `{ providerTxId (txHash/id), type:'prediction_trade', side, symbol, quantity, unitPrice, notional, fee, executedAt }`.
- **Full re-pull, no cursors** — matches every provider in this family. State the tradeoff explicitly.
- Idempotency via existing dedupe keys; use Polymarket's native `transactionHash`/`id` as `providerTxId`.
- ⚠️ Canonical tx dedupe is `DO NOTHING`, not `DO UPDATE` — corrected fills are silently ignored. Acceptable for V1.

### Δ-2. Dispatch wiring — edit the same 6 sites Lighter touched
| File:line | Edit |
|---|---|
| `exchangeSync.js:~1146` | Export `syncPolymarket` |
| `index.js:157` | Import |
| `index.js:164` | Add `"polymarket"` to `SYNC_ENABLED_EXCHANGES` |
| `index.js:5866-5879` (manual dispatch) | Add `polymarket` branch → route through `mapPredictionWalletToSource` → `recordSourceSync` |
| `index.js:13542-13565` (background dispatch + whitelist) | Add to whitelist + dispatch |
| `index.js:5912-5913, 13544-13545` (sourceType/accessMode ternaries) | `polymarket` → `sourceType:'prediction', accessMode:'wallet_public'` |

**Decision (flag, don't silently pick):** extend `POST /api/portfolio/prediction-wallet/sync` to auto-fetch when positions/txs are omitted (server-side call to `syncPolymarket`), or keep push-only + dispatch-chain only. **Recommend (a) server-side auto-fetch** — feels like Hyperliquid/Lighter to the user.

### Δ-3. Connect/disconnect UI — wire the existing zero-call-site service client
- `App.jsx` Lighter keyless-wallet connect area (`~:6170-6400`) and/or `PortfolioModule.jsx` `PortfolioConnectionsModal`.
- "Connect Polymarket" → address → `syncPredictionWalletSource({provider:'polymarket', walletAddress})`; Disconnect → `disconnectPredictionWalletSource(connectionId)`.
- Connections surface automatically via `connectedAccounts` hydration once the canonical source exists.

### Δ-4. Asset-class classification fix
`detectAssetClass` (`tradePerformance.js:44`) doesn't recognize prediction → falls through to `SPOT`. Add:
```js
if (marketType && /prediction|polymarket|yesno/i.test(marketType)) return "PREDICTION";
```
Add `"PREDICTION"` to Performance tab `ASSET_CLASSES` (`PerformanceModule.jsx:23`). Satisfies "must not be classified as Crypto" at the classification layer.

### Δ-5. Metadata passthrough (optional)
Canonical positions have **no per-position metadata JSONB** (metadata lives on parent `portfolio_sources` row).
- **(a) V1 string-encoded:** pack `conditionId`/`outcomeTokenId`/`marketSlug` into position `name`/`symbol`. Cheapest; what the mapper already does.
- **(b) V1.1 follow-up:** add `position_metadata JSONB` to `portfolio_source_positions` — generic, benefits all providers. Recommend (a) now, (b) as a portfolio-wide follow-up.

## 3. Explicitly out of scope (defer / portfolio-wide)
- **Position lifecycle state machine (OPEN→CLOSED→RESOLVED→REDEEMED):** real gap, but affects every provider (Hyperliquid/Lighter have the same "disappearing position" problem). Fix generically (`lifecycle_status` column on shared table), not Polymarket-only.
- **Incremental sync cursors:** no precedent in this family; net-new infra. Defer.
- **Resolution/redemption events, probability buckets, liquidity metrics, resolution-horizon buckets, thematic exposure:** analytics-layer; build on reliable V1 data. The original spec §21 itself says "only after history is reliable."
- **`providers/` adapter registry refactor:** a prerequisite refactor PR, not part of adding one provider.

## 4. V1 definition of done
- [ ] User connects Polymarket wallet via UI (keyless, address-only)
- [ ] `syncPolymarket` fetches positions + trades from Data API by address
- [ ] Fetched data flows through `mapPredictionWalletToSource` → `recordSourceSync` (existing path, no new tables)
- [ ] Source appears in Portfolio as `prediction`; rolls into headline value
- [ ] USDC cash included (flip `capabilities.cash` `false`→`true` at `unifiedPortfolio.js:609` + emit cash row)
- [ ] Duplicate syncs don't duplicate records (existing dedupe keys)
- [ ] Re-running sync is safe (full re-pull, idempotent upsert)
- [ ] `detectAssetClass` returns `PREDICTION`; Performance tab filter exposes it
- [ ] Connect/disconnect UI calls existing service client
- [ ] `predictionMarketRows` analyzer still works (no regression)
- [ ] Live Data API response shapes verified against a real wallet before locking the mapper

## 5. Open decisions before implementation
1. Δ-2: server-side auto-fetch (recommend) vs dispatch-chain only?
2. Δ-5: string-encoded metadata (recommend) vs `position_metadata JSONB` now?
3. Flip `capabilities.cash`→`true` and emit USDC cash row? (Recommend yes — else total value understates.)
4. Keep Polymarket behind Desk tier, or open it up?

## 6. Caveat
Derived from static code tracing, not a live Polymarket Data API call. Δ-1 field mapping must be validated against a real `/positions` and `/trades` response before locking. `fetchDataApiJson` makes that a quick check.

---

**Delivery note:** Documentation deliverable only — does not implement code. Implementation is a separate follow-up. Anchor line numbers verified against the repo on 2026-07-23: push endpoint `index.js:13314`, `mapPredictionWalletToSource` `unifiedPortfolio.js:564` (exported `:1660`), `syncLighter` mirror `exchangeSync.js:341`, `fetchDataApiJson` `index.js:11045` (already used for Polymarket trades at `:11170`), `detectAssetClass` `tradePerformance.js:44`.
