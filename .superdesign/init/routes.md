# Zenin Route Map

This repository is a Vite React app with route selection in `frontend/src/main.jsx`.

## Route entry points

- `/app` -> authenticated workspace shell in `frontend/src/App.jsx`
- `/auth` -> authentication view in `frontend/src/AuthPage.jsx`
- `/terms` and `/privacy` -> legal content in `frontend/src/LegalPage.jsx`
- all other paths -> public marketing site in `frontend/src/PublicHomepage.jsx`

## Superdesign mapping for this draft

The requested Superdesign draft `Zenin Capital Home - Executive Grid (Refined)` is not a public landing page. It maps to the authenticated `/app` experience, specifically the default home dashboard rendered inside `App.jsx`.

## Primary implementation target

- Route: `/app`
- Shell owner: `frontend/src/App.jsx`
- Home content owner: `frontend/src/components/HomeModule.jsx`
- Shared app styling: `frontend/src/styles.css`
