import React, { useState, useMemo } from "react";

// ─── Config / Data ─────────────────────────────────────────────────────────────

const VIEWS = [
  {
    id: "bullish",
    label: "Asset will rise",
    desc: "Directional upside view",
    accent: "#22c55e",
    bg: "rgba(34,197,94,0.08)",
    border: "rgba(34,197,94,0.22)",
  },
  {
    id: "bearish",
    label: "Asset will fall",
    desc: "Directional downside view",
    accent: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.22)",
  },
  {
    id: "protect",
    label: "Protect a position",
    desc: "Hedge an existing long or short",
    accent: "#38bdf8",
    bg: "rgba(56,189,248,0.08)",
    border: "rgba(56,189,248,0.22)",
  },
  {
    id: "rangebound",
    label: "Price stays in range",
    desc: "Sideways / consolidation view",
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.22)",
  },
  {
    id: "breakout",
    label: "Big move coming",
    desc: "Direction unknown — vol play",
    accent: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.22)",
  },
];

const TIME_HORIZONS = [
  { id: "short", label: "Short-term", sub: "< 1 week", days: 5 },
  { id: "medium", label: "Near-term", sub: "1–4 weeks", days: 21 },
  { id: "long", label: "Medium-term", sub: "1–3 months", days: 75 },
  { id: "leaps", label: "Long-term", sub: "3–12 months", days: 270 },
];

const TIER_META = {
  high: {
    label: "High probability",
    sub: "65–85% win rate",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.28)",
  },
  medium: {
    label: "Moderate probability",
    sub: "40–65% win rate",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.28)",
  },
  speculative: {
    label: "Speculative",
    sub: "20–40% win rate",
    color: "#38bdf8",
    bg: "rgba(56,189,248,0.10)",
    border: "rgba(56,189,248,0.28)",
  },
};

// Minimal, opinionated strategy library (you can extend with your full set)
const STRATEGY_LIBRARY = {
  bullish: [
    {
      name: "Covered Call",
      tier: "high",
      horizons: ["medium", "long", "leaps"],
      payoffLabel: "Income + capped upside",
      summary: "Hold spot and sell OTM calls to earn yield.",
      legs: "Long 1x spot + Short 1x OTM call",
      greeks: { delta: 0.65, gamma: -0.001, theta: 0.12, vega: -0.05 }
    },
    {
      name: "Bull Put Spread",
      tier: "high",
      horizons: ["short", "medium", "long"],
      payoffLabel: "Limited risk income",
      summary: "Sell OTM put, buy further OTM put for protection.",
      legs: "Short 1x higher-strike put + Long 1x lower-strike put",
      greeks: { delta: 0.35, gamma: -0.004, theta: 0.08, vega: -0.04 }
    },
    {
      name: "Bull Call Spread",
      tier: "medium",
      horizons: ["short", "medium", "long"],
      payoffLabel: "Defined-risk upside",
      summary: "Buy lower-strike call, sell higher-strike call.",
      legs: "Long 1x lower-strike call + Short 1x higher-strike call",
      greeks: { delta: 0.42, gamma: 0.002, theta: -0.05, vega: 0.08 }
    },
    {
      name: "Long Call Butterfly",
      tier: "medium",
      horizons: ["medium", "long"],
      payoffLabel: "Neutral-Bullish pin",
      summary: "Long 1x lower call, Short 2x ATM call, Long 1x higher call.",
      legs: "Long 1x Call(A) + Short 2x Call(B) + Long 1x Call(C)",
      greeks: { delta: 0.05, gamma: -0.012, theta: 0.15, vega: -0.10 }
    },
    {
      name: "Long Call",
      tier: "speculative",
      horizons: ["short", "medium", "long", "leaps"],
      payoffLabel: "Leveraged upside",
      summary: "Pure upside convexity, loss capped at premium.",
      legs: "Long 1x ATM/OTM call",
      greeks: { delta: 0.55, gamma: 0.015, theta: -0.18, vega: 0.22 }
    },
  ],
  bearish: [
    {
      name: "Bear Call Spread",
      tier: "high",
      horizons: ["short", "medium", "long"],
      payoffLabel: "Limited risk income",
      summary: "Sell OTM call, buy further OTM call for protection.",
      legs: "Short 1x lower-strike call + Long 1x higher-strike call",
      greeks: { delta: -0.32, gamma: -0.003, theta: 0.10, vega: -0.06 }
    },
    {
      name: "Bear Put Spread",
      tier: "medium",
      horizons: ["short", "medium", "long"],
      payoffLabel: "Defined-risk downside",
      summary: "Buy higher-strike put, sell lower-strike put.",
      legs: "Long 1x higher-strike put + Short 1x lower-strike put",
      greeks: { delta: -0.45, gamma: 0.004, theta: -0.06, vega: 0.09 }
    },
    {
      name: "Long Put Butterfly",
      tier: "medium",
      horizons: ["medium", "long"],
      payoffLabel: "Neutral-Bearish pin",
      summary: "Long 1x lower put, Short 2x ATM put, Long 1x higher put.",
      legs: "Long 1x Put(A) + Short 2x Put(B) + Long 1x Put(C)",
      greeks: { delta: -0.08, gamma: -0.014, theta: 0.18, vega: -0.12 }
    },
    {
      name: "Long Put",
      tier: "speculative",
      horizons: ["short", "medium", "long", "leaps"],
      payoffLabel: "Leveraged downside",
      summary: "Pure downside bet, loss capped at premium.",
      legs: "Long 1x ATM/OTM put",
      greeks: { delta: -0.52, gamma: 0.018, theta: -0.21, vega: 0.24 }
    },
  ],
  protect: [
    {
      name: "Protective Put",
      tier: "high",
      horizons: ["short", "medium", "long", "leaps"],
      payoffLabel: "Floor on long spot",
      summary: "Buy OTM put to cap downside on an existing long.",
      legs: "Existing long spot + Long 1x OTM put",
      greeks: { delta: 0.55, gamma: 0.008, theta: -0.04, vega: 0.12 }
    },
    {
      name: "Collar",
      tier: "medium",
      horizons: ["medium", "long", "leaps"],
      payoffLabel: "Capped up/down, low cost",
      summary: "Buy put and finance it by selling OTM call.",
      legs: "Long spot + Long 1x OTM put + Short 1x OTM call",
      greeks: { delta: 0.35, gamma: -0.002, theta: 0.05, vega: -0.02 }
    },
    {
      name: "Put Backspread",
      tier: "speculative",
      horizons: ["medium", "long"],
      payoffLabel: "Unlimited down, safe up",
      summary: "Short 1x higher put, long 2x lower puts.",
      legs: "Short 1x Put(A) + Long 2x Put(B)",
      greeks: { delta: -0.45, gamma: 0.022, theta: -0.12, vega: 0.35 }
    }
  ],
  rangebound: [
    {
      name: "Iron Condor",
      tier: "high",
      horizons: ["medium", "long", "leaps"],
      payoffLabel: "High-prob range income",
      summary: "Short OTM put/call spreads around current price.",
      legs: "Short 1x OTM P/C Spreads",
      greeks: { delta: 0.02, gamma: -0.025, theta: 0.35, vega: -0.22 }
    },
    {
      name: "Iron Butterfly",
      tier: "medium",
      horizons: ["short", "medium"],
      payoffLabel: "Aggressive range credit",
      summary: "Short ATM call/put, Long OTM call/put.",
      legs: "Short 1x ATM Call + Short 1x ATM Put + Long Wing Protections",
      greeks: { delta: 0.00, gamma: -0.045, theta: 0.55, vega: -0.42 }
    },
    {
      name: "Short Strangle",
      tier: "speculative",
      horizons: ["short", "medium"],
      payoffLabel: "Max theta, undefined risk",
      summary: "Short OTM put and call, expects price to stay in band.",
      legs: "Short 1x OTM put + Short 1x OTM call",
      greeks: { delta: 0.05, gamma: -0.015, theta: 0.28, vega: -0.18 }
    },
  ],
  breakout: [
    {
      name: "Long Straddle",
      tier: "medium",
      horizons: ["short", "leaps"],
      payoffLabel: "Long vol both ways",
      summary: "Buy ATM call + put, profits from big move either way.",
      legs: "Long 1x ATM call + Long 1x ATM put",
      greeks: { delta: 0.05, gamma: 0.055, theta: -0.85, vega: 1.15 }
    },
    {
      name: "Reverse Iron Condor",
      tier: "medium",
      horizons: ["short", "medium"],
      payoffLabel: "Defined-risk breakout",
      summary: "Buy OTM spreads, profits if price leaves the range.",
      legs: "Long 1x OTM Call Spread + Long 1x OTM Put Spread",
      greeks: { delta: 0.02, gamma: 0.012, theta: -0.15, vega: 0.25 }
    },
    {
      name: "Long Strangle",
      tier: "speculative",
      horizons: ["short", "leaps"],
      payoffLabel: "Cheaper long vol",
      summary: "Buy OTM call and put, needs larger move to pay off.",
      legs: "Long 1x OTM call + Long 1x OTM put",
      greeks: { delta: 0.08, gamma: 0.035, theta: -0.45, vega: 0.75 }
    },
  ],
};

// Helper to assign rough probabilities by tier
function tierProbability(tier) {
  switch (tier) {
    case "high":
      return 0.75;
    case "medium":
      return 0.55;
    case "speculative":
      return 0.35;
    default:
      return 0.5;
  }
}

// ─── Main Component ────────────────────────────────────────────────────────────

const OptionsStrategySimulator = ({
  underlying,
  chain = [],
  spotPrice = null,
  maxVisible = 10,
  onStrategyChosen,
  showToast,
  loading = false,
  availableExpiries = []
}) => {
  const [selectedView, setSelectedView] = useState(null);
  const [selectedHorizon, setSelectedHorizon] = useState(null);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [amount, setAmount] = useState(1);
  const [selectedExpiry, setSelectedExpiry] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strategies = useMemo(() => {
    if (!selectedView || !selectedHorizon) return [];

    const raw = STRATEGY_LIBRARY[selectedView] || [];
    return raw
      .filter((s) => !s.horizons || s.horizons.includes(selectedHorizon))
      .map((s, idx) => {
        const probability = tierProbability(s.tier) - idx * 0.03;
        return {
          id: `${selectedView}-${selectedHorizon}-${s.name}`,
          ...s,
          probability: Math.max(0.15, probability),
          viewId: selectedView,
          horizonId: selectedHorizon,
          payoffLabel: s.payoffLabel || "",
        };
      });
  }, [selectedView, selectedHorizon]);

  const visible = strategies.slice(0, maxVisible);
  const selectedStrategy = visible.find(s => s.id === selectedStrategyId);

  // Helper to generate normalized legs with current chain data
  const generateLegs = useMemo(() => {
    if (!selectedStrategy || !chain || chain.length === 0) return [];

    const sorted = [...chain].sort((a, b) => a.strike - b.strike);
    let effectiveSpot = spotPrice;
    if (!effectiveSpot || effectiveSpot <= 0) {
      effectiveSpot = sorted[Math.floor(sorted.length / 2)].strike;
    }

    const atmIdx = sorted.findIndex(r => r.strike >= effectiveSpot);
    const safeAtmIdx = atmIdx === -1 ? sorted.length - 1 : atmIdx;
    const atm = sorted[safeAtmIdx];

    let rawLegs = [];
    const sName = selectedStrategy.name;

    if (sName === "Long Call") {
      rawLegs = [{ type: 'call', side: 'long', strike: atm.strike }];
    } else if (sName === "Long Put") {
      rawLegs = [{ type: 'put', side: 'long', strike: atm.strike }];
    } else if (sName === "Covered Call") {
      rawLegs = [
        { type: 'spot', side: 'long', strike: effectiveSpot },
        { type: 'call', side: 'short', strike: sorted[Math.min(sorted.length - 1, safeAtmIdx + 2)].strike }
      ];
    } else if (sName === "Bull Put Spread") {
      rawLegs = [
        { type: 'put', side: 'short', strike: atm.strike },
        { type: 'put', side: 'long', strike: sorted[Math.max(0, safeAtmIdx - 3)].strike }
      ];
    } else if (sName === "Bull Call Spread") {
      rawLegs = [
        { type: 'call', side: 'long', strike: sorted[Math.max(0, safeAtmIdx - 2)].strike },
        { type: 'call', side: 'short', strike: sorted[Math.min(sorted.length - 1, safeAtmIdx + 2)].strike }
      ];
    } else if (sName === "Bear Call Spread") {
      rawLegs = [
        { type: 'call', side: 'short', strike: atm.strike },
        { type: 'call', side: 'long', strike: sorted[Math.min(sorted.length - 1, safeAtmIdx + 3)].strike }
      ];
    } else if (sName === "Iron Condor") {
      rawLegs = [
        { type: 'put', side: 'long', strike: sorted[Math.max(0, safeAtmIdx - 5)].strike },
        { type: 'put', side: 'short', strike: sorted[Math.max(0, safeAtmIdx - 2)].strike },
        { type: 'call', side: 'short', strike: sorted[Math.min(sorted.length - 1, safeAtmIdx + 2)].strike },
        { type: 'call', side: 'long', strike: sorted[Math.min(sorted.length - 1, safeAtmIdx + 5)].strike }
      ];
    } else {
      rawLegs = [{ type: 'call', side: 'long', strike: atm.strike }];
    }

    return rawLegs.map(leg => {
      if (leg.type === 'spot') return { ...leg, qty: amount };
      
      const row = sorted.find(r => Math.abs(r.strike - leg.strike) < 0.01) || atm;
      const opt = leg.type === 'call' ? row.call : row.put;
      const mark = opt ? (Number(opt.bid || 0) + Number(opt.ask || 0)) / 2 || Number(opt.mark) || 0 : 0;
      
      return {
        ...leg,
        qty: amount,
        expiry: selectedExpiry,
        entryPrice: mark,
        delta: Number(opt?.delta || 0),
        gamma: Number(opt?.gamma || 0),
        theta: Number(opt?.theta || 0),
        vega: Number(opt?.vega || 0)
      };
    });
  }, [selectedStrategy, chain, spotPrice, selectedExpiry, amount]);

  // Real-time Aggregate Greeks Sync
  const realtimeGreeks = useMemo(() => {
    if (!generateLegs.length) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
    
    return generateLegs.reduce((acc, leg) => {
      const mult = leg.side === 'long' ? 1 : -1;
      if (leg.type === 'spot') {
        acc.delta += 1 * mult; // Spot delta is 1
      } else {
        acc.delta += (leg.delta || 0) * mult;
        acc.gamma += (leg.gamma || 0) * mult;
        acc.theta += (leg.theta || 0) * mult;
        acc.vega += (leg.vega || 0) * mult;
      }
      return acc;
    }, { delta: 0, gamma: 0, theta: 0, vega: 0 });
  }, [generateLegs]);

  const handleExecute = async () => {
    if (!selectedStrategy || !onStrategyChosen) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      if (showToast) showToast("Please enter a valid amount.", "error");
      else alert("Please enter a valid amount.");
      return;
    }
    setIsSubmitting(true);
    try {
      if (!chain || chain.length === 0) {
        const msg = "Syncing market data... please wait for the options chain to load.";
        if (showToast) showToast(msg, "warning");
        return;
      }

      let entryPremium = 0;
      generateLegs.forEach(leg => {
        const mult = leg.side === 'long' ? 1 : -1;
        entryPremium += (leg.entryPrice || 0) * mult;
      });

      await onStrategyChosen({
        ...selectedStrategy,
        notional: amt,
        legs: generateLegs,
        netPremiumAtEntry: entryPremium,
        initialDelta: realtimeGreeks.delta,
        initialTheta: realtimeGreeks.theta,
        asset: underlying,
        timestamp: new Date().toISOString()
      });
      setSelectedStrategyId(null);
      setAmount(1);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ color: "#e5e7eb", fontSize: "0.85rem" }}>
      {/* Step 1: View */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            1. What is your view?
          </span>
          {selectedView && (
            <span style={{ fontSize: "0.75rem", color: "#38bdf8" }}>
              Active: {VIEWS.find((v) => v.id === selectedView)?.label}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          {VIEWS.map((v) => {
            const active = v.id === selectedView;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedView((prev) => (prev === v.id ? null : v.id))}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${active ? v.border : "rgba(148,163,184,0.25)"}`,
                  background: active ? v.bg : "rgba(15,23,42,0.85)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: v.accent, marginBottom: 4 }}>
                  {v.label}
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{v.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Horizon */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            2. Time horizon
          </span>
          {selectedHorizon && (
            <span style={{ fontSize: "0.75rem", color: "#38bdf8" }}>
              Active: {TIME_HORIZONS.find((h) => h.id === selectedHorizon)?.label}
            </span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
          {TIME_HORIZONS.map((h) => {
            const active = h.id === selectedHorizon;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => setSelectedHorizon((prev) => (prev === h.id ? null : h.id))}
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${active ? "rgba(94,234,212,0.65)" : "rgba(148,163,184,0.25)"}`,
                  background: active ? "rgba(15,118,110,0.22)" : "rgba(15,23,42,0.85)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: "#e5e7eb", marginBottom: 2 }}>
                  {h.label}
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>{h.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 3: Strategy list */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            3. Suggested strategies
          </span>
          {selectedView && selectedHorizon && (
            <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
              Ranked by probability
            </span>
          )}
        </div>

        {!selectedView || !selectedHorizon ? (
          <div style={{ borderRadius: 10, border: "1px dashed rgba(148,163,184,0.4)", padding: 12, fontSize: 12, color: "#9ca3af" }}>
            Choose a view and horizon to see candidate strategies.
          </div>
        ) : loading && chain.length === 0 ? (
          <div style={{ borderRadius: 10, border: "1px dashed rgba(56,189,248,0.6)", padding: 24, fontSize: 13, color: "#38bdf8", background: "rgba(15,23,42,0.6)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
             <div className="spinner" style={{ width: 24, height: 24, border: "2px solid rgba(56,189,248,0.2)", borderTopColor: "#38bdf8", borderRadius: "50%" }}></div>
             Syncing real-time market data for {underlying}...
          </div>
        ) : visible.length === 0 ? (
          <div style={{ borderRadius: 10, border: "1px dashed rgba(248,113,113,0.6)", padding: 12, fontSize: 12, color: "#fecaca", background: "rgba(127,29,29,0.25)" }}>
            No strategies in the library match this combination yet. Try a different horizon or view.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="option-chain-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Strategy</th>
                  <th style={{ textAlign: "left" }}>Tier</th>
                  <th style={{ textAlign: "left" }}>Est. prob.</th>
                  <th style={{ textAlign: "left" }}>Payoff profile</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const tier = TIER_META[s.tier] || TIER_META.medium;
                  const isSelected = s.id === selectedStrategyId;
                  return (
                    <React.Fragment key={s.id}>
                      <tr
                        onClick={() => setSelectedStrategyId(prev => prev === s.id ? null : s.id)}
                        style={{ cursor: "pointer", background: isSelected ? "rgba(56,189,248,0.1)" : "" }}
                      >
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: "0.85rem", fontWeight: 600, color: isSelected ? "#38bdf8" : "#e2e8f0" }}>{s.name}</span>
                            <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>{s.summary}</span>
                          </div>
                        </td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, padding: "2px 8px", fontSize: "0.7rem", background: tier.bg, color: tier.color, border: `1px solid ${tier.border}`, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.02em" }}>
                            {tier.label}
                          </span>
                        </td>
                        <td style={{ fontWeight: 600, color: "#38bdf8" }}>{(s.probability * 100).toFixed(0)}%</td>
                        <td style={{ color: "#e2e8f0" }}>{s.payoffLabel}</td>
                      </tr>
                      {isSelected && (
                        <tr key={`${s.id}-details`} className="strategy-details-row">
                          <td colSpan="4" style={{ padding: "16px", background: "rgba(15,23,42,0.4)", borderBottom: "1px solid rgba(56,189,248,0.2)" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                              {/* Explanation & Greeks */}
                              <div>
                                <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid rgba(148,163,184,0.1)" }}>
                                  <p style={{ fontSize: "0.8rem", color: "#e2e8f0", margin: 0, lineHeight: 1.4, fontWeight: 500 }}>{s.summary}</p>
                                  <div style={{ fontSize: "0.72rem", color: "#38bdf8", marginTop: "6px", fontStyle: "italic", background: "rgba(56,189,248,0.05)", padding: "4px 8px", borderRadius: "4px", display: "inline-block" }}>
                                    Structure: {s.legs}
                                  </div>
                                </div>
                                <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.05em" }}>Strategy Greeks (Live)</div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                                  <div className="greek-box" style={{ background: "rgba(15,23,42,0.6)", borderRadius: "6px", padding: "6px", textAlign: "center" }}>
                                    <label style={{ display: "block", fontSize: "0.6rem", color: "#64748b", marginBottom: "2px" }}>Delta</label>
                                    <strong style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>{realtimeGreeks.delta.toFixed(3)}</strong>
                                  </div>
                                  <div className="greek-box" style={{ background: "rgba(15,23,42,0.6)", borderRadius: "6px", padding: "6px", textAlign: "center" }}>
                                    <label style={{ display: "block", fontSize: "0.6rem", color: "#64748b", marginBottom: "2px" }}>Gamma</label>
                                    <strong style={{ fontSize: "0.85rem", color: "#e2e8f0" }}>{realtimeGreeks.gamma.toFixed(4)}</strong>
                                  </div>
                                  <div className="greek-box" style={{ background: "rgba(15,23,42,0.6)", borderRadius: "6px", padding: "6px", textAlign: "center" }}>
                                    <label style={{ display: "block", fontSize: "0.6rem", color: "#64748b", marginBottom: "2px" }}>Theta</label>
                                    <strong style={{ fontSize: "0.85rem", color: "#ef4444" }}>{realtimeGreeks.theta.toFixed(2)}</strong>
                                  </div>
                                  <div className="greek-box" style={{ background: "rgba(15,23,42,0.6)", borderRadius: "6px", padding: "6px", textAlign: "center" }}>
                                    <label style={{ display: "block", fontSize: "0.6rem", color: "#64748b", marginBottom: "2px" }}>Vega</label>
                                    <strong style={{ fontSize: "0.85rem", color: "#38bdf8" }}>{realtimeGreeks.vega.toFixed(2)}</strong>
                                  </div>
                                </div>
                              </div>

                              {/* Execution */}
                              <div>
                                <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", marginBottom: "8px", letterSpacing: "0.05em" }}>Trade Execution</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                  <div style={{ position: "relative", flex: "1 1 120px" }}>
                                    {availableExpiries.length > 0 ? (
                                      <select
                                        value={selectedExpiry}
                                        onChange={(e) => setSelectedExpiry(e.target.value)}
                                        className="options-leg-input"
                                        style={{ width: "100%", padding: "8px", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: "6px", color: "#fff", fontSize: "0.85rem", appearance: "none" }}
                                      >
                                        {!availableExpiries.some(exp => new Date(exp * 1000).toISOString().split('T')[0] === String(selectedExpiry)) && (
                                           <option value={selectedExpiry}>{new Date(selectedExpiry).toLocaleDateString()}</option>
                                        )}
                                        {availableExpiries.map(exp => (
                                          <option key={exp} value={new Date(exp * 1000).toISOString().split('T')[0]}>
                                            {new Date(exp * 1000).toLocaleDateString()}
                                          </option>
                                        ))}
                                      </select>
                                    ) : (
                                      <input
                                        type="date"
                                        value={selectedExpiry}
                                        min={new Date().toISOString().split("T")[0]}
                                        onChange={(e) => setSelectedExpiry(e.target.value)}
                                        className="options-leg-input"
                                        style={{ width: "100%", padding: "8px", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: "6px", color: "#fff", fontSize: "0.85rem" }}
                                      />
                                    )}
                                    <span style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "#38bdf8", fontSize: "14px" }}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                    </span>
                                  </div>
                                  <input 
                                    type="number"
                                    placeholder="Qty"
                                    value={amount}
                                    onChange={(e) => setAmount(Number(e.target.value))}
                                    style={{ width: "70px", background: "rgba(15,23,42,0.6)", border: "1px solid rgba(148,163,184,0.3)", borderRadius: "6px", padding: "8px", color: "#fff", fontSize: "0.85rem" }}
                                  />
                                  <button
                                    onClick={handleExecute}
                                    disabled={isSubmitting}
                                    style={{ background: "var(--color-primary, #38bdf8)", color: "#000", border: "none", borderRadius: "6px", padding: "0 16px", fontWeight: "600", fontSize: "0.85rem", cursor: "pointer", transition: "opacity 0.2s" }}
                                  >
                                    {isSubmitting ? "..." : "Execute"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 6, fontSize: 10, color: "#6b7280" }}>
              Click a row to push this strategy into the Options trade ticket. Probabilities are heuristic and for guidance only.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OptionsStrategySimulator;
