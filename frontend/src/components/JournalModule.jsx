import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { loadWorkspaceCollection, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetch } from "../utils/zeninFetch";
import { CompactPageHeader, FilterPopover, GuidedEmptyState, InlineControlGroup, MetricStrip } from "./CompactWorkspaceUI";

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
  spotPrices = {}
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
  const [livePriceBySymbol, setLivePriceBySymbol] = useState({});
  const [lastReportPriceRefreshAt, setLastReportPriceRefreshAt] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);
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
    chartLink: ""
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
  const [journalView, setJournalView] = useState("entries");
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
  const drawerRef = useRef(null);
  const reviewComposerRef = useRef(null);
  const journalSyncReadyRef = useRef(false);

  const syncJournalCollection = (namespace, rows, limit = 500) => {
    saveWorkspaceCollection(namespace, rows, limit).catch((error) => {
      console.warn(`Workspace sync skipped for ${namespace}.`, error);
    });
  };

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
          setJournalEntries(entriesResult.items);
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
    localStorage.setItem("zenin_journal_entries", JSON.stringify(journalEntries.slice(0, 300)));
    if (journalSyncReadyRef.current) {
      syncJournalCollection("journal:entries", journalEntries.slice(0, 500), 500);
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
      (Array.isArray(trades) ? trades : []).forEach((trade, idx) => {
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
  }, [trades]);

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
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

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
    (Array.isArray(trades) ? trades : []).forEach((trade) => {
      const symbol = String(trade?.asset || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    (Array.isArray(portfolio) ? portfolio : []).forEach((holding) => {
      const symbol = String(holding?.symbol || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    return [...symbols];
  }, [trades, portfolio]);

  useEffect(() => {
    setReportPage(1);
    setRecentPage(1);
  }, [trades]);

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
    const normalizeSymbol = (value) => String(value || "UNKNOWN").trim().toUpperCase();
    const ordered = [...trades].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    const runningPosition = new Map();
    const rows = ordered.map((trade) => {
      const symbol = normalizeSymbol(trade.asset);
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
  }, [trades]);

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
      chartLink: ""
    });
    setEntryErrors({});
  };

  const addJournalEntry = () => {
    const nextErrors = {};
    if (!String(entryDraft.symbol || "").trim()) nextErrors.symbol = "Symbol is required.";
    if (!String(entryDraft.strategy || "").trim()) nextErrors.strategy = "Strategy is required.";
    if (!String(entryDraft.side || "").trim()) nextErrors.side = "Side is required.";
    setEntryErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      notify("Couldn't save entry. Try again.", "danger");
      return;
    }
    setSaveStatus("saving");
    const normalized = {
      ...entryDraft,
      symbol: String(entryDraft.symbol || "").toUpperCase(),
      quantity: Number(entryDraft.quantity) || 0,
      price: Number(entryDraft.price) || 0,
      notional: Number(entryDraft.notional) || 0,
      status: entryDraft.status || "Open",
      tradeDate: entryDraft.tradeDate || new Date().toISOString()
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
    const normalizeSymbol = (value) => String(value || "UNKNOWN").trim().toUpperCase();
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

    const sortedTrades = [...trades].sort((a, b) => {
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
      const asset = normalizeSymbol(trade.asset);
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
      const symbol = normalizeSymbol(holding.symbol);
      portfolioPositionMap.set(symbol, (portfolioPositionMap.get(symbol) || 0) + safeNum(holding.quantity));
    }

    const lastBuyPriceBySymbol = new Map();
    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      if (type !== "BUY") continue;
      const symbol = normalizeSymbol(trade.asset);
      const price = safeNum(trade.price);
      if (price > 0) {
        lastBuyPriceBySymbol.set(symbol, price);
      }
    }

    const portfolioPriceMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding.symbol);
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
      const symbol = normalizeSymbol(holding.symbol);
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
      realizedTrades: realized
    };
  }, [trades, portfolio, livePriceBySymbol, nowTs, activeOptionsTrades, multiChainCache, spotPrices]);

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

  const winLossSeries = [
    Math.max(analytics.wins, 0),
    Math.max(analytics.losses, 0)
  ];
  const winLossOptions = {
    chart: { type: "donut", background: "transparent" },
    labels: ["Wins", "Losses"],
    legend: { show: false },
    stroke: { show: false },
    dataLabels: { enabled: false },
    colors: ["#22c55e", "#ef4444"],
    plotOptions: { pie: { donut: { size: "70%" } } }
  };

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
      if (Number.isFinite(eq)) {
        // keep last execution equity snapshot of that day
        equityByDate.set(dayKey, eq);
      }
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (Number.isFinite(totalAccountEquity)) {
      equityByDate.set(todayKey, Number(totalAccountEquity));
    }

    const orderedDates = [...equityByDate.keys()].sort();
    const pnlByDate = new Map();
    let prevEquity = 10000; // Set initial balance instead of null so first day records PNL
    for (const day of orderedDates) {
      const eq = Number(equityByDate.get(day));
      if (!Number.isFinite(eq)) continue;
      pnlByDate.set(day, eq - prevEquity);
      prevEquity = eq;
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
    const pnl = calendarPnlByDate.get(key);
    return { type: "day", key, dayNum, pnl: Number.isFinite(pnl) ? pnl : null };
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
      if (selectedSymbols.length > 0 && !selectedSymbols.includes(String(row?.asset || "").toUpperCase())) return false;
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
  }, [executionRows, selectedSymbols, mapBySourceTradeKey, journalFilters]);

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

  const confidenceDots = Math.max(1, Math.min(5, Number(entryDraft.confidence) || 1));

  const buildTradeLogRow = (row, idx) => {
    const key = String(row?.clientId || row?.id || `execution-${idx}`);
    const linked = mapBySourceTradeKey.get(key);
    const side = String(row?.type || row?.side || linked?.side || "").toUpperCase() || "BUY";
    const pnl = Number(row?.notional || 0) * (side === "SELL" ? -1 : 1);
    const confidence = Math.max(1, Math.min(5, Number(linked?.confidence || 3)));
    return {
      id: linked?.id || key,
      sourceId: key,
      symbol: String(row?.asset || linked?.symbol || "—").toUpperCase(),
      assetType: String(row?.marketType || linked?.marketType || "Spot"),
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
    if (selectedSymbols.length && !selectedSymbols.includes(row.symbol)) return false;
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

  const enterReviewMode = () => {
    setIsReviewModeActive(true);
    requestAnimationFrame(() => {
      reviewComposerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reviewComposerRef.current?.focus();
    });
    notify("Review mode focused.", "info");
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
          onBack={() => setSelectedCalendarTradeDate("")}
          onNavigateDate={setSelectedCalendarTradeDate}
          onNewEntry={openNewEntry}
          onOpenDetail={openTradeDetail}
          formatValue={formatValue}
        />
      ) : (
        <>
          <JournalDebriefHeader
            syncTimestampLabel={syncTimestampLabel}
            exportMenuOpen={isExportMenuOpen}
            setExportMenuOpen={setIsExportMenuOpen}
            exportMenuRef={exportMenuRef}
            onExportChoice={handleExportChoice}
            onNewEntry={openNewEntry}
            onSaveSnapshot={saveReviewSnapshot}
            onJumpToReview={enterReviewMode}
            reviewModeActive={isReviewModeActive}
          />
          <JournalDecisionLayer
            debriefPnl={debriefPnl}
            ruleAdherence={ruleAdherence}
            emotionalDiscipline={emotionalDiscipline}
            primaryLesson={primaryLesson}
            reviewQueueItems={reviewQueueItems}
            onNewEntry={openNewEntry}
            onJumpToReview={enterReviewMode}
          />
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
            selectedDay={selectedDay}
            monthPnL={monthPnL}
            bestDay={bestDay}
            worstDay={worstDay}
            avgDayPnL={avgDayPnL}
            formatValue={formatValue}
            onSelectDay={setSelectedCalendarDay}
            onMoveMonth={moveCalendarMonth}
            onOpenDay={(day) => setSelectedCalendarTradeDate(String(day?.key || ""))}
            onOpenTrade={openTradeDetail}
            lessonRows={lessonRows}
            reviewNote={reviewNote}
            setReviewNote={setReviewNote}
            reviewComposerRef={reviewComposerRef}
            onSaveReview={saveReviewSnapshot}
            onAddToJournal={addReviewToJournal}
            onNewEntry={openNewEntry}
            reviewModeActive={isReviewModeActive}
          />
        </>
      )}

      <JournalQuickEntryDrawer
        open={isQuickEntryOpen}
        onClose={() => setIsQuickEntryOpen(false)}
        entryDraft={entryDraft}
        setEntryDraft={setEntryDraft}
        entryErrors={entryErrors}
        saveStatus={saveStatus}
        confidenceDots={confidenceDots}
        editingEntryId={editingEntryId}
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
  onJumpToReview,
  reviewModeActive = false
}) {
  return (
    <CompactPageHeader
      className="journal-debrief-head"
      eyebrow="Journal"
      title="Decision Ledger"
      description="A compact record of decision theses, evidence, outcomes, and follow-up reviews."
      actions={(
        <div className="journal-debrief-head-actions">
          <div className="journal-debrief-sync-box" aria-label={`Sync state ${syncTimestampLabel}`}>
            <span>Sync State</span>
            <strong>{syncTimestampLabel}</strong>
          </div>
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
            <button
              type="button"
              className={`journal-btn secondary ${reviewModeActive ? "active" : ""}`.trim()}
              onClick={onJumpToReview}
            >
              Review Mode
            </button>
            <button type="button" className="journal-btn primary" onClick={onSaveSnapshot}>Save Snapshot</button>
          </div>
        </div>
      )}
    />
  );
}

function JournalDecisionLayer({
  debriefPnl,
  ruleAdherence,
  emotionalDiscipline,
  primaryLesson,
  reviewQueueItems,
  onNewEntry,
  onJumpToReview
}) {
  const qualityScore = Math.round(
    [
      Number.isFinite(ruleAdherence) ? ruleAdherence : null,
      Number.isFinite(emotionalDiscipline) ? emotionalDiscipline : null,
      Number(debriefPnl || 0) >= 0 ? 72 : 48
    ].filter((value) => value != null).reduce((sum, value, _index, arr) => sum + value / arr.length, 0)
  );
  const templates = [
    ["Decision", "Record thesis, outcome, and mistake tags."],
    ["Research note", "Save the catalyst, variant view, and invalidation."],
    ["Risk decision", "Log sizing, exposure, and what would change your mind."],
    ["Post-mortem", "Turn the outcome into one rule to repeat or remove."]
  ];
  return (
    <section className="journal-decision-layer" aria-label="Decision ledger layer">
      <div className="journal-decision-primary">
        <span>Decision layer</span>
        <h3>Convert market work into reviewable decisions.</h3>
        <p>{primaryLesson || "Capture the decision, evidence, and next rule before the context fades."}</p>
        <div className="journal-decision-actions">
          <button type="button" className="journal-btn primary" onClick={onNewEntry}>Record decision</button>
          <button type="button" className="journal-btn secondary" onClick={onJumpToReview}>Review queue</button>
        </div>
      </div>
      <div className="journal-decision-score">
        <span>Decision quality</span>
        <strong>{Number.isFinite(qualityScore) ? `${qualityScore}%` : "—"}</strong>
        <small>{reviewQueueItems.length ? `${reviewQueueItems.length} follow-up${reviewQueueItems.length === 1 ? "" : "s"} waiting` : "No urgent follow-ups"}</small>
      </div>
      <div className="journal-decision-templates">
        {templates.map(([title, detail]) => (
          <button key={title} type="button" onClick={onNewEntry}>
            <strong>{title}</strong>
            <span>{detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function JournalDebriefDashboard({
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
  formatValue,
  onSelectDay,
  onMoveMonth,
  onOpenDay,
  onOpenTrade,
  lessonRows,
  reviewNote,
  setReviewNote,
  reviewComposerRef,
  onSaveReview,
  onAddToJournal,
  onNewEntry,
  reviewModeActive = false
}) {
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
            {reviewQueueItems.length ? reviewQueueItems.map((item) => (
              <div key={item.title} className={`journal-debrief-queue-item ${item.tone || "info"}`}>
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
                    <tr key={`${row.id || row.sourceId || row.symbol}-${index}`} onClick={() => onOpenTrade(row)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" ? onOpenTrade(row) : null}>
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
            {behaviorPatterns.map((item) => (
              <div key={item.label} className={`journal-debrief-pattern ${item.tone || "neutral"}`}>
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
              const tone = pnl > 300 ? "large-gain" : pnl > 0 ? "small-gain" : pnl < -300 ? "large-loss" : pnl < 0 ? "small-loss" : "neutral";
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
            <button type="button" className="journal-btn primary" onClick={onSaveReview}>Save Review</button>
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
    ["entries", "Entries"],
    ["calendar", "Calendar"],
    ["analytics", "Analytics"],
    ["review", "Review"]
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

function JournalFilters({ filters, setFilters, showMoreFilters, setShowMoreFilters, symbolOptions, setupOptions, regimeOptions, selectedSymbols, setSelectedSymbols, onReset }) {
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
      <label>
        <span>Symbol</span>
        <select value={selectedSymbols[0] || ""} onChange={(event) => setSelectedSymbols(event.target.value ? [event.target.value] : [])}>
          <option value="">All Symbols</option>
          {symbolOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
        </select>
      </label>
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
        <table className="journal-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Date</th>
              <th>Setup</th>
              <th>Side</th>
              <th>Regime</th>
              <th>Confidence</th>
              <th>Status</th>
              <th className="numeric">P&L</th>
              <th>Notes</th>
              <th className="numeric">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => onOpenDetail(row)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" ? onOpenDetail(row) : null}>
                <td><JournalSymbolCell row={row} /></td>
                <td>{row.date}</td>
                <td>{row.setup}</td>
                <td><JournalSideChip side={row.side} /></td>
                <td>{row.regime}</td>
                <td><ConfidenceDots value={row.confidence} /></td>
                <td><JournalStatusPill status={row.status} /></td>
                <td className={`numeric ${Number(row.pnl) >= 0 ? "positive" : "negative"}`}>{Number(row.pnl) >= 0 ? "+" : "-"}{formatValue(Math.abs(row.pnl), true)}</td>
                <td><span className="journal-notes-count" aria-label={`${row.notesCount} notes`}>▣ {row.notesCount}</span></td>
                <td className="numeric">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
  return (
    <div className="journal-symbol-cell">
      <span>{String(row.symbol || "A")[0]}</span>
      <div>
        <strong>{row.symbol}</strong>
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

function JournalCalendarView({ calendarMonthLabel, monthDateRangeLabel, calendarCells, selectedDay, selectedDayTrades, onSelectDay, onMoveMonth, onViewTrades, selectedSymbol, setSelectedSymbols, symbolOptions, monthPnL, bestDay, worstDay, avgDayPnL, profitableDays, losingDays, breakevenDays, formatValue }) {
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
    chart: { toolbar: { show: false }, foreColor: "#94A3B8", background: "transparent" },
    grid: { borderColor: "rgba(148,163,184,0.12)" },
    theme: { mode: "dark" },
    plotOptions: {
      bar: {
        borderRadius: 6,
        distributed: true
      }
    },
    colors: filteredRows.map((row) => Number(row.pnl || 0) >= 0 ? "#22C55E" : "#EF4444"),
    xaxis: {
      labels: {
        style: { colors: "#94A3B8", fontSize: "11px" }
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
          <div className="journal-breadcrumb">Journal <span>/</span> Calendar <span>/</span> View Decisions</div>
          <h3>Decisions for {dateKey || "Selected Day"}</h3>
        </div>
        <div className="journal-day-view-actions">
          <button type="button" className="journal-btn secondary" onClick={exportDayCsv}>Export</button>
          <button type="button" className="journal-btn primary" onClick={onNewEntry}>
            <span aria-hidden="true">+</span> Add New Entry
          </button>
        </div>
      </div>

      <div className="journal-day-toolbar">
        <button type="button" className="journal-btn secondary" onClick={onBack}>← Back to Calendar</button>
        <div className="journal-day-date-nav">
          <button type="button" className="journal-kebab" disabled={!previousDate} onClick={() => previousDate && onNavigateDate(previousDate)}>‹</button>
          <div>{dateKey || "—"}</div>
          <button type="button" className="journal-kebab" disabled={!nextDate} onClick={() => nextDate && onNavigateDate(nextDate)}>›</button>
        </div>
        <label className="journal-search journal-day-search">
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol, strategy, notes..." />
        </label>
      </div>

      <div className="journal-day-filter-row">
        <label>
          <select value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="all">All Assets</option>
            {assetOptions.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
          </select>
        </label>
        <label>
          <select value={setupFilter} onChange={(event) => setSetupFilter(event.target.value)}>
            <option value="all">All Strategies</option>
            {setupOptions.map((setup) => <option key={setup} value={setup}>{setup}</option>)}
          </select>
        </label>
        <label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All Statuses</option>
            <option value="closed">Closed</option>
            <option value="open">Open</option>
            <option value="review">Review</option>
          </select>
        </label>
        <label>
          <select value={marketFilter} onChange={(event) => setMarketFilter(event.target.value)}>
            <option value="all">Market Type</option>
            {marketOptions.map((market) => <option key={market} value={market}>{market}</option>)}
          </select>
        </label>
      </div>

      <div className="journal-day-summary-grid">
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Total P&amp;L</span>
          <strong className={totalPnl >= 0 ? "positive" : "negative"}>{formatValue(totalPnl, true)}</strong>
        </article>
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Decisions</span>
          <strong>{filteredRows.length}</strong>
        </article>
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Winners</span>
          <strong className="positive">{winners.length}</strong>
        </article>
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Losers</span>
          <strong className="negative">{losers.length}</strong>
        </article>
        <article className="journal-card journal-day-stat-card">
          <span className="journal-card-label">Win Rate</span>
          <strong>{winRate.toFixed(1)}%</strong>
        </article>
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
              {visibleRows.length ? visibleRows.map((row) => {
                const tradeTime = new Date(row.rawDate || row.date || Date.now());
                return (
                  <article key={row.id} className="journal-day-trade-row">
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
                <JournalEmptyState
                  title="No decisions match these filters"
                  description="Try adjusting the date filters or journal search to see more decisions."
                />
              )}
            </div>
          </section>
        </div>

        <aside className="journal-day-aside">
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

          <section className="journal-card">
            <div className="journal-section-head"><h3>Intraday P&amp;L by Decision</h3></div>
            {filteredRows.length ? (
              <Chart options={intradayOptions} series={intradaySeries} type="bar" height={220} />
            ) : (
              <p className="journal-day-empty-copy">No decision chart data for this day.</p>
            )}
          </section>

          <section className="journal-card">
            <div className="journal-section-head"><h3>Notes &amp; Review</h3></div>
            <div className="journal-day-notes-list">
              {notesBlocks.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <p>{item.value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="journal-card">
            <div className="journal-section-head"><h3>Attachments / Screenshots</h3></div>
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

function JournalQuickEntryPanel(props) {
  return (
    <div className="journal-card journal-quick-entry-card">
      <div className="journal-section-head">
        <div><h3>Quick Entry</h3><p>Log a decision in under a minute.</p></div>
      </div>
      <JournalQuickEntryForm {...props} />
      <div className="journal-today-notes">
        <h3>Today's Notes</h3>
        {props.todayNotes?.length ? props.todayNotes.map((entry) => (
          <div key={entry.id}>
            <span>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <strong>{entry.strategy || entry.symbol || "Note"}</strong>
            <p>{entry.postReview || entry.preThesis || "No note content yet."}</p>
          </div>
        )) : <p>No notes yet today.</p>}
      </div>
    </div>
  );
}

function JournalQuickEntryDrawer({ open, onClose, ...props }) {
  if (!open) return null;
  return (
    <div className="journal-drawer-backdrop" onMouseDown={onClose}>
      <aside className="journal-mobile-entry-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="New journal entry">
        <div className="journal-drawer-head">
          <div><h3>Quick Entry</h3><p>Log a decision in under a minute.</p></div>
          <button type="button" className="journal-kebab" onClick={onClose} aria-label="Close quick entry">×</button>
        </div>
        <JournalQuickEntryForm {...props} />
      </aside>
    </div>
  );
}

function JournalQuickEntryForm({ entryDraft, setEntryDraft, entryErrors, saveStatus, confidenceDots, editingEntryId, onSave }) {
  const requiredValid = String(entryDraft.symbol || "").trim() && String(entryDraft.strategy || "").trim() && String(entryDraft.side || "").trim();
  const setField = (field, value) => setEntryDraft((prev) => ({ ...prev, [field]: value }));
  return (
    <form className="journal-quick-form" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <JournalField label="Symbol" error={entryErrors.symbol}>
        <input value={entryDraft.symbol} onChange={(event) => setField("symbol", event.target.value.toUpperCase())} aria-invalid={!!entryErrors.symbol} />
      </JournalField>
      <JournalField label="Strategy" error={entryErrors.strategy}>
        <input value={entryDraft.strategy} onChange={(event) => setField("strategy", event.target.value)} aria-invalid={!!entryErrors.strategy} />
      </JournalField>
      <JournalField label="Setup Tag">
        <input value={entryDraft.setupTag} onChange={(event) => setField("setupTag", event.target.value)} />
      </JournalField>
      <JournalField label="Decision" error={entryErrors.side}>
        <div className="journal-side-toggle">
          <button type="button" className={entryDraft.side === "BUY" ? "buy active" : ""} onClick={() => setField("side", "BUY")}>Increase</button>
          <button type="button" className={entryDraft.side === "SELL" ? "sell active" : ""} onClick={() => setField("side", "SELL")}>Reduce</button>
        </div>
      </JournalField>
      <JournalField label="Timeframe"><select value={entryDraft.timeframe} onChange={(event) => setField("timeframe", event.target.value)}><option value="intraday">Intraday</option><option value="swing">Swing</option><option value="position">Position</option></select></JournalField>
      <JournalField label="Regime"><input value={entryDraft.marketRegime} onChange={(event) => setField("marketRegime", event.target.value)} /></JournalField>
      <JournalField label="Emotion"><select value={entryDraft.emotion} onChange={(event) => setField("emotion", event.target.value)}><option value="neutral">Neutral</option><option value="confident">Confident</option><option value="fearful">Fearful</option><option value="fomo">FOMO</option><option value="disciplined">Disciplined</option></select></JournalField>
      <JournalField label={`Confidence ${confidenceDots}/5`}>
        <div className="journal-confidence-slider">
          <span>Low</span>
          <input aria-label="Confidence" type="range" min={1} max={5} step={1} value={confidenceDots} onChange={(event) => setField("confidence", Number(event.target.value))} />
          <span>High</span>
        </div>
      </JournalField>
      <JournalField label="Notes" wide><textarea rows={4} value={entryDraft.postReview} onChange={(event) => setField("postReview", event.target.value)} /></JournalField>
      <JournalField label="Screenshot / Link" wide><input value={entryDraft.chartLink} onChange={(event) => setField("chartLink", event.target.value)} /></JournalField>
      <button type="submit" className="journal-btn primary full" disabled={!requiredValid || saveStatus === "saving"}>
        {saveStatus === "saving" ? "Saving..." : editingEntryId ? "Update Entry" : "Save Entry"}
      </button>
    </form>
  );
}

function JournalField({ label, error, wide, children }) {
  return (
    <label className={wide ? "wide" : ""}>
      <span>{label}</span>
      {children}
      {error ? <small className="journal-field-error">{error}</small> : null}
    </label>
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
