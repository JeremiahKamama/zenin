import { useEffect, useState } from "react";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

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
  const formatMacroValue = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
  };

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
  const [earningsError, setEarningsError] = useState("");
  const [indicatorCountry, setIndicatorCountry] = useState("USA");
  const [macroSnapshot, setMacroSnapshot] = useState(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroError, setMacroError] = useState("");
  const [macroByCountry, setMacroByCountry] = useState({});

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
      setMacroError("");
    }
  }, [activeCategory]);

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
    const cachedEntry = macroByCountry[indicatorCountry];
    if (cachedEntry?.data) {
      setMacroSnapshot(cachedEntry.data);
      setMacroError("");
      if (now - Number(cachedEntry.cachedAt || 0) < MACRO_CLIENT_CACHE_TTL_MS) {
        setMacroLoading(false);
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchMacro = async () => {
      setMacroLoading(!cachedEntry?.data);
      setMacroError("");
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
        setMacroByCountry((prev) => ({
          ...prev,
          [indicatorCountry]: {
            data: data || null,
            cachedAt: Date.now()
          }
        }));
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        if (!cachedEntry?.data) setMacroSnapshot(null);
        setMacroError(err?.message || "Unable to load macro indicators.");
      } finally {
        if (isMounted) setMacroLoading(false);
      }
    };

    fetchMacro();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, indicatorCountry, macroByCountry]);

  useEffect(() => {
    if (activeCategory !== "stocks") return;
    if (!earningsSymbols.length) {
      setEarningsItems([]);
      setEarningsError("");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const fetchEarningsCalendar = async () => {
      setEarningsLoading(true);
      setEarningsError("");
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
        setEarningsItems(Array.isArray(data?.items) ? data.items : []);
      } catch (err) {
        if (err.name === "AbortError") return;
        if (!isMounted) return;
        setEarningsItems([]);
        setEarningsError("Unable to load earnings calendar.");
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
          {macroLoading ? (
            <div className="loading-state">Loading macro indicators...</div>
          ) : macroError ? (
            <div className="loading-state">{macroError}</div>
          ) : !Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0 ? (
            <div className="loading-state">No macro indicators available.</div>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              <div className="table-scroll">
                <table className="option-chain-table" style={{ minWidth: "620px" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Indicator</th>
                      <th>Previous</th>
                      <th>Current</th>
                      <th>Expected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {macroSnapshot.metrics.map((metric) => (
                      <tr key={metric.key}>
                        <td style={{ textAlign: "left", color: "#e2e8f0", fontWeight: 600 }}>{metric.label}</td>
                        <td className="greek">{formatMacroValue(metric.previous)}</td>
                        <td style={{ color: "#e2e8f0" }}>{formatMacroValue(metric.current)}</td>
                        <td style={{ color: "#38bdf8" }}>{formatMacroValue(metric.expectation)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>
                Source: {macroSnapshot?.source || "EODHD"}{macroSnapshot?.updatedAt ? ` · Updated ${new Date(macroSnapshot.updatedAt).toLocaleString()}` : ""}
              </div>
            </div>
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
            <div className="asset-count">Yahoo Finance</div>
          </div>
          {earningsLoading ? (
            <div className="loading-state">Loading earnings calendar...</div>
          ) : earningsError ? (
            <div className="loading-state">{earningsError}</div>
          ) : earningsItems.length === 0 ? (
            <div className="loading-state">No stock earnings found.</div>
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
    </>

  );
}
