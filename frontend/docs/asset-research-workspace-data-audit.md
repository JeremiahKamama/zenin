# Asset Research Workspace (ARW) — Architecture, Data & SEC Integration Audit

> **Read-only audit.** No source code was modified. Every finding is grounded in the
> current front-end at `/frontend/src` (commit `41567ad9`, branch `main`, all changes
> uncommitted). File:line citations are exact.
>
> **Purpose:** determine how to evolve ARW into an institutional research environment
> using Financial Modeling Prep (FMP), the Massive/Polygon market layer, a proposed
> SEC EDGAR integration, and Zenin's existing intelligence infrastructure — **without
> integrating SEC yet** (strategy only).

---

## 0. Executive Summary

ARW (`components/AssetResearchWorkspace.jsx`, 1108 lines) is a mature, registry-driven
single workspace per asset. It already anticipates SEC data: `DataCoverageRegistry.js`
declares `SEC_EDGAR` as the **intended primary** provider for `ownership` and `insider`
domains (`FALLBACK_CHAINS.ownership = ["SEC_EDGAR","FMP","YAHOO"]`,
`FALLBACK_CHAINS.insider = ["OPENINSIDER","SEC_EDGAR"]`). SEC integration is therefore
**pre-architected**, not greenfield — wiring it is mostly backend-adapter + panel-fill work.

**Reality vs. spec premise.** The brief states "Massive / Polygon (already integrated)."
At the *client* layer this is only partly true:
- Live `wired:true` front-end providers today: **YAHOO** (market), **FRED** + **WORLDBANK** (macro).
- `POLYGON` is declared `wired:false`; there are **zero** front-end calls to Massive/Polygon
  — `marketIntelligence.js:6` notes only that the *backend* adapter layer knows those sources.
- FMP, SEC_EDGAR, MORNINGSTAR, EIA, OPENINSIDER, CIA_FACTBOOK are all `wired:false`.

So the client currently renders market data from **Yahoo** (via backend proxy) and macro from
**FRED/World Bank**. This audit treats that as ground truth and recommends SEC fill the
ownership/insider/filings gap that FMP currently cannot.

**Top recommendations (detail in §15):**
1. Wire `SEC_EDGAR` as the ownership/insider/filings source behind the existing `DataCoverageRegistry` seam (no ARW rewrites).
2. Add a **Filings** intelligence tier fed by SEC (enhances existing tiers, does *not* need its own workspace).
3. Make the Intelligence Bus the single publish path for new filings → Intelligence Workspace / Research / Portfolio / Alerts (already half-built via `IntelligenceBus`).
4. Keep Company Profile concise; surface only SEC summary fields (business description, officers, SIC) there.

---

## 1. Workspace Inventory

ARW is one component with **three kind-branches** (stock / etf / commodity) and a shared
intelligence-panel resolver (`INTEL_VIEWS`, `AssetResearchWorkspace.jsx:531-549`).

### 1.1 Equity sidebar (`SIDEBAR_GROUPS`, lines 67-119) — 19 items, 5 groups

| Group | Tier | Purpose | Data inputs | Outputs | Deps | Source today | UI owner |
|---|---|---|---|---|---|---|---|
| Understand | Overview | Snapshot + thesis + catalysts + timeline | `useAssetReference`, `getResearch` | Hero stats, score gauge, price bands | ref hook, research svc | Yahoo + research svc | ARW |
| Understand | Company | Profile, execs, business | `useMarketIntel(profile,executives)` | Desc, sector/industry/CEO/employees, exec table | market-intel svc | **FMP** (declared, not wired) | ARW |
| Analyze | Research | Theses/notes/evidence | `getResearch` | ResearchCard, DocumentCard, EvidenceCard | research svc | Zenin (local) | ARW |
| Analyze | Financial Quality | Margins/ROE/growth | `ref.data.earnings.*` | MetricCards / `PlaceholderMetric` | ref hook | **FMP earnings** | ARW |
| Analyze | Valuation | Multiples | `ref.data.earnings.valuation` / `ref.data.finviz` | P/E, Fwd P/E, P/S, P/B | ref + finviz | FMP + finviz | ARW |
| Analyze | Ownership | Instl %, top holders, trend | `OwnershipIntelligence` | Ghost "13F not wired" | engine | **SEC EDGAR** (intended) | engine |
| Analyze | Technicals | Trend/range/series | `ref.data.series`, `realtime` | Sparkline, bid/ask | ref hook | Yahoo | ARW |
| Analyze | Catalysts | Upcoming events | `getResearch.catalysts` | CatalystCard | research svc | Zenin (local) | ARW |
| Analyze | News Intelligence | Headlines | `ref.data.news` | NewsCard | ref hook | **finviz / Yahoo** | ARW |
| Decide | Decision | Buy/hold/sell log | `useMarketIntel(decisionThreads)` | Decision rows | market-intel svc | Zenin (local) | ARW |
| Decide | Compare | Side-by-side | `onCompare` | — (action) | App | — | ARW |
| Decide | Journal | Triggers | `getResearch.triggers` | RiskCard | research svc | Zenin (local) | ARW |
| Decide | Portfolio Impact | Book effect | `asset?.isHeld` | Ghost "holdings svc not wired" | App | **none** | ARW |
| Monitor | Activity | Timeline/docs/alerts/ownership | research + intel | Timeline, DocumentCards | research svc | Zenin (local) | ARW |
| Intelligence | Supply Chain | Supplier/customer graph | `SupplyChainIntelligence` | Graph | engine | **graph seed** | engine |
| Intelligence | Geographic | Geo exposure | `GeographicIntelligence` | Map/list | engine | **CIA Factbook** (intended) | engine |
| Intelligence | Corporate Timeline | Filing/event history | `CorporateTimeline` | Timeline | engine | **SEC** (intended) | engine |
| Intelligence | Alternative | Alt data | `AlternativeIntelligence` | Cards | engine | SEC-adjacent | engine |
| Intelligence | Factor / Currency / Consensus / Risk / Overlap / Correlation / Decision Replay / Scenario Lab | 8 more engines | `INTEL_VIEWS` (lines 531-544) | varied | engines | mixed (mostly unwired) | engines |

### 1.2 ETF branch (`ETF_TIERS.workspace` via `assetRegistry.js:36-66`) — 24 ids
Registry-driven; sidebar built from `getAssetKind("etf").tiers.workspace` (`AssetResearchWorkspace.jsx:425`).
Tiers: overview, investmentThesis, portfolioIntel, ownership, supplyChain, fundComposition,
geographic, corporateTimeline, alternative, factor, currency, risk, overlap, performance,
fundFlows, macroIntel, correlation, research, consensus, catalysts, decisionReplay,
decisionLedger, scenarioLab. **Several already render `Ghost` "Unavailable — no feed wired":**
fundComposition (Top Holdings), performance (NAV/return), fundFlows (AUM/flows), macroIntel
(regime sensitivity), portfolioIntel (overlap/exposure). These are exactly the FMP/SEC gaps.

### 1.3 Commodity branch (`COMMODITY_TIERS.workspace`, `assetRegistry.js:32-35`) — 11 ids
Live data: `/api/commodities/list`, `/:symbol/price`, `/:symbol/fundamentals`
(`AssetResearchWorkspace.jsx:165-168`). Recommendation is a **transparent heuristic**
(momentum + inventory + YTD, lines 647-656), not a black box — good pattern to keep.

### 1.4 Shared research components (`CompactWorkspaceUI.jsx`)
`Section, Panel, MetricCard, MetricStrip, Badge, InsightCard, GuidedEmptyState, Skeleton,
Tag, ResearchCard, EvidenceCard, RiskCard, CatalystCard, NewsCard, DocumentCard, Timeline,
ScoreGauge, ConfidenceBadge, PlaceholderMetric, Ghost, Sparkline, SidebarGroup, SidebarItem` —
the institutional UI kit, reused everywhere (monochrome Brand v2).

### 1.5 Data adapters (`utils/assetAdapters.js`)
`AssetAdapter` base + `Stock/Commodity/Etf/Indicator/Macro` subclasses. Normalize vertical
APIs → `AssetSnapshot`. **All equity/ETF/commodity price flows go through the backend proxy
`ZENIN_API_BASE_URL`** (Yahoo/finviz/commodities). No SEC endpoint exists yet.

### 1.6 Asset registry (`utils/assetRegistry.js`)
Single source of truth for kinds, routes, tiers, universal actions. `getAssetKind(kind)` is
the only resolver openers use — no hardcoded routing. `UNIVERSAL_ACTIONS` (research, profile,
watchlist, journal, decisionLedger, compare, copySymbol) apply to every kind.

### 1.7 Research panels (`InstitutionalPanels.jsx` → `ResearchWorkspacePanel`)
Used by `research`/`risks`/`decisions` tiers across all kinds (lines 554-557, 657, 665).
Currently renders `signals={[]}` (empty) — the research *service* (`assetResearchService`)
holds theses/catalysts/triggers/documents; the panel is a thin host.

### 1.8 Routing
SPA `activeSection` + `routeState.type` (company/asset/etf/commodity/macro). ARW opens via
`buildAssetRoute("research", kind, symbol)` (`assetRegistry.js:199`). No `/app/asset` string
literals in openers.

---

## 2. Data Source Mapping (per visible field)

"Current source" = what the code actually calls today. "Ideal" = recommended owner per this audit.

| Field | Current source | Wired? | Ideal source | Notes |
|---|---|---|---|---|
| Price / change% | Yahoo via `/api/equities/stocks/:s/price` (`assetAdapters.js:53`) | ✅ | Yahoo / Polygon | Keep Yahoo; Polygon as secondary |
| 1Y series | Yahoo `/price` series | ✅ | Yahoo / Polygon | `ref.data.series` |
| 52W high/low | `ref.data.high52/low52` (FMP earnings/finviz) | partial | FMP / Polygon | `PlaceholderMetric` when missing |
| Beta | `ref.data.beta` (FMP/finviz) | partial | FMP / Polygon | line 341, 746, 926 |
| Market cap | `ref.data.marketCap` (FMP/finviz) | partial | FMP | line 339, 744 |
| Sector / Industry / Country | `ref.data` + FMP profile | partial | FMP | Company tier |
| P/E, Fwd P/E, P/S, P/B | `ref.data.earnings.valuation` / `ref.data.finviz` | partial | FMP | Valuation tier |
| Operating/Net margin, ROE | `ref.data.earnings.profitability/quality` | partial | **FMP** | Financial Quality tier |
| Revenue growth | `ref.data.earnings.growth` | partial | FMP | Financial Quality tier |
| CEO / Employees / Founded | FMP `profile` (`useMarketIntel`) | ❌ declared | **FMP** | "No CEO" Ghost today |
| Company description / business | FMP `profile.profile.description` | ❌ declared | **FMP (+ SEC 10-K Business)** | Company tier |
| News headlines | `ref.data.news` (finviz) | partial | finviz / Massive | News tier |
| Institutional ownership % | `OwnershipIntelligence` | ❌ | **SEC EDGAR 13F** | "13F not wired" Ghost |
| Top holders | `OwnershipIntelligence` | ❌ | **SEC EDGAR 13F** | "no 13F feed" Ghost |
| Ownership trend | `OwnershipIntelligence` | ❌ | **SEC EDGAR 13F (historical)** | "no historical 13F" Ghost |
| Insider trades | `DataCoverageRegistry` insider chain | ❌ | **SEC EDGAR Form 4 / OpenInsider** | not in ARW yet |
| ETF top holdings | `fundComposition` tier | ❌ | **FMP / SEC** | "no ETF holdings feed" Ghost |
| ETF AUM / flows / expense | `fundFlows`/`performance` tiers | ❌ | **FMP / Morningstar** | all Ghost |
| ETF NAV / tracking error | `performance` tier | ❌ | **FMP / Morningstar** | Ghost |
| Filings (10-K/Q, 8-K, proxies) | **none** | ❌ | **SEC EDGAR** | no filings surface exists |
| Risk Factors / MD&A / Governance | **none** | ❌ | **SEC EDGAR** | no surface exists |
| Supply chain graph | `getCommodityRelations` seed | ✅ (seed) | graph seed + SEC (customers/suppliers) | SupplyChain engine |
| Geo exposure | `GeographicIntelligence` | ❌ | CIA Factbook (intended) | engine |

**Honesty note:** ARW already renders `<Ghost label="Unavailable">` everywhere a feed is
missing — no fabricated values. This audit preserves that invariant: SEC fills the gaps,
it does not replace real data.

---

## 3. SEC API Opportunity Audit

`SEC_EDGAR` is **already in `DataCoverageRegistry.js:29`** with `wired:false` and is the
chain head for `ownership` + `insider`. Wiring it is the single highest-leverage move.

| Filing / form | Current experience | Improved experience | Business value | Complexity | Priority |
|---|---|---|---|---|---|
| **10-K** (annual) | none | Business description, risk factors, MD&A, sub-SIC in Company + new Filings tier | Core fundamental context; de-risks theses | Med (EDGAR full-text + frames) | **P0** |
| **10-Q** (quarterly) | none | Quarterly MD&A, updated risk factors, liquidity | Timelier than 10-K; tracks drift | Med | P0 |
| **8-K** (material events) | none | Real-time event stream → Intelligence Bus publish | Catches surprises pre-earnings; alerting | Low (Atom/RSS + frames) | **P0** |
| **20-F / 6-K** (foreign) | none | ADR/foreign issuer filings | Covers non-US holdings | Med | P2 |
| **DEF 14A Proxy** | none | Pay ratio, board, shareholder proposals, say-on-pay | Governance tier content | Med | P1 |
| **13F** (institutional) | "13F not wired" Ghost | Top holders, % owned, QoQ change, historical trend | Directly fills Ownership tier | Low (13F JSON on EDGAR) | **P0** |
| **Form 4** (insider) | none | Insider buys/sells, Section 16 | Insider-sentiment signal → Research | Low (Form 4 feed) | P1 |
| **S-1 / S-3** (registration) | none | Upcoming supply / new issuance | IPO/secondary watch | Low | P2 |
| **SC 13D / 13G** (activist) | none | Activist stakes, control changes | Event-driven angle | Low | P2 |
| **Governance** (proxy-derived) | none | Board independence, committee composition | Governance tier | Med | P1 |
| **Risk Factors** (10-K/Q) | none | Structured risk list, change detection vs prior | Material-changes signal | Med | P1 |
| **MD&A** | none | Narrative + extracted metrics | Qualitative context | Med | P1 |
| **Legal Proceedings** | none | Litigation exposure flags | Risk surface | Low | P2 |
| **Business Description** | FMP only | SEC 10-K Business (authoritative) | Authoritative company narrative | Low | P1 |
| **Capital Allocation** (proxy/10-K) | none | Buyback/dividend policy extraction | Quality-of-management signal | Med | P2 |
| **Executive Comp** (proxy) | none | CEO pay ratio, equity-heavy comp | Governance + alignment | Low | P2 |
| **Institutional Holdings** | Ghost | see 13F | — | — | P0 |
| **Insider Trading** | none | see Form 4 | — | — | P1 |

**Priority summary:** P0 = 13F, 8-K, 10-K, 10-Q (fills the two Ghost tiers + adds the highest-value event stream). P1 = proxy/ governance/ Form 4/ risk factors/ business description. P2 = foreign/ registration/ legal/ capital allocation/ comp.

---

## 4. Information Architecture

**Recommendation: SEC should *enhance existing tiers*, not become a standalone workspace.**

Rationale (code-grounded):
- ARW already has a mature 19/24/11-tier structure; a separate "SEC Filings" workspace would
  duplicate the header/sidebar/rail shell (`WorkspaceLayout`) and fragment the research flow.
- `DataCoverageRegistry` already models SEC as a *domain* (`ownership`, `insider`, `geo`),
  not a surface — consistent with enhancing tiers.
- The intelligence resolver (`INTEL_VIEWS`) is one switch-free map; adding a `filings`
  entry is additive, no refactor.

Proposed tier changes:
- **Ownership** tier (equity + ETF): 13F + Form 4 fill the existing Ghosts directly. No new tier.
- **Company** tier: add SEC Business Description + Officers (SIC/CIK) beneath the FMP profile.
- **New `Filings` tier** (equity + ETF): a document navigator (timeline + section reader) —
  this is the one *new* tier justified, because filings need a dedicated reading UX (§6) that
  doesn't fit Overview/Company. Keep it as one tier, not a workspace.
- **New `Governance` tier** (P1): proxy-derived board/comp/pay. Optional; can fold into Company
  if space-constrained.
- **Commodity**: SEC adds little (no filers); skip.

---

## 5. Research Workflow Audit

Institutional flow: **Price → Financials → Valuation → Earnings → SEC Filings → Ownership →
Peers → Decision.**

| Step | ARW today | Gap |
|---|---|---|
| Price | ✅ Overview/Technicals (Yahoo) | none |
| Financials | ✅ Financial Quality (FMP earnings) | margins/ROE partial |
| Valuation | ✅ Valuation (FMP/finviz) | none |
| Earnings | ⚠️ via Catalysts + upcomingEarnings chip | no earnings *transcript/actuals* surface |
| **SEC Filings** | ❌ **missing entirely** | **new Filings tier (§4)** |
| Ownership | ⚠️ Ghost "13F not wired" | **13F + Form 4 (§3 P0/P1)** |
| Peers | ⚠️ Compare action only | no auto peer set |
| Decision | ✅ Decision tier (local) | none |

**Gap verdict:** ARW supports Price→Financials→Valuation→Decision today. The **Filings →
Ownership** middle of the funnel is the missing link, and SEC closes it. Peers is a nice-to-have.

---

## 6. Filing Experience Audit

Recommendations (avoid PDF viewer / raw HTML / giant docs — per spec):

| Capability | Recommend | Why |
|---|---|---|
| Timeline | ✅ Filing timeline (10-K/Q/8-K dated) | Reuses existing `Timeline` component (line 831, 1038) |
| Reader | ✅ Section reader (accordion per item: Business, Risk Factors, MD&A, Financials) | No PDF; structured extraction |
| Search | ✅ Full-text search across a company's filings | EDGAR full-text API |
| Compare | ✅ YoY 10-K risk-factor diff | Value: catches emerging risks |
| Highlight Changes | ✅ Material-changes badge on 8-K/10-Q vs prior | Feeds Intelligence Bus |
| Bookmarks / Pinned | ✅ reuse `★ Pinned` pattern (IntelligenceCenter has it) | consistency |
| Recent Filings | ✅ "Recent" smart list in Filings tier | default view |
| Material Changes | ✅ extracted deltas → Intelligence | high signal |
| Section Extraction | ✅ named sections → Company/Governance tiers | reuses engine pattern |
| Cross References | ⚠️ link 8-K → related 10-K → ticker | P2 |
| Portfolio Impact | ✅ "X held names filed 8-K today" → Portfolio + Watchlist | reuses `affectedHoldings` (IntelligenceBus) |
| Watchlist Impact | ✅ same, for watchlist | reuses bus |

**Avoid:** inline PDF embed, raw EDGAR HTML, dumping whole documents. Parse to sections server-side.

---

## 7. Workspace Tier Audit (new tiers justified?)

| Proposed tier | Value | Complexity | Priority | Verdict |
|---|---|---|---|---|
| **Filings** | High (closes workflow gap) | Med | P0 | **Add (1 tier)** |
| Governance | Med | Med | P1 | Add or fold into Company |
| Capital Allocation | Low-Med | Med | P2 | Defer |
| Legal | Low | Low | P2 | Defer (fold into Filings) |
| Corporate Actions | Med | Med | P2 | Separate from SEC (use issuer data) |
| Institutional Ownership | — | — | — | **Enhances existing Ownership tier** (no new tier) |
| Management | Med | Low | P1 | Fold into Company (officers from SEC) |

**Verdict:** exactly **one new primary tier (Filings)** is justified now; Governance is
optional. Everything else *enhances* existing tiers. This keeps the sidebar from bloating.

---

## 8. Data Ownership — Responsibility Matrix

Per `DataCoverageRegistry.PROVIDERS` (lines 24-40) + adapters + tiers. No overlaps.

| Domain | Primary (recommended) | Secondary | Zenin-generated | Today (wired) |
|---|---|---|---|---|
| Market price/series | Yahoo | Polygon | — | Yahoo ✅ |
| Market breadth/momentum | Yahoo | Polygon | `marketIntelligence.js` (pure calcs) | Yahoo ✅ |
| Macro (rates/CPI) | FRED | World Bank | regime model | FRED/WB ✅ |
| Equities fundamentals | **FMP** | Yahoo | — | FMP ❌ (declared) |
| Valuation multiples | **FMP** + finviz | Yahoo | — | FMP/finviz partial |
| Earnings/margins | **FMP** | — | — | FMP partial |
| Company profile/execs | **FMP** | SEC (Business) | — | FMP ❌ |
| Institutional ownership | **SEC EDGAR 13F** | FMP | — | SEC ❌ (Ghost) |
| Insider trades | **SEC EDGAR Form 4** | OpenInsider | — | SEC ❌ |
| ETF holdings/AUM/flows | **FMP** | Morningstar | — | FMP/M* ❌ (Ghost) |
| Filings (all forms) | **SEC EDGAR** | — | filing parser | SEC ❌ |
| Governance/Comp | **SEC EDGAR (proxy)** | — | extractor | SEC ❌ |
| Supply chain | graph seed | SEC (customers) | `assetGraph` | seed ✅ |
| Geo exposure | **CIA Factbook** | World Bank | — | ❌ |
| News | finviz / Massive | Yahoo | — | finviz partial |
| Risk Factors / MD&A | **SEC EDGAR** | — | extractor | ❌ |

**Separation principle (constraint):** FMP = fundamentals/valuations/ETF structure; SEC =
ownership/insider/filings/governance; Yahoo/Polygon = market; Zenin = calculations +
intelligence. No provider does another's job.

---

## 9. Intelligence Integration

Current capability: `IntelligenceBus` (`utils/intelligenceBus.js`) already has
`publish(event)`, `subscribeEvents`, `publishRegime`, `getEvents` — and the new
`IntelligenceWorkspace` renders a consolidated feed. ARW panels already declare SEC gaps in
copy ("SEC EDGAR 13F not yet wired").

Proposed publish flow (no new infrastructure, reuse bus):

```
SEC 8-K / 13F / 10-K  ──(backend adapter)──►  IntelligenceBus.publish({
  type: "filing",
  symbol, formType, filedAt, material: bool,
  title: "AAPL 8-K: Material Agreement",
  severity: material ? "high" : "low",
})
        │
        ├─► Intelligence Workspace  (filings feed + Material Changes)
        ├─► ARW Filings tier        (pinned/recent)
        ├─► Research                (auto-link to open thesis)
        ├─► Portfolio               (affectedHoldings → exposure flag)
        ├─► Watchlist               (watchlisted symbol filed)
        └─► Alerts                  (material 8-K push)
```

Required improvements:
1. Backend SEC adapter publishes to the bus (currently only `publishRegime` is exercised by Macro).
2. ARW `OwnershipIntelligence` consumes the new 13F feed instead of Ghost.
3. `IntelligenceCenter` (the workspace Center) gets a `filings` event kind in its timeline.

No UI rewrites needed — the bus is the seam.

---

## 10. Company Profile Integration

`CompanyProfilePage.jsx` currently has its **own** Intelligence Center mount removed in the
Phase 2 refactor; it should stay concise. SEC fields that belong in Company Profile (keep short):
- Business description (1-2 sentences, SEC 10-K Business, authoritative vs FMP).
- Officers/CIK/SIC (compact table — reuse the exec table pattern at `AssetResearchWorkspace.jsx:985-997`).
- Incorporation state.

**Do NOT** put full filings/risk factors/governance in Company Profile — those live in the ARW
Filings / Governance tiers. Company Profile remains a <1-scroll summary; ARW is the deep dive.

---

## 11. Performance Strategy

Grounded in existing patterns (`assetAdapters.js`, `useAssetReference`, `IntelligenceBus`):
- **Fetch strategy:** backend proxy aggregates per vertical (`/api/equities/...`,
  `/api/commodities/...`); keep that. Add `/api/sec/:symbol/filings`, `/:symbol/ownership(13f)`,
  `/:symbol/insider(form4)` as new backend routes — front-end only calls the proxy.
- **Caching:** `resilientData` already caches (`macro-indicators`, `earnings-calendar`, etc.,
  per prior audit). Add `sec-filings`, `sec-13f`, `sec-form4` cache keys; 13F is quarterly →
  long TTL; 8-K → short TTL + push invalidation on bus publish.
- **Lazy loading:** ARW already mounts engines on tier switch (no upfront cost). Filings tier
  lazy-loads the filing reader; 13F lazy-loads into Ownership.
- **Pagination / streaming:** Filings list paginates (EDGAR returns many); 8-K stream via bus,
  not polling.
- **Background refresh:** replicate `commodityRefresh`/`etfRefresh` pattern (lines 160-197) —
  explicit refresh buttons + on-open fetch; no aggressive polling.
- **Rate limiting:** EDGAR asks for a User-Agent + ≤10 req/s. Backend adapter must throttle +
  cache; front-end never hits EDGAR directly (honors the adapter seam).
- **Provider fallbacks:** already specified in `FALLBACK_CHAINS` — set `SEC_EDGAR.wired=true`
  when backend route lands; chain degrades to FMP/Yahoo honestly if SEC down.

---

## 12. UI Audit (filing presentation)

- **Do:** timeline (reuse `Timeline`), section reader (accordion), document navigator
  (left rail of Filings tier), diff viewer (YoY risk-factor), material-changes badge,
  reading-progress (thin top bar), cross-references (8-K↔10-K link).
- **Don't:** PDF viewer, raw HTML, full-document dump.
- **Monochrome:** reuse `Brand v2` tokens; severity via weight/border/opacity (no hue) — same
  rule as the Intelligence Center.
- Reuse existing components: `Timeline` (§1.4), `Ghost`/`PlaceholderMetric` (honest empty),
  `★ Pinned` pattern, `DocumentCard`. No new primitives needed beyond a `FilingReader` accordion.

---

## 13. Competitive Benchmark

| Capability | Bloomberg | FactSet | Koyfin | AlphaSense | Zenin today | Gap → achievable |
|---|---|---|---|---|---|---|
| Price/series | ✅ | ✅ | ✅ | n/a | ✅ | — |
| Fundamentals/valuations | ✅ | ✅ | ✅ | n/a | partial (FMP) | wire FMP |
| **Filings + full-text search** | ✅ | ✅ | partial | ✅ (AI) | ❌ | **SEC P0** |
| **Ownership (13F/insider)** | ✅ | ✅ | partial | n/a | ❌ Ghost | **SEC P0/P1** |
| **Material-change detection** | ✅ | ✅ | partial | ✅ | ❌ | diff viewer P1 |
| Governance/comp | ✅ (BvD) | ✅ | ❌ | partial | ❌ | proxy P1 |
| Research/notes (local) | ✅ (Notes) | ✅ (RF) | ❌ | ✅ | ✅ (theses) | — |
| Intelligence feed | ✅ (FirstWord) | ❌ | ❌ | ❌ | ✅ (new workspace) | extend w/ filings |
| Scenario lab | ✅ | ✅ | partial | n/a | ✅ (ScenarioLab) | — |

**Zenin's defensible edge:** unified Intelligence Bus + local research + scenario lab already
exist. Adding SEC closes the single biggest institutional gap (filings/ownership) at low
complexity, lifting Zenin from "retail-grade fundamentals" to "institutional research surface"
without rebuilding anything.

---

## 14. Future Architecture (long-term ARW)

Each tier: Purpose / Inputs / Primary / Secondary / Zenin-intel.

| Tier | Purpose | Inputs | Primary | Secondary | Zenin-intel |
|---|---|---|---|---|---|
| Overview | Snapshot + thesis | ref + research | Yahoo | Polygon | Research Score |
| Financial Quality | Margins/returns | earnings | FMP | — | quality flags |
| Valuation | Multiples | earnings/finviz | FMP | Yahoo | cheapness vs peers |
| **Filings** | 10-K/Q/8-K reader | SEC frames | **SEC EDGAR** | — | material-change diff |
| **Ownership** | 13F + insider | SEC 13F/Form4 | **SEC EDGAR** | FMP | concentration (HHI) |
| **Governance** | Board/comp/proxy | SEC proxy | **SEC EDGAR** | — | independence score |
| Company | Profile/execs | FMP + SEC Biz | FMP | SEC | — |
| Research | Theses/notes | research svc | Zenin | — | evidence cards |
| Catalysts | Events | research + SEC 8-K | Zenin + SEC | — | bus publish |
| News | Headlines | finviz/Massive | finviz | Massive | — |
| Scenario Lab | What-ifs | user | — | — | local model |
| Intelligence Rail | Cross-surface | bus | Zenin | — | publish/subscribe |

Macro/Commodity/ETF branches mirror this with kind-appropriate tiers (ETF adds Fund
Composition/Flows from FMP/Morningstar; Commodity keeps its supply/demand tiers).

---

## 15. Roadmap

### Quick Wins (1–2 days)
1. **Declare SEC wired in registry** once backend route exists; flip `SEC_EDGAR.wired=true`
   (`DataCoverageRegistry.js:29`). No UI change — tiers light up.
2. **8-K → Intelligence Bus publish** from backend; appears in new Intelligence Workspace
   (bus + workspace already built).
3. Add `filings` + `ownership` provenance to `buildProvenance` so panels show "SEC EDGAR · Live".

### Medium (1–2 weeks)
4. **Filings tier** (equity + ETF): `INTEL_VIEWS.filings = FilingsIntelligence`; timeline +
   section reader + material-changes badge (reuses `Timeline`, `Ghost`, `DocumentCard`).
5. **13F fill Ownership tier**: replace the three Ghosts in `OwnershipIntelligence.jsx` with
   real top-holders / % / trend from the SEC backend route.
6. **Form 4 insider** feed → new Insider subsection or Research signal.

### Major (1–2 months)
7. **Proxy/Governance tier** (DEF 14A extraction: board, pay ratio, proposals).
8. **Material-change diff engine** (YoY 10-K risk-factor compare → Intelligence).
9. **Portfolio/Watchlist impact** of filings (reuse `affectedHoldings` from IntelligenceBus).
10. **Competitive parity pass**: full-text filing search (AlphaSense-style) on EDGAR full-text.

| Initiative | Complexity | Business impact | Tech risk | Dependencies |
|---|---|---|---|---|
| 8-K→Bus | Low | High (real-time alerts) | Low | backend SEC route |
| 13F fill | Low | High (fills Ghost) | Low | backend 13F route |
| Filings tier | Med | High | Med | filing parser (backend) |
| Governance | Med | Med | Med | proxy extractor |
| Diff engine | Med | Med-High | Med | versioned filing store |
| Portfolio impact | Med | High | Low | existing bus |

---

## 16. Deliverables Checklist

- [x] Executive summary (§0)
- [x] Current architecture (§1)
- [x] Provider responsibility matrix (§8)
- [x] FMP coverage analysis (§2, §8)
- [x] Massive/Polygon coverage analysis (§0, §8 — note: client-layer Yahoo today)
- [x] SEC API opportunity analysis (§3)
- [x] UX findings (§5, §6, §12)
- [x] Information architecture recommendations (§4)
- [x] Filing UX recommendations (§6)
- [x] Performance strategy (§11)
- [x] Competitive benchmarking (§13)
- [x] Prioritized implementation roadmap (§15)

**Constraint compliance:** read-only (no code modified); no duplicate providers recommended
(SEC owns filings/ownership/insider/governance; FMP owns fundamentals/valuation/ETF; Yahoo/Polygon
own market; Zenin owns calculations + intelligence); clear separation per §8.
