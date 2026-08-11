---
title: Troubleshooting quickstart
description: Source connection failures, stale data, missing portfolio totals, API/backend availability, and safe credential guidance.
audience: user
status: current
last_verified: 2026-07-19
---

# Troubleshooting quickstart

Common first-run issues and what to check.

## Source connection failures

- **Brokerage (SnapTrade)**: re-authenticate through the broker; confirm you authorized read-only access. SnapTrade supports a subset of brokers — if yours is missing, the connection cannot complete.
- **Exchange API key rejected**: Zenin rejects keys with trade or withdraw permission. Create a **read-only** key and retry.
- **Hyperliquid watch-only**: confirm the address is a valid public address; no secret is required.
- Check **Notifications** for a source-health notice with the specific reason.

## Stale or missing data

- Open **Portfolio** and check each position's **freshness state**.
- **Stale / delayed** means the last refresh is old or the source provides delayed data — not a bug.
- **Unavailable / reference-only** means the source did not return a live value; Zenin shows the state instead of a fabricated number.
- Data coverage varies by instrument and provider; some assets simply have no live feed.

## Missing portfolio totals

- Confirm the connection completed and the first sync ran (see [First portfolio sync](/get-started/first-portfolio-sync)).
- Add **manual positions** for anything outside your connections.
- If the same instrument appears in two sources, expect a **duplicate-exposure warning** rather than a doubled total — the unified view reconciles it.

## API / backend availability

- If the app cannot load workspace data, the backend API may be unavailable. Check the service status or your network.
- Retry the action after a short wait; Zenin retries source syncs per each source's retry behavior.

## Safe credential guidance

- Never paste broker **passwords** into Zenin. Use SnapTrade or read-only API keys.
- Use **read-only** exchange keys; never trade/withdraw-enabled keys.
- For Hyperliquid, use a **public watch-only address** — no secret needed.
- Do not commit keys to repositories or share them in support threads.

If you are still blocked, note the exact asset, source, and the freshness/error state shown, then contact support.
