import{r as p,I as Fe,f as X,c as re,a as Te,j as e,z as K,g as Pe}from"./index-R8G5DD0Z.js";function Ae({data:m,tone:b="positive"}){const y=p.useMemo(()=>{const D=Math.min(...m),se=Math.max(...m)-D||1;return m.map((T,V)=>{const k=V/(m.length-1)*120,_=38-(T-D)/se*38;return`${k},${_}`}).join(" ")},[m]);return e.jsx("svg",{className:"sparkline",viewBox:"0 0 120 38",preserveAspectRatio:"none",children:e.jsx("polyline",{className:`sparkline-line ${b}`,points:y})})}function me({value:m}){const b=parseFloat(m);return e.jsx("div",{className:"mini-bar",children:e.jsx("span",{style:{width:`${Math.min(b*3,100)}%`}})})}function qe({onBack:m,themeMode:b,toggleTheme:y,portfolio:v=[],trades:w=[],activeOptionsTrades:D=[],accountMetrics:h=null,assets:se=[],spotPrices:T={},multiChainCache:V={}}){var oe;const[k,_]=p.useState("Performance"),[S,ie]=p.useState("YTD"),[xe,ue]=p.useState("Total Portfolio"),[P,he]=p.useState("S&P 500"),[d,ge]=p.useState("All"),[G,be]=p.useState(null),[B,fe]=p.useState({}),[H,ve]=p.useState([]),[A,ye]=p.useState(null);p.useEffect(()=>{const t=async()=>{try{const a=await K("/macro-indicators?country=USA");if(a.ok){const i=await a.json();be(i)}}catch(a){console.error("Macro Fetch Error:",a)}},r=async()=>{const a=["UST10Y","XAU","WTI","DXY"],i={};await Promise.all(a.map(async l=>{try{const c=await K(`/prices?symbol=${l}`);if(c.ok){const o=await c.json();i[l]=o}}catch(c){console.error(`Price Fetch Error (${l}):`,c)}})),fe(i)};t(),r()},[]),p.useEffect(()=>{const t=async()=>{const a={"S&P 500":{symbol:"SPY",type:"stock"},"Bloomberg U.S. Aggregate Bond Index":{symbol:"AGG",type:"stock"},SOFR:{symbol:"BIL",type:"stock"},"S&P GSCI":{symbol:"GSG",type:"stock"},"MSCI U.S. REIT Index":{symbol:"VNQ",type:"stock"},Bitcoin:{symbol:"BTC-USD",type:"crypto"}},{symbol:i,type:l}=a[P]||{symbol:"SPY",type:"stock"};try{const c=await K(`/history?symbol=${i}&type=${l}&interval=1D`);if(c.ok){const o=await c.json();ve(o.history||[])}}catch(c){console.error("Benchmark History Fetch Error:",c)}},r=async()=>{const i={"S&P 500":"SPY","Bloomberg U.S. Aggregate Bond Index":"AGG",SOFR:"BIL","S&P GSCI":"GSG","MSCI U.S. REIT Index":"VNQ",Bitcoin:"BTCUSD"}[P]||"SPY";try{const l=await K(`/finviz?symbol=${i}`);if(l.ok){const c=await l.json();ye(c)}}catch(l){console.error("Benchmark Finviz Fetch Error:",l)}};t(),r()},[P]);const j=p.useMemo(()=>d==="All"?v:v.filter(t=>{const r=(t.type||"").toLowerCase(),a=(t.category||"").toLowerCase();return d==="Equities"?r==="equity"||r==="stock":d==="Bonds"?r==="bond"||a==="bonds":d==="Crypto"?r==="crypto"||r==="stablecoin":d==="Commodities"?a==="commodities"||a==="metals":d==="Real Estate"?a==="real estate":!0}),[v,d]),I=p.useMemo(()=>d==="All"?w:w.filter(t=>{const r=(t.type||"").toLowerCase();return d==="Equities"?r==="equity"||r==="stock":d==="Bonds"?r==="bond":d==="Crypto"?r==="crypto":!0}),[w,d]),C=Number(h==null?void 0:h.initialBalance)||Fe,Y=Number(h==null?void 0:h.totalAccountEquity)||C,R=p.useMemo(()=>d==="All"?Y:d==="Cash/Money Market"?Number(h==null?void 0:h.availableBalance)||0:j.reduce((t,r)=>t+(Number(r.price)||0)*(Number(r.quantity)||0),0),[d,j,Y,h]),x=Array.isArray(h==null?void 0:h.tradeTimeline)?h.tradeTimeline:[],je=p.useMemo(()=>{const t=C>0?(R-C)/C*100:0,r=I.length>0?I.filter(a=>(Number(a.pnl)||0)>0).length/I.length*100:0;return[{label:`${d==="All"?"Total":d} Return`,value:`${t>=0?"+":""}${t.toFixed(2)}%`,sub:`vs ${P} +8.21%`,tone:t>=0?"positive":"negative",data:x.slice(-12).map(a=>a.equity)||[8,12,10,16,18,22,20,28,31,29,36,41]},{label:`${d==="All"?"Account":d} Value`,value:X(R,"USD",{compact:!0}),sub:d==="All"?`Initial: ${X(C,"USD",{compact:!0})}`:"Allocated Assets",tone:"neutral",data:x.slice(-12).map(a=>a.equity)||[11,10,14,13,17,22,19,24,27,31,33,37]},{label:"Win Rate",value:`${r.toFixed(1)}%`,sub:`${I.length} Segment Trades`,tone:r>=50?"positive":"neutral",data:[10,12,14,16,13,18,21,23,20,25,28,31]},{label:"Positions",value:j.length.toString(),sub:`${D.length} Options active`,tone:"neutral",data:[5,7,8,6,11,10,13,16,15,18,20,22]}]},[C,R,x,I,j,D,d,P]),ne=p.useMemo(()=>{const t=j.reduce((r,a)=>r+re((Number(a.price)||0)*(Number(a.quantity)||0),a.currency||a.quotedCurrency||"USD",T),0);return j.map(r=>({name:r.name||r.symbol,weight:t>0?`${(re((Number(r.price)||0)*(Number(r.quantity)||0),r.currency||r.quotedCurrency||"USD",T)/t*100).toFixed(2)}%`:"0%"})).sort((r,a)=>parseFloat(a.weight)-parseFloat(r.weight)).slice(0,5)},[j]),we=p.useMemo(()=>{const t={};let r=0;return j.forEach(a=>{const i=(Number(a.price)||0)*(Number(a.quantity)||0);r+=i;const l=a.theme||a.sector||"Other";t[l]=(t[l]||0)+i}),Object.entries(t).map(([a,i])=>({name:a,value:r>0?`${(i/r*100).toFixed(1)}%`:"0%"})).sort((a,i)=>parseFloat(i.value)-parseFloat(a.value))},[j]),ke=p.useMemo(()=>{let t=0,r=0,a=0;return D.forEach(i=>{const l=V[i.asset],c=T[i.asset],o=Te(i,l,c);t+=Number(o.pnl)||0,r+=Number(o.delta)||0,a+=Number(o.theta)||0}),[["Options P&L",X(t,"USD",{sign:!0}),"Unrealized"],["Open Strategies",D.length.toString(),"Active positions"],["Portfolio Delta",`${r>=0?"+":""}${r.toFixed(3)}`,"Options Exposure"],["Theta Decay",`-${X(Math.abs(a),"USD")}`,"Daily Decay"]]},[D,V,T]),Ne=p.useMemo(()=>[["Positions",v.length.toString()],["Cash Weight",`${((1-v.reduce((t,r)=>t+re((Number(r.price)||0)*(Number(r.quantity)||0),r.currency||r.quotedCurrency||"USD",T),0)/Y)*100).toFixed(1)}%`],["Beta","0.92"],["ROE","16.24%"]],[v,Y]),De=p.useMemo(()=>{var i,l,c;const t=(l=(i=G==null?void 0:G.metrics)==null?void 0:i.find(o=>o.key==="interest_rate"))==null?void 0:l.current,r=(o,n="—")=>{const s=B[o];if(!s||!s.price)return n;const f=(s==null?void 0:s.currency)||(s==null?void 0:s.quotedCurrency)||"USD",u=Pe(f);return o==="UST10Y"||o==="FED"?`${Number(s.price).toFixed(2)}%`:`${u}${Number(s.price).toLocaleString()}`},a=o=>{const n=B[o];if(!n||!n.priceChangePercent)return"—";const s=Number(n.priceChangePercent);return`${s>=0?"+":""}${s.toFixed(2)}%`};return[["US 10Y Yield",r("UST10Y","Loading..."),a("UST10Y")],["DXY Index",(c=B.DXY)!=null&&c.price?Number(B.DXY.price).toFixed(2):"Loading...",a("DXY")],["Gold Spot",r("XAU","Loading..."),a("XAU")],["WTI Crude",r("WTI","Loading..."),a("WTI")],["Fed Funds Rate",t?`${t}%`:"—","Target Range"]]},[G,B]),Z=p.useMemo(()=>{let t=C,r=0;const a=[];x.forEach((n,s)=>{n.equity>t&&(t=n.equity);const f=t>0?(t-n.equity)/t:0;if(f>r&&(r=f),s>0){const u=x[s-1].equity;u>0&&a.push((n.equity-u)/u)}});const i=a.length>0?a.reduce((n,s)=>n+s,0)/a.length:0,l=a.length>1?a.reduce((n,s)=>n+Math.pow(s-i,2),0)/(a.length-1):0,c=Math.sqrt(l),o=c*Math.sqrt(252);return[{label:"Max Drawdown",value:`-${(r*100).toFixed(2)}%`,tone:"negative"},{label:"Volatility Annualized",value:o>0?`${(o*100).toFixed(2)}%`:"—",tone:"neutral"},{label:"Value at Risk 95%",value:o>0?`-${(c*1.645*100).toFixed(2)}%`:"—",tone:"negative"},{label:"Beta vs S&P 500",value:"—",tone:"neutral"},{label:"Portfolio Exposure",value:`${(R/Y*100).toFixed(1)}%`,tone:"neutral"}]},[x,C,R,Y]),Se=p.useMemo(()=>{const t=(A==null?void 0:A.summary)||{},r=(n,s)=>{var q,W,O,$;if(!n||n.length<2)return 0;const f=((q=n[n.length-1])==null?void 0:q.close)||((W=n[n.length-1])==null?void 0:W.equity);let u=0;if(s==="YTD"){const z=new Date(new Date().getFullYear(),0,1).getTime();u=n.findIndex(M=>(M.t||M.date)>=z)}else if(typeof s=="number"){const z=Date.now()-s*24*60*60*1e3;u=n.findIndex(M=>(M.t||M.date)>=z)}u===-1&&(u=0);const U=((O=n[u])==null?void 0:O.close)||(($=n[u])==null?void 0:$.equity);return U>0?(f-U)/U*100:0},a=(n,s)=>{const f=t[n];return f?parseFloat(String(f).replace(/[^-0.9.]/g,"")):r(H,s)},i={"1M":30,"3M":90,"6M":180,"1Y":365,YTD:"YTD",All:9999}[S]||"YTD",l=r(x,i),o=a({"1M":"Perf Month","3M":"Perf Quarter","6M":"Perf Half Y","1Y":"Perf Year",YTD:"Perf YTD",All:"Perf Year"}[S],i);return[[S,`${l.toFixed(2)}%`,`${o.toFixed(2)}%`,`${(l-o).toFixed(2)}%`],["1M",`${r(x,30).toFixed(2)}%`,`${a("Perf Month",30).toFixed(2)}%`,`${(r(x,30)-a("Perf Month",30)).toFixed(2)}%`],["3M",`${r(x,90).toFixed(2)}%`,`${a("Perf Quarter",90).toFixed(2)}%`,`${(r(x,90)-a("Perf Quarter",90)).toFixed(2)}%`],["YTD",`${r(x,"YTD").toFixed(2)}%`,`${a("Perf YTD","YTD").toFixed(2)}%`,`${(r(x,"YTD")-a("Perf YTD","YTD")).toFixed(2)}%`]]},[x,H,A,S]),Ce=["Performance","Risk","Exposure","Benchmark Comparison","Options & Derivatives","Macro & Commodities","Key Ratios"];return e.jsxs("div",{className:"metrics-shell active-zenin-metrics",children:[e.jsx("style",{children:Ye}),e.jsxs("div",{className:"metrics-mobile-header",children:[e.jsxs("div",{className:"mobile-brand",children:[e.jsx("div",{className:"brand-mark",children:"Z"}),e.jsxs("span",{children:[e.jsx("strong",{children:"ZENIN"})," CAPITAL"]})]}),e.jsx("button",{className:"mobile-menu-btn",onClick:m,children:e.jsxs("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("line",{x1:"3",y1:"12",x2:"21",y2:"12"}),e.jsx("line",{x1:"3",y1:"6",x2:"21",y2:"6"}),e.jsx("line",{x1:"3",y1:"18",x2:"21",y2:"18"})]})})]}),e.jsxs("main",{className:"metrics-main",children:[e.jsxs("header",{className:"metrics-header",children:[e.jsxs("div",{className:"header-titles",children:[e.jsxs("div",{className:"back-row",children:[e.jsx("button",{onClick:m,className:"back-btn",children:"← Back"}),e.jsx("h1",{children:"Key Metrics"})]}),e.jsx("p",{children:"Comprehensive performance, risk, and exposure analytics."})]}),e.jsxs("div",{className:"header-actions",children:[e.jsx(Q,{label:"Timeframe",value:S,options:["YTD","1M","3M","6M","1Y","All"],onChange:ie}),e.jsx(Q,{label:"Scope",value:xe,options:["Total Portfolio","Equities","Bonds","Cash/Money Market","Commodities","Real Estate","Crypto"],onChange:ue}),e.jsx(Q,{label:"Benchmark",value:P,options:["S&P 500","Bloomberg U.S. Aggregate Bond Index","SOFR","S&P GSCI","MSCI U.S. REIT Index","Bitcoin"],onChange:he}),e.jsx(Q,{label:"Asset Class",value:d,options:["All","Equities","Bonds","Cash/Money Market","Commodities","Real Estate","Crypto"],onChange:ge}),e.jsx("button",{className:"export-btn",children:"Export"})]})]}),e.jsx("section",{className:"tabs",children:Ce.map(t=>e.jsx("button",{className:k===t?"active":"",onClick:()=>_(t),children:t},t))}),k==="Performance"&&e.jsxs(e.Fragment,{children:[e.jsx("section",{className:"kpi-grid",children:je.map(t=>e.jsxs("article",{className:"kpi-card",children:[e.jsx("p",{children:t.label}),e.jsx("strong",{className:t.tone,children:t.value}),e.jsx("span",{children:t.sub}),e.jsx(Ae,{data:t.data,tone:t.tone})]},t.label))}),e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel large",children:[e.jsxs("div",{className:"panel-header",children:[e.jsxs("div",{children:[e.jsx("h2",{children:"Performance Over Time"}),e.jsx("p",{children:"Portfolio vs benchmark total return."})]}),e.jsx("span",{className:"pill",children:"YTD"})]}),e.jsx("div",{className:"chart-wrap",children:e.jsxs("svg",{viewBox:"0 0 700 260",className:"line-chart",preserveAspectRatio:"none",children:[e.jsx("defs",{children:e.jsxs("linearGradient",{id:"blueArea",x1:"0",x2:"0",y1:"0",y2:"1",children:[e.jsx("stop",{offset:"0%",stopColor:"var(--blue)",stopOpacity:"0.35"}),e.jsx("stop",{offset:"100%",stopColor:"var(--blue)",stopOpacity:"0"})]})}),[40,90,140,190,240].map(t=>e.jsx("line",{x1:"0",y1:t,x2:"700",y2:t,className:"grid-line"},t)),(()=>{const t=x.length>1?x:[{t:Date.now()-864e5,equity:C},{t:Date.now(),equity:Y}],r=Math.min(...t.map(o=>o.equity))*.95,i=Math.max(...t.map(o=>o.equity))*1.05-r||1,l=t.map((o,n)=>{const s=n/(t.length-1)*700,f=260-(o.equity-r)/i*220-20;return`${s},${f}`}).join(" "),c=`0,260 ${l} 700,260`;return e.jsxs(e.Fragment,{children:[e.jsx("polyline",{className:"portfolio-line",points:l}),e.jsx("polygon",{fill:"url(#blueArea)",points:c})]})})()]})}),e.jsx("div",{className:"range-row",children:["1M","3M","6M","YTD","1Y","All"].map(t=>e.jsx("button",{className:S===t?"active":"",onClick:()=>ie(t),children:t},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsxs("div",{children:[e.jsx("h2",{children:"Summary Insight"}),e.jsx("p",{children:"Portfolio performance explanation."})]})}),(()=>{var z,M;const t=(g,J)=>{var le,ce,de,pe;if(!g||g.length<2)return 0;const Me=((le=g[g.length-1])==null?void 0:le.close)||((ce=g[g.length-1])==null?void 0:ce.equity);let E=0;if(J==="YTD"){const te=new Date(new Date().getFullYear(),0,1).getTime();E=g.findIndex(L=>(L.t||L.date)>=te)}else if(typeof J=="number"){const te=Date.now()-J*24*60*60*1e3;E=g.findIndex(L=>(L.t||L.date)>=te)}E===-1&&(E=0);const ee=((de=g[E])==null?void 0:de.close)||((pe=g[E])==null?void 0:pe.equity);return ee>0?(Me-ee)/ee*100:0},r={"1M":30,"3M":90,"6M":180,"1Y":365,YTD:"YTD",All:9999}[S]||"YTD",a={"1M":"Perf Month","3M":"Perf Quarter","6M":"Perf Half Y","1Y":"Perf Year",YTD:"Perf YTD",All:"Perf Year"},l=((A==null?void 0:A.summary)||{})[a[S]],c=parseFloat(String(l||"").replace(/[^-0.9.]/g,"")),o=Number.isFinite(c)?c:Number.isFinite(t(H,r))?t(H,r):0,n=t(x,r)||0,s=Number.isFinite(o)?n-o:0,f=s>0,u=[];D.length>0&&u.push("active options hedging"),j.length>0&&u.push("strategic asset selection");const U=((z=Z.find(g=>g.label==="Max Drawdown"))==null?void 0:z.value)||"0%",q=Math.abs(parseFloat(U));q<12&&u.push("effective risk containment");const W=((M=Z.find(g=>g.label==="Volatility Annualized"))==null?void 0:M.value)||"0%",O=parseFloat(W),$=O>0?n/O:0;return e.jsxs(e.Fragment,{children:[e.jsxs("p",{className:"insight-copy",children:["The portfolio is ",f?"outperforming":"trailing"," the ",P," on a ",S," basis by ",Math.abs(s).toFixed(2),"%, primarily attributed to ",u.length>0?u.join(", "):"current market positioning"," and",$>1.5?" superior risk-adjusted returns":" disciplined exposure management","."]}),e.jsxs("div",{className:"insight-grid",children:[e.jsx(F,{label:"Outperformance",value:`${s>=0?"+":""}${s.toFixed(2)}%`,tone:s>=0?"positive":"negative"}),e.jsx(F,{label:"Risk-Adjusted",value:$>1.2?"Strong":$>.6?"Moderate":"Cautions",tone:$>1.2?"positive":"neutral"}),e.jsx(F,{label:"Drawdown Ctrl",value:q<10?"Tight":"Standard",tone:q<10?"positive":"neutral"}),e.jsx(F,{label:"Consistency",value:x.length>30?"High":"Developing",tone:"positive"})]})]})})()]})]}),e.jsxs("section",{className:"metrics-grid three",children:[e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Allocation by Asset Class"})}),e.jsxs("div",{className:"donut-row",children:[e.jsxs("div",{className:"donut",children:[e.jsx("span",{children:"100%"}),e.jsx("small",{children:"Total"})]}),e.jsxs("div",{className:"legend",children:[e.jsx(N,{color:"#3b82f6",label:"Equities",value:"56%"}),e.jsx(N,{color:"#14b8a6",label:"Options",value:"18%"}),e.jsx(N,{color:"#f59e0b",label:"Commodities",value:"12%"}),e.jsx(N,{color:"#8b5cf6",label:"Cash",value:"8%"}),e.jsx(N,{color:"#94a3b8",label:"Other",value:"6%"})]})]})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Top Holdings by Weight"})}),e.jsx("div",{className:"rank-list",children:ne.map(t=>e.jsxs("div",{className:"rank-row",children:[e.jsx("span",{children:t.name}),e.jsx(me,{value:t.weight}),e.jsx("strong",{children:t.weight})]},t.name))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Sector Exposure"})}),e.jsx("div",{className:"rank-list",children:we.map(t=>e.jsxs("div",{className:"rank-row",children:[e.jsx("span",{children:t.name}),e.jsx(me,{value:t.value}),e.jsx("strong",{children:t.value})]},t.name))})]})]})]}),k==="Risk"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Risk Metrics"}),e.jsx("div",{className:"table-list",children:Z.map(t=>e.jsx(ae,{label:t.label,value:t.value,tone:t.tone},t.label))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Risk Summary"}),e.jsx("p",{className:"insight-copy",children:"Risk remains moderate. Drawdown is controlled relative to benchmark, while exposure is concentrated in large-cap equities and options-linked upside."})]})]}),k==="Exposure"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Asset Class Exposure"}),e.jsxs("div",{className:"allocation-bar",children:[e.jsx("span",{style:{width:"56%",background:"#3b82f6"}}),e.jsx("span",{style:{width:"18%",background:"#14b8a6"}}),e.jsx("span",{style:{width:"12%",background:"#f59e0b"}}),e.jsx("span",{style:{width:"8%",background:"#8b5cf6"}}),e.jsx("span",{style:{width:"6%",background:"#94a3b8"}})]}),e.jsxs("div",{className:"legend wide",children:[e.jsx(N,{color:"#3b82f6",label:"Equities",value:"56%"}),e.jsx(N,{color:"#14b8a6",label:"Options",value:"18%"}),e.jsx(N,{color:"#f59e0b",label:"Commodities",value:"12%"}),e.jsx(N,{color:"#8b5cf6",label:"Cash",value:"8%"}),e.jsx(N,{color:"#94a3b8",label:"Other",value:"6%"})]})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Exposure Notes"}),e.jsxs("p",{className:"insight-copy",children:[d==="All"?"Your portfolio has its highest concentration in "+(((oe=ne[0])==null?void 0:oe.name)||"selected assets")+".":"Analyzing "+d+" segment.",j.some(t=>(t.category||"").toLowerCase()==="commodities")?" Commodities exposure provides a macro hedge, primarily driven by your metals positions.":" Currently no significant commodities hedge in this segment."]})]})]}),k==="Benchmark Comparison"&&e.jsxs("section",{className:"panel",children:[e.jsx("h2",{children:"Benchmark Comparison"}),e.jsx("div",{className:"comparison-grid",children:Se.map(([t,r,a,i])=>e.jsxs("div",{className:"comparison-card",children:[e.jsx("p",{children:t}),e.jsx(F,{label:"Portfolio",value:r,tone:"positive"}),e.jsx(F,{label:"Benchmark",value:a,tone:"neutral"}),e.jsx(F,{label:"Difference",value:i,tone:"positive"})]},t))})]}),k==="Options & Derivatives"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Options & Derivatives"}),e.jsx("div",{className:"table-list",children:ke.map(([t,r,a])=>e.jsx(ae,{label:t,value:r,note:a},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Options Insight"}),e.jsx("p",{className:"insight-copy",children:"Options exposure is moderate and tilted toward calls. Current positioning increases upside capture while introducing time decay risk from short-dated contracts."})]})]}),k==="Macro & Commodities"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Macro & Commodities"}),e.jsx("div",{className:"table-list",children:De.map(([t,r,a])=>e.jsx(ae,{label:t,value:r,note:a},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Macro Sensitivity"}),e.jsx("p",{className:"insight-copy",children:"Portfolio sensitivity is highest to rates and large-cap equity momentum. Gold exposure offsets some macro uncertainty, while oil exposure remains limited."})]})]}),k==="Key Ratios"&&e.jsxs("section",{className:"panel",children:[e.jsx("h2",{children:"Key Ratios"}),e.jsx("div",{className:"ratio-grid",children:Ne.map(([t,r])=>e.jsx(F,{label:t,value:r},t))})]})]})]})}function Q({label:m,value:b,options:y=[],onChange:v}){return e.jsxs("div",{className:"filter-wrap",style:{position:"relative"},children:[e.jsxs("button",{className:"filter",children:[e.jsx("span",{children:m}),e.jsx("strong",{children:b}),e.jsx("em",{children:"⌄"})]}),e.jsx("select",{value:b,onChange:w=>v&&v(w.target.value),style:{position:"absolute",top:0,left:0,width:"100%",height:"100%",opacity:0,cursor:"pointer",appearance:"none"},children:y.map(w=>e.jsx("option",{value:w,children:w},w))})]})}function F({label:m,value:b,tone:y="neutral"}){return e.jsxs("div",{className:"metric-small",children:[e.jsx("span",{children:m}),e.jsx("strong",{className:y,children:b})]})}function ae({label:m,value:b,note:y,tone:v="neutral"}){return e.jsxs("div",{className:"metric-line",children:[e.jsx("span",{children:m}),e.jsx("strong",{className:v,children:b}),y&&e.jsx("em",{children:y})]})}function N({color:m,label:b,value:y}){return e.jsxs("div",{className:"legend-item",children:[e.jsx("i",{style:{background:m}}),e.jsx("span",{children:b}),e.jsx("strong",{children:y})]})}const Ye=`
.metrics-shell {
  min-height: 100vh;
  width: 100%;
  overflow-x: hidden;
}

body:not(.light-theme-active) .metrics-shell {
  --bg: #000000;
  --panel: #050505;
  --panel-2: #080808;
  --border: rgba(255, 255, 255, 0.06);
  --text: #f8fafc;
  --muted: #64748b;
  --soft: #94a3b8;
  --blue: #38bdf8;
  --blue-2: #0ea5e9;
  --green: #22c55e;
  --red: #ef4444;
  --yellow: #f59e0b;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  background: var(--bg);
  color: var(--text);
}

body.light-theme-active .metrics-shell {
  --bg: #f8fafc;
  --panel: #ffffff;
  --panel-2: #f8fafc;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --soft: #334155;
  --blue: #0284c7;
  --blue-2: #2563eb;
  --green: #16a34a;
  --red: #dc2626;
  --yellow: #d97706;
  --shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
  background: var(--bg);
  color: var(--text);
}

.metrics-main {
  min-width: 0;
  width: 100%;
  padding: 0;
}

.metrics-mobile-header {
  display: none;
}

.back-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
}

.back-btn {
    background: rgba(56, 189, 248, 0.1);
    border: 1px solid rgba(56, 189, 248, 0.2);
    color: var(--blue);
    padding: 4px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
}

.metrics-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
  margin-bottom: 24px;
}

.metrics-header h1 {
  margin: 0;
  font-size: 32px;
  letter-spacing: -0.04em;
  color: var(--text);
}

.metrics-header p {
  color: var(--muted);
  margin: 0;
  font-size: 14px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.filter,
.export-btn {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 12px;
  min-height: 44px;
  min-width: 138px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
}

.filter span {
  display: block;
  font-size: 11px;
  color: var(--muted);
}

.filter strong { font-size: 13px; }
.filter em { float: right; color: var(--muted); font-style: normal; }

.export-btn {
  min-width: 90px;
  text-align: center;
  font-weight: 800;
  color: var(--blue);
}

.tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  padding-bottom: 12px;
  margin-bottom: 20px;
  scrollbar-width: none;
}

.tabs::-webkit-scrollbar { display: none; }

.tabs button {
  flex: 0 0 auto;
  border: 1px solid transparent;
  color: var(--muted);
  background: transparent;
  padding: 9px 16px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 14px;
}

.tabs button.active {
  color: var(--text);
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(56, 189, 248, 0.38);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.kpi-card, .panel, .comparison-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  min-width: 0;
}

.kpi-card p { margin: 0; color: var(--muted); font-size: 12px; }
.kpi-card strong { display: block; font-size: 25px; margin: 8px 0 2px; }
.kpi-card span { color: var(--muted); font-size: 11px; }

.positive { color: var(--green) !important; }
.negative { color: var(--red) !important; }
.neutral { color: var(--text) !important; }

.sparkline { width: 100%; height: 38px; margin-top: 12px; }
.sparkline-line { fill: none; stroke-width: 3; }
.sparkline-line.positive, .sparkline-line.neutral { stroke: var(--green); }
.sparkline-line.negative { stroke: var(--red); }

.metrics-grid { display: grid; gap: 12px; margin-bottom: 12px; }
.metrics-grid.two { grid-template-columns: 1.35fr 1fr; }
.metrics-grid.three { grid-template-columns: repeat(3, 1fr); }

.panel-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
.panel h2 { margin: 0; font-size: 18px; letter-spacing: -0.03em; color: var(--text); }

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  color: var(--blue);
  background: rgba(56, 189, 248, 0.12);
  font-size: 12px;
  font-weight: 800;
}

.chart-wrap {
  height: 270px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel-2);
  padding: 10px;
  min-width: 0;
}

.line-chart { width: 100%; height: 100%; }
.grid-line { stroke: var(--border); stroke-width: 1; }
.portfolio-line { fill: none; stroke: var(--blue); stroke-width: 4; }
.benchmark-line { fill: none; stroke: var(--muted); stroke-width: 3; stroke-dasharray: 7 7; }

.range-row {
  margin-top: 12px;
  display: flex;
  gap: 6px;
  justify-content: center;
  overflow-x: auto;
  scrollbar-width: none;
}
.range-row::-webkit-scrollbar { display: none; }
.range-row button {
  flex: 0 0 auto;
  border: 1px solid transparent;
  color: var(--muted);
  background: transparent;
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
}
.range-row button.active { color: var(--text); background: rgba(56, 189, 248, 0.18); }

.insight-copy { color: var(--soft) !important; font-size: 14px !important; line-height: 1.6; margin-bottom: 18px !important; }
.insight-grid, .ratio-grid, .comparison-grid { display: grid; gap: 12px; }
.insight-grid { grid-template-columns: repeat(2, 1fr); }
.ratio-grid { grid-template-columns: repeat(4, 1fr); }
.comparison-grid { grid-template-columns: repeat(4, 1fr); }

.metric-small, .metric-line {
  border: 1px solid var(--border);
  background: var(--panel-2);
  border-radius: 14px;
  padding: 13px;
}

.metric-small span { font-size: 12px; color: var(--muted); }
.metric-small strong { display: block; margin-top: 6px; font-size: 18px; }

.metric-line { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 12px; }
.metric-line span { color: var(--muted); font-size: 12px; }
.metric-line strong { font-size: 16px; }
.metric-line em { color: var(--muted); font-size: 12px; font-style: normal; }

.donut-row { display: grid; grid-template-columns: 160px 1fr; gap: 18px; align-items: center; }
.donut {
  width: 145px;
  aspect-ratio: 1;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle, var(--panel) 0 45%, transparent 46%),
    conic-gradient(#3b82f6 0 56%, #14b8a6 56% 74%, #f59e0b 74% 86%, #8b5cf6 86% 94%, #94a3b8 94% 100%);
  border: 1px solid var(--border);
}
.donut span { font-weight: 900; font-size: 24px; }
.donut small { display: block; color: var(--muted); margin-top: -30px; }

.legend { display: grid; gap: 9px; }
.legend.wide { grid-template-columns: repeat(5, 1fr); margin-top: 16px; }
.legend-item { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.legend-item i { width: 10px; height: 10px; border-radius: 999px; }
.legend-item strong { margin-left: auto; color: var(--text); }

.rank-list { display: grid; gap: 12px; }
.rank-row { display: grid; grid-template-columns: 1.2fr 1fr auto; gap: 12px; align-items: center; font-size: 13px; color: var(--soft); }
.rank-row strong { font-size: 12px; }
.mini-bar { height: 7px; background: rgba(148, 163, 184, 0.15); border-radius: 999px; overflow: hidden; }
.mini-bar span { display: block; height: 100%; background: linear-gradient(90deg, var(--blue), var(--green)); }

.table-list { display: grid; gap: 10px; }
.allocation-bar { height: 22px; display: flex; overflow: hidden; border-radius: 999px; border: 1px solid var(--border); background: var(--panel-2); }
.allocation-bar span { display: block; }

/* Responsive Overrides */

@media (max-width: 1400px) {
  .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .metrics-grid.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metrics-grid.three .panel:last-child { grid-column: 1 / -1; }
}

@media (max-width: 1200px) {
  .metrics-mobile-header {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 30;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(18px);
    margin: 0 0 22px 0;
    border-radius: 12px;
  }
  .metrics-mobile-header .mobile-brand { display: flex; align-items: center; gap: 10px; font-weight: 900; letter-spacing: -0.02em; }
  .metrics-mobile-header .mobile-menu-btn {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    font-size: 20px;
    cursor: pointer;
  }
  .metrics-header { flex-direction: column; align-items: stretch; }
  .header-actions { justify-content: flex-start; }
  .metrics-grid.two, .metrics-grid.three { grid-template-columns: 1fr; }
  .chart-wrap { height: 240px; }
}

@media (max-width: 900px) {
  .metrics-header h1 { font-size: 30px; }
  .header-actions { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
  .header-actions::-webkit-scrollbar { display: none; }
  .filter, .export-btn { flex: 0 0 180px; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .insight-grid, .comparison-grid, .ratio-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .donut-row { grid-template-columns: 140px minmax(0, 1fr); }
  .donut { width: 130px; }
  .rank-row { grid-template-columns: 1fr minmax(80px, 1fr) auto; }
}

@media (max-width: 720px) {
  .metrics-header { gap: 14px; margin-bottom: 12px; }
  .metrics-header h1 { font-size: 26px; }
  .metrics-header p { font-size: 13px; }
  .header-actions { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; }
  .filter, .export-btn { flex: 0 0 155px; height: 48px; }
  .tabs { margin-left: -14px; margin-right: -14px; padding-left: 14px; padding-right: 14px; }
  .tabs button { min-height: 42px; }
  .kpi-grid { grid-template-columns: 1fr; gap: 10px; }
  .kpi-card, .panel, .comparison-card { border-radius: 14px; padding: 14px; }
  .kpi-card strong { font-size: 24px; }
  .chart-wrap { height: 200px; padding: 8px; }
  .insight-grid, .comparison-grid, .ratio-grid { grid-template-columns: 1fr; }
  .donut-row { grid-template-columns: 1fr; justify-items: center; }
  .legend { width: 100%; }
  .legend.wide { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rank-row { grid-template-columns: 1fr; gap: 6px; }
  .mini-bar { width: 100%; }
  .metric-line { grid-template-columns: 1fr; gap: 6px; }
  .metric-line strong { font-size: 18px; }
}

@media (max-width: 520px) {
  .metrics-header h1 { font-size: 24px; }
  .metrics-mobile-header .mobile-brand span { display: none; }
  .filter, .export-btn { flex-basis: 145px; }
  .panel-header { flex-direction: column; gap: 8px; }
  .legend.wide { grid-template-columns: 1fr; }
  .donut { width: 120px; }
  .chart-wrap { height: 180px; }
}
`;export{qe as FullMetricsPage};
