// src/components/AnalyticsModule.jsx
import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const CATEGORY_TABS = [
  { id: "crypto", label: "Crypto", description: "Hyperliquid, Bybit, Binance + Dune analytics" },
  { id: "options", label: "Options", description: "Binance + Deribit options data" },
  { id: "equities", label: "Equities", description: "Asset Classes, Industries, Regions" },
  { id: "macro", label: "Macro", description: "Macro indicators, FX and risk context" },
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

const EMPTY_MACRO = {
  updatedAt: null,
  macroData: [],
  fxRates: [],
  riskIndicators: [],
};

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

function formatMoney(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatCompactMoney(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(amount);
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
    riskIndicators: Array.isArray(payload?.riskIndicators) ? payload.riskIndicators : [],
  };
}



export function AnalyticsModule({ backendUrl }) {
  const [activeTab, setActiveTab] = useState("crypto");
  const [cryptoData, setCryptoData] = useState(EMPTY_CRYPTO);
  const [optionsData, setOptionsData] = useState(EMPTY_OPTIONS);
  const [equitiesData, setEquitiesData] = useState(EMPTY_EQUITIES);
  const [macroData, setMacroData] = useState(EMPTY_MACRO);
  const [loading, setLoading] = useState({ crypto: false, options: false, equities: false, macro: false });
  const [errors, setErrors] = useState({ crypto: "", options: "", equities: "", macro: "" });
  
  const [etfAssetToggle, setEtfAssetToggle] = useState("All");
  const [etfPeriodToggle, setEtfPeriodToggle] = useState("daily");
  const [selectedPerpExchange, setSelectedPerpExchange] = useState("Hyperliquid");
  const [annualReturnsPageIndex, setAnnualReturnsPageIndex] = useState(0);
  const [equityHorizon, setEquityHorizon] = useState("yr1");
  const [equitiesDetailSelector, setEquitiesDetailSelector] = useState("");
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
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const ANNUAL_RETURNS_PAGE_SIZE = 10;

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

    const rangePoints = chartRange === "1Y" ? 12 : chartRange === "5Y" ? 24 : chartRange === "10Y" ? 40 : 60;
    const buildFallbackSeries = () => {
      const now = Date.now();
      return Array.from({ length: rangePoints }, (_, i) => {
        const ts = now - ((rangePoints - i) * 30 * 24 * 60 * 60 * 1000);
        const level = 100 + (i * 0.65) + Math.sin(i / 2) * 2.2;
        return { date: new Date(ts).toISOString().slice(0, 10), value: Number(level.toFixed(2)) };
      });
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
      setMacroTimeseries(tsRows.length ? tsRows : buildFallbackSeries());

      const compareRows = Array.isArray(compareRes?.rows) ? compareRes.rows : Array.isArray(compareRes) ? compareRes : [];
      setMacroCompareRows(compareRows.length ? compareRows : (compareGeos || []).map((code, idx) => ({ id: `cmp-${idx}`, geo: code, value: 95 + idx * 1.8, delta: (idx - 1) * 0.5 })));

      const calendarRows = Array.isArray(calendarRes?.events) ? calendarRes.events : Array.isArray(calendarRes) ? calendarRes : [];
      setMacroCalendarRows(calendarRows.length ? calendarRows : [
        { id: "cal-1", date: calendarFilters.from, geo: selectedGeoCode, indicator: selectedIndicator, importance: "high", event: "Data release window opens" },
        { id: "cal-2", date: calendarFilters.to, geo: selectedGeoCode, indicator: selectedIndicator, importance: "medium", event: "Consensus update due" },
      ]);

      const mapRows = Array.isArray(mapRes?.rows) ? mapRes.rows : Array.isArray(mapRes) ? mapRes : [];
      setMacroMapRows(mapRows.length ? mapRows : [
        { id: "map-usa", geo: "USA", value: 102.4 },
        { id: "map-eur", geo: "EUR", value: 98.7 },
        { id: "map-asi", geo: "ASI", value: 105.2 },
      ]);

      const rankingRows = Array.isArray(rankingsRes?.rows) ? rankingsRes.rows : Array.isArray(rankingsRes) ? rankingsRes : [];
      setMacroRankingRows(rankingRows.length ? rankingRows : [
        { id: "rk-1", rank: 1, geo: "USA", value: 104.2 },
        { id: "rk-2", rank: 2, geo: "DEU", value: 101.1 },
        { id: "rk-3", rank: 3, geo: "JPN", value: 99.6 },
      ]);

      const forecastRows = Array.isArray(forecastRes?.points) ? forecastRes.points : Array.isArray(forecastRes) ? forecastRes : [];
      setMacroForecastRows(forecastRows.length ? forecastRows : [
        { id: "f-1", horizon: "3M", base: 101.2, bull: 103.5, bear: 98.4 },
        { id: "f-2", horizon: "6M", base: 102.1, bull: 105.1, bear: 97.2 },
        { id: "f-3", horizon: "12M", base: 104.4, bull: 108.8, bear: 95.5 },
      ]);

      setMacroSourceInfo(sourceRes || { source: "Fallback synthetic blend", updatedAt: new Date().toISOString(), methodology: "Demo mode with available analytics macro dataset." });

      const corrRows = Array.isArray(corrRes?.rows) ? corrRes.rows : Array.isArray(corrRes) ? corrRes : [];
      setMacroCorrelationRows(corrRows.length ? corrRows : [
        { id: "corr-1", pair: `${selectedIndicator} vs ${selectedMacroAsset}`, coefficient: 0.42, window: correlationWindow },
      ]);

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
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, backendUrl]);

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

  const currentUpdatedAt =
    activeTab === "crypto"
      ? cryptoData.updatedAt
      : activeTab === "options"
      ? optionsData.updatedAt
      : activeTab === "macro"
      ? macroData.updatedAt
      : equitiesData.updatedAt;
  const currentError = errors[activeTab];
  const currentLoading = loading[activeTab];

  return (
    <div className="view-container" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Analytics
          </div>
          <h2
            style={{
              margin: "6px 0 0",
              fontSize: 24,
              fontWeight: 700,
              color: "#f8fafc",
            }}
          >
            Cross-market dashboards
          </h2>
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: 760,
              fontSize: 13,
              lineHeight: 1.55,
              color: "#94a3b8",
            }}
          >
            Switch between Crypto, Options, Equities, and Macro analytics. The module is
            structured for Hyperliquid + Dune on crypto, Binance + Derive + Deribit
            on options, and benchmark/regional/fund intelligence for equities.
          </p>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", paddingTop: 6 }}>
          Last update: {formatDateTime(currentUpdatedAt)}
        </div>
      </section>

      {/* Tabs */}
      <section>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {CATEGORY_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(56,189,248,0.38)"
                    : "1px solid rgba(148,163,184,0.16)",
                  background: active
                    ? "rgba(56,189,248,0.12)"
                    : "rgba(15,23,42,0.78)",
                  color: active ? "#7dd3fc" : "#cbd5e1",
                  padding: "12px 16px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 220,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{tab.label}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Loading / error */}
      {currentLoading && (
        <div
          style={{
            padding: 18,
            borderRadius: 14,
            background: "rgba(15,23,42,0.72)",
            border: "1px solid rgba(148,163,184,0.16)",
            color: "#cbd5e1",
          }}
        >
          Loading {activeTab} analytics...
        </div>
      )}

      {currentError && !currentLoading && (
        <div
          style={{
            padding: 18,
            borderRadius: 14,
            background: "rgba(15,23,42,0.72)",
            border: "1px solid rgba(245,158,11,0.22)",
            color: "#fbbf24",
          }}
        >
          {currentError}
        </div>
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
                  source="Dune"
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
                  border: "1px solid rgba(148, 163, 184, 0.16)",
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
                      <select style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfAssetToggle} onChange={(e) => setEtfAssetToggle(e.target.value)}>
                        <option value="All">All Assets</option>
                        <option value="BTC">BTC</option>
                        <option value="ETH">ETH</option>
                        <option value="SOL">SOL</option>
                      </select>
                      <select style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfPeriodToggle} onChange={(e) => setEtfPeriodToggle(e.target.value)}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
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
                            background: "rgba(10, 15, 30, 0.95)",
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>
                    Equities intelligence across benchmarks, sectors, regions, factors, risk, macro, flows and corporate actions.
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      { key: "daily", label: "Daily" },
                      { key: "ytd", label: "YTD" },
                      { key: "yr1", label: "1Y" },
                      { key: "yr3", label: "3Y" },
                      { key: "yr5", label: "5Y" },
                      { key: "yr10", label: "10Y" },
                    ].map((h) => (
                      <button
                        key={h.key}
                        onClick={() => setEquityHorizon(h.key)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 8,
                          border: `1px solid ${equityHorizon === h.key ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                          background: equityHorizon === h.key ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
                          color: equityHorizon === h.key ? "#7dd3fc" : "#cbd5e1",
                          cursor: "pointer",
                          fontSize: 12
                        }}
                      >
                        {h.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                  {(equitiesData.benchmarkIndexHistory || []).slice(0, 4).map((row, idx) => (
                    <AnalyticsStatCard
                      key={row.id || `eq-bmk-${idx}`}
                      title={`${row.name} (${row.currency || "USD"})`}
                      value={formatPercent(row?.[equityHorizon])}
                      subvalue={`${String(equityHorizon).toUpperCase()} · ${row.region || "Region N/A"}`}
                      source={row.symbol}
                      tone={Number(row?.[equityHorizon]) >= 0 ? "positive" : "negative"}
                    />
                  ))}
                </div>

                <AnalyticsTableCard
                  title="Benchmark Index History"
                  subtitle="Daily, weekly, monthly and annual returns with horizon selector and sparkline trend"
                  emptyText="No benchmark index history data."
                  columns={[
                    { key: "name", label: "Benchmark" },
                    { key: "currency", label: "CCY" },
                    { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                    { key: "weekly", label: "Weekly", align: "right", render: (v) => formatPercent(v) },
                    { key: "monthly", label: "Monthly", align: "right", render: (v) => formatPercent(v) },
                    { key: "annual", label: "Annual", align: "right", render: (v) => formatPercent(v) },
                    { key: "horizon", label: String(equityHorizon).toUpperCase(), align: "right", render: (_v, row) => formatPercent(row?.[equityHorizon]) },
                    {
                      key: "sparkline",
                      label: "Trend",
                      align: "right",
                      render: (_v, row) => (
                        <MiniSparkline
                          points={row.sparkline || []}
                          color={Number(row?.[equityHorizon]) >= 0 ? "#4ade80" : "#f87171"}
                        />
                      ),
                    },
                  ]}
                  rows={(equitiesData.benchmarkIndexHistory || []).map((row, idx) => ({ id: row.id || `bmk-h-${idx}`, ...row }))}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
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
                    rows={(equitiesData.sectorPerformance || []).map((row, idx) => ({ id: `sec-${idx}`, ...row }))}
                  />

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
                    rows={(equitiesData.regionalPerformance || []).map((row, idx) => ({ id: `reg-${idx}`, ...row }))}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                  <AnalyticsTableCard
                    title="Style Factor Exposures"
                    subtitle="Value, growth, momentum, quality, low-volatility and size"
                    emptyText="No style factor rows."
                    columns={[
                      { key: "factor", label: "Factor" },
                      { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                      { key: "ytd", label: "YTD", align: "right", render: (v) => formatPercent(v) },
                      { key: "yr1", label: "1Y", align: "right", render: (v) => formatPercent(v) },
                    ]}
                    rows={(equitiesData.styleFactors || []).map((row, idx) => ({ id: `factor-${idx}`, ...row }))}
                  />
                  <AnalyticsTableCard
                    title="Rebalance Signals"
                    subtitle="Target drift and rule-based actions"
                    emptyText="No rebalance signals."
                    columns={[
                      { key: "bucket", label: "Bucket" },
                      { key: "targetWeight", label: "Target %", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      { key: "currentWeight", label: "Current %", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      { key: "driftPct", label: "Drift %", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      { key: "signal", label: "Signal", align: "right" },
                    ]}
                    rows={(equitiesData.rebalanceSignals || []).map((row, idx) => ({ id: `drift-${idx}`, ...row }))}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>Equities Detail Selector</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[
                      { key: "metrics", label: "Metrics" },
                      { key: "moneyMarket", label: "Money Market" },
                      { key: "reit", label: "REIT" },
                    ].map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setEquitiesDetailSelector((prev) => (prev === item.key ? "" : item.key))}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 8,
                          border: `1px solid ${equitiesDetailSelector === item.key ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                          background: equitiesDetailSelector === item.key ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
                          color: equitiesDetailSelector === item.key ? "#7dd3fc" : "#cbd5e1",
                          cursor: "pointer",
                          fontSize: 12
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {equitiesDetailSelector === "metrics" ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                    <AnalyticsTableCard
                      title="Correlation Matrix"
                      subtitle="Cross-asset diversification matrix"
                      emptyText="No correlation matrix data."
                      columns={correlationColumns}
                      rows={correlationRows}
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
                      rows={(equitiesData.volatilityMetrics || []).map((row, idx) => ({ id: `vol-${idx}`, ...row }))}
                    />
                  </div>
                ) : null}

                {/* Benchmark Performance Summary */}
                <AnalyticsTableCard
                  title="Benchmark Performance (CAGR)"
                  subtitle="Periodic returns for major equity and REIT indices"
                  emptyText="No benchmark performance data."
                  columns={[
                    { key: "name", label: "Index Name" },
                    { key: "yr1", label: "1Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr3", label: "3Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr5", label: "5Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr10", label: "10Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr20", label: "20Y", align: "right", render: v => formatPercent(v) },
                  ]}
                  rows={equitiesData.benchmarkPerformance}
                />

                {/* Annual Returns Series */}
                <AnalyticsTableCard
                  title="Historical Annual Total Returns"
                  subtitle="20-year annual series (USD Total Return)"
                  emptyText="No historical returns data."
                  headerExtra={
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: "#94a3b8" }}>
                        {annualReturnsPageIndex * ANNUAL_RETURNS_PAGE_SIZE + 1} - {Math.min((annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE, equitiesData.annualReturns.length)} of {equitiesData.annualReturns.length}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button 
                          disabled={annualReturnsPageIndex === 0}
                          onClick={() => setAnnualReturnsPageIndex(p => Math.max(0, p - 1))}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "rgba(30,41,59,0.7)",
                            border: "1px solid rgba(148,163,184,0.2)",
                            color: annualReturnsPageIndex === 0 ? "#475569" : "#e2e8f0",
                            cursor: annualReturnsPageIndex === 0 ? "default" : "pointer",
                            fontSize: 12
                          }}
                        >
                          Prev
                        </button>
                        <button 
                          disabled={(annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= equitiesData.annualReturns.length}
                          onClick={() => setAnnualReturnsPageIndex(p => p + 1)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            background: "rgba(30,41,59,0.7)",
                            border: "1px solid rgba(148,163,184,0.2)",
                            color: (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= equitiesData.annualReturns.length ? "#475569" : "#e2e8f0",
                            cursor: (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE >= equitiesData.annualReturns.length ? "default" : "pointer",
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
                    { key: "sp500", label: "S&P 500", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "msciWorld", label: "MSCI World", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "msciEm", label: "MSCI EM", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "reits", label: "REITs (Global)", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                  ]}
                  rows={equitiesData.annualReturns.slice(
                    annualReturnsPageIndex * ANNUAL_RETURNS_PAGE_SIZE,
                    (annualReturnsPageIndex + 1) * ANNUAL_RETURNS_PAGE_SIZE
                  )}
                />

                {equitiesDetailSelector === "reit" ? (
                  <AnalyticsTableCard
                    title={`REIT Benchmarks (${equitiesData.reitData?.provider || ""})`}
                    subtitle="FTSE EPRA/Nareit Regional & Country indices"
                    emptyText="No REIT benchmark data."
                    columns={[
                      { key: "name", label: "Region / Country" },
                      { key: "yr1", label: "1Y", align: "right", render: v => formatPercent(v) },
                      { key: "yr3", label: "3Y", align: "right", render: v => formatPercent(v) },
                      { key: "yr5", label: "5Y", align: "right", render: v => formatPercent(v) },
                    ]}
                    rows={equitiesData.reitData?.benchmarks || []}
                  />
                ) : null}

                {equitiesDetailSelector === "moneyMarket" ? (
                  <AnalyticsTableCard
                    title="Money Market Fund (MMF) Yields"
                    subtitle="Yield ranges for local currency markets"
                    emptyText="No MMF yield data."
                    columns={[
                      { key: "country", label: "Jurisdiction" },
                      { key: "currency", label: "Currency" },
                      { key: "yieldRange", label: "Yield Range", align: "right" },
                      { key: "note", label: "Notes", align: "right" },
                    ]}
                    rows={equitiesData.mmfYields}
                  />
                ) : null}

                {/* Funds List */}
                <AnalyticsTableCard
                  title="Institutional Fund Directory"
                  subtitle="Representative funds with AUM, fee, domicile and structure metadata"
                  emptyText="No funds directory data."
                  columns={[
                    { key: "provider", label: "Provider" },
                    { key: "name", label: "Fund Name" },
                    { key: "domicile", label: "Domicile" },
                    { key: "assetClass", label: "Asset Class" },
                    { key: "type", label: "Type" },
                    { key: "structure", label: "Structure" },
                    { key: "feeBps", label: "Fee (bps)", align: "right", render: (v) => Number(v).toFixed(0) },
                    { key: "aum", label: "AUM", align: "right" },
                  ]}
                  rows={equitiesData.fundsList}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
                  <AnalyticsTableCard
                    title="Dividend Data"
                    subtitle="Yield, payout ratio, ex-dividend date and growth"
                    emptyText="No dividend rows."
                    columns={[
                      { key: "symbol", label: "Symbol" },
                      { key: "dividendYield", label: "Yield", align: "right", render: (v) => `${Number(v).toFixed(2)}%` },
                      { key: "payoutRatio", label: "Payout", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      { key: "exDividendDate", label: "Ex-Date", align: "right" },
                      { key: "dividendGrowth5Y", label: "5Y Growth", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                    ]}
                    rows={(equitiesData.dividendData || []).map((row, idx) => ({ id: `dvd-${idx}`, ...row }))}
                  />
                  <AnalyticsTableCard
                    title="Earnings Calendar"
                    subtitle="Upcoming earnings, revisions and surprise context"
                    emptyText="No earnings calendar rows."
                    columns={[
                      { key: "date", label: "Date" },
                      { key: "symbol", label: "Ticker" },
                      { key: "period", label: "Period", align: "right" },
                      { key: "estimateEPS", label: "Est. EPS", align: "right", render: (v) => Number(v).toFixed(2) },
                      { key: "previousSurprisePct", label: "Prev Surprise", align: "right", render: (v) => `${Number(v).toFixed(1)}%` },
                      { key: "revisionTrend", label: "Revision", align: "right" },
                    ]}
                    rows={(equitiesData.earningsCalendar || []).map((row, idx) => ({ id: `earn-${idx}`, ...row }))}
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
                  rows={(equitiesData.valuationData || []).map((row, idx) => ({ id: `val-${idx}`, ...row }))}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
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
                    rows={(equitiesData.fundFlows || []).map((row, idx) => ({ id: `flow-${idx}`, ...row }))}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20 }}>
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
                    rows={(equitiesData.corporateActions || []).map((row, idx) => ({ id: `ca-${idx}`, ...row }))}
                  />
                </div>

                {equitiesData.marketBreadth ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
                    <AnalyticsStatCard title="A/D Line" value={String(equitiesData.marketBreadth.adLine ?? "—")} subvalue="Advance/decline line level" source="Breadth" tone="info" />
                    <AnalyticsStatCard title="New Highs/Lows" value={`${equitiesData.marketBreadth.newHighs ?? 0} / ${equitiesData.marketBreadth.newLows ?? 0}`} subvalue="52-week highs vs lows" source="Breadth" tone="neutral" />
                    <AnalyticsStatCard title="% Above 50DMA" value={formatPercent(equitiesData.marketBreadth.above50dmaPct ?? 0)} subvalue="Market participation (short trend)" source="Breadth" tone="positive" />
                    <AnalyticsStatCard title="% Above 200DMA" value={formatPercent(equitiesData.marketBreadth.above200dmaPct ?? 0)} subvalue="Market participation (long trend)" source="Breadth" tone="positive" />
                  </div>
                ) : null}

              </div>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 14 }}>
                <GeographySwitcher
                  selectedGeoType={selectedGeoType}
                  onChange={setSelectedGeoType}
                  regimeLabel={regimeLabel}
                  regimeScore={regimeScore}
                  regimeExplain={regimeExplain}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                  <GeographySearch
                    geographies={macroGeographies}
                    selectedGeoType={selectedGeoType}
                    selectedGeoCode={selectedGeoCode}
                    searchQuery={geoSearchQuery}
                    onSearchChange={setGeoSearchQuery}
                    onSelectGeo={(code) => {
                      setSelectedGeoCode(code);
                      setRecentGeoCodes((prev) => [code, ...prev.filter((c) => c !== code)].slice(0, 6));
                      if (selectedGeoType === "Country") {
                        setRecentCountries((prev) => [code, ...prev.filter((c) => c !== code)].slice(0, 8));
                      }
                    }}
                    favoriteGeoCodes={favoriteGeoCodes}
                    recentGeoCodes={recentGeoCodes}
                    onToggleFavorite={(code) =>
                      setFavoriteGeoCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]))
                    }
                  />

                  <div style={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(148,163,184,0.16)", borderRadius: 14, padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>Indicator Configuration</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <input
                        type="text"
                        value={countrySearch}
                        onChange={(e) => setCountrySearch(e.target.value)}
                        placeholder="Country search (ISO3/name)"
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      />
                      {searchResults.length > 0 ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {searchResults.slice(0, 6).map((row, idx) => {
                            const code = row?.code || row?.iso3 || row?.id || `geo-${idx}`;
                            return (
                              <button
                                key={`sr-${code}-${idx}`}
                                type="button"
                                onClick={() => {
                                  setSelectedGeoCode(code);
                                  setCountrySearch("");
                                  setSearchResults([]);
                                  setRecentCountries((prev) => [code, ...prev.filter((c) => c !== code)].slice(0, 8));
                                }}
                                style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.5)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
                              >
                                {row?.name || code} ({code})
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {recentCountries.length > 0 ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {recentCountries.slice(0, 5).map((code) => (
                            <button
                              key={`rc-${code}`}
                              type="button"
                              onClick={() => setSelectedGeoCode(code)}
                              style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.5)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
                            >
                              Recent country: {code}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <input
                        type="text"
                        value={indicatorSearch}
                        onChange={(e) => setIndicatorSearch(e.target.value)}
                        placeholder="Search indicators..."
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      />
                      <select
                        value={selectedCategory}
                        onChange={(e) => setSelectedCategory(e.target.value)}
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      >
                        {MACRO_CATEGORY_OPTIONS.map((cat) => (
                          <option key={cat.key} value={cat.key}>{cat.label}</option>
                        ))}
                      </select>
                      <select
                        value={selectedIndicator}
                        onChange={(e) => setSelectedIndicator(e.target.value)}
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      >
                        {(filteredMacroIndicators.length ? filteredMacroIndicators : macroIndicators).map((indicator) => (
                          <option key={indicator.code} value={indicator.code}>{indicator.name || indicator.code}</option>
                        ))}
                      </select>
                      <select
                        value={globalTrendMode}
                        onChange={(e) => setGlobalTrendMode(e.target.value)}
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}
                      >
                        <option value="weighted">Global trend mode: Weighted</option>
                        <option value="equal">Global trend mode: Equal-weighted</option>
                      </select>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["1Y", "5Y", "10Y", "MAX"].map((range) => (
                          <button
                            key={range}
                            onClick={() => setChartRange(range)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 8,
                              border: `1px solid ${chartRange === range ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                              background: chartRange === range ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
                              color: chartRange === range ? "#7dd3fc" : "#cbd5e1",
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            {range}
                          </button>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["levels", "change", "YoY", "MoM"].map((mode) => (
                          <button
                            key={mode}
                            onClick={() => setChartMode(mode)}
                            style={{
                              padding: "5px 10px",
                              borderRadius: 8,
                              border: `1px solid ${chartMode === mode ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                              background: chartMode === mode ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
                              color: chartMode === mode ? "#7dd3fc" : "#cbd5e1",
                              cursor: "pointer",
                              fontSize: 12
                            }}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {MACRO_VIEW_OPTIONS.map((view) => (
                    <button
                      key={view.key}
                      onClick={() => setMacroView(view.key)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: `1px solid ${macroView === view.key ? "rgba(56,189,248,0.5)" : "rgba(148,163,184,0.2)"}`,
                        background: macroView === view.key ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
                        color: macroView === view.key ? "#7dd3fc" : "#cbd5e1",
                        cursor: "pointer",
                        fontSize: 12
                      }}
                    >
                      {view.label}
                    </button>
                  ))}
                </div>

                <div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 8 }}>
                    Overview cards {overviewLoading ? "• Loading..." : ""}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    {(macroOverview || []).slice(0, 8).map((row, idx) => (
                      <button
                        key={row.id || `ovc-${idx}`}
                        type="button"
                        onClick={() => {
                          if (row?.indicatorCode) setSelectedIndicator(row.indicatorCode);
                          setMacroView("chart");
                        }}
                        style={{
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(148,163,184,0.16)",
                          borderRadius: 12,
                          padding: "10px 12px",
                          textAlign: "left",
                          cursor: "pointer"
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" }}>
                          {row?.indicator || row?.name || row?.indicatorCode || "Indicator"}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 20, fontWeight: 700, color: "#e2e8f0" }}>
                          {Number.isFinite(Number(row?.value)) ? Number(row.value).toFixed(2) : "—"}
                          {row?.unit ? <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 4 }}>{row.unit}</span> : null}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 11, color: "#7dd3fc" }}>Click to drill into chart</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {macroView === "chart" ? (
                <AnalyticsTableCard
                  title="Macro Time Series"
                  subtitle={`${selectedIndicator} · ${selectedGeoCode} · ${chartRange} (${chartMode})`}
                  emptyText="No time-series rows."
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "value", label: "Value", align: "right", render: (v) => Number(v).toFixed(2) },
                  ]}
                  rows={(macroTimeseries || []).map((row, idx) => ({ id: row.id || `ts-${idx}`, ...row }))}
                />
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
                        style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, minWidth: 180 }}
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
                            style={{ padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.55)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
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
                      <select value={mapIndicator} onChange={(e) => setMapIndicator(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        {(macroIndicators || []).map((ind) => <option key={`map-ind-${ind.code}`} value={ind.code}>{ind.name || ind.code}</option>)}
                      </select>
                      <input type="date" value={mapDate} onChange={(e) => setMapDate(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <select value={mapLayer} onChange={(e) => setMapLayer(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
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
                      <input type="date" value={calendarFilters.from} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, from: e.target.value }))} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <input type="date" value={calendarFilters.to} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, to: e.target.value }))} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }} />
                      <select value={calendarFilters.importance} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, importance: e.target.value }))} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">All Importance</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <select value={calendarFilters.geography} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, geography: e.target.value }))} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">All Geographies</option>
                        {macroGeographies.map((geo) => <option key={`cal-geo-${geo.code}`} value={geo.code}>{geo.code}</option>)}
                      </select>
                      <select value={calendarFilters.indicatorType} onChange={(e) => setCalendarFilters((prev) => ({ ...prev, indicatorType: e.target.value }))} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
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
                      <select value={rankingScope} onChange={(e) => setRankingScope(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                        <option value="all">Scope: All</option>
                        <option value="g20">G20</option>
                        <option value="dm">Developed</option>
                        <option value="em">Emerging</option>
                      </select>
                      <select value={rankingSort} onChange={(e) => setRankingSort(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
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
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: forecastToggle ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)", color: forecastToggle ? "#7dd3fc" : "#cbd5e1", cursor: "pointer", fontSize: 12 }}
                      >
                        Forecast {forecastToggle ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConsensusVisible((v) => !v)}
                        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: consensusVisible ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)", color: consensusVisible ? "#7dd3fc" : "#cbd5e1", cursor: "pointer", fontSize: 12 }}
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
                    { key: "trend", label: "Trend", align: "right" },
                  ]}
                  rows={(macroData.macroData || []).map((row, idx) => ({ id: `macro-${idx}`, ...row }))}
                />
                <AnalyticsTableCard
                  title="FX Rates"
                  subtitle="Cross-currency trend context for regional returns"
                  emptyText="No FX rows."
                  columns={[
                    { key: "pair", label: "Pair" },
                    { key: "rate", label: "Rate", align: "right", render: (v) => Number(v).toFixed(4) },
                    { key: "daily", label: "Daily", align: "right", render: (v) => formatPercent(v) },
                    { key: "weekly", label: "Weekly", align: "right", render: (v) => formatPercent(v) },
                  ]}
                  rows={(macroData.fxRates || []).map((row, idx) => ({ id: `fx-${idx}`, ...row }))}
                />
              </div>

              <AnalyticsTableCard
                title="Risk Indicators"
                subtitle="Volatility, credit and liquidity stress indicators"
                emptyText="No risk indicator rows."
                headerExtra={
                  <button
                    type="button"
                    onClick={() => {
                      const id = `alrt-${Date.now()}`;
                      const next = [...alertRules, { id, geo: selectedGeoCode, indicator: selectedIndicator, rule: `Alert when ${selectedIndicator} changes > 2%`, channel: alertChannels.join(","), status: alertStatus }];
                      setAlertRules(next);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid rgba(56,189,248,0.5)",
                      background: "rgba(56,189,248,0.16)",
                      color: "#7dd3fc",
                      cursor: "pointer",
                      fontSize: 12
                    }}
                  >
                    Create Alert
                  </button>
                }
                columns={[
                  { key: "indicator", label: "Indicator" },
                  { key: "value", label: "Value", align: "right", render: (v, row) => `${Number(v).toFixed(2)} ${row.unit || ""}`.trim() },
                  { key: "status", label: "Status", align: "right" },
                ]}
                rows={(macroData.riskIndicators || []).map((row, idx) => ({ id: `risk-${idx}`, ...row }))}
              />

              <AnalyticsTableCard
                title="Asset Correlation"
                subtitle="Macro indicator linkage to selected market asset"
                emptyText="No correlation rows."
                headerExtra={
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <select value={selectedMacroAsset} onChange={(e) => setSelectedMacroAsset(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                      {["SPY", "QQQ", "DXY", "TLT", "BTC"].map((asset) => <option key={asset} value={asset}>{asset}</option>)}
                    </select>
                    <select value={correlationWindow} onChange={(e) => setCorrelationWindow(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                      <option value="90d">90D</option>
                      <option value="180d">180D</option>
                      <option value="1y">1Y</option>
                    </select>
                  </div>
                }
                columns={[
                  { key: "pair", label: "Pair" },
                  { key: "coefficient", label: "Correlation", align: "right", render: (v) => Number(v).toFixed(2) },
                  { key: "window", label: "Window", align: "right" },
                ]}
                rows={(macroCorrelationRows || []).map((row, idx) => ({ id: row.id || `mcor-${idx}`, ...row }))}
              />

              <AnalyticsTableCard
                title="Saved Alert Rules"
                subtitle="Threshold and event-based macro alerts"
                emptyText="No alert rules yet."
                headerExtra={
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <select value={alertStatus} onChange={(e) => setAlertStatus(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
                      <option value="active">Status: Active</option>
                      <option value="paused">Status: Paused</option>
                    </select>
                    <select
                      value={alertChannels[0] || "in-app"}
                      onChange={(e) => setAlertChannels([e.target.value])}
                      style={{ background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
                    >
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
                  { key: "status", label: "Status", align: "right" },
                  {
                    key: "actions",
                    label: "Actions",
                    align: "right",
                    render: (_v, row) => (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => setAlertRules((prev) => prev.map((item) => item.id === row.id ? { ...item, status: item.status === "active" ? "paused" : "active" } : item))}
                          style={{ padding: "2px 6px", borderRadius: 6, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.55)", color: "#cbd5e1", cursor: "pointer", fontSize: 11 }}
                        >
                          {row.status === "active" ? "Pause" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAlertRules((prev) => prev.filter((item) => item.id !== row.id))}
                          style={{ padding: "2px 6px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(127,29,29,0.35)", color: "#fca5a5", cursor: "pointer", fontSize: 11 }}
                        >
                          Remove
                        </button>
                      </div>
                    )
                  },
                ]}
                rows={(alertRules || []).map((row, idx) => ({ id: row.id || `alert-${idx}`, ...row }))}
              />

              <div
                style={{
                  background: "rgba(0, 0, 0, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(148, 163, 184, 0.16)",
                  borderRadius: 14,
                  padding: 16,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>Source Drawer</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>Methodology and source notes for trust and transparency</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSourceDrawerOpen((v) => !v)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.55)", color: "#cbd5e1", cursor: "pointer", fontSize: 12 }}
                  >
                    {sourceDrawerOpen ? "Hide Source" : "Show Source"}
                  </button>
                </div>
                {sourceDrawerOpen ? (
                  <div style={{ marginTop: 12 }}>
                    <AnalyticsTableCard
                      title="Data Source"
                      subtitle="Source and methodology for selected indicator"
                      emptyText="No source data."
                      columns={[
                        { key: "field", label: "Field" },
                        { key: "value", label: "Value", align: "right" },
                      ]}
                      rows={macroSourceInfo ? [
                        { id: "src-1", field: "Source", value: macroSourceInfo.source || macroSourceInfo.provider || "—" },
                        { id: "src-2", field: "Updated", value: formatDateTime(macroSourceInfo.updatedAt) },
                        { id: "src-3", field: "Methodology", value: macroSourceInfo.methodology || macroSourceInfo.note || "—" },
                      ] : []}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function GeographySwitcher({ selectedGeoType, onChange, regimeLabel, regimeScore, regimeExplain }) {
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(148, 163, 184, 0.16)",
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
              background: selectedGeoType === type ? "rgba(56,189,248,0.16)" : "rgba(2,6,23,0.55)",
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
        border: "1px solid rgba(148, 163, 184, 0.16)",
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
        style={{ width: "100%", background: "rgba(15,23,42,0.7)", border: "1px solid rgba(148,163,184,0.2)", color: "#e2e8f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, marginBottom: 8 }}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {recentGeoCodes.slice(0, 5).map((code) => (
          <button
            key={`recent-${code}`}
            type="button"
            onClick={() => onSelectGeo(code)}
            style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.25)", background: "rgba(15,23,42,0.5)", color: "#cbd5e1", fontSize: 11, cursor: "pointer" }}
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
                background: active ? "rgba(56,189,248,0.12)" : "rgba(15,23,42,0.45)"
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

function AnalyticsStatCard({ title, value, subvalue, source, tone = "neutral" }) {
  const toneMap = {
    neutral: { border: "rgba(148,163,184,0.18)", color: "#e2e8f0" },
    positive: { border: "rgba(34,197,94,0.28)", color: "#86efac" },
    negative: { border: "rgba(239,68,68,0.28)", color: "#fca5a5" },
    info: { border: "rgba(56,189,248,0.24)", color: "#7dd3fc" },
  };
  const chosen = toneMap[tone] || toneMap.neutral;

  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${chosen.border}`,
        borderRadius: 14,
        padding: 16,
        minHeight: 110,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 24,
              fontWeight: 700,
              color: chosen.color,
            }}
          >
            {value}
          </div>
          {subvalue ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#cbd5e1" }}>
              {subvalue}
            </div>
          ) : null}
        </div>
        {source ? (
          <div>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.18)",
                fontSize: 10,
                color: "#94a3b8",
                whiteSpace: "nowrap",
              }}
            >
              {source}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnalyticsTableCard({ title, subtitle, columns, rows = [], emptyText, headerExtra }) {
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        {headerExtra && <div>{headerExtra}</div>}
      </div>

      {(rows || []).length === 0 ? (
        <div style={{ padding: "18px 6px 6px", fontSize: 13, color: "#94a3b8" }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 420,
            }}
          >
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{
                      textAlign: column.align || "left",
                      padding: "0 0 10px",
                      fontSize: 11,
                      color: "#64748b",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(148,163,184,0.14)",
                    }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((row, idx) => (
                <tr key={row.id || `${title}-${idx}`}>
                  {columns.map((column) => {
                    const cellValue = row[column.key];
                    return (
                      <td
                        key={column.key}
                        style={{
                          padding: "12px 0",
                          fontSize: 13,
                          color: "#e2e8f0",
                          textAlign: column.align || "left",
                          borderBottom:
                            idx === (rows || []).length - 1
                              ? "none"
                              : "1px solid rgba(148,163,184,0.08)",
                        }}
                      >
                        {column.render
                          ? column.render(cellValue, row)
                          : typeof cellValue === 'object' && cellValue !== null
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
      )}
    </div>
  );
}
