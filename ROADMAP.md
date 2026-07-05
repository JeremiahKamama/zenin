# Zenin — Production Readiness Roadmap

## Completed (Immediate / Short-term tiers)

| ID   | Severity | Description | Status |
|------|----------|-------------|--------|
| C2   | Critical | `.gitignore` hardening (untrack `node_modules`, `.DS_Store`) | Done |
| C3   | Critical | Workspace authorization on balance/options/perps endpoints | Done |
| H1   | High     | Global Express 4-arg error handler + `unhandledRejection`/`uncaughtException` hooks | Done |
| H2   | High     | Rate-limit + validate `verify-email` and `resend-verification` | Done |
| H3   | High     | SIGTERM/SIGINT graceful shutdown (HTTP drain + WS + pool) | Done |
| H4   | High     | `/health` liveness + `/health/ready` readiness (probes Postgres) | Done |
| H5   | High     | CSRF Origin strictness (cookie-bearing stateless requests require CSRF token) | Done |
| H6   | High     | OAuth state nonce binding (httpOnly cookie + timingSafeEqual) | Done |
| H10  | High     | Pin Node version (`.nvmrc` + CI `setup-node`) + CI workflow | Done |
| H11  | High     | Document all missing env vars in `.env.example` files | Done |
| H14  | High     | `FullMetricsPage` error/empty states + AbortController on fetch effects | Done |
| M1   | Medium   | Account-aware rate-limit keys (IP + email hash) | Done |
| M2   | Medium   | `requireSignedIn` prefix guard on `/api/admin` routes | Done |
| M3   | Medium   | `requireRecentAdminReauth` on destructive admin endpoints | Done |
| M7   | Medium   | 8 database performance indexes | Done |
| M14  | Medium   | WCAG: `htmlFor`/`id` label associations in `AuthModal` | Done |
| M15  | Medium   | AbortController in `HomeModule` and `AssetModal` fetch effects | Done |
| M17  | Medium   | Input validation schemas for `verifyEmail` and `resendVerification` | Done |
| —    | Medium   | WCAG: `role="status"` + `aria-label` on data-health badges | Done |
| —    | Low      | Repo hygiene: remove scratch files, fix scripts, remove junk deps | Done |

---

## Remaining Items (Medium-term / Long-term)

These items require larger engineering effort and are tracked here for future sprints.

### C1 — Float → NUMERIC money migration (Large effort)

**Problem:** Portfolio balances, P&L figures, and trade amounts are stored as `FLOAT`/`DOUBLE PRECISION` in PostgreSQL. Floating-point arithmetic introduces rounding errors that compound in financial calculations (e.g., $0.00000001 drift per trade).

**Scope:**
1. Audit every monetary column across all tables (`portfolios`, `trades`, `transactions`, `workspace_members`, etc.)
2. Create migration SQL: `ALTER TABLE … ALTER COLUMN … TYPE NUMERIC(20,6)` with careful `USING` clauses to preserve existing data
3. Update all backend code that reads/writes these columns to use `Decimal.js` or similar for arithmetic
4. Update frontend display formatting to handle arbitrary precision
5. Add integration tests comparing float vs. numeric results on historical data

**Estimated effort:** 2-3 sprints

---

### C4/C5 — Database migration framework (Large effort)

**Problem:** Schema changes are currently applied ad-hoc (direct SQL or manual `ALTER TABLE`). No versioned migration system means schema drift between environments is likely, and rollbacks are manual.

**Scope:**
1. Choose a migration tool (e.g., `db-migrate`, `node-pg-migrate`, or Prisma Migrate)
2. Extract current schema into an initial "baseline" migration
3. Convert the 8 indexes added in M7 into a proper numbered migration file
4. Add migration run step to CI and deployment scripts
5. Document migration workflow in CONTRIBUTING.md

**Estimated effort:** 1-2 sprints

---

### L15 — Split god-files into route modules (Large effort)

**Problem:** `backend/index.js` is 16K+ lines and `backend/database.js` is 9K+ lines. Both are monolithic files that make code review, testing, and navigation difficult. This is a maintenance and reliability risk.

**Scope for `index.js`:**
1. Extract route groups into `/routes/` directory (e.g., `auth.routes.js`, `portfolio.routes.js`, `admin.routes.js`, `market-data.routes.js`)
2. Extract middleware into `/middleware/` directory
3. Extract WebSocket handlers into `/ws/` directory
4. Keep `index.js` as the Express app assembly point (~200 lines)

**Scope for `database.js`:**
1. Extract query functions into `/db/` directory grouped by domain (e.g., `portfolio.queries.js`, `user.queries.js`, `admin.queries.js`)
2. Keep `database.js` as pool initialization + re-exports

**Estimated effort:** 3-4 sprints (can be done incrementally, route-group by route-group)

---

### M20 — Consolidate chart libraries (Large effort)

**Problem:** The frontend bundles 5+ charting libraries (ApexCharts, Recharts, lightweight-charts, and others). This inflates the JS bundle significantly (~700KB+ in chart vendor chunks) and creates inconsistent visual styles.

**Scope:**
1. Audit every chart usage across all modules
2. Choose a single charting library that covers all use cases (line/area charts, candlesticks, heatmaps, etc.)
3. Migrate each module's charts one at a time
4. Remove unused chart libraries from `package.json`

**Estimated effort:** 2-3 sprints

---

### H12 — Drop localStorage auth mirror (Medium effort)

**Problem:** Auth state is mirrored in `localStorage` as a fallback. This creates a secondary auth surface that can become stale or out-of-sync with the server session cookie, leading to confusing UX (e.g., showing as logged in when the session has expired).

**Scope:**
1. Audit all reads of the localStorage auth mirror across the frontend
2. Replace with direct reliance on the `zenin_session` httpOnly cookie
3. Add a lightweight auth-check endpoint or use an existing protected endpoint to verify session validity on app load
4. Remove localStorage auth mirror code
5. Add session expiry detection with automatic redirect to login

**Estimated effort:** 1 sprint

---

### Other lower-priority items

| ID   | Severity | Description | Effort |
|------|----------|-------------|--------|
| H7   | High     | Streaming response timeouts for large dataset endpoints | Medium |
| H8   | High     | Input sanitization pass on all user-supplied strings (XSS in rendered content) | Medium |
| H9   | High     | WebSocket message size limits and rate limiting | Small |
| H13  | High     | Content Security Policy headers | Small |
| M4   | Medium   | Backend request logging (structured JSON, request IDs) | Small |
| M5   | Medium   | CORS configuration audit and hardening | Small |
| M6   | Medium   | API response pagination standardization | Medium |
| M8   | Medium   | Frontend bundle analysis and tree-shaking audit | Small |
| M9   | Medium   | Image lazy loading and format optimization | Small |
| M10  | Medium   | Lighthouse CI performance budget | Small |
| M11  | Medium   | Keyboard navigation audit | Medium |
| M12  | Medium   | Focus management for modals and route changes | Small |
| M13  | Medium   | Color contrast audit (WCAG AA) | Small |
| M16  | Medium   | `prefers-reduced-motion` media query respect | Small |
| M18  | Medium   | Error boundary components at route level | Small |
| M19  | Medium   | Unit test coverage for frontend utilities | Medium |
| M21  | Medium   | Dead code removal across frontend components | Small |
| L1   | Low      | API versioning strategy | Small |
| L2   | Low      | OpenAPI/Swagger spec generation | Medium |
| L3   | Low      | Rate-limit response headers (`Retry-After`, `X-RateLimit-*`) | Small |
| L4   | Low      | Dependency audit and update cadence | Small |
| L5   | Low      | Backend integration/E2E test suite | Large |
| L6   | Low      | Frontend E2E tests (Playwright/Cypress) | Large |
| L7   | Low      | Container image security scanning in CI | Small |
| L8   | Low      | Monitoring/observability integration (structured logs → Datadog/Grafana) | Medium |
| L9   | Low      | Infrastructure-as-code (Terraform/Pulumi) | Large |
| L10  | Low      | Multi-region deployment strategy | Large |
| L11  | Low      | Autoscaling and capacity planning | Medium |
| L12  | Low      | Cost attribution per service | Small |
| L13  | Low      | Chaos engineering / load testing | Medium |
| L14  | Low      | Incident response runbooks | Medium |
