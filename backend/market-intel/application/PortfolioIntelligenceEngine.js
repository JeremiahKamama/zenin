/**
 * Portfolio Intelligence Engine
 * =============================
 *
 * Analyzes user portfolios against market events and generates
 * PortfolioSignal objects. Signals are provider-independent and
 * feed into the notification pipeline.
 *
 * @module market-intel/application/PortfolioIntelligenceEngine
 */

"use strict";

const { generateId } = require("../domain/models");

class PortfolioIntelligenceEngine {
  /**
   * @param {Object} deps
   * @param {Object} deps.db                     Database pool
   * @param {Object} [deps.eventBus]             For publishing signals
   * @param {number} [deps.portfolioDropThreshold=3]  Percent drop to trigger alert
   * @param {number} [deps.allocationDriftThreshold=5]  Percent drift
   * @param {number} [deps.cashAllocationThreshold=20]  Cash as % of portfolio
   */
  constructor(deps) {
    this._db = deps.db;
    this._eventBus = deps.eventBus || null;
    this._portfolioDropThreshold = deps.portfolioDropThreshold || 3;
    this._allocationDriftThreshold = deps.allocationDriftThreshold || 5;
    this._cashAllocationThreshold = deps.cashAllocationThreshold || 20;
    this._listeners = new Set();
  }

  onSignal(listener) {
    this._listeners.add(listener);
  }

  removeListener(listener) {
    this._listeners.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Market Event → Portfolio Signal analysis
  // -----------------------------------------------------------------------

  /**
   * Analyze a market event against all user portfolios.
   * Returns PortfolioSignal objects for affected users.
   *
   * @param {import("../domain/models").MarketEvent} event
   * @returns {Promise<import("../domain/models").PortfolioSignal[]>}
   */
  async analyzeMarketEvent(event) {
    if (!this._db) return [];
    if (!event.symbol) return [];

    // Find all users who hold this symbol
    const holdings = await this._getHoldingsForSymbol(event.symbol);

    const signals = [];
    for (const holding of holdings) {
      const signal = this._buildSignal(event, holding);
      if (signal) {
        signals.push(signal);
        this._emit(signal);
      }
    }

    return signals;
  }

  /**
   * Analyze earnings calendar events against user portfolios.
   * @param {import("../domain/models").MarketEvent} event
   * @returns {Promise<import("../domain/models").PortfolioSignal[]>}
   */
  async analyzeEarningsEvent(event) {
    if (!event.symbol) return [];
    if (!this._db) return [];

    const holdings = await this._getHoldingsForSymbol(event.symbol);
    if (!holdings.length) return [];

    const dateStr = event.payload?.date;
    if (!dateStr) return [];

    const earningsDate = new Date(dateStr);
    const today = new Date();
    const daysUntilEarnings = Math.ceil(
      (earningsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only alert if earnings within 7 days
    if (daysUntilEarnings < 0 || daysUntilEarnings > 7) return [];

    const signals = [];
    for (const holding of holdings) {
      const signal = {
        id: generateId(),
        userId: holding.user_id,
        workspaceId: holding.workspace_id || null,
        eventId: event.id,
        eventType: "EARNINGS_UPCOMING",
        symbol: event.symbol,
        payload: {
          symbol: event.symbol,
          name: event.payload?.name || event.symbol,
          date: dateStr,
          daysUntil: daysUntilEarnings,
          estimatedEps: event.payload?.estimatedEps,
          estimatedRevenue: event.payload?.estimatedRevenue,
          timeOfDay: event.payload?.timeOfDay,
          holdingQuantity: holding.quantity,
          holdingValue: holding.market_value
        },
        severity: "info",
        acknowledged: false,
        createdAt: new Date().toISOString()
      };
      signals.push(signal);
      this._emit(signal);
    }

    return signals;
  }

  /**
   * Analyze dividend events against user portfolios.
   * @param {import("../domain/models").MarketEvent} event
   * @returns {Promise<import("../domain/models").PortfolioSignal[]>}
   */
  async analyzeDividendEvent(event) {
    if (!event.symbol || !this._db) return [];

    const holdings = await this._getHoldingsForSymbol(event.symbol);
    if (!holdings.length) return [];

    const signals = [];
    for (const holding of holdings) {
      const dividendAmount = event.payload?.dividend || 0;
      const totalDividend = dividendAmount * holding.quantity;
      const signal = {
        id: generateId(),
        userId: holding.user_id,
        workspaceId: holding.workspace_id || null,
        eventId: event.id,
        eventType: event.type,
        symbol: event.symbol,
        payload: {
          symbol: event.symbol,
          dividend: dividendAmount,
          totalDividend,
          quantity: holding.quantity,
          payableDate: event.payload?.payableDate,
          declarationDate: event.payload?.declarationDate
        },
        severity: dividendAmount > 0 ? "info" : "warning",
        acknowledged: false,
        createdAt: new Date().toISOString()
      };
      signals.push(signal);
      this._emit(signal);
    }

    return signals;
  }

  /**
   * Run a full portfolio-level analysis for a user.
   * Evaluates portfolio movements, allocation drift, etc.
   *
   * @param {string} userId
   * @param {string} [workspaceId]
   * @returns {Promise<import("../domain/models").PortfolioSignal[]>}
   */
  async analyzeUserPortfolio(userId, workspaceId) {
    if (!this._db) return [];

    const holdings = await this._getUserHoldings(userId, workspaceId);
    if (!holdings.length) return [];

    const signals = [];

    // Calculate total portfolio value
    const totalValue = holdings.reduce(
      (sum, h) => sum + (Number(h.market_value) || 0),
      0
    );

    // Cash allocation check
    const cashHolding = holdings.find((h) =>
      h.symbol?.toUpperCase() === "USD" || h.symbol?.toUpperCase() === "USDC" || h.asset_type === "cash"
    );
    if (cashHolding) {
      const cashValue = Number(cashHolding.market_value) || 0;
      const cashPercent = totalValue > 0 ? (cashValue / totalValue) * 100 : 0;
      if (cashPercent > this._cashAllocationThreshold) {
        signals.push({
          id: generateId(),
          userId,
          workspaceId: workspaceId || null,
          eventId: generateId(),
          eventType: "CASH_ALLOCATION_THRESHOLD",
          symbol: null,
          payload: {
            totalValue,
            cashValue,
            cashPercent: Math.round(cashPercent * 100) / 100
          },
          severity: "warning",
          acknowledged: false,
          createdAt: new Date().toISOString()
        });
      }
    }

    // Sector exposure check
    const sectorWeights = {};
    for (const h of holdings) {
      if (!h.sector || h.asset_type === "cash") continue;
      sectorWeights[h.sector] = (sectorWeights[h.sector] || 0) + (Number(h.market_value) || 0);
    }
    for (const [sector, value] of Object.entries(sectorWeights)) {
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      if (pct > 50) {
        signals.push({
          id: generateId(),
          userId,
          workspaceId: workspaceId || null,
          eventId: generateId(),
          eventType: "SECTOR_EXPOSURE_DRIFT",
          symbol: null,
          payload: { sector, sectorValue: value, sectorPercent: Math.round(pct * 100) / 100 },
          severity: "warning",
          acknowledged: false,
          createdAt: new Date().toISOString()
        });
      }
    }

    for (const signal of signals) {
      this._emit(signal);
    }

    return signals;
  }

  // -----------------------------------------------------------------------
  // Database queries
  // -----------------------------------------------------------------------

  async _getHoldingsForSymbol(symbol) {
    try {
      const result = await this._db.query(
        `SELECT h.user_id, h.workspace_id, h.symbol, h.quantity, h.market_value,
                h.asset_type, h.sector
         FROM user_workspace_portfolio h
         WHERE UPPER(h.symbol) = $1`,
        [symbol.toUpperCase()]
      );
      return result.rows;
    } catch (_) {
      return [];
    }
  }

  async _getUserHoldings(userId, workspaceId) {
    try {
      const result = await this._db.query(
        `SELECT user_id, workspace_id, symbol, name, quantity, market_value, asset_type, sector
         FROM user_workspace_portfolio
         WHERE user_id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
         ORDER BY market_value DESC`,
        [userId, workspaceId || null]
      );
      return result.rows;
    } catch (_) {
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _buildSignal(event, holding) {
    let severity = "info";
    if (event.type === "LARGE_LOSS" || event.type === "INSIDER_SELL" || event.type === "ANALYST_DOWNGRADE") {
      severity = "warning";
    } else if (event.type === "LARGE_GAIN" || event.type === "INSIDER_BUY" || event.type === "EARNINGS_UPCOMING") {
      severity = "info";
    }

    return {
      id: generateId(),
      userId: holding.user_id,
      workspaceId: holding.workspace_id || null,
      eventId: event.id,
      eventType: event.type,
      symbol: event.symbol,
      payload: {
        ...event.payload,
        holdingQuantity: holding.quantity,
        holdingValue: holding.market_value
      },
      severity,
      acknowledged: false,
      createdAt: new Date().toISOString()
    };
  }

  _emit(signal) {
    if (this._eventBus && typeof this._eventBus.emit === "function") {
      this._eventBus.emit("portfolio:signal", signal);
    }
    for (const listener of this._listeners) {
      try {
        listener(signal);
      } catch (_) {}
    }
  }
}

module.exports = {
  PortfolioIntelligenceEngine
};
