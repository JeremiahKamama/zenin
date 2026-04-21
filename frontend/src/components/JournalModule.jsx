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

  return (
    <div className="view-container journal-dashboard">
      <div className="portfolio-analytics-row journal-top-cards">
        <div className="metric-card glass">
          <label>Total Trades Taken</label>
          <div className="value">{analytics.totalTrades}</div>
        </div>
        <div className="metric-card glass">
          <label>Average Hold</label>
          <div className="value">{formatDurationFromDays(analytics.avgHoldDays)}</div>
        </div>
        <div className="metric-card glass">
          <label>Available Balance</label>
          <div className="value">{formatValue(availableBalance, true)}</div>
        </div>
        <div className="metric-card glass">
          <label>Total Account Equity</label>
          <div className="value">{formatValue(totalAccountEquity, true)}</div>
        </div>
        <div className="metric-card glass journal-winrate-card">
          <label>Win Rate</label>
          <div className="value">{analytics.winRate.toFixed(1)}%</div>
          <div className="journal-winrate-body">
            <div className="journal-winrate-chart">
              <Chart
                options={winLossOptions}
                series={winLossSeries.some((v) => v > 0) ? winLossSeries : [1, 1]}
                type="donut"
                height={120}
              />
            </div>
            <div className="journal-winrate-breakdown">
              <div><span className="dot win" /> Wins: {analytics.wins}</div>
              <div><span className="dot breakeven" /> Breakevens: {analytics.breakevens}</div>
              <div><span className="dot loss" /> Losses: {analytics.losses}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Trade Entry Journal</h2>
          <div className="asset-count">Structured notes with strategy, regime, and review context</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pagination-button" onClick={() => setJournalPage("entry")} disabled={journalPage === "entry"}>
              Entry Form
            </button>
            <button className="pagination-button" onClick={() => setJournalPage("saved")} disabled={journalPage === "saved"}>
              View Entries
            </button>
          </div>
        </div>
        {journalPage === "entry" ? (
          <>
            <div className="journal-report-table-wrap" style={{ marginBottom: "10px" }}>
              <table className="journal-report-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Trade Date</th>
                <th>Strategy</th>
                <th>Setup Tag</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="e.g. BTC" value={entryDraft.symbol} onChange={(e) => setEntryDraft((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} />
                </td>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="Execution date" value={entryDraft.tradeDate} onChange={(e) => setEntryDraft((p) => ({ ...p, tradeDate: e.target.value }))} />
                </td>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="e.g. Breakout" value={entryDraft.strategy} onChange={(e) => setEntryDraft((p) => ({ ...p, strategy: e.target.value }))} />
                </td>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="e.g. Pullback" value={entryDraft.setupTag} onChange={(e) => setEntryDraft((p) => ({ ...p, setupTag: e.target.value }))} />
                </td>
              </tr>
              <tr>
                <th>Market Regime</th>
                <th>Side / Qty</th>
                <th>Timeframe</th>
                <th>Emotion</th>
                <th>Confidence / Link</th>
              </tr>
              <tr>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="e.g. Risk-on" value={entryDraft.marketRegime} onChange={(e) => setEntryDraft((p) => ({ ...p, marketRegime: e.target.value }))} />
                </td>
                <td style={{ display: "grid", gap: 6 }}>
                  <input className="search-input" style={{ width: "100%" }} placeholder="BUY/SELL" value={entryDraft.side} onChange={(e) => setEntryDraft((p) => ({ ...p, side: e.target.value.toUpperCase() }))} />
                  <input className="search-input" style={{ width: "100%" }} type="number" min="0" placeholder="Quantity" value={entryDraft.quantity} onChange={(e) => setEntryDraft((p) => ({ ...p, quantity: e.target.value }))} />
                </td>
                <td>
                  <select className="search-input" style={{ width: "100%" }} value={entryDraft.timeframe} onChange={(e) => setEntryDraft((p) => ({ ...p, timeframe: e.target.value }))}>
                    <option value="intraday">Intraday</option>
                    <option value="swing">Swing</option>
                    <option value="position">Position</option>
                  </select>
                </td>
                <td>
                  <select className="search-input" style={{ width: "100%" }} value={entryDraft.emotion} onChange={(e) => setEntryDraft((p) => ({ ...p, emotion: e.target.value }))}>
                    <option value="neutral">Neutral</option>
                    <option value="confident">Confident</option>
                    <option value="fearful">Fearful</option>
                    <option value="fomo">FOMO</option>
                    <option value="disciplined">Disciplined</option>
                  </select>
                </td>
                <td style={{ display: "grid", gap: 6 }}>
                  <input className="search-input" style={{ width: "100%" }} type="number" min="1" max="10" placeholder="Confidence 1-10" value={entryDraft.confidence} onChange={(e) => setEntryDraft((p) => ({ ...p, confidence: Number(e.target.value) || 5 }))} />
                  <input className="search-input" style={{ width: "100%" }} placeholder="URL / screenshot" value={entryDraft.chartLink} onChange={(e) => setEntryDraft((p) => ({ ...p, chartLink: e.target.value }))} />
                </td>
              </tr>
              <tr>
                <th>Price</th>
                <th>Notional</th>
                <th>Market Type</th>
                <th colSpan={2}>Status</th>
              </tr>
              <tr>
                <td>
                  <input className="search-input" style={{ width: "100%" }} type="number" min="0" step="0.0001" placeholder="Execution price" value={entryDraft.price} onChange={(e) => setEntryDraft((p) => ({ ...p, price: e.target.value }))} />
                </td>
                <td>
                  <input className="search-input" style={{ width: "100%" }} type="number" min="0" step="0.01" placeholder="Trade notional" value={entryDraft.notional} onChange={(e) => setEntryDraft((p) => ({ ...p, notional: e.target.value }))} />
                </td>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="spot/options/equity" value={entryDraft.marketType} onChange={(e) => setEntryDraft((p) => ({ ...p, marketType: e.target.value }))} />
                </td>
                <td colSpan={2}>
                  <input className="search-input" style={{ width: "100%" }} placeholder="Filled / Open / Closed" value={entryDraft.status} onChange={(e) => setEntryDraft((p) => ({ ...p, status: e.target.value }))} />
                </td>
              </tr>
              <tr>
                <th>Mistake Category</th>
                <th colSpan={3}>What I Learned</th>
              </tr>
              <tr>
                <td>
                  <input className="search-input" style={{ width: "100%" }} placeholder="e.g. Oversized" value={entryDraft.mistakeCategory} onChange={(e) => setEntryDraft((p) => ({ ...p, mistakeCategory: e.target.value }))} />
                </td>
                <td colSpan={3}>
                  <input className="search-input" style={{ width: "100%" }} placeholder="Key lesson from this setup" value={entryDraft.learned} onChange={(e) => setEntryDraft((p) => ({ ...p, learned: e.target.value }))} />
                </td>
              </tr>
              <tr>
                <th colSpan={2}>Pre-Trade Thesis</th>
                <th colSpan={2}>Post-Trade Review</th>
              </tr>
              <tr>
                <td colSpan={2}>
                  <textarea className="search-input" style={{ width: "100%" }} rows={3} placeholder="Why this trade made sense before entry" value={entryDraft.preThesis} onChange={(e) => setEntryDraft((p) => ({ ...p, preThesis: e.target.value }))} />
                </td>
                <td colSpan={2}>
                  <textarea className="search-input" style={{ width: "100%" }} rows={3} placeholder="What happened and what to improve next" value={entryDraft.postReview} onChange={(e) => setEntryDraft((p) => ({ ...p, postReview: e.target.value }))} />
                </td>
              </tr>
            </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="pagination-button" onClick={addJournalEntry}>
                {editingEntryId ? "Update Journal Entry" : "Save Journal Entry"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gap: "8px" }}>
            {filteredJournalEntries.slice(0, 50).map((entry) => (
              <div key={entry.id} style={{ border: "1px solid rgba(148,163,184,0.14)", borderRadius: "10px", padding: "10px", background: "rgba(15,23,42,0.4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "12px", color: "#e2e8f0", fontWeight: 600 }}>
                    {entry.symbol || "N/A"} · {entry.strategy || "Unspecified strategy"} · {entry.side || "—"} {entry.quantity || 0}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>{new Date(entry.createdAt || Date.now()).toLocaleString()}</div>
                    <button
                      className="pagination-button"
                      onClick={() => {
                        setEntryDraft({
                          sourceTradeKey: entry.sourceTradeKey || "",
                          symbol: entry.symbol || "",
                          tradeDate: entry.tradeDate || "",
                          side: entry.side || "",
                          quantity: entry.quantity || "",
                          price: entry.price || "",
                          notional: entry.notional || "",
                          marketType: entry.marketType || "",
                          status: entry.status || "",
                          strategy: entry.strategy || "",
                          setupTag: entry.setupTag || "",
                          marketRegime: entry.marketRegime || "",
                          timeframe: entry.timeframe || "intraday",
                          emotion: entry.emotion || "neutral",
                          confidence: entry.confidence || 5,
                          preThesis: entry.preThesis || "",
                          postReview: entry.postReview || "",
                          mistakeCategory: entry.mistakeCategory || "",
                          learned: entry.learned || "",
                          chartLink: entry.chartLink || ""
                        });
                        setEditingEntryId(entry.id);
                        setJournalPage("entry");
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                  {entry.marketType || "—"} · {entry.status || "—"} · {formatValue(entry.notional || 0, true)} · {entry.tradeDate ? new Date(entry.tradeDate).toLocaleString() : "No trade date"}
                </div>
                {entry.preThesis ? <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "6px" }}><strong>Thesis:</strong> {entry.preThesis}</div> : null}
                {entry.postReview ? <div style={{ fontSize: "12px", color: "#cbd5e1", marginTop: "4px" }}><strong>Review:</strong> {entry.postReview}</div> : null}
              </div>
            ))}
            {filteredJournalEntries.length === 0 ? (
              <div className="empty-state" style={{ padding: "20px", color: "#64748b" }}>No saved entries yet. Execute a trade or add one manually.</div>
            ) : null}
          </div>
        )}
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Analytics</h2>
        </div>
        <div className="journal-stats-grid">
          {statsRows.map((stat) => (
            <div key={stat.label} className="journal-stat-card">
              <span className="journal-stat-label">{stat.label}</span>
              <span className="journal-stat-value">{formatValue(stat.value, stat.currency)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Weekly / Monthly Review</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px" }}>
          <div className="journal-stat-card">
            <span className="journal-stat-label">Weekly Win/Loss</span>
            <span className="journal-stat-value">{weeklyMonthlyReview.weekly.wins}/{weeklyMonthlyReview.weekly.losses}</span>
            <span className="journal-stat-label">PF {weeklyMonthlyReview.weekly.profitFactor.toFixed(2)} · Exp {weeklyMonthlyReview.weekly.expectancy.toFixed(2)}</span>
          </div>
          <div className="journal-stat-card">
            <span className="journal-stat-label">Monthly Win/Loss</span>
            <span className="journal-stat-value">{weeklyMonthlyReview.monthly.wins}/{weeklyMonthlyReview.monthly.losses}</span>
            <span className="journal-stat-label">PF {weeklyMonthlyReview.monthly.profitFactor.toFixed(2)} · Exp {weeklyMonthlyReview.monthly.expectancy.toFixed(2)}</span>
          </div>
          <div className="journal-stat-card">
            <span className="journal-stat-label">Journal Notes</span>
            <span className="journal-stat-value">{journalEntries.length}</span>
            <span className="journal-stat-label">Searchable with strategy, emotion, and thesis text.</span>
          </div>
        </div>
      </div>

      <div className="journal-grid">
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2>Recent Executions</h2>
            <div className="asset-count">{executionRows.length} Records · {groupedExecutionRows.length} Rows</div>
          </div>
          <div className="trade-list">
            {pagedExecutionRows.length > 0 ? (
              pagedExecutionRows.map((group) => {
                const trade = group.header;
                const isGrouped = (group.items || []).length > 1;
                const expanded = Boolean(expandedExecutionGroups[group.key]);
                return (
                <div key={group.key}>
                  <div
                    className="trade-item"
                    style={isGrouped ? { cursor: "pointer", borderLeft: "2px solid rgba(56,189,248,0.35)" } : undefined}
                    onClick={() => {
                      if (!isGrouped) return;
                      setExpandedExecutionGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }));
                    }}
                    title={isGrouped ? "Click to expand and view exact execution timestamps" : undefined}
                  >
                    <div className="trade-date greek">{trade.executionDate}</div>
                    <div className="trade-asset" style={{fontWeight: 700}}>
                      {trade.asset}
                      {isGrouped ? (
                        <span style={{ marginLeft: 8, fontSize: 11, color: "#7dd3fc" }}>
                          {expanded ? "▼" : "▶"} {group.items.length} executions
                        </span>
                      ) : null}
                    </div>
                    <div className={`trade-side ${trade.type === "BUY" ? "positive" : "negative"}`}>{trade.type}</div>
                    <div className="trade-price price">${(Number(trade.price) || 0).toFixed(2)}</div>
                    <div className="trade-details">
                      <div className="trade-meta">
                        {trade.type === "BUY" ? "" : "Proceeds "}{formatValue(Number(trade.notional) || 0, true)}
                        {isGrouped ? (
                          <span style={{ marginLeft: 8, color: "#94a3b8" }}>
                            (collapsible)
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  {isGrouped && expanded ? (
                    <div style={{ margin: "4px 0 10px 22px", paddingLeft: 10, borderLeft: "1px dashed rgba(148,163,184,0.25)", display: "grid", gap: 4 }}>
                      {group.items.map((row) => {
                        const exact = row?.executedAt ? new Date(row.executedAt).toLocaleString() : row.executionDate;
                        return (
                          <div key={`detail-${group.key}-${row.id || row.clientId || exact}`} style={{ fontSize: 12, color: "#94a3b8", display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span>{exact}</span>
                            <span>{row.type} · {formatValue(Number(row.notional) || 0, true)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )})
            ) : (
              <div className="empty-state" style={{padding: '40px', color: '#64748b'}}>
                No trades recorded yet. Confirm an order to see it in your journal.
              </div>
            )}
          </div>
          {executionRows.length > recentRowsPerPage ? (
            <div className="pagination-controls">
              <button
                className="pagination-button"
                onClick={() => setRecentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeRecentPage <= 1}
              >
                Previous
              </button>
              <div className="pagination-label">Page {safeRecentPage} of {recentTotalPages}</div>
              <button
                className="pagination-button"
                onClick={() => setRecentPage((prev) => Math.min(recentTotalPages, prev + 1))}
                disabled={safeRecentPage >= recentTotalPages}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Calendar PnL</h2>
        </div>
        <div className="calendar-controls">
          <div className="calendar-nav">
            <button className="pagination-button" onClick={() => moveCalendarYear(-1)}>« Year</button>
            <button className="pagination-button" onClick={() => moveCalendarMonth(-1)}>‹ Month</button>
            <div className="pagination-label">{calendarMonthLabel}</div>
            <button className="pagination-button" onClick={() => moveCalendarMonth(1)}>Month ›</button>
            <button className="pagination-button" onClick={() => moveCalendarYear(1)}>Year »</button>
          </div>
          <div className="calendar-symbols-row">
            <button
              className={`pagination-button ${selectedSymbols.length > 0 ? "active" : ""}`}
              onClick={() => setIsSymbolsDropdownOpen((prev) => !prev)}
            >
              {symbolsButtonLabel}
            </button>
          </div>
          {isSymbolsDropdownOpen && (
            <div className="calendar-symbol-dropdown">
              <div className="calendar-symbol-search">
                <input
                  className="search-input"
                  placeholder="Search traded assets..."
                  value={calendarSearch}
                  onChange={(e) => setCalendarSearch(e.target.value)}
                />
              </div>
              <div className="calendar-symbol-checklist">
                {filteredSymbolSearch.length > 0 ? (
                  filteredSymbolSearch.slice(0, 30).map((symbol) => (
                    <label key={symbol} className="calendar-check-item">
                      <input
                        type="checkbox"
                        checked={selectedSymbols.includes(symbol)}
                        onChange={() => toggleCalendarSymbol(symbol)}
                      />
                      <span>{symbol}</span>
                    </label>
                  ))
                ) : (
                  <span className="meta">No traded symbols found.</span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="calendar-grid-header">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {calendarCells.map((cell) => {
            if (cell.type === "blank") {
              return <div key={cell.key} className="calendar-cell blank" />;
            }
            return (
              <div key={cell.key} className={`calendar-cell ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>
                <div className={`calendar-day ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>{cell.dayNum}</div>
                {cell.pnl != null && (
                  <div className={`calendar-pnl ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>
                    {cell.pnl >= 0 ? "+" : ""}
                    {formatValue(cell.pnl, true)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Traded Assets Report</h2>
          <div className="report-header-meta">
            <div className="asset-count">
              {analytics.tradedAssetsReport.length} Assets
              {lastReportPriceRefreshAt ? ` · Prices refreshed ${new Date(lastReportPriceRefreshAt).toLocaleString()}` : ""}
            </div>
            <div className="export-menu-anchor" ref={exportMenuRef}>
              <button
                className="pagination-button"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                disabled={analytics.tradedAssetsReport.length === 0}
                title="Export traded assets report"
              >
                Export
              </button>
              {isExportMenuOpen && analytics.tradedAssetsReport.length > 0 ? (
                <div className="export-menu">
                  <button className="pagination-button" onClick={() => { exportTradedAssetsToPdf(); setIsExportMenuOpen(false); }}>
                    PDF
                  </button>
                  <button className="pagination-button" onClick={() => { exportTradedAssetsToExcel(); setIsExportMenuOpen(false); }}>
                    Excel
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {analytics.tradedAssetsReport.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px", color: "#64748b" }}>
            No traded assets yet.
          </div>
        ) : (
          <>
            <div className="journal-report-table-wrap">
              <table className="journal-report-table">
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
                  {pagedReportRows.map((row) => (
                    <tr key={row.reportKey || row.symbol}>
                      <td>
                        {row.symbol}
                        {row.isOption && row.strategy && (
                          <div style={{ fontSize: "10px", color: "var(--color-text-secondary)", opacity: 0.8 }}>
                            {row.strategy}
                          </div>
                        )}
                      </td>
                      <td>{row.assetClass}</td>
                      <td>{row.tradeCount}</td>
                      <td>{formatValue(row.tradedNotional, true)}</td>
                      <td>{Number(row.netPosition || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td>{row.winRate.toFixed(1)}%</td>
                      <td>{formatDurationFromDays(row.tradeDuration)}</td>
                      <td className={row.avgGain >= 0 ? "positive" : "negative"}>{formatValue(row.avgGain, true)}</td>
                      <td className={row.totalGain >= 0 ? "positive" : "negative"}>{formatValue(row.totalGain, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <button
                className="pagination-button"
                disabled={safeReportPage === 1}
                onClick={() => setReportPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="pagination-label">Page {safeReportPage} of {reportTotalPages}</div>
              <button
                className="pagination-button"
                disabled={safeReportPage === reportTotalPages}
                onClick={() => setReportPage((p) => Math.min(reportTotalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
