import { useState, useEffect, useMemo } from "react";
import { TradingViewChart } from "./TradingViewChart";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getCurrencySymbol } from "../utils/currencyUtils";
import { ZENIN_API_BASE_URL } from "../utils/zeninFetch";
const BACKEND_URL = ZENIN_API_BASE_URL;

const INTERVALS = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];
const EARNINGS_FUNDAMENTALS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function AssetModal({ asset, onClose, onConfirm, isInWatchlist, onToggleStar, onViewCompanyProfile, portfolio = [], balance = 0, trades = [] }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyStale, setHistoryStale] = useState(false);
  const [activeInterval, setActiveInterval] = useState("1D");
  const [historySource, setHistorySource] = useState("");
  const [orderType, setOrderType] = useState(() => asset?._forceSell ? "sell" : "buy");
  const [earnings, setEarnings] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsStale, setEarningsStale] = useState(false);
  const [finvizData, setFinvizData] = useState(null);
  const [finvizLoading, setFinvizLoading] = useState(false);
  const [finvizError, setFinvizError] = useState("");
  const [fetchedCurrency, setFetchedCurrency] = useState(null);

  const normalizeAssetKind = (value) => {
    const rawType = String(value?.type || "").trim().toLowerCase();
    const rawCategory = String(value?.category || "").trim().toLowerCase();
    const marketType = String(value?.marketType || "").trim().toLowerCase();
    if (["stock", "stocks", "equity"].includes(rawType)) return "stock";
    if (["etf", "etfs"].includes(rawType)) return "etf";
    if (rawType === "crypto" || marketType === "spot" || marketType === "perp") return "crypto";
    if (rawType === "indicator" || rawCategory === "indicators" || marketType === "macro") return "indicator";
    if (rawType === "bond" || rawCategory === "bonds") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(rawType) || ["commodities", "metals"].includes(rawCategory)) return "commodity";
    if (marketType === "equity") return "stock";
    if (value?.theme || rawCategory === "stocks") return "stock";
    return rawType || "stock";
  };

  const normalizedMarketType = String(asset?.marketType || "").toLowerCase();
  const normalizedAssetKind = normalizeAssetKind(asset);
  const isCryptoAsset = normalizedAssetKind === "crypto";
  const isTradFi = Boolean(asset) && !isCryptoAsset;
  const assetSymbol = String(asset?.symbol || "").toUpperCase();
  const assetType = normalizedAssetKind === "stock" || normalizedAssetKind === "etf"
    ? "stock"
    : normalizedAssetKind === "crypto"
      ? "crypto"
      : asset?.type || normalizedAssetKind;
  const isStockResearchEligible = normalizedAssetKind === "stock";

  const [chartType, setChartType] = useState("line");

  const [quantity, setQuantity] = useState(() =>  {
    if (!asset?._forceSell) return 1;
    const holding = (portfolio || []).find(
      p => p.symbol === asset?.symbol &&
      (p.marketType || "spot") === (asset?.marketType || "spot")
    );
    return holding?.quantity || 1;
  });

  const [performanceMap, setPerformanceMap] = useState({});
  const [liveQuote, setLiveQuote] = useState({ price: null, priceChangePercent: null });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showFireworks, setShowFireworks] = useState(false);
  const isCacheFresh = (cacheEntry, ttlMs) => {
    if (!cacheEntry?.updatedAt) return false;
    const updatedAtMs = new Date(cacheEntry.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < ttlMs;
  };

  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      if (!assetSymbol) return;
      const cacheParams = { symbol: assetSymbol, type: assetType, interval: activeInterval };
      const cached = readResilientCache("asset-history", cacheParams);
      if (cached?.payload) {
        const cachedHistory = Array.isArray(cached.payload?.history) ? cached.payload.history : [];
        if (cachedHistory.length > 0) {
          setHistory(cachedHistory);
          setHistorySource(String(cached.payload?.source || ""));
          setHistoryStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
          setLoading(false);
        }
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams({
          symbol: assetSymbol,
          type: assetType,
          interval: activeInterval
        });
        const res = await fetch(`${BACKEND_URL}/history?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        const nextHistory = Array.isArray(data?.history) ? data.history : [];
        const nextSource = String(data?.source || "");
        if (data?.currency) setFetchedCurrency(data.currency);
        setHistory(nextHistory);
        setHistorySource(nextSource);
        setHistoryStale(Boolean(data?.stale || data?.unavailable));
        writeResilientCache("asset-history", cacheParams, data || {
          history: nextHistory,
          source: nextSource
        });
      } catch (err) {
        if (cancelled) return;
        console.warn("Asset history unavailable; using cached or local context.", err);
        if (cached?.payload) {
          const cachedHistory = Array.isArray(cached.payload?.history) ? cached.payload.history : [];
          if (cachedHistory.length > 0) {
            setHistory(cachedHistory);
            setHistorySource(String(cached.payload?.source || ""));
          }
        }
        setHistoryStale(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [activeInterval, assetSymbol, assetType]);

  useEffect(() => {
    setLiveQuote({ price: null, priceChangePercent: null });
  }, [assetSymbol, assetType]);

  useEffect(() => {
    if (!assetSymbol) return;
    const hasPrice = Number.isFinite(Number(asset?.price));
    const hasChange = Number.isFinite(Number(asset?.priceChangePercent));
    if (hasPrice && hasChange) return;
    let cancelled = false;

    const fetchQuote = async () => {
      try {
        const quoteType = assetType === "crypto" ? "crypto" : "tradfi";
        const params = new URLSearchParams({ type: quoteType, symbols: assetSymbol });
        const res = await fetch(`${BACKEND_URL}/prices?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        const row = data?.prices?.[assetSymbol] || data?.[assetSymbol] || null;
        const price = Number(row?.price);
        const priceChangePercent = Number(row?.priceChangePercent);
        if (row?.currency) setFetchedCurrency(row.currency);
        setLiveQuote({
          price: Number.isFinite(price) ? price : null,
          priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
        });
      } catch {
        if (cancelled) return;
      }
    };

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [asset?.price, asset?.priceChangePercent, assetSymbol, assetType]);

  useEffect(() => {
    let cancelled = false;
    const fetchPerformance = async () => {
      if (!assetSymbol) return;
      const cacheParams = { symbol: assetSymbol, type: assetType };
      const cached = readResilientCache("asset-performance", cacheParams);
      if (cached?.payload && cached.payload?.performance && typeof cached.payload.performance === "object") {
        setPerformanceMap(cached.payload.performance);
      }
      try {
        const params = new URLSearchParams({ symbol: assetSymbol, type: assetType });
        const res = await fetch(`${BACKEND_URL}/interval-performance?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        const performance = data?.performance && typeof data.performance === "object" ? data.performance : {};
        setPerformanceMap(performance);
        writeResilientCache("asset-performance", cacheParams, { performance });
      } catch (err) {
        if (cancelled) return;
        console.warn("Performance summary unavailable; using local context.", err);
      }
    };

    fetchPerformance();
    return () => {
      cancelled = true;
    };
  }, [assetSymbol, assetType]);

  useEffect(() => {
    if (!isTradFi || !assetSymbol) {
      setEarnings(null);
      setEarningsLoading(false);
      setEarningsStale(false);
      return;
    }
    const controller = new AbortController();
    const fetchEarnings = async () => {
      const cacheParams = { symbol: assetSymbol };
      const cached = readResilientCache("asset-fundamentals", cacheParams);
      const cacheIsFresh = isCacheFresh(cached, EARNINGS_FUNDAMENTALS_CACHE_TTL_MS);
      if (cached?.payload && typeof cached.payload === "object") {
        setEarnings(cached.payload);
        setEarningsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
        if (cacheIsFresh && !cached.payload?.stale && !cached.payload?.unavailable) {
          setEarningsLoading(false);
          return;
        }
      }
      setEarningsLoading(true);
      try {
        const params = new URLSearchParams({ symbol: assetSymbol });
        const res = await fetch(`${BACKEND_URL}/earnings?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok || data?.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (data && typeof data === "object") {
          setEarnings(data);
          setEarningsStale(Boolean(data?.stale || data?.unavailable));
          writeResilientCache("asset-fundamentals", cacheParams, data);
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        const hasCached = cached?.payload && typeof cached.payload === "object";
        if (hasCached) {
          setEarnings(cached.payload);
        } else {
          setEarnings({
            symbol: assetSymbol,
            nextEarnings: null,
            stale: true,
            unavailable: true,
            stale_reason: "earnings_temporarily_unavailable"
          });
          console.warn("Earnings endpoint unavailable for symbol:", assetSymbol);
        }
        setEarningsStale(true);
      } finally {
        if (!controller.signal.aborted) setEarningsLoading(false);
      }
    };

    fetchEarnings();
    return () => controller.abort();
  }, [isTradFi, assetSymbol]);

  const displayedPrice = Number.isFinite(Number(asset?.price))
    ? Number(asset.price)
    : Number.isFinite(Number(liveQuote.price))
      ? Number(liveQuote.price)
      : (() => {
          const lastPoint = [...history].reverse().find((row) => Number.isFinite(Number(row?.close ?? row?.price)));
          const fallback = Number(lastPoint?.close ?? lastPoint?.price);
          return Number.isFinite(fallback) ? fallback : 0;
        })();

  // Resolve display currency symbol from asset metadata
  const activeCurrency = fetchedCurrency || asset?.currency || asset?.quotedCurrency || "USD";
  const currencySymbol = getCurrencySymbol(activeCurrency);

  const displayedChangePercent = Number.isFinite(Number(asset?.priceChangePercent))
    ? Number(asset.priceChangePercent)
    : Number.isFinite(Number(liveQuote.priceChangePercent))
      ? Number(liveQuote.priceChangePercent)
      : 0;

  const displayedChangeValue = (() => {
    if (Number.isFinite(Number(asset?.priceChangeValue))) return Number(asset.priceChangeValue);
    if (Number.isFinite(Number(liveQuote.priceChangeValue))) return Number(liveQuote.priceChangeValue);
    // Rough estimate from percent if absolute value is missing
    return (displayedPrice * (displayedChangePercent / 100)) / (1 + displayedChangePercent / 100);
  })();

  useEffect(() => {
    if (!isTradFi || !assetSymbol) return;
    
    const fetchFinviz = async () => {
      setFinvizLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/finviz?symbol=${assetSymbol}`);
        const data = await res.json();
        if (data && !data.error) {
          setFinvizData(data);
        }
      } catch (err) {
        console.warn("Finviz data unavailable; showing fundamentals fallback.", err);
      } finally {
        setFinvizLoading(false);
      }
    };

    fetchFinviz();
  }, [isTradFi, assetSymbol]);

  const chartRange = useMemo(() => {
    if (!history || history.length === 0) return null;
    const start = history[0].time;
    const end = history[history.length - 1].time;
    
    const formatDate = (t) => {
      if (!t) return "";
      const date = new Date(t);
      if (isNaN(date.getTime())) {
        const numeric = Number(t);
        const d = new Date(numeric > 10000000000 ? numeric : numeric * 1000);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      }
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    return {
      start: formatDate(start),
      end: formatDate(end)
    };
  }, [history]);

  const totalValue = displayedPrice * (quantity || 0);
  const availableBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const insufficientBalance = orderType === "buy" && totalValue > availableBalance;
  const confettiPieces = useMemo(() => Array.from({ length: 26 }, (_, i) => i), []);
  const fireworkBursts = useMemo(() => Array.from({ length: 18 }, (_, i) => i), []);

  const playKaching = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const notes = [880, 1320, 1760];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015 + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + idx * 0.025);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.03);
        osc.stop(now + 0.22 + idx * 0.03);
      });
      setTimeout(() => ctx.close().catch(() => {}), 380);
    } catch {
      // no-op for unsupported environments
    }
  };

  const triggerInsufficientFeedback = () => {
    setShake(true);
    setTimeout(() => setShake(false), 560);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([90, 55, 90]);
    }
  };

  const handleConfirmOrder = async () => {
    if (isSubmitting || quantity <= 0) return;
    setIsSubmitting(true);
    const result = await onConfirm?.(cleanAsset, quantity, orderType);
    setIsSubmitting(false);

    if (!result?.ok) {
      if (result?.reason === "insufficient_balance") {
        triggerInsufficientFeedback();
      }
      return;
    }

    if (result?.action === "buy") {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1200);
      setTimeout(() => onClose?.(), 900);
      return;
    }

    if (result?.action === "sell") {
      playKaching();
      setShowFireworks(true);
      setTimeout(() => setShowFireworks(false), 1200);
      setTimeout(() => onClose?.(), 950);
      return;
    }

    onClose?.();
  };

  const chartData = useMemo(() => {
    const normalizeTime = (row) => {
      const candidate = row?.time ?? row?.date ?? row?.datetime ?? null;
      if (candidate == null) return null;
      const parsed = typeof candidate === "number" ? candidate : new Date(candidate).getTime();
      if (!Number.isFinite(parsed)) return null;
      return parsed > 10000000000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
    };

    if (chartType === "candlestick") {
      return [{
        name: "Price",
        type: "candlestick",
        data: history.map(h => ({
          time: normalizeTime(h),
          open: Number(h.open),
          high: Number(h.high),
          low: Number(h.low),
          close: Number(h.close)
        })).filter((row) => row.time != null && [row.open, row.high, row.low, row.close].every(Number.isFinite))
      }];
    }
    return [{
      name: "Price",
      type: "area",
      color: "#38bdf8",
      data: history.map(h => ({
        time: normalizeTime(h),
        value: Number(h.close || h.price)
      })).filter((row) => row.time != null && Number.isFinite(row.value))
    }];
  }, [history, chartType]);

  const tradeMarkers = useMemo(() => {
    const markerSymbol = String(assetSymbol || "").trim().toUpperCase();
    if (!markerSymbol || !Array.isArray(trades) || trades.length === 0) return [];

    return trades
      .filter((trade) => String(trade?.asset || trade?.symbol || "").trim().toUpperCase() === markerSymbol)
      .map((trade) => {
        const timestamp = trade?.executedAt || trade?.executed_at || trade?.date || trade?.createdAt || trade?.timestamp;
        const parsed = timestamp ? new Date(timestamp).getTime() : NaN;
        if (!Number.isFinite(parsed)) return null;
        const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
        const price = Number(trade?.price);
        const priceText = Number.isFinite(price)
          ? `${activeCurrency === "USD" ? "$" : ""}${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "";
        const label = `${side === "sell" ? "SELL" : "BUY"}${priceText ? ` ${priceText}` : ""}`;
        return {
          time: Math.floor(parsed / 1000),
          position: side === "sell" ? "aboveBar" : "belowBar",
          shape: side === "sell" ? "arrowDown" : "arrowUp",
          color: side === "sell" ? "#ef4444" : "#22c55e",
          text: label,
        };
      })
      .filter(Boolean);
  }, [activeCurrency, assetSymbol, trades]);

  // Stable empty options — TradingViewChart uses LightweightCharts internally,
  // not ApexCharts. Passing a stable ref prevents unnecessary chart recreation
  // when chartType changes (which was causing the Line-mode blank bug).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chartOptions = useMemo(() => ({}), []);

  const formatCompactNumber = (value, digits = 2) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    const absolute = Math.abs(numeric);
    if (absolute >= 1e12) return `${(numeric / 1e12).toFixed(digits)}T`;
    if (absolute >= 1e9) return `${(numeric / 1e9).toFixed(digits)}B`;
    if (absolute >= 1e6) return `${(numeric / 1e6).toFixed(digits)}M`;
    if (absolute >= 1e3) return `${(numeric / 1e3).toFixed(digits)}K`;
    return numeric.toFixed(digits);
  };

  const formatCompactMoney = (value, digits = 2) => {
    const formatted = formatCompactNumber(value, digits);
    return formatted === "—" ? formatted : `$${formatted}`;
  };

  const formatMultiple = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${numeric.toFixed(2)}x` : "—";
  };

  const formatRatioPercent = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "—";
  };

  const fundamentalsDetails = [
    { label: "Trailing P/E", value: formatMultiple(earnings?.valuation?.trailingPe) },
    { label: "Forward P/E", value: formatMultiple(earnings?.valuation?.forwardPe) },
    { label: "Price / Sales", value: formatMultiple(earnings?.valuation?.priceToSales) },
    { label: "EV / EBITDA", value: formatMultiple(earnings?.valuation?.enterpriseToEbitda) },
    { label: "Beta", value: Number.isFinite(Number(earnings?.profile?.beta)) ? Number(earnings.profile.beta).toFixed(2) : "—" },
    { label: "Dividend Yield", value: formatRatioPercent(earnings?.profile?.dividendYield) },
    {
      label: "52W Range",
      value: Number.isFinite(Number(earnings?.profile?.fiftyTwoWeekLow)) && Number.isFinite(Number(earnings?.profile?.fiftyTwoWeekHigh))
        ? `$${Number(earnings.profile.fiftyTwoWeekLow).toFixed(2)} - $${Number(earnings.profile.fiftyTwoWeekHigh).toFixed(2)}`
        : "—"
    },
    { label: "Avg Volume", value: formatCompactNumber(earnings?.profile?.averageVolume, 1) }
  ];
  const hasDetailedFundamentals = fundamentalsDetails.some((item) => item.value !== "—");

  if (!asset) return null;
    const cleanAsset = { ...asset };
    delete cleanAsset._forceSell;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content asset-modal-window ${shake ? "modal-shake" : ""}`} onClick={(e) => e.stopPropagation()}>
        {showConfetti && (
          <div className="trade-effect-layer confetti-layer">
            {confettiPieces.map((idx) => {
              const xValue = (idx % 13) * 7.5;
              const delayValue = (idx % 7) * 0.03;
              const hue = (idx * 27) % 360;
              return (
                <span 
                  key={`confetti-${idx}`} 
                  className="confetti-piece" 
                  style={{ 
                    "--x": `${xValue}%`,
                    "--delay": `${delayValue}s`,
                    "--bg": `hsl(${hue}, 90%, 60%)`
                  }} 
                />
              );
            })}
          </div>
        )}
        {showFireworks && (
          <div className="trade-effect-layer fireworks-layer">
            {fireworkBursts.map((idx) => {
              const xValue = 18 + (idx % 6) * 13;
              const yValue = 16 + (idx % 3) * 23;
              const delayValue = (idx % 5) * 0.04;
              const hue = (idx * 32) % 360;
              return (
                <span 
                  key={`fire-${idx}`} 
                  className="firework-burst" 
                  style={{ 
                    "--x": `${xValue}%`, 
                    "--y": `${yValue}%`,
                    "--delay": `${delayValue}s`,
                    "--bg": `hsl(${hue}, 95%, 62%)`
                  }} 
                />
              );
            })}
          </div>
        )}
        <header className="modal-header yahoo-header">
          <div className="asset-info-yahoo">
            <div className="asset-title-row">
              <h2 className="yahoo-name">{asset.name} ({asset.symbol})</h2>
              <div className="modal-header-actions">
                <button
                  className={`star-button ${isInWatchlist?.(asset, undefined, { strictStockMeta: true }) ? "active" : ""}`}
                  onClick={() => onToggleStar?.(asset)}
                  title={isInWatchlist?.(asset, undefined, { strictStockMeta: true }) ? "Remove from watchlist" : "Add to watchlist"}
                  style={{ fontSize: "1.2rem" }}
                >
                  ★
                </button>
                <button className="close-btn" onClick={onClose}>&times;</button>
              </div>
            </div>
            
            <div className="yahoo-price-row">
              <span className="yahoo-price">
                {displayedPrice > 0 ? displayedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
              </span>
              <span className={`yahoo-change ${displayedChangePercent >= 0 ? "positive" : "negative"}`}>
                {displayedChangeValue >= 0 ? "+" : ""}{Math.abs(displayedChangeValue).toFixed(2)} 
                ({displayedChangePercent >= 0 ? "+" : ""}{displayedChangePercent.toFixed(2)}%)
              </span>
              <span className="yahoo-currency-label">{activeCurrency}</span>
            </div>

            <div className="yahoo-market-status">
              As of {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} {Intl.DateTimeFormat().resolvedOptions().timeZone}. 
              {asset.isMarketOpen !== false ? " Market Open." : ` Market Closed (${asset.marketStatus || 'Weekend/Holiday'}).`}
            </div>
          </div>
        </header>

        <div className="chart-section asset-modal-body">
          <div className="chart-header-controls">
            <div className="asset-data-status">
              {assetType === "crypto" && historySource ? (
                <span className="chart-source-chip">
                  Source: {historySource === "hyperliquid" ? "Hyperliquid" : historySource === "coingecko" ? "CoinGecko (fallback)" : historySource}
                </span>
              ) : null}
              <span className={`data-health-badge ${loading ? "loading" : historyStale ? "hazard" : "ok"}`} title={loading ? "Refreshing chart data" : historyStale ? "Chart data may be delayed" : "Chart is up to date"}>
                <span className={`status-icon ${loading ? "spinner" : ""}`}>{loading ? "⟳" : historyStale ? "⚠" : "✓"}</span>
                Data Health
              </span>
            </div>
            <div className="chart-type-toggle">
              <button className={chartType === 'line' ? 'active' : ''} onClick={() => setChartType('line')}>Line</button>
              <button className={chartType === 'candlestick' ? 'active' : ''} onClick={() => setChartType('candlestick')}>Candle</button>
            </div>
          </div>

          <div className="chart-container">
            {history.length > 0 ? (
              <TradingViewChart 
                series={chartData}
                options={chartOptions}
                height={280}
                width="100%"
                priceLine={displayedPrice}
                tradeMarkers={tradeMarkers}
              />
            ) : loading ? (
              <div className="asset-modal-loader" aria-label="Loading chart data">
                <span className="status-icon spinner">⟳</span>
              </div>
            ) : (
              <div className="chart-no-data">No chart data available.</div>
            )}
            {loading && history.length > 0 ? (
              <div className="chart-refresh-overlay">
                <span className="status-icon spinner">⟳</span>
              </div>
            ) : null}
          </div>

          {chartRange && !loading && (
            <div className="chart-range-display">
              <span className="range-label">Range</span>
              <span className="range-dates">{chartRange.start} — {chartRange.end}</span>
            </div>
          )}

          <div className="interval-toggle-bottom">
            <div className="interval-toggle">
              {INTERVALS.map((int) => {
                const perf = performanceMap[int];
                return (
                  <div key={int} className="interval-btn-wrapper">
                    <button
                      className={activeInterval === int ? "active" : ""}
                      onClick={() => setActiveInterval(int)}
                    >
                      {int}
                    </button>
                    {perf !== undefined && (
                      <span className={`performance-badge ${perf >= 0 ? "positive" : "negative"}`}>
                        {perf >= 0 ? "+" : ""}{perf.toFixed(2)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

{isTradFi && (
            <div className="asset-modal-fundamentals">
              <div className="asset-modal-section-head">
                {isStockResearchEligible ? (
                  <button
                    type="button"
                    className="asset-modal-more-link"
                    onClick={() => onViewCompanyProfile?.(asset)}
                  >
                    Company Profile
                  </button>
                ) : (
                  <span />
                )}
                <span className={`data-health-badge ${earningsLoading ? "loading" : earningsStale ? "hazard" : "ok"}`} title={earningsLoading ? "Refreshing fundamentals data" : earningsStale ? "Fundamentals may be delayed" : "Fundamentals are up to date"}>
                  <span className={`status-icon ${earningsLoading ? "spinner" : ""}`}>{earningsLoading ? "⟳" : earningsStale ? "⚠" : "✓"}</span>
                  Fundamentals
                </span>
              </div>
              { (earningsLoading || finvizLoading) && !earnings && !finvizData ? (
                <div className="asset-modal-loader asset-modal-loader-compact" aria-label="Loading fundamentals">
                  <span className="status-icon spinner">⟳</span>
                </div>
              ) : (earnings || finvizData) ? (
                <div className="asset-modal-fundamentals-card">
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "rgba(148,163,184,0.06)" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Metric</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Value</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Finviz Info</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "var(--color-text-secondary)" }}>Market Cap</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-primary)", fontWeight: 600 }}>
                          {finvizData?.summary?.["Market Cap"] || (earnings?.marketCap != null ? formatCompactMoney(earnings.marketCap) : "—")}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-secondary)", fontSize: "10px" }}>Live</td>
                      </tr>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "var(--color-text-secondary)" }}>Revenue</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-primary)", fontWeight: 600 }}>
                          {finvizData?.summary?.["Sales"] || (earnings?.revenue?.consensus != null ? formatCompactMoney(earnings.revenue.consensus) : "—")}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--color-text-secondary)", fontSize: "10px" }}>Annual</td>
                      </tr>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "var(--color-text-secondary)" }}>Analyst Target</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#38bdf8", fontWeight: 600 }}>
                          {finvizData?.summary?.["Target Price"] || (earnings?.targetPrice != null ? `$${Number(earnings.targetPrice).toFixed(2)}` : "—")}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right" }}>
                           {finvizData?.ratings?.[0] && (
                             <span style={{
                               fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase",
                               background: (finvizData.ratings[0].rating?.toLowerCase().includes("buy") || finvizData.ratings[0].rating?.toLowerCase().includes("outperform")) ? "rgba(34,197,94,0.15)" : finvizData.ratings[0].rating?.toLowerCase().includes("sell") ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.1)",
                               color: (finvizData.ratings[0].rating?.toLowerCase().includes("buy") || finvizData.ratings[0].rating?.toLowerCase().includes("outperform")) ? "#22c55e" : finvizData.ratings[0].rating?.toLowerCase().includes("sell") ? "#ef4444" : "#94a3b8"
                             }}>
                               {finvizData.ratings[0].rating}
                             </span>
                           )}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "var(--color-text-secondary)" }}>Next Earnings</td>
                        <td colSpan={2} style={{ padding: "8px 12px", textAlign: "right", color: "#f59e0b", fontWeight: 600, fontSize: "11px" }}>
                          {finvizData?.summary?.["Earnings"] || earnings?.nextEarnings || "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {hasDetailedFundamentals ? (
                    <div className="asset-modal-fundamentals-grid">
                      {fundamentalsDetails.map((item) => (
                        <div key={item.label} className="asset-modal-fundamentals-stat">
                          <span className="asset-modal-fundamentals-label">{item.label}</span>
                          <strong className="asset-modal-fundamentals-value">{item.value}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="fundamentals-empty-hint" style={{ padding: "16px", textAlign: "center", color: "#64748b" }}>
                  <p style={{ margin: 0 }}>Detailed fundamentals unavailable for this ticker.</p>
                  {asset.symbol.includes(".") && (
                    <p style={{ margin: "8px 0 0", fontSize: "11px", opacity: 0.8 }}>
                      Hint: Coverage for international listings ( Milan, etc.) is limited. 
                      Try searching for US-listed alternatives (e.g. ONDS) for full metrics.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="order-type-toggle">
            <button className={`buy-selector ${orderType === 'buy' ? 'active' : ''}`} onClick={() => setOrderType('buy')}>Buy</button>
            <button className={`sell-selector ${orderType === 'sell' ? 'active' : ''}`} onClick={() => setOrderType('sell')}>Sell</button>
          </div>
        </div>
        {orderType === "sell" && (() => {
            const holding = portfolio.find(
              p => p.symbol === asset.symbol &&
              (p.marketType || "spot") === (asset.marketType || "spot")
            );
            const holdingQty = holding?.quantity || 0;
            const holdingValue = holdingQty * displayedPrice;
            return holdingQty > 0 ? (
              <div className="asset-modal-position-note">
                Your position: <strong style={{ color: "var(--color-text-primary)" }}>
                  {holdingQty} {asset.symbol}
                </strong> <span>(${holdingValue.toFixed(2)})</span>
              </div>
            ) : (
              <div className="asset-modal-position-note asset-modal-position-note-danger">
                You don't hold any {asset.symbol}.
              </div>
            );
          })()}
        {orderType === "buy" && (
          <div className={`asset-modal-position-note ${insufficientBalance ? "asset-modal-position-note-danger" : ""}`}>
            Available balance: <strong style={{ color: insufficientBalance ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>
              {getCurrencySymbol(asset?.currency)}{availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
            {insufficientBalance ? (
              <span style={{ marginLeft: "8px" }}>
                · Need ${(totalValue - availableBalance).toFixed(2)} more
              </span>
            ) : null}
          </div>
        )}
        <footer className="modal-footer">
          <div className="footer-left">
            <div className="quantity-input">
              <label>Quantity</label>
              <input
                  type="number"
                  value={quantity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (orderType === "sell") {
                      const holding = portfolio.find(
                        p => p.symbol === asset.symbol &&
                        (p.marketType || "spot") === (asset.marketType || "spot")
                      );
                      const max = holding?.quantity || 0;
                      setQuantity(Math.min(val, max));
                    } else {
                      setQuantity(val);
                    }
                  }}
                  min="0.0001"
                  max={orderType === "sell" ? (portfolio.find(p => p.symbol === asset.symbol)?.quantity || 0) : undefined}
                  step="any"
                />
            </div>
            <div className="total-value-display">
              <label>Total Value ({currencySymbol})</label>
              <div className="value-field">
                <input type="number" value={totalValue.toFixed(2)} onChange={(e) => {
                  const newVal = parseFloat(e.target.value) || 0;
                  if (displayedPrice > 0) setQuantity(newVal / displayedPrice);
                }} step="0.01" />
              </div>
            </div>
          </div>
	          <button className={`confirm-order-btn ${orderType}`} onClick={handleConfirmOrder} disabled={quantity <= 0 || isSubmitting}>
	            {isSubmitting ? "Submitting..." : "Confirm Order"}
	          </button>
	        </footer>
      </div>
    </div>
  );
}
