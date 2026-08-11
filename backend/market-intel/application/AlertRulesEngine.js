/**
 * Alert Rules Engine
 * ===================
 *
 * Evaluates user-defined alert rules against market events and portfolio
 * signals. When a rule matches, it triggers the NotificationService.
 *
 * Alert rules are stored in the database and evaluated on every market event.
 *
 * @module market-intel/application/AlertRulesEngine
 */

"use strict";

const { AlertRuleNotFoundError } = require("../domain/errors");

/**
 * @typedef {{ id: string, enabled: boolean, eventType: string, symbol: string|null,
 *   conditions: Object, channels: string[], userId: string, workspaceId: string|null }} AlertRuleRow
 */

class AlertRulesEngine {
  /**
   * @param {Object} deps
   * @param {Object} [deps.db]              Database pool
   * @param {Object} [deps.notificationService]  NotificationService instance
   * @param {Object} [deps.eventBus]
   */
  constructor(deps = {}) {
       this._db = deps.db || null;
       this._notificationService = deps.notificationService || null;
       this._eventBus = deps.eventBus || null;
       // Per-(symbol,ruleId) last-fired timestamps to avoid alert-storming on every
       // websocket tick. A matched rule fires at most once per REARM_MS while the
       // condition holds.
       this._lastFired = new Map();
       this._rearmMs = 60 * 1000;
     }

     /**
      * Feed a live price tick from the realtime quote stream. Builds a PRICE_CHANGE
      * MarketEvent and evaluates all enabled rules for the symbol, throttling each
      * (symbol, rule) pair to at most one notification per _rearmMs.
      * @param {string} symbol
      * @param {{ price: number, changePercent?: number|null }} quote
      * @returns {Promise<Object[]>}
      */
     async feedPriceEvent(symbol, quote) {
       if (!symbol || !quote || typeof quote.price !== "number" || Number.isNaN(quote.price)) return [];
       const sym = String(symbol).toUpperCase();
       const changePercent = quote.changePercent == null ? null : Number(quote.changePercent);
       return this.evaluateEvent({
         type: "PRICE_CHANGE",
         symbol: sym,
         payload: { price: quote.price, changePercent }
       });
     }

     // -----------------------------------------------------------------------
     // CRUD

  async createRule(userId, workspaceId, rule) {
    if (!this._db) throw new Error("Database not configured");
    // Only the inApp channel is wired (no push/email provider registered). Coerce
    // any client-supplied channels to the supported set so we never request a
    // phantom "push" delivery.
    const channels = ["inApp"];
    const result = await this._db.query(
      `INSERT INTO market_alert_rules
       (user_id, workspace_id, name, event_type, symbol, conditions, channels, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, user_id, workspace_id, name, event_type, symbol, conditions,
                 channels, enabled, created_at, updated_at`,
      [
        userId,
        workspaceId || null,
        rule.name,
        rule.eventType,
        rule.symbol || null,
        JSON.stringify(rule.conditions || {}),
        JSON.stringify(channels),
        rule.enabled !== false
      ]
    );
    return mapAlertRuleRow(result.rows[0]);
  }

  async getRules(userId, workspaceId) {
    if (!this._db) throw new Error("Database not configured");
    const result = await this._db.query(
      `SELECT id, user_id, workspace_id, name, event_type, symbol, conditions,
              channels, enabled, created_at, updated_at
       FROM market_alert_rules
       WHERE user_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
       ORDER BY created_at DESC`,
      [userId, workspaceId || null]
    );
    return result.rows.map(mapAlertRuleRow);
  }

  async deleteRule(ruleId, userId) {
    if (!this._db) throw new Error("Database not configured");
    const result = await this._db.query(
      `DELETE FROM market_alert_rules WHERE id = $1 AND user_id = $2 RETURNING id`,
      [ruleId, userId]
    );
    if (!result.rows.length) {
      throw new AlertRuleNotFoundError(ruleId);
    }
  }

  async updateRule(ruleId, userId, updates) {
    if (!this._db) throw new Error("Database not configured");
    const fields = [];
    const values = [ruleId, userId];
    let idx = 3;
    for (const [key, value] of Object.entries(updates)) {
      const col = camelToSnake(key);
      fields.push(`${col} = $${idx++}`);
      values.push(
        key === "conditions" || key === "channels"
          ? JSON.stringify(value)
          : value
      );
    }
    if (!fields.length) throw new Error("No fields to update");
    fields.push("updated_at = NOW()");
    const result = await this._db.query(
      `UPDATE market_alert_rules SET ${fields.join(", ")}
       WHERE id = $1 AND user_id = $2
       RETURNING id, user_id, workspace_id, name, event_type, symbol, conditions,
                 channels, enabled, created_at, updated_at`,
      values
    );
    if (!result.rows.length) throw new AlertRuleNotFoundError(ruleId);
    return mapAlertRuleRow(result.rows[0]);
  }

  // -----------------------------------------------------------------------
  // Evaluation
  // -----------------------------------------------------------------------

  /**
   * Evaluate all enabled rules against a market event.
   * Returns matches with corresponding notifications.
   *
   * @param {import("../domain/models").MarketEvent} event
   * @returns {Promise<Object[]>} Matched rules with notification sent
   */
  async evaluateEvent(event) {
    if (!this._db || !event) return [];

    try {
      const result = await this._db.query(
        `SELECT id, user_id, workspace_id, name, event_type, symbol, conditions,
                channels, enabled
         FROM market_alert_rules
         WHERE enabled = true
           AND (event_type = $1 OR event_type IS NULL OR event_type = '')
           AND (symbol IS NULL OR symbol = '' OR UPPER(symbol) = $2)`,
        [event.type, (event.symbol || "").toUpperCase()]
      );

      const matches = [];
      const now = Date.now();
      for (const ruleRow of result.rows) {
        const rule = mapAlertRuleRow(ruleRow);
        if (!this._matchRule(event, rule)) continue;
        matches.push(rule);
        // Throttle: a matched rule fires at most once per _rearmMs per symbol so a
        // continuously-held condition doesn't storm notifications on every tick.
        const throttleKey = `${(event.symbol || "").toUpperCase()}:${rule.id}`;
        const last = this._lastFired.get(throttleKey) || 0;
        if (now - last < this._rearmMs) continue;
        this._lastFired.set(throttleKey, now);
        // Trigger notification if service available
        if (this._notificationService) {
            const title = this._buildNotificationTitle(rule, event);
            const body = this._buildNotificationBody(rule, event);
            this._notificationService.send(
              { userId: rule.userId, workspaceId: rule.workspaceId },
              title,
              body,
              { channels: rule.channels, category: rule.eventType }
            ).catch(() => {});
          }
      }
      return matches;
    } catch (_) {
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Rule matching
  // -----------------------------------------------------------------------

  _matchRule(event, rule) {
    const conditions = rule.conditions || {};
    if (!Object.keys(conditions).length) return true;

    // Price threshold matching
    if (conditions.priceAbove != null) {
      const price = event.payload?.price;
      if (price == null || price <= conditions.priceAbove) return false;
    }
    if (conditions.priceBelow != null) {
      const price = event.payload?.price;
      if (price == null || price >= conditions.priceBelow) return false;
    }

    // Percent change matching
    if (conditions.changePercentAbove != null) {
      const pct = event.payload?.changePercent;
      if (pct == null || pct <= conditions.changePercentAbove) return false;
    }
    if (conditions.changePercentBelow != null) {
      const pct = event.payload?.changePercent;
      if (pct == null || pct >= Math.abs(conditions.changePercentBelow)) return false;
    }

    // Value threshold matching
    if (conditions.totalValueAbove != null) {
      const val = event.payload?.totalValue;
      if (val == null || val <= conditions.totalValueAbove) return false;
    }

    // Severity matching
    if (conditions.minSeverity) {
      const severities = ["info", "warning", "alert", "critical"];
      const eventSevIdx = severities.indexOf(event.payload?.severity || 0);
      const minSevIdx = severities.indexOf(conditions.minSeverity);
      if (eventSevIdx < minSevIdx) return false;
    }

    return true;
  }

  _buildNotificationTitle(rule, event) {
    const name = rule.name || event.type;
    const symbol = event.symbol ? ` ${event.symbol}` : "";
    return `${name}${symbol}`;
  }

  _buildNotificationBody(rule, event) {
    const payload = event.payload || {};
    switch (event.type) {
      case "LARGE_GAIN":
      case "LARGE_LOSS":
        return `${event.symbol}: ${payload.changePercent > 0 ? "+" : ""}${Math.round(payload.changePercent * 100) / 100}% — now $${payload.price?.toFixed(2) || "N/A"}`;
      case "HIGH_52_WEEK":
        return `${event.symbol} hit a new 52-week high at $${payload.price?.toFixed(2) || "N/A"}`;
      case "LOW_52_WEEK":
        return `${event.symbol} hit a new 52-week low at $${payload.price?.toFixed(2) || "N/A"}`;
      case "DIVIDEND_DECLARED":
        return `${event.symbol} declared a dividend of $${payload.dividend?.toFixed(4) || "N/A"} per share`;
      case "EARNINGS_UPCOMING":
        return `${event.symbol} reports earnings on ${payload.date || "TBD"} (est. EPS: ${payload.estimatedEps ?? "N/A"})`;
      case "EARNINGS_ANNOUNCED":
        return `${event.symbol} reported EPS ${payload.actualEps ?? "N/A"} vs est. ${payload.estimatedEps ?? "N/A"}`;
      case "INSIDER_BUY":
        return `${payload.insiderName || "Insider"} bought ${payload.shares?.toLocaleString() || ""} shares of ${event.symbol}`;
      case "INSIDER_SELL":
        return `${payload.insiderName || "Insider"} sold ${payload.shares?.toLocaleString() || ""} shares of ${event.symbol}`;
      case "NEWS_PUBLISHED":
        return payload.title || event.symbol || "Breaking news";
      case "ANALYST_UPGRADE":
        return `${event.symbol} upgraded by ${payload.firm || "analyst"} — target $${payload.targetPrice?.toFixed(2) || "N/A"}`;
      case "ANALYST_DOWNGRADE":
        return `${event.symbol} downgraded by ${payload.firm || "analyst"}`;
      default:
        return event.symbol ? `${event.symbol}: ${event.type}` : event.type;
    }
  }
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function mapAlertRuleRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id || null,
    name: row.name,
    eventType: row.event_type,
    symbol: row.symbol || null,
    conditions: typeof row.conditions === "string"
      ? JSON.parse(row.conditions)
      : (row.conditions || {}),
    channels: typeof row.channels === "string"
      ? JSON.parse(row.channels)
      : (row.channels || ["inApp"]),
    enabled: Boolean(row.enabled),
    createdAt: row.created_at?.toISOString?.() || row.created_at || null,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at || null
  };
}

module.exports = {
  AlertRulesEngine
};
