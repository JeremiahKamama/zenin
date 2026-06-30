/**
 * Brokerage Provider Capabilities
 * ===============================
 *
 * Each provider advertises what it can do via a BrokerageCapabilitySet. The
 * application layer queries capabilities through the registry and never assumes
 * a feature exists — it degrades gracefully (e.g. hides the "place order"
 * button when supportsOrderExecution is false).
 *
 * This is a closed enum of capability keys. Adding a capability here is the only
 * place the set changes; providers opt in by setting the flag to true.
 *
 * Provider-independent: no capability references a vendor-specific concept.
 */

"use strict";

/**
 * The complete set of capability keys a provider may advertise. Keeping this as
 * a single source of truth lets `describeCapabilities` and the contract check
 * detect typos and flag unknown flags.
 *
 * @enum {string}
 */
const BrokerageCapability = Object.freeze({
  REALTIME_BALANCES: "supportsRealtimeBalances",
  FRACTIONAL_SHARES: "supportsFractionalShares",
  OPTIONS: "supportsOptions",
  CRYPTO: "supportsCrypto",
  MARGIN: "supportsMargin",
  WEBHOOKS: "supportsWebhooks",
  ORDER_EXECUTION: "supportsOrderExecution",
  TRANSFERS: "supportsTransfers",
  STATEMENTS: "supportsStatements",
  TAX_DOCUMENTS: "supportsTaxDocuments"
});

const ALL_CAPABILITY_KEYS = Object.freeze(Object.values(BrokerageCapability));

/**
 * A capability advertisement. Every key defaults to false when absent, so a
 * provider only needs to declare what it supports.
 *
 * @typedef {Object} BrokerageCapabilitySet
 * @property {boolean} [supportsRealtimeBalances]  Can fetch up-to-the-second balances.
 * @property {boolean} [supportsFractionalShares]  Supports fractional share holdings.
 * @property {boolean} [supportsOptions]           Supports options positions/transactions.
 * @property {boolean} [supportsCrypto]            Supports crypto holdings.
 * @property {boolean} [supportsMargin]            Supports margin accounts.
 * @property {boolean} [supportsWebhooks]          Can push updates via webhooks.
 * @property {boolean} [supportsOrderExecution]    Can place/modify/cancel orders.
 * @property {boolean} [supportsTransfers]         Supports cash/asset transfers.
 * @property {boolean} [supportsStatements]        Can produce account statements.
 * @property {boolean} [supportsTaxDocuments]      Can produce tax documents.
 */

/**
 * Normalizes a raw capability object into a complete BrokerageCapabilitySet:
 * every known key is present and boolean. Unknown keys are dropped (and
 * surfaced via the returned `warnings` so a misnamed provider flag isn't silent).
 *
 * @param {Object} [raw]
 * @returns {{ capabilities: BrokerageCapabilitySet, warnings: string[] }}
 */
function normalizeCapabilities(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const capabilities = {};
  const warnings = [];

  for (const key of ALL_CAPABILITY_KEYS) {
    const value = source[key];
    capabilities[key] = value === true;
  }

  for (const key of Object.keys(source)) {
    if (!ALL_CAPABILITY_KEYS.includes(key)) {
      warnings.push(`Unknown capability "${key}" — ignored.`);
    }
  }

  return { capabilities, warnings };
}

/**
 * True only if a capability set enables the given capability.
 *
 * @param {BrokerageCapabilitySet} capabilities
 * @param {string} key   One of {@link BrokerageCapability}.
 * @returns {boolean}
 */
function supports(capabilities, key) {
  return Boolean(capabilities && capabilities[key] === true);
}

/**
 * Human-readable list of enabled capabilities, for UI/logs/admin.
 * @param {BrokerageCapabilitySet} capabilities
 * @returns {string[]}
 */
function describeCapabilities(capabilities) {
  const set = capabilities && typeof capabilities === "object" ? capabilities : {};
  return ALL_CAPABILITY_KEYS.filter((key) => set[key] === true);
}

/**
 * True if the set declares at least one capability. Useful for distinguishing
 * "read-only metadata" providers from active-sync providers.
 * @param {BrokerageCapabilitySet} capabilities
 * @returns {boolean}
 */
function hasAnyCapability(capabilities) {
  return describeCapabilities(capabilities).length > 0;
}

module.exports = {
  BrokerageCapability,
  ALL_CAPABILITY_KEYS,
  normalizeCapabilities,
  supports,
  describeCapabilities,
  hasAnyCapability
};
