import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Menu,
  Search,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { PasswordRequirementsList } from "@/components/ui/async-state";
import { ToastProvider, Toaster } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { PlanLockOverlay } from "@/components/PlanLockOverlay";
import { WorkspaceScopeProvider } from "./components/WorkspaceScopeContext";
import { NotificationPreferences } from "@/components/NotificationPreferences";
import "./styles.css";
import "./styles/intelligence.css";
import "./styles/brokerage.css";
import { calculateAccountSnapshot, calculatePortfolioMarketValue } from "./utils/accountMetrics";
import { calculateOptionPnL } from "./utils/optionsPnL";
import { updateFXRates, convertToUSD } from "./utils/currencyUtils";
import { ZeninLogo } from "./components/Branding";
import { TransmissionExplorerProvider } from "./transmission/TransmissionExplorerProvider.jsx";
import { openExplorer as openTransmissionExplorer } from "./transmission/TransmissionEngine.js";
import {
  AccountIcon,
  AnalyticsIcon,
  HomeIcon,
  IntelligenceIcon,
  JournalIcon,
  LiveRailIcon,
  LogoutIcon,
  MetricsIcon,
  OptionsIcon,
  PortfolioIcon,
  PredictionsIcon,
  ResearchIcon,
  TaxIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
  WatchlistIcon
} from "./components/SidebarIcons";
import { readResilientCache, writeResilientCache } from "./utils/resilientData";
import { getSnapshotFallbackMessage } from "./utils/staleNotice";
import { resolveHeadlineValue, hasConnectedSources, resolveDisplayPositions, resolvePerformanceTimeline } from "./utils/portfolioHeadline";
import { fetchBrokerageWorkspaceSummary } from "./utils/brokerageApi.js";
import { useUnifiedPortfolio } from "./hooks/useUnifiedPortfolio";
import { zeninFetch, zeninFetchJson } from "./utils/zeninFetch";
import { buildAssetRoute } from "./utils/assetRegistry";
import { normalizeInstrumentSymbol, resolveCurrencyInstrument, CURATED_ETF_CATALOG } from "./utils/currencyInstruments.js";
import { ProviderHealthDashboard } from "./components/ProviderHealthDashboard";
import { NotificationCenter } from "./components/NotificationCenter";
import { useNotificationStream } from "./hooks/useNotificationStream";
import { IndicatorActionsProvider } from "./utils/indicatorActions";
import { startRegistration } from "@simplewebauthn/browser";
import { hasWorkspaceSession, loadWorkspaceCollection, loadWorkspaceDoc, saveWorkspaceDoc, saveWorkspaceCollection } from "./utils/workspacePersistence";
import { ZENIN_API_BASE_URL } from "./constants/apiConfig";

function AnimatedTradeToast({ toast, onDismiss }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    setIsClosing(false);
  }, [toast?.id]);

  const dismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    window.setTimeout(onDismiss, 120);
  };

  if (!toast) return null;
  return (
    <div
      className={`trade-toast ${toast.type} ${isClosing ? "is-closing" : ""}`}
      onClick={dismiss}
      style={{ cursor: "pointer" }}
    >
      {toast.message}
    </div>
  );
}

import { useLivePriceStream } from "./hooks/useLivePriceStream";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useRuntimeConfig } from "./hooks/useRuntimeConfig";
import { useMediaQuery, useViewportWidth } from "./hooks/useMediaQuery";
import { usePlanGate } from "./hooks/usePlanGate";
import { CommandPalette, useCommandPaletteLauncher } from "./components/CommandPalette";
import SecurityRecovery from "./components/SecurityRecovery";
import { searchAssets, searchAssetsLive } from "./utils/assetSearch.js";
import { enqueueImportSync, flushImportSyncQueue, hasPendingImportSync } from "./utils/importSyncQueue";
import { GenericErrorBoundary } from "./components/ErrorBoundary";
import FirstSessionWelcome from "./components/onboarding/launch/FirstSessionWelcome";
import { consumeLaunched } from "./components/onboarding/launch/launchSignal";
import { markLaunched } from "./components/onboarding/launch/launchSignal";
import {
  markOnboardingComplete,
  loadOnboardingComplete,
} from "./services/OnboardingService";
import { WorkspaceInstitutionalControlPanel } from "./components/InstitutionalPanels";
import { applySeo } from "./utils/seo";
import { storePostAuthRedirect } from "./utils/authRedirect";
import {
  ensureZeninSessionFromSupabase,
  getSupabaseClient,
  getSupabaseLinkedIdentities,
  getSupabaseMfaState,
  isSupabaseConfigured,
  linkSupabaseOAuthIdentity,
  signOutEverywhere,
  startSupabaseTotpEnrollment,
  subscribeToSupabaseAuth,
  unenrollSupabaseMfaFactor,
  unlinkSupabaseOAuthIdentity,
  verifySupabaseTotpEnrollment
} from "./utils/backendAuth";
import { updateAccountPlan } from "./utils/accountPlan";
import { ComparisonWorkspace } from "./components/comparison/ComparisonWorkspace";
import {
  formatRevenueCatError,
  isRevenueCatCancelledError,
  loadRevenueCatState,
  presentRevenueCatPaywall,
  purchaseRevenueCatPackage
} from "./utils/revenueCat";
import { getAppRuntimeConfig, setRuntimeConfigs } from "./config/runtimeConfigStore";

const REQUIRED_WATCHLIST_CATEGORIES = ["indicators", "commodities", "etfs", "currencies"];
const DEFAULT_WATCHLIST_CATEGORIES = ["stocks", "bonds", "crypto", "indicators", "commodities", "etfs", "currencies"];

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
const PersonaOnboardingModal = lazyWithReloadRetry(
  () => import("./components/PersonaOnboardingModal").then((mod) => ({ default: mod.PersonaOnboardingModal })),
  "zenin_lazy_retry_persona"
);
const PortfolioModule = lazyWithReloadRetry(
  () => import("./components/PortfolioModule").then((mod) => ({ default: mod.PortfolioModule })),
  "zenin_lazy_retry_portfolio"
);

const SnapTradeConnectionFlow = lazyWithReloadRetry(
  () => import("./components/brokerage/SnapTradeConnectionFlow").then((mod) => ({ default: mod.SnapTradeConnectionFlow })),
  "zenin_lazy_retry_brokerage_flow"
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
const IntelligenceWorkspace = lazyWithReloadRetry(
  () => import("./components/IntelligenceWorkspace").then((mod) => ({ default: mod.default })),
  "zenin_lazy_retry_intelligence"
);
const ResearchModule = lazyWithReloadRetry(
  () => import("./components/ResearchModule").then((mod) => ({ default: mod.ResearchModule })),
  "zenin_lazy_retry_research"
);
const PredictionMarketModule = lazyWithReloadRetry(
  () => import("./components/PredictionMarketModule").then((mod) => ({ default: mod.PredictionMarketModule })),
  "zenin_lazy_retry_predictions"
);
const TaxEstimator = lazyWithReloadRetry(
  () => import("./components/TaxEstimator").then((mod) => ({ default: mod.TaxEstimator })),
  "zenin_lazy_retry_tax"
);
const PerpsCalculator = lazyWithReloadRetry(
  () => import("./components/PerpsCalculator").then((mod) => ({ default: mod.PerpsCalculator })),
  "zenin_lazy_retry_perps_calc"
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
const WatchlistCollectModal = lazyWithReloadRetry(
  () => import("./components/WatchlistCollectModal"),
  "zenin_lazy_retry_watchlist_collect"
);
const AssetAlertBuilder = lazyWithReloadRetry(
  () => import("./components/AssetAlertBuilder"),
  "zenin_lazy_retry_alert_builder"
);
const AssetCompareDrawer = lazyWithReloadRetry(
  () => import("./components/AssetCompareDrawer"),
  "zenin_lazy_retry_compare_drawer"
);
const CompanyProfilePage = lazyWithReloadRetry(
  () => import("./components/CompanyProfilePage").then((mod) => ({ default: mod.CompanyProfilePage })),
  "zenin_lazy_retry_company"
);
const AssetResearchWorkspace = lazyWithReloadRetry(
  () => import("./components/AssetResearchWorkspace").then((mod) => ({ default: mod.AssetResearchWorkspace })),
  "zenin_lazy_retry_asset"
);
const MacroAssetWorkspace = lazyWithReloadRetry(
  () => import("./components/macro/MacroAssetWorkspace").then((mod) => ({ default: mod.MacroAssetWorkspace })),
  "zenin_lazy_retry_macro"
);
const CurrencyResearchWorkspace = lazyWithReloadRetry(
  () => import("./components/CurrencyResearchWorkspace").then((mod) => ({ default: mod.CurrencyResearchWorkspace })),
  "zenin_lazy_retry_currency"
);
const MacroProfilePage = lazyWithReloadRetry(
  () => import("./components/macro/MacroProfilePage").then((mod) => ({ default: mod.MacroProfilePage })),
  "zenin_lazy_retry_macro_profile"
);
const OnboardingPage = lazyWithReloadRetry(
  () => import("./pages/OnboardingPage").then((mod) => ({ default: mod.default })),
  "zenin_lazy_retry_onboarding"
);
const SpeedInsights = lazyWithReloadRetry(
  () => import("@vercel/speed-insights/react").then((mod) => ({ default: mod.SpeedInsights })),
  "zenin_lazy_retry_speed_insights"
);
const Analytics = lazyWithReloadRetry(
  () => import("@vercel/analytics/react").then((mod) => ({ default: mod.Analytics })),
  "zenin_lazy_retry_analytics_beacon"
);

const BACKEND_URL = ZENIN_API_BASE_URL;
const GUEST_ACCESS_VALUES = new Set(["1", "true", "yes"]);
const SYNC_ENABLED_PROVIDERS = new Set(["binance", "bybit", "hyperliquid", "lighter", "interactive_brokers"]);
// Providers shown in the connect UI but not yet syncable (honest "coming soon"
// stubs — no fabricated sync capability). Rendered disabled with a "Soon" badge.
const COMING_SOON_PROVIDERS = new Set(["aster", "variational"]);
// USD-pegged stablecoins treated as 1:1 with USD for buying-power/cash totals.
// Connected wallets (e.g. Hyperliquid) sync USDC; without this, a USDC balance
// never replaces the default seed cash and "Buying power" stays stuck at $10K.
const USD_STABLE_EQUIVALENTS = new Set(["USD", "USDC", "USDT"]);

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

function buildClientConnectionCapability(provider) {
  const providerId = normalizeProviderId(provider);
  const syncAvailable = SYNC_ENABLED_PROVIDERS.has(providerId);
  const watchOnly = providerId === "hyperliquid" || providerId === "lighter";
  return {
    accessMode: watchOnly ? "watch_only" : (syncAvailable ? "read_only_key" : "read_only_metadata"),
    syncAvailable,
    syncStatus: syncAvailable ? "sync_supported" : "metadata_only",
    nextAction: syncAvailable
      ? (watchOnly ? "Run sync to import holdings, balances, and fills." : "Provide a provider-side read-only API key, then run sync to import holdings, balances, and fills.")
      : "Saved for workspace context. Live sync is not available for this provider yet.",
    supportMessage: syncAvailable
      ? (watchOnly
          ? "Zenin can import live portfolio data from this public watch-only address."
          : "Zenin can import live portfolio data from this provider with a read-only API key. Some centralized exchanges may also be available through SnapTrade.")
      : "Zenin stores this source as read-only metadata until a provider adapter is available."
  };
}

function getConnectionCapability(account) {
  if (account?.connectionCapability && typeof account.connectionCapability === "object") {
    const fallback = buildClientConnectionCapability(account.provider || account.exchange);
    return {
      ...fallback,
      ...account.connectionCapability,
      syncAvailable: typeof account.connectionCapability.syncAvailable === "boolean"
        ? account.connectionCapability.syncAvailable
        : fallback.syncAvailable
    };
  }
  return buildClientConnectionCapability(account?.provider || account?.exchange);
}

function getConnectionStatusCopy(account) {
  const capability = getConnectionCapability(account);
  const status = String(account?.lastSyncStatus || "").trim().toLowerCase();
  if (capability.accessMode === "watch_only") {
    return {
      label: "Watch-only",
      detail: status === "success" ? "Live wallet snapshot synced." : "Public address saved for portfolio context.",
      action: status === "success" ? "Review imported holdings in Portfolio." : "Open Portfolio after sync completes."
    };
  }
  if (!capability.syncAvailable || status === "sync_unavailable") {
    return {
      label: "Metadata only",
      detail: capability.supportMessage,
      action: capability.nextAction
    };
  }
  if (status === "success") {
    return {
      label: "Live sync ready",
      detail: "Holdings, balances, and fills were imported with read-only access.",
      action: "Review imported holdings in Portfolio."
    };
  }
  if (status === "error") {
    return {
      label: "Sync needs attention",
      detail: account?.lastSyncMeta?.error || "Zenin saved the credential but could not complete the latest sync.",
      action: "Check the provider credential, then reconnect or retry sync."
    };
  }
  return {
    label: "Ready to sync",
    detail: capability.supportMessage,
    action: capability.nextAction
  };
}

const SCOPE_BADGE_COPY = {
  verified_read_only: { label: "Verified read-only", tone: "verified" },
  verified_watch_only: { label: "Watch-only", tone: "verified" },
  scope_unverified: { label: "Scope unverified", tone: "unverified" },
  provider_unverified: { label: "Scope unverified", tone: "unverified" },
  rejected_trade_enabled: { label: "Trading key rejected", tone: "rejected" },
  sync_failed: { label: "Sync failed", tone: "unverified" }
};

function getScopeBadge(account) {
  const trust = account?.providerTrust;
  const status = String(trust?.scopeStatus || account?.scopeVerificationStatus || "scope_unverified").trim().toLowerCase();
  return SCOPE_BADGE_COPY[status] || SCOPE_BADGE_COPY.scope_unverified;
}

function formatRelativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isActionableWorkspaceNotification(notification = {}) {
  const type = String(notification.type || "").toLowerCase();
  const severity = String(notification?.metadata?.severity || notification.severity || "").toLowerCase();
  return ["critical", "danger", "risk", "high", "warning", "review"].includes(severity)
    || type.includes("security")
    || type.includes("portfolio_transaction")
    || type.includes("risk")
    || type.includes("rebalance")
    || type.includes("price_alert");
}

function notificationToastTone(notification = {}) {
  const severity = String(notification?.metadata?.severity || notification.severity || "").toLowerCase();
  if (["critical", "danger", "risk", "high"].includes(severity) || String(notification.type || "").includes("security")) return "error";
  const type = String(notification.type || "");
  if (type.includes("trade_execution") || type.includes("portfolio_transaction")) return "success";
  return "info";
}

function formatDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getProviderTrustForAccount(account) {
  if (account?.providerTrust && typeof account.providerTrust === "object") {
    return account.providerTrust;
  }
  // Fallback for legacy/guest rows without a server-provided providerTrust
  const provider = String(account?.exchange || account?.provider || "").trim().toLowerCase();
  const scopeStatus = String(account?.scopeVerificationStatus || (provider === "hyperliquid" || provider === "lighter" ? "verified_watch_only" : "scope_unverified")).trim().toLowerCase();
  const canTrade = false;
  const canWithdraw = false;
  const isWatchOnly = provider === "hyperliquid" || provider === "lighter";
  return {
    provider,
    providerLabel: account?.provider || account?.exchange || "Unknown provider",
    scopeStatus,
    lastVerifiedAt: null,
    lastSyncedAt: account?.lastSyncAt || null,
    lastSyncStatus: account?.lastSyncStatus || "never",
    permissionsDetected: {
      canReadBalances: false,
      canReadTrades: false,
      canReadOrders: false,
      canTrade,
      canWithdraw,
      isWatchOnly
    },
    proofItems: [],
    cannotTrade: !canTrade,
    cannotWithdraw: !canWithdraw,
    message: account?.providerTrust?.message || "Provider scope has not been verified server-side."
  };
}

function isGuestAccessRequested() {
  if (typeof window === "undefined") return false;
  if (isDevFullAccessEnabled()) return true;
  const params = new URLSearchParams(window.location.search);
  return GUEST_ACCESS_VALUES.has(String(params.get("guest") || "").trim().toLowerCase());
}

function isDevFullAccessEnabled() {
  if (!import.meta.env.DEV) return false;
  try {
    if (typeof window !== "undefined" && localStorage.getItem("zenin_guest_full_access") === "1") return true;
  } catch {}
  return Boolean(String(import.meta.env.VITE_ZENIN_DEV_FULL_ACCESS || "").trim().toLowerCase() === "true");
}

function buildDevFullAccessUser() {
  const now = new Date().toISOString();
  return {
    id: "dev-full-access",
    email: "dev@zenin.test",
    displayName: "Developer",
    currentPlan: "desk",
    currentBillingCycle: "monthly",
    isAdmin: true,
    adminRole: "owner",
    authProvider: "local-dev",
    emailVerified: true,
    createdAt: now,
    updatedAt: now
  };
}

function isGuestQueryRequested() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return GUEST_ACCESS_VALUES.has(String(params.get("guest") || "").trim().toLowerCase());
}

function clearGuestQueryFromAppUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.pathname.startsWith("/app") || !url.searchParams.has("guest")) return;
  url.searchParams.delete("guest");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function redirectToAuthGate() {
  if (typeof window === "undefined") return;
  const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  storePostAuthRedirect(target, "/app");
  const authUrl = new URL("/auth", window.location.origin);
  authUrl.searchParams.set("mode", "signin");
  authUrl.searchParams.set("next", target);
  window.location.replace(`${authUrl.pathname}${authUrl.search}${authUrl.hash}`);
}

function getBrowserNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

// ── Comparison target normalization (Watchlist Audit remediation §1) ──────
// Resolve an asset kind from a bare symbol so legacy bare-symbol compare
// callbacks route to the correct workspace. FX/currency via the currency
// registry; ETFs via the curated ETF catalog; default equity/stock.
function resolveAssetKindFromSymbol(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return "stock";
  const inst = resolveCurrencyInstrument(raw);
  if (inst?.kind === "forex" || inst?.kind === "currency") return inst.kind;
  // CURATED_ETF_CATALOG is an array of { symbol, ... } entries (ticker in symbol).
  const upper = raw.toUpperCase();
  if (CURATED_ETF_CATALOG && CURATED_ETF_CATALOG.some((e) => e.symbol === upper)) return "etf";
  return "stock";
}

// Accepts a legacy string OR a typed { symbol, kind, compareSymbol } object.
function normalizeCompareTarget(input, fallbackKind) {
  if (input == null) return { symbol: "", kind: fallbackKind || "stock" };
  if (typeof input === "string") {
    const symbol = String(input).trim().toUpperCase();
    return { symbol, kind: fallbackKind || resolveAssetKindFromSymbol(symbol) };
  }
  const rawSymbol = input.symbol ?? input.a ?? "";
  const symbol = String(rawSymbol).trim().toUpperCase();
  const rawKind = input.kind || input.type || fallbackKind;
  const kind = rawKind ? String(rawKind).toLowerCase() : resolveAssetKindFromSymbol(symbol);
  const rawCompare = input.compareSymbol ?? input.peerSymbol ?? input.b ?? null;
  const compareSymbol = rawCompare ? String(rawCompare).trim().toUpperCase() : null;
  return { symbol, kind, compareSymbol };
}

// Read ?view=compare&peer=SYMBOL from the URL so compare deep-links / refresh
// reopen the correct workspace view (Watchlist Audit remediation §1).
function readCompareViewState() {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (!view) return undefined;
  const peer = params.get("peer");
  const state = { view };
  if (peer) state.compareSymbol = peer.trim().toUpperCase();
  return state;
}

function parseRouteFromLocation() {
  if (typeof window === "undefined") {
    return { type: "app", symbol: "" };
  }
  const compareMatch = window.location.pathname.match(/^\/app\/compare\/([^/]+)$/i);
  if (compareMatch) {
    const raw = decodeURIComponent(compareMatch[1] || "").trim();
    const [a, b] = raw.split("-vs-").map((s) => s.trim().toUpperCase()).filter(Boolean);
    // Resolve actual types (never hard-code equity). If the primary is a
    // contextual kind (etf/forex/currency), redirect to its ARW compare view.
    const primaryKind = a ? resolveAssetKindFromSymbol(a) : "stock";
    if (a && (primaryKind === "etf" || primaryKind === "forex" || primaryKind === "currency")) {
      const routeKind = primaryKind === "etf" ? "etf" : primaryKind;
      const r = buildAssetRoute("research", routeKind, a);
      if (r) {
        return { type: r.routeType, symbol: r.symbol, state: { view: "compare", compareSymbol: b || null, kind: primaryKind } };
      }
    }
    return { type: "compare", assets: [a, b].filter(Boolean).map((s) => ({ symbol: s, type: resolveAssetKindFromSymbol(s) })) };
  }
  const commodityProfileMatch = window.location.pathname.match(/^\/app\/commodities\/([^/]+)\/profile$/i);
  if (commodityProfileMatch) {
    return { type: "commodity-profile", symbol: decodeURIComponent(commodityProfileMatch[1] || "").trim().toUpperCase() };
  }
  const commodityMatch = window.location.pathname.match(/^\/app\/commodities\/([^/]+)$/i);
  if (commodityMatch) {
    return { type: "commodity", symbol: decodeURIComponent(commodityMatch[1] || "").trim().toUpperCase() };
  }
  const etfProfileMatch = window.location.pathname.match(/^\/app\/etf\/([^/]+)\/profile$/i);
  if (etfProfileMatch) {
    return { type: "etf-profile", symbol: decodeURIComponent(etfProfileMatch[1] || "").trim().toUpperCase() };
  }
  const etfMatch = window.location.pathname.match(/^\/app\/etf\/([^/]+)$/i);
  if (etfMatch) {
    return {
      type: "etf",
      symbol: decodeURIComponent(etfMatch[1] || "").trim().toUpperCase(),
      state: readCompareViewState()
    };
  }
  const currencyProfileMatch = window.location.pathname.match(/^\/app\/currency\/([^/]+)\/profile$/i);
  if (currencyProfileMatch) {
    return { type: "currency-profile", symbol: decodeURIComponent(currencyProfileMatch[1] || "").trim().toUpperCase() };
  }
  const currencyMatch = window.location.pathname.match(/^\/app\/currency\/([^/]+)$/i);
  if (currencyMatch) {
    return {
      type: "currency",
      symbol: decodeURIComponent(currencyMatch[1] || "").trim().toUpperCase(),
      state: readCompareViewState()
    };
  }
  const macroProfileMatch = window.location.pathname.match(/^\/app\/macro\/([^/]+)\/profile$/i);
  if (macroProfileMatch) {
    return { type: "macro-profile", symbol: decodeURIComponent(macroProfileMatch[1] || "").trim().toUpperCase() };
  }
  const macroMatch = window.location.pathname.match(/^\/app\/macro\/([^/]+)$/i);
  if (macroMatch) {
    return { type: "macro", symbol: decodeURIComponent(macroMatch[1] || "").trim().toUpperCase() };
  }
  const match = window.location.pathname.match(/^\/app\/company\/([^/]+)$/i);
  if (!match) {
    const assetMatch = window.location.pathname.match(/^\/app\/asset\/([^/]+)$/i);
    if (assetMatch) {
      try {
        return { type: "asset", symbol: decodeURIComponent(assetMatch[1] || "").trim().toUpperCase() };
      } catch {
        return { type: "asset", symbol: String(assetMatch[1] || "").trim().toUpperCase() };
      }
    }
    const onboardingMatch = window.location.pathname.match(/^\/onboarding$/i);
    if (onboardingMatch) {
      const params = new URLSearchParams(window.location.search);
      const plan = params.get("plan");
      return { type: "onboarding", plan: plan || null };
    }
    return { type: "app", symbol: "" };
  }
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

function getGuestWorkspaceLabel() {
  return "Guest";
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

function getPersonaPromptSessionKey(userId) {
  return `zenin_persona_prompt_seen_${String(userId || "guest")}`;
}

function getPersonaSectionOrder(personaKey) {
  if (personaKey === "casual_investor") return ["Home", "Portfolio", "Watchlist", "Research", "Journal"];
  if (personaKey === "active_trader") return ["Watchlist", "Portfolio", "Intelligence", "Journal", "Analytics"];
  if (personaKey === "small_team") return ["Research", "Watchlist", "Intelligence", "Journal", "Analytics"];
  return null;
}

const getFallbackAssetsForCategory = (category) =>
  getAppRuntimeConfig()?.watchlist?.fallbackAssetsByCategory?.[String(category || "").toLowerCase()] || [];

const moduleLoadingFallback = <div className="loading-state module-loading-state">Loading workspace...</div>;

function GuestStatusChip({ status }) {
  const labelMap = {
    live: "Live",
    cached: "Cached",
    saved: "Saved data",
    delayed: "Delayed",
    preview: "Preview"
  };
  const normalized = String(status || "preview").toLowerCase();
  return <span className={`guest-status-chip ${normalized}`}>{labelMap[normalized] || "Preview"}</span>;
}

function GuestSavedDataBanner({ activeSection, lastUpdated, liveStreamStatus, watchlistNotice, retryingLiveData = false, onRetryLiveData }) {
  const status = liveStreamStatus === "connected" ? "live" : watchlistNotice ? "cached" : "saved";
  const signupHref = getGuestSignupHref(activeSection);
  return (
    <section className="guest-data-banner" aria-label="Guest data status">
      <div>
        <GuestStatusChip status={status} />
        <strong>Guest mode uses saved market data</strong>
        <span>Snapshot {lastUpdated}. Retry live data when the backend feed is reachable.</span>
      </div>
      <div className="guest-data-banner-actions">
        <a className="guest-signup-cta" href={signupHref}>
          Create free account
        </a>
        <button type="button" onClick={onRetryLiveData} disabled={retryingLiveData} aria-busy={retryingLiveData}>
          {retryingLiveData ? "Checking feed..." : "Retry live data"}
        </button>
      </div>
    </section>
  );
}

function GuestMissionBar({ activeSection, onOpenSection }) {
  const steps = [
    { key: "Watchlist", label: "Track asset", detail: "Start with NVDA, BTC, or a macro country." },
    { key: "Research", label: "Open research", detail: "Attach catalyst context to the asset." },
    { key: "Journal", label: "Save decision", detail: "Capture the call before it disappears." }
  ];
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === activeSection));
  return (
    <section className="guest-mission-bar" aria-label="Guest conversion path">
      <div className="guest-mission-copy">
        <span>Demo path</span>
        <strong>Track an asset, inspect the thesis, then save the decision.</strong>
      </div>
      <div className="guest-mission-steps">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            className={index <= activeIndex ? "active" : ""}
            onClick={() => onOpenSection(step.key)}
          >
            <i aria-hidden="true">{index + 1}</i>
            <span>{step.label}</span>
            <small>{step.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function GuestPreviewCard({ module, isFocused = false, onOpenSection, onShareSection }) {
  const href = `/app?guest=1&section=${getGuestSectionSlug(module.section)}`;
  return (
    <article className={`guest-preview-card ${isFocused ? "focused" : ""}`}>
      <header>
        <div>
          <span>{module.eyebrow}</span>
          <h3>{module.title}</h3>
        </div>
        <GuestStatusChip status={module.status} />
      </header>
      <p>{module.summary}</p>
      <div className="guest-preview-metrics">
        <strong>{module.primaryMetric}</strong>
        <span>{module.secondaryMetric}</span>
      </div>
      <ul>
        {module.bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
      <div className="guest-preview-table" aria-label={`${module.section} demo rows`}>
        {module.rows.map((row) => (
          <div key={`${module.section}-${row.join("-")}`}>
            <strong>{row[0]}</strong>
            <span>{row[1]}</span>
            <em>{row[2]}</em>
          </div>
        ))}
      </div>
      <div className="guest-preview-actions">
        <button type="button" onClick={() => onOpenSection(module.section)}>
          Open preview
        </button>
        <a
          href={href}
          onClick={(event) => {
            if (!onShareSection) return;
            event.preventDefault();
            onShareSection(module.section);
          }}
        >
          Share link
        </a>
      </div>
    </article>
  );
}

function GuestWorkflowCard({ workflow, onOpenSection }) {
  return (
    <article className="guest-workflow-card">
      <header>
        <span>{workflow.section}</span>
        <h3>{workflow.title}</h3>
      </header>
      <ol>
        {workflow.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button type="button" onClick={() => onOpenSection(workflow.section)}>
        Start workflow
      </button>
    </article>
  );
}

const GUEST_CONTEXTUAL_SIGNUP_COPY = {
  Watchlist: {
    eyebrow: "Asset workflow opened",
    title: "Save this watchlist setup",
    body: "Create an account to keep tracked assets, live price retries, and alerts available next time."
  },
  Research: {
    eyebrow: "Research preview opened",
    title: "Save this research setup",
    body: "Create an account to keep catalyst notes, thesis framing, and follow-ups synced to your workspace."
  },
  Analytics: {
    eyebrow: "Analytics workflow opened",
    title: "Save this dashboard view",
    body: "Create an account to unlock live data, persistent dashboards, and journal-ready market context."
  },
  Portfolio: {
    eyebrow: "Portfolio preview opened",
    title: "Save this portfolio view",
    body: "Create an account to connect portfolios, preserve allocation views, and track live performance."
  },
  Options: {
    eyebrow: "Options preview opened",
    title: "Save this derivatives review",
    body: "Create an account to keep options flow, volatility context, and risk notes in one workspace."
  },
  Journal: {
    eyebrow: "Journal preview opened",
    title: "Save this decision record",
    body: "Create an account to keep notes, decision theses, and reviews attached to your market work."
  },
  "Tax Estimator": {
    eyebrow: "Tax preview opened",
    title: "Save this tax scenario",
    body: "Create an account to preserve lots, scenarios, and export-ready tax summaries."
  }
};

function GuestContextualSignupNudge({ section, interaction }) {
  if (!interaction) return null;
  const copy = GUEST_CONTEXTUAL_SIGNUP_COPY[section] || {
    eyebrow: "Workspace preview opened",
    title: "Save this workspace",
    body: "Create an account to keep live data, notes, portfolios, and research synced."
  };
  const signupHref = getGuestSignupHref(section);
  return (
    <section className="guest-contextual-signup" aria-label="Save guest workspace">
      <div>
        <span>{copy.eyebrow}</span>
        <h3>{copy.title}</h3>
        <p>{copy.body}</p>
      </div>
      <a className="guest-signup-cta" href={signupHref}>
        Create account to save
      </a>
    </section>
  );
}

function GuestWorkspacePreview({
  activeSection,
  guestInteraction,
  guestActionFeedback,
  retryingLiveData,
  liveStreamStatus,
  lastLivePriceAt,
  watchlistNotice,
  onOpenSection,
  onShareSection,
  onRetryLiveData
}) {
  const focusedModule = GUEST_PREVIEW_BY_SECTION[activeSection] || null;
  const modules = focusedModule
    ? [focusedModule, ...GUEST_PREVIEW_MODULES.filter((module) => module.section !== focusedModule.section)]
    : GUEST_PREVIEW_MODULES;
  const lastUpdated = lastLivePriceAt
    ? new Date(lastLivePriceAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : GUEST_DEMO_SNAPSHOT_LABEL;
  const signupHref = getGuestSignupHref(activeSection);
  const continueTarget = getNextGuestSection(activeSection);

  return (
    <div className="view-container guest-workspace-preview">
      <GuestSavedDataBanner
        activeSection={activeSection}
        lastUpdated={lastUpdated}
        liveStreamStatus={liveStreamStatus}
        watchlistNotice={watchlistNotice}
        retryingLiveData={retryingLiveData}
        onRetryLiveData={onRetryLiveData}
      />
      {guestActionFeedback ? (
        <div className="guest-action-feedback" role="status" aria-live="polite">
          {guestActionFeedback}
        </div>
      ) : null}
      <GuestMissionBar activeSection={activeSection} onOpenSection={onOpenSection} />
      <section className="guest-workspace-hero">
        <div>
          <span>Guest workspace</span>
          <h2>{focusedModule ? focusedModule.title : "Run the asset-to-decision loop before you sign up."}</h2>
          <p>
            This saved workspace behaves like a working desk: watchlist first, thesis second, journal last. Create an
            account when you want the setup, notes, and tax scenarios to persist.
          </p>
          <div className="guest-hero-actions">
            <a className="guest-signup-cta" href={signupHref}>
              Save this workspace
            </a>
            <button type="button" onClick={() => onOpenSection(continueTarget)}>
              Continue exploring
            </button>
          </div>
        </div>
        <div className="guest-onboarding-checklist" aria-label="Guest onboarding checklist">
          {GUEST_ONBOARDING_STEPS.map((step, index) => (
            <span key={step} className={index < 2 ? "complete" : ""}>
              <i aria-hidden="true">{index < 2 ? "OK" : index + 1}</i>
              {step}
            </span>
          ))}
        </div>
      </section>

      <GuestContextualSignupNudge section={activeSection} interaction={guestInteraction} />

      <section className="guest-workflow-grid" aria-label="Sample workflows">
        {GUEST_WORKFLOWS.map((workflow) => (
          <GuestWorkflowCard key={workflow.title} workflow={workflow} onOpenSection={onOpenSection} />
        ))}
      </section>

      <section className="guest-preview-grid" aria-label="Module demo previews">
        {modules.map((module) => (
          <GuestPreviewCard
            key={module.section}
            module={module}
            isFocused={module.section === activeSection}
            onOpenSection={onOpenSection}
            onShareSection={onShareSection}
          />
        ))}
      </section>
    </div>
  );
}

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
  Research: {
    group: "Research",
    eyebrow: "Research",
    description: "Connect knowledge bases and ticker-link notes."
  },
  Analytics: {
    group: "Research",
    eyebrow: "Analytics",
    description: "Scan cross-market and macro context."
  },
  Intelligence: {
    group: "Research",
    eyebrow: "Intelligence",
    description: "Unified market intelligence: signals, transmission, timeline, and diagnostics."
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
    description: "Capture notes, setups, and decision reviews."
  },
  "Tax Estimator": {
    group: "Tools",
    eyebrow: "Tax",
    description: "Model scenarios and tax exposure."
  }
};

const SIDEBAR_GROUP_ORDER = ["Core", "Research", "Tools"];

// Mobile primary destinations (thumbs-first bottom nav). The remaining
// sections stay in the hamburger drawer — progressive disclosure, not a
// flattened dump of the desktop sidebar.
const MOBILE_PRIMARY_NAV = ["Home", "Portfolio", "Research", "Journal"];

const GUEST_DEMO_SNAPSHOT_LABEL = "May 24, 2026, 12:25";

const GUEST_PREVIEW_MODULES = [
  {
    section: "Portfolio",
    eyebrow: "Portfolio preview",
    title: "Inspect a sample portfolio",
    summary: "Review allocation, cash, P/L, and rebalance prompts without connecting an account.",
    status: "saved",
    primaryMetric: "$14.6K",
    secondaryMetric: "+8.4% demo P/L",
    bullets: ["AAPL and BTC holdings", "Allocation drift highlighted", "Read-only rebalance estimate"],
    rows: [
      ["AAPL", "$1,895", "+11.5%"],
      ["BTC", "$4,713", "+45.0%"],
      ["Cash", "$8,000", "Ready"]
    ]
  },
  {
    section: "Analytics",
    eyebrow: "Analytics preview",
    title: "Scan cross-market dashboards",
    summary: "Compare crypto, options, equities, macro, and commodities using a saved market snapshot.",
    status: "cached",
    primaryMetric: "5 desks",
    secondaryMetric: "Live retry available",
    bullets: ["Crypto flow matrix", "Commodities stress stack", "Macro and equity factor tape"],
    rows: [
      ["Crypto", "Fallback matrix", "Saved"],
      ["Commodities", "Curve desk", "Cached"],
      ["Macro", "Risk indicators", "Delayed"]
    ]
  },
  {
    section: "Options",
    eyebrow: "Options preview",
    title: "Review derivatives risk",
    summary: "Open interest, volatility, max-pain, and whale-flow examples are staged for evaluation.",
    status: "preview",
    primaryMetric: "$2.4B",
    secondaryMetric: "sample OI",
    bullets: ["BTC and ETH chains", "Gamma and skew samples", "Flow queue examples"],
    rows: [
      ["BTC", "Deribit", "IV 52%"],
      ["ETH", "Deribit", "IV 61%"],
      ["NVDA", "Equity proxy", "Watch"]
    ]
  },
  {
    section: "Research",
    eyebrow: "Research preview",
    title: "Turn a catalyst into a thesis",
    summary: "Use prefilled briefs, catalysts, and follow-ups to see the research workflow.",
    status: "saved",
    primaryMetric: "6 briefs",
    secondaryMetric: "2 active catalysts",
    bullets: ["Ticker-linked notes", "Catalyst queue", "Bull/base/bear framing"],
    rows: [
      ["NVDA", "Earnings setup", "Open"],
      ["BTC", "ETF flow pulse", "Monitor"],
      ["CL", "Inventory stress", "Review"]
    ]
  },
  {
    section: "Journal",
    eyebrow: "Journal preview",
    title: "Capture the decision record",
    summary: "Demo notes show how the app closes the loop from signal to decision.",
    status: "saved",
    primaryMetric: "4 notes",
    secondaryMetric: "2 decisions",
    bullets: ["Decision thesis", "Risk checklist", "Post-decision review"],
    rows: [
      ["NVDA", "Wait for guide", "Logged"],
      ["BTC", "ETF inflow chase", "Avoid"],
      ["CL", "Curve stress", "Watch"]
    ]
  },
  {
    section: "Tax Estimator",
    eyebrow: "Tax preview",
    title: "Estimate tax impact",
    summary: "Sample lots demonstrate realized P/L, holding periods, and taxable scenarios.",
    status: "preview",
    primaryMetric: "$1.2K",
    secondaryMetric: "demo gain",
    bullets: ["Short vs long-term lots", "Scenario toggles", "Export-ready summary"],
    rows: [
      ["AAPL", "Long-term", "$195"],
      ["BTC", "Short-term", "$1,017"],
      ["Cash", "No event", "$0"]
    ]
  }
];

const GUEST_PREVIEW_BY_SECTION = GUEST_PREVIEW_MODULES.reduce((acc, item) => {
  acc[item.section] = item;
  return acc;
}, {});

const GUEST_WORKFLOWS = [
  {
    title: "Track asset",
    section: "Watchlist",
    steps: ["Add NVDA or BTC", "Check saved prices", "Retry live data when available"]
  },
  {
    title: "Research catalyst",
    section: "Research",
    steps: ["Open the catalyst queue", "Frame bull/base/bear", "Attach notes to the asset"]
  },
  {
    title: "Model risk",
    section: "Analytics",
    steps: ["Scan the dashboard", "Compare macro or flow stress", "Journal the decision"]
  }
];

const GUEST_ONBOARDING_STEPS = [
  "Review the demo workspace",
  "Track one asset",
  "Open one research preview",
  "Create an account to save live workspace data"
];

function getGuestSectionSlug(section) {
  return String(section || "Home").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
}

function getNextGuestSection(section) {
  const order = ["Watchlist", "Research", "Journal", "Analytics", "Portfolio", "Options", "Tax Estimator"];
  const index = order.indexOf(section);
  if (index === -1) return "Watchlist";
  return order[(index + 1) % order.length];
}

function getGuestSignupHref(section) {
  const fallbackNext = `/app?guest=1&section=${getGuestSectionSlug(section)}`;
  const nextPath = typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}${window.location.hash}`
    : fallbackNext;
  const authUrl = new URL("/auth", typeof window !== "undefined" ? window.location.origin : "https://www.zenin.capital");
  authUrl.searchParams.set("mode", "signup");
  authUrl.searchParams.set("next", nextPath || fallbackNext);
  return `${authUrl.pathname}${authUrl.search}${authUrl.hash}`;
}

function getSectionFromGuestSlug(slug, sections) {
  const normalized = String(slug || "").trim().toLowerCase();
  return sections.find((section) => getGuestSectionSlug(section) === normalized) || "";
}

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

const normalizeApiExecutionRecord = (execution, idx = 0) => {
  const quantity = Number(execution?.quantity);
  const price = Number(execution?.price);
  const notional = Number(execution?.notional);
  const feeAmount = Number(execution?.feeAmount ?? execution?.fee_amount);
  const side = String(execution?.side || "").toLowerCase() === "sell" ? "sell" : "buy";
  const platform = String(execution?.platform || execution?.exchange || "").trim().toLowerCase();
  return {
    id: Number.isFinite(Number(execution?.id)) ? Number(execution.id) : `api-exec-${Date.now()}-${idx}`,
    source: "api_connection",
    tradeClientId: execution?.tradeClientId || execution?.trade_client_id || null,
    platform,
    platformTradeId: execution?.platformTradeId || execution?.platform_trade_id || null,
    platformFillId: execution?.platformFillId || execution?.platform_fill_id || null,
    symbol: String(execution?.symbol || execution?.asset || "UNKNOWN").trim().toUpperCase(),
    side,
    marketType: String(execution?.marketType || execution?.market_type || "spot").trim().toLowerCase(),
    quantity: Number.isFinite(quantity) ? Math.abs(quantity) : 0,
    price: Number.isFinite(price) ? price : 0,
    notional: Number.isFinite(notional) ? Math.abs(notional) : 0,
    feeAmount: Number.isFinite(feeAmount) ? Math.abs(feeAmount) : 0,
    feeCurrency: String(execution?.feeCurrency || execution?.fee_currency || "USD").trim().toUpperCase(),
    feeSource: normalizeFeeSourceValue(execution?.feeSource || execution?.fee_source, FEE_SOURCE_EXCHANGE_REPORTED),
    liquidityRole: execution?.liquidityRole || execution?.liquidity_role || null,
    executedAt: execution?.executedAt || execution?.executed_at || null,
    referencePrice: Number.isFinite(Number(execution?.referencePrice ?? execution?.reference_price)) ? Number(execution?.referencePrice ?? execution?.reference_price) : null,
    rawPayload: execution?.rawPayload || execution?.raw_payload_json || {}
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

function getTotpQrSrc(qrCode) {
  const raw = String(qrCode || "").trim();
  if (!raw) return "";
  if (/^(data:image|https?:|otpauth:)/i.test(raw)) return raw;
  return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
}

function formatIdentityProvider(provider) {
  const value = String(provider || "").trim();
  if (!value) return "Identity";
  if (value === "google") return "Google";
  if (value === "apple") return "Apple";
  if (value === "email") return "Email";
  return value.charAt(0).toUpperCase() + value.slice(1);
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
}

// Explicit onboarding lifecycle states (spec state machine). Module-level so
// it is initialized before any component callback references it (avoids TDZ).
const LIFECYCLE = {
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETE",
  BOOTSTRAPPING: "BOOTSTRAPPING",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  RETRYING: "RETRYING",
  APP_LAUNCHED: "APP_LAUNCHED",
};

function App() {
  useEffect(() => {
    applySeo({
      title: "Zenin Capital App | Research Desk",
      description: "Zenin Capital app workspace for active market research, portfolio management, and research workflows.",
      robots: "noindex, nofollow, noarchive",
      pathname: typeof window !== "undefined" ? window.location.pathname : "/app",
      canonicalPath: "/app",
      ogTitle: "Zenin Capital App | Research Desk",
      ogDescription: "Authenticated Zenin workspace for portfolio management and research workflows.",
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

  const [categories, setCategories] = useState(fallbackCategories);
  const [assets, setAssets] = useState([]);
  const [activeCategory, setActiveCategory] = useState("stocks");
  const [activeTheme, setActiveTheme] = useState("");

  // Progressive app-shell boot fade: when we arrive directly from onboarding
  // launch, the shell fades + cascades in once (calm, institutional reveal).
  const [booted, setBooted] = useState(() => !consumeLaunched());
  useEffect(() => {
    if (!booted) {
      const raf = requestAnimationFrame(() => setBooted(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [booted]);

  const [portfolio, setPortfolio] = useState(() => {
    // Authenticated users must NOT inherit stale guest/demo holdings from
    // localStorage — the backend bootstrap (setPortfolio(incomingHoldings))
    // repopulates live data. Only guests may seed the demo capability view.
    if (hasAuthToken()) return [];
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
  const [apiTradeExecutions, setApiTradeExecutions] = useState([]);
  const [workspaceNotifications, setWorkspaceNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [isNotificationInboxOpen, setIsNotificationInboxOpen] = useState(false);
  const [notificationCenterLoading, setNotificationCenterLoading] = useState(false);
  const [notificationCenterError, setNotificationCenterError] = useState("");
  const [notificationPrefs, setNotificationPrefs] = useState({
    transactionActivityPopups: false,
    depositWithdrawalPopups: true,
    sourceHealthAlerts: true,
    largeTransactionThreshold: 0,
    mutedSources: []
  });
  const notificationToastIdsRef = useRef(new Set());
  const notificationsSeededRef = useRef(false);
  const [homeMarketMovers, setHomeMarketMovers] = useState([]);
  const [homeMacroData, setHomeMacroData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [watchlistStale, setWatchlistStale] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState("");
  const [watchlistRetryNonce, setWatchlistRetryNonce] = useState(0);
  const [watchlistRefreshNonce, setWatchlistRefreshNonce] = useState(0);
  const [sharedWatchlistAccess, setSharedWatchlistAccess] = useState({ shared: false, allowed: true, requiredPlan: "starter" });
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
  const [journalThreadContext, setJournalThreadContext] = useState(null);
  const [alertBuilder, setAlertBuilder] = useState({ open: false, asset: null });
  const [compareDrawer, setCompareDrawer] = useState({ open: false, assets: [] });
  const [taxSubView, setTaxSubView] = useState(() => {
    if (typeof window === "undefined") return "tax";
    return localStorage.getItem("zenin_tax_subview") || "tax";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("zenin_tax_subview", taxSubView);
  }, [taxSubView]);
  const priceCacheRef = useRef(new Map());
  const portfolioRef = useRef([]);
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
    if (sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed) return;
    localStorage.setItem("zenin_watchlist_assets", JSON.stringify(Array.isArray(watchlistAssets) ? watchlistAssets : []));
  }, [sharedWatchlistAccess.allowed, sharedWatchlistAccess.shared, watchlistAssets]);

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
      console.count("fetchHomeMovers");
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
    const handlePopState = () => {
      const nextRoute = parseRouteFromLocation();
      setRouteState(nextRoute);
      if (nextRoute.type !== "company" && nextRoute.type !== "asset") {
        setCompanyRouteAsset(null);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Consume cross-desk deep-link intents (dispatched by Commodity Allocation Guidance).
  useEffect(() => {
    const onNav = (e) => {
      const detail = e?.detail || {};
      const kind = detail.kind;
      if (kind === "portfolio") { setActiveSection("Portfolio"); }
      else if (kind === "watchlist") { setActiveSection("Watchlist"); }
      else if (kind === "decisions") { setActiveSection("Intelligence"); }
      else if (kind === "equities") { if (detail.group) openCommodityResearch({ symbol: detail.group }); else setActiveSection("Analytics"); }
    };
    window.addEventListener("zenin:navigate", onNav);
    return () => window.removeEventListener("zenin:navigate", onNav);
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
    if (["commodity", "commodities", "metal", "metals"].includes(rawType) || rawCategory === "commodities") return "commodity";
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
            source: quote?.source || priceData?.providers?.[0]?.source || null,
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
        setWatchlistNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "Live market data is unavailable. Showing saved symbols without fresh prices.");
        setLoading(false);
      });
  }, [activeCategory, watchlistRetryNonce]);

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
    const category = String(asset?.category || "").toLowerCase();
    const marketType = String(asset?.marketType || "").toLowerCase();
    // Currency codes are macro research entities, but they are not indicators.
    // Keep explicit instrument identity ahead of the generic macro fallback so
    // USD/EUR cannot be dispatched into IndicatorCountryModal.
    if (raw === "currency" || category === "currencies") return "currency";
    if (["forex", "fx"].includes(raw) || marketType === "forex") return "forex";
    if (["stock", "stocks", "equity"].includes(raw)) return "stock";
    if (raw === "crypto") return "crypto";
    if (raw === "indicator" || category === "indicators") return "indicator";
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

  // ---- Onboarding lifecycle (single owner of launch + routing) ----
  // Explicit onboarding lifecycle state (spec state machine). Declared BEFORE
  // the handlers below so the callbacks' dependency arrays don't hit a TDZ.
  const [lifecycle, setLifecycle] = useState(LIFECYCLE.IN_PROGRESS);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [workspaceLaunched, setWorkspaceLaunched] = useState(false);

  // Structured launch-state snapshot (spec #1/#4 instrumentation).
  const logLaunchState = (label) => {
    console.log(`[lifecycle] ${label} | route=${routeState.type} launchState=${lifecycle} onboardingComplete=${onboardingComplete} workspaceReady=${workspaceLaunched} path=${typeof window !== "undefined" ? window.location.pathname : "?"}`);
  };

  // Persisted completion is authoritative: once onboarding is done, the router
  // must never leave the user stranded at /onboarding (fixes launch/route
  // desync across reloads).
  useEffect(() => {
    let alive = true;
    loadOnboardingComplete()
      .then((done) => { if (alive) setOnboardingComplete(Boolean(done)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const setPhase = (next) => {
    console.log(`[lifecycle] ${lifecycle} -> ${next}`);
    setLifecycle(next);
  };

  // Routes: COMPLETE -> BOOTSTRAPPING -> SUCCESS -> /app ; or FAILED -> modal.
  // Continue Anyway: bypass bootstrap entirely -> APP_LAUNCHED -> /app.
  // Retry: exactly one fresh bootstrap attempt.

  const goToApp = useCallback(() => {
    if (hasLaunchedWorkspaceRef.current) {
      console.log("[lifecycle] Launch workspace: already launched, skipping duplicate route transition");
      return;
    }
    logLaunchState("NAV pre");
    hasLaunchedWorkspaceRef.current = true;
    setWorkspaceLaunched(true);
    console.log("[lifecycle] Launching Workspace");
    console.log("[lifecycle] Navigating to /app");
    markLaunched();
    navigateToAppRoute();
    logLaunchState("NAV post");
  }, [navigateToAppRoute, logLaunchState]);

  // Called by OnboardingPage on completion. Persists completion, then runs the
  // (optional) bootstrap. The app launches on SUCCESS or on the 5s timeout;
  // bootstrap failure routes to the FAILED modal, not a trap.
  const onLaunchWorkspace = useCallback((plan) => {
    console.log("[lifecycle] Onboarding Complete");
    markOnboardingComplete({ selectedPlan: plan || null })
      .then(() => setOnboardingComplete(true))
      .catch(() => {});
    setPhase(LIFECYCLE.COMPLETE);
    setPhase(LIFECYCLE.BOOTSTRAPPING);
  }, [LIFECYCLE]);

  // Continue Anyway: skip remote bootstrap, enter the workspace immediately
  // using existing local state. Must NOT restart bootstrap or reopen the modal.
  const handleContinueAnyway = useCallback(() => {
    console.log("[lifecycle] Continue Anyway -> skip bootstrap, enter workspace");
    markOnboardingComplete()
      .then(() => setOnboardingComplete(true))
      .catch(() => {});
    setPhase(LIFECYCLE.APP_LAUNCHED);
    goToApp();
  }, [goToApp]);

  // Retry: exactly one fresh bootstrap attempt (debounced). No recursion.
  // refreshBootstrap is captured via a ref (declared by useAppBootstrap below)
  // to avoid a TDZ in this callback's dependency array.
  const handleRetry = useCallback(() => {
    if (lifecycle === LIFECYCLE.RETRYING) return; // debounce double-clicks
    console.log("[lifecycle] Retry -> one fresh bootstrap attempt");
    setPhase(LIFECYCLE.RETRYING);
    setPhase(LIFECYCLE.BOOTSTRAPPING);
    refreshBootstrapRef.current?.();
  }, [lifecycle]);

  // Router-authoritative redirect: onboarding completion is persisted, so the
  // router must never strand the user at /onboarding even if an in-memory flag
  // is lost (e.g. reload). This is the single source of truth for "you're done".
  useEffect(() => {
    if (onboardingComplete && routeState.type === "onboarding") {
      console.log("[lifecycle] onboardingComplete + at /onboarding -> redirect to /app");
      goToApp();
    }
  }, [onboardingComplete, routeState.type, goToApp]);

  // Spec #4: forbidden desync guard. If the workspace has launched but the
  // router still reports /onboarding (e.g. a popstate/location re-derive reset
  // routeState after launch), force a redirect to /app and log the offender.
  useEffect(() => {
    if (workspaceLaunched && routeState.type === "onboarding") {
      const offender = new Error().stack || "unknown";
      console.warn("[lifecycle] DESYNC DETECTED: workspaceLaunched=true but route=/onboarding -> force redirect to /app");
      console.warn(`[lifecycle] offending path: ${offender.split("\n").slice(1, 4).join(" <- ")}`);
      logLaunchState("DESYNC-force-redirect");
      goToApp();
    }
  }, [workspaceLaunched, routeState.type, goToApp, logLaunchState]);

  // Kind-aware comparison navigation (Watchlist Audit remediation §1/§2).
  // Accepts a legacy bare symbol (+ optional peer) OR a typed target
  // { symbol, kind, compareSymbol }. FX/currency → Currency ARW compare;
  // ETF → ETF Research compare; everything else → generic ComparisonWorkspace.
  const navigateToCompare = useCallback((input, maybeB = null) => {
    const target = normalizeCompareTarget(input, null);
    const symbol = target.symbol;
    if (!symbol) return;
    const compareSymbol = target.compareSymbol
      || (typeof maybeB === "string" && maybeB.trim() ? maybeB.trim().toUpperCase() : null);
    const kind = target.kind;

    // Contextual workspaces for etf / forex / currency.
    if (kind === "etf" || kind === "forex" || kind === "currency") {
      const routeKind = kind === "etf" ? "etf" : kind; // forex/currency both → currency ARW
      const r = buildAssetRoute("research", routeKind, symbol);
      if (r) {
        const view = "compare";
        const state = { view, compareSymbol: compareSymbol || null, kind };
        setSelectedAsset(null);
        setCompanyRouteAsset(null);
        setRouteState({ type: r.routeType, symbol: r.symbol, state });
        if (typeof window !== "undefined") {
          const q = new URLSearchParams({ view });
          if (compareSymbol) q.set("peer", compareSymbol);
          window.history.pushState({ page: r.routeType, symbol: r.symbol, state }, "", `${r.path}?${q.toString()}`);
        }
        return;
      }
    }

    // Generic comparison for stock / crypto / commodity / bond / indicator.
    const slug = compareSymbol ? `${symbol}-vs-${compareSymbol}` : `${symbol}`;
    const assets = [
      { symbol, type: kind || "equity" },
      compareSymbol ? { symbol: compareSymbol, type: kind || "equity" } : null
    ].filter(Boolean);
    setRouteState({ type: "compare", assets });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: "compare" }, "", `/app/compare/${slug}`);
    }
  }, []);

  // ── Indicator Modal action handlers (shared by IndicatorCountryModal +
  //     Watchlist → IndicatorMetricModal). Pure launcher contract: the modal
  //     emits these; App owns the real behavior. Local-only where no backend
  //     exists (pin/alert/export) — persisted to localStorage, confirmed via
  //     the in-app toast. No fabricated server state. ──────────────────────
  const LS_PIN = "zenin.indicatorPins";
  const LS_ALERT = "zenin.indicatorAlerts";
  const readLS = (k, fb) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; }
  };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // Asset-aware navigation state (Phase 1): every navigation preserves where
  // the user came from + which indicator initiated it, so the destination page
  // can preselect the correct context.
  const indicatorNavState = (code) => ({
    source: "indicator-modal",
    assetKind: "indicator",
    symbol: String(code).toUpperCase(),
    indicator: String(code).toUpperCase(),
  });

  const indicatorAssetShape = (code, label) => ({
    symbol: String(code || "").toUpperCase(),
    name: label,
    type: "indicator",
    category: "indicators",
    marketType: "macro",
    market: "Macro",
  });

  const indicatorIsPinned = (code) => {
    const pins = readLS(LS_PIN, []);
    return Array.isArray(pins) && pins.some((p) => String(p.code).toUpperCase() === String(code).toUpperCase());
  };

  const indicatorActions = {
    isInWatchlist: (asset) => isInWatchlist(indicatorAssetShape(asset?.symbol || asset, asset?.name)),
    onToggleStar: (asset) => { void toggleWatchlistStar(indicatorAssetShape(asset?.symbol || asset, asset?.name)); },
    onCompare: (asset) => {
      const a = typeof asset === "string" ? { kind: "indicator", symbol: asset } : asset || {};
      setCompareDrawer({ open: true, assets: [{ kind: a.kind || "indicator", symbol: String(a.symbol || "").toUpperCase(), metric: a.metric }] });
    },
    onOpenResearch: ({ symbol }) => {
      const r = buildAssetRoute("research", "indicator", String(symbol).toUpperCase());
      if (!r) return;
      setRouteState({ type: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) });
      window.history.pushState({ page: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) }, "", r.path);
    },
    onOpenProfile: ({ symbol }) => {
      const r = buildAssetRoute("profile", "indicator", String(symbol).toUpperCase());
      if (!r) return;
      setRouteState({ type: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) });
      window.history.pushState({ page: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) }, "", r.path);
    },
    onOpenTransmission: (node) => { try { openTransmissionExplorer(String(node || "").toUpperCase()); } catch {} },
    onPin: ({ code, label }) => {
      const pins = readLS(LS_PIN, []);
      const key = String(code).toUpperCase();
      const next = pins.some((p) => String(p.code).toUpperCase() === key)
        ? pins.filter((p) => String(p.code).toUpperCase() !== key)
        : [...pins, { code: key, label, pinnedAt: new Date().toISOString() }];
      writeLS(LS_PIN, next);
      setTradeToast({ id: Date.now(), type: next.length >= pins.length ? "success" : "info", message: next.some((p) => String(p.code).toUpperCase() === key) ? `${label || key} pinned.` : `${label || key} unpinned.` });
    },
    isPinned: (code) => indicatorIsPinned(code),
    onAlert: ({ code, label }) => {
      // Phase 5: open the Universal Alert Builder (real, registry-driven).
      setAlertBuilder({ open: true, asset: { kind: "indicator", symbol: String(code).toUpperCase(), label } });
    },
    onExport: ({ code, label, metric }) => {
      const rows = Array.isArray(metric?.series)
        ? metric.series.map((p) => ({ date: p.date || new Date(Number(p.ts)).toISOString().slice(0, 10), value: p.value }))
        : [];
      const csv = ["date,value", ...rows.map((r) => `${r.date},${r.value}`)].join("\n");
      const json = JSON.stringify({ code, label, source: metric?.source || "FRED", current: metric?.current ?? null, unit: metric?.unit ?? null, series: rows }, null, 2);
      const blobCsv = new Blob([csv], { type: "text/csv" });
      const blobJson = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blobCsv); a.download = `${String(code).toUpperCase()}.csv`; a.click();
      a.href = URL.createObjectURL(blobJson); a.download = `${String(code).toUpperCase()}.json`; a.click();
      setTradeToast({ id: Date.now(), type: "success", message: `Exported ${label || code} (CSV + JSON).` });
    },
    onCopyLink: ({ code, label }) => {
      const r = buildAssetRoute("research", "indicator", String(code).toUpperCase());
      const url = r ? `${window.location.origin}${r.path}` : window.location.href;
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => setTradeToast({ id: Date.now(), type: "success", message: "Indicator link copied." }),
          () => setTradeToast({ id: Date.now(), type: "info", message: url })
        );
      } else {
        setTradeToast({ id: Date.now(), type: "info", message: url });
      }
    },
    onDecisionLedger: ({ indicator }) => {
      setRouteState((prev) => ({ ...prev, type: "intelligence", indicatorContext: String(indicator).toUpperCase() }));
      setActiveSection("Intelligence");
    },
    onExposure: ({ indicator }) => {
      setRouteState((prev) => ({ ...prev, type: "portfolio", indicatorContext: String(indicator).toUpperCase() }));
      setActiveSection("Portfolio");
    },
    onJournal: ({ symbol }) => {
      setJournalThreadContext({ source: "indicator-modal", indicator: String(symbol).toUpperCase() });
      setActiveSection("Journal");
    },
    onScenario: ({ symbol }) => {
      // Scenario Lab lives within the Analytics / Macro workspace; route there
      // with the indicator preselected (asset-aware).
      setActiveSection("Analytics");
      setTradeToast({ id: Date.now(), type: "info", message: `Scenario Lab opened for ${symbol}.` });
    },
    onMacroWorkspace: ({ symbol }) => {
      const r = buildAssetRoute("research", "indicator", String(symbol).toUpperCase());
      if (r) {
        setRouteState({ type: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) });
        window.history.pushState({ page: r.routeType, symbol: r.symbol, state: indicatorNavState(symbol) }, "", r.path);
      }
      setActiveSection("Analytics");
    },
    onSelectIndicator: (code) => {
      // Reuse the same modal instance: replace the selected metric without
      // closing context. IndicatorCountryModal listens via this callback.
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("zenin:selectIndicator", { detail: { code: String(code).toUpperCase() } }));
    },
  };

  const syncGuestSectionUrl = useCallback((section) => {
    if (!isGuestQueryRequested() || typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = "/app";
    nextUrl.searchParams.set("guest", "1");
    nextUrl.searchParams.set("section", getGuestSectionSlug(section));
    window.history.replaceState({ page: "app", section }, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

  const openWorkspaceSection = useCallback((section, payload = null) => {
    const appSections = ["Home", "Portfolio", "Watchlist", "Research", "Analytics", "Intelligence", "Options", "Predictions", "Journal", "Tax Estimator"];
    if (!appSections.includes(section)) return;
    startTransition(() => {
      if (routeState.type === "company") navigateToAppRoute();
      if (section === "Home") setHomeSubview(null);
      if (section === "Journal" && payload) {
        setJournalThreadContext(payload);
      }
      setActiveSection(section);
      if (isGuestQueryRequested() && section !== "Home") {
        setGuestInteraction(section);
        setGuestActionFeedback(`${section} preview opened.`);
      }
    });
    syncGuestSectionUrl(section);
  }, [navigateToAppRoute, routeState.type, syncGuestSectionUrl]);

  const openAssetResearch = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol);
    if (!symbol) return;
    const r = buildAssetRoute("research", "stock", symbol);
    if (!r) return;
    startTransition(() => {
      setSelectedAsset(null);
      setCompanyRouteAsset(null);
      setRouteState({ type: r.routeType, symbol: r.symbol });
    });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
    }
  };

  // Host-provided navigation for the Intelligence cockpit. Replaces the
  // component's self-managed window.history.pushState so routing stays
  // consistent with App conventions (activeSection + routeState + URL sync).
  const navigateIntelligence = useCallback((payload = {}) => {
    const target = payload?.target || payload?.workspace || payload?.context;
    const event = payload?.event || null;
    const firstAffected = Array.isArray(event?.affectedAssets) ? event.affectedAssets[0] : null;
    const firstAffectedSymbol = typeof firstAffected === "string" ? firstAffected : firstAffected?.symbol;
    const symbol = normalizeSymbolKey(payload?.symbol || payload?.entity || event?.assets?.[0] || firstAffectedSymbol || "");
    const peerSymbol = normalizeSymbolKey(payload?.compareSymbol || payload?.peerSymbol || event?.assets?.[1] || "");
    if (target === "macro") {
      const label = payload?.country || payload?.symbol || "USA";
      const r = buildAssetRoute("research", "macro", label);
      if (r) startTransition(() => setRouteState({ type: r.routeType, symbol: r.symbol }));
      return;
    }
    if (target === "research") {
      openWorkspaceSection("Research", symbol ? { symbol } : null);
      return;
    }
    if (target === "transmission") {
      try { openTransmissionExplorer(String(symbol || "").toUpperCase()); } catch {}
      return;
    }
    if (target === "asset" && symbol) {
      openAssetResearch({ symbol });
      return;
    }
    if (target === "scenario") {
      startTransition(() => setTaxSubView("calculator"));
      openWorkspaceSection("Tax Estimator", {
        source: "intelligence",
        symbol,
        eventHeadline: event?.headline || event?.title || null,
        context: payload?.context || null,
      });
      return;
    }
    if (target === "journal") {
      openWorkspaceSection("Journal", {
        source: "intelligence",
        symbol,
        preThesis: event?.headline || event?.title || "Intelligence signal review",
        note: event?.summary || event?.detail || "",
        catalyst: event?.source || null,
        context: payload?.context || null,
      });
      return;
    }
    if (target === "alert") {
      if (!symbol) {
        setTradeToast({ id: Date.now(), type: "info", message: "Select an asset before creating an intelligence alert." });
        return;
      }
      setAlertBuilder({
        open: true,
        asset: {
          symbol,
          kind: payload?.kind || payload?.context || "intelligence",
          name: event?.headline || event?.title || symbol,
          source: "intelligence",
        },
      });
      return;
    }
    if (target === "watchlist-add") {
      if (!symbol) {
        openWorkspaceSection("Watchlist");
        return;
      }
      startTransition(() => {
        setWatchlistPrompt({
          asset: {
            symbol,
            name: event?.headline || event?.title || symbol,
            type: payload?.kind || payload?.context || "stock",
            category: payload?.context === "commodity" ? "commodities" : "stocks",
            marketType: payload?.context === "commodity" ? "commodity" : "stock",
            theme: payload?.context || "intelligence",
          },
          category: payload?.context === "commodity" ? "commodities" : "stocks",
          theme: "intelligence",
          customTheme: "",
          error: "",
          submitting: false,
        });
      });
      return;
    }
    if (target === "compare") {
      if (!symbol) {
        setCompareDrawer({ open: true, assets: [] });
        return;
      }
      navigateToCompare({ symbol, kind: payload?.kind || "equity", compareSymbol: peerSymbol || null });
      return;
    }
    if (target && openWorkspaceSection && ["Home","Portfolio","Watchlist","Analytics","Intelligence","Options","Predictions","Journal","Tax Estimator"].includes(target)) {
      openWorkspaceSection(target);
    }
  }, [buildAssetRoute, openWorkspaceSection, openTransmissionExplorer, openAssetResearch, navigateToCompare, setRouteState]);

  const retryLiveData = useCallback(() => {
    setGuestRetryingLiveData(true);
    setWatchlistStale(false);
    setWatchlistNotice("Retrying live data. Saved rows stay visible while Zenin checks the feed.");
    setGuestActionFeedback("Checking the live feed. Saved demo data stays visible while Zenin retries.");
    setWatchlistRetryNonce((value) => value + 1);
    const timer = typeof window !== "undefined" ? window : globalThis;
    timer.setTimeout(() => {
      setGuestRetryingLiveData(false);
    }, 1400);
  }, []);

  const shareGuestSection = useCallback(async (section) => {
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = "/app";
    nextUrl.searchParams.set("guest", "1");
    nextUrl.searchParams.set("section", getGuestSectionSlug(section));
    const shareUrl = `${nextUrl.origin}${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    try {
      if (!navigator?.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareUrl);
      setGuestActionFeedback(`${section} guest link copied.`);
    } catch {
      window.history.replaceState({ page: "app", section }, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      setGuestActionFeedback(`${section} guest link is ready in the address bar.`);
    }
  }, []);

  const openCompanyProfile = (asset) => {
    if (!asset || normalizeAssetType(asset) !== "stock") return;
    const symbol = normalizeSymbolKey(asset.symbol);
    if (!symbol) return;
    const r = buildAssetRoute("profile", "stock", symbol);
    if (!r) return;
    setCompanyRouteAsset(asset);
    setSelectedAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
    }
  };

  const openCommodityResearch = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol || asset);
    if (!symbol) return;
    const r = buildAssetRoute("research", "commodity", symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
    }
  };

  const openCommodityProfile = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol || asset);
    if (!symbol) return;
    const r = buildAssetRoute("profile", "commodity", symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
    }
  };

  const openEtfResearch = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol || asset);
    if (!symbol) return;
    const r = buildAssetRoute("research", "etf", symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol, state: asset?.view ? { view: asset.view } : undefined });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol, state: asset?.view ? { view: asset.view } : undefined }, "", r.path);
    }
  };

  const openEtfProfile = (asset) => {
    const symbol = normalizeSymbolKey(asset?.symbol || asset);
    if (!symbol) return;
    const r = buildAssetRoute("profile", "etf", symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
    }
  };

  // Currency / FX — route by registry result, never by manual route strings.
  // FX pair => forex kind (Currency ARW, pair mode); currency code => currency kind.
  const openCurrencyResearch = (asset) => {
    const symbol = normalizeInstrumentSymbol(asset?.symbol || asset);
    if (!symbol) return;
    const inst = resolveCurrencyInstrument(symbol);
    const kind = inst ? inst.kind : "currency"; // "forex" | "currency"
    const r = buildAssetRoute("research", kind, symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol, state: asset?.view ? { view: asset.view } : undefined });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol, state: asset?.view ? { view: asset.view } : undefined }, "", r.path);
    }
  };

  const openCurrencyProfile = (asset) => {
    const symbol = normalizeInstrumentSymbol(asset?.symbol || asset);
    if (!symbol) return;
    const inst = resolveCurrencyInstrument(symbol);
    const kind = inst ? inst.kind : "currency";
    const r = buildAssetRoute("profile", kind, symbol);
    if (!r) return;
    setSelectedAsset(null);
    setCompanyRouteAsset(null);
    setRouteState({ type: r.routeType, symbol: r.symbol });
    if (typeof window !== "undefined") {
      window.history.pushState({ page: r.routeType, symbol: r.symbol }, "", r.path);
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
    startTransition(() => {
      setWatchlistPrompt({
        asset,
        category: defaultCategory,
        theme: defaultTheme,
        customTheme: "",
        error: "",
        submitting: false
      });
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
      const stableBalance = Object.entries(nextCashBalances)
        .reduce((sum, [cur, amt]) => USD_STABLE_EQUIVALENTS.has(cur) ? sum + Number(amt || 0) : sum, 0);
      if (stableBalance > 0) {
        setBalance(stableBalance);
      }
      return nextCashBalances;
    } catch (error) {
      console.warn("Cash balance refresh failed.", error);
      return null;
    }
  }, []);

  const refreshWorkspaceNotifications = useCallback(async ({ toastNew = false } = {}) => {
    console.count("refreshNotifications");
    if (!hasAuthToken()) return [];
    setNotificationCenterLoading(true);
    setNotificationCenterError("");
    try {
      const res = await zeninFetch("/notifications?limit=50");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Notifications refresh failed (${res.status})`);
      }
      const incoming = Array.isArray(data?.notifications) ? data.notifications : [];
      setWorkspaceNotifications(incoming);
      setUnreadNotificationCount(Number(data?.unreadCount || incoming.filter((item) => !item?.readAt).length || 0));

      const nextIds = new Set(incoming.map((item) => String(item?.id || "")).filter(Boolean));
      if (toastNew && notificationsSeededRef.current) {
        const latestActionable = incoming.find((item) => (
          !item?.readAt
          && !notificationToastIdsRef.current.has(String(item?.id || ""))
          && isActionableWorkspaceNotification(item)
        ));
        if (latestActionable) {
          showTradeToast(latestActionable.title || "New workspace notification", notificationToastTone(latestActionable));
        }
      }
      notificationToastIdsRef.current = nextIds;
      notificationsSeededRef.current = true;
      return incoming;
    } catch (error) {
      console.warn("Notifications refresh failed.", error);
      setNotificationCenterError(error?.message || "Zenin could not refresh workspace notifications.");
      return [];
    } finally {
      setNotificationCenterLoading(false);
    }
  }, []);

  // Merge an incoming realtime notification into the inbox (deduped by id) and
  // update the unread badge. Popup is decided by the event's metadata.popup flag
  // (server-driven) AND the user's notification preferences.
  const mergeRealtimeNotification = useCallback((notification) => {
    if (!notification || notification.id == null) return;
    const id = Number(notification.id);
    setWorkspaceNotifications((prev) => {
      if (prev.some((n) => Number(n.id) === id)) return prev; // already present
      const next = [notification, ...prev];
      const unread = next.filter((n) => !n.readAt).length;
      setUnreadNotificationCount(unread);
      return next;
    });
    const meta = notification?.metadata || {};
    const provider = String(meta.provider || "").toLowerCase();
    const txnType = String(meta.transactionType || "").toLowerCase();
    const large = meta.large === true;
    const muted = Array.isArray(notificationPrefs.mutedSources) && notificationPrefs.mutedSources.map(String).includes(provider);

    let allowPopup = meta.popup === true;
    // User preferences can override the server's conservative popup policy for
    // transaction types. The server defaults buys/sells/fills to popup=false
    // (bulk sync is noise), but users who opt in via transactionActivityPopups
    // want real-time execution toasts even for single trades.
    if (!allowPopup && txnType && ["buy", "sell", "fill", "dividend", "interest", "fee", "adjustment"].includes(txnType)) {
      allowPopup = !!notificationPrefs.transactionActivityPopups;
    }
    if (allowPopup && muted) allowPopup = false;
    if (allowPopup && txnType && (txnType === "deposit" || txnType === "withdrawal" || txnType === "transfer")) {
      allowPopup = notificationPrefs.depositWithdrawalPopups !== false;
    }
    if (allowPopup && (meta.category === "portfolio-sync" || /auth|stale|recover|fail/i.test(String(meta.type || "")))) {
      allowPopup = !!notificationPrefs.sourceHealthAlerts;
    }
    if (allowPopup && large && notificationPrefs.largeTransactionThreshold > 0) {
      allowPopup = Number(meta.notional || 0) >= Number(notificationPrefs.largeTransactionThreshold);
    }

    if (allowPopup && !notification.readAt && notificationsSeededRef.current) {
      showTradeToast(notification.title || "New workspace notification", notificationToastTone(notification));
    }
  }, [notificationPrefs]);

  const loadNotificationPrefs = useCallback(async () => {
    try {
      const data = await zeninFetchJson("/db/workspace/docs/notificationPreferences", { timeoutMs: 6000 }).catch(() => null);
      const doc = data && data.document && typeof data.document === "object" ? data.document : {};
      setNotificationPrefs((prev) => ({ ...prev, ...doc }));
    } catch {
      /* keep defaults */
    }
  }, []);

  const markWorkspaceNotificationRead = useCallback(async (notification) => {
    const notificationId = Number(notification?.id);
    if (!Number.isInteger(notificationId) || notification?.readAt) return;
    const readAt = new Date().toISOString();
    setWorkspaceNotifications((current) => current.map((item) => (
      Number(item?.id) === notificationId ? { ...item, readAt } : item
    )));
    setUnreadNotificationCount((current) => Math.max(0, current - 1));
    try {
      const response = await zeninFetch(`/notifications/${notificationId}/read`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Notification could not be marked as read.");
    } catch (error) {
      setNotificationCenterError(error?.message || "Notification could not be marked as read.");
      void refreshWorkspaceNotifications();
    }
  }, [refreshWorkspaceNotifications]);

  const markAllWorkspaceNotificationsRead = useCallback(async () => {
    if (!unreadNotificationCount) return;
    const readAt = new Date().toISOString();
    setWorkspaceNotifications((current) => current.map((item) => item?.readAt ? item : { ...item, readAt }));
    setUnreadNotificationCount(0);
    try {
      const response = await zeninFetch("/notifications/read-all", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Notifications could not be marked as read.");
    } catch (error) {
      setNotificationCenterError(error?.message || "Notifications could not be marked as read.");
      void refreshWorkspaceNotifications();
    }
  }, [refreshWorkspaceNotifications, unreadNotificationCount]);

  const navigateFromWorkspaceNotification = useCallback(async (notification) => {
    await markWorkspaceNotificationRead(notification);
    setIsNotificationCenterOpen(false);
    const actionUrl = String(notification?.actionUrl || notification?.metadata?.actionUrl || "").trim();
    if (actionUrl && typeof window !== "undefined") {
      try {
        const target = new URL(actionUrl, window.location.origin);
        if (target.origin === window.location.origin && target.pathname === "/app") {
          const section = String(target.searchParams.get("section") || "").toLowerCase();
          const tab = String(target.searchParams.get("tab") || "").toLowerCase();
          if (section === "settings") {
            if (tab === "accounts") openConnectedAccounts();
            else openAccountSettings();
            return;
          }
          const labelMap = {
            home: "Home", portfolio: "Portfolio", watchlist: "Watchlist",
            research: "Research", analytics: "Analytics", intelligence: "Intelligence", options: "Options",
            predictions: "Predictions", journal: "Journal", tax: "Tax Estimator"
          };
          if (labelMap[section]) {
            openWorkspaceSection(labelMap[section]);
            return;
          }
        }
        if (/^https?:/i.test(actionUrl)) {
          window.open(actionUrl, "_blank", "noopener,noreferrer");
          return;
        }
      } catch {
        // Malformed deep links fall through to the semantic section fallback.
      }
    }

    const type = String(notification?.type || "").toLowerCase();
    if (type.startsWith("account_sync")) openConnectedAccounts();
    else if (type.includes("journal")) openWorkspaceSection("Journal");
    else if (type.includes("research") || type.includes("document")) openWorkspaceSection("Research");
    else if (type.includes("trade") || type.includes("execution") || type.includes("risk") || type.includes("rebalance")) openWorkspaceSection("Portfolio");
    else if (type.includes("market") || type.includes("watchlist") || type.includes("price")) openWorkspaceSection("Watchlist");
    else openWorkspaceSection("Home");
  }, [markWorkspaceNotificationRead, openWorkspaceSection]);

  useEffect(() => {
    if (!hasAuthToken()) return undefined;
    const timer = window.setInterval(() => {
      void refreshWorkspaceNotifications({ toastNew: true });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshWorkspaceNotifications]);

  const refreshApiTradeExecutions = useCallback(async () => {
    if (!hasAuthToken()) return [];
    try {
      const res = await zeninFetch("/db/trade-executions?limit=250");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Execution history refresh failed (${res.status})`);
      }
      const incoming = Array.isArray(data?.executions)
        ? data.executions.map((execution, idx) => normalizeApiExecutionRecord(execution, idx)).filter((execution) => execution.platform && execution.quantity > 0)
        : [];
      setApiTradeExecutions(incoming);
      return incoming;
    } catch (error) {
      console.warn("API execution history refresh failed.", error);
      return [];
    }
  }, []);

  const refreshTradingWorkspaceState = useCallback(async () => {
    if (!hasAuthToken()) return null;
    const [cashRes, holdingsRes, tradesRes, feeSummaryRes, executionsRes, notificationsRes] = await Promise.all([
      zeninFetch("/db/cash"),
      zeninFetch("/db/portfolio"),
      zeninFetch("/db/trades?limit=1000"),
      zeninFetch("/db/trade-fees/summary"),
      zeninFetch("/db/trade-executions?limit=250"),
      zeninFetch("/notifications?limit=50")
    ]);

    const [cashData, holdingsData, tradesData, feeSummaryData, executionsData, notificationsData] = await Promise.all([
      cashRes.json().catch(() => ({})),
      holdingsRes.json().catch(() => ({})),
      tradesRes.json().catch(() => ({})),
      feeSummaryRes.json().catch(() => ({})),
      executionsRes.json().catch(() => ({})),
      notificationsRes.json().catch(() => ({}))
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
    if (!executionsRes.ok) {
      throw new Error(executionsData?.error || `Execution history refresh failed (${executionsRes.status})`);
    }
    if (!notificationsRes.ok) {
      throw new Error(notificationsData?.error || `Notifications refresh failed (${notificationsRes.status})`);
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
    const incomingApiExecutions = Array.isArray(executionsData?.executions)
      ? executionsData.executions.map((execution, idx) => normalizeApiExecutionRecord(execution, idx)).filter((execution) => execution.platform && execution.quantity > 0)
      : [];
    const incomingNotifications = Array.isArray(notificationsData?.notifications) ? notificationsData.notifications : [];

    setCashBalances(nextCashBalances);
    const stableBalance = Object.entries(nextCashBalances)
      .reduce((sum, [cur, amt]) => USD_STABLE_EQUIVALENTS.has(cur) ? sum + Number(amt || 0) : sum, 0);
    if (stableBalance > 0) {
      setBalance(stableBalance);
    }
    setPortfolio(incomingHoldings);
    setActiveOptionsTrades(
      incomingHoldings
        .filter((holding) => holding && String(holding.marketType || "").toLowerCase() === "options")
        .map(mapOptionHoldingToTrade)
        .filter(Boolean)
    );
    setTrades(incomingTrades);
    setApiTradeExecutions(incomingApiExecutions);
    setTradeFeeSummary(feeSummaryData?.summary || null);
    setWorkspaceNotifications(incomingNotifications);
    setUnreadNotificationCount(Number(notificationsData?.unreadCount || incomingNotifications.filter((item) => !item?.readAt).length || 0));

    return {
      balances: nextCashBalances,
      holdings: incomingHoldings,
      trades: incomingTrades,
      executions: incomingApiExecutions,
      feeSummary: feeSummaryData?.summary || null,
      notifications: incomingNotifications
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
        message: "There are no actionable rebalance changes right now."
      };
    }

    const summary = actionableRows.reduce((acc, row) => {
      acc.tradeCount += 1;
      acc.notional += Math.abs(Number(row?.tradeValue || 0));
      return acc;
    }, { tradeCount: 0, notional: 0, fees: 0, slippage: 0, totalCostImpact: 0 });

    return {
      ok: true,
      mode: hasAuthToken() ? "saved" : "guest-preview",
      trades: [],
      summary,
      message: "Rebalance plan saved for research review."
    };
  }, []);

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

  // Unified multi-source portfolio read model (Phase C). Degrades gracefully:
  // when the backend summary is unavailable, isUnified is false and we fall back
  // to the legacy locally-computed value below. Preferring the unified total when
  // present rewires every surface that consumes calculatePortfolioValue at once.
  const unified = useUnifiedPortfolio();
  const unifiedPortfolioValue = unified.isUnified ? unified.totalValue : null;


  const totalOptionsPnL = useMemo(() => {
    return activeOptionsTrades.reduce((total, trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      return total + (metrics.pnl || 0);
    }, 0);
  }, [activeOptionsTrades, multiChainCache, spotPrices]);

  const calculatePortfolioValue = () =>
    resolveHeadlineValue({ unified, legacyEquity: portfolioMarketValue });

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
          const res = await zeninFetch(
            `/prices?type=${encodeURIComponent(type)}&symbols=${encodeURIComponent(batch.join(","))}`
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
          priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null,
          source: quote?.source || null
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
          priceChangePercent: quote.priceChangePercent ?? holding.priceChangePercent,
          priceSource: quote.source ?? holding.priceSource
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
    if (sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed) {
      setWatchlistNotice(`Upgrade to ${formatPlanLabel(sharedWatchlistAccess.requiredPlan || "desk")} to manage this shared watchlist.`);
      return false;
    }
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

  const importWatchlistAssets = async (incomingAssets = [], meta = {}) => {
    if (sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed) {
      const message = `Upgrade to ${formatPlanLabel(sharedWatchlistAccess.requiredPlan || "desk")} to import into this shared watchlist.`;
      setWatchlistNotice(message);
      throw new Error(message);
    }

    const normalizedAssets = mergeWatchlistEntries([], incomingAssets)
      .map((asset) => ({
        symbol: normalizeSymbolKey(asset.symbol),
        name: String(asset.name || asset.symbol || "").trim() || normalizeSymbolKey(asset.symbol),
        type: normalizeAssetType(asset),
        category: String(asset.category || activeCategory || "").trim().toLowerCase() || null,
        theme: String(asset.theme || "").trim() || null,
        marketType: resolveMarketType(asset),
        date_added: asset.date_added || new Date().toISOString()
      }))
      .filter((asset) => asset.symbol);

    if (!normalizedAssets.length) {
      throw new Error("No valid watchlist rows were found in that import.");
    }

    const beforeKeys = new Set((Array.isArray(watchlistAssets) ? watchlistAssets : []).map((asset) => getAssetCatalogKey(asset)));
    const nextAssets = mergeAssetPrices(mergeWatchlistEntries(watchlistAssets, normalizedAssets), watchlistAssets);
    const importedCount = nextAssets.filter((asset) => !beforeKeys.has(getAssetCatalogKey(asset))).length;
    setWatchlistAssets(nextAssets);
    setWatchlistStale(false);
    setWatchlistNotice(`${normalizedAssets.length} row${normalizedAssets.length === 1 ? "" : "s"} imported${meta?.source ? ` from ${meta.source}` : ""}.`);

    // Skip backend sync when running in dev full-access, guest, or unauthenticated mode.
    if (!hasAuthToken() || isGuestUser || devFullAccess) {
      // Persist to resilient cache so imported assets survive page reloads.
      try {
        const cacheParams = { category: String(activeCategory || "").toLowerCase() || "stocks" };
        const cached = readResilientCache("watchlist-category", cacheParams);
        const existing = Array.isArray(cached?.payload?.assets) ? cached.payload.assets : [];
        const merged = [...existing];
        normalizedAssets.forEach((asset) => {
          if (!merged.some((a) => String(a.symbol || "").toLowerCase() === String(asset.symbol || "").toLowerCase())) {
            merged.push(asset);
          }
        });
        writeResilientCache("watchlist-category", cacheParams, {
          category: cacheParams.category,
          assets: merged,
          stale: true,
          stale_reason: "import_pending_sync"
        });
      } catch {}
      return { imported: normalizedAssets.length, saved: false };
    }

    try {
      const res = await zeninFetch(`/db/watchlist/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assets: normalizedAssets })
      });
      if (!res.ok) throw new Error(`Watchlist import failed: ${res.status}`);
      const data = await res.json();
      const savedAssets = Array.isArray(data?.assets) ? data.assets : [];
      if (savedAssets.length) {
        setWatchlistAssets((prev) => mergeAssetPrices(mergeWatchlistEntries(prev, savedAssets), prev));
      }
      return { imported: normalizedAssets.length, added: importedCount, saved: true };
    } catch (error) {
      console.warn("Watchlist import saved locally; backend sync failed.", error);
      // Persist the merged list to resilient cache so imports survive page reloads
      // even when the backend is unreachable (dev mode, cold start, etc.).
      try {
        const cacheParams = { category: String(activeCategory || "").toLowerCase() || "stocks" };
        const cached = readResilientCache("watchlist-category", cacheParams);
        const existing = Array.isArray(cached?.payload?.assets) ? cached.payload.assets : [];
        const merged = [...existing];
        normalizedAssets.forEach((asset) => {
          if (!merged.some((a) => String(a.symbol || "").toLowerCase() === String(asset.symbol || "").toLowerCase())) {
            merged.push(asset);
          }
        });
        writeResilientCache("watchlist-category", cacheParams, {
          category: cacheParams.category,
          assets: merged,
          stale: true,
          stale_reason: "import_pending_sync"
        });
      } catch (cacheError) {
        console.warn("Could not persist import to offline cache.", cacheError);
      }
      // Enqueue the failed import so it will be replayed when the backend
      // becomes reachable (next manual refresh or next successful sync).
      try { enqueueImportSync(normalizedAssets); } catch {}
      setWatchlistStale(true);
      setWatchlistNotice("Imported locally. Zenin could not sync the batch to the backend yet.");
      return { imported: normalizedAssets.length, added: importedCount, saved: false };
    }
  };
  // ponytail: replay queue — flushes pending watchlist imports on manual refresh.
  const handleRefreshWatchlist = useCallback(async () => {
    if (hasPendingImportSync()) {
      const result = await flushImportSyncQueue();
      if (result.syncedBatches > 0) {
        setWatchlistNotice(
          `Synced ${result.syncedBatches} import batch${result.syncedBatches > 1 ? "es" : ""} (${result.totalAssets} asset${result.totalAssets !== 1 ? "s" : ""}) to the backend.`
        );
        if (result.failedBatches > 0) {
          setWatchlistNotice(
            (prev) =>
              `${prev} ${result.failedBatches} batch${result.failedBatches > 1 ? "es" : ""} queued for retry.`
          );
        }
      } else if (result.failedBatches > 0) {
        setWatchlistNotice(`Backend unreachable — ${result.failedBatches} import batch${result.failedBatches > 1 ? "es" : ""} still queued.`);
      }
      // Force a category re-fetch so the watchlist reflects synced data.
      setWatchlistRefreshNonce((prev) => prev + 1);
    }
  }, []);

  const removeFromWatchlist = async ({ symbol, marketType, category = null, theme = null }) => {
    if (sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed) {
      setWatchlistNotice(`Upgrade to ${formatPlanLabel(sharedWatchlistAccess.requiredPlan || "desk")} to manage this shared watchlist.`);
      return false;
    }
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

  const submitWatchlistPrompt = async (opts = {}) => {
    if (!watchlistPrompt?.asset) return;

    // New modal passes { theme, category, mode }; fall back to prompt state for
    // legacy callers. Category is optional (grouping only); theme is required.
    const selectedTheme = formatThemeLabel(
      opts.theme || watchlistPrompt.customTheme || watchlistPrompt.theme
    );
    const selectedCategory =
      String(opts.category ?? watchlistPrompt.category ?? "").trim().toLowerCase() ||
      String(watchlistPrompt.asset.category || "").trim().toLowerCase() ||
      "stocks";
    const mode = opts.mode || "add";

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
      // Registry-driven, kind-aware: preserve the asset's real kind/market rather
      // than forcing "stock" (keeps the commodity + future-kind paths honest).
      const promptAsset = watchlistPrompt.asset;
      const resolvedType = normalizeAssetType(promptAsset) || promptAsset.type || "stock";
      const assetForWatchlist = {
        ...promptAsset,
        category: selectedCategory,
        theme: selectedTheme,
        type: resolvedType,
        marketType: promptAsset.marketType || resolveMarketType(promptAsset),
      };
      const added = await addToWatchlist(assetForWatchlist);
      if (!added) {
        setWatchlistPrompt((prev) => ({ ...prev, submitting: false, error: "Could not add asset to watchlist. Please try again." }));
        return;
      }
      setWatchlistPrompt(null);
      if (mode === "addOpen") {
        setActiveSection("Watchlist");
        setActiveCategory(selectedCategory);
        setActiveTheme(selectedTheme);
      }
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
      ...(Array.isArray(portfolioWithEntry) ? portfolioWithEntry : [])
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
  }, [routeState, companyRouteAsset, watchlistAssets, assets, portfolioWithEntry]);

  const isCommodityRouteAsset = Boolean(
    selectedAsset && (selectedAsset.type === "commodity" || selectedAsset.marketType === "commodity" || selectedAsset.category === "commodities")
  );

  const isEtfRouteAsset = Boolean(
    selectedAsset && (selectedAsset.type === "etf" || selectedAsset.marketType === "etf" || selectedAsset.category === "etfs")
  );

  const sections = ["Home", "Portfolio", "Watchlist", "Research", "Analytics", "Intelligence", "Options", "Predictions", "Journal", "Tax Estimator"];
  const savedSection = typeof window !== "undefined" ? localStorage.getItem("zenin_active_section") : null;
  const [homeSubview, setHomeSubview] = useState(() => savedSection === "Metrics" ? "metrics" : null);
  const [analyticsInitialTab, setAnalyticsInitialTab] = useState(null);
  const [activeSection, setActiveSection] = useState(() => {
    if (typeof window !== "undefined" && isGuestQueryRequested()) {
      const requestedSection = getSectionFromGuestSlug(new URLSearchParams(window.location.search).get("section"), sections);
      if (requestedSection) return requestedSection;
    }
    // New users land on Home; returning users keep their saved section.
    return sections.includes(savedSection) ? savedSection : "Home";
  });
  // Transmission Explorer deep-link resolver (Phase 0/D3). Maps typed {type,label}
  // intents to registry-correct SPA routes. Declared after setActiveSection exists.
  const handleTransmissionNavigate = useCallback((target) => {
    if (!target) return;
    const label = String(target.label || "").trim().toUpperCase();
    const type = String(target.type || "").toLowerCase();
    if (type === "commodity" && label) openCommodityResearch({ symbol: label });
    else if ((type === "company" || type === "equities" || type === "stock") && label) openCompanyProfile({ symbol: label });
    else if (type === "portfolio" || type === "equities") setActiveSection("Portfolio");
    else if (type === "macro") setActiveSection("Analytics");
    else if (type === "watchlist") setActiveSection("Watchlist");
  }, [openCommodityResearch, openCompanyProfile, setActiveSection]);
  const [guestInteraction, setGuestInteraction] = useState("");
  const [guestActionFeedback, setGuestActionFeedback] = useState("");
  const [guestRetryingLiveData, setGuestRetryingLiveData] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 960);
  // Derived visual collapse state for readability across the component.
  const isSidebarVisuallyCollapsed = isSidebarCollapsed;
  // Live viewport metrics drive auto-collapse on resize + hamburger visibility on every render.
  const viewportWidth = useViewportWidth();
  const isDesktopWideEnoughForExpandedRail = useMediaQuery("(min-width: 961px)");
  // Auto-collapse on laptop/tablet without losing the user's manual override:
  //   * If the viewport shrinks below the breakpoint, force the rail collapsed.
  //   * If it grows back above the breakpoint, automatically expand again,
  //     unless the user's last manual action was to collapse it (we track that intent).
  const sidebarManualCollapseRef = useRef(false);
  useEffect(() => {
    if (!isDesktopWideEnoughForExpandedRail && !isSidebarCollapsed) {
      setIsSidebarCollapsed(true);
    } else if (isDesktopWideEnoughForExpandedRail && isSidebarCollapsed && !sidebarManualCollapseRef.current) {
      setIsSidebarCollapsed(false);
    }
  }, [isDesktopWideEnoughForExpandedRail]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSidebarCollapse = useCallback(() => {
    sidebarManualCollapseRef.current = true;
    setIsSidebarCollapsed((prev) => !prev);
  }, []);
  // Escape-closes the sidebar drawer on mobile (≤960).
  

  useEffect(() => {
    if (isSidebarVisuallyCollapsed || viewportWidth > 960) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const handler = (event) => {
      if (event.key === "Escape") setIsSidebarCollapsed(true);
    };
    window.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handler);
    };
  }, [isSidebarVisuallyCollapsed, viewportWidth]);
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem("zenin_email") || "user@zenin.app");
  const [simulatePlan, setSimulatePlan] = useState(() => localStorage.getItem("zenin_simulate_plan") || "");
  // A signed-in user must never get the guest/dev-full-access demo view.
  // zenin_auth_user is written to localStorage on every successful sign-in,
  // so its presence is a TDZ-safe (in-scope) auth signal here. Combined with
  // the flag being cleared on sign-in (see sign-in handler), this guarantees
  // authenticated users render live workspace data, not the May-24 snapshot.
  const devFullAccess = useMemo(() => {
    try { if (localStorage.getItem("zenin_auth_user")) return false; } catch {}
    return isDevFullAccessEnabled();
  }, []);
  const explicitGuestAccess = useMemo(() => isGuestQueryRequested(), []);
  const allowGuestAccess = useMemo(() => devFullAccess || isGuestAccessRequested(), [devFullAccess]);
  const [accessCheckLoading, setAccessCheckLoading] = useState(true);
  // Single-owner launch guard: the workspace route transition fires exactly once.
  const hasLaunchedWorkspaceRef = useRef(false);

  const [bootPhase, setBootPhase] = useState("checking_session");
  const [showDetailedBootPhase, setShowDetailedBootPhase] = useState(false);
  // Reserved shell slot: future right-hand context panel. Defaults off — renders nothing today.
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [accountPlanLabel, setAccountPlanLabel] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (devFullAccess) return "Developer";
      if (!parsed) return getGuestWorkspaceLabel();
      if (isAdminUser(parsed)) return "Admin";
      return formatPlanLabel(parsed?.currentPlan, parsed?.currentBillingCycle);
    } catch {
      return getGuestWorkspaceLabel();
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
      if (devFullAccess) return "desk";
      return normalizeCurrentPlan(parsed?.currentPlan);
    } catch {
      return "starter";
    }
  });
  const [isAdmin, setIsAdmin] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (devFullAccess) return true;
      return isAdminUser(parsed);
    } catch {
      return false;
    }
  });
  const [authUserId, setAuthUserId] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (devFullAccess) return "dev-full-access";
      return parsed?.id != null ? String(parsed.id) : "";
    } catch {
      return "";
    }
  });
  const [authDisplayName, setAuthDisplayName] = useState(() => {
    try {
      const rawUser = localStorage.getItem("zenin_auth_user");
      const parsed = rawUser ? JSON.parse(rawUser) : null;
      if (devFullAccess) return "Developer";
      return String(parsed?.displayName || "").trim();
    } catch {
      return "";
    }
  });
  const [isGuestUser, setIsGuestUser] = useState(() => (devFullAccess ? false : allowGuestAccess));
  const isExplicitGuestMode = explicitGuestAccess && isGuestUser;

  // Active workspace object for workspace-scoped data.
  

  const dispatchWatchlistAlertEmail = useCallback(async (asset, intent) => {
    if (intent !== "alert") return;
    if (isExplicitGuestMode || isGuestUser) {
      setWatchlistNotice("Sign in with a verified email to dispatch watchlist alert emails.");
      return;
    }

    const symbol = normalizeSymbolKey(asset?.symbol || "");
    if (!symbol) {
      setWatchlistNotice("Select an asset before dispatching a watchlist alert email.");
      return;
    }

    const change = Number(asset?.priceChangePercent);
    const hasChange = Number.isFinite(change);
    const changeText = hasChange ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "needs review";
    const assetName = asset?.name ? `${asset.name} (${symbol})` : symbol;

    try {
      const result = await zeninFetchJson("/api/alerts/dispatch", {
        method: "POST",
        body: JSON.stringify({
          type: "watchlist",
          symbol,
          severity: hasChange && Math.abs(change) >= 5 ? "warning" : "review",
          source: "watchlist",
          title: `${symbol} watchlist alert`,
          body: `${assetName} triggered a watchlist alert. Latest move: ${changeText}. Thesis: ${asset?.theme || asset?.category || "Unassigned"}.`,
          asset: {
            symbol,
            name: asset?.name || "",
            marketType: asset?.marketType || "",
            type: asset?.type || "",
            category: asset?.category || "",
            theme: asset?.theme || "",
            priceChangePercent: hasChange ? change : null
          }
        })
      });
      setWatchlistNotice(result?.delivery?.sent
        ? `Watchlist alert email sent for ${symbol}.`
        : `Watchlist alert email queued for ${symbol}.`);
    } catch (error) {
      setWatchlistNotice(error?.message || `Watchlist alert email could not be sent for ${symbol}.`);
    }
  }, [isExplicitGuestMode, isGuestUser]);

  const [workspaceAlertAssignments, setWorkspaceAlertAssignments] = useState([]);
  const [workspaceAlertsLoading, setWorkspaceAlertsLoading] = useState(false);
  const loadWorkspaceAlertAssignments = useCallback(async () => {
    if (isExplicitGuestMode || isGuestUser) return;
    setWorkspaceAlertsLoading(true);
    try {
      const data = await zeninFetchJson("/api/workspaces/current/alerts");
      setWorkspaceAlertAssignments(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      console.warn("Failed to load workspace alert assignments:", error?.message);
      setWorkspaceAlertAssignments([]);
    } finally {
      setWorkspaceAlertsLoading(false);
    }
  }, [isExplicitGuestMode, isGuestUser]);
  const updateWorkspaceAlertAssignment = useCallback(async (asset, update) => {
    if (isExplicitGuestMode || isGuestUser) {
      setWatchlistNotice("Sign in to manage workspace alert assignments.");
      return null;
    }
    const symbol = normalizeSymbolKey(asset?.symbol || "");
    if (!symbol) {
      setWatchlistNotice("Select an asset before updating its alert assignment.");
      return null;
    }
    const alertKey = `watchlist:${symbol}:${asset?.marketType || "spot"}:${asset?.category || activeCategory || "watchlist"}:${asset?.theme || "default"}`;
    const payload = {
      alertKey,
      status: update.status || "open",
      assignedToUserId: update.assignedToUserId ?? null,
      snoozedUntil: update.snoozedUntil || null,
      notes: {
        symbol,
        name: asset?.name || symbol,
        marketType: asset?.marketType || "",
        category: asset?.category || "",
        theme: asset?.theme || "",
        action: update.action || "manual"
      }
    };
    try {
      const result = await zeninFetchJson("/api/workspaces/current/alerts", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      await loadWorkspaceAlertAssignments();
      setWatchlistNotice(`${symbol} alert ${update.action || "updated"}.`);
      return result?.item || null;
    } catch (error) {
      setWatchlistNotice(error?.message || `Could not update alert assignment for ${symbol}.`);
      return null;
    }
  }, [isExplicitGuestMode, isGuestUser, activeCategory, loadWorkspaceAlertAssignments]);

  const promoteResearchToDecisionThread = useCallback(async ({ docId, title, symbol, summary, sourceType, sourceName }) => {
    if (isExplicitGuestMode || isGuestUser) {
      throw new Error("Sign in to promote research to a decision thread.");
    }
    const payload = {
      title: title || `${symbol || "Research"} decision thread`,
      symbol: symbol || null,
      sourceType: "research",
      sourceId: docId || null,
      linkedResearchId: docId || null,
      priority: "medium",
      status: "new"
    };
    const res = await zeninFetchJson("/api/decision-threads", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!res?.thread) throw new Error(res?.error || "Failed to create decision thread.");
    // Optionally seed a journal entry so the research summary is preserved.
    if (summary) {
      try {
        await zeninFetchJson(`/api/decision-threads/${res.thread.id}/create-journal-entry`, {
          method: "POST",
          body: JSON.stringify({
            content: summary,
            source: sourceName || "Research",
            sourceType: "research"
          })
        });
      } catch (journalError) {
        console.warn("Could not seed journal entry from research promotion:", journalError?.message);
      }
    }
    openWorkspaceSection("Intelligence");
    return res.thread;
  }, [isExplicitGuestMode, isGuestUser]);

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
  const [isProviderHealthOpen, setIsProviderHealthOpen] = useState(false);
  const settingsPanelRef = useRef(null);
  useEffect(() => {
    if (!isSettingsOpen) return undefined;
    const handler = (event) => {
      if (event.key !== "Escape") return;
      // Only react when nothing inside the modal has already captured Escape (e.g. an inline form).
      const panel = settingsPanelRef.current;
      if (panel && !panel.contains(event.target)) return;
      event.preventDefault();
      setIsSettingsOpen(false);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isSettingsOpen]);
  const [activeSettingsCategory, setActiveSettingsCategory] = useState("Profile");
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
  // Live density mapping: the Layout preset now drives html[data-density].
  useEffect(() => {
    if (typeof document === "undefined") return;
    const densityMap = { compact: "compact", cozy: "cozy", default: "cozy", comfortable: "comfortable", expanded: "comfortable", focus: "compact" };
    const density = densityMap[preferences?.layoutPreset] || "cozy";
    document.documentElement.setAttribute("data-density", density);
  }, [preferences?.layoutPreset]);

  // Workspace-aware plan gate. Pass-through today; will replace the per-section
  // accessibleSections memo as we wire each section's lock UI in Phase 3+.
  // Active workspace object for workspace-scoped data (declared before derived values).
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [isPersonaOnboardingOpen, setIsPersonaOnboardingOpen] = useState(false);
  const [personaSectionOrder, setPersonaSectionOrder] = useState(null);
  
  const planGate = usePlanGate({
    userPlan: currentPlan,
    workspacePlan: activeWorkspace?.currentPlan,
    isAdmin
  });

  const accessibleSections = useMemo(() => {
    const base = isGuestUser ? sections : sections.filter((section) => hasSectionAccessForUser(currentPlan, isAdmin, section));
    if (!personaSectionOrder || !Array.isArray(personaSectionOrder) || personaSectionOrder.length === 0) return base;
    const orderIndex = new Map(personaSectionOrder.map((s, i) => [s, i]));
    const ordered = [];
    for (const s of personaSectionOrder) {
      if (base.includes(s)) ordered.push(s);
    }
    for (const s of base) {
      if (!ordered.includes(s)) ordered.push(s);
    }
    return ordered;
  }, [sections, currentPlan, isAdmin, isGuestUser, personaSectionOrder]);
  const sidebarNavigationGroups = useMemo(() => {
    const hiddenRailSections = new Set(devFullAccess ? [] : isSidebarCollapsed ? ["Predictions"] : []);
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
  }, [accessibleSections, devFullAccess, isSidebarCollapsed]);
  const handleLogout = useCallback(async () => {
    const keysToRemove = [
      "zenin_auth_user",
      "zenin_auth_expires_at",
      "zenin_supabase_session_present",
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
      "zenin_post_auth_next",
      "zenin_guest_full_access"
    ];

    try {
      keysToRemove.forEach(key => localStorage.removeItem(key));
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(getConnectPromptSessionKey(authUserId));
      }
    } catch {
      // Continue with signout and redirect even when browser storage is unavailable.
    }

    try {
      await Promise.race([
        signOutEverywhere(),
        new Promise((resolve) => setTimeout(resolve, 900))
      ]);
    } catch {
      // Local auth state is already cleared; avoid trapping the user on a failed network request.
    } finally {
      window.location.replace("/");
    }
  }, [authUserId]);

  const {
    bootstrapData,
    bootstrapLoading,
    bootstrapError,
    refreshBootstrap
  } = useAppBootstrap({
    // Bootstrap runs ONLY while the lifecycle is actively bootstrapping/retrying
    // — never on every render, route change, or modal close.
    enabled: lifecycle === LIFECYCLE.BOOTSTRAPPING || lifecycle === LIFECYCLE.RETRYING,
    tradeLimit: 1000
  });
  // Capture refreshBootstrap for handleRetry without creating a forward-ref TDZ.
  const refreshBootstrapRef = useRef(null);
  refreshBootstrapRef.current = refreshBootstrap;

  // Drive lifecycle transitions from bootstrap outcome.
  useEffect(() => {
    if (lifecycle === LIFECYCLE.BOOTSTRAPPING || lifecycle === LIFECYCLE.RETRYING) {
      if (bootstrapError) {
        setPhase(LIFECYCLE.FAILED);
      } else if (bootstrapData) {
        setPhase(LIFECYCLE.SUCCESS);
        console.log("[lifecycle] APP_LAUNCHED");
        goToApp();
      }
    }
  }, [lifecycle, bootstrapError, bootstrapData, goToApp]);

  // Route-aware boot phase tracker: shows exact step copy when loading exceeds 2s.
  useEffect(() => {
    if (routeState.type === "app") {
      console.log("[lifecycle] Workspace Mounted");
      console.log("[lifecycle] Background services initializing asynchronously");
    }
  }, [routeState.type]);

  useEffect(() => {
    if (!accessCheckLoading) {
      setShowDetailedBootPhase(false);
      return;
    }
    const timer = setTimeout(() => setShowDetailedBootPhase(true), 2000);
    return () => clearTimeout(timer);
  }, [accessCheckLoading]);

  useEffect(() => {
    if (accessCheckLoading) {
      setBootPhase("checking_session");
    } else if (bootstrapLoading) {
      setBootPhase("loading_workspace");
    } else if (bootstrapData && !bootstrapError) {
      setBootPhase("syncing_market_data");
    }
  }, [accessCheckLoading, bootstrapLoading, bootstrapData, bootstrapError]);

  const bootPhaseCopy = (() => {
    switch (bootPhase) {
      case "loading_workspace": return "Loading workspace";
      case "syncing_market_data": return "Syncing market data";
      case "checking_session":
      default: return "Checking session";
    }
  })();

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
      if (devFullAccess) {
        const devUser = buildDevFullAccessUser();
        try {
          localStorage.setItem("zenin_email", devUser.email);
          localStorage.setItem("zenin_auth_user", JSON.stringify(devUser));
        } catch {}
        if (!mounted) return;
        setUserEmail(devUser.email);
        setIsAdmin(true);
        // Dev/full-access should behave like a signed-in admin user, not a guest.
        setIsGuestUser(false);
        setAuthUserId(String(devUser.id));
        setAuthDisplayName(devUser.displayName);
        setCurrentPlan("desk");
        setCurrentBillingCycle("monthly");
        setAccountPlanLabel("Developer");
        setProfileSecurity(profileSecurityFromUser(devUser, devUser.email));
        setActiveWorkspace(null);
        setWorkspaceMembers([]);
        setWorkspaceInvites([]);
        setWorkspaceActivity([]);
        settingsSyncReadyRef.current = false;
        clearGuestQueryFromAppUrl();
        setAccessCheckLoading(false);
        return;
      }

      try {
        let res = await zeninFetch("/auth/me", { timeoutMs: 3500 });
        let data = await res.json().catch(() => ({}));
        if (res.ok && (!data?.authenticated || !data?.user) && !allowGuestAccess) {
          const exchanged = await ensureZeninSessionFromSupabase();
          if (exchanged?.user) {
            res = await zeninFetch("/auth/me", { timeoutMs: 3500 });
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
          setAccountPlanLabel(getGuestWorkspaceLabel());
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
          clearGuestQueryFromAppUrl();
          setAuthUserId(data.user.id != null ? String(data.user.id) : "");
          // A real sign-in must never inherit the guest / dev-full-access
          // demo snapshot. Clear the flag so the app renders live workspace
          // data (not the May-24 guest saved-data view). Sign-out already
          // clears this; this closes the trap where a tab that clicked
          // "Continue as Guest" earlier keeps showing demo data after sign-in.
          try { localStorage.removeItem("zenin_guest_full_access"); } catch {}
          // A real sign-in must also clear stale guest/localStorage demo data so
          // the signed-in dashboard never renders inherited demo holdings (AAPL/
          // BTC) or the $10K default buying power. Sign-out already clears these;
          // clear them on sign-IN too so the demo snapshot can't bleed through.
          // Keep auth tokens (zenin_auth_*) and email intact.
          try {
            ["zenin_balance", "zenin_portfolio", "zenin_trades", "zenin_active_options_trades", "zenin_connected_accounts", "zenin_watchlist_assets"]
              .forEach((k) => { try { localStorage.removeItem(k); } catch {} });
          } catch {}
          // Reset in-memory demo state so stale holdings/$10K don't flash before
          // the backend bootstrap (setPortfolio/setBalance/...) repopulates live.
          try {
            if (typeof setPortfolio === "function") setPortfolio([]);
            if (typeof setTrades === "function") setTrades([]);
            if (typeof setActiveOptionsTrades === "function") setActiveOptionsTrades([]);
            if (typeof setConnectedAccounts === "function") setConnectedAccounts([]);
            if (typeof setBalance === "function") setBalance(0);
          } catch {}
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
        setAccountPlanLabel(getGuestWorkspaceLabel());
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
  }, [allowGuestAccess, devFullAccess]);

  useEffect(() => {
    if (accessCheckLoading) return undefined;
    if (isGuestUser) {
      settingsSyncReadyRef.current = false;
      setConnectedAccountsHydrated(true);
      return undefined;
    }
    // One-shot guard: load workspace settings exactly once (no re-fire on
    // dep churn). Prevents the settings:preferences GET storm.
    if (settingsLoadedRef.current) return undefined;
    settingsLoadedRef.current = true;

    let cancelled = false;
    settingsSyncReadyRef.current = false;
    setConnectedAccountsHydrated(false);

    const loadWorkspaceSettings = async () => {
      console.count("loadWorkspaceSettings");
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
    if (activeSection !== "Home" && homeSubview) {
      setHomeSubview(null);
    }
  }, [activeSection, homeSubview]);

  useEffect(() => {
    if (!bootstrapData) return;

    const incomingBalances = Array.isArray(bootstrapData?.balances) ? bootstrapData.balances : [];
    const incomingHoldings = Array.isArray(bootstrapData?.holdings) ? bootstrapData.holdings : [];
    const nextSharedWatchlistAccess = bootstrapData?.sharedWatchlistAccess && typeof bootstrapData.sharedWatchlistAccess === "object"
      ? {
        shared: !!bootstrapData.sharedWatchlistAccess.shared,
        allowed: bootstrapData.sharedWatchlistAccess.allowed !== false,
        requiredPlan: bootstrapData.sharedWatchlistAccess.requiredPlan || "desk"
      }
      : { shared: false, allowed: true, requiredPlan: "starter" };
    const sharedWatchlistLocked = nextSharedWatchlistAccess.shared && !nextSharedWatchlistAccess.allowed;
    const incomingWatchlist = !sharedWatchlistLocked && Array.isArray(bootstrapData?.watchlistAssets) ? bootstrapData.watchlistAssets : [];
    const incomingTrades = Array.isArray(bootstrapData?.trades)
      ? bootstrapData.trades.map((trade, idx) => normalizeTradeRecord(trade, idx)).filter((trade) => trade.quantity > 0)
      : [];
    const localWatchlist = sharedWatchlistLocked ? [] : readStoredArray("zenin_watchlist_assets");
    const mergedWatchlist = mergeWatchlistEntries(localWatchlist, incomingWatchlist);
    const backendKeys = new Set(incomingWatchlist.map((asset) => getAssetCatalogKey(asset)));
    const missingLocalAssets = localWatchlist.filter((asset) => !backendKeys.has(getAssetCatalogKey(asset)));
    if (sharedWatchlistLocked && typeof localStorage !== "undefined") {
      localStorage.removeItem("zenin_watchlist_assets");
    }

    startTransition(() => {
      const nextCashBalances = {};
      incomingBalances.forEach((row) => {
        const currency = String(row?.currency || "").trim().toUpperCase();
        const amount = Number(row?.balance);
        if (!currency || !Number.isFinite(amount)) return;
        nextCashBalances[currency] = amount;
      });
      setCashBalances(nextCashBalances);
      // Treat USD-pegged stablecoins (USD/USDT/USDC) as buying power so a
      // synced wallet holding USDC (not "USD") populates the headline balance
      // instead of leaving the $10K default.
      const STABLES = new Set(["USD", "USDT", "USDC"]);
      const stableTotal = Object.keys(nextCashBalances)
        .filter((c) => STABLES.has(c))
        .reduce((sum, c) => sum + (Number(nextCashBalances[c]) || 0), 0);
      if (stableTotal > 0) setBalance(stableTotal);

      setPortfolio(incomingHoldings);
      setActiveOptionsTrades(
        incomingHoldings
          .filter((holding) => holding && String(holding.marketType || "").toLowerCase() === "options")
          .map(mapOptionHoldingToTrade)
          .filter(Boolean)
      );
      setSharedWatchlistAccess(nextSharedWatchlistAccess);
      setWatchlistAssets((prev) => sharedWatchlistLocked ? [] : mergeAssetPrices(mergedWatchlist, prev));
      if (sharedWatchlistLocked) {
        setWatchlistNotice(`Shared Desk watchlists require ${formatPlanLabel(nextSharedWatchlistAccess.requiredPlan || "desk")} access. Showing read-only market context instead.`);
      }
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
          providerTrust: account.providerTrust || null,
          syncAvailable: account.syncAvailable !== false,
          connectionCapability: account.connectionCapability || buildClientConnectionCapability(account.extraData?.providerLabel || account.exchange),
          connectedAt: account.createdAt || null,
          lastSyncAt: account.lastSyncAt || null,
          lastSyncStatus: account.lastSyncStatus || "idle",
          lastSyncMeta: account.lastSyncMeta || {}
        })));
      }
      // Always merge unified-pipeline sources (Hyperliquid / Lighter / SnapTrade)
      // into Connected accounts so a user with BOTH a workspace account and a
      // unified source sees every connected source in one place. Dedup by
      // provider + sourceType so we never double-list. (Fixes the case where a
      // workspace account existed and unified sources were silently dropped.)
      if (unified?.isUnified && Array.isArray(unified.sources)) {
        setConnectedAccounts((prev) => {
          const base = prev.length ? prev : [];
          const seen = new Set(base.map((a) => `${a.venueType}-${String(a.provider).toLowerCase()}`));
          const fromUnified = unified.sources
            .filter((s) => s.sourceType !== "manual")
            .map((s) => ({
              id: `${s.sourceType}-${s.provider}`,
              provider: s.provider,
              exchange: s.provider,
              username: s.label || s.provider,
              venueType: s.sourceType === "brokerage" ? "broker" : s.sourceType === "wallet" ? "dex" : "cex",
              apiKeyMasked: "Synced via unified pipeline",
              providerTrust: { cannotTrade: true, cannotWithdraw: true },
              syncAvailable: true,
              connectedAt: null,
              lastSyncAt: s.lastSyncAt || null,
              lastSyncStatus: s.status || "synced",
              lastSyncMeta: {}
            }))
            .filter((u) => !seen.has(`${u.venueType}-${u.provider.toLowerCase()}`));
          return fromUnified.length ? [...base, ...fromUnified] : base;
        });
      }
      setCategories(
        Array.isArray(bootstrapData?.categories) && bootstrapData.categories.length
          ? withRequiredWatchlistCategories(bootstrapData.categories)
          : fallbackCategories
      );
    });

    if (!sharedWatchlistLocked && missingLocalAssets.length > 0) {
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
    if (bootstrapLoading || bootstrapError || isGuestUser || !hasAuthToken()) return;
    // One-shot guard: secondary (non-critical) data loads exactly once after
    // the workspace is visible — never re-fires on dep churn, no storm.
    if (secondaryBootstrappedRef.current) return;
    secondaryBootstrappedRef.current = true;
    void refreshApiTradeExecutions();
    void refreshWorkspaceNotifications();
    void loadNotificationPrefs();
  }, [bootstrapError, bootstrapLoading, isGuestUser, refreshApiTradeExecutions, refreshWorkspaceNotifications]);

  // Realtime notifications over SSE — opens after authenticated workspace bootstrap,
  // recreates on workspace switch/sign-out, merges into the inbox, updates the unread badge.
  useNotificationStream({
    activeWorkspaceId: activeWorkspace?.id,
    isAuthenticated: hasAuthToken(),
    onEvent: mergeRealtimeNotification
  });

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
  const [showBrokerageFlow, setShowBrokerageFlow] = useState(false);
  const [brokerageAccounts, setBrokerageAccounts] = useState([]);
  const [brokerageSummary, setBrokerageSummary] = useState(null);
  const [confirmRemoveAccount, setConfirmRemoveAccount] = useState(null);

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
  const settingsCategories = ["Profile", "Workspace", "Notifications", "Security", "Connected accounts", "Billing"];
  const settingsCategoryPanel = {
    Notifications: "Notification",
    Security: "Profile",
    "Connected accounts": "Accounts",
    Billing: "Subscription",
  };
  const activeSettingsPanel = settingsCategoryPanel[activeSettingsCategory] || activeSettingsCategory;
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
  const settingsLoadedRef = useRef(false);
  const secondaryBootstrappedRef = useRef(false);
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
    passkeyProvider: passkeyOptions[0] || "iCloud Keychain",
    deleteCurrentPassword: "",
    deleteConfirmEmail: "",
    deleteConfirmationPhrase: ""
  });
  const [supabaseSecurity, setSupabaseSecurity] = useState({
    loading: false,
    mfaFactors: [],
    verifiedTotpFactor: null,
    aal: null,
    identities: []
  });
  const [totpSetup, setTotpSetup] = useState({ factorId: "", secret: "", qrCodeDataUrl: "", loading: false });
  const [profileFeedback, setProfileFeedback] = useState({
    email: null,
    password: null,
    twofa: null,
    delete: null
  });
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
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
      body: "Browser notifications are enabled for market alerts, research updates, and workspace reminders."
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
      const res = await zeninFetch(`/api/account/plan`, {
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

  const setProfileMessage = (section, type, text) => {
    setProfileFeedback((prev) => ({ ...prev, [section]: { type, text } }));
  };

  const refreshSupabaseSecurity = useCallback(async ({ quiet = false } = {}) => {
    if (isGuestUser || !isSupabaseConfigured()) return;
    if (!quiet) {
      setSupabaseSecurity((prev) => ({ ...prev, loading: true }));
    }
    try {
      const [mfaState, identities] = await Promise.all([
        getSupabaseMfaState(),
        getSupabaseLinkedIdentities()
      ]);
      setSupabaseSecurity({
        loading: false,
        mfaFactors: mfaState.factors,
        verifiedTotpFactor: mfaState.verifiedTotpFactor,
        aal: mfaState.aal,
        identities
      });
      const verifiedFactor = mfaState.verifiedTotpFactor;
      setProfileSecurity((prev) => ({
        ...prev,
        twoFactorEnabled: Boolean(verifiedFactor),
        twoFactorMethod: verifiedFactor ? "authenticator" : null,
        twoFactorProvider: verifiedFactor ? "Authenticator app" : null,
        twoFactorTarget: verifiedFactor?.friendly_name || verifiedFactor?.factor_type || "",
        twoFactorEnabledAt: verifiedFactor?.created_at || prev?.twoFactorEnabledAt || null,
        passkeys: [],
        backupCodes: []
      }));
    } catch (error) {
      setSupabaseSecurity((prev) => ({ ...prev, loading: false }));
      if (!quiet) {
        setProfileMessage("twofa", "error", error?.message || "Could not load security settings.");
      }
    }
  }, [isGuestUser]);

  const fetchTotpSetup = useCallback(async () => {
    if (isGuestUser) return;
    setTotpSetup((prev) => ({ ...prev, loading: true }));
    try {
      const enrollment = await startSupabaseTotpEnrollment({ friendlyName: "Zenin authenticator" });
      setTotpSetup({
        factorId: enrollment.factorId,
        secret: enrollment.secret,
        qrCodeDataUrl: getTotpQrSrc(enrollment.qrCode),
        loading: false
      });
      setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
      setProfileMessage("twofa", "info", "Scan the QR code, then enter the 6-digit code from your authenticator app.");
    } catch (error) {
      setTotpSetup((prev) => ({ ...prev, loading: false }));
      setProfileMessage("twofa", "error", error?.message || "Could not start authenticator setup.");
    }
  }, [isGuestUser]);

  useEffect(() => {
    if (accessCheckLoading || isGuestUser) return;
    void refreshSupabaseSecurity({ quiet: true });
  }, [accessCheckLoading, isGuestUser, refreshSupabaseSecurity]);

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

  // Load the brokerage (SnapTrade pilot) workspace summary when signed in.
  // Failures are non-fatal: an unavailable pilot simply yields an empty summary,
  // never a fabricated connection.
  const loadBrokerageSummary = useCallback(async (opts = {}) => {
    if (isGuestUser || !authUserId) return;
    try {
      const summary = await fetchBrokerageWorkspaceSummary();
      if (!summary) return;
      setBrokerageSummary(summary);
      setBrokerageAccounts(Array.isArray(summary.accounts) ? summary.accounts : []);
    } catch (err) {
      if (opts.silent) return; // pilot off / not eligible — expected, not an error surface
    }
  }, [isGuestUser, authUserId]);

  useEffect(() => {
    if (isGuestUser || !authUserId || !connectedAccountsHydrated) return;
    loadBrokerageSummary({ silent: true });
  }, [isGuestUser, authUserId, connectedAccountsHydrated, loadBrokerageSummary]);

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
  const selectedProviderIsHyperliquid = selectedProviderId === "hyperliquid" || selectedProviderId === "lighter";
  const selectedProviderCapability = buildClientConnectionCapability(accountForm.provider);
  const apiKeyFieldLabel = selectedProviderIsHyperliquid ? "Wallet address" : "API Key / Account ID";
  const apiKeyPlaceholder = selectedProviderIsHyperliquid
    ? "Enter public wallet address"
    : selectedProviderId === "interactive_brokers"
    ? "https://localhost:5000 (gateway URL) or IBKR account"
    : "Enter read-only API key or account ID";
  const showApiSecretField = (accountForm.venueType === "cex" && selectedProviderCanSync)
    || (accountForm.venueType === "broker" && selectedProviderId === "interactive_brokers");
  const selectedProviderIsComingSoon = COMING_SOON_PROVIDERS.has(selectedProviderId);
  const selectedProviderSyncLabel = selectedProviderCanSync
    ? "Live sync available"
    : selectedProviderIsComingSoon
      ? "Coming soon"
      : "Metadata only";
  const selectedProviderSyncHelp = selectedProviderCanSync
    ? "Zenin can pull holdings, balances, and fills with read-only access."
    : selectedProviderIsComingSoon
      ? "Live sync for this venue is on the roadmap — connect to reserve your spot; sync arrives in a future release."
      : selectedProviderCapability.supportMessage;

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

  // Persona-based onboarding: show once per signed-in user, before the connect prompt.
  useEffect(() => {
    if (accessCheckLoading || bootstrapLoading || isGuestUser || !authUserId) return;
    if (typeof sessionStorage === "undefined") return;
    const sessionKey = getPersonaPromptSessionKey(authUserId);
    if (sessionStorage.getItem(sessionKey) === "1") return;
    sessionStorage.setItem(sessionKey, "1");
    setIsPersonaOnboardingOpen(true);
  }, [accessCheckLoading, authUserId, bootstrapLoading, isGuestUser]);

  // Load saved persona section order from settings:preferences on first workspace load.
  useEffect(() => {
    if (accessCheckLoading || bootstrapLoading || isGuestUser || !authUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await zeninFetch("/db/workspace/docs/settings:preferences");
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const prefs = data?.doc && typeof data.doc === "object" ? data.doc : {};
        if (Array.isArray(prefs?.sectionOrder) && prefs.sectionOrder.length) {
          setPersonaSectionOrder(prefs.sectionOrder);
        } else if (prefs?.persona) {
          const order = getPersonaSectionOrder(prefs.persona);
          if (order) setPersonaSectionOrder(order);
        }
      } catch {
        // no-op
      }
    })();
    return () => { cancelled = true; };
  }, [accessCheckLoading, authUserId, bootstrapLoading, isGuestUser]);

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
        const submittedApiSecret = showApiSecretField ? accountForm.apiSecret.trim() : "";
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
          }
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
        const connectionCapability = addedKey.connectionCapability || buildClientConnectionCapability(accountForm.provider);
        const providerTrust = addedKey.providerTrust || null;
        const verifiedScopeStatus = providerTrust?.scopeStatus || (providerId === "hyperliquid" ? "verified_watch_only" : "scope_unverified");

        let syncPayload = { syncAvailable: false, message: "Connection saved." };
        if (canSyncProvider) {
          const syncRes = await zeninFetch(`/db/exchange-sync/${addedKey.id}`, { method: "POST" });
          syncPayload = await syncRes.json().catch(() => ({}));
          if (!syncRes.ok) {
            throw new Error(syncPayload.error || "Failed to sync exchange data");
          }
          if (Number(syncPayload?.newExecutionCount || 0) > 0) {
            showTradeToast(`${Number(syncPayload.newExecutionCount)} new API execution${Number(syncPayload.newExecutionCount) === 1 ? "" : "s"} synced from ${connectionLabel}.`, "success");
          }
        }

        // 3. Re-fetch workspace to update PortfolioContext
        try { await refreshBootstrap(); } catch { /* refetched on next bootstrap */ }
        try { await unified.refresh(); } catch { /* unified refresh is best-effort */ }
        if (canSyncProvider) {
          void refreshApiTradeExecutions();
          void refreshWorkspaceNotifications({ toastNew: false });
        }

        // 4. Update the local UI state for connected accounts
        const nextAccount = {
          id: addedKey.id,
          venueType: accountForm.venueType,
          provider: accountForm.provider,
          exchange: providerId,
          username: connectionLabel,
          apiKeyMasked: addedKey.apiKey,
          providerTrust: syncPayload?.providerTrust || providerTrust,
          syncAvailable: canSyncProvider,
          connectionCapability,
          connectedAt: new Date().toISOString(),
          lastSyncAt: canSyncProvider ? new Date().toISOString() : null,
          lastSyncStatus: canSyncProvider ? "success" : "sync_unavailable",
          lastSyncMeta: canSyncProvider ? syncPayload : { reason: connectionCapability.supportMessage }
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
          newExecutionCount: Number(syncPayload?.newExecutionCount || 0),
          message: canSyncProvider
            ? `Synced ${Number(syncPayload?.holdingsCount || 0)} holdings, ${Number(syncPayload?.tradesCount || 0)} fills, and ${Number(syncPayload?.newExecutionCount || 0)} new executions. Provider-side read-only scope ${verifiedScopeStatus === "scope_unverified" || verifiedScopeStatus === "provider_unverified" ? "is not verified for this provider." : "is verified."}`
            : connectionCapability.nextAction
        });
      } else {
        // Guest user fallback (localStorage)
        const masked = `${accountForm.apiKey.trim().slice(0, 4)}••••${accountForm.apiKey.trim().slice(-4)}`;
        const guestScopeStatus = selectedProviderIsHyperliquid ? "verified_watch_only" : "scope_unverified";
        const guestTrust = {
          provider: providerId,
          providerLabel: accountForm.provider,
          scopeStatus: guestScopeStatus,
          lastVerifiedAt: null,
          lastSyncedAt: null,
          lastSyncStatus: "never",
          permissionsDetected: {
            canReadBalances: false,
            canReadTrades: false,
            canReadOrders: false,
            canTrade: false,
            canWithdraw: false,
            isWatchOnly: selectedProviderIsHyperliquid
          },
          proofItems: [],
          cannotTrade: true,
          cannotWithdraw: true,
          message: selectedProviderIsHyperliquid
            ? "Public watch-only address. Zenin cannot trade or withdraw."
            : "Provider scope has not been verified server-side. Zenin cannot trade or withdraw."
        };
        const nextAccount = {
          id: Date.now(),
          venueType: accountForm.venueType,
          provider: accountForm.provider,
          exchange: providerId,
          username: connectionLabel,
          apiKeyMasked: masked,
          providerTrust: guestTrust,
          syncAvailable: canSyncProvider,
          connectionCapability: buildClientConnectionCapability(accountForm.provider),
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
          message: canSyncProvider
            ? "Connection saved in this browser. Sign in to run workspace sync."
            : "Connection saved in this browser as metadata. Live sync requires a provider adapter and workspace session."
        });
      }
    } catch (error) {
      console.error("Connected account sync failed:", error);
      setConnectAccountFeedback(error.message || "Failed to connect and sync account.");
    } finally {
      setIsSyncingAccount(false);
    }
  };

  const syncingAccountIds = useRef(new Set());
  const [syncingAccountIdsState, setSyncingAccountIdsState] = useState({});

  const handleAccountSync = async (acc) => {
    if (!acc?.id || isGuestUser) return;
    if (syncingAccountIds.current.has(acc.id)) return;
    syncingAccountIds.current.add(acc.id);
    setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: "syncing" }));
    try {
      const syncRes = await zeninFetch(`/db/exchange-sync/${acc.id}`, { method: "POST" });
      const syncPayload = await syncRes.json().catch(() => ({}));
      if (!syncRes.ok) {
        throw new Error(syncPayload.error || "Failed to sync exchange data");
      }
      setConnectedAccounts((prev) => prev.map((a) => a.id === acc.id ? {
        ...a,
        providerTrust: syncPayload?.providerTrust || a.providerTrust,
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "success",
        lastSyncMeta: syncPayload
      } : a));
      void refreshBootstrap();
      void unified.refresh();
      void refreshApiTradeExecutions();
      void refreshWorkspaceNotifications({ toastNew: false });
      setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: null }));
    } catch (error) {
      setConnectedAccounts((prev) => prev.map((a) => a.id === acc.id ? {
        ...a,
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "error",
        lastSyncMeta: { error: error.message || "Exchange sync failed" }
      } : a));
      setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: "error" }));
    } finally {
      syncingAccountIds.current.delete(acc.id);
    }
  };

  const handleAccountVerifyScope = async (acc) => {
    if (!acc?.id || isGuestUser) return;
    if (syncingAccountIds.current.has(acc.id)) return;
    syncingAccountIds.current.add(acc.id);
    setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: "verifying" }));
    try {
      const res = await zeninFetch(`/db/exchange-keys/${acc.id}/verify-scope`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || "Failed to verify scope");
      }
      setConnectedAccounts((prev) => prev.map((a) => a.id === acc.id ? {
        ...a,
        providerTrust: payload?.providerTrust || a.providerTrust
      } : a));
      setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: null }));
    } catch (error) {
      if (error?.message && /read-only|rejected|trading/i.test(error.message)) {
        setConnectedAccounts((prev) => prev.map((a) => a.id === acc.id ? {
          ...a,
          providerTrust: a.providerTrust ? {
            ...a.providerTrust,
            scopeStatus: "rejected_trade_enabled",
            message: error.message
          } : a.providerTrust
        } : a));
      }
      setSyncingAccountIdsState((prev) => ({ ...prev, [acc.id]: "error" }));
    } finally {
      syncingAccountIds.current.delete(acc.id);
    }
  };

  const handleAccountRemove = async (acc) => {
    if (!acc?.id) return;
    if (isGuestUser) {
      setConnectedAccounts((prev) => prev.filter((a) => a.id !== acc.id));
      return;
    }
    try {
      const res = await zeninFetch(`/db/exchange-keys/${acc.id}`, { method: "DELETE" });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to remove account");
      }
      setConnectedAccounts((prev) => prev.filter((a) => a.id !== acc.id));
      void refreshBootstrap();
      void refreshWorkspacePanel();
    } catch (error) {
      setConnectAccountFeedback(error.message || "Failed to remove account.");
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
      const res = await zeninFetch(`/api/account/plan`, {
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
      if (!password) {
        setProfileMessage("email", "error", "Current password is required.");
        return;
      }
      try {
        const res = await zeninFetch("/api/account/email/request", {
          method: "POST",
          body: JSON.stringify({ newEmail: nextEmail, currentPassword: password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Email change request failed.");
        }
        if (data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          setProfileSecurity(profileSecurityFromUser(data.user, data.user.email || profileSecurity.email || userEmail));
        } else {
          setProfileSecurity((prev) => ({
            ...prev,
            pendingEmail: nextEmail,
            pendingEmailRequestedAt: new Date().toISOString()
          }));
        }
        setProfileForms((prev) => ({ ...prev, newEmail: "", emailPassword: "", emailVerificationCode: "" }));
        const devCode = data?.devVerificationCode ? ` Dev code: ${data.devVerificationCode}.` : "";
        setProfileMessage(
          "email",
          "success",
          `${data?.message || `Verification code sent to ${nextEmail}.`} Enter the 6-digit code below to finish updating your sign-in email.${devCode}`
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
        const res = await zeninFetch("/api/account/email/confirm", {
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
    const currentPassword = profileForms.currentPassword.trim();
    const newPassword = profileForms.newPassword.trim();
    const confirmPassword = profileForms.confirmPassword.trim();

    if (!isGuestUser) {
      if (newPassword !== confirmPassword) {
        setProfileMessage("password", "error", "New password and confirmation do not match.");
        return;
      }
      try {
        if (!isSupabaseConfigured()) {
          throw new Error("Secure account authentication is not configured.");
        }
        if (newPassword.length < 10) {
          throw new Error("New password must be at least 10 characters.");
        }
        if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
          throw new Error("Use lowercase, uppercase, number, and symbol in your new password.");
        }
        const client = getSupabaseClient();
        const { error: authError } = await client.auth.updateUser({
          password: newPassword
        });
        if (authError) {
          throw authError;
        }
        setProfileSecurity((prev) => ({
          ...prev,
          passwordChangedAt: new Date().toISOString()
        }));
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
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setProfileMessage("password", "error", "Use lowercase, uppercase, number, and symbol in your new password.");
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

  const clearAccountStorage = useCallback(() => {
    const keysToRemove = [
      "zenin_auth_user",
      "zenin_auth_expires_at",
      "zenin_supabase_session_present",
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

    try {
      keysToRemove.forEach(key => localStorage.removeItem(key));
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(getConnectPromptSessionKey(authUserId));
      }
    } catch {
      // Continue even when browser storage is unavailable.
    }
  }, [authUserId]);

  const deleteAccount = async () => {
    if (isGuestUser) {
      setProfileMessage("delete", "error", "Sign in before deleting an account.");
      return;
    }

    const confirmEmail = String(profileForms.deleteConfirmEmail || "").trim().toLowerCase();
    const confirmationPhrase = String(profileForms.deleteConfirmationPhrase || "").trim();
    const currentPassword = String(profileForms.deleteCurrentPassword || "");

    if (confirmEmail !== String(profileSecurity.email || userEmail || "").trim().toLowerCase()) {
      setProfileMessage("delete", "error", "Enter your current account email to confirm deletion.");
      return;
    }
    if (confirmationPhrase !== "DELETE MY ACCOUNT") {
      setProfileMessage("delete", "error", "Type DELETE MY ACCOUNT exactly to continue.");
      return;
    }

    setIsDeletingAccount(true);
    setProfileMessage("delete", "info", "Deleting account...");
    try {
      const res = await zeninFetch("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ currentPassword, confirmEmail, confirmationPhrase })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const workspaceNames = Array.isArray(data?.workspaces)
          ? data.workspaces.map((workspace) => workspace.name).filter(Boolean).join(", ")
          : "";
        const suffix = workspaceNames ? ` Affected workspace: ${workspaceNames}.` : "";
        throw new Error(`${data?.error || "Account deletion failed."}${suffix}`);
      }
      clearAccountStorage();
      window.location.replace("/");
    } catch (error) {
      setProfileMessage("delete", "error", error?.message || "Account deletion failed.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const enableTwoFactor = async () => {
    if (!isGuestUser) {
      const code = String(profileForms.twoFactorCode || "").trim();
      if (!totpSetup.factorId) {
      setProfileMessage("twofa", "error", "Generate and scan an authenticator app QR code first.");
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setProfileMessage("twofa", "error", "Enter the 6-digit code from your authenticator app.");
        return;
      }
      try {
        await verifySupabaseTotpEnrollment({ factorId: totpSetup.factorId, code });
        setTotpSetup({ factorId: "", secret: "", qrCodeDataUrl: "", loading: false });
        setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
        await refreshSupabaseSecurity();
        setProfileMessage("twofa", "success", "Authenticator app MFA is enabled for your account.");
      } catch (error) {
        setProfileMessage("twofa", "error", error?.message || "Could not verify the authenticator code.");
      }
      return;
    }
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

  const registerPasskey = async () => {
    if (isGuestUser) {
      setProfileMessage("twofa", "info", "Sign in to manage passkeys for your account.");
      return;
    }

    const passkeyName = profileForms.passkeyName.trim();
    if (passkeyName.length < 2) {
      setProfileMessage("twofa", "error", "Passkey name must be at least 2 characters.");
      return;
    }

    try {
      setProfileMessage("twofa", "info", "Starting passkey registration...");
      const options = await zeninFetchJson("/api/auth/passkeys/register/generate-options");

      const attestationResponse = await startRegistration(options);

      const verify = await zeninFetchJson("/api/auth/passkeys/register/verify", {
        method: "POST",
        body: JSON.stringify({ response: attestationResponse, name: passkeyName, provider: profileForms.passkeyProvider })
      });

      if (verify?.success) {
        const updatedUser = verify.user || null;
        if (updatedUser) {
          setProfileSecurity((prev) => ({
            ...prev,
            twoFactorEnabled: Boolean(updatedUser.twoFactorEnabled),
            twoFactorMethod: updatedUser.twoFactorMethod || "passkey",
            twoFactorProvider: updatedUser.twoFactorProvider || profileForms.passkeyProvider,
            twoFactorTarget: updatedUser.twoFactorTarget || passkeyName,
            twoFactorEnabledAt: updatedUser.twoFactorEnabledAt || new Date().toISOString(),
            passkeys: Array.isArray(updatedUser.passkeys) ? updatedUser.passkeys : prev.passkeys,
            backupCodes: prev.backupCodes.length ? prev.backupCodes : (verify.backupCodes || prev.backupCodes)
          }));
        } else {
          setProfileSecurity((prev) => ({
            ...prev,
            twoFactorEnabled: true,
            twoFactorMethod: "passkey",
            twoFactorProvider: profileForms.passkeyProvider,
            twoFactorTarget: passkeyName,
            twoFactorEnabledAt: new Date().toISOString(),
            passkeys: [{ id: Date.now(), name: passkeyName, provider: profileForms.passkeyProvider, createdAt: new Date().toISOString() }, ...(Array.isArray(prev.passkeys) ? prev.passkeys : [])],
            backupCodes: prev.backupCodes.length ? prev.backupCodes : (verify.backupCodes || createBackupCodes())
          }));
        }

        setProfileForms((prev) => ({ ...prev, passkeyName: "Primary Device" }));
        setProfileMessage("twofa", "success", `Passkey "${passkeyName}" registered.`);
      } else {
        throw new Error(verify?.error || "Passkey registration failed.");
      }
    } catch (error) {
      setProfileMessage("twofa", "error", error?.message || "Could not register passkey.");
    }
  };

  const regenerateBackupCodes = async () => {
    if (!isGuestUser) {
      setProfileMessage("twofa", "info", "TOTP does not expose Zenin-managed backup codes here. Keep a recovery path through your email provider and password recovery.");
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
    setProfileSecurity((prev) => ({ ...prev, backupCodes: createBackupCodes() }));
    setProfileMessage("twofa", "success", "Backup codes regenerated.");
  };

  const disableTwoFactor = async () => {
    if (!isGuestUser) {
      const factorId = supabaseSecurity.verifiedTotpFactor?.id;
      if (!factorId) {
        setProfileMessage("twofa", "error", "No verified authenticator factor is enabled for this account.");
        return;
      }
      try {
        await unenrollSupabaseMfaFactor(factorId);
        await refreshSupabaseSecurity();
        setProfileMessage("twofa", "info", "Authenticator app MFA was disabled for your account.");
      } catch (error) {
        setProfileMessage("twofa", "error", error?.message || "Could not disable authenticator MFA.");
      }
      return;
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

  const linkOAuthIdentity = async (provider) => {
    if (isGuestUser) return;
    try {
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/app` : undefined;
      const data = await linkSupabaseOAuthIdentity(provider, { redirectTo });
      if (data?.url && typeof window !== "undefined") {
        window.location.href = data.url;
        return;
      }
      await refreshSupabaseSecurity();
      setProfileMessage("twofa", "success", `${formatIdentityProvider(provider)} sign-in is linked.`);
    } catch (error) {
      setProfileMessage("twofa", "error", error?.message || `Could not link ${formatIdentityProvider(provider)}.`);
    }
  };

  const unlinkOAuthIdentity = async (identity) => {
    if (isGuestUser || !identity) return;
    try {
      await unlinkSupabaseOAuthIdentity(identity);
      await refreshSupabaseSecurity();
      setProfileMessage("twofa", "info", `${formatIdentityProvider(identity.provider)} sign-in was unlinked.`);
    } catch (error) {
      setProfileMessage("twofa", "error", error?.message || `Could not unlink ${formatIdentityProvider(identity.provider)}.`);
    }
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
  const canDeleteAccount = Boolean(
    !isGuestUser &&
    !isDeletingAccount &&
    String(profileForms?.deleteConfirmEmail || "").trim().toLowerCase() === String(profileSecurity.email || userEmail || "").trim().toLowerCase() &&
    String(profileForms?.deleteConfirmationPhrase || "").trim() === "DELETE MY ACCOUNT"
  );
  const canEnableTwoFactor = (() => {
    if (!isGuestUser) {
      return Boolean(totpSetup.factorId) && /^\d{6}$/.test(String(profileForms?.twoFactorCode || "").trim());
    }
    const method = String(profileForms?.twoFactorMethod || "authenticator");
    if (method === "passkey") {
      return Boolean(String(profileForms?.passkeyName || "").trim());
    }
    if (!/^\d{6}$/.test(String(profileForms?.twoFactorCode || "").trim())) return false;
    if (method === "sms") return String(profileForms?.phoneNumber || "").trim().length >= 8;
    if (method === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profileForms?.recoveryEmail || "").trim());
    return true;
  })();

  const settingsPreviewNote = "Workspace sync: profile, preferences, and connected-account metadata still save to your Zenin workspace. Identity now runs through the backend, while advanced MFA and passkey management are still being surfaced inside Zenin.";

  const sidebarIconMap = {
    Home: HomeIcon,
    Portfolio: PortfolioIcon,
    Watchlist: WatchlistIcon,
    Research: ResearchIcon,
    Analytics: AnalyticsIcon,
    Metrics: MetricsIcon,
    Options: OptionsIcon,
    Predictions: PredictionsIcon,
    Intelligence: IntelligenceIcon,
    Journal: JournalIcon,
    "Tax Estimator": TaxIcon
  };

  const sectionIcon = (section) => {
    const Icon = sidebarIconMap[section] || JournalIcon;
    return <Icon />;
  };

  // Command palette (⌘/Ctrl+K)
  const [commandPaletteOpen, setCommandPaletteOpen] = useCommandPaletteLauncher();
  const globalSearchTriggerRef = useRef(null);
  const notificationTriggerRef = useRef(null);
  const accountTriggerRef = useRef(null);
  const activeShellTriggerRef = useRef(null);

  const returnFocusToShellTrigger = useCallback(() => {
    window.setTimeout(() => activeShellTriggerRef.current?.focus(), 0);
  }, []);

  const openGlobalSearch = useCallback(() => {
    activeShellTriggerRef.current = globalSearchTriggerRef.current;
    if (viewportWidth <= 960) setIsSidebarCollapsed(true);
    setIsNotificationCenterOpen(false);
    setIsNotificationInboxOpen(false);
    setIsSettingsOpen(false);
    setCommandPaletteOpen(true);
  }, [setCommandPaletteOpen, viewportWidth]);

  const closeGlobalSearch = useCallback(() => {
    setCommandPaletteOpen(false);
    returnFocusToShellTrigger();
  }, [returnFocusToShellTrigger, setCommandPaletteOpen]);

  const openNotifications = useCallback(() => {
    activeShellTriggerRef.current = notificationTriggerRef.current;
    if (viewportWidth <= 960) setIsSidebarCollapsed(true);
    setCommandPaletteOpen(false);
    setIsSettingsOpen(false);
    setIsNotificationInboxOpen(false);
    setIsNotificationCenterOpen(true);
    void refreshWorkspaceNotifications();
  }, [refreshWorkspaceNotifications, setCommandPaletteOpen, viewportWidth]);

  const closeNotifications = useCallback(() => {
    setIsNotificationCenterOpen(false);
    returnFocusToShellTrigger();
  }, [returnFocusToShellTrigger]);

  // Debounced live asset search for the Command Palette. Fires curated
  // (instant) + backend (Yahoo stocks, CoinGecko/Hyperliquid crypto) with a
  // 180ms debounce so we don't hammer external APIs on each keystroke.
  const paletteSearchTimerRef = useRef(null);
  const debouncedSearchAssetsLive = useCallback((q) => {
    return new Promise((resolve) => {
      if (paletteSearchTimerRef.current) clearTimeout(paletteSearchTimerRef.current);
      paletteSearchTimerRef.current = setTimeout(() => {
        resolve(searchAssetsLive(q));
      }, 180);
    });
  }, []);

  const openAllNotifications = useCallback(() => {
    setIsNotificationCenterOpen(false);
    setIsNotificationInboxOpen(true);
    void refreshWorkspaceNotifications();
  }, [refreshWorkspaceNotifications]);

  const closeAllNotifications = useCallback(() => {
    setIsNotificationInboxOpen(false);
    returnFocusToShellTrigger();
  }, [returnFocusToShellTrigger]);

  const openAccountSettings = useCallback(() => {
    activeShellTriggerRef.current = accountTriggerRef.current;
    if (viewportWidth <= 960) setIsSidebarCollapsed(true);
    setCommandPaletteOpen(false);
    setIsNotificationCenterOpen(false);
    setIsNotificationInboxOpen(false);
    setActiveSettingsCategory("Profile");
    setIsSettingsOpen(true);
  }, [setCommandPaletteOpen, viewportWidth]);

  // Open Settings -> Accounts -> Connected Accounts so the user can retry a
  // failed sync or remove the connection before reconnecting. Used by
  // account-sync success/failure notification deep-links.
  const openConnectedAccounts = useCallback(() => {
    activeShellTriggerRef.current = accountTriggerRef.current;
    if (viewportWidth <= 960) setIsSidebarCollapsed(true);
    setCommandPaletteOpen(false);
    setIsNotificationCenterOpen(false);
    setIsNotificationInboxOpen(false);
    setActiveSettingsCategory("Accounts");
    setExpandedSettingsPanels((prev) => ({ ...prev, "accounts-connected": true }));
    setIsSettingsOpen(true);
  }, [setCommandPaletteOpen, viewportWidth]);

  const toggleSidebarFromNavbar = useCallback(() => {
    if (viewportWidth <= 960 && isSidebarVisuallyCollapsed) {
      setCommandPaletteOpen(false);
      setIsNotificationCenterOpen(false);
      setIsNotificationInboxOpen(false);
      setIsSettingsOpen(false);
    }
    toggleSidebarCollapse();
  }, [isSidebarVisuallyCollapsed, setCommandPaletteOpen, toggleSidebarCollapse, viewportWidth]);

  useEffect(() => {
    const handler = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        openGlobalSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openGlobalSearch]);
  const paletteCommands = useMemo(() => {
    const jump = (section) => () => openWorkspaceSection(section);
    const sectionCommands = accessibleSections
      .filter((section) => sections.includes(section))
      .map((section) => ({
        id: `nav-${section}`,
        group: "Jump to section",
        label: section,
        hint: SIDEBAR_SECTION_META?.[section]?.description || "",
        keywords: SIDEBAR_SECTION_META?.[section]?.eyebrow || "",
        shortcut: `g ${section.charAt(0).toLowerCase()}`,
        run: jump(section)
      }));
    const actionCommands = [
      {
        id: "open-settings",
        group: "Actions",
        label: "Open Settings (Control Bay)",
        hint: "Profile, workspace, preferences",
        shortcut: "Ctrl ,",
        run: () => setIsSettingsOpen(true)
      },
      {
        id: "toggle-sidebar",
        group: "Actions",
        label: isSidebarVisuallyCollapsed ? "Expand sidebar" : "Collapse sidebar",
        run: toggleSidebarCollapse
      },
      {
        id: "toggle-theme",
        group: "Actions",
        label: "Switch theme",
        run: () => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
      }
    ];
    return [...sectionCommands, ...actionCommands];
  }, [accessibleSections, isSidebarVisuallyCollapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alt+1–9 global shortcuts: jump to sections 1–9 (Home..Journal)
  useEffect(() => {
    const handler = (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const digit = Number(event.key);
      if (!Number.isFinite(digit) || digit < 1 || digit > 9) return;
      event.preventDefault();
      const visible = accessibleSections.filter((sec) => sections.includes(sec));
      const target = visible[digit - 1];
      if (target) openWorkspaceSection(target);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [accessibleSections, openWorkspaceSection]); // eslint-disable-line react-hooks/exhaustive-deps
  const usesWorkspaceShell = routeState.type !== "company";
  // Demo workspace disabled: guests now see the full app (real modules with
  // empty/placeholder states, since they have no backend session).
  const shouldRenderGuestPreview = false;
  const shouldShowConnectNudge = !isGuestUser && connectedAccountsHydrated && connectedAccounts.length === 0 && !(unified?.isUnified && (unified.sources?.length || 0) > 0);
  const sharedWatchlistLocked = sharedWatchlistAccess.shared && !sharedWatchlistAccess.allowed;
  const hasDeskFeatureAccess = isAdmin || normalizeCurrentPlan(currentPlan) === "desk";
  const hasProFeatureAccess = isAdmin || ["pro", "desk"].includes(normalizeCurrentPlan(currentPlan));
  // Gated-section lock: returns the required plan label if the user can't
  // access `section`, else null. Mirrors nav gating (hasSectionAccessForUser)
  // so the render block honors the same Pro/Desk tiers.
  const lockedFor = (section) => {
    if (hasSectionAccessForUser(currentPlan, isAdmin, section)) return null;
    return formatPlanLabel(requiredPlanForSection(section) || "pro");
  };
  const lockedWatchlistPreviewAssets = useMemo(() => (
    sharedWatchlistLocked
      ? mergeAssetPrices(getFallbackAssetsForCategory(activeCategory), assets)
      : watchlistAssets
  ), [activeCategory, assets, sharedWatchlistLocked, watchlistAssets]);
  const lockedWatchlistPlanLabel = formatPlanLabel(sharedWatchlistAccess.requiredPlan || "desk");
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

  if (lifecycle === LIFECYCLE.FAILED) {
    return (
      <div className="app-auth-loading" role="alertdialog" aria-live="polite">
        <div className="loading-state module-loading-state">
          <p style={{ marginBottom: 12 }}>Unable to initialize workspace.</p>
          <p style={{ marginBottom: 16, opacity: 0.7, fontSize: 13 }}>{bootstrapError}</p>
          <div className="connect-empty-actions">
            <button
              type="button"
              className="settings-primary-btn"
              onClick={handleContinueAnyway}
            >
              Continue anyway
            </button>
            <button
              type="button"
              className="settings-secondary-btn"
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (accessCheckLoading) {
    return (
      <div className="app-auth-loading" role="status" aria-live="polite">
        <div className="loading-state module-loading-state">
          {showDetailedBootPhase ? bootPhaseCopy : "Loading workspace..."}
        </div>
      </div>
    );
  }

  // Onboarding renders standalone — no application sidebar/chrome, so it
  // reads as a dedicated "Workspace Setup" journey, not an overlay.
  if (routeState.type === "onboarding") {
    return (
      <ToastProvider>
        <Suspense fallback={moduleLoadingFallback}>
          <OnboardingPage plan={routeState.plan} onLaunch={onLaunchWorkspace} />
        </Suspense>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
    <IndicatorActionsProvider value={indicatorActions}>
    <WorkspaceScopeProvider accounts={connectedAccounts}>
    <TransmissionExplorerProvider onNavigate={handleTransmissionNavigate}>
    <div className={`app-layout ${isSidebarVisuallyCollapsed ? "sidebar-is-collapsed" : ""} ${usesWorkspaceShell ? "app-layout-home" : ""} ${booted ? "ob-booted" : "ob-boot"}`}>
      {!isSidebarVisuallyCollapsed && viewportWidth <= 960 && (
        <div
          className="mobile-sidebar-scrim fixed inset-0 z-[1090] bg-black/55 backdrop-blur-[2px]"
          role="presentation"
          aria-hidden="true"
          onClick={() => setIsSidebarCollapsed(true)}
        />
      )}
      <aside id="zenin-primary-sidebar" className={`sidebar premium-operator-console sidebar-overhaul-v2 mobile-sidebar-panel ${isSidebarVisuallyCollapsed ? "collapsed" : "open"}`}>
        <TooltipProvider delayDuration={150}>
        <header className="sidebar-header sidebar-brand-row">
          {!isSidebarVisuallyCollapsed ? (
            <div className="sidebar-brand-left">
              <div className="sidebar-brand-mark"><ZeninLogo size="sm" showText={false} /></div>
              <div className="sidebar-brand-type">
                <span className="sidebar-brand-name">ZENIN</span>
              </div>
            </div>
          ) : (
            <div className="sidebar-collapsed-brand">
              <button
                type="button"
                className="sidebar-collapsed-mark"
                onClick={toggleSidebarFromNavbar}
                aria-label="Expand sidebar"
                aria-expanded="false"
                aria-controls="zenin-primary-sidebar"
              >
                <span className="sidebar-z-monogram" aria-hidden="true">Z</span>
              </button>
            </div>
          )}
          <button
            type="button"
            className="sidebar-collapse-toggle icon-button"
            onClick={toggleSidebarFromNavbar}
            aria-label={isSidebarVisuallyCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isSidebarVisuallyCollapsed}
            aria-controls="zenin-primary-sidebar"
          >
            <Menu aria-hidden="true" />
          </button>
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

                  const item = (
                    <a
                      key={section}
                      href={isExplicitGuestMode ? `/app?guest=1&section=${getGuestSectionSlug(section)}` : "#"}
                      className={`nav-btn ${isActiveSection ? "active" : ""}`}
                      onClick={isExplicitGuestMode ? undefined : (event) => {
                        if (!accessibleSections.includes(section)) return;
                        event.preventDefault();
                        openWorkspaceSection(section);
                      }}
                      title={section}
                      aria-current={isActiveSection ? "page" : undefined}
                    >
                      <span className="nav-icon-wrap">
                        <span className="nav-icon">{sectionIcon(section)}</span>
                      </span>
                      <span className="nav-copy">
                        <span className="nav-full">
                          {section}
                          {section === "Watchlist" && watchlistAssets.length > 0
                            ? ` (${watchlistAssets.length})`
                            : ""}
                        </span>
                        {isActiveSection && !isSidebarVisuallyCollapsed ? (
                          <span className="nav-description">{meta.description}</span>
                        ) : null}
                      </span>
                    </a>
                  );

                  return isSidebarVisuallyCollapsed ? (
                    <Tooltip key={section} side="right">
                      <TooltipTrigger asChild>{item}</TooltipTrigger>
                      <TooltipContent>{section}</TooltipContent>
                    </Tooltip>
                  ) : item;
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
            <span className="sidebar-live-rail" aria-hidden="true">
              <span className="sidebar-live-dot" />
              <span className="sidebar-live-mini-icon">
                <LiveRailIcon />
              </span>
            </span>
          )}
        </div>
        <div className="sidebar-bottom">
          {!isSidebarVisuallyCollapsed ? <div className="sidebar-section-header">SYSTEM</div> : null}
          <Tooltip side="right">
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            {isSidebarVisuallyCollapsed ? <TooltipContent>Theme</TooltipContent> : null}
          </Tooltip>

          <Tooltip side="right">
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            {isSidebarVisuallyCollapsed ? <TooltipContent>Logout</TooltipContent> : null}
          </Tooltip>
        </div>
        </TooltipProvider>
      </aside>
      {isSidebarVisuallyCollapsed && viewportWidth <= 960 ? (
        <button
          type="button"
          className="mobile-sidebar-launcher icon-button"
          onClick={toggleSidebarFromNavbar}
          aria-label="Open sidebar navigation"
          aria-expanded="false"
          aria-controls="zenin-primary-sidebar"
        >
          <Menu aria-hidden="true" />
        </button>
      ) : null}

      <div className="app-shell-main">
        <header className="global-top-navbar" aria-label="Workspace controls">
          <div className="global-top-navbar__context" aria-label={`Current section: ${activeSection}`}>
            <span>Zenin workspace</span>
            <strong>{activeSection}</strong>
          </div>
          <button
            ref={globalSearchTriggerRef}
            type="button"
            className="global-top-navbar__search"
            onClick={openGlobalSearch}
            aria-label="Open global search for assets, pages, and actions"
            aria-expanded={commandPaletteOpen}
            aria-controls="zenin-command-palette"
          >
            <Search aria-hidden="true" />
            <span>Search assets, pages, and actions…</span>
            <kbd aria-hidden="true">⌘K</kbd>
          </button>
          <div className="global-top-navbar__actions">
            <button
              ref={notificationTriggerRef}
              type="button"
              className="global-top-navbar__icon icon-button global-top-navbar__notification"
              onClick={isNotificationCenterOpen ? closeNotifications : openNotifications}
              aria-label={isNotificationCenterOpen ? "Close notifications" : (unreadNotificationCount ? `Open notifications, ${unreadNotificationCount} unread` : "Open notifications")}
              aria-expanded={isNotificationCenterOpen}
              aria-controls="zenin-notification-center"
            >
              <Bell aria-hidden="true" />
              {unreadNotificationCount ? <span className="global-top-navbar__badge" aria-hidden="true">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span> : null}
            </button>
            <button
              ref={accountTriggerRef}
              type="button"
              className="global-top-navbar__icon icon-button"
              onClick={openAccountSettings}
              aria-label="Open account settings"
              aria-expanded={isSettingsOpen}
              aria-controls="zenin-workspace-settings"
            >
              <AccountIcon aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className={`main-content ${usesWorkspaceShell ? "main-content-home" : ""}`}>
        {routeState.indicatorContext && routeState.type !== "decisions" && routeState.type !== "portfolio" ? (
          <div className="indicator-context-banner route-context-banner">
            <span>Viewing from <b>{String(routeState.indicatorContext).toUpperCase()}</b> · source: {routeState.source || "indicator-modal"}</span>
            <button type="button" className="link-btn" onClick={() => setActiveSection("Home")}>Clear</button>
          </div>
        ) : null}
        {routeState.type === "compare" ? (
          <div className="view-container cmp-view-container">
            <ComparisonWorkspace
              assets={routeState.assets || []}
              onBack={navigateToAppRoute}
              onNavigateCompare={(p) => navigateToCompare(p.a, p.b)}
              onViewResearch={(sym) => openAssetResearch({ symbol: sym })}
              onCloseModal={() => setSelectedAsset(null)}
            />
          </div>
        ) : routeState.type === "company" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CompanyProfilePage
                symbol={routeState.symbol}
                asset={routedCompanyAsset}
                onBack={navigateToAppRoute}
                onOpenResearch={openAssetResearch}
                onOpenCommodity={openCommodityResearch}
              />
            </Suspense>
          </div>
        ) : routeState.type === "onboarding" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <OnboardingPage plan={routeState.plan} />
            </Suspense>
          </div>
        ) : routeState.type === "asset" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <AssetResearchWorkspace
                symbol={routeState.symbol}
                asset={routedCompanyAsset}
                isInWatchlist={routedCompanyAsset?.isInWatchlist}
                view={routeState.state?.view}
                onOpenCompanyProfile={(a) => openCompanyProfile(a || { symbol: routeState.symbol })}
                onClose={navigateToAppRoute}
                onCompare={(target) => navigateToCompare(target || { symbol: routeState.symbol, kind: routeState.state?.kind || "stock" })}
              />
            </Suspense>
          </div>
        ) : routeState.type === "commodity" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <AssetResearchWorkspace
                kind="commodity"
                symbol={routeState.symbol}
                onOpenProfile={openCommodityProfile}
                onOpenCompanyProfile={openCompanyProfile}
                onClose={navigateToAppRoute}
                onCompare={(target) => navigateToCompare(target || { symbol: routeState.symbol, kind: "commodity" })}
              />
            </Suspense>
          </div>
        ) : routeState.type === "macro" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <MacroAssetWorkspace symbol={routeState.symbol || "USA"} onClose={navigateToAppRoute} onOpenEtf={openEtfResearch} />
            </Suspense>
          </div>
        ) : routeState.type === "macro-profile" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <MacroProfilePage symbol={routeState.symbol || "USA"} onClose={navigateToAppRoute} />
            </Suspense>
          </div>
        ) : routeState.type === "commodity-profile" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CompanyProfilePage
                kind="commodity"
                symbol={routeState.symbol}
                onBack={navigateToAppRoute}
                onOpenResearch={openCommodityResearch}
                onOpenCommodity={openCompanyProfile}
              />
            </Suspense>
          </div>
        ) : routeState.type === "etf" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <AssetResearchWorkspace
                kind="etf"
                symbol={routeState.symbol}
                view={routeState.state?.view}
                compareSymbol={routeState.state?.compareSymbol}
                onOpenProfile={openEtfProfile}
                onOpenCompanyProfile={openEtfResearch}
                onClose={navigateToAppRoute}
                onCompare={(target) => navigateToCompare(target || { symbol: routeState.symbol, kind: "etf" })}
                onOpenMacro={() => {
                  const r = buildAssetRoute("research", "macro", "USA");
                  if (r) setRouteState({ type: r.routeType, symbol: r.symbol });
                }}
                onOpenCountry={(label) => {
                  const r = buildAssetRoute("research", "macro", label);
                  if (r) setRouteState({ type: r.routeType, symbol: r.symbol });
                }}
                onOpenSector={(label) => {
                  const r = buildAssetRoute("research", "macro", "USA");
                  if (r) setRouteState({ type: r.routeType, symbol: r.symbol });
                }}
              />
            </Suspense>
          </div>
        ) : routeState.type === "etf-profile" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CompanyProfilePage
                kind="etf"
                symbol={routeState.symbol}
                onBack={navigateToAppRoute}
                onOpenResearch={openEtfResearch}
                onOpenCommodity={openEtfProfile}
              />
            </Suspense>
          </div>
        ) : routeState.type === "currency" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CurrencyResearchWorkspace
                symbol={routeState.symbol}
                mode={resolveCurrencyInstrument(routeState.symbol)?.kind === "forex" ? "pair" : "currency"}
                view={routeState.state?.view}
                compareSymbol={routeState.state?.compareSymbol}
                onClose={navigateToAppRoute}
                onOpenProfile={openCurrencyProfile}
                onCompare={(target) => navigateToCompare(target || { symbol: routeState.symbol, kind: resolveCurrencyInstrument(routeState.symbol)?.kind || "currency" })}
              />
            </Suspense>
          </div>
        ) : routeState.type === "currency-profile" ? (
          <div className="view-container">
            <Suspense fallback={moduleLoadingFallback}>
              <CurrencyResearchWorkspace
                symbol={routeState.symbol}
                mode={resolveCurrencyInstrument(routeState.symbol)?.kind === "forex" ? "pair" : "currency"}
                view={routeState.state?.view}
                compareSymbol={routeState.state?.compareSymbol}
                onClose={navigateToAppRoute}
                onOpenProfile={openCurrencyProfile}
                onCompare={(target) => navigateToCompare(target || { symbol: routeState.symbol, kind: resolveCurrencyInstrument(routeState.symbol)?.kind || "currency" })}
              />
            </Suspense>
          </div>
        ) : (
          <GenericErrorBoundary resetKey={`${routeState.type}:${routeState.type === "company" ? routeState.symbol || "company" : activeSection}`}>
            <Suspense fallback={moduleLoadingFallback}>
        {shouldRenderGuestPreview && (
          <GuestWorkspacePreview
            activeSection={activeSection}
            guestInteraction={guestInteraction}
            guestActionFeedback={guestActionFeedback}
            retryingLiveData={guestRetryingLiveData}
            liveStreamStatus={liveStreamStatus}
            lastLivePriceAt={lastLivePriceAt}
            watchlistNotice={watchlistNotice}
            onOpenSection={openWorkspaceSection}
            onShareSection={shareGuestSection}
            onRetryLiveData={retryLiveData}
          />
        )}

        {activeSection === "Home" && !shouldRenderGuestPreview && (
          <>
            {renderConnectNudge("home")}
            {homeSubview === "metrics" ? (
              <div className="view-container">
                <FullMetricsPage
                  onBack={() => setHomeSubview(null)}
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
            ) : (
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
                unifiedPortfolio={unified}
                calculatePortfolioGain={calculatePortfolioGain}
                balance={balance}
                openMarketContextOnMount={homeSubview === "market-context"}
                onMarketContextOpened={() => setHomeSubview(null)}
                onViewAllPositions={() => openWorkspaceSection("Portfolio")}
                onViewFullMetrics={() => {
                  if (routeState.type === "company") navigateToAppRoute();
                  setActiveSection("Home");
                  setHomeSubview("metrics");
                }}
                onOpenWatchlist={() => openWorkspaceSection("Watchlist")}
                onOpenAnalytics={(desk = null) => {
                  setAnalyticsInitialTab(desk || null);
                  openWorkspaceSection("Analytics");
                }}
                onOpenIntelligence={() => openWorkspaceSection("Intelligence")}
                onOpenResearch={() => openWorkspaceSection("Research")}
                brokerageSummary={brokerageSummary}
                onConnectBrokerage={() => setShowBrokerageFlow(true)}
              />
            )}
          </>
        )}

        {activeSection === "Watchlist" && (
          <div className="view-container">
            {isExplicitGuestMode ? (
              <>
                <GuestSavedDataBanner
                  activeSection={activeSection}
                  lastUpdated={lastLivePriceAt ? new Date(lastLivePriceAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : GUEST_DEMO_SNAPSHOT_LABEL}
                  liveStreamStatus={liveStreamStatus}
                  watchlistNotice={watchlistNotice}
                  retryingLiveData={guestRetryingLiveData}
                  onRetryLiveData={retryLiveData}
                />
                {guestActionFeedback ? (
                  <div className="guest-action-feedback" role="status" aria-live="polite">
                    {guestActionFeedback}
                  </div>
                ) : null}
                <GuestContextualSignupNudge section={activeSection} interaction={guestInteraction} />
              </>
            ) : null}
            {sharedWatchlistLocked ? (
              <>
                <section className="desk-watchlist-lock" role="status">
                  <span>Shared Desk watchlist</span>
                  <h2>Upgrade to {lockedWatchlistPlanLabel} to reopen the shared list</h2>
                  <p>
                    This workspace previously used a shared watchlist. Zenin is hiding member-managed rows so stale symbols do not linger locally, but the category view stays available for market context.
                  </p>
                  <div className="settings-inline-actions">
                    <button
                      type="button"
                      className="settings-primary-btn"
                      onClick={() => {
                        setIsSettingsOpen(true);
                        setActiveSettingsCategory("Billing");
                      }}
                    >
                      View Upgrade Path
                    </button>
                    <button
                      type="button"
                      className="settings-secondary-btn"
                      onClick={() => setActiveCategory("indicators")}
                    >
                      Review Indicators
                    </button>
                    <button
                      type="button"
                      className="settings-secondary-btn"
                      onClick={() => setActiveCategory("commodities")}
                    >
                      Review Commodities
                    </button>
                  </div>
                </section>
                {watchlistNotice ? (
                  <div className="stale-banner">
                    <span className="status-icon">⚠</span>
                    {watchlistNotice}
                  </div>
                ) : null}
                <Watchlist
                  categories={categories.length ? categories : fallbackCategories}
                  activeCategory={activeCategory}
                  onCategorySelect={handleCategorySelect}
                  assets={assets}
                  watchlistAssets={lockedWatchlistPreviewAssets}
                  onAdd={() => {}}
                  loading={loading}
                  activeTheme={activeTheme}
                  onThemeSelect={setActiveTheme}
                  stockThemes={stockThemes}
                  isInWatchlist={() => true}
                  onToggleStar={() => {
                    setWatchlistNotice(`Upgrade to ${lockedWatchlistPlanLabel} to manage this shared watchlist.`);
                    return "locked";
                  }}
                  onAddAsset={() => {
                    setWatchlistNotice(`Upgrade to ${lockedWatchlistPlanLabel} to manage this shared watchlist.`);
                  }}
                  onImportAssets={() => {
                    const message = `Upgrade to ${lockedWatchlistPlanLabel} to import into this shared watchlist.`;
                    setWatchlistNotice(message);
                    throw new Error(message);
                  }}
                  onPageChange={handlePageChange}
                  liveStatus={liveStreamStatus}
                  lastLivePriceAt={lastLivePriceAt}
                  isGuestMode={isExplicitGuestMode}
                  onIntent={(asset, intent) => {
                    if (intent === "alert") void dispatchWatchlistAlertEmail(asset, intent);
                    setGuestInteraction(`Watchlist:${intent || asset?.symbol || "asset"}`);
                  }}
                  alertAssignments={workspaceAlertAssignments}
                  alertsLoading={workspaceAlertsLoading}
                  onLoadAlertAssignments={loadWorkspaceAlertAssignments}
                  onUpdateAlertAssignment={updateWorkspaceAlertAssignment}
                  currentUserId={authUserId}
                  hasDeskFeatureAccess={hasDeskFeatureAccess}
                  sharedWatchlistLocked={sharedWatchlistLocked}
                  lockedPlanLabel={lockedWatchlistPlanLabel}
                  onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
                />
              </>
            ) : (
              <>
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
              onAddAsset={toggleWatchlistStar}
              onImportAssets={importWatchlistAssets}
              onPageChange={handlePageChange}
              liveStatus={liveStreamStatus}
              lastLivePriceAt={lastLivePriceAt}
              isGuestMode={isExplicitGuestMode}
              onIntent={(asset, intent) => {
                if (intent === "alert") void dispatchWatchlistAlertEmail(asset, intent);
                if (isExplicitGuestMode) setGuestInteraction(`Watchlist:${intent || asset?.symbol || "asset"}`);
              }}
              alertAssignments={workspaceAlertAssignments}
              alertsLoading={workspaceAlertsLoading}
              onLoadAlertAssignments={loadWorkspaceAlertAssignments}
              onUpdateAlertAssignment={updateWorkspaceAlertAssignment}
              currentUserId={authUserId}
              hasDeskFeatureAccess={hasDeskFeatureAccess}
              sharedWatchlistLocked={sharedWatchlistLocked}
              lockedPlanLabel={lockedWatchlistPlanLabel}
              onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
              onRefresh={handleRefreshWatchlist}
            />
              </>
            )}
          </div>
        )}

        {activeSection === "Portfolio" && !shouldRenderGuestPreview && (
          <div className="view-container portfolio-shell-view workspace-page">
            {renderConnectNudge("portfolio")}
            <PortfolioModule
                portfolio={portfolioWithEntry}
                trades={trades}
                apiTradeExecutions={apiTradeExecutions}
                workspaceNotifications={workspaceNotifications}
                unreadNotificationCount={unreadNotificationCount}
                balance={balance}
                accountMetrics={accountMetrics}
                calculatePortfolioValue={calculatePortfolioValue}
                unifiedPortfolio={unified}
                calculatePortfolioGain={calculatePortfolioGain}
                activeOptionsTrades={activeOptionsTrades}
                setActiveOptionsTrades={setActiveOptionsTrades}
                tradeFeeSummary={tradeFeeSummary}
                multiChainCache={multiChainCache}
                spotPrices={spotPrices}
                isSignedIn={hasAuthToken()}
                onEstimateRebalance={estimatePortfolioRebalance}
                onExecuteRebalance={null}
                onRemove={removeFromPortfolio}
                onSelectAsset={(asset) => {
                  const enriched = {
                    ...asset,
                    marketType: String(asset.marketType || "spot").toLowerCase()
                  };
                  setSelectedAsset(enriched);
                }}
                onSellAsset={null}
                onOpenPredictions={() => openWorkspaceSection("Predictions")}
                onOpenJournal={() => openWorkspaceSection("Journal")}
                onOpenMarketContext={() => {
                  if (routeState.type === "company") navigateToAppRoute();
                  setActiveSection("Home");
                  setHomeSubview("market-context");
                }}
                onOpenConnections={() => openConnectWindow("manual")}
                onConnectBrokerage={() => setShowBrokerageFlow(true)}
                connectedAccounts={connectedAccounts}
                brokerageAccounts={brokerageAccounts}
                brokerageSummary={brokerageSummary}
                hasDeskFeatureAccess={hasDeskFeatureAccess}
                onOpenPlans={() => {
                  setIsSettingsOpen(true);
                  setActiveSettingsCategory("Billing");
                }}
                indicatorContext={routeState.indicatorContext}
              />
              <Suspense fallback={null}>
                <SnapTradeConnectionFlow
                  open={showBrokerageFlow}
                  onClose={() => setShowBrokerageFlow(false)}
                  onConnected={async () => {
                    await loadBrokerageSummary({ silent: true });
                    await unified.refresh();
                    void refreshWorkspaceNotifications({ toastNew: false });
                  }}
                />
              </Suspense>

          </div>
        )}

       {activeSection === "Analytics" && !shouldRenderGuestPreview && (
        <PlanLockOverlay
          locked={!!lockedFor("Analytics")}
          requiredPlan={lockedFor("Analytics") || "pro"}
          title="Analytics"
          description="Advanced analytics and commodity intelligence are a Pro feature. Upgrade to unlock the full analytics workspace."
          onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
        >
        <div className="view-container">
          <AnalyticsModule
          backendUrl={BACKEND_URL}
          hasDeskFeatureAccess={hasDeskFeatureAccess}
          onCommoditySelect={(symbol) => {
            const sym = String(symbol || "").trim().toUpperCase();
            if (!sym) return;
            setSelectedAsset({ symbol: sym, type: "commodity", marketType: "commodity", category: "commodities" });
          }}
          onOpenCommodityResearch={openCommodityResearch}
          onOpenCommodityProfile={openCommodityProfile}
          onOpenCommodityTransmission={(symbol) => { try { openTransmissionExplorer(String(symbol || "").toUpperCase()); } catch {} }}
          onAddCommodityToWatchlist={(symbol) => openWatchlistPrompt({ symbol, type: "commodity", marketType: "commodity", category: "commodities" })}
          onOpenResearch={() => openWorkspaceSection("Research", { geo: selectedGeoCode })}
          initialTab={analyticsInitialTab}
        />
        </div>
        </PlanLockOverlay>
      )}

        {activeSection === "Research" && !shouldRenderGuestPreview && (
          <PlanLockOverlay
            locked={!!lockedFor("Research")}
            requiredPlan={lockedFor("Research") || "pro"}
            title="Research"
            description="Catalyst and research context is a Pro feature. Upgrade to unlock the research workspace."
            onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
          >
          <div className="view-container">
            <ResearchModule
              portfolio={portfolioWithEntry}
              watchlistAssets={watchlistAssets}
              onOpenWatchlist={() => openWorkspaceSection("Watchlist")}
              onOpenPortfolio={() => openWorkspaceSection("Portfolio")}
              onPromoteToDecisionThread={promoteResearchToDecisionThread}
            />
          </div>
          </PlanLockOverlay>
        )}

        {activeSection === "Options" && !shouldRenderGuestPreview && (
          <PlanLockOverlay
            locked={!!lockedFor("Options")}
            requiredPlan={lockedFor("Options") || "desk"}
            title="Options"
            description="Options analytics and the strategy simulator are a Desk feature. Upgrade to unlock options trading intelligence."
            onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
          >
          <OptionsModule
            activeOptionsTrades={activeOptionsTrades}
            setActiveOptionsTrades={setActiveOptionsTrades}
            onOptionTradeExecuted={null}
            onOptionTradeClosed={null}
            balance={balance}
            spotPrices={spotPrices}
            showToast={showTradeToast}
          />
          </PlanLockOverlay>
        )}

        {activeSection === "Predictions" && (
          <PlanLockOverlay
            locked={!!lockedFor("Predictions")}
            requiredPlan={lockedFor("Predictions") || "desk"}
            title="Predictions"
            description="Prediction markets are a Desk feature. Upgrade to unlock Polymarket and Kalshi integration."
            onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
          >
          <PredictionMarketModule />
          </PlanLockOverlay>
        )}

        {activeSection === "Intelligence" && !shouldRenderGuestPreview && (
          <div className="view-container">
            <IntelligenceWorkspace
              context={routeState.type === "intelligence" ? undefined : routeState.type}
              symbol={routeState.symbol}
              indicatorContext={routeState.indicatorContext}
              portfolio={portfolioWithEntry}
              onNavigate={navigateIntelligence}
            />
          </div>
        )}

        {activeSection === "Journal" && !shouldRenderGuestPreview && (
          <PlanLockOverlay
            locked={!!lockedFor("Journal")}
            requiredPlan={lockedFor("Journal") || "pro"}
            title="Journal"
            description="The decision journal and trade review workflow is a Pro feature. Upgrade to capture and review your decisions."
            onUpgrade={() => { setActiveSettingsCategory("Billing"); setIsSettingsOpen(true); }}
          >
          <JournalModule
            trades={trades}
            portfolio={portfolioWithEntry}
            balance={accountMetrics.liveAvailableBalance}
            accountEquity={accountMetrics.totalAccountEquity}
            activeOptionsTrades={activeOptionsTrades}
            multiChainCache={multiChainCache}
            spotPrices={spotPrices}
            journalThreadContext={journalThreadContext}
            unifiedPortfolio={unifiedPortfolio}
          />
          </PlanLockOverlay>
        )}

        {activeSection === "Tax Estimator" && !shouldRenderGuestPreview && (
          <div className="tax-subview-wrap">
            <div className="tax-subview-tabs">
              <button
                className={`tax-subview-tab ${taxSubView === "tax" ? "active" : ""}`}
                onClick={() => startTransition(() => setTaxSubView("tax"))}
              >
                Tax Estimator
              </button>
              <button
                className={`tax-subview-tab ${taxSubView === "calculator" ? "active" : ""}`}
                onClick={() => startTransition(() => setTaxSubView("calculator"))}
              >
                Calculator
              </button>
            </div>
            {taxSubView === "tax" ? (
              <TaxEstimator trades={trades} portfolio={portfolioWithEntry} spotPrices={spotPrices} unifiedPortfolio={unifiedPortfolio} />
            ) : (
              <PerpsCalculator />
            )}
          </div>
        )}
            </Suspense>
          </GenericErrorBoundary>
        )}
      </main>
      </div>

      {viewportWidth <= 960 && (
      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {MOBILE_PRIMARY_NAV.map((section) => {
          const isActive = activeSection === section;
          const enabled = accessibleSections.includes(section);
          return (
            <button
              key={section}
              type="button"
              className={`mobile-bottom-nav-item ${isActive ? "active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              disabled={!enabled}
              onClick={() => enabled && openWorkspaceSection(section)}
            >
              <span className="mobile-bottom-nav-icon" aria-hidden="true">{sectionIcon(section)}</span>
              <span className="mobile-bottom-nav-label">{section}</span>
            </button>
          );
        })}
      </nav>
      )}

      {showContextPanel && (
        <aside className="context-panel" aria-label="Context panel" />
      )}

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
              onConfirm={null}
              onCompare={({ kind, symbol }) => {
                setSelectedAsset(null);
                const k = String(kind || "equity").toLowerCase();
                if (k === "etf") { openEtfResearch({ symbol, view: "compare" }); return; }
                if (k === "forex" || k === "currency") { openCurrencyResearch({ symbol, view: "compare" }); return; }
                navigateToCompare(symbol);
              }}
              researchOnly
              isInWatchlist={isInWatchlist}
              onToggleStar={toggleWatchlistStar}
              onViewCompanyProfile={isEtfRouteAsset ? openEtfProfile : isCommodityRouteAsset ? openCommodityProfile : openCompanyProfile}
              onOpenResearch={isEtfRouteAsset ? openEtfResearch : isCommodityRouteAsset ? openCommodityResearch : openAssetResearch}
              onOpenDesk={() => setActiveSection("Analytics")}
              portfolio={portfolioWithEntry}
              balance={balance}
              cashBalances={cashBalances}
              trades={trades}
              spotPrices={spotPrices}
            />
          )}
        </Suspense>
      )}

      <AnimatedTradeToast toast={tradeToast} onDismiss={() => setTradeToast(null)} />

      {alertBuilder?.open && (
        <AssetAlertBuilder
          open={alertBuilder.open}
          asset={alertBuilder.asset}
          onClose={() => setAlertBuilder({ open: false, asset: null })}
          onToast={(msg) => setTradeToast({ id: Date.now(), type: "success", message: msg })}
        />
      )}

      {compareDrawer?.open && (
        <AssetCompareDrawer
          open={compareDrawer.open}
          assets={compareDrawer.assets}
          onClose={() => setCompareDrawer({ open: false, assets: [] })}
          onToast={(msg) => setTradeToast({ id: Date.now(), type: "info", message: msg })}
        />
      )}

      {watchlistPrompt?.asset && (
        <WatchlistCollectModal
          asset={watchlistPrompt.asset}
          themes={stockThemes}
          categories={tradfiCategoryOptions}
          watchlistAssets={watchlistAssets}
          initialTheme={watchlistPrompt.theme || watchlistPrompt.customTheme || ""}
          initialCategory={watchlistPrompt.category || ""}
          submitting={watchlistPrompt.submitting}
          error={watchlistPrompt.error}
          onCancel={() => setWatchlistPrompt(null)}
          onConfirm={submitWatchlistPrompt}
          onOpenTheme={(category, theme) => {
            startTransition(() => {
              setWatchlistPrompt(null);
              setActiveSection("Watchlist");
              setActiveCategory(category || "stocks");
              setActiveTheme(theme);
            });
          }}
        />
      )}

      {isSettingsOpen && (
        <div
          id="zenin-workspace-settings"
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace settings"
          onClick={() => setIsSettingsOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsSettingsOpen(false);
            }
          }}
        >
          <div className="flex flex-col w-full max-w-4xl max-h-[90vh] bg-[var(--color-surface-card)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden" ref={settingsPanelRef} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start px-8 py-6 border-b border-[var(--color-border)]">
              <div className="flex flex-col gap-1">
                <span className="settings-meta-label">Workspace control</span>
                <h2 className="text-[var(--fs-xl)] font-medium text-[var(--color-text-primary)] m-0">Workspace Settings</h2>
                <p className="text-[var(--fs-body)] text-[var(--color-text-secondary)] m-0">Profile, security, billing, data, and workstation controls.</p>
              </div>
              <div className="flex items-center gap-2 text-[13px]">
                <span className="settings-live-dot" aria-hidden="true" />
                <strong>Live</strong>
                <em>{accountPlanLabel}</em>
                <button className="text-2xl text-[var(--color-text-muted)] hover:text-white cursor-pointer ml-4 leading-none bg-transparent border-none p-1" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings">&times;</button>
              </div>
            </div>

            <div className="flex flex-1 min-h-0">
              <aside className="flex flex-col gap-1 w-[220px] p-6 pr-4 border-r border-[var(--color-border)] bg-[var(--color-bg-base)] overflow-y-auto" role="tablist" aria-label="Settings categories">
                <div className="settings-index-label">Settings</div>
                {settingsCategories.map((category) => (
                  <button
                    key={category}
                    role="tab"
                    id={`settings-tab-${category.replace(/\s+/g, "-").toLowerCase()}`}
                    aria-selected={activeSettingsCategory === category}
                    aria-controls="settings-content-panel"
                    className={`settings-category-tab ${activeSettingsCategory === category ? "active" : ""}`.trim()}
                    onClick={() => handleSettingsCategorySelect(category)}
                  >
                    {category}
                  </button>
                ))}
              </aside>

              <section
                id="settings-content-panel"
                role="tabpanel"
                aria-labelledby={`settings-tab-${activeSettingsCategory.replace(/\s+/g, "-").toLowerCase()}`}
                className="flex-1 p-8 overflow-y-auto bg-[var(--color-surface-card)]"
              >
                {activeSettingsPanel === "Profile" && (
                  <>
                    <div className="p-4 mb-6 text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] rounded-md">{settingsPreviewNote}</div>
                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("profile-email")}>
                        <span>Email Address</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["profile-email"]} />
                      </button>
                      {expandedSettingsPanels["profile-email"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                            Current: <strong>{profileSecurity.email || userEmail}</strong>
                          </p>
                          {profileSecurity.pendingEmail ? (
                            <p className="text-[13px] text-[var(--color-warning)] font-medium">Pending verification: {profileSecurity.pendingEmail}</p>
                          ) : null}
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>New Email</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              type="email"
                              value={profileForms.newEmail}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, newEmail: e.target.value }))}
                              placeholder="name@example.com"
                            />
                          </label>
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Current Password</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              type="password"
                              value={profileForms.emailPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, emailPassword: e.target.value }))}
                              placeholder={isGuestUser ? "Enter demo password" : "Enter current password"}
                            />
                          </label>
                          {hasPendingEmail ? (
                            <label className="flex flex-col gap-2 w-full max-w-md">
                              <span>Verification Code</span>
                              <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                type="text"
                                value={profileForms.emailVerificationCode}
                                onChange={(e) => setProfileForms((prev) => ({
                                  ...prev,
                                  emailVerificationCode: e.target.value.replace(/\D/g, "").slice(0, 6)
                                }))}
                                placeholder="6-digit code"
                              />
                            </label>
                          ) : null}
                          {isGuestUser ? (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                              Demo accounts generate a local 6-digit code in this settings panel.
                            </p>
                          ) : (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                              We will send a 6-digit verification code to your new inbox before your sign-in email changes.
                            </p>
                          )}
                          <div className="flex gap-3 mt-2">
                            <button
                              className={cn(buttonVariants({ variant: "default" }))}
                              onClick={requestEmailChange}
                              disabled={!canSendEmailVerification}
                            >
                              Send Verification Code
                            </button>
                            {hasPendingEmail ? (
                              <button
                                className={cn(buttonVariants({ variant: "secondary" }))}
                                onClick={verifyPendingEmail}
                                disabled={!canConfirmEmailVerification}
                              >
                                Confirm Verification
                              </button>
                            ) : null}
                          </div>
                          {profileFeedback.email?.text ? (
                            <p className={`text-[13px] font-medium mt-2 ${ profileFeedback.email.type === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{profileFeedback.email.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("profile-password")}>
                        <span>Password</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["profile-password"]} />
                      </button>
                      {expandedSettingsPanels["profile-password"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          {isGuestUser ? (
                            <label className="flex flex-col gap-2 w-full max-w-md">
                              <span>Current Password</span>
                              <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                type="password"
                                value={profileForms.currentPassword}
                                onChange={(e) => setProfileForms((prev) => ({ ...prev, currentPassword: e.target.value }))}
                                placeholder="Enter current password"
                              />
                            </label>
                          ) : (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                              Password changes now run through the recovery route so the account session and email verification stay in sync.
                            </p>
                          )}
                          {isGuestUser ? (
                            <>
                              <label className="flex flex-col gap-2 w-full max-w-md">
                                <span>New Password</span>
                                <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                  type="password"
                                  value={profileForms.newPassword}
                                  onChange={(e) => setProfileForms((prev) => ({ ...prev, newPassword: e.target.value }))}
                                  placeholder="Use at least 10 characters"
                                />
                              </label>
                              <label className="flex flex-col gap-2 w-full max-w-md">
                                <span>Confirm New Password</span>
                                <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                  type="password"
                                  value={profileForms.confirmPassword}
                                  onChange={(e) => setProfileForms((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                                  placeholder="Re-enter new password"
                                />
                              </label>
                              <PasswordRequirementsList
                                value={profileForms.newPassword}
                                confirmValue={profileForms.confirmPassword}
                                includeMatch
                              />
                            </>
                          ) : null}
                          <div className="flex gap-3 mt-2">
                            {isGuestUser ? (
                              <button
                                className={cn(buttonVariants({ variant: "default" }))}
                                onClick={updatePassword}
                                disabled={!canUpdatePassword}
                              >
                                Update Demo Password
                              </button>
                            ) : (
                              <button
                                className={cn(buttonVariants({ variant: "default" }))}
                                onClick={() => {
                                  window.location.href = "/auth?mode=forgot&next=/app";
                                }}
                              >
                                Open Password Recovery
                              </button>
                            )}
                          </div>
                          {profileSecurity.passwordChangedAt ? (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                              Last changed: {new Date(profileSecurity.passwordChangedAt).toLocaleString()}
                            </p>
                          ) : null}
                          {profileFeedback.password?.text ? (
                            <p className={`text-[13px] font-medium mt-2 ${ profileFeedback.password.type === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{profileFeedback.password.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("profile-twofa")}>
                        <span>2FA & Passkeys</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["profile-twofa"]} />
                      </button>
                      {expandedSettingsPanels["profile-twofa"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <div className="flex flex-wrap gap-2">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--color-border)] ${ profileSecurity.twoFactorEnabled ? "success" : "muted" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20" : "bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)]"}`}>
                              {profileSecurity.twoFactorEnabled ? "2FA Enabled" : "2FA Disabled"}
                            </span>
                            {profileSecurity.twoFactorMethod ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">{String(profileSecurity.twoFactorMethod).toUpperCase()}</span>
                            ) : null}
                            {profileSecurity.twoFactorProvider ? (
                              <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">{profileSecurity.twoFactorProvider}</span>
                            ) : null}
                          </div>
                          {isGuestUser ? (
                            <>
                              <label className="flex flex-col gap-2 w-full max-w-md">
                                <span>Security Method</span>
                                <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                                  <label className="flex flex-col gap-2 w-full max-w-md">
                                    <span>Authenticator Service</span>
                                    <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                      value={profileForms.authenticatorService}
                                      onChange={(e) => setProfileForms((prev) => ({ ...prev, authenticatorService: e.target.value }))}
                                    >
                                      {authenticatorOptions.map((service) => (
                                        <option key={service} value={service}>{service}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">Scan QR in your app, then enter the 6-digit code below.</p>
                                  {!isGuestUser && !totpSetup.secret && !totpSetup.loading ? (
                                    <button className={cn(buttonVariants({ variant: "secondary" }))} style={{ margin: "12px 0" }} onClick={fetchTotpSetup}>Generate QR Code</button>
                                  ) : null}
                                  {totpSetup.loading ? (
                                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ margin: "12px 0" }}>Generating...</p>
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
                                  <label className="flex flex-col gap-2 w-full max-w-md">
                                    <span>Passkey Service</span>
                                    <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                      value={profileForms.passkeyProvider}
                                      onChange={(e) => setProfileForms((prev) => ({ ...prev, passkeyProvider: e.target.value }))}
                                    >
                                      {passkeyOptions.map((provider) => (
                                        <option key={provider} value={provider}>{provider}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="flex flex-col gap-2 w-full max-w-md">
                                    <span>Passkey Name</span>
                                    <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                      type="text"
                                      value={profileForms.passkeyName}
                                      onChange={(e) => setProfileForms((prev) => ({ ...prev, passkeyName: e.target.value }))}
                                      placeholder="MacBook Pro / iPhone / YubiKey"
                                    />
                                  </label>
                                </>
                              ) : null}

                              {profileForms.twoFactorMethod === "sms" ? (
                                <label className="flex flex-col gap-2 w-full max-w-md">
                                  <span>Phone Number</span>
                                  <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                    type="text"
                                    value={profileForms.phoneNumber}
                                    onChange={(e) => setProfileForms((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                                    placeholder="+1 555 123 4567"
                                  />
                                </label>
                              ) : null}

                              {profileForms.twoFactorMethod === "email" ? (
                                <label className="flex flex-col gap-2 w-full max-w-md">
                                  <span>Recovery Email</span>
                                  <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                    type="email"
                                    value={profileForms.recoveryEmail}
                                    onChange={(e) => setProfileForms((prev) => ({ ...prev, recoveryEmail: e.target.value }))}
                                    placeholder="security@example.com"
                                  />
                                </label>
                              ) : null}

                              {profileForms.twoFactorMethod !== "passkey" ? (
                                <label className="flex flex-col gap-2 w-full max-w-md">
                                  <span>Verification Code</span>
                                  <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                    type="text"
                                    value={profileForms.twoFactorCode}
                                    onChange={(e) => setProfileForms((prev) => ({ ...prev, twoFactorCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                                    placeholder="6-digit code"
                                  />
                                </label>
                              ) : null}

                              <div className="flex gap-3 mt-2">
                                {profileForms.twoFactorMethod === "passkey" ? (
                                  <button
                                    className={cn(buttonVariants({ variant: "default" }))}
                                    onClick={registerPasskey}
                                    disabled={!canEnableTwoFactor}
                                  >
                                    Register Passkey
                                  </button>
                                ) : (
                                  <button
                                    className={cn(buttonVariants({ variant: "default" }))}
                                    onClick={enableTwoFactor}
                                    disabled={!canEnableTwoFactor}
                                  >
                                    Enable 2FA
                                  </button>
                                )}
                                <button
                                  className={cn(buttonVariants({ variant: "secondary" }))}
                                  onClick={regenerateBackupCodes}
                                  disabled={!profileSecurity.twoFactorEnabled}
                                >
                                  Regenerate Backup Codes
                                </button>
                                <button
                                  className={cn(buttonVariants({ variant: "secondary" }))}
                                  onClick={disableTwoFactor}
                                  disabled={!profileSecurity.twoFactorEnabled}
                                >
                                  Disable 2FA
                                </button>
                              </div>

                              {profileSecurity.passkeys?.length ? (
                                <div className="flex flex-col gap-2 mt-2">
                                  {profileSecurity.passkeys.map((passkey) => (
                                    <div key={passkey.id} className="flex justify-between items-center p-3 rounded-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                                      <strong>{passkey.name}</strong>
                                      <span>{passkey.provider}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {profileSecurity.backupCodes?.length ? (
                                <div className="grid grid-cols-2 gap-2 mt-2">
                                  {profileSecurity.backupCodes.map((code) => (
                                    <code key={code}>{code}</code>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">Backup codes will appear once 2FA is enabled.</p>
                              )}
                            </>
                          ) : (
                            <div className="p-4 border border-[var(--color-border)] bg-[var(--color-bg-base)] rounded-md">
                                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: 0 }}>
                                Identity is managed by the backend for this signed-in account. Authenticator MFA and OAuth sign-in methods are managed here; passkey and backup-code management are intentionally not exposed until in-app management surfaces are ready.
                              </p>

                              <div className="flex flex-wrap gap-2" style={{ marginTop: "12px" }}>
                                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border border-[var(--color-border)] ${ supabaseSecurity.verifiedTotpFactor ? "success" : "muted" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20" : "bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)]"}`}>
                                  {supabaseSecurity.verifiedTotpFactor ? "Authenticator MFA active" : "Authenticator MFA off"}
                                </span>
                                {supabaseSecurity.aal?.currentLevel ? (
                                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">Session {String(supabaseSecurity.aal.currentLevel).toUpperCase()}</span>
                                ) : null}
                              </div>

                              {!supabaseSecurity.verifiedTotpFactor ? (
                                <>
                                  {!totpSetup.factorId ? (
                                    <button
                                      className={cn(buttonVariants({ variant: "secondary" }))}
                                      style={{ marginTop: "14px" }}
                                      onClick={fetchTotpSetup}
                                      disabled={totpSetup.loading || supabaseSecurity.loading}
                                    >
                                      {totpSetup.loading ? "Generating..." : "Set Up Authenticator App"}
                                    </button>
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
                                      <label className="flex flex-col gap-2 w-full max-w-md" style={{ width: "100%" }}>
                                        <span>Verification Code</span>
                                        <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                          type="text"
                                          inputMode="numeric"
                                          value={profileForms.twoFactorCode}
                                          onChange={(e) => setProfileForms((prev) => ({ ...prev, twoFactorCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                                          placeholder="6-digit code"
                                          autoComplete="one-time-code"
                                        />
                                      </label>
                                      <div className="flex gap-3 mt-2">
                                        <button
                                          className={cn(buttonVariants({ variant: "default" }))}
                                          onClick={enableTwoFactor}
                                          disabled={!canEnableTwoFactor}
                                        >
                                          Enable Authenticator MFA
                                        </button>
                                        <button
                                          className={cn(buttonVariants({ variant: "secondary" }))}
                                          onClick={() => {
                                            setTotpSetup({ factorId: "", secret: "", qrCodeDataUrl: "", loading: false });
                                            setProfileForms((prev) => ({ ...prev, twoFactorCode: "" }));
                                          }}
                                        >
                                          Cancel Setup
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : (
                                <div className="flex gap-3 mt-2" style={{ marginTop: "14px" }}>
                                  <button
                                    className={cn(buttonVariants({ variant: "secondary" }))}
                                    onClick={disableTwoFactor}
                                    disabled={supabaseSecurity.loading}
                                  >
                                    Disable Authenticator MFA
                                  </button>
                                  <button
                                    className={cn(buttonVariants({ variant: "secondary" }))}
                                    onClick={() => refreshSupabaseSecurity()}
                                    disabled={supabaseSecurity.loading}
                                  >
                                    Refresh Security Status
                                  </button>
                                </div>
                              )}

                              <div style={{ marginTop: "18px" }}>
                                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginBottom: "10px" }}>
                                  Linked sign-in methods
                                </p>
                                <div className="flex flex-col gap-2 mt-2">
                                  {supabaseSecurity.identities.map((identity) => (
                                    <div key={identity.id || `${identity.provider}-${identity.provider_id}`} className="flex justify-between items-center p-3 rounded-md bg-[var(--color-surface-elevated)] border border-[var(--color-border)]">
                                      <strong>{formatIdentityProvider(identity.provider)}</strong>
                                      <span>{identity.email || identity.identity_data?.email || "Linked identity"}</span>
                                      {identity.provider !== "email" && supabaseSecurity.identities.length > 1 ? (
                                        <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={() => unlinkOAuthIdentity(identity)}>
                                          Unlink
                                        </button>
                                      ) : null}
                                    </div>
                                  ))}
                                  {!supabaseSecurity.identities.length ? (
                                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">No linked identities were returned.</p>
                                  ) : null}
                                </div>
                                <div className="flex gap-3 mt-2" style={{ marginTop: "12px" }}>
                                  <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={() => linkOAuthIdentity("google")}>
                                    Link Google
                                  </button>
                                  <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={() => refreshSupabaseSecurity()}>
                                    Refresh
                                  </button>
                                </div>
                              </div>

                              <div className="flex gap-3 mt-2">
                                <button
                                  className={cn(buttonVariants({ variant: "secondary" }))}
                                  onClick={registerPasskey}
                                >
                                  Passkey Status
                                </button>
                                <button
                                  className={cn(buttonVariants({ variant: "secondary" }))}
                                  onClick={regenerateBackupCodes}
                                >
                                  Backup-Code Status
                                </button>
                              </div>
                            </div>
                          )}

                          {profileFeedback.twofa?.text ? (
                            <p className={`text-[13px] font-medium mt-2 ${ profileFeedback.twofa.type === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{profileFeedback.twofa.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <SecurityRecovery twoFactorEnabled={!!profileSecurity?.twoFactorEnabled} />

                    <div className="settings-panel settings-danger-panel">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("profile-delete")}>
                        <span>Delete Account</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["profile-delete"]} />
                      </button>
                      {expandedSettingsPanels["profile-delete"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <p className="text-[13px] text-[var(--color-warning)] font-medium">
                            This permanently deletes your Zenin account, connected-account credentials, workspace data you own, and saved portfolio records. Team workspaces must have other active members removed or transferred first.
                          </p>
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Current Email</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              type="email"
                              value={profileForms.deleteConfirmEmail}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, deleteConfirmEmail: e.target.value }))}
                              placeholder={profileSecurity.email || userEmail || "name@example.com"}
                              autoComplete="email"
                            />
                          </label>
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Current Password</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              type="password"
                              value={profileForms.deleteCurrentPassword}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, deleteCurrentPassword: e.target.value }))}
                              placeholder="Required for password accounts"
                              autoComplete="current-password"
                            />
                          </label>
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Confirmation Phrase</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              type="text"
                              value={profileForms.deleteConfirmationPhrase}
                              onChange={(e) => setProfileForms((prev) => ({ ...prev, deleteConfirmationPhrase: e.target.value }))}
                              placeholder="DELETE MY ACCOUNT"
                            />
                          </label>
                          <div className="flex gap-3 mt-2">
                            <button
                              className={cn(buttonVariants({ variant: "destructive" }))}
                              onClick={deleteAccount}
                              disabled={!canDeleteAccount}
                            >
                              {isDeletingAccount ? "Deleting..." : "Delete Account"}
                            </button>
                          </div>
                          {profileFeedback.delete?.text ? (
                            <p className={`text-[13px] font-medium mt-2 ${ profileFeedback.delete.type === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{profileFeedback.delete.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeSettingsPanel === "Subscription" && (
                  <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                    <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("subscription-plan")}>
                      <span>My Plan</span>
                      <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["subscription-plan"]} />
                    </button>
                    {expandedSettingsPanels["subscription-plan"] && (
                      <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                        <div className="flex flex-wrap gap-2">
                          <span className="settings-chip success">Current: {accountPlanLabel}</span>
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">
                            {revenueCatState.access?.hasActiveSubscription ? "Subscription active" : "No active paid subscription"}
                          </span>
                        </div>
                        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "10px" }}>
                          Check your current plan, change plans when options are available, and manage billing from one place.
                        </p>

                        {isGuestUser ? (
                          <p className="settings-status info">Sign in to view your subscription, change plans, and manage billing.</p>
                        ) : null}

                        {!isGuestUser ? (
                          <>
                            <div className="flex gap-3 mt-2" style={{ marginTop: "14px" }}>
                              <button
                                className={cn(buttonVariants({ variant: "secondary" }))}
                                onClick={() => {
                                  void refreshRevenueCatState();
                                }}
                                disabled={revenueCatState.loading || revenueCatState.purchasing || revenueCatState.paywallBusy}
                              >
                                {revenueCatState.loading ? "Refreshing..." : "Refresh Subscription"}
                              </button>
                              <button
                                className={cn(buttonVariants({ variant: "secondary" }))}
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
                                className={cn(buttonVariants({ variant: "secondary" }))}
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
                                border: "1px solid var(--color-border-medium)",
                                borderRadius: "var(--radius)",
                                background: "var(--color-surface-card)"
                              }}
                            >
                              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: 0 }}>
                                Subscription status
                              </p>
                              <p style={{ margin: "6px 0 0", fontWeight: 600 }}>
                                {revenueCatState.access?.hasActiveSubscription
                                  ? `${String(currentPlan || "starter").toUpperCase()} plan`
                                  : "Starter plan"}
                              </p>
                              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "10px" }}>
                                Billing cycle: {currentBillingCycle.toUpperCase()}
                              </p>
                              <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "10px" }}>
                                {revenueCatState.access?.managementURL
                                  ? "Use Manage Subscription to open your billing portal."
                                  : "A billing portal link will appear here when it is available for your subscription."}
                              </p>
                            </div>

                            {revenueCatPackages.length ? (
                              <div style={{ marginTop: "18px" }}>
                                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: 0 }}>
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
                                          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "6px" }}>
                                            {pkg.webBillingProduct.description || "Review this subscription option and choose it if it matches the access you need."}
                                          </p>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                          <strong>{pkg.webBillingProduct.currentPrice.formattedPrice}</strong>
                                        </div>
                                      </div>
                                      <div className="flex gap-3 mt-2" style={{ marginTop: "12px" }}>
                                        <button
                                          className={cn(buttonVariants({ variant: "secondary" }))}
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
                                <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "8px" }}>
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
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "12px" }}>
                              Use Change Plan to review upgrades or downgrades, and use Manage Subscription for billing self-service after purchase.
                            </p>
                          </>
                        ) : null}

                        {isAdmin && import.meta.env.DEV && (
                          <div style={{ marginTop: "20px", padding: "12px", border: "1px dashed rgba(255,255,255,0.2)", borderRadius: "3px" }}>
                            <h4 style={{ margin: "0 0 10px 0", color: "#f87171" }}>Developer Plan Simulator</h4>
                            <label className="flex flex-col gap-2 w-full max-w-md">
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
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "8px" }}>
                              Selecting a tier above will reload the app and override your tier in backend requests.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {activeSettingsPanel === "General" && (
                  <>
                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("general-display")}>
                        <span>Display Preferences</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["general-display"]} />
                      </button>
                      {expandedSettingsPanels["general-display"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <label className="settings-toggle-row">
                            <span>Hide account values</span>
                            <Switch
                              checked={preferences.hideValues}
                              onCheckedChange={(v) => setPreferences((prev) => ({ ...prev, hideValues: v }))}
                            />
                          </label>
                          <label className="settings-toggle-row">
                            <span>Hide portfolio PnL</span>
                            <Switch
                              checked={preferences.hidePortfolioPnl}
                              onCheckedChange={(v) => setPreferences((prev) => ({ ...prev, hidePortfolioPnl: v }))}
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("general-data")}>
                        <span>Data & Time</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["general-data"]} />
                      </button>
                      {expandedSettingsPanels["general-data"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Timezone</span>
                            <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Asset refresh frequency</span>
                            <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("layout-presets")}>
                        <span>Layout Presets</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["layout-presets"]} />
                      </button>
                      {expandedSettingsPanels["layout-presets"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>Choose layout style</span>
                            <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                              value={preferences.layoutPreset}
                              onChange={(e) => setPreferences((prev) => ({ ...prev, layoutPreset: e.target.value }))}
                            >
                              <option value="default">Default</option>
                              <option value="compact">Compact</option>
                              <option value="expanded">Expanded</option>
                              <option value="focus">Focus Mode</option>
                            </select>
                          </label>
                          <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">Layout preferences are saved to this browser profile.</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeSettingsPanel === "Workspace" && (
                  <>
                    <div className="p-4 mb-6 text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] rounded-md">
                      Desk workspaces turn Zenin into a shared operating surface: members, seats, shared account ingestion, and recent desk activity all live here.
                    </div>

                    <div className="settings-panel settings-ops-panel">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("ops-health")}>
                        <span>Workspace Health</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["ops-health"]} />
                      </button>
                      {expandedSettingsPanels["ops-health"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                            <div className="flex flex-col gap-2 p-4 border border-[var(--color-border)] bg-[var(--color-surface-elevated)] rounded-md">
                              <span>Market feed</span>
                              <strong>{liveStreamStatus === "connected" ? "Live" : liveStreamStatus === "degraded" ? "Degraded" : "Saved snapshot"}</strong>
                              <em>{lastLivePriceAt ? new Date(lastLivePriceAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : GUEST_DEMO_SNAPSHOT_LABEL}</em>
                            </div>
                            <div className="flex flex-col gap-2 p-4 border border-[var(--color-border)] bg-[var(--color-surface-elevated)] rounded-md">
                              <span>Account posture</span>
                              <strong>{isAdmin ? "Admin" : isGuestUser ? "Guest" : accountPlanLabel}</strong>
                              <em>{isGuestUser ? "Preview workspace" : "Authenticated workspace"}</em>
                            </div>
                            <div className="flex flex-col gap-2 p-4 border border-[var(--color-border)] bg-[var(--color-surface-elevated)] rounded-md">
                              <span>Workspace</span>
                              <strong>{activeWorkspace?.name || "Personal workspace"}</strong>
                              <em>{activeWorkspace?.membership?.role || (isAdmin ? "admin" : "member")}</em>
                            </div>
                            <div className="flex flex-col gap-2 p-4 border border-[var(--color-border)] bg-[var(--color-surface-elevated)] rounded-md">
                              <span>Coverage</span>
                              <strong>{watchlistAssets.length} tracked</strong>
                              <em>{connectedAccounts.length} connected account{connectedAccounts.length === 1 ? "" : "s"}</em>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="settings-panel settings-ops-panel">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("ops-capture")}>
                        <span>Issue Capture</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["ops-capture"]} />
                      </button>
                      {expandedSettingsPanels["ops-capture"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <div className="flex flex-col gap-3 p-4 border border-[var(--color-border)] rounded-md bg-[var(--color-surface-card)] mt-2">
                            <div><strong>Data access</strong><span>Feed status, retry visibility, stale snapshots, and unavailable endpoints.</span></div>
                            <div><strong>Conversion blockers</strong><span>Guest previews, locked modules, billing state, and account creation handoff.</span></div>
                            <div><strong>Trust controls</strong><span>OAuth, passkeys, MFA posture, workspace roles, and notification reachability.</span></div>
                            <div><strong>Interface quality</strong><span>Theme contrast, dense-table overflow, module crashes, and modal consistency.</span></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("workspace-overview")}>
                        <span>Workspace Overview</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["workspace-overview"]} />
                      </button>
                      {expandedSettingsPanels["workspace-overview"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          {activeWorkspace ? (
                            <>
                              <div className="flex flex-wrap gap-2">
                                <span className="settings-chip success">{activeWorkspace.plan?.toUpperCase()} desk</span>
                                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">{`${activeWorkspace.seatCount || 0}/${activeWorkspace.seatLimit || 1} seats used`}</span>
                                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border)] text-[var(--color-text-primary)]">{`Role: ${activeWorkspace.membership?.role || "member"}`}</span>
                              </div>
                              <label className="flex flex-col gap-2 w-full max-w-md" style={{ marginTop: "14px" }}>
                                <span>Workspace Name</span>
                                <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                  value={workspaceForm.name}
                                  onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, name: e.target.value }))}
                                  placeholder="Zenin Desk"
                                />
                              </label>
                              <label className="flex flex-col gap-2 w-full max-w-md">
                                <span>Workspace Slug</span>
                                <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                  value={workspaceForm.slug}
                                  onChange={(e) => setWorkspaceForm((prev) => ({ ...prev, slug: e.target.value }))}
                                  placeholder="zenin-desk"
                                />
                              </label>
                              <div className="flex gap-3 mt-2" style={{ marginTop: "12px" }}>
                                <button
                                  className={cn(buttonVariants({ variant: "default" }))}
                                  onClick={() => { void saveWorkspaceSettings(); }}
                                  disabled={workspaceBusy || !["owner", "admin"].includes(String(activeWorkspace?.membership?.role || "").toLowerCase())}
                                >
                                  {workspaceBusy ? "Saving..." : "Save Workspace"}
                                </button>
                                <button
                                  className={cn(buttonVariants({ variant: "secondary" }))}
                                  onClick={() => { void refreshWorkspacePanel(); }}
                                  disabled={workspaceBusy}
                                >
                                  Refresh
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">Workspace metadata will appear here after the signed-in desk loads.</p>
                          )}
                          {workspaceFeedback ? (
                            <p className={`text-[13px] font-medium mt-2 ${ workspaceFeedback.type === "error" ? "error" : "success" === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>{workspaceFeedback.text}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("workspace-team")}>
                        <span>Members & Invites</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["workspace-team"]} />
                      </button>
                      {expandedSettingsPanels["workspace-team"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
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
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                        value={member.role}
                                        onChange={(e) => { void updateWorkspaceMemberRole(member, e.target.value); }}
                                        disabled={workspaceBusy}
                                      >
                                        <option value="member">Member</option>
                                        <option value="admin">Admin</option>
                                      </select>
                                      <button className={cn(buttonVariants({ variant: "secondary" }))} onClick={() => { void removeWorkspaceMember(member); }} disabled={workspaceBusy}>
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
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">No workspace members yet.</p>
                          )}

                          {["owner", "admin"].includes(String(activeWorkspace?.membership?.role || "").toLowerCase()) ? (
                            <>
                              <div className="flex gap-3 mt-2" style={{ marginTop: "14px", alignItems: "flex-end" }}>
                                <label className="flex flex-col gap-2 w-full max-w-md" style={{ flex: 1 }}>
                                  <span>Invite Email</span>
                                  <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                    value={workspaceInviteForm.email}
                                    onChange={(e) => setWorkspaceInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                                    placeholder="teammate@zenin.app"
                                  />
                                </label>
                                <label className="flex flex-col gap-2 w-full max-w-md" style={{ width: "140px" }}>
                                  <span>Role</span>
                                  <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
                                    value={workspaceInviteForm.role}
                                    onChange={(e) => setWorkspaceInviteForm((prev) => ({ ...prev, role: e.target.value }))}
                                  >
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                  </select>
                                </label>
                                <button className={cn(buttonVariants({ variant: "default" }))} onClick={() => { void sendWorkspaceInvite(); }} disabled={workspaceBusy}>
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

                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("workspace-activity")}>
                        <span>Desk Activity</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["workspace-activity"]} />
                      </button>
                      {expandedSettingsPanels["workspace-activity"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
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
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">No desk activity has been recorded yet.</p>
                          )}
                        </div>
                      )}
                    </div>

                    <WorkspaceInstitutionalControlPanel activeWorkspace={activeWorkspace} />
                  </>
                )}

                {activeSettingsPanel === "Accounts" && (
                  <>
                    <div className="p-4 mb-6 text-sm text-[var(--color-text-secondary)] bg-[var(--color-surface-elevated)] border border-[var(--color-border-subtle)] rounded-md">{settingsPreviewNote}</div>
                    <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                      <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("accounts-connected")}>
                        <span>Connected Accounts</span>
                        <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["accounts-connected"]} />
                      </button>
                      {expandedSettingsPanels["accounts-connected"] && (
                        <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
                              onClick={() => setShowBrokerageFlow(true)}
                            >
                              Connect brokerage
                            </button>
                            <span className="text-[12px] text-[var(--color-text-secondary)]">Read-only SnapTrade brokerage/aggregator link where supported. Zenin cannot trade or withdraw.</span>
                          </div>
                          {connectedAccounts.length === 0 ? (
                            <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">No saved CEX, DEX, brokerage, or prediction market sources yet. Add a read-only API key, watch-only address, or SnapTrade link to preserve portfolio context; only supported providers can live sync today.</p>
                          ) : (
                            <div className="connected-accounts-list">
                              {connectedAccounts.map((acc) => {
                                const trust = getProviderTrustForAccount(acc);
                                const badge = getScopeBadge(acc);
                                const lastSyncedRel = formatRelativeTime(trust.lastSyncedAt);
                                const lastVerifiedDate = formatDateShort(trust.lastVerifiedAt);
                                const perms = trust.permissionsDetected || {};
                                const actionState = syncingAccountIdsState[acc.id];
                                const statusCopy = getConnectionStatusCopy(acc);
                                return (
                                  <div key={acc.id} className="connected-account-item connected-account-trust-item">
                                    <div className="connected-account-trust-head">
                                      <div className="connected-account-trust-title">
                                        <strong>{trust.providerLabel || acc.provider}</strong>
                                        <span className={`provider-trust-pill provider-trust-pill-${badge.tone}`}>{badge.label}</span>
                                      </div>
                                      <div className="connected-account-trust-actions">
                                        {acc.syncAvailable !== false && (
                                          <button
                                            type="button"
                                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                                            disabled={actionState === "syncing"}
                                            onClick={() => handleAccountSync(acc)}
                                          >
                                            {actionState === "syncing" ? "Syncing…" : "Sync now"}
                                          </button>
                                        )}
                                        {!isGuestUser && (
                                          <button
                                            type="button"
                                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                                            disabled={actionState === "verifying"}
                                            onClick={() => handleAccountVerifyScope(acc)}
                                          >
                                            {actionState === "verifying" ? "Verifying…" : "Re-verify scope"}
                                          </button>
                                        )}
                                        {confirmRemoveAccount?.id === acc.id ? (
                                          <div className="connected-account-confirm" role="alertdialog" aria-label="Confirm remove account">
                                            <p className="connected-account-confirm-copy">
                                              Remove <strong>{acc.exchange || acc.venueType || "this account"}</strong>?
                                              Synced holdings, trades, fills, journal entries, and related notifications for this source will be deleted. Manually entered data is kept.
                                            </p>
                                            <div className="connected-account-confirm-actions">
                                              <button
                                                type="button"
                                                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                                                onClick={() => setConfirmRemoveAccount(null)}
                                              >
                                                Cancel
                                              </button>
                                              <button
                                                type="button"
                                                className="settings-mini-btn settings-mini-btn-danger"
                                                onClick={() => {
                                                  const pending = confirmRemoveAccount;
                                                  setConfirmRemoveAccount(null);
                                                  handleAccountRemove(pending);
                                                }}
                                              >
                                                Remove account &amp; synced data
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            className="settings-mini-btn settings-mini-btn-danger"
                                            onClick={() => setConfirmRemoveAccount(acc)}
                                          >
                                            Remove
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <p className="connected-account-trust-meta">
                                      {acc.username} · {String(acc.venueType || "source").toUpperCase()}
                                      {lastSyncedRel ? ` · Last synced ${lastSyncedRel}` : ""}
                                      {lastVerifiedDate ? ` · Scope verified ${lastVerifiedDate}` : " · Scope not yet verified"}
                                    </p>
                                    <div className="connected-account-permissions">
                                      <span className="connected-account-permissions-label">Detected permissions:</span>
                                      <ul className="connected-account-permissions-list">
                                        <li className={perms.canReadBalances ? "perm-ok" : "perm-no"}>
                                          {perms.canReadBalances ? "✓" : "✕"} Read balances
                                        </li>
                                        <li className={perms.canReadTrades ? "perm-ok" : "perm-no"}>
                                          {perms.canReadTrades ? "✓" : "✕"} Read trade history
                                        </li>
                                        <li className={perms.canTrade ? "perm-warn" : "perm-ok"}>
                                          {perms.canTrade ? "✓" : "✕"} Place trades
                                        </li>
                                        <li className={perms.canWithdraw ? "perm-warn" : "perm-ok"}>
                                          {perms.canWithdraw ? "✓" : "✕"} Withdraw funds
                                        </li>
                                      </ul>
                                    </div>
                                    <div className="connected-account-proof">
                                      <p className="connected-account-proof-head">
                                        {trust.cannotTrade && trust.cannotWithdraw
                                          ? "Zenin cannot trade or withdraw from this account."
                                          : "Zenin may be able to trade or withdraw from this account."}
                                      </p>
                                      <p className="connected-account-proof-detail">{trust.message || statusCopy.detail}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <button className={cn(buttonVariants({ variant: "default" }))} onClick={openConnectWindow}>
                            Add Account
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {activeSettingsPanel === "Notification" && (
                  <div className="border border-[var(--color-border)] rounded-md mb-4 overflow-hidden">
                    <button className="flex w-full justify-between items-center px-5 py-4 bg-[var(--color-surface-elevated)] text-[var(--fs-base)] font-medium text-[var(--color-text-primary)] border-none cursor-pointer" onClick={() => toggleSettingsPanel("notifications-channels")}>
                      <span>Notification Channels</span>
                      <ChevronRight className="settings-chevron" data-open={expandedSettingsPanels["notifications-channels"]} />
                    </button>
                    {expandedSettingsPanels["notifications-channels"] && (
                      <div className="flex flex-col gap-4 p-5 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
                        <label className="settings-toggle-row">
                          <span>Email notifications</span>
                          <Switch
                            className="settings-notification-switch"
                            checked={effectiveEmailNotificationsEnabled}
                            disabled={!canUseEmailNotifications}
                            onCheckedChange={(v) => {
                              void handleNotificationPreferenceToggle("notifyEmail", v);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Browser notifications</span>
                          <Switch
                            className="settings-notification-switch"
                            checked={effectiveBrowserNotificationsEnabled}
                            disabled={!browserNotificationsSupported || browserNotificationsBlocked}
                            onCheckedChange={(v) => {
                              void handleNotificationPreferenceToggle("notifyBrowser", v);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Price alerts</span>
                          <Switch
                            className="settings-notification-switch"
                            checked={preferences.notifyPriceAlerts}
                            onCheckedChange={(v) => {
                              void handleNotificationPreferenceToggle("notifyPriceAlerts", v);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Trade &amp; account activity</span>
                          <Switch
                            className="settings-notification-switch"
                            checked={preferences.notifyOrderEvents}
                            onCheckedChange={(v) => {
                              void handleNotificationPreferenceToggle("notifyOrderEvents", v);
                            }}
                          />
                        </label>
                        <label className="settings-toggle-row">
                          <span>Market news digests</span>
                          <Switch
                            className="settings-notification-switch"
                            checked={preferences.notifyNews}
                            onCheckedChange={(v) => {
                              void handleNotificationPreferenceToggle("notifyNews", v);
                            }}
                          />
                        </label>
                        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0" style={{ marginTop: "12px" }}>
                          Email destination: {isGuestUser
                            ? "Sign in required"
                            : emailNotificationDestination || "Add a profile email"}
                          {!isGuestUser && profileSecurity?.emailVerified === false ? " · Verification required" : ""}
                        </p>
                        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                          Browser permission: {browserNotificationStatusLabel}
                          {!browserNotificationsSupported ? " · Not supported in this browser" : ""}
                        </p>
                        <h4 className="settings-section-subtitle" style={{ marginTop: "18px" }}>
                          Popup granularity
                        </h4>
                        <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed m-0">
                          Fine-tune which in-app popups appear for synced activity (separate from the delivery channels above).
                        </p>
                        <NotificationPreferences />
                        <div className="flex gap-3 mt-2" style={{ marginTop: "12px" }}>
                          <button
                            className={cn(buttonVariants({ variant: "secondary" }))}
                            onClick={() => {
                              void handleNotificationPreferenceToggle("notifyBrowser", true);
                            }}
                            disabled={!browserNotificationsSupported || browserNotificationsGranted || browserNotificationsBlocked}
                          >
                            {browserNotificationsGranted ? "Browser Ready" : "Enable Browser Alerts"}
                          </button>
                          <button
                            className={cn(buttonVariants({ variant: "secondary" }))}
                            onClick={() => {
                              void sendTestBrowserNotification();
                            }}
                            disabled={!effectiveBrowserNotificationsEnabled || !browserNotificationsGranted}
                          >
                            Send Test Notification
                          </button>
                        </div>
                        {notificationFeedback?.text ? (
                          <p className={`text-[13px] font-medium mt-2 ${ notificationFeedback.type === "error" ? "error" : notificationFeedback.type === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
                            {notificationFeedback.text}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            {isPersonaOnboardingOpen && (
              <Suspense fallback={null}>
                <PersonaOnboardingModal
                  open={isPersonaOnboardingOpen}
                  isGuestUser={isGuestUser}
                  onClose={() => setIsPersonaOnboardingOpen(false)}
                  onSelect={({ sectionOrder }) => {
                    if (Array.isArray(sectionOrder) && sectionOrder.length) {
                      setPersonaSectionOrder(sectionOrder);
                    }
                  }}
                />
              </Suspense>
            )}

            {isConnectWindowOpen && (
              <div className="connect-account-overlay" onClick={() => setIsConnectWindowOpen(false)}>
                <div className={`connect-account-window ${connectPromptMode === "onboarding" ? "is-onboarding" : ""}`} onClick={(e) => e.stopPropagation()}>
                  <div className="connect-account-shell">
                    <aside className="connect-account-trust-panel">
                      <div className="connect-account-kicker">Secure setup</div>
                      <h2>{connectPromptMode === "onboarding" ? "Add your first source" : "Add another source"}</h2>
                      <p>
                        Save centralized-exchange read-only API keys, Hyperliquid watch-only addresses, or brokerage links through SnapTrade where supported. Supported providers can sync holdings and fills now; the rest are stored as metadata until adapters ship.
                      </p>
                      <div className="connect-account-trust-grid">
                        <div className="connect-account-trust-card">
                          <span>Access model</span>
                          <strong>Read-only only</strong>
                          <em>No action permissions. No withdrawal permissions. Hyperliquid uses address watch only.</em>
                        </div>
                        <div className="connect-account-trust-card">
                          <span>Coverage</span>
                          <strong>Sync where supported</strong>
                          <em>Binance, Bybit, Hyperliquid, and IBKR can import data today. Other venues are metadata only.</em>
                        </div>
                      </div>
                      <div className="connect-account-security-list">
                        <div>
                          <strong>Controlled access</strong>
                          <span>Use least-privilege credentials. Zenin labels CEX keys read-only only after provider-side scope checks are clear.</span>
                        </div>
                        <div>
                          <strong>Encrypted storage</strong>
                          <span>Account keys stay in your private workspace and are used only for portfolio data sync.</span>
                        </div>
                        <div>
                          <strong>Start with one venue</strong>
                          <span>Pick a live-sync provider for imported holdings, or save any listed venue as read-only context.</span>
                        </div>
                      </div>
                      <div className="connect-account-provider-preview">
                        {onboardingVenuePreview.map((venue) => {
                          const canSync = SYNC_ENABLED_PROVIDERS.has(normalizeProviderId(venue));
                          return (
                            <span key={venue} className={canSync ? "can-sync" : "save-only"}>
                              {venue}
                              <em>{canSync ? "Live sync" : "Metadata"}</em>
                            </span>
                          );
                        })}
                      </div>
                    </aside>

                    <section className="connect-account-form-panel">
                      <div className="connect-account-header">
                        <div>
                          <span>{connectPromptMode === "onboarding" ? "Finish setup" : "Account link"}</span>
                          <strong>{connectPromptMode === "onboarding" ? "Choose a useful first source" : "Add a read-only source"}</strong>
                        </div>
                        <button className="text-2xl text-[var(--color-text-muted)] hover:text-white cursor-pointer ml-4 leading-none bg-transparent border-none p-1" onClick={() => setIsConnectWindowOpen(false)} aria-label="Close connect account modal">&times;</button>
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
                                <span>Activity</span>
                                <strong>{connectAccountSuccess.tradesCount}</strong>
                              </div>
                            </div>
                            <div className="connect-account-actions">
                              <button
                                className="portfolio-command-primary-cta subtle connect-account-secondary"
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
                                className="portfolio-command-primary-cta subtle primary-emphasis connect-account-primary"
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
                            <span>Access</span>
                            <strong className="status-value">{selectedProviderIsHyperliquid ? "Verified watch-only address" : "Read-only required, scope unverified"}</strong>
                          </div>
                          <div>
                            <span>{selectedProviderSyncLabel}</span>
                            <strong className="status-value">{selectedProviderSyncHelp}</strong>
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

                        <label className="flex flex-col gap-2 w-full max-w-md">
                          <span className="field-label-strong">Provider</span>
                          <select
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                            {venueOptions.map((venue) => {
                              const isComingSoon = COMING_SOON_PROVIDERS.has(normalizeProviderId(venue));
                              return (
                                <option key={venue} value={venue} disabled={isComingSoon}>
                                  {venue}{isComingSoon ? " — Soon" : ""}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <label className="flex flex-col gap-2 w-full max-w-md">
                          <span className="field-label-strong">Account label</span>
                          <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                        <label className="flex flex-col gap-2 w-full max-w-md">
                          <span className="field-label-strong">{apiKeyFieldLabel}</span>
                          <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                          <label className="flex flex-col gap-2 w-full max-w-md">
                            <span>API Secret</span>
                            <input
                                className="flex h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
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
                                ? "Use read-only credentials only. Zenin verifies supported exchange scopes before saving live-sync keys."
                                : "This provider is saved as metadata only. It will not import balances or fills until a provider adapter is available."}
                          </p>
                        )}

                        <div className="connect-account-actions">
                          <button
                            className="portfolio-command-primary-cta subtle connect-account-secondary"
                            onClick={() => setIsConnectWindowOpen(false)}
                            disabled={isSyncingAccount}
                          >
                            {connectPromptMode === "onboarding" ? "Skip for now" : "Cancel"}
                          </button>
                          <button
                            className="portfolio-command-primary-cta subtle primary-emphasis connect-account-primary"
                            onClick={connectAccount}
                            disabled={isSyncingAccount || !accountForm.apiKey.trim() || (showApiSecretField && !accountForm.apiSecret.trim())}
                          >
                            {isSyncingAccount ? (selectedProviderCanSync ? "Syncing..." : "Saving...") : (selectedProviderCanSync ? "Save and sync" : "Save metadata")}
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
      <NotificationCenter
        open={isNotificationCenterOpen}
        onOpenChange={(open) => {
          if (open) setIsNotificationCenterOpen(true);
          else closeNotifications();
        }}
        notifications={workspaceNotifications}
        allOpen={isNotificationInboxOpen}
        onAllOpenChange={(open) => {
          if (open) openAllNotifications();
          else closeAllNotifications();
        }}
        unreadCount={unreadNotificationCount}
        loading={notificationCenterLoading}
        error={notificationCenterError}
        onRefresh={() => { void refreshWorkspaceNotifications(); }}
        onMarkRead={(notification) => { void markWorkspaceNotificationRead(notification); }}
        onMarkAllRead={() => { void markAllWorkspaceNotificationsRead(); }}
        onNavigate={(notification) => { void navigateFromWorkspaceNotification(notification); }}
      />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={closeGlobalSearch}
        commands={paletteCommands}
        assetSearch={debouncedSearchAssetsLive}
        onSelectAsset={(asset) => {
          if (!asset) return;
          const kind = String(asset.kind || "").toLowerCase();
          const sym = String(asset.symbol || "").toUpperCase();
          if (kind === "commodity") openCommodityResearch({ symbol: sym });
          else if (kind === "company" || kind === "stock") openCompanyProfile({ symbol: sym, name: asset.name, type: "stock" });
          else setSelectedAsset({ symbol: sym, type: kind, marketType: kind, category: asset.category });
        }}
      />
      <Suspense fallback={null}>
        <SpeedInsights />
        <Analytics />
      </Suspense>
      <Toaster />
      <FirstSessionWelcome />
      </div>
    </TransmissionExplorerProvider>
    </WorkspaceScopeProvider>
    </IndicatorActionsProvider>
    </ToastProvider>
  );
}

export default App;
