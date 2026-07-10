# Zenin — Institutional Typography & Visual Hierarchy Review

**Date:** 2026-07-09
**Reviewer:** Principal Product Designer / Design Systems Lead / Accessibility Specialist / Frontend Staff Engineer
**Status:** Supersedes all prior typography audits (including the inline `fontSize` review from earlier this session and any `font-size` sections of prior CSS audits).
**Method:** Evidence-backed static analysis of `frontend/src` (`styles.css`, `index.css`, all `*.jsx`), cross-referenced against `Brandv2.md` and the live `index.html` font load. Every claim marked ✅ Verified / ⚠ Inferred / ❌ Rejected.

---

## Executive Summary

Zenin's typography is **readable but not institutional**. The product defines a clean 9-step font-size token scale and a sensible two-family policy — then **bypasses both in 98% of declarations**. The result is a product that, type-for-type, does not read like Bloomberg, Koyfin, or TradingView. It reads like a startup whose components were built module-by-module without a shared contract.

The single most consequential finding: the brand mandates **JetBrains Mono for all financial numerics**, declares the `--font-mono` token, references it 59 times in CSS — and **never loads the font**. Every monetary figure, every percentage, every price in the product renders in whatever monospace the operating system hands it (`SFMono` on macOS, generic `monospace` elsewhere). For a product positioning itself as a "premium investment operating system," the absence of the numeric face that *defines* that category is the highest-severity typography defect in the codebase.

Compounding this, **three entire typography dimensions have no tokens at all** — line-height, letter-spacing, and font-weight — despite `brand.md` mandating "semantic tokens only for… typography." Font-weight is the most damaging: the brand allows only 500 and 600, yet 82% of the 521 weight declarations use values outside that set (700/800/900 dominate, plus an exotic ladder of 480/650/720/750/760/780/820/850/860/950 that mostly don't exist as real font weights and silently collapse).

The good news: the bones are right. The token scale is well-designed. The mono/tabular-numeric *intent* is correct (49 `tabular-nums` declarations in CSS). The uppercase label convention is coherent. The problems are all **enforcement gaps**, not wrong design decisions — which makes them fixable without a rethink.

### Scores

| Dimension | Score | Why |
|---|---|---|
| **Overall Typography** | **3.5 / 10** | A defined system systematically ignored; the brand's numeric face doesn't ship. |
| **Visual Hierarchy** | **4 / 10** | No descending heading scale; an `h2` can be 14–42px depending on the page. |
| **Institutional Design** | **3 / 10** | Does not yet read as Bloomberg/Koyfin. Mono-numeric identity is phantom. Metric cards use a different visual language per module. |
| **Accessibility** | **5 / 10** | Mostly readable, but 8–9px values breach the 10px floor; tabular-nums not applied to inline financial cells; no i18n. |
| **Design System** | **2.5 / 10** | Font-size token adoption 1.8%; font-weight adoption 0% (no token exists); line-height/letter-spacing adoption 0%. The system is decorative. |

---

## Typography Inventory

### Font families ✅ Verified

| Token | Value | Declared | Actually loaded |
|---|---|---|---|
| `--font-brand` | `'Geist', 'Inter', -apple-system, sans-serif` | `styles.css:71` | **Geist only** (`index.html:43`) |
| `--font-mono` | `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | `styles.css:72` | **Never loaded** |

- `Inter` is listed as a fallback in `--font-brand` but is **never loaded** either. On systems without Geist, body text silently falls through to `-apple-system`.
- `index.html:43` loads only `Geist:wght@100..900` from Google Fonts. There is no second `<link>`, no `@font-face`, no self-hosted `.woff2` for JetBrains Mono or Inter. ✅ Verified
- `--font-mono` is referenced **16 times** via token and **43 times** as a literal `'JetBrains Mono'` string in `styles.css` (one with `!important` at L614). Combined: **59 declarations** reference a font that isn't loaded.

### Font-size tokens ✅ Verified — `styles.css:99-107`

| `--fs-xs` | `--fs-sm` | `--fs-body` | `--fs-base` | `--fs-md` | `--fs-lg` | `--fs-xl` | `--fs-2xl` | `--fs-display` |
|---|---|---|---|---|---|---|---|---|
| 10px | 11px | 13px | 14px | 15px | 16px | 18px | 22px | 32px |

The scale deliberately carves gaps: **no 12px** (11→13), none at 20/24/26/28 (16→18→22→32). The codebase contradicts all of them — see Font Size Audit.

### Dimensions with NO tokens ✅ Verified

| Dimension | Tokens exist? | Declarations | Distinct values |
|---|---|---|---|
| Line-height (`--lh-*`) | **None** | 251 | ~35 unitless values (1.0–1.7, plus sub-1.0 for display) |
| Letter-spacing (`--ls-*`) | **None** | 340 | ~40 em values (−0.08em to +0.25em) |
| Font-weight (`--fw-*`) | **None** | 521 | 18+ distinct values (see below) |

This is a direct violation of `brand.md` L25: *"Use semantic tokens only for colors, spacing, typography, radii, shadows and motion."* Typography token coverage exists only for size; the other three dimensions are entirely unmanaged.

### Font weights ✅ Verified — histogram

| Weight | Count | Brand-allowed? |
|---|---|---|
| 700 | 155 | ✗ |
| 800 | 136 | ✗ |
| 600 | 70 | ✓ `font-semibold` |
| 900 | 63 | ✗ |
| 850 | 24 | ✗ (and not a real weight — collapses to 800/900) |
| 500 | 22 | ✓ `font-medium` |
| 750 | 10 | ✗ |
| 650 | 5 | ✗ |
| 950 | 4 | ✗ |
| 780 / 820 / 760 / 720 / 860 / 480 | 1–4 each | ✗ (mostly not real weights) |

**Brand compliance:** Brandv2.md L188 specifies exactly two heading weights — `font-medium` (500) and `font-semibold` (600). Of 521 declarations, **only 93 (18%) use allowed values. 428 (82%) are non-compliant.** The most common weight (700) isn't allowed. Worse, values like 650/720/750/780/820/850/860/950 are not discrete weights in the Geist variable font — they round to the nearest available step, so an author who wrote `850` expecting a specific weight gets 800 or 900 with no indication.

---

## Font Loading Audit

### Declared vs. loaded ✅ Verified

| Font | Declared in tokens | Loaded in `index.html` | Status |
|---|---|---|---|
| Geist | `--font-brand` | ✅ `index.html:43` | Loaded |
| Inter | fallback in `--font-brand` | ❌ never loaded | Phantom fallback |
| JetBrains Mono | `--font-mono` | ❌ never loaded | **Phantom — critical** |

### Fallback behavior ⚠ Inferred

With JetBrains Mono absent, the stack resolves as:
- **macOS:** `ui-monospace` → SF Mono (acceptable but inconsistent with Geist's metrics)
- **Windows:** generic `monospace` → Consolas
- **Linux:** generic `monospace` → DejaVu Sans Mono / Liberation Mono

This means the same portfolio table renders in **three different monospace faces** across platforms, with different character widths, breaking any hope of consistent column alignment. An institutional user on a Windows terminal sees a materially different numeric presentation than the designer on macOS.

### Unused imports

There are no unused font *imports* — there's the opposite problem: a font that's *referenced* but not imported. No `@font-face` declarations exist anywhere in `src/`.

---

## Font Size Audit

### Adoption ✅ Verified

| Surface | Token adoption | Total declarations |
|---|---|---|
| `styles.css` `font-size:` | **22 (1.8%)** | 1,208 |
| Inline JSX `fontSize:` | **0 (0%)** | 232 |
| **Combined** | **~1.5%** | 1,440 |

The `--fs-*` token scale only governs the `ui/*` primitive library (`button.jsx`, `table.jsx`, `dialog.jsx`, etc. use Tailwind `text-[var(--fs-*)]`). **Every business module bypasses it.** Tokens are decorative.

### Raw-value breakdown (`styles.css`) ✅ Verified

| Category | Count | Notes |
|---|---|---|
| `var(--fs-*)` token | 22 | Correct |
| Raw `px` | 360 | Drift |
| Raw `rem` | 754 | **Silently rebased** by `:root { font-size: 90% }` (`styles.css:134`) |
| `clamp()` / viewport units | 66 | Responsive — separate |

### The rem shadow scale ✅ Verified — the most insidious finding

The `:root { font-size: 90% }` declaration (`styles.css:134`) sets `1rem = 14.4px`, not 16px. This means every `rem` value in the file renders ~10% smaller than its face value. The codebase contains **~640 declarations across ≥18 two-decimal rem values** that land on fractional, off-token pixels:

| rem value | Renders as | Closest token | Off by |
|---|---|---|---|
| `0.85rem` | 12.24px | — | no token (between 11 and 13) |
| `0.8rem` | 11.52px | `--fs-sm` (11) | +0.5px |
| `0.78rem` | 11.23px | `--fs-sm` (11) | +0.2px |
| `0.9rem` | 12.96px | `--fs-body` (13) | −0.04px |
| `0.68rem` | 9.79px | — | below the 10px floor |

An author writing `0.8rem` likely expected ~12.8px; they got 11.52px. The entire rem population is a **second, shadow type scale** that approximates the token tiers but never matches them.

### The `12px` orphan ✅ Verified

The scale skips 12px (11→13). The codebase disagrees: **85 occurrences of "12px-equivalent"** (68× numeric `12` + 17× string `"12px"` in JSX; 84× `12px` in CSS). 61 of the JSX ones live in `AnalyticsModule.jsx` alone — `12px` is effectively that module's house size, and it sits in the exact gap the design system carved. Either the scale is wrong (add `--fs-12`) or the usage is wrong (migrate to 11/13).

### Off-scale values (no token match) ✅ Verified

| Value | Count (CSS+JSX) | Notes |
|---|---|---|
| `12px`-equiv | ~169 | In the explicit 11→13 gap |
| `9px` | 25 | Below the 10px floor — accessibility concern |
| `8px` | 1 | `AnalyticsModule.jsx:5499` — well below floor |
| `24/26/28/20/42/34px` | ~19 | In the 22→32 and above-display gaps |

### Duplicate / conflicting font-size on the same selector ✅ Verified

Ten+ selectors are defined in **multiple rule blocks with materially different font-sizes** — the winning value is determined by source order and `!important` arithmetic, not intent:

| Selector | Distinct sizes | Worst case |
|---|---|---|
| `.home-v2-hero-value` | 7 values across 8 blocks | includes a `clamp()` copy-pasted 4× verbatim (L20608/21811/22106/22730) |
| `.view-container…home-exec-heading h2` | 42px / 34px / 2 clamps | 4-way conflict |
| `.modal-header .asset-info h2` | 1.65 / 1.5 / 1.3 / 1.1rem | one modal heading, 4 sizes |
| `.metric-card .value` | 1.6 / 1.2 / 1.1 / 1rem | 4 sizes |
| `.nav-btn` | 1 / 0.8 / 0.75 / 0.92rem | nav text redefined 4× |

---

## Heading Hierarchy

**Verdict: there is no heading scale.** ✅ Verified

- There is no global `h1`–`h6` element scale and no `.h1`–`.h6` utility classes.
- A catch-all rule (`styles.css:38904`) forces **every `h3` in the app to 15px** regardless of context.
- Headings are sized ad-hoc via parent-class-scoped rules. The same heading level gets wildly different sizes depending on the page:

| Page | `h2` size | `h2` weight |
|---|---|---|
| Home (hero) | 42px (via override) | 650 |
| Portfolio (command) | ~27px (`clamp 1.6rem`) | 820 |
| Analytics (desk hero) | ~32px (`clamp 1.8rem`) | 950 |
| Options (exec) | ~22px (`clamp 1.35rem`) | 700 |
| Home (section row) | 14px | 800 |
| Tax (scenario) | 15px (the global h3) | inherits |

**An `h2` can be 14px, 24px, 27px, 32px, or 42px.** Hierarchical rank does not correspond to visual size — a section `h2` on one page is larger than a page `h1` on another. This defeats the semantic purpose of heading levels for both visual hierarchy and screen-reader navigation. ❌ The prior assumption that Zenin has a heading hierarchy is **rejected**.

---

## Visual Rhythm

The product has **no consistent vertical rhythm from typography**, because typography is organized *by module* (each module owns `.home-exec-*`, `.portfolio-command-*`, `.journal-debrief-*` rulesets), not *by role* (title / metric / button / label). The role-based tokens exist but were never adopted, so nothing pulls equivalent elements toward equivalence.

### Symptoms a user would notice ✅ Verified

1. **Metric values shift visual language per module.** The same "big number in a card" renders at 16px (Journal stat) → 20px (Company stat) → 25.6px (generic metric-card) → 28px (Analytics) → 50px (Home hero). Some use mono, some don't — `.company-stat-card` and `.analytics-metric-value` are sans while their neighbors are mono, **breaking column alignment within the same screen**.
2. **Page heroes share nothing.** Home 42px/650, Portfolio ~27px/820, Options ~22px/700. Equivalent "top of page," three sizes and three weights.
3. **Eyebrow/kicker labels drift visibly.** The same "tiny uppercase label" pattern uses letter-spacing from 0.08em (Company) to 0.22em (Options) — perceptible as "tight vs loose" small caps, side by side.
4. **Buttons look like different controls per module.** A primary CTA is a 10px uppercase chip in Home/Journal but a 16px sentence-case pill in Options.

The codebase shows at least **three retrospective attempts** to impose order via `!important` consolidation blocks (`styles.css:533`, `411`, `37430`) — each only partially covers properties and keeps losing specificity battles to per-module rules. The repeated need for these patches is itself the symptom.

---

## Financial Typography

This is the category that matters most for an institutional product, and it has the widest gap between intent and execution.

### Mono usage ✅ Verified
- `--font-mono` referenced 16× via token + 43× as literal = **59 declarations** — for a font that isn't loaded.
- The intent is correct (Brandv2.md L186: *"Numerics in financial tables lean on the mono stack so digits align column to column"*). The execution is absent.

### Tabular numbers ✅ Verified
- `tabular-nums` appears **49 times** in `styles.css` — a genuinely good base.
- But `fontVariantNumeric` / `tabular-nums` appears in **only 1 JSX file** (`AnalyticsModule.jsx:3353`, and on a non-mono span). Every inline-styled financial cell bypasses tabular-figures treatment.
- Net result: financial figures are **not consistently digit-aligned**. CSS-classed tables are; inline-styled tables and metric cards are not. For a product whose core value is scanning dense numeric data, inconsistent column alignment is a functional defect, not a cosmetic one.

### Alignment assessment ⚠ Inferred
With mono absent + tabular-nums inconsistent, decimal points in price/percentage columns do not reliably align. An institutional user scanning an options chain or portfolio table will perceive subtle misalignment — the kind of thing that reads as "amateur" precisely because the user can't articulate why.

### Specific surfaces ⚠ Inferred (from static analysis; live verification recommended)
- **Options chains** (`option-chain-table`): defined 3× with conflicting rules; the `!important` override at `styles.css:11866` finally wins at 10px/800 headers, 13px tabular-nums cells. Most-controlled surface.
- **Analytics research tables**: `0.64rem` headers at weight 900, `0.78rem` cells — off-scale, and weight 900 reads as heavier than every other table (which use 700–800).
- **Portfolio/Watchlist/Journal tables**: each defines its own cell size (0.8rem / 13px / 0.78rem).

---

## Responsive Typography

The product uses **66 `clamp()` declarations** for fluid sizing, concentrated in page heroes and large display numbers. This is the right approach for responsive type — but it's applied inconsistently:

- Page heroes use `clamp()` (good), but each hero uses a *different* clamp with different min/max/vw, so they don't scale in concert.
- Body text and table cells use fixed `px`/`rem` (no scaling) — acceptable for dense data tables, but means the type doesn't adapt to viewport.
- The 91-measurement mobile audit (from a prior session) found **zero horizontal document overflow** at 320–3840px, including for long prediction-market titles (confirmed fixed via `overflow-wrap`). ✅ Verified — so typography doesn't *break* responsively; it just doesn't *scale*.

### Specific risks ✅ Verified
- **8–9px values** (25 occurrences) are below the 10px floor and become unreadable at 320px or under browser zoom.
- The `clamp()` blocks for `.home-v2-hero-value` are **copy-pasted 4× verbatim** (L20608/21811/22106/22730) — pure redundancy that inflates the stylesheet and creates a maintenance hazard.

---

## Component Consistency

The core question: do identical UI elements use the same typography? **No.** ✅ Verified across five component types:

### Buttons
- The shared primitive (`ui/button.jsx`) is clean: `text-sm` / `font-medium` (500) / tokens via sizes. **It is almost never used.**
- Bespoke classes (`.journal-btn`, `.home-exec-btn`, `.confirm-order-btn`, `.analytics-btn`, `.tax-workbench .journal-btn`) each define their own size (10px–16px), weight (700–800), and transform (uppercase vs sentence case).
- A "Global Buttons" block (`styles.css:640`) tries to force everything to 10px-uppercase-800 via `!important`, then several buttons escape it via specificity. A primary action looks like a tiny tab in one module and a 16px pill in another.

### Metric / stat cards *(worst offender)*
- 12 distinct treatments. Sizes: 16 / 20 / 24 / 25.6 / 28 / 50px. Mono split: some mono, some sans. A "Global Metric Values" block (`styles.css:607`) sets family and color but **omits font-size and weight entirely** — so it unifies nothing that matters.

### Tables *(most consistent, still inconsistent)*
- Two consolidation blocks (`styles.css:334` and `411`) bring `zenin-table` and finance tables close to uniform (10px/800 uppercase headers, tabular-nums cells).
- But bespoke tables leak: Analytics headers at 0.64rem/900, Journal at 0.66rem/700, Options chain redefined 3×. The `ui/table.jsx` primitive uses weight 500 while every CSS table uses 800 — primitive-built tables look noticeably lighter than their peers.

### Cards
- No shared card-title treatment. "Card title" ranges 14–42px, weight 650–950 (see Heading Hierarchy).

### Eyebrows / kickers
- 10+ distinct combos of size (9–12px), weight (700/800/900), and letter-spacing (0.08–0.22em) for the same "tiny uppercase label" concept.

---

## Design System Compliance (vs. Brandv2.md)

| Brand rule | Status | Evidence |
|---|---|---|
| Two families only (Geist + JetBrains Mono) | ⚠ **Partially respected** | Both declared; only Geist loaded. Mono is phantom. |
| Mono stack for numeric alignment | ❌ **Impossible to enforce** | Mono font not loaded; `tabular-nums` in 49 CSS rules but only 1 JSX. |
| Headings use weight (500/600), never color | ❌ **Ignored** | 82% of weights are non-compliant; 700/800/900 dominate. |
| Type before color for hierarchy | ⚠ **Respected in principle** | The product is monochrome (good), but weight-based hierarchy is undisciplined. |
| Tokens are the source of truth (`styles.css :root`) | ❌ **Ignored** | 1.8% size-token adoption; 0% weight/lh/ls-token adoption (tokens don't exist for those). |
| Any typography change must update Brandv2.md | ❌ **Not enforced** | Brandv2.md specifies no size scale, no line-heights, no letter-spacing — yet hundreds of values exist in code. |

### Rules that are impossible to enforce today
- "Mono for numerics" — can't enforce because the font isn't loaded; even if it were, there's no `numeric` utility class binding mono + tabular-nums together.
- "Headings use 500/600" — can't enforce because there's no `--fw-*` token and no lint rule.

---

## Accessibility (WCAG AA)

| Criterion | Status | Evidence |
|---|---|---|
| Minimum readable size (≥12px body, AA) | ⚠ **Borderline** | 25 occurrences of 8–9px, below the 10px floor. Used for axis labels and tiny badges — legible on desktop, risky on mobile/zoom. |
| Line-height (AA: ≥1.5 for body) | ⚠ **Inconsistent** | ~35 distinct values; many body-text rules use 1.2–1.35 (below 1.5). Display numbers use <1.0 (acceptable). |
| Contrast | ✅ **Verified compliant** (prior `UI_AUDIT_REPORT.md`) | WCAG AA failures remediated to 0 in light mode. |
| Uppercase usage | ✅ **Consistent** | 244/253 `text-transform` are uppercase, applied to labels/kickers/headers — coherent convention. |
| Letter-spacing | ⚠ **Ungoverned** | ~40 distinct values; some uppercase labels at 0.22em are hard to scan; some at 0.04em are cramped. |
| Numeric readability | ❌ **Deficient** | Mono not loaded; tabular-nums inconsistent. Financial figures don't reliably align. |
| Zoom (200%) | ⚠ **Risky** | `:root { font-size: 90% }` starts the app at 90%; 200% zoom → effectively 180%. Fixed-px sizes don't scale. 8–9px values become ~7px. |
| Browser scaling | ⚠ **rem-dependent** | The 90% rebase makes rem a footgun; px values don't scale at all. |
| `prefers-reduced-motion` | ✅ **Handled** | (out of typography scope but noted: 13 occurrences) |
| `prefers-contrast` | ❌ **Unhanded** | 0 occurrences — forced-contrast users get no support. |

### Dyslexia considerations ⚠ Inferred
Geist is a reasonably dyslexia-friendly geometric sans. But the inconsistent letter-spacing (especially negative tracking on display text) and sub-10px sizes work against readability for dyslexic users. No OpenDyslexic option or user-controlled type scaling exists.

---

## Competitor Comparison

| Axis | Bloomberg | TradingView | Koyfin | AlphaSense | PitchBook | **Zenin** |
|---|---|---|---|---|---|---|
| Density | 10 (extreme, intentional) | 8 | 9 | 7 | 8 | **6** (inconsistent density) |
| Hierarchy | 9 (rigid weight scale) | 8 | 9 | 7 | 8 | **4** (no heading scale) |
| Confidence | 10 | 8 | 9 | 7 | 8 | **5** (drift reads as unsure) |
| Readability | 7 (trades beauty for density) | 9 | 8 | 8 | 8 | **7** (readable but inconsistent) |
| Premium feel | 10 | 8 | 9 | 8 | 9 | **5** (good bones, unshipped mono) |
| Numeric alignment | 10 (proprietary mono) | 9 | 9 | 7 | 8 | **4** (mono phantom, tabular inconsistent) |

### Where Zenin wins
- **Monochrome restraint.** Bloomberg/Koyfin are denser but also noisier. Zenin's black/white/gray palette is closer to Linear/Vercel than traditional terminals — a defensible, modern institutional aesthetic *if* the typography were disciplined.
- **The token *design*** is better than most competitors' — a clean 9-step scale. The problem is purely adoption.

### Where Zenin loses
- **Numeric identity.** Bloomberg's terminal *is* its mono font. TradingView and Koyfin ship consistent monospace numerics. Zenin declares one and doesn't load it. This is the single biggest gap versus the competitive set.
- **Hierarchical confidence.** In every competitor, a "page title" means one thing. In Zenin it means 14–42px. Users can't build a reliable mental model.
- **Weight discipline.** Competitors use 2–4 weights consistently. Zenin uses 18+, most of which collapse to the same rendered weight.

---

## Top 10 Critical Findings

| # | Finding | Severity | Impact | Effort | Risk | Confidence |
|---|---|---|---|---|---|---|
| 1 | **JetBrains Mono declared but never loaded** — 59 references render in OS fallback; cross-platform numeric alignment impossible | 🔴 Critical | Core institutional identity (numeric typography) doesn't ship; cross-platform inconsistency | XS (add `<link>`) / M (self-host) | Low | ✅ Verified |
| 2 | **Font-size token adoption 1.8%** — the `--fs-*` scale is decorative; 1,440 declarations bypass it | 🔴 Critical | No single source of truth for sizing; drift everywhere | L (migration) | Medium | ✅ Verified |
| 3 | **No `--fw-*` token; 82% of weights non-compliant** — brand allows 500/600; 700/800/900 dominate + exotic ladder collapses | 🔴 Critical | Weight hierarchy is undisciplined; phantom weights (850/950) render wrong | S (add tokens) + L (migrate) | Medium | ✅ Verified |
| 4 | **Three dimensions have zero tokens** (line-height, letter-spacing, font-weight) — violates brand.md "tokens for typography" | 🔴 Critical | Typography is unmanageable at scale | S (define tokens) | Low | ✅ Verified |
| 5 | **`:root { font-size: 90% }` creates a rem shadow scale** — ~640 rem declarations render at unintended fractional px | 🟠 High | Authors can't predict rendered size; 0.8rem≠12.8px | M (reconsider rebase + migrate) | Medium | ✅ Verified |
| 6 | **No heading scale** — same `h2` is 14–42px across pages; rank ≠ size; defeats a11y + visual hierarchy | 🟠 High | No reliable visual hierarchy; screen-reader nav meaningless | M (define h1–h6 scale) | Medium | ✅ Verified |
| 7 | **Metric/stat cards have 12 distinct treatments** — same concept renders 16–50px, mono/sans mixed | 🟠 High | Core financial UI lacks a consistent "big number" language | M | Medium | ✅ Verified |
| 8 | **Buttons bypass the clean primitive** — primary CTA is a 10px chip in one module, 16px pill in another | 🟠 High | Users can't form a consistent action model | M | Medium | ✅ Verified |
| 9 | **Tabular-nums only in 1 JSX file** — 49 CSS rules but inline financial cells bypass it; columns misalign | 🟠 High | Functional alignment defect in dense numeric tables | S (add utility class) | Low | ✅ Verified |
| 10 | **10+ selectors with conflicting multi-block font-sizes** — winning value determined by `!important` arithmetic, not intent | 🟡 Medium | Fragile; any refactor can silently shift sizes | M | Medium | ✅ Verified |

---

## Quick Wins

### Under 1 hour
- [ ] **Load JetBrains Mono** — add one `<link>` to `index.html` (or self-host). Fixes the #1 finding instantly. *Impact: Critical → Resolved.*
- [ ] **Add `--fs-12: 12px` token** + document in Brandv2.md — legitimizes the 85+ orphan usages.
- [ ] **Define `--fw-medium: 500` and `--fw-semibold: 600` tokens** — enables future weight enforcement (even before migration).

### Under 4 hours
- [ ] **Define an h1–h6 scale** (6 rules in `:root` mapping to `--fs-*`) and apply globally — kills the 14–42px `h2` chaos.
- [ ] **Add a `.numeric` utility class** = `var(--font-mono)` + `tabular-nums` + right-align — bind the three together so financial cells get all three at once.
- [ ] **Remove the 4× copy-pasted `.home-v2-hero-value` clamp blocks** (keep one).

### Under 1 day
- [ ] **Migrate the 85 "12px" orphans** → `var(--fs-12)` across CSS + JSX.
- [ ] **Resolve the duplicate-selector font-size conflicts** (pick one canonical size per selector; delete the rest).
- [ ] **Add a lint rule** (eslint `no-restricted-syntax` + stylelint) banning raw px/rem in `font-size` and numeric `fontWeight`.

---

## Medium Improvements (1–3 days)

- [ ] **Collapse the 18 fractional rems** onto tokens (or document why rem is intentional). Removes the shadow scale.
- [ ] **Migrate bespoke button classes** (`.journal-btn`, `.home-exec-btn`, `.confirm-order-btn`, etc.) onto `ui/Button` variants — unify typography + theming.
- [ ] **Define line-height + letter-spacing tokens** (`--lh-*`, `--ls-*`) for the 3–4 common patterns (body, display-tight, label-loose) and migrate the top offenders.
- [ ] **Unify metric-card typography** — define one "metric value" treatment (size/weight/mono/tabular) and apply to all 12 card types.
- [ ] **Tokenize AnalyticsModule inline styles** (136 fontSizes — the single biggest drift source).

---

## Major Refactors (1+ week)

- [ ] **Reconsider `:root { font-size: 90% }`** — decide px-tokens-everywhere vs. intentional rem scale, then enforce one consistently. This is load-bearing: it currently distorts every rem in the file.
- [ ] **Reorganize typography by role, not module.** Today each module owns its `.home-exec-*` / `.journal-debrief-*` type rules. Move to role classes (`.t-title`, `.t-metric`, `.t-label`, `.t-cell`) consumed across modules. This is the structural fix that prevents drift from recurring.
- [ ] **Self-host JetBrains Mono + Geist** (woff2 with `font-display: swap` and preload) — removes Google Fonts dependency, ensures cross-platform consistency, improves performance.
- [ ] **Full font-weight migration** to the 500/600 brand set — requires reviewing every 700/800/900 use and deciding the correct replacement.

---

## Roadmap

### Phase 1 — Ship the numeric identity (1 week)
**Goal:** Make Zenin *look* institutional by fixing the most visible defects.
1. Load + self-host JetBrains Mono. *(Finding 1)*
2. Add `--fs-12`, `--fw-medium`, `--fw-semibold` tokens. *(Findings 3, 4)*
3. Add `.numeric` utility class (mono + tabular-nums + align). *(Finding 9)*
4. Define h1–h6 scale. *(Finding 6)*
**Dependencies:** None. All additive, low-risk.

### Phase 2 — Enforce the system (1 month)
**Goal:** Make drift impossible going forward.
1. Lint rules banning raw px/rem/numeric-weight. *(Findings 2, 3)*
2. Define `--lh-*` / `--ls-*` tokens + migrate top offenders. *(Finding 4)*
3. Collapse fractional rems + resolve duplicate-selector conflicts. *(Findings 5, 10)*
4. Unify metric-card + button typography. *(Findings 7, 8)*
**Dependencies:** Phase 1 tokens must exist.

### Phase 3 — Reorganize (3 months)
**Goal:** Structural fix so drift doesn't recur.
1. Reconsider the 90% rebase. *(Finding 5 — load-bearing)*
2. Migrate typography from module-scoped to role-scoped classes.
3. Full AnalyticsModule inline-style tokenization.
4. Full font-weight migration to 500/600.
**Dependencies:** Phase 2 lint rules (to catch regressions during migration).

### Phase 4 — Best-in-class (vision)
**Goal:** Match or exceed Bloomberg/Koyfin numeric typography.
- Proprietary numeric alignment system (column-configurable decimal alignment).
- User-controlled type scaling (density modes already exist at `html[data-density]` — wire them to real type scales).
- Self-hosted, performance-budgeted font subsetting per route.
- `prefers-contrast` support (currently 0).

---

## Review Standards & Rejections

### Prior findings confirmed ✅
- JetBrains Mono not loaded — **confirmed** (verified in `index.html:43`).
- Font-size token adoption ~1.8% — **confirmed** (22/1208 in CSS, 0/232 in JSX).
- `12px` is an off-scale orphan — **confirmed** (85+ occurrences).

### Prior findings rejected ❌
- Any prior claim that Zenin has a "heading hierarchy" — **rejected**. An `h2` ranges 14–42px; a global rule forces all `h3` to 15px. There is no hierarchy.
- Any prior claim that `tabular-nums` is "applied to financial tables" — **rejected as overstated**. It's in 49 CSS rules but only 1 JSX file; inline-styled financial cells bypass it entirely.

### Uncertainty flagged ⚠
- Live numeric-alignment behavior (decimal column alignment in actual rendered tables) is **inferred** from static analysis, not measured in a browser. A follow-up with a running backend + real data would confirm the severity of Finding 9.
- Cross-platform mono fallback rendering (Windows Consolas vs macOS SF Mono) is **inferred** from the font stack; not tested on each OS.

---

*This document is the definitive typography review for Zenin as of 2026-07-09. It supersedes the inline-`fontSize` review from earlier today and any font-size sections of prior CSS audits. All counts were re-verified against the working tree on the date above.*
