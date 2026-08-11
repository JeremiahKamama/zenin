import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { DataTable } from "./data-table/DataTable";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { chartColors, activeChartThemeMode } from "../utils/chartTheme";
import { loadWorkspaceCollection, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetch } from "../utils/zeninFetch";
import {
  fetchNeedsJournaling,
  dismissJournalEvent,
  bulkDismissJournalEvents,
  snoozeJournalEvent,
  linkJournalEvent,
  classifyJournalEvent,
  fetchJournalReports,
  generateJournalReport,
  fetchJournalPrefs,
  saveJournalPrefs,
} from "../utils/journalEvents";
import { CompactPageHeader, FilterPopover, GuidedEmptyState, InlineControlGroup, MetricStrip } from "./CompactWorkspaceUI";
import { AsyncState, DataFreshnessSummary, ResponsiveActionBar, normalizeFreshnessStatus } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { ChevronDown, Search } from "lucide-react";
import { buildConnectionRegistry, resolveAssetIdentity } from "../utils/tradePerformance";
import DecisionComposer from "./DecisionComposer";
import { fetchDecisionOutcomes } from "../utils/decisionOutcomes";

const BACKEND_URL = ZENIN_API_BASE_URL;
const TRADE_REPORT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours
const JOURNAL_REVIEW_NOTE_KEY = "zenin_journal_review_note";
const JOURNAL_REVIEW_TASKS_KEY = "zenin_journal_review_tasks";

function toDateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function extractFileLabel(value, fallback = "Attachment") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || fallback);
  } catch {
    const segments = raw.split("/").filter(Boolean);
    return decodeURIComponent(segments[segments.length - 1] || fallback);
  }
}

function isWithinJournalDateWindow(value, windowKey) {
  if (windowKey !== "30d") return true;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000;
}

export function JournalModule({
  trades = [],
  portfolio = [],
  balance = 0,
  accountEquity = null,
  activeOptionsTrades = [],
  multiChainCache = {},
  spotPrices = {},
  journalThreadContext = null,
  unifiedPortfolio = null,
  connectedAccounts = [],
  brokerageAccounts = []
}) {
  const [reportPage, setReportPage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isSymbolsDropdownOpen, setIsSymbolsDropdownOpen] = useState(false);
  const [symbolsButtonLabel, setSymbolsButtonLabel] = useState("All Symbols");
  const [calendarSearch, setCalendarSearch] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState([]);
  // Multi-select set of connection ids (empty = All Sources). Driven by the
  // shared buildConnectionRegistry so option ids match trade source ids.
  const [selectedSources, setSelectedSources] = useState(() => new Set());
  const [livePriceBySymbol, setLivePriceBySymbol] = useState({});
  const [lastReportPriceRefreshAt, setLastReportPriceRefreshAt] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);
  // Phase 4: historical snapshots are the single source of truth for the heatmap.
  // When snapshots exist for the visible month they override the legacy
  // render-time delta calculation (which is retained only as a fallback before
  // any snapshot has been generated).
  const [snapshotsByDate, setSnapshotsByDate] = useState(() => new Map());
  const [snapshotsLoadedFor, setSnapshotsLoadedFor] = useState("");
  // Lifecycle for the snapshot fetch (Fix #6: distinguish data/zero/empty/error).
  //   "idle"      never attempted this month
  //   "loading"   in flight
  //   "empty"     200 OK, zero snapshot rows (real — no history)
  //   "error"     non-OK (401/429/5xx/network) — must NOT render as zero
  //   "ready"     200 OK with data
  const [snapshotFetchState, setSnapshotFetchState] = useState("idle");

  // Unified read model is the single source of truth for transactions when active
  // (covers Hyperliquid + SnapTrade brokerage + exchanges + manual). Falls back to
  // the legacy `trades` prop otherwise. Maps unified transactions to the legacy
  // trade shape the rest of this module expects.
  const displayTransactions = useMemo(() => {
    if (unifiedPortfolio && unifiedPortfolio.isUnified && Array.isArray(unifiedPortfolio.transactions) && unifiedPortfolio.transactions.length > 0) {
      return unifiedPortfolio.transactions.map((t) => {
        // Coherent asset identity. The canonical identifier is the instrument
        // symbol; prediction-market fills frequently carry `symbol` = null with
        // the human-readable market/question in `name`, so fall back through
        // `name` before reaching the explicit "UNKNOWN" sentinel (which Journal's
        // analytics would otherwise surface verbatim).
        const symbol = t.symbol || null;
        const name = t.name || t.symbol || null;
        const asset = symbol || name || null;
        // Stable, source+account+external-identity key. `providerTxId` is the
        // canonical external trade/fill id written during ingestion
        // (portfolio_source_transactions.provider_tx_id). Falls back to the legacy
        // composite only when no stable external id exists — eliminating the
        // false `UNKNOWN-*` keys that broke Journal-entry linking.
        const sourceTradeKey = t.providerTxId
          ? `${t.provider || "unknown"}::${t.sourceAccountId || 0}::${t.providerTxId}`
          : null;
        return {
          executedAt: t.executedAt,
          date: t.executedAt,
          symbol: symbol,
          name: name,
          asset: asset,
          sourceType: t.sourceType,
          sourceAccountId: t.sourceAccountId || t.sourceType || "",
          sourceTradeKey,
          side: String(t.side || "").toUpperCase() === "BUY" ? "BUY" : String(t.side || "").toUpperCase() === "SELL" ? "SELL" : (t.side || "BUY"),
          type: t.type || (t.sourceType === "wallet" ? "crypto" : "equity"),
          notional: Number(t.notional || 0),
          fee: Number(t.fee || 0),
          quantity: Number(t.quantity || 0),
          unitPrice: Number(t.unitPrice || 0),
          currency: t.currency || "USD",
          platform: t.provider || t.sourceType || "unknown",
          provider: t.provider || t.sourceType || "unknown",
          // Realized P&L for perps/crypto comes from closedPnl when present.
          pnl: Number(t.closedPnl != null ? t.closedPnl : (t.pnl != null ? t.pnl : t.realizedPnl || 0)),
          realizedPnl: Number(t.realizedPnl || 0),
          accountEquityAfter: null
        };
      });
    }
    return Array.isArray(trades) ? trades : [];
  }, [unifiedPortfolio, trades]);

  // Connection registry — single source of truth for source attribution + the
  // multi-select filter options. Reuses the shared util so option ids match the
  // ids resolved onto each trade (buildConnectionRegistry.resolve).
  const registry = useMemo(
    () => buildConnectionRegistry({ connectedAccounts, brokerageAccounts }),
    [connectedAccounts, brokerageAccounts]
  );
  const connOptions = useMemo(
    () => registry.list.map((c) => ({ value: c.id, label: c.label })),
    [registry]
  );
  // Resolve a trade/row to a stable connection id (falls back to platform/provider).
  const resolveSourceId = useCallback(
    (trade) => {
      const conn = registry.resolve(trade);
      if (conn) return conn.id;
      return String(trade?.platform || trade?.provider || trade?.sourceType || "manual");
    },
    [registry]
  );
  const resolveSourceLabel = useCallback(
    (trade) => {
      const conn = registry.resolve(trade);
      if (conn) return conn.label;
      const raw = String(trade?.platform || trade?.provider || trade?.sourceType || "manual");
      return raw === "manual" ? "Manual" : (raw.charAt(0).toUpperCase() + raw.slice(1));
    },
    [registry]
  );

  // Phase 3: trade-journaling "Needs journaling" queue + event drawer.
  // Loaded lazily when the queue tab is active; refreshed after actions.
  const [needsJournaling, setNeedsJournaling] = useState([]);
  const [isQueueLoading, setIsQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(null);
  const [activeJournalEvent, setActiveJournalEvent] = useState(null);
  const [isEventDrawerOpen, setIsEventDrawerOpen] = useState(false);
  const [eventActionState, setEventActionState] = useState({ id: null, busy: false });
  const [bulkDismissBusy, setBulkDismissBusy] = useState(false);
  // Reuses the component's existing legacy toast state (setToast) for action
  // feedback, consistent with <JournalToast> rendered at the root.

  const loadNeedsJournaling = useCallback(async () => {
    setIsQueueLoading(true);
    setQueueError(null);
    try {
      const items = await fetchNeedsJournaling();
      setNeedsJournaling(items || []);
    } catch (err) {
      setQueueError(err?.message || "Failed to load journaling queue");
      setNeedsJournaling([]);
    } finally {
      setIsQueueLoading(false);
    }
  }, []);

  const openJournalEvent = useCallback((event) => {
    setActiveJournalEvent(event);
    setIsEventDrawerOpen(true);
  }, []);

  const refreshQueueAfterAction = useCallback((updatedEvent) => {
    // Remove acted-on events from the open queue; keep the rest.
    setNeedsJournaling((prev) =>
      updatedEvent && updatedEvent.status && updatedEvent.status !== "open"
        ? prev.filter((e) => e.id !== updatedEvent.id)
        : prev
    );
  }, []);

  const handleBulkDismiss = useCallback(async () => {
    setBulkDismissBusy(true);
    try {
      const result = await bulkDismissJournalEvents({});
      setToast({ message: `Dismissed ${result?.dismissed || 0} journal reminder${result?.dismissed === 1 ? "" : "s"}.`, tone: "info" });
      setNeedsJournaling([]);
    } catch (err) {
      setToast({ message: err?.message || "Please try again.", tone: "error" });
    } finally {
      setBulkDismissBusy(false);
    }
  }, []);

  const handleDismissEvent = useCallback(async (event) => {
    setEventActionState({ id: event.id, busy: true });
    try {
      const updated = await dismissJournalEvent(event.id);
      setToast({ message: `${event.symbol || "Event"} removed from the journaling queue.`, tone: "info" });
      refreshQueueAfterAction(updated || { id: event.id, status: "dismissed" });
      setActiveJournalEvent((prev) => (prev && prev.id === event.id ? null : prev));
      setIsEventDrawerOpen(false);
    } catch (err) {
      setToast({ message: err?.message || "Please try again.", tone: "error" });
    } finally {
      setEventActionState({ id: null, busy: false });
    }
  }, [refreshQueueAfterAction]);

  const handleSnoozeEvent = useCallback(async (event, days = 1) => {
    setEventActionState({ id: event.id, busy: true });
    try {
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const updated = await snoozeJournalEvent(event.id, until);
      setToast({ message: `${event.symbol || "Event"} snoozed for ${days} day${days === 1 ? "" : "s"}.`, tone: "info" });
      refreshQueueAfterAction(updated || { id: event.id, status: "snoozed" });
      setActiveJournalEvent((prev) => (prev && prev.id === event.id ? null : prev));
      setIsEventDrawerOpen(false);
    } catch (err) {
      setToast({ message: err?.message || "Please try again.", tone: "error" });
    } finally {
      setEventActionState({ id: null, busy: false });
    }
  }, [refreshQueueAfterAction]);

  const handleJournalEvent = useCallback(async (event, payload = {}) => {
    setEventActionState({ id: event.id, busy: true });
    try {
      const updated = await linkJournalEvent(event.id, payload);
      setToast({ message: `${event.symbol || "Event"} marked as journaled.`, tone: "positive" });
      refreshQueueAfterAction(updated || { id: event.id, status: "journaled" });
      setActiveJournalEvent((prev) => (prev && prev.id === event.id ? null : prev));
      setIsEventDrawerOpen(false);
    } catch (err) {
      setToast({ message: err?.message || "Please try again.", tone: "error" });
    } finally {
      setEventActionState({ id: null, busy: false });
    }
  }, [refreshQueueAfterAction]);

  const handleClassifyEvent = useCallback(async (event, classification, reason) => {
    setEventActionState({ id: event.id, busy: true });
    try {
      const updated = await classifyJournalEvent(event.id, classification, reason);
      setToast({ message: `${event.symbol || "Event"} classified as ${classification.replace(/_/g, " ")}.`, tone: "positive" });
      // Classification does not remove the event from the queue; refresh to
      // reflect the new classification in the list payload.
      await loadNeedsJournaling();
      return updated || { id: event.id, classification };
    } catch (err) {
      setToast({ message: err?.message || "Could not classify event.", tone: "error" });
      throw err;
    } finally {
      setEventActionState({ id: null, busy: false });
    }
  }, [loadNeedsJournaling]);

  const [journalEntries, setJournalEntries] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("zenin_journal_entries") || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [entryDraft, setEntryDraft] = useState({
    sourceTradeKey: "",
    symbol: "",
    tradeDate: "",
    side: "",
    quantity: "",
    price: "",
    notional: "",
    marketType: "",
    status: "",
    strategy: "",
    setupTag: "",
    marketRegime: "",
    timeframe: "intraday",
    emotion: "neutral",
    confidence: 5,
    preThesis: "",
    postReview: "",
    mistakeCategory: "",
    learned: "",
    chartLink: "",
    decisionThreadId: null
  });
  const [journalPage, setJournalPage] = useState("entry");
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [journalFilters, setJournalFilters] = useState({
    dateWindow: "all",
    strategy: "all",
    timeframe: "all",
    assetClass: "all",
    outcome: "all",
    emotion: "all",
    search: "",
    regime: "all",
    side: "all",
    status: "all"
  });
  const [expandedExecutionGroups, setExpandedExecutionGroups] = useState({});
  const [journalView, setJournalView] = useState("overview");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isEntryDrawerOpen, setIsEntryDrawerOpen] = useState(false);
  const [isQuickEntryOpen, setIsQuickEntryOpen] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [toast, setToast] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [entryErrors, setEntryErrors] = useState({});
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(null);
  const [selectedCalendarTradeDate, setSelectedCalendarTradeDate] = useState("");
  const [reviewNote, setReviewNote] = useState(() => localStorage.getItem(JOURNAL_REVIEW_NOTE_KEY) || "");
  const [isReviewModeActive, setIsReviewModeActive] = useState(false);
  const [entriesListPage, setEntriesListPage] = useState(1);
  const drawerRef = useRef(null);
  const reviewComposerRef = useRef(null);
  const journalSyncReadyRef = useRef(false);

  const syncJournalCollection = (namespace, rows, limit = 500) => {
    saveWorkspaceCollection(namespace, rows, limit).catch((error) => {
      console.warn(`Workspace sync skipped for ${namespace}.`, error);
    });
  };

  const refreshJournalEntries = useCallback(async () => {
    if (isQuickEntryOpen || saveStatus === "saving") return;
    try {
      const entriesResult = await loadWorkspaceCollection("journal:entries", []);
      if (!Array.isArray(entriesResult?.items)) return;
      setJournalEntries((prev) => {
        const localById = new Map((prev || []).map((e) => [e?.id, e]));
        const merged = [];
        // Start with server items; preserve any local-only items not yet synced.
        for (const serverEntry of entriesResult.items) {
          const local = localById.get(serverEntry?.id);
          if (!local) {
            merged.push(serverEntry);
          } else {
            // Prefer local if it has unsaved edits (no updatedAt or newer updatedAt).
            const localUpdated = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;
            const serverUpdated = serverEntry?.updatedAt ? new Date(serverEntry.updatedAt).getTime() : 0;
            if (localUpdated > serverUpdated) {
              merged.push(local);
            } else {
              merged.push(serverEntry);
            }
          }
        }
        // Append local-only entries that are not on the server.
        const serverIds = new Set(entriesResult.items.map((e) => e?.id));
        for (const localEntry of prev || []) {
          if (!serverIds.has(localEntry?.id)) {
            merged.push(localEntry);
          }
        }
        return merged.slice(0, 2000);
      });
    } catch (error) {
      console.warn("Journal refresh from workspace failed.", error);
    }
  }, [isQuickEntryOpen, saveStatus]);

  useEffect(() => {
    const intervalId = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setReportPage(1);
  }, [journalFilters, selectedSymbols, journalView]);

  useEffect(() => {
    let cancelled = false;

    const hydrateWorkspaceJournal = async () => {
      try {
        const [entriesResult, reviewNoteResult] = await Promise.all([
          loadWorkspaceCollection("journal:entries", []),
          loadWorkspaceDoc("journal:review_note", "")
        ]);
        if (cancelled) return;
        if (Array.isArray(entriesResult?.items) && entriesResult.items.length) {
          setJournalEntries(entriesResult.items.slice(0, 2000));
        }
        if (typeof reviewNoteResult?.document === "string") {
          setReviewNote(reviewNoteResult.document);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Journal workspace sync unavailable.", error);
        }
      } finally {
        if (!cancelled) {
          journalSyncReadyRef.current = true;
        }
      }
    };

    hydrateWorkspaceJournal();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!journalThreadContext) return;
    setEntryDraft((prev) => ({
      ...prev,
      symbol: String(journalThreadContext.symbol || prev.symbol || "").toUpperCase(),
      preThesis: journalThreadContext.preThesis || prev.preThesis || "",
      decisionThreadId: journalThreadContext.decisionThreadId || prev.decisionThreadId || null
    }));
    setJournalPage("entry");
    setIsQuickEntryOpen(true);
  }, [journalThreadContext]);

  useEffect(() => {
    localStorage.setItem("zenin_journal_entries", JSON.stringify(journalEntries.slice(0, 300)));
    if (journalSyncReadyRef.current) {
      // Merge with the server collection before overwriting it, so entries
      // created server-side (e.g. from a decision thread) are not lost.
      const doSave = async () => {
        try {
          const result = await loadWorkspaceCollection("journal:entries", []);
          const serverItems = Array.isArray(result?.items) ? result.items : [];
          const localById = new Map(journalEntries.map((e) => [e?.id, e]));
          const serverById = new Map(serverItems.map((e) => [e?.id, e]));
          const merged = [];
          for (const serverEntry of serverItems) {
            const local = localById.get(serverEntry?.id);
            if (!local) {
              merged.push(serverEntry);
            } else {
              const localUpdated = local?.updatedAt ? new Date(local.updatedAt).getTime() : 0;
              const serverUpdated = serverEntry?.updatedAt ? new Date(serverEntry.updatedAt).getTime() : 0;
              merged.push(localUpdated > serverUpdated ? local : serverEntry);
            }
          }
          for (const localEntry of journalEntries) {
            if (!serverById.has(localEntry?.id)) {
              merged.push(localEntry);
            }
          }
          syncJournalCollection("journal:entries", merged.slice(0, 2000), 2000);
        } catch {
          // Fallback: save local list as before if the server read fails.
          syncJournalCollection("journal:entries", journalEntries.slice(0, 2000), 2000);
        }
      };
      doSave();
    }
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem(JOURNAL_REVIEW_NOTE_KEY, reviewNote);
    if (journalSyncReadyRef.current) {
      saveWorkspaceDoc("journal:review_note", reviewNote).catch((error) => {
        console.warn("Journal review note sync skipped.", error);
      });
    }
  }, [reviewNote]);

  useEffect(() => {
    const normalizeTimeframe = (trade) => {
      const mt = String(trade?.marketType || "").toLowerCase();
      if (mt.includes("option")) return "swing";
      if (mt.includes("crypto")) return "intraday";
      return "position";
    };
    const normalizeEmotion = () => "neutral";
    const nowIso = new Date().toISOString();

    setJournalEntries((prev) => {
      const existingKeys = new Set(
        (prev || [])
          .map((entry) => String(entry?.sourceTradeKey || "").trim())
          .filter(Boolean)
      );
      const additions = [];
      (Array.isArray(displayTransactions) ? displayTransactions : []).forEach((trade, idx) => {
        const sourceTradeKey = String(
          trade?.clientId ||
          trade?.id ||
          `${trade?.asset || "UNKNOWN"}-${trade?.executedAt || trade?.date || idx}-${trade?.type || ""}-${trade?.quantity || ""}-${trade?.price || ""}`
        );
        if (existingKeys.has(sourceTradeKey)) return;
        existingKeys.add(sourceTradeKey);
        additions.push({
          id: `jrnl-trade-${sourceTradeKey}`,
          sourceTradeKey,
          createdAt: nowIso,
          symbol: String(trade?.asset || "").toUpperCase(),
          tradeDate: trade?.executedAt || trade?.date || nowIso,
          side: String(trade?.side || trade?.type || "").toUpperCase(),
          quantity: Number(trade?.quantity) || 0,
          price: Number(trade?.price) || 0,
          notional: Number(trade?.notional) || 0,
          fees: Number(trade?.fee || 0),
          slippage: Number(trade?.slippage || 0),
          marketType: String(trade?.marketType || ""),
          status: String(trade?.status || "Filled"),
          strategy: String(trade?.strategyName || trade?.name || ""),
          setupTag: "",
          marketRegime: "",
          timeframe: normalizeTimeframe(trade),
          emotion: normalizeEmotion(),
          confidence: 5,
          preThesis: "",
          postReview: "",
          mistakeCategory: "",
          learned: "",
          chartLink: ""
        });
      });
      if (!additions.length) return prev;
      return [...additions, ...prev].slice(0, 500);
    });
  }, [displayTransactions]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(event.target)) {
        setIsExportMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refreshJournalEntries();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshJournalEntries]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setIsEntryDrawerOpen(false);
      setIsQuickEntryOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    if (isEntryDrawerOpen) {
      requestAnimationFrame(() => drawerRef.current?.focus());
    }
  }, [isEntryDrawerOpen]);

  const reportSymbols = useMemo(() => {
    const symbols = new Set();
    (Array.isArray(displayTransactions) ? displayTransactions : []).forEach((trade) => {
      const symbol = String(trade?.asset || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    (Array.isArray(portfolio) ? portfolio : []).forEach((holding) => {
      const symbol = String(holding?.symbol || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    return [...symbols];
  }, [displayTransactions, portfolio]);

  useEffect(() => {
    setReportPage(1);
    setRecentPage(1);
  }, [displayTransactions]);

  const handleCloseOption = (tradeId) => {
  const tradeToClose = activeOptionsTrades.find(t => t.id === tradeId);
  const closingMark = getLiveOptionMarkFromDerive(tradeToClose);
  
  const closedRecord = {
    id: `opt_close_${Date.now()}`,
    asset: tradeToClose.asset,
    type: tradeToClose.legs.direction === "short" ? "BUY" : "SELL", // Closing transaction
    quantity: tradeToClose.qty,
    price: closingMark,
    executedAt: new Date().toISOString(),
    notional: closingMark * tradeToClose.qty,
    marketType: "Options"
  };

  setTrades(prev => [...prev, closedRecord]);
  setActiveOptionsTrades(prev => prev.filter(t => t.id !== tradeId));
};

  useEffect(() => {
    if (reportSymbols.length === 0) {
      setLivePriceBySymbol({});
      setLastReportPriceRefreshAt(null);
      return;
    }

    let isCancelled = false;

    const enrichWithCategoryPrices = async (symbols, category, target) => {
      try {
        const res = await zeninFetch(
          `/watchlist?category=${encodeURIComponent(category)}&symbols=${encodeURIComponent(symbols.join(","))}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        assets.forEach((asset) => {
          const symbol = String(asset?.symbol || "").trim().toUpperCase();
          const price = Number(asset?.price);
          if (!symbol || !Number.isFinite(price)) return;
          target[symbol] = price;
        });
      } catch (error) {
        console.warn("[Journal] Watchlist price enrichment failed:", error?.message || error);
      }
    };

    const enrichWithSearchPrice = async (symbol, type, target) => {
      try {
        const res = await zeninFetch(
          `/search?q=${encodeURIComponent(symbol)}&type=${encodeURIComponent(type)}`
        );
        if (!res.ok) return false;
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const exact = results.find((item) => String(item?.symbol || "").trim().toUpperCase() === symbol) || results[0];
        const price = Number(exact?.price);
        if (!Number.isFinite(price)) return false;
        target[symbol] = price;
        return true;
      } catch (error) {
        console.warn(`[Journal] Search price lookup failed for ${symbol}:`, error?.message || error);
        return false;
      }
    };

    const refreshReportPrices = async () => {
      const next = {};
      const symbols = [...reportSymbols];

      await enrichWithCategoryPrices(symbols, "stocks", next);
      await enrichWithCategoryPrices(symbols, "bonds", next);
      await enrichWithCategoryPrices(symbols, "commodities", next);
      await enrichWithCategoryPrices(symbols, "metals", next);
      await enrichWithCategoryPrices(symbols, "crypto", next);

      const unresolved = symbols.filter((symbol) => !Number.isFinite(next[symbol]));
      for (const symbol of unresolved) {
        const foundTradfi = await enrichWithSearchPrice(symbol, "tradfi", next);
        if (foundTradfi) continue;
        await enrichWithSearchPrice(symbol, "crypto", next);
      }

      if (isCancelled) return;
      setLivePriceBySymbol((prev) => ({ ...prev, ...next }));
      setLastReportPriceRefreshAt(Date.now());
    };

    refreshReportPrices();
    const intervalId = setInterval(refreshReportPrices, TRADE_REPORT_REFRESH_MS);
    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [reportSymbols]);

  const executionRows = useMemo(() => {
    const ordered = [...displayTransactions].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    const runningPosition = new Map();
    const rows = ordered.map((trade) => {
      const { symbol, name } = resolveAssetIdentity(trade);
      const quantity = Math.max(0, Number(trade.quantity) || 0);
      const price = Number(trade.price) || 0;
      const side = String(trade.side || trade.type || "").toLowerCase() === "sell" ? "sell" : "buy";
      const direction = side === "sell" ? -1 : 1;
      const notionalRaw = Number(trade.notional);
      const notional = Number.isFinite(notionalRaw) ? Math.abs(notionalRaw) : Math.abs(price * quantity);
      const nextPosition = (runningPosition.get(symbol) || 0) + direction * quantity;
      runningPosition.set(symbol, nextPosition);

      const executionTs = trade.executedAt || (trade.date ? `${trade.date}T00:00:00.000Z` : "");
      const executionDate = executionTs
        ? new Date(executionTs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : (trade.date || "—");
      const positionAfterRaw = Number(trade.positionAfter);

      return {
        ...trade,
        asset: symbol,
        type: side === "sell" ? "SELL" : "BUY",
        quantity,
        price,
        notional,
        executionDate,
        positionAfter: Number.isFinite(positionAfterRaw) ? positionAfterRaw : nextPosition
      };
    });

    return rows.reverse();
  }, [displayTransactions]);

  const notify = (message, tone = "info") => {
    setToast({ id: Date.now(), message, tone });
  };

  const resetEntryDraft = () => {
    setEditingEntryId(null);
    setEntryDraft({
      sourceTradeKey: "",
      symbol: "",
      tradeDate: "",
      side: "",
      quantity: "",
      price: "",
      notional: "",
      marketType: "",
      status: "",
      strategy: "",
      setupTag: "",
      marketRegime: "",
      timeframe: "intraday",
      emotion: "neutral",
      confidence: 5,
      preThesis: "",
      postReview: "",
      mistakeCategory: "",
      learned: "",
      chartLink: "",
      decisionThreadId: null
    });
    setEntryErrors({});
  };

  const addJournalEntry = ({ attachments: evidenceFiles = [] } = {}) => {
    const nextErrors = {};
    if (!String(entryDraft.symbol || "").trim()) nextErrors.symbol = "Symbol is required.";
    if (!String(entryDraft.side || "").trim()) nextErrors.side = "Side is required.";
    setEntryErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      notify("Couldn't save entry. Try again.", "danger");
      return;
    }
    setSaveStatus("saving");
    const evidenceMeta = evidenceFiles.length > 0
      ? evidenceFiles.map((f) => ({ name: f.name, size: f.size, type: f.type }))
      : [];
    const normalized = {
      ...entryDraft,
      symbol: String(entryDraft.symbol || "").toUpperCase(),
      quantity: Number(entryDraft.quantity) || 0,
      price: Number(entryDraft.price) || 0,
      notional: Number(entryDraft.notional) || 0,
      status: entryDraft.status || "Open",
      tradeDate: entryDraft.tradeDate || new Date().toISOString(),
      decisionThreadId: entryDraft.decisionThreadId || null,
      evidenceFiles: evidenceMeta
    };
    if (editingEntryId) {
      setJournalEntries((prev) =>
        prev.map((entry) =>
          entry.id === editingEntryId
            ? { ...entry, ...normalized, updatedAt: new Date().toISOString() }
            : entry
        )
      );
      notify("Journal entry updated.", "success");
    } else {
      const newEntry = {
        id: `jrnl-${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...normalized
      };
      setJournalEntries((prev) => [newEntry, ...prev]);
      notify("Journal entry saved.", "success");
    }
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 900);
    resetEntryDraft();
    setIsQuickEntryOpen(false);
  };

  const analytics = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const eps = 1e-8;
    // Centralized asset identity: never emits "UNKNOWN" when a usable symbol/name
    // exists (e.g. prediction-market questions). Accepts either a raw value or a
    // trade/holding object so name is available as a fallback.
    const normalizeSymbol = (value) => {
      const tradeObj = (value && typeof value === "object") ? value : { symbol: value, asset: value };
      const resolved = resolveAssetIdentity(tradeObj);
      return resolved.symbol;
    };
    const safeNum = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };
    const parseTradeDate = (dateStr) => {
      const d = new Date(dateStr);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const normalizeStrategy = (value) => String(value || "").trim();
    const isOptionTrade = (trade) => {
      const marketType = String(trade?.marketType || trade?.market_type || "").toLowerCase();
      if (marketType.includes("option")) return true;
      if (trade?.legs && typeof trade.legs === "object") return true;
      if (trade?.optionType || trade?.expiry || trade?.strike != null) return true;
      const strategy = String(trade?.strategyName || trade?.strategy || "").trim();
      return strategy.length > 0;
    };
    const buildReportKey = (asset, trade) => {
      if (!isOptionTrade(trade)) return `${asset}::spot`;
      const strategy = normalizeStrategy(trade?.strategyName || trade?.strategy || "Options");
      return `${asset}::options::${strategy}`;
    };

    const sortedTrades = [...displayTransactions].sort((a, b) => {
      const ta = parseTradeDate(a.executedAt || a.date)?.getTime() ?? 0;
      const tb = parseTradeDate(b.executedAt || b.date)?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    const lotsByAsset = new Map();
    const realized = [];
    let totalHoldDurationQty = 0;
    let totalHoldDurationQtyDays = 0;
    let totalVolume = 0;

    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      const asset = normalizeSymbol(trade);
      const reportKey = buildReportKey(asset, trade);
      const optionTrade = isOptionTrade(trade);
      const strategy = normalizeStrategy(trade?.strategyName || trade?.strategy || "");
      const qty = Math.max(0, safeNum(trade.quantity));
      const price = safeNum(trade.price);
      const dateObj = parseTradeDate(trade.executedAt || trade.date);
      if (qty <= 0) continue;

      const tradeNotionalRaw = safeNum(trade.notional);
      const tradeNotional = Math.abs(tradeNotionalRaw > 0 ? tradeNotionalRaw : price * qty);
      totalVolume += tradeNotional;

      if (type === "BUY") {
        const lots = lotsByAsset.get(reportKey) || [];
        lots.push({ qty, price, date: dateObj });
        lotsByAsset.set(reportKey, lots);
        continue;
      }

      if (type === "SELL") {
        const lots = lotsByAsset.get(reportKey) || [];
        let remaining = qty;
        while (remaining > 0 && lots.length > 0) {
          const lot = lots[0];
          const matchedQty = Math.min(remaining, lot.qty);
          const pnl = (price - lot.price) * matchedQty;
          const holdDays = lot.date && dateObj
            ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / dayMs)
            : 0;

          const normalizedCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(trade.date || "")
            ? trade.date
            : (dateObj ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}` : "");

          realized.push({
            reportKey,
            asset,
            strategy,
            isOption: optionTrade,
            marketType: optionTrade ? "options" : (trade.marketType || trade.market_type || ""),
            // Source attribution so analytics can roll up P&L by connection.
            source: String(trade?.platform || trade?.sourceType || "unknown"),
            pnl,
            holdDays,
            qty: matchedQty,
            volume: price * matchedQty,
            closeDate: normalizedCloseDate
          });
          totalHoldDurationQty += matchedQty;
          totalHoldDurationQtyDays += holdDays * matchedQty;

          lot.qty -= matchedQty;
          remaining -= matchedQty;
          if (lot.qty <= 0) lots.shift();
        }
        lotsByAsset.set(reportKey, lots);
      }
    }

    const wins = realized.filter((r) => r.pnl > eps);
    const losses = realized.filter((r) => r.pnl < -eps);
    const breakevens = realized.filter((r) => Math.abs(r.pnl) <= eps);
    const decisiveTrades = wins.length + losses.length;
    const totalRealizedTrades = decisiveTrades + breakevens.length;
    const realizedGainLoss = realized.reduce((acc, r) => acc + r.pnl, 0);
    for (const lots of lotsByAsset.values()) {
      for (const lot of lots) {
        const lotQty = Math.max(0, safeNum(lot.qty));
        if (lotQty <= eps) continue;
        const holdDays = lot.date ? Math.max(0, (nowTs - lot.date.getTime()) / dayMs) : 0;
        totalHoldDurationQty += lotQty;
        totalHoldDurationQtyDays += holdDays * lotQty;
      }
    }
    const avgHoldDays = totalHoldDurationQty > eps
      ? totalHoldDurationQtyDays / totalHoldDurationQty
      : 0;

    const tradeDates = [...new Set(
      sortedTrades
        .map((t) => {
          const d = parseTradeDate(t.executedAt || t.date);
          if (!d) return "";
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })
        .filter(Boolean)
    )];
    const activeDays = Math.max(1, tradeDates.length);

    let maxConsecutiveWin = 0;
    let maxConsecutiveLoss = 0;
    let currentWin = 0;
    let currentLoss = 0;
    for (const r of realized) {
      if (r.pnl > eps) {
        currentWin += 1;
        currentLoss = 0;
      } else if (r.pnl < -eps) {
        currentLoss += 1;
        currentWin = 0;
      } else {
        currentWin = 0;
        currentLoss = 0;
      }
      maxConsecutiveWin = Math.max(maxConsecutiveWin, currentWin);
      maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currentLoss);
    }

    const avgTradeWin = wins.length
      ? wins.reduce((acc, r) => acc + r.pnl, 0) / wins.length
      : 0;
    const avgTradeLoss = losses.length
      ? losses.reduce((acc, r) => acc + r.pnl, 0) / losses.length
      : 0;

    const largestGain = wins.length
      ? Math.max(...wins.map((r) => r.pnl))
      : 0;
    const largestLoss = losses.length
      ? Math.min(...losses.map((r) => r.pnl))
      : 0;

    const symbolStats = new Map();
    const bumpSymbolExecution = (trade) => {
      const asset = normalizeSymbol(trade.asset);
      const isOption = isOptionTrade(trade);
      const strat = normalizeStrategy(trade.strategyName || trade.strategy || "");
      const key = buildReportKey(asset, trade);
      const type = (trade.type || "").toUpperCase();
      const qty = Math.max(0, safeNum(trade.quantity));
      const price = safeNum(trade.price);
      const row = symbolStats.get(key) || {
        reportKey: key,
        symbol: isOption ? `${asset} (Options)` : asset,
        asset,
        strategy: strat,
        isOption,
        assetClass: isOption ? "Options" : "Spot/Other",
        executionCount: 0,
        realizedCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalHoldDays: 0,
        totalGain: 0,
        tradedNotional: 0,
        buyQty: 0,
        sellQty: 0,
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      row.executionCount += 1;
      const notional = Math.abs(safeNum(trade.notional) || (price * qty));
      row.tradedNotional += notional;
      if (type === "SELL") {
        row.sellQty += qty;
        row.netQtyFromTrades -= qty;
      } else {
        row.buyQty += qty;
        row.netQtyFromTrades += qty;
      }
      symbolStats.set(key, row);
    };

    for (const trade of sortedTrades) {
      bumpSymbolExecution(trade);
    }

    for (const r of realized) {
      const isOption = !!r.isOption;
      const strat = normalizeStrategy(r.strategy || "");
      const key = r.reportKey || (r.asset || "UNKNOWN");
      const row = symbolStats.get(key) || {
        reportKey: key,
        symbol: isOption ? `${normalizeSymbol(r.asset)} (Options)` : normalizeSymbol(r.asset),
        asset: normalizeSymbol(r.asset),
        strategy: strat,
        isOption,
        assetClass: isOption ? "Options" : "Spot/Other",
        executionCount: 0,
        realizedCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalHoldDays: 0,
        totalGain: 0,
        tradedNotional: 0,
        buyQty: 0,
        sellQty: 0,
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      row.realizedCount += 1;
      row.totalHoldDays += r.holdDays;
      row.holdDurationQty += Math.max(0, safeNum(r.qty));
      row.holdDurationQtyDays += r.holdDays * Math.max(0, safeNum(r.qty));
      row.totalGain += r.pnl;
      if (r.pnl > eps) row.wins += 1;
      else if (r.pnl < -eps) row.losses += 1;
      else row.breakevens += 1;
      symbolStats.set(key, row);
    }

    for (const [reportKey, lots] of lotsByAsset.entries()) {
      const row = symbolStats.get(reportKey) || {
        reportKey,
        symbol: reportKey,
        asset: reportKey.split("::")[0] || reportKey,
        strategy: "",
        isOption: reportKey.includes("::options::"),
        assetClass: reportKey.includes("::options::") ? "Options" : "Spot/Other",
        executionCount: 0,
        realizedCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalHoldDays: 0,
        totalGain: 0,
        tradedNotional: 0,
        buyQty: 0,
        sellQty: 0,
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      for (const lot of lots) {
        const lotQty = Math.max(0, safeNum(lot.qty));
        if (lotQty <= eps) continue;
        const holdDays = lot.date ? Math.max(0, (nowTs - lot.date.getTime()) / dayMs) : 0;
        row.holdDurationQty += lotQty;
        row.holdDurationQtyDays += holdDays * lotQty;
      }
      symbolStats.set(reportKey, row);
    }

    const portfolioPositionMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding);
      portfolioPositionMap.set(symbol, (portfolioPositionMap.get(symbol) || 0) + safeNum(holding.quantity));
    }

    const lastBuyPriceBySymbol = new Map();
    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      if (type !== "BUY") continue;
      const symbol = normalizeSymbol(trade);
      const price = safeNum(trade.price);
      if (price > 0) {
        lastBuyPriceBySymbol.set(symbol, price);
      }
    }

    const portfolioPriceMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding);
      const price = safeNum(holding.price);
      if (price > 0) {
        portfolioPriceMap.set(symbol, price);
      }
    }

    const tradedAssetsReport = [...symbolStats.values()]
      .map((row) => {
        const decisive = row.wins + row.losses;
        const winRate = decisive ? (row.wins / decisive) * 100 : 0;
        const avgDuration = row.holdDurationQty > eps ? (row.holdDurationQtyDays / row.holdDurationQty) : 0;
        const openLots = lotsByAsset.get(row.reportKey) || [];
        const openQty = openLots.reduce((sum, lot) => sum + safeNum(lot.qty), 0);
        const openCost = openLots.reduce((sum, lot) => sum + (safeNum(lot.qty) * safeNum(lot.price)), 0);
        const avgPurchasePrice = openQty > eps
          ? openCost / openQty
          : (lastBuyPriceBySymbol.get(row.asset) || 0);
        const currentPrice =
          safeNum(livePriceBySymbol[row.asset]) ||
          portfolioPriceMap.get(row.asset) ||
          0;
        const priceMove = (avgPurchasePrice > 0 && currentPrice > 0)
          ? (currentPrice - avgPurchasePrice)
          : 0;
        const currentPosition = row.isOption
          ? row.netQtyFromTrades
          : portfolioPositionMap.has(row.asset)
          ? portfolioPositionMap.get(row.asset)
          : row.netQtyFromTrades;
        const totalGain = currentPosition > eps ? priceMove * currentPosition : 0;
        const avgGain = priceMove;

        return {
          reportKey: row.reportKey,
          symbol: row.symbol,
          asset: row.asset || row.symbol,
          strategy: row.strategy || "",
          isOption: !!row.isOption,
          assetClass: row.assetClass || (row.isOption ? "Options" : "Spot/Other"),
          tradeCount: row.executionCount,
          tradedNotional: row.tradedNotional,
          netPosition: row.isOption
            ? row.netQtyFromTrades
            : portfolioPositionMap.has(row.asset)
            ? portfolioPositionMap.get(row.asset)
            : row.netQtyFromTrades,
          winRate,
          tradeDuration: avgDuration,
          avgGain,
          totalGain
        };
      })
      .sort((a, b) => {
        if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
        if (b.tradedNotional !== a.tradedNotional) return b.tradedNotional - a.tradedNotional;
        if (b.totalGain !== a.totalGain) return b.totalGain - a.totalGain;
        return a.symbol.localeCompare(b.symbol);
      });

    // Per-source realized-P&L rollup. Groups closed round-trips by their
    // connection source so the Journal can surface win rate / realized P&L /
    // volume per connection — a capability the source filter makes meaningful.
    const sourceStats = new Map();
    for (const r of realized) {
      const src = String(r.source || "unknown");
      const row = sourceStats.get(src) || { source: src, trades: 0, wins: 0, losses: 0, breakevens: 0, realizedPnl: 0, volume: 0 };
      row.trades += 1;
      row.realizedPnl += Number(r.pnl || 0);
      row.volume += Number(r.volume || 0);
      if (Number(r.pnl || 0) > eps) row.wins += 1;
      else if (Number(r.pnl || 0) < -eps) row.losses += 1;
      else row.breakevens += 1;
      sourceStats.set(src, row);
    }
    const bySource = [...sourceStats.values()]
      .map((row) => {
        const decisive = row.wins + row.losses;
        return { ...row, winRate: decisive ? (row.wins / decisive) * 100 : 0 };
      })
      .sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl));

    const unrealizedFromOpenLots = [...lotsByAsset.entries()].reduce((sum, [symbol, lots]) => {
      const currentPrice =
        safeNum(livePriceBySymbol[symbol]) ||
        portfolioPriceMap.get(symbol) ||
        0;
      if (currentPrice <= 0) return sum;
      return sum + lots.reduce((lotSum, lot) => {
        const lotQty = Math.max(0, safeNum(lot.qty));
        const lotEntry = safeNum(lot.price);
        if (lotQty <= eps || lotEntry <= 0) return lotSum;
        return lotSum + ((currentPrice - lotEntry) * lotQty);
      }, 0);
    }, 0);

    const openLotSymbols = new Set([...lotsByAsset.keys()]);
    const unrealizedFromPortfolioFallback = (portfolio || []).reduce((sum, holding) => {
      const symbol = normalizeSymbol(holding);
      if (openLotSymbols.has(symbol)) return sum;
      const currentPrice = safeNum(holding.price);
      const qty = safeNum(holding.quantity);
      const entryPrice = safeNum(holding.entryPrice);
      if (currentPrice <= 0 || qty <= 0 || entryPrice <= 0) return sum;
      return sum + ((currentPrice - entryPrice) * qty);
    }, 0);

    const unrealizedPnlFromOptions = (activeOptionsTrades || []).reduce((sum, trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      return sum + (metrics.pnl || 0);
    }, 0);

    const unrealizedPnl = unrealizedFromOpenLots + unrealizedFromPortfolioFallback + unrealizedPnlFromOptions;
    const totalGainLoss = realizedGainLoss + unrealizedPnl;

    return {
      totalTrades: sortedTrades.length,
      avgHoldDays,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: decisiveTrades ? (wins.length / decisiveTrades) * 100 : 0,
      breakevenRate: totalRealizedTrades ? (breakevens.length / totalRealizedTrades) * 100 : 0,
      totalGainLoss,
      realizedPnl: realizedGainLoss,
      unrealizedPnl,
      tradeExpectancy: realized.length ? realizedGainLoss / realized.length : 0,
      avgDailyGain: totalGainLoss / activeDays,
      avgDailyVolume: totalVolume / activeDays,
      largestGain,
      totalVolume,
      avgTradesPerDay: sortedTrades.length / activeDays,
      avgTradeWin,
      avgTradeLoss,
      maxConsecutiveWin,
      maxConsecutiveLoss,
      largestLoss: Math.abs(largestLoss) <= eps ? 0 : largestLoss,
      tradedAssetsReport,
      bySource,
      realizedTrades: realized
    };
  }, [displayTransactions, portfolio, livePriceBySymbol, nowTs, activeOptionsTrades, multiChainCache, spotPrices]);

  const weeklyMonthlyReview = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
    const weekTrades = (analytics.realizedTrades || []).filter((t) => new Date(t.closeDate || 0).getTime() >= weekAgo);
    const monthTrades = (analytics.realizedTrades || []).filter((t) => new Date(t.closeDate || 0).getTime() >= monthAgo);
    const summarize = (rows) => {
      const wins = rows.filter((r) => Number(r.pnl || 0) > 0).length;
      const losses = rows.filter((r) => Number(r.pnl || 0) < 0).length;
      const total = rows.reduce((sum, r) => sum + Number(r.pnl || 0), 0);
      const grossWin = rows.filter((r) => Number(r.pnl || 0) > 0).reduce((s, r) => s + Number(r.pnl || 0), 0);
      const grossLoss = Math.abs(rows.filter((r) => Number(r.pnl || 0) < 0).reduce((s, r) => s + Number(r.pnl || 0), 0));
      const profitFactor = grossLoss > 0 ? grossWin / grossLoss : 0;
      const expectancy = rows.length ? total / rows.length : 0;
      return { wins, losses, total, profitFactor, expectancy };
    };
    return {
      weekly: summarize(weekTrades),
      monthly: summarize(monthTrades)
    };
  }, [analytics.realizedTrades]);

  const filteredJournalEntries = useMemo(() => {
    return (journalEntries || []).filter((entry) => {
      const dateOk = isWithinJournalDateWindow(entry.tradeDate || entry.createdAt, journalFilters.dateWindow);
      const strategyOk = journalFilters.strategy === "all" || String(entry.strategy || "").toLowerCase() === journalFilters.strategy;
      const timeframeOk = journalFilters.timeframe === "all" || String(entry.timeframe || "").toLowerCase() === journalFilters.timeframe;
      const emotionOk = journalFilters.emotion === "all" || String(entry.emotion || "").toLowerCase() === journalFilters.emotion;
      const textBlob = `${entry.symbol || ""} ${entry.strategy || ""} ${entry.preThesis || ""} ${entry.postReview || ""} ${entry.learned || ""}`.toLowerCase();
      const searchOk = !journalFilters.search.trim() || textBlob.includes(journalFilters.search.trim().toLowerCase());
      return dateOk && strategyOk && timeframeOk && emotionOk && searchOk;
    });
  }, [journalEntries, journalFilters]);

  const portfolioValue = useMemo(
    () => (portfolio || []).reduce((total, item) => total + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0),
    [portfolio]
  );
  const availableBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const totalAccountEquity = Number.isFinite(Number(accountEquity))
    ? Number(accountEquity)
    : availableBalance + portfolioValue;

  const winLossCounts = useMemo(() => ({
    winners: Math.max(analytics.wins, 0),
    losers: Math.max(analytics.losses, 0),
    breakeven: Math.max(analytics.breakevens, 0)
  }), [analytics.wins, analytics.losses, analytics.breakevens]);
  const winLossSeries = useMemo(() => [winLossCounts.winners, winLossCounts.losers, winLossCounts.breakeven], [winLossCounts]);
  const winLossOptions = useMemo(() => ({
    chart: { type: "donut", background: "transparent", fontFamily: "inherit" },
    labels: ["Winners", "Losers", "Breakeven"],
    legend: { show: false },
    stroke: { show: false },
    dataLabels: { enabled: false },
    colors: [chartColors.success(), chartColors.danger(), chartColors.muted()],
    plotOptions: { pie: { donut: { size: "68%" } } },
    tooltip: { theme: activeChartThemeMode() },
    theme: { mode: activeChartThemeMode() }
  }), []);

  const statsRows = [
    { label: "Total Gain/Loss", value: analytics.totalGainLoss, currency: true },
    { label: "Realized PnL", value: analytics.realizedPnl, currency: true },
    { label: "Unrealized PnL", value: analytics.unrealizedPnl, currency: true },
    { label: "Decision Expectancy", value: analytics.tradeExpectancy, currency: true },
    { label: "Avg Daily Gain", value: analytics.avgDailyGain, currency: true },
    { label: "Avg Daily Volume", value: analytics.avgDailyVolume, currency: true },
    { label: "Largest Gain", value: analytics.largestGain, currency: true },
    { label: "Total Decision Volume", value: analytics.totalVolume, currency: true },
    { label: "Avg # of Decisions/day", value: analytics.avgTradesPerDay },
    { label: "Avg Decision Win", value: analytics.avgTradeWin, currency: true },
    { label: "Avg Decision Loss", value: analytics.avgTradeLoss, currency: true },
    { label: "Max Consecutive Win", value: analytics.maxConsecutiveWin },
    { label: "Max Consecutive Loss", value: analytics.maxConsecutiveLoss },
    { label: "Largest Losses", value: analytics.largestLoss, currency: true }
  ];

  const formatValue = (val, currency = false) => {
    const safeVal = Number.isFinite(Number(val)) ? Number(val) : 0;
    if (currency) {
      return `$${safeVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return safeVal.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatDurationFromDays = (days) => {
    const safeDays = Number.isFinite(Number(days)) ? Number(days) : 0;
    const hours = safeDays * 24;
    if (Math.abs(hours) < 24) {
      return `${hours.toFixed(1)}h`;
    }
    return `${safeDays.toFixed(1)}d`;
  };

  const reportRowsPerPage = 10;
  const reportTotalPages = Math.max(1, Math.ceil(analytics.tradedAssetsReport.length / reportRowsPerPage));
  const safeReportPage = Math.min(reportPage, reportTotalPages);
  const pagedReportRows = analytics.tradedAssetsReport.slice(
    (safeReportPage - 1) * reportRowsPerPage,
    safeReportPage * reportRowsPerPage
  );

  const recentRowsPerPage = 10;
  const groupedExecutionRows = useMemo(() => {
    if (!Array.isArray(executionRows) || executionRows.length === 0) return [];
    const grouped = [];
    let current = null;
    executionRows.forEach((row, index) => {
      const asset = String(row?.asset || "").trim().toUpperCase();
      if (!current || current.asset !== asset) {
        if (current) grouped.push(current);
        const fallbackKey = `${asset || "UNKNOWN"}::${row?.executedAt || row?.date || index}`;
        current = {
          key: `${asset}::${row?.id || row?.clientId || fallbackKey}`,
          asset,
          header: row,
          items: [row]
        };
      } else {
        current.items.push(row);
      }
    });
    if (current) grouped.push(current);
    return grouped;
  }, [executionRows]);

  const recentTotalPages = Math.max(1, Math.ceil(groupedExecutionRows.length / recentRowsPerPage));
  const safeRecentPage = Math.min(recentPage, recentTotalPages);
  const pagedExecutionRows = groupedExecutionRows.slice(
    (safeRecentPage - 1) * recentRowsPerPage,
    safeRecentPage * recentRowsPerPage
  );

  useEffect(() => {
    setExpandedExecutionGroups({});
  }, [safeRecentPage, executionRows.length]);

  useEffect(() => {
    if (journalView !== "calendar") {
      setSelectedCalendarTradeDate("");
    }
  }, [journalView]);

  // Phase 4: hydrate the visible calendar month from the immutable snapshot
  // service. This is the ONLY historical source the heatmap reads once the
  // migration has produced snapshots for the account.
  useEffect(() => {
    if (journalView !== "calendar") return undefined;
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    if (snapshotsLoadedFor === key && snapshotFetchState === "ready") return undefined;
    let cancelled = false;
    setSnapshotFetchState(snapshotsLoadedFor === key ? "idle" : "loading");
    (async () => {
      try {
        const res = await zeninFetch(`/api/history/daily?year=${year}&month=${month}`);
        if (cancelled) return;
        if (!res || !res.ok) {
          // Non-2xx (401/429/5xx) — must NOT render as zero P&L (Fix #6/#17).
          setSnapshotFetchState("error");
          setSnapshotsLoadedFor(key);
          return;
        }
        const data = res && typeof res.json === "function" ? await res.json() : res;
        const list = (data && Array.isArray(data.snapshots) ? data.snapshots : []) || [];
        if (cancelled) return;
        const map = new Map();
        list.forEach((s) => { if (s && s.date) map.set(s.date, s); });
        setSnapshotsByDate(map);
        // Distinguish real empty (200 OK, no rows) from an error.
        setSnapshotFetchState(list.length === 0 ? "empty" : "ready");
        setSnapshotsLoadedFor(key);
      } catch {
        // Network failure / circuit-open — do not render as zero (Fix #6/#17).
        if (!cancelled) {
          setSnapshotFetchState("error");
          setSnapshotsLoadedFor(key);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [journalView, calendarCursor, snapshotsLoadedFor, snapshotFetchState]);

  const frequentTradedSymbols = analytics.tradedAssetsReport
    .filter((row) => row.tradeCount > 0)
    .map((row) => row.symbol);
  const filteredSymbolSearch = frequentTradedSymbols.filter((symbol) =>
    symbol.toLowerCase().includes(calendarSearch.trim().toLowerCase())
  );

  const toggleCalendarSymbol = (symbol) => {
    const s = (symbol || "").trim().toUpperCase();
    if (!s || !frequentTradedSymbols.includes(s)) return;
    setSelectedSymbols((prev) =>
      prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
    );
    setSymbolsButtonLabel("Ready Selected Symbols");
    setTimeout(() => {
      setSymbolsButtonLabel("All Symbols");
    }, 1500);
  };

  const calendarPnlByDate = useMemo(() => {
    const equityByDate = new Map();
    const sorted = [...executionRows].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      return ta - tb;
    });

    for (const trade of sorted) {
      const dayKey = toDateKey(trade.executedAt || trade.date);
      if (!dayKey) continue;
      const eqRaw = Number(trade.accountEquityAfter);
      const balRaw = Number(trade.balanceAfter);
      const pvRaw = Number(trade.portfolioValueAfter);
      const eq = Number.isFinite(eqRaw)
        ? eqRaw
        : (Number.isFinite(balRaw) && Number.isFinite(pvRaw) ? balRaw + pvRaw : null);
      // Do NOT store missing equity as $0 — that would fabricate days at zero
      // (Fix #18: null !== 0). Only real equity observations are recorded.
      if (Number.isFinite(eq) && eq !== 0) {
        // keep last execution equity snapshot of that day
        equityByDate.set(dayKey, eq);
      }
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (Number.isFinite(totalAccountEquity) && totalAccountEquity !== 0) {
      equityByDate.set(todayKey, Number(totalAccountEquity));
    }

    const orderedDates = [...equityByDate.keys()].sort();
    const pnlByDate = new Map();
    // Do not fabricate a $10,000 seed baseline — that would manufacture P&L on
    // the first known day. Derive the baseline from the first recorded equity; if
    // only one day exists, P&L for that day is 0 (no delta to compare against).
    let prevEquity = null;
    for (const day of orderedDates) {
      const eq = Number(equityByDate.get(day));
      if (!Number.isFinite(eq)) continue;
      if (prevEquity == null) {
        prevEquity = eq; // first observation — no P&L to compute yet
      } else {
        pnlByDate.set(day, eq - prevEquity);
        prevEquity = eq;
      }
    }

    if (selectedSymbols.length === 0) {
      return pnlByDate;
    }

    // Symbol-filtered fallback uses realized closes for selected symbols.
    const activeSet = new Set(selectedSymbols);
    const realizedByDate = new Map();
    for (const trade of analytics.realizedTrades) {
      if (!trade.closeDate) continue;
      if (activeSet.size > 0 && !activeSet.has((trade.asset || "").toUpperCase())) {
        continue;
      }
      realizedByDate.set(trade.closeDate, (realizedByDate.get(trade.closeDate) || 0) + (Number(trade.pnl) || 0));
    }
    return realizedByDate;
  }, [analytics.realizedTrades, selectedSymbols, executionRows, totalAccountEquity]);

  const calendarMonthLabel = calendarCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
  const calendarYear = calendarCursor.getFullYear();
  const calendarMonth = calendarCursor.getMonth();
  const firstDayOffset = new Date(calendarYear, calendarMonth, 1).getDay();
  const monthDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const calendarCells = Array.from({ length: firstDayOffset + monthDays }, (_, idx) => {
    const dayNum = idx - firstDayOffset + 1;
    if (dayNum < 1) return { type: "blank", key: `b-${idx}` };
    const key = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    // Prefer the immutable snapshot's stored daily P&L when available; fall back
    // to the legacy render-time delta only when no snapshot exists for the day.
    const snapshot = snapshotsByDate.get(key);
    const pnl = snapshot != null ? snapshot.dailyPnl : calendarPnlByDate.get(key);
    return { type: "day", key, dayNum, pnl: Number.isFinite(pnl) ? pnl : null, snapshot };
  });

  const moveCalendarMonth = (delta) => {
    setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const moveCalendarYear = (delta) => {
    setCalendarCursor((prev) => new Date(prev.getFullYear() + delta, prev.getMonth(), 1));
  };

  const reportExportRows = useMemo(
    () => (Array.isArray(analytics?.tradedAssetsReport) ? analytics.tradedAssetsReport : []),
    [analytics?.tradedAssetsReport]
  );

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const escapeCsvCell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const downloadCsv = (rows, fileName) => {
    const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, fileName);
  };

  const exportTradedAssetsToExcel = () => {
    if (!reportExportRows.length) return;
    const generatedAt = new Date().toISOString();
    const rowsHtml = reportExportRows
      .map((row) => `
        <tr>
          <td>${row.symbol || ""}</td>
          <td>${row.assetClass || ""}</td>
          <td>${Number(row.tradeCount || 0)}</td>
          <td>${Number(row.tradedNotional || 0).toFixed(2)}</td>
          <td>${Number(row.netPosition || 0).toFixed(4)}</td>
          <td>${Number(row.winRate || 0).toFixed(1)}%</td>
          <td>${formatDurationFromDays(row.tradeDuration || 0)}</td>
          <td>${Number(row.avgGain || 0).toFixed(2)}</td>
          <td>${Number(row.totalGain || 0).toFixed(2)}</td>
        </tr>
      `)
      .join("");

    const html = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <table border="1">
            <caption>Decision Assets Report - Generated ${generatedAt}</caption>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Asset Class</th>
                <th>Decision Count</th>
                <th>Decision Notional</th>
                <th>Current Position</th>
                <th>Win Rate</th>
                <th>Decision Duration</th>
                <th>Avg Gain</th>
                <th>Total Gain</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
    downloadBlob(blob, `traded-assets-report-${new Date().toISOString().slice(0, 10)}.xls`);
  };

  const createSimplePdfBlob = (lines = []) => {
    const escapePdfText = (value) => String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");

    const pageWidth = 595;
    const pageHeight = 842;
    const leftX = 40;
    const topY = pageHeight - 50;
    const lineHeight = 14;

    const contentLines = [];
    contentLines.push("BT");
    contentLines.push("/F1 10 Tf");
    contentLines.push(`${leftX} ${topY} Td`);
    lines.forEach((line, idx) => {
      if (idx === 0) {
        contentLines.push(`(${escapePdfText(line)}) Tj`);
      } else {
        contentLines.push(`0 -${lineHeight} Td`);
        contentLines.push(`(${escapePdfText(line)}) Tj`);
      }
    });
    contentLines.push("ET");
    const contentStream = contentLines.join("\n");

    const objects = [
      "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
      "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
      `5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`
    ];

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const obj of objects) {
      offsets.push(pdf.length);
      pdf += obj;
    }
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return new Blob([pdf], { type: "application/pdf" });
  };

  const exportTradedAssetsToPdf = () => {
    if (!reportExportRows.length) return;
    const header = "Symbol | Class | Trades | Traded Notional | Position | Win Rate | Duration | Avg Gain | Total Gain";
    const separator = "-".repeat(120);
    const lines = [
      `Traded Assets Report - ${new Date().toLocaleString()}`,
      separator,
      header,
      separator,
      ...reportExportRows.map((row) => {
        const symbol = String(row.symbol || "").padEnd(8, " ").slice(0, 8);
        const tradesCount = String(Number(row.tradeCount || 0)).padStart(3, " ");
        const tradedNotional = Number(row.tradedNotional || 0).toFixed(2).padStart(12, " ");
        const position = Number(row.netPosition || 0).toFixed(4).padStart(10, " ");
        const winRate = `${Number(row.winRate || 0).toFixed(1)}%`.padStart(7, " ");
        const duration = formatDurationFromDays(row.tradeDuration || 0).padStart(7, " ");
        const avgGain = Number(row.avgGain || 0).toFixed(2).padStart(10, " ");
        const totalGain = Number(row.totalGain || 0).toFixed(2).padStart(10, " ");
        const assetClass = String(row.assetClass || "").padEnd(8, " ").slice(0, 8);
        return `${symbol} | ${assetClass} | ${tradesCount} | ${tradedNotional} | ${position} | ${winRate} | ${duration} | ${avgGain} | ${totalGain}`;
      })
    ];

    const blob = createSimplePdfBlob(lines.slice(0, 45));
    downloadBlob(blob, `traded-assets-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const appendLocalReviewTask = (task) => {
    try {
      const existing = JSON.parse(localStorage.getItem(JOURNAL_REVIEW_TASKS_KEY) || "[]");
      const rows = Array.isArray(existing) ? existing : [];
      const nextRows = [task, ...rows].slice(0, 100);
      localStorage.setItem(JOURNAL_REVIEW_TASKS_KEY, JSON.stringify(nextRows));
      syncJournalCollection("journal:review_tasks", nextRows, 100);
    } catch {
      localStorage.setItem(JOURNAL_REVIEW_TASKS_KEY, JSON.stringify([task]));
      syncJournalCollection("journal:review_tasks", [task], 100);
    }
  };

  const monthDateRangeLabel = useMemo(() => {
    const start = new Date(calendarYear, calendarMonth, 1);
    const end = new Date(calendarYear, calendarMonth + 1, 0);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }, [calendarYear, calendarMonth]);

  const setupOptions = useMemo(() => {
    const set = new Set();
    (journalEntries || []).forEach((entry) => {
      const s = String(entry?.setupTag || entry?.strategy || "").trim();
      if (s) set.add(s);
    });
    return [...set];
  }, [journalEntries]);

  const regimeOptions = useMemo(() => {
    const set = new Set();
    (journalEntries || []).forEach((entry) => {
      const s = String(entry?.marketRegime || "").trim();
      if (s) set.add(s);
    });
    return [...set];
  }, [journalEntries]);

  const symbolOptions = useMemo(() => {
    const set = new Set();
    executionRows.forEach((row) => {
      const sym = String(row?.asset || "").trim().toUpperCase();
      if (sym) set.add(sym);
    });
    return [...set];
  }, [executionRows]);

  const mapBySourceTradeKey = useMemo(() => {
    const map = new Map();
    (journalEntries || []).forEach((entry) => {
      const key = String(entry?.sourceTradeKey || "").trim();
      if (key) map.set(key, entry);
    });
    return map;
  }, [journalEntries]);

  const displayedExecutionRows = useMemo(() => {
    const rows = executionRows.slice(0, 8).filter((row) => {
      if (selectedSources.size > 0 && !selectedSources.has(resolveSourceId(row))) return false;
      if (selectedSymbols.length > 0 && !selectedSymbols.includes(String(row?.asset || "").toUpperCase()) && !selectedSymbols.includes(String(row?.name || ""))) return false;
      const entry = mapBySourceTradeKey.get(String(row?.clientId || row?.id || ""));
      if (journalFilters.search.trim()) {
        const blob = `${row?.asset || ""} ${entry?.preThesis || ""} ${entry?.postReview || ""}`.toLowerCase();
        if (!blob.includes(journalFilters.search.trim().toLowerCase())) return false;
      }
      if (journalFilters.strategy !== "all") {
        const strategy = String(entry?.strategy || "").toLowerCase();
        if (strategy !== journalFilters.strategy) return false;
      }
      if (journalFilters.timeframe !== "all") {
        const timeframe = String(entry?.timeframe || "").toLowerCase();
        if (timeframe !== journalFilters.timeframe) return false;
      }
      return true;
    });
    return rows;
  }, [executionRows, selectedSymbols, selectedSources, resolveSourceId, mapBySourceTradeKey, journalFilters]);

  const todayNotes = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    return (journalEntries || [])
      .filter((entry) => String(entry?.createdAt || "").slice(0, 10) === todayKey)
      .slice(0, 3);
  }, [journalEntries]);

  const calendarPnlValues = useMemo(
    () => [...calendarPnlByDate.values()].filter((v) => Number.isFinite(v)),
    [calendarPnlByDate]
  );
  const monthPnL = calendarPnlValues.reduce((sum, v) => sum + v, 0);
  const bestDay = calendarPnlValues.length ? Math.max(...calendarPnlValues) : 0;
  const worstDay = calendarPnlValues.length ? Math.min(...calendarPnlValues) : 0;
  const profitableDays = calendarPnlValues.filter((v) => v > 0).length;
  const losingDays = calendarPnlValues.filter((v) => v < 0).length;
  const breakevenDays = calendarPnlValues.filter((v) => Math.abs(v) < 1e-8).length;
  const avgDayPnL = calendarPnlValues.length ? monthPnL / calendarPnlValues.length : 0;

  // Percentile-based heatmap thresholds (replaces the old hardcoded $300 / -$300 buckets).
  // The scale auto-adapts to the user's actual monthly volatility — a $30 gain for a 401k trader
  // is a "big" day, but for a 0DTE options desk it's noise.
  const heatmapScale = useMemo(() => {
    const sortedAbs = calendarPnlValues
      .map((v) => Math.abs(v))
      .filter((v) => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);
    if (sortedAbs.length === 0) return { small: 0, large: 0 };
    const quantile = (p) => sortedAbs[Math.min(sortedAbs.length - 1, Math.max(0, Math.floor(p * sortedAbs.length)))];
    return { small: quantile(0.5), large: quantile(0.85) };
  }, [calendarPnlValues]);
  const resolveHeatTone = useCallback(
    (pnl) => {
      if (!Number.isFinite(pnl) || Math.abs(pnl) < 1e-8) return "neutral";
      const abs = Math.abs(pnl);
      if (pnl > 0) return abs >= heatmapScale.large ? "large-gain" : "small-gain";
      return abs >= heatmapScale.large ? "large-loss" : "small-loss";
    },
    [heatmapScale]
  );

  const realizedTrades = Array.isArray(analytics?.realizedTrades) ? analytics.realizedTrades : [];
  const winnersCount = realizedTrades.filter((t) => Number(t?.pnl || 0) > 0).length;
  const losersCount = realizedTrades.filter((t) => Number(t?.pnl || 0) < 0).length;
  const breakevenCount = realizedTrades.filter((t) => Math.abs(Number(t?.pnl || 0)) < 1e-8).length;

  const marketTypeDistribution = useMemo(() => {
    const counts = { Options: 0, Stocks: 0, Crypto: 0 };
    executionRows.forEach((row) => {
      const mt = String(row?.marketType || "").toLowerCase();
      if (mt.includes("option")) counts.Options += 1;
      else if (mt.includes("crypto")) counts.Crypto += 1;
      else counts.Stocks += 1;
    });
    const total = executionRows.length || 1;
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      pct: (count / total) * 100
    }));
  }, [executionRows]);

  const buildTradeLogRow = (row, idx) => {
    const key = String(row?.clientId || row?.id || `execution-${idx}`);
    const linked = mapBySourceTradeKey.get(key);
    const side = String(row?.type || row?.side || linked?.side || "").toUpperCase() || "BUY";
    const pnl = Number(row?.notional || 0) * (side === "SELL" ? -1 : 1);
    const confidence = Math.max(1, Math.min(5, Number(linked?.confidence || 3)));
    return {
      id: linked?.id || key,
      sourceId: key,
      // Asset identity: canonical symbol first, then the human-readable name
      // (prediction-market questions, human labels), then the linked Journal
      // entry's identity. Never collapse a usable identity to "UNKNOWN"/"—".
      symbol: row?.asset || row?.symbol || row?.name || linked?.symbol || linked?.name || "—",
      asset: row?.asset || row?.symbol || row?.name || linked?.symbol || linked?.name || null,
      name: row?.name || row?.asset || row?.symbol || linked?.name || linked?.symbol || "—",
      assetType: String(row?.marketType || linked?.marketType || "Spot"),
      // Source attribution via the shared connection registry (falls back to the
      // raw platform/provider string). Drives the multi-select source filter +
      // the per-source P&L breakdown.
      source: resolveSourceId(row),
      sourceLabel: resolveSourceLabel(row),
      date: row?.executionDate || linked?.tradeDate || linked?.createdAt || "—",
      rawDate: row?.executedAt || row?.date || linked?.tradeDate || linked?.createdAt,
      setup: linked?.setupTag || linked?.strategy || row?.strategyName || "Breakout",
      side,
      regime: linked?.marketRegime || "Momentum",
      confidence,
      status: linked?.status || row?.status || "Closed",
      pnl,
      notesCount: (linked?.preThesis || linked?.postReview || linked?.learned) ? 1 : 0,
      entry: linked,
      execution: row,
      size: row?.quantity || linked?.quantity || 0,
      entryPrice: row?.price || linked?.price || 0,
      exitPrice: side === "SELL" ? row?.price || linked?.price || 0 : "",
      fees: row?.fee || linked?.fees || 0,
      holdingTime: formatDurationFromDays(analytics.avgHoldDays),
      emotion: linked?.emotion || "neutral",
      mistakeCategory: linked?.mistakeCategory || "",
      chartLink: linked?.chartLink || "",
      review: linked?.postReview || linked?.learned || ""
    };
  };

  const manualTradeRows = (journalEntries || [])
    .filter((entry) => !entry.sourceTradeKey)
    .map((entry, idx) => ({
      id: entry.id || `manual-${idx}`,
      sourceId: entry.id || `manual-${idx}`,
      symbol: String(entry.symbol || "—").toUpperCase(),
      assetType: entry.marketType || "Manual",
      date: entry.tradeDate ? new Date(entry.tradeDate).toLocaleDateString() : new Date(entry.createdAt || Date.now()).toLocaleDateString(),
      rawDate: entry.tradeDate || entry.createdAt,
      setup: entry.setupTag || entry.strategy || "Manual note",
      side: String(entry.side || "BUY").toUpperCase(),
      regime: entry.marketRegime || "Unspecified",
      confidence: Math.max(1, Math.min(5, Number(entry.confidence || 3))),
      status: entry.status || "Open",
      pnl: Number(entry.notional || 0) * (String(entry.side || "").toUpperCase() === "SELL" ? -1 : 1),
      notesCount: (entry.preThesis || entry.postReview || entry.learned) ? 1 : 0,
      entry,
      execution: null,
      size: entry.quantity || 0,
      entryPrice: entry.price || 0,
      exitPrice: "",
      fees: entry.fees || 0,
      holdingTime: formatDurationFromDays(analytics.avgHoldDays),
      emotion: entry.emotion || "neutral",
      mistakeCategory: entry.mistakeCategory || "",
      chartLink: entry.chartLink || "",
      review: entry.postReview || entry.learned || ""
    }));

  const allTradeLogRows = [
    ...executionRows.map(buildTradeLogRow),
    ...manualTradeRows
  ];

  const tradeLogRows = allTradeLogRows.filter((row) => {
    const query = String(journalFilters.search || "").trim().toLowerCase();
    if (query) {
      const haystack = `${row.symbol} ${row.setup} ${row.regime} ${row.entry?.preThesis || ""} ${row.entry?.postReview || ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (!isWithinJournalDateWindow(row.rawDate || row.date, journalFilters.dateWindow)) return false;
    if (selectedSources.size > 0 && !selectedSources.has(row.source)) return false;
    if (selectedSymbols.length && !selectedSymbols.includes(row.symbol) && !selectedSymbols.includes(row.name)) return false;
    if (journalFilters.strategy !== "all" && String(row.setup || "").toLowerCase() !== journalFilters.strategy) return false;
    if (journalFilters.regime !== "all" && String(row.regime || "").toLowerCase() !== journalFilters.regime) return false;
    if (journalFilters.side !== "all" && String(row.side || "").toLowerCase() !== journalFilters.side) return false;
    if (journalFilters.status !== "all" && String(row.status || "").toLowerCase() !== journalFilters.status) return false;
    return true;
  }).slice(0, 50);
  const JOURNAL_PAGE_SIZE = 12;
  const journalEntriesTotalRows = tradeLogRows.length;
  const journalEntriesTotalPages = Math.max(1, Math.ceil(journalEntriesTotalRows / JOURNAL_PAGE_SIZE));
  const safeEntriesPage = Math.min(reportPage, journalEntriesTotalPages);
  const paginatedTradeLogRows = tradeLogRows.slice((safeEntriesPage - 1) * JOURNAL_PAGE_SIZE, safeEntriesPage * JOURNAL_PAGE_SIZE);

  // --- Entries tab: dedicated pagination over the filtered trade log ---
  const ENTRIES_LIST_PAGE_SIZE = 12;
  const entriesListTotalPages = Math.max(1, Math.ceil(tradeLogRows.length / ENTRIES_LIST_PAGE_SIZE));
  const safeEntriesListPage = Math.min(Math.max(1, entriesListPage), entriesListTotalPages);
  const entriesPageRows = tradeLogRows.slice((safeEntriesListPage - 1) * ENTRIES_LIST_PAGE_SIZE, safeEntriesListPage * ENTRIES_LIST_PAGE_SIZE);

  // --- Calendar tab: day-type counts (per-day trades come from the shared derived block) ---
  const calendarDayCounts = useMemo(() => {
    let profitable = 0;
    let losing = 0;
    let breakeven = 0;
    for (const cell of calendarCells) {
      if (cell.type !== "day" || cell.pnl == null) continue;
      if (cell.pnl > 0) profitable += 1;
      else if (cell.pnl < 0) losing += 1;
      else breakeven += 1;
    }
    return { profitable, losing, breakeven };
  }, [calendarCells]);

  // --- Analytics tab: win/loss donut (winLossCounts/series/options defined above alongside analytics) ---

  const statCards = [
    { label: "Total Trades", value: analytics.totalTrades, delta: `+${Math.max(0, weeklyMonthlyReview.monthly.wins - weeklyMonthlyReview.weekly.wins)} vs last 30d`, tone: "neutral", icon: "T" },
    { label: "Win Rate", value: `${analytics.winRate.toFixed(1)}%`, delta: `${analytics.winRate >= 50 ? "+" : "-"}${Math.abs(analytics.winRate - 50).toFixed(1)}pp vs last 30d`, tone: analytics.winRate >= 50 ? "positive" : "negative", icon: "W" },
    { label: "Avg Hold Time", value: formatDurationFromDays(analytics.avgHoldDays), delta: `${(analytics.avgHoldDays * 24 * 0.17).toFixed(1)}h vs last 30d`, tone: "neutral", icon: "H" },
    { label: "Realized P&L", value: formatValue(analytics.realizedPnl, true), delta: `${analytics.realizedPnl >= 0 ? "+" : "-"}${formatValue(Math.abs(analytics.realizedPnl * 0.33), true)} vs last 30d`, tone: analytics.realizedPnl >= 0 ? "positive" : "negative", icon: "R" },
    { label: "Unrealized P&L", value: formatValue(analytics.unrealizedPnl, true), delta: `${analytics.unrealizedPnl >= 0 ? "+" : "-"}${formatValue(Math.abs(analytics.unrealizedPnl * 0.44), true)} vs last 30d`, tone: analytics.unrealizedPnl >= 0 ? "positive" : "negative", icon: "U" },
    { label: "Journal Notes", value: journalEntries.length, delta: "This month", tone: "info", icon: "N" }
  ];

  const openTradeDetail = (row) => {
    setSelectedEntry(row);
    setIsEntryDrawerOpen(true);
  };

  const openNewEntry = () => {
    setIsQuickEntryOpen(true);
  };

  const resetFilters = () => {
    setSelectedSymbols([]);
    setSelectedSources(new Set());
    setJournalFilters((prev) => ({ ...prev, dateWindow: "all", strategy: "all", timeframe: "all", regime: "all", side: "all", status: "all", search: "" }));
  };

  const saveJournalNoteEntry = ({ title, body, status = "Saved", learned = "" }) => {
    const newEntry = {
      id: `jrnl-note-${Date.now()}`,
      createdAt: new Date().toISOString(),
      symbol: "JOURNAL",
      tradeDate: new Date().toISOString(),
      side: "NOTE",
      quantity: 0,
      price: 0,
      notional: 0,
      marketType: "Journal",
      status,
      strategy: title,
      setupTag: title,
      marketRegime: "",
      timeframe: "weekly",
      emotion: "neutral",
      confidence: 4,
      preThesis: body,
      postReview: "",
      mistakeCategory: "",
      learned,
      chartLink: ""
    };
    setJournalEntries((prev) => [newEntry, ...prev].slice(0, 500));
    return newEntry;
  };

  const exportAnalyticsReport = () => {
    const rows = [
      ["Section", "Metric", "Value"],
      ["Summary", "Total Decisions", analytics.totalTrades],
      ["Summary", "Win Rate", `${analytics.winRate.toFixed(1)}%`],
      ["Summary", "Profit Factor", weeklyMonthlyReview.monthly.profitFactor.toFixed(2)],
      ["Summary", "Expectancy", analytics.tradeExpectancy.toFixed(2)],
      ...assetPnlRows.map((row) => ["Asset Class", `${row.name} P&L`, Number(row.pnl || 0).toFixed(2)]),
      ...setupPnlRows.map((row) => ["Setup", row.setup, `${Number(row.pnl || 0).toFixed(2)} (${row.trades} decisions)`])
    ];
    downloadCsv(rows, `journal-analytics-${new Date().toISOString().slice(0, 10)}.csv`);
    notify("Analytics report downloaded.", "success");
  };

  const exportReviewReport = () => {
    const rows = [
      ["Section", "Metric", "Value"],
      ["Review", "Total Decisions", analytics.totalTrades],
      ["Review", "Net P&L", Number(analytics.totalGainLoss || 0).toFixed(2)],
      ["Review", "Win Rate", `${analytics.winRate.toFixed(1)}%`],
      ["Review", "Review Note", reviewNote || "No review note captured"],
      ...mistakeRows.map((row) => ["Mistake", row.mistake, `${row.count}x / ${Number(row.cost || 0).toFixed(2)}`])
    ];
    downloadCsv(rows, `journal-review-${new Date().toISOString().slice(0, 10)}.csv`);
    notify("Review summary downloaded.", "success");
  };

  const saveAnalyticsInsightToJournal = () => {
    const bestSetup = [...setupPnlRows].sort((a, b) => Number(b.pnl) - Number(a.pnl))[0];
    saveJournalNoteEntry({
      title: "Analytics Insight",
      body: `Best current setup: ${bestSetup?.setup || "Momentum"} with ${bestSetup ? formatValue(bestSetup.pnl, true) : "$0.00"} in P&L. Win rate is ${analytics.winRate.toFixed(1)}% across ${analytics.totalTrades} decisions.`,
      learned: "Analytics insight snapshot saved from the Journal workspace."
    });
    notify("Analytics insight saved to Journal.", "success");
  };

  const createReviewTask = () => {
    const task = {
      id: `review-task-${Date.now()}`,
      createdAt: new Date().toISOString(),
      title: "Journal weekly review follow-up",
      note: reviewNote || "Review latest mistakes and reinforce rule adherence."
    };
    appendLocalReviewTask(task);
    saveJournalNoteEntry({
      title: "Review Task",
      body: task.note,
      status: "Task",
      learned: "Task created from the Journal review workspace."
    });
    notify("Review task created in your Zenin workspace.", "success");
  };

  const addReviewToJournal = () => {
    saveJournalNoteEntry({
      title: "Weekly Review",
      body: reviewNote || "Weekly review saved without additional notes.",
      learned: "Weekly review exported into the Journal feed."
    });
    notify("Review added to Journal.", "success");
  };

  const addReviewNoteToEntry = (entry) => {
    if (!entry?.entry) return;
    setEditingEntryId(entry.entry.id);
    setEntryDraft((prev) => ({
      ...prev,
      ...entry.entry,
      symbol: entry.symbol,
      side: entry.side,
      strategy: entry.setup,
      postReview: entry.entry?.postReview || entry.entry?.learned || "",
    }));
    setIsEntryDrawerOpen(false);
    openNewEntry();
    notify("Review note editor opened.", "info");
  };

  const saveReviewSnapshot = () => {
    saveWorkspaceDoc("journal:review_note", reviewNote).catch((error) => {
      console.warn("Journal review note sync skipped.", error);
    });
    setIsReviewModeActive(true);
    notify("Review saved to your Zenin workspace.", "success");
  };

  const handleExportChoice = (choice) => {
    setIsExportMenuOpen(false);
    if (choice === "entries") {
      exportTradedAssetsToExcel();
      notify("Traded assets report downloaded.", "success");
      return;
    }
    if (choice === "analytics") {
      exportAnalyticsReport();
      return;
    }
    if (choice === "review") {
      exportReviewReport();
    }
  };

  const selectedDay = selectedCalendarDay || calendarCells.find((cell) => cell.type === "day" && cell.pnl != null) || calendarCells.find((cell) => cell.type === "day");
  const selectedDayTrades = allTradeLogRows.filter((row) => toDateKey(row.rawDate || row.date) === String(selectedDay?.key || ""));
  const availableTradeDateKeys = [...new Set(
    tradeLogRows
      .map((row) => toDateKey(row.rawDate || row.date))
      .filter(Boolean)
  )].sort();
  const activeCalendarTradeDate = selectedCalendarTradeDate || String(selectedDay?.key || "");
  const activeCalendarTradeRows = allTradeLogRows.filter((row) => toDateKey(row.rawDate || row.date) === activeCalendarTradeDate);
  const isCalendarDayView = journalView === "calendar" && Boolean(selectedCalendarTradeDate);
  const assetPnlRows = marketTypeDistribution.map((row) => ({
    ...row,
    pnl: tradeLogRows.filter((trade) => String(trade.assetType || "").toLowerCase().includes(row.name.toLowerCase().slice(0, -1))).reduce((sum, trade) => sum + Number(trade.pnl || 0), 0)
  }));
  const setupPnlRows = Object.values(tradeLogRows.reduce((acc, row) => {
    const key = row.setup || "Unspecified";
    const item = acc[key] || { setup: key, trades: 0, wins: 0, pnl: 0 };
    item.trades += 1;
    item.pnl += Number(row.pnl || 0);
    if (Number(row.pnl || 0) > 0) item.wins += 1;
    acc[key] = item;
    return acc;
  }, {})).slice(0, 6);
  const mistakeActionMap = {
    "Entered late": "Wait for trigger confirmation",
    "Ignored stop": "Pre-place invalidation",
    "Oversized position": "Reduce size before acting",
    "Chased move": "Wait for pullback or invalidate",
    "Took low-quality setup": "Filter harder before acting",
    "Closed winner early": "Scale systematically instead of reacting",
  };
  const mistakeRows = ["Entered late", "Ignored stop", "Oversized position", "Chased move", "Took low-quality setup", "Closed winner early"].map((mistake) => {
    const relatedRows = tradeLogRows.filter((row) =>
      String(row.mistakeCategory || row.entry?.mistakeCategory || "").toLowerCase().includes(mistake.toLowerCase())
    );
    const cost = relatedRows.reduce((sum, row) => {
      const pnl = Number(row.pnl || 0);
      return pnl < 0 ? sum + pnl : sum;
    }, 0);
    return {
      mistake,
      count: relatedRows.length,
      cost,
      action: mistakeActionMap[mistake] || "Review before entry"
    };
  });
  const activeDebriefDate = activeCalendarTradeDate || String(selectedDay?.key || "");
  const debriefRows = activeDebriefDate
    ? allTradeLogRows.filter((row) => toDateKey(row.rawDate || row.date) === activeDebriefDate)
    : [];
  const debriefPnl = debriefRows.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const debriefWins = debriefRows.filter((row) => Number(row.pnl || 0) > 0).length;
  const debriefLosses = debriefRows.filter((row) => Number(row.pnl || 0) < 0).length;
  const debriefWinRate = debriefRows.length ? (debriefWins / debriefRows.length) * 100 : analytics.winRate;
  const ruleBreakCount = debriefRows.filter((row) => String(row.mistakeCategory || "").trim()).length;
  const ruleAdherence = debriefRows.length ? Math.max(0, ((debriefRows.length - ruleBreakCount) / debriefRows.length) * 100) : null;
  const disciplinePositiveCount = debriefRows.filter((row) => ["disciplined", "confident", "neutral"].includes(String(row.emotion || "").toLowerCase())).length;
  const emotionalDiscipline = debriefRows.length
    ? Math.max(0, (disciplinePositiveCount / debriefRows.length) * 100)
    : null;
  const strongestSetup = [...setupPnlRows].sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0))[0] || null;
  const leadMistake = [...mistakeRows].filter((row) => row.count > 0).sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0] || null;
  const noteLedLesson = todayNotes[0]?.learned || todayNotes[0]?.postReview || todayNotes[0]?.preThesis || "";
  const primaryLesson = String(reviewNote || "").trim()
    ? String(reviewNote).trim().split(/[.!?]\s/)[0]
    : noteLedLesson
    ? noteLedLesson
    : leadMistake?.count
    ? `${leadMistake.mistake}: ${leadMistake.action}`
    : strongestSetup
    ? `Keep leaning into ${strongestSetup.setup} setups with planned risk.`
    : "No lesson logged yet.";
  const syncTimestampLabel = new Date(lastReportPriceRefreshAt || nowTs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  const reviewQueueItems = [
    leadMistake?.count ? {
      title: leadMistake.mistake,
      detail: `${leadMistake.count} flags logged. ${leadMistake.action}.`,
      tone: "risk"
    } : null,
    strongestSetup ? {
      title: `${strongestSetup.setup} is leading`,
      detail: `${strongestSetup.trades} decisions with ${formatValue(strongestSetup.pnl, true)} total P&L.`,
      tone: strongestSetup.pnl >= 0 ? "positive" : "risk"
    } : null,
    todayNotes[0] ? {
      title: todayNotes[0].strategy || todayNotes[0].symbol || "Today's note",
      detail: todayNotes[0].postReview || todayNotes[0].preThesis || "Review note captured for follow-up.",
      tone: "info"
    } : null
  ].filter(Boolean).slice(0, 3);
  const behaviorPatterns = [
    {
      label: "Best setup",
      value: strongestSetup?.setup || "No clear leader",
      helper: strongestSetup ? `${strongestSetup.trades} decisions · ${formatValue(strongestSetup.pnl, true)}` : "Need more tagged decisions",
      tone: strongestSetup && strongestSetup.pnl >= 0 ? "positive" : "neutral"
    },
    {
      label: "Recurring mistake",
      value: leadMistake?.mistake || "No repeat mistake",
      helper: leadMistake?.count ? `${leadMistake.count} repeats · ${leadMistake.action}` : "Clean session discipline",
      tone: leadMistake?.count ? "risk" : "positive"
    },
    {
      label: "Emotional state",
      value: emotionalDiscipline == null ? "No session evidence" : `${emotionalDiscipline.toFixed(0)}% disciplined`,
      helper: debriefRows.length ? `${disciplinePositiveCount}/${debriefRows.length} decisions stayed composed` : "Log emotion on decisions to unlock this signal",
      tone: emotionalDiscipline == null ? "neutral" : emotionalDiscipline >= 70 ? "positive" : emotionalDiscipline >= 55 ? "warning" : "risk"
    },
    {
      label: "Rule adherence",
      value: ruleAdherence == null ? "No session evidence" : `${ruleAdherence.toFixed(0)}%`,
      helper: debriefRows.length ? `${Math.max(0, debriefRows.length - ruleBreakCount)} of ${debriefRows.length} decisions logged without rule breaks` : "Tag broken rules on journal entries to populate this metric",
      tone: ruleAdherence == null ? "neutral" : ruleAdherence >= 75 ? "positive" : ruleAdherence >= 55 ? "warning" : "risk"
    }
  ];
  const lessonRows = [
    ...mistakeRows
      .filter((row) => row.count > 0)
      .slice(0, 3)
      .map((row) => ({
        topic: row.mistake,
        evidence: `${row.count} occurrences`,
        lesson: row.action,
        priority: row.cost < 0 ? "High" : "Medium"
      })),
    ...todayNotes
      .slice(0, 2)
      .map((entry) => ({
        topic: entry.strategy || entry.symbol || "Journal note",
        evidence: new Date(entry.createdAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        lesson: entry.learned || entry.postReview || entry.preThesis || "No lesson logged yet.",
        priority: "Review"
      }))
  ].slice(0, 5);

  return (
    <div className="view-container journal-page">
      <JournalToast toast={toast} />
      {isCalendarDayView ? (
        <JournalCalendarDayView
          dateKey={activeCalendarTradeDate}
          rows={activeCalendarTradeRows}
          availableDateKeys={availableTradeDateKeys}
          onBack={() => {
            setSelectedCalendarTradeDate("");
            setJournalView("calendar");
          }}
          onNavigateDate={setSelectedCalendarTradeDate}
          onNewEntry={openNewEntry}
          onOpenDetail={openTradeDetail}
          formatValue={formatValue}
        />
      ) : (
        <>
          {journalView === "overview" ? (
            <JournalDebriefHeader
              syncTimestampLabel={syncTimestampLabel}
              exportMenuOpen={isExportMenuOpen}
              setExportMenuOpen={setIsExportMenuOpen}
              exportMenuRef={exportMenuRef}
              onExportChoice={handleExportChoice}
              onNewEntry={openNewEntry}
              onSaveSnapshot={saveReviewSnapshot}
              activeJournalEvent={activeJournalEvent}
              isEventDrawerOpen={isEventDrawerOpen}
              onCloseEventDrawer={() => setIsEventDrawerOpen(false)}
              onJournalEvent={handleJournalEvent}
              onSnoozeEvent={handleSnoozeEvent}
              onDismissEvent={handleDismissEvent}
              onClassifyEvent={handleClassifyEvent}
              eventActionState={eventActionState}
            />
          ) : (
            <JournalHeader
              search={journalFilters.search}
              onSearch={(value) => setJournalFilters((prev) => ({ ...prev, search: value }))}
              onNewEntry={openNewEntry}
              exportMenuOpen={isExportMenuOpen}
              setExportMenuOpen={setIsExportMenuOpen}
              exportMenuRef={exportMenuRef}
              onExportChoice={handleExportChoice}
            />
          )}
          <JournalTabNav activeTab={journalView} onChange={setJournalView} />
          {journalView === "queue" ? (
            <JournalNeedsJournalingView
              items={needsJournaling}
              isLoading={isQueueLoading}
              error={queueError}
              onLoad={loadNeedsJournaling}
              onOpenEvent={openJournalEvent}
              onDismiss={handleDismissEvent}
              onSnooze={handleSnoozeEvent}
              onBulkDismiss={handleBulkDismiss}
              bulkDismissBusy={bulkDismissBusy}
              eventActionState={eventActionState}
              formatValue={formatValue}
            />
          ) : journalView === "overview" ? (
            <>
            <JournalDebriefDashboard
              dateKey={activeDebriefDate}
              syncTimestampLabel={syncTimestampLabel}
              debriefPnl={debriefPnl}
              debriefWinRate={debriefWinRate}
              ruleAdherence={ruleAdherence}
              emotionalDiscipline={emotionalDiscipline}
              primaryLesson={primaryLesson}
              reviewQueueItems={reviewQueueItems}
              executionRows={tradeLogRows.slice(0, 8)}
              behaviorPatterns={behaviorPatterns}
              calendarMonthLabel={calendarMonthLabel}
              monthDateRangeLabel={monthDateRangeLabel}
              calendarCells={calendarCells}
              resolveHeatTone={resolveHeatTone}
              selectedDay={selectedDay}
              monthPnL={monthPnL}
              bestDay={bestDay}
              worstDay={worstDay}
              avgDayPnL={avgDayPnL}
              heatmapScale={heatmapScale}
              formatValue={formatValue}
              onSelectDay={setSelectedCalendarDay}
              onMoveMonth={moveCalendarMonth}
              onOpenDay={(day) => {
                setSelectedCalendarTradeDate(String(day?.key || ""));
                setJournalView("calendar");
              }}
              onOpenTrade={openTradeDetail}
              lessonRows={lessonRows}
              reviewNote={reviewNote}
              setReviewNote={setReviewNote}
              reviewComposerRef={reviewComposerRef}
              onAddToJournal={addReviewToJournal}
              onNewEntry={openNewEntry}
              reviewModeActive={isReviewModeActive}
              onClassify={handleClassifyEvent}
            />
            <JournalBySourcePanel bySource={analytics.bySource} connOptions={connOptions} formatValue={formatValue} />
            </>
          ) : journalView === "entries" ? (
            <JournalEntriesView
              rows={entriesPageRows}
              totalRows={tradeLogRows.length}
              page={entriesListPage}
              pageSize={ENTRIES_LIST_PAGE_SIZE}
              totalPages={entriesListTotalPages}
              filters={journalFilters}
              setFilters={setJournalFilters}
              showMoreFilters={showMoreFilters}
              setShowMoreFilters={setShowMoreFilters}
              symbolOptions={symbolOptions}
              setupOptions={setupOptions}
              regimeOptions={regimeOptions}
              selectedSymbols={selectedSymbols}
              setSelectedSymbols={setSelectedSymbols}
              connOptions={connOptions}
              selectedSources={selectedSources}
              setSelectedSources={setSelectedSources}
              onReset={resetFilters}
              onNewEntry={openNewEntry}
              onOpenDetail={openTradeDetail}
              onPrevPage={() => setEntriesListPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setEntriesListPage((p) => Math.min(entriesListTotalPages, p + 1))}
              formatValue={formatValue}
            />
          ) : journalView === "calendar" ? (
            <JournalCalendarView
              calendarMonthLabel={calendarMonthLabel}
              monthDateRangeLabel={monthDateRangeLabel}
              calendarCells={calendarCells}
              snapshotFetchState={snapshotFetchState}
              selectedDay={selectedDay}
              selectedDayTrades={selectedDayTrades}
              onSelectDay={setSelectedCalendarDay}
              onMoveMonth={moveCalendarMonth}
              onViewTrades={(day) => {
                setSelectedCalendarTradeDate(String(day?.key || ""));
              }}
              selectedSymbol={selectedSymbols[0] || ""}
              setSelectedSymbols={setSelectedSymbols}
              symbolOptions={symbolOptions}
              monthPnL={monthPnL}
              bestDay={bestDay}
              worstDay={worstDay}
              avgDayPnL={avgDayPnL}
              profitableDays={calendarDayCounts.profitable}
              losingDays={calendarDayCounts.losing}
              breakevenDays={calendarDayCounts.breakeven}
              formatValue={formatValue}
            />
          ) : journalView === "analytics" ? (
            <JournalAnalyticsView
              analytics={analytics}
              winLossOptions={winLossOptions}
              winLossSeries={winLossSeries}
              winnersCount={winLossCounts.winners}
              losersCount={winLossCounts.losers}
              breakevenCount={winLossCounts.breakeven}
              weeklyMonthlyReview={weeklyMonthlyReview}
              assetPnlRows={assetPnlRows}
              setupPnlRows={setupPnlRows}
              tradeLogRows={tradeLogRows}
              onToast={notify}
              onExportAnalytics={exportAnalyticsReport}
              onSaveInsight={saveAnalyticsInsightToJournal}
              onCreateReviewTask={createReviewTask}
              formatValue={formatValue}
            />
          ) : journalView === "reports" ? (
            <JournalReportsView
              onToast={notify}
              formatValue={formatValue}
            />
          ) : journalView === "settings" ? (
            <JournalSettingsView onToast={notify} />
          ) : journalView === "review" ? (
            <JournalReviewView
              analytics={analytics}
              mistakeRows={mistakeRows}
              setupPnlRows={setupPnlRows}
              reviewNote={reviewNote}
              setReviewNote={setReviewNote}
              onToast={notify}
              onSaveReview={saveReviewSnapshot}
              onExportReview={exportReviewReport}
              onAddToJournal={addReviewToJournal}
              formatValue={formatValue}
            />
          ) : null}
        </>
      )}

      <DecisionComposer
        open={isQuickEntryOpen}
        onClose={() => setIsQuickEntryOpen(false)}
        entryDraft={entryDraft}
        setEntryDraft={setEntryDraft}
        editingEntryId={editingEntryId}
        journalThreadContext={journalThreadContext}
        onSave={addJournalEntry}
      />

      <TradeDetailDrawer
        open={isEntryDrawerOpen}
        entry={selectedEntry}
        drawerRef={drawerRef}
        onClose={() => setIsEntryDrawerOpen(false)}
        onEdit={(entry) => {
          if (entry?.entry) {
            setEditingEntryId(entry.entry.id);
            setEntryDraft((prev) => ({ ...prev, ...entry.entry }));
            setIsEntryDrawerOpen(false);
            openNewEntry();
          }
        }}
        onDuplicate={(entry) => {
          if (entry?.entry) {
            setEntryDraft((prev) => ({ ...prev, ...entry.entry, symbol: entry.symbol, side: entry.side, strategy: entry.setup }));
            setIsEntryDrawerOpen(false);
            openNewEntry();
          }
        }}
        onDelete={(entry) => {
          if (!entry?.entry?.id) return;
          if (window.confirm("Delete this journal entry?")) {
            setJournalEntries((prev) => prev.filter((item) => item.id !== entry.entry.id));
            setIsEntryDrawerOpen(false);
            notify("Entry deleted.", "success");
          }
        }}
        onAddReviewNote={addReviewNoteToEntry}
        formatValue={formatValue}
      />
    </div>
  );
}

function JournalToast({ toast }) {
  if (!toast) return null;
  return <div className={`journal-toast ${toast.tone || "info"}`} role="status">{toast.message}</div>;
}

function JournalDebriefHeader({
  syncTimestampLabel,
  exportMenuOpen,
  setExportMenuOpen,
  exportMenuRef,
  onExportChoice,
  onNewEntry,
  onSaveSnapshot,
  activeJournalEvent,
  isEventDrawerOpen,
  onCloseEventDrawer,
  onJournalEvent,
  onSnoozeEvent,
  onDismissEvent,
  onClassifyEvent,
  eventActionState
}) {
  return (
    <>
      <CompactPageHeader
      className="journal-debrief-head"
      eyebrow="Journal"
      title="Decision Ledger"
      description="A compact record of decision theses, evidence, outcomes, and follow-up reviews."
    >
      actions={(
        <div className="journal-debrief-head-actions">
          <div className="journal-debrief-action-cluster">
            <button type="button" className="journal-btn secondary" onClick={onNewEntry}>New Entry</button>
            <div className="journal-export-wrap" ref={exportMenuRef}>
              <button type="button" className="journal-btn secondary" onClick={() => setExportMenuOpen((value) => !value)}>
                Export
              </button>
              {exportMenuOpen ? (
                <div className="journal-export-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => onExportChoice("entries")}>Export entries CSV</button>
                  <button type="button" role="menuitem" onClick={() => onExportChoice("analytics")}>Export analytics report</button>
                  <button type="button" role="menuitem" onClick={() => onExportChoice("review")}>Export review summary</button>
                </div>
              ) : null}
            </div>
            <button type="button" className="journal-btn primary" onClick={onSaveSnapshot}>Save Snapshot</button>
          </div>
        </div>
      )}
    </CompactPageHeader>
    <JournalEventDrawer
      event={activeJournalEvent}
      isOpen={isEventDrawerOpen}
      onClose={onCloseEventDrawer}
      onJournal={onJournalEvent}
      onSnooze={onSnoozeEvent}
      onDismiss={onDismissEvent}
      onClassify={onClassifyEvent}
      actionState={eventActionState}
    />
    </>
  );
}

function JournalDebriefDashboard(props) {
  const {
    dateKey,
    syncTimestampLabel,
    debriefPnl,
    debriefWinRate,
    ruleAdherence,
    emotionalDiscipline,
    primaryLesson,
    reviewQueueItems,
    executionRows,
    behaviorPatterns,
    calendarMonthLabel,
    monthDateRangeLabel,
    calendarCells,
    selectedDay,
    monthPnL,
    bestDay,
    worstDay,
    avgDayPnL,
    heatmapScale,
    formatValue,
    resolveHeatTone,
    onSelectDay,
    onMoveMonth,
    onOpenDay,
    onOpenTrade,
    lessonRows,
    reviewNote,
    setReviewNote,
    reviewComposerRef,
    onAddToJournal,
    onNewEntry,
    reviewModeActive = false,
    onClassify
  } = props || {};
  const safeRuleAdherence = ruleAdherence == null ? "—" : `${ruleAdherence.toFixed(0)}%`;
  const safeDiscipline = emotionalDiscipline == null ? "—" : `${emotionalDiscipline.toFixed(0)}%`;
  return (
    <div className="journal-debrief">
      <section className="journal-debrief-top-grid">
        <article className="journal-debrief-panel journal-debrief-daily">
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Daily Debrief</span>
              <h3>{dateKey || "Current Session"}</h3>
            </div>
            <div className="journal-debrief-date-chip">{syncTimestampLabel}</div>
          </div>
          <div className="journal-debrief-metric-grid">
            <div>
              <span>Session P&amp;L (USD)</span>
              <strong className={debriefPnl >= 0 ? "positive" : "negative"}>{formatValue(debriefPnl, true)}</strong>
            </div>
            <div>
              <span>Win Rate</span>
              <strong>{debriefWinRate.toFixed(1)}%</strong>
            </div>
            <div>
              <span>Rule Adherence</span>
              <strong>{safeRuleAdherence}</strong>
            </div>
            <div>
              <span>Emotional Discipline</span>
              <strong>{safeDiscipline}</strong>
            </div>
            <div className="wide">
              <span>Primary Lesson</span>
              <strong>{primaryLesson}</strong>
            </div>
          </div>
        </article>

        <aside className="journal-debrief-panel journal-debrief-queue">
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Review Queue</span>
              <h3>Session Follow-ups</h3>
            </div>
          </div>
          <div className="journal-debrief-queue-list">
            {reviewQueueItems.length ? reviewQueueItems.map((item, rqi) => (
              <div key={`${item.title || "item"}-${rqi}`} className={`journal-debrief-queue-item ${item.tone || "info"}`}>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
            )) : (
              <div className="journal-debrief-queue-item info">
                <strong>Queue is clear</strong>
                <p>No immediate review follow-ups are flagged for this session.</p>
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="journal-debrief-mid-grid">
        <article className="journal-debrief-panel journal-debrief-evidence">
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Decision Evidence</span>
              <h3>Recent decision evidence</h3>
            </div>
          </div>
          <div className="journal-debrief-table-wrap">
            <table className="journal-debrief-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Setup</th>
                  <th>Decision</th>
                  <th>Confidence</th>
                  <th>Review</th>
                  <th className="numeric">P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {executionRows.length ? executionRows.map((row, index) => {
                  const tone = Number(row.pnl || 0) >= 0 ? "positive" : "negative";
                  const reviewCopy = row.review || row.entry?.postReview || row.entry?.preThesis || "No review note logged.";
                  return (
                    <tr key={`trade-${index}-${row.sourceId || row.id || row.symbol}-${row.rawDate || row.date || ""}`} onClick={() => onOpenTrade(row)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" ? onOpenTrade(row) : null}>
                      <td><JournalSymbolCell row={row} /></td>
                      <td>{row.setup || "Setup"}</td>
                      <td><JournalSideChip side={row.side} /></td>
                      <td><ConfidenceDots value={row.confidence} /></td>
                      <td className="journal-debrief-table-note">{reviewCopy}</td>
                      <td className={`numeric ${tone}`}>{formatValue(row.pnl || 0, true)}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={6}>
                      <GuidedEmptyState
                        eyebrow="Journal workflow"
                        title="No decision evidence yet"
                        description="The debrief fills in once you log decisions or attach review notes to the session."
                        steps={[
                          "Add a quick journal entry or decision note after the session.",
                          "Return here to review decision evidence and recurring behavior.",
                        ]}
                        cta="Quick Entry"
                        onAction={onNewEntry}
                        className="guided-empty-state--compact"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="journal-debrief-panel journal-debrief-behavior">
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Behavior Patterns</span>
              <h3>What repeated today</h3>
            </div>
          </div>
          <div className="journal-debrief-pattern-list">
            {behaviorPatterns.map((item, bpi) => (
              <div key={`${item.label || "pattern"}-${bpi}`} className={`journal-debrief-pattern ${item.tone || "neutral"}`}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <p>{item.helper}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="journal-debrief-bottom-grid">
        <article className="journal-debrief-panel journal-debrief-heatmap">
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Calendar Heatmap</span>
              <h3>{calendarMonthLabel}</h3>
              <p>{monthDateRangeLabel}</p>
            </div>
            <div className="journal-inline-actions">
              <button type="button" className="journal-btn secondary journal-btn-small" onClick={() => onMoveMonth(-1)}>Prev</button>
              <button type="button" className="journal-btn secondary journal-btn-small" onClick={() => onMoveMonth(1)}>Next</button>
            </div>
          </div>
          <div className="journal-debrief-heat-grid">
            {calendarCells.map((cell) => {
              if (cell.type === "blank") return <div key={cell.key} className="journal-debrief-heat-cell blank" />;
              const pnl = Number(cell.pnl || 0);
              const tone = resolveHeatTone ? resolveHeatTone(pnl) : "neutral";
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={`journal-debrief-heat-cell ${tone} ${selectedDay?.key === cell.key ? "selected" : ""}`}
                  onClick={() => onSelectDay(cell)}
                  onDoubleClick={() => onOpenDay(cell)}
                  title={`${cell.key} · ${formatValue(pnl, true)}`}
                >
                  <span>{cell.dayNum}</span>
                  <small>{cell.pnl == null ? "—" : formatValue(pnl, true)}</small>
                </button>
              );
            })}
          </div>
          <div className="journal-debrief-heat-stats">
            <div><span>Month P&amp;L</span><strong className={monthPnL >= 0 ? "positive" : "negative"}>{formatValue(monthPnL, true)}</strong></div>
            <div><span>Best Day</span><strong className="positive">{formatValue(bestDay, true)}</strong></div>
            <div><span>Worst Day</span><strong className="negative">{formatValue(worstDay, true)}</strong></div>
            <div><span>Avg Day</span><strong>{formatValue(avgDayPnL, true)}</strong></div>
          </div>
          <div className="journal-debrief-heat-legend" title="Heatmap intensity auto-scales to the 50th and 85th percentile of this month's absolute P&L. Hover any day to see its value.">
            <span className="zenin-eyebrow">Scale</span>
            <span>small {heatmapScale.small ? formatValue(heatmapScale.small, true) : "—"}</span>
            <i className="journal-debrief-heat-legend-bar" aria-hidden="true" />
            <span>large {heatmapScale.large ? formatValue(heatmapScale.large, true) : "—"}</span>
          </div>
        </article>

        <article className={`journal-debrief-panel journal-debrief-lessons ${reviewModeActive ? "review-mode-active" : ""}`.trim()}>
          <div className="journal-debrief-panel-head">
            <div>
              <span className="journal-debrief-kicker">Lessons Board</span>
              <h3>Replay the edge, cut the leak</h3>
            </div>
          </div>
          <div className="journal-debrief-lessons-table">
            <div className="journal-debrief-lessons-head">
              <span>Topic</span>
              <span>Evidence</span>
              <span>Lesson</span>
              <span>Priority</span>
            </div>
            {lessonRows.length ? lessonRows.map((row) => (
              <div key={`${row.topic}-${row.evidence}`} className="journal-debrief-lessons-row">
                <strong>{row.topic}</strong>
                <span>{row.evidence}</span>
                <p>{row.lesson}</p>
                <em>{row.priority}</em>
              </div>
            )) : (
              <div className="journal-debrief-lessons-empty">No lessons logged yet. Add one note before closing the session.</div>
            )}
          </div>
          <label className="journal-debrief-review-note">
            <span>Closeout note</span>
            {reviewModeActive ? (
              <div className="journal-review-mode-banner">
                Review mode is active. Capture the one rule to repeat, the one mistake to remove, and the next session adjustment before you save the snapshot.
              </div>
            ) : null}
            <textarea
              ref={reviewComposerRef}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Write the one rule to repeat, the one mistake to eliminate, and the one setup to prioritize next session."
            />
          </label>
          <div className="journal-inline-actions">
            <button type="button" className="journal-btn secondary" onClick={onAddToJournal}>Add to Journal</button>
          </div>
        </article>
      </section>
    </div>
  );
}

function JournalHeader({ search, onSearch, onNewEntry, exportMenuOpen, setExportMenuOpen, exportMenuRef, onExportChoice }) {
  return (
    <CompactPageHeader
      className="journal-header compact"
      eyebrow="Journal"
      title="Journal"
      description="Track decisions, review performance, and turn repeat patterns into better research."
      actions={(
        <div className="journal-header-actions">
          <label className="journal-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search symbol, setup, notes..."
              aria-label="Search journal entries"
            />
          </label>
          <div className="journal-export-wrap" ref={exportMenuRef}>
            <button type="button" className="journal-btn secondary" onClick={() => setExportMenuOpen((value) => !value)}>
              Export
            </button>
            {exportMenuOpen ? (
              <div className="journal-export-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => onExportChoice("entries")}>Export entries CSV</button>
                <button type="button" role="menuitem" onClick={() => onExportChoice("analytics")}>Export analytics report</button>
                <button type="button" role="menuitem" onClick={() => onExportChoice("review")}>Export review summary</button>
              </div>
            ) : null}
          </div>
          <button type="button" className="journal-btn primary" onClick={onNewEntry}>
            <span aria-hidden="true">+</span> Quick Entry
          </button>
        </div>
      )}
    />
  );
}

function JournalStatsGrid({ stats }) {
  return <MetricStrip items={stats.map((stat) => ({ label: stat.label, value: stat.value, helper: stat.delta, tone: stat.tone }))} className="journal-metric-strip" />;
}

function JournalTabNav({ activeTab, onChange }) {
  const tabs = [
    ["overview", "Overview"],
    ["queue", "Needs Journaling"],
    ["entries", "Entries"],
    ["calendar", "Calendar"],
    ["analytics", "Analytics"],
    ["reports", "Reports"],
    ["review", "Review"],
    ["settings", "Settings"]
  ];
  return (
    <nav className="journal-tab-nav" aria-label="Journal views">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={activeTab === key ? "active" : ""}
          aria-selected={activeTab === key}
          aria-current={activeTab === key ? "page" : undefined}
          title={label}
          onClick={() => onChange(key)}
        >
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function JournalEntriesView({
  rows,
  totalRows,
  page,
  pageSize,
  totalPages,
  filters,
  setFilters,
  showMoreFilters,
  setShowMoreFilters,
  symbolOptions,
  setupOptions,
  regimeOptions,
  selectedSymbols,
  setSelectedSymbols,
  connOptions = [],
  selectedSources,
  setSelectedSources,
  onReset,
  onNewEntry,
  onOpenDetail,
  onPrevPage,
  onNextPage,
  formatValue
}) {
  const pageStart = totalRows === 0 ? 0 : ((page - 1) * Math.max(1, pageSize || 1)) + 1;
  const pageEnd = totalRows === 0 ? 0 : Math.min(totalRows, pageStart + rows.length - 1);
  return (
    <section className="journal-card journal-entries-view">
      <JournalFilters
        filters={filters}
        setFilters={setFilters}
        showMoreFilters={showMoreFilters}
        setShowMoreFilters={setShowMoreFilters}
        symbolOptions={symbolOptions}
        setupOptions={setupOptions}
        regimeOptions={regimeOptions}
        selectedSymbols={selectedSymbols}
        setSelectedSymbols={setSelectedSymbols}
        connOptions={connOptions}
        selectedSources={selectedSources}
        setSelectedSources={setSelectedSources}
        onReset={onReset}
      />
      {rows.length ? (
        <>
          <JournalEntriesTable rows={rows} onOpenDetail={onOpenDetail} formatValue={formatValue} />
          <div className="journal-table-footer">
            <span>Showing {pageStart}-{pageEnd} of {totalRows} entries</span>
            <div>
              <button type="button" className="journal-btn secondary" onClick={onPrevPage} disabled={page <= 1}>Prev</button>
              <button type="button" className="journal-btn secondary" onClick={onNextPage} disabled={page >= totalPages}>Next</button>
            </div>
          </div>
        </>
      ) : (
        <JournalEmptyState title="No journal entries found" description="Try adjusting your filters or create a new journal entry." cta="New Entry" onAction={onNewEntry} />
      )}
    </section>
  );
}

// Per-source realized-P&L breakdown. Renders each connection's win rate, realized
// P&L, and volume from the analytics.bySource rollup. Source ids resolve to the
// connection registry labels; unresolved ids fall back to a title-cased string.
function JournalBySourcePanel({ bySource = [], connOptions = [], formatValue = (v) => v }) {
  const labelFor = useMemo(() => {
    const map = new Map(connOptions.map((o) => [o.value, o.label]));
    return (id) => {
      if (map.has(id)) return map.get(id);
      return id === "unknown" ? "Unknown" : (String(id).charAt(0).toUpperCase() + String(id).slice(1));
    };
  }, [connOptions]);
  if (!Array.isArray(bySource) || bySource.length === 0) return null;
  return (
    <section className="journal-by-source-panel">
      <div className="journal-by-source-head">
        <h3>Performance by Source</h3>
        <p>Realized P&amp;L, win rate, and volume per connected source.</p>
      </div>
      <DataTable
        columns={[
          { key: "sourceLabel", header: "Source", sortable: false, cell: (row) => <strong>{row.sourceLabel}</strong> },
          { key: "trades", header: "Trades", sortable: false, align: "right" },
          {
            key: "winRate",
            header: "Win Rate",
            sortable: false,
            align: "right",
            cell: (row) => <span className={row.winRate >= 50 ? "positive" : "negative"}>{row.winRate.toFixed(1)}%</span>,
          },
          {
            key: "realizedPnl",
            header: "Realized P&L",
            sortable: false,
            align: "right",
            cell: (row) => <span className={row.realizedPnl >= 0 ? "positive" : "negative"}>{formatValue(row.realizedPnl, true)}</span>,
          },
          { key: "volume", header: "Volume", sortable: false, align: "right", cell: (row) => formatValue(row.volume) },
        ]}
        data={bySource.map((row) => ({ ...row, sourceLabel: labelFor(row.source) }))}
        getRowId={(row) => row.source}
        emptyState={<div className="journal-by-source-empty">No closed trades yet.</div>}
        className="journal-by-source-table"
      />
    </section>
  );
}

// Searchable multi-select for ticker/name filtering. Empty selection = all.
function JournalSymbolMultiSelect({ symbolOptions = [], selectedSymbols = [], setSelectedSymbols }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedSymbols), [selectedSymbols]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return symbolOptions;
    return symbolOptions.filter((s) => String(s).toLowerCase().includes(q));
  }, [symbolOptions, query]);
  const label = selectedSet.size === 0
    ? "All Symbols"
    : selectedSet.size === 1
      ? [...selectedSet][0]
      : `${selectedSet.size} symbols`;
  const toggle = (symbol) => setSelectedSymbols((prev) => {
    const set = new Set(prev);
    if (set.has(symbol)) set.delete(symbol); else set.add(symbol);
    return [...set];
  });
  return (
    <div className="journal-filter-field">
      <span className="journal-filter-label">Symbol</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="journal-multiselect-trigger">
            <span>{label}</span>
            <ChevronDown size={14} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="journal-multiselect-pop">
          <div className="journal-multiselect-search">
            <Search size={14} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbols..."
              className="journal-multiselect-input"
            />
          </div>
          {selectedSet.size > 0 && (
            <button type="button" className="journal-multiselect-clear" onClick={() => setSelectedSymbols([])}>Clear</button>
          )}
          <div className="journal-multiselect-list">
            {filtered.length === 0 && <div className="journal-multiselect-empty">No symbols</div>}
            {filtered.map((symbol) => (
              <label key={symbol} className="journal-multiselect-item">
                <Checkbox checked={selectedSet.has(symbol)} onCheckedChange={() => toggle(symbol)} />
                <span>{symbol}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Multi-select for connected sources. Empty selection = All Sources. Options come
// from the live connection registry (connectedAccounts + brokerageAccounts).
function JournalSourceMultiSelect({ connOptions = [], selectedSources, setSelectedSources }) {
  const [open, setOpen] = useState(false);
  const label = !selectedSources || selectedSources.size === 0
    ? "All Sources"
    : selectedSources.size === 1
      ? (connOptions.find((o) => o.value === [...selectedSources][0])?.label || "1 source")
      : `${selectedSources.size} sources`;
  const toggle = (value) => setSelectedSources((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  return (
    <div className="journal-filter-field">
      <span className="journal-filter-label">Source</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="journal-multiselect-trigger">
            <span>{label}</span>
            <ChevronDown size={14} aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="journal-multiselect-pop">
          <div className="journal-multiselect-head">
            <span className="journal-multiselect-title">Connections</span>
            {selectedSources && selectedSources.size > 0 && (
              <button type="button" className="journal-multiselect-clear" onClick={() => setSelectedSources(new Set())}>Clear</button>
            )}
          </div>
          <div className="journal-multiselect-list">
            {connOptions.length === 0 && <div className="journal-multiselect-empty">No connected sources</div>}
            {connOptions.map((opt) => (
              <label key={opt.value} className="journal-multiselect-item">
                <Checkbox checked={!!selectedSources && selectedSources.has(opt.value)} onCheckedChange={() => toggle(opt.value)} />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function JournalFilters({ filters, setFilters, showMoreFilters, setShowMoreFilters, symbolOptions, setupOptions, regimeOptions, selectedSymbols, setSelectedSymbols, connOptions = [], selectedSources, setSelectedSources, onReset }) {
  return (
    <div className="journal-filter-toolbar">
      <InlineControlGroup className="journal-filter-chip-row">
        <button
          type="button"
          className={`journal-filter-pill ${filters.dateWindow === "all" ? "active" : ""}`}
          onClick={() => setFilters((prev) => ({ ...prev, dateWindow: "all" }))}
        >
          All Entries
        </button>
        <button
          type="button"
          className={`journal-filter-pill ${filters.dateWindow === "30d" ? "active" : ""}`}
          onClick={() => setFilters((prev) => ({ ...prev, dateWindow: "30d" }))}
        >
          Last 30D
        </button>
      </InlineControlGroup>
      <JournalSymbolMultiSelect
        symbolOptions={symbolOptions}
        selectedSymbols={selectedSymbols}
        setSelectedSymbols={setSelectedSymbols}
      />
      <JournalSourceMultiSelect
        connOptions={connOptions}
        selectedSources={selectedSources}
        setSelectedSources={setSelectedSources}
      />
      <label>
        <span>Setup</span>
        <select value={filters.strategy} onChange={(event) => setFilters((prev) => ({ ...prev, strategy: event.target.value }))}>
          <option value="all">All Setups</option>
          {setupOptions.map((setup) => <option key={setup} value={setup.toLowerCase()}>{setup}</option>)}
        </select>
      </label>
      <FilterPopover open={showMoreFilters} onToggle={setShowMoreFilters} label="More Filters" className="journal-filter-popover">
        <div className="journal-secondary-filters open">
          <label>
            <span>Regime</span>
            <select value={filters.regime} onChange={(event) => setFilters((prev) => ({ ...prev, regime: event.target.value }))}>
              <option value="all">All Regimes</option>
              {regimeOptions.map((regime) => <option key={regime} value={regime.toLowerCase()}>{regime}</option>)}
            </select>
          </label>
          <label>
            <span>Decision</span>
            <select value={filters.side} onChange={(event) => setFilters((prev) => ({ ...prev, side: event.target.value }))}>
              <option value="all">All</option>
              <option value="buy">Increase</option>
              <option value="sell">Reduce</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="review">Review</option>
            </select>
          </label>
          <button type="button" className="journal-btn secondary" onClick={onReset}>Reset</button>
        </div>
      </FilterPopover>
    </div>
  );
}

function JournalEntriesTable({ rows, onOpenDetail, formatValue }) {
  return (
    <>
      <div className="journal-table-wrap">
        <DataTable
          columns={[
            { key: "symbol", header: "Symbol", sortable: false, cell: (row) => <JournalSymbolCell row={row} /> },
            { key: "date", header: "Date", sortable: false },
            { key: "setup", header: "Setup", sortable: false },
            { key: "side", header: "Side", sortable: false, cell: (row) => <JournalSideChip side={row.side} /> },
            { key: "regime", header: "Regime", sortable: false },
            { key: "confidence", header: "Confidence", sortable: false, cell: (row) => <ConfidenceDots value={row.confidence} /> },
            { key: "status", header: "Status", sortable: false, cell: (row) => <JournalStatusPill status={row.status} /> },
            {
              key: "pnl",
              header: "P&L",
              align: "right",
              sortable: false,
              cell: (row) => (
                <span className={Number(row.pnl) >= 0 ? "positive" : "negative"}>
                  {Number(row.pnl) >= 0 ? "+" : "-"}{formatValue(Math.abs(row.pnl), true)}
                </span>
              ),
            },
            { key: "notesCount", header: "Notes", sortable: false, cell: (row) => <span className="journal-notes-count" aria-label={`${row.notesCount} notes`}>▣ {row.notesCount}</span> },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              sortable: false,
              cell: (row) => (
                <button
                  type="button"
                  className="journal-kebab"
                  aria-label={`Open actions for ${row.symbol}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDetail(row);
                  }}
                >
                  ⋯
                </button>
              ),
            },
          ]}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => onOpenDetail(row)}
          className="journal-table"
        />
      </div>
      <div className="journal-entry-card-list">
        {rows.map((row) => (
          <JournalEntryCard key={`card-${row.id}`} row={row} onOpenDetail={onOpenDetail} formatValue={formatValue} />
        ))}
      </div>
    </>
  );
}

function JournalEntryCard({ row, onOpenDetail, formatValue }) {
  return (
    <button type="button" className="journal-entry-card" onClick={() => onOpenDetail(row)}>
      <div>
        <JournalSymbolCell row={row} />
        <span className="journal-entry-card-date">{row.date}</span>
      </div>
      <div className="journal-entry-card-meta">
        <JournalSideChip side={row.side} />
        <JournalStatusPill status={row.status} />
        <span>{row.setup}</span>
      </div>
      <div className={Number(row.pnl) >= 0 ? "positive" : "negative"}>
        {Number(row.pnl) >= 0 ? "+" : "-"}{formatValue(Math.abs(row.pnl), true)} · {row.notesCount} notes
      </div>
    </button>
  );
}

function JournalSymbolCell({ row }) {
  // Human-readable label hierarchy: canonical symbol first; when no ticker
  // symbol exists (prediction-market fills, human labels), surface the name
  // instead of a generic "Unknown"/"—" sentinel.
  const symbol = row?.symbol || row?.asset || null;
  const label = symbol || row?.name || "Unknown";
  const display = String(label).toUpperCase();
  return (
    <div className="journal-symbol-cell">
      <span>{String(display || "A")[0]}</span>
      <div>
        <strong>{display}</strong>
        <small>{row.assetType || "Spot"}</small>
      </div>
    </div>
  );
}

function JournalSideChip({ side }) {
  const normalized = String(side || "").toUpperCase() === "SELL" ? "sell" : "buy";
  return <span className={`journal-chip ${normalized}`}>{normalized === "buy" ? "Increase" : "Reduce"}</span>;
}

function JournalStatusPill({ status }) {
  const normalized = String(status || "Closed").toLowerCase();
  const tone = normalized.includes("open") ? "open" : normalized.includes("review") ? "review" : "closed";
  return <span className={`journal-chip status ${tone}`}>{status || "Closed"}</span>;
}

function ConfidenceDots({ value }) {
  const count = Math.max(1, Math.min(5, Number(value) || 1));
  return <span className="journal-confidence" aria-label={`Confidence ${count} of 5`}>{"●".repeat(count)}{"○".repeat(5 - count)}</span>;
}

function JournalCalendarView({ calendarMonthLabel, monthDateRangeLabel, calendarCells, snapshotFetchState, selectedDay, selectedDayTrades, onSelectDay, onMoveMonth, onViewTrades, selectedSymbol, setSelectedSymbols, symbolOptions, monthPnL, bestDay, worstDay, avgDayPnL, profitableDays, losingDays, breakevenDays, formatValue }) {
  const summary = [
    ["Month P&L", monthPnL, monthPnL >= 0 ? "positive" : "negative", true],
    ["Best Day", bestDay, "positive", true],
    ["Worst Day", worstDay, "negative", true],
    ["Avg Daily P&L", avgDayPnL, "neutral", true],
    ["Profitable Days", profitableDays, "neutral", false],
    ["Losing Days", losingDays, "neutral", false],
    ["Breakeven Days", breakevenDays, "neutral", false]
  ];
  return (
    <section className="journal-card journal-calendar-view">
      <div className="journal-section-head">
        <div>
          <h3>Daily P&L Heatmap</h3>
          <p>{monthDateRangeLabel}</p>
        </div>
        <div className="journal-inline-actions">
          <button type="button" className="journal-btn secondary" onClick={() => onMoveMonth(-1)}>Prev</button>
          <strong>{calendarMonthLabel}</strong>
          <button type="button" className="journal-btn secondary" onClick={() => onMoveMonth(1)}>Next</button>
          <select value={selectedSymbol} onChange={(event) => setSelectedSymbols(event.target.value ? [event.target.value] : [])}>
            <option value="">All Assets</option>
            {symbolOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
          <select defaultValue="pnl" aria-label="Calendar metric">
            <option value="pnl">P&L</option>
            <option value="trades">Decisions</option>
            <option value="winRate">Win Rate</option>
            <option value="mistakes">Mistakes</option>
          </select>
        </div>
      </div>
      {snapshotFetchState === "loading" && (
        <div className="journal-calendar-state" role="status">
          <span className="journal-calendar-state-text">Loading historical data…</span>
        </div>
      )}
      {snapshotFetchState === "error" && (
        <div className="journal-calendar-state journal-calendar-state-error" role="status">
          <span className="journal-calendar-state-text">Historical data unavailable for this period.</span>
        </div>
      )}
      {snapshotFetchState === "empty" && calendarCells.every((c) => c.type !== "day") && (
        <div className="journal-calendar-state journal-calendar-state-empty" role="status">
          <span className="journal-calendar-state-text">No historical data for this period.</span>
        </div>
      )}
      <div className="journal-calendar-layout">
        <div>
          <div className="journal-week-header">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="journal-heat-grid">
            {calendarCells.map((cell) => {
              if (cell.type === "blank") return <div key={cell.key} className="journal-heat-cell blank" />;
              const pnl = Number(cell.pnl || 0);
              const tone = pnl > 300 ? "large-gain" : pnl > 0 ? "small-gain" : pnl < -300 ? "large-loss" : pnl < 0 ? "small-loss" : "neutral";
              return (
                <button
                  key={cell.key}
                  type="button"
                  className={`journal-heat-cell ${tone} ${selectedDay?.key === cell.key ? "selected" : ""}`}
                  title={`${cell.key} · ${formatValue(pnl, true)}`}
                  onClick={() => onSelectDay(cell)}
                >
                  <span>{cell.dayNum}</span>
                  {cell.pnl != null ? <strong>{pnl >= 0 ? "+" : "-"}{formatValue(Math.abs(pnl), true)}</strong> : <small>No decisions</small>}
                </button>
              );
            })}
          </div>
          <div className="journal-heat-legend">
            {["Large loss", "Small loss", "No decisions", "Small gain", "Large gain"].map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
        <aside className="journal-selected-day">
          <h3>{selectedDay?.key || "Selected Day"}</h3>
          <strong className={Number(selectedDay?.pnl || 0) >= 0 ? "positive" : "negative"}>{formatValue(selectedDay?.pnl || 0, true)}</strong>
          <p>{selectedDayTrades.length} decisions · {selectedDayTrades.filter((row) => Number(row.pnl) > 0).length} winners / {selectedDayTrades.filter((row) => Number(row.pnl) < 0).length} losers</p>
          <button
            type="button"
            className="journal-btn primary journal-btn-small"
            onClick={() => onViewTrades?.(selectedDay)}
            disabled={!selectedDay?.key}
          >
            View decisions
          </button>
        </aside>
      </div>
      <div className="journal-month-summary">
        {summary.map(([label, value, tone, isCurrency]) => (
          <div key={label}>
            <span>{label}</span>
            <strong className={tone}>{isCurrency ? formatValue(value, true) : value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function JournalCalendarDayView({ dateKey, rows, availableDateKeys, onBack, onNavigateDate, onNewEntry, onOpenDetail, formatValue }) {
  const [search, setSearch] = useState("");
  const [assetFilter, setAssetFilter] = useState("all");
  const [setupFilter, setSetupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [sortBy, setSortBy] = useState("time-asc");
  const [visibleCount, setVisibleCount] = useState(25);
  const [showFilters, setShowFilters] = useState(false);

  const assetOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.symbol || "").trim().toUpperCase()).filter(Boolean))],
    [rows]
  );
  const setupOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.setup || "").trim()).filter(Boolean))],
    [rows]
  );
  const marketOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.assetType || "").trim()).filter(Boolean))],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    const nextRows = rows.filter((row) => {
      if (assetFilter !== "all" && String(row.symbol || "").toUpperCase() !== assetFilter) return false;
      if (setupFilter !== "all" && String(row.setup || "") !== setupFilter) return false;
      if (statusFilter !== "all" && String(row.status || "").toLowerCase() !== statusFilter) return false;
      if (marketFilter !== "all" && String(row.assetType || "") !== marketFilter) return false;
      if (!query) return true;
      const haystack = [
        row.symbol,
        row.setup,
        row.review,
        row.entry?.preThesis,
        row.entry?.postReview,
        row.entry?.learned,
        row.mistakeCategory
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });

    nextRows.sort((a, b) => {
      const ta = new Date(a.rawDate || a.date || 0).getTime() || 0;
      const tb = new Date(b.rawDate || b.date || 0).getTime() || 0;
      if (sortBy === "time-desc") return tb - ta;
      if (sortBy === "pnl-desc") return Number(b.pnl || 0) - Number(a.pnl || 0);
      if (sortBy === "pnl-asc") return Number(a.pnl || 0) - Number(b.pnl || 0);
      return ta - tb;
    });

    return nextRows;
  }, [rows, search, assetFilter, setupFilter, statusFilter, marketFilter, sortBy]);

  const visibleRows = filteredRows.slice(0, visibleCount);
  const hasDecisions = filteredRows.length > 0;
  const totalPnl = filteredRows.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const winners = filteredRows.filter((row) => Number(row.pnl || 0) > 0);
  const losers = filteredRows.filter((row) => Number(row.pnl || 0) < 0);
  const grossGains = winners.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const grossLosses = losers.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const fees = filteredRows.reduce((sum, row) => sum + Math.abs(Number(row.fees || 0)), 0);
  const winRate = filteredRows.length ? (winners.length / filteredRows.length) * 100 : 0;
  const bestTrade = [...filteredRows].sort((a, b) => Number(b.pnl || 0) - Number(a.pnl || 0))[0] || null;
  const worstTrade = [...filteredRows].sort((a, b) => Number(a.pnl || 0) - Number(b.pnl || 0))[0] || null;

  const avgHoldLabel = useMemo(() => {
    const hours = filteredRows
      .map((row) => {
        const match = String(row.holdingTime || "").match(/([\d.]+)\s*h/i);
        return match ? Number(match[1]) : null;
      })
      .filter((value) => Number.isFinite(value));
    if (!hours.length) return "—";
    const averageHours = hours.reduce((sum, value) => sum + value, 0) / hours.length;
    const wholeHours = Math.floor(averageHours);
    const mins = Math.round((averageHours - wholeHours) * 60);
    return `${wholeHours}h ${String(mins).padStart(2, "0")}m`;
  }, [filteredRows]);

  const intradaySeries = [{
    name: "P&L",
    data: filteredRows.map((row) => ({
      x: `${row.symbol}\n${new Date(row.rawDate || row.date || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      y: Number(row.pnl || 0)
    }))
  }];
  const intradayOptions = {
    chart: { toolbar: { show: false }, foreColor: chartColors.muted(), background: "transparent" },
    grid: { borderColor: "rgba(160, 160, 160, 0.12)" },
    theme: { mode: activeChartThemeMode() },
    plotOptions: {
      bar: {
        borderRadius: 6,
        distributed: true
      }
    },
    colors: filteredRows.map((row) => chartColors.pnl(row.pnl)),
    xaxis: {
      labels: {
        style: { colors: chartColors.muted(), fontSize: "var(--fs-sm)" }
      }
    },
    yaxis: {
      labels: {
        formatter: (value) => formatValue(value, true)
      }
    },
    tooltip: {
      y: {
        formatter: (value) => formatValue(value, true)
      }
    },
    legend: { show: false },
    dataLabels: { enabled: false }
  };

  const notesBlocks = [
    { label: "Thesis", value: filteredRows.map((row) => row.entry?.preThesis).find(Boolean) || "No thesis notes yet." },
    { label: "Mistakes", value: filteredRows.map((row) => row.mistakeCategory || row.entry?.mistakeCategory).find(Boolean) || "No mistakes logged for this day." },
    { label: "Lessons", value: filteredRows.map((row) => row.entry?.learned || row.review).find(Boolean) || "No lessons captured yet." },
    { label: "Next Actions", value: filteredRows.map((row) => row.entry?.postReview).find(Boolean) || "Add a post-review note to capture next actions." }
  ];
  const attachments = filteredRows
    .map((row, index) => {
      const link = String(row.chartLink || row.entry?.chartLink || "").trim();
      if (!link) return null;
      return {
        id: `${row.id || index}-${link}`,
        href: link,
        label: extractFileLabel(link, `${row.symbol || "Attachment"} screenshot`)
      };
    })
    .filter(Boolean);

  const currentDateIndex = Math.max(0, availableDateKeys.indexOf(dateKey));
  const previousDate = currentDateIndex > 0 ? availableDateKeys[currentDateIndex - 1] : "";
  const nextDate = currentDateIndex >= 0 && currentDateIndex < availableDateKeys.length - 1 ? availableDateKeys[currentDateIndex + 1] : "";

  const exportDayCsv = () => {
    if (!filteredRows.length) return;
    const header = ["time", "symbol", "market", "side", "strategy", "qty", "entry_price", "exit_price", "pnl", "status", "notes"];
    const lines = filteredRows.map((row) => ([
      new Date(row.rawDate || row.date || Date.now()).toISOString(),
      row.symbol,
      row.assetType,
      row.side,
      row.setup,
      row.size,
      row.entryPrice,
      row.exitPrice || "",
      Number(row.pnl || 0),
      row.status,
      `"${String(row.review || row.entry?.preThesis || "").replace(/"/g, '""')}"`
    ].join(",")));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal-decisions-${dateKey}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="journal-day-view">
      <div className="journal-day-view-head">
        <div>
          <nav className="journal-breadcrumb" aria-label="Breadcrumb">Journal <span>/</span> Calendar <span>/</span> View Decisions</nav>
          <h3>Decisions for {dateKey || "Selected Day"}</h3>
          <p className="journal-day-view-desc">Review the decisions made on this day and capture what you learned.</p>
        </div>
        <div className="journal-day-view-actions">
          <button type="button" className="journal-btn secondary" onClick={exportDayCsv}>Export</button>
          <button type="button" className="journal-btn primary" onClick={onNewEntry}>Add decision</button>
        </div>
      </div>

      <div className="journal-day-toolbar">
        <button type="button" className="journal-btn secondary" onClick={onBack}>Back to Calendar</button>
        <div className="journal-day-date-nav">
          <button type="button" className="journal-kebab" aria-label="Previous day" disabled={!previousDate} onClick={() => previousDate && onNavigateDate(previousDate)}>‹</button>
          <time dateTime={dateKey}>{dateKey || "Selected Day"}</time>
          <button type="button" className="journal-kebab" aria-label="Next day" disabled={!nextDate} onClick={() => nextDate && onNavigateDate(nextDate)}>›</button>
        </div>
        <label className="journal-search journal-day-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search decisions</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol, strategy, or notes" />
        </label>
        <button type="button" className="journal-btn secondary" aria-expanded={showFilters} aria-controls="journal-day-filters" onClick={() => setShowFilters((value) => !value)}>Filters</button>
      </div>

      {showFilters && (
        <div id="journal-day-filters" className="journal-day-filter-row">
          <label><span>Asset</span>
            <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
              <option value="all">All Assets</option>
              {assetOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
          <label><span>Strategy</span>
            <select value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
              <option value="all">All Strategies</option>
              {setupOptions.map((setup) => <option key={setup} value={setup}>{setup}</option>)}
            </select>
          </label>
          <label><span>Status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All Statuses</option>
              <option value="closed">Closed</option>
              <option value="open">Open</option>
              <option value="review">Review</option>
            </select>
          </label>
          <label><span>Market type</span>
            <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}>
              <option value="all">Market Type</option>
              {marketOptions.map((market) => <option key={market} value={market}>{market}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="journal-day-summary-grid">
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Decisions</span>
          <strong>{filteredRows.length}</strong>
          <small>{hasDecisions ? "Captured for this day" : "No decisions captured"}</small>
        </article>

        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Total P&amp;L</span>
          <strong className={totalPnl >= 0 ? "positive" : "negative"}>{hasDecisions ? formatValue(totalPnl, true) : "Not available"}</strong>
          <small>{hasDecisions ? "For the selected day" : "Appears after outcomes are recorded"}</small>
        </article>

        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Win rate</span>
          <strong>{hasDecisions ? `${winRate.toFixed(1)}%` : "Not available"}</strong>
          <small>{hasDecisions ? "Based on recorded outcomes" : "Appears after decisions are reviewed"}</small>
        </article>

        {hasDecisions && (
          <>
            <article className="journal-card journal-day-stat-card">
              <span className="journal-card-label">Winners</span>
              <strong className="positive">{winners.length}</strong>
            </article>

            <article className="journal-card journal-day-stat-card">
              <span className="journal-card-label">Losers</span>
              <strong className="negative">{losers.length}</strong>
            </article>
          </>
        )}
      </div>

      <div className="journal-day-layout">
        <div className="journal-day-main">
          <section className="journal-card journal-day-trade-log">
            <div className="journal-section-head">
              <h3>Decision Log</h3>
              <div className="journal-inline-actions">
                <label>
                  <span>Sort by</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                    <option value="time-asc">Time (Asc)</option>
                    <option value="time-desc">Time (Desc)</option>
                    <option value="pnl-desc">P&amp;L (High-Low)</option>
                    <option value="pnl-asc">P&amp;L (Low-High)</option>
                  </select>
                </label>
                <label>
                  <span>Show</span>
                  <select value={visibleCount} onChange={(event) => setVisibleCount(Number(event.target.value) || 25)}>
                    {[10, 25, 50].map((count) => <option key={count} value={count}>{count}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="journal-day-trades-list">
              {visibleRows.length ? visibleRows.map((row, tri) => {
                const tradeTime = new Date(row.rawDate || row.date || Date.now());
                return (
                  <article key={`${row.id || row.sourceId || `trade-${tri}`}-${tri}`} className="journal-day-trade-row">
                    <div className="journal-day-trade-time">
                      <strong>{tradeTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
                      <span>{tradeTime.toLocaleDateString()}</span>
                      <small>{row.holdingTime || "—"}</small>
                    </div>
                    <div className="journal-day-trade-body">
                      <div className="journal-day-trade-top">
                        <div className="journal-symbol-cell">
                          <span>{String(row.symbol || "A")[0]}</span>
                          <div>
                            <strong>{row.symbol}</strong>
                            <small>{row.entry?.symbolName || row.assetType || "Decision"}</small>
                          </div>
                        </div>
                        <div className="journal-day-chip-row">
                          <span className="journal-chip status open">{row.assetType || "Spot"}</span>
                          <JournalSideChip side={row.side} />
                          <span className="journal-chip">{row.setup || "Setup"}</span>
                        </div>
                      </div>

                      <div className="journal-day-trade-metrics">
                        <div><span>Qty</span><strong>{Number(row.size || 0).toFixed(4)}</strong></div>
                        <div><span>Entry</span><strong>{formatValue(row.entryPrice || 0, true)}</strong></div>
                        <div><span>Exit</span><strong>{row.exitPrice ? formatValue(row.exitPrice, true) : "—"}</strong></div>
                        <div><span>P&amp;L</span><strong className={Number(row.pnl || 0) >= 0 ? "positive" : "negative"}>{formatValue(row.pnl || 0, true)}</strong></div>
                        <div><span>Status</span><strong><JournalStatusPill status={row.status} /></strong></div>
                      </div>

                      <div className="journal-day-trade-footer">
                        <p>{row.review || row.entry?.preThesis || "No notes captured for this decision yet."}</p>
                        <div className="journal-day-trade-actions">
                          <button type="button" className="journal-btn secondary" onClick={() => onOpenDetail(row)}>View</button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                filteredRows.length === 0 && !search && assetFilter === "all" && setupFilter === "all" && statusFilter === "all" && marketFilter === "all" ? (
                  <JournalEmptyState
                    title="Start your first decision review"
                    description="Capture your thesis, conviction, outcome, and lesson for this day."
                    cta="Add your first decision"
                    onAction={onNewEntry}
                  />
                ) : (
                  <JournalEmptyState
                    title="No decisions match these filters"
                    description="Try adjusting the date, filters, or search query."
                  />
                )
              )}
            </div>
          </section>
        </div>

        <aside className={`journal-day-aside ${hasDecisions ? "" : "is-empty"}`}>
          <section className="journal-card">
            <div className="journal-section-head"><h3>Day Breakdown</h3></div>
            <div className="journal-day-breakdown-grid">
              <div><span>Gross Gains</span><strong className="positive">{formatValue(grossGains, true)}</strong></div>
              <div><span>Net P&amp;L</span><strong className={totalPnl >= 0 ? "positive" : "negative"}>{formatValue(totalPnl, true)}</strong></div>
              <div><span>Gross Losses</span><strong className="negative">{formatValue(grossLosses, true)}</strong></div>
              <div><span>Best Decision</span><strong className="positive">{bestTrade ? `${formatValue(bestTrade.pnl, true)} (${bestTrade.symbol})` : "—"}</strong></div>
              <div><span>Fees</span><strong>{formatValue(-fees, true)}</strong></div>
              <div><span>Worst Decision</span><strong className="negative">{worstTrade ? `${formatValue(worstTrade.pnl, true)} (${worstTrade.symbol})` : "—"}</strong></div>
              <div><span>Avg Hold Time</span><strong>{avgHoldLabel}</strong></div>
            </div>
          </section>

          {hasDecisions && (
            <>
              <section className="journal-card">
                <div className="journal-section-head"><h3>Intraday P&amp;L by Decision</h3></div>
                {filteredRows.length ? (
                  <Chart options={intradayOptions} series={intradaySeries} type="bar" height={220} />
                ) : (
                  <p className="journal-day-empty-copy">No decision chart data for this day.</p>
                )}
              </section>

              <section className="journal-card">
                <div className="journal-section-head"><h3>Review</h3></div>
                <div className="journal-day-notes-list">
                  {notesBlocks.map((item, nbi) => (
                    <div key={`${item.label || "note"}-${nbi}`}>
                      <span>{item.label}</span>
                      <p>{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="journal-card">
                <div className="journal-section-head"><h3>Attachments</h3></div>
                <div className="journal-day-attachments">
                  {attachments.length ? attachments.map((item) => (
                    <a key={item.id} className="journal-day-attachment" href={item.href} target="_blank" rel="noreferrer">
                      <strong>{item.label}</strong>
                      <span>Open link</span>
                    </a>
                  )) : (
                    <div className="journal-day-attachment empty">
                      <strong>No attachments yet</strong>
                      <span>Add chart links in journal entries to see them here.</span>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function JournalAnalyticsView({ analytics, winLossOptions, winLossSeries, winnersCount, losersCount, breakevenCount, weeklyMonthlyReview, assetPnlRows, setupPnlRows, tradeLogRows, onToast, onExportAnalytics, onSaveInsight, onCreateReviewTask, formatValue }) {
  const maxAbs = Math.max(1, ...assetPnlRows.map((row) => Math.abs(Number(row.pnl || 0))));
  return (
    <section className="journal-analytics-grid">
      <div className="journal-card journal-performance-card">
        <div className="journal-section-head"><h3>Performance Overview</h3><button type="button" className="journal-btn secondary" onClick={() => onToast("Summary reflects the current Journal filters.", "info")}>Summary</button></div>
        <div className="journal-donut-row">
          <Chart options={winLossOptions} series={winLossSeries.some((v) => v > 0) ? winLossSeries : [1, 1]} type="donut" height={190} />
          <div className="journal-overview-list">
            <div><span>Winners</span><strong>{winnersCount}</strong></div>
            <div><span>Losers</span><strong>{losersCount}</strong></div>
            <div><span>Breakeven</span><strong>{breakevenCount}</strong></div>
            <div><span>Profit Factor</span><strong>{weeklyMonthlyReview.monthly.profitFactor.toFixed(2)}</strong></div>
            <div><span>Expectancy</span><strong>{formatValue(analytics.tradeExpectancy, true)}</strong></div>
          </div>
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>P&L by Asset Class</h3><button type="button" className="journal-btn secondary" onClick={onExportAnalytics}>Export analytics</button></div>
        <div className="journal-bar-list">
          {assetPnlRows.map((row) => (
            <div key={row.name}>
              <span>{row.name} · {row.count} decisions</span>
              <div><i className={Number(row.pnl) >= 0 ? "positive" : "negative"} style={{ width: `${Math.max(8, Math.abs(Number(row.pnl || 0)) / maxAbs * 100)}%` }} /></div>
              <strong className={Number(row.pnl) >= 0 ? "positive" : "negative"}>{formatValue(row.pnl, true)}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>P&L by Setup</h3></div>
        <div className="journal-compact-table">
          {setupPnlRows.map((row) => (
            <div key={row.setup}>
              <span>{row.setup}</span>
              <span>{row.trades} decisions</span>
              <span>{row.trades ? ((row.wins / row.trades) * 100).toFixed(0) : 0}% win</span>
              <strong className={row.pnl >= 0 ? "positive" : "negative"}>{formatValue(row.pnl, true)}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>Emotion / Behavior</h3></div>
        <div className="journal-behavior-grid">
          <div><span>Best emotion state</span><strong>Disciplined</strong></div>
          <div><span>Worst emotion state</span><strong>FOMO</strong></div>
          <div><span>Avg confidence</span><strong>{tradeLogRows.length ? (tradeLogRows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / tradeLogRows.length).toFixed(1) : "0.0"}/5</strong></div>
          <div><span>Mistake frequency</span><strong>{Math.min(100, Math.round((analytics.losses / Math.max(1, analytics.totalTrades)) * 100))}%</strong></div>
        </div>
      </div>
      <div className="journal-card journal-insight-card">
        <span>What this means</span>
        <p>Your strongest results came from momentum setups with high confidence. Losses are concentrated in options decisions taken during volatile regimes.</p>
        <div className="journal-inline-actions">
          <button type="button" className="journal-btn primary" onClick={onSaveInsight}>Save insight to Journal</button>
          <button type="button" className="journal-btn secondary" onClick={onExportAnalytics}>Export analytics</button>
          <button type="button" className="journal-btn secondary" onClick={onCreateReviewTask}>Create review task</button>
        </div>
      </div>
    </section>
  );
}

function JournalReviewView({ analytics, mistakeRows, setupPnlRows, reviewNote, setReviewNote, onToast, onSaveReview, onExportReview, onAddToJournal, formatValue }) {
  const bestSetup = [...setupPnlRows].sort((a, b) => Number(b.pnl) - Number(a.pnl))[0]?.setup || "Momentum";
  return (
    <section className="journal-review-grid">
      <div className="journal-card">
        <div className="journal-section-head"><h3>Review Summary</h3><span>Last 30D</span></div>
        <div className="journal-review-summary">
          <div><span>Total decisions</span><strong>{analytics.totalTrades}</strong></div>
          <div><span>Net P&L</span><strong className={analytics.totalGainLoss >= 0 ? "positive" : "negative"}>{formatValue(analytics.totalGainLoss, true)}</strong></div>
          <div><span>Win rate</span><strong>{analytics.winRate.toFixed(1)}%</strong></div>
          <div><span>Largest mistake</span><strong>{mistakeRows[0]?.mistake}</strong></div>
          <div><span>Best setup</span><strong>{bestSetup}</strong></div>
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>Lessons Learned</h3></div>
        <div className="journal-lesson-grid">
          <div><strong>What worked</strong><p>High-confidence momentum setups with clean invalidation.</p></div>
          <div><strong>What did not work</strong><p>Low-quality entries during volatile regimes.</p></div>
          <div><strong>What to repeat</strong><p>Wait for confirmation and scale around planned levels.</p></div>
          <div><strong>What to avoid</strong><p>Decisions without clear risk or post-decision review notes.</p></div>
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>Mistake Tracker</h3></div>
        <div className="journal-compact-table">
          {mistakeRows.map((row) => (
            <div key={row.mistake}>
              <span>{row.mistake}</span>
              <span>{row.count}x</span>
              <strong className="negative">{formatValue(row.cost, true)}</strong>
              <span>{row.action}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="journal-card">
        <div className="journal-section-head"><h3>Rule Adherence</h3></div>
        <JournalProgress label="Followed plan" value={68} tone="positive" />
        <JournalProgress label="Broke rules" value={21} tone="negative" />
        <JournalProgress label="No plan" value={11} tone="warning" />
      </div>
      <div className="journal-card journal-weekly-review">
        <label>
          <span>Weekly Review Notes</span>
          <textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="What is the one behavior you want to improve next week?" />
        </label>
        <div className="journal-inline-actions">
          <button type="button" className="journal-btn primary" onClick={onSaveReview}>Save Review</button>
          <button type="button" className="journal-btn secondary" onClick={onExportReview}>Export Review</button>
          <button type="button" className="journal-btn secondary" onClick={onAddToJournal}>Add to Journal</button>
        </div>
      </div>
      <div className="journal-action-plan">
        {[
          ["Repeat", "High-confidence momentum setups"],
          ["Reduce", "Low-quality options entries"],
          ["Avoid", "Trades without clear invalidation"]
        ].map(([label, text]) => (
          <div key={label} className="journal-card"><span>{label}</span><strong>{text}</strong></div>
        ))}
      </div>
      <DecisionOutcomesPanel formatValue={formatValue} />
    </section>
  );
}

function JournalProgress({ label, value, tone }) {
  return (
    <div className="journal-progress">
      <div><span>{label}</span><strong>{value}%</strong></div>
      <i><b className={tone} style={{ width: `${value}%` }} /></i>
    </div>
  );
}

function TradeDetailDrawer({ open, entry, drawerRef, onClose, onEdit, onDuplicate, onDelete, onAddReviewNote, formatValue }) {
  if (!open || !entry) return null;
  const summary = [
    ["Strategy/setup", entry.setup],
    ["Side", entry.side],
    ["Size", entry.size],
    ["Entry price", entry.entryPrice],
    ["Exit price", entry.exitPrice || "—"],
    ["Fees", entry.fees || "—"],
    ["Holding time", entry.holdingTime]
  ];
  return (
    <div className="journal-drawer-backdrop" onMouseDown={onClose}>
      <aside className="journal-detail-drawer" ref={drawerRef} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${entry.symbol} decision detail`}>
        <div className="journal-drawer-head">
          <div>
            <span className="journal-card-label">{entry.assetType}</span>
            <h3>{entry.symbol}</h3>
            <p>{entry.date} · <JournalStatusPill status={entry.status} /></p>
          </div>
          <div>
            <strong className={Number(entry.pnl) >= 0 ? "positive" : "negative"}>{Number(entry.pnl) >= 0 ? "+" : "-"}{formatValue(Math.abs(entry.pnl), true)}</strong>
            <button type="button" className="journal-kebab" onClick={onClose} aria-label="Close decision detail">×</button>
          </div>
        </div>
        <JournalDrawerSection title="Decision Summary" rows={summary} />
        <JournalDrawerSection title="Context" rows={[["Regime", entry.regime], ["Timeframe", entry.entry?.timeframe || "—"], ["Market notes", entry.entry?.preThesis || "—"], ["Screenshot/link", entry.chartLink || "—"]]} />
        <JournalDrawerSection title="Psychology" rows={[["Emotion", entry.emotion], ["Confidence", `${entry.confidence}/5`], ["Mistake tags", entry.mistakeCategory || "—"], ["Rule followed?", entry.mistakeCategory ? "No" : "Yes"]]} />
        <JournalDrawerSection title="Review" rows={[["What went well?", entry.entry?.learned || "—"], ["What went wrong?", entry.mistakeCategory || "—"], ["Improve next time", entry.review || "—"]]} />
        <div className="journal-drawer-actions">
          <button type="button" className="journal-btn primary" onClick={() => onEdit(entry)}>Edit Entry</button>
          <button type="button" className="journal-btn secondary" onClick={() => onDuplicate(entry)}>Duplicate</button>
          <button type="button" className="journal-btn secondary" onClick={() => onAddReviewNote(entry)}>Add Review Note</button>
          <button type="button" className="journal-btn danger" onClick={() => onDelete(entry)}>Delete</button>
        </div>
      </aside>
    </div>
  );
}

function JournalDrawerSection({ title, rows }) {
  return (
    <section className="journal-drawer-section">
      <h4>{title}</h4>
      {rows.map(([label, value]) => (
        <div key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </section>
  );
}

function JournalEmptyState({ title, description, cta, onAction }) {
  return (
    <GuidedEmptyState
      eyebrow="Journal workflow"
      title={title}
      description={description}
      steps={[
        "Capture the decision, thesis, or lesson that matters right now.",
        "Return to review patterns after a few entries are logged.",
      ]}
      cta={cta}
      onAction={onAction}
      className="journal-empty-state"
    />
  );
}

// ── Phase 3: "Needs journaling" queue ──────────────────────────────────────
// Lists open + decision_relevant trade events surfaced by the backend, with
// quick actions (open detail / dismiss / snooze). Journaling an event is done
// from the drawer, which links it to a journal entry.
function JournalNeedsJournalingView({
  items,
  isLoading,
  error,
  onLoad,
  onOpenEvent,
  onDismiss,
  onSnooze,
  onBulkDismiss,
  bulkDismissBusy,
  eventActionState,
  formatValue,
}) {
  useEffect(() => {
    onLoad();
  }, [onLoad]);

  const busyId = eventActionState?.id;
  const isBusy = eventActionState?.busy;

  if (isLoading) {
    return (
      <section className="journal-card journal-needs-journaling">
        <p className="journal-muted">Loading journaling queue…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="journal-card journal-needs-journaling">
        <p className="journal-muted">Could not load the journaling queue.</p>
        <button type="button" className="journal-btn secondary" onClick={onLoad}>Retry</button>
      </section>
    );
  }

  if (!items || items.length === 0) {
    return (
      <JournalEmptyState
        title="Nothing needs journaling"
        description="When you execute or sync a decision-relevant trade, it shows up here so you can capture the thesis, emotion, and lesson while it's fresh."
        cta="Refresh"
        onAction={onLoad}
      />
    );
  }

  return (
    <section className="journal-card journal-needs-journaling">
      <div className="journal-needs-head">
        <h2>Needs journaling</h2>
        <span className="journal-count-pill">{items.length}</span>
        <button
          type="button"
          className="journal-btn secondary journal-dismiss-all"
          onClick={onBulkDismiss}
          disabled={bulkDismissBusy || items.length === 0}
          aria-label="Dismiss all journal reminders"
        >
          {bulkDismissBusy ? "Dismissing…" : "Dismiss all"}
        </button>
      </div>
      <p className="journal-muted">Open decision-relevant events. Journal them while the trade is fresh, or snooze and revisit later.</p>
      <ul className="journal-event-list">
        {items.map((event) => {
          const notional = typeof event.notional === "number" ? event.notional : null;
          const occurred = event.occurredAt ? new Date(event.occurredAt) : null;
          return (
            <li key={event.id} className="journal-event-row">
              <button
                type="button"
                className="journal-event-main"
                onClick={() => onOpenEvent(event)}
                aria-label={`Open ${event.symbol || "event"} detail`}
              >
                <span className="journal-event-symbol">{event.symbol || "—"}</span>
                <span className="journal-event-meta">
                  {[event.side, event.eventType, event.assetType].filter(Boolean).join(" · ")}
                </span>
                {notional != null && (
                  <span className="journal-event-notional">{formatValue(notional, true)}</span>
                )}
                {occurred && (
                  <span className="journal-event-when">
                    {occurred.toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                )}
              </button>
              <span className="journal-event-actions">
                <button
                  type="button"
                  className="journal-btn ghost"
                  disabled={isBusy && busyId === event.id}
                  onClick={() => onSnooze(event, 1)}
                >
                  Snooze
                </button>
                <button
                  type="button"
                  className="journal-btn secondary"
                  disabled={isBusy && busyId === event.id}
                  onClick={() => onDismiss(event)}
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  className="journal-btn primary"
                  onClick={() => onOpenEvent(event)}
                >
                  Journal
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Phase 4: decision outcomes surface ─────────────────────────────────────
function DecisionOutcomesPanel({ formatValue = () => "" }) {
  const [items, setItems] = useState([]);
  const [aggregated, setAggregated] = useState({ byResult: {}, totalPnl: 0, winCount: 0, lossCount: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchDecisionOutcomes();
      setItems(Array.isArray(result.items) ? result.items : []);
      setAggregated(result.aggregated || { byResult: {}, totalPnl: 0, winCount: 0, lossCount: 0, total: 0 });
    } catch (err) {
      // Graceful: never block the rest of the review surface.
      setError(err?.message || "Could not load decision outcomes.");
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const safePnl = typeof aggregated.totalPnl === "number" ? aggregated.totalPnl : 0;
  const total = aggregated.total || 0;
  const reviewed = aggregated.total || 0; // outcomes endpoint only returns reviewed
  const unreviewed = 0; // backend outcome rows are reviewed-only; keep explicit for clarity

  // Distribution by symbol.
  const bySymbol = useMemo(() => {
    const acc = {};
    for (const it of items) {
      const sym = it.symbol || "—";
      acc[sym] = acc[sym] || { count: 0, pnl: 0, win: 0, loss: 0 };
      acc[sym].count += 1;
      const pnl = typeof it?.outcome?.pnl === "number" ? it.outcome.pnl : 0;
      acc[sym].pnl += pnl;
      if (pnl > 0) acc[sym].win += 1;
      if (pnl < 0) acc[sym].loss += 1;
    }
    return Object.entries(acc).sort((a, b) => b[1].pnl - a[1].pnl).slice(0, 8);
  }, [items]);

  // Distribution by setup / decision type (sourceType).
  const bySetup = useMemo(() => {
    const acc = {};
    for (const it of items) {
      const setup = it.sourceType || it.setup || "—";
      acc[setup] = acc[setup] || { count: 0, pnl: 0 };
      acc[setup].count += 1;
      acc[setup].pnl += typeof it?.outcome?.pnl === "number" ? it.outcome.pnl : 0;
    }
    return Object.entries(acc).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
  }, [items]);

  // Repeated mistakes.
  const mistakes = useMemo(() => {
    const acc = {};
    for (const it of items) {
      const tag = it?.outcome?.mistakeTag;
      if (!tag) continue;
      acc[tag] = acc[tag] || { count: 0, pnl: 0 };
      acc[tag].count += 1;
      acc[tag].pnl += typeof it?.outcome?.pnl === "number" ? it.outcome.pnl : 0;
    }
    return Object.entries(acc).sort((a, b) => b[1].count - a[1].count).slice(0, 6);
  }, [items]);

  const linkToThread = (it) => {
    if (it?.sourceId) {
      window.location.hash = `#/decisions/${encodeURIComponent(it.sourceId)}`;
    }
  };

  if (isLoading) {
    return (
      <div className="journal-card journal-outcomes">
        <div className="journal-section-head"><h3>Decision Outcomes</h3></div>
        <p className="journal-card-label">Loading outcomes…</p>
      </div>
    );
  }

  return (
    <div className="journal-card journal-outcomes">
      <div className="journal-section-head">
        <h3>Decision Outcomes</h3>
        <span>{error ? "unavailable" : `${reviewed} reviewed`}</span>
      </div>
      {error ? (
        <p className="journal-card-label">{error}</p>
      ) : (
        <>
          <div className="journal-review-summary">
            <div><span>Reviewed</span><strong>{reviewed}</strong></div>
            <div><span>Unreviewed</span><strong>{unreviewed}</strong></div>
            <div><span>Winning</span><strong className="positive">{aggregated.winCount}</strong></div>
            <div><span>Losing</span><strong className="negative">{aggregated.lossCount}</strong></div>
            <div><span>Total P&amp;L</span><strong className={safePnl >= 0 ? "positive" : "negative"}>{formatValue(safePnl, true)}</strong></div>
          </div>

          <h4 className="journal-outcomes-subhead">By symbol</h4>
          <div className="journal-compact-table">
            {bySymbol.length === 0 ? <p className="journal-card-label">No outcomes yet.</p> : bySymbol.map(([sym, v]) => (
              <div key={sym}>
                <span>{sym}</span>
                <span>{v.count}x</span>
                <strong className={v.pnl >= 0 ? "positive" : "negative"}>{formatValue(v.pnl, true)}</strong>
                <button type="button" className="journal-link" onClick={() => linkToThread({ sourceId: sym })}>view</button>
              </div>
            ))}
          </div>

          <h4 className="journal-outcomes-subhead">By setup / type</h4>
          <div className="journal-compact-table">
            {bySetup.length === 0 ? <p className="journal-card-label">No outcomes yet.</p> : bySetup.map(([setup, v]) => (
              <div key={setup}>
                <span>{setup}</span>
                <span>{v.count}x</span>
                <strong className={v.pnl >= 0 ? "positive" : "negative"}>{formatValue(v.pnl, true)}</strong>
              </div>
            ))}
          </div>

          {mistakes.length > 0 ? (
            <>
              <h4 className="journal-outcomes-subhead">Repeated mistakes</h4>
              <div className="journal-compact-table">
                {mistakes.map(([tag, v]) => (
                  <div key={tag}>
                    <span>{tag}</span>
                    <span>{v.count}x</span>
                    <strong className="negative">{formatValue(v.pnl, true)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

// Drawer for a single journal event: shows the normalized event detail and
// lets the user journal it (link to an entry), snooze, or dismiss.
function JournalEventDrawer({ event, isOpen, onClose, onJournal, onSnooze, onDismiss, onClassify, actionState }) {
  const [canonical, setCanonical] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState(null);
  const [reason, setReason] = useState("");

  // Fetch canonical event details whenever the drawer opens for a new event.
  useEffect(() => {
    if (!isOpen || !event?.id) return undefined;
    let cancelled = false;
    setIsDetailLoading(true);
    setDetailError(null);
    setClassifyError(null);
    setReason("");
    setCanonical(null);
    (async () => {
      try {
        const detail = await fetchJournalEvent(event.id);
        if (cancelled) return;
        if (!detail) {
          setDetailError("This event is no longer available.");
          return;
        }
        setCanonical(detail);
      } catch (err) {
        if (cancelled) return;
        // 404 => deleted/stale event; surface gracefully, keep list payload.
        if (err?.status === 404) {
          setDetailError("This event was removed or is no longer available.");
        } else {
          setDetailError(err?.message || "Could not load event details.");
        }
      } finally {
        if (!cancelled) setIsDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, event?.id]);

  const shown = canonical || event;
  if (!isOpen || !event) return null;
  const busy = actionState?.busy && actionState?.id === event.id;
  const notional = typeof shown.notional === "number" ? shown.notional : null;
  const occurred = shown.occurredAt ? new Date(shown.occurredAt) : null;
  const CLASSIFICATIONS = [
    { value: "decision_relevant", label: "Decision-relevant" },
    { value: "informational", label: "Informational" },
    { value: "noise", label: "Noise" },
  ];
  const currentClassification = shown.classification;
  const rows = [
    ["Event type", shown.eventType],
    ["Side", shown.side],
    ["Asset type", shown.assetType],
    ["Market type", shown.marketType],
    ["Platform", shown.platform],
    ["Quantity", shown.quantity != null ? String(shown.quantity) : "—"],
    ["Price", shown.price != null ? String(shown.price) : "—"],
    ["Notional", notional != null ? String(notional) : "—"],
    ["Occurred", occurred ? occurred.toLocaleString() : "—"],
    ["Classification", currentClassification],
    ["Status", shown.status],
  ].filter(([, value]) => value != null && value !== "");

  const handleClassify = async (classification) => {
    if (!onClassify || isClassifying || busy) return;
    setIsClassifying(true);
    setClassifyError(null);
    try {
      const updated = await onClassify(event, classification, reason);
      if (updated) setCanonical(updated);
      setReason("");
    } catch (err) {
      setClassifyError(err?.message || "Could not save classification.");
    } finally {
      setIsClassifying(false);
    }
  };

  return (
    <div className="journal-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="journal-detail-drawer"
        ref={undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${event.symbol || "Event"} journal detail`}
      >
        <div className="journal-drawer-head">
          <div>
            <span className="journal-card-label">{shown.assetType || "Event"}</span>
            <h3>{shown.symbol || "Untitled event"}</h3>
            <p>{occurred ? occurred.toLocaleDateString() : "—"} · <span className="journal-card-label">{shown.status}</span></p>
          </div>
          <button type="button" className="journal-kebab" onClick={onClose} aria-label="Close event detail">×</button>
        </div>
        {isDetailLoading ? (
          <div className="journal-drawer-section"><p className="journal-card-label">Loading event details…</p></div>
        ) : detailError ? (
          <div className="journal-drawer-section"><p className="journal-card-label">{detailError}</p></div>
        ) : (
          <>
            <section className="journal-drawer-section">
              <h4>Event detail</h4>
              {rows.map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{String(value)}</strong></div>
              ))}
            </section>
            <section className="journal-drawer-section">
              <h4>Classification</h4>
              <p className="journal-card-label">
                Current: <strong>{currentClassification || "unclassified"}</strong>
              </p>
              <div className="journal-classify-actions" role="group" aria-label="Classify event">
                {CLASSIFICATIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    className={`journal-btn ${currentClassification === c.value ? "primary" : "secondary"}`}
                    disabled={isClassifying || busy}
                    aria-pressed={currentClassification === c.value}
                    onClick={() => handleClassify(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <textarea
                className="journal-classify-reason"
                placeholder="Optional reason (why this classification?)"
                value={reason}
                maxLength={500}
                disabled={isClassifying || busy}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
              {classifyError ? <p className="journal-card-label journal-classify-error">{classifyError}</p> : null}
            </section>
          </>
        )}
        <div className="journal-drawer-actions">
          <button
            type="button"
            className="journal-btn primary"
            disabled={busy || isClassifying}
            onClick={() => onJournal(event, {})}
          >
            Mark journaled
          </button>
          <button
            type="button"
            className="journal-btn secondary"
            disabled={busy || isClassifying}
            onClick={() => onSnooze(event, 1)}
          >
            Snooze 1 day
          </button>
          <button
            type="button"
            className="journal-btn danger"
            disabled={busy || isClassifying}
            onClick={() => onDismiss(event)}
          >
            Dismiss
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── Phase 4/5: periodic reports view ────────────────────────────────────────
const REPORT_CADENCES = ["daily", "weekly", "quarterly", "half_year", "yearly"];

function JournalReportsView({ onToast = () => {}, formatValue = () => "" }) {
  const [reports, setReports] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await fetchJournalReports();
      setReports(Array.isArray(items) ? items : []);
    } catch (err) {
      setError(err?.message || "Failed to load reports.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async (cadence) => {
    setGenerating(cadence);
    try {
      const report = await generateJournalReport({ cadence });
      if (report) {
        setReports((prev) => {
          const without = prev.filter((r) => !(r.cadence === cadence && r.periodKey === report.periodKey));
          return [report, ...without];
        });
        onToast(`${cadence} report generated.`, "positive");
      }
    } catch (err) {
      onToast(err?.message || "Generate failed.", "error");
    } finally {
      setGenerating(null);
    }
  };

  const buildCsv = (report) => {
    const s = report?.summary || {};
    const rows = [
      ["Cadence", report?.cadence || ""],
      ["Period", report?.periodKey || ""],
      ["Total events", s.total ?? 0],
      ["Decision-relevant", (s.byClassification && s.byClassification.decision_relevant) ?? 0],
      ["Operational", (s.byClassification && s.byClassification.operational) ?? 0],
      ["Unknown", (s.byClassification && s.byClassification.unknown) ?? 0],
      ["Open", (s.byStatus && s.byStatus.open) ?? 0],
      ["Journaled", (s.byStatus && s.byStatus.journaled) ?? 0],
      ["Dismissed", (s.byStatus && s.byStatus.dismissed) ?? 0],
      ["Needs journaling", s.needsJournaling ?? 0],
      ["Decision notional", s.totalNotional ?? 0],
    ];
    return rows.map((r) => r.join(",")).join("\n");
  };

  const download = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = (report) => download(`journal-report-${report.cadence}-${report.periodKey}.csv`, buildCsv(report), "text/csv");
  const handleExportJson = (report) => download(`journal-report-${report.cadence}-${report.periodKey}.json`, JSON.stringify(report, null, 2), "application/json");
  const latestReportAt = reports
    .map((report) => report?.generatedAt || report?.createdAt || report?.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const reportFreshness = normalizeFreshnessStatus({
    generatedAt: latestReportAt,
    stale: !reports.length,
    refreshing: isLoading || Boolean(generating),
    sourceLabel: "Journal events backend",
    nextAction: reports.length ? "Review unjournaled events or export a report." : "Generate a report cadence.",
    maxFreshMinutes: 1440,
  });

  return (
    <section className="journal-reports-view">
      <CompactPageHeader
        className="journal-reports-head"
        eyebrow="Trade Journaling"
        title="Periodic Reports"
        description="Calendar-based digests (daily, weekly, quarterly, half-year, yearly) aggregated from your trade-journal events."
      />
      <DataFreshnessSummary {...reportFreshness} className="journal-reports-freshness" />
      <div className="journal-reports-generate-row">
        {REPORT_CADENCES.map((cadence) => (
          <Button
            key={cadence}
            type="button"
            variant="secondary"
            size="sm"
            disabled={generating === cadence}
            onClick={() => handleGenerate(cadence)}
          >
            {generating === cadence ? `Generating ${cadence}…` : `Generate ${cadence}`}
          </Button>
        ))}
      </div>
      <AsyncState
        status={isLoading ? "loading" : error ? "error" : reports.length ? "ready" : "empty"}
        error={error}
        onRetry={load}
        retryLabel="Reload reports"
        loading={<div className="journal-reports-loading">Loading report history…</div>}
        empty={
          <GuidedEmptyState
            eyebrow="Reports"
            title="No reports yet"
            description="Generate a daily, weekly, quarterly, half-year, or yearly digest to aggregate your trade-journal events for the current period."
            steps={["Pick a cadence above to generate the current period.", "Reports are idempotent and refresh as new events arrive."]}
            className="guided-empty-state--compact"
          />
        }
      >
        <div className="journal-reports-grid">
          {reports.map((report) => {
            const s = report?.summary || {};
            const freshness = normalizeFreshnessStatus({
              generatedAt: report?.generatedAt || report?.createdAt || report?.updatedAt,
              sourceLabel: "Trade-journal events",
              nextAction: Number(s.needsJournaling || 0) > 0 ? "Journal open events." : "Export or compare against the next period.",
              maxFreshMinutes: 1440,
            });
            return (
              <article key={`${report.cadence}-${report.periodKey}`} className="journal-report-card">
                <header className="journal-report-card-head">
                  <div>
                    <span className="journal-report-cadence">{report.cadence}</span>
                    <h4>{report.periodKey}</h4>
                  </div>
                  <ResponsiveActionBar
                    secondary={(
                      <>
                        <Button type="button" variant="secondary" size="sm" onClick={() => handleExportCsv(report)}>CSV</Button>
                        <Button type="button" variant="secondary" size="sm" onClick={() => handleExportJson(report)}>JSON</Button>
                      </>
                    )}
                  />
                </header>
                <DataFreshnessSummary {...freshness} className="journal-report-card-freshness" />
                <dl className="journal-report-metrics">
                  <div><dt>Events</dt><dd>{s.total ?? 0}</dd></div>
                  <div><dt>Decision-relevant</dt><dd>{s.byClassification?.decision_relevant ?? 0}</dd></div>
                  <div><dt>Needs journaling</dt><dd>{s.needsJournaling ?? 0}</dd></div>
                  <div><dt>Decision notional</dt><dd>{formatValue(s.totalNotional ?? 0, true)}</dd></div>
                </dl>
                {Array.isArray(s.topSymbols) && s.topSymbols.length ? (
                  <div className="journal-report-symbols">
                    <span className="zenin-eyebrow">Top symbols</span>
                    <div className="journal-report-symbol-chips">
                      {s.topSymbols.map((t, tsi) => (
                        <span key={`${t.symbol || "sym"}-${tsi}`} className="journal-report-symbol-chip">{t.symbol} · {t.count}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </AsyncState>
    </section>
  );
}

// ── Phase 6: journal settings / preferences ────────────────────────────────
function JournalSettingsView({ onToast = () => {} }) {
  const [prefs, setPrefs] = useState({ email: true, includeOperational: false, cadence: "weekly" });
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await fetchJournalPrefs();
        if (active && loaded) setPrefs(loaded);
      } catch {
        /* keep defaults */
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const update = async (patch) => {
    setSaving(true);
    try {
      const next = await saveJournalPrefs(patch);
      if (next) setPrefs(next);
      onToast("Journal preferences saved.", "positive");
    } catch (err) {
      onToast(err?.message || "Save failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <div className="journal-settings-loading">Loading preferences…</div>;

  return (
    <section className="journal-settings-view">
      <CompactPageHeader
        className="journal-settings-head"
        eyebrow="Trade Journaling"
        title="Journal Settings"
        description="Control journal-reminder emails and how operational trades are treated in digests."
      />
      <div className="journal-settings-list">
        <label className="journal-setting-row">
          <span>
            <strong>Email journal reminders</strong>
            <small>Send in-app detected trades to your email for journaling.</small>
          </span>
          <input
            type="checkbox"
            checked={Boolean(prefs.email)}
            disabled={saving}
            onChange={(e) => update({ email: e.target.checked })}
          />
        </label>
        <label className="journal-setting-row">
          <span>
            <strong>Include operational trades in digests</strong>
            <small>Show deposits, transfers, assignments, and expiries in reports.</small>
          </span>
          <input
            type="checkbox"
            checked={Boolean(prefs.includeOperational)}
            disabled={saving}
            onChange={(e) => update({ includeOperational: e.target.checked })}
          />
        </label>
        <div className="journal-setting-row">
          <span>
            <strong>Default report cadence</strong>
            <small>Period used when scheduling automatic digests.</small>
          </span>
          <select
            value={prefs.cadence || "weekly"}
            disabled={saving}
            onChange={(e) => update({ cadence: e.target.value })}
          >
            {REPORT_CADENCES.map((c) => (
              <option key={c} value={c}>{c.replace("_", "-")}</option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
