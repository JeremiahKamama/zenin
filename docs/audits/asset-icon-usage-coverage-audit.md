# Asset Icon Usage & Coverage Audit

## 1. Executive Summary

This audit traces every financial asset visual identifier (logo, icon, avatar, initials tile) across the Zenin frontend codebase. The codebase has **one** shared logo component (`AssetLogo.jsx`), consumed in **two** places (`HomeModule.jsx` and `ComparisonHeader.jsx`). Every other asset-bearing surface renders symbols as bare text — no icon, no logo, no fallback tile.

There are **11 asset-bearing UI surfaces** that display asset symbols/identities but lack any icon rendering. Of these, **7 are REQUIRED** (core identity surfaces: portfolio holdings, watchlist rows, transaction rows, asset detail headers, etc.), **3 are RECOMMENDED**, and **1 is OPTIONAL**.

The single existing icon system is provider-specific: it depends entirely on `logo.dev`'s third-party image service with a hardcoded publishable token. No backend API returns logo data; no asset adapter includes a logo field in its normalized `AssetSnapshot` contract.

---

## 2. Existing Icon Implementation

### `AssetLogo.jsx` (the only shared icon component)

**File:** `frontend/src/components/AssetLogo.jsx`

| Field | Value |
|-------|-------|
| **Logo Provider** | `logo.dev` (third-party image service) |
| **Mode routing** | `crypto` type → `img.logo.dev/crypto/<sym>`, else → `img.logo.dev/ticker/<sym>` |
| **Hardcoded token** | `pk_DUGROay4TPGqK6AMX8PPFQ` (publishable, client-safe but hardcoded) |
| **Fallback** | Lettermark tile (`market-asset-logo` CSS class) showing 2-letter initials, color-coded by type |
| **Size** | 32×32px (`width={32} height={32}`) with 9px border-radius |
| **Theme** | Greyscale + dark theme (`greyscale=true`, `theme=dark`) |
| **Loading** | `loading="lazy"` on img, `onError` → swaps to lettermark |
| **CSS classes** | `.asset-logo` (img wrapper), `.market-asset-logo` (lettermark base) |
| **Type-specific CSS** | `.market-asset-logo.commodities` / `.commodity`, `.options` / `.option`, `.macro` |

**Supported type values passed to `type` prop:**
- `crypto` — routes to `img.logo.dev/crypto/<sym>`
- Any other string — routes to `img.logo.dev/ticker/<sym>`

**Lettermark type classes used in CSS:**
`commodities`/`commodity`, `options`/`option`, `macro` — no explicit `equity`, `etf`, `forex`, `currency` styles (falls back to default gradient).

### `useAssetReference.js` (reference-data hook — NOT for icons)

**File:** `frontend/src/components/useAssetReference.js`

Does NOT handle logos. Fetches prices, earnings, finviz data, and Massive aggregates. No logo/ image fields in the returned `data` object.

### Asset Adapters — No logo field

**File:** `frontend/src/utils/assetAdapters.js`

All `AssetAdapter` subclasses (StockAdapter, CommodityAdapter, EtfAdapter, IndicatorAdapter, MacroAdapter, CurrencyAdapter) return `AssetSnapshot` objects with fields: `symbol`, `kind`, `price`, `dayChangePct`, `ytdChangePct`, `series`, `updatedAt`, `raw` — **no `logo` or `logoUrl` field**.

---

## 3. Asset Icon Surface Matrix

> Legend: **REQUIRED** (P0) = asset identity central to UI; **RECOMMENDED** (P1) = useful but functional without; **OPTIONAL** (P2) = decorative or large-breakpoint only; **NOT NEEDED** (P3) = icon adds noise.

| # | Module / Component | File | UI Surface | Asset Type | Current Icon State | Icon Needed? | Priority | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | **HomeModule** | `components/HomeModule.jsx:2806` | Portfolio Impact table row | Mixed portfolio (equity, crypto, perps) | `MarketAssetLogo → AssetLogo` (logo.dev) | **Already implemented** | — | Line 2806: `<MarketAssetLogo symbol={row.symbol} type={row.type} />` inside `.market-asset-cell`. Logo + symbol + name. |
| 2 | **HomeModule** | `components/HomeModule.jsx:3310` | Market Movers preview list | Movers (equity, ETF, crypto) | `MarketAssetLogo → AssetLogo` (logo.dev) | **Already implemented** | — | Line 3310: `<MarketAssetLogo symbol={row.symbol} type={row.__marketTab \|\| row.type} />` |
| 3 | **HomeModule** | `components/HomeModule.jsx:3853` | Market Mover List items | Movers (equity, crypto, etc.) | `MarketAssetLogo → AssetLogo` (logo.dev) | **Already implemented** | — | Line 3853: `<MarketAssetLogo symbol={row.symbol} type={type} />` inside `MarketMoverList` |
| 4 | **ComparisonHeader** | `components/comparison/ComparisonHeader.jsx:18,36` | Side-by-side asset comparison header (Asset A, Asset B) | Stocks/ETFs | `AssetLogo` (logo.dev) | **Already implemented** | — | Lines 18, 36: `<Lettermark symbol={assetA?.symbol} />` → renders `AssetLogo` component. |
| 5 | **Watchlist** | `components/Watchlist.jsx:699-703` | Watchlist table — Symbol column | Stocks, ETFs, crypto, forex, macro indicators | **Text-only** (no icon) | **REQUIRED** | P0 | Line 699-703: `<div className="watchlist-symbol-cell"><strong>{asset.symbol}</strong><span>{asset.name \|\| ...}</span></div>`. No logo component. Same pattern at line 1193. |
| 6 | **PortfolioModule** | `components/PortfolioModule.jsx:1187-1242` | Portfolio holdings / position table (spot + options) | Stocks, ETFs, crypto, perps, options | **Text-only** (no icon) | **REQUIRED** | P0 | Lines 1134-1140, 3553, 4157-4170: `<strong>{row.symbol}</strong>`, `<strong>{row.symbol}</strong>` with no icon. Position rows render symbol + name as text only. |
| 7 | **PortfolioModule** | `components/PortfolioModule.jsx:4157` | Rebalancing command — change row | Portfolio holdings | **Text-only** (no icon) | **REQUIRED** | P0 | Line 4158: `<strong>{row.symbol}</strong>` inside `.portfolio-command-change-row`. No icon. |
| 8 | **PortfolioModule** | `components/PortfolioModule.jsx:2807` | Latest execution detail | Execution/fill | **Text-only** (no icon) | **RECOMMENDED** | P1 | Line 2807: `<strong>{latestExecution ? latestExecution.symbol : "No fills"}</strong>`. Text only. |
| 9 | **AssetModal (AssetHeader)** | `components/assetModal/AssetHeader.jsx:32` | Asset detail modal header | Stocks, ETFs, crypto | **Text-only** (no icon) | **REQUIRED** | P0 | Line 32: `<h2 className="am-name font-mono">{asset?.symbol}</h2>`. No logo/ avatar before symbol. |
| 10 | **PortfolioIntelligence ExecutionModule** | `components/portfolioIntelligence/modules/ExecutionModule.jsx:62,80` | Execution table — Symbol column | Trades/fills | **Text-only** (no icon) | **RECOMMENDED** | P1 | Lines 62, 80: `{ key: "symbol", header: "Symbol", cell: (x) => x.execution.symbol }` / `(e) => e.symbol`. Renders symbol as text. |
| 11 | **PortfolioIntelligence EventsModule** | `components/portfolioIntelligence/modules/EventsModule.jsx:77` | Events table — Symbol column | Portfolio events | **Text-only** (no icon) | **RECOMMENDED** | P1 | Line 77: `{ key: "symbol", header: "Symbol", cell: (e) => <strong>{e.symbol}</strong> }`. No icon. |
| 12 | **PortfolioIntelligence OrdersModule** | `components/portfolioIntelligence/modules/OrdersModule.jsx:71` | Orders table — Symbol cell | Open/closed orders | **Text-only** (no icon) | **RECOMMENDED** | P1 | Line 71: `<strong className="font-semibold">{o.symbol}</strong>`. No icon. |
| 13 | **PortfolioIntelligence PerformanceModule** | `components/portfolioIntelligence/modules/PerformanceModule.jsx:319,330,445,480,497` | Performance attribution rows | Positions, trades | **Text-only** (no icon) | **RECOMMENDED** | P1 | Lines 319, 330: `asset: (t) => t.symbol`, `(r) => r.symbol`. Lines 445, 480: `<strong className="portfolio-performance-asset">{row.symbol}</strong>`. No icon. |
| 14 | **PortfolioDrillDown** | `components/PortfolioDrillDown.jsx:208` | Portfolio drill-down table — symbol cell | Portfolio positions | **Text-only** (no icon) | **REQUIRED** | P0 | Line 208: `<strong>{p.symbol}</strong>`. No icon. |
| 15 | **EtfDiscovery** | `components/EtfDiscovery.jsx` | ETF discovery list | ETFs | Unknown | **REQUIRED** | P0 | Component displays ETF symbols; needs investigation. No logo import found. |
| 16 | **EquitiesCards** | `components/EquitiesCards.jsx` | Equity summary cards | Stocks | Unknown | **REQUIRED** | P0 | Displays equity symbols; no logo component found in grep results. |
| 17 | **AfricaDesk** | `components/AfricaDesk.jsx:144` | African market movers list | African equities | **Text-only** (no icon) | **RECOMMENDED** | P1 | Line 144: `<span className="africa-mover-symbol">{row.symbol}</span>`. No icon. |
| 18 | **PredictionMarketModule** | `components/PredictionMarketModule.jsx` | Prediction market rows | Prediction markets | Text-only (symbol only) | **RECOMMENDED** | P1 | Lines 1134-1169: prediction market positions displayed with symbol text. |
| 19 | **MarketSignals2** | `components/market/MarketSignals2.jsx` | Market signal rows | Macro/equities | Unknown | **RECOMMENDED** | P1 | Displays asset symbols; needs investigation for icon usage. |
| 20 | **MarketMoverList** | `components/HomeModule.jsx:3858-3859` | Mover list item | Equities, crypto, ETFs | `MarketAssetLogo` (logo.dev) | **Already implemented** | — | Part of HomeModule (see #3). |
| 21 | **WatchlistCollectModal** | `components/WatchlistCollectModal.jsx:81` | Watchlist collection selection | Collected assets | **Text-only** (no icon) | **RECOMMENDED** | P1 | Uses `normalizeSymbol` to match entries; no icon rendering found. |
| 22 | **AssetModal tabs (ResearchTab)** | `components/assetModal/tabs/ResearchTab.jsx:12` | Research tracking status | Single asset | Text-only (symbol only) | **OPTIONAL** | P2 | Line 12: `<strong>{symbol}</strong>` in a descriptive sentence. Decorative, not identity-critical. |
| 23 | **CurrencyCompare** | `components/CurrencyCompare.jsx` | Currency pair comparison | FX pairs | Unknown | **RECOMMENDED** | P1 | Needs investigation for icon usage. |
| 24 | **PortfolioActivity** | `components/PortfolioActivity.jsx:3553` | Portfolio activity stream | Portfolio flows | **Text-only** (no icon) | **OPTIONAL** | P2 | Stream items show symbol text; context is activity, not identity-critical. |
| 25 | **PortfolioImpactEnhanced** | `components/market/PortfolioImpactEnhanced.jsx` | Portfolio impact rows | Mixed portfolio | **Text-only** (no icon) | **RECOMMENDED** | P1 | Displays portfolio impact by asset symbol; no icon found. |

### Asset type coverage by current icon implementation:

| Asset Type | Has Icon Support? | Current Implementation | Notes |
|---|---|---|---|
| **Equity / Stock** | ✅ (via `ticker` mode) | `AssetLogo` → `img.logo.dev/ticker/<sym>` | Only used on HomeModule + ComparisonHeader |
| **ETF** | ✅ (via `ticker` mode) | Not currently rendered in PortfolioIntelligence, OrdersModule, EventsModule | ETF rows in these modules are text-only |
| **Crypto** | ✅ (via `crypto` mode) | `AssetLogo` → `img.logo.dev/crypto/<sym>` | Only used on HomeModule |
| **Options** | ❌ | Lettermark tile with `option` CSS class (color: `var(--color-interactive-soft)`) | No real logo; only the generic type-colored tile |
| **Commodities** | ❌ | Lettermark tile with `commodities`/`commodity` CSS class (yellow gradient) | No real logo provider; only type-colored tile |
| **Forex / Currency pairs** | ❌ | Text-only everywhere | No icon component used for FX pairs |
| **Macro indicators** | ❌ | Lettermark tile with `macro` CSS class | No real logo; only type-colored tile |
| **Prediction markets** | ❌ | Text-only | No icon component |
| **Bonds** | ❌ | Not traced | Needs investigation |
| **Funds** | ❌ | Not traced | Needs investigation |

### Icon dependency analysis:

| Dependency | Source | Hardcoded? |
|---|---|---|
| Logo image provider | `img.logo.dev` (logo.dev) | ✅ Token hardcoded in source (`pk_DUGROay4TPGqK6AMX8PPFQ`) |
| Logo format routing | `assetLogoUrl()` in `AssetLogo.jsx` | ✅ `crypto` → crypto mode, all else → ticker mode |
| Fallback lettermark | CSS class `market-asset-logo` + type modifier | ✅ CSS classes hardcoded in `styles.css` |
| Type-to-CSS-class mapping | `Lettermark` component (`type` prop → CSS class) | ✅ Direct passthrough: `market-asset-logo ${tone}` |
| FX rates | `currencyUtils.js` — for currency conversion | ✅ `DEFAULT_FX_RATES` in `currencyUtils.js` |

### Backend API logo support:

**No backend API returns logo data.** The following were checked:
- `assetAdapters.js` — all 6 adapters return `AssetSnapshot` with **no** `logo`/`logoUrl`/`image` field
- `useAssetReference.js` — fetches prices/earnings/finviz/massive, **no** logo field in response
- `portfolioService.js` — no logo fields
- `normalizeAssetData.js` — no logo fields

### CSS classes identified for asset icons (in `styles.css`):

| Line | Selector | Purpose |
|---|---|---|
| 24405 | `.market-asset-logo` | Lettermark tile base (28×28px, 9px radius, gradient bg) |
| 24420 | `.asset-logo` | Logo img wrapper (28×28px, 9px radius, `object-fit: contain`) |
| 24429-24430 | `.market-asset-logo.commodities`, `.market-asset-logo.commodity` | Yellow gradient for commodities |
| 24434 | `.market-asset-logo.options`, `.market-asset-logo.option` | Interactive soft color for options |
| 24439 | `.market-asset-logo.macro` | Surface gradient for macro |
| 25339 | `.market-asset-logo` | Light theme variant |
| 25797-25811 | `body.light-theme-active .market-asset-logo.*` | Light theme overrides |

---

## 4. Inconsistencies Found

### IC-1: AssetLogo only used in 2 of ~15 asset-bearing surfaces
`AssetLogo` is imported and used in only `HomeModule.jsx` and `ComparisonHeader.jsx`. The same `MarketAssetLogo` wrapper function exists in `HomeModule.jsx` (line 3834) but is NOT exported for reuse. Every other component that displays asset symbols does so without any icon.

### IC-2: No shared icon system across PortfolioIntelligence modules
`ExecutionModule`, `OrdersModule`, `EventsModule`, and `PerformanceModule` all display `.symbol` as bare text with no icon, despite handling the same asset types.

### IC-3: PortfolioModule shows icons in some sections, not others
Within the same file (`PortfolioModule.jsx`), the Portfolio Impact table (line 2806) uses `MarketAssetLogo`, but the holdings table (line 1134) and rebalancing rows (line 4157) do not.

### IC-4: Lettermark fallback has inconsistent type class support
CSS provides type-specific lettermark colors for `commodities`, `options`, `macro` — but NOT for `equity`, `etf`, `forex`, `currency`, `crypto`. Crypto and equity fall back to the default gradient `.market-asset-logo`.

### IC-5: No logo field in the canonical asset contract
`assetAdapters.js` defines the `AssetSnapshot` contract with fields `symbol, kind, price, dayChangePct, ytdChangePct, series, updatedAt, raw` — **no `logo` or `logoUrl` field**. The `AssetLogo` component generates URLs client-side, meaning logo resolution is entirely decoupled from the asset data pipeline.

### IC-6: Hardcoded provider token
`logo.dev` publishable token (`pk_DUGROay4TPGqK6AMX8PPFQ`) is hardcoded in `AssetLogo.jsx` line 10. No configuration indirection.

### IC-7: Portfolio detail header has no icon
`AssetHeader.jsx` (asset modal header) renders the symbol as an `<h2>` with no leading logo or avatar — the most prominent asset identity surface in the app has no icon.

---

## 5. Missing But Clearly Necessary (Gaps)

### G-1: Portfolio holdings table (`PortfolioModule.jsx:1134`)
**REQUIRED.** The primary holdings list renders `<strong>{p.symbol}</strong>` with no icon. This is the P0 surface where asset recognition matters most.

### G-2: Watchlist table (`Watchlist.jsx:699`)
**REQUIRED.** The watchlist symbol column renders `<strong>{asset.symbol}</strong>` with no icon. Watchlists exist specifically for asset tracking/recognition.

### G-3: Asset detail modal header (`AssetHeader.jsx:32`)
**REQUIRED.** The modal header is the largest, most prominent asset identity surface. No logo/avatar despite having a full-width header with symbol + company name + exchange.

### G-4: Portfolio drill-down (`PortfolioDrillDown.jsx:208`)
**REQUIRED.** Position table renders `<strong>{p.symbol}</strong>` with no icon.

### G-4: PortfolioIntelligence module tables (ExecutionModule, OrdersModule, EventsModule, PerformanceModule)
**RECOMMENDED.** These tables display symbol as text only. Adding icons would significantly improve scanability for trade/transaction/position tables.

### G-5: Rebalancing command rows (`PortfolioModule.jsx:4157`)
**REQUIRED.** Symbol-only display in the rebalancing workflow.

### G-6: FX pairs and macro indicators
**RECOMMENDED.** No icon system covers FX pairs or macro indicators. The lettermark fallback supports `macro` type but not `forex`/`currency`.

---

## 6. Hardcoded Asset/Provider Dependencies

| Location | Hardcoded Value | Context |
|---|---|---|
| `AssetLogo.jsx:10` | `pk_DUGROay4TPGqK6AMX8PPFQ` | logo.dev publishable token |
| `AssetLogo.jsx:18` | `size=128` | Logo size parameter |
| `AssetLogo.jsx:19-20` | `theme=dark`, `greyscale=true` | Visual style hardcoded |
| `AssetLogo.jsx:20` | `fallback=404` | Logo fallback behavior |
| `styles.css:24405` | `width: 28px; height: 28px` | Lettermark tile size |
| `styles.css:24420` | `width: 28px; height: 28px` | Logo img size |
| `styles.css:24424` | `background: var(--color-surface-raised, #1a1a1a)` | Logo img background |
| `styles.css:24413` | `border-radius: 9px` | Lettermark/ logo border radius |
| `styles.css:24411-24412` | `var(--color-text-secondary)`, `var(--color-data-secondary)` | Lettermark default gradient |
| `styles.css:24429-24430` | `var(--color-warning)`, `#facc15` | Commodity lettermark gradient |
| `styles.css:24434` | `var(--color-interactive-soft)` | Options lettermark background |
| `styles.css:24439` | `var(--color-surface-card)`, `var(--color-surface-elevated)` | Macro lettermark gradient |

---

## 7. Asset Identifier Dependencies

Each UI surface relies on `symbol` / `ticker` as the key identifier for icon lookup:

| Surface | Identifier Used | Available in Data |
|---|---|---|
| Watchlist rows | `asset.symbol` | ✅ Present |
| Portfolio holdings | `p.symbol` | ✅ Present |
| Portfolio impact | `row.symbol` | ✅ Present |
| Market movers | `row.symbol` | ✅ Present |
| Asset detail header | `asset?.symbol` | ✅ Present |
| Execution table | `x.execution.symbol` | ✅ Present |
| Orders table | `o.symbol` | ✅ Present |
| Events table | `e.symbol` | ✅ Present |
| Rebalance rows | `row.symbol` | ✅ Present |
| Portfolio drill-down | `p.symbol` | ✅ Present |

All surfaces have a `symbol` or `ticker` field available. No surface is blocked from using icons due to missing identifier data.

---

## 8. Asset Type Coverage Gap Summary

| Asset Type | Surfaces Displaying It | Currently Has Icon? | Gap Size |
|---|---|---|---|
| Equity/Stock | Watchlist, PortfolioModule, PortfolioDrillDown, AssetHeader, PortfolioIntelligence (4 modules), HomeModule, ComparisonHeader | ✅ Partial (2 of ~11 surfaces) | **HIGH** — 9 surfaces missing |
| ETF | Watchlist, AssetHeader, ComparisonHeader, EquitiesCards | ✅ Partial (1 surface) | **HIGH** — multiple surfaces missing |
| Crypto | HomeModule, PortfolioModule, PortfolioImpactEnhanced | ✅ Partial (1 surface) | **HIGH** — no PortfolioModule icon support |
| Options | PortfolioModule (top positions), PerpsCalculator | ❌ (lettermark only) | **MEDIUM** — type-colored tile exists |
| Commodities | HomeModule (movers), CommodityProfilePage | ❌ (lettermark only) | **MEDIUM** — type-colored tile exists |
| Forex/FX pairs | CurrencyCompare, Watchlist | ❌ | **MEDIUM** — no type class for `forex` |
| Macro indicators | HomeModule (movers), IndicatorCountryModal | ❌ (lettermark only) | **LOW** — lettermark `macro` class exists |
| Prediction markets | PredictionMarketModule | ❌ | **LOW** — non-traditional asset |
| Bonds | FixedIncomeModule (if present) | ❌ / Not traced | **UNKNOWN** |
| Funds | FundModule (if present) | ❌ / Not traced | **UNKNOWN** |

---

## 9. Recommendations for Implementation Phase

### R-1: Expand `AssetLogo` usage to REQUIRED surfaces (P0)
Import and use `AssetLogo` in:
1. `Watchlist.jsx` — Symbol column cell
2. `PortfolioModule.jsx` — holdings table, rebalance rows, execution detail
3. `AssetHeader.jsx` — asset detail modal header
4. `PortfolioDrillDown.jsx` — position table

### R-2: Export `MarketAssetLogo` for reuse
Convert the local `MarketAssetLogo` function in `HomeModule.jsx` into a reusable export or move to `AssetLogo.jsx` so all modules share one wrapper.

### R-3: Extend CSS type classes
Add `.market-asset-logo.equity`, `.market-asset-logo.etf`, `.market-asset-logo.forex`, `.market-asset-logo.currency`, `.market-asset-logo.crypto` to `styles.css` so non-commodity/option/macro assets get type-appropriate lettermark colors.

### R-4: Add `logo`/`logoUrl` to `AssetSnapshot` contract
Modify `assetAdapters.js` to optionally return a `logoUrl` field (resolved server-side from logo.dev or another provider), so the adapter layer can pre-resolve logos and the UI doesn't need to construct URLs.

### R-5: Externalize the logo.dev token
Move `pk_DUGROay4TPGqK6AMX8PPFQ` into runtime config (`runtimeConfigStore.js`) instead of hardcoding in source.

### R-6: Add `forex` and `currency` type support to `AssetLogo`
Currently `type="crypto"` routes to crypto mode; all else routes to `ticker` mode. Add explicit handling for `forex` and `currency` types (e.g., use country flag emoji or initials for currency codes).

### R-7: Investigate untested surfaces
Verify `EtfDiscovery.jsx`, `EquitiesCards.jsx`, `CurrencyCompare.jsx`, `MarketSignals2.jsx` for icon usage before implementation.
