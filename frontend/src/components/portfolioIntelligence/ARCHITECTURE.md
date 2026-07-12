# Portfolio Intelligence — Architecture & Extension Guide

Refactor of the Portfolio workspace into an institutional **Portfolio Intelligence**
platform. This document describes module boundaries, data flow, and how to add a
new broker/exchange integration without touching UI code.

---

## 1. Constraints honored (Brand v2)

- **Reading order unchanged**: Portfolio Summary → What Needs Attention →
  Recommended Changes → Analysis Workspace. `PortfolioModule` still renders these
  in that exact order; the top three are now delegated to `PortfolioOverview`, the
  fourth to `PortfolioAnalysis`.
- **No trading controls / order entry.** Every new surface is read-only.
  "Connect / Manage Connections" buttons route to existing connection flows;
  nothing places, amends, or cancels orders.
- **Monochrome, token-driven.** New CSS uses only `--color-*` tokens (text,
  border, surface, severity tones). No page-specific or neon colors.
- **No fabricated data.** Empty states are explicit ("No executions yet", "No
  recent activity", "Connect a read-only venue…"). The Order Desk surfaces only
  what connected brokers report; it never invents market data.

---

## 2. Module map

```
PortfolioModule (orchestrator — slim)
├── PortfolioOverview            (feature shell: Summary + Attention + Recommended Changes)
└── PortfolioAnalysis           (feature shell: tab bar + main + right rail)
    ├── Tabs:
    │   ├── Portfolio   → renderLegacyTab('holdings')   [existing]
    │   ├── Performance → renderLegacyTab('attribution') [existing]
    │   ├── Exposure    → renderLegacyTab('exposure')    [existing]
    │   ├── Execution   → ExecutionModule
    │   ├── Orders      → OrdersModule
    │   ├── Costs       → CostsModule
    │   └── Events      → EventsModule
    └── rail → PortfolioIntelligenceRail → IntelligenceRail (Smart Alerts)

Data layer (pure, framework-free):
├── models/domainModels.js          Order, Execution, Venue, Broker, Alert, PortfolioHealth
├── services/OrderNormalizationService.js   cross-broker normalize + adapter registry
├── services/ExecutionService.js           execution normalization + intelligence
└── services/AlertEngine.js                detector registry + severity ranking
```

`PortfolioModule` computes memoized normalized inputs once and passes them down:
- `orderLedger`            = `deriveOrderLedgerFromConnections(connectedAccounts)`
- `normalizedExecutions`  = `normalizeExecutions(apiTradeExecutions)`
- `portfolioHealth`       = `createPortfolioHealth({ drift, concentration, risk })`
- `alertContext`          = `{ orders, executions, brokers, venues, portfolioHealth, notifications, connectedAccounts }`

---

## 3. Normalized data model (never expose provider schemas to UI)

All broker/exchange specifics are converted to shared entities in
`models/domainModels.js` before any component sees them:

| Entity          | Purpose |
|-----------------|---------|
| `Order`         | `normalizeOrderStatus()` (in `models/domainModels.js`) maps every provider status → canonical (`working`, `pending`, `partially_filled`, `filled`, `cancelled`, `expired`, `rejected`). Includes broker, venue, type, qty/filled/remaining, createTime, fees, slippage, executionScore. |
| `Execution`     | Normalized fill: symbol, side, qty, price, notional, fee, slippageBps, maker, ts, venue, broker. |
| `Venue`         | `id`, `name`, `kind` (exchange/darkpool/marketmaker). |
| `Broker`        | `id`, `name`, `kind`, `status`, `accounts`. |
| `Alert`         | `id`, `category`, `severity`, `title`, `message`, `source`, `ts`, `impact`, `recommendedAction`. |
| `PortfolioHealth` | `driftPct`, `concentrationPct`, `riskLevel`, `topMoverSymbol`. |

Canonical enums: `ORDER_STATUS`, `EXECUTION_SIDE`, `ALERT_SEVERITY`
(`critical|warning|info|positive`), `ALERT_CATEGORY`.

---

## 4. Extension point: adding a new broker / exchange

You only write an **adapter** — no UI changes, no new components.

### 4.1 Register an order/execution adapter

In `services/OrderNormalizationService.js`:

```js
import { registerBrokerAdapter } from "./services/OrderNormalizationService";

registerBrokerAdapter({
  id: "mybroker",
  name: "My Broker",
  kind: "exchange",          // or "darkpool" | "marketmaker"
  // Map provider order objects → normalized Order[].
  normalizeOrders(rawAccount) {
    return (rawAccount.orders || []).map((o) => ({
      id: o.id,
      broker: "mybroker",
      venue: o.venue || "mybroker",
      symbol: o.symbol,
      side: o.side.toLowerCase() === "sell" ? "sell" : "buy",
      type: o.type,                              // limit | market | stop | ...
      status: normalizeOrderStatus(o.status),    // → canonical
      quantity: Number(o.qty),
      filledQuantity: Number(o.filled || 0),
      remainingQuantity: Math.max(0, Number(o.qty) - Number(o.filled || 0)),
      createTime: o.createdAt,
      // optional read-only intelligence; 0 when unknown
      estimatedFees: Number(o.fee || 0),
      slippage: Number(o.slippageBps || 0),
      executionScore: Number(o.score || 0),
    }));
  },
});
```

The adapter registry is iterated by `deriveOrderLedgerFromConnections()`, so the
Order Desk, Execution Analysis, and the Alert engine all pick up the new broker
automatically.

### 4.2 Register an execution adapter (if the broker reports fills directly)

`ExecutionService.normalizeExecutions()` currently parses the shared
`/db/trade-executions` shape. If a broker returns raw fills, add a branch or an
adapter hook the same way (`registerExecutionAdapter`) and map → `Execution`.

### 4.3 Add an alert detector

In `services/AlertEngine.js`:

```js
import { registerDetector } from "./services/AlertEngine";

registerDetector({
  id: "mybroker_connectivity",
  category: ALERT_CATEGORY.BROKER_CONNECTIVITY,
  build(context) {
    // context = { orders, executions, brokers, venues, portfolioHealth, notifications, connectedAccounts }
    const bad = context.brokers.filter((b) => b.status === "error");
    return bad.map((b) => ({
      id: `conn-${b.id}`,
      category: ALERT_CATEGORY.BROKER_CONNECTIVITY,
      severity: ALERT_SEVERITY.CRITICAL,
      title: `${b.name} disconnected`,
      message: "Order/execution sync is paused.",
      source: b.name,
      ts: Date.now(),
      impact: "Live order desk and execution intelligence are stale.",
      recommendedAction: "Reconnect the read-only account in Connections.",
    }));
  },
});
```

Detectors are pure functions of `alertContext`, so they are trivially testable and
run only inside `IntelligenceRail` (memoized). New categories auto-appear in the
rail's category filter.

---

## 5. Performance characteristics

- **Lazy-loaded module**: `PortfolioModule` is `lazyWithReloadRetry` in `App.jsx`;
  the intelligence modules ship inside that chunk and tree-shake independently.
- **Memoized inputs**: `orderLedger`, `normalizedExecutions`, `portfolioHealth`,
  `alertContext` are `useMemo`'d in `PortfolioModule` keyed on the real upstream
  state (`connectedAccounts`, `apiTradeExecutions`, drift/concentration/risk).
- **Module-level memo**: `ExecutionModule`, `OrdersModule`, `CostsModule`,
  `EventsModule`, `IntelligenceRail` each `useMemo` their derived views on props.
- **Independent right rail**: `PortfolioIntelligenceRail` owns its own refresh
  token/state. Clicking "Refresh" re-runs `AlertEngine` via `railRefreshToken`
  without re-rendering the main workspace (verified: `alertContextForRail` is
  memoized on `[alertContext, railRefreshToken]`).

---

## 6. Files added

```
frontend/src/components/portfolioIntelligence/
├── ARCHITECTURE.md
├── formatters.js
├── models/domainModels.js
├── services/ExecutionService.js
├── services/OrderNormalizationService.js
├── services/AlertEngine.js
├── modules/OrdersModule.jsx        (User Order Desk)
├── modules/ExecutionModule.jsx     (Execution Analysis)
├── modules/CostsModule.jsx
├── modules/EventsModule.jsx
├── modules/IntelligenceRail.jsx    (Smart Alerts)
├── PortfolioOverview.jsx
├── PortfolioAnalysis.jsx
└── PortfolioIntelligenceRail.jsx
```

`PortfolioModule.jsx` was refactored (imports + orchestration only); its existing
Summary/Attention/Recommended-Changes markup and Holdings/Attribution/Exposure
panels are preserved verbatim inside the new shells.

---

## 7. Known environment-dependent behavior (not defects)

- Backend has **no orders API**. The Order Desk is derived read-only from
  connected broker accounts (`deriveOrderLedgerFromConnections`). With zero
  connections, the desk shows an honest empty state.
- `/db/trade-executions` and `/api/notifications` return **429 CIRCUIT_OPEN**
  under the local rate limit; execution-dependent tabs/rail then show empty
  states. This is environmental and resolves when backend throttling clears.
```
