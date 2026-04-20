# Zenin

Zenin is a multi-asset trading dashboard that combines portfolio management, options analytics, prediction-market tracking, and journal/reporting workflows with a PostgreSQL-backed backend.

This README reflects the current implementation in this repository.

## What the web app can do

#### 1) Home
- Account and balance summary cards with trend indicators
- Portfolio performance chart with interval (`1D` to `MAX`) and mode controls (Area, Bar, Line)
- Top positions by value with live price/gain overlays
- Top movers (gainers/losers) with timeframe selector (`daily`, `weekly`, `quarterly`, `ytd`, `yearly`)

### 2) Watchlist
- Category-based asset browsing (stocks, crypto, bonds, metals, commodities, indicators)
- Starred/watchlist-only views with ordering preserved from DB
- TradFi/crypto/indicator search with fuzzy matching
- Stock theme filters (default + custom themes)
- Earnings calendar cards for stock watchlist symbols
- Macro indicators view for G7 countries (USA, CAN, GBR, FRA, DEU, ITA, JPN)

### 3) Company Profile
- Deep-dive fundamental research framework for stocks (Defense, Energy, AI, Robotics, Pharma, etc.)
- Integrated **Finviz Market Intel**:
  - Analyst ratings & price targets
  - Insider trading activity
  - Real-time news feed & sentiment indicators
- 10-year (40-quarter) historical earnings table with surprise tracking
- Leadership background with automated Wikipedia research links
- Intelligent session-based caching (refreshes once per calendar day)

### 4) Portfolio
- Buy/sell via asset modal and persisted trade execution
- Live holdings valuation and aggregate gain/loss metrics
- Portfolio charts and performance snapshots
- Per-position entry-price aware gain calculations

### 5) Options
- Crypto options chain (Derive/Lyra-style provider route)
- Spot price fallback via Hyperliquid when needed
- Whale options trades table with min-notional filtering and pagination
- **Options Strategy Simulator**:
  - Express market views (Bullish, Bearish, Rangebound, etc.) to generate multi-leg strategies
  - Heuristic probability scoring and payoff labels
  - Direct execution from simulator into trade tickets
- **Options Calculator**:
  - multi-leg setup, Greeks, and net P&L
  - Interactive payoff charts
  - Saved calculations persisted to DB

### 6) Predictions
- Prediction market snapshots for Polymarket
- Category browsing (`geopolitics`, `crypto`, `tech`, `politics`, `finance`)
- Whale transaction table with sort/filter/pagination
- Market details modal with holder distribution and position splits

### 7) Journal & Analytics
- Recent execution history with asset detail expansion
- **Calendar PnL visualization**: Daily profit/loss heatmap with symbol filtering
- **Advanced Analytics**:
  - Success metrics (Win rate, Profit Factor, Expectancy)
  - Portfolio distribution and risk metrics
- **Traded Assets Report**: Paginated overview with live price refresh and total volume tracking

### 8) Tax Estimator
- Capital gains estimates for 40+ global jurisdictions (US, UK, India, Brazil, UAE, etc.)
- Short-term vs. Long-term liability logic per region
- **Jurisdiction Recommendation**: Suggests lower-tax alternatives based on your declared gains
- CSV and PDF export support

### 9) Settings & account panel
- Profile and security controls (email/password/2FA/passkeys placeholders)
- General preferences (timezone, refresh cadence, visibility controls)
- Connected accounts modal for exchange/prediction market metadata
- Notification + layout preference toggles

## Known limitations / In progress (as of April 20, 2026)

- **External Data Availability**: While we have added robust field-mapping fallbacks for the Options Chain (Derive) and prioritized high-coverage US symbols in Search, features depending on Polymarket or specific Crypto APIs may still show temporary stale or error states if upstream routes are rate-limited or unavailable.
- **Execution Connectivity**: "Connected Accounts" are currently metadata representations only; actual live trade routing to external CEX/Brokers is not yet implemented. Trading in the Asset Modal currently executes against a local database simulator.
- **Security Logic**: Account/Security controls are currently frontend-level UI state (localStorage synchronized); full backend-enforced JWT/Session security for individual user accounts is pending.
- **Multi-Tenant Support**: The current persistence model uses a fixed `user_id` for balance and trades; full multi-user isolation is not active.
- **Tax Accuracy**: The Tax Estimator provides indicative flat-rate estimates for retail traders. It is not professional tax advice and may not reflect specific deductions or local surcharges.
- **Options Heuristics**: Strategy Simulator use heuristic probabilities; they are for guidance and do not replace professional risk analysis.

## Data sources and integrations

- **Hyperliquid**: Crypto search, pricing contexts, and fallback spot data.
- **Polymarket (Gamma API)**: Prediction snapshots, market details, holder/position data.
- **Finviz**: Market Intel (Insider trades, Ratings, News) and supplemental fundamental metrics.
- **Yahoo Finance (`yfinance`)**: TradFi symbol search, history, earnings, and fundamentals.
- **Derive/Lyra**: Options chain data and whale trade tape.
- **EODHD**: Macro indicators and general pricing fallback.
- **CoinGecko**: Supplemental crypto metadata.
- **Telegram MTProto**: Optional ingestion for Derive whale flow.

## MTProto whale ingestion (implemented)

The backend can optionally merge Telegram channel messages into `/api/options/whale-trades`.

- Channel defaults to: `derivetradetape`
- Parsed rows are normalized into existing whale table fields:
  - `symbol`
  - `expiration`
  - `referencePrice`
  - `strategy`
  - `totalNotional`
- Endpoint response includes `debug_telegram_ingest` metadata.

### Required env for Telegram ingestion
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_STRING`

Optional:
- `TELEGRAM_CHANNEL_USERNAME` (default `derivetradetape`)
- `TELEGRAM_FETCH_LIMIT` (default `160`)
- `TELEGRAM_CACHE_TTL_MS` (default `60000`)

### Generate a session string
From `backend/`:

```bash
npm run telegram:session
```

This interactive script logs in and prints a `TELEGRAM_SESSION_STRING` value.

## Backend API surface (key routes)

### Health/meta
- `GET /health`
- `GET /api/categories`

### Market/search/history
- `GET /api/search`
- `GET /api/watchlist`
- `GET /api/prices`
- `GET /api/crypto-market`
- `GET /api/history`
- `GET /api/interval-performance`
- `GET /api/macro-indicators`

### Earnings
- `GET /api/earnings`
- `GET /api/earnings-calendar`

### Options
- `POST /api/options/crypto`
- `GET /api/options/whale-trades`
- `GET /api/db/options-calculations`
- `POST /api/db/options-calculations`

### Predictions
- `GET /api/prediction/snapshot`
- `GET /api/prediction/market-details/:marketId`

### Portfolio/watchlist/trades/balance persistence
- `GET /api/db/portfolio`
- `POST /api/db/portfolio`
- `PUT /api/db/portfolio/:id`
- `DELETE /api/db/portfolio/:id`
- `GET /api/db/portfolio/symbol/:symbol`
- `GET /api/db/watchlist`
- `POST /api/db/watchlist`
- `DELETE /api/db/watchlist/:symbol`
- `GET /api/db/watchlist/check/:symbol`
- `GET /api/db/trades`
- `POST /api/db/trades`
- `POST /api/db/execute-trade`
- `GET /api/db/balance`
- `POST /api/db/balance`

## Persistence

Primary datastore: PostgreSQL.

Main tables used by the app:
- `portfolio_holdings`
- `watchlist_assets`
- `user_balance`
- `options_calculations`
- `trade_executions`

## Local development

## Prerequisites
- Node.js 18+
- npm
- Python 3.9+
- PostgreSQL (local or managed)

## Install

Backend:

```bash
cd backend
npm install
python3 -m pip install -r requirements.txt
```

Frontend:

```bash
cd frontend
npm install
```

## Run

Backend:

```bash
cd backend
npm run dev
```

Frontend:

```bash
cd frontend
npm run dev
```

## Environment variables

### Frontend
- `VITE_API_URL` (optional, defaults to deployed API)

### Backend
- `PORT` (default `4000`)
- `FRONTEND_URL` (CORS allowlist origin)
- `DATABASE_URL` (recommended)
- `EODHD_API_TOKEN` (macro indicators)
- `DERIVE_API_URL` (optional provider override)

Optional Postgres discrete vars (if not using `DATABASE_URL`):
- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `PGSSLMODE=disable` for local non-SSL setups

Telegram MTProto optional vars:
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_STRING`
- `TELEGRAM_CHANNEL_USERNAME`
- `TELEGRAM_FETCH_LIMIT`
- `TELEGRAM_CACHE_TTL_MS`

See `backend/.env.example` for template values.

## Deployment

- `render.yaml` includes backend + static frontend blueprint setup
- `vercel.json` includes static frontend build/rewrite config

## Repository layout

```text
backend/
  index.js
  database.js
  data.js
  fetch_prices.py
  fetch_history.py
  fetch_earnings.py
  search_symbols.py
  scripts/
    telegram-session.js
  requirements.txt
  Dockerfile

frontend/
  src/
    App.jsx
    styles.css
    components/
      HomeModule.jsx
      Watchlist.jsx
      PortfolioModule.jsx
      OptionsModule.jsx
      OptionsCalculator.jsx
      PredictionMarketModule.jsx
      JournalModule.jsx
      AssetModal.jsx
      CompanyProfilePage.jsx
      AnalyticsModule.jsx
      TaxEstimator.jsx
      OptionsStrategySimulator.jsx
```
