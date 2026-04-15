import { useState, useEffect } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const OPTIONS_CHAIN_REFRESH_MS = 180000; // 3 minutes

export function OptionsModule() {
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [spotPrices, setSpotPrices] = useState({});
  const [activeExpiry, setActiveExpiry] = useState(null);
  const [allAssets, setAllAssets] = useState(["BTC", "ETH", "SOL"]);
  const [chain, setChain] = useState([]);
  const [metrics, setMetrics] = useState({ iv: 0.245, pcr: 0.82, skew: "Bullish" });
  const [loading, setLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [whaleTrades, setWhaleTrades] = useState([]);
  const [whaleLoading, setWhaleLoading] = useState(false);
  const [whaleError, setWhaleError] = useState("");
  const [whalePage, setWhalePage] = useState(1);

 useEffect(() => {
  // fallback assets (Derive supports these)
  setAllAssets(["BTC", "ETH", "SOL"]);
}, []);

  useEffect(() => {
    setActiveExpiry(null); // Reset expiry when asset changes
  }, [activeAsset]);

useEffect(() => {
  let isMounted = true; // prevent state update after unmount

  const fetchChain = async () => {
      setLoading(true);
      try {
        setOptionsError("");
        const res = await fetch(`${BACKEND_URL}/options/crypto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currency: activeAsset || "BTC",
          expiry: activeExpiry || null
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();

      if (!isMounted) return;

      if (data && data.chain) {
        setAvailableExpiries(Array.isArray(data.expiries) ? data.expiries : []);

        if (!activeExpiry && data.expiry) {
          setActiveExpiry(data.expiry); // 🔥 prevents flicker + duplicate fetch
        }

        setChain(data.chain);
        setSpotPrices(prev => ({
          ...prev,
          [activeAsset]: data.market_price || data.spot || 0
        }));

        setMetrics({
          iv: parseFloat(data?.market_metrics?.iv) || 0.42,
          pcr: data?.market_metrics?.p_c_ratio || 0.85,
          skew: "Volatile"
        });
        if (data.stale) {
          setOptionsError(`Using cached options data (${data.stale_age_seconds || 0}s old).`);
        }
      } else {
        console.warn("Invalid options response:", data);
        setOptionsError("Options data is temporarily unavailable.");
      }

    } catch (err) {
      console.error("Error fetching crypto options:", err);
      if (isMounted) {
        setOptionsError("Live options feed is temporarily unavailable. Showing last known data.");
      }
    } finally {
      setLoading(false);
    }
  };

  fetchChain();

  // Refresh chain every 3 minutes while user is on the Options section.
  const interval = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    fetchChain();
  }, OPTIONS_CHAIN_REFRESH_MS);

  return () => {
    isMounted = false;
    clearInterval(interval);
  };

}, [activeAsset, activeExpiry]);

useEffect(() => {
  let isMounted = true;

  const fetchWhaleTrades = async () => {
    if (!isMounted) return;
    setWhaleLoading(true);
    setWhaleError("");
    try {
      const res = await fetch(`${BACKEND_URL}/options/whale-trades`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!isMounted) return;
      setWhaleTrades(Array.isArray(data?.trades) ? data.trades : []);
    } catch (err) {
      if (!isMounted) return;
      setWhaleError("Unable to load whale options trades.");
    } finally {
      if (isMounted) setWhaleLoading(false);
    }
  };

  fetchWhaleTrades();
  const interval = setInterval(fetchWhaleTrades, 120000); // every 2 minutes

  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}, []);

  const whalePageSize = 10;
  const whaleTotalPages = Math.max(1, Math.ceil(whaleTrades.length / whalePageSize));
  const pagedWhaleTrades = whaleTrades.slice(
    (whalePage - 1) * whalePageSize,
    whalePage * whalePageSize
  );

  useEffect(() => {
    if (whalePage > whaleTotalPages) setWhalePage(whaleTotalPages);
  }, [whalePage, whaleTotalPages]);

  const formatDollar = (value) => {
    const n = Number(value || 0);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const formatGreek = (value, digits = 3) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "-";
  };

  const formatIv = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-";
  };

  const formatDate = (ts) => {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    }).toUpperCase();
  };

  return (
    <div className="view-container options-terminal">
      <div className="portfolio-analytics-row">
        <div className="metric-card glass">
          <label>Implied Volatility <span className="live-pill">Live</span></label>
          <div className="value">{(metrics.iv * 100).toFixed(1)}%</div>
          <div className="change positive">▲ Real-time</div>
        </div>
        <div className="metric-card glass">
          <label>Put/Call Ratio</label>
          <div className="value">{metrics.pcr.toFixed(2)}</div>
          <div className="change negative">▼ 0.05</div>
        </div>
        <div className="metric-card glass">
          <label>Market Skew</label>
          <div className="value">{metrics.skew}</div>
          <div className="change positive">+14.2</div>
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <div className="header-left">
            <h2>{activeAsset} Option Chain <span className="live-pill">Live</span></h2>
            <div className="asset-count">{chain.length} Strikes Available</div>
          </div>
          
          <div className="asset-dropdown-container">
            <select 
              value={activeAsset}
              onChange={(e) => setActiveAsset(e.target.value)}
            >
              {allAssets.map(asset => (
                <option key={asset} value={asset}>{asset}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="expiry-tabs">
          {availableExpiries.map(ts => (
            <button 
              key={ts}
              className={`expiry-pill ${activeExpiry === ts ? "active" : ""}`}
              onClick={() => setActiveExpiry(ts)}
            >
              {formatDate(ts)}
            </button>
          ))}
        </div>

          {loading ? (
            <div className="loading-state">Syncing {activeAsset} with Lyra Protocol...</div>
          ) : chain.length === 0 ? (
            <div className="loading-state">No options data available for {activeAsset}.</div>
          ) : (
            <div className="table-scroll">
              <table className="option-chain-table">
                <thead>
                  <tr>
                    <th>IV</th>
                    <th>Delta</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th className="strike-col">Strike</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Delta</th>
                    <th>Theta</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.map((row) => (
                    <tr key={row.strike}>
                      <td className="greek">{formatIv(row.call?.iv)}</td>
                      <td className="greek">{formatGreek(row.call?.delta, 3)}</td>
                      <td className="bid-ask positive">{row.call?.bid > 0 ? `$${row.call.bid.toFixed(4)}` : "-"}</td>
                      <td className="bid-ask positive">{row.call?.ask > 0 ? `$${row.call.ask.toFixed(4)}` : "-"}</td>
                      <td className="strike-col">{row.strike.toLocaleString()}</td>
                      <td className="bid-ask negative">{row.put?.bid > 0 ? `$${row.put.bid.toFixed(4)}` : "-"}</td>
                      <td className="bid-ask negative">{row.put?.ask > 0 ? `$${row.put.ask.toFixed(4)}` : "-"}</td>
                      <td className="greek">{formatGreek(row.put?.delta, 3)}</td>
                      <td className="greek">{formatGreek(row.put?.theta, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {optionsError && (
            <div className="loading-state" style={{ marginTop: "8px", color: "#f59e0b" }}>
              {optionsError}
            </div>
          )}
      </div>

      <div className="watchlist-panel glass whale-trades-panel" style={{ marginTop: "16px", padding: "16px" }}>
        <div className="section-header" style={{ marginBottom: "10px" }}>
          <div className="header-left">
            <h2>Whale Options Trades <span className="live-pill">Live</span></h2>
            <div className="asset-count">BTC / ETH / SOL / HYPE</div>
          </div>
        </div>

        {whaleLoading ? (
          <div className="loading-state">Loading whale options trades...</div>
        ) : whaleError ? (
          <div className="loading-state">{whaleError}</div>
        ) : pagedWhaleTrades.length === 0 ? (
          <div className="loading-state">No whale options trades available.</div>
        ) : (
          <div className="table-scroll">
            <table className="option-chain-table whale-trades-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Expiration</th>
                  <th>Reference Price</th>
                  <th>Strategy</th>
                  <th>Total Notional</th>
                </tr>
              </thead>
              <tbody>
                {pagedWhaleTrades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="greek">{trade.symbol}</td>
                    <td className="greek">{trade.expiration || "—"}</td>
                    <td className="bid-ask positive">{formatDollar(trade.referencePrice)}</td>
                    <td className="greek">{trade.strategy}</td>
                    <td className="bid-ask positive">{formatDollar(trade.totalNotional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {whaleTotalPages > 1 && (
          <div className="pagination-controls" style={{ marginTop: "10px" }}>
            <button
              className="pagination-button"
              disabled={whalePage === 1}
              onClick={() => setWhalePage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <div className="pagination-label">
              Page {whalePage} of {whaleTotalPages}
            </div>
            <button
              className="pagination-button"
              disabled={whalePage === whaleTotalPages}
              onClick={() => setWhalePage((p) => Math.min(whaleTotalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
      <OptionsCalculator
        spotPrice={spotPrices[activeAsset]}
        assets={allAssets}
        chainData={chain}
        activeAsset={activeAsset}
        onAssetChange={setActiveAsset}
        activeExpiry={activeExpiry}
      />

    </div>
  );
}
