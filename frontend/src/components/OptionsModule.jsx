import { useState, useEffect } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const OPTIONS_CHAIN_REFRESH_MS = 180000; // 3 minutes

export function OptionsModule() {
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [spotPrices, setSpotPrices] = useState({});
  const [spotSources, setSpotSources] = useState({});
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
  const [whaleMinNotional, setWhaleMinNotional] = useState(100000);

 useEffect(() => {
  // fallback assets (Derive supports these)
  setAllAssets(["BTC", "ETH", "SOL"]);
}, []);

  useEffect(() => {
    setActiveExpiry(null); // Reset expiry when asset changes
  }, [activeAsset]);

useEffect(() => {
  let isMounted = true; // prevent state update after unmount

  const getHyperliquidFallbackSpot = async (assetSymbol) => {
    try {
      const res = await fetch(`${BACKEND_URL}/crypto-market`);
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data?.assets) ? data.assets : [];
      const match = rows.find(
        (row) => String(row?.symbol || "").toUpperCase() === String(assetSymbol || "").toUpperCase()
      );
      const price = Number(match?.price);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  };

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
        const lyraSpot = Number(data?.market_price ?? data?.spot);
        if (Number.isFinite(lyraSpot) && lyraSpot > 0) {
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: lyraSpot
          }));
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "lyra" }));
        } else {
          const fallbackSpot = await getHyperliquidFallbackSpot(activeAsset);
          if (!isMounted) return;
          if (Number.isFinite(fallbackSpot) && fallbackSpot > 0) {
            setSpotPrices((prev) => ({
              ...prev,
              [activeAsset]: fallbackSpot
            }));
            setSpotSources((prev) => ({ ...prev, [activeAsset]: "hyperliquid" }));
          } else {
            setSpotSources((prev) => ({ ...prev, [activeAsset]: "unavailable" }));
          }
        }

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
        const fallbackSpot = await getHyperliquidFallbackSpot(activeAsset);
        if (!isMounted) return;
        if (Number.isFinite(fallbackSpot) && fallbackSpot > 0) {
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: fallbackSpot
          }));
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "hyperliquid" }));
        } else {
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "unavailable" }));
        }
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
      const params = new URLSearchParams({ minNotional: String(whaleMinNotional) });
      const res = await fetch(`${BACKEND_URL}/options/whale-trades?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!isMounted) return;
      setWhaleTrades(Array.isArray(data?.trades) ? data.trades : []);
      setWhalePage(1);
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
}, [whaleMinNotional]);

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

  const formatOptionPx = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? `$${n.toFixed(4)}` : "-";
  };

  const formatDate = (ts) => {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    }).toUpperCase();
  };

  const whaleThresholdOptions = [
    { label: "Above $100K", value: 100000 },
    { label: "Above $250K", value: 250000 },
    { label: "Above $500K", value: 500000 },
    { label: "Above $750K", value: 750000 },
    { label: "Above $1M", value: 1000000 }
  ];

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
            <div className="table-scroll options-chain-scroll" style={{ maxHeight: "320px", overflowY: "auto" }}>
              <table className="option-chain-table">
                <thead>
                  <tr>
                    <th colSpan="4" className="chain-side-header">Calls</th>
                    <th className="strike-col chain-side-divider">Strike</th>
                    <th colSpan="4" className="chain-side-header">Puts</th>
                  </tr>
                  <tr>
                    <th>IV</th>
                    <th>Delta</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th className="strike-col">Strike</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Delta</th>
                    <th>IV</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.map((row) => (
                    <tr key={row.strike}>
                      <td className="greek">{formatIv(row.call?.iv)}</td>
                      <td className="greek">{formatGreek(row.call?.delta, 3)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.bid)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.ask)}</td>
                      <td className="strike-col">{Number(row.strike || 0).toLocaleString()}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.bid)}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.ask)}</td>
                      <td className="greek">{formatGreek(row.put?.delta, 3)}</td>
                      <td className="greek">{formatIv(row.put?.iv)}</td>
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
          <div className="asset-dropdown-container">
            <select
              value={whaleMinNotional}
              onChange={(e) => setWhaleMinNotional(Number(e.target.value) || 100000)}
            >
              {whaleThresholdOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
        spotSource={spotSources[activeAsset]}
        assets={allAssets}
        chainData={chain}
        activeAsset={activeAsset}
        onAssetChange={setActiveAsset}
        activeExpiry={activeExpiry}
      />

    </div>
  );
}
