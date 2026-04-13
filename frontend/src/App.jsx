import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import { Watchlist } from "./components/Watchlist";
import { AssetModal } from "./components/AssetModal";
import { OptionsModule } from "./components/OptionsModule";
import { JournalModule } from "./components/JournalModule";
import { HomeModule } from "./components/HomeModule";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

function App() {
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeCategory, setActiveCategory] = useState("bonds");
  const [cryptoMarketType, setCryptoMarketType] = useState("spot");
  const [activeTheme, setActiveTheme] = useState("Robotics");
  const [portfolio, setPortfolio] = useState([]);
  const [watchlistAssets, setWatchlistAssets] = useState([]);
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem("zenin_trades");
    return saved ? JSON.parse(saved) : [];
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchType, setSearchType] = useState(null); // null, "tradfi" or "crypto"
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Load portfolio from database on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/db/portfolio`)
      .then((res) => res.json())
      .then((data) => setPortfolio(data.holdings || []))
      .catch((err) => console.error("Failed to load portfolio:", err));
  }, []);

  // Load persisted watchlist from database on mount
  useEffect(() => {
    fetch(`${BACKEND_URL}/db/watchlist`)
      .then((res) => res.json())
      .then((data) => setWatchlistAssets(data.assets || []))
      .catch((err) => console.error("Failed to load watchlist:", err));
  }, []);

  // Sync trades to localStorage (trades not in database yet)
  useEffect(() => {
    localStorage.setItem("zenin_trades", JSON.stringify(trades));
  }, [trades]);

  useEffect(() => {
    fetch(`${BACKEND_URL}/categories`)
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!searchTerm.trim() || !searchType) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    fetch(`${BACKEND_URL}/search?q=${encodeURIComponent(searchTerm)}&type=${searchType}`)
      .then((res) => res.json())
      .then((data) => setSearchResults(data.results || []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
  }, [searchTerm, searchType]);

  useEffect(() => {
    if (!activeCategory) return;

    setLoading(true);
    setError(null);
    setAssets([]);

    const marketTypeQuery =
      activeCategory === "crypto" ? `&marketType=${cryptoMarketType}` : "";

    fetch(`${BACKEND_URL}/watchlist?category=${activeCategory}${marketTypeQuery}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json();
      })
      .then((data) => {
        // Prices are now included inline for all categories (including stocks)
        setAssets(data.assets || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [activeCategory, cryptoMarketType]);

  const handleCategorySelect = (category) => {
    setActiveCategory(category);
    if (category !== "stocks") setActiveTheme("Robotics");
  };

  const addToPortfolio = async (asset, quantity = 1, orderType = "buy") => {
    const normalizedQuantity = Math.max(0, quantity);
    if (normalizedQuantity <= 0) return;

    const direction = orderType === "buy" ? 1 : -1;
    const actualQuantity = normalizedQuantity * direction;

    // 1. Log the trade for the Journal
    const newTrade = {
      id: Date.now(),
      date: new Date().toISOString().split('T')[0],
      asset: asset.symbol,
      type: orderType.toUpperCase(),
      price: asset.price || 0,
      profit: 0, // Initial execution
      status: "Open",
      quantity: normalizedQuantity
    };
    setTrades(prev => [newTrade, ...prev]);

    // 2. Add/Update holding in database (database handles accumulation)
    try {
      const holding = {
        ...asset,
        quantity: actualQuantity,
        orderType,
        date_added: new Date().toISOString()
      };

      const response = await fetch(`${BACKEND_URL}/db/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(holding)
      });

      if (!response.ok) {
        throw new Error(`Failed to ${orderType} asset`);
      }

      const result = await response.json();

      // 3. Update local state
      const existingIndex = portfolio.findIndex(
        (item) => item.symbol === asset.symbol &&
          (item.marketType || "spot") === (asset.marketType || "spot")
      );

      if (existingIndex >= 0) {
        // Update existing entry
        const existing = portfolio[existingIndex];
        const newQuantity = existing.quantity + actualQuantity;

        if (newQuantity <= 0) {
          // Remove from portfolio if quantity is zero or negative
          setPortfolio(prev => prev.filter((_, index) => index !== existingIndex));
        } else {
          // Update quantity
          setPortfolio(prev => prev.map((item, index) =>
            index === existingIndex ? { ...item, quantity: newQuantity } : item
          ));
        }
      } else if (actualQuantity > 0) {
        // Add new entry only if buying (positive quantity)
        setPortfolio(prev => [...prev, result]);
      }

    } catch (err) {
      console.error(`Failed to ${orderType} asset:`, err);
      // Revert trade log on error
      setTrades(prev => prev.filter(trade => trade.id !== newTrade.id));
    }

    setSelectedAsset(null);
  };

  const removeFromPortfolio = async (id) => {
    try {
      await fetch(`${BACKEND_URL}/db/portfolio/${id}`, { method: "DELETE" });
      setPortfolio((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("Failed to remove from portfolio:", err);
    }
  };

  const updatePortfolioQuantity = async (id, quantity) => {
    try {
      const holding = portfolio.find(item => item.id === id);
      if (holding) {
        const response = await fetch(`${BACKEND_URL}/db/portfolio/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...holding, quantity: Math.max(0, quantity) })
        });
        const updated = await response.json();
        setPortfolio(prev => prev.map(item => item.id === id ? updated : item));
      }
    } catch (err) {
      console.error("Failed to update quantity:", err);
    }
  };

  const calculatePortfolioValue = () => {
    return portfolio.reduce((total, item) => {
      const itemValue = (item.price || 0) * (item.quantity || 0);
      return total + itemValue;
    }, 0);
  };

  const calculatePortfolioGain = () => {
    return portfolio.reduce((total, item) => {
      const itemValue = (item.price || 0) * (item.quantity || 0);
      const prevPrice = item.price && item.priceChangePercent
        ? item.price / (1 + item.priceChangePercent / 100)
        : item.price;
      const prevValue = (prevPrice || 0) * (item.quantity || 0);
      return total + (itemValue - prevValue);
    }, 0);
  };

  // ── Watchlist helpers ─────────────────────────────────────────────────
  const isInWatchlist = (symbol, marketType) => {
    const mt = marketType || "spot";
    return watchlistAssets.some(
      (a) => a.symbol === symbol && (a.marketType || "spot") === mt
    );
  };

  const addToWatchlist = async (asset) => {
    const mt = asset.marketType || "spot";
    const payload = {
      symbol: asset.symbol,
      name: asset.name,
      type: asset.type || asset.theme || "stock",
      marketType: mt,
      date_added: new Date().toISOString(),
    };
    setWatchlistAssets((prev) => [...prev, payload]);
    try {
      const res = await fetch(`${BACKEND_URL}/db/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to add to watchlist");
      const saved = await res.json();
      setWatchlistAssets((prev) =>
        prev.map((a) =>
          a.symbol === saved.symbol &&
            (a.marketType || "spot") === (saved.marketType || "spot")
            ? saved : a
        )
      );
    } catch (err) {
      console.error("addToWatchlist failed:", err);
      setWatchlistAssets((prev) =>
        prev.filter(
          (a) => !(a.symbol === payload.symbol && (a.marketType || "spot") === mt)
        )
      );
    }
  };

  const removeFromWatchlist = async (symbol, marketType) => {
    const mt = marketType || "spot";
    setWatchlistAssets((prev) =>
      prev.filter(
        (a) => !(a.symbol === symbol && (a.marketType || "spot") === mt)
      )
    );
    try {
      const res = await fetch(
        `${BACKEND_URL}/db/watchlist/${encodeURIComponent(symbol)}?marketType=${encodeURIComponent(mt)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove from watchlist");
    } catch (err) {
      console.error("removeFromWatchlist failed:", err);
      fetch(`${BACKEND_URL}/db/watchlist`)
        .then((r) => r.json())
        .then((data) => setWatchlistAssets(data.assets || []));
    }
  };

  // Amber = in watchlist → remove. Grey = not in watchlist → add.
  const toggleWatchlistStar = (asset) => {
    if (isInWatchlist(asset.symbol, asset.marketType)) {
      removeFromWatchlist(asset.symbol, asset.marketType);
    } else {
      addToWatchlist(asset);
    }
  };

  const [activeSection, setActiveSection] = useState("Home");

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <header className="sidebar-header">
          <h1>Zenin Capital</h1>
        </header>
        <nav className="sidebar-nav">
          <button className={`nav-btn ${activeSection === "Home" ? "active" : ""}`} onClick={() => setActiveSection("Home")}>Home</button>
          <button className={`nav-btn ${activeSection === "Portfolio" ? "active" : ""}`} onClick={() => setActiveSection("Portfolio")}>Portfolio</button>
          <button className={`nav-btn ${activeSection === "Watchlist" ? "active" : ""}`} onClick={() => setActiveSection("Watchlist")}>Watchlist</button>
          <button className={`nav-btn ${activeSection === "Options" ? "active" : ""}`} onClick={() => setActiveSection("Options")}>Options</button>
          <button className={`nav-btn ${activeSection === "Journal" ? "active" : ""}`} onClick={() => setActiveSection("Journal")}>Journal</button>
        </nav>
      </aside>

      <main className="main-content">
        {activeSection === "Home" && (
          <HomeModule
            portfolio={portfolio}
            assets={assets}
            onSelectAsset={setSelectedAsset}
            calculatePortfolioValue={calculatePortfolioValue}
            calculatePortfolioGain={calculatePortfolioGain}
          />
        )}
        {activeSection === "Watchlist" && (
          <div className="view-container">
            <div className="search-section">
              <div className="search-controls">
                <input
                  type="text"
                  className="search-input"
                  placeholder={searchType ? `Search ${searchType === "tradfi" ? "stocks" : "crypto"} by symbol or name...` : "Select class and search assets..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-type-buttons">
                  <button
                    className={`search-type-button ${searchType === "tradfi" ? "active" : ""}`}
                    onClick={() => setSearchType("tradfi")}
                  >
                    TradFi
                  </button>
                  <button
                    className={`search-type-button ${searchType === "crypto" ? "active" : ""}`}
                    onClick={() => setSearchType("crypto")}
                  >
                    Crypto
                  </button>
                </div>
              </div>
              {searchTerm && (
                <div className="search-results">
                  {searchLoading ? (
                    <div className="search-loading">Searching...</div>
                  ) : searchResults.length > 0 ? (
                    <div className="search-results-list">
                      {searchResults.map((asset) => {
                        const inWatchlist = isInWatchlist(asset.symbol, asset.marketType);
                        return (
                          <div
                            key={asset.symbol}
                            className="search-result-item clickable"
                            onClick={() => setSelectedAsset(asset)}
                          >
                            <div className="search-result-info">
                              <div className="search-result-symbol">{asset.symbol}</div>
                              <div className="search-result-name">{asset.name}</div>
                              <div className="search-result-type">{asset.type?.toUpperCase()}</div>
                            </div>
                            <button
                              className={`star-button ${inWatchlist ? "active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWatchlistStar(asset);
                              }}
                              title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                            >
                              ★
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="search-no-results">No results found</div>
                  )}
                </div>
              )}
            </div>

            {error ? (
              <div className="error">Unable to load watchlist: {error}</div>
            ) : (
              <Watchlist
                categories={categories}
                activeCategory={activeCategory}
                onCategorySelect={handleCategorySelect}
                assets={assets.filter(a => isInWatchlist(a.symbol, a.marketType))}
                onAdd={setSelectedAsset}
                loading={loading}
                marketType={cryptoMarketType}
                onMarketTypeChange={setCryptoMarketType}
                activeTheme={activeTheme}
                onThemeSelect={setActiveTheme}
                isInWatchlist={isInWatchlist}
                onToggleStar={toggleWatchlistStar}
              />
            )}
          </div>
        )}

        {activeSection === "Portfolio" && (
          <div className="view-container">
            <div className="portfolio-analytics-row">
              <div className="metric-card glass">
                <label>Account Value</label>
                <div className="value">${calculatePortfolioValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className={`change ${calculatePortfolioGain() >= 0 ? "positive" : "negative"}`}>
                  {calculatePortfolioGain() >= 0 ? "▲" : "▼"} ${Math.abs(calculatePortfolioGain()).toFixed(2)}
                </div>
              </div>

              <div className="metric-card glass">
                <label>Best Performing</label>
                {portfolio.length > 0 ? (
                  (() => {
                    const best = [...portfolio].sort((a, b) => (b.priceChangePercent || 0) - (a.priceChangePercent || 0))[0];
                    return (
                      <>
                        <div className="value">{best.symbol}</div>
                        <div className="change positive">+{best.priceChangePercent?.toFixed(2)}%</div>
                      </>
                    );
                  })()
                ) : (
                  <div className="value">N/A</div>
                )}
              </div>

              <div className="metric-card chart-card glass">
                <Chart
                  options={{
                    chart: { type: 'donut', background: 'transparent' },
                    stroke: { show: false },
                    colors: ['#38bdf8', '#22c55e', '#ef4444'],
                    labels: ['Stocks', 'Crypto', 'ETFs'],
                    legend: { show: false },
                    dataLabels: { enabled: false },
                    plotOptions: {
                      pie: {
                        donut: {
                          size: '75%',
                          labels: {
                            show: true,
                            name: { show: true, fontSize: '12px', color: '#94a3b8' },
                            value: { show: true, fontSize: '16px', fontWeight: 700, color: '#f1f5f9' },
                            total: { show: true, label: 'Allocation', color: '#64748b' }
                          }
                        }
                      }
                    }
                  }}
                  series={[
                    portfolio.filter(i => !i.marketType).length, // Stocks
                    portfolio.filter(i => i.marketType === 'spot' || i.marketType === 'futures').length, // Crypto
                    portfolio.filter(i => i.theme === 'ETFs').length // ETFs
                  ]}
                  type="donut"
                  width="140"
                />
              </div>
            </div>

            <section className="portfolio-panel">
              <div className="section-header">
                <h2>Holdings</h2>
                <div className="asset-count">{portfolio.length} Positions</div>
              </div>
              {portfolio.length === 0 ? (
                <p>No holdings yet. Add assets from the watchlist.</p>
              ) : (
                <>
                  <div className="portfolio-list">
                    {portfolio.map((item) => {
                      const positionValue = (item.price || 0) * (item.quantity || 0);
                      const prevPrice = item.price && item.priceChangePercent
                        ? item.price / (1 + item.priceChangePercent / 100)
                        : item.price;
                      const positionGain = (item.price || 0) * (item.quantity || 0) - (prevPrice || 0) * (item.quantity || 0);
                      const gainPercent = prevPrice && item.priceChangePercent ? item.priceChangePercent : 0;

                      return (
                        <div key={item.id} className="portfolio-card">
                          <div className="portfolio-left">
                            <div>
                              <strong>{item.symbol}</strong>
                              <div>{item.name}</div>
                              {item.marketType && (
                                <div className="meta">{item.marketType.toUpperCase()}</div>
                              )}
                            </div>
                          </div>
                          <div className="portfolio-center">
                            <div className="price-info">
                              <div className="price">${(item.price || 0).toFixed(2)}</div>
                              <div className={`change ${gainPercent >= 0 ? 'positive' : 'negative'}`}>
                                {gainPercent >= 0 ? '+' : ''}{gainPercent.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                          <div className="portfolio-quantity">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.quantity || 0}
                              onChange={(e) => updatePortfolioQuantity(item.id, parseFloat(e.target.value) || 0)}
                              placeholder="Qty"
                            />
                          </div>
                          <div className="portfolio-value">
                            <div className="position-value">${positionValue.toFixed(2)}</div>
                            <div className={`position-gain ${positionGain >= 0 ? 'positive' : 'negative'}`}>
                              {positionGain >= 0 ? '+' : ''}${positionGain.toFixed(2)}
                            </div>
                          </div>
                          <button
                            className="portfolio-remove-button"
                            title="Remove asset from portfolio"
                            onClick={() => removeFromPortfolio(item.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="portfolio-summary">
                    <div className="summary-item">
                      <span>Total Value:</span>
                      <strong>${calculatePortfolioValue().toFixed(2)}</strong>
                    </div>
                    <div className="summary-item">
                      <span>Total Gain/Loss:</span>
                      <strong className={calculatePortfolioGain() >= 0 ? 'positive' : 'negative'}>
                        ${calculatePortfolioGain().toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {activeSection === "Options" && (
          <OptionsModule />
        )}

        {activeSection === "Journal" && (
          <JournalModule trades={trades} />
        )}
      </main>

      {selectedAsset && (
        <AssetModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onConfirm={addToPortfolio}
          isInWatchlist={isInWatchlist}
          onToggleStar={toggleWatchlistStar}
        />
      )}
    </div>
  );
}

export default App;
