## Goal
Merge the load-bearing content of `frontend/src/theme.css` into `frontend/src/styles.css`, then delete `theme.css` and its import. Fold in the (much smaller than expected) cyan-naming cleanup at the same time.

## What's actually true (verified, correcting earlier mistakes)
- **Braces: balanced** in all files. No corruption to fix.
- **Literal cyan (`#00D4FF` / `rgba(0,212,255)`): 0 hits in `styles.css`.** Only exists in generated `dist/` output (don't touch).
- **`theme.css`** = untracked, 736KB single-line file. It is **compiled Tailwind v4.3.2 output** (`/*! tailwindcss v4.3.2 */` banner) with **hand-authored CSS appended after** the Tailwind machinery.
- **`styles.css`** = tracked, hand-authored design-system source (38,733 lines).
- **Load situation:** `main.jsx:13` imports `index.css` (the real Tailwind v4 entry — `@import "tailwindcss"`), `main.jsx:14` imports `theme.css` (the frozen bundle), `App.jsx:8` imports `styles.css`. So on `/app`, Tailwind utilities are generated twice (once live from `index.css`, once frozen in `theme.css`).

### Key architectural insight
`theme.css` has two distinct parts:
1. **Tailwind-compiled part** (`@layer properties/theme/base/utilities`, `@property`, `@keyframes`, scale tokens like `--text-sm`, `--spacing`, `--animate-spin`). → **Regenerated at build time** by `index.css` + the `tailwindcss()` Vite plugin (`vite.config.js:12`). Safe to drop; nothing lost. (Verified: `styles.css` defines none of these tokens yet the app renders `text-sm`/`rounded-lg` fine today — because the live build provides them.)
2. **Appended hand-authored part** (custom selectors like `.journal-btn`, `.sidebar-statusbar`, `.auth-divider`, etc.). → **NOT regenerated.** This is the only content that must be migrated.

## Plan

### Phase 1 — Compute the true delta (read-only, programmatic)
Because every prior automated count has been wrong, do NOT trust a pre-baked selector list. Instead:
1. Split `theme.css` at the boundary between Tailwind machinery and appended custom CSS (after the last `@layer`/`@property`/`@keyframes` block).
2. Extract the full selector set from the appended section.
3. Diff against `styles.css`'s selector set to produce the **authoritative list of selectors present only in `theme.css`**.
4. Spot-check the known candidates (`.sidebar-statusbar`, `.nav-badge`, `.status-rail`, `.auth-divider`, plus tax-workbench / home-exec-log-table / analytics / connect-account specifics) and record exact line numbers + rule bodies to port.

### Phase 2 — Port theme-only selectors into `styles.css`
- Append each genuinely-missing selector (from Phase 1's verified delta) into the matching thematic section of `styles.css` (sidebar rules near existing sidebar block, tax-workbench near its block, etc.), preserving `theme.css`'s rule bodies.
- **Conflict rule:** where a selector exists in both, keep `styles.css`'s value (it is the newer, token-based version; verified that shared tokens like `.light-theme-active` overrides and `:root` blocks are identical apart from minification whitespace).
- Add a global focus fallback only if Phase 1 confirms elements would lose their ring: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }`. (Neither file currently has a bare global `:focus-visible`; decision deferred to the delta check.)

### Phase 3 — Deprecated cyan-name cleanup (the real "cyan" work)
Per `brand.md` (lines 76–131: legacy cyan identity is deprecated, "deleted, not renamed"), clean up the 15 textual `cyan` references in `styles.css`:
- **Inline 3 token aliases** and their 8 consumers:
  - `--home-draft-cyan: var(--color-interactive)` (line 25283) + `--home-draft-cyan-soft` (25284) → replace consumers at 25321, 25533, 25571 with `var(--color-interactive)` / `var(--color-interactive-soft)` directly, then delete the alias defs.
  - `--analytics-cyan: var(--color-data-primary)` (28700) → replace consumers at 28749, 28856, 28973, 29014, 29026 with `var(--color-data-primary)`, delete alias.
- **Rename `.cyan` class selectors** (3 spots): `.tax-v2-kpi-icon.cyan` (10325), `.analytics-desk-command.cyan` (29137, 38678) — rename to a neutral suffix (e.g. `.kpi-accent` / `.desk-accent`) **and** update the matching `className` in the JSX source. Values are already monochrome; only the name changes.
- Run `brand.md`'s audit grep (`grep -rnE "#00d4ff|#38bdf8|#22d3ee|..." frontend/src`) to confirm zero literal cyan in source. If the UX-review flag (`rgba(34,211,238)` in `App.jsx`) still exists, fix it here too.

### Phase 4 — Remove `theme.css`
- Delete `frontend/src/theme.css`.
- Remove `import "./theme.css";` from `frontend/src/main.jsx:14`.
- Do **NOT** port Tailwind `@theme` scale tokens (`--text-sm`, `--spacing`, `--animate-spin`, `--radius-lg`, `--blur-md`) — the live build regenerates them from `index.css`. (If Phase 6 verification shows a utility broke, we port the specific missing token defensively.)

### Phase 5 — Update references to `theme.css`
- `frontend/src/index.css:5` comment ("Token source of truth lives in theme.css") → repoint to `styles.css`.
- `frontend/src/public.css:3369` comment referencing theme.css's grid → update wording.
- `scripts/scan-css-health.mjs` (lines 6, 19, 152, 155, 171) and `scripts/find-css-issues.mjs` (lines 5, 15, 30): retarget the hardcoded `frontend/src/theme.css` path to `frontend/src/styles.css`.

### Phase 6 — Verify
1. `npm run build:spa` (from `frontend/`) — build must succeed; confirms Tailwind regenerates utilities cleanly without `theme.css`.
2. Run `node scripts/scan-css-health.mjs` and `node scripts/find-css-issues.mjs` — both pass against the new target.
3. `npm run dev` + visual smoke test of the surfaces whose selectors were ported: sidebar (status bar, nav badges, theme switcher), auth divider, tax workbench ledger, home-exec log table interactive rows, analytics equities status strip, connect-account success mark. Confirm in both dark and light themes.
4. Re-run the `brand.md` cyan audit grep → zero source hits.

## Notes / non-goals
- `public.css` is a separate concern (its own `--bg`/`--panel` namespace scoped to `.zc-home`) — not touched.
- `index.css` stays as the Tailwind v4 entry — not touched (only its header comment is updated).
- Not committing anything — changes stay in the working tree for you to review.