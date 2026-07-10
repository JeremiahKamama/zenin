# UI Dead Control Audit (Engineering Grade)

**Application:** Zenin frontend (`/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend`)
**Method:** Full static execution-trace of every interactive control across all modules (3 parallel subagent passes + independent parent re-verification of high-impact findings + prior Tier 1–3 context). The two highest-impact findings (Analytics handler, orphaned component) and the two "Wrong Output"/"Misleading" claims were re-traced line-by-line before reporting.
**Coverage:** Home, Dashboard, Portfolio, Watchlist, Briefing, Journal, Decisions, Research, Analytics, Tax Estimator, Settings, Auth, Sidebar, Navigation, Command Palette, Modals, Drawers, Empty States.
**Status:** Audit only — no code modified, no PRs created.

---

## DB-001

### Classification
Cosmetic

### UI Location
Analytics
Macro desk
Control-panel footer

### Control
Button
"Update Dashboard"

### Component
`frontend/src/components/AnalyticsModule.jsx`

### Expected Behavior
A reasonable user expects clicking "Update Dashboard" to commit the selected geography / indicator family / display mode / timeframe and trigger a dashboard refresh.

### Actual Behavior
The control panel already updates analytics state **live** (geo/indicator/mode chips mutate state immediately on click). `macroView` defaults to `"chart"` (line 663). The button only re-assigns `"chart"` to a state that is already `"chart"` — no fetch, no re-render delta, no observable change. The panel's own chip options (line 596, sourced from `analyticsConfig.macroViewOptions`) may set `view.key` values that the `macroView === "chart"` render branch (line 4124) does not consume, so those chips can also render nothing — compounding the dead-end.

### Evidence
- Handler: `onClick={() => setMacroView("chart")}` (line 4021)
- Default: `const [macroView, setMacroView] = useState("chart")` (line 663)
- Live chip setters: `onClick={() => setMacroView(view.key)}` (line 4080)
- Render gated on `macroView === "chart" ?` (line 4124)
- Chip options come from `analyticsConfig.macroViewOptions` (line 596), not the hardcoded `"chart"` the button sets
- No `zeninFetch` / nonce bump in the handler chain

### User Impact
**Medium** — Appears on a primary analytics surface; implies a save/commit that silently does nothing, eroding trust and inviting repeated clicks.

### Engineering Complexity
XS

### Regression Risk
Low

### Confidence
98% — Verified by full execution trace (handler → state default → render branch).

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Remove the button (the controls already apply instantly), or make it commit a real selection the render branch actually consumes.

### Suggested PR
Standalone Cleanup

---

## DB-002

### Classification
Wrong Output

### UI Location
Portfolio
Holdings tab
Toolbar header

### Control
Button
"Export"

### Component
`frontend/src/components/PortfolioModule.jsx`

### Expected Behavior
Export the current **Holdings** table the user is viewing in the Holdings tab.

### Actual Behavior
The button invokes `exportExposureReport()` (line 1547), which builds the CSV from `exposureRows` (bucket/name/weight/risk) and downloads `portfolio-exposure-*.csv`. The label "Export" sits in the Holdings tab with no qualifier — the user receives the **Exposure** report, not the holdings they see on screen. (The CSV is a real, valid download; it is simply the wrong dataset.)

### Evidence
- Control: `Export` button at line 2375 → `exportExposureReport()`
- `exportExposureReport` (line 1547) maps `exposureRows` → CSV; `downloadTextFile(csv, 'portfolio-exposure-...csv', ...)` (line 1564)
- No holdings data referenced in the function — only `exposureRows`
- Same handler used by the Exposure context elsewhere; placement in Holdings is the mismatch

### User Impact
**Low** — Produces a real file but the wrong one; a user relying on it for holdings analysis would be misled. Lower frequency than core workflows.

### Engineering Complexity
XS

### Regression Risk
Low

### Confidence
98% — Verified by reading the full `exportExposureReport` implementation.

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Relabel to "Export Exposure" or relocate the control into the Exposure tab where its output matches the label.

### Suggested PR
Standalone Cleanup

---

## DB-003

### Classification
Misleading

### UI Location
Options Calculator
Per-leg row

### Control
Button
"Refresh"

### Component
`frontend/src/components/OptionsCalculator.jsx`

### Expected Behavior
Re-fetch live IV / premium for that leg from the server (the icon + "Refresh" label imply a network refresh).

### Actual Behavior
`refreshLeg(i)` (line 215) reads `getChainIV(strike, type)` and `getChainPremium(strike, type)` — both **local in-memory cache reads** (lines 220–221) — and writes the same values back into state via `updateLeg`. No network call. When the cache is unchanged, the click produces zero visible change.

### Evidence
- Control: per-leg `Refresh` button (line 629) → `refreshLeg(i)` (line 215)
- `refreshLeg` body: `getChainIV` / `getChainPremium` (lines 220–221) are local cache accessors, no `zeninFetch`
- `updateLeg(i, "iv", iv)` / `updateLeg(i, "premium", premium)` (lines 222–223) — state write of cached values
- Contrast: real server refresh exists elsewhere (`fetchDeribitGreeksForLeg`, line 227) — proving the capability is wired but not used by this button

### User Impact
**Low/Medium** — In a financial tool, a "Refresh" that silently does not hit the server undermines trust in pricing data.

### Engineering Complexity
S

### Regression Risk
Low

### Confidence
97% — Verified by reading `refreshLeg` and confirming no network path; legitimate server-fetch function (`fetchDeribitGreeksForLeg`) exists separately.

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Rename to "Re-apply cached values," or wire it to an actual Greeks/quote refetch so the label is honest.

### Suggested PR
Standalone Cleanup

---

## DB-004

### Classification
Unreachable

### UI Location
`frontend/src/components/SubscriptionManager.jsx` (entire file)

### Control
Buttons: "Refresh Subscription", "Change Plan", "Manage Subscription", plan-card "Select {Plan}"

### Component
`frontend/src/components/SubscriptionManager.jsx`

### Expected Behavior
Reachable subscription-management controls the user can click.

### Actual Behavior
Repo-wide search for `SubscriptionManager` returns **only the self-references** inside the file (lines 2, 268, 462). It is never imported or rendered anywhere under `src/`. App.jsx renders its own inline subscription UI (`App.jsx:7528–7649`) via `refreshRevenueCatState` / `handleShowRevenueCatPaywall` / `revenueCatState.access.managementURL`. None of SubscriptionManager's buttons can ever be reached by a user.

### Evidence
- `grep -rn "SubscriptionManager"` outside the file → zero matches
- `export default function SubscriptionManager(...)` (line 268)
- App.jsx owns the live subscription UI (lines 7528–7649) using RevenueCat handlers directly
- No route, no conditional render, no lazy import references the component

### User Impact
**High (engineering)** — Not a broken user experience (users never see it), but it is dead code that masks the real, working subscription path and invites future maintenance on the wrong file.

### Engineering Complexity
S (delete) / M (wire-in)

### Regression Risk
Low (delete) / Medium (wire-in)

### Confidence
99% — Verified by repo-wide grep; the component has zero external references.

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Delete the orphaned component, or wire it in as the real Subscription settings panel (replace the inline App.jsx block with `<SubscriptionManager … />` + real handlers).

### Suggested PR
Technical Debt

---

## DB-005

### Classification
Misleading

### UI Location
Briefing
Decision Queue section
Item action row

### Control
Button
"Open research"

### Component
`frontend/src/components/BriefingModule.jsx`

### Expected Behavior
Open the research document/note related to this specific decision (the label implies item-linked research).

### Actual Behavior
`handleOpenResearch` (line 132) only switches to the Research section via `onOpenSection("Research")` — no item linkage, identical to generic nav. Tier 2's B-3 fix renamed the *same* misleading label in `DecisionThreadModule.jsx` to "Find research," but this Briefing copy was left as "Open research," so it still over-promises relative to its effect and is now inconsistent across surfaces.

### Evidence
- Control: `onClick={handleOpenResearch}` (line 412)
- `handleOpenResearch = useCallback(() => { onOpenSection?.("Research"); }, [onOpenSection])` (line 132) — no `symbol`/`item` passed
- Contrast: Tier-2 B-3 already renamed the DecisionThreadModule equivalent to "Find research" (consistent fix not yet applied here)

### User Impact
**Low** — Minor wording inconsistency; the button does navigate, just not to an item-linked view.

### Engineering Complexity
XS

### Regression Risk
Low

### Confidence
99% — Verified by reading the handler and comparing with the Tier-2 B-3 change.

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Rename to "Find research" to match the Tier-2 B-3 fix and honestly signal "navigate to the Research workspace."

### Suggested PR
Standalone Cleanup

---

## DB-006

### Classification
UX Gap

### UI Location
Portfolio
Chart header

### Control
None (missing toggle — disclosed per audit rules; not a dead button)

### Component
`frontend/src/components/PortfolioModule.jsx`

### Expected Behavior
A user-visible toggle to switch Equity / PnL / Percentage chart modes.

### Actual Behavior
`chartMode` state (line 148) drives `chartData` (lines 396–397, 430–431) but is only ever set by saved-view hydration (lines 1346, 1965). No on-screen control exists, so users cannot switch the view.

### Evidence
- `const [chartMode, setChartMode] = useState(...)` (line 148)
- `chartData` consumed from `chartMode` (lines 396–397, 430–431)
- `setChartMode` callers: saved-view hydration only (lines 1346, 1965) — no UI control binds to it

### User Impact
**Low** — A hidden capability; no broken control, just an unreachable feature.

### Engineering Complexity
S

### Regression Risk
Low

### Confidence
95% — Verified by tracing all `setChartMode` callers.

### Runtime Verification
Static analysis only

### Recommended UX Resolution
Expose a visible Equity / PnL / % mode toggle in the chart header.

### Suggested PR
Standalone Cleanup

---

## Final Summary

| ID | Classification | Impact | Complexity | Risk | Runtime Verified |
|----|---------------|--------|------------|------|------------------|
| DB-001 | Cosmetic | Medium | XS | Low | Static only |
| DB-002 | Wrong Output | Low | XS | Low | Static only |
| DB-003 | Misleading | Low/Med | S | Low | Static only |
| DB-004 | Unreachable | High (eng) | S/M | Low/Med | Static only |
| DB-005 | Misleading | Low | XS | Low | Static only |
| DB-006 | UX Gap | Low | S | Low | Static only |

---

## Metrics

- **Dead Controls:** 0
- **Misleading Controls:** 2 (DB-003, DB-005)
- **Cosmetic Controls:** 1 (DB-001)
- **Wrong Output:** 1 (DB-002)
- **Duplicate Controls:** 0
- **Placeholder Features:** 0
- **Disabled Forever:** 0
- **Unreachable Controls:** 1 (DB-004)
- **UX Gaps:** 1 (DB-006)

---

## Technical Debt (separate from UX issues)

- **Orphaned component:** `SubscriptionManager.jsx` is never imported or rendered (DB-004). Pure dead code.
- **Inconsistent label fix:** Tier-2 B-3 renamed the misleading "Open research" → "Find research" in `DecisionThreadModule.jsx` but the identical pattern in `BriefingModule.jsx:412` was not updated (DB-005) — a partial fix that should be completed for consistency.
- **Hidden capability:** `chartMode` in `PortfolioModule.jsx` is stateful and consumed but has no UI binding (DB-006) — a latent feature with no surface.
- No empty callbacks, no `TODO`/stub handlers, no dead constants, no duplicate handlers/components, and no unreachable routes beyond DB-004 were found.

---

## Highest Priority Fixes (ranked)

1. **DB-004 — Unreachable `SubscriptionManager` (High eng impact).** Entire component is dead code masking the real RevenueCat subscription path. *Why ranked #1:* highest engineering risk of future work landing on the wrong file; trivial to remove, or medium-effort to wire in as the real panel.
2. **DB-001 — "Update Dashboard" cosmetic (Medium).** Implies a commit/refresh that never happens on a primary analytics surface. *Why #2:* visible on a high-traffic screen; repeated no-op clicks erode trust. XS fix.
3. **DB-003 — Options Calculator "Refresh" misleading (Low/Med).** Fakes a server refresh via local cache in a financial tool. *Why #3:* trust-sensitive (pricing data); S effort to make honest.
4. **DB-002 — Portfolio "Export" wrong output (Low).** Downloads Exposure, not Holdings, under a generic label. *Why #4:* produces wrong data but low frequency; XS relabel.
5. **DB-005 — Briefing "Open research" misleading (Low).** Inconsistent with the Tier-2 B-3 fix already shipped. *Why #5:* pure wording consistency; XS.
6. **DB-006 — Portfolio chart-mode UX gap (Low).** Hidden capability; no broken control. *Why #6:* additive feature, not a defect.

---

## Final Assessment

- **Overall UI health: 9 / 10.** After the Tier 1–3 hardening, the reachable UI is functionally sound. No dead buttons, no placeholders, no disabled-forever controls, no duplicate actions. The remaining issues are low-severity cosmetic/misleading/label problems plus one orphaned component.
- **Number of issues found:** 6 (1 Unreachable, 1 Cosmetic, 2 Misleading, 1 Wrong Output, 1 UX Gap).
- **Biggest UX risks:** "Update Dashboard" no-op (DB-001) and the Options Calculator "Refresh" fake-refresh (DB-003) — both imply actions that don't occur, on surfaces where data trust matters.
- **Biggest engineering debt:** The orphaned `SubscriptionManager.jsx` (DB-004) — dead code that diverges from the live App.jsx subscription UI.
- **Recommended implementation order:** (1) Delete/wire `SubscriptionManager` → (2) Remove "Update Dashboard" → (3) Rename Options Calculator "Refresh" → (4) Relabel Portfolio "Export" → (5) Rename Briefing "Open research" → (6) Add Portfolio chart-mode toggle.
- **Estimated effort:** ~1.5 developer-days total (DB-004 dominates if wired-in; ~0.5 day if simply deleted).
- **Suggested PR breakdown:**
  - **Standalone Cleanup PR** — DB-001, DB-002, DB-003, DB-005 (small label/button removals; low risk, fast).
  - **Technical Debt PR** — DB-004 (delete orphaned component, or wire it in).
  - **Standalone Cleanup PR** — DB-006 (add the missing chart-mode toggle).

---

*No code was modified and no pull requests were created. This is an audit-only deliverable suitable for immediate engineering planning.*
