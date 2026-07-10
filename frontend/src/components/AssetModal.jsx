import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { TradingViewChart } from "./TradingViewChart";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getCurrencySymbol, formatCurrency, convertToUSD, inferAssetCurrency } from "../utils/currencyUtils";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetch } from "../utils/zeninFetch";
import { getMarketStatus } from "../utils/marketHours";

import { AssetHeader } from "./assetModal/AssetHeader";
import { AssetChart } from "./assetModal/AssetChart";
import { PortfolioContext } from "./assetModal/PortfolioContext";
import { ResearchTabs } from "./assetModal/ResearchTabs";
import { ResearchToolbar } from "./assetModal/ResearchToolbar";

const BACKEND_URL = ZENIN_API_BASE_URL;
const EARNINGS_FUNDAMENTALS_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function AssetModal({
  asset,
  onClose,
  onConfirm,
  onCompare,
  isInWatchlist,
  onToggleStar,
  onViewCompanyProfile,
  portfolio = [],
  balance = 0,
  cashBalances = {},
  trades = [],
  spotPrices = {},
  researchOnly = true
}) {
  const intervals = Array.isArray(getAppRuntimeConfig()?.ui?.assetModalIntervals)
    ? getAppRuntimeConfig().ui.assetModalIntervals
    : ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];

  // ── Data state (preserved) ───────────────────────────────────────────────
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyStale, setHistoryStale] = useState(false);
  const [activeInterval, setActiveInterval] = useState("1D");
  const [historySource, setHistorySource] = useState("");
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
    if (rawType === "forex" || rawType === "fx" || marketType === "forex" || rawCategory === "fx") return "forex";
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
  const isForexAsset = normalizedAssetKind === "forex";
  const assetSymbol = String(asset?.symbol || "").toUpperCase();
  const assetType = normalizedAssetKind === "stock" || normalizedAssetKind === "etf"
    ? "stock"
    : normalizedAssetKind === "crypto"
      ? "crypto"
      : asset?.type || normalizedAssetKind;
  const isStockResearchEligible = normalizedAssetKind === "stock";

  const cleanAsset = useMemo(() => {
    if (!asset) return null;
    const cloned = { ...asset };
    delete cloned._forceSell;
    return cloned;
  }, [asset]);

  const [chartType, setChartType] = useState("line");
  const [visibleIndicators, setVisibleIndicators] = useState({
    volume: true,
    sma20: true,
    ema20: true,
    vwap: true
  });
  const [crosshairEnabled, setCrosshairEnabled] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [chartResetSignal, setChartResetSignal] = useState(0);

  const [performanceMap, setPerformanceMap] = useState({});
  const [liveQuote, setLiveQuote] = useState({ price: null, priceChangePercent: null, source: null });
  const [activeTab, setActiveTab] = useState("overview");

  const isCacheFresh = (cacheEntry, ttlMs) => {
    if (!cacheEntry?.updatedAt) return false;
    const updatedAtMs = new Date(cacheEntry.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < ttlMs;
  };

  // ── Effects (preserved verbatim) ─────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
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
        const params = new URLSearchParams({ symbol: assetSymbol, type: assetType, interval: activeInterval });
        const res = await zeninFetch(`/history?${params.toString()}`, { signal });
        const data = await res.json();
        if (signal.aborted) return;
        const nextHistory = Array.isArray(data?.history) ? data.history : [];
        const nextSource = String(data?.source || "");
        if (data?.currency) setFetchedCurrency(data.currency);
        setHistory(nextHistory);
        setHistorySource(nextSource);
        setHistoryStale(Boolean(data?.stale || data?.unavailable));
        writeResilientCache("asset-history", cacheParams, data || { history: nextHistory, source: nextSource });
      } catch (err) {
        if (signal.aborted) return;
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
        if (!signal.aborted) setLoading(false);
      }
    };
    fetchHistory();
    return () => controller.abort();
  }, [activeInterval, assetSymbol, assetType]);

  useEffect(() => {
    setLiveQuote({ price: null, priceChangePercent: null, source: null });
  }, [assetSymbol, assetType]);

  useEffect(() => {
    if (!assetSymbol) return;
    const hasPrice = Number.isFinite(Number(asset?.price));
    const hasChange = Number.isFinite(Number(asset?.priceChangePercent));
    if (hasPrice && hasChange) return;
    const controller = new AbortController();
    const { signal } = controller;
    const fetchQuote = async () => {
      try {
        const quoteType = assetType === "crypto" ? "crypto" : "tradfi";
        const params = new URLSearchParams({ type: quoteType, symbols: assetSymbol });
        const res = await zeninFetch(`/prices?${params.toString()}`, { signal });
        const data = await res.json();
        if (signal.aborted) return;
        const row = data?.prices?.[assetSymbol] || data?.[assetSymbol] || null;
        const price = Number(row?.price);
        const priceChangePercent = Number(row?.priceChangePercent);
        if (row?.currency) setFetchedCurrency(row.currency);
        setLiveQuote({
          price: Number.isFinite(price) ? price : null,
          priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null,
          source: row?.source || data?.providers?.[0]?.source || null
        });
      } catch (error) {
        if (signal.aborted) return;
        console.warn("[AssetModal] Live quote fetch failed:", error?.message || error);
      }
    };
    fetchQuote();
    return () => controller.abort();
  }, [asset?.price, asset?.priceChangePercent, assetSymbol, assetType]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fetchPerformance = async () => {
      if (!assetSymbol) return;
      const cacheParams = { symbol: assetSymbol, type: assetType };
      const cached = readResilientCache("asset-performance", cacheParams);
      if (cached?.payload && cached.payload?.performance && typeof cached.payload.performance === "object") {
        setPerformanceMap(cached.payload.performance);
      }
      try {
        const params = new URLSearchParams({ symbol: assetSymbol, type: assetType });
        const res = await zeninFetch(`/interval-performance?${params.toString()}`, { signal });
        const data = await res.json();
        if (signal.aborted) return;
        const performance = data?.performance && typeof data.performance === "object" ? data.performance : {};
        setPerformanceMap(performance);
        writeResilientCache("asset-performance", cacheParams, { performance });
      } catch (err) {
        if (signal.aborted) return;
        console.warn("Performance summary unavailable; using local context.", err);
      }
    };
    fetchPerformance();
    return () => controller.abort();
  }, [assetSymbol, assetType]);

  useEffect(() => {
    if (!isTradFi || !assetSymbol || isForexAsset) {
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
        const res = await zeninFetch(`/earnings?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
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
          setEarnings({ symbol: assetSymbol, nextEarnings: null, stale: true, unavailable: true, stale_reason: "earnings_temporarily_unavailable" });
          console.warn("Earnings endpoint unavailable for symbol:", assetSymbol);
        }
        setEarningsStale(true);
      } finally {
        if (!controller.signal.aborted) setEarningsLoading(false);
      }
    };
    fetchEarnings();
    return () => controller.abort();
  }, [isTradFi, assetSymbol, isForexAsset]);

  useEffect(() => {
    if (!isTradFi || !assetSymbol || isForexAsset) return;
    const controller = new AbortController();
    const { signal } = controller;
    const fetchFinviz = async () => {
      setFinvizLoading(true);
      try {
        const res = await zeninFetch(`/finviz?symbol=${assetSymbol}`, { signal });
        const data = await res.json();
        if (signal.aborted) return;
        if (data && !data.error) setFinvizData(data);
      } catch (err) {
        if (signal.aborted) return;
        console.warn("Finviz data unavailable; showing fundamentals fallback.", err);
      } finally {
        if (!signal.aborted) setFinvizLoading(false);
      }
    };
    fetchFinviz();
    return () => controller.abort();
  }, [isTradFi, assetSymbol, isForexAsset]);

  // ── Derived display values (preserved) ──────────────────────────────────
  const displayedPrice = Number.isFinite(Number(asset?.price))
    ? Number(asset.price)
    : Number.isFinite(Number(liveQuote.price))
      ? Number(liveQuote.price)
      : (() => {
          const lastPoint = [...history].reverse().find((row) => Number.isFinite(Number(row?.close ?? row?.price)));
          const fallback = Number(lastPoint?.close ?? lastPoint?.price);
          return Number.isFinite(fallback) ? fallback : 0;
        })();

  const activeCurrency = inferAssetCurrency({ ...asset, currency: fetchedCurrency || asset?.currency, quotedCurrency: asset?.quotedCurrency });
  const currencySymbol = getCurrencySymbol(activeCurrency);

  const displayedChangePercent = Number.isFinite(Number(asset?.priceChangePercent))
    ? Number(asset.priceChangePercent)
    : Number.isFinite(Number(liveQuote.priceChangePercent))
      ? Number(liveQuote.priceChangePercent)
      : 0;

  const marketStatus = useMemo(() => getMarketStatus(asset), [asset]);
  const isMarketOpen = marketStatus.isOpen;

  const displayedChangeValue = useMemo(() => {
    if (Number.isFinite(Number(asset?.priceChangeValue))) return Number(asset.priceChangeValue);
    if (Number.isFinite(Number(liveQuote.priceChangeValue))) return Number(liveQuote.priceChangeValue);
    return (displayedPrice * (displayedChangePercent / 100)) / (1 + displayedChangePercent / 100);
  }, [asset?.priceChangeValue, liveQuote.priceChangeValue, displayedPrice, displayedChangePercent]);

  const chartData = useMemo(() => {
    const normalizeTime = (row) => {
      const candidate = row?.time ?? row?.date ?? row?.datetime ?? null;
      if (candidate == null) return null;
      const parsed = typeof candidate === "number" ? candidate : new Date(candidate).getTime();
      if (!Number.isFinite(parsed)) return null;
      return parsed > 10000000000 ? Math.floor(parsed / 1000) : Math.floor(parsed);
    };
    const priceRows = history
      .map((h) => ({
        time: normalizeTime(h),
        open: Number(h.open),
        high: Number(h.high),
        low: Number(h.low),
        close: Number(h.close || h.price),
        volume: Number(h.volume ?? h.Volume ?? h.v ?? 0)
      }))
      .filter((row) => row.time != null && Number.isFinite(row.close));
    const movingAverage = (period) => priceRows
      .map((row, idx) => {
        if (idx + 1 < period) return null;
        const windowRows = priceRows.slice(idx + 1 - period, idx + 1);
        const sum = windowRows.reduce((total, item) => total + Number(item.close || 0), 0);
        return { time: row.time, value: Number((sum / period).toFixed(4)) };
      })
      .filter(Boolean);
    const ema = (period) => {
      const multiplier = 2 / (period + 1);
      let previous = null;
      return priceRows
        .map((row) => {
          previous = previous == null ? row.close : (row.close - previous) * multiplier + previous;
          return { time: row.time, value: Number(previous.toFixed(4)) };
        })
        .filter((row, idx) => idx >= period - 1);
    };
    const vwap = (() => {
      let cumulativeVolume = 0;
      let cumulativePriceVolume = 0;
      return priceRows
        .map((row) => {
          if (!Number.isFinite(row.volume) || row.volume <= 0) return null;
          const typical = Number.isFinite(row.high) && Number.isFinite(row.low)
            ? (row.high + row.low + row.close) / 3
            : row.close;
          cumulativeVolume += row.volume;
          cumulativePriceVolume += typical * row.volume;
          return { time: row.time, value: Number((cumulativePriceVolume / cumulativeVolume).toFixed(4)) };
        })
        .filter(Boolean);
    })();
    const indicatorOptions = { priceFormat: { type: "price", precision: 2, minMove: 0.01 }, lastValueVisible: false, priceLineVisible: false };
    if (chartType === "candlestick") {
      const candleRows = priceRows.filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
      const volumeRows = candleRows
        .filter((row) => Number.isFinite(row.volume) && row.volume > 0)
        .map((row) => ({
          time: row.time,
          value: row.volume,
          color: row.close >= row.open ? "rgba(34,197,94,0.28)" : "rgba(239,68,68,0.28)"
        }));
      return [
        { name: "Price", type: "candlestick", data: candleRows, options: { lastValueVisible: false, priceLineVisible: false } },
        visibleIndicators.volume && volumeRows.length ? { name: "Volume", type: "histogram", color: "rgba(160, 160, 160, 0.24)", data: volumeRows, includeInReadout: false, options: { priceScaleId: "", priceScaleOptions: { scaleMargins: { top: 0.74, bottom: 0 } }, priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false } } : null,
        visibleIndicators.sma20 ? { name: "SMA 20", type: "line", color: "var(--color-warning)", data: movingAverage(20), includeInReadout: false, options: indicatorOptions } : null,
        visibleIndicators.ema20 ? { name: "EMA 20", type: "line", color: "var(--color-data-secondary)", data: ema(20), includeInReadout: false, options: indicatorOptions } : null,
        visibleIndicators.vwap && vwap.length ? { name: "VWAP", type: "line", color: "var(--color-data-secondary)", data: vwap, includeInReadout: false, options: indicatorOptions } : null
      ].filter(Boolean);
    }
    return [
      { name: "Price", type: "area", color: "var(--color-data-primary)", data: priceRows.map((row) => ({ time: row.time, value: row.close })), options: { lastValueVisible: false, priceLineVisible: false } },
      visibleIndicators.sma20 ? { name: "SMA 20", type: "line", color: "var(--color-warning)", data: movingAverage(20), includeInReadout: false, options: indicatorOptions } : null,
      visibleIndicators.ema20 ? { name: "EMA 20", type: "line", color: "var(--color-data-secondary)", data: ema(20), includeInReadout: false, options: indicatorOptions } : null,
      visibleIndicators.vwap && vwap.length ? { name: "VWAP", type: "line", color: "var(--color-data-secondary)", data: vwap, includeInReadout: false, options: indicatorOptions } : null
    ].filter(Boolean);
  }, [history, chartType, visibleIndicators]);

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
        const qty = Number(trade?.quantity || trade?.qty || 0);
        const pnl = Number(trade?.pnl ?? trade?.realizedPnl);
        const priceText = Number.isFinite(price) ? `${formatCurrency(price, activeCurrency)}` : "";
        const qtyText = Number.isFinite(qty) && qty > 0 ? `${qty.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ ` : "";
        const pnlText = Number.isFinite(pnl) ? ` ${pnl >= 0 ? "+" : ""}${formatCurrency(pnl, activeCurrency)}` : "";
        const label = `${side === "sell" ? "SELL" : "BUY"} ${qtyText}${priceText}${pnlText}`.trim();
        return { time: Math.floor(parsed / 1000), position: side === "sell" ? "aboveBar" : "belowBar", shape: side === "sell" ? "arrowDown" : "arrowUp", color: side === "sell" ? "var(--color-danger)" : "var(--color-success)", text: label };
      })
      .filter(Boolean);
  }, [activeCurrency, assetSymbol, trades]);

  const averageEntryPrice = useMemo(() => {
    const markerSymbol = String(assetSymbol || "").trim().toUpperCase();
    if (!markerSymbol || !Array.isArray(trades)) return null;
    const buys = trades
      .filter((trade) => String(trade?.asset || trade?.symbol || "").trim().toUpperCase() === markerSymbol)
      .filter((trade) => String(trade?.side || trade?.type || "").toLowerCase() !== "sell")
      .map((trade) => ({ qty: Number(trade?.quantity || trade?.qty || 0), price: Number(trade?.price) }))
      .filter((trade) => Number.isFinite(trade.qty) && trade.qty > 0 && Number.isFinite(trade.price));
    const totalQty = buys.reduce((sum, trade) => sum + trade.qty, 0);
    if (totalQty <= 0) return null;
    return buys.reduce((sum, trade) => sum + trade.qty * trade.price, 0) / totalQty;
  }, [assetSymbol, trades]);

  const assetPriceLines = useMemo(() => {
    const high52 = Number(earnings?.profile?.fiftyTwoWeekHigh ?? asset?.fiftyTwoWeekHigh ?? asset?.high52);
    const low52 = Number(earnings?.profile?.fiftyTwoWeekLow ?? asset?.fiftyTwoWeekLow ?? asset?.low52);
    return [
      Number.isFinite(displayedPrice) && displayedPrice > 0 ? { id: "current-price", price: displayedPrice, title: "Current price", color: "var(--color-data-slate)" } : null,
      Number.isFinite(averageEntryPrice) ? { id: "avg-entry", price: averageEntryPrice, title: "Avg entry", color: "var(--color-warning)" } : null,
      Number.isFinite(high52) && high52 > 0 ? { id: "52w-high", price: high52, title: "52W high", color: "rgba(34,197,94,0.72)" } : null,
      Number.isFinite(low52) && low52 > 0 ? { id: "52w-low", price: low52, title: "52W low", color: "rgba(239,68,68,0.72)" } : null
    ].filter(Boolean);
  }, [asset, averageEntryPrice, displayedPrice, earnings]);

  const chartRange = useMemo(() => {
    if (!history || history.length === 0) return null;
    const normalizeTime = (value) => {
      if (value == null) return null;
      if (typeof value === "number") return value > 10000000000 ? value : value * 1000;
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    };
    const start = normalizeTime(history[0].time ?? history[0].date ?? history[0].datetime);
    const end = normalizeTime(history[history.length - 1].time ?? history[history.length - 1].date ?? history[history.length - 1].datetime);
    const formatDate = (ms) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const formatTime = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const sameDay = startDate.toDateString() === endDate.toDateString();
    if (sameDay && ["4H", "1D"].includes(activeInterval)) {
      return { label: "Session", start: formatDate(start), end: `${formatTime(start)} - ${formatTime(end)}` };
    }
    return { label: "Range", start: formatDate(start), end: formatDate(end) };
  }, [activeInterval, history]);

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
    { label: "52W Range", value: Number.isFinite(Number(earnings?.profile?.fiftyTwoWeekLow)) && Number.isFinite(Number(earnings?.profile?.fiftyTwoWeekHigh)) ? `$${Number(earnings.profile.fiftyTwoWeekLow).toFixed(2)} - $${Number(earnings.profile.fiftyTwoWeekHigh).toFixed(2)}` : "—" },
    { label: "Avg Volume", value: formatCompactNumber(earnings?.profile?.averageVolume, 1) }
  ];
  const hasDetailedFundamentals = fundamentalsDetails.some((item) => item.value !== "—");

  // ── Accessibility: focus trap + Escape + restore focus ───────────────────
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!asset) return;
    previouslyFocused.current = document.activeElement;
    const node = dialogRef.current;
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.disabled && el.offsetParent !== null)
        : [];
    const first = focusables()[0];
    if (first) first.focus();
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [asset, onClose]);

  if (!asset) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${asset.name || asset.symbol} research`}
        className={`modal-content asset-modal-window ${chartExpanded ? "asset-modal-window-expanded" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <AssetHeader
          asset={asset}
          displayedPrice={displayedPrice}
          displayedChangePercent={displayedChangePercent}
          displayedChangeValue={displayedChangeValue}
          activeCurrency={activeCurrency}
          isMarketOpen={isMarketOpen}
          marketStatus={marketStatus}
          liveQuote={liveQuote}
          isInWatchlist={isInWatchlist}
          onToggleStar={onToggleStar}
          onViewCompanyProfile={onViewCompanyProfile}
          onClose={onClose}
        />

        <div className="am-body-grid">
          <AssetChart
            chartData={chartData}
            history={history}
            loading={loading}
            historyStale={historyStale}
            historySource={historySource}
            chartType={chartType}
            setChartType={setChartType}
            visibleIndicators={visibleIndicators}
            setVisibleIndicators={setVisibleIndicators}
            activeInterval={activeInterval}
            setActiveInterval={setActiveInterval}
            intervals={intervals}
            performanceMap={performanceMap}
            assetPriceLines={assetPriceLines}
            tradeMarkers={tradeMarkers}
            chartExpanded={chartExpanded}
            setChartExpanded={setChartExpanded}
            chartResetSignal={chartResetSignal}
            chartRange={chartRange}
            formatChartPrice={(value) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric)) return "Price unavailable";
              return `${currencySymbol}${numeric.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }}
            formatChartVolume={(value) => {
              const numeric = Number(value);
              if (!Number.isFinite(numeric) || numeric <= 0) return "Vol -";
              return `Vol ${formatCompactNumber(numeric, numeric >= 1000000 ? 1 : 0)}`;
            }}
            formatChartTime={(time) => new Date(Number(time) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
            formatChartReadout={({ mode, point, defaultReadout }) => {
              if (!point) return defaultReadout;
              const open = Number(point.open);
              const high = Number(point.high);
              const low = Number(point.low);
              const close = Number(point.close ?? point.value);
              const volume = Number(point.volume);
              if ([open, high, low, close].every(Number.isFinite)) {
                return { mode, price: `C ${`${currencySymbol}${close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}`, detail: `O ${`${currencySymbol}${open.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}  H ${`${currencySymbol}${high.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}  L ${`${currencySymbol}${low.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}  ${formatCompactNumber(volume, numeric >= 1000000 ? 1 : 0) ? `Vol ${formatCompactNumber(volume, numeric >= 1000000 ? 1 : 0)}` : ""}` };
              }
              return { ...defaultReadout, detail: Number.isFinite(volume) && volume > 0 ? `Vol ${formatCompactNumber(volume, numeric >= 1000000 ? 1 : 0)}` : defaultReadout.detail };
            }}
            crosshairEnabled={crosshairEnabled}
          />

          <PortfolioContext
            asset={asset}
            portfolio={portfolio}
            displayedPrice={displayedPrice}
            activeCurrency={activeCurrency}
            currencySymbol={currencySymbol}
            averageEntryPrice={averageEntryPrice}
            spotPrices={spotPrices}
            isInWatchlist={isInWatchlist}
            onToggleStar={onToggleStar}
          />
        </div>

        <ResearchTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          earnings={earnings}
          earningsLoading={earningsLoading}
          earningsStale={earningsStale}
          finvizData={finvizData}
          finvizLoading={finvizLoading}
          fundamentalsDetails={fundamentalsDetails}
          hasDetailedFundamentals={hasDetailedFundamentals}
          asset={asset}
          assetSymbol={assetSymbol}
          isStockResearchEligible={isStockResearchEligible}
          onViewCompanyProfile={onViewCompanyProfile}
          onOpenResearch={onOpenResearch}
          formatCompactMoney={formatCompactMoney}
          formatMultiple={formatMultiple}
          formatRatioPercent={formatRatioPercent}
        />

        <ResearchToolbar
          asset={asset}
          isInWatchlist={isInWatchlist}
          onToggleStar={onToggleStar}
          onViewCompanyProfile={onViewCompanyProfile}
          onClose={onClose}
          onCompare={onCompare}
          onOpenResearch={onOpenResearch}
        />
      </div>
    </div>
  );
}
