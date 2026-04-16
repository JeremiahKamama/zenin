import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const MACRO_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;

export function IndicatorCountryModal({ asset, onClose, isInWatchlist, onToggleStar }) {
  const countryCode = String(asset?.symbol || "").trim().toUpperCase();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState(null);

  useEffect(() => {
    if (!countryCode) return undefined;

    let isMounted = true;
    const controller = new AbortController();
    const cached = readResilientCache("macro-indicators", { country: countryCode });
    const cachedPayload = cached?.payload || null;
    const cachedAt = cached?.updatedAt ? new Date(cached.updatedAt).getTime() : 0;

    if (cachedPayload) {
      setSnapshot(cachedPayload);
      setStale(Boolean(cachedPayload?.stale || cachedPayload?.unavailable));
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
        setSnapshot(data || null);
        setStale(Boolean(data?.stale || data?.unavailable));
        writeResilientCache("macro-indicators", { country: countryCode }, data || null);
      } catch (error) {
        if (error.name === "AbortError" || !isMounted) return;
        if (!cachedPayload) setSnapshot(null);
        setStale(true);
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
    () => snapshot?.countryName || String(asset?.name || "").replace(/\s+Macro Indicators$/i, "") || countryCode,
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
              <h2>{countryCode}</h2>
              <p>{displayName} Macro Indicators</p>
            </div>
            <div className="modal-header-actions">
              <button
                className={`modal-action-btn ${inWatchlist ? "active" : ""}`}
                onClick={() =>
                  onToggleStar?.({
                    ...asset,
                    symbol: countryCode,
                    name: `${displayName} Macro Indicators`,
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

            {loading && metrics.length === 0 ? (
              <div className="chart-loading">Loading macro indicators...</div>
            ) : metrics.length === 0 ? (
              <div className="chart-no-data">Waiting for macro indicators...</div>
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
