import { useEffect, useState } from "react";

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
  marketType,
  onMarketTypeChange,
  activeTheme,
  onThemeSelect,
  isInWatchlist,
  onToggleStar,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("grid"); // "grid" or "list"

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTheme, assets]);

  // Derive the displayed assets based on active theme (stocks only)
  const displayedAssets =
    activeCategory === "stocks" && activeTheme && activeTheme !== "All"
      ? assets.filter(
        (a) => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase()
      )
      : assets;

  const itemsPerPage = activeCategory === "stocks" ? 15 : displayedAssets.length;
  const totalPages = Math.max(1, Math.ceil(displayedAssets.length / itemsPerPage));
  const pagedAssets = displayedAssets.slice(
  (currentPage - 1) * itemsPerPage,
  currentPage * itemsPerPage
);

useEffect(() => {
  onPageChange?.(currentPage, pagedAssets.map(a => a.symbol));
}, [currentPage, activeTheme]);


  return (
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

      {/* Crypto spot/futures toggle */}
      {activeCategory === "crypto" && (
        <div className="market-tabs">
          <button
            className={marketType === "spot" ? "active" : ""}
            onClick={() => onMarketTypeChange("spot")}
          >
            Spot
          </button>
          <button
            className={marketType === "futures" ? "active" : ""}
            onClick={() => onMarketTypeChange("futures")}
          >
            Futures
          </button>
        </div>
      )}

      {/* Stock theme filter pills */}
      {activeCategory === "stocks" && (
        <div className="theme-tabs">
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
                      {asset.marketType && (
                        <span className="meta">{asset.marketType.toUpperCase()}</span>
                      )}
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

          {activeCategory === "stocks" && totalPages > 1 && (
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

  );
}