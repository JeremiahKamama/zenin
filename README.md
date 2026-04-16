# Zenin

Zenin is a multi-asset trading dashboard that combines portfolio management, options analytics, prediction-market tracking, and journal/reporting workflows with a PostgreSQL-backed backend.

This README reflects the current implementation in this repository.

## What the web app can do

### 1) Home
- Account and balance summary cards
- Portfolio performance chart with interval and mode controls
- Top positions by value
- Top movers (gainers/losers) with timeframe selector (`daily`, `weekly`, `quarterly`, `ytd`, `yearly`)

### 2) Watchlist
- Category-based asset browsing (stocks, crypto, bonds, metals, commodities, indicators)
- Starred/watchlist-only views with ordering preserved from DB
- TradFi/crypto/indicator search
- Stock theme filters (default + custom themes)
- Earnings calendar cards for stock watchlist symbols
- Macro indicators view for G7 countries (USA, CAN, GBR, FRA, DEU, ITA, JPN)

### 3) Portfolio
- Buy/sell via asset modal and persisted trade execution
- Live holdings valuation and gain/loss metrics
- Portfolio charts and performance snapshots
- Per-position entry-price aware gain calculations

### 4) Options
- Crypto options chain (Derive/Lyra-style provider route)
- Spot price fallback via Hyperliquid when needed
- Whale options trades table with min-notional filtering and pagination
- Options calculator:
  - multi-leg setup
  - strategy presets
  - Greeks and net P&L
  - payoff chart
  - saved calculations persisted to DB

### 5) Predictions
- Prediction snapshot by category (`geopolitics`, `crypto`, `tech`, `politics`, `finance`)
- Category market list with probability gauge
- Whale transaction table with sort/filter/pagination
- Market details modal (holders + position splits)

### 6) Journal
- Recent execution history
- Calendar PnL visualization with symbol filtering
- Analytics cards (realized/unrealized/expectancy/win metrics)
- Traded Assets Report with pagination and live price refresh support

### 7) Settings & account panel
- Profile and security controls (email/password/2FA/passkeys placeholders)
- General preferences (timezone, refresh cadence, visibility controls)
- Connected accounts modal (CEX/DEX/broker/prediction)
- Notification + layout preference toggles

## Known limitations / In progress (as of April 16, 2026)

- External data providers can fail or rate-limit. Features that depend on EODHD, Derive/Lyra routes, Hyperliquid, CoinGecko, Yahoo, or Polymarket may temporarily show empty/stale/error states.
- Macro indicators require a valid `EODHD_API_TOKEN` with macro access. If the token is missing or plan-restricted, the indicators view cannot return fresh data.
- Telegram whale ingestion is optional and best-effort. It is disabled without MTProto credentials and only parses messages that match supported text patterns.
- Security/account settings are currently workspace-level UX state (stored in local browser storage), not full backend-authenticated account security.
- Connected account entries are currently metadata only (not live exchange/broker API execution).
- The persistence model is currently single-workspace/single-tenant (`user_balance` uses a fixed id and core tables are not user-scoped).
- Top Movers now prefers verified interval-performance data for each selected horizon and only falls back to quote-change values for daily movers; non-daily horizons may therefore show fewer rows when upstream interval data is partial.

## Data sources and integrations

- **Hyperliquid**
  - crypto search/pricing contexts
  - crypto candle snapshot support (history path)
- **CoinGecko**
  - fallback for crypto search/history/pricing
- **Yahoo Finance via Python scripts (`yfinance`)**
  - TradFi symbol search/history/earnings/fundamentals
- **Derive/Lyra-style options API endpoints**
  - options chain + recent trades used for whale flow
- **Polymarket Gamma/Data API**
  - prediction snapshot, market details, holder/position data
- **Telegram MTProto (optional, for whale ingestion)**
  - optional ingestion of channel text trade-tape rows into options whale trades endpoint

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
```
