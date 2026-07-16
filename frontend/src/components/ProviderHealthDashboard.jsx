// ProviderHealthDashboard — Correction 11.
// Developer surface: unified provider health from the Provider Registry.
// Consumes listProviderHealth() — declared health (never fabricated live
// metrics; a real backend health endpoint replaces the values, not the shape).
// Monochrome, token-driven.
import { listProviderHealth } from "../utils/DataCoverageRegistry";

const STATUS_TOKEN = { online: "positive", partial: "watch", offline: "negative" };

export function ProviderHealthDashboard() {
  const providers = listProviderHealth();
  return (
    <section className="provider-health">
      <header className="provider-health-head">
        <h2 className="provider-health-title">Provider Status</h2>
        <p className="provider-health-sub">Developer view · {providers.filter((p) => p.status === "online").length}/{providers.length} online</p>
      </header>
      <table className="provider-health-table">
        <thead>
          <tr>
            <th>Provider</th><th>Status</th><th>Scope</th><th>Latency</th>
            <th>Cache Hit</th><th>Rate Limit</th><th>Last Sync</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr key={p.id}>
              <td>{p.label}</td>
              <td><span className={`badge ${STATUS_TOKEN[p.status] || "watch"}`}>{p.status}</span></td>
              <td>{p.scope}</td>
              <td>{p.latencyMs != null ? `${p.latencyMs}ms` : "—"}</td>
              <td>{p.cacheHitRatio ? `${Math.round(p.cacheHitRatio * 100)}%` : "—"}</td>
              <td>{p.rateLimit}</td>
              <td>{p.lastSync}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default ProviderHealthDashboard;
