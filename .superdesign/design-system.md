# Zenin Superdesign Working Notes

## Imported draft

- Project ID: `1db5c01c-f7bb-495d-84dc-642d46114698`
- Draft ID: `5fc774a5-00d9-4e20-95f1-9a5b1b017976`
- Draft title: `Zenin Capital Home - Executive Grid (Refined)`

## Draft summary

The imported design is an authenticated executive dashboard, not a marketing homepage. It combines:

- a terminal-style shell
- a portfolio overview header
- a dominant total-value hero
- a compact right stat rail
- an operational triage strip
- a performance chart
- an execution log
- top holdings
- allocation analysis

## Implementation constraints

- The repo uses React + Vite with hand-authored CSS, not a utility-first CSS framework
- `frontend/src/styles.css` is already large and layered, so new selectors should be tightly namespaced
- Home dashboard data is partially available already; some design metrics are not yet modeled in the frontend view state

## Draft-to-code principle

Translate the draft as a dashboard evolution of the current home module rather than a route rewrite or full-shell reset.
