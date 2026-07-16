// TransmissionCache — memoized single computation of transmission.
// Consumers subscribe; never recompute per component. Keyed by a signal signature.

import { computeTransmission } from "./TransmissionRuleEngine.js";

const _cache = new Map();
const MAX_ENTRIES = 64;

function signature(signals = [], rootConfidence) {
  const s = (signals || []).map((x) => `${x.label}:${x.positive ? 1 : 0}`).sort().join("|");
  return `${s}#${rootConfidence || 0}`;
}

export function getTransmission({ signals = [], rootConfidence = 70 } = {}) {
  const key = signature(signals, rootConfidence);
  if (_cache.has(key)) return _cache.get(key);
  const result = computeTransmission({ signals, rootConfidence });
  if (_cache.size >= MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(key, result);
  return result;
}

export function invalidate() {
  _cache.clear();
}
