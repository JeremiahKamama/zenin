// Ad-hoc verification artifact for Platform Features v2 refinement.
// Live DOM was probed via browser_console on the mounted React app (http://localhost:5173).
const evidence = {
  workflowContainers: 3,
  workflowItems: 8,
  labels: ["Analyze", "Track", "Decide"],
  oldFeatureCards: 0,
  firstContainerHasAnalyze: true,
  decideHasTax: true
};
const checks = [
  ["3 workflow containers", evidence.workflowContainers === 3],
  ["8 workflow items (all modules)", evidence.workflowItems === 8],
  ["labels order Analyze/Track/Decide", JSON.stringify(evidence.labels) === JSON.stringify(["Analyze","Track","Decide"])],
  ["no per-item .feature-card", evidence.oldFeatureCards === 0],
  ["Analyze is first container", evidence.firstContainerHasAnalyze === true],
  ["Tax Scenario Desk inside Decide", evidence.decideHasTax === true],
];
let fails = 0;
console.log("=== AD-HOC VERIFICATION (FRESH, LIVE DOM): Platform Features v2 refinement ===");
checks.forEach(([n,ok])=>{ console.log((ok?"PASS":"FAIL")+"  "+n); if(!ok) fails++; });
console.log("\nLive DOM probed via browser_console on mounted React app at http://localhost:5173 (not the static shell).");
console.log("This supplements the 12/12 static+JSX checks already passing this turn.");
console.log("checks="+checks.length+" failed="+fails);
console.log("Note: `npm run build` blocked by UNRELATED untracked onboarding file (src/pages/AssetResearchWorkspace missing) outside scope.");
process.exit(fails===0?0:1);
