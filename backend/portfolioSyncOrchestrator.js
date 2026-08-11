// backend/portfolioSyncOrchestrator.js
// Operational sync plumbing for the Unified Multi-Source Portfolio model (Tier 2).
//
// This module is PURE + UNIT-TESTABLE: it contains no DB or network calls. The
// caller (index.js) supplies `run` functions that perform the actual source
// syncs (brokerage connection, exchange wallet). The orchestrator owns:
//   * per-source failure isolation (one source failing never aborts the others)
//   * bounded parallelism (run N sources at a time)
//   * retry with backoff for transient failures
//   * workspace-level coalescing (concurrent syncs for the same workspace collapse
//     into a single in-flight run, so the 15-min timer + on-demand calls don't pile up)
//   * keep-last-successful semantics are the caller's responsibility (it only dual-
//     writes successful adapter results; this module never mutates source state)
//
// All functions are synchronous in shape except the async `run` tasks.

// Retry an async fn with bounded exponential backoff. Resolves with the value
// on success; rejects with the last error after `attempts` failures.
async function withRetry(fn, { attempts = 2, baseDelayMs = 300, maxDelayMs = 3000, signal } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal && signal.aborted) throw new Error("sync aborted");
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts) break;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Run async tasks with a concurrency limit. Each task is { id, type, run }.
// Failures are captured per-task and NEVER rejected to the caller — instead we
// return an outcome array so the orchestrator can keep last successful state.
async function runWithConcurrency(tasks, concurrency = 3) {
  const results = new Array(tasks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor++;
      const task = tasks[index];
      try {
        const value = await task.run();
        results[index] = { id: task.id, type: task.type, ok: true, value: value ?? null };
      } catch (err) {
        results[index] = {
          id: task.id,
          type: task.type,
          ok: false,
          error: String((err && err.message) || err)
        };
      }
    }
  }

  const workers = [];
  const limit = Math.max(1, Math.min(concurrency, tasks.length || 1));
  for (let i = 0; i < limit; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// Orchestrate a workspace's sources. `buildTasks` returns an array of
// { id, type, run } where `run` performs the actual sync (+ dual-write on success).
// Returns { outcomes, succeeded, failed, triggerErrors }.
// Guarantees: a single source failure never blocks others; succeeded sources are
// reported so the caller can promote their state atomically.
async function orchestrateSources(buildTasks, { concurrency = 3, attempts = 2 } = {}) {
  const tasks = Array.isArray(buildTasks) ? buildTasks : await buildTasks();
  const wrapped = tasks.map((t) => ({
    id: t.id,
    type: t.type,
    run: () => withRetry(t.run, { attempts })
  }));
  const outcomes = await runWithConcurrency(wrapped, concurrency);
  const succeeded = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);
  return {
    outcomes,
    succeeded,
    failed,
    triggerErrors: failed.map((f) => ({ sourceId: f.id, sourceType: f.type, error: f.error }))
  };
}

// Coalesce concurrent workspace syncs: if a sync for `workspaceId` is already
// in flight, return that same promise instead of starting a duplicate.
const inFlight = new Map();
function coalesceWorkspaceSync(workspaceId, runFn) {
  const existing = inFlight.get(workspaceId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await runFn();
    } finally {
      inFlight.delete(workspaceId);
    }
  })();
  inFlight.set(workspaceId, promise);
  return promise;
}

module.exports = {
  withRetry,
  runWithConcurrency,
  orchestrateSources,
  coalesceWorkspaceSync
};
