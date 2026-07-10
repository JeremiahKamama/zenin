# Desktop-First Institutional Workspace — BrandV2 Compliance

## Context (what the audits proved)
The desktop **shell** is already built (`.app-layout` has `max-width: none` + responsive padding tokens at 960/1280/1600/1920/2560, a floating detached sidebar, `min-width: 0` on `.main-content`). Tables and charts are already fluid primitives (`w-full`, `width:100%`, TradingViewChart uses `width:100%` + ResizeObserver — the model).

**What actually fails the directive's validation criteria** is one layer up: every page is wrapped in a hard `width: min(100%, 14xx px); margin: 0 auto` cap, and the large-width media queries (styles.css:968-992) only adjust `.app-layout` *padding* — they never drive grid expansion. So content stays centred-and-narrow with growing black gutters on 1920px.

## Strategy
1. **Remove page/module width caps** → pages fill ~88-92% via the existing `.app-layout` padding tokens.
2. **Make grids expand** with a mixed strategy (per your choice): `auto-fit`/`minmax` floors for homogeneous card grids; explicit `@media (min-width:1600px/1920px)` overrides for content+rail grids where the rail ceiling must rise.
3. **Raise the ultrawide cap** to ~3000px (per your choice).
4. **Reserve** (not implement) a shell context-panel slot — small, no restructuring.
5. Fix 2 chart-width bugs.
6. Build-verify each batch.

Reading/form/typography caps (`.reading-layout`, `.form-layout`, `*-heading p`) and modal/drawer widths are **preserved** — they're correct, not bottlenecks.

---

## Phase 1 — Remove page/module width caps (highest impact)
Drop the `min(100%, NNpx)` cap + `margin: 0 auto` from page wrappers so they expand. Confirmed sites:
- `.analytics-layout` — styles.css:1021-1023 (1460px)
- `.home-v2` — styles.css:17854-17856 (1400px)
- `.home-exec` — styles.css:18484-18487 (1460px) **and** styles.css:22901 (second def)
- `.view-container.home-dashboard.home-exec` — styles.css:25854-25855 (1320px override, even narrower)
- `.portfolio-exec-page` — styles.css:24115-24116 (1480px)
- `.journal-page` — styles.css:15891-15893 (1400px)
- `.market-context-page` — styles.css:20532-20534 + 21236 (1500/1560px)
- `.options-exec` — styles.css:10999-11000 (1460px)
- `.home-draft` — styles.css:25148-25150 (1400px)
- `.tax-workbench` — styles.css:27909-27911 (1430px) + styles.css:31108-31111 (1500px; reconcile both)
- `.tax-subview-wrap` — styles.css:37488-37490 (1400px)
- `.portfolio-command-page` — styles.css:32753 (1520px)
- `.guest-workspace-preview` — styles.css:35819 (1180px)

Each becomes `width: 100%` (or just drop the width rule) and `margin: 0`. Inner padding stays. **Note:** several classes have multiple definition sites (base + "rework" layers) — will handle each occurrence.

## Phase 2 — Raise ultrawide cap + workspace padding (per your choice)
- styles.css:989 — `.app-layout` `max-width: 2400px` → `3000px` inside `@media (min-width: 2560px)`.
- Keep `--workspace-padding-x-ultrawide: clamp(40px, 5vw, 80px)`; confirm the math yields ~88-92% at 1920/2560/3000.

## Phase 3 — Grid expansion (mixed strategy, per your choice)
Add a small, centralized `@media (min-width: 1600px)` and `@media (min-width: 1920px)` block near styles.css:968 that drives expansion:

**(a) Homogeneous card grids → `auto-fit`/`minmax` floors** (add columns automatically):
- `.home-exec-metrics-grid` — currently locked `1fr` (styles.css:19383, 23873) → `repeat(auto-fit, minmax(220px, 1fr))`.
- `.portfolio-exec-hero-metrics-grid` — fixed `repeat(2,1fr)` (styles.css:24346) → `repeat(auto-fit, minmax(240px,1fr))`.
- `.home-v2-hero-stats` (3), `.portfolio-v2-top-cards` (4), `.analytics-research-metrics` (4), `.analytics-equities-kpi-grid` (4), `.analytics-factor-grid` (4), `.home-exec-triage-grid` (3), `.home-exec-chart-stats` (4) → switch to `auto-fit`/`minmax`.

**(b) Content+rail grids → explicit breakpoint overrides** (raise rail ceilings at 1600/1920):
- `.home-v2-main-grid`, `.portfolio-v2-main-grid`, `.journal-v2-main-grid`, `.home-exec-top-grid`, `.home-exec-main-grid` — at 1600px widen the main track + grow rail min; at 1920px grow further.
- `.analytics-factor-main`/`.analytics-macro-grid`/`.analytics-commodity-layout` — rail ceiling 360px → grow at 1920px.
- `.analytics-macro-topline`/`.analytics-options-topline` — rail 420px ceiling → grow.

## Phase 4 — Fix 2 chart-width bugs
- `frontend/src/components/PortfolioModule.jsx:2916` — ApexChart `width={200}` → remove the width prop (fill container, matching all other ApexCharts).
- `styles.css:33030-33033` — remove `.portfolio-command-drift-visual .apexcharts-canvas { max-width: 228px !important }` + the `justify-items: center` (styles.css:33025) so the donut fills its column.

## Phase 5 — Reserve shell context-panel slot (architecture only, not a feature)
- App.jsx: add a conditional `{showContextPanel && <aside className="context-panel" />}` as a third flex child inside `.app-layout` after `</main>` (near line 8490). `showContextPanel` defaults to `false` — renders nothing today.
- styles.css: add `.context-panel { flex: 0 0 var(--context-panel-width, 360px); min-width: 0; }` + a `@media (min-width: 1920px)` bump to 380px. No `.main-content` internal change (it already has `flex:1; min-width:0`). This satisfies "reserve architecture without restructuring."

## Phase 6 — Validation (the directive's exit criteria)
Build + visual check against each criterion:
- Workspace fills ~88-92% at 1920px (no page caps remain) ✅ via Phase 1
- No legacy width caps remain ✅ (grep `min(100%, 1[0-9]{3}px)` → 0 in styles.css)
- No page-specific max-width bottlenecks ✅
- Sidebar stays detached ✅ (untouched)
- Charts scale ✅ (Phase 4 + container caps gone)
- Tables scale ✅ (already w-full)
- Cards scale horizontally ✅ (Phase 3)
- No unnecessary whitespace ✅
- Future context panel introducible without restructuring ✅ (Phase 5)
- Build green + `check-production-bundle.mjs` green.

Each phase is a build-verified batch (rollback = revert that batch). App.jsx splitting stays out of scope.

---

## Notes / out of scope
- App.jsx remains un-split (per earlier decision).
- Modal/drawer/input/typography caps preserved.
- The separate Phase 6.2 `styles.css` drain + blue-slate saturation sweep (the other in-progress work) remains **paused, separate** — it touches live component colors and needs its own visual QA, independent of this width refactor. I'll keep these two efforts in separate commits so neither masks the other.