---
title: Architecture overview
description: Frontend, backend, database, workspace model, authentication, provider adapters, and feature flags.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Architecture overview

Zenin is a Vite/Node stack with a React frontend, an Express backend, and PostgreSQL persistence.

## Frontend

- `frontend/` — React + Vite single-page application.
- Consumes the backend API for session-aware workspace data, search, market data, research, portfolio, Watchlist, options, and analytics.
- Public entry is `/app`; `/app?guest=1` is an explicit guest-preview entry point.

## Backend

- `backend/` — Express API, market-data adapters, workspace persistence, auth.
- Organized around capability groups: auth/workspaces, market data/search, portfolio/watchlist, research/analytics, options/predictions, and administration.
- PostgreSQL is the primary persistence layer.

## Database

- PostgreSQL. Workspaces scope most data through `workspace_id` + `user_id`.
- Schema is initialized in `database.js` (tables created idempotently on boot).
- Legacy documents describing **SQLite** or retired portfolio routes are outdated and must not be used as current architecture references.

## Workspace model

- A workspace is the tenant boundary: portfolio, balances, trades, watchlists, journal entries, and saved views belong to a workspace.
- `resolveWorkspaceScope(userId, workspaceId)` resolves the effective scope for queries.
- Roles (owner / member / guest) control settings and connection changes.

## Authentication

- Session-based auth (`requireSignedIn`, `attachActiveWorkspace`, `requireWorkspaceMember`).
- Email verification gates full account capability; signup may return no bearer token until verified, which affects automated happy-path tests.

## Provider adapters

- Brokerage: SnapTrade (`backend/brokerage/providers/snaptrade`).
- Market data: Yahoo/Finviz/Hyperliquid/Polymarket/Derive-Lyra-Deribit/Forex Factory/CoinGecko, plus optional ETFdb worker and Telegram MTProto ingestion.
- Exchange keys are accepted only when read-only; write-enabled keys are rejected at connection time.

## Feature flags

- `backend/brokerage/application/featureFlags` and related gates control capability rollout (for example, brokerage surface availability).
- Feature flags are evaluated server-side; do not assume a flag is on in every environment.

## Related

- [Portfolio and provider operations](portfolio-and-providers.md)
- [Notifications operations](notifications.md)
- [Architecture audits](architecture/audits/README.md)
