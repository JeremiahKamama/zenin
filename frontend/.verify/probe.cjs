const { JSDOM } = require("/Users/jeremiahkamama/Desktop/Zenin/zenin/frontend/node_modules/jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
global.window = dom.window; global.document = dom.window.document; global.navigator = dom.window.navigator;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.MouseEvent = dom.window.MouseEvent; global.CustomEvent = dom.window.CustomEvent;
global.requestAnimationFrame = (cb)=>setTimeout(cb,0); global.cancelAnimationFrame=(id)=>clearTimeout(id);
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = require("react");
const { Simulate } = require("react-dom/test-utils");
global.IS_REACT_ACT_ENVIRONMENT = true;
let fired = 0;
function Btn(){ return React.createElement("button",{onClick:()=>{fired++;}}, "Hit"); }
const c = document.createElement("div"); document.body.appendChild(c);
const root = createRoot(c);
act(()=>{ root.render(React.createElement(Btn)); });
console.log("rendered?", c.textContent);
act(()=>{ Simulate.click(c.querySelector("button")); });
console.log("fired after Simulate:", fired);
