# Zenin

A multi-asset portfolio and options dashboard with persistent PostgreSQL-backed data, market search, charting, and options analytics.

This README reflects the **current repository implementation** (frontend + backend code in this repo). If your deployed environment is older, some routes/features may be missing until redeployed.

## Project Status (April 2026)

The app is actively implemented across five main sections:

- Home
- Watchlist
- Portfolio
- Options
- Journal

It also includes a user settings mini-window (General, Accounts, Layout, Notification) launched from the sidebar user section.

## Active Features

### Home

- Portfolio summary cards
- Portfolio performance chart with interval controls
- Top positions
- Top gainers / losers

### Watchlist

- Category browsing (`stocks`, `crypto`, `bonds`, `metals`, etc. from seed data)
- Grid/list modes
- Search (TradFi and Crypto)
- Theme filters for stocks
- Earnings card below Themes with pagination (5 symbols per page)
- Star toggle add/remove watchlist

### Portfolio

- Buy / sell flow through asset modal
- Position quantity management
- Persisted holdings in PostgreSQL
- Portfolio value / gain calculations
- Chart breakdowns and summary metrics

### Options

- Crypto options chain for BTC/ETH/SOL via backend options route
- Expiry tabs and market metrics (IV / put-call ratio / skew)
- Options calculator with multi-leg setup, strategy presets, Greeks, and P&L diagram
- Save/load calculations (PostgreSQL)
- Whale options trades card (table + pagination, 10 rows/page)
- Periodic refresh for chain and whale trades
- Optional WebSocket subscription if `VITE_WS_URL` is configured

### Journal

- Trade history
- Calendar-oriented trade view controls and filters

### Settings Window

Launched by clicking the sidebar user avatar/email area.

- General
- General includes timezone preference (browser default supported), refresh frequency, and hide/show value controls
- Accounts
- Accounts includes connected CEX/DEX/broker entries and an add-account window with provider, username, and API key/ID inputs
- Read-only API reminder is shown in the account connect flow
- Layout
- Layout preset selection is available
- Notification
- Notification includes email/browser channel toggles and event-type toggles

## API Integrations (Current)

### Hyperliquid API (Primary for crypto)

Used via `POST https://api.hyperliquid.xyz/info` for:

- Crypto search source
- Crypto market mids and contexts for pricing

### CoinGecko API (Fallback for crypto)

Used when Hyperliquid does not return a searchable asset or pricing context:

- Crypto search fallback
- Missing-symbol price fallback
- Crypto historical series source used by history endpoints

### Yahoo Finance (via Python/yfinance)

Used for TradFi workflows:

- Symbol search enrichment
- Historical price data
- Earnings/fundamentals
- Earnings calendar responses

### Lyra/Derive-style Options Public API

Backend options endpoints call provider public routes for:

- Options chain (`/api/options/crypto`)
- Whale options trades (`/api/options/whale-trades`)

The backend includes provider failover logic across configured endpoints and stale-data behavior for resilience.

## Persistence & Data Model

Primary datastore: PostgreSQL (via `pg` in `backend/database.js`)

Tables in use:

- `portfolio_holdings`
- `watchlist_assets`
- `user_balance`
- `options_calculations`
- `trade_executions`

Persisted entities include:

- Portfolio holdings
- Watchlist entries
- User balance
- Saved options calculations
- Trade executions (journal)

## Backend Routes (Key)

Health and meta:

- `GET /health`
- `GET /api/categories`

Search and market data:

- `GET /api/search`
- `GET /api/watchlist`
- `GET /api/prices`
- `GET /api/crypto-market`
- `GET /api/history`
- `GET /api/interval-performance`

Earnings:

- `GET /api/earnings`
- `GET /api/earnings-calendar`

Options:

- `POST /api/options/crypto`
- `GET /api/options/whale-trades`
- `GET /api/db/options-calculations`
- `POST /api/db/options-calculations`

Portfolio / watchlist persistence:

- `GET /api/db/portfolio`
- `POST /api/db/portfolio`
- `PUT /api/db/portfolio/:id`
- `DELETE /api/db/portfolio/:id`
- `GET /api/db/watchlist`
- `POST /api/db/watchlist`
- `DELETE /api/db/watchlist/:symbol`

Balance:

- `GET /api/db/balance`
- `POST /api/db/balance`

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.9+
- PostgreSQL 14+ (or managed Postgres with a connection URL)
- npm

### Install

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

### Run

Backend:

```bash
cd backend
npm start
```

Frontend:

```bash
cd frontend
npm run dev
```

## Environment Variables

### Frontend

- `VITE_API_URL` (optional)
- Default: `https://zenin-mx6w.onrender.com/api`
- `VITE_WS_URL` (optional)
- If absent, options flow uses polling only

### Backend

- `PORT` (optional, default `4000`)
- `FRONTEND_URL` (for CORS allowlist)
- `DERIVE_API_URL` (optional options provider override)
- `DATABASE_URL` (recommended, full Postgres connection string)
- Or discrete Postgres vars: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- Optional for local non-SSL Postgres: `PGSSLMODE=disable`

On backend start, schema creation/seeding runs automatically in `initializeDatabase()`.

## Deployment Notes

- `render.yaml` is present for backend + static frontend deployment on Render
- `vercel.json` is present for Vercel static frontend deployment

## Operational Notes

- If the frontend shows missing routes (for example whale-trades or earnings-calendar 404), your deployed backend is likely behind this repository state.
- Options provider availability can be intermittent; backend resilience and stale fallbacks are included but not a guarantee of uninterrupted upstream data.

## Repository Layout

```text
backend/
  index.js
  database.js
  data.js
  fetch_prices.py
  fetch_history.py
  fetch_earnings.py
  search_symbols.py
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
      JournalModule.jsx
      AssetModal.jsx
```
