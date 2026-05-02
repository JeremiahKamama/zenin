# Zenin

Zenin is a multi-asset trading dashboard that combines portfolio management, options analytics, prediction-market tracking, and journal/reporting workflows with a PostgreSQL-backed backend.

This README reflects the current implementation in this repository.

## Entry flows

- `GET /` shows the public homepage (marketing/overview).
- `GET /app` opens the trading app.
- `GET /auth` opens sign up / sign in / forgot-password and account-security flows.
- `Open App` from the homepage now performs a preflight check:
  - verifies whether a valid auth session exists (`/api/auth/me`)
  - syncs subscription tier (`starter`/`pro`/`desk`) and billing cycle (`monthly`/`yearly`)
  - redirects unauthenticated users to `GET /auth?mode=signin&next=/app`
- Direct `/app` access still supports guest fallback during rollout.

## What the web app can do

### 1) Public homepage and app entry
- Public landing page at `/` with product overview and quick entry CTAs
- Dedicated auth workspace at `/auth` for sign up/sign in/password recovery and security actions
- Full app workspace at `/app` (including company deep-dive routes at `/app/company/:symbol`)
- Current onboarding behavior: users can still enter `/app` directly while auth hard-enforcement is pending
- Responsive homepage mock dashboard now includes:
  - portfolio performance card + company profile summary card
  - top positions/top movers percentage-only preview rows
  - no buying-power card in the homepage snapshot
  - responsive mobile menu behavior with right-aligned menu toggle

### 2) Home
- Account and balance summary cards with trend indicators
- Portfolio performance chart with interval (`1D` to `MAX`) and mode controls (Area, Bar, Line)
- Top positions by value with live price/gain overlays
- Top movers (gainers/losers) with timeframe selector (`daily`, `weekly`, `quarterly`, `ytd`, `yearly`)

### 3) Watchlist
- Category-based asset browsing (stocks, crypto, bonds, metals, commodities, indicators)
- Starred/watchlist-only views with ordering preserved from DB
- TradFi/crypto/indicator search with fuzzy matching
- Stock theme filters (default + custom themes)
- Earnings calendar cards for stock watchlist symbols (cached with long refresh cadence to avoid reload-time re-pulls)
- Macro indicators + country indicator search powered by Forex Factory calendar data mapping

### 4) Company Profile
- Deep-dive fundamental research framework for stocks (Defense, Energy, AI, Robotics, Pharma, etc.)
- Integrated **Finviz Market Intel**:
  - Analyst ratings & price targets
  - Insider trading activity
  - Real-time news feed & sentiment indicators
- 10-year (40-quarter) historical earnings table with surprise tracking
- Leadership background with automated Wikipedia research links
- Intelligent session-based caching (refreshes once per calendar day)

### 5) Portfolio
- Buy/sell via asset modal and persisted trade execution
- Live holdings valuation and aggregate gain/loss metrics
- Portfolio charts and performance snapshots
- Per-position entry-price aware gain calculations
- Mobile-safe rebalancing table layout with improved horizontal overflow behavior

### 6) Options
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

### 7) Predictions
- Prediction market snapshots for Polymarket
- Category browsing (`geopolitics`, `crypto`, `tech`, `politics`, `finance`)
- Whale transaction table with sort/filter/pagination
- Market details modal with holder distribution and position splits

### 8) Journal & Analytics
- Recent execution history with asset detail expansion
- Trade Entry Journal persistence with `Entry Form` + `View Entries` workflow
- Auto-journal draft creation from executed trades, with editable thesis/review fields
- **Calendar PnL visualization**: Daily profit/loss heatmap with symbol filtering
- **Advanced Analytics**:
  - Success metrics (Win rate, Profit Factor, Expectancy)
  - Portfolio distribution and risk metrics
- **Traded Assets Report**: Paginated overview with live price refresh and total volume tracking
- Responsive cross-market Analytics tab stack (`Crypto`, `Options`, `Equities`, `Macro`, `Commodities`) for mobile
- Journal table mobile hardening with sticky first column and controlled horizontal scrolling

### 9) Tax Estimator
- Capital gains estimates for 40+ global jurisdictions (US, UK, India, Brazil, UAE, etc.)
- Short-term vs. Long-term liability logic per region
- **Jurisdiction Recommendation**: Suggests lower-tax alternatives based on your declared gains
- CSV and PDF export support

### 10) Account and security
- Backend auth endpoints for sign up/sign in/sign out/session lookup (`/api/auth/*`)
- Forgot-password request/confirm flow with token validation
- 2FA and passkey scaffolding routes
- OAuth provider discovery + mock social sign-in route for local/dev flow testing
- New dark-themed multi-step auth UX at `/auth`:
  - Sign up: email step → secure account (password strength) → passkey setup → account created
  - Sign in: password flow + optional passkey-id flow + social buttons
  - Forgot password: request reset → check-email state → token-based confirm path (dev/local)

### 11) Settings & account panel
- Profile and security controls (email/password/2FA/passkeys UI scaffolding in settings/auth)
- General preferences (timezone, refresh cadence, visibility controls)
- Connected accounts modal for exchange/prediction market metadata
- Notification + layout preference toggles

## Current progress (as of April 26, 2026)

- **Auth foundation implemented**: Server-side auth/session/reset-token flows exist and are rate-limited.
- **User data isolation implemented**: Signed-in users read/write isolated balance, portfolio, watchlist, trade journal, and options calculation data.
- **Homepage Open App preflight shipped**: CTA now verifies prior login + account tier context before app entry.
- **Pricing-tier account linkage shipped**: Plan selection writes user `currentPlan/currentBillingCycle` and persists account context after auth.
- **Auth UX redesign shipped**: `/auth` now uses staged screens aligned to onboarding/sign-in/reset/passkey flow states.
- **Guest fallback retained**: Direct `/app` remains available without hard sign-in while enforcement rollout continues.
- **Integration test harness added**: Backend integration suite exists for auth lifecycle, password reset, and user-isolation scenarios.
- **Homepage responsive refactor completed**: Snapshot cards and footer device preview were updated to prevent overlap and improve mobile behavior.
- **Dark theme hardening completed**: Homepage/app surfaces (including sidebar) are now enforced to dark-theme styling.
- **Analytics runtime fix shipped**: Resolved `selectedPerpExchange is not defined` crash in the Analytics module.
- **Watchlist earnings fetch optimization shipped**: Earnings calendar now uses extended caching windows (frontend + backend) to avoid unnecessary reload fetches.
- **Indicator source migration shipped**: Watchlist indicators now resolve via Forex Factory calendar source mapping instead of EODHD dependency.
- **Mobile responsiveness fixes shipped**: Cross-market Analytics pills now stack cleanly on small screens; Journal and Portfolio tables were hardened for mobile overflow and clipping scenarios.

## Current limitations (as of April 26, 2026)

- **External Data Availability**: While we have added robust field-mapping fallbacks for the Options Chain (Derive) and prioritized high-coverage US symbols in Search, features depending on Polymarket or specific Crypto APIs may still show temporary stale or error states if upstream routes are rate-limited or unavailable.
- **Execution Connectivity**: "Connected Accounts" are currently metadata representations only; actual live trade routing to external CEX/Brokers is not yet implemented. Trading in the Asset Modal currently executes against a local database simulator.
- **Auth enforcement mode**: Homepage `Open App` now validates session/tier first, but direct `/app` URL access still allows guest mode by design for current rollout.
- **OAuth provider setup**: Google/Apple/GitHub/Microsoft routes are scaffolded in backend; production OAuth client credentials/callback exchange are not yet configured.
- **Passkey implementation depth**: Passkey flows are scaffolded for registration + login testing, but full WebAuthn challenge/attestation verification is still a next step.
- **MFA delivery**: OTP verification is wired, but SMS/email delivery integrations are not yet connected to external providers.
- **Tax Accuracy**: The Tax Estimator provides indicative flat-rate estimates for retail traders. It is not professional tax advice and may not reflect specific deductions or local surcharges.
- **Options Heuristics**: Strategy Simulator use heuristic probabilities; they are for guidance and do not replace professional risk analysis.
- **Homepage device preview assets**: Footer laptop/phone visuals currently use themed mock content (not live in-app screenshots).

## Data sources and integrations

- **Hyperliquid**: Crypto search, pricing contexts, and fallback spot data.
- **Polymarket (Gamma API)**: Prediction snapshots, market details, holder/position data.
- **Finviz**: Market Intel (Insider trades, Ratings, News) and supplemental fundamental metrics.
- **Yahoo Finance (`yfinance`)**: TradFi symbol search, history, earnings, and fundamentals.
- **Derive/Lyra**: Options chain data and whale trade tape.
- **Forex Factory Calendar Feed**: Indicator-country search and macro indicator event mapping in Watchlist.
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

## One-time admin workspace migration (run now)

Use this when you want to immediately copy current tracked portfolio/watchlist into the configured admin workspace without restarting the backend.

### Option A: CLI script (direct DB connection)

From `backend/`:

```bash
npm run migrate:admin-workspace
```

Force re-run (ignores one-time marker):

```bash
npm run migrate:admin-workspace -- --force
```

### Option B: Admin endpoint (live server)

Route:

- `POST /api/admin/migrations/admin-workspace`

Auth options:

- Signed-in admin user (`ADMIN_EMAIL`)
- Or header `x-migration-key: <ADMIN_MIGRATION_KEY>`

Example:

```bash
curl -X POST "https://<your-backend>/api/admin/migrations/admin-workspace?force=false" \
  -H "x-migration-key: $ADMIN_MIGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

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

### Auth & account security
- `GET /api/auth/me`
- `POST /api/auth/signup`
- `POST /api/auth/signin`
- `POST /api/auth/signout`
- `POST /api/auth/forgot-password/request`
- `POST /api/auth/forgot-password/confirm`
- `POST /api/auth/2fa/enable`
- `POST /api/auth/2fa/disable`
- `POST /api/auth/passkeys/register`
- `POST /api/admin/migrations/admin-workspace`
- `GET /api/auth/oauth/providers`
- `POST /api/auth/oauth/start` (scaffold response)
- `POST /api/auth/oauth/mock` (local/dev social sign-in simulation)

## Persistence

Primary datastore: PostgreSQL.

Main tables used by the app:
- Legacy/shared tables:
  - `portfolio_holdings`
  - `watchlist_assets`
  - `user_balance`
  - `options_calculations`
  - `trade_executions`
- Auth and user-scoped tables:
  - `app_users`
  - `auth_sessions`
  - `password_reset_tokens`
  - `user_workspace_balance`
  - `user_workspace_portfolio`
  - `user_workspace_watchlist`
  - `user_workspace_trades`
  - `user_workspace_options_calculations`

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

## Backend integration tests

Run:

```bash
cd backend
npm run test:integration
```

Notes:
- These tests exercise auth + per-user data isolation through HTTP endpoints.
- They require PostgreSQL connectivity (`DATABASE_URL` or local PG config).
- If the test server cannot connect to Postgres, tests auto-skip and report the connection error.

## Environment variables

### Frontend
- `VITE_API_URL` (optional, defaults to deployed API)

### Backend
- `PORT` (default `4000`)
- `FRONTEND_URL` (CORS allowlist origin)
- `DATABASE_URL` (recommended)
- `AUTH_HASH_KEY` (recommended strong secret used for session/reset/OTP hashing; if omitted in production, Zenin derives a stable fallback from protected server config, but an explicit secret is preferred)
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

## Next steps

1. Replace `/api/auth/oauth/mock` with real OAuth code exchange (Google/Apple/GitHub/Microsoft) and provider-specific scopes.
2. Upgrade passkeys from scaffolded IDs to full WebAuthn challenge generation + verification (`navigator.credentials.create/get` + server attestation/assertion checks).
3. Integrate trusted delivery providers for MFA and password reset notifications (email + SMS) and remove dev token exposure in non-production paths.
4. Add refresh-token rotation / short-lived access tokens and account-level security telemetry (device/session management UI).
5. Add automated backend tests for auth, session expiry/revocation, and per-user data isolation on all `/api/db/*` endpoints.
6. Replace homepage footer mock device content with captured in-app Options and Analytics screenshots for production marketing parity.

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
