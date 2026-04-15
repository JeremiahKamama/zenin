import { useEffect, useState } from "react";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

const STOCK_THEMES = [
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
  "Transportation",
];

export function Watchlist({
  categories,
  activeCategory,
  onCategorySelect,
  assets,
  onAdd,
  loading,
  activeTheme,
  onThemeSelect,
  isInWatchlist,
  onToggleStar,
  onPageChange,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"
  const [earningsPage, setEarningsPage] = useState(1);
  const [earningsItems, setEarningsItems] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState("");

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTheme]);

  useEffect(() => {
    setEarningsPage(1);
  }, [activeCategory, activeTheme]);

  // Derive the displayed assets based on active theme (stocks only)
  const displayedAssets =
    activeCategory === "stocks" && activeTheme && activeTheme !== "All"
      ? assets.filter(
        (a) => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase()
      )
      : assets;

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
          {STOCK_THEMES.map((theme) => (
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
              <div className="empty-state">No assets in this theme yet.</div>
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
