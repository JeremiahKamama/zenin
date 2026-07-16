# Zenin — Commodity UX, Navigation & Workflow Audit
**Scope:** Read-only. No code changes, no recommendations with implementation. Every finding cites `file:line` and carries a confidence marker.

Confidence legend:
- ✅ Verified — confirmed from source
- ⚠ Inferred — strongly implied by source, not runtime-confirmed
- ❓ Runtime verification required — needs live app + broker session

> Note: this codebase already completed P2.5/P2.6 (commodity workspace/profile folded into the unified `AssetResearchWorkspace kind="commodity"` / `CompanyProfilePage kind="commodity"` surfaces) and P4–P6 (IntelligenceBus / RelationshipGraph / DecisionEngine). Where those phases changed a surface, it is reflected below. Live rendering was not exercised in this audit (read-only); runtime gaps are flagged ❓.

---

## 1. Executive Summary

| Dimension | Score (1–10) | Notes |
|---|---|---|
| Overall UX maturity | **6** | Strong infrastructure (registry, bus, transmission) but discovery + drill-down gaps remain for commodities. |
| Navigation | **5** | SPA openers are correct in `App.jsx`, but the Asset Modal shadows them; desk has no drill-down; ⌘K is command-only. |
| Workflow | **6** | Research→Profile→Back loops work; macro→commodity→research is partially broken. |
| Institutional readiness | **6** | Honest empty states present; provider/source visibility inconsistent. |
| State management | **5** | Several surfaces keep state local (desk selectors) and lose it on navigation. |
| Information hierarchy | **7** | Brand v2 monochrome largely respected; modal overloads price/earnings data for commodities. |
| Discoverability | **4** | Global ⌘K does NOT surface commodity assets; watchlist has no live asset search. |
| Extensibility | **8** | Registry + `kindSupportsAction` + merged surfaces scale cleanly; the modal's hardcoded route is the one anti-pattern. |

**Headline:** the *plumbing* is institutional-grade; the *front-door* (discovery) and the *drill-down* (desk→research, transmission→commodity) are where commodity users hit friction and dead ends.

---

## 2. End-to-End User Journey Maps

### Discovery → Research → Decision
```
⌘K palette (CommandPalette.jsx)        → command-only, NO asset results ❌ dead-end for asset discovery
Watchlist "Add" (openWatchlistPrompt)  → category/theme prompt, paste-only (App.jsx:2279, no symbol search)
Commodities Desk selector (AnalyticsModule.jsx:5472) → select symbol → internal panels only, NO research/profile link
Macro desk transmission (TransmissionExplorer.jsx:112) → "Open Commodity Workspace" → onNavigate=close ONLY (broken)
Asset Modal (AssetModal.jsx:84)        → "Open Research Workspace" → hardcoded /app/asset/${symbol} (stock route, even for commodities)
  ↓ (correct path only when opened from a commodity route, via prop) 
Asset Research Workspace kind="commodity" (AssetResearchWorkspace.jsx:197)
  ↓ "Commodity Profile" (line 197) → CommodityProfilePage
  ↓ "← Desk" (line 202) → onClose
Decision Ledger (DecisionThreadModule.jsx) → P6 reasoning panel → decisionLink.open() → Explorer (works)
```

### Watchlist lifecycle
```
Watchlist row "Open" (Watchlist.jsx:695) → handleIntent → onAdd → AssetModal (App selectedAsset)
  → ResearchTab "Open Research Workspace" (ResearchTab.jsx:30) → onOpenResearch (AssetModal internal, stock route)
  → Commodity Research Workspace → Commodity Profile → ← Desk → back to watchlist (modal already closed)
```
⚠ The modal is dismissed on "Open Research" (history.pushState + popstate, AssetModal.jsx:88-89), so "back" returns to the pre-modal route, not a managed stack.

---

## 3. Navigation Matrix

| From → To | Route / Mechanism | Status |
|---|---|---|
| ⌘K → commodity asset | CommandPalette (command list only) | ❌ Not possible (no asset search) |
| Watchlist → add commodity | openWatchlistPrompt (App.jsx:2279) | ⚠ Paste/select only, no live symbol search |
| Watchlist row → modal | handleIntent→onAdd (Watchlist.jsx:695) | ✅ Works |
| Modal → Research | onOpenResearch internal (AssetModal.jsx:84) | ⚠ Hardcodes stock `/app/asset` route |
| Modal → Company Profile | onViewCompanyProfile prop | ✅ Correct for commodity route (App.jsx) |
| Desk → commodity research | setSelectedCommoditySymbol (AnalyticsModule.jsx:5472) | ❌ No drill-down button |
| Macro transmission → commodity | deepLink({type:"commodity"}) (TransmissionExplorer.jsx:112) | ❌ onNavigate=close; no navigation |
| Research → Profile | onOpenProfile (AssetResearchWorkspace.jsx:197) | ✅ Works |
| Profile → Research | onOpenResearch (CommodityProfilePage.jsx:62) | ✅ Works |
| Profile → Desk | onClose "← Desk" (CommodityProfilePage.jsx:63) | ✅ Works |
| Related asset → company | getRelated (relationshipGraph.js) | ✅ Works (XOM→CL etc.) |
| Decision → Explorer | decisionLink.open (DecisionEngine) | ✅ Works (verified) |

---

## 4. State Persistence Matrix

| State | Preserved | Lost | Notes / Evidence |
|---|---|---|---|
| Selected commodity group (desk) | Local `selectedCommodityGroup` (AnalyticsModule.jsx:948) | ❌ On leaving desk | Not hoisted to URL/routeState |
| Selected commodity symbol (desk) | Local `selectedCommoditySymbol` (line 947 set at 5472) | ❌ On leaving desk | Local state only |
| Commodity search query (desk) | `commoditySearchQuery` (line 956) | ❌ On leaving desk | Local |
| Watchlist category filter | `activeCategory` (Watchlist.jsx:2271) | ⚠ Persists in session, not URL | Reset logic at Watchlist.jsx:2270 |
| Modal search context | N/A (modal has no search) | — | Modal is launcher, not search |
| Active research tab | `activeTab` (AssetModal.jsx:113) | ❌ On open/reopen | Reset each open |
| Workspace scope | WorkspaceScope provider | ✅ Session | |
| Route (SPA) | routeState + history.pushState (App.jsx:2199) | ✅ Back button works | |
| Decision reasoning panel | `decision` memo (DecisionThreadModule.jsx:96) | ✅ Reactive to bus | Recomputes on regime change |

---

## 5. Information Hierarchy Review (Brand v2)

✅ Monochrome tokens used throughout (`styles.css` `decision-reasoning-*`, watchlist chips, desk panels).
⚠ Asset Modal for commodities pulls **stock-shaped data**: `earnings`, `finvizData` (AssetModal.jsx:112-117) are fetched for every asset; for commodities these are meaningless clutter (no earnings/finviz for CL/GC). The modal is stock-centric despite `researchOnly` flag.
⚠ Watchlist "Transmission" column is hardcoded `count={2}` (Watchlist.jsx:652) — not real per-asset transmission counts.
✅ Research Workspace uses progressive disclosure (tiers in assetRegistry.js:33-34).

---

## 6. Dead-End Report

| # | Dead end | Location | Severity |
|---|---|---|---|
| D1 | ⌘K palette cannot find commodity *assets* (commands only) | CommandPalette.jsx:24-47 | **High** |
| D2 | Commodities Desk has no "Open Research / Profile" from a selected commodity | AnalyticsModule.jsx:5472 (select only sets local state) | **High** |
| D3 | Transmission Explorer "Open Commodity Workspace" closes drawer but does not navigate | TransmissionExplorer.jsx:112 + TransmissionExplorerProvider.jsx:38 (onNavigate=close) | **High** |
| D4 | Asset Modal "Open Research Workspace" hardcodes stock route for commodities | AssetModal.jsx:84-91 | **High** |
| D5 | Watchlist has no live asset search (paste/import only) | Watchlist.jsx:940 (textarea), App.jsx:2279 | **Medium** |

---

## 7. Redundancy Report

| # | Redundancy | Location | Severity |
|---|---|---|---|
| R1 | Asset Modal defines its OWN `onOpenResearch` (stock route) while App passes a kind-correct prop (`openCommodityResearch`) that is never used | AssetModal.jsx:84 vs App.jsx:7156 | **High** (shadows registry) |
| R2 | `isStockResearchEligible = kind==="stock"` gating (AssetModal.jsx:81) — commodities never "research-eligible" in modal's own logic, contradicting registry `kindSupportsAction(commodity,"research")` (assetRegistry.js:71,107) | AssetModal.jsx:81 | **Medium** |
| R3 | Two profile renderers: `CommodityProfilePage.jsx` (retained, not App-mounted) + `CompanyProfilePage kind="commodity"` dispatch (App.jsx:2231) | CommodityProfilePage.jsx:1, App.jsx | **Low** (intentional P2.6 fold, documented) |

---

## 8. Friction Report (ranked)

| Rank | Friction | Clicks / Impact | Location |
|---|---|---|---|
| 1 | Commodity discovered only via desk/paste; no global asset search | High | CommandPalette.jsx, Watchlist.jsx |
| 2 | Desk select commodity → must exit desk to research it | High | AnalyticsModule.jsx:5472 |
| 3 | Modal "Research" sends commodity to stock workspace URL | High (wrong destination) | AssetModal.jsx:84 |
| 4 | Transmission "Open Commodity" does nothing but close | High | TransmissionExplorer.jsx:112 |
| 5 | Modal fetches earnings/finviz for commodities (irrelevant) | Medium | AssetModal.jsx:112-117 |
| 6 | Desk group/symbol/query state lost on navigation | Medium | AnalyticsModule.jsx:948-956 |
| 7 | Watchlist Transmission column shows fake `count={2}` | Medium | Watchlist.jsx:652 |

---

## 9. Improvement Recommendations (evidence → impact → recommendation)

No implementation code. Each pairs evidence with a direction.

1. **Asset discovery (⌘K)** — *Evidence:* CommandPalette.jsx:24-47 filters only `commands`, no asset source. *Impact:* commodities undiscoverable via primary launcher. *Recommendation:* add an asset-search source (symbol/name) that resolves via `buildAssetRoute` and routes by kind. *Complexity:* Low (palette already groups results).

2. **Desk drill-down** — *Evidence:* AnalyticsModule.jsx:5472 sets local symbol only. *Impact:* dead-end hub. *Recommendation:* add "Open Research / Profile" actions on the selected commodity row, wired to `openCommodityResearch`/`openCommodityProfile`. *Complexity:* Low.

3. **Modal research route** — *Evidence:* AssetModal.jsx:84-91 hardcodes `/app/asset/${symbol}`; App.jsx:7156 passes kind-correct `onOpenResearch` that the modal ignores. *Impact:* commodities routed to stock workspace. *Recommendation:* have the modal call the **prop** `onOpenResearch` (already kind-correct) instead of its internal handler; remove the hardcoded stock route. *Complexity:* Low.

4. **Transmission → commodity** — *Evidence:* TransmissionExplorer.jsx:112 `deepLink({type:"commodity",label})`; provider onNavigate=close (TransmissionExplorerProvider.jsx:38). *Impact:* button is a no-op for navigation. *Recommendation:* pass a real `onNavigate` that calls `buildAssetRoute("research","commodity",label)` and sets routeState. *Complexity:* Low–Med.

5. **Watchlist asset search** — *Evidence:* Watchlist.jsx:940 textarea only; App.jsx:2279 prompt has no autocomplete. *Impact:* adding a commodity requires knowing the symbol. *Recommendation:* add live symbol search with metadata (kind/exchange/source) before add. *Complexity:* Med.

6. **Modal commodity data** — *Evidence:* AssetModal.jsx:112-117 fetches earnings/finviz unconditionally. *Impact:* irrelevant clutter for CL/GC. *Recommendation:* gate earnings/finviz behind `kind==="stock"`. *Complexity:* Low.

7. **Desk state persistence** — *Evidence:* AnalyticsModule.jsx:948-956 local state. *Impact:* context lost on navigation. *Recommendation:* hoist selected group/symbol to URL query (`?group=&symbol=`). *Complexity:* Med.

8. **Honest transmission count** — *Evidence:* Watchlist.jsx:652 `count={2}` constant. *Impact:* misleading. *Recommendation:* feed real per-asset transmission count or remove the column. *Complexity:* Low.

---

## 10. Priority Roadmap

### P0 — Critical (broken journeys / dead ends / navigation inconsistencies)
- **D3** Transmission "Open Commodity Workspace" navigates nowhere (TransmissionExplorer.jsx:112).
- **D4** Asset Modal "Open Research Workspace" mis-routes commodities to stock URL (AssetModal.jsx:84).
- **D2** Commodities Desk has no drill-down to Research/Profile (AnalyticsModule.jsx:5472).

### P1 — High (discovery + cross-desk)
- **D1** ⌘K cannot surface commodity assets (CommandPalette.jsx:24).
- **D5 / Rec 5** Watchlist lacks live asset search (Watchlist.jsx:940, App.jsx:2279).
- **R1/R2** Modal shadows registry `onOpenResearch`; `isStockResearchEligible` contradicts `kindSupportsAction` (AssetModal.jsx:81,84).

### P2 — Medium (state + hierarchy + accessibility)
- **Rec 6/7** Modal fetches stock-only data for commodities; desk state not URL-persisted (AssetModal.jsx:112, AnalyticsModule.jsx:948).
- Deep-linking for desk group/symbol; keyboard nav from desk rows to research.

### P3 — Low (polish)
- **R3** Document the retained `CommodityProfilePage.jsx` vs merged dispatch (low risk, intentional).
- **Rec 8** Replace fake `Transmission` count column (Watchlist.jsx:652).

---

## Success-Criteria Answers
- *Discover commodities naturally?* ❌ Not via ⌘K or watchlist search (paste only).
- *Seamless movement between surfaces?* ⚠ Works for Research↔Profile↔Back; breaks at Desk→Research and Transmission→Commodity.
- *Context persists?* ⚠ Route persists; desk local state lost.
- *Dead ends?* ✅ 3 High-severity (D2/D3/D4).
- *Every path reversible?* ✅ Route-based back works; modal close returns to pre-modal.
- *Institutional research habits?* ⚠ Honest empty states good; discovery weak.
- *Scales to new asset classes?* ✅ Registry + `kindSupportsAction` + merged surfaces; only the modal's hardcoded route is an anti-pattern to fix.
- *Brand v2 adherence?* ✅ Monochrome, dense, progressive disclosure; minor stock-centric modal clutter.

**Bottom line:** fix P0 (3 broken navigations) and the modal route-shadow (R1) and commodity discovery becomes first-class without touching the registry/transmission/bus foundation that is already institutional-grade.
