#!/usr/bin/env node
/**
 * Route contract inventory (Phase 6, read-only).
 *
 * Compares backend route declarations (backend/index.js) against frontend
 * API client calls (frontend/src) and classifies each backend route as:
 *   - connected        : a frontend client call matches this route
 *   - admin-only       : under /api/admin (excluded from main-app report)
 *   - backend-only     : no frontend match, not health/webhook/admin
 *   - frontend-no-backend: frontend call with no backend route (potential bug)
 *
 * Dynamic params and /api prefixes are normalized. Health checks and webhook
 * callbacks are excluded. Intentionally backend-only routes are reported, not
 * failed — CI should not break on them until they are classified for removal.
 *
 * Usage: node scripts/route-inventory.cjs
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BACKEND_INDEX = path.join(ROOT, "backend", "index.js");
const FRONTEND_SRC = path.join(ROOT, "frontend", "src");

function normalize(route) {
  let r = route.replace(/^\/api/, ""); // strip /api prefix
  r = r.replace(/\/:([a-zA-Z0-9_]+)/g, "/:param"); // named params
  r = r.replace(/\/\d+/g, "/:param"); // numeric ids
  r = r.replace(/\/:[a-zA-Z0-9_]+\?/g, "/:param"); // optional params
  return r;
}

// ── backend routes ────────────────────────────────────────────────────────
const backendSrc = fs.readFileSync(BACKEND_INDEX, "utf8");
const backendRoutes = [];
const routeRe = /app\.(get|post|put|delete|patch)\(\s*['"`](\/api\/[^'"`]+)['"`]/g;
let m;
while ((m = routeRe.exec(backendSrc))) {
  backendRoutes.push({ method: m[1].toUpperCase(), path: m[2] });
}

// ── frontend calls ────────────────────────────────────────────────────────
const frontendCalls = new Set();
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(js|jsx)$/.test(entry.name)) continue;
    const src = fs.readFileSync(full, "utf8");
    // Static string calls: zeninFetch("/api/...")
    const re = /zeninFetch(Json)?\(\s*["'`](\/api\/[^"'`]+)["'`]/g;
    let fm;
    while ((fm = re.exec(src))) {
      frontendCalls.add(fm[2]);
    }
    // Template-literal calls: zeninFetch(`/api/.../${x}/...`) — normalize ${..}
    const tre = /zeninFetch(Json)?\(\s*[`]([^`]*)[`]/g;
    let tm;
    while ((tm = tre.exec(src))) {
      const lit = tm[2];
      if (!/\/api\//.test(lit)) continue;
      // Keep only the path: drop query strings (interpolated `?...${}`), and
      // any stray leading token from `${base}/api/...` interpolation.
      let cleaned = lit.split("?")[0].replace(/\$\{[^}]*\}/g, ":param");
      cleaned = cleaned.replace(/^:param/, "");
      if (cleaned.startsWith("/api/")) frontendCalls.add(cleaned);
    }
  }
}
walk(FRONTEND_SRC);

const frontendNormalized = new Set([...frontendCalls].map(normalize));

// ── exclusions ─────────────────────────────────────────────────────────────
function isExcluded(p) {
  return /\/health$|\/api\/health|webhook|callback/i.test(p);
}
function isAdmin(p) {
  return /^\/api\/admin/i.test(p);
}

// ── classification ──────────────────────────────────────────────────────────
const connected = [];
const backendOnly = [];
const adminOnly = [];
const excluded = [];

// Strip params + query to a comparable prefix (e.g. /api/x/:param/y -> /api/x/y).
function pathPrefix(p) {
  return p.replace(/\?.*$/, "").replace(/\/:param/g, "").replace(/\/:[a-zA-Z0-9_]+/g, "");
}

const backendPrefixes = backendRoutes.map((r) => ({ route: r, prefix: pathPrefix(normalize(r.path)) }));

for (const r of backendRoutes) {
  if (isExcluded(r.path)) { excluded.push(r); continue; }
  if (isAdmin(r.path)) { adminOnly.push(r); continue; }
  const norm = normalize(r.path);
  if (frontendNormalized.has(norm)) connected.push(r);
  else backendOnly.push(r);
}

// frontend calls with no matching backend route (prefix-based; dynamic params
// count as matched). Reported for visibility only — intentionally backend-only
// or future-facing routes are NOT treated as CI failures per the plan.
const frontendNoBackend = [...frontendCalls].filter((c) => {
  const cPrefix = pathPrefix(normalize(c));
  return !backendPrefixes.some((b) => {
    const bPrefix = pathPrefix(normalize(b.route.path));
    return bPrefix === cPrefix || cPrefix.startsWith(bPrefix + "/") || bPrefix.startsWith(cPrefix + "/");
  });
});

// ── Phase 7: aggregate analytics routes ─────────────────────────────────────
const ANALYTICS = ["/api/analytics/options", "/api/analytics/crypto", "/api/analytics/macro", "/api/analytics/equities"];
const analyticsReport = ANALYTICS.map((p) => {
  const hasBackend = backendRoutes.some((r) => r.path === p);
  const hasFrontend = frontendCalls.has(p);
  return {
    route: p,
    backend: hasBackend,
    frontendConsumer: hasFrontend,
    status: hasFrontend ? "active" : "backend-only / future-facing (no main-frontend consumer)",
  };
});

// ── output ──────────────────────────────────────────────────────────────────
const out = {
  summary: {
    backendRoutes: backendRoutes.length,
    frontendCalls: frontendCalls.size,
    connected: connected.length,
    backendOnly: backendOnly.length,
    adminOnly: adminOnly.length,
    excluded: excluded.length,
    frontendNoBackend: frontendNoBackend.length,
  },
  connected: connected.map((r) => `${r.method} ${r.path}`),
  backendOnly: backendOnly.map((r) => `${r.method} ${r.path}`),
  adminOnly: adminOnly.map((r) => `${r.method} ${r.path}`),
  frontendNoBackend,
  phase7AnalyticsRoutes: analyticsReport,
};

console.log(JSON.stringify(out, null, 2));

// The inventory is a read-only diagnostic. Per the plan, intentionally
// backend-only or future-facing routes must NOT fail CI until classified for
// removal. frontendNoBackend is reported for visibility only; the script exits
// 0. (Use the JSON `frontendNoBackend` array for manual review.)
process.exit(0);
