import WebSocket from 'ws';
import fs from 'fs';

const CDB = 'http://localhost:9222';
const OUTDIR = '/tmp/zenin-verify';
fs.mkdirSync(OUTDIR, { recursive: true });

const TARGETS = [
  { name: 'auth', url: 'http://localhost:5173/auth' },
  { name: 'briefing', url: 'http://localhost:5173/app?guest=1&section=briefing' },
  { name: 'decisions', url: 'http://localhost:5173/app?guest=1&section=tools' },
  { name: 'portfolio', url: 'http://localhost:5173/app?guest=1&section=portfolio' },
  { name: 'options', url: 'http://localhost:5173/app?guest=1&section=options' },
];

function rpc(ws, method, params = {}, id = Math.floor(Math.random() * 1e6)) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 25000);
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) { ws.off('message', handler); clearTimeout(timer); resolve(msg.result !== undefined ? msg.result : msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function withTab(url, fn) {
  const ver = await (await fetch(CDB + '/json/version')).json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => browserWs.on('open', r));
  const createRes = await rpc(browserWs, 'Target.createTarget', { url });
  const createdId = createRes && createRes.targetId;
  await new Promise((r) => setTimeout(r, 900));
  const list = await (await fetch(CDB + '/json/list')).json();
  const pageTarget = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.id === createdId);
  if (!pageTarget) throw new Error('target not found for ' + url);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 3200));
  try { return await fn(ws); } finally { ws.close(); browserWs.close(); }
}

const CHECKS = `(${probe})()`;
function probe() {
  const out = { url: location.pathname + location.search };
  // Auth two-column
  const authShell = document.querySelector('.auth-v2-shell');
  if (authShell) {
    const cs = getComputedStyle(authShell);
    const brand = document.querySelector('.auth-v2-brand-panel');
    const card = document.querySelector('.auth-v2-panel') || document.querySelector('.auth-card');
    out.auth = { gridCols: cs.gridTemplateColumns, brand: !!brand, card: !!card };
  }
  // Briefing guided workspace
  out.briefingGuided = !!document.querySelector('.briefing-guided-workspace');
  // Decisions guided
  out.decisionGuided = !!document.querySelector('.decision-guided-workspace');
  // Portfolio top cards content-driven
  const top = document.querySelector('.portfolio-v2-top-cards');
  if (top) {
    out.portfolioTopAlign = getComputedStyle(top).alignItems;
    out.portfolioTopCols = getComputedStyle(top).gridTemplateColumns;
    const cards = top.querySelectorAll('.portfolio-v2-stat-card');
    let maxH = 0;
    cards.forEach(c => { maxH = Math.max(maxH, Math.round(c.getBoundingClientRect().height)); });
    out.portfolioStatCards = cards.length;
    out.portfolioMaxCardH = maxH;
  } else {
    out.portfolioTopCards = false;
  }
  // Decisions guided (may be absent if threads populated)
  out.decisionGuidedExists = !!document.querySelector('.decision-guided-workspace');
  // Options tokenized (no inline magic spacings)
  const opts = document.querySelector('.options-calculator');
  out.optionsPresent = !!opts;
  // scan for cyan/gradient/horizontal
  out.scrollW = document.documentElement.scrollWidth;
  out.docW = document.documentElement.clientWidth;
  out.hScroll = out.scrollW > out.docW + 2;
  let cyan = 0, grad = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.color && /rgb\(\s*0,\s*(19[0-9]|2[0-9]{2}),\s*(19[0-9]|2[0-9]{2})\)/.test(cs.color)) cyan++;
    if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) grad++;
  }
  out.cyan = cyan; out.grad = grad;
  return out;
}

async function main() {
  for (const t of TARGETS) {
    try {
      const result = await withTab(t.url, async (ws) => {
        const res = await rpc(ws, 'Runtime.evaluate', { expression: CHECKS, returnByValue: true });
        if (res.exceptionDetails) return { error: JSON.stringify(res.exceptionDetails.exception) };
        const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(`${OUTDIR}/${t.name}-1920.png`, Buffer.from(shot.data, 'base64'));
        return res.result.value;
      });
      console.log(`\n=== ${t.name} ===`);
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.log(`\n=== ${t.name} ERROR: ${e.message}`);
    }
  }
  console.log(`\nScreenshots in ${OUTDIR}`);
}
main().catch((e) => { console.error('FATAL', e.message || e); process.exit(1); });
