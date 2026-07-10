import { useEffect, useState } from "react";

function formatIv(iv) {
  const n = Number(iv);
  return Number.isFinite(n) && n > 0 ? `${n.toFixed(1)}%` : "—";
}

function formatMoneyValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function OptionsTab({ assetSymbol, isStockResearchEligible }) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });

  useEffect(() => {
    if (!isStockResearchEligible || !assetSymbol) {
      setState({ status: "idle", data: null, error: "" });
      return undefined;
    }
    let ignore = false;
    const controller = new AbortController();
    setState({ status: "loading", data: null, error: "" });
    (async () => {
      try {
        const params = new URLSearchParams({ underlying: String(assetSymbol || "").trim().toUpperCase() });
        const res = await fetch(`/api/options/equity?${params.toString()}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (ignore) return;
        if (data?.unavailable) {
          setState({ status: "unavailable", data, error: data?.statusMessage || "Options chain unavailable." });
          return;
        }
        setState({ status: "ready", data, error: "" });
      } catch (error) {
        if (ignore || error?.name === "AbortError") return;
        setState({ status: "error", data: null, error: "Unable to load options chain." });
      }
    })();
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [assetSymbol, isStockResearchEligible]);

  if (!isStockResearchEligible) {
    return (
      <div className="am-tab-content">
        <div className="am-empty-state">
          <p className="am-empty-title">Options data available for equities only.</p>
          <p className="am-empty-hint">{assetSymbol || "This asset"} is not an equity; options analytics (IV, Greeks, PCR, Max Pain, chain) are not applicable.</p>
        </div>
      </div>
    );
  }

  const { status, data, error } = state;

  if (status === "loading") {
    return (
      <div className="am-tab-content">
        <div className="am-empty-state">
          <p className="am-empty-title">Syncing options chain for {assetSymbol}…</p>
        </div>
      </div>
    );
  }

  if (status === "unavailable" || status === "error") {
    return (
      <div className="am-tab-content">
        <div className="am-empty-state">
          <p className="am-empty-title">No options chain synced for {assetSymbol || "this asset"}.</p>
          <p className="am-empty-hint">{error || "Implied volatility, Greeks, put/call ratio, max pain and the option chain will render here when an options feed is connected."}</p>
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const maxPainRow = Array.isArray(data?.strikeCrowding) && data.strikeCrowding.length
    ? (() => {
        const strikes = [...new Set(data.strikeCrowding.map((r) => Number(r.strike)).filter(Number.isFinite))].sort((a, b) => a - b);
        let bestStrike = null;
        let bestLoss = Infinity;
        for (const K of strikes) {
          let loss = 0;
          for (const r of data.strikeCrowding) {
            const s = Number(r.strike);
            const callOi = Number(r.callOi || 0);
            const putOi = Number(r.putOi || 0);
            if (callOi) loss += callOi * Math.max(K - s, 0);
            if (putOi) loss += putOi * Math.max(s - K, 0);
          }
          if (loss < bestLoss) { bestLoss = loss; bestStrike = K; }
        }
        return bestStrike;
      })()
    : null;

  const topContracts = Array.isArray(data?.topContracts) ? data.topContracts.slice(0, 8) : [];

  return (
    <div className="am-tab-content">
      <div className="am-options-summary">
        <div className="am-options-metric">
          <span className="am-options-metric-label">Spot</span>
          <span className="am-options-metric-value">{summary.spotPrice ? formatMoneyValue(summary.spotPrice) : "—"}</span>
        </div>
        <div className="am-options-metric">
          <span className="am-options-metric-label">ATM IV</span>
          <span className="am-options-metric-value">{formatIv(summary.atmIv)}</span>
        </div>
        <div className="am-options-metric">
          <span className="am-options-metric-label">Put/Call OI</span>
          <span className="am-options-metric-value">{summary.putCallOiRatio != null ? summary.putCallOiRatio.toFixed(2) : "—"}</span>
        </div>
        <div className="am-options-metric">
          <span className="am-options-metric-label">Max Pain</span>
          <span className="am-options-metric-value">{maxPainRow != null ? formatMoneyValue(maxPainRow) : "—"}</span>
        </div>
        <div className="am-options-metric">
          <span className="am-options-metric-label">Implied Move</span>
          <span className="am-options-metric-value">{summary.impliedMovePct != null ? `${summary.impliedMovePct.toFixed(2)}%` : "—"}</span>
        </div>
        <div className="am-options-metric">
          <span className="am-options-metric-label">Contracts</span>
          <span className="am-options-metric-value">{summary.contracts ? String(summary.contracts) : "—"}</span>
        </div>
      </div>
      {data?.source ? (
        <p className="am-options-source">Source: {data.source} · Expiry {data.activeExpiry || "—"}</p>
      ) : null}
      {topContracts.length > 0 ? (
        <div className="table-scroll am-options-table-scroll">
          <table className="option-chain-table am-options-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Strike</th>
                <th>Type</th>
                <th>IV</th>
                <th>OI</th>
                <th>Volume</th>
                <th>Venue</th>
              </tr>
            </thead>
            <tbody>
              {topContracts.map((c) => (
                <tr key={c.contractTicker || `${c.strike}-${c.optionType}`}>
                  <td className="greek">{c.contractTicker}</td>
                  <td className="greek">{c.strike != null ? formatMoneyValue(c.strike) : "—"}</td>
                  <td className="greek">{String(c.optionType || "—").toUpperCase()}</td>
                  <td className="greek">{formatIv(c.impliedVolatility)}</td>
                  <td className="greek">{Number(c.openInterest) > 0 ? Number(c.openInterest).toLocaleString() : "—"}</td>
                  <td className="greek">{Number(c.volume) > 0 ? Number(c.volume).toLocaleString() : "—"}</td>
                  <td className="greek">{c.venue || "Composite"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
