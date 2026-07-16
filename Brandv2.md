# Zenin Brand System v2

Status: Active. This document is the canonical design reference for Zenin.

Zenin is a premium investment intelligence workspace for serious individual investors. The interface should feel precise, calm, confident, institutional, efficient, and timeless.

## 1. Product principles

- Purpose: every element must help users understand markets, evaluate risk, research assets, or make decisions.
- Hierarchy: make the primary insight and next action more visible than supporting evidence and diagnostics.
- Simplicity: show the common path first; put advanced tools behind disclosure.
- Responsibility: expose source, timestamp, freshness, confidence, affected assets, and assumptions for important insights.
- Agency: users should always know where they are, what changed, what they can do, and how to exit or undo.
- Craft: spacing, alignment, iconography, states, and motion must be deliberate and consistent.

## 2. Visual language

Zenin is monochrome-first. Use neutral surfaces, white primary text, gray secondary text, subtle borders, restrained elevation, and meaningful motion.

Avoid neon, gradients, glow effects, decorative illustrations, excessive glassmorphism, heavy shadows, random accents, and repeated card containers.

### Surfaces

```css
--color-bg-base: #0A0A0A;
--color-surface-depth: #0A0A0A;
--color-surface-card: #111111;
--color-surface-card-strong: #141414;
--color-surface-elevated: #171717;
--color-surface-hover: rgba(255, 255, 255, 0.04);
--color-surface-overlay: rgba(10, 10, 10, 0.92);
```

Use base for the page, card for grouped content, elevated for focused content, and overlay for dialogs, drawers, and popovers. Prefer spacing and dividers when elevation does not communicate real hierarchy.

### Color

```css
--color-text-primary: #FFFFFF;
--color-text-secondary: #A3A3A3;
--color-text-muted: #737373;
--color-text-dim: #525252;
--color-border-subtle: rgba(255, 255, 255, 0.06);
--color-border-medium: #262626;
--color-border-strong: #404040;
--color-interactive: #FFFFFF;
--color-interactive-hover: #E5E5E5;
--color-interactive-soft: rgba(255, 255, 255, 0.08);
--color-selected: rgba(255, 255, 255, 0.08);
--color-selected-strong: rgba(255, 255, 255, 0.12);
--color-focus: #FFFFFF;
```

Semantic colors are allowed only for meaning:

```css
--color-success: #10B981;
--color-danger: #EF4444;
--color-warning: #F59E0B;
```

Do not use cyan, purple, teal, neon blue, or gradients for new UI.

## 3. Typography

```css
--font-brand: "Geist", "Inter", -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Use the brand font for headings, navigation, body copy, and buttons. Use the mono font for tickers, prices, percentages, dates, times, confidence values, and technical identifiers.

Typography hierarchy must use size, weight, leading, tracking, and alignment before color. Large headings use tighter tracking. Small metadata may use slight positive tracking. Do not use uppercase labels for every section.

```css
.page-title {
  font-size: clamp(1.5rem, 2vw, 2rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-weight: 600;
}

.section-title { font-size: 1rem; line-height: 1.25; font-weight: 600; }

.meta-label {
  font-size: 0.6875rem;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
```

## 4. Spacing, shape, and elevation

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;

--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 12px;
```

Use 8-12px spacing for dense controls, 16-24px card padding, and 24-40px between major sections. Use borders before shadows. Shadows are reserved for overlays, popovers, modals, and drawers.

## 5. Components

Reuse shared components before creating new ones. Prefer existing Zenin primitives, then existing design-system primitives, then reusable new components. Page-specific styling is a last resort.

Buttons support Primary, Secondary, Ghost, and Destructive variants. Labels must be short and must not wrap on desktop. Every button needs hover, active, focus, disabled, loading, success, and error states.

Use cards only when they communicate grouping or elevation. Avoid six identical cards, nested identical cards, and borders around every small element.

Tables should use aligned numeric columns, mono numerics, subtle row separators, responsive overflow or stacked mobile rows, and explicit loading, empty, and error states.

Every empty state must explain why it is empty, what the user can do, and what will appear afterward.

## 6. Motion and interaction

Motion communicates feedback, hierarchy, state change, spatial continuity, or completion. Do not animate for decoration.

Default UI spring:

```js
const defaultSpring = {
  type: "spring",
  bounce: 0,
  duration: 0.35
};
```

Use slight bounce only for drag release, flick gestures, momentum interactions, and physical sheets. Respond on pointer-down. Keep drag interactions one-to-one with the pointer. Use pointer capture, preserve release velocity, animate from the current visual value, and allow transitions to be interrupted.

Animate only `transform` and `opacity` where possible. Enter and exit along the same spatial path.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 120ms !important;
    scroll-behavior: auto !important;
  }
}
```

Reduced motion replaces slides and springs with short opacity or color transitions.

## 7. Responsive behavior

Desktop-first does not mean desktop-only.

- Desktop: use approximately 88-92% of available width on large screens and keep primary actions visible.
- Tablet: collapse secondary rails and reduce side-by-side panels while preserving the primary workflow.
- Mobile: use a single column, avoid horizontal page overflow, use minimum 44px touch targets, move advanced controls into disclosures or sheets, and replace wide tables with scrolling or stacked rows.
- Do not simply shrink desktop layouts. Compose the mobile hierarchy intentionally.

Light and dark themes must preserve geometry and hierarchy. Only semantic tokens change.

## 8. Accessibility

Every component must support keyboard navigation, visible focus states, semantic buttons and headings, screen-reader labels, 44px minimum touch targets, WCAG AA contrast, text scaling, reduced motion, reduced transparency, and high-contrast preferences.

Never use color as the only indicator of profit/loss, severity, selection, availability, error, or connection state.

## 9. Data trust

Investment interfaces must expose uncertainty. Show data source, last updated time, delayed or stale state, confidence, estimated values, missing providers, and recovery guidance where relevant.

Never display fabricated metrics, fake precision, or hardcoded live states.

## 10. Light and dark mode

Geometry, spacing, component states, and hierarchy remain the same in both themes. Only semantic surface, border, text, and interaction tokens change.

Every new component must be inspected in both themes before completion. Do not leave dark-only hardcoded backgrounds or text colors in feature styles.

## 11. Layout rules

Use hierarchy instead of uniform card grids. A typical workspace should prioritize:

1. Primary insight
2. Primary action
3. Affected assets or evidence
4. Supporting timeline or analysis
5. Diagnostics and source details

Do not give every section identical borders, padding, radius, and visual weight.

## 12. Implementation rules for coding agents

- Use semantic CSS variables instead of hardcoded colors.
- Preserve existing routes, analytics events, form field names, and data contracts.
- Do not create duplicate components for the same interaction.
- Reuse existing loading, empty, error, and button patterns.
- Use TanStack Table and TanStack Virtual for data-heavy screens.
- Use TradingView Lightweight Charts for trading charts.
- Keep motion isolated and clean up effects.
- Do not introduce a second design language inside a feature.
- Test desktop, tablet, mobile, light theme, dark theme, keyboard navigation, and reduced motion.

## 13. Design review checklist

Before completing a UI task, verify:

- The primary user action is obvious.
- The most important information has the strongest hierarchy.
- No unnecessary cards or borders were added.
- No duplicate component or interaction was created.
- Colors communicate meaning only.
- Typography follows this document.
- Numeric data uses the mono font.
- Light and dark themes both work.
- Mobile does not overflow horizontally.
- Interactive elements have complete states.
- Reduced motion is supported.
- Data freshness and sources are visible.
- No fabricated values or fake live states exist.
- The build passes.
- The interface was inspected at desktop and mobile widths.

## 14. Canonical source

`Brandv2.md` is the canonical design source for new work. If another brand document conflicts with this file, resolve the conflict here first and then update the other document or mark it deprecated.
