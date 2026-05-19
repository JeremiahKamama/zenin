# Tax Estimator Superdesign Implementation Plan

## Source design

- Superdesign project: `1db5c01c-f7bb-495d-84dc-642d46114698`
- Requested draft: `f0d28ca0-cbf3-4b57-809a-12d1a6c2e764`
- Draft title: `Zenin Capital Tax Estimator`
- Draft type: executive-grid tax workstation with a left jurisdiction ledger, central gains-and-basis ledger, right decision summary, and a full-width scenario comparison table

## Goal

Overhaul the existing Tax Estimator from a compact “form plus summary rail” tool into a workstation-style tax planning surface that matches the fetched Superdesign draft while staying inside the current Zenin `/app` shell.

## Non-goals

- Do not redesign the global `/app` shell as part of this task.
- Do not replace the existing tax engine rules or jurisdiction config system unless the UI requires additional derived data.
- Do not introduce Tailwind or another new styling system. Stay within the current React + namespaced CSS approach.

## Current codebase baseline

### Primary files

- `frontend/src/components/TaxEstimator.jsx`
- `frontend/src/components/CompactWorkspaceUI.jsx`
- `frontend/src/styles.css`

### Current implementation shape

- The page already uses the compact workspace primitives.
- The current layout is a two-column `tax-v2-workspace` with:
  - a left form area
  - a sticky right summary rail
  - a collapsible insights panel
  - results and saved-scenario drawer below
- The current estimator is oriented around aggregate declared gains by bucket, not a transaction ledger.

## Draft-to-code gap analysis

### 1. Information architecture gap

The Superdesign draft is a three-surface workstation:

- left: `Jurisdiction Ledger`
- center: `Gains & Basis Ledger`
- right: `Decision Summary`
- bottom: `Scenario Comparison`

The current implementation is still a compact wizard-like workflow with summary cards and simplified inputs. The draft is much denser and less “stepper/form” oriented.

### 2. Data model gap

The draft assumes a row-based ledger with columns for:

- asset class / instrument
- short-term quantity and gain/loss
- long-term quantity and gain/loss
- cost basis
- fees
- FX rate

The current implementation primarily stores:

- jurisdiction selections
- aggregated gains by tax bucket
- advanced inputs
- scenario comparison results

To implement the draft faithfully, we need a derived transaction-ledger view model built from `trades`, `portfolio`, and `spotPrices`, plus manual overrides for rows that do not exist in trade history.

### 3. Component gap

The current `TaxEstimator.jsx` is a single large component with compact panels. The draft will benefit from extraction into a few focused render helpers or subcomponents, even if they stay in the same file initially.

### 4. Styling gap

The current `tax-v2-*` classes support the compact institutional refresh, but the draft needs a more desk-like grid, denser table typography, more ledger separators, and stronger numeric alignment.

## Proposed implementation strategy

### Phase 1. Stabilize scope and preserve existing shell

Implement only the Tax Estimator page content inside the existing shell in `App.jsx`.

Rules for this phase:

- keep the current sidebar and app shell untouched
- keep the current saved-scenarios flow and export logic
- preserve the existing tax engine APIs and state shape where possible

### Phase 2. Introduce a ledger-first page layout

Refactor the page structure in `TaxEstimator.jsx` into four main sections:

1. `TaxEstimatorHeaderBar`
2. `JurisdictionLedgerPanel`
3. `GainsBasisLedgerPanel`
4. `DecisionSummaryPanel`
5. `ScenarioComparisonPanel`

Target layout:

- desktop: `3 / 6 / 3` column grid
- tablet: stacked `left -> center -> right -> bottom`
- mobile: single-column stacked panels

This replaces the current `tax-v2-workspace` summary-rail composition as the main layout.

### Phase 3. Build a transaction-ledger view model

Add a derived ledger layer in `TaxEstimator.jsx` or move it into a new utility file if it becomes too large.

Recommended helper file:

- `frontend/src/utils/taxEstimatorLedger.js`

Responsibilities:

- normalize trades into ledger rows
- infer asset class buckets from trade metadata
- split realized activity into short-term vs long-term rows
- derive cost basis, fees, FX, and gain/loss per instrument
- generate grouped sections:
  - Equities
  - Digital Assets / Crypto
  - Fixed Income
  - Structured / Special Funds

Important constraint:

- this layer should be read-only and derived first
- manual editing can be introduced as row overrides on top of derived rows, not as a replacement for the current tax state

### Phase 4. Re-map existing input state to the new UI

Keep the current state model, but present it differently:

- `jurisdictions`, `taxYear`, and region filters feed the left jurisdiction ledger
- `gains` and `advanced` state feed the central gains-and-basis ledger
- `results`, `summaryPreview`, and `scenarioComparison` feed the right summary and bottom comparison table

This lets us keep the current calculation engine while changing the presentation layer.

### Phase 5. Rebuild the header around the draft

Update the header area to match the draft more closely:

- small eyebrow: `TAX`
- title: `Global Tax Estimator`
- short description
- right actions:
  - `Saved Scenarios`
  - scenario selector / current scenario status
  - `Export`
  - `Save Scenario`
- optional sync-state block

Implementation note:

- reuse the current actions where possible
- keep the overflow menu logic, but move it behind the draft’s visible controls

### Phase 6. Replace the compact gross-gains form with a real ledger

The central panel should shift from four big bucket inputs to a grouped ledger table.

Recommended behavior:

- show grouped sections by asset class
- show per-row instrument values
- allow inline edits for:
  - gain/loss
  - fees
  - FX
  - classification overrides
- keep a portfolio total/footer row at the bottom

Implementation detail:

- preserve the current aggregate input fields as hidden or derived backing state during the first pass
- once the ledger is stable, derive bucket totals from the ledger instead of the other way around

### Phase 7. Rebuild the right rail into a decision summary panel

Replace the current summary strip with a stronger workstation summary:

- Estimated Liability
- Effective Rate
- Taxable Gain
- Net After Tax
- Delta vs Base Case
- Confidence / rules freshness / data source
- action: `View Rule Details`

Implementation note:

- some of these values already exist
- `confidence`, `rules freshness`, and `data source` may need to be surfaced from runtime config / metadata or mocked from current config until proper backing data exists

### Phase 8. Expand scenario comparison into a true table

The current `tax-v2-scenario-table` is close conceptually but too compact.

Upgrade it into a full comparison table with columns for:

- Scenario
- Description
- Tax Due
- Effective Rate
- Net After Tax
- Delta vs Base
- Delta %
- Key Notes
- Updated

Implementation note:

- current scenario cards and comparison rows can be normalized into a richer table row model
- add row metadata fields without changing the calculation core

### Phase 9. Reposition advanced inputs and insights

The draft does not lead with advanced inputs. Move them behind the main workstation surfaces.

Recommended change:

- keep `Advanced Inputs` as a lower expandable panel
- keep `Insights` / tax-loss harvesting below the main comparison table
- preserve the existing import preview and saved-scenario drawer, but subordinate them visually

### Phase 10. Styling and CSS containment

Do not keep expanding the old compact refresh styles inline. Create a distinct namespaced layer for the workstation overhaul.

Recommended namespace:

- `tax-ledger-*` or `tax-workstation-*`

Keep `tax-v2-*` only where it still meaningfully maps to shared compact primitives.

Styling goals:

- denser ledger rows
- tabular numeric alignment
- stronger grouped section bars
- muted borders with a few meaningful accent colors
- restrained right-panel emphasis
- no consumer-style card gradients

## Suggested file changes

### Must change

- `frontend/src/components/TaxEstimator.jsx`
- `frontend/src/styles.css`

### Likely add

- `frontend/src/utils/taxEstimatorLedger.js`

### Optional shared primitive updates

- `frontend/src/components/CompactWorkspaceUI.jsx`

Only update shared primitives if the Tax Estimator genuinely needs a reusable dense table header or ledger panel structure that other modules can share.

## Recommended implementation order

1. Add the ledger view-model utility.
2. Refactor `TaxEstimator.jsx` into draft-aligned section render blocks.
3. Ship the new desktop/tablet/mobile grid layout.
4. Rebuild the central ledger and right summary panel.
5. Upgrade scenario comparison into the full table.
6. Move advanced inputs and insights lower in the page.
7. Polish saved-scenario and export affordances.
8. Run responsive and keyboard verification.

## Risks

### High risk

- The current data model does not naturally expose full instrument-level tax-ledger rows.
- `styles.css` is already heavily layered; careless additions will create selector conflicts.

### Medium risk

- The draft visually includes shell-level differences that should not be reimplemented inside the page content.
- Replacing bucket inputs with a ledger could accidentally break existing calculation flows if the backing state migration is done too early.

### Low risk

- Header action mapping
- Saved scenario drawer styling
- Export CTA placement

## Open questions before implementation

1. Should the new central ledger be fully editable, or initially read-only with only aggregate overrides?
2. Should `confidence`, `rules freshness`, and `data source` be real runtime-backed values now, or acceptable as static informational metadata in v1?
3. Do we want to keep the current workflow chips at the top, or remove them entirely in favor of the draft’s cleaner operator header?

## Acceptance criteria

- The Tax Estimator matches the Superdesign draft’s workstation hierarchy more than the current compact summary-rail design.
- Desktop layout uses a left jurisdiction ledger, center gains ledger, right decision summary, and full-width scenario comparison.
- Mobile and tablet layouts remain usable without hidden critical controls.
- Existing calculation, save, load, and export flows still work.
- The new UI remains inside the existing Zenin shell and does not regress other modules.
- CSS changes are namespaced enough to avoid side effects outside Tax Estimator.

## Recommended first implementation slice

For the first shipping pass, implement:

- new header
- new three-column layout
- jurisdiction ledger
- decision summary
- expanded scenario table
- keep the current gain inputs under a ledger-styled presentation

Then follow with:

- true instrument-level gains-and-basis ledger
- richer rule-detail metadata
- inline row editing and imports

