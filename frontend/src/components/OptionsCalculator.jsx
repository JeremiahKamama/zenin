import { useState, useEffect } from "react";
import Chart from "react-apexcharts";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

const STRATEGIES = [
  { name: "Long Call", legs: [{ type: "call", direction: "long", qty: 1 }] },
  { name: "Short Call", legs: [{ type: "call", direction: "short", qty: 1 }] },
  { name: "Long Put", legs: [{ type: "put", direction: "long", qty: 1 }] },
  { name: "Short Put", legs: [{ type: "put", direction: "short", qty: 1 }] },
  { name: "Call Spread", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "call", direction: "short", qty: 1 }] },
  { name: "Put Spread", legs: [{ type: "put", direction: "long", qty: 1 }, { type: "put", direction: "short", qty: 1 }] },
  { name: "Credit Call Spread", legs: [{ type: "call", direction: "short", qty: 1 }, { type: "call", direction: "long", qty: 1 }] },
  { name: "Credit Put Spread", legs: [{ type: "put", direction: "short", qty: 1 }, { type: "put", direction: "long", qty: 1 }] },
  { name: "Long Straddle", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "put", direction: "long", qty: 1 }] },
  { name: "Short Straddle", legs: [{ type: "call", direction: "short", qty: 1 }, { type: "put", direction: "short", qty: 1 }] },
  { name: "Long Strangle", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "put", direction: "long", qty: 1 }] },
  { name: "Short Strangle", legs: [{ type: "call", direction: "short", qty: 1 }, { type: "put", direction: "short", qty: 1 }] },
  { name: "Iron Condor", legs: [{ type: "put", direction: "long", qty: 1 }, { type: "put", direction: "short", qty: 1 }, { type: "call", direction: "short", qty: 1 }, { type: "call", direction: "long", qty: 1 }] },
  { name: "Iron Butterfly", legs: [{ type: "put", direction: "long", qty: 1 }, { type: "put", direction: "short", qty: 1 }, { type: "call", direction: "short", qty: 1 }, { type: "call", direction: "long", qty: 1 }] },
  { name: "Long Calendar", legs: [{ type: "call", direction: "short", qty: 1 }, { type: "call", direction: "long", qty: 1 }] },
  { name: "Short Calendar", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "call", direction: "short", qty: 1 }] },
  { name: "Ratio Call Spread", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "call", direction: "short", qty: 2 }] },
  { name: "Ratio Put Spread", legs: [{ type: "put", direction: "long", qty: 1 }, { type: "put", direction: "short", qty: 2 }] },
];

const EMPTY_LEG = { strike: "", expiry: "", type: "call", direction: "long", qty: 1, premium: "", iv: "" };

function blackScholes(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const N = (x) => { const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911; const sign=x<0?-1:1; const t=1/(1+p*Math.abs(x)); const y=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2); return 0.5*(1+sign*y); };
  const Nprime = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  let price, delta, theta;
  if (type === "call") {
    price = S * N(d1) - K * Math.exp(-r * T) * N(d2);
    delta = N(d1);
    theta = (-S * Nprime(d1) * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * N(d2)) / 365;
  } else {
    price = K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
    delta = N(d1) - 1;
    theta = (-S * Nprime(d1) * sigma / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * N(-d2)) / 365;
  }
  const gamma = Nprime(d1) / (S * sigma * Math.sqrt(T));
  const vega = S * Nprime(d1) * Math.sqrt(T) / 100;
  return { price, delta, gamma, theta, vega };
}

export function OptionsCalculator({   spotPrice = 0,
  spotSource = "unavailable",
  chainData = [],
  activeAsset,
  assets = [],
  onAssetChange }) {
useEffect(() => {
  setSymbol(activeAsset);
  setSymbolSearch(activeAsset);
}, [activeAsset]);
  const [symbol, setSymbol] = useState(activeAsset);
  const [symbolSearch, setSymbolSearch] = useState(activeAsset);
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [legs, setLegs] = useState([{ ...EMPTY_LEG }]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [savedCalculations, setSavedCalculations] = useState([]);
  const [saveMsg, setSaveMsg] = useState("");
  const filteredChainData = Array.isArray(chainData) ? chainData : [];
  const deriveSpotFromChain = () => {
    const strikes = filteredChainData
      .map((row) => Number(row?.strike))
      .filter((val) => Number.isFinite(val) && val > 0)
      .sort((a, b) => a - b);
    if (!strikes.length) return null;
    return strikes[Math.floor(strikes.length / 2)];
  };
  const derivedSpot = deriveSpotFromChain();
  const effectiveSpot = Number(spotPrice) > 0
    ? Number(spotPrice)
    : (Number.isFinite(derivedSpot) ? Number(derivedSpot) : null);
  const S = Number.isFinite(effectiveSpot) && effectiveSpot > 0 ? effectiveSpot : 1;
  const r = 0.0425;

  useEffect(() => {
  setLegs([{ ...EMPTY_LEG }]);
  setActiveStrategy(null);
}, [symbol]);

  const filteredSymbols = assets.filter(s =>
  s.toLowerCase().includes(symbolSearch.toLowerCase())
);

  // Auto-populate strike from chain data when available
  const getChainStrikes = () => {
    if (!filteredChainData.length) return [];
    return filteredChainData.map(row => row.strike).filter(Boolean);
  };

  const getChainIV = (strike, type) => {
  const row = filteredChainData.find(
    r => r.strike === parseFloat(strike)
  );
  if (!row) return "";
  const side = type === "call" ? row.call : row.put;
  return side?.iv ? (side.iv * 100).toFixed(1) : "";
};

  const getChainPremium = (strike, type) => {
  const row = filteredChainData.find(
    r => r.strike === parseFloat(strike)
  );
  if (!row) return "";
  const side = type === "call" ? row.call : row.put;
  const mid = ((Number(side?.bid) || 0) + (Number(side?.ask) || 0)) / 2;
  return Number.isFinite(mid) && mid > 0 ? mid.toFixed(4) : "";
};
  
  const addLeg = () => setLegs(prev => [...prev, { ...EMPTY_LEG }]);
  const removeLeg = (i) => setLegs(prev => prev.filter((_, idx) => idx !== i));
  const updateLeg = (i, field, value) => setLegs(prev => prev.map((leg, idx) => idx === i ? { ...leg, [field]: value } : leg));
  const refreshLeg = (i) => {
    const leg = legs[i];
    if (!leg) return;
    const strike = leg.strike;
    if (!strike) return;
    const iv = getChainIV(strike, leg.type);
    const premium = getChainPremium(strike, leg.type);
    if (iv) updateLeg(i, "iv", iv);
    if (premium) updateLeg(i, "premium", premium);
  };

  const applyStrategy = (strategy) => {
    setActiveStrategy(strategy.name);
    setLegs(strategy.legs.map(l => ({ ...EMPTY_LEG, ...l })));
  };

  const greeks = legs.map(leg => {
    const K = parseFloat(leg.strike);
    if (!K) return null;
    const premium = parseFloat(leg.premium) || 0;
    const iv = (parseFloat(leg.iv) || 20) / 100;
    const expiry = leg.expiry ? (new Date(leg.expiry) - new Date()) / (1000 * 60 * 60 * 24 * 365) : 30 / 365;
    const T = Math.max(expiry, 0.001);
    const bs = blackScholes(S, K, T, r, iv, leg.type);
    const dir = leg.direction === "long" ? 1 : -1;
    const qty = parseInt(leg.qty) || 1;
    return {
      delta: bs.delta * dir * qty,
      gamma: bs.gamma * dir * qty,
      theta: bs.theta * dir * qty,
      vega: bs.vega * dir * qty,
      pnl: (bs.price - premium) * dir * qty,
      bsPrice: bs.price,
    };
  });

  const totals = greeks.reduce((acc, g) => {
    if (!g) return acc;
    return {
      delta: acc.delta + g.delta,
      gamma: acc.gamma + g.gamma,
      theta: acc.theta + g.theta,
      vega: acc.vega + g.vega,
      pnl: acc.pnl + g.pnl,
    };
  }, { delta: 0, gamma: 0, theta: 0, vega: 0, pnl: 0 });

  // P&L diagram data
  const pnlData = (() => {
    const range = S * 0.4;
    const prices = Array.from({ length: 80 }, (_, i) => S - range + (i / 79) * range * 2);
    return prices.map(price => {
      let totalPnl = 0;
      legs.forEach((leg, i) => {
        const K = parseFloat(leg.strike) || S;
        const premium = parseFloat(leg.premium) || 0;
        const qty = parseInt(leg.qty) || 1;
        const dir = leg.direction === "long" ? 1 : -1;
        const intrinsic = leg.type === "call" ? Math.max(0, price - K) : Math.max(0, K - price);
        totalPnl += (intrinsic - premium) * dir * qty;
      });
      return [parseFloat(price.toFixed(2)), parseFloat(totalPnl.toFixed(2))];
    });
  })();

  const maxProfit = Math.max(...pnlData.map(d => d[1]));
  const maxLoss = Math.min(...pnlData.map(d => d[1]));
  const breakevenPoints = pnlData
    .filter((d, i) => i > 0 && Math.sign(pnlData[i - 1][1]) !== Math.sign(d[1]))
    .map(d => d[0].toLocaleString(undefined, { maximumFractionDigits: 0 }));

  const isProfitColor = (val) => val >= 0 ? "#22c55e" : "#ef4444";

  const chartOptions = {
    chart: { type: "area", toolbar: { show: false }, background: "transparent", animations: { enabled: false } },
    theme: { mode: "dark" },
    stroke: { curve: "smooth", width: 2 },
    colors: ["#38bdf8"],
    fill: {
      type: "gradient",
      gradient: {
        colorStops: [
          { offset: 0, color: "#22c55e", opacity: 0.3 },
          { offset: 50, color: "#38bdf8", opacity: 0.1 },
          { offset: 100, color: "#ef4444", opacity: 0.3 }
        ]
      }
    },
    xaxis: { type: "numeric", title: { text: "Underlying Price ($)", style: { color: "#64748b" } }, labels: { style: { colors: "#64748b", fontSize: "10px" }, formatter: v => `$${parseFloat(v).toLocaleString()}` } },
    yaxis: { title: { text: "P&L ($)", style: { color: "#64748b" } }, labels: { style: { colors: "#94a3b8", fontSize: "11px" }, formatter: v => `$${v.toFixed(2)}` } },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4 },
    tooltip: { theme: "dark", x: { formatter: v => `Price: $${parseFloat(v).toLocaleString()}` }, y: { formatter: v => `P&L: $${v.toFixed(2)}` } },
    annotations: {
      xaxis: [{ x: S, borderColor: "#f59e0b", label: { text: "Spot", style: { color: "#f59e0b", background: "transparent" } } }],
      yaxis: [{ y: 0, borderColor: "rgba(255,255,255,0.2)", strokeDashArray: 4 }]
    },
    dataLabels: { enabled: false },
    markers: { size: 0 }
  };

  const saveCalculation = async () => {
    const calc = { symbol, legs, totals, timestamp: new Date().toISOString(), strategy: activeStrategy };
    try {
      const res = await fetch(`${BACKEND_URL}/api/db/options-calculations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calc)
      });
      if (res.ok) {
        setSaveMsg("Saved!");
        setSavedCalculations(prev => [calc, ...prev]);
        setTimeout(() => setSaveMsg(""), 2000);
      }
    } catch {
      // Save locally if endpoint doesn't exist yet
      setSavedCalculations(prev => [calc, ...prev]);
      setSaveMsg("Saved locally!");
      setTimeout(() => setSaveMsg(""), 2000);
    }
  };

  const btnStyle = (active) => ({
    padding: "4px 10px", fontSize: "11px", borderRadius: "6px", cursor: "pointer", border: "none",
    background: active ? "#38bdf8" : "rgba(148,163,184,0.1)",
    color: active ? "#000" : "#94a3b8", fontWeight: active ? 700 : 400
  });

  return (
    <div className="options-calculator" style={{ marginTop: "32px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "24px" }}>
      <h2 className="options-calculator-title" style={{ margin: "0 0 20px", fontSize: "18px", fontWeight: 500, color: "var(--color-text-primary)" }}>
        Options Calculator
      </h2>

      <div className="options-calculator-layout" style={{ marginBottom: "16px" }}>
        <div className="options-calculator-side">
          <div className="watchlist-panel glass options-calculator-symbol-panel" style={{ padding: "16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Symbol</p>
            <div style={{ position: "relative" }}>
              <input
                value={symbolSearch}
                onChange={e => { setSymbolSearch(e.target.value); setShowSymbolDropdown(true); }}
                onFocus={() => setShowSymbolDropdown(true)}
                onBlur={() => setTimeout(() => setShowSymbolDropdown(false), 150)}
                placeholder="Search symbol..."
                className="options-calculator-symbol-input"
                style={{ width: "100%", padding: "8px 12px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(148,163,184,0.2)", borderRadius: "8px", color: "#f1f5f9", fontSize: "14px", outline: "none" }}
              />
              {showSymbolDropdown && filteredSymbols.length > 0 && (
                <div
                  className="options-calculator-symbol-dropdown"
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#0f172a",
                    border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: "8px",
                    marginTop: "4px",
                    zIndex: 50,
                    maxHeight: "180px",
                    overflowY: "auto"
                  }}
                >
                  {filteredSymbols.map((s) => (
                    <div
                      className="options-calculator-symbol-option"
                      key={s}
                      onClick={() => {
                        setSymbol(s);
                        setSymbolSearch(s);
                        setShowSymbolDropdown(false);
                        if (onAssetChange) onAssetChange(s);
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,0.08)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = s === symbol ? "rgba(56,189,248,0.1)" : "transparent")}
                      style={{
                        padding: "10px 14px",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: s === symbol ? "#38bdf8" : "#f1f5f9",
                        background: s === symbol ? "rgba(56,189,248,0.1)" : "transparent"
                      }}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="options-calculator-spot-box" style={{ marginTop: "12px", padding: "10px", background: "rgba(56,189,248,0.06)", borderRadius: "8px", border: "1px solid rgba(56,189,248,0.15)" }}>
              <p className="options-calculator-spot-label" style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
                Last Available Price
              </p>
              <p className="options-calculator-spot-value" style={{ margin: "2px 0 0", fontSize: "18px", fontWeight: 700, color: "#38bdf8" }}>
                {Number.isFinite(effectiveSpot) && effectiveSpot > 0 ? `$${effectiveSpot.toLocaleString()}` : "Unavailable"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: "10px", color: "#64748b" }}>
                Source: {spotSource === "lyra" ? "Lyra" : spotSource === "hyperliquid" ? "Hyperliquid (fallback)" : "Unavailable"}
              </p>
            </div>
          </div>

          <div className="watchlist-panel glass options-calculator-strategy-panel" style={{ padding: "16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Strategy Presets</p>
            <div className="options-calculator-strategy-grid">
              {STRATEGIES.map((s) => (
                <button
                  className={`options-calculator-strategy-btn ${activeStrategy === s.name ? "active" : ""}`}
                  key={s.name}
                  onClick={() => applyStrategy(s)}
                  style={{
                    padding: "8px 10px",
                    textAlign: "left",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "12px",
                    lineHeight: 1.35,
                    background: activeStrategy === s.name ? "rgba(56,189,248,0.12)" : "transparent",
                    color: activeStrategy === s.name ? "#38bdf8" : "#94a3b8",
                    borderLeft: activeStrategy === s.name ? "2px solid #38bdf8" : "2px solid transparent",
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={e => { if (activeStrategy !== s.name) { e.currentTarget.style.background = "rgba(148,163,184,0.06)"; e.currentTarget.style.color = "#f1f5f9"; } }}
                  onMouseLeave={e => { if (activeStrategy !== s.name) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; } }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="watchlist-panel glass options-calculator-position-panel" style={{ padding: "16px" }}>
          <div className="options-calculator-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Position Legs</p>
            <button className="options-calculator-add-leg-btn" onClick={addLeg} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "8px", color: "#38bdf8", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              <span style={{ fontSize: "16px", lineHeight: 1 }}>+</span> Add Leg
            </button>
          </div>

          <div className="options-calculator-legs-grid">
            {legs.map((leg, i) => (
              <div key={i} className="options-leg-card">
                <div className="options-leg-header">
                  <div className="options-leg-title">Leg {i + 1}</div>
                  <div className="options-leg-header-actions">
                    <button className="options-leg-link-btn" onClick={() => refreshLeg(i)}>Refresh</button>
                    <button className="options-leg-link-btn danger" onClick={() => removeLeg(i)}>Remove</button>
                  </div>
                </div>

                <div className="options-leg-row two-col">
                  <select
                    value={leg.strike}
                    onChange={e => {
                      const strike = e.target.value;
                      updateLeg(i, "strike", strike);
                      const iv = getChainIV(strike, leg.type);
                      const premium = getChainPremium(strike, leg.type);
                      if (iv) updateLeg(i, "iv", iv);
                      if (premium) updateLeg(i, "premium", premium);
                    }}
                    className="options-leg-input"
                  >
                    <option value="">Amount</option>
                    {getChainStrikes().map(s => (
                      <option key={s} value={s}>{s.toLocaleString()}</option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={leg.expiry}
                    onChange={e => updateLeg(i, "expiry", e.target.value)}
                    className="options-leg-input"
                  />
                </div>

                <div className="options-leg-row two-col">
                  <div className="options-leg-segment">
                    <button
                      className={`options-leg-segment-btn ${leg.type === "call" ? "active positive" : ""}`}
                      onClick={() => updateLeg(i, "type", "call")}
                    >
                      Call
                    </button>
                    <button
                      className={`options-leg-segment-btn ${leg.type === "put" ? "active" : ""}`}
                      onClick={() => updateLeg(i, "type", "put")}
                    >
                      Put
                    </button>
                  </div>

                  <div className="options-leg-segment">
                    <button
                      className={`options-leg-segment-btn ${leg.direction === "long" ? "active" : ""}`}
                      onClick={() => updateLeg(i, "direction", "long")}
                    >
                      Long
                    </button>
                    <button
                      className={`options-leg-segment-btn ${leg.direction === "short" ? "active" : ""}`}
                      onClick={() => updateLeg(i, "direction", "short")}
                    >
                      Short
                    </button>
                  </div>
                </div>

                <div className="options-leg-label-row">
                  <span>Qty</span>
                  <span>Premium</span>
                  <span>IV %</span>
                </div>

                <div className="options-leg-row three-col">
                  <input
                    type="number"
                    value={leg.qty}
                    onChange={e => updateLeg(i, "qty", e.target.value)}
                    min="1"
                    className="options-leg-input"
                  />
                  <input
                    type="number"
                    value={leg.premium}
                    onChange={e => updateLeg(i, "premium", e.target.value)}
                    placeholder="Premium"
                    className="options-leg-input"
                  />
                  <input
                    type="number"
                    value={leg.iv}
                    onChange={e => updateLeg(i, "iv", e.target.value)}
                    placeholder="IV%"
                    className="options-leg-input"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="options-calculator-greeks-grid" style={{ marginTop: "16px", paddingTop: "14px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
            {[
              { label: "Net P&L", value: `$${totals.pnl.toFixed(2)}`, color: isProfitColor(totals.pnl) },
              { label: "Delta", value: totals.delta.toFixed(4), color: totals.delta >= 0 ? "#38bdf8" : "#f59e0b" },
              { label: "Gamma", value: totals.gamma.toFixed(6), color: "#94a3b8" },
              { label: "Theta", value: totals.theta.toFixed(4), color: totals.theta >= 0 ? "#22c55e" : "#ef4444" },
              { label: "Vega", value: totals.vega.toFixed(4), color: "#a78bfa" },
            ].map(({ label, value, color }) => (
              <div className="options-calculator-greek-card" key={label} style={{ background: "rgba(0,0,0,0.3)", borderRadius: "8px", padding: "10px", textAlign: "center" }}>
                <p style={{ margin: "0 0 4px", fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
                <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color }}>{value}</p>
              </div>
            ))}
          </div>

          <div className="options-calculator-save-row" style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
            <button onClick={saveCalculation} style={{ padding: "8px 18px", background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.3)", borderRadius: "8px", color: "#38bdf8", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
              Save Calculation
            </button>
            {saveMsg && <span style={{ fontSize: "12px", color: "#22c55e" }}>{saveMsg}</span>}
          </div>
        </div>
      </div>

      <div className="watchlist-panel glass options-calculator-pnl-panel" style={{ padding: "20px" }}>
        <div className="options-calculator-pnl-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <p style={{ margin: "0 0 4px", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>P&L Diagram</p>
            <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>At expiration - underlying price vs profit/loss</p>
          </div>
          <div className="options-calculator-pnl-stats" style={{ display: "flex", gap: "20px" }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontSize: "10px", color: "#64748b" }}>MAX PROFIT</p>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: maxProfit === Infinity ? "#22c55e" : isProfitColor(maxProfit) }}>
                {maxProfit > 9999 ? "Unlimited" : `$${maxProfit.toFixed(2)}`}
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontSize: "10px", color: "#64748b" }}>MAX LOSS</p>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#ef4444" }}>
                {maxLoss < -9999 ? "Unlimited" : `$${maxLoss.toFixed(2)}`}
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 2px", fontSize: "10px", color: "#64748b" }}>BREAKEVEN</p>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#f59e0b" }}>
                {breakevenPoints.length > 0 ? `$${breakevenPoints.join(" / $")}` : "—"}
              </p>
            </div>
          </div>
        </div>
        <Chart
          options={chartOptions}
          series={[{ name: "P&L", data: pnlData }]}
          type="area"
          height={280}
          width="100%"
        />
      </div>
    </div>
  );
}
