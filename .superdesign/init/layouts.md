# Zenin Layout Notes

## Current shell

- Left sidebar owned by `App.jsx`
- Main content region swaps modules based on selected section
- Existing sidebar was recently redesigned toward a flatter operator-console look

## Current dashboard

- `HomeModule.jsx` uses stacked cards and sectional panels
- Current classes are heavily namespaced under `home-v2-*` and `home-v3-*`
- `frontend/src/styles.css` contains many layered overrides for these namespaces

## Recommended layout strategy for the draft

- Preserve the existing `/app` shell structure
- Keep the recent sidebar overhaul and only tune it where the draft requires tighter integration
- Introduce a fresh dashboard namespace, preferably `home-exec-*`, for the executive grid
- Avoid retrofitting the entire draft into the older `home-v2-*` or `home-v3-*` selectors because that raises regression risk
