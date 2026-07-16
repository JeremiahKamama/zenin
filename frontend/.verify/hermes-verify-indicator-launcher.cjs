// Headless render verification for IndicatorMetricModal (pure launcher).
// Asserts: all controls present + wired to handlers, related-indicator drill-down
// emits zenin:selectIndicator (no onClose), honest empty states.
const esbuild = require("/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend/node_modules/esbuild");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = "/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend";
const OUT = path.join(ROOT, ".verify", `hermes-verify-ind-${Date.now()}.cjs`);

const STUB = `
module.exports = { createChart: () => ({ addLineSeries: () => ({ setData(){}, applyOptions(){} }), timeScale: () => ({ fitContent(){} }), applyOptions(){}, remove(){} }) };
`;
const STUB_DIR = path.join(ROOT, ".verify", `stub-${Date.now()}`);
fs.mkdirSync(STUB_DIR, { recursive: true });
fs.writeFileSync(path.join(STUB_DIR, "index.js"), STUB);

const SRC = `
import React from "react";
import { render, fireEvent } from "@testing-library/react";
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
  onSelectIndicator: (c) => calls.push(["selectIndicator", c]),
};

function renderModal(m) {
  let utils;
  const React = require("react");
  const { render } = require("@testing-library/react");
  const mod = require("${ROOT}/src/components/IndicatorMetricModal.jsx");
  const ctx = require("${ROOT}/src/utils/indicatorActions.jsx");
  const el = React.createElement(ctx.IndicatorActionsProvider, { value: actions },
    React.createElement(mod.IndicatorMetricModal, { countryName: "United States", metric: m, onClose: () => calls.push(["close"]) }));
  require("react-dom");
  utils = render(el);
  return utils;
}

const results = [];
function check(name, cond) { results.push([name, !!cond]); }

(async () => {
  const { render, fireEvent } = require("@testing-library/react");
  const { container } = renderModal(metric);
  const buttons = Array.from(container.querySelectorAll("button")).map(b => b.textContent.trim());
  const want = ["Pin","Watch","Alert","Compare","Export","Copy link","Open Macro Workspace","View Decision Ledger","View Portfolio Exposure","Open Transmission Explorer"];
  want.forEach(t => check("present:"+t, buttons.includes(t)));
  const related = container.querySelectorAll(".imv2-related-card");
  check("relatedIndicators>0", related.length > 0);

  const fire = (text) => {
    const btn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.trim() === text);
    if (!btn) throw new Error("button not found: "+text);
    fireEvent.click(btn);
  };
  fire("Pin"); fire("Watch"); fire("Alert"); fire("Compare"); fire("Export"); fire("Copy link");
  fire("Open Macro Workspace"); fire("View Decision Ledger"); fire("View Portfolio Exposure"); fire("Open Transmission Explorer");
  const seen = new Set(calls.map(c => c[0]));
  ["pin","toggleStar","alert","compare","export","copyLink","transmission","ledger","exposure"].forEach(k =>
    check("fired:"+k, seen.has(k)));
  check("noCloseOnActions", !calls.some(c => c[0] === "close"));

  const before = calls.length;
  fireEvent.click(related[0]);
  const selectEvt = calls.slice(before).find(c => c[0] === "selectIndicator");
  check("drillEmitSelect", !!selectEvt);
  check("drillNoClose", !calls.slice(before).some(c => c[0] === "close"));

  const mod2 = require("${ROOT}/src/components/IndicatorMetricModal.jsx");
  const React = require("react");
  const { render: r2 } = require("@testing-library/react");
  const utils2 = r2(React.createElement(mod2.IndicatorMetricModal, { countryName: "X", metric, onClose: () => {} }));
  const disabledFoot = Array.from(utils2.container.querySelectorAll(".imv2-foot-btn")).filter(b => b.disabled);
  check("disabledWhenNoActions", disabledFoot.length === 6);

  const mod3 = require("${ROOT}/src/components/IndicatorMetricModal.jsx");
  const utils3 = renderModal(metricNoSeries);
  const txt = utils3.container.textContent;
  check("emptyNoSeries", txt.includes("No historical series returned from FRED"));
  check("emptyNoPath", txt.includes("No transmission path mapped"));

  const pass = results.filter(r => r[1]).length;
  const fail = results.filter(r => !r[1]);
  console.log("PASS "+pass+"/"+results.length);
  if (fail.length) { console.log("FAILURES:"); fail.forEach(f => console.log("  - "+f[0])); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch(e => { console.error("HARNESS ERROR:", e); process.exit(2); });
`;

(async () => {
  await esbuild.build({
    stdin: { contents: SRC, resolveDir: ROOT, loader: "jsx" },
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    nodePaths: [path.join(ROOT, "node_modules")],
    alias: { "lightweight-charts": path.join(STUB_DIR, "index.js") },
    define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true", "process.env.NODE_ENV": '"production"' },
    external: ["react", "react-dom", "jsdom", "@testing-library/react", "@testing-library/dom"],
    logLevel: "silent",
    outfile: OUT,
  });
  console.log("bundled:", OUT);
  require(OUT);
})().catch(e => { console.error("ESBUILD ERROR:", e); process.exit(3); });
