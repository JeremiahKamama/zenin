# Extractable Component Opportunities

## Good candidates for extraction during implementation

- `ExecutiveHeroPanel`
  - total portfolio value
  - daily change
  - buying power / cash / active allocation stats

- `ExecutiveStatRail`
  - compact right-side metrics such as beta, theta, buying power percentage, implied volatility, and health

- `OperationalTriageStrip`
  - alerting row for rebalance, missing data, volatility, or risk warnings

- `ExecutionLogTable`
  - recent activity table with compact rows and status styling

- `AllocationDonutPanel`
  - asset allocation visualization and compact legend

- `TopHoldingsPanel`
  - ranked holdings list with weight, change, and contribution columns

## Recommendation

Keep the first implementation mostly inside `HomeModule.jsx` unless extraction materially improves readability. Create subcomponents only for the densest new panels or if a panel is likely to be reused elsewhere.
