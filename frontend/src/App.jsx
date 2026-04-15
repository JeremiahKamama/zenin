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

  const normalizeAssetType = (asset) => {
    const raw = String(asset?.type || "").toLowerCase();
    if (["stock", "stocks", "equity"].includes(raw)) return "stock";
    if (raw === "crypto") return "crypto";
    if (raw === "bond") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(raw)) return "commodity";
    if (["etf", "etfs"].includes(raw)) return "etf";
    if (asset?.marketType) return "crypto";
    if (asset?.theme || asset?.category) return "stock";
    return "stock";
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
      type: normalizeAssetType(asset),
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
      const text = await response.text();
      throw new Error(`Failed to ${orderType} asset: ${text}`);
    }

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
      type: normalizeAssetType(asset),
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

  const sections = ["Home", "Portfolio", "Watchlist", "Options", "Journal"];
  const [activeSection, setActiveSection] = useState(() => {
    const saved = localStorage.getItem("zenin_active_section");
    return sections.includes(saved) ? saved : "Home";
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [userEmail] = useState(() => localStorage.getItem("zenin_email") || "user@zenin.app");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("General");
  const [expandedSettingsPanels, setExpandedSettingsPanels] = useState({
    "general-display": true,
    "general-data": true,
    "accounts-connected": true,
    "layout-presets": true,
    "notifications-channels": true
  });
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [preferences, setPreferences] = useState(() => {
    const raw = localStorage.getItem("zenin_preferences");
    if (!raw) {
      return {
        timezoneMode: "browser",
        timezone: browserTimezone,
        refreshFrequency: "60s",
        hideValues: false,
        hidePortfolioPnl: false,
        layoutPreset: "default",
        notifyEmail: true,
        notifyBrowser: true,
        notifyPriceAlerts: true,
        notifyOrderEvents: true,
        notifyNews: false
      };
    }
    try {
      const parsed = JSON.parse(raw);
      return {
        timezoneMode: parsed.timezoneMode || "browser",
        timezone: parsed.timezone || browserTimezone,
        refreshFrequency: parsed.refreshFrequency || "60s",
        hideValues: !!parsed.hideValues,
        hidePortfolioPnl: !!parsed.hidePortfolioPnl,
        layoutPreset: parsed.layoutPreset || "default",
        notifyEmail: parsed.notifyEmail !== false,
        notifyBrowser: parsed.notifyBrowser !== false,
        notifyPriceAlerts: parsed.notifyPriceAlerts !== false,
        notifyOrderEvents: parsed.notifyOrderEvents !== false,
        notifyNews: !!parsed.notifyNews
      };
    } catch {
      return {
        timezoneMode: "browser",
        timezone: browserTimezone,
        refreshFrequency: "60s",
        hideValues: false,
        hidePortfolioPnl: false,
        layoutPreset: "default",
        notifyEmail: true,
        notifyBrowser: true,
        notifyPriceAlerts: true,
        notifyOrderEvents: true,
        notifyNews: false
      };
    }
  });
  const [connectedAccounts, setConnectedAccounts] = useState(() => {
    const raw = localStorage.getItem("zenin_connected_accounts");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [isConnectWindowOpen, setIsConnectWindowOpen] = useState(false);
  const [accountForm, setAccountForm] = useState({
    venueType: "cex",
    provider: "Binance",
    username: "",
    apiKey: ""
  });
  const settingsCategories = ["General", "Accounts", "Layout", "Notification"];

  useEffect(() => {
    localStorage.setItem("zenin_preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    localStorage.setItem("zenin_connected_accounts", JSON.stringify(connectedAccounts));
  }, [connectedAccounts]);

  useEffect(() => {
    localStorage.setItem("zenin_active_section", activeSection);
  }, [activeSection]);

  const toggleSettingsPanel = (panelKey) => {
    setExpandedSettingsPanels((prev) => ({ ...prev, [panelKey]: !prev[panelKey] }));
  };

  const CEX_OPTIONS = ["Binance", "Bybit", "Kraken", "OKX", "Coinbase Advanced"];
  const DEX_OPTIONS = ["Hyperliquid", "dYdX", "Aevo", "Lyra", "Derive"];
  const BROKER_OPTIONS = ["Interactive Brokers", "Alpaca", "Tradier", "Schwab", "Robinhood"];

  const venueOptions = accountForm.venueType === "cex"
    ? CEX_OPTIONS
    : accountForm.venueType === "dex"
      ? DEX_OPTIONS
      : BROKER_OPTIONS;

  const openConnectWindow = () => {
    setAccountForm({
      venueType: "cex",
      provider: CEX_OPTIONS[0],
      username: "",
      apiKey: ""
    });
    setIsConnectWindowOpen(true);
  };

  const connectAccount = () => {
    if (!accountForm.username.trim() || !accountForm.apiKey.trim()) return;
    const masked = `${accountForm.apiKey.trim().slice(0, 4)}••••${accountForm.apiKey.trim().slice(-4)}`;
    setConnectedAccounts((prev) => [
      {
        id: Date.now(),
        venueType: accountForm.venueType,
        provider: accountForm.provider,
        username: accountForm.username.trim(),
        apiKeyMasked: masked,
        connectedAt: new Date().toISOString()
      },
      ...prev
    ]);
    setIsConnectWindowOpen(false);
  };

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

        <button
          className="sidebar-footer settings-launcher"
          onClick={() => setIsSettingsOpen(true)}
          title="Open settings"
        >
          <div className="user-icon">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <span className="sidebar-footer-email" title={userEmail}>
            {userEmail}
          </span>
        </button>

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

      {isSettingsOpen && (
        <div className="settings-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-window" onClick={(e) => e.stopPropagation()}>
            <div className="settings-window-header">
              <h2>Workspace Settings</h2>
              <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>&times;</button>
            </div>

            <div className="settings-window-body">
              <aside className="settings-categories">
                {settingsCategories.map((category) => (
                  <button
                    key={category}
                    className={`settings-category-btn ${activeSettingsCategory === category ? "active" : ""}`}
                    onClick={() => setActiveSettingsCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </aside>

              <section className="settings-content">
                {activeSettingsCategory === "General" && (
                  <>
                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("general-display")}>
                        <span>Display Preferences</span>
                        <span>{expandedSettingsPanels["general-display"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["general-display"] && (
                        <div className="settings-panel-body">
                          <label className="settings-toggle-row">
                            <span>Hide account values</span>
                            <input
                              type="checkbox"
                              checked={preferences.hideValues}
                              onChange={(e) => setPreferences((prev) => ({ ...prev, hideValues: e.target.checked }))}
                            />
                          </label>
                          <label className="settings-toggle-row">
                            <span>Hide portfolio PnL</span>
                            <input
                              type="checkbox"
                              checked={preferences.hidePortfolioPnl}
                              onChange={(e) => setPreferences((prev) => ({ ...prev, hidePortfolioPnl: e.target.checked }))}
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("general-data")}>
                        <span>Data & Time</span>
                        <span>{expandedSettingsPanels["general-data"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["general-data"] && (
                        <div className="settings-panel-body">
                          <label className="settings-field">
                            <span>Timezone</span>
                            <select
                              value={preferences.timezoneMode}
                              onChange={(e) => {
                                const mode = e.target.value;
                                setPreferences((prev) => ({
                                  ...prev,
                                  timezoneMode: mode,
                                  timezone: mode === "browser" ? browserTimezone : prev.timezone
                                }));
                              }}
                            >
                              <option value="browser">Browser Default ({browserTimezone})</option>
                              <option value="utc">UTC</option>
                              <option value="ny">America/New_York</option>
                              <option value="london">Europe/London</option>
                            </select>
                          </label>
                          <label className="settings-field">
                            <span>Asset refresh frequency</span>
                            <select
                              value={preferences.refreshFrequency}
                              onChange={(e) => setPreferences((prev) => ({ ...prev, refreshFrequency: e.target.value }))}
                            >
                              <option value="30s">30 seconds</option>
                              <option value="60s">60 seconds</option>
                              <option value="120s">2 minutes</option>
                              <option value="300s">5 minutes</option>
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeSettingsCategory === "Accounts" && (
                  <>
                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("accounts-connected")}>
                        <span>Connected Accounts</span>
                        <span>{expandedSettingsPanels["accounts-connected"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["accounts-connected"] && (
                        <div className="settings-panel-body">
                          {connectedAccounts.length === 0 ? (
                            <p className="settings-meta">No connected CEX, DEX, or brokerage accounts yet.</p>
                          ) : (
                            <div className="connected-accounts-list">
                              {connectedAccounts.map((acc) => (
                                <div key={acc.id} className="connected-account-item">
                                  <div>
                                    <strong>{acc.provider}</strong>
                                    <p>{acc.username} • {acc.venueType.toUpperCase()}</p>
                                  </div>
                                  <span>{acc.apiKeyMasked}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <button className="settings-primary-btn" onClick={openConnectWindow}>
                            Add Account
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeSettingsCategory === "Layout" && (
                  <div className="settings-panel">
                    <button className="settings-panel-header" onClick={() => toggleSettingsPanel("layout-presets")}>
                      <span>Layout Presets</span>
                      <span>{expandedSettingsPanels["layout-presets"] ? "−" : "+"}</span>
                    </button>
                    {expandedSettingsPanels["layout-presets"] && (
                      <div className="settings-panel-body">
                        <label className="settings-field">
                          <span>Choose layout style</span>
                          <select
                            value={preferences.layoutPreset}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, layoutPreset: e.target.value }))}
                          >
                            <option value="default">Default</option>
                            <option value="compact">Compact</option>
                            <option value="expanded">Expanded</option>
                            <option value="focus">Focus Mode</option>
                          </select>
                        </label>
                        <p className="settings-meta">Layout preferences are saved to this browser profile.</p>
                      </div>
                    )}
                  </div>
                )}

                {activeSettingsCategory === "Notification" && (
                  <div className="settings-panel">
                    <button className="settings-panel-header" onClick={() => toggleSettingsPanel("notifications-channels")}>
                      <span>Notification Channels</span>
                      <span>{expandedSettingsPanels["notifications-channels"] ? "−" : "+"}</span>
                    </button>
                    {expandedSettingsPanels["notifications-channels"] && (
                      <div className="settings-panel-body">
                        <label className="settings-toggle-row">
                          <span>Email notifications</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyEmail}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, notifyEmail: e.target.checked }))}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Browser notifications</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyBrowser}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, notifyBrowser: e.target.checked }))}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Price alerts</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyPriceAlerts}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, notifyPriceAlerts: e.target.checked }))}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Order updates</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyOrderEvents}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, notifyOrderEvents: e.target.checked }))}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Market news digests</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyNews}
                            onChange={(e) => setPreferences((prev) => ({ ...prev, notifyNews: e.target.checked }))}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {isConnectWindowOpen && (
              <div className="connect-account-overlay" onClick={() => setIsConnectWindowOpen(false)}>
                <div className="connect-account-window" onClick={(e) => e.stopPropagation()}>
                  <div className="settings-window-header">
                    <h2>Connect Account</h2>
                    <button className="close-btn" onClick={() => setIsConnectWindowOpen(false)}>&times;</button>
                  </div>
                  <div className="connect-account-body">
                    <p className="settings-warning">
                      Use read-only API keys only. Trading or withdrawal permissions are not supported.
                    </p>
                    <label className="settings-field">
                      <span>Account type</span>
                      <select
                        value={accountForm.venueType}
                        onChange={(e) => {
                          const nextType = e.target.value;
                          const nextProvider = nextType === "cex"
                            ? CEX_OPTIONS[0]
                            : nextType === "dex"
                              ? DEX_OPTIONS[0]
                              : BROKER_OPTIONS[0];
                          setAccountForm((prev) => ({ ...prev, venueType: nextType, provider: nextProvider }));
                        }}
                      >
                        <option value="cex">Crypto Exchange (CEX)</option>
                        <option value="dex">Decentralized Exchange (DEX)</option>
                        <option value="broker">Stock Brokerage</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>Provider</span>
                      <select
                        value={accountForm.provider}
                        onChange={(e) => setAccountForm((prev) => ({ ...prev, provider: e.target.value }))}
                      >
                        {venueOptions.map((venue) => (
                          <option key={venue} value={venue}>{venue}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>User Name</span>
                      <input
                        type="text"
                        value={accountForm.username}
                        onChange={(e) => setAccountForm((prev) => ({ ...prev, username: e.target.value }))}
                        placeholder="Enter account username"
                      />
                    </label>
                    <label className="settings-field">
                      <span>API Key / ID</span>
                      <input
                        type="password"
                        value={accountForm.apiKey}
                        onChange={(e) => setAccountForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                        placeholder="Enter read-only API key or account ID"
                      />
                    </label>
                    <button
                      className="settings-primary-btn"
                      onClick={connectAccount}
                      disabled={!accountForm.username.trim() || !accountForm.apiKey.trim()}
                    >
                      Connect
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
