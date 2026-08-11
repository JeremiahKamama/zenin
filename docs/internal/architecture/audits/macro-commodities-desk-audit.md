# Macro Desk & Commodities Desk — Institutional Research Terminal Audit

> Read-only architecture + IA + UX audit. No code changed. Brand v2 (monochrome, desktop-first).
> Evidence markers: ✅ Verified in source this session · ⚠ Inferred · ❓ Requires runtime verification.

## Source ground-truth (verified this session)

- Both desks are **tabs inside one 7,915-line god component**: `frontend/src/components/AnalyticsModule.jsx`. ✅
  - Macro render tree: **lines 4409–5096**. ✅
  - Commodities render tree: **lines 5097–5945**. ✅
  - Component owns **99 useState / 17 useMemo / 27 useEffect, 0 useCallback**. ✅
- Data fetch:
  - Desk shell payload: `GET /analytics/{tab}` on a **60s** interval for macro, **120s** for commodities (`AnalyticsModule.jsx:1418`). ✅
  - Macro detail endpoints: `/macro/{geographies,indicators,alerts,timeseries,compare,calendar,map,rankings,forecast,source,regime,correlation}` (`:1047–1127`). ✅
  - Commodities detail endpoints: `/commodities/{overview,list,alerts,:symbol/price,:symbol/fundamentals,:symbol/stress,:symbol/flows,:symbol/seasonality,:symbol/curve,compare,calendar,correlation,search}` (`:1220–1326`). ✅
- Provider reality (backend `index.js`):
  - Macro: **FRED** (`FRED_MACRO_SERIES`, `:496`); EIA for energy inventory (`:205`). ✅
  - Commodities pricing: **Yahoo Finance** front-month quotes; FRED only for CL/NG/GC/SI spot (`FRED_COMMODITY_SERIES :506`). ✅
  - **Commodity "Flows" = Yahoo price/volume proxy, NOT COT/fund flows** — the code's own `sourceWhy` says *"transparent proxy when fund-flow or COT data is unavailable"* (`index.js:13444–13448`). ✅ **CRITICAL — the panel is labeled "Managed money, ETF changes, and commercial hedger positioning" (`AnalyticsModule.jsx:5397`) but renders volume proxy. Misleading.**
  - **Commodity "Futures Curve" = single front-month point** — backend returns one contract labeled "Front Month" (`index.js:13506–13507`); the SVG term-structure chart requires ≥2 points and otherwise shows "Awaiting multi-contract curve data" (`AnalyticsModule.jsx:5664`). ✅ **The Contango/Backwardation badge is computed from a curve that structurally cannot have 2 points from this feed.**

---

# Part 1 — Information Architecture

## Macro Desk

### Section: Regime / Hero pill strip (`:4412–4427`)
- **Purpose:** One-line macro regime verdict (Regime, Score, Country, Range).
- **Inputs:** `/macro/regime`, `regimeScore`, `selectedGeoCode`, `chartRange`.
- **Outputs:** Regime label + score pills.
- **Decision supported:** *"What is the macro backdrop right now?"* — the single most important line on the desk.
- **Should remain? YES** — but promote to **Tier-1 hero**, currently visually equal to the controls beneath it.

### Section: Dashboard controls (Geography + Indicator) (`:4430–4487`)
- **Purpose:** Pick geo type, country, indicator family, trend mode, timeframe, display mode.
- **Inputs:** `macroGeographies`, `macroIndicators`, `macroCategoryOptions`.
- **Outputs:** Selection state driving every panel below.
- **Decision supported:** None directly — it's a query builder.
- **Should remain? YES** but **collapse into a progressive-disclosure control bar.** Two full control columns + hardcoded `["USA","DEU","JPN","KEN"]` quick chips (`:4443`) consume prime above-the-fold space for configuration, not decisions.

### Section: Macro overview cards (top 5) (`:4495–4528`)
- **Purpose:** 5 headline indicators with value + trend pill.
- **Inputs:** `macroOverview`.
- **Decision supported:** *"Which indicators are moving?"*
- **Should remain? YES** — this is the natural **metric strip**; should sit directly under the regime hero.

### Section: Macro time series / compare / map / calendar / ranking / forecast (`:4535–4765`)
- **Purpose:** Six mutually-exclusive `macroView` panels.
- **Inputs:** respective `/macro/*` endpoints.
- **Decision supported:** Deep-dive on one indicator.
- **Should remain? YES** but this is **analyst drill-down, not landing content** — belongs behind progressive disclosure (Part 7). Map & forecast are currently **table stand-ins** ("Map View Data" is a table, not a map — `:4644`), so they under-deliver on their own labels.

### Section: Macro Indicators Terminal (`:4767–4883`)
- **Purpose:** Dense Bloomberg-style table: indicator, market, as-of, current, prior, trend, risk status.
- **Inputs:** `macroData.macroData`.
- **Decision supported:** *"Rates/inflation/labor — what surprised vs prior?"* This is the analytical heart of the desk.
- **Should remain? YES — promote to Tier-1.** It is the strongest panel and is buried at the bottom.

### Section: FX Rates + Forex Movers (`:4885–4946`)
- **Purpose:** FX table + Finviz gainers/losers.
- **Decision supported:** *"Is the dollar/risk currency moving?"*
- **Should remain? YES** but FX is a **Tier-2 sibling that deserves its own sub-desk** — it is currently a footer table.

### Section: Risk Indicators + Asset Correlation + Alert Rules (`:4948–5089`)
- **Purpose:** Risk readings, macro↔asset correlation, saved workspace alerts.
- **Decision supported:** *"Should I hedge? What co-moves with my book?"*
- **Should remain? YES** — Risk Indicators should feed the **Market Stress** Tier-1 tile; alerts stay as workspace tooling.

## Commodities Desk

### Section: Group/region/time filter bar (`:5099–5145`)
- **Purpose:** Select group, region, timeframe.
- **Decision supported:** None — query builder.
- **Should remain? YES**, collapse like macro controls.

### Section: Stat strip (Tracked / Top Mover / Events / Selected Price) (`:5148–5177`)
- **Decision supported:** *"What's moving in this group?"*
- **Should remain? YES** — this is the correct metric strip. "Tracked Contracts" is low-value; swap for a stress/vol readout.

### Section: Search + flow-mode + view chips (`:5179–5253`)
- **Should remain? YES** as controls.

### Section: Commodities Landing Hub table (`:5255–5329`)
- **Purpose:** Group/region/price/returns per contract.
- **Decision supported:** *"Which commodity do I dig into?"* — the desk's index.
- **Should remain? YES — Tier-1 anchor.**

### Section: Price / Flows / Seasonality / Curve / Compare views (`:5331–5749`)
- **Decision supported:** Single-contract drill-down.
- **Should remain? YES** but see critical findings: **Flows mislabels proxy data** (`:5397` vs `index.js:13444`), **Curve cannot form a real term structure** (single point). Relabel or gate until real COT/curve providers exist.

### Section: Inventory Deltas + Catalyst Timeline (`:5751–5944`)
- **Decision supported:** *"Is there a supply/demand imbalance? What events are coming?"*
- **Should remain? YES** — inventory (EIA/WASDE-backed) is the desk's most institutional panel; promote it.

---

# Part 2 — Layout Audit

| Zone | Current state | Finding |
|---|---|---|
| **Top command bar** | Shared desk tab row (crypto/options/equities/macro/commodities, `:17–21`). | ✅ Consistent. Good. No per-desk command bar (no global search / regime ticker / alert bell at desk level). |
| **Hero** | Macro: regime pill row is visually equal-weight to controls. Commodities: **no hero at all** — starts with filter chips. | ⚠ Weak. The most important line (regime / market stress) does not dominate. Commodities has no verdict line. |
| **Metric strip** | Macro overview cards (`:4495`); Commodities stat cards (`:5148`). | ✅ Present, but sits *below* controls, so the eye hits configuration before signal. |
| **Tables** | Dense inline tables (Macro Terminal `:4777`, Landing Hub `:5302`, Inventory `:5756`). | ✅ Strong, institutional. Best content on both desks — but buried low. |
| **Heatmaps** | **None.** "Map View" is a table (`:4644`). | ❌ No FX heatmap, no cross-asset heatmap, no correlation matrix heatmap. |
| **Charts** | Macro time series (`ChartCard :4536`); Commodities curve SVG (`:5696`) + curve sparkline component (`:7348`). | ⚠ Sparse. Curve chart usually empty (single point). No multi-series macro overlay. |
| **Signal cards** | Overview cards double as signal cards (clickable → drill). | ⚠ Cards compete: 5 equal cards, none is "the" signal. No visual priority. |
| **Bottom panels** | Macro: correlation + alerts. Commodities: inventory + catalyst timeline. | Good content, wrong altitude — high-value inventory is a footer. |

**Visual hierarchy:** Flat. Controls, metrics, and analytical tables all share the same `analytics-card` weight. No Tier-1 emphasis.
**Scanning order (current):** tabs → controls → metric cards → drill panel → dense terminal table → FX → risk/inventory. **Signal arrives 3–4 scroll-depths after configuration.**
**Eye movement:** Z-pattern breaks — the user must scroll past query builders to reach answers.
**Whitespace / density:** Control columns are airy; analytical tables are dense. Inconsistent rhythm. Two full macro control columns (`:4434`, `:4469`) are the single largest above-the-fold consumer.
**Card balance:** 5 equal overview cards + 4 equal commodity stat cards = no focal point.
**Dead space:** Curve chart region reserves ~120px that renders "Awaiting…" most of the time (`:5666`). Map/forecast tables render empty on cold load.
**Scrolling:** Long single-column scroll; mutually-exclusive `macroView`/`commodityView` panels still stack the terminal table below them, forcing scroll.
**Do cards compete?** Yes — nothing wins. Fix: one Tier-1 hero + demoted controls (Part 6).

---

# Part 3 — Data Dependency Audit

| Component | Current source | Preferred | Fallback | Refresh | Latency tol. | Cache | Progressive? | Blocking? | Optional? | Future provider |
|---|---|---|---|---|---|---|---|---|---|---|
| Regime score | `/macro/regime` (FRED-derived) | FRED composite | last-good | 60s | High | 24h | Yes | No | No | Nowcast model |
| Macro overview cards | `/analytics/macro` (FRED) | FRED | cache | 60s | High | 12h | Yes | No | No | — |
| Macro Terminal table | `/analytics/macro` (FRED) | FRED | TradingEconomics | 60s | Med | 6h | Yes | No | No | TE / DBnomics |
| Macro time series | `/macro/timeseries` (FRED) | FRED | cache | on-select | High | 24h | Yes | No | Yes | — |
| Macro calendar | `/macro/calendar` | TradingEconomics | cache | daily | High | 12h | Yes | No | Yes | TE / Econoday |
| FX rates | `/analytics/macro.fxRates` | FRED/Finviz | cache | 60s | Med | 5m | Yes | No | No | Polygon FX |
| Forex movers | Finviz | Finviz | cache | 60s | Med | 5m | Yes | No | Yes | — |
| Risk indicators | `/analytics/macro.riskIndicators` | FRED/derived | cache | 60s | Med | 1h | Yes | No | No | — |
| Asset correlation | `/macro/correlation` | derived | cache | on-select | Low | 24h | Yes | No | Yes | — |
| Commodity list/hub | `/commodities/list` (Yahoo) | Yahoo→exchange | FRED spot | 120s | Med | 15m | Yes | No | No | CME / Barchart |
| Commodity price series | `/commodities/:s/price` (Yahoo) | Yahoo | FRED | on-select | Med | 1h | Yes | No | Yes | CME |
| **Commodity "Flows"** | **Yahoo vol proxy** (`13444`) | **CFTC COT / ETF flow** | proxy | on-select | Low | 24h | Yes | No | Yes | **CFTC (free), fund-flow API** |
| **Commodity "Curve"** | **Yahoo front-month only** (`13507`) | **Full futures strip** | single pt | on-select | Med | 6h | Yes | No | Yes | **CME/Barchart curve** |
| Commodity inventory | EIA + WASDE catalog (`13000`, `623`) | EIA/USDA | catalog ptr | daily/weekly | High | 24h | Yes | No | No | EIA/USDA API |
| Commodity seasonality | `/commodities/:s/seasonality` | derived history | cache | on-select | Low | 7d | Yes | No | Yes | — |
| Commodity calendar | `/commodities/calendar` | TradingEconomics | cache | daily | High | 12h | Yes | No | Yes | TE |

**Example (spec format):** Fed Funds Rate → Primary: FRED · Fallback: TradingEconomics · Refresh: Daily · Cache: 24h · Blocking: No. ✅ matches current FRED wiring.

---

# Part 4 — Decision Flow Audit

**Every panel must map to one decision. Current coverage:**

### Macro — decisions & where they're answered
| Decision | Answered today? | Panel |
|---|---|---|
| Should I increase risk? | ⚠ Partial | Regime pill + risk indicators (not consolidated) |
| Should I hedge? | ⚠ Partial | Risk Indicators (`:4948`) — no explicit hedge signal |
| Should I rotate internationally? | ❌ No | Compare view exists but no cross-country risk verdict |
| Should I expect volatility? | ❌ No | No vol/VIX regime tile (VIX only appears as an alert example string `:5074`) |
| Should I buy duration? | ❌ No | No yield-curve panel (labeled in Terminal subtitle `:4772` but no curve viz) |
| Should I buy commodities? | ⚠ Cross-desk | Requires manual desk switch |
| Should I reduce leverage? | ❌ No | No liquidity/stress composite |

### Commodities — decisions & where they're answered
| Decision | Answered today? | Panel |
|---|---|---|
| Inflation trade? | ❌ No | No inflation-basket linkage |
| Industrial cycle? | ⚠ Partial | Group returns (metals) but no PMI/demand tie-in |
| Energy shock? | ✅ Yes | EIA inventory + energy group |
| Agriculture trend? | ✅ Yes | WASDE inventory + ag group |
| Gold hedge? | ⚠ Partial | Price only; no real-yield / DXY context |
| Supply disruption? | ⚠ Partial | Catalyst timeline + weather proxy (`669`) |

**Verdict:** Both desks display data competently but **stop short of the decision**. Panels answer *"what is the number?"* not *"what should I do?"*. The regime pill and inventory deltas are the only true decision-supports today.

---

# Part 5 — Missing Institutional Components

Legend: ✅ present · 🟡 partial/mislabeled · ❌ absent.

## Macro Desk
| Module | Status | Note |
|---|---|---|
| Liquidity Monitor | ❌ | No net-liquidity (Fed BS − TGA − RRP) series. High value, FRED-available. |
| Central Bank Tracker | ❌ | No policy-rate-by-CB panel. |
| Yield Curve Monitor | ❌ | Subtitle claims it (`:4772`) but no 2s10s/curve viz. FRED-available. |
| Rate Expectations | ❌ | No Fed-funds futures / SOFR implied path. |
| Economic Surprise Index | ❌ | Terminal shows prior vs current (`:4806`) but no aggregated surprise index. |
| Dollar Strength Monitor | 🟡 | FX rates only; no DXY composite. |
| Currency Heatmap | ❌ | FX is a table, not a heatmap. |
| Country Risk Matrix | ❌ | Compare view is single-indicator only. |
| Policy / Economic Calendar | 🟡 | Calendar view exists (`:4668`) but table-only, no importance weighting UI. |
| Inflation Dashboard | 🟡 | CPI is a row, no dedicated dashboard. |
| Global Liquidity | ❌ | — |
| PMI Dashboard | 🟡 | PMI in Terminal subtitle, no panel. |
| FX Correlation Matrix | ❌ | Correlation is single-asset (`:4982`). |
| Cross Asset Dashboard | ❌ | No stocks/bonds/FX/commodities-in-one. |
| Growth vs Inflation Quadrant | ❌ | The canonical macro-regime visual is missing. |
| Risk Appetite Dashboard | 🟡 | Risk Indicators table only. |
| Credit Market Monitor | ❌ | No HY/IG spreads. FRED-available. |
| Treasury Auction Calendar | ❌ | — |
| Bond Term Premium | ❌ | FRED (ACM) available. |
| Macro Regime Engine | 🟡 | Regime label exists (`/macro/regime`); no transparent driver breakdown. |
| Nowcasting Models | ❌ | Future (Phase 4). |

## Commodities Desk
| Module | Status | Note |
|---|---|---|
| Futures Curve | 🟡 | **Single front-month point only** (`13507`). Not a real curve. |
| Contango vs Backwardation | 🟡 | Badge computed but structurally can't (needs ≥2 pts). |
| Inventory Dashboard | ✅ | EIA/WASDE-backed (`13000`). Strongest panel. |
| COT Positioning | ❌ | Labeled but proxy (`13444`). **CFTC is free — highest-ROI gap.** |
| Open Interest | ❌ | — |
| Term Structure | 🟡 | Same as curve. |
| Seasonality | ✅ | Present (`:5506`). |
| Spread Dashboard | ❌ | Curve ladder shows spread column but no crack/calendar spread desk. |
| Weather Impact | 🟡 | NOAA proxy alerts only (`669`). |
| Shipping / Baltic Dry / Container | ❌ | No freight indicators. |
| Energy Crack Spreads | ❌ | RB/HO mapped as symbols but no crack calc. |
| Refinery Utilization | ❌ | EIA-available. |
| Crop Progress | 🟡 | WASDE balance only, no progress. |
| Mining Production | ❌ | — |
| OPEC Tracker | ❌ | — |
| Commodity Correlations | 🟡 | `/commodities/correlation` vs SPY only (`:1234`). |
| Inflation Basket | ❌ | Cross-desk link to macro CPI missing. |
| Commodity ETF Flow | 🟡 | Flow-mode dropdown exists but all proxy. |
| Commodity Volatility Surface | ❌ | Volatility column null in compare (`13536`). |
| Supply Chain / Demand Dashboard | ❌ | — |

**Highest-ROI additions (free providers, aligns with existing wiring):** CFTC COT positioning, Net Liquidity (FRED), Yield Curve (FRED), Credit spreads (FRED), full futures curve (CME/Barchart).

---

# Part 6 — Information Hierarchy

**Proposed importance order (both desks):**

### Macro
- **Tier 1 (verdict — always visible, above fold):** Macro Regime · Market Stress composite · Net Liquidity · Rates/Yield-Curve snapshot.
- **Tier 2 (context):** FX / Dollar · Inflation · Economic Calendar (next 48h high-importance) · Cross-asset.
- **Tier 3 (drill / on-demand):** Country compare · Rankings · Forecast · Map · Correlation · Alert rules · Source data.

### Commodities
- **Tier 1:** Group heat verdict · Selected-contract stress · Inventory delta · Top movers.
- **Tier 2:** Curve/term structure · Seasonality · Positioning (once real) · Calendar.
- **Tier 3:** Price table · Compare · Flow ledger · Saved rules · Source metadata.

**Current vs target gap:** Today the Tier-1 content (regime, inventory) is rendered at Tier-3 altitude (footers), and Tier-3 query builders sit at Tier-1 altitude (top of fold). **The hierarchy is inverted.** This is the single biggest UX finding.

---

# Part 7 — Progressive Disclosure

Move behind explicit user request (chip, drawer, "expand"), matching the existing `macroSourceDataExpanded` pattern (`:4548`) and `SourceDrawer` (`:5091`):

| Hide by default | Currently | Recommendation |
|---|---|---|
| Historical raw tables | Always in DOM (macroView panels, price series) | Behind "View data" toggle (pattern already exists `:4548`) |
| Methodology / regime drivers | Not shown | Add to a drawer, not the card face |
| API diagnostics / provider metadata | `ProviderStatusStrip` always visible (`:4428`,`:5146`) | Collapse to a single status dot; expand on click |
| Source confidence / `sourceWhy` | In payload, not surfaced | Tooltip only |
| Advanced calcs (forecast, rankings, map) | Full panels | Keep as opt-in `macroView` chips (already are) — but **don't also render empty tables on cold load** |
| Curve chart when <2 pts | Renders "Awaiting…" placeholder (`:5666`) | Hide the whole card until data qualifies |
| Full control columns | Always expanded (`:4434`,`:4469`) | Collapse to a compact bar; expand on "Filters" click |

**Principle:** Default view = Tier-1 verdict + Tier-2 context. Everything in Part-1 "drill-down" and Part-7 table above is disclosure-gated. This alone removes ~60% of cold-load DOM. ⚠ (est.)

---

# Part 8 — Cross-Desk Relationships

**Intended chain:** Macro → Equities → Commodities → Options → Portfolio → Briefing.

**Current reality:** ✅ All five desks are siblings under one `AnalyticsModule` tab bar (`:17–21`), but they are **navigationally isolated** — switching tabs resets context; no state or signal flows between them.

| Desired path | Exists? | Evidence |
|---|---|---|
| Fed decision → Macro alert | 🟡 | Alerts are local workspace rules (`:4956`), not event-driven |
| Macro alert → Equities rotation | ❌ | No cross-tab handoff |
| Macro regime → Commodities tilt | ❌ | Regime label not consumed by commodities tab |
| Commodity move → Inflation basket → Macro CPI | ❌ | No linkage |
| Any desk → Portfolio drift → Suggested rebalance | ❌ | Portfolio is a separate module; no signal bus |
| FX asset → Asset modal | ✅ | `openFxAsset` opens `AssetModal` (`:4913`, `:5949`) — the one working cross-object link |

**Missing navigation paths (recommend, do not build now):**
1. Regime pill → deep-link into the driver indicator's time series (partially exists via overview-card click `:4503`).
2. Macro "risk-off" → one-click filter Commodities to defensives (gold) / Equities to low-beta.
3. Commodity inflation signal → Macro CPI panel (shared "inflation" context key).
4. Any alert → Briefing module as a logged catalyst.
**Architecture note:** These require a lightweight shared **signal/context store** (regime, stress, selected-theme) that all desks read. Today each tab owns isolated state inside the god component. ⚠

---

# Part 9 — Data Coverage (Regional)

| Widget | Scope today | Evidence | Target |
|---|---|---|---|
| Macro geographies | US-centric; quick chips hardcoded `USA/DEU/JPN/KEN` (`:4443`) | ✅ | Global registry (already has `macroGeographies` list) |
| Macro indicators (FRED) | **US-only** (FRED is US) | ✅ `FRED_MACRO_SERIES` | Add DBnomics/TE for non-US |
| FX rates | Global pairs | ⚠ | Global |
| Commodity contracts | Global benchmarks (WTI/Brent/Gold…) | ✅ universe `:163` | Global |
| Commodity inventory | **US** (EIA weekly, USDA WASDE) | ✅ `583`,`623` | Add IEA/JODI global |
| Commodity region filter | UI exists (Global/USA/Europe/Asia/Emerging `:5128`) but **backend ignores region** | ⚠ region param not in list endpoint (`:1221`) | Wire regional pulls |

**Classification:**
- **Global:** FX, commodity prices, commodity curve (once real).
- **Regional:** Commodity inventory (US), macro calendar.
- **Country-specific:** All FRED macro indicators (US).

**Coverage roadmap (regions):** US (now) → Europe/UK/Japan/China (Tier-2 economies, DBnomics/TE) → Canada/Australia/India → EM (LatAm, Africa, Middle East). The **region dropdown is a promise the backend doesn't keep** — either wire it or gate it.

---

# Part 10 — Performance Audit

**Current cost drivers (verified):**
- **One 7,915-line component** re-renders on every one of its 99 useState changes; **0 useCallback**, only 17 useMemo (`AnalyticsModule.jsx`). ✅ Every control tweak re-renders both desks' entire subtree.
- Macro polls every **60s**, commodities **120s** (`:1418`); commodities `/analytics` load is short-circuited to no-op (`:1359`) while 13 detail endpoints fire from a separate effect.
- All `macroView`/`commodityView` panels + the dense Terminal table are **always mounted** regardless of active view.
- Inline style objects recreated every render across hundreds of JSX nodes (e.g. every table cell `:4833+`).

**Recommendations (priority order):**
1. **Split the god component** — extract `MacroDesk.jsx` and `CommoditiesDesk.jsx` (and per-view subcomponents). Prerequisite for everything else. ⚠ largest lever.
2. **Lazy-load** non-active desk tabs and non-active `*View` panels (`React.lazy` + gate on active view). Removes the always-mounted empty tables.
3. **Memoize** row renderers and derived rows (`useMemo`/`useCallback`); hoist static style objects to module scope.
4. **Virtualize** long tables (Landing Hub, Terminal, time series) — they already paginate manually (`:5262`), replace with windowing.
5. **Caching:** honor the Part-3 cache TTLs client-side (last-good payload) so tab switches are instant and 429s (environmental on :4000) degrade gracefully — matches the "GET-only retry/circuit-breaker" standing rule.
6. **Progressive load:** render Tier-1 verdict immediately from cache; hydrate Tier-2/3 async (non-blocking). Never block the desk on optional detail endpoints.
7. **Polling → background refresh:** move interval polls to a visibility-aware background refresh (pause when tab hidden). WebSockets/streaming are **Phase 4+**, not now.
8. **Avoid unnecessary rerenders:** the single store means selecting a commodity re-renders the macro tree; component split (item 1) fixes this structurally.

---

# Deliverables

## 1. Macro Desk Audit — verdict
Competent US-macro data terminal with a strong dense-table core (`Macro Indicators Terminal :4767`) and a working regime label — **buried under a query-builder-first layout**. The hierarchy is inverted (Part 6): configuration is Tier-1, verdict is Tier-3. Gaps are structural, not cosmetic: no liquidity, yield-curve viz, credit, growth/inflation quadrant, or cross-asset. **Grade: B− content, D+ IA.**

## 2. Commodities Desk Audit — verdict
Strong inventory panel (EIA/WASDE, genuinely institutional) and clean group/contract navigation — undermined by **two mislabeled panels**: "Flow Attribution / managed money / hedger positioning" is Yahoo volume proxy (`13444`), and "Futures Curve term structure" is a single front-month point (`13507`) that can't form a curve yet still renders a Contango/Backwardation verdict. **These are integrity issues — relabel or gate immediately.** **Grade: B inventory, C overall, integrity flag on Flows/Curve.**

## 3. Component Inventory
| Desk | Panel | Lines | Keep/Promote/Gate |
|---|---|---|---|
| Macro | Regime hero | 4412 | Promote → Tier-1 |
| Macro | Control columns | 4430 | Gate → collapse |
| Macro | Overview cards | 4495 | Promote → metric strip |
| Macro | View panels (ts/compare/map/cal/rank/fc) | 4535 | Gate → disclosure |
| Macro | Indicators Terminal | 4767 | Promote → Tier-1 |
| Macro | FX + Movers | 4885 | Keep → Tier-2 |
| Macro | Risk / Correlation / Alerts | 4948 | Keep; risk→stress tile |
| Commod | Filter bar | 5099 | Gate → collapse |
| Commod | Stat strip | 5148 | Keep → metric strip |
| Commod | Landing Hub | 5255 | Promote → Tier-1 |
| Commod | Price/Flows/Season/Curve/Compare | 5331 | **Flows+Curve: relabel/gate** |
| Commod | Inventory + Catalyst | 5751 | Promote → Tier-1 |

## 4. Data Dependency Matrix
See **Part 3** (full matrix). Headline: Macro=FRED (US), Commodities=Yahoo prices + EIA/USDA inventory. Free upgrade paths: CFTC (COT), FRED (liquidity/curve/credit).

## 5. Information Hierarchy Diagram
```
MACRO                          COMMODITIES
Tier1 Regime · Stress          Tier1 Group heat · Inventory delta
      Liquidity · Rates              Contract stress · Top movers
Tier2 FX/$ · Inflation         Tier2 Curve · Seasonality
      Calendar · Cross-asset         Positioning* · Calendar
Tier3 Compare/Rank/Forecast    Tier3 Price table · Compare
      Map · Corr · Alerts · Src      Flow ledger · Rules · Src
                               (*once real COT wired)
```

## 6. Recommended Layout Diagram
```
┌───────────────────────────────────────────────┐
│ Desk tabs  │  [global search] [alerts] [status●]│  command bar
├───────────────────────────────────────────────┤
│ HERO: Regime verdict + one-line "what to do"   │  Tier-1
├───────────────────────────────────────────────┤
│ Metric strip: 4–5 signal tiles (prioritized)   │  Tier-1
├───────────────────────────────────────────────┤
│ Analytical core (Terminal table / Inventory)   │  Tier-1
├───────────────────────────────────────────────┤
│ [ Filters ▸ ]  (collapsed control bar)         │  Tier-3 on demand
│ Tier-2 context row: FX/Curve · Calendar        │  Tier-2
│ ▸ Drill drawer: compare/forecast/raw/source    │  Tier-3 disclosure
└───────────────────────────────────────────────┘
```

## 7. Priority Matrix
| Priority | Item |
|---|---|
| **High** | Fix mislabeled Flows & Curve (integrity); invert hierarchy (verdict-first); collapse control columns; gate empty/placeholder panels; add Net Liquidity + Yield Curve (FRED, free); wire or hide region dropdown. |
| **Medium** | CFTC COT positioning; split god component; lazy-load views; virtualize tables; client cache/last-good; growth-inflation quadrant; credit spreads; DXY composite. |
| **Low** | FX/correlation heatmaps; cross-desk signal bus; multi-region macro (DBnomics/TE); freight/Baltic; crack spreads; nowcasting; WebSockets. |

## 8. Implementation Roadmap
- **Phase 1 — UX (no new APIs):** Invert hierarchy (verdict hero + metric strip on top, controls collapsed); progressive disclosure of drill panels; **relabel Flows to "Price/Volume Proxy" and gate the Curve card until ≥2 contracts**; hide placeholder/empty panels; component split begins. All achievable with existing data.
- **Phase 2 — Data integration (existing/free providers):** Net Liquidity, Yield Curve, Credit spreads (FRED); CFTC COT (real positioning); full futures curve (CME/Barchart); wire region dropdown; EIA refinery/crack inputs.
- **Phase 3 — Advanced analytics:** Growth/Inflation quadrant, FX & cross-asset correlation matrices, economic surprise index, cross-desk signal bus (regime → equities/commodities tilts).
- **Phase 4 — Predictive intelligence:** Nowcasting models, rate-expectation curves, streaming refresh where latency matters.
- **Phase 5 — AI-assisted insights:** Auto-generated "what should I know before deciding?" briefings per desk, regime-change narration, anomaly alerts feeding the Briefing module.

---

## Appendix A — Evidence Index
| Claim | Citation |
|---|---|
| One 7,915-line god component | `AnalyticsModule.jsx` wc |
| 99 useState / 17 useMemo / 0 useCallback | grep count |
| Macro tree 4409–5096; Commodities 5097–5945 | activeTab conditionals |
| Flows = Yahoo volume proxy | `index.js:13444–13448` |
| Curve = single front-month point | `index.js:13506–13507` |
| Flows panel mislabeled "managed money…hedger" | `AnalyticsModule.jsx:5397` |
| Macro = FRED; energy = EIA | `index.js:205,496,506` |
| Inventory = EIA/WASDE | `index.js:583,623,13000` |
| Poll 60s macro / 120s commodities | `AnalyticsModule.jsx:1418` |
| Region dropdown not sent to backend | `:5128` vs `:1221` |
| Hardcoded geo chips USA/DEU/JPN/KEN | `:4443` |

## Appendix B — Markers
✅ Verified in source this session · 🟡 partial/mislabeled · ❌ absent · ⚠ inferred · ❓ needs runtime check · (est.) estimate.
