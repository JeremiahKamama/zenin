# AUDIT-REPORT-v2.2 — Integrity Cross-Check (follow-up #4)

**Scope:** diff every number in `AUDIT-REPORT-v2.md` against the cited scan source `scripts/audit-out/audit-v2.json` (1920×1080 where per-page; Phase 13 uses the 5-viewport rows). Goal: confirm whether the report's numbers are actually scan-backed.

**Method:** I extracted the canonical JSON fields for all 13 slugs × 5 viewports, then compared each printed figure to the corresponding JSON field. `audit-v2.json` is treated as ground truth (it is the scan output the report claims to cite).

**Headline:** Canvas/whitespace/fixed-height/responsive numbers ARE scan-backed. **Phase 4 component counts are NOT** — the Cards column matches (12/12), but the **Tables column is systematically wrong** (7 valid pages printed `0` where JSON says `1`), plus Decisions button/input and Settings charts are off. Auth remains entirely bogus (covered in v2.1). The Home magic-number count is also understated vs JSON.

---

## 1. Phase 4 — component counts vs JSON `counts` (1920×1080)

Canonical JSON `counts` (tables / cards / charts / buttons / inputs):

| Page | JSON t | JSON c | JSON ch | JSON b | JSON i |
|---|---|---|---|---|---|
| home | 1 | 2 | 51 | 33 | 0 |
| portfolio | 1 | 18 | 54 | 29 | 3 |
| watchlist | 1 | 2 | 3 | 20 | 5 |
| briefing | 0 | 0 | 0 | 1 | 0 |
| research | 0 | 0 | 0 | 16 | 6 |
| analytics | 1 | 0 | 0 | 8 | 0 |
| journal | 1 | 0 | 0 | 46 | 0 |
| tax | 1 | 0 | 0 | 46 | 0 |
| decisions | 0 | 0 | 0 | 3 | 5 |
| options | 1 | 17 | 1 | 45 | 10 |
| predictions | 1 | 4 | 5 | 13 | 2 |
| settings | 1 | 4 | 5 | 13 | 2 |
| auth (bogus) | 1 | 4 | 5 | 13 | 2 |

**Diff — every mismatch (report prose vs JSON):**

| Page | Field | Report v2 | JSON | Verdict |
|---|---|---|---|---|
| Home | Tables | 0 | 1 | ✗ report wrong |
| Analytics | Tables | 0 | 1 | ✗ report wrong |
| Journal | Tables | 0 | 1 | ✗ report wrong |
| Tax | Tables | 0 | 1 | ✗ report wrong |
| Options | Tables | 0 | 1 | ✗ report wrong |
| Predictions | Tables | 0 | 1 | ✗ report wrong |
| Settings | Tables | 0 | 1 | ✗ report wrong |
| Decisions | Buttons | 2 | 3 | ✗ report wrong |
| Decisions | Inputs | 4 | 5 | ✗ report wrong |
| Settings | Charts | 0 | 5 | ✗ report wrong (qualitative gloss) |
| Auth (old) | ALL | 1/0/0/2/3 | 4/1/5/13/2 | ✗ entirely bogus (v2.1) |

**What matches:** Cards column is **12/12 correct** (home 2, portfolio 18, watchlist 2, briefing/research/analytics/journal/tax/decisions 0, options 17, predictions/settings 4). Buttons/Inputs match on all valid pages **except Decisions**.

**Pattern:** The author read `cardsN` from JSON (Cards column is clean) but then **hand-wrote `0` for Tables on almost every page** — 7 of the 9 pages that actually contain a `<table>` were printed as `0`. This is the same failure mode as Auth: a plausible number written instead of read. Cards happened to be transcribed; Tables were not.

**Charts caveat:** the JSON `counts.charts` counts `svg,canvas,[class*="chart"]` — i.e. every icon svg. Home=51, Portfolio=54 are dominated by icon svgs, not data charts. So the "Charts" column is **noisy and low-analytical-value**; the original `few/✓/0` encoding is a qualitative gloss, not a precise count. The Settings `0` vs JSON `5` discrepancy is real but the column itself shouldn't be treated as a precise metric. Recommend dropping the Charts column or redefining it to count only `[class*="chart"]` data-viz, not icons.

**Corrected Phase 4 (JSON-derived, for use in a main-report revision — NOT yet applied to v2.md):**

| Page | Cards | Tables | Charts(svg) | Buttons | Inputs |
|---|---|---|---|---|---|
| Home | 2 | 1 | 51 | 33 | 0 |
| Portfolio | 18 | 1 | 54 | 29 | 3 |
| Watchlist | 2 | 1 | 3 | 20 | 5 |
| Briefing | 0 | 0 | 0 | 1 | 0 |
| Research | 0 | 0 | 0 | 16 | 6 |
| Analytics | 0 | 1 | 0 | 8 | 0 |
| Journal | 0 | 1 | 0 | 46 | 0 |
| Tax | 0 | 1 | 0 | 46 | 0 |
| Decisions | 0 | 0 | 0 | 3 | 5 |
| Options | 17 | 1 | 1 | 45 | 10 |
| Predictions | 4 | 1 | 5 | 13 | 2 |
| Settings | 4 | 1 | 5 | 13 | 2 |
| *Auth (/auth)* | *1* | *0* | *1* | *5* | *3* |

---

## 2. Other phases

### Phase 2/3/6 (canvas occupancy, dead gutter) — CLEAN
Every printed canvas % and dead-gutter px matches JSON exactly (home 65.0/444, portfolio 68.4/444, watchlist 54.5/444, briefing 6.2/444, research 59.6/444, analytics 61.1/444, journal 62.1/444, tax 62.1/444, decisions 9.3/444, options 56.1/444, predictions 68.5/444, settings 68.5/444). The qualitative "Sections" and "Notes" columns are prose (not in JSON) — acceptable, except the Auth "~85% dead" note (see §4).

### Phase 7/9 (fixed-size counts, wrapper depth) — CLEAN
- `fixedCount`: portfolio 358, options 436, tax 318, home 345, analytics 240, journal 318 all match JSON; "Others 13–223" range correctly covers briefing 13 / research 142 / watchlist 150 / decisions 22 / predictions 223 / settings 223.
- `maxDepth`: portfolio 12, watchlist 9, decisions 4 match JSON. (Auth 8 is bogus — delete.)
- Low-occupancy card `portfolio-command-change-card h=501 occ=24` matches JSON `lowCards` exactly.

### Phase 5/10 (magic numbers) — ONE mismatch
JSON `magicCount`: home **6**, portfolio 0, watchlist 1, analytics 2, options 71, predictions 1, settings 1, others 0.
- Options 71, Watchlist 1, Analytics 2, Predictions 1, Settings 1 — match.
- **Home: JSON = 6, but v2.1 Item 3 table (and v2 Phase 5/10 prose) say Home = 0.** Mismatch. The JSON's 6 are all `padding: 0px` resets (see `magicSample` for home: six `{'cls':'','decls':['padding: 0px']}`). A `padding:0px` reset is arguably not a real token violation, so the report's "0 *meaningful* magic numbers" is defensible — but it does **not** match the JSON's stated `magicCount:6`. Flag as discrepancy: either the scan over-counts trivial resets, or the report under-counts. Recommend: exclude `0px`/reset values from the magic-number heuristic so JSON and report agree.

### Phase 13 (responsive) — CLEAN
All five viewports match JSON: 1366→78.3/24, 1600→76.8/92, 1920→60.6/444, 2560→44.2/590, 3440→32.9/1030.

### Phase 15 (Architecture Score) — CLEAN after v2.1 correction
`WS% = 61` (JSON `workspacePct` 60.6, rounded) and `Grid Occ.` = JSON `canvasDensity` (rounded) for all 12 valid pages — verified. Auth Grid Occ. corrected to **13.9** (this follow-up #3). The other sub-scores (Info Density, Rhythm, Token, Wrapper, A11y) are **analytical scores**, not direct JSON measurements — acceptable as the audit's judgment layer, but they should be explicitly labeled "scored," not "measured," so they aren't confused with scan outputs.

---

## 3. Fixes #1–#10 — are they scan-backed?

| Fix | Claim | Backed by JSON? |
|---|---|---|
| #1 | 1540px cap → deadGutter 444, WS% 60.6 | ✅ `deadGutter`, `workspacePct`, `rootMax:1540px` |
| #2 | 1480px inner cap (`styles.css:23890`) | ⚠️ static CSS read; not a JSON field (plausible) |
| #3 | `min-height:100vh` forced empty space | ✅ `fixedCount` includes 100vh; `lowCards`/styles read |
| #4 | Briefing 6.2% empty | ✅ `canvasDensity:6.2` |
| #5 | Decisions 9.3% / 80% void | ✅ `canvasDensity:9.3` (scan says ~91% void, not 80% — see §4) |
| #6 | Auth 85% dead | ✅→now 13.9 scan for real `/auth` (estimate superseded) |
| #7 | Options 71 magic spacings | ✅ `magicCount:71` |
| #8 | `portfolio-command-change-card` 24% | ✅ `lowCards[].occ:24` |
| #9 | Journal 3 empty / Tax 1 fixed container | ⚠️ **not in JSON** — derived from DOM inspection/prose; not reproducible from committed scan |
| #10 | Watchlist table 796px wide | ⚠️ **796px not in JSON** — one-off measurement, not in `audit-v2.json` |

Fixes #1, #3, #4, #5, #6, #7, #8 are scan-backed. #2 is a static CSS citation. **#9 and #10 cite numbers absent from the JSON** — they're plausible but not independently reproducible from the committed scan, so treat them as lower-confidence until the scan is extended to capture empty-container counts and table widths.

---

## 4. Estimate-vs-measurement labels (follow-up #4, q4)

These figures were **eyeballed estimates**, not computed `canvasDensity`, and preceded the real `/auth` scan (13.9%):

- **`~85% dead` (Original Finding #6, Auth):** estimate. The real `/auth` scan gives `canvasDensity:13.9` → **86.1% dead**. The estimate was numerically close (86≈85) but was not a measurement. Now superseded by 13.9.
- **`~20–25%` (v2.1 Probe C description):** estimate of *viewport-width* occupancy (~420px card / 1920 = 21.9% width share). The canvas scan is **13.9%** because the card is also short vertically. Both should be labeled "estimate"; the 13.9 canvas figure is the rigorous one.
- **`~80% black void` (Decisions, Phase 2/3/6 note):** vision estimate. Scan `canvasDensity:9.3` → **~91% void**, not 80%. Vision under-estimated; scan is authoritative.
- **`~830px (80%)` black void (Decisions screenshot note):** same — scan says ~91%.

All three are now explicitly labeled as estimates in this addendum; the scan numbers (13.9 for Auth, 9.3 for Decisions) supersede them.

---

## 5. Bottom line

- **Scan-backed and trustworthy:** Phase 2/3/6 canvas+gutter, Phase 7/9 fixed-count+depth, Phase 13 responsive, Phase 15 WS%/Grid-Occ (post-v2.1), and Fixes #1/#3/#4/#5/#7/#8.
- **NOT scan-backed / wrong:** Phase 4 **Tables** column (7 pages say 0, JSON says 1), Phase 4 **Decisions** buttons/inputs, Phase 4 **Settings** charts, the entire old **Auth** row, and the **Home magic-count = 0** claim (JSON = 6). Phase 4 Cards column is correct.
- **Lower-confidence (not in JSON):** Fixes #9 and #10.
- **Estimates (now labeled):** `~85% dead`, `~20–25%`, `~80% void`.

**Recommendation:** before any implementation, rewrite Phase 4 from the JSON `counts` (corrected table in §1) and correct the Home magic-count note. The structural findings (#1 shell cap, #3 100vh, #4/#5 sparse pages, #7 Options tokens, #8 low-occ card) stand on scan-backed numbers and are safe to act on.

**No source files modified.** This is still verification.
