import WebSocket from 'ws';
import fs from 'fs';

const CDB = 'http://localhost:9222';
const URL = process.argv[2] || 'http://localhost:5173/app?guest=1';
const OUTDIR = '/tmp/zenin-verify';
fs.mkdirSync(OUTDIR, { recursive: true });

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '3440x1440', width: 3440, height: 1440 },
];

function rpc(ws, method, params = {}, id = Math.floor(Math.random() * 1e6)) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + method)), 20000);
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) { ws.off('message', handler); clearTimeout(timer); resolve(msg.result !== undefined ? msg.result : msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const ver = await (await fetch(CDB + '/json/version')).json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => browserWs.on('open', r));
  const createRes = await rpc(browserWs, 'Target.createTarget', { url: URL });
  const createdId = createRes && createRes.targetId;
  if (!createdId) throw new Error('target not created (no targetId in result)');
  await new Promise(r => setTimeout(r, 700));

  const list = await (await fetch(CDB + '/json/list')).json();
  const pageTarget = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.id === createdId);
  if (!pageTarget) throw new Error('created target not in list');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Runtime.enable');

  for (const vp of VIEWPORTS) {
    await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
    await rpc(ws, 'Page.navigate', { url: URL }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const res = await rpc(ws, 'Runtime.evaluate', { expression: `(${measureFn})(${vp.height})`, returnByValue: true });
    if (!res || !res.result || res.exceptionDetails) {
      console.log(`  EVAL ERROR @ ${vp.name}:`, JSON.stringify(res && res.exceptionDetails ? res.exceptionDetails.exception : res));
      continue;
    }
    const m = res.result.value;
    const utilPct = m.mainWidth ? Math.round((m.mainWidth / m.docW) * 100) : null;
    const appPct = m.appWidth ? Math.round((m.appWidth / m.docW) * 100) : null;
    const canvasPct = m.mainWidth ? Math.round((m.contentArea / (m.mainWidth * vp.height)) * 100) : null;
    const shot = await rpc(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`${OUTDIR}/home-${vp.name}.png`, Buffer.from(shot.data, 'base64'));

    console.log(`\n=== ${vp.name} (${m.url}) ===`);
    console.log(`  docW=${m.docW} mainWidth=${m.mainWidth} appWidth=${m.appWidth} mainLeft=${m.mainLeft} sidebarW=${m.sidebarW}`);
    console.log(`  WORKSPACE UTIL (main/viewport) = ${utilPct}%`);
    console.log(`  APP FRAME UTIL (sidebar+main / viewport) = ${appPct}%`);
    console.log(`  est canvas density = ${canvasPct}%`);
    console.log(`  horizontalScroll=${m.hasHScroll} scrollW=${m.scrollW}`);
    console.log(`  cyanHits=${m.cyanHits} gradientHits=${m.gradientHits}`);
  }
  ws.close();
  browserWs.close();
  console.log(`\nScreenshots in ${OUTDIR}`);
}

function measureFn(vh) {
  const docW = document.documentElement.clientWidth;
  const main = document.querySelector('.main-content') || document.querySelector('.app-layout-home') || document.querySelector('.app-layout');
  const mainRect = main ? main.getBoundingClientRect() : null;
  const appLayout = document.querySelector('.app-layout');
  const appRect = appLayout ? appLayout.getBoundingClientRect() : null;
  const sidebar = document.querySelector('.sidebar');
  const sidebarW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
  const scrollW = document.documentElement.scrollWidth;
  const hasHScroll = scrollW > docW + 2;
  let cyanHits = 0, gradientHits = 0;
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.color && /rgb\(\s*0,\s*(19[0-9]|2[0-9]{2}),\s*(19[0-9]|2[0-9]{2})\)/.test(cs.color)) cyanHits++;
    if (cs.backgroundImage && /gradient/.test(cs.backgroundImage)) gradientHits++;
  }
  let contentArea = 0;
  if (mainRect) { for (const k of main.querySelectorAll(':scope > *')) { const r = k.getBoundingClientRect(); contentArea += r.width * Math.max(0, r.height); } }
  return { url: location.pathname + location.search, docW, mainWidth: mainRect ? Math.round(mainRect.width) : null, mainLeft: mainRect ? Math.round(mainRect.left) : null, appWidth: appRect ? Math.round(appRect.width) : null, sidebarW, scrollW, hasHScroll, cyanHits, gradientHits, contentArea: Math.round(contentArea) };
}

main().catch((e) => { console.error('ERR', e.message || e); process.exit(1); });
