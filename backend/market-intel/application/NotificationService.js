/**
 * Notification Service
 * =====================
 *
 * Provider-independent notification orchestration. Routes portfolio signals
 * and alert matches to configured notification channels.
 *
 * Channels: Push (Firebase), Email (Resend), SMS (Twilio), WhatsApp, In-App
 *
 * This service never depends on a specific notification provider. Providers
 * are registered and dispatched through a common interface.
 *
 * @module market-intel/application/NotificationService
 */

"use strict";

const { dispatchWorkspaceNotification } = require("../../workspaceNotificationDispatcher");

/**
 * @typedef {Object} NotificationChannel
 * @property {string} name          "push" | "email" | "sms" | "whatsapp" | "inApp"
 * @property {(notification: Notification) => Promise<boolean>} send
 */

class NotificationService {
  /**
   * @param {Object} deps
   * @param {Object} [deps.db]                Database pool
   * @param {Object} [deps.emailService]      Email service (Resend wrapper)
   * @param {Object} [deps.pushService]       Push notification service
   * @param {NotificationChannel[]} [deps.channels]
   */
  constructor(deps = {}) {
    this._db = deps.db || null;
    this._emailService = deps.emailService || null;
    this._pushService = deps.pushService || null;
    this._channels = new Map();

    for (const channel of deps.channels || []) {
      this._channels.set(channel.name, channel);
    }
  }

  /**
   * Register a notification channel provider.
   * @param {NotificationChannel} channel
   */
  registerChannel(channel) {
    this._channels.set(channel.name, channel);
  }

  /**
   * Send a notification through specified channels.
   * @param {Object} recipient
   * @param {string} recipient.userId
   * @param {string} [recipient.workspaceId]
   * @param {string} [recipient.email]
   * @param {string} [recipient.phone]
   * @param {string} [recipient.deviceToken]
   * @param {string} title
   * @param {string} body
   * @param {Object} [options]
   * @param {string[]} [options.channels]     Channels to deliver through
   * @param {string} [options.category]
   * @param {string} [options.actionUrl]
   * @returns {Promise<import("../domain/models").Notification>}
   */
  async send(recipient, title, body, options = {}) {
    const channels = options.channels || ["inApp"];
    return dispatchWorkspaceNotification({
      userId: recipient.userId,
      workspaceId: recipient.workspaceId || null,
      event: {
        type: options.type || `${options.category || "market-news"}.event`,
        category: options.category || "market-news",
        severity: options.severity || "info",
        title,
        body,
        action: { label: options.actionLabel, actionUrl: options.actionUrl },
        requestedChannels: channels,
        dedupeKey: options.dedupeKey || null,
        metadata: options.metadata || {}
      }
    });
  }

  /**
   * Send notifications to multiple recipients at once.
   * @param {Object[]} recipients
   * @param {string} title
   * @param {string} body
   * @param {Object} [options]
   * @returns {Promise<import("../domain/models").Notification[]>}
   */
  async broadcast(recipients, title, body, options = {}) {
    return Promise.all(
      recipients.map((r) => this.send(r, title, body, options))
    );
  }

  /**
   * Send a notification to all users holding a specific symbol.
   * @param {string} symbol
   * @param {string} title
   * @param {string} body
   * @param {Object} [options]
   * @returns {Promise<import("../domain/models").Notification[]>}
   */
  async sendToSymbolHolders(symbol, title, body, options = {}) {
    if (!this._db) return [];

    try {
      const result = await this._db.query(
        `SELECT DISTINCT h.user_id, h.workspace_id
         FROM user_workspace_portfolio h
         WHERE UPPER(h.symbol) = $1`,
        [symbol.toUpperCase()]
      );

      return this.broadcast(result.rows, title, body, options);
    } catch (_) {
      return [];
    }
  }

  /**
   * Mark notification as read.
   * @param {string} notificationId
   */
  async markRead(notificationId) {
    if (!this._db) return;
    try {
      await this._db.query(
        `UPDATE market_notifications SET status = 'read', read_at = NOW()
         WHERE id = $1`,
        [notificationId]
      );
    } catch (_) {}
  }

  /**
   * Get notifications for a user.
   * @param {string} userId
   * @param {string} [workspaceId]
   * @param {number} [limit=50]
   * @returns {Promise<import("../domain/models").Notification[]>}
   */
  async getNotifications(userId, workspaceId, limit = 50) {
    if (!this._db) return [];
    try {
      const result = await this._db.query(
        `SELECT id, user_id, workspace_id, title, body, category, action_url,
                channels, status, delivered_at, read_at, created_at
         FROM market_notifications
         WHERE user_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
         ORDER BY created_at DESC
         LIMIT $3`,
        [userId, workspaceId || null, limit]
      );
      return result.rows.map(mapNotificationRow);
    } catch (_) {
      return [];
    }
  }

}

function mapNotificationRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id || null,
    title: row.title,
    body: row.body,
    category: row.category || null,
    actionUrl: row.action_url || null,
    channels: typeof row.channels === "string" ? JSON.parse(row.channels) : (row.channels || []),
    status: row.status || "pending",
    deliveredAt: row.delivered_at?.toISOString?.() || row.delivered_at || null,
    readAt: row.read_at?.toISOString?.() || row.read_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at || null
  };
}

module.exports = {
  NotificationService
};
