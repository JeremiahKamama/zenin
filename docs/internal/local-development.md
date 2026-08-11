---
title: Local development
description: Prerequisites, environment templates, service startup, tests, database setup, and seeded/local data expectations.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Local development

## Prerequisites

- Node.js 20+ (backend requires 20+; 22 used in current environments).
- npm.
- Python 3.9+ (backend requirements for some adapters).
- PostgreSQL, local or managed.

## Environment templates

Start from the checked-in templates:

- `frontend/.env.example`
- `backend/.env.example`

At minimum, configure a reachable PostgreSQL `DATABASE_URL`. Set `VITE_API_URL` in the frontend when the API is not on the default environment. Provider keys, billing, email, brokerage, OAuth, error monitoring, and optional ingestion are configured in the respective templates. **Do not commit real credentials.**

## Service startup

Backend:

```bash
cd backend
npm install
python3 -m pip install -r requirements.txt
npm run dev
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `/app` for the authenticated app; `/app?guest=1` for guest preview.

## Tests

```bash
cd backend
npm test                 # unit tests (require PostgreSQL)
npm run test:integration # integration tests (require PostgreSQL)
```

Integration tests require PostgreSQL connectivity. If the environment cannot reach the configured database, investigate the connection before treating a failure as application verification.

## Database setup

- The backend initializes the schema idempotently on boot (`database.js`).
- A reachable PostgreSQL instance is required; the app will not run without it.

## Seeded / local data expectations

- Local data is workspace-scoped. Guest preview shows read-only context and does not represent preview actions as live executions.
- Provider coverage in local/dev depends on which API keys are configured; without them, many surfaces fall back to reference-only or unavailable states rather than fabricated data.
