import React, { useMemo, useState, useEffect } from "react";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { zeninFetch } from "../utils/zeninFetch";

/**
 * Zenin Capital — Full Metrics Page
 */



function Sparkline({ data, tone = "positive" }) {
  const points = useMemo(() => {
    const width = 120;
    const height = 38;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    return data
      .map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - min) / range) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data]);

  return (
    <svg className="sparkline" viewBox="0 0 120 38" preserveAspectRatio="none">
      <polyline className={`sparkline-line ${tone}`} points={points} />
    </svg>
  );
}

function MiniBar({ value }) {
  const width = parseFloat(value);
  return (
    <div className="mini-bar">
      <span style={{ width: `${Math.min(width * 3, 100)}%` }} />
    </div>
  );
}

export function FullMetricsPage({ 
  onBack, 
  themeMode, 
  toggleTheme,
  portfolio = [],
  trades = [],
  activeOptionsTrades = [],
  accountMetrics = null,
  assets = [],
  spotPrices = {},
  multiChainCache = {}
}) {
  const [activeTab, setActiveTab] = useState("Performance");
  const [timeframe, setTimeframe] = useState("YTD");
  const [scope, setScope] = useState("Total Portfolio");
  const [benchmark, setBenchmark] = useState("S&P 500");
  const [assetClass, setAssetClass] = useState("All");

  const [macroIndicators, setMacroIndicators] = useState(null);
  const [macroPrices, setMacroPrices] = useState({});
  const [benchmarkHistory, setBenchmarkHistory] = useState([]);

  useEffect(() => {
    const fetchMacro = async () => {
      try {
        const res = await zeninFetch("/macro-indicators?country=USA");
        if (res.ok) {
          const data = await res.json();
          setMacroIndicators(data);
        }
      } catch (e) { console.error("Macro Fetch Error:", e); }
    };
    
    const fetchMacroPrices = async () => {
      const symbols = ["UST10Y", "XAU", "WTI", "DXY"];
      const results = {};
      await Promise.all(symbols.map(async (s) => {
        try {
          const res = await zeninFetch(`/prices?symbol=${s}`);
          if (res.ok) {
            const data = await res.json();
            results[s] = data;
          }
        } catch (e) { console.error(`Price Fetch Error (${s}):`, e); }
      }));
      setMacroPrices(results);
    };

    fetchMacro();
    fetchMacroPrices();
  }, []);

  useEffect(() => {
    const fetchBenchmarkHistory = async () => {
      const benchmarkMap = {
        "S&P 500": { symbol: "SPY", type: "stock" },
        "Bloomberg U.S. Aggregate Bond Index": { symbol: "AGG", type: "stock" },
        "SOFR": { symbol: "BIL", type: "stock" }, // Proxy
        "S&P GSCI": { symbol: "GSG", type: "stock" },
        "MSCI U.S. REIT Index": { symbol: "VNQ", type: "stock" },
        "Bitcoin": { symbol: "BTC-USD", type: "crypto" }
      };

      const { symbol, type } = benchmarkMap[benchmark] || { symbol: "SPY", type: "stock" };
      try {
        const res = await zeninFetch(`/history?symbol=${symbol}&type=${type}&interval=1D`);
        if (res.ok) {
          const data = await res.json();
          setBenchmarkHistory(data.history || []);
        }
      } catch (e) { console.error("Benchmark History Fetch Error:", e); }
    };

    fetchBenchmarkHistory();
  }, [benchmark]);

  // Filter portfolio and trades based on selected Asset Class
  const filteredPortfolio = useMemo(() => {
    if (assetClass === "All") return portfolio;
    return portfolio.filter(item => {
      const type = (item.type || "").toLowerCase();
      const category = (item.category || "").toLowerCase();
      if (assetClass === "Equities") return type === "equity" || type === "stock";
      if (assetClass === "Bonds") return type === "bond" || category === "bonds";
      if (assetClass === "Crypto") return type === "crypto" || type === "stablecoin";
      if (assetClass === "Commodities") return category === "commodities" || category === "metals";
      if (assetClass === "Real Estate") return category === "real estate";
      return true;
    });
  }, [portfolio, assetClass]);

  const filteredTrades = useMemo(() => {
    if (assetClass === "All") return trades;
    return trades.filter(t => {
      const type = (t.type || "").toLowerCase();
      if (assetClass === "Equities") return type === "equity" || type === "stock";
      if (assetClass === "Bonds") return type === "bond";
      if (assetClass === "Crypto") return type === "crypto";
      return true;
    });
  }, [trades, assetClass]);

  const initialBalance = Number(accountMetrics?.initialBalance) || INITIAL_ACCOUNT_BALANCE;
  const currentAccountEquity = Number(accountMetrics?.totalAccountEquity) || initialBalance;
  
  // Filtered Equity (approximation for sub-segments)
  const filteredEquity = useMemo(() => {
    if (assetClass === "All") return currentAccountEquity;
    if (assetClass === "Cash/Money Market") return Number(accountMetrics?.availableBalance) || 0;
    return filteredPortfolio.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  }, [assetClass, filteredPortfolio, currentAccountEquity, accountMetrics]);

  const tradeTimeline = Array.isArray(accountMetrics?.tradeTimeline) ? accountMetrics.tradeTimeline : [];

  const kpis = useMemo(() => {
    const totalReturn = initialBalance > 0 ? ((filteredEquity - initialBalance) / initialBalance) * 100 : 0;
    const winRate = filteredTrades.length > 0 ? (filteredTrades.filter(t => (Number(t.pnl) || 0) > 0).length / filteredTrades.length) * 100 : 0;
    
    return [
      {
        label: `${assetClass === "All" ? "Total" : assetClass} Return`,
        value: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%`,
        sub: `vs ${benchmark} +8.21%`,
        tone: totalReturn >= 0 ? "positive" : "negative",
        data: tradeTimeline.slice(-12).map(p => p.equity) || [8, 12, 10, 16, 18, 22, 20, 28, 31, 29, 36, 41],
      },
      {
        label: `${assetClass === "All" ? "Account" : assetClass} Value`,
        value: `$${filteredEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        sub: assetClass === "All" ? `Initial: $${initialBalance.toLocaleString()}` : `Allocated Assets`,
        tone: "neutral",
        data: tradeTimeline.slice(-12).map(p => p.equity) || [11, 10, 14, 13, 17, 22, 19, 24, 27, 31, 33, 37],
      },
      {
        label: "Win Rate",
        value: `${winRate.toFixed(1)}%`,
        sub: `${filteredTrades.length} Segment Trades`,
        tone: winRate >= 50 ? "positive" : "neutral",
        data: [10, 12, 14, 16, 13, 18, 21, 23, 20, 25, 28, 31],
      },
      {
        label: "Positions",
        value: filteredPortfolio.length.toString(),
        sub: `${activeOptionsTrades.length} Options active`,
        tone: "neutral",
        data: [5, 7, 8, 6, 11, 10, 13, 16, 15, 18, 20, 22],
      }
    ];
  }, [initialBalance, filteredEquity, tradeTimeline, filteredTrades, filteredPortfolio, activeOptionsTrades, assetClass, benchmark]);

  const holdingsData = useMemo(() => {
    const totalVal = filteredPortfolio.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
    return filteredPortfolio.map(item => ({
      name: item.name || item.symbol,
      weight: totalVal > 0 ? `${(((Number(item.price) || 0) * (Number(item.quantity) || 0)) / totalVal * 100).toFixed(2)}%` : "0%"
    })).sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)).slice(0, 5);
  }, [filteredPortfolio]);

  const sectorsData = useMemo(() => {
    const sectorMap = {};
    let totalVal = 0;
    filteredPortfolio.forEach(item => {
      const val = (Number(item.price) || 0) * (Number(item.quantity) || 0);
      totalVal += val;
      const sector = item.theme || item.sector || "Other";
      sectorMap[sector] = (sectorMap[sector] || 0) + val;
    });
    return Object.entries(sectorMap).map(([name, val]) => ({
      name,
      value: totalVal > 0 ? `${(val / totalVal * 100).toFixed(1)}%` : "0%"
    })).sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
  }, [filteredPortfolio]);


  const optionsMetricsData = useMemo(() => {
    const totalOptionsValue = activeOptionsTrades.reduce((acc, trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      return acc + (Number(metrics.pnl) || 0);
    }, 0);

    return [
      ["Options P&L", `${totalOptionsValue >= 0 ? "+" : ""}$${totalOptionsValue.toFixed(2)}`, "Unrealized"],
      ["Open Strategies", activeOptionsTrades.length.toString(), "Active positions"],
      ["Weighted Delta", "+0.42", "Mocked bias"], // Placeholder for complex calc
      ["Theta / Day", "-$184", "Mocked decay"],    // Placeholder
    ];
  }, [activeOptionsTrades, multiChainCache, spotPrices]);

  const ratiosData = useMemo(() => {
    return [
      ["Positions", portfolio.length.toString()],
      ["Cash Weight", `${((1 - (portfolio.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0) / currentAccountEquity)) * 100).toFixed(1)}%`],
      ["Beta", "0.92"], // Placeholder
      ["ROE", "16.24%"], // Placeholder
    ];
  }, [portfolio, currentAccountEquity]);

  const macroCommoditiesData = useMemo(() => {
    const fedFunds = macroIndicators?.metrics?.find(m => m.key === "interest_rate")?.current;
    
    return [
      ["US 10Y Yield", macroPrices["UST10Y"]?.price ? `${Number(macroPrices["UST10Y"].price).toFixed(2)}%` : "4.31%", macroPrices["UST10Y"]?.priceChangePercent ? `${macroPrices["UST10Y"].priceChangePercent}%` : "+4.2 bps"],
      ["DXY Index", macroPrices["DXY"]?.price ? `${Number(macroPrices["DXY"].price).toFixed(2)}` : "104.53", macroPrices["DXY"]?.priceChangePercent ? `${macroPrices["DXY"].priceChangePercent}%` : "-0.28%"],
      ["Gold Spot", macroPrices["XAU"]?.price ? `$${Number(macroPrices["XAU"].price).toLocaleString()}` : "$2,386.40", macroPrices["XAU"]?.priceChangePercent ? `${macroPrices["XAU"].priceChangePercent}%` : "+0.72%"],
      ["WTI Crude", macroPrices["WTI"]?.price ? `$${Number(macroPrices["WTI"].price).toLocaleString()}` : "$77.02", macroPrices["WTI"]?.priceChangePercent ? `${macroPrices["WTI"].priceChangePercent}%` : "-1.90%"],
      ["Fed Funds Rate", fedFunds ? `${fedFunds}%` : "5.50%", "No change"],
    ];
  }, [macroIndicators, macroPrices]);

  const riskMetricsData = useMemo(() => {
    // Basic drawdown calc from timeline
    let peak = initialBalance;
    let maxDD = 0;
    tradeTimeline.forEach(p => {
      if (p.equity > peak) peak = p.equity;
      const dd = peak > 0 ? (peak - p.equity) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    });

    return [
      { label: "Max Drawdown", value: `-${(maxDD * 100).toFixed(2)}%`, tone: "negative" },
      { label: "Volatility Annualized", value: "13.42%", tone: "neutral" },
      { label: "Value at Risk 95%", value: "-2.18%", tone: "negative" },
      { label: "Beta vs S&P 500", value: "0.92", tone: "neutral" },
      { label: "Downside Capture", value: "84%", tone: "positive" },
    ];
  }, [tradeTimeline, initialBalance]);

  const benchmarkData = useMemo(() => {
    const getReturn = (hist, days) => {
      if (!hist || hist.length < 2) return 0;
      const latest = hist[hist.length - 1]?.close || hist[hist.length - 1]?.equity;
      let startIdx = 0;
      
      if (days === "YTD") {
        const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
        startIdx = hist.findIndex(p => (p.t || p.date) >= yearStart);
      } else if (typeof days === "number") {
        const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        startIdx = hist.findIndex(p => (p.t || p.date) >= startTime);
      }
      
      if (startIdx === -1) startIdx = 0;
      const start = hist[startIdx]?.close || hist[startIdx]?.equity;
      return start > 0 ? ((latest - start) / start) * 100 : 0;
    };

    const timeframeDays = {
      "1M": 30,
      "3M": 90,
      "6M": 180,
      "1Y": 365,
      "YTD": "YTD",
      "All": 9999
    }[timeframe] || "YTD";

    const portfolioReturn = getReturn(tradeTimeline, timeframeDays);
    const benchmarkReturn = getReturn(benchmarkHistory, timeframeDays);

    return [
      [timeframe, `${portfolioReturn.toFixed(2)}%`, `${benchmarkReturn.toFixed(2)}%`, `${(portfolioReturn - benchmarkReturn).toFixed(2)}%`],
      ["1M", `${getReturn(tradeTimeline, 30).toFixed(2)}%`, `${getReturn(benchmarkHistory, 30).toFixed(2)}%`, `${(getReturn(tradeTimeline, 30) - getReturn(benchmarkHistory, 30)).toFixed(2)}%`],
      ["3M", `${getReturn(tradeTimeline, 90).toFixed(2)}%`, `${getReturn(benchmarkHistory, 90).toFixed(2)}%`, `${(getReturn(tradeTimeline, 90) - getReturn(benchmarkHistory, 90)).toFixed(2)}%`],
      ["YTD", `${getReturn(tradeTimeline, "YTD").toFixed(2)}%`, `${getReturn(benchmarkHistory, "YTD").toFixed(2)}%`, `${(getReturn(tradeTimeline, "YTD") - getReturn(benchmarkHistory, "YTD")).toFixed(2)}%`],
    ];
  }, [tradeTimeline, benchmarkHistory, timeframe]);


  const tabs = [
    "Performance",
    "Risk",
    "Exposure",
    "Benchmark Comparison",
    "Options & Derivatives",
    "Macro & Commodities",
    "Key Ratios",
  ];

  return (
    <div className="metrics-shell active-zenin-metrics">
      <style>{styles}</style>

      {/* Mobile Header (Visible only on small screens) */}
      <div className="metrics-mobile-header">
        <div className="mobile-brand">
          <div className="brand-mark">Z</div>
          <span><strong>ZENIN</strong> CAPITAL</span>
        </div>
        <button className="mobile-menu-btn" onClick={onBack}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
      </div>

      <main className="metrics-main">
        <header className="metrics-header">
          <div className="header-titles">
            <div className="back-row">
                <button onClick={onBack} className="back-btn">← Back</button>
                <h1>Key Metrics</h1>
            </div>
            <p>Comprehensive performance, risk, and exposure analytics.</p>
          </div>

          <div className="header-actions">
            <Filter 
              label="Timeframe" 
              value={timeframe} 
              options={["YTD", "1M", "3M", "6M", "1Y", "All"]}
              onChange={setTimeframe}
            />
            <Filter 
              label="Scope" 
              value={scope} 
              options={[
                "Total Portfolio", 
                "Equities", 
                "Bonds", 
                "Cash/Money Market", 
                "Commodities", 
                "Real Estate", 
                "Crypto"
              ]}
              onChange={setScope}
            />
            <Filter 
              label="Benchmark" 
              value={benchmark} 
              options={[
                "S&P 500", 
                "Bloomberg U.S. Aggregate Bond Index", 
                "SOFR", 
                "S&P GSCI", 
                "MSCI U.S. REIT Index",
                "Bitcoin"
              ]}
              onChange={setBenchmark}
            />
            <Filter 
              label="Asset Class" 
              value={assetClass} 
              options={[
                "All", 
                "Equities", 
                "Bonds", 
                "Cash/Money Market", 
                "Commodities", 
                "Real Estate", 
                "Crypto"
              ]}
              onChange={setAssetClass}
            />
            <button className="export-btn">Export</button>
          </div>
        </header>

        <section className="tabs">
          {tabs.map((tab) => (
            <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
              {tab}
            </button>
          ))}
        </section>

        {activeTab === "Performance" && (
          <>
            <section className="kpi-grid">
              {kpis.map((kpi) => (
                <article className="kpi-card" key={kpi.label}>
                  <p>{kpi.label}</p>
                  <strong className={kpi.tone}>{kpi.value}</strong>
                  <span>{kpi.sub}</span>
                  <Sparkline data={kpi.data} tone={kpi.tone} />
                </article>
              ))}
            </section>

            <section className="metrics-grid two">
              <article className="panel large">
                <div className="panel-header">
                  <div>
                    <h2>Performance Over Time</h2>
                    <p>Portfolio vs benchmark total return.</p>
                  </div>
                  <span className="pill">YTD</span>
                </div>

                <div className="chart-wrap">
                  <svg viewBox="0 0 700 260" className="line-chart" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="blueArea" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {[40, 90, 140, 190, 240].map((y) => (
                      <line key={y} x1="0" y1={y} x2="700" y2={y} className="grid-line" />
                    ))}

                    {(() => {
                      const data = tradeTimeline.length > 1 ? tradeTimeline : [{t: Date.now() - 86400000, equity: initialBalance}, {t: Date.now(), equity: currentAccountEquity}];
                      const minEq = Math.min(...data.map(p => p.equity)) * 0.95;
                      const maxEq = Math.max(...data.map(p => p.equity)) * 1.05;
                      const range = maxEq - minEq || 1;
                      
                      const points = data.map((p, i) => {
                        const x = (i / (data.length - 1)) * 700;
                        const y = 260 - ((p.equity - minEq) / range) * 220 - 20;
                        return `${x},${y}`;
                      }).join(" ");

                      const areaPoints = `0,260 ${points} 700,260`;

                      return (
                        <>
                          <polyline className="portfolio-line" points={points} />
                          <polygon fill="url(#blueArea)" points={areaPoints} />
                        </>
                      );
                    })()}
                  </svg>
                </div>

                <div className="range-row">
                  {["1M", "3M", "6M", "YTD", "1Y", "3Y", "Max"].map((range) => (
                    <button key={range} className={range === "YTD" ? "active" : ""}>
                      {range}
                    </button>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Summary Insight</h2>
                    <p>Portfolio performance explanation.</p>
                  </div>
                </div>

                <p className="insight-copy">
                  The portfolio is outperforming the S&P 500 TR on a YTD basis, driven by strong equity selection,
                  disciplined options exposure, and well-contained drawdowns.
                </p>

                <div className="insight-grid">
                  <MetricSmall label="Outperformance" value="+4.24%" tone="positive" />
                  <MetricSmall label="Risk-Adjusted Return" value="Strong" tone="positive" />
                  <MetricSmall label="Drawdown Control" value="Better" tone="positive" />
                  <MetricSmall label="Consistency" value="Above Avg" tone="positive" />
                </div>
              </article>
            </section>

            <section className="metrics-grid three">
              <article className="panel">
                <div className="panel-header">
                  <h2>Allocation by Asset Class</h2>
                </div>

                <div className="donut-row">
                  <div className="donut">
                    <span>100%</span>
                    <small>Total</small>
                  </div>

                  <div className="legend">
                    <Legend color="#3b82f6" label="Equities" value="56%" />
                    <Legend color="#14b8a6" label="Options" value="18%" />
                    <Legend color="#f59e0b" label="Commodities" value="12%" />
                    <Legend color="#8b5cf6" label="Cash" value="8%" />
                    <Legend color="#94a3b8" label="Other" value="6%" />
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h2>Top Holdings by Weight</h2>
                </div>

                <div className="rank-list">
                  {holdingsData.map((item) => (
                    <div className="rank-row" key={item.name}>
                      <span>{item.name}</span>
                      <MiniBar value={item.weight} />
                      <strong>{item.weight}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h2>Sector Exposure</h2>
                </div>

                <div className="rank-list">
                  {sectorsData.map((item) => (
                    <div className="rank-row" key={item.name}>
                      <span>{item.name}</span>
                      <MiniBar value={item.value} />
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}

        {activeTab === "Risk" && (
          <section className="metrics-grid two">
            <article className="panel">
              <h2>Risk Metrics</h2>
              <div className="table-list">
                {riskMetricsData.map(m => (
                  <MetricLine key={m.label} label={m.label} value={m.value} tone={m.tone} />
                ))}
              </div>
            </article>

            <article className="panel">
              <h2>Risk Summary</h2>
              <p className="insight-copy">
                Risk remains moderate. Drawdown is controlled relative to benchmark, while exposure is concentrated in
                large-cap equities and options-linked upside.
              </p>
            </article>
          </section>
        )}

        {activeTab === "Exposure" && (
          <section className="metrics-grid two">
            <article className="panel">
              <h2>Asset Class Exposure</h2>
              <div className="allocation-bar">
                <span style={{ width: "56%", background: "#3b82f6" }} />
                <span style={{ width: "18%", background: "#14b8a6" }} />
                <span style={{ width: "12%", background: "#f59e0b" }} />
                <span style={{ width: "8%", background: "#8b5cf6" }} />
                <span style={{ width: "6%", background: "#94a3b8" }} />
              </div>
              <div className="legend wide">
                <Legend color="#3b82f6" label="Equities" value="56%" />
                <Legend color="#14b8a6" label="Options" value="18%" />
                <Legend color="#f59e0b" label="Commodities" value="12%" />
                <Legend color="#8b5cf6" label="Cash" value="8%" />
                <Legend color="#94a3b8" label="Other" value="6%" />
              </div>
            </article>

            <article className="panel">
              <h2>Exposure Notes</h2>
              <p className="insight-copy">
                Equity exposure remains dominant, while options provide asymmetric upside. Commodities exposure is
                primarily gold-linked with smaller oil sensitivity.
              </p>
            </article>
          </section>
        )}

        {activeTab === "Benchmark Comparison" && (
          <section className="panel">
            <h2>Benchmark Comparison</h2>
            <div className="comparison-grid">
              {benchmarkData.map(([period, portfolio, benchmark, diff]) => (
                <div className="comparison-card" key={period}>
                  <p>{period}</p>
                  <MetricSmall label="Portfolio" value={portfolio} tone="positive" />
                  <MetricSmall label="Benchmark" value={benchmark} tone="neutral" />
                  <MetricSmall label="Difference" value={diff} tone="positive" />
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "Options & Derivatives" && (
          <section className="metrics-grid two">
            <article className="panel">
              <h2>Options & Derivatives</h2>
              <div className="table-list">
                {optionsMetricsData.map(([label, value, note]) => (
                  <MetricLine key={label} label={label} value={value} note={note} />
                ))}
              </div>
            </article>

            <article className="panel">
              <h2>Options Insight</h2>
              <p className="insight-copy">
                Options exposure is moderate and tilted toward calls. Current positioning increases upside capture while
                introducing time decay risk from short-dated contracts.
              </p>
            </article>
          </section>
        )}

        {activeTab === "Macro & Commodities" && (
          <section className="metrics-grid two">
            <article className="panel">
              <h2>Macro & Commodities</h2>
              <div className="table-list">
                {macroCommoditiesData.map(([label, value, change]) => (
                  <MetricLine key={label} label={label} value={value} note={change} />
                ))}
              </div>
            </article>

            <article className="panel">
              <h2>Macro Sensitivity</h2>
              <p className="insight-copy">
                Portfolio sensitivity is highest to rates and large-cap equity momentum. Gold exposure offsets some
                macro uncertainty, while oil exposure remains limited.
              </p>
            </article>
          </section>
        )}

        {activeTab === "Key Ratios" && (
          <section className="panel">
            <h2>Key Ratios</h2>
            <div className="ratio-grid">
              {ratiosData.map(([label, value]) => (
                <MetricSmall key={label} label={label} value={value} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Filter({ label, value, options = [], onChange }) {
  return (
    <div className="filter-wrap" style={{ position: "relative" }}>
      <button className="filter">
        <span>{label}</span>
        <strong>{value}</strong>
        <em>⌄</em>
      </button>
      <select 
        value={value} 
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          appearance: "none"
        }}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function MetricSmall({ label, value, tone = "neutral" }) {
  return (
    <div className="metric-small">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function MetricLine({ label, value, note, tone = "neutral" }) {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {note && <em>{note}</em>}
    </div>
  );
}

function Legend({ color, label, value }) {
  return (
    <div className="legend-item">
      <i style={{ background: color }} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const styles = `
.metrics-shell {
  min-height: 100vh;
  width: 100%;
  overflow-x: hidden;
}

body:not(.light-theme-active) .metrics-shell {
  --bg: #020617;
  --panel: #07111f;
  --panel-2: #0b1628;
  --border: rgba(148, 163, 184, 0.18);
  --text: #f8fafc;
  --muted: #94a3b8;
  --soft: #cbd5e1;
  --blue: #38bdf8;
  --blue-2: #2563eb;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #f59e0b;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
  background: transparent;
  color: var(--text);
}

body.light-theme-active .metrics-shell {
  --bg: #f8fafc;
  --panel: #ffffff;
  --panel-2: #f8fafc;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --soft: #334155;
  --blue: #0284c7;
  --blue-2: #2563eb;
  --green: #16a34a;
  --red: #dc2626;
  --yellow: #d97706;
  --shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  background: transparent;
  color: var(--text);
}

.metrics-main {
  min-width: 0;
  width: 100%;
  padding: 0;
}

.metrics-mobile-header {
  display: none;
}

.back-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.back-btn {
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.2);
    color: var(--blue);
    padding: 4px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
}

.metrics-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  margin-bottom: 24px;
}

.metrics-header h1 {
  margin: 0;
  font-size: 32px;
  letter-spacing: -0.04em;
  color: var(--text);
}

.metrics-header p {
  color: var(--muted);
  margin: 0;
  font-size: 14px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.filter,
.export-btn {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 12px;
  min-height: 44px;
  min-width: 138px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
}

.filter span {
  display: block;
  font-size: 11px;
  color: var(--muted);
}

.filter strong { font-size: 13px; }
.filter em { float: right; color: var(--muted); font-style: normal; }

.export-btn {
  min-width: 90px;
  text-align: center;
  font-weight: 800;
  color: var(--blue);
}

.tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  padding-bottom: 12px;
  margin-bottom: 20px;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar { display: none; }

.tabs button {
  flex: 0 0 auto;
  border: 1px solid transparent;
  color: var(--muted);
  background: transparent;
  padding: 9px 16px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
}

.tabs button.active {
  color: var(--text);
  background: rgba(37, 99, 235, 0.18);
  border-color: rgba(56, 189, 248, 0.38);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.kpi-card, .panel, .comparison-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  min-width: 0;
}

.kpi-card p { margin: 0; color: var(--muted); font-size: 12px; }
.kpi-card strong { display: block; font-size: 25px; margin: 8px 0 2px; }
.kpi-card span { color: var(--muted); font-size: 11px; }

.positive { color: var(--green) !important; }
.negative { color: var(--red) !important; }
.neutral { color: var(--text) !important; }

.sparkline { width: 100%; height: 38px; margin-top: 12px; }
.sparkline-line { fill: none; stroke-width: 3; }
.sparkline-line.positive, .sparkline-line.neutral { stroke: var(--green); }
.sparkline-line.negative { stroke: var(--red); }

.metrics-grid { display: grid; gap: 12px; margin-bottom: 12px; }
.metrics-grid.two { grid-template-columns: 1.35fr 1fr; }
.metrics-grid.three { grid-template-columns: repeat(3, 1fr); }

.panel-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
.panel h2 { margin: 0; font-size: 18px; letter-spacing: -0.03em; color: var(--text); }

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--blue);
  background: rgba(37, 99, 235, 0.12);
  font-size: 12px;
  font-weight: 800;
}

.chart-wrap {
  height: 270px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
  padding: 10px;
  min-width: 0;
}

.line-chart { width: 100%; height: 100%; }
.grid-line { stroke: var(--border); stroke-width: 1; }
.portfolio-line { fill: none; stroke: var(--blue); stroke-width: 4; }
.benchmark-line { fill: none; stroke: var(--muted); stroke-width: 3; stroke-dasharray: 7 7; }

.range-row {
  margin-top: 12px;
  display: flex;
  gap: 6px;
  justify-content: center;
  overflow-x: auto;
  scrollbar-width: none;
}
.range-row::-webkit-scrollbar { display: none; }
.range-row button {
  flex: 0 0 auto;
  border: 1px solid transparent;
  color: var(--muted);
  background: transparent;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
}
.range-row button.active { color: var(--text); background: rgba(37, 99, 235, 0.18); }

.insight-copy { color: var(--soft) !important; font-size: 14px !important; line-height: 1.6; margin-bottom: 18px !important; }
.insight-grid, .ratio-grid, .comparison-grid { display: grid; gap: 12px; }
.insight-grid { grid-template-columns: repeat(2, 1fr); }
.ratio-grid { grid-template-columns: repeat(4, 1fr); }
.comparison-grid { grid-template-columns: repeat(4, 1fr); }

.metric-small, .metric-line {
  border: 1px solid var(--border);
  background: var(--panel-2);
  border-radius: 14px;
  padding: 13px;
}

.metric-small span { font-size: 12px; color: var(--muted); }
.metric-small strong { display: block; margin-top: 6px; font-size: 18px; }

.metric-line { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; }
.metric-line span { color: var(--muted); font-size: 12px; }
.metric-line strong { font-size: 16px; }
.metric-line em { color: var(--muted); font-size: 12px; font-style: normal; }

.donut-row { display: grid; grid-template-columns: 160px 1fr; gap: 18px; align-items: center; }
.donut {
  width: 145px;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle, var(--panel) 0 45%, transparent 46%),
    conic-gradient(#3b82f6 0 56%, #14b8a6 56% 74%, #f59e0b 74% 86%, #8b5cf6 86% 94%, #94a3b8 94% 100%);
  border: 1px solid var(--border);
}
.donut span { font-weight: 900; font-size: 24px; }
.donut small { display: block; color: var(--muted); margin-top: -30px; }

.legend { display: grid; gap: 9px; }
.legend.wide { grid-template-columns: repeat(5, 1fr); margin-top: 16px; }
.legend-item { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.legend-item i { width: 10px; height: 10px; border-radius: 999px; }
.legend-item strong { margin-left: auto; color: var(--text); }

.rank-list { display: grid; gap: 12px; }
.rank-row { display: grid; grid-template-columns: 1.2fr 1fr auto; gap: 12px; align-items: center; font-size: 13px; color: var(--soft); }
.rank-row strong { font-size: 12px; }
.mini-bar { height: 7px; background: rgba(148, 163, 184, 0.15); border-radius: 999px; overflow: hidden; }
.mini-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--green)); }

.table-list { display: grid; gap: 10px; }
.allocation-bar { height: 22px; display: flex; overflow: hidden; border-radius: 999px; border: 1px solid var(--border); background: var(--panel-2); }
.allocation-bar span { display: block; }

/* Responsive Overrides */

@media (max-width: 1400px) {
  .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .metrics-grid.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metrics-grid.three .panel:last-child { grid-column: 1 / -1; }
}

@media (max-width: 1200px) {
  .metrics-mobile-header {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 30;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(18px);
    margin: 0 0 22px 0;
    border-radius: 12px;
  }
  .metrics-mobile-header .mobile-brand { display: flex; align-items: center; gap: 10px; font-weight: 900; letter-spacing: -0.02em; }
  .metrics-mobile-header .mobile-menu-btn {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font-size: 20px;
    cursor: pointer;
  }
  .metrics-header { flex-direction: column; align-items: stretch; }
  .header-actions { justify-content: flex-start; }
  .metrics-grid.two, .metrics-grid.three { grid-template-columns: 1fr; }
  .chart-wrap { height: 240px; }
}

@media (max-width: 900px) {
  .metrics-header h1 { font-size: 30px; }
  .header-actions { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
  .header-actions::-webkit-scrollbar { display: none; }
  .filter, .export-btn { flex: 0 0 180px; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .insight-grid, .comparison-grid, .ratio-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .donut-row { grid-template-columns: 140px minmax(0, 1fr); }
  .donut { width: 130px; }
  .rank-row { grid-template-columns: 1fr minmax(80px, 1fr) auto; }
}

@media (max-width: 720px) {
  .metrics-header { gap: 14px; margin-bottom: 12px; }
  .metrics-header h1 { font-size: 26px; }
  .metrics-header p { font-size: 13px; }
  .header-actions { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; }
  .filter, .export-btn { flex: 0 0 155px; height: 48px; }
  .tabs { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; }
  .tabs button { min-height: 42px; }
  .kpi-grid { grid-template-columns: 1fr; gap: 10px; }
  .kpi-card, .panel, .comparison-card { border-radius: 14px; padding: 14px; }
  .kpi-card strong { font-size: 24px; }
  .chart-wrap { height: 200px; padding: 8px; }
  .insight-grid, .comparison-grid, .ratio-grid { grid-template-columns: 1fr; }
  .donut-row { grid-template-columns: 1fr; justify-items: center; }
  .legend { width: 100%; }
  .legend.wide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rank-row { grid-template-columns: 1fr; gap: 6px; }
  .mini-bar { width: 100%; }
  .metric-line { grid-template-columns: 1fr; gap: 6px; }
  .metric-line strong { font-size: 18px; }
}

@media (max-width: 520px) {
  .metrics-header h1 { font-size: 24px; }
  .metrics-mobile-header .mobile-brand span { display: none; }
  .filter, .export-btn { flex-basis: 145px; }
  .panel-header { flex-direction: column; gap: 8px; }
  .legend.wide { grid-template-columns: 1fr; }
  .donut { width: 120px; }
  .chart-wrap { height: 180px; }
}
`;
