// Precise probe: sets 1920x1080 emulation IMMEDIATELY before measuring,
// reports the flex shell chain + the real content max-width per section.
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
  function cs(el){return getComputedStyle(el);}
  function R(el){const r=el.getBoundingClientRect();return {x:Math.round(r.x),w:Math.round(r.width),right:Math.round(r.right)};}
  const main=document.querySelector('main.main-content');
  const chain=[];
  let n=main;
  while(n && n!==document.body && n!==document.documentElement){
    const s=cs(n);
    chain.push({cls:(typeof n.className==='string'?n.className:n.tagName), tag:n.tagName, w:Math.round(n.getBoundingClientRect().width), maxW:s.maxWidth, display:s.display, flex:s.flex});
    n=n.parentElement;
  }
  // widest content container inside
  let widest=null;
  main.querySelectorAll('*').forEach(el=>{
    const w=Math.round(el.getBoundingClientRect().width);
    if((typeof el.className==='string') && /(view|page|layout|shell|grid|wrap|module|workbench|desk)$/i.test(el.className)){
      if(!widest||w>widest.w) widest={cls:el.className.split(' ')[0], w, maxW:cs(el).maxWidth};
    }
  });
  return { vw, main:R(main), mainMaxW:cs(main).maxWidth, mainParentMaxW: chain[1]?chain[1].maxW:null, chain:chain.slice(0,5), widest };
})();
`;
async function main(){
  const targets=await listTargets(); const page=targets.find(t=>t.type==="page");
  const conn=cdp(page.webSocketDebuggerUrl); await conn.ready;
  await conn.send("Page.enable"); await conn.send("Runtime.enable");
  const sections=(process.argv[2]||"portfolio,watchlist,research,analytics,options,predictions,decisions,journal,tax-estimator,briefing,metrics").split(",");
  const out={};
  for(const s of sections){
    const url=`http://localhost:5173/app?guest=1&section=${s}`;
    await conn.send("Page.navigate",{url});
    await new Promise(r=>setTimeout(r,2600));
    // re-assert viewport right before measuring
    await conn.send("Emulation.setDeviceMetricsOverride",{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
    await new Promise(r=>setTimeout(r,400));
    const m=await conn.send("Runtime.evaluate",{expression:JS,returnByValue:true});
    const d=m.result.value||m.result;
    out[s]=d;
    console.error(`${s.padEnd(14)} vw=${d.vw} main.w=${d.main.w} mainMax=${d.mainMaxW} parentMax=${d.mainParentMaxW} widest=${d.widest?d.widest.cls+':'+d.widest.w+'/'+d.widest.maxW:'?'} gutter=${d.vw-d.main.right}`);
  }
  fs.writeFileSync(path.join(OUT,"shell.json"),JSON.stringify(out,null,2));
  conn.close();
}
main().catch(e=>{console.error(e);process.exit(1);});
