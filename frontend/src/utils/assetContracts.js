// Asset Intelligence Platform — shared asset contracts (Phase 2).
//
// JSDoc typedefs only: zero runtime cost, additive. These are the normalized
// shapes every AssetAdapter must produce, so workspace/profile/modal can be
// rendered generically (registry- and tier-driven) regardless of asset kind.
//
// No fabricated data: adapters return `null`/empty for absent fields; the UI
// renders honest "Unavailable" (Brand v2), never placeholders-as-real.

/**
 * @typedef {"stock"|"crypto"|"option"|"commodity"|"etf"|"bond"|"fund"|"index"|"currency"|"private"} AssetKind
 */

/**
 * Stable identity + descriptive reference for an asset. Reference only.
 * @typedef {Object} AssetMetadata
 * @property {string} symbol            Canonical uppercase symbol/id.
 * @property {AssetKind} kind
 * @property {string} [name]            Display name (falls back to symbol).
 * @property {string} [category]        e.g. "Energy", "Industrial Metals", sector.
 * @property {string} [exchange]
 * @property {string} [currency]
 * @property {Object} [contract]        Kind-specific contract facts (tick, unit, delivery…).
 */

/**
 * A point-in-time market read. Numeric fields are `null` when unavailable.
 * @typedef {Object} AssetSnapshot
 * @property {string} symbol
 * @property {AssetKind} kind
 * @property {number|null} price
 * @property {number|null} dayChangePct
 * @property {number|null} ytdChangePct
 * @property {number[]} [series]        Recent close series for sparkline (may be []).
 * @property {string|null} updatedAt    ISO timestamp of the underlying data.
 * @property {Object} [raw]             Adapter-specific extras (fundamentals, inventory…).
 */

/**
 * A derived, explainable signal. Never a BUY/SELL directive — explanatory only.
 * @typedef {Object} AssetSignal
 * @property {string} id
 * @property {string} label
 * @property {"bullish"|"bearish"|"neutral"|"warning"} tone
 * @property {number} confidence        0–100.
 * @property {string} [horizon]
 * @property {string[]} evidence        Human-readable drivers. Empty if none.
 * @property {string} [source]          Publisher (macro, commodity, research…).
 * @property {string|null} updatedAt
 */

/** One edge from this asset to a related entity (1-hop; graph does traversal). */
/**
 * @typedef {Object} AssetRelationship
 * @property {string} id                Target entity id/symbol.
 * @property {AssetKind|"country"|"sector"|"indicator"} kind
 * @property {string} type              Edge type: "produces","tracked_by","exposed_in"…
 * @property {number} [weight]          0–1 strength when known.
 * @property {string} [source]          Provenance of the edge.
 */

/**
 * How much / how fresh the intelligence backing this asset is.
 * @typedef {Object} AssetCoverage
 * @property {boolean} hasResearch
 * @property {boolean} hasProfile
 * @property {number} confidence        0–100 aggregate.
 * @property {string|null} freshness    Human "3h ago" / null when unknown.
 * @property {string[]} [missing]       Named gaps ("curve","CFTC positioning"…).
 */

/**
 * The full normalized asset object a workspace/profile consumes.
 * @typedef {Object} Asset
 * @property {AssetMetadata} metadata
 * @property {AssetSnapshot|null} snapshot
 * @property {AssetSignal[]} signals
 * @property {AssetRelationship[]} relationships
 * @property {AssetCoverage} coverage
 */

// Intentionally no runtime exports beyond this marker — typedefs are compile-time.
export const ASSET_CONTRACTS_VERSION = 1;
