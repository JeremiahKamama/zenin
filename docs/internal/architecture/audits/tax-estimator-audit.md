# Tax Estimator — UX, IA & Engineering Audit (Phase 1: Read-Only)

**Date:** 2026-07-10
**Scope:** `frontend/src/components/TaxEstimator.jsx` (2403 lines), `frontend/src/utils/taxEstimatorLedger.js`, `frontend/src/components/InstitutionalPanels.jsx → TaxCompliancePanel`, `frontend/src/App.jsx` (route + `taxSubView`), `theme.css` / `styles.css` (`.tax-workbench-*`).
**Mode:** Audit only. No code was modified. Every finding references concrete lines.

---

## Executive Summary

The Tax Estimator is **not** a stack of unrelated forms — it is actually a fairly coherent single-component workbench with a 3-column primary grid, a collapsed "advanced" grid, and a right-rail drawer. The bones are good. But three structural problems undercut the institutional feel the spec wants:

1. **Results are buried.** `Calculated Liabilities` is rendered **only inside the `showUtilities` collapsed grid** (line 2166 sits inside the `showUtilities ? ( … ) : (toggle)` block at 1897/2236). A user who fills jurisdictions + ledger and clicks **"Run scenario"** (line 1446) or **"Calculate estimated liabilities"** (line 1804) sees *no computed output* unless they also expand **Advanced Context**. That is a broken workflow, not density.
2. **Two competing "calculate" actions + two scenario controls** in different regions (Scenario Inputs has Basis method / Sale timing / Filing year + "Run scenario"; Summary aside has a separate "Calculate"; the Income/Advanced fields live only in the collapsed grid). The primary action is split and duplicated.
3. **Advanced Context dominates** the only place results live. It mixes always-required filing context (realization mode, acquisition/sale dates, FX) with rarely-needed fields (brokerage, staking split, residency, filing status, notes, file import) in one 4-column grid (`.tax-workbench-context-grid` → `repeat(4,1fr)`). Per the spec this is exactly the "collapse everything not needed during normal workflows" target.

These three are the highest-leverage fixes. Detailed below.

---

## Part 1 — Component Inventory

The screen is **one React component** (`export function TaxEstimator`, line 565) plus local presentational helpers and one imported panel. No sub-routing, no child feature components.

| # | Component / Region | Source | Purpose | Inputs | Outputs | State owner | Placement |
|---|---|---|---|---|---|---|---|
| 1 | `CompactPageHeader` (toolbar) | line 1367 (import line 5) | Title + Save/Export/Saved-select actions | `accountantCopy`, handlers `handleSave`/`handleExportCsv`/`handleLoadSavedScenario` | saves/exports | parent | top of form |
| 2 | Form status banner | line 1356 | Transient notice (success/warning) | `formNotice`, `formNoticeTone` | visible alert | parent | below header |
| 3 | Accountant-mode banner | line 1392 | If `accountantMode`, shows audit-trail count | `auditTrail.length` | banner | parent | above Scenario Inputs |
| 4 | **Scenario Inputs** | line 1405 | Jurisdiction combobox, basis method, sale timing, filing year | `jurisdictions[0]`, `advanced.costBasisMethod`, `scenario.shiftDays`, `taxYear` | sets state | parent | section |
| 5 | Scenario Summary (MetricStrip) | line 1449 | Live preview of est. tax / taxable gain / after-tax | `summaryPreview`, `netAfterTax` | read-only strip | derived | inside Scenario Inputs |
| 6 | **Jurisdiction Ledger** | line 1461 | Search, region pills, selected chips, country checklist | `taxRules`, `jurisdictionSearch`, `activeRegion`, `jurisdictions` | toggle jurisdiction | parent | primary-grid col 1 |
| 7 | **Capital Gains Ledger** | line 1571 | Per-section editable gain rows (Equities/Crypto/Bonds/Special/MMFs) | `ledgerSections`, `ledgerOverrides`, validation | `handleLedgerOverride` | parent | primary-grid col 2 (center) |
| 8 | **Decision Summary** (aside) | line 1756 | `summaryModel` stats, validation summary, confidence, rule details | `summaryModel`, `confidenceScore`, `validationState`, `advanced` | "Calculate" submit | parent | primary-grid col 3 (aside) |
| 9 | **Scenario Comparison** | line 1837 | Table of base + comparison jurisdictions / shifts | `scenarioTableRows`, `comparisonScenarios` | add scenario | parent | full-width section |
| 10 | `TaxCompliancePanel` (Checks) | line 1889 (def in `InstitutionalPanels.jsx`) | Wash-sale detection, audit-trail, validation center | `ledgerRows`, `scenarioRows`, `currency`, `summary` | warnings + audit | own local state | full-width section |
| 11 | **Advanced Context** (collapsed) | line 1899 | Realization mode, dates, FX, fees, brokerage, carryforward, exemptions, foreign/withholding tax, residency, regime, filing status, income, notes, file import | `advanced`, `additionalIncome` | `handleAdvancedChange`/`handleIncomeChange`/`handleDocumentImport` | parent | **inside `showUtilities` grid** |
| 12 | **Insights** (collapsed) | line 2117 | Warnings list + tax-loss-harvest suggestions | `inputWarnings`, `taxLossSuggestions`, `showInsights` | show/hide | parent | inside `showUtilities` grid |
| 13 | **Calculated Liabilities** (collapsed) | line 2166 | Per-jurisdiction result cards + liability-by-jurisdiction bar | `results`, `handleCalculate` output | none (display) | parent | inside `showUtilities` grid |
| 14 | Jurisdiction Ideas | line 2248 | Lower-liability alternative suggestions | `jurisdictionRecommendations` | apply/remove jurisdiction | parent | full-width section (conditional) |
| 15 | Compliance & sources footer | line 2286 (`<details>`) | Disclaimer + source links | `taxSources` | expandable | parent | full-width |
| 16 | Saved Scenarios drawer | line 2307 (`RightRailDrawer`) | Load/delete saved estimate states | `savedEstimates` (localStorage) | load/delete | parent | right rail |
| 17 | `JurisdictionCombobox` | line 469 | Searchable jurisdiction select | `taxRules`, value, onChange | select | local | in Scenario Inputs |
| 18 | `LedgerInput` / `TaxField` | line 2367 / 2388 | Controlled decimal/select field primitives | value, onChange, invalid, message | edit | local | in ledger / advanced |

**Helper modules**
- `buildTaxEstimatorLedger({trades, portfolio, spotPrices, gains, advanced, overrides})` → `ledgerSections` (line 659). Source of ledger rows.
- `summarizeLedgerToGains(ledgerSections)` → `effectiveGains` (line 672).
- `buildAdjustedGains(gains, advanced)` (line 166), `calcLiability(key, gains, {ordinaryIncomeTotal})` (line 379), `deriveGainsFromTrades` (line 281) — the calculation engine.
- `TaxCompliancePanel` (InstitutionalPanels) — separate component, own `auditTrail` state hydrated from `loadWorkspaceCollection("tax:audit_trail")` (line ~30 inside it); **reads its own copy of the trail, not the parent's `auditTrail`** — see Part 7 duplication.

---

## Part 2 — Information Architecture Audit

**Current order (verified from JSX):**
```
CompactPageHeader
  ├ form banner
  ├ Accountant banner (if mode)
  ├ Scenario Inputs  ── contains Scenario Summary (MetricStrip)
  ├ primary-grid [ Jurisdiction | Ledger | Decision Summary(aside) ]
  ├ Scenario Comparison (full width)
  ├ TaxCompliancePanel / Checks (full width)
  ├ [showUtilities ?  ── Advanced Context + Insights + Calculated Liabilities
       :  toggle button "Show advanced context, import tools, and liability detail"]
  ├ Jurisdiction Ideas (conditional)
  ├ Compliance & sources (details)
  └ Saved Scenarios (drawer)
```

**What users need first:** jurisdiction → gains ledger (auto from Portfolio/trades) → *calculate* → see liabilities → review warnings → export.

**Critical IA defect:** `Calculated Liabilities` (#13) is a child of the `showUtilities` conditional (lines 1897–2235). The Decision Summary (#8) shows a *live preview* (`summaryPreview`) but **not** the calculated, multi-jurisdiction `results` array. So the literal "Calculate" action (line 1804) populates `results`, but `results` is only visible if the user independently expands Advanced Context. A first-time user will click Calculate, see nothing change in the visible frame, and assume it's broken.

**Redundancy / duplication**
- Two "compute" buttons: "Run scenario" (1446) and "Calculate estimated liabilities" (1804), both `type="submit"` → same `handleCalculate`. Redundant and confusing about which is primary.
- Sale timing (`scenario.shiftDays`) lives in **Scenario Inputs** (1428) but the *comparison* logic that consumes it (`scenarioComparison`, line 864) renders in the separate **Scenario Comparison** section. The control is far from its effect.
- `taxSavingsVsUAE` (733) hard-codes a UAE comparison as the "Vs. base case" stat — a magic comparator baked into the summary with no UI to change it.

**What should move / hide / become progressive disclosure**
- `Calculated Liabilities` should be a **top-level, always-visible** region (right after Decision Summary or as its own primary row), *not* buried in the advanced grid.
- `Insights` (warnings + harvest) is genuinely secondary → keep as collapsible, but **not** gated behind the same toggle as results.
- `Advanced Context` → split into (a) **Filing Context** (always reachable, contains realization mode, acquisition/sale dates, FX, fees — the fields that actually gate calculation) and (b) **Advanced / Accountant** (brokerage, carryforward, exemptions, foreign/withholding, residency, regime, filing status, income, notes, import) inside a drawer or accordion.

---

## Part 3 — Workflow Audit

**Intended journey (spec):** open → choose jurisdiction → import/review holdings → review transactions → run calculation → review liabilities → review warnings → export.

**Where it breaks (code-referenced):**
1. **Holdings auto-seed is silent & override-only.** `deriveGainsFromTrades` runs in a `useEffect` (651) *only if* `!hasManualGainEdit`. The moment a user edits any ledger cell (`handleLedgerOverride` sets `setHasManualGainEdit(true)`, line 1053), the ledger **detaches from live Portfolio/trades forever** — subsequent trade imports won't refresh it. No UI explains this latch. (P1)
2. **Calculate with no visible output** (Part 2 defect) — primary break in the journey.
3. **CSV import is decorative.** `handleDocumentImport` (1265) only sets a filename + preview string; it does **not parse or seed the ledger** (`handleLoadSavedScenario` is the only real state loader). The "Import CSV" button (1586) and file input are a dead path today. (P1)
4. **Save requires a prior calculation** (`handleSave` guards `if (!results.length)`, line 1168). Reasonable, but combined with #2 the user may not realize they need to expand Advanced Context first.
5. **Scenario Comparison adds phantom countries.** `handleAddScenario` (1274) picks `nextCountry = Object.keys(taxRules).find(...) || "Singapore"` — if "Singapore" isn't in `taxRules` it still renders a row with `calcLiability("Singapore", …)` returning 0/NaN-looking output. (P2)

---

## Part 4 — Visual Hierarchy Audit

- **Does everything appear equally important?** Mostly no — the 3-column primary grid gives Jurisdiction/Ledger/Summary clear weight, which is good. But inside the collapsed Advanced grid, 20+ fields render at equal visual weight in a `repeat(4,1fr)` grid (`.tax-workbench-context-grid`), so "Realization mode" (blocks calculation) looks identical to "Brokerage" (cosmetic).
- **Does the eye know where to start?** The Scenario Inputs + Summary strip is a fine starting anchor. The problem is the *end* of the journey (results) is invisible by default.
- **Are important actions obvious?** "Run scenario" (1446) and "Calculate" (1804) compete; neither is visually the single hero action. The collapsed toggle (2244 "Show advanced context, import tools, and liability detail") is a low-prominence text button that hides the entire output.
- **Scanability:** Good in ledger (sticky-like headers via grid), weak in Advanced (flat field grid). Confidence meter (1796) and rules freshness (1800) are buried at the bottom of the aside with no prominence despite being "trust" signals an accountant cares about.

---

## Part 5 — Layout Audit (measured from CSS)

From `theme.css`/`styles.css` `.tax-workbench-*` rules:
- Shell: `.tax-workbench-shell{display:grid;gap:18px}` (collapses to `gap:12px` / `14px` at breakpoints).
- Primary grid: `grid-template-columns: minmax(250px,1fr) minmax(0,1.6fr) minmax(280px,.95fr)` → desktop; `1fr` (single column) on narrow; an intermediate `280px minmax(0,1fr) 270px` at ~`max-width:1100px`-ish.
- Secondary (advanced) grid: `minmax(0,1.15fr) minmax(280px,.8fr) minmax(0,.95fr)` → `1fr` when collapsed.
- Panels: `border-radius:22px` (light) / `4px` (dense), `padding:16px` / `12–14px`.
- Context grid: `repeat(4,minmax(0,1fr))` desktop → `repeat(2,1fr)` → `1fr`.

**Findings:**
- **Cards unnecessarily tall:** The Jurisdiction panel (`col 1`, min 250px) has a `max-height:470px; overflow-y:auto` list (`.tax-workbench-jurisdiction-list`) — good. But the Decision Summary aside stretches full height of the primary grid (`align-items:start` actually, so it doesn't — fine).
- **Wasted space:** Scenario Summary strip (1449) duplicates three numbers that also appear (computed) in Decision Summary. Could be one.
- **Should become side panels / drawers:** Advanced Context income + import + notes → move to a **right-rail drawer** (we already have `RightRailDrawer` for Saved Scenarios — reuse it). Keep only Filing Context inline.
- **Merging:** "Vs. base case" stat (1321) is a one-line derived value; fold into Decision Summary rather than its own card row.

---

## Part 6 — Form Audit

**Always required to calculate:** jurisdiction(s) (validated line 748), acquisition ≤ sale date (754), FX > 0 (759), fees ≥ 0 (763). These gate `handleCalculate` (1079).

**Advanced Context fields (lines 1911–2101), classified:**
- **Always relevant to a real filing** → promote to a compact "Filing Context" bar: `realizationMode` (1911), `acquisitionDate` (1921), `saleDate` (1931), `fxRate` (1943), `fees` (1954).
- **Advanced / accountant-only** → drawer: `brokerage` (1966), `lossCarryforward` (1974), `exemptionThreshold` (1984), `foreignTaxPaid` (1994), `withholdingTax` (2004), `residencyStatus` (2018), `taxRegime` (2027), `filingStatus` (2038), `salary/dividends/interest/staking` income (2049–2087), `notes` (2090), file import (2103).
- **Conditional / should auto-populate:** `fxRate` should default from `spotPrices` when currency ≠ USD instead of sitting at `1` (today it's a manual text field, validated >0, line 759). `acquisitionDate`/`saleDate` should prefill from the ledger's earliest/latest `updatedAt` (the ledger *already* falls back to `row.updatedAt`, lines 1681/1686 — but the advanced date fields don't).
- **Broken composite:** "Staking / airdrops" (2073) is a single input that splits 50/50 into `stakingRewards` and `airdrops` on change (2078) — opaque to the user; should be two fields or a clear note.

---

## Part 7 — Data Audit

**Flow:** `trades`+`portfolio`+`spotPrices` → `buildTaxEstimatorLedger` → `ledgerSections` → `summarizeLedgerToGains` → `effectiveGains` → `buildAdjustedGains` → `calcLiability` → `results`. Display via `summaryPreview` (live) and `results` (on calculate).

**Duplicated state:**
- `auditTrail` exists in **both** `TaxEstimator` (parent, line 590, localStorage `zenin_tax_audit_trail`) **and** `TaxCompliancePanel` (own state, hydrated from `loadWorkspaceCollection("tax:audit_trail")` + localStorage fallback). The panel's append handler writes to its *own* copy; the parent's trail (written in `handleCalculate` line 1162–1164) is never reflected into the panel. **Two sources of truth for the same concept.** (P1)
- `savedEstimates` (parent) and the Saved Scenarios drawer are consistent; fine.

**Derived state:** `summaryPreview`, `netAfterTax`, `effectiveGains`, `scenarioTableRows`, `jurisdictionRecommendations`, `taxLossSuggestions`, `confidenceScore`, `validationState`, `inputWarnings` — all `useMemo`, correct.

**Dead / unused:**
- `taxSavingsVsUAE` (733) is computed but the comparator "UAE" is hard-coded and not configurable — acceptable as a default but should be labeled, not silently "Vs. base case".
- `detectedCountry` (593) is set from `navigator.language` and used only to tag the first matching jurisdiction card "Detected" (1546). Harmless but narrow (only us/gb/ca/de/fr).
- `getDemoGuestState` (547) + `isGuestDemo` path is a separate seeded state for `?guest=1`; it duplicates default state shapes and inflates the component. Acceptable for demo but worth isolating later.

---

## Part 8 — Table Audit (Capital Gains Ledger)

**Columns (from render, lines 1614–1623):** Asset class/instrument · Term · Qty/Units · Cost basis (USD) · Proceeds (USD) · Gain/loss (USD) · Acq. date · Sale date · Fees/FX. 9 columns, grouped into sections by bucket (Equities/Crypto/Bonds/Special Funds/MMFs).

**Missing:** no per-row **realized vs unrealized** flag; no **holding-period** column beyond Term; no **lot identifier**; no **wash-sale flag** at the row level (wash sale is computed only in `TaxCompliancePanel`, not shown inline). No **sorting/filtering** — rows follow `ledgerSections` order only.
**Unnecessary:** "Term" duplicates the classification already implied by short/long gain split; consider merging.
**Excel/Notion/Bloomberg behavior:** Currently a CSS-grid "table" (role=table/row/cell manually set) with **editable cells** (`LedgerInput`). It already supports inline edit. What's missing for institutional feel:
- **Sticky header** on horizontal scroll (the foot row `.tax-workbench-ledger-foot` exists; header `.tax-workbench-ledger-head` does not stick — on narrow screens the ledger scrolls `overflow-x:auto` per `.tax-workbench-ledger-stack` without a frozen first column).
- **Column resize / density toggle** absent.
- **Bulk edit / paste** absent (only per-cell).
- **Virtualization** not needed at current volumes but the whole ledger re-renders on any `ledgerOverrides` change (every keystroke writes `setLedgerOverrides` → `buildTaxEstimatorLedger` recomputes all sections). For large ledgers this is a re-render hotspot (Part 15).

---

## Part 9 — Decision Summary Audit

Current card (lines 1763–1802) shows: Estimated liability, Effective rate, Taxable gain, Net after tax, Vs. base case (5 stats) + validation summary + confidence meter + rules freshness + data source + Calculate button + rule-details toggle.

**Is this enough?** For a decision surface, yes on numbers — but:
- **Confidence belongs elsewhere.** The confidence meter (1796) is a *trust/QA* signal, not a decision metric. Move it to the Compliance/Checks area or the footer, not the hero summary.
- **Assumptions not surfaced.** The summary shows outputs but not *which inputs drove them* (basis method, realization mode, FX). `ruleDetails` (1818) exists but is hidden behind a toggle and only shows base-case logic + a few fields. Surface the active **filing assumptions as a compact sub-line** under the stats.
- **Uncertainty not visualized.** "Effective rate" is shown as a point value with no band. For an accountant, a confidence-based range would be more honest than a single `%`.
- **Calculated Liabilities are absent here** (Part 2). The summary should either contain the primary result or link to it; today it links to nothing.

---

## Part 10 — Checks & Warnings Audit

`TaxCompliancePanel` (line 1889) currently renders:
- **Wash Sale** detection (30-day reacquisition window, `washSaleWarnings` in InstitutionalPanels) — solid, but output is just a string list; no inline row highlight back in the ledger.
- **Audit Trail** — its own state (Part 7 dup).
- The parent also has `validationState` (741) + `inputWarnings` (805) rendered in the aside (validation summary) and in Insights (warnings list, line 2134).

**Should become:** a **Validation / Compliance Center** (single region) combining: blocking errors (red), review warnings (amber), wash-sale flags (with deep-link to the offending ledger row), and the audit trail (read-only, append-only). Consolidate the parent's `validationState` and the panel's checks into one place instead of splitting across aside + panel + insights.

---

## Part 11 — Advanced Context Audit

(See Part 6 classification.) Today the entire Advanced Context is one `repeat(4,1fr)` grid (`.tax-workbench-context-grid`) revealed only by the toggle. It is the single largest block of the page (lines 1911–2114) and contains **both** calculation-gating fields and pure-accountant fields at equal weight.

**Recommendation:** Split into:
- **Filing Context** (inline, compact, 5 fields) — realization mode, acquisition date, sale date, FX, fees. These are what `validationState` checks; they should be visible whenever a calculation is possible.
- **Advanced / Accountant drawer** (reuse `RightRailDrawer`) — brokerage, carryforward, exemptions, foreign/withholding tax, residency, regime, filing status, ordinary income, notes, import. Opened on demand.

---

## Part 12 — Insights Audit

Current `Insights` (2117): a warnings list + (when `showInsights`) tax-loss-harvest suggestion cards (unrealized loss, offset available, estimated saving). It is **gated behind its own Show/Hide** (2129) **and** behind the Advanced toggle. So harvest ideas are double-hidden.

**Should become:** a **Recommendations / Optimization** rail that is *always discoverable* (badge count on the tab when `taxLossSuggestions.length>0`), not nested. Rename to "Optimization" and surface harvest + jurisdiction ideas (Part 2 #14 already exists separately as "Jurisdiction Ideas" — these two should merge into one Recommendations region to avoid two separate insight-like sections).

---

## Part 13 — Accessibility Audit

**Strengths:** ARIA roles manually set on the ledger (`role="table"/"row"/"cell"`) and scenario table; `aria-live` on banner (warning=assertive) and validation summary (polite); `LedgerInput`/`TaxField` wire `aria-invalid` + `aria-describedby` for messages; `useId` used for stable IDs; `aria-expanded`/`aria-controls` on the Advanced toggle and Insights/Rule toggles. Good baseline.

**Gaps:**
- **Keyboard nav into the collapsed results:** because `Calculated Liabilities` is inside a `showUtilities` conditional, a keyboard user must `Tab` to the low-prominence toggle (2244) to reach results — no skip link.
- **Jurisdiction checklist** uses `<label>` wrapping a checkbox (1548) — acceptable, but the card is a `<label>` with a nested `<p>` and button-like affordance; ensure Enter/Space toggles (native checkbox handles it).
- **Color-only signals:** positive/negative tones use class names (`tone="positive"/"negative"`) mapped to color; verify text labels accompany (e.g., delta shows `—` vs value — OK). Confidence meter fill is color-only (gradient) with a `%` text — OK.
- **Contrast:** `.tax-workbench-jurisdiction-foot` font-size `.58rem` with `opacity:.72` (theme.css) is below recommended contrast/size for secondary text. Minor.
- **Hit targets:** collapsed context inputs are fine; pill/region buttons `min-height:38px` OK.

---

## Part 14 — Design System Audit (vs `Brandv2.md` / tokens)

- **Monochrome compliance:** The component uses `var(--tax-*)` tokens and `--color-*` design tokens (interactive, surface, border-subtle, data-primary) — consistent with the monochrome system. No neon/cyan/purple spotted. ✅
- **Radius:** panels `4px` (dense) / `22px` (light) — the two themes diverge; the dense/production theme uses `4px` (Bloomberg-like) which is on-brand; the `22px` light theme is the `--tax-panel` gradient look. Fine as long as the dense theme is the default (it appears to be, given the later overrides win).
- **Typography:** uses `--fs-xs`, `--font-mono` for figures (`.tax-workbench-summary-stat strong`, ledger foot) — good tabular alignment. Some micro-text (`.58rem`) is too small (Part 13).
- **Buttons:** `journal-btn primary/secondary/danger` reused from shared system ✅; `tax-workbench-idea-apply` reuses `--color-interactive` ✅.
- **Empty states:** `GuidedEmptyState` used consistently (ledger, results, saved, insights) ✅ — strong pattern.
- **Loading/skeletons:** **None.** Every compute is synchronous client-side; `handleCalculate` is instant. No async states. Acceptable today but if ledger import/parsing is added (Part 3 #3) a loading state will be needed.

---

## Part 15 — Engineering Audit

- **Component ownership:** One 2403-line component. `TaxCompliancePanel` is the only extracted piece, and it re-implements audit-trail state (Part 7). Recommend extracting: `ScenarioInputs`, `JurisdictionPanel`, `GainsLedger`, `DecisionSummary`, `AdvancedContextDrawer`, `ResultsPanel`, `RecommendationsPanel`. The component is past the point where a single file is maintainable.
- **Shared components:** `CompactPageHeader`, `DensePanelHeader`, `GuidedEmptyState`, `InlineControlGroup`, `MetricStrip`, `RightRailDrawer` (all from `CompactWorkspaceUI`) — good reuse. `TaxField`/`LedgerInput` are local but generic enough to promote.
- **State flow:** All state in the parent; heavy `useMemo` graph (ledger → gains → adjusted → preview → scenarios → recommendations). Correct but **every ledger keystroke** (`handleLedgerOverride`) mutates `ledgerOverrides` → recomputes `buildTaxEstimatorLedger` (full rebuild) → cascades all memos. For large ledgers this is the **primary re-render hotspot**. Mitigation without redesign: debounce overrides or only recompute the touched section.
- **Props drilling:** None problematic (single component). `TaxCompliancePanel` receives `ledgerRows`/`scenarioRows` as flattened props — fine.
- **Performance:** `scenarioTableRows` (922) and `comparisonScenarioRows` (888) each call `buildAdjustedGains` + `calcLiability` per row — O(rows × jurisdictions). Small N today; watch if comparison list grows.
- **Dead code:** `getDemoGuestState` guest path inflates the file; `taxSavingsVsUAE` hard-coded comparator; `detectedCountry` narrow mapping. All noted.

---

## Part 16 — UX Pain Points (ranked)

| # | Pri | Problem | Impact | Recommendation | Effort |
|---|---|---|---|---|---|
| P0-1 | **P0** | Calculated Liabilities render only inside the `showUtilities` collapsed grid (line 2166) — Calculate produces no visible output by default | Core workflow broken; users think calc failed | Promote `Calculated Liabilities` to an always-visible top-level region | 0.5d |
| P0-2 | **P0** | Two competing primary actions ("Run scenario" 1446 + "Calculate" 1804) with no single hero | Ambiguity about how to compute | One primary "Calculate" in Decision Summary; "Run scenario" becomes a secondary "Recalc" | 0.5d |
| P1-1 | **P1** | Ledger detaches from live trades after first manual edit (`hasManualGainEdit` latch, 1053/651) with no explanation | Stale numbers; user unaware | Show a "ledger overridden — re-sync from trades" affordance; explain latch in UI | 1d |
| P1-2 | **P1** | CSV "Import" is decorative (1265 sets filename only; no parse) | Broken promise; wasted control | Either implement parse→`ledgerOverrides` or remove the button | 1d |
| P1-3 | **P1** | Duplicate `auditTrail` state (parent 590 + `TaxCompliancePanel`) | Audit trail inconsistent between surfaces | Single source: lift to parent or pass parent's trail down as prop | 0.5d |
| P1-4 | **P1** | Advanced Context mixes gating + accountant fields at equal weight in one 4-col grid | Cognitive overload; hides what matters | Split Filing Context (inline) vs Advanced/Accountant (drawer) | 1d |
| P2-1 | **P2** | `handleAddScenario` can add a country absent from `taxRules` ("Singapore" fallback, 1280) | Phantom 0/NaN result rows | Guard: only add keys present in `taxRules`; disable when exhausted | 0.5d |
| P2-2 | **P2** | Insights (harvest) double-gated (Advanced toggle + own Show/Hide, 2129) | Harvest ideas invisible | Surface as a Recommendations tab with a count badge | 0.5d |
| P2-3 | **P2** | `fxRate` manual, defaults to `1`, validated >0 | Wrong FX silently zeroes conversions | Auto-seed from `spotPrices` when currency≠USD; warn if overridden | 0.5d |
| P2-4 | **P2** | Ledger recomputes all sections per keystroke (`ledgerOverrides`) | Re-render hotspot at scale | Debounce overrides or section-scoped memo | 0.5d |
| P3-1 | **P3** | Confidence meter buried in aside; "Vs. base case" hard-codes UAE | Trust signals under-used; opaque comparator | Move confidence to Compliance; label the comparator | 0.5d |
| P3-2 | **P3** | Micro-text `.58rem` footers (theme.css) | Contrast/size below AA-ish | Bump to `.62–.66rem`, raise opacity | 0.25d |
| P3-3 | **P3** | Two separate insight-like sections (Insights 2117 + Jurisdiction Ideas 2248) | Split mental model | Merge into one Recommendations region | 0.5d |

---

## Part 17 — Opportunities (patterns from reference products)

- **Bloomberg / Stripe Dashboard:** Put the **result front-and-center** (P0-1). Stripe shows the number first, details below. Mirror: Decision Summary should lead with the liability figure and a one-line assumption context.
- **Carta / Mercury Treasury:** **Progressive disclosure** — Mercury hides entity-setup behind a drawer until needed. Apply to Advanced Context (Part 11): Filing Context inline, everything else in `RightRailDrawer` (we already have the component).
- **Linear / Notion:** **Command density + keyboard-first.** Add a small "Calculate ⌘↵" hint and a skip-link to results for keyboard users (Part 13).
- **Apple HIG:** **Single primary action.** Remove the duplicate (P0-2). One hero button, secondary actions as text/ghost.
- **Institutional clarity:** Surface **assumptions under outputs** (Carta-style "based on FIFO · realized · FX 1.08") so the number is never context-free (Part 9).

---

## Part 18 — Final Recommendations

### Quick Wins (< 1 day)
- **P0-1:** Move `Calculated Liabilities` (2166) out of the `showUtilities` block to an always-visible region after Decision Summary.
- **P0-2:** Make "Calculate estimated liabilities" (1804) the single hero; demote "Run scenario" (1446) to a secondary recalc.
- **P1-3:** Pass parent `auditTrail` into `TaxCompliancePanel` as a prop; delete its local duplicate.
- **P2-1:** Guard `handleAddScenario` to `taxRules` keys only.
- **P3-2:** Bump micro-text sizes.

### Medium (≈ 1 sprint)
- **P1-1 / P1-2:** Explain the manual-edit latch; implement or remove CSV import.
- **P1-4 / Part 11:** Split Advanced Context into inline Filing Context + `RightRailDrawer` Advanced/Accountant.
- **P2-2 / P3-3:** Merge Insights + Jurisdiction Ideas into one Recommendations region with a count badge.
- **P2-3:** Auto-seed `fxRate` from `spotPrices`.

### Large (multiple sprints)
- **Extract** the 2403-line component into `ScenarioInputs`, `JurisdictionPanel`, `GainsLedger`, `DecisionSummary`, `AdvancedContextDrawer`, `ResultsPanel`, `RecommendationsPanel` (Part 15).
- **Real calculation backend:** today `calcLiability` is a client-side heuristic over `taxRules` (rate tables in runtime config). For accountant-grade output, move liability math server-side with versioned rule sets and an explainable breakdown (Part 9 uncertainty).
- **Ledger import pipeline:** real CSV/statement parsing → `ledgerOverrides` with validation + loading states (Part 14/P3 loading).

### Proposed Information Architecture (reorganized)

```
Header (CompactPageHeader: title + Save / Export / Saved select)
  ├ Form status banner
  ├ [Accountant banner if mode]
  │
  ├ Scenario Toolbar        ← Jurisdiction combobox · Basis method · Sale timing · Filing year · [Calculate ⌘↵ hero]
  ├ Summary Ribbon         ← Estimated liability · Effective rate · Taxable gain · Net after tax  (live preview)
  │
  ├ Primary grid:
  │    [ Jurisdiction Ledger ] [ Capital Gains Ledger (editable) ] [ Decision Summary aside
  │                                                          + Filing Context (realization/dates/FX/fees) ]
  │
  ├ Calculated Liabilities ← ALWAYS VISIBLE (was buried) + liability-by-jurisdiction bar
  ├ Scenario Comparison     ← base + comparison rows
  ├ Compliance Center       ← blocking errors · warnings · wash-sale (deep-linked) · audit trail  (consolidated)
  ├ Recommendations         ← harvest + jurisdiction ideas, count badge  (merged Insights+Ideas)
  ├ Compliance & sources (details)
  └ Saved Scenarios (drawer)
        Advanced / Accountant context → RightRailDrawer (opened on demand)
```

**Why:** This puts the *output* (Calculated Liabilities) immediately after the *inputs* (Summary Ribbon + grids), gives one hero Calculate, consolidates the three scattered validation/insight surfaces into a single Compliance Center + a single Recommendations region, and pushes rarely-used accountant fields into a drawer — exactly the "collapse everything not needed during normal workflows" directive. It preserves every existing capability (nothing removed) while fixing the broken calculate→see-results path.

---

*Audit complete. No files modified. Ready for Phase 2 (implementation) with minimal ambiguity — every recommendation above maps to a specific line range in `TaxEstimator.jsx`.*
