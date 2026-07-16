// Asset Action Registry (Phase 2 / Phase 7).
//
// Single catalog of every action an Asset Intelligence surface can expose.
// The Indicator Modal (and future Company/Commodity/ETF/FX/Crypto modals)
// render `getActionsForKind(kind)` instead of hardcoding action buttons — so
// a new action added here automatically appears for every asset kind, and a
// new asset kind inherits the full action set. No per-modal JSX, no duplicated
// handler logic.
//
// Execution still lives in the consumer (App supplies the real handlers via
// IndicatorActionsContext). The registry only declares PRESENCE + ORDER +
// LABEL. "Disabled until supported" is handled by the consumer (a missing
// handler => the control renders disabled, never fake-active).
//
// Brand v2: monochrome, institutional, consistent ordering across assets.

/** @typedef {{key:string,label:string,order:number,optional?:boolean}} ActionDef */

/** Catalog of every possible action. `order` drives consistent rendering. */
export const ASSET_ACTIONS = {
  research:       { key: "research",       label: "Research",          order: 10 },
  profile:        { key: "profile",        label: "Profile",           order: 20 },
  watchlist:      { key: "watchlist",      label: "Watch",             order: 30 },
  pin:            { key: "pin",            label: "Pin",               order: 40 },
  alert:          { key: "alert",          label: "Alert",             order: 50 },
  compare:        { key: "compare",        label: "Compare",           order: 60 },
  transmission:   { key: "transmission",   label: "Transmission",      order: 70 },
  decisionLedger: { key: "decisionLedger", label: "Decision Ledger",   order: 80 },
  exposure:       { key: "exposure",       label: "Portfolio Exposure",order: 90 },
  export:         { key: "export",         label: "Export",            order: 100 },
  copyLink:       { key: "copyLink",       label: "Copy Link",         order: 110 },
  journal:        { key: "journal",        label: "Journal",           order: 120, optional: true },
  scenario:       { key: "scenario",       label: "Scenario Lab",      order: 130, optional: true },
  macro:          { key: "macro",          label: "Macro Workspace",   order: 140, optional: true },
};

/** Default action set every asset kind exposes, in render order. */
const DEFAULT_KIND_ACTIONS = [
  "research",
  "profile",
  "watchlist",
  "pin",
  "alert",
  "compare",
  "transmission",
  "decisionLedger",
  "exposure",
  "export",
  "copyLink",
  "journal",
  "scenario",
  "macro",
];

/**
 * Ordered action list for a kind. Unknown kinds fall back to the default set
 * (indicators are first-class — they get the full set).
 * @param {string} kind
 * @returns {ActionDef[]}
 */
export function getActionsForKind(kind) {
  // Every kind currently shares the same universal action set; centralizing
  // here means adding an action is a one-line change. Per-kind overrides can
  // be added later without touching any modal.
  return DEFAULT_KIND_ACTIONS
    .map((k) => ASSET_ACTIONS[k])
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

/** Condition types for the Universal Alert Builder (Phase 5), registry-driven. */
export const ALERT_CONDITIONS = [
  { key: "above",        label: "Above Value",        hint: "Notify when the reading rises above a value." },
  { key: "below",        label: "Below Value",        hint: "Notify when the reading falls below a value." },
  { key: "pctChange",    label: "Percent Change",     hint: "Notify on absolute % change vs prior print." },
  { key: "maCross",      label: "Moving Average Cross", hint: "Notify when the series crosses its N-period average." },
  { key: "yoy",          label: "YoY Change",          hint: "Notify on year-over-year change crossing a threshold." },
  { key: "mom",          label: "MoM Change",          hint: "Notify on month-over-month change crossing a threshold." },
  { key: "volatility",   label: "Volatility Threshold", hint: "Notify when realized volatility exceeds a level." },
  { key: "releaseDay",   label: "Release Day Reminder", hint: "Remind on the next scheduled print." },
  { key: "transmission", label: "Transmission Trigger", hint: "Notify when this node fires in the transmission chain." },
];

/**
 * Map an alert condition to the post-trigger actions a user can chain
 * (Phase 5 example: Notify → Check Exposure → Run Transmission → Decision Reminder).
 */
export const ALERT_POST_ACTIONS = [
  { key: "notify",        label: "Notify" },
  { key: "checkExposure", label: "Check Portfolio Exposure" },
  { key: "runTransmission", label: "Run Transmission" },
  { key: "decisionReminder", label: "Create Decision Reminder" },
];
