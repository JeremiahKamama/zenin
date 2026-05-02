import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";
import { zeninFetch } from "../utils/zeninFetch";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { getCurrencySymbol, inferAssetCurrency } from "../utils/currencyUtils";

const BACKEND_URL = ZENIN_API_BASE_URL;
const MACRO_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EARNINGS_CLIENT_CACHE_TTL_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
const ALLOWED_MACRO_INDICATOR_KEYS = [
  "gdp_growth_rate",
  "interest_rate",
  "inflation_rate",
  "unemployment_rate",
  "consumer_confidence",
  "balance_of_trade",
  "cpi",
  "core_inflation_rate"
];

const sanitizeMacroSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const allowed = new Set(ALLOWED_MACRO_INDICATOR_KEYS);
  const metrics = Array.isArray(snapshot.metrics)
    ? snapshot.metrics.filter((row) => allowed.has(String(row?.key || "")))
    : [];
  return { ...snapshot, metrics };
};

const hasUsableEarningsPayload = (payload) => {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.some((item) => item?.nextEarnings || item?.earningsText);
};

export function Watchlist({
  categories,
  activeCategory,
  onCategorySelect,
  assets,
  watchlistAssets = [],
  onAdd,
  loading,
  activeTheme,
  onThemeSelect,
  stockThemes = [],
  isInWatchlist,
  onToggleStar,
  onPageChange,
  liveStatus = "idle",
  lastLivePriceAt = null,
}) {
  const addCategoryText = (() => {
    const raw = String(activeCategory || "asset").trim();
    if (!raw) return "Add Asset";
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return `Add ${label}`;
  })();

  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [earningsItems, setEarningsItems] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsStale, setEarningsStale] = useState(false);
  const [earningsNotice, setEarningsNotice] = useState("");
  const [indicatorCountry, setIndicatorCountry] = useState("");
  const [macroSnapshot, setMacroSnapshot] = useState(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroStale, setMacroStale] = useState(false);
  const [macroNotice, setMacroNotice] = useState("");
  const [macroByCountry, setMacroByCountry] = useState({});
  const [selectedIndicatorMetric, setSelectedIndicatorMetric] = useState(null);

  const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();
  const normalizeMarketType = (value) => String(value || "").trim().toLowerCase() || "spot";
  const normalizeCategory = (value) => String(value || "").trim().toLowerCase();
  const normalizeTheme = (value) => String(value || "").trim().toLowerCase();
  const resolveWatchlistCategory = (asset) => {
    const kind = normalizeAssetKind(asset);
    if (kind === "stock" || kind === "etf") return "stocks";
    if (kind === "crypto") return "crypto";
    if (kind === "bond") return "bonds";
    if (kind === "indicator") return "indicators";
    if (kind === "commodity") return "commodities";
    
    // Fallback
    const explicitCategory = normalizeCategory(asset?.category);
    if (explicitCategory) return explicitCategory;
    return kind;
  };
  const normalizeAssetKind = (asset) => {
    const rawType = String(asset?.type || "").trim().toLowerCase();
    const rawCategory = normalizeCategory(asset?.category);
    const marketType = normalizeMarketType(asset?.marketType);
    if (["stock", "stocks", "equity"].includes(rawType)) return "stock";
    if (["etf", "etfs"].includes(rawType)) return "etf";
    if (rawType === "crypto" || marketType === "spot") return "crypto";
    if (rawType === "indicator" || rawCategory === "indicators" || marketType === "macro") return "indicator";
    if (rawType === "bond" || rawCategory === "bonds") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(rawType) || ["commodities", "metals"].includes(rawCategory)) return "commodity";
    if (asset?.theme || rawCategory === "stocks") return "stock";
    return rawType || "stock";
  };
  const buildAssetMetaKey = (asset) => (
    [
      normalizeSymbol(asset?.symbol),
      normalizeMarketType(asset?.marketType),
      normalizeCategory(asset?.category),
      normalizeTheme(asset?.theme)
    ].join("::")
  );
  const buildAssetSymbolKey = (asset) => (
    [
      normalizeSymbol(asset?.symbol),
      normalizeMarketType(asset?.marketType)
    ].join("::")
  );
  const isCacheFresh = (cacheEntry, ttlMs) => {
    if (!cacheEntry?.updatedAt) return false;
    const updatedAtMs = new Date(cacheEntry.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < ttlMs;
  };

  const mergedStockThemes = (() => {
    const seen = new Set();
    return [...(Array.isArray(stockThemes) ? stockThemes : [])]
      .map((theme) => String(theme || "").trim())
      .filter((theme) => {
        if (!theme) return false;
        const key = theme.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  })();

  const orderMap = new Map(
    (Array.isArray(watchlistAssets) ? watchlistAssets : []).map((entry, index) => [
      buildAssetMetaKey(entry),
      index
    ])
  );

  const getWatchlistOrder = (asset) => {
    const exactKey = buildAssetMetaKey(asset);
    if (orderMap.has(exactKey)) return orderMap.get(exactKey);
    const symbol = normalizeSymbol(asset.symbol);
    const marketType = normalizeMarketType(asset.marketType);
    let fallback = Number.MAX_SAFE_INTEGER;
    orderMap.forEach((idx, key) => {
      if (key.startsWith(`${symbol}::${marketType}::`)) fallback = Math.min(fallback, idx);
    });
    return fallback;
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTheme]);

  useEffect(() => {
    if (activeCategory !== "indicators") {
      setIndicatorCountry("");
      setMacroSnapshot(null);
      setMacroStale(false);
      setSelectedIndicatorMetric(null);
    }
  }, [activeCategory]);

  useEffect(() => {
    setSelectedIndicatorMetric(null);
  }, [indicatorCountry]);

  const assetCatalogByMeta = useMemo(
    () => new Map((Array.isArray(assets) ? assets : []).map((asset) => [buildAssetMetaKey(asset), asset])),
    [assets]
  );
  const assetCatalogBySymbol = useMemo(() => {
    const next = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const key = buildAssetSymbolKey(asset);
      if (!next.has(key)) next.set(key, asset);
    });
    return next;
  }, [assets]);
  const assetCatalogBySymbolLoose = useMemo(() => {
    const next = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const key = normalizeSymbol(asset?.symbol);
      if (!key) return;
      if (!next.has(key)) next.set(key, asset);
    });
    return next;
  }, [assets]);

  const doesEntryBelongToActiveCategory = (entry) => {
    return resolveWatchlistCategory(entry) === normalizeCategory(activeCategory);
  };

  const starredAssets = useMemo(() => {
    const hasWatchlistEntries = Array.isArray(watchlistAssets) && watchlistAssets.length > 0;
    const source = hasWatchlistEntries
      ? watchlistAssets
      : (Array.isArray(assets) ? assets : []).filter((asset) => doesEntryBelongToActiveCategory(asset));
    return source
      .filter((entry) => doesEntryBelongToActiveCategory(entry))
      .map((entry) => {
        const exactCatalogAsset = assetCatalogByMeta.get(buildAssetMetaKey(entry));
        const fallbackCatalogAsset = assetCatalogBySymbol.get(buildAssetSymbolKey(entry));
        const looseCatalogAsset = assetCatalogBySymbolLoose.get(normalizeSymbol(entry?.symbol));
        const marketAsset = exactCatalogAsset || fallbackCatalogAsset || looseCatalogAsset || null;
        return {
          ...(marketAsset || {}),
          ...entry,
          name: entry?.name || marketAsset?.name || entry?.symbol || "Unknown",
          type: entry?.type || marketAsset?.type || "stock",
          category: entry?.category || marketAsset?.category || activeCategory,
          theme: entry?.theme || marketAsset?.theme || null,
          marketType: entry?.marketType || marketAsset?.marketType || "spot",
          market: entry?.market || marketAsset?.market || null,
          price: marketAsset?.price ?? entry?.price ?? null,
          priceChangePercent: marketAsset?.priceChangePercent ?? entry?.priceChangePercent ?? null
        };
      })
      .sort((a, b) => getWatchlistOrder(a) - getWatchlistOrder(b));
  }, [watchlistAssets, activeCategory, assetCatalogByMeta, assetCatalogBySymbol, assetCatalogBySymbolLoose]);

  // Derive displayed assets based on selected stock theme after watchlist filter.
  const displayedAssets =
    activeCategory === "stocks" && activeTheme && activeTheme !== "All"
      ? starredAssets.filter(
          (a) => normalizeTheme(a.theme) === normalizeTheme(activeTheme)
        )
      : starredAssets;

  const indicatorWatchlistCountries = useMemo(() => {
    return (Array.isArray(watchlistAssets) ? watchlistAssets : [])
      .filter((entry) => normalizeAssetKind(entry) === "indicator")
      .map((entry) => ({
        ...entry,
        symbol: normalizeSymbol(entry.symbol),
        name: String(entry.name || entry.symbol || "").replace(/\s+macro indicators$/i, "").trim() || normalizeSymbol(entry.symbol)
      }))
      .sort((a, b) => getWatchlistOrder(a) - getWatchlistOrder(b));
  }, [watchlistAssets]);

  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(displayedAssets.length / itemsPerPage));
  const pagedAssets = displayedAssets.slice(
  (currentPage - 1) * itemsPerPage,
  currentPage * itemsPerPage
);
const pageSymbols = pagedAssets.map((a) => a.symbol).join(",");

  const activeIndicator = useMemo(
    () => indicatorWatchlistCountries.find((country) => country.symbol === indicatorCountry) || null,
    [indicatorCountry, indicatorWatchlistCountries]
  );

  const earningsSymbols = useMemo(
    () => (
      activeCategory === "stocks"
        ? [...new Set(pagedAssets.map((a) => normalizeSymbol(a?.symbol)).filter(Boolean))]
        : []
    ),
    [activeCategory, pagedAssets]
  );
  const earningsRows = useMemo(() => {
    const bySymbol = new Map(
      (Array.isArray(earningsItems) ? earningsItems : [])
        .map((item) => [normalizeSymbol(item?.symbol), item])
        .filter(([symbol]) => Boolean(symbol))
    );
    return earningsSymbols.map((symbol) => ({
      symbol,
      item: bySymbol.get(symbol) || null
    }));
  }, [earningsItems, earningsSymbols]);

useEffect(() => {
  onPageChange?.(currentPage, pageSymbols ? pageSymbols.split(",") : []);
}, [currentPage, activeTheme, activeCategory, pageSymbols]);

  useEffect(() => {
    if (activeCategory !== "indicators") return;
    if (indicatorWatchlistCountries.length === 0) {
      setIndicatorCountry("");
      setMacroSnapshot(null);
      setMacroStale(false);
      setMacroNotice("");
      return;
    }
    if (!indicatorCountry || !indicatorWatchlistCountries.some((country) => country.symbol === indicatorCountry)) {
      setIndicatorCountry(indicatorWatchlistCountries[0].symbol);
    }
  }, [activeCategory, indicatorCountry, indicatorWatchlistCountries]);

  useEffect(() => {
    if (activeCategory !== "indicators" || !indicatorCountry) return;

    let isMounted = true;
    const controller = new AbortController();
    const now = Date.now();
    const stateCachedEntry = macroByCountry[indicatorCountry];
    const storageCached = readResilientCache("macro-indicators", { country: indicatorCountry });
    const cachedPayload = sanitizeMacroSnapshot(stateCachedEntry?.data || storageCached?.payload || null);
    const cachedAt = Number(stateCachedEntry?.cachedAt || (storageCached?.updatedAt ? new Date(storageCached.updatedAt).getTime() : 0));
    if (cachedPayload) {
      setMacroSnapshot(cachedPayload);
      setMacroStale(Boolean(cachedPayload?.stale || cachedPayload?.unavailable));
      setMacroNotice(Boolean(cachedPayload?.stale || cachedPayload?.unavailable) ? getSnapshotFallbackMessage(cachedPayload) : "");
      if (now - cachedAt < MACRO_CLIENT_CACHE_TTL_MS) {
        setMacroLoading(false);
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchMacro = async () => {
      setMacroLoading(true);
      try {
        const res = await fetch(`${BACKEND_URL}/macro-indicators?country=${encodeURIComponent(indicatorCountry)}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const payload = await res.json();
            msg = payload?.error || msg;
          } catch {
            const text = await res.text();
            if (text) msg = text;
          }
          throw new Error(msg);
        }
        const data = await res.json();
        if (!isMounted) return;
        const sanitized = sanitizeMacroSnapshot(data || null);
        setMacroSnapshot(sanitized);
        setMacroStale(Boolean(sanitized?.stale || sanitized?.unavailable));
        setMacroNotice(Boolean(sanitized?.stale || sanitized?.unavailable) ? getSnapshotFallbackMessage(sanitized) : "");
        setMacroByCountry((prev) => ({
          ...prev,
          [indicatorCountry]: {
            data: sanitized,
            cachedAt: Date.now()
          }
        }));
        writeResilientCache("macro-indicators", { country: indicatorCountry }, sanitized);
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        if (!cachedPayload) setMacroSnapshot(null);
        setMacroStale(true);
        const message = err?.message ? String(err.message) : "";
        setMacroNotice(cachedPayload ? getSnapshotFallbackMessage(cachedPayload) : (message || "Macro indicators unavailable right now."));
      } finally {
        if (isMounted) setMacroLoading(false);
      }
    };

    fetchMacro();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, indicatorCountry]);

  useEffect(() => {
    if (activeCategory !== "stocks") return;
    if (!earningsSymbols.length) {
      setEarningsItems([]);
      setEarningsStale(false);
      setEarningsNotice("");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const cacheParams = { symbols: earningsSymbols };
    const cached = readResilientCache("earnings-calendar", cacheParams);
    const cacheIsFresh =
      isCacheFresh(cached, EARNINGS_CLIENT_CACHE_TTL_MS) &&
      hasUsableEarningsPayload(cached.payload);
    if (cached?.payload && Array.isArray(cached.payload?.items)) {
      setEarningsItems(cached.payload.items);
      setEarningsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
      setEarningsNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
      if (cacheIsFresh && !cached.payload?.stale && !cached.payload?.unavailable) {
        setEarningsLoading(false);
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchEarningsCalendar = async () => {
      setEarningsLoading(true);
      try {
        const params = new URLSearchParams({
          symbols: earningsSymbols.join(","),
          limit: String(Math.max(1, earningsSymbols.length))
        });
        const res = await zeninFetch(`/earnings-calendar?${params.toString()}`, {
          signal: controller.signal
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!isMounted) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setEarningsItems(items);
        setEarningsStale(Boolean(data?.stale || data?.unavailable));
        setEarningsNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("earnings-calendar", cacheParams, data || { items });
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        if (!cached?.payload?.items) setEarningsItems([]);
        setEarningsStale(true);
        setEarningsNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
      } finally {
        if (isMounted) setEarningsLoading(false);
      }
    };

    fetchEarningsCalendar();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, earningsSymbols.join(",")]);

  const formatEarningsDate = (value) => {
    if (!value) return "No upcoming date";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <>
      <section className="watchlist-panel">
      <header className="watchlist-header">
        {/* Category tabs */}
        <div className="category-tabs">
          {categories.map((category) => (
            <button
              key={category}
              className={category === activeCategory ? "active" : ""}
              onClick={() => onCategorySelect(category)}
            >
              {category.toUpperCase()}
            </button>
          ))}
        </div>

        {/* View Mode Toggle */}
        {activeCategory !== "indicators" ? (
          <div className="watchlist-header-actions">
            <span
              className={`data-health-badge ${liveStatus === "connected" ? "ok" : liveStatus === "degraded" ? "hazard" : "loading"}`}
              title={lastLivePriceAt ? `Last live price tick ${new Date(lastLivePriceAt).toLocaleTimeString()}` : "Live prices start when tracked assets are available"}
            >
              <span className={`status-icon ${liveStatus === "idle" ? "spinner" : ""}`}>{liveStatus === "connected" ? "✓" : liveStatus === "degraded" ? "⚠" : "⟳"}</span>
              {liveStatus === "connected" ? "Live" : liveStatus === "degraded" ? "Polling" : "Connecting"}
            </span>
            <div className="view-mode-toggle">
              <button
                className={viewMode === "grid" ? "active" : ""}
                onClick={() => setViewMode("grid")}
                title="Grid View"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              </button>
              <button
                className={viewMode === "list" ? "active" : ""}
                onClick={() => setViewMode("list")}
                title="List View"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
              </button>
            </div>
          </div>
        ) : null}
      </header>
      {activeCategory === "stocks" && (
        <div className="theme-tabs" style={{ paddingTop: 0, marginBottom: "10px" }}>
          {mergedStockThemes.map((theme) => (
            <button
              key={theme}
              className={`theme-pill ${activeTheme === theme ? "active" : ""}`}
              onClick={() => onThemeSelect(theme)}
            >
              {theme}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <div className="loading-state">Loading market data...</div>
      ) : activeCategory === "indicators" ? (
        <div>
          <div className="indicator-controls-row">
            <div className="theme-tabs indicator-country-tabs" style={{ paddingTop: 0, marginBottom: 0 }}>
              {indicatorWatchlistCountries.map((country) => (
                <button
                  key={country.symbol}
                  className={`theme-pill ${indicatorCountry === country.symbol ? "active" : ""}`}
                  onClick={() => setIndicatorCountry(country.symbol)}
                >
                  {country.name}
                </button>
              ))}
            </div>
            <div className="indicator-toolbar">
              {activeIndicator ? (
                <button
                  className="modal-action-btn active"
                  onClick={() => onToggleStar(activeIndicator)}
                  title={`Remove ${activeIndicator.name} from watchlist`}
                >
                  Remove
                </button>
              ) : null}
              <span className={`data-health-badge ${macroLoading ? "loading" : macroStale ? "hazard" : "ok"}`} title={macroLoading ? "Refreshing indicators" : macroStale ? "Showing previous indicator snapshot" : "Indicators are up to date"}>
                <span className={`status-icon ${macroLoading ? "spinner" : ""}`}>{macroLoading ? "⟳" : macroStale ? "⚠" : "✓"}</span>
                Indicators
              </span>
            </div>
          </div>
          {indicatorWatchlistCountries.length === 0 ? (
            <div className="loading-state">Search for a country, then star it to track its indicators here.</div>
          ) : macroLoading && (!Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0) ? (
            <div className="loading-state">Loading macro indicators...</div>
          ) : !Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0 ? (
            <div className="loading-state">
              {macroStale && macroNotice ? macroNotice : "Waiting for macro indicators..."}
            </div>
          ) : (
            <IndicatorMetricsTable
              snapshot={macroSnapshot}
              onSelectMetric={(metric) =>
                setSelectedIndicatorMetric({
                  countryName: macroSnapshot?.countryName || activeIndicator?.name || indicatorCountry,
                  metric
                })
              }
            />
          )}
          {macroStale && macroNotice ? (
            <div className="snapshot-inline-note">{macroNotice}</div>
          ) : null}
        </div>
      ) : (
        <>
          {/* Show theme heading when a specific theme is selected */}
          {activeCategory === "stocks" && activeTheme && activeTheme !== "All" && (
            <div className="theme-heading">
              <span className="theme-label">{activeTheme}</span>
              <span className="theme-count">
                {displayedAssets.length} compan{displayedAssets.length === 1 ? "y" : "ies"}
              </span>
            </div>
          )}

          <div className={`asset-grid ${viewMode === "list" ? "list-mode" : ""}`}>
            {displayedAssets.length === 0 ? (
              <div className="empty-state">{addCategoryText}</div>
            ) : (
              pagedAssets.map((asset) => (
                <article
                  key={`${asset.symbol}-${asset.marketType || "default"}-${asset.category || "default"}-${asset.theme || "default"}`}
                  className={`asset-card clickable ${asset._liveDirection === "up" ? "live-up" : asset._liveDirection === "down" ? "live-down" : ""}`}
                  onClick={() => onAdd(asset)}
                  title={asset._liveUpdatedAt ? `Last price tick ${new Date(asset._liveUpdatedAt).toLocaleTimeString()}` : undefined}
                >
                  <div className="asset-card-main">
                    <div className="asset-identity">
                      <strong>{asset.symbol}</strong>
                      <p>{asset.name}</p>
                    </div>

                    <div className="asset-meta-group">
                      {activeCategory === "stocks" && asset.category && (
                        <span className="category-badge">{asset.category}</span>
                      )}
                    </div>

                    {asset.price != null && (
                      <div className="asset-price">
                        <span className="price-val">
                          {(() => {
                            if (asset.market === "Treasury") return "";
                            const activeCurrency = inferAssetCurrency(asset);
                            return getCurrencySymbol(activeCurrency);
                          })()}
                          {asset.price.toLocaleString(undefined, {
                            minimumFractionDigits: (asset.currency === "JPY" || asset.marketType === "spot") ? 0 : 2,
                            maximumFractionDigits: (asset.currency === "JPY" || asset.marketType === "spot") ? 0 : 2
                          })}
                          {asset.market === "Treasury" ? "%" : ""}
                        </span>
                        {asset.isMarketOpen === false && (
                          <span className="market-closed-dash" title={`Market Closed: ${asset.marketStatus || 'Holiday/Weekend'}`} style={{ color: "var(--color-text-secondary)", marginLeft: "4px", fontSize: "0.9rem" }}>–</span>
                        )}
                        {asset.priceChangePercent != null && asset.isMarketOpen !== false &&
                          (() => {
                            const change = Number(asset.priceChangePercent);
                            if (Number.isNaN(change)) return null;
                            return (
                              <span
                                className={`price-change ${change >= 0 ? "positive" : "negative"
                                  }`}
                              >
                                {change >= 0 ? "+" : ""}
                                {change.toFixed(2)}%
                              </span>
                            );
                          })()}
                      </div>
                    )}
                  </div>
                  <button
                    className={`star-button ${isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(asset);
                    }}
                    title={isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "Remove from watchlist" : "Add to watchlist"}
                  >
                    ★
                  </button>
                </article>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination-controls">
              <button
                className="pagination-button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
              >
                Previous
              </button>
              <div className="pagination-label">
                Page {currentPage} of {totalPages}
              </div>
              <button
                className="pagination-button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      </section>

      {activeCategory === "stocks" && (
        <section className="watchlist-panel glass" style={{ marginTop: "12px", padding: "12px 14px" }}>
          <div className="section-header" style={{ marginBottom: "8px" }}>
            <h2 style={{ margin: 0, fontSize: "14px" }}>Earnings</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="asset-count">Finviz</div>
              <span className={`data-health-badge ${earningsLoading ? "loading" : earningsStale ? "hazard" : "ok"}`} title={earningsLoading ? "Refreshing earnings calendar" : earningsStale ? "Showing previous earnings snapshot" : "Earnings are up to date"}>
                <span className={`status-icon ${earningsLoading ? "spinner" : ""}`}>{earningsLoading ? "⟳" : earningsStale ? "⚠" : "✓"}</span>
                Earnings
              </span>
            </div>
          </div>
          {earningsLoading && earningsRows.length === 0 ? (
            <div className="loading-state">Loading earnings calendar...</div>
          ) : earningsRows.length === 0 ? (
            <div className="loading-state">Waiting for earnings data...</div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {earningsRows.map(({ symbol, item }) => (
                <div
                  key={symbol}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(148,163,184,0.15)",
                    background: "var(--color-surface, rgba(5,5,5,0.35))"
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{symbol}</strong>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {formatEarningsDate(item?.nextEarnings || item?.earningsText)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {earningsStale && earningsNotice ? (
            <div className="snapshot-inline-note">{earningsNotice}</div>
          ) : null}
        </section>
      )}

      {selectedIndicatorMetric ? (
        <IndicatorMetricModal
          countryName={selectedIndicatorMetric.countryName}
          metric={selectedIndicatorMetric.metric}
          onClose={() => setSelectedIndicatorMetric(null)}
        />
      ) : null}
    </>

  );
}
