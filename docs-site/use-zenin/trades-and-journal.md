---
title: Trades and journal
description: Connected execution imports, current manual/simulated trade behavior, journal entries, decision reviews, and the difference between execution records and notes.
audience: user
status: current
last_verified: 2026-07-19
---

# Trades and journal

Zenin separates **execution records** (what happened) from **journal entries** (what you thought and decided). Keeping them distinct is the point of the journal.

## Connected execution imports

When a connected account syncs, completed trades become **execution records**:

- symbol, side, quantity, price, notional, fees, and timestamp;
- the source the execution came from;
- a link back to the holding it affected.

These are factual records, not opinions.

## Current manual / simulated trade behavior

Where a connection is not available, or you want to plan a trade, you can record a trade manually or as a simulation. Treat manual entries as **your input**, not imported brokerage data:

- A manual trade is attributed to you, not a source.
- A simulated trade is a plan, not an executed position.

This keeps "what I intended" separate from "what actually executed."

## Journal entries

A **journal entry** captures the decision and its rationale:

- the thesis and evidence;
- the planned entry/exit or rule;
- notes and attached research.

Journal entries can be linked to executions so the decision and the outcome sit together.

## Decision reviews

After the trade plays out, add a **decision review**:

- what happened versus the plan;
- the lesson or rule to repeat / remove;
- handoff to the next session.

Reviews turn the journal from a log into a feedback loop.

## Execution record vs note

| | Execution record | Journal note |
| --- | --- | --- |
| Source | Imported from a connection or entered by you | Written by you |
| Represents | What happened | What you thought / decided |
| Editable facts | No (it is a record) | Yes |
| Used for | Attribution, P&L, audit | Reflection, review |

---

## What this does / does not do

**What this does**

- Imports executions from connected accounts as factual records.
- Lets you record manual or simulated trades separately.
- Links journal entries and reviews to executions.

**What it does not do**

- It does not execute trades.
- It does not treat a simulated trade as a real position.
- It does not alter an execution record's facts.

**Data source and freshness**

Executions come from your connected read-only sources (SnapTrade brokerage, exchange API keys). Manual and simulated trades are entered by you and marked accordingly. Journal content is created in-app and persisted in your workspace.
