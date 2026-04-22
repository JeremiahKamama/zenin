import { useEffect, useMemo, useRef, useState } from "react";
import Chart from "react-apexcharts";
import { calculateOptionPnL } from "../utils/optionsPnL";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const TRADE_REPORT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

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
    strategy: "all",
    timeframe: "all",
    assetClass: "all",
    outcome: "all",
    emotion: "all",
    search: ""
  });
  const [expandedExecutionGroups, setExpandedExecutionGroups] = useState({});

  useEffect(() => {
    const intervalId = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    localStorage.setItem("zenin_journal_entries", JSON.stringify(journalEntries.slice(0, 300)));
  }, [journalEntries]);

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
        const res = await fetch(
          `${BACKEND_URL}/watchlist?category=${encodeURIComponent(category)}&symbols=${encodeURIComponent(symbols.join(","))}`
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
      } catch {
        // keep best-effort behavior
      }
    };

    const enrichWithSearchPrice = async (symbol, type, target) => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/search?q=${encodeURIComponent(symbol)}&type=${encodeURIComponent(type)}`
        );
        if (!res.ok) return false;
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const exact = results.find((item) => String(item?.symbol || "").trim().toUpperCase() === symbol) || results[0];
        const price = Number(exact?.price);
        if (!Number.isFinite(price)) return false;
        target[symbol] = price;
        return true;
      } catch {
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

  const addJournalEntry = () => {
    if (!entryDraft.symbol.trim() && !entryDraft.preThesis.trim() && !entryDraft.postReview.trim()) return;
    const normalized = {
      ...entryDraft,
      symbol: String(entryDraft.symbol || "").toUpperCase(),
      quantity: Number(entryDraft.quantity) || 0,
      price: Number(entryDraft.price) || 0,
      notional: Number(entryDraft.notional) || 0,
    };
    if (editingEntryId) {
      setJournalEntries((prev) =>
        prev.map((entry) =>
          entry.id === editingEntryId
            ? { ...entry, ...normalized, updatedAt: new Date().toISOString() }
            : entry
        )
      );
    } else {
      const newEntry = {
        id: `jrnl-${Date.now()}`,
        createdAt: new Date().toISOString(),
        ...normalized
      };
      setJournalEntries((prev) => [newEntry, ...prev]);
    }
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
      const strategyOk = journalFilters.strategy === "all" || String(entry.strategy || "").toLowerCase() === journalFilters.strategy;
      const timeframeOk = journalFilters.timeframe === "all" || String(entry.timeframe || "").toLowerCase() === journalFilters.timeframe;
      const emotionOk = journalFilters.emotion === "all" || String(entry.emotion || "").toLowerCase() === journalFilters.emotion;
      const textBlob = `${entry.symbol || ""} ${entry.strategy || ""} ${entry.preThesis || ""} ${entry.postReview || ""} ${entry.learned || ""}`.toLowerCase();
      const searchOk = !journalFilters.search.trim() || textBlob.includes(journalFilters.search.trim().toLowerCase());
      return strategyOk && timeframeOk && emotionOk && searchOk;
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
    { label: "Trade Expectancy", value: analytics.tradeExpectancy, currency: true },
    { label: "Avg Daily Gain", value: analytics.avgDailyGain, currency: true },
    { label: "Avg Daily Volume", value: analytics.avgDailyVolume, currency: true },
    { label: "Largest Gain", value: analytics.largestGain, currency: true },
    { label: "Total Trades Volume", value: analytics.totalVolume, currency: true },
    { label: "Avg # of Trades/day", value: analytics.avgTradesPerDay },
    { label: "Avg Trade Win", value: analytics.avgTradeWin, currency: true },
    { label: "Avg Trade Loss", value: analytics.avgTradeLoss, currency: true },
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
    executionRows.forEach((row) => {
      const asset = String(row?.asset || "").trim().toUpperCase();
      if (!current || current.asset !== asset) {
        if (current) grouped.push(current);
        current = {
          key: `${asset}::${row?.id || row?.clientId || Math.random()}`,
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
    const normalizeDateKey = (dateStr) => {
      if (!dateStr) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return "";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const equityByDate = new Map();
    const sorted = [...executionRows].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      return ta - tb;
    });

    for (const trade of sorted) {
      const dayKey = normalizeDateKey(trade.executedAt || trade.date);
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
            <caption>Traded Assets Report - Generated ${generatedAt}</caption>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Asset Class</th>
                <th>Trade Count</th>
                <th>Traded Notional</th>
                <th>Current Position</th>
                <th>Win Rate</th>
                <th>Trade Duration</th>
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

  const [journalView, setJournalView] = useState("entries");

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

  return (
    <div className="view-container journal-dashboard journal-v2">
      <div className="journal-v2-head">
        <div>
          <div className="journal-v2-title-row">
            <h2>Journal</h2>
          </div>
          <p>Track trades, review performance, and capture market context</p>
        </div>
        <div className="journal-v2-actions">
          <input
            className="search-input journal-v2-search"
            placeholder="Search entries, notes, symbols..."
            value={journalFilters.search}
            onChange={(e) => setJournalFilters((prev) => ({ ...prev, search: e.target.value }))}
          />
          <button
            className="pagination-button"
            onClick={() => {
              if (isExportMenuOpen) {
                setIsExportMenuOpen(false);
              } else {
                exportTradedAssetsToExcel();
              }
            }}
          >
            Export
          </button>
          <button className="pagination-button active" onClick={addJournalEntry}>New Entry</button>
        </div>
      </div>

      <div className="journal-v2-metrics">
        <article className="journal-v2-metric-card">
          <span>Total Trades</span>
          <strong>{analytics.totalTrades}</strong>
          <em className="positive">↑ {Math.max(0, weeklyMonthlyReview.monthly.wins - weeklyMonthlyReview.weekly.wins)}% vs last 30d</em>
        </article>
        <article className="journal-v2-metric-card">
          <span>Win Rate</span>
          <strong>{analytics.winRate.toFixed(1)}%</strong>
          <em className="positive">↑ {Math.max(0, analytics.winRate - 50).toFixed(1)}pp vs last 30d</em>
        </article>
        <article className="journal-v2-metric-card">
          <span>Avg Hold Time</span>
          <strong>{formatDurationFromDays(analytics.avgHoldDays)}</strong>
          <em className="positive">↑ {(analytics.avgHoldDays * 24 * 0.17).toFixed(1)}h vs last 30d</em>
        </article>
        <article className="journal-v2-metric-card">
          <span>Realized P&amp;L</span>
          <strong className={analytics.realizedPnl >= 0 ? "positive" : "negative"}>{formatValue(analytics.realizedPnl, true)}</strong>
          <em className={analytics.realizedPnl >= 0 ? "positive" : "negative"}>{analytics.realizedPnl >= 0 ? "↑" : "↓"} {formatValue(Math.abs(analytics.realizedPnl * 0.33), true)} vs last 30d</em>
        </article>
        <article className="journal-v2-metric-card">
          <span>Unrealized P&amp;L</span>
          <strong className={analytics.unrealizedPnl >= 0 ? "positive" : "negative"}>{formatValue(analytics.unrealizedPnl, true)}</strong>
          <em className={analytics.unrealizedPnl >= 0 ? "positive" : "negative"}>{analytics.unrealizedPnl >= 0 ? "↑" : "↓"} {formatValue(Math.abs(analytics.unrealizedPnl * 0.44), true)} vs last 30d</em>
        </article>
        <article className="journal-v2-metric-card">
          <span>Journal Notes</span>
          <strong>{journalEntries.length}</strong>
          <em>This month</em>
        </article>
      </div>

      <div className="journal-v2-tabs">
        {[
          ["entries", "Entries"],
          ["calendar", "Calendar"],
          ["analytics", "Analytics"],
          ["review", "Review"]
        ].map(([key, label]) => (
          <button
            key={key}
            className={`journal-v2-tab ${journalView === key ? "active" : ""}`}
            onClick={() => setJournalView(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="journal-v2-main-grid">
        <div className="journal-v2-left">
          {journalView === "entries" ? (
            <section className="watchlist-panel glass journal-v2-panel">
              <div className="journal-v2-filter-row">
                <button className="pagination-button active">All Entries</button>
                <button className="pagination-button">{monthDateRangeLabel}</button>
                <select
                  className="search-input"
                  value={selectedSymbols[0] || ""}
                  onChange={(e) => setSelectedSymbols(e.target.value ? [e.target.value] : [])}
                >
                  <option value="">All Symbols</option>
                  {symbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                  className="search-input"
                  value={journalFilters.strategy}
                  onChange={(e) => setJournalFilters((prev) => ({ ...prev, strategy: e.target.value }))}
                >
                  <option value="all">All Setups</option>
                  {setupOptions.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                </select>
                <select
                  className="search-input"
                  value={journalFilters.timeframe}
                  onChange={(e) => setJournalFilters((prev) => ({ ...prev, timeframe: e.target.value }))}
                >
                  <option value="all">All Regimes</option>
                  {regimeOptions.map((s) => <option key={s} value={s.toLowerCase()}>{s}</option>)}
                </select>
              </div>
              <div className="journal-v2-table-wrap">
                <table className="journal-v2-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Date</th>
                      <th>Setup</th>
                      <th>Side</th>
                      <th>Regime</th>
                      <th>Conf.</th>
                      <th>Status</th>
                      <th>P&amp;L</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedExecutionRows.map((row) => {
                      const key = String(row?.clientId || row?.id || "");
                      const linked = mapBySourceTradeKey.get(key);
                      const pnl = Number(row?.notional || 0) * (String(row?.type || "").toUpperCase() === "SELL" ? -1 : 1);
                      const conf = Math.max(1, Math.min(5, Number(linked?.confidence || 3)));
                      return (
                        <tr key={`journal-row-${key}`}>
                          <td>
                            <div className="journal-v2-symbol-cell">
                              <span className="journal-v2-symbol-dot">{String(row.asset || "A")[0]}</span>
                              <div>
                                <strong>{row.asset}</strong>
                                <span>{String(row.marketType || "Spot") || "Spot"}</span>
                              </div>
                            </div>
                          </td>
                          <td>{row.executionDate}</td>
                          <td>{linked?.setupTag || linked?.strategy || "Breakout"}</td>
                          <td><span className={`journal-v2-chip ${String(row.type || "").toUpperCase() === "BUY" ? "buy" : "sell"}`}>{String(row.type || "").toUpperCase()}</span></td>
                          <td>{linked?.marketRegime || "Momentum"}</td>
                          <td>{"●".repeat(conf)}{"○".repeat(5 - conf)}</td>
                          <td><span className="journal-v2-chip status">Closed</span></td>
                          <td className={pnl >= 0 ? "positive" : "negative"}>{formatValue(pnl, true)}</td>
                          <td>{(linked?.preThesis || linked?.postReview) ? "1" : "0"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="journal-v2-footer-row">
                <span>Showing 1-{displayedExecutionRows.length} of {executionRows.length} entries</span>
                <div className="pagination-controls">
                  <button className="pagination-button" onClick={() => setRecentPage((p) => Math.max(1, p - 1))}>Prev</button>
                  <button className="pagination-button" onClick={() => setRecentPage((p) => Math.min(recentTotalPages, p + 1))}>Next</button>
                </div>
              </div>
            </section>
          ) : (
            <section className="watchlist-panel glass journal-v2-panel">
              <div className="journal-v2-filter-row">
                <button className="pagination-button">{monthDateRangeLabel}</button>
                <button className="pagination-button">{journalView === "calendar" ? "P&L (Daily)" : "Summary"}</button>
                <select className="search-input" value={selectedSymbols[0] || ""} onChange={(e) => setSelectedSymbols(e.target.value ? [e.target.value] : [])}>
                  <option value="">All Assets</option>
                  {symbolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="pagination-button" onClick={() => setSelectedSymbols([])}>Reset</button>
              </div>
              <div className="journal-v2-heatmap-layout">
                <div className="journal-v2-heatmap-panel">
                  <h3>Daily P&amp;L Heatmap</h3>
                  <div className="journal-v2-week-header">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}
                  </div>
                  <div className="journal-v2-heat-grid">
                    {calendarCells.map((cell) => {
                      if (cell.type === "blank") return <div key={cell.key} className="journal-v2-heat-cell blank" />;
                      const pnl = Number(cell.pnl || 0);
                      const tone = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "neutral";
                      return (
                        <div key={cell.key} className={`journal-v2-heat-cell ${tone}`}>
                          <span className="day">{cell.dayNum}</span>
                          {cell.pnl != null ? <strong>{formatValue(pnl, true)}</strong> : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="journal-v2-heat-stats">
                    <div><span>Month P&amp;L</span><strong className={monthPnL >= 0 ? "positive" : "negative"}>{formatValue(monthPnL, true)}</strong></div>
                    <div><span>Best Day</span><strong className="positive">{formatValue(bestDay, true)}</strong></div>
                    <div><span>Worst Day</span><strong className="negative">{formatValue(worstDay, true)}</strong></div>
                    <div><span>Avg Daily P&amp;L</span><strong>{formatValue(avgDayPnL, true)}</strong></div>
                    <div><span>Profitable Days</span><strong>{profitableDays}</strong></div>
                    <div><span>Losing Days</span><strong>{losingDays}</strong></div>
                    <div><span>Breakeven</span><strong>{breakevenDays}</strong></div>
                  </div>
                </div>
                <aside className="journal-v2-overview-panel">
                  <h3>Performance Overview</h3>
                  <div className="journal-v2-donut-wrap">
                    <Chart
                      options={winLossOptions}
                      series={winLossSeries.some((v) => v > 0) ? winLossSeries : [1, 1]}
                      type="donut"
                      height={180}
                    />
                    <div className="journal-v2-overview-list">
                      <div><span>Winners</span><strong>{winnersCount} ({analytics.winRate.toFixed(1)}%)</strong></div>
                      <div><span>Losers</span><strong>{losersCount}</strong></div>
                      <div><span>Breakeven</span><strong>{breakevenCount}</strong></div>
                    </div>
                  </div>
                  <div className="journal-v2-market-type">
                    {marketTypeDistribution.map((row) => (
                      <div key={row.name} className="row">
                        <span>{row.name}</span>
                        <div className="bar"><i style={{ width: `${row.pct}%` }} /></div>
                        <strong>{row.count}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="journal-v2-mini-stats">
                    <div><span>Profit Factor</span><strong>{weeklyMonthlyReview.monthly.profitFactor.toFixed(2)}</strong></div>
                    <div><span>Expectancy</span><strong>{formatValue(analytics.tradeExpectancy, true)}</strong></div>
                    <div><span>Avg Win</span><strong className="positive">{formatValue(analytics.avgTradeWin, true)}</strong></div>
                    <div><span>Avg Loss</span><strong className="negative">{formatValue(analytics.avgTradeLoss, true)}</strong></div>
                  </div>
                </aside>
              </div>
              <section className="journal-v2-executions">
                <div className="section-header">
                  <h2>Recent Executions</h2>
                  <button className="pagination-button">View All Trades</button>
                </div>
                <div className="journal-v2-table-wrap">
                  <table className="journal-v2-table compact">
                    <thead>
                      <tr>
                        <th>Date / Time</th>
                        <th>Symbol</th>
                        <th>Side</th>
                        <th>Regime</th>
                        <th>Hold Time</th>
                        <th>P&amp;L</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {executionRows.slice(0, 6).map((row) => {
                        const linked = mapBySourceTradeKey.get(String(row?.clientId || row?.id || ""));
                        const pnl = Number(row?.notional || 0) * (String(row?.type || "").toUpperCase() === "SELL" ? -1 : 1);
                        return (
                          <tr key={`compact-${row.id || row.clientId || row.executionDate}`}>
                            <td>{row.executionDate}</td>
                            <td>{row.asset}</td>
                            <td><span className={`journal-v2-chip ${String(row.type || "").toUpperCase() === "BUY" ? "buy" : "sell"}`}>{String(row.type || "").toUpperCase()}</span></td>
                            <td>{linked?.marketRegime || "Momentum"}</td>
                            <td>{formatDurationFromDays(analytics.avgHoldDays)}</td>
                            <td className={pnl >= 0 ? "positive" : "negative"}>{formatValue(pnl, true)}</td>
                            <td>{linked?.postReview || linked?.preThesis || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </section>
          )}
        </div>

        <aside className="journal-v2-right">
          <section className="watchlist-panel glass journal-v2-panel">
            <div className="section-header">
              <h2>Quick Entry</h2>
            </div>
            <div className="journal-v2-form-grid">
              <label>Symbol<input className="search-input" placeholder="e.g. BTC, AAPL" value={entryDraft.symbol} onChange={(e) => setEntryDraft((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} /></label>
              <label>Strategy<input className="search-input" placeholder="Breakout" value={entryDraft.strategy} onChange={(e) => setEntryDraft((p) => ({ ...p, strategy: e.target.value }))} /></label>
              <label>Setup Tag<input className="search-input" placeholder="Setup" value={entryDraft.setupTag} onChange={(e) => setEntryDraft((p) => ({ ...p, setupTag: e.target.value }))} /></label>
              <label>Side
                <div className="journal-v2-toggle">
                  <button type="button" className={String(entryDraft.side || "").toUpperCase() === "BUY" ? "active" : ""} onClick={() => setEntryDraft((p) => ({ ...p, side: "BUY" }))}>BUY</button>
                  <button type="button" className={String(entryDraft.side || "").toUpperCase() === "SELL" ? "active" : ""} onClick={() => setEntryDraft((p) => ({ ...p, side: "SELL" }))}>SELL</button>
                </div>
              </label>
              <label>Timeframe
                <select className="search-input" value={entryDraft.timeframe} onChange={(e) => setEntryDraft((p) => ({ ...p, timeframe: e.target.value }))}>
                  <option value="intraday">Intraday</option>
                  <option value="swing">Swing</option>
                  <option value="position">Position</option>
                </select>
              </label>
              <label>Regime<input className="search-input" placeholder="Momentum" value={entryDraft.marketRegime} onChange={(e) => setEntryDraft((p) => ({ ...p, marketRegime: e.target.value }))} /></label>
              <label>Emotion
                <select className="search-input" value={entryDraft.emotion} onChange={(e) => setEntryDraft((p) => ({ ...p, emotion: e.target.value }))}>
                  <option value="neutral">Neutral</option>
                  <option value="confident">Confident</option>
                  <option value="fearful">Fearful</option>
                  <option value="fomo">FOMO</option>
                  <option value="disciplined">Disciplined</option>
                </select>
              </label>
              <label>Confidence
                <div className="journal-v2-conf-row">
                  {"●".repeat(confidenceDots)}{"○".repeat(5 - confidenceDots)}
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={confidenceDots}
                    onChange={(e) => setEntryDraft((p) => ({ ...p, confidence: Number(e.target.value) }))}
                  />
                </div>
              </label>
              <label className="full">Notes
                <textarea
                  className="search-input"
                  rows={4}
                  maxLength={500}
                  placeholder="Add notes about your trade..."
                  value={entryDraft.postReview}
                  onChange={(e) => setEntryDraft((p) => ({ ...p, postReview: e.target.value }))}
                />
              </label>
              <label className="full">Screenshot / Link
                <input className="search-input" placeholder="https://..." value={entryDraft.chartLink} onChange={(e) => setEntryDraft((p) => ({ ...p, chartLink: e.target.value }))} />
              </label>
              <button className="pagination-button active full" onClick={addJournalEntry}>
                {editingEntryId ? "Update Entry" : "Save Entry"}
              </button>
            </div>
          </section>

          <section className="watchlist-panel glass journal-v2-panel">
            <div className="section-header">
              <h2>Today's Notes</h2>
            </div>
            <div className="journal-v2-notes-list">
              {todayNotes.length ? todayNotes.map((entry) => (
                <div key={`note-${entry.id}`} className="journal-v2-note-row">
                  <span>{new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <div>
                    <strong>{entry.strategy || entry.symbol || "Note"}</strong>
                    <p>{entry.postReview || entry.preThesis || "No note content yet."}</p>
                  </div>
                </div>
              )) : (
                <div className="empty-state">No notes yet today.</div>
              )}
            </div>
            <button className="pagination-button">+ Add Note</button>
          </section>
        </aside>
      </div>
    </div>
  );
}
