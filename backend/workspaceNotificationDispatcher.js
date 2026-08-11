"use strict";

const db = require("./database");
const { isEmailDeliveryProductionReady, sendAlertEmail } = require("./email");

const CATEGORIES = new Set([
  "security", "account", "execution", "portfolio", "risk", "watchlist",
  "research", "journal", "market-news", "workspace"
]);
const SEVERITIES = new Set(["info", "success", "warning", "critical"]);

function enabled(value) {
  return ["true", "1", "yes"].includes(String(value || "").trim().toLowerCase());
}

function normalizeCategory(value) {
  const category = String(value || "workspace").trim().toLowerCase();
  return CATEGORIES.has(category) ? category : "workspace";
}

function normalizeSeverity(value) {
  const severity = String(value || "info").trim().toLowerCase();
  return SEVERITIES.has(severity) ? severity : "info";
}

function normalizeAction(value = {}) {
  if (!value || typeof value !== "object") return {};
  const label = String(value.label || "").trim().slice(0, 120);
  const actionUrl = String(value.actionUrl || value.url || "").trim().slice(0, 2000);
  return {
    ...(label ? { label } : {}),
    ...(actionUrl ? { actionUrl } : {})
  };
}

function selectedChannels(event, severity) {
  const requested = Array.isArray(event.requestedChannels || event.channels)
    ? event.requestedChannels || event.channels
    : ["inApp"];
  const channels = new Set(["inApp"]);
  for (const channel of requested) {
    if (channel === "email") channels.add("email");
  }
  if (event.actionable === true || severity === "critical") channels.add("inApp");
  return [...channels];
}

function emailPreferenceAllows(preferences, category) {
  if (preferences?.notifyEmail === false) return false;
  if (["watchlist", "market-news", "risk"].includes(category) && preferences?.notifyPriceAlerts === false) return false;
  if (category === "execution" && preferences?.notifyOrderEvents === false) return false;
  if (category === "market-news" && preferences?.notifyNews === false) return false;
  return true;
}

async function emailRecipient(userId, workspaceId, category) {
  const userResult = await db.pool.query(
    `SELECT email, email_verified AS "emailVerified" FROM app_users WHERE id = $1 LIMIT 1`,
    [Number(userId)]
  );
  const user = userResult.rows[0];
  if (!user?.email) return { allowed: false, reason: "email_missing" };
  if (!user.emailVerified) return { allowed: false, reason: "email_not_verified" };
  const stored = await db.userWorkspace.docs.get(userId, "settings:preferences", {}, workspaceId);
  const preferences = stored?.document && typeof stored.document === "object" ? stored.document : {};
  if (!emailPreferenceAllows(preferences, category)) return { allowed: false, reason: "email_preference_disabled" };
  return { allowed: true, email: user.email };
}

/**
 * Canonical notification entrypoint. Inbox persistence always happens first;
 * external delivery never prevents the user from seeing the event in Zenin.
 */
async function dispatchWorkspaceNotification({ userId, workspaceId, event = {} }) {
  const category = normalizeCategory(event.category);
  const severity = normalizeSeverity(event.severity);
  const action = normalizeAction(event.action || { label: event.actionLabel, actionUrl: event.actionUrl });
  const requestedChannels = selectedChannels(event, severity);
  const now = new Date().toISOString();
  const initialDelivery = {
    inApp: { status: "persisted", deliveredAt: now },
    email: { status: requestedChannels.includes("email") ? "pending" : "not_requested" }
  };

  const notification = await db.userWorkspace.notifications.upsert(userId, {
    type: event.type || `${category}.event`,
    title: event.title,
    body: event.body,
    entityType: event.entityType,
    entityId: event.entityId,
    metadata: { ...(event.metadata || {}), severity, category, actionUrl: action.actionUrl || null },
    category,
    severity,
    action,
    requestedChannels,
    deliveryResults: initialDelivery,
    inAppDeliveredAt: now,
    dedupeKey: event.dedupeKey || null
  }, workspaceId);

  // Realtime: publish to SSE subscribers AFTER inbox persistence succeeds.
  try {
    const publisher = require("./notificationPublisher");
    if (publisher && notification && notification.id != null) {
      publisher.publishNotification(workspaceId, notification.id, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        entityType: notification.entityType,
        entityId: notification.entityId,
        category: notification.category,
        severity: notification.severity,
        metadata: notification.metadata,
        action: notification.action,
        createdAt: notification.createdAt || now
      });
    }
  } catch (pubErr) {
    console.warn("[notification-publisher] dispatch publish skipped:", pubErr.message);
  }

  if (!requestedChannels.includes("email")) return notification;

  let emailResult;
  if (!enabled(process.env.NOTIFICATIONS_EMAIL_ENABLED)) {
    emailResult = { status: "skipped", reason: "email_delivery_disabled" };
  } else if (String(process.env.NOTIFICATIONS_EMAIL_PROVIDER || "resend").trim().toLowerCase() !== "resend") {
    emailResult = { status: "skipped", reason: "email_provider_unavailable" };
  } else if (!isEmailDeliveryProductionReady()) {
    emailResult = { status: "skipped", reason: "email_provider_not_ready" };
  } else {
    const recipient = await emailRecipient(userId, workspaceId, category);
    if (!recipient.allowed) {
      emailResult = { status: "skipped", reason: recipient.reason };
    } else {
      const result = await sendAlertEmail(recipient.email, {
        type: event.type || `${category}.event`,
        title: notification.title,
        body: notification.body,
        severity,
        actionUrl: action.actionUrl,
        workspaceName: event.workspaceName || "Zenin workspace"
      });
      emailResult = result?.sent
        ? { status: "delivered", provider: result.provider || "resend", deliveredAt: new Date().toISOString(), providerMessageId: result.providerMessageId || null }
        : { status: "failed", provider: result?.provider || "resend", reason: result?.error?.message || "email_delivery_failed" };
    }
  }

  return db.userWorkspace.notifications.updateDelivery(userId, notification.id, {
    deliveryResults: { email: emailResult },
    emailDeliveredAt: emailResult?.deliveredAt || null
  }, workspaceId) || notification;
}

module.exports = {
  dispatchWorkspaceNotification,
  normalizeCategory,
  normalizeSeverity,
  isEmailDeliveryEnabled: () => enabled(process.env.NOTIFICATIONS_EMAIL_ENABLED)
};
