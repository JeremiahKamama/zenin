import{r as p,j as e}from"./vendor-react-DK4rgA5D.js";import{I as Fe,f as X,c as ae,a as Pe,g as Ae}from"./App-CAM8F5ks.js";import{z as Q}from"./index-uFT1LQov.js";import"./vendor-billing-n2503MW0.js";import"./useRuntimeConfig-B4pFH3wP.js";import"./Branding-DGO-6Hz0.js";import"./seo-DKmWJUEn.js";function $e({data:m,tone:h="positive"}){const y=p.useMemo(()=>{const b=Math.min(...m),V=Math.max(...m)-b||1;return m.map((P,G)=>{const k=G/(m.length-1)*120,Z=38-(P-b)/V*38;return`${k},${Z}`}).join(" ")},[m]);return e.jsx("svg",{className:"sparkline",viewBox:"0 0 120 38",preserveAspectRatio:"none",children:e.jsx("polyline",{className:`sparkline-line ${h}`,points:y})})}function ue({value:m}){const h=parseFloat(m);return e.jsx("div",{className:"mini-bar",children:e.jsx("span",{style:{width:`${Math.min(h*3,100)}%`}})})}function Ye(m,h){if(!Array.isArray(h)||!h.length||typeof document>"u")return;const y=h.map(g=>g.map(V=>`"${String(V??"").replace(/"/g,'""')}"`).join(",")).join(`
`),f=new Blob([y],{type:"text/csv;charset=utf-8"}),j=URL.createObjectURL(f),b=document.createElement("a");b.href=j,b.download=m,document.body.appendChild(b),b.click(),b.remove(),URL.revokeObjectURL(j)}function Le({onBack:m,themeMode:h,toggleTheme:y,portfolio:f=[],trades:j=[],activeOptionsTrades:b=[],accountMetrics:g=null,assets:V=[],spotPrices:P={},multiChainCache:G={}}){var ce;const[k,Z]=p.useState("Performance"),[S,ne]=p.useState("YTD"),[ie,he]=p.useState("Total Portfolio"),[M,ge]=p.useState("S&P 500"),[c,be]=p.useState("All"),[H,fe]=p.useState(null),[B,ve]=p.useState({}),[K,ye]=p.useState([]),[A,je]=p.useState(null);p.useEffect(()=>{const t=async()=>{try{const a=await Q("/macro-indicators?country=USA");if(a.ok){const n=await a.json();fe(n)}}catch(a){console.error("Macro Fetch Error:",a)}},r=async()=>{const a=["UST10Y","XAU","WTI","DXY"],n={};await Promise.all(a.map(async l=>{try{const d=await Q(`/prices?symbol=${l}`);if(d.ok){const o=await d.json();n[l]=o}}catch(d){console.error(`Price Fetch Error (${l}):`,d)}})),ve(n)};t(),r()},[]),p.useEffect(()=>{const t=async()=>{const a={"S&P 500":{symbol:"SPY",type:"stock"},"Bloomberg U.S. Aggregate Bond Index":{symbol:"AGG",type:"stock"},SOFR:{symbol:"BIL",type:"stock"},"S&P GSCI":{symbol:"GSG",type:"stock"},"MSCI U.S. REIT Index":{symbol:"VNQ",type:"stock"},Bitcoin:{symbol:"BTC-USD",type:"crypto"}},{symbol:n,type:l}=a[M]||{symbol:"SPY",type:"stock"};try{const d=await Q(`/history?symbol=${n}&type=${l}&interval=1D`);if(d.ok){const o=await d.json();ye(o.history||[])}}catch(d){console.error("Benchmark History Fetch Error:",d)}},r=async()=>{const n={"S&P 500":"SPY","Bloomberg U.S. Aggregate Bond Index":"AGG",SOFR:"BIL","S&P GSCI":"GSG","MSCI U.S. REIT Index":"VNQ",Bitcoin:"BTCUSD"}[M]||"SPY";try{const l=await Q(`/finviz?symbol=${n}`);if(l.ok){const d=await l.json();je(d)}}catch(l){console.error("Benchmark Finviz Fetch Error:",l)}};t(),r()},[M]);const N=p.useMemo(()=>c==="All"?f:f.filter(t=>{const r=(t.type||"").toLowerCase(),a=(t.category||"").toLowerCase();return c==="Equities"?r==="equity"||r==="stock":c==="Bonds"?r==="bond"||a==="bonds":c==="Crypto"?r==="crypto"||r==="stablecoin":c==="Commodities"?a==="commodities"||a==="metals":c==="Real Estate"?a==="real estate":!0}),[f,c]),R=p.useMemo(()=>c==="All"?j:j.filter(t=>{const r=(t.type||"").toLowerCase();return c==="Equities"?r==="equity"||r==="stock":c==="Bonds"?r==="bond":c==="Crypto"?r==="crypto":!0}),[j,c]),C=Number(g==null?void 0:g.initialBalance)||Fe,$=Number(g==null?void 0:g.totalAccountEquity)||C,I=p.useMemo(()=>c==="All"?$:c==="Cash/Money Market"?Number(g==null?void 0:g.availableBalance)||0:N.reduce((t,r)=>t+(Number(r.price)||0)*(Number(r.quantity)||0),0),[c,N,$,g]),x=Array.isArray(g==null?void 0:g.tradeTimeline)?g.tradeTimeline:[],oe=p.useMemo(()=>{const t=C>0?(I-C)/C*100:0,r=R.length>0?R.filter(a=>(Number(a.pnl)||0)>0).length/R.length*100:0;return[{label:`${c==="All"?"Total":c} Return`,value:`${t>=0?"+":""}${t.toFixed(2)}%`,sub:`vs ${M} +8.21%`,tone:t>=0?"positive":"negative",data:x.slice(-12).map(a=>a.equity)||[8,12,10,16,18,22,20,28,31,29,36,41]},{label:`${c==="All"?"Account":c} Value`,value:X(I,"USD",{compact:!0}),sub:c==="All"?`Initial: ${X(C,"USD",{compact:!0})}`:"Allocated Assets",tone:"neutral",data:x.slice(-12).map(a=>a.equity)||[11,10,14,13,17,22,19,24,27,31,33,37]},{label:"Win Rate",value:`${r.toFixed(1)}%`,sub:`${R.length} Segment Trades`,tone:r>=50?"positive":"neutral",data:[10,12,14,16,13,18,21,23,20,25,28,31]},{label:"Positions",value:N.length.toString(),sub:`${b.length} Options active`,tone:"neutral",data:[5,7,8,6,11,10,13,16,15,18,20,22]}]},[C,I,x,R,N,b,c,M]),le=p.useMemo(()=>{const t=N.reduce((r,a)=>r+ae((Number(a.price)||0)*(Number(a.quantity)||0),a.currency||a.quotedCurrency||"USD",P),0);return N.map(r=>({name:r.name||r.symbol,weight:t>0?`${(ae((Number(r.price)||0)*(Number(r.quantity)||0),r.currency||r.quotedCurrency||"USD",P)/t*100).toFixed(2)}%`:"0%"})).sort((r,a)=>parseFloat(a.weight)-parseFloat(r.weight)).slice(0,5)},[N]),we=p.useMemo(()=>{const t={};let r=0;return N.forEach(a=>{const n=(Number(a.price)||0)*(Number(a.quantity)||0);r+=n;const l=a.theme||a.sector||"Other";t[l]=(t[l]||0)+n}),Object.entries(t).map(([a,n])=>({name:a,value:r>0?`${(n/r*100).toFixed(1)}%`:"0%"})).sort((a,n)=>parseFloat(n.value)-parseFloat(a.value))},[N]),ke=p.useMemo(()=>{let t=0,r=0,a=0;return b.forEach(n=>{const l=G[n.asset],d=P[n.asset],o=Pe(n,l,d);t+=Number(o.pnl)||0,r+=Number(o.delta)||0,a+=Number(o.theta)||0}),[["Options P&L",X(t,"USD",{sign:!0}),"Unrealized"],["Open Strategies",b.length.toString(),"Active positions"],["Portfolio Delta",`${r>=0?"+":""}${r.toFixed(3)}`,"Options Exposure"],["Theta Decay",`-${X(Math.abs(a),"USD")}`,"Daily Decay"]]},[b,G,P]),Ne=p.useMemo(()=>[["Positions",f.length.toString()],["Cash Weight",`${((1-f.reduce((t,r)=>t+ae((Number(r.price)||0)*(Number(r.quantity)||0),r.currency||r.quotedCurrency||"USD",P),0)/$)*100).toFixed(1)}%`],["Beta","0.92"],["ROE","16.24%"]],[f,$]),Se=p.useMemo(()=>{var n,l,d;const t=(l=(n=H==null?void 0:H.metrics)==null?void 0:n.find(o=>o.key==="interest_rate"))==null?void 0:l.current,r=(o,i="—")=>{const s=B[o];if(!s||!s.price)return i;const w=(s==null?void 0:s.currency)||(s==null?void 0:s.quotedCurrency)||"USD",u=Ae(w);return o==="UST10Y"||o==="FED"?`${Number(s.price).toFixed(2)}%`:`${u}${Number(s.price).toLocaleString()}`},a=o=>{const i=B[o];if(!i||!i.priceChangePercent)return"—";const s=Number(i.priceChangePercent);return`${s>=0?"+":""}${s.toFixed(2)}%`};return[["US 10Y Yield",r("UST10Y","Loading..."),a("UST10Y")],["DXY Index",(d=B.DXY)!=null&&d.price?Number(B.DXY.price).toFixed(2):"Loading...",a("DXY")],["Gold Spot",r("XAU","Loading..."),a("XAU")],["WTI Crude",r("WTI","Loading..."),a("WTI")],["Fed Funds Rate",t?`${t}%`:"—","Target Range"]]},[H,B]),J=p.useMemo(()=>{let t=C,r=0;const a=[];x.forEach((i,s)=>{i.equity>t&&(t=i.equity);const w=t>0?(t-i.equity)/t:0;if(w>r&&(r=w),s>0){const u=x[s-1].equity;u>0&&a.push((i.equity-u)/u)}});const n=a.length>0?a.reduce((i,s)=>i+s,0)/a.length:0,l=a.length>1?a.reduce((i,s)=>i+Math.pow(s-n,2),0)/(a.length-1):0,d=Math.sqrt(l),o=d*Math.sqrt(252);return[{label:"Max Drawdown",value:`-${(r*100).toFixed(2)}%`,tone:"negative"},{label:"Volatility Annualized",value:o>0?`${(o*100).toFixed(2)}%`:"—",tone:"neutral"},{label:"Value at Risk 95%",value:o>0?`-${(d*1.645*100).toFixed(2)}%`:"—",tone:"negative"},{label:"Beta vs S&P 500",value:"—",tone:"neutral"},{label:"Portfolio Exposure",value:`${(I/$*100).toFixed(1)}%`,tone:"neutral"}]},[x,C,I,$]),De=p.useMemo(()=>{const t=(A==null?void 0:A.summary)||{},r=(i,s)=>{var q,W,O,Y;if(!i||i.length<2)return 0;const w=((q=i[i.length-1])==null?void 0:q.close)||((W=i[i.length-1])==null?void 0:W.equity);let u=0;if(s==="YTD"){const z=new Date(new Date().getFullYear(),0,1).getTime();u=i.findIndex(T=>(T.t||T.date)>=z)}else if(typeof s=="number"){const z=Date.now()-s*24*60*60*1e3;u=i.findIndex(T=>(T.t||T.date)>=z)}u===-1&&(u=0);const U=((O=i[u])==null?void 0:O.close)||((Y=i[u])==null?void 0:Y.equity);return U>0?(w-U)/U*100:0},a=(i,s)=>{const w=t[i];return w?parseFloat(String(w).replace(/[^-0.9.]/g,"")):r(K,s)},n={"1M":30,"3M":90,"6M":180,"1Y":365,YTD:"YTD",All:9999}[S]||"YTD",l=r(x,n),o=a({"1M":"Perf Month","3M":"Perf Quarter","6M":"Perf Half Y","1Y":"Perf Year",YTD:"Perf YTD",All:"Perf Year"}[S],n);return[[S,`${l.toFixed(2)}%`,`${o.toFixed(2)}%`,`${(l-o).toFixed(2)}%`],["1M",`${r(x,30).toFixed(2)}%`,`${a("Perf Month",30).toFixed(2)}%`,`${(r(x,30)-a("Perf Month",30)).toFixed(2)}%`],["3M",`${r(x,90).toFixed(2)}%`,`${a("Perf Quarter",90).toFixed(2)}%`,`${(r(x,90)-a("Perf Quarter",90)).toFixed(2)}%`],["YTD",`${r(x,"YTD").toFixed(2)}%`,`${a("Perf YTD","YTD").toFixed(2)}%`,`${(r(x,"YTD")-a("Perf YTD","YTD")).toFixed(2)}%`]]},[x,K,A,S]),Ce=["Performance","Risk","Exposure","Benchmark Comparison","Options & Derivatives","Macro & Commodities","Key Ratios"],Me=()=>{const t=[["Tab",k],["Timeframe",S],["Scope",ie],["Benchmark",M],["Asset Class",c],[],["KPI","Value","Context"],...oe.map(r=>[r.label,r.value,r.sub])];Ye(`full-metrics-${k.toLowerCase().replace(/[^a-z0-9]+/g,"-")}-${new Date().toISOString().slice(0,10)}.csv`,t)};return e.jsxs("div",{className:"metrics-shell active-zenin-metrics",children:[e.jsx("style",{children:qe}),e.jsxs("div",{className:"metrics-mobile-header",children:[e.jsxs("div",{className:"mobile-brand",children:[e.jsx("div",{className:"brand-mark",children:"Z"}),e.jsxs("span",{children:[e.jsx("strong",{children:"ZENIN"})," CAPITAL"]})]}),e.jsx("button",{className:"mobile-menu-btn",onClick:m,children:e.jsxs("svg",{width:"24",height:"24",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("line",{x1:"3",y1:"12",x2:"21",y2:"12"}),e.jsx("line",{x1:"3",y1:"6",x2:"21",y2:"6"}),e.jsx("line",{x1:"3",y1:"18",x2:"21",y2:"18"})]})})]}),e.jsxs("main",{className:"metrics-main",children:[e.jsxs("header",{className:"metrics-header",children:[e.jsxs("div",{className:"header-titles",children:[e.jsxs("div",{className:"back-row",children:[e.jsx("button",{onClick:m,className:"back-btn",children:"← Back"}),e.jsx("h1",{children:"Key Metrics"})]}),e.jsx("p",{children:"Comprehensive performance, risk, and exposure analytics."})]}),e.jsxs("div",{className:"header-actions",children:[e.jsx(_,{label:"Timeframe",value:S,options:["YTD","1M","3M","6M","1Y","All"],onChange:ne}),e.jsx(_,{label:"Scope",value:ie,options:["Total Portfolio","Equities","Bonds","Cash/Money Market","Commodities","Real Estate","Crypto"],onChange:he}),e.jsx(_,{label:"Benchmark",value:M,options:["S&P 500","Bloomberg U.S. Aggregate Bond Index","SOFR","S&P GSCI","MSCI U.S. REIT Index","Bitcoin"],onChange:ge}),e.jsx(_,{label:"Asset Class",value:c,options:["All","Equities","Bonds","Cash/Money Market","Commodities","Real Estate","Crypto"],onChange:be}),e.jsx("button",{className:"export-btn",onClick:Me,children:"Export"})]})]}),e.jsx("section",{className:"tabs",children:Ce.map(t=>e.jsx("button",{className:k===t?"active":"",onClick:()=>Z(t),children:t},t))}),k==="Performance"&&e.jsxs(e.Fragment,{children:[e.jsx("section",{className:"kpi-grid",children:oe.map(t=>e.jsxs("article",{className:"kpi-card",children:[e.jsx("p",{children:t.label}),e.jsx("strong",{className:t.tone,children:t.value}),e.jsx("span",{children:t.sub}),e.jsx($e,{data:t.data,tone:t.tone})]},t.label))}),e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel large",children:[e.jsxs("div",{className:"panel-header",children:[e.jsxs("div",{children:[e.jsx("h2",{children:"Performance Over Time"}),e.jsx("p",{children:"Portfolio vs benchmark total return."})]}),e.jsx("span",{className:"pill",children:"YTD"})]}),e.jsx("div",{className:"chart-wrap",children:e.jsxs("svg",{viewBox:"0 0 700 260",className:"line-chart",preserveAspectRatio:"none",children:[e.jsx("defs",{children:e.jsxs("linearGradient",{id:"blueArea",x1:"0",x2:"0",y1:"0",y2:"1",children:[e.jsx("stop",{offset:"0%",stopColor:"var(--blue)",stopOpacity:"0.35"}),e.jsx("stop",{offset:"100%",stopColor:"var(--blue)",stopOpacity:"0"})]})}),[40,90,140,190,240].map(t=>e.jsx("line",{x1:"0",y1:t,x2:"700",y2:t,className:"grid-line"},t)),(()=>{const t=x.length>1?x:[{t:Date.now()-864e5,equity:C},{t:Date.now(),equity:$}],r=Math.min(...t.map(o=>o.equity))*.95,n=Math.max(...t.map(o=>o.equity))*1.05-r||1,l=t.map((o,i)=>{const s=i/(t.length-1)*700,w=260-(o.equity-r)/n*220-20;return`${s},${w}`}).join(" "),d=`0,260 ${l} 700,260`;return e.jsxs(e.Fragment,{children:[e.jsx("polyline",{className:"portfolio-line",points:l}),e.jsx("polygon",{fill:"url(#blueArea)",points:d})]})})()]})}),e.jsx("div",{className:"range-row",children:["1M","3M","6M","YTD","1Y","All"].map(t=>e.jsx("button",{className:S===t?"active":"",onClick:()=>ne(t),children:t},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsxs("div",{children:[e.jsx("h2",{children:"Summary Insight"}),e.jsx("p",{children:"Portfolio performance explanation."})]})}),(()=>{var z,T;const t=(v,ee)=>{var de,pe,me,xe;if(!v||v.length<2)return 0;const Te=((de=v[v.length-1])==null?void 0:de.close)||((pe=v[v.length-1])==null?void 0:pe.equity);let E=0;if(ee==="YTD"){const re=new Date(new Date().getFullYear(),0,1).getTime();E=v.findIndex(L=>(L.t||L.date)>=re)}else if(typeof ee=="number"){const re=Date.now()-ee*24*60*60*1e3;E=v.findIndex(L=>(L.t||L.date)>=re)}E===-1&&(E=0);const te=((me=v[E])==null?void 0:me.close)||((xe=v[E])==null?void 0:xe.equity);return te>0?(Te-te)/te*100:0},r={"1M":30,"3M":90,"6M":180,"1Y":365,YTD:"YTD",All:9999}[S]||"YTD",a={"1M":"Perf Month","3M":"Perf Quarter","6M":"Perf Half Y","1Y":"Perf Year",YTD:"Perf YTD",All:"Perf Year"},l=((A==null?void 0:A.summary)||{})[a[S]],d=parseFloat(String(l||"").replace(/[^-0.9.]/g,"")),o=Number.isFinite(d)?d:Number.isFinite(t(K,r))?t(K,r):0,i=t(x,r)||0,s=Number.isFinite(o)?i-o:0,w=s>0,u=[];b.length>0&&u.push("active options hedging"),N.length>0&&u.push("strategic asset selection");const U=((z=J.find(v=>v.label==="Max Drawdown"))==null?void 0:z.value)||"0%",q=Math.abs(parseFloat(U));q<12&&u.push("effective risk containment");const W=((T=J.find(v=>v.label==="Volatility Annualized"))==null?void 0:T.value)||"0%",O=parseFloat(W),Y=O>0?i/O:0;return e.jsxs(e.Fragment,{children:[e.jsxs("p",{className:"insight-copy",children:["The portfolio is ",w?"outperforming":"trailing"," the ",M," on a ",S," basis by ",Math.abs(s).toFixed(2),"%, primarily attributed to ",u.length>0?u.join(", "):"current market positioning"," and",Y>1.5?" superior risk-adjusted returns":" disciplined exposure management","."]}),e.jsxs("div",{className:"insight-grid",children:[e.jsx(F,{label:"Outperformance",value:`${s>=0?"+":""}${s.toFixed(2)}%`,tone:s>=0?"positive":"negative"}),e.jsx(F,{label:"Risk-Adjusted",value:Y>1.2?"Strong":Y>.6?"Moderate":"Cautions",tone:Y>1.2?"positive":"neutral"}),e.jsx(F,{label:"Drawdown Ctrl",value:q<10?"Tight":"Standard",tone:q<10?"positive":"neutral"}),e.jsx(F,{label:"Consistency",value:x.length>30?"High":"Developing",tone:"positive"})]})]})})()]})]}),e.jsxs("section",{className:"metrics-grid three",children:[e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Allocation by Asset Class"})}),e.jsxs("div",{className:"donut-row",children:[e.jsxs("div",{className:"donut",children:[e.jsx("span",{children:"100%"}),e.jsx("small",{children:"Total"})]}),e.jsxs("div",{className:"legend",children:[e.jsx(D,{color:"#3b82f6",label:"Equities",value:"56%"}),e.jsx(D,{color:"#14b8a6",label:"Options",value:"18%"}),e.jsx(D,{color:"#f59e0b",label:"Commodities",value:"12%"}),e.jsx(D,{color:"#8b5cf6",label:"Cash",value:"8%"}),e.jsx(D,{color:"#94a3b8",label:"Other",value:"6%"})]})]})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Top Holdings by Weight"})}),e.jsx("div",{className:"rank-list",children:le.map(t=>e.jsxs("div",{className:"rank-row",children:[e.jsx("span",{children:t.name}),e.jsx(ue,{value:t.weight}),e.jsx("strong",{children:t.weight})]},t.name))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("div",{className:"panel-header",children:e.jsx("h2",{children:"Sector Exposure"})}),e.jsx("div",{className:"rank-list",children:we.map(t=>e.jsxs("div",{className:"rank-row",children:[e.jsx("span",{children:t.name}),e.jsx(ue,{value:t.value}),e.jsx("strong",{children:t.value})]},t.name))})]})]})]}),k==="Risk"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Risk Metrics"}),e.jsx("div",{className:"table-list",children:J.map(t=>e.jsx(se,{label:t.label,value:t.value,tone:t.tone},t.label))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Risk Summary"}),e.jsx("p",{className:"insight-copy",children:"Risk remains moderate. Drawdown is controlled relative to benchmark, while exposure is concentrated in large-cap equities and options-linked upside."})]})]}),k==="Exposure"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Asset Class Exposure"}),e.jsxs("div",{className:"allocation-bar",children:[e.jsx("span",{style:{width:"56%",background:"#3b82f6"}}),e.jsx("span",{style:{width:"18%",background:"#14b8a6"}}),e.jsx("span",{style:{width:"12%",background:"#f59e0b"}}),e.jsx("span",{style:{width:"8%",background:"#8b5cf6"}}),e.jsx("span",{style:{width:"6%",background:"#94a3b8"}})]}),e.jsxs("div",{className:"legend wide",children:[e.jsx(D,{color:"#3b82f6",label:"Equities",value:"56%"}),e.jsx(D,{color:"#14b8a6",label:"Options",value:"18%"}),e.jsx(D,{color:"#f59e0b",label:"Commodities",value:"12%"}),e.jsx(D,{color:"#8b5cf6",label:"Cash",value:"8%"}),e.jsx(D,{color:"#94a3b8",label:"Other",value:"6%"})]})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Exposure Notes"}),e.jsxs("p",{className:"insight-copy",children:[c==="All"?"Your portfolio has its highest concentration in "+(((ce=le[0])==null?void 0:ce.name)||"selected assets")+".":"Analyzing "+c+" segment.",N.some(t=>(t.category||"").toLowerCase()==="commodities")?" Commodities exposure provides a macro hedge, primarily driven by your metals positions.":" Currently no significant commodities hedge in this segment."]})]})]}),k==="Benchmark Comparison"&&e.jsxs("section",{className:"panel",children:[e.jsx("h2",{children:"Benchmark Comparison"}),e.jsx("div",{className:"comparison-grid",children:De.map(([t,r,a,n])=>e.jsxs("div",{className:"comparison-card",children:[e.jsx("p",{children:t}),e.jsx(F,{label:"Portfolio",value:r,tone:"positive"}),e.jsx(F,{label:"Benchmark",value:a,tone:"neutral"}),e.jsx(F,{label:"Difference",value:n,tone:"positive"})]},t))})]}),k==="Options & Derivatives"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Options & Derivatives"}),e.jsx("div",{className:"table-list",children:ke.map(([t,r,a])=>e.jsx(se,{label:t,value:r,note:a},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Options Insight"}),e.jsx("p",{className:"insight-copy",children:"Options exposure is moderate and tilted toward calls. Current positioning increases upside capture while introducing time decay risk from short-dated contracts."})]})]}),k==="Macro & Commodities"&&e.jsxs("section",{className:"metrics-grid two",children:[e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Macro & Commodities"}),e.jsx("div",{className:"table-list",children:Se.map(([t,r,a])=>e.jsx(se,{label:t,value:r,note:a},t))})]}),e.jsxs("article",{className:"panel",children:[e.jsx("h2",{children:"Macro Sensitivity"}),e.jsx("p",{className:"insight-copy",children:"Portfolio sensitivity is highest to rates and large-cap equity momentum. Gold exposure offsets some macro uncertainty, while oil exposure remains limited."})]})]}),k==="Key Ratios"&&e.jsxs("section",{className:"panel",children:[e.jsx("h2",{children:"Key Ratios"}),e.jsx("div",{className:"ratio-grid",children:Ne.map(([t,r])=>e.jsx(F,{label:t,value:r},t))})]})]})]})}function _({label:m,value:h,options:y=[],onChange:f}){return e.jsxs("div",{className:"filter-wrap",style:{position:"relative"},children:[e.jsxs("button",{className:"filter",children:[e.jsx("span",{children:m}),e.jsx("strong",{children:h}),e.jsx("em",{children:"⌄"})]}),e.jsx("select",{value:h,onChange:j=>f&&f(j.target.value),style:{position:"absolute",top:0,left:0,width:"100%",height:"100%",opacity:0,cursor:"pointer",appearance:"none"},children:y.map(j=>e.jsx("option",{value:j,children:j},j))})]})}function F({label:m,value:h,tone:y="neutral"}){return e.jsxs("div",{className:"metric-small",children:[e.jsx("span",{children:m}),e.jsx("strong",{className:y,children:h})]})}function se({label:m,value:h,note:y,tone:f="neutral"}){return e.jsxs("div",{className:"metric-line",children:[e.jsx("span",{children:m}),e.jsx("strong",{className:f,children:h}),y&&e.jsx("em",{children:y})]})}function D({color:m,label:h,value:y}){return e.jsxs("div",{className:"legend-item",children:[e.jsx("i",{style:{background:m}}),e.jsx("span",{children:h}),e.jsx("strong",{children:y})]})}const qe=`
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
`;export{Le as FullMetricsPage};
