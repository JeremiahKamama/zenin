---
title: Architecture audits
description: Index of retained engineering audits and migration plans. Each entry is marked with status, verified date, and whether it is current, historical, or proposed.
audience: engineering
status: current
last_verified: 2026-07-19
owner: platform-team
---

# Architecture audits (evidence)

These documents are **engineering evidence**, not user guides. Public user
documentation lives in `docs-site/`. Each entry records its relevance so it is
not mistaken for current architecture.

> Legacy documents describing **SQLite** or retired portfolio routes are
> historical and must not be used as current architecture references.

## Index

| Document | Relevance | Status | Last verified |
| --- | --- | --- | --- |
| [migration-overview.md](migration-overview.md) | Workspace/portfolio migration plan | current | 2026-07-10 |
| [BROKERAGE_ARCHITECTURE.md](BROKERAGE_ARCHITECTURE.md) | SnapTrade brokerage architecture | current | 2026-06-26 |
| [SENTRY.md](SENTRY.md) | Error monitoring setup | current | 2026-07-02 |
| [SENTRY_ALERTING.md](SENTRY_ALERTING.md) | Alerting rules | current | 2026-07-02 |
| [revenuecat-web-implementation.md](revenuecat-web-implementation.md) | Billing web integration | current | 2026-05-14 |
| [design-system-foundation-plan-2026-07.md](design-system-foundation-plan-2026-07.md) | Design system plan | current | 2026-07-01 |
| [desktop-layout-optimization-plan.md](desktop-layout-optimization-plan.md) | Layout optimization plan | current | 2026-07-05 |
| [tax-estimator-superdesign-implementation-plan.md](tax-estimator-superdesign-implementation-plan.md) | Tax estimator implementation plan | current | 2026-05-14 |
| [typography-institutional-review-2026-07.md](typography-institutional-review-2026-07.md) | Typography review | current | 2026-07-09 |
| [asset-intelligence-platform-audit.md](asset-intelligence-platform-audit.md) | Platform audit | historical | 2026-07-12 |
| [asset-modal-audit.md](asset-modal-audit.md) | Asset modal audit | historical | 2026-07-10 |
| [calendar-heatmap-audit.md](calendar-heatmap-audit.md) | Calendar heatmap audit | historical | 2026-07-10 |
| [commodity-intelligence-architecture-audit.md](commodity-intelligence-architecture-audit.md) | Commodity architecture audit | historical | 2026-07-12 |
| [commodity-ux-workflow-audit.md](commodity-ux-workflow-audit.md) | Commodity UX audit | historical | 2026-07-12 |
| [macro-commodities-desk-audit.md](macro-commodities-desk-audit.md) | Macro/commodities desk audit | historical | 2026-07-10 |
| [performance-curve-audit.md](performance-curve-audit.md) | Performance curve audit | historical | 2026-07-10 |
| [research-module-audit.md](research-module-audit.md) | Research module audit | historical | 2026-07-10 |
| [tax-estimator-audit.md](tax-estimator-audit.md) | Tax estimator audit | historical | 2026-07-10 |
| [typescript-migration-audit.md](typescript-migration-audit.md) | TypeScript migration audit | historical | 2026-07-10 |

## How to use

- **current** — reflects the architecture in this release; safe to cite.
- **historical** — evidence of a past decision or review; may be superseded.
- **proposed** — a plan not yet implemented; do not treat as shipped behavior.

When an audit is superseded by a newer one, mark the older file `historical` and
note the replacement in this index.
