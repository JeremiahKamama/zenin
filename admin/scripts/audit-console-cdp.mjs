// admin/scripts/audit-console-cdp.mjs
//
// Drives the REAL admin console in Chrome via CDP and reports what an operator
// would actually experience.
//
// This exists because API-level testing is not sufficient evidence that the
// console WORKS. A route can return 200 while the UI renders nothing, throws,
// or leaves a control dead — exactly the class of bug reported as "I can't
// upgrade a user's plan" while every endpoint looked healthy.
//
// Usage:
//   node scripts/audit-console-cdp.mjs [consoleUrl]
//
// Requires Chrome started with --remote-debugging-port=9333.

const CONSOLE_URL = process.argv[2] || "https://admin.zenin.capital/";
const CDB = process.env.ZENIN_CDP || "http://localhost:9333";
const OBSERVE_MS = Number(process.env.ZENIN_OBSERVE_MS || 25000);

function rpc(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`timeout ${method}`));
    }, 30000);
    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data.toString()); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener("message", handler);
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const version = await (await fetch(`${CDB}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true });

  const consoleErrors = [];
  const networkFailures = [];
  const requests = [];

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data.toString()); } catch { return; }
    if (msg.sessionId !== sessionId) return;

    if (msg.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(msg.params?.type)) {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.preview?.description ?? "")
        .join(" ")
        .slice(0, 300);
      if (text) consoleErrors.push({ type: msg.params.type, text });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      consoleErrors.push({
        type: "exception",
        text: String(d?.exception?.description || d?.text || "").slice(0, 300)
      });
    }
    if (msg.method === "Network.requestWillBeSent") {
      requests.push({ url: msg.params.request.url, method: msg.params.request.method });
    }
    if (msg.method === "Network.responseReceived") {
      const { response } = msg.params;
      if (response.status >= 400) {
        networkFailures.push({ url: response.url, status: response.status });
      }
    }
    if (msg.method === "Network.loadingFailed") {
      networkFailures.push({ url: "(failed)", status: 0, error: msg.params.errorText });
    }
  });

  await rpc(ws, "Page.enable", {}, sessionId);
  await rpc(ws, "Runtime.enable", {}, sessionId);
  await rpc(ws, "Network.enable", {}, sessionId);

  console.log(`Opening ${CONSOLE_URL}\n`);
  await rpc(ws, "Page.navigate", { url: CONSOLE_URL }, sessionId);
  await sleep(OBSERVE_MS);

  const evaluate = async (expression) => {
    const res = await rpc(ws, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
    if (res.exceptionDetails) {
      return { error: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
    }
    return { value: res.result?.value };
  };

  // What did the operator actually get rendered?
  const probe = await evaluate(`(() => {
    const text = document.body ? document.body.innerText : "";
    const buttons = Array.from(document.querySelectorAll("button")).map(b => (b.innerText || "").trim()).filter(Boolean);
    const inputs = Array.from(document.querySelectorAll("input,select,textarea")).map(i => ({
      tag: i.tagName.toLowerCase(),
      type: i.type || null,
      name: i.name || i.id || null,
      placeholder: i.placeholder || null
    }));
    const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map(h => (h.innerText||"").trim()).filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      textLength: text.length,
      textHead: text.slice(0, 600),
      buttons: buttons.slice(0, 40),
      headings: headings.slice(0, 20),
      inputCount: inputs.length,
      inputs: inputs.slice(0, 20),
      hasRoot: Boolean(document.getElementById("root")),
      rootChildren: document.getElementById("root")?.children?.length ?? 0
    };
  })()`);

  console.log("=== RENDERED STATE ===");
  console.log(JSON.stringify(probe.value ?? probe.error, null, 2));

  const failedAssets = networkFailures.filter((f) => /\.(js|css)(\?|$)/.test(f.url));
  const failedApi = networkFailures.filter((f) => f.url.includes("/api/"));

  console.log("\n=== FAILED ASSETS (would block the app) ===");
  console.log(failedAssets.length ? JSON.stringify(failedAssets, null, 2) : "none");

  console.log("\n=== FAILED API CALLS ===");
  console.log(failedApi.length ? JSON.stringify(failedApi, null, 2) : "none");

  console.log("\n=== CONSOLE ERRORS/WARNINGS ===");
  const seen = new Set();
  const unique = consoleErrors.filter((e) => {
    const k = e.text.slice(0, 120);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  console.log(unique.length ? JSON.stringify(unique.slice(0, 20), null, 2) : "none");

  console.log(`\n=== SUMMARY ===`);
  console.log(`  requests:        ${requests.length}`);
  console.log(`  failed assets:   ${failedAssets.length}`);
  console.log(`  failed API:      ${failedApi.length}`);
  console.log(`  unique errors:   ${unique.length}`);
  console.log(`  rendered chars:  ${probe.value?.textLength ?? "n/a"}`);
  console.log(`  interactive:     ${probe.value?.buttons?.length ?? 0} buttons, ${probe.value?.inputCount ?? 0} inputs`);

  ws.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("audit failed:", err.message);
  process.exit(1);
});
