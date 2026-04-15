import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { Watchlist } from "./components/Watchlist";
import { PortfolioModule } from "./components/PortfolioModule";
import { AssetModal } from "./components/AssetModal";
import { OptionsModule } from "./components/OptionsModule";
import { JournalModule } from "./components/JournalModule";
import { HomeModule } from "./components/HomeModule";
import { PredictionMarketModule } from "./components/PredictionMarketModule";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
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

const normalizeTradeRecord = (trade, idx = 0) => {
  const quantity = Number(trade?.quantity);
  const price = Number(trade?.price);
  const notional = Number(trade?.notional);
  const balanceAfter = Number(trade?.balanceAfter ?? trade?.balance_after);
  const portfolioValueAfter = Number(trade?.portfolioValueAfter ?? trade?.portfolio_value_after);
  const accountEquityAfter = Number(trade?.accountEquityAfter ?? trade?.account_equity_after);
  const positionAfter = Number(trade?.positionAfter ?? trade?.position_after);
  const fallbackDate = new Date().toISOString().split("T")[0];
  const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";

  return {
    id: Number.isFinite(Number(trade?.id)) ? Number(trade.id) : Date.now() + idx,
    clientId: trade?.clientId || trade?.client_id || `local-${Date.now()}-${idx}`,
    date: trade?.date || fallbackDate,
    executedAt: trade?.executedAt || trade?.executed_at || null,
    asset: String(trade?.asset || "UNKNOWN").toUpperCase(),
    name: trade?.name || trade?.asset || "UNKNOWN",
    type: side === "sell" ? "SELL" : "BUY",
    side,
    marketType: String(trade?.marketType || "spot").toLowerCase(),
    status: trade?.status || "Filled",
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    price: Number.isFinite(price) ? price : 0,
    notional: Number.isFinite(notional) ? Math.abs(notional) : 0,
    balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : null,
    portfolioValueAfter: Number.isFinite(portfolioValueAfter) ? portfolioValueAfter : null,
    accountEquityAfter: Number.isFinite(accountEquityAfter) ? accountEquityAfter : null,
    positionAfter: Number.isFinite(positionAfter) ? positionAfter : null
  };
};

function App() {
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeCategory, setActiveCategory] = useState("bonds");
  const [activeTheme, setActiveTheme] = useState("Robotics");
  const [portfolio, setPortfolio] = useState([]);
  const [watchlistAssets, setWatchlistAssets] = useState([]);
  const [trades, setTrades] = useState(() => {
    const saved = localStorage.getItem("zenin_trades");
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((trade, idx) => normalizeTradeRecord(trade, idx)).filter((trade) => trade.quantity > 0);
    } catch {
      return [];
    }
  });
  const [homeMarketMovers, setHomeMarketMovers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchType, setSearchType] = useState(null); // null, "tradfi" or "crypto"
  const [customStockThemes, setCustomStockThemes] = useState(() => {
    try {
      const raw = localStorage.getItem("zenin_custom_stock_themes");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [watchlistPrompt, setWatchlistPrompt] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [tradeToast, setTradeToast] = useState(null);
  const searchSectionRef = useRef(null);
  const priceCacheRef = useRef(new Map());
  const portfolioRef = useRef([]);
  const PRICE_CACHE_TTL_MS = 60000;

  const stockThemes = useMemo(() => {
    const seen = new Set();
    return [...DEFAULT_STOCK_THEMES, ...customStockThemes]
      .map((theme) => String(theme || "").trim())
      .filter((theme) => {
        if (!theme) return false;
        const key = theme.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [customStockThemes]);

  // Replace the localStorage balance useState with:
const [balance, setBalance] = useState(10000);

useEffect(() => {
  fetch(`${BACKEND_URL}/db/balance`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load balance: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const loaded = Number(data?.balance);
      setBalance(Number.isFinite(loaded) ? loaded : 10000);
    })
    .catch((err) => {
      console.error(err);
    });
}, []);

  useEffect(() => {
    localStorage.setItem("zenin_balance", balance.toString());
  }, [balance]);

  useEffect(() => {
    localStorage.setItem("zenin_custom_stock_themes", JSON.stringify(customStockThemes));
  }, [customStockThemes]);

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

  useEffect(() => {
    let isMounted = true;
    fetch(`${BACKEND_URL}/db/trades?limit=2000`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load trades from backend");
        return res.json();
      })
      .then((data) => {
        if (!isMounted) return;
        const backendTrades = Array.isArray(data?.trades)
          ? data.trades.map((trade, idx) => normalizeTradeRecord(trade, idx)).filter((trade) => trade.quantity > 0)
          : [];
        if (backendTrades.length > 0) {
          setTrades(backendTrades);
        }
      })
      .catch((err) => console.error("Failed to load trade history:", err));
    return () => {
      isMounted = false;
    };
  }, []);


  useEffect(() => {
    const persistedTrades = trades.map((trade) => ({
      id: trade.id,
      clientId: trade.clientId || null,
      date: trade.date,
      executedAt: trade.executedAt || null,
      asset: trade.asset,
      name: trade.name || trade.asset,
      type: trade.type,
      side: trade.side || (trade.type === "SELL" ? "sell" : "buy"),
      marketType: trade.marketType || "spot",
      status: trade.status || "Filled",
      quantity: Number(trade.quantity) || 0,
      price: Number(trade.price) || 0,
      notional: Number(trade.notional) || 0,
      balanceAfter: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : null,
      portfolioValueAfter: Number.isFinite(Number(trade.portfolioValueAfter)) ? Number(trade.portfolioValueAfter) : null,
      accountEquityAfter: Number.isFinite(Number(trade.accountEquityAfter)) ? Number(trade.accountEquityAfter) : null,
      positionAfter: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null
    }));
    localStorage.setItem("zenin_trades", JSON.stringify(persistedTrades));
  }, [trades]);

  useEffect(() => {
    let isMounted = true;

    const chunkSymbols = (symbols, size = 35) => {
      const chunks = [];
      for (let i = 0; i < symbols.length; i += size) {
        chunks.push(symbols.slice(i, i + size));
      }
      return chunks;
    };

    const fetchHomeMovers = async () => {
      try {
        const baseRes = await fetch(`${BACKEND_URL}/watchlist?category=stocks`);
        if (!baseRes.ok) return;
        const baseData = await baseRes.json();
        const baseAssets = Array.isArray(baseData?.assets) ? baseData.assets : [];
        const allSymbols = baseAssets.map((asset) => asset.symbol).filter(Boolean);
        if (!allSymbols.length) {
          if (isMounted) setHomeMarketMovers([]);
          return;
        }

        const pricedBySymbol = new Map();
        const symbolChunks = chunkSymbols(allSymbols);

        for (const chunk of symbolChunks) {
          const chunkSet = new Set(chunk);
          const res = await fetch(
            `${BACKEND_URL}/watchlist?category=stocks&symbols=${encodeURIComponent(chunk.join(","))}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const assetsChunk = Array.isArray(data?.assets) ? data.assets : [];
          assetsChunk.forEach((asset) => {
            if (!chunkSet.has(asset.symbol)) return;
            pricedBySymbol.set(asset.symbol, {
              price: Number(asset.price),
              priceChangePercent: Number(asset.priceChangePercent)
            });
          });
        }

        const merged = baseAssets
          .map((asset) => {
            const priced = pricedBySymbol.get(asset.symbol);
            const price = priced?.price;
            const priceChangePercent = priced?.priceChangePercent;
            return {
              ...asset,
              price: Number.isFinite(price) ? price : asset.price,
              priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : asset.priceChangePercent
            };
          })
          .filter((asset) => Number.isFinite(Number(asset.priceChangePercent)) && Number.isFinite(Number(asset.price)));

        if (isMounted) setHomeMarketMovers(merged);
      } catch (error) {
        console.error("Failed to refresh home movers:", error);
      }
    };

    fetchHomeMovers();
    const intervalId = setInterval(fetchHomeMovers, 180000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

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
    if (!searchTerm) return;
    const handlePointerDown = (event) => {
      const container = searchSectionRef.current;
      if (!container) return;
      if (!container.contains(event.target)) {
        setSearchTerm("");
        setSearchResults([]);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [searchTerm]);

  const showTradeToast = (message, type = "info") => {
    setTradeToast({ id: Date.now(), message, type });
  };

  useEffect(() => {
    if (!tradeToast) return;
    const timer = setTimeout(() => setTradeToast(null), 2600);
    return () => clearTimeout(timer);
  }, [tradeToast]);

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

  const formatThemeLabel = (value) =>
    String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");

  const tradfiCategoryOptions = useMemo(() => {
    const blocked = new Set(["crypto", "indicators"]);
    const fromBackend = (Array.isArray(categories) ? categories : [])
      .map((category) => String(category || "").trim().toLowerCase())
      .filter((category) => category && !blocked.has(category));
    if (fromBackend.length > 0) return fromBackend;
    return ["stocks", "bonds", "commodities"];
  }, [categories]);

  const openWatchlistPrompt = (asset) => {
    const defaultCategory = tradfiCategoryOptions.includes("stocks")
      ? "stocks"
      : tradfiCategoryOptions[0] || "stocks";
    const defaultTheme = stockThemes.includes(activeTheme) ? activeTheme : stockThemes[0] || "";
    setWatchlistPrompt({
      asset,
      category: defaultCategory,
      theme: defaultTheme,
      customTheme: "",
      error: "",
      submitting: false
    });
  };

  const normalizeSymbolKey = (symbol) => String(symbol || "").trim().toUpperCase();
  const resolveMarketType = (asset) => {
    if (asset?.marketType) return String(asset.marketType).trim().toLowerCase();
    return normalizeAssetType(asset) === "crypto" ? "spot" : "equity";
  };
  const isCryptoHolding = (holding) => {
    const type = String(holding?.type || "").toLowerCase();
    const marketType = String(holding?.marketType || "").toLowerCase();
    return type === "crypto" || type === "stablecoin" || type === "exchange token" || marketType === "spot";
  };

  const holdingEntryPriceByKey = useMemo(() => {
    const positions = new Map();
    const orderedTrades = [...(Array.isArray(trades) ? trades : [])].sort((a, b) => {
      const aTs = new Date(a?.executedAt || a?.date || 0).getTime();
      const bTs = new Date(b?.executedAt || b?.date || 0).getTime();
      return aTs - bTs;
    });

    orderedTrades.forEach((trade) => {
      const symbol = normalizeSymbolKey(trade?.asset);
      const marketType = String(trade?.marketType || "spot").trim().toLowerCase();
      const key = `${symbol}::${marketType}`;
      const row = positions.get(key) || { qty: 0, cost: 0 };
      const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
      const qty = Math.abs(Number(trade?.quantity) || 0);
      const price = Number(trade?.price) || 0;
      if (qty <= 0 || price < 0) return;

      if (side === "buy") {
        row.qty += qty;
        row.cost += qty * price;
      } else {
        const closeQty = Math.min(row.qty, qty);
        const avgCost = row.qty > 0 ? row.cost / row.qty : 0;
        row.qty -= closeQty;
        row.cost -= closeQty * avgCost;
        if (row.qty <= 1e-8) {
          row.qty = 0;
          row.cost = 0;
        }
      }

      positions.set(key, row);
    });

    const entryByKey = new Map();
    positions.forEach((row, key) => {
      if (row.qty > 1e-8 && row.cost > 0) {
        entryByKey.set(key, row.cost / row.qty);
      }
    });
    return entryByKey;
  }, [trades]);

  const portfolioWithEntry = useMemo(() => {
    return portfolio.map((holding) => {
      const key = `${normalizeSymbolKey(holding.symbol)}::${String(holding.marketType || "spot").toLowerCase()}`;
      const computedEntry = holdingEntryPriceByKey.get(key);
      const fallbackEntry = Number(holding?.entryPrice);
      return {
        ...holding,
        entryPrice: Number.isFinite(fallbackEntry)
          ? fallbackEntry
          : (Number.isFinite(computedEntry) ? computedEntry : Number(holding?.price) || 0)
      };
    });
  }, [portfolio, holdingEntryPriceByKey]);
  const portfolioRefreshKey = useMemo(
    () => portfolio.map((holding) =>
      `${normalizeSymbolKey(holding.symbol)}::${String(holding.marketType || "spot").toLowerCase()}::${Number(holding.quantity) || 0}`
    ).join("|"),
    [portfolio]
  );

  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

const addToPortfolio = async (asset, quantity = 1, orderType = "buy") => {
  const normalizedQuantity = Math.max(0, quantity);
  if (normalizedQuantity <= 0) return;
  const normalizedSymbol = normalizeSymbolKey(asset.symbol);
  const normalizedMarketType = resolveMarketType(asset);
  const normalizedAsset = { ...asset, symbol: normalizedSymbol, marketType: normalizedMarketType };

  const tradePrice = Number(normalizedAsset.price) || 0;
  const notional = tradePrice * normalizedQuantity;

  if (orderType === "buy") {
    if (notional > balance) {
      const msg = `Insufficient balance. You need $${(notional - balance).toFixed(2)} more.`;
      showTradeToast(msg, "error");
      return { ok: false, reason: "insufficient_balance", message: msg };
    }
  }

  if (orderType === "sell") {
    const holding = portfolio.find(
      item => normalizeSymbolKey(item.symbol) === normalizedSymbol &&
      String(item.marketType || "spot").toLowerCase() === normalizedMarketType
    );
    if (!holding || holding.quantity <= 0) {
      const msg = `You don't hold any ${normalizedSymbol} to sell.`;
      showTradeToast(msg, "error");
      return { ok: false, reason: "no_position", message: msg };
    }
    if (normalizedQuantity > holding.quantity) {
      const msg = `You can only sell up to ${holding.quantity} ${normalizedSymbol}.`;
      showTradeToast(msg, "error");
      return { ok: false, reason: "size_exceeded", message: msg };
    }
  }

  const direction = orderType === "buy" ? 1 : -1;
  const actualQuantity = normalizedQuantity * direction;
  const executionTimestamp = new Date().toISOString();
  const executionDate = executionTimestamp.split("T")[0];

  try {
    const holding = {
      ...normalizedAsset,
      type: normalizeAssetType(normalizedAsset),
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

    const balanceType = orderType === "buy" ? "withdraw" : "deposit";
    let nextBalance = orderType === "buy" ? balance - notional : balance + notional;
    try {
      const balanceRes = await fetch(`${BACKEND_URL}/db/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: notional, type: balanceType })
      });
      if (!balanceRes.ok) {
        const text = await balanceRes.text();
        throw new Error(text || `HTTP ${balanceRes.status}`);
      }
      const balanceData = await balanceRes.json();
      const persistedBalance = Number(balanceData?.balance);
      if (Number.isFinite(persistedBalance)) {
        nextBalance = persistedBalance;
      }
    } catch (balanceErr) {
      console.error("Failed to persist balance via backend:", balanceErr);
    }
    setBalance(nextBalance);

    const mergeSources = [...assets, ...homeMarketMovers, asset];
    const priceMap = {};
    mergeSources.forEach((a) => {
      if (!a?.symbol) return;
      if (!priceMap[a.symbol]) {
        priceMap[a.symbol] = { price: a.price, priceChangePercent: a.priceChangePercent };
      }
    });

    let latestHoldings = null;
    try {
      const portfolioRes = await fetch(`${BACKEND_URL}/db/portfolio`);
      const data = await portfolioRes.json();
      latestHoldings = (data.holdings || []).map((h) => ({
        ...h,
        price: priceMap[h.symbol]?.price ?? h.price ?? tradePrice,
        priceChangePercent: priceMap[h.symbol]?.priceChangePercent ?? h.priceChangePercent ?? normalizedAsset.priceChangePercent
      }));
      setPortfolio(latestHoldings);
    } catch (portfolioErr) {
      console.error("Failed to refresh portfolio after trade:", portfolioErr);
    }

    const fallbackPortfolioValue = calculatePortfolioValue() + (orderType === "buy" ? notional : -notional);
    const portfolioValueAfter = latestHoldings
      ? latestHoldings.reduce((total, item) => total + ((item.price || 0) * (item.quantity || 0)), 0)
      : Math.max(0, fallbackPortfolioValue);
    const symbolHolding = latestHoldings?.find(
      (item) =>
        normalizeSymbolKey(item.symbol) === normalizedSymbol &&
        String(item.marketType || "spot").toLowerCase() === normalizedMarketType
    );
    const positionAfterRaw = Number(symbolHolding?.quantity);
    const clientId = `${normalizedSymbol}-${normalizedMarketType}-${Date.now()}`;

    const newTrade = {
      id: Date.now(),
      clientId,
      date: executionDate,
      executedAt: executionTimestamp,
      asset: normalizedSymbol,
      name: normalizedAsset.name || normalizedSymbol,
      type: orderType.toUpperCase(),
      side: orderType,
      marketType: normalizedMarketType,
      price: tradePrice,
      quantity: normalizedQuantity,
      notional,
      status: "Filled",
      balanceAfter: nextBalance,
      portfolioValueAfter,
      accountEquityAfter: nextBalance + portfolioValueAfter,
      positionAfter: Number.isFinite(positionAfterRaw) ? positionAfterRaw : (orderType === "sell" ? 0 : null)
    };

    setTrades((prev) => [newTrade, ...prev]);
    fetch(`${BACKEND_URL}/db/trades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newTrade)
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((savedTrade) => {
        const normalizedSaved = normalizeTradeRecord(savedTrade, 0);
        setTrades((prev) =>
          prev.map((t) => (t.clientId === normalizedSaved.clientId ? normalizedSaved : t))
        );
      })
      .catch((tradeErr) => {
        console.error("Failed to persist trade to backend:", tradeErr);
      });

  } catch (err) {
    console.error(`Failed to ${orderType} asset:`, err);
    showTradeToast(`Failed to ${orderType} ${normalizedSymbol}. Please try again.`, "error");
    return { ok: false, reason: "trade_failed", message: err?.message || "Trade failed" };
  }

  showTradeToast(`${orderType === "buy" ? "Bought" : "Sold"} ${normalizedQuantity} ${normalizedSymbol} successfully.`, "success");
  return { ok: true, action: orderType, symbol: normalizedSymbol };
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
    return portfolioWithEntry.reduce((total, item) => {
      const itemValue = (item.price || 0) * (item.quantity || 0);
      return total + itemValue;
    }, 0);
  };

  const calculatePortfolioGain = () => {
    return portfolioWithEntry.reduce((total, item) => {
      const itemValue = (item.price || 0) * (item.quantity || 0);
      const entryPrice = Number(item.entryPrice);
      const costBasis = Number.isFinite(entryPrice) ? entryPrice : Number(item.price) || 0;
      const costValue = costBasis * (item.quantity || 0);
      return total + (itemValue - costValue);
    }, 0);
  };

  useEffect(() => {
    if (!portfolioRef.current.length) return;
    let canceled = false;

    const chunk = (rows, size = 40) => {
      const out = [];
      for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
      return out;
    };

    const fetchQuotes = async (type, symbols) => {
      const prices = {};
      const batches = chunk(symbols);
      for (const batch of batches) {
        if (!batch.length) continue;
        try {
          const res = await fetch(
            `${BACKEND_URL}/prices?type=${encodeURIComponent(type)}&symbols=${encodeURIComponent(batch.join(","))}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const quoteMap = data?.prices && typeof data.prices === "object" ? data.prices : {};
          Object.assign(prices, quoteMap);
        } catch {
          // keep previous prices on quote fetch failures
        }
      }
      return prices;
    };

    const refreshHoldingsPrices = async () => {
      const symbolsByType = { tradfi: new Set(), crypto: new Set() };
      portfolioRef.current.forEach((holding) => {
        const symbol = normalizeSymbolKey(holding.symbol);
        if (!symbol) return;
        if (isCryptoHolding(holding)) symbolsByType.crypto.add(symbol);
        else symbolsByType.tradfi.add(symbol);
      });

      const [tradfiQuotes, cryptoQuotes] = await Promise.all([
        fetchQuotes("tradfi", [...symbolsByType.tradfi]),
        fetchQuotes("crypto", [...symbolsByType.crypto])
      ]);

      if (canceled) return;
      const combined = new Map();
      Object.entries({ ...tradfiQuotes, ...cryptoQuotes }).forEach(([symbol, quote]) => {
        const price = Number(quote?.price);
        const priceChangePercent = Number(quote?.priceChangePercent);
        if (!Number.isFinite(price) && !Number.isFinite(priceChangePercent)) return;
        combined.set(symbol, {
          price: Number.isFinite(price) ? price : null,
          priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
        });
      });

      if (!combined.size) return;
      setPortfolio((prev) => prev.map((holding) => {
        const symbol = normalizeSymbolKey(holding.symbol);
        const quote = combined.get(symbol);
        if (!quote) return holding;
        return {
          ...holding,
          price: quote.price ?? holding.price,
          priceChangePercent: quote.priceChangePercent ?? holding.priceChangePercent
        };
      }));
    };

    refreshHoldingsPrices();
    const intervalId = setInterval(refreshHoldingsPrices, 5 * 60 * 1000);
    return () => {
      canceled = true;
      clearInterval(intervalId);
    };
  }, [portfolioRefreshKey]);

  // ── Watchlist helpers ─────────────────────────────────────────────────
  const isInWatchlist = (symbol, marketType) => {
    const normalizedSymbol = normalizeSymbolKey(symbol);
    const mt = String(marketType || "").trim().toLowerCase();
    return watchlistAssets.some(
      (a) => {
        const watchlistSymbol = normalizeSymbolKey(a.symbol);
        const watchlistMt = String(a.marketType || "").trim().toLowerCase();
        if (watchlistSymbol !== normalizedSymbol) return false;
        if (!mt) return true;
        return watchlistMt === mt;
      }
    );
  };

  const addToWatchlist = async (asset) => {
    const mt = resolveMarketType(asset);
    const payload = {
      symbol: normalizeSymbolKey(asset.symbol),
      name: asset.name,
      type: normalizeAssetType(asset),
      category: String(asset.category || "").trim().toLowerCase() || null,
      theme: String(asset.theme || "").trim() || null,
      marketType: mt,
      date_added: new Date().toISOString(),
    };
    const sameEntry = (entry) =>
      normalizeSymbolKey(entry.symbol) === payload.symbol &&
      (String(entry.marketType || "").trim().toLowerCase() || "spot") === mt;
    setWatchlistAssets((prev) => {
      const next = prev.filter((entry) => !sameEntry(entry));
      return [...next, payload];
    });
    try {
      const res = await fetch(`${BACKEND_URL}/db/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to add to watchlist");
      const saved = await res.json();
      const savedSymbol = normalizeSymbolKey(saved?.symbol || payload.symbol);
      const savedMt = String(saved?.marketType || mt).trim().toLowerCase() || "spot";
      setWatchlistAssets((prev) => {
        const next = prev.filter(
          (entry) =>
            !(
              normalizeSymbolKey(entry.symbol) === savedSymbol &&
              (String(entry.marketType || "").trim().toLowerCase() || "spot") === savedMt
            )
        );
        return [...next, { ...payload, ...saved }];
      });
      return true;
    } catch (err) {
      console.error("addToWatchlist failed:", err);
      setWatchlistAssets((prev) =>
        prev.filter(
          (a) => !(a.symbol === payload.symbol && (a.marketType || "spot") === mt)
        )
      );
      return false;
    }
  };

  const removeFromWatchlist = async (symbol, marketType) => {
    const mt = String(marketType || "").trim().toLowerCase() || "spot";
    const normalizedSymbol = normalizeSymbolKey(symbol);
    try {
      const res = await fetch(
        `${BACKEND_URL}/db/watchlist/${encodeURIComponent(normalizedSymbol)}?marketType=${encodeURIComponent(mt)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove from watchlist");
      return true;
    } catch (err) {
      console.error("removeFromWatchlist failed:", err);
      return false;
    }
  };

  // Amber = in watchlist → remove. Grey = not in watchlist → add.
  const toggleWatchlistStar = async (asset) => {
    const normalizedSymbol = normalizeSymbolKey(asset.symbol);
    const existingEntries = watchlistAssets.filter(
      (a) => normalizeSymbolKey(a.symbol) === normalizedSymbol
    );
    const existing = existingEntries[0];
    const marketType = String(asset.marketType || existing?.marketType || resolveMarketType(asset) || "spot").toLowerCase();
    if (existingEntries.length > 0 || isInWatchlist(asset.symbol, marketType)) {
      const uniqueMarketTypes = [...new Set(existingEntries.map((entry) => String(entry.marketType || "spot").toLowerCase()))];
      const typesToRemove = uniqueMarketTypes.length > 0 ? uniqueMarketTypes : [marketType];
      const removedEntries = watchlistAssets.filter(
        (entry) => normalizeSymbolKey(entry.symbol) === normalizedSymbol
      );
      setWatchlistAssets((prev) =>
        prev.filter((entry) => normalizeSymbolKey(entry.symbol) !== normalizedSymbol)
      );
      const outcomes = await Promise.all(
        typesToRemove.map((mt) => removeFromWatchlist(asset.symbol, mt))
      );
      const failed = outcomes.some((ok) => !ok);
      if (failed) {
        setWatchlistAssets((prev) => {
          const dedupe = new Set(prev.map((entry) => `${normalizeSymbolKey(entry.symbol)}::${String(entry.marketType || "spot").toLowerCase()}`));
          const restored = removedEntries.filter((entry) => {
            const key = `${normalizeSymbolKey(entry.symbol)}::${String(entry.marketType || "spot").toLowerCase()}`;
            return !dedupe.has(key);
          });
          return [...prev, ...restored];
        });
        return "error";
      }
      return "updated";
    } else {
      if (searchType === "tradfi") {
        openWatchlistPrompt(asset);
        return "prompt";
      }
      const added = await addToWatchlist({ ...asset, marketType });
      return added ? "updated" : "error";
    }
  };

  const submitWatchlistPrompt = async () => {
    if (!watchlistPrompt?.asset) return;

    const selectedCategory = String(watchlistPrompt.category || "").trim().toLowerCase();
    const selectedThemeFromList = String(watchlistPrompt.theme || "").trim();
    const selectedCustomTheme = formatThemeLabel(watchlistPrompt.customTheme);
    const selectedTheme = selectedCustomTheme || selectedThemeFromList;

    if (!selectedCategory) {
      setWatchlistPrompt((prev) => ({ ...prev, error: "Choose a category before adding this asset." }));
      return;
    }
    if (!selectedTheme) {
      setWatchlistPrompt((prev) => ({ ...prev, error: "Choose a theme or type a new one." }));
      return;
    }
    if (selectedTheme.length < 2) {
      setWatchlistPrompt((prev) => ({ ...prev, error: "Theme name must be at least 2 characters long." }));
      return;
    }

    setWatchlistPrompt((prev) => ({ ...prev, submitting: true, error: "" }));

    try {
      if (!stockThemes.some((theme) => theme.toLowerCase() === selectedTheme.toLowerCase())) {
        setCustomStockThemes((prev) => [...prev, selectedTheme]);
      }
      const assetForWatchlist = {
        ...watchlistPrompt.asset,
        category: selectedCategory,
        theme: selectedTheme,
        type: "stock",
        marketType: "equity"
      };
      const added = await addToWatchlist(assetForWatchlist);
      if (!added) {
        setWatchlistPrompt((prev) => ({ ...prev, submitting: false, error: "Could not add asset to watchlist. Please try again." }));
        return;
      }
      setSearchResults((prev) =>
        prev.filter((row) => normalizeSymbolKey(row.symbol) !== normalizeSymbolKey(assetForWatchlist.symbol))
      );
      setWatchlistPrompt(null);
    } catch {
      setWatchlistPrompt((prev) => ({ ...prev, submitting: false, error: "Could not add asset to watchlist. Please try again." }));
    }
  };

  const sections = ["Home", "Portfolio", "Watchlist", "Options", "Predictions", "Journal"];
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
    if (section === "Predictions") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 17l5-5 4 3 7-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 4v13h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
            👤
          </div>
          <span className="sidebar-footer-email" title={userEmail}>
            {userEmail}
          </span>
        </button>

      </aside>

      <main className="main-content">
        {activeSection === "Home" && (
          <HomeModule
            portfolio={portfolioWithEntry}
            trades={trades}
            assets={assets}
            marketMovers={homeMarketMovers}
            watchlistAssets={watchlistAssets}
            onSelectAsset={setSelectedAsset}
            calculatePortfolioValue={calculatePortfolioValue}
            calculatePortfolioGain={calculatePortfolioGain}
            balance={balance}
          />
        )}
        {activeSection === "Watchlist" && (
          <div className="view-container">
            <div className="search-section" ref={searchSectionRef}>
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
                              onClick={async (e) => {
                                e.stopPropagation();
                                const outcome = await toggleWatchlistStar(asset);
                                if (outcome === "updated") {
                                  setSearchResults((prev) =>
                                    prev.filter((row) => normalizeSymbolKey(row.symbol) !== normalizeSymbolKey(asset.symbol))
                                  );
                                }
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
                watchlistAssets={watchlistAssets}
                onAdd={setSelectedAsset}
                loading={loading}
                activeTheme={activeTheme}
                onThemeSelect={setActiveTheme}
                stockThemes={stockThemes}
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
                portfolio={portfolioWithEntry}
                trades={trades}
                balance={balance}
                calculatePortfolioValue={calculatePortfolioValue}
                calculatePortfolioGain={calculatePortfolioGain}
                onRemove={removeFromPortfolio}
                onSelectAsset={(asset) => {
                  const enriched = {
                    ...asset,
                    _forceSell: false,
                    marketType: String(asset.marketType || "spot").toLowerCase()
                  };
                  setSelectedAsset(enriched);
                }}
                onSellAsset={(asset) => {
                  const enriched = {
                    ...asset,
                    _forceSell: true,
                    price: asset.price ?? 0,
                    marketType: String(asset.marketType || "spot").toLowerCase()
                  };
                  setSelectedAsset(enriched);
                }}
              />

          </div>
        )}

        {activeSection === "Options" && (
          <OptionsModule />
        )}

        {activeSection === "Predictions" && (
          <PredictionMarketModule />
        )}

        {activeSection === "Journal" && (
          <JournalModule
            trades={trades}
            portfolio={portfolioWithEntry}
            balance={balance}
            accountEquity={(Number(balance) || 0) + calculatePortfolioValue()}
          />
        )}
      </main>

      {selectedAsset && (
        <AssetModal
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onConfirm={addToPortfolio}
          isInWatchlist={isInWatchlist}
          onToggleStar={toggleWatchlistStar}
          portfolio={portfolioWithEntry}
          balance={balance}
        />
      )}

      {tradeToast && (
        <div className={`trade-toast ${tradeToast.type}`}>
          {tradeToast.message}
        </div>
      )}

      {watchlistPrompt?.asset && (
        <div className="watchlist-add-overlay" onClick={() => setWatchlistPrompt(null)}>
          <div className="watchlist-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="watchlist-add-header">
              <h3>Add {watchlistPrompt.asset.symbol} to Watchlist</h3>
              <button className="close-btn" onClick={() => setWatchlistPrompt(null)}>&times;</button>
            </div>
            <div className="watchlist-add-body">
              <label className="settings-field">
                <span>Category</span>
                <select
                  value={watchlistPrompt.category}
                  onChange={(e) =>
                    setWatchlistPrompt((prev) => ({ ...prev, category: e.target.value, error: "" }))
                  }
                >
                  {tradfiCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span>Theme</span>
                <select
                  value={watchlistPrompt.theme}
                  onChange={(e) =>
                    setWatchlistPrompt((prev) => ({ ...prev, theme: e.target.value, customTheme: "", error: "" }))
                  }
                >
                  <option value="">Select a theme</option>
                  {stockThemes.map((theme) => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span>Or create a new theme</span>
                <input
                  type="text"
                  placeholder="Type a new theme name"
                  value={watchlistPrompt.customTheme}
                  onChange={(e) =>
                    setWatchlistPrompt((prev) => ({ ...prev, customTheme: e.target.value, error: "" }))
                  }
                />
              </label>

              {watchlistPrompt.error ? (
                <p className="watchlist-add-error">{watchlistPrompt.error}</p>
              ) : (
                <p className="watchlist-add-help">
                  Pick an existing theme or create a new one. New themes will appear in the Stocks filters.
                </p>
              )}
            </div>
            <div className="watchlist-add-actions">
              <button className="settings-secondary-btn" onClick={() => setWatchlistPrompt(null)}>Cancel</button>
              <button
                className="settings-primary-btn"
                onClick={submitWatchlistPrompt}
                disabled={watchlistPrompt.submitting}
              >
                {watchlistPrompt.submitting ? "Adding..." : "Add to Watchlist"}
              </button>
            </div>
          </div>
        </div>
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
