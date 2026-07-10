# Zenin — Comprehensive UX & Responsive Design Audit

**Prepared for:** Pre-release product review, institutional-grade fintech workspace
**Method:** Source-grounded review of `frontend/src` (App.jsx, layout components, 10 feature modules, theme.css) plus (a) the prior quantitative width-audit (`scripts/audit-out/audit-v2.json`, `widths.json`) and 79 rendered screenshots at 1366/1600/1920/2560/3440px, and (b) **live CDP re-measurement this session** (Chrome on :9222 vs dev server :5173) at 1366/1920/2560/3440px and a **91-measurement mobile/tablet pass** at 320/375/768/1024/1280/1440/1720px across all 13 sections.
**Authority referenced:** `Brandv2.md` (single source of truth for the design system).

> Every recommendation below is grounded in code or measured render data. Where a prior-audit number was contradicted by live re-measurement, the live number wins and the stale claim is explicitly retracted.

---

## Executive Summary

| Dimension | Score | One-line basis |
|---|---|---|
| **Overall UX** | **7.5 / 10** | Logical IA + excellent command palette; fluid desktop width satisfies Brand v2; mobile/tablet now verified overflow-free to 320px. |
| **Visual Design** | **6.0 / 10** | Coherent monochrome token system undermined by 118 hardcoded cyan references in `theme.css` and 186 in `AnalyticsModule` (Brand v2: "No cyan"). |
| **Responsiveness** | **8.5 / 10** | Fluid 1280–3440px verified (99% fill); mobile/tablet now **verified overflow-free to 320px** (91 measurements); only the analytics-tab scroll cue needs polish. |
| **Accessibility** | **7.0 / 10** | Strong ARIA baseline, focus-visible, reduced-motion. Weak on color-only status, hover-only live rail, mobile keyboard paths. |
| **Information Architecture** | **7.5 / 10** | Clear CORE/RESEARCH/TOOLS/SYSTEM grouping, predictable nav, Koyfin-style ⌘K. Minor terminology drift. |

**Headline finding (corrected):** The prior audit reported a ~444px dead gutter at 1920px and ~1030px at 3440px. **Live re-measurement contradicts this** — the current build fills ~99% of viewport at all tested widths (1366/1920/2560/3440). The width-cap blocker is **resolved in code**; remaining width work is *ultrawide density refinement* (more columns / context rail on ≥2560px), not a fix of a broken gutter. *(Note: a stale `max-width: 1520px` still exists on `.portfolio-command-page` at `theme.css:31311` but is not taking effect in the current DOM — recommend deleting it to avoid confusion.)*

**Second headline finding (Brand v2 compliance — VERIFIED LIVE, still valid):** The design system explicitly forbids cyan. `theme.css` contains **118** hardcoded cyan/sky/blue references (`rgba(56,189,248,…)`, `rgba(0,212,255,…)`, `#38bdf8`, `#0ea5e9`) and `AnalyticsModule.jsx` alone contains **186** hardcoded colors. Color communicates meaning in this product; scattered hardcoded values will desync between light/dark themes and violate the monochrome contract.

---

## Top 20 Improvements (ranked by impact ÷ effort)

| # | Improvement | Priority | User impact | Eng effort | UX rationale |
|---|---|---|---|---|---|
| 1 | ~~Fix the shell width cap~~ **RETRACTED — verified live: content already fills ~99% at 1366/1920/2560/3440px.** Remaining width work is #4 (ultrawide density), not a gutter fix. | — | — | — | `audit-v2.json` gutter numbers were from a stale build; re-measured 99.1%@1920 / 99.4%@3440 via CDP. Remove the now-dead `max-width:1520px` on `.portfolio-command-page` (theme.css:31311). |
| 2 | **Purge 118 cyan/sky/blue refs in `theme.css` → semantic tokens (`--color-interactive`, `--color-focus`, `--color-data-*`)** | P0 | High | M (1–2d) | Restores monochrome contract; prevents light/dark desync. VERIFIED LIVE (118 refs). |
| 3 | **Extract 265+ hardcoded colors in components (esp. 186 in `AnalyticsModule`) into tokens** | P0 | High | L (1–2wk) | Same as #2 but across feature code; required for Brand v2 acceptance. VERIFIED LIVE (186 in AnalyticsModule). |
| 4 | **Ultrawide density strategy: more columns / persistent context rail above 2560px** | P1 | High | M (2–3d) | Width now fills ~99% (verified), but on 3440px a single 3152px column of portfolio/analytics still reads as one wide strip. Add 2-up grids + right context panel (`WorkspaceLayout` already supports `contextPanel`) for genuinely *higher density*, not just wider. |
| 5 | **Analytics desk-tab scroll cue + confirm mobile/tablet pass** | P1 | High | S–M (<1d audit already done; fix is small) | Mobile/tablet is **now verified overflow-free** (91 measurements). The one real mobile defect: `.analytics-tab-list` scrolls but shows no cue — Equities/Macro/Commodities are unreachable-by-discovery at 320px. Plus confirm sidebar drawer focus-trap/Escape. |
| 6 | **Decisions: widen Kanban board + raise/relax `WIP_LIMIT` warning affordance + keyboard DnD** | P1 | Med | M (2–3d) | 6 columns (New/Triaged/Researching/Journaled/Review due/Reviewed) — on ultrawide add more horizontal room; board reads cramped on laptop. Drag-and-drop needs a keyboard alternative for a11y. |
| 7 | **Analytics: reduce surface area — default to "hub", lazy-load the 7 sub-domains, add a "focus mode"** | P1 | High | M (2–3d) | 7503-line module, ~70 useState toggles (crypto/options/equities/macro/commodities/hub/spec). Highest information-overload risk in the app. |
| 8 | **Standardize empty states via `GuidedEmptyState` everywhere (already built, ~75 refs)** | P2 | Med | S (<1d) | Strong existing pattern; ensure all 10 modules use it consistently with a next-step CTA. |
| 9 | **Global search discoverability: promote ⌘K entry point in header, not only via hotkey** | P1 | Med | S (<1d) | Command palette is excellent but hidden; many users won't discover ⌘K. Add a visible search affordance. |
| 10 | **Sidebar: keep Live Status rail visible when collapsed (currently collapses to a dot)** | P2 | Low | S (<1d) | `sidebar-live-rail` hides market state on collapse — a lossy hidden-state pattern. |
| 11 | **Portfolio: surface rebalance/export/drill-down above the fold; currently deep in "Recommended Changes"** | P1 | Med | M (2–3d) | Key workflows (rebalance flow, saved views, export) are buried; discoverability gap. |
| 12 | **Watchlist: replace native `<select>` search with combobox; add bulk actions surfaced in toolbar** | P1 | Med | M (2–3d) | Category/search discoverability + bulk actions are weak; matches prior Tax Estimator fix pattern. |
| 13 | **Company Profile: sticky tab-nav + sticky metric header on scroll** | P2 | Med | S (<1d) | Long financials pages lose context when scrolling; tab bar should persist. |
| 14 | **Tax Estimator: scenario comparison as side-by-side panels, not sequential** | P2 | Med | M (2–3d) | Workflow clarity — compare jurisdictions simultaneously. |
| 15 | **Journal: timeline + table dual-view toggle; currently list-heavy** | P2 | Low | M (2–3d) | Trade/log readability improves with a chronological timeline mode. |
| 16 | **Research: cross-linking to Decisions/Journal is implicit; add explicit "link to thread" affordance** | P2 | Med | M (2–3d) | Research→decision integration is a core loop but under-afforded. |
| 17 | **Loading states: standardize skeletons (`.skeleton` exists) for data-heavy tables/charts** | P2 | Low | S (<1d) | Inconsistent per-module loading; some use text "Loading workspace…" only. |
| 18 | **Status indicators: pair color with icon/label (don't rely on color alone)** | P1 | Med | S (<1d) | Accessibility — color-only status fails WCAG 1.4.1 (use of color). |
| 19 | **Density control: expose terminal/compact/comfortable globally (tokens exist: `data-density`)** | P2 | Med | S (<1d) | `html[data-density]` tokens exist but discoverability/placement of the control is unclear. |
| 20 | **Breadcrumbs / workspace context: add lightweight breadcrumb on deep screens (Company, Research docs)** | P3 | Low | S (<1d) | Wayfinding on drill-down paths (Company Profile, Research doc) is weak. |

---

## Screen-by-Screen Review

### Application Shell (App.jsx, CompactWorkspaceUI, SidebarIcons)
- **Strengths:** Clear CORE / RESEARCH / TOOLS / SYSTEM grouping; `aria-current`, `aria-label`, `aria-expanded` on nav; collapse toggle with focus management; `⌘K` command palette is best-in-class (Radix Dialog focus-trap, `sr-only` titles, kbd hints).
- **Weaknesses:** Fixed left-rail width (~270px) is fine; content now expands fluidly to ~99% width (verified live at 1366–3440px). Remaining: ultrawide density (more columns) and the dead `max-width:1520px` on `.portfolio-command-page` (theme.css:31311) that no longer applies.
- **UX issues:** No visible global-search entry point (discoverability gap, #9). Live Status collapses to a dot when sidebar is collapsed (lossy, #10).
- **Responsive issues:** At ≤960px the sidebar becomes an off-canvas drawer (verified: 260px, translated off-screen, hamburger "Open Menu" present). 320–768px **now verified** — zero overflow, correct drawer behavior.
- **Accessibility issues:** Overlay backdrop has `aria-hidden="true"` on a presentational layer (correct), but the collapsed-rail live indicator loses its text label. Verify drawer focus-trap + Escape-to-close + tap-outside dismiss.
- **Suggested improvements:** Header search affordance (#9); keep live status text on collapse (#10); verify mobile drawer a11y.

### Dashboard / Home (HomeModule, 3460 lines)
- **Strengths:** "Executive" hero with metrics; toasts; sync block.
- **Weaknesses:** Prior `audit-v2` reported home density dropping to 48.5% @3440 — **now stale**; live re-measurement shows ~99% fill. Real remaining issue is *density* on ultrawide (one wide column vs. multi-column opportunity), not empty space.
- **UX issues:** On 3440px a single wide column under-uses the canvas; ultrawide 2-up grid (#4) is the play.
- **Responsive issues:** Mobile/tablet **verified** ✅ (91 measurements, zero overflow; home@320 = 96.9% fill).
- **Accessibility issues:** None specific found.
- **Suggested improvements:** Ultrawide 2-up grid (#4).

### Portfolio (PortfolioModule, 3808 lines)
- **Strengths:** "Portfolio Command Center" with attention grid, rebalance grid, TradingView charts, saved views, export. Strong data model.
- **Weaknesses:** Prior `audit-v2` reported fill 60.6% @1920 / 32.9% @3440 — **now stale**; live CDP re-measurement shows **99.1% @1920 / 99.4% @3440** (content block 1637px @1920, 3152px @3440). Rebalance/export are buried in "Recommended Changes".
- **UX issues:** Key workflows (rebalance flow, export, drill-down) below the fold; discoverability gap (#11).
- **Responsive issues:** `table-scroll` wrapper exists (good); top cards grid collapses at ≤960px (verified); mobile **verified** ✅ (zero overflow; portfolio@320 = 96.9% fill, scrollHeight ~5000px — long but expected).
- **Accessibility issues:** Status relies partly on color (concentration risk, drift) — pair with label (#18).
- **Suggested improvements:** #4, #11; remove dead `max-width:1520px` rule.

### Watchlist (Watchlist, 1291 lines)
- **Strengths:** Category tabs (stocks/crypto/indicators/commodities), guided empty state, grid/list toggle.
- **Weaknesses:** Prior `audit-v2` reported watchlist density 28.9% @3440 — **now stale**; live re-measurement shows ~99% fill. Native search/select discoverability weak.
- **UX issues:** Search + bulk actions under-afforded (#12); navigation into assets exists but not prominent.
- **Responsive issues:** Grid `1fr 1fr` at ≤380px is cramped for finance data; mobile **verified** ✅ (zero overflow).
- **Accessibility issues:** Category tablist should expose `role="tab"`/`aria-selected` (verify).
- **Suggested improvements:** #4, #12 (combobox search + bulk toolbar).

### Company Profile (CompanyProfilePage, 1539 lines)
- **Strengths:** Rich research merge (operations, customers, governance, capital allocation); tabs.
- **Weaknesses:** Long scroll; tab nav + metric header not sticky.
- **UX issues:** Scroll loses context (#13).
- **Responsive issues:** Mobile **verified** ✅ (zero overflow at 320/375/768); ensure sticky tabs hold at 320px.
- **Accessibility issues:** None specific.
- **Suggested improvements:** #13, #20.

### Briefing (BriefingModule, 438 lines)
- **Strengths:** Priority sort, collapsible sections, "create decision thread from item" — strong decision-support loop.
- **Weaknesses:** Prior `audit-v2` claimed briefing density **12% @1366 → 3.3% @3440** — **now stale and retracted**; live re-measurement shows briefing fills ~99% (briefing@1024 = 99%, briefing@320 = 96.9%). The real ultrawide opportunity is *density* (a right-rail decision queue), not empty space.
- **UX issues:** Content prioritization is good; on ultrawide, add a right "Decision Queue" / "Research Suggestions" rail (#4).
- **Responsive issues:** Mobile **verified** ✅; ultrawide density via right rail (#4).
- **Accessibility issues:** Good (`aria-live` on feedback).
- **Suggested improvements:** #4 (right-rail decision queue on ultrawide).

### Decisions (DecisionThreadModule, 727 lines) — *Kanban, confirmed*
- **Strengths:** Real 6-column Kanban (New / Triaged / Researching / Journaled / Review due / Reviewed) with drag-and-drop, `WIP_LIMIT = 8` indicator, outcomes-review view, activity feed. Exceeds the brief's expectation.
- **Weaknesses:** Board is narrow on laptop (6 columns fight for ~1100px → cramped cards). Empty state shows "NEXT STEP / No decision threads yet" (good GuidedEmptyState usage).
- **UX issues:** Card density low; column headers could carry count + WIP warning more prominently (#6).
- **Responsive issues:** At 768/1024 document overflow is **false** (verified) — board wraps/scrolls; confirm the 6-col board has an explicit horizontal scroll strategy at ≤1024. Mobile **verified** ✅.
- **Accessibility issues:** Drag-and-drop must have a keyboard alternative (no keyboard DnD found in source) — net-new a11y feature (#6).
- **Suggested improvements:** #4 (wider board on ultrawide), #6 (keyboard reordering + WIP prominence).

### Journal (JournalModule, 3423 lines)
- **Strengths:** Rich filters (strategy/timeframe/regime/side/status/search), MetricStrip, debrief lessons, guided empty.
- **Weaknesses:** List-heavy; no timeline view.
- **UX issues:** Readability of long entries; no chronological timeline (#15).
- **Responsive issues:** Filter popover exists (good); mobile **verified** ✅ (zero overflow; journal@320 scrollHeight ~6350px — long but expected).
- **Accessibility issues:** FilterPopover has `aria-expanded` (good).
- **Suggested improvements:** #15, #17.

### Research (ResearchModule, 3609 lines)
- **Strengths:** Knowledge namespaces (sources/documents/theses/catalysts/triggers/decisions/briefs) — a genuine PKM.
- **Weaknesses:** Categorization + cross-linking to Decisions/Journal is implicit.
- **UX issues:** Decision integration under-afforded (#16).
- **Responsive issues:** Mobile **verified** ✅ (zero overflow).
- **Accessibility issues:** None specific.
- **Suggested improvements:** #16, #20.

### Analytics (AnalyticsModule, 7503 lines)
- **Strengths:** Deep macro/equities/commodities/options/crypto coverage; geographic selection; timeframes; compare.
- **Weaknesses:** **Largest module, highest overload.** ~70 useState toggles, 7 sub-domains. **186 hardcoded colors** (biggest Brand v2 violation concentration).
- **UX issues:** Information overload (#7); default tab "crypto" may not be the right landing.
- **Responsive issues:** Mobile **verified** ✅ (zero page-level overflow at 320–1024). **One real mobile defect:** `.analytics-tab-list` is `overflow-x:auto` and *scrollable* (`scrollWidth 866` vs `clientW 276`, `maxScroll 590`) but shows **no scroll cue** — at 320px only "Crypto Desk" is visible; Options/Equities/Macro/Commodities sit off-screen, undiscoverable (#5).
- **Accessibility issues:** 186 hardcoded colors risk light/dark desync + contrast; ensure desk tabs have an accessible label/group.
- **Suggested improvements:** #3 (color extraction), #5 (scroll cue), #7 (focus mode).

### Tax Estimator (TaxEstimator, 2402 lines)
- **Strengths:** Jurisdiction combobox search already implemented, ledger, RightRailDrawer, scenario state.
- **Weaknesses:** Scenario comparison is sequential, not side-by-side (#14).
- **UX issues:** Workflow clarity improves with parallel scenarios.
- **Responsive issues:** Drawer pattern good; mobile **verified** ✅ (zero overflow).
- **Accessibility issues:** RightRailDrawer has `role="dialog"`, focus return (good).
- **Suggested improvements:** #14.

### Options (OptionsModule, 2146 lines)
- **Strengths:** Strategy simulator, calculator, RFQ, chain tables with `table-scroll`.
- **Weaknesses:** `audit-v2` `magicCount = 71` (highest inline-spacing magic numbers) → inconsistent spacing.
- **UX issues:** Options chain dense; min-width 760px scroll is acceptable.
- **Responsive issues:** `div[style*="grid-template-columns: 280px 1fr"]` forced to column at ≤960px (works, but brittle inline override); mobile **verified** ✅ (zero overflow; options@320 scrollHeight ~7900px — long but expected).
- **Accessibility issues:** Verify chain keyboard nav.
- **Suggested improvements:** #4, replace inline grid override with a class.

---

## Design System Recommendations

**Inconsistencies found (code-evidenced):**
- **Color:** **118** cyan/sky/blue in `theme.css`; 265 hardcoded colors across components; `AnalyticsModule` alone = 186. Violates Brand v2 "No cyan", "Color communicates meaning only", "No hardcoded colors".
- **Buttons:** `journal-btn primary/secondary`, `settings-primary-btn/secondary-btn`, shadcn `buttonVariants` all coexist. At least 3 button systems.
- **Empty states:** `GuidedEmptyState` exists and is good, but only ~75 references; some modules still use ad-hoc empty markup.
- **Spacing:** `options` module has 71 inline magic-number spacings (`margin/padding/gap: Npx` in style attrs) — should use `--space-*` tokens.
- **Elevation/shadows:** `--shadow-1/2/3` defined; usage is inconsistent (some components use raw `rgba(0,0,0,…)` shadows).

**Standardization plan:**
1. Replace every cyan literal with `--color-interactive` / `--color-focus` / a new `--color-accent-data` token.
2. Add a Codemod/lint rule (`no-hardcoded-color`) blocking `rgba(`/`#hex` outside `theme.css` token definitions.
3. Unify buttons on `buttonVariants` (primary/secondary/ghost/destructive) — deprecate `journal-btn`/`settings-*` or alias them.
4. Route all empty states through `GuidedEmptyState`.
5. Replace magic-number spacing with `--space-*` + `gap` utilities.

---

## Information Architecture Improvements
- **Grouping:** CORE (Home/Briefing/Portfolio/Watchlist) / RESEARCH (Research/Analytics/Options/Predictions) / TOOLS (Decisions/Journal/Tax) is logical and predictable. ✅
- **Terminology:** Mostly consistent. Minor: "Decisions" = "Decision Threads" in-page; "Predictions" vs "Options" boundaries could be clearer.
- **Progressive disclosure:** `GuidedEmptyState` (eyebrow "Next Step") is a strong pattern — extend to first-run onboarding.
- **Page hierarchy:** Deep screens (Company Profile, Research doc) lack breadcrumbs (#20).
- **Command palette:** Excellent; promote discoverability (#9).

---

## Responsiveness Improvements

**Evidence — LIVE RE-MEASURED (this session, Chrome CDP on :9222 vs dev server :5173):**

| Viewport (emulated) | Portfolio content fill | Content block width | Gutter |
|---|---|---|---|
| 1366 | **99.1%** | 1093px | 12px |
| 1920 | **99.1%** | 1637px | 17px |
| 2560 | **99.2%** | 2272px | 20px |
| 3440 | **99.4%** | 3152px | 20px |

> The prior `audit-v2.json` table (60.6% @1920, 32.9% @3440, etc.) is **stale — from a previous build state**. The current code is fluid and fills the viewport. That table has been superseded by the live numbers above.

**Stale rule still in tree (harmless but misleading):** `theme.css:31311` `.portfolio-command-page { max-width: 1520px }` no longer takes effect (live block measures 1637px @1920). Recommend deleting it.

**Mobile/tablet: NOW VERIFIED (this session, 91 measurements).** The brief's 320/375/768/1024/1280/1440/1720 were never captured by the old harness (it only did 1366–3440). This session closed that gap: **zero page-level horizontal overflow across all 13 sections at every width.** The one true responsive gap is closed; only the analytics-tab scroll cue (#5) remains.

**Recommendations:**
- **Desktop (1280–1920):** ✅ Verified fluid (~99% fill). No width fix needed.
- **Laptop (1024–1280):** Acceptable (~99%); no horizontal overflow at 1024 (verified).
- **Tablet (768–1024):** ✅ Verified — sidebar→drawer, single-column grids, zero overflow. Ensure Decisions 6-col board has an explicit scroll strategy.
- **Mobile (320–768):** ✅ **VERIFIED (91 measurements).** Zero page-level horizontal overflow across all 13 sections. Sidebar is a correct off-canvas drawer (260px, translated off-screen, hamburger "Open Menu"); tables live in `overflow-auto` wrappers (correct mobile pattern). Two polish items: (a) **Analytics desk tabs** scroll horizontally but show **no scrollbar/cue** — Equities/Macro/Commodities reachable only by swipe, undiscoverable (#5); (b) verify sidebar drawer focus-trap/Escape + small pills meet ≥44px touch targets. Screenshots: `scripts/audit-out/mobile/*.png`; data: `scripts/audit-out/mobile/results.json`.
- **Ultrawide (2560–3440+):** Width is fine; the opportunity is **density** — add ≥2-column grids + persistent right context rail (Decisions context, Briefing decision-queue, Portfolio exposure) so 3440px shows *more*, not just *wider*.

### Verified mobile/tablet pass — measured results

**Horizontal overflow (document-level):** `overflowX = false` for **all 13 sections at all 7 widths (320/375/768/1024/1280/1440/1720).** 0 of 91 measurements overflow.

**Content fill % by width:**

| Width | Fill % (all sections) | Sidebar mode |
|---|---|---|
| 320 | 96.9% | off-canvas drawer (hamburger) |
| 375 | 97.3% | off-canvas drawer |
| 768 | 98.7% | off-canvas drawer |
| 1024 | 99.0% | drawer→docked |
| 1280 | 99.1% | docked |
| 1440 | 99.1% | docked |
| 1720 | 99.1% | docked |

*(Auth is a centered card: 78.6%@768 → 84–100% elsewhere — intentional, not the gutter bug.)*

**Confirmed mobile/tablet issues (from screenshots + DOM probes):**
1. **Analytics desk tabs — no scroll affordance.** `.analytics-tab-list` is `overflow-x:auto` and *is* scrollable (`scrollWidth 866` vs `clientW 276`, `maxScroll 590`), but there is **no visible scrollbar/cue**. At 320px only "Crypto Desk" is visible; Options/Equities/Macro/Commodities sit off-screen. Users won't know they exist. *Fix: add a fade/scroll-shadow edge cue or a "more" overflow menu.* (Severity: Low–Med.)
2. **Sidebar drawer state** — confirmed correct off-canvas behavior. *Verify focus-trap + Escape-to-close + tap-outside dismiss.*
3. **Tables** (portfolio, watchlist, journal, tax, options) correctly use `overflow-auto` wrappers — horizontal scroll is contained, not page-level. Good pattern; keep.
4. **Vertical length on mobile** is large (portfolio ~5000px, options ~7900px at 320px) — expected for dense finance data; no action beyond ensuring sticky headers/section jumps.

**Conclusion:** The prior "mobile/tablet untested = assumed broken" gap is **closed and the verdict is positive** — the app is responsive and overflow-free down to 320px. The only real mobile defect is the analytics-tab scroll cue (issue #1 above). This upgrades Responsiveness from a guessed risk to a verified strength with one small fix.

---

## UX Debt
- **Wasted whitespace:** RETRACTED — live re-measurement shows ~99% fill at 1366/1920/2560/3440. The prior "444px @1920 / 1030px @3440 dead gutter" was stale. Real ultrawide opportunity is *density* (more columns), not gutter removal.
- **Brand v2 violations:** 118 cyan refs in `theme.css` + 265 in components (186 in `AnalyticsModule`) → not compliant.
- **Duplicate button systems:** `journal-btn`, `settings-*`, shadcn `buttonVariants`.
- **Magic-number spacing:** 71 inline spacings in Options; scattered elsewhere.
- **Mobile/tablet:** ✅ **CLOSED** — 91 measurements confirm zero horizontal overflow at 320/375/768/1024/1280/1440/1720; only the analytics-tab scroll-cue polish remains.
- **Accessibility gaps:** color-only status indicators; Decisions drag-and-drop lacks keyboard path; collapsed live-rail loses label.
- **Information overload:** Analytics (7503 lines, 7 sub-domains) needs a focus/default strategy.
- **Dead-end risk:** Empty states are good, but deep screens (Company/Research) lack breadcrumb wayfinding.

---

## Quick Wins (< 1 day)
1. Promote ⌘K search affordance in header (#9).
2. Keep Live Status text when sidebar collapsed (#10).
3. Standardize all empty states on `GuidedEmptyState` (#8).
4. Pair status colors with icons/labels (#18).
5. Expose density control globally (#19).
6. Add breadcrumbs to Company Profile / Research docs (#20).
7. Standardize loading skeletons (#17).
8. Analytics desk-tab scroll cue + delete dead `max-width:1520px` rule.

## Medium Improvements (1–5 days)
- Purge cyan in `theme.css` (#2).
- Ultrawide multi-column + context rail (#4).
- Analytics focus mode / lazy sub-domains (#7).
- Portfolio rebalance/export above fold (#11).
- Watchlist combobox + bulk toolbar (#12).
- Company Profile sticky tabs (#13).
- Tax side-by-side scenarios (#14).
- Journal timeline view (#15).
- Research→Decision linking (#16).
- Decisions board widen + keyboard DnD (#6).
- Confirm mobile/tablet pass findings + drawer a11y (#5).

## Large Improvements (> 1 week)
- Extract 265+ hardcoded component colors into tokens + lint guard (#3).
- Analytics information-architecture redesign (#7).
- Ultrawide workspace system (persistent rails, 2–3 up grids) (#4).
- Full token-lint CI gate (block hardcoded colors in PRs).

---

## Roadmap

### Phase 1 — Immediate (high-impact, low-effort)
1. **#2** Purge 118 cyan refs in `theme.css`.
2. **#9 / #10 / #8 / #18 / #19 / #17 / #20** Quick wins above.
3. **#5** Analytics desk-tab scroll cue + delete dead `max-width:1520px` rule (small, high-visibility).
*Expected effect:* Monochrome contract restored in the global stylesheet; one real mobile defect fixed; app looks institutional on every device.

### Phase 2 — Near Term (workflow + responsiveness)
1. **#3** Component color extraction (start with AnalyticsModule's 186).
2. **#4** Ultrawide multi-column + context rail.
3. **#7** Analytics focus mode.
4. **#6 / #11 / #12 / #13 / #14 / #15 / #16** Module-specific workflow fixes.

### Phase 3 — Long Term (architecture)
1. Full token-lint CI gate (block hardcoded colors in PRs).
2. Unified button/system codemod across all modules.
3. Responsive design system documented with the 8 required breakpoints as first-class.
4. Accessibility audit pass (WCAG AA): keyboard DnD, color-independent status, mobile focus order.

---

## Final Deliverable — Engineering-Ready Plan

**Prioritized recommendations (do in this order):**
1. `theme.css` cyan purge (P0, ~1.5d) — Brand v2 compliance. *(Note: the previously-listed "shell width cap" P0 is RETRACTED — live re-measure proved content already fills ~99%.)*
2. Component color extraction + lint (P0, ~1.5wk) — permanent compliance.
3. Analytics desk-tab scroll cue + mobile/tablet verification closeout (P1, <1d) — only remaining responsive defect.
4. Ultrawide strategy (P1, ~3d).
5. Module workflow wins (P1/P2, ~2–3d each).

**Estimated total effort:** ~3–4 engineer-weeks for P0+P1; ~2 more weeks for P2/P3.

**Expected user impact:** Monochrome consistency restored (Brand v2 acceptance); ultrawide becomes a productivity multiplier (more density, not just wider); mobile/tablet is **verified** overflow-free to 320px with one small polish; decision-support loops (Briefing→Decisions→Journal→Research) stay strong.

**Suggested implementation order:** `theme.css` cyan → component colors (behind lint guard) → analytics scroll cue + mobile closeout → ultrawide density → module workflows.

**Potential risks:**
- Color extraction is mechanical but touches the 7503-line AnalyticsModule; do it behind the lint guard incrementally to avoid regressions.
- Drag-and-drop keyboard alternative for Decisions is a net-new a11y feature, not a tweak.
- Ultrawide 2-up grids must not re-introduce the dense-table overflow that the mobile pass proved is currently contained — validate against `table-scroll` wrappers.

**Dependencies:**
- #3 (component colors) depends on token set being finalized in #2.
- All responsive module fixes are now unblocked — the breakpoint audit (#5) is **complete** and informed this plan.

**Mockup/layout suggestions:**
- *1920px Portfolio:* content area already ~1637px (99% — top of Brand's 88–92% band); 4-up metric strip, holdings table full-width, optional right exposure/risk rail.
- *3440px Analytics:* two side-by-side sub-domain panels (e.g., Macro chart + Equities table) with a persistent left filter rail and right "watch" rail.
- *3440px Briefing:* left reading column + right "Decision Queue" / "Research Suggestions" rail (already half-built via DecisionThread integration).
- *Mobile (375px):* sidebar → drawer (verified); single-column cards; tables in horizontal scroll with sticky symbol column (already implemented via `.zenin-table`); Analytics desk tabs get a fade/scroll cue.

---

*Audit basis: `frontend/src/App.jsx`, `WorkspaceLayout.jsx`, `DashboardLayout.jsx`, `CompactWorkspaceUI.jsx`, 10 feature modules, `theme.css` (~36,920 lines), `Brandv2.md`, `scripts/audit-out/audit-v2.json` + `widths.json` + 79 rendered screenshots (1366–3440px), plus live CDP re-measurement (1366/1920/2560/3440) and `scripts/audit-out/mobile/results.json` (91 measurements, 320–1720) captured this session.*
