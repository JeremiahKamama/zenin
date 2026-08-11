---
title: Deployment and incident response
description: Deployment topology, environment configuration, secret handling, Sentry, provider outage response, rollback, and health checks.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Deployment and incident response

## Deployment topology

- `frontend/` — Vite SPA, deployed as a static site (Vercel config present).
- `backend/` — Express API, deployed as a long-running service (Render config present).
- `admin/` — administrative application.
- `docs-site/` — separate static VitePress site for public docs; does **not** include `docs/internal/`.
- PostgreSQL is the managed primary datastore.

Deployment configuration is maintained in `render.yaml`, `vercel.json`, `frontend/vercel.json`, and `backend/vercel.json`. Use the service-specific environment templates.

## Environment configuration

- Configure per-service environment from the `.env.example` templates.
- Do not store secrets in the repo. Provide them through the deployment platform's secret store.

## Secret handling

- Exchange keys are encrypted at rest and accepted only when read-only.
- Email/brokerage/OAuth/monitoring keys come from environment configuration, never committed.
- Rotate any key that may have been exposed.

## Sentry

- Sentry is initialized before the Express app is constructed. Without `SENTRY_BACKEND_DSN` it is a no-op.
- Backend 5xx errors are captured; 4xx stays out of Sentry to avoid quota noise.
- See [Sentry](../../SENTRY.md) and [Sentry alerting](../../SENTRY_ALERTING.md).

## Provider outage response

- A degraded upstream (market data, brokerage, prediction market) raises source-health notices; Zenin shows stale/unavailable/reference-only states instead of fabricated data.
- Do not "fix" missing data by injecting values. Communicate the provider issue via the notice and status.

## Rollback

- Frontend and backend deploy as independent services; roll back the affected service.
- Database schema changes are applied idempotently on boot; ensure a migration is reversible before deploying.

## Health checks

- The backend exposes a listening port; the service is healthy when it accepts connections and the database is reachable.
- Watch Sentry and source-health notices for early signal of degradation.
