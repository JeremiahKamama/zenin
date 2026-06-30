const { execSync } = require('child_process');
const CHROME = "/Users/jeremiahkamama/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell";
// Launch with remote debugging
const { spawn } = require('child_process');
const http = require('http');

function get(port, path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, (r) => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}
function wsSend(ws, id, method, params={}) {
  return new Promise((res, rej) => {
    const msg = JSON.stringify({ id, method, params });
    const cb = (data) => {
      try {
        const obj = JSON.parse(data.toString());
        if (obj.id === id) { ws.off('message', cb); res(obj.result); }
      } catch {}
    };
    ws.on('message', cb);
    ws.send(msg);
  });
}

const port = 49321;
const child = spawn(CHROME, [
  '--headless','--disable-gpu','--no-sandbox','--hide-scrollbars',
  '--window-size=1440,1100','--remote-debugging-port='+port,
  'about:blank'
], { stdio: 'ignore' });

(async () => {
  let targets;
  for (let i=0;i<40;i++){ try { const t = await get(port,'/json/list'); targets = JSON.parse(t); if (targets.length) break; } catch{} await new Promise(r=>setTimeout(r,150)); }
  const target = targets.find(t=>t.type==='page');
  const { WebSocket } = require('ws');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r)=>ws.on('open',r));
  ws.on('message', ()=>{});
  // Create isolated world & inject localStorage, then navigate
  await wsSend(ws,1,'Page.enable');
  await wsSend(ws,2,'Network.enable');
  await wsSend(ws,3,'Page.addScriptToEvaluateOnNewDocument', { source:
    "localStorage.setItem('zenin_active_section','Journal');" });
  await wsSend(ws,4,'Page.navigate',{ url: 'http://localhost:5173/app' });
  await new Promise(r=>setTimeout(r,6000));
  const { data } = await wsSend(ws,5,'Page.captureScreenshot',{ format:'png' });
  require('fs').writeFileSync('/Users/jeremiahkamama/Desktop/Zenin/zenin/journal-real.png', Buffer.from(data,'base64'));
  // Also capture just the decision-layer element via clip
  const res = await wsSend(ws,6,'Runtime.evaluate',{ expression:
    "(()=>{const e=document.querySelector('.journal-decision-layer');if(!e)return 'none';const r=e.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height})})()", returnByValue:true });
  console.log('rect:', res.result && res.result.value);
  ws.close(); child.kill();
  process.exit(0);
})().catch(e=>{ console.error(e); child.kill(); process.exit(1); });
