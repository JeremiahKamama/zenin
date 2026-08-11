# Desktop Layout Optimization Plan

**Objective:** Transform Zenin from a centered marketing-style layout to a professional desktop workspace that expands gracefully up to 1800-1920px, optimized for 27" and ultrawide monitors.

---

## Current State Analysis

### Constraints Identified

1. **`.app-layout`** (styles.css:893-902)
   - `max-width: 1400px` - primary content bottleneck
   - `margin: 0 auto` - forces centering
   - `padding: 24px` - fixed horizontal padding

2. **Module-level containers**
   - `.view-container` - no max-width, but constrained by parent
   - Various modals and panels have fixed max-widths (appropriate to keep)

3. **Grid systems**
   - `.home-v2-main-grid` - collapses at 1500px
   - `.portfolio-v2-main-grid` - collapses at 1024px
   - `.metrics-grid` - collapses at 1400px

### Breakpoints Currently Used

- 960px: Sidebar collapse, mobile layout
- 1024px: Portfolio grid collapse
- 1280px: Home hero collapse
- 1400px: Metrics grid collapse
- 1500px: Home main grid collapse

---

## Proposed Layout System

### Viewport-Based Expansion Strategy

```
Viewport Width          Content Width        Horizontal Padding
─────────────────────────────────────────────────────────────
< 960px                  100%                 12px (mobile)
960px - 1280px           100%                 16px
1280px - 1600px          100%                 24px
1600px - 1920px          100%                 32px
> 1920px                 100%                 clamp(32px, 4vw, 64px)
```

### New CSS Variables

```css
:root {
  --workspace-min-width: 960px;
  --workspace-max-width: none; /* Remove fixed max-width */
  --workspace-padding-x: clamp(16px, 2vw, 64px);
  --workspace-content-max: 1920px; /* Soft max, not hard constraint */
}
```

---

## Implementation Phases

### Phase 1: Core Layout Shell (styles.css)

**1.1 Update `.app-layout`**
```css
.app-layout {
  padding: 0 var(--workspace-padding-x);
  max-width: none; /* Remove 1400px constraint */
  margin: 0;
  display: flex;
  gap: 32px;
  min-height: 100vh;
  position: relative;
}

/* Optional: Soft max for ultra-wide screens */
@media (min-width: 2560px) {
  .app-layout {
    max-width: 2400px;
    margin: 0 auto;
  }
}
```

**1.2 Update responsive padding**
```css
@media (max-width: 960px) {
  .app-layout {
    padding: 0 12px;
    gap: 16px;
  }
}

@media (min-width: 1280px) {
  .app-layout {
    padding: 0 24px;
  }
}

@media (min-width: 1600px) {
  .app-layout {
    padding: 0 32px;
  }
}

@media (min-width: 1920px) {
  .app-layout {
    padding: 0 clamp(32px, 4vw, 64px);
  }
}
```

**1.3 Update sidebar positioning**
```css
.sidebar {
  position: sticky;
  top: 24px;
  height: calc(100vh - 48px);
  /* Keep width at 270px (expanded) / 86px (collapsed) */
}

@media (min-width: 1920px) {
  .sidebar {
    /* Optional: slightly wider sidebar on ultra-wide */
    width: 300px;
  }
  .sidebar.collapsed {
    width: 96px;
  }
}
```

---

### Phase 2: Module Grid Systems

**2.1 HomeModule grid expansion**
```css
.home-v2-main-grid {
  grid-template-columns: minmax(0, 1.8fr) minmax(320px, 1fr);
  gap: 24px;
}

@media (min-width: 1600px) {
  .home-v2-main-grid {
    grid-template-columns: minmax(0, 2fr) minmax(380px, 1fr);
    gap: 32px;
  }
}

@media (min-width: 1920px) {
  .home-v2-main-grid {
    grid-template-columns: minmax(0, 2.2fr) minmax(420px, 1fr);
    gap: 40px;
  }
}
```

**2.2 PortfolioModule grid expansion**
```css
.portfolio-v2-main-grid {
  grid-template-columns: minmax(0, 1.6fr) minmax(380px, 1fr);
  gap: 24px;
}

@media (min-width: 1600px) {
  .portfolio-v2-main-grid {
    grid-template-columns: minmax(0, 1.8fr) minmax(440px, 1fr);
    gap: 32px;
  }
}

@media (min-width: 1920px) {
  .portfolio-v2-main-grid {
    grid-template-columns: minmax(0, 2fr) minmax(500px, 1fr);
    gap: 40px;
  }
}
```

**2.3 Metrics/Analytics grid expansion**
```css
.metrics-grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

@media (min-width: 1600px) {
  .metrics-grid.three {
    gap: 24px;
  }
}

@media (min-width: 1920px) {
  .metrics-grid.three {
    gap: 32px;
  }
}
```

---

### Phase 3: Chart and Table Width Optimization

**3.1 TradingViewChart responsive sizing**
```css
.tradingview-chart-shell {
  width: 100%;
  min-width: 0; /* Allow flex shrinking */
}

/* Charts grow with container, no max-width constraint */
```

**3.2 DataTable responsive behavior**
```css
/* Already responsive via virtual scrolling */
/* Ensure container allows full width utilization */
.data-table-container {
  width: 100%;
  min-width: 0;
}

@media (min-width: 1600px) {
  .data-table-container {
    /* Optional: wider columns on large screens */
  }
}
```

**3.3 ApexCharts in modules**
```css
.apexcharts-canvas {
  width: 100% !important;
}
```

---

### Phase 4: Dashboard Card Expansion

**4.1 Card grid systems**
```css
.home-v2-hero-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

@media (min-width: 1600px) {
  .home-v2-hero-stats {
    gap: 20px;
  }
}

@media (min-width: 1920px) {
  .home-v2-hero-stats {
    gap: 24px;
  }
}
```

**4.2 KPI cards**
```css
.kpi-grid {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

@media (min-width: 1600px) {
  .kpi-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px;
  }
}
```

---

### Phase 5: Optional Context Panel System (Ultrawide)

**5.1 Context panel toggle state**
```javascript
// Add to App.jsx
const [contextPanelOpen, setContextPanelOpen] = useState(false);
const isUltrawide = useMediaQuery("(min-width: 1920px)");
```

**5.2 Context panel CSS**
```css
.context-panel {
  width: 320px;
  min-width: 320px;
  border-left: 1px solid var(--color-border-subtle);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (min-width: 1920px) {
  .context-panel {
    width: 380px;
    min-width: 380px;
  }
}

.app-layout.with-context-panel {
  grid-template-columns: auto 1fr auto;
}

.app-layout.with-context-panel .main-content {
  /* Adjust for context panel */
}
```

**5.3 Context panel content types**
- Asset detail summary (when asset selected)
- Quick research notes
- Related positions
- Market context snippets
- Watchlist quick-add

---

### Phase 6: Module-Specific Adjustments

**6.1 OptionsModule chain table**
```css
.options-chain-table-container {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}

@media (min-width: 1600px) {
  .options-chain-table-container {
    /* Allow wider columns */
  }
}
```

**6.2 JournalModule**
```css
.journal-v2-main-grid {
  grid-template-columns: minmax(0, 1.5fr) minmax(350px, 1fr);
  gap: 24px;
}

@media (min-width: 1600px) {
  .journal-v2-main-grid {
    grid-template-columns: minmax(0, 1.7fr) minmax(400px, 1fr);
  }
}
```

**6.3 ResearchModule**
```css
.research-layout {
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr);
  gap: 24px;
}

@media (min-width: 1600px) {
  .research-layout {
    grid-template-columns: minmax(0, 1.6fr) minmax(380px, 1fr);
  }
}
```

---

### Phase 7: Modal and Overlay Adjustments

**7.1 Keep modals centered with reasonable max-widths**
```css
/* No changes needed - modals should remain constrained */
.asset-modal-window {
  max-width: min(860px, calc(100vw - 32px));
}
```

**7.2 Command palette**
```css
/* Already responsive - no changes needed */
```

---

### Phase 8: Testing and Validation

**8.1 Viewport testing matrix**
- 1366x768 (laptop) - baseline
- 1920x1080 (27" monitor) - primary target
- 2560x1440 (27" high-DPI) - expansion test
- 3440x1440 (ultrawide) - context panel test
- 3840x2160 (4K) - max width test

**8.2 Validation checklist**
- [ ] No horizontal scroll on 1366px
- [ ] Content expands to 1920px
- [ ] Padding scales with clamp()
- [ ] Grids expand proportionally
- [ ] Charts utilize full width
- [ ] Tables don't overflow
- [ ] Sidebar positioning correct
- [ ] Context panel toggle works
- [ ] Modals remain centered
- [ ] Mobile layout unchanged (<960px)

---

## Implementation Order

1. **Phase 1** - Core layout shell (highest impact, lowest risk)
2. **Phase 2** - Module grid systems (medium impact, medium risk)
3. **Phase 3** - Chart/table optimization (medium impact, low risk)
4. **Phase 4** - Dashboard cards (low impact, low risk)
5. **Phase 5** - Context panel (optional, can defer)
6. **Phase 6** - Module-specific tweaks (low impact, low risk)
7. **Phase 7** - Modal validation (safety check)
8. **Phase 8** - Testing and iteration

---

## Rollback Strategy

If issues arise:
1. Revert `.app-layout` max-width to 1400px
2. Revert padding to fixed 24px
3. Keep grid expansions (they're improvements)
4. Keep chart optimizations (they're improvements)

The core change is removing the max-width constraint on `.app-layout`. This is easily reversible.

---

## Success Metrics

- Content width increases from 1400px to ~1800px on 27" monitors
- Horizontal padding scales from 24px to 32-64px on ultrawide
- No horizontal scroll on standard laptops
- Dashboard cards and charts utilize available space
- Context panel system provides value on ultrawide screens
- Mobile layout (<960px) remains unchanged
