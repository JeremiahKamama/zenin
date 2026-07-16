# Zenin Watchlist — Institutional End-to-End Audit

**Mode:** Read-only code-aware audit. No source modified.
**Date anchor:** 2026-07-15. **Build:** green (2523 modules).
**Scope:** Watchlist module + its asset modals, ARW routing, comparison, import, persistence, and cross-product integration as exercised by Watchlist entry points.

---

## 1. Executive Verdict

**Overall Watchlist score: 7.4 / 10** (institutional discovery + monitoring + research-entry surface).

- **Strong:** asset identity/routing for stocks/ETFs/commodities/indicators/crypto; honest "research-only" FX/currency treatment; modal layout (chart/context siblings); plural-aware currency meta; persisted watchlist; optimistic add/remove.
- **Most important workflow risk:** **FX-pair and currency-code comparison is mis-routed into the indicator-only comparison surface** (`navigateToCompare` hardcodes `type:"equity"`, and every Watchlist/ARW `onCompare` emits a bare symbol). This violates the audit's Phase 19 acceptance ("No ETF or FX route enters the indicator-only comparison drawer").
- **Highest-priority remediation:** thread asset `kind` through `onCompare` → `navigateToCompare` → the `compare` route so FX/currency/eTF open `CurrencyResearchWorkspace` / `EtfResearchWorkspace` compare mode, not `ComparisonWorkspace`.

**Caveat (validation limitation):** this is a static, code-aware audit. Live browser interaction (focus restoration, 44px targets, 375px overflow, animation timing) was not executed; those findings are inferred from source + CSS and flagged as *needs live confirmation*. Provider-dependent paths (Yahoo/Finviz/cached fallback chain) could not be hit against a live backend in this environment.

---

## 2. User Journey Map (tested paths)

| Journey | Transition | Status | Notes |
|---|---|---|---|
| Sidebar → Watchlist | category tabs | ✅ | `REQUIRED_WATCHLIST_CATEGORIES = [indicators, commodities, etfs, currencies]` |
| Watchlist → Asset Modal | row "Open" → `handleIntent(asset,"inspect")` | ✅ | modal opens, kind-resolved |
| Modal → Profile/ARW | toolbar CTA → `onViewCompanyProfile` / `onOpenResearch` | ✅ | routed by App openers (`openEtfProfile`, `openCurrencyProfile`, etc.) |
| Modal → Compare | toolbar "Compare …" → `onCompare` | ⚠️ | bare `{kind,symbol}` emitted, but App branch **only** special-cases etf/forex/currency *when invoked from the modal* (line 7666); ARW + Watchlist emit bare sym → falls to `navigateToCompare` → indicator drawer |
| Search → Modal | result click | ✅ | no auto-open on type/selector (verified: no auto-open code in Watchlist) |
| Watchlist → Import | CSV/TSV/JSON/clipboard | ✅ | `WATCHLIST_IMPORT_SOURCES` + `submitImport` |
| FX pair → Currency ARW pair mode | `openCurrencyResearch` | ✅ | `resolveCurrencyInstrument` → `forex` kind |
| Currency code → Currency ARW currency mode | `openCurrencyResearch` | ✅ | `currency` kind; "research-only" enforced |
| Return navigation | modal close / ARW back | ✅ | `onClose={navigateToAppRoute}` restores route |

**Dead ends:** none found at the Watchlist level. **Return paths:** intact via route-state stack.

---

## 3. Architecture Review

- **Navigation:** single `routeState` store in `App.jsx`; Watchlist is a section, not a route — switching categories is local state, no URL churn (acceptable). Modal/ARW are route overlays (`currency`, `currency-profile`, `etf`, `etf-profile`, `company`, `commodity`, `compare`, `macro`).
- **State ownership:** watchlist assets + persistence owned by `App` (`watchlistAssets`, `toggleWatchlistStar`, `isInWatchlist`); Watchlist component is presentational + intent launcher.
- **Data providers:** curated catalogs inline in `backend/index.js` for FX/ETF/currency; Yahoo Finance declared FX quote source; `CurrencyAdapter` returns null price for currency codes (honest). ETF composition provider (`etfIntelligence`/`CORE_ETF_SEED`) is reference-only — live holdings/performance return null.
- **Caching:** `resilientData` read/write for history/performance/fundamentals with TTL + stale flags.
- **Mutation flow:** optimistic add/remove via `toggleWatchlistStar`; toasts confirm.
- **Workspace boundaries:** ARW surfaces (`AssetResearchWorkspace`, `CurrencyResearchWorkspace`) are kind-routed; modal is a pure launcher (no routing logic — correct per v3 design).
- **Asset identity/routing:** `normalizeInstrumentSymbol` + `resolveCurrencyInstrument` canonicalize FX/currency; `buildAssetRoute` resolves profile/research by kind. Strong.

---

## 4. Findings (ranked P0–P3)

### F1 — FX/Currency comparison mis-routes to indicator-only drawer
- **Severity:** P1
- **Classification:** Defect (production behavior fails the spec)
- **Asset type:** FX pairs, currency codes
- **Preconditions:** open USD/CHF or CHF modal/ARW → click Compare
- **Steps:** modal toolbar "Compare FX Pair"/"Compare Currency" → `onCompare({kind,symbol})` (correct from modal) **BUT** ARW/Workspace paths call `onCompare={(sym)=>navigateToCompare(sym)}` with a bare symbol
- **Expected:** FX → FX comparison in `CurrencyResearchWorkspace` pair mode; currency → currency/macro comparison
- **Observed:** `navigateToCompare` (App.jsx:2222) builds `assets:[{symbol, type:"equity"}]` and `setRouteState({type:"compare"})` → renders `ComparisonWorkspace` (App.jsx:7039–7048), the indicator-style comparison. From the *modal* the App branch (App.jsx:7666) does special-case kind, but the ARW/Watchlist call sites (App.jsx:7077, 7090, 7127, 7164, 7177; Watchlist row intent) do **not** pass kind, so they fall through to the indicator drawer.
- **Evidence:** `App.jsx:2222` `type:"equity"`; `App.jsx:7039` `type==="compare"` → `ComparisonWorkspace`; `App.jsx:7164/7177` `onCompare={(sym)=>navigateToCompare(sym)}`
- **User impact:** institutional user comparing EUR/USD or CHF gets an indicator comparison surface with no FX/macro context — wrong tool, misleading.
- **Recommended fix:** make `navigateToCompare` kind-aware (accept `{kind,symbol}` or infer via `resolveCurrencyInstrument`/`getAssetKind`); for forex/currency route to Currency ARW compare mode, for etf to EtfResearch compare; only indicators/equities use `ComparisonWorkspace`. Propagate `kind` from every `onCompare` call site.
- **Acceptance:** USD/CHF Compare → Currency ARW pair mode with USD/CHF preselected; CHF Compare → currency/macro comparison; ETF Compare → EtfResearch compare; no FX/ETF ever renders `ComparisonWorkspace`.
- **Owner:** Frontend (App.jsx routing + Workspace `onCompare` wiring)

### F2 — Currency ARW `view=compare` is accepted but has no `compare` tier
- **Severity:** P2
- **Classification:** Implementation gap
- **Asset type:** FX/currency
- **Evidence:** `CurrencyResearchWorkspace` `MODE_TIERS` (pair/currency) contain no `"compare"` entry (lines 25–26). `useState(validViews.includes(view)?view:"overview")` (line 46) therefore **always** falls back to `"overview"` when `view="compare"`. So even when F1 is fixed and the route passes `view:"compare"`, the workspace ignores it.
- **Expected:** `view=compare` opens FX/currency comparison with the asset preselected (spec §6).
- **Observed:** silently defaults to overview.
- **User impact:** comparison entry from modal produces an overview, not a comparison — dead-end for the intended flow.
- **Recommended fix:** add a `compare` tier/render branch in `CurrencyResearchWorkspace` (pair → FX comparison; currency → currency/macro comparison), or route FX/currency compare to a dedicated `FxCompareWorkspace`.
- **Acceptance:** `view=compare` renders a comparison surface, not overview.
- **Owner:** Frontend (CurrencyResearchWorkspace)

### F3 — ETF Compare from modal is routed but ETF ARW compare surface is thin
- **Severity:** P2
- **Classification:** Implementation gap (partial)
- **Asset type:** ETF
- **Evidence:** `EtfCompare.jsx` exists with `compareEtfs` (seed fields: issuer/benchmark/category/exposure). Modal `onCompare` → `openEtfResearch({symbol, view:"compare"})` (App.jsx:7666) → `AssetResearchWorkspace` inits `activeView="compare"` (honors `view`). But `EtfCompare` shows performance/correlation as "—" (no live provider). This is *honest*, not a defect — flagged as gap only because live holdings/NAV/overlap are roadmap (ETFdb provider 403).
- **User impact:** ETF-vs-ETF comparison works on reference fields; live overlap unavailable (clearly labeled).
- **Recommended fix:** none required for correctness; document live-provider dependency.
- **Owner:** n/a (roadmap: ETF Intelligence Provider)

### F4 — Watchlist has no search type selector; ambiguity resolution relies on global `searchAssets` index
- **Severity:** P3
- **Classification:** Implementation gap (minor)
- **Asset type:** all
- **Evidence:** Watchlist search uses global `searchAssets` (assetSearch.js) which includes the curated FX/ETF/currency catalogs (added this session). No per-result "type selector" UI exists in Watchlist (grep: no `searchType` selector). Selection never auto-opens a modal (verified: no auto-open on type/select). Ambiguity (USD/EUR/CHF as both currency code and potential cross) resolves via index ranking + explicit click.
- **Expected (audit §2):** "Exact currency code ranks before related FX crosses"; "Changing the selector must never open a modal" — selector absent, so the "never opens on selector change" rule is N/A (safe).
- **Observed:** currency code resolves to Currency Modal (correct); FX pair to FX Pair Modal (correct); no IndicatorCountryModal leak.
- **User impact:** none adverse; selector is a future enhancement.
- **Recommended fix:** optional — add a type facet for large result sets; keep click/Enter as sole modal-open trigger.
- **Owner:** Frontend (Watchlist)

### F5 — Provenance/freshness exposed on modal graph cards; per-asset source/timestamp on Watchlist rows not verified
- **Severity:** P3
- **Classification:** Needs live confirmation
- **Asset type:** all
- **Evidence:** `AssetChart` renders source chip (`am-source-chip`); `FxPairModalSummary` shows Quote Source + As-of + Provider Symbol; `CurrencyModalSummary` shows "Reference data". Whether Watchlist *rows* surface per-asset provider/as-of was not verifiable statically (row render not fully read this session).
- **User impact:** if rows omit freshness, stale data is indistinguishable from live.
- **Recommended fix:** ensure each Watchlist row carries a live/cached/stale indicator + source tooltip.
- **Acceptance:** every row shows freshness state; no fabricated P&L/allocation.
- **Owner:** Frontend (Watchlist row)

### F6 — Browser back/forward with modal-as-route-overlay
- **Severity:** P3
- **Classification:** Needs live confirmation
- **Evidence:** modals are route overlays via `pushState`; closing calls `navigateToAppRoute` (pop). Back/forward behavior depends on history entries pushed per open — not fully traced this session.
- **User impact:** potential double-pop or lost context on back.
- **Recommended fix:** verify history semantics in live browser pass.
- **Owner:** Frontend (App routing)

---

## 5. Missing Features (by horizon)

**Quick wins**
- F1/F2: thread `kind` through compare routing + add Currency ARW `compare` tier (unblocks FX/currency comparison end-to-end).
- F5: per-row freshness indicator.

**Medium-term implementation gaps**
- Live ETF holdings/overlap provider (ETFdb 403 → reference-only today).
- Cross-tab sync of watchlist mutations (not verified; likely absent).
- Undo on remove (not verified; likely absent).

**Long-term roadmap** (never report as defects)
- Nested groups, collaboration/version history, manual drag ordering, AI-driven recommendations, advanced bulk editing.

---

## 6. Recommended Fixes (priority order)

1. **P1 — F1:** Make `navigateToCompare` kind-aware; propagate `kind` from all `onCompare` call sites (Watchlist `handleIntent`, ARW `onCompare={(sym)=>navigateToCompare(sym)}`). Route forex/currency → Currency ARW compare; etf → EtfResearch compare; indicator/equity → `ComparisonWorkspace`. *Acceptance: no FX/ETF enters the indicator drawer.*
2. **P2 — F2:** Add `compare` tier/render to `CurrencyResearchWorkspace` (or `FxCompareWorkspace`) so `view=compare` renders comparison, not overview.
3. **P3 — F5/F6:** Add per-row freshness; verify browser back/forward in live pass.

**Owner:** Frontend (App.jsx routing + Workspace `onCompare` wiring + CurrencyResearchWorkspace).

---

## Success Criteria Recap

- ✅ All supported asset types resolve to correct identity and open correct modal/route (stocks/ETF/commodity/indicator/FX/currency).
- ✅ Honest provider/freshness (currency = research-only; ETF = reference data where provider absent).
- ✅ No dead ends at Watchlist level; return navigation intact.
- ⚠️ **Comparison routing for FX/currency is a live defect (F1/F2)** — must be fixed to meet §19.
- ⚠️ Workspace permissions / shared-watchlist / read-only member behavior not statically verifiable this session (flagged as validation limitation, not defect).

**Audit limitation note:** no live backend/credentials in this environment; provider-outage, 429/500, offline, and 1,000-asset perf targets were assessed by code path, not execution. Recommend a live browser pass (375/768/desktop) + a seeded 1,000-asset render to close F5/F6 and the responsive/accessibility checks (§22).

---

# Phase 26 — Research Continuity Audit

**Verdict: PASS (structural) / NEEDS-LIVE (runtime).** Watchlist is a pure launcher; every transition is a route-state push, so context is preserved by the SPA router rather than lost on unmount.

| Transition | Mechanism | Evidence | Status |
|---|---|---|---|
| Watchlist → Modal | `handleIntent(asset,"inspect")` → `setSelectedAsset` | `Watchlist.jsx:552,705,1126` | ✅ |
| Modal → Profile/ARW | toolbar CTA → `onViewCompanyProfile`/`onOpenResearch` → App openers | `App.jsx:2471 openEtfResearch`, `openCurrencyResearch` | ✅ |
| ARW → Scenario Lab / Docs / Journal | tier navigation | `CurrencyResearchWorkspace` tiers include `scenarioLab`,`decisionLedger`,`catalysts` | ✅ (route exists) |
| Research → Portfolio | `PortfolioModule` reads `watchlistAssets` + `selectedAsset` | Phase 31 | ✅ |
| Return to Watchlist | `onClose={navigateToAppRoute}` (pop) | `App.jsx:7162,7166` | ⚠️ see F6 |

- **Selected asset preserved:** ✅ (`selectedAsset` / route symbol persists in store).
- **Scroll / category / filters / search preserved:** ✅ Watchlist category + `importText` + `importRows` are component-local state that survives the modal/ARW overlay (overlay is not a route swap of Watchlist).
- **Compare preserved:** ⚠️ only when compare is its own route; returning from `ComparisonWorkspace` restores via `onBack={navigateToAppRoute}`.
- **No transition loses context** at the launcher level. F6 (browser back/forward with modal-as-route-overlay) remains a live-confirm item.

---

# Phase 27 — Data Quality Audit

**Verdict: PARTIAL.** Provenance is exposed on modals/graph cards but **not uniformly on every rendered field**.

| Field | Provider | Timestamp | Confidence | Fallback | Unavailable reason |
|---|---|---|---|---|---|
| FX quote | Yahoo (`USDCHF=X`) | `updatedAt` | `stale` flag | cache → unavailable | `FxPairModalSummary` "Provider unavailable" |
| Currency code | none (research-only) | — | — | — | `CurrencyModalSummary` "no standalone quote" |
| ETF expense ratio / AUM / holdings | `CORE_ETF_SEED` (reference) | seed `asOf` | "Reference data unavailable" when absent | — | `EtfModalSummary` "—" / "Reference data unavailable" |
| Indicator | FRED / WorldBank / BLS | `macroSnapshot` | `stale`/`unavailable` | cache | `sanitizeMacroSnapshot` + `getSnapshotFallbackMessage` |

- **Never fabricate:** ✅ confirmed — `CurrencyAdapter` (null price), `EtfModalSummary` (explicit unavailable), `FxPairModalSummary` (honest stale).
- **Gap (F5, P3):** per-row Watchlist freshness/provider not statically verified — rows may not answer "where did this come from?" on every field.
- **Recommendation:** add `dataSource` + `asOf` to every metric surface (mirror the audit ETF example: Provider / Updated / Confidence / Fallback / Unavailable reason).

---

# Phase 28 — Provider Health Audit

**Verdict: INFRASTRUCTURE PRESENT, UI SURFACE MISSING.** `DataCoverageRegistry.js` is the universal provider registry with `wired` booleans.

| Provider | Scope | Wired | Evidence |
|---|---|---|---|
| Yahoo | market | ✅ true | `DataCoverageRegistry.js:41` |
| FRED / WorldBank | macro | ✅ true | `:42-43` |
| BLS | macro | ❌ false | `:44` |
| ETF Intelligence (`etfIntelligence`) | fund | ❌ false (reference seed only) | ETFdb 403 |
| FMP / OpenInsider / EIA / Polygon / AlphaVantage / MyStocks / Morningstar | financials/fund/market | ❌ false | `:52-63` |

- **Connected / Rate Limited / Unavailable / Cached / Delayed / Unknown:** registry exposes `wired` only; a live **status enum** is **not** surfaced in Watchlist UI (implementation gap, P3).
- **Provider switching:** `CurrencyAdapter` = Yahoo primary → cache → unavailable; no second live FX provider wired. Honest, but no visible "switched to cache" indicator.
- **Recommendation:** render a `ProviderStatusBadge` driven by `DataCoverageRegistry` + a live probe.

---

# Phase 29 — Cache Integrity Audit

**Verdict: DESIGNED, NOT EXECUTED.** `resilientData` read/write with TTL + `stale` flags backs history/performance/fundamentals.

- **Cold / warm / expired:** TTL present (`getResilientCache`/`writeResilientCache`); expiry → `stale` surfaced (Phase 27).
- **Corrupt cache:** JSON parse wrapped in `try/catch` (`App.jsx:2236 readLS`) → default fallback, no crash. ✅
- **Offline cache:** localStorage-backed reads succeed offline. ✅
- **Race / multiple tabs:** `watchlistAssets` is per-tab `useState` from localStorage; **no cross-tab `storage` sync** — tabs diverge until refresh (implementation gap, P3).
- **Stale indicators:** ✅ (`stale`/`unavailable` rendered).
- **Recommendation:** add `window.addEventListener("storage", …)` to reconcile watchlist mutations across tabs.

---

# Phase 30 — Watchlist Intelligence Audit

**Verdict: PARTIAL / PROVIDER-GATED.** Watchlist surfaces alert assignments + badges (`onLoadAlertAssignments`); live "new filing / holdings change / AUM change" per-asset stream is provider-gated (ETF Intelligence not wired).

- **No fabricated intelligence:** ✅ (alerts from real assignments; empty = no badge).
- **Graceful empty states:** ✅.
- **Timestamps / attribution:** unverified without live backend.
- **Gap (P3):** FX central-bank/inflation + commodity inventory/freight require macro providers (FRED/BLS wired; EIA not) — surfaced only where `wired:true`.
- **Recommendation:** gate intelligence chips on `DataCoverageRegistry.wired`; show "No intelligence provider connected" instead of silent empty.

---

# Phase 31 — Portfolio Integration Audit

**Verdict: PASS (design) / NEEDS-LIVE (runtime).** `PortfolioModule` consumes `watchlistAssets` + `selectedAsset`; modal `PortfolioContext` shows exposure by kind.

- **Already Held / Weight / Avg Cost / Unrealized P/L / Allocation / Exposure / Risk:** computed in `PortfolioModule` via `classifyPortfolioInstrument` + `exposureBuckets`; `PortfolioContext.jsx` renders position + returns + kind-aware exposure (FX base/quote, currency cash, ETF issuer/benchmark).
- **No duplicated calculations:** ✅ `PortfolioModule` owns the math; modal context is a presentational consumer.
- **Round-trip (Watchlist ↔ Portfolio):** ✅ shared store; category/selection preserved.
- **Gap (P2):** `exposureBuckets` + rebalance-blocked message computed but **not yet rendered as a visible Portfolio panel**.
- **Recommendation:** render the exposure panel + rebalance-gate message in `PortfolioModule`.

---

# Phase 32 — Compare Architecture Audit

**Verdict: DEFECT (FX/currency) + PARTIAL (ETF/crypto).** Weakest area (audit agrees).

| Asset | Expected | Actual | Status |
|---|---|---|---|
| Stock | Company Compare | `ComparisonWorkspace` (equity) | ✅ |
| ETF | ETF Compare | `EtfResearchWorkspace` view=compare (modal) / indicator drawer (ARW) | ⚠️ F1/F3 |
| FX | FX Compare | `ComparisonWorkspace` indicator drawer | ❌ **F1** |
| Currency | Currency Compare | `ComparisonWorkspace` indicator drawer | ❌ **F1** |
| Commodity | Commodity Compare | `ComparisonWorkspace` | ⚠️ no commodity-specific compare |
| Indicator | Indicator Compare | `ComparisonWorkspace` | ✅ |
| Crypto | Crypto Compare | `ComparisonWorkspace` (mis-typed equity) | ⚠️ |

- **Never FX/ETF → Indicator Compare:** ❌ violated — `navigateToCompare` forces `type:"equity"` (`App.jsx:2222`); all types funnel into the indicator drawer.
- **Compare preservation / return / swap / add-second / history:** `ComparisonWorkspace` supports pick A/B (`onPick`, `useComparisonAsset` — `comparison/ComparisonWorkspace.jsx:46,69`); **unsupported-comparison messaging absent**.
- **Fix (P1):** kind-aware `navigateToCompare` — forex/currency→Currency ARW compare, etf→EtfResearch compare, indicator/equity→`ComparisonWorkspace`, crypto→crypto-aware; add unsupported-comparison messaging.

---

# Phase 33 — Institutional Research UX Audit

**Verdict: STRONG (density) / NEEDS-LIVE (scan-time).** Monochrome Brand v2; modal = chart + context + summary tiers + research tabs.

- **Information density / hierarchy:** ✅ tiered `.fxs-tier`/`.cms-tier`/`.ems-tier` + `.am-context` groups.
- **Scan time / cognitive load:** structurally low (clear labels, no color noise); not eye-tracked.
- **Desktop / keyboard efficiency:** keyboard launcher + Enter-to-open enforced.
- **Ultrawide 3440px:** `.am-body-grid` caps context 320px, chart flexes — no overflow.
- **Scrolling:** modal body scrolls; context sticky, no nested trap (t10 CSS). ✅
- **Empty states:** ✅ research-only banner + actionable import errors.
- **Search / action discoverability:** ⚠️ no search type selector (F4, P3, acceptable).

---

# Phase 34 — Accessibility Audit

**Verdict: PARTIAL (code) / NEEDS-LIVE (devices).** `useFocusTrap` + `Overlay` + `aria-label`s on summaries/context.

| Device | Overflow | 44px | Focus trap | Focus restore | Reduced motion | Color-independent |
|---|---|---|---|---|---|---|
| 375px | ⚠️ live | ⚠️ live | code ✅ | code ✅ | unverified | ✅ monochrome |
| 768–1920 | ✅ collapses <900px | ⚠️ | ✅ | ✅ | unverified | ✅ |
| 3440px | ✅ | n/a | ✅ | ✅ | unverified | ✅ |

- **Keyboard-only / Shift+Tab / Enter / Escape:** focus trap + Escape implemented; live confirm outstanding (F6).
- **ARIA live for load/success/fail:** import text rendered (`setImportError`/`setImportNotice`); dedicated `aria-live` region not statically confirmed.
- **Recommendation:** live pass at 6 breakpoints; confirm 44px + `prefers-reduced-motion` + `aria-live`.

---

# Phase 35 — Mutation Consistency Audit

**Verdict: STRONG.** `toggleWatchlistStar` (`App.jsx:3788`) is canonical.

- **Optimistic UI:** ✅ `setWatchlistAssets` immediate on remove; add via `addToWatchlist`.
- **Rollback:** ✅ on `removeFromWatchlist` failure, restores `removedEntries` with dedupe (`App.jsx:3814-3821`).
- **Idempotency / dedupe:** ✅ `doesWatchlistEntryMatchAsset` + `getAssetCatalogKey`; double-click guarded by match-check.
- **Retry safety:** `Promise.all` outcomes checked; failure → rollback + `"error"`.
- **401/403/409/429/500:** non-ok → failure → rollback; no per-status messaging (P3).
- **Offline:** optimistic local; persistence failure → rollback.
- **Undo / shared-workspace sync / audit log:** ❌ not implemented (roadmap per Phase 0).
- **Import mutation:** `submitImport` → `importWatchlistAssets` (`App.jsx:3645`); per-row dedupe (Phase 36).

---

# Phase 36 — Import Security Audit

**Verdict: STRONG on parsing; PARTIAL on file guards.**

- **Reject executable/binary:** ✅ `UNSUPPORTED_IMPORT_EXTENSIONS = {xlsx,xls,docx,doc,pdf}` rejected (`watchlistImportParser.js:6`; `Watchlist.jsx:785`).
- **Oversized files:** ❌ **no `file.size` cap** — read via `await file.text()` (`Watchlist.jsx:792`) with no limit (gap, P2).
- **Malformed JSON / CSV:** ✅ `JSON.parse` in `try/catch` → structured/loose fallback (`parser.js:145-152`); bad rows skipped.
- **Formula injection (`=`,`+`,`@`):** ⚠️ **partial** — `normalizeImportSymbol` strips non-`[A-Z0-9.\-_:]` (`parser.js:10-14`), neutralizing `=SUM(A1)` as a *symbol*, but **`name`/`theme`/`notes` fields are NOT formula-stripped** before render (low risk — no `innerHTML` — but spreadsheet-formula prefix survives). Recommend explicit strip.
- **Duplicate rows:** ✅ deduped by `symbol::marketType::category::theme` (`parser.js:153-159`).
- **Mixed asset classes:** ✅ `inferImportType` + `normalizeImportCategory`.
- **Per-row validation / partial success:** ✅ each row independent; invalid → `null` → filtered; valid rows survive.
- **Sensitive data in logs/errors/console:** ✅ generic user-facing strings only (`Watchlist.jsx:796,808`); no PII logging.

**Fixes (P2):** add `file.size` cap (~5MB) + formula-strip `value.replace(/^[=+\-@]/,"")` on name/theme/notes.

---

# Phase 37 — Regression Matrix

| Workflow | Stocks | ETFs | Commodities | FX | Currency | Indicators | Crypto | Bonds | Index |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️* | ⚠️* |
| Modal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️* | ⚠️* |
| Add | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️* | ⚠️* |
| Remove | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️* | ⚠️* |
| Compare | ✅ | ⚠️** | ⚠️ | ❌*** | ❌*** | ✅ | ⚠️**** | ⚠️* | ⚠️* |
| ARW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️* | ⚠️* |
| Intelligence | ✅ | ⚠️† | ✅ | ⚠️† | ⚠️† | ✅ | ⚠️ | ⚠️* | ⚠️* |
| Portfolio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️* | ⚠️* |
| Export | ⚠️‡ | ⚠️‡ | ⚠️‡ | ⚠️‡ | ⚠️‡ | ⚠️‡ | ⚠️‡ | ⚠️* | ⚠️* |

\* Bonds / Index: no dedicated catalog/modal in traced code → roadmap/unsupported, not defects (Phase 0).
\** ETF compare works from modal (view=compare); ARW path mis-routes (F1/F3).
\*** FX / Currency compare mis-routes to indicator drawer (F1 — P1 defect).
\**** Crypto compare forced to `type:"equity"`.
\† Intelligence gated by provider `wired` status (Phase 30).
\‡ Export not traced this session → follow-up, not a confirmed defect.

---

# Final Deliverables Index

1. **Executive Summary** — §1 (7.4/10; P1 compare-routing defect).
2. **Architecture Review** — §3.
3. **User Journey Map** — §2 + Phase 26.
4. **Routing Validation** — §3 + Phase 3/8 + F1/F2.
5. **Modal Validation** — §7 + F2/F3/F5.
6. **Data Provider Audit** — Phase 28 + Phase 27.
7. **Cache Audit** — Phase 29.
8. **Intelligence Audit** — Phase 30.
9. **Performance Audit** — §24 (code-path only; live 1,000-asset pending).
10. **Accessibility Audit** — Phase 34 + F6.
11. **Security Audit** — Phase 36.
12. **Regression Matrix** — Phase 37.
13. **Engineering Backlog** — F1(P1); import size-cap + formula-strip, exposure-panel render (P2); provider-status UI, cross-tab sync, intelligence gating, a11y live pass (P3).
14. **Prioritized Fixes** — §6.
15. **Acceptance Criteria** — per finding.

**Net new from Phase 26+:** 2 P2 (import size cap + formula-strip; Portfolio exposure-panel render), 4 P3 (provider-status UI, cross-tab sync, intelligence gating, a11y live pass). Compare-routing P1 (F1) carried from §19. **No source modified (audit-only).**
