import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import { calculateAccountSnapshot, calculatePortfolioMarketValue } from "./utils/accountMetrics";
import { calculateOptionPnL } from "./utils/optionsPnL";
import { updateFXRates, convertToUSD, inferAssetCurrency } from "./utils/currencyUtils";
import { ZeninLogo } from "./components/Branding";
import {
  AccountIcon,
  AnalyticsIcon,
  HomeIcon,
  JournalIcon,
  LiveRailIcon,
  LogoutIcon,
  MetricsIcon,
  OptionsIcon,
  PortfolioIcon,
  PredictionsIcon,
  TaxIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
  WatchlistIcon
} from "./components/SidebarIcons";
import { readResilientCache, writeResilientCache } from "./utils/resilientData";
import { getSnapshotFallbackMessage } from "./utils/staleNotice";
import { zeninFetch, zeninFetchJson } from "./utils/zeninFetch";
import { hasWorkspaceSession, loadWorkspaceCollection, loadWorkspaceDoc, saveWorkspaceDoc, saveWorkspaceCollection } from "./utils/workspacePersistence";
import { ZENIN_API_BASE_URL } from "./constants/apiConfig";

import { useLivePriceStream } from "./hooks/useLivePriceStream";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useRuntimeConfig } from "./hooks/useRuntimeConfig";
import { GenericErrorBoundary } from "./components/ErrorBoundary";
import { WorkspaceInstitutionalControlPanel } from "./components/InstitutionalPanels";
import { applySeo } from "./utils/seo";
import { storePostAuthRedirect } from "./utils/authRedirect";
import { ensureZeninSessionFromSupabase, signOutEverywhere, subscribeToSupabaseAuth } from "./utils/supabaseAuth";
import {
  formatRevenueCatError,
  isRevenueCatCancelledError,
  loadRevenueCatState,
  presentRevenueCatPaywall,
  purchaseRevenueCatPackage
} from "./utils/revenueCat";
import { getAppRuntimeConfig, setRuntimeConfigs } from "./config/runtimeConfigStore";

const REQUIRED_WATCHLIST_CATEGORIES = ["indicators", "commodities"];
const DEFAULT_WATCHLIST_CATEGORIES = ["stocks", "crypto", ...REQUIRED_WATCHLIST_CATEGORIES];

function withRequiredWatchlistCategories(categories = []) {
  const seen = new Set();
  const normalized = (Array.isArray(categories) ? categories : [])
    .map((category) => String(category || "").trim().toLowerCase())
    .filter((category) => {
      if (!category || seen.has(category)) return false;
      seen.add(category);
      return true;
    });

  REQUIRED_WATCHLIST_CATEGORIES.forEach((category) => {
    if (!seen.has(category)) normalized.push(category);
  });

  return normalized.length ? normalized : DEFAULT_WATCHLIST_CATEGORIES;
}

function isStaleChunkError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message);
}

function lazyWithReloadRetry(loader, retryKey) {
  return lazy(async () => {
    try {
      const mod = await loader();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(retryKey);
      }
      return mod;
    } catch (error) {
      if (typeof window === "undefined" || !isStaleChunkError(error)) {
        throw error;
      }

      const hasRetried = sessionStorage.getItem(retryKey) === "1";
      if (!hasRetried) {
        sessionStorage.setItem(retryKey, "1");
        window.location.reload();
        return new Promise(() => {});
      }

      sessionStorage.removeItem(retryKey);
      throw error;
    }
  });
}

const HomeModule = lazyWithReloadRetry(
  () => import("./components/HomeModule").then((mod) => ({ default: mod.HomeModule })),
  "zenin_lazy_retry_home"
);
const PortfolioModule = lazyWithReloadRetry(
  () => import("./components/PortfolioModule").then((mod) => ({ default: mod.PortfolioModule })),
  "zenin_lazy_retry_portfolio"
);
const OptionsModule = lazyWithReloadRetry(
  () => import("./components/OptionsModule").then((mod) => ({ default: mod.OptionsModule })),
  "zenin_lazy_retry_options"
);
const JournalModule = lazyWithReloadRetry(
  () => import("./components/JournalModule").then((mod) => ({ default: mod.JournalModule })),
  "zenin_lazy_retry_journal"
);
const AnalyticsModule = lazyWithReloadRetry(
  () => import("./components/AnalyticsModule").then((mod) => ({ default: mod.AnalyticsModule })),
  "zenin_lazy_retry_analytics"
);
const PredictionMarketModule = lazyWithReloadRetry(
  () => import("./components/PredictionMarketModule").then((mod) => ({ default: mod.PredictionMarketModule })),
  "zenin_lazy_retry_predictions"
);
const TaxEstimator = lazyWithReloadRetry(
  () => import("./components/TaxEstimator").then((mod) => ({ default: mod.TaxEstimator })),
  "zenin_lazy_retry_tax"
);
const FullMetricsPage = lazyWithReloadRetry(
  () => import("./components/FullMetricsPage").then((mod) => ({ default: mod.FullMetricsPage })),
  "zenin_lazy_retry_metrics"
);
const Watchlist = lazyWithReloadRetry(
  () => import("./components/Watchlist").then((mod) => ({ default: mod.Watchlist })),
  "zenin_lazy_retry_watchlist"
);
const AssetModal = lazyWithReloadRetry(
  () => import("./components/AssetModal").then((mod) => ({ default: mod.AssetModal })),
  "zenin_lazy_retry_asset_modal"
);
const IndicatorCountryModal = lazyWithReloadRetry(
  () => import("./components/IndicatorCountryModal").then((mod) => ({ default: mod.IndicatorCountryModal })),
  "zenin_lazy_retry_indicator_modal"
);
const CompanyProfilePage = lazyWithReloadRetry(
  () => import("./components/CompanyProfilePage").then((mod) => ({ default: mod.CompanyProfilePage })),
  "zenin_lazy_retry_company"
);
const SpeedInsights = lazyWithReloadRetry(
  () => import("@vercel/speed-insights/react").then((mod) => ({ default: mod.SpeedInsights })),
  "zenin_lazy_retry_speed_insights"
);
const Analytics = lazyWithReloadRetry(
  () => import("@vercel/analytics/react").then((mod) => ({ default: mod.Analytics })),
  "zenin_lazy_retry_analytics_beacon"
);

let webAuthnBrowserModulePromise = null;

async function getStartRegistration() {
  if (!webAuthnBrowserModulePromise) {
    webAuthnBrowserModulePromise = import("@simplewebauthn/browser");
  }
  const mod = await webAuthnBrowserModulePromise;
  return mod.startRegistration;
}



const BACKEND_URL = ZENIN_API_BASE_URL;
const GUEST_ACCESS_VALUES = new Set(["1", "true", "yes"]);
const SYNC_ENABLED_PROVIDERS = new Set(["binance", "bybit", "hyperliquid"]);

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getDefaultConnectionLabel(provider, venueType = "cex") {
  const normalized = normalizeProviderId(provider);
  if (normalized === "hyperliquid") return "Hyperliquid watch";
  const label = String(provider || "").trim() || (
    venueType === "broker" ? "Broker" : venueType === "prediction" ? "Prediction" : venueType === "dex" ? "DEX" : "Exchange"
  );
  return `${label} main`;
}

function isGuestAccessRequested() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return GUEST_ACCESS_VALUES.has(String(params.get("guest") || "").trim().toLowerCase());
}

function redirectToAuthGate() {
  if (typeof window === "undefined") return;
  const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  storePostAuthRedirect(target, "/app");
  const authUrl = new URL("/auth", window.location.origin);
  authUrl.searchParams.set("mode", "signup");
  authUrl.searchParams.set("next", target);
  window.location.replace(`${authUrl.pathname}${authUrl.search}${authUrl.hash}`);
}

function getBrowserNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

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
  const validPlans = Array.isArray(getAppRuntimeConfig()?.subscription?.validPlans)
    ? getAppRuntimeConfig().subscription.validPlans
    : ["starter", "pro", "desk"];
  const normalized = String(plan || "").trim().toLowerCase();
  if (validPlans.includes(normalized)) return normalized;
  return "starter";
}

function resolveEffectivePlan(userPlan, workspacePlan) {
  const normalizedUserPlan = normalizeCurrentPlan(userPlan);
  const normalizedWorkspacePlan = normalizeCurrentPlan(workspacePlan);
  const planRank = getAppRuntimeConfig()?.subscription?.planRank || { starter: 0, pro: 1, desk: 2 };
  return Number(planRank[normalizedWorkspacePlan] || 0) > Number(planRank[normalizedUserPlan] || 0)
    ? normalizedWorkspacePlan
    : normalizedUserPlan;
}

function getConnectPromptSessionKey(userId) {
  return `zenin_connect_prompt_seen_${String(userId || "guest")}`;
}

const getFallbackAssetsForCategory = (category) =>
  getAppRuntimeConfig()?.watchlist?.fallbackAssetsByCategory?.[String(category || "").toLowerCase()] || [];

const moduleLoadingFallback = <div className="loading-state module-loading-state">Loading workspace...</div>;

const SIDEBAR_SECTION_META = {
  Home: {
    group: "Core",
    eyebrow: "Home",
    description: "Open your daily snapshot and market pulse."
  },
  Portfolio: {
    group: "Core",
    eyebrow: "Portfolio",
    description: "Track allocation, cash, and performance."
  },
  Watchlist: {
    group: "Core",
    eyebrow: "Watchlist",
    description: "Follow assets, macro calendars, and catalysts."
  },
  Analytics: {
    group: "Research",
    eyebrow: "Analytics",
    description: "Scan cross-market and macro context."
  },
  Metrics: {
    group: "Research",
    eyebrow: "Metrics",
    description: "Inspect full metrics and sourced datasets."
  },
  Options: {
    group: "Research",
    eyebrow: "Options",
    description: "Review chains, pricing, and options flow."
  },
  Predictions: {
    group: "Research",
    eyebrow: "Predictions",
    description: "Monitor prediction markets and event odds."
  },
  Journal: {
    group: "Tools",
    eyebrow: "Journal",
    description: "Capture notes, setups, and trade reviews."
  },
  "Tax Estimator": {
    group: "Tools",
    eyebrow: "Tax",
    description: "Model scenarios and tax exposure."
  }
};

const SIDEBAR_GROUP_ORDER = ["Core", "Research", "Tools"];

const searchFallbackAssets = (query, type) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const normalizedType = String(type || "").toLowerCase();
  if (!normalizedQuery) return [];
  if (normalizedType === "indicator" || normalizedType === "indicators") {
    const fallbackMacroGeos = Array.isArray(getAppRuntimeConfig()?.analytics?.fallbackMacroGeos)
      ? getAppRuntimeConfig().analytics.fallbackMacroGeos
      : [];
    return fallbackMacroGeos
      .filter((geo) => String(geo?.type || "").trim().toLowerCase() === "country")
      .filter((geo) => {
        const code = String(geo?.code || "").trim().toLowerCase();
        const name = String(geo?.name || "").trim().toLowerCase();
        return code.includes(normalizedQuery) || name.includes(normalizedQuery);
      })
      .slice(0, 8)
      .map((geo) => ({
        symbol: String(geo?.code || "").trim().toUpperCase(),
        name: String(geo?.name || "").trim(),
        type: "indicator",
        category: "indicators",
        marketType: "macro",
        market: "Macro",
        countryCode: String(geo?.code || "").trim().toUpperCase(),
        countryName: String(geo?.name || "").trim()
      }));
  }
  const category = normalizedType === "crypto"
    ? "crypto"
    : normalizedType === "indicator" || normalizedType === "indicators"
      ? "indicators"
      : "stocks";
  return getFallbackAssetsForCategory(category)
    .filter((asset) =>
      String(asset.symbol || "").toLowerCase().includes(normalizedQuery) ||
      String(asset.name || "").toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 8);
};

function requiredPlanForSection(section) {
  return getAppRuntimeConfig()?.subscription?.sectionMinPlan?.[section] || "starter";
}

function hasSectionAccess(plan, section) {
  return hasSectionAccessForUser(plan, false, section);
}

function hasSectionAccessForUser(plan, isAdmin, section) {
  if (isAdmin) return true;
  const userPlan = normalizeCurrentPlan(plan);
  const requiredPlan = requiredPlanForSection(section);
  const planRank = getAppRuntimeConfig()?.subscription?.planRank || {};
  return Number(planRank[userPlan] || 0) >= Number(planRank[requiredPlan] || 0);
}

function hasStoredAuthSession() {
  return hasWorkspaceSession();
}

function isAdminUser(user) {
  const authProvider = String(user?.authProvider || "").trim().toLowerCase();
  const adminRole = String(user?.adminRole || "").trim().toLowerCase();
  return Boolean(user?.isAdmin) || (adminRole && adminRole !== "user") || authProvider === "admin";
}

const FEE_SOURCE_EXCHANGE_REPORTED = "exchange_reported";
const FEE_SOURCE_CHEAPEST_AVENUE = "cheapest_avenue";

const normalizeFeeSourceValue = (value, fallback = FEE_SOURCE_EXCHANGE_REPORTED) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) return fallback;
  if (["exchange_reported", "exchange", "reported", "venue_reported", "broker_reported"].includes(normalized)) {
    return FEE_SOURCE_EXCHANGE_REPORTED;
  }
  if ([
    "cheapest_avenue",
    "cheapest",
    "best_avenue",
    "best_venue",
    "internal",
    "estimated",
    "internal_estimate",
    "zenin_estimated",
    "zenin"
  ].includes(normalized)) {
    return FEE_SOURCE_CHEAPEST_AVENUE;
  }
  return normalized;
};

const normalizeTradeRecord = (trade, idx = 0) => {
  const quantity = Number(trade?.quantity);
  const price = Number(trade?.price);
  const notional = Number(trade?.notional);
  const fee = Number(trade?.fee);
  const slippage = Number(trade?.slippage);
  const referencePrice = Number(trade?.referencePrice ?? trade?.reference_price);
  const balanceAfter = Number(trade?.balanceAfter ?? trade?.balance_after);
  const portfolioValueAfter = Number(trade?.portfolioValueAfter ?? trade?.portfolio_value_after);
  const accountEquityAfter = Number(trade?.accountEquityAfter ?? trade?.account_equity_after);
  const positionAfter = Number(trade?.positionAfter ?? trade?.position_after);
  const fallbackDate = new Date().toISOString().split("T")[0];
  const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
  const platform = String(trade?.platform || trade?.exchange || "zenin").toLowerCase();
  const feeSourceFallback = platform === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED;

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
    platform,
    status: trade?.status || "Filled",
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    price: Number.isFinite(price) ? price : 0,
    notional: Number.isFinite(notional) ? Math.abs(notional) : 0,
    fee: Number.isFinite(fee) ? Math.abs(fee) : 0,
    feeCurrency: String(trade?.feeCurrency || trade?.fee_currency || trade?.currency || "USD").toUpperCase(),
    feeSource: normalizeFeeSourceValue(trade?.feeSource || trade?.fee_source, feeSourceFallback),
    slippage: Number.isFinite(slippage) ? Math.abs(slippage) : 0,
    referencePrice: Number.isFinite(referencePrice) ? referencePrice : null,
    balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : null,
    portfolioValueAfter: Number.isFinite(portfolioValueAfter) ? portfolioValueAfter : null,
    accountEquityAfter: Number.isFinite(accountEquityAfter) ? accountEquityAfter : null,
    positionAfter: Number.isFinite(positionAfter) ? positionAfter : null,
    executionMeta: trade?.executionMeta || trade?.execution_meta_json || {}
  };
};

const readStoredArray = (key) => {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(i => i && typeof i === 'object') : [];
  } catch {
    return [];
  }
};

const hasAuthToken = () => {
  return hasWorkspaceSession();
};

function buildDefaultProfileSecurity(email) {
  return {
    email: email || "user@zenin.app",
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
}

function profileSecurityFromUser(user, fallbackEmail = "user@zenin.app") {
  return {
    ...buildDefaultProfileSecurity(String(user?.email || fallbackEmail || "user@zenin.app")),
    email: String(user?.email || fallbackEmail || "user@zenin.app"),
    pendingEmail: String(user?.pendingEmail || ""),
    pendingEmailRequestedAt: user?.pendingEmailRequestedAt || null,
    emailVerified: Boolean(user?.emailVerified),
    passwordChangedAt: user?.passwordChangedAt || null,
    twoFactorEnabled: Boolean(user?.twoFactorEnabled),
    twoFactorMethod: user?.twoFactorMethod || null,
    twoFactorProvider: user?.twoFactorProvider || null,
    twoFactorTarget: String(user?.twoFactorTarget || ""),
    twoFactorEnabledAt: user?.twoFactorEnabledAt || null,
    backupCodes: Array.isArray(user?.backupCodes) ? user.backupCodes : [],
    passkeys: Array.isArray(user?.passkeys) ? user.passkeys : []
  };
}

const mapOptionHoldingToTrade = (holding) => {
  if (!holding) return null;
  return {
    ...holding,
    id: `opt-${holding.id}`,
    dbId: holding.id,
    strategy: holding.strategyName || holding.name || "Strategy",
    asset: holding.symbol,
    legs: holding.legsJson || [],
    qty: Number(holding.quantity) || 1,
    quantity: Number(holding.quantity) || 1,
    notional: Number(holding.quantity) || 1,
    netPremiumAtEntry: Number.isFinite(Number(holding.entryPrice)) ? Number(holding.entryPrice) : (Number(holding.price) || 0),
    initialDelta: 0,
    initialTheta: 0,
    executedAt: holding.openedAt || holding.date_added || new Date().toISOString(),
    status: "OPEN",
    pnl: 0
  };
};

function App() {
  useEffect(() => {
    applySeo({
      title: "Zenin Capital App | Trading Dashboard",
      description: "Zenin Capital app workspace for active market research, portfolio management, and trading workflows.",
      robots: "noindex, nofollow, noarchive",
      pathname: typeof window !== "undefined" ? window.location.pathname : "/app",
      canonicalPath: "/app",
      ogTitle: "Zenin Capital App | Trading Dashboard",
      ogDescription: "Authenticated Zenin workspace for portfolio management and trading workflows.",
      schema: []
    });
  }, []);

  useRuntimeConfig({ enabled: true });
  const appRuntimeConfig = getAppRuntimeConfig();
  const fallbackCategories = Array.isArray(appRuntimeConfig?.watchlist?.fallbackCategories)
    ? withRequiredWatchlistCategories(appRuntimeConfig.watchlist.fallbackCategories)
    : DEFAULT_WATCHLIST_CATEGORIES;
  const authenticatorOptions = Array.isArray(appRuntimeConfig?.auth?.authenticatorOptions)
    ? appRuntimeConfig.auth.authenticatorOptions
    : [];
  const passkeyOptions = Array.isArray(appRuntimeConfig?.auth?.passkeyOptions)
    ? appRuntimeConfig.auth.passkeyOptions
    : [];
  const cexOptions = Array.isArray(appRuntimeConfig?.connections?.venues?.cex)
    ? appRuntimeConfig.connections.venues.cex
    : [];
  const dexOptions = Array.isArray(appRuntimeConfig?.connections?.venues?.dex)
    ? appRuntimeConfig.connections.venues.dex
    : [];
  const brokerOptions = Array.isArray(appRuntimeConfig?.connections?.venues?.brokers)
    ? appRuntimeConfig.connections.venues.brokers
    : [];
  const predictionOptions = Array.isArray(appRuntimeConfig?.connections?.venues?.prediction)
    ? appRuntimeConfig.connections.venues.prediction
    : [];

  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [activeCategory, setActiveCategory] = useState("stocks");
  const [activeTheme, setActiveTheme] = useState("");
  const [portfolio, setPortfolio] = useState(() => {
    const stored = readStoredArray("zenin_portfolio");
    if (stored.length > 0) return stored;
    // Initial demo data for new guests to show app capability
    if (!hasAuthToken()) {
      return [
        { symbol: "AAPL", name: "Apple Inc.", type: "stock", marketType: "equity", quantity: 10, entryPrice: 170.0, price: 189.5, currency: "USD" },
        { symbol: "BTC", name: "Bitcoin", type: "crypto", marketType: "spot", quantity: 0.05, entryPrice: 65000, price: 94250, currency: "USD" }
      ];
    }
    return [];
  });
  const [watchlistAssets, setWatchlistAssets] = useState(() => {
    const stored = readStoredArray("zenin_watchlist_assets");
    if (stored.length > 0) return stored;
    if (!hasAuthToken()) {
      return [
        { symbol: "NVDA", name: "NVIDIA", type: "stock", marketType: "equity", theme: "AI Infrastructure", category: "stocks" },
        { symbol: "SOL", name: "Solana", type: "crypto", marketType: "spot", category: "crypto" },
        { symbol: "ETH", name: "Ethereum", type: "crypto", marketType: "spot", category: "crypto" }
      ];
    }
    return [];
  });
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
  const [homeMacroData, setHomeMacroData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [watchlistStale, setWatchlistStale] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHasSettled, setSearchHasSettled] = useState(false);
  const [searchType, setSearchType] = useState("tradfi"); // null, "tradfi", "crypto", or "indicator"
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

  const [activeOptionsTrades, setActiveOptionsTrades] = useState(() => {
    const storedTrades = readStoredArray("zenin_active_options_trades");
    if (storedTrades.length > 0) return storedTrades;
    return readStoredArray("zenin_portfolio")
      .filter((holding) => holding && String(holding.marketType || "").toLowerCase() === "options")
      .map(mapOptionHoldingToTrade)
      .filter(Boolean);
  });
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

  const [balance, setBalance] = useState(() => {
    const rawStoredBalance = localStorage.getItem("zenin_balance");
    const stored = rawStoredBalance == null ? NaN : Number(rawStoredBalance);
    return Number.isFinite(stored) && stored >= 0 ? stored : 10000;
  });
  const [cashBalances, setCashBalances] = useState({});
  const [tradeFeeSummary, setTradeFeeSummary] = useState(null);

  useEffect(() => {
    localStorage.setItem("zenin_balance", balance.toString());
  }, [balance]);

  useEffect(() => {
    localStorage.setItem("zenin_portfolio", JSON.stringify(Array.isArray(portfolio) ? portfolio : []));
  }, [portfolio]);

  useEffect(() => {
    localStorage.setItem("zenin_watchlist_assets", JSON.stringify(Array.isArray(watchlistAssets) ? watchlistAssets : []));
  }, [watchlistAssets]);

  useEffect(() => {
    localStorage.setItem("zenin_active_options_trades", JSON.stringify(Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []));
  }, [activeOptionsTrades]);

  useEffect(() => {
    localStorage.setItem("zenin_custom_stock_themes", JSON.stringify(customStockThemes));
  }, [customStockThemes]);

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
      platform: trade.platform || "zenin",
      status: trade.status || "Filled",
      quantity: Number(trade.quantity) || 0,
      price: Number(trade.price) || 0,
      notional: Number(trade.notional) || 0,
      fee: Number.isFinite(Number(trade.fee)) ? Number(trade.fee) : 0,
      feeCurrency: trade.feeCurrency || "USD",
      feeSource: normalizeFeeSourceValue(
        trade.feeSource,
        String(trade.platform || "zenin").toLowerCase() === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED
      ),
      slippage: Number.isFinite(Number(trade.slippage)) ? Number(trade.slippage) : 0,
      referencePrice: Number.isFinite(Number(trade.referencePrice)) ? Number(trade.referencePrice) : null,
      balanceAfter: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : null,
      portfolioValueAfter: Number.isFinite(Number(trade.portfolioValueAfter)) ? Number(trade.portfolioValueAfter) : null,
      accountEquityAfter: Number.isFinite(Number(trade.accountEquityAfter)) ? Number(trade.accountEquityAfter) : null,
      positionAfter: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null,
      executionMeta: trade.executionMeta || {}
    }));
    localStorage.setItem("zenin_trades", JSON.stringify(persistedTrades));
  }, [trades]);

  useEffect(() => {
    let isMounted = true;

    const fetchHomeMovers = async () => {
      try {
        const [stocksRes, forexRes, commoditiesRes, macroRes] = await Promise.all([
          zeninFetch(`/watchlist?category=stocks`),
          zeninFetch(`/forex`),
          zeninFetch(`/commodities/list`),
          zeninFetch(`/analytics/equities`)
        ]);

        let snapshotAssets = [];
        if (stocksRes.ok) {
          const stocksData = await stocksRes.json();
          snapshotAssets = Array.isArray(stocksData?.assets) ? stocksData.assets : [];
        }

        let forexAssets = [];
        if (forexRes.ok) {
          const forexData = await forexRes.json();
          const gainers = Array.isArray(forexData?.gainers) ? forexData.gainers : [];
          const losers = Array.isArray(forexData?.losers) ? forexData.losers : [];
          forexAssets = [...gainers, ...losers].map(fx => ({
            ...fx,
            symbol: fx.pair || fx.symbol,
            price: Number(fx.rate),
            priceChangePercent: Number(fx.daily),
            type: "forex"
          }));
        }

        let commodityAssets = [];
        if (commoditiesRes.ok) {
          const commData = await commoditiesRes.json();
          commodityAssets = (Array.isArray(commData?.list) ? commData.list : []).map(c => ({
            ...c,
            price: Number(c.price),
            priceChangePercent: Number(c.dailyChangePct),
            type: "commodity"
          }));
        }

        if (macroRes.ok) {
          const macroPayload = await macroRes.json();
          if (isMounted && Array.isArray(macroPayload?.macroData)) {
            setHomeMacroData(macroPayload.macroData);
          }
        }

        const merged = [...snapshotAssets, ...forexAssets, ...commodityAssets]
          .map((asset) => {
            const price = Number(asset?.price);
            const priceChangePercent = Number(asset?.priceChangePercent);
            
            // Clean up symbol to be ticker only
            let cleanSymbol = String(asset?.symbol || "").split(" (")[0].split(" - ")[0].trim();
            if (asset.type === "forex" && cleanSymbol.includes("/")) {
              cleanSymbol = cleanSymbol.split("/")[0]; // Just show the base currency or pair
            }

            return {
              ...asset,
              symbol: cleanSymbol,
              price: Number.isFinite(price) ? price : null,
              priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null
            };
          })
          .filter((asset) => Number.isFinite(asset.price) && Number.isFinite(asset.priceChangePercent));

        if (isMounted) setHomeMarketMovers(merged);
      } catch (error) {
        console.warn("Home movers unavailable; using current local snapshot.", error);
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

    zeninFetch(`/search?q=${encodeURIComponent(searchTerm)}&type=${searchType}`, {
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
        setSearchResults(searchFallbackAssets(searchTerm, searchType));
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

  const mergeWatchlistEntries = (primaryAssets = [], secondaryAssets = []) => {
    const merged = new Map();
    [...(Array.isArray(primaryAssets) ? primaryAssets : []), ...(Array.isArray(secondaryAssets) ? secondaryAssets : [])]
      .forEach((asset) => {
        if (!asset || typeof asset !== "object") return;
        const symbol = normalizeSymbolKey(asset?.symbol);
        if (!symbol) return;
        const key = getAssetCatalogKey(asset);
        const previous = merged.get(key) || {};
        merged.set(key, {
          ...previous,
          ...asset,
          symbol,
          name: asset?.name || previous?.name || symbol,
          type: asset?.type || previous?.type || inferWatchlistAssetKind(asset),
          category: asset?.category ?? previous?.category ?? null,
          theme: asset?.theme ?? previous?.theme ?? null,
          marketType: String(asset?.marketType || previous?.marketType || "").trim().toLowerCase() || inferWatchlistMarketType(asset)
        });
      });
    return Array.from(merged.values());
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
        console.warn("Price refresh unavailable; keeping existing prices.", err);
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

    zeninFetchJson(`/watchlist?category=${activeCategory}`)
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
        } else {
          setAssets((prev) => mergeAssetPrices(getFallbackAssetsForCategory(activeCategory), prev));
        }
        setWatchlistStale(true);
        setWatchlistNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "Using local demo market data while live data is unavailable.");
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
  }, [activeTheme, activeCategory]);

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

  const { liveStreamStatus, lastLivePriceAt } = useLivePriceStream({
    watchlistAssets,
    portfolio: portfolioWithEntry,
    selectedAsset,
    priceCacheRef,
    setAssets,
    setWatchlistAssets,
    setPortfolio,
    setSelectedAsset,
  });

  const fetchCashBalances = useCallback(async () => {
    if (!hasAuthToken()) return null;
    try {
      const res = await zeninFetch("/db/cash");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Cash balance refresh failed (${res.status})`);
      }
      const incomingBalances = Array.isArray(data?.balances) ? data.balances : [];
      const nextCashBalances = {};
      incomingBalances.forEach((row) => {
        const currency = String(row?.currency || "").trim().toUpperCase();
        const amount = Number(row?.balance);
        if (!currency || !Number.isFinite(amount)) return;
        nextCashBalances[currency] = amount;
      });
      setCashBalances(nextCashBalances);
      if (nextCashBalances.USD != null) {
        setBalance(nextCashBalances.USD);
      }
      return nextCashBalances;
    } catch (error) {
      console.warn("Cash balance refresh failed.", error);
      return null;
    }
  }, []);

  const refreshTradingWorkspaceState = useCallback(async () => {
    if (!hasAuthToken()) return null;
    const [cashRes, holdingsRes, tradesRes, feeSummaryRes] = await Promise.all([
      zeninFetch("/db/cash"),
      zeninFetch("/db/portfolio"),
      zeninFetch("/db/trades?limit=1000"),
      zeninFetch("/db/trade-fees/summary")
    ]);

    const [cashData, holdingsData, tradesData, feeSummaryData] = await Promise.all([
      cashRes.json().catch(() => ({})),
      holdingsRes.json().catch(() => ({})),
      tradesRes.json().catch(() => ({})),
      feeSummaryRes.json().catch(() => ({}))
    ]);

    if (!cashRes.ok) {
      throw new Error(cashData?.error || `Cash balance refresh failed (${cashRes.status})`);
    }
    if (!holdingsRes.ok) {
      throw new Error(holdingsData?.error || `Holdings refresh failed (${holdingsRes.status})`);
    }
    if (!tradesRes.ok) {
      throw new Error(tradesData?.error || `Trades refresh failed (${tradesRes.status})`);
    }
    if (!feeSummaryRes.ok) {
      throw new Error(feeSummaryData?.error || `Trade fee summary refresh failed (${feeSummaryRes.status})`);
    }

    const nextCashBalances = {};
    const incomingBalances = Array.isArray(cashData?.balances) ? cashData.balances : [];
    incomingBalances.forEach((row) => {
      const currency = String(row?.currency || "").trim().toUpperCase();
      const amount = Number(row?.balance);
      if (!currency || !Number.isFinite(amount)) return;
      nextCashBalances[currency] = amount;
    });

    const incomingHoldings = Array.isArray(holdingsData?.holdings) ? holdingsData.holdings : [];
    const incomingTrades = Array.isArray(tradesData?.trades)
      ? tradesData.trades.map((trade, idx) => normalizeTradeRecord(trade, idx)).filter((trade) => trade.quantity > 0)
      : [];

    setCashBalances(nextCashBalances);
    if (nextCashBalances.USD != null) {
      setBalance(nextCashBalances.USD);
    }
    setPortfolio(incomingHoldings);
    setActiveOptionsTrades(
      incomingHoldings
        .filter((holding) => holding && String(holding.marketType || "").toLowerCase() === "options")
        .map(mapOptionHoldingToTrade)
        .filter(Boolean)
    );
    setTrades(incomingTrades);
    setTradeFeeSummary(feeSummaryData?.summary || null);

    return {
      balances: nextCashBalances,
      holdings: incomingHoldings,
      trades: incomingTrades,
      feeSummary: feeSummaryData?.summary || null
    };
  }, []);

  const buildRebalanceTradePayload = useCallback((row, idx = 0) => {
    const orderType = row?.action === "Trim" ? "sell" : "buy";
    const symbol = normalizeSymbolKey(row?.symbol);
    const marketType = String(row?.marketType || row?.type || "equity").toLowerCase();
    return {
      symbol,
      name: row?.name || symbol,
      type: String(row?.type || (marketType === "spot" ? "crypto" : "stock")).toLowerCase(),
      marketType,
      orderType,
      quantity: Number(row?.tradeQuantity) || 0,
      price: Number(row?.price) || 0,
      clientId: `rebalance-${symbol}-${marketType}-${Date.now()}-${idx}`,
      executedAt: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10)
    };
  }, []);

  const estimatePortfolioRebalance = useCallback(async (rows = []) => {
    if (!hasAuthToken()) {
      return { mode: "guest", estimates: [], summary: null };
    }
    const tradePayloads = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.action !== "Hold" && Number(row.tradeQuantity) > 0 && Number(row.price) > 0)
      .map((row) => {
        const payload = buildRebalanceTradePayload(row);
        const { clientId, executedAt, date, ...estimatePayload } = payload;
        return estimatePayload;
      });
    if (!tradePayloads.length) {
      return { mode: "empty", estimates: [], summary: { tradeCount: 0, referenceNotional: 0, executedNotional: 0, fees: 0, slippage: 0, totalCostImpact: 0 } };
    }
    const res = await zeninFetch("/db/execute-trade/estimate", {
      method: "POST",
      body: JSON.stringify({ trades: tradePayloads })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || `Rebalance estimate failed (${res.status})`);
    }
    return {
      mode: "signed_in",
      estimates: Array.isArray(data?.estimates) ? data.estimates : [],
      summary: data?.summary || null
    };
  }, [buildRebalanceTradePayload]);

  const executePortfolioRebalance = useCallback(async (rows = []) => {
    const actionableRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.action !== "Hold" && Number(row.tradeQuantity) > 0 && Number(row.price) > 0);

    if (!actionableRows.length) {
      return {
        ok: false,
        mode: "empty",
        message: "There are no actionable rebalance trades right now."
      };
    }

    if (!hasAuthToken()) {
      return {
        ok: false,
        mode: "guest",
        message: "Guest mode can only preview this rebalance. Sign in to place live trades through Zenin."
      };
    }

    const orderedRows = [...actionableRows].sort((a, b) => {
      if (a.action === b.action) return Math.abs(Number(b.tradeValue || 0)) - Math.abs(Number(a.tradeValue || 0));
      return a.action === "Trim" ? -1 : 1;
    });

    const executedTrades = [];

    try {
      for (let index = 0; index < orderedRows.length; index += 1) {
        const payload = buildRebalanceTradePayload(orderedRows[index], index);
        const res = await zeninFetch("/db/execute-trade", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || `Rebalance trade failed for ${payload.symbol}`);
        }
        const savedTrade = data?.trade ? normalizeTradeRecord(data.trade, index) : null;
        if (savedTrade) {
          executedTrades.push(savedTrade);
        }
      }

      const refreshed = await refreshTradingWorkspaceState();
      const summary = executedTrades.reduce((acc, trade) => {
        acc.tradeCount += 1;
        acc.notional += Math.abs(Number(trade?.notional || 0));
        acc.fees += Math.abs(Number(trade?.fee || 0));
        acc.slippage += Math.abs(Number(trade?.slippage || 0));
        return acc;
      }, { tradeCount: 0, notional: 0, fees: 0, slippage: 0 });

      return {
        ok: true,
        mode: "executed",
        trades: executedTrades,
        summary: {
          ...summary,
          totalCostImpact: Number((summary.fees + summary.slippage).toFixed(8))
        },
        refreshed
      };
    } catch (error) {
      try {
        await refreshTradingWorkspaceState();
      } catch (refreshError) {
        console.warn("Workspace refresh after rebalance failure did not complete.", refreshError);
      }
      return {
        ok: false,
        mode: executedTrades.length > 0 ? "partial" : "error",
        trades: executedTrades,
        message: error?.message || "Rebalance execution failed."
      };
    }
  }, [buildRebalanceTradePayload, refreshTradingWorkspaceState]);

const addToPortfolio = async (asset, quantity = 1, orderType = "buy", options = {}) => {
  const { buyCurrency = "USD", notionalInBuyCurrency = null } = options;
  const normalizedQuantity = Math.max(0, quantity);
  if (normalizedQuantity <= 0) return;
  const normalizedSymbol = normalizeSymbolKey(asset.symbol);
  const normalizedMarketType = resolveMarketType(asset);
  const normalizedAsset = { ...asset, symbol: normalizedSymbol, marketType: normalizedMarketType };

  const tradePrice = Number(normalizedAsset.price) || 0;
  const notional = tradePrice * normalizedQuantity;

  if (orderType === "buy") {
    const activeBalance = buyCurrency === "USD" ? balance : (cashBalances[buyCurrency] || 0);
    const cost = notionalInBuyCurrency != null ? notionalInBuyCurrency : notional;
    if (cost > activeBalance) {
      const msg = `Insufficient ${buyCurrency} balance. You need ${buyCurrency} ${(cost - activeBalance).toFixed(2)} more.`;
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
      buyCurrency,
      notionalInBuyCurrency,
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
    fetchCashBalances();

  } catch (err) {
    console.warn(`Backend ${orderType} unavailable; recording local simulated trade.`, err);
    const localBalance = orderType === "buy" ? balance - notional : balance + notional;
    setBalance(localBalance);
    setPortfolio((prev) => {
      const existingIndex = prev.findIndex(
        (item) =>
          normalizeSymbolKey(item.symbol) === normalizedSymbol &&
          String(item.marketType || "spot").toLowerCase() === normalizedMarketType
      );
      if (orderType === "buy") {
        if (existingIndex >= 0) {
          return prev.map((item, idx) => {
            if (idx !== existingIndex) return item;
            const previousQty = Number(item.quantity) || 0;
            const nextQty = previousQty + normalizedQuantity;
            const previousEntry = Number(item.entryPrice ?? item.price) || 0;
            const nextEntry = nextQty > 0
              ? ((previousEntry * previousQty) + (tradePrice * normalizedQuantity)) / nextQty
              : tradePrice;
            return {
              ...item,
              price: tradePrice,
              quantity: nextQty,
              entryPrice: nextEntry,
              openedAt: item.openedAt || executionTimestamp
            };
          });
        }
        return [
          ...prev,
          {
            id: `local-${Date.now()}`,
            symbol: normalizedSymbol,
            name: normalizedAsset.name || normalizedSymbol,
            price: tradePrice,
            quantity: normalizedQuantity,
            entryPrice: tradePrice,
            openedAt: executionTimestamp,
            type: normalizeAssetType(normalizedAsset),
            marketType: normalizedMarketType,
            date_added: executionTimestamp
          }
        ];
      }
      if (existingIndex < 0) return prev;
      return prev
        .map((item, idx) => {
          if (idx !== existingIndex) return item;
          return {
            ...item,
            price: tradePrice,
            quantity: Math.max(0, (Number(item.quantity) || 0) - normalizedQuantity)
          };
        })
        .filter((item) => (Number(item.quantity) || 0) > 0);
    });
    setTrades((prev) => [
      normalizeTradeRecord({
        id: Date.now(),
        clientId: `${normalizedSymbol}-${normalizedMarketType}-local-${Date.now()}`,
        date: executionDate,
        executedAt: executionTimestamp,
        asset: normalizedSymbol,
        name: normalizedAsset.name || normalizedSymbol,
        type: orderType === "sell" ? "SELL" : "BUY",
        side: orderType,
        marketType: normalizedMarketType,
        status: "Filled",
        quantity: normalizedQuantity,
        price: tradePrice,
        notional,
        balanceAfter: localBalance
      }, 0),
      ...prev
    ]);
  }

  showTradeToast(`${orderType === "buy" ? "Bought" : "Sold"} ${normalizedQuantity} ${normalizedSymbol} successfully.`, "success");
  return { ok: true, action: orderType, symbol: normalizedSymbol };
};

const handleOptionTradeExecuted = async (tradePayload) => {
  const quantity = Number(tradePayload.qty ?? tradePayload.quantity) || 1;
  const entryPremium = Number(tradePayload.netPremiumAtEntry ?? tradePayload.price) || 0;
  const localNotional = Math.abs(Number(tradePayload.notional ?? tradePayload.totalNotional) || entryPremium * quantity || quantity);
  const atomicPayload = {
    symbol: tradePayload.asset || tradePayload.symbol,
    name: tradePayload.strategy || tradePayload.name || "Strategy",
    type: "options",
    marketType: "options",
    orderType: "buy",
    quantity,
    price: entryPremium,
    strategyName: tradePayload.strategy || tradePayload.name,
    legsJson: tradePayload.legs || [],
    executedAt: new Date().toISOString(),
    clientId: tradePayload.id || `opt-trade-${Date.now()}`
  };

  const recordSimulatedOptionTrade = () => {
    const localId = tradePayload.id || `opt-temp-${Date.now()}`;
    const localTrade = {
      id: localId,
      strategy: atomicPayload.strategyName,
      asset: atomicPayload.symbol,
      legs: atomicPayload.legsJson || [],
      qty: atomicPayload.quantity,
      quantity: atomicPayload.quantity,
      notional: localNotional,
      totalNotional: localNotional,
      netPremiumAtEntry: entryPremium,
      initialDelta: Number.isFinite(Number(tradePayload.initialDelta)) ? Number(tradePayload.initialDelta) : 0,
      initialTheta: Number.isFinite(Number(tradePayload.initialTheta)) ? Number(tradePayload.initialTheta) : 0,
      status: "OPEN",
      executedAt: atomicPayload.executedAt
    };

    setActiveOptionsTrades((prev) => [localTrade, ...(Array.isArray(prev) ? prev : [])]);
    setPortfolio((prev) => [
      {
        id: localId,
        symbol: atomicPayload.symbol,
        name: atomicPayload.strategyName,
        type: "options",
        marketType: "options",
        quantity: atomicPayload.quantity,
        price: entryPremium,
        entryPrice: entryPremium,
        strategyName: atomicPayload.strategyName,
        legsJson: atomicPayload.legsJson || [],
        openedAt: atomicPayload.executedAt,
        date_added: atomicPayload.executedAt
      },
      ...(Array.isArray(prev) ? prev : [])
    ]);
    if (localNotional > 0) {
      setBalance((prev) => Math.max(0, (Number(prev) || 0) - localNotional));
    }
    setTrades((prev) => [
      normalizeTradeRecord({
        clientId: `${atomicPayload.symbol}-options-open-${Date.now()}`,
        date: atomicPayload.executedAt.split("T")[0],
        executedAt: atomicPayload.executedAt,
        asset: atomicPayload.symbol,
        name: atomicPayload.strategyName,
        type: "BUY",
        side: "buy",
        marketType: "options",
        status: "Filled",
        quantity: atomicPayload.quantity,
        price: entryPremium,
        notional: localNotional
      }, 0),
      ...prev
    ]);
    showTradeToast(`Simulated ${atomicPayload.strategyName} on ${atomicPayload.symbol}`, "success");
  };

  if (!hasAuthToken()) {
    recordSimulatedOptionTrade();
    return;
  }

  try {

    const response = await zeninFetch(`/db/execute-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(atomicPayload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
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
  const normalizeId = (value) => String(value ?? "").trim();
  const tradeObj = activeOptionsTrades.find((trade) => {
    const ids = [trade.id, trade.dbId, trade.dbId != null ? `opt-${trade.dbId}` : null].map(normalizeId);
    return ids.includes(normalizeId(tradeId));
  });
  if (!tradeObj) return;

  const dbId = tradeObj.dbId || (typeof tradeId === "string" ? tradeId.replace(/^opt-/, "") : tradeId);
  const quantity = Number(tradeObj.qty ?? tradeObj.quantity) || 1;
  const priceCandidates = [
    tradeObj.currentMark,
    tradeObj.mark,
    tradeObj.price,
    tradeObj.netPremiumAtEntry,
    tradeObj.entryPrice
  ].map((value) => (value === null || value === undefined || value === "" ? NaN : Number(value)));
  const closePrice = priceCandidates.find(Number.isFinite) ?? 0;
  const simulatedProceeds = Number(tradeObj.totalNotional ?? tradeObj.notional);
  const closeNotional = Math.abs(Number.isFinite(simulatedProceeds) && simulatedProceeds > 0 ? simulatedProceeds : closePrice * quantity);
  const executedAt = new Date().toISOString();
  const targetIds = [tradeId, dbId, dbId != null ? `opt-${dbId}` : null].map(normalizeId).filter(Boolean);
  const hasBackendId = Boolean(normalizeId(dbId)) && !normalizeId(tradeObj.id).startsWith("sim-") && !normalizeId(tradeObj.id).startsWith("opt-temp-");

  const matchesOptionTrade = (trade) => {
    const ids = [trade.id, trade.dbId, trade.dbId != null ? `opt-${trade.dbId}` : null].map(normalizeId).filter(Boolean);
    return ids.some((id) => targetIds.includes(id));
  };

  const closeSimulatedOptionTrade = () => {
    setActiveOptionsTrades((prev) => (Array.isArray(prev) ? prev.filter((trade) => !matchesOptionTrade(trade)) : []));
    setPortfolio((prev) => {
      if (!Array.isArray(prev)) return [];
      return prev.filter((holding) => {
        const holdingIds = [holding.id, holding.dbId, holding.id != null ? `opt-${holding.id}` : null].map(normalizeId).filter(Boolean);
        return !holdingIds.some((id) => targetIds.includes(id));
      });
    });
    if (closeNotional > 0) {
      setBalance((prev) => (Number(prev) || 0) + closeNotional);
    }
    setTrades((prev) => [
      normalizeTradeRecord({
        clientId: `${tradeObj.asset}-options-close-${Date.now()}`,
        date: executedAt.split("T")[0],
        executedAt,
        asset: tradeObj.asset,
        name: tradeObj.strategy || "Options Strategy",
        type: "SELL",
        side: "sell",
        marketType: "options",
        status: "Filled",
        quantity,
        price: closePrice,
        notional: closeNotional
      }, 0),
      ...prev
    ]);
    showTradeToast(`Closed ${tradeObj.strategy || "options trade"} on ${tradeObj.asset} (simulated)`, "success");
  };

  if (!hasAuthToken() || !hasBackendId) {
    closeSimulatedOptionTrade();
    return;
  }

  try {
    const atomicPayload = {
      symbol: tradeObj.asset,
      name: tradeObj.strategy,
      type: "options",
      marketType: "options",
      orderType: "sell",
      quantity,
      price: closePrice,
      strategyName: tradeObj.strategy,
      legsJson: tradeObj.legs || [],
      executedAt
    };

    const response = await zeninFetch(`/db/execute-trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(atomicPayload)
    });

    if (!response.ok) {
       const errData = await response.json().catch(() => ({}));
       throw new Error(errData.error || "Failed to close option position");
    }

    const data = await response.json();
    setBalance(data.balance ?? balance);
    setPortfolio(data.holdings || []);
    
    setActiveOptionsTrades(prev => prev.filter(t => !matchesOptionTrade(t)));

    const savedTrade = data?.trade ? normalizeTradeRecord(data.trade, 0) : null;
    if (savedTrade) {
      setTrades(prev => [savedTrade, ...prev]);
    }

    showTradeToast(`Closed ${tradeObj.strategy} on ${tradeObj.asset}`, "success");
  } catch (err) {
    console.error("Failed to close option:", err);
    closeSimulatedOptionTrade();
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

  useEffect(() => {
    if (spotPrices && Object.keys(spotPrices).length > 0) {
      updateFXRates(spotPrices);
    }
  }, [spotPrices]);

  const portfolioMarketValue = useMemo(
    () => calculatePortfolioMarketValue(portfolioWithEntry, spotPrices, convertToUSD),
    [portfolioWithEntry, spotPrices]
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
      return true;
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
      return true;
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

  const sections = ["Home", "Portfolio", "Watchlist","Analytics", "Metrics", "Options", "Predictions", "Journal", "Tax Estimator"];
  const [activeSection, setActiveSection] = useState(() => {
    const saved = localStorage.getItem("zenin_active_section");
    return sections.includes(saved) ? saved : "Home";
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 960);
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("zenin_email") || "user@zenin.app");
  const [simulatePlan, setSimulatePlan] = useState(() => localStorage.getItem("zenin_simulate_plan") || "");
  const allowGuestAccess = useMemo(() => isGuestAccessRequested(), []);
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
  const [currentBillingCycle, setCurrentBillingCycle] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return String(parsed?.currentBillingCycle || "monthly").trim().toLowerCase() === "yearly"
        ? "yearly"
        : "monthly";
    } catch {
      return "monthly";
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
  const [authUserId, setAuthUserId] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return parsed?.id != null ? String(parsed.id) : "";
    } catch {
      return "";
    }
  });
  const [authDisplayName, setAuthDisplayName] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      return String(parsed?.displayName || "").trim();
    } catch {
      return "";
    }
  });
  const [isGuestUser, setIsGuestUser] = useState(() => allowGuestAccess || !hasStoredAuthSession());

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
    "profile-email": false,
    "profile-password": false,
    "profile-twofa": false,
    "workspace-overview": true,
    "workspace-team": true,
    "workspace-activity": true,
    "general-display": true,
    "general-data": true,
    "accounts-connected": true,
    "layout-presets": true,
    "notifications-channels": true
  });

  useEffect(() => {
    if (!isSettingsOpen || activeSettingsCategory !== "Profile") return;
    setExpandedSettingsPanels((prev) => {
      if (!prev["profile-email"] && !prev["profile-password"] && !prev["profile-twofa"]) return prev;
      return {
        ...prev,
        "profile-email": false,
        "profile-password": false,
        "profile-twofa": false
      };
    });
  }, [isSettingsOpen, activeSettingsCategory]);

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
    () => isGuestUser ? sections : sections.filter((section) => hasSectionAccessForUser(currentPlan, isAdmin, section)),
    [sections, currentPlan, isAdmin, isGuestUser]
  );
  const sidebarNavigationGroups = useMemo(() => {
    const hiddenRailSections = new Set(isSidebarCollapsed ? ["Metrics", "Predictions"] : ["Metrics"]);
    const visibleSections = accessibleSections.filter((section) => !hiddenRailSections.has(section));
    return SIDEBAR_GROUP_ORDER.map((group) => ({
      label: group,
      items: visibleSections.map((section) => ({
        section,
        meta: SIDEBAR_SECTION_META[section] || {
          group: "Workspace",
          eyebrow: "Section",
          description: "Open this workspace section."
        }
      })).filter((entry) => entry.meta.group === group)
    })).filter((group) => group.items.length > 0);
  }, [accessibleSections, isSidebarCollapsed]);
  const handleLogout = useCallback(async () => {
    await signOutEverywhere();

    // Comprehensive cleanup of all Zenin-related local storage items
    const keysToRemove = [
      "zenin_auth_user",
      "zenin_auth_expires_at",
      "zenin_email",
      "zenin_balance",
      "zenin_portfolio",
      "zenin_watchlist_assets",
      "zenin_active_options_trades",
      "zenin_custom_stock_themes",
      "zenin_trades",
      "zenin_preferences",
      "zenin_profile_security",
      "zenin_connected_accounts",
      "zenin_active_section",
      "zenin_journal_entries",
      "zenin_tax_estimates",
      "zenin_tax_audit_trail",
      "zenin_fx_rates",
      "zenin_pricing_billing_cycle",
      "zenin_post_auth_next"
    ];

    keysToRemove.forEach(key => localStorage.removeItem(key));
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(getConnectPromptSessionKey(authUserId));
    }
    
    // Hard redirect to clear any memory-resident state
    window.location.href = "/";
  }, [authUserId]);

  const {
    bootstrapData,
    bootstrapLoading,
    bootstrapError
  } = useAppBootstrap({
    enabled: !accessCheckLoading && !isGuestUser,
    tradeLimit: 1000
  });

  useEffect(() => {
    if (!bootstrapData?.appConfig) return;
    setRuntimeConfigs({ appConfig: bootstrapData.appConfig });
  }, [bootstrapData, currentBillingCycle, currentPlan, isAdmin]);

  useEffect(() => {
    const unsubscribe = subscribeToSupabaseAuth((event) => {
      if (event === "SIGNED_OUT") {
        setAccessCheckLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let mounted = true;

    const hydrateRequiredAuth = async () => {
      try {
        let res = await zeninFetch("/auth/me");
        let data = await res.json().catch(() => ({}));
        if ((!res.ok || !data?.authenticated || !data?.user) && !allowGuestAccess) {
          const exchanged = await ensureZeninSessionFromSupabase();
          if (exchanged?.user) {
            res = await zeninFetch("/auth/me");
            data = await res.json().catch(() => ({}));
          }
        }
        if (!mounted) return;
        if (!res.ok || !data?.authenticated || !data?.user) {
          if (!allowGuestAccess) {
            redirectToAuthGate();
            return;
          }
          localStorage.removeItem("zenin_auth_user");
          localStorage.removeItem("zenin_auth_expires_at");
          setIsGuestUser(true);
          setIsAdmin(false);
          setAuthUserId("");
          setAuthDisplayName("");
          setCurrentPlan("starter");
          setCurrentBillingCycle("monthly");
          setAccountPlanLabel("Starter Plan");
          setProfileSecurity((prev) => ({
            ...buildDefaultProfileSecurity(localStorage.getItem("zenin_email") || prev?.email || "user@zenin.app"),
            passwordHash: prev?.passwordHash || ""
          }));
          setActiveWorkspace(null);
          setWorkspaceMembers([]);
          setWorkspaceInvites([]);
          setWorkspaceActivity([]);
          settingsSyncReadyRef.current = false;
          setAccessCheckLoading(false);
          return;
        } else {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          if (data.user.email) localStorage.setItem("zenin_email", data.user.email);
          const userIsAdmin = isAdminUser(data.user);
          const effectivePlan = resolveEffectivePlan(data.user.currentPlan, data?.workspace?.plan);
          const effectiveBillingCycle = String(data?.workspace?.billingCycle || data.user.currentBillingCycle || "monthly").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
          setUserEmail(String(data.user.email || localStorage.getItem("zenin_email") || "user@zenin.app"));
          setIsAdmin(userIsAdmin);
          setIsGuestUser(false);
          setAuthUserId(data.user.id != null ? String(data.user.id) : "");
          setAuthDisplayName(String(data.user.displayName || "").trim());
          setCurrentPlan(effectivePlan);
          setCurrentBillingCycle(effectiveBillingCycle);
          setAccountPlanLabel(userIsAdmin ? "Admin" : formatPlanLabel(effectivePlan, effectiveBillingCycle));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || localStorage.getItem("zenin_email") || "user@zenin.app"));
          setActiveWorkspace(data?.workspace || null);
          setWorkspaceForm({
            name: String(data?.workspace?.name || "").trim(),
            slug: String(data?.workspace?.slug || "").trim()
          });
        }
        setAccessCheckLoading(false);
      } catch {
        if (!mounted) return;
        if (!allowGuestAccess) {
          setAccessCheckLoading(false);
          return;
        }
        localStorage.removeItem("zenin_auth_user");
        localStorage.removeItem("zenin_auth_expires_at");
        setIsGuestUser(true);
        setIsAdmin(false);
        setAuthUserId("");
        setAuthDisplayName("");
        setCurrentPlan("starter");
        setCurrentBillingCycle("monthly");
        setAccountPlanLabel("Starter Plan");
        setActiveWorkspace(null);
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setWorkspaceActivity([]);
        settingsSyncReadyRef.current = false;
        setAccessCheckLoading(false);
      }
    };

    hydrateRequiredAuth();
    return () => {
      mounted = false;
    };
  }, [allowGuestAccess]);

  useEffect(() => {
    if (accessCheckLoading) return undefined;
    if (isGuestUser) {
      settingsSyncReadyRef.current = false;
      setConnectedAccountsHydrated(true);
      return undefined;
    }

    let cancelled = false;
    settingsSyncReadyRef.current = false;
    setConnectedAccountsHydrated(false);

    const loadWorkspaceSettings = async () => {
      try {
        const preferencesResult = await loadWorkspaceDoc("settings:preferences", null);
        if (cancelled) return;
        if (preferencesResult?.document && typeof preferencesResult.document === "object") {
          setPreferences((prev) => ({
            ...prev,
            ...preferencesResult.document
          }));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Workspace settings sync unavailable.", error);
        }
      } finally {
        if (!cancelled) {
          settingsSyncReadyRef.current = true;
          setConnectedAccountsHydrated(true);
        }
      }
    };

    loadWorkspaceSettings();

    return () => {
      cancelled = true;
    };
  }, [accessCheckLoading, isGuestUser]);

  useEffect(() => {
    if (!accessibleSections.length) return;
    if (!accessibleSections.includes(activeSection)) {
      setActiveSection(accessibleSections[0]);
    }
  }, [accessibleSections, activeSection]);

  useEffect(() => {
    if (!bootstrapData) return;

    const incomingBalances = Array.isArray(bootstrapData?.balances) ? bootstrapData.balances : [];
    const incomingHoldings = Array.isArray(bootstrapData?.holdings) ? bootstrapData.holdings : [];
    const incomingWatchlist = Array.isArray(bootstrapData?.watchlistAssets) ? bootstrapData.watchlistAssets : [];
    const incomingTrades = Array.isArray(bootstrapData?.trades)
      ? bootstrapData.trades.map((trade, idx) => normalizeTradeRecord(trade, idx)).filter((trade) => trade.quantity > 0)
      : [];
    const localWatchlist = readStoredArray("zenin_watchlist_assets");
    const mergedWatchlist = mergeWatchlistEntries(localWatchlist, incomingWatchlist);
    const backendKeys = new Set(incomingWatchlist.map((asset) => getAssetCatalogKey(asset)));
    const missingLocalAssets = localWatchlist.filter((asset) => !backendKeys.has(getAssetCatalogKey(asset)));

    startTransition(() => {
      const nextCashBalances = {};
      incomingBalances.forEach((row) => {
        const currency = String(row?.currency || "").trim().toUpperCase();
        const amount = Number(row?.balance);
        if (!currency || !Number.isFinite(amount)) return;
        nextCashBalances[currency] = amount;
      });
      setCashBalances(nextCashBalances);
      if (nextCashBalances.USD != null) {
        setBalance(nextCashBalances.USD);
      }

      setPortfolio(incomingHoldings);
      setActiveOptionsTrades(
        incomingHoldings
          .filter((holding) => holding && String(holding.marketType || "").toLowerCase() === "options")
          .map(mapOptionHoldingToTrade)
          .filter(Boolean)
      );
      setWatchlistAssets((prev) => mergeAssetPrices(mergedWatchlist, prev));
      setTrades(incomingTrades);
      setTradeFeeSummary(bootstrapData?.feeSummary || null);
      if (bootstrapData?.activeWorkspace?.plan) {
        const effectivePlan = resolveEffectivePlan(currentPlan, bootstrapData.activeWorkspace.plan);
        if (effectivePlan !== currentPlan) {
          setCurrentPlan(effectivePlan);
          setAccountPlanLabel(isAdmin ? "Admin" : formatPlanLabel(effectivePlan, bootstrapData?.activeWorkspace?.billingCycle || currentBillingCycle));
        }
      }
      setActiveWorkspace(bootstrapData?.activeWorkspace || null);
      setWorkspaceMembers(Array.isArray(bootstrapData?.workspaceMembers) ? bootstrapData.workspaceMembers : []);
      setWorkspaceInvites(Array.isArray(bootstrapData?.workspaceInvites) ? bootstrapData.workspaceInvites : []);
      setWorkspaceActivity(Array.isArray(bootstrapData?.workspaceActivity) ? bootstrapData.workspaceActivity : []);
      setWorkspaceForm({
        name: String(bootstrapData?.activeWorkspace?.name || "").trim(),
        slug: String(bootstrapData?.activeWorkspace?.slug || "").trim()
      });
      if (Array.isArray(bootstrapData?.workspaceAccounts) && bootstrapData.workspaceAccounts.length) {
        setConnectedAccounts(bootstrapData.workspaceAccounts.map((account) => ({
          id: account.id,
          provider: account.extraData?.providerLabel || account.exchange,
          exchange: account.exchange,
          username: account.extraData?.username || account.extraData?.address || "Workspace source",
          venueType: account.extraData?.venueType || "cex",
          apiKeyMasked: "Workspace managed",
          permissionScope: account.permissionScope || "unknown",
          canTrade: !!account.canTrade,
          lastVerifiedScope: account.lastVerifiedScope || "unknown",
          riskLevel: account.riskLevel || "standard",
          syncAvailable: account.syncAvailable !== false,
          connectedAt: account.createdAt || null,
          lastSyncAt: account.lastSyncAt || null,
          lastSyncStatus: account.lastSyncStatus || "idle",
          lastSyncMeta: account.lastSyncMeta || {}
        })));
      }
      setCategories(
        Array.isArray(bootstrapData?.categories) && bootstrapData.categories.length
          ? withRequiredWatchlistCategories(bootstrapData.categories)
          : fallbackCategories
      );
    });

    if (missingLocalAssets.length > 0) {
      zeninFetch(`/db/watchlist/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: missingLocalAssets })
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to sync watchlist: ${res.status}`);
          return res.json();
        })
        .then((syncData) => {
          const savedAssets = Array.isArray(syncData?.assets) ? syncData.assets : [];
          if (!savedAssets.length) return;
          startTransition(() => {
            setWatchlistAssets((prev) => mergeAssetPrices(mergeWatchlistEntries(prev, savedAssets), prev));
          });
        })
        .catch((err) => console.warn("Watchlist bulk sync skipped.", err));
    }
  }, [bootstrapData]);

  useEffect(() => {
    if (!bootstrapError) return;
    console.warn("Workspace bootstrap unavailable; using existing local state.", bootstrapError);
    if (!categories.length) {
      setCategories(fallbackCategories);
    }
  }, [bootstrapError, categories.length, fallbackCategories]);

  useEffect(() => {
    if (!isGuestUser) return;
    if (!categories.length) {
      setCategories(fallbackCategories);
    }
  }, [isGuestUser, categories.length, fallbackCategories]);
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
  const [connectPromptMode, setConnectPromptMode] = useState("manual");
  const [connectAccountFeedback, setConnectAccountFeedback] = useState("");
  const [connectAccountSuccess, setConnectAccountSuccess] = useState(null);
  const [connectedAccountsHydrated, setConnectedAccountsHydrated] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [workspaceMembers, setWorkspaceMembers] = useState([]);
  const [workspaceInvites, setWorkspaceInvites] = useState([]);
  const [workspaceActivity, setWorkspaceActivity] = useState([]);
  const [workspaceFeedback, setWorkspaceFeedback] = useState(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", slug: "" });
  const [workspaceInviteForm, setWorkspaceInviteForm] = useState({ email: "", role: "member" });
  const [accountForm, setAccountForm] = useState({
    venueType: "cex",
    provider: cexOptions[0] || "Binance",
    username: "",
    apiKey: "",
    apiSecret: ""
  });
  const [isSyncingAccount, setIsSyncingAccount] = useState(false);
  const settingsCategories = ["Profile", "Subscription", "Workspace", "General", "Accounts", "Layout", "Notification"];
  const [profileSecurity, setProfileSecurity] = useState(() => {
    const raw = localStorage.getItem("zenin_profile_security");
    const fallback = buildDefaultProfileSecurity(localStorage.getItem("zenin_email") || "user@zenin.app");
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
  const settingsSyncReadyRef = useRef(false);
  const [profileForms, setProfileForms] = useState({
    newEmail: "",
    emailPassword: "",
    emailVerificationCode: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    twoFactorMethod: "authenticator",
    authenticatorService: authenticatorOptions[0] || "Google Authenticator",
    twoFactorCode: "",
    phoneNumber: "",
    recoveryEmail: "",
    passkeyName: "Primary Device",
    passkeyProvider: passkeyOptions[0] || "iCloud Keychain"
  });
  const [totpSetup, setTotpSetup] = useState({ secret: null, qrCodeDataUrl: null, loading: false });
  const [profileFeedback, setProfileFeedback] = useState({
    email: null,
    password: null,
    twofa: null
  });
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => getBrowserNotificationPermission());
  const [notificationFeedback, setNotificationFeedback] = useState(null);
  const revenueCatPaywallRef = useRef(null);
  const revenueCatPlanSyncRef = useRef("");
  const [revenueCatState, setRevenueCatState] = useState({
    loading: false,
    syncingPlan: false,
    purchasing: false,
    paywallBusy: false,
    error: "",
    message: "",
    customerInfo: null,
    offerings: null,
    access: null
  });
  const formatSubscriptionUserError = useCallback((error, fallback = "We couldn't load subscription details right now. Please try again shortly.") => {
    if (isRevenueCatCancelledError(error)) {
      return "Purchase canceled.";
    }
    const rawMessage = formatRevenueCatError(error);
    const normalized = String(rawMessage || "").trim().toLowerCase();
    if (
      normalized.includes("revenuecat api key") ||
      normalized.includes("offering") ||
      normalized.includes("entitlement") ||
      normalized.includes("product") ||
      normalized.includes("app user id")
    ) {
      return fallback;
    }
    return rawMessage;
  }, []);

  useEffect(() => {
    if (!authenticatorOptions.length) return;
    setProfileForms((prev) => (
      authenticatorOptions.includes(prev.authenticatorService)
        ? prev
        : { ...prev, authenticatorService: authenticatorOptions[0] }
    ));
  }, [authenticatorOptions]);

  useEffect(() => {
    if (!passkeyOptions.length) return;
    setProfileForms((prev) => (
      passkeyOptions.includes(prev.passkeyProvider)
        ? prev
        : { ...prev, passkeyProvider: passkeyOptions[0] }
    ));
  }, [passkeyOptions]);

  useEffect(() => {
    const venueCatalog = accountForm.venueType === "cex"
      ? cexOptions
      : accountForm.venueType === "dex"
        ? dexOptions
        : accountForm.venueType === "prediction"
          ? predictionOptions
          : brokerOptions;
    if (!venueCatalog.length) return;
    setAccountForm((prev) => (
      venueCatalog.includes(prev.provider)
        ? prev
        : { ...prev, provider: venueCatalog[0] }
    ));
  }, [accountForm.venueType, brokerOptions, cexOptions, dexOptions, predictionOptions]);

  const browserNotificationsSupported = browserNotificationPermission !== "unsupported";
  const browserNotificationsGranted = browserNotificationPermission === "granted";
  const browserNotificationsBlocked = browserNotificationPermission === "denied";
  const browserNotificationStatusLabel = browserNotificationPermission === "granted"
    ? "Allowed"
    : browserNotificationPermission === "denied"
      ? "Blocked"
      : browserNotificationPermission === "default"
        ? "Not requested"
        : "Unavailable";
  const emailNotificationDestination = String(profileSecurity?.email || userEmail || "").trim();
  const canUseEmailNotifications = !isGuestUser && Boolean(emailNotificationDestination) && Boolean(profileSecurity?.emailVerified);
  const effectiveEmailNotificationsEnabled = preferences.notifyEmail && canUseEmailNotifications;
  const canUseBrowserNotifications = browserNotificationsSupported && browserNotificationsGranted;
  const effectiveBrowserNotificationsEnabled = preferences.notifyBrowser && canUseBrowserNotifications;

  const setNotificationMessage = useCallback((type, text) => {
    setNotificationFeedback(text ? { type, text } : null);
  }, []);

  const requestBrowserNotificationAccess = useCallback(async () => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      setBrowserNotificationPermission("unsupported");
      setNotificationMessage("error", "Browser notifications are not supported in this browser.");
      return false;
    }

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    setBrowserNotificationPermission(permission);

    if (permission === "granted") {
      return true;
    }

    setNotificationMessage(
      "error",
      permission === "denied"
        ? "Browser notifications are blocked. Enable them in your browser site settings to continue."
        : "Browser notification permission was dismissed."
    );
    return false;
  }, [setNotificationMessage]);

  const sendTestBrowserNotification = useCallback(async () => {
    const granted = await requestBrowserNotificationAccess();
    if (!granted || typeof Notification === "undefined") return;

    const notification = new Notification("Zenin alerts are ready", {
      body: "Browser notifications are enabled for market alerts, order updates, and workspace reminders."
    });
    notification.onclick = () => {
      if (typeof window !== "undefined") {
        window.focus();
      }
    };
    setNotificationMessage("success", "Sent a test browser notification.");
  }, [requestBrowserNotificationAccess, setNotificationMessage]);

  const handleNotificationPreferenceToggle = useCallback(async (key, checked) => {
    setNotificationFeedback(null);

    if (key === "notifyBrowser") {
      if (!checked) {
        setPreferences((prev) => ({ ...prev, notifyBrowser: false }));
        setNotificationMessage("info", "Browser notifications turned off for this workspace.");
        return;
      }
      if (!browserNotificationsSupported) {
        setPreferences((prev) => ({ ...prev, notifyBrowser: false }));
        setNotificationMessage("error", "Browser notifications are not supported in this browser.");
        return;
      }
      if (browserNotificationsBlocked) {
        setPreferences((prev) => ({ ...prev, notifyBrowser: false }));
        setNotificationMessage("error", "Browser notifications are blocked. Enable them in your browser site settings to continue.");
        return;
      }
      const granted = await requestBrowserNotificationAccess();
      if (!granted) {
        setPreferences((prev) => ({ ...prev, notifyBrowser: false }));
        return;
      }
      setPreferences((prev) => ({ ...prev, notifyBrowser: true }));
      setNotificationMessage("success", "Browser notifications enabled.");
      return;
    }

    if (key === "notifyEmail") {
      if (!checked) {
        setPreferences((prev) => ({ ...prev, notifyEmail: false }));
        setNotificationMessage("info", "Email notifications turned off for this workspace.");
        return;
      }
      if (isGuestUser) {
        setPreferences((prev) => ({ ...prev, notifyEmail: false }));
        setNotificationMessage("error", "Sign in to route email notifications to an account inbox.");
        return;
      }
      if (!profileSecurity?.emailVerified) {
        setPreferences((prev) => ({ ...prev, notifyEmail: false }));
        setNotificationMessage("error", "Verify your profile email before enabling email notifications.");
        return;
      }
      if (!emailNotificationDestination) {
        setPreferences((prev) => ({ ...prev, notifyEmail: false }));
        setNotificationMessage("error", "Add a profile email before enabling email notifications.");
        return;
      }
      setPreferences((prev) => ({ ...prev, notifyEmail: true }));
      setNotificationMessage("success", `Email notifications will go to ${emailNotificationDestination}.`);
      return;
    }

    setPreferences((prev) => ({ ...prev, [key]: checked }));
    if (!checked) return;

    if (effectiveBrowserNotificationsEnabled === false && canUseBrowserNotifications === false) {
      await requestBrowserNotificationAccess();
    }

    if (effectiveBrowserNotificationsEnabled) {
      setNotificationMessage("success", "This alert type will use your enabled browser notification channel.");
      return;
    }

    if (effectiveEmailNotificationsEnabled) {
      setNotificationMessage("success", `This alert type will also route to ${emailNotificationDestination}.`);
      return;
    }

    setNotificationMessage("info", "Enable browser or verified email notifications to ensure this alert type can reach you.");
  }, [
    browserNotificationsBlocked,
    browserNotificationsSupported,
    canUseBrowserNotifications,
    browserNotificationPermission,
    emailNotificationDestination,
    effectiveBrowserNotificationsEnabled,
    effectiveEmailNotificationsEnabled,
    isGuestUser,
    profileSecurity?.emailVerified,
    requestBrowserNotificationAccess,
    setNotificationMessage
  ]);

  useEffect(() => {
    setPreferences((prev) => {
      let changed = false;
      const next = { ...prev };

      if (prev.notifyEmail && !canUseEmailNotifications) {
        next.notifyEmail = false;
        changed = true;
      }

      if (prev.notifyBrowser && !canUseBrowserNotifications) {
        next.notifyBrowser = false;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [canUseBrowserNotifications, canUseEmailNotifications]);

  const syncRevenueCatPlanToAccount = useCallback(async (access) => {
    if (isGuestUser || !access?.hasActiveSubscription) return;

    const targetPlan = normalizeCurrentPlan(access.currentPlan);
    const targetBillingCycle = String(access.currentBillingCycle || "monthly").trim().toLowerCase() === "yearly"
      ? "yearly"
      : "monthly";

    if (targetPlan === "starter") return;

    const syncKey = `${targetPlan}:${targetBillingCycle}`;
    if (
      revenueCatPlanSyncRef.current === syncKey ||
      (currentPlan === targetPlan && currentBillingCycle === targetBillingCycle)
    ) {
      revenueCatPlanSyncRef.current = syncKey;
      return;
    }

    setRevenueCatState((prev) => ({ ...prev, syncingPlan: true }));
    try {
      const res = await zeninFetch(`${BACKEND_URL}/api/account/plan`, {
        method: "POST",
        body: JSON.stringify({ plan: targetPlan, billingCycle: targetBillingCycle })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Failed to sync RevenueCat plan with Zenin.");
      }

      if (data?.user) {
        localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
        if (data.user.email) {
          localStorage.setItem("zenin_email", data.user.email);
          setUserEmail(String(data.user.email));
        }
        setAuthUserId(data.user.id != null ? String(data.user.id) : "");
        setAuthDisplayName(String(data.user.displayName || "").trim());
        setCurrentPlan(normalizeCurrentPlan(data.user.currentPlan));
        setCurrentBillingCycle(
          String(data.user.currentBillingCycle || targetBillingCycle).trim().toLowerCase() === "yearly"
            ? "yearly"
            : "monthly"
        );
        setAccountPlanLabel(
          isAdminUser(data.user)
            ? "Admin"
            : formatPlanLabel(data.user.currentPlan, data.user.currentBillingCycle)
        );
      }

      revenueCatPlanSyncRef.current = syncKey;
      setRevenueCatState((prev) => ({
        ...prev,
        syncingPlan: false,
        message: `Synced RevenueCat access to the ${targetPlan.toUpperCase()} ${targetBillingCycle} plan.`
      }));
    } catch (error) {
      setRevenueCatState((prev) => ({
        ...prev,
        syncingPlan: false,
        error: error?.message || "Could not sync RevenueCat access with Zenin."
      }));
    }
  }, [currentBillingCycle, currentPlan, isGuestUser]);

  const refreshRevenueCatState = useCallback(async ({ keepMessage = false } = {}) => {
    if (accessCheckLoading || isGuestUser || !authUserId) {
      setRevenueCatState((prev) => ({
        ...prev,
        loading: false,
        syncingPlan: false,
        purchasing: false,
        paywallBusy: false,
        error: "",
        message: keepMessage ? prev.message : "",
        customerInfo: null,
        offerings: null,
        access: null
      }));
      return null;
    }

    setRevenueCatState((prev) => ({
      ...prev,
      loading: true,
      error: "",
      message: keepMessage ? prev.message : prev.message
    }));

    try {
      const nextState = await loadRevenueCatState({
        appUserId: authUserId,
        email: emailNotificationDestination || userEmail,
        displayName: authDisplayName
      });

      setRevenueCatState((prev) => ({
        ...prev,
        loading: false,
        customerInfo: nextState.customerInfo,
        offerings: nextState.offerings,
        access: nextState.access
      }));

      void syncRevenueCatPlanToAccount(nextState.access);
      return nextState;
    } catch (error) {
      setRevenueCatState((prev) => ({
        ...prev,
        loading: false,
        customerInfo: null,
        offerings: null,
        access: null,
        error: formatSubscriptionUserError(error)
      }));
      return null;
    }
  }, [
    accessCheckLoading,
    authDisplayName,
    authUserId,
    emailNotificationDestination,
    formatSubscriptionUserError,
    isGuestUser,
    syncRevenueCatPlanToAccount,
    userEmail
  ]);

  const handleRevenueCatPackagePurchase = useCallback(async (rcPackage) => {
    if (!rcPackage || isGuestUser || !authUserId) return;

    setRevenueCatState((prev) => ({
      ...prev,
      purchasing: true,
      error: "",
      message: ""
    }));

    try {
      const purchaseResult = await purchaseRevenueCatPackage({
        appUserId: authUserId,
        email: emailNotificationDestination || userEmail,
        displayName: authDisplayName,
        rcPackage,
        htmlTarget: revenueCatPaywallRef.current || undefined,
        metadata: {
          zenin_surface: "subscription_settings",
          zenin_package_id: String(rcPackage?.identifier || "")
        }
      });

      const snapshot = await refreshRevenueCatState({ keepMessage: true });
      setRevenueCatState((prev) => ({
        ...prev,
        purchasing: false,
        message: purchaseResult?.redemptionInfo
          ? "Purchase completed. Redemption details are available for this purchase."
          : snapshot?.access?.hasActiveSubscription
            ? "Purchase completed and subscription access was refreshed."
            : "Purchase completed."
      }));
    } catch (error) {
      setRevenueCatState((prev) => ({
        ...prev,
        purchasing: false,
        error: formatSubscriptionUserError(error, "We couldn't update your subscription right now. Please try again shortly.")
      }));
    }
  }, [
    authDisplayName,
    authUserId,
    emailNotificationDestination,
    formatSubscriptionUserError,
    isGuestUser,
    refreshRevenueCatState,
    userEmail
  ]);

  const handleShowRevenueCatPaywall = useCallback(async () => {
    if (isGuestUser || !authUserId) return;

    const currentOffering = revenueCatState.offerings?.current || null;
    if (!currentOffering || !currentOffering.availablePackages?.length) {
      setRevenueCatState((prev) => ({
        ...prev,
        error: "Subscription changes are temporarily unavailable right now. Please try again shortly."
      }));
      return;
    }

    setRevenueCatState((prev) => ({
      ...prev,
      paywallBusy: true,
      error: "",
      message: ""
    }));

    try {
      const purchaseResult = await presentRevenueCatPaywall({
        appUserId: authUserId,
        email: emailNotificationDestination || userEmail,
        displayName: authDisplayName,
        offering: currentOffering,
        htmlTarget: revenueCatPaywallRef.current || undefined,
        onVisitCustomerCenter: () => {
          if (revenueCatState.access?.managementURL) {
            window.open(revenueCatState.access.managementURL, "_blank", "noopener,noreferrer");
          }
        }
      });

      const snapshot = await refreshRevenueCatState({ keepMessage: true });
      setRevenueCatState((prev) => ({
        ...prev,
        paywallBusy: false,
        message: purchaseResult?.redemptionInfo
          ? "Paywall purchase completed. Redemption details are available for this purchase."
          : snapshot?.access?.hasActiveSubscription
            ? "Paywall purchase completed and subscription access was refreshed."
            : "Paywall closed."
      }));
    } catch (error) {
      setRevenueCatState((prev) => ({
        ...prev,
        paywallBusy: false,
        error: isRevenueCatCancelledError(error)
          ? "Billing window closed without changing your plan."
          : formatSubscriptionUserError(error, "We couldn't open subscription options right now. Please try again shortly.")
      }));
    }
  }, [
    authDisplayName,
    authUserId,
    emailNotificationDestination,
    formatSubscriptionUserError,
    isGuestUser,
    refreshRevenueCatState,
    revenueCatState.access,
    revenueCatState.offerings,
    userEmail
  ]);

  useEffect(() => {
    if (accessCheckLoading) return;
    if (isGuestUser || !authUserId) {
      revenueCatPlanSyncRef.current = "";
      setRevenueCatState((prev) => ({
        ...prev,
        loading: false,
        syncingPlan: false,
        purchasing: false,
        paywallBusy: false,
        customerInfo: null,
        offerings: null,
        access: null,
        error: "",
        message: ""
      }));
      return;
    }

    void refreshRevenueCatState();
  }, [accessCheckLoading, authUserId, isGuestUser, refreshRevenueCatState]);

  const revenueCatPackages = useMemo(
    () => revenueCatState.offerings?.current?.availablePackages || [],
    [revenueCatState.offerings]
  );

  const fetchTotpSetup = useCallback(async () => {
    if (isGuestUser) return;
    setTotpSetup(prev => ({ ...prev, loading: true }));
    try {
      const res = await zeninFetch("/auth/2fa/generate");
      const data = await res.json();
      if (res.ok && data.secret) {
        setTotpSetup({ secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl, loading: false });
      } else {
        setTotpSetup(prev => ({ ...prev, loading: false }));
      }
    } catch {
      setTotpSetup(prev => ({ ...prev, loading: false }));
    }
  }, [isGuestUser]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncPermissionState = () => {
      setBrowserNotificationPermission(getBrowserNotificationPermission());
    };
    syncPermissionState();
    window.addEventListener("focus", syncPermissionState);
    document.addEventListener("visibilitychange", syncPermissionState);
    return () => {
      window.removeEventListener("focus", syncPermissionState);
      document.removeEventListener("visibilitychange", syncPermissionState);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("zenin_preferences", JSON.stringify(preferences));
    if (!isGuestUser && settingsSyncReadyRef.current) {
      saveWorkspaceDoc("settings:preferences", preferences).catch((error) => {
        console.warn("Preference sync skipped.", error);
      });
    }
  }, [preferences, isGuestUser]);

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

  const collapseProfileSettingsPanels = () => {
    setExpandedSettingsPanels((prev) => ({
      ...prev,
      "profile-email": false,
      "profile-password": false,
      "profile-twofa": false
    }));
  };

  const handleSettingsCategorySelect = (category) => {
    setActiveSettingsCategory(category);
    if (category === "Profile") collapseProfileSettingsPanels();
    if (category === "Workspace") {
      void refreshWorkspacePanel();
    }
  };

  const venueOptions = accountForm.venueType === "cex"
    ? cexOptions
    : accountForm.venueType === "dex"
      ? dexOptions
      : accountForm.venueType === "prediction"
        ? predictionOptions
        : brokerOptions;
  const selectedProviderId = normalizeProviderId(accountForm.provider);
  const selectedProviderCanSync = SYNC_ENABLED_PROVIDERS.has(selectedProviderId);
  const selectedProviderIsHyperliquid = selectedProviderId === "hyperliquid";
  const apiKeyFieldLabel = selectedProviderIsHyperliquid ? "Wallet address" : "API Key / Account ID";
  const apiKeyPlaceholder = selectedProviderIsHyperliquid
    ? "Enter public wallet address"
    : "Enter read-only API key or account ID";
  const showApiSecretField = accountForm.venueType === "cex" && selectedProviderCanSync;
  const selectedProviderSyncLabel = selectedProviderCanSync ? "Live sync today" : "Save only";
  const selectedProviderSyncHelp = selectedProviderCanSync
    ? "Zenin can pull holdings, balances, and fills after you connect."
    : "Zenin will save this source now; live sync will arrive with a provider adapter.";

  const onboardingVenuePreview = useMemo(
    () =>
      Array.from(new Set([
        ...(cexOptions || []).slice(0, 2),
        ...(brokerOptions || []).slice(0, 2),
        ...(predictionOptions || []).slice(0, 1),
        ...(dexOptions || []).slice(0, 1)
      ].filter(Boolean))).slice(0, 6),
    [brokerOptions, cexOptions, dexOptions, predictionOptions]
  );

  const openConnectWindow = useCallback((mode = "manual") => {
    const onboardingProvider = (dexOptions || []).includes("Hyperliquid")
      ? "Hyperliquid"
      : (cexOptions[0] || "Binance");
    const onboardingVenueType = onboardingProvider === "Hyperliquid" ? "dex" : "cex";
    const provider = mode === "onboarding" ? onboardingProvider : (cexOptions[0] || "Binance");
    const venueType = mode === "onboarding" ? onboardingVenueType : "cex";
    setAccountForm({
      venueType,
      provider,
      username: getDefaultConnectionLabel(provider, venueType),
      apiKey: "",
      apiSecret: ""
    });
    setConnectAccountFeedback("");
    setConnectAccountSuccess(null);
    setConnectPromptMode(mode);
    setIsConnectWindowOpen(true);
  }, [cexOptions, dexOptions]);

  const refreshWorkspacePanel = useCallback(async () => {
    if (isGuestUser) return null;
    setWorkspaceBusy(true);
    setWorkspaceFeedback(null);
    try {
      const [workspaceRes, activityRes] = await Promise.all([
        zeninFetch("/workspaces/current"),
        zeninFetch("/workspaces/current/activity?limit=20")
      ]);
      const workspaceData = await workspaceRes.json().catch(() => ({}));
      const activityData = await activityRes.json().catch(() => ({}));
      if (!workspaceRes.ok) {
        throw new Error(workspaceData?.error || "Could not load workspace settings.");
      }
      setActiveWorkspace(workspaceData?.workspace || null);
      setWorkspaceMembers(Array.isArray(workspaceData?.members) ? workspaceData.members : []);
      setWorkspaceInvites(Array.isArray(workspaceData?.invites) ? workspaceData.invites : []);
      setWorkspaceActivity(Array.isArray(activityData?.items) ? activityData.items : []);
      setWorkspaceForm({
        name: String(workspaceData?.workspace?.name || "").trim(),
        slug: String(workspaceData?.workspace?.slug || "").trim()
      });
      return workspaceData;
    } catch (error) {
      setWorkspaceFeedback({ type: "error", text: error?.message || "Could not load workspace settings." });
      return null;
    } finally {
      setWorkspaceBusy(false);
    }
  }, [isGuestUser]);

  const saveWorkspaceSettings = useCallback(async () => {
    if (isGuestUser || !activeWorkspace) return;
    setWorkspaceBusy(true);
    setWorkspaceFeedback(null);
    try {
      const res = await zeninFetch("/workspaces/current", {
        method: "PATCH",
        body: JSON.stringify({
          name: workspaceForm.name.trim(),
          slug: workspaceForm.slug.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not update workspace.");
      }
      setActiveWorkspace(data?.workspace || activeWorkspace);
      setWorkspaceFeedback({ type: "success", text: "Workspace settings updated." });
      await refreshWorkspacePanel();
    } catch (error) {
      setWorkspaceFeedback({ type: "error", text: error?.message || "Could not update workspace." });
    } finally {
      setWorkspaceBusy(false);
    }
  }, [activeWorkspace, isGuestUser, refreshWorkspacePanel, workspaceForm.name, workspaceForm.slug]);

  const sendWorkspaceInvite = useCallback(async () => {
    if (isGuestUser || !activeWorkspace) return;
    setWorkspaceBusy(true);
    setWorkspaceFeedback(null);
    try {
      const res = await zeninFetch("/workspaces/current/invites", {
        method: "POST",
        body: JSON.stringify({
          email: workspaceInviteForm.email.trim(),
          role: workspaceInviteForm.role
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not create workspace invite.");
      }
      setWorkspaceInviteForm({ email: "", role: "member" });
      setWorkspaceFeedback({ type: "success", text: `Invite created for ${data?.invite?.email || "member"}.` });
      await refreshWorkspacePanel();
    } catch (error) {
      setWorkspaceFeedback({ type: "error", text: error?.message || "Could not create workspace invite." });
    } finally {
      setWorkspaceBusy(false);
    }
  }, [activeWorkspace, isGuestUser, refreshWorkspacePanel, workspaceInviteForm.email, workspaceInviteForm.role]);

  const updateWorkspaceMemberRole = useCallback(async (member, nextRole) => {
    if (!member?.userId) return;
    setWorkspaceBusy(true);
    setWorkspaceFeedback(null);
    try {
      const res = await zeninFetch(`/workspaces/current/members/${member.userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: nextRole })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not update workspace member role.");
      }
      setWorkspaceFeedback({ type: "success", text: `Updated ${member.email || member.displayName || "member"} to ${nextRole}.` });
      await refreshWorkspacePanel();
    } catch (error) {
      setWorkspaceFeedback({ type: "error", text: error?.message || "Could not update workspace member role." });
    } finally {
      setWorkspaceBusy(false);
    }
  }, [refreshWorkspacePanel]);

  const removeWorkspaceMember = useCallback(async (member) => {
    if (!member?.userId) return;
    setWorkspaceBusy(true);
    setWorkspaceFeedback(null);
    try {
      const res = await zeninFetch(`/workspaces/current/members/${member.userId}`, {
        method: "DELETE"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Could not remove workspace member.");
      }
      setWorkspaceFeedback({ type: "success", text: `Removed ${member.email || member.displayName || "member"} from the workspace.` });
      await refreshWorkspacePanel();
    } catch (error) {
      setWorkspaceFeedback({ type: "error", text: error?.message || "Could not remove workspace member." });
    } finally {
      setWorkspaceBusy(false);
    }
  }, [refreshWorkspacePanel]);

  useEffect(() => {
    if (accessCheckLoading || bootstrapLoading || isGuestUser || !authUserId || !connectedAccountsHydrated) return;
    if (connectedAccounts.length > 0) return;
    if (typeof sessionStorage === "undefined") {
      openConnectWindow("onboarding");
      return;
    }
    const sessionKey = getConnectPromptSessionKey(authUserId);
    if (sessionStorage.getItem(sessionKey) === "1") return;
    sessionStorage.setItem(sessionKey, "1");
    openConnectWindow("onboarding");
  }, [accessCheckLoading, authUserId, bootstrapLoading, connectedAccounts.length, connectedAccountsHydrated, isGuestUser, openConnectWindow]);

  const connectAccount = async () => {
    if (!accountForm.apiKey.trim()) return;
    const providerId = normalizeProviderId(accountForm.provider);
    const canSyncProvider = SYNC_ENABLED_PROVIDERS.has(providerId);
    const requiresSecret = accountForm.venueType === "cex" && canSyncProvider;
    if (requiresSecret && !accountForm.apiSecret.trim()) return;
    const connectionLabel = accountForm.username.trim() || getDefaultConnectionLabel(accountForm.provider, accountForm.venueType);

    setIsSyncingAccount(true);

    try {
      if (!isGuestUser) {
        const permissionScope = "read_only";
        const submittedApiSecret = showApiSecretField ? accountForm.apiSecret.trim() : "";
        const riskLevel = submittedApiSecret ? "sensitive" : "standard";
        // 1. Send the key to backend for encryption & storage
        const payload = {
          exchange: providerId,
          apiKey: accountForm.apiKey.trim(),
          apiSecret: submittedApiSecret,
          extraData: {
            username: connectionLabel,
            venueType: accountForm.venueType,
            providerLabel: accountForm.provider,
            ...(providerId === "hyperliquid" ? { address: accountForm.apiKey.trim() } : {})
          },
          permissionScope,
          canTrade: false,
          lastVerifiedScope: permissionScope,
          riskLevel
        };

        const res = await zeninFetch("/db/exchange-keys", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to add exchange key");
        }

        const addedKey = await res.json();

        let syncPayload = { syncAvailable: false, message: "Connection saved." };
        if (canSyncProvider) {
          const syncRes = await zeninFetch(`/db/exchange-sync/${addedKey.id}`, { method: "POST" });
          syncPayload = await syncRes.json().catch(() => ({}));
          if (!syncRes.ok) {
            throw new Error(syncPayload.error || "Failed to sync exchange data");
          }
        }

        // 3. Re-fetch workspace to update PortfolioContext
        await fetchWorkspace();
        
        // 4. Update the local UI state for connected accounts
        const nextAccount = {
          id: addedKey.id,
          venueType: accountForm.venueType,
          provider: accountForm.provider,
          username: connectionLabel,
          apiKeyMasked: addedKey.apiKey,
          permissionScope: addedKey.permissionScope || permissionScope,
          canTrade: false,
          lastVerifiedScope: addedKey.lastVerifiedScope || permissionScope,
          riskLevel: addedKey.riskLevel || riskLevel,
          syncAvailable: canSyncProvider,
          connectedAt: new Date().toISOString(),
          lastSyncAt: canSyncProvider ? new Date().toISOString() : null,
          lastSyncStatus: canSyncProvider ? "success" : "sync_unavailable",
          lastSyncMeta: canSyncProvider ? syncPayload : { reason: "Sync adapter is not available for this provider yet." }
        };
        const nextAccounts = [nextAccount, ...connectedAccounts];
        setConnectedAccounts(nextAccounts);
        void refreshWorkspacePanel();
        setConnectAccountSuccess({
          provider: accountForm.provider,
          label: connectionLabel,
          syncAvailable: canSyncProvider,
          holdingsCount: Number(syncPayload?.holdingsCount || 0),
          tradesCount: Number(syncPayload?.tradesCount || 0),
          message: canSyncProvider
            ? `Synced ${Number(syncPayload?.holdingsCount || 0)} holdings and ${Number(syncPayload?.tradesCount || 0)} fills.`
            : "Connection saved. Live sync is not available for this provider yet."
        });
      } else {
        // Guest user fallback (localStorage)
        const masked = `${accountForm.apiKey.trim().slice(0, 4)}••••${accountForm.apiKey.trim().slice(-4)}`;
        const nextAccount = {
          id: Date.now(),
          venueType: accountForm.venueType,
          provider: accountForm.provider,
          username: connectionLabel,
          apiKeyMasked: masked,
          permissionScope: "read_only",
          canTrade: false,
          lastVerifiedScope: "read_only",
          riskLevel: "standard",
          syncAvailable: canSyncProvider,
          connectedAt: new Date().toISOString(),
          lastSyncStatus: canSyncProvider ? "local_only" : "sync_unavailable"
        };
        const nextAccounts = [nextAccount, ...connectedAccounts];
        setConnectedAccounts(nextAccounts);
        setConnectAccountSuccess({
          provider: accountForm.provider,
          label: connectionLabel,
          syncAvailable: canSyncProvider,
          holdingsCount: 0,
          tradesCount: 0,
          message: canSyncProvider ? "Connection saved in this browser." : "Connection saved in this browser. Live sync requires a workspace session."
        });
      }
    } catch (error) {
      console.error("Connected account sync failed:", error);
      setConnectAccountFeedback(error.message || "Failed to connect and sync account.");
    } finally {
      setIsSyncingAccount(false);
    }
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

  const handleUpdatePlan = async (targetPlan, billingCycle = "monthly") => {
    try {
      const res = await zeninFetch(`${BACKEND_URL}/api/account/plan`, {
        method: "POST",
        body: JSON.stringify({ plan: targetPlan, billingCycle })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update plan");
      }
      const data = await res.json();
      setCurrentPlan(normalizeCurrentPlan(data.user.currentPlan));
      setCurrentBillingCycle(String(data.user.currentBillingCycle || billingCycle || "monthly").trim().toLowerCase() === "yearly" ? "yearly" : "monthly");
      setAccountPlanLabel(isAdminUser(data.user) ? "Admin" : formatPlanLabel(data.user.currentPlan, data.user.currentBillingCycle));
      setProfileFeedback((prev) => ({
        ...prev,
        plan: { type: "success", text: `Account updated to ${targetPlan} successfully.` }
      }));
    } catch (err) {
      setProfileFeedback((prev) => ({
        ...prev,
        plan: { type: "danger", text: err.message }
      }));
    }
  };

  const requestEmailChange = async () => {
    if (!isGuestUser) {
      setProfileMessage("email", "info", "Email changes are now managed in Supabase Auth and are temporarily unavailable in the in-app security panel.");
      return;
    }
    const nextEmail = profileForms.newEmail.trim().toLowerCase();
    const password = profileForms.emailPassword.trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);

    if (!emailValid) {
      setProfileMessage("email", "error", "Enter a valid email address.");
      return;
    }
    if (nextEmail === String(profileSecurity.email || "").toLowerCase()) {
      setProfileMessage("email", "error", "New email must be different from current email.");
      return;
    }

    if (!isGuestUser) {
      try {
        const res = await zeninFetch("/account/email/request", {
          method: "POST",
          body: JSON.stringify({ newEmail: nextEmail, currentPassword: password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Email change request failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || nextEmail));
        }
        setProfileForms((prev) => ({ ...prev, newEmail: "", emailPassword: "", emailVerificationCode: "" }));
        setProfileMessage(
          "email",
          "success",
          data?.devVerificationCode
            ? `Verification sent to ${nextEmail}. Dev code: ${data.devVerificationCode}`
            : `Verification sent to ${nextEmail}. Enter the code to confirm.`
        );
        return;
      } catch (error) {
        setProfileMessage("email", "error", error?.message || "Email change request failed.");
        return;
      }
    }

    const passwordCheck = verifyCurrentPassword(password);
    if (!passwordCheck.ok) {
      setProfileMessage("email", "error", passwordCheck.message);
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

  const verifyPendingEmail = async () => {
    if (!isGuestUser) {
      setProfileMessage("email", "info", "Email verification now happens through Supabase Auth.");
      return;
    }
    const pendingEmail = String(profileSecurity.pendingEmail || "").trim().toLowerCase();
    const typedCode = String(profileForms.emailVerificationCode || "").trim();
    if (!pendingEmail) {
      setProfileMessage("email", "error", "No pending email change to verify.");
      return;
    }
    if (!/^\d{6}$/.test(typedCode)) {
      setProfileMessage("email", "error", "Enter the 6-digit verification code.");
      return;
    }
    if (!isGuestUser) {
      try {
        const res = await zeninFetch("/account/email/confirm", {
          method: "POST",
          body: JSON.stringify({ verificationCode: typedCode })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Email confirmation failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          if (data.user.email) localStorage.setItem("zenin_email", data.user.email);
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email));
          setUserEmail(data.user.email);
        }
        setProfileForms((prev) => ({ ...prev, emailVerificationCode: "" }));
        setProfileMessage("email", "success", `Email updated to ${data?.user?.email || pendingEmail}.`);
        return;
      } catch (error) {
        setProfileMessage("email", "error", error?.message || "Email confirmation failed.");
        return;
      }
    }
    const expectedHash = String(profileSecurity.pendingEmailCodeHash || "").trim();
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

  const updatePassword = async () => {
    if (!isGuestUser) {
      setProfileMessage("password", "info", "Password updates are now managed through Supabase Auth. Use the reset flow from /auth.");
      return;
    }
    const currentPassword = profileForms.currentPassword.trim();
    const newPassword = profileForms.newPassword.trim();
    const confirmPassword = profileForms.confirmPassword.trim();

    if (!isGuestUser) {
      if (newPassword !== confirmPassword) {
        setProfileMessage("password", "error", "New password and confirmation do not match.");
        return;
      }
      try {
        const res = await zeninFetch("/account/password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Password update failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || userEmail));
        }
        setProfileForms((prev) => ({
          ...prev,
          currentPassword: "",
          newPassword: "",
          confirmPassword: ""
        }));
        setProfileMessage("password", "success", "Password updated successfully.");
        return;
      } catch (error) {
        setProfileMessage("password", "error", error?.message || "Password update failed.");
        return;
      }
    }

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

  const enableTwoFactor = async () => {
    if (!isGuestUser) {
      setProfileMessage("twofa", "info", "Advanced 2FA and passkey controls are temporarily disabled while Zenin finishes the Supabase Auth transition.");
      return;
    }
    const method = String(profileForms.twoFactorMethod || "authenticator");
    const code = profileForms.twoFactorCode.trim();
    if (method !== "passkey" && !/^\d{6}$/.test(code)) {
      setProfileMessage("twofa", "error", "Enter a valid 6-digit verification code.");
      return;
    }

    if (!isGuestUser) {
      const target = method === "sms"
        ? profileForms.phoneNumber.trim()
        : method === "email"
          ? profileForms.recoveryEmail.trim().toLowerCase()
          : "";
      const provider = method === "authenticator" ? profileForms.authenticatorService : method === "sms" ? "SMS OTP" : "Email OTP";
      const secret = method === "authenticator" ? (totpSetup.secret || "") : "";
      if (method === "authenticator" && !secret) {
        setProfileMessage("twofa", "error", "Generate a QR code first.");
        return;
      }
      try {
        const res = await zeninFetch("/auth/2fa/enable", {
          method: "POST",
          body: JSON.stringify({
            method,
            verificationCode: code,
            provider,
            target,
            secret
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "2FA enable failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || userEmail));
        }
        setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
        setProfileMessage("twofa", "success", `${provider} 2FA enabled.`);
        return;
      } catch (error) {
        setProfileMessage("twofa", "error", error?.message || "2FA enable failed.");
        return;
      }
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

  const registerPasskey = async () => {
    if (!isGuestUser) {
      setProfileMessage("twofa", "info", "Passkey enrollment is temporarily disabled in-app during the Supabase Auth transition.");
      return;
    }
    const passkeyName = profileForms.passkeyName.trim();
    if (passkeyName.length < 2) {
      setProfileMessage("twofa", "error", "Passkey name must be at least 2 characters.");
      return;
    }

    if (!isGuestUser) {
      try {
        // Step 1: Get registration options from the server
        const optionsRes = await zeninFetch("/auth/passkeys/register/generate-options");
        const options = await optionsRes.json();
        if (!optionsRes.ok) throw new Error(options?.error || "Failed to get registration options.");

        // Step 2: Start the WebAuthn registration ceremony in the browser
        const startRegistration = await getStartRegistration();
        const attResp = await startRegistration(options);

        // Step 3: Send the result back to the server for verification
        const verifyRes = await zeninFetch("/auth/passkeys/register/verify", {
          method: "POST",
          body: JSON.stringify({
            response: attResp,
            name: passkeyName,
            provider: profileForms.passkeyProvider
          })
        });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok) throw new Error(verifyData?.error || "Passkey verification failed.");

        if (verifyData?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(verifyData.user));
          setProfileSecurity(profileSecurityFromUser(verifyData.user, verifyData.user.email || userEmail));
        }
        setProfileForms((prev) => ({ ...prev, passkeyName: "Primary Device" }));
        setProfileMessage("twofa", "success", `Passkey "${passkeyName}" registered.`);
        return;
      } catch (error) {
        const msg = error?.name === "NotAllowedError" ? "Passkey registration was cancelled." : (error?.message || "Passkey registration failed.");
        setProfileMessage("twofa", "error", msg);
        return;
      }
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

  const regenerateBackupCodes = async () => {
    if (!isGuestUser) {
      setProfileMessage("twofa", "info", "Backup code management is temporarily disabled in-app during the Supabase Auth transition.");
      return;
    }
    if (!profileSecurity.twoFactorEnabled) {
      setProfileMessage("twofa", "error", "Enable 2FA before generating backup codes.");
      return;
    }
    if (!profileSecurity.twoFactorMethod) {
      setProfileMessage("twofa", "error", "Select and enable a 2FA method first.");
      return;
    }
    if (!isGuestUser) {
      try {
        const res = await zeninFetch("/auth/2fa/backup-codes/regenerate", {
          method: "POST",
          body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Backup code regeneration failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || userEmail));
        }
        setProfileMessage("twofa", "success", "Backup codes regenerated.");
        return;
      } catch (error) {
        setProfileMessage("twofa", "error", error?.message || "Backup code regeneration failed.");
        return;
      }
    }
    setProfileSecurity((prev) => ({ ...prev, backupCodes: createBackupCodes() }));
    setProfileMessage("twofa", "success", "Backup codes regenerated.");
  };

  const disableTwoFactor = async () => {
    if (!isGuestUser) {
      setProfileMessage("twofa", "info", "2FA disable is temporarily managed outside the app while Supabase Auth is rolling out.");
      return;
    }
    if (!isGuestUser) {
      try {
        const res = await zeninFetch("/auth/2fa/disable", {
          method: "POST",
          body: JSON.stringify({})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "2FA disable failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || userEmail));
        }
        setProfileMessage("twofa", "info", "2FA disabled for this workspace profile.");
        return;
      } catch (error) {
        setProfileMessage("twofa", "error", error?.message || "2FA disable failed.");
        return;
      }
    }
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

  const settingsPreviewNote = "Workspace sync: profile, preferences, and connected-account metadata still save to your Zenin workspace. Password, email, and MFA flows are moving to Supabase Auth.";

  const sidebarIconMap = {
    Home: HomeIcon,
    Portfolio: PortfolioIcon,
    Watchlist: WatchlistIcon,
    Analytics: AnalyticsIcon,
    Metrics: MetricsIcon,
    Options: OptionsIcon,
    Predictions: PredictionsIcon,
    Journal: JournalIcon,
    "Tax Estimator": TaxIcon
  };

  const sectionIcon = (section) => {
    const Icon = sidebarIconMap[section] || JournalIcon;
    return <Icon />;
  };

  const isSidebarVisuallyCollapsed = isSidebarCollapsed;
  const usesWorkspaceShell = routeState.type !== "company";
  const shouldShowConnectNudge = !isGuestUser && connectedAccountsHydrated && connectedAccounts.length === 0;
  const renderConnectNudge = (surface = "home") => {
    if (!shouldShowConnectNudge) return null;
    return (
      <section className={`connect-empty-state ${surface === "portfolio" ? "portfolio" : "home"}`}>
        <div>
          <span>{surface === "portfolio" ? "Portfolio setup" : "First account"}</span>
          <h3>Connect a read-only source</h3>
          <p>Start with Hyperliquid watch-only or add read-only exchange credentials. You can skip this and return here anytime.</p>
        </div>
        <div className="connect-empty-actions">
          <button type="button" className="settings-primary-btn" onClick={() => openConnectWindow("onboarding")}>
            Connect account
          </button>
          {surface !== "portfolio" ? (
            <button type="button" className="settings-secondary-btn" onClick={() => setActiveSection("Portfolio")}>
              Open Portfolio
            </button>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <div className={`app-layout ${isSidebarVisuallyCollapsed ? "sidebar-is-collapsed" : ""} ${usesWorkspaceShell ? "app-layout-home" : ""}`}>
      {isSidebarVisuallyCollapsed && typeof window !== 'undefined' && window.innerWidth <= 960 && (
        <button
          className="mobile-hamburger-btn"
          onClick={() => setIsSidebarCollapsed(false)}
          aria-label="Open Menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      <aside className={`sidebar premium-operator-console sidebar-overhaul-v2 ${isSidebarVisuallyCollapsed ? "collapsed" : ""}`}>
        <header className="sidebar-header sidebar-brand-row">
          {!isSidebarVisuallyCollapsed ? (
            <div className="sidebar-console-topbar">
              <strong>ZENIN</strong>
              <span className="sidebar-console-live"><i /> Live</span>
              <span className="sidebar-console-market">{activeWorkspace?.name || "Workspace"}</span>
              {activeWorkspace?.seatLimit ? (
                <span className="sidebar-console-market">{`${activeWorkspace.seatCount || 0}/${activeWorkspace.seatLimit} seats`}</span>
              ) : null}
              <span className="sidebar-console-plan">{accountPlanLabel}</span>
              <button
                className="sidebar-toggle-btn mobile-close-btn"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                ‹
              </button>
            </div>
          ) : (
            <div className="sidebar-collapsed-brand">
              <button
                className="sidebar-collapsed-mark"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label="Expand sidebar"
                title="Expand sidebar"
              >
                <ZeninLogo size="sm" showText={false} />
              </button>
            </div>
          )}
        </header>

        <nav className="sidebar-nav" aria-label="Workspace navigation">
          {sidebarNavigationGroups.map((group) => (
            <div key={group.label} className="sidebar-nav-group">
              {!isSidebarVisuallyCollapsed ? (
                <div className="sidebar-section-header">{group.label}</div>
              ) : null}
              <div className="sidebar-nav-stack">
                {group.items.map(({ section, meta }, itemIndex) => {
                  const isActiveSection = activeSection === section;
                  const navCode = `${group.label.slice(0, 1).toUpperCase()}${String(itemIndex + 1).padStart(2, "0")}`;

                  return (
                    <button
                      key={section}
                      className={`nav-btn ${isActiveSection ? "active" : ""}`}
                      onClick={() => {
                        if (!accessibleSections.includes(section)) return;
                        if (routeState.type === "company") navigateToAppRoute();
                        setActiveSection(section);
                      }}
                      title={section}
                      aria-current={isActiveSection ? "page" : undefined}
                    >
                      {!isSidebarVisuallyCollapsed ? (
                        <span className="nav-code" aria-hidden="true">{navCode}</span>
                      ) : null}
                      <span className="nav-icon-wrap">
                        <span className="nav-icon">{sectionIcon(section)}</span>
                      </span>
                      <span className="nav-copy">
                        <span className="nav-label-row">
                          <span className="nav-full">{section}</span>
                          {section === "Watchlist" && watchlistAssets.length > 0 && (
                            <span className="nav-badge">{watchlistAssets.length}</span>
                          )}
                        </span>
                        {isActiveSection && !isSidebarVisuallyCollapsed ? (
                          <span className="nav-description">{meta.description}</span>
                        ) : null}
                      </span>
                      {isActiveSection && !isSidebarVisuallyCollapsed ? (
                        <span className="nav-kicker">{meta.eyebrow}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div
          className={`sidebar-live-status ${liveStreamStatus}`}
          title={lastLivePriceAt ? `Last price tick ${new Date(lastLivePriceAt).toLocaleTimeString()}` : "Live prices connect when assets are tracked"}
        >
          {!isSidebarVisuallyCollapsed ? (
            <>
              <span className="sidebar-live-title">Live Status</span>
              <span className="sidebar-live-row primary">
                <span><span className="sidebar-live-dot" aria-hidden="true" />Market {liveStreamStatus === "idle" ? "Idle" : "Open"}</span>
                <strong>{lastLivePriceAt ? new Date(lastLivePriceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Now"}</strong>
              </span>
              <span className="sidebar-live-row">
                <span>Tracked</span>
                <strong>{watchlistAssets.length}</strong>
              </span>
              <span className="sidebar-live-row">
                <span>Feed</span>
                <strong>
                  {liveStreamStatus === "connected"
                    ? "Live"
                    : liveStreamStatus === "degraded"
                      ? "Fallback"
                      : "Idle"}
                </strong>
              </span>
            </>
          ) : (
            <>
              <span className="sidebar-live-rail" aria-hidden="true">
                <span className="sidebar-live-dot" />
                <span className="sidebar-live-mini-icon">
                  <LiveRailIcon />
                </span>
              </span>
              <span className="sidebar-live-label">Live status</span>
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          {!isSidebarVisuallyCollapsed ? <div className="sidebar-section-header">Control Bay</div> : null}
          <button
            className="sidebar-theme-row sidebar-utility-row"
            onClick={toggleTheme}
            title={`Theme: ${themeMode === "dark" ? "Dark mode" : "Light mode"}`}
            aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`}
          >
            <span className="sidebar-utility-left">
              <span className="sidebar-theme-icon" aria-hidden="true">
                {themeMode === "dark" ? <ThemeDarkIcon /> : <ThemeLightIcon />}
              </span>
              <span className="sidebar-utility-copy">
                <span className="sidebar-theme-label">Theme</span>
              </span>
            </span>
            <div className="sidebar-theme-right">
              <span className="sidebar-theme-chip">{themeMode === "dark" ? "Dark" : "Light"}</span>
              <span className="sidebar-theme-arrow">›</span>
            </div>
          </button>

          <button
            className="sidebar-footer sidebar-utility-row sidebar-account-row settings-launcher"
            onClick={() => setIsSettingsOpen(true)}
            title="Open settings"
          >
            <div className="user-icon" aria-hidden="true">
              <AccountIcon />
            </div>
            <div className="sidebar-account-meta">
              <span className="sidebar-theme-label">Account</span>
              {!isSidebarVisuallyCollapsed && (
                <span className="sidebar-account-chevron">›</span>
              )}
            </div>
          </button>

          <button
            className="sidebar-theme-row sidebar-utility-row sidebar-logout-row"
            onClick={handleLogout}
            title="Sign out"
            aria-label="Sign out"
          >
            <span className="sidebar-utility-left">
              <span className="sidebar-theme-icon" aria-hidden="true"><LogoutIcon /></span>
              <span className="sidebar-utility-copy">
                <span className="sidebar-theme-label">Logout</span>
              </span>
            </span>
            {!isSidebarVisuallyCollapsed ? <span className="sidebar-theme-arrow">›</span> : null}
          </button>
        </div>

      </aside>

      <main className={`main-content ${usesWorkspaceShell ? "main-content-home" : ""}`}>
        {routeState.type === "company" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CompanyProfilePage
                symbol={routeState.symbol}
                asset={routedCompanyAsset}
                onBack={navigateToAppRoute}
              />
            </Suspense>
          </div>
        ) : (
          <GenericErrorBoundary>
            <Suspense fallback={moduleLoadingFallback}>
        {activeSection === "Home" && (
          <>
            {renderConnectNudge("home")}
            <HomeModule
              portfolio={portfolioWithEntry}
              trades={trades}
              assets={assets}
              marketMovers={homeMarketMovers}
              macroData={homeMacroData}
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
              onViewFullMetrics={() => {
                if (routeState.type === "company") navigateToAppRoute();
                setActiveSection("Metrics");
              }}
              onOpenWatchlist={() => {
                if (routeState.type === "company") navigateToAppRoute();
                setActiveSection("Watchlist");
              }}
              onOpenAnalytics={() => {
                if (routeState.type === "company") navigateToAppRoute();
                setActiveSection("Analytics");
              }}
            />
          </>
        )}
        {activeSection === "Metrics" && (
          <div className="view-container">
            <FullMetricsPage 
              onBack={() => setActiveSection("Home")} 
              themeMode={themeMode} 
              toggleTheme={toggleTheme} 
              portfolio={portfolioWithEntry}
              trades={trades}
              activeOptionsTrades={activeOptionsTrades}
              accountMetrics={accountMetrics}
              assets={assets}
              spotPrices={spotPrices}
              multiChainCache={multiChainCache}
            />
          </div>
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
                              <div className="search-result-type">
                                {asset.type?.toUpperCase()} · {inferAssetCurrency(asset)}
                              </div>
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
              liveStatus={liveStreamStatus}
              lastLivePriceAt={lastLivePriceAt}
            />
          </div>
        )}

        {activeSection === "Portfolio" && (
          <div className="view-container portfolio-shell-view">
            {renderConnectNudge("portfolio")}
            <PortfolioModule
                portfolio={portfolioWithEntry}
                trades={trades}
                balance={balance}
                accountMetrics={accountMetrics}
                calculatePortfolioValue={calculatePortfolioValue}
                calculatePortfolioGain={calculatePortfolioGain}
                activeOptionsTrades={activeOptionsTrades}
                setActiveOptionsTrades={setActiveOptionsTrades}
                tradeFeeSummary={tradeFeeSummary}
                multiChainCache={multiChainCache}
                spotPrices={spotPrices}
                isSignedIn={hasAuthToken()}
                onEstimateRebalance={estimatePortfolioRebalance}
                onExecuteRebalance={executePortfolioRebalance}
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
                onOpenPredictions={() => {
                  if (routeState.type === "company") navigateToAppRoute();
                  setActiveSection("Predictions");
                }}
                onOpenJournal={() => {
                  if (routeState.type === "company") navigateToAppRoute();
                  setActiveSection("Journal");
                }}
                onOpenConnections={() => openConnectWindow("manual")}
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
          <TaxEstimator trades={trades} portfolio={portfolioWithEntry} spotPrices={spotPrices} />
        )}
            </Suspense>
          </GenericErrorBoundary>
        )}
      </main>

      {selectedAsset && (
        <Suspense fallback={null}>
          {normalizeAssetType(selectedAsset) === "indicator" ? (
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
              cashBalances={cashBalances}
              trades={trades}
              spotPrices={spotPrices}
            />
          )}
        </Suspense>
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
              <div className="settings-title-block">
                <span>CONTROL BAY</span>
                <h2>Workspace Settings</h2>
                <p>Profile, security, billing, data, and workstation controls.</p>
              </div>
              <div className="settings-header-status">
                <span className="settings-live-dot" aria-hidden="true" />
                <strong>Live</strong>
                <em>{accountPlanLabel}</em>
                <button className="close-btn" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings">&times;</button>
              </div>
            </div>

            <div className="settings-window-body">
              <aside className="settings-categories">
                <div className="settings-nav-kicker">Settings Index</div>
                {settingsCategories.map((category) => (
                  <button
                    key={category}
                    className={`settings-category-btn ${activeSettingsCategory === category ? "active" : ""}`}
                    onClick={() => handleSettingsCategorySelect(category)}
                  >
                    {category}
                  </button>
                ))}
              </aside>

              <section className="settings-content">
                {activeSettingsCategory === "Profile" && (
                  <>
                    <div className="settings-preview-note">{settingsPreviewNote}</div>
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
                                  {authenticatorOptions.map((service) => (
                                    <option key={service} value={service}>{service}</option>
                                  ))}
                                </select>
                              </label>
                              <p className="settings-meta">Scan QR in your app, then enter the 6-digit code below.</p>
                              {!isGuestUser && !totpSetup.secret && !totpSetup.loading ? (
                                <button className="settings-secondary-btn" style={{ margin: "12px 0" }} onClick={fetchTotpSetup}>Generate QR Code</button>
                              ) : null}
                              {totpSetup.loading ? (
                                <p className="settings-meta" style={{ margin: "12px 0" }}>Generating...</p>
                              ) : null}
                              {totpSetup.qrCodeDataUrl && totpSetup.secret ? (
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px", margin: "16px 0" }}>
                                  <div style={{ background: "#fff", padding: "12px", borderRadius: "3px", display: "inline-block" }}>
                                    <img src={totpSetup.qrCodeDataUrl} alt="TOTP QR Code" width="160" height="160" style={{ display: "block" }} />
                                  </div>
                                  <div>
                                    <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Secret Key</span>
                                    <p style={{ fontFamily: "monospace", fontSize: "1.05rem", color: "var(--text)", margin: "4px 0 0 0", letterSpacing: "1px", wordBreak: "break-all" }}>{totpSetup.secret}</p>
                                  </div>
                                </div>
                              ) : null}
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
                                  {passkeyOptions.map((provider) => (
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

                {activeSettingsCategory === "Subscription" && (
                  <div className="settings-panel">
                    <button className="settings-panel-header" onClick={() => toggleSettingsPanel("subscription-plan")}>
                      <span>My Plan</span>
                      <span>{expandedSettingsPanels["subscription-plan"] ? "−" : "+"}</span>
                    </button>
                    {expandedSettingsPanels["subscription-plan"] && (
                      <div className="settings-panel-body">
                        <div className="settings-chip-row">
                          <span className="settings-chip success">Current: {accountPlanLabel}</span>
                          <span className="settings-chip">
                            {revenueCatState.access?.hasActiveSubscription ? "Subscription active" : "No active paid subscription"}
                          </span>
                        </div>
                        <p className="settings-meta" style={{ marginTop: "10px" }}>
                          Check your current plan, change plans when options are available, and manage billing from one place.
                        </p>

                        {isGuestUser ? (
                          <p className="settings-status info">Sign in to view your subscription, change plans, and manage billing.</p>
                        ) : null}

                        {!isGuestUser ? (
                          <>
                            <div className="settings-inline-actions" style={{ marginTop: "14px" }}>
                              <button
                                className="settings-secondary-btn"
                                onClick={() => {
                                  void refreshRevenueCatState();
                                }}
                                disabled={revenueCatState.loading || revenueCatState.purchasing || revenueCatState.paywallBusy}
                              >
                                {revenueCatState.loading ? "Refreshing..." : "Refresh Subscription"}
                              </button>
                              <button
                                className="settings-secondary-btn"
                                onClick={() => {
                                  void handleShowRevenueCatPaywall();
                                }}
                                disabled={
                                  revenueCatState.loading ||
                                  revenueCatState.purchasing ||
                                  revenueCatState.paywallBusy ||
                                  revenueCatPackages.length === 0
                                }
                              >
                                {revenueCatState.paywallBusy ? "Opening Billing..." : "Change Plan"}
                              </button>
                              <button
                                className="settings-secondary-btn"
                                onClick={() => {
                                  if (revenueCatState.access?.managementURL) {
                                    window.open(revenueCatState.access.managementURL, "_blank", "noopener,noreferrer");
                                  }
                                }}
                                disabled={!revenueCatState.access?.managementURL}
                              >
                                Manage Subscription
                              </button>
                            </div>

                            <div
                              style={{
                                marginTop: "16px",
                                padding: "14px",
                                border: "1px solid rgba(255,255,255,0.08)",
                                borderRadius: "3px",
                                background: "var(--color-surface-card)"
                              }}
                            >
                              <p className="settings-meta" style={{ marginTop: 0 }}>
                                Subscription status
                              </p>
                              <p style={{ margin: "6px 0 0", fontWeight: 600 }}>
                                {revenueCatState.access?.hasActiveSubscription
                                  ? `${String(currentPlan || "starter").toUpperCase()} plan`
                                  : "Starter plan"}
                              </p>
                              <p className="settings-meta" style={{ marginTop: "10px" }}>
                                Billing cycle: {currentBillingCycle.toUpperCase()}
                              </p>
                              <p className="settings-meta" style={{ marginTop: "10px" }}>
                                {revenueCatState.access?.managementURL
                                  ? "Use Manage Subscription to open your billing portal."
                                  : "A billing portal link will appear here when it is available for your subscription."}
                              </p>
                            </div>

                            {revenueCatPackages.length ? (
                              <div style={{ marginTop: "18px" }}>
                                <p className="settings-meta" style={{ marginTop: 0 }}>
                                  Available plans
                                </p>
                                <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
                                  {revenueCatPackages.map((pkg) => (
                                    <div
                                      key={pkg.identifier}
                                      style={{
                                        padding: "14px",
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        borderRadius: "3px",
                                        background: "var(--color-surface-card)"
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                                        <div>
                                          <strong>{pkg.webBillingProduct.title || pkg.identifier}</strong>
                                          <p className="settings-meta" style={{ marginTop: "6px" }}>
                                            {pkg.webBillingProduct.description || "Review this subscription option and choose it if it matches the access you need."}
                                          </p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                          <strong>{pkg.webBillingProduct.currentPrice.formattedPrice}</strong>
                                        </div>
                                      </div>
                                      <div className="settings-inline-actions" style={{ marginTop: "12px" }}>
                                        <button
                                          className="settings-secondary-btn"
                                          onClick={() => {
                                            void handleRevenueCatPackagePurchase(pkg);
                                          }}
                                          disabled={revenueCatState.loading || revenueCatState.purchasing || revenueCatState.paywallBusy}
                                        >
                                          {revenueCatState.purchasing ? "Opening Checkout..." : "Choose Plan"}
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div
                                style={{
                                  marginTop: "18px",
                                  padding: "14px",
                                  border: "1px dashed rgba(255,255,255,0.14)",
                                  borderRadius: "3px"
                                }}
                              >
                                <p style={{ margin: 0, fontWeight: 600 }}>Subscription options are not available right now</p>
                                <p className="settings-meta" style={{ marginTop: "8px" }}>
                                  Please try again shortly. If this keeps happening, contact support and we’ll help you change your plan.
                                </p>
                              </div>
                            )}

                            <div
                              ref={revenueCatPaywallRef}
                              id="zenin-revenuecat-paywall"
                              style={{ marginTop: "18px", minHeight: revenueCatState.paywallBusy ? "320px" : "0px" }}
                            />

                            {revenueCatState.error ? (
                              <p className="settings-status error">{revenueCatState.error}</p>
                            ) : null}
                            {revenueCatState.message ? (
                              <p className="settings-status success">{revenueCatState.message}</p>
                            ) : null}
                            {revenueCatState.syncingPlan ? (
                              <p className="settings-status info">Syncing purchased access back into your Zenin account...</p>
                            ) : null}
                            <p className="settings-meta" style={{ marginTop: "12px" }}>
                              Use Change Plan to review upgrades or downgrades, and use Manage Subscription for billing self-service after purchase.
                            </p>
                          </>
                        ) : null}

                        {isAdmin && import.meta.env.DEV && (
                          <div style={{ marginTop: "20px", padding: "12px", border: "1px dashed rgba(255,255,255,0.2)", borderRadius: "3px" }}>
                            <h4 style={{ margin: "0 0 10px 0", color: "#f87171" }}>Developer Plan Simulator</h4>
                            <label className="settings-field">
                              <span>Simulate Plan Tier</span>
                              <select 
                                value={simulatePlan} 
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSimulatePlan(val);
                                  if (val) {
                                    localStorage.setItem("zenin_simulate_plan", val);
                                  } else {
                                    localStorage.removeItem("zenin_simulate_plan");
                                  }
                                  window.location.reload();
                                }}
                              >
                                <option value="">Real Plan (No simulation)</option>
                                <option value="starter">Starter</option>
                                <option value="pro">Pro</option>
                                <option value="desk">Desk</option>
                              </select>
                            </label>
                            <p className="settings-meta" style={{ marginTop: "8px" }}>
                              Selecting a tier above will reload the app and override your tier in backend requests.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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

                {activeSettingsCategory === "Workspace" && (
                  <>
                    <div className="settings-preview-note">
                      Desk workspaces turn Zenin into a shared operating surface: members, seats, shared account ingestion, and recent desk activity all live here.
                    </div>
                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("workspace-overview")}>
                        <span>Workspace Overview</span>
                        <span>{expandedSettingsPanels["workspace-overview"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["workspace-overview"] && (
                        <div className="settings-panel-body">
                          {activeWorkspace ? (
                            <>
                              <div className="settings-chip-row">
                                <span className="settings-chip success">{activeWorkspace.plan?.toUpperCase()} desk</span>
                                <span className="settings-chip">{`${activeWorkspace.seatCount || 0}/${activeWorkspace.seatLimit || 1} seats used`}</span>
                                <span className="settings-chip">{`Role: ${activeWorkspace.membership?.role || "member"}`}</span>
                              </div>
                              <label className="settings-field" style={{ marginTop: "14px" }}>
                                <span>Workspace Name</span>
                                <input
                                  value={workspaceForm.name}
                                  onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, name: e.target.value }))}
                                  placeholder="Zenin Desk"
                                />
                              </label>
                              <label className="settings-field">
                                <span>Workspace Slug</span>
                                <input
                                  value={workspaceForm.slug}
                                  onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, slug: e.target.value }))}
                                  placeholder="zenin-desk"
                                />
                              </label>
                              <div className="settings-inline-actions" style={{ marginTop: "12px" }}>
                                <button
                                  className="settings-primary-btn"
                                  onClick={() => { void saveWorkspaceSettings(); }}
                                  disabled={workspaceBusy || !["owner", "admin"].includes(String(activeWorkspace?.membership?.role || "").toLowerCase())}
                                >
                                  {workspaceBusy ? "Saving..." : "Save Workspace"}
                                </button>
                                <button
                                  className="settings-secondary-btn"
                                  onClick={() => { void refreshWorkspacePanel(); }}
                                  disabled={workspaceBusy}
                                >
                                  Refresh
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="settings-meta">Workspace metadata will appear here after the signed-in desk loads.</p>
                          )}
                          {workspaceFeedback ? (
                            <p className={`settings-status ${workspaceFeedback.type === "error" ? "error" : "success"}`}>{workspaceFeedback.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("workspace-team")}>
                        <span>Members & Invites</span>
                        <span>{expandedSettingsPanels["workspace-team"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["workspace-team"] && (
                        <div className="settings-panel-body">
                          {workspaceMembers.length ? (
                            <div className="connected-accounts-list">
                              {workspaceMembers.map((member) => (
                                <div key={member.userId} className="connected-account-item">
                                  <div>
                                    <strong>{member.displayName || member.email || `User ${member.userId}`}</strong>
                                    <p>{member.email} • {member.role}</p>
                                  </div>
                                  {["owner", "admin"].includes(String(activeWorkspace?.membership?.role || "").toLowerCase()) && member.role !== "owner" ? (
                                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                      <select
                                        value={member.role}
                                        onChange={(e) => { void updateWorkspaceMemberRole(member, e.target.value); }}
                                        disabled={workspaceBusy}
                                      >
                                        <option value="member">Member</option>
                                        <option value="admin">Admin</option>
                                      </select>
                                      <button className="settings-secondary-btn" onClick={() => { void removeWorkspaceMember(member); }} disabled={workspaceBusy}>
                                        Remove
                                      </button>
                                    </div>
                                  ) : (
                                    <span>{member.role}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="settings-meta">No workspace members yet.</p>
                          )}

                          {["owner", "admin"].includes(String(activeWorkspace?.membership?.role || "").toLowerCase()) ? (
                            <>
                              <div className="settings-inline-actions" style={{ marginTop: "14px", alignItems: "flex-end" }}>
                                <label className="settings-field" style={{ flex: 1 }}>
                                  <span>Invite Email</span>
                                  <input
                                    value={workspaceInviteForm.email}
                                    onChange={(e) => setWorkspaceInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                                    placeholder="teammate@zenin.app"
                                  />
                                </label>
                                <label className="settings-field" style={{ width: "140px" }}>
                                  <span>Role</span>
                                  <select
                                    value={workspaceInviteForm.role}
                                    onChange={(e) => setWorkspaceInviteForm((prev) => ({ ...prev, role: e.target.value }))}
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </label>
                                <button className="settings-primary-btn" onClick={() => { void sendWorkspaceInvite(); }} disabled={workspaceBusy}>
                                  Invite
                                </button>
                              </div>
                              {workspaceInvites.length ? (
                                <div className="connected-accounts-list" style={{ marginTop: "14px" }}>
                                  {workspaceInvites.map((invite) => (
                                    <div key={invite.id} className="connected-account-item">
                                      <div>
                                        <strong>{invite.email}</strong>
                                        <p>{invite.role} • {invite.status}</p>
                                      </div>
                                      <span>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "No expiry"}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="settings-panel">
                      <button className="settings-panel-header" onClick={() => toggleSettingsPanel("workspace-activity")}>
                        <span>Desk Activity</span>
                        <span>{expandedSettingsPanels["workspace-activity"] ? "−" : "+"}</span>
                      </button>
                      {expandedSettingsPanels["workspace-activity"] && (
                        <div className="settings-panel-body">
                          {workspaceActivity.length ? (
                            <div className="connected-accounts-list">
                              {workspaceActivity.map((entry) => (
                                <div key={entry.id} className="connected-account-item">
                                  <div>
                                    <strong>{entry.eventType.replace(/_/g, " ")}</strong>
                                    <p>{entry.actorDisplayName || entry.actorEmail || "Workspace member"}</p>
                                  </div>
                                  <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Just now"}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="settings-meta">No desk activity has been recorded yet.</p>
                          )}
                        </div>
                      )}
                    </div>

                    <WorkspaceInstitutionalControlPanel activeWorkspace={activeWorkspace} />
                  </>
                )}

                {activeSettingsCategory === "Accounts" && (
                  <>
                    <div className="settings-preview-note">{settingsPreviewNote}</div>
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
                                    <p>
                                      {acc.username} • {acc.venueType.toUpperCase()}
                                      {acc.lastSyncStatus ? ` • ${String(acc.lastSyncStatus).toUpperCase()}` : ""}
                                      {acc.permissionScope ? ` • ${String(acc.permissionScope).replace(/_/g, " ").toUpperCase()}` : ""}
                                      {acc.riskLevel ? ` • ${String(acc.riskLevel).toUpperCase()}` : ""}
                                    </p>
                                  </div>
                                  <span>{acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString() : acc.apiKeyMasked}</span>
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
                            checked={effectiveEmailNotificationsEnabled}
                            disabled={!canUseEmailNotifications}
                            onChange={(e) => {
                              void handleNotificationPreferenceToggle("notifyEmail", e.target.checked);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Browser notifications</span>
                          <input
                            type="checkbox"
                            checked={effectiveBrowserNotificationsEnabled}
                            disabled={!browserNotificationsSupported || browserNotificationsBlocked}
                            onChange={(e) => {
                              void handleNotificationPreferenceToggle("notifyBrowser", e.target.checked);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Price alerts</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyPriceAlerts}
                            onChange={(e) => {
                              void handleNotificationPreferenceToggle("notifyPriceAlerts", e.target.checked);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Order updates</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyOrderEvents}
                            onChange={(e) => {
                              void handleNotificationPreferenceToggle("notifyOrderEvents", e.target.checked);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Market news digests</span>
                          <input
                            type="checkbox"
                            checked={preferences.notifyNews}
                            onChange={(e) => {
                              void handleNotificationPreferenceToggle("notifyNews", e.target.checked);
                            }}
                          />
                        </label>
                        <p className="settings-meta" style={{ marginTop: "12px" }}>
                          Email destination: {isGuestUser
                            ? "Sign in required"
                            : emailNotificationDestination || "Add a profile email"}
                          {!isGuestUser && profileSecurity?.emailVerified === false ? " · Verification required" : ""}
                        </p>
                        <p className="settings-meta">
                          Browser permission: {browserNotificationStatusLabel}
                          {!browserNotificationsSupported ? " · Not supported in this browser" : ""}
                        </p>
                        <div className="settings-inline-actions" style={{ marginTop: "12px" }}>
                          <button
                            className="settings-secondary-btn"
                            onClick={() => {
                              void handleNotificationPreferenceToggle("notifyBrowser", true);
                            }}
                            disabled={!browserNotificationsSupported || browserNotificationsGranted || browserNotificationsBlocked}
                          >
                            {browserNotificationsGranted ? "Browser Ready" : "Enable Browser Alerts"}
                          </button>
                          <button
                            className="settings-secondary-btn"
                            onClick={() => {
                              void sendTestBrowserNotification();
                            }}
                            disabled={!effectiveBrowserNotificationsEnabled || !browserNotificationsGranted}
                          >
                            Send Test Notification
                          </button>
                        </div>
                        {notificationFeedback?.text ? (
                          <p className={`settings-status ${notificationFeedback.type === "error" ? "error" : notificationFeedback.type}`}>
                            {notificationFeedback.text}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {isConnectWindowOpen && (
              <div className="connect-account-overlay" onClick={() => setIsConnectWindowOpen(false)}>
                <div className={`connect-account-window ${connectPromptMode === "onboarding" ? "is-onboarding" : ""}`} onClick={(e) => e.stopPropagation()}>
                  <div className="connect-account-shell">
                    <aside className="connect-account-trust-panel">
                      <div className="connect-account-kicker">Secure setup</div>
                      <h2>{connectPromptMode === "onboarding" ? "Bring in your portfolio data" : "Connect another account"}</h2>
                      <p>
                        Connect read-only credentials or watch-only addresses to unlock portfolio context, analytics, and tax tracking inside your Zenin workspace.
                      </p>
                      <div className="connect-account-trust-grid">
                        <div className="connect-account-trust-card">
                          <span>Access model</span>
                          <strong>Read-only only</strong>
                          <em>No trading permissions. No withdrawal permissions. Hyperliquid uses address watch only.</em>
                        </div>
                        <div className="connect-account-trust-card">
                          <span>Coverage</span>
                          <strong>Portfolio + research</strong>
                          <em>Holdings, balances, fills, and performance context.</em>
                        </div>
                      </div>
                      <div className="connect-account-security-list">
                        <div>
                          <strong>Controlled access</strong>
                          <span>Least-privilege credentials only. Zenin does not support execution rights here.</span>
                        </div>
                        <div>
                          <strong>Encrypted storage</strong>
                          <span>Account keys stay in your private workspace and are used only for portfolio data sync.</span>
                        </div>
                        <div>
                          <strong>Start with one venue</strong>
                          <span>You can add more exchanges, brokerages, or prediction accounts after the first sync.</span>
                        </div>
                      </div>
                      <div className="connect-account-provider-preview">
                        {onboardingVenuePreview.map((venue) => {
                          const canSync = SYNC_ENABLED_PROVIDERS.has(normalizeProviderId(venue));
                          return (
                            <span key={venue} className={canSync ? "can-sync" : "save-only"}>
                              {venue}
                              <em>{canSync ? "Sync" : "Save"}</em>
                            </span>
                          );
                        })}
                      </div>
                    </aside>

                    <section className="connect-account-form-panel">
                      <div className="connect-account-header">
                        <div>
                          <span>{connectPromptMode === "onboarding" ? "Finish setup" : "Account link"}</span>
                          <strong>{connectPromptMode === "onboarding" ? "Connect your first venue" : "Add a read-only source"}</strong>
                        </div>
                        <button className="close-btn" onClick={() => setIsConnectWindowOpen(false)} aria-label="Close connect account modal">&times;</button>
                      </div>

                      <div className="connect-account-body">
                        {connectAccountSuccess ? (
                          <div className="connect-account-success-panel" role="status">
                            <div className={`connect-account-success-mark ${connectAccountSuccess.syncAvailable ? "synced" : "saved"}`}>
                              {connectAccountSuccess.syncAvailable ? "✓" : "i"}
                            </div>
                            <span>{connectAccountSuccess.syncAvailable ? "Connection synced" : "Connection saved"}</span>
                            <h3>{connectAccountSuccess.provider}</h3>
                            <p>{connectAccountSuccess.message}</p>
                            <div className="connect-account-success-grid">
                              <div>
                                <span>Label</span>
                                <strong>{connectAccountSuccess.label}</strong>
                              </div>
                              <div>
                                <span>Holdings</span>
                                <strong>{connectAccountSuccess.holdingsCount}</strong>
                              </div>
                              <div>
                                <span>Fills</span>
                                <strong>{connectAccountSuccess.tradesCount}</strong>
                              </div>
                            </div>
                            <div className="connect-account-actions">
                              <button
                                className="settings-secondary-btn connect-account-secondary"
                                onClick={() => {
                                  const provider = cexOptions[0] || "Binance";
                                  setAccountForm({
                                    venueType: "cex",
                                    provider,
                                    username: getDefaultConnectionLabel(provider, "cex"),
                                    apiKey: "",
                                    apiSecret: ""
                                  });
                                  setConnectAccountSuccess(null);
                                }}
                              >
                                Add another
                              </button>
                              <button
                                className="settings-primary-btn connect-account-primary"
                                onClick={() => {
                                  setIsConnectWindowOpen(false);
                                  setConnectAccountSuccess(null);
                                  if (routeState.type === "company") navigateToAppRoute();
                                  setActiveSection("Portfolio");
                                }}
                              >
                                View Portfolio
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                        <div className="connect-account-status-strip">
                          <div>
                            <span>Unlocks</span>
                            <strong>Live portfolio, analytics, tax tracking</strong>
                          </div>
                          <div>
                            <span>{selectedProviderSyncLabel}</span>
                            <strong>{selectedProviderSyncHelp}</strong>
                          </div>
                        </div>

                        <div className="connect-account-type-grid" role="tablist" aria-label="Account type">
                          {[
                            { key: "cex", label: "CEX" },
                            { key: "dex", label: "DEX" },
                            { key: "broker", label: "Broker" },
                            { key: "prediction", label: "Prediction" }
                          ].map((type) => {
                            const active = accountForm.venueType === type.key;
                            return (
                              <button
                                key={type.key}
                                type="button"
                                className={`connect-account-type-btn ${active ? "active" : ""}`}
                                onClick={() => {
                                  const nextProvider = type.key === "cex"
                                    ? (cexOptions[0] || "Binance")
                                    : type.key === "dex"
                                      ? (dexOptions[0] || "Hyperliquid")
                                      : type.key === "prediction"
                                        ? (predictionOptions[0] || "Polymarket")
                                        : (brokerOptions[0] || "Interactive Brokers");
                                  setAccountForm((prev) => ({
                                    ...prev,
                                    venueType: type.key,
                                    provider: nextProvider,
                                    username: getDefaultConnectionLabel(nextProvider, type.key),
                                    apiSecret: ""
                                  }));
                                  setConnectAccountSuccess(null);
                                  setConnectAccountFeedback("");
                                }}
                              >
                                {type.label}
                              </button>
                            );
                          })}
                        </div>

                        <label className="settings-field">
                          <span>Provider</span>
                          <select
                            value={accountForm.provider}
                            onChange={(e) => {
                              setAccountForm((prev) => ({
                                ...prev,
                                provider: e.target.value,
                                username: getDefaultConnectionLabel(e.target.value, prev.venueType),
                                apiSecret: ""
                              }));
                              setConnectAccountSuccess(null);
                              setConnectAccountFeedback("");
                            }}
                          >
                            {venueOptions.map((venue) => (
                              <option key={venue} value={venue}>{venue}</option>
                            ))}
                          </select>
                        </label>
                        <label className="settings-field">
                          <span>Account label</span>
                          <input
                            type="text"
                            value={accountForm.username}
                            onChange={(e) => {
                              setAccountForm((prev) => ({ ...prev, username: e.target.value }));
                              setConnectAccountSuccess(null);
                              setConnectAccountFeedback("");
                            }}
                            placeholder={getDefaultConnectionLabel(accountForm.provider, accountForm.venueType)}
                          />
                        </label>
                        <label className="settings-field">
                          <span>{apiKeyFieldLabel}</span>
                          <input
                            type={selectedProviderIsHyperliquid ? "text" : "password"}
                            value={accountForm.apiKey}
                            onChange={(e) => {
                              setAccountForm((prev) => ({ ...prev, apiKey: e.target.value }));
                              setConnectAccountSuccess(null);
                              setConnectAccountFeedback("");
                            }}
                            placeholder={apiKeyPlaceholder}
                            disabled={isSyncingAccount}
                          />
                        </label>
                        {showApiSecretField && (
                          <label className="settings-field">
                            <span>API Secret</span>
                            <input
                              type="password"
                              value={accountForm.apiSecret}
                              onChange={(e) => {
                                setAccountForm((prev) => ({ ...prev, apiSecret: e.target.value }));
                                setConnectAccountSuccess(null);
                                setConnectAccountFeedback("");
                              }}
                              placeholder="Enter read-only API secret"
                              disabled={isSyncingAccount}
                            />
                          </label>
                        )}

                        {connectAccountFeedback ? (
                          <p className="connect-account-feedback error">{connectAccountFeedback}</p>
                        ) : (
                          <p className="connect-account-footnote">
                            {selectedProviderIsHyperliquid
                              ? "Hyperliquid connects from a public wallet address only. No API secret is needed."
                              : selectedProviderCanSync
                                ? "Use read-only credentials only. Connect one venue now and add the rest from Portfolio."
                                : "This provider can be saved now. Live sync support will be added through a provider adapter."}
                          </p>
                        )}

                        <div className="connect-account-actions">
                          <button
                            className="settings-secondary-btn connect-account-secondary"
                            onClick={() => setIsConnectWindowOpen(false)}
                            disabled={isSyncingAccount}
                          >
                            {connectPromptMode === "onboarding" ? "Skip for now" : "Cancel"}
                          </button>
                          <button
                            className="settings-primary-btn connect-account-primary"
                            onClick={connectAccount}
                            disabled={isSyncingAccount || !accountForm.apiKey.trim() || (showApiSecretField && !accountForm.apiSecret.trim())}
                          >
                            {isSyncingAccount ? (selectedProviderCanSync ? "Syncing..." : "Saving...") : "Connect account"}
                          </button>
                        </div>
                          </>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <SpeedInsights />
        <Analytics />
      </Suspense>
    </div>
  );
}

export default App;
