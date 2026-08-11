---
title: Connect data sources
description: SnapTrade brokerage, exchange API keys, Hyperliquid watch-only wallets, read-only permissions, expected data, and source limits.
audience: user
status: current
last_verified: 2026-07-19
---

# Connect data sources

Zenin reads your data through **read-only** connections. It does not need, and should not be given, trade-execution permission. Connecting a source lets Zenin import holdings, balances, and executions so your research and portfolio stay in context.

## SnapTrade brokerage connection

SnapTrade connects brokerage accounts to Zenin without sharing your broker login.

1. Open **Settings → Connected accounts** (or the connection prompt).
2. Choose your broker and authenticate through SnapTrade.
3. Authorize **read-only** access to holdings, balances, and executions.
4. Return to Zenin; the connection appears as **connected**.

**Expected data:** holdings, cash balances, and executed trades from the linked brokerage account.

**Limitations:** coverage depends on the broker SnapTrade supports and the permissions you grant. Live order routing is never enabled through this connection.

## Exchange API keys

For exchanges that support API access, add a **read-only** key.

1. Create an API key in the exchange's dashboard.
2. Restrict it to **read-only** (no trade, no withdraw).
3. Paste the public key and secret into Zenin's connection form.
4. Save; Zenin verifies the key is read-only before storing it encrypted.

> If the exchange reports trading or withdrawal permission on the key, Zenin **rejects** it. Use a read-only key only.

**Limitations:** sync availability varies by exchange. Some venues are watch-only addresses rather than API keys (see Hyperliquid below).

## Hyperliquid watch-only wallets

For Hyperliquid, connect a **public watch-only address** instead of an API key.

1. Enter your Hyperliquid wallet address.
2. Zenin imports live portfolio context from the public address — no secret required.

**Limitations:** a watch-only address shows public on-chain context. It does not grant Zenin any write access.

## Source limitations (applies to all connections)

- Upstream services can be **rate-limited, incomplete, delayed, or unavailable**.
- Coverage varies by asset class, instrument, and provider.
- Some results may be **cached, stale, unavailable, or reference-only** rather than live.
- Zenin shows a clear status instead of manufacturing values it cannot source.

**Next:** [First portfolio sync](/get-started/first-portfolio-sync)
