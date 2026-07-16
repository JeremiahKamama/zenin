// FeedHealth — Intelligence Feed Health diagnostics (spec §12).
//
// Collapsed-by-default diagnostics panel. Reports the REAL status of the
// internal resilient caches the Market Context page actually consumes, mapped
// to the external sources named in the spec where a genuine correspondence
// exists. Sources with no internal feed are marked "Not connected" — latency
// and coverage are never fabricated (shown as "—").
//
// Honest: status is derived from whether the cache has data and how stale it
// is (cacheTime). No fake ping/latency numbers.

import React, { useMemo, useState } from "react";
import { readResilientCache } from "../../utils/resilientData";

// External source → internal cache key (real correspondence only).
const SOURCES = [
  { name: "TradingEconomics", cache: "market-context" },
  { name: "FRED", cache: "macro-indicators" },
  { name: "ECB", cache: "macro-indicators" },
  { name: "Earnings (backend)", cache: "earnings-calendar" },
  { name: "Asset Reference", cache: "asset-reference" },
  { name: "Asset History", cache: "asset-history" },
  { name: "Company Profile", cache: "company-profile" },
  { name: "Options Chain", cache: "options-chain" },
  { name: "Prediction Markets", cache: "prediction-snapshot" },
  { name: "World Bank", cache: null },
  { name: "NOAA", cache: null },
  { name: "Polygon", cache: null },
  { name: "Finnhub", cache: null },
  { name: "Alpha Vantage", cache: null },
  { name: "OECD", cache: null },
  { name: "Yahoo", cache: null },
];

function statusFor(cacheKey) {
  if (!cacheKey) return { state: "offline", label: "Not connected", updated: null, fallback: "—" };
  let data = null;
  try { data = readResilientCache(cacheKey, null); } catch { data = null; }
  if (!data) return { state: "offline", label: "Offline", updated: null, fallback: "Backend" };
  const t = data?.cacheTime ? new Date(data.cacheTime).getTime() : null;
  const ageH = t ? (Date.now() - t) / 3600000 : null;
  const updated = t ? `${ageH < 1 ? Math.round(ageH * 60) + "m" : ageH < 24 ? Math.round(ageH) + "h" : Math.round(ageH / 24) + "d"} ago` : "—";
  const state = ageH != null && ageH > 24 ? "cached" : "live";
  return { state, label: state === "live" ? "Live" : "Cached", updated, fallback: "Historical cache" };
}

export default function FeedHealth() {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => SOURCES.map((s) => ({ ...s, ...statusFor(s.cache) })), []);
  const liveCount = rows.filter((r) => r.state === "live").length;
  const cachedCount = rows.filter((r) => r.state === "cached").length;
  const offCount = rows.filter((r) => r.state === "offline").length;

  return (
    <div className="feed-health">
      <button type="button" className="feed-health-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="fh-caret">{open ? "▾" : "▸"}</span>
        <span className="fh-title">Feed Health</span>
        <span className="fh-summary">{liveCount} live · {cachedCount} cached · {offCount} offline</span>
      </button>
      {open ? (
        <div className="feed-health-body">
          <div className="fh-legend">
            <span><em className="fh-dot live" /> Live</span>
            <span><em className="fh-dot cached" /> Cached</span>
            <span><em className="fh-dot offline" /> Offline</span>
            <span className="fh-latency-note">Latency — (no telemetry)</span>
          </div>
          <div className="fh-grid">
            {rows.map((r) => (
              <div key={r.name} className={`fh-row ${r.state}`}>
                <span className="fh-name">{r.name}</span>
                <span className="fh-state">{r.label}</span>
                <span className="fh-updated">{r.updated || "—"}</span>
                <span className="fh-fallback">{r.fallback}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
