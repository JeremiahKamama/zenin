// backend/test/portfolioSyncOrchestrator.test.js
// Tier 2 operational sync plumbing — pure + unit-testable.
// Run: node --test test/portfolioSyncOrchestrator.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const orch = require("../portfolioSyncOrchestrator");

test("withRetry succeeds on first try", async () => {
  let calls = 0;
  const v = await orch.withRetry(async () => { calls++; return "ok"; }, { attempts: 3 });
  assert.equal(v, "ok");
  assert.equal(calls, 1);
});

test("withRetry retries then succeeds", async () => {
  let calls = 0;
  const v = await orch.withRetry(async () => {
    calls++;
    if (calls < 2) throw new Error("transient");
    return calls;
  }, { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
  assert.equal(v, 2); // succeeded on 2nd attempt
  assert.equal(calls, 2);
});

test("withRetry exhausts attempts and throws last error", async () => {
  let calls = 0;
  await assert.rejects(
    orch.withRetry(async () => { calls++; throw new Error("boom"); }, { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 }),
    /boom/
  );
  assert.equal(calls, 2);
});

test("runWithConcurrency limits parallelism and isolates failures", async () => {
  const order = [];
  const make = (id, ms, fail) => ({
    id, type: "t",
    run: () => new Promise((res, rej) => setTimeout(() => {
      order.push(id);
      if (fail) rej(new Error("fail-" + id)); else res(id);
    }, ms))
  });
  const tasks = [make("a", 20), make("b", 5, true), make("c", 10)];
  const results = await orch.runWithConcurrency(tasks, 2);
  const ok = results.filter((r) => r.ok).map((r) => r.id).sort();
  const failed = results.filter((r) => !r.ok).map((r) => r.id);
  assert.deepEqual(ok, ["a", "c"]);
  assert.deepEqual(failed, ["b"]);
  // No rejection escaped; all tasks got an outcome.
  assert.equal(results.length, 3);
});

test("orchestrateSources: one source failure never blocks others (keep-last-successful)", async () => {
  const tasks = [
    { id: "brokerage:1", type: "brokerage", run: async () => "good1" },
    { id: "wallet:hyperliquid:2", type: "wallet", run: async () => { throw new Error("auth expired"); } },
    { id: "wallet:binance:3", type: "wallet", run: async () => "good3" }
  ];
  const r = await orch.orchestrateSources(() => tasks, { concurrency: 3, attempts: 1 });
  assert.equal(r.succeeded.length, 2);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].id, "wallet:hyperliquid:2");
  assert.equal(r.triggerErrors.length, 1);
  assert.equal(r.triggerErrors[0].error, "auth expired");
});

test("coalesceWorkspaceSync collapses concurrent calls into one run", async () => {
  let runs = 0;
  const runFn = async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return "done"; };
  const [a, b, c] = await Promise.all([
    orch.coalesceWorkspaceSync(7, runFn),
    orch.coalesceWorkspaceSync(7, runFn),
    orch.coalesceWorkspaceSync(7, runFn)
  ]);
  assert.equal(a, "done");
  assert.equal(b, "done");
  assert.equal(c, "done");
  assert.equal(runs, 1, "only one underlying run executed (coalesced)");
});

test("coalesceWorkspaceSync allows a second run after the first settles", async () => {
  let runs = 0;
  const runFn = async () => { runs++; return runs; };
  await orch.coalesceWorkspaceSync(9, runFn);
  await orch.coalesceWorkspaceSync(9, runFn);
  assert.equal(runs, 2, "separate calls run separately once the first completed");
});
