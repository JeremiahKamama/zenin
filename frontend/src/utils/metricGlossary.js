/**
 * Short, action-oriented definitions for financial concepts shown throughout
 * the workspace. Keep these neutral: a metric's value comes from the module,
 * while this copy explains how a person should interpret it.
 */
export const METRIC_GLOSSARY = Object.freeze({
  beta: {
    label: "Beta",
    definition: "How strongly the portfolio has historically moved relative to its benchmark.",
    whyItMatters: "A beta above 1 can amplify market moves; a beta below 1 generally dampens them.",
  },
  sharpe: {
    label: "Sharpe ratio",
    definition: "Return earned for each unit of volatility taken.",
    whyItMatters: "Compare it with the portfolio's own history rather than treating it as a standalone score.",
  },
  theta: {
    label: "Theta",
    definition: "Estimated option value lost as one day passes, assuming other inputs do not change.",
    whyItMatters: "Negative theta positions need price movement or volatility to offset time decay.",
  },
  impliedVolatility: {
    label: "Implied volatility",
    definition: "The market's priced expectation of future movement, inferred from option prices.",
    whyItMatters: "Higher implied volatility raises option premiums and can change the risk of a trade.",
  },
  breadth: {
    label: "Market breadth",
    definition: "How broadly market participation is distributed across advancing and declining assets.",
    whyItMatters: "Narrow breadth can make an index move less durable than it appears.",
  },
  regime: {
    label: "Market regime",
    definition: "The current market environment inferred from growth, inflation, volatility, and trend signals.",
    whyItMatters: "A regime frames which risks and asset relationships deserve more attention.",
  },
  alignment: {
    label: "Allocation alignment",
    definition: "How closely current allocations match the portfolio's intended targets.",
    whyItMatters: "Large gaps can mean unintended concentration or risk exposure.",
  },
  drift: {
    label: "Allocation drift",
    definition: "The difference between a current allocation and its target weight.",
    whyItMatters: "Drift identifies where a rebalance may restore the intended risk profile.",
  },
  taxImpact: {
    label: "Tax impact",
    definition: "The estimated tax effect of a sale, gain, loss, or portfolio change.",
    whyItMatters: "A trade's after-tax result can differ materially from its displayed pre-tax return.",
  },
});

export function getMetricGlossaryEntry(metric) {
  return METRIC_GLOSSARY[metric] || null;
}
