// Measure the actual content-container width + limiting max-width per section.
import WebSocket from "ws";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, "audit-out");
fs.mkdirSync(OUT, { recursive: true });
const HTTP = "http://localhost:9222";
async function listTargets(){ return (await fetch(`${HTTP}/json/list`)).json(); }
function cdp(wsUrl){ const ws=new WebSocket(wsUrl); let id=0; const pending=new Map(); let resolveReady; const ready=new Promise(r=>resolveReady=r);
  ws.on("message",d=>{const m=JSON.parse(d.toString()); if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id); pending.delete(m.id); m.error?reject(new Error(m.error.message)):resolve(m.result);}});
  ws.on("open",()=>resolveReady());
  const send=(method,params={})=>new Promise((resolve,reject)=>{const mid=++id; pending.set(mid,{resolve,reject}); ws.send(JSON.stringify({id:mid,method,params}));});
  return {ws,ready,send,close:()=>ws.close()}; }
const JS = `
(function(){
  const vw=window.innerWidth;
  let root=document.querySelector('main.main-content');
  if(!root) return {found:false};
  function cs(el){return getComputedStyle(el);}
  // find the widest direct-ish block element chain: collect candidate containers
  const cands=[];
  root.querySelectorAll('*').forEach(el=>{
    const s=cs(el); const bw=el.getBoundingClientRect().width;
    if(bw>0 && (el.className && typeof el.className==='string' && /(view|page|layout|shell|container|content|grid|wrap)$/i.test(el.className))){
      cands.push({cls:el.className, w:Math.round(bw), maxW:s.maxWidth, display:s.display, m:Math.round(el.getBoundingClientRect().right)});
    }
  });
  // dedupe keep widest per class
  const seen={}; cands.forEach(c=>{ const key=String(c.cls).slice(0,40); if(!seen[key]||c.w>seen[key].w) seen[key]=c; });
  const list=Object.values(seen).sort((a,b)=>b.w-a.w).slice(0,12);
  return { vw, canvasW: vw-312, found:true, candidates: list };
})();
`;
async function main(){
  const targets=await listTargets(); const page=targets.find(t=>t.type==="page");
  const conn=cdp(page.webSocketDebuggerUrl); await conn.ready;
  await conn.send("Page.enable"); await conn.send("Runtime.enable");
  await conn.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  const sections=(process.argv[2]||"portfolio,watchlist,research,analytics,options,predictions,decisions,journal,tax-estimator,briefing,metrics").split(",");
  const out={};
  for(const s of sections){
    const url = s==="metrics"||s==="briefing" ? `http://localhost:5173/app?guest=1&section=${s}` : `http://localhost:5173/app?guest=1&section=${s}`;
    await conn.send("Page.navigate",{url}); await new Promise(r=>setTimeout(r,3000));
    const m=await conn.send("Runtime.evaluate",{expression:JS,returnByValue:true});
    const d=m.result.value||m.result;
    out[s]=d;
    console.error(s.padEnd(14), "canvasW=",d.canvasW, "topCands=", (d.candidates||[]).slice(0,4).map(c=>`${String(c.cls).split(' ')[0]}:${c.w}/${c.maxW}`).join("  "));
  }
  fs.writeFileSync(path.join(OUT,"widths.json"),JSON.stringify(out,null,2));
  conn.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
