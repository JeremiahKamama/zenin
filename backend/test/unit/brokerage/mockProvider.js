/**
 * Mock Brokerage Provider
 * =======================
 *
 * A fully compliant implementation of the BrokerageProvider interface intended
 * for tests and local development. This serves as a reference for how simple
 * adding a new provider to the registry can be.
 *
 * It uses static/in-memory data instead of calling an external API.
 */

"use strict";

const { normalizeCapabilities } = require("../../../brokerage/domain/capabilities");
const { toMoney, toConnectionStatus } = require("../../../brokerage/domain/models");

const MOCK_CAPABILITIES = normalizeCapabilities({
  supportsRealtimeBalances: true,
  supportsFractionalShares: true,
  supportsOptions: false,
  supportsCrypto: true,
  supportsMargin: false,
  supportsWebhooks: false,
  supportsOrderExecution: false,
  supportsTransfers: false,
  supportsStatements: false,
  supportsTaxDocuments: false
}).capabilities;

function createMockProvider(options = {}) {
  const providerKey = options.providerKey || "mock_provider";
  
  return {
    providerKey,
    displayName: options.displayName || "Mock Provider",
    capabilities: MOCK_CAPABILITIES,

    async connect(context = {}) {
      const userId = String(context.userId || "mock_user");
      return {
        id: userId,
        provider: providerKey,
        providerUserRef: userId,
        status: toConnectionStatus("connected"),
        capabilities: MOCK_CAPABILITIES,
        providerMeta: { mockSessionId: "sess_12345" }
      };
    },

    async disconnect(connectionId, context = {}) {
      return { success: true };
    },

    async refresh(connectionId, context = {}) {
      return {
        id: connectionId,
        provider: providerKey,
        providerUserRef: connectionId,
        status: toConnectionStatus("connected"),
        capabilities: MOCK_CAPABILITIES,
        providerMeta: { lastRefreshed: Date.now() }
      };
    },

    async getConnectionStatus(connectionId, context = {}) {
      return this.refresh(connectionId, context);
    },

    async listAccounts(connectionId, context = {}) {
      return [
        {
          id: "acc_mock_1",
          connectionId,
          name: "Mock Cash Account",
          institutionName: "Mock Brokerage",
          accountType: "cash",
          maskedNumber: "••••1234",
          isMetaOnly: false,
          providerMeta: {},
          syncedAt: new Date().toISOString()
        }
      ];
    },

    async getAccount(connectionId, accountId, context = {}) {
      const accounts = await this.listAccounts(connectionId, context);
      const acc = accounts.find(a => a.id === accountId);
      if (!acc) {
        const { BrokerageAccountNotFound } = require("../../../brokerage/domain/errors");
        throw new BrokerageAccountNotFound(`Account ${accountId} not found.`);
      }
      return acc;
    },

    async getBalances(connectionId, accountId, context = {}) {
      return [
        {
          accountId: accountId || "acc_mock_1",
          total: toMoney(10000.00, "USD"),
          available: toMoney(8500.00, "USD"),
          source: "settled"
        }
      ];
    },

    async getPositions(connectionId, accountId, context = {}) {
      return [
        {
          accountId: accountId || "acc_mock_1",
          symbol: "AAPL",
          quantity: 10,
          side: "long",
          unrealizedPnl: toMoney(150.00, "USD")
        }
      ];
    },

    async getHoldings(connectionId, accountId, context = {}) {
      return [
        {
          accountId: accountId || "acc_mock_1",
          symbol: "AAPL",
          name: "Apple Inc.",
          assetType: "equity",
          quantity: 10,
          averageEntryPrice: toMoney(150.00, "USD"),
          currentPrice: toMoney(165.00, "USD"),
          marketValue: toMoney(1650.00, "USD"),
          asOf: new Date().toISOString(),
          providerMeta: {}
        }
      ];
    },

    async getTransactions(connectionId, accountId, window = {}, context = {}) {
      return [
        {
          id: "tx_mock_1",
          accountId: accountId || "acc_mock_1",
          type: "buy",
          side: "buy",
          symbol: "AAPL",
          quantity: 10,
          unitPrice: toMoney(150.00, "USD"),
          notional: toMoney(1500.00, "USD"),
          currency: "USD",
          executedAt: new Date().toISOString(),
          providerMeta: {}
        }
      ];
    },

    async getInstitutions() {
      return [
        {
          id: "inst_mock",
          name: "Mock Brokerage",
          brokerType: "brokerage",
          supportsMfa: false
        }
      ];
    },

    async sync(connectionId, options = {}) {
      return {
        success: true,
        accountsCount: 1,
        holdingsCount: 1,
        transactionsCount: 1,
        syncedAt: new Date().toISOString(),
        meta: { mode: options.mode || "incremental" }
      };
    },

    async refreshAccount(connectionId, accountId, context = {}) {
      return {
        success: true,
        holdingsCount: 1,
        transactionsCount: 1,
        syncedAt: new Date().toISOString(),
        meta: { accountId }
      };
    },

    async healthCheck() {
      return {
        status: "healthy",
        latencyMs: 5,
        checkedAt: new Date().toISOString()
      };
    }
  };
}

module.exports = {
  createMockProvider,
  MOCK_CAPABILITIES
};
