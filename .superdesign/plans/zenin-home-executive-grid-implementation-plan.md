# Zenin Home Executive Grid Implementation Plan

## Source

- Project ID: `1db5c01c-f7bb-495d-84dc-642d46114698`
- Draft ID: `5fc774a5-00d9-4e20-95f1-9a5b1b017976`
- Draft title: `Zenin Capital Home - Executive Grid (Refined)`
- Fetch method: `superdesign get-design --draft-id 5fc774a5-00d9-4e20-95f1-9a5b1b017976 --json`

## What was fetched

The imported Superdesign draft is a dark authenticated workstation layout with:

1. a compact terminal-style shell
2. a portfolio overview header
3. a dominant portfolio-value hero
4. a narrow executive stat rail
5. an operational triage strip
6. a refined performance chart block
7. a compact execution log table
8. a top-holdings list
9. an allocation ring with warning copy

The draft uses:

- near-black background `#0a0e1a`
- charcoal surfaces around `#14191f` and `#1a1f2e`
- very thin borders
- restrained cyan accent
- mono-heavy numeric treatment
- compact uppercase labels and terminal-style metadata

## Implementation position

This should be implemented as a redesign of the authenticated `/app` Home section, not as a route rewrite and not as a public-site influence.

Primary targets in this repo:

- Shell owner: [frontend/src/App.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/App.jsx:4107)
- Home page owner: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:1995)
- Shared authenticated app styles: [frontend/src/styles.css](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/styles.css:15123)

## Current repo status

As of `2026-05-13`, the repo already contains a substantial first-pass implementation of this draft:

- `HomeModule.jsx` already renders a `home-exec` dashboard shell with a hero, stat rail, triage strip, performance panel, execution log, holdings, allocation, and market context sections.
- `styles.css` already contains a dedicated `home-exec-*` namespace for the imported executive-grid language.
- `App.jsx` already widens the authenticated shell for Home and Portfolio and keeps the shared sidebar as the source of truth.

That means the remaining work is not a greenfield build. It is a refinement pass with three goals:

1. tighten visual fidelity to the fetched Superdesign draft
2. reduce drift between the Home executive grid and the current shell/sidebar language
3. avoid reintroducing legacy `home-v2-*` and `home-v3-*` styling patterns into new work

Recommended implementation stance from here:

- treat the fetched draft as the visual reference for `/app` Home only
- keep the sidebar and app routing owned by `App.jsx`
- make layout and polish changes inside `HomeModule.jsx` and `home-exec-*` selectors first
- only expand into Portfolio or other sections after Home is visually locked

## Non-goals

- Do not redesign the public homepage.
- Do not replace the current sidebar information architecture.
- Do not rebuild the app shell into a second nested shell inside Home.
- Do not block implementation on advanced risk metrics that the frontend does not yet model.
- Do not keep extending the legacy `home-v2-*` and `home-v3-*` selectors as the long-term structure.

## Hard constraints from codebase + draft

### Sidebar

The fetched draft contains its own conceptual sidebar, but this repo already has a newer app sidebar that should remain the source of truth:

- overview card: [frontend/src/App.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/App.jsx:4125)
- navigation stack: [frontend/src/App.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/App.jsx:4148)
- live status and utility zone: [frontend/src/App.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/App.jsx:4190)

Implementation rule:

- keep the current sidebar structure and behavior
- only tune shell spacing or visual adjacency if needed
- borrow tone from the sidebar, not the sidebar layout from the draft

### Existing Home data that should be reused

Current Home already exposes the core data needed for the draft:

- page header and actions: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:1995)
- hero value, PnL, buying power, total gain/loss, day range: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2011)
- action center: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2054)
- performance chart and chart insights: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2094)
- top holdings: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2142)
- allocation panel: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2194)
- recent activity: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2249)
- market context: [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2280)

## Draft-to-current mapping

### 1. Header

Draft asks for:

- `PORTFOLIO` eyebrow
- `Portfolio Overview`
- institutional supporting copy
- sync timestamp
- actions: Saved Items, Refresh, Save View

Current mapping:

- already present in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:1995)

Implementation action:

- keep the current header actions and behavior
- tighten typography, spacing, and metadata treatment to match the imported draft
- consider renaming the timestamp label to a terminal-like sync label without changing the underlying source

### 2. Executive hero

Draft asks for:

- total portfolio value
- timeframe strip
- today PnL
- total gain/loss
- buying power
- day-range micro-visual

Current mapping:

- already present in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2011)

Implementation action:

- restructure into a 9-column hero + 3-column stat rail composition
- keep current timeframe buttons and values
- convert the current hero from a rounded “dashboard card” feel into a flatter terminal panel
- replace the current day-range text emphasis with a more compact indicator treatment if possible

### 3. Stat rail

Draft asks for:

- beta weight
- theta
- buying power percentage
- implied volatility
- health badge

Current mapping:

- not all of these are native Home metrics today

Implementation action:

- Phase 1 rail:
  - use only trustworthy, already available values or straightforward derivations
  - candidate replacements: cash weight, positions count, watchlist count, active alerts, current drawdown
- Phase 2 rail:
  - add deeper risk metrics only if backed by real data models

Guardrail:

- never show fake financial metrics as if they are real portfolio analytics

### 4. Operational triage strip

Draft asks for:

- three horizontally aligned alert cards
- compact severity badges
- snooze/dismiss affordances
- direct response CTA

Current mapping:

- present in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2054)

Implementation action:

- preserve current card behavior
- compress layout to a true triage strip
- reduce card softness and visual padding
- use thinner left-edge signal bars and more operational copy styling

### 5. Performance curve

Draft asks for:

- tighter chart heading
- chart/stat toggle
- cleaner reference legend
- terminal-style bottom axis labels
- best/worst/max DD/current DD block

Current mapping:

- current chart + insights exist in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2094)

Implementation action:

- retain `TradingViewChart`
- redesign surrounding chrome only
- add a draft-inspired legend row and tighter metadata band
- keep the existing interval toggles; restyle them into terminal chips

### 6. Execution log

Draft asks for:

- a compact recent-activity table
- timestamp, asset, instruction, notional, status

Current mapping:

- recent activity currently renders as rows/cards in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2249)

Implementation action:

- convert recent activity from card rows into a compact table-like execution log
- preserve click behavior into activity detail
- limit columns to what the current data can safely support

Potential column mapping:

- timestamp -> `row.when`
- asset -> `row.symbol`
- instruction -> `row.action`
- notional -> `row.value`
- status -> `row.status`

### 7. Key positions

Draft asks for:

- a tighter top-holdings list with value + weight bars

Current mapping:

- current top holdings exist in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2142)

Implementation action:

- keep ranked holdings
- tighten row spacing
- simplify the row to symbol, value, weight bar, and perhaps daily change or concentration state
- keep detail drawer interaction

### 8. Allocation panel

Draft asks for:

- ring chart
- compact legend
- warning note when concentration exceeds target

Current mapping:

- current allocation panel already exists in [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:2194)

Implementation action:

- keep current donut/chart basis
- switch labeling and card hierarchy toward the draft
- rewrite legend rhythm to feel more terminal and less consumer-analytics
- keep the warning state pattern already present

## Recommended implementation architecture

### Component strategy

Do not split everything into many new files on pass one.

Preferred approach:

1. keep the main redesign inside `HomeModule.jsx`
2. extract only the densest repeated regions if readability suffers

Best candidates if extraction becomes necessary:

- `ExecutiveHeroPanel`
- `ExecutiveStatRail`
- `OperationalTriageStrip`
- `ExecutionLogTable`
- `TopHoldingsPanel`
- `AllocationDonutPanel`

These align with `.superdesign/init/extractable-components.md`.

### CSS strategy

The current Home CSS is already heavily layered. The safest path is a fresh namespace.

Recommended namespace:

- `home-exec-*`

Do:

- add one contiguous executive-grid section in [frontend/src/styles.css](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/styles.css)
- keep selectors local to Home
- create bridge selectors only where current shared button or panel styles are intentionally reused

Avoid:

- patching dozens of existing `home-v2-*` / `home-v3-*` rules in place
- introducing draft-specific Tailwind-like class strings into JSX

## Build phases

### Phase 1: shell-safe layout rewrite

Files:

- [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx:1995)
- [frontend/src/styles.css](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/styles.css:15123)

Tasks:

1. add a new top-level `home-exec` wrapper inside Home
2. replace the current hero + top grid with:
   - executive header
   - hero command panel
   - stat rail
3. convert Action Center into a denser triage strip
4. convert Recent Activity into an execution-log table
5. keep Top Holdings and Allocation but restyle them to match the draft

Success criteria:

- desktop layout reads like the imported draft
- current Home interactions still work

### Phase 2: shell alignment

Files:

- [frontend/src/App.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/App.jsx:4107)
- [frontend/src/styles.css](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/styles.css:965)

Tasks:

1. verify Home content width against the current sidebar proportions
2. adjust main content padding or max width only if the draft needs a wider workstation canvas
3. keep sidebar structure untouched

Success criteria:

- Home feels visually adjacent to the sidebar
- no shell regressions in other sections

### Phase 3: metric hardening

Files:

- [frontend/src/components/HomeModule.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/HomeModule.jsx)

Tasks:

1. audit executive stat-rail values
2. derive safe values where simple
3. hide unsupported rows behind guards
4. make guest mode and missing-data mode degrade cleanly

### Phase 4: optional polish

Files:

- [frontend/src/components/TradingViewChart.jsx](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/components/TradingViewChart.jsx)
- [frontend/src/styles.css](/Users/jeremiahkamama/Desktop/zenin/zenin/frontend/src/styles.css)

Tasks:

1. refine legend treatment if needed
2. add more terminal-style chart chrome
3. improve hover/focus states to match the command-deck language

## Data and behavior decisions

### Keep

- saved items drawer flow
- refresh behavior
- save view behavior
- attention-card snooze and dismiss actions
- holding detail drawer
- activity detail drawer
- market context module, even if it shifts lower in the visual hierarchy

### Change

- visual framing of hero
- recent activity representation
- holdings density
- panel borders, radius, and spacing rhythm

### Defer

- true beta/theta/IV risk engine for Home
- major sidebar redesign
- a second shell-specific sync system

## Suggested file-by-file task list

### `frontend/src/components/HomeModule.jsx`

- introduce `home-exec` markup structure
- reorganize the top of the page into draft-aligned regions
- convert recent activity list into execution-log structure
- remap current metrics into stat rail
- keep existing modal and drawer behavior intact

### `frontend/src/styles.css`

- add `home-exec-page-header`
- add `home-exec-hero`
- add `home-exec-stat-rail`
- add `home-exec-triage-strip`
- add `home-exec-performance-panel`
- add `home-exec-execution-log`
- add `home-exec-holdings-panel`
- add `home-exec-allocation-panel`
- add responsive stack rules for tablet and mobile

### `frontend/src/App.jsx`

- only adjust shell spacing if necessary
- do not alter nav logic or section grouping

## Risks

### 1. CSS collision risk

`styles.css` already has repeated Home overrides.

Mitigation:

- isolate the new build with `home-exec-*`
- keep all executive-grid rules grouped in one band

### 2. Visual drift from the actual imported draft

The repo already has many “premium dashboard” patterns that can pull the implementation back toward the old look.

Mitigation:

- follow the fetched HTML structure, not memory of the mockup
- prioritize border rhythm, density, uppercase metadata, and mono values

### 3. Fake-metric risk

The imported draft shows advanced finance metrics the current Home data model may not support.

Mitigation:

- substitute only honest metrics
- hide unsupported rail items instead of faking them

### 4. Scope creep from Home into Portfolio

The draft’s language may tempt reuse across other modules immediately.

Mitigation:

- land Home first
- use it as the reference before expanding to Portfolio

## Verification plan

### Functional

- load `/app` signed in
- load `/app` in guest mode
- verify Saved Items, Refresh, Save View still work
- verify triage interactions still work
- verify holding and activity detail drawers still open

### Visual

- compare against the fetched Superdesign layout
- confirm the Home page feels terminal-like and more institutional
- confirm the sidebar still feels like the same product and was not visually replaced

### Responsive

- desktop: full executive grid
- tablet: stat rail collapses below hero
- mobile: panels stack without unreadable compression

### Regression

- Portfolio, Watchlist, Analytics, Options, Journal, and Tax sections unchanged
- light theme either remains acceptable or is explicitly handled as a secondary pass

## Recommended build order

1. rewrite Home JSX structure
2. add new `home-exec-*` CSS
3. convert recent activity to execution-log presentation
4. remap real metrics into stat rail
5. tune shell spacing if required
6. run visual verification against the imported draft

## Definition of done

The implementation is done when:

- `/app` Home clearly matches the imported `Executive Grid (Refined)` direction
- the current sidebar remains structurally intact
- current Home interactions still function
- unsupported advanced metrics degrade gracefully
- the redesign is isolated enough that the rest of the app does not regress
