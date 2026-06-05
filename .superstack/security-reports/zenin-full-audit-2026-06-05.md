# Zenin Full Audit - 2026-06-05

Scope: full CSO audit plus product-review and product-roast pass.
Target: live app, active retail traders, prototype stage.

## Executive Summary

Zenin has a real security foundation in source: backend-managed sessions, CSRF origin checks, rate limits, production config guards, MFA/passkey-aware admin flows, and hardened response headers. The live product risk is deploy drift: the live bundle still ships old Supabase-named auth code and localhost fallback logic, which matches the Google OAuth failure screenshots and undermines user trust.

For active retail traders, the product promise is strong but trust-sensitive. A trader will forgive a prototype missing a niche analytics feature before they forgive auth wakeups, stale deployments, or unclear exchange-credential guarantees.

## Verified Security Findings

### 1. Live frontend deploy still contains localhost fallback auth behavior

Severity: High
Confidence: 10/10

Evidence:
- Live `https://www.zenin.capital/` loads `supabaseAuth-ywjZ2qLE.js` and `App-H3ekvKuU.js`.
- The fetched live auth chunk still falls back to `http://localhost:4000/api` on local/private hostnames.
- The fetched live app chunk still contains WebSocket URL fallback text using `http://localhost`.
- User screenshots show Google OAuth callback redirecting to `http://localhost:5173/app`, then failing.

Impact:
Production auth can send users into an unreachable local callback or stale route after OAuth, creating failed login, lost trust, and support churn.

Fix:
Redeploy the current cleaned frontend/backend pair, then add a CI/build gate that fails if production bundles contain `localhost`, `127.0.0.1`, `::1`, or `supabaseAuth` compatibility chunk names outside test/dev artifacts.

### 2. Known vulnerable production dependencies

Severity: Medium
Confidence: 10/10

Evidence:
- Root `npm audit --omit=dev`: `ws@8.20.0`, GHSA-58qx-3vcg-4xpx, moderate uninitialized memory disclosure.
- Backend `npm audit --omit=dev`: 8 moderate findings covering `ws`, `express` via `qs`, `body-parser` via `qs`, `resend` via `svix`/`uuid`, and `gaxios` via `uuid`.
- Frontend audit returned 0 vulnerabilities.
- Admin audit was blocked by sandbox network approval, so admin dependency status was not verified.

Fix:
Upgrade `ws` to `>=8.20.1`, update Express/body-parser/qs to patched ranges, and update Resend/Svix/uuid to patched releases. Re-run root, backend, frontend, and admin audits in CI.

### 3. Exchange credentials are labeled read-only but not provider-verified

Severity: Medium
Confidence: 8/10

Evidence:
- Frontend copy repeatedly tells users to add read-only credentials.
- `backend/index.js` forces saved metadata to `permissionScope: "read_only"` and `canTrade: false`.
- Validation accepts `permissionScope` and `canTrade`, but the server overwrites them and does not appear to verify provider-side key permissions before storing/syncing.

Impact:
If a user pastes a trading-capable API key, Zenin labels it read-only locally, but the provider-side credential may still be over-privileged. A backend compromise or adapter bug would have more blast radius than the UI implies.

Fix:
For each supported provider, verify key scope at connection time where the API exposes it. If provider scope cannot be verified, show "scope unverified" and block live sync until the user confirms provider-side read-only settings. Consider storing only watch-only addresses first for default onboarding.

### 4. Duplicate production routes increase behavioral drift risk

Severity: Low
Confidence: 10/10

Evidence:
- `backend/index.js` defines duplicate handlers for:
  - `/api/analytics/equities`
  - `/api/db/execute-trade`
  - `/api/db/execute-trade/estimate`

Impact:
Express uses the first matching route for completed responses, making later duplicates dead or confusing. This is not presently an exploit, but it creates regression risk around trade execution/accounting.

Fix:
Remove duplicates and add a route uniqueness test.

## What Looked Solid

- Production CSRF/origin handling blocks hostile origin state-changing requests.
- Auth, password reset, admin, write, expensive-read, and options-chain routes have rate limits.
- Session cookies are HTTP-only, Secure in production, and SameSite-aware.
- Admin routes require signed-in user, DB admin status, strong auth posture, and optional production IP allowlisting.
- Production fails hard for weak auth secrets and mock OAuth/admin bypass flags.
- Security headers are present on live frontend and backend.
- CI security workflow pins GitHub Actions by commit SHA and runs dependency audits.

## Product Review

Overall product quality for an active retail trader prototype: 5.5/10.

Scorecard:
- Onboarding Flow: 5/10 - value prop is clear, but live auth/guest/OAuth friction breaks the first session.
- Core Experience: 6/10 - the multi-desk portfolio/research/options/tax idea is useful, but the prototype tries to be too many terminals at once.
- Error Handling: 6/10 - auth messaging has improved locally, but live deploy drift still causes confusing failures.
- Information Architecture: 6/10 - modules are understandable, but the trader's daily path is not sharp enough.
- Visual Design & Polish: 7/10 - landing page is polished after the black-theme cleanup, but static proof must keep matching the real app.
- Performance: 4/10 - Render wakeups and stale Vercel assets are not acceptable for active traders.
- Accessibility: 5/10 - not fully verified; dense dashboards and mobile nav need continued QA.
- Feature Completeness: 6/10 - broad prototype coverage, but notifications/trade history/integrations still need reliability proof.

Top strengths:
- Clear, trader-relevant promise: portfolio tracking, research, options, and tax in one place.
- Strong breadth for a prototype, especially the decision workflow from watchlist to research to journal.
- Better-than-average auth/security architecture in source for a young product.

Top improvements:
- Make production deploy integrity boring: no stale bundles, no localhost fallbacks, no sleeping auth.
- Narrow the first-time trader workflow to one crisp loop: connect/read-only import, see holdings/fills, get alert, journal decision.
- Add trust proof near every account-connection step: read-only verification, data freshness, supported providers, and what Zenin cannot do.

## Roast

Verdict: Zenin asks active traders to trust a financial command center, but the live prototype currently cannot prove its own auth and deployment state consistently.

Roast scorecard:
- Value Proposition: 7/10 - useful and clear.
- Crypto Necessity: 4/10 - crypto is a data vertical here, not a necessary primitive.
- Target User Clarity: 6/10 - "active retail trader" is real, but the product still spans too many personas.
- First-Time User Experience: 4/10 - OAuth/local fallback/wake-state failures are brutal.
- Core Loop: 6/10 - alerts, fills, and journal can work, but need to be reliable.
- Competitive Moat: 3/10 - integrations and dashboards are copyable without proprietary workflow/data advantages.
- Technical Execution: 5/10 - source is thoughtful, live deployment is not yet disciplined.
- Naming & Messaging: 7/10 - brand and homepage message are strong enough.
- Monetization Path: 6/10 - pricing exists, but trust is not high enough for paid conversion yet.
- Market Timing: 7/10 - retail traders do want unified multi-asset context.

Fix these now:
1. Highest impact: eliminate deploy drift and add production bundle scans for local fallback strings.
2. Easiest win: add a visible "Production status: auth, data, exchange sync" trust panel on auth/onboarding.
3. Existential fix: move off sleeping auth infrastructure or configure a paid always-on service for the auth backend.

## Verification Notes

Commands/checks run:
- Live homepage/auth/backend `curl` checks against `https://www.zenin.capital/` and `https://zenin-mx6w.onrender.com`.
- Valid-origin and hostile-origin CSRF/auth checks.
- Root/backend/frontend `npm audit --omit=dev`.
- Route/rate-limit/credential-handling searches in `backend/index.js`, `backend/database.js`, `backend/validation.js`, and frontend source.

Blocked:
- Admin `npm audit` could not be completed because the sandbox network approval was rejected.
- In-app browser automation was unavailable in this session, so live UI review used current user screenshots plus fetched live HTML/JS.
