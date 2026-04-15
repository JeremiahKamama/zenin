import { useState, useEffect } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const WS_URL = import.meta.env.VITE_WS_URL;

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

  // 🔥 Polling (safe)
  const interval = setInterval(fetchChain, 60000);

  return () => {
    isMounted = false;
    clearInterval(interval);
  };

}, [activeAsset, activeExpiry]);

useEffect(() => {
  if (!WS_URL) return undefined;
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "subscribe",
      currency: activeAsset,
      expiry: activeExpiry || null
    }));
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "greeks_update" && Array.isArray(msg.data)) {
        setChain(msg.data);
      }
    } catch (e) {
      console.error("WS parse error:", e);
    }
  };

  ws.onerror = (e) => {
    console.error("WebSocket error:", e);
  };

  return () => ws.close();

}, [activeAsset, activeExpiry]);

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
                    <td className="greek">{row.call?.iv ? ((row.call?.iv || 0) * 100).toFixed(1) + "%" : "-"}</td>
                    <td className="greek">{row.call?.delta?.toFixed(3) || "-"}</td>
                    <td className="bid-ask positive">{row.call?.bid > 0 ? `$${row.call.bid.toFixed(4)}` : "-"}</td>
                    <td className="bid-ask positive">{row.call?.ask > 0 ? `$${row.call.ask.toFixed(4)}` : "-"}</td>
                    <td className="strike-col">{row.strike.toLocaleString()}</td>
                    <td className="bid-ask negative">{row.put?.bid > 0 ? `$${row.put.bid.toFixed(4)}` : "-"}</td>
                    <td className="bid-ask negative">{row.put?.ask > 0 ? `$${row.put.ask.toFixed(4)}` : "-"}</td>
                    <td className="greek">{row.put?.delta?.toFixed(3) || "-"}</td>
                    <td className="greek">{row.put?.theta ? row.put.theta.toFixed(4) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {optionsError && (
            <div className="loading-state" style={{ marginTop: "8px", color: "#f59e0b" }}>
              {optionsError}
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
