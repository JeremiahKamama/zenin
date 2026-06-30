const { spawn } = require('child_process');
const http = require('http');
const { WebSocket } = require('ws');
const CHROME = "/Users/jeremiahkamama/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell";

function get(port, path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)); }).on('error', rej);
  });
}
function wsSend(ws, id, method, params={}) {
  return new Promise((res, rej) => {
    const msg = JSON.stringify({ id, method, params });
    const cb = (data) => {
      try { const obj = JSON.parse(data.toString()); if (obj.id===id) { ws.off('message',cb); res(obj.result); } } catch {}
    };
    ws.on('message', cb);
    ws.send(msg);
  });
}

const port = 49322;
const child = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1440,1100','--remote-debugging-port='+port,'about:blank'], { stdio:'ignore' });

(async () => {
  let targets;
  for (let i=0;i<40;i++){ try{ const t=await get(port,'/json/list'); targets=JSON.parse(t); if(targets.length)break; }catch{} await new Promise(r=>setTimeout(r,150)); }
  const target = targets.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r=>ws.on('open',r));
  ws.on('message',()=>{});
  await wsSend(ws,1,'Page.enable');
  await wsSend(ws,2,'Network.enable');
  await wsSend(ws,3,'Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('zenin_active_section','Journal');" });
  await wsSend(ws,4,'Page.navigate',{ url:'http://localhost:5173/app' });
  await new Promise(r=>setTimeout(r,5000));
  // Scroll sidebar into view & capture just the sidebar area
  const clipRes = await wsSend(ws,5,'Runtime.evaluate',{ expression:
    "(()=>{const s=document.getElementById('zenin-primary-sidebar');if(!s)return null;const r=s.getBoundingClientRect();return JSON.stringify({x:0,y:0,w:r.width+20,h:r.height})})()", returnByValue:true });
  let clip = null;
  if(clipRes && clipRes.result && clipRes.result.value) clip = JSON.parse(clipRes.result.value);
  const params = { format:'png' };
  if(clip) params.clip = { x:0, y:0, width:clip.w, height:clip.h, scale:2 };
  const { data } = await wsSend(ws,6,'Page.captureScreenshot', params);
  require('fs').writeFileSync('/Users/jeremiahkamama/Desktop/Zenin/zenin/sidebar-collapsed.png', Buffer.from(data,'base64'));
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{ console.error(e); child.kill(); process.exit(1); });
