import WebSocket from 'ws';
import fs from 'fs';
const CDB = 'http://localhost:9222';
const URL = process.argv[2] || 'http://localhost:5173/?guest=1';
const OUTDIR = '/tmp/zenin-verify';
fs.mkdirSync(OUTDIR, { recursive: true });
function rpc(ws, method, params = {}, id = Math.floor(Math.random()*1e6)) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout '+method)), 20000);
    const h = (raw) => { const m = JSON.parse(raw); if (m.id===id) { ws.off('message', h); clearTimeout(timer); resolve(m.result!==undefined?m.result:m); } };
    ws.on('message', h); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function main() {
  const ver = await (await fetch(CDB + '/json/version')).json();
  const browserWs = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise(r => browserWs.on('open', r));
  const createRes = await rpc(browserWs, 'Target.createTarget', { url: URL });
  const createdId = createRes && createRes.targetId;
  if (!createdId) throw new Error('target not created (no targetId in result)');
  await new Promise(r => setTimeout(r, 800));
  const list = await (await fetch(CDB + '/json/list')).json();
  const pageTarget = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl && t.id === createdId);
  if (!pageTarget) { console.log('created target not in list. ids:', list.map(t=>t.id).join(' | ')); return; }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  await rpc(ws, 'Page.enable'); await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width:1920, height:1080, deviceScaleFactor:1, mobile:false });
  await new Promise(r => setTimeout(r, 3500));
  const res = await rpc(ws, 'Runtime.evaluate', { expression: `(${probe})()`, returnByValue: true });
  if (res.exceptionDetails) { console.log('EXC', JSON.stringify(res.exceptionDetails.exception)); return; }
  const d = res.result.value;
  console.log('URL:', d.url);
  console.log('bodyClass:', d.bodyClass);
  console.log('rootChildren:', d.rootChildren.slice(0,8).join(' | '));
  console.log('hasAppLayout:', d.hasAppLayout, ' hasMainContent:', d.hasMainContent, ' hasSidebar:', d.hasSidebar);
  console.log('mainWidth:', d.mainWidth, 'sidebarW:', d.sidebarW);
  console.log('text sample:', d.textSample.slice(0, 200));
  console.log('h1:', d.h1);
  const shot = await rpc(ws, 'Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  fs.writeFileSync(`${OUTDIR}/probe-guest-1920.png`, Buffer.from(shot.data,'base64'));
  ws.close(); browserWs.close();
}
function probe() {
  return {
    url: location.pathname + location.search,
    bodyClass: document.body.className,
    rootChildren: Array.from(document.getElementById('root')?.children||[]).map(e => e.tagName+'.'+(e.className||'').toString().split(' ').slice(0,3).join('.')),
    hasAppLayout: !!document.querySelector('.app-layout'),
    hasMainContent: !!document.querySelector('.main-content'),
    hasSidebar: !!document.querySelector('.sidebar'),
    mainWidth: (() => { const m=document.querySelector('.main-content')||document.querySelector('.app-layout-home'); return m?Math.round(m.getBoundingClientRect().width):null; })(),
    sidebarW: (() => { const s=document.querySelector('.sidebar'); return s?Math.round(s.getBoundingClientRect().width):0; })(),
    h1: document.querySelector('h1')?.textContent || null,
    textSample: (document.body.innerText||'').replace(/\s+/g,' ').trim(),
  };
}
main().catch(e => { console.error('ERR', e.message||e); process.exit(1); });
