import { useState, useEffect } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

export function OptionsModule() {
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [activeExpiry, setActiveExpiry] = useState(null);
  const [allAssets, setAllAssets] = useState(["BTC", "ETH", "SOL"]);
  const [chain, setChain] = useState([]);
  const [metrics, setMetrics] = useState({ iv: 0.245, pcr: 0.82, skew: "Bullish" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch ALL tradeable assets for the dropdown
    fetch(`${BACKEND_URL}/options/crypto/all-assets`)
      .then(res => res.json())
      .then(data => {
        if (data.assets && data.assets.length > 0) {
          setAllAssets(data.assets);
        }
      })
      .catch(err => console.error("Error fetching all assets:", err));
  }, []);

  useEffect(() => {
    setActiveExpiry(null); // Reset expiry when asset changes
  }, [activeAsset]);

  useEffect(() => {
    if (!activeAsset) return;

    await fetch(`${BACKEND_URL}/options/crypto`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    currency: "BTC"
  })
})
      .then(res => res.json())
      .then(data => {
        if (data.chain) {
          setChain(data.chain);
          setAvailableExpiries(data.expiries || []);
          if (!activeExpiry && data.expiry) setActiveExpiry(data.expiry);
          setMetrics({
            iv: parseFloat(data.market_metrics.iv) || 0.42,
            pcr: data.market_metrics.p_c_ratio || 0.85,
            skew: "Volatile"
          });
        }
      })
      .catch(err => console.error("Error fetching crypto options:", err))
      .finally(() => setLoading(false));
    };

    fetchChain();
    const interval = setInterval(fetchChain, 60000);
    return () => clearInterval(interval);
  }, [activeAsset, activeExpiry]);

  useEffect(() => {
  const ws = new WebSocket("wss://zenin-mx6w.onrender.com");

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: "subscribe",
      currency: activeAsset,
      expiry: activeExpiry
    }));
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "greeks_update") {
      setChain(msg.data);
    }
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
              className="asset-select glass"
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
                    <td className="greek">{row.call?.iv ? (row.call.iv * 100).toFixed(1) + "%" : "-"}</td>
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
      </div>
      <OptionsCalculator
        spotPrice={
          chain.length > 0 && chain[Math.floor(chain.length / 2)]?.strike
            ? chain[Math.floor(chain.length / 2)].strike
            : (activeAsset === "BTC" ? 80000 : 2000)
        }
        chainData={chain}
        activeAsset={activeAsset}
        activeExpiry={activeExpiry}
      />

    </div>
  );
}
