// journalReminderWorker.js
// Phase 2: claim-safe scheduler that turns due journal_reminder_tasks into
// in-app notifications (+ optional email). No pre-existing scheduler existed,
// so this is the periodic engine for trade-journaling reminders.
//
// Design:
//  - One claim pass per tick. claimDue() flips pending->sent atomically
//    (FOR UPDATE SKIP LOCKED) so multiple instances can't double-send.
//  - Each task is wrapped so a single failure can't abort the batch or the
//    server. Failures are recorded in channel_results_json, task stays claimed
//    (sent) so we don't loop forever on a poison task.
//  - Email only fires when delivery is production-ready AND the user opted in.
//  - Overlap guard prevents a slow tick from stacking.

const db = require("./database");
const { dispatchWorkspaceNotification } = require("./workspaceNotificationDispatcher");

const DEFAULT_INTERVAL_MS = 60 * 1000; // 1 minute sweep
const TICK_TIMEOUT_MS = 30 * 1000;

// Plan gating for reminder delivery. Mirrors the rank used by the API's
// requirePlan() so the worker honours the same tier rules: in-app reminders
// are allowed on every plan, but email delivery requires a paid plan. This
// keeps free-tier users from being emailed while still getting in-app nudges.
const PLAN_RANK = { starter: 0, pro: 1, desk: 2, enterprise: 3 };
const EMAIL_MIN_PLAN = "pro";
function planRank(plan) { return PLAN_RANK[String(plan || "starter").trim().toLowerCase()] || 0; }

async function fetchEffectivePlan(userId, workspaceId) {
  try {
    const ws = await db.query?.(
      `SELECT w.plan AS workspace_plan, u.current_plan AS user_plan
       FROM workspaces w
       LEFT JOIN users u ON u.id = $1
       WHERE w.id = $2 LIMIT 1`,
      [userId, workspaceId]
    ).catch(() => null);
    const row = ws?.rows?.[0];
    if (!row) return "starter";
    const userPlan = row.user_plan || "starter";
    const wsPlan = row.workspace_plan || "starter";
    // Higher of the two wins (matches getEffectivePlan in index.js).
    return planRank(wsPlan) > planRank(userPlan) ? wsPlan : userPlan;
  } catch {
    return "starter";
  }
}

function titleFor(event, reminderType) {
  const sym = event.symbol ? ` ${event.symbol}` : "";
  return reminderType === "follow_up" ? `Journaling follow-up${sym}` : `New trade to journal${sym}`;
}

function bodyFor(event, reminderType) {
  const sym = event.symbol || "your recent trade";
  const side = event.side ? `${String(event.side).toUpperCase()} ` : "";
  return reminderType === "follow_up"
    ? `Reminder: you haven't journaled ${sym} yet. Capture the thesis and outcome while it's fresh.`
    : `${side}${sym} was detected. Journal the decision and thesis now.`;
}

async function processDueReminders(before = new Date()) {
  const due = await db.userWorkspace.journalReminders.claimDue(before);
  if (!due.length) return { processed: 0 };
  let notifications = 0;
  let emails = 0;
  let errors = 0;

  for (const task of due) {
    try {
      const event = await db.userWorkspace.journalEvents.getById(task.userId, task.eventId, task.workspaceId);
      if (!event) {
        await db.userWorkspace.journalReminders.complete(task.userId, task.id, task.workspaceId);
        continue;
      }
      const title = titleFor(event, task.reminderType);
      const body = bodyFor(event, task.reminderType);

      // Tier gate: email delivery requires a paid plan; in-app is always allowed.
      const effectivePlan = await fetchEffectivePlan(task.userId, task.workspaceId);
      const requestedChannels = planRank(effectivePlan) >= planRank(EMAIL_MIN_PLAN)
        ? ["inApp", "email"]
        : ["inApp"];

      const notification = await dispatchWorkspaceNotification({ userId: task.userId, workspaceId: task.workspaceId, event: {
        type: "journal_reminder",
        category: "journal",
        severity: task.reminderType === "follow_up" ? "warning" : "info",
        title,
        body,
        entityType: "journal_event",
        entityId: task.eventId,
        metadata: { reminderType: task.reminderType, symbol: event.symbol, classification: event.classification },
        action: { label: "Open journal", actionUrl: "/app?section=journal" },
        requestedChannels,
        dedupeKey: `journal-reminder:${task.eventId}:${task.reminderType}`
      }});
      notifications += 1;
      const email = notification?.deliveryResults?.email;
      if (email?.status === "delivered") emails += 1;
      await db.userWorkspace.journalReminders.complete(task.userId, task.id, notification?.deliveryResults || { inApp: true }, task.workspaceId);
    } catch (err) {
      errors += 1;
      console.error("[JournalReminderWorker] task", task && task.id, "failed:", err && err.message);
      // Leave the task claimed (sent) so it isn't retried indefinitely.
    }
  }
  return { processed: due.length, notifications, emails, errors };
}

let timer = null;
let running = false;

function startJournalReminderScheduler({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  if (timer) return; // idempotent
  const tick = async () => {
    if (running) return; // overlap guard
    running = true;
    try {
      await Promise.race([
        processDueReminders(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tick timeout")), TICK_TIMEOUT_MS)),
      ]);
    } catch (err) {
      console.error("[JournalReminderWorker] tick error:", err && err.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  if (timer.unref) timer.unref();
  console.log("[JournalReminderWorker] scheduler started.");
}

function stopJournalReminderScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  processDueReminders,
  startJournalReminderScheduler,
  stopJournalReminderScheduler,
};
