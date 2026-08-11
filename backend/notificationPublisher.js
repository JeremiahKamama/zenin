// backend/notificationPublisher.js
// Realtime notification delivery (Tier 2 / spec: "Real-Time Delivery").
//
// Pattern:
//   1. dispatchWorkspaceNotification persists the inbox event (canonical table).
//   2. It calls publishNotification(workspaceId, notificationId) -> PostgreSQL NOTIFY.
//   3. This module's listener (one per process) receives the notify, loads the
//      canonical event, and forwards a normalized NotificationRealtimeEvent to every
//      SSE client registered for that workspace.
//
// SSE transport only (no WebSocket). Cross-instance via PostgreSQL NOTIFY/LISTEN.
// No credentials/secrets ever cross the wire — only the normalized event.

const { Client } = require("pg");
let pool = null;
let listenerClient = null;
let listening = false;
const HEARTBEAT_MS = 25000;

// workspaceId -> Set of SSE client objects { userId, res }
const clientsByWorkspace = new Map();

// Lightweight in-process cache of recent notification payloads so the listener
// can forward without a second DB round-trip in the hot path. Bounded.
const recentById = new Map();
const RECENT_MAX = 500;

function initNotificationPublisher(pgPool) {
  pool = pgPool;
  return { publishNotification, addSseClient, removeSseClient, startNotificationListener, stopNotificationListener };
}

// 2. Publish after inbox persistence.
async function publishNotification(workspaceId, notificationId, payload) {
  if (!pool) return false;
  if (payload) {
    recentById.set(String(notificationId), payload);
    if (recentById.size > RECENT_MAX) {
      const firstKey = recentById.keys().next().value;
      recentById.delete(firstKey);
    }
  }
  try {
    await pool.query("SELECT pg_notify($1, $2)", [
      "zenin_notifications",
      JSON.stringify({ workspaceId: Number(workspaceId), notificationId: Number(notificationId) })
    ]);
    return true;
  } catch (err) {
    console.warn("[notification-publisher] NOTIFY failed:", err.message);
    return false;
  }
}

function listenerConnectOptions() {
  if (pool && pool.options) {
    // Build a connection config from the active pool's options (works whether the
    // pool was created with a connectionString or discrete params). Never logs secrets.
    const o = pool.options;
    return {
      host: o.host,
      port: o.port,
      database: o.database,
      user: o.user,
      password: o.password,
      connectionString: o.connectionString || process.env.DATABASE_URL || undefined
    };
  }
  return { connectionString: process.env.DATABASE_URL || "" };
}

// 3. Subscribe (one listener per process).
async function startNotificationListener() {
  if (listening || !pool) return;
  try {
    listenerClient = new Client(listenerConnectOptions());
    await listenerClient.connect();
    await listenerClient.query("LISTEN zenin_notifications");
    listenerClient.on("notification", async (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        await forwardToWorkspace(payload.workspaceId, payload.notificationId);
      } catch (err) {
        console.warn("[notification-publisher] notify handler failed:", err.message);
      }
    });
    listening = true;
    console.log("[notification-publisher] LISTEN zenin_notifications active");
  } catch (err) {
    console.warn("[notification-publisher] LISTEN failed:", err.message);
    try { await listenerClient.end(); } catch {}
    listenerClient = null;
  }
}

async function stopNotificationListener() {
  if (listenerClient) {
    try { await listenerClient.query("UNLISTEN zenin_notifications"); } catch {}
    try { await listenerClient.end(); } catch {}
  }
  listenerClient = null;
  listening = false;
}

async function forwardToWorkspace(workspaceId, notificationId) {
  const clients = clientsByWorkspace.get(Number(workspaceId));
  if (!clients || !clients.size) return; // no live SSE clients for this workspace
  // Prefer in-process cache; else load from the canonical table.
  let record = recentById.get(String(notificationId));
  if (!record) {
    try {
      const res = await pool.query(
        `SELECT id, type, title, body, entity_type, entity_id, metadata_json, category, severity, action_json, created_at
         FROM user_workspace_notification_events WHERE id=$1 LIMIT 1`,
        [Number(notificationId)]
      );
      const row = res.rows[0];
      if (row) record = mapRowToEvent(row);
    } catch (err) {
      console.warn("[notification-publisher] load failed:", err.message);
    }
  }
  if (!record) return;
  const event = {
    type: "notification",
    version: Number(notificationId),
    notification: record
  };
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    try {
      if (client.res.writable) client.res.write(data);
    } catch {
      removeSseClient(workspaceId, client.res);
    }
  }
}

function mapRowToEvent(row) {
  return {
    id: Number(row.id),
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    category: row.category,
    severity: row.severity,
    metadata: row.metadata_json,
    action: row.action_json,
    createdAt: row.created_at
  };
}

// SSE client registry (called by the /api/notifications/stream endpoint).
function addSseClient(workspaceId, userId, res) {
  const wid = Number(workspaceId);
  if (!clientsByWorkspace.has(wid)) clientsByWorkspace.set(wid, new Set());
  const client = { userId: Number(userId), res };
  clientsByWorkspace.get(wid).add(client);
  return () => removeSseClient(wid, res);
}

function removeSseClient(workspaceId, res) {
  const wid = Number(workspaceId);
  const set = clientsByWorkspace.get(wid);
  if (!set) return;
  for (const client of set) {
    if (client.res === res) { set.delete(client); break; }
  }
  if (!set.size) clientsByWorkspace.delete(wid);
}

function isListening() { return listening; }

module.exports = {
  initNotificationPublisher,
  publishNotification,
  startNotificationListener,
  stopNotificationListener,
  addSseClient,
  removeSseClient,
  isListening,
  HEARTBEAT_MS,
  _clientsByWorkspace: clientsByWorkspace
};
