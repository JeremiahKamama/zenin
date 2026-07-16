// CapabilityStatusCard — Corrections 1 & 13.
// Single reusable card that REPLACES all Ghost/"Provider Pending" placeholders.
// Consumes the Capability Registry (resolveCapability) — never a provider
// directly. Three states: Available / Partial / Unavailable. Every unavailable
// capability explains itself (expected provider, reason, fallback, retry, docs).
// Monochrome, token-driven (positive / watch / negative).
import { resolveCapability } from "../utils/DataCoverageRegistry";

const STATE_TOKEN = { available: "positive", partial: "watch", unavailable: "negative" };
const STATE_LABEL = { available: "Available", partial: "Partial Coverage", unavailable: "Unavailable" };
const STATE_GLYPH = { available: "✓", partial: "◐", unavailable: "○" };

export function CapabilityStatusCard({ capability, reason, updatedAt, onRetry }) {
  const cap = resolveCapability(capability);
  const token = STATE_TOKEN[cap.status] || "watch";
  return (
    <section className={`capability-card cap-${token}`} role="status" aria-label={`${cap.label} capability ${cap.status}`}>
      <header className="capability-card-head">
        <span className="capability-card-glyph" aria-hidden>{STATE_GLYPH[cap.status]}</span>
        <div>
          <span className="capability-card-cap">{cap.label}</span>
          <span className={`capability-card-status badge ${token}`}>{STATE_LABEL[cap.status]}</span>
        </div>
      </header>
      <dl className="capability-card-grid">
        {cap.status === "available" ? (
          <>
            <div><dt>Provider</dt><dd>{cap.provider}</dd></div>
            <div><dt>Updated</dt><dd>{updatedAt || cap.freshness || "On open"}</dd></div>
          </>
        ) : cap.status === "partial" ? (
          <>
            <div><dt>Provider</dt><dd>{cap.provider}</dd></div>
            <div><dt>Missing</dt><dd>{cap.expectedProvider}</dd></div>
            <div><dt>Reason</dt><dd>{reason || cap.reason}</dd></div>
          </>
        ) : (
          <>
            <div><dt>Expected Provider</dt><dd>{cap.expectedProvider || "—"}</dd></div>
            <div><dt>Reason</dt><dd>{reason || cap.reason}</dd></div>
            <div><dt>Fallback</dt><dd>{cap.fallbackChain.length > 1 ? cap.fallbackChain.slice(1).join(" → ") : "None"}</dd></div>
          </>
        )}
      </dl>
      <footer className="capability-card-foot">
        <button type="button" className="capability-card-btn" onClick={() => onRetry?.(cap.id)}>Refresh</button>
        <span className="capability-card-docs">Documentation {cap.documentation ? "Available" : "—"}</span>
      </footer>
    </section>
  );
}

export default CapabilityStatusCard;
