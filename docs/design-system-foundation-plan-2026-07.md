# Zenin — Design System Foundation & UI Standardization Plan

**Date:** 2026-07-09
**Author:** Design Systems Lead / Frontend Staff Engineer
**Status:** Foundational consolidation plan. Supersedes scattered token/ad-hoc findings. Companion to `typography-institutional-review-2026-07.md`.
**Method:** Evidence-backed static analysis of `frontend/src` (`styles.css` 38,971 lines, all `*.jsx`, `package.json`, `.github/workflows/`). Every claim marked ✅ Verified / ⚠ Inferred / ❌ Rejected. Counts re-verified against the working tree on the date above.

---

## Executive Summary

Zenin has a **well-designed token foundation that almost nothing uses.** Across the five design dimensions, token adoption is uniformly near zero:

| Dimension | Tokens defined | Token adoption | Verdict |
|---|---|---|---|
| Typography (`--fs-*`) | 9 | **1.8%** (22 / 1,208 CSS) · 0% inline JSX | Decorative |
| Spacing (`--space-*`) | 9 | **0.07%** (2 / 2,965) | Effectively zero |
| Radii (`--card-radius-*`) | 3 (all `3px`) | **1.08%** (7 / 650) | Degenerate — all values identical |
| Elevation (`--shadow-*`) | 3 | **0.76%** (1 / 132) | Effectively zero |
| Z-index | **0** | **0%** | No tokens exist at all |
| Font-weight (`--fw-*`) | **0** | **0%** | No tokens exist; 82% non-compliant |
| Line-height / Letter-spacing | **0** | **0%** | No tokens exist |

The pattern is unmistakable: **tokens were defined, then bypassed in virtually every declaration.** The result is a product that, today, behaves like "multiple independently-designed products stitched into one shell" — 62 bespoke button classes, 117 card classes, 40+ header class names, 4 independent toast systems, 11+ loading patterns, 40+ empty-state classes, and 3 competing modal systems.

### Current maturity: **2.5 / 10** (Foundation exists, not enforced)

### Biggest risks
1. **Drift compounds.** With no lint, no Stylelint, no hooks, and no frontend tests, every PR can silently introduce new bespoke classes. There is nothing to stop a sixth button variant or a 118th card class. ✅ Verified — no ESLint, no Stylelint, no Prettier, no pre-commit hooks anywhere in the repo; CI only builds + audits deps + scans secrets.
2. **The 8,578-line `App.jsx` god component + 38,971-line `styles.css`.** Any change is high-risk because nothing is isolated. A design-system migration touches the most dangerous files first.
3. **Institutional credibility gap.** The brand positions Zenin against Bloomberg/Koyfin, but the typography review established the numeric identity (JetBrains Mono) doesn't ship, and metric cards use a different visual language per module. Drift reads as "startup," not "institutional."

### Highest-ROI improvements (do these first)
1. **Stand up guardrails before migrating.** Adding ESLint + Stylelint rules that *ban* new raw colors/font-sizes/spacing *before* the migration means the migration never has to fight new drift. (Phase 5 pulled forward.)
2. **Load JetBrains Mono + fix the three degenerate token families** (radii all `3px`; add `--fw-*`, `--z-*`). Quick, unblocks everything.
3. **Adopt the primitives that already exist.** The `ui/*` shadcn kit and `CompactWorkspaceUI.jsx` atoms are well-built and mostly unused. Routing existing bespoke components through them is higher-leverage than building new ones.

---

## Current Design System Assessment

### Strengths
- **The token *design* is good.** `--color-*` (50 tokens, mirrored dark/light), `--fs-*` (9-step scale), `--space-*` (4px base), `--shadow-*` (3-step ramp) are well-conceived. The architecture is right; only adoption is broken.
- **Dark/light theming is genuinely solid.** Dual-token system (`:root` dark + `html.light-theme-active` light), full mirror, AA-tuned semantic colors. WCAG AA failures remediated to 0 in light mode. ✅ Verified (`UI_AUDIT_REPORT.md`).
- **A real primitive kit exists.** 20 shadcn/Radix primitives in `components/ui/` (`button.jsx`, `card.jsx`, `dialog.jsx`, `table.jsx`, etc.) — clean, token-driven via Tailwind `text-[var(--fs-*)]`.
- **A shared-atom layer exists and is *partially* adopted.** `CompactWorkspaceUI.jsx` (7 atoms: `CompactPageHeader`, `MetricStrip`, `DensePanelHeader`, `GuidedEmptyState`, `InlineControlGroup`, `FilterPopover`, `RightRailDrawer`) is imported by 6–9 modules each. This is the seed of a real design system.
- **Resilient data layer.** Centralized `zeninFetch` (CSRF, timeouts, errors), TTL'd client cache, consistent stale-data banners. Not design-system per se, but it means the *content* these components render is reliable.

### Weaknesses
- **Token adoption is near-zero across all dimensions** (table above). The system is decorative.
- **Primitives are dead code.** `<Button>` rendered **0 times**; `<Card>` **0 times**. `buttonVariants` imported once for className only. 62 bespoke button classes + 117 card classes carry the actual UI.
- **Layout components are 75% dead.** `WorkspaceLayout`, `ReadingLayout`, `FormLayout` have **0 importers**; `DashboardLayout` is used by 1 module (Home). Each module hand-rolls its own `view-container` div. ✅ Verified.
- **Interaction patterns are heavily fragmented.** 4 toast systems, 11+ loading classes, 40+ empty-state classes, 3 modal patterns. ✅ Verified.
- **Three dimensions have no tokens** (z-index, font-weight, line-height/letter-spacing). Radii tokens are degenerate (all `3px`).
- **`styles.css` is 38,971 lines** — a single unmanageable stylesheet with multiple `!important` consolidation blocks that keep losing specificity battles.

### Architecture
- **Styling approach:** Tailwind v4 (CSS-first) + Radix/shadcn + `class-variance-authority` in the primitives; large bespoke CSS class system + heavy inline `style={{}}` in feature code.
- **647 inline `style={{}}` blocks** across components. Worst offender: `AnalyticsModule.jsx` with **312** (nearly half the codebase's total). ✅ Verified.
- **184 inline `rgb()`/`rgba()` + 3 raw hex** in JSX — bypassing the color token system entirely.
- **Component organization:** typography/spacing organized *by module* (`.home-exec-*`, `.journal-debrief-*`), not *by role* (`.t-title`, `.t-metric`). Nothing pulls equivalent elements toward equivalence.

### Scalability
Poor. Adding a new module today means inventing new classes (because adopting primitives requires the module to match the primitive's assumptions, and there's no guidance). The drift rate is structurally baked in. The repeated `!important` consolidation blocks (at least 3 attempts visible in `styles.css`) are evidence the team has tried to retroactively impose order and failed.

### Developer experience
- No lint, no format, no style lint → no fast feedback. Developers can't know they've introduced drift.
- No frontend tests → no regression safety net during any refactor.
- The god-component (`App.jsx`, 8,578 lines, 93 `useState`) makes state changes high-risk.
- Result: developers *avoid* touching shared styles because they can't predict the blast radius.

---

## Foundation Roadmap

> **Sequencing principle:** Guardrails come *first* (pulled forward from Phase 5). A migration with no lint is a migration that loses ground every PR. Tokens are fixed *second* (cheap, unblocks migration). Primitives/Layouts/Interactions follow.

### Phase 1 — Foundation & Guardrails (Week 1–2)
**Goal:** Stop the bleeding. Make it hard to introduce *new* drift while you clean up the old.

**1.1 Stand up the toolchain** ✅ all verified-absent today
- Add **ESLint** (`eslint.config.js`) with React + hooks plugins.
- Add **Stylelint** (`.stylelintrc.json`) with `stylelint-no-restricted-syntax` / custom rules.
- Add **Prettier** + **lint-staged** + **husky** pre-commit hook.
- Wire `lint` / `stylelint` / `format` scripts into `frontend/package.json`.
- **Add a CI step** (`.github/workflows/ci.yml`) that runs lint + stylelint on PRs (blocking).

**1.2 Enforce (warn-level first, then error)**
- ESLint: ban inline `style={{` with `fontSize`/`color`/`padding`/`margin`/`gap`/`zIndex` (use `no-restricted-syntax` on `JSXAttribute[name='style']`).
- ESLint: discourage raw `z-index` literals.
- Stylelint: `color-no-hex`, `declaration-property-value-allowed-list` for `font-size: /var\(--fs/`, `padding: /var\(--space/`, etc.
- Stylelint: `max-nesting-depth`, ban `!important` (with documented allowlist).

**1.3 Fix the degenerate / missing token families**
- **Radii:** Replace the three identical `--card-radius-*: 3px` with a real scale: `--radius-sm 3px`, `--radius-md 6px`, `--radius-lg 10px`, `--radius-full 999px`. *(Problem: token abstraction provided no differentiation. Root cause: scale never differentiated. Solution: real scale.)*
- **Font-weight:** Add `--fw-regular 400`, `--fw-medium 500`, `--fw-semibold 600`. *(Problem: brand allows only 500/600 but 82% of 521 declarations use other values. Root cause: no token to bind to.)*
- **Z-index:** Add `--z-base 1`, `--z-dropdown 100`, `--z-sticky 140`, `--z-overlay 1000`, `--z-modal 1300`, `--z-toast 2000`. *(Problem: 18 magic integers, 4 layer-purpose conflicts at z=1300, toasts hidden behind overlays.)*
- **Motion (new dimension):** Add `--duration-fast 120ms`, `--duration-base 200ms`, `--ease-standard cubic-bezier(...)`. *(Problem: 87 transitions + 21 animations all raw `0.2s ease`.)*
- **Load JetBrains Mono** (per typography review — the highest-impact single fix).

| # | Problem | Root cause | Solution | UX improvement | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|---|
| 1.1 | No guardrails | Never set up | ESLint+Stylelint+Prettier+hooks+CI | Drift stops growing | S | Low | None |
| 1.2 | Drift unenforced | No rules | Ban raw colors/sizes/spacing in lint | Consistency becomes default | S | Low | 1.1 |
| 1.3 | Degenerate/missing tokens | Scale never differentiated; 3 dims have no tokens | Real radius/fw/z/motion scales + load mono | Numeric identity ships; layering predictable | S | Low | None |

### Phase 2 — Token Migration & Primitive Adoption (Month 1)
**Goal:** Move the highest-volume drift onto tokens + primitives.

**2.1 Migrate the top raw values onto tokens**
- Spacing: `10px` (587 uses, off-scale — **add `--space-2_5: 10px` first**), then `12/8/16/4/20px` → `--space-*`. *(Problem: 2,965 spacing decls, 0.07% tokenized. Root cause: scale skips the #1 most-used value (10px).)*
- Font-size: migrate the 85 "12px" orphans (add `--fs-12`), then collapse the 18 fractional rems.
- Font-weight: migrate 700/800/900 → 500/600 (requires per-case design judgment).

**2.2 Route bespoke components through primitives**
- **Buttons:** Replace the 62 bespoke button classes with `<Button variant="primary|secondary|ghost|destructive|success" size="sm|md">`. Delete `.journal-btn`, `.home-exec-btn`, `.confirm-order-btn`, `.analytics-btn`, etc.
- **Cards:** Replace 117 card classes with `<Card>` + density variants.
- **Modals:** Collapse 3 patterns (shadcn Dialog ×1, generic `modal-overlay` ×7, 11 named overlays) → one `<Modal>`/`<Drawer>` built on Radix Dialog (focus-trap, scroll-lock, a11y for free).

**2.3 Fix the shared-atom gaps**
- `FilterPopover` is used by **1 module** (Journal) — promote it as the only filter UI.
- Delete dead primitives: `ui/sheet.jsx`, `ui/popover.jsx` (0 importers). ✅ Verified.

| # | Problem | Root cause | Solution | UX improvement | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|---|
| 2.1 | 0.07–1.8% token adoption | Tokens bypassed | Migrate top raw values | Predictable sizing/spacing | L | Medium (touches many files) | 1.2 lint |
| 2.2 | 62 button + 117 card classes; 3 modal patterns | Primitives unused | Route through `<Button>`/`<Card>`/`<Modal>` | One action language; a11y on all modals | L | Medium | 2.1 |
| 2.3 | Dead/partial primitives | Inconsistent adoption | Promote `FilterPopover`; delete dead `sheet`/`popover` | Less code, one filter pattern | S | Low | 2.2 |

### Phase 3 — Layout Standardization (Month 2–3)
**Goal:** Every page built from the same templates.

**3.1 Replace 40+ header class names with one `<PageHeader>`**
- Today: `portfolio-command-header`, `metrics-header`, `company-page-header`, `options-exec-header`, `home-exec-page-header`, etc. *(Problem: equivalent "top of page" headings use 14–42px / weight 650–950.)*
- Solution: `CompactPageHeader` (already 6 importers) becomes mandatory; deprecate all bespoke headers.

**3.2 Workspace templates** (the 4 layout patterns from the brief)
- **DashboardLayout** (Header → Metrics → Workspace → Panels): already exists, used by Home. Generalize.
- **AnalysisLayout** (Filters → Charts → Tables → Insights): extract from Analytics.
- **ResearchLayout** (Search → Documents → Summary → Actions): extract from Research.
- **DecisionLayout** (Queue → Detail → Timeline → Actions): extract from Decisions/Journal.
- Delete the 3 dead layout components (`WorkspaceLayout`, `ReadingLayout`, `FormLayout`). ✅ Verified 0 importers.

**3.3 Shared content primitives**
- `<MetricStrip>` (4 importers → mandatory) for the metric row.
- `<Section>`, `<ContentGrid>`, `<ContextRail>` — new shared shells so modules stop hand-rolling `view-container` divs (7 files do this today).

| # | Problem | Root cause | Solution | UX improvement | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|---|
| 3.1 | 40+ header classes; titles 14–42px | No shared PageHeader | Mandate `CompactPageHeader` | Consistent page-entry hierarchy | M | Medium | 2.2 |
| 3.2 | Each page invents layout | 3/4 layout comps dead | 4 workspace templates | Every page "feels like one product" | L | Medium | 3.1 |
| 3.3 | `view-container` hand-rolled ×7 | No shared shells | `<Section>`/`<ContentGrid>`/`<ContextRail>` | Predictable spacing/rhythm | M | Low | 3.2 |

### Phase 4 — Interaction Standardization (Month 3–4)
**Goal:** Loading, error, empty, success, focus behave identically everywhere.

- **Loading:** 11 classes + 8 bespoke spinners → one `<Skeleton>` (today: used by 2 modules) + one `<Spinner>`.
- **Empty states:** 40+ classes → `<EmptyState>` (today: `GuidedEmptyState` used by 9 — promote as mandatory, delete bespoke).
- **Toasts:** 4 independent systems (Journal `notify`/`JournalToast`, Home `homeToast`, App `tradeToast`, Simulator `showToast`) → one global `<Toast>` + `useToast()` hook.
- **Errors:** one `ErrorBoundary` exists (good) but its fallback UI is itself off-token (raw `rgba(239,68,68,…)`, hardcoded font sizes) — fix it to use tokens. Module error UIs → shared `<ErrorState>`.
- **Focus/keyboard:** standardize focus-visible rings (the brand mandates white rings); wire the advertised-but-broken `g X` command-palette shortcut.

| # | Problem | Root cause | Solution | UX improvement | Effort | Risk | Dependencies |
|---|---|---|---|---|---|---|---|
| 4.1 | 4 toast systems, 11 loading, 40 empty classes | Each module self-served | One of each shared primitive | Predictable async feedback | M | Medium | 2.2 |
| 4.2 | ErrorBoundary off-token; module errors bespoke | Guardian violated its own rules | Tokenize boundary; shared `<ErrorState>` | Trustworthy failure states | S | Low | 4.1 |

### Phase 5 — Guardrail Hardening & Governance (Ongoing)
**Goal:** Make future drift impossible, not just discouraged.

- Promote Phase-1 lint rules from `warn` → `error`.
- **CI custom checks:** fail builds if new `*-btn`/`*-button`/`*-card` classes appear (diff-based); fail if hardcoded hex outside an allowlist; fail if raw `font-size`/`padding` outside token `var()`.
- **Component enforcement:** codify "no bespoke buttons/cards/modals" in a `CONTRIBUTING.md` + a `docs/design-system.md` ownership doc.
- **Token governance:** any token change must update `Brandv2.md` in the same PR (brand rule, currently unenforced — add a CI check that diffs `:root` against a generated snapshot).

---

## Area-by-Area Findings (Evidence)

### Typography ✅ Verified (full detail in `typography-institutional-review-2026-07.md`)
- `--fs-*` scale (10/11/13/14/15/16/18/22/32px), 1.8% adopted. 85 off-scale "12px" orphans. No heading scale (`h2` = 14–42px). JetBrains Mono declared 59×, never loaded. 82% of font weights non-compliant (brand allows 500/600 only).
- **Recommendation:** add `--fs-12`, `--fw-*` tokens; define h1–h6 scale; load mono; migrate raw values.

### Spacing ✅ Verified
- `--space-*` (4/8/12/16/20/24/32/40/48px), **0.07% adopted** (2 / 2,965). Top raw value `10px` (587 uses) is **off-scale**. 23 distinct off-scale values, 1,616 total occurrences. 509 inline spacing in JSX (AnalyticsModule: 232).
- **Recommendation:** add `--space-2_5: 10px` (or move to a 2px-base scale); migrate top values; ban raw spacing in lint.

### Colors ✅ Verified
- `--color-*` (50 tokens, mirrored dark/light) — the **best-adopted** family, but still bypassed by 184 inline `rgb()`/`rgba()` + raw hex in JSX. Prior `UI_AUDIT_REPORT.md` remediated hardcoded JSX colors 355→0 at one point; drift has returned.
- Forbidden brand colors (purple `#7c3aed`, cyan `#0ea5e9`) still present in `styles.css` gradients despite brand forbidding them.
- **Recommendation:** Stylelint `color-no-hex` + `declaration-property-value-allowed-list`; grep-and-remove forbidden hues; the color system is the closest to "done" — protect it.

### Radii ✅ Verified
- 3 tokens, **all `3px`** — degenerate. 650 `border-radius` declarations; 324 use raw `3px` (the token value, written literally); 127 use `999px`/`50%` (no token). Adoption 1.08%.
- **Recommendation:** real scale (`--radius-sm/md/lg/full`); deprecate `--card-radius-*`.

### Elevation / Shadows ✅ Verified
- `--shadow-1/2/3` ramp, **0.76% adopted** (1 / 132). 66 distinct one-off shadow values. `!important` on 25 shadows. **Bug:** `styles.css:3111` references undefined `var(--color-shadow)`.
- **Recommendation:** migrate to ramp; fix the undefined-token bug.

### Z-index ✅ Verified
- **No tokens exist.** 18 distinct magic integers (1–2000). 4 layer-purpose conflicts at z=1300 alone (drawer backdrop vs modal vs flow overlay). Toasts at z=1500 hidden behind overlays at z=1400+.
- **Recommendation:** `--z-base/dropdown/sticky/overlay/modal/toast` scale; migrate.

### Components ✅ Verified
- **Buttons:** 62 bespoke classes; shared `<Button>` rendered 0×. Global `!important` consolidation block (`styles.css:640`) partially fails.
- **Cards:** 117 bespoke classes; shared `<Card>` rendered 0×.
- **Tables:** most-consistent area (two consolidation blocks) but `ui/table.jsx` uses weight 500 while CSS tables use 800 — primitive-built tables look lighter.
- **Modals:** 3 patterns (Radix Dialog ×1; generic `modal-overlay` ×7; 11 named overlays). `role="dialog"` in only 7 files — many overlays lack a11y.

### Layouts ✅ Verified
- 4 layout components; **3 are dead** (WorkspaceLayout, ReadingLayout, FormLayout — 0 importers); DashboardLayout used by 1 module. 7 modules hand-roll `view-container`. 40+ header class names.
- `CompactWorkspaceUI.jsx` atoms are the de-facto shared layer (6–9 importers each) — the seed to grow.

### Interactions ✅ Verified
- **Loading:** 11 classes, 1 shared `<Skeleton>` (2 importers), 8 bespoke spinners.
- **Empty:** 40+ classes, 9 use shared `GuidedEmptyState`.
- **Error:** 1 boundary (off-token fallback); bespoke module error UIs.
- **Toast:** 4 independent systems (Journal, Home, App-trade, Simulator-via-prop). No shared primitive.
- **Focus:** brand mandates white focus rings; global ring exists but bespoke controls override with `outline: none`.

### Responsiveness ✅ Verified (prior session)
- 268 `@media` rules across ~21 distinct px values — **no tokenized breakpoint scale**. `--bp-*` tokens defined (5) but consumers pick ad-hoc thresholds. Mobile verified overflow-free 320–3840px (91 measurements). `prefers-reduced-motion` handled (13×); `prefers-contrast` unhandled (0×).
- **Recommendation:** consume `--bp-*` via a `useBreakpoint()` hook; add `prefers-contrast` support.

### Engineering Guardrails ✅ Verified
- **ESLint: absent.** **Stylelint: absent.** **Prettier: absent.** **Pre-commit hooks: absent.** **Frontend tests: absent** (1 parser test only). CI runs backend tests + builds + `npm audit` (non-blocking) + secret scan. **Nothing validates design tokens or blocks drift.**
- **Duplicate CSS:** ❌ **Prior "two 37K-line duplicate stylesheets" finding is REJECTED** — direct verification shows `theme.css` no longer exists in `src/`; only `styles.css` (38,971 lines) is imported. That duplication has been resolved.

---

## Success Criteria

The project is complete only when **all** of the following are true:

- [ ] **Every page feels like the same product.** One header component, one metric strip, four workspace templates — no bespoke headers/layouts remain.
- [ ] **Every component comes from the shared design system.** No `*-btn`/`*-button`/`*-card` classes; `<Button>`/`<Card>`/`<Modal>` are the only implementations.
- [ ] **Design tokens are the only source** of colors, spacing, typography, shadows, radii, z-index, and motion values. Adoption ≥ 95% (measured by Stylelint).
- [ ] **New UI cannot easily bypass the system.** ESLint + Stylelint + CI block raw colors/sizes/spacing and new bespoke component classes.
- [ ] **CI prevents regressions.** Lint + stylelint + diff-based bespoke-class checks run on every PR (blocking).
- [ ] **Developers have enforceable guidance.** `docs/design-system.md` + `CONTRIBUTING.md` document the mandatory primitives and token usage.
- [ ] **Zenin achieves the visual consistency expected of an institutional-grade financial platform** — including a shipped mono numeric identity, one metric-card language, and a real heading hierarchy.

---

## Review Standards & Rejections

### Confirmed ✅
- Token adoption near-zero across all 5 dimensions (re-verified: spacing 2/2965, radii 7/650, shadows 1/132, z-index 0 tokens).
- 3 of 4 layout components dead; DashboardLayout used once.
- No ESLint/Stylelint/Prettier/hooks/frontend-tests; CI lint-free.
- 4 toast systems, 11 loading classes, 40+ empty-state classes, 3 modal patterns.

### Rejected ❌
- **"Two duplicate ~37K-line stylesheets (`styles.css` + `theme.css`) load together."** Direct `wc -l` + import check shows `theme.css` no longer exists in `src/`; only `styles.css` is imported. This duplication has been resolved since the earlier audit. The single remaining `styles.css` is still 38,971 lines (a separate maintainability problem), but the duplication finding is stale.

### Uncertainty ⚠
- Live visual severity of some drift (e.g., perceived metric-card inconsistency) is inferred from static analysis; a running-app pass with real data would confirm user-facing impact. The typography review flagged the same for numeric alignment.

---

## For Every Recommendation: Template

Each roadmap item above uses this structure:

> **Problem** — what's wrong (with count/evidence)
> **Root cause** — why it happened
> **Solution** — the recommended fix
> **UX improvement** — what users gain
> **Effort** — XS / S / M / L / XL
> **Risk** — Low / Medium / High
> **Dependencies** — what must precede it
> **Long-term maintenance impact** — does this reduce or increase future burden (the goal: every item should *reduce* it)

The north star, restated: **six months from now, it should be difficult — not easy — to create inconsistent UI.** That inverts the current state, where inconsistency is the path of least resistance. Guardrails first.

---

*Companion document: `docs/typography-institutional-review-2026-07.md` (full typography depth). This plan covers the other four dimensions (spacing, color, radii/elevation/z-index, motion) plus components, layouts, interactions, and the engineering guardrail strategy that makes all of it durable.*
