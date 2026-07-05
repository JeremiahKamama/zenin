# Zenin Frontend Migration — Master Document

> Single source of truth for the shadcn/ui + Tailwind v4 + TanStack migration
> under **Brand System v2** (pure monochrome).
>
> This document bundles the brand spec, the full phased plan, status, and
> decisions log. Update the status table inline as work ships.

---

## Table of Contents

1. [Status Snapshot](#status-snapshot)
2. [Brand System v2](#brand-system-v2)
3. [Migration Plan](#migration-plan)
   - [Phase 0 — Foundation + Token Rewrite](#phase-0)
   - [Phase 1 — Preflight Reconciliation](#phase-1)
   - [Phase 2 — Primitive Kit](#phase-2)
   - [Phase 3 — Data Tables (TanStack)](#phase-3)
   - [Phase 4 — Charts Consolidation](#phase-4)
   - [Phase 5 — Component Migration](#phase-5)
   - [Phase 6 — Cleanup](#phase-6)
4. [Decisions Log](#decisions-log)
5. [Environment Notes](#environment-notes)
6. [Audit Greps](#audit-greps)

---

## Status Snapshot

| # | Phase | Status | Notes |
|---|---|---|---|
| 0 | Foundation + Token Rewrite | ✅ Done | Tailwind v4, monochrome tokens, shadcn config |
| 1 | Preflight Reconciliation | ✅ Done | Minimal — Zenin's unlayered CSS wins over preflight |
| 2 | Primitive Kit | ✅ Done | 19 components in `src/components/ui/` |
| 3 | Data Tables (TanStack) | ✅ Done | Wrapper + all data-heavy screens migrated |
| 3.1 | DataTable wrapper | ✅ Done | `src/components/data-table/DataTable.jsx` |
| 3.2 | Screen migrations | ✅ Done | Watchlist, CompanyProfile, HomeModule, Research, Journal, Portfolio, Options, Analytics (54 via adapter) |
| 4 | Charts Consolidation | ✅ Done | chartTheme rethemed; recharts dropped; Apex donuts via palette |
| 5 | Component Migration | ✅ Done | App shell sidebar ✅; DecisionComposer (new) ✅; settings/command-palette/mobile-drawer ✅; OptionsStrategySimulator ✅; AssetModal ✅; AnalyticsModule ✅ |
| 5.1 | App shell — sidebar | ✅ Done | JSX migrated to Tailwind; 3,476 lines of sidebar CSS drained; all cyan removed |
| 5.2 | DecisionComposer | ✅ Done | New component replaces QuickEntry drawer; centered modal; asset search; attachments |
| 5.3 | App shell — settings panel | ✅ Done | Migrated inline using Tailwind and shadcn; CSS drained |
| 5.4 | App shell — command palette | ✅ Done | Removed stale .cmdk-* classes from JSX |
| 5.5 | App shell — mobile drawer | ✅ Done | Migrated hamburger and scrim to Tailwind inline |
| 5.6 | AuthPage / PublicHomepage | ✅ Done | Migrated to Brand v2 monochrome; removed gradient backgrounds and cyan/purple colors; updated public.css tokens |
| 5.7 | HomeModule | ✅ Done | Replaced color-data-sky/purple/teal/info with Brand v2 neutral tokens (primary/secondary/muted) |
| 5.8 | Remaining modules | ✅ Done | Migrated IndicatorMetricModal, OptionsCalculator, FullMetricsPage, OptionsModule, PortfolioModule, IndicatorMetricsTable to Brand v2 neutral tokens |
| 6 | Cleanup | 🟡 Partial | `brand.md` ✅ done; legacy color deletion + boot-screen + bundle check pending |

---

## Brand System v2

> Authoritative copy also lives in [`brand.md`](../brand.md). The two files
> must stay in sync — change one, change the other.

### Philosophy

Zenin is a premium investment operating system, not a retail fintech product.

Every visual decision communicates:

- confidence
- precision
- restraint
- institutional quality
- timelessness

Hierarchy derives from **typography, spacing, layout, motion, and contrast** —
never from decorative color.

### Identity

Zenin adopts a **pure monochrome identity** across every surface (marketing,
app, onboarding, dashboards, docs, illustrations, social, emails, loading
screens, empty states). **There is no permanent accent color.**

### Primary Palette (95%+ of the interface)

```text
Background         #0A0A0A
Surface            #111111
Elevated           #171717

Border             #262626

Primary Text       #FFFFFF
Secondary Text     #A3A3A3
Muted Text         #737373
Disabled           #525252
```

Source of truth: `frontend/src/styles.css` (`:root` for dark, `.light-theme-active` for light). Aliased into Tailwind's namespace via `frontend/src/index.css` (`@theme inline`).

### Interaction Tokens (replace legacy `--color-accent`)

```css
--color-interactive:       #FFFFFF;                  /* primary fill    */
--color-interactive-hover: #E5E5E5;
--color-interactive-soft:  rgba(255, 255, 255, 0.08);
--color-focus:             #FFFFFF;                  /* focus ring      */
--color-selected:          rgba(255, 255, 255, 0.08);
--color-selected-strong:   rgba(255, 255, 255, 0.12);
```

Primary buttons are white-on-near-black. Focus rings are white. Selected rows
lift to a subtle white-alpha. No saturated interaction color exists.

### Semantic Colors (meaning only)

| Color | Token | Meaning |
|---|---|---|
| Green | `--color-success` `#10b981` | profit, positive performance, completed actions |
| Red | `--color-danger` `#ef4444` | losses, destructive actions, failures |
| Amber | `--color-warning` `#f59e0b` | warnings, pending states |

No other saturated colors may appear. Cyan, turquoise, teal, bright blue,
purple, and all gradients are forbidden.

### Deprecated Colors (delete, don't rename)

`cyan`, `turquoise`, `teal`, `bright blue`, `purple`, `--gradient-brand`,
all neon/glow effects, `--color-accent`, `--color-accent-hover`,
`--color-accent-soft`, `--color-brand-cyan`, `--color-brand-purple`,
`--color-info`, `--color-info-soft`, `--color-data-sky`,
`--color-data-sky-bright`, `--color-data-teal`, `--color-data-purple`,
and the boot-screen `--zc-accent: #4f7cff` token in `index.html`.

### Design Principles

1. **Typography before color** — weight, size, spacing before emphasis.
2. **Contrast before decoration** — hierarchy from black/white/gray, not hue.
3. **Minimal surfaces** — subtle borders, restrained elevation.
4. **Information first** — UI chrome recedes; financial data is the focal point.

### Motion

Motion **replaces color** as the primary feedback mechanism. Prefer opacity,
elevation, subtle scaling, smooth short-duration easing. Avoid glow, animated
gradients, flashy hover colors, anything reading as Web3/crypto-exchange.

### Typography

- **Brand / body**: `'Geist', 'Inter', -apple-system, sans-serif`
- **Mono / numerics**: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

Headings use weight — never color — to signal rank.

### Homepage

Premium financial publication, not startup landing page. Editorial typography,
generous whitespace, monochrome photography. **No colorful illustrations, no
gradient hero, no animated flourishes.**

### Application

Resembles professional software (Bloomberg, Apple Pro Apps, Linear, Vercel,
Notion). Avoid crypto-exchange / Web3 visual patterns.

### Charts

| Series | Color |
|---|---|
| Portfolio / primary | white (`--color-data-primary`) |
| Benchmark | gray (`--color-data-secondary`) |
| Historical comparison | darker gray (`--color-data-muted`) |
| Up / positive market data | green (`--color-data-up`) |
| Down / negative market data | red (`--color-data-down`) |

Green/red appear **only** where the underlying data carries market direction.
Donuts use a monochrome ramp. `frontend/src/utils/chartTheme.js` is the single
resolver feeding tokens to all chart libraries.

### Components

Five button variants, no gradient: **Primary**, **Secondary**, **Ghost**,
**Destructive**, **Success**. Focus rings = `--color-focus` (white). Selected
rows = `--color-selected`. Skeletons pulse between surface tokens — no sheen.

Three density modes (`compact` / `cozy` / `comfortable`) driven by
`html[data-density="…"]`; row heights read from `--row-height-*` tokens.

---

## Migration Plan

### Phase 0 — Foundation + Token Rewrite ✅

Goal: install toolchain, replace legacy cyan/purple token system with the
monochrome palette, prove it compiles. No screens migrated.

**Deliverables**
- Dependencies: `tailwindcss@4` + `@tailwindcss/vite`, TanStack Table/Virtual,
  `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`,
  `tailwindcss-animate`, Radix primitives (via shadcn `add`).
- `frontend/vite.config.js`: `@tailwindcss/vite` plugin (before `react()`),
  `@` → `./src` resolve alias, new `vendor-tailwind` + `vendor-tanstack` chunks.
- `frontend/src/styles.css`: `:root` and `.light-theme-active` blocks rewritten
  to monochrome. Legacy accent tokens kept as **aliases pointing to neutrals**
  so unmigrated components don't flash cyan; deleted in Phase 6.1.
- `frontend/src/index.css`: new Tailwind v4 entry. `@theme inline` aliases
  Zenin tokens into shadcn's namespace. `@custom-variant dark` bound to
  `.page-dark-theme` (Zenin is dark-first).
- `frontend/src/main.jsx`: imports `./index.css` once before React mounts.
- `frontend/src/lib/utils.js`: `cn()` helper (clsx + tailwind-merge).
- `frontend/components.json`: shadcn JSX config (new-york style, neutral base).

### Phase 1 — Preflight Reconciliation ✅

Tailwind v4 ships a CSS reset (`@layer base`) that conflicts with hand-rolled
rules. Zenin's `styles.css` is unlayered, so it wins over preflight in the
cascade — minimal reconciliation needed.

The `@layer base` block in `index.css` re-asserts essentials: white focus
ring, neutral border default, body background/color.

### Phase 2 — Primitive Kit ✅

All shadcn primitives net-new (Zenin had none). All Brand v2 monochrome,
all using `cn()` + Zenin tokens, all density-aware.

`frontend/src/components/ui/`:

| Component | Notes |
|---|---|
| `button` | 5 variants per Brand v2: primary, secondary, ghost, destructive, success. Plus outline/link for shadcn parity. No gradient. |
| `input`, `textarea`, `label` | Neutral borders, white focus ring |
| `card` + Header/Title/Description/Content/Footer | Minimal surface, `#262626` border |
| `badge` | default / solid / success / destructive / warning / outline |
| `separator`, `skeleton` | Skeleton = pure pulse, no sheen |
| `dialog`, `sheet` | Radix overlays, neutral scrim |
| `popover`, `dropdown-menu`, `select` | Radix poppers |
| `checkbox`, `switch` | Checked = `--color-interactive` (white) |
| `tooltip`, `tabs`, `scroll-area` | |
| `table` + Header/Body/Row/Head/Cell/etc | Foundation for Phase 3 |
| `index.js` | Barrel export — `import { Button } from "@/components/ui"` |

### Phase 3 — Data Tables (TanStack) ✅

#### 3.1 Wrapper — `src/components/data-table/DataTable.jsx`

TanStack Table + TanStack Virtual, built on Brand v2 `Table` primitives.
- API close to legacy `AnalyticsModule.DataTable` (`columns`/`data`/`onRowClick`)
- Optional `virtual` + `rowHeight` for long lists
- Sticky header, sort indicators, keyboard-accessible clickable rows
- `getRowClassName` / `getRowTitle` props (for live-price flashes, tooltips)
- Neutral hover/selected states, no colored sort arrows

#### 3.2 Screen migrations

| Screen | Tables | Notes |
|---|---|---|
| Watchlist | 1 blotter | External sort (shared with grid view); live-price flashes via `getRowClassName` |
| CompanyProfile | 3 (analyst, insider, earnings) | Display-only, clean port |
| HomeModule | 1 exec-log | Clickable rows → activity detail |
| Research | 2 (doc library, coverage map) | Buttons-in-cells preserved |
| Journal | 1 entries table | Card list (mobile) preserved alongside |
| Portfolio | 4 (attribution, exposure, executions, holdings) | Per-row computed cells (`benchDelta`, `driftRow`) |
| Options | 2 (active trades, whale flow) | Plus ATM-strike inline retheme |
| Analytics | **54 via adapter** | Legacy `DataTable` rewritten as adapter → all sites converted at once |

**Deferred**: Options chain itself (dual-row `colSpan` headers, ATM badge +
scroll-to-strike) — `DataTable` doesn't support `colSpan` headers. Rethemed
inline to monochrome; full migration in Phase 5.

**Skipped**: Calc output tables (OptionsStrategySimulator, PerpsCalculator,
OptionsCalculator) — 3–5 fixed rows each, not data-heavy. Migrate naturally
in Phase 5 component rewrites.

### Phase 4 — Charts Consolidation ✅

- **`chartTheme.js` rewritten**: `primary()`→white, `secondary()`→gray,
  `muted()`→darker gray, `palette()`→monochrome ramp. `pnl()`/`success()`/
  `danger()` retained as the **only** semantic hues. Legacy accessors
  (`info()`) redirected to neutrals — all 14 existing call sites render
  monochrome with zero per-file edits.
- **Recharts donut replaced** with Apex donut using `chartColors.palette()`.
- **`recharts` removed** from `package.json`, Vite chunk conditional, and
  `styles.css` (dead `.recharts-*` rules deleted).
- **`lightweight-charts` v5 untouched** — already the standard via
  `TradingViewChart.jsx`.

### Phase 5 — Component Migration ✅

The long tail: 30+ feature modules + 8.5K-line `App.jsx` + draining the 42K-line
`styles.css`. **One module per PR** so each is reviewable and shippable.

#### Order (dependency-first)
1. **App shell** — sidebar (`App.jsx:6159`), topbar, settings (`:6934`),
   command palette, mobile drawer. Sets the visual language. ✅
2. **AuthPage / PublicHomepage / LegalPage** — editorial typography,
   monochrome photography, no gradient hero. ✅
3. **HomeModule** (executive grid) — premium publication feel. ✅
4. **AssetModal / CompanyProfilePage / IndicatorMetricModal**. ✅
5. **PortfolioModule, OptionsModule, JournalModule, ResearchModule,
   AnalyticsModule** (parallel after kit proven). ✅
6. **TaxEstimator, PredictionMarketModule, Watchlist** (finish non-table UI). ✅
7. Leaf components: `DataAgeChip`, `Sparkline`, `Branding`, modals. ✅

#### Per-module migration pattern
- `zenin-btn ghost` → `<Button variant="ghost">`; `btn-gradient` → `<Button>`.
- Bespoke modals → `<Dialog>` / `<Sheet>`. Selects → `<Select>`.
  Tooltips → `<Tooltip>`.
- For every className rewritten, grep the class in `styles.css` and delete
  its rule in the same PR.
- Replace inline `#00d4ff` / `#a855f7` / gradients with nearest neutral or
  semantic token — no carryover.
- Motion replaces color: opacity/elevation/scale via `tailwindcss-animate`.
  No glow, no animated gradient.

#### `styles.css` shrink strategy
The 42K-line file is *drained* module by module, not rewritten in one pass.
Target by end of Phase 5: `styles.css` contains only the `:root`/
`.light-theme-active` token blocks + genuinely bespoke rules. Eventually
rename residue to `theme.css` and merge into `index.css`.

### Phase 6 — Cleanup 🟡 (partial)

`brand.md` ✅ done. Remaining:

#### 6.1 Delete legacy color (zero remaining references)
- Re-run audit greps — expect zero hits.
- Delete unused gradient utilities (`--gradient-brand`, `.btn-gradient`).
- Remove legacy glow/box-shadow rules.
- Remove any `--color-data-sky/teal/purple` leftovers.
- Reconcile boot-screen `--zc-*` tokens in `index.html:49-141` → monochrome
  (replace `#4f7cff` with white/neutral).
- Delete the legacy token aliases kept in Phase 0 (e.g. `--color-accent`
  pointing to `--color-interactive`) once all call-sites migrated.

#### 6.2 Shrink `styles.css`
Rename residue to `theme.css`, merge into `index.css`.

#### 6.3 Icons
Replace generic icons in `SidebarIcons.jsx` with `lucide-react`. Keep branded
`LineZMark` / `ZeninLogo` (now monochrome).

#### 6.4 Bundle check
`scripts/check-production-bundle.mjs`. Expect net win: Tailwind purge +
`styles.css` shrink + recharts removed.

---

## Decisions Log

| Decision | Rationale |
|---|---|
| **Tailwind v4** (not v3) | CSS-first `@theme` maps 1:1 onto existing token system |
| **Dark-first; `dark:` variant → `.page-dark-theme`** | Matches Zenin's actual UX; `main.jsx` theme logic untouched |
| **Legacy tokens aliased to neutrals in Phase 0, deleted in Phase 6** | Avoids flashing cyan during migration; app stays shippable |
| **Analytics adapter pattern** | Rewrote legacy `DataTable` as adapter → all 54 call-sites converted at once |
| **External sort on Watchlist** | Sort state shared with grid view; native TanStack sort deferred until grid retired |
| **Options chain NOT migrated to DataTable** | `colSpan` headers + ATM badge unsupported by wrapper; rethemed inline, full rewrite in Phase 5 |
| **Keep ApexCharts for donuts/bars** | Lightweight Charts has no donut/pie primitive |
| **JSX only** (no TS conversion) | Out of scope for this migration |
| **Admin app excluded** | Customer-facing first; admin migrates later |

---

## Environment Notes

- **Node ≥20 required** for Tailwind v4 (`@tailwindcss/oxide` native binary).
- System Node was 18.17; Node 20.20.2 installed to `~/.n-node/bin/node` via `n`.
- For `npm`/`dev`/`build` commands, prefix with
  `PATH="$HOME/.n-node/bin:$PATH"` — or add `~/.n-node/bin` to shell profile
  to make permanent.
- `.nvmrc` says `20` — once Node 20 is on the system path, that takes over.

---

## Audit Greps

Run before Phase 0 (done) and again in Phase 6.1. Migration is complete when
all return zero hits.

```bash
# Hardcoded legacy hex values
grep -rnE "#00d4ff|#38bdf8|#22d3ee|#a855f7|#a78bfa|#7dd3fc|#4f7cff" frontend

# Legacy token references
grep -rnE "gradient-brand|--color-accent|--color-brand-|--color-info" frontend

# Saturated data aliases
grep -rnE "color-data-sky|color-data-teal|color-data-purple" frontend

# Glow / neon effects
grep -rniE "glow|neon" frontend/src
```

Current state (as of Phase 4 completion):
- ~23 hardcoded legacy hex hits (mostly in `styles.css` one-off gradients/glows
  and `public.css` marketing page)
- `cyan` (43) / `purple` (33) / `teal` (29) keyword mentions across `src/`
- These drain away as each module migrates in Phase 5 and are deleted in 6.1.

---

_Outdated: the deferred brand note of 2026-05-12 is replaced. Brand System v2
active as of 2026-07. This document and `brand.md` are the canonical
references for all UI work._
