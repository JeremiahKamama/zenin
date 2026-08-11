# Company Profile Aggregation Service — Phase 1 Audit

## Current Architecture

### Production path (today)

```text
CompanyProfilePage.jsx
  ↓
GET /api/company-profile?symbol=AAPL&theme=&category=
  ↓
backend/index.js route
  ↓
spawn python backend/fetch_company_profile.py
  ↓
Yahoo Finance (yfinance)  ──┐
Finviz (scrape + parse)   ──┼──→ merged JSON response
SEC EDGAR                 ──┘
```

Caching:
- Runtime in-memory cache (`Map`)
- Persistent PostgreSQL `service_snapshots` table
- Request collapsing via `withInflightDedup`
- TTL: 15 minutes

### Market Intelligence path (exists but unused by frontend)

```text
GET /api/market/company/:symbol/profile
  ↓
backend/market-intel/application/MarketIntelligenceService
  ↓
FmpProvider
  ↓
Financial Modeling Prep /profile/:symbol
```

Current FMP mapper returns only basic identity + market-cap/employees. It is too thin to replace production.

---

## Frontend Field Inventory

`frontend/src/components/CompanyProfilePage.jsx` consumes the following fields from `/api/company-profile`:

### Identity / company

| Field | Usage |
|-------|-------|
| `symbol` | Header, cache key |
| `name` | Company name fallback |
| `shortName` | (available in payload) |
| `summary` | Header description, framework context |
| `website` | Business bullets |
| `phone` | (available in payload) |
| `exchange` | Framework bullets |
| `currency` | Money formatting |
| `sector` | Snapshot bullets |
| `industry` | Moat / peer context |
| `country`, `state`, `city`, `zip`, `address1` | Location, headquarters |
| `employees` | Snapshot bullets |

### Financials / valuation

| Field | Usage |
|-------|-------|
| `marketCap` | Stat card, framework bullets |
| `totalRevenue` | Stat card, framework bullets |
| `enterpriseValue` | Cash-flow / defense bullets |
| `currentPrice` | (available in payload) |
| `fiftyTwoWeekLow` / `fiftyTwoWeekHigh` | Returns bullets |
| `beta` | Returns bullets |
| `trailingPE` / `forwardPE` | Valuation bullets |
| `priceToBook` | (available in payload) |
| `priceToSales` | Valuation bullets |
| `enterpriseToRevenue` / `enterpriseToEbitda` | (available in payload) |
| `dividendYield` | Governance / energy bullets |
| `revenueGrowth` | Framework growth bullets |
| `earningsGrowth` | Framework growth bullets |
| `grossMargins` / `operatingMargins` / `ebitdaMargins` / `profitMargins` | Profitability / moat bullets |
| `freeCashflow` / `operatingCashflow` | Cash-flow / energy bullets |
| `returnOnAssets` / `returnOnEquity` | Returns bullets |
| `totalCash` / `totalDebt` | Balance-sheet / risk bullets |
| `debtToEquity` | Balance-sheet / risk bullets |
| `currentRatio` / `quickRatio` | Balance-sheet bullets |
| `targetMeanPrice` / `targetHighPrice` / `targetLowPrice` | Stat card, governance, catalyst bullets |
| `analystRating` / `analystCount` | Governance bullets |
| `topAnalystTarget` / `topAnalystAgency` | Stat card (Finviz-derived) |

### Earnings

| Field | Usage |
|-------|-------|
| `earnings.nextEarnings` | Stat card, framework bullets |
| `earnings.eps.consensus` / `earnings.eps.previous` | (available in payload) |
| `earnings.revenue.consensus` / `earnings.revenue.previous` | (available in payload) |
| `earningsHistory[].date` | Recent earnings table |
| `earningsHistory[].epsEstimate` | Recent earnings table |
| `earningsHistory[].reportedEps` | Recent earnings table |
| `earningsHistory[].surprisePct` | Recent earnings table |

### Leadership

| Field | Usage |
|-------|-------|
| `leadership[].name` / `.title` / `.age` | Leadership summary |

### Risk

| Field | Usage |
|-------|-------|
| `risk.overallRisk` / `risk.auditRisk` / `risk.boardRisk` / `risk.compensationRisk` / `risk.shareHolderRightsRisk` | Governance / risk bullets |

### Filings

| Field | Usage |
|-------|-------|
| `filings.latestAnnualReport.form` / `.filingDate` / `.url` | Latest filings card |
| `filings.latestQuarterlyReport.*` | Latest filings card |
| `filings.latestCurrentReport.*` | Latest filings card |
| `filings.sicDescription` / `.sic` | Filing bullets |
| `filings.fiscalYearEnd` | Filing bullets |
| `filings.stateOfIncorporation` | Filing bullets |
| `filings.facts.capitalExpenditures.value` | Capital-source bullets |
| `filings.facts.sharesOutstanding.value` | Capital-source bullets |

### Research enrichment

| Field | Usage |
|-------|-------|
| `research.overview` / `.regulatory` / `.capitalAllocation` / `.operations` / `.customers` / `.businessModel` / `.catalysts` / `.risks` / `.governance` | Framework bullets |

### Sources & peers

| Field | Usage |
|-------|-------|
| `sources[].label` / `.url` / `.status` / `.usedFor` | Source coverage card |
| `peers[].symbol` / `.name` / `.theme` / `.category` | Peer summary |

### Manufacturing / catalog

| Field | Usage |
|-------|-------|
| `manufacturing.factoryFootprint` / `.efficiencySignals` / `.customerFulfillment` / `.inputExposure` | Operations / supply-chain bullets |
| `catalog.theme` / `.category` / `.role` / `.edge` / `.market` | Added by backend enricher |

### Finviz

| Field | Usage |
|-------|-------|
| `finvizMetrics` | Financial-performance grid |
| `finviz.summary` (alt path used by Market Intel tab) | Snapshot overview |

---

## Backend Response Fields (current Python pipeline)

`fetch_company_profile.py` returns the following top-level fields:

```text
symbol, name, shortName, website, phone, exchange, currency,
sector, industry, country, state, city, zip, address1, summary,
employees, marketCap, enterpriseValue, currentPrice,
fiftyTwoWeekLow, fiftyTwoWeekHigh, beta, trailingPE, forwardPE,
priceToBook, enterpriseToRevenue, enterpriseToEbitda, dividendYield,
totalRevenue, revenueGrowth, earningsGrowth, grossMargins,
operatingMargins, ebitdaMargins, profitMargins, freeCashflow,
operatingCashflow, returnOnAssets, returnOnEquity, totalCash,
totalDebt, debtToEquity, currentRatio, quickRatio, targetMeanPrice,
targetHighPrice, targetLowPrice, analystRating, analystCount,
topAnalystTarget, topAnalystAgency, finvizMetrics,
earnings.nextEarnings, earnings.eps.consensus/previous,
earnings.revenue.consensus/previous, earningsHistory[],
leadership[], risk.{overallRisk,auditRisk,boardRisk,compensationRisk,shareHolderRightsRisk},
filings.{latestAnnualReport,latestQuarterlyReport,latestCurrentReport,sicDescription,sic,fiscalYearEnd,stateOfIncorporation,facts},
research.{overview,regulatory,capitalAllocation,operations,customers,businessModel,catalysts,risks,governance},
sources[], regulators{fda,usaspending}
```

Backend enricher adds:

```text
catalog.{theme,category,role,edge,market}, peers[], manufacturing,
companyProfileHash, updatedAt, stale, unavailable, stale_reason
```

---

## FMP Coverage Gaps

Current `backend/market-intel/providers/financial-modeling-prep/mappers.js` `mapCompanyProfile` returns:

```text
symbol, name, exchange, currency, sector, industry, description,
ceo, website, logoUrl, country, marketCap, sharesOutstanding (BUG: maps volAvg),
employees, phone, address, city, state, zip, isin, cik, ipoDate, asOf
```

Missing compared to production:

- All valuation ratios (PE, PS, PB, EV/*, beta)
- All margin metrics
- All growth metrics
- Cash-flow metrics
- Balance-sheet metrics (cash, debt, ratios)
- Analyst targets / ratings
- Earnings calendar / history / surprises
- SEC filings
- Leadership / executives
- Risk scores
- Research enrichment
- Sources / peers

The FMP API *can* supply most of these, but it requires calling many endpoints, not just `/profile`.

### Known bug

```js
sharesOutstanding: numOrNull(d.volAvg), // wrong field
```

FMP profile DTO has `sharesOutstanding`. The mapper should use that, not `volAvg`.

---

## Compatibility Findings

1. **Frontend is tightly coupled to the current flat response shape.** It expects `profile.marketCap`, `profile.totalRevenue`, `profile.earnings.nextEarnings`, etc. Any new aggregator must return these exact paths.
2. **The Python pipeline is the only source for Finviz scraping and SEC enrichment today.** Moving completely away from it would lose `finvizMetrics`, `filings`, `regulators`, and `research` unless those are reimplemented.
3. **FMP is the best primary source for structured financials**, but one endpoint is not enough. A multi-endpoint FMP provider is required.
4. **Existing cache infrastructure is solid** (runtime + PostgreSQL + request collapsing) and can be reused.
5. **No Redis or circuit-breaker library exists** yet; they would be new additions.

---

## Recommendations

1. Build the aggregation layer in Node.js inside the backend so it can reuse the existing cache and request-dedup infrastructure.
2. Implement an expanded FMP provider that calls `/profile`, `/quote`, `/key-metrics`, `/ratios`, `/financial-growth`, `/enterprise-values`, `/rating`, `/earnings-surprises`, `/sec-filings`, and the three financial statements.
3. Keep the existing Python script as a **legacy fallback provider** initially so Finviz/SEC enrichment is not lost while Node.js providers are built.
4. Normalize every provider's output into a canonical `CompanyProfile` model, then render it back to the flat production shape.
5. Wire `/api/company-profile` to the new service; leave `CompanyProfilePage.jsx` untouched.
6. Add provider-level timeouts, confidence metadata, and structured logging without blocking the initial ship.
