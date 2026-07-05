# Brand System v2 — Zenin

_Status: active_

> **This supersedes all previous brand guidelines.**
>
> The legacy cyan/purple identity is deprecated. Those colors, gradients, and
> glow effects must not be used for any new UI work and are slated for deletion
> across the codebase (see Migration Phases 0 and 6).

---

## Philosophy

Zenin is a premium investment operating system, not a retail fintech product.

Every visual decision should communicate:

- **confidence**
- **precision**
- **restraint**
- **institutional quality**
- **timelessness**

Hierarchy must be derived from **typography, spacing, layout, motion, and
contrast** — never from decorative color.

---

## Identity

Zenin adopts a **pure monochrome identity**.

This applies to every surface Zenin ships:

- marketing website
- authenticated application
- onboarding flows
- landing pages
- dashboards
- documentation
- illustrations
- social assets
- emails
- loading screens
- empty states

**There is no permanent accent color.**

---

## Color

### Primary Palette

Neutrals comprise **95%+ of the interface**.

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

These values are the source of truth. They are exposed as CSS custom
properties in `frontend/src/styles.css` (`--color-bg-base`,
`--color-surface-card`, `--color-text-primary`, etc.) and aliased into
Tailwind's namespace in `frontend/src/index.css` via `@theme inline`.

### Interaction Tokens (replacing `--color-accent`)

There is no cyan accent. Interaction states use monochrome values:

```css
--color-interactive:       #FFFFFF;              /* primary action fill */
--color-interactive-hover: #E5E5E5;
--color-focus:             #FFFFFF;              /* focus ring          */
--color-selected:          rgba(255, 255, 255, 0.08); /* selected row/bg */
--color-selected-strong:   rgba(255, 255, 255, 0.12);
```

Primary buttons are white-on-near-black. Focus rings are white. Selected rows
lift to a subtle white-alpha. No saturated interaction color exists.

### Semantic Colors

Color exists solely to communicate meaning. Three hues, three meanings:

| Color | Meaning |
|---|---|
| **Green** `--color-success` `#10b981` | profit, positive performance, completed actions |
| **Red** `--color-danger` `#ef4444` | losses, destructive actions, failures |
| **Amber** `--color-warning` `#f59e0b` | warnings, pending states |

**No other saturated colors may appear.** Cyan, turquoise, teal, bright blue,
purple, and all gradients are forbidden.

---

## Deprecated Colors

The following are deprecated across the entire codebase and must be **deleted,
not renamed**:

- `cyan`, `turquoise`, `teal`, `bright blue`
- `purple` (including `--color-brand-purple`)
- the `--gradient-brand` cyan→purple gradient
- all neon / glow effects
- the legacy `--color-accent`, `--color-accent-hover`, `--color-accent-soft`
- `--color-brand-cyan`
- `--color-info`, `--color-info-soft`
- saturated chart aliases: `--color-data-sky`, `--color-data-sky-bright`,
  `--color-data-teal`, `--color-data-purple`
- the boot-screen `--zc-accent: #4f7cff` token in `index.html`

Audit greps (run before Phase 0 and again in Phase 6.1):

```bash
grep -rnE "#00d4ff|#38bdf8|#22d3ee|#a855f7|#a78bfa|#7dd3fc|#4f7cff" frontend
grep -rnE "gradient-brand|--color-accent|--color-brand-|--color-info" frontend
grep -rnE "color-data-sky|color-data-teal|color-data-purple" frontend
grep -rniE "glow|neon" frontend/src
```

The migration is complete when all of these return zero hits.

---

## Design Principles

Every component must satisfy these rules.

### Typography before color
Use weight, size, spacing, and alignment before introducing any visual
emphasis. Type is the primary hierarchy tool.

### Contrast before decoration
Hierarchy comes from black, white, and gray — never from colored backgrounds.
If a section needs more prominence, raise its contrast or weight, not its hue.

### Minimal surfaces
Cards blend into the canvas with subtle borders (`#262626`) and restrained
elevation. Avoid heavy shadows, bevels, and fills that compete with content.

### Information first
UI chrome recedes so financial data becomes the focal point. Density is a
feature, not a bug — professional users want more signal per screen, not larger
whitespace between buttons.

---

## Motion

Motion **replaces color** as the primary feedback mechanism.

Prefer:

- opacity transitions
- elevation changes
- subtle scaling
- smooth, short-duration easing

Avoid:

- glowing effects
- animated gradients
- flashy hover colors
- anything that reads as "Web3" or crypto-exchange

Default transition tokens live alongside the spacing scale in `styles.css` and
are surfaced to Tailwind via `@theme inline`.

---

## Typography

- **Brand / body**: `'Geist', 'Inter', -apple-system, sans-serif`
- **Mono / numerics**: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

Numerics in financial tables lean on the mono stack so digits align column to
column. Headings use weight (`font-medium`, `font-semibold`) — never color — to
signal rank.

---

## Homepage

The homepage should feel like a **premium financial publication**, not a
startup landing page.

Characteristics:

- editorial typography
- generous whitespace
- restrained imagery
- monochrome photography
- **no colorful illustrations**
- **no gradient hero sections**
- **no animated accent flourishes**

---

## Application

The application should resemble **professional software**.

Reference points:

- Bloomberg
- Apple Pro Apps (Final Cut, Logic)
- Linear
- Vercel
- Notion

Avoid visual patterns associated with crypto exchanges or Web3 dashboards:
no neon, no glassmorphism, no gradient cards, no token-style iconography.

---

## Charts

Charts follow the monochrome philosophy.

**Default series colors**:

| Series | Color |
|---|---|
| Portfolio / primary | white (`--color-data-primary`) |
| Benchmark | gray (`--color-data-secondary`) |
| Historical comparison | darker gray (`--color-data-muted`) |
| Up / positive market data | green (`--color-data-up`) |
| Down / negative market data | red (`--color-data-down`) |

Green and red appear **only** where the underlying data carries market
direction (candlesticks, P&L bars, tick arrows). A portfolio equity curve is
white; a benchmark is gray. Volume histograms are neutral gray, not cyan.

Donut/pie charts use a monochrome ramp (white → successively darker gray).
Semantic accents are permitted only when a slice represents a directional
metric.

`frontend/src/utils/chartTheme.js` is the single resolver that feeds these
values to `lightweight-charts` and `apexcharts`. No chart library receives raw
hex; everything flows through tokens.

---

## Components

The component kit lives in `frontend/src/components/ui/` (shadcn primitives)
and is styled exclusively from the token system.

### Button variants
Exactly five. No gradient variant, no branded variant:

- **Primary** — white fill, black text
- **Secondary** — elevated surface, primary text
- **Ghost** — transparent, hover lifts to `--color-surface-hover`
- **Destructive** — `--color-danger`
- **Success** — `--color-success`

### Focus & selection
Focus rings are `--color-focus` (white). Selected rows use
`--color-selected`. No saturated selection color.

### Skeletons & loading
Skeletons pulse between `--color-surface-card` and `--color-surface-elevated`.
No gradient sheen, no shimmer sweep.

### Density
Three density modes — `compact`, `cozy`, `comfortable` — driven by
`html[data-density="…"]`. Row heights read from `--row-height-*` tokens.
Density is a professional affordance; preserve it across the migration.

---

## Implementation References

- **Token source of truth**: `frontend/src/styles.css` (`:root` and
  `.light-theme-active` blocks).
- **Tailwind namespace mapping**: `frontend/src/index.css` (`@theme inline`).
- **Chart color resolver**: `frontend/src/utils/chartTheme.js`.
- **Migration plan**: this file plus the phased plan (Phases 0–6) tracked in
  the project roadmap.

---

## Governance

Any change to the palette, semantic colors, or interaction tokens must update
this document in the same change. If a future design decision introduces a new
hue, it must be justified against the principles above and approved before
landing in code.

_This file replaces the deferred brand note of 2026-05-12. Brand System v2
active as of 2026-07._
