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
    ws.on('message', cb);
    ws.send(JSON.stringify({ id, method, params }));
    function cb(data) {
      try { const obj = JSON.parse(data.toString()); if (obj.id===id) { ws.off('message',cb); res(obj.result); } } catch {}
    }
  });
}
const port = 49323;
const child = spawn(CHROME, ['--headless','--disable-gpu','--no-sandbox','--hide-scrollbars','--window-size=1440,1100','--remote-debugging-port='+port,'about:blank'], { stdio:'ignore' });
(async () => {
  let targets;
  for (let i=0;i<40;i++){ try{ const t=await get(port,'/json/list'); targets=JSON.parse(t); if(targets.length)break; }catch{} await new Promise(r=>setTimeout(r,150)); }
  const ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise(r=>ws.on('open',r));
  ws.on('message',()=>{});
  await wsSend(ws,1,'Page.enable');
  await wsSend(ws,2,'Network.enable');
  await wsSend(ws,3,'Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('zenin_active_section','Journal');" });
  await wsSend(ws,4,'Page.navigate',{ url:'http://localhost:5173/app' });
  await new Promise(r=>setTimeout(r,5000));
  // Get sidebar-bottom bounding box and screenshot with clip
  const { result } = await wsSend(ws,5,'Runtime.evaluate',{ expression: `
    (() => {
      const el = document.querySelector('.sidebar-bottom');
      if (!el) return JSON.stringify({err:'not found'});
      const r = el.getBoundingClientRect();
      // Expand clip a bit for context
      return JSON.stringify({x: Math.floor(r.x - 4), y: Math.floor(r.y - 4), w: Math.ceil(r.width + 8), h: Math.ceil(r.height + 8), rows: Array.from(el.children).map(c => {
        const cr = c.getBoundingClientRect();
        return { tag: c.tagName, class: c.className.substring(0,60), x: cr.x, y: cr.y, w: cr.width, h: cr.height };
      })});
    })()
  `, returnByValue:true });
  const info = JSON.parse(result.value);
  console.log('INFO:', JSON.stringify(info.rows, null, 2));
  if (!info.err) {
    const { data } = await wsSend(ws,6,'Page.captureScreenshot',{ format:'png', clip: { x: info.x, y: info.y, width: info.w, height: info.h, scale: 3 } });
    require('fs').writeFileSync('/Users/jeremiahkamama/Desktop/Zenin/zenin/sidebar-bottom-zoom.png', Buffer.from(data,'base64'));
  }
  ws.close(); child.kill(); process.exit(0);
})().catch(e=>{ console.error(e); child.kill(); process.exit(1); });
