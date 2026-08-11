# Sentry Observability — Zenin

Zenin uses Sentry as its primary error-monitoring, performance-tracing, and release-tracking platform. This document covers setup, deployment, the error-triage workflow, and privacy guarantees.

## Architecture

Zenin runs **two separate Sentry projects** for clean issue separation:

| App | Sentry project | SDK | Init module |
| --- | --- | --- | --- |
| Backend (Node.js / Express) | `zenin-backend` | `@sentry/node` + `@sentry/profiling-node` | `backend/sentry.js` |
| Frontend (React / Vite SPA) | `zenin-frontend` | `@sentry/react` | `frontend/src/sentry.js` |

The admin console is not instrumented (separate lightweight app).

### No-op when unconfigured

Both Sentry modules are **gated on their DSN env var**. When the DSN is unset (local development, tests), every wrapper (`captureException`, `addBreadcrumb`, `setUser`, `withSpan`, `close`) is a safe no-op. You can develop and run tests without any Sentry credentials.

---

## Setup

### 1. Create the Sentry projects

In your Sentry org, create two projects:
- `zenin-backend` (platform: Node)
- `zenin-frontend` (platform: React)

### 2. Generate auth tokens

Sentry → Settings → Auth Tokens. Create a token with scopes:
- `project:releases`
- `project:write`
- `org:read` (for `--auto` commit association)

You'll use one token per project (or a single org-level token with access to both).

### 3. Configure environment variables

#### Backend (`backend/.env`)

```bash
SENTRY_BACKEND_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
SENTRY_ENVIRONMENT=production        # staging / development for non-prod
SENTRY_ORG=your-org-slug
SENTRY_BACKEND_PROJECT=zenin-backend
SENTRY_BACKEND_AUTH_TOKEN=sntrys_... # build-time only; used for release upload
SENTRY_TRACES_SAMPLE_RATE=0.1        # 10% of requests traced
SENTRY_PROFILES_SAMPLE_RATE=0.1      # 10% of traced requests profiled
# SENTRY_RELEASE=optional            # defaults to git SHA
```

#### Frontend (`frontend/.env.production` or Render env)

```bash
VITE_SENTRY_FRONTEND_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_ORG=your-org-slug
VITE_SENTRY_FRONTEND_PROJECT=zenin-frontend
VITE_SENTRY_AUTH_TOKEN=sntrys_...    # build-time only; used for sourcemap upload
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=0.1
VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=1.0
```

> **Note:** `VITE_SENTRY_AUTH_TOKEN` is used by `@sentry/vite-plugin` at build time and is **never** bundled into the client. It's safe to set in CI/Render build env.

### 4. Configure CI secrets (GitHub Actions)

In your GitHub repo → Settings → Secrets and variables → Actions, add:
- `SENTRY_ORG`
- `SENTRY_BACKEND_AUTH_TOKEN`
- `SENTRY_BACKEND_PROJECT`
- `SENTRY_FRONTEND_AUTH_TOKEN`
- `SENTRY_FRONTEND_PROJECT`

The CI workflow (`.github/workflows/ci.yml`) creates a backend release and uploads frontend sourcemaps on every push to `main`.

### 5. Configure Render

`render.yaml` already declares the backend Sentry env vars. In the Render dashboard, set the values for the `zenin-mx6w` service:
- `SENTRY_BACKEND_DSN` (secret)
- `SENTRY_ORG`
- `SENTRY_BACKEND_PROJECT`
- `SENTRY_BACKEND_AUTH_TOKEN` (secret)

---

## Local development

No configuration needed. Without `SENTRY_BACKEND_DSN` / `VITE_SENTRY_FRONTEND_DSN`, the Sentry modules are no-ops. `console.error` / `console.warn` continue to work as before.

To test Sentry locally, set the DSN env vars and use `SENTRY_ENVIRONMENT=development` so events are clearly separated from production.

---

## Releases & source maps

### Backend

Releases are created in CI (`.github/workflows/ci.yml`) via `backend/scripts/sentry-release.mjs` on every push to `main`. The script:
1. Creates a new release named after the git SHA
2. Associates the git commits (`--auto`)
3. Marks the release as deployed to the configured environment

The release name is automatically picked up by the running server (via `resolveRelease()` in `backend/sentry.js`, which derives it from `SENTRY_RELEASE` or `git rev-parse --short HEAD`).

### Frontend

Source maps are handled by `@sentry/vite-plugin` in `frontend/vite.config.js`:
- Sourcemaps are generated as `hidden` (not referenced in the deployed HTML)
- When `VITE_SENTRY_AUTH_TOKEN` is present, the plugin uploads them to Sentry and deletes the local `.map` files
- The release name derives from `VITE_SENTRY_RELEASE` or `RENDER_GIT_COMMIT`

This means **stack traces in Sentry map back to original source** without exposing sourcemaps publicly.

### Verifying source maps

After a deploy, check a frontend error in Sentry → the stack trace should show the original `.jsx` file and line numbers (not minified). If you see minified output, verify:
1. The build ran with `VITE_SENTRY_AUTH_TOKEN` set
2. The release name in Sentry matches the release tag on the event
3. The `dist/assets/*.map` files were uploaded (check the release's "Source Maps" tab)

---

## Error-triage workflow

### Finding the request in admin logs

Every Sentry event from the backend includes a `requestId` tag. To trace a request:

1. Open the Sentry event
2. Copy the `requestId` tag value
3. In the Zenin admin console → System Logs, filter by that request ID
4. You'll see the full request context: method, path, status, duration, user, IP

### Understanding event tags

| Tag | Meaning |
| --- | --- |
| `requestId` | Per-request UUID; cross-reference with admin system logs |
| `component` | `backend` or `frontend` |
| `authSource` | `session` / `guest` |
| `provider` | `snaptrade` / `fmp` (for brokerage/market-intel errors) |
| `errorCode` | Domain error code (e.g. `BROKERAGE_AUTH_ERROR`) |
| `statusCode` | HTTP status (for request errors) |
| `kind` | `chunk_load` / `uncaught_exception` / `unhandled_rejection` / `error-boundary` |
| `layer` | `app-shell` / widget name (for React error boundaries) |

### Brokerage connection failures

SnapTrade auth errors (expired/revoked tokens) are captured with `provider: snaptrade` + `errorCode: BROKERAGE_AUTH_ERROR`. These indicate a user needs to reauthorize their brokerage connection. Sync failures include `connectionId` and `workspaceId` tags.

### Market data failures

FMP rate-limit, timeout, and auth errors are captured at the client level (`backend/market-intel/providers/financial-modeling-prep/client.js`) with `provider: fmp` + a `kind` tag (`rate_limited` / `timeout` / `auth_error` / `network_error`). Latency breadcrumbs are recorded for every successful request.

---

## Session Replay

Session Replay is enabled on the frontend with these privacy controls:

- **All form inputs are masked by default** (`maskAllInputs: true`)
- Sensitive financial fields should additionally use `data-sentry-block` to fully exclude them from recordings
- Network request bodies are captured only for the Zenin API origin; Stripe, RevenueCat, and SnapTrade origins are denied
- 10% of normal sessions are recorded; 100% of error sessions are recorded

### Marking sensitive fields

Add `data-sentry-block` to any element that should never appear in a replay:

```jsx
<input data-sentry-block type="text" name="accountNumber" />
<div data-sentry-block className="brokerage-credentials">...</div>
```

Add `data-sentry-mask` to mask text content while keeping the element visible:

```jsx
<span data-sentry-mask>{sensitiveValue}</span>
```

---

## Privacy & security

The `beforeSend` hook in both `backend/sentry.js` and `frontend/src/sentry.js` sanitizes every event before it leaves the process:

**Stripped keys** (value replaced with `[Filtered]`):
`password`, `token`, `authorization`, `cookie`, `secret`, `apiKey`, `credential`, `jwt`, `session`, `privateKey`, `bearer`, `refreshToken`, `accessToken`, `clientSecret`, `consumerKey`, `snaptrade_secret`, `whsec_`, `accountNumber`, `cardNumber`, `cvv`, `sortCode`

**Redacted patterns in string values**:
- Database connection strings (`postgres://user:pass@host` → `postgres://[Filtered]@host`)
- HTTP basic auth in URLs
- Bearer tokens
- Stripe `whsec_` secrets
- Resend / SendGrid API keys (`re_...`, `SG....`)
- JWTs (three base64url segments)

**Never sent**:
- Request bodies (the `data` field is deleted from request context)
- `sendDefaultPii: false` — no IP addresses or cookies auto-attached
- SnapTrade credentials, session tokens, password hashes

The sanitizer is unit-tested in `backend/test/unit/sentry.test.js` (28 tests covering key redaction, value redaction, nested objects, circular references, and size bounds).

---

## Performance sampling rates

| Env var | Default | Purpose |
| --- | --- | --- |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Fraction of backend requests traced |
| `SENTRY_PROFILES_SAMPLE_RATE` | `0.1` | Fraction of traced requests with CPU profiling |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Fraction of frontend pageloads/transitions traced |
| `VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE` | `0.1` | Fraction of normal sessions recorded |
| `VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | `1.0` | Fraction of error sessions recorded |

**Tuning**: Increase `TRACES_SAMPLE_RATE` to `1.0` in development for full visibility. Lower to `0.05` in production if you're hitting Sentry quota. The brokerage sync and market-intel fetch spans are always recorded regardless of sample rate (they're nested under sampled parent spans).

---

## What's instrumented

### Backend
- ✅ Unhandled promise rejections + uncaught exceptions (with flush before exit)
- ✅ Express error handler (5xx captured, 4xx filtered)
- ✅ `handleServerError()` mirrors 5xx into Sentry
- ✅ Every `/api/` request gets a breadcrumb (method, path, status, duration)
- ✅ Auth context sets user scope (id, role — never tokens)
- ✅ Graceful shutdown flushes the event queue
- ✅ Brokerage sync: spans per provider call, capture on failure with provider/connection/workspace tags
- ✅ SnapTrade: breadcrumb per SDK failure, auth errors captured distinctly
- ✅ Market intel: spans on quote fetches, cache hit/miss breadcrumbs, FMP client captures rate-limit/timeout/auth/network errors with latency

### Frontend
- ✅ React rendering errors (via enhanced `GenericErrorBoundary`)
- ✅ Chunk/dynamic-import load failures (with auto-reload on first failure)
- ✅ Unhandled JS errors + promise rejections (Sentry default handlers)
- ✅ Route transitions (entry-loader navigation breadcrumbs)
- ✅ User context synced from auth state (id, role, plan — never tokens)
- ✅ Session Replay with input masking + financial-field blocking
- ✅ Browser tracing (page loads, route transitions, INP)

### Admin
- ⏭️ Not instrumented (separate lightweight app)
