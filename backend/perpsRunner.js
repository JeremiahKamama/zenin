// backend/perpsRunner.js
// Perps Latency Benchmark Runner
//
// Measures perps order submission latency across venues. Supports two modes:
//   - dry_run (default): measures HTTP round-trip to venue API endpoints.
//     No funded accounts needed. Gives a network-floor baseline.
//   - live: submits real post-only orders, measures end-to-end confirmation
//     via WebSocket account feed, then cleans up. Requires funded wallets.
//
// Safety guards:
//   - Global kill switch (PERPS_BENCH_ENABLED env var, defaults to false)
//   - Per-venue enable/disable in DB (perps_runner_state table)
//   - Per-venue daily order budget cap (default 100 samples/day)
//   - Strict cleanup: cancel any open order after each sample
//   - All errors logged to perps_runner_state.last_error

const { perpsBench } = require("./database");

const VENUE_ENDPOINTS = {
  hyperliquid: {
    name: "Hyperliquid",
    probeUrl: "https://api.hyperliquid.xyz/info",
    probeMethod: "POST",
    probeBody: JSON.stringify({ type: "meta" }),
    orderTransport: "websocket"
  },
  lighter: {
    name: "Lighter",
    probeUrl: "https://mainnet.zklighter.elliot.ai/api/v1/funding-rates",
    probeMethod: "GET",
    orderTransport: "websocket"
  },
  binance: {
    name: "Binance",
    probeUrl: "https://fapi.binance.com/fapi/v1/ping",
    probeMethod: "GET",
    orderTransport: "https"
  },
  bybit: {
    name: "Bybit",
    probeUrl: "https://api.bybit.com/v5/market/time",
    probeMethod: "GET",
    orderTransport: "https"
  },
  dydx_v4: {
    name: "dYdX v4",
    probeUrl: "https://api.dydx.exchange/v3/time",
    probeMethod: "GET",
    orderTransport: "https"
  },
  aster: {
    name: "Aster",
    probeUrl: "https://fapi.asterdex.com/fapi/v1/ping",
    probeMethod: "GET",
    orderTransport: "https"
  },
  extended: {
    name: "Extended",
    probeUrl: null,
    orderTransport: "https"
  },
  pacifica: {
    name: "Pacifica",
    probeUrl: null,
    orderTransport: "websocket"
  }
};

const DEFAULT_RATE_MS = 60000; // 1 sample per venue per minute
const DEFAULT_SCENARIO = "post_only";
const DEFAULT_DAILY_BUDGET = 100;

function getEnvBool(name, defaultValue = false) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value);
}

async function probeVenueHttp(venueId, fetchImpl) {
  const config = VENUE_ENDPOINTS[venueId];
  if (!config || !config.probeUrl) {
    return { error: `No probe endpoint configured for ${venueId}` };
  }
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort("probe-timeout"), 10000);
    const response = await fetchImpl(config.probeUrl, {
      method: config.probeMethod || "GET",
      headers: config.probeMethod === "POST" ? { "Content-Type": "application/json" } : {},
      body: config.probeBody || undefined,
      signal: controller.signal
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    if (!response.ok) {
      return { error: `${config.probeUrl} responded ${response.status}`, confirmMs: elapsed };
    }
    return { confirmMs: elapsed, networkFloorMs: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { error: err?.message || String(err), confirmMs: elapsed };
  }
}

async function ensureRunnerStates() {
  for (const venueId of Object.keys(VENUE_ENDPOINTS)) {
    const existing = await perpsBench.getRunnerState(venueId);
    if (!existing) {
      await perpsBench.upsertRunnerState(venueId, {
        isEnabled: false,
        isRunning: false,
        ordersToday: 0,
        dailyOrderBudget: DEFAULT_DAILY_BUDGET
      });
    }
  }
}

async function getEnabledVenues() {
  const states = await perpsBench.getRunnerState();
  return states.filter((s) => s.is_enabled && s.orders_today < s.daily_order_budget);
}

async function runSingleSample(venueId, runId, mode, fetchImpl) {
  await perpsBench.upsertRunnerState(venueId, { isRunning: true });
  try {
    let result;
    if (mode === "live") {
      // Live order submission — requires venue-specific adapters
      // TODO: implement per-venue order submission + WS confirmation
      result = { error: "Live mode not yet implemented for this venue. Use dry_run mode." };
    } else {
      // Dry-run: HTTP probe to venue endpoint
      result = await probeVenueHttp(venueId, fetchImpl);
    }

    await perpsBench.insertSample({
      venueId,
      scenario: DEFAULT_SCENARIO,
      runId,
      confirmMs: result.confirmMs,
      cancelMs: result.cancelMs,
      networkFloorMs: result.networkFloorMs,
      error: result.error,
      mode
    });

    if (!result.error) {
      await perpsBench.incrementOrderCount(venueId);
    } else {
      await perpsBench.upsertRunnerState(venueId, { lastError: result.error });
    }
  } finally {
    await perpsBench.upsertRunnerState(venueId, { isRunning: false });
  }
}

async function runContinuousLoop({ rateMs = DEFAULT_RATE_MS, mode = "dry_run", fetchImpl = null } = {}) {
  const fetch = fetchImpl || (await import("node-fetch")).default || globalThis.fetch;
  if (!fetch) throw new Error("No fetch implementation available");

  const enabled = getEnvBool("PERPS_BENCH_ENABLED", false);
  if (!enabled) {
    console.log("[PerpsBench] PERPS_BENCH_ENABLED is not true — runner will not start.");
    return;
  }

  const runId = `zenin-probe-${Date.now()}`;
  console.log(`[PerpsBench] Starting runner: runId=${runId}, mode=${mode}, rate=${rateMs}ms`);

  await ensureRunnerStates();

  let running = true;
  const shutdown = () => { running = false; };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (running) {
    try {
      const venues = await getEnabledVenues();
      if (venues.length === 0) {
        // No venues enabled — wait and retry
        await new Promise((r) => setTimeout(r, Math.max(rateMs, 5000)));
        continue;
      }

      // Run samples in parallel for all enabled venues
      await Promise.allSettled(
        venues.map((venue) => runSingleSample(venue.venue_id, runId, mode, fetch))
      );

      // Wait for the next cycle
      await new Promise((r) => setTimeout(r, rateMs));
    } catch (err) {
      console.error("[PerpsBench] Loop error:", err?.message || err);
      await new Promise((r) => setTimeout(r, Math.max(rateMs, 10000)));
    }
  }

  console.log("[PerpsBench] Runner stopped.");
}

module.exports = {
  VENUE_ENDPOINTS,
  runContinuousLoop,
  runSingleSample,
  ensureRunnerStates,
  probeVenueHttp
};
