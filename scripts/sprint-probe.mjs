// Robust CDP probe: open a fresh tab, set narrow viewport, check mobile drawer nav + capture shots.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const WebSocket = require("/Users/jeremiahkamama/Desktop/Zenin/zenin/node_modules/ws");
import fs from "fs";

const HTTP = "http://localhost:9222";
const BASE = "http://localhost:5173";
const OUT = "/Users/jeremiahkamama/Desktop/Zenin/zenin/scripts/audit-out";

function wsFor(targetId) {
  return new WebSocket(`ws://localhost:9222/devtools/page/${targetId}`, { perMessageDeflate: false });
}
async function openNewTab(url) {
  const res = await fetch(`${HTTP}/json/new`, { method: "PUT", body: JSON.stringify({ url }) });
  const tab = await res.json();
  return tab;
}
async function attach(targetId) {
  const ws = wsFor(targetId);
  await new Promise((r) => ws.on("open", r));
  let id = 0;
  const pending = new Map();
  ws.on("message", (d) => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, send };
}
const ev = async (send, expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

async function main() {
  const action = process.argv[2] || "mobile";
  const tab = await openNewTab(`${BASE}/app?guest=1`);
  const { ws, send } = await attach(tab.id);
  await send("Page.enable");

  if (action === "mobile") {
    await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 720, deviceScaleFactor: 1, mobile: true, isTouch: true });
    await send("Page.navigate", { url: `${BASE}/app?guest=1` });
    await new Promise((r) => setTimeout(r, 2600));
    // find hamburger / open menu button
    const opened = await ev(send, `(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const ham = btns.find(b => /menu|open|nav/i.test(b.getAttribute('title')||b.textContent||'') || b.getAttribute('aria-label')==='Open Menu' || b.className.includes('hamburger'));
      if (ham) { ham.click(); return 'clicked:'+(ham.getAttribute('title')||ham.className); }
      return 'no-hamburger';
    })()`);
    console.log("HAMBURGER:", opened);
    await new Promise((r) => setTimeout(r, 800));
    const labels = await ev(send, `Array.from(document.querySelectorAll('.nav-btn, .mobile-nav a, .drawer-nav a')).map(e=>e.getAttribute('title')||e.textContent.trim()).filter(Boolean)`);
    console.log("MOBILE_NAV_LABELS:", JSON.stringify(labels));
    console.log("TAX_IN_MOBILE:", (labels||[]).some(t=>String(t).includes('Tax')));
  }

  if (action === "shot") {
    const shots = JSON.parse(process.argv[3] || '[]');
    for (const s of shots) {
      await send("Emulation.setDeviceMetricsOverride", { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url: `${BASE}/app?guest=1&section=${s.section}` });
      await new Promise((r) => setTimeout(r, 2400));
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      const f = `${OUT}/${s.dir}/${s.name}.png`;
      fs.mkdirSync(require("path").dirname(f), { recursive: true });
      fs.writeFileSync(f, Buffer.from(data, "base64"));
      console.log("shot", f);
    }
  }
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
