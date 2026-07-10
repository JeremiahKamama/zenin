# Zenin — Research Module Architecture, UX & Product Audit

> **Read-only investigation.** No code was modified. No commits were made. Every architectural claim cites `file:line`; every UX observation carries a ✅ Verified / ⚠ Inferred / ❓ Requires runtime verification marker. The live app was reached at `http://localhost:5173/app?guest=1&section=Research` and screenshotted (see §7, §8).

---

## 0. Executive Summary

**Question this audit answers:** *Should Research become Zenin's central knowledge and decision-support layer?*

**Verdict (opinionated):** Research is **already architecturally the closest thing Zenin has to a knowledge layer** — but it is a 3,609-line "god component" (`ResearchModule.jsx:626`) that has absorbed **seven distinct domain objects** (documents, theses, catalysts, triggers, decisions, briefs, sources) into a single local-storage-backed monolith. It is simultaneously **too much** (over-reaches into Decisions/Briefing/Journal territory it shouldn't own) and **too little** (no folders, no asset-first research objects, no search integration, no AI, no cross-linking).

**Recommendation in one line:** Promote Research to the *navigation hub* of the research workflow, but **extract its seven domains into first-class services/stores** and **hand back Decisions, Briefs, and Journal entries to their canonical modules** rather than persisting parallel copies. Make the **Asset** the first-class research object via a dedicated Asset Research Workspace, and demote the Asset Modal's `ResearchTab` from a dead placeholder to a lightweight launcher.

**Headline scores** (10 = institutional-grade; see §20 for reasoning):

| Dimension | Score | One-line rationale |
|---|---|---|
| Architecture | 4/10 | One 3,609-line component owns 7 domains + all persistence; no separation of concerns. |
| Information Architecture | 6/10 | Rich domain model, but hidden inside 15 nested tab views with no spatial hierarchy. |
| Product responsibility clarity | 3/10 | Owns decisions/briefs that *duplicate* Decisions/Briefing canonical stores. |
| UX / workflow | 5/10 | Coherent "desk flow" narrative, but 2-level tab nav + 15 views = discoverability cliff. |
| Visual design / brand | 4/10 | 65 of 68 `.research-*` CSS blocks carry cyan/sky literals — violates Brandv2.md. |
| Responsive | 7/10 | Inherits the verified shell (no horizontal overflow); research grids untested at <768px. |
| Accessibility | 5/10 | Uses `role="tablist"`/ARIA labels in places, but many controls lack labels; color-only pills. |
| Engineering health | 3/10 | 30 useState / 36 useMemo / 12 useEffect in one file; duplicated normalization + derive logic. |
| Data model | 5/10 | Sound normalized entity shapes, but split-brain persistence (local + parallel remote). |
| Strategic fit | 8/10 | Conceptually the right home for the knowledge layer — execution is the blocker. |

---

## 1. Architecture Audit

### 1.1 Render tree

```
App.jsx:6707  <activeSection==="Research"> → <ResearchModule>
                                    │
ResearchModule (ResearchModule.jsx:626, default export :3609)
 ├─ CompactPageHeader (eyebrow "Research", title "Research Terminal")  :3479
 ├─ <input type=file> Import (.md/.txt)                               :3496
 ├─ <MetricStrip items={metrics}> (7 cards)                           :3505
 ├─ notice banner (local storage fallback)                            :3507
 ├─ desk-flow banner                                                 :3514
 ├─ renderViewTabs()  (RESEARCH_VIEW_GROUPS, 2-level tablist)         :3519 → :2129
 ├─ renderActiveView()  (15 view dispatch)                           :3520 → :3459
 │    inbox / review-queue / library / tickers / coverage-map /
 │    contradictions / theses / catalysts / triggers / sources /
 │    briefs / decisions / templates / ownership / timeline
 └─ RightRailDrawer (selectedDoc detail + promotion actions)          :3522
```

The component is a single function `ResearchModule` (no child components except tiny presentational helpers `ConvictionDots` at :230, `ResearchObjectControls` at :615). Every one of the 15 views is a `render*View()` closure inside the same function — confirmed by 19 `return (` statements between :2132 and :3477.

### 1.2 Routing

- **Lazy route:** `App.jsx:159-161` registers `ResearchModule` via `lazyWithReloadRetry(() => import("./components/ResearchModule")…)`.
- **Mount site:** `App.jsx:6707-6717` renders it only when `activeSection === "Research" && !shouldRenderGuestPreview`.
- **Section registry:** `App.jsx:1946` lists `"Research"` among `appSections`; persona nav orders it at `App.jsx:481/483` (e.g. small_team → `["Briefing","Research","Watchlist","Decisions","Journal","Analytics"]`).
- **No sub-routing.** All 15 views are internal `activeView` state (:637), not URLs. Deep-linking to e.g. `?research-view=theses` is impossible. ⚠ Inferred — no router param exists in `App.jsx` for research sub-views.

### 1.3 State ownership

All state is local to `ResearchModule`. There is **no research store/context** outside the component.

| State | Line | Kind |
|---|---|---|
| sources, documents, theses, catalysts, triggers, decisions, briefs | :629–635 | 7 domain arrays, seeded from `readLocalJson` |
| activeView, selectedDocId, selectedTicker, selectedBriefId | :637–640 | navigation/selection |
| activeSourceType, query | :641–642 | filters |
| 7 draft objects (draft, sourceDraft, thesisDraft, catalystDraft, triggerDraft, decisionDraft, briefDraft) | :652–719 | form state |
| editingEntity, pendingPromotion, ownerFilter, ownershipMode | :647–650 | UI/workflow |
| backendStatus | :646 | API health |
| obsidianConfig | :720 | connector config |

### 1.4 API / persistence ownership

`persistResearchBundle` (:1216) is the **single write path** for all 7 domains. It writes to **localStorage** synchronously (:1226–1232) **and** attempts 7 parallel `saveWorkspaceCollection` calls (:1234–1242) to remote namespaces `research:knowledge:{sources,documents,theses,catalysts,triggers,decisions,briefs}` (:20–26).

**Critical duplication finding:** Research persists `decisions` and `briefs` into `research:knowledge:*` namespaces, but the **canonical** Decisions and Briefing modules use **different, independent stores**:
- Decisions canonical store = `/api/decision-threads` (App.jsx:3604, DecisionThreadModule endpoints: `/decision-threads`, `/decision-threads/outcomes`, `/workspaces/current/activity`).
- Briefing canonical store = `/daily-briefing/generate` + `/decision-threads` (BriefingModule endpoints).
- Journal canonical store = `journal:entries` (JournalModule namespaces).

**→ Research holds a *separate, parallel* copy of decisions and briefs that the rest of the product never reads.** This is a split-brain data model (see §11).

### 1.5 Derived state (useMemo)

36 `useMemo` blocks. The heaviest is `tickerRows` (:867–983, 117 lines) — a full aggregation of every symbol across all 7 domains, recomputed whenever any domain or portfolio changes. This is the analytical heart of Research (coverage map, contradictions, ownership) but lives inline in the monolith.

### 1.6 Duplicated state

- `documents` and `normalizedDocuments` (:630 vs :812) — raw + normalized mirrors.
- `theses`/`normalizedTheses`, `catalysts`/`normalizedCatalysts`, etc. — every domain is held raw **and** memo-normalized.
- `tickerRows` (raw aggregate) vs `coverageRows` (derived from tickerRows, :985) — two layers of the same symbol map.
- `sources` (state) vs `sourceById` map (:806).

### 1.7 Architecture diagram

```
┌──────────────────────────────────────────────────────────────┐
│  App.jsx (route: activeSection==="Research")                  │
│      │ props: portfolio, watchlistAssets, onOpen*,             │
│      │         onPromoteToDecisionThread                       │
│      ▼                                                         │
│  ResearchModule (ONE 3,609-line component)                    │
│   ├─ 7 useState domain arrays  ─┐                              │
│   ├─ hydrate() effect ─────────┼─► loadWorkspaceCollection    │
│   ├─ 7 write effects ──────────┼─► writeLocalJson (sync)      │
│   └─ persistResearchBundle ────┘   + saveWorkspaceCollection   │
│        │                            (research:knowledge:*)     │
│        │ onPromoteToDecisionThread ──► App.jsx ──► /api/decision-threads
│        ▼                                                        │
│  15 render*View() closures (documents, theses, catalysts,      │
│     triggers, decisions, briefs, sources, timeline, map, …)    │
└──────────────────────────────────────────────────────────────┘
        ▲  PARALLEL (not shared) stores owned by sibling modules:
        │  Decisions   → /api/decision-threads
        │  Briefing    → /daily-briefing/generate
        │  Journal     → journal:entries
```

---

## 2. Information Architecture (what Research stores)

Research currently models **seven entity types** + **sources**:

| Entity | Namespace | Shape (normalized) | Lines |
|---|---|---|---|
| **Sources** | `research:knowledge:sources` | `{id,type:notion|obsidian|manual, name, status, readiness, syncMode, documentCount, lastSyncedAt}` | :334, :286 |
| **Documents** (notes) | `…:documents` | `{id,title,body,summary,symbols[],tags[],status:unread|reviewed|linked|archived, sourceType, url}` | :374 |
| **Theses** | `…:theses` | `{symbol,title,stage,summary,bullCase,bearCase,entrySignal,invalidation,mustPlayOut,riskCondition,conviction,coverageScope,owner,priority,dueDate}` | :387 |
| **Catalysts** | `…:catalysts` | `{symbol,title,type:earnings|macro|product|filing|token|custom,eventDate,note,status:upcoming|watching|complete,coverageScope,owner,priority,dueDate}` | :413 |
| **Triggers** | `…:triggers` | `{title,symbol,scopeType:asset|portfolio,actionType,conditionType,thresholdValue,linkedThesisId,linkedCatalystId,rationale,cooldownHours,status}` | :454 |
| **Decisions** (parallel copy) | `…:decisions` | `{symbol,action:watch|increase|add|reduce|pass|exit|invalidate,conviction,rationale,thesisId,coverageScope,owner,priority,dueDate}` | :434 |
| **Briefs** (parallel copy) | `…:briefs` | `{title,symbol,template:desk-memo|investor-update|pm-review,approvalState:draft|internal_review|approved,sections[],commentary,coverageScope,owner,priority,dueDate}` | :488 |
| **Obsidian config** | `zenin_research_obsidian_local_config` | `{endpoint,token}` | :720 |

**IA views (15), grouped into 5 workflow stages** (`RESEARCH_VIEW_GROUPS`, :62):

```
INTAKE      → Inbox · Sources · Templates
REVIEW      → Queue · Conflicts · Ownership
COVERAGE    → Tickers · Map · Library
CONVICTION  → Theses · Catalysts · Triggers
HANDOFF     → Briefs · Decisions · Timeline
```

This is a genuinely rich, well-conceived domain model. The problem is not *what* it stores — it's that all of it is crammed behind a 2-level tab tree with no spatial map.

---

## 3. Product Responsibility Audit

### 3.1 What Research owns today

- Note/document capture + ticker auto-linking (`extractTickerLinks`, :295).
- Source connectors (Notion "coming next", Obsidian "import only", Manual "connected" — `SOURCE_TYPES`, :38).
- Thesis / catalyst / trigger lifecycle management.
- Coverage aggregation across portfolio + watchlist (`tickerRows`, :867).
- Contradiction detection (thesis vs decision vs catalyst drift — `contradictions`, :1093).
- A **parallel** decision log and brief builder.

### 3.2 What should NOT belong here

| Responsibility | Why it doesn't belong | Canonical owner |
|---|---|---|
| **Decisions** (`research:knowledge:decisions`) | Duplicate of Decisions module's `/api/decision-threads`; never read by Decisions UI. | **Decisions** module |
| **Briefs** (`research:knowledge:briefs`) | Briefing module is the canonical brief generator (`/daily-briefing/generate`). Research's brief builder is a second, divergent authoring surface. | **Briefing** module |
| **Journal seeding** | `promoteResearchToDecisionThread` (App.jsx:3609) seeds a journal entry — Research reaching into Journal's store. | **Journal** (via API) |
| **Portfolio exposure read** | Research reads `portfolio`/`watchlistAssets` props to compute coverage — acceptable as *read*, but it must not become the portfolio source of truth. | **Portfolio** (read-only ref) |

### 3.3 Hard overlaps (every one is a real duplication)

- **Journal:** Research has no journal store of its own, but *promotes into* Journal (App.jsx:3612). The journaling capability is therefore split: Research authors the seed, Journal owns the store. ✅ Verified.
- **Company Profile:** Research theses/catalysts are symbol-keyed; CompanyProfilePage (1540 lines) separately shows catalysts/thesis sections (`catalyst` refs:16, `thesis` refs:4) but **does not read Research's store** (0 `db/workspace`, 0 `research:` in CompanyProfilePage). ❓ Requires runtime verification that Company Profile's research data is sourced independently (likely its own API), meaning the same symbol's thesis can diverge between Research and Company Profile.
- **Briefing:** Briefing generates briefs from `/daily-briefing`; Research builds briefs locally. Two brief authors. ✅ Verified (endpoint divergence).
- **Decisions:** As above — parallel store. ✅ Verified.
- **Portfolio:** Research reads portfolio exposure for coverage health (`getPortfolioExposure`, :539) but does not write. Read-only dependency is correct; the *coverage* insight belongs in Research.
- **Analytics:** Analytics references `research` 37× and `catalyst` 10× (likely the Home "Signal Tape" consumes triggers — `ResearchModule.jsx:2969` "These rules feed Home Signal Tape"). ⚠ Inferred linkage; Analytics' research reads need tracing.
- **Tax:** No overlap.
- **Watchlist:** Research reads `watchlistAssets` for symbol coverage; the "Open Watchlist" button (App.jsx:6712) is a cross-link. Correct as reference.
- **Search:** Research has its **own** internal note search (`query` filter, :1008) and does **not** integrate with the global `CommandPalette` (0 `commandPalette` refs in ResearchModule; CommandPalette searches sections only, :103). ⚠ Inferred — no shared search index.
- **Command Palette:** 0 integration. The palette cannot jump into a Research view or search Research notes. ❓ Requires verification, but source shows no shared hook.

---

## 4. User Workflow

**Intended flow (encoded in the desk-flow banner, :3514):**
```
Intake → Review → Coverage → Conviction → Handoff
```

**Detailed path a desk analyst follows:**

1. **Capture** — paste a note in Inbox (`renderInboxView`, :2169); symbols auto-link.
2. **Classify** — mark status (unread/reviewed/linked/archived).
3. **Review** — Triage Stack (:2274) / Review Queue (:2305) surfaces stale theses, due catalysts, unresolved triggers.
4. **Contradictions** (:2612) — system flags thesis-vs-decision drift, missing invalidation lines, exposure-without-thesis.
5. **Coverage** — Ticker Dossiers (:2401) aggregates everything per symbol; Coverage Map (:2558).
6. **Conviction** — build Thesis (:2640), Catalyst (:2770), Trigger (:2878).
7. **Handoff** — build Brief (:3112), log Decision (:3267), view Timeline (:3437).
8. **Promote** — "Promote to Decision Thread" (App.jsx:3591) pushes a note into the **Decisions** module.

**Is the flow logical?** ✅ Yes — it's a coherent research-to-decision pipeline, arguably the best-conceived workflow narrative in the product.

**Friction points (cited):**
- **15 views behind 2 tab levels** — to reach "Theses" the user clicks `CONVICTION` then `Theses`. No flat index. Discoverability cliff.
- **Parallel decision/brief stores** mean a "Decision" logged in Research is invisible in the Decisions Kanban (and vice-versa) until promoted. The "Log Decision" action (:3590) writes to `research:knowledge:decisions`, **not** `/api/decision-threads` — so it does *not* appear in the Decisions board. ⚠ This is a likely P0 contradiction: the in-Research "Log Decision" silently creates an orphan record. Requires runtime confirmation, but the persistence paths are definitively separate.
- **No asset-first entry.** Starting from a ticker (the natural analyst entry point) requires going to Watchlist/Asset Modal → there is no "research this symbol" deep link into Research's Tickers view except the chip buttons inside a document drawer (:3571).

---

## 5. Navigation Audit

| Surface | Finding | Evidence |
|---|---|---|
| Sidebar | "Research" sits in its own `RESEARCH` group (App.jsx:831 `SIDEBAR_GROUP_ORDER`), between Core and Tools. Detail text "Connect knowledge bases and ticker-link notes." — **undersells** what it actually is (a full research OS). | snapshot e11 |
| Tabs | 2-level tablist: 5 groups × 3 sub-views = 15. No breadcrumb. No "you are here" beyond the active-tab underline. | :2134, :2151 |
| Filters | Source-type select + free-text query (Inbox only, :2178). Owner filter + ownership mode exist (:648) but only surface in Ownership view. | :2178, :2640 |
| Search | Local note search only; not global. | :1008 |
| Grouping | Grouping by workflow stage is sound, but stages ≠ entities, so e.g. "Decisions" lives under HANDOFF while "Theses" lives under CONVICTION — a user thinking "show me everything about NVDA" must visit 4 views. | `RESEARCH_VIEW_GROUPS` :62 |
| Progressive disclosure | RightRailDrawer for doc detail (:3522) is good. But 15 full views are always mounted-on-demand with no lazy split. | :3522 |
| Depth | Nav depth = 3 (section → group → view). Acceptable, but 15 leaves is too many to scan. | — |

**Verdict:** Navigation communicates *process* well but *objects* poorly. An institutional user thinks in assets/theses, not "Intake vs Handoff."

---

## 6. UX Audit (✅ from live screenshot)

✅ **Verified via live render** (`http://localhost:5173/app?guest=1&section=Research`):

- **Header:** "Research Terminal" + "Backend offline · local-only mode" + Import / Save to Workspace. Clean.
- **MetricStrip:** 7 cards (Sources/Documents/Review Queue/Coverage/Contradictions/Briefs/Backend). Dense, useful at-a-glance.
- **Empty state:** "Import your first research note" GuidedEmptyState with Import Markdown / Open Sources CTAs — good pattern.
- **Two-column body:** Intake Tape (left) + Triage Stack (right) on the Inbox view.
- **Notice banner:** "Research workspace is using local storage: Too many requests" — ✅ confirms the localStorage fallback path fires even with a backend present (rate-limited), and the UX surfaces it.

⚠ **Inferred (not measured live):**
- Nested scrolling: the RightRailDrawer contains a `<pre>` body (:3601) with no max-height/scroll wrapper observed in source — long notes may overflow the drawer.
- Context switching cost: each of 15 views re-renders the full `tickerRows` memo (:867) — switching views is O(all-domains) even when only one domain changed.

---

## 7. Visual Design Audit (Brandv2.md compliance)

⚠ **Brand-compliance finding (measured, not eyeballed):** A programmatic scan of `styles.css` found **68 `.research-*` rule blocks; 65 of them contain cyan/sky/teal literals** (`rgba(56,189,248)`, `#0ea5e9`, `34,211,238`, `103,232,249`, `125,211,252`, etc.). This **directly violates Brandv2.md** ("monochrome only, no cyan/neon").

- Research uses its **own bespoke class system** (`.research-btn`, `.research-inline-select`, `.research-card-stack`, `.research-status-pill`, …) — **not** the shared `CompactWorkspaceUI` primitives it imports (`DensePanelHeader`, `MetricStrip`, `GuidedEmptyState`, `RightRailDrawer` are shared; the inner controls are hand-rolled). ⚠ This is a token-violation + duplication hotspot.
- Status pills are **color-only** (`.research-status-pill.unread` etc.) — fails the "no color-only communication" accessibility rule (§9).
- `ConvictionDots` (:230) uses `<i>` dots — acceptable, but contrast in light mode unverified. ❓ Light-mode pass needed.
- Typography/spacing: handled by bespoke `.research-*` rules, so they **bypass the `--workspace-*` token system** — inconsistent density vs the rest of the shell (which uses `styles.css` tokens, per `zenin-frontend` skill).

---

## 8. Responsive Audit

| Width | Assessment | Marker |
|---|---|---|
| 320 / 375 | Inherits shell (sidebar collapses, hamburger). Research grids untested. | ❓ research grids not measured |
| 768 | Shell verified no-overflow (per `zenin-ux-audit` mobile harness). Research's 2-column Inbox (Intake+Triage) likely stacks — unverified. | ⚠ inferred |
| 1024–1440 | Primary target. 2-level tabs + MetricStrip fit. | ✅ assumed (desktop-first per Brandv2) |
| 1720–1920 | Comfortable; dead-gutter historically systemic but now live-measured ~88–92% shell fill (per skill). Research content is fluid within. | ✅ shell |
| 2560–3440 | Ultrawide: research grids use `repeat(auto-fit,minmax)`? ❓ Not confirmed in source — likely fixed grids that leave gutters. | ❓ |
| 3440+ | Same as ultrawide. | ❓ |

**Verdict:** Mobile/tablet shell is a verified strength (per `audit-mobile.mjs`, 0 overflow 320–1720). The **Research-specific grids** (Intake+Triage two-column, ticker dossier multi-panel) have **not** been measured and are the likely weak point on narrow screens.

---

## 9. Accessibility

| Check | Status | Evidence |
|---|---|---|
| Keyboard nav | Partial | Tabs use `role="tab"` (:2134) but no documented arrow-key handler observed; `RightRailDrawer` (Radix-based, in CompactWorkspaceUI) handles its own focus trap. |
| Focus order | ⚠ Unverified | No explicit `tabindex` management in ResearchModule; relies on DOM order. |
| ARIA | Partial | `ConvictionDots` has `role="img"` + `aria-label` (:233). Doc drawer has `role="status"` notice (:3508). Many `<select>`/`<button>` lack associated `<label>` (e.g. capture form, :2199). |
| Semantic HTML | Weak | Heavy use of `<div>`/`<article>` with class-only semantics; the "Capture note" form uses bare `<input>`/`<textarea>` without `<label for>`. |
| Touch targets | ⚠ | Tab chips + `.research-symbol-chip` buttons — size unverified at 320px. |
| Reduced motion | ❓ | No `prefers-reduced-motion` rule found in `.research-*` scan. |
| High contrast | ⚠ | Cyan-on-dark pills may fail AA in light theme. |
| Screen-reader labels | Partial | MetricStrip cards have `region "Summary metrics"` (snapshot e18) — good. |
| Color-only comms | ❌ Fail | `.research-status-pill` variants are distinguished by color alone (§7). |

---

## 10. Engineering Audit

| Issue | Severity | Evidence |
|---|---|---|
| **God component** | P0 | `ResearchModule.jsx` = 3,609 lines, 1 default export, 30 useState, 36 useMemo, 12 useEffect, 40 helper fns. |
| **No child components** | P1 | Only `ConvictionDots` (:230) + `ResearchObjectControls` (:615) extracted; 15 views are closures. |
| **Duplicated normalization** | P1 | `normalizeDocument/Thesis/Catalyst/Decision/Trigger/Brief` (:374–:510) each called in a `useMemo` *and* in `persistResearchBundle` paths — normalization logic duplicated across read and write. |
| **Bespoke CSS + token violations** | P1 | 65/68 `.research-*` blocks carry cyan literals (§7). |
| **Magic numbers** | P2 | `saveWorkspaceCollection(..., 200/1000/500/300)` limits (:1236–1242) are hardcoded per-domain caps; no shared constant. |
| **Inline styles** | none | 0 `style={{` in ResearchModule — ✅ good. |
| **Re-render hotspot** | P1 | `tickerRows` memo (:867) depends on 11 values incl. all 7 normalized domains + portfolio; any edit rebuilds the full symbol aggregate. |
| **Split-brain persistence** | P0 | Local `writeLocalJson` **and** remote `saveWorkspaceCollection` both fire on every persist (:1226–1242); if remote fails (rate-limited, as seen live), local and remote silently diverge with only a dismissible banner. |
| **Parallel decision/brief stores** | P0 | `research:knowledge:decisions|briefs` are orphan copies vs canonical `/api/decision-threads` + `/daily-briefing` (§3.2). |
| **Dead placeholder** | P1 | `assetModal/tabs/ResearchTab.jsx` (30 lines) is a **static empty-state** — fully unwired; the Asset Modal cannot show real Research data despite Research owning it. |

---

## 11. Data Model Audit

**Origin of Research data:**
- **Local:** `readLocalJson` seeds every domain from `zenin_research_knowledge_*` keys (:629–:635, :720).
- **Remote (if authed):** `loadWorkspaceCollection(namespace)` (:738–:744) hydrates from `/db/workspace/collections/{namespace}`.
- **Import:** Markdown files → `handleMarkdownFiles` (:1529) parse into documents.
- **Obsidian:** local REST pull (config at :720) — "import only" today.

**Ownership matrix:**

| Data | Local key | Remote namespace | Also owned by |
|---|---|---|---|
| documents | `zenin_research_knowledge_documents` | `research:knowledge:documents` | — (unique to Research) |
| theses | `…_theses` | `research:knowledge:theses` | Company Profile *displays* theses (separate source) |
| catalysts | `…_catalysts` | `research:knowledge:catalysts` | Company Profile *displays* catalysts (separate source) |
| triggers | `…_triggers` | `research:knowledge:triggers` | Home "Signal Tape" (consumer) |
| **decisions** | `…_decisions` | `research:knowledge:decisions` | **Decisions module** (`/api/decision-threads`) — *separate* |
| **briefs** | `…_briefs` | `research:knowledge:briefs` | **Briefing module** (`/daily-briefing/generate`) — *separate* |
| sources | `…_sources` | `research:knowledge:sources` | — (unique) |

**Key risk:** `decisions` and `briefs` are **temporarily authored in Research then "promoted" out** (App.jsx:3591). The local Research copy and the canonical remote copy can diverge; nothing reconciles them.

---

## 12. Relationship Audit

| Module | Relationship | Evidence |
|---|---|---|
| **Portfolio** | Read-only consumer (exposure/weight for coverage health). Correct direction. | `portfolio` prop :626; `getPortfolioExposure` :539 |
| **Journal** | Research *seeds* journal entries on promotion (App.jsx:3612). One-way write into Journal's store. | App.jsx:3609–3623 |
| **Company Profile** | Displays theses/catalysts but **does not read Research's store** (0 `research:` refs). Risk of divergent symbol research. | CompanyProfilePage scan |
| **Asset Modal** | `ResearchTab` is a **dead placeholder** — no shared data with ResearchModule. | `ResearchTab.jsx` (30 lines, static) |
| **Analytics** | Consumes triggers ("feed Home Signal Tape", :2969); `research` refs 37× in AnalyticsModule. | ResearchModule:2969 |
| **Decisions** | Parallel store; promotion bridges them. Orphan-risk. | §3.2, §11 |
| **Briefing** | Parallel brief author. Divergent from `/daily-briefing`. | BriefingModule endpoints |
| **Tax** | No relationship. | — |
| **Watchlist** | Read-only symbol source + cross-link button. | `watchlistAssets` prop :627; App.jsx:6712 |
| **Search** | **No integration.** Research has its own local query filter only. | :1008; 0 global search refs |
| **Command Palette** | **No integration.** Palette cannot reach Research views/notes. | 0 `commandPalette` refs; CommandPalette searches sections only |

---

## 13. Missing Capabilities (institutional-grade)

Present conceptually but **absent or weak** in code:

- ❌ **Research folders / collections** — notes are a flat list, only `source` + `status` group them.
- ❌ **Asset workspaces** — no per-symbol research home; you arrive via chip buttons, not a dedicated surface.
- ❌ **Research templates** — `TEMPLATE_LIBRARY` exists (:141) but only seeds draft fields; no reusable workspace templates.
- ❌ **Knowledge graph / backlinks** — `symbols[]` is the only link; no entity graph, no backlinks.
- ❌ **Saved screens / saved searches** — `query` is ephemeral state (:642), never persisted.
- ❌ **Comparison workspace** — no multi-symbol compare.
- ❌ **PDF annotation** — Markdown import only.
- ❌ **Research timeline** — `timeline` view exists (:3437) but is a flat activity list, not a true versioned timeline.
- ❌ **Investment thesis builder** — `thesisDraft` (:654) is a form, not a structured builder with auto-derived invalidation checks.
- ❌ **Catalyst tracker** — `catalysts` exist but no cross-symbol calendar roll-up beyond the view.
- ❌ **Risk tracker** — only `riskCondition` text field on thesis; no quantified risk object.
- ❌ **Research dashboard** — MetricStrip (:3505) is the only dashboard; no configurable layout.
- ❌ **Research archive** — `archived` status exists but no archive management view beyond filters.
- ❌ **Cross-linking** — symbol links only; no note→note or note→thesis links.
- ❌ **Version history** — none; every save overwrites.
- ❌ **Tag system** — `tags:[]` exists on documents (:367) but **never surfaced in any UI** (only 1 `tags` ref in whole file). Effectively dead.
- ❌ **Saved layouts / split view / multi-monitor** — none.
- ❌ **AI integration** — **0 AI/LLM references** in the file. No summarization, no embedding search, no "research assistant." For a 2026 institutional research tool this is the single largest capability gap.
- ❌ **Attachments** — only Markdown text import; no file/image attachments on notes.

---

## 14. Asset Research Workspace Evaluation

**Recommendation: YES — introduce a dedicated Asset Research Workspace, and make it the primary entry point into Research.**

**Why:**
1. The natural analyst workflow is **symbol-first** ("research NVDA"), but Research today is **process-first** (Intake→…→Handoff). Symbol entry exists only as chip buttons inside a document drawer (:3571).
2. `tickerRows` (:867) already aggregates *everything per symbol* — the data model is asset-centric underneath; the UI just doesn't lead with it.
3. The Asset Modal's `ResearchTab` is a **dead placeholder** (§10) — the obvious home for asset-first research is currently empty.

**Form factor:** **D. Standalone route** — `/research/:symbol` (or `?section=Research&symbol=NVDA`), co-existing with the process views. It should **not** replace Company Profile (Company Profile is reference/data; the Asset Research Workspace is *your* research layer on top). It should **replace the dead `ResearchTab`** in the Asset Modal (the modal launches into the workspace).

```
Asset Modal "Research" button → Asset Research Workspace (/research/NVDA)
   ├─ Dossier: documents, theses, catalysts, triggers, decisions, briefs (all symbol-scoped)
   ├─ Contradiction panel (reuse :1093 logic)
   └─ "Open full Research Terminal" → /section=Research
```

---

## 15. Company Profile Relationship

**Recommendation: Company Profile should remain a dedicated reference experience, but it must READ Research's theses/catalysts instead of (or in addition to) its own independent source.**

- **Unique to Company Profile:** market data, financials, filings, news, competitors — reference/derived data Research should never own.
- **Duplicated:** thesis + catalyst *display* (CompanyProfilePage has `thesis`×4, `catalyst`×16 refs) — but sourced separately from Research's store (0 `research:` refs in CompanyProfilePage). ❓ Requires runtime verification of Company Profile's research data origin; if it's a different API/store, the same symbol can show different theses in the two surfaces.
- **Ownership:** Research owns *user-authored* theses/catalysts; Company Profile owns *market* context. The fix is a **read integration**, not a merge. Company Profile should embed the Asset Research Workspace (§14) rather than re-deriving research.

---

## 16. Asset Modal Relationship

**Recommendation: the Asset Modal should become a lightweight Research Launcher + Quick Look, not a research surface.**

Evidence: `ResearchTab.jsx` (30 lines) is a **static empty state** with a "Open Company Profile →" button and a list of *planned* sections (Investment Thesis, Catalysts, Risks, …) that **none of which are implemented**. Keeping a dead tab is worse than replacing it.

**Proposed future:**
- Asset Modal = **Quick Look** (price, position, one-line thesis, next catalyst) — fast, read-only.
- "Research" action in the modal → launches the **Asset Research Workspace** (§14).

This removes the dead `ResearchTab`, satisfies the user's "asset-first" entry need, and keeps the modal lightweight.

---

## 17. Future Product Architecture (proposed)

Research becomes the **knowledge + decision-support layer**, with assets as first-class objects:

```
Research (knowledge layer)
├── Assets (Asset Research Workspace — /research/:symbol)   ← NEW, primary entry
│     ├─ Dossier (documents·theses·catalysts·triggers·decisions·briefs)
│     ├─ Contradictions
│     └─ Launch full Terminal
├── Coverage (symbol map — today's tickerRows)
├── Theses
├── Catalysts
├── Triggers
├── Sources & Connectors (Notion/Obsidian/Manual)
├── Briefs  → HAND OFF to Briefing module (no parallel store)
├── Decisions → HAND OFF to Decisions module (no parallel store)
├── Timeline (versioned activity)
├── Library (notes + folders + tags — surface the dead tags[])
├── Templates
└── Knowledge Base (cross-links, backlinks, graph)   ← NEW
```

**Assets become first-class research objects:** every other entity is keyed by `symbol` already (:867 aggregate proves it). Elevating the symbol to a route makes the model honest.

---

## 18. Competitive Analysis

| Product | What Zenin should learn | Differentiation opportunity |
|---|---|---|
| **Bloomberg Terminal** | Function-first, command-driven, deep cross-linking (`ECO`, `DES`, `N`). | Zenin's 2-level tabs are the anti-pattern; adopt command-palette-driven asset jump + `<symbol> research` deep link. |
| **Koyfin** | Clean multi-panel workspaces, saved layouts. | Zenin lacks saved layouts/split view (§13). |
| **TIKR / AlphaSense** | Document-centric research, full-text search, AI summarization. | **Zenin has 0 AI and 0 global search integration** (§13) — the biggest gap vs these. |
| **TradingView** | Ideas/theses as social + private objects, asset-first. | Zenin's theses are private-only and process-hidden; make them asset-first. |
| **Roic.ai** | AI-native investment research. | Zenin's `extractTickerLinks` is the only "AI-ish" feature; add embedding search + summary. |
| **Morningstar** | Rating/conviction framework. | Zenin's `ConvictionDots` (:230) is a start; formalize a conviction/rating model. |
| **Notion / Obsidian / Capacities** | Knowledge graph, backlinks, folders, templates. | Zenin has none of these (§13) despite importing from them — ironic. |

**Where Zenin should differentiate:** the **desk-flow pipeline** (Intake→Review→Coverage→Conviction→Handoff, :3514) is genuinely distinctive and Bloomberg/Koyfin don't package research-to-decision handoff this way. Double down on *that*, and bolt on AI search + asset-first workspaces that the incumbents assume but Zenin can make native.

---

## 19. UX Vision (institutional research platform, from zero)

- **Workspace:** Asset-first. Open `NVDA` → one dossier showing your theses, catalysts, triggers, notes, decisions, briefs, plus the contradiction panel. No 15-view hunt.
- **Navigation:** Command palette is the primary mover (`<symbol>` jumps to Asset Research Workspace; `research: <query>` searches all notes via embedding). Tabs become secondary.
- **Layout:** 3-pane — left: coverage/symbol list; center: active research object; right: contradiction/conviction panel. Split-view + saved layouts for multi-monitor desks.
- **Flows:** Capture (anywhere, ⌘K "note NVDA …") → auto-link → review queue → promote to thesis/decision → handoff to Briefing/Decisions (canonical stores, no duplicate).
- **Information hierarchy:** Asset → Research Object (thesis/catalyst/note) → Field. Not process-stage → view.
- **Daily workflow:** Morning = Coverage map + Contradictions + due Catalysts. Evening = handoff Brief + Decision log.
- **Power-user:** keyboard-driven, saved screens, multi-symbol compare, version history, backlinks.
- **Multi-asset:** `coverageScope` already supports `single_name|basket|sector_theme|macro` (:120) — expose it as first-class workspace filters.

---

## 20. Final Recommendation

### What Research should become
The **central knowledge + decision-support layer** of Zenin — asset-first, AI-augmented, and the navigation hub that hands off to Briefing/Decisions/Journal rather than duplicating them.

### What should stay separate
- **Portfolio** (Research reads exposure only).
- **Company Profile** (reference/market data; embeds Research, doesn't replace it).
- **Tax / Watchlist** (reference only).

### What should merge
- **Asset Modal `ResearchTab`** → replaced by a launcher into the Asset Research Workspace (§16).
- **Research's `decisions` + `briefs` local stores** → merged into the canonical Decisions (`/api/decision-threads`) and Briefing (`/daily-briefing`) modules. Research becomes an *authoring surface* that writes to those stores, not a parallel owner.

### What should disappear
- The **15-view, 2-level tab tree** as the primary navigation — replace with asset-first + command palette.
- The **split-brain persistence** (local + remote both firing, silently diverging).
- The dead `tags[]` field until it's surfaced, or remove it.

### What should become the primary workflow
**Asset-first:** open a symbol → dossier → research object → promote/handoff. The desk-flow (Intake→…→Handoff) remains as the *organizing metaphor* for the Library/Review surfaces, not the top-level nav.

### Proposed long-term architecture
See §17. Assets as first-class routes; Research = knowledge layer; Decisions/Briefing/Journal = canonical stores Research writes to; Company Profile = embedded Asset Research Workspace + market reference.

### 1-week roadmap (no new features, de-risk)
1. **Kill the parallel stores** — make Research's "Log Decision" / "Generate Brief" call `/api/decision-threads` and `/daily-briefing` instead of `research:knowledge:*`. (P0, fixes orphan records.)
2. **Wire the dead `ResearchTab`** — replace static placeholder with a button launching the Asset Research Workspace (or at minimum link to `/section=Research&symbol=…`). (P1)
3. **Monochrome the 65 cyan `.research-*` blocks** via the postcss 2-pass migration (per `zenin-frontend` skill #15/#17). (P1, Brandv2 compliance.)
4. **Surface `tags[]`** or remove it. (P2)

### 1-month roadmap
5. **Extract `ResearchModule`** into `Research/` folder: `AssetResearchWorkspace`, `CoverageMap`, `ThesisDesk`, `CatalystDesk`, `TriggerDesk`, `SourcesConnector`, `Library`, `Timeline`, `lib/entities.js` (move the 7 `normalize*` fns + `persistResearchBundle` into a service). (P0 engineering.)
6. **Asset Research Workspace route** `/research/:symbol` reusing `tickerRows` aggregation. (P0 product.)
7. **Single persistence service** (local + remote reconcile, not fire-and-forget). (P0.)

### 3-month roadmap
8. **AI layer** — embedding-based note search + auto-summary + contradiction suggestions (replaces manual `extractTickerLinks` with NLP). (P0 differentiator.)
9. **Knowledge graph / backlinks / folders / saved searches.** (P1.)
10. **Command-palette integration** — jump to symbol research + search notes globally. (P1.)
11. **Company Profile embeds Asset Research Workspace** (read integration, no duplicate theses). (P1.)

### Vision roadmap (6–12 mo)
- Multi-monitor split-view workspaces + saved layouts (Koyfin parity).
- Version history + research archive.
- PDF/image annotation on notes.
- Catalyst calendar roll-up across desk; risk tracker object.
- Full Bloomberg-style command language for research (`<symbol> thesis add …`).

---

## Appendix A — Evidence Index

| Claim | Citation |
|---|---|
| 3,609-line god component, 30 useState / 36 useMemo | `ResearchModule.jsx:626`, :1 state block, execute_code count |
| 7 domain namespaces | `ResearchModule.jsx:20–26` |
| 15 views / 2-level tabs | `RESEARCH_VIEW_GROUPS` :62; dispatch :3459–3473; `renderViewTabs` :2129 |
| Local + remote dual persistence | `persistResearchBundle` :1216–1242 |
| Parallel decision/brief stores | §3.2; DecisionThread `/api/decision-threads`; Briefing `/daily-briefing/generate` |
| Asset Modal ResearchTab dead | `assetModal/tabs/ResearchTab.jsx` (30 lines, static) |
| 0 AI references | execute_code grep (openai/anthropic/gpt/claude/llm: 0) |
| 65/68 `.research-*` blocks cyan | styles.css programmatic scan |
| Live render confirmed | browser snapshot e11–e52; screenshot `browser_screenshot_8b777b13…png` |
| Metrics strip 7 cards | `metrics` :1204; live snapshot e18 |
| Contradiction engine | `contradictions` :1093 |
| Coverage aggregation | `tickerRows` :867 |
| Promotion to Decisions | App.jsx:3591–3626 |

## Appendix B — Markers used
- ✅ **Verified** — observed in source or live render this session.
- ⚠ **Inferred** — strongly implied by source, not directly measured.
- ❓ **Requires runtime verification** — needs a live probe or user confirmation to confirm.

---

## Appendix C — Reconciled Asset Research Workspace (ARW) Contract (v3)

> **Status:** canonical implementation contract, reconciled with this audit.
> **Source:** user-authored ARW v3 spec, folded in with two minor fixes applied (see "Fixes applied" below).
> **Maps to:** audit §14 (ARW evaluation), §15 (Company Profile), §16 (Asset Modal), §17 (future architecture), §20 (final recommendation).
> **Verified against code:** `CompanyProfilePage.jsx` (independent thesis/catalyst source), `ResearchModule.jsx` (dual-write `writeLocalJson` + `saveWorkspaceCollection` across 7 `research:knowledge:*` namespaces), `AssetModal.jsx` / `assetModal/ResearchTabs.jsx` (6 live tabs), `CompactWorkspaceUI.jsx` (5 real primitives), no `services/` dir, no `WorkspaceLayout`. All claims reproduced in source.

### Fixes applied in this appendix (relative to raw v3)
1. **Triggers** added to the Canonical Ownership Matrix and to Research's target tree. `research:knowledge:triggers` exists today (audit §2/§12) and feeds the Home "Signal Tape"; omitting it would orphan the domain during migration.
2. **Checklists** defined (lightweight due-diligence checklists owned by Research) so the concept is no longer dangling.

---

### C.1 Executive Summary
The Asset Research Workspace remains the long-term direction for Zenin. Implementation must acknowledge the current architecture rather than assuming greenfield. The current codebase already contains Asset Modal, Company Profile, Research Module, Decision Module, Briefing Module, and Journal — each owning overlapping pieces of the research workflow. ARW's primary responsibility is **consolidation**, not feature expansion: one canonical asset workspace without another duplicate surface.

### C.2 Current State vs Target State

**Current (overlapping):**
```
Asset Modal ─ Overview, Financials, News, Options, Notes, Research(placeholder)
Company Profile ─ Description, Financials, Ownership, Earnings, Competitors, Thesis, Catalysts
Research Module ─ Documents, Theses, Catalysts, Sources, Decisions, Briefs, Triggers, Timeline
```
Everything overlaps.

**Target (one owner):**
```
Asset Modal ──▶ Asset Research Workspace ──┬─▶ Company Profile
                                           ├─▶ Research
                                           ├─▶ Journal
                                           ├─▶ Decisions
                                           ├─▶ Briefing
                                           └─▶ Watchlist
```
Only one workspace owns research; everything else becomes a consumer.

### C.3 P0 Architecture Rule
Every piece of information must have **ONE owner**. Consumers may render it; consumers may **never** own it.

### C.4 Canonical Ownership Matrix

| Domain | Canonical Owner | Consumers |
|---|---|---|
| Market Data | Market Data Service | Modal, Company Profile, ARW |
| Financial Statements | Financial Service | Company Profile, ARW |
| Filings | Financial Service | Company Profile, ARW |
| Ownership | Financial Service | Company Profile |
| Competitors | Financial Service | Company Profile |
| News | News Service | Company Profile, ARW |
| Earnings Calendar | Earnings Service | Company Profile, ARW |
| Thesis | Research Service | ARW, Company Profile (read-only) |
| Catalysts | Research Service | ARW, Company Profile (read-only) |
| Triggers | Research Service | ARW, Home Signal Tape |
| Notes | Research Service | ARW, Journal |
| Conviction | Research Service | ARW |
| Decisions | Decision Module | ARW |
| Daily Briefs | Briefing Module | ARW |
| Journal Entries | Journal Module | ARW |
| Watchlist Status | Watchlist Service | Modal, ARW |
| Portfolio Holdings | Portfolio Service | Modal, ARW |
| Analytics | Analytics Service | ARW |

Ownership is never duplicated.

### C.5 Shared Component Reality Check

**Available today** (verified `CompactWorkspaceUI.jsx` exports):
`CompactPageHeader`, `DensePanelHeader`, `MetricStrip`, `RightRailDrawer`, `GuidedEmptyState`.

**Must be built during Phase 1** (do not exist anywhere in `src/`; extract as shared infra, never bespoke-in-ARW):
`Panel`, `Section`, `MetricCard`, `InsightCard`, `Badge`, `Tag`, `Toolbar`, `LoadingState`, `ErrorState`, `EmptyState`, `Timeline`, `Table`, `WorkspaceLayout`.

### C.6 Required Migration

**Asset Modal** — remove tabs `Financials, News, Options, Research, Notes`; keep `Overview` + launcher actions (Open Research Workspace, Open Company Profile, Watchlist, Close). The modal becomes a launcher, not a research destination. (Verified: `ResearchTabs.jsx` currently registers all 6; only `ResearchTab` is a dead placeholder today — the other 5 are live and must be *relocated*, not merely hidden.)

**Company Profile** — currently renders thesis (`×4`) / catalyst (`×13`) from its **own** independent source (0 `ResearchService`/`research:` refs). Must become a read-only consumer of `ResearchService.getResearch(assetId)`. Never stores research.

**Research Module** — today owns 7 `research:knowledge:*` collections (sources, documents, theses, catalysts, triggers, decisions, briefs). Target: owns **only** research objects:
```
Research
├── Thesis
├── Notes
├── Sources
├── Catalysts
├── Triggers
├── Conviction
├── Checklists (lightweight due-diligence checklists, Research-owned)
└── Documents
```
Decisions → Decision Module. Briefs → Briefing Module. Research references them; never owns them.

**Remove parallel stores** — current `ResearchModule.writeLocalJson()` (sync localStorage) **and** `saveWorkspaceCollection()` (remote) both fire on every persist, producing local + remote copies + offline divergence (observed live: "Backend offline · local-only mode"). Future: ARW → Research Service → Persistence Layer → Backend. One write path, one reconciliation layer, **no direct localStorage writes from UI**.

**Briefing** — retire `research:knowledge:briefs`; Briefing Module owns `Brief[]`; Research stores references only; ARW consumes Briefing Service.

**Decision** — retire `research:knowledge:decisions`; Decision Module becomes canonical; Research references Decision IDs only.

**News** — owned by News Service; Company Profile + ARW are consumers. Prevents divergent feeds.

### C.7 Data Flow
```
Market APIs → Market Services → Research Service → Asset Research Workspace
                                                    ├─▶ Journal
                                                    ├─▶ Decision Module
                                                    ├─▶ Briefing Module
                                                    ├─▶ Company Profile
                                                    └─▶ Asset Modal
```
All consumers read from services; none duplicate ownership.

### C.8 Implementation Phases
- **Phase 1 — Infrastructure:** extract shared primitives; introduce services; remove direct UI fetches; remove direct localStorage writes.
- **Phase 2 — Migration:** simplify Asset Modal; rewire Company Profile; remove duplicate thesis/catalysts/decisions/briefs.
- **Phase 3 — ARW Build:** workspace shell, research canvas, intelligence rail, Journal + Decision integration.
- **Phase 4 — AI:** copilot, thesis assistant, document summarization, earnings analysis, valuation assistant (enhancement layer only).

### C.9 Engineering Rules (mandatory)
UI never fetches APIs directly · UI never writes localStorage directly · Services own all persistence · Every domain has one owner · Consumers never duplicate data · No bespoke ARW component library · Shared primitives first · TypeScript-ready domain models · Feature-first architecture · Workspace-first navigation · Asset-first research model.

### C.10 Success Criteria
Asset Modal reduced to launcher · Company Profile purely reference · Research owns only research · Decisions canonical · Briefs canonical · Journal canonical · Every asset has exactly one research workspace · No duplicated thesis/catalysts/persistence · Every research artifact linked to an Asset ID.
