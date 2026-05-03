// src/components/AnalyticsModule.jsx
import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { formatCurrency, getCurrencySymbol, convertToUSD } from "../utils/currencyUtils";
import { AssetModal } from "./AssetModal";

const CATEGORY_TABS = [
  { id: "crypto", label: "Crypto", icon: "C", description: "Hyperliquid, Bybit, Binance + Dune analytics" },
  { id: "options", label: "Options", icon: "O", description: "Binance + Deribit options data" },
  { id: "equities", label: "Equities", icon: "E", description: "Asset Classes, Industries, Regions" },
  { id: "macro", label: "Macro", icon: "M", description: "Macro indicators, FX and risk context" },
  { id: "commodities", label: "Commodities", icon: "X", description: "Commodities hub, flows, inventory and curve" },
];

const EMPTY_CRYPTO = {
  updatedAt: null,
  perpMetrics: [],
  kimchiPremium: null,
  etfInflows: [],
  perpVolumeByProtocol: [],
  revenueByProtocol: [],
  optionsVolumeByAsset: [],
  optionsMaxPain: [],
  perpsMarketShare: [],
  perpsOverview: [],
};

const EMPTY_OPTIONS = {
  updatedAt: null,
  totalOptionsOpenInterestUsd: null,
  optionsVolumeByAsset: [],
  optionsMaxPain: [],
  volumeByExchangeRoute: [],
  greeks: [],
  oiByStrike: [],
};

const EMPTY_EQUITIES = {
  updatedAt: null,
  benchmarkIndexHistory: [],
  benchmarkPerformance: [],
  sectorPerformance: [],
  regionalPerformance: [],
  styleFactors: [],
  rebalanceSignals: [],
  correlationLabels: [],
  correlationMatrix: [],
  volatilityMetrics: [],
  dividendData: [],
  earningsCalendar: [],
  valuationData: [],
  macroData: [],
  fundFlows: [],
  fxRates: [],
  marketBreadth: null,
  riskIndicators: [],
  corporateActions: [],
  annualReturns: [],
  reitData: { benchmarks: [] },
  mmfYields: [],
  fundsList: [],
};

const EMPTY_EQUITIES_SPEC = {
  overview: null,
  categories: [],
  searchResults: [],
  stocks: [],
  stockDetails: null,
  stockPeers: [],
  stockFundamentals: [],
  stockMarketContext: [],
  funds: [],
  fundDetail: null,
  fundCompare: [],
  fundHoldings: [],
  fundRisk: [],
  fundFlows: [],
  mmf: [],
  mmfDetail: null,
  mmfYieldHistory: [],
  mmfLiquidity: [],
  mmfComposition: [],
  reits: [],
  reitDetail: null,
  reitCompare: [],
  reitExposure: [],
  reitIncome: [],
  marketSnapshot: [],
  marketBenchmarks: [],
  marketSectors: [],
  marketRegions: [],
  marketBreadth: null,
  marketActions: [],
};

const EMPTY_MACRO = {
  updatedAt: null,
  macroData: [],
  fxRates: [],
  forexMovers: { gainers: [], losers: [] },
  riskIndicators: [],
};

const EMPTY_COMMODITIES = {
  updatedAt: null,
  overview: null,
  list: [],
  priceSeries: [],
  fundamentals: [],
  flows: [],
  seasonality: [],
  curve: [],
  compare: [],
  calendar: [],
  alerts: [],
  correlation: [],
};

const COMMODITY_GROUPS = ["all", "energy", "metals", "agriculture", "fertilizers", "industrial", "battery", "soft", "livestock"];
const COMMODITY_VIEWS = ["price", "flows", "seasonality", "curve", "compare"];

const MACRO_CATEGORY_OPTIONS = [
  { key: "growth", label: "Growth" },
  { key: "inflation", label: "Inflation" },
  { key: "labor", label: "Labor" },
  { key: "rates", label: "Rates" },
  { key: "external", label: "External" },
  { key: "fiscal", label: "Fiscal" },
  { key: "credit", label: "Credit" },
  { key: "sentiment", label: "Sentiment" },
];

const MACRO_VIEW_OPTIONS = [
  { key: "chart", label: "Chart" },
  { key: "compare", label: "Compare" },
  { key: "map", label: "Map" },
  { key: "calendar", label: "Calendar" },
  { key: "ranking", label: "Ranking" },
  { key: "forecast", label: "Forecast" },
];

const FALLBACK_MACRO_GEOS = [
  { type: "Country", name: "United States", code: "USA", regionCode: "NAM", members: [], parent: "Global" },
  { type: "Country", name: "Germany", code: "DEU", regionCode: "EUR", members: [], parent: "Europe" },
  { type: "Country", name: "Japan", code: "JPN", regionCode: "ASI", members: [], parent: "Asia" },
  { type: "Country", name: "Kenya", code: "KEN", regionCode: "AFR", members: [], parent: "Africa" },
  { type: "Region", name: "North America", code: "NAM", members: ["USA", "CAN", "MEX"], parent: "Global" },
  { type: "Region", name: "Europe", code: "EUR", members: ["DEU", "FRA", "ITA"], parent: "Global" },
  { type: "Region", name: "Asia", code: "ASI", members: ["JPN", "CHN", "IND"], parent: "Global" },
  { type: "Global", name: "Global Aggregate", code: "GLB", members: [], parent: null },
];

const FALLBACK_MACRO_INDICATORS = [
  { code: "GDP_GROWTH_YOY", name: "GDP Growth YoY", category: "growth", unit: "%" },
  { code: "CPI_YOY", name: "CPI Inflation YoY", category: "inflation", unit: "%" },
  { code: "UNEMP_RATE", name: "Unemployment Rate", category: "labor", unit: "%" },
  { code: "POLICY_RATE", name: "Policy Rate", category: "rates", unit: "%" },
  { code: "PMI_MANUFACTURING", name: "Manufacturing PMI", category: "sentiment", unit: "idx" },
];

function formatMoney(value, currency = "USD") {
  return formatCurrency(value, currency);
}

function formatCompactMoney(value, currency = "USD") {
  return formatCurrency(value, currency, { compact: true });
}

function formatPercent(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MiniSparkline({ points = [], width = 92, height = 24, color = "#38bdf8" }) {
  const values = (Array.isArray(points) ? points : []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (values.length < 2) return <span style={{ color: "#64748b" }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="sparkline">
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function normalizeCryptoPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || payload?.asOf || null,
    perpMetrics: Array.isArray(payload?.perpMetrics)
      ? payload.perpMetrics
      : Array.isArray(payload?.oiAndFunding)
      ? payload.oiAndFunding
      : [],
    kimchiPremium: payload?.kimchiPremium || null,
    etfInflows: Array.isArray(payload?.etfInflows) ? payload.etfInflows : [],
    perpVolumeByProtocol: Array.isArray(payload?.perpVolumeByProtocol)
      ? payload.perpVolumeByProtocol
      : [],
    revenueByProtocol: Array.isArray(payload?.revenueByProtocol)
      ? payload.revenueByProtocol
      : Array.isArray(payload?.revenuePerProtocol)
      ? payload.revenuePerProtocol
      : [],
    optionsVolumeByAsset: Array.isArray(payload?.optionsVolumeByAsset)
      ? payload.optionsVolumeByAsset
      : Array.isArray(payload?.optionsVolume)
      ? payload.optionsVolume
      : [],
    optionsMaxPain: Array.isArray(payload?.optionsMaxPain)
      ? payload.optionsMaxPain
      : [],
    perpsMarketShare: Array.isArray(payload?.perpsMarketShare) ? payload.perpsMarketShare : [],
    perpsOverview: Array.isArray(payload?.perpsOverview) ? payload.perpsOverview : [],
  };
}

function normalizeOptionsPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || payload?.asOf || null,
    totalOptionsOpenInterestUsd:
      payload?.totalOptionsOpenInterestUsd ?? payload?.totalOptionsOI ?? null,
    optionsVolumeByAsset: Array.isArray(payload?.optionsVolumeByAsset)
      ? payload.optionsVolumeByAsset
      : Array.isArray(payload?.optionsVolume)
      ? payload.optionsVolume
      : [],
    optionsMaxPain: Array.isArray(payload?.optionsMaxPain)
      ? payload.optionsMaxPain
      : [],
    volumeByExchangeRoute: Array.isArray(payload?.volumeByExchangeRoute)
      ? payload.volumeByExchangeRoute
      : Array.isArray(payload?.optionsVolumeByExchangeRoute)
      ? payload.optionsVolumeByExchangeRoute
      : [],
    greeks: Array.isArray(payload?.greeks) ? payload.greeks : [],
    oiByStrike: Array.isArray(payload?.oiByStrike) ? payload.oiByStrike : [],
  };
}

function normalizeEquitiesPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || null,
    benchmarkIndexHistory: Array.isArray(payload?.benchmarkIndexHistory) ? payload.benchmarkIndexHistory : [],
    benchmarkPerformance: Array.isArray(payload?.benchmarkPerformance) ? payload.benchmarkPerformance : [],
    sectorPerformance: Array.isArray(payload?.sectorPerformance) ? payload.sectorPerformance : [],
    regionalPerformance: Array.isArray(payload?.regionalPerformance) ? payload.regionalPerformance : [],
    styleFactors: Array.isArray(payload?.styleFactors) ? payload.styleFactors : [],
    rebalanceSignals: Array.isArray(payload?.rebalanceSignals) ? payload.rebalanceSignals : [],
    correlationLabels: Array.isArray(payload?.correlationLabels) ? payload.correlationLabels : [],
    correlationMatrix: Array.isArray(payload?.correlationMatrix) ? payload.correlationMatrix : [],
    volatilityMetrics: Array.isArray(payload?.volatilityMetrics) ? payload.volatilityMetrics : [],
    dividendData: Array.isArray(payload?.dividendData) ? payload.dividendData : [],
    earningsCalendar: Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [],
    valuationData: Array.isArray(payload?.valuationData) ? payload.valuationData : [],
    macroData: Array.isArray(payload?.macroData) ? payload.macroData : [],
    fundFlows: Array.isArray(payload?.fundFlows) ? payload.fundFlows : [],
    fxRates: Array.isArray(payload?.fxRates) ? payload.fxRates : [],
    forexMovers: payload?.forexMovers || { gainers: [], losers: [] },
    marketBreadth: payload?.marketBreadth || null,
    riskIndicators: Array.isArray(payload?.riskIndicators) ? payload.riskIndicators : [],
    corporateActions: Array.isArray(payload?.corporateActions) ? payload.corporateActions : [],
    annualReturns: Array.isArray(payload?.annualReturns) ? payload.annualReturns : [],
    reitData: payload?.reitData || { benchmarks: [] },
    mmfYields: Array.isArray(payload?.mmfYields) ? payload.mmfYields : [],
    fundsList: Array.isArray(payload?.fundsList) ? payload.fundsList : [],
  };
}

function normalizeMacroPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || null,
    macroData: Array.isArray(payload?.macroData) ? payload.macroData : [],
    fxRates: Array.isArray(payload?.fxRates) ? payload.fxRates : [],
    forexMovers: payload?.forexMovers || { gainers: [], losers: [] },
    riskIndicators: Array.isArray(payload?.riskIndicators) ? payload.riskIndicators : [],
  };
}

function normalizeCommoditiesPayload(payload) {
  const rows = Array.isArray(payload?.list)
    ? payload.list
    : Array.isArray(payload?.commodities)
    ? payload.commodities
    : [];
  return {
    updatedAt: payload?.updatedAt || payload?.asOf || null,
    overview: payload?.overview || null,
    list: rows,
    priceSeries: Array.isArray(payload?.priceSeries) ? payload.priceSeries : [],
    fundamentals: Array.isArray(payload?.fundamentals) ? payload.fundamentals : [],
    flows: Array.isArray(payload?.flows) ? payload.flows : [],
    seasonality: Array.isArray(payload?.seasonality) ? payload.seasonality : [],
    curve: Array.isArray(payload?.curve) ? payload.curve : [],
    compare: Array.isArray(payload?.compare) ? payload.compare : [],
    calendar: Array.isArray(payload?.calendar) ? payload.calendar : [],
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : [],
    correlation: Array.isArray(payload?.correlation) ? payload.correlation : [],
  };
}

const getToneColor = (tone = "neutral") => {
  if (tone === "positive" || tone === "success" || tone === "up") return "#22C55E";
  if (tone === "negative" || tone === "danger" || tone === "down") return "#EF4444";
  if (tone === "warning" || tone === "watch") return "#F59E0B";
  if (tone === "purple" || tone === "advanced") return "#8B5CF6";
  if (tone === "info" || tone === "primary") return "#22D3EE";
  return "#94A3B8";
};

const getTrendTone = (value) => {
  const text = String(value || "").toLowerCase();
  if (text.includes("down") || text.includes("elevated") || text.includes("tight")) return "warning";
  if (text.includes("up") || text.includes("steep")) return "positive";
  if (text.includes("watch")) return "watch";
  return "neutral";
};

const getRiskSeverity = (row) => {
  const status = String(row?.status || "").trim();
  if (status) return status;
  const label = String(row?.indicator || "").toLowerCase();
  const value = Number(row?.value);
  if (label.includes("vix")) return value >= 25 ? "Elevated" : value >= 18 ? "Watch" : "Normal";
  if (label.includes("move")) return value >= 120 ? "Elevated" : "Contained";
  if (label.includes("liquidity")) return value < 0 ? "Tightening" : "Normal";
  if (label.includes("oas")) return value >= 4 ? "Watch" : "Contained";
  return "Contained";
};

const getCorrelationTone = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.25) return "neutral";
  if (Math.abs(numeric) >= 0.65) return "purple";
  return numeric >= 0 ? "positive" : "negative";
};



export function AnalyticsModule({ backendUrl }) {
  const [activeTab, setActiveTab] = useState("crypto");
  const [cryptoData, setCryptoData] = useState(EMPTY_CRYPTO);
  const [optionsData, setOptionsData] = useState(EMPTY_OPTIONS);
  const [equitiesData, setEquitiesData] = useState(EMPTY_EQUITIES);
  const [equitiesSpecData, setEquitiesSpecData] = useState(EMPTY_EQUITIES_SPEC);
  const [macroData, setMacroData] = useState(EMPTY_MACRO);
  const [commoditiesData, setCommoditiesData] = useState(EMPTY_COMMODITIES);
  const [loading, setLoading] = useState({ crypto: false, options: false, equities: false, macro: false, commodities: false });
  const [errors, setErrors] = useState({ crypto: "", options: "", equities: "", macro: "", commodities: "" });
  
  const [etfAssetToggle, setEtfAssetToggle] = useState("All");
  const [etfPeriodToggle, setEtfPeriodToggle] = useState("daily");
  const [selectedPerpExchange, setSelectedPerpExchange] = useState("Hyperliquid");
  const [annualReturnsPageIndex, setAnnualReturnsPageIndex] = useState(0);
  const [selectedMainCategory, setSelectedMainCategory] = useState("hub");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [selectedFundId, setSelectedFundId] = useState("");
  const [selectedMMFId, setSelectedMMFId] = useState("");
  const [selectedMMFCountry, setSelectedMMFCountry] = useState("ALL");
  const [selectedREITCountry, setSelectedREITCountry] = useState("ALL");
  const [selectedMarketView, setSelectedMarketView] = useState("benchmarks");
  const [marketSnapshotFilter, setMarketSnapshotFilter] = useState("all");
  const [compareItems, setCompareItems] = useState([]);
  const [timeRange, setTimeRange] = useState("1Y");
  const [equitiesSavedViews, setEquitiesSavedViews] = useState([]);
  const [equitiesAlerts, setEquitiesAlerts] = useState([]);
  const [etfPageIndex, setEtfPageIndex] = useState(0);
  const ETF_PAGE_SIZE = 5;
  const [selectedGeoType, setSelectedGeoType] = useState("Country");
  const [selectedGeoCode, setSelectedGeoCode] = useState("USA");
  const [selectedCategory, setSelectedCategory] = useState("growth");
  const [selectedIndicator, setSelectedIndicator] = useState("GDP_GROWTH_YOY");
  const [countrySearch, setCountrySearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [indicatorSearch, setIndicatorSearch] = useState("");
  const [chartRange, setChartRange] = useState("5Y");
  const [chartMode, setChartMode] = useState("levels");
  const [compareGeos, setCompareGeos] = useState(["USA", "DEU"]);
  const [calendarFilters, setCalendarFilters] = useState({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    importance: "all",
    geography: "all",
    indicatorType: "all",
  });
  const [alertRules, setAlertRules] = useState([]);
  const [alertChannels, setAlertChannels] = useState(["in-app"]);
  const [alertStatus, setAlertStatus] = useState("active");
  const [regimeLabel, setRegimeLabel] = useState("expansion");
  const [regimeScore, setRegimeScore] = useState(null);
  const [regimeExplain, setRegimeExplain] = useState("");
  const [globalTrendMode, setGlobalTrendMode] = useState("weighted");
  const [macroView, setMacroView] = useState("chart");
  const [geoSearchQuery, setGeoSearchQuery] = useState("");
  const [favoriteGeoCodes, setFavoriteGeoCodes] = useState([]);
  const [recentGeoCodes, setRecentGeoCodes] = useState(["USA"]);
  const [recentCountries, setRecentCountries] = useState(["USA"]);
  const [macroGeographies, setMacroGeographies] = useState(FALLBACK_MACRO_GEOS);
  const [macroIndicators, setMacroIndicators] = useState(FALLBACK_MACRO_INDICATORS);
  const [macroOverview, setMacroOverview] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [macroTimeseries, setMacroTimeseries] = useState([]);
  const [macroCompareRows, setMacroCompareRows] = useState([]);
  const [macroCalendarRows, setMacroCalendarRows] = useState([]);
  const [macroMapRows, setMacroMapRows] = useState([]);
  const [mapIndicator, setMapIndicator] = useState("GDP_GROWTH_YOY");
  const [mapDate, setMapDate] = useState(new Date().toISOString().slice(0, 10));
  const [mapLayer, setMapLayer] = useState("choropleth");
  const [macroRankingRows, setMacroRankingRows] = useState([]);
  const [rankingSort, setRankingSort] = useState("value_desc");
  const [rankingScope, setRankingScope] = useState("all");
  const [macroForecastRows, setMacroForecastRows] = useState([]);
  const [forecastToggle, setForecastToggle] = useState(true);
  const [consensusVisible, setConsensusVisible] = useState(true);
  const [selectedMacroAsset, setSelectedMacroAsset] = useState("SPY");
  const [correlationWindow, setCorrelationWindow] = useState("180d");
  const [macroCorrelationRows, setMacroCorrelationRows] = useState([]);
  const [macroSourceInfo, setMacroSourceInfo] = useState(null);
  const [selectedFxAsset, setSelectedFxAsset] = useState(null);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [macroSourceDataExpanded, setMacroSourceDataExpanded] = useState(false);
  const [macroTimeseriesPageIndex, setMacroTimeseriesPageIndex] = useState(0);
  const [selectedCommodityGroup, setSelectedCommodityGroup] = useState("all");
  const [selectedCommoditySymbol, setSelectedCommoditySymbol] = useState("GC");
  const [selectedCommodityRegion, setSelectedCommodityRegion] = useState("global");
  const [selectedCommodityTimeRange, setSelectedCommodityTimeRange] = useState("1Y");
  const [selectedCommodityView, setSelectedCommodityView] = useState("price");
  const [compareCommoditySymbols, setCompareCommoditySymbols] = useState(["GC", "CL"]);
  const [commodityAlertRules, setCommodityAlertRules] = useState([]);
  const [commodityFlowMode, setCommodityFlowMode] = useState("etf");
  const [commoditySearchQuery, setCommoditySearchQuery] = useState("");
  const [commoditySearchRows, setCommoditySearchRows] = useState([]);
  const [commodityAssetsPageIndex, setCommodityAssetsPageIndex] = useState(0);
  const [commodityPriceSeriesPageIndex, setCommodityPriceSeriesPageIndex] = useState(0);
  const [commoditySeasonalityPageIndex, setCommoditySeasonalityPageIndex] = useState(0);
  const ANNUAL_RETURNS_PAGE_SIZE = 10;
  const MACRO_TIMESERIES_PAGE_SIZE = 10;
  const COMMODITY_ASSETS_PAGE_SIZE = 5;
  const COMMODITY_PRICE_SERIES_PAGE_SIZE = 10;
  const COMMODITY_SEASONALITY_PAGE_SIZE = 6;

  const macroGeoTypePath = selectedGeoType === "Country" ? "country" : selectedGeoType === "Region" ? "region" : "global";

  const filteredMacroIndicators = useMemo(() => {
    const scoped = (macroIndicators || []).filter((row) => String(row?.category || "").toLowerCase() === String(selectedCategory || "").toLowerCase());
    const q = String(indicatorSearch || "").trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((row) => String(row?.name || row?.code || "").toLowerCase().includes(q));
  }, [macroIndicators, selectedCategory, indicatorSearch]);

  useEffect(() => {
    if (!filteredMacroIndicators.length) return;
    if (filteredMacroIndicators.some((row) => row.code === selectedIndicator)) return;
    setSelectedIndicator(filteredMacroIndicators[0]?.code || "GDP_GROWTH_YOY");
  }, [filteredMacroIndicators, selectedIndicator]);

  useEffect(() => {
    if (activeTab !== "macro") return;
    let cancelled = false;
    const fetchJson = async (path) => {
      try {
        const res = await fetch(`${backendUrl}${path}`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const loadMacroMetadata = async () => {
      const [geos, indicators, alerts] = await Promise.all([
        fetchJson("/macro/geographies"),
        fetchJson("/macro/indicators"),
        fetchJson("/macro/alerts"),
      ]);
      if (cancelled) return;

      const geoRows = Array.isArray(geos) ? geos : Array.isArray(geos?.items) ? geos.items : [];
      const indicatorRows = Array.isArray(indicators) ? indicators : Array.isArray(indicators?.items) ? indicators.items : [];
      const alertRows = Array.isArray(alerts) ? alerts : Array.isArray(alerts?.items) ? alerts.items : [];

      if (geoRows.length) setMacroGeographies(geoRows);
      if (indicatorRows.length) setMacroIndicators(indicatorRows);
      if (alertRows.length) setAlertRules(alertRows);
    };

    loadMacroMetadata();
    return () => {
      cancelled = true;
    };
  }, [activeTab, backendUrl]);

  useEffect(() => {
    if (activeTab !== "macro") return;
    const q = String(countrySearch || "").trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const loadSearch = async () => {
      try {
        const res = await fetch(`${backendUrl}/macro/geographies?query=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
        setSearchResults(rows);
      } catch {
        if (cancelled) return;
        const ql = q.toLowerCase();
        setSearchResults(
          (macroGeographies || []).filter((row) =>
            String(row?.name || "").toLowerCase().includes(ql) ||
            String(row?.code || "").toLowerCase().includes(ql)
          ).slice(0, 8)
        );
      }
    };
    loadSearch();
    return () => {
      cancelled = true;
    };
  }, [activeTab, backendUrl, countrySearch, macroGeographies]);

  useEffect(() => {
    if (activeTab !== "macro") return;
    let cancelled = false;
    const fetchJson = async (path) => {
      try {
        const res = await fetch(`${backendUrl}${path}`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const loadMacroData = async () => {
      setOverviewLoading(true);
      const overviewPath = selectedGeoType === "Global"
        ? "/macro/global/overview"
        : `/macro/${macroGeoTypePath}/${selectedGeoCode}/overview`;

      const compareGeoParam = (compareGeos || []).join(",");
      const [overviewRes, tsRes, compareRes, calendarRes, mapRes, rankingsRes, forecastRes, sourceRes, regimeRes, corrRes] = await Promise.all([
        fetchJson(overviewPath),
        fetchJson(`/macro/timeseries?geo=${encodeURIComponent(selectedGeoCode)}&indicator=${encodeURIComponent(selectedIndicator)}&range=${encodeURIComponent(chartRange)}&mode=${encodeURIComponent(chartMode)}`),
        fetchJson(`/macro/compare?geos=${encodeURIComponent(compareGeoParam)}&indicator=${encodeURIComponent(selectedIndicator)}`),
        fetchJson(`/macro/calendar?geo=${encodeURIComponent(calendarFilters.geography === "all" ? selectedGeoCode : calendarFilters.geography)}&from=${encodeURIComponent(calendarFilters.from)}&to=${encodeURIComponent(calendarFilters.to)}&importance=${encodeURIComponent(calendarFilters.importance)}&type=${encodeURIComponent(calendarFilters.indicatorType)}`),
        fetchJson(`/macro/map?indicator=${encodeURIComponent(mapIndicator || selectedIndicator)}&date=${encodeURIComponent(mapDate || calendarFilters.to)}`),
        fetchJson(`/macro/rankings?indicator=${encodeURIComponent(selectedIndicator)}&date=${encodeURIComponent(calendarFilters.to)}&scope=${encodeURIComponent(rankingScope)}&sort=${encodeURIComponent(rankingSort)}`),
        fetchJson(`/macro/forecast?geo=${encodeURIComponent(selectedGeoCode)}&indicator=${encodeURIComponent(selectedIndicator)}`),
        fetchJson(`/macro/source/${encodeURIComponent(selectedIndicator)}`),
        fetchJson(`/macro/regime?geo=${encodeURIComponent(selectedGeoCode)}&mode=${encodeURIComponent(globalTrendMode)}`),
        fetchJson(`/macro/correlation?indicator=${encodeURIComponent(selectedIndicator)}&asset=${encodeURIComponent(selectedMacroAsset)}&window=${encodeURIComponent(correlationWindow)}`),
      ]);

      if (cancelled) return;

      const overviewRows = Array.isArray(overviewRes?.items) ? overviewRes.items : Array.isArray(overviewRes) ? overviewRes : [];
      setMacroOverview(overviewRows.length ? overviewRows : (macroData.macroData || []).map((row, idx) => ({ id: `ov-${idx}`, ...row })));

      const tsRows = Array.isArray(tsRes?.series) ? tsRes.series : Array.isArray(tsRes) ? tsRes : [];
      setMacroTimeseries(tsRows);

      const compareRows = Array.isArray(compareRes?.rows) ? compareRes.rows : Array.isArray(compareRes) ? compareRes : [];
      setMacroCompareRows(compareRows);

      const calendarRows = Array.isArray(calendarRes?.events) ? calendarRes.events : Array.isArray(calendarRes) ? calendarRes : [];
      setMacroCalendarRows(calendarRows);

      const mapRows = Array.isArray(mapRes?.rows) ? mapRes.rows : Array.isArray(mapRes) ? mapRes : [];
      setMacroMapRows(mapRows);

      const rankingRows = Array.isArray(rankingsRes?.rows) ? rankingsRes.rows : Array.isArray(rankingsRes) ? rankingsRes : [];
      setMacroRankingRows(rankingRows);

      const forecastRows = Array.isArray(forecastRes?.points) ? forecastRes.points : Array.isArray(forecastRes) ? forecastRes : [];
      setMacroForecastRows(forecastRows);

      setMacroSourceInfo(sourceRes || null);

      const corrRows = Array.isArray(corrRes?.rows) ? corrRes.rows : Array.isArray(corrRes) ? corrRes : [];
      setMacroCorrelationRows(corrRows);

      const regimeFromApi = regimeRes?.label || regimeRes?.regime || null;
      const regimeScoreVal = Number(regimeRes?.score);
      const regimeNote = regimeRes?.explain || regimeRes?.note || "";
      if (regimeFromApi) setRegimeLabel(String(regimeFromApi).toLowerCase());
      if (Number.isFinite(regimeScoreVal)) setRegimeScore(regimeScoreVal);
      if (regimeNote) setRegimeExplain(regimeNote);
      setOverviewLoading(false);
    };

    loadMacroData();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    backendUrl,
    selectedGeoType,
    selectedGeoCode,
    selectedIndicator,
    chartRange,
    chartMode,
    compareGeos,
    calendarFilters,
    mapIndicator,
    mapDate,
    rankingSort,
    rankingScope,
    globalTrendMode,
    selectedMacroAsset,
    correlationWindow,
    macroGeoTypePath,
    macroData.macroData
  ]);

  useEffect(() => {
    const current = Number((macroOverview || [])[0]?.value);
    const inflation = (macroOverview || []).find((row) => String(row?.indicator || "").toLowerCase().includes("inflation"));
    const inflationVal = Number(inflation?.value);
    if (Number.isFinite(inflationVal) && inflationVal > 4) {
      setRegimeLabel("inflationary");
      setRegimeScore(35);
      setRegimeExplain("Inflation indicators are elevated relative to trend.");
    } else if (Number.isFinite(current) && current < 0) {
      setRegimeLabel("recession risk");
      setRegimeScore(20);
      setRegimeExplain("Composite growth proxy is negative.");
    } else if (Number.isFinite(current) && current < 1) {
      setRegimeLabel("slowdown");
      setRegimeScore(45);
      setRegimeExplain("Growth is positive but below long-term trend.");
    } else if (Number.isFinite(current) && current > 3) {
      setRegimeLabel("expansion");
      setRegimeScore(75);
      setRegimeExplain("Growth and macro momentum are in expansionary territory.");
    } else {
      setRegimeLabel("easing");
      setRegimeScore(58);
      setRegimeExplain("Macro prints are mixed with easing pressure.");
    }
  }, [macroOverview]);

  useEffect(() => {
    setMacroTimeseriesPageIndex(0);
  }, [selectedGeoCode, selectedIndicator, chartRange, chartMode, macroTimeseries.length]);

  useEffect(() => {
    setSelectedMMFId("");
  }, [selectedMMFCountry]);

  useEffect(() => {
    if (selectedMainCategory === "reits") {
      setSelectedSymbol("");
    }
  }, [selectedREITCountry, selectedMainCategory]);

  useEffect(() => {
    if (activeTab !== "commodities") return;
    let cancelled = false;
    const controller = new AbortController();
    const fetchJson = async (path) => {
      try {
        const res = await fetch(`${backendUrl}${path}`, { signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const loadCommodities = async () => {
      const [overviewRes, listRes, alertsRes] = await Promise.all([
        fetchJson("/commodities/overview"),
        fetchJson(`/commodities/list?group=${encodeURIComponent(selectedCommodityGroup)}`),
        fetchJson("/commodities/alerts"),
      ]);

      const [priceRes, fundamentalsRes, flowsRes, seasonalityRes, curveRes, compareRes, calendarRes, correlationRes] = await Promise.all([
        selectedCommoditySymbol ? fetchJson(`/commodities/${encodeURIComponent(selectedCommoditySymbol)}/price?range=${encodeURIComponent(selectedCommodityTimeRange)}&region=${encodeURIComponent(selectedCommodityRegion)}`) : Promise.resolve(null),
        selectedCommoditySymbol ? fetchJson(`/commodities/${encodeURIComponent(selectedCommoditySymbol)}/fundamentals`) : Promise.resolve(null),
        selectedCommoditySymbol ? fetchJson(`/commodities/${encodeURIComponent(selectedCommoditySymbol)}/flows?mode=${encodeURIComponent(commodityFlowMode)}`) : Promise.resolve(null),
        selectedCommoditySymbol ? fetchJson(`/commodities/${encodeURIComponent(selectedCommoditySymbol)}/seasonality`) : Promise.resolve(null),
        selectedCommoditySymbol ? fetchJson(`/commodities/${encodeURIComponent(selectedCommoditySymbol)}/curve`) : Promise.resolve(null),
        compareCommoditySymbols.length ? fetchJson(`/commodities/compare?symbols=${encodeURIComponent(compareCommoditySymbols.join(","))}`) : Promise.resolve(null),
        fetchJson(`/commodities/calendar?group=${encodeURIComponent(selectedCommodityGroup)}`),
        selectedCommoditySymbol ? fetchJson(`/commodities/correlation?symbol=${encodeURIComponent(selectedCommoditySymbol)}&asset=SPY`) : Promise.resolve(null),
      ]);

      if (cancelled) return;

      const rowsFrom = (payload, key) =>
        Array.isArray(payload?.[key]) ? payload[key] : Array.isArray(payload) ? payload : [];

      const newList = rowsFrom(listRes, "items").length ? rowsFrom(listRes, "items") : rowsFrom(listRes, "list");
      console.log("[Analytics] Commodities List Update:", { count: newList.length, group: selectedCommodityGroup });

      setCommoditiesData((prev) => ({
        ...prev,
        updatedAt:
          overviewRes?.updatedAt ||
          listRes?.updatedAt ||
          prev.updatedAt ||
          new Date().toISOString(),
        overview: overviewRes?.overview || overviewRes || prev.overview,
        list: newList,
        priceSeries: rowsFrom(priceRes, "series"),
        fundamentals: rowsFrom(fundamentalsRes, "items").length ? rowsFrom(fundamentalsRes, "items") : rowsFrom(fundamentalsRes, "metrics"),
        flows: rowsFrom(flowsRes, "items").length ? rowsFrom(flowsRes, "items") : rowsFrom(flowsRes, "flows"),
        seasonality: rowsFrom(seasonalityRes, "items").length ? rowsFrom(seasonalityRes, "items") : rowsFrom(seasonalityRes, "seasonality"),
        curve: rowsFrom(curveRes, "points").length ? rowsFrom(curveRes, "points") : rowsFrom(curveRes, "curve"),
        compare: rowsFrom(compareRes, "rows").length ? rowsFrom(compareRes, "rows") : rowsFrom(compareRes, "compare"),
        calendar: rowsFrom(calendarRes, "events").length ? rowsFrom(calendarRes, "events") : rowsFrom(calendarRes, "calendar"),
        alerts: rowsFrom(alertsRes, "items").length ? rowsFrom(alertsRes, "items") : rowsFrom(alertsRes, "alerts"),
        correlation: rowsFrom(correlationRes, "rows").length ? rowsFrom(correlationRes, "rows") : rowsFrom(correlationRes, "correlation"),
      }));
      setCommodityAlertRules((prev) => (prev.length ? prev : rowsFrom(alertsRes, "items")));
    };

    loadCommodities();
    const timer = window.setInterval(loadCommodities, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [
    activeTab,
    backendUrl,
    compareCommoditySymbols,
    commodityFlowMode,
    selectedCommodityGroup,
    selectedCommodityRegion,
    selectedCommoditySymbol,
    selectedCommodityTimeRange,
  ]);

  useEffect(() => {
    if (activeTab !== "commodities") return;
    const q = String(commoditySearchQuery || "").trim();
    if (!q) {
      setCommoditySearchRows([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`${backendUrl}/commodities/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const payload = await res.json();
        if (cancelled) return;
        const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
        setCommoditySearchRows(rows);
      } catch {
        if (cancelled) return;
        const ql = q.toLowerCase();
        setCommoditySearchRows((commoditiesData.list || []).filter((row) => `${row?.symbol || ""} ${row?.name || ""} ${row?.group || ""}`.toLowerCase().includes(ql)).slice(0, 8));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, backendUrl, commoditySearchQuery, commoditiesData.list]);

  useEffect(() => {
    setCommodityPriceSeriesPageIndex(0);
  }, [selectedCommoditySymbol, selectedCommodityTimeRange, selectedCommodityRegion]);

  useEffect(() => {
    setCommodityAssetsPageIndex(0);
  }, [selectedCommodityGroup, commoditySearchQuery, selectedCommodityRegion]);

  useEffect(() => {
    setCommoditySeasonalityPageIndex(0);
  }, [selectedCommoditySymbol]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      if (activeTab === "commodities") {
        setErrors((prev) => ({ ...prev, commodities: "" }));
        setLoading((prev) => ({ ...prev, commodities: false }));
        return;
      }
      setLoading((prev) => ({ ...prev, [activeTab]: true }));
      setErrors((prev) => ({ ...prev, [activeTab]: "" }));
      const endpointTab = activeTab === "macro" ? "equities" : activeTab;

      try {
        const res = await fetch(`${backendUrl}/analytics/${endpointTab}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await res.json();
        if (cancelled) return;

        if (activeTab === "crypto") {
          setCryptoData(normalizeCryptoPayload(payload));
        } else if (activeTab === "options") {
          setOptionsData(normalizeOptionsPayload(payload));
        } else if (activeTab === "equities") {
          setEquitiesData(normalizeEquitiesPayload(payload));
        } else if (activeTab === "macro") {
          setMacroData(normalizeMacroPayload(payload));
        } else if (activeTab === "commodities") {
          setCommoditiesData(normalizeCommoditiesPayload(payload));
        }
      } catch (err) {
        if (cancelled || err?.name === "AbortError") return;
        setErrors((prev) => ({
          ...prev,
          [activeTab]:
            "Analytics endpoint is not returning data yet. Wire the backend route and refresh.",
        }));
      } finally {
        if (!cancelled) {
          setLoading((prev) => ({ ...prev, [activeTab]: false }));
        }
      }
    }

    load();
    const refreshMs = activeTab === "macro" ? 60_000 : activeTab === "crypto" || activeTab === "options" ? 45_000 : 120_000;
    const timer = window.setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, [activeTab, backendUrl]);

  useEffect(() => {
    if (activeTab !== "equities") return;
    let cancelled = false;
    const controller = new AbortController();

    const fetchJson = async (path) => {
      try {
        const res = await fetch(`${backendUrl}${path}`, { signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const loadSpec = async () => {
      const selectedStock = selectedSymbol || undefined;
      const selectedFund = selectedFundId || undefined;
      const selectedMmf = selectedMMFId || undefined;
      const [overview, categories, stocks, funds, mmf, reits, marketSnapshot, marketBenchmarks, marketSectors, marketRegions, marketBreadth, marketActions, searchResults] = await Promise.all([
        fetchJson("/equities/overview"),
        fetchJson("/equities/categories"),
        fetchJson("/equities/stocks"),
        fetchJson("/equities/funds"),
        fetchJson(`/equities/mmf?country=${encodeURIComponent(selectedMMFCountry)}`),
        fetchJson(`/equities/reits?country=${encodeURIComponent(selectedREITCountry)}`),
        fetchJson("/equities/market/snapshot"),
        fetchJson("/equities/market/benchmarks"),
        fetchJson("/equities/market/sectors"),
        fetchJson("/equities/market/regions"),
        fetchJson("/equities/market/breadth"),
        fetchJson("/equities/market/actions"),
        searchQuery ? fetchJson(`/equities/search?q=${encodeURIComponent(searchQuery)}`) : Promise.resolve([]),
      ]);

      const [stockDetails, stockPeers, stockFundamentals, stockMarketContext, fundDetail, fundCompare, fundHoldings, fundRisk, fundFlows, mmfDetail, mmfYieldHistory, mmfLiquidity, mmfComposition, reitDetail, reitCompare, reitExposure, reitIncome] = await Promise.all([
        selectedStock ? fetchJson(`/equities/stocks/${encodeURIComponent(selectedStock)}`) : Promise.resolve(null),
        selectedStock ? fetchJson(`/equities/stocks/${encodeURIComponent(selectedStock)}/peers`) : Promise.resolve([]),
        selectedStock ? fetchJson(`/equities/stocks/${encodeURIComponent(selectedStock)}/fundamentals`) : Promise.resolve([]),
        selectedStock ? fetchJson(`/equities/stocks/${encodeURIComponent(selectedStock)}/market-context`) : Promise.resolve([]),
        selectedFund ? fetchJson(`/equities/funds/${encodeURIComponent(selectedFund)}`) : Promise.resolve(null),
        compareItems.length ? fetchJson(`/equities/funds/compare?ids=${encodeURIComponent(compareItems.join(","))}`) : Promise.resolve([]),
        selectedFund ? fetchJson(`/equities/funds/${encodeURIComponent(selectedFund)}/holdings`) : Promise.resolve([]),
        selectedFund ? fetchJson(`/equities/funds/${encodeURIComponent(selectedFund)}/risk`) : Promise.resolve([]),
        fetchJson("/equities/funds/flows"),
        selectedMmf ? fetchJson(`/equities/mmf/${encodeURIComponent(selectedMmf)}`) : Promise.resolve(null),
        selectedMmf ? fetchJson(`/equities/mmf/${encodeURIComponent(selectedMmf)}/yield-history`) : Promise.resolve([]),
        selectedMmf ? fetchJson(`/equities/mmf/${encodeURIComponent(selectedMmf)}/liquidity`) : Promise.resolve([]),
        selectedMmf ? fetchJson(`/equities/mmf/${encodeURIComponent(selectedMmf)}/composition`) : Promise.resolve([]),
        selectedStock && selectedMainCategory === "reits" ? fetchJson(`/equities/reits/${encodeURIComponent(selectedStock)}`) : Promise.resolve(null),
        compareItems.length && selectedMainCategory === "reits" ? fetchJson(`/equities/reits/compare?ids=${encodeURIComponent(compareItems.join(","))}`) : Promise.resolve([]),
        selectedStock && selectedMainCategory === "reits" ? fetchJson(`/equities/reits/${encodeURIComponent(selectedStock)}/exposure`) : Promise.resolve([]),
        selectedStock && selectedMainCategory === "reits" ? fetchJson(`/equities/reits/${encodeURIComponent(selectedStock)}/income`) : Promise.resolve([]),
      ]);

      if (cancelled) return;
      setEquitiesSpecData((prev) => ({
        ...prev,
        overview: overview || prev.overview,
        categories: Array.isArray(categories) ? categories : prev.categories,
        searchResults: Array.isArray(searchResults) ? searchResults : prev.searchResults,
        stocks: Array.isArray(stocks) ? stocks : prev.stocks,
        stockDetails: stockDetails || prev.stockDetails,
        stockPeers: Array.isArray(stockPeers) ? stockPeers : prev.stockPeers,
        stockFundamentals: Array.isArray(stockFundamentals) ? stockFundamentals : prev.stockFundamentals,
        stockMarketContext: Array.isArray(stockMarketContext) ? stockMarketContext : prev.stockMarketContext,
        funds: Array.isArray(funds) ? funds : prev.funds,
        fundDetail: fundDetail || prev.fundDetail,
        fundCompare: Array.isArray(fundCompare) ? fundCompare : prev.fundCompare,
        fundHoldings: Array.isArray(fundHoldings) ? fundHoldings : prev.fundHoldings,
        fundRisk: Array.isArray(fundRisk) ? fundRisk : prev.fundRisk,
        fundFlows: Array.isArray(fundFlows) ? fundFlows : prev.fundFlows,
        mmf: Array.isArray(mmf) ? mmf : prev.mmf,
        mmfDetail: mmfDetail || prev.mmfDetail,
        mmfYieldHistory: Array.isArray(mmfYieldHistory) ? mmfYieldHistory : prev.mmfYieldHistory,
        mmfLiquidity: Array.isArray(mmfLiquidity) ? mmfLiquidity : prev.mmfLiquidity,
        mmfComposition: Array.isArray(mmfComposition) ? mmfComposition : prev.mmfComposition,
        reits: Array.isArray(reits) ? reits : prev.reits,
        reitDetail: reitDetail || prev.reitDetail,
        reitCompare: Array.isArray(reitCompare) ? reitCompare : prev.reitCompare,
        reitExposure: Array.isArray(reitExposure) ? reitExposure : prev.reitExposure,
        reitIncome: Array.isArray(reitIncome) ? reitIncome : prev.reitIncome,
        marketSnapshot: Array.isArray(marketSnapshot) ? marketSnapshot : prev.marketSnapshot,
        marketBenchmarks: Array.isArray(marketBenchmarks) ? marketBenchmarks : prev.marketBenchmarks,
        marketSectors: Array.isArray(marketSectors) ? marketSectors : prev.marketSectors,
        marketRegions: Array.isArray(marketRegions) ? marketRegions : prev.marketRegions,
        marketBreadth: marketBreadth || prev.marketBreadth,
        marketActions: Array.isArray(marketActions) ? marketActions : prev.marketActions,
      }));
    };

    loadSpec();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, backendUrl, compareItems, searchQuery, selectedFundId, selectedMMFId, selectedMMFCountry, selectedREITCountry, selectedMainCategory, selectedSymbol]);

  const cryptoPerps = useMemo(() => {
    if (!cryptoData || !cryptoData.perpMetrics || !selectedPerpExchange) {
      return [];
    }
    const preferredOrder = ["BTC", "ETH", "SOL", "HYPE", "BNB"];
    const currentMetrics = (cryptoData.perpMetrics || []).filter(
      (m) => m && m.exchange === selectedPerpExchange
    );
    const bySymbol = new Map(
      currentMetrics.map((row) => [
        String(row?.symbol || "").toUpperCase(),
        row,
      ])
    );
    return preferredOrder
      .map((symbol) => {
        const row = bySymbol.get(symbol);
        if (!row) return null;
        return {
          id: `${selectedPerpExchange}-${symbol}`,
          symbol,
          openInterestUsd:
            row?.openInterestUsd ?? row?.oiUsd ?? row?.openInterest ?? null,
          fundingRate: row?.fundingRate ?? row?.funding ?? null,
          exchange: row?.exchange || selectedPerpExchange,
        };
      })
      .filter((row) => row !== null);
  }, [cryptoData, selectedPerpExchange]);

  const cryptoTotalOi = useMemo(
    () =>
      cryptoPerps.reduce(
        (sum, row) => sum + (Number(row.openInterestUsd) || 0),
        0
      ),
    [cryptoPerps]
  );

  const optionsTotalVolume = useMemo(
    () =>
      (optionsData.optionsVolumeByAsset || []).reduce(
        (sum, row) => sum + (Number(row.volumeUsd ?? row.volume) || 0),
        0
      ),
    [optionsData]
  );

  const correlationColumns = useMemo(() => {
    const labels = Array.isArray(equitiesData.correlationLabels) ? equitiesData.correlationLabels : [];
    if (!labels.length) return [];
    return [
      { key: "asset", label: "Asset" },
      ...labels.map((label, idx) => ({
        key: `c${idx}`,
        label,
        align: "right",
        render: (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "—"),
      })),
    ];
  }, [equitiesData.correlationLabels]);

  const correlationRows = useMemo(() => {
    const labels = Array.isArray(equitiesData.correlationLabels) ? equitiesData.correlationLabels : [];
    const matrix = Array.isArray(equitiesData.correlationMatrix) ? equitiesData.correlationMatrix : [];
    if (!labels.length || !matrix.length) return [];
    return matrix.map((row, i) => {
      const out = { id: `corr-${i}`, asset: labels[i] || `Row ${i + 1}` };
      labels.forEach((_, j) => {
        out[`c${j}`] = Number(Array.isArray(row) ? row[j] : null);
      });
      return out;
    });
  }, [equitiesData.correlationLabels, equitiesData.correlationMatrix]);

  const equitiesSearch = useMemo(
    () => String(searchQuery || "").trim().toLowerCase(),
    [searchQuery]
  );

  const rangeKey = useMemo(() => {
    if (timeRange === "1D") return "daily";
    if (timeRange === "1W") return "weekly";
    if (timeRange === "1M") return "monthly";
    if (timeRange === "YTD") return "ytd";
    if (timeRange === "1Y") return "yr1";
    if (timeRange === "5Y") return "yr5";
    if (timeRange === "MAX") return "annual";
    return "yr1";
  }, [timeRange]);

  const filteredEquities = useMemo(() => {
    const filterRows = (rows, fields) => {
      if (!Array.isArray(rows)) return [];
      if (!equitiesSearch) return rows;
      return rows.filter((row) =>
        fields.some((field) =>
          String(row?.[field] ?? "")
            .toLowerCase()
            .includes(equitiesSearch)
        )
      );
    };

    return {
      benchmarkIndexHistory: filterRows(equitiesData.benchmarkIndexHistory, ["name", "symbol", "region", "currency"]),
      sectorPerformance: filterRows(equitiesData.sectorPerformance, ["sector"]),
      regionalPerformance: filterRows(equitiesData.regionalPerformance, ["region", "currency"]),
      styleFactors: filterRows(equitiesData.styleFactors, ["factor"]),
      rebalanceSignals: filterRows(equitiesData.rebalanceSignals, ["bucket", "signal"]),
      volatilityMetrics: filterRows(equitiesData.volatilityMetrics, ["asset"]),
      benchmarkPerformance: filterRows(equitiesData.benchmarkPerformance, ["name"]),
      annualReturns: filterRows(equitiesData.annualReturns, ["year"]),
      reitBenchmarks: filterRows(equitiesData.reitData?.benchmarks, ["name"]),
      mmfYields: filterRows(equitiesData.mmfYields, ["country", "currency", "note"]),
      fundsList: filterRows(equitiesData.fundsList, ["provider", "name", "domicile", "assetClass", "type", "structure"]),
      dividendData: filterRows(equitiesData.dividendData, ["symbol"]),
      earningsCalendar: filterRows(equitiesData.earningsCalendar, ["date", "symbol", "period", "revisionTrend"]),
      valuationData: filterRows(equitiesData.valuationData, ["scope"]),
      fundFlows: filterRows(equitiesData.fundFlows, ["segment", "assetClass", "region", "period"]),
      corporateActions: filterRows(equitiesData.corporateActions, ["date", "symbol", "action", "detail"]),
      correlationRows: filterRows(correlationRows, ["asset"]),
      stocks: filterRows(
        (equitiesSpecData.stocks || []).length
          ? equitiesSpecData.stocks
          : (equitiesData.dividendData || []).map((row, idx) => ({
              id: row.id || `stk-${idx}`,
              symbol: row.symbol,
              dividendYield: row.dividendYield,
              payoutRatio: row.payoutRatio,
              exDividendDate: row.exDividendDate,
            })),
        ["symbol", "name", "sector", "exchange", "assetClass"]
      ),
      funds: filterRows(
        (equitiesSpecData.funds || []).length ? equitiesSpecData.funds : equitiesData.fundsList,
        ["ticker", "name", "provider", "domicile", "assetClass", "type", "structure"]
      ),
      mmf: filterRows(
        (equitiesSpecData.mmf || []).length ? equitiesSpecData.mmf : equitiesData.mmfYields,
        ["id", "name", "fundName", "country", "currency", "provider"]
      ),
      reits: filterRows(
        (equitiesSpecData.reits || []).length
          ? equitiesSpecData.reits
          : (equitiesData.reitData?.benchmarks || []).map((row, idx) => ({ id: `reit-${idx}`, symbol: row.name, ...row })),
        ["symbol", "name", "region", "propertyType"]
      ),
      marketSnapshot: filterRows(
        (equitiesSpecData.marketSnapshot || []).length ? equitiesSpecData.marketSnapshot : [],
        ["group", "name", "metric", "value"]
      ),
    };
  }, [equitiesData, equitiesSpecData, correlationRows, equitiesSearch]);

  const marketSnapshotRows = useMemo(() => {
    const rows = [
      ...(filteredEquities.benchmarkIndexHistory || []).slice(0, 4).map((row, idx) => ({
        id: `hub-bmk-${idx}`,
        group: "Benchmark",
        name: row.name || row.symbol || "Benchmark",
        value: row?.[rangeKey],
      })),
      ...(filteredEquities.sectorPerformance || []).slice(0, 7).map((row, idx) => ({
        id: `hub-sec-${idx}`,
        group: "Sector",
        name: row.sector || row.name || "Sector",
        value: row?.[rangeKey],
      })),
      ...(filteredEquities.regionalPerformance || []).slice(0, 5).map((row, idx) => ({
        id: `hub-reg-${idx}`,
        group: "Region",
        name: row.region || row.name || "Region",
        value: row?.[rangeKey],
      })),
    ];
    if (marketSnapshotFilter === "all") return rows;
    return rows.filter((row) => String(row.group || "").toLowerCase() === marketSnapshotFilter);
  }, [filteredEquities, marketSnapshotFilter, rangeKey]);

  const filteredCommodities = useMemo(() => {
    const q = String(commoditySearchQuery || "").trim().toLowerCase();
    const rows = (commoditiesData.list || []).filter((row) => {
      const inGroup = selectedCommodityGroup === "all" || String(row?.group || "").toLowerCase() === selectedCommodityGroup;
      if (!inGroup) return false;
      const inRegion = selectedCommodityRegion === "global" || String(row?.region || "").toLowerCase() === selectedCommodityRegion;
      if (!inRegion) return false;
      if (!q) return true;
      return `${row?.symbol || ""} ${row?.name || ""} ${row?.group || ""} ${row?.region || ""}`.toLowerCase().includes(q);
    });
    const movers = [...rows].sort((a, b) => Math.abs(Number(b?.dailyChangePct) || 0) - Math.abs(Number(a?.dailyChangePct) || 0)).slice(0, 5);
    return { rows, movers };
  }, [commoditiesData.list, commoditySearchQuery, selectedCommodityGroup, selectedCommodityRegion]);

  const forexMoverRows = useMemo(() => {
    const gainers = Array.isArray(macroData.forexMovers?.gainers) ? macroData.forexMovers.gainers : [];
    const losers = Array.isArray(macroData.forexMovers?.losers) ? macroData.forexMovers.losers : [];
    return [
      ...gainers.map((row) => ({ ...row, moveType: "Gainer" })),
      ...losers.map((row) => ({ ...row, moveType: "Loser" })),
    ];
  }, [macroData.forexMovers]);

  const openFxAsset = (row) => {
    const pair = String(row?.pair || "").trim();
    const symbol = String(row?.symbol || pair.replace("/", "") || "").toUpperCase();
    if (!symbol) return;
    setSelectedFxAsset({
      symbol,
      name: pair || symbol,
      type: "forex",
      marketType: "forex",
      category: "FX",
      price: Number.isFinite(Number(row?.rate)) ? Number(row.rate) : undefined,
      priceChangePercent: Number.isFinite(Number(row?.daily)) ? Number(row.daily) : undefined,
      currency: String(pair).startsWith("USD/") ? String(pair).slice(4, 7) : "USD",
      quotedCurrency: String(pair).slice(4, 7) || "USD",
    });
  };

  useEffect(() => {
    setCommodityAssetsPageIndex(0);
  }, [selectedCommodityGroup, commoditySearchQuery, commoditiesData.list.length]);

  const currentUpdatedAt =
    activeTab === "crypto"
      ? cryptoData.updatedAt
      : activeTab === "options"
      ? optionsData.updatedAt
      : activeTab === "macro"
      ? macroData.updatedAt
      : activeTab === "commodities"
      ? commoditiesData.updatedAt
      : equitiesData.updatedAt;
  const currentError = errors[activeTab];
  const currentLoading = loading[activeTab];

  return (
    <AnalyticsLayout
      eyebrow="Analytics"
      title="Cross-market dashboards"
      description="Switch between Crypto, Options, Equities, Macro, and Commodities analytics."
      updatedAt={currentUpdatedAt}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >

      {/* Loading / error */}
      {currentLoading && <LoadingSkeleton label={`Loading ${activeTab} analytics...`} />}

      {currentError && !currentLoading && (
        <ErrorState title={`Couldn't load ${activeTab} analytics`} description={currentError} onRetry={() => setActiveTab(activeTab)} />
      )}

      {/* Content */}
      {!currentLoading && !currentError && (
        <>
          {activeTab === "crypto" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsStatCard
                  title="Tracked OI"
                  value={formatCompactMoney(cryptoTotalOi)}
                  subvalue={`${selectedPerpExchange} open interest for tracked assets`}
                  source={selectedPerpExchange === "Hyperliquid" ? "HL" : selectedPerpExchange}
                  tone="info"
                />
                <AnalyticsStatCard
                  title="Kimchi Premium"
                  value={formatPercent(
                    cryptoData.kimchiPremium?.valuePct ??
                      cryptoData.kimchiPremium?.value
                  )}
                  subvalue={cryptoData.kimchiPremium?.market || "KR vs global spread"}
                  source="Dune"
                  tone={
                    (cryptoData.kimchiPremium?.valuePct ??
                      cryptoData.kimchiPremium?.value ??
                      0) >= 0
                      ? "positive"
                      : "negative"
                  }
                />
                <AnalyticsStatCard
                  title="ETF Inflows"
                  value={formatCompactMoney(
                    (cryptoData.etfInflows || []).reduce(
                      (sum, row) =>
                        sum +
                        (Number(row.netUsd ?? row.netFlowUsd ?? 0) || 0),
                      0
                    )
                  )}
                  subvalue="Summed from latest ETF inflow rows"
                  source={(cryptoData.etfInflows || [])[0]?.source || "Farside"}
                  tone="positive"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Perpetual OI & funding"
                  subtitle={`${selectedPerpExchange} perp markets for key assets`}
                  emptyText={`No ${selectedPerpExchange} perp context rows returned yet.`}
                  headerExtra={
                    <div style={{ display: "flex", gap: 4 }}>
                      {["Hyperliquid", "Binance", "Bybit"].map((ex) => (
                        <button
                          key={ex}
                          onClick={() => setSelectedPerpExchange(ex)}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            borderRadius: 8,
                            cursor: "pointer",
                            background: selectedPerpExchange === ex ? "rgba(56,189,248,0.2)" : "transparent",
                            border: `1px solid ${selectedPerpExchange === ex ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
                            color: selectedPerpExchange === ex ? "#38bdf8" : "#94a3b8",
                            transition: "all 0.2s ease"
                          }}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  }
                  columns={[
                    { key: "symbol", label: "Asset" },
                    {
                      key: "openInterestUsd",
                      label: "Open Interest",
                      align: "right",
                      render: (v) => formatMoney(v),
                    },
                    {
                      key: "fundingRate",
                      label: "Funding Rate",
                      align: "right",
                      render: (v) => formatPercent(Number(v) * 100),
                    },
                    { key: "exchange", label: "Venue", align: "right" },
                  ]}
                  rows={cryptoPerps}
                />

                <div style={{
                  background: "rgba(0, 0, 0, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255, 255, 255, 0.16)",
                  borderRadius: 14,
                  padding: 16,
                  display: "flex", flexDirection: "column",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>ETF Inflows</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>Asset flows by manager</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "1px solid var(--color-border-subtle)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfAssetToggle} onChange={(e) => setEtfAssetToggle(e.target.value)}>
                        <option value="All">All Assets</option>
                        <option value="BTC">BTC</option>
                        <option value="ETH">ETH</option>
                        <option value="SOL">SOL</option>
                      </select>
                      <select style={{ background: "var(--color-surface-elevated)", color: "var(--color-text-primary)", border: "1px solid var(--color-border-subtle)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfPeriodToggle} onChange={(e) => setEtfPeriodToggle(e.target.value)}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>
                        Page {etfPageIndex + 1}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" className="analytics-btn ghost" onClick={() => setEtfPageIndex(p => Math.max(0, p - 1))} disabled={etfPageIndex === 0}>Prev</button>
                        <button type="button" className="analytics-btn ghost" onClick={() => setEtfPageIndex(p => p + 1)} disabled={((cryptoData.etfInflows || []).filter(r => (etfAssetToggle === "All" || r.asset === etfAssetToggle) && r.period === etfPeriodToggle).length <= (etfPageIndex + 1) * ETF_PAGE_SIZE)}>Next</button>
                      </div>
                    </div>
                  </div>
                  <AnalyticsTableCard
                    title=""
                    subtitle=""
                    emptyText="No ETF inflow rows returned yet."
                    columns={[
                      { key: "manager", label: "Manager" },
                      { key: "ticker", label: "Ticker" },
                      { key: "asset", label: "Asset" },
                      {
                        key: "netUsd",
                        label: "Net Flow",
                        align: "right",
                        render: (v) => formatMoney(v),
                      },
                    ]}
                    rows={(cryptoData.etfInflows || [])
                      .filter(r => (etfAssetToggle === "All" || r.asset === etfAssetToggle) && r.period === etfPeriodToggle)
                      .slice(etfPageIndex * ETF_PAGE_SIZE, (etfPageIndex + 1) * ETF_PAGE_SIZE)
                      .map((row, idx) => ({
                        id: row.id || `etf-${idx}`,
                        manager: row.manager,
                        ticker: row.ticker,
                        asset: row.asset,
                        netUsd: row.netUsd,
                      }))}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Perps Overview"
                  subtitle="Top 24h Volume and Open Interest rankings"
                  emptyText="No perp overview rows available."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "volume24h",
                      label: "24h Vol",
                      align: "right",
                      render: (v) => formatCompactMoney(v),
                    },
                    {
                      key: "openInterest",
                      label: "Open Interest",
                      align: "right",
                      render: (v) => formatCompactMoney(v),
                    },
                  ]}
                  rows={(cryptoData.perpsOverview || []).map((row, idx) => ({
                    id: `perp-ov-${idx}`,
                    ...row,
                  }))}
                />

                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.85)",
                    backdropFilter: "blur(12px)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                  }}
                >
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
                      Open Interest Market Share
                    </div>
                    <div style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 12 }}>
                      Distribution of total OI across major protocols
                    </div>
                  </div>
                  <div style={{ flex: 1, minHeight: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={cryptoData.perpsMarketShare}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="sharePct"
                          nameKey="protocol"
                          stroke="none"
                        >
                          {cryptoData.perpsMarketShare.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "rgba(5, 5, 5, 0.95)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: 8,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                          }}
                          itemStyle={{ color: "#fff" }}
                          formatter={(value) => [`${value}%`, "Market Share"]}
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          wrapperStyle={{ paddingTop: 20 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Perp volume by protocol"
                  subtitle="Dune aggregation for perp protocols"
                  emptyText="No perp volume rows returned yet."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(cryptoData.perpVolumeByProtocol || []).map(
                    (row, idx) => ({
                      id: row.id || `perp-vol-${idx}`,
                      protocol: row.protocol,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Revenue per protocol"
                  subtitle="Protocol revenue sourced from Dune"
                  emptyText="No revenue rows returned yet."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "revenueUsd",
                      label: "Revenue",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.revenue ?? null),
                    },
                  ]}
                  rows={(cryptoData.revenueByProtocol || []).map(
                    (row, idx) => ({
                      id: row.id || `rev-${idx}`,
                      protocol: row.protocol,
                      revenueUsd: row.revenueUsd ?? row.revenue,
                    })
                  )}
                />
              </div>
            </>
          ) : activeTab === "options" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsStatCard
                  title="Total Options OI"
                  value={formatCompactMoney(
                    optionsData.totalOptionsOpenInterestUsd
                  )}
                  subvalue="Aggregated from Binance, Derive and Deribit"
                  source="Multi-venue"
                  tone="info"
                />
                <AnalyticsStatCard
                  title="Tracked Options Volume"
                  value={formatCompactMoney(optionsTotalVolume)}
                  subvalue="Volume per available asset"
                  source="Binance + Derive + Deribit"
                  tone="positive"
                />
                <AnalyticsStatCard
                  title="Venue Count"
                  value={String(
                    new Set(
                      (optionsData.volumeByExchangeRoute || [])
                        .map((row) => row.exchange)
                        .filter(Boolean)
                    ).size || 0
                  )}
                  subvalue="Distinct exchange routes in the payload"
                  source="Routes"
                  tone="neutral"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Options volume per asset"
                  subtitle="By asset, with exchange route where available"
                  emptyText="No options volume rows returned yet."
                  columns={[
                    { key: "asset", label: "Asset" },
                    { key: "exchange", label: "Exchange" },
                    { key: "route", label: "Route" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(optionsData.optionsVolumeByAsset || []).map(
                    (row, idx) => ({
                      id: row.id || `opt-asset-${idx}`,
                      asset: row.asset,
                      exchange: row.exchange,
                      route: row.route,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Options max pain"
                  subtitle="By exchange, asset and expiry"
                  emptyText="No options max pain rows returned yet."
                  columns={[
                    { key: "exchange", label: "Exchange" },
                    { key: "asset", label: "Asset" },
                    { key: "expiry", label: "Expiry" },
                    {
                      key: "maxPain",
                      label: "Max Pain",
                      align: "right",
                      render: (v) => formatMoney(v, 0),
                    },
                  ]}
                  rows={(optionsData.optionsMaxPain || []).map((row, idx) => ({
                    id: row.id || `opt-maxpain-${idx}`,
                    exchange: row.exchange,
                    asset: row.asset,
                    expiry: row.expiry,
                    maxPain: row.maxPain,
                  }))}
                />

                <AnalyticsTableCard
                  title="Options volume by exchange route"
                  subtitle="Aggregated route table requested for Binance, Derive and Deribit"
                  emptyText="No exchange-route rows returned yet."
                  columns={[
                    { key: "exchange", label: "Exchange" },
                    { key: "route", label: "Route" },
                    { key: "asset", label: "Asset" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(optionsData.volumeByExchangeRoute || []).map(
                    (row, idx) => ({
                      id: row.id || `opt-route-${idx}`,
                      exchange: row.exchange,
                      route: row.route,
                      asset: row.asset,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Options Greeks"
                  subtitle="Latest Greeks from Deribit"
                  emptyText="No Greeks returned yet."
                  columns={[
                    { key: "instrument", label: "Instrument" },
                    { key: "delta", label: "Delta", align: "right", render: v => v?.toFixed(2) },
                    { key: "gamma", label: "Gamma", align: "right", render: v => v?.toFixed(2) },
                    { key: "vega", label: "Vega", align: "right", render: v => v?.toFixed(2) },
                    { key: "theta", label: "Theta", align: "right", render: v => v?.toFixed(2) },
                    { key: "iv", label: "IV", align: "right", render: v => formatPercent(v) },
                  ]}
                  rows={(optionsData.greeks || []).map((r, i) => ({ id: `grk-${i}`, ...r }))}
                />

                <AnalyticsTableCard
                  title="Options OI by Strike & Expiry"
                  subtitle="Latest options open interest"
                  emptyText="No OI rows returned yet."
                  columns={[
                    { key: "asset", label: "Asset" },
                    { key: "strike", label: "Strike", align: "right", render: v => formatMoney(v, 0) },
                    { key: "expiry", label: "Expiry", align: "right" },
                    { key: "type", label: "Type", align: "center" },
                    { key: "oi", label: "OI", align: "right", render: v => formatMoney(v, 0) },
                    { key: "exchange", label: "Exchange", align: "right" },
                  ]}
                  rows={(optionsData.oiByStrike || []).map((r, i) => ({ id: `oi-${i}`, ...r }))}
                />
              </div>
            </>
          ) : activeTab === "equities" ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
                <div className="analytics-card" style={{ display: "grid", gap: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div className="analytics-section-title">Equities command center</div>
                      <div className="analytics-card-subtitle">Screen benchmarks, sectors, funds, REITs, money markets, and market breadth.</div>
                    </div>
                    <TimeframeSelector options={["1D", "1W", "1M", "YTD", "1Y", "5Y", "MAX"]} value={timeRange} onChange={setTimeRange} />
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Universal search across equities data..."
                      className="analytics-input"
                      style={{ flex: "1 1 280px", minWidth: 200 }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEquitiesSavedViews((prev) => [
                          ...prev.slice(-4),
                          {
                            id: `view-${Date.now()}`,
                            section: selectedMainCategory,
                            horizon: timeRange,
                            query: searchQuery,
                          },
                        ])
                      }
                      className="analytics-btn secondary"
                    >
                      Save View
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEquitiesAlerts((prev) => [
                          ...prev.slice(-5),
                          {
                            id: `alert-${Date.now()}`,
                            section: selectedMainCategory,
                            rule: `Monitor ${selectedMainCategory} / ${timeRange}`,
                          },
                        ])
                      }
                      className="analytics-btn primary"
                    >
                      Create Alert
                    </button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                    <AnalyticsStatCard
                      title="Benchmarks"
                      value={String(filteredEquities.benchmarkIndexHistory.length)}
                      subvalue="Tracked index rows"
                      source="Snapshot"
                      tone="info"
                    />
                    <AnalyticsStatCard
                      title="Sectors"
                      value={String(filteredEquities.sectorPerformance.length)}
                      subvalue="Performance slices"
                      source="Snapshot"
                      tone="neutral"
                    />
                    <AnalyticsStatCard
                      title="Regions"
                      value={String(filteredEquities.regionalPerformance.length)}
                      subvalue="Country/region return rows"
                      source="Snapshot"
                      tone="neutral"
                    />
                    <AnalyticsStatCard
                      title="Action Center"
                      value={
                        equitiesData.marketBreadth
                          ? `${equitiesData.marketBreadth.newLows ?? 0} lows`
                          : "0"
                      }
                      subvalue="Breadth stress proxy"
                      source="Snapshot"
                      tone="negative"
                    />
                  </div>

                  <div className="analytics-pill-group">
                      {[
                        { key: "hub", label: "Hub" },
                        { key: "stocks", label: "Stock Metrics" },
                        { key: "funds", label: "Funds" },
                        { key: "mmf", label: "MMF" },
                        { key: "reits", label: "REITs" },
                        { key: "market", label: "General Market" },
                      ].map((section) => {
                      const active = selectedMainCategory === section.key;
                      return (
                        <button
                          key={section.key}
                          type="button"
                          onClick={() => setSelectedMainCategory(section.key)}
                          className={`analytics-chip-button ${active ? "active" : ""}`}
                        >
                          {section.label}
                        </button>
                      );
                    })}
                  </div>

                  {searchQuery ? (
                    <AnalyticsTableCard
                      title="Universal Search Matches"
                      subtitle="Stocks, funds, MMFs, REITs and market terms"
                      emptyText="No matches for current query."
                      columns={[
                        { key: "type", label: "Type" },
                        { key: "name", label: "Name" },
                        { key: "symbol", label: "Symbol", align: "right" },
                      ]}
                      rows={((equitiesSpecData.searchResults || []).length
                        ? equitiesSpecData.searchResults
                        : [
                            ...filteredEquities.stocks.map((row) => ({ type: "Stock", name: row.name || row.symbol, symbol: row.symbol })),
                            ...filteredEquities.funds.map((row) => ({ type: "Fund", name: row.name, symbol: row.ticker || row.symbol })),
                            ...filteredEquities.mmf.map((row) => ({ type: "MMF", name: row.fundName || row.name, symbol: row.id || row.symbol })),
                            ...filteredEquities.reits.map((row) => ({ type: "REIT", name: row.name || row.symbol, symbol: row.symbol })),
                          ]
                      ).slice(0, 10).map((row, idx) => ({
                        id: `sr-eq-${idx}`,
                        type: row.type || row.category || "Result",
                        name: row.name || row.label || row.title || "N/A",
                        symbol: row.symbol || row.ticker || "—",
                      }))}
                    />
                  ) : null}

                  {(equitiesSavedViews.length > 0 || equitiesAlerts.length > 0) ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        Saved views: {equitiesSavedViews.length}
                      </div>
                      <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "right" }}>
                        Alerts: {equitiesAlerts.length}
                      </div>
                    </div>
                  ) : null}
                </div>

                {selectedMainCategory === "hub" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <InsightCard tone="info">
                      Equity returns are concentrated in technology and US benchmarks, while breadth stress remains elevated. Review sector exposure and downside alerts.
                    </InsightCard>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                      {[
                        { key: "stocks", title: "Stock Metrics", body: "Screener, benchmark, risk and valuation views.", cta: "Open screener" },
                        { key: "funds", title: "Funds", body: "Directory, AUM, fee structure, and fund links.", cta: "View funds" },
                        { key: "mmf", title: "MMF", body: "Money market yields and short-duration cash views.", cta: "View yields" },
                        { key: "reits", title: "REITs", body: "Income, FFO/AFFO, occupancy and property exposure.", cta: "View REITs" },
                        { key: "market", title: "General Market", body: "Sector, region, breadth, flows and actions.", cta: "Open market view" },
                      ].map((card) => (
                        <button
                          key={card.key}
                          type="button"
                          onClick={() => setSelectedMainCategory(card.key)}
                          className="analytics-card"
                          style={{ textAlign: "left", color: "#e2e8f0", cursor: "pointer", minHeight: 150 }}
                        >
                          <div className="analytics-section-title" style={{ fontSize: 16 }}>{card.title}</div>
                          <div className="analytics-card-subtitle">{card.body}</div>
                          <div style={{ marginTop: 14, color: "#22D3EE", fontSize: 12, fontWeight: 800 }}>{card.cta}</div>
                        </button>
                      ))}
                    </div>

                    <AnalyticsTableCard
                      title="Market Snapshot Strip"
                      subtitle="Top benchmark, sector, region and flow context"
                      emptyText="No snapshot rows match this filter."
                      filters={["all", "benchmark", "sector", "region"].map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          className={`analytics-chip-button ${marketSnapshotFilter === filter ? "active" : ""}`}
                          onClick={() => setMarketSnapshotFilter(filter)}
                        >
                          {filter === "all" ? "All" : `${filter.charAt(0).toUpperCase()}${filter.slice(1)}s`}
                        </button>
                      ))}
                      columns={[
                        { key: "group", label: "Group", render: (v) => <StatusPill tone={v === "Benchmark" ? "info" : v === "Sector" ? "purple" : "neutral"}>{v}</StatusPill> },
                        { key: "name", label: "Name" },
                        {
                          key: "value",
                          label: timeRange,
                          align: "right",
                          render: (v) => {
                            const numeric = Number(v);
                            const tone = numeric > 0 ? "positive" : numeric < 0 ? "negative" : "neutral";
                            return <span style={{ color: getToneColor(tone), fontVariantNumeric: "tabular-nums" }}>{formatPercent(v)}</span>;
                          },
                        },
                      ]}
                      rows={marketSnapshotRows}
                    />
                  </div>
                ) : null}

                {selectedMainCategory === "stocks" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <AnalyticsTableCard
                      title="Stock Screener"
                      subtitle="Filterable list for symbol-level research"
                      emptyText="No stock rows returned."
                      columns={[
                        {
                          key: "symbol",
                          label: "Symbol",
                          render: (v, row) => (
                            <button
                              type="button"
                              onClick={() => setSelectedSymbol(String(v || row?.ticker || ""))}
                              style={{ background: "transparent", border: "none", color: "#7dd3fc", cursor: "pointer", padding: 0 }}
                            >
                              {v || row?.ticker || "—"}
                            </button>
                          ),
                        },
                        { key: "name", label: "Name" },
                        { key: "marketCap", label: "Mkt Cap", align: "right", render: (v) => formatCompactMoney(v) },
                        { key: "pe", label: "P/E", align: "right", render: (v) => Number(v).toFixed(2) },
                        { key: "pb", label: "P/B", align: "right", render: (v) => Number(v).toFixed(2) },
                        {
                          key: "compare",
                          label: "Compare",
                          align: "right",
                          render: (_v, row) => {
                            const id = String(row?.symbol || row?.ticker || "");
                            const selected = compareItems.includes(id);
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setCompareItems((prev) =>
                                    selected ? prev.filter((x) => x !== id) : [...prev.slice(-3), id]
                                  )
                                }
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(148,163,184,0.25)",
                                  background: selected ? "rgba(56,189,248,0.16)" : "rgba(5,5,5,0.4)",
                                  color: selected ? "#7dd3fc" : "#cbd5e1",
                                  fontSize: 11,
                                  cursor: "pointer",
                                }}
                              >
                                {selected ? "Added" : "Add"}
                              </button>
                            );
                          },
                        },
                      ]}
                      rows={(filteredEquities.stocks || []).map((row, idx) => ({ id: row.id || `stk-row-${idx}`, ...row }))}
                    />

                    <AnalyticsTableCard
                      title="Benchmark Index History"
                      subtitle="Daily, weekly, monthly and annual returns with sparkline trend"
                      emptyText="No benchmark index history data."
                      columns={[
                        { key: "name", label: "Benchmark" },
                        { key: "currency", label: "CCY" },
                        { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                        { key: "weekly", label: "Weekly", align: "right", render: (v) => formatPercent(v) },
                        { key: "monthly", label: "Monthly", align: "right", render: (v) => formatPercent(v) },
                        { key: "annual", label: "Annual", align: "right", render: (v) => formatPercent(v) },
                        { key: "horizon", label: timeRange, align: "right", render: (_v, row) => formatPercent(row?.[rangeKey]) },
                        {
                          key: "sparkline",
                          label: "Trend",
                          align: "right",
                          render: (_v, row) => (
                            <MiniSparkline
                              points={row.sparkline || []}
                              color={Number(row?.[rangeKey]) >= 0 ? "#4ade80" : "#f87171"}
                            />
                          ),
                        },
                      ]}
                      rows={(filteredEquities.benchmarkIndexHistory || []).map((row, idx) => ({ id: row.id || `bmk-h-${idx}`, ...row }))}
                    />

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                      <AnalyticsTableCard
                        title="Correlation Matrix"
                        subtitle="Cross-asset diversification matrix"
                        emptyText="No correlation matrix data."
                        columns={correlationColumns}
                        rows={filteredEquities.correlationRows}
                      />
                      <AnalyticsTableCard
                        title="Volatility Metrics"
                        subtitle="Annualized vol, max drawdown, Sharpe and Sortino"
                        emptyText="No volatility metrics."
                        columns={[
                          { key: "asset", label: "Asset" },
                          { key: "annualizedVolatility", label: "Vol (Ann.)", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                          { key: "maxDrawdown", label: "Max DD", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                          { key: "sharpe", label: "Sharpe", align: "right", render: (v) => Number(v).toFixed(2) },
                          { key: "sortino", label: "Sortino", align: "right", render: (v) => Number(v).toFixed(2) },
                        ]}
                        rows={(filteredEquities.volatilityMetrics || []).map((row, idx) => ({ id: `vol-${idx}`, ...row }))}
                      />
                    </div>

                    <AnalyticsTableCard
                      title="Valuation Comparison"
                      subtitle="P/E, P/B, EV/EBITDA, yield and FCF yield"
                      emptyText="No valuation rows."
                      columns={[
                        { key: "scope", label: "Scope" },
                        { key: "pe", label: "P/E", align: "right", render: (v) => Number(v).toFixed(1) },
                        { key: "pb", label: "P/B", align: "right", render: (v) => Number(v).toFixed(1) },
                        { key: "evEbitda", label: "EV/EBITDA", align: "right", render: (v) => Number(v).toFixed(1) },
                        { key: "dividendYield", label: "Div. Yield", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                        { key: "fcfYield", label: "FCF Yield", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      ]}
                      rows={(filteredEquities.valuationData || []).map((row, idx) => ({ id: `val-${idx}`, ...row }))}
                    />

                    {selectedSymbol ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                        <AnalyticsTableCard
                          title={`Stock Detail: ${selectedSymbol}`}
                          subtitle="Price history, valuation and ownership snapshot"
                          emptyText="No stock detail rows."
                          columns={[
                            { key: "field", label: "Field" },
                            { key: "value", label: "Value", align: "right" },
                          ]}
                          rows={Object.entries(equitiesSpecData.stockDetails || {}).map(([field, value], idx) => ({
                            id: `std-${idx}`,
                            field,
                            value: typeof value === "number" ? Number(value).toLocaleString() : String(value),
                          }))}
                        />
                        <AnalyticsTableCard
                          title="Peer Compare"
                          subtitle="Selected symbol vs peer set"
                          emptyText="No peer rows."
                          columns={[
                            { key: "symbol", label: "Peer" },
                            { key: "pe", label: "P/E", align: "right", render: (v) => Number(v).toFixed(2) },
                            { key: "pb", label: "P/B", align: "right", render: (v) => Number(v).toFixed(2) },
                            { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                          ]}
                          rows={(equitiesSpecData.stockPeers || []).map((row, idx) => ({ id: `peer-${idx}`, ...row }))}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedMainCategory === "funds" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <AnalyticsTableCard
                      title="Institutional Fund Directory"
                      subtitle="Representative funds with AUM, fee, domicile and structure metadata"
                      emptyText="No funds directory data."
                      columns={[
                        {
                          key: "ticker",
                          label: "Ticker",
                          render: (v, row) => (
                            <button
                              type="button"
                              onClick={() => setSelectedFundId(String(v || row?.symbol || row?.id || ""))}
                              style={{ background: "transparent", border: "none", color: "#7dd3fc", cursor: "pointer", padding: 0 }}
                            >
                              {v || row?.symbol || row?.id || "—"}
                            </button>
                          ),
                        },
                        { key: "provider", label: "Provider" },
                        { key: "name", label: "Fund Name" },
                        { key: "domicile", label: "Domicile" },
                        { key: "assetClass", label: "Asset Class" },
                        { key: "type", label: "Type" },
                        { key: "structure", label: "Structure" },
                        { key: "feeBps", label: "Fee (bps)", align: "right", render: (v) => Number(v).toFixed(0) },
                        { key: "aum", label: "AUM", align: "right" },
                        {
                          key: "compare",
                          label: "Compare",
                          align: "right",
                          render: (_v, row) => {
                            const id = String(row?.ticker || row?.symbol || row?.id || "");
                            const selected = compareItems.includes(id);
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setCompareItems((prev) =>
                                    selected ? prev.filter((x) => x !== id) : [...prev.slice(-3), id]
                                  )
                                }
                                style={{
                                  padding: "2px 8px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(148,163,184,0.25)",
                                  background: selected ? "rgba(56,189,248,0.16)" : "rgba(5,5,5,0.4)",
                                  color: selected ? "#7dd3fc" : "#cbd5e1",
                                  fontSize: 11,
                                  cursor: "pointer",
                                }}
                              >
                                {selected ? "Added" : "Add"}
                              </button>
                            );
                          },
                        },
                      ]}
                      rows={filteredEquities.funds}
                    />

                    <AnalyticsTableCard
                      title={`REIT Benchmarks (${equitiesData.reitData?.provider || "Provider"})`}
                      subtitle="Cross-linked from funds allocation context"
                      emptyText="No REIT benchmark data."
                      columns={[
                        { key: "name", label: "Region / Country" },
                        { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr3", label: "3Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr5", label: "5Y", align: "right", render: (v) => formatPercent(v) },
                      ]}
                      rows={filteredEquities.reitBenchmarks}
                    />

                    {selectedFundId ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                        <AnalyticsTableCard
                          title={`Fund Detail: ${selectedFundId}`}
                          subtitle="NAV, benchmark, AUM, expense and inception"
                          emptyText="No fund detail available."
                          columns={[
                            { key: "field", label: "Field" },
                            { key: "value", label: "Value", align: "right" },
                          ]}
                          rows={Object.entries(equitiesSpecData.fundDetail || {}).map(([field, value], idx) => ({
                            id: `fd-${idx}`,
                            field,
                            value: typeof value === "number" ? Number(value).toLocaleString() : String(value),
                          }))}
                        />
                        <AnalyticsTableCard
                          title="Fund Holdings"
                          subtitle="Top holdings transparency"
                          emptyText="No holdings returned."
                          columns={[
                            { key: "symbol", label: "Holding" },
                            { key: "weight", label: "Weight", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                            { key: "sector", label: "Sector" },
                            { key: "region", label: "Region", align: "right" },
                          ]}
                          rows={(equitiesSpecData.fundHoldings || []).map((row, idx) => ({ id: `fh-${idx}`, ...row }))}
                        />
                      </div>
                    ) : null}

                    {compareItems.length > 1 ? (
                      <AnalyticsTableCard
                        title="Fund Compare View"
                        subtitle="Side-by-side comparison for selected items"
                        emptyText="No compare rows."
                        columns={[
                          { key: "id", label: "ID" },
                          { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                          { key: "aum", label: "AUM", align: "right" },
                          { key: "feeBps", label: "Fee (bps)", align: "right", render: (v) => Number(v).toFixed(0) },
                        ]}
                        rows={(equitiesSpecData.fundCompare || []).map((row, idx) => ({ id: row.id || `fc-${idx}`, ...row }))}
                      />
                    ) : null}
                  </div>
                ) : null}

                {selectedMainCategory === "mmf" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        Country scope (schema-backed): Kenya, Nigeria, South Africa
                      </div>
                      <select
                        value={selectedMMFCountry}
                        onChange={(e) => setSelectedMMFCountry(e.target.value)}
                        style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                      >
                        <option value="ALL">All Countries</option>
                        <option value="KE">Kenya (KE)</option>
                        <option value="NG">Nigeria (NG)</option>
                        <option value="ZA">South Africa (ZA)</option>
                      </select>
                    </div>
                    <AnalyticsTableCard
                      title="MMF Directory"
                      subtitle="Dedicated lane for money market funds"
                      emptyText="No MMF rows."
                      columns={[
                        {
                          key: "id",
                          label: "Fund",
                          render: (v, row) => (
                            <button
                              type="button"
                              onClick={() => setSelectedMMFId(String(v || row?.symbol || row?.fundName || ""))}
                              style={{ background: "transparent", border: "none", color: "#7dd3fc", cursor: "pointer", padding: 0 }}
                            >
                              {row?.fundName || row?.name || v || "MMF"}
                            </button>
                          ),
                        },
                        { key: "country", label: "Country" },
                        { key: "currency", label: "Currency" },
                        { key: "yield", label: "Yield", align: "right", render: (v, row) => row?.yieldRange || v || "—" },
                        { key: "maturity", label: "Maturity", align: "right" },
                        { key: "liquidity", label: "Liquidity", align: "right" },
                        { key: "provider", label: "Provider", align: "right" },
                      ]}
                      rows={filteredEquities.mmf}
                    />

                    {selectedMMFId ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                        <AnalyticsTableCard
                          title={`MMF Detail: ${selectedMMFId}`}
                          subtitle="Yield, DLA/WLA, WAM/WAL and redemption terms"
                          emptyText="No MMF detail returned."
                          columns={[
                            { key: "field", label: "Field" },
                            { key: "value", label: "Value", align: "right" },
                          ]}
                          rows={Object.entries(equitiesSpecData.mmfDetail || {}).map(([field, value], idx) => ({
                            id: `md-${idx}`,
                            field,
                            value: typeof value === "number" ? Number(value).toLocaleString() : String(value),
                          }))}
                        />
                        <AnalyticsTableCard
                          title="MMF Liquidity Panel"
                          subtitle="Daily and weekly liquid assets"
                          emptyText="No liquidity rows."
                          columns={[
                            { key: "date", label: "Date" },
                            { key: "dla", label: "DLA", align: "right" },
                            { key: "wla", label: "WLA", align: "right" },
                            { key: "timeToLiquidate", label: "Time to Liquidate", align: "right" },
                          ]}
                          rows={(equitiesSpecData.mmfLiquidity || []).map((row, idx) => ({ id: `ml-${idx}`, ...row }))}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedMainCategory === "reits" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        Country scope (schema-backed): Kenya, Nigeria, South Africa
                      </div>
                      <select
                        value={selectedREITCountry}
                        onChange={(e) => setSelectedREITCountry(e.target.value)}
                        style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                      >
                        <option value="ALL">All Countries</option>
                        <option value="KE">Kenya (KE)</option>
                        <option value="NG">Nigeria (NG)</option>
                        <option value="ZA">South Africa (ZA)</option>
                      </select>
                    </div>
                    <AnalyticsTableCard
                      title="REIT Directory"
                      subtitle="Dedicated REIT lane with property and income metrics"
                      emptyText="No REIT rows."
                      columns={[
                        {
                          key: "symbol",
                          label: "Symbol",
                          render: (v) => (
                            <button
                              type="button"
                              onClick={() => setSelectedSymbol(String(v || ""))}
                              style={{ background: "transparent", border: "none", color: "#7dd3fc", cursor: "pointer", padding: 0 }}
                            >
                              {v || "—"}
                            </button>
                          ),
                        },
                        { key: "country", label: "Country" },
                        { key: "propertyType", label: "Property Type" },
                        { key: "region", label: "Region" },
                        { key: "dividendYield", label: "Yield", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                        { key: "marketCap", label: "Mkt Cap", align: "right", render: (v) => formatCompactMoney(v) },
                      ]}
                      rows={(filteredEquities.reits || []).map((row, idx) => ({ id: row.id || `reit-row-${idx}`, ...row }))}
                    />

                    {selectedSymbol ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                        <AnalyticsTableCard
                          title={`REIT Detail: ${selectedSymbol}`}
                          subtitle="FFO, AFFO, payout ratio, leverage and occupancy"
                          emptyText="No REIT detail returned."
                          columns={[
                            { key: "field", label: "Field" },
                            { key: "value", label: "Value", align: "right" },
                          ]}
                          rows={Object.entries(equitiesSpecData.reitDetail || {}).map(([field, value], idx) => ({
                            id: `rd-${idx}`,
                            field,
                            value: typeof value === "number" ? Number(value).toLocaleString() : String(value),
                          }))}
                        />
                        <AnalyticsTableCard
                          title="REIT Income Metrics"
                          subtitle="Dividend history and FFO/AFFO trend rows"
                          emptyText="No REIT income rows."
                          columns={[
                            { key: "period", label: "Period" },
                            { key: "dividend", label: "Dividend", align: "right" },
                            { key: "payoutRatio", label: "Payout", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                            { key: "ffo", label: "FFO", align: "right" },
                          ]}
                          rows={(equitiesSpecData.reitIncome || []).map((row, idx) => ({ id: `ri-${idx}`, ...row }))}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedMainCategory === "market" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[
                        { key: "benchmarks", label: "Benchmarks" },
                        { key: "sectors", label: "Sectors" },
                        { key: "regions", label: "Regions" },
                        { key: "breadth", label: "Breadth" },
                        { key: "flows", label: "Flows" },
                        { key: "actions", label: "Actions" },
                      ].map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setSelectedMarketView(item.key)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: `1px solid ${selectedMarketView === item.key ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                            background: selectedMarketView === item.key ? "rgba(56,189,248,0.16)" : "rgba(0,0,0,0.55)",
                            color: selectedMarketView === item.key ? "#7dd3fc" : "#cbd5e1",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {selectedMarketView === "benchmarks" ? (
                      <AnalyticsTableCard
                        title="Benchmark History Table"
                        subtitle="Broad market performance and trend"
                        emptyText="No benchmark rows."
                        columns={[
                          { key: "name", label: "Benchmark" },
                          { key: "currency", label: "CCY" },
                          { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                          { key: "weekly", label: "Weekly", align: "right", render: (v) => formatPercent(v) },
                          { key: "monthly", label: "Monthly", align: "right", render: (v) => formatPercent(v) },
                          { key: "annual", label: "Annual", align: "right", render: (v) => formatPercent(v) },
                          { key: "horizon", label: timeRange, align: "right", render: (_v, row) => formatPercent(row?.[rangeKey]) },
                        ]}
                        rows={((equitiesSpecData.marketBenchmarks || []).length ? equitiesSpecData.marketBenchmarks : filteredEquities.benchmarkIndexHistory).map((row, idx) => ({ id: row.id || `mb-${idx}`, ...row }))}
                      />
                    ) : null}

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                      {selectedMarketView === "sectors" ? (
                      <AnalyticsTableCard
                        title="Sector Performance"
                        subtitle="Rotation and net flows by sector"
                        emptyText="No sector performance data."
                        columns={[
                          { key: "sector", label: "Sector" },
                          { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                          { key: "ytd", label: "YTD", align: "right", render: (v) => formatPercent(v) },
                          { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                          { key: "flowUsdBn", label: "Flow ($bn)", align: "right", render: (v) => Number(v).toFixed(2) },
                        ]}
                        rows={((equitiesSpecData.marketSectors || []).length ? equitiesSpecData.marketSectors : filteredEquities.sectorPerformance).map((row, idx) => ({ id: `sec-${idx}`, ...row }))}
                      />
                      ) : null}

                      {selectedMarketView === "regions" ? (
                      <AnalyticsTableCard
                        title="Regional Performance"
                        subtitle="Country/region return spread with currency-aware context"
                        emptyText="No regional performance data."
                        columns={[
                          { key: "region", label: "Region" },
                          { key: "currency", label: "CCY" },
                          { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                          { key: "ytd", label: "YTD", align: "right", render: (v) => formatPercent(v) },
                          { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                          { key: "yr3", label: "3Y", align: "right", render: (v) => formatPercent(v) },
                        ]}
                        rows={((equitiesSpecData.marketRegions || []).length ? equitiesSpecData.marketRegions : filteredEquities.regionalPerformance).map((row, idx) => ({ id: `reg-${idx}`, ...row }))}
                      />
                      ) : null}
                    </div>

                    {selectedMarketView === "flows" ? (
                    <AnalyticsTableCard
                      title="Fund Flows"
                      subtitle="ETF and fund inflows/outflows by segment"
                      emptyText="No flow rows."
                      columns={[
                        { key: "segment", label: "Segment" },
                        { key: "assetClass", label: "Asset Class" },
                        { key: "region", label: "Region" },
                        { key: "period", label: "Period", align: "right" },
                        { key: "netFlowUsdBn", label: "Net Flow ($bn)", align: "right", render: (v) => Number(v).toFixed(2) },
                      ]}
                      rows={((equitiesSpecData.fundFlows || []).length ? equitiesSpecData.fundFlows : filteredEquities.fundFlows).map((row, idx) => ({ id: `flow-${idx}`, ...row }))}
                    />
                    ) : null}

                    {selectedMarketView === "actions" ? (
                    <AnalyticsTableCard
                      title="Corporate Actions"
                      subtitle="Splits, buybacks, M&A and special distributions"
                      emptyText="No corporate action rows."
                      columns={[
                        { key: "date", label: "Date" },
                        { key: "symbol", label: "Ticker" },
                        { key: "action", label: "Action" },
                        { key: "detail", label: "Detail", align: "right" },
                      ]}
                      rows={((equitiesSpecData.marketActions || []).length ? equitiesSpecData.marketActions : filteredEquities.corporateActions).map((row, idx) => ({ id: `ca-${idx}`, ...row }))}
                    />
                    ) : null}

                    {selectedMarketView === "breadth" && (equitiesSpecData.marketBreadth || equitiesData.marketBreadth) ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                        <AnalyticsStatCard title="A/D Line" value={String((equitiesSpecData.marketBreadth || equitiesData.marketBreadth)?.adLine ?? "—")} subvalue="Advance/decline line level" source="Breadth" tone="info" />
                        <AnalyticsStatCard title="New Highs/Lows" value={`${(equitiesSpecData.marketBreadth || equitiesData.marketBreadth)?.newHighs ?? 0} / ${(equitiesSpecData.marketBreadth || equitiesData.marketBreadth)?.newLows ?? 0}`} subvalue="52-week highs vs lows" source="Breadth" tone="neutral" />
                        <AnalyticsStatCard title="% Above 50DMA" value={formatPercent((equitiesSpecData.marketBreadth || equitiesData.marketBreadth)?.above50dmaPct ?? 0)} subvalue="Market participation (short trend)" source="Breadth" tone="positive" />
                        <AnalyticsStatCard title="% Above 200DMA" value={formatPercent((equitiesSpecData.marketBreadth || equitiesData.marketBreadth)?.above200dmaPct ?? 0)} subvalue="Market participation (long trend)" source="Breadth" tone="positive" />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {selectedMainCategory !== "hub" ? (
                  <div style={{ display: "grid", gap: 16 }}>
                    <AnalyticsTableCard
                      title="Benchmark Performance (CAGR)"
                      subtitle="Periodic returns for major equity and REIT indices"
                      emptyText="No benchmark performance data."
                      columns={[
                        { key: "name", label: "Index Name" },
                        { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr3", label: "3Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr5", label: "5Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr10", label: "10Y", align: "right", render: (v) => formatPercent(v) },
                        { key: "yr20", label: "20Y", align: "right", render: (v) => formatPercent(v) },
                      ]}
                      rows={filteredEquities.benchmarkPerformance}
                    />

                    <AnalyticsTableCard
                      title="Historical Annual Total Returns"
                      subtitle="20-year annual series (USD Total Return)"
                      emptyText="No historical returns data."
                      headerExtra={
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#94a3b8" }}>
                            {filteredEquities.annualReturns.length ? annualReturnsPageIndex * ANNUAL_RETURNS_PAGE_SIZE + 1 : 0} - {Math.min((annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE, filteredEquities.annualReturns.length)} of {filteredEquities.annualReturns.length}
                          </span>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              disabled={annualReturnsPageIndex === 0}
                              onClick={() => setAnnualReturnsPageIndex((p) => Math.max(0, p - 1))}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                background: "rgba(5,5,5,0.7)",
                                border: "1px solid rgba(148,163,184,0.2)",
                                color: annualReturnsPageIndex === 0 ? "#475569" : "#e2e8f0",
                                cursor: annualReturnsPageIndex === 0 ? "default" : "pointer",
                                fontSize: 12
                              }}
                            >
                              Prev
                            </button>
                            <button
                              disabled={(annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= filteredEquities.annualReturns.length}
                              onClick={() => setAnnualReturnsPageIndex((p) => p + 1)}
                              style={{
                                padding: "4px 8px",
                                borderRadius: 6,
                                background: "rgba(5,5,5,0.7)",
                                border: "1px solid rgba(148,163,184,0.2)",
                                color: (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= filteredEquities.annualReturns.length ? "#475569" : "#e2e8f0",
                                cursor: (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= filteredEquities.annualReturns.length ? "default" : "pointer",
                                fontSize: 12
                              }}
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      }
                      columns={[
                        { key: "year", label: "Year" },
                        { key: "sp500", label: "S&P 500", align: "right", render: (v) => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                        { key: "msciWorld", label: "MSCI World", align: "right", render: (v) => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                        { key: "msciEm", label: "MSCI EM", align: "right", render: (v) => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                        { key: "reits", label: "REITs (Global)", align: "right", render: (v) => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                      ]}
                      rows={filteredEquities.annualReturns.slice(
                        annualReturnsPageIndex * ANNUAL_RETURNS_PAGE_SIZE,
                        (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE
                      )}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : activeTab === "macro" ? (
            <>
              <div style={{ display: "grid", gap: 18 }}>
                <div className="analytics-card" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div className="analytics-section-title">Macro Intelligence</div>
                    <div className="analytics-card-subtitle">Track country, regional, and global indicators across growth, inflation, rates, labor, FX, and liquidity.</div>
                  </div>
                  <div className="analytics-pill-group">
                    <StatusPill tone="positive">Regime: {regimeLabel || "Expansion"}</StatusPill>
                    <StatusPill tone="info">Score: {Number.isFinite(Number(regimeScore)) ? Number(regimeScore).toFixed(0) : "75"}</StatusPill>
                    <StatusPill tone="neutral">Country: {selectedGeoCode}</StatusPill>
                    <StatusPill tone="purple">{chartRange}</StatusPill>
                  </div>
                </div>

                <ControlPanel
                  title="Dashboard controls"
                  subtitle="Choose the geography, indicator family, display mode, and timeframe."
                  footer={<button type="button" className="analytics-btn primary" onClick={() => setMacroView("chart")}>Update Dashboard</button>}
                >
                  <div className="analytics-control-column">
                    <div className="analytics-card-label">Geography</div>
                    <div className="analytics-pill-group">
                      {["Country", "Region", "Global"].map((type) => (
                        <button key={type} type="button" onClick={() => setSelectedGeoType(type)} className={`analytics-chip-button ${selectedGeoType === type ? "active" : ""}`}>{type}</button>
                      ))}
                    </div>
                    <input className="analytics-input" type="text" placeholder="Search country" value={countrySearch || geoSearchQuery} onChange={(e) => { setCountrySearch(e.target.value); setGeoSearchQuery(e.target.value); }} />
                    <div className="analytics-pill-group">
                      {["USA", "DEU", "JPN", "KEN"].map((code) => (
                        <button key={code} type="button" className={`analytics-chip-button ${selectedGeoCode === code ? "active" : ""}`} onClick={() => setSelectedGeoCode(code)}>{code}</button>
                      ))}
                    </div>
                    <div style={{ display: "grid", gap: 6, maxHeight: 180, overflow: "auto" }}>
                      {(macroGeographies || [])
                        .filter((geo) => selectedGeoType === "Global" ? geo.type === "Global" : geo.type === selectedGeoType)
                        .filter((geo) => !geoSearchQuery || `${geo.name} ${geo.code}`.toLowerCase().includes(geoSearchQuery.toLowerCase()))
                        .slice(0, 8)
                        .map((geo) => (
                          <button
                            key={geo.code}
                            type="button"
                            className={`analytics-chip-button ${selectedGeoCode === geo.code ? "active" : ""}`}
                            style={{ justifyContent: "space-between", height: 36 }}
                            onClick={() => {
                              setSelectedGeoCode(geo.code);
                              setRecentGeoCodes((prev) => [geo.code, ...prev.filter((c) => c !== geo.code)].slice(0, 6));
                            }}
                          >
                            {geo.name} ({geo.code})
                          </button>
                        ))}
                    </div>
                  </div>

                  <div className="analytics-control-column">
                    <div className="analytics-card-label">Indicator</div>
                    <input className="analytics-input" type="text" value={indicatorSearch} onChange={(e) => setIndicatorSearch(e.target.value)} placeholder="Search indicators" />
                    <select className="analytics-select" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                      {MACRO_CATEGORY_OPTIONS.map((cat) => <option key={cat.key} value={cat.key}>{cat.label}</option>)}
                    </select>
                    <select className="analytics-select" value={selectedIndicator} onChange={(e) => setSelectedIndicator(e.target.value)}>
                      {(filteredMacroIndicators.length ? filteredMacroIndicators : macroIndicators).map((indicator) => (
                        <option key={indicator.code} value={indicator.code}>{indicator.name || indicator.code}</option>
                      ))}
                    </select>
                    <select className="analytics-select" value={globalTrendMode} onChange={(e) => setGlobalTrendMode(e.target.value)}>
                      <option value="weighted">Trend mode: Weighted</option>
                      <option value="equal">Trend mode: Equal-weighted</option>
                    </select>
                    <TimeframeSelector options={["1Y", "5Y", "10Y", "MAX"]} value={chartRange} onChange={setChartRange} />
                    <TimeframeSelector options={["levels", "change", "YoY", "MoM"]} value={chartMode} onChange={setChartMode} />
                  </div>
                </ControlPanel>

                <div className="analytics-pill-group">
                  {MACRO_VIEW_OPTIONS.map((view) => (
                    <button key={view.key} type="button" onClick={() => setMacroView(view.key)} className={`analytics-chip-button ${macroView === view.key ? "active" : ""}`}>{view.label}</button>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
                  {(overviewLoading ? [] : (macroOverview || []).slice(0, 5)).map((row, idx) => {
                    const trend = row?.trend || (idx % 3 === 0 ? "Flat" : idx % 3 === 1 ? "Down" : "Up");
                    const label = row?.indicator || row?.name || row?.indicatorCode || "Indicator";
                    const interpretation = String(label).toLowerCase().includes("pmi")
                      ? "Manufacturing is in expansion."
                      : String(label).toLowerCase().includes("cpi")
                      ? "Inflation trend is easing."
                      : String(label).toLowerCase().includes("rate")
                      ? "Policy rate remains restrictive."
                      : "Macro impulse is being monitored.";
                    return (
                      <button
                        key={row.id || `ovc-${idx}`}
                        type="button"
                        onClick={() => {
                          if (row?.indicatorCode) setSelectedIndicator(row.indicatorCode);
                          setMacroView("chart");
                        }}
                        className="analytics-card"
                        style={{ textAlign: "left", cursor: "pointer" }}
                      >
                        <div className="analytics-card-label">{label}</div>
                        <div className="analytics-metric-value" style={{ marginTop: 8 }}>
                          {(() => {
                            const val = Number(row?.value);
                            if (!Number.isFinite(val)) return "—";
                            const absVal = Math.abs(val);
                            if (absVal >= 1e12) return (val / 1e12).toFixed(2) + " T";
                            if (absVal >= 1e9) return (val / 1e9).toFixed(2) + " B";
                            if (absVal >= 1e6) return (val / 1e6).toFixed(2) + " M";
                            return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          })()}
                          {row?.unit && !["B", "M", "T"].includes(row.unit) ? <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>{row.unit}</span> : null}
                        </div>
                        <div style={{ marginTop: 8 }}><StatusPill tone={getTrendTone(trend)}>{trend}</StatusPill></div>
                        <div className="analytics-card-subtitle">{interpretation}</div>
                      </button>
                    );
                  })}
                </div>

                <InsightCard>
                  Growth momentum is expansionary, inflation is easing, and liquidity conditions are tightening. Monitor rate volatility and the US 10Y Treasury for cross-asset risk.
                </InsightCard>
              </div>

              {macroView === "chart" ? (
                <ChartCard
                  title="Macro Time Series"
                  subtitle={`${selectedIndicator} · ${selectedGeoCode} · ${chartRange} (${chartMode})`}
                  rows={macroTimeseries || []}
                >
                  <div className="analytics-chart-footer">
                    <div>
                      <StatusPill tone="info">{(macroTimeseries || []).length} observations</StatusPill>
                    </div>
                    <button
                      type="button"
                      className="analytics-btn secondary"
                      onClick={() => setMacroSourceDataExpanded((v) => !v)}
                    >
                      {macroSourceDataExpanded ? "Hide source data" : "View source data"}
                    </button>
                  </div>
                  {macroSourceDataExpanded ? (
                    <div style={{ marginTop: 14 }}>
                      <DataTable
                        emptyText="No time-series rows."
                        pagination={
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "#94a3b8" }}>
                              {(macroTimeseries || []).length === 0
                                ? "0 - 0"
                                : `${(macroTimeseriesPageIndex * MACRO_TIMESERIES_PAGE_SIZE) + 1} - ${Math.min((macroTimeseriesPageIndex + 1) * MACRO_TIMESERIES_PAGE_SIZE, (macroTimeseries || []).length)}`
                              } of {(macroTimeseries || []).length}
                            </span>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                type="button"
                                disabled={macroTimeseriesPageIndex === 0}
                                onClick={() => setMacroTimeseriesPageIndex((p) => Math.max(0, p - 1))}
                                className="analytics-btn ghost"
                              >
                                Prev
                              </button>
                              <button
                                type="button"
                                disabled={(macroTimeseriesPageIndex + 1) * MACRO_TIMESERIES_PAGE_SIZE >= (macroTimeseries || []).length}
                                onClick={() => setMacroTimeseriesPageIndex((p) => p + 1)}
                                className="analytics-btn ghost"
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        }
                        columns={[
                          { key: "date", label: "Date" },
                          { key: "value", label: "Value", align: "right", render: (v) => Number(v).toFixed(2) },
                        ]}
                        rows={(macroTimeseries || [])
                          .slice(
                            macroTimeseriesPageIndex * MACRO_TIMESERIES_PAGE_SIZE,
                            (macroTimeseriesPageIndex + 1) * MACRO_TIMESERIES_PAGE_SIZE
                          )
                          .map((row, idx) => ({ id: row.id || `ts-${idx}`, ...row }))}
                      />
                    </div>
                  ) : null}
                </ChartCard>
              ) : null}

              {macroView === "compare" ? (
                <AnalyticsTableCard
                  title="Geography Compare"
                  subtitle="Compare selected indicator across geographies"
                  emptyText="No compare rows."
                  headerExtra={
                    <div style={{ display: "grid", gap: 6 }}>
                      <select
                        multiple
                        value={compareGeos}
                        onChange={(e) => setCompareGeos(Array.from(e.target.selectedOptions).map((o) => o.value))}
                        style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, minWidth: 180 }}
                      >
                        {macroGeographies
                          .filter((g) => selectedGeoType === "Global" ? g.type === "Global" : g.type === selectedGeoType)
                          .map((g) => (
                            <option key={g.code} value={g.code}>{g.name} ({g.code})</option>
                          ))}
                      </select>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {(compareGeos || []).map((code) => (
                          <button
                            key={`cmp-chip-${code}`}
                            type="button"
                            onClick={() => setCompareGeos((prev) => prev.filter((c) => c !== code))}
                            style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(5,5,5,0.55)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
                          >
                            {code} ×
                          </button>
                        ))}
                      </div>
                    </div>
                  }
                  columns={[
                    { key: "geo", label: "Geo" },
                    { key: "value", label: "Value", align: "right", render: (v) => Number(v).toFixed(2) },
                    { key: "delta", label: "Delta", align: "right", render: (v) => formatPercent(v) },
                  ]}
                  rows={(macroCompareRows || []).map((row, idx) => ({ id: row.id || `cmp-${idx}`, ...row }))}
                />
              ) : null}

              {macroView === "map" ? (
                <AnalyticsTableCard
                  title="Map View Data"
                  subtitle={`Indicator snapshot map feed · ${selectedIndicator}`}
                  emptyText="No map rows."
                  headerExtra={
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select value={mapIndicator} onChange={(e) => setMapIndicator(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        {(macroIndicators || []).map((ind) => <option key={`map-ind-${ind.code}`} value={ind.code}>{ind.name || ind.code}</option>)}
                      </select>
                      <input type="date" value={mapDate} onChange={(e) => setMapDate(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <select value={mapLayer} onChange={(e) => setMapLayer(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="choropleth">Choropleth</option>
                        <option value="bubble">Bubble</option>
                      </select>
                    </div>
                  }
                  columns={[
                    { key: "geo", label: "Geo" },
                    { key: "value", label: "Value", align: "right", render: (v) => Number(v).toFixed(2) },
                  ]}
                  rows={(macroMapRows || []).map((row, idx) => ({ id: row.id || `map-${idx}`, ...row }))}
                />
              ) : null}

              {macroView === "calendar" ? (
                <AnalyticsTableCard
                  title="Macro Event Calendar"
                  subtitle="Economic releases and event tracking"
                  emptyText="No calendar events."
                  headerExtra={
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <input type="date" value={calendarFilters.from} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, from: e.target.value }))} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <input type="date" value={calendarFilters.to} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, to: e.target.value }))} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <select value={calendarFilters.importance} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, importance: e.target.value }))} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">All Importance</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <select value={calendarFilters.geography} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, geography: e.target.value }))} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">All Geographies</option>
                        {macroGeographies.map((geo) => <option key={`cal-geo-${geo.code}`} value={geo.code}>{geo.code}</option>)}
                      </select>
                      <select value={calendarFilters.indicatorType} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, indicatorType: e.target.value }))} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">All Types</option>
                        {MACRO_CATEGORY_OPTIONS.map((cat) => <option key={`cal-type-${cat.key}`} value={cat.key}>{cat.label}</option>)}
                      </select>
                    </div>
                  }
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "geo", label: "Geo" },
                    { key: "indicator", label: "Indicator" },
                    { key: "importance", label: "Importance", align: "right" },
                    { key: "event", label: "Event", align: "right" },
                  ]}
                  rows={(macroCalendarRows || []).map((row, idx) => ({ id: row.id || `cal-${idx}`, ...row }))}
                />
              ) : null}

              {macroView === "ranking" ? (
                <AnalyticsTableCard
                  title="Indicator Rankings"
                  subtitle={`${selectedIndicator} rank ordering`}
                  emptyText="No rankings rows."
                  headerExtra={
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select value={rankingScope} onChange={(e) => setRankingScope(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">Scope: All</option>
                        <option value="g20">G20</option>
                        <option value="dm">Developed</option>
                        <option value="em">Emerging</option>
                      </select>
                      <select value={rankingSort} onChange={(e) => setRankingSort(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="value_desc">Sort: Highest</option>
                        <option value="value_asc">Sort: Lowest</option>
                        <option value="delta_desc">Sort: Delta</option>
                      </select>
                    </div>
                  }
                  columns={[
                    { key: "rank", label: "Rank" },
                    { key: "geo", label: "Geo" },
                    { key: "value", label: "Value", align: "right", render: (v) => Number(v).toFixed(2) },
                  ]}
                  rows={(macroRankingRows || []).map((row, idx) => ({ id: row.id || `rk-${idx}`, ...row }))}
                />
              ) : null}

              {macroView === "forecast" ? (
                <AnalyticsTableCard
                  title="Forecast View"
                  subtitle={`${selectedGeoCode} forward scenarios for ${selectedIndicator}`}
                  emptyText="No forecast rows."
                  headerExtra={
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setForecastToggle((v) => !v)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: forecastToggle ? "rgba(56,189,248,0.16)" : "rgba(0,0,0,0.55)", color: forecastToggle ? "#7dd3fc" : "#cbd5e1", cursor: "pointer", fontSize: 12 }}
                      >
                        Forecast {forecastToggle ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsensusVisible((v) => !v)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: consensusVisible ? "rgba(56,189,248,0.16)" : "rgba(0,0,0,0.55)", color: consensusVisible ? "#7dd3fc" : "#cbd5e1", cursor: "pointer", fontSize: 12 }}
                      >
                        Consensus {consensusVisible ? "Shown" : "Hidden"}
                      </button>
                    </div>
                  }
                  columns={[
                    { key: "horizon", label: "Horizon" },
                    { key: "base", label: "Base", align: "right", render: (v) => forecastToggle ? Number(v).toFixed(2) : "—" },
                    { key: "bull", label: "Bull", align: "right", render: (v) => forecastToggle ? Number(v).toFixed(2) : "—" },
                    { key: "bear", label: "Bear", align: "right", render: (v) => Number(v).toFixed(2) },
                    { key: "consensus", label: "Consensus", align: "right", render: (v, row) => consensusVisible ? Number(v ?? row.base ?? 0).toFixed(2) : "—" },
                  ]}
                  rows={(macroForecastRows || []).map((row, idx) => ({ id: row.id || `fc-${idx}`, ...row }))}
                />
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                <AnalyticsTableCard
                  title="Macro Indicators"
                  subtitle="Rates, inflation, labor and PMI/yield-curve context"
                  emptyText="No macro indicator rows."
                  columns={[
                    { key: "indicator", label: "Indicator" },
                    { key: "country", label: "Market" },
                    { key: "value", label: "Value", align: "right", render: (v, row) => `${Number(v).toFixed(2)} ${row.unit || ""}`.trim() },
                    {
                      key: "trend",
                      label: "Trend",
                      align: "right",
                      render: (v) => <StatusPill tone={getTrendTone(v)}>{v || "Flat"}</StatusPill>,
                    },
                  ]}
                  rows={(macroData.macroData || []).map((row, idx) => ({ id: `macro-${idx}`, ...row }))}
                />
                <AnalyticsTableCard
                  title="FX Rates"
                  subtitle="Live FX rates. Click a pair to inspect price movement and intervals."
                  emptyText="No FX rows."
                  columns={[
                    { key: "pair", label: "Pair" },
                    { key: "rate", label: "Rate", align: "right", render: (v) => Number(v).toFixed(4) },
                    {
                      key: "daily",
                      label: "Daily",
                      align: "right",
                      render: (v) => {
                        const tone = Number(v) > 0 ? "positive" : Number(v) < 0 ? "negative" : "neutral";
                        return <span style={{ color: getToneColor(tone) }}>{formatPercent(v)}</span>;
                      },
                    },
                    {
                      key: "weekly",
                      label: "Weekly",
                      align: "right",
                      render: (v) => {
                        const tone = Number(v) > 0 ? "positive" : Number(v) < 0 ? "negative" : "neutral";
                        return <span style={{ color: getToneColor(tone) }}>{formatPercent(v)}</span>;
                      },
                    },
                  ]}
                  rows={(macroData.fxRates || []).map((row, idx) => ({ id: `fx-${idx}`, ...row }))}
                  onRowClick={openFxAsset}
                />
              </div>

              <AnalyticsTableCard
                title="Forex Movers"
                subtitle="Top FX gainers and losers from Finviz performance data."
                emptyText="No forex mover rows."
                columns={[
                  { key: "moveType", label: "Side", render: (v) => <StatusPill tone={v === "Gainer" ? "positive" : "negative"}>{v}</StatusPill> },
                  { key: "pair", label: "Pair" },
                  { key: "rate", label: "Rate", align: "right", render: (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(4) : "—" },
                  {
                    key: "daily",
                    label: "Day",
                    align: "right",
                    render: (v) => {
                      const tone = Number(v) > 0 ? "positive" : Number(v) < 0 ? "negative" : "neutral";
                      return <span style={{ color: getToneColor(tone) }}>{formatPercent(v)}</span>;
                    },
                  },
                  {
                    key: "weekly",
                    label: "Week",
                    align: "right",
                    render: (v) => {
                      const tone = Number(v) > 0 ? "positive" : Number(v) < 0 ? "negative" : "neutral";
                      return <span style={{ color: getToneColor(tone) }}>{formatPercent(v)}</span>;
                    },
                  },
                  { key: "source", label: "Source", align: "right" },
                ]}
                rows={forexMoverRows.map((row, idx) => ({ id: `fx-mover-${idx}`, ...row }))}
                onRowClick={openFxAsset}
              />

              <AnalyticsTableCard
                title="Risk Indicators"
                subtitle="Live risk proxy readings from market data."
                emptyText="No risk indicator rows."
                headerExtra={
                  <button
                    type="button"
                    onClick={() => {
                      const id = `alrt-${Date.now()}`;
                      const next = [...alertRules, { id, geo: selectedGeoCode, indicator: selectedIndicator, rule: `Alert when ${selectedIndicator} changes > 2%`, channel: alertChannels.join(","), status: alertStatus }];
                      setAlertRules(next);
                    }}
                    className="analytics-btn primary"
                  >
                    Create Alert
                  </button>
                }
                columns={[
                  { key: "indicator", label: "Indicator" },
                  { key: "value", label: "Value", align: "right", render: (v, row) => `${Number(v).toFixed(2)} ${row.unit || ""}`.trim() },
                  {
                    key: "status",
                    label: "Severity",
                    align: "right",
                    render: (v, row) => {
                      const severity = v || getRiskSeverity(row);
                      const tone = ["Elevated", "Watch", "Tightening"].includes(severity) ? "warning" : severity === "Contained" ? "info" : "neutral";
                      return <StatusPill tone={tone}>{severity}</StatusPill>;
                    },
                  },
                ]}
                rows={(macroData.riskIndicators || []).map((row, idx) => ({ id: `risk-${idx}`, ...row }))}
              />

              <AnalyticsTableCard
                title="Asset Correlation"
                subtitle="Measure how selected macro indicators move with portfolio assets."
                emptyText="No correlation rows."
                headerExtra={
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <select className="analytics-select compact" value={selectedMacroAsset} onChange={(e) => setSelectedMacroAsset(e.target.value)}>
                      {["SPY", "QQQ", "BTC", "GLD", "TLT"].map((asset) => <option key={asset} value={asset}>{asset}</option>)}
                    </select>
                    <select className="analytics-select compact" value={correlationWindow} onChange={(e) => setCorrelationWindow(e.target.value)}>
                      <option value="90d">90D</option>
                      <option value="180d">180D</option>
                      <option value="1y">1Y</option>
                      <option value="3y">3Y</option>
                    </select>
                  </div>
                }
                columns={[
                  { key: "pair", label: "Pair" },
                  {
                    key: "coefficient",
                    label: "Correlation",
                    align: "right",
                    render: (v) => (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span>{Number(v).toFixed(2)}</span>
                        <StatusPill tone={getCorrelationTone(v)}>{Math.abs(Number(v)) >= 0.6 ? "Strong" : Math.abs(Number(v)) <= 0.25 ? "Weak" : Number(v) >= 0 ? "Positive" : "Negative"}</StatusPill>
                      </span>
                    ),
                  },
                  { key: "window", label: "Window", align: "right" },
                ]}
                rows={(macroCorrelationRows || []).map((row, idx) => ({ id: row.id || `mcor-${idx}`, ...row }))}
              />

              {(alertRules || []).length ? (
                <AnalyticsTableCard
                  title="Saved Alert Rules"
                  subtitle="Threshold and event-based macro alerts"
                  emptyText="No macro alert rules yet"
                  headerExtra={
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select className="analytics-select compact" value={alertStatus} onChange={(e) => setAlertStatus(e.target.value)}>
                        <option value="active">Status: Active</option>
                        <option value="paused">Status: Paused</option>
                      </select>
                      <select className="analytics-select compact" value={alertChannels[0] || "in-app"} onChange={(e) => setAlertChannels([e.target.value])}>
                        <option value="in-app">Channel: In-App</option>
                        <option value="email">Channel: Email</option>
                        <option value="webhook">Channel: Webhook</option>
                      </select>
                    </div>
                  }
                  columns={[
                    { key: "geo", label: "Geo" },
                    { key: "indicator", label: "Indicator" },
                    { key: "rule", label: "Rule", align: "right" },
                    { key: "channel", label: "Channel", align: "right" },
                    { key: "status", label: "Status", align: "right", render: (v) => <StatusPill tone={v === "active" ? "success" : "neutral"}>{v}</StatusPill> },
                    {
                      key: "actions",
                      label: "Actions",
                      align: "right",
                      render: (_v, row) => (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => setAlertRules((prev) => prev.map((item) => item.id === row.id ? { ...item, status: item.status === "active" ? "paused" : "active" } : item))}
                            className="analytics-btn ghost"
                          >
                            {row.status === "active" ? "Pause" : "Activate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAlertRules((prev) => prev.filter((item) => item.id !== row.id))}
                            className="analytics-btn danger"
                          >
                            Remove
                          </button>
                        </div>
                      )
                    },
                  ]}
                  rows={(alertRules || []).map((row, idx) => ({ id: row.id || `alert-${idx}`, ...row }))}
                />
              ) : (
                <div className="analytics-card analytics-alert-empty">
                  <div className="analytics-section-title">No macro alert rules yet</div>
                  <div className="analytics-card-subtitle">
                    Create alerts for rate changes, inflation surprises, FX moves, liquidity stress, or regime shifts.
                  </div>
                  <div className="analytics-pill-group">
                    {["CPI YoY > 3.5%", "VIX > 25", "US 10Y > 5%", "USD Liquidity Proxy < -1.0"].map((rule) => (
                      <span key={rule} className="analytics-static-chip">{rule}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="analytics-btn primary"
                      onClick={() => setAlertRules([{ id: `alert-${Date.now()}`, geo: selectedGeoCode, indicator: selectedIndicator, rule: "CPI YoY > 3.5%", channel: "in-app", status: "active" }])}
                    >
                      Create Alert
                    </button>
                    <button type="button" className="analytics-btn secondary">View Examples</button>
                  </div>
                </div>
              )}

              <SourceDrawer
                open={sourceDrawerOpen}
                onToggle={() => setSourceDrawerOpen((v) => !v)}
                sourceInfo={macroSourceInfo}
              />
            </>
          ) : activeTab === "commodities" ? (
            <>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {COMMODITY_GROUPS.map((group) => {
                    const active = selectedCommodityGroup === group;
                    return (
                      <button
                        key={group}
                        type="button"
                        onClick={() => setSelectedCommodityGroup(group)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: active ? "1px solid var(--color-brand-cyan)" : "1px solid var(--color-border-subtle)",
                          background: active ? "rgba(56,189,248,0.16)" : "var(--color-surface-elevated)",
                          color: active ? "var(--color-brand-cyan)" : "var(--color-text-secondary)",
                          cursor: "pointer",
                          fontSize: 12,
                          textTransform: "capitalize",
                        }}
                      >
                        {group}
                      </button>
                    );
                  })}
                  <select
                    value={selectedCommodityRegion}
                    onChange={(e) => setSelectedCommodityRegion(e.target.value)}
                    style={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text-primary)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                  >
                    <option value="global">Global</option>
                    <option value="usa">USA</option>
                    <option value="europe">Europe</option>
                    <option value="asia">Asia</option>
                    <option value="emerging">Emerging</option>
                  </select>
                  <select
                    value={selectedCommodityTimeRange}
                    onChange={(e) => setSelectedCommodityTimeRange(e.target.value)}
                    style={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text-primary)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                  >
                    <option value="1M">1M</option>
                    <option value="3M">3M</option>
                    <option value="1Y">1Y</option>
                    <option value="5Y">5Y</option>
                    <option value="MAX">MAX</option>
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <AnalyticsStatCard
                    title="Tracked Contracts"
                    value={String(filteredCommodities.rows.length)}
                    subvalue="Contracts in selected group"
                    source="Commodities"
                    tone="info"
                  />
                  <AnalyticsStatCard
                    title="Top Mover"
                    value={filteredCommodities.movers[0]?.symbol || "—"}
                    subvalue={formatPercent(filteredCommodities.movers[0]?.dailyChangePct)}
                    source="Daily move"
                    tone={Number(filteredCommodities.movers[0]?.dailyChangePct) >= 0 ? "positive" : "negative"}
                  />
                  <AnalyticsStatCard
                    title="Flow Mode"
                    value={commodityFlowMode.toUpperCase()}
                    subvalue="ETF, fund or futures positioning"
                    source="Flows"
                    tone="neutral"
                  />
                  <AnalyticsStatCard
                    title="Active Symbol"
                    value={selectedCommoditySymbol || "—"}
                    subvalue="Selected commodity detail view"
                    source="Detail"
                    tone="info"
                  />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    type="text"
                    placeholder="Search commodity (symbol, name, group)"
                    value={commoditySearchQuery}
                    onChange={(e) => setCommoditySearchQuery(e.target.value)}
                    style={{
                      flex: "1 1 280px",
                      minWidth: 220,
                      background: "rgba(5,5,5,0.75)",
                      border: "1px solid rgba(148,163,184,0.2)",
                      color: "#e2e8f0",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                    }}
                  />
                  <select
                    value={commodityFlowMode}
                    onChange={(e) => setCommodityFlowMode(e.target.value)}
                    style={{ background: "var(--color-surface-elevated)", border: "1px solid var(--color-border-subtle)", color: "var(--color-text-primary)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                  >
                    <option value="etf">ETF flows</option>
                    <option value="fund">Fund flows</option>
                    <option value="futures">Futures positioning</option>
                  </select>
                </div>

                {(commoditySearchRows || []).length ? (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {commoditySearchRows.slice(0, 8).map((row, idx) => {
                      const symbol = String(row?.symbol || row?.ticker || "");
                      return (
                        <button
                          key={`cmd-sr-${symbol || idx}`}
                          type="button"
                          onClick={() => {
                            if (!symbol) return;
                            setSelectedCommoditySymbol(symbol);
                            setCompareCommoditySymbols((prev) => (prev.includes(symbol) ? prev : [...prev.slice(-3), symbol]));
                          }}
                          style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid var(--color-border-subtle)", background: "var(--color-surface-elevated)", color: "var(--color-text-secondary)", fontSize: 11, cursor: "pointer" }}
                        >
                          {row?.name || symbol} ({symbol})
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {COMMODITY_VIEWS.map((view) => {
                    const active = selectedCommodityView === view;
                    return (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setSelectedCommodityView(view)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: `1px solid ${active ? "var(--color-brand-cyan)" : "var(--color-border-subtle)"}`,
                          background: active ? "rgba(56,189,248,0.16)" : "var(--color-surface-elevated)",
                          color: active ? "var(--color-brand-cyan)" : "var(--color-text-secondary)",
                          cursor: "pointer",
                          fontSize: 12,
                          textTransform: "capitalize",
                        }}
                      >
                        {view}
                      </button>
                    );
                  })}
                </div>
              </div>

              <AnalyticsTableCard
                title="Commodities Landing Hub"
                subtitle="Group, region, pricing and return context"
                emptyText="No commodity rows."
                headerExtra={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>
                      {(commodityAssetsPageIndex * COMMODITY_ASSETS_PAGE_SIZE) + 1}
                      {" - "}
                      {Math.min((commodityAssetsPageIndex + 1) * COMMODITY_ASSETS_PAGE_SIZE, (filteredCommodities.rows || []).length)}
                      {" of "}
                      {(filteredCommodities.rows || []).length}
                    </span>
                    <button
                      type="button"
                      disabled={commodityAssetsPageIndex === 0}
                      onClick={() => setCommodityAssetsPageIndex((p) => Math.max(0, p - 1))}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        background: "rgba(5,5,5,0.7)",
                        border: "1px solid rgba(148,163,184,0.2)",
                        color: commodityAssetsPageIndex === 0 ? "#475569" : "#e2e8f0",
                        cursor: commodityAssetsPageIndex === 0 ? "default" : "pointer",
                        fontSize: 12
                      }}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      disabled={(commodityAssetsPageIndex + 1) * COMMODITY_ASSETS_PAGE_SIZE >= (filteredCommodities.rows || []).length}
                      onClick={() => setCommodityAssetsPageIndex((p) => p + 1)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        background: "rgba(5,5,5,0.7)",
                        border: "1px solid rgba(148,163,184,0.2)",
                        color: (commodityAssetsPageIndex + 1) * COMMODITY_ASSETS_PAGE_SIZE >= (filteredCommodities.rows || []).length ? "#475569" : "#e2e8f0",
                        cursor: (commodityAssetsPageIndex + 1) * COMMODITY_ASSETS_PAGE_SIZE >= (filteredCommodities.rows || []).length ? "default" : "pointer",
                        fontSize: 12
                      }}
                    >
                      Next
                    </button>
                  </div>
                }
                columns={[
                  {
                    key: "symbol",
                    label: "Symbol",
                    render: (v) => (
                      <button
                        type="button"
                        onClick={() => setSelectedCommoditySymbol(String(v || ""))}
                        style={{ background: "transparent", border: "none", color: "#7dd3fc", cursor: "pointer", padding: 0 }}
                      >
                        {v || "—"}
                      </button>
                    ),
                  },
                  { key: "name", label: "Name" },
                  { key: "group", label: "Group", align: "right" },
                  { key: "latestPrice", label: "Price", align: "right", render: (v) => formatMoney(v, 2) },
                  { key: "dailyChangePct", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                  { key: "ytdChangePct", label: "YTD", align: "right", render: (v) => formatPercent(v) },
                  { key: "oneYearReturnPct", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                ]}
                rows={(filteredCommodities.rows || [])
                  .slice(
                    commodityAssetsPageIndex * COMMODITY_ASSETS_PAGE_SIZE,
                    (commodityAssetsPageIndex + 1) * COMMODITY_ASSETS_PAGE_SIZE
                  )
                  .map((row, idx) => ({ id: row.id || `cmd-${idx}`, ...row }))}
              />

              {selectedCommodityView === "price" ? (
                <AnalyticsTableCard
                  title={`Time Series • ${selectedCommoditySymbol}`}
                  subtitle="Historical price series"
                  emptyText="No price series."
                  headerExtra={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>
                        {(commoditiesData.priceSeries || []).length === 0
                          ? "0 of 0"
                          : `${commodityPriceSeriesPageIndex * COMMODITY_PRICE_SERIES_PAGE_SIZE + 1} - ${Math.min(
                              (commodityPriceSeriesPageIndex + 1) * COMMODITY_PRICE_SERIES_PAGE_SIZE,
                              (commoditiesData.priceSeries || []).length
                            )} of ${(commoditiesData.priceSeries || []).length}`}
                      </span>
                      <button
                        type="button"
                        disabled={commodityPriceSeriesPageIndex === 0}
                        onClick={() => setCommodityPriceSeriesPageIndex((p) => Math.max(0, p - 1))}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(5,5,5,0.7)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          color: commodityPriceSeriesPageIndex === 0 ? "#475569" : "#e2e8f0",
                          cursor: commodityPriceSeriesPageIndex === 0 ? "default" : "pointer",
                          fontSize: 12
                        }}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={(commodityPriceSeriesPageIndex + 1) * COMMODITY_PRICE_SERIES_PAGE_SIZE >= (commoditiesData.priceSeries || []).length}
                        onClick={() => setCommodityPriceSeriesPageIndex((p) => p + 1)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(5,5,5,0.7)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          color: (commodityPriceSeriesPageIndex + 1) * COMMODITY_PRICE_SERIES_PAGE_SIZE >= (commoditiesData.priceSeries || []).length ? "#475569" : "#e2e8f0",
                          cursor: (commodityPriceSeriesPageIndex + 1) * COMMODITY_PRICE_SERIES_PAGE_SIZE >= (commoditiesData.priceSeries || []).length ? "default" : "pointer",
                          fontSize: 12
                        }}
                      >
                        Next
                      </button>
                    </div>
                  }
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "value", label: "Price", align: "right", render: (v) => formatMoney(v, 2) },
                  ]}
                  rows={(commoditiesData.priceSeries || [])
                    .slice(
                      commodityPriceSeriesPageIndex * COMMODITY_PRICE_SERIES_PAGE_SIZE,
                      (commodityPriceSeriesPageIndex + 1) * COMMODITY_PRICE_SERIES_PAGE_SIZE
                    )
                    .map((row, idx) => ({ id: row.id || `cmd-ts-${commodityPriceSeriesPageIndex}-${idx}`, ...row }))}
                />
              ) : null}

              {selectedCommodityView === "flows" ? (
                <AnalyticsTableCard
                  title={`Commodity Flows • ${selectedCommoditySymbol}`}
                  subtitle="ETF, fund and futures positioning context"
                  emptyText="No flow rows."
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "type", label: "Type" },
                    { key: "value", label: "Value", align: "right", render: (v) => formatCompactMoney(v) },
                    { key: "trend", label: "Trend", align: "right" },
                    { key: "sourceType", label: "Source Type", align: "right" },
                  ]}
                  rows={(commoditiesData.flows || []).map((row, idx) => ({ id: row.id || `cmd-fl-${idx}`, ...row }))}
                />
              ) : null}

              {selectedCommodityView === "seasonality" ? (
                <AnalyticsTableCard
                  title={`Seasonality • ${selectedCommoditySymbol}`}
                  subtitle="Month-by-month tendency"
                  emptyText="No seasonality rows."
                  headerExtra={
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>
                        {(commoditiesData.seasonality || []).length === 0
                          ? "0 of 0"
                          : `${commoditySeasonalityPageIndex * COMMODITY_SEASONALITY_PAGE_SIZE + 1} - ${Math.min(
                              (commoditySeasonalityPageIndex + 1) * COMMODITY_SEASONALITY_PAGE_SIZE,
                              (commoditiesData.seasonality || []).length
                            )} of ${(commoditiesData.seasonality || []).length}`}
                      </span>
                      <button
                        type="button"
                        disabled={commoditySeasonalityPageIndex === 0}
                        onClick={() => setCommoditySeasonalityPageIndex((p) => Math.max(0, p - 1))}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(5,5,5,0.7)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          color: commoditySeasonalityPageIndex === 0 ? "#475569" : "#e2e8f0",
                          cursor: commoditySeasonalityPageIndex === 0 ? "default" : "pointer",
                          fontSize: 12
                        }}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        disabled={(commoditySeasonalityPageIndex + 1) * COMMODITY_SEASONALITY_PAGE_SIZE >= (commoditiesData.seasonality || []).length}
                        onClick={() => setCommoditySeasonalityPageIndex((p) => p + 1)}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(5,5,5,0.7)",
                          border: "1px solid rgba(148,163,184,0.2)",
                          color: (commoditySeasonalityPageIndex + 1) * COMMODITY_SEASONALITY_PAGE_SIZE >= (commoditiesData.seasonality || []).length ? "#475569" : "#e2e8f0",
                          cursor: (commoditySeasonalityPageIndex + 1) * COMMODITY_SEASONALITY_PAGE_SIZE >= (commoditiesData.seasonality || []).length ? "default" : "pointer",
                          fontSize: 12
                        }}
                      >
                        Next
                      </button>
                    </div>
                  }
                  columns={[
                    { key: "month", label: "Month" },
                    { key: "avgReturnPct", label: "Avg Return", align: "right", render: (v) => formatPercent(v) },
                    { key: "seasonalityScore", label: "Score", align: "right", render: (v) => Number(v).toFixed(2) },
                    { key: "sourceType", label: "Source Type", align: "right" },
                  ]}
                  rows={(commoditiesData.seasonality || [])
                    .slice(
                      commoditySeasonalityPageIndex * COMMODITY_SEASONALITY_PAGE_SIZE,
                      (commoditySeasonalityPageIndex + 1) * COMMODITY_SEASONALITY_PAGE_SIZE
                    )
                    .map((row, idx) => ({ id: row.id || `cmd-sn-${commoditySeasonalityPageIndex}-${idx}`, ...row }))}
                />
              ) : null}

              {selectedCommodityView === "curve" ? (
                <AnalyticsTableCard
                  title={`Futures Curve • ${selectedCommoditySymbol}`}
                  subtitle="Contract structure and spread"
                  emptyText="No curve rows."
                  columns={[
                    { key: "contract", label: "Contract" },
                    { key: "price", label: "Price", align: "right", render: (v) => formatMoney(v, 2) },
                    { key: "spread", label: "Spread", align: "right", render: (v) => formatPercent(v) },
                    { key: "curveStructure", label: "Structure", align: "right" },
                    { key: "sourceType", label: "Source Type", align: "right" },
                  ]}
                  rows={(commoditiesData.curve || []).map((row, idx) => ({ id: row.id || `cmd-cv-${idx}`, ...row }))}
                />
              ) : null}

              {selectedCommodityView === "compare" ? (
                <AnalyticsTableCard
                  title="Commodity Compare"
                  subtitle="Cross-commodity return and risk comparison"
                  emptyText="No compare rows."
                  columns={[
                    { key: "symbol", label: "Symbol" },
                    { key: "name", label: "Name" },
                    { key: "dailyChangePct", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                    { key: "ytdChangePct", label: "YTD", align: "right", render: (v) => formatPercent(v) },
                    { key: "volatility", label: "Volatility", align: "right", render: (v) => Number(v).toFixed(2) },
                  ]}
                  rows={((commoditiesData.compare || []).length ? commoditiesData.compare : filteredCommodities.rows.filter((row) => compareCommoditySymbols.includes(row.symbol))).map((row, idx) => ({ id: row.id || `cmd-cm-${idx}`, ...row }))}
                />
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
                <AnalyticsTableCard
                  title={`Fundamentals • ${selectedCommoditySymbol}`}
                  subtitle="Inventory, production and demand metrics"
                  emptyText="No fundamental rows."
                  columns={[
                    { key: "metric", label: "Metric" },
                    { key: "value", label: "Value", align: "right", render: (v) => Number(v).toLocaleString() },
                    { key: "unit", label: "Unit", align: "right" },
                  ]}
                  rows={(commoditiesData.fundamentals || []).map((row, idx) => ({ id: row.id || `cmd-fn-${idx}`, ...row }))}
                />
                <AnalyticsTableCard
                  title="Event Calendar & Alerts"
                  subtitle="Upcoming catalysts and threshold rules"
                  emptyText="No calendar/alert rows."
                  headerExtra={
                    <button
                      type="button"
                      onClick={() =>
                        setCommodityAlertRules((prev) => [
                          ...prev.slice(-9),
                          {
                            id: `cmd-alert-${Date.now()}`,
                            symbol: selectedCommoditySymbol,
                            rule: `Trigger when ${selectedCommoditySymbol} daily change > 2%`,
                            status: "active",
                            sourceType: "Your own rule engine",
                          },
                        ])
                      }
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(56,189,248,0.5)", background: "rgba(56,189,248,0.16)", color: "#7dd3fc", cursor: "pointer", fontSize: 12 }}
                    >
                      Add Alert
                    </button>
                  }
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "event", label: "Event" },
                    { key: "importance", label: "Importance", align: "right" },
                    { key: "sourceType", label: "Source Type", align: "right" },
                  ]}
                  rows={[
                    ...(commoditiesData.calendar || []).map((row, idx) => ({ id: row.id || `cmd-cal-${idx}`, date: row.date, event: row.event || row.title, importance: row.importance || "medium", sourceType: row.sourceType || "Economic calendar API" })),
                    ...(commodityAlertRules || []).map((row, idx) => ({ id: row.id || `cmd-al-${idx}`, date: "Alert", event: row.rule || row.name, importance: row.status || "active", sourceType: row.sourceType || "Your own rule engine" })),
                  ]}
                />
              </div>
            </>
          ) : null}
        </>
      )}
      {selectedFxAsset ? (
        <AssetModal
          asset={selectedFxAsset}
          onClose={() => setSelectedFxAsset(null)}
          onConfirm={() => setSelectedFxAsset(null)}
          portfolio={[]}
          balance={0}
          cashBalances={{}}
          trades={[]}
          spotPrices={{}}
        />
      ) : null}
    </AnalyticsLayout>
  );
}

function GeographySwitcher({ selectedGeoType, onChange, regimeLabel, regimeScore, regimeExplain }) {
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap"
      }}
    >
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {["Country", "Region", "Global"].map((type) => (
          <button
            key={type}
            onClick={() => onChange(type)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${selectedGeoType === type ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
              background: selectedGeoType === type ? "rgba(56,189,248,0.16)" : "rgba(0,0,0,0.55)",
              color: selectedGeoType === type ? "#7dd3fc" : "#cbd5e1",
              cursor: "pointer",
              fontSize: 12
            }}
          >
            {type}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", textTransform: "capitalize" }}>
        Regime: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{regimeLabel}</span>
        {Number.isFinite(Number(regimeScore)) ? (
          <span style={{ marginLeft: 8, color: "#7dd3fc" }}>Score {Number(regimeScore).toFixed(0)}</span>
        ) : null}
      </div>
      {regimeExplain ? (
        <div style={{ width: "100%", fontSize: 11, color: "#94a3b8" }}>{regimeExplain}</div>
      ) : null}
    </div>
  );
}

function GeographySearch({
  geographies,
  selectedGeoType,
  selectedGeoCode,
  searchQuery,
  onSearchChange,
  onSelectGeo,
  favoriteGeoCodes,
  recentGeoCodes,
  onToggleFavorite,
}) {
  const scoped = (geographies || []).filter((g) => selectedGeoType === "Global" ? g.type === "Global" : g.type === selectedGeoType);
  const filtered = scoped.filter((geo) => {
    const q = String(searchQuery || "").trim().toLowerCase();
    if (!q) return true;
    return String(geo?.name || "").toLowerCase().includes(q) || String(geo?.code || "").toLowerCase().includes(q);
  });

  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
      }}
    >
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Geography Search</div>
      <input
        type="text"
        placeholder={`Search ${selectedGeoType.toLowerCase()}...`}
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{ width: "100%", background: "rgba(5,5,5,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {recentGeoCodes.slice(0, 5).map((code) => (
          <button
            key={`recent-${code}`}
            type="button"
            onClick={() => onSelectGeo(code)}
            style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(5,5,5,0.5)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
          >
            Recent: {code}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 200, overflowY: "auto", display: "grid", gap: 6 }}>
        {filtered.map((geo) => {
          const active = selectedGeoCode === geo.code;
          const fav = favoriteGeoCodes.includes(geo.code);
          return (
            <div
              key={geo.code}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                borderRadius: 8,
                padding: "7px 8px",
                border: `1px solid ${active ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.16)"}`,
                background: active ? "rgba(56,189,248,0.12)" : "rgba(5,5,5,0.45)"
              }}
            >
              <button
                type="button"
                onClick={() => onSelectGeo(geo.code)}
                style={{ background: "transparent", border: "none", color: active ? "#7dd3fc" : "#e2e8f0", textAlign: "left", padding: 0, cursor: "pointer", fontSize: 12, flex: 1 }}
              >
                {geo.name} ({geo.code})
              </button>
              <button
                type="button"
                onClick={() => onToggleFavorite(geo.code)}
                style={{ background: "transparent", border: "none", color: fav ? "#fbbf24" : "#64748b", cursor: "pointer", fontSize: 13 }}
                title={fav ? "Unpin favorite" : "Pin favorite"}
              >
                ★
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalyticsLayout({ eyebrow, title, description, updatedAt, activeTab, onTabChange, toolbar, children }) {
  return (
    <div className="analytics-layout">
      <section className="analytics-page-header">
        <div>
          <div className="analytics-eyebrow">{eyebrow}</div>
          <h2 className="analytics-page-title">{title}</h2>
          <p className="analytics-page-description">{description}</p>
        </div>
        <div className="analytics-header-meta">
          <span>Last update</span>
          <strong>{formatDateTime(updatedAt)}</strong>
        </div>
      </section>
      <AssetClassTabs tabs={CATEGORY_TABS} activeTab={activeTab} onChange={onTabChange} />
      {toolbar ? <div className="analytics-toolbar">{toolbar}</div> : null}
      <div className="analytics-main-grid">{children}</div>
    </div>
  );
}

function AssetClassTabs({ tabs, activeTab, onChange }) {
  return (
    <section className="analytics-tab-section">
      <div className="analytics-tab-list">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`analytics-tab-pill ${active ? "active" : ""}`}
              title={tab.description}
            >
              <span className="analytics-tab-icon">{tab.icon}</span>
              <span className="analytics-tab-pill-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatusPill({ children, tone = "neutral" }) {
  return (
    <span className={`analytics-status-pill ${tone}`}>
      {children}
    </span>
  );
}

function MetricCard({ icon, label, value, helper, chip, tone = "neutral" }) {
  const color = getToneColor(tone);
  return (
    <div className={`analytics-card analytics-metric-card ${tone}`}>
      <div className="analytics-metric-topline">
        <span className="analytics-metric-icon" style={{ color }}>{icon || label?.slice(0, 1) || "•"}</span>
        {chip ? <StatusPill tone={tone}>{chip}</StatusPill> : null}
      </div>
      <div className="analytics-card-label">{label}</div>
      <div className="analytics-metric-value" style={{ color }}>{value}</div>
      {helper ? <div className="analytics-metric-helper">{helper}</div> : null}
    </div>
  );
}

function AnalyticsStatCard({ title, value, subvalue, source, tone = "neutral" }) {
  return (
    <MetricCard
      icon={title?.slice(0, 1)}
      label={title}
      value={value}
      helper={subvalue}
      chip={source}
      tone={tone}
    />
  );
}

function InsightCard({ title = "What this means", children, tone = "info" }) {
  return (
    <div className={`analytics-card analytics-insight-card ${tone}`}>
      <div className="analytics-card-label">{title}</div>
      <div className="analytics-insight-copy">{children}</div>
    </div>
  );
}

function ControlPanel({ title, subtitle, children, footer }) {
  return (
    <div className="analytics-card analytics-control-panel">
      <div className="analytics-card-head">
        <div>
          <div className="analytics-section-title">{title}</div>
          {subtitle ? <div className="analytics-card-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="analytics-control-grid">{children}</div>
      {footer ? <div className="analytics-control-footer">{footer}</div> : null}
    </div>
  );
}

function EmptyState({ title = "No data available", description, cta, onAction }) {
  return (
    <div className="analytics-empty-state">
      <div className="analytics-empty-title">{title}</div>
      {description ? <div className="analytics-empty-description">{description}</div> : null}
      {cta ? (
        <button type="button" className="analytics-btn secondary" onClick={onAction}>
          {cta}
        </button>
      ) : null}
    </div>
  );
}

function LoadingSkeleton({ label = "Loading analytics..." }) {
  return (
    <div className="analytics-card analytics-loading-skeleton">
      <div className="analytics-skeleton-line wide" />
      <div className="analytics-skeleton-line" />
      <div className="analytics-skeleton-label">{label}</div>
    </div>
  );
}

function ErrorState({ title = "Couldn't load data", description, onRetry }) {
  return (
    <div className="analytics-card analytics-error-state">
      <div className="analytics-empty-title">{title}</div>
      <div className="analytics-empty-description">{description || "Check your connection or try again."}</div>
      <button type="button" className="analytics-btn warning" onClick={onRetry}>Retry</button>
    </div>
  );
}

function TimeframeSelector({ options, value, onChange }) {
  return (
    <div className="analytics-pill-group">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`analytics-chip-button ${value === option ? "active" : ""}`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function DataTable({ columns, rows = [], emptyText, loading = false, filters, pagination, exportLabel, onRowClick }) {
  if (loading) return <LoadingSkeleton label="Loading table rows..." />;
  const actions = (filters || pagination || exportLabel) ? (
    <div className="analytics-table-actions">
      {filters ? <div className="analytics-pill-group">{filters}</div> : <span />}
      <div className="analytics-table-action-right">
        {pagination}
        {exportLabel ? <button type="button" className="analytics-btn ghost">{exportLabel}</button> : null}
      </div>
    </div>
  ) : null;

  if (!rows.length) {
    return (
      <>
        {actions}
        <EmptyState
          title={emptyText || "No data available"}
          description="Try changing filters, timeframe, or data source."
        />
      </>
    );
  }

  return (
    <>
      {actions}
      <div className="analytics-table-wrap">
        <table className="analytics-data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.align === "right" ? "numeric" : ""}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.id || `row-${idx}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row);
                  }
                } : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? "button" : undefined}
                className={onRowClick ? "analytics-clickable-row" : ""}
              >
                {columns.map((column) => {
                  const cellValue = row[column.key];
                  return (
                    <td key={column.key} className={column.align === "right" ? "numeric" : ""}>
                      {column.render
                        ? column.render(cellValue, row)
                        : typeof cellValue === "object" && cellValue !== null
                        ? JSON.stringify(cellValue)
                        : cellValue ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AnalyticsTableCard({ title, subtitle, columns, rows = [], emptyText, headerExtra, filters, pagination, loading, exportLabel, onRowClick }) {
  return (
    <div className="analytics-card analytics-table-card">
      {(title || subtitle || headerExtra) ? (
        <div className="analytics-card-head">
        <div>
          {title ? <div className="analytics-section-title">{title}</div> : null}
          {subtitle ? <div className="analytics-card-subtitle">{subtitle}</div> : null}
        </div>
        {headerExtra ? <div className="analytics-card-actions">{headerExtra}</div> : null}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        emptyText={emptyText}
        loading={loading}
        filters={filters}
        pagination={pagination}
        exportLabel={exportLabel}
        onRowClick={onRowClick}
      />
    </div>
  );
}

function ChartCard({ title, subtitle, rows = [], color = "#22D3EE", children }) {
  const values = rows.map((row) => Number(row?.value)).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const spread = max - min || 1;
  const latest = rows.length ? rows[rows.length - 1] : null;
  const points = rows.slice(-80).map((row, idx, arr) => {
    const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * 100;
    const y = 92 - ((Number(row?.value) - min) / spread) * 76;
    return `${x},${Number.isFinite(y) ? y : 50}`;
  }).join(" ");
  return (
    <div className="analytics-card analytics-chart-card">
      <div className="analytics-card-head">
        <div>
          <div className="analytics-section-title">{title}</div>
          {subtitle ? <div className="analytics-card-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      {rows.length ? (
        <div className="analytics-chart-shell">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="analytics-line-chart" role="img" aria-label={title}>
            <defs>
              <linearGradient id={`chart-fill-${String(title).replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          </svg>
          {latest ? (
            <div className="analytics-chart-tooltip">
              <span>{latest.date || "Latest"}</span>
              <strong>{Number(latest.value).toFixed(2)}</strong>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState title="No chart data available" description="Try a different geography, indicator, or timeframe." />
      )}
      {children}
    </div>
  );
}

function SourceDrawer({ open, onToggle, sourceInfo }) {
  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <div>
          <div className="analytics-section-title">Methodology & Sources</div>
          <div className="analytics-card-subtitle">Compact source notes for trust and transparency</div>
        </div>
        <button type="button" className="analytics-btn secondary" onClick={onToggle}>
          {open ? "Hide sources" : "Show sources"}
        </button>
      </div>
      {open ? (
        <DataTable
          emptyText="No source data."
          columns={[
            { key: "field", label: "Field" },
            { key: "value", label: "Value", align: "right" },
          ]}
          rows={sourceInfo ? [
            { id: "src-1", field: "Data source name", value: sourceInfo.source || sourceInfo.provider || "Macro data provider" },
            { id: "src-2", field: "Update frequency", value: sourceInfo.frequency || "Daily to monthly, depending on release schedule" },
            { id: "src-3", field: "Calculation method", value: sourceInfo.methodology || sourceInfo.note || "Normalized indicator values by geography and timeframe" },
            { id: "src-4", field: "Last refreshed", value: formatDateTime(sourceInfo.updatedAt || sourceInfo.lastRefreshed) },
            { id: "src-5", field: "Disclaimer", value: sourceInfo.disclaimer || "For research and monitoring only. Validate source releases before trading decisions." },
          ] : []}
        />
      ) : null}
    </div>
  );
}

function ActionCenterCard({ title = "Action Center", children, tone = "warning" }) {
  return (
    <InsightCard title={title} tone={tone}>
      {children}
    </InsightCard>
  );
}
