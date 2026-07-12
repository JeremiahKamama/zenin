/**
 * Zenin Admin — Coverage Registry view (Track F).
 *
 * The authoritative admin surface for market / provider / exchange / dataset
 * coverage, the identifier Mapping Registry, API health, sync jobs, and the
 * coverage config Audit Log. Metadata-driven: reads from the passed `data`
 * (backend Coverage Service when available, seed fallback otherwise). No
 * hardcoded lists in the UI — everything comes from COVERAGE_SEED / backend.
 *
 * Monochrome per Brandv2: semantic tokens only, reuse existing .card / .badge /
 * table styles, no cyan/purple/gradients.
 */
import React, { useState, useMemo } from 'react';
import {
  Globe,
  Database,
  Server,
  Layers,
  Link as LinkIcon,
  Activity,
  RefreshCw,
  History,
  ShieldCheck,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { COVERAGE_SEED, resolveProviderPriority } from './coverageSeed';

const TABS = [
  { key: 'markets', label: 'Markets', icon: Globe },
  { key: 'providers', label: 'Providers', icon: Database },
  { key: 'exchanges', label: 'Exchanges', icon: Server },
  { key: 'datasets', label: 'Datasets', icon: Layers },
  { key: 'mappings', label: 'Mapping Registry', icon: LinkIcon },
  { key: 'health', label: 'API Health', icon: Activity },
  { key: 'sync', label: 'Sync Jobs', icon: RefreshCw },
  { key: 'audit', label: 'Audit Log', icon: History },
];

const StatusBadge = ({ status }) => {
  const tone =
    status === 'active' || status === 'healthy' || status === 'success'
      ? 'badge-success'
      : status === 'planned' || status === 'running' || status === 'degraded'
      ? 'badge-warning'
      : 'badge-danger';
  const Icon =
    status === 'active' || status === 'healthy' || status === 'success'
      ? CheckCircle2
      : status === 'failed' || status === 'inactive'
      ? XCircle
      : AlertTriangle;
  return (
    <span className={`badge ${tone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon size={11} />
      {String(status).replace(/[_-]/g, ' ')}
    </span>
  );
};

const SummaryCard = ({ icon: Icon, label, value, sub }) => (
  <div className="card stat-card">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
      <Icon size={15} />
      <span className="stat-label">{label}</span>
    </div>
    <span className="stat-value">{value}</span>
    {sub ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</span> : null}
  </div>
);

const SectionHeader = ({ title, description }) => (
  <div style={{ marginBottom: 24 }}>
    <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h2>
    <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{description}</p>
  </div>
);

const providerName = (id) =>
  (COVERAGE_SEED.providers.find((p) => p.id === id) || {}).name || id;

export default function CoverageRegistryView({ data = COVERAGE_SEED, onExport }) {
  const [tab, setTab] = useState('markets');
  const [regionFilter, setRegionFilter] = useState('All');

  const seed = COVERAGE_SEED;
  const markets = data.markets || seed.markets;
  const providers = data.providers || seed.providers;
  const exchanges = data.exchanges || seed.exchanges;
  const datasets = data.datasets || seed.datasets;
  const mappings = data.mappings || seed.mappings;
  const apiHealth = data.apiHealth || seed.apiHealth;
  const syncJobs = data.syncJobs || seed.syncJobs;
  const auditLog = data.auditLog || seed.auditLog;

  const africaCount = useMemo(() => markets.filter((m) => m.region === 'Africa').length, [markets]);
  const activeProviders = useMemo(() => providers.filter((p) => p.status === 'active').length, [providers]);

  const filteredMarkets = useMemo(
    () => (regionFilter === 'All' ? markets : markets.filter((m) => m.region === regionFilter)),
    [markets, regionFilter]
  );

  return (
    <div className="fade-in">
      <SectionHeader
        title="Coverage Registry"
        description="Authoritative source of truth for markets, providers, exchanges, datasets, and identifier mappings. Africa is a first-class region."
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
        <SummaryCard icon={Globe} label="Markets" value={markets.length} sub={`${africaCount} in Africa`} />
        <SummaryCard icon={Database} label="Providers" value={providers.length} sub={`${activeProviders} active`} />
        <SummaryCard icon={Server} label="Exchanges" value={exchanges.length} sub={`${exchanges.filter((e) => e.status === 'active').length} live`} />
        <SummaryCard icon={Layers} label="Datasets" value={datasets.length} sub={`${datasets.filter((d) => d.status === 'active').length} active`} />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`nav-item nav-button ${tab === t.key ? 'active' : ''}`}
              style={{ width: 'auto', margin: '0 4px 0 0', borderRadius: '6px 6px 0 0', borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              <Icon size={15} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {tab === 'markets' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <select className="filter-select" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} style={{ height: 36 }}>
              <option value="All">All Regions</option>
              {seed.regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th><th>Market</th><th>Region</th><th>Providers</th><th>Asset Classes</th>
                </tr>
              </thead>
              <tbody>
                {filteredMarkets.map((m) => (
                  <tr key={m.code}>
                    <td><strong>{m.code}</strong></td>
                    <td>{m.name}</td>
                    <td>{m.region}</td>
                    <td>{m.providers.map(providerName).join(', ')}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{(m.assetClasses || []).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'providers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {providers.map((p) => {
            const priority = resolveProviderPriority({ region: 'Africa', assetClass: 'Equities', capability: 'quotes', providers });
            const isTop = priority[0] && priority[0].id === p.id;
            return (
              <div key={p.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</h4>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{p.category}</p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0' }}>{p.note}</p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>Priority: {p.priority}</span>
                  <span>Regions: {p.regions.join(', ')}</span>
                  <span>Caps: {p.capabilities.join(', ')}</span>
                </div>
                {isTop ? (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--success)' }}>
                    ✓ Preferred for Africa Equities quotes
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'exchanges' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>MIC</th><th>Exchange</th><th>Country</th><th>Region</th><th>Asset Classes</th><th>Status</th></tr>
            </thead>
            <tbody>
              {exchanges.map((e) => (
                <tr key={e.mic}>
                  <td><strong>{e.mic}</strong></td>
                  <td>{e.name}</td>
                  <td>{e.country}</td>
                  <td>{e.region}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{(e.assetClasses || []).join(', ')}</td>
                  <td><StatusBadge status={e.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'datasets' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>Dataset</th><th>Provider</th><th>Region</th><th>Asset Class</th><th>Cadence</th><th>Status</th></tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{providerName(d.provider)}</td>
                  <td>{d.region}</td>
                  <td>{d.assetClass}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{d.cadence}</td>
                  <td><StatusBadge status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'mappings' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>Internal</th><th>Name</th><th>ISIN</th><th>FIGI</th><th>CUSIP</th><th>SEDOL</th><th>MIC</th><th>RIC</th><th>Ticker</th></tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr key={m.internalId}>
                  <td><strong>{m.internalId}</strong></td>
                  <td>{m.name}</td>
                  <td>{m.isin || '—'}</td>
                  <td>{m.figi || '—'}</td>
                  <td>{m.cusip || '—'}</td>
                  <td>{m.sedol || '—'}</td>
                  <td>{m.mic}</td>
                  <td>{m.ric}</td>
                  <td>{m.ticker}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'health' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>Provider</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>Uptime</th></tr>
            </thead>
            <tbody>
              {apiHealth.map((h, i) => (
                <tr key={`${h.provider}-${i}`}>
                  <td><strong>{providerName(h.provider)}</strong></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{h.endpoint}</td>
                  <td><StatusBadge status={h.status} /></td>
                  <td>{h.latencyMs}ms</td>
                  <td>{h.uptimePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sync' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>Job</th><th>Provider</th><th>Dataset</th><th>Status</th><th>Last Run</th><th>Rows</th></tr>
            </thead>
            <tbody>
              {syncJobs.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.id}</strong></td>
                  <td>{providerName(j.provider)}</td>
                  <td>{j.dataset}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{new Date(j.lastRun).toLocaleString()}</td>
                  <td>{j.rows != null ? j.rows.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th><th>When</th></tr>
            </thead>
            <tbody>
              {auditLog.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.actor}</strong></td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{a.detail}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(a.at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => onExport && onExport(COVERAGE_SEED, 'Coverage registry exported.', 'The full coverage registry snapshot was downloaded as JSON.')}
        >
          Export Registry
        </button>
      </div>
    </div>
  );
}
