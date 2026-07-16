// journalEvents.integration.test.js — Phase 1 + 2 DB-backed verification.
// Boots the real server (which runs schema init incl. journal_events /
// journal_reminder_tasks and starts the reminder scheduler), then exercises
// detection, classification, dedupe, workspace isolation, reminder-task
// creation, and the claim-safe scheduler against Postgres.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.PORT = process.env.PORT || "4110";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
process.env.EXPECTED_ORIGIN = process.env.EXPECTED_ORIGIN || process.env.FRONTEND_URL;

const { startServer, stopServer } = require("../../index");
const db = require("../../database");
const { processDueReminders, stopJournalReminderScheduler } = require("../../journalReminderWorker");
const journalEvents = db.userWorkspace.journalEvents;
const journalReminders = db.userWorkspace.journalReminders;

let ready = false;
let startError = null;

// Guest user (id=1) is seeded by schema init; its active workspace resolves
// when workspaceId is null. We resolve it once for stable assertions.
let wsId = null;

test.before(async () => {
  try {
    await startServer();
    ready = true;
    // Stop the live scheduler so reminder processing is driven deterministically
    // by the tests (avoid cross-test contamination of notification counts).
    stopJournalReminderScheduler();
    const res = await db.pool.query(
      "SELECT active_workspace_id FROM app_users WHERE id = 1"
    );
    wsId = res.rows[0] && res.rows[0].active_workspace_id;
  } catch (e) {
    startError = e;
  }
});

test.after(async () => {
  if (ready) await stopServer();
});

test("server + schema (with journal_events tables) initialize", () => {
  assert.ok(ready, `startServer failed: ${startError && startError.message}`);
  assert.ok(wsId, "guest active workspace resolved");
});

test("detectOrRefresh dedupes on (workspace_id, event_key) — one event for repeated sync", async () => {
  const raw = {
    source: "zenin_execution",
    eventType: "execution",
    clientId: `je-test-dedupe-${Date.now()}`,
    symbol: "VOO",
    side: "buy",
    quantity: 10,
    price: 100,
    notional: 1000,
  };
  const first = await journalEvents.detectOrRefresh(1, raw, wsId);
  const second = await journalEvents.detectOrRefresh(1, raw, wsId);
  assert.strictEqual(first.id, second.id, "same event_key yields same row");
  const listed = await journalEvents.list(1, { symbol: "VOO" }, wsId);
  const matching = listed.filter((e) => e.eventKey === first.eventKey);
  assert.strictEqual(matching.length, 1, "exactly one deduplicated event persisted");
});

test("execution is classified decision_relevant; transfer is operational", async () => {
  const exec = await journalEvents.detectOrRefresh(1, {
    source: "zenin_execution",
    eventType: "execution",
    clientId: `je-test-exec-${Date.now()}`,
    symbol: "SPY",
    quantity: 5,
    price: 500,
    notional: 2500,
  }, wsId);
  assert.strictEqual(exec.classification, "decision_relevant");

  const xfer = await journalEvents.detectOrRefresh(1, {
    source: "broker_sync",
    eventType: "transfer",
    clientId: `je-test-xfer-${Date.now()}`,
    symbol: "SPY",
    quantity: 0,
    notional: 0,
  }, wsId);
  assert.strictEqual(xfer.classification, "operational", "transfer must not create a thesis reminder trigger");
});

test("assignment / expiry are decision_relevant", async () => {
  for (const type of ["assignment", "expiry"]) {
    const ev = await journalEvents.detectOrRefresh(1, {
      source: "broker_sync",
      eventType: type,
      clientId: `je-test-${type}-${Date.now()}`,
      symbol: "AAPL",
      positionDelta: 100,
    }, wsId);
    assert.strictEqual(ev.classification, "decision_relevant", `${type} should be decision_relevant`);
  }
});

test("workspace isolation — event in one workspace is not visible from another", async () => {
  const clientId = `je-test-iso-${Date.now()}`;
  await journalEvents.detectOrRefresh(1, {
    source: "zenin_execution",
    eventType: "execution",
    clientId,
    symbol: "QQQ",
    quantity: 1,
    price: 400,
    notional: 400,
  }, wsId);
  // A different (non-active) workspace id must not see the event.
  const otherWs = wsId + 9999;
  const listed = await journalEvents.list(1, { symbol: "QQQ" }, otherWs);
  assert.strictEqual(listed.length, 0, "no cross-workspace leakage");
});

test("state transitions: classify / dismiss / link update status correctly", async () => {
  const ev = await journalEvents.detectOrRefresh(1, {
    source: "zenin_execution",
    eventType: "execution",
    clientId: `je-test-state-${Date.now()}`,
    symbol: "IWM",
    quantity: 2,
    price: 200,
    notional: 400,
  }, wsId);
  const dismissed = await journalEvents.dismiss(1, ev.id, wsId);
  assert.strictEqual(dismissed.status, "dismissed");

  const linked = await journalEvents.link(1, ev.id, { journalEntryId: "journal-test-1" }, wsId);
  assert.strictEqual(linked.status, "journaled");
  assert.strictEqual(linked.journalEntryId, "journal-test-1");
});

// ── Phase 2: reminder tasks ───────────────────────────────────────────────
test("decision event creates initial + 24h follow_up reminder tasks", async () => {
  const clientId = `je-rem-${Date.now()}`;
  // Go through the real trade pipeline (trades.add) which fires the detection hook.
  await db.userWorkspace.trades.add(1, {
    clientId,
    asset: "AMD",
    type: "BUY",
    side: "buy",
    marketType: "spot",
    quantity: 3,
    price: 100,
    notional: 300,
    platform: "zenin",
    fee: 0,
    feeCurrency: "USD",
    status: "Filled",
  }, wsId);
  const events = await journalEvents.list(1, { symbol: "AMD" }, wsId);
  const ev = events.find((e) => e.eventKey && e.eventKey.includes(clientId));
  assert.ok(ev, "event detected via trades.add");
  const tasks = await journalReminders.list(1, wsId);
  const mine = tasks.filter((t) => t.eventId === ev.id);
  assert.strictEqual(mine.length, 2, "initial + follow_up tasks created");
  assert.ok(mine.some((t) => t.reminderType === "initial"), "has initial task");
  assert.ok(mine.some((t) => t.reminderType === "follow_up"), "has follow_up task");
  assert.ok(mine.every((t) => t.status === "pending"), "tasks start pending");
});

test("operational event creates NO reminder tasks", async () => {
  const ev = await journalEvents.detectOrRefresh(1, {
    source: "broker_sync",
    eventType: "transfer",
    clientId: `je-rem-op-${Date.now()}`,
    symbol: "AMD",
    quantity: 0,
    notional: 0,
  }, wsId);
  assert.strictEqual(ev.classification, "operational");
  // createForEvent gates to decision_relevant + open, so operational -> [].
  const created = await journalReminders.createForEvent(ev, wsId);
  assert.strictEqual(created.length, 0, "operational events get no reminders");
  const all = await journalReminders.list(1, wsId);
  assert.strictEqual(all.filter((t) => t.eventId === ev.id).length, 0, "no reminder rows persisted");
});

test("scheduler processDueReminders claims initial task, notifies, completes", async () => {
  const clientId = `je-sched-${Date.now()}`;
  await db.userWorkspace.trades.add(1, {
    clientId,
    asset: "TSLA",
    type: "BUY",
    side: "buy",
    marketType: "spot",
    quantity: 1,
    price: 250,
    notional: 250,
    platform: "zenin",
    fee: 0,
    feeCurrency: "USD",
    status: "Filled",
  }, wsId);
  const events = await journalEvents.list(1, { symbol: "TSLA" }, wsId);
  const ev = events.find((e) => e.eventKey && e.eventKey.includes(clientId));
  assert.ok(ev, "event detected via trades.add");
  const before = await db.userWorkspace.notifications.getAll(1, { limit: 50 }, wsId);
  const result = await processDueReminders();
  assert.ok(result.processed >= 1, "at least the immediate (initial) task is processed");
  const after = await db.userWorkspace.notifications.getAll(1, { limit: 50 }, wsId);
  assert.ok(after.length > before.length, "an in-app notification was created");
  const tasks = await journalReminders.list(1, wsId);
  const mine = tasks.filter((t) => t.eventId === ev.id);
  const initial = mine.find((t) => t.reminderType === "initial");
  const followUp = mine.find((t) => t.reminderType === "follow_up");
  assert.strictEqual(initial.status, "completed", "initial task completed");
  assert.strictEqual(followUp.status, "pending", "24h follow_up still pending (not yet due)");
});
