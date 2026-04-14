import { useEffect, useRef, useState } from "react";
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
  const priceCacheRef = useRef(new Map());
  const PRICE_CACHE_TTL_MS = 60000;

  // Replace the localStorage balance useState with:
const [balance, setBalance] = useState(10000);

useEffect(() => {
  fetch(`${BACKEND_URL}/db/balance`)
    .then(res => res.json())
    .then(data => setBalance(data.balance || 10000))
    .catch(console.error);
}, []);

const deposit = async (amount) => {
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return;
  const res = await fetch(`${BACKEND_URL}/db/balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amt, type: "deposit" })
  });
  const data = await res.json();
  if (data.balance !== undefined) setBalance(data.balance);
};

const withdraw = async (amount) => {
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return;
  const res = await fetch(`${BACKEND_URL}/db/balance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amt, type: "withdraw" })
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  if (data.balance !== undefined) setBalance(data.balance);
};


// Add to database.js schema in initializeDatabase()

// Balance endpoints in index.js
app.get("/api/db/balance", (req, res) => {
  try {
    const row = db.prepare("SELECT balance FROM user_balance WHERE id = 1").get();
    res.json({ balance: row?.balance ?? 10000 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/db/balance", (req, res) => {
  try {
    const { amount, type } = req.body;
    if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) return res.status(400).json({ error: "Invalid amount" });
    const row = db.prepare("SELECT balance FROM user_balance WHERE id = 1").get();
    const current = row?.balance ?? 10000;
    const newBalance = type === "deposit" ? current + amount : current - amount;
    if (newBalance < 0) return res.status(400).json({ error: "Insufficient balance" });
    db.prepare("UPDATE user_balance SET balance = ? WHERE id = 1").run(newBalance);
    res.json({ balance: newBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});  

  useEffect(() => {
    localStorage.setItem("zenin_balance", balance.toString());
  }, [balance]);

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


  // In App.jsx, the trades useEffect currently stores full trade objects
// At minimum, don't store price data in localStorage
useEffect(() => {
  const safeTrades = trades.map(({ id, date, asset, type, quantity, status }) => ({
    id, date, asset, type, quantity, status
  }));
  localStorage.setItem("zenin_trades", JSON.stringify(safeTrades));
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

  const mergeAssetPrices = (incomingAssets, previousAssets = []) => {
    const prevMap = new Map(previousAssets.map((a) => [a.symbol, a]));
    const now = Date.now();
    return incomingAssets.map((asset) => {
      const cached = priceCacheRef.current.get(asset.symbol);
      const prev = prevMap.get(asset.symbol);
      const merged = {
        ...asset,
        price: asset.price ?? cached?.price ?? prev?.price ?? null,
        priceChangePercent: asset.priceChangePercent ?? cached?.priceChangePercent ?? prev?.priceChangePercent ?? null
      };
      if (merged.price != null || merged.priceChangePercent != null) {
        priceCacheRef.current.set(asset.symbol, {
          price: merged.price,
          priceChangePercent: merged.priceChangePercent,
          ts: now
        });
      }
      return merged;
    });
  };

  const refreshSymbolsForCategory = async (category, symbols = []) => {
    if (!symbols.length || category === "crypto") return;
    const now = Date.now();
    const uncachedSymbols = symbols.filter((symbol) => {
      const cached = priceCacheRef.current.get(symbol);
      return !cached || now - cached.ts > PRICE_CACHE_TTL_MS;
    });

    if (uncachedSymbols.length > 0) {
      try {
        const res = await fetch(`${BACKEND_URL}/watchlist?category=${category}&symbols=${encodeURIComponent(uncachedSymbols.join(","))}`);
        const priceData = await res.json();
        (priceData.assets || []).forEach((asset) => {
          if (asset.price != null || asset.priceChangePercent != null) {
            priceCacheRef.current.set(asset.symbol, {
              price: asset.price ?? null,
              priceChangePercent: asset.priceChangePercent ?? null,
              ts: Date.now()
            });
          }
        });
      } catch (err) {
        console.error("Price refresh failed:", err);
      }
    }

    setAssets((prev) => prev.map((asset) => {
      if (!symbols.includes(asset.symbol)) return asset;
      const cached = priceCacheRef.current.get(asset.symbol);
      if (!cached) return asset;
      return {
        ...asset,
        price: cached.price ?? asset.price,
        priceChangePercent: cached.priceChangePercent ?? asset.priceChangePercent
      };
    }));
  };

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
        const allAssets = Array.isArray(data) ? data : data.assets || [];
        setAssets((prev) => mergeAssetPrices(allAssets, prev));
        setLoading(false);

        if (activeCategory !== "crypto" && allAssets.length > 0) {
          // Filter to current theme if stocks
          const themeAssets = activeCategory === "stocks" && activeTheme && activeTheme !== "All"
            ? allAssets.filter(a => a.theme && a.theme.toLowerCase() === activeTheme.toLowerCase())
            : allAssets;

          const visibleSymbols = themeAssets.slice(0, 10).map((a) => a.symbol);
          if (!visibleSymbols.length) return;
          refreshSymbolsForCategory(activeCategory, visibleSymbols);
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

    const visibleSymbols = themeAssets.slice(0, 10).map((a) => a.symbol);
    if (!visibleSymbols.length) return;
    refreshSymbolsForCategory("stocks", visibleSymbols);
  }, [activeTheme]);

  const handlePageChange = (page, visibleSymbols) => {
  if (!visibleSymbols.length) return;
  refreshSymbolsForCategory(activeCategory, visibleSymbols.slice(0, 10));
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
  const [userEmail] = useState(() => localStorage.getItem("zenin_email") || "user@zenin.app");
  const sections = ["Home", "Portfolio", "Watchlist", "Options", "Journal"];

  const sectionIcon = (section) => {
    if (section === "Home") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 11.5L12 4l9 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 10v10h12V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (section === "Portfolio") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16v11H4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 7V5h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (section === "Watchlist") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    if (section === "Options") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 18h5V6H4zM15 18h5V10h-5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    }
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 4h12v16H6z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  };

  return (
    <div className={`app-layout ${isSidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <header className="sidebar-header">
          <h1 className="sidebar-brand">Zenin</h1>
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
        </header>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <button
              key={section}
              className={`nav-btn ${activeSection === section ? "active" : ""}`}
              onClick={() => setActiveSection(section)}
              title={section}
            >
              {isSidebarCollapsed ? (
                <span className="nav-icon">{sectionIcon(section)}</span>
              ) : (
                <span className="nav-full">{section}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-icon">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <span className="sidebar-footer-email" title={userEmail}>
            {userEmail}
          </span>
        </div>

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
                onSellAsset={(asset) => {
                  const enriched = {
                    ...asset,
                    _forceSell: true,
                    price: asset.price ?? 0,
                    marketType: asset.marketType || "spot"
                  };
                  setSelectedAsset(enriched);
                }}
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
