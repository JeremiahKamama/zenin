// CDP layout-density audit v2 — drives headless Chrome on localhost:9222.
// Computes a grid-density score (maps to the 88-92% success metric),
// sidebar/scaffold geometry, right gutter, scroll ownership, large empty
// containers (SVG excluded), and fixed-heights. Captures a screenshot per section.
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "audit-out");
fs.mkdirSync(OUT, { recursive: true });
const HTTP = "http://localhost:9222";

async function listTargets() {
  const res = await fetch(`${HTTP}/json/list`);
  return res.json();
}
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  ws.on("open", () => resolveReady());
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, ready, send, close: () => ws.close() };
}

const MEASURE_JS = `
(function(){
  const vw = window.innerWidth, vh = window.innerHeight;
  function cs(el){ return el ? getComputedStyle(el) : null; }
  function R(el){ const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)}; }
  function inSvg(el){ let n=el; while(n){ if(n.tagName==='svg'||n.tagName==='SVG') return true; n=n.parentElement; } return false; }
  function hasContent(el){
    if (el.textContent && el.textContent.trim().length) return true;
    if (el.querySelector('img,canvas,svg')) return true;
    return false;
  }
  // workspace root
  let root = document.querySelector('main.main-content') || document.querySelector('.main-content') || document.querySelector('main.workspace-main') || document.querySelector('main');
  if(!root) return {found:false,vw,vh};
  // sidebar: aside/sidebar or [class*="sidebar"]
  let sidebar = document.querySelector('aside.sidebar, .sidebar, [data-sidebar]') ||
                Array.from(document.querySelectorAll('*')).find(e=>/(^| )sidebar($| )/.test(e.className) && e.offsetWidth>40);
  const sideRight = sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0;
  const canvasLeft = sideRight;
  const canvasW = vw - canvasLeft;
  const rr = R(root);
  const out = { vw, vh, found:true, rootClass: root.className, rootTag: root.tagName,
    root:R(root), canvasLeft, canvasW, sideRight,
    rootRight: rr.right, contentW: rr.right - canvasLeft,
    rightGutterPx: vw - rr.right, horizontalFill: +((rr.right-canvasLeft)/canvasW).toFixed(3) };

  out.rootStyle = { display:cs(root).display, gap:cs(root).gap, padding:cs(root).padding,
    marginTop:cs(root).marginTop, marginBottom:cs(root).marginBottom, width:cs(root).width };

  // scroll ownership
  out.scroll = { rootScrollH: root.scrollHeight, rootClientH: root.clientHeight,
    rootScrollable: root.scrollHeight > root.clientHeight + 2,
    bodyScrollH: document.body.scrollHeight, bodyClientH: document.documentElement.clientHeight,
    bodyScrollable: document.body.scrollHeight > document.documentElement.clientHeight + 2 };

  // grid density scan across canvas — count a cell as CONTENT only if the
  // topmost painted element at that point carries real foreground (text,
  // border, or visual media), NOT merely the page base background.
  const step = 24;
  let total=0, blank=0;
  const colBlank = {}; const colTotal={};
  function isContentAt(x,y){
    const el = document.elementFromPoint(x, y);
    if (!el || el === document.body || el === document.documentElement) return false;
    let n = el;
    while (n && n !== root && n !== document.body && n !== document.documentElement) {
      const s = getComputedStyle(n);
      if (n.textContent && n.textContent.trim().length) return true;
      const bw = s.borderTopWidth+s.borderRightWidth+s.borderBottomWidth+s.borderLeftWidth;
      if (bw && bw !== '' && parseFloat(bw) > 0) return true;
      if (n.querySelector && n.querySelector('canvas, svg, img')) return true;
      // a non-transparent background that is lighter than the near-black base
      const bg = s.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && bg !== 'rgb(10, 10, 10)' && bg !== 'rgb(0, 0, 0)') return true;
      n = n.parentElement;
    }
    return false;
  }
  for (let x = canvasLeft + step/2; x < vw; x += step) {
    for (let y = step/2; y < vh; y += step) {
      total++; colTotal[Math.round(x)] = (colTotal[Math.round(x)]||0)+1;
      if (!isContentAt(x,y)) { blank++; colBlank[Math.round(x)] = (colBlank[Math.round(x)]||0)+1; }
    }
  }
  out.density = +(1 - blank/total).toFixed(3);
  out.blankCells = blank; out.totalCells = total;
  let gutterCols=0;
  const xs = Object.keys(colTotal).map(Number).sort((a,b)=>a-b);
  for (const x of xs) {
    const b = colBlank[x]||0, t = colTotal[x];
    if (b === t) gutterCols++; else break;
  }
  out.fullyBlankCols = gutterCols;
  out.rightGutterColPx = gutterCols*step;

  // large empty HTML containers (exclude svg subtree)
  const empty = [];
  for (const el of root.querySelectorAll('*')) {
    if (inSvg(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.height > 36 && b.height < vh && !hasContent(el) && b.width>0) {
      const s = cs(el);
      if ((!s.backgroundColor || s.backgroundColor==='rgba(0, 0, 0, 0)' || s.backgroundColor==='transparent') && !el.querySelector('canvas,svg,img')) {
        empty.push({ tag:el.tagName, cls:(typeof el.className==='string'?el.className:''), h:Math.round(b.height), w:Math.round(b.width) });
      }
    }
  }
  out.emptyContainers = empty.slice(0,30); out.emptyCount = empty.length;

  // fixed heights
  const fixed = [];
  for (const el of root.querySelectorAll('*')) {
    if (inSvg(el)) continue;
    const s = cs(el);
    const vh2 = [s.minHeight, s.height, s.maxHeight].join(' ');
    if (/\\d+vh|\\d+px|\\d+\\s*%/i.test(vh2) && !/^0px$|auto|none/.test(vh2.replace(/0px/g,'0px'))) {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h>0) fixed.push({ tag:el.tagName, cls:(typeof el.className==='string'?el.className:''), minH:s.minHeight, h:s.height, maxH:s.maxHeight, px:h });
    }
  }
  out.fixedHeight = fixed.slice(0,40); out.fixedCount = fixed.length;

  // section heading text (first h1/h2 inside)
  const h = root.querySelector('h1,h2,h3');
  out.heading = h ? h.textContent.trim().slice(0,60) : null;
  return out;
})();
`;

async function runSection(conn, url, name) {
  await conn.send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 3200));
  const m = await conn.send("Runtime.evaluate", { expression: MEASURE_JS, returnByValue: true });
  const data = m?.result?.value ?? m?.result;
  const shot = await conn.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, "base64"));
  return data;
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page");
  const conn = cdp(page.webSocketDebuggerUrl);
  await conn.ready;
  await conn.send("Page.enable");
  await conn.send("Runtime.enable");
  await conn.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  const sections = (process.argv[2] || "home,portfolio,watchlist,research,analytics,options,predictions,decisions,journal,tax-estimator,briefing,auth,metrics").split(",");
  const summary = [];
  const writeSummary = () => fs.writeFileSync(path.join(OUT, "SUMMARY.json"), JSON.stringify(summary, null, 2));
  for (const s of sections) {
    const slug = s;
    const url = slug === "auth"
      ? "http://localhost:5173/auth?mode=signin"
      : slug === "home"
        ? "http://localhost:5173/"
        : slug === "metrics"
          ? "http://localhost:5173/app?guest=1&section=metrics"
          : slug === "briefing"
            ? "http://localhost:5173/app?guest=1&section=briefing"
            : `http://localhost:5173/app?guest=1&section=${slug}`;
    try {
      const m = await runSection(conn, url, slug);
      fs.writeFileSync(path.join(OUT, `${slug}.json`), JSON.stringify(m, null, 2));
      const row = { section: slug, density: m?.density, horizontalFill: m?.horizontalFill, rightGutterPx: m?.rightGutterPx, rightGutterColPx: m?.rightGutterColPx, emptyCount: m?.emptyCount, fixedCount: m?.fixedCount, rootScrollable: m?.scroll?.rootScrollable, bodyScrollable: m?.scroll?.bodyScrollable, heading: m?.heading };
      summary.push(row);
      console.error("OK", slug, "density=", m?.density, "hFill=", m?.horizontalFill, "gutter=", m?.rightGutterPx, "empty=", m?.emptyCount, "fixed=", m?.fixedCount);
    } catch (e) {
      console.error("FAIL", slug, e.message);
      summary.push({ section: slug, error: e.message });
    }
    writeSummary();
  }
  console.log(JSON.stringify(summary, null, 2));
  conn.close();
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
