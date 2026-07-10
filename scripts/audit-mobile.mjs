// Mobile/tablet responsive audit harness — drives live Chrome (CDP :9222) against :5173
// Emulates 320/375/768/1024/1280/1440/1720, measures horizontal overflow + content width,
// and captures screenshots for the mobile/tablet range (the prior-audit gap).
import WebSocket from 'ws';
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';

const CDP = JSON.parse(execSync('curl -s http://localhost:9222/json/list').toString())
  .find(t => t.type === 'page').webSocketDebuggerUrl;

const SECTIONS = ['dashboard','portfolio','watchlist','briefing','research','analytics','journal','tax','decisions','options','predictions','settings','auth'];
const WIDTHS = [320,375,768,1024,1280,1440,1720];
const SHOT_WIDTHS = [320,375,768,1024]; // screenshots only for mobile/tablet gap
const OUT = 'scripts/audit-out/mobile';
mkdirSync(OUT, { recursive: true });

const ws = new WebSocket(CDP);
let id = 0; const pending = new Map();
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); ws.send(JSON.stringify({ id: mid, method, params })); });

const results = [];

ws.on('open', async () => {
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const section of SECTIONS) {
      const url = section === 'auth'
        ? 'http://localhost:5173/auth?guest=1'
        : `http://localhost:5173/app?guest=1&section=${section}`;
      await send('Page.navigate', { url });
      await new Promise(r => setTimeout(r, 3500)); // let it render + data settle

      for (const w of WIDTHS) {
        const mobile = w < 768;
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile });
        await new Promise(r => setTimeout(r, 600)); // reflow + media queries

        const m = await send('Runtime.evaluate', {
          returnByValue: true,
          expression: `(function(){
            const iw = window.innerWidth;
            const de = document.documentElement;
            const sw = de.scrollWidth;
            const sh = de.scrollHeight;
            const main = document.querySelector('main.main-content') || document.querySelector('.view-container') || document.querySelector('#root > div');
            const mr = main ? Math.round(main.getBoundingClientRect().right) : null;
            const over = [];
            document.querySelectorAll('*').forEach(el => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.right > iw + 1) {
                const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName;
                over.push({ cls: String(cls).slice(0,60), right: Math.round(r.right), w: Math.round(r.width) });
              }
            });
            over.sort((a,b)=>b.right-a.right);
            return { iw, scrollW: sw, scrollH: sh, overflowX: sw > iw + 1, diff: sw - iw, mainRight: mr,
                     fillPct: mr && iw ? Math.round((mr/iw)*1000)/10 : null,
                     topOverflow: over.slice(0,4) };
          })()`
        });
        if (m.exceptionDetails) { console.log(`EXC ${section}@${w}:`, JSON.stringify(m.exceptionDetails.exception)); continue; }
        const row = { section, width: w, ...((m.result && m.result.value) || {}) };
        row.topOverflow = row.topOverflow || [];
        results.push(row);
        console.log(`MEASURE ${section}@${w}: overflowX=${row.overflowX} diff=${row.diff} fillPct=${row.fillPct} vh=${row.scrollH}` +
          (row.topOverflow.length ? ` OVER:[${row.topOverflow.map(o=>o.cls+'@'+o.right).join(', ')}]` : ''));

        if (SHOT_WIDTHS.includes(w)) {
          const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          const fname = `${OUT}/${section}-${w}.png`;
          writeFileSync(fname, Buffer.from(shot.data, 'base64'));
        }
      }
    }
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    console.log('DONE sections=' + SECTIONS.length + ' measurements=' + results.length);
  } catch (e) {
    console.log('ERROR', e.message);
  } finally {
    ws.close();
  }
});
