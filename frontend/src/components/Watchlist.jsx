import { useEffect, useMemo, useState } from "react";
import { DataHealthBadge } from "@/components/ui/async-state";
import { DataTable } from "./data-table/DataTable";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { IndicatorMetricsTable } from "./IndicatorMetricsTable";
import { IndicatorMetricModal } from "./IndicatorMetricModal";
import { zeninFetchJson } from "../utils/zeninFetch";
import { getCurrencySymbol, inferAssetCurrency } from "../utils/currencyUtils";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { normalizeInstrumentSymbol, resolveCurrencyInstrument } from "../utils/currencyInstruments.js";
import { ContextRail, DensePanelHeader, GuidedEmptyState, InlineControlGroup, WorkspaceMetricStrip, WorkspacePageHeader } from "./CompactWorkspaceUI";
import { IntelligenceCenter } from "./intelligence/index.jsx";
import { SharedWatchlistWorkspacePanel } from "./InstitutionalPanels";
import { PlanLockOverlay } from "./PlanLockOverlay";
import {
  UNSUPPORTED_IMPORT_EXTENSIONS,
  parseWatchlistImportPayload
} from "../utils/watchlistImportParser";
const MACRO_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EARNINGS_CLIENT_CACHE_TTL_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
const WATCHLIST_IMPORT_SOURCES = [
  { key: "notion", label: "Notion", hint: "Use a Notion database CSV export, or paste rows from a Notion table." },
  { key: "spreadsheet", label: "Spreadsheet", hint: "Use CSV or TSV from Excel, Google Sheets, Numbers, or Airtable." },
  { key: "platform", label: "Platform", hint: "Paste a brokerage, TradingView, or exchange list with one symbol per row." },
  { key: "document", label: "Document", hint: "Upload or paste a text, Markdown, CSV, TSV, or JSON document." }
];



const sanitizeMacroSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const allowed = new Set(getAppRuntimeConfig()?.analytics?.allowedMacroIndicatorKeys || []);
  const metrics = Array.isArray(snapshot.metrics)
    ? snapshot.metrics.filter((row) => allowed.has(String(row?.key || "")))
    : [];
  return { ...snapshot, metrics };
};

const hasUsableEarningsPayload = (payload) => {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.some((item) => item?.nextEarnings || item?.earningsText);
};

export function Watchlist({
  categories,
  activeCategory,
  onCategorySelect,
  assets,
  watchlistAssets = [],
  onAdd,
  loading,
  activeTheme,
  onThemeSelect,
  stockThemes = [],
  isInWatchlist,
  onToggleStar,
  onImportAssets,
  onRefresh,
  onPageChange,
  liveStatus = "idle",
  lastLivePriceAt = null,
  isGuestMode = false,
  onIntent,
  alertAssignments = [],
  alertsLoading = false,
  onLoadAlertAssignments,
  onUpdateAlertAssignment,
  currentUserId = "",
  hasDeskFeatureAccess = false,
  sharedWatchlistLocked = false,
  lockedPlanLabel = "desk",
  onUpgrade,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("list"); // "grid" or "list"
  const [isDense, setIsDense] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("zenin_watchlist_dense") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("zenin_watchlist_dense", isDense ? "1" : "0");
  }, [isDense]);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [localRefreshNonce, setLocalRefreshNonce] = useState(0);
  const [selectedIntentAsset, setSelectedIntentAsset] = useState(null);
  const [alertActionBusy, setAlertActionBusy] = useState({});
  const [earningsItems, setEarningsItems] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsStale, setEarningsStale] = useState(false);
  const [earningsNotice, setEarningsNotice] = useState("");
  const [isEarningsOpen, setIsEarningsOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 1100 : true));
  // Configurable alert threshold (in % absolute) — exposes the previously hardcoded |change| >= 2.
  const [alertThresholdPct, setAlertThresholdPct] = useState(() => {
    if (typeof window === "undefined") return 2;
    const raw = localStorage.getItem("zenin_watchlist_alert_threshold_pct");
    const num = Number(raw);
    return Number.isFinite(num) ? num : 2;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem("zenin_watchlist_alert_threshold_pct", String(alertThresholdPct));
  }, [alertThresholdPct]);
  const [indicatorCountry, setIndicatorCountry] = useState("");
  const [macroSnapshot, setMacroSnapshot] = useState(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [macroStale, setMacroStale] = useState(false);
  const [macroNotice, setMacroNotice] = useState("");
  const [macroByCountry, setMacroByCountry] = useState({});
  const [selectedIndicatorMetric, setSelectedIndicatorMetric] = useState(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importSource, setImportSource] = useState("notion");
  const [importText, setImportText] = useState("");
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const normalizeSymbol = (value) => String(value || "").trim().toUpperCase();
  const normalizeMarketType = (value) => String(value || "").trim().toLowerCase() || "spot";
  const normalizeCategory = (value) => String(value || "").trim().toLowerCase();
  const normalizeTheme = (value) => String(value || "").trim().toLowerCase();
  const resolveWatchlistCategory = (asset) => {
    const kind = normalizeAssetKind(asset);
    if (kind === "etf") return "etfs";
    if (kind === "stock") return "stocks";
    if (kind === "crypto") return "crypto";
    if (kind === "bond") return "bonds";
    if (kind === "indicator") return "indicators";
    if (kind === "commodity") return "commodities";
    if (kind === "forex" || kind === "currency") return "currencies";
    
    // Fallback
    const explicitCategory = normalizeCategory(asset?.category);
    if (explicitCategory) return explicitCategory;
    return kind;
  };
  const normalizeAssetKind = (asset) => {
    const rawType = String(asset?.type || "").trim().toLowerCase();
    const rawCategory = normalizeCategory(asset?.category);
    const marketType = normalizeMarketType(asset?.marketType);
    if (["stock", "stocks", "equity"].includes(rawType)) return "stock";
    if (["etf", "etfs"].includes(rawType)) return "etf";
    if (rawType === "crypto" || marketType === "spot") return "crypto";
    if (rawType === "indicator" || rawCategory === "indicators" || marketType === "macro") return "indicator";
    if (rawType === "bond" || rawCategory === "bonds") return "bond";
    if (["commodity", "commodities", "metal", "metals"].includes(rawType) || ["commodities", "metals"].includes(rawCategory)) return "commodity";
    // FX pair or currency code (curated universe).
    if (rawType === "forex" || rawType === "currency" || rawType === "fx" || rawCategory === "currencies" || marketType === "forex") {
      // Disambiguate: a slash pair or =X provider form is an FX pair, else a code.
      const sym = normalizeInstrumentSymbol(asset?.symbol || asset?.name || rawType);
      const inst = resolveCurrencyInstrument(sym);
      return inst?.kind || "currency";
    }
    if (asset?.theme || rawCategory === "stocks") return "stock";
    return rawType || "stock";
  };
  const buildAssetMetaKey = (asset) => (
    [
      normalizeSymbol(asset?.symbol),
      normalizeMarketType(asset?.marketType),
      normalizeCategory(asset?.category),
      normalizeTheme(asset?.theme)
    ].join("::")
  );
  const buildAssetSymbolKey = (asset) => (
    [
      normalizeSymbol(asset?.symbol),
      normalizeMarketType(asset?.marketType)
    ].join("::")
  );
  const isCacheFresh = (cacheEntry, ttlMs) => {
    if (!cacheEntry?.updatedAt) return false;
    const updatedAtMs = new Date(cacheEntry.updatedAt).getTime();
    if (!Number.isFinite(updatedAtMs)) return false;
    return Date.now() - updatedAtMs < ttlMs;
  };

  const mergedStockThemes = (() => {
    const seen = new Set();
    return [...(Array.isArray(stockThemes) ? stockThemes : [])]
      .map((theme) => String(theme || "").trim())
      .filter((theme) => {
        if (!theme) return false;
        const key = theme.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  })();

  const orderMap = new Map(
    (Array.isArray(watchlistAssets) ? watchlistAssets : []).map((entry, index) => [
      buildAssetMetaKey(entry),
      index
    ])
  );

  const getWatchlistOrder = (asset) => {
    const exactKey = buildAssetMetaKey(asset);
    if (orderMap.has(exactKey)) return orderMap.get(exactKey);
    const symbol = normalizeSymbol(asset.symbol);
    const marketType = normalizeMarketType(asset.marketType);
    let fallback = Number.MAX_SAFE_INTEGER;
    orderMap.forEach((idx, key) => {
      if (key.startsWith(`${symbol}::${marketType}::`)) fallback = Math.min(fallback, idx);
    });
    return fallback;
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [activeCategory, activeTheme]);

  useEffect(() => {
    if (typeof onLoadAlertAssignments !== "function") return;
    onLoadAlertAssignments();
    // Refresh alert assignments when the visible page changes so status badges stay current.
  }, [activeCategory, currentPage, alertThresholdPct]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleResize = () => {
      if (window.innerWidth <= 1100) {
        setIsEarningsOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (activeCategory !== "indicators") {
      setIndicatorCountry("");
      setMacroSnapshot(null);
      setMacroStale(false);
      setSelectedIndicatorMetric(null);
    }
  }, [activeCategory]);

  useEffect(() => {
    setSelectedIndicatorMetric(null);
  }, [indicatorCountry]);

  useEffect(() => {
    if (!isImportOpen) return;
    const nextRows = parseWatchlistImportPayload(importText, activeCategory || "stocks");
    setImportRows(nextRows);
    setImportError(importText.trim() && nextRows.length === 0 ? "No watchlist symbols found yet. Use a Symbol/Ticker column or one symbol per line." : "");
  }, [activeCategory, importText, isImportOpen]);

  const assetCatalogByMeta = useMemo(
    () => new Map((Array.isArray(assets) ? assets : []).map((asset) => [buildAssetMetaKey(asset), asset])),
    [assets]
  );
  const assetCatalogBySymbol = useMemo(() => {
    const next = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const key = buildAssetSymbolKey(asset);
      if (!next.has(key)) next.set(key, asset);
    });
    return next;
  }, [assets]);
  const assetCatalogBySymbolLoose = useMemo(() => {
    const next = new Map();
    (Array.isArray(assets) ? assets : []).forEach((asset) => {
      const key = normalizeSymbol(asset?.symbol);
      if (!key) return;
      if (!next.has(key)) next.set(key, asset);
    });
    return next;
  }, [assets]);

  const doesEntryBelongToActiveCategory = (entry) => {
    return resolveWatchlistCategory(entry) === normalizeCategory(activeCategory);
  };

  const starredAssets = useMemo(() => {
    const hasWatchlistEntries = Array.isArray(watchlistAssets) && watchlistAssets.length > 0;
    const source = hasWatchlistEntries
      ? watchlistAssets
      : (Array.isArray(assets) ? assets : []).filter((asset) => doesEntryBelongToActiveCategory(asset));
    return source
      .filter((entry) => doesEntryBelongToActiveCategory(entry))
      .map((entry) => {
        const exactCatalogAsset = assetCatalogByMeta.get(buildAssetMetaKey(entry));
        const fallbackCatalogAsset = assetCatalogBySymbol.get(buildAssetSymbolKey(entry));
        const looseCatalogAsset = assetCatalogBySymbolLoose.get(normalizeSymbol(entry?.symbol));
        const marketAsset = exactCatalogAsset || fallbackCatalogAsset || looseCatalogAsset || null;
        return {
          ...(marketAsset || {}),
          ...entry,
          name: entry?.name || marketAsset?.name || entry?.symbol || "Unknown",
          type: entry?.type || marketAsset?.type || "stock",
          category: entry?.category || marketAsset?.category || activeCategory,
          theme: entry?.theme || marketAsset?.theme || null,
          marketType: entry?.marketType || marketAsset?.marketType || "spot",
          market: entry?.market || marketAsset?.market || null,
          price: marketAsset?.price ?? entry?.price ?? null,
          priceChangePercent: marketAsset?.priceChangePercent ?? entry?.priceChangePercent ?? null
        };
      })
      .sort((a, b) => getWatchlistOrder(a) - getWatchlistOrder(b));
  }, [watchlistAssets, activeCategory, assetCatalogByMeta, assetCatalogBySymbol, assetCatalogBySymbolLoose]);

  // Derive displayed assets based on selected stock theme after watchlist filter.
  const displayedAssets =
    activeCategory === "stocks" && activeTheme && activeTheme !== "All"
      ? starredAssets.filter(
          (a) => normalizeTheme(a.theme) === normalizeTheme(activeTheme)
        )
      : starredAssets;
  // Default ordering: alphabetical by Symbol (ascending). The manual SORT
  // toolbar above the table was removed, so the blotter is now sorted by
  // default rather than relying on the user to pick a sort column.
  const sortedAssets = useMemo(() => {
    return [...displayedAssets].sort((a, b) =>
      String(a?.symbol || "").localeCompare(String(b?.symbol || ""))
    );
  }, [displayedAssets]);
  const emptyStateTitle = activeTheme && activeTheme !== "All"
    ? `No ${activeTheme} names in this cut`
    : `No ${String(activeCategory || "watchlist")} rows yet`;
  const emptyStateDescription = activeTheme && activeTheme !== "All"
    ? "This theme filter currently has no tracked names. Reset the theme or star symbols to build a desk-ready list."
    : `Build this ${activeCategory} watchlist by starring names, switching categories, or saving a shared desk view.`;
  const emptyStateSteps = activeTheme && activeTheme !== "All"
    ? [
        "Reset the theme filter to review the broader category.",
        "Star the symbols you want to keep in this desk list.",
      ]
    : [
        "Browse the current category and star the names you care about.",
        "Save the shared view once the desk list reflects your active focus.",
      ];

  const indicatorWatchlistCountries = useMemo(() => {
    return (Array.isArray(watchlistAssets) ? watchlistAssets : [])
      .filter((entry) => normalizeAssetKind(entry) === "indicator")
      .map((entry) => ({
        ...entry,
        symbol: normalizeSymbol(entry.symbol),
        name: String(entry.name || entry.symbol || "").replace(/\s+macro indicators$/i, "").trim() || normalizeSymbol(entry.symbol)
      }))
      .sort((a, b) => getWatchlistOrder(a) - getWatchlistOrder(b));
  }, [watchlistAssets]);

  const itemsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(sortedAssets.length / itemsPerPage));
  const pagedAssets = sortedAssets.slice(
  (currentPage - 1) * itemsPerPage,
  currentPage * itemsPerPage
);
const pageSymbols = pagedAssets.map((a) => a.symbol).join(",");

  const activeIndicator = useMemo(
    () => indicatorWatchlistCountries.find((country) => country.symbol === indicatorCountry) || null,
    [indicatorCountry, indicatorWatchlistCountries]
  );

  const earningsSymbols = useMemo(
    () => (
      activeCategory === "stocks"
        ? [...new Set(pagedAssets.map((a) => normalizeSymbol(a?.symbol)).filter(Boolean))]
        : []
    ),
    [activeCategory, pagedAssets]
  );
  const earningsRows = useMemo(() => {
    const bySymbol = new Map(
      (Array.isArray(earningsItems) ? earningsItems : [])
        .map((item) => [normalizeSymbol(item?.symbol), item])
        .filter(([symbol]) => Boolean(symbol))
    );
    return earningsSymbols.map((symbol) => ({
      symbol,
      item: bySymbol.get(symbol) || null
    }));
  }, [earningsItems, earningsSymbols]);

useEffect(() => {
  onPageChange?.(currentPage, pageSymbols ? pageSymbols.split(",") : []);
}, [currentPage, activeTheme, activeCategory, pageSymbols]);

  useEffect(() => {
    if (activeCategory !== "indicators") return;
    if (indicatorWatchlistCountries.length === 0) {
      setIndicatorCountry("");
      setMacroSnapshot(null);
      setMacroStale(false);
      setMacroNotice("");
      return;
    }
    if (!indicatorCountry || !indicatorWatchlistCountries.some((country) => country.symbol === indicatorCountry)) {
      setIndicatorCountry(indicatorWatchlistCountries[0].symbol);
    }
  }, [activeCategory, indicatorCountry, indicatorWatchlistCountries]);

  useEffect(() => {
    if (activeCategory !== "indicators" || !indicatorCountry) return;

    let isMounted = true;
    const controller = new AbortController();
    const now = Date.now();
    const stateCachedEntry = macroByCountry[indicatorCountry];
    const storageCached = readResilientCache("macro-indicators", { country: indicatorCountry });
    const cachedPayload = sanitizeMacroSnapshot(stateCachedEntry?.data || storageCached?.payload || null);
    const cachedAt = Number(stateCachedEntry?.cachedAt || (storageCached?.updatedAt ? new Date(storageCached.updatedAt).getTime() : 0));
    if (cachedPayload) {
      setMacroSnapshot(cachedPayload);
      setMacroStale(Boolean(cachedPayload?.stale || cachedPayload?.unavailable));
      setMacroNotice(Boolean(cachedPayload?.stale || cachedPayload?.unavailable) ? getSnapshotFallbackMessage(cachedPayload) : "");
      if (now - cachedAt < MACRO_CLIENT_CACHE_TTL_MS) {
        setMacroLoading(false);
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchMacro = async () => {
      setMacroLoading(true);
      try {
        const data = await zeninFetchJson(`/macro-indicators?country=${encodeURIComponent(indicatorCountry)}`, {
          signal: controller.signal
        });
        if (!isMounted) return;
        const sanitized = sanitizeMacroSnapshot(data || null);
        setMacroSnapshot(sanitized);
        setMacroStale(Boolean(sanitized?.stale || sanitized?.unavailable));
        setMacroNotice(Boolean(sanitized?.stale || sanitized?.unavailable) ? getSnapshotFallbackMessage(sanitized) : "");
        setMacroByCountry((prev) => ({
          ...prev,
          [indicatorCountry]: {
            data: sanitized,
            cachedAt: Date.now()
          }
        }));
        writeResilientCache("macro-indicators", { country: indicatorCountry }, sanitized);
      } catch (err) {
        if (err?.name === "AbortError" || err?.code === "REQUEST_ABORTED") return;
        if (!isMounted) return;
        if (!cachedPayload) setMacroSnapshot(null);
        setMacroStale(true);
        const message = err?.message ? String(err.message) : "";
        setMacroNotice(cachedPayload ? getSnapshotFallbackMessage(cachedPayload) : (message || "Macro indicators unavailable right now."));
      } finally {
        if (isMounted) setMacroLoading(false);
      }
    };

    fetchMacro();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, indicatorCountry, localRefreshNonce]);

  useEffect(() => {
    if (activeCategory !== "stocks") return;
    if (!earningsSymbols.length) {
      setEarningsItems([]);
      setEarningsStale(false);
      setEarningsNotice("");
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const cacheParams = { symbols: earningsSymbols };
    const cached = readResilientCache("earnings-calendar", cacheParams);
    const cacheIsFresh =
      isCacheFresh(cached, EARNINGS_CLIENT_CACHE_TTL_MS) &&
      hasUsableEarningsPayload(cached.payload);
    if (cached?.payload && Array.isArray(cached.payload?.items)) {
      setEarningsItems(cached.payload.items);
      setEarningsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
      setEarningsNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
      if (cacheIsFresh && !cached.payload?.stale && !cached.payload?.unavailable) {
        setEarningsLoading(false);
        return () => {
          isMounted = false;
          controller.abort();
        };
      }
    }

    const fetchEarningsCalendar = async () => {
      setEarningsLoading(true);
      try {
        const params = new URLSearchParams({
          symbols: earningsSymbols.join(","),
          limit: String(Math.max(1, earningsSymbols.length))
        });
        const data = await zeninFetchJson(`/earnings-calendar?${params.toString()}`, {
          signal: controller.signal
        });
        if (!isMounted) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        setEarningsItems(items);
        setEarningsStale(Boolean(data?.stale || data?.unavailable));
        setEarningsNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("earnings-calendar", cacheParams, data || { items });
      } catch (err) {
        if (err?.name === "AbortError" || err?.code === "REQUEST_ABORTED") return;
        if (!isMounted) return;
        if (!cached?.payload?.items) setEarningsItems([]);
        setEarningsStale(true);
        setEarningsNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
      } finally {
        if (isMounted) setEarningsLoading(false);
      }
    };

    fetchEarningsCalendar();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [activeCategory, earningsSymbols.join(","), localRefreshNonce]);

  const formatEarningsDate = (value) => {
    if (!value) return "No upcoming date";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const formatAssetPrice = (asset) => {
    if (asset?.price == null) return "—";
    const isWhole = asset?.currency === "JPY" || asset?.marketType === "spot";
    const prefix = asset?.market === "Treasury" ? "" : getCurrencySymbol(inferAssetCurrency(asset));
    const suffix = asset?.market === "Treasury" ? "%" : "";
    return `${prefix}${Number(asset.price).toLocaleString(undefined, {
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: isWhole ? 0 : 2,
    })}${suffix}`;
  };

  const getSessionLabel = (asset) => {
    if (asset?.isMarketOpen === false) return "Closed";
    if (liveStatus === "connected" && asset?._liveUpdatedAt) return "Live";
    if (liveStatus === "degraded") return "Polling";
    return asset?.marketType ? String(asset.marketType).toUpperCase() : "Tracked";
  };

  // ── §5 Watchlist row quote-status contract ────────────────────────────────
  // Derives a trustworthy provenance state from the real signals already on the
  // row: live feed status (liveStatus) and the last live tick (_liveUpdatedAt).
  // Never infers "Live" when provenance metadata is missing.
  const QUOTE_STALE_MS = 60 * 1000;
  const deriveQuoteStatus = (asset, status = liveStatus, now = Date.now()) => {
    const price = asset?.price != null;
    const tick = asset?._liveUpdatedAt ? Number(asset._liveUpdatedAt) : null;
    const tickAge = tick != null ? now - tick : null;
    if (!price) {
      return { state: "unavailable", source: null, asOf: null, reason: "No quote available" };
    }
    if (status === "connected" && tick != null && tickAge != null && tickAge <= QUOTE_STALE_MS) {
      return { state: "live", source: "Live feed", asOf: tick, reason: null };
    }
    if (tick != null && tickAge != null && tickAge > QUOTE_STALE_MS) {
      return { state: "stale", source: "Catalog", asOf: tick, reason: "Last tick older than 60s" };
    }
    if (status === "idle" && tick == null) {
      return { state: "unknown", source: null, asOf: null, reason: "Provenance unknown" };
    }
    return { state: "cached", source: "Catalog", asOf: null, reason: "Snapshot, no live tick this session" };
  };
  const QUOTE_STATUS_LABEL = {
    live: "Live",
    cached: "Cached",
    stale: "Stale",
    unavailable: "Unavailable",
    unknown: "Status unknown",
  };
  const QuoteStatusBadge = ({ asset }) => {
    const s = deriveQuoteStatus(asset);
    const label = QUOTE_STATUS_LABEL[s.state] || "Status unknown";
    // MyStocks rows carry the provider flag from the backend; surface it so the
    // provenance label reads "Live · MyStocks" etc. (spec §2 labelling).
    const providerTag = asset?.provider === "mystocks" ? "MyStocks" : null;
    const detail = [
      s.source ? `Source: ${s.source}` : null,
      s.asOf ? `As-of: ${new Date(s.asOf).toLocaleTimeString()}` : null,
      s.reason ? s.reason : null,
    ].filter(Boolean).join(" · ");
    return (
      <span
        className={`quote-status quote-status-${s.state}`}
        role="status"
        aria-label={`Quote ${label}${providerTag ? `, ${providerTag}` : ""}${detail ? `, ${detail}` : ""}`}
        title={detail || label}
      >
        {label}{providerTag ? ` · ${providerTag}` : ""}
      </span>
    );
  };

  const getGuestSignupHref = () => {
    if (typeof window === "undefined") return "/auth?mode=signup&next=%2Fapp%3Fsection%3Dwatchlist";
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `/auth?mode=signup&next=${encodeURIComponent(next || "/app?section=watchlist")}`;
  };

  const handleIntent = (asset, intent = "inspect") => {
    setSelectedIntentAsset(asset);
    onIntent?.(asset, intent);
    if (intent === "inspect") onAdd?.(asset);
  };

  const buildAlertKey = (asset) => {
    const symbol = normalizeSymbol(asset?.symbol || "");
    return `watchlist:${symbol}:${asset?.marketType || "spot"}:${asset?.category || activeCategory || "watchlist"}:${asset?.theme || "default"}`;
  };
  const alertAssignmentMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(alertAssignments) ? alertAssignments : []).forEach((assignment) => {
      if (assignment?.alertKey) map.set(assignment.alertKey, assignment);
    });
    return map;
  }, [alertAssignments]);
  const getAlertAssignment = (asset) => alertAssignmentMap.get(buildAlertKey(asset)) || null;

  const handleAlertAction = async (asset, action) => {
    if (typeof onUpdateAlertAssignment !== "function") return;
    const key = buildAlertKey(asset);
    const symbol = normalizeSymbol(asset?.symbol || "");
    setAlertActionBusy((prev) => ({ ...prev, [key]: action }));
    try {
      const existing = getAlertAssignment(asset);
      const base = {
        action,
        status: "open",
        assignedToUserId: null,
        snoozedUntil: null
      };
      if (action === "assign") {
        base.assignedToUserId = currentUserId ? Number(currentUserId) || null : null;
        base.status = "open";
      } else if (action === "snooze") {
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        base.status = "snoozed";
        base.snoozedUntil = until;
      } else if (action === "archive") {
        base.status = "archived";
      } else if (action === "reopen") {
        base.status = "open";
      } else if (action === "alert") {
        // Keep existing assignment state; just dispatch the email via parent intent.
        await onUpdateAlertAssignment(asset, { ...base, action: "email_dispatched" });
        onIntent?.(asset, "alert");
        return;
      }
      const payload = existing
        ? { ...base, assignedToUserId: base.assignedToUserId ?? existing.assignedToUserId ?? null }
        : base;
      await onUpdateAlertAssignment(asset, payload);
    } catch (err) {
      console.warn(`Alert action ${action} failed for ${symbol}:`, err?.message);
    } finally {
      setAlertActionBusy((prev) => ({ ...prev, [key]: false }));
    }
  };

  const isAlertTriggered = (asset) => {
    const change = Number(asset?.priceChangePercent);
    return Number.isFinite(change) && Math.abs(change) >= alertThresholdPct && asset?.isMarketOpen !== false;
  };

  const watchlistMetrics = useMemo(() => {
    const moves = displayedAssets
      .map((asset) => Number(asset?.priceChangePercent))
      .filter(Number.isFinite);
    const reviewCount = displayedAssets.filter((asset) => isAlertTriggered(asset)).length;
    const positiveCount = moves.filter((move) => move > 0).length;
    return [
      { label: "Tracked", value: displayedAssets.length, helper: `${activeCategory} in scope`, featured: true },
      { label: "Need review", value: reviewCount, helper: `Move ≥ ${alertThresholdPct}%`, tone: reviewCount ? "warning" : "neutral" },
      { label: "Advancing", value: `${positiveCount}/${moves.length || 0}`, helper: "Names with a positive session", tone: positiveCount ? "success" : "neutral" },
      { label: "Data", value: liveStatus === "live" ? "Live" : liveStatus === "loading" ? "Syncing" : "Cached", helper: lastLivePriceAt ? `Last tick ${new Date(lastLivePriceAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No confirmed tick", tone: liveStatus === "live" ? "success" : "stale" },
    ];
  }, [activeCategory, alertThresholdPct, displayedAssets, lastLivePriceAt, liveStatus]);

  // ── TanStack DataTable column definitions ──────────────────────────
  // Defined after the cell-renderer helpers (formatAssetPrice, isAlertTriggered,
  // etc.) so the memo closes over them correctly. Symbol and % Chg are
  // TanStack-sortable (click the header to toggle asc/desc).
  const watchlistColumns = useMemo(() => [
    {
      key: "symbol",
      header: "Symbol",
      sortable: true,
      sortValue: (asset) => asset.symbol,
      cell: (asset) => (
        <div className="watchlist-symbol-cell">
          <strong>{asset.symbol}</strong>
          <span>{asset.name || asset.marketType || asset.type || "tracked"}</span>
        </div>
      ),
    },
    {
      key: "last",
      header: "Last",
      align: "right",
      sortable: false,
      cell: (asset) => (
        <span className="watchlist-last-cell">
          {formatAssetPrice(asset)}
          <QuoteStatusBadge asset={asset} />
        </span>
      ),
    },
    {
      key: "priceChangePercent",
      header: "% Chg",
      align: "right",
      sortable: true,
      sortValue: (asset) => Number(asset?.priceChangePercent ?? 0),
      cell: (asset) => {
        const change = Number(asset?.priceChangePercent);
        const hasChange = Number.isFinite(change) && asset?.isMarketOpen !== false;
        if (!hasChange) return "—";
        return (
          <span className={change >= 0 ? "positive" : "negative"}>
            {change >= 0 ? "+" : ""}{change.toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: "thesis",
      header: "Thesis",
      sortable: false,
      cell: (asset) => asset.theme || asset.category || "Unassigned",
    },
    {
      key: "alert",
      header: "Alert",
      sortable: false,
      cell: (asset) => {
        const triggered = isAlertTriggered(asset);
        const assignment = getAlertAssignment(asset);
        const status = assignment?.status || (triggered ? "open" : "quiet");
        const assignedToMe = assignment?.assignedToUserId && String(assignment.assignedToUserId) === String(currentUserId);
        return (
          <span className={`watchlist-alert-chip ${triggered ? "active" : ""} ${status === "snoozed" ? "snoozed" : ""} ${status === "archived" ? "archived" : ""}`}>
            {status === "snoozed" ? "Snoozed" : status === "archived" ? "Archived" : triggered ? "Review" : "Quiet"}
            {assignedToMe ? " · You" : null}
          </span>
        );
      },
    },
    {
      key: "session",
      header: "Session",
      sortable: false,
      cell: (asset) => getSessionLabel(asset),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      sortable: false,
      cell: (asset) => {
        const assignment = getAlertAssignment(asset);
        const key = buildAlertKey(asset);
        const busy = alertActionBusy[key];
        return (
          <div className="watchlist-row-actions" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="watchlist-action-btn" onClick={() => handleIntent(asset, "inspect")}>Open</button>
            <button type="button" className="watchlist-action-btn" onClick={() => handleIntent(asset, "journal")}>Journal</button>
            {isAlertTriggered(asset) ? (
              <>
                {assignment?.status === "open" || assignment?.status === "snoozed" ? (
                  <button
                    type="button"
                    className="watchlist-action-btn"
                    disabled={busy || alertsLoading}
                    onClick={() => handleAlertAction(asset, assignment?.status === "snoozed" ? "reopen" : "snooze")}
                    title={assignment?.status === "snoozed" ? "Reopen alert" : "Snooze for 24h"}
                  >
                    {busy === "snooze" || busy === "reopen" ? "…" : assignment?.status === "snoozed" ? "Reopen" : "Snooze"}
                  </button>
                ) : null}
                {assignment?.status && assignment.status !== "archived" ? (
                  <button
                    type="button"
                    className="watchlist-action-btn"
                    disabled={busy || alertsLoading}
                    onClick={() => handleAlertAction(asset, "archive")}
                    title="Archive alert"
                  >
                    {busy === "archive" ? "…" : "Archive"}
                  </button>
                ) : null}
              </>
            ) : null}
            <button
              className={`star-button compact ${isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar(asset);
              }}
              title={isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "Remove from watchlist" : "Add to watchlist"}
            >
              ★
            </button>
          </div>
        );
      },
    },
  ], [
    alertActionBusy,
    alertsLoading,
    currentUserId,
    handleAlertAction,
    handleIntent,
    isInWatchlist,
    onToggleStar,
  ]);
  const selectedImportSource = WATCHLIST_IMPORT_SOURCES.find((source) => source.key === importSource) || WATCHLIST_IMPORT_SOURCES[0];
  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setImportNotice("");
    setImportError("");
    setImportFileName(file?.name || "");
    if (!file) return;
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    if (UNSUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      setImportText("");
      setImportRows([]);
      setImportError("Export this file as CSV, TSV, JSON, text, or Markdown first, then upload it here.");
      return;
    }
    try {
      const text = await file.text();
      setImportText(text);
      setImportNotice(`${file.name} loaded for review.`);
    } catch {
      setImportError("Could not read that file. Export it as CSV or text and try again.");
    }
  };
  const submitImport = async () => {
    if (!importRows.length || importBusy) return;
    setImportBusy(true);
    setImportError("");
    setImportNotice("");
    try {
      const result = await onImportAssets?.(importRows, { source: importSource, fileName: importFileName });
      const importedCount = Number(result?.imported ?? importRows.length);
      setImportNotice(`${importedCount} watchlist row${importedCount === 1 ? "" : "s"} imported.`);
      setImportText("");
      setImportRows([]);
      setImportFileName("");
    } catch (error) {
      setImportError(error?.message || "Could not import this watchlist. Please check the file and try again.");
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <>
      <section className="watchlist-panel watchlist-panel-compact watchlist-workspace">
      <WorkspacePageHeader
        eyebrow="Monitor"
        title="Watchlist"
        description="Tracked names first. Filters and display preferences stay out of the way until you need them."
        status={<span className={`watchlist-freshness watchlist-freshness--${liveStatus}`}>{liveStatus === "live" ? "Live prices" : liveStatus === "loading" ? "Refreshing prices" : "Showing last confirmed data"}</span>}
        primaryAction={activeCategory !== "indicators" ? (
          <button type="button" className="watchlist-import-trigger" onClick={() => setIsImportOpen((value) => !value)} aria-expanded={isImportOpen} aria-controls="watchlist-import-panel">
            {isImportOpen ? "Close import" : "Import list"}
          </button>
        ) : null}
        secondaryActions={activeCategory !== "indicators" ? (
          <button type="button" className="watchlist-controls-trigger" onClick={() => setShowControls((value) => !value)} aria-expanded={showControls} aria-controls="watchlist-secondary-controls">
            {showControls ? "Hide controls" : "Filters & view"}
          </button>
        ) : null}
      />
      <div className="watchlist-scope-row">
        <div className="category-tabs compact" role="tablist" aria-label="Watchlist asset class">
          {categories.map((category) => (
            <button
              key={category}
              className={category === activeCategory ? "active" : ""}
              onClick={() => onCategorySelect(category)}
              role="tab"
              aria-selected={category === activeCategory}
            >
              {category.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {activeCategory !== "indicators" && showControls ? (
          <section className="watchlist-secondary-controls" id="watchlist-secondary-controls" aria-label="Watchlist filters and display">
            <div className="watchlist-header-actions compact">
            <button
              type="button"
              className="watchlist-import-trigger"
              onClick={async () => {
                setRefreshBusy(true);
                try {
                  await onRefresh?.();
                  setLocalRefreshNonce((prev) => prev + 1);
                } catch {}
                setRefreshBusy(false);
              }}
              disabled={refreshBusy}
              aria-label="Refresh watchlist data"
              title="Refresh watchlist data and flush pending import syncs"
            >
              {refreshBusy ? "..." : "⟳"}
            </button>
            <InlineControlGroup className="watchlist-toolbar-toggle">
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
              <button
                type="button"
                className={isDense ? "active" : ""}
                onClick={() => {
                  const next = !isDense;
                  setIsDense(next);
                  if (next) setViewMode("list");
                }}
                title={isDense ? "Normal density" : "Compact (hide secondary columns)"}
                aria-pressed={isDense}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="4" y2="18"></line><line x1="10" y1="6" x2="10" y2="18"></line><line x1="16" y1="6" x2="20" y2="6"></line><line x1="16" y1="12" x2="20" y2="12"></line><line x1="16" y1="18" x2="20" y2="18"></line></svg>
              </button>
            </InlineControlGroup>
            <label className="watchlist-alert-threshold" title="Day change (%) above which a name flags as a Review alert.">
              <span>Alert&nbsp;≥</span>
              <input
                type="number"
                step="0.5"
                min="0.1"
                value={alertThresholdPct}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next > 0) setAlertThresholdPct(next);
                }}
                aria-label="Alert threshold (percent absolute day change)"
              />
              <span>%</span>
            </label>
            </div>
            {activeCategory === "stocks" ? (
              <div className="theme-tabs watchlist-theme-strip" aria-label="Stock themes">
                {mergedStockThemes.map((theme) => (
                  <button
                    key={theme}
                    className={`theme-pill ${activeTheme === theme ? "active" : ""}`}
                    onClick={() => onThemeSelect(theme)}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
      ) : null}

      {isImportOpen ? (
        <section className="watchlist-import-panel" id="watchlist-import-panel" aria-label="Import watchlist">
          <div className="watchlist-import-head">
            <div>
              <span>Import watchlist</span>
              <strong>{selectedImportSource.label} source</strong>
            </div>
            <button type="button" className="watchlist-action-btn" onClick={() => setIsImportOpen(false)}>
              Close
            </button>
          </div>
          <div className="watchlist-import-source-grid" role="tablist" aria-label="Import source">
            {WATCHLIST_IMPORT_SOURCES.map((source) => (
              <button
                key={source.key}
                type="button"
                className={importSource === source.key ? "active" : ""}
                onClick={() => setImportSource(source.key)}
              >
                <strong>{source.label}</strong>
                <span>{source.hint}</span>
              </button>
            ))}
          </div>
          <div className="watchlist-import-body">
            <label className="watchlist-import-upload">
              <span>Upload export</span>
              <input
                type="file"
                accept=".csv,.tsv,.txt,.md,.json,.doc,.docx,.xls,.xlsx,.pdf"
                onChange={handleImportFile}
              />
            </label>
            <label className="watchlist-import-textarea">
              <span>Paste symbols or rows</span>
              <textarea
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportNotice("");
                }}
                placeholder="Symbol, Name, Theme&#10;NVDA, NVIDIA, AI Infrastructure&#10;SOL, Solana, Crypto majors"
              />
            </label>
            <div className="watchlist-import-preview" aria-live="polite">
              <div className="watchlist-import-preview-head">
                <span>{importRows.length} parsed</span>
                {importFileName ? <em>{importFileName}</em> : <em>{activeCategory} default</em>}
              </div>
              {importRows.length ? (
                <div className="watchlist-import-preview-list">
                  {importRows.slice(0, 8).map((row) => (
                    <div key={`${row.symbol}-${row.marketType}-${row.category}-${row.theme || ""}`}>
                      <strong>{row.symbol}</strong>
                      <span>{row.name}</span>
                      <em>{row.category}{row.theme ? ` / ${row.theme}` : ""}</em>
                    </div>
                  ))}
                  {importRows.length > 8 ? <small>+{importRows.length - 8} more</small> : null}
                </div>
              ) : (
                <p>Upload a CSV/TSV/JSON/text export or paste one symbol per line.</p>
              )}
            </div>
          </div>
          {importError ? <div className="watchlist-import-status error">{importError}</div> : null}
          {importNotice ? <div className="watchlist-import-status">{importNotice}</div> : null}
          <div className="watchlist-import-actions">
            <button type="button" className="watchlist-action-btn" onClick={() => {
              setImportText("");
              setImportRows([]);
              setImportError("");
              setImportNotice("");
              setImportFileName("");
            }}>
              Clear
            </button>
            <button type="button" className="watchlist-import-primary" disabled={!importRows.length || importBusy} onClick={submitImport}>
              {importBusy ? "Importing..." : `Import ${importRows.length || ""}`.trim()}
            </button>
          </div>
        </section>
      ) : null}
      {loading ? (
        <div className="loading-state">Loading market data...</div>
      ) : activeCategory === "indicators" ? (
        <div>
          <div className="indicator-controls-row">
            <div className="theme-tabs indicator-country-tabs" style={{ paddingTop: 0, marginBottom: 0 }}>
              {indicatorWatchlistCountries.map((country) => (
                <button
                  key={country.symbol}
                  className={`theme-pill ${indicatorCountry === country.symbol ? "active" : ""}`}
                  onClick={() => setIndicatorCountry(country.symbol)}
                >
                  {country.name}
                </button>
              ))}
            </div>
            <div className="indicator-toolbar">
              {activeIndicator ? (
                <button
                  className="modal-action-btn active"
                  onClick={() => onToggleStar(activeIndicator)}
                  title={`Remove ${activeIndicator.name} from watchlist`}
                >
                  Remove
                </button>
              ) : null}
              <span className={`data-health-badge ${macroLoading ? "loading" : macroStale ? "hazard" : "ok"}`} role="status" aria-label={macroLoading ? "Indicators: refreshing" : macroStale ? "Indicators: stale" : "Indicators: up to date"} title={macroLoading ? "Refreshing indicators" : macroStale ? "Showing previous indicator snapshot" : "Indicators are up to date"}>
                <DataHealthBadge status={macroLoading ? "loading" : macroStale ? "stale" : "ok"} />
                Indicators
              </span>
            </div>
          </div>
          {indicatorWatchlistCountries.length === 0 ? (
            <div className="loading-state">Search for a country, then star it to track its indicators here.</div>
          ) : macroLoading && (!Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0) ? (
            <div className="loading-state">Loading macro indicators...</div>
          ) : !Array.isArray(macroSnapshot?.metrics) || macroSnapshot.metrics.length === 0 ? (
            <div className="loading-state">
              {macroStale && macroNotice ? macroNotice : "Waiting for macro indicators..."}
            </div>
          ) : (
            <IndicatorMetricsTable
              snapshot={macroSnapshot}
              onSelectMetric={(metric) =>
                setSelectedIndicatorMetric({
                  countryName: macroSnapshot?.countryName || activeIndicator?.name || indicatorCountry,
                  metric
                })
              }
            />
          )}
          {macroStale && macroNotice ? (
            <div className="snapshot-inline-note">{macroNotice}</div>
          ) : null}
        </div>
      ) : (
        <>
          {activeCategory === "stocks" && activeTheme && activeTheme !== "All" && (
            <div className="theme-heading compact">
              <span className="theme-label">{activeTheme}</span>
              <span className="theme-count">
                {displayedAssets.length} compan{displayedAssets.length === 1 ? "y" : "ies"}
              </span>
            </div>
          )}

          <div className={`watchlist-content-grid ${activeCategory === "stocks" ? "with-aside" : ""}`}>
            <div className="watchlist-main-surface">
              {viewMode === "list" ? (
                <div className="watchlist-blotter">
                  <div className="watchlist-blotter-head">
                    <div className="watchlist-blotter-title">
                      <span>Tracked {activeCategory}</span>
                      <strong>{displayedAssets.length} rows</strong>
                    </div>
                    <span className="watchlist-blotter-meta">Quote blotter</span>
                  </div>
                  {displayedAssets.length === 0 ? (
                    <GuidedEmptyState
                      eyebrow="Watchlist workflow"
                      title={emptyStateTitle}
                      description={emptyStateDescription}
                      steps={emptyStateSteps}
                      cta={activeTheme && activeTheme !== "All" ? "Show all themes" : undefined}
                      onAction={activeTheme && activeTheme !== "All" ? () => onThemeSelect?.("All") : undefined}
                      className="watchlist-guided-empty"
                    />
                  ) : (
                    <div className="watchlist-table-wrap">
                      <DataTable
                        columns={watchlistColumns}
                        data={pagedAssets}
                        getRowId={(asset) => `${asset.symbol}-${asset.marketType || "default"}-${asset.category || "default"}-${asset.theme || "default"}`}
                        getRowClassName={(asset) =>
                          asset._liveDirection === "up" ? "live-up" : asset._liveDirection === "down" ? "live-down" : ""
                        }
                        getRowTitle={(asset) =>
                          asset._liveUpdatedAt ? `Last price tick ${new Date(asset._liveUpdatedAt).toLocaleTimeString()}` : undefined
                        }
                        className={`watchlist-table${isDense ? " watchlist-table--dense" : ""}`}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className={`asset-grid ${viewMode === "list" ? "list-mode" : ""}`}>
                  {displayedAssets.length === 0 ? (
                    <GuidedEmptyState
                      eyebrow="Watchlist workflow"
                      title={emptyStateTitle}
                      description={emptyStateDescription}
                      steps={emptyStateSteps}
                      cta={activeTheme && activeTheme !== "All" ? "Show all themes" : undefined}
                      onAction={activeTheme && activeTheme !== "All" ? () => onThemeSelect?.("All") : undefined}
                      className="watchlist-guided-empty"
                    />
                  ) : (
                    pagedAssets.map((asset) => (
                      <article
                        key={`${asset.symbol}-${asset.marketType || "default"}-${asset.category || "default"}-${asset.theme || "default"}`}
                        className={`asset-card clickable ${asset._liveDirection === "up" ? "live-up" : asset._liveDirection === "down" ? "live-down" : ""}`}
                        onClick={() => handleIntent(asset, "inspect")}
                        title={asset._liveUpdatedAt ? `Last price tick ${new Date(asset._liveUpdatedAt).toLocaleTimeString()}` : undefined}
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
                              <span className="price-val">{formatAssetPrice(asset)}</span>
                              <QuoteStatusBadge asset={asset} />
                              {asset.isMarketOpen === false && (
                                <span className="market-closed-dash" title={`Market Closed: ${asset.marketStatus || 'Holiday/Weekend'}`} style={{ color: "var(--color-text-secondary)", marginLeft: "4px", fontSize: "0.9rem" }}>–</span>
                              )}
                              {asset.priceChangePercent != null && asset.isMarketOpen !== false &&
                                (() => {
                                  const change = Number(asset.priceChangePercent);
                                  if (Number.isNaN(change)) return null;
                                  return (
                                    <span className={`price-change ${change >= 0 ? "positive" : "negative"}`}>
                                      {change >= 0 ? "+" : ""}
                                      {change.toFixed(2)}%
                                    </span>
                                  );
                                })()}
                            </div>
                          )}
                        </div>
                        <button
                          className={`star-button ${isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(asset);
                          }}
                          title={isInWatchlist(asset, undefined, { strictStockMeta: true }) ? "Remove from watchlist" : "Add to watchlist"}
                        >
                          ★
                        </button>
                      </article>
                    ))
                  )}
                </div>
              )}

              {totalPages > 1 && (
                <div className="pagination-controls compact">
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
            </div>

            {activeCategory === "stocks" ? (
              <ContextRail title="Catalyst context" className="watchlist-earnings-rail">
                <DensePanelHeader
                  title="Upcoming"
                  subtitle="Nearest earnings in focus"
                  actions={
                    <InlineControlGroup>
                      <span className={`data-health-badge ${earningsLoading ? "loading" : earningsStale ? "hazard" : "ok"}`} role="status" aria-label={earningsLoading ? "Earnings: refreshing" : earningsStale ? "Earnings: stale" : "Earnings: up to date"} title={earningsLoading ? "Refreshing earnings calendar" : earningsStale ? "Showing previous earnings snapshot" : "Earnings are up to date"}>
                        <DataHealthBadge status={earningsLoading ? "loading" : earningsStale ? "stale" : "ok"} />
                        Earnings
                      </span>
                      <button type="button" className="pagination-button watchlist-collapse-btn" onClick={() => setIsEarningsOpen((value) => !value)}>
                        {isEarningsOpen ? "Hide" : "Show"}
                      </button>
                    </InlineControlGroup>
                  }
                />
                {isEarningsOpen ? (
                  earningsLoading && earningsRows.length === 0 ? (
                    <GuidedEmptyState
                      eyebrow="Earnings rail"
                      title="Loading upcoming catalysts"
                      description="Zenin is pulling the nearest earnings set for the names already on your desk."
                      steps={[
                        "Keep the blotter open while the catalyst rail syncs.",
                        "Star the names you want surfaced in this queue.",
                      ]}
                      tone="subtle"
                      className="guided-empty-state--compact"
                    />
                  ) : earningsRows.length === 0 ? (
                    <GuidedEmptyState
                      eyebrow="Earnings rail"
                      title="No upcoming earnings surfaced yet"
                      description="The catalyst rail is empty because there are no nearby events for the currently visible names or the earnings feed has not returned them yet."
                      steps={[
                        "Keep starred equities in the watchlist so they can enter the queue.",
                        "Use desk notes to flag catalysts manually when the feed is quiet.",
                      ]}
                      tone="subtle"
                      className="guided-empty-state--compact"
                    />
                  ) : (
                    <div className="watchlist-earnings-list">
                      {earningsRows.map(({ symbol, item }) => (
                        <button
                          key={symbol}
                          type="button"
                          className="watchlist-earnings-row"
                          onClick={() => {
                            const match = displayedAssets.find((asset) => asset.symbol === symbol) || assets.find((asset) => asset.symbol === symbol);
                            if (match) handleIntent(match, "catalyst");
                          }}
                        >
                          <strong>{symbol}</strong>
                          <span>{formatEarningsDate(item?.nextEarnings || item?.earningsText)}</span>
                        </button>
                      ))}
                    </div>
                  )
                ) : null}
                {earningsStale && earningsNotice ? (
                  <div className="snapshot-inline-note">{earningsNotice}</div>
                ) : null}
              </ContextRail>
            ) : null}
          </div>

          {selectedIntentAsset ? (
            <section className="watchlist-intent-panel" aria-label="Selected watchlist workflow">
              <div className="watchlist-intent-main">
                <span>Asset workflow opened</span>
                <h3>{normalizeSymbol(selectedIntentAsset.symbol)} decision setup</h3>
                <p>
                  {selectedIntentAsset.name || normalizeSymbol(selectedIntentAsset.symbol)} is now the active context. Attach research,
                  record the decision, or keep the alert quiet until the next catalyst.
                </p>
              </div>
              <div className="watchlist-intent-actions">
                <button type="button" onClick={() => handleIntent(selectedIntentAsset, "research")}>Research</button>
                <button type="button" onClick={() => handleIntent(selectedIntentAsset, "journal")}>Journal</button>
                <button type="button" onClick={() => handleIntent(selectedIntentAsset, "alert")}>Alert</button>
                {isGuestMode ? <a href={getGuestSignupHref()}>Create account to save</a> : null}
              </div>
            </section>
          ) : null}
        </>
      )}
      </section>

      {hasDeskFeatureAccess ? (
        <PlanLockOverlay
          locked={sharedWatchlistLocked}
          requiredPlan={lockedPlanLabel}
          title="Shared Desk Watchlists"
          description="Collaborative desk watchlists are a Desk plan feature. Upgrade to share and manage a live desk view."
          onUpgrade={onUpgrade}
        >
          <SharedWatchlistWorkspacePanel
            activeCategory={activeCategory}
            activeTheme={activeTheme}
            assets={displayedAssets}
          />
        </PlanLockOverlay>
      ) : null}

      {selectedIndicatorMetric ? (
        <IndicatorMetricModal
          countryName={selectedIndicatorMetric.countryName}
          metric={selectedIndicatorMetric.metric}
          onClose={() => setSelectedIndicatorMetric(null)}
        />
      ) : null}
    </>
  );
}
