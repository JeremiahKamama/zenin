import { useState, useEffect, useMemo, useRef } from "react";
import OptionsStrategySimulator from "./OptionsStrategySimulator";
import { TradingViewChart } from "./TradingViewChart";
import { zeninFetch } from "../utils/zeninFetch";
import { hasWorkspaceSession } from "../utils/workspacePersistence";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { formatMoney, formatFixed } from "../utils/formatNumbers";
import { formatDateTime } from "../utils/formatDates";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const BACKEND_URL = ZENIN_API_BASE_URL;
const CALCULATIONS_PAGE_SIZE = 10;

function hasStoredAuthToken() {
  try {
    return hasWorkspaceSession();
  } catch {
    return false;
  }
}

function formatCalculationTimestamp(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatNumber(value, digits = 4) {
  return formatFixed(value, digits);
}

function formatLegSummary(leg = {}, index = 0) {
  const side = String(leg.direction || "long").toLowerCase() === "short" ? "Short" : "Long";
  const type = String(leg.type || "call").toLowerCase() === "put" ? "Put" : "Call";
  const qty = Number(leg.qty) || 1;
  const strike = Number(leg.strike);
  const premium = Number(leg.premium);
  const iv = Number(leg.iv);
  const strikeLabel = Number.isFinite(strike) && strike > 0 ? strike.toLocaleString() : "—";
  const premiumLabel = Number.isFinite(premium) && premium > 0 ? formatMoney(premium, 4) : "—";
  const ivLabel = Number.isFinite(iv) && iv > 0 ? `${iv.toFixed(1)}%` : "—";
  const expiryLabel = leg.expiry || "Open";
  return `Leg ${index + 1} · ${side} ${type} · Strike ${strikeLabel} · Qty ${qty} · Premium ${premiumLabel} · IV ${ivLabel} · Exp ${expiryLabel}`;
}

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
  marketStructure = "orderbook",
  marketStructureLabel = "Orderbook",
  marketStructureNote = "" }) {
  const strategies = Array.isArray(getAppRuntimeConfig()?.options?.calculatorStrategies)
    ? getAppRuntimeConfig().options.calculatorStrategies
    : [];
  const emptyLeg = getAppRuntimeConfig()?.options?.emptyLeg || { strike: "", expiry: "", type: "call", direction: "long", qty: 1, premium: "", iv: "" };
  const [symbol, setSymbol] = useState(() => String(activeAsset || "").trim().toUpperCase() || "BTC");
  const [symbolSearch, setSymbolSearch] = useState(() => String(activeAsset || "").trim().toUpperCase() || "BTC");
  const [showSymbolDropdown, setShowSymbolDropdown] = useState(false);
  const [legs, setLegs] = useState([{ ...emptyLeg }]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [savedCalculations, setSavedCalculations] = useState([]);
  const [savedCalculationsOpen, setSavedCalculationsOpen] = useState(false);
  const [savedCalculationsLoading, setSavedCalculationsLoading] = useState(false);
  const [savedCalculationsError, setSavedCalculationsError] = useState("");
  const [savedCalculationsPage, setSavedCalculationsPage] = useState(1);
  const [saveMsg, setSaveMsg] = useState("");
  const [saveMsgType, setSaveMsgType] = useState("success");
  // Live Deribit Greeks per leg
  const [deribitGreeks, setDeribitGreeks] = useState({});
  const [deribitGreeksLoading, setDeribitGreeksLoading] = useState({});
  const normalizedActiveAsset = String(activeAsset || "").trim().toUpperCase();
  const previousActiveAssetRef = useRef(normalizedActiveAsset);
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const isRfqSymbol = normalizedSymbol === "HYPE";
  const isUsingActiveChainAsset = normalizedSymbol === normalizedActiveAsset;
  const filteredChainData = isUsingActiveChainAsset && Array.isArray(chainData) ? chainData : [];
  const deriveSpotFromChain = () => {
    const strikes = filteredChainData
      .map((row) => Number(row?.strike))
      .filter((val) => Number.isFinite(val) && val > 0)
      .sort((a, b) => a - b);
    if (!strikes.length) return null;
    return strikes[Math.floor(strikes.length / 2)];
  };
  const derivedSpot = deriveSpotFromChain();
  const effectiveSpot = isUsingActiveChainAsset && Number(spotPrice) > 0
    ? Number(spotPrice)
    : (Number.isFinite(derivedSpot) ? Number(derivedSpot) : null);
  const hasCalculatorMarketData = isUsingActiveChainAsset && filteredChainData.length > 0 && Number.isFinite(effectiveSpot) && effectiveSpot > 0;
  const isRfqMarket = marketStructure === "rfq" && isUsingActiveChainAsset;
  const S = hasCalculatorMarketData ? effectiveSpot : 0;
  const r = 0.0425;

  useEffect(() => {
    setLegs([{ ...emptyLeg }]);
    setActiveStrategy(null);
    setSavedCalculationsPage(1);
  }, [symbol]);

  useEffect(() => {
    const previousActiveAsset = String(previousActiveAssetRef.current || "").trim().toUpperCase();
    if (!normalizedActiveAsset) {
      previousActiveAssetRef.current = normalizedActiveAsset;
      return;
    }

    setSymbol((prev) => {
      const current = String(prev || "").trim().toUpperCase();
      if (!current || current === previousActiveAsset) {
        return normalizedActiveAsset;
      }
      return prev;
    });
    setSymbolSearch((prev) => {
      const current = String(prev || "").trim().toUpperCase();
      if (!current || current === previousActiveAsset) {
        return normalizedActiveAsset;
      }
      return prev;
    });
    previousActiveAssetRef.current = normalizedActiveAsset;
  }, [normalizedActiveAsset]);

  const normalizedSearch = String(symbolSearch || "").trim().toUpperCase();
  const filteredSymbols = assets.filter((s) =>
    String(s || "").trim().toUpperCase().includes(normalizedSearch)
  );
  const canUseSavedCalculations = hasStoredAuthToken();

  const commitSymbolSelection = (nextSymbol) => {
    const committed = String(nextSymbol || "").trim().toUpperCase();
    if (!committed) return;
    setSymbol(committed);
    setSymbolSearch(committed);
    setShowSymbolDropdown(false);
  };

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
  
  const addLeg = () => setLegs(prev => [...prev, { ...emptyLeg }]);
  const removeLeg = (i) => setLegs(prev => prev.filter((_, idx) => idx !== i));
  const updateLeg = (i, field, value) => setLegs(prev => prev.map((leg, idx) => idx === i ? { ...leg, [field]: value } : leg));
  const updateLegMarketSelection = (i, patch) => {
    setLegs((prev) => prev.map((leg, idx) => {
      if (idx !== i) return leg;
      const nextLeg = { ...leg, ...patch };
      if (!nextLeg.strike) return nextLeg;
      const iv = getChainIV(nextLeg.strike, nextLeg.type);
      const premium = getChainPremium(nextLeg.strike, nextLeg.type);
      return {
        ...nextLeg,
        iv: iv || nextLeg.iv,
        premium: premium || nextLeg.premium
      };
    }));
  };
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

  // Fetch live Deribit Greeks when expiry date is selected for a leg
  const fetchDeribitGreeksForLeg = async (i, leg) => {
    if (!leg.expiry || !leg.strike || !normalizedSymbol) return;
    // Convert YYYY-MM-DD → DDMMMYY format for Deribit (e.g. 2024-06-28 → 28JUN24)
    const d = new Date(leg.expiry);
    if (isNaN(d.getTime())) return;
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const deribitExpiry = `${d.getDate()}${months[d.getMonth()]}${String(d.getFullYear()).slice(2)}`;
    const cacheKey = `${i}-${normalizedSymbol}-${deribitExpiry}-${leg.strike}-${leg.type}`;

    setDeribitGreeksLoading(prev => ({ ...prev, [i]: true }));
    try {
      const params = new URLSearchParams({
        symbol: normalizedSymbol, expiry: deribitExpiry, strike: leg.strike, type: leg.type === "put" ? "P" : "C"
      });
      const res = await zeninFetch(`/greeks?${params.toString()}`);
      if (!res.ok) throw new Error("Greeks fetch failed");
      const data = await res.json();
      if (!data.stale && data.mark !== null) {
        setDeribitGreeks(prev => ({ ...prev, [cacheKey]: data }));
        // Inject live values into the leg
        setLegs(prev => prev.map((l, idx) => {
          if (idx !== i) return l;
          return {
            ...l,
            premium: data.mark != null ? String(data.mark) : l.premium,
            iv: data.iv != null ? String(Number(data.iv).toFixed(1)) : l.iv
          };
        }));
      }
    } catch (error) {
      console.warn("[OptionsCalc] Deribit Greeks fetch failed:", error?.message || error);
    } finally {
      setDeribitGreeksLoading(prev => ({ ...prev, [i]: false }));
    }
  };

  const applyStrategy = (strategy) => {
    setActiveStrategy(strategy.name);
    setLegs(strategy.legs.map(l => ({ ...emptyLeg, ...l })));
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
    .map(d => Number(d[0].toFixed(2)));
  const hasConfiguredLegs = legs.some((leg) => Number.isFinite(Number(leg.strike)) && Number(leg.strike) > 0);
  const totalSavedCalculationsPages = Math.max(1, Math.ceil(savedCalculations.length / CALCULATIONS_PAGE_SIZE));
  const pagedSavedCalculations = savedCalculations.slice(
    (savedCalculationsPage - 1) * CALCULATIONS_PAGE_SIZE,
    savedCalculationsPage * CALCULATIONS_PAGE_SIZE
  );

  const isProfitColor = (val) => val >= 0 ? "#22c55e" : "#ef4444";

  const payoffTimeScale = 100;
  const payoffChartOptions = useMemo(() => ({
    tickMarkFormatter: (time) => `$${(Number(time) / payoffTimeScale).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.14, bottom: 0.14 }
    }
  }), []);
  const payoffSeriesData = pnlData.map(([price, pnl]) => ({
    time: Math.max(1, Math.round(Number(price) * payoffTimeScale)),
    value: Number(pnl),
    price: Number(price)
  }));
  const payoffChartSeries = [{
    name: "P&L",
    type: "area",
    color: "#38bdf8",
    data: payoffSeriesData,
    options: {
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: (value) => `$${Number(value).toFixed(2)}`
      }
    }
  }];
  const spotPayoffPoint = payoffSeriesData.reduce((closest, point) => {
    if (!closest) return point;
    return Math.abs(point.price - S) < Math.abs(closest.price - S) ? point : closest;
  }, null);
  const payoffMarkers = [
    spotPayoffPoint ? {
      time: spotPayoffPoint.time,
      position: "atPriceMiddle",
      price: spotPayoffPoint.value,
      shape: "circle",
      color: "#f59e0b",
      text: "Spot"
    } : null,
    ...breakevenPoints.map((point) => ({
      time: Math.max(1, Math.round(Number(point) * payoffTimeScale)),
      position: "atPriceMiddle",
      price: 0,
      shape: "circle",
      color: "#22d3ee",
      text: "BE"
    }))
  ].filter(Boolean);
  const payoffPriceLines = [
    { id: "zero", price: 0, title: "Break-even", color: "rgba(148,163,184,0.7)" },
    Number.isFinite(maxProfit) && maxProfit > 0 && maxProfit < 9999 ? { id: "max-profit", price: maxProfit, title: "Max profit", color: "rgba(34,197,94,0.7)" } : null,
    Number.isFinite(maxLoss) && maxLoss < 0 && maxLoss > -9999 ? { id: "max-loss", price: maxLoss, title: "Max loss", color: "rgba(239,68,68,0.7)" } : null
  ].filter(Boolean);

  useEffect(() => {
    if (savedCalculationsPage > totalSavedCalculationsPages) {
      setSavedCalculationsPage(totalSavedCalculationsPages);
    }
  }, [savedCalculationsPage, totalSavedCalculationsPages]);

  useEffect(() => {
    if (!normalizedSymbol) {
      setSavedCalculations([]);
      setSavedCalculationsError("");
      setSavedCalculationsLoading(false);
      return undefined;
    }

    if (!canUseSavedCalculations) {
      setSavedCalculations([]);
      setSavedCalculationsError("");
      setSavedCalculationsLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let ignore = false;

    const loadSavedCalculations = async () => {
      setSavedCalculationsLoading(true);
      setSavedCalculationsError("");
      try {
        const params = new URLSearchParams({
          symbol: normalizedSymbol,
          limit: "100"
        });
        const res = await zeninFetch(`/db/options-calculations?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (ignore) return;
        setSavedCalculations(Array.isArray(data?.calculations) ? data.calculations : []);
      } catch (error) {
        if (ignore || error?.name === "AbortError") return;
        setSavedCalculations([]);
        setSavedCalculationsError("Unable to load saved calculations right now.");
      } finally {
        if (!ignore) setSavedCalculationsLoading(false);
      }
    };

    loadSavedCalculations();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [normalizedSymbol, canUseSavedCalculations]);

  const saveCalculation = async () => {
    if (!canUseSavedCalculations) {
      setSaveMsgType("error");
      setSaveMsg("Sign in to save calculations.");
      setTimeout(() => setSaveMsg(""), 2500);
      return;
    }
    if (!normalizedSymbol) {
      setSaveMsgType("error");
      setSaveMsg("Search for an asset before saving.");
      setTimeout(() => setSaveMsg(""), 2500);
      return;
    }
    if (!hasConfiguredLegs) {
      setSaveMsgType("error");
      setSaveMsg("Add at least one strike before saving.");
      setTimeout(() => setSaveMsg(""), 2500);
      return;
    }
    const calc = {
      symbol: normalizedSymbol,
      strategy: activeStrategy || "Custom",
      netPnl: Number(totals.pnl.toFixed(4)),
      delta: Number(totals.delta.toFixed(6)),
      gamma: Number(totals.gamma.toFixed(6)),
      theta: Number(totals.theta.toFixed(6)),
      vega: Number(totals.vega.toFixed(6)),
      maxProfit: Number.isFinite(maxProfit) ? Number(maxProfit.toFixed(2)) : null,
      maxLoss: Number.isFinite(maxLoss) ? Number(maxLoss.toFixed(2)) : null,
      breakevens: breakevenPoints,
      legs: legs.map((leg) => ({
        strike: Number.isFinite(Number(leg.strike)) ? Number(leg.strike) : null,
        expiry: leg.expiry || null,
        type: String(leg.type || "call").toLowerCase() === "put" ? "put" : "call",
        direction: String(leg.direction || "long").toLowerCase() === "short" ? "short" : "long",
        qty: Math.max(1, Number(leg.qty) || 1),
        premium: Number.isFinite(Number(leg.premium)) ? Number(leg.premium) : 0,
        iv: Number.isFinite(Number(leg.iv)) ? Number(leg.iv) : 0
      })),
      createdAt: new Date().toISOString()
    };
    try {
      const res = await zeninFetch("/db/options-calculations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calc)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const savedRecord = await res.json();
      const normalizedRecord = {
        ...savedRecord,
        legs: Array.isArray(savedRecord?.legs) ? savedRecord.legs : calc.legs,
        breakevens: Array.isArray(savedRecord?.breakevens) ? savedRecord.breakevens : calc.breakevens
      };
      setSaveMsgType("success");
      setSaveMsg("Calculation saved. Opening saved calculations…");
      setSavedCalculations((prev) => [normalizedRecord, ...prev.filter((row) => row?.id !== normalizedRecord?.id)]);
      setSavedCalculationsPage(1);
      setSavedCalculationsOpen(true);
      setTimeout(() => setSaveMsg(""), 2000);
    } catch {
      setSaveMsgType("error");
      setSaveMsg("Save failed. Please try again.");
      setTimeout(() => setSaveMsg(""), 2500);
    }
  };

  return (
    <div className="options-calculator options-exec-calculator" style={{ marginTop: "32px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "24px" }}>
      <h2 className="options-calculator-title" style={{ margin: "0 0 20px", fontSize: "18px", fontWeight: 500, color: "var(--color-text-primary)" }}>
        Options Calculator
      </h2>

      <div className="options-calculator-layout" style={{ marginBottom: "16px" }}>
        <div className="options-calculator-side">
          <div className="watchlist-panel glass options-calculator-symbol-panel options-exec-panel" style={{ padding: "16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Symbol</p>
            {isRfqSymbol ? (
              <div className="options-calculator-mode-pill rfq" style={{ marginBottom: "10px" }}>
                RFQ market
              </div>
            ) : null}
            <div style={{ position: "relative" }}>
              <input
                value={symbolSearch}
                onChange={e => { setSymbolSearch(e.target.value.toUpperCase()); setShowSymbolDropdown(true); }}
                onFocus={() => setShowSymbolDropdown(true)}
                onBlur={() => setTimeout(() => {
                  setShowSymbolDropdown(false);
                  commitSymbolSelection(symbolSearch);
                }, 150)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSymbolSelection(symbolSearch);
                  }
                }}
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
                    <button
                      type="button"
                      className="options-calculator-symbol-option"
                      key={s}
                      onClick={() => {
                        commitSymbolSelection(s);
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(148,163,184,0.08)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = s === symbol ? "rgba(56,189,248,0.1)" : "transparent")}
                      style={{
                        padding: "10px 14px",
                        width: "100%",
                        border: "none",
                        textAlign: "left",
                        cursor: "pointer",
                        fontSize: "14px",
                        color: s === symbol ? "#38bdf8" : "#f1f5f9",
                        background: s === symbol ? "rgba(56,189,248,0.1)" : "transparent"
                      }}
                    >
                      {s}
                    </button>
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
              {isRfqMarket ? (
                <p style={{ margin: "2px 0 0", fontSize: "10px", color: "#fbbf24" }}>
                  Market mode: {marketStructureLabel}. {marketStructureNote || "A full ladder snapshot may not be available for every quote."}
                </p>
              ) : null}
            </div>
            {!hasCalculatorMarketData ? (
              <p style={{ margin: "10px 0 0", fontSize: "11px", lineHeight: 1.45, color: "#f59e0b" }}>
                {isRfqSymbol
                  ? `${normalizedSymbol} is currently exposed through RFQ on Derive, so prefilled strikes, IV, and premiums may be sparse here. Switch the chain asset to ${normalizedSymbol} or search another asset for a full ladder-driven calculation.`
                  : `No options market data is available for ${normalizedSymbol || "this asset"} right now. Search another asset to continue calculations.`}
              </p>
            ) : null}
          </div>

          <div className="watchlist-panel glass options-calculator-strategy-panel options-exec-panel" style={{ padding: "16px" }}>
            <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Strategy Presets</p>
            <div className="options-calculator-strategy-grid">
              {strategies.map((s) => (
                <button
                  type="button"
                  className={`options-calculator-strategy-btn ${activeStrategy === s.name ? "active" : ""}`}
                  key={s.name}
                  onClick={() => applyStrategy(s)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="watchlist-panel glass options-calculator-position-panel options-exec-panel" style={{ padding: "16px" }}>
          <div className="options-calculator-section-head">
            <p className="options-calculator-section-kicker">Position Legs</p>
            <button type="button" className="options-calculator-add-leg-btn" onClick={addLeg}>
              <span className="options-calculator-add-leg-icon">+</span> Add Leg
            </button>
          </div>

          <div className="options-calculator-legs-grid">
            {legs.map((leg, i) => (
              <div key={i} className="options-leg-card">
                <div className="options-leg-header">
                  <div className="options-leg-title">Leg {i + 1}</div>
                  <div className="options-leg-header-actions">
                    <button type="button" className="options-leg-link-btn" onClick={() => refreshLeg(i)}>Refresh</button>
                    <button type="button" className="options-leg-link-btn danger" onClick={() => removeLeg(i)}>Remove</button>
                  </div>
                </div>

                <div className="options-leg-row two-col">
                  <input
                    type="number"
                    list={`strikes-${i}`}
                    value={leg.strike}
                    onChange={e => {
                      const strike = e.target.value;
                      updateLegMarketSelection(i, { strike });
                    }}
                    placeholder="Strike"
                    className="options-leg-input"
                  />
                  <datalist id={`strikes-${i}`}>
                    {getChainStrikes().map(s => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <div
                    style={{ position: 'relative' }}
                  >
                    <input
                      type="date"
                      value={leg.expiry}
                      onChange={e => {
                        const val = e.target.value;
                        updateLeg(i, "expiry", val);
                        // Trigger live Deribit Greeks fetch when date is selected
                        const updatedLeg = { ...leg, expiry: val };
                        fetchDeribitGreeksForLeg(i, updatedLeg);
                      }}
                      className="options-leg-input"
                    />
                    {deribitGreeksLoading[i] && (
                      <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#38bdf8', pointerEvents: 'none' }}>⟳ Deribit</span>
                    )}
                  </div>
                </div>

                <div className="options-leg-row two-col">
                  <div className="options-leg-segment">
                    <button
                      type="button"
                      className={`options-leg-segment-btn ${leg.type === "call" ? "active info" : ""}`}
                      aria-pressed={leg.type === "call"}
                      onClick={() => updateLegMarketSelection(i, { type: "call" })}
                    >
                      Call
                    </button>
                    <button
                      type="button"
                      className={`options-leg-segment-btn ${leg.type === "put" ? "active negative" : ""}`}
                      aria-pressed={leg.type === "put"}
                      onClick={() => updateLegMarketSelection(i, { type: "put" })}
                    >
                      Put
                    </button>
                  </div>

                  <div className="options-leg-segment">
                    <button
                      type="button"
                      className={`options-leg-segment-btn ${leg.direction === "long" ? "active positive" : ""}`}
                      aria-pressed={leg.direction === "long"}
                      onClick={() => updateLeg(i, "direction", "long")}
                    >
                      Long
                    </button>
                    <button
                      type="button"
                      className={`options-leg-segment-btn ${leg.direction === "short" ? "active negative" : ""}`}
                      aria-pressed={leg.direction === "short"}
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

          <div className="options-calculator-save-row" style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <button type="button" onClick={saveCalculation} className="options-calculator-action-btn primary">
                Save Calculation
              </button>
              <button
                type="button"
                onClick={() => setSavedCalculationsOpen(true)}
                className="options-calculator-action-btn secondary"
                disabled={!canUseSavedCalculations}
                title={!canUseSavedCalculations ? "Sign in to view saved calculations" : "Open saved calculations"}
              >
                Saved Calculations
              </button>
        
              {saveMsg && (
                <span className={`options-calculator-save-message ${saveMsgType === "error" ? "error" : "success"}`}>
                  {saveMsg}
                </span>
              )}
            </div>

        </div>
      </div>

      <div className="watchlist-panel glass options-calculator-pnl-panel options-exec-panel options-exec-pnl-panel" style={{ padding: "20px" }}>
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
                {breakevenPoints.length > 0 ? `$${breakevenPoints.map((point) => point.toLocaleString()).join(" / $")}` : "—"}
              </p>
            </div>
          </div>
        </div>
        {hasCalculatorMarketData ? (
          <TradingViewChart
            options={payoffChartOptions}
            series={payoffChartSeries}
            priceLines={payoffPriceLines}
            tradeMarkers={payoffMarkers}
            valueFormatter={(value) => `$${Number(value).toFixed(2)}`}
            timeFormatter={(time) => `Price $${(Number(time) / payoffTimeScale).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            height={280}
            width="100%"
          />
        ) : (
          <div className="chart-no-data" style={{ minHeight: "220px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            Search another asset with available options market data to plot the calculator.
          </div>
        )}
      </div>

      {savedCalculationsOpen ? (
        <div className="modal-overlay" onClick={() => setSavedCalculationsOpen(false)}>
          <div className="modal-content options-calculation-history-modal" onClick={(event) => event.stopPropagation()} style={{ width: "95%", maxWidth: "1200px", padding: "24px", overflowX: "auto" }}>
            <div className="options-calculation-history-head">
              <div>
                <p className="options-calculation-history-kicker">Saved Calculations</p>
                <h3>{normalizedSymbol || "Selected Asset"} Calculation History</h3>
                <p className="options-calculation-history-subtitle">Position legs and outputs saved to the database for this symbol.</p>
              </div>
              <button type="button" className="options-leg-link-btn" onClick={() => setSavedCalculationsOpen(false)}>
                Close
              </button>
            </div>

            {savedCalculationsLoading ? (
              <div className="loading-state" style={{ marginTop: "8px" }}>Loading saved calculations...</div>
            ) : savedCalculationsError ? (
              <div className="loading-state" style={{ marginTop: "8px", color: "#f59e0b" }}>{savedCalculationsError}</div>
            ) : savedCalculations.length === 0 ? (
              <div className="loading-state" style={{ marginTop: "8px" }}>No saved calculations for {normalizedSymbol || "this asset"} yet.</div>
            ) : (
              <>
                <div className="table-scroll options-calculation-history-scroll">
                  <table className="option-chain-table options-calculation-history-table">
                    <thead>
                      <tr>
                        <th>Saved</th>
                        <th>Strategy</th>
                        <th>Position Legs</th>
                        <th>Breakevens</th>
                        <th>Net P&amp;L</th>
                        <th>Delta</th>
                        <th>Gamma</th>
                        <th>Theta</th>
                        <th>Vega</th>
                        <th>Max Profit</th>
                        <th>Max Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSavedCalculations.map((calc) => (
                        <tr key={calc.id || calc.created_at || calc.createdAt}>
                          <td className="greek">{formatCalculationTimestamp(calc.created_at || calc.createdAt)}</td>
                          <td className="greek">{calc.strategy || "Custom"}</td>
                          <td>
                            <div className="options-calculation-leg-list">
                              {(Array.isArray(calc.legs) ? calc.legs : []).map((leg, index) => (
                                <div key={`${calc.id || calc.created_at || calc.createdAt}-leg-${index}`} className="options-calculation-leg-item">
                                  {formatLegSummary(leg, index)}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td className="greek">
                            {Array.isArray(calc.breakevens) && calc.breakevens.length > 0
                              ? calc.breakevens.map((point) => formatMoney(point, 2)).join(" / ")
                              : "—"}
                          </td>
                          <td className={Number(calc.net_pnl ?? calc.netPnl) >= 0 ? "bid-ask positive" : "bid-ask negative"}>
                            {formatMoney(calc.net_pnl ?? calc.netPnl)}
                          </td>
                          <td className="greek">{formatNumber(calc.delta, 4)}</td>
                          <td className="greek">{formatNumber(calc.gamma, 6)}</td>
                          <td className="greek">{formatNumber(calc.theta, 4)}</td>
                          <td className="greek">{formatNumber(calc.vega, 4)}</td>
                          <td className="bid-ask positive">{formatMoney(calc.max_profit ?? calc.maxProfit)}</td>
                          <td className="bid-ask negative">{formatMoney(calc.max_loss ?? calc.maxLoss)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalSavedCalculationsPages > 1 ? (
                  <div className="pagination-controls" style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="pagination-button"
                      disabled={savedCalculationsPage === 1}
                      onClick={() => setSavedCalculationsPage((page) => Math.max(1, page - 1))}
                    >
                      Previous
                    </button>
                    <div className="pagination-label">
                      Page {savedCalculationsPage} of {totalSavedCalculationsPages}
                    </div>
                    <button
                      type="button"
                      className="pagination-button"
                      disabled={savedCalculationsPage === totalSavedCalculationsPages}
                      onClick={() => setSavedCalculationsPage((page) => Math.min(totalSavedCalculationsPages, page + 1))}
                    >
                      Next
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
