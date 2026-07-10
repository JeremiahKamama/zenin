# Asset Modal — Architecture & UX Audit

**Project:** Zenin Capital
**Feature:** Asset Modal / Asset Workspace
**Mode:** Read-only investigation (no code changes)
**Audit date:** 2026-07-10
**Primary file:** `frontend/src/components/AssetModal.jsx` (1,150 LOC)
**Companion file:** `frontend/src/App.jsx` (8,567 LOC — host/owner), `frontend/src/components/AnalyticsModule.jsx` (second render site)

> Every finding below cites `file:line`. Line numbers are from the working tree at audit time and will shift as the repo evolves — treat them as anchors, not absolutes.

---

## 0. Executive Summary

The Asset Modal is a **single 1,150-line component** that mixes presentation, five independent data-fetch effects, chart math (SMA/EMA/VWAP computed on the client), order/plan math, audio feedback (confetti/fireworks/kaching), and inline `<style>` injection. It is the de-facto "asset workspace" for the whole app: opened from global search, watchlist, portfolio, and the analytics FX desk.

**Most consequential findings (detail in Part 19):**

1. **The modal is research-only in the main app.** `App.jsx:6804` renders it with `onConfirm={null}` and `researchOnly`. The footer "Save Plan" button (`AssetModal.jsx:1116-1118`) therefore calls `handleConfirmOrder` whose `onConfirm?.()` is `undefined` → `result` is `undefined` → the function early-returns with no side effect. **The button is a no-op in the primary surface.** Real execution lives in `App.jsx` via `/db/execute-trade` (lines 2449, 2638, 2800) and is *not* reachable from this modal.
2. **No Escape-to-close, no focus trap, no `role="dialog"`/`aria-modal`.** The only `Escape` keydown listener in `App.jsx` is for the settings panel (lines 3654-3666). AssetModal relies solely on the overlay `onClick={onClose}` (line 739) and the × button (line 796).
3. **Live data is layered over simulated/local defaults.** `balance` defaults to `10000` from `localStorage` (App.jsx:1398-1402) unless `/db/cash` returns authenticated data. Guest `portfolio`/`watchlist` are seeded demo data (App.jsx:1295-1318). The modal cannot tell the user which numbers are live vs seeded.
4. **Five fetch effects run on open**, three of them (history, quote, performance) keyed on `assetSymbol`+`assetType` so they re-fire on every interval change / symbol change, with parallel `AbortController`s but no dedupe/coalescing.
5. **Monochrome-brand drift:** the trade-success animations use `hsl(${hue}, 90%, 60%)` full-spectrum confetti/fireworks (`AssetModal.jsx:746, 767`) — the only place in the asset surface that breaks the monochrome BrandV2 rule.
6. **SMA/EMA/VWAP are computed client-side** on every `history`/`chartType`/`visibleIndicators` change (`AssetModal.jsx:461-577`) with no memoization of the underlying `priceRows` map (recomputed inside the same `useMemo`).

---

## Part 1 — Component Discovery

### Trigger → render chain

```
User click (search result / watchlist row / portfolio holding / analytics FX row)
  ↓
setSelectedAsset(asset)                         App.jsx:6581 (search), :6679 (enriched)
  ↓  — OR — setSelectedFxAsset(asset)           AnalyticsModule.jsx:5538-5549
  ↓
{selectedAsset && <Suspense><AssetModal … />}    App.jsx:6791-6817
  ↓  (lazy import)
const AssetModal = lazyWithReloadRetry(...)
  () => import("./components/AssetModal")        App.jsx:183-184
```

### Files in the dependency graph

| File | Role |
|---|---|
| `src/components/AssetModal.jsx` | The modal itself (1150 LOC). |
| `src/App.jsx` | Host/owner. Owns `selectedAsset`, `portfolio`, `trades`, `spotPrices`, `balance`, `cashBalances`, `isInWatchlist`, `toggleWatchlistStar`, `openCompanyProfile`. Renders `<AssetModal>` at :6791-6817. |
| `src/components/AnalyticsModule.jsx` | Second render site (FX desk) at :5538-5549. Passes `portfolio=[]`, `trades=[]`, `onConfirm` = no-op. |
| `src/components/TradingViewChart.jsx` | Chart renderer (508 LOC), wraps `lightweight-charts`. Imported at `AssetModal.jsx:2`. |
| `src/components/IndicatorCountryModal.jsx` | Sibling modal for `indicator` asset kind (`App.jsx:6793-6799`). AssetModal is *not* used for indicators. |
| `src/components/CompanyProfilePage.jsx` | Separate lazy route opened via `onViewCompanyProfile` (`App.jsx:1990-2000`, :6332). Not a child of AssetModal. |
| `src/utils/resilientData.js` | `readResilientCache`/`writeResilientCache` — localStorage-backed cache (no TTL on read except earnings). Used by 3 effects. |
| `src/utils/zeninFetch.js` | Authenticated fetch wrapper; applies `X-Zenin-Simulate-Plan` header when `zenin_simulate_plan` is set (simulation mode). |
| `src/utils/currencyUtils.js` | `getCurrencySymbol`, `formatCurrency`, `convertToUSD`, `inferAssetCurrency`. |
| `src/utils/marketHours.js` | `getMarketStatus(asset)` → open/closed + lunch/holiday reason. |
| `src/config/runtimeConfigStore.js` | `getAppRuntimeConfig()` → `ui.assetModalIntervals` (line 27-29). |
| `src/constants/apiConfig.js` | `ZENIN_API_BASE_URL`. |

**No dedicated `AssetModal/` folder exists.** Everything lives in one file plus shared utils.

---

## Part 2 — Component Inventory

The modal is **not decomposed** into sub-components. The spec's "AssetHeader / PositionOverview / PerformanceWorkspace / …" do not exist as separate components; they are inline JSX blocks inside one render function. Inventory of the *logical* sections:

| Logical block | Lines | Responsibility | Props in | Local state | Shared/external |
|---|---|---|---|---|---|
| Root `AssetModal` | 13-26 | Orchestrates everything | 12 props (asset, onClose, onConfirm, isInWatchlist, onToggleStar, onViewCompanyProfile, portfolio, balance, cashBalances, trades, spotPrices, researchOnly) | ~28 state vars | parent props |
| Header (price/change/star/close) | 783-831 | Show identity, price, market status, watchlist star | `asset`, `displayedPrice`, `displayedChangePercent`, `isInWatchlist`, `onToggleStar`, `onClose` | — | `isMarketOpen` |
| Chart section | 833-892 | Interval toggles, source chip, data-health badge, chart container, range label | `history`, `chartData`, `loading`, `historyStale`, `historySource` | `chartType`, `chartExpanded` | `TradingViewChart` |
| Fundamentals | 917-1015 | P/E, EV/EBITDA, mkt cap, ratings, 52W, next earnings | `earnings`, `finvizData` | — | `onViewCompanyProfile` |
| Order-type toggle | 1017-1026 | Buy ("Increase") / Sell ("Reduce") or research-only note | `orderType`, `isTradeEligible`, `normalizedAssetKind` | `orderType` | — |
| Position note | 1028-1070 | Holding qty / available balance / FX rate | `portfolio`, `balance`, `cashBalances`, `displayedPrice`, `totalValueInUSD` | `quantity`, `buyCurrency` | — |
| Footer (order entry) | 1071-1120 | Qty input, total value, currency pill, "Save Plan" | same as above | `quantity` | `handleConfirmOrder` |
| Inline `<style>` | 1122-1147 | Currency pill CSS (should be in stylesheet) | — | — | — |

**Props consumed but never meaningfully used in primary surface:** `onConfirm` (null in App), `researchOnly` (always true in App).

---

## Part 3 — Modal Lifecycle

```
User click
  ↓ setSelectedAsset(asset)                         App.jsx:6581 / 6679
  ↓ React mounts <AssetModal asset={selectedAsset} … />   App.jsx:6801
  ↓ Component body runs:
      - normalizeAssetKind(asset)                   AssetModal.jsx:44-58   (pure, runs every render)
      - derives isCryptoAsset / isTradFi / isForexAsset / assetType / isTradeEligible
  ↓ 5 useEffects fire (see Part 4):
      1. fetchHistory        :115-171  (deps: activeInterval, assetSymbol, assetType)
      2. resetLiveQuote      :173-175  (deps: assetSymbol, assetType)
      3. fetchQuote          :177-209  (deps: asset.price, asset.priceChangePercent, assetSymbol, assetType)
      4. fetchPerformance    :211-237  (deps: assetSymbol, assetType)
      5. fetchEarnings       :239-297  (deps: isTradFi, assetSymbol, isForexAsset)
      6. fetchFinviz         :329-354  (deps: isTradFi, assetSymbol, isForexAsset)
  ↓ Each effect: read resilient cache → if hit, hydrate synchronously; else setLoading(true) → fetch → write cache
  ↓ Rendered with loading/empty/error branches:
      - history.length>0 → <TradingViewChart>            :859-872
      - loading && history empty → spinner               :873-876
      - else → "No chart data available."                :877-879
      - earnings/finviz: dual loading/empty/error states :936-1013
  ↓ Actions available (only if isTradeEligible):
      - orderType toggle, qty input, total value, Save Plan (no-op in App)
  ↓ CLOSE:
      - × button        :796  → onClose → setSelectedAsset(null)  App.jsx:6803
      - overlay click   :739  → onClose
      - Trade success   :446, :454 → setTimeout(onClose, 900/950)  (only when onConfirm returns ok — never in App)
```

**Loading states:** `loading` (history), `earningsLoading`, `finvizLoading` — each with its own spinner. **No unified loading shell.**
**Error states:** `finvizError` is declared (:41) but **never set** — Finviz failures are swallowed (`:344-347`). Earnings has a structured unavailable fallback (:280-287).
**Cleanup:** every fetch effect returns `controller.abort()`; `AbortController` per effect. No global cleanup of `setTimeout`s in `handleConfirmOrder`/`triggerInsufficientFeedback`/`playKaching` (they fire after unmount if user closes fast — benign but technically a leak).
**Closing behavior:** overlay click + × only. **No Escape, no focus restore to the triggering element.**

---

## Part 4 — Data Flow Audit

### Sources

| Data | Source | Transform | Cache |
|---|---|---|---|
| Chart history | `GET /history?symbol,type,interval` (:140) | normalized into `priceRows` (open/high/low/close/volume) (:461-478) | `asset-history` (resilient, no TTL) |
| Live quote | `GET /prices?type,symbol` (:189) | token: `crypto`→`crypto` else `tradfi` (:187) | none (in-memory) |
| Interval performance | `GET /interval-performance` (:223) | `performanceMap[symbol] → %` | `asset-performance` (no TTL) |
| Fundamentals/earnings | `GET /earnings?symbol` (:262) | nested `valuation.*`, `profile.*` | `asset-fundamentals` (TTL 12h, :11) |
| Finviz | `GET /finviz?symbol` (:338) | `summary.*`, `ratings[0]` | none |
| Portfolio / trades / spotPrices / balance | props from App (parent state) | derived: `averageEntryPrice`, `assetPriceLines`, `tradeMarkers` | App-level state |

### Price resolution priority (displayedPrice, :299-307)
1. `asset.price` (passed-in metadata)
2. `liveQuote.price` (fetched)
3. last close from `history`
4. `0`

→ `displayedChangePercent` (:313-317) and `displayedChangeValue` (:322-327) follow the same fallback ladder. The change *value* is **estimated** from percent when `priceChangeValue` is missing (:326) — a rough approximation, not real P&L.

### Duplicated / derived state
- `cleanAsset` (:74-79) strips `_forceSell`; recomputed each render via `useMemo([asset])`.
- `assetPriceLines` (:626-635) duplicates 52W high/low already inside `earnings` + `asset` — three sources for the same number.
- `averageEntryPrice` (:610-624) re-derives from `trades` — but App already computes `holdingEntryPriceByKey` (App.jsx:2124-2141 `portfolioWithEntry`). **Two independent entry-price computations.**

### Missing state
- No "last updated" timestamp surfaced for `liveQuote` (only `history` shows `historySource`/`historyStale`).
- No loading/error state for the **quote** fetch; if `/prices` fails silently, the modal falls back to `asset.price` with no indicator.

---

## Part 5 — API Audit

| Endpoint | When | Freq | Cache | Retry | Notes |
|---|---|---|---|---|---|
| `GET /history` | on open + every interval change | per interval switch | resilient (no TTL) | none (try/catch → cached) | re-fetches full series each interval |
| `GET /prices` | on open if `asset.price`/`change` missing | once | none | none | only fires when metadata lacks price |
| `GET /interval-performance` | on open | once | resilient (no TTL) | none | |
| `GET /earnings` | on open (tradfi, non-forex) | once | resilient (12h TTL) | none | fresh check then short-circuits |
| `GET /finviz` | on open (tradfi, non-forex) | once | none | none | error swallowed |

**Frequency concern:** switching intervals re-runs `fetchHistory` (dep `activeInterval`, :171) → full refetch + re-cache. No cancellation of in-flight except `AbortController` (clean, but no dedupe if user clicks intervals rapidly).
**Stale data:** resilient cache has **no TTL on read** for `asset-history` / `asset-performance` (only `asset-fundamentals` enforces 12h). A cached stale series can show indefinitely until network returns something newer.
**Optimistic updates:** none in modal. (App-level trade execution at `/db/execute-trade` is the only mutating path; **not** invoked by this modal.)
**Unnecessary requests:** when `asset.price` and `asset.priceChangePercent` are both present (the common case from watchlist/portfolio), the `fetchQuote` effect still mounts and *could* fire — but guarded by `:181` early-return, so it's correctly skipped. Good.

---

## Part 6 — State Management Audit

**Global state (App):** `selectedAsset`, `portfolio`, `trades`, `spotPrices`, `balance`, `cashBalances`, watchlist. Passed as props — no Context for the modal.

**Local state (AssetModal):** 28+ `useState` calls (history, loading, historyStale, activeInterval, historySource, orderType, earnings*, finviz*, fetchedCurrency, chartType, visibleIndicators, crosshairEnabled, chartExpanded, chartResetSignal, quantity, performanceMap, liveQuote, isSubmitting, shake, showConfetti, showFireworks, buyCurrency). See :30-107.

**Derived values:** `displayedPrice`, `displayedChangePercent`, `totalValue`, `totalValueInUSD`, `insufficientBalance`, `marketStatus`, `chartData`, `tradeMarkers`, `averageEntryPrice`, `assetPriceLines` — mostly `useMemo`, good.

**Race conditions:**
- `fetchHistory` writes cache then `setHistory`; a rapid interval switch aborts the first controller (:142, :154, :165) — correct.
- `handleConfirmOrder` reads `quantity`/`orderType` from closure; `useCallback` deps (:459) include them, so no stale closure. Good.

**Render loops:** none observed. Effects depend on primitive/stable deps.

**Unnecessary effects:** `resetLiveQuote` (:173-175) exists only to clear `liveQuote` on symbol change — could be merged into `fetchQuote`'s early logic, but harmless.

**Stale closures:** `normalizeAssetKind` is a plain function redefined each render (:44-58) — not memoized, minor waste.

---

## Part 7 — Rendering Audit

- **Render depth:** shallow (one component, flat JSX). No children components to re-render.
- **Expensive calculations:**
  - `chartData` (:461-577): builds `priceRows` (`.map` + `.filter`) then SMA/EMA/VWAP (each O(n)) **inside the same `useMemo`**. `priceRows` is recomputed every time `history`/`chartType`/`visibleIndicators` change, even when only `visibleIndicators` toggled. **Opportunity:** split `priceRows` into its own `useMemo([history])` so indicator toggles don't re-run the full normalization.
  - `tradeMarkers` (:579-608) and `averageEntryPrice` (:610-624) both re-scan `trades` — O(n) each, memoized on `trades`/`assetSymbol` (fine).
- **Memoization:** `chartOptions` is a stable `useMemo([])` (:641-646) — correctly frozen to stop chart recreation (comment :637-639 explains a prior blank-chart bug). Good.
- **Large rerenders:** switching `chartExpanded` (:89) re-renders whole modal and re-mounts `TradingViewChart` at new height (height change forces lightweight-charts resize — acceptable).
- **No `React.memo` / no virtualization** — N/A (no lists), but the fundamentals table is hand-rolled `<table>` (fine for 4 rows).

---

## Part 8 — UX Analysis (institutional workflow)

**Primary objectives a pro trader brings to an asset:** (1) understand current position & P&L, (2) see price action + key levels, (3) read fundamentals/earnings, (4) act (trade/plan), (5) attach research/notes, (6) review history.

**What the modal supports well:** price + change + market status + source chip; multi-interval chart with SMA/EMA/VWAP + trade markers + avg-entry/52W price lines; fundamentals table; buy/sell plan entry with balance check.

**Friction:**
- **The "Save Plan" button does nothing** in the main app (Part 0 #1). A user clicking it gets silence — no toast, no error, no state change. This is the single biggest UX defect.
- **No tabs.** Chart, fundamentals, and order entry are stacked vertically in one scroll. For an "asset workspace" an institutional user expects progressive disclosure (Overview / Performance / Fundamentals / Activity / Orders), not one long column.
- **Order entry occupies the footer even for research-only assets** — but `isTradeEligible` gates it, so for indicators/forex it's hidden and a "Research-only view" note shows (:1022-1026). Reasonable, but the *language* "Increase/Reduce" maps to buy/sell while the action is "Save Plan" — confusing mental model.
- **Watchlist star** is in the header (:788-795) but there is **no "Add to Watchlist" success feedback** and no inline note that the asset isn't yet watched.
- **No notes, no connections, no research links, no journal/decision hooks** inside the modal (see Part 12).

---

## Part 9 — Information Architecture

```
Overlay (click = close)
└─ modal-content .asset-modal-window
   ├─ Header .yahoo-header
   │   ├─ Title: name (symbol)
   │   ├─ Star (watchlist) · ×
   │   ├─ Price · Change% · Currency · LIVE badge
   │   └─ "As of <time> · Market Open/Closed"
   ├─ Chart section
   │   ├─ source chip · Data Health badge · Line/Candle toggle
   │   ├─ TradingViewChart (300/440px)
   │   ├─ Range label
   │   └─ Interval toggle + per-interval performance %
   ├─ Fundamentals (tradfi only)
   │   ├─ Company Profile link · Fundamentals badge
   │   └─ table (Mkt Cap / Revenue / Analyst Target / Next Earnings) + grid (P/E, EV/EBITDA, Beta, Div, 52W, Avg Vol)
   ├─ Order-type toggle (Increase / Reduce)  [or research-only note]
   ├─ Position note (holding / available balance / FX rate)
   └─ Footer (qty · total value · currency pill · Save Plan)   [trade-eligible only]
```

**What deserves primary attention:** price + chart + position. These are front-loaded — good.
**What is hidden:** fundamentals collapse behind a loading state; no way to expand fundamentals without waiting.
**What competes visually:** the confetti/fireworks layers (:741-782) are full-color — the *only* non-monochrome elements in the surface (BrandV2 violation).
**What is redundant:** 52W high/low appear in both the fundamentals grid and as chart price lines; "Market Cap" appears twice (Finviz `summary["Market Cap"]` vs `earnings.marketCap`, :953-954).

---

## Part 10 — Interaction Audit

| Interaction | Implemented? | Where |
|---|---|---|
| Open (click) | ✅ | App.jsx:6581/6679 |
| Close (×) | ✅ | :796 |
| Close (overlay click) | ✅ | :739 |
| Close (Escape) | ❌ | no handler |
| Close (outside click via focus trap) | ❌ | — |
| Buy/Sell toggle | ✅ | :1017-1021 |
| Qty input (sell caps at holding) | ✅ | :1079-1095 |
| Total value edit (reverse-computes qty) | ✅ | :1108-1112 |
| Currency pill (USD / asset ccy) | ✅ | :1101-1104 |
| Save Plan | ⚠️ no-op in App | :1116 |
| Watchlist star | ✅ | :788-795 |
| Company Profile | ✅ | :921-927 → onViewCompanyProfile |
| Chart type Line/Candle | ✅ | :848-849 |
| Interval switch | ✅ | :902 |
| Indicator toggles (vol/sma/ema/vwap) | ✅ | :650-652 (no UI buttons rendered for these — **dead controls**: state exists but no UI toggles volume/SMA/EMA/VWAP) |
| Chart expand | ✅ | :89, :856 |
| Trade markers / price lines | ✅ (derived) | :579-635 |
| Add Note | ❌ | absent |
| Refresh (manual) | ❌ | no manual refresh; relies on interval switch / reopen |
| Keyboard nav (Tab order, focus ring) | ⚠️ | native only; no roving tabindex, no initial focus |
| Connections / Research / Journal / Decision | ❌ | absent |

**Missing interactions:** Escape-close, focus trap + restore, manual data refresh, indicator toggle UI (state is orphaned), notes, any cross-module deep-link.

---

## Part 11 — Chart Audit

- **Renderer:** `TradingViewChart` (lightweight-charts canvas), `AssetModal.jsx:2, 860`.
- **Series:** Price (area or candlestick) + optional Volume histogram + SMA20 + EMA20 + VWAP (`:521-576`).
- **Calculations (client-side):** SMA/EMA/VWAP computed in `chartData` (:479-514). These are **correct standard formulas** (EMA multiplier `2/(period+1)`), but recomputed on the client on every render that touches `history`/`chartType`/`visibleIndicators`.
- **Refresh strategy:** chart data only changes when `activeInterval` changes (new `/history` fetch). No live ticking of the chart itself — price badge updates via `displayedPrice` (from `asset.price` or `liveQuote`), but the candle series is static until interval switch.
- **Historical data:** from `/history` with `interval ∈ {4H,1D,1W,3M,1Y,YTD,MAX}` (configurable via `ui.assetModalIntervals`, :27-29).
- **Benchmarks:** none (no index overlay / compare).
- **Zoom:** lightweight-charts native (scroll/drag) — not surfaced via UI.
- **Timeframes:** interval buttons only; no custom range picker.
- **Real-data verification:** series comes from `/history` payload `history[]`; if the API returns synthetic data the chart renders it faithfully (chart is data-driven, not faked). The *fallback* when `/history` fails is cached-or-empty; "No chart data available" shown (:878).

---

## Part 12 — Portfolio Integration

| Connected surface | Link from modal | Status |
|---|---|---|
| Portfolio | `portfolio` prop → holding qty, avg entry, position note | ✅ read-only |
| Watchlist | star button (`isInWatchlist`/`onToggleStar`) | ✅ toggle |
| Research | Company Profile button → `onViewCompanyProfile` → separate route | ✅ deep-link |
| Analytics | modal opened *from* Analytics FX desk | ✅ (one-way) |
| Journal | — | ❌ none |
| Predictions | — | ❌ none |
| Decisions | — | ❌ none |
| Tax Estimator | — | ❌ none |
| Connections (broker) | — | ❌ none (no "view in broker" / sync) |

**Missing integrations:** no in-modal path to create a Decision, journal an idea, run a tax estimate on the position, or open the connected-broker ticket. For an institutional "asset workspace" these are expected adjacent actions.

---

## Part 13 — Connected Accounts Audit

- **Holdings:** from `portfolio` prop (App state). Guest = seeded demo (App.jsx:1300-1303); authed = `/db/...` loads (App.jsx:2239 `db/trades`, :2218 `db/trade-executions`, :2167 `db/cash`).
- **Balances:** `balance`/`cashBalances` from `fetchCashBalances` (App.jsx:2164-2189, `GET /db/cash`); **default 10000 from localStorage** when unauthenticated (:1398-1402).
- **Transactions / executions:** `trades` prop; authed loads via `db/trades` (:2239). Modal reads these for `tradeMarkers` + `averageEntryPrice`.
- **Refresh / sync:** no manual refresh in modal; relies on parent re-render. App-level `useLivePriceStream` (App.jsx:2153) pushes live prices into `assets`/`portfolio` → flows into `spotPrices` → `displayedPrice` ladder.
- **Live vs cached vs simulated:**
  - **Live:** `assets`/`portfolio` prices via `useLivePriceStream` (WebSocket, URL resolved in `utils/livePriceStream.js`).
  - **Cached:** chart/earnings/finviz via resilient (localStorage).
  - **Simulated:** guest portfolio/balance (seeded/demo); `X-Zenin-Simulate-Plan` header in `zeninFetch` when `zenin_simulate_plan` localStorage flag set (simulation mode for demos).
  - **Missing:** the modal never labels a number as "demo/simulated" — a user cannot tell seeded demo data from a live broker feed.

---

## Part 14 — Actions Audit

| Action | Primary/Secondary | Implemented | Notes |
|---|---|---|---|
| View chart / switch interval | Primary | ✅ | core |
| Read fundamentals | Primary | ✅ | tradfi only |
| Open Company Profile | Secondary | ✅ | deep-link |
| Toggle watchlist | Secondary | ✅ | — |
| Save Plan (buy/sell) | Primary (label) | ⚠️ no-op | `onConfirm=null` in App → silent |
| Reverse-compute qty from notional | Secondary | ✅ | — |
| Add Note | — | ❌ | absent |
| Create Decision / Journal | — | ❌ | absent |
| Tax estimate | — | ❌ | absent |
| Export | — | ❌ | absent |
| Refresh data | — | ❌ | absent |
| Trade (real execution) | — | ❌ | not in this modal; `/db/execute-trade` is in App only |

**Classification:** The modal's only *mutating* action is "Save Plan," which is inert in the primary surface. Everything else is read/derived. This strongly suggests the modal was designed as a **research/planning surface** whose `onConfirm` was meant to be wired to the execution pipeline but currently isn't (except the FX analytics branch, where `onConfirm` just closes).

---

## Part 15 — Accessibility Audit

| Concern | Status | Evidence |
|---|---|---|
| `role="dialog"` / `aria-modal` | ❌ | root div is `className="modal-overlay"` (:739), no ARIA role |
| Focus trap | ❌ | none |
| Escape to close | ❌ | only settings panel has it (App.jsx:3654-3666) |
| Initial focus | ❌ | no `autoFocus` / focus management |
| Focus restore on close | ❌ | `onClose` just nulls state |
| ARIA labels | ⚠️ | chart has `aria-label` (:864, :874); interval buttons lack labels; star has `title` |
| Live region | ⚠️ | "Data Health" badge has `title` but not `aria-live` |
| Touch targets | ✅ | buttons inherit `.home-exec-btn` 34px min (styles.css) |
| Color contrast | ⚠️ | change% uses `.positive`/`.negative` (green/red) — acceptable; but full-color confetti breaks monochrome |
| Reduced motion | ⚠️ | global `@media (prefers-reduced-motion)` exists (styles.css) but confetti/fireworks use CSS animations that may not respect it |
| Screen-reader chart | ❌ | canvas chart is invisible to AT; only the readout formatter helps |

**Biggest gaps:** no dialog semantics, no Escape, no focus trap. For an overlay this is a P0 a11y defect.

---

## Part 16 — Design System Audit (BrandV2 compliance)

- **Typography:** uses `yahoo-*` classes; inherits token font. No violation.
- **Spacing:** inline `style` padding on empty-hint (:1004) and currency-pill `<style>` block (:1122-1147) — **should be in stylesheet**, not injected. Minor.
- **Cards / buttons:** reuses `.home-exec-btn` family where present; the header uses `.close-btn`, `.star-button` (custom). Consistent enough.
- **Icons:** text glyphs (★, ×, ⟳, ✓, ⚠) — fine.
- **Colors:** **VIOLATION** — confetti/fireworks use `hsl(${hue}, 90-95%, 60-62%)` full spectrum (:746, :767). BrandV2 is monochrome; this is the lone chromatic surface.
- **Status / badges:** `data-health-badge` (loading/ok/hazard) — good monochrome-ish (hazard uses ⚠, not color). Acceptable.
- **Loading / empty / skeletons:** spinner + "No chart data" + fundamentals empty-hint — present. No skeleton shimmer.
- **Dark / light mode:** tokens used (`var(--color-*)`); should track theme. The injected `<style>` (currency pill) hardcodes nothing problematic.
- **Hover:** buttons have hover states via shared classes.

**Recommendation:** move the injected `<style>` to `styles.css`; replace confetti/fireworks with monochrome variants (e.g., ink-scale pulse or single-hue) to honor BrandV2.

---

## Part 17 — Performance Audit

- **Bundle impact:** `AssetModal` is lazy-loaded (`lazyWithReloadRetry`, App.jsx:183) — good; doesn't bloat initial bundle. `TradingViewChart` (lightweight-charts) loads with it.
- **Initial render:** 5 effects fire on open; 3 are network. First paint shows header + spinner; chart appears after `/history`.
- **Data loading:** 5 endpoints, no parallel batching (could be one request). `fetchHistory` re-runs per interval.
- **Network requests:** see Part 5. No request coalescing; rapid interval switches abort+refetch.
- **Large objects:** `history[]` can be large (1Y/MAX); held in state + passed to `chartData` memo. Acceptable for one modal.
- **Virtualization:** N/A.
- **Lazy loading:** chart is inside the modal (already lazy). Fundamentals table is tiny.
- **Chart rendering:** lightweight-charts canvas — efficient. Height change forces resize; expand toggle is fine.
- **Image loading:** none (glyphs only).
- **Memoization opportunities:** split `priceRows` out of `chartData` (Part 7); `normalizeAssetKind` could be module-level pure fn.

---

## Part 18 — Engineering Architecture

**Monolith verdict: YES.** One 1,150-line component owning presentation + 6 data effects + chart math + order math + audio + inline styles.

**Proposed extraction (target structure from the brief):**

```
AssetModal/
  AssetModal.jsx            // orchestrator: state, effects, layout
  AssetHeader.jsx           // price/change/star/close/market-status
  AssetChartPanel.jsx       // chart + intervals + indicators + data-health
  AssetFundamentals.jsx     // earnings/finviz table + grid + Company Profile link
  AssetOrderBar.jsx         // order-type toggle, qty, total, currency pill, Save Plan
  AssetPositionNote.jsx     // holding / balance / FX rate
  hooks/
    useAssetHistory.js      // /history + resilient cache + abort
    useAssetQuote.js        // /prices
    useAssetPerformance.js  // /interval-performance
    useAssetFundamentals.js // /earnings + /finviz (12h TTL)
  lib/
    indicators.js           // SMA/EMA/VWAP (pure, unit-testable)
    tradeMath.js            // averageEntryPrice, totalValue, insufficientBalance
    audio.ts                // playKaching (isolated)
  AssetModal.css            // move injected <style> + yahoo-* classes here
```

**Benefits:** indicator math becomes testable; `useAsset*` hooks reusable by Company Profile / Analytics; order logic isolated; modal file drops to ~300 LOC.

**What should remain unchanged:** the data-source contracts (`/history`, `/prices`, `/interval-performance`, `/earnings`, `/finviz`), the resilient-cache keys, the `TradingViewChart` integration, the price-resolution ladder.

---

## Part 19 — UX Pain Points (ranked)

### P0 — Blockers
1. **"Save Plan" is a no-op in the main app.**
   - Problem: `onConfirm={null}` (App.jsx:6804) → `handleConfirmOrder` early-returns; button gives zero feedback.
   - Impact: Primary CTA is dead. Users think the app is broken.
   - Recommendation: Either wire `onConfirm` to the execution pipeline (`/db/execute-trade`, App.jsx:2449) or relabel/disable the button when `researchOnly`/`!onConfirm`. At minimum show a toast "Planning only — connect a broker to execute."
   - Effort: S (relabel/disable) → M (wire execution).

2. **No Escape / focus trap / dialog semantics.**
   - Problem: AssetModal.jsx:739 has no `role`/`aria-modal`; no keydown handler; App's only Escape listener is for settings (App.jsx:3654).
   - Impact: Keyboard users / screen readers trapped or stranded; violates modal a11y baseline.
   - Recommendation: add `role="dialog" aria-modal="true"`, `onKeyDown` Escape→`onClose`, focus trap + restore to trigger.
   - Effort: S.

### P1 — High
3. **No manual data refresh.** Interval switch is the only refresh trigger. Users can't force a chart/quote refresh.
   - Recommendation: add a refresh control that re-fetches `/history`+`/prices` (bypass cache). Effort: S.

4. **Orphaned indicator controls.** `visibleIndicators` state (vol/sma/ema/vwap, :82-87, :650-652) has **no UI** — the toggles are never rendered.
   - Recommendation: add indicator toggle buttons (like the Line/Candle toggle) or remove the dead state. Effort: S.

5. **Simulated vs live not disclosed.** Guest `balance=10000` (App.jsx:1398) and seeded portfolio (App.jsx:1300) render identically to live data; modal shows no "demo" marker.
   - Recommendation: surface a `dataMode` badge (Live / Demo / Cached) in the header. Effort: M.

### P2 — Medium
6. **No tabs / progressive disclosure.** Everything stacks in one scroll.
   - Recommendation: tabs (Overview / Performance / Fundamentals / Activity). Effort: M.

7. **BrandV2 color violation.** Confetti/fireworks `hsl` full-spectrum (AssetModal.jsx:746, 767).
   - Recommendation: monochrome success animation. Effort: S.

8. **Redundant 52W / Market Cap.** Shown in both fundamentals grid and chart price lines; Mkt Cap from two sources (:953-954).
   - Recommendation: single source of truth. Effort: S.

9. **Injected `<style>` block.** Currency-pill CSS inline (:1122-1147) should live in stylesheet.
   - Recommendation: move to styles.css. Effort: S.

10. **`priceRows` recomputed inside `chartData` memo** on every indicator toggle (Part 7).
    - Recommendation: extract `priceRows = useMemo([history])`. Effort: S.

### P3 — Low
11. **`normalizeAssetKind` redefined each render** (:44-58). Move to module scope. Effort: S.
12. **`finvizError` declared but never set** (:41). Either wire it or remove. Effort: S.
13. **No notes / connections / decisions / tax hooks** inside modal (Part 12). Roadmap item. Effort: L.
14. **`setTimeout` cleanup** in success/feedback handlers can fire post-unmount. Effort: S.

---

## Part 20 — Opportunities (institutional patterns)

Reference interaction patterns (workflow/density/hierarchy — not visuals):

- **Bloomberg Terminal:** command-driven asset launch + always-visible function keys. → Add a command-palette entry to open the modal and jump to a tab.
- **Koyfin:** dense multi-panel asset workspace with tabs (Chart / Financials / Estimates / Ownership). → Adopt the tab model (Part 19 #6).
- **TradingView:** indicator drawer + timeframe menu + interval performance badges (already have perf badges — extend with a compare/benchmark overlay).
- **Carta/Ramp/Mercury:** clear primary CTA, obvious disabled state, explicit "what happens next." → Fix the dead "Save Plan" with a real disabled/label state (Part 19 #1).
- **Linear:** keyboard-first, Escape closes, focus restore, crisp empty/loading states. → A11y pass (Part 19 #2) + skeletons.

**Progressive disclosure recommendation:** Overview (price + position + chart) → Performance (intervals + indicators + trade markers) → Fundamentals (earnings/finviz) → Activity (trades related to this symbol) → Actions (plan/execute). This keeps the primary objective (understand position + price action) one click from open.

---

## Part 21 — Success Criteria (audit complete when…)

- [x] **how the modal opens** — search/watchlist/portfolio/analytics FX → `setSelectedAsset`/`setSelectedFxAsset` (App.jsx:6581, 6679; AnalyticsModule:5538).
- [x] **how it loads data** — 5 effects, resilient cache + fetch, AbortController cleanup (AssetModal.jsx:115-354).
- [x] **how it renders** — single 1150-LOC component, flat JSX, lightweight-charts canvas (AssetModal.jsx:738-1149).
- [x] **how it synchronizes** — parent props (portfolio/trades/spotPrices/balance) + live price stream → price ladder; no internal sync.
- [x] **how it integrates with portfolio** — read-only holding/avg-entry/position note; no write-back (Part 12).
- [x] **where performance bottlenecks exist** — `chartData` re-derives `priceRows` on indicator toggle (Part 7/17 #10); per-interval `/history` refetch (Part 5); no request batching.
- [x] **where UX friction exists** — dead "Save Plan" CTA, no Escape/focus-trap, no refresh, orphaned indicator state, no tabs, no sim/live disclosure (Part 19).
- [x] **how responsibilities are distributed** — all in one file; 6 effects + chart math + order math + audio + styles (Part 18).
- [x] **what should be redesigned** — decompose into `AssetModal/` with `hooks/` + `lib/`; add tabs, a11y, refresh, real CTA wiring (Part 18/19/20).
- [x] **what should remain unchanged** — API contracts, resilient-cache keys, TradingViewChart integration, price-resolution ladder.

**No implementation has been performed.** This document is the architectural foundation for the Asset Modal redesign.
