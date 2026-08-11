// src/components/AfricaDesk.jsx
//
// Africa Desk — exchange-scoped African-equities analytics powered by MyStocks
// (the backend-only MyStocks Africa integration). This desk does NOT replace the
// existing US/global desks; it adds an exchange-scoped view per the integration
// spec. All data is sourced from the backend /api/market/* endpoints, which
// proxy MyStocks server-side — no API key ever reaches the browser.
//
// HONESTY: when MyStocks is unconfigured (no backend key) every panel shows an
// explicit "Unavailable · MyStocks" state. We never fabricate African market
// data. Each panel shows source + as-of + stale/unavailable status.

import React, { useEffect, useState, useCallback } from "react";
import { zeninFetchJson } from "../utils/zeninFetch";
import { isMyStocksWired } from "../utils/DataCoverageRegistry";
import { AssetLogo } from "./AssetLogo";

const SUPPORTED = [
  { mic: "XNSE", label: "NSE (Kenya)" },
  { mic: "XGSE", label: "NGX (Nigeria)" },
  { mic: "XJSE", label: "JSE (South Africa)" },
  { mic: "XGHA", label: "GSE (Ghana)" },
  { mic: "XCAI", label: "EGX (Egypt)" },
  { mic: "XLUSE", label: "LuSE (Zambia)" },
  { mic: "XBRV", label: "BRVM (W. Africa)" },
  { mic: "XBOT", label: "BSE (Botswana)" },
];

function africaEnvelopeError(err) {
  return {
    unavailable: true,
    stale_reason: err && err.message ? err.message : "mystocks_unavailable",
  };
}

async function getMarket(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await zeninFetchJson(`/api/market/${path}${qs ? `?${qs}` : ""}`);
  return res && res.data != null ? res : { data: null, unavailable: true, stale_reason: "empty" };
}

function Panel({ title, children, footer }) {
  return (
    <section className="analytics-card africa-desk-panel" role="region" aria-label={title}>
      <div className="dense-panel-header">
        <span className="dph-title">{title}</span>
        <span className="dph-meta">{footer || ""}</span>
      </div>
      <div className="africa-desk-panel-body">{children}</div>
    </section>
  );
}

function Unavailable({ reason }) {
  return (
    <div className="africa-desk-empty" role="status">
      <div className="analytics-empty-title">Unavailable · MyStocks</div>
      <div className="analytics-empty-description">
        {reason || "African market data is not configured on the backend."}
      </div>
    </div>
  );
}

export function AfricaDesk() {
  const [exchange, setExchange] = useState(SUPPORTED[0].mic);
  const [status, setStatus] = useState(null);
  const [movers, setMovers] = useState(null);
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, i] = await Promise.allSettled([
        getMarket("status", { exchange }),
        getMarket("movers", { exchange, direction: "top_gainers", limit: 12 }),
        getMarket("intelligence", { exchange, limit: 8 }),
      ]);
      setStatus(s.status === "fulfilled" ? s.value : africaEnvelopeError(s.reason));
      setMovers(m.status === "fulfilled" ? m.value : africaEnvelopeError(m.reason));
      setIntel(i.status === "fulfilled" ? i.value : africaEnvelopeError(i.reason));
    } catch {
      setStatus(africaEnvelopeError());
      setMovers(africaEnvelopeError());
      setIntel(africaEnvelopeError());
    } finally {
      setLoading(false);
    }
  }, [exchange]);

  useEffect(() => {
    load();
  }, [load]);

  const wired = isMyStocksWired();

  return (
    <div className="africa-desk">
      <div className="africa-desk-toolbar">
        <label htmlFor="africa-exchange" className="africa-desk-label">Exchange</label>
        <select
          id="africa-exchange"
          className="africa-desk-select"
          value={exchange}
          onChange={(e) => setExchange(e.target.value)}
        >
          {SUPPORTED.map((ex) => (
            <option key={ex.mic} value={ex.mic}>{ex.label}</option>
          ))}
        </select>
        <span className={`africa-desk-provider ${wired ? "is-wired" : "is-unconfigured"}`}>
          {wired ? "Source · MyStocks Africa" : "MyStocks · unconfigured"}
        </span>
      </div>

      {loading ? (
        <div className="africa-desk-empty"><div className="analytics-empty-title">Loading African market data…</div></div>
      ) : (
        <div className="africa-desk-grid">
          <Panel
            title="Market Status"
            footer={status && !status.unavailable ? `As of ${status.data?.asOf || "—"}` : "MyStocks"}
          >
            {status && status.unavailable ? (
              <Unavailable reason={status.stale_reason} />
            ) : (
              <div className="africa-status">
                <span className={`africa-status-dot ${status?.data?.open ? "open" : "closed"}`} />
                <span>{status?.data?.state ? String(status.data.state).toUpperCase() : "Unknown"}</span>
              </div>
            )}
          </Panel>

          <Panel
            title="Top Movers"
            footer={movers && !movers.unavailable ? (movers.data?.exchange || "MyStocks") : "MyStocks"}
          >
            {movers && movers.unavailable ? (
              <Unavailable reason={movers.stale_reason} />
            ) : (
              <ul className="africa-movers">
                {(movers?.data?.items || []).slice(0, 12).map((row, idx) => (
                  <li key={row.symbol || idx} className="africa-mover-row">
                    <span className="africa-mover-symbol"><AssetLogo asset={row} size="xs" />{row.symbol}</span>
                    <span className="africa-mover-price">{row.price != null ? row.price : "—"}</span>
                    <span className={`africa-mover-chg ${(row.changePercent ?? 0) >= 0 ? "up" : "down"}`}>
                      {row.changePercent != null ? `${row.changePercent.toFixed(2)}%` : ""}
                    </span>
                  </li>
                ))}
                {(movers?.data?.items || []).length === 0 ? <li className="africa-mover-empty">No movers returned.</li> : null}
              </ul>
            )}
          </Panel>

          <Panel
            title="Market Intelligence"
            footer={intel && !intel.unavailable ? "MyStocks Africa editorial" : "MyStocks"}
          >
            {intel && intel.unavailable ? (
              <Unavailable reason={intel.stale_reason} />
            ) : (
              <ul className="africa-intel">
                {(intel?.data || []).slice(0, 8).map((item, idx) => (
                  <li key={item.id || idx} className="africa-intel-row">
                    <span className="africa-intel-title">{item.title}</span>
                    <span className="africa-intel-meta">
                      {item.type ? `${item.type} · ` : ""}
                      {item.asOf ? `${item.asOf}` : ""}
                      {" MyStocks Africa market intelligence"}
                    </span>
                  </li>
                ))}
                {(intel?.data || []).length === 0 ? <li className="africa-intel-empty">No intelligence returned.</li> : null}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

export default AfricaDesk;
