// Zenin Global Workspace Architecture Audit v2
// Drives headless Chrome via CDP. One persistent browser; per-section viewport
// re-asserted immediately before measuring (emulation resets on navigation).
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "audit-out");
fs.mkdirSync(OUT, { recursive: true });
const HTTP = "http://localhost:9222";

async function listTargets() { return (await fetch(`${HTTP}/json/list`)).json(); }
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0;
  const pending = new Map(); let resolveReady; const ready = new Promise(r => resolveReady = r);
  ws.on("message", d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } });
  ws.on("open", () => resolveReady());
  const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });
  return { ws, ready, send, close: () => ws.close() };
}

// ---- In-page measurement (runs in the browser) ----
const MEASURE = `
(function(){
  const vw = window.innerWidth, vh = window.innerHeight;
  const cs = el => getComputedStyle(el);
  const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const isVisible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  const root = document.querySelector('.app-layout');
  const main = document.querySelector('main.main-content');
  const sidebar = document.querySelector('.sidebar');
  const rootClass = root ? (root.className || '') : '';
  // find the .app-layout max-width via getComputedStyle
  const rootMax = root ? cs(root).maxWidth : 'none';

  // shell widths
  const sidebarW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
  const mainR = main ? rect(main) : { x:0, w:0, right:0 };
  const contentRight = mainR.right;
  const contentW = mainR.w;
  const deadGutter = Math.max(0, vw - contentRight); // px of blank right of content
  const workspacePct = vw ? Math.round((contentW / vw) * 1000)/10 : 0; // main width / viewport
  const viewportPct = vw ? Math.round(((contentRight - (sidebar?rect(sidebar).x:0)) / vw) * 1000)/10 : 0;

  // Wrapper depth: deepest nesting of divs inside main
  let maxDepth = 0;
  function depthWalk(el, d){
    if (el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    const nd = (tag === 'div' || tag === 'section') ? d + 1 : d;
    if (nd > maxDepth) maxDepth = nd;
    for (const c of el.children) depthWalk(c, nd);
  }
  if (main) depthWalk(main, 0);

  // Fixed-size audit: count elements with hardcoded height/min-height/max-height/100vh/calc
  const fixedList = [];
  main && main.querySelectorAll('*').forEach(el => {
    const s = cs(el);
    const cls = (typeof el.className === 'string' ? el.className : '');
    if (el.getBoundingClientRect().height < 1) return;
    if (s.height !== 'auto' && s.height !== '0px' && /px|vh|calc|%/g.test(s.height) && !/^0px$/.test(s.height)) fixedList.push({ cls: cls.split(' ')[0], prop:'height', val:s.height, h:Math.round(el.getBoundingClientRect().height) });
    if (s.minHeight !== 'auto' && s.minHeight !== '0px' && s.minHeight !== 'none' && /px|vh|calc|%/g.test(s.minHeight)) fixedList.push({ cls: cls.split(' ')[0], prop:'min-height', val:s.minHeight, h:Math.round(el.getBoundingClientRect().height) });
    if (s.maxHeight !== 'none' && /px|vh|calc|%/g.test(s.maxHeight)) fixedList.push({ cls: cls.split(' ')[0], prop:'max-height', val:s.maxHeight });
  });

  // Magic-number spacing audit: inline styles with px margins/paddings/gaps
  const magic = [];
  main && main.querySelectorAll('*').forEach(el => {
    const is = el.getAttribute('style');
    if (!is) return;
    const m = is.match(/\\b(margin|padding|gap|margin-top|padding-top|margin-bottom|padding-bottom)[^;:]*:\\s*(\\d+(\\.\\d+)?px|\\d+(\\.\\d+)?rem|\\d+(\\.\\d+)?vh)/g);
    if (m) { const cls=(typeof el.className==='string'?el.className:''); magic.push({ cls: cls.split(' ')[0], decls: m.slice(0,4) }); }
  });

  // Grid occupancy: scan a fine grid across the canvas (right of sidebar, below topbar).
  // A cell counts as CONTENT only if the topmost painted element carries real foreground
  // (text OR border) — not just the page/card background. Prevents over-counting blanks.
  const step = 22;
  const sx = (sidebar ? Math.round(rect(sidebar).right) : 0);
  const topbar = document.querySelector('.topbar, .app-topbar, header');
  const sy = topbar ? Math.round(rect(topbar).bottom) : 0;
  let total=0, blank=0; const colBlank={}, colTotal={};
  for (let x = sx + step/2; x < vw; x += step) {
    colBlank[x]=0; colTotal[x]=0;
    for (let y = sy + step/2; y < vh; y += step) {
      total++; colTotal[x]++;
      let el = document.elementFromPoint(x, y);
      let content = false;
      let n = el;
      for (let k=0; k<6 && n; k++) {
        const s = cs(n);
        const cls = (typeof n.className==='string'?n.className:'');
        if (n.textContent && n.textContent.trim().length>0 && getComputedStyle(n).color !== 'rgba(0, 0, 0, 0)' && n.offsetHeight < 200) { content = true; break; }
        if (s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px' || s.borderBottomWidth !== '0px' || s.borderRightWidth !== '0px') { content = true; break; }
        if (/svg|canvas|img|chart|table|button/i.test(cls) || (n.tagName && /^(SVG|CANVAS|IMG|TABLE|BUTTON)$/.test(n.tagName))) { content = true; break; }
        n = n.parentElement;
      }
      if (!content) { blank++; colBlank[x]++; }
    }
  }
  const canvasDensity = total ? Math.round(((total-blank)/total)*1000)/10 : 0;
  // worst right columns
  const cols = Object.keys(colTotal).map(x=>({x:+x, pct: colTotal[x]?Math.round((1-colBlank[x]/colTotal[x])*100):100})).sort((a,b)=>a.pct-b.pct);
  const worstCols = cols.slice(0,6);

  // Card occupancy: for elements whose class contains 'card', measure self height vs
  // sum of non-background child heights. Approximate "visible content" as innerText-present descendant area.
  const cards = [];
  main && main.querySelectorAll('[class*="card"]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 30) return;
    let contentH = 0;
    el.querySelectorAll('*').forEach(c => { const cr = c.getBoundingClientRect(); if (c.textContent && c.textContent.trim() && cr.height>0) contentH = Math.max(contentH, cr.bottom - r.top); });
    const occ = r.height ? Math.round((Math.min(contentH, r.height)/r.height)*100) : 100;
    cards.push({ cls: (typeof el.className==='string'?el.className:'').split(' ')[0], h: Math.round(r.height), occ });
  });
  const lowCards = cards.filter(c => c.occ < 70).sort((a,b)=>a.occ-b.occ).slice(0,8);

  // Count component types for density score
  const count = sel => main ? main.querySelectorAll(sel).length : 0;
  const tables = count('table');
  const charts = count('svg, canvas, [class*="chart"]');
  const buttons = count('button');
  const inputs = count('input, select');
  const cardsN = count('[class*="card"]');

  return {
    vw, vh, rootClass, rootMax, sidebarW, contentW, contentRight, deadGutter,
    workspacePct, viewportPct, maxDepth,
    fixedCount: fixedList.length, fixedSample: fixedList.slice(0,12),
    magicCount: magic.length, magicSample: magic.slice(0,10),
    canvasDensity, worstCols,
    cardsTotal: cards.length, lowCards,
    counts: { tables, charts, buttons, inputs, cardsN }
  };
})();
`;

// ---- Per-section runner ----
async function measureSection(conn, slug, vp) {
  const base = `http://localhost:5173/app?guest=1&section=${slug}`;
  await conn.send("Page.navigate", { url: base });
  await new Promise(r => setTimeout(r, 2800)); // boot + data
  await conn.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 500));
  const m = await conn.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true });
  const d = m?.result?.value ?? m?.result;
  const shot = await conn.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const b64 = shot?.data;
  const file = path.join(OUT, `${slug}-${vp.w}.png`);
  if (b64) fs.writeFileSync(file, Buffer.from(b64, "base64"));
  return d;
}

async function main() {
  const targets = await listTargets();
  const page = targets.find(t => t.type === "page");
  const conn = cdp(page.webSocketDebuggerUrl);
  await conn.ready;
  await conn.send("Page.enable"); await conn.send("Runtime.enable");

  const sections = ["home","portfolio","watchlist","briefing","research","analytics","journal","tax","decisions","options","predictions","settings","auth"];
  const viewports = [
    { w: 1366, h: 768, name: "1366x768" },
    { w: 1600, h: 900, name: "1600x900" },
    { w: 1920, h: 1080, name: "1920x1080" },
    { w: 2560, h: 1440, name: "2560x1440" },
    { w: 3440, h: 1440, name: "3440x1440" },
  ];

  const report = {}; // section -> { vpName -> data }
  for (const s of sections) {
    report[s] = {};
    for (const vp of viewports) {
      try {
        const d = await measureSection(conn, s, vp);
        report[s][vp.name] = d;
        console.error(`OK ${s} ${vp.name} ws%${d.workspacePct} deadGutter${d.deadGutter} canvas${d.canvasDensity} depth${d.maxDepth} fixed${d.fixedCount} magic${d.magicCount} lowCards${d.lowCards.length}`);
      } catch (e) {
        console.error(`FAIL ${s} ${vp.name}: ${e.message}`);
        report[s][vp.name] = { error: e.message };
      }
    }
    fs.writeFileSync(path.join(OUT, "audit-v2.json"), JSON.stringify(report, null, 2));
  }
  conn.close();
  console.error("DONE -> scripts/audit-out/audit-v2.json");
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
