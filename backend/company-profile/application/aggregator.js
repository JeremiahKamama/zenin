"use strict";

const { createEmptyProfile } = require("../domain/models");

/**
 * Confidence levels for merged fields.
 */
const CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  FALLBACK: "fallback"
};

/**
 * Field-level merge preferences.
 *
 * Each entry is a path like "market.price" and the preferred provider order.
 * If not listed, the default provider priority is used.
 */
const FIELD_PREFERENCES = {
  "filings.latestAnnualReport": ["legacy", "fmp"],
  "filings.latestQuarterlyReport": ["legacy", "fmp"],
  "filings.latestCurrentReport": ["legacy", "fmp"],
  "filings.sicDescription": ["legacy", "fmp"],
  "filings.sic": ["legacy", "fmp"],
  "filings.facts": ["legacy", "fmp"],
  "research.overview": ["legacy"],
  "research.regulatory": ["legacy"],
  "research.capitalAllocation": ["legacy"],
  "research.operations": ["legacy"],
  "research.customers": ["legacy"],
  "research.businessModel": ["legacy"],
  "research.catalysts": ["legacy"],
  "research.risks": ["legacy"],
  "research.governance": ["legacy"],
  "sources": ["legacy"],
  "regulators": ["legacy"],
  "finvizMetrics": ["legacy"],
  "analyst.topTarget": ["legacy", "fmp"],
  "analyst.topAgency": ["legacy", "fmp"],
  "analyst.ratingsHistory": ["legacy", "fmp"],
  "ownership.shortInterest": ["fmp", "legacy"],
  "ownership.insiderOwnershipPct": ["fmp", "legacy"],
  "ownership.institutionalOwnershipPct": ["fmp", "legacy"],
  "ownership.institutionalHoldings": ["fmp", "legacy"]
};

/**
 * Object paths that should be merged atomically instead of recursing into sub-fields.
 */
const ATOMIC_PATHS = new Set([
  "filings.latestAnnualReport",
  "filings.latestQuarterlyReport",
  "filings.latestCurrentReport",
  "filings.facts",
  "regulators",
  "finvizMetrics"
]);

function getFieldPreference(path) {
  return FIELD_PREFERENCES[path] || null;
}

function getValue(obj, path) {
  return path.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
}

function setValue(obj, path, value) {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function hasValue(value) {
  if (value === undefined) return false;
  if (value === null) return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && Object.keys(value).length === 0) return false;
  return true;
}

function isBetterConfidence(current, candidate) {
  const rank = { [CONFIDENCE.HIGH]: 4, [CONFIDENCE.MEDIUM]: 3, [CONFIDENCE.LOW]: 2, [CONFIDENCE.FALLBACK]: 1 };
  return rank[candidate] > rank[current];
}

function confidenceForProvider(providerName, preferenceOrder) {
  if (!preferenceOrder) return CONFIDENCE.MEDIUM;
  const idx = preferenceOrder.indexOf(providerName);
  if (idx === 0) return CONFIDENCE.HIGH;
  if (idx === 1) return CONFIDENCE.MEDIUM;
  if (idx >= 2) return CONFIDENCE.LOW;
  return CONFIDENCE.FALLBACK;
}

/**
 * Merge a single field from multiple provider results.
 */
function mergeField(path, candidates, preferenceOrder) {
  for (const providerName of preferenceOrder || candidates.map((c) => c.provider)) {
    const candidate = candidates.find((c) => c.provider === providerName);
    if (candidate && hasValue(candidate.value)) {
      return {
        value: candidate.value,
        provider: providerName,
        confidence: confidenceForProvider(providerName, preferenceOrder)
      };
    }
  }

  // Fallback: take first non-empty value.
  const first = candidates.find((c) => hasValue(c.value));
  if (first) {
    return {
      value: first.value,
      provider: first.provider,
      confidence: CONFIDENCE.FALLBACK
    };
  }

  return null;
}

/**
 * Collect all leaf paths from an object (excluding metadata).
 */
function collectPaths(obj, prefix = "", set = new Set()) {
  if (!obj || typeof obj !== "object") return set;
  for (const key of Object.keys(obj)) {
    if (key === "metadata") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value) && !ATOMIC_PATHS.has(path)) {
      collectPaths(value, path, set);
    } else {
      set.add(path);
    }
  }
  return set;
}

/**
 * CompanyProfileAggregator
 *
 * Orchestrates registered providers in parallel, then merges their outputs
 * into a canonical profile with per-field confidence metadata.
 */
class CompanyProfileAggregator {
  constructor({ registry, metrics = null } = {}) {
    this.registry = registry;
    this.metrics = metrics;
  }

  async aggregate(symbol, options = {}) {
    const providers = this.registry.healthy();
    if (providers.length === 0) {
      throw new Error("No healthy providers available");
    }

    const startedAt = Date.now();
    const results = await Promise.all(
      providers.map(async (provider) => {
        const providerStart = Date.now();
        try {
          const profile = await provider.getProfile(symbol, options);
          this._emit("provider.success", {
            provider: provider.name,
            symbol,
            latencyMs: Date.now() - providerStart
          });
          return { provider: provider.name, profile, error: null };
        } catch (err) {
          this._emit("provider.error", {
            provider: provider.name,
            symbol,
            latencyMs: Date.now() - providerStart,
            error: err.message,
            rateLimited: err.rateLimited || err.status === 429
          });
          return { provider: provider.name, profile: null, error: err };
        }
      })
    );

    const successful = results.filter((r) => r.profile);
    if (successful.length === 0) {
      const errors = results.map((r) => `${r.provider}: ${r.error?.message || "unknown"}`).join("; ");
      throw new Error(`All providers failed for ${symbol}: ${errors}`);
    }

    const merged = this._mergeProfiles(successful, symbol);

    this._emit("aggregate.complete", {
      symbol,
      providerCount: providers.length,
      successCount: successful.length,
      latencyMs: Date.now() - startedAt
    });

    return merged;
  }

  _mergeProfiles(results, symbol) {
    const profile = createEmptyProfile(symbol);
    const fieldConfidence = {};
    const providerOrder = results.map((r) => r.provider);

    // Collect all leaf paths from all successful profiles.
    const allPaths = new Set();
    for (const { profile: p } of results) {
      collectPaths(p, "", allPaths);
    }

    for (const path of allPaths) {
      const candidates = results
        .map((r) => ({ provider: r.provider, value: getValue(r.profile, path) }))
        .filter((c) => c.value !== undefined);

      if (candidates.length === 0) continue;

      const preference = getFieldPreference(path);
      const effectiveOrder = preference || providerOrder;
      const mergedField = mergeField(path, candidates, effectiveOrder);

      if (mergedField && hasValue(mergedField.value)) {
        setValue(profile, path, mergedField.value);
        fieldConfidence[path] = {
          provider: mergedField.provider,
          confidence: mergedField.confidence,
          updatedAt: new Date().toISOString()
        };
      }
    }

    profile.metadata = {
      providers: results.map((r) => r.provider),
      fieldConfidence,
      updatedAt: new Date().toISOString()
    };

    return profile;
  }

  _emit(event, payload) {
    if (this.metrics && typeof this.metrics.emit === "function") {
      try {
        this.metrics.emit(event, payload);
      } catch {
        // Metrics must never break aggregation.
      }
    }
  }
}

module.exports = {
  CompanyProfileAggregator,
  CONFIDENCE,
  FIELD_PREFERENCES,
  hasValue
};
