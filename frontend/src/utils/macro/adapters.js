// macro/adapters.js — provider-agnostic macro data access.
//
// Single seam between the UI and data providers. Every macro module (Liquidity,
// Rates, Growth, Inflation, FX, Central Bank, Trade, Credit, Sovereign, Capital
// Flows, Economic Surprise) calls the adapter — NEVER a provider-specific endpoint
// or series ID. Adding IMF/ECB/OECD/BIS/CFTC later means writing one new adapter
// and registering it; the UI does not change.
//
// Transport is abstracted into REST + SDMX variants behind one interface:
//   adapter.fetchSeries({ series, geo, range }) -> { points, meta }
//
// The frontend talks to the Zenin backend (/macro/*), which proxies FRED / Yahoo /
// World Bank. The adapter maps a logical series code -> the backend's real
// indicator code (via seriesResolver) and normalizes the {date,value} response.
// No raw provider URLs or SDMX/XML parsing live in component code.

import { zeninFetchJson } from "../zeninFetch.js";
import { resolveIndicatorCode } from "./seriesResolver.js";
import { fetchJsonViaCandidates } from "./fetchMacro.js";

// SeriesPoint = { t: string (ISO date), v: number|null }

// ── REST adapter (backend /macro/timeseries, proxies FRED / Yahoo / World Bank) ──
// Uses the REAL contract: /macro/timeseries?geo=&indicator=&range=&mode= -> { series: [{date, value}] }
function createRestAdapter({ id, supports = () => true }) {
  return {
    id,
    kind: "rest",
    supports,
    async fetchSeries({ series, geo, range = "1Y", mode = "levels", baseUrl = "" }) {
      const indicator = resolveIndicatorCode(series);
      // Unmapped logical code -> no backend series. Honest empty (never fabricated).
      if (!indicator) return { points: [], meta: { source: id, unavailable: true, reason: "unmapped" } };
      const qs = new URLSearchParams({
        geo: geo || "USA",
        indicator,
        range,
        mode,
      }).toString();
      const res = await fetchJsonViaCandidates(baseUrl, `/macro/timeseries?${qs}`);
      const raw = Array.isArray(res?.series) ? res.series : Array.isArray(res) ? res : [];
      const points = raw
        .map((p) => ({
          t: p.date || p.t || p.time,
          v: Number.isFinite(Number(p.value ?? p.v)) ? Number(p.value ?? p.v) : null,
        }))
        .filter((p) => p.t);
      return { points, meta: { source: res?.source || id, unit: res?.unit, indicator, stale: res?.stale || false } };
    },
  };
}

// ── SDMX adapter (IMF / ECB / OECD structured data messages) ───────────────────
// Placeholder shape for future structured-data providers. Backend returns already-
// normalized JSON; the adapter only shapes it. Not yet backed → honest empty.
function createSdmxAdapter({ id, dataset, supports = () => true }) {
  return {
    id,
    kind: "sdmx",
    dataset,
    supports,
    async fetchSeries({ series, geo, range = "1Y", baseUrl = "" }) {
      const indicator = resolveIndicatorCode(series);
      if (!indicator) return { points: [], meta: { source: id, unavailable: true, reason: "unmapped" } };
      // Route SDMX providers through the same backend timeseries surface for now;
      // a dedicated /macro/<provider>/timeseries can be swapped in without UI change.
      const qs = new URLSearchParams({ geo: geo || "USA", indicator, range }).toString();
      const res = await fetchJsonViaCandidates(baseUrl, `/macro/timeseries?${qs}`);
      const raw = Array.isArray(res?.series) ? res.series : Array.isArray(res?.observations) ? res.observations : Array.isArray(res) ? res : [];
      const points = raw
        .map((o) => ({
          t: o.date || o.obsDate || o.t,
          v: Number.isFinite(Number(o.value ?? o.obsValue ?? o.v)) ? Number(o.value ?? o.obsValue ?? o.v) : null,
        }))
        .filter((p) => p.t);
      return { points, meta: { source: res?.source || id, dataset, indicator, stale: res?.stale || false } };
    },
  };
}

// ── Adapter registry ─────────────────────────────────────────────────────────────
// Add a new provider here only. The UI resolves an adapter by provider id via
// getAdapter(providerId); unknown providers fall back to the default REST adapter.
const ADAPTERS = {
  FRED: createRestAdapter({ id: "FRED" }),
  YAHOO: createRestAdapter({ id: "YAHOO" }),
  WORLDBANK: createSdmxAdapter({ id: "WORLDBANK", dataset: "WDI" }),
  IMF: createSdmxAdapter({ id: "IMF", dataset: "IFS" }),
  ECB: createSdmxAdapter({ id: "ECB", dataset: "ECB" }),
  OECD: createSdmxAdapter({ id: "OECD", dataset: "OECD" }),
  BLS: createRestAdapter({ id: "BLS" }),
};

const DEFAULT_ADAPTER = createRestAdapter({ id: "DEFAULT" });

export function getAdapter(providerId) {
  return ADAPTERS[String(providerId || "").toUpperCase()] || DEFAULT_ADAPTER;
}

export function listAdapters() {
  return Object.keys(ADAPTERS);
}

// Convenience: fetch a single series through its provider adapter.
export async function fetchMacroSeries({ provider, series, geo, range, mode, baseUrl }) {
  const adapter = getAdapter(provider);
  return adapter.fetchSeries({ series, geo, range, mode, baseUrl });
}

// Convenience: fetch many series concurrently. Returns a map keyed by series code.
// Consumers render honest "Unavailable" for any series whose points are empty.
export async function fetchMacroSeriesBatch(requests) {
  const out = {};
  await Promise.all(
    requests.map(async (req) => {
      try {
        out[req.series] = await fetchMacroSeries(req);
      } catch {
        out[req.series] = { points: [], meta: { source: req.provider, stale: true, error: true } };
      }
    })
  );
  return out;
}
