---
title: First portfolio sync
description: What is imported on first sync, freshness states, source errors, manual-data handling, and where to verify results.
audience: user
status: current
last_verified: 2026-07-19
---

# First portfolio sync

After you connect a data source, Zenin imports your portfolio so research and decisions stay connected to what you actually hold.

## What is imported

On first sync Zenin imports:

- **Holdings** — positions, quantities, and instrument metadata.
- **Balances** — cash and account balances where the source provides them.
- **Executions** — completed trades, used to build trade records and the journal.
- **Account context** — which source each position came from, for attribution.

Manual positions and journal entries you create are kept separately and shown alongside connected data.

## Freshness states

Every imported item carries a freshness state. You will see one of:

- **Current** — recently refreshed from the source.
- **Delayed** — the source provides data on a delay.
- **Stale** — the last successful refresh is older than expected.
- **Unavailable** — the source did not return data.
- **Reference-only** — descriptive data, not a live price.

See the [Data status glossary](/use-zenin/data-status-glossary) for the full list and meanings.

## Source errors

If a source errors during sync:

- The affected positions keep their **last known** state and are marked accordingly.
- A **source-health notice** may appear in Notifications.
- Zenin retries per the source's retry behavior; it does not invent missing data.

## Manual-data handling

When a source cannot provide a value (or you want to track something outside a connection):

- Add a **manual position** from Portfolio.
- It is attributed as **manual** so it is never confused with connected data.
- Manual and connected totals are reconciled in the unified view, with **duplicate-exposure warnings** when the same instrument appears in more than one source.

## Where to verify results

- **Portfolio** — holdings, totals, source attribution, and freshness per position.
- **Portfolio activity** — recent imports and sync events.
- **Notifications** — source-health and sync notices.

**Next:** [Set up your workspace](/get-started/set-up-your-workspace)
