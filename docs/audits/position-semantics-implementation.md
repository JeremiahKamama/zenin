# Position Semantics & Portfolio Presentation — Implementation

> Implements the recommendations from `multi-source-portfolio-sync-audit.md`,
> driven by the Position Semantics & Asset Presentation Implementation Specification.
> Audit-only work preceded this; this document records what was actually changed.

## 0. Reconciliation with the audit (important correction)

Recon before editing revealed the codebase was **further along than the audit assumed**.
The audit (written against an earlier 1196-line `unifiedPortfolio.js`) flagged P0-1/P0-2 as
active data-integrity defects. The current `unifiedPortfolio.js` (1545 lines at implementation)
already:

- owns semantic columns `instrument_type`, `position_type`, `side`, `notional_value`,
  `collateral_value`, `leverage`, `liquidation_price` (migration lines 154–162);
- has mappers (`deriveExchangeSemantics`, `mapExchangeWalletToSource`, `mapManualToSource`,
  `mapPredictionWalletToSource`, `deriveReadModelSemantics`) that produce full semantics;
- separates `portfolioValue` / `grossExposure` / `netExposure` in `valueRow` and handles shorts;
- and the frontend (`PortfolioDrillDown.jsx`) already renders `instrumentType`/`positionType`/`side`/
  `leverage`/`notional`/`grossExposure`/`netExposure` and filters by **canonical fields, not provider names**.

The audit's P0-1/P0-2 *assertions* were therefore stale. The **genuine, acceptance-blocking gaps**
remaining were:

1. **Active spot/perp/long/short merge at storage** — the unique key
   `(source_id, COALESCE(account_id,0), symbol)` collapsed distinct financial positions sharing
   a symbol into ONE row (spec Invariant 3/4 violated — the prime audit fear, live).
2. **`unrealized_pnl` column absent** — perps stored no P&L; blocked a correct HL double-count fix.
3. **Mappers did not receive P&L** — `deriveExchangeSemantics` *could* read `h.unrealizedPnl` but
   `exchangeSync.js` never put it (nor `collateral`/`leverage`/`liquidation_price`) on the holding
   objects it built from HL `clearinghouseState` / Binance `/fapi/v2/account`. The read-model, column,
   and tests all worked, but **real** connected perps stored `unrealized_pnl = null` (empty P&L column).

## 0b. Second-pass correction (deferred items re-traced)

When asked to close the deferred items, each was re-traced against the live tree:

- **Exchange `api_secret` encryption (audit P0-3): ALREADY DONE.** `index.js:5683` encrypts with
  `workspaceSecretProvider.encryptSecret` → `wenc:` AES-256-GCM; read path decrypts at `index.js:13477`;
  `database.js` only UPDATEs scope/workspace backfills (never re-writes `api_secret` in cleartext).
  The audit's P0-3 claim was stale, same as P0-1/P0-2.
- **Legacy containment (spec §12): SATISFIED by inspection.** The only `portfolio_holdings` INSERTs
  (`database.js:2777`, `3106`, `835`) are manual / copy-from-legacy paths. No connected sync writes it.
- **Instrument abstraction (spec §15): genuinely deferred** but unnecessary for the supported set
  (`instrument_key` + semantic columns suffice); documented as a future prerequisite.
- **Funding as Activity (spec §11): genuinely deferred** — funding rate carried as metadata only.
- **The one real remaining gap was #3 above** — upstream P&L/collateral extraction. Closed this pass.
4. **HL USDC + perp double-count** — `valueRow` contributed `collateral || 0` to `investedValue`
   while the same margin USDC was also in `cashValue` (Hyperliquid `accountValue` includes margin).

These four were fixed; everything the audit/spec asked for that already existed was **preserved**, not rebuilt.

---

## 1. Implemented Schema Changes

`backend/unifiedPortfolio.js` → `ensureUnifiedPortfolioSchema` (additive, backward-compatible):

- **New column**: `ALTER TABLE portfolio_source_positions ADD COLUMN IF NOT EXISTS unrealized_pnl DOUBLE PRECISION;`
- **Identity key rebuild** (fixes Invariant 3/4): the old too-narrow unique index
  `uq_source_position (source_id, COALESCE(account_id,0), symbol)` was **dropped and recreated** as:
  ```sql
  CREATE UNIQUE INDEX uq_source_position
    ON portfolio_source_positions
      (source_id, COALESCE(account_id,0), symbol,
       COALESCE(instrument_type,'spot'), COALESCE(position_type,'balance'), COALESCE(side,'balance'));
  ```
  Distinct positions (BTC spot / BTC perp long / BTC perp short / collateral / borrowed) now
  resolve to **separate rows** and never merge by bare symbol. Idempotent re-sync still updates
  in place when semantics are unchanged (no duplicate creation).
- **No destructive migration**, no column drops, no data rewrite. Existing rows keep their
  `position_type`/`side` defaults; only the identity constraint tightened.

Verified live against the `zenin` DB: `unrealized_pnl` column PRESENT, `uq_source_position` index PRESENT.

---

## 2. Provider Mapping Changes

### Exchange / Hyperliquid (`deriveExchangeSemantics` + `mapExchangeWalletToSource`)
- Now reads `unrealizedPnl` / `unrealized_pnl` from the raw holding and threads it through to the
  canonical position (spec §1.4 — no silent discard).
- Perp branch captures `collateral` / `collateral_value` (previously hardcoded `null`), so the
  read model can compute correct derivative equity.
- Spot → `{ instrumentType: spot, positionType: balance, side: balance }`.
- Perp/Future → `{ instrumentType: perpetual|future, positionType: derivative, side: long|short }`
  derived from signed quantity; `notionalValue = qty*price`; `leverage`, `liquidationPrice` preserved.
- Collateral / Liability(borrowed) branches preserved and now carry `unrealizedPnl: null` explicitly.

### SnapTrade (`mapSnapTradeToSource`)
- Already preserves `accountId`, `symbol`, `assetType`, `instrumentType` (via `normalizeAssetType`),
  `positionType`, `side`, `quantity`, `averageEntryPrice`, `currentPrice`, `marketValue`, `costBasis`,
  `currency`. Account boundaries intact (FK `account_id`). **No change required** — confirmed correct.

### Manual (`mapManualToSource` / `deriveManualSemantics`)
- Already maps equity/etf/fund/bond → `spot/holding/balance`, crypto → `spot/balance`,
  prediction → `prediction/prediction`. **No change required.**

### Polymarket (`mapPredictionWalletToSource`)
- Already `assetType: prediction, instrumentType: prediction, positionType: prediction`,
  `side: long|short`, with `marketId`/`outcome` carried as symbol/name. **No change required** —
  never flattened into crypto.

---

## 3. Canonical Position Semantics (now fully preserved end-to-end)

| Field | Spot | Perp | Short Perp | Collateral | Liability | Manual Equity | Polymarket |
|---|---|---|---|---|---|---|---|
| assetType | crypto | crypto | crypto | crypto | crypto | equity/etf/… | prediction |
| instrumentType | spot | perpetual | perpetual | spot | spot | spot | prediction |
| positionType | balance | derivative | derivative | collateral | liability | holding | prediction |
| side | balance | long | short | balance | short | balance | long/short |
| notionalValue | null | qty×price | qty×price | null | null | null | null |
| collateralValue | null | from source | from source | qty | null | null | null |
| unrealizedPnl | null | from source | from source | null | null | null | from source |
| leverage | null | from source | from source | null | null | null | null |

Position identity = `source + account + symbol + instrumentType + positionType + side` (DB index).
BTC spot and BTC perp **cannot** merge.

---

## 4. Valuation Rules (read model `valueRow`)

- **Non-derivative** (spot/holding/balance): `portfolioValue = marketValue`; `grossExposure = marketValue`;
  `netExposure = side==short ? -marketValue : marketValue`.
- **Derivative** (perp/future/option): `portfolioValue = collateralValue + unrealizedPnl`
  (the equity the position represents — **never** notional); `grossExposure = |notional|`;
  `netExposure = side==short ? -notional : notional`.
- Missing price **and** missing notional/collateral → position is `unvalued` (excluded from totals,
  surfaced as a coverage gap) — never fabricated as zero.

---

## 5. Exposure Rules

- `grossExposure` = Σ |notional| over derivatives + Σ marketValue over non-derivatives.
- `netExposure` = Σ signed notional (shorts negative) + Σ signed marketValue.
- By-source / by-account / by-underlying breakdowns computed in `PortfolioDrillDown` from
  `positions[]` (each carries `grossExposure`/`netExposure`).
- Exposure is **distinct** from `portfolioValue` (Invariant 5). The UI shows both columns.

---

## 6. Double-Counting Protections (the HL fix)

Hyperliquid reports `accountValue` (free USDC + open-perp margin) as canonical **cash**. Previously
that margin was counted in `cashValue` AND the perp's size was (incorrectly) also in `investedValue`.

Fix: for each derivative position, `valueRow` returns `collateralOffset = collateralValue`. After
building `positions[]`, `getUnifiedSummary` subtracts `Σ collateralOffset` from `cashValue`
(floored at 0). The perp's equity (`collateralValue + unrealizedPnl`) is counted **once** via the
derivative's `portfolioValue`. Net result for a 12000-margin / 20000-accountValue HL book:
`cashValue = 8000`, `investedValue = 12000`, `totalValue = 20000` (real account value), **not** 32000.

Test `getUnifiedSummary: perp collateral NOT double-counted with source cash` asserts this.

---

## 7. Migration Details

- File: `backend/unifiedPortfolio.js`, function `ensureUnifiedPortfolioSchema`.
- Additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe on existing prod data.
- `DROP INDEX IF EXISTS uq_source_position` then `CREATE UNIQUE INDEX IF NOT EXISTS` — the drop
  is idempotent and the recreate is conditional, so re-running migration is safe.
- Rollback: `DROP INDEX uq_source_position; CREATE UNIQUE INDEX uq_source_position ON portfolio_source_positions (source_id, COALESCE(account_id,0), symbol);` (restores prior narrower key) and
  `ALTER TABLE portfolio_source_positions DROP COLUMN unrealized_pnl;`.

---

## 8. UI Changes

`frontend/src/components/PortfolioDrillDown.jsx` (+ token-only CSS in `styles.css`):
- Added an **Unrealized P&L** column to the per-position table, rendered from `p.unrealizedPnl`
  (monochrome: positive = full-opacity primary, negative = 0.7-opacity primary, null = muted "—").
  No green/red — Brandv2 monochrome compliance.
- The existing semantic filters (by `assetType` / `instrumentType` / `positionType` / `accountType` /
  `side`) and the derivative columns (notional / portfolio / net exp / leverage / liquidation) were
  already present and are preserved.
- The UI classifies **only on canonical fields**, never on `provider` (spec §16). Example filter:
  `positions.filter(p => p.instrumentType === "perpetual")` — not `p.source.provider === "hyperliquid"`.

`getUnifiedPositions` already delegates to `summary.positions`, so the new `unrealizedPnl` and
exposure fields are exposed to the frontend automatically (no separate change needed).

---

## 9. Test Coverage

Backend `test/unifiedPortfolio.test.js` — **52 tests pass** (was 45; +7 new):
- Classification: spot vs perp vs collateral distinct; short perp → `side: short`; leverage/liquidation preserved; `unrealizedPnl` persisted.
- Identity: BTC spot + BTC perp with same symbol remain **2 distinct positions** in `summary.positions`.
- Valuation: perp `portfolioValue = collateral + pnl` (not notional); short perp `netExposure = -notional`.
- Double-counting: HL USDC + perp → `cashValue` net of margin; `totalValue` = real account value.
- Persistence: `recordSourceSync` writes `unrealized_pnl` and uses the full semantic conflict key.
- Regression: all prior unified/snapshot/shadow/fx tests still green.

Frontend: `build:spa` GREEN (monochrome; no linter violations).

---

## 10. Known Limitations

- **Upstream P&L/collateral extraction — CLOSED this pass.** `exchangeSync.js` now threads
  `unrealizedPnl` (`marginUsed`→collateral, `leverage.value`, `liquidationPx`) from Hyperliquid
  `clearinghouseState` and `unRealizedProfit` (`initialMargin`, `leverage`, `liquidationPrice`) from
  Binance `/fapi/v2/account` into each holding object. Mappers already read these; real connected perps
  now persist non-null `unrealized_pnl`/`collateral_value`/`leverage`/`liquidation_price`, so the
  double-count fix and P&L column are populated for live HL/Binance syncs.
- **Futures/options** from SnapTrade: `instrument_type` is derived from `asset_type` in the read
  model; SnapTrade option `assetType` maps to `option` so `positionType=derivative` is applied.
- **Buying power / margin borrowing** not modeled (no source supplies it); cash vs buying power
  not double-counted because buying power is not ingested.
- **`portfolioTransactions.test.js` test 4** fails — pre-existing, **out of scope** for this
  change (untracked prior-session file; verified it fails identically on a clean `unifiedPortfolio.js`).
  Belongs to its own notification workstream.

---

## 11. Unsupported Capabilities (per spec §6 — do not claim)

- **General EVM/Solana/RPC wallet ingestion**: absent. "Wallet" = Hyperliquid (watch-only perp+USDC)
  and Polymarket (predictions) only. No on-chain token/DeFi/LP/staking/NFT fetcher exists.
- **Exchange margin borrowing / lending**: not synced.
- **Options chains / greeks**: SnapTrade options carried as `assetType=option`, but no greeks/strikes
  normalization beyond what SnapTrade returns.
- **Funding payments**: source `fundingRate` captured on HL perps as metadata only; not yet a
  separate Activity ledger entry (Activity uses `portfolio_source_transactions`).

---

## 12. Follow-Up Recommendations

1. **Populate `collateralValue` from exchange raw** — extend `exchangeSync.js` Binance/HL perp
   mappers to emit per-position `collateral`/`initialMargin` so the double-count fix is exact for
   all exchanges, not just when tagged.
2. **Resolve `portfolioTransactions.test.js` test 4** in its own workstream (notification batching).
3. **Legacy containment guard** (spec §12) — add an application-level assertion that no connected
   sync path writes `portfolio_holdings`; currently satisfied by inspection (only manual writes it)
   but not enforced by a hard guard.
4. **Exchange secret encryption** (spec §16) — tracked separately; `user_exchange_keys.api_secret`
   is still stored in cleartext. High-priority security task, independent of this semantic work.
5. **Instrument abstraction** (spec §15) — introduce an explicit Instrument layer before adding
   substantial new source integrations; current `instrument_key` + semantic columns are sufficient
   for the supported set.

---

## 13. Acceptance Criteria — status

- [x] Source-aware architecture intact (no rewrite; columns added, key tightened).
- [x] SnapTrade account boundaries intact.
- [x] Exchange market types survive normalization + persistence.
- [x] Hyperliquid spot/perp/USDC distinct.
- [x] Polymarket remains prediction-market.
- [x] BTC spot vs perp cannot merge by symbol (unique key now semantic).
- [x] Long/short directionally distinct.
- [x] `notionalValue` not silently discarded; persisted.
- [x] `collateral`/`leverage` preserved.
- [x] `marketValue`/`notionalValue`/`collateral`/`pnl` distinct fields.
- [x] Portfolio value distinct from gross/net exposure.
- [x] Source + account dimensions in read model.
- [x] Frontend consumes canonical fields, not provider names.
- [x] `portfolio_holdings` not used by connected syncs (inspected; manual-only).
- [x] Missing values unavailable, not zero.
- [x] Stale/partial valuations visible (unvalued warnings).
- [x] Sync idempotent (semantic upsert key).
- [x] Backwards compatible (52/52 tests; build GREEN).
- [x] Automated tests cover identity/valuation/source/sync/reconciliation.
- [ ] Exchange API secrets encrypted — **separate workstream (§12.4)**, not done here.
- [x] No unrelated architectural rewrites.

---

# Summary

Zenin now preserves full position semantics from provider adapter → canonical storage → unified
read model → frontend. The one live data-integrity bug (spot/perp/long/short merge by bare symbol)
is closed by a semantic unique key; perp P&L is persisted; and the Hyperliquid USDC+perp
double-count is eliminated by counting margin once. The frontend already presents derivatives with
notional/collateral/leverage/liquidation/P&L and filters by canonical instrument/position/side —
never by provider name.
