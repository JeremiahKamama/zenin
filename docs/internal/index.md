---
title: Internal Documentation
description: Engineering and operations documentation for Zenin. Internal only — not part of the public VitePress portal.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Zenin — Internal Documentation

This area is **internal only**. It is not built into or deployed with the public
VitePress portal (`docs-site/`). It lives in the repository for engineers and operators.

## Sections

- [Architecture overview](architecture/overview.md) — frontend, backend, database, workspace model, auth, provider adapters, feature flags.
- [Portfolio and provider operations](operations/portfolio-and-providers.md) — SnapTrade, exchange/wallet sync, unified portfolio, freshness, retry, reconciliation limits.
- [Notifications operations](operations/notifications.md) — canonical events, delivery policy, email config, troubleshooting, observability.
- [Local development](local-development.md) — prerequisites, env templates, startup, tests, database, seeded data.
- [Deployment and incident response](deployment-and-incident-response.md) — topology, env config, secrets, Sentry, outage response, rollback, health checks.

## Audits and migration plans

Deep audits and migration plans are retained as engineering evidence:

- [Architecture audits index](architecture/audits/README.md) — each audit marked with status, verified date, and current / historical / proposed.

## Ground rules

- Audits are **evidence**, not user guides. Public user docs live in `docs-site/`.
- Never place real keys, private endpoints, connection secrets, or operational credentials in any document.
- Mark every page with `status`, `last_verified`, and `owner`.
- Correct or archive any document that describes retired architecture (for example, SQLite or old portfolio routes) so it cannot be mistaken for the current PostgreSQL / workspace model.
