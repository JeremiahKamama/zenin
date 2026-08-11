---
name: Zenin
description: A connected multi-asset investment workspace for research, context, and decision review.
colors:
  base: "#0A0A0A"
  surface-card: "#111111"
  surface-elevated: "#171717"
  text-primary: "#FFFFFF"
  text-secondary: "#A3A3A3"
  border-medium: "#262626"
  border-strong: "#404040"
  interactive: "#FFFFFF"
  success: "#10B981"
  danger: "#EF4444"
  warning: "#F59E0B"
typography:
  display:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Geist, Inter, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  sm: "2px"
  md: "4px"
  lg: "8px"
  xl: "12px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.interactive}"
    textColor: "{colors.base}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "18px"
  input:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
---

# Design System: Zenin

## Overview

**Creative North Star: "The Decision Ledger"**

Zenin is a dark-first product workspace that turns fragmented market signals into an inspectable decision trail. It uses a near-black surface hierarchy, compact geometric corners, and purposeful semantic color so portfolio performance, risk, freshness, and warnings communicate quickly without becoming visual decoration.

The composition is practical and data-first: persistent navigation, an open primary analysis area, and context that supports rather than competes with the next action. The system explicitly rejects the decorative crypto-dashboard look—no ambient glow as a substitute for hierarchy, no ornamental market graphics, and no equal-weight grid of unrelated KPI cards.

**Key Characteristics:**

- Dense but legible workspace geometry built on a four-pixel spacing scale.
- Semantic color reserved for financial meaning, state, and actionability.
- Low-radius controls and containers with crisp borders rather than soft, decorative elevation.
- One consistent workflow: observe, investigate, decide, journal, review.

## Colors

Zenin’s palette is monochrome by default, with green, red, amber, and stale-data tones carrying only financial or operational meaning.

### Primary

- **Ledger White** (`#FFFFFF`): the primary interaction fill on dark surfaces, high-emphasis text, and focus treatment.

### Secondary

- **Verified Green** (`#10B981`): positive performance, healthy states, and confirmed completion.
- **Risk Red** (`#EF4444`): destructive actions, losses, errors, and risk conditions.
- **Attention Amber** (`#F59E0B`): warnings, stale-data context, and conditions needing review.

### Neutral

- **Decision Black** (`#0A0A0A`): base application canvas and dark inverse.
- **Ledger Surface** (`#111111`): primary panel and card surface.
- **Raised Surface** (`#171717`): controls, menus, and layered local context.
- **Working Gray** (`#A3A3A3`): secondary explanatory text.
- **Structural Border** (`#262626`): default division between related interface regions.

**The Meaning-Only Color Rule.** Neutral controls, inactive navigation, and ordinary structure stay monochrome. Color must identify performance, risk, warning, freshness, or a direct state—not add atmosphere.

## Typography

**Display Font:** Geist, with Inter and system sans-serif fallbacks.  
**Body Font:** Geist, with Inter and system sans-serif fallbacks.  
**Label/Mono Font:** JetBrains Mono for prices, IDs, tabular figures, and technical values.

**Character:** The type system is compact, deliberate, and operational. Headings establish the task; labels describe data without becoming a decorative layer.

### Hierarchy

- **Display** (600, 32px, 1.08): page titles and the primary task framing.
- **Headline** (600, 22px, 1.2): major analysis or decision surfaces.
- **Title** (600, 18px, 1.25): panel, table, and rail headings.
- **Body** (400, 14px, 1.55): explanations, decision context, and instructions; cap prose near 70ch.
- **Label** (600, 11px, 0.06em tracking): compact metadata and table headings where scanning benefits from it.

**The Evidence-First Type Rule.** Use strong type to identify decisions and financial values, not to give every panel a headline. Keep normal explanatory text readable at 14px or higher.

## Elevation

Zenin relies on tonal layering and one-pixel borders for normal depth. Shadows are reserved for temporary, elevated states such as menus, dialogs, and drawers; they are not a default card decoration.

### Shadow Vocabulary

- **Surface Detail** (`0 1px 2px rgba(0, 0, 0, 0.32)`): a restrained local lift for compact interactive elements.
- **Overlay** (`0 6px 14px rgba(0, 0, 0, 0.44)`): menus and controlled transient layers.
- **Modal** (`0 24px 64px rgba(0, 0, 0, 0.62)`): dialogs and primary overlays only.

**The Flat-By-Default Rule.** Cards and sections communicate grouping with surface tone, border, and spacing. Shadow signals a layer that has left the page plane.

## Components

### Buttons

- **Shape:** square-leaning `4px` corners; 40px standard height and 44px touch height on mobile.
- **Primary:** Ledger White fill with Decision Black text; use for one clear action in a local decision context.
- **Hover / Focus:** transition within 120ms; focus uses a visible 2px white ring with offset.
- **Secondary / Ghost:** Raised Surface with a structural border, or transparent when the action is subordinate.

### Chips

- **Style:** compact, low-radius labels with a border or semantic surface tint.
- **State:** selected controls can use the neutral selected surface; semantic chips retain an icon or explicit text alongside color.

### Cards / Containers

- **Corner Style:** `4px` standard radius; use `8px` only for larger, self-contained modules.
- **Background:** Ledger Surface or the subtle row surface; avoid stacking card inside card without a clear interaction boundary.
- **Shadow Strategy:** flat at rest; reference Elevation for overlays.
- **Border:** 1px Structural Border or a semantic 1px border when state is relevant.
- **Internal Padding:** 16–24px for standard panels; use open sections and dividers before adding a new container.

### Inputs / Fields

- **Style:** Raised Surface, 1px Structural Border, `4px` corners, 40px standard height.
- **Focus:** white 2px visible ring; never rely on color shift alone.
- **Error / Disabled:** error retains text and semantic color; disabled uses muted text and reduced opacity without removing the label.

### Navigation

- **Style:** a persistent desktop rail and mobile drawer; active destinations invert to white with dark text.
- **State:** the mobile bottom navigation is mobile-only. Tabs scroll horizontally on small screens rather than compressing into equal-width controls.

### Workspace Primitives

- **Page Header:** title, concise context, freshness/status, and one clear primary action.
- **Metric Strip:** inline responsive measures with one featured metric instead of repeated KPI-card grids.
- **Attention List:** ranked, semantic actionable signals; secondary triage stays visually subordinate.
- **Context Rail:** secondary risk, freshness, help, or saved context at wide layouts; ordered disclosure after primary content on mobile.

## Do's and Don'ts

### Do:

- **Do** keep the decision path visible: context first, analysis next, and a route into journaling or review where appropriate.
- **Do** use `#10B981`, `#EF4444`, and `#F59E0B` only for clear financial or operational meaning.
- **Do** use the `2px / 4px / 8px / 12px / 16px` radius scale and the 4px spacing scale.
- **Do** preserve dark/light theme parity, clear focus treatment, keyboard access, and text labels alongside semantic color.
- **Do** use wider workspace columns before adding empty margin on large screens.

### Don't:

- **Don't** make Zenin resemble a decorative crypto dashboard with glow, ornamental charts, or speculative visual effects.
- **Don't** add colored side stripes thicker than 1px; use a semantic surface, full border, icon, and label instead.
- **Don't** turn every metric or section into an equal-weight card.
- **Don't** use color as decoration for inactive controls or ordinary content.
- **Don't** animate layout properties or gate content visibility behind motion.
