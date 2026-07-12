// =============================================================================
// OrderNormalizationService
// -----------------------------------------------------------------------------
// Normalizes raw broker/exchange order payloads into the shared `Order` domain
// model. This is the ONLY module that understands provider-specific order
// schemas; everything downstream consumes normalized Orders.
//
// Supports a pluggable broker adapter registry so future broker integrations
// are additive (see registerBrokerAdapter + EXTENSION POINTS in docs).
//
// IMPORTANT: This service is read-only. It never fabricates live market data.
// When a provider supplies no fee/slippage, the value stays null and the UI
// labels it as "Estimate" / "N/A" — we never invent prices.
// =============================================================================

import { createOrder, createBroker, createVenue, ORDER_STATUS } from "../models/domainModels";

/**
 * @typedef {Object} BrokerOrderAdapter
 * @property {string} brokerId - lowercase broker id this adapter handles.
 * @property {function(any, any): any} normalize - (rawOrder, ctx) => rawOrder shaped
 *   toward the canonical createOrder input (broker/venue/symbol/side/orderType/
 *   status/orderedQuantity/filledQuantity/...). May enrich or rename fields.
 */

const brokerAdapters = new Map();

/**
 * Register a broker-specific adapter. Future integrations call this with their
 * normalizer; existing flows continue to work untouched.
 * @param {BrokerOrderAdapter} adapter
 */
export function registerBrokerAdapter(adapter) {
  if (!adapter || !adapter.brokerId) {
    throw new Error("registerBrokerAdapter requires { brokerId, normalize }");
  }
  brokerAdapters.set(String(adapter.brokerId).toLowerCase(), adapter);
}

export function getRegisteredBrokerAdapters() {
  return [...brokerAdapters.keys()];
}

function pickBrokerContext(rawOrders) {
  // Derive a default broker/venue context from a batch when orders omit it.
  const first = Array.isArray(rawOrders) ? rawOrders[0] : null;
  if (!first) return { brokerId: "", venueId: "" };
  return {
    brokerId: String(first.broker || first.provider || first.exchange || "").trim().toLowerCase(),
    venueId: String(first.venue || first.platform || first.exchange || "").trim().toLowerCase(),
  };
}

/**
 * Normalize a batch of raw orders from one or many brokers into canonical Orders.
 * @param {Array<any>} rawOrders - provider payloads (mixed brokers allowed).
 * @param {Object} [ctx] - optional overrides: { brokers: Broker[], venues: Venue[] }
 * @returns {Array<any>} normalized Order objects
 */
export function normalizeOrders(rawOrders = [], ctx = {}) {
  const list = Array.isArray(rawOrders) ? rawOrders : [];
  const defaultCtx = pickBrokerContext(list);
  const brokerByName = new Map(
    (Array.isArray(ctx.brokers) ? ctx.brokers : []).map((b) => [String(b.id || b.name).toLowerCase(), b])
  );
  const venueByName = new Map(
    (Array.isArray(ctx.venues) ? ctx.venues : []).map((v) => [String(v.id || v.name).toLowerCase(), v])
  );

  return list
    .map((raw) => {
      const brokerId = String(raw?.broker || raw?.provider || raw?.exchange || defaultCtx.brokerId || "")
        .trim()
        .toLowerCase();
      const adapter = brokerAdapters.get(brokerId);
      const shaped = adapter ? adapter.normalize(raw, { ...defaultCtx, ...ctx }) : raw;

      const enriched = { ...shaped };
      // Enrich broker/venue names from known connections when the raw payload
      // only carries an id.
      const knownBroker = brokerByName.get(brokerId) || brokerByName.get(String(shaped.broker || "").toLowerCase());
      if (knownBroker) {
        enriched.brokerName = knownBroker.name;
        if (!enriched.broker) enriched.broker = knownBroker.id;
      }
      const venueId = String(shaped.venue || shaped.platform || brokerId).toLowerCase();
      const knownVenue = venueByName.get(venueId);
      if (knownVenue) enriched.venueName = knownVenue.name;

      return createOrder(enriched);
    })
    .filter((order) => order && order.symbol && order.symbol !== "UNKNOWN");
}

/**
 * Group normalized orders by status category (for the Order Desk summaries).
 */
export function groupOrdersByStatus(orders = []) {
  const groups = {
    [ORDER_STATUS.WORKING]: [],
    [ORDER_STATUS.PENDING]: [],
    [ORDER_STATUS.PARTIALLY_FILLED]: [],
    [ORDER_STATUS.FILLED]: [],
    [ORDER_STATUS.CANCELLED]: [],
    [ORDER_STATUS.EXPIRED]: [],
    [ORDER_STATUS.REJECTED]: [],
  };
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (groups[order.status]) groups[order.status].push(order);
  });
  return groups;
}

/**
 * Derive a read-only working-order ledger from connected broker accounts.
 *
 * There is currently no dedicated orders endpoint in the Zenin backend; broker
 * connections are read-only. This method builds a normalized, clearly-sourced
 * order ledger from the accounts the user has connected (open/resting intents
 * the broker reports) plus any provider executions. It deliberately does NOT
 * fabricate market data — when a broker reports no open orders, the ledger is
 * empty for that venue and the UI says so.
 *
 * @param {Array<any>} connectedAccounts - broker connection records (App.connectedAccounts)
 * @returns {{ orders: Array<any>, brokers: Array<any>, venues: Array<any>, sources: Array<string> }}
 */
export function deriveOrderLedgerFromConnections(connectedAccounts = []) {
  const accounts = Array.isArray(connectedAccounts) ? connectedAccounts : [];
  const brokers = accounts.map((a) => createBroker(a));
  const venues = accounts.map((a) =>
    createVenue({
      id: a.exchange || a.provider || a.id,
      name: a.provider || a.exchange || a.username,
      assetClass: a.venueType === "dex" ? "crypto" : "unknown",
      venueType: a.venueType,
    })
  );
  const sources = [...new Set(brokers.map((b) => b.name))];

  // Connected accounts may carry a `workingOrders` array (broker-reported
  // resting intents). We only read what the broker provides.
  const rawOrders = accounts.flatMap((a) =>
    Array.isArray(a.workingOrders) ? a.workingOrders.map((o) => ({ ...o, broker: a.provider || a.exchange, venue: a.exchange || a.platform })) : []
  );

  const orders = normalizeOrders(rawOrders, { brokers, venues });
  return { orders, brokers, venues, sources };
}
