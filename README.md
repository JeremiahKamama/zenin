# Zenin

Zenin is a multi-asset investment intelligence workspace for individual investors. It brings portfolio context, market data, research, macro events, and decision workflows into one place so users can understand what may affect their investments—not simply track prices.

> Zenin provides research and decision-support tools only. It is not investment, tax, legal, or financial advice.

## What Zenin can do

- **Home:** Review portfolio snapshot, performance, positions, movers, market context, saved views, alerts, and next-step handoffs.
- **Watchlist:** Search, add, import, organise, and monitor multi-asset watchlists; inspect earnings and macro context; save shared desk views where the workspace plan allows it.
- **Research:** Open contextual asset research from a Watchlist, Portfolio, Home, or Intelligence surface, with portfolio-aware actions and related-market handoffs.
- **Portfolio:** Track holdings, valuation, performance, exposure, rebalance planning, trade records, exports, alerts, and persisted workspace views.
- **Intelligence and Analytics:** Review market signals, event calendars, macro regime context, research queues, cross-market analytics desks, and provider health.
- **Options and predictions:** Explore options chains, strategy/calculator workflows, whale activity, and prediction-market snapshots.
- **Journal and tax:** Capture trade decisions and reviews, inspect outcomes, and estimate tax scenarios from recorded activity.

## Supported assets and research behavior

| Asset class | Examples | Primary Zenin surface | Data behavior |
| --- | --- | --- | --- |
| Stocks | `AAPL`, `NVDA` | Asset / company research | Price-bearing when provider coverage is available; company and earnings research is provider-dependent. |
| Crypto | `BTC`, `ETH` | Asset research and crypto analytics | Price-bearing when supported by the configured market-data provider. |
| Commodities | Gold, oil, copper | Commodity research | Market and reference coverage vary by contract and provider. |
| ETFs | `SPY`, `IWM` | ETF research | Fund-focused research and comparison surfaces; live quote and holdings coverage is provider-dependent. |
| FX pairs | `EUR/USD`, `USD/CHF` | Currency Research Workspace, pair mode | Price-bearing when FX quote/history data is available. |
| Currency codes | `USD`, `EUR` | Currency Research Workspace, currency mode | Macro/research entities, not standalone traded instruments; they do not receive fabricated price data. |
| Macro indicators | Country or economic indicators | Macro research and Analytics | Calendar and macro-series coverage vary by country and source. |
| Bonds | Sovereigns and fixed-income instruments | Watchlist / Portfolio context | Coverage depends on the configured provider and instrument. |
| Options | Equity and crypto options | Options workspace | Chain, Greek, and trade-tape coverage vary by venue and provider. |

Data freshness, source coverage, and availability vary by instrument and upstream provider. Zenin surfaces cached, stale, unavailable, and reference-only states where the underlying data does not support a live result.

## Product capabilities

### Home and Portfolio

- Portfolio snapshot, performance controls, positions, movers, risk and market-context handoffs.
- Holdings, allocation and exposure views, instrument-class buckets, saved views, exports, alerts, and rebalance planning.
- Authenticated workspace persistence for portfolio, balances, trades, saved views, and decision-support records.
- Guest mode can preview the workspace without representing local preview actions as live brokerage execution.

### Watchlist

- Search and add Stocks, Crypto, Bonds, Indicators, Commodities, ETFs, and Currencies / FX.
- Categorised Watchlists, stock themes, tracked ordering, shared desk views, and plan-gated shared Watchlist access.
- Import symbols or rows from supported text, CSV/TSV, spreadsheet, platform, and document workflows.
- Earnings context for tracked stocks, macro-indicator context, alert assignments, and journal/research handoffs.

### Asset and market research

- Contextual Asset Modal with watchlist, research, portfolio, desk, journal, profile, and comparison actions where supported.
- Company, commodity, macro, ETF, and Currency Research Workspaces.
- ETF-specific reference fields and comparisons; no stock-only company metrics are presented as ETF data.
- FX-pair research distinguishes a tradable pair from a standalone currency research entity.
- Intelligence views bring together event timelines, transmission paths, affected holdings, market signals, macro regime context, and research queues.

### Options, predictions, journal, and tax

- Equity and crypto options workflows, options calculator, strategy simulator, and whale-trade views.
- Polymarket-based prediction snapshots, category browsing, and market detail views.
- Trade journal, decision records, calendar P&L, outcome review, and analytics.
- Indicative tax-estimation workflows for supported jurisdictions.

Strategy probabilities, tax estimates, and prediction-market signals are informational outputs. They should be independently reviewed before any investment decision.

## Data sources and integrations

Zenin uses a mix of provider APIs and reference-data adapters. Current integrations include:

- **Yahoo Finance / yfinance** for TradFi search, history, earnings, and fundamentals.
- **Finviz** for market intelligence and supplemental company metrics.
- **Hyperliquid** for crypto market context and fallback spot data.
- **Polymarket Gamma API** for prediction-market snapshots and market detail.
- **Derive/Lyra and Deribit routes** for options data, depending on the workflow and configured provider.
- **Forex Factory** for economic-calendar and indicator mapping.
- **CoinGecko** for supplemental crypto metadata.
- **ETFdb worker** for optional ETF research enrichment when explicitly enabled and available.
- **Telegram MTProto** for optional whale-flow ingestion.

Upstream services can be rate-limited, incomplete, delayed, or unavailable. ETF live data is not guaranteed; the product may fall back to reference data or show a clear unavailable state instead of manufacturing values.

## Architecture

```text
frontend/  React + Vite single-page application
backend/   Express API, market-data adapters, workspace persistence, auth
admin/     Administrative application
docs/      Product, architecture, and audit documentation
```

The frontend uses the backend API for session-aware workspace data, search, market data, research, portfolio, Watchlist, options, and analytics workflows. PostgreSQL is the primary persistence layer.

## Local development

### Prerequisites

- Node.js 20+ (required by the backend; recommended for the frontend)
- npm
- Python 3.9+
- PostgreSQL, local or managed

### Configure environment

Start from the checked-in templates:

- [frontend/.env.example](frontend/.env.example)
- [backend/.env.example](backend/.env.example)

At minimum, configure a reachable PostgreSQL `DATABASE_URL` for backend persistence. Set `VITE_API_URL` in the frontend when the API is not served from the default environment.

Provider keys, billing, email, brokerage, OAuth, error monitoring, and optional ingestion features are configured in the respective environment templates. Do not commit real credentials.

### Install dependencies

```bash
# Backend
cd backend
npm install
python3 -m pip install -r requirements.txt

# Frontend (run from the repository root after completing backend setup)
cd ../frontend
npm install
```

### Run locally

In one terminal:

```bash
cd backend
npm run dev
```

In another terminal:

```bash
cd frontend
npm run dev
```

The development frontend is served by Vite. Open `/app` for the authenticated application; `/app?guest=1` is an explicit guest-preview entry point.

## Useful commands

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run lint:all
npm run audit:design
```

### Backend

```bash
cd backend
npm run dev
npm test
npm run test:integration
```

Backend integration tests require PostgreSQL connectivity. If the test environment cannot reach the configured database, investigate the connection configuration before treating the result as application verification.

## API and deployment

The backend API is organised around these capability groups:

- **Auth and workspaces:** session, account, workspace membership, plans, and settings.
- **Market data and search:** asset search, prices, history, FX, earnings, macro, and economic calendar data.
- **Portfolio and Watchlist:** holdings, balances, trades, execution records, Watchlist persistence, imports, and alerts.
- **Research and analytics:** company profiles, intelligence, macro, commodities, analytics, and provider status.
- **Options and predictions:** options data, saved calculations, whale trades, and prediction-market snapshots.
- **Administration:** protected user, platform, billing, incident, integration, and coverage controls.

Deployment configuration is maintained in [render.yaml](render.yaml), [vercel.json](vercel.json), [frontend/vercel.json](frontend/vercel.json), and [backend/vercel.json](backend/vercel.json). Use the service-specific environment templates for deployment configuration; operational migrations and administrative procedures are intentionally not maintained in this top-level README.

## Current limitations

- Provider coverage, market hours, rate limits, and uptime vary by asset class and instrument.
- Some results may be cached, stale, unavailable, or reference-only.
- Connected-account capability is provider-dependent; do not assume every connected venue supports live order routing.
- OAuth and multi-factor authentication availability depends on deployed provider credentials and enabled server configuration.
- Tax estimates, strategy outputs, and prediction-market insights are informational and may not reflect an investor’s complete circumstances.

## Contributing and operational notes

Keep user-facing claims tied to implemented routes and configured adapters. When adding a provider or asset class, document its coverage, freshness behavior, fallback state, and limitations alongside the feature.
