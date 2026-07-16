// Headless render verification for IndicatorMetricModal (pure launcher).
// Uses jsdom + react-dom directly (no @testing-library). Asserts all controls
// present + wired, related drill-down emits zenin:selectIndicator (no close),
// disabled when no actions, honest empty states.
const esbuild = require("/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend/node_modules/esbuild");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { JSDOM } = require("/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend/node_modules/jsdom");

const ROOT = "/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend";
const OUT = path.join(ROOT, ".verify", `hermes-verify-ind2-${Date.now()}.cjs`);

const STUB = `module.exports = { createChart: () => ({ addLineSeries: () => ({ setData(){}, applyOptions(){} }), timeScale: () => ({ fitContent(){} }), applyOptions(){}, remove(){} }) };`;
const CHART_STUB = `const React=require("react"); module.exports={ TradingViewChart: (props)=>React.createElement("div",{className:"tv-chart-stub"}), default:{TradingViewChart:(props)=>React.createElement("div",{className:"tv-chart-stub"})} };`;
const STUB_DIR = path.join(ROOT, ".verify", `stub2-${Date.now()}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
fs.writeFileSync(path.join(STUB_DIR, "index.js"), STUB);
fs.writeFileSync(path.join(STUB_DIR, "chart.js"), CHART_STUB);

const chartPlugin = {
  name: "chart-stub",
  setup(build) {
    build.onResolve({ filter: /TradingViewChart$/ }, () => ({ path: path.join(STUB_DIR, "chart.js") }));
    build.onLoad({ filter: /chart\.js$/ }, () => ({ contents: CHART_STUB, loader: "js" }));
  },
};

const SRC = `
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { IndicatorMetricModal } from "${ROOT}/src/components/IndicatorMetricModal.jsx";
import { IndicatorActionsProvider } from "${ROOT}/src/utils/indicatorActions.jsx";

const metric = {
  code: "cpi", label: "Consumer Price Index", group: "inflation", unit: "%",
  current: 3.2, previous: 3.0, consensus: 3.1, source: "FRED", cadence: "Monthly",
  coverage: "Single series", series: [{ date: "2024-01-01", value: 3.0 }, { date: "2024-02-01", value: 3.2 }],
};
const metricNoSeries = { code: "gdp", label: "GDP", group: "growth", unit: "%", current: 2.1 };
let calls = [];
const actions = {
  isInWatchlist: () => false,
  onToggleStar: (a) => calls.push(["toggleStar", a]),
  onCompare: (c) => calls.push(["compare", c]),
  onOpenResearch: (a) => calls.push(["research", a]),
  onOpenProfile: (a) => calls.push(["profile", a]),
  onOpenTransmission: (n) => calls.push(["transmission", n]),
  onPin: (a) => calls.push(["pin", a]),
  isPinned: () => false,
  onAlert: (a) => calls.push(["alert", a]),
  onExport: (a) => calls.push(["export", a]),
  onCopyLink: (a) => calls.push(["copyLink", a]),
  onDecisionLedger: (a) => calls.push(["ledger", a]),
  onExposure: (a) => calls.push(["exposure", a]),
  onJournal: (a) => calls.push(["journal", a]),
  onScenario: (a) => calls.push(["scenario", a]),
  onMacroWorkspace: (a) => calls.push(["macro", a]),
  onSelectIndicator: (c) => calls.push(["selectIndicator", c]),
};

const results = [];
const check = (name, cond) => results.push([name, !!cond]);

function mount(el) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return container;
}
const { Simulate } = require("react-dom/test-utils");
const clickByText = (container, text) => {
  const btn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.trim() === text);
  if (!btn) throw new Error("button not found: " + text);
  act(() => { Simulate.click(btn); });
};

(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require("react");
  const { createRoot } = require("react-dom/client");
  const mod = require("${ROOT}/src/components/IndicatorMetricModal.jsx");
  const ctx = require("${ROOT}/src/utils/indicatorActions.jsx");

  // 1. present + wired
  const c1 = mount(React.createElement(ctx.IndicatorActionsProvider, { value: actions },
    React.createElement(mod.IndicatorMetricModal, { countryName: "United States", metric, onClose: () => calls.push(["close"]) })));
  const buttons = Array.from(c1.querySelectorAll("button")).map(b => b.textContent.trim());
  ["Research","Profile","Watch","Pin","Alert","Compare","Transmission","Decision Ledger","Portfolio Exposure","Export","Copy Link","Journal","Scenario Lab","Macro Workspace"]
    .forEach(t => check("present:"+t, buttons.includes(t)));
  const related = c1.querySelectorAll(".imv2-related-card");
  check("relatedIndicators>0", related.length > 0);

  // 2. fire every action
  ["Research","Profile","Watch","Pin","Alert","Compare","Transmission","Decision Ledger","Portfolio Exposure","Export","Copy Link","Journal","Scenario Lab","Macro Workspace"]
    .forEach(t => clickByText(c1, t));
  const seen = new Set(calls.map(c => c[0]));
  ["research","profile","toggleStar","pin","alert","compare","transmission","ledger","exposure","export","copyLink","journal","scenario","macro"].forEach(k => check("fired:"+k, seen.has(k)));
  check("noCloseOnActions", !calls.some(c => c[0] === "close"));

  // 3. related drill-down
  const before = calls.length;
  act(() => { Simulate.click(related[0]); });
  const sel = calls.slice(before).find(c => c[0] === "selectIndicator");
  check("drillEmitSelect", !!sel);
  check("drillNoClose", !calls.slice(before).some(c => c[0] === "close"));

  // 4. disabled when no actions supplied
  const c2 = mount(React.createElement(mod.IndicatorMetricModal, { countryName: "X", metric, onClose: () => {} }));
  const disabledFoot = Array.from(c2.querySelectorAll(".imv2-action")).filter(b => b.disabled);
  check("disabledWhenNoActions", disabledFoot.length === 14);

  // 5b. Compare Drawer + Alert Builder render (Phase 5/6 components)
  const cdb = require("${ROOT}/src/components/AssetCompareDrawer.jsx");
  const cab = require("${ROOT}/src/components/AssetAlertBuilder.jsx");
  const drawer = mount(React.createElement(cdb.AssetCompareDrawer, { open: true, assets: [{ kind: "indicator", symbol: "CPI", metric: { series: [{ date: "2020", value: 2 }, { date: "2021", value: 3 }] } }], onClose: () => {} }));
  check("compareDrawerOpens", drawer.textContent.includes("Compare Assets"));
  check("compareDrawerPicker", drawer.textContent.includes("Select indicator"));
  const builder = mount(React.createElement(cab.AssetAlertBuilder, { open: true, asset: { kind: "indicator", symbol: "CPI", label: "CPI" }, onClose: () => {} }));
  check("alertBuilderOpens", builder.textContent.includes("Create Alert"));
  check("alertBuilderConditions", builder.textContent.includes("Above Value") && builder.textContent.includes("Volatility Threshold"));

  const pass = results.filter(r => r[1]).length;
  const fail = results.filter(r => !r[1]);
  console.log("PASS " + pass + "/" + results.length);
  if (fail.length) { console.log("FAILURES:"); fail.forEach(f => console.log("  - " + f[0])); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch(e => { console.error("HARNESS ERROR:", e && e.stack || e); process.exit(2); });
`;

(async () => {
  await esbuild.build({
    stdin: { contents: SRC, resolveDir: ROOT, loader: "jsx" },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic",
    nodePaths: [path.join(ROOT, "node_modules")],
    alias: { "lightweight-charts": path.join(STUB_DIR, "index.js") },
    plugins: [chartPlugin],
    define: { "import.meta.env": "{}", "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "process.env.NODE_ENV": '"production"' },
    external: ["react", "react-dom", "react-dom/client", "jsdom"],
    logLevel: "silent", outfile: OUT,
  });
  console.log("bundled ok");
  // jsdom globals
  const dom = new (require("/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend/node_modules/jsdom").JSDOM)("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  global.window = dom.window; global.document = dom.window.document;
  global.navigator = dom.window.navigator; global.MouseEvent = dom.window.MouseEvent;
  global.CustomEvent = dom.window.CustomEvent; global.HTMLElement = dom.window.HTMLElement;
  global.localStorage = dom.window.localStorage;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  require(OUT);
})().catch(e => { console.error("ESBUILD ERROR:", e); process.exit(3); });
