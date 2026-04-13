import { useEffect, useState } from "react";
import Chart from "react-apexcharts";
import { Watchlist } from "./components/Watchlist";
import { PortfolioModule } from "./components/PortfolioModule";
import { AssetModal } from "./components/AssetModal";
import { OptionsModule } from "./components/OptionsModule";
import { JournalModule } from "./components/JournalModule";
import { HomeModule } from "./components/HomeModule";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

function App() {
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeCategory, setActiveCategory] = useState("bonds");
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

  const [balance, setBalance] = useState(() => {
    const saved = localStorage.getItem("zenin_balance");
    return saved ? parseFloat(saved) : 10000;
  });

  useEffect(() => {
    localStorage.setItem("zenin_balance", balance.toString());
  }, [balance]);

  const deposit = (amount) => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    setBalance(prev => prev + amt);
  };

  const withdraw = (amount) => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (amt > balance) {
      alert("Insufficient balance to withdraw that amount.");
      return;
    }
    setBalance(prev => prev - amt);
  };

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

// TO
useEffect(() => {
    if (!activeCategory) return;

    setLoading(true);
    setError(null);

    fetch(`${BACKEND_URL}/watchlist?category=${activeCategory}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const allAssets = data.assets || [];
        setAssets(allAssets);
        setLoading(false);

        if (activeCategory !== "crypto" && allAssets.length > 0) {
          // Filter to current theme if stocks
          const themeAssets = activeCategory === "stocks" && activeTheme && activeTheme !== "All"
            ? allAssets.filter(a => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase())
            : allAssets;

          const visibleSymbols = themeAssets.slice(0, 15).map(a => a.symbol).join(",");
          if (!visibleSymbols) return;

          fetch(`${BACKEND_URL}/watchlist?category=${activeCategory}&symbols=${encodeURIComponent(visibleSymbols)}`)
            .then(res => res.json())
            .then(priceData => {
              const priceMap = {};
              (priceData.assets || []).forEach(a => {
                priceMap[a.symbol] = {
                  price: a.price,
                  priceChangePercent: a.priceChangePercent
                };
              });
              setAssets(prev => prev.map(a => ({
                ...a,
                price: priceMap[a.symbol]?.price ?? a.price,
                priceChangePercent: priceMap[a.symbol]?.priceChangePercent ?? a.priceChangePercent
              })));
            })
            .catch(console.error);
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [activeCategory]);

useEffect(() => {
    if (activeCategory !== "stocks" || !assets.length) return;

    const themeAssets = activeTheme && activeTheme !== "All"
      ? assets.filter(a => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase())
      : assets;

    const visibleSymbols = themeAssets.slice(0, 15).map(a => a.symbol).join(",");
    if (!visibleSymbols) return;

    fetch(`${BACKEND_URL}/watchlist?category=stocks&symbols=${encodeURIComponent(visibleSymbols)}`)
      .then(res => res.json())
      .then(priceData => {
        const priceMap = {};
        (priceData.assets || []).forEach(a => {
          priceMap[a.symbol] = {
            price: a.price,
            priceChangePercent: a.priceChangePercent
          };
        });
        setAssets(prev => prev.map(a => ({
          ...a,
          price: priceMap[a.symbol]?.price ?? a.price,
          priceChangePercent: priceMap[a.symbol]?.priceChangePercent ?? a.priceChangePercent
        })));
      })
      .catch(console.error);
  }, [activeTheme]);

  const handlePageChange = (page, visibleSymbols) => {
  if (activeCategory === "crypto" || !visibleSymbols.length) return;

  fetch(`${BACKEND_URL}/watchlist?category=${activeCategory}&symbols=${encodeURIComponent(visibleSymbols.join(","))}`)
    .then(res => res.json())
    .then(priceData => {
      const priceMap = {};
      (priceData.assets || []).forEach(a => {
        priceMap[a.symbol] = {
          price: a.price,
          priceChangePercent: a.priceChangePercent
        };
      });
      setAssets(prev => prev.map(a => ({
        ...a,
        price: priceMap[a.symbol]?.price ?? a.price,
        priceChangePercent: priceMap[a.symbol]?.priceChangePercent ?? a.priceChangePercent
      })));
    })
    .catch(console.error);
  };
  const handleCategorySelect = (category) => {
    setActiveCategory(category);
    if (category !== "stocks") setActiveTheme("Robotics");
  };

const addToPortfolio = async (asset, quantity = 1, orderType = "buy") => {
  const normalizedQuantity = Math.max(0, quantity);
  if (normalizedQuantity <= 0) return;

  const cost = (asset.price || 0) * normalizedQuantity;

  if (orderType === "buy") {
    if (cost > balance) {
      alert(`Insufficient balance. You need $${(cost - balance).toFixed(2)} more to complete this purchase.`);
      return;
    }
  }

  if (orderType === "sell") {
    const holding = portfolio.find(
      item => item.symbol === asset.symbol &&
      (item.marketType || "spot") === (asset.marketType || "spot")
    );
    if (!holding || holding.quantity <= 0) {
      alert(`You don't hold any ${asset.symbol} to sell.`);
      return;
    }
    if (normalizedQuantity > holding.quantity) {
      alert(`You can only sell up to ${holding.quantity} ${asset.symbol}.`);
      return;
    }
  }

  const direction = orderType === "buy" ? 1 : -1;
  const actualQuantity = normalizedQuantity * direction;

  const newTrade = {
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    asset: asset.symbol,
    type: orderType.toUpperCase(),
    price: asset.price || 0,
    profit: 0,
    status: "Open",
    quantity: normalizedQuantity
  };
  setTrades(prev => [newTrade, ...prev]);

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

    if (!response.ok) throw new Error(`Failed to ${orderType} asset`);

    // Update balance
    if (orderType === "buy") {
      setBalance(prev => prev - cost);
    } else {
      setBalance(prev => prev + cost);
    }

    fetch(`${BACKEND_URL}/db/portfolio`)
      .then(res => res.json())
      .then(data => {
        const priceMap = {};
        assets.forEach(a => {
          priceMap[a.symbol] = { price: a.price, priceChangePercent: a.priceChangePercent };
        });
        const holdings = (data.holdings || []).map(h => ({
          ...h,
          price: priceMap[h.symbol]?.price ?? h.price ?? asset.price,
          priceChangePercent: priceMap[h.symbol]?.priceChangePercent ?? h.priceChangePercent ?? asset.priceChangePercent
        }));
        setPortfolio(holdings);
      })
      .catch(console.error);

  } catch (err) {
    console.error(`Failed to ${orderType} asset:`, err);
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const sections = ["Home", "Portfolio", "Watchlist", "Options", "Journal"];

  return (
    <div className="app-layout">
      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <header className="sidebar-header">
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
          <h1 className="sidebar-brand">Zenin Capital</h1>
        </header>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <button
              key={section}
              className={`nav-btn ${activeSection === section ? "active" : ""}`}
              onClick={() => setActiveSection(section)}
              title={section}
            >
              <span className="nav-short">{section.charAt(0)}</span>
              <span className="nav-full">{section}</span>
            </button>
          ))}
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
            balance={balance}
            onDeposit={deposit}
            onWithdraw={withdraw}
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
                assets={assets}
                onAdd={setSelectedAsset}
                loading={loading}
                activeTheme={activeTheme}
                onThemeSelect={setActiveTheme}
                isInWatchlist={isInWatchlist}
                onToggleStar={toggleWatchlistStar}
                onPageChange={handlePageChange}
              />
            )}
          </div>
        )}

        {activeSection === "Portfolio" && (
          <div className="view-container">
            <PortfolioModule
              portfolio={portfolio}
              trades={trades}
              calculatePortfolioValue={calculatePortfolioValue}
              calculatePortfolioGain={calculatePortfolioGain}
              onRemove={removeFromPortfolio}
              onUpdateQuantity={updatePortfolioQuantity}
            />
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
          portfolio={portfolio}
          balance={balance}
        />
      )}
    </div>
  );
}

export default App;
