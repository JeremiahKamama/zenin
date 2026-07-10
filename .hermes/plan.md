# Plan — Asset Modal Refresh (P1)

**Spec:** `Asset Modal Refresh v2.0` (floating institutional research popup; stays a modal).
**Brand compliance:** Brandv2.md (monochrome, no cyan/gradient, semantic tokens only, reuse shared primitives, no page-specific styling).
**Status:** READY FOR IMPLEMENTATION.

## Context (verified from source)
- `AssetModal.jsx` = 1150 LOC single component = **research + trade ticket** hybrid.
- Trade ticket is gated by `isTradeEligible = !researchOnly && ...`. Both real call sites pass `researchOnly`:
  - `App.jsx:6801` → `researchOnly` + `onConfirm={null}` (primary entry).
  - `AnalyticsModule.jsx:5539` → omits `researchOnly` (defaults `true`).
  - ⇒ Trade UI is **already dead in production**. Removing it is low blast-radius.
- Spec intent (philosophy "not an order ticket" + "Replace footer with Research Actions toolbar") ⇒ **remove the buy/sell order ticket**; keep read-only Portfolio Context.
- Styles live in `frontend/src/styles.css` (`theme.css` also has modal rules). No co-located CSS.
- Shared `Button` exists at `components/ui/button.jsx` with variants primary/secondary/ghost/destructive/success/outline/link — to be used for Research Actions.
- Current modal CSS uses `radius: 3px` (not the spec's 16–20px); container `max-width:720px` (spec wants 1100–1200px, max-height 85vh). These are the core visual upgrades.

## Decision: trade ticket
Remove `orderType`, `quantity`, `handleConfirmOrder`, confetti/fireworks, buy/sell/balance logic, and the `<footer className="modal-footer">` trade block. Keep `onConfirm`/`researchOnly` props accepted (no-op) to avoid breaking the call-site signatures. Portfolio context (avg cost, returns, allocation) stays read-only in the right column.

## Refactor target — split into reusable sub-components (each <250 LOC)
New directory `frontend/src/components/assetModal/`:
```
AssetModal.jsx            (orchestrator: state, data fetch, layout, a11y)
  ├─ AssetHeader.jsx
  ├─ AssetChart.jsx
  ├─ PortfolioContext.jsx
  ├─ ResearchTabs.jsx
  ├─ tabs/OverviewTab.jsx
  ├─ tabs/FinancialsTab.jsx
  ├─ tabs/NewsTab.jsx
  ├─ tabs/ResearchTab.jsx
  ├─ tabs/OptionsTab.jsx
  ├─ tabs/NotesTab.jsx
  └─ ResearchToolbar.jsx
```
Keep all existing data-fetch effects (history, live quote, performance, earnings, finviz) in `AssetModal.jsx` and pass via props — no behavior change to data.

## Layout (per spec)
```
┌─ Header (72–88px): name·ticker·exchange·price·change·market status·watch·profile·close ─┐
├─ Chart (65–70% width)            │ Portfolio Context (right col, always visible)        ─┤
├─ Research Tabs: Overview·Financials·News·Research·Options·Notes (one renders)            ─┤
└─ Research Toolbar: watchlist·alert·compare·journal·briefing·copy link·profile            ─┘
```
- Container: `width: min(1160px, 100%); max-height: 85vh; overflow inside; radius 16px; dark backdrop; large shadow; subtle border`. Centered both axes.
- Page behind frozen (existing `modal-overlay` already does this).

## Accessibility (required)
- `role="dialog"`, `aria-modal="true"` on `.asset-modal-window`.
- Escape closes (keydown listener → `onClose`).
- Focus trap: focus first interactive on open; Tab cycles within modal; restore focus to trigger element on close (`document.activeElement` captured before open).
- Visible focus states via existing `:focus-visible` tokens.

## Visual hierarchy / typography
- Geist (inherit, already default) for UI/labels/body.
- JetBrains Mono for prices/percent/ticker/ratios/market-cap/volume/timestamps/financial metrics — wrap those values in `.font-mono` (confirm token exists; else add utility class).
- Spacing scale locked to 4/8/12/16/24px; remove excessive vertical gaps.

## Styling rules (Brandv2)
- Add new CSS under `.asset-modal-window` block in `styles.css` (reuse existing tokens: `--color-surface-card-strong`, `--color-border-subtle`, `--color-text-*`, `--color-interactive`). No hardcoded hex/rgb except rgba() with the existing slate `148,163,184` convention already in file.
- No cyan, no gradients. Monochrome. Hover via subtle elevation only.
- Research Actions render via shared `<Button variant=ghost/outline>` (not bespoke buttons).

## Responsive
- Desktop: centered floating, 2-col (chart | context).
- Tablet: context stacks beneath chart.
- Mobile (<640px): full-screen, sticky header + sticky toolbar, scrollable content, no horizontal overflow.

## Integration (preserve)
- `onToggleStar` (watchlist), `onViewCompanyProfile` (profile), `isInWatchlist` — wired into header + toolbar.
- Toolbar actions "Add to Journal / Briefing / Compare / Create Alert / Copy Link" — render as buttons; wire to existing handlers if present on props, else `console.debug`/no-op stubs with clear TODO (out of scope to build those features; spec lists them as visible actions).
- "return to workflow": closing calls `onClose` (already restores focus to trigger) — no route change, SPA state untouched.

## Build/verify
1. `npm run build` (frontend) must pass.
2. `node --check` each new .jsx (via build).
3. Manual render check via headless Chrome on :9222 (same harness as prior sessions): open an asset → assert floating container, header compact, 2-col chart/context, tabs switch, toolbar present, Escape closes, focus returns. Screenshot before/after.

## Out of scope (explicit)
- Building real "Create Alert / Compare / Add to Journal / Add to Briefing" backends — buttons rendered, handlers stubbed.
- Any change to chart data source or fundamentals endpoints.
- Removing `researchOnly`/`onConfirm` props from the signature (kept for call-site stability).

## Risk
- 2-col layout on a 720px-wide legacy container conflicts with spec 1100–1200px → will widen container per spec.
- News/Research/Options/Notes tabs currently have NO data source in the component → render as structured empty states ("No recent news / research synced") rather than fake data (Brandv2: no fabrication).
