import { useState, useEffect, useMemo } from "react";
import Chart from "react-apexcharts";

const BACKEND_URL =
  import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

const EMPTY_LEG = {
  strike: "",
  expiry: "",
  type: "call",
  direction: "long",
  qty: 1,
  premium: "",
  iv: "",
};

const DEFAULT_SPOTS = {
  BTC: 80000,
  ETH: 4000,
  SOL: 150,
};

const STRATEGIES = [
  { name: "Long Call", legs: [{ type: "call", direction: "long", qty: 1 }] },
  { name: "Long Put", legs: [{ type: "put", direction: "long", qty: 1 }] },
  { name: "Call Spread", legs: [{ type: "call", direction: "long", qty: 1 }, { type: "call", direction: "short", qty: 1 }] },
  { name: "Put Spread", legs: [{ type: "put", direction: "long", qty: 1 }, { type: "put", direction: "short", qty: 1 }] },
];

function blackScholes(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0)
    return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0 };

  const d1 =
    (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) /
    (sigma * Math.sqrt(T));

  const d2 = d1 - sigma * Math.sqrt(T);

  const N = (x) => {
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y =
      1 -
      (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
        0.284496736) *
        t +
        0.254829592) *
        t) *
        Math.exp((-x * x) / 2);
    return 0.5 * (1 + sign * y);
  };

  const Nprime = (x) =>
    Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

  let price, delta, theta;

  if (type === "call") {
    price = S * N(d1) - K * Math.exp(-r * T) * N(d2);
    delta = N(d1);
    theta =
      (-S * Nprime(d1) * sigma) / (2 * Math.sqrt(T)) -
      r * K * Math.exp(-r * T) * N(d2);
  } else {
    price = K * Math.exp(-r * T) * N(-d2) - S * N(-d1);
    delta = N(d1) - 1;
    theta =
      (-S * Nprime(d1) * sigma) / (2 * Math.sqrt(T)) +
      r * K * Math.exp(-r * T) * N(-d2);
  }

  const gamma = Nprime(d1) / (S * sigma * Math.sqrt(T));
  const vega = (S * Nprime(d1) * Math.sqrt(T)) / 100;

  return { price, delta, gamma, theta, vega };
}

export function OptionsCalculator({
  spotPrice = 0,
  chainData = [],
  activeAsset,
  assets = [],
}) {
  const [symbol, setSymbol] = useState(activeAsset || "BTC");
  const [symbolSearch, setSymbolSearch] = useState(activeAsset || "");
  const [showDropdown, setShowDropdown] = useState(false);

  const [legs, setLegs] = useState([{ ...EMPTY_LEG }]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [manualSpot, setManualSpot] = useState("");

  useEffect(() => {
    if (activeAsset) {
      setSymbol(activeAsset);
      setSymbolSearch(activeAsset);
    }
  }, [activeAsset]);

  useEffect(() => {
    setLegs([{ ...EMPTY_LEG }]);
    setActiveStrategy(null);
  }, [symbol]);

  const filteredChain = useMemo(
    () => chainData.filter((r) => r.symbol === symbol),
    [chainData, symbol]
  );

  const effectiveSpot = useMemo(() => {
    if (manualSpot) return parseFloat(manualSpot);
    if (spotPrice) return spotPrice;
    return DEFAULT_SPOTS[symbol] || 50000;
  }, [manualSpot, spotPrice, symbol]);

  const S = effectiveSpot;
  const r = 0.0425;

  const filteredSymbols = useMemo(
    () =>
      assets.filter((s) =>
        s.toLowerCase().includes(symbolSearch.toLowerCase())
      ),
    [assets, symbolSearch]
  );

  const getStrikes = () =>
    filteredChain.map((r) => r.strike).filter(Boolean);

  const getIV = (strike, type) => {
    const row = filteredChain.find((r) => r.strike === parseFloat(strike));
    if (!row) return "";
    const side = type === "call" ? row.call : row.put;
    return side?.iv ? (side.iv * 100).toFixed(1) : "";
  };

  const getPremium = (strike, type) => {
    const row = filteredChain.find((r) => r.strike === parseFloat(strike));
    if (!row) return "";
    const side = type === "call" ? row.call : row.put;
    return side?.mark_price ? side.mark_price.toFixed(4) : "";
  };

  const updateLeg = (i, field, value) =>
    setLegs((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l))
    );

  const addLeg = () =>
    setLegs((prev) => [...prev, { ...EMPTY_LEG }]);

  const removeLeg = (i) =>
    setLegs((prev) => prev.filter((_, idx) => idx !== i));

  const applyStrategy = (s) => {
    setActiveStrategy(s.name);
    setLegs(s.legs.map((l) => ({ ...EMPTY_LEG, ...l })));
  };

  const greeks = legs.map((leg) => {
    const K = parseFloat(leg.strike);
    if (!K) return null;

    const iv = (parseFloat(leg.iv) || 20) / 100;
    const premium = parseFloat(leg.premium) || 0;

    const T = 30 / 365;
    const bs = blackScholes(S, K, T, r, iv, leg.type);

    const dir = leg.direction === "long" ? 1 : -1;
    const qty = parseInt(leg.qty) || 1;

    return {
      delta: bs.delta * dir * qty,
      gamma: bs.gamma * dir * qty,
      theta: bs.theta * dir * qty,
      vega: bs.vega * dir * qty,
      pnl: (bs.price - premium) * dir * qty,
      bsPrice: bs.price,
    };
  });

  const totals = greeks.reduce(
    (a, g) => {
      if (!g) return a;
      a.delta += g.delta;
      a.gamma += g.gamma;
      a.theta += g.theta;
      a.vega += g.vega;
      a.pnl += g.pnl;
      return a;
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0, pnl: 0 }
  );

  const pnlData = useMemo(() => {
    const range = S * 0.4;
    const prices = Array.from(
      { length: 60 },
      (_, i) => S - range + (i / 59) * range * 2
    );

    return prices.map((price) => {
      let total = 0;

      legs.forEach((leg) => {
        const K = parseFloat(leg.strike) || S;
        const premium = parseFloat(leg.premium) || 0;
        const qty = parseInt(leg.qty) || 1;
        const dir = leg.direction === "long" ? 1 : -1;

        const intrinsic =
          leg.type === "call"
            ? Math.max(0, price - K)
            : Math.max(0, K - price);

        total += (intrinsic - premium) * dir * qty;
      });

      return [price, total];
    });
  }, [S, legs]);

  const chartOptions = {
    chart: { type: "area", toolbar: { show: false } },
    stroke: { curve: "smooth", width: 2 },
    xaxis: {
      type: "numeric",
      labels: { formatter: (v) => `$${v.toFixed(0)}` },
    },
    yaxis: {
      labels: { formatter: (v) => `$${v.toFixed(2)}` },
    },
    dataLabels: { enabled: false },
  };

  return (
    <div style={{ marginTop: 32, paddingTop: 24 }}>
      <h2>Options Calculator</h2>

      {/* SYMBOL */}
      <div>
        <input
          value={symbolSearch}
          onChange={(e) => {
            setSymbolSearch(e.target.value);
            setShowDropdown(true);
          }}
        />

        {showDropdown && (
          <div>
            {filteredSymbols.map((s) => (
              <div
                key={s}
                onClick={() => {
                  setSymbol(s);
                  setSymbolSearch(s);
                  setShowDropdown(false);
                }}
              >
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* STRATEGIES */}
      <div>
        {STRATEGIES.map((s) => (
          <button key={s.name} onClick={() => applyStrategy(s)}>
            {s.name}
          </button>
        ))}
      </div>

      {/* LEGS */}
      <div>
        <button onClick={addLeg}>Add Leg</button>

        {legs.map((leg, i) => (
          <div key={i}>
            <select
              value={leg.strike}
              onChange={(e) => updateLeg(i, "strike", e.target.value)}
            >
              <option value="">Strike</option>
              {getStrikes().map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>

            <input
              type="number"
              value={leg.premium}
              onChange={(e) => updateLeg(i, "premium", e.target.value)}
            />

            <button onClick={() => removeLeg(i)}>X</button>
          </div>
        ))}
      </div>

      {/* CHART */}
      <Chart
        options={chartOptions}
        series={[{ name: "P&L", data: pnlData }]}
        type="area"
        height={280}
      />
    </div>
  );
}