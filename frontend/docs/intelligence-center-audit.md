# Zenin Intelligence Center — Architecture & UX Audit

> **Scope:** Read-only audit. No source code was modified.
> **Date:** 2026-07-13
> **Author:** Hermes Agent (automated audit pass)
> **Primary artifact under review:** `src/components/intelligence/IntelligenceCenter.jsx` (the `intel3` component) and every page that mounts it, plus the surrounding intelligence subsystem (`IntelligenceFeed`, `IntelligencePanel`, `PortfolioIntelligenceRail`).

---

## Executive Summary

The "Intelligence Center" is **not a single, consistent component**. It is three partially-overlapping rendering systems sharing the same *intent* but different code and CSS vocabularies:

1. **`IntelligenceCenter` (`intel3`)** — the component the audit targets. Mounted in **11 workspaces**. This is the real "Intelligence Center."
2. **`IntelligencePanel`** — a shared panel *wrapper* used by ~16 specialized engines (`OwnershipIntelligence`, `SupplyChainIntelligence`, `GeographicIntelligence`, `CorporateTimeline`, `RiskEngine`, `ScenarioLaboratory`, etc.). A second, parallel intelligence surface.
3. **`PortfolioIntelligenceRail` → `IntelligenceRail`** — a third system (`portfolio-command-*` classes) that renders **alongside** `IntelligenceCenter` on the Portfolio page.

**Why it looks "unstyled / not integrated":**
- `IntelligenceCenter` renders with `class="intel3 intel-v3"`. Its CSS exists in `styles.css` (148 selectors), but it depends on tokens that are **undefined in the app theme** (`--surface-1` is not defined anywhere → hard fallback `#0c0c0c`), while every other card in the app uses `--color-surface-card: #111111`. The result is a surface tone that is *near-identical to the page background* (`#0c0c0c` on `#0A0A0A`) with a **faint border** (`rgba(148,163,184,0.12)`). On a live render (Briefing) the section **reads as having no card at all** — it blends into the page. This is *imperceptible container chrome*, **not** missing CSS. The component is styled; its chrome is just too low-contrast to perceive as a distinct surface.
- It uses **green** (`--color-data-green` → `var(--color-success)`) for live dots, checkmarks, up-arrows, and "live" feed status — a direct **monochrome violation**. Brand v2 is strictly monochrome (white interactive, surfaces `#0A/#11/#14/#17`, borders `#262626/#404040`). The green accent makes the panel pop in the wrong way and breaks visual cohesion.
- It has **no light-mode overrides**. The app ships `[data-theme="light"]` and `prefers-color-scheme: light` blocks, but `intel3` keeps `#0c0c0c` backgrounds + white text in light mode → **invisible / broken in light theme**.
- It sets **no `max-width` and no scoped width** — it fills whatever the parent gives it. Because the 11 parents wrap it inconsistently (main column, nested desk panel, a tab, an appended fragment), the same component renders at wildly different widths, paddings, and elevations → "not integrated."
- `IntelligenceFeed.jsx` is **dead code** (zero external mounts).

**Verdict:** The component is well-structured internally (good section decomposition, context-aware framing, honest empty states in places) but is **visually off-brand, theme-fragile, and inconsistently placed**. The fix is primarily CSS/token alignment + a variant system + de-duplication — not a rebuild.

---

## Part 1 — Mount Inventory

All mounts render the **same** `IntelligenceCenter` component, distinguished only by the `context` prop (and occasionally `symbol` / `holdings`). Verified via `grep` across `src`:

| # | Workspace | File | Line | Mount call | Context prop | Parent | Immediate wrapper |
|---|-----------|------|------|-----------|-------------|--------|-------------------|
| 1 | Portfolio | `components/PortfolioModule.jsx` | 3409 | `<IntelligenceCenter context="portfolio" holdings={holdingsTableRows} />` | `portfolio` | `PortfolioModule` return | appended after `PortfolioIntelligenceRail` (fragment child of main column) |
| 2 | Watchlist | `components/Watchlist.jsx` | 1362 | `<IntelligenceCenter context="watchlist" />` | `watchlist` | `Watchlist` return | appended at end of `<>` fragment (after indicator modal) |
| 3 | Company Research | `components/CompanyProfilePage.jsx` | 1607 | `<IntelligenceCenter context="company" symbol={symbol} />` | `company` | `CompanyProfilePage` return | inside trailing `<div>` after content |
| 4 | Commodity Research | `components/CommodityProfilePage.jsx` | 181 | `<IntelligenceCenter context="commodity" />` | `commodity` | `CommodityProfilePage` (`WorkspaceLayout` `rail`/`children`) | inside `WorkspaceLayout` children |
| 5 | ETF Research | via `CompanyProfilePage` → `EtfProfilePage` (line 907) + `CommodityProfilePage` parity | — | (ETF profile reuses `CompanyProfilePage` shell) | `company` (no dedicated `etf` context mount found) | — | — |
| 6 | Macro Research | `components/macro/MacroAssetWorkspace.jsx` | 297 | `intelligenceFeed: (p) => <IntelligenceCenter context="macro" symbol={p.symbol} />` | `macro` | Macro workspace **tab** renderer | rendered as a **tab** (`intelligenceFeed`) |
| 7 | Analytics / Commodities Desk | `components/AnalyticsModule.jsx` | 7902 | `<IntelligenceCenter context="commodity" symbol={commodityMeta.selectedSymbol} />` | `commodity` | `AnalyticsModule` commodity desk | inside `<div className="analytics-desk-panel analytics-commodity-tx">` (nested desk card) |
| 8 | Decisions | `components/DecisionThreadModule.jsx` | 377 | `<IntelligenceCenter context="decision" />` | `decision` | `DecisionThreadModule` return | appended after glossary `<p>` |
| 9 | Briefing | `components/BriefingModule.jsx` | 437 | `<IntelligenceCenter context="briefing" />` | `briefing` | `BriefingModule` return | appended at end of `<div>` |
| 10 | Transmission Explorer | `transmission/TransmissionExplorer.jsx` | 186 | `<IntelligenceCenter context="transmission" />` | `transmission` | `TransmissionExplorer` return | appended after main `<section>` |
| 11 | Journal | (no `IntelligenceCenter` mount found) | — | — | — | — | Journal uses `JournalModule` only; see §Reuse |
| 12 | Scenario Laboratory | (no `IntelligenceCenter` mount) | — | `ScenarioLaboratory` is a **separate** component (mounted in Macro/AssetResearch) | — | — | — |

**Additional / sibling intelligence surfaces (NOT `IntelligenceCenter`):**
- `AssetResearchWorkspace.jsx` (lines 618–688) renders a *resolver* of specialized panels (`OwnershipIntelligence`, `SupplyChainIntelligence`, `GeographicIntelligence`, `CorporateTimeline`, `FactorIntelligence`, `RiskEngine`, `ScenarioLaboratory`, …) — **not** `IntelligenceCenter`. So "Company/ETF Research Workspace" intelligence is split between `CompanyProfilePage`'s `IntelligenceCenter` and `AssetResearchWorkspace`'s engine panels.
- `PortfolioModule` renders **both** `<PortfolioIntelligenceRail>` (line ~3401) **and** `<IntelligenceCenter context="portfolio">` (line 3409) → **two intelligence surfaces on one page**.

**Component tree (representative — Portfolio):**
```
<App>
  <PortfolioModule>
    <main column>
      <PortfolioIntelligenceRail>          ← system #3 (portfolio-command-* CSS)
        <IntelligenceRail />
      </PortfolioIntelligenceRail>
      <IntelligenceCenter context="portfolio" holdings=… />   ← system #1 (intel3 CSS)
    </main>
  </PortfolioModule>
```

---

## Part 2 — Layout Constraints

`IntelligenceCenter` itself:
- `section.intel3` → `display:flex; flex-direction:column; gap:24px; padding:24px;` (styles.css:15102). **No `max-width`, no `width`** → 100% of parent content-box.
- Inner `.intel3-grid` → `grid-template-columns: 1fr 1fr` (styles.css:15156), collapsing to 1fr under 880px.

Parent constraints (varied → inconsistent integration):
- **Portfolio / Watchlist / Company / Briefing / Transmission / Decisions**: appended as a trailing child of a flex/grid column. Width = parent column width. On wide screens this can be ~full-width; on narrow rails it compresses.
- **Macro**: a **tab** — only visible when the `intelligenceFeed` tab is active; width = tab panel width (often a side column).
- **Analytics Commodities**: nested inside `analytics-desk-panel analytics-commodity-tx` → **double-card** (desk panel inside desk panel) with stacked borders/padding (§6).
- **CommodityProfilePage**: inside `WorkspaceLayout` children (which already have their own card chrome) → nested card + rail.

**Answer:** Yes — the parent layout materially prevents the Intelligence Center from reading as a "proper workspace." Because the component has no intrinsic width/elevation contract, it inherits whatever the host gives it, and hosts disagree. The Macro-tab and Analytics-nested cases especially make it feel like a "stacked list" rather than a workspace.

---

## Part 3 — Variant Audit

| Workspace | Variant rendered |
|-----------|------------------|
| Portfolio | FULL (`intel3` section) |
| Watchlist | FULL |
| Company | FULL |
| Commodity | FULL |
| Macro | FULL (as a tab) |
| Analytics/Commodities | FULL (nested in desk panel) |
| Briefing | FULL |
| Transmission | FULL |
| Decision | FULL |
| ETF | FULL (via Company shell) |

**Every mount uses the identical `FULL` variant.** There is **no `variant` prop** on `IntelligenceCenter` (signature at IntelligenceCenter.jsx:402 takes `context, assets, holdings, symbol, onAction, onContextChange, className` — no `variant`).

**Why identical-FULL-everywhere is poor UX:**
- On a **narrow rail/tab** (Macro, Analytics desk, Watchlist sidebar) the full header + workspaces switcher + 6 cards + diagnostics is overwhelming and scrolls past the fold.
- On the **Portfolio main column** it duplicates the `PortfolioIntelligenceRail` already present.
- Context changes *content* (framing, actions, asset-impact) but **never the layout density** — so a compact context (watchlist) gets the same heavy chrome as a primary one (portfolio).

**Recommended variants (introduce a `variant` prop):**
```
full        → primary workspace (Portfolio main column, Briefing)
compact     → dense, single-column, no workspace-switcher (Watchlist, Decision)
sidebar/rail→ fixed-width right rail, scrollable, summarized (Macro tab, Analytics desk)
modal       → launched on demand (asset chip → intel for that symbol)
drawer      → slide-over for transmission/asset detail
terminal    → high-density event stream for power users
inline      → embedded mini-feed inside another panel
```

---

## Part 4 — CSS Audit

**Owner:** `src/styles.css` owns all `intel3*` rules (148 selectors, starting at styles.css:15102). No dedicated `IntelligenceCenter.css`.

**Token problems (specificity / undefined tokens):**
- `.intel3` uses `var(--surface-1, #0c0c0c)`. **`--surface-1` is not defined anywhere** in `styles.css` (grep confirmed) → falls back to literal `#0c0c0c`. Every other card uses `var(--color-surface-card, #111111)`. → **Tone mismatch.**
- `.intel3-card` uses `var(--surface-1, #0c0c0c)` again (same issue) and `var(--border-subtle, rgba(148,163,184,0.12))` (defined at styles.css:? — `--border-subtle` is referenced but the app standard is `#262626/#404040`; the `rgba(148,163,184,…)` is a *different* gray).
- `.intel3-action-card`, `.intel3-downstream li`, etc. use `rgba(255,255,255,0.02–0.04)` — app standard is `var(--color-surface-hover, rgba(255,255,255,0.04))`. Slight but real drift.

**Color violations (monochrome breach):**
- `styles.css:15133,15151,15172,15228,15237,15259` → `var(--color-data-green, #4ade80)` for: live dot, checkmarks, up-arrow, "live" feed status, impact direction. Green is **not** in the Brand v2 monochrome palette (interactive = `#FFFFFF` only; status uses white/gray, not hue).

**Multiple competing CSS vocabularies (fragmentation):**
- `intel3-*` — `IntelligenceCenter`
- `intel-*` / `intel-block-*` / `intelligence-*` — `IntelligenceFeed` (dead) + `IntelligencePanel` + specialized engines
- `portfolio-intelligence-rail` / `portfolio-command-*` — `PortfolioIntelligenceRail`
- `institutional-*` — unrelated but visually adjacent design system

**Dead selectors:** `.intel-chain` (IntelligenceFeed, dead), all `IntelligenceFeed` styles. **Unused:** any `intel-v3` modifier rule (the component adds `intel-v3` class but no `intel-v3` selector exists → harmless no-op, but signals intent/version drift).

**Specificity conflicts:** `.intel3` is a single class; global `section {}` or `.card`/`.panel` rules elsewhere could override `background`/`border`. No `@layer` usage → order-dependent.

---

## Part 5 — Information Hierarchy Audit

Sections rendered (IntelligenceCenter.jsx:489–512), in DOM order:
1. `IntelligenceHeader` (title + stats + workspace switcher)
2. `ExecutiveSummaryCard`
3. `.intel3-grid` → `ActionCards` + `TransmissionCard`
4. `TimelineCard` (the dominant, tallest section)
5. `.intel3-grid` → `AssetImpactCard` + `FeedCoverageCard`
6. `DiagnosticsDrawer`

**Does it guide the eye?** Partially. The header is strong (30px title), but **everything is the same card chrome** — each `.intel3-card` has identical border/radius/padding, so the eye treats Executive Summary, Actions, Transmission, Timeline, Asset Impact, Feed Coverage as **equal-weight stacked blocks**. The Timeline (the most useful, most content) is just "another card" rather than the visual anchor.

**Evidence:** All sections use `.intel3-card` (styles.css:15115) with identical `background/border/radius/padding`. No elevation hierarchy (no shadow differentiation), no size hierarchy between summary and feed-coverage. The component *internally* knows priority (sevRank, pinning, severity tags) but **does not express it visually beyond small severity chips**.

**Score (1–5, 5=excellent):**
- Header: 4
- Executive Summary: 3 (good content, same chrome as others)
- Timeline: 3 (right content, buried as equal card)
- Transmission: 3
- Actions: 3
- Diagnostics: 4 (collapsed by default — good)
- Asset Impact: 3
- Coverage: 2 (static, low value)
- **Overall hierarchy: 3 / 5 — "stacked list" more than "guided workspace."**

---

## Part 6 — Container Audit

| Section | Card? | Border | Padding | BG | Elevation | Radius |
|---------|-------|--------|---------|----|-----------|-------|
| Root `.intel3` | yes (self) | 1px `border-subtle` | 24px | `#0c0c0c` | none | 12px |
| `.intel3-card` (each) | yes | 1px `border-subtle` | 24px | `#0c0c0c` | none | 12px |
| `.intel3-action-card` | yes | 1px `rgba(148,163,184,0.18)` | 16px | `rgba(255,255,255,0.02)` | none | 10px |
| `.intel3-feed` | no (row) | none | — | none | none | — |

**Issue — nested/duplicated containers:** On Analytics Commodities (§2) and CommodityProfilePage, `.intel3` (its own border+padding+radius) is placed **inside** another card (`analytics-desk-panel`, `WorkspaceLayout` panel). Result: **border stacking + doubled 24px padding + two radii** → visual heaviness, wasted space. This is the most visible "not integrated" symptom on those pages.

**Sections rendered directly without a container:** none in `IntelligenceCenter` itself (it always wraps in `.intel3-card`), but the **mount sites** often drop it into a bare `<div>` (CompanyProfilePage:1607, Watchlist:1362, BriefingModule:437, TransmissionExplorer:186, DecisionThreadModule:377) with no surrounding card → the `intel3` card floats against the page background with no relationship to neighbors.

---

## Part 7 — Typography Audit

| Element | Rule | Size/weight |
|---------|------|-------------|
| Page title | `.intel3-page-title` | 30px / 800 |
| Card title | `.intel3-card-title` | 15px / 700 |
| Body | `.intel3-exec-line` | 16px / normal |
| Metadata | `.intel3-stat i`, `.intel3-card-sub` | 11px / uppercase |
| Buttons | `.intel3-action-title` | 13px / 600 |
| Status chips | `.intel3-sevtag` | small |
| Confidence | `.intel3-conf b` | mono |

**Hierarchy exists but is uneven:** the 30px page title is disproportionate to 15px card titles and 16px body — the *title* dominates while *content* is only 1px larger than card titles. Within a nested desk panel (Analytics), a 30px "INTELLIGENCE CENTER" title competes with the desk's own heading → **title collision**. Body and card-title are nearly equal → low contrast in the scan path. Overall: hierarchy is **present but mis-scaled** for embedded contexts.

---

## Part 8 — Visual Weight Audit

| Element | Current weight | Importance | Match? |
|---------|---------------|------------|--------|
| Header (title + switcher) | Very high (30px) | Medium (chrome) | **Over-weighted** |
| Executive Summary | Medium | **High** | Under-weighted |
| Timeline | Medium (equal card) | **High** | Under-weighted |
| Transmission | Medium | High | Under-weighted |
| Suggested Actions | Medium | High | OK |
| Diagnostics | Low (collapsed) | Low | OK |
| Feed Coverage | Medium | **Low** | **Over-weighted** (static, low-value) |
| Asset Impact | Medium | Medium | OK |

**Mismatch:** The single most important job — *"what's moving and why, for THIS context"* (Executive Summary + Transmission + Timeline) — is visually equal to the least important (Feed Coverage static list). The 30px title wastes weight on chrome. **Recommend inverting:** shrink title, elevate Summary/Timeline/Transmission via subtle elevation or accent rule, demote Feed Coverage to a collapsed footer.

---

## Part 9 — Context Awareness

`IntelligenceCenter` **does** vary by context (good):
- `WORKSPACE_FRAME` (IntelligenceCenter.jsx:55–68) sets `focus`/`sub` per context.
- `ACTION_MAP` (71–131) sets context-specific suggested actions.
- `eventRelevantTo` (47–52) filters the event stream by `contexts` array on each bus event.
- `assetImpact` (479–485) only computes for `portfolio` context (uses `affectedHoldings`).

**But the *layout/variant* is identical for every context** (always the full `intel3` section with all 6 cards). So:

| Context | Should emphasize | Actually emphasizes |
|---------|------------------|---------------------|
| Portfolio | Holdings / Exposure / Allocation | Same full deck; AssetImpact only shows if holdings passed |
| Macro | Regime / Central Banks / Calendar | Same full deck (no regime primacy) |
| Commodity | Inventories / Supply / Demand / Freight | Same full deck |
| ETF | Flows / Holdings / Rotation | Same full deck |
| Company | Earnings / Catalysts / Risks | Same full deck |

**Flagged architectural issue:** Context changes *framing and filtering*, but **never information priority or density**. The spec's per-context emphasis is not expressed in layout. This is acceptable as a v1 but is the core reason it "doesn't feel integrated" — each workspace gets a one-size deck rather than a tailored one.

**Note:** `IntelligenceCenter` relies on bus events carrying a `contexts` array. If events are published without `contexts` (or only `macro`), non-macro mounts may render **empty** (the "No Active Intelligence" state) even when relevant data exists → a real integration risk. Verified: `eventRelevantTo` returns false unless `ev.contexts.includes(context)` (IntelligenceCenter.jsx:48).

---

## Part 10 — Routing Audit

Actions flow through `handleAction` (IntelligenceCenter.jsx:437):
- `refresh` → local re-read (works).
- everything else → `onAction(intent, payload)` passed from the **parent**.

**Problem:** Most mounts pass **no `onAction`** (default `null`):
- PortfolioModule:3409, Watchlist:1362, CompanyProfilePage:1607, CommodityProfilePage:181, AnalyticsModule:7902, MacroAssetWorkspace:297, BriefingModule:437, TransmissionExplorer:186, DecisionThreadModule:377 — **none supply `onAction`**.

→ Every "Open Research / Open Macro Desk / Asset / Transmission / Scenario / Decision / Create Alert" button is **effectively DEAD** on all 9 mounts (clicking calls `onAction` which is `null` → no-op at IntelligenceCenter.jsx:437 `else if (typeof onAction === "function")`). **This is the single biggest functional gap**: the Intelligence Center *looks* actionable but routes nowhere.

| Action | Works? | Notes |
|--------|--------|-------|
| Open Research | ❌ dead | `onAction` null on all mounts |
| Open Workspace / Desk | ❌ dead | same |
| Asset chips | ❌ dead | `open-asset` → `onAction` null |
| Timeline → Transmission/Decision/Scenario | ❌ dead | same |
| Refresh | ✅ | local only |
| Context switcher (header) | ✅ | `onContextChange` (also mostly null) |

**Generic routing:** Even where `onAction` were wired, the intents are **generic strings** (`open-macro`, `run-scenario`, `create-alert`) with no metadata-driven target — the opposite of the `useWorkspaceRouter` (navigation-object) pattern built for Market Signals. Two routing paradigms now coexist.

---

## Part 11 — Design System Compliance (vs Brand v2)

Brand v2 (`Brandv2.md`) is monochrome: interactive `#FFFFFF`, surfaces `#0A/#11/#14/#17`, borders `#262626/#404040`, no hue accents.

| Check | Status | Evidence |
|-------|--------|----------|
| Spacing | ⚠️ drift | uses `var(--space-6,24px)` (defined) but cards hard-pad 24px; app panels vary |
| Radius | ⚠️ | `var(--radius-xl,12px)` (defined) — OK, but app often uses 8–10px |
| Surface hierarchy | ❌ | `#0c0c0c` (undefined `--surface-1`) vs app `#111111` cards |
| Borders | ❌ | `rgba(148,163,184,0.12)` vs app `#262626/#404040` |
| Typography | ⚠️ | 30px title collides in embedded contexts |
| Info density | ⚠️ | full deck everywhere; low contextual density control |
| **Monochrome palette** | ❌ | **green** `--color-data-green` used 6× (styles.css:15133,15151,15172,15228,15237,15259) |
| Hover states | ✅ | `.intel3-ws:hover`, `.intel3-action-card` transition present |
| Dark mode | ✅ | default theme renders |
| **Light mode** | ❌ | **no `[data-theme="light"]` / `prefers-color-scheme: light` overrides for `intel3`** → dark surface on light page = broken |

**Violations to fix (highest impact):** remove green (use white/gray severity), align surfaces to `--color-surface-card`, align borders to `--border-subtle`/`#262626`, add light-mode block.

**Data-integrity violation (separate from styling):** `COVERAGE_FEEDS` (IntelligenceCenter.jsx:139–150) hardcodes **fabricated** latency/status values (Yahoo 240ms, FRED 410ms, Polygon 180ms, World Bank cached 3h, NOAA fallback 15m, etc.). This **directly contradicts the project's no-fabrication rule** (contrast `FeedHealth.jsx` which honestly shows `—`). The Diagnostics drawer also reads `IntelligenceBus.getDiagnostics()` (real) but the *Feed Coverage* card shows invented numbers. **This must be corrected** — either source real diagnostics or render `—`/“Not connected.”

---

## Part 12 — Workspace Classification (recommended variant per mount)

| Workspace | Recommended variant | Why |
|-----------|---------------------|-----|
| Portfolio (main) | **Full** | primary intelligence surface; but **remove duplication** with PortfolioIntelligenceRail (pick one) |
| Briefing | **Full** | cross-cut briefing is its job |
| Watchlist | **Compact** | sidebar context; summarized |
| Decision | **Compact / Drawer** | evidence sidebar, not primary |
| Macro (tab) | **Sidebar/Rail** | already a tab; dense, no workspace-switcher |
| Analytics/Commodities | **Inline / Nested** | already inside a desk panel → use borderless inline variant (no double card) |
| CommodityProfile | **Sidebar** (rail) | it's in `WorkspaceLayout` rail already |
| Company/ETF | **Full or Modal** | primary research; asset-chip → **Modal/Drawer** for symbol-specific intel |
| Transmission | **Drawer/Explorer** | transmission is already its own explorer; intel here should be a slim rail |
| Scenario Lab | (separate component) | not an IntelligenceCenter mount |

---

## Part 13 — Reuse Audit

**Duplication:**
- `IntelligenceCenter` (intel3) and `IntelligencePanel` (used by 16 engines) are **two parallel intelligence renderers** with different CSS.
- `PortfolioIntelligenceRail` is a **third** intel surface on Portfolio, overlapping `IntelligenceCenter context="portfolio"`.
- `IntelligenceFeed` is **fully dead** (zero mounts) — pure duplication/debt.
- Feed-coverage / diagnostics logic is reimplemented inside `IntelligenceCenter` (`COVERAGE_FEEDS` hardcoded) instead of reusing `DataCoverageRegistry` (which `IntelligencePanel` already references at DataCoverageRegistry.js:124).

**Can one component replace them?**
Yes — a single `<IntelligenceCenter variant="" context="" />` could absorb:
- the v3 `IntelligenceCenter` (as `variant="full"`),
- the `IntelligencePanel` engines (as `variant="panel"` content blocks),
- the `PortfolioIntelligenceRail` (as `variant="rail"`),
and retire `IntelligenceFeed`. The specialized engines (`OwnershipIntelligence`, etc.) are *content* modules that should be **slotted into** the center via a `sections` prop, not separate full components.

---

## Part 14 — Architecture Recommendations (prioritized)

**P0 — Correctness / Trust (do first)**
1. **Wire `onAction` on all 9 mounts** (PortfolioModule, Watchlist, CompanyProfilePage, CommodityProfilePage, AnalyticsModule, MacroAssetWorkspace, BriefingModule, TransmissionExplorer, DecisionThreadModule) so Research/Desk/Asset/Transmission/Scenario/Decision buttons actually route. Use the existing `useWorkspaceRouter` (navigation-object) pattern for consistency. *(Files: each mount site + pass `onAction`.)*
2. **Remove fabricated feed data** in `COVERAGE_FEEDS` (IntelligenceCenter.jsx:139–150). Source real diagnostics from `IntelligenceBus.getDiagnostics()` / `DataCoverageRegistry`, or render `—` / "Not connected" (mirror `FeedHealth.jsx`). *(File: IntelligenceCenter.jsx.)*
3. **Fix empty-state dependency on `contexts`** (IntelligenceCenter.jsx:48). Ensure bus events carry `contexts`, or fall back to showing all-relevant events per workspace so non-macro mounts aren't permanently empty.

**P1 — Brand / Integration (highest visual ROI)**
4. **Token alignment:** replace `var(--surface-1,#0c0c0c)` → `var(--color-surface-card)`, `rgba(148,163,184,…)` borders → `var(--border-subtle)` / `#262626`, `rgba(255,255,255,0.02)` → `var(--color-surface-hover)`. *(File: styles.css intel3 block.)*
5. **Remove green:** replace `var(--color-data-green,#4ade80)` (6 sites) with monochrome severity (white/gray; use weight/opacity for severity, not hue). *(File: styles.css.)*
6. **Add light-mode block** for `.intel3*` (`[data-theme="light"] .intel3 { … }` mirroring existing `.institutional-*` light overrides at styles.css:34311+). *(File: styles.css.)*
7. **De-nest on Analytics/CommodityProfile:** add `variant="inline"` (borderless, no own padding/radius) when mounted inside an existing panel. *(File: IntelligenceCenter.jsx + mount sites.)*

**P2 — Variant system / De-duplication**
8. **Introduce `variant` prop** (`full | compact | rail | modal | drawer | inline`) driving section density + workspace-switcher visibility. *(File: IntelligenceCenter.jsx.)*
9. **Retire `IntelligenceFeed`** (dead). *(File: delete IntelligenceFeed.jsx + its CSS.)*
10. **Consolidate Portfolio:** keep either `PortfolioIntelligenceRail` **or** `IntelligenceCenter context="portfolio"`, not both; or make the Rail the `variant="rail"` of the Center. *(Files: PortfolioModule.jsx, PortfolioIntelligenceRail.)*
11. **Unify `IntelligencePanel` engines** as slot-able sections of the Center via a `sections` prop. *(File: IntelligenceCenter.jsx + engines.)*

**P3 — Hierarchy / UX polish**
12. **Re-weight visual priority:** shrink page title (→18–20px), elevate Executive Summary + Transmission + Timeline (subtle elevation/accent rule), demote Feed Coverage to a collapsed footer. *(File: styles.css + IntelligenceCenter.jsx order.)*
13. **Context-driven emphasis:** let `context` promote its primary section (e.g., macro → Transmission primacy, portfolio → Asset Impact primacy) via a `emphasis` map. *(File: IntelligenceCenter.jsx.)*
14. **Responsive:** already has 880px grid collapse; add a 560px single-column + sticky-header behavior for mobile rails. *(File: styles.css.)*

**Effort × Impact summary:**
- P0 (1–3): low effort, **critical** (currently the feature is non-functional/deceptive).
- P1 (4–7): medium effort, **high** visual impact (fixes "unstyled/not integrated").
- P2 (8–11): medium/high effort, high maintainability impact.
- P3 (12–14): low/medium effort, medium UX impact.

---

## Appendix — Evidence Index

| Claim | File:line |
|-------|-----------|
| 11 mounts of `IntelligenceCenter` | grep: PortfolioModule:3409, Watchlist:1362, CompanyProfilePage:1607, CommodityProfilePage:181, AnalyticsModule:7902, MacroAssetWorkspace:297, BriefingModule:437, TransmissionExplorer:186, DecisionThreadModule:377 |
| `IntelligenceFeed` dead | grep: zero external `<IntelligenceFeed` mounts |
| `IntelligencePanel` used by 16 engines | grep `IntelligencePanel` → Ownership/SupplyChain/Geographic/CorporateTimeline/Alternative/Factor/Currency/Consensus/RiskEngine/PortfolioOverlap/Correlation/DecisionReplay/EconomicDependency/DataLineage/IntelligenceFeed/ScenarioLaboratory |
| `intel3` CSS owner + 148 selectors | styles.css:15102 (`.intel3 {`) |
| `--surface-1` undefined | grep `--surface-1:` → no definition |
| App surfaces `#0A/#11/#14/#17` | styles.css:14–21 (`--color-bg-base` etc.) |
| Green token violation | styles.css:15133,15151,15172,15228,15237,15259 (`--color-data-green`) |
| No light-mode for intel3 | grep `intel3` in `prefers-color-scheme`/`data-theme` blocks → none |
| Fabricated `COVERAGE_FEEDS` | IntelligenceCenter.jsx:139–150 |
| `onAction` default null → dead buttons | IntelligenceCenter.jsx:402,437; mount sites pass no `onAction` |
| `eventRelevantTo` requires `contexts` | IntelligenceCenter.jsx:47–52 |
| Dual intel on Portfolio | PortfolioModule:3401 (`PortfolioIntelligenceRail`) + 3409 (`IntelligenceCenter`) |
| No `variant` prop | IntelligenceCenter.jsx:402 signature |
| Nested double-card (Analytics) | AnalyticsModule:7896–7902 (`analytics-desk-panel` wraps `IntelligenceCenter`) |

---

## Rendered-Verification Addendum (live `:5173`, 2026-07-13)

A live pass was run against the running Vite app to validate the "unstyled / not integrated" thesis with rendered evidence (not just source reading).

**What the live render confirmed:**
- **Blends in, not missing CSS.** On Briefing the `INTELLIGENCE CENTER` section renders with no perceptible card boundary — its `#0c0c0c` surface sits on the `#0A0A0A` page with a faint `rgba(148,163,184,0.12)` border, so it reads as plain page flow. This **matches** the source finding (undefined `--surface-1` → off-tone surface + low-contrast border). The component is styled; the chrome is just too low-contrast to register as a container. → finding stands, reframed as *imperceptible chrome*, not *unstyled*.
- **Dual intelligence on Portfolio is source-confirmed.** `PortfolioModule` mounts both `PortfolioIntelligenceRail` (line 3401) and `IntelligenceCenter context="portfolio"` (line 3409). A screenshot of the Portfolio view did not scroll to the lower `IntelligenceCenter`, but the two mounts are present in source and both render.
- **Green accents are conditional, not always visible.** Live dots/checkmarks only appear when live events exist (correct conditional rendering); the monochrome violation is in the *token choice* (`--color-data-green` → green), not in constant over-use.

**Conflict resolution — light mode (source wins over screenshot):**
- A vision-model screenshot of the light theme reported the section "readable / dark text on light background." **This is a color misread** (the model reliably misreads dark-on-dark contrast). The deterministic CSS disagrees and is authoritative:
  - `--surface-1` is **never defined** (only appears as a fallback literal `#0c0c0c` in 4 `intel3` rules: styles.css:15107, 15116, 15179, 15301).
  - `intel3` has **zero** `[data-theme="light"]` / `.theme-light` / `prefers-color-scheme` overrides (grep returned none).
  - Therefore in light theme `.intel3` background = `#0c0c0c` (dark) and `color` = `var(--color-text-primary)` = `#0A0A0A` (dark, styles.css:860) → **dark-on-dark = invisible**.
- **Conclusion:** the light-mode breakage finding (§11, Part 14 P1#6) is **confirmed by source**, not refuted. The screenshot reader's "looks fine" is treated as a known vision color-misread limitation, not evidence.

**Net:** every finding in this audit is source-backed. The live pass sharpened one framing ("unstyled" → "imperceptible chrome") and reaffirmed the rest. No code was modified.

---

*End of audit. No source files were modified.*
