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
  const ANNUAL_RETURNS_PAGE_SIZE = 10;

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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: 20 }}>
                  {/* REIT Detailed Data */}
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

                  {/* MMF Table */}
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
                </div>

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
                columns={[
                  { key: "indicator", label: "Indicator" },
                  { key: "value", label: "Value", align: "right", render: (v, row) => `${Number(v).toFixed(2)} ${row.unit || ""}`.trim() },
                  { key: "status", label: "Status", align: "right" },
                ]}
                rows={(macroData.riskIndicators || []).map((row, idx) => ({ id: `risk-${idx}`, ...row }))}
              />
            </>
          )}
        </>
      )}
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
