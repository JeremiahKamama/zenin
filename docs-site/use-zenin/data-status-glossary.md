---
title: Data status glossary
description: Definitions for current, delayed, stale, unavailable, reference-only, partial coverage, manual, connected, and read-only states shown across Zenin.
audience: user
status: current
last_verified: 2026-07-19
---

# Data status glossary

Zenin shows explicit status states instead of hiding gaps or inventing values. Use this glossary to interpret what you see.

| State | Meaning | What to do |
| --- | --- | --- |
| **Current** | Recently refreshed from the source. | Trust as live within the source's normal cadence. |
| **Delayed** | The source provides data on a delay (for example, delayed quotes). | Treat as recent but not real-time. |
| **Stale** | The last successful refresh is older than expected. | Re-check the connection; data may be out of date. |
| **Unavailable** | The source did not return data. | Zenin shows the state; no value is fabricated. |
| **Reference-only** | Descriptive data (for example, fundamentals), not a live price. | Use for context, not valuation. |
| **Partial coverage** | The source returned some fields but not all. | Missing fields are left empty or marked, not guessed. |
| **Manual** | Entered by you, not imported from a connection. | Attributed as manual so it is not confused with connected data. |
| **Connected** | Imported from a read-only source you authorized. | Attributed to that source for traceability. |
| **Read-only** | The connection has no trade/withdraw permission. | Expected and required; Zenin rejects write-enabled keys. |

## Why states matter

A missing or delayed value is information. Zenin prefers to show **delayed, stale, unavailable, or reference-only** rather than manufacture a number it cannot source. When you see one of these states, check the source connection and the [troubleshooting quickstart](/get-started/troubleshooting-quickstart).

## Related

- [Portfolio and connected accounts](/use-zenin/portfolio-and-connected-accounts) — how freshness and attribution appear per position.
- [Connect data sources](/get-started/connect-data-sources) — read-only connection requirements.
