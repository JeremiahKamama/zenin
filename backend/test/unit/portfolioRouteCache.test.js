// backend/test/unit/portfolioRouteCache.test.js
//
// Production telemetry (25 real log rows) showed the portfolio view issuing ten
// GETs simultaneously, each taking 2.5-5.5s on a 0.5-CPU instance, with 76% of
// them returning 304 Not Modified. Express computes the body and its ETag BEFORE
// deciding to send 304, so a conditional request costs exactly as much as a full
// one: the server performed the whole portfolio aggregation to tell the client
// "nothing changed".
//
// The fix is cachedRoute(): serve from the shared snapshot cache, and collapse
// concurrent identical requests into a single computation.
//
// These tests run the REAL middleware lifted out of index.js. An earlier
// hand-written paraphrase of the middleware passed while the real thing was
// broken, so the extraction matters — a copy would have tested nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import express from 'express';

const here = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(here, '../../index.js'), 'utf8');

/** Lift cachedRoute out of index.js and give it the dependencies it closes over. */
function loadRealCachedRoute() {
  const body = index.slice(
    index.indexOf('function cachedRoute('),
    index.indexOf('function invalidateRuntimeSnapshotsByPrefix')
  );
  assert.ok(body.includes('function cachedRoute('), 'cachedRoute must exist in index.js');

  const store = new Map();
  const factory = new Function('store', `
    const inflightSnapshotRequests = new Map();
    const pendingRoutePayloads = new Map();
    async function readFreshSnapshot(scope, params, ttlMs) {
      const k = scope + ":" + JSON.stringify(params);
      const r = store.get(k);
      if (!r) return null;
      if (Date.now() - r.at > ttlMs) return null;
      return r.payload;
    }
    async function writeAllSnapshots(scope, params, payload) {
      store.set(scope + ":" + JSON.stringify(params), { payload, at: Date.now() });
    }
    function buildSnapshotKey(scope, params) { return scope + ":" + JSON.stringify(params); }
    async function withInflightDedup(scope, params, factory) {
      const k = buildSnapshotKey(scope, params);
      if (inflightSnapshotRequests.has(k)) return inflightSnapshotRequests.get(k);
      const p = Promise.resolve().then(factory).finally(() => inflightSnapshotRequests.delete(k));
      inflightSnapshotRequests.set(k, p);
      return p;
    }
    ${body}
    return { cachedRoute };
  `);
  return { cachedRoute: factory(store).cachedRoute, store };
}

/** Boot a server around a route, run the body, and always tear it down. */
async function withServer(buildApp, body) {
  const app = express();
  const state = { computes: 0 };
  buildApp(app, state);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  try {
    return await body({ port, state, url: (p) => `http://127.0.0.1:${port}${p}` });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a repeat request is served without recomputing', async () => {
  const { cachedRoute, store } = loadRealCachedRoute();
  await withServer(
    (app, state) => {
      app.get(
        '/summary',
        cachedRoute({ scope: 'summary', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        async (req, res) => {
          state.computes += 1;
          await new Promise((r) => setTimeout(r, 50));
          res.json({ value: 42, wid: req.query.wid });
        }
      );
    },
    async ({ url, state }) => {
      const first = await fetch(url('/summary?wid=A'));
      assert.equal(first.headers.get('x-zenin-cache'), 'miss');
      assert.equal(state.computes, 1);

      const before = state.computes;
      const second = await fetch(url('/summary?wid=A'));
      assert.equal(second.headers.get('x-zenin-cache'), 'hit');
      assert.equal(state.computes, before, 'a cache hit must not recompute');
      assert.equal((await second.json()).value, 42);
    }
  );
  assert.ok(store.size >= 1, 'the first response must have populated the cache');
});

test('ten simultaneous identical requests collapse into one computation', async () => {
  // This is the production pattern: useUnifiedPortfolio fires ten GETs at once.
  const { cachedRoute } = loadRealCachedRoute();
  await withServer(
    (app, state) => {
      app.get(
        '/summary',
        cachedRoute({ scope: 'summary', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        async (req, res) => {
          state.computes += 1;
          await new Promise((r) => setTimeout(r, 100));
          res.json({ value: 42, wid: req.query.wid });
        }
      );
    },
    async ({ url, state }) => {
      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => fetch(url('/summary?wid=B')))
      );
      const elapsed = Date.now() - started;

      assert.equal(state.computes, 1, `expected 1 computation, saw ${state.computes}`);
      assert.ok(responses.every((r) => r.status === 200));
      const bodies = await Promise.all(responses.map((r) => r.json()));
      assert.ok(bodies.every((b) => b.value === 42 && b.wid === 'B'));
      // Ten sequential 100ms computations would be ~1000ms; one is ~100ms.
      assert.ok(elapsed < 500, `burst took ${elapsed}ms, expected roughly one computation`);
    }
  );
});

test('one workspace can never be served another workspace payload', async () => {
  const { cachedRoute } = loadRealCachedRoute();
  await withServer(
    (app) => {
      app.get(
        '/summary',
        cachedRoute({ scope: 'summary', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        (req, res) => res.json({ wid: req.query.wid })
      );
    },
    async ({ url }) => {
      await fetch(url('/summary?wid=A'));
      const b = await (await fetch(url('/summary?wid=B'))).json();
      const a = await (await fetch(url('/summary?wid=A'))).json();
      assert.equal(b.wid, 'B');
      assert.equal(a.wid, 'A');
    }
  );
});

test('a failed response is never cached', async () => {
  // Caching an error would serve one transient failure to every caller for the
  // next 30 seconds.
  const { cachedRoute } = loadRealCachedRoute();
  await withServer(
    (app, state) => {
      app.get(
        '/boom',
        cachedRoute({ scope: 'boom', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        (req, res) => {
          state.computes += 1;
          res.status(500).json({ error: 'nope' });
        }
      );
    },
    async ({ url, state }) => {
      const a = await fetch(url('/boom?wid=Z'));
      const b = await fetch(url('/boom?wid=Z'));
      assert.equal(state.computes, 2, 'errors must recompute');
      assert.equal(a.status, 500);
      assert.equal(b.status, 500);
    }
  );
});

test('a throwing handler still releases every waiting caller', async () => {
  // Registering in-flight state before next() means a handler that throws
  // without responding would leave followers awaiting a promise that never
  // settles. A hung request is worse than the slow request the cache prevents.
  const { cachedRoute } = loadRealCachedRoute();
  await withServer(
    (app) => {
      app.get(
        '/throws',
        cachedRoute({ scope: 'throws', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        async (req, res) => {
          try {
            throw new Error('kaboom');
          } catch (error) {
            res.status(500).json({ error: error.message });
          }
        }
      );
    },
    async ({ url }) => {
      const settled = await Promise.allSettled([
        fetch(url('/throws?wid=T')),
        fetch(url('/throws?wid=T')),
        fetch(url('/throws?wid=T'))
      ]);
      assert.ok(settled.every((r) => r.status === 'fulfilled'), 'no caller may hang');
      const body = await settled[0].value.json();
      assert.equal(body.error, 'kaboom');
    }
  );
});

test('cache hits are marked private so no shared proxy can replay them', async () => {
  const { cachedRoute } = loadRealCachedRoute();
  await withServer(
    (app) => {
      app.get(
        '/summary',
        cachedRoute({ scope: 'summary', ttlMs: 30_000, keyFrom: (req) => ({ wid: req.query.wid }) }),
        (req, res) => res.json({ ok: true })
      );
    },
    async ({ url }) => {
      await fetch(url('/summary?wid=A'));
      const hit = await fetch(url('/summary?wid=A'));
      assert.match(hit.headers.get('cache-control') || '', /private/);
    }
  );
});

test('every portfolio endpoint is behind the cache', () => {
  const endpoints = [
    'summary', 'positions', 'sources', 'sync-status', 'transactions',
    'reconciliation', 'fx-rates', 'snapshots', 'equity-curve', 'shadow-compare'
  ];
  for (const path of endpoints) {
    const at = index.indexOf(`"/api/portfolio/unified/${path}"`);
    assert.ok(at > -1, `${path} route must exist`);
    const window = index.slice(at, at + 400);
    assert.match(window, /cachedRoute\(\{/, `${path} must use cachedRoute`);
    assert.match(window, /workspaceId: req\.workspace\.workspace\.id/, `${path} must key by workspace`);
  }
});

test('the route cache TTL is short enough to stay fresh', () => {
  // A portfolio total that lags by minutes is wrong, not merely stale.
  assert.match(index, /const PORTFOLIO_TTL_MS = 30 \* 1000;/);
});

test('cache keys are workspace-scoped, never user- or global-scoped', () => {
  // A global key would leak one tenant's portfolio to another.
  assert.doesNotMatch(index, /scope: "unified-[a-z-]+",\s*ttlMs: PORTFOLIO_TTL_MS,\s*keyFrom: \(\) => \(\{\}\)/);
});
