# Plan — Macro Desk Phase II: Country-Aware Macro Terminal

> Read-only recon done. This plan fixes ARCHITECTURE (single country state → all panels), not styling.
> Brand v2: information hierarchy first, monochrome, compact, progressive disclosure, never show unavailable functionality.

## Ground truth (verified this session)
- **Backend already supports country**: `/api/macro/country/:code/overview` (index.js:16036), `/api/macro-indicators?country=` (:8797), `fetchAnalyticsMacroRows(country)` (:3704). FRED/BLS = **USA-only** (:3706-3708, :8864-8866); non-USA falls back to **World Bank** metrics. So non-USA is real (World Bank), not faked.
- **`selectedGeoCode` state already exists** (AnalyticsModule.jsx ~:900s). The macro *detail* effect (:1197) already passes `geo=selectedGeoCode` to timeseries/calendar/forecast/regime/correlation — BUT `overviewPath` (:1198) and the top-level `macroData` aggregation (used by the LIVE `isMacro` desk at :6796) are NOT country-threaded. The geo selector UI lives in the **DEAD-CODE branch** (:4535, gated by `false &&`), so users cannot actually change country from the live desk.
- **Live macro render** = `AnalyticsSpecializedDesk` `isMacro` branch (:6796-6931): `ExecutivePanel`, `ExecutiveSignalStrip`, `DecisionBanner`, `GrowthInflationQuadrant`, `CrossAssetDashboard`, `MacroWatchlist`, `CrossDeskChain`, `MacroRatesTerminal`, plus risk/FX/source panels. "US signal stack" literal at :6852.
- **Sub-components** live in `deskV2Modules.jsx`: `GrowthInflationQuadrant` (:47), `CrossAssetDashboard` (:84), `MacroWatchlist` (:128), `useMacroWatchlist` (:115), `CrossDeskChain` (:153), `HonestUnavailable` (:24).
- **Formatters already exist**: `formatPercent` (:443), `formatCompactMoney` (:439), `formatSignedValue` (:467). Task wants ONE `formatMacroNumber`.

## Architecture decision
Country becomes **first-class React context** so the live desk + dead-branch + detail effect all read one source. No duplicated state.

## Deliverables (5 modules — new file `frontend/src/components/macro/`)

1. **`MacroCountryContext.jsx`** — `MacroCountryProvider` + `useMacroCountry()`. Holds `selectedCountry` (code), `setSelectedCountry`, derived `countryName`, `availableCountries` (from Coverage Registry / macroGeographies), `coverageByCountry`. Persists selection to `workspacePersistence`. Single source.
2. **`MacroProviderRegistry.js`** — canonical provider metadata (FRED, TradingEconomics, World Bank, IMF, ECB, BoE, BoJ, OECD, Yahoo) → display label, color token, homepage. Used by source badges + metadata.
3. **`MacroFormatter.js`** — `formatMacroNumber(value, {kind})` where kind ∈ {currency, percentage, index, millions, billions, trillions, bps, rate, decimal}. Auto-compact: ≥1e12→T, ≥1e9→B, ≥1e6→M; cap ≤4 visible chars before suffix; 2.95→2.95, 0.0045→0.00. Replaces inline `toFixed`/`toLocaleString` in macro panels. Single fn — no duplicated logic.
4. **`MacroCoverageRegistry.js`** — per-country coverage map {code → {tier: Excellent|Good|Partial|Unavailable, indicators: N, providers:[]}}. Drives Coverage badges + disables "Coming Soon" countries. Seeded from `macroGeographies` + World Bank availability; non-USA = World Bank-backed.
5. **`MacroIndicatorRegistry.js`** — indicator catalog (GDP, CPI, Inflation, Interest Rate, PMI, Retail Sales, Money Supply, Housing, Employment, Current Account, Debt) with {code, label, unit, kind}. Drives the Country Watchlist pinning (saved per country) + which panels render.

## Wiring into the live desk (AnalyticsModule.jsx)
- **Top toolbar country selector** (Objective 1): add `🌍 Country` dropdown in `AnalyticsLayout` toolbar (or desk top), bound to `useMacroCountry().setSelectedCountry`. Lists the 20 supported countries from Coverage Registry; unavailable = disabled + "Coming Soon".
- **Broadcast country**: `selectedCountry` flows into the macro detail effect deps (already partially does via `selectedGeoCode`); align `selectedGeoCode` = context value. Every panel (Regime, Growth Matrix, Risk Strip, Terminal, Policy Tape, Watchlist, Cross-Asset, FX, Yield Curve, Calendar, Forecasts) reads the same country — no per-panel state.
- **Remove "US Signal Stack"** (:6852) → `Country Signal Stack · {countryName}` (Objective 2).
- **Regime header** (ExecutivePanel / hero, :6814-6827): add Country + Confidence + Source (FRED/World Bank) + Updated (Objective 3).
- **`formatMacroNumber`** applied to all metric values (Objective 4-5): overview cards (:4643-4647), risk cards (:6885), terminal (:4910), Growth %/Inflation % (:76-77).
- **Country metadata** (Objective 6): small `Country / Provider / Coverage / Updated` strap on each panel head (extend `deskV2Modules` panel-head or add `<MacroMetaStrip>`).
- **Terminal table** (Objective 7): compact padding via existing `.analytics-inline-table` + CSS; move Source → `title` attr tooltip; keep Indicator/Value/Change/Trend/Contribution/Impact (the current columns are Indicator/Market/As-Of/Current/Prior/Trend/Risk — align to spec).
- **Growth Matrix** (Objective 8): trim CSS height ~35%, move Growth%/Inflation% below (already below at :76-77; tighten `.deskv2-quadrant` grid + legend).
- **Country Watchlist** (Objective 9): `MacroWatchlist` (:128) gains pin set from `MacroIndicatorRegistry`, saved per country via `workspacePersistence`.
- **Coverage + source badges** (Objective 10-11): `MacroCoverageRegistry` → badge on each country; `MacroProviderRegistry` → provider badges (FRED/World Bank/ECB…) in Source strip.
- **Cross-asset panel** (Objective 12): `CrossAssetDashboard` (:84) becomes country-aware — asset list keyed by country (USA→SPY/US10Y/VIX; Germany→DAX/Bund/EURUSD; Japan→Nikkei/JGB…) from a `MACRO_CROSS_ASSET_BY_COUNTRY` map.
- **Loading state** (Objective 13): changing country does NOT blank — keep previous `macroData`, show per-panel skeleton only where data absent (use existing loading state, no full-screen wipe).
- **Empty states** (Objective 14): unavailable indicators show "Not available for selected country" via `HonestUnavailable` (:24) — already the pattern; ensure no `0` faking.

## No hardcoded USA
- Remove `default "USA"` silent default → default to a real supported country but expose selector; all panel titles templated from `countryName`.
- The 4 hardcoded quick-chip countries [:4570] (`USA/DEU/JPN/KEN`) → replaced by registry-driven selector.

## Acceptance criteria mapping
Single country state → all panels ✅ · no hardcoded USA ✅ · compact Growth Matrix ✅ · numbers truncated ✅ · tables aligned ✅ · coverage/provider/metadata visible ✅ · no layout shift (context, not remount) ✅ · Brand v2 ✅.

## Verification
- `npm run build:spa` green.
- Ad-hoc Node harness: `formatMacroNumber` unit checks (89.5M, 1.2B, 14.6T, 2.95→2.95, 0.0045→0.00).
- Browser render at :5173 (live dev) — verify country switch updates Regime/Matrix/Risk/Terminal; check ~800px and ~470px (no layout shift, no blank on switch).

## Out of scope (Phase II)
- Adding new backend providers (CFTC, ECB feeds) — backend already country-aware via World Bank; FRED stays USA-only by design.
- New macro endpoints.

## Files touched
- NEW: `frontend/src/components/macro/{MacroCountryContext.jsx, MacroProviderRegistry.js, MacroFormatter.js, MacroCoverageRegistry.js, MacroIndicatorRegistry.js}`
- EDIT: `frontend/src/components/AnalyticsModule.jsx` (context provider mount, selector UI, live desk country threading, formatMacroNumber swap, "US Signal Stack" rename, metadata straps)
- EDIT: `frontend/src/components/deskV2Modules.jsx` (GrowthInflationQuadrant compact, CrossAssetDashboard country-aware, MacroWatchlist pinning, MacroMetaStrip)
- EDIT: `frontend/src/styles.css` (compact terminal/growth-matrix CSS, coverage/provider badge styles — monochrome tokens only)
