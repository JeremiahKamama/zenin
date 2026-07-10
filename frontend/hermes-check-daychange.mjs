import WebSocket from 'ws';
import fs from 'fs';
const CDB = 'http://localhost:9222';
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
  const createRes = await rpc(browserWs, 'Target.createTarget', { url: 'http://localhost:5173/app' });
  const createdId = createRes && createRes.targetId;
  await new Promise(r => setTimeout(r, 1500));
  const list = await (await fetch(CDB + '/json/list')).json();
  const pageTarget = list.find(t => t.type==='page' && t.webSocketDebuggerUrl && t.id===createdId);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  await rpc(ws, 'Page.enable'); await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Emulation.setDeviceMetricsOverride', { width:1920, height:1080, deviceScaleFactor:1, mobile:false });
  await new Promise(r => setTimeout(r, 3500));
  const res = await rpc(ws, 'Runtime.evaluate', { expression: `(${probe})()`, returnByValue:true });
  if (res.exceptionDetails) { console.log('EXC', JSON.stringify(res.exceptionDetails.exception)); return; }
  console.log(JSON.stringify(res.result.value, null, 2));
  const shot = await rpc(ws, 'Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
  fs.writeFileSync(`${OUTDIR}/portfolio-daychange-check.png`, Buffer.from(shot.data,'base64'));
  ws.close(); browserWs.close();
}
function probe() {
  const labels = Array.from(document.querySelectorAll('.portfolio-v2-stat-card .label')).map(e => e.textContent.trim());
  const summary = document.querySelector('.portfolio-v2-top-cards');
  return {
    summaryCardCount: summary ? summary.querySelectorAll('.portfolio-v2-stat-card').length : 0,
    summaryLabels: labels,
    dayChangePresent: labels.includes('Day Change'),
  };
}
main().catch(e => { console.error('ERR', e.message||e); process.exit(1); });
