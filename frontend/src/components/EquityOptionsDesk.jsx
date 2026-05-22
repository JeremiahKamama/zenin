import { GuidedEmptyState } from "./CompactWorkspaceUI";

function formatMoney(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (Math.abs(numeric) >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toFixed(2)}K`;
  return `$${numeric.toFixed(digits)}`;
}

function formatNumber(value, digits = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function formatRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toFixed(2);
}

function formatIv(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatTimestamp(value) {
  if (!value) return "Awaiting update";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Awaiting update";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classForSigned(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric >= 0 ? "positive" : "negative";
}

export function EquityOptionsDesk({
  underlying,
  onUnderlyingChange,
  expiry,
  onExpiryChange,
  supportedUnderlyings = [],
  loading = false,
  error = "",
  notice = "",
  data = null,
  liveTape = [],
  liveConnected = false,
  liveUpdatedAt = "",
  onRefresh,
}) {
  const summary = data?.summary || {};
  const chainRows = Array.isArray(data?.chain) ? data.chain : [];
  const expiries = Array.isArray(data?.expiries) ? data.expiries : [];
  const topContracts = Array.isArray(data?.topContracts) ? data.topContracts : [];
  const unusualActivity = Array.isArray(data?.unusualActivity) ? data.unusualActivity : [];
  const venueSummary = Array.isArray(data?.venueSummary) ? data.venueSummary : [];
  const strikeCrowding = Array.isArray(data?.strikeCrowding) ? data.strikeCrowding : [];
  const termStructure = Array.isArray(data?.termStructure) ? data.termStructure : [];
  const providerUnavailable = Boolean(data?.unavailable);
  const showingStale = Boolean(data?.stale && !providerUnavailable);
  const statusLabel = loading ? "Syncing" : providerUnavailable ? "Offline" : showingStale ? "Stale" : liveConnected ? "Live" : "Snapshot";
  const statusClass = loading ? "loading" : providerUnavailable ? "unavailable" : showingStale ? "unavailable" : liveConnected ? "live" : "snapshot";
  const feedTimestamp = liveConnected && liveUpdatedAt ? liveUpdatedAt : data?.updatedAt;
  const statusNotice = error || notice || data?.statusMessage || "";
  const emptyTitle = providerUnavailable
    ? `${underlying} equity options feed is offline`
    : `${underlying} has no chain rows for ${data?.activeExpiry || expiry || "the selected expiry"}`;
  const emptyDescription = statusNotice || "Refresh the snapshot or switch to another underlying to continue.";
  const emptySteps = providerUnavailable
    ? [
        "Confirm the Massive backend key is configured and the provider is reachable.",
        "Retry the snapshot or choose another supported underlying while the feed recovers.",
      ]
    : [
        "Pick another expiry from the selector if one is available.",
        "Retry the Massive snapshot if the market just reopened or the feed is catching up.",
      ];

  return (
    <div className="options-equity-workbench">
      <section className="options-equity-topline">
        <div className="options-equity-hero">
          <div className="options-equity-hero-copy">
            <span className="options-exec-eyebrow">Listed equity options</span>
            <h2>Equity Options Flow Workbench</h2>
            <p>Massive-backed chain snapshots with direct quote, OI, and contract-pressure context.</p>
          </div>
          <div className="options-equity-controls">
            <label className="options-equity-select">
              <span>Underlying</span>
              <select value={underlying} onChange={(event) => onUnderlyingChange(event.target.value)}>
                {(supportedUnderlyings || []).map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {symbol}
                  </option>
                ))}
              </select>
            </label>
            <label className="options-equity-select">
              <span>Expiry</span>
              <select value={expiry || ""} onChange={(event) => onExpiryChange(event.target.value || null)} disabled={!expiries.length && providerUnavailable}>
                <option value="">Nearest</option>
                {expiries.map((row) => (
                  <option key={row} value={row}>
                    {row}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="options-equity-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh Snapshot"}
            </button>
          </div>
        </div>

        <div className="options-equity-summary-grid">
          <article className="options-equity-summary-card">
            <span>Underlying spot</span>
            <strong>{formatMoney(summary.spotPrice)}</strong>
            <em>{String(data?.underlying || underlying || "—").toUpperCase()}</em>
          </article>
          <article className="options-equity-summary-card">
            <span>ATM IV</span>
            <strong>{formatIv(summary.atmIv)}</strong>
            <em>Listed expiry surface</em>
          </article>
          <article className="options-equity-summary-card">
            <span>Put / Call OI</span>
            <strong>{formatRatio(summary.putCallOiRatio)}</strong>
            <em>{formatNumber(summary.totalPutOi)} puts vs {formatNumber(summary.totalCallOi)} calls</em>
          </article>
          <article className="options-equity-summary-card">
            <span>Put / Call Volume</span>
            <strong>{formatRatio(summary.putCallVolumeRatio)}</strong>
            <em>{formatNumber(summary.totalPutVolume)} puts vs {formatNumber(summary.totalCallVolume)} calls</em>
          </article>
          <article className="options-equity-summary-card">
            <span>Implied move</span>
            <strong>{formatPercent(summary.impliedMovePct)}</strong>
            <em>ATM straddle proxy</em>
          </article>
          <article className="options-equity-summary-card">
            <span>Feed state</span>
            <strong className={`options-equity-status ${statusClass}`}>{statusLabel}</strong>
            <em>{providerUnavailable ? "Provider unavailable" : showingStale ? "Saved snapshot" : liveConnected ? "Selected expiry live stream" : "Snapshot-backed chain"}</em>
            <em>{formatTimestamp(feedTimestamp)}</em>
          </article>
        </div>
      </section>

      {statusNotice ? (
        <div className="options-equity-notice">
          {statusNotice}
        </div>
      ) : null}

      <section className="options-equity-shell-grid">
        <div className="options-exec-panel options-equity-chain-panel">
          <div className="options-equity-panel-head">
            <div>
              <span>Chain truth surface</span>
              <strong>{data?.underlying || underlying} {data?.activeExpiry || expiry || "Nearest"} listed chain</strong>
            </div>
            <em>{chainRows.length} strikes · {liveConnected ? "snapshot + live deltas" : "direct Massive snapshot"}</em>
          </div>
          {chainRows.length ? (
            <div className="options-equity-ladder-scroll">
              <table className="options-equity-chain-table">
                <thead>
                  <tr>
                    <th colSpan="7">Calls</th>
                    <th className="strike">Strike</th>
                    <th colSpan="7">Puts</th>
                  </tr>
                  <tr>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Sz</th>
                    <th>Mid</th>
                    <th>IV</th>
                    <th>Delta</th>
                    <th>OI / Vol</th>
                    <th className="strike">Strike</th>
                    <th>OI / Vol</th>
                    <th>Delta</th>
                    <th>IV</th>
                    <th>Mid</th>
                    <th>Sz</th>
                    <th>Bid</th>
                    <th>Ask</th>
                  </tr>
                </thead>
                <tbody>
                  {chainRows.map((row) => (
                    <tr key={`${row.expiry}-${row.strike}`}>
                      <td>{formatMoney(row?.call?.bid, 2)}</td>
                      <td>{formatMoney(row?.call?.ask, 2)}</td>
                      <td>{formatNumber(row?.call?.bidSize)} / {formatNumber(row?.call?.askSize)}</td>
                      <td>{formatMoney(row?.call?.mid, 2)}</td>
                      <td>{formatIv(row?.call?.impliedVolatility)}</td>
                      <td className={classForSigned(row?.call?.delta)}>{formatNumber(row?.call?.delta, 2)}</td>
                      <td>{formatNumber(row?.call?.openInterest)} / {formatNumber(row?.call?.volume)}</td>
                      <td className="strike">{formatNumber(row.strike, 2)}</td>
                      <td>{formatNumber(row?.put?.openInterest)} / {formatNumber(row?.put?.volume)}</td>
                      <td className={classForSigned(row?.put?.delta)}>{formatNumber(row?.put?.delta, 2)}</td>
                      <td>{formatIv(row?.put?.impliedVolatility)}</td>
                      <td>{formatMoney(row?.put?.mid, 2)}</td>
                      <td>{formatNumber(row?.put?.bidSize)} / {formatNumber(row?.put?.askSize)}</td>
                      <td>{formatMoney(row?.put?.bid, 2)}</td>
                      <td>{formatMoney(row?.put?.ask, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <GuidedEmptyState
              eyebrow="Listed options"
              title={emptyTitle}
              description={emptyDescription}
              steps={emptySteps}
              cta="Retry snapshot"
              onAction={onRefresh}
              tone="warning"
              className="guided-empty-state--compact options-guided-empty"
            />
          )}
        </div>

        <aside className="options-exec-panel options-equity-rail">
          <div className="options-equity-panel-head">
            <div>
              <span>Workbench rail</span>
              <strong>Exchange activity, strike pressure, and unusual flow</strong>
            </div>
          </div>

          <div className="options-equity-rail-section">
            <span>Live tape</span>
            <div className="options-equity-rail-list">
              {liveTape.length ? liveTape.slice(0, 8).map((row) => (
                <div key={row.id} className="options-equity-rail-row compact tape">
                  <strong>{row.contractTicker}</strong>
                  <b>{row.kind === "trade" ? "Trade" : "Quote"} · {row.summary || "Update"}</b>
                  <em>{row.venue} · {formatTimestamp(row.updatedAt)}</em>
                </div>
              )) : <div className="options-equity-rail-empty">{providerUnavailable ? "Live options tape is paused until Massive reconnects." : "Waiting for live quote or trade updates."}</div>}
            </div>
          </div>

          <div className="options-equity-rail-section">
            <span>Venue split</span>
            <div className="options-equity-rail-list">
              {venueSummary.length ? venueSummary.map((row) => (
                <div key={row.venue} className="options-equity-rail-row">
                  <strong>{row.venue}</strong>
                  <b>{formatNumber(row.contracts)}</b>
                  <em>{formatNumber(row.volume)} vol</em>
                </div>
              )) : <div className="options-equity-rail-empty">No venue summary yet.</div>}
            </div>
          </div>

          <div className="options-equity-rail-section">
            <span>Strike crowding</span>
            <div className="options-equity-rail-list">
              {strikeCrowding.length ? strikeCrowding.map((row) => (
                <div key={`${row.strike}-${row.totalOi}`} className="options-equity-rail-row">
                  <strong>{formatNumber(row.strike, 2)}</strong>
                  <b>{formatNumber(row.totalOi)} OI</b>
                  <em>{formatNumber(row.totalVolume)} vol</em>
                </div>
              )) : <div className="options-equity-rail-empty">No crowded strikes yet.</div>}
            </div>
          </div>

          <div className="options-equity-rail-section">
            <span>Unusual activity</span>
            <div className="options-equity-rail-list">
              {unusualActivity.length ? unusualActivity.slice(0, 6).map((row) => (
                <div key={row.contractTicker} className="options-equity-rail-row compact">
                  <strong>{row.contractTicker}</strong>
                  <b>{formatNumber(row.volume)} vol</b>
                  <em>{row.venue || "Composite"}</em>
                </div>
              )) : <div className="options-equity-rail-empty">No standout contracts yet.</div>}
            </div>
          </div>
        </aside>
      </section>

      <section className="options-equity-bottom-grid">
        <div className="options-exec-panel options-equity-bottom-panel">
          <div className="options-equity-panel-head">
            <div>
              <span>Volatility term structure</span>
              <strong>Expiry-by-expiry IV and OI posture</strong>
            </div>
          </div>
          <div className="options-equity-bottom-list">
            {termStructure.length ? termStructure.map((row) => (
              <div key={row.expiry} className="options-equity-bottom-row">
                <strong>{row.expiry}</strong>
                <b>{formatIv(row.avgIv)}</b>
                <em>{formatNumber(row.totalOi)} OI</em>
                <em>{formatNumber(row.totalVolume)} vol</em>
              </div>
            )) : <div className="options-equity-rail-empty">No term structure rows yet.</div>}
          </div>
        </div>

        <div className="options-exec-panel options-equity-bottom-panel">
          <div className="options-equity-panel-head">
            <div>
              <span>Top contracts</span>
              <strong>Highest-conviction listed contracts from the current snapshot</strong>
            </div>
          </div>
          <div className="options-equity-bottom-list">
            {topContracts.length ? topContracts.slice(0, 8).map((row) => (
              <div key={row.contractTicker} className="options-equity-bottom-row">
                <strong>{row.contractTicker}</strong>
                <b>{formatNumber(row.volume)} vol</b>
                <em>{formatNumber(row.openInterest)} OI</em>
                <em>{formatIv(row.impliedVolatility)}</em>
              </div>
            )) : <div className="options-equity-rail-empty">No contract leaders yet.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
