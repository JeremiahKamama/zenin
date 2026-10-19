// frontend/scripts/verify-auth-timeout-cdp.mjs
// End-to-end proof that the "stuck on Signing in..." bug is fixed.
//
// Drives the REAL built/dev app in Chrome via CDP and intercepts the sign-in
// network call, making it hang indefinitely — exactly what a Render cold start
// does. Before the fix the button stayed on "Signing in..." forever. After the
// fix the request must abort at the configured budget and surface an error.
//
// Usage: node scripts/verify-auth-timeout-cdp.mjs [appUrl] [hangSeconds]

const APP_URL = process.argv[2] || "http://localhost:5173/auth?mode=signin";
const HANG_SECONDS = Number(process.argv[3] || 120);
const CDB = process.env.ZENIN_CDP || "http://localhost:9333";
const OBSERVE_MS = Number(process.env.ZENIN_OBSERVE_MS || 96000);

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
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}

async function main() {
  const version = await (await fetch(`${CDB}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("cannot connect to Chrome CDP on 9222"));
  });

  const { targetId } = await rpc(ws, "Target.createTarget", { url: "about:blank" });
  const { sessionId } = await rpc(ws, "Target.attachToTarget", { targetId, flatten: true });

  await rpc(ws, "Page.enable", {}, sessionId);
  await rpc(ws, "Runtime.enable", {}, sessionId);
  await rpc(ws, "Fetch.enable", {
    patterns: [{ urlPattern: "*/api/auth/*", requestStage: "Request" }]
  }, sessionId);

  // Intercept and HANG every auth request (cold-start simulation).
  let intercepted = 0;
  const pending = new Set();
  ws.addEventListener("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
      intercepted += 1;
      const reqId = msg.params.requestId;
      pending.add(reqId);
      // Never continue -> request hangs like a cold-starting backend.
      console.log(`[cdp] hanging ${msg.params.request.url}`);
    }
  });

  await rpc(ws, "Page.navigate", { url: APP_URL }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  // Fill and submit the sign-in form.
  const submit = await rpc(ws, "Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const email = document.querySelector('#signin-email');
      const pass = document.querySelector('#signin-password');
      const form = document.querySelector('form');
      if (!email || !pass || !form) return { ok:false, reason:'form not found', href: location.href };
      const set = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(email, 'verify@example.com');
      set(pass, 'SomePassword123!');
      form.requestSubmit();
      return { ok:true };
    })()`
  }, sessionId);
  console.log("[cdp] submit:", JSON.stringify(submit.result?.value));

  // Watch the button text over time.
  const readButton = `(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find(x => /sign in|signing in|verify/i.test(x.textContent || ''));
    return {
      text: b ? b.textContent.trim() : null,
      disabled: b ? !!b.disabled : null,
      error: (document.querySelector('.auth-v2-error')?.textContent || '').trim() || null
    };
  })()`;

  const samples = [];
  const started = Date.now();
  let final = null;
  while (Date.now() - started < OBSERVE_MS) {
    const r = await rpc(ws, "Runtime.evaluate", { returnByValue: true, expression: readButton }, sessionId);
    const v = r.result?.value || {};
    const t = Math.round((Date.now() - started) / 1000);
    samples.push({ t, ...v });
    console.log(`[t=${t}s] button="${v.text}" disabled=${v.disabled} error=${v.error ? JSON.stringify(v.error) : "none"}`);
    final = v;
    // Stop as soon as we're demonstrably unstuck.
    if (v.text && !/signing in/i.test(v.text)) break;
    if (v.error) break;
    await new Promise((r2) => setTimeout(r2, 3000));
  }

  const stuck = /signing in/i.test(String(final?.text || ""));
  console.log("\n=== RESULT ===");
  console.log("intercepted auth requests:", intercepted);
  console.log("final button text:", JSON.stringify(final?.text));
  console.log("final error:", JSON.stringify(final?.error));
  console.log("elapsed:", Math.round((Date.now() - started) / 1000) + "s");
  console.log(stuck ? "FAIL: still stuck on 'Signing in...'" : "PASS: UI recovered out of the loading state");

  await rpc(ws, "Target.closeTarget", { targetId });
  ws.close();
  process.exit(stuck ? 1 : 0);
}

main().catch((e) => {
  console.error("ERR", e.message || e);
  process.exit(2);
});
