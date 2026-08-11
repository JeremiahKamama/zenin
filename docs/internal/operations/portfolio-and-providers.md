---
title: Portfolio and provider operations
description: SnapTrade architecture, exchange/wallet sync, unified portfolio rollout, source freshness, retry behavior, and reconciliation limitations.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Portfolio and provider operations

## SnapTrade architecture

- Brokerage connections use SnapTrade (`backend/brokerage/providers/snaptrade`).
- SnapTrade authenticates the user with the broker and returns read-only access to holdings, balances, and executions.
- Zenin never receives broker passwords; connection is via OAuth-style authorization through SnapTrade.

## Exchange / wallet sync

- Exchange API keys are stored encrypted and accepted only when verified read-only.
- Hyperliquid uses a public watch-only address (no secret).
- Sync imports holdings, balances, and executions into workspace-scoped tables.

## Unified portfolio rollout

- The unified portfolio combines connected holdings, cash, and manual positions with per-source attribution.
- Duplicate exposure across sources is flagged rather than doubled.

## Source freshness

- Each imported item carries a freshness state (current / delayed / stale / unavailable / reference-only).
- Freshness is derived from the last successful source refresh and the source's stated cadence.

## Retry behavior

- Source syncs retry per source-defined backoff. Transient provider errors are retried; hard rejections (for example, revoked keys) stop and raise a source-health notice.
- Retries do not fabricate missing data.

## Reconciliation limitations

- Reconciliation depends on the identifiers the source provides; mismatched symbols or accounts can create apparent duplicates.
- Manual positions are not auto-matched to connected positions; the user resolves overlaps via the duplicate-exposure warning.

## Related audits and plans

- [Brokerage architecture](../../BROKERAGE_ARCHITECTURE.md)
- [Migration overview](../../migration-overview.md)
- [Architecture audits index](architecture/audits/README.md)
