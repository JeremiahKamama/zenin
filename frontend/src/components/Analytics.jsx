import { useState, useEffect, useMemo } from "react";
import Chart from "react-apexcharts";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

export function Analytics() {
  const [loading, setLoading] = useState(true);
  
  // State for Hyperliquid Data
  const [hlData, setHlData] = useState([]);
  
  // State for Options Data (Deribit, Binance, Derive)
  const [optionsData, setOptionsData] = useState({
    BTC: { volume: 0, oi: 0, maxPain: 0 },
    ETH: { volume: 0, oi: 0, maxPain: 0 },
    SOL: { volume: 0, oi: 0, maxPain: 0 }
  });

  // State for Backend/Dune dependent data (Mocked until backend routes are built)
  const [macroData, setMacroData] = useState({
    kimchiPremium: 2.4,
    etfInflows: 145.2, // in millions
  });

  const TARGET_ASSETS = ["BTC", "ETH", "SOL", "HYPE", "BNB"];

  useEffect(() => {
    let isMounted = true;

    const fetchHyperliquidData = async () => {
      try {
        const res = await fetch("https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "metaAndAssetCtxs" })
        });
        const data = await res.json();
        if (!isMounted || !Array.isArray(data) || data.length < 2) return;
        
        const [meta, contexts] = data;
        const universe = meta.universe || [];
        
        const parsedData = TARGET_ASSETS.map(symbol => {
          const index = universe.findIndex(u => u.name === symbol);
          if (index === -1 || !contexts[index]) return null;
          
          const ctx = contexts[index];
          return {
            symbol,
            funding: parseFloat(ctx.funding) * 100 * 365, // Annualized funding
            oi: parseFloat(ctx.openInterest) * parseFloat(ctx.markPx), // OI in USD
            markPx: parseFloat(ctx.markPx)
          };
        }).filter(Boolean);

        setHlData(parsedData);
      } catch (err) {
        console.error("Hyperliquid fetch failed:", err);
      }
    };

    const fetchDeribitData = async (currency) => {
      try {
        const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`);
        const data = await res.json();
        if (!isMounted || !data.result) return null;

        let totalVolume = 0;
        let totalOI = 0;
        let maxPainAgg = 0; 
        
        // Simplified max pain calculation proxy (strike with highest OI)
        let highestOI = 0;
        let maxPainStrike = 0;

        data.result.forEach(item => {
          const strike = parseFloat(item.instrument_name.split('-'));
          totalVolume += item.volume_usd || 0;
          totalOI += item.estimated_delivery_usd || (item.open_interest * item.mark_price) || 0;
          
          if (item.open_interest > highestOI) {
            highestOI = item.open_interest;
            maxPainStrike = strike;
          }
        });

        return { volume: totalVolume, oi: totalOI, maxPain: maxPainStrike };
      } catch (err) {
        console.error(`Deribit fetch failed for ${currency}:`, err);
        return null;
      }
    };

    const loadAllData = async () => {
      setLoading(true);
      await fetchHyperliquidData();
      
      const [btcOptions, ethOptions, solOptions] = await Promise.all([
        fetchDeribitData("BTC"),
        fetchDeribitData("ETH"),
        fetchDeribitData("SOL")
      ]);

      if (isMounted) {
        setOptionsData({
          BTC: btcOptions || { volume: 0, oi: 0, maxPain: 0 },
          ETH: ethOptions || { volume: 0, oi: 0, maxPain: 0 },
          SOL: solOptions || { volume: 0, oi: 0, maxPain: 0 }
        });
        setLoading(false);
      }
    };

    loadAllData();
    const interval = setInterval(loadAllData, 60000); // Refresh every minute

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Formatters
  const formatCompact = (num) => {
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  // Mock Chart Data for Protocol Revenue
  const revChartOptions = {
    chart: { type: "bar", toolbar: { show: false }, background: "transparent" },
    theme: { mode: "dark" },
    colors: ["#38bdf8", "#a78bfa", "#f59e0b", "#22c55e"],
    plotOptions: { bar: { borderRadius: 4, horizontal: false, columnWidth: '55%' } },
    dataLabels: { enabled: false },
    xaxis: { categories: ["Hyperliquid", "Binance", "Deribit", "Derive"], labels: { style: { colors: "#64748b" } } },
    yaxis: { labels: { style: { colors: "#94a3b8" }, formatter: (v) => `$${v}M` } },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4 },
  };

  const revChartSeries = [{
    name: "30D Revenue",
    data: [42.1, 120.5, 38.2, 5.4] // Placeholder Dune data
  }];

  return (
    <div className="view-container analytics-dashboard">
      <div className="section-header" style={{ marginBottom: "16px" }}>
        <h2>Macro & Crypto Analytics</h2>
        <span className={`data-health-badge ${loading ? "loading" : "ok"}`}>
          <span className={`status-icon ${loading ? "spinner" : ""}`}>{loading ? "⟳" : "✓"}</span>
          Live Data
        </span>
      </div>

      {/* Top Level Macro Metrics */}
      <div className="portfolio-analytics-row" style={{ marginBottom: "20px" }}>
        <div className="metric-card glass">
          <label>Kimchi Premium</label>
          <div className="value">{macroData.kimchiPremium.toFixed(2)}%</div>
          <div className="change positive">Korea vs Global Spot</div>
        </div>
        <div className="metric-card glass">
          <label>Spot BTC ETF Flows (24H)</label>
          <div className={`value ${macroData.etfInflows >= 0 ? "positive" : "negative"}`}>
            {macroData.etfInflows >= 0 ? "+" : ""}${macroData.etfInflows}M
          </div>
          <div className="change positive">Dune Analytics</div>
        </div>
        <div className="metric-card glass">
          <label>Total Options OI (Deribit)</label>
          <div className="value">{formatCompact(optionsData.BTC.oi + optionsData.ETH.oi + optionsData.SOL.oi)}</div>
          <div className="change positive">BTC, ETH, SOL</div>
        </div>
      </div>

      <div className="home-grid">
        {/* Hyperliquid Perp Data */}
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2 className="home-subsection-title">Perp Open Interest & Funding (HL)</h2>
          </div>
          <div className="table-scroll">
            <table className="option-chain-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Mark Price</th>
                  <th>Open Interest</th>
                  <th>Funding (APR)</th>
                </tr>
              </thead>
              <tbody>
                {hlData.length === 0 ? (
                  <tr><td colSpan="4" style={{textAlign: "center", padding: "20px"}}>Loading Hyperliquid Data...</td></tr>
                ) : (
                  hlData.map(row => (
                    <tr key={row.symbol}>
                      <td style={{fontWeight: 600}}>{row.symbol}</td>
                      <td className="bid-ask positive">${row.markPx.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      <td>{formatCompact(row.oi)}</td>
                      <td className={row.funding >= 0 ? "positive" : "negative"}>
                        {row.funding > 0 ? "+" : ""}{row.funding.toFixed(4)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Global Options Data */}
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2 className="home-subsection-title">Options Market Profile</h2>
          </div>
          <div className="table-scroll">
            <table className="option-chain-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>24H Volume</th>
                  <th>Total OI</th>
                  <th>Est. Max Pain</th>
                </tr>
              </thead>
              <tbody>
                {["BTC", "ETH", "SOL"].map(symbol => (
                  <tr key={symbol}>
                    <td style={{fontWeight: 600}}>{symbol}</td>
                    <td>{formatCompact(optionsData[symbol].volume)}</td>
                    <td>{formatCompact(optionsData[symbol].oi)}</td>
                    <td className="bid-ask positive">
                      {optionsData[symbol].maxPain > 0 ? `$${optionsData[symbol].maxPain.toLocaleString()}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#64748b" }}>
            *Data aggregated from Deribit public endpoints.
          </div>
        </div>
      </div>

      {/* Protocol Metrics */}
      <div className="portfolio-chart-section" style={{ marginTop: "20px" }}>
        <div className="watchlist-panel glass">
          <div className="section-header" style={{ marginBottom: "12px" }}>
            <h2>Protocol Revenue & Perp Volume (30D)</h2>
            <div className="asset-count">Powered by Dune</div>
          </div>
          <Chart
            options={revChartOptions}
            series={revChartSeries}
            type="bar"
            height={250}
            width="100%"
          />
        </div>
      </div>
      
    </div>
  );
}