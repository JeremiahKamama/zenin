import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

const G7_COUNTRIES = [
  { code: "USA", name: "United States" },
  { code: "CAN", name: "Canada" },
  { code: "GBR", name: "United Kingdom" },
  { code: "FRA", name: "France" },
  { code: "DEU", name: "Germany" },
  { code: "ITA", name: "Italy" },
  { code: "JPN", name: "Japan" }
];

const DEFAULT_STOCK_THEMES = [
  "AI",
  "Defense",
  "Energy",
  "ETFs",
  "Gaming",
  "Hardware",
  "Metals",
  "Pharmco",
  "Robotics",
  "Space",
  "Transportation"
];
const MACRO_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
}) {
  const addCategoryText = (() => {
    const raw = String(activeCategory || "asset").trim();
    if (!raw) return "Add Asset";
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return `Add ${label}`;
  })();

  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [earningsPage, setEarningsPage] = useState(1);
  const [earningsItems, setEarningsItems] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsStale, setEarningsStale] = useState(false);
  const [indicatorCountry, setIndicatorCountry] = useState("USA");
  const [macroSnapshot, setMacroSnapshot] = useState(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroStale, setMacroStale] = useState(false);
  const [macroByCountry, setMacroByCountry] = useState({});
  const [selectedIndicatorMetric, setSelectedIndicatorMetric] = useState(null);

  const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();
  const normalizeMarketType = (value) => String(value || "").trim().toLowerCase() || "spot";

  const mergedStockThemes = (() => {
    const seen = new Set();
    return [...DEFAULT_STOCK_THEMES, ...(Array.isArray(stockThemes) ? stockThemes : [])]
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
      `${normalizeSymbol(entry.symbol)}::${normalizeMarketType(entry.marketType)}`,
      index
    ])
  );

  const getWatchlistOrder = (asset) => {
    const exactKey = `${normalizeSymbol(asset.symbol)}::${normalizeMarketType(asset.marketType)}`;
    if (orderMap.has(exactKey)) return orderMap.get(exactKey);
    const symbol = normalizeSymbol(asset.symbol);
    let fallback = Number.MAX_SAFE_INTEGER;
    orderMap.forEach((idx, key) => {
      if (key.startsWith(`${symbol}::`)) fallback = Math.min(fallback, idx);
    });
    return fallback;
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTheme]);

  useEffect(() => {
    if (activeCategory !== "indicators") {
      setIndicatorCountry("USA");
      setMacroSnapshot(null);
      setMacroStale(false);
      setSelectedIndicatorMetric(null);
    }
  }, [activeCategory]);

  useEffect(() => {
    setSelectedIndicatorMetric(null);
  }, [indicatorCountry]);

  useEffect(() => {
    setEarningsPage(1);
  }, [activeCategory, activeTheme]);

  // Show only assets currently in user's watchlist for the selected category.
  const starredAssets = assets
    .filter((asset) => isInWatchlist(asset.symbol, asset.marketType))
    .sort((a, b) => getWatchlistOrder(a) - getWatchlistOrder(b));

  // Derive displayed assets based on selected stock theme after watchlist filter.
  const displayedAssets =
    activeCategory === "stocks" && activeTheme && activeTheme !== "All"
      ? starredAssets.filter(
          (a) => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase()
        )
      : starredAssets;

  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(displayedAssets.length / itemsPerPage));
  const pagedAssets = displayedAssets.slice(
  (currentPage - 1) * itemsPerPage,
  currentPage * itemsPerPage
);
const pageSymbols = pagedAssets.map((a) => a.symbol).join(",");

  const activeIndicator = useMemo(() => {
    const matched = G7_COUNTRIES.find((country) => country.code === indicatorCountry);
    const countryName = matched?.name || indicatorCountry;
    return {
      symbol: indicatorCountry,
      name: `${countryName} Macro Indicators`,
      type: "indicator",
      category: "indicators",
      marketType: "macro",
      market: "Macro"
    };
  }, [indicatorCountry]);

  const earningsAssets = activeCategory === "stocks" ? displayedAssets : [];
  const earningsPerPage = 5;
  const earningsTotalPages = Math.max(1, Math.ceil(earningsAssets.length / earningsPerPage));
  const earningsSymbols = earningsAssets
    .slice((earningsPage - 1) * earningsPerPage, earningsPage * earningsPerPage)
    .map((a) => a.symbol);

useEffect(() => {
  onPageChange?.(currentPage, pageSymbols ? pageSymbols.split(",") : []);
}, [currentPage, activeTheme, activeCategory, pageSymbols]);

  useEffect(() => {
    if (activeCategory !== "indicators") return;

    let isMounted = true;
    const controller = new AbortController();
    const now = Date.now();
    const stateCachedEntry = macroByCountry[indicatorCountry];
    const storageCached = readResilientCache("macro-indicators", { country: indicatorCountry });
    const cachedPayload = stateCachedEntry?.data || storageCached?.payload || null;
    const cachedAt = Number(stateCachedEntry?.cachedAt || (storageCached?.updatedAt ? new Date(storageCached.updatedAt).getTime() : 0));
    if (cachedPayload) {
      setMacroSnapshot(cachedPayload);
      setMacroStale(Boolean(cachedPayload?.stale || cachedPayload?.unavailable));
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
        setMacroSnapshot(data || null);
        setMacroStale(Boolean(data?.stale || data?.unavailable));
        setMacroByCountry((prev) => ({
          ...prev,
          [indicatorCountry]: {
            data: data || null,
            cachedAt: Date.now()
          }
        }));
        writeResilientCache("macro-indicators", { country: indicatorCountry }, data || null);
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        if (!cachedPayload) setMacroSnapshot(null);
        setMacroStale(true);
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
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const cacheParams = { symbols: earningsSymbols };
    const cached = readResilientCache("earnings-calendar", cacheParams);
    if (cached?.payload && Array.isArray(cached.payload?.items)) {
      setEarningsItems(cached.payload.items);
      setEarningsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
    }

    const fetchEarningsCalendar = async () => {
      setEarningsLoading(true);
      try {
        const params = new URLSearchParams({
          symbols: earningsSymbols.join(","),
          limit: String(earningsPerPage)
        });
        const res = await fetch(`${BACKEND_URL}/earnings-calendar?${params.toString()}`, {
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
        writeResilientCache("earnings-calendar", cacheParams, data || { items });
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        if (!cached?.payload?.items) setEarningsItems([]);
        setEarningsStale(true);
      } finally {
        if (isMounted) setEarningsLoading(false);
      }
    };

    fetchEarningsCalendar();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, earningsPage, earningsSymbols.join(","), earningsPerPage]);

  const formatEarningsDate = (value) => {
    if (!value) return "No upcoming date";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "No upcoming date";
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
          <div className="theme-tabs" style={{ paddingTop: 0, marginBottom: "12px" }}>
            {G7_COUNTRIES.map((country) => (
              <button
                key={country.code}
                className={`theme-pill ${indicatorCountry === country.code ? "active" : ""}`}
                onClick={() => setIndicatorCountry(country.code)}
              >
                {country.name}
              </button>
            ))}
          </div>
          <div className="indicator-toolbar">
            <button
              className={`modal-action-btn ${isInWatchlist(activeIndicator.symbol, activeIndicator.marketType) ? "active" : ""}`}
              onClick={() => onToggleStar(activeIndicator)}
              title={isInWatchlist(activeIndicator.symbol, activeIndicator.marketType) ? "Remove from watchlist" : "Add to watchlist"}
            >
              {isInWatchlist(activeIndicator.symbol, activeIndicator.marketType) ? "Remove" : "Add"}
            </button>
            <span className={`data-health-badge ${macroLoading ? "loading" : macroStale ? "hazard" : "ok"}`} title={macroLoading ? "Refreshing indicators" : macroStale ? "Showing previous indicator snapshot" : "Indicators are up to date"}>
              <span className={`status-icon ${macroLoading ? "spinner" : ""}`}>{macroLoading ? "⟳" : macroStale ? "⚠" : "✓"}</span>
              Indicators
            </span>
          </div>
          {macroLoading && (!Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0) ? (
            <div className="loading-state">Loading macro indicators...</div>
          ) : !Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0 ? (
            <div className="loading-state">Waiting for macro indicators...</div>
          ) : (
            <IndicatorMetricsTable
              snapshot={macroSnapshot}
              onSelectMetric={(metric) =>
                setSelectedIndicatorMetric({
                  countryName: macroSnapshot?.countryName || activeIndicator.name,
                  metric
                })
              }
            />
          )}
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
                  key={`${asset.symbol}-${asset.marketType || asset.theme || "default"}`}
                  className="asset-card clickable"
                  onClick={() => onAdd(asset)}
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
                          {asset.market === "Treasury" ? "" : "$"}
                          {asset.price.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                             })}
                          {asset.market === "Treasury" ? "%" : ""}
                        </span>
                        {asset.priceChangePercent != null &&
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
                    className={`star-button ${isInWatchlist(asset.symbol, asset.marketType) ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(asset);
                    }}
                    title={isInWatchlist(asset.symbol, asset.marketType) ? "Remove from watchlist" : "Add to watchlist"}
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
              <div className="asset-count">Yahoo Finance</div>
              <span className={`data-health-badge ${earningsLoading ? "loading" : earningsStale ? "hazard" : "ok"}`} title={earningsLoading ? "Refreshing earnings calendar" : earningsStale ? "Showing previous earnings snapshot" : "Earnings are up to date"}>
                <span className={`status-icon ${earningsLoading ? "spinner" : ""}`}>{earningsLoading ? "⟳" : earningsStale ? "⚠" : "✓"}</span>
                Earnings
              </span>
            </div>
          </div>
          {earningsLoading && earningsItems.length === 0 ? (
            <div className="loading-state">Loading earnings calendar...</div>
          ) : earningsItems.length === 0 ? (
            <div className="loading-state">Waiting for earnings data...</div>
          ) : (
            <div style={{ display: "grid", gap: "8px" }}>
              {earningsItems.map((item) => (
                <div
                  key={item.symbol}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(15,23,42,0.35)"
                  }}
                >
                  <strong style={{ fontSize: "13px", color: "#e2e8f0" }}>{item.symbol}</strong>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                    {formatEarningsDate(item.nextEarnings)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {earningsTotalPages > 1 && (
            <div className="pagination-controls" style={{ marginTop: "10px", paddingTop: 0 }}>
              <button
                className="pagination-button"
                disabled={earningsPage === 1}
                onClick={() => setEarningsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="pagination-label">
                Page {earningsPage} of {earningsTotalPages}
              </div>
              <button
                className="pagination-button"
                disabled={earningsPage === earningsTotalPages}
                onClick={() => setEarningsPage((p) => Math.min(earningsTotalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
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
