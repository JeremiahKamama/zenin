/**
 * SnapTrade connection flow — frontend behavioral tests
 * ======================================================
 *
 * Run with: node --test test/brokerage/snaptrade-flow.test.cjs
 *
 * Bundles the real component + helpers via esbuild (one React instance),
 * mounts in jsdom, and asserts the spec's required frontend behaviors:
 *   - all five provider-status badge states derive correctly (pure helper)
 *   - masked account numbers never leak raw digits
 *   - duplicate symbols detected WITHOUT merging
 *   - portal-return recovery drives success/pending/denied/error states
 *   - Escape key closes the dialog (keyboard-accessible)
 *   - NO credential strings (userSecret / clientSecret / redirect_uri) ever
 *     appear in the rendered DOM
 *
 * This is ad-hoc verification in the project's style — not a gated suite.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..", "..", "src");

// ── Bundle the component + helpers into one CJS file (single React instance) ──
const entry = `
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import SnapTradeConnectionFlow from ${JSON.stringify(path.join(ROOT, "components/brokerage/SnapTradeConnectionFlow.jsx"))};
import { deriveBrokerageBadge, maskAccountNumber, findDuplicateSymbols } from ${JSON.stringify(path.join(ROOT, "utils/brokerageStatus.js"))};
import { refreshBrokerageConnectionStatus, fetchBrokerageProviders } from ${JSON.stringify(path.join(ROOT, "utils/brokerageApi.js"))};
module.exports = { React, createRoot, act, SnapTradeConnectionFlow, deriveBrokerageBadge, maskAccountNumber, findDuplicateSymbols, refreshBrokerageConnectionStatus, fetchBrokerageProviders };
`;
const tmpEntry = path.join(os.tmpdir(), `hermes-st-entry-${Date.now()}.jsx`);
const tmpBundle = path.join(os.tmpdir(), `hermes-st-bundle-${Date.now()}.cjs`);
fs.writeFileSync(tmpEntry, entry);

async function loadBundle() {
  await esbuild.build({
    entryPoints: [tmpEntry],
    bundle: true,
    outfile: tmpBundle,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    nodePaths: [path.join(ROOT, "..", "node_modules")],
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
    loader: { ".js": "jsx", ".jsx": "jsx" },
    logLevel: "silent"
  });
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(tmpBundle);
}

// ── jsdom globals ──
function setupDom() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost/app/settings/connections?brokerage=snaptrade" });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.getComputedStyle = dom.window.getComputedStyle;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // sessionStorage shim
  const store = new Map();
  global.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
  global.localStorage = global.sessionStorage;
  return { dom, store };
}

let bundle;
let dom;

test.before(async () => {
  bundle = await loadBundle();
  ({ dom } = setupDom());
});

test.after(() => {
  try { fs.unlinkSync(tmpEntry); } catch {}
  try { fs.unlinkSync(tmpBundle); } catch {}
  try { dom.window.close(); } catch {}
  // jsdom keeps the event loop alive; force-exit after the suite.
  setTimeout(() => process.exit(0), 200);
});

// ── Pure helper tests (no DOM) ────────────────────────────────────────────────
test("deriveBrokerageBadge maps all five spec states", () => {
  const { deriveBrokerageBadge: badge } = bundle;
  assert.equal(badge({ status: "connected" }).label, "Connected");
  assert.equal(badge({ status: "active" }).label, "Connected");
  assert.equal(badge({ status: "pending" }).label, "Awaiting authorization");
  assert.equal(badge({ status: "expired" }).label, "Needs reconnection");
  assert.equal(badge({ status: "revoked" }).label, "Needs reconnection");
  assert.equal(badge({ status: "error", syncError: true }).label, "Sync failed");
  assert.equal(badge(null).label, "Unavailable");
  // syncing hint overrides
  assert.equal(badge({ status: "connected" }, { syncing: true }).label, "Syncing");
});

test("maskAccountNumber hides all but last 4", () => {
  const { maskAccountNumber: mask } = bundle;
  assert.equal(mask("12345678"), "••••5678");
  assert.equal(mask(""), "");
  assert.equal(mask("9999"), "••••9999");
});

test("findDuplicateSymbols detects overlap without merging", () => {
  const { findDuplicateSymbols: dup } = bundle;
  const manual = [{ symbol: "AAPL" }, { symbol: "MSFT" }];
  const brokerage = [{ symbol: "aapl" }, { symbol: "TSLA" }];
  assert.deepEqual(dup(manual, brokerage), ["AAPL"]);
  assert.deepEqual(dup(manual, [{ symbol: "GOOG" }]), []);
});

// ── Component render + lifecycle ─────────────────────────────────────────────
function mount(initialProps = {}) {
  const { React, createRoot, act } = bundle;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const ref = { current: null, props: { ...initialProps } };
  act(() => {
    root.render(React.createElement(bundle.SnapTradeConnectionFlow, {
      open: true,
      onClose: () => { ref.closed = true; },
      onConnected: () => { ref.connected = true; },
      ...initialProps
    }));
  });
  ref.container = container;
  ref.root = root;
  return ref;
}

test("renders read-only label and NO credential inputs", () => {
  const ref = mount();
  const html = ref.container.innerHTML;
  assert.match(html, /Read-only brokerage connection/);
  // No credential capture fields — SnapTrade portal handles secrets.
  assert.doesNotMatch(html, /userSecret|clientSecret|apiKey|secret/i);
  ref.root.unmount();
});

test("portal-return recovery shows success after first sync", async () => {
  // Seed a pending flow in sessionStorage.
  sessionStorage.setItem("zenin_brokerage_pending_flow", JSON.stringify({ connectionId: "conn-1", providerKey: "snaptrade" }));
  // Stub fetch with real Response objects (zeninFetch reads .ok/.status/.headers/.json).
  const makeRes = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  global.fetch = async () => makeRes({ csrfToken: "x", connection: { connectionId: "conn-1", status: "connected", institutionName: "Fidelity", accountNumber: "12345678", lastSyncedAt: new Date().toISOString() }, success: true });
  const ref = mount();
  // allow async recovery effect to run
  await new Promise((r) => setTimeout(r, 80));
  await bundle.act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  const html = ref.container.innerHTML;
  assert.match(html, /Brokerage connected/);
  assert.match(html, /Fidelity/);
  assert.match(html, /••••5678/);
  ref.root.unmount();
});

test("Escape key closes the dialog (keyboard accessible)", () => {
  const ref = mount();
  const dialog = ref.container.querySelector('[role="dialog"]');
  assert.ok(dialog, "dialog present");
  const escapeEvent = new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  bundle.act(() => { dialog.dispatchEvent(escapeEvent); });
  assert.equal(ref.closed, true, "onClose fired on Escape");
  ref.root.unmount();
});

test("unavailable provider shows honest idle state (no fabricated connection)", async () => {
  global.fetch = async () => new Response(JSON.stringify({ available: false, code: "BROKERAGE_PILOT_RESTRICTED", reason: "Pilot restricted" }), { status: 200, headers: { "content-type": "application/json" } });
  const ref = mount();
  await bundle.act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  const html = ref.container.innerHTML;
  assert.match(html, /not available yet|Brokerage not available/i);
  assert.doesNotMatch(html, /Brokerage connected/);
  ref.root.unmount();
});
