import { useEffect, useMemo, useRef, useState } from "react";
import { Watchlist } from "./components/Watchlist";
import { PortfolioModule } from "./components/PortfolioModule";
import { AssetModal } from "./components/AssetModal";
import { IndicatorCountryModal } from "./components/IndicatorCountryModal";
import { OptionsModule } from "./components/OptionsModule";
import { JournalModule } from "./components/JournalModule";
import { HomeModule } from "./components/HomeModule";
import { AnalyticsModule } from './components/AnalyticsModule';
import { PredictionMarketModule } from "./components/PredictionMarketModule";
import { CompanyProfilePage } from "./components/CompanyProfilePage";
import { TaxEstimator } from "./components/TaxEstimator";
import { calculateAccountSnapshot, calculatePortfolioMarketValue } from "./utils/accountMetrics";
import { calculateOptionPnL } from "./utils/optionsPnL";
import { ZeninLogo } from "./components/Branding";
import { readResilientCache, writeResilientCache } from "./utils/resilientData";
import { getSnapshotFallbackMessage } from "./utils/staleNotice";
import { zeninFetch } from "./utils/zeninFetch";
import { SpeedInsights } from "@vercel/speed-insights/react"



const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const ADMIN_EMAIL = String(import.meta.env.VITE_ADMIN_EMAIL || "admin@zenin.app").trim().toLowerCase();

function parseRouteFromLocation() {
  if (typeof window === "undefined") {
    return { type: "app", symbol: "" };
  }
  const match = window.location.pathname.match(/^\/app\/company\/([^/]+)$/i);
  if (!match) return { type: "app", symbol: "" };
  try {
    return {
      type: "company",
      symbol: decodeURIComponent(match[1] || "").trim().toUpperCase()
    };
  } catch {
    return { type: "company", symbol: String(match[1] || "").trim().toUpperCase() };
  }
}

function formatPlanLabel(plan, billingCycle = "monthly") {
  const normalized = String(plan || "").trim().toLowerCase();
  const cycle = String(billingCycle || "").trim().toLowerCase() === "yearly" ? "Yearly" : "Monthly";
  if (normalized === "desk") return `Desk Plan (${cycle})`;
  if (normalized === "pro") return `Pro Plan (${cycle})`;
  return `Starter Plan (${cycle})`;
}

function normalizeCurrentPlan(plan) {
  const normalized = String(plan || "").trim().toLowerCase();
  if (["starter", "pro", "desk"].includes(normalized)) return normalized;
  return "starter";
}

const PLAN_RANK = {
  starter: 0,
  pro: 1,
  desk: 2
};

const SECTION_MIN_PLAN = {
  Home: "starter",
  Portfolio: "starter",
  Watchlist: "starter",
  Analytics: "pro",
  Journal: "pro",
  Options: "desk",
  Predictions: "desk",
  "Tax Estimator": "starter"
};

function requiredPlanForSection(section) {
  return SECTION_MIN_PLAN[section] || "starter";
}

function hasSectionAccess(plan, section) {
  return hasSectionAccessForUser(plan, false, section);
}

function hasSectionAccessForUser(plan, isAdmin, section) {
  if (isAdmin) return true;
  const userPlan = normalizeCurrentPlan(plan);
  const requiredPlan = requiredPlanForSection(section);
  return Number(PLAN_RANK[userPlan] || 0) >= Number(PLAN_RANK[requiredPlan] || 0);
}

function isAdminUser(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const authProvider = String(user?.authProvider || "").trim().toLowerCase();
  return Boolean(email && email === ADMIN_EMAIL) || authProvider === "admin";
}

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
  const [activeCategory, setActiveCategory] = useState("");
  const [activeTheme, setActiveTheme] = useState("");
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
  const [watchlistStale, setWatchlistStale] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasSettled, setSearchHasSettled] = useState(false);
  const [searchType, setSearchType] = useState(null); // null, "tradfi", "crypto", or "indicator"
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
  const [routeState, setRouteState] = useState(() => parseRouteFromLocation());
  const [companyRouteAsset, setCompanyRouteAsset] = useState(null);
  const [tradeToast, setTradeToast] = useState(null);
  const searchSectionRef = useRef(null);
  const priceCacheRef = useRef(new Map());
  const portfolioRef = useRef([]);
  const searchRequestSeqRef = useRef(0);
  const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
  const WATCHLIST_CATEGORY_REFRESH_TTL_MS = 5 * 60 * 1000;

  const [activeOptionsTrades, setActiveOptionsTrades] = useState([]);
  const [multiChainCache, setMultiChainCache] = useState({}); // symbol -> chain

  const stockThemes = useMemo(() => {
    const seen = new Set();
    const derivedThemes = [
      ...(Array.isArray(assets) ? assets : []).map((asset) => asset?.theme),
      ...(Array.isArray(watchlistAssets) ? watchlistAssets : []).map((asset) => asset?.theme),
      ...customStockThemes
    ];
    return derivedThemes
      .map((theme) => String(theme || "").trim())
      .filter((theme) => {
        if (!theme) return false;
        const key = theme.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [assets, watchlistAssets, customStockThemes]);

  // Replace the localStorage balance useState with:
const [balance, setBalance] = useState(10000);

useEffect(() => {
  zeninFetch(`/db/balance`)
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
    zeninFetch(`/db/portfolio`)
      .then((res) => res.json())
      .then((data) => {
        const holdings = data.holdings || [];
        setPortfolio(holdings);
        
        // Hydrate activeOptionsTrades from portfolio
        const optionTrades = holdings
          .filter(h => String(h.marketType || "").toLowerCase() === "options")
          .map(h => ({
            ...h,
            id: `opt-${h.id}`,
            dbId: h.id,
            strategy: h.strategyName || h.name || "Strategy",
            asset: h.symbol,
            legs: h.legsJson || [],
            qty: Number(h.quantity) || 1,
            quantity: Number(h.quantity) || 1,
            notional: Number(h.quantity) || 1,
            netPremiumAtEntry: Number.isFinite(Number(h.entryPrice)) ? Number(h.entryPrice) : (Number(h.price) || 0),
            initialDelta: 0,
            initialTheta: 0,
            executedAt: h.openedAt || h.date_added || new Date().toISOString(),
            status: "OPEN",
            pnl: 0 // Will be recalculated by OptionsModule
          }));
        setActiveOptionsTrades(optionTrades);
      })
      .catch((err) => console.error("Failed to load portfolio:", err));
  }, []);

  // Load persisted watchlist from database on mount
  useEffect(() => {
    zeninFetch(`/db/watchlist`)
      .then((res) => res.json())
      .then((data) => setWatchlistAssets(data.assets || []))
      .catch((err) => console.error("Failed to load watchlist:", err));
  }, []);

  useEffect(() => {
    let isMounted = true;
    zeninFetch(`/db/trades?limit=2000`)
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

    const fetchHomeMovers = async () => {
      try {
        const baseRes = await zeninFetch(`/watchlist?category=stocks`);
        if (!baseRes.ok) return;
        const baseData = await baseRes.json();
        const snapshotAssets = Array.isArray(baseData?.assets) ? baseData.assets : [];

        const merged = snapshotAssets
          .map((asset) => {
            const price = Number(asset?.price);
            const priceChangePercent = Number(asset?.priceChangePercent);
            return {
              ...asset,
              price: Number.isFinite(price) ? price : null,
              priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
            };
          })
          .filter((asset) => Number.isFinite(asset.price) && Number.isFinite(asset.priceChangePercent));

        if (!merged.length) {
          if (isMounted) setHomeMarketMovers([]);
          return;
        }

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
    zeninFetch(`/categories`)
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!searchTerm.trim() || !searchType) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchHasSettled(false);
      return;
    }

    const controller = new AbortController();
    const requestId = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestId;
    setSearchLoading(true);
    setSearchHasSettled(false);

    fetch(`${BACKEND_URL}/search?q=${encodeURIComponent(searchTerm)}&type=${searchType}`, {
      signal: controller.signal
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        return data;
      })
      .then((data) => {
        if (searchRequestSeqRef.current !== requestId) return;
        setSearchResults(Array.isArray(data?.results) ? data.results : []);
        setSearchHasSettled(true);
      })
      .catch(() => {
        if (controller.signal.aborted || searchRequestSeqRef.current !== requestId) return;
        setSearchResults([]);
        setSearchHasSettled(true);
      })
      .finally(() => {
        if (searchRequestSeqRef.current !== requestId) return;
        setSearchLoading(false);
      });

    return () => controller.abort();
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

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = parseRouteFromLocation();
      setRouteState(nextRoute);
      if (nextRoute.type !== "company") {
        setCompanyRouteAsset(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const showTradeToast = (message, type = "info") => {
    setTradeToast({ id: Date.now(), message, type });
  };

  useEffect(() => {
    if (!tradeToast) return;
    const timer = setTimeout(() => setTradeToast(null), 2600);
    return () => clearTimeout(timer);
  }, [tradeToast]);

  const normalizeSymbolKey = (symbol) => String(symbol || "").trim().toUpperCase();
  const inferWatchlistMarketType = (asset) => {
    if (asset?.marketType) return String(asset.marketType).trim().toLowerCase();
    const rawType = String(asset?.type || "").trim().toLowerCase();
    const rawCategory = String(asset?.category || "").trim().toLowerCase();
    if (rawType === "indicator" || rawCategory === "indicators") return "macro";
    return rawType === "crypto" ? "spot" : "equity";
  };
  const inferWatchlistAssetKind = (asset) => {
    const rawType = String(asset?.type || "").trim().toLowerCase();
    const rawCategory = String(asset?.category || "").trim().toLowerCase();
    const marketType = String(asset?.marketType || "").trim().toLowerCase();
    if (["stock", "stocks", "equity"].includes(rawType)) return "stock";
    if (["etf", "etfs"].includes(rawType)) return "etf";
    if (rawType === "indicator" || rawCategory === "indicators") return "indicator";
    if (rawType === "crypto") return "crypto";
    if (rawType === "bond") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(rawType)) return "commodity";
    if (marketType === "macro") return "indicator";
    if (marketType === "equity") return "stock";
    if (marketType === "spot" || marketType === "perp") return "crypto";
    if (asset?.theme || asset?.category) return "stock";
    return "stock";
  };
  const normalizeMetaKey = (value) => String(value || "").trim().toLowerCase();
  const getAssetCatalogKey = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol);
    const marketType = String(asset?.marketType || "").trim().toLowerCase() || inferWatchlistMarketType(asset);
    const theme = normalizeMetaKey(asset?.theme);
    const category = normalizeMetaKey(asset?.category);
    const type = normalizeMetaKey(asset?.type);
    return [symbol, marketType, type, theme, category].join("::");
  };

  const getSearchResultKey = (asset) => (
    [
      normalizeSymbolKey(asset?.symbol),
      String(asset?.marketType || inferWatchlistMarketType(asset)).trim().toLowerCase(),
      normalizeMetaKey(asset?.type),
      normalizeMetaKey(asset?.category),
      normalizeMetaKey(asset?.theme),
      String(asset?.name || "").trim().toLowerCase()
    ].join("::")
  );

  const isStrictStockAsset = (asset) => {
    const normalizedType = inferWatchlistAssetKind(asset);
    return normalizedType === "stock" || normalizedType === "etf";
  };

  const doesWatchlistEntryMatchAsset = (entry, asset, { strictStockMeta = false } = {}) => {
    const entrySymbol = normalizeSymbolKey(entry?.symbol);
    const assetSymbol = normalizeSymbolKey(asset?.symbol);
    if (!entrySymbol || entrySymbol !== assetSymbol) return false;

    const entryMarketType = String(entry?.marketType || "").trim().toLowerCase() || inferWatchlistMarketType(entry);
    const assetMarketType = String(asset?.marketType || "").trim().toLowerCase() || inferWatchlistMarketType(asset);
    if (entryMarketType !== assetMarketType) return false;

    if (!strictStockMeta || !isStrictStockAsset(asset)) return true;

    const entryTheme = normalizeMetaKey(entry?.theme);
    const entryCategory = normalizeMetaKey(entry?.category);
    const assetTheme = normalizeMetaKey(asset?.theme);
    const assetCategory = normalizeMetaKey(asset?.category);
    const entryHasMeta = Boolean(entryTheme || entryCategory);
    const assetHasMeta = Boolean(assetTheme || assetCategory);

    if (!entryHasMeta || !assetHasMeta) return true;
    return entryTheme === assetTheme && entryCategory === assetCategory;
  };

  const mergeAssetPrices = (incomingAssets, previousAssets = []) => {
    const prevMap = new Map(previousAssets.map((asset) => [getAssetCatalogKey(asset), asset]));
    const now = Date.now();
    return incomingAssets.map((asset) => {
      const cached = priceCacheRef.current.get(asset.symbol);
      const prev = prevMap.get(getAssetCatalogKey(asset));
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

  const prunePriceCache = () => {
    const now = Date.now();
    const hardTtlMs = 20 * 60 * 1000;
    const entries = [...priceCacheRef.current.entries()];
    entries.forEach(([symbol, row]) => {
      if (!row?.ts || now - row.ts > hardTtlMs) {
        priceCacheRef.current.delete(symbol);
      }
    });

    const maxEntries = 2000;
    if (priceCacheRef.current.size > maxEntries) {
      const oldestFirst = [...priceCacheRef.current.entries()]
        .sort((a, b) => Number(a[1]?.ts || 0) - Number(b[1]?.ts || 0));
      const removeCount = priceCacheRef.current.size - maxEntries;
      for (let i = 0; i < removeCount; i += 1) {
        priceCacheRef.current.delete(oldestFirst[i][0]);
      }
    }
  };

  const isCacheEntryFresh = (cacheEntry, ttlMs) => {
    if (!cacheEntry?.updatedAt) return false;
    const updatedAtMs = new Date(cacheEntry.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < ttlMs;
  };

  const refreshSymbolsForCategory = async (category, symbols = []) => {
    prunePriceCache();
    if (!symbols.length || category === "crypto" || category === "indicators") return;
    const normalizedSymbols = [...new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((symbol) => normalizeSymbolKey(symbol))
        .filter(Boolean)
    )];
    if (!normalizedSymbols.length) return;
    const now = Date.now();
    const uncachedSymbols = normalizedSymbols.filter((symbol) => {
      const cached = priceCacheRef.current.get(symbol);
      return !cached || now - cached.ts > PRICE_CACHE_TTL_MS;
    });

    if (uncachedSymbols.length > 0) {
      try {
        const quoteType = category === "crypto" ? "crypto" : "tradfi";
        const res = await zeninFetch(
          `/prices?type=${encodeURIComponent(quoteType)}&symbols=${encodeURIComponent(uncachedSymbols.join(","))}`
        );
        const priceData = await res.json();
        const priceMap = priceData?.prices && typeof priceData.prices === "object" ? priceData.prices : {};
        Object.entries(priceMap).forEach(([symbol, quote]) => {
          const normalized = normalizeSymbolKey(symbol);
          if (!normalized) return;
          const price = Number(quote?.price);
          const priceChangePercent = Number(quote?.priceChangePercent);
          if (!Number.isFinite(price) && !Number.isFinite(priceChangePercent)) return;
          priceCacheRef.current.set(normalized, {
            price: Number.isFinite(price) ? price : null,
            priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null,
            ts: Date.now()
          });
        });
      } catch (err) {
        console.error("Price refresh failed:", err);
      }
    }

    setAssets((prev) => prev.map((asset) => {
      const normalizedSymbol = normalizeSymbolKey(asset?.symbol);
      if (!normalizedSymbols.includes(normalizedSymbol)) return asset;
      const cached = priceCacheRef.current.get(normalizedSymbol);
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

    const cacheParams = { category: activeCategory };
    const cached = readResilientCache("watchlist-category", cacheParams);
    const cachedAssets = Array.isArray(cached?.payload?.assets) ? cached.payload.assets : [];
    const cacheIsFresh = isCacheEntryFresh(cached, WATCHLIST_CATEGORY_REFRESH_TTL_MS);
    if (cachedAssets.length > 0) {
      setAssets((prev) => mergeAssetPrices(cachedAssets, prev));
      setWatchlistStale(Boolean(cached?.payload?.stale || cached?.payload?.unavailable));
      setWatchlistNotice(Boolean(cached?.payload?.stale || cached?.payload?.unavailable) ? getSnapshotFallbackMessage(cached?.payload) : "");
    } else {
      setWatchlistStale(false);
      setWatchlistNotice("");
    }
    setLoading(cachedAssets.length === 0);
    setError(null);

    if (cachedAssets.length > 0 && cacheIsFresh && !cached?.payload?.stale && !cached?.payload?.unavailable) {
      setLoading(false);
      return;
    }

    zeninFetch(`/watchlist?category=${activeCategory}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const allAssets = Array.isArray(data) ? data : data.assets || [];
        setAssets((prev) => mergeAssetPrices(allAssets, prev));
        setWatchlistStale(Boolean(data?.stale || data?.unavailable));
        setWatchlistNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("watchlist-category", cacheParams, {
          category: activeCategory,
          assets: allAssets,
          stale: Boolean(data?.stale || data?.unavailable),
          stale_reason: data?.stale_reason || null,
          tryLater: Boolean(data?.tryLater),
          statusMessage: data?.statusMessage || null
        });
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
        if (cachedAssets.length > 0) {
          setAssets((prev) => mergeAssetPrices(cachedAssets, prev));
        }
        setWatchlistStale(true);
        setWatchlistNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
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
  }, [activeTheme, activeCategory, assets]);

  const handlePageChange = (page, visibleSymbols) => {
  if (!visibleSymbols.length) return;
  refreshSymbolsForCategory(activeCategory, visibleSymbols.slice(0, 10));
  };
  const handleCategorySelect = (category) => {
    setActiveCategory(category);
    if (category !== "stocks") setActiveTheme("");
  };

  const normalizeAssetType = (asset) => {
    const raw = String(asset?.type || "").toLowerCase();
    const marketType = String(asset?.marketType || "").toLowerCase();
    if (["stock", "stocks", "equity"].includes(raw)) return "stock";
    if (raw === "crypto") return "crypto";
    if (raw === "indicator" || String(asset?.category || "").toLowerCase() === "indicators") return "indicator";
    if (raw === "bond") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(raw)) return "commodity";
    if (["etf", "etfs"].includes(raw)) return "etf";
    if (marketType === "macro") return "indicator";
    if (marketType === "equity") return "stock";
    if (marketType === "spot" || marketType === "perp") return "crypto";
    if (asset?.theme || asset?.category) return "stock";
    return "stock";
  };

  const navigateToAppRoute = () => {
    setRouteState({ type: "app", symbol: "" });
    setCompanyRouteAsset(null);
    if (typeof window !== "undefined" && window.location.pathname !== "/app") {
      window.history.pushState({ page: "app" }, "", "/app");
    }
  };

  const openCompanyProfile = (asset) => {
    if (!asset || normalizeAssetType(asset) !== "stock") return;
    const symbol = normalizeSymbolKey(asset.symbol);
    if (!symbol) return;
    setCompanyRouteAsset(asset);
    setSelectedAsset(null);
    setRouteState({ type: "company", symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: "company", symbol }, "", `/app/company/${encodeURIComponent(symbol)}`);
    }
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
    const derived = [
      ...(Array.isArray(categories) ? categories : []),
      ...(Array.isArray(watchlistAssets) ? watchlistAssets : []).map((asset) => asset?.category),
      ...(Array.isArray(assets) ? assets : []).map((asset) => asset?.category)
    ];
    const fromSources = derived
      .map((category) => String(category || "").trim().toLowerCase())
      .filter((category) => category && !blocked.has(category));
    return [...new Set(fromSources)];
  }, [assets, categories, watchlistAssets]);

  useEffect(() => {
    const availableCategories = (Array.isArray(categories) ? categories : [])
      .map((category) => String(category || "").trim().toLowerCase())
      .filter(Boolean);
    if (activeCategory && availableCategories.includes(activeCategory)) return;
    const preferredCategory = availableCategories.includes("stocks")
      ? "stocks"
      : availableCategories[0] || "";
    if (preferredCategory && preferredCategory !== activeCategory) {
      setActiveCategory(preferredCategory);
    }
  }, [activeCategory, categories]);

  const openWatchlistPrompt = (asset) => {
    const assetCategory = String(asset?.category || "").trim().toLowerCase();
    const defaultCategory = tradfiCategoryOptions.includes(assetCategory)
      ? assetCategory
      : (tradfiCategoryOptions.includes("stocks") ? "stocks" : tradfiCategoryOptions[0] || "");
    const defaultTheme = stockThemes.includes(activeTheme)
      ? activeTheme
      : (String(asset?.theme || "").trim() || stockThemes[0] || "");
    setWatchlistPrompt({
      asset,
      category: defaultCategory,
      theme: defaultTheme,
      customTheme: "",
      error: "",
      submitting: false
    });
  };

  const resolveMarketType = (asset) => {
    return inferWatchlistMarketType(asset);
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

  const watchlistMetaByHoldingKey = useMemo(() => {
    const next = new Map();
    (Array.isArray(watchlistAssets) ? watchlistAssets : []).forEach((entry) => {
      const key = `${normalizeSymbolKey(entry.symbol)}::${String(entry.marketType || "spot").toLowerCase()}`;
      if (!next.has(key)) {
        next.set(key, {
          theme: entry.theme || null,
          category: entry.category || null,
          name: entry.name || null,
          type: entry.type || null
        });
      }
    });
    return next;
  }, [watchlistAssets]);

  const portfolioWithEntry = useMemo(() => {
    return portfolio.map((holding) => {
      const key = `${normalizeSymbolKey(holding.symbol)}::${String(holding.marketType || "spot").toLowerCase()}`;
      const computedEntry = holdingEntryPriceByKey.get(key);
      const fallbackEntry = Number(holding?.entryPrice);
      const watchlistMeta = watchlistMetaByHoldingKey.get(key);
      return {
        ...holding,
        name: holding.name || watchlistMeta?.name || holding.symbol,
        type: holding.type || watchlistMeta?.type || holding.type,
        category: holding.category || watchlistMeta?.category || null,
        theme: holding.theme || watchlistMeta?.theme || null,
        entryPrice: Number.isFinite(fallbackEntry)
          ? fallbackEntry
          : (Number.isFinite(computedEntry) ? computedEntry : Number(holding?.price) || 0)
      };
    });
  }, [portfolio, holdingEntryPriceByKey, watchlistMetaByHoldingKey]);
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
    const tradePayload = {
      ...normalizedAsset,
      type: normalizeAssetType(normalizedAsset),
      quantity: normalizedQuantity,
      orderType,
      date_added: new Date().toISOString(),
      executedAt: executionTimestamp,
      date: executionDate,
      clientId: `${normalizedSymbol}-${normalizedMarketType}-${Date.now()}`
    };

    const response = await zeninFetch(`/db/execute-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tradePayload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to ${orderType} asset: ${text}`);
    }
    const data = await response.json();
    const persistedBalance = Number(data?.balance);
    setBalance(Number.isFinite(persistedBalance) ? persistedBalance : balance);

    const returnedHoldings = Array.isArray(data?.holdings) ? data.holdings : [];
    setPortfolio(returnedHoldings);

    const savedTrade = data?.trade ? normalizeTradeRecord(data.trade, 0) : null;
    if (savedTrade) {
      setTrades((prev) => [savedTrade, ...prev]);
    }

  } catch (err) {
    console.error(`Failed to ${orderType} asset:`, err);
    showTradeToast(`Failed to ${orderType} ${normalizedSymbol}. Please try again.`, "error");
    return { ok: false, reason: "trade_failed", message: err?.message || "Trade failed" };
  }

  showTradeToast(`${orderType === "buy" ? "Bought" : "Sold"} ${normalizedQuantity} ${normalizedSymbol} successfully.`, "success");
  return { ok: true, action: orderType, symbol: normalizedSymbol };
};

const handleOptionTradeExecuted = async (tradePayload) => {
  try {
    const atomicPayload = {
      symbol: tradePayload.asset || tradePayload.symbol,
      name: tradePayload.strategy || tradePayload.name || "Strategy",
      type: "options",
      marketType: "options",
      orderType: "buy",
      quantity: tradePayload.qty || 1,
      price: tradePayload.netPremiumAtEntry || 0,
      strategyName: tradePayload.strategy || tradePayload.name,
      legsJson: tradePayload.legs || [],
      executedAt: new Date().toISOString()
    };

    const response = await zeninFetch(`/db/execute-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(atomicPayload)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || "Failed to execute option strategy");
    }

    const data = await response.json();
    setBalance(data.balance ?? balance);
    setPortfolio(data.holdings || []);
    
    // Sync local activeOptionsTrades
    const matchingHoldings = (data.holdings || []).filter(h => 
      h.marketType === "options" && 
      (h.symbol === atomicPayload.symbol || h.symbol?.startsWith(atomicPayload.symbol))
    );
    
    if (matchingHoldings.length > 0) {
       setActiveOptionsTrades(prev => {
         const next = [...prev];
         matchingHoldings.forEach(h => {
           const existingIdx = next.findIndex(t => t.dbId === h.id || t.id === `opt-${h.id}`);
           const mapped = {
             ...h,
             id: `opt-${h.id}`,
             dbId: h.id,
             strategy: h.strategyName,
             asset: h.symbol,
             legs: h.legsJson || [],
             qty: Number(h.quantity) || Number(tradePayload.qty) || Number(tradePayload.quantity) || 1,
             quantity: Number(h.quantity) || Number(tradePayload.qty) || Number(tradePayload.quantity) || 1,
             notional: Number(tradePayload.notional) || Number(h.quantity) || 1,
             totalNotional: Number(tradePayload.notional) || Number(h.quantity) || 1,
             netPremiumAtEntry: Number.isFinite(Number(h.entryPrice)) ? Number(h.entryPrice) : (Number(h.price) || Number(tradePayload.netPremiumAtEntry) || 0),
             initialDelta: Number.isFinite(Number(tradePayload.initialDelta)) ? Number(tradePayload.initialDelta) : 0,
             initialTheta: Number.isFinite(Number(tradePayload.initialTheta)) ? Number(tradePayload.initialTheta) : 0,
             executedAt: h.openedAt || tradePayload.executedAt || new Date().toISOString(),
             status: "OPEN"
           };
           if (existingIdx >= 0) next[existingIdx] = mapped;
           else next.unshift(mapped);
         });
         return next;
       });
    } else if (atomicPayload.marketType === "options") {
       // Fallback: If for some reason holdings sync didn't return it, use the payload to show SOMETHING
       setActiveOptionsTrades(prev => [
         {
           id: `opt-temp-${Date.now()}`,
           strategy: atomicPayload.strategyName,
           asset: atomicPayload.symbol,
           legs: atomicPayload.legsJson || [],
           qty: atomicPayload.quantity,
           quantity: atomicPayload.quantity,
           notional: Number(tradePayload.notional) || Number(atomicPayload.quantity) || 1,
           totalNotional: Number(tradePayload.notional) || Number(atomicPayload.quantity) || 1,
           netPremiumAtEntry: Number(tradePayload.netPremiumAtEntry) || Number(atomicPayload.price) || 0,
           initialDelta: Number.isFinite(Number(tradePayload.initialDelta)) ? Number(tradePayload.initialDelta) : 0,
           initialTheta: Number.isFinite(Number(tradePayload.initialTheta)) ? Number(tradePayload.initialTheta) : 0,
           status: "OPEN",
           executedAt: atomicPayload.executedAt
         },
         ...prev
       ]);
    }

    const savedTrade = data?.trade ? normalizeTradeRecord(data.trade, 0) : null;
    if (savedTrade) {
      setTrades(prev => [savedTrade, ...prev]);
    }
    
    showTradeToast(`Executed ${atomicPayload.strategyName} on ${atomicPayload.symbol}`, "success");
  } catch (err) {
    console.error("Option trade failed:", err);
    showTradeToast(err.message, "error");
  }
};

const handleOptionTradeClosed = async (tradeId) => {
  try {
    const tradeObj = activeOptionsTrades.find(t => t.id === tradeId || t.dbId === tradeId);
    if (!tradeObj) return;

    const dbId = tradeObj.dbId || (typeof tradeId === 'string' ? tradeId.replace("opt-", "") : tradeId);
    
    const atomicPayload = {
      symbol: tradeObj.asset,
      name: tradeObj.strategy,
      type: "options",
      marketType: "options",
      orderType: "sell",
      quantity: tradeObj.qty || tradeObj.quantity || 1,
      price: tradeObj.currentMark || 0,
      strategyName: tradeObj.strategy,
      legsJson: tradeObj.legs || [],
      executedAt: new Date().toISOString()
    };

    const response = await zeninFetch(`/db/execute-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(atomicPayload)
    });

    if (!response.ok) {
       const errData = await response.json();
       throw new Error(errData.error || "Failed to close option position");
    }

    const data = await response.json();
    setBalance(data.balance ?? balance);
    setPortfolio(data.holdings || []);
    
    setActiveOptionsTrades(prev => prev.filter(t => t.id !== tradeId && t.dbId !== dbId));

    const savedTrade = data?.trade ? normalizeTradeRecord(data.trade, 0) : null;
    if (savedTrade) {
      setTrades(prev => [savedTrade, ...prev]);
    }

    showTradeToast(`Closed ${tradeObj.strategy} on ${tradeObj.asset}`, "success");
  } catch (err) {
    console.error("Failed to close option:", err);
    showTradeToast(err.message, "error");
  }
};

  const removeFromPortfolio = async (id) => {
    try {
      await zeninFetch(`/db/portfolio/${id}`, { method: "DELETE" });
      setPortfolio((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error("Failed to remove from portfolio:", err);
    }
  };

  const updatePortfolioQuantity = async (id, quantity) => {
    try {
      const holding = portfolio.find(item => item.id === id);
      if (holding) {
        const response = await zeninFetch(`/db/portfolio/${id}`, {
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

  const spotPrices = useMemo(() => {
    const prices = {};
    if (Array.isArray(assets)) {
      assets.forEach(a => {
        if (a && a.symbol && Number.isFinite(Number(a.price))) {
          prices[a.symbol.toUpperCase()] = Number(a.price);
        }
      });
    }
    if (Array.isArray(portfolio)) {
      portfolio.forEach(h => {
        if (h && h.symbol && Number.isFinite(Number(h.price))) {
          prices[h.symbol.toUpperCase()] = Number(h.price);
        }
      });
    }
    return prices;
  }, [assets, portfolio]);

  const portfolioMarketValue = useMemo(
    () => calculatePortfolioMarketValue(portfolioWithEntry),
    [portfolioWithEntry]
  );

  const totalOptionsPnL = useMemo(() => {
    return activeOptionsTrades.reduce((total, trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      return total + (metrics.pnl || 0);
    }, 0);
  }, [activeOptionsTrades, multiChainCache, spotPrices]);

  const calculatePortfolioValue = () => portfolioMarketValue;

  const calculatePortfolioGain = () => {
    const spotGain = portfolioWithEntry.reduce((total, item) => {
      const itemValue = (item.price || 0) * (item.quantity || 0);
      const entryPrice = Number(item.entryPrice);
      const costBasis = Number.isFinite(entryPrice) ? entryPrice : Number(item.price) || 0;
      const costValue = costBasis * (item.quantity || 0);
      return total + (itemValue - costValue);
    }, 0);
    return spotGain + (totalOptionsPnL || 0);
  };

  // PERIODIC OPTIONS CHAIN SYNC FOR ACTIVE TRADES
  useEffect(() => {
    if (!activeOptionsTrades || activeOptionsTrades.length === 0) return;
    
    let isMounted = true;
    const assetsWithTrades = Array.from(new Set(activeOptionsTrades.map(t => t.asset)));
    
    const refreshActiveOptionsChains = async () => {
      for (const asset of assetsWithTrades) {
         try {
           const res = await zeninFetch("/options/crypto", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ currency: asset })
           });
           if (!res.ok) continue;
           const data = await res.json();
           if (isMounted && data && data.chain) {
             setMultiChainCache(prev => ({ ...prev, [asset]: data.chain }));
           }
         } catch (err) {
           console.warn(`Failed to sync App options chain for ${asset}:`, err);
         }
      }
    };

    refreshActiveOptionsChains();
    const interval = setInterval(refreshActiveOptionsChains, 180000); // 3 minutes
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeOptionsTrades]);


  const accountMetrics = useMemo(
    () => calculateAccountSnapshot({
      trades,
      portfolioValue: portfolioMarketValue,
      optionsUnrealizedPnL: totalOptionsPnL,
      balance
    }),
    [trades, portfolioMarketValue, totalOptionsPnL, balance]
  );


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
  const isInWatchlist = (assetOrSymbol, marketType, options = {}) => {
    if (assetOrSymbol && typeof assetOrSymbol === "object") {
      return watchlistAssets.some((entry) => doesWatchlistEntryMatchAsset(entry, assetOrSymbol, options));
    }

    const normalizedSymbol = normalizeSymbolKey(assetOrSymbol);
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
    const payloadKey = getAssetCatalogKey(payload);
    const sameEntry = (entry) => getAssetCatalogKey(entry) === payloadKey;
    setWatchlistAssets((prev) => {
      const next = prev.filter((entry) => !sameEntry(entry));
      return [...next, payload];
    });
    try {
      const res = await zeninFetch(`/db/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to add to watchlist");
      const saved = await res.json();
      const savedEntry = { ...payload, ...saved };
      const savedKey = getAssetCatalogKey(savedEntry);
      setWatchlistAssets((prev) => {
        const next = prev.filter(
          (entry) => getAssetCatalogKey(entry) !== savedKey
        );
        return [...next, savedEntry];
      });
      return true;
    } catch (err) {
      console.error("addToWatchlist failed:", err);
      setWatchlistAssets((prev) =>
        prev.filter((entry) => getAssetCatalogKey(entry) !== payloadKey)
      );
      return false;
    }
  };

  const removeFromWatchlist = async ({ symbol, marketType, category = null, theme = null }) => {
    const mt = String(marketType || "").trim().toLowerCase() || "spot";
    const normalizedSymbol = normalizeSymbolKey(symbol);
    const params = new URLSearchParams({ marketType: mt });
    if (category) params.set("category", String(category).trim().toLowerCase());
    if (theme) params.set("theme", String(theme).trim());
    try {
      const res = await zeninFetch(
        `/db/watchlist/${encodeURIComponent(normalizedSymbol)}?${params.toString()}`,
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
    const strictStockMeta = isStrictStockAsset(asset);
    const existingEntries = watchlistAssets.filter(
      (entry) => doesWatchlistEntryMatchAsset(entry, asset, { strictStockMeta })
    );
    const existing = existingEntries[0];
    const marketType = String(asset.marketType || existing?.marketType || resolveMarketType(asset) || "spot").toLowerCase();
    if (existingEntries.length > 0 || isInWatchlist(asset, undefined, { strictStockMeta })) {
      const removedEntries = watchlistAssets.filter(
        (entry) => doesWatchlistEntryMatchAsset(entry, asset, { strictStockMeta })
      );
      setWatchlistAssets((prev) =>
        prev.filter((entry) => !doesWatchlistEntryMatchAsset(entry, asset, { strictStockMeta }))
      );
      const outcomes = await Promise.all(
        (removedEntries.length > 0 ? removedEntries : [{ symbol: asset.symbol, marketType, category: asset?.category, theme: asset?.theme }]).map((entry) =>
          removeFromWatchlist({
            symbol: entry.symbol,
            marketType: entry.marketType || marketType,
            category: strictStockMeta ? entry.category : null,
            theme: strictStockMeta ? entry.theme : null
          })
        )
      );
      const failed = outcomes.some((ok) => !ok);
      if (failed) {
        setWatchlistAssets((prev) => {
          const dedupe = new Set(prev.map((entry) => getAssetCatalogKey(entry)));
          const restored = removedEntries.filter((entry) => {
            const key = getAssetCatalogKey(entry);
            return !dedupe.has(key);
          });
          return [...prev, ...restored];
        });
        return "error";
      }
      return "updated";
    } else {
      if (normalizeAssetType(asset) === "stock") {
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
      setWatchlistPrompt(null);
    } catch {
      setWatchlistPrompt((prev) => ({ ...prev, submitting: false, error: "Could not add asset to watchlist. Please try again." }));
    }
  };

  const routedCompanyAsset = useMemo(() => {
    if (routeState.type !== "company" || !routeState.symbol) return null;
    const candidates = [
      companyRouteAsset,
      ...(Array.isArray(watchlistAssets) ? watchlistAssets : []),
      ...(Array.isArray(assets) ? assets : []),
      ...(Array.isArray(portfolioWithEntry) ? portfolioWithEntry : []),
      ...(Array.isArray(searchResults) ? searchResults : [])
    ].filter(
      (entry) =>
        entry &&
        normalizeSymbolKey(entry.symbol) === routeState.symbol &&
        normalizeAssetType(entry) === "stock"
    );

    if (!candidates.length) {
      return { symbol: routeState.symbol, name: routeState.symbol, type: "stock" };
    }

    return [...candidates].sort((a, b) => {
      const aScore = [a?.theme, a?.category, a?.role, a?.edge, a?.name].filter(Boolean).length;
      const bScore = [b?.theme, b?.category, b?.role, b?.edge, b?.name].filter(Boolean).length;
      return bScore - aScore;
    })[0];
  }, [routeState, companyRouteAsset, watchlistAssets, assets, portfolioWithEntry, searchResults]);

  const sections = ["Home", "Portfolio", "Watchlist","Analytics", "Options", "Predictions", "Journal", "Tax Estimator"];
  const [activeSection, setActiveSection] = useState(() => {
    const saved = localStorage.getItem("zenin_active_section");
    return sections.includes(saved) ? saved : "Home";
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 960);
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("zenin_email") || "user@zenin.app");
  const [accessCheckLoading, setAccessCheckLoading] = useState(true);
  const [accountPlanLabel, setAccountPlanLabel] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (isAdminUser(parsed)) return "Admin";
      return formatPlanLabel(parsed?.currentPlan, parsed?.currentBillingCycle);
    } catch {
      return "Starter Plan";
    }
  });
  const [currentPlan, setCurrentPlan] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return normalizeCurrentPlan(parsed?.currentPlan);
    } catch {
      return "starter";
    }
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return isAdminUser(parsed);
    } catch {
      return false;
    }
  });

  const [themeMode, setThemeMode] = useState(() => {
    try {
      const saved = String(localStorage.getItem("zenin_global_theme") || "").trim().toLowerCase();
      return saved === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isLight = themeMode === "light";
    const root = document.documentElement;
    const body = document.body;
    localStorage.setItem("zenin_global_theme", isLight ? "light" : "dark");
    root.classList.toggle("light-theme-active", isLight);
    body.classList.toggle("light-theme-active", isLight);
    root.classList.toggle("page-dark-theme", !isLight);
    body.classList.toggle("page-dark-theme", !isLight);
    root.style.colorScheme = isLight ? "light" : "dark";
    body.style.colorScheme = isLight ? "light" : "dark";
  }, [themeMode]);

  const toggleTheme = () => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("General");
  const [expandedSettingsPanels, setExpandedSettingsPanels] = useState({
    "profile-email": true,
    "profile-password": true,
    "profile-twofa": true,
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

  const accessibleSections = useMemo(
    () => sections.filter((section) => hasSectionAccessForUser(currentPlan, isAdmin, section)),
    [sections, currentPlan, isAdmin]
  );

  useEffect(() => {
    let mounted = true;
    const redirectToSignin = () => {
      const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const safeNext = nextPath.startsWith("/app") ? nextPath : "/app";
      localStorage.setItem("zenin_post_auth_next", safeNext);
      window.location.replace(`/auth?mode=signin&next=${encodeURIComponent(safeNext)}`);
    };

    const hydrateRequiredAuth = async () => {
      const token = String(sessionStorage.getItem("zenin_auth_token") || localStorage.getItem("zenin_auth_token") || "").trim();
      if (!token) {
        if (mounted) setAccessCheckLoading(true);
        redirectToSignin();
        return;
      }

      try {
        const res = await zeninFetch("/auth/me");
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        if (!res.ok || !data?.authenticated || !data?.user) {
          sessionStorage.removeItem("zenin_auth_token");
          localStorage.removeItem("zenin_auth_token");
          localStorage.removeItem("zenin_auth_user");
          localStorage.removeItem("zenin_auth_expires_at");
          redirectToSignin();
          return;
        } else {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          if (data.user.email) localStorage.setItem("zenin_email", data.user.email);
          const userIsAdmin = isAdminUser(data.user);
          setUserEmail(String(data.user.email || localStorage.getItem("zenin_email") || "user@zenin.app"));
          setIsAdmin(userIsAdmin);
          setCurrentPlan(normalizeCurrentPlan(data.user.currentPlan));
          setAccountPlanLabel(userIsAdmin ? "Admin" : formatPlanLabel(data.user.currentPlan, data.user.currentBillingCycle));
        }
        setAccessCheckLoading(false);
      } catch {
        if (!mounted) return;
        redirectToSignin();
      }
    };

    hydrateRequiredAuth();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!accessibleSections.length) return;
    if (!accessibleSections.includes(activeSection)) {
      setActiveSection(accessibleSections[0]);
    }
  }, [accessibleSections, activeSection]);
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
  const settingsCategories = ["Profile", "General", "Accounts", "Layout", "Notification"];
  const AUTHENTICATOR_OPTIONS = ["Google Authenticator", "Authy", "Microsoft Authenticator", "1Password", "Bitwarden"];
  const PASSKEY_OPTIONS = ["iCloud Keychain", "Google Password Manager", "1Password", "Dashlane", "Bitwarden"];
  const [profileSecurity, setProfileSecurity] = useState(() => {
    const raw = localStorage.getItem("zenin_profile_security");
    const fallback = {
      email: localStorage.getItem("zenin_email") || "user@zenin.app",
      pendingEmail: "",
      pendingEmailCodeHash: "",
      pendingEmailRequestedAt: null,
      emailVerified: true,
      passwordHash: "",
      passwordChangedAt: null,
      twoFactorEnabled: false,
      twoFactorMethod: null,
      twoFactorProvider: null,
      twoFactorTarget: "",
      twoFactorEnabledAt: null,
      backupCodes: [],
      passkeys: []
    };
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return {
        ...fallback,
        ...parsed,
        passkeys: Array.isArray(parsed?.passkeys) ? parsed.passkeys : [],
        backupCodes: Array.isArray(parsed?.backupCodes) ? parsed.backupCodes : []
      };
    } catch {
      return fallback;
    }
  });
  const [profileForms, setProfileForms] = useState({
    newEmail: "",
    emailPassword: "",
    emailVerificationCode: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    twoFactorMethod: "authenticator",
    authenticatorService: AUTHENTICATOR_OPTIONS[0],
    twoFactorCode: "",
    phoneNumber: "",
    recoveryEmail: "",
    passkeyName: "Primary Device",
    passkeyProvider: PASSKEY_OPTIONS[0]
  });
  const [profileFeedback, setProfileFeedback] = useState({
    email: null,
    password: null,
    twofa: null
  });

  useEffect(() => {
    localStorage.setItem("zenin_preferences", JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    localStorage.setItem("zenin_email", userEmail);
  }, [userEmail]);

  useEffect(() => {
    const sanitized = {
      email: profileSecurity?.email || userEmail,
      pendingEmail: profileSecurity?.pendingEmail || "",
      pendingEmailCodeHash: profileSecurity?.pendingEmailCodeHash || "",
      pendingEmailRequestedAt: profileSecurity?.pendingEmailRequestedAt || null,
      emailVerified: !!profileSecurity?.emailVerified,
      passwordHash: profileSecurity?.passwordHash || "",
      passwordChangedAt: profileSecurity?.passwordChangedAt || null,
      twoFactorEnabled: !!profileSecurity?.twoFactorEnabled,
      twoFactorMethod: profileSecurity?.twoFactorMethod || null,
      twoFactorProvider: profileSecurity?.twoFactorProvider || null,
      twoFactorTarget: profileSecurity?.twoFactorTarget || "",
      twoFactorEnabledAt: profileSecurity?.twoFactorEnabledAt || null,
      passkeys: Array.isArray(profileSecurity?.passkeys)
        ? profileSecurity.passkeys.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          createdAt: p.createdAt
        }))
        : [],
      backupCodes: Array.isArray(profileSecurity?.backupCodes)
        ? profileSecurity.backupCodes.filter((code) => typeof code === "string" && code.trim())
        : []
    };
    localStorage.setItem("zenin_profile_security", JSON.stringify(sanitized));
  }, [profileSecurity]);

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
  const PREDICTION_OPTIONS = ["Polymarket", "Kalshi"];

  const venueOptions = accountForm.venueType === "cex"
    ? CEX_OPTIONS
    : accountForm.venueType === "dex"
      ? DEX_OPTIONS
      : accountForm.venueType === "prediction"
        ? PREDICTION_OPTIONS
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

  const createBackupCodes = () =>
    Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 6).toUpperCase());

  const createVerificationCode = () =>
    String(Math.floor(100000 + Math.random() * 900000));

  const hashSecret = (value) => {
    const input = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  };

  const setProfileMessage = (section, type, text) => {
    setProfileFeedback((prev) => ({ ...prev, [section]: { type, text } }));
  };

  const verifyCurrentPassword = (password) => {
    const candidate = String(password || "").trim();
    if (candidate.length < 8) {
      return { ok: false, message: "Current password must be at least 8 characters." };
    }
    const candidateHash = hashSecret(candidate);
    const storedHash = String(profileSecurity?.passwordHash || "").trim();
    if (!storedHash) {
      return { ok: true, bootstrapHash: candidateHash };
    }
    if (storedHash !== candidateHash) {
      return { ok: false, message: "Current password is incorrect." };
    }
    return { ok: true };
  };

  const requestEmailChange = () => {
    const nextEmail = profileForms.newEmail.trim().toLowerCase();
    const password = profileForms.emailPassword.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);

    if (!emailValid) {
      setProfileMessage("email", "error", "Enter a valid email address.");
      return;
    }
    const passwordCheck = verifyCurrentPassword(password);
    if (!passwordCheck.ok) {
      setProfileMessage("email", "error", passwordCheck.message);
      return;
    }
    if (nextEmail === String(profileSecurity.email || "").toLowerCase()) {
      setProfileMessage("email", "error", "New email must be different from current email.");
      return;
    }

    const verificationCode = createVerificationCode();
    setProfileSecurity((prev) => ({
      ...prev,
      pendingEmail: nextEmail,
      pendingEmailCodeHash: hashSecret(verificationCode),
      pendingEmailRequestedAt: new Date().toISOString(),
      emailVerified: false,
      passwordHash: prev.passwordHash || passwordCheck.bootstrapHash || ""
    }));
    setProfileForms((prev) => ({ ...prev, newEmail: "", emailPassword: "", emailVerificationCode: "" }));
    setProfileMessage(
      "email",
      "success",
      `Verification sent to ${nextEmail}. Demo code: ${verificationCode} (enter it below to confirm).`
    );
  };

  const verifyPendingEmail = () => {
    const pendingEmail = String(profileSecurity.pendingEmail || "").trim().toLowerCase();
    const expectedHash = String(profileSecurity.pendingEmailCodeHash || "").trim();
    const typedCode = String(profileForms.emailVerificationCode || "").trim();
    if (!pendingEmail) {
      setProfileMessage("email", "error", "No pending email change to verify.");
      return;
    }
    if (!/^\d{6}$/.test(typedCode)) {
      setProfileMessage("email", "error", "Enter the 6-digit verification code.");
      return;
    }
    if (!expectedHash || expectedHash !== hashSecret(typedCode)) {
      setProfileMessage("email", "error", "Verification code is invalid.");
      return;
    }
    setProfileSecurity((prev) => ({
      ...prev,
      email: pendingEmail,
      pendingEmail: "",
      pendingEmailCodeHash: "",
      pendingEmailRequestedAt: null,
      emailVerified: true
    }));
    setUserEmail(pendingEmail);
    setProfileForms((prev) => ({ ...prev, emailVerificationCode: "" }));
    setProfileMessage("email", "success", `Email updated to ${pendingEmail}.`);
  };

  const updatePassword = () => {
    const currentPassword = profileForms.currentPassword.trim();
    const newPassword = profileForms.newPassword.trim();
    const confirmPassword = profileForms.confirmPassword.trim();

    const passwordCheck = verifyCurrentPassword(currentPassword);
    if (!passwordCheck.ok) {
      setProfileMessage("password", "error", passwordCheck.message);
      return;
    }
    if (newPassword.length < 10) {
      setProfileMessage("password", "error", "New password must be at least 10 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setProfileMessage("password", "error", "New password and confirmation do not match.");
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setProfileMessage("password", "error", "Use at least one letter and one number in your new password.");
      return;
    }
    if (hashSecret(newPassword) === (profileSecurity.passwordHash || passwordCheck.bootstrapHash || hashSecret(currentPassword))) {
      setProfileMessage("password", "error", "Choose a password different from your current password.");
      return;
    }

    setProfileSecurity((prev) => ({
      ...prev,
      passwordHash: hashSecret(newPassword),
      passwordChangedAt: new Date().toISOString()
    }));
    setProfileForms((prev) => ({
      ...prev,
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    }));
    setProfileMessage("password", "success", "Password updated successfully.");
  };

  const enableTwoFactor = () => {
    const method = String(profileForms.twoFactorMethod || "authenticator");
    const code = profileForms.twoFactorCode.trim();
    if (method !== "passkey" && !/^\d{6}$/.test(code)) {
      setProfileMessage("twofa", "error", "Enter a valid 6-digit verification code.");
      return;
    }

    if (method === "authenticator") {
      setProfileSecurity((prev) => ({
        ...prev,
        twoFactorEnabled: true,
        twoFactorMethod: "authenticator",
        twoFactorProvider: profileForms.authenticatorService,
        twoFactorTarget: "",
        twoFactorEnabledAt: new Date().toISOString(),
        backupCodes: prev.backupCodes.length ? prev.backupCodes : createBackupCodes()
      }));
      setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
      setProfileMessage("twofa", "success", `${profileForms.authenticatorService} 2FA enabled.`);
      return;
    }

    if (method === "sms") {
      const phoneNumber = profileForms.phoneNumber.trim();
      if (phoneNumber.length < 8) {
        setProfileMessage("twofa", "error", "Enter a valid phone number for SMS OTP.");
        return;
      }
      setProfileSecurity((prev) => ({
        ...prev,
        twoFactorEnabled: true,
        twoFactorMethod: "sms",
        twoFactorProvider: "SMS OTP",
        twoFactorTarget: phoneNumber,
        twoFactorEnabledAt: new Date().toISOString(),
        backupCodes: prev.backupCodes.length ? prev.backupCodes : createBackupCodes()
      }));
      setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
      setProfileMessage("twofa", "success", "SMS 2FA enabled.");
      return;
    }

    const recoveryEmail = profileForms.recoveryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail)) {
      setProfileMessage("twofa", "error", "Enter a valid recovery email for email OTP.");
      return;
    }
    if (!profileSecurity.emailVerified) {
      setProfileMessage("twofa", "error", "Verify your workspace email before enabling Email OTP.");
      return;
    }
    setProfileSecurity((prev) => ({
      ...prev,
      twoFactorEnabled: true,
      twoFactorMethod: "email",
      twoFactorProvider: "Email OTP",
      twoFactorTarget: recoveryEmail,
      twoFactorEnabledAt: new Date().toISOString(),
      backupCodes: prev.backupCodes.length ? prev.backupCodes : createBackupCodes()
    }));
    setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
    setProfileMessage("twofa", "success", "Email OTP 2FA enabled.");
  };

  const registerPasskey = () => {
    const passkeyName = profileForms.passkeyName.trim();
    if (passkeyName.length < 2) {
      setProfileMessage("twofa", "error", "Passkey name must be at least 2 characters.");
      return;
    }
    const newPasskey = {
      id: Date.now(),
      name: passkeyName,
      provider: profileForms.passkeyProvider,
      createdAt: new Date().toISOString()
    };
    setProfileSecurity((prev) => ({
      ...prev,
      twoFactorEnabled: true,
      twoFactorMethod: "passkey",
      twoFactorProvider: profileForms.passkeyProvider,
      twoFactorTarget: passkeyName,
      twoFactorEnabledAt: new Date().toISOString(),
      passkeys: [newPasskey, ...(Array.isArray(prev.passkeys) ? prev.passkeys : [])],
      backupCodes: prev.backupCodes.length ? prev.backupCodes : createBackupCodes()
    }));
    setProfileForms((prev) => ({ ...prev, passkeyName: "Primary Device" }));
    setProfileMessage("twofa", "success", `Passkey "${passkeyName}" registered.`);
  };

  const regenerateBackupCodes = () => {
    if (!profileSecurity.twoFactorEnabled) {
      setProfileMessage("twofa", "error", "Enable 2FA before generating backup codes.");
      return;
    }
    if (!profileSecurity.twoFactorMethod) {
      setProfileMessage("twofa", "error", "Select and enable a 2FA method first.");
      return;
    }
    setProfileSecurity((prev) => ({ ...prev, backupCodes: createBackupCodes() }));
    setProfileMessage("twofa", "success", "Backup codes regenerated.");
  };

  const disableTwoFactor = () => {
    setProfileSecurity((prev) => ({
      ...prev,
      twoFactorEnabled: false,
      twoFactorMethod: null,
      twoFactorProvider: null,
      twoFactorTarget: "",
      twoFactorEnabledAt: null,
      backupCodes: []
    }));
    setProfileMessage("twofa", "info", "2FA disabled for this workspace profile.");
  };

  const hasPendingEmail = Boolean(String(profileSecurity?.pendingEmail || "").trim());
  const isEmailVerificationCodeValid = /^\d{6}$/.test(String(profileForms?.emailVerificationCode || "").trim());
  const canSendEmailVerification = Boolean(
    String(profileForms?.newEmail || "").trim() &&
    String(profileForms?.emailPassword || "").trim()
  );
  const canConfirmEmailVerification = hasPendingEmail && isEmailVerificationCodeValid;
  const canUpdatePassword = Boolean(
    String(profileForms?.currentPassword || "").trim() &&
    String(profileForms?.newPassword || "").trim() &&
    String(profileForms?.confirmPassword || "").trim()
  );
  const canEnableTwoFactor = (() => {
    const method = String(profileForms?.twoFactorMethod || "authenticator");
    if (method === "passkey") {
      return Boolean(String(profileForms?.passkeyName || "").trim());
    }
    if (!/^\d{6}$/.test(String(profileForms?.twoFactorCode || "").trim())) return false;
    if (method === "sms") return String(profileForms?.phoneNumber || "").trim().length >= 8;
    if (method === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profileForms?.recoveryEmail || "").trim());
    return true;
  })();

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
    if (section === "Analytics") {
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 17h16M4 12h16M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
    accessCheckLoading ? (
      <div className="app-access-loading">Verifying account access...</div>
    ) : (
    <div className={`app-layout ${isSidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      {isSidebarCollapsed && typeof window !== 'undefined' && window.innerWidth <= 960 && (
        <button
          className="mobile-hamburger-btn"
          onClick={() => setIsSidebarCollapsed(false)}
          aria-label="Open Menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      <aside className={`sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
        <header className="sidebar-header">
          {!isSidebarCollapsed ? (
            <ZeninLogo size="md" />
          ) : (
            <ZeninLogo size="sm" showText={false} />
          )}
          <button
            className="sidebar-toggle-btn mobile-close-btn"
            onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
        </header>
        <nav className="sidebar-nav">
          {accessibleSections.map((section) => (
            <button
              key={section}
              className={`nav-btn ${activeSection === section ? "active" : ""}`}
              onClick={() => {
                if (!accessibleSections.includes(section)) return;
                if (routeState.type === "company") navigateToAppRoute();
                setActiveSection(section);
              }}
              title={section}
            >
              <span className="nav-icon">{sectionIcon(section)}</span>
              <span className="nav-full">{section}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="sidebar-theme-row"
            onClick={toggleTheme}
            title={`Theme: ${themeMode === "dark" ? "Dark mode" : "Light mode"}`}
            aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          >
            <span className="sidebar-theme-left">
              <span className="sidebar-theme-icon" aria-hidden="true">{themeMode === "dark" ? "☾" : "☀"}</span>
              <span className="sidebar-theme-label">{themeMode === "dark" ? "Dark mode" : "Light mode"}</span>
            </span>
            <span className="sidebar-theme-chip">{themeMode === "dark" ? "Dark" : "Light"}</span>
          </button>

          <button
            className="sidebar-footer settings-launcher"
            onClick={() => setIsSettingsOpen(true)}
            title="Open settings"
          >
            <div className="user-icon">
              {String(userEmail || "U").trim().charAt(0).toUpperCase() || "U"}
            </div>
            <div className="sidebar-account-meta">
              <span className="sidebar-footer-email" title={userEmail}>
                {userEmail}
              </span>
              <span className="sidebar-plan-label">{accountPlanLabel}</span>
            </div>
            <span className="sidebar-account-chevron">⌄</span>
          </button>
        </div>

      </aside>

      <main className="main-content">
        {routeState.type === "company" ? (
          <div className="view-container">
            <CompanyProfilePage
              symbol={routeState.symbol}
              asset={routedCompanyAsset}
              onBack={navigateToAppRoute}
            />
          </div>
        ) : (
          <>
        {activeSection === "Home" && (
          <HomeModule
            portfolio={portfolioWithEntry}
            trades={trades}
            assets={assets}
            marketMovers={homeMarketMovers}
            watchlistAssets={watchlistAssets}
            activeOptionsTrades={activeOptionsTrades}
            multiChainCache={multiChainCache}
            spotPrices={spotPrices}
            onSelectAsset={setSelectedAsset}
            accountMetrics={accountMetrics}
            calculatePortfolioValue={calculatePortfolioValue}
            calculatePortfolioGain={calculatePortfolioGain}
            balance={balance}
            onViewAllPositions={() => {
              if (routeState.type === "company") navigateToAppRoute();
              setActiveSection("Portfolio");
            }}
          />
        )}
        {activeSection === "Watchlist" && (
          <div className="view-container">
            <div className="search-section" ref={searchSectionRef}>
              <div className="search-controls">
                <input
                  type="text"
                  className="search-input"
                  placeholder={
                    searchType
                      ? `Search ${
                        searchType === "tradfi"
                          ? "stocks"
                          : searchType === "indicator"
                            ? "for Country"
                            : "crypto"
                      }${searchType === "indicator" ? "" : " by symbol or name..."}`
                      : "Select class and search assets..."
                  }
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-type-buttons">
                  <button
                    className={`search-type-button ${searchType === "tradfi" ? "active" : ""}`}
                    onClick={() => setSearchType("tradfi")}
                  >
                    Stocks
                  </button>
                  <button
                    className={`search-type-button ${searchType === "crypto" ? "active" : ""}`}
                    onClick={() => setSearchType("crypto")}
                  >
                    Crypto
                  </button>
                  <button
                    className={`search-type-button ${searchType === "indicator" ? "active" : ""}`}
                    onClick={() => setSearchType("indicator")}
                  >
                    Indicator
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
                        const inWatchlist = isInWatchlist(asset);
                        return (
                          <div
                            key={getSearchResultKey(asset)}
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
                                await toggleWatchlistStar(asset);
                              }}
                              title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
                            >
                              ★
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : searchHasSettled ? (
                    <div className="search-no-results">No results found</div>
                  ) : null}
                </div>
              )}
            </div>

            {watchlistStale && watchlistNotice ? (
              <div className="stale-banner">
                <span className="status-icon">⚠</span>
                {watchlistNotice}
              </div>
            ) : null}
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
          </div>
        )}

        {activeSection === "Portfolio" && (
          <div className="view-container">
            <PortfolioModule
                portfolio={portfolioWithEntry}
                trades={trades}
                balance={balance}
                accountMetrics={accountMetrics}
                calculatePortfolioValue={calculatePortfolioValue}
                calculatePortfolioGain={calculatePortfolioGain}
                activeOptionsTrades={activeOptionsTrades}
                setActiveOptionsTrades={setActiveOptionsTrades}
                multiChainCache={multiChainCache}
                spotPrices={spotPrices}
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

       {activeSection === "Analytics" && (
        <div className="view-container">
          <AnalyticsModule backendUrl={BACKEND_URL} />
        </div>
      )}


        {activeSection === "Options" && (
          <OptionsModule
            activeOptionsTrades={activeOptionsTrades}
            setActiveOptionsTrades={setActiveOptionsTrades}
            onOptionTradeExecuted={handleOptionTradeExecuted}
            onOptionTradeClosed={handleOptionTradeClosed}
            balance={balance}
            spotPrices={spotPrices}
            showToast={showTradeToast}
          />
        )}

        {activeSection === "Predictions" && (
          <PredictionMarketModule />
        )}

        {activeSection === "Journal" && (
          <JournalModule
            trades={trades}
            portfolio={portfolioWithEntry}
            balance={accountMetrics.liveAvailableBalance}
            accountEquity={accountMetrics.totalAccountEquity}
            activeOptionsTrades={activeOptionsTrades}
            multiChainCache={multiChainCache}
            spotPrices={spotPrices}
          />
        )}

        {activeSection === "Tax Estimator" && (
          <TaxEstimator trades={trades} />
        )}
          </>
        )}
      </main>

      {selectedAsset && (
        normalizeAssetType(selectedAsset) === "indicator" ? (
          <IndicatorCountryModal
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            isInWatchlist={isInWatchlist}
            onToggleStar={toggleWatchlistStar}
          />
        ) : (
          <AssetModal
            asset={selectedAsset}
            onClose={() => setSelectedAsset(null)}
            onConfirm={addToPortfolio}
            isInWatchlist={isInWatchlist}
            onToggleStar={toggleWatchlistStar}
            onViewCompanyProfile={openCompanyProfile}
            portfolio={portfolioWithEntry}
            balance={balance}
          />
        )
      )}

      {tradeToast && (
        <div 
          className={`trade-toast ${tradeToast.type}`}
          onClick={() => setTradeToast(null)}
          style={{ cursor: "pointer" }}
        >
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
                {activeSettingsCategory === "Profile" && (
                  <>
                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("profile-email")}>
                        <span>Email Address</span>
                        <span>{expandedSettingsPanels["profile-email"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["profile-email"] && (
                        <div className="settings-panel-body">
                          <p className="settings-meta">
                            Current: <strong>{profileSecurity.email || userEmail}</strong>
                          </p>
                          {profileSecurity.pendingEmail ? (
                            <p className="settings-warning">Pending verification: {profileSecurity.pendingEmail}</p>
                          ) : null}
                          <label className="settings-field">
                            <span>New Email</span>
                            <input
                              type="email"
                              value={profileForms.newEmail}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, newEmail: e.target.value }))}
                              placeholder="name@example.com"
                            />
                          </label>
                          <label className="settings-field">
                            <span>Current Password</span>
                            <input
                              type="password"
                              value={profileForms.emailPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, emailPassword: e.target.value }))}
                              placeholder="Enter current password"
                            />
                          </label>
                          <label className="settings-field">
                            <span>Verification Code</span>
                            <input
                              type="text"
                              value={profileForms.emailVerificationCode}
                              onChange={(e) => setProfileForms((prev) => ({
                                ...prev,
                                emailVerificationCode: e.target.value.replace(/\D/g, "").slice(0, 6)
                              }))}
                              placeholder="6-digit code"
                            />
                          </label>
                          <div className="settings-inline-actions">
                            <button
                              className="settings-primary-btn"
                              onClick={requestEmailChange}
                              disabled={!canSendEmailVerification}
                            >
                              Send Verification
                            </button>
                            <button
                              className="settings-secondary-btn"
                              onClick={verifyPendingEmail}
                              disabled={!canConfirmEmailVerification}
                            >
                              Confirm Verification
                            </button>
                          </div>
                          {profileFeedback.email?.text ? (
                            <p className={`settings-status ${profileFeedback.email.type}`}>{profileFeedback.email.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("profile-password")}>
                        <span>Password</span>
                        <span>{expandedSettingsPanels["profile-password"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["profile-password"] && (
                        <div className="settings-panel-body">
                          <label className="settings-field">
                            <span>Current Password</span>
                            <input
                              type="password"
                              value={profileForms.currentPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, currentPassword: e.target.value }))}
                              placeholder="Enter current password"
                            />
                          </label>
                          <label className="settings-field">
                            <span>New Password</span>
                            <input
                              type="password"
                              value={profileForms.newPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, newPassword: e.target.value }))}
                              placeholder="Use at least 10 characters"
                            />
                          </label>
                          <label className="settings-field">
                            <span>Confirm New Password</span>
                            <input
                              type="password"
                              value={profileForms.confirmPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                              placeholder="Re-enter new password"
                            />
                          </label>
                          <div className="settings-inline-actions">
                            <button
                              className="settings-primary-btn"
                              onClick={updatePassword}
                              disabled={!canUpdatePassword}
                            >
                              Update Password
                            </button>
                          </div>
                          {profileSecurity.passwordChangedAt ? (
                            <p className="settings-meta">
                              Last changed: {new Date(profileSecurity.passwordChangedAt).toLocaleString()}
                            </p>
                          ) : null}
                          {profileFeedback.password?.text ? (
                            <p className={`settings-status ${profileFeedback.password.type}`}>{profileFeedback.password.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("profile-twofa")}>
                        <span>2FA & Passkeys</span>
                        <span>{expandedSettingsPanels["profile-twofa"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["profile-twofa"] && (
                        <div className="settings-panel-body">
                          <div className="settings-chip-row">
                            <span className={`settings-chip ${profileSecurity.twoFactorEnabled ? "success" : "muted"}`}>
                              {profileSecurity.twoFactorEnabled ? "2FA Enabled" : "2FA Disabled"}
                            </span>
                            {profileSecurity.twoFactorMethod ? (
                              <span className="settings-chip">{String(profileSecurity.twoFactorMethod).toUpperCase()}</span>
                            ) : null}
                            {profileSecurity.twoFactorProvider ? (
                              <span className="settings-chip">{profileSecurity.twoFactorProvider}</span>
                            ) : null}
                          </div>

                          <label className="settings-field">
                            <span>Security Method</span>
                            <select
                              value={profileForms.twoFactorMethod}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, twoFactorMethod: e.target.value }))}
                            >
                              <option value="authenticator">Authenticator App</option>
                              <option value="passkey">Passkey</option>
                              <option value="sms">SMS OTP</option>
                              <option value="email">Email OTP</option>
                            </select>
                          </label>

                          {profileForms.twoFactorMethod === "authenticator" ? (
                            <>
                              <label className="settings-field">
                                <span>Authenticator Service</span>
                                <select
                                  value={profileForms.authenticatorService}
                                  onChange={(e) => setProfileForms((prev) => ({ ...prev, authenticatorService: e.target.value }))}
                                >
                                  {AUTHENTICATOR_OPTIONS.map((service) => (
                                    <option key={service} value={service}>{service}</option>
                                  ))}
                                </select>
                              </label>
                              <p className="settings-meta">Scan QR in your app, then enter the 6-digit code below.</p>
                            </>
                          ) : null}

                          {profileForms.twoFactorMethod === "passkey" ? (
                            <>
                              <label className="settings-field">
                                <span>Passkey Service</span>
                                <select
                                  value={profileForms.passkeyProvider}
                                  onChange={(e) => setProfileForms((prev) => ({ ...prev, passkeyProvider: e.target.value }))}
                                >
                                  {PASSKEY_OPTIONS.map((provider) => (
                                    <option key={provider} value={provider}>{provider}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="settings-field">
                                <span>Passkey Name</span>
                                <input
                                  type="text"
                                  value={profileForms.passkeyName}
                                  onChange={(e) => setProfileForms((prev) => ({ ...prev, passkeyName: e.target.value }))}
                                  placeholder="MacBook Pro / iPhone / YubiKey"
                                />
                              </label>
                            </>
                          ) : null}

                          {profileForms.twoFactorMethod === "sms" ? (
                            <label className="settings-field">
                              <span>Phone Number</span>
                              <input
                                type="text"
                                value={profileForms.phoneNumber}
                                onChange={(e) => setProfileForms((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                                placeholder="+1 555 123 4567"
                              />
                            </label>
                          ) : null}

                          {profileForms.twoFactorMethod === "email" ? (
                            <label className="settings-field">
                              <span>Recovery Email</span>
                              <input
                                type="email"
                                value={profileForms.recoveryEmail}
                                onChange={(e) => setProfileForms((prev) => ({ ...prev, recoveryEmail: e.target.value }))}
                                placeholder="security@example.com"
                              />
                            </label>
                          ) : null}

                          {profileForms.twoFactorMethod !== "passkey" ? (
                            <label className="settings-field">
                              <span>Verification Code</span>
                              <input
                                type="text"
                                value={profileForms.twoFactorCode}
                                onChange={(e) => setProfileForms((prev) => ({ ...prev, twoFactorCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                                placeholder="6-digit code"
                              />
                            </label>
                          ) : null}

                          <div className="settings-inline-actions">
                            {profileForms.twoFactorMethod === "passkey" ? (
                              <button
                                className="settings-primary-btn"
                                onClick={registerPasskey}
                                disabled={!canEnableTwoFactor}
                              >
                                Register Passkey
                              </button>
                            ) : (
                              <button
                                className="settings-primary-btn"
                                onClick={enableTwoFactor}
                                disabled={!canEnableTwoFactor}
                              >
                                Enable 2FA
                              </button>
                            )}
                            <button
                              className="settings-secondary-btn"
                              onClick={regenerateBackupCodes}
                              disabled={!profileSecurity.twoFactorEnabled}
                            >
                              Regenerate Backup Codes
                            </button>
                            <button
                              className="settings-secondary-btn"
                              onClick={disableTwoFactor}
                              disabled={!profileSecurity.twoFactorEnabled}
                            >
                              Disable 2FA
                            </button>
                          </div>

                          {profileSecurity.passkeys?.length ? (
                            <div className="settings-passkey-list">
                              {profileSecurity.passkeys.map((passkey) => (
                                <div key={passkey.id} className="settings-passkey-item">
                                  <strong>{passkey.name}</strong>
                                  <span>{passkey.provider}</span>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {profileSecurity.backupCodes?.length ? (
                            <div className="settings-backup-grid">
                              {profileSecurity.backupCodes.map((code) => (
                                <code key={code}>{code}</code>
                              ))}
                            </div>
                          ) : (
                            <p className="settings-meta">Backup codes will appear once 2FA is enabled.</p>
                          )}

                          {profileFeedback.twofa?.text ? (
                            <p className={`settings-status ${profileFeedback.twofa.type}`}>{profileFeedback.twofa.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </>
                )}

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
                            <p className="settings-meta">No connected CEX, DEX, brokerage, or prediction market accounts yet.</p>
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
                              : nextType === "prediction"
                                ? PREDICTION_OPTIONS[0]
                                : BROKER_OPTIONS[0];
                          setAccountForm((prev) => ({ ...prev, venueType: nextType, provider: nextProvider }));
                        }}
                      >
                        <option value="cex">Crypto Exchange (CEX)</option>
                        <option value="dex">Decentralized Exchange (DEX)</option>
                        <option value="broker">Stock Brokerage</option>
                        <option value="prediction">Prediction Markets</option>
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
    )
  );
}

export default App;
