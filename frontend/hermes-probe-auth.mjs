import WebSocket from 'ws';
import fs from 'fs';
const CDB = 'http://localhost:9222';
const URL = process.argv[2] || 'http://localhost:5173/auth';
const OUTDIR = '/tmp/zenin-verify';
fs.mkdirSync(OUTDIR, { recursive: true });
function rpc(ws, method, params = {}, id = Math.floor(Math.random()*1e6)) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout '+method)), 25000);
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
  await new Promise(r => setTimeout(r, 900));
  const list = await (await fetch(CDB + '/json/list')).json();
  const pageTarget = list.find(t => t.type==='page' && t.webSocketDebuggerUrl && t.id===createdId);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  await rpc(ws, 'Page.enable'); await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width:1920, height:1080, deviceScaleFactor:1, mobile:false });
  await new Promise(r => setTimeout(r, 3000));
  const res = await rpc(ws, 'Runtime.evaluate', { expression: `(${probe})()`, returnByValue:true });
  if (res.exceptionDetails) { console.log('EXC', JSON.stringify(res.exceptionDetails.exception)); return; }
  console.log(JSON.stringify(res.result.value, null, 2));
  const shot = await rpc(ws, 'Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  fs.writeFileSync(`${OUTDIR}/auth-deep.png`, Buffer.from(shot.data,'base64'));
  ws.close(); browserWs.close();
}
function probe() {
  const root = document.getElementById('root');
  const main = document.querySelector('main');
  return {
    url: location.pathname,
    rootClass: root?.firstElementChild?.className,
    bodyClass: document.body.className,
    mainClass: main?.className,
    mainChildren: main ? Array.from(main.children).map(c => c.tagName+'.'+(c.className||'').toString().split(' ').slice(0,3).join('.')) : [],
    hasAuthV2Shell: !!document.querySelector('.auth-v2-shell'),
    hasBrandPanel: !!document.querySelector('.auth-v2-panel'),
    hasAuthCard: !!document.querySelector('.auth-v2-card'),
    shellDisplay: (() => { const s=document.querySelector('.auth-v2-shell'); return s?getComputedStyle(s).display:null; })(),
    shellGridCols: (() => { const s=document.querySelector('.auth-v2-shell'); return s?getComputedStyle(s).gridTemplateColumns:null; })(),
    panelLeft: (() => { const p=document.querySelector('.auth-v2-panel'); return p?Math.round(p.getBoundingClientRect().left):null; })(),
    cardLeft: (() => { const c=document.querySelector('.auth-v2-card'); return c?Math.round(c.getBoundingClientRect().left):null; })(),
    cardWidth: (() => { const c=document.querySelector('.auth-v2-card'); return c?Math.round(c.getBoundingClientRect().width):null; })(),
    allAuthClasses: Array.from(document.querySelectorAll('[class*="auth-v2"]')).map(e => e.className.toString().split(' ').filter(c=>c.includes('auth-v2')).join(',')),
    formPresent: !!document.querySelector('form'),
    h1: document.querySelector('h1')?.textContent || document.querySelector('.auth-card h1, .auth-v2-panel h1')?.textContent || null,
  };
}
main().catch(e => { console.error('ERR', e.message||e); process.exit(1); });
