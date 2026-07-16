# Zenin Architecture Audit — Asset Intelligence Platform
### Portfolio + Macro + Company + Commodity · Blueprint for Phases 2–5

> **AUDIT ONLY.** No code was modified. All findings are grounded in the current
> repository (`frontend/src`, `backend/index.js` — 198 routes) as inspected on audit date.
> Constraints: Brand v2 (monochrome, desktop-first, institutional density, progressive
> disclosure, reuse-before-creation, no fabricated intelligence).

---

## 1. Executive Verdict

**Verdict: Structurally ready, semantically fragmented. Proceed — but abstract before you extend.**

Zenin has already crossed the hardest threshold: it has *two* fully-realized asset
verticals (Company + Commodity), each with Research Workspace + Profile, launched
through **one shared `AssetModal`** and routed through **one SPA route spine**
(`routeState` + `history.pushState`, no react-router). The plumbing to become an Asset
Intelligence Platform physically exists.

What is missing is **abstraction and connection**, not capability:

- **Abstraction gap.** Every asset vertical is hand-written. `AssetModal` already
  normalizes 7 asset kinds (`normalizeAssetKind`), but downstream (workspace, profile,
  routes, fetch) each type is a bespoke branch. There is **no `Asset` interface, no
  registry, no adapter layer**. Commodity-specific logic is copy-forked from equity
  logic rather than generalized.
- **Connection gap.** Intelligence is computed in silos. `deskIntelligence.js` derives
  macro/commodity executive signals **inside the Analytics desk only**; Portfolio never
  consumes them. Macro regime (`/api/macro/regime` exists) influences **nothing** outside
  the Macro desk. The `zenin:navigate` cross-desk bus exists but handles 4 intents.
- **Relationship gap.** Cross-asset relationships are **three hardcoded JS maps**
  (`COMMODITY_RELATIONS` ×2, `COMPANY_TO_COMMODITIES` ×1) duplicated across files. There
  is **no entity registry, no relationship graph, no backend relationship service**.

**Bottom line:** the roadmap is viable and the sequencing is correct. Phase 2 (Asset
Abstraction) is the keystone — do it first, because Phases 3–5 all compound its debt if
skipped. Estimated: Phase 2 is a 2–3 week refactor that pays for itself by making 3/4/5
additive rather than multiplicative.

---

## 2. Current Architecture (as-built)

```
                         ┌─────────────────────────────────────────┐
                         │  App.jsx  (SPA shell, 97 useState hooks)  │
                         │  routeState + history.pushState/popstate  │
                         └───────────────┬───────────────────────────┘
        ┌───────────────────────────────┼───────────────────────────────┐
        │ route types: compare · company · asset · commodity ·          │
        │              commodity-profile · onboarding · app(section)     │
        └───────────────────────────────┴───────────────────────────────┘
   sections (activeSection): Home Briefing Portfolio Watchlist Research
                             Analytics Options Predictions Decisions Journal Tax

   ── LAUNCHER ──────────────────────────────────────────────────
   AssetModal (shared)  → normalizeAssetKind(): stock crypto forex
                          indicator bond commodity etf
        └ subsystem: assetModal/{AssetChart,AssetHeader,ResearchTabs,
                     PortfolioContext,tabs/*}

   ── DESTINATIONS ──────────────────────────────────────────────
   AssetResearchWorkspace (equity)   CommodityResearchWorkspace
   CompanyProfilePage (equity)       CommodityProfilePage
   AnalyticsModule → desks: crypto options equities macro commodities
   PortfolioModule → portfolioIntelligence/{Overview,Analysis,Rail,
                     services/*,models/*}

   ── INTELLIGENCE (siloed) ─────────────────────────────────────
   deskIntelligence.js   (macro/commodity executive, allocation) → Analytics only
   marketIntelligence.js (breadth, momentum, concentration)      → Analytics only
   normalizeAssetData.js (single fn, equity-shaped)
   portfolioIntelligence/services/* (orders, executions, alerts)  → Portfolio only

   ── CROSS-DESK BUS ────────────────────────────────────────────
   window 'zenin:navigate'  dispatch: deskV2Modules.jsx
                            listen:   App.jsx (portfolio/watchlist/decisions/equities)
```

**Backend (198 routes) — vertical, not generic:**
`/api/commodities/*` (14), `/api/macro/*` (14), `/api/equities/*` (18),
`/api/analytics/{crypto,options,macro,equities}`, `/api/db/{portfolio,watchlist,trades}`,
`/api/decision-threads/*`, `/api/daily-briefing/*`. **No `/api/asset/*` namespace.**

---

## 3. Target Asset Intelligence Architecture

```
                    ┌──────────────────────────────────────┐
                    │        Asset Registry (client)         │
                    │  kind → { adapter, routes, actions,    │
                    │          workspaceTiers, profileTiers, │
                    │          fetchers, relations }         │
                    └───────────────┬───────────────────────┘
                                    │  resolves
   AssetModal (Universal Launcher)  ▼
   ── identical action bar for EVERY kind ─────────────────
   Research · Profile · +Portfolio · +Watchlist · Alert ·
   Journal · Decision · Compare · Related Assets
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
   <AssetResearchWorkspace kind=…>   <AssetProfilePage kind=…>
   (ONE component, tiers from registry, adapters supply data)
                    │
                    ▼  publishes signals
   ┌──────────────────────────────────────────────────────┐
   │  Intelligence Bus  (event-driven + on-demand compute)  │
   │  macro regime → sector/commodity/holding cascade →     │
   │  Portfolio recommendation → Decision                   │
   └──────────────────────────────────────────────────────┘
        ▲              ▲              ▲              ▲
   Macro Desk    Research WS    Relationship    Portfolio
   (regime)      (thesis)       Graph (exposure) (holdings)
```

**Design principles (all achievable by refactor, not rewrite):**

1. **One workspace, one profile, parameterized by `kind`.** Collapse
   `AssetResearchWorkspace` + `CommodityResearchWorkspace` → `AssetResearchWorkspace`
   whose tier list comes from the registry. Same for the two profile pages.
2. **Adapters own fetch + shape.** Each kind's adapter maps its vertical API
   (`/commodities/:sym/fundamentals`, `/finviz`, `/equities/stocks/:sym/fundamentals`)
   into a normalized `AssetSnapshot`. UI never sees a vertical schema — mirrors the
   proven `portfolioIntelligence/services/OrderNormalizationService` adapter-registry
   pattern already in the repo.
3. **Intelligence publishes, consumers subscribe.** `deskIntelligence.js` becomes a
   shared service emitting regime/signal state onto the bus; Portfolio, Profiles, and
   Watchlist read from it instead of recomputing.
4. **Relationships come from data, not literals.** Replace the 3 hardcoded maps with a
   graph service (client cache first, backend later).

---

## 4. Asset Registry (proposed shape)

Single source of truth for "what every asset kind can do." Grounded in the kinds
`AssetModal.normalizeAssetKind` already recognizes, plus roadmap kinds.

```
AssetKind = stock | crypto | option | commodity | etf | bond
          | fund | index | currency | private

registry[kind] = {
  label, icon,
  adapter,                 // AssetAdapter (see §11)
  routes: { research, profile, compare },   // path builders
  actions: [Research, Profile, AddPortfolio, AddWatchlist,
            Alert, Journal, Decision, Compare, Related],
  workspaceTiers: [...],   // ordered tier ids the WS renders
  profileTiers:   [...],
  capabilities: { hasOptions, hasFundamentals, hasCurve,
                  hasInventory, hasSeasonality, tradable }
}
```

| Kind | Today | Route | Research WS | Profile | Adapter status |
|---|---|---|---|---|---|
| stock | ✅ full | `/app/company/:s`, `/app/asset/:s` | AssetResearchWorkspace | CompanyProfilePage | implicit (finviz + equities) |
| commodity | ✅ full | `/app/commodities/:s(/profile)` | CommodityResearchWorkspace | CommodityProfilePage | implicit (commodities/*) |
| crypto | ⚠ modal only | via `asset` | partial (modal tabs) | ✗ | implicit (crypto-market) |
| option | ⚠ desk only | ✗ | ✗ (OptionsModule) | ✗ | ✗ |
| etf | ⚠ treated as stock | via `asset` | shared w/ stock | shared | none |
| index | ✗ | ✗ | ✗ | ✗ | ✗ |
| currency | ⚠ forex kind exists | ✗ | ✗ | ✗ | ✗ |
| bond | ⚠ kind exists | ✗ | ✗ | ✗ | ✗ (mmf/reits partial) |
| fund | ⚠ mmf/reits routes | ✗ | ✗ | ✗ | partial (equities/mmf) |
| private | ✗ | ✗ | ✗ | ✗ | ✗ |

**Finding:** 2 kinds are first-class, 5 are partial (recognized by the launcher but with
no workspace/profile), 3 are absent. The registry formalizes this matrix and makes
"add a kind" a config entry + one adapter, not a new page tree.

---

## 5. Navigation Map

**Current route types** (`parseRouteFromLocation`, App.jsx:461–495):
`compare · company · asset · commodity · commodity-profile · onboarding · app`.

```
Entry points → destinations (observed):

Watchlist search ─┐
Analytics desks ──┤
Portfolio rows ───┼─► setSelectedAsset ─► AssetModal ─► Research | Profile
Command palette ──┤                                      │
Company/Commodity ┘                                       └─► pushState route

Company Profile ─(COMPANY_TO_COMMODITIES)─► Commodity Research   [1-way, hardcoded]
Commodity WS    ─(related companies)──────► openCompanyProfile   [1-way, hardcoded]
Allocation card ─(zenin:navigate)─────────► Portfolio/Watchlist/Decisions/equities
```

**Findings:**
- **Duplicated pathways:** `type:"company"` and `type:"asset"` both resolve equities —
  two routes, overlapping meaning. Should collapse to one `asset` route with kind.
- **Dead ends:** crypto/option/etf/index/currency reach the modal but have **no
  Research/Profile destination** — the action buttons either hide or route to an
  equity-shaped page. Every partial kind is a potential dead end.
- **Asymmetric actions:** commodity modal exposes Research + Commodity Profile;
  equity modal exposes Research + Company Profile; crypto exposes neither profile.
  Actions are **not identical across kinds** (audit goal fails today).
- **Universal launcher:** `AssetModal` **should** become the canonical launcher —
  it already normalizes kinds. Gap is downstream destinations, not the launcher.

**Target:** one `/app/asset/:kind/:symbol(/profile|/compare)` hierarchy; `company`
and `commodity` become aliases that redirect (preserve existing URLs / no dead links).

---

## 6. Relationship Graph (Phase 5)

**Current state — three hardcoded literal maps, duplicated:**

| Map | File | Direction |
|---|---|---|
| `COMMODITY_RELATIONS` | CommodityResearchWorkspace.jsx:36 | commodity → companies/ETFs/countries |
| `COMMODITY_RELATIONS` | CommodityProfilePage.jsx:25 | **duplicate** of above |
| `COMPANY_TO_COMMODITIES` | CompanyProfilePage.jsx:6 | company → commodities |

**Findings:**
- **No entity registry.** Companies, commodities, ETFs, countries, currencies, indices,
  macro indicators exist only as ad-hoc strings inside these maps.
- **No graph.** Relationships are 1-hop and hand-curated for a handful of liquid names.
  The roadmap's example (`Copper → Freeport → CopperETF → Chile → Mining → Industrial
  Metals → Inflation → PMI → Portfolio`) is **impossible** today — it needs multi-hop
  traversal.
- **No backend service / API.** No `/api/asset/related` or graph endpoint. `/api/macro/correlation`
  and `/api/commodities/correlation` exist but are numeric matrices, not entity edges.
- **Duplication risk:** the two `COMMODITY_RELATIONS` copies will drift.

**Target:** an `EntityRegistry` (nodes: {id, kind, aliases}) + `RelationshipGraph`
(edges: {from, to, type, weight, source}). Client-cached first (consolidate the 3 maps
into one seed), backend `/api/asset/related?id=&depth=` later. Powers "Related Assets"
uniformly and feeds the macro→portfolio cascade (§8).

---

## 7. Portfolio Intelligence Architecture (Phase 3)

**Current behavior: intelligence engine in structure, dashboard in reach.**

The `portfolioIntelligence/` subsystem is genuinely well-built (see its `ARCHITECTURE.md`):
slim `PortfolioModule` orchestrator → `PortfolioOverview` + `PortfolioAnalysis` + rail;
pure data layer (`domainModels`, `OrderNormalizationService`, `ExecutionService`,
`AlertEngine`); adapter registry for brokers; explicit empty states; monochrome tokens.
It **already computes** exposure (sector/country/currency/factor via `exposureRows`,
`attributionRows`, `exposureSummary`), portfolio health, drift, concentration, alerts.

**The gap is consumption, not computation.** Portfolio computes exposure from *holdings*
but consumes **zero external intelligence**:
- Does **not** import `deskIntelligence.js` (macro/commodity signals).
- Does **not** read `/api/macro/regime` — macro exposure is absent.
- Does **not** ingest Research Workspace thesis, Profile data, or Predictions.
- "Research coverage", "provider confidence", "asset freshness" cards: not present.

**Verdict:** it is an *execution/exposure* engine, not yet a *cross-domain intelligence*
engine. It answers "what do I hold and how concentrated am I" but not "what does the
macro regime / my research / commodity signals imply for what I hold."

### Tier hierarchy (where each intelligence card belongs)

| Tier | Surface | Cards |
|---|---|---|
| **Tier 1 — Portfolio page (always visible)** | PortfolioOverview | Portfolio health, Risk concentration, Sector/Commodity/Macro/Currency/Country exposure summary, What-needs-attention, Recommended changes |
| **Tier 2 — Analysis tabs (drill-down)** | PortfolioAnalysis tabs | Factor exposure, Correlation, Execution quality, Costs, Events, Attribution, Research coverage, Tax opportunities |
| **Tier 3 — Drawers (progressive disclosure)** | slide-over | Per-holding thesis, Provider confidence, Asset freshness, Per-exposure drill (which holdings drive Chile/Copper/USD), Decision links |

**Additions needed (consume, don't rebuild):**
- **Commodity exposure** — map holdings → commodities via the §6 graph.
- **Macro exposure** — subscribe to regime bus; show regime-sensitive holdings.
- **Portfolio thesis** — aggregate Research Workspace theses across holdings.
- **Research coverage** — % of holdings with saved research (data exists via research service).
- **Provider confidence / freshness** — reuse `deskIntelligence.computeConfidence` +
  `freshnessFrom` (already exist) and `DataAgeChip`.

---

## 8. Macro Intelligence Architecture (Phase 4)

**Current behavior: macro is a destination, not an engine.**

`/api/macro/*` is rich (14 routes incl. `/regime`, `/forecast`, `/rankings`, `/map`,
`/correlation`, `/timeseries`, `/region|country/:code/overview`). `deskIntelligence.js`
has `deriveMacroExecutive({ regimeLabel, regimeScore, ... })` and `regimeTone`. But:

- **Macro influences nothing outside the Macro desk.** `grep` for regime/macro
  consumption shows it read in Analytics/Briefing/Home/Commodity WS/Journal, but **not**
  in Portfolio, Company Profile, Watchlist, or the Decision engine.
- **No cascade.** The roadmap's pipeline
  `Macro → risk regime → affected sectors → affected commodities → affected holdings →
  portfolio recommendation → decision` exists as **zero connected links**. Each arrow is
  a missing transform.
- **`deriveMacroExecutive` is called locally** inside the desk render, not published.

### Target pipeline (hybrid: event-driven regime, on-demand cascade)

```
/api/macro/regime ──► IntelligenceBus.publish('regime', {label, score, drivers})
        │  (event-driven: recompute only when regime data changes)
        ▼
regime → affectedSectors   (via §6 graph edges: regime→sector)
       → affectedCommodities (graph: sector→commodity, existing COMMODITY_RELATIONS seed)
       → affectedHoldings   (on-demand: intersect with portfolio holdings)
       → portfolioRecommendation (reuse buildCommodityAllocation pattern, generalized)
       → decision           (existing /api/decision-threads)
```

**Event-driven vs on-demand:** regime state is low-frequency → **event-driven publish**
(compute once, fan out). The holding-level cascade is portfolio-specific and
high-cardinality → **compute on demand** when Portfolio/Profile mounts or regime changes.
This avoids recomputing every holding on every macro tick.

**Reuse:** `deriveMacroExecutive`, `regimeTone`, `buildMarketSignal`,
`buildCommodityAllocation` (already generalizes rows→recommendations with a `regime` arg)
are the seed transforms — they need lifting from desk-local calls to a shared service.

---

## 9. Cross Asset Architecture (Phase 5)

**Depends on §6 (graph) + §4 (registry). Cannot ship before them.**

```
EntityRegistry (nodes)          RelationshipGraph (edges)
  company:FCX                     FCX ─produces→ commodity:COPPER
  commodity:COPPER                COPPER ─tracked_by→ etf:COPX
  etf:COPX                        COPPER ─produced_in→ country:CHILE
  country:CHILE                   CHILE ─in_sector→ sector:MINING
  sector:MINING                   MINING ─part_of→ theme:INDUSTRIAL_METALS
  indicator:PMI                   INDUSTRIAL_METALS ─sensitive_to→ indicator:INFLATION
  currency:USD                    INFLATION ─signaled_by→ indicator:PMI
                                  * ─exposed_in→ portfolio:HOLDINGS
```

**Existing (to consolidate):** the two `COMMODITY_RELATIONS` + `COMPANY_TO_COMMODITIES`
maps are the seed edges — merge into one graph seed, dedupe, add provenance.

**Missing:**
- Entity registry (typed nodes with aliases; today: bare strings).
- Multi-hop traversal (`related(id, depth, edgeTypes)`).
- Backend graph service + `/api/asset/related` (client-cached seed ships first).
- Uniform "Related Assets" UI (each vertical hand-rolls its own related panel today).

**Backend services needed:** entity resolver, edge store (seed static → later derived
from correlation/holdings/fundamentals), traversal endpoint. Keep numeric correlation
(`/api/*/correlation`) as *weights* feeding edges, not as the graph itself.

---

## 10. State Ownership Matrix

**Finding: App.jsx is a 97-`useState` god-component; asset/market state is duplicated
and re-fetched per surface. No single source of truth for asset data.**

| State | Current owner | Duplication | Target |
|---|---|---|---|
| `routeState` | App.jsx:1438 | — (correct) | keep — single router |
| `selectedAsset` | App.jsx:1437 | — | keep — launcher input |
| `assets` (universe) | App.jsx:1361 | re-derived in desks | keep, expose via context |
| `portfolio` | App.jsx:1375 | mirrored in PortfolioModule | lift to PortfolioProvider |
| `watchlistAssets` | App.jsx:1387 (+5 aux) | Watchlist re-reads | WatchlistProvider |
| `decisionThreads` | App.jsx:4499 | Decision module re-fetches | DecisionProvider |
| macro regime | **desk-local** (AnalyticsModule) | recomputed in 5 files | **IntelligenceBus (SSOT)** |
| commodity fundamentals | fetched per page (WS + Profile) | 2× fetch same symbol | adapter cache |
| company finviz | CompanyProfilePage:912 + modal | 2× fetch | adapter cache |
| relationship maps | 3 literals in 3 files | 2 are identical | 1 graph seed |

**Classification:**
- **Server state** (should be cached/deduped, not in `useState`): asset prices,
  fundamentals, macro series, commodity data, portfolio/watchlist/trades from `/db/*`.
  → introduce a query cache (or reuse `resilientData.js` which already does
  `readResilientCache`/`writeResilientCache`).
- **Client state** (correctly local): `routeState`, `selectedAsset`, UI toggles,
  `selectedGeoCode`, tab selections.
- **Derived state** (should be computed selectors, not stored): exposure rows, executive
  signals, regime tone — several already are `useMemo` (good), but macro-derived state is
  recomputed in each consumer instead of derived once.
- **SSOT violations:** macro regime (5 recompute sites), commodity fundamentals (2 fetch
  sites/symbol), relationship maps (3 copies).

---

## 11. Backend API Matrix

**Current: 198 routes, fully vertical.** Verticals: `commodities/*` (14), `macro/*` (14),
`equities/*` (18: stocks, mmf, reits, market), `analytics/{crypto,options,macro,equities}`,
`options/*`, `perps/*`, `db/*` (portfolio, watchlist, trades, notifications), `tax/*`,
`decision-threads/*`, `daily-briefing/*`, `prediction/*`, `workspaces/*`.

### Generic vs vertical — recommendation

| Proposed generic | Backing verticals today | Verdict |
|---|---|---|
| `/api/asset/:id/profile` | commodities/:s/fundamentals, finviz, equities/stocks/:s/fundamentals | **Facade** (route by kind) |
| `/api/asset/:id/research` | (client-composed today) | **New thin facade** |
| `/api/asset/:id/signals` | analytics/*, macro/regime | **Facade over deskIntelligence** |
| `/api/asset/:id/related` | none (client maps) | **New service (Phase 5)** |
| `/api/asset/:id/exposure` | db/portfolio + graph | **New (Phase 3/5)** |
| `/api/asset/:id/price` | commodities/:s/price, (equity via provider) | **Facade** |

**Pros of a generic `/api/asset/*` facade layer:**
- One client fetch contract; adapters shrink to kind→endpoint mapping.
- New kinds need a facade branch, not a new client integration.
- Uniform shape enables the shared workspace/profile.

**Cons / cautions:**
- Do **not** rip out vertical routes — they carry kind-specific richness
  (commodity curve/seasonality, equity fundamentals, macro series). The facade should
  **compose** them, not replace them.
- Facade adds a hop; keep it thin (routing + shape-normalization only).
- Auth/rate-limit (the environmental 429s) must be handled at the facade uniformly.

**Recommendation:** additive facade — introduce `/api/asset/*` that internally calls the
existing vertical routes and returns a normalized `AssetSnapshot`. Zero breakage,
incremental adoption per kind.

---

## 12. Shared Component Matrix

**Strong reusable base already exists** — the platform is component-rich; the problem is
verticals that *fork* instead of *reuse*.

| Component / util | Location | Reuse status |
|---|---|---|
| `CompactWorkspaceUI` (Layout, Panel, Section, MetricStrip, cards, gauges) | components/ | ✅ used by both workspaces — keep as the shared kit |
| `AssetModal` + `assetModal/*` (chart, header, tabs) | components/ | ✅ shared launcher; generalize actions |
| `InstitutionalPanels` | components/ | ✅ shared panels |
| `deskV2Modules` / `deskV2IA` | components/ | ⚠ desk-specific; some panels generalizable |
| `DataAgeChip`, `Sparkline`, `staleNotice` | components/utils | ✅ freshness primitives — use platform-wide |
| `deskIntelligence.js` | utils/ | ⚠ shared math, **desk-local invocation** — lift to service |
| `marketIntelligence.js` | utils/ | ✅ pure, reusable |
| `normalizeAssetData.js` | utils/ | ⚠ **single equity-shaped fn** — must become adapter registry |
| `resilientData.js` | utils/ | ✅ cache layer — basis for server-state dedupe |
| `portfolioIntelligence/services/*` | components/ | ✅ **exemplary adapter pattern to copy** for AssetAdapters |

**Duplication to eliminate:**
- `AssetResearchWorkspace` vs `CommodityResearchWorkspace` → one, tier-driven.
- `CompanyProfilePage` vs `CommodityProfilePage` → one, tier-driven.
- 2× `COMMODITY_RELATIONS` → one graph seed.
- Per-vertical "related assets" panels → one `<RelatedAssets>` fed by the graph.

**Pattern to replicate:** `OrderNormalizationService`'s adapter-registry (provider→normalized
entity) is exactly the shape `AssetAdapter` (kind→normalized snapshot) should take. Copy it.

---

## 13. Information Hierarchy (Brand v2 progressive disclosure)

```
Tier 1  Always visible (scan in <5s)
        · Asset: price, day, thesis verdict, recommendation, regime tag
        · Portfolio: health, top exposures, what-needs-attention
        · Every card explainable, no fabricated values (honest "Unavailable")

Tier 2  One interaction away (tabs / sections)
        · Asset: supply/demand, fundamentals, technicals, positioning, macro drivers
        · Portfolio: factor/correlation/execution/costs/research-coverage
        · Cross-asset: related entities (1-hop)

Tier 3  Progressive disclosure (drawers / slide-overs)
        · Per-holding thesis, provider confidence, freshness
        · Multi-hop relationship traversal (Copper→…→PMI)
        · Decision ledger, journal links, raw sources / methodology
```

**Enforcement:** the registry's `workspaceTiers`/`profileTiers` arrays encode this order
per kind, guaranteeing identical reading order across assets (Brand v2 requirement).

---

## 14. Priority Matrix

| Priority | Item | Why | Effort |
|---|---|---|---|
| **HIGH** | Asset Registry + `AssetAdapter` interface | Keystone; unblocks 3/4/5 | M |
| **HIGH** | Merge 2× workspace → 1 tier-driven; 2× profile → 1 | Kills largest duplication | M |
| **HIGH** | Consolidate 3 relation maps → 1 graph seed | SSOT; unblocks Phase 5 | S |
| **HIGH** | Lift `deskIntelligence` regime → IntelligenceBus | Unblocks Phase 4 cascade | M |
| **HIGH** | Universal AssetModal actions (identical per kind) | Fixes dead ends / asymmetry | S |
| **MEDIUM** | Portfolio consumes macro + graph exposure (commodity/macro cards) | Phase 3 core value | M |
| **MEDIUM** | Macro→sector→commodity→holding cascade (on-demand) | Phase 4 core value | L |
| **MEDIUM** | `/api/asset/*` facade (profile/signals/price) | Simplifies adapters | M |
| **MEDIUM** | Collapse `company`+`asset` routes → `asset/:kind` w/ aliases | Nav dedup, no dead links | S |
| **LOW** | Backend relationship service + `/api/asset/related` | Client seed suffices first | L |
| **LOW** | Add index/currency/bond/fund/private workspaces | Additive once registry exists | M each |
| **LOW** | Server-state query cache (dedupe fetches) | Perf/cleanliness | M |

Effort: S ≈ 1–2d, M ≈ 3–7d, L ≈ 1–2wk.

---

## 15. Implementation Roadmap

### Phase 2 — Asset Abstraction *(keystone; do first)*
**Dependencies:** none. **Migration:** additive, per-kind adoption.
1. Define `Asset`/`AssetSnapshot` interface + `AssetAdapter` (copy `OrderNormalizationService` pattern).
2. Build `assetRegistry` seeded with stock + commodity (the two working kinds).
3. Refactor `AssetModal` action bar to render from `registry[kind].actions` (identical set).
4. Merge workspaces → one `AssetResearchWorkspace` driven by `workspaceTiers`; keep both
   URLs working via registry route builders. Repeat for profiles.
5. Collapse `company`/`asset` routes with backward-compatible aliases.
   **Exit:** stock + commodity run through one workspace/profile/registry; URLs unchanged;
   no dead links; live-verify both render (honest Unavailable where data absent).

### Phase 3 — Portfolio Intelligence *(depends on P2 registry + graph seed)*
1. Consolidate relation maps → graph seed (§6).
2. Add Tier-1 exposure cards: commodity + macro (subscribe to bus; map holdings via graph).
3. Add Tier-2 research-coverage + Tier-3 per-holding thesis/confidence/freshness (reuse
   `computeConfidence`, `freshnessFrom`, `DataAgeChip`).
   **Exit:** Portfolio reads external intelligence; exposure answers "which holdings drive X".

### Phase 4 — Macro Intelligence Engine *(depends on P2 bus + P3 graph)*
1. Lift `deriveMacroExecutive` into a shared IntelligenceBus service; publish regime
   (event-driven).
2. Implement on-demand cascade regime→sector→commodity→holding→recommendation (generalize
   `buildCommodityAllocation`), terminating in a Decision link.
3. Subscribe Portfolio / Profiles / Watchlist to regime.
   **Exit:** a regime change visibly propagates to affected holdings + a recommendation.

### Phase 5 — Cross Asset Intelligence *(depends on P2 registry + P3 graph seed)*
1. Promote graph seed → `EntityRegistry` + `RelationshipGraph` with multi-hop traversal.
2. Ship uniform `<RelatedAssets>` fed by the graph across all surfaces.
3. Backend `/api/asset/related` + edge store (static seed → derived from
   correlation/holdings). Migrate client from seed to API behind the same interface.
   **Exit:** multi-hop chains (Copper→…→PMI→portfolio) traversable; one related-assets UI.

**Estimated order & critical path:** P2 → (P3 ∥ P4-prep) → P4 → P5. P2 is the hard
dependency for everything; the graph seed (small) should land inside P2/early-P3 because
both P3 and P5 need it.

---

## Appendix — Technical Debt Register (observed, not fixed)

| Debt | Location | Impact |
|---|---|---|
| 97 `useState` in App.jsx | App.jsx | god-component; state hard to trace |
| Duplicate `COMMODITY_RELATIONS` | CommodityResearchWorkspace + CommodityProfilePage | will drift |
| Two equity routes (`company`/`asset`) | App.jsx:476–495 | ambiguous nav |
| `normalizeAssetData` is single equity-shaped fn | utils/ | blocks multi-kind |
| `deskIntelligence` invoked desk-locally | AnalyticsModule | macro trapped in desk |
| Per-symbol double-fetch (WS + Profile) | commodity + company | wasted calls, 429 pressure |
| Scope bug class (fixed this session) | AnalyticsModule desk props | see note below |
| Fetches assume live backend; 429 is environmental | all verticals | honest empty states required |

> **Note (not part of audit scope, prior session):** a `selectedGeoCode is not defined`
> crash existed because `AnalyticsSpecializedDesk` referenced outer-scope state as a free
> variable. Fixed by passing it as a prop. Flagged here only as evidence that the desk's
> prop boundary is fragile — the registry/adapter refactor should formalize desk inputs.

---

## Constraints compliance (this document)

Audit only — **no code, components, styling, or features were changed** (only this
`.md` was written). All recommendations honor Brand v2: monochrome, desktop-first,
institutional density, progressive disclosure, reuse-before-creation, no fabricated
intelligence (honest "Unavailable" mandated throughout). Every finding is grounded in
named files/routes inspected in the current repository.
