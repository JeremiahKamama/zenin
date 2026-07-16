# Sec API Document Intelligence Integration — Execution Plan

Scope per spec, split into Phase 1 (core, this pass) and Phase 2 (ETF N-PORT, deferred per spec ordering "after core is stable").

## Phase 1 — Equity research + alerts (build target)

### Backend
1. **Adapters** (`backend/services/providers/DocumentIntelligenceProvider/`)
   - Rename `SECAPIProvider.js` → `SecEdgarAdapter.js` (no-key fallback, behavior preserved). Keep `SEC_API_PROVIDER` env still selectable for parity but document it as the EDGAR fallback.
   - Add `SecApiIoClient.js` — HTTPS client to `https://api.sec-api.io` with `Authorization: <SEC_API_IO_KEY>`, timeout (`SEC_API_IO_TIMEOUT_MS=12000`), retries, rate-limit (429) handling, error mapping. All raw query construction lives here.
   - Add `SecApiIoAdapter.js` — implements the full provider interface via SecApiIoClient: Filing Query (10-K/10-Q/8-K/DEF 14A/S-1/S-3/13D/13G), Extractor (Business/Risk/MD&A/Legal Proceedings), XBRL (income/balance/cashflow), Form 4, 13F, fund filings (N-PORT etc. stubbed unavailable). Enabled only when `SEC_API_IO_KEY` present; else adapter reports `entitlement-missing`.
   - `Provider.js` selects `SecApiIoAdapter` when key present, else `SecEdgarAdapter`. **Never** call EDGAR for sections/XBRL/Form4/13F/N-PORT — return explicit `unavailable` capability instead.
   - Extend `Normalizer.js` + `Types.js` with the response envelope: `{ provider, fetchedAt, freshness, sourceUrl, accessionNumber, data }`.
2. **Routes** (`routes.js`) — add canonical + legacy aliases:
   - `GET /api/document/:ticker/company` (canonical) + `GET /api/document/company/:ticker` (alias, current path).
   - `GET /api/document/:ticker/filings`, `/filings/:accessionNumber`, `/sections?accessionNumber=&sections=`, `/financials?accessionNumber=`, `/insiders`, `/ownership`, `/corporate-actions`, `/fund-filings`. (All return normalized envelope; EDGAR-only capabilities return `unavailable` honestly.)
3. **Event pipeline** (`backend/market-intel/`)
   - Add event types `FILING_MATERIAL`, `INSIDER_TRANSACTION`, `OWNERSHIP_CHANGE`, `FUND_REGULATORY_UPDATE` to `domain/models.js` + `infrastructure/database.js` (`market_events`).
   - Add `SecApiStreamWorker` — starts only when `SEC_API_IO_STREAM_ENABLED=true`; server-side auth, capped exponential backoff reconnect, dedup by `(accessionNumber, eventType)`. Persists to `market_events`, matches watchlists/holdings, creates `market_portfolio_signals` + in-app notifications. Alert only on 8-K/10-K/10-Q/13D/13G and material Form 4 (threshold). Routine filings stay in ARW timeline, no notification.
   - Frontend `IntelligenceBus` publication is **not** the source of truth — backend ingestion/ dedup/ matching/ alerts only. Browser renders persisted events.

### Frontend
4. **Hook/data** — extend `useDocumentIntelligence` to consume new envelopes (`provider`, `freshness`, `sourceUrl`); correct corporate-actions parsing to `response.corporateActions`.
5. **Surfaces** — wire normalized data into: Asset Modal regulatory panel, Equity ARW (filing timeline/viewer/sections/XBRL/ownership/insiders/actions), Research workspace (cited sources), Intelligence/Analytics panels (replace ghost ownership/insider/filings/risk-factor/corporate-timeline/MD&A), Watchlist/Home/Portfolio (persisted material-filing alerts only). ETF surfaces use fund-regulatory language only; never company-only fields.

### Tests (real verification path, no live key needed)
- Adapter unit tests mock `SecApiIoClient` HTTP for filing/extractor/XBRL/Form4/13F; assert normalization, pagination, source URLs, cache TTL, rate-limit (429) → unavailable, EDGAR fallback.
- Route tests: canonical + legacy company path, envelope shape, invalid ticker, missing accession, key-absent → unavailable.
- Event tests: dedup, materiality classification, watchlist/portfolio match, notification creation, no duplicate after restart.

## Phase 2 — ETF N-PORT (deferred)
Scaffold `getFundHoldings` (unavailable until built), N-PORT/N-CSR/N-CEN/485BPOS/497K filing search, ETFdb-vs-N-PORT comparison. Started only after Phase 1 stable.

## Verification gates
- `npm run build` (frontend) + `npm test` (backend adapter/route/event suites) green.
- Live Sec API calls require `SEC_API_IO_KEY` (user-provided). Without it: adapter degrades to explicit `unavailable`; tests use mocks.
- Rendered check (your standing rule) for the new panels at 800/470px once wired.

## Assumptions / defaults taken
- Phase 1 only this pass; Phase 2 scaffolded but not activated.
- No commit/PR unless asked.
- Build against documented Sec API shapes; live verification pending key.
