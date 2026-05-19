# Zenin Options Executive Grid Implementation Plan

## Source

- Project ID: `1db5c01c-f7bb-495d-84dc-642d46114698`
- Draft ID: `8bdabff9-e0cf-4d82-9a20-ff79b31d7124`
- Draft title: `Zenin Capital Options - Executive Grid`
- Preview: `https://p.superdesign.dev/draft/8bdabff9-e0cf-4d82-9a20-ff79b31d7124`
- Screenshot: `https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/screenshots/drafts/8bdabff9-e0cf-4d82-9a20-ff79b31d7124/1778649879960.png`

## Executive Summary

The fetched Superdesign draft is an authenticated `/app` Options page redesign. It should be implemented as an executive-grid restyle of the existing options workspace, not as a new route or a replacement of the app shell.

The best implementation path is:

1. preserve the current `App.jsx` navigation and Options route behavior
2. restructure `OptionsModule.jsx` into a compact executive options canvas
3. keep the live strategy simulator, Greeks context, option chain, whale flow, and calculator data flows intact
4. add a dedicated `options-exec-*` CSS namespace in `styles.css`
5. selectively extract dense panels only where readability improves

## What The Draft Is Asking For

The draft applies the Executive Grid system to the Options page:

- terminal-style sidebar and sticky section header
- compact top metric grid for implied volatility, put/call ratio, market skew, and session status
- strategy simulator panel with view, horizon, and suggested-strategy workflow
- Greeks and volatility context panel
- BTC option chain panel
- whale options trades table
- calculator side rail with symbol and strategy presets
- multi-leg position editor
- P&L diagram panel

## Best Codebase Mapping

### App Shell

- File: `frontend/src/App.jsx`
- Responsibility:
  - keep current section switching and sidebar state
  - avoid a route rewrite
  - optionally add a small Options-specific page-shell class if the executive grid needs tighter canvas spacing

### Options Workspace

- File: `frontend/src/components/OptionsModule.jsx`
- Responsibility:
  - main implementation target
  - reorganize the current stacked panels into the draft's executive-grid order
  - preserve existing fetch, cache, pagination, chain filtering, stale-state, and active-trade behavior

### Strategy Simulator

- File: `frontend/src/components/OptionsStrategySimulator.jsx`
- Responsibility:
  - retain existing view and horizon interactions
  - restyle choice buttons and table details to match the draft
  - reduce inline styles as part of the new `options-exec-*` styling pass

### Calculator

- File: `frontend/src/components/OptionsCalculator.jsx`
- Responsibility:
  - already owns the symbol rail, strategy presets, position legs, saved calculations, and P&L diagram
  - restyle into the draft's two-column calculator block
  - keep TradingView payoff chart unless the design requires replacing it with the draft's simpler SVG treatment

### Styling

- File: `frontend/src/styles.css`
- Responsibility:
  - add a contiguous `options-exec-*` section
  - bridge existing selectors only where needed
  - avoid continuing to layer broad `.watchlist-panel`, `.glass`, and `.option-chain-table` overrides

## Existing Data That Maps Cleanly

- `metrics.iv` -> Implied Volatility
- `metrics.pcr` -> Put/Call Ratio
- `metrics.skew` -> Market Skew
- `marketStructureLabel` / active asset set -> Session Status and orderbook/chain tags
- `activeAsset`, `allAssets`, `availableExpiries`, `chain` -> simulator and option chain panels
- `displayGreeks` -> Greeks & Volatility Context cards
- `termStructureRows` -> Volatility Term Structure mini panel
- `filteredChain` -> IV / OI heatmap and option chain
- `pagedWhaleTrades` -> Whale Options Trades table
- `spotPrices`, `spotSources`, `activeAsset` -> calculator symbol panel
- `OptionsCalculator` totals -> position-leg metrics and P&L panel

## Likely Data Gaps

These draft values are either mocked in the design or not consistently available:

- true session status beyond current market-structure labels
- robust market skew when IV is unavailable
- open-flow summary across BTC / ETH / SOL
- full IV / OI heatmap when open interest is missing from chain rows
- exact P&L SVG annotations if using the existing TradingView chart

Recommended handling:

1. show real values where already available
2. use conservative fallback labels such as `Unavailable`, `Syncing`, or `RFQ market`
3. hide micro-visualizations when source rows are empty
4. avoid inventing derivatives metrics in the frontend

## Implementation Phases

### Phase 1: Options Layout Restructure

In `OptionsModule.jsx`, introduce a top-level executive namespace:

- `options-exec`
- `options-exec-metrics`
- `options-exec-panel`
- `options-exec-panel-head`
- `options-exec-table`
- `options-exec-calculator-grid`

Target order:

1. metric grid
2. strategy simulator
3. Greeks and volatility context
4. option chain
5. whale options trades
6. calculator / position editor
7. P&L diagram

Keep logic in place during the first pass. Move JSX and class names first, then polish.

### Phase 2: Panel Extraction

Extract only the densest presentational blocks if the first pass makes `OptionsModule.jsx` harder to work with.

Good candidates:

- `OptionsMetricGrid`
- `OptionsGreekContextPanel`
- `OptionsChainPanel`
- `WhaleOptionsTradesPanel`

Avoid extracting data-fetching or state ownership yet. The state graph is already centralized in `OptionsModule.jsx`, and splitting it prematurely would raise regression risk.

### Phase 3: Strategy Simulator Restyle

In `OptionsStrategySimulator.jsx`:

- keep `VIEWS`, `TIME_HORIZONS`, strategy filtering, and execution behavior unchanged
- replace inline grid/card styling with class names
- make choice buttons square, compact, and cyan-accented as in the draft
- make the suggested-strategy table match the same compact table language as the whale and chain tables

### Phase 4: Calculator Restyle

In `OptionsCalculator.jsx`:

- keep calculation logic, saved calculations, and chart wiring
- restyle the symbol card and strategy preset card into the left rail shown in the draft
- restyle leg cards with smaller radius, sharper borders, and denser spacing
- keep existing `TradingViewChart` for the P&L diagram unless visual verification shows it cannot match the draft well enough

### Phase 5: CSS System Pass

In `styles.css`:

- add a grouped section for the Executive Options Grid
- define local tokens under `.options-exec`
- use near-black surfaces, charcoal cards, thin borders, cyan accents, compact uppercase labels, and JetBrains-style numeric rhythm where already supported
- keep card radius at `2px` to `6px` for this page
- keep the design dark-first; preserve light theme only to the extent current app behavior requires it

## Risks

### Inline Style Risk

The Options modules currently contain many inline styles. A visual refactor that only adds CSS on top may be brittle.

Mitigation:

- convert the most repeated inline surfaces to class names during the redesign
- leave isolated one-off dynamic styles alone until they block fidelity

### Large CSS Risk

`frontend/src/styles.css` is over 18,000 lines and contains many broad panel/table rules.

Mitigation:

- keep new rules namespaced under `.options-exec`
- avoid broad changes to `.watchlist-panel`, `.glass`, `.table-scroll`, or `.option-chain-table`
- place the new CSS in one contiguous section

### Functional Regression Risk

The page has live fetches, cached fallbacks, whale pagination, active trade syncing, expiry selection, and calculator persistence.

Mitigation:

- change structure and classes without rewriting data logic
- verify empty, loading, stale, and populated states
- keep clickable chain, heatmap, term structure, and whale row behaviors

## Verification Plan

### Functional

- load `/app` and switch to Options
- verify chain data fetches or gracefully shows fallback state
- switch `BTC`, `ETH`, `SOL`, and `HYPE`
- change expiry tabs and strike-window filter
- choose a simulator view and horizon
- select and execute a strategy into active options trades
- paginate whale trades
- edit calculator legs and save/view calculations when signed in

### Visual

- compare desktop proportions against the Superdesign preview
- verify metric cards, simulator, chain, whale table, calculator, and P&L diagram share the same Executive Grid language
- confirm dense typography remains legible
- confirm no table text or buttons overflow at laptop widths

### Responsive

- desktop: `1440px+`
- laptop: `1280px`
- tablet: `768px`
- mobile: `390px`

Expected behavior:

- top metric grid collapses from four columns to two, then one
- option chain and whale tables remain horizontally scrollable
- calculator rail stacks above the position editor
- sticky app/sidebar behavior remains unchanged

### Regression

- verify Portfolio, Home, Watchlist, Analytics, Journal, and Tax Estimator still render
- verify guest mode does not break the Options page
- run `npm run build:frontend`

## Recommended Build Order

1. create the `options-exec` wrapper and metric grid in `OptionsModule.jsx`
2. restyle the existing strategy simulator container without changing its state logic
3. convert Greeks, chain, and whale panels to `options-exec-panel`
4. align `OptionsCalculator.jsx` to the left-rail plus position-editor layout
5. add namespaced CSS in `styles.css`
6. run build and browser verification

## Definition Of Done

The implementation is successful when:

- the `/app` Options page visually matches the Executive Grid direction from draft `8bdabff9-e0cf-4d82-9a20-ff79b31d7124`
- existing options data flows and simulator/calculator interactions still work
- missing live data degrades gracefully
- the new styling is isolated enough that other app modules do not regress
