import { useState, useEffect, useRef } from "react";

// ─── Data ────────────────────────────────────────────────────────────────────

const VIEWS = [
  {
    id: "bullish",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 18V4M11 4L5 10M11 4L17 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Asset will rise",
    desc: "Bullish directional view",
    accent: "#22c55e",
    bg: "rgba(34,197,94,0.08)",
    border: "rgba(34,197,94,0.22)",
  },
  {
    id: "bearish",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 4V18M11 18L5 12M11 18L17 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Asset will fall",
    desc: "Bearish directional view",
    accent: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.22)",
  },
  {
    id: "protect",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M11 3L4 6.5V12c0 3.5 3 6.5 7 7.5 4-1 7-4 7-7.5V6.5L11 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Protect a position",
    desc: "Hedge existing exposure",
    accent: "#38bdf8",
    bg: "rgba(56,189,248,0.08)",
    border: "rgba(56,189,248,0.22)",
  },
  {
    id: "rangebound",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 11H18M7 7.5C7 7.5 9 10 11 10s4-2.5 4-2.5M7 14.5C7 14.5 9 12 11 12s4 2.5 4 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
    label: "Price stays in range",
    desc: "Sideways / consolidation view",
    accent: "#a78bfa",
    bg: "rgba(167,139,250,0.08)",
    border: "rgba(167,139,250,0.22)",
  },
  {
    id: "breakout",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M4 14L8 9l3 4 3-6 4 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M18 8V14H12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Big move coming",
    desc: "Direction unknown — vol play",
    accent: "#f59e0b",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.22)",
  },
  {
    id: "volatility",
    icon: null,
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <path d="M3 11h2l2-5 3 10 3-12 2 7h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    label: "Volatility will change",
    desc: "IV expansion or contraction",
    accent: "#fb7185",
    bg: "rgba(251,113,133,0.08)",
    border: "rgba(251,113,133,0.22)",
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
    label: "High Probability",
    sub: "65–85% win rate",
    color: "#22c55e",
    bg: "rgba(34,197,94,0.10)",
    border: "rgba(34,197,94,0.28)",
    dot: "#22c55e",
    rank: 1,
  },
  medium: {
    label: "Moderate Probability",
    sub: "40–65% win rate",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.10)",
    border: "rgba(245,158,11,0.28)",
    dot: "#f59e0b",
    rank: 2,
  },
  speculative: {
    label: "Speculative",
    sub: "20–40% win rate",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.10)",
    border: "rgba(239,68,68,0.28)",
    dot: "#ef4444",
    rank: 3,
  },
};

const STRATEGY_LIBRARY = {
  bullish: [
    {
      name: "Bull Put Spread",
      tier: "high",
      summary: "Sell OTM put, buy further OTM put for protection",
      legs: "Short higher-strike put + Long lower-strike put",
      maxProfit: "Net credit received",
      maxLoss: "Strike width − net credit",
      breakeven: "Higher strike − net credit",
      setupCost: "Net credit",
      riskProfile: "Capped / Defined",
      horizons: ["short", "medium"],
      why: "Collects premium upfront. Very high probability when the short put is struck OTM. Profits as long as the asset stays flat or rises.",
      tags: ["credit spread", "theta positive"],
    },
    {
      name: "Bull Call Spread",
      tier: "high",
      summary: "Buy lower-strike call, sell higher-strike call",
      legs: "Long lower-strike call + Short higher-strike call",
      maxProfit: "Strike width − net debit",
      maxLoss: "Net debit paid",
      breakeven: "Lower strike + net debit",
      setupCost: "Moderate debit",
      riskProfile: "Defined / Defined",
      horizons: ["short", "medium", "long"],
      why: "Defined risk with directional upside. Reduces the cost of a naked long call by selling a further OTM call. Best when expecting a moderate rise.",
      tags: ["debit spread", "defined risk"],
    },
    {
      name: "Covered Call",
      tier: "high",
      summary: "Hold underlying + sell OTM call against it",
      legs: "Long 100 units spot + Short OTM call",
      maxProfit: "Call strike − entry + premium",
      maxLoss: "Entry − premium (asset falls to zero)",
      breakeven: "Entry − premium received",
      setupCost: "Requires holding underlying",
      riskProfile: "Capped / Substantial",
      horizons: ["medium", "long"],
      why: "Generates income from a long position you already hold. Cushions small downturns. Best in mildly bullish or flat markets.",
      tags: ["income", "theta positive"],
    },
    {
      name: "Long Call",
      tier: "medium",
      summary: "Buy ATM or slightly OTM call for directional leverage",
      legs: "Long ATM or OTM call",
      maxProfit: "Unlimited above breakeven",
      maxLoss: "Premium paid (fully defined)",
      breakeven: "Strike + premium paid",
      setupCost: "Full premium debit",
      riskProfile: "Unlimited / Defined",
      horizons: ["short", "medium", "long", "leaps"],
      why: "Pure leveraged bullish bet. Profits compound as the asset rises above the breakeven. Loss is fully capped at premium paid.",
      tags: ["directional", "long delta"],
    },
    {
      name: "Cash-Secured Put",
      tier: "high",
      summary: "Sell OTM put with full cash reserved for assignment",
      legs: "Short OTM put + Cash collateral reserved",
      maxProfit: "Premium received",
      maxLoss: "Strike − premium (asset falls to zero)",
      breakeven: "Strike − premium",
      setupCost: "Cash collateral",
      riskProfile: "Capped / Substantial",
      horizons: ["medium", "long"],
      why: "Earn premium while willing to buy the asset at a discount. Historically high win rate in mild bull markets when sold OTM.",
      tags: ["income", "acquisition play"],
    },
    {
      name: "Long LEAP Call",
      tier: "medium",
      summary: "Buy deep ITM call with 6–12 month expiry",
      legs: "Long deep ITM or ATM call, 180–365 days out",
      maxProfit: "Unlimited above breakeven",
      maxLoss: "Premium paid",
      breakeven: "Strike + premium",
      setupCost: "High premium — lower per day vs short-dated",
      riskProfile: "Unlimited / Defined",
      horizons: ["leaps"],
      why: "Leveraged stock substitute with defined downside. Acts like owning the asset at a fraction of the capital outlay.",
      tags: ["LEAPS", "stock substitute"],
    },
    {
      name: "Bull Risk Reversal",
      tier: "speculative",
      summary: "Short OTM put, long OTM call — near zero cost",
      legs: "Short OTM put + Long OTM call (similar delta)",
      maxProfit: "Unlimited to the upside",
      maxLoss: "Unlimited below the short put",
      breakeven: "Near zero or small debit/credit",
      setupCost: "Near zero",
      riskProfile: "Unlimited / Unlimited",
      horizons: ["medium", "long"],
      why: "Structured bullish view at near-zero cost. Very dangerous if the asset crashes hard — the short put carries full downside below the strike.",
      tags: ["synthetic", "zero-cost", "high risk"],
    },
  ],
  bearish: [
    {
      name: "Bear Call Spread",
      tier: "high",
      summary: "Sell OTM call, buy higher-strike call for protection",
      legs: "Short lower-strike call + Long higher-strike call",
      maxProfit: "Net credit received",
      maxLoss: "Strike width − net credit",
      breakeven: "Lower strike + net credit",
      setupCost: "Net credit",
      riskProfile: "Capped / Defined",
      horizons: ["short", "medium"],
      why: "Collects premium if the asset stays below the short call. Very high probability when sold OTM. Theta decays in your favour daily.",
      tags: ["credit spread", "theta positive"],
    },
    {
      name: "Bear Put Spread",
      tier: "high",
      summary: "Buy higher-strike put, sell lower-strike put",
      legs: "Long higher-strike put + Short lower-strike put",
      maxProfit: "Strike width − net debit",
      maxLoss: "Net debit paid",
      breakeven: "Higher strike − net debit",
      setupCost: "Moderate debit",
      riskProfile: "Defined / Defined",
      horizons: ["short", "medium"],
      why: "Defined risk bearish play. The short put reduces the cost significantly versus holding a naked long put.",
      tags: ["debit spread", "defined risk"],
    },
    {
      name: "Long Put",
      tier: "medium",
      summary: "Buy ATM or OTM put for direct bearish exposure",
      legs: "Long ATM or OTM put",
      maxProfit: "Strike − premium paid",
      maxLoss: "Premium paid (fully defined)",
      breakeven: "Strike − premium",
      setupCost: "Full premium debit",
      riskProfile: "Substantial / Defined",
      horizons: ["short", "medium", "long"],
      why: "Direct leveraged bearish bet. Profitable below the breakeven. Works well heading into known events or when IV is low.",
      tags: ["directional", "long delta negative"],
    },
    {
      name: "Ratio Put Spread",
      tier: "medium",
      summary: "Long 1 put, short 2 lower-strike puts — for moderate drops",
      legs: "Long 1 higher-strike put + Short 2 lower-strike puts",
      maxProfit: "Between the two strikes",
      maxLoss: "Unlimited below both short puts",
      breakeven: "Upper: near long strike. Lower: beyond short strikes",
      setupCost: "Small debit or near zero",
      riskProfile: "Capped / Unlimited (extreme move)",
      horizons: ["medium", "long"],
      why: "Profits from a moderate decline without paying full premium. Dangerous if a crash pushes past both short strikes.",
      tags: ["ratio spread", "moderate bearish"],
    },
    {
      name: "Put Backspread",
      tier: "speculative",
      summary: "Short 1 higher-strike put, long 2 lower-strike puts",
      legs: "Short 1 higher-strike put + Long 2 lower-strike puts",
      maxProfit: "Unlimited to zero (large crash profits)",
      maxLoss: "Max loss between the two strikes",
      breakeven: "Two breakeven points above and below",
      setupCost: "Near zero or small credit",
      riskProfile: "Unlimited below / Defined max loss",
      horizons: ["medium", "long"],
      why: "Crash play. Profits explosively from a large downside move. Long vega benefits from fear-driven IV spikes.",
      tags: ["backspread", "crash play", "long vega"],
    },
    {
      name: "Synthetic Short",
      tier: "speculative",
      summary: "Short call + long put at the same strike — no spot needed",
      legs: "Short ATM call + Long ATM put (same strike and expiry)",
      maxProfit: "Equivalent to shorting the underlying",
      maxLoss: "Unlimited to the upside",
      breakeven: "Strike ± net debit/credit",
      setupCost: "Near zero",
      riskProfile: "Substantial / Unlimited upside",
      horizons: ["medium", "long"],
      why: "Full bearish delta without owning the underlying. High risk if the asset rallies significantly — unlimited loss on the short call.",
      tags: ["synthetic short", "high risk"],
    },
  ],
  protect: [
    {
      name: "Protective Put",
      tier: "high",
      summary: "Buy OTM put against an existing long position",
      legs: "Existing long position + Long OTM put",
      maxProfit: "Unlimited above entry + premium",
      maxLoss: "Entry − put strike + premium paid",
      breakeven: "Entry + premium paid",
      setupCost: "Premium debit (recurring cost)",
      riskProfile: "Unlimited / Defined",
      horizons: ["short", "medium", "long"],
      why: "Full downside insurance. Your loss is hard-capped at the put strike minus the premium — like car insurance for your position.",
      tags: ["hedge", "insurance"],
    },
    {
      name: "Collar",
      tier: "high",
      summary: "Long spot + long OTM put + short OTM call — often near zero cost",
      legs: "Long spot + Long OTM put + Short OTM call",
      maxProfit: "Call strike − entry ± net premium",
      maxLoss: "Entry − put strike ± net premium",
      breakeven: "Entry ± net cost",
      setupCost: "Often near zero or small credit",
      riskProfile: "Capped upside / Defined downside",
      horizons: ["medium", "long", "leaps"],
      why: "Finances the put hedge by capping your upside via a call. Near-zero or zero net cost hedge. Ideal for long-term holdings you don't want to sell.",
      tags: ["zero-cost hedge", "collar"],
    },
    {
      name: "Married Put",
      tier: "high",
      summary: "Buy underlying and ATM put simultaneously at entry",
      legs: "Buy spot + Buy ATM put (entered together)",
      maxProfit: "Unlimited above entry + premium",
      maxLoss: "Premium paid only (fully insured below)",
      breakeven: "Entry + premium",
      setupCost: "Full spot cost + premium",
      riskProfile: "Unlimited / Premium only",
      horizons: ["medium", "long"],
      why: "Equivalent to a synthetic call. Entered at position initiation. Maximum protection from day one — your risk is only the premium.",
      tags: ["insurance", "synthetic call"],
    },
    {
      name: "Put Spread Collar",
      tier: "medium",
      summary: "Collar but with a spread on the put leg to reduce cost further",
      legs: "Long spot + Long OTM put + Short further OTM put + Short OTM call",
      maxProfit: "Call strike − entry + net credit",
      maxLoss: "Entry − long put strike + net debit",
      breakeven: "Entry ± net cost",
      setupCost: "Very low or small credit",
      riskProfile: "Capped / Defined with gap below short put",
      horizons: ["long", "leaps"],
      why: "Cheaper than a standard collar by spreading the put. Better for long-dated hedges where full protection cost is prohibitive.",
      tags: ["cheap hedge", "spread collar"],
    },
    {
      name: "Protective Call (Short Hedge)",
      tier: "high",
      summary: "Buy OTM call to cap losses on an existing short position",
      legs: "Existing short position + Long OTM call",
      maxProfit: "Entry − put floor (as asset falls)",
      maxLoss: "Call strike − short entry + premium",
      breakeven: "Short entry + premium",
      setupCost: "Premium debit",
      riskProfile: "Capped upside loss / Defined",
      horizons: ["short", "medium"],
      why: "Limits the upside risk on a short position. Hard cap on maximum loss if a short squeeze or sharp rally occurs.",
      tags: ["short hedge", "insurance"],
    },
  ],
  rangebound: [
    {
      name: "Iron Condor",
      tier: "high",
      summary: "Short OTM strangle with wing protection — the classic range play",
      legs: "Short OTM put + Long further OTM put + Short OTM call + Long further OTM call",
      maxProfit: "Net credit received",
      maxLoss: "Wing width − net credit",
      breakeven: "Short put − credit / Short call + credit",
      setupCost: "Net credit",
      riskProfile: "Capped / Defined",
      horizons: ["medium", "long"],
      why: "Profits if the price stays between the short strikes at expiry. Very high win rate when sold far OTM. The go-to strategy for range-bound conviction.",
      tags: ["high probability", "theta positive", "defined risk"],
    },
    {
      name: "Iron Butterfly",
      tier: "high",
      summary: "Short ATM straddle with wing protection",
      legs: "Short ATM call + Short ATM put + Long OTM call + Long OTM put",
      maxProfit: "Net credit (near ATM strike)",
      maxLoss: "Wing width − net credit",
      breakeven: "ATM strike ± net credit",
      setupCost: "Net credit",
      riskProfile: "Capped / Defined",
      horizons: ["medium", "long"],
      why: "Higher credit than an iron condor but a narrower profit zone. Best when you expect the price to pin right at a specific level.",
      tags: ["theta positive", "pin risk play"],
    },
    {
      name: "Short Straddle",
      tier: "medium",
      summary: "Sell ATM call and put — maximum theta decay",
      legs: "Short ATM call + Short ATM put (same strike)",
      maxProfit: "Total premium collected",
      maxLoss: "Unlimited on both sides",
      breakeven: "Strike ± total premium",
      setupCost: "Net credit",
      riskProfile: "Capped / Unlimited",
      horizons: ["short", "medium"],
      why: "Maximum theta decay at ATM strikes. Very profitable in flat markets but highly risky with any large move. Requires margin.",
      tags: ["naked", "high premium", "undefined risk"],
    },
    {
      name: "Short Strangle",
      tier: "medium",
      summary: "Sell OTM call and put — wider breakevens than straddle",
      legs: "Short OTM put + Short OTM call (same expiry)",
      maxProfit: "Total premium collected",
      maxLoss: "Unlimited on both sides",
      breakeven: "Short put − premium / Short call + premium",
      setupCost: "Net credit",
      riskProfile: "Capped / Unlimited",
      horizons: ["medium"],
      why: "Wider profit zone than a short straddle with less credit. High probability when both legs are sold OTM. Undefined risk on large moves.",
      tags: ["naked", "theta positive", "undefined risk"],
    },
    {
      name: "Calendar Spread",
      tier: "medium",
      summary: "Short near-term ATM option + long longer-dated ATM option",
      legs: "Short near-term ATM option + Long back-month ATM option",
      maxProfit: "When spot pins near strike at near-term expiry",
      maxLoss: "Net debit paid",
      breakeven: "Spot at or near short strike at front expiry",
      setupCost: "Small net debit",
      riskProfile: "Capped / Defined",
      horizons: ["medium", "long"],
      why: "Benefits from theta decay of the short front leg while holding long exposure in the back month. Low cost neutral strategy.",
      tags: ["theta + vega play", "calendar"],
    },
  ],
  breakout: [
    {
      name: "Long Straddle",
      tier: "high",
      summary: "Buy ATM call and put — profit from any large move",
      legs: "Long ATM call + Long ATM put (same strike, same expiry)",
      maxProfit: "Unlimited in either direction",
      maxLoss: "Total premium paid",
      breakeven: "Strike − premium / Strike + premium",
      setupCost: "Double ATM premium",
      riskProfile: "Unlimited / Defined",
      horizons: ["short", "medium"],
      why: "Profits from any large directional move. Works best before earnings or major catalysts when IV is still relatively low. Pure volatility long.",
      tags: ["long vol", "earnings play"],
    },
    {
      name: "Long Strangle",
      tier: "medium",
      summary: "Buy OTM call and put — cheaper than a straddle",
      legs: "Long OTM put + Long OTM call (same expiry, different strikes)",
      maxProfit: "Unlimited in either direction",
      maxLoss: "Total premium paid",
      breakeven: "Put strike − premium / Call strike + premium",
      setupCost: "Lower than straddle",
      riskProfile: "Unlimited / Defined",
      horizons: ["short", "medium"],
      why: "Cheaper than a straddle. Needs a larger move to profit but offers defined risk and unlimited upside in either direction.",
      tags: ["long vol", "cheaper straddle"],
    },
    {
      name: "Reverse Iron Condor",
      tier: "medium",
      summary: "Long OTM wings — profits if price escapes the middle zone",
      legs: "Long OTM put + Short further OTM put + Long OTM call + Short further OTM call",
      maxProfit: "Wing width − net debit (if price breaks out in either direction)",
      maxLoss: "Net debit paid",
      breakeven: "Long put − debit / Long call + debit",
      setupCost: "Net debit",
      riskProfile: "Defined / Defined",
      horizons: ["medium"],
      why: "Defined risk breakout play. Benefits from price escaping the inner zone in either direction. Cheaper than a straddle.",
      tags: ["reverse condor", "defined risk breakout"],
    },
    {
      name: "Call Backspread",
      tier: "speculative",
      summary: "Short 1 lower-strike call + long 2 higher-strike calls",
      legs: "Short 1 lower-strike call + Long 2 higher-strike calls",
      maxProfit: "Unlimited to the upside",
      maxLoss: "Between the two strikes only",
      breakeven: "Upper: above upper strike + spread",
      setupCost: "Near zero or small credit",
      riskProfile: "Unlimited upside / Defined in middle",
      horizons: ["medium", "long"],
      why: "Profits explosively from a large upside move. Often entered for near zero net cost. Most dangerous between the two strikes.",
      tags: ["call backspread", "explosive upside"],
    },
    {
      name: "Gut Strangle",
      tier: "speculative",
      summary: "Long ITM call + Long ITM put — high delta, high cost",
      legs: "Long ITM call + Long ITM put (overlapping strikes)",
      maxProfit: "Profits from a very large move in either direction",
      maxLoss: "Total premium paid",
      breakeven: "Wide breakevens due to high premium",
      setupCost: "High (ITM premiums)",
      riskProfile: "Unlimited / Defined",
      horizons: ["short", "medium"],
      why: "High-delta position in both directions. Profits from any significant move. More expensive than a strangle but with more immediate delta response.",
      tags: ["high delta", "expensive straddle variant"],
    },
  ],
  volatility: [
    {
      name: "Long Straddle (IV Play)",
      tier: "high",
      summary: "Long ATM call + put — maximum positive vega exposure",
      legs: "Long ATM call + Long ATM put",
      maxProfit: "Proportional to IV increase + any large move",
      maxLoss: "Total premium (theta decay if no move)",
      breakeven: "IV must rise to offset theta decay",
      setupCost: "Double ATM premium",
      riskProfile: "IV-sensitive / Theta decay",
      horizons: ["short", "medium"],
      why: "Maximum positive vega. Profits directly from IV expansion even without a large price move. Best entered when IV is historically low.",
      tags: ["long vega", "IV expansion"],
    },
    {
      name: "Short Vol Iron Condor",
      tier: "high",
      summary: "Short OTM strangle + protective wings — IV crush play",
      legs: "Short OTM strangle + Long OTM wing protection",
      maxProfit: "Net credit if IV collapses and price stays in range",
      maxLoss: "Wing width − net credit",
      breakeven: "Short strikes adjusted for credit received",
      setupCost: "Net credit",
      riskProfile: "Capped / Defined",
      horizons: ["medium", "long"],
      why: "The classic post-event IV crush trade. Enter when IV is elevated (e.g., right before earnings), collect the inflated premium, profit as IV collapses.",
      tags: ["short vega", "IV crush", "post-event"],
    },
    {
      name: "Calendar Spread (Vol Term Structure)",
      tier: "medium",
      summary: "Short front-month + long back-month — term structure play",
      legs: "Short front-month ATM option + Long back-month ATM option",
      maxProfit: "Front-month IV falls faster than back-month IV",
      maxLoss: "Net debit paid",
      breakeven: "Front-month expiry spot near ATM strike",
      setupCost: "Small net debit",
      riskProfile: "Vega-dependent / Defined",
      horizons: ["medium", "long"],
      why: "Profits when the IV term structure steepens. Works well when near-term IV is temporarily elevated vs. longer-dated IV.",
      tags: ["term structure", "calendar"],
    },
    {
      name: "Diagonal Spread (IV Harvest)",
      tier: "medium",
      summary: "Short near-term elevated IV, hold longer-dated protection",
      legs: "Short near-term OTM option + Long same-strike further-dated option",
      maxProfit: "Differential between near-term and far-month IV",
      maxLoss: "Net debit paid",
      breakeven: "Dependent on IV differential over time",
      setupCost: "Small net debit",
      riskProfile: "Defined / Defined",
      horizons: ["long", "leaps"],
      why: "Harvests persistently high near-term IV while holding a longer-dated position. Effective when the front month consistently trades at a vol premium.",
      tags: ["IV harvest", "diagonal"],
    },
    {
      name: "Long OTM Strangle (IV Spike)",
      tier: "speculative",
      summary: "Long OTM call + put — low cost lottery for IV explosion",
      legs: "Long OTM call + Long OTM put (wide strikes)",
      maxProfit: "Large move OR IV spike before expiry",
      maxLoss: "Total premium paid",
      breakeven: "Must move beyond total debit in either direction",
      setupCost: "Low premium",
      riskProfile: "Unlimited / Defined",
      horizons: ["short"],
      why: "Cheap lottery ticket for a sudden IV explosion. Even without a realized price move, a spike in IV alone can generate profits before expiry.",
      tags: ["IV spike", "speculative", "low cost"],
    },
  ],
};

// ─── Mini P&L Sparkline ───────────────────────────────────────────────────────

function PnlSparkline({ tier }) {
  const colors = {
    high: { profit: "#22c55e", loss: "#ef4444" },
    medium: { profit: "#f59e0b", loss: "#ef4444" },
    speculative: { profit: "#38bdf8", loss: "#ef4444" },
  };
  const c = colors[tier] || colors.medium;

  const profiles = {
    high: [[0, -0.3], [0.3, -0.3], [0.5, 0.8], [0.7, 0.8], [1, 0.8]],
    medium: [[0, -0.5], [0.3, -0.5], [0.5, 0.9], [0.75, 0.9], [1, 0.9]],
    speculative: [[0, -0.2], [0.35, -0.2], [0.5, 0.2], [0.7, 1], [1, 1.2]],
  };

  const pts = profiles[tier] || profiles.medium;
  const W = 80, H = 32;
  const toSvg = ([x, y]) => [x * W, H / 2 - y * (H / 2.6)];
  const svgPts = pts.map(toSvg);

  const d = svgPts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const zeroY = (H / 2).toFixed(1);

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" style={{ flexShrink: 0 }}>
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
      <path d={d} stroke={c.profit} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Strategy Card ────────────────────────────────────────────────────────────

function StrategyCard({ strategy, viewAccent, index, onExecute }) {
  const [expanded, setExpanded] = useState(false);
  const tier = TIER_META[strategy.tier] || TIER_META.medium;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${tier.border}`,
        borderRadius: "12px",
        padding: "14px 16px",
        cursor: "pointer",
        transition: "background 0.15s",
        position: "relative",
        overflow: "hidden",
      }}
      onClick={() => setExpanded((v) => !v)}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.045)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
    >
      {/* Tier accent line */}
      <div style={{
        position: "absolute",
        left: 0, top: 0, bottom: 0, width: "3px",
        background: tier.color,
        borderRadius: "12px 0 0 12px",
      }} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", paddingLeft: "4px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9", letterSpacing: "-0.01em" }}>
              {strategy.name}
            </span>
            <span style={{
              fontSize: "10px",
              padding: "2px 7px",
              borderRadius: "99px",
              background: tier.bg,
              color: tier.color,
              border: `1px solid ${tier.border}`,
              fontWeight: 500,
              flexShrink: 0,
            }}>
              {tier.label}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "11.5px", color: "#94a3b8", lineHeight: 1.45 }}>
            {strategy.summary}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          <PnlSparkline tier={strategy.tier} />
          <svg
            width="14" height="14" viewBox="0 0 14 14" fill="none"
            style={{ color: "#64748b", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", flexShrink: 0 }}
          >
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      {/* Quick stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "10px", paddingLeft: "4px" }}>
        {[
          { label: "Max Profit", value: strategy.maxProfit, color: "#22c55e" },
          { label: "Max Loss", value: strategy.maxLoss, color: "#ef4444" },
          { label: "Risk Profile", value: strategy.riskProfile, color: "#94a3b8" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "rgba(0,0,0,0.25)", borderRadius: "7px", padding: "7px 8px" }}>
            <p style={{ margin: "0 0 2px", fontSize: "9.5px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</p>
            <p style={{ margin: 0, fontSize: "10.5px", color, fontWeight: 500, lineHeight: 1.3 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          marginTop: "12px",
          paddingTop: "12px",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          paddingLeft: "4px",
          animation: "fadeIn 0.15s ease",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "10px" }}>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Legs</p>
              <p style={{ margin: 0, fontSize: "11px", color: "#cbd5e1", lineHeight: 1.5 }}>{strategy.legs}</p>
            </div>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Breakeven</p>
              <p style={{ margin: 0, fontSize: "11px", color: "#cbd5e1", lineHeight: 1.5 }}>{strategy.breakeven}</p>
            </div>
            <div>
              <p style={{ margin: "0 0 3px", fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Setup Cost</p>
              <p style={{ margin: 0, fontSize: "11px", color: "#cbd5e1" }}>{strategy.setupCost}</p>
            </div>
          </div>

          <div style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "8px", padding: "10px 12px" }}>
            <p style={{ margin: "0 0 3px", fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Why This Strategy?</p>
            <p style={{ margin: 0, fontSize: "11.5px", color: "#cbd5e1", lineHeight: 1.55 }}>{strategy.why}</p>
          </div>

          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "10px" }}>
            {(strategy.tags || []).map((tag) => (
              <span key={tag} style={{
                fontSize: "10px",
                padding: "3px 8px",
                borderRadius: "99px",
                background: "rgba(255,255,255,0.06)",
                color: "#94a3b8",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="strategy-card">
      {/* ... existing UI ... */}
      
      {expanded && (
        <div className="strategy-expanded-details">
          {/* ... existing details ... */}
          
          {/* New Execution Section */}
          <div style={{ marginTop: "12px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px" }}>
             <p style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "8px" }}>Simulated Greeks profile based on current chain:</p>
             <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", color: "#22c55e" }}>Δ: +0.24</span>
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>Γ: 0.01</span>
                <span style={{ fontSize: "11px", color: "#38bdf8" }}>Θ: +$2.40/day</span>
                <span style={{ fontSize: "11px", color: "#a78bfa" }}>V: -$1.12</span>
             </div>
             
             <button 
                onClick={() => onExecute(strategy)}
                style={{ background: "#22c55e", color: "#fff", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", width: "100%" }}
             >
                Execute {strategy.name}
             </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OptionsStrategySimulator({   underlying,
  maxVisible = 5,
  onStrategyChosen, }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedView, setSelectedView] = useState(null);
  const [selectedHorizon, setSelectedHorizon] = useState(null);
  const overlayRef = useRef(null);

  const reset = () => {
    setStep(1);
    setSelectedView(null);
    setSelectedHorizon(null);
  };

  const handleClose = () => {
    setOpen(false);
    reset();
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") handleClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const viewMeta = VIEWS.find((v) => v.id === selectedView);

  const getStrategies = () => {
    if (!selectedView || !selectedHorizon) return [];
    const all = STRATEGY_LIBRARY[selectedView] || [];
    const filtered = all.filter((s) => !s.horizons || s.horizons.includes(selectedHorizon));
    // Group by tier rank, sort within tier by name
    return [...filtered].sort((a, b) => {
      const ra = TIER_META[a.tier]?.rank ?? 9;
      const rb = TIER_META[b.tier]?.rank ?? 9;
      return ra - rb;
    });
  };

  const strategies = getStrategies();

  const tierGroups = [
    { tierKey: "high", strategies: strategies.filter((s) => s.tier === "high") },
    { tierKey: "medium", strategies: strategies.filter((s) => s.tier === "medium") },
    { tierKey: "speculative", strategies: strategies.filter((s) => s.tier === "speculative") },
  ].filter((g) => g.strategies.length > 0);

  const BTN_BASE = {
    padding: "9px 18px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    transition: "all 0.15s",
  };

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...BTN_BASE,
          background: "rgba(167,139,250,0.12)",
          color: "#a78bfa",
          border: "1px solid rgba(167,139,250,0.25)",
          display: "flex",
          alignItems: "center",
          gap: "7px",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(167,139,250,0.2)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(167,139,250,0.12)"; }}
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <path d="M7.5 1.5V4M7.5 11V13.5M1.5 7.5H4M11 7.5H13.5M3.2 3.2L5 5M10 10L11.8 11.8M3.2 11.8L5 10M10 5L11.8 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
        Strategy Simulator
      </button>

      {/* Modal */}
      {open && (
        <div
          ref={overlayRef}
          className="modal-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === overlayRef.current) handleClose(); }}
        >
          <div
            style={{
              background: "linear-gradient(145deg, #0d1525 0%, #0a1020 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "16px",
              width: "100%",
              maxWidth: step === 3 ? "880px" : "700px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 1.5V4M9 14V16.5M1.5 9H4M14 9H16.5M3.4 3.4L5.2 5.2M12.8 12.8L14.6 14.6M3.4 14.6L5.2 12.8M12.8 5.2L14.6 3.4" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round"/>
                    <circle cx="9" cy="9" r="3" stroke="#a78bfa" strokeWidth="1.4"/>
                  </svg>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600, color: "#f1f5f9" }}>
                    Strategy Simulator
                  </h2>
                </div>
                <p style={{ margin: "4px 0 0 28px", fontSize: "12px", color: "#64748b" }}>
                  Express your market view → get matched strategies ranked by probability
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#64748b", padding: "4px", borderRadius: "6px" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#f1f5f9"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#64748b"; }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Step indicator */}
            <div style={{ padding: "14px 24px 0", display: "flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
              {["Market View", "Time Horizon", "Matched Strategies"].map((label, i) => {
                const stepNum = i + 1;
                const isActive = step === stepNum;
                const isDone = step > stepNum;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{
                        width: "22px", height: "22px",
                        borderRadius: "50%",
                        background: isDone ? "#22c55e" : isActive ? "#a78bfa" : "rgba(255,255,255,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "10px",
                        fontWeight: 600,
                        color: isDone || isActive ? "#fff" : "#64748b",
                        flexShrink: 0,
                        transition: "all 0.2s",
                      }}>
                        {isDone ? (
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M2 5.5L4.5 8L9 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : stepNum}
                      </div>
                      <span style={{ fontSize: "11.5px", color: isActive ? "#f1f5f9" : isDone ? "#94a3b8" : "#475569", fontWeight: isActive ? 500 : 400 }}>
                        {label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div style={{ width: "20px", height: "1px", background: isDone ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)" }} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 20px" }}>

              {/* ── Step 1: View ─────────────────────────────────────────────── */}
              {step === 1 && (
                <div>
                  <p style={{ margin: "0 0 14px", fontSize: "13px", color: "#94a3b8" }}>
                    What is your view on <strong style={{ color: "#f1f5f9" }}>{activeAsset}</strong>?
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {VIEWS.map((view) => {
                      const isSelected = selectedView === view.id;
                      return (
                        <button
                          type="button"
                          key={view.id}
                          onClick={() => setSelectedView(view.id)}
                          style={{
                            background: isSelected ? view.bg : "rgba(255,255,255,0.03)",
                            border: `1px solid ${isSelected ? view.border : "rgba(255,255,255,0.08)"}`,
                            borderRadius: "10px",
                            padding: "14px 16px",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 0.15s",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "12px",
                          }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.055)"; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                        >
                          <div style={{
                            width: "36px", height: "36px",
                            borderRadius: "9px",
                            background: isSelected ? `rgba(${view.accent.replace(/[^0-9,]/g, "")},0.2)` : "rgba(255,255,255,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: isSelected ? view.accent : "#64748b",
                            flexShrink: 0,
                            transition: "all 0.15s",
                          }}>
                            {view.iconSvg}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: "0 0 3px", fontSize: "13px", fontWeight: 600, color: isSelected ? "#f1f5f9" : "#cbd5e1" }}>
                              {view.label}
                            </p>
                            <p style={{ margin: 0, fontSize: "11px", color: "#64748b", lineHeight: 1.4 }}>{view.desc}</p>
                          </div>
                          {isSelected && (
                            <div style={{ marginLeft: "auto", flexShrink: 0, color: view.accent }}>
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4"/>
                                <path d="M5 8L7.5 10.5L11 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Step 2: Horizon ──────────────────────────────────────────── */}
              {step === 2 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    {viewMeta && (
                      <div style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "5px 10px",
                        borderRadius: "99px",
                        background: viewMeta.bg,
                        border: `1px solid ${viewMeta.border}`,
                        color: viewMeta.accent,
                        fontSize: "12px",
                        fontWeight: 500,
                      }}>
                        <span style={{ width: "16px", height: "16px", display: "flex" }}>{viewMeta.iconSvg}</span>
                        {viewMeta.label}
                      </div>
                    )}
                    <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>— How long is your horizon?</p>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    {TIME_HORIZONS.map((h) => {
                      const isSelected = selectedHorizon === h.id;
                      return (
                        <button
                          type="button"
                          key={h.id}
                          onClick={() => setSelectedHorizon(h.id)}
                          style={{
                            background: isSelected ? "rgba(167,139,250,0.1)" : "rgba(255,255,255,0.03)",
                            border: `1px solid ${isSelected ? "rgba(167,139,250,0.3)" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: "10px",
                            padding: "16px 18px",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.055)"; }}
                          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                        >
                          <p style={{ margin: "0 0 3px", fontSize: "14px", fontWeight: 600, color: isSelected ? "#a78bfa" : "#e2e8f0" }}>
                            {h.label}
                          </p>
                          <p style={{ margin: "0 0 8px", fontSize: "12px", color: "#64748b" }}>{h.sub}</p>
                          <p style={{ margin: 0, fontSize: "11px", color: isSelected ? "#a78bfa" : "#475569" }}>
                            ~{h.days} day{h.days > 1 ? "s" : ""} DTE
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Step 3: Results ──────────────────────────────────────────── */}
              {step === 3 && (
                <div>
                  {/* Context bar */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "10px 14px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "9px",
                    marginBottom: "16px",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>Showing strategies for:</span>
                    {viewMeta && (
                      <span style={{
                        padding: "3px 9px", borderRadius: "99px",
                        background: viewMeta.bg, border: `1px solid ${viewMeta.border}`,
                        color: viewMeta.accent, fontSize: "11px", fontWeight: 500,
                        display: "flex", alignItems: "center", gap: "4px",
                      }}>
                        <span style={{ width: "13px", height: "13px", display: "flex" }}>{viewMeta.iconSvg}</span>
                        {viewMeta.label}
                      </span>
                    )}
                    <span style={{ fontSize: "11px", color: "#64748b" }}>·</span>
                    <span style={{ padding: "3px 9px", borderRadius: "99px", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa", fontSize: "11px", fontWeight: 500 }}>
                      {TIME_HORIZONS.find((h) => h.id === selectedHorizon)?.label} ({TIME_HORIZONS.find((h) => h.id === selectedHorizon)?.sub})
                    </span>
                    {spotPrice > 0 && (
                      <>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>·</span>
                        <span style={{ fontSize: "11px", color: "#38bdf8" }}>
                          {activeAsset} @ ${Number(spotPrice).toLocaleString()}
                        </span>
                      </>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: "#64748b" }}>
                      {strategies.length} strategies matched
                    </span>
                  </div>

                  {/* Probability legend */}
                  <div style={{ display: "flex", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
                    {Object.entries(TIER_META).map(([key, meta]) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: meta.dot }} />
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>{meta.label}</span>
                        <span style={{ fontSize: "10px", color: "#475569" }}>({meta.sub})</span>
                      </div>
                    ))}
                  </div>

                  {tierGroups.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                      <p>No strategies found for this combination.</p>
                      <button type="button" onClick={() => setStep(1)} style={{ ...BTN_BASE, background: "rgba(255,255,255,0.07)", color: "#f1f5f9", border: "1px solid rgba(255,255,255,0.1)" }}>
                        Start over
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {tierGroups.map(({ tierKey, strategies: tierStrategies }) => {
                        const meta = TIER_META[tierKey];
                        return (
                          <div key={tierKey}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: meta.color }} />
                              <span style={{ fontSize: "12px", fontWeight: 600, color: meta.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                {meta.label}
                              </span>
                              <span style={{ fontSize: "11px", color: "#475569" }}>· {meta.sub}</span>
                              <div style={{ flex: 1, height: "1px", background: `${meta.color}22` }} />
                              <span style={{ fontSize: "11px", color: "#475569" }}>{tierStrategies.length} strat{tierStrategies.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                              {tierStrategies.map((s, i) => (
                                <StrategyCard
                                  key={s.name}
                                  strategy={s}
                                  viewAccent={viewMeta?.accent}
                                  index={i}
                                  onExecute={(s) => {
    // This should eventually invoke onStrategyChosen passed into OptionsStrategySimulator
    if (onStrategyChosen) onStrategyChosen(s);
  }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer nav */}
            <div style={{
              padding: "14px 24px",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
            }}>
              <button
                type="button"
                onClick={() => {
                  if (step === 1) { handleClose(); }
                  else { setStep((s) => s - 1); }
                }}
                style={{
                  ...BTN_BASE,
                  background: "transparent",
                  color: "#94a3b8",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#f1f5f9"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; }}
              >
                {step === 1 ? "Cancel" : "← Back"}
              </button>

              <div style={{ display: "flex", gap: "6px" }}>
                {[1, 2, 3].map((n) => (
                  <div key={n} style={{
                    width: n === step ? "20px" : "6px",
                    height: "6px",
                    borderRadius: "99px",
                    background: n === step ? "#a78bfa" : n < step ? "rgba(167,139,250,0.4)" : "rgba(255,255,255,0.12)",
                    transition: "all 0.2s",
                  }} />
                ))}
              </div>

              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (step === 1 && !selectedView) return;
                    if (step === 2 && !selectedHorizon) return;
                    setStep((s) => s + 1);
                  }}
                  disabled={(step === 1 && !selectedView) || (step === 2 && !selectedHorizon)}
                  style={{
                    ...BTN_BASE,
                    background: (step === 1 && !selectedView) || (step === 2 && !selectedHorizon)
                      ? "rgba(167,139,250,0.15)"
                      : "rgba(167,139,250,0.85)",
                    color: (step === 1 && !selectedView) || (step === 2 && !selectedHorizon) ? "#64748b" : "#fff",
                    border: "none",
                    opacity: (step === 1 && !selectedView) || (step === 2 && !selectedHorizon) ? 0.6 : 1,
                  }}
                  onMouseEnter={(e) => {
                    const disabled = (step === 1 && !selectedView) || (step === 2 && !selectedHorizon);
                    if (!disabled) e.currentTarget.style.background = "rgba(167,139,250,1)";
                  }}
                  onMouseLeave={(e) => {
                    const disabled = (step === 1 && !selectedView) || (step === 2 && !selectedHorizon);
                    e.currentTarget.style.background = disabled ? "rgba(167,139,250,0.15)" : "rgba(167,139,250,0.85)";
                  }}
                >
                  {step === 1 ? "Choose Horizon →" : "See Strategies →"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={reset}
                  style={{
                    ...BTN_BASE,
                    background: "rgba(167,139,250,0.12)",
                    color: "#a78bfa",
                    border: "1px solid rgba(167,139,250,0.25)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(167,139,250,0.22)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(167,139,250,0.12)"; }}
                >
                  Start Over
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </>
  );
}
