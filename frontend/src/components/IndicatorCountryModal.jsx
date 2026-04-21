import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const MACRO_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_MACRO_INDICATOR_KEYS = [
  "gdp_growth_rate",
  "interest_rate",
  "inflation_rate",
  "unemployment_rate",
  "consumer_confidence",
  "balance_of_trade",
  "cpi",
  "core_inflation_rate"
];

const sanitizeMacroSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const allowed = new Set(ALLOWED_MACRO_INDICATOR_KEYS);
  const metrics = Array.isArray(snapshot.metrics)
    ? snapshot.metrics.filter((row) => allowed.has(String(row?.key || "")))
    : [];
  return { ...snapshot, metrics };
};

export function IndicatorCountryModal({ asset, onClose, isInWatchlist, onToggleStar }) {
  const countryCode = String(asset?.symbol || "").trim().toUpperCase();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedMetric, setSelectedMetric] = useState(null);

  useEffect(() => {
    if (!countryCode) return undefined;

    let isMounted = true;
    const controller = new AbortController();
    const cached = readResilientCache("macro-indicators", { country: countryCode });
    const cachedPayload = sanitizeMacroSnapshot(cached?.payload || null);
    const cachedAt = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;

    if (cachedPayload) {
      setSnapshot(cachedPayload);
      setStale(Boolean(cachedPayload?.stale || cachedPayload?.unavailable));
      setNotice(Boolean(cachedPayload?.stale || cachedPayload?.unavailable) ? getSnapshotFallbackMessage(cachedPayload) : "");
      if (Date.now() - cachedAt < MACRO_CLIENT_CACHE_TTL_MS) {
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/macro-indicators?country=${encodeURIComponent(countryCode)}`, {
          signal: controller.signal
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (!isMounted) return;
        const sanitized = sanitizeMacroSnapshot(data || null);
        setSnapshot(sanitized);
        setStale(Boolean(sanitized?.stale || sanitized?.unavailable));
        setNotice(Boolean(sanitized?.stale || sanitized?.unavailable) ? getSnapshotFallbackMessage(sanitized) : "");
        writeResilientCache("macro-indicators", { country: countryCode }, sanitized);
      } catch (error) {
        if (error.name === "AbortError" || !isMounted) return;
        if (!cachedPayload) setSnapshot(null);
        setStale(true);
        setNotice(cachedPayload ? getSnapshotFallbackMessage(cachedPayload) : "");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSnapshot();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [countryCode]);

  const displayName = useMemo(
    () => snapshot?.countryName || String(asset?.countryName || asset?.name || "").replace(/\s+Macro Indicators$/i, "").trim() || countryCode,
    [asset, countryCode, snapshot]
  );

  const inWatchlist = isInWatchlist?.(asset);
  const metrics = Array.isArray(snapshot?.metrics) ? snapshot.metrics : [];

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content indicator-country-modal" onClick={(event) => event.stopPropagation()}>
          <header className="modal-header">
            <div className="asset-info">
              <h2>{displayName}</h2>
              <p>{countryCode} macro indicators</p>
            </div>
            <div className="modal-header-actions">
              <button
                className={`modal-action-btn ${inWatchlist ? "active" : ""}`}
                onClick={() =>
                  onToggleStar?.({
                    ...asset,
                    symbol: countryCode,
                    name: displayName,
                    countryName: displayName,
                    type: "indicator",
                    category: "indicators",
                    marketType: "macro",
                    market: "Macro"
                  })
                }
                title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
              >
                {inWatchlist ? "Remove" : "Add"}
              </button>
              <button className="close-btn" onClick={onClose}>&times;</button>
            </div>
          </header>

          <div className="chart-section indicator-country-content">
            <div className="indicator-country-meta">
              <span className={`data-health-badge ${loading ? "loading" : stale ? "hazard" : "ok"}`}>
                <span className={`status-icon ${loading ? "spinner" : ""}`}>{loading ? "⟳" : stale ? "⚠" : "✓"}</span>
                Indicators
              </span>
            </div>
            {stale && notice ? (
              <div className="snapshot-inline-note" style={{ marginBottom: "10px" }}>{notice}</div>
            ) : null}

            {loading && metrics.length === 0 ? (
              <div className="chart-loading">Loading macro indicators...</div>
            ) : metrics.length === 0 ? (
              <div className="chart-no-data" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span>Waiting for macro indicators...</span>
                {snapshot?.diagnostics?.reason === "missing_eodhd_token" && (
                  <small style={{ color: "#f87171" }}>Error: EODHD_API_TOKEN is missing in backend configuration.</small>
                )}
                {snapshot?.stale_reason && !snapshot?.stale_reason.includes("fetch_failed") && (
                  <small style={{ color: "#64748b" }}>Status: {snapshot.stale_reason}</small>
                )}
              </div>
            ) : (
              <IndicatorMetricsTable snapshot={snapshot} onSelectMetric={setSelectedMetric} />
            )}
          </div>
        </div>
      </div>

      {selectedMetric ? (
        <IndicatorMetricModal
          countryName={displayName}
          metric={selectedMetric}
          onClose={() => setSelectedMetric(null)}
        />
      ) : null}
    </>
  );
}
