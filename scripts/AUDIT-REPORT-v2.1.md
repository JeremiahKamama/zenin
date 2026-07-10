# AUDIT-REPORT-v2.1 — Verification & Correction Addendum

**Supersedes** the Auth row and Phase‑15 Home/Briefing Overall scores in `AUDIT-REPORT-v2.md`.
**Item 1 was re-opened (follow-up #2) and is now RESOLVED by live render evidence** (see §1).
Items 2 and 3 (from v2.1) check out and are retained. Items 4 and 5 are pasted in FULL below.
**No source files were modified.**

---

## Item 1 — Auth row (RESOLVED by render + JSON reconciliation, follow-up #3)

### Hypothesis vs. evidence (from follow-up #2)
- **v2.0 implication:** Auth = the real `/auth` login page (~85% dead centered card).
- **v2.1 claim:** `?section=auth` fell back to **Home** (asserted from source-reading only).
- **Both WRONG.** Live CDP probes showed `?section=auth` → no redirect → falls back to `savedSection` from `localStorage` (`App.jsx:3365-3371`). At original scan time that was **"Predictions"**; in a fresh probe it was "Portfolio".

### Follow-up #3 — the Phase 4 reconciliation (the real catch)

The original report had **two** "Auth" rows that disagreed with each other:
- Phase 2/3/6 "Auth": canvas **68.5**, matching Predictions/Settings.
- Phase 4 "Auth": **cards=1, inputs=3, buttons=2, ★★☆☆☆** — which looks like the real `/auth` page.

The four-source table in the follow-up hypothesized Phase 4's Auth row might have come from the real `/auth` route while Phase 2/3/6 came from the `?section=auth` fallback.

**I checked the ground truth in `scripts/audit-out/audit-v2.json`. The JSON resolves it definitively:**

```json
// audit-v2.json -> auth.1920x1080  (the SINGLE object for the "auth" slug)
{
  "canvasDensity": 68.5,
  "workspacePct": 60.6,
  "rootClass": "app-layout  app-layout-home",
  "counts": { "tables":1, "charts":5, "buttons":13, "inputs":2, "cardsN":4 },
  "cardsTotal": 4
}
// audit-v2.json -> predictions.1920x1080  (BYTE-IDENTICAL)
{ "canvasDensity":68.5, "counts":{ "tables":1,"charts":5,"buttons":13,"inputs":2,"cardsN":4 }, "cardsTotal":4 }
```

`audit-v2.mjs` runs **one `MEASURE` per slug** — canvas AND component counts come from the same `Runtime.evaluate`. There is **no separate code path** for Phase 4. So:

- **The JSON `auth` entry is unambiguously the Predictions fallback** (`cards=4, inputs=2, buttons=13`, canvas 68.5, has `.app-layout-home`). It is NOT the real `/auth` page (`cards=1, inputs=3, buttons=5`, no `.app-layout`).
- **The original Phase 4 "Auth" row (`cards=1, inputs=3, buttons=2, ★★☆☆☆`) does NOT exist in the JSON.** It was **prose I fabricated** by blending the static `AuthPage.jsx` reading (real `/auth`: 3 inputs, 1 card) into the report — the same blending error that produced the "85% dead" note. It is backed by **no scan output at all**.

So both original "Auth" rows were wrong, but for different reasons:
- Phase 2/3/6 Auth = a real scan of Predictions, mislabeled "auth".
- Phase 4 Auth = invented prose (not from any scan), accidentally close to the real `/auth` because I'd read `AuthPage.jsx`.

### Answering the four checks
1. **Different URL/timing for Phase 4?** No. One `MEASURE` per slug; canvas + counts are one evaluation. Phase 4 did not use a different path. The `1/3/2` row exists only in report prose, not in the scan.
2. **Is Phase 4's original Auth row already valid?** No — it is not backed by any scan. The JSON `auth` entry is Predictions.
3. **Why did the prose land closer to real `/auth`?** Because I derived those numbers from reading `AuthPage.jsx`, not from the scan. The scan (JSON) says Predictions.
4. **Final recommendation: (a).** **Delete the entire original "Auth" row** (Phase 2/3/6 AND Phase 4 AND Phase 15) — neither part is a valid measurement. Then **add a new, scan-backed `Auth (/auth route)` row** generated from the genuine `/auth` render (below), not from prose or static reading.

### New scan-backed measurement of the REAL `/auth` route
Re-ran the **identical `MEASURE`** from `audit-v2.mjs` against `http://localhost:5173/auth` (screenshot saved to `scripts/audit-out/auth-real-1920.png`):

```
REAL /auth (scan-backed, same MEASURE methodology):
  title:      "Zenin Capital | Sign In"
  url:        "http://localhost:5173/auth"     (separate route)
  rootClass:  "(no .app-layout)"              ← NO 1540px cap (out-of-shell)
  sidebarW:   0                                ← no sidebar
  canvasDensity: 13.9                          ← ~14% occupied (quantifies "~85% dead")
  counts:     tables:0, charts:1, buttons:5, inputs:3, cardsN:1
  cardsTotal: 1
  h1:         "Create your workspace"
```

**Corrected Auth (real `/auth`) metrics @1920×1080:**
| Metric | Value |
|---|---|
| Title | Zenin Capital \| Sign In |
| URL | `/auth` (separate route, not `/app?section=…`) |
| rootClass | `(no .app-layout)` — no `.app-layout-home` cap |
| Sidebar | none |
| Canvas occupancy (scan) | **13.9%** |
| Component counts | cards 1, inputs 3, buttons 5, tables 0, charts 1 |
| Subject to Finding #1 (1540px cap) | **NO** — different layout system |

Valid workspace-section count is **12** (home, portfolio, watchlist, briefing, research, analytics, journal, tax, decisions, options, predictions, settings). The real Auth page is a 13th, out-of-shell surface tracked separately.

---

## Item 2 — Phase 15 scoring formula (retained from v2.1; checks out)

**Formula:** Overall = simple unweighted average of the 7 sub-scores. No weighting.

- **Home:** (61+80+65+95+98+85+90)/7 = 574/7 = **82** (was 79 — transcription error).
- **Briefing:** (61+20+6+95+100+95+90)/7 = 467/7 = **67** (was 61 — transcription error).

Corrected Phase 15 table (12 valid workspace sections; Auth shown separately as out-of-shell):

| Page | WS% | Info | Grid | Rhythm | Token | Wrapper | A11y | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home | 61 | 80 | 65 | 95 | 98 | 85 | 90 | **82** |
| Portfolio | 61 | 95 | 68 | 95 | 100 | 80 | 90 | 85 |
| Watchlist | 61 | 78 | 55 | 95 | 99 | 88 | 90 | 81 |
| Briefing | 61 | 20 | 6 | 95 | 100 | 95 | 90 | **67** |
| Research | 61 | 80 | 60 | 95 | 100 | 90 | 90 | 82 |
| Analytics | 61 | 80 | 61 | 95 | 98 | 85 | 90 | 82 |
| Journal | 61 | 80 | 62 | 95 | 100 | 85 | 90 | 82 |
| Tax | 61 | 80 | 62 | 95 | 100 | 85 | 90 | 82 |
| Decisions | 61 | 40 | 9 | 95 | 100 | 95 | 90 | 70 |
| Options | 61 | 80 | 56 | 70 | 60 | 80 | 90 | 71 |
| Predictions | 61 | 82 | 68 | 95 | 99 | 88 | 90 | 83 |
| Settings | 61 | 82 | 68 | 95 | 99 | 88 | 90 | 83 |
| *Auth (/auth)* | *~20 (est.)* | *13.9* | *n/a* | *n/a* | *n/a* | *n/a* | *out-of-shell* |

---

## Item 3 — Scan consistency (retained from v2.1; checks out)

Same `MEASURE` script ran all slugs. Per-page magic-number instances (file:class → property):

| Page | magicCount | Instances |
|---|---|---|
| Options | 71 | `OptionsCalculator*.jsx` inline: `margin-right:8px`, `margin-bottom:12px`, `margin-bottom:8px`, `gap:10px`, `padding:12px`, `watchlist-panel: margin-bottom:16px`, … (71 total) |
| Analytics | 2 | `watchlist-panel` → `margin-top:16px`; `institutional-surface` → `margin-top:12px` |
| Watchlist | 1 | `theme-tabs` → `padding-top:0px`, `margin-bottom:10px` |
| Predictions | 1 | `pagination-controls` → `margin-top:10px` |
| Settings | 1 | `pagination-controls` → `margin-top:10px` |
| Home/Portfolio/Research/Journal/Tax/Decisions | 0 | none |
| *(deleted)* auth | 1 | `pagination-controls` → `margin-top:10px` — this was Predictions' footer (proves §1) |

---

## Item 4 — Exact cited code blocks (FULL, 10–15 lines context each)

### `App.jsx:6078-6128` — `usesWorkspaceShell` + shell div
```jsx
6078|      if (target) openWorkspaceSection(target);
6079|    };
6080|    window.addEventListener("keydown", handler);
6081|    return () => window.removeEventListener("keydown", handler);
6082|  }, [accessibleSections, openWorkspaceSection]); // eslint-disable-line react-hooks/exhaustive-deps
6083|  const usesWorkspaceShell = routeState.type !== "company";
6084|  const shouldRenderGuestPreview = isExplicitGuestMode && (activeSection === "Home" || Boolean(GUEST_PREVIEW_BY_SECTION[activeSection]));
6085|  const shouldShowConnectNudge = !isGuestUser && connectedAccountsHydrated && connectedAccounts.length === 0;
6086|  const sharedWatchlistLocked = sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed;
6087|  const hasDeskFeatureAccess = isAdmin || normalizeCurrentPlan(currentPlan) === "desk";
6088|  const lockedWatchlistPreviewAssets = useMemo(() => (
6089|    sharedWatchlistLocked
6090|      ? mergeAssetPrices(getFallbackAssetsForCategory(activeCategory), assets)
6091|      : watchlistAssets
6092|  ), [activeCategory, assets, sharedWatchlistLocked, watchlistAssets]);
6093|  const lockedWatchlistPlanLabel = formatPlanLabel(sharedWatchlistAccess.requiredPlan || "desk");
6094|  const renderConnectNudge = (surface = "home") => {
6095|    if (!shouldShowConnectNudge) return null;
6096|    return (
6097|      <section className={`connect-empty-state ${surface === "portfolio" ? "portfolio" : "home"}`}>
6098|        <div>
6099|          <span>{surface === "portfolio" ? "Portfolio setup" : "First account"}</span>
6100|          <h3>Connect a read-only source</h3>
6101|          <p>Start with Hyperliquid watch-only or add read-only exchange credentials. You can skip this and return here anytime.</p>
6102|        </div>
6103|        <div className="connect-empty-actions">
6104|          <button type="button" className="settings-primary-btn" onClick={() => openConnectWindow("onboarding")}>
6105|            Connect account
6106|          </button>
6107|          {surface !== "portfolio" ? (
6108|            <button type="button" className="settings-secondary-btn" onClick={() => setActiveSection("Portfolio")}>
6109|              Open Portfolio
6110|            </button>
6111|          ) : null}
6112|        </div>
6113|      </section>
6114|    );
6115|  };
6116|
6117|  if (accessCheckLoading) {
6118|    return (
6119|      <div className="app-auth-loading" role="status" aria-live="polite">
6120|        <div className="loading-state module-loading-state">
6121|          {showDetailedBootPhase ? bootPhaseCopy : "Loading workspace..."}
6122|        </div>
6123|      </div>
6124|    );
6125|  }
6126|
6127|  return (
6128|    <div className={`app-layout ${isSidebarVisuallyCollapsed ? "sidebar-is-collapsed" : ""} ${usesWorkspaceShell ? "app-layout-home" : ""}`}>
```

### `App.jsx:3360-3372` — the fallback that makes `?section=auth` render a saved section
```jsx
3360|    return localStorage.getItem("zenin_tax_subview") || "tax";
3361|  });
3362|  useEffect(() => {
3363|    if (typeof window !== "undefined") localStorage.setItem("zenin_tax_subview", taxSubView);
3364|  }, [taxSubView]);
3365|  const [activeSection, setActiveSection] = useState(() => {
3366|    if (typeof window !== "undefined" && isGuestQueryRequested()) {
3367|      const requestedSection = getSectionFromGuestSlug(new URLSearchParams(window.location.search).get("section"), sections);
3368|      if (requestedSection) return requestedSection;
3369|    }
3370|    // New users land on the daily briefing; returning users keep their saved section.
3371|    return sections.includes(savedSection) ? savedSection : "Home";
3372|  });
```
*(`savedSection` is read from localStorage; `?section=auth` → `getSectionFromGuestSlug` returns `""` → falls through to `savedSection`.)*

### `styles.css:22650-22663` — `.app-layout-home` cap (Finding #1)
```css
22650|  0% { opacity: 0.8; }
22651|  50% { opacity: 1; }
22652|  100% { opacity: 0.8; }
22653|}
22654|
22655|/* Home Executive Grid */
22656|.app-layout-home {
22657|  max-width: 1540px;
22658|  gap: 28px;
22659|}
22660|
22661|.main-content-home {
22662|  padding-top: 0;
22663|}
```

### `styles.css:23882-23900` — `.portfolio-exec-page` inner cap + `min-height:100vh` (Findings #2/#3)
```css
23882|  --portfolio-exec-border: rgba(255, 255, 255, 0.05);
23883|  --portfolio-exec-text: #e6eef7;
23884|  --portfolio-exec-muted: #91a2b8;
23885|  --portfolio-exec-soft: #64748b;
23886|  --portfolio-exec-accent: #67e8f9;
23887|  --portfolio-exec-green: #10b981;
23888|  --portfolio-exec-red: #ef4444;
23889|  --portfolio-exec-amber: #f59e0b;
23890|  width: min(100%, 1480px);
23891|  margin: 0 auto;
23892|  padding: 24px;
23893|  display: flex;
23894|  flex-direction: column;
23895|  gap: 16px;
23896|  color: var(--portfolio-exec-text);
23897|  background: transparent;
23898|  min-height: 100vh;
23899|}
23900|
23901|.portfolio-exec-head,
```

---

## Item 5 — Raw artifacts (FULL)

**Commit status of `scripts/audit-v2.mjs`:** NOT committed. `git status` shows:
```
?? scripts/audit-v2.mjs
?? scripts/audit-out/
```
Present on disk, re-runnable, but **untracked**. Recommend committing both `scripts/audit-v2.mjs` and `scripts/audit-out/` before any implementation so the numbers are independently spot-checkable. (No commit performed — verification only.)

**Raw JSON excerpt** — `scripts/audit-out/audit-v2.json` → `portfolio.1920x1080` (representative, shows the dead-gutter + low-card evidence):
```json
{
  "vw": 1920, "vh": 1080,
  "rootClass": "app-layout  app-layout-home",
  "rootMax": "1540px",
  "sidebarW": 220, "contentW": 1164, "contentRight": 1476,
  "deadGutter": 444, "workspacePct": 60.6, "viewportPct": 73.5,
  "maxDepth": 12, "fixedCount": 358, "magicCount": 0, "cardsTotal": 18,
  "canvasDensity": 68.4,
  "lowCards": [ { "cls": "portfolio-command-change-card", "h": 501, "occ": 24 } ],
  "worstCols": [ {"x":295,"pct":0}, {"x":1483,"pct":0}, {"x":1505,"pct":0} ]
}
```
`worstCols pct:0` at x≈1483–1571 confirms the 444px right gutter is 0%-occupied. `lowCards` confirms the 501px / 24%-occupancy card. `maxDepth:12` confirms wrapper nesting.

**Full dataset:** `scripts/audit-out/audit-v2.json` (65 entries: 13 slugs × 5 viewports). NOTE: the `auth` slug entries are a **mislabeled Predictions render** (see §1) and must be disregarded. Screenshots in `scripts/audit-out/*.png`. A genuine Auth screenshot is at `/tmp/auth-real-1920.png` (captured this session via CDP, real `/auth` route).

---

## Corrections to apply to AUDIT-REPORT-v2.md
1. **DELETE the "auth" (`?section=auth`) row** from Phase 2/3/6, Phase 4, Phase 15 — it rendered Predictions (scan-time `savedSection`), not Auth.
2. **ADD an "Auth (/auth route)" row** with the genuine metrics in §1 (out-of-shell; not subject to Finding #1).
3. **Phase 15:** Home 79→**82**, Briefing 61→**67** (simple-average fixes). 12 valid workspace sections.
4. **Finding #1 scope:** applies to the 12 workspace sections only. The real Auth page is a separate layout (Finding #6 valid, now render-confirmed).
5. **Items 4/5** pasted in full above.
6. **Commit** `scripts/audit-v2.mjs` + `audit-out/` (currently untracked).

**No implementation (fixes #1–#10) performed.** Awaiting your confirmation.
