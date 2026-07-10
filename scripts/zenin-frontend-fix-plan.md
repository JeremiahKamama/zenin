# Zenin Frontend Fix Plan — Consolidated

**Source of truth:** `scripts/ux-audit-report.md` — it is both the latest and most exhaustive of the three documents.

It supersedes `ZENIN_UX_ARCH_REVIEW.md`: live CDP re-measurement (Chrome :9222 vs dev :5173) retracts that review's stale "444px dead gutter @1920 / 1030px @3440" finding — current build fills ~99% at all tested widths. It also adds a 91-measurement mobile/tablet pass (320–1720px) the earlier review never captured.

It pivots the P0 to a finding the earlier review underweighted: Brand v2 cyan violations — 118 refs reported (verified 151 in theme.css, 164 in styles.css — worse than reported).

`ui-dead-control-audit.md` is excluded — all 6 items (DB-001…006) already shipped. Verified.

## Verified finding status (against current main)

| Finding | Status | Evidence |
|---|---|---|
| Cyan in CSS | STILL TRUE, worse | theme.css=151, styles.css=164 (report said 118) |
| Dead max-width:1520px | STILL TRUE | theme.css:31335 + styles.css:32299 (both clones) |
| Mobile overflow | VERIFIED FIXED | 91 measurements, 0 overflow at 320–1720px |
| Width gutter | VERIFIED FIXED | ~99% fill at 1366/1920/2560/3440 |
| CSS near-clone files | STILL TRUE | 4,927 diff lines; drift is rgba value divergence |
| g X palette shortcut false | STILL TRUE | App.jsx:6043 label, no handler |
| DataTable missing 5 primitives | STILL TRUE | resize/sticky-col/col-vis/selection/density absent |
| Virtualization never default-on | STILL TRUE | virtual defaults false, 0 call-sites enable |
| Density switching inert | PARTIALLY FIXED | --row-height-active defined, never bound |
| Two+ button systems | STILL TRUE (tractable) | journal-btn=4 files, settings-*-btn=5 files, CVA buttonVariants |
| `<a href="#">` nav | STILL TRUE | App.jsx:6194-6220 |
| Descriptions only for active item | STILL TRUE | App.jsx:6216-6218 |
| slate-400 in mobile menu | PARTIALLY FIXED | cyan gone; App.jsx:6133 still bg-slate-400/10 |
| GuidedEmptyState already used in 10 modules — strong existing pattern to standardize on (quick win, not net-new). |

## Sequencing principle
The live audit's headline P0 is the cyan purge, but cyan lives in both near-clone CSS files. Purging in only one is wasted effort. Therefore Phase 0 = CSS consolidation first, then the cyan purge, token funnel, and every subsequent CSS change become single-write. This ordering merges the live audit's roadmap with the CSS-root-cause fix.

## Phase 0 — CSS Consolidation (prerequisite, ~3–4 days)
0.1 Collapse the two near-clone files into one source of truth.
- Keep `theme.css` as the single design-system file. Remove `import "./styles.css"` from `App.jsx:8` (keep `main.jsx:14` import `"./theme.css"`).
- Reconcile the ~4,927 differing lines: for each drifted selector pick the token-aligned value (`var(--color-*)` over any literal `rgba()`); where both are literals, prefer the dark-first `:root` token. The diff is dominated by slate-rgba vs white-rgba at slightly different alphas on identical selectors (accidental drift, not intent) — reconciliation is mechanical.
- Delete the dead `max-width:1520px` on `.portfolio-command-page` (theme.css:31335 / styles.css:32299) during consolidation — live measurement proves it has no effect.

0.2 Regression guard. Add a check asserting no second app-scope CSS file is re-introduced, and that `theme.css` has no `rgba()`/`#hex` literals outside the `:root` / `html.light-theme-active` token blocks (the seed of Phase 3's lint).

**Risk:** medium. **Mitigation:** visual spot-check Home/Portfolio/Watchlist/Journal/Options/Analytics in dark + light; drift was alpha-on-slate so deltas should be small.

## Phase 1 — Immediate, high-impact / low-effort (~1.5 weeks)
Grounded in live-audit items #2, #5, #8, #9, #10, #17, #18, #19, #20 + earlier #3/#6/#14/#15.

1.1 **Cyan purge in theme.css** (audit #2, P0). Replace the 151 cyan/sky/blue literals (`rgba(56,189,248,…)`, `#38bdf8`, `#0ea5e9`, etc.) with `--color-interactive` / `--color-focus` / a new `--color-accent-data` semantic token. Only tractable after 0.1 (single file). Restores the Brand v2 monochrome contract and prevents light/dark desync.

1.2 **Analytics desk-tab scroll cue** (audit #5, P1). `.analytics-tab-list` is `overflow-x:auto` and scrollable (`scrollWidth 866` vs `clientW 276` at 320px) but shows no cue — Equities/Macro/Commodities are unreachable-by-discovery on mobile. Add a fade/scroll-shadow edge cue or a "more" overflow menu. (Mobile/tablet is otherwise verified overflow-free; this is the single real responsive defect.)

1.3 **Command palette honesty + discoverability** (audit #9 + earlier #3/#11).
- Kill the false `g X` label at `App.jsx:6043` OR implement the two-key sequence (pending-key state machine in the `App.jsx:6072` keydown effect). Recommend implement — it's the power-user differentiator.
- Promote a visible ⌘K search affordance in the header (not hotkey-only) — the palette is excellent but hidden.

1.4 **Sidebar honesty & a11y** (earlier #6/#16).
- Replace `<a href="#">` nav (`App.jsx:6194-6220`) with real `<button>` keeping `aria-current="page"`.
- Show `meta.description` on hover/focus for all items (`App.jsx:6216`), not just active.
- Keep Live Status text visible when sidebar is collapsed (audit #10) — don't collapse to a dot (lossy hidden state).

1.5 **Brand-v2 token hygiene** (earlier #25 + audit color discipline).
- Strip `slate-400` at `App.jsx:6133` → token; repo sweep for `slate-/cyan/22d3ee/34,211,238` in JSX.

1.6 **Status color-independence + density control** (audit #18/#19, WCAG 1.4.1).
- Pair every color-only status indicator (e.g. `sidebar-live-dot`, concentration/drift risk) with an icon or text label.
- Bind the already-switched `--row-height-active` token to an actual height/min-height so density mode has visible effect, then expose the density toggle (comfortable/compact/terminal) globally.

1.7 **DataTable quick wins** (earlier #5/#9/#14).
- Default virtualization ON when `data.length > 50` (`DataTable.jsx:59`).
- Replace the bare "No data available" default with `GuidedEmptyState` (already the house pattern, 10 modules) + optional `emptyAction` CTA prop.

1.8 **Loading skeletons + breadcrumbs** (audit #17/#20).
- Standardize per-module loading on the existing `.skeleton` (replace single "Loading workspace…" text).
- Add lightweight breadcrumbs on deep screens (Company Profile, Research doc).

## Phase 2 — Near-term, workflow + density (~3 weeks)
Deps: Phase 0 + 1.1 tokens landed. Risk: medium.

2.1 **Component color extraction + lint** (audit #3, P0). Extract the 120+ hardcoded color literals in `AnalyticsModule.jsx` (and scattered others) into `--color-*` tokens, incrementally behind a `no-hardcoded-color` lint gate. Start with `AnalyticsModule` (biggest concentration).

2.2 **Ultrawide density strategy** (audit #4, P1). At ≥2560px, switch to ≥2-column grids + persistent right context rail (Briefing decision-queue / Portfolio exposure / Decisions context). `WorkspaceLayout.jsx` already supports `contextPanel`/`isUltrawide`. Width already fills ~99% — the win is more density, not wider.

2.3 **Analytics information-architecture relief** (audit #7, P1). 7,503-line module, ~70 useState toggles, 7 sub-domains. Default to "hub", lazy-load sub-domains, add a "focus mode." Highest information-overload risk in the app.

2.4 **DataTable institutional primitives** (earlier #5/#23). Add column resize, sticky first column, column-visibility toggle, row-selection model (checkbox + select-all/shift-select + context bar), row-height density switch.

2.5 **Breakpoint + density token funnel** (earlier #1/#13). Migrate the 252 `@media` rules (32 distinct px) to the 5-token `--bp-*` scale (currently 0 consumers); collapse per-module `minmax()` magic numbers; drive grid gaps + row heights from `--density`/`--row-height-active`.

2.6 **Unify button systems** (audit + earlier #4). Migrate `journal-btn` (4 files) + `settings-*-btn` (5 files) to CVA `buttonVariants`; delete the CSS families from the single `theme.css`. One token-driven vocabulary.

2.7 **Wire or delete WorkspaceLayout** (earlier #2). If 2.2/2.5 make it redundant → delete; if persistent rails are wanted → wire modules to consume `workspaceMode`/`density`. Either way stops being dead code.

2.8 **Module workflow wins** (audit #6/#11/#12/#13/#14/#15/#16):
- Decisions: wider Kanban on ultrawide, prominent WIP warning, keyboard drag-and-drop (net-new a11y feature).
- Portfolio: surface rebalance/export/drill-down above the fold.
- Watchlist: combobox search + bulk toolbar.
- Company Profile: sticky tab-nav + sticky metric header.
- Tax Estimator: side-by-side scenario comparison.
- Journal: timeline + table dual-view toggle.
- Research: explicit "link to thread" affordance.

## Phase 3 — Architectural (~2 weeks)
Deps: Phase 2. Risk: medium-high. UX impact: transformational.

3.1 **Token-lint CI gate** (audit #3/#2 large). Automate Phase 0's guard into CI: block `rgba()`/`#hex` outside `theme.css` token definitions; block a second app-scope CSS file. Permanent Brand v2 compliance.

3.2 **Legacy table migration** — migrate the ~50 `AnalyticsTableCard` call-sites + 9 raw `<table>` blocks + ~80 raw `<table>` tags across Equity/Perps/Options/Prediction to `DataTable` (now with all primitives from 2.4).

3.3 **ZeninChart wrapper** (earlier #21) — standardize ApexCharts + lightweight-charts into one tooltip/legend/zoom/compare vocabulary.

3.4 **Full WCAG AA audit** — focus order, ARIA grouping on sidebar/header (`role="navigation"`), contrast across dark + light, keyboard coverage for every surface (incl. the Decisions DnD keyboard path from 2.8).

3.5 **Settings as docked panel** (earlier #22) — replace the Settings dialog with a docked control bay.

## Execution order
- Phase 0 (CSS consolidate) → unblocks all single-write CSS work.
- Phase 1 in roughly listed order; 1.1 depends on 0.1; 1.3–1.8 are independent parallel PRs.
- Phase 2 after 1.1 tokens land; 2.1, 2.4, 2.5 are highest-leverage, do early.
- Phase 3 is additive; sequence after Phase 2 stabilizes.

## Suggested PR breakdown
- PR-0 CSS consolidation (Phase 0) — gate everything.
- PR-1a Cyan purge in theme.css (1.1).
- PR-1b Palette honesty + sidebar a11y + discoverability (1.3, 1.4).
- PR-1c Brand-v2 hygiene + status/density + DataTable quick wins + skeletons/breadcrumbs (1.2, 1.5–1.8).
- PR-2a…2h one per Phase-2 item.
- PR-3a…3e one per Phase-3 item.

## Out of scope / already done
- All of `ui-dead-control-audit.md` (DB-001…006 shipped). Verified via git log.
- Mobile/tablet overflow + ultrawide width gutter — verified fixed by live CDP re-measurement (supersedes the stale audit-v2.json numbers). Only the analytics-tab scroll cue remains.

## Backend-dependent (flagged, not blocking)
- Optimistic UI for journal/decision writes (earlier #19) may want API support. Everything else is frontend-only.

## Risk notes
- Color extraction is mechanical but touches the 7,503-line `AnalyticsModule` — do it incrementally behind the lint guard.
- Decisions keyboard DnD is a net-new a11y feature, not a tweak.
- Ultrawide 2-up grids must not re-introduce the dense-table overflow the mobile pass proved is currently contained — validate against `table-scroll` wrappers.

---

## Verification against current main (2026-07-09, live grep)

Checked every load-bearing claim in this plan before endorsing the sequencing.

| Claim | Result | Notes |
|---|---|---|
| Two near-clone CSS files exist + both imported | ✅ CONFIRMED | `theme.css` 37,000 lines (`main.jsx:14`), `styles.css` 37,833 lines (`App.jsx:8`). No `@import` between them — independent twins. |
| ~4,927 differing lines between them | ⚠️ OVERSTATED | Sorted/deduped: **11,542 lines identical**, only **203** unique-to-theme and **499** unique-to-styles (≈702 true delta). Files are ~94% identical. Reconciliation is **easier/lower-risk** than the plan implies. |
| Cyan = 151 (theme) / 164 (styles) | ⚠️ OVERCOUNT | Real single-file count ≈ **96–125** (theme) / **99–135** (styles) depending on regex; total ≈ **230 cyan literals across both**. Direction confirmed (cyan is pervasive, lives in both twins); magnitude ~25% high. |
| Dead `max-width:1520px` on `.portfolio-command-page` | ✅ CONFIRMED | `theme.css:31369` (+ nested `:32199`), `styles.css:32323` (+ `:33153`). Plan's line refs off by ~34; finding correct. Live measurement (earlier session) proves inert. |
| `<a href="#">` nav block (6194–6220) | ⚠️ NARROWER | It is **one conditional anchor** at `App.jsx:6196`: `href={isExplicitGuestMode ? slug : "#"}`, already handled by `onClick preventDefault` in app mode. 1.4 scope = a single anchor, not a block. |
| `g X` shortcut label is false | ✅ CONFIRMED | Palette command carries `shortcut: \`g ${...}\`` + `run: jump(section)`, but **no pending-key `g`-prefix handler** exists in `App.jsx` or `CommandPalette.jsx`. Advertises a dead sequence. 1.3 valid (implement the state machine or drop the label). |
| `slate-400` at `App.jsx:6133` | ✅ CONFIRMED | `bg-slate-400/10 border slate-400/20` mobile menu button — exact line. |
| DataTable at `components/data-table/DataTable.jsx` | ✅ CONFIRMED | File present (plan's `:59` virtual default + `emptyAction`/`GuidedEmptyState` claims trusted, not re-grepped). |
| Mobile overflow / width gutter fixed | ✅ CONFIRMED | 91-measurement pass this session: 0 overflow 320–1720px; ~99% fill 1366–3440px. |

**Sequencing verdict:** Phase 0 (consolidate the two CSS twins → single source of truth) is the correct gate. Because cyan lives in *both* ~94%-identical files, a pre-consolidation purge would just be duplicated effort and would drift again. Consolidation is **lower-risk than the plan estimates** (≈700 unique lines, not 4,927), and deleting `styles.css` + its `App.jsx:8` import is safe (only two import sites, no cross-`@import`).

**Scope corrections for PR sizing:**
- Phase 0 effort likely **< 3 days** (not 3–4) given the small true delta.
- 1.4 (sidebar nav) is a **single anchor** fix, not a block rewrite.
- Cyan purge total ≈ **230 literals**, not 315 — but still P0.
