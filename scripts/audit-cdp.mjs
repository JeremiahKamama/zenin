// CDP audit harness for Zenin whitespace audit.
// Drives the headless Chrome already running on localhost:9222.
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
  const queue = new Map();
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
    } else if (msg.method === "Page.loadEventFired" || msg.method === "Page.domContentEventFired") {
      // noop
    }
  });
  ws.on("open", () => resolveReady());
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return {
    ws,
    ready,
    send,
    close: () => ws.close(),
    on(event, cb) {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === event) cb(msg.params);
      });
    },
  };
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  const conn = cdp(page.webSocketDebuggerUrl);
  await conn.ready;
  await conn.send("Page.enable");
  await conn.send("Runtime.enable");

  const url = process.argv[2] || "http://localhost:5173/app?guest=1&section=home";
  const screenshotOnly = process.argv[3] === "shot";
  const name = process.argv[4] || "probe";

  await conn.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // Navigate (fresh navigation to clear state)
  await conn.send("Page.navigate", { url });
  // wait for load
  await new Promise((r) => setTimeout(r, 3500));

  const measure = await conn.send("Runtime.evaluate", {
    expression: MEASURE_JS,
    returnByValue: true,
  });

  const shot = await conn.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const png = Buffer.from(shot.data, "base64");
  const shotPath = path.join(OUT, `${name}.png`);
  fs.writeFileSync(shotPath, png);

  if (!screenshotOnly) {
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(measure.result, null, 2));
  }
  console.log(JSON.stringify({ name, shotPath, measure: measure.result ? "ok" : measure.exceptionDetails }, null, 2));
  conn.close();
}

const MEASURE_JS = `
(function(){
  const vw = window.innerWidth, vh = window.innerHeight;
  function cs(el){ return el ? getComputedStyle(el) : null; }
  function rect(el){ const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)}; }
  function hasContent(el){
    if (el.textContent && el.textContent.trim().length) return true;
    const bg = cs(el).backgroundColor;
    const img = el.querySelector('img, canvas, svg');
    if (img) return true;
    return false;
  }
  // find workspace root
  let root = document.querySelector('main.workspace-main') || document.querySelector('.workspace-main');
  if(!root){ root = document.querySelector('[data-workspace], .app-shell main, main, .workspace-shell'); }
  const out = { vw, vh, found: !!root, rootClass: root ? root.className : null, rootTag: root?root.tagName:null };
  if(!root) return out;
  const rrect = rect(root);
  out.root = rrect;
  out.rootStyle = {
    display: cs(root).display, gap: cs(root).gap, padding: cs(root).padding,
    paddingTop: cs(root).paddingTop, paddingBottom: cs(root).paddingBottom,
    paddingLeft: cs(root).paddingLeft, paddingRight: cs(root).paddingRight,
    marginTop: cs(root).marginTop, marginBottom: cs(root).marginBottom,
  };
  out.horizontalUtil = +(rrect.w / vw).toFixed(3);
  // scroll height vs client
  out.scrollHeight = root.scrollHeight;
  out.clientHeight = root.clientHeight;
  out.verticalOverflowPx = root.scrollHeight - rrect.h;
  // direct children gaps
  const kids = Array.from(root.children);
  out.childCount = kids.length;
  const kidRects = kids.map(k=>{ const rr=rect(k); return {tag:k.tagName, cls:k.className, ...rr, content: !!hasContent(k), styleHeight: cs(k).height, styleMinH: cs(k).minHeight}; });
  out.children = kidRects;
  // gaps between consecutive children (vertical)
  let totalGap = 0; const gaps = [];
  for(let i=1;i<kidRects.length;i++){
    const gap = kidRects[i].y - kidRects[i-1].bottom;
    if(gap > 0){ totalGap += gap; gaps.push({after: kidRects[i-1].cls||kidRects[i-1].tag, gap}); }
  }
  out.totalVerticalGap = totalGap;
  out.gaps = gaps.filter(g=>g.gap>=24);
  // empty placeholder containers: block elements with height>40 and no content
  const empty = [];
  const all = root.querySelectorAll('*');
  for(const el of all){
    const rr = el.getBoundingClientRect();
    if(rr.height > 40 && !hasContent(el)){
      empty.push({tag:el.tagName, cls:(typeof el.className==='string'?el.className:''), h:Math.round(rr.height), w:Math.round(rr.width)});
    }
  }
  out.emptyContainers = empty.slice(0,40);
  out.emptyCount = empty.length;
  // fixed height detection
  const fixed = [];
  for(const el of all){
    const s = cs(el);
    const vh = s.minHeight||s.height||s.maxHeight;
    if(/vh|\\d+px|\\d+\\s*%/i.test(vh) && vh!=='0px' && vh!=='auto' && vh!=='none'){
      fixed.push({tag:el.tagName, cls:(typeof el.className==='string'?el.className:''), prop:{minHeight:s.minHeight,height:s.height,maxHeight:s.maxHeight}});
    }
  }
  out.fixedHeight = fixed.slice(0,40);
  out.fixedCount = fixed.length;
  return out;
})();
`;

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
