import { useState, useMemo } from "react";

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
      horizons: ["medium", "long"],
      payoffLabel: "Income + capped upside",
      summary: "Hold spot and sell OTM calls to earn yield.",
      legs: "Long 1x spot + Short 1x OTM call",
    },
    {
      name: "Bull Call Spread",
      tier: "medium",
      horizons: ["short", "medium"],
      payoffLabel: "Defined-risk upside",
      summary: "Buy lower-strike call, sell higher-strike call.",
      legs: "Long 1x lower-strike call + Short 1x higher-strike call",
    },
    {
      name: "Long Call",
      tier: "speculative",
      horizons: ["short", "medium"],
      payoffLabel: "Leveraged upside",
      summary: "Pure upside convexity, loss capped at premium.",
      legs: "Long 1x ATM/OTM call",
    },
  ],
  bearish: [
    {
      name: "Bear Put Spread",
      tier: "medium",
      horizons: ["short", "medium"],
      payoffLabel: "Defined-risk downside",
      summary: "Buy higher-strike put, sell lower-strike put.",
      legs: "Long 1x higher-strike put + Short 1x lower-strike put",
    },
    {
      name: "Long Put",
      tier: "speculative",
      horizons: ["short"],
      payoffLabel: "Leveraged downside",
      summary: "Pure downside bet, loss capped at premium.",
      legs: "Long 1x ATM/OTM put",
    },
  ],
  protect: [
    {
      name: "Protective Put",
      tier: "high",
      horizons: ["short", "medium", "long"],
      payoffLabel: "Floor on long spot",
      summary: "Buy OTM put to cap downside on an existing long.",
      legs: "Existing long spot + Long 1x OTM put",
    },
    {
      name: "Collar",
      tier: "medium",
      horizons: ["medium", "long"],
      payoffLabel: "Capped up/down, low cost",
      summary: "Buy put and finance it by selling OTM call.",
      legs: "Long spot + Long 1x OTM put + Short 1x OTM call",
    },
  ],
  rangebound: [
    {
      name: "Iron Condor",
      tier: "high",
      horizons: ["medium"],
      payoffLabel: "High-prob range income",
      summary: "Short OTM put/call spreads around current price.",
      legs: "Short 1x OTM put + Long 1x further OTM put + Short 1x OTM call + Long 1x further OTM call",
    },
    {
      name: "Short Strangle",
      tier: "speculative",
      horizons: ["short", "medium"],
      payoffLabel: "Max theta, undefined risk",
      summary: "Short OTM put and call, expects price to stay in band.",
      legs: "Short 1x OTM put + Short 1x OTM call",
    },
  ],
  breakout: [
    {
      name: "Long Straddle",
      tier: "medium",
      horizons: ["short"],
      payoffLabel: "Long vol both ways",
      summary: "Buy ATM call + put, profits from big move either way.",
      legs: "Long 1x ATM call + Long 1x ATM put",
    },
    {
      name: "Long Strangle",
      tier: "speculative",
      horizons: ["short"],
      payoffLabel: "Cheaper long vol",
      summary: "Buy OTM call and put, needs larger move to pay off.",
      legs: "Long 1x OTM call + Long 1x OTM put",
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

export default function OptionsStrategySimulator({
  underlying,
  maxVisible = 10,
  onStrategyChosen,
}) {
  const [selectedView, setSelectedView] = useState(null);
  const [selectedHorizon, setSelectedHorizon] = useState(null);

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

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(148,163,184,0.15)",
        background: "#000000",
        padding: 16,
        color: "#e5e7eb",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>
          Strategy simulator for {underlying}
        </h3>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>
          Express your view → pick a play
        </span>
      </div>

      {/* Step 1: View */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: "#e5e7eb" }}>
            1. What is your view?
          </span>
          {selectedView && (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              Selected:{" "}
              {
                VIEWS.find((v) => v.id === selectedView)?.label ??
                selectedView
              }
            </span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
          }}
        >
          {VIEWS.map((v) => {
            const active = v.id === selectedView;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() =>
                  setSelectedView((prev) => (prev === v.id ? null : v.id))
                }
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${
                    active ? v.border : "rgba(148,163,184,0.25)"
                  }`,
                  background: active ? v.bg : "rgba(15,23,42,0.85)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: v.accent,
                    marginBottom: 4,
                  }}
                >
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: "#e5e7eb" }}>
            2. Time horizon
          </span>
          {selectedHorizon && (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              Selected:{" "}
              {
                TIME_HORIZONS.find((h) => h.id === selectedHorizon)?.label ??
                selectedHorizon
              }
            </span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 8,
          }}
        >
          {TIME_HORIZONS.map((h) => {
            const active = h.id === selectedHorizon;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() =>
                  setSelectedHorizon((prev) => (prev === h.id ? null : h.id))
                }
                style={{
                  textAlign: "left",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${
                    active
                      ? "rgba(94,234,212,0.65)"
                      : "rgba(148,163,184,0.25)"
                  }`,
                  background: active
                    ? "rgba(15,118,110,0.22)"
                    : "rgba(15,23,42,0.85)",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#e5e7eb",
                    marginBottom: 2,
                  }}
                >
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 500, color: "#e5e7eb" }}>
            3. Suggested strategies
          </span>
          {selectedView && selectedHorizon && (
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              Ranked by probability and payoff profile
            </span>
          )}
        </div>

        {!selectedView || !selectedHorizon ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px dashed rgba(148,163,184,0.4)",
              padding: 12,
              fontSize: 12,
              color: "#9ca3af",
            }}
          >
            Choose a view and horizon to see candidate strategies.
          </div>
        ) : visible.length === 0 ? (
          <div
            style={{
              borderRadius: 10,
              border: "1px dashed rgba(248,113,113,0.6)",
              padding: 12,
              fontSize: 12,
              color: "#fecaca",
              background: "rgba(127,29,29,0.25)",
            }}
          >
            No strategies in the library match this combination yet. Try a
            different horizon or view.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                minWidth: 480,
              }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    background: "rgba(15,23,42,0.9)",
                  }}
                >
                  <th style={thStyle}>Strategy</th>
                  <th style={thStyle}>Tier</th>
                  <th style={thStyle}>Est. prob.</th>
                  <th style={thStyle}>Payoff profile</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const tier = TIER_META[s.tier] || TIER_META.medium;
                  return (
                    <tr
                      key={s.id}
                      onClick={() =>
                        onStrategyChosen && onStrategyChosen(s)
                      }
                      style={{
                        cursor: "pointer",
                        background: "rgba(15,23,42,0.85)",
                      }}
                    >
                      <td style={tdStyle}>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: "#e5e7eb",
                            }}
                          >
                            {s.name}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: "#9ca3af",
                            }}
                          >
                            {s.summary}
                          </span>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            borderRadius: 999,
                            padding: "2px 8px",
                            fontSize: 11,
                            background: tier.bg,
                            color: tier.color,
                            border: `1px solid ${tier.border}`,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "999px",
                              background: tier.color,
                            }}
                          />
                          {tier.label}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {(s.probability * 100).toFixed(1)}%
                      </td>
                      <td style={tdStyle}>{s.payoffLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                color: "#6b7280",
              }}
            >
              Click a row to push this strategy into the Options trade ticket.
              Probabilities are heuristic and for guidance only.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle = {
  padding: "6px 8px",
  borderBottom: "1px solid rgba(51,65,85,0.8)",
  fontWeight: 500,
  color: "#9ca3af",
};

const tdStyle = {
  padding: "6px 8px",
  borderBottom: "1px solid rgba(30,41,59,0.85)",
};
