# Brand.md v2

## Purpose

This document is the single source of truth for Zenin's design system.

## Product Philosophy

-   Monochrome-first
-   Desktop-first
-   Institutional trading workspace
-   Information density over decoration
-   Color communicates meaning only

## Technology Stack

-   shadcn/ui
-   Radix UI via shadcn
-   Tailwind CSS
-   TanStack Table + TanStack Virtual
-   TradingView Lightweight Charts

## Design Tokens

Use semantic tokens only for colors, spacing, typography, radii, shadows
and motion.

## Component Rules

Reuse shared components before creating new ones.

## Buttons

Primary, Secondary, Ghost and Destructive variants. No cyan. No
gradients. Hover through subtle elevation only.

## Layout

Workspace should use approximately 88--92% of available width on 1920px
displays.

## Light & Dark Mode

Geometry and hierarchy stay identical. Only semantic tokens change.

## AI Implementation Rules

-   Radix → shadcn/ui → Zenin shared components → Feature pages.
-   No page-specific styling.
-   No hardcoded colors.
-   Reuse before creation.
-   TanStack Table + Virtual for data-heavy screens.
-   TradingView Lightweight Charts for trading charts.

## AI Acceptance Criteria

A UI task is complete only when: - Shared components are reused. - No
duplicate UI exists. - Light/dark mode both work. - Build passes. -
Visual output matches Brand.md.
