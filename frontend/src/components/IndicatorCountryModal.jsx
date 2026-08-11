import { useEffect, useMemo, useState } from "react";
import { DataHealthBadge } from "@/components/ui/async-state";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { zeninFetch } from "../utils/zeninFetch";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const BACKEND_URL = ZENIN_API_BASE_URL;

const sanitizeMacroSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const allowed = new Set(getAppRuntimeConfig()?.analytics?.allowedMacroIndicatorKeys || []);
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

  // Related-indicator drill-down: the V2 modal emits this event (no close) so
  // we swap the open metric in place, reusing the same modal instance.
  useEffect(() => {
    const onSelect = (e) => {
      const code = String(e?.detail?.code || "").toUpperCase();
      if (!code) return;
      setSelectedMetric((current) => {
        if (current && String(current.code || "").toUpperCase() === code) return current;
        const next = Array.isArray(snapshot?.metrics)
          ? snapshot.metrics.find((m) => String(m.code || "").toUpperCase() === code)
          : null;
        return next || current;
      });
    };
    window.addEventListener("zenin:selectIndicator", onSelect);
    return () => window.removeEventListener("zenin:selectIndicator", onSelect);
  }, [snapshot]);

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
    }

    // Always fetch fresh so the modal reflects the latest data on every open
    // (the backend still governs server-side TTL). The previous early-return on
    // a client-side cache prevented re-opening from pulling new values.
    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const res = await zeninFetch(`/macro-indicators?country=${encodeURIComponent(countryCode)}`, {
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
                <DataHealthBadge status={loading ? "loading" : stale ? "stale" : "ok"} />
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
                  <small style={{ color: "var(--color-data-red-bright)" }}>Error: EODHD_API_TOKEN is missing in backend configuration.</small>
                )}
                {snapshot?.stale_reason && !snapshot?.stale_reason.includes("fetch_failed") && (
                  <small style={{ color: "var(--color-data-slate-dim)" }}>Status: {snapshot.stale_reason}</small>
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
