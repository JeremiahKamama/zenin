"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeClient, readConfig } = require("../../providers/mystocks/client");

// In-memory fake HTTP transport matching the axios.request({method,url,params,...}) shape.
function makeFakeHttp() {
  const calls = [];
  let impl = async () => ({ data: { stocks: [] }, headers: {}, status: 200 });
  return {
    calls,
    setImpl(fn) { impl = fn; },
    async request(opts) {
      calls.push(opts);
      return impl(opts);
    },
  };
}

test("readConfig resolves sandbox base + key from env", () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "sk_sandbox_test123";
  process.env.MYSTOCKS_AFRICA_LIVE_KEY = "";
  process.env.MYSTOCKS_AFRICA_BASE_URL = "";
  const cfg = readConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.key, "sk_sandbox_test123");
  assert.equal(cfg.baseUrl, "https://mystocks.africa/api/sandbox/v1/partner");
});

test("auth header uses Authorization: Bearer (standardized)", async () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "sk_sandbox_test123";
  const http = makeFakeHttp();
  http.setImpl(async () => ({ data: { stocks: [] }, headers: {}, status: 200 }));
  const client = makeClient({ config: readConfig(), http });
  await client.listStocks({ search: "safaricom" });
  const captured = http.calls[0];
  assert.equal(captured.headers.Authorization, "Bearer sk_sandbox_test123");
  assert.equal(captured.headers["x-api-key"], undefined);
});

test("getQuotes chunks to 50 symbols per request", async () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "sk_sandbox_test123";
  const http = makeFakeHttp();
  http.setImpl(async (opts) => {
    const syms = String(opts.params.symbols).split(",");
    return { data: { quotes: syms.map((s) => ({ symbol: s, price: 10, changePercent: 1 })) }, headers: {}, status: 200 };
  });
  const client = makeClient({ config: readConfig(), http });
  const symbols = Array.from({ length: 120 }, (_, i) => `SYM${i}.KE`);
  const out = await client.getQuotes(symbols);
  assert.equal(out.length, 120);
  // 120 symbols -> 3 batches (50+50+20)
  assert.equal(http.calls.length, 3);
  http.calls.forEach((c) => assert.ok(c.params.symbols.split(",").length <= 50));
});

test("429 is retried with backoff (Retry-After honored)", async () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "sk_sandbox_test123";
  const http = makeFakeHttp();
  let attempt = 0;
  http.setImpl(async () => {
    attempt += 1;
    if (attempt === 1) {
      const err = new Error("rate limited");
      err.response = { status: 429, headers: { "retry-after": "0" }, data: { error: { code: "RATE_LIMITED" } } };
      throw err;
    }
    return { data: { stocks: [] }, headers: {}, status: 200 };
  });
  const client = makeClient({ config: readConfig(), http });
  const res = await client.listStocks({ search: "x" });
  assert.equal(attempt, 2);
  assert.deepEqual(res, { stocks: [] });
});

test("no upstream key leaks in client responses (sanitizeOutbound)", async () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "sk_sandbox_test123";
  const http = makeFakeHttp();
  http.setImpl(async () => ({
    data: { stocks: [{ symbol: "SCOM.KE", apiKey: "sk_live_secret", secret: "x" }] },
    headers: { "x-request-id": "req-1" },
    status: 200,
  }));
  const client = makeClient({ config: readConfig(), http });
  const raw = await client.listStocks({ search: "safaricom" });
  assert.equal(raw.apiKey, undefined);
  assert.equal(raw.secret, undefined);
  assert.equal(raw.stocks[0].apiKey, undefined);
});

test("healthCheck reports unconfigured when no key", async () => {
  process.env.MYSTOCKS_AFRICA_ENABLED = "true";
  process.env.MYSTOCKS_AFRICA_ENV = "sandbox";
  process.env.MYSTOCKS_AFRICA_SANDBOX_KEY = "";
  process.env.MYSTOCKS_AFRICA_LIVE_KEY = "";
  const cfg = readConfig();
  assert.equal(cfg.key, "");
  const client = makeClient({ config: cfg, http: makeFakeHttp() });
  const hc = await client.healthCheck();
  assert.equal(hc.configured, false);
  assert.equal(hc.state, "unconfigured");
});
