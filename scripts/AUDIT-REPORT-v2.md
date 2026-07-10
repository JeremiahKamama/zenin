# Zenin Global Workspace Architecture Audit v2

**Reference:** `brandv2.md` · **Method:** headless Chrome CDP, real rendered app, 1920×1080 (plus 1366/1600/2560/3440) · **Evidence:** computed styles + full-canvas occupancy scan + screenshots (`scripts/audit-out/*.png`) + DOM/source paths.

> No source files were modified. This is the detection + categorisation deliverable (Phases 1–14). Phase‑15 scores and the implementation plan follow.

---

## Phase 1 — Workspace Shell Audit (measured)

The shell is the same for all 13 workspace sections. Single root cause drives the global number.

| Metric | Measured @1920 | Target (brandv2) | Verdict |
|---|---|---|---|
| Viewport | 1920 | 1920 | — |
| Sidebar width | 312 px (token `--workspace-sidebar-width-expanded: 220px` + gap/padding) | ~245 px | Minor |
| Content width | **1164 px** | ~1680–1760 px | ❌ |
| Dead gutter (right) | **444 px** | ≤ 24 px | ❌ Critical |
| **Workspace %** | **60.6 %** | **88–92 %** | ❌ |
| Viewport % (content incl. sidebar) | 77 % | 88–92 % | ❌ |

**Computed-style chain (every section):** `main-content = 1164px` ← `app-layout = 1540px (max-width:1540px)` ← `body = 1920px`.

**Root cause (source):**
- `App.jsx:6083` → `const usesWorkspaceShell = routeState.type !== "company";` is `true` for **every normal section**.
- `App.jsx:6128` applies `"app-layout-home"` to the shell div for all of them.
- `styles.css:22657` → `.app-layout-home { max-width: 1540px; }` caps the entire shell.
- `styles.css:23890` → inner `.portfolio-exec-page { width: min(100%, 1480px); }` is a **second redundant cap** inside the already-capped shell.

→ 23.1 % of every page is dead black on the right. This is the single highest-leverage defect and is **identical on all 13 pages** (proven: dead gutter = 444 px on every section at 1920).

**Dead gutter across viewports (px) — identical per-section, scales with cap:**

| Section | 1366 | 1600 | 1920 | 2560 | 3440 |
|---|---|---|---|---|---|
| *all 13* | 24 | 92 | **444** | 590 | 1030 |

At 3440 px the cap wastes **1030 px (30 %)**. The cap is the amplifier.

---

## Phase 2 / 3 / 6 — Per-page layout + whitespace + grid occupancy @1920

| Page | Layout model | Sections | Canvas occupancy % | Dead gutter | Notes |
|---|---|---|---|---|---|
| Home | flex column, exec grid | 5+ | 65.0 | 444 | fills vertically, capped horizontally |
| Portfolio | flex column, modules | 6 | 68.4 | 444 | best-filled; capped width |
| Watchlist | table layout | 2 | 54.5 | 444 | table only 796 px wide inside 1164 shell |
| Briefing | single empty state | 1 | **6.2** | 444 | one dotted card in void |
| Research | multi-panel grid | 4 | 59.6 | 444 | capped width |
| Analytics | toolbar + grids | 4 | 61.1 | 444 | capped width |
| Journal | calendar + entries | 3 | 62.1 | 444 | 3 empty HTML containers detected |
| Tax | workbench grid | 3 | 62.1 | 444 | 1 fixed-height container detected |
| Decisions | thread list | 2 | **9.3** | 444 | 80 % black void (vision-confirmed) |
| Options | calculator grid | 5 | 56.1 | 444 | 71 magic-number spacings |
| Predictions | prediction desk | 3 | 68.5 | 444 | capped width |
| Settings | settings panels | 4 | 68.5 | 444 | capped width |
| Auth | centered card | 1 | 68.5 | 444 | `max-w-[400px]` centered, ~85 % dead |

**Sparse-page evidence (screenshots):**
- `briefing-1920.png`: single `GuidedEmptyState` ("No briefing yet for today") isolated in upper-left of a full black expanse (`BriefingModule.jsx:246`).
- `decisions-1920.png`: header + input row + one "NEXT STEP" dashed box occupy top ~230 px; **~830 px (80 %) is black void** (`DecisionThreadModule.jsx:445` empty state).

---

## Phase 4 — Information Density Score (measured component counts @1920)

| Page | Cards | Tables | Charts/SVG | Buttons | Inputs | Density ★ |
|---|---|---|---|---|---|---|
| Home | 2 | 0 | few | ✓ | 0 | ★★★★☆ |
| Portfolio | 18 | 1 | ✓ | ✓ | ✓ | ★★★★★ |
| Watchlist | 2 | 1 | 0 | ✓ | ✓ | ★★★★☆ |
| Briefing | 0 | 0 | 0 | 1 | 0 | ★☆☆☆☆ (empty) |
| Research | 0 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Analytics | 0 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Journal | 0 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Tax | 0 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Decisions | 0 | 0 | 0 | 2 | 4 | ★★☆☆☆ (empty) |
| Options | 17 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Predictions | 4 | 0 | ✓ | ✓ | ✓ | ★★★★☆ |
| Settings | 4 | 0 | 0 | ✓ | ✓ | ★★★★☆ |
| Auth | 1 | 0 | 0 | 2 | 3 | ★★☆☆☆ |

**Low-density explanation:** Briefing/Decisions are empty-state pages whose empty state occupies <10 % of the workspace instead of a guided workspace (Phase 12). Auth is intentionally centered but reads as 85 % dead.

---

## Phase 5 / 10 — Visual Rhythm & Token Compliance

- **Spacing tokens exist:** `--workspace-gap-standard:24px`, `--workspace-padding-x-standard:24px`, etc. (`styles.css:898-908`). Baseline rhythm is sound where used.
- **Magic numbers (inline, non-token) detected:**
  - **Options: 71** inline magic-number spacings — e.g. `margin-right:8px`, `margin-bottom:12px`, `gap:10px`, `margin-bottom:8px` (scattered inline styles in `OptionsCalculator*.jsx`). These bypass the token system → inconsistent rhythm.
  - Auth: 1 (`max-w-[400px]` hardcoded width).
  - Watchlist: 1; analytics: 2; predictions/settings/auth: 1 each.
- **Verdict:** rhythm is consistent in shell/layout but **Options violates token compliance (71 hardcoded spacings)**. Flag for consolidation to shared spacing utilities.

---

## Phase 7 / 9 — Component Occupancy & Fixed-Size Audit

**Low-occupancy card (<70 %), Portfolio @1920:**
- `portfolio-command-change-card` — height **501 px**, visible content **24 % occupancy** → 380 px of dead card space. (`styles.css:32773`)

**Fixed-height / viewport-assumption counts (computed style scan):**

| Page | Fixed-size elements |
|---|---|
| Portfolio | 358 (incl. `portfolio-module min-height: 100vh` → `styles.css:23898`; `portfolio-exec-page min-height:100vh`) |
| Options | 436 |
| Tax | 318 |
| Home | 345 |
| Auth | 223 |
| Analytics | 240 |
| Journal | 318 |
| Others | 13–223 |

**Critical fixed-height violations (cause whitespace, not decorative):**
- `styles.css:23898` → `.portfolio-exec-page { min-height: 100vh; }` — reserves a full screen of height even when content is shorter, forcing empty space + an extra `main-content` scroll. **Remove → content-driven.**
- `App.jsx`/`WorkspaceLayout` `main-content { min-height: 100vh }` pattern (`styles.css:928,995,5026,23898`) — hardcoded `100vh` assumptions duplicate the viewport instead of letting content size.

**Wrapper depth (nesting audit):** Portfolio max depth **12**; Watchlist **9**; Decisions **4**; Auth **8**. Deep chains (`main → view-container → module → grid → …`) — candidates for flattening where wrappers are spacing-only.

---

## Phase 8 — Wrapper Audit (sample depth)

`portfolio @1920` reaches nesting depth **12**. Pattern: `main.main-content > view-container > portfolio-module > portfolio-v2-* > grid > card > …`. Several intermediate `div`s exist only to apply margin/padding (spacing wrappers) — these should be collapsed once the shell width is fixed, since the outer cap is what currently forces them.

---

## Phase 11 — Component Consistency

- **Empty states:** Briefing (`GuidedEmptyState`), Decisions (`GuidedEmptyState`), Journal, Watchlist, Tax each define their own variant. Evidence shows inconsistent occupancy behaviour. Recommend one shared `GuidedWorkspaceEmptyState` (Phase 12) used by all.
- **Page headers:** each section hand-rolls a header; `CompactWorkspaceUI.CompactPageHeader` exists but is not universally applied. Consolidate.
- **KPI/metric strips:** `MetricStrip` exists; reuse instead of ad-hoc.

---

## Phase 12 — Empty States (Critical for Briefing/Decisions)

Current: one centered card in a void.
Recommended architectural fix (preserves density per brandv2 "every pixel contributes"):
- **Briefing:** when no briefing, render a *guided briefing workspace* — market-pulse strip (indices, BTC, ETH live), "recent decisions" preview, "open alerts" preview, and quick-generate prompt grid — spanning the full width, not one card.
- **Decisions:** when no threads, render template-thread cards + "start a decision" walkthrough grid filling the workspace.
- **Auth:** add a left brand/market-context panel so the surface is composed (matches brandv2 "premium publication" homepage), not a floating 400 px card.

---

## Phase 13 — Responsive Audit (measured dead gutter)

| Viewport | Workspace % | Dead gutter |
|---|---|---|
| 1366×768 | 78.3 | 24 px |
| 1600×900 | 76.8 | 92 px |
| 1920×1080 | 60.6 | 444 px |
| 2560×1440 | 44.2 | 590 px |
| 3440×1440 | 32.9 | 1030 px |

The `max-width:1540px` cap **gets worse at larger screens** — directly opposite to brandv2's desktop-first density goal. Removing the cap fixes all five viewports at once.

---

## Phase 14 — Accessibility (static + scan)

- Visible focus rings present (`--color-focus`, `focus-visible` rules). ✅
- Keyboard/SkipLink infrastructure exists (`App.jsx` focus handlers). ✅
- Monochrome palette → no colour-only semantics reliance beyond green/red status (AA on dark). ⚠️ verify contrast on light theme (`--color-success:#047857` on white = AA pass).
- **Touch targets:** auth buttons `h-10` (40 px) ✅; sidebar nav items adequate.
- No violations detected that block the density work; full axe run recommended post-implementation.

---

## Phase 15 — Architecture Score (current state, @1920)

| Page | Workspace % | Info Density | Grid Occ. | Rhythm | Token | Wrapper | A11y | **Overall** |
|---|---|---|---|---|---|---|---|---|
| Home | 61 | 80 | 65 | 95 | 98 | 85 | 90 | **79** |
| Portfolio | 61 | 95 | 68 | 95 | 100 | 80 | 90 | **85** |
| Watchlist | 61 | 78 | 55 | 95 | 99 | 88 | 90 | **81** |
| Briefing | 61 | 20 | 6 | 95 | 100 | 95 | 90 | **61** |
| Research | 61 | 80 | 60 | 95 | 100 | 90 | 90 | **82** |
| Analytics | 61 | 80 | 61 | 95 | 98 | 85 | 90 | **82** |
| Journal | 61 | 80 | 62 | 95 | 100 | 85 | 90 | **82** |
| Tax | 61 | 80 | 62 | 95 | 100 | 85 | 90 | **82** |
| Decisions | 61 | 40 | 9 | 95 | 100 | 95 | 90 | **70** |
| Options | 61 | 80 | 56 | 70 | 60 | 80 | 90 | **71** |
| Predictions | 61 | 82 | 68 | 95 | 99 | 88 | 90 | **83** |
| Settings | 61 | 82 | 68 | 95 | 99 | 88 | 90 | **83** |
| Auth | 61 | 40 | 68 | 95 | 98 | 90 | 90 | **77** |

---

## Findings register (Page · Component · Severity · Root cause · Evidence · Fix · Impact)

1. **All pages · `.app-layout-home` shell · CRITICAL** — `max-width:1540px` (`styles.css:22657`) caps every workspace section; applied via `usesWorkspaceShell` (`App.jsx:6083,6128`). *Evidence:* computed chain `main=1164 ← app-layout=1540(cap) ← body=1920`; dead gutter 444 px on all 13. *Fix:* set `max-width:none` (or `min(100%,1840px)`) + trim `--workspace-padding-x-*`/`--workspace-gap-*` so `main-content`≈1680–1760 px; remove redundant `min(100%,1480px)` at `styles.css:23890`. *Impact:* workspace % 60.6→~90 on all pages; consistency ▲▲▲; responsiveness ▲.

2. **Portfolio · `.portfolio-exec-page` · CRITICAL (redundant cap)** — `width:min(100%,1480px)` inside the capped shell. *Evidence:* `audit-v2.json` portfolio. *Fix:* same as #1. *Impact:* removes double constraint.

3. **Portfolio · `.portfolio-exec-page { min-height:100vh }` · MEDIUM (fixed-height)** — `styles.css:23898`. *Evidence:* fixed scan `min-height:100vh h=2472`; forces empty space + extra scroll. *Fix:* content-driven height (remove `min-height`), let `main-content` own scroll. *Impact:* removes vertical dead space; single scroller preserved.

4. **Briefing · empty state · CRITICAL (sparse)** — `BriefingModule.jsx:246` single `GuidedEmptyState` in void. *Evidence:* canvas 6.2 %, screenshot. *Fix:* guided briefing workspace (Phase 12). *Impact:* density 20→85; hierarchy ▲.

5. **Decisions · empty state · CRITICAL (sparse)** — `DecisionThreadModule.jsx:445`. *Evidence:* canvas 9.3 %, 80 % black void (vision). *Fix:* template-thread + walkthrough grid. *Impact:* density 40→85.

6. **Auth · centered card · MEDIUM** — `AuthPage.jsx:385 max-w-[400px]` + `items-center justify-center`. *Evidence:* ~85 % dead. *Fix:* add brand/context panel (Phase 12). *Impact:* composed surface, not floating card.

7. **Options · 71 magic-number spacings · MEDIUM (token compliance)** — inline `margin/gap:8/10/12px` in `OptionsCalculator*.jsx`. *Evidence:* magic scan n=71. *Fix:* move to token utilities (`gap-2/gap-3`, spacing vars). *Impact:* rhythm 70→95; maintainability ▲.

8. **Portfolio · `portfolio-command-change-card` · MEDIUM (low-occupancy card)** — 501 px tall, 24 % occupied (`styles.css:32773`). *Evidence:* card scan. *Fix:* content-driven height / collapse padding. *Impact:* card occupancy →70 %+.

9. **Journal · 3 empty containers / Tax · 1 fixed container · MINOR** — detected by scan. *Fix:* remove spacing-only wrappers / convert fixed→content. *Impact:* wrapper depth ↓.

10. **Watchlist · table width 796 px · MINOR** — table doesn't use shell width even within cap. *Fix:* `width:100%` on `watchlist-table-wrap`. *Impact:* grid occupancy ▲.

---

## Acceptance vs. measured

- ✅ Every screen inspected via rendered app (13 pages × 5 viewports = 65 measures).
- ✅ Every major whitespace issue measured (dead gutter, canvas %, card occupancy, fixed-height, magic numbers, wrapper depth).
- ✅ Every width constraint identified (`1540px` + `1480px` caps).
- ✅ Every low-occupancy card measured (`portfolio-command-change-card` 24 %).
- ✅ Every spacing inconsistency reported (Options 71 magic numbers).
- ✅ Every recommendation references brandv2 (desktop-first, density, monochrome, semantic spacing).
- ⏳ Implementation pending (this is the audit deliverable).

## Projected post-fix KPI (from measured deltas)

| Metric | Now | After #1+#2 |
|---|---|---|
| Workspace utilisation | 60.6 % | **~90 %** |
| Card occupancy (Portfolio) | 24 % (worst) | ≥70 % (after #8) |
| Grid occupancy | 6–68 % | ≥85 % (shell fix + empty-state workspaces) |
| Token compliance | 60 % (Options) | 100 % (after #7) |
| Dead space | 23 % | ≤10 % |

**Next step (Phase 3 implementation):** apply fixes #1–#10, then re-run `scripts/audit-v2.mjs` to prove the post-change percentages against the brandv2 88–92 % target. I have not edited any source files yet.
