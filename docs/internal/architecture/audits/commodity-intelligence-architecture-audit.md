# Commodity Intelligence Architecture Audit

> Read-only architectural audit of Zenin's Commodities Desk. No code modified.
> Evidence markers: ✅ verified in source · ⚠ inferred · ❓ requires runtime verification.
> Frontend cites are against current `frontend/src/components/AnalyticsModule.jsx` (8,229 lines).
> Backend cites are against `backend/index.js` (commodities routes `12936–13669`), unchanged by prior session edits.

---

## Executive Summary

| Dimension | Score | Basis |
|---|---|---|
| Architecture | **C−** | Commodities = slices of one 8,229-line god component; 0 `useCallback`; all commodity state in parent. |
| Institutional readiness | **B− inventory / C overall** | EIA/NOAA inventory genuinely live; **Flows/Curve mislabeled proxies**. |
| Scalability | **D+** | No lazy-load of commodity panels; all `*View` always mounted. |
| Engineering health | **C** | Works; inverted IA + mislabeling + 3 unsynced thesis stores. |
| Brand v2 compliance | **B** | Monochrome + dense tables ✅; violates "reuse before creation" + "no duplicate UI". |
| CARW feasibility | **B+** | `ResearchWorkspacePanel` already `scope`-param'd; `AssetModal` already recognizes `commodity`. |

**Overall: B− content, C architecture.** Phase 1–2 need **no new providers**.

---

## Part 1 — Current Commodity Architecture

Render tree (single god component, tab-gated):

```
AnalyticsModule (:845) — owns ALL commodity state (commoditiesData :865)
└─ AnalyticsLayout (:7723) — presentational, NO hooks
   ├─ top-level commodity board (:5239) — executive+filter+stats
   └─ AnalyticsResearchBoard (:6122) — NO hooks; if(!config) return
      └─ AnalyticsSpecializedDesk (:6255, React.memo) — terminal
         └─ isCommodities branch (:6947) → return :7188
```

- Shape `EMPTY_COMMODITIES` `:153`; normalize `:693–718`; fetch effect `:1301` (`if(activeTab!=="commodities") return`), `setCommoditiesData` `:1340`, 12 endpoints `:1314–1330`, **120s poll** `:1366`.
- `commoditiesExecutive` `useMemo` `:1878` → `deriveCommoditiesExecutive` (`deskIntelligence.js:113–128`). `commoditiesSignal` `:1883`.
- `selectedCommoditySymbol` `:954` (owner); `onCommoditySelect` `:2427`→`:6140`→`:7060`.
- **Lazy loading:** ❌ none for commodities (only `ReactApexChart` `:3`). **Persistence:** 0 calls in-file.
- Commodity panels are inline JSX inside `AnalyticsSpecializedDesk`: Executive `:7191`, terminal rows `:7028`, Inventory `:5910`/`:7108`, Flows `:5561`, Curve `:5730`/`:6966`, Seasonality `:5656`/`:5662`, Calendar `:5313`.

---

## Part 2 — Commodity Entity Model

| Field | Exists? | Source | Rendered | Missing |
|---|---|---|---|---|
| `updatedAt` | ✅ | `:1342` / `index.js:13207` | `:1880,:2167` | — |
| `overview` | ✅ | `:1347` / `index.js:13216` | `:2382` | — |
| `list` (price, Δ%, YTD, 1Y, region, proxySymbol) | ✅ | `:1348` / `index.js:13135` | `:1833–1865` | proxy pricing only |
| `priceSeries` | ✅ | `:1349` / `index.js:13298` | `:2132,:5487` | empty w/o history |
| `fundamentals` (52W, 30D mom, ann vol) | ✅ | `:1350` / `index.js:13353` | `:2394` | EIA only CL/NG/RB |
| `stress` (inventories/warehouse/weather) | ✅ | `:1351` / `index.js:13389` | `:2395` | EIA/NOAA live CL/NG/RB only |
| `flows` | 🟡 | `:1352` / `index.js:13440` | `:5561` | **Yahoo vol proxy, not COT** |
| `seasonality` | ✅ | `:1353` / `index.js:13471` | `:5662` | computed from Yahoo |
| `curve` | 🟡 | `:1354` / `index.js:13507` | `:5730` | **single front-month pt** |
| `compare` | ✅ | `:1355` / `index.js:13532` | `:2409` | `volatility` always null |
| `calendar` | ✅ | `:1356` / `index.js:13586` | `:5313` | ForexFactory text-match |
| `alerts` | ❌ | `:1357` / `index.js:13618` returns `[]` | `:2397` | rule engine not built |
| `correlation` | ✅ | `:1358` / `index.js:13627` | `:2411` | SPY-only price corr |
| `providers` status | ✅ | `:1359` / `index.js:13212` | `:5294` | EIA/FRED "missing_key" |
| `executive` (derived) | ✅ | `:1878` / `deskIntelligence.js:113` | `:5243` | from `list` Δ% |
| Open Interest / Contract specs / Producers / Consumers / ETF flows / COT | ❌ | — | — | **Commodity Profile + CFTC** |

Derived in frontend: `deriveCommoditiesExecutive` (`deskIntelligence.js:113–128`), `buildMarketSignal` (`deskIntelligence.js:177`), `getSourceQuality` (`AnalyticsModule.jsx:526–547`).

---

## Part 3 — API Dependency Matrix

| Provider | Current commodity usage | Missing opportunity |
|---|---|---|
| **Yahoo** | Front-month prices/series/funds/curve/corr `index.js:13110–13633` | No contract chain, OI, COT |
| **FRED** | Spot **only CL/NG/GC/SI** `:506–554` | No HG/ZC/ZW/cocoa/sugar; not commodity-tagged in macro |
| **EIA** | Inventories **only CL/NG/RB** `:556–794` | No ag (WASDE modeled `:619–642` but not pulled); no refinery util |
| **NOAA/NWS** | Live US weather in `/stress` `:674–763` | US-only; no global crop/energy weather |
| **Finviz** | ETF-proxy (USO/GLD/CPER/CORN…) `:13017–13343` | Proxy only; JJT/NICKEL null |
| **ForexFactory** | Calendar `:13586` | Generic text-match |
| **Massive** | **Unused for commodities** (covers `"Commodities"` in `COVERAGE_PROVIDER_VIEW :120` but no path calls it) | Real institutional futures candidate |
| **FMP/Yahoo/MyStocks** | Stubs `throw …_not_implemented` `equitiesProvider.js:79–115` | No commodity path |
| **equitiesProvider.js** | 0 commodity hits | Commodity sourcing NOT routed through multi-provider abstraction |
| **coverageService.js** | Decorative seed `commodity_prices→yahoo :63` | No EIA/COT/WASDE/LME/ETF-flow rows |
| **CFTC/COT** | **Absent everywhere** | Biggest institutional gap |

---

## Part 4 — Missing Commodity Intelligence (priority-ranked)

- **P0 (free):** CFTC COT positioning; full futures curve (CME).
- **P1:** FRED liquidity/curve/credit; EIA refinery+crack; WASDE crop progress; route Massive into commodities.
- **P2:** Baltic Dry/freight; convenience & roll yield; weather (global); inflation β/DXY; cross-asset corr matrix.
- **P3:** Mining production; OPEC tracker; supply-chain/demand dashboard; commodity vol surface.

---

## Part 5 — CARW vs existing Asset Research Workspace

- `ResearchWorkspacePanel` `InstitutionalPanels.jsx:792` is `scope`-param'd (`zenin_research_workspace_${scope}` `:793`; already mounted per desk `:2565–2573`). Equity-only fields to gate: `Earnings` `:874`, `Filings` `:870`.
- `AssetModal` `:19` — `normalizeAssetKind` already returns `commodity` `:62`; launcher to ARW `:81`.
- **CARW = `AssetResearchWorkspace` parameterized by `assetKind="commodity"`.** No fork. Satisfies Brand v2 "reuse before creation."

---

## Part 6 — Commodity Profile

Tier 1 Overview · Tier 2 Contract specs (delivery/exchange/tick/hours — ❌) · Tier 3 Market structure (producers/consumers/importers — ❌) · Tier 4 Related assets · Tier 5 Sources. Owned by Profile page; CARW references. No analytical duplication.

---

## Part 7 — Ownership Matrix ⚠ CRITICAL

| Domain | Owner |
|---|---|
| Thesis / Bull-Bear-Base / Catalysts | CARW (consolidated research-service) |
| Journal/Briefings/Predictions/Decisions/Alerts | Shared modules |
| Macro Drivers/Seasonality/Technicals/Inventory/Positioning | Commodities Desk (data) → referenced |
| Contract Specs / Producers-Consumers | Commodity Profile |
| Company Links / Portfolio Exposure | AssetModal / Portfolio |

**⚠ 3 unsynced thesis stores:**
1. `ResearchWorkspacePanel` localStorage `InstitutionalPanels.jsx:794`
2. `ResearchModule` `THESES_NAMESPACE` `ResearchModule.jsx:22,150,387`
3. `AssetResearchWorkspace` `research.theses[0]` `AssetResearchWorkspace.jsx:317–321,374`

**Consolidate on ARW research-service.**

---

## Part 8 — Cross-Desk Integration

Macro→Commodity tilt **not wired**; needs shared signal/context store (regime, stress, theme). Working cross-link: `openFxAsset` → `AssetModal` (FX → asset). Intended chain: Macro → Commodity Intelligence → CARW → Portfolio → Decisions → Journal → Briefing → Compare.

---

## Part 9 — Commodity Navigation

No per-commodity deep-link (❓). Recommend: `Macro → Commodities → Energy → WTI → CARW → Profile → Related → Compare → Portfolio`. Breadcrumbs + workspace persistence (the `research:commodities` key already exists) satisfy back-nav.

---

## Part 10 — Information Hierarchy (inverted today)

- **Tier 1 (verdict):** Group heat · Selected-contract stress · Inventory delta · Top movers.
- **Tier 2:** Curve/term structure · Seasonality · Positioning (once real) · Calendar.
- **Tier 3:** Price table · Compare · Flow ledger · Rules · Source.

Current state: Tier-1 content rendered at Tier-3 altitude (inventory is a footer); controls at top. **Inverted.** Fix: hero verdict + metric strip on top, controls collapsed (pattern `:4548`/`:5091`).

---

## Part 11 — Component Inventory

| Primitive | Location | Verdict |
|---|---|---|
| `CompactPageHeader` | `CompactWorkspaceUI.jsx:3` | ✅ |
| `DensePanelHeader` | `:40` | ✅ |
| `InlineControlGroup` | `:61` | ✅ |
| `RightRailDrawer` | `:154` | ✅ |
| `GuidedEmptyState` | `:65` | ✅ |
| `DataTable` (TanStack) | `data-table/DataTable.jsx:52` | ✅ asset-agnostic |
| `Timeline` | `:523` | ✅ |
| `MetricStrip` | `:26` | ✅ generic `[{label,value,helper,tone}]` |
| `WorkspaceLayout` | `:223` | ✅ used by ARW |
| `Panel`/`MetricCard`/`InsightCard`/`CatalystCard`/`RiskCard`/`ComparisonMatrix`/`AssetSummaryCard` | `:237–892` | ✅ data-agnostic |
| `SourceQualityStrip`/`Badge` | `AnalyticsModule.jsx:7785/7781` | ⚠ defined inside AnalyticsModule, needs extraction |
| `Drawer` / `ActivityFeed` / `RecommendationCard` / `RecommendationDrawer` / `analytics-equities-strip-card` | — | ❌ don't exist (use `RightRailDrawer`/`Timeline`/`MetricStrip`) |

---

## Part 12 — Performance Audit

God component re-renders both desks on any `useState`; 0 `useCallback`; all `*View` always mounted; inline styles recreated per render. Fix order:
1. Split `CommoditiesDesk.jsx` out of `AnalyticsModule`.
2. `React.lazy` non-active views.
3. `useCallback` row renderers + hoist static styles.
4. Virtualize Landing Hub/Terminal.
5. Client last-good cache (matches GET-only retry/circuit-breaker rule).

---

## Part 13 — Data Ownership (canonical)

Prices→Yahoo/FRED · Inventories→EIA/USDA · Positioning→CFTC (future) · Research→CARW (ARW service) · News/Portfolio/Alerts/Briefings/Journal→shared · Macro Regime→Macro desk. Single owner per domain.

---

## Part 14 — UX / Brand v2

Monochrome + density ✅. Violations: god component (no reuse), inverted hierarchy, mislabeled panels (integrity, not just UX). Institutional appearance: strong tables, weak hero/focal point.

---

## Integrity Flags (fix before CARW)

1. **Flows panel** labels "managed money/hedger positioning" but renders Yahoo volume proxy (`index.js:13440`, self-admits). → relabel "Price/Volume Proxy" or gate until CFTC.
2. **Curve panel** renders Contango/Backwardation from single front-month point (`index.js:13507`) → hide card until ≥2 contracts.
3. **3 unsynced thesis stores** (Part 7) → consolidate on ARW research-service.
4. **Alerts** returns `[]` (`index.js:13618`) — rule engine unbuilt.

---

## Priority Matrix

- **P0:** Relabel/gate Flows+Curve (integrity); invert hierarchy; split god component; extract `SourceQualityStrip`; consolidate thesis stores.
- **P1:** CARW via ARW param; Commodity Profile; CFTC COT; full curve; route Massive; client cache.
- **P2:** Cross-desk signal store; macro→commodity tilt; refinery/crack; freight.
- **P3:** AI briefings; nowcasting; streaming.

---

## Final Roadmap

- **Phase 1 (no new APIs):** invert hierarchy, progressive disclosure, relabel/gate Flows+Curve, begin component split.
- **Phase 2 (CARW + Profile):** generalize `AssetResearchWorkspace` to commodities; build Commodity Profile.
- **Phase 3 (institutional data):** CFTC COT, full curve, FRED liquidity/curve/credit, EIA refinery, Massive routing.
- **Phase 4 (cross-desk):** signal store, macro→commodity tilt, correlation matrix.
- **Phase 5 (AI):** auto briefings, anomaly→Briefing.

---

## The Crash Reported — Resolved

- **`AnalyticsSpecializedDesk2` does not exist** in current `AnalyticsModule.jsx`. The commodities terminal is `AnalyticsSpecializedDesk` at `:6255` (memoized); its two hooks (`useState :6260`, `useMacroWatchlist :6265`) run **before** every early `return` (`:6315`, `:7188`) → **hook-order-safe**. `AnalyticsLayout :7723` and `AnalyticsResearchBoard :6122` have **no hooks**.
- The reported stack's `:3065/:2674/:6636` + `?t=1783821625448` = **stale cached module** from an older file revision. After a hard reload it cannot occur in this component. If a crash persists post-reload, capture the **fresh** `?t=` stack (the named component no longer exists).
