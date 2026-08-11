---
title: Portfolio and connected accounts
description: Unified portfolio total, source attribution, manual positions, duplicate-exposure warnings, valuations, freshness, and portfolio activity.
audience: user
status: current
last_verified: 2026-07-19
---

# Portfolio and connected accounts

Portfolio is where connected accounts and manual positions come together so you can see total exposure in one place.

## Unified portfolio total

The total combines:

- **Connected holdings** imported from your brokerage, exchange, or watch-only sources.
- **Cash balances** where the source provides them.
- **Manual positions** you added directly.

## Source attribution

Every position shows which source it came from. This matters because:

- Connected data is tagged with the originating connection.
- Manual data is tagged **manual**.
- You can see, at a glance, how much of your view depends on each source.

## Manual positions

Add manual positions for assets outside your connections (for example, an account you have not linked yet). Manual entries:

- are attributed as **manual** so they are never confused with imported data;
- count toward totals and exposure like any other position.

## Duplicate-exposure warnings

If the same instrument appears in more than one source (for example, the same holding in a brokerage and an exchange), Zenin flags **duplicate exposure** rather than silently doubling it. The unified view reconciles the overlap so your total is not overstated.

## Valuations

Valuations use the best available price for each instrument:

- **Live or delayed** market data when the provider supplies it.
- **Reference / last-known** values when live data is unavailable, clearly marked by freshness state.

Zenin does not invent a price it cannot source.

## Freshness

Each position carries a freshness state (**current, delayed, stale, unavailable, reference-only**). Review the [Data status glossary](/use-zenin/data-status-glossary) to interpret them.

## Portfolio activity

Portfolio activity shows recent imports and sync events, so you can verify when data last changed and trace a missing value back to its source.

---

## What this does / does not do

**What this does**

- Aggregates connected and manual positions into one total with per-source attribution.
- Warns on duplicate exposure across sources.
- Surfaces freshness and valuation basis per position.

**What it does not do**

- It does not execute trades or move money.
- It does not "fix" missing prices — it marks them with a freshness state.
- It does not assume every connected venue supports the same coverage.

**Data source and freshness**

Holdings and balances come from your connected read-only sources (SnapTrade brokerage, exchange API keys, Hyperliquid watch-only). Prices come from the configured market-data provider and may be current, delayed, stale, or reference-only by instrument.
