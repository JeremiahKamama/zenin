---
title: Notifications operations
description: Canonical notification events, provider-neutral transaction events, delivery policy, email configuration, troubleshooting, and observability.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Notifications operations

## Canonical notification events

Notifications are generated server-side from workspace activity and source sync results. Canonical types include:

- `trade_execution.batch_created` / single execution synced
- `journal_reminder` (initial / follow_up)
- `journal_report` (periodic digest)
- source-health notices (degraded / recovered / partial)

## Provider-neutral transaction events

Execution imports are normalized into provider-neutral transaction events before they generate notifications or journal reminders, so downstream logic does not depend on a single broker's schema.

## Delivery policy

- In-app delivery is immediate within the session.
- Email delivery requires `isEmailDeliveryProductionReady()` and user opt-in (`journal:prefs.email`).
- On-demand email (for example, report digest) is gated by the same readiness check; if not ready, `emailed: false` is returned and no external send occurs.

## Email configuration

- Email is sent via the configured provider (for example, Resend). Missing or placeholder keys fall back to console logging in non-production.
- Never commit real email API keys; configure them through environment templates.

## Troubleshooting

- Missing expected email: confirm `isEmailDeliveryProductionReady()` and the user's `journal:prefs.email`.
- Source-health storm: a degraded provider raises repeated notices; the worker dedupes via `dedupe_key` where applicable.
- Auth-gated tests: signup email verification can block automated happy-path notification tests; treat a 401 as expected in that context.

## Observability

- Notification generation and delivery failures are logged server-side.
- Sentry captures backend errors (see [Sentry](../../SENTRY.md) and [Sentry alerting](../../SENTRY_ALERTING.md)).

## Related

- [Architecture audits index](architecture/audits/README.md)
