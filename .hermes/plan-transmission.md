# Plan — Transmission Intelligence Platform (Phases 1–3)

> Grounded recon done. Build reuses existing signal derivation (`utils/deskIntelligence.js`),
> the `RightRailDrawer` primitive (`CompactWorkspaceUI.jsx:154`), and `DataQualityIndicator`
> (`deskV2IA.jsx:58`). Engine **ingests/normalizes existing published signals** — never
> duplicates derivation. Brand v2 monochrome; no standalone page; reusable drawer.

## Ground truth (verified this session)
- **Existing signal sources (do NOT re-derive):**
  - `deriveMacroExecutive` (deskIntelligence.js:42) → `{regime, tone, confidence, tilt, risk, drivers[], explain, sourceCount, freshness}`.
  - `deriveCommoditiesExecutive` (deskIntelligence.js:113) → `{theme, states[], tilt, confidence, sourceCount, freshness}`.
  - `computeConfidence` (deskIntelligence.js:152), `freshnessFrom` (deskIntelligence.js:20).
  - `buildMarketSignal` (deskIntelligence.js:177), `buildCommodityAllocation` (deskIntelligence.js:314).
  - Macro signal tiles via `buildMacroSignalTiles` (deskV2IA.jsx:74); commodity via `buildCommoditySignalTiles`.
  - `DataQualityIndicator({source, updatedAt, confidence, coverage})` (deskV2IA.jsx:58) — **reuse for evidence**.
- **Drawer primitive:** `RightRailDrawer` (CompactWorkspaceUI.jsx:154) — right-side, overlay, Escape/close, `title`/`subtitle`/`actions`/`children`. **Reuse for Explorer.**
- **Static card to replace:** `CrossDeskChain` (deskV2Modules.jsx:161) consumed only at AnalyticsModule.jsx:6875 (macro desk).
- **Workspaces (opening points):** Portfolio (`portfolioIntelligence/PortfolioAnalysis.jsx`), Research Workspace (`InstitutionalPanels.jsx` / `AssetResearchWorkspace.jsx`), Company Profile (`CompanyProfilePage.jsx`), Commodity (`CommodityProfilePage.jsx`), Watchlist, Briefings, Notifications, Decision Ledger, Analytics.

## PART 1 — Transmission Engine (shared service, `frontend/src/transmission/`)
Single source of transmission logic. Memoized graph; consumers subscribe; no per-component recompute.

1. **`TransmissionRegistry.js`** — canonical publisher taxonomy (Macro 12, Commodities 10, Equities 7, Portfolio 7, Research 5, Company 5) from the task; node types (asset/sector/country/commodity/company/portfolio); horizon enum (Immediate/Short-Term/Medium-Term/Structural) with windows. Single source of publisher + horizon metadata.
2. **`TransmissionGraph.js`** — in-memory directed graph. Edges: `{source, dest, direction, strength(0-1), confidence(0-100), evidence, lag, horizon, providers[], lastUpdated}`. Seed edges from the task's examples (Oil→Inflation→Rates→Tech→Portfolio; Copper→Manufacturing→Industrials→Mining→Australia→AUD). `getChain(fromNode)`, `getAffected(node, dimension)`, `memoize`.
3. **`TransmissionRuleEngine.js`** — ingests normalized signals (macroExecutive/commoditiesExecutive/drivers) → activates relevant edges, computes `affectedAssets/Sectors/Countries/Commodities/Companies/Portfolios`, assigns horizon + confidence from signal strength. Pure functions only.
4. **`TransmissionConfidence.js`** — confidence math (already have `computeConfidence`; this wraps + propagates along chain, decays per hop, never >95, never hides uncertainty).
5. **`TransmissionEvidence.js`** — builds evidence block per edge: provider(s), method, confidence, freshness, coverage. Reuses `DataQualityIndicator` props shape.
6. **`TransmissionFormatter.js`** — horizon labels, chain→indented hierarchy, confidence chips, "No verified transmission available." strings.
7. **`TransmissionCache.js`** — module-level memo map keyed by signal signature; `getTransmission(signals)` returns computed graph + chains; invalidates on signature change. Single computation.
8. **`TransmissionEvents.js`** — tiny pub/sub (`subscribe/emit`) so workspaces publish signals and subscribe to transmission without prop-drilling; decoupled from React.

Plus **`TransmissionEngine.js`** — facade: `publishSignals(workspace, signals)`, `getActiveChain(rootNode)`, `getAffected(node, dim)`, `getConfidence`, `getEvidence`, `openExplorer(node)` (delegates to Explorer context). Single import surface.

## PART 2 — Transmission Explorer (reusable drawer, `frontend/src/transmission/TransmissionExplorer.jsx`)
- One `RightRailDrawer` instance, mounted once at app root via a `TransmissionExplorerProvider` + `useTransmissionExplorer().open(node)`. Every workspace calls `open(node)` — never duplicated, never navigates.
- Layout: Active Chain (indented hierarchy, chevron disclosure, clickable nodes → drill to Research/Company/Portfolio/Macro), Confidence %, Horizons timeline (Immediate→Structural, expandable), Affected Holdings/Companies/Commodities/Countries/ETFs, Evidence (provider/method/confidence/freshness), Related Research (deep links), Decision Context (Journal/Predictions/Briefings).
- Closes without losing page context (RightRailDrawer behavior).

## PART 3 — Contextual Transmission Surfaces (compact cards, monochrome, no full chain)
Replace `CrossDeskChain` with `ActiveTransmission` (compact chain + confidence + "Open Explorer →") on Macro desk. Add cards to Portfolio (`Portfolio Transmission`), Commodity Workspace right rail (`Transmission Context`), Company Profile (`Macro Dependencies`), Research Workspace sidebar (`Transmission Context`), Watchlist rows (`Transmission N Active` + hover), Briefings (`Top Transmission Today`), Notifications (`X holdings` → Explorer), Decision Ledger (`Transmission Snapshot` stored). Each uses `TransmissionEngine` + `DataQualityIndicator`; all open the same Explorer.

## Horizons (metadata on every edge)
`horizon` enum on each edge; displayed as timeline in Explorer + compact "Immediate / Next: 2–6 weeks" on cards. No standalone horizon page.

## Data Integrity / Brand v2
- "No verified transmission available." when unsupported.
- Every relationship exposes provider + evidence + confidence + freshness + coverage (via `DataQualityIndicator`/Evidence).
- Monochrome tokens; reuse RightRailDrawer / MetricStrip / Badges / existing cards. No new design language.

## Acceptance mapping
Shared service ✓ · every desk publishes normalized signals (via Registry + Events) ✓ · every workspace consumes (Engine) ✓ · one reusable drawer ✓ · opening points wired ✓ · compact contextual cards ✓ · horizons integrated + timeline ✓ · no standalone page ✓ · confidence/evidence/provider/coverage/freshness visible ✓ · no duplicated logic (Engine single source) ✓ · Brand v2 ✓.

## Verification
- `npm run build:spa` green.
- Ad-hoc Node harness: `TransmissionRuleEngine` chain + confidence decay + "no transmission" path; `TransmissionGraph` getAffected.
- Browser at :5173: open Macro → Active Transmission card → Explorer drawer; switch country; open Portfolio/Company/Commodity Explorers; check ~800px & ~470px (note: 470px needs viewport tool — will report if blocked).

## Out of scope
- New backend transmission endpoints (engine is client-side over existing normalized signals).
- New providers (no CFTC etc.).
- New page/route for transmission.

## Files touched
- NEW: `frontend/src/transmission/{TransmissionEngine,TransmissionRegistry,TransmissionGraph,TransmissionRuleEngine,TransmissionConfidence,TransmissionEvidence,TransmissionFormatter,TransmissionCache,TransmissionEvents}.js` + `TransmissionExplorer.jsx` + `TransmissionExplorerProvider.jsx`.
- EDIT: `deskV2Modules.jsx` (replace CrossDeskChain), `AnalyticsModule.jsx` (macro card + mount provider), `PortfolioAnalysis.jsx`, `CompanyProfilePage.jsx`, `CommodityProfilePage.jsx`, `InstitutionalPanels.jsx`/`AssetResearchWorkspace.jsx`, Watchlist, Briefings, Notifications, Decision Ledger, `App.jsx` (mount Explorer provider once).
- EDIT: `styles.css` (compact transmission card + drawer sections — monochrome tokens only).
